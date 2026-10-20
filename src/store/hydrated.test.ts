// @vitest-environment jsdom
import { act, createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	followOtherTabs,
	type PersistApi,
	usePersistHydrated,
} from "./hydrated";

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

describe("following another tab (audit F-080)", () => {
	const store = (name = "hl-tools:test") => {
		let read = 0;
		return {
			read: () => read,
			persist: {
				rehydrate: () => {
					read += 1;
				},
				getOptions: () => ({ name }),
			},
		};
	};
	const tab = () => {
		const listeners: ((ev: StorageEvent) => void)[] = [];
		return {
			addEventListener: (_: string, l: (ev: StorageEvent) => void) =>
				void listeners.push(l),
			write: (key: string | null) => {
				for (const l of listeners) l({ key } as StorageEvent);
			},
		};
	};

	it("reads the store again when another tab writes its key, or clears storage", () => {
		const s = store();
		const t = tab();
		followOtherTabs(s, t as never);
		t.write("hl-tools:test");
		t.write(null);
		expect(s.read()).toBe(2);
		// another key is somebody else's business
		t.write("hl-tools:other");
		expect(s.read()).toBe(2);
	});

	it("does nothing on the server, or for a store with no persist", () => {
		const s = store();
		followOtherTabs(s, undefined);
		followOtherTabs({}, tab() as never);
		expect(s.read()).toBe(0);
	});
});
