import { isNetwork, type Network } from "@hl-tools/core";
import { useEffect, useRef } from "react";
import {
	useNetwork,
	useNetworkHydrated,
	useNetworkStore,
} from "#/store/networkStore";
import { pageNetworkStep, type SeenNetworks } from "../model/pageNetwork";

/**
 * The network of a page that names it in its own link (see
 * `model/pageNetwork`): the link's, with the header kept in line. `write` puts
 * a network into the page's link, or leaves the page when its link cannot
 * change (a treasury's address belongs to one network).
 */
export function usePageNetwork(
	/** The network in the page's link, as the router gave it. */
	raw: string | undefined,
	write: (network: Network) => void,
): { readonly network: Network; readonly hydrated: boolean } {
	const header = useNetwork();
	const hydrated = useNetworkHydrated();
	const asked = isNetwork(raw) ? raw : null;
	const seen = useRef<SeenNetworks | null>(null);
	const writer = useRef(write);
	writer.current = write;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `header` only triggers the run; the value is read from the store, so a run repeated by React sees what the run before it applied
	useEffect(() => {
		// before the stored network is restored the header says nothing yet
		if (!hydrated) return;
		const step = pageNetworkStep({
			asked,
			header: useNetworkStore.getState().network,
			seen: seen.current,
		});
		seen.current = step.seen;
		if (step.header) useNetworkStore.getState().setNetwork(step.header);
		if (step.link) writer.current(step.link);
	}, [hydrated, header, asked]);
	return { network: asked ?? header, hydrated };
}
