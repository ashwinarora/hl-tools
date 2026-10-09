import {
	type Address,
	createProposal,
	describeAction,
	fromPlain,
	type Issue,
	infoClient,
	type Proposal,
	prepareInnerAction,
	signProposal,
	stringifyJson,
} from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileSignature, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import {
	EmptyState,
	Field,
	KeyValueGrid,
	Panel,
	Segmented,
	Select,
	TextArea,
	TextInput,
	Workspace,
} from "#/components/hub/layout";
import {
	Callout,
	IssueList,
	NetworkBadge,
	Pill,
} from "#/components/hub/status";
import { AddressLine, short } from "#/components/tools/multisig/AddressLine";
import { FLAG_TEXT } from "#/components/tools/multisig/EnvelopeView";
import {
	type AccountTarget,
	ADDRESS_RE,
} from "#/components/tools/multisig/model";
import { Button } from "#/components/ui/button";
import { errorMessage } from "#/hooks/useHyperliquid";
import { useNetwork, useNetworkHydrated } from "#/store/networkStore";
import {
	ACTION_KINDS,
	type ActionForm,
	type ActionKind,
	buildProposalInput,
	DEFAULT_FORM,
	fieldOf,
	formFromAction,
} from "../model/actions";
import { type InnerChain, innerChain } from "../model/chains";
import { loadProposal, saveProposal } from "../model/history";
import { describeWindow, type NonceMode, nonceFor } from "../model/nonce";
import { RELAY_COPY } from "../model/relay/copy";
import { publishRow } from "../model/relay/push";
import { linkTransport } from "../model/transport";
import { addSignature, publishProposal } from "../relay/api";
import { useTreasuries } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { NetTag, SignsTag, backLink as shellBack } from "../shell/kit";
import { ShellPage } from "../shell/ShellPage";
import { TreasuryStrip } from "../TreasuryStrip";
import { useTreasuryState } from "../useTreasuryState";
import { useWalletSigner } from "../useWalletSigner";
import { ActionFields } from "./ActionFields";

/** Shown only once the user has tried to create: an untouched form is not an error. */
const REQUIRED = new Set(["field.required", "finaliser.required"]);

const backLink =
	"inline-flex h-8 items-center rounded-md border border-border-strong bg-surface px-3 text-sm hover:bg-surface-2";

/**
 * Build a proposal for one treasury on the header network: the action, who
 * finalises it, the chain signers sign under and how long they have. The
 * proposer can sign on the spot. Nothing is sent to Hyperliquid here.
 */
export function ProposeScreen({
	treasury,
	supersedes,
}: {
	treasury?: string;
	supersedes?: string;
}) {
	const network = useNetwork();
	const hydrated = useNetworkHydrated();
	const navigate = useNavigate();
	const client = useQueryClient();
	const wallet = useWalletSigner();
	const [form, setForm] = useState<ActionForm>(DEFAULT_FORM);
	const [attempted, setAttempted] = useState(false);
	const [failure, setFailure] = useState<{
		title: string;
		issues: readonly Issue[];
	} | null>(null);
	// The preview hashes with a nonce taken when the page opened; the real one is taken on create.
	const [previewNow] = useState(() => Date.now());
	const [superseded, setSuperseded] = useState<Proposal | null>(null);

	const set = <K extends keyof ActionForm>(key: K, value: ActionForm[K]) =>
		setForm((f) => ({ ...f, [key]: value }));

	const address =
		treasury && ADDRESS_RE.test(treasury)
			? (treasury.toLowerCase() as `0x${string}`)
			: null;
	const target = useMemo<AccountTarget | null>(
		() => (hydrated && address ? { address, network } : null),
		[hydrated, address, network],
	);
	const state = useTreasuryState(target, { live: true });

	// Re-proposing: start from the action, finaliser and label of the proposal being replaced.
	useEffect(() => {
		if (!supersedes) return;
		let cancelled = false;
		void loadProposal(supersedes)
			.then((r) => {
				const old = r.proposal;
				if (cancelled || !old) return;
				setSuperseded(old);
				setForm((f) => ({
					...f,
					...formFromAction(old.payload.action, old.payload.network),
					finaliser: old.payload.outerSigner,
					title: old.meta.title ?? "",
					note: old.meta.note ?? "",
				}));
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [supersedes]);

	const universe = useQuery({
		queryKey: ["universe", network],
		queryFn: () => infoClient(network).universe(),
		staleTime: 5 * 60_000,
		retry: 1,
		enabled: hydrated && form.kind === "spotSend",
	});

	const chain = innerChain(network, form.chain);
	const context = (nonce: number) => ({
		network,
		multiSigUser: address ?? "",
		nonce,
		signatureChainId: chain.hex,
		tokens: universe.data?.tokens,
		balances: {
			perpWithdrawable: state.perp?.withdrawable,
			spot: state.spot?.balances,
		},
		createdBy: wallet.address,
		supersedes: superseded?.digest ?? null,
		policyAtCreation: state.policy,
	});
	const previewNonce = nonceFor(form.nonceMode, previewNow);
	const draft = buildProposalInput(form, context(previewNonce));
	const preview = draft.input
		? createProposal(draft.input, { now: previewNow })
		: null;
	// The canonical action and its risk flags do not depend on the finaliser, so show them
	// as soon as the action itself builds.
	const prepared = draft.action
		? prepareInnerAction(draft.action, network, previewNonce)
		: null;
	const issues = [
		...draft.issues,
		...(preview ? preview.issues : (prepared?.issues ?? [])),
	];
	const error = (field: keyof ActionForm) =>
		issues.find(
			(i) =>
				i.severity === "error" &&
				fieldOf(i) === field &&
				(attempted || !REQUIRED.has(i.code)),
		)?.message;
	const otherIssues = issues.filter(
		(i) => i.severity !== "error" || fieldOf(i) === null,
	);
	const action = prepared?.action ?? null;
	const flags = prepared?.flags ?? [];
	const window = describeWindow(previewNonce, previewNow);

	// With the relay in use and this wallet in its copy of the signer list, a new
	// proposal is shared as it is created.
	const relay = useRelay();
	const { rows: listed } = useTreasuries();
	const sharing =
		!!relay.wallet &&
		listed.some(
			(t) =>
				t.network === network &&
				t.address === address &&
				t.frozenAt === null &&
				t.signers.includes(relay.wallet as Address),
		);

	const me = wallet.address?.toLowerCase() ?? null;
	const iAmSigner =
		me !== null && !!state.policy?.authorizedUsers.some((a) => a === me);
	const ready = state.isMultiSig === true;

	const create = async (sign: boolean) => {
		setAttempted(true);
		setFailure(null);
		const now = Date.now();
		const fresh = buildProposalInput(
			form,
			context(nonceFor(form.nonceMode, now)),
		);
		if (!fresh.input) return;
		const created = createProposal(fresh.input, { now });
		if (!created.proposal) {
			setFailure({
				title: "The proposal could not be created",
				issues: created.issues,
			});
			return;
		}
		let proposal = created.proposal;
		if (sign) {
			const got = await wallet.signerFor(chain.hex);
			if (!got.ok) {
				setFailure({
					title: "The wallet did not sign",
					issues: [{ code: "wallet", severity: "error", message: got.error }],
				});
				return;
			}
			const signed = await signProposal(proposal, got.signer, {
				expectedSigner: wallet.address ?? undefined,
			});
			if (!signed.signature) {
				setFailure({ title: "The wallet did not sign", issues: signed.issues });
				return;
			}
			proposal = { ...proposal, signatures: [signed.signature] };
		}
		try {
			const saved = await saveProposal(proposal);
			await client.invalidateQueries({ queryKey: ["multisig-proposals"] });
			// Signed in and listed as a signer on the relay: co-signers see it at once.
			// A relay failure does not undo the proposal; its page says "only in this
			// browser" and offers to share it again.
			if (sharing && relay.client && relay.wallet) {
				const key = {
					network: saved.proposal.payload.network,
					treasury: saved.proposal.payload.multiSigUser,
					digest: saved.proposal.digest,
				};
				const shared = await publishProposal(
					relay.client,
					relay.wallet,
					publishRow(saved.proposal),
				);
				const mine = saved.proposal.signatures.find(
					(x) => x.signer === relay.wallet,
				);
				if (!shared.issue && mine) {
					await addSignature(relay.client, relay.wallet, key, mine);
				}
				void client.invalidateQueries({ queryKey: ["relay", relay.wallet] });
			}
			void navigate({
				to: "/multisig/proposal",
				search: { digest: saved.proposal.digest },
			});
		} catch (e) {
			// No history in this browser: carry the document to the proposal page in the link itself.
			const url = linkTransport(() => globalThis.location.origin).publish(
				proposal,
			).url;
			if (url) globalThis.location.assign(url);
			else
				setFailure({
					title: "The proposal could not be kept",
					issues: [
						{ code: "history", severity: "error", message: errorMessage(e) },
					],
				});
		}
	};

	if (!address) {
		return (
			<ShellPage title="Propose an action" meta={<SignsTag />}>
				<EmptyState
					icon={FileSignature}
					title="Choose the treasury first"
					description="A proposal is made for one multi-sig account. Enter its address on the start page."
					action={
						<Link to="/multisig/open" className={backLink}>
							Back to the start
						</Link>
					}
				/>
			</ShellPage>
		);
	}

	return (
		<ShellPage
			title="Propose an action"
			back={
				<Link to="/multisig/open" className={shellBack}>
					◂ Open or start
				</Link>
			}
			meta={
				<>
					<span className="font-mono" title={address}>
						{short(address)}
					</span>
					{hydrated && <NetTag network={network} />}
					{state.policy && state.policy.authorizedUsers.length > 0 && (
						<span>
							{state.policy.threshold} of {state.policy.authorizedUsers.length}{" "}
							signers
						</span>
					)}
					<SignsTag />
				</>
			}
		>
			<Workspace
				input={
					<>
						<TreasuryStrip state={state} wallet={wallet.address} />
						{superseded && (
							<Callout tone="info" title="Re-proposing">
								Started from the proposal {short(superseded.digest)}. This is a
								new proposal with a new nonce: signatures do not carry over.
							</Callout>
						)}
						<Panel
							title="Action"
							description={
								ACTION_KINDS.find((k) => k.kind === form.kind)?.description
							}
						>
							<div className="space-y-4">
								<Segmented<ActionKind>
									label="Action"
									value={form.kind}
									onChange={(v) => set("kind", v)}
									options={ACTION_KINDS.map((k) => ({
										value: k.kind,
										label: k.label,
									}))}
								/>
								<ActionFields
									form={form}
									set={set}
									error={error}
									network={network}
									tokens={universe.data?.tokens ?? null}
									held={
										state.spot?.balances
											.filter((b) => Number(b.total) !== 0)
											.map((b) => b.token) ?? []
									}
									tokensLoading={universe.isFetching}
								/>
							</div>
						</Panel>
						<Panel
							title="Signing"
							description="Fixed when the proposal is created: every signer signs exactly this."
						>
							<div className="space-y-4">
								<Field
									label="Who finalises this?"
									htmlFor="ms-finaliser"
									error={error("finaliser")}
									hint="The signer who will be there at the end: only this wallet can sign the envelope and submit. If they sign last, they finish in one sitting."
								>
									<Select
										id="ms-finaliser"
										value={form.finaliser}
										onChange={(e) => set("finaliser", e.target.value)}
										aria-invalid={!!error("finaliser")}
										disabled={!state.policy}
									>
										<option value="">Choose a signer…</option>
										{state.policy?.authorizedUsers.map((a) => (
											<option key={a} value={a}>
												{a}
												{a === me ? " (you)" : ""}
											</option>
										))}
									</Select>
								</Field>
								<Field
									label="Signers sign under"
									hint={`EIP-712 chain ${chain.hex} (${chain.id}). Every signer's wallet switches to ${chain.label} to sign; nothing is sent to that chain.`}
								>
									<Segmented<InnerChain>
										label="Signing chain"
										value={form.chain}
										onChange={(v) => set("chain", v)}
										options={[
											{
												value: "hyperevm",
												label: innerChain(network, "hyperevm").label,
											},
											{
												value: "arbitrum",
												label: innerChain(network, "arbitrum").label,
											},
										]}
									/>
								</Field>
								<Field
									label="Signing window"
									hint={`If created now: ${window.text}. After that the chain rejects it and it must be re-proposed.`}
								>
									<Segmented<NonceMode>
										label="Signing window"
										value={form.nonceMode}
										onChange={(v) => set("nonceMode", v)}
										options={[
											{ value: "now", label: "2 days" },
											{ value: "extended", label: "Give signers 3 days" },
										]}
									/>
								</Field>
							</div>
						</Panel>
						<Panel
							title="Label"
							description="Unsigned: it travels with the document so signers know what this is, and anyone holding the document can change it."
						>
							<div className="space-y-4">
								<Field label="Title" htmlFor="ms-title">
									<TextInput
										id="ms-title"
										value={form.title}
										onChange={(e) => set("title", e.target.value)}
										placeholder="October contributor payout"
									/>
								</Field>
								<Field label="Note" htmlFor="ms-note">
									<TextArea
										id="ms-note"
										mono={false}
										className="min-h-16"
										rows={2}
										value={form.note}
										onChange={(e) => set("note", e.target.value)}
									/>
								</Field>
							</div>
						</Panel>
					</>
				}
				output={
					<>
						<Panel
							title={
								<span className="flex items-center gap-2">
									Preview <NetworkBadge network={network} />
								</span>
							}
							description="What signers will be asked to sign. The nonce and the digest are fixed when you create."
						>
							{action ? (
								<div className="space-y-4">
									<div>
										<p className="text-base font-medium [overflow-wrap:anywhere]">
											{describeAction(action).headline}
										</p>
										<div className="mt-2 flex flex-wrap gap-2">
											{flags.map((f) => (
												<Pill key={f} tone={FLAG_TEXT[f]?.tone ?? "info"}>
													{FLAG_TEXT[f]?.label ?? f}
												</Pill>
											))}
										</div>
									</div>
									<KeyValueGrid
										columns={2}
										items={[
											{
												label: "From (multi-sig user)",
												value: (
													<AddressLine address={address} network={network} />
												),
											},
											{
												label: "Finaliser (leader)",
												value: ADDRESS_RE.test(form.finaliser) ? (
													<AddressLine
														address={form.finaliser}
														network={network}
													/>
												) : (
													"not chosen"
												),
											},
											{
												label: "Signers sign under",
												value: `${chain.label} · ${chain.hex}`,
												mono: true,
											},
											{ label: "Signing window", value: window.text },
										]}
									/>
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									Fill in the action to see what will be signed.
								</p>
							)}
							{otherIssues.length > 0 && (
								<div className="mt-4">
									<IssueList issues={otherIssues} />
								</div>
							)}
						</Panel>
						{action && (
							<Panel
								title="Inner action"
								description="The canonical action, as it will be hashed. Its time or nonce field is replaced when you create."
							>
								<CodeBlock
									content={stringifyJson(fromPlain(action), 2)}
									lang="json"
									maxHeight="18rem"
								/>
							</Panel>
						)}
						<Panel title="Create">
							<div className="space-y-3">
								{!hydrated || state.loading ? (
									<p
										className="flex items-center gap-2 text-sm text-muted-foreground"
										aria-busy="true"
									>
										<Loader2 className="size-4 animate-spin" aria-hidden />{" "}
										Reading the treasury…
									</p>
								) : !ready ? (
									<p className="text-sm text-muted-foreground">
										A proposal needs a multi-sig account on {network}. See the
										treasury panel.
									</p>
								) : (
									<p className="text-sm text-muted-foreground">
										Creating fixes the nonce and the digest and saves the
										proposal in this browser. Nothing is sent to Hyperliquid
										until the finaliser submits.{" "}
										{sharing
											? RELAY_COPY.createdShared
											: relay.mode === "on"
												? "The relay does not list your wallet as a signer of this treasury, so it stays in this browser until you share it."
												: ""}
									</p>
								)}
								<div className="flex flex-wrap items-center gap-2">
									<Button
										variant="brand"
										disabled={!ready || !iAmSigner || wallet.busy}
										onClick={() =>
											void wallet.run("Waiting for the wallet…", () =>
												create(true),
											)
										}
									>
										{wallet.address
											? `Create and sign as ${short(wallet.address)}`
											: "Create and sign"}
									</Button>
									<Button
										variant="outline"
										disabled={!ready || wallet.busy}
										onClick={() => void create(false)}
									>
										Create without signing
									</Button>
								</div>
								{ready && !iAmSigner && (
									<p className="text-xs text-muted-foreground">
										{wallet.address
											? `${short(wallet.address)} is not in the signer set, so it can draft a proposal but not sign it.`
											: "Connect a signer's wallet to sign on the spot, or create the proposal unsigned and pass it on."}
									</p>
								)}
								{attempted && !draft.input && (
									<Callout tone="danger" title="Not created yet">
										Fix the fields marked on the left.
									</Callout>
								)}
								{failure && (
									<Callout tone="danger" title={failure.title}>
										<IssueList issues={failure.issues} />
									</Callout>
								)}
							</div>
						</Panel>
					</>
				}
			/>
		</ShellPage>
	);
}
