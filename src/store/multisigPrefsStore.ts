import type { Address, Network } from "@hl-tools/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { usePersistHydrated } from "./hydrated";

/**
 * What the Multisig section remembers in this browser only: that the
 * "this signs and sends" warning and the first-run card were read, the
 * nicknames given to treasuries, which treasuries were seen or hidden, and
 * whether "While you were away" is folded. None of it is sent anywhere; a
 * nickname is the reader's own label, never something a co-signer set.
 */
interface PrefsState {
	warningSeen: boolean;
	/** `network:address` → nickname. */
	names: Record<string, string>;
	/** Treasuries opened at least once (others are marked "new" in the rail). */
	seen: string[];
	/** Treasuries taken out of this browser's list. */
	hidden: string[];
	/** "While you were away" shows its title only, on every page that has it. */
	awayFolded: boolean;
	/** The first-run card on the start page was put away. */
	walkthroughSeen: boolean;
	dismissWarning: () => void;
	setAwayFolded: (folded: boolean) => void;
	dismissWalkthrough: () => void;
	rename: (network: Network, address: Address, name: string) => void;
	markSeen: (network: Network, address: Address) => void;
	setHidden: (network: Network, address: Address, hidden: boolean) => void;
}

export const MULTISIG_PREFS_KEY = "hl-tools:multisig";
export const NAME_MAX = 40;

export const treasuryKey = (network: Network, address: Address) =>
	`${network}:${address}`;

const strings = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export const useMultisigPrefs = create<PrefsState>()(
	persist(
		(set) => ({
			warningSeen: false,
			names: {},
			seen: [],
			hidden: [],
			awayFolded: false,
			walkthroughSeen: false,
			dismissWarning: () => set({ warningSeen: true }),
			setAwayFolded: (folded) => set({ awayFolded: folded }),
			dismissWalkthrough: () => set({ walkthroughSeen: true }),
			rename: (network, address, name) =>
				set((s) => {
					const names = { ...s.names };
					const clean = name.trim().slice(0, NAME_MAX);
					if (clean) names[treasuryKey(network, address)] = clean;
					else delete names[treasuryKey(network, address)];
					return { names };
				}),
			markSeen: (network, address) =>
				set((s) => {
					const key = treasuryKey(network, address);
					return s.seen.includes(key) ? s : { seen: [...s.seen, key] };
				}),
			setHidden: (network, address, hidden) =>
				set((s) => {
					const key = treasuryKey(network, address);
					const rest = s.hidden.filter((k) => k !== key);
					return { hidden: hidden ? [...rest, key] : rest };
				}),
		}),
		{
			name: MULTISIG_PREFS_KEY,
			storage: createJSONStorage(() => localStorage),
			partialize: (s) => ({
				warningSeen: s.warningSeen,
				names: s.names,
				seen: s.seen,
				hidden: s.hidden,
				awayFolded: s.awayFolded,
				walkthroughSeen: s.walkthroughSeen,
			}),
			// restored after mount, so the server and the first client render agree
			skipHydration: true,
			merge: (persisted, current) => {
				const p = (persisted ?? {}) as Partial<PrefsState>;
				const names: Record<string, string> = {};
				if (p.names && typeof p.names === "object") {
					for (const [k, v] of Object.entries(p.names)) {
						if (typeof v === "string") names[k] = v.slice(0, NAME_MAX);
					}
				}
				return {
					...current,
					warningSeen: p.warningSeen === true,
					names,
					seen: strings(p.seen),
					hidden: strings(p.hidden),
					awayFolded: p.awayFolded === true,
					walkthroughSeen: p.walkthroughSeen === true,
				};
			},
		},
	),
);

/** True once the stored preferences are in; until then nothing depending on them is shown. */
export function usePrefsHydrated(): boolean {
	return usePersistHydrated(useMultisigPrefs.persist);
}
