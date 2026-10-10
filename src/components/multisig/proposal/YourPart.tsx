import type { Address, Issue, Proposal } from "@hl-tools/core";
import { Check } from "lucide-react";
import { useState } from "react";
import { Callout, IssueList } from "#/components/hub/status";
import { useNetworkStore } from "#/store/networkStore";
import { RELAY_COPY } from "../model/relay/copy";
import { relayActions } from "../model/relay/status";
import { type Stage, shortAddress } from "../model/stage";
import { Btn, Card, Tag } from "../shell/kit";
import type { WalletSigner } from "../useWalletSigner";
import {
	finalise,
	type Outcome,
	type StepId,
	type StepState,
	signInner,
} from "./actions";
import type { ProposalDoc } from "./useProposalDoc";

const FRESH: Record<StepId, StepState> = {
	inner: "todo",
	envelope: "todo",
	submit: "todo",
};

/**
 * What the connected wallet can do to this proposal: one primary button
 * (sign, or for the finaliser sign and submit), and under it the ways out
 * that the relay offers (take a signature back, withdraw, decline).
 */
export function YourPart({
	proposal,
	stage,
	wallet,
	doc,
	have,
	need,
}: {
	proposal: Proposal;
	stage: Stage;
	wallet: WalletSigner;
	doc: ProposalDoc;
	/** Verified signatures of current signers, and how many are needed (null while unknown). */
	have: number;
	need: number | null;
}) {
	const setNetwork = useNetworkStore((s) => s.setNetwork);
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const [steps, setSteps] = useState<Record<StepId, StepState> | null>(null);
	const [failure, setFailure] = useState<readonly Issue[] | null>(null);
	const [confirm, setConfirm] = useState<"withdrawn" | "declined" | null>(null);
	const [finishing, setFinishing] = useState(false);

	const { network, outerSigner } = proposal.payload;
	const me = wallet.address as Address | null;
	const isFinaliser = !!me && me === outerSigner;
	const row = doc.relay.row;
	const actions = relayActions({
		known: doc.relay.known,
		status: row?.status ?? "open",
		expired: doc.relay.expired,
		me,
		createdBy: row?.createdBy ?? outerSigner,
		finaliser: outerSigner,
		relaySigners: row?.signatures.map((s) => s.signer) ?? [],
	});
	const adds = stage.executeAddsSignature;
	const chain = stage.requiredChain;

	const sign = () =>
		void wallet.run("Waiting for the wallet…", async () => {
			setOutcome(null);
			setFailure(null);
			setOutcome((await signInner(proposal, stage, wallet, doc.store)).outcome);
		});

	const submit = () =>
		void wallet.run("Waiting for the wallet…", async () => {
			setOutcome(null);
			setFailure(null);
			setSteps(FRESH);
			setFinishing(true);
			const result = await finalise({
				proposal,
				stage,
				wallet,
				doc,
				mark: (id, state) =>
					setSteps((s) => ({ ...(s ?? FRESH), [id]: state })),
			});
			setFinishing(false);
			if (!result.ok) setFailure(result.issues);
		});

	const rows: { id: StepId; label: string }[] = [
		...(adds || (steps && steps.inner !== "todo")
			? [{ id: "inner" as const, label: "Your signature on the action" }]
			: []),
		{ id: "envelope", label: "Your signature on the envelope" },
		{ id: "submit", label: `Sent to Hyperliquid ${network}` },
	];

	if (finishing && steps) {
		return (
			<Card title="Finishing">
				<ol className="flex flex-col gap-2">
					{rows.map((r, i) => {
						const state = steps[r.id];
						return (
							<li
								key={r.id}
								className={
									state === "todo"
										? "flex items-center gap-2.5 text-sm text-muted-foreground"
										: "flex items-center gap-2.5 text-sm"
								}
							>
								<span
									className={
										state === "done"
											? "grid size-5 shrink-0 place-items-center rounded-full bg-success text-[11px] text-surface"
											: state === "active"
												? "grid size-5 shrink-0 place-items-center rounded-full border border-brand text-[11px] text-brand"
												: "grid size-5 shrink-0 place-items-center rounded-full border border-border-strong text-[11px]"
									}
								>
									{state === "done" ? (
										<Check className="size-3" aria-hidden />
									) : (
										i + 1
									)}
								</span>
								{r.label}
								{state === "active" && (
									<span className="text-subtle-foreground">· waiting…</span>
								)}
								<span className="sr-only">: {state}</span>
							</li>
						);
					})}
				</ol>
				<p className="mt-3 text-[13px] text-muted-foreground">
					{RELAY_COPY.underSign}
				</p>
			</Card>
		);
	}

	const waiting = need !== null ? Math.max(0, need - have) : null;
	const note = stage.canExecute
		? adds
			? "Your signature completes the threshold. Two wallet prompts, then it is sent."
			: "One wallet prompt, then it is sent."
		: stage.canSign
			? `${RELAY_COPY.underSign}${chain ? ` Signed under ${chain.label}; nothing is sent to that chain.` : ""}`
			: stage.hasSigned
				? stage.phase === "ready"
					? `You signed this. It is waiting for ${isFinaliser ? "you" : shortAddress(outerSigner)} to submit.`
					: waiting
						? `You signed this. It needs ${waiting} more.`
						: "You signed this."
				: (stage.signReason ?? stage.executeReason ?? "");

	const any =
		stage.canExecute ||
		stage.canSign ||
		actions.takeBack ||
		actions.withdraw ||
		actions.decline;

	return (
		<Card
			title="Your part"
			actions={isFinaliser ? <Tag tone="you">you are the finaliser</Tag> : null}
		>
			{any && (
				<div className="flex flex-wrap items-center gap-2">
					{stage.canExecute ? (
						<Btn
							variant="brand"
							disabled={wallet.busy || doc.relay.busy}
							onClick={submit}
						>
							{adds ? "Sign and submit" : "Submit"}
						</Btn>
					) : stage.canSign ? (
						<Btn
							variant="brand"
							disabled={wallet.busy || doc.relay.busy}
							onClick={sign}
						>
							{chain && !stage.onRequiredChain
								? `Switch to ${chain.label.replace(/ \(\d+\)$/, "")} and sign`
								: `Sign as ${me ? shortAddress(me) : "…"}`}
						</Btn>
					) : null}
					{actions.takeBack && (
						<Btn
							variant="outline"
							disabled={doc.relay.busy || wallet.busy}
							onClick={() => {
								setOutcome(null);
								void doc.takeBack();
							}}
						>
							Take back my signature
						</Btn>
					)}
					{actions.withdraw && (
						<Btn
							variant="outline"
							className="border-danger/40 text-danger hover:text-danger"
							disabled={doc.relay.busy}
							onClick={() => setConfirm("withdrawn")}
						>
							Withdraw
						</Btn>
					)}
					{actions.decline && (
						<Btn
							variant="outline"
							className="border-danger/40 text-danger hover:text-danger"
							disabled={doc.relay.busy}
							onClick={() => setConfirm("declined")}
						>
							Decline
						</Btn>
					)}
				</div>
			)}
			{note && (
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
			{stage.networkMismatch && (
				<div className="mt-3">
					<Btn size="sm" variant="outline" onClick={() => setNetwork(network)}>
						Switch the header to {network}
					</Btn>
				</div>
			)}
			{confirm && (
				<Callout
					tone="warning"
					className="mt-3"
					title={
						confirm === "withdrawn"
							? "Withdraw this proposal?"
							: "Decline to submit this proposal?"
					}
					action={
						<div className="flex flex-wrap items-center gap-2">
							<Btn
								size="sm"
								variant="outline"
								className="border-danger/40 text-danger hover:text-danger"
								disabled={doc.relay.busy}
								onClick={() => {
									const kind = confirm;
									setConfirm(null);
									void doc.end(kind);
								}}
							>
								{confirm === "withdrawn" ? "Yes, withdraw" : "Yes, decline"}
							</Btn>
							<Btn size="sm" variant="ghost" onClick={() => setConfirm(null)}>
								Keep it
							</Btn>
						</div>
					}
				>
					{RELAY_COPY.endingNote}
				</Callout>
			)}
			{outcome?.ok === true && (
				<Callout tone="success" title="Signature added" className="mt-3">
					{doc.relay.known
						? "Your co-signers see it now."
						: "Saved in this browser. Pass the proposal on so the others can sign."}
				</Callout>
			)}
			{outcome?.ok === false && (
				<Callout tone="danger" title="Not signed" className="mt-3">
					<IssueList issues={outcome.issues} />
				</Callout>
			)}
			{failure && (
				<Callout tone="danger" title="Not submitted" className="mt-3">
					<IssueList issues={failure} />
				</Callout>
			)}
		</Card>
	);
}
