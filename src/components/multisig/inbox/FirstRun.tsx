import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "#/lib/utils";
import { useMultisigPrefs, usePrefsHydrated } from "#/store/multisigPrefsStore";
import { FIRST_RUN } from "../model/guide";
import { Btn, Card } from "../shell/kit";

/** The six numbered steps of how this works: the first-run card's, and the glossary's. */
export function WalkSteps({
	sharing,
	glossaryLink = true,
	className,
}: {
	sharing: boolean;
	/** The first step's link to the glossary (not on the glossary itself). */
	glossaryLink?: boolean;
	className?: string;
}) {
	return (
		<ol
			className={cn(
				"grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3 xl:gap-x-8",
				className,
			)}
		>
			{FIRST_RUN.steps(sharing).map((step, i) => (
				<li key={step.title} className="flex gap-3">
					<span
						className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand"
						aria-hidden
					>
						{i + 1}
					</span>
					<span className="flex min-w-0 flex-col gap-1">
						<b className="text-sm font-semibold">{step.title}</b>
						<span className="text-[13px] text-muted-foreground">
							{step.body}
							{i === 0 && glossaryLink && (
								<>
									{" "}
									<Link
										to="/multisig/glossary"
										className="text-foreground underline underline-offset-2"
									>
										{FIRST_RUN.glossary}
									</Link>
								</>
							)}
						</span>
					</span>
				</li>
			))}
		</ol>
	);
}

/**
 * The first-run card: what a treasury is and how a payment goes, in six
 * numbered steps on the page itself (never a pop-up). "Hide this" folds it
 * to its title, which opens it again; the same steps head the glossary.
 */
export function FirstRun({ sharing }: { sharing: boolean }) {
	const hydrated = usePrefsHydrated();
	const folded = useMultisigPrefs((s) => s.walkthroughSeen);
	const setFolded = useMultisigPrefs((s) => s.setWalkthroughFolded);
	// not before the stored choice is known: a card that flashes and goes is worse than none
	if (!hydrated) return null;
	if (folded)
		return (
			<button
				type="button"
				aria-expanded={false}
				onClick={() => setFolded(false)}
				className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:min-h-0"
			>
				<ChevronRight className="size-3.5" aria-hidden />
				{FIRST_RUN.title}
			</button>
		);
	return (
		<Card
			title={FIRST_RUN.title}
			actions={
				<Btn size="sm" variant="ghost" onClick={() => setFolded(true)}>
					{FIRST_RUN.hide}
				</Btn>
			}
		>
			<WalkSteps sharing={sharing} />
		</Card>
	);
}
