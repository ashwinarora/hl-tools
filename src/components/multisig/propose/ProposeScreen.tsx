import {
	type Address,
	createProposal,
	describeAction,
	fromPlain,
	type Issue,
	infoClient,
	type Network,
	ORDERED_ACTION_TYPES,
	orderFloor,
	otherStep,
	type Proposal,
	type ProposalPayload,
	prepareInnerAction,
	signProposal,
	stringifyJson,
	tieSteps,
	ZERO_ADDRESS,
} from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileSignature, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useNetworkHydrated } from "#/store/networkStore";
import { useReceiver } from "../live/useReceiver";
import { useSignerChecks } from "../live/useSignerChecks";
import { useStaking } from "../live/useStaking";
import { useVault, useVaultDetails, useVaults } from "../live/useVaults";
import {
	ACTION_KINDS,
	type ActionForm,
	type ActionKind,
	actionTypeOf,
	buildProposalInputs,
	DEFAULT_FORM,
	destinationOf,
	fieldOf,
	formFromProposal,
	sourcePocket,
} from "../model/actions";
import { type InnerChain, innerChain } from "../model/chains";
import {
	DRAFT_COPY,
	draftKey,
	formWorthKeeping,
	proposeDraftFor,
} from "../model/drafts";
import { loadProposal, saveProposal } from "../model/history";
import {
	DATED_AHEAD,
	describeWindow,
	type NonceMode,
	NUMBERED_AFTER,
	proposalNonce,
} from "../model/nonce";
import { RELAY_COPY } from "../model/relay/copy";
import { reproposeSource } from "../model/repropose";
import { isItself } from "../model/selfTreasury";
import { costLine, spotAvailable } from "../model/send";
import { toLookUp, waitingProposals, wantedSet } from "../model/signerSet";
import {
	CODE_COPY,
	signingChainOf,
	signingNetwork,
} from "../model/signingNetwork";
import { isStakingKind, planStaking, STAKING } from "../model/staking";
import { linkTransport } from "../model/transport";
import { isVaultKind, planVault, VAULT, type VaultRead } from "../model/vault";
import { TreasuryNames, useNames } from "../names/Names";
import { Sentence } from "../names/Sentence";
import { CodePanel } from "../proposal/CodePanel";
import { shareMove } from "../relay/api";
import { useTreasuries } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { Help } from "../shell/Help";
import { NetTag, SignsTag, backLink as shellBack } from "../shell/kit";
import { useNow } from "../shell/live";
import { ShellPage } from "../shell/ShellPage";
import { SwitchToSigner } from "../shell/SwitchToSigner";
import { useDraft } from "../shell/useDraft";
import { usePageNetwork } from "../shell/usePageNetwork";
import { TreasuryStrip } from "../TreasuryStrip";
import { useKnownProposals } from "../treasury/useKnownProposals";
import { useTreasuryNames } from "../treasuryName";
import { useLiveTreasuryState } from "../useTreasuryState";
import { useWalletSigner } from "../useWalletSigner";
import { ActionFields } from "./ActionFields";
import { ChangeSignersFields } from "./ChangeSignersFields";
import { StakingFields } from "./StakingFields";
import { VaultFields } from "./VaultFields";

/** Warnings said under the field they are about, not with the general notes. */
const FIELD_NOTES: ReadonlySet<string> = new Set([
	"address.checksum",
	"address.zero",
	"action.self_send",
	"withdraw.own_address",
	"agent.in_use",
]);

/** Shown only once the user has tried to create: an untouched form is not an error. */
const REQUIRED = new Set(["field.required", "finaliser.required"]);

const backLink =
	"inline-flex h-8 items-center rounded-md border border-border-strong bg-surface px-3 text-sm hover:bg-surface-2";

/**
 * The propose page. Its link names its network, so a reload shows the same
 * treasury whatever another tab did to the header in the meantime (see
 * `model/pageNetwork`). The form below is keyed by network and treasury:
 * another network is another proposal, and nothing typed or pre-filled is
 * carried across.
 */
export function ProposeScreen(props: {
	treasury?: string;
	supersedes?: string;
	/** The kind of action the form opens on, when a link asks for one. */
	kind?: string;
	/** For Remove API wallet: the wallet's name ("" is the one without a name). */
	agent?: string;
	/** The network in the link; a link without one takes the header's and is rewritten. */
	network?: string;
}) {
	const navigate = useNavigate();
	const page = usePageNetwork(props.network, (network) => {
		void navigate({
			to: "/multisig/propose",
			search: (s) => ({ ...s, network }),
			replace: true,
		});
	});
	return (
		<ProposeForm
			// a link that asks for another kind, or to re-propose another proposal,
			// starts a new form: the form on screen is always the one the link names
			// (and for a removal, another wallet: "remove A" then "remove B")
			key={`${page.network}:${props.treasury ?? ""}:${props.kind ?? ""}:${props.supersedes ?? ""}:${props.agent === undefined ? "" : `agent=${props.agent}`}`}
			treasury={props.treasury}
			supersedes={props.supersedes}
			kind={props.kind}
			agent={props.agent}
			network={page.network}
		/>
	);
}

/** The form a link opens: empty, or on the kind (and the API wallet) it asks for. */
function formForLink(kind?: string, agent?: string): ActionForm {
	// the Signers card's "Convert back" opens the same form on that choice
	if (kind === "convertBack")
		return { ...DEFAULT_FORM, kind: "changeSigners", signers: "null" };
	const asked = ACTION_KINDS.find((k) => k.kind === kind)?.kind;
	// the Overview's "Remove" names the wallet; without a name there is one to choose
	if (asked === "removeAgent")
		return { ...DEFAULT_FORM, kind: asked, removeAgent: agent ?? null };
	return asked ? { ...DEFAULT_FORM, kind: asked } : DEFAULT_FORM;
}

/**
 * Build a proposal for one treasury on one network: the action, who
 * finalises it, the chain signers sign under and how long they have. The
 * proposer can sign on the spot. Nothing is sent to Hyperliquid here.
 */
function ProposeForm({
	treasury,
	supersedes,
	kind,
	agent,
	network,
}: {
	treasury?: string;
	supersedes?: string;
	kind?: string;
	agent?: string;
	network: Network;
}) {
	const hydrated = useNetworkHydrated();
	const navigate = useNavigate();
	const client = useQueryClient();
	const wallet = useWalletSigner();
	const [form, setForm] = useState<ActionForm>(() => formForLink(kind, agent));
	const [attempted, setAttempted] = useState(false);
	const [failure, setFailure] = useState<{
		title: string;
		issues: readonly Issue[];
	} | null>(null);
	// The preview hashes with a nonce taken when the page opened; the real one is taken on create.
	const [previewNow] = useState(() => Date.now());
	const [superseded, setSuperseded] = useState<Proposal | null>(null);
	// why a proposal named in the link was not used as the starting point
	const [notCopied, setNotCopied] = useState<string | null>(null);
	// "Create and sign" found the wallet without the signing network a vault action needs
	const [needsNetwork, setNeedsNetwork] = useState(false);
	const [addFailed, setAddFailed] = useState<string | null>(null);
	// the vault steps being signed right now, for the code each wallet prompt shows
	const [signingCodes, setSigningCodes] = useState<readonly ProposalPayload[]>(
		[],
	);

	const address =
		treasury && ADDRESS_RE.test(treasury)
			? (treasury.toLowerCase() as `0x${string}`)
			: null;

	// ---- what was filled in here before, kept in this browser (model/drafts.ts)
	const kept = useDraft(address ? draftKey("propose", network, address) : null);
	const [restoredAt, setRestoredAt] = useState<number | null>(null);
	// the form as of the last change, for a setter called twice in one tick
	const latest = useRef(form);
	useEffect(() => {
		latest.current = form;
	}, [form]);
	const touched = useRef(false);
	const restoreTried = useRef(false);
	// Once the stored drafts are read: put this treasury's back, unless the
	// link asks for something else or something was typed in the meantime.
	useEffect(() => {
		if (!kept.hydrated || restoreTried.current) return;
		restoreTried.current = true;
		if (touched.current) return;
		const stored = proposeDraftFor(kept.stored, { kind, supersedes, agent });
		if (!stored) return;
		setForm(stored.form);
		setRestoredAt(stored.at);
	}, [kept.hydrated, kept.stored, kind, supersedes, agent]);

	const set = <K extends keyof ActionForm>(key: K, value: ActionForm[K]) => {
		touched.current = true;
		const next = { ...latest.current, [key]: value };
		latest.current = next;
		setForm((f) => ({ ...f, [key]: value }));
		// Written from the setter, a moment after typing stops, never from an
		// effect on the form: the wallet and the stored values arrive late, and
		// an effect would write the empty form over the draft.
		kept.save(formWorthKeeping(next) ? { form: next } : null);
	};
	const clearDraft = () => {
		kept.clear();
		touched.current = false;
		setRestoredAt(null);
		setForm(formForLink(kind, agent));
	};
	const target = useMemo<AccountTarget | null>(
		() => (hydrated && address ? { address, network } : null),
		[hydrated, address, network],
	);
	const state = useLiveTreasuryState(target);

	// Re-proposing: start from the action, finaliser and label of the proposal being replaced.
	useEffect(() => {
		// not before the stored network is restored: until then a link without a
		// network still shows the default one, and the source would be judged against that
		if (!supersedes || !hydrated) return;
		let cancelled = false;
		void loadProposal(supersedes)
			.then((r) => {
				const old = r.proposal;
				if (cancelled || !old || !address) return;
				// only ever from the same treasury on the same network
				const source = reproposeSource(old, network, address);
				if (!source.ok) {
					setNotCopied(source.text);
					return;
				}
				setSuperseded(old);
				const fill = (fields: Partial<ActionForm>) =>
					setForm((f) => ({
						...f,
						...fields,
						finaliser: old.payload.outerSigner,
						title: old.meta.title ?? "",
						note: old.meta.note ?? "",
					}));
				// one step of a move: from its first step the form names the whole
				// move, where the other step is in this browser too; from its
				// second, only that step (`formFromProposal`)
				const other = otherStep(old);
				if (!other) {
					fill(formFromProposal(old, null));
					return;
				}
				return loadProposal(other).then((o) => {
					if (cancelled) return;
					fill(formFromProposal(old, o.proposal));
				});
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [supersedes, hydrated, network, address]);

	const universe = useQuery({
		queryKey: ["universe", network],
		queryFn: () => infoClient(network).universe(),
		staleTime: 5 * 60_000,
		retry: 1,
		// both sends name their token by its id
		enabled:
			hydrated && (form.kind === "sendUsdc" || form.kind === "sendToken"),
	});

	// Hyperliquid carries out an account's sends and withdrawals only in the
	// order of their numbers, so a new one is numbered after every one on record
	// (one dated ahead yesterday is still ahead of the clock today).
	const actionType = actionTypeOf(form);
	const ordered =
		actionType !== null && ORDERED_ACTION_TYPES.includes(actionType);
	const known = useKnownProposals(
		network,
		(address ?? ZERO_ADDRESS) as Address,
		// a change of signers, and a switch of mode, say which waiting proposals they touch
		hydrated &&
			!!address &&
			(ordered || form.kind === "changeSigners" || form.kind === "accountMode"),
	);
	const floor =
		ordered && actionType ? orderFloor(actionType, known.proposals) : null;
	const orderUnknown = ordered && known.state === "loading";

	// Who is being paid: new to Hyperliquid (the first send costs 1 USDC) or in
	// use, and which of its balances the money lands in.
	const lookup = useReceiver(network, hydrated ? destinationOf(form) : null);

	// An API wallet approval: is the address named already in use on Hyperliquid?
	const agentTyped = form.agentAddress.trim().toLowerCase();
	const agentLookup = useReceiver(
		network,
		hydrated && form.kind === "approveAgent" && ADDRESS_RE.test(agentTyped)
			? agentTyped
			: null,
	);

	// A change of signers: what Hyperliquid says about the addresses that would
	// be new, asked once each (the signers of now are signers already).
	const wantedSigners = useMemo(
		() =>
			form.kind === "changeSigners" && address && state.policy
				? toLookUp(
						wantedSet(form.signers, state.policy).entries,
						address,
						state.policy.authorizedUsers,
					)
				: NO_SIGNERS,
		[form.kind, form.signers, address, state.policy],
	);
	const signerLookups = useSignerChecks(network, wantedSigners);

	// Staking: what the treasury has in staking and the validators, read only
	// while one of the staking forms is open.
	const stakingOn = isStakingKind(form.kind);
	const now = useNow();
	const spotHype = spotAvailable(state.spot, "HYPE");
	const staking = useStaking(
		stakingOn ? target : null,
		{ stakes: true, validators: true },
		spotHype,
	);
	const stakingRead = stakingOn
		? {
				summary: staking.summary,
				delegations: staking.delegations,
				validators: staking.validators,
				spotAvailable: spotHype,
			}
		: undefined;
	const stakingPlan = isStakingKind(form.kind)
		? planStaking(
				{
					kind: form.kind,
					amount: form.amount,
					validator: form.validator,
					toValidator: form.toValidator,
				},
				stakingRead,
				network,
				now,
			)
		: null;

	// Vaults: the treasury's deposits and the vault the form names, read only
	// while one of the two vault forms is open.
	const vaultOn = isVaultKind(form.kind);
	const vaults = useVaults(vaultOn ? target : null);
	const vaultTyped = form.vault.trim().toLowerCase();
	const vaultAsked =
		vaultOn && hydrated && ADDRESS_RE.test(vaultTyped) ? vaultTyped : null;
	const vaultLookup = useVault(network, vaultAsked, address);
	// the names of the vaults the treasury has money in, for the list to pick from
	const vaultDetails = useVaultDetails(
		network,
		vaultOn && form.kind === "vaultWithdraw"
			? (vaults.deposits?.map((d) => d.vault) ?? [])
			: [],
		address,
	);
	const vaultNames = useMemo(() => {
		const names = new Map<string, string>();
		for (const [vault, l] of vaultDetails)
			if (l.kind === "vault") names.set(vault, l.vault.name);
		return names;
	}, [vaultDetails]);
	const vaultRead: VaultRead | undefined = vaultOn
		? {
				// undefined while it is on its way; null once the read has failed
				mode: !hydrated || state.modePending ? undefined : state.mode,
				perps: state.perp?.withdrawable ?? null,
				spot: spotAvailable(state.spot, "USDC"),
				deposits: vaults.deposits,
				vault: vaultLookup.lookup,
			}
		: undefined;
	const vaultPlan =
		isVaultKind(form.kind) && vaultRead
			? planVault(
					{ kind: form.kind, amount: form.amount, vault: form.vault },
					vaultRead,
					network,
					now,
				)
			: null;

	const chain = innerChain(network, form.chain);
	const context = (nonce: number) => ({
		network,
		multiSigUser: address ?? "",
		nonce,
		signatureChainId: chain.hex,
		tokens: universe.data?.tokens,
		balances: {
			perpWithdrawable: state.perp?.withdrawable,
			spot: state.spot ?? undefined,
		},
		// absent while it is on its way; null once the read has failed
		mode: !hydrated || state.modePending ? undefined : state.mode,
		receiver: lookup.receiver,
		agent: agentLookup.receiver,
		// absent while they are on their way; null once the read has failed
		agents: state.agents ?? (state.agentsError ? null : undefined),
		// what a switch back to a manual account is refused for
		open: {
			positions: state.live.perp?.positions.length ?? null,
			orders: state.live.openOrders?.length ?? null,
		},
		waiting:
			form.kind === "accountMode"
				? waitingProposals(known.proposals, now).map((k) => ({
						action: k.action,
						title: k.title,
					}))
				: undefined,
		signerChecks: signerLookups.checks,
		createdBy: wallet.address,
		supersedes: superseded?.digest ?? null,
		policyAtCreation: state.policy,
		staking: stakingRead,
		vault: vaultRead,
		now,
	});
	const numbered = proposalNonce(form.nonceMode, previewNow, floor);
	const previewNonce = numbered.nonce;
	// one proposal, or the two steps of a staking move
	const drafts = buildProposalInputs(form, context(previewNonce));
	const draft = {
		input: drafts.inputs?.[0] ?? null,
		action: drafts.actions[0] ?? null,
		sketch: drafts.sketch,
		issues: drafts.issues,
	};
	const previews = drafts.inputs?.map((input) =>
		createProposal(input, { now: previewNow }),
	);
	// The canonical action and its risk flags do not depend on the finaliser, so show them
	// as soon as the action itself builds.
	const prepared = draft.action
		? prepareInnerAction(draft.action, network, previewNonce)
		: null;
	const second = drafts.actions[1]
		? prepareInnerAction(drafts.actions[1], network, previewNonce + 1)
		: null;
	const issues = [
		...draft.issues,
		...(previews
			? previews.flatMap((p) => p.issues)
			: [...(prepared?.issues ?? []), ...(second?.issues ?? [])]),
	].filter(
		// the same note about both steps is said once
		(i, n, all) =>
			all.findIndex((x) => x.code === i.code && x.message === i.message) === n,
	);
	const error = (field: keyof ActionForm) =>
		issues.find(
			(i) =>
				i.severity === "error" &&
				fieldOf(i) === field &&
				(attempted || !REQUIRED.has(i.code)),
		)?.message;
	// warnings about an address as it was typed stand under its field, where the typo is
	const notes = (field: keyof ActionForm) =>
		issues
			.filter(
				(i) =>
					i.severity === "warning" &&
					FIELD_NOTES.has(i.code) &&
					fieldOf(i) === field,
			)
			.map((i) => i.message);
	// what stops Create, in the form's own sentences
	const blockers = [
		...new Set(
			issues.filter((i) => i.severity === "error").map((i) => i.message),
		),
	];
	// a staking form says its own amber lines, next to the steps they are about
	const saidByForm = new Set(
		[...(stakingPlan?.issues ?? []), ...(vaultPlan?.issues ?? [])]
			.filter((i) => i.severity === "warning")
			.map((i) => i.code),
	);
	const otherIssues = issues.filter(
		(i) =>
			(i.severity !== "error" || fieldOf(i) === null) &&
			!FIELD_NOTES.has(i.code) &&
			!saidByForm.has(i.code),
	);
	const action = prepared?.action ?? null;
	const described = action ? describeAction(action, { network }) : null;
	const secondAction = second?.action ?? null;
	const twoSteps = drafts.actions.length === 2;
	const secondDescribed = secondAction
		? describeAction(secondAction, { network })
		: null;
	const flags = prepared?.flags ?? [];
	const unified = state.mode?.kind === "unified";
	const movable = {
		perps: state.perp?.withdrawable ?? null,
		spotUsdc: spotAvailable(state.spot, "USDC"),
	};
	const cost =
		// To the treasury itself, or to the zero address, there is no receiver to
		// describe: the note under the field says what it is.
		lookup.state === "idle" ||
		destinationOf(form) === address ||
		destinationOf(form) === ZERO_ADDRESS
			? null
			: costLine({
					action: draft.sketch,
					receiver: lookup.state === "loading" ? "loading" : lookup.receiver,
					mode: state.mode,
					perpsUsdc: movable.perps,
					spot: state.spot,
				});
	// a unified treasury has one balance: nothing to move between perps and spot
	// a vault action is signed as a code: without the signing network this copy cannot sign one
	const canSignCodes = signingNetwork() !== null;
	const kinds = ACTION_KINDS.filter(
		(k) =>
			!(unified && k.kind === "usdClassTransfer") &&
			!(k.group === "vault" && !canSignCodes),
	);
	// the three staking forms are one entry here, and so are the two vault
	// forms; the choice between them is inside
	const choices = kinds.flatMap((k) =>
		k.group === "staking"
			? k.kind === "stake"
				? [{ value: "staking", label: STAKING.label }]
				: []
			: k.group === "vault"
				? k.kind === "vaultDeposit"
					? [{ value: "vault", label: VAULT.label }]
					: []
				: [{ value: k.kind as string, label: k.label }],
	);
	const window = describeWindow(previewNonce, previewNow);

	// With the relay in use and this wallet in its copy of the signer list, a new
	// proposal is shared as it is created.
	const relay = useRelay();
	const { rows: listed } = useTreasuries();
	const nameOf = useTreasuryNames();
	const inList = listed.some(
		(t) => t.network === network && t.address === address,
	);
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
	// the wallet is the treasury account itself: it can draft, never sign
	const itself = ready && isItself(me, address);

	// One proposal per press: a second click before the first has finished
	// (a double click, a stuck button) would otherwise make a second proposal.
	const creating = useRef(false);
	const [busyCreating, setBusyCreating] = useState(false);
	const create = async (sign: boolean) => {
		if (creating.current) return;
		creating.current = true;
		setBusyCreating(true);
		try {
			await createOnce(sign);
		} finally {
			creating.current = false;
			setBusyCreating(false);
		}
	};
	const createOnce = async (sign: boolean) => {
		setAttempted(true);
		setFailure(null);
		setSigningCodes([]);
		const now = Date.now();
		const fresh = buildProposalInputs(
			form,
			context(proposalNonce(form.nonceMode, now, floor).nonce),
		);
		if (!fresh.inputs) return;
		const created = fresh.inputs.map((input) => createProposal(input, { now }));
		const made = created.flatMap((c) => (c.proposal ? [c.proposal] : []));
		if (made.length !== created.length) {
			setFailure({
				title: "The proposal could not be created",
				issues: created.flatMap((c) => c.issues),
			});
			return;
		}
		// the two steps of a move name each other, so every page shows them as one
		const [one, two] = made;
		let proposals: Proposal[] = one && two ? [...tieSteps(one, two)] : made;
		if (sign) {
			setNeedsNetwork(false);
			// A vault step is signed as a code, and its number is fixed only now:
			// the code goes on the page before the wallet is asked, to compare.
			setSigningCodes(
				proposals.filter((p) => p.meta.kind === "l1").map((p) => p.payload),
			);
			// one wallet prompt for each step; nothing is created unless all are signed
			const signedAll: Proposal[] = [];
			for (const proposal of proposals) {
				// Each step under its own network: a readable action under the
				// chain it names, a vault action (a code) under the signing network.
				const under = signingChainOf(proposal.payload.action)?.hex ?? chain.hex;
				const got = await wallet.signerFor(under);
				if (!got.ok) {
					// not a failure: the wallet has to be given the signing network first
					if (got.needsNetwork) setNeedsNetwork(true);
					else
						setFailure({
							title: "The wallet did not sign",
							issues: [
								{ code: "wallet", severity: "error", message: got.error },
							],
						});
					return;
				}
				const signed = await signProposal(proposal, got.signer, {
					expectedSigner: wallet.address ?? undefined,
				});
				if (!signed.signature) {
					setFailure({
						title: "The wallet did not sign",
						issues: signed.issues,
					});
					return;
				}
				signedAll.push({ ...proposal, signatures: [signed.signature] });
			}
			proposals = signedAll;
		}
		const first = proposals[0];
		if (!first) return;
		try {
			const saved: Proposal[] = [];
			for (const proposal of proposals)
				saved.push((await saveProposal(proposal)).proposal);
			// it is a proposal now: nothing half-filled is left to keep
			kept.clear();
			await client.invalidateQueries({ queryKey: ["multisig-proposals"] });
			// Signed in and listed as a signer on the relay: co-signers see it at once.
			// A relay failure does not undo the proposal; its page says "only in this
			// browser" and offers to share it again.
			if (sharing && relay.client && relay.wallet) {
				// both steps of a move in one write: the relay takes both or neither
				await shareMove(relay.client, relay.wallet, saved);
				void client.invalidateQueries({ queryKey: ["relay", relay.wallet] });
			}
			void navigate({
				to: "/multisig/proposal",
				search: { digest: (saved[0] ?? first).digest },
			});
		} catch (e) {
			// No history in this browser: carry the document to the proposal page in the link itself.
			const url = linkTransport(() => globalThis.location.origin).publish(
				first,
				proposals.slice(1),
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
		<TreasuryNames
			network={network}
			treasury={(address ?? ZERO) as Address}
			signers={state.policy?.authorizedUsers ?? NO_SIGNERS}
		>
			<ShellPage
				title="Propose an action"
				back={
					inList ? (
						<Link
							to="/multisig/t/$network/$address"
							params={{ network, address }}
							className={shellBack}
						>
							◂ {nameOf(network, address as Address)}
						</Link>
					) : (
						<Link to="/multisig/open" className={shellBack}>
							◂ Open or start
						</Link>
					)
				}
				meta={
					<>
						<span className={inList ? undefined : "font-mono"} title={address}>
							{inList ? nameOf(network, address as Address) : short(address)}
						</span>
						{hydrated && <NetTag network={network} />}
						{state.policy && state.policy.authorizedUsers.length > 0 && (
							<span>
								{state.policy.threshold} of{" "}
								{state.policy.authorizedUsers.length} signers
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
							{notCopied && (
								<Callout tone="warning" title="Not re-proposing">
									{notCopied}
								</Callout>
							)}
							{superseded && (
								<Callout tone="info" title="Re-proposing">
									Started from the proposal {short(superseded.digest)}. This is
									a new proposal with a new nonce: signatures do not carry over.
								</Callout>
							)}
							<Panel
								title="Action"
								description={
									stakingOn
										? "HYPE between spot, the staking balance and a validator."
										: vaultOn
											? "USDC into a vault, or back out of one."
											: ACTION_KINDS.find((k) => k.kind === form.kind)
													?.description
								}
							>
								<div className="space-y-4">
									{restoredAt !== null && (
										<p
											data-draft
											className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-xs text-muted-foreground"
										>
											<span>{DRAFT_COPY.restored(restoredAt, now)}</span>
											<button
												type="button"
												onClick={clearDraft}
												className="font-medium text-foreground underline underline-offset-2"
											>
												{DRAFT_COPY.clear}
											</button>
										</p>
									)}
									<Segmented<string>
										label="Action"
										value={
											stakingOn ? "staking" : vaultOn ? "vault" : form.kind
										}
										onChange={(v) =>
											set(
												"kind",
												v === "staking"
													? "stake"
													: v === "vault"
														? "vaultDeposit"
														: (v as ActionKind),
											)
										}
										options={choices}
									/>
									{vaultOn && vaultPlan ? (
										<VaultFields
											form={form}
											set={set}
											error={error}
											network={network}
											vaults={vaults}
											lookup={vaultLookup.lookup}
											lookupLoading={vaultLookup.loading}
											names={vaultNames}
											movable={movable}
											unified={unified}
											plan={vaultPlan}
											now={now}
										/>
									) : stakingPlan ? (
										<StakingFields
											form={form}
											set={set}
											error={error}
											network={network}
											staking={staking}
											spotAvailable={spotHype}
											plan={stakingPlan}
											now={now}
										/>
									) : form.kind === "changeSigners" ? (
										<ChangeSignersFields
											signers={form.signers}
											onChange={(v) => set("signers", v)}
											current={state.policy}
											treasury={address as Address}
											checks={signerLookups.checks}
											recheck={signerLookups.recheck}
											me={me}
											finaliser={form.finaliser}
											known={known.proposals}
											knownState={known.state}
											relayInUse={relay.mode === "on"}
											agents={state.agents}
										/>
									) : (
										<ActionFields
											form={form}
											set={set}
											error={error}
											notes={notes}
											network={network}
											tokens={universe.data?.tokens ?? null}
											held={
												state.spot
													?.filter((b) => Number(b.total) !== 0)
													.map((b) => b.token)
													.filter((t): t is number => t !== null) ?? []
											}
											tokensLoading={universe.isFetching}
											mode={state.mode}
											receiver={lookup.receiver}
											cost={cost}
											from={sourcePocket(form, context(previewNonce))}
											movable={movable}
											agents={state.agents}
											agentsFailed={!!state.agentsError}
											now={now}
										/>
									)}
								</div>
							</Panel>
							<Panel
								title="Signing"
								description="Fixed when the proposal is created: every signer signs exactly this."
							>
								<div className="space-y-4">
									<Field
										label="Who finalises this?"
										trailing={<Help k="finaliser" />}
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
											<SignerOptions
												signers={state.policy?.authorizedUsers ?? NO_SIGNERS}
												me={me}
											/>
										</Select>
									</Field>
									<Field
										label="Signers sign under"
										trailing={<Help k="signingChain" />}
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
										trailing={<Help k="signingWindow" />}
										// the moment in the reader's own time, like everywhere in the section
										hint={
											<>
												If created now: <Sentence parts={window.parts} />. After
												that the chain rejects it and it must be re-proposed.
												{numbered.raised ? ` ${NUMBERED_AFTER}` : ""}
												{actionType === "usdSend" &&
												form.nonceMode === "extended"
													? ` ${DATED_AHEAD}`
													: ""}
											</>
										}
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
								{action && described ? (
									<div className="space-y-4">
										<div>
											{secondDescribed && (
												<p className="mb-1 text-xs text-muted-foreground">
													Two proposals, signed together and sent one after the
													other. Step 1:
												</p>
											)}
											<p className="text-base font-medium [overflow-wrap:anywhere]">
												{described.headline}
											</p>
											{described.lines.length > 0 && (
												// what the proposal's page will say under the headline:
												// which balance it leaves, where it arrives
												<ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">
													{described.lines.map((line) => (
														<li key={line} className="[overflow-wrap:anywhere]">
															{line}
														</li>
													))}
												</ul>
											)}
											{secondDescribed && (
												<>
													<p className="mt-3 mb-1 text-xs text-muted-foreground">
														Step 2:
													</p>
													<p className="text-base font-medium [overflow-wrap:anywhere]">
														{secondDescribed.headline}
													</p>
													<ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">
														{secondDescribed.lines.map((line) => (
															<li
																key={line}
																className="[overflow-wrap:anywhere]"
															>
																{line}
															</li>
														))}
													</ul>
												</>
											)}
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
												{
													label: "Signing window",
													value: <Sentence parts={window.parts} />,
												},
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
										<IssueList plain issues={otherIssues} />
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
									{secondAction && (
										<div className="mt-3">
											<p className="mb-1.5 text-xs text-muted-foreground">
												Step 2, a proposal of its own:
											</p>
											<CodeBlock
												content={stringifyJson(fromPlain(secondAction), 2)}
												lang="json"
												maxHeight="18rem"
											/>
										</div>
									)}
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
													: relay.mode === "signed-out"
														? RELAY_COPY.notSignedInLocal
														: relay.mode === "unreachable"
															? RELAY_COPY.unreachableLocal
															: ""}
										</p>
									)}
									<div className="flex flex-wrap items-center gap-2">
										<Button
											variant="brand"
											disabled={
												!ready ||
												!iAmSigner ||
												wallet.busy ||
												orderUnknown ||
												busyCreating
											}
											onClick={() =>
												void wallet.run("Waiting for the wallet…", () =>
													create(true),
												)
											}
										>
											{wallet.address
												? `Create ${twoSteps ? "both " : ""}and sign as ${short(wallet.address)}`
												: `Create ${twoSteps ? "both " : ""}and sign`}
										</Button>
										<Button
											variant="outline"
											disabled={
												!ready || wallet.busy || orderUnknown || busyCreating
											}
											onClick={() => void create(false)}
										>
											{twoSteps
												? "Create both without signing"
												: "Create without signing"}
										</Button>
									</div>
									{twoSteps && (
										<p className="text-xs text-muted-foreground">
											Signing asks your wallet twice, once for each step.
										</p>
									)}
									{signingCodes.map((payload) => (
										<CodePanel key={payload.nonce} payload={payload} />
									))}
									{needsNetwork && (
										<div
											data-needs-network
											className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[13px]"
										>
											<p className="flex flex-wrap items-center gap-1 text-warning">
												<span>{CODE_COPY.missing}</span>
												<Help k="signingNetwork" />
											</p>
											<p className="mt-1 text-muted-foreground">
												Nothing was created. Add the network, then create and
												sign again.
											</p>
											<div className="mt-2 flex flex-wrap items-center gap-2">
												<Button
													variant="brand"
													disabled={wallet.busy}
													onClick={() =>
														void wallet.run(
															"Waiting for the wallet…",
															async () => {
																setAddFailed(null);
																const added = await wallet.addSigningNetwork();
																if (added.ok) setNeedsNetwork(false);
																else setAddFailed(added.error);
															},
														)
													}
												>
													{wallet.busy ? CODE_COPY.adding : CODE_COPY.add}
												</Button>
											</div>
											{addFailed && (
												<p className="mt-2 text-danger">{addFailed}</p>
											)}
										</div>
									)}
									{itself ? (
										<SwitchToSigner
											signers={state.policy?.authorizedUsers ?? NO_SIGNERS}
											className="text-xs"
										/>
									) : ready && !iAmSigner ? (
										<p className="text-xs text-muted-foreground">
											{wallet.address
												? `${short(wallet.address)} is not in the signer set, so it can draft a proposal but not sign it.`
												: "Connect a signer's wallet to sign on the spot, or create the proposal unsigned and pass it on."}
										</p>
									) : null}
									{attempted && !draft.input && (
										<Callout tone="danger" title="Not created yet">
											{blockers.length === 1
												? blockers[0]
												: "Fix the marked fields first."}
										</Callout>
									)}
									{failure && (
										<Callout tone="danger" title={failure.title}>
											<IssueList plain issues={failure.issues} />
										</Callout>
									)}
								</div>
							</Panel>
						</>
					}
				/>
			</ShellPage>
		</TreasuryNames>
	);
}

const NO_SIGNERS: readonly Address[] = [];
const ZERO = "0x0000000000000000000000000000000000000000";

/** The treasury's signers as choices: nickname first where there is one, always with the address. */
function SignerOptions({
	signers,
	me,
}: {
	signers: readonly Address[];
	me: string | null;
}) {
	const names = useNames();
	return (
		<>
			{signers.map((a) => {
				const nick = names?.of(a)?.name;
				return (
					<option key={a} value={a}>
						{nick ? `${nick} · ` : ""}
						{a}
						{a === me ? " (you)" : ""}
					</option>
				);
			})}
		</>
	);
}
