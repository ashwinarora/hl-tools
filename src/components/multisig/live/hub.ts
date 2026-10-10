/**
 * The browser side of the live tables: one socket hub per network, and one
 * store per account on it. Nothing here runs until a screen asks for an
 * account from an effect, so importing this file opens no connection.
 *
 * A tab that stays hidden gives its connection up after a while and takes it
 * back when it is looked at again. When the browser reports the network is
 * back, the hub does not wait out its reconnect schedule.
 */
import {
	type Address,
	type HubSocket,
	type Network,
	networkConfig,
	WsHub,
} from "@hl-tools/core";
import { LiveAccountStore } from "../model/live/account";

/** How long a hidden tab keeps its connection. */
export const HIDDEN_GRACE_MS = 60_000;

const hubs = new Map<Network, WsHub>();
const stores = new Map<string, LiveAccountStore>();
let lifecycle = false;

/** One listener set for every hub: created with the first hub, kept for the page's life. */
function watchPage(): void {
	if (lifecycle || typeof document === "undefined") return;
	lifecycle = true;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	document.addEventListener("visibilitychange", () => {
		clearTimeout(hideTimer);
		if (document.visibilityState === "hidden") {
			hideTimer = setTimeout(() => {
				for (const hub of hubs.values()) hub.suspend();
			}, HIDDEN_GRACE_MS);
		} else {
			for (const hub of hubs.values()) hub.resume();
		}
	});
	window.addEventListener("online", () => {
		for (const hub of hubs.values()) hub.retryNow();
	});
}

function hubFor(network: Network): WsHub {
	let hub = hubs.get(network);
	if (!hub) {
		hub = new WsHub({
			url: networkConfig(network).wsUrl,
			// the hub uses the handful of members it declares; a browser WebSocket has them all
			createSocket: (url) => new WebSocket(url) as unknown as HubSocket,
		});
		hubs.set(network, hub);
		watchPage();
	}
	return hub;
}

/**
 * The store of one account. Creating it connects nothing: the hub is made
 * when a screen first acquires a group of subscriptions.
 */
export function liveAccountStore(
	network: Network,
	address: Address | string,
): LiveAccountStore {
	const account = address.toLowerCase();
	const key = `${network}:${account}`;
	let store = stores.get(key);
	if (!store) {
		store = new LiveAccountStore({ hub: () => hubFor(network), account });
		stores.set(key, store);
	}
	return store;
}
