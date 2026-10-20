import { useCallback, useEffect, useSyncExternalStore } from "react";

/** The part of zustand's `persist` API this needs. */
export interface PersistApi {
	hasHydrated(): boolean;
	onFinishHydration(listener: () => void): () => void;
	rehydrate(): Promise<void> | void;
}

const never = () => () => {};

/**
 * True once a persisted store has been restored from localStorage.
 *
 * While React is hydrating the server's HTML this answers false, whatever
 * the store says: the server rendered without the stored values. A part of
 * the page that hydrates late (a lazily loaded route) can find the store
 * already restored by the root layout; starting from "restored" there would
 * disagree with the server's HTML. React renders again with the real answer
 * as soon as hydration is done.
 *
 * On the server localStorage is unavailable and zustand attaches no `persist`
 * API at all: that is "not restored yet".
 */
export function usePersistHydrated(api: PersistApi | undefined): boolean {
	const subscribe = useCallback(
		(onChange: () => void) => api?.onFinishHydration(onChange) ?? never(),
		[api],
	);
	const hydrated = useSyncExternalStore(
		subscribe,
		() => api?.hasHydrated() ?? false,
		() => false,
	);
	useEffect(() => {
		// Don't depend solely on the root layout's rehydrate call: rehydrating
		// is an idempotent localStorage read, and it guarantees the listener
		// fires even if the root's call happened on a different module instance
		// (Vite can load two copies after a hot update).
		if (api && !api.hasHydrated()) void api.rehydrate();
	}, [api]);
	return hydrated;
}

/** What following another tab needs of a store's `persist` API. */
export interface FollowedStore {
	readonly persist?: {
		rehydrate(): Promise<void> | void;
		getOptions(): { readonly name?: string };
	};
}

/**
 * Follows another tab's writes to a persisted store. zustand's `persist`
 * keeps no watch on localStorage: without this, a tab writes its whole old
 * copy over what another tab just kept, and a draft or a hidden treasury of
 * the other tab is gone (audit F-080). The store is read again from storage
 * whenever another tab changes its key (or clears storage). Browser only.
 */
export function followOtherTabs(
	store: FollowedStore,
	target: Pick<Window, "addEventListener"> | undefined = typeof window ===
	"undefined"
		? undefined
		: window,
): void {
	const api = store.persist;
	const name = api?.getOptions().name;
	if (!api || !name || !target) return;
	target.addEventListener("storage", (ev: StorageEvent) => {
		if (ev.key === name || ev.key === null) void api.rehydrate();
	});
}
