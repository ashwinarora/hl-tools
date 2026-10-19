import { Hint } from "#/components/hub/Hint";
import { cn } from "#/lib/utils";
import { HELP, type HelpKey } from "../model/help";

/**
 * The "?" for one of the section's terms. The texts live in `model/help`.
 * On a phone the button itself is 24 px square, the mark inside it as
 * small as before and the line around it no taller, so a finger finds it.
 */
export function Help({ k, className }: { k: HelpKey; className?: string }) {
	const t = HELP[k];
	return (
		<Hint
			title={t.title}
			className={cn("max-sm:-my-1 max-sm:size-6", className)}
		>
			{t.body}
		</Hint>
	);
}
