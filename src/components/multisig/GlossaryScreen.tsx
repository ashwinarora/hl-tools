import { GLOSSARY, GLOSSARY_META, GLOSSARY_TITLE } from "./model/guide";
import { Card } from "./shell/kit";
import { ShellPage } from "./shell/ShellPage";

/** The section's words in one place: each term, what it means, and the expert's word where screens avoid it. */
export function GlossaryScreen() {
	return (
		<ShellPage title={GLOSSARY_TITLE} meta={<span>{GLOSSARY_META}</span>}>
			{/* a reading width: the card ends where the definitions do */}
			<Card className="max-w-3xl">
				<dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-[minmax(9rem,max-content)_minmax(0,1fr)]">
					{GLOSSARY.map((t) => (
						<div key={t.term} className="contents">
							<dt className="text-sm font-semibold">{t.term}</dt>
							<dd className="-mt-3 text-sm leading-relaxed text-muted-foreground sm:mt-0">
								{t.body}
								{t.expert && (
									<span className="text-subtle-foreground">
										{" "}
										Experts call it the{" "}
										<span className="font-mono text-xs">{t.expert}</span>.
									</span>
								)}
							</dd>
						</div>
					))}
				</dl>
			</Card>
		</ShellPage>
	);
}
