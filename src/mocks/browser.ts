import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

let started = false;

export async function startMocks(): Promise<void> {
	if (typeof window === "undefined" || started) return;
	started = true;
	const worker = setupWorker(...handlers);
	await worker.start({
		onUnhandledRequest: "bypass",
		serviceWorker: { url: "/mockServiceWorker.js" },
	});
	console.info(
		"[mocks] MSW active — hyperliquid endpoints are intercepted. See MockPanel bottom-right.",
	);
}
