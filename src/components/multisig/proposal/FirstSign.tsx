import { useMultisigPrefs, usePrefsHydrated } from "#/store/multisigPrefsStore";
import { FIRST_SIGN } from "../model/guide";

/**
 * One line above a proposal the reader can sign, for someone who has not
 * hidden the first-run card: usually a co-signer who came by a shared link.
 * "Got it" hides both.
 */
export function FirstSign({ canSign }: { canSign: boolean }) {
	const hydrated = usePrefsHydrated();
	const seen = useMultisigPrefs((s) => s.walkthroughSeen);
	const dismiss = useMultisigPrefs((s) => s.dismissWalkthrough);
	if (!canSign || !hydrated || seen) return null;
	return (
		<p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-[13px]">
			<span className="min-w-0 flex-1">{FIRST_SIGN.text}</span>
			<button
				type="button"
				onClick={dismiss}
				className="inline-flex h-11 items-center font-medium underline underline-offset-2 sm:h-auto"
			>
				{FIRST_SIGN.ok}
			</button>
		</p>
	);
}
