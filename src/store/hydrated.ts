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
