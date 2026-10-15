import { Link } from "@tanstack/react-router";
import { useMultisigPrefs, usePrefsHydrated } from "#/store/multisigPrefsStore";
import { FIRST_RUN } from "../model/guide";
import { Btn, Card } from "../shell/kit";

/**
 * The first-run card: what a treasury is and how a payment goes, in six
 * numbered steps on the page itself (never a pop-up). Hidden for good in
 * this browser once the reader says so.
 */
export function FirstRun({ sharing }: { sharing: boolean }) {
	const hydrated = usePrefsHydrated();
	const seen = useMultisigPrefs((s) => s.walkthroughSeen);
	const dismiss = useMultisigPrefs((s) => s.dismissWalkthrough);
	// not before the stored choice is known: a card that flashes and goes is worse than none
	if (!hydrated || seen) return null;
	return (
		<Card
			title={FIRST_RUN.title}
			actions={
				<Btn size="sm" variant="ghost" onClick={dismiss}>
					{FIRST_RUN.hide}
				</Btn>
			}
		>
			<ol className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3 xl:gap-x-8">
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
								{i === 0 && (
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
		</Card>
	);
}
