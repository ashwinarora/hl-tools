import type { Issue, Proposal } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Workspace } from "#/components/hub/layout";
import { Callout, Pill, type Tone } from "#/components/hub/status";
import { ProposalResult } from "#/components/tools/multisig/EnvelopeView";
import {
	type AccountTarget,
	documentToParsed,
} from "#/components/tools/multisig/model";
import { useJudgement } from "#/components/tools/multisig/useJudgement";
import { useNetwork } from "#/store/networkStore";
import { deriveStage, type Phase, type WalletRole } from "../model/stage";
import { SignerPage } from "../SignerPage";
import { TreasuryStrip } from "../TreasuryStrip";
import { REFRESH_MS, useTreasuryState } from "../useTreasuryState";
import { useWalletSigner } from "../useWalletSigner";
import { ExecutePanel } from "./ExecutePanel";
import { SharePanel } from "./SharePanel";
import { SignPanel } from "./SignPanel";
import { StageCallout } from "./StageCallout";
import type { ProposalDoc } from "./useProposalDoc";

const actionLink =
	"inline-flex h-8 items-center whitespace-nowrap rounded-md border border-border-strong bg-surface px-3 text-sm hover:bg-surface-2";

/** Phases in which signing or finalising can still happen; elsewhere the stage line says it all. */
const ACTIONABLE: ReadonlySet<Phase> = new Set([
	"judging",
	"unknown",
	"collecting",
	"ready",
	"not-yet-valid",
]);

const ROLE: Record<WalletRole, { label: string; tone: Tone } | null> = {
	disconnected: null,
	outsider: { label: "not in the signer set", tone: "neutral" },
	signer: { label: "signer", tone: "info" },
	finaliser: { label: "finaliser", tone: "info" },
	"signer-finaliser": { label: "signer · finaliser", tone: "success" },
};

/**
 * One proposal, for the wallet looking at it: where it stands, the treasury it
 * acts on, and the same review the Multisig Inspector gives (action in words,
 * every signature recovered, readiness against the live signer set).
 */
export function ProposalView({
	proposal,
	issues,
	doc,
}: {
	proposal: Proposal;
	issues: readonly Issue[];
	doc: ProposalDoc;
}) {
	const header = useNetwork();
	const wallet = useWalletSigner();
	const address = wallet.address;
	const parsed = useMemo(
		() => documentToParsed(proposal, issues),
		[proposal, issues],
	);
	const state = useJudgement(parsed, { refetchInterval: REFRESH_MS });
	const target = useMemo<AccountTarget>(
		() => ({
			address: proposal.payload.multiSigUser,
			network: proposal.payload.network,
		}),
		[proposal.payload.multiSigUser, proposal.payload.network],
	);
	const treasury = useTreasuryState(target, { live: true });
	const stage = deriveStage({
		proposal,
		readiness: state.judgement?.ready ?? null,
		policy: state.policy,
		wallet: address,
		walletChainId: wallet.chainId,
	});
	const role = ROLE[stage.role];

	return (
		<SignerPage wallet={role && <Pill tone={role.tone}>{role.label}</Pill>}>
			<div className="space-y-4">
				<StageCallout
					stage={stage}
					action={
						stage.phase === "submitted" ? (
							<Link
								to="/tools/multisig"
								search={{ view: "account", address: target.address }}
								className={actionLink}
							>
								Check the ledger in the inspector
							</Link>
						) : stage.phase === "expired" ? (
							<Link
								to="/multisig/propose"
								search={{
									treasury: target.address,
									supersedes: proposal.digest,
								}}
								className={actionLink}
							>
								Re-propose
							</Link>
						) : undefined
					}
				/>
				{stage.failedAttempt && (
					<Callout
						tone="danger"
						title={`The last submission was rejected: ${stage.failedAttempt.message}`}
					>
						{stage.failedAttempt.cause} {stage.failedAttempt.fix}
					</Callout>
				)}
				{stage.policyChanged && (
					<Callout
						tone="warning"
						title="The signer set changed since this was proposed"
					>
						Readiness below is judged against the signer set the chain reports
						now, not the one recorded in the document.
					</Callout>
				)}
				{doc.storageError && (
					<Callout tone="warning" title="Not saved in this browser">
						{doc.storageError} The proposal stays on this page until you close
						it; download the file to keep it.
					</Callout>
				)}
				<Workspace
					input={
						<>
							<TreasuryStrip state={treasury} wallet={address} />
							{ACTIONABLE.has(stage.phase) && (
								<>
									<SignPanel
										proposal={proposal}
										stage={stage}
										wallet={wallet}
										store={doc.store}
									/>
									<ExecutePanel
										proposal={proposal}
										stage={stage}
										wallet={wallet}
										store={doc.store}
									/>
								</>
							)}
							<SharePanel proposal={proposal} store={doc.store} />
						</>
					}
					output={
						<ProposalResult
							parsed={parsed}
							toggle={header}
							state={state}
							// the finaliser signs the envelope under the same chain as the inner action
							envelopeChainId={
								proposal.receipt?.signatureChainId ?? stage.requiredChain?.hex
							}
						/>
					}
				/>
			</div>
		</SignerPage>
	);
}
