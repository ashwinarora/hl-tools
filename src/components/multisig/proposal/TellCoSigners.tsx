import type { Proposal } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { download } from "#/lib/download";
import { RELAY_COPY } from "../model/relay/copy";
import { coSignerMessage } from "../model/relay/message";
import { fileTransport } from "../model/transport";
import { Btn, Card, linkButtonSm } from "../shell/kit";
import type { ProposalDoc } from "./useProposalDoc";

/**
 * With the relay in use: once a proposal is shared, co-signers already see
 * it, and this offers a line for the team's own chat. Before that it says the
 * proposal is only in this browser and offers to share it. Renders nothing
 * without the relay.
 */
export function TellCoSigners({
	proposal,
	doc,
}: {
	proposal: Proposal;
	doc: ProposalDoc;
}) {
	const [copied, setCopied] = useState(false);
	const r = doc.relay;
	if (!r.active || r.loading) return null;

	if (r.known) {
		const open = r.row?.status === "open" && !r.expired;
		if (!open) return null;
		const copy = async () => {
			const text = coSignerMessage({
				origin: window.location.origin,
				treasury: proposal.payload.multiSigUser,
				digest: proposal.digest,
			});
			try {
				await navigator.clipboard.writeText(text);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			} catch {
				setCopied(false);
			}
		};
		return (
			<Card title="Tell your co-signers">
				<div className="flex flex-wrap items-center gap-2">
					<Btn variant="outline" onClick={() => void copy()}>
						{copied ? "Copied" : "Copy message"}
					</Btn>
					<Btn
						variant="ghost"
						onClick={() => fileTransport(download).publish(proposal)}
					>
						Export as a file
					</Btn>
				</div>
				<p className="mt-2.5 text-xs text-subtle-foreground">
					They already see this in their pending list. The message is for your
					team chat: it names the treasury and links here, with no amounts.
				</p>
			</Card>
		);
	}

	return (
		<Card title="Only in this browser">
			{r.canPublish ? (
				<>
					<p className="text-sm text-muted-foreground">
						{RELAY_COPY.shareOnlyHere}
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Btn
							variant="brand"
							disabled={r.busy}
							onClick={() => void doc.publish()}
						>
							{r.busy ? "Sharing…" : "Share with your co-signers"}
						</Btn>
					</div>
				</>
			) : (
				<>
					<p className="text-sm text-muted-foreground">
						{r.blocker ??
							"This proposal has not been shared, and your wallet is not in the relay's list of signers for its treasury, so it cannot be shared from here. It still works as a link or a file."}
					</p>
					{!r.blocker && (
						<div className="mt-3">
							<Link to="/multisig/add" className={linkButtonSm}>
								Add the treasury
							</Link>
						</div>
					)}
				</>
			)}
		</Card>
	);
}
