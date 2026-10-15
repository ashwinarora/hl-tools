import { RefreshCw } from "lucide-react";
import { cn } from "#/lib/utils";
import type { HelpKey } from "../model/help";
import { Help } from "./Help";
import { ago } from "./kit";

/**
 * "Updated 2 minutes ago", with a way to check now. One per box whose figures
 * are asked for and not pushed: who controls the account, and its staking.
 * How often it is asked again is the help text's to say.
 */
export function Checked({
	observedAt,
	checking,
	failed,
	refetch,
	now,
	what,
	help = "checked",
}: {
	/** When what is shown was read; null while nothing has been. */
	observedAt: number | null;
	checking: boolean;
	/** The latest read failed; what is shown is from `observedAt`. */
	failed: boolean;
	refetch: () => void;
	now: number;
	/** What is read, for the button's label: "the signers". */
	what: string;
	help?: HelpKey;
}) {
	return (
		<>
			<span className="inline-flex flex-wrap items-center gap-x-1">
				{observedAt === null
					? checking
						? "Reading from Hyperliquid…"
						: failed
							? "Could not be read from Hyperliquid."
							: "Not read yet."
					: failed
						? `The last check failed. Shown as read ${ago(observedAt, now)}.`
						: `Updated ${ago(observedAt, now)}`}
				<Help k={help} />
			</span>
			<button
				type="button"
				onClick={refetch}
				disabled={checking}
				aria-label={`Check ${what} again now`}
				title="Check again now"
				className="inline-flex size-11 items-center justify-center rounded sm:size-6 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
			>
				<RefreshCw
					className={cn("size-3.5", checking && "animate-spin")}
					aria-hidden
				/>
			</button>
		</>
	);
}
