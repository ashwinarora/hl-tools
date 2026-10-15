import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useId, useMemo } from "react";
import { toast } from "sonner";
import { Callout } from "#/components/hub/status";
import { useMultisigPrefs, usePrefsHydrated } from "#/store/multisigPrefsStore";
import {
	type AwayGroup,
	type AwayScope,
	type ChainState,
	useAway,
} from "../away/useAway";
import { useRecords } from "../live/useRecord";
import type { RecordQuestion } from "../model/chain/record";
import type { AwayItem } from "../model/relay/away";
import { RELAY_COPY } from "../model/relay/copy";
import { NamesFor } from "../names/Names";
import { Sentence } from "../names/Sentence";
import { RecordTag } from "../proposal/RecordNote";
import { Help } from "../shell/Help";
import { Btn } from "../shell/kit";
import { When } from "../shell/live";
import { useTreasuryNames } from "../treasuryName";

/** Lines shown per treasury before the rest are left to the Signing log. */
const SHOWN = 8;

/** What a group says under its lines while Hyperliquid's side is not settled. */
const CHAIN_LINE: Record<Exclude<ChainState, "checked">, string> = {
	checking: RELAY_COPY.awayChecking,
	failed: RELAY_COPY.awayFailed,
	partly: RELAY_COPY.awayPartly,
	"not-checked": RELAY_COPY.awayNotChecked,
};

const viewLink =
	"shrink-0 text-xs font-medium text-brand underline underline-offset-2 hover:no-underline";

function View({ group, item }: { group: AwayGroup; item: AwayItem }) {
	return item.go.kind === "proposal" ? (
		<Link
			to="/multisig/proposal"
			search={{ digest: item.go.digest }}
			className={viewLink}
		>
			View
		</Link>
	) : (
		<Link
			to="/multisig/t/$network/$address"
			params={{ network: group.network, address: group.treasury }}
			search={{ tab: item.go.tab }}
			className={viewLink}
		>
			View
		</Link>
	);
}

/**
 * A group's lines, each report of acceptance with what Hyperliquid's record
 * says of it. Only the lines on screen are checked: one read of the
 * treasury's newest transactions, the one "On Hyperliquid" makes.
 */
function Lines({ group }: { group: AwayGroup }) {
	const shown = useMemo(() => group.items.slice(0, SHOWN), [group.items]);
	const questions = useMemo(() => {
		const out = new Map<string, RecordQuestion>();
		for (const item of shown)
			for (const r of item.records ?? []) out.set(r.digest, r.question);
		return out;
	}, [shown]);
	const records = useRecords(group.network, questions);
	return (
		<>
			{shown.map((item) => (
				<li
					key={item.key}
					className="flex flex-col gap-0.5 text-[13px] min-[601px]:flex-row min-[601px]:items-baseline min-[601px]:justify-between min-[601px]:gap-3"
				>
					<span className="min-w-0 [overflow-wrap:anywhere]">
						<Sentence parts={item.parts} />
						{item.records && (
							<>
								{" "}
								<RecordTag
									verdicts={item.records.map((r) => records.get(r.digest))}
								/>
							</>
						)}
					</span>
					<View group={group} item={item} />
				</li>
			))}
		</>
	);
}

/**
 * "While you were away": what finished or changed since the signer last said
 * "Got it", per treasury. Showing it, or following a "View", marks nothing
 * as read: only the button does. On a treasury's own page it is that
 * treasury's group alone.
 */
export function AwayNotice({ scope }: { scope: AwayScope }) {
	const away = useAway(scope);
	const nameOf = useTreasuryNames();
	// folded or not is the reader's, remembered in this browser for every page that has it
	const hydrated = usePrefsHydrated();
	const folded = useMultisigPrefs((s) => s.awayFolded) && hydrated;
	const setFolded = useMultisigPrefs((s) => s.setAwayFolded);
	const bodyId = useId();
	const single = typeof scope === "object";
	const groups = away.groups;
	const others = scope === "all" && away.notChecked > 0;

	if (groups.length === 0) {
		return (
			<>
				{away.issue && scope === "all" && (
					<Callout tone="warning" title={away.issue.message}>
						{away.issue.fix}
					</Callout>
				)}
				{others && (
					<p className="mx-0.5 text-xs text-subtle-foreground">
						{RELAY_COPY.awayOthers}
					</p>
				)}
			</>
		);
	}
	const since = Math.min(...groups.map((g) => g.since));
	const gotIt = async (which: readonly AwayGroup[], said: string) => {
		if (await away.gotIt(which)) toast(said);
	};

	return (
		<section
			aria-label={RELAY_COPY.awayTitle}
			className="rounded-[10px] border border-info/35 bg-surface shadow-sm"
		>
			<header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
				<h2 className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold">
					<button
						type="button"
						aria-expanded={!folded}
						aria-controls={bodyId}
						onClick={() => setFolded(!folded)}
						className="-mx-1 inline-flex min-h-11 items-center gap-1 rounded px-1 hover:text-foreground sm:min-h-0"
					>
						<ChevronDown
							className={`size-4 transition-transform ${folded ? "-rotate-90" : ""}`}
							aria-hidden
						/>
						{RELAY_COPY.awayTitle}
					</button>
					<span className="font-normal text-subtle-foreground">
						{folded
							? `· ${groups.reduce((n, g) => n + g.items.length, 0)} to read`
							: null}{" "}
						· since <When at={since} />
					</span>
					<Help k="away" />
				</h2>
				{single ? (
					<Btn
						size="sm"
						variant="outline"
						disabled={away.busy}
						onClick={() => void gotIt(groups, RELAY_COPY.awayGotIt)}
					>
						Got it
					</Btn>
				) : (
					<Btn
						size="sm"
						variant="ghost"
						disabled={away.busy}
						onClick={() => void gotIt(groups, RELAY_COPY.awayAll)}
					>
						Mark all as read
					</Btn>
				)}
			</header>
			{/* not before the stored choice is known: open and then folded is a flash */}
			<div id={bodyId} hidden={folded || !hydrated}>
				{away.issue && (
					<p className="border-b border-border px-4 py-2 text-xs text-warning">
						{away.issue.message} {away.issue.fix}
					</p>
				)}
				{groups.map((g) => (
					<div
						key={`${g.network}:${g.treasury}`}
						className="border-t border-border px-4 py-3 first-of-type:border-t-0"
					>
						{!single && (
							<div className="mb-1.5 flex items-center justify-between gap-2.5">
								<Link
									to="/multisig/t/$network/$address"
									params={{ network: g.network, address: g.treasury }}
									className="min-w-0 truncate text-[13px] font-semibold text-foreground no-underline hover:underline"
								>
									{nameOf(g.network, g.treasury)}
								</Link>
								<Btn
									size="sm"
									variant="outline"
									disabled={away.busy}
									onClick={() => void gotIt([g], RELAY_COPY.awayGotIt)}
								>
									Got it
								</Btn>
							</div>
						)}
						<NamesFor network={g.network} treasury={g.treasury}>
							<ul className="flex flex-col gap-1.5">
								{/* folded, nothing is asked of the explorer for lines nobody sees */}
								{!folded && hydrated && <Lines group={g} />}
								{g.items.length > SHOWN && (
									<li className="text-xs text-muted-foreground">
										and {g.items.length - SHOWN} more, in the{" "}
										<Link
											to="/multisig/t/$network/$address"
											params={{ network: g.network, address: g.treasury }}
											search={{ tab: "log" }}
											className="underline underline-offset-2"
										>
											Signing log
										</Link>
									</li>
								)}
							</ul>
						</NamesFor>
						{g.chain !== "checked" && (
							<p
								className={`mt-2 text-xs ${g.chain === "failed" || g.chain === "partly" ? "text-warning" : "text-subtle-foreground"}`}
							>
								{CHAIN_LINE[g.chain]}
							</p>
						)}
					</div>
				))}
				{others && (
					<p className="border-t border-border px-4 py-2 text-xs text-subtle-foreground">
						{RELAY_COPY.awayOthers}
					</p>
				)}
			</div>
		</section>
	);
}
