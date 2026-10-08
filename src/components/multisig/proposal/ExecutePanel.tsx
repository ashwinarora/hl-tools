import {
	buildEnvelope,
	classifySignatures,
	type Issue,
	infoClient,
	type Policy,
	type Proposal,
	readiness,
	signEnvelope,
} from "@hl-tools/core";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { Panel } from "#/components/hub/layout";
import { Callout, IssueList } from "#/components/hub/status";
import { Button } from "#/components/ui/button";
import { errorMessage } from "#/hooks/useHyperliquid";
import { type Stage, shortAddress } from "../model/stage";
import { submitEnvelope, withReceipt } from "../model/submit";
import type { WalletSigner } from "../useWalletSigner";
import { signInner } from "./SignPanel";
import type { StoreResult } from "./useProposalDoc";

type StepId = "inner" | "envelope" | "submit";
type StepState = "todo" | "active" | "done" | "failed";

const ICON: Record<StepState, typeof Circle> = {
	todo: Circle,
	active: Loader2,
	done: CheckCircle2,
	failed: XCircle,
};
const ICON_CLASS: Record<StepState, string> = {
	todo: "text-subtle-foreground",
	active: "animate-spin text-info",
	done: "text-success",
	failed: "text-danger",
};

const problem = (message: string): Issue[] => [
	{ code: "execute", severity: "error", message },
];

/**
 * The finaliser's part: if their own signature is what completes the
 * threshold it is made first, then the envelope is built from the verified
 * signatures, signed under the same chain, and POSTed to Hyperliquid from this
 * browser. Whatever the exchange answers goes back into the document.
 */
export function ExecutePanel({
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
	const [steps, setSteps] = useState<Record<StepId, StepState>>({
		inner: "todo",
		envelope: "todo",
		submit: "todo",
	});
	const [failure, setFailure] = useState<readonly Issue[] | null>(null);
	const { network, multiSigUser, outerSigner } = proposal.payload;
	const needsInner = stage.executeAddsSignature;

	const execute = () =>
		void wallet.run("Waiting for the wallet…", async () => {
			setFailure(null);
			setSteps({ inner: "todo", envelope: "todo", submit: "todo" });
			const mark = (id: StepId, state: StepState) =>
				setSteps((s) => ({ ...s, [id]: state }));
			const stop = (id: StepId, issues: readonly Issue[]) => {
				mark(id, "failed");
				setFailure(issues);
			};
			const chain = stage.requiredChain;
			if (!chain) return stop("envelope", problem("No signing chain."));

			let current = proposal;
			if (needsInner) {
				mark("inner", "active");
				const signed = await signInner(current, stage, wallet, store);
				if (!signed.outcome.ok) return stop("inner", signed.outcome.issues);
				current = signed.proposal;
				mark("inner", "done");
			}

			// Judge the document as it is now against the signer set the chain reports now:
			// nothing is posted on the strength of what the page knew a moment ago.
			mark("envelope", "active");
			let policy: Policy;
			try {
				const observed =
					await infoClient(network).multiSigSigners(multiSigUser);
				policy = observed.data ?? {
					authorizedUsers: [],
					threshold: 0,
					observedAt: observed.observedAt,
				};
			} catch (e) {
				return stop(
					"envelope",
					problem(`The signer set could not be read: ${errorMessage(e)}`),
				);
			}
			const classified = await classifySignatures(current, policy);
			const ready = readiness(current, policy, classified);
			if (ready.status !== "ready") {
				return stop(
					"envelope",
					ready.issues.length
						? ready.issues
						: problem(
								`Not ready: ${ready.have} of ${ready.need ?? "?"} signatures count against the current signer set.`,
							),
				);
			}
			const { request } = buildEnvelope(current, {
				signatureChainId: chain.hex,
				classified,
			});
			const got = await wallet.signerFor(chain.hex);
			if (!got.ok) return stop("envelope", problem(got.error));
			const outer = await signEnvelope(request, network, got.signer);
			if (!outer.signature) return stop("envelope", outer.issues);
			mark("envelope", "done");

			mark("submit", "active");
			try {
				const sent = await submitEnvelope(network, request, outer.signature);
				// the receipt is kept whether the chain accepted or not; the page explains it
				await store(withReceipt(current, sent.receipt));
				mark("submit", sent.explained.id === "ok" ? "done" : "failed");
			} catch (e) {
				stop(
					"submit",
					problem(
						`The request did not reach Hyperliquid: ${errorMessage(e)} Nothing was submitted; it is safe to try again.`,
					),
				);
			}
		});

	const rows: { id: StepId; label: string }[] = [
		...(needsInner || steps.inner !== "todo"
			? [
					{
						id: "inner" as const,
						label: "Your inner signature (completes the threshold)",
					},
				]
			: []),
		{
			id: "envelope",
			label: "Envelope signature (wraps the verified signatures)",
		},
		{ id: "submit", label: `Submit to Hyperliquid ${network}` },
	];

	return (
		<Panel
			title="Finalise"
			description={`Only the finaliser ${shortAddress(outerSigner)} can do this: it was fixed when the proposal was created.`}
		>
			<div className="space-y-3">
				{stage.canExecute ? (
					<>
						<ol className="space-y-1.5 text-sm">
							{rows.map((row) => {
								const Icon = ICON[steps[row.id]];
								return (
									<li key={row.id} className="flex items-center gap-2">
										<Icon
											className={`size-4 shrink-0 ${ICON_CLASS[steps[row.id]]}`}
											aria-hidden
										/>
										<span>{row.label}</span>
										<span className="sr-only">: {steps[row.id]}</span>
									</li>
								);
							})}
						</ol>
						<Button variant="brand" disabled={wallet.busy} onClick={execute}>
							{needsInner ? "Sign and submit" : "Sign the envelope and submit"}
						</Button>
						<p className="text-xs text-muted-foreground">
							{needsInner ? "Two wallet prompts" : "One wallet prompt"}, then
							one request to the exchange from this browser. This moves real
							funds on {network} if the action does.
						</p>
					</>
				) : (
					<p className="text-sm text-muted-foreground">{stage.executeReason}</p>
				)}
				{failure && (
					<Callout tone="danger" title="Not submitted">
						<IssueList issues={failure} />
					</Callout>
				)}
			</div>
		</Panel>
	);
}
