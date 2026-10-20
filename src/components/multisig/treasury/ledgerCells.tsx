/**
 * Two cells every table of ledger rows has: when a row happened, with a way
 * to its transaction, and which proposal caused it. Shared by "On
 * Hyperliquid" and the Vaults tab's history, so a row reads the same in both.
 */
import type { Network } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";
import { explorerTxUrl } from "../model/chain/columns";
import type { LookupFailure, RowProposal } from "../model/chain/match";
import { When } from "../shell/live";

/** The time of a row, with a way to the transaction itself where there is one. */
export function TimeCell({
	at,
	network,
	hash,
}: {
	at: number;
	network: Network;
	hash?: string | null;
}) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<When at={at} seconds />
			{hash && !/^0x0+$/.test(hash) && (
				<a
					href={explorerTxUrl(network, hash)}
					target="_blank"
					rel="noopener noreferrer"
					aria-label="Open this transaction on Hyperliquid's explorer"
					title="Open this transaction on Hyperliquid's explorer"
					className="text-subtle-foreground hover:text-foreground"
				>
					<ExternalLink className="size-3" aria-hidden />
				</a>
			)}
		</span>
	);
}

const quiet = "text-xs text-subtle-foreground";

/** Which proposal caused a row. Plain and small: most rows of most accounts have none. */
/** Why a row could not be checked, on its "Check again" button (audit F-065). */
const UNCHECKED: Record<NonNullable<LookupFailure>, string> = {
	limited:
		"Hyperliquid's explorer is limiting requests right now. Check again in a minute.",
	today:
		"Hyperliquid's explorer refused more look-ups from this network address for today. Check again later.",
	"no-answer": "Hyperliquid's explorer did not answer. Check again.",
};

export function ProposalCell({
	match,
	titles,
	onRetry,
}: {
	match: RowProposal;
	titles: ReadonlyMap<string, string>;
	onRetry: () => void;
}) {
	const link = (digest: string, text: ReactNode) => (
		<Link
			key={digest}
			to="/multisig/proposal"
			search={{ digest }}
			className="text-brand underline underline-offset-2"
		>
			{text}
		</Link>
	);
	switch (match.kind) {
		case "not-applicable":
			return null;
		case "own-step":
			return (
				<span
					className={quiet}
					title="A return from staking lands by itself when its wait is over. The step that started it is in the Staking tab's history."
				>
					Hyperliquid's own step
				</span>
			);
		case "none":
			return <span className={quiet}>none on record</span>;
		case "checking":
			return <span className={quiet}>checking…</span>;
		case "unchecked":
			return (
				<span className={cn(quiet, "inline-flex items-center gap-1")}>
					could not check
					<button
						type="button"
						onClick={onRetry}
						aria-label="Check this row again"
						title={match.why ? UNCHECKED[match.why] : "Check again"}
						className="rounded p-0.5 hover:bg-surface-2 hover:text-foreground"
					>
						<RefreshCw className="size-3" aria-hidden />
					</button>
				</span>
			);
		case "matched":
			return link(match.digest, titles.get(match.digest) ?? "open");
		case "likely":
			return (
				<span
					className="text-xs"
					title="A vault action carries no number of its own, so Hyperliquid's record cannot prove which proposal a row came from. This is the one proposal on record that agrees with it."
				>
					likely {link(match.digest, titles.get(match.digest) ?? "open")}
				</span>
			);
		case "ambiguous":
			return (
				<span className="text-xs">
					one of{" "}
					{match.digests.map((d, i) => (
						<span key={d}>
							{i > 0 && ", "}
							{link(d, titles.get(d) ?? `proposal ${i + 1}`)}
						</span>
					))}
				</span>
			);
	}
}
