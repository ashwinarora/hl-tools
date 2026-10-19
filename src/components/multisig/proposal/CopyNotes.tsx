import type { Issue } from "@hl-tools/core";
import { Callout, IssueList } from "#/components/hub/status";

/**
 * What opening a copy (a link or a file) left out of it, or could not take:
 * said once, near the top of its page. A signature that does not match the
 * copy never counts, and the reader is told whose it claimed to be.
 */
export function CopyNotes({ notes }: { notes?: readonly Issue[] }) {
	const shown = (notes ?? []).filter((i) => i.severity !== "info");
	if (shown.length === 0) return null;
	return (
		<Callout
			tone="warning"
			title={
				shown.some((i) => i.code === "merge.signature_dropped")
					? "Signatures in the copy you opened do not match it"
					: "Notes on the copy you opened"
			}
		>
			<IssueList plain issues={shown} />
		</Callout>
	);
}
