/**
 * How much of a treasury's proposals a page has in hand. Pure.
 *
 * loading      not read yet: nothing may be called "none on record"
 * ready        everything on record is in the list
 * unavailable  a part of the record could not be read: the list holds the
 *              rest, and nothing may be called "none on record" from it
 *
 * A proposal can be kept in this browser alone (made or opened without the
 * relay, or from a link). So the relay's list by itself is not the record:
 * the browser's own copies have to be read too before a transfer is said to
 * have no proposal, and before a new send is numbered after the ones on record.
 */
export type KnownState = "loading" | "ready" | "unavailable";

export interface KnownReads {
	/** The page asked for the record at all. */
	readonly enabled: boolean;
	/** A relay is in use: its list is part of the record. */
	readonly relay: boolean;
	readonly shared: "pending" | "read" | "failed";
	/** This browser's own copies. */
	readonly local: "pending" | "read" | "failed";
}

export function knownStateOf(r: KnownReads): KnownState {
	if (!r.enabled) return "loading";
	if (!r.relay)
		// no relay to ask: this browser's copies are all there is to go by
		return r.local === "pending" ? "loading" : "unavailable";
	if (r.shared === "failed" || r.local === "failed") return "unavailable";
	return r.shared === "read" && r.local === "read" ? "ready" : "loading";
}
