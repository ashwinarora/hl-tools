import { shownLine } from "@hl-tools/core";

/** How long a title written by somebody else may be in a page's heading. */
const HEADING_MAX = 80;

/**
 * A page's heading from a proposal's unsigned title: quoted, cleaned and
 * cut, the whole of it on hover, so a title cannot pass for the action or
 * push the status off the screen (audit F-093, F-096). The action itself is
 * the large figure below it.
 */
export function TitleHeading({ title }: { title: string }) {
	const whole = shownLine(title);
	return (
		<span title={`${whole} (the title is not signed)`}>
			“<bdi>{shownLine(title, HEADING_MAX)}</bdi>”
		</span>
	);
}
