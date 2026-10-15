/**
 * Which network a page that signs is on. Such a page names its network in its
 * own link (the propose form, the create wizard, a treasury page), because the
 * header's choice is stored once for the whole browser: another tab can change
 * it, and a page that took it from there would come back from a reload on the
 * other network, with the same address and a different treasury behind it.
 *
 * Two things can move, and each wins in its own moment:
 *   the link    when the page opens, or the reader follows another link:
 *               the header follows it
 *   the header  when the reader uses its switch on the open page: the link is
 *               rewritten (and the page starts over on that network)
 * A link that names no network (an older one) gets the header's written in,
 * so a reload cannot move it afterwards.
 *
 * Pure: the hook around it (`shell/usePageNetwork`) feeds it the two values
 * and what it saw last time.
 */
import type { Network } from "@hl-tools/core";

export interface SeenNetworks {
	/** The link's network when this last ran; null when it named none. */
	readonly asked: Network | null;
	readonly header: Network;
}

export interface PageNetworkStep {
	/** Set the header to this. */
	readonly header?: Network;
	/** Write this into the page's link. */
	readonly link?: Network;
	/** What to remember for the next run. */
	readonly seen: SeenNetworks;
}

export function pageNetworkStep(input: {
	readonly asked: Network | null;
	readonly header: Network;
	/** Null on the first run after the stored network was restored. */
	readonly seen: SeenNetworks | null;
}): PageNetworkStep {
	const { asked, header, seen } = input;
	// a link without a network: name it, whatever else happened
	if (asked === null) return { link: header, seen: { asked: header, header } };
	const linkMoved = seen === null || seen.asked !== asked;
	const headerMoved = seen !== null && seen.header !== header;
	if (asked === header) return { seen: { asked, header } };
	// both differ at first sight, or the reader followed another link: the link wins
	if (linkMoved) return { header: asked, seen: { asked, header: asked } };
	// only the header moved: the reader used its switch
	if (headerMoved) return { link: header, seen: { asked: header, header } };
	// neither moved and they still differ (an update is on its way): wait
	return { seen };
}
