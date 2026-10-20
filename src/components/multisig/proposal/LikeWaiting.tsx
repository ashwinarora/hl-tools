import { shownLine } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { LIKE_WAITING } from "../model/duplicates";

/**
 * One amber line, with a link: a proposal paying the same thing is still
 * waiting (decision D4). Nothing is blocked; the reader decides.
 */
export function LikeWaiting({
	like,
}: {
	like: { readonly digest: string; readonly title: string } | null;
}) {
	if (!like) return null;
	return (
		<p className="mt-3 flex items-start gap-1.5 text-[13px] text-warning">
			<span
				className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-warning"
				aria-hidden
			/>
			<span>
				{LIKE_WAITING}{" "}
				<Link
					to="/multisig/proposal"
					search={{ digest: like.digest }}
					className="underline underline-offset-2"
				>
					{shownLine(like.title, 60) ? (
						// somebody else's words: quoted, cleaned, cut
						<>
							“<bdi>{shownLine(like.title, 60)}</bdi>”
						</>
					) : (
						"Open it"
					)}
				</Link>
			</span>
		</p>
	);
}
