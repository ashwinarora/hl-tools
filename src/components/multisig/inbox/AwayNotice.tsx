import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Callout } from "#/components/hub/status";
import { type AwayGroup, type AwayScope, useAway } from "../away/useAway";
import type { AwayItem } from "../model/relay/away";
import { RELAY_COPY } from "../model/relay/copy";
import { NamesFor } from "../names/Names";
import { Sentence } from "../names/Sentence";
import { Btn } from "../shell/kit";
import { When } from "../shell/live";
import { useTreasuryNames } from "../treasuryName";

/** Lines shown per treasury before the rest are left to the Signing log. */
const SHOWN = 8;

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
 * "While you were away": what finished or changed since the signer last said
 * "Got it", per treasury. Showing it, or following a "View", marks nothing
 * as read: only the button does. On a treasury's own page it is that
 * treasury's group alone.
 */
export function AwayNotice({ scope }: { scope: AwayScope }) {
	const away = useAway(scope);
	const nameOf = useTreasuryNames();
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
				<h2 className="text-sm font-semibold">
					{RELAY_COPY.awayTitle}{" "}
					<span className="font-normal text-subtle-foreground">
						· since <When at={since} />
					</span>
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
							{g.items.slice(0, SHOWN).map((item) => (
								<li
									key={item.key}
									className="flex flex-col gap-0.5 text-[13px] min-[601px]:flex-row min-[601px]:items-baseline min-[601px]:justify-between min-[601px]:gap-3"
								>
									<span className="min-w-0 [overflow-wrap:anywhere]">
										<Sentence parts={item.parts} />
									</span>
									<View group={g} item={item} />
								</li>
							))}
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
							className={`mt-2 text-xs ${g.chain === "failed" ? "text-warning" : "text-subtle-foreground"}`}
						>
							{g.chain === "failed"
								? RELAY_COPY.awayFailed
								: g.chain === "checking"
									? RELAY_COPY.awayChecking
									: RELAY_COPY.awayNotChecked}
						</p>
					)}
				</div>
			))}
			{others && (
				<p className="border-t border-border px-4 py-2 text-xs text-subtle-foreground">
					{RELAY_COPY.awayOthers}
				</p>
			)}
		</section>
	);
}
