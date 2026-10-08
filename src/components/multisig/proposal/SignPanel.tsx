import { type Issue, type Proposal, signProposal } from "@hl-tools/core";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Panel } from "#/components/hub/layout";
import { Callout, IssueList } from "#/components/hub/status";
import { short } from "#/components/tools/multisig/AddressLine";
import { Button } from "#/components/ui/button";
import type { Stage } from "../model/stage";
import type { WalletSigner } from "../useWalletSigner";
import type { StoreResult } from "./useProposalDoc";

type Outcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly issues: readonly Issue[] };

/** One signer's inner signature. The wallet shows the struct; the page checks who signed. */
export async function signInner(
	proposal: Proposal,
	stage: Stage,
	wallet: WalletSigner,
	store: (p: Proposal) => Promise<StoreResult>,
): Promise<{ outcome: Outcome; proposal: Proposal }> {
	const fail = (message: string): { outcome: Outcome; proposal: Proposal } => ({
		outcome: {
			ok: false,
			issues: [{ code: "wallet", severity: "error", message }],
		},
		proposal,
	});
	if (!stage.requiredChain)
		return fail("This action does not state a signing chain.");
	const got = await wallet.signerFor(stage.requiredChain.hex);
	if (!got.ok) return fail(got.error);
	const signed = await signProposal(proposal, got.signer, {
		expectedSigner: wallet.address ?? undefined,
	});
	if (!signed.signature)
		return { outcome: { ok: false, issues: signed.issues }, proposal };
	// stored through a merge: one signature per signer, this one first
	const stored = await store({ ...proposal, signatures: [signed.signature] });
	return { outcome: { ok: true }, proposal: stored.proposal };
}

export function SignPanel({
	proposal,
	stage,
	wallet,
	store,
}: {
	proposal: Proposal;
	stage: Stage;
	wallet: WalletSigner;
	store: (p: Proposal) => Promise<StoreResult>;
}) {
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const sign = () =>
		void wallet.run("Waiting for the wallet…", async () => {
			setOutcome(null);
			setOutcome((await signInner(proposal, stage, wallet, store)).outcome);
		});
	const chain = stage.requiredChain;
	return (
		<Panel
			title="Your signature"
			description="An inner signature: your approval of exactly this action, for exactly this finaliser."
		>
			<div className="space-y-3">
				{stage.hasSigned ? (
					<p className="flex items-center gap-2 text-sm">
						<CheckCircle2 className="size-4 text-success" aria-hidden />
						{wallet.address ? short(wallet.address) : "You"} signed this.
					</p>
				) : stage.canSign ? (
					<>
						<Button variant="brand" disabled={wallet.busy} onClick={sign}>
							{chain && !stage.onRequiredChain
								? `Switch to ${chain.label.replace(/ \(\d+\)$/, "")} and sign`
								: `Sign as ${wallet.address ? short(wallet.address) : "…"}`}
						</Button>
						<p className="text-xs text-muted-foreground">
							Your wallet will show the action, the multi-sig account and the
							finaliser. Check them there: the wallet's display is the
							independent copy.
							{chain &&
								` Signed under ${chain.label}; nothing is sent to that chain.`}
						</p>
					</>
				) : (
					<p className="text-sm text-muted-foreground">{stage.signReason}</p>
				)}
				{outcome?.ok === true && (
					<Callout tone="success" title="Signature added">
						Saved in this browser. Pass the proposal on so the others can sign.
					</Callout>
				)}
				{outcome?.ok === false && (
					<Callout tone="danger" title="Not signed">
						<IssueList issues={outcome.issues} />
					</Callout>
				)}
			</div>
		</Panel>
	);
}
