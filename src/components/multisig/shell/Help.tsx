import { Hint } from "#/components/hub/Hint";
import { HELP, type HelpKey } from "../model/help";

/** The "?" for one of the section's terms. The texts live in `model/help`. */
export function Help({ k, className }: { k: HelpKey; className?: string }) {
	const t = HELP[k];
	return (
		<Hint title={t.title} className={className}>
			{t.body}
		</Hint>
	);
}
