// @vitest-environment jsdom
import { act, createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PersistApi, usePersistHydrated } from "./hydrated";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for zustand's persist API whose restore the test triggers. */
function fakePersist(restored: boolean) {
	let done = restored;
	const listeners = new Set<() => void>();
	const api: PersistApi & { rehydrate: ReturnType<typeof vi.fn> } = {
		hasHydrated: () => done,
		onFinishHydration: (l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		rehydrate: vi.fn(() => {
			done = true;
			for (const l of listeners) l();
		}),
	};
	return api;
}

function Probe({ api }: { api: PersistApi | undefined }) {
	return createElement(
		"p",
		null,
		usePersistHydrated(api) ? "restored" : "not yet",
	);
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("usePersistHydrated", () => {
	it("is false on the server, where there is no persist API", () => {
		expect(renderToString(createElement(Probe, { api: undefined }))).toContain(
			"not yet",
		);
	});

	// The browser bug: a lazily loaded route hydrated after the root layout had
	// restored the store, started from "restored" and disagreed with the HTML.
	it("hydrates without a mismatch when the store was restored before this part of the page", async () => {
		const api = fakePersist(true);
		const container = document.createElement("div");
		container.innerHTML = renderToString(
			createElement(Probe, { api: undefined }),
		);
		document.body.append(container);
		const recovered: unknown[] = [];
		await act(async () => {
			hydrateRoot(container, createElement(Probe, { api }), {
				onRecoverableError: (e) => recovered.push(e),
			});
		});
		expect(recovered).toEqual([]);
		expect(container.textContent).toBe("restored");
		expect(api.rehydrate).not.toHaveBeenCalled();
	});

	it("asks for the restore itself when nobody has, and follows it", async () => {
		const api = fakePersist(false);
		const container = document.createElement("div");
		container.innerHTML = renderToString(
			createElement(Probe, { api: undefined }),
		);
		document.body.append(container);
		const recovered: unknown[] = [];
		await act(async () => {
			hydrateRoot(container, createElement(Probe, { api }), {
				onRecoverableError: (e) => recovered.push(e),
			});
		});
		expect(api.rehydrate).toHaveBeenCalledTimes(1);
		expect(recovered).toEqual([]);
		expect(container.textContent).toBe("restored");
	});
});
