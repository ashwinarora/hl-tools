import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

let worker: ReturnType<typeof setupWorker> | null = null;

export async function startMocks(): Promise<void> {
	if (typeof window === "undefined" || worker) return;
	worker = setupWorker(...handlers);
	await worker.start({
		onUnhandledRequest: "bypass",
		serviceWorker: { url: "/mockServiceWorker.js" },
	});
	console.info(
		"[mocks] MSW active — hyperliquid endpoints are intercepted. See MockPanel bottom-right.",
	);
}

/** Stop intercepting (called when leaving the faucet miner). */
export function stopMocks(): void {
	worker?.stop();
	worker = null;
	(window as unknown as { __mswActive?: boolean }).__mswActive = false;
}
