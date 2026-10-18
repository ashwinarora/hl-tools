import { type Address, type Network, stakingActionOf } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { FLAG_TEXT } from "#/components/tools/multisig/EnvelopeView";
import { cn } from "#/lib/utils";
import { useValidators } from "../live/useStaking";
import { LONE_STEP_HINT, moveSentence } from "../model/move";
import { closes } from "../model/nonce";
import { finishLabel, inboxGroup, STUCK_WORDS } from "../model/relay/inbox";
import { blockedTag, saidNoTag } from "../model/relay/positions";
import { actionLine } from "../model/staking";
import { localDateTime, utcDateTime } from "../model/time";
import { NamesFor, Who } from "../names/Names";
import type { OpenProposal } from "../relay/openProposals";
import { Pips, Tag } from "../shell/kit";
import { useNow } from "../shell/live";

/**
 * The columns of the list. Narrow: the action, its signatures, and its state
 * under them. Beside the rail: the three side by side. From 1280 px the list
 * reads as a table: the action, the treasury (in lists that span them), when
 * it closes, the signatures and the state, each in its own column. Every row
 * shares the list's columns (a subgrid), so each is as wide as its widest
 * cell and the rows line up.
 */
const TABLE = {
	spanning:
		"xl:grid-cols-[minmax(0,1fr)_fit-content(11rem)_fit-content(11rem)_auto_fit-content(13rem)]",
	single:
		"xl:grid-cols-[minmax(0,1fr)_fit-content(11rem)_auto_fit-content(13rem)]",
};

/**
 * Open proposals as a list. The big line is the action in words (what signers
 * sign); the title under it is whatever the proposer typed, and is never
 * shown alone.
 */
export function ProposalRows({
	items,
	me,
	treasuryName,
}: {
	items: readonly OpenProposal[];
	me: Address;
	/** Given in lists that span treasuries; omitted inside one treasury's page. */
	treasuryName?: (item: OpenProposal) => string;
}) {
	const now = useNow(60_000);
	// A staking row names its validator as its own page does. The list of
	// validators is asked for only on a network where such a row is shown.
	const staking = (network: Network) =>
		items.some(
			(p) =>
				p.network === network &&
				(!!p.move || stakingActionOf(p.proposal.payload.action) !== null),
		);
	const names = {
		mainnet: useValidators("mainnet", staking("mainnet")),
		testnet: useValidators("testnet", staking("testnet")),
	};
	const lineOf = (p: OpenProposal): string =>
		p.move
			? moveSentence(p.move, names[p.network])
			: stakingActionOf(p.proposal.payload.action)
				? actionLine(p.proposal.payload.action, names[p.network], p.network)
				: p.line;
	return (
		<div
			className={cn(
				"flex flex-col xl:grid xl:gap-x-3.5",
				treasuryName ? TABLE.spanning : TABLE.single,
			)}
		>
			{items.map((p) => {
				const group = inboxGroup(p, me);
				// When its signing window closes, on every row that is still waiting:
				// it is what decides how long a held-up proposal stays in the list.
				const closing =
					p.open && !p.stuck && !p.frozen ? closes(p.row.expiresAt, now) : null;
				const against = p.objected.includes(me);
				const closingText = closing && (
					// one moment, broken only between its two halves where the column is narrow
					<span
						className={closing.soon ? "text-warning" : undefined}
						title={`Its signing window closes ${utcDateTime(closing.at)}. After that it has to be proposed again.`}
					>
						<span className="whitespace-nowrap">
							closes {localDateTime(closing.at)}
						</span>{" "}
						<span className="whitespace-nowrap">· {closing.inWords}</span>
					</span>
				);
				return (
					<Link
						key={`${p.network}:${p.treasury}:${p.digest}`}
						to="/multisig/proposal"
						search={{ digest: p.digest }}
						className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 border-t border-border px-4 py-3 text-left no-underline transition-colors first:border-t-0 hover:bg-surface-2 min-[861px]:grid-cols-[minmax(0,1fr)_auto_auto] xl:col-span-full xl:grid-cols-subgrid"
					>
						<span className="min-w-0">
							<span className="block text-sm font-medium [overflow-wrap:anywhere]">
								{lineOf(p)}
							</span>
							<span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
								{treasuryName && (
									<span className="xl:hidden">{treasuryName(p)}</span>
								)}
								{p.title && <span>{p.title}</span>}
								{p.steps ? (
									<Tag title="Two proposals that are one move: signed together, sent one after the other.">
										2 steps
									</Tag>
								) : (
									p.lone && <Tag title={LONE_STEP_HINT}>step {p.lone} of 2</Tag>
								)}
								<span>
									by{" "}
									{p.createdBy === me ? (
										"you"
									) : (
										<NamesFor network={p.network} treasury={p.treasury}>
											<Who address={p.createdBy} />
										</NamesFor>
									)}
								</span>
								{p.flags.map((f) => (
									<Tag
										key={f}
										// a long one wraps on a narrow phone; 10 px is as round as a full radius on one line
										className="whitespace-normal rounded-[10px]"
										tone={
											FLAG_TEXT[f]?.tone === "danger"
												? "danger"
												: FLAG_TEXT[f]?.tone === "info"
													? "info"
													: "warn"
										}
									>
										{FLAG_TEXT[f]?.label ?? f}
									</Tag>
								))}
								{p.objected.length > 0 &&
									!p.blocked &&
									// the reader's own, alone, is said once: on the right
									!(against && p.objected.length === 1) && (
										// amber: a no is a position the others should know of, not a fault
										<Tag tone="warn">{saidNoTag(p.objected.length, false)}</Tag>
									)}
								{closingText && (
									<span className="xl:hidden">{closingText}</span>
								)}
							</span>
						</span>
						{/* from 1280 px the treasury and the moment it closes have columns of their own */}
						{treasuryName && (
							<span
								className="hidden min-w-0 truncate text-[13px] text-muted-foreground xl:block"
								title={treasuryName(p)}
							>
								{treasuryName(p)}
							</span>
						)}
						<span className="hidden min-w-0 text-xs text-muted-foreground xl:block">
							{closingText}
						</span>
						<Pips have={p.counted.length} need={p.threshold} />
						<span className="col-span-2 min-w-0 justify-self-start min-[861px]:col-span-1 min-[861px]:justify-self-end [&>*]:max-w-full [&>*]:whitespace-normal">
							{group === "finish" ? (
								<span className="inline-flex h-7 items-center rounded-md bg-brand px-2.5 text-xs font-medium text-brand-foreground">
									{finishLabel(p, me)} ▸
								</span>
							) : group === "sign" ? (
								<span className="inline-flex h-7 items-center rounded-md border border-border-strong bg-surface px-2.5 text-xs font-medium">
									Sign ▸
								</span>
							) : p.frozen ? (
								<Tag tone="warn">no longer a multi-sig</Tag>
							) : p.stuck ? (
								<Tag tone="warn">
									{p.stuckBy
										? `cannot be finished: ${STUCK_WORDS[p.stuckBy]}`
										: "cannot be finished"}
								</Tag>
							) : p.blocked ? (
								<Tag tone="warn">{blockedTag(p.blocked)}</Tag>
							) : against ? (
								<Tag tone="warn">you said no</Tag>
							) : (
								<Tag>waiting on others</Tag>
							)}
						</span>
					</Link>
				);
			})}
		</div>
	);
}
