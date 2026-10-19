import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
	capped,
	restoredDrafts,
	type StoredDraft,
} from "#/components/multisig/model/drafts";
import { usePersistHydrated } from "./hydrated";

/**
 * Half-filled forms of the Multisig section (the propose form of a treasury,
 * the wizard of an account), kept in this browser's localStorage so a reload
 * does not lose them. One per form, network and account; none older than a
 * week; nothing is sent anywhere. The rules are model/drafts.ts.
 */
interface DraftsState {
	/** `kind:network:address` → draft. */
	drafts: Record<string, StoredDraft>;
	save: (key: string, draft: StoredDraft) => void;
	drop: (key: string) => void;
	/** Every draft of one account on one network (it left this browser's list). */
	dropFor: (network: string, address: string) => void;
}

export const MULTISIG_DRAFTS_KEY = "hl-tools:multisig-drafts";

export const useMultisigDrafts = create<DraftsState>()(
	persist(
		(set) => ({
			drafts: {},
			save: (key, draft) =>
				set((s) => ({ drafts: capped({ ...s.drafts, [key]: draft }) })),
			drop: (key) =>
				set((s) => {
					if (!(key in s.drafts)) return s;
					const drafts = { ...s.drafts };
					delete drafts[key];
					return { drafts };
				}),
			dropFor: (network, address) =>
				set((s) => {
					const tail = `:${network}:${address.toLowerCase()}`;
					const keep = Object.entries(s.drafts).filter(
						([k]) => !k.endsWith(tail),
					);
					return keep.length === Object.keys(s.drafts).length
						? s
						: { drafts: Object.fromEntries(keep) };
				}),
		}),
		{
			name: MULTISIG_DRAFTS_KEY,
			storage: createJSONStorage(() => localStorage),
			partialize: (s) => ({ drafts: s.drafts }),
			// restored after mount, so the server and the first client render agree
			skipHydration: true,
			// what is read back is checked field by field, and the old ones are dropped
			merge: (persisted, current) => ({
				...current,
				drafts: restoredDrafts(
					(persisted as { drafts?: unknown } | undefined)?.drafts,
					Date.now(),
				),
			}),
		},
	),
);

/** True once the stored drafts are in; until then no form is filled from them. */
export function useDraftsHydrated(): boolean {
	return usePersistHydrated(useMultisigDrafts.persist);
}
