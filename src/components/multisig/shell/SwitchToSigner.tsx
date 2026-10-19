import { cn } from "#/lib/utils";
import { switchSentence } from "../model/selfTreasury";
import { Sentence } from "../names/Sentence";
import { Help } from "./Help";

/**
 * "You are connected as the treasury itself. Switch to one of its signers: …"
 * For the pages of the treasury the connected wallet is, and only those.
 * A plain sentence: nothing to dismiss, nothing to click.
 */
export function SwitchToSigner({
	signers,
	className,
}: {
	/** The treasury's signers as Hyperliquid reports them; empty while unknown. */
	signers: readonly string[];
	className?: string;
}) {
	return (
		<p className={cn("text-[13px] text-muted-foreground", className)}>
			<Sentence parts={switchSentence(signers)} /> <Help k="treasuryAccount" />
		</p>
	);
}
