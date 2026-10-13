import type { Address, Issue, Move, Proposal } from "@hl-tools/core";
import { cutTo } from "@hl-tools/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { Callout, IssueList, type Tone } from "#/components/hub/status";
import type { AccountTarget } from "#/components/tools/multisig/model";
import { useNetwork } from "#/store/networkStore";
import { refreshStaking } from "../live/useStaking";
import { refreshVaults } from "../live/useVaults";
import { explorerTxUrl } from "../model/chain/columns";
import {
	deriveMoveStage,
	leftOpenNote,
	type MovePhase,
	moveSentence,
} from "../model/move";
import { refusalNote } from "../model/refusal";
import { RELAY_COPY, signHint } from "../model/relay/copy";
import { relayActions } from "../model/relay/status";
import { type Phase, shortAddress } from "../model/stage";
import { actionLine } from "../model/staking";
import { untilWords } from "../model/time";
import { TreasuryNames, Who } from "../names/Names";
import { Sentence } from "../names/Sentence";
import {
	addObjections,
	type ProposalKey,
	type Result,
	removeObjections,
	removeSignatures,
	withdrawMove,
} from "../relay/api";
import type { RelayClient } from "../relay/client";
import { useTreasuries } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { Help } from "../shell/Help";
import {
	Btn,
	backLink,
	Card,
	linkButtonSm,
	NetTag,
	SignsTag,
	Tag,
} from "../shell/kit";
import { useNow, When } from "../shell/live";
import { ShellPage } from "../shell/ShellPage";
import { TreasuryStrip } from "../TreasuryStrip";
import { useTreasuryNames } from "../treasuryName";
import { useLiveTreasuryState } from "../useTreasuryState";
import { useWalletSigner } from "../useWalletSigner";
import {
	finaliseMove,
	type Outcome,
	type StepId,
	type StepState,
	signMove,
} from "./actions";
import { CodePanel } from "./CodePanel";
import { SharePanel } from "./SharePanel";
import { SignaturesPanel } from "./SignaturesPanel";
import { TellCoSigners } from "./TellCoSigners";
import { type MoveStepState, useMoveStep } from "./useMoveStep";
import type { ProposalDoc } from "./useProposalDoc";

const TONE: Record<MovePhase, Tone> = {
	judging: "neutral",
	collecting: "info",
	held: "warning",
	ready: "success",
	half: "info",
	done: "success",
	halted: "danger",
	broken: "warning",
};
/** Phases of a step after which nobody signs it any more. */
const CLOSED: ReadonlySet<Phase> = new Set([
	"submitted",
	"carried-out",
	"closed",
	"withdrawn",
	"declined",
	"expired",
	"refused",
]);
const NO_SIGNERS: readonly Address[] = [];
const keyOf = (p: Proposal): ProposalKey => ({
	network: p.payload.network,
	treasury: p.payload.multiSigUser,
	digest: p.digest,
});

/** "once", "twice", "4 times". */
const times = (n: number): string =>
	n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

/** An amber line under an action: something to know before agreeing. */
function Amber({ children }: { children: React.ReactNode }) {
	return (
		<p className="mt-2.5 flex items-start gap-1.5 text-[13px] text-warning">
			<span
				className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-warning"
				aria-hidden
			/>
			<span>{children}</span>
		</p>
	);
}

/**
 * Two proposals that are one move, on one page: where the move stands, what
 * each step does, what the connected wallet can do about both at once, and
 * who has signed each. Each step is judged exactly as on its own page, and
 * the second is sent only once Hyperliquid has accepted the first.
 */
export function MoveView({
	move,
	docs,
	issues,
}: {
	move: Move;
	/** The documents of the two steps, in the move's order. */
	docs: readonly [ProposalDoc, ProposalDoc];
	issues: readonly [readonly Issue[], readonly Issue[]];
}) {
	const [first, second] = move.steps;
	const header = useNetwork();
	const relay = useRelay();
	const wallet = useWalletSigner();
	const me = wallet.address as Address | null;
	const clock = useNow();
	const target = useMemo<AccountTarget>(
		() => ({
			address: first.payload.multiSigUser,
			network: first.payload.network,
		}),
		[first.payload.multiSigUser, first.payload.network],
	);
	// a vault step leaves its only trace in the ledger: followed for a vault move
	const treasury = useLiveTreasuryState(target, {
		ledger: move.kind === "vault",
	});
	const { rows: mine } = useTreasuries();
	const nameOf = useTreasuryNames();
	const listed =
		mine.find(
			(t) => t.network === target.network && t.address === target.address,
		) ?? null;
	const shared = {
		me,
		walletChainId: wallet.chainId,
		header,
		clock,
		listed,
		relayWallet: relay.wallet as Address | null,
		ledger: move.kind === "vault" ? treasury.live.ledger : null,
	};
	const one = useMoveStep(first, issues[0], docs[0], shared);
	const two = useMoveStep(second, issues[1], docs[1], shared);
	const steps = [one, two] as const;
	const stage = deriveMoveStage([one, two]);

	const validators =
		one.staking.staking.validators ?? two.staking.staking.validators;
	const sentence = moveSentence(move, validators);
	const finaliser = first.payload.outerSigner;
	const proposer = docs[0].relay.row?.createdBy ?? first.meta.createdBy;
	const treasuryName = listed
		? nameOf(target.network, target.address as Address)
		: shortAddress(target.address);
	const signersNow =
		one.state.policy && one.state.policy.authorizedUsers.length > 0
			? one.state.policy.authorizedUsers
			: (listed?.signers ?? NO_SIGNERS);
	// Proposed again from step 1 the form names the whole move; from step 2,
	// that step alone, which is what is left once step 1 was carried out.
	const again = (from: Proposal, label: string) => (
		<Link
			to="/multisig/propose"
			search={{
				treasury: target.address,
				supersedes: from.digest,
				network: target.network,
			}}
			className={linkButtonSm}
		>
			{label}
		</Link>
	);
	const repropose =
		stage.phase === "broken" ? (
			// said by its number where it may be done already: the reader should
			// know it is a new step 2 that is being made
			again(
				second,
				stage.unsure === 1 ? "Propose step 2 again" : "Propose it again",
			)
		) : stage.unsure === 0 ? (
			// whether step 1 was carried out is not known from the answer: the
			// reader looks, then proposes what is really left
			<div className="flex flex-wrap items-center gap-2">
				{again(first, "Propose the whole move again")}
				{again(second, "Propose only step 2")}
			</div>
		) : (
			again(first, "Propose it again")
		);
	// a refused step stays open on the relay until it is withdrawn or lapses
	const leftOpen = steps.some(
		(s) =>
			s.doc.relay.known &&
			s.doc.relay.row?.status === "open" &&
			!s.doc.relay.expired,
	);
	const relayIssues = [...issues[0], ...issues[1]].filter((i) =>
		i.code.startsWith("relay."),
	);

	return (
		<TreasuryNames
			network={target.network}
			treasury={target.address as Address}
			signers={signersNow}
		>
			<ShellPage
				title={first.meta.title ?? sentence}
				back={
					listed ? (
						<Link
							to="/multisig/t/$network/$address"
							params={{ network: target.network, address: target.address }}
							className={backLink}
						>
							◂ {treasuryName}
						</Link>
					) : (
						<Link to="/multisig/open" className={backLink}>
							◂ Open or start
						</Link>
					)
				}
				meta={
					<>
						<span
							className={listed ? undefined : "font-mono"}
							title={target.address}
						>
							{treasuryName}
						</span>
						<NetTag network={target.network} />
						{proposer && (
							<span>
								proposed by{" "}
								{proposer === me ? "you" : <Who address={proposer} />}
							</span>
						)}
						<Tag>2 steps</Tag>
						<SignsTag />
					</>
				}
			>
				<div className="flex flex-col gap-4">
					<Callout
						tone={TONE[stage.phase]}
						title={
							<span className="inline-flex flex-wrap items-center gap-1.5">
								<span>
									<Sentence parts={stage.headlineParts} />
								</span>
								<Help k="moveSteps" />
							</span>
						}
						action={
							stage.phase === "halted" || stage.phase === "broken"
								? repropose
								: undefined
						}
					>
						<Sentence parts={stage.detailParts} />
					</Callout>
					{docs.map(
						(d, i) =>
							d.relay.issue && (
								<Callout
									key={steps[i]?.proposal.digest}
									tone={
										d.relay.issue.severity === "error" ? "danger" : "warning"
									}
									title={d.relay.issue.message}
								>
									{d.relay.issue.fix}
								</Callout>
							),
					)}
					{relayIssues.map((n) => (
						<Callout key={n.code + n.message} tone="warning" title={n.message}>
							{n.fix}
						</Callout>
					))}

					<div className="grid grid-cols-1 items-start gap-4 min-[861px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
						<div className="flex min-w-0 flex-col gap-4">
							<Card title="The move">
								<p className="text-balance text-[17px] font-medium [overflow-wrap:anywhere]">
									{sentence}
								</p>
								<p className="mt-1.5 text-[13px] text-muted-foreground">
									Two proposals, shown as one. Each is signed by itself, and the
									second is sent only once Hyperliquid has accepted the first.
								</p>
								<dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
									<dt className="pt-0.5 text-xs text-muted-foreground">
										Treasury
									</dt>
									<dd className="font-mono text-[13px] [overflow-wrap:anywhere]">
										{target.address}
									</dd>
									<dt className="flex items-center gap-1 pt-0.5 text-xs text-muted-foreground">
										Finaliser <Help k="finaliser" />
									</dt>
									<dd className="text-[13px]">
										<Who address={finaliser} full />
										{finaliser === me ? " (you)" : ""}
									</dd>
									{first.meta.note && (
										<>
											<dt className="pt-0.5 text-xs text-muted-foreground">
												Note
											</dt>
											<dd className="[overflow-wrap:anywhere]">
												{first.meta.note}
											</dd>
										</>
									)}
								</dl>
								{(first.meta.title || first.meta.note) && (
									<p className="mt-3 text-xs text-subtle-foreground">
										The title and note are not signed: whoever shared the
										proposals wrote them. The two actions below are what signers
										sign.
									</p>
								)}
							</Card>
							{steps.map((s, i) => (
								<StepCard
									key={s.proposal.digest}
									step={s}
									number={i + 1}
									me={me}
								/>
							))}
							{(!stage.settled || leftOpen) && (
								<MovePart
									// what one wallet did is not said to the next one that connects
									key={wallet.address ?? "nobody"}
									steps={steps}
									signers={signersNow}
									now={clock}
								/>
							)}
						</div>
						<div className="flex min-w-0 flex-col gap-4">
							{steps.map((s, i) => (
								<div key={s.proposal.digest} className="flex flex-col gap-1.5">
									<p className="px-0.5 text-xs font-medium text-muted-foreground">
										Step {i + 1}
									</p>
									<SignaturesPanel
										proposal={s.proposal}
										policy={s.state.policy}
										counted={s.ready ? s.ready.counted : null}
										me={me}
										closed={CLOSED.has(s.stage.phase)}
										seen={
											s.doc.relay.row && s.doc.relay.views
												? {
														views: s.doc.relay.views,
														proposer: s.doc.relay.row.createdBy,
														createdAt: s.doc.relay.row.createdAt,
													}
												: null
										}
										objected={s.stage.standing?.objected}
										now={clock}
									/>
								</div>
							))}
							<TellCoSigners
								proposal={first}
								doc={docs[0]}
								also={{ proposal: second, doc: docs[1] }}
							/>
							<SharePanel
								proposal={first}
								store={docs[0].store}
								also={[{ proposal: second, store: docs[1].store }]}
								secondary={docs[0].relay.known && docs[1].relay.known}
							/>
						</div>
					</div>

					<details className="group min-w-0">
						<summary className="cursor-pointer list-none text-[13px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
							<span className="group-open:hidden">
								▸ Details: the treasury, and each step by itself
							</span>
							<span className="hidden group-open:inline">▾ Details</span>
						</summary>
						<div className="mt-4 flex flex-col gap-4">
							<TreasuryStrip state={treasury} wallet={me} />
							<p className="text-[13px] text-muted-foreground">
								Each step is a proposal of its own, with its own digest and
								signatures:{" "}
								{steps.map((s, i) => (
									<span key={s.proposal.digest}>
										{i > 0 && " · "}
										<span className="font-mono text-xs">
											step {i + 1} {shortAddress(s.proposal.digest)}
										</span>
									</span>
								))}
								.
							</p>
						</div>
					</details>
				</div>
			</ShellPage>
		</TreasuryNames>
	);
}

/** One step of the move: what it does, where it stands, and what a signer should know about it. */
function StepCard({
	step,
	number,
	me,
}: {
	step: MoveStepState;
	number: number;
	me: Address | null;
}) {
	const { proposal, stage, staking, description } = step;
	const network = proposal.payload.network;
	const validators = staking.staking.validators;
	const open = !CLOSED.has(stage.phase);
	const onRecord = staking.record;
	const done = stage.phase === "submitted" || stage.phase === "carried-out";
	// "duplicate nonce": the step's number was used before, so it may be
	// carried out already; what the staking history shows is said here too
	const duplicate = stage.failedAttempt?.id === "nonce-duplicate";
	// what the staking history holds is said unless the step is done, or was
	// refused for a reason of Hyperliquid's own (that submission did nothing)
	const ask = !done && (!stage.failedAttempt || duplicate);
	const before = open ? "submitting" : "proposing it again";
	return (
		<Card
			title={`Step ${number} of 2`}
			actions={
				<Tag
					tone={
						done
							? "ok"
							: stage.phase === "refused" || stage.phase === "expired"
								? "danger"
								: stage.phase === "ready"
									? "ok"
									: "gray"
					}
				>
					{done ? "carried out" : <Sentence parts={stage.headlineParts} />}
				</Tag>
			}
		>
			<p className="text-[15px] font-medium [overflow-wrap:anywhere]">
				{actionLine(proposal.payload.action, validators, network)}
			</p>
			<ul className="mt-1.5 space-y-0.5 text-[13px] text-muted-foreground">
				{description.lines.map((line) => (
					<li key={line} className="[overflow-wrap:anywhere]">
						{line}
					</li>
				))}
			</ul>
			{description.parties.map((party) => (
				<p key={`${party.role}:${party.address}`} className="mt-2 text-[13px]">
					<span className="mr-2 text-xs text-muted-foreground">
						{party.role === "vault" ? "Vault" : "Validator"}
					</span>
					<Who address={party.address} full editable />
					{party.address === me && " (you)"}
					{staking.validator?.address === party.address &&
						staking.validator.name.trim() && (
							<span className="ml-1.5 text-muted-foreground">
								listed as “<bdi>{staking.validator.name.trim()}</bdi>”
							</span>
						)}
					{party.role === "vault" &&
						step.vault.vault?.address === party.address &&
						step.vault.vault.name.trim() && (
							<span className="ml-1.5 text-muted-foreground">
								named “<bdi>{cutTo(step.vault.vault.name.trim(), 40)}</bdi>” on
								Hyperliquid
							</span>
						)}
				</p>
			))}
			{open && staking.noPay && <Amber>{staking.noPay}</Amber>}
			{open && step.vault.relocks && <Amber>{step.vault.relocks}</Amber>}
			{ask &&
				(step.vault.record?.kind === "likely" ||
					step.vault.record?.kind === "several") && (
					<Amber>
						{step.vault.record.kind === "likely" ? (
							<>
								Hyperliquid's record of this treasury shows a vault deposit like
								this one on <When at={step.vault.record.time} />. It may be this
								step, already carried out: a vault action carries no number that
								would tell.
							</>
						) : (
							"Hyperliquid's record of this treasury shows several vault deposits like this one since it was proposed. One of them may be this step, already carried out: a vault action carries no number that would tell."
						)}{" "}
						Look at the treasury's On Hyperliquid tab before {before}.
					</Amber>
				)}
			{ask && onRecord?.kind === "likely" && (
				<Amber>
					Hyperliquid's staking history shows a step like this one on{" "}
					<When at={onRecord.time} />. It may be this step, already carried out:
					the explorer did not say.{" "}
					<a
						href={explorerTxUrl(network, onRecord.hash)}
						target="_blank"
						rel="noreferrer"
						className="underline underline-offset-2"
					>
						Look at that transaction
					</a>{" "}
					before {before}.
				</Amber>
			)}
			{ask && onRecord?.kind === "unchecked" && (
				<Amber>
					Hyperliquid's staking history shows several steps like this one, and
					the explorer did not say whether one of them is this step. Look at the
					treasury's Staking history before {before}.
				</Amber>
			)}
			{stage.failedAttempt && (
				<Callout
					tone="danger"
					className="mt-3"
					title={`Hyperliquid refused this step: ${stage.failedAttempt.message}`}
				>
					{duplicate ? (
						<Sentence parts={stage.detailParts} />
					) : (
						refusalNote(stage.failedAttempt)
					)}
				</Callout>
			)}
			{!done && !open && !stage.failedAttempt && (
				<p className="mt-2.5 text-[13px] text-muted-foreground">
					<Sentence parts={stage.detailParts} />
				</p>
			)}
			{step.tx && (
				<p className="mt-2.5">
					<a
						href={explorerTxUrl(network, step.tx)}
						target="_blank"
						rel="noopener noreferrer"
						className={linkButtonSm}
					>
						Transaction <ExternalLink className="size-3" aria-hidden />
					</a>
				</p>
			)}
		</Card>
	);
}

const ROWS: readonly { id: StepId; label: string }[] = [
	{ id: "inner", label: "your signature on the action" },
	{ id: "envelope", label: "your signature on the envelope" },
	{ id: "submit", label: "sent to Hyperliquid" },
];
type Marks = Record<number, Partial<Record<StepId, StepState>>>;

/**
 * What the connected wallet can do about the move: sign what it has not
 * signed, as the finaliser sign and send what is left, and what the relay
 * offers besides, each for both steps at once.
 */
function MovePart({
	steps,
	signers,
	now,
}: {
	steps: readonly [MoveStepState, MoveStepState];
	signers: readonly Address[];
	now: number;
}) {
	const wallet = useWalletSigner();
	const relay = useRelay();
	const queries = useQueryClient();
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const [failure, setFailure] = useState<{
		readonly title: string;
		readonly issues: readonly Issue[];
	} | null>(null);
	const [marks, setMarks] = useState<Marks | null>(null);
	const [confirm, setConfirm] = useState(false);
	const [busy, setBusy] = useState(false);
	// the wallet answered that it lacks the signing network: the code panel offers to add it
	const [needsNetwork, setNeedsNetwork] = useState(false);
	const [addFailed, setAddFailed] = useState<string | null>(null);

	const stage = deriveMoveStage(steps);
	const me = wallet.address as Address | null;
	const finaliser = steps[0].proposal.payload.outerSigner;
	const isFinaliser = !!me && me === finaliser;
	const { network, multiSigUser } = steps[0].proposal.payload;

	// what the relay offers, step by step; each button acts on every step it applies to
	const offered = steps.map((s) => {
		const row = s.doc.relay.row;
		return relayActions({
			known: s.doc.relay.known,
			status: row?.status ?? "open",
			expired: s.doc.relay.expired,
			me,
			createdBy: row?.createdBy ?? finaliser,
			finaliser,
			relaySigners: row?.signatures.map((x) => x.signer) ?? [],
			isSigner: !!me && signers.includes(me),
			objected: s.doc.relay.objections.map((o) => o.signer),
		});
	});
	const keys = (which: "takeBack" | "withdraw" | "sayNo" | "takeBackNo") =>
		steps.flatMap((s, i) => (offered[i]?.[which] ? [keyOf(s.proposal)] : []));
	// a move that is over is only ever cleared away: nothing about it is
	// signed, objected to or taken back any more
	const over = stage.settled;
	const can = {
		takeBack: over ? [] : keys("takeBack"),
		withdraw: keys("withdraw"),
		sayNo: over ? [] : keys("sayNo"),
		takeBackNo: over ? [] : keys("takeBackNo"),
	};

	/** One write that covers every step named: the relay takes all of them or none. */
	const act = async (
		write: (c: RelayClient, as: Address) => Promise<Result<true>>,
		forget = false,
	) => {
		const client = relay.client;
		const as = relay.wallet as Address | null;
		if (!client || !as) return;
		setBusy(true);
		setOutcome(null);
		try {
			const r = await write(client, as);
			setFailure(
				r.issue
					? { title: "The relay did not take it", issues: [r.issue] }
					: null,
			);
			// the relay took this wallet's signatures back with it: this browser's copies follow
			if (!r.issue && forget)
				for (const s of steps) await s.doc.forgetSignature(as);
			await queries.invalidateQueries({ queryKey: ["relay", as] });
		} finally {
			setBusy(false);
		}
	};

	const toSign = stage.toSign.map((i) => steps[i] as MoveStepState);
	const toSend = stage.toSend.map((i) => steps[i] as MoveStepState);
	const which = (list: readonly number[]) =>
		list.length === 2 ? "both steps" : `step ${(list[0] ?? 0) + 1}`;
	const adds = toSend.some((s) => s.stage.executeAddsSignature);

	// The steps this click asks the wallet for a code on (a vault deposit):
	// the code has to be on the page to compare, and the wallet has to hold
	// the signing network.
	const coded = (
		stage.canExecute
			? toSend.filter((s) => s.stage.executeAddsSignature)
			: toSign
	).filter((s) => s.stage.signsCode);

	const doSign = async () => {
		setOutcome(null);
		setFailure(null);
		const done = await signMove({
			steps: toSign.map((s) => ({
				proposal: s.proposal,
				stage: s.stage,
				store: s.doc.store,
			})),
			wallet,
		});
		// not a failure: the wallet has to be given the network first
		if (!done.outcome.ok && done.outcome.needsNetwork) setNeedsNetwork(true);
		else {
			setNeedsNetwork(false);
			setOutcome(done.outcome);
		}
	};
	const sign = () => void wallet.run("Waiting for the wallet…", doSign);

	const doSubmit = async () => {
		setOutcome(null);
		setFailure(null);
		setMarks({});
		const result = await finaliseMove({
			steps: toSend.map((s) => ({
				proposal: s.proposal,
				stage: s.stage,
				doc: s.doc,
			})),
			wallet,
			mark: (index, id, state) =>
				setMarks((m) => ({
					...(m ?? {}),
					[index]: { ...(m?.[index] ?? {}), [id]: state },
				})),
		});
		setMarks(null);
		if (!result.ok && result.needsNetwork) {
			setNeedsNetwork(true);
			return;
		}
		setNeedsNetwork(false);
		if (!result.ok)
			setFailure({
				title:
					result.sent > 0
						? `Step ${(stage.toSend[result.index] ?? 0) + 1} was not sent`
						: "Nothing was sent",
				issues: result.issues,
			});
		// what the treasury has in staking, or in vaults, changed with every step that went through
		if (result.sent > 0) {
			void refreshStaking(queries, network, multiSigUser);
			void refreshVaults(queries, network, multiSigUser);
		}
	};

	/** One approval in the wallet adds the network; then what was asked for goes on. */
	const addNetwork = () =>
		void wallet.run("Waiting for the wallet…", async () => {
			setAddFailed(null);
			const added = await wallet.addSigningNetwork();
			if (!added.ok) {
				setAddFailed(added.error);
				return;
			}
			setNeedsNetwork(false);
			await (stage.canExecute ? doSubmit() : doSign());
		});

	const submit = () => void wallet.run("Waiting for the wallet…", doSubmit);

	if (marks) {
		return (
			<Card title="Finishing">
				<div className="flex flex-col gap-3">
					{toSend.map((s, i) => {
						const mine = marks[i] ?? {};
						const rows = ROWS.filter(
							(r) => r.id !== "inner" || s.stage.executeAddsSignature,
						);
						return (
							<div key={s.proposal.digest}>
								<p className="text-xs font-medium text-muted-foreground">
									Step {(stage.toSend[i] ?? 0) + 1}
								</p>
								<ol className="mt-1 flex flex-col gap-1.5">
									{rows.map((r) => {
										const state = mine[r.id] ?? "todo";
										return (
											<li
												key={r.id}
												className={
													state === "todo"
														? "flex items-center gap-2 text-sm text-muted-foreground"
														: "flex items-center gap-2 text-sm"
												}
											>
												<span
													className={
														state === "done"
															? "grid size-4 shrink-0 place-items-center rounded-full bg-success text-surface"
															: state === "active"
																? "size-4 shrink-0 rounded-full border border-brand"
																: "size-4 shrink-0 rounded-full border border-border-strong"
													}
												>
													{state === "done" && (
														<Check className="size-3" aria-hidden />
													)}
												</span>
												{r.label}
												{state === "active" && (
													<span className="text-subtle-foreground">
														· waiting…
													</span>
												)}
												<span className="sr-only">: {state}</span>
											</li>
										);
									})}
								</ol>
							</div>
						);
					})}
				</div>
				{coded.map((s) => (
					// the wallet shows a code for this step: it has to be here to compare
					<div key={s.proposal.digest} className="mt-3">
						<CodePanel payload={s.proposal.payload} />
					</div>
				))}
				<p className="mt-3 text-[13px] text-muted-foreground">
					Every signature is asked for first. Then step{" "}
					{(stage.toSend[0] ?? 0) + 1} is sent
					{toSend.length > 1
						? ", and the next one once Hyperliquid has accepted it."
						: "."}{" "}
					If no wallet window opens, open your wallet: it may be holding a
					request.
				</p>
			</Card>
		);
	}

	const waits = stage.opensAt !== null && !stage.canExecute;
	const any =
		stage.canExecute ||
		stage.canSign ||
		waits ||
		can.takeBack.length > 0 ||
		can.withdraw.length > 0 ||
		can.sayNo.length > 0 ||
		can.takeBackNo.length > 0;
	const off = wallet.busy || busy;
	const note = over
		? leftOpenNote(can.withdraw.length > 0)
		: stage.canExecute
			? `Your wallet is asked ${times(stage.prompts)}. Then step ${(stage.toSend[0] ?? 0) + 1} is sent${toSend.length > 1 ? ", and step 2 once Hyperliquid has accepted it" : ""}.`
			: stage.canSign
				? `${toSign.length > 1 ? "One wallet prompt for each step. " : ""}${toSign
						.map((s) => signHint(s.proposal.payload.action))
						.filter((t, i, all) => all.indexOf(t) === i)
						.join(" ")}`
				: stage.signed > 0 && stage.toSign.length === 0
					? `You signed ${stage.signed === 2 ? "both steps" : "what is left to sign"}. ${isFinaliser ? "" : `The finaliser ${shortAddress(finaliser)} submits.`}`
					: (stage.executeReason ?? "");

	return (
		<Card
			title={
				<span className="inline-flex items-center gap-1.5">
					Your part <Help k="waysOut" />
				</span>
			}
			actions={isFinaliser ? <Tag tone="you">you are the finaliser</Tag> : null}
		>
			{(stage.canExecute || stage.canSign) &&
				coded.map((s) => (
					<div key={s.proposal.digest} className="mb-3">
						<CodePanel
							payload={s.proposal.payload}
							needsNetwork={needsNetwork}
							busy={wallet.busy}
							onAdd={addNetwork}
							failed={addFailed}
						/>
					</div>
				))}
			{any && (
				<div className="flex flex-wrap items-center gap-2">
					{stage.canExecute ? (
						<Btn
							variant={needsNetwork ? "outline" : "brand"}
							disabled={off}
							onClick={submit}
						>
							{adds ? "Sign and submit" : "Submit"} {which(stage.toSend)}
						</Btn>
					) : stage.canSign ? (
						<Btn
							variant={needsNetwork ? "outline" : "brand"}
							disabled={off}
							onClick={sign}
						>
							Sign {which(stage.toSign)}
							{me ? ` as ${shortAddress(me)}` : ""}
						</Btn>
					) : null}
					{waits && (
						<Btn
							variant="brand"
							disabled
							title="Hyperliquid would refuse it before the stake's lockup has ended."
						>
							Submit {which(stage.toSend)}
						</Btn>
					)}
					{can.takeBack.length > 0 && (
						<Btn
							variant="outline"
							disabled={off}
							onClick={() =>
								void act((c, as) => removeSignatures(c, as, can.takeBack), true)
							}
						>
							Take back my{" "}
							{can.takeBack.length > 1 ? "signatures" : "signature"}
						</Btn>
					)}
					{can.takeBackNo.length > 0 && (
						<Btn
							variant="outline"
							disabled={off}
							onClick={() =>
								void act((c, as) => removeObjections(c, as, can.takeBackNo))
							}
						>
							{RELAY_COPY.takeBackNo}
						</Btn>
					)}
					{can.sayNo.length > 0 && (
						<Btn
							variant="outline"
							className="border-warning/50 text-warning hover:text-warning"
							disabled={off}
							title={
								steps.some((s) => s.stage.hasSigned)
									? RELAY_COPY.saidNoAfterSigning
									: undefined
							}
							onClick={() =>
								void act((c, as) => addObjections(c, as, can.sayNo), true)
							}
						>
							{RELAY_COPY.sayNo}
						</Btn>
					)}
					{can.withdraw.length > 0 && (
						<Btn
							variant="outline"
							className="border-danger/40 text-danger hover:text-danger"
							disabled={off}
							onClick={() => setConfirm(true)}
						>
							Withdraw
						</Btn>
					)}
				</div>
			)}
			{waits && stage.opensAt !== null && (
				<p className="mt-2.5 flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
					<span>
						Submit opens on <When at={stage.opensAt} /> (
						{untilWords(stage.opensAt, now)}): the stake this takes from is
						locked until then.
						{stage.canSign ? " You can sign now." : ""}
					</span>
					<Help k="stakeLockup" />
				</p>
			)}
			{note && !(waits && !stage.canSign) && (
				<p
					className={
						any
							? "mt-2.5 text-[13px] text-muted-foreground"
							: "text-[13px] text-muted-foreground"
					}
				>
					{note}
				</p>
			)}
			{!over &&
				(can.sayNo.length > 0 ||
					can.takeBackNo.length > 0 ||
					can.withdraw.length > 0) && (
					<p className="mt-2 text-xs text-subtle-foreground">
						A no, its taking back and a withdrawal cover both steps: they are
						one move.
					</p>
				)}
			{confirm && (
				<Callout
					tone="warning"
					className="mt-3"
					title="Withdraw this move?"
					action={
						<div className="flex flex-wrap items-center gap-2">
							<Btn
								size="sm"
								variant="outline"
								className="border-danger/40 text-danger hover:text-danger"
								disabled={off}
								onClick={() => {
									setConfirm(false);
									void act((c, as) => withdrawMove(c, as, can.withdraw));
								}}
							>
								Yes, withdraw
							</Btn>
							<Btn size="sm" variant="ghost" onClick={() => setConfirm(false)}>
								Keep it
							</Btn>
						</div>
					}
				>
					{RELAY_COPY.endingNote}
				</Callout>
			)}
			{outcome?.ok === true && (
				<Callout tone="success" title="Signed" className="mt-3">
					{steps[0].doc.relay.known
						? "Your co-signers see it now."
						: "Saved in this browser. Pass the move on so the others can sign."}
				</Callout>
			)}
			{outcome?.ok === false && (
				<Callout
					tone="danger"
					title="Not everything was signed"
					className="mt-3"
				>
					<IssueList plain issues={outcome.issues} />
				</Callout>
			)}
			{failure && (
				<Callout tone="danger" title={failure.title} className="mt-3">
					<IssueList plain issues={failure.issues} />
				</Callout>
			)}
		</Card>
	);
}
