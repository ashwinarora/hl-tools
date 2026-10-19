/**
 * The wallet's own private channel. The relay sends an empty "changed"
 * message when anything the wallet can see has changed; the page answers by
 * re-reading through the access rules. A ping is only a hint: joining (and
 * every re-join after a dropped connection) counts as one too, because
 * messages sent while disconnected are gone.
 */
import type { Address } from "@hl-tools/core";
import type { RelayClient } from "./client";

export type ChannelState = "joining" | "joined" | "refused" | "down";

export const PING_DEBOUNCE_MS = 150;

export function walletTopic(wallet: Address): string {
	return `wallet:${wallet}`;
}

/** Returns the function that leaves the channel. */
export function subscribeWallet(
	client: RelayClient,
	wallet: Address,
	onPing: () => void,
	onState: (state: ChannelState) => void = () => {},
): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let left = false;
	const ping = () => {
		if (left || timer) return;
		// a burst of writes (publish, then sign) is one re-read
		timer = setTimeout(() => {
			timer = null;
			if (!left) onPing();
		}, PING_DEBOUNCE_MS);
	};

	onState("joining");
	const channel = client
		.channel(walletTopic(wallet), { config: { private: true } })
		.on("broadcast", { event: "changed" }, ping)
		.subscribe((status, error) => {
			if (left) return;
			if (status === "SUBSCRIBED") {
				onState("joined");
				ping();
			} else if (status === "CHANNEL_ERROR") {
				// the relay says no (not this wallet's channel), or the socket failed and will retry
				onState(
					/unauthorized|permission/i.test(error?.message ?? "")
						? "refused"
						: "down",
				);
			} else if (status === "TIMED_OUT" || status === "CLOSED") {
				onState("down");
			}
		});

	return () => {
		left = true;
		if (timer) clearTimeout(timer);
		void client.removeChannel(channel);
	};
}
