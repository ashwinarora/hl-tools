import { useEffect, useState } from "react";
import { RELAY_SLOT_PREFIX } from "#/components/multisig/model/relay/wallets";

/**
 * Whether this browser has a wallet signed in to the Multisig's sharing
 * service, so the home page can offer "your treasuries" first. Read once the
 * page runs in the browser (the server has no storage, and the first render
 * must match it); a storage that throws counts as none. Nothing is read
 * beyond the presence of a slot.
 */
export function useReturning(): boolean {
	const [returning, setReturning] = useState(false);
	useEffect(() => {
		try {
			const store = window.localStorage;
			for (let i = 0; i < store.length; i++) {
				if (store.key(i)?.startsWith(RELAY_SLOT_PREFIX)) {
					setReturning(true);
					return;
				}
			}
		} catch {
			// private mode or blocked storage: a first visit as far as we know
		}
	}, []);
	return returning;
}
