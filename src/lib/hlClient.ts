import { SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";

const mainnetTransport = new WebSocketTransport();
const testnetTransport = new WebSocketTransport({ isTestnet: true });

export const mainnetSubscriptionClient = new SubscriptionClient({
	transport: mainnetTransport,
});
export const testnetSubscriptionClient = new SubscriptionClient({
	transport: testnetTransport,
});
