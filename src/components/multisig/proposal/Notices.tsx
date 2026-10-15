import { ChevronDown } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { type NoticeId, notesLabel, planNotices } from "../model/notices";

/** A notice, or several of one kind; nothing when it is not there. */
type Shown = ReactNode | readonly ReactNode[];

const count = (n: Shown): number =>
	Array.isArray(n)
		? n.filter((x) => x !== null && x !== undefined && x !== false).length
		: n === null || n === undefined || n === false
			? 0
			: 1;

/**
 * The notices above a proposal's action: what must not be missed in full,
 * then everything else folded into "N notes" (`model/notices.ts` says which
 * is which).
 */
export function Notices({
	items,
}: {
	items: Partial<Record<NoticeId, Shown>>;
}) {
	const counts: Partial<Record<NoticeId, number>> = {};
	for (const [id, n] of Object.entries(items) as [NoticeId, Shown][])
		counts[id] = count(n);
	const plan = planNotices(counts);
	return (
		<>
			{plan.stops.map((id) => (
				<Fragment key={id}>{items[id] as ReactNode}</Fragment>
			))}
			{plan.noteCount > 0 && (
				<details className="group min-w-0">
					<summary className="inline-flex h-11 cursor-pointer list-none items-center gap-1 rounded-md px-0.5 text-[13px] font-medium text-muted-foreground hover:text-foreground sm:h-7 [&::-webkit-details-marker]:hidden">
						<ChevronDown
							className="size-3.5 -rotate-90 transition-transform group-open:rotate-0"
							aria-hidden
						/>
						{notesLabel(plan.noteCount)}
					</summary>
					<div className="mt-2 flex flex-col gap-3">
						{plan.notes.map((id) => (
							<Fragment key={id}>{items[id] as ReactNode}</Fragment>
						))}
					</div>
				</details>
			)}
		</>
	);
}
