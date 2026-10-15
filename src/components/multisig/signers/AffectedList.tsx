import { Link } from "@tanstack/react-router";
import { CHANGE } from "../model/change";
import type { Affected } from "../model/signerSet";
import { Sentence } from "../names/Sentence";
import type { KnownState } from "../treasury/useKnownProposals";

/**
 * The waiting proposals a change of signers touches, each with what happens
 * to it. "None" is said only once every proposal on record was read; when the
 * record could not be read, or there is none beyond this browser, that is
 * said instead of a reassurance.
 */
export function AffectedList({
	affected,
	computing,
	state,
	relayInUse,
}: {
	affected: readonly Affected[];
	computing: boolean;
	/** How much of the treasury's proposals the page could read. */
	state: KnownState;
	/** A relay keeps this treasury's proposals for the wallet looking at it. */
	relayInUse: boolean;
}) {
	const reading = computing || state === "loading";
	return (
		<div className="flex flex-col gap-1.5">
			<h3 className="text-xs font-medium">{CHANGE.affectedTitle}</h3>
			{affected.length > 0 && (
				<ul className="flex flex-col gap-1.5">
					{affected.map((a) => (
						<li key={a.digest} className="text-[13px] [overflow-wrap:anywhere]">
							<Link
								to="/multisig/proposal"
								search={{ digest: a.digest }}
								className="font-medium underline underline-offset-2"
							>
								{a.title}
							</Link>{" "}
							<span className="text-warning">
								<Sentence parts={a.parts} />
							</span>
						</li>
					))}
				</ul>
			)}
			{reading ? (
				<p className="text-[13px] text-muted-foreground" aria-busy="true">
					{CHANGE.affectedReading}
				</p>
			) : state === "ready" ? (
				affected.length === 0 && (
					<p className="text-[13px] text-muted-foreground">
						{CHANGE.affectedNone}
					</p>
				)
			) : (
				<p className="text-xs text-muted-foreground">
					{relayInUse ? CHANGE.affectedPartial : CHANGE.affectedLocal}
				</p>
			)}
		</div>
	);
}
