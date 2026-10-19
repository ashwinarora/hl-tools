import type { Address, Issue, Proposal } from "@hl-tools/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { download } from "#/lib/download";
import { RELAY_COPY } from "../model/relay/copy";
import { coSignerMessage } from "../model/relay/message";
import { fileTransport } from "../model/transport";
import { shareMove } from "../relay/api";
import { useRelay } from "../relay/useRelay";
import { Btn, Card, linkButtonSm } from "../shell/kit";
import type { ProposalDoc } from "./useProposalDoc";

/**
 * With the relay in use: once a proposal is shared, co-signers already see
 * it, and this offers a line for the team's own chat. Before that it says the
 * proposal is only in this browser and offers to share it. Renders nothing
 * without the relay.
 *
 * `also` is the other step where the proposal is the first step of a move.
 * The two are shared in one write and exported in one file: sharing one step
 * would put half a move in the co-signers' lists, where its finaliser could
 * send it alone.
 */
export function TellCoSigners({
	proposal,
	doc,
	also,
}: {
	proposal: Proposal;
	doc: ProposalDoc;
	also?: { readonly proposal: Proposal; readonly doc: ProposalDoc };
}) {
	const relay = useRelay();
	const queries = useQueryClient();
	const [copied, setCopied] = useState(false);
	const [sharing, setSharing] = useState(false);
	const [failed, setFailed] = useState<Issue | null>(null);
	const r = doc.relay;
	const all = also ? [{ proposal, doc }, also] : [{ proposal, doc }];
	if (!r.active || all.some((x) => x.doc.relay.loading)) return null;
	const missing = all.filter((x) => !x.doc.relay.known);

	if (missing.length === 0) {
		const open = all.some(
			(x) => x.doc.relay.row?.status === "open" && !x.doc.relay.expired,
		);
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
						onClick={() =>
							fileTransport(download).publish(
								proposal,
								also ? [also.proposal] : [],
							)
						}
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

	const half = missing.length < all.length;
	const blocker =
		missing.map((x) => x.doc.relay.blocker).find((b) => b) ?? null;
	const busy = sharing || all.some((x) => x.doc.relay.busy);
	const share = async () => {
		if (!also) {
			await doc.publish();
			return;
		}
		const client = relay.client;
		const as = relay.wallet as Address | null;
		if (!client || !as) return;
		setSharing(true);
		try {
			const done = await shareMove(
				client,
				as,
				all.map((x) => x.proposal),
			);
			setFailed(done.issue);
			await queries.invalidateQueries({ queryKey: ["relay", as] });
		} finally {
			setSharing(false);
		}
	};

	return (
		<Card title={half ? "Shared in part" : "Only in this browser"}>
			{missing.every((x) => x.doc.relay.canPublish) ? (
				<>
					<p className="text-sm text-muted-foreground">
						{half
							? RELAY_COPY.shareMoveHalf
							: also
								? RELAY_COPY.shareMoveOnlyHere
								: RELAY_COPY.shareOnlyHere}
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Btn variant="brand" disabled={busy} onClick={() => void share()}>
							{busy
								? "Sharing…"
								: half
									? "Share the other step"
									: "Share with your co-signers"}
						</Btn>
					</div>
					{failed && (
						<p className="mt-2.5 text-[13px] text-danger">
							{failed.message}
							{failed.fix ? ` ${failed.fix}` : ""}
						</p>
					)}
				</>
			) : (
				<>
					<p className="text-sm text-muted-foreground">
						{blocker ??
							`You can't share this ${also ? "move" : "proposal"} from here: your wallet is not listed as a signer of this treasury yet. Open the treasury page to check again, or send it as a link or a file.`}
					</p>
					{!blocker && (
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
