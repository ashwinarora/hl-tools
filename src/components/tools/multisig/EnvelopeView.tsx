import {
	buildEnvelope,
	canonicalEnvelopeAction,
	describeAction,
	envelopeDigest,
	explainExchangeError,
	fromPlain,
	MULTISIG_SAMPLES,
	type Network,
	nonceWindow,
	type Proposal,
	proposalFlags,
	stringifyJson,
} from "@hl-tools/core";
import { FileSignature, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import { CopyButton } from "#/components/hub/CopyButton";
import {
	EmptyState,
	Field,
	KeyValueGrid,
	Panel,
	TextArea,
	Workspace,
} from "#/components/hub/layout";
import {
	Callout,
	IssueList,
	NetworkBadge,
	ObservedLine,
	Pill,
} from "#/components/hub/status";
import { Button } from "#/components/ui/button";
import { useNetworkStore } from "#/store/networkStore";
import { AddressLine } from "./AddressLine";
import { type ParsedEnvelopeInput, parseEnvelopeText } from "./model";
import { useCoinNames } from "./useCoinNames";
import {
	type Judgement,
	type JudgementState,
	type PolicyQuery,
	type ProposalParsed,
	useJudgement,
} from "./useJudgement";

export const FLAG_TEXT: Record<
	string,
	{ label: string; tone: "warning" | "danger" | "info" }
> = {
	agent_bypass: {
		label: "approves an API wallet (trading becomes single-key)",
		tone: "warning",
	},
	destructive: { label: "reverts to a normal user", tone: "danger" },
	policy_change: { label: "changes the signer set", tone: "warning" },
	funds_out: { label: "moves funds out", tone: "warning" },
	evm_warning: { label: "touches HyperEVM", tone: "info" },
};

export function EnvelopeView({
	text,
	onChange,
	network,
	onSample,
	onHandOff,
}: {
	text: string;
	onChange: (v: string) => void;
	network: Network;
	onSample: (id: string) => void;
	/** Send a plain (non-multi-sig) action to the Signing Inspector. */
	onHandOff: () => void;
}) {
	const parsed = useMemo(
		() => parseEnvelopeText(text, network),
		[text, network],
	);
	return (
		<Workspace
			input={
				<>
					<Panel
						title="Envelope or proposal"
						description="Paste the exchange request body of a multiSig action (what the official UI and the SDKs send), a bare multiSig action, or a proposal document."
					>
						<Field
							label="JSON"
							htmlFor="ms-envelope"
							hint="Signatures are verified locally; nothing is sent anywhere except the signer-set lookup for the multi-sig user."
						>
							<TextArea
								id="ms-envelope"
								value={text}
								onChange={(e) => onChange(e.target.value)}
								rows={14}
								placeholder='{"action":{"type":"multiSig","signatureChainId":"0x66eee","signatures":[…],"payload":{"multiSigUser":"0x…","outerSigner":"0x…","action":{…}}},"nonce":…,"signature":{…}}'
								spellCheck={false}
								data-private
							/>
						</Field>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								size="sm"
								variant="outline"
								onClick={() => onSample("lab-envelope")}
							>
								Valid sample
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => onSample("lab-broken-envelope")}
							>
								Broken sample
							</Button>
							{text && (
								<Button size="sm" variant="ghost" onClick={() => onChange("")}>
									Clear
								</Button>
							)}
						</div>
					</Panel>
					<Callout tone="neutral" title="What is checked">
						Every inner signature is recovered and compared with the signer set
						the chain reports now; readiness follows the chain's rules (distinct
						authorized signers, leader, nonce window, expiry). When a signature
						does not match, the inspector tries the common divergences and names
						the one that fits.
					</Callout>
				</>
			}
			output={
				<EnvelopeOutput
					parsed={parsed}
					toggle={network}
					onSample={onSample}
					onHandOff={onHandOff}
				/>
			}
		/>
	);
}

function EnvelopeOutput({
	parsed,
	toggle,
	onSample,
	onHandOff,
}: {
	parsed: ParsedEnvelopeInput;
	toggle: Network;
	onSample: (id: string) => void;
	onHandOff: () => void;
}) {
	if (parsed.kind === "empty") {
		return (
			<EmptyState
				icon={FileSignature}
				title="Paste a multi-sig request to decode it"
				description="The action in plain words, each signature attributed to a signer, readiness against the live signer set, and a diagnosis for any signature that does not match."
				sample={MULTISIG_SAMPLES.find((s) => s.id === "lab-envelope")?.label}
				action={
					<Button
						size="sm"
						variant="outline"
						onClick={() => onSample("lab-envelope")}
					>
						Try with a sample
					</Button>
				}
			/>
		);
	}
	if (parsed.kind === "json-error") {
		return (
			<Callout tone="danger" title="The text is not valid JSON">
				{parsed.message}. Keys and strings need double quotes, and trailing
				commas are not allowed.
			</Callout>
		);
	}
	if (parsed.kind === "not-multisig") {
		return (
			<Callout tone="danger" title="Not a multi-sig envelope or proposal">
				<IssueList issues={parsed.issues} />
				<p className="mt-2">
					A plain action or signed request decodes in the Signing Inspector.
				</p>
				<Button
					size="sm"
					variant="outline"
					className="mt-2"
					onClick={onHandOff}
				>
					Open in Signing Inspector
				</Button>
			</Callout>
		);
	}
	return <JudgedProposal parsed={parsed} toggle={toggle} />;
}

/** The inspector's own wiring: judge the pasted proposal against the live signer set. */
function JudgedProposal({
	parsed,
	toggle,
}: {
	parsed: ProposalParsed;
	toggle: Network;
}) {
	const state = useJudgement(parsed);
	return <ProposalResult parsed={parsed} toggle={toggle} state={state} />;
}

/**
 * Everything known about one proposal: action, readiness, signatures, digests
 * and the canonical envelope. Presentational: the caller supplies the
 * judgement (`useJudgement`), so the Multisig Signer can gate its buttons on
 * the very result this panel displays.
 */
export function ProposalResult({
	parsed,
	toggle,
	state,
	envelopeChainId,
}: {
	parsed: ProposalParsed;
	/** The header network; a warning shows when the payload names another one. */
	toggle: Network;
	state: JudgementState;
	/**
	 * The EIP-712 chain the leader signs the envelope under, when the caller
	 * knows it. It is the leader's choice at submission and part of the envelope
	 * hash; without it the document's receipt decides, then the network default.
	 */
	envelopeChainId?: `0x${string}`;
}) {
	const { proposal, network } = parsed;
	const { judgement, policyQuery, other, otherQuery } = state;
	const setNetwork = useNetworkStore((st) => st.setNetwork);

	const coins = useCoinNames(network);
	const description = describeAction(proposal.payload.action, coins);
	const flags = proposalFlags(proposal);
	const chosenChainId = envelopeChainId ?? proposal.receipt?.signatureChainId;
	const request =
		parsed.request ??
		buildEnvelope(proposal, { signatureChainId: chosenChainId }).request;
	// a document that was never submitted does not say which chain its envelope will be signed under
	const envelopeAssumed = !parsed.request && !chosenChainId;
	const outer = envelopeDigest(request, network);
	const window = nonceWindow(proposal.payload.nonce);
	const receipt = proposal.receipt;
	const receiptExplained = receipt
		? explainExchangeError(receipt.response, receipt.httpStatus)
		: null;

	return (
		<div className="space-y-4">
			{parsed.networkFromInput ? (
				network !== toggle && (
					<Callout
						tone="warning"
						title={`This payload is for ${network}; the header says ${toggle}`}
					>
						The action's own fields name {network}, so signatures and the signer
						set are checked there. Switch the header to {network} to avoid
						confusion.
					</Callout>
				)
			) : (
				<Callout
					tone="info"
					title={`Checked on ${network} (from the header switch)`}
				>
					L1 payloads do not carry the network; it enters only through the
					signing domain. If every signature shows as "other-network", switch
					the header.
				</Callout>
			)}
			{otherQuery.data?.data && (
				<Callout
					tone="warning"
					title={`${proposal.payload.multiSigUser.slice(0, 10)}… is not a multi-sig user on ${network}, but it is on ${other}`}
					action={
						<Button
							size="sm"
							variant="outline"
							onClick={() => setNetwork(other)}
						>
							Switch to {other}
						</Button>
					}
				>
					A {otherQuery.data.data.threshold}-of-
					{otherQuery.data.data.authorizedUsers.length} signer set exists there.
					L1 payloads do not carry the network, so this envelope was probably
					made for {other}.
				</Callout>
			)}
			{parsed.issues.length > 0 && (
				<Panel title="Input notes">
					<IssueList issues={parsed.issues} />
				</Panel>
			)}

			<Panel
				title={
					<span className="flex items-center gap-2">
						Action <NetworkBadge network={network} />
					</span>
				}
				description={
					parsed.source === "document"
						? "From a proposal document."
						: "From a multiSig envelope."
				}
			>
				<p className="text-base font-medium">{description.headline}</p>
				{description.lines.length > 0 && (
					<ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
						{description.lines.map((l) => (
							<li key={l}>{l}</li>
						))}
					</ul>
				)}
				<div className="mt-3 flex flex-wrap gap-2">
					{flags.map((f) => (
						<Pill key={f} tone={FLAG_TEXT[f]?.tone ?? "info"}>
							{FLAG_TEXT[f]?.label ?? f}
						</Pill>
					))}
					{!description.known && (
						<Pill tone="unknown">unknown action type</Pill>
					)}
				</div>
				<KeyValueGrid
					className="mt-4"
					columns={2}
					items={[
						{
							label: "Multi-sig user",
							value: (
								<AddressLine
									address={proposal.payload.multiSigUser}
									network={network}
								/>
							),
						},
						{
							label: "Leader (outerSigner)",
							value: (
								<AddressLine
									address={proposal.payload.outerSigner}
									network={network}
								/>
							),
						},
						{
							label: "Nonce",
							value: `${proposal.payload.nonce} · ${new Date(proposal.payload.nonce).toISOString()}`,
							mono: true,
						},
						{
							label: "Submittable",
							value: `${new Date(window.validFrom).toISOString().slice(0, 16)} → ${new Date(window.validUntil).toISOString().slice(0, 16)} UTC`,
							mono: true,
						},
						{
							label: "Vault / sub-account",
							value: proposal.payload.vaultAddress ? (
								<AddressLine
									address={proposal.payload.vaultAddress}
									network={network}
								/>
							) : (
								"none"
							),
						},
						{
							label: "expiresAfter",
							value: proposal.payload.expiresAfter
								? new Date(proposal.payload.expiresAfter).toISOString()
								: "none",
							mono: true,
						},
					]}
				/>
				{proposal.meta.title && (
					<p className="mt-3 text-sm">
						<span className="text-muted-foreground">Title (unsigned): </span>
						{proposal.meta.title}
					</p>
				)}
			</Panel>

			<ReadinessPanel
				judgement={judgement}
				policyQuery={policyQuery}
				network={network}
				proposal={proposal}
				receipt={
					receiptExplained
						? { ...receiptExplained, at: receipt?.submittedAt ?? 0 }
						: null
				}
			/>

			<Panel
				title="Signatures"
				description="Each one recovered from the digest signers sign; the claimed signer is never trusted."
			>
				{!judgement ? (
					<div
						className="flex items-center gap-2 text-sm text-muted-foreground"
						aria-busy="true"
					>
						<Loader2 className="size-4 animate-spin" aria-hidden /> Recovering
						signers…
					</div>
				) : judgement.classified.length === 0 ? (
					<p className="text-sm text-muted-foreground">No signatures yet.</p>
				) : (
					<ol className="divide-y divide-border/60 rounded-md border border-border">
						{judgement.classified.map((c) => {
							const d = judgement.diagnoses[c.index];
							const divergent =
								d !== undefined &&
								d.cause !== "unknown" &&
								d.cause !== "matches";
							const tone =
								c.status === "valid-authorized"
									? "success"
									: divergent || c.status === "invalid"
										? "danger"
										: c.status === "duplicate"
											? "info"
											: "warning";
							const why =
								d && d.cause !== "unknown"
									? d.detail
									: c.issues.map((i) => i.message).join(" ") ||
										"Counts toward the threshold.";
							return (
								<li key={c.index} className="space-y-1 px-3 py-2 text-sm">
									<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
										<span className="font-mono text-xs text-muted-foreground">
											#{c.index + 1}
										</span>
										{c.recovered ? (
											<AddressLine
												label="recovers to"
												address={c.recovered}
												network={network}
											/>
										) : (
											<span className="text-muted-foreground">
												recovers to nothing
											</span>
										)}
										<Pill tone={tone}>
											{divergent ? "signed different bytes" : c.status}
										</Pill>
									</div>
									<p className="text-xs text-muted-foreground">{why}</p>
								</li>
							);
						})}
					</ol>
				)}
				{parsed.outerSignature && judgement && (
					<p className="mt-3 text-sm">
						<span className="text-muted-foreground">
							Envelope signature recovers to{" "}
						</span>
						{judgement.outerRecovered ? (
							<AddressLine
								address={judgement.outerRecovered}
								network={network}
								explorer={false}
							/>
						) : (
							"nothing"
						)}{" "}
						{judgement.outerRecovered === proposal.payload.outerSigner ? (
							<Pill tone="success">the leader</Pill>
						) : (
							<Pill tone="danger">not the leader</Pill>
						)}
					</p>
				)}
			</Panel>

			<Panel
				title="Digests"
				description={
					envelopeAssumed
						? `What signers sign (inner) and what the leader signs (envelope). The envelope values assume signatureChainId ${request.action.signatureChainId}; the leader may sign under another chain, which changes them.`
						: "What signers sign (inner) and what the leader signs (envelope)."
				}
			>
				<KeyValueGrid
					columns={1}
					items={[
						{
							label: "Inner digest (signed by each signer)",
							value: <Hash value={proposal.digest} />,
						},
						{
							label: "Envelope action hash (multiSigActionHash)",
							value: outer.actionHash ? <Hash value={outer.actionHash} /> : "—",
						},
						{
							label: "Envelope digest (signed by the leader)",
							value: outer.digest ? <Hash value={outer.digest} /> : "—",
						},
					]}
				/>
			</Panel>

			<Panel
				title="Canonical envelope"
				description="The request body in the key order and signature form the chain hashes."
			>
				<CodeBlock
					content={stringifyJson(
						fromPlain({
							action: canonicalEnvelopeAction(request),
							nonce: request.nonce,
							vaultAddress: request.vaultAddress,
							...(request.expiresAfter !== null
								? { expiresAfter: request.expiresAfter }
								: {}),
						}),
						2,
					)}
					lang="json"
					maxHeight="24rem"
				/>
			</Panel>
		</div>
	);
}

function Hash({ value }: { value: string }) {
	return (
		<span className="inline-flex min-w-0 items-center gap-1.5">
			<span className="min-w-0 break-all font-mono text-[12.5px]">{value}</span>
			<CopyButton value={value} size="xs" />
		</span>
	);
}

function ReadinessPanel({
	judgement,
	policyQuery,
	network,
	proposal,
	receipt,
}: {
	judgement: Judgement | null;
	policyQuery: PolicyQuery;
	network: Network;
	proposal: Proposal;
	receipt: { id: string; cause: string; message: string; at: number } | null;
}) {
	const r = judgement?.ready;
	const tone = !r
		? "neutral"
		: r.status === "ready"
			? "success"
			: r.status === "not-ready"
				? "warning"
				: r.status === "unknown"
					? "unknown"
					: "danger";
	return (
		<Panel
			title={
				<span className="flex items-center gap-2">
					Readiness <NetworkBadge network={network} />
				</span>
			}
		>
			{policyQuery.isPending ? (
				<div
					className="flex items-center gap-2 text-sm text-muted-foreground"
					aria-busy="true"
				>
					<Loader2 className="size-4 animate-spin" aria-hidden /> Fetching the
					signer set of {proposal.payload.multiSigUser.slice(0, 10)}… on{" "}
					{network}
				</div>
			) : policyQuery.isError ? (
				<Callout
					tone="danger"
					title="Could not fetch the signer set"
					action={
						<Button
							size="sm"
							variant="outline"
							onClick={() => policyQuery.refetch()}
						>
							Retry
						</Button>
					}
				>
					{String((policyQuery.error as Error).message)}
				</Callout>
			) : null}
			{r && (
				<div className="space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<Pill tone={tone}>{r.status}</Pill>
						<span className="text-sm">
							{r.status === "not-multisig"
								? `no signer set on ${network}; nothing can count`
								: r.need === null
									? `${r.have} valid signature${r.have === 1 ? "" : "s"}; signer set unknown`
									: `${r.have} of ${r.need} required signatures`}
						</span>
						{r.leader && (
							<Pill
								tone={
									r.leader === "authorized"
										? "success"
										: r.leader === "needs-lookup"
											? "warning"
											: "danger"
								}
							>
								leader {r.leader}
							</Pill>
						)}
					</div>
					{r.missing.length > 0 && r.status !== "ready" && (
						<p className="text-sm text-muted-foreground">
							Still able to sign:{" "}
							{r.missing.map((m) => m.slice(0, 10)).join(", ")}…
						</p>
					)}
					<IssueList issues={r.issues} empty="" />
					{receipt ? (
						<Callout
							tone={receipt.id === "ok" ? "success" : "danger"}
							title={`Submitted ${new Date(receipt.at).toISOString()} → ${receipt.id}`}
						>
							{receipt.id === "ok"
								? "The chain accepted this proposal."
								: `${receipt.message} — ${receipt.cause}`}
						</Callout>
					) : null}
					{policyQuery.data && (
						<ObservedLine
							network={policyQuery.data.network}
							observedAt={policyQuery.data.observedAt}
							source={
								judgement?.policy
									? `${judgement.policy.threshold}-of-${judgement.policy.authorizedUsers.length} signer set`
									: "not a multi-sig user"
							}
						/>
					)}
				</div>
			)}
		</Panel>
	);
}
