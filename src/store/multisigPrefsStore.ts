import type { Address, Network } from "@hl-tools/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { followOtherTabs, usePersistHydrated } from "./hydrated";

/**
 * What the Multisig section remembers in this browser only: that the
 * first-run card is folded and the first-sign line was read, the
 * nicknames given to treasuries, which treasuries were seen or hidden, whose
 * "added to this tool by…" panel was closed, and whether "While you were
 * away" is folded. None of it is sent anywhere; a
 * nickname is the reader's own label, never something a co-signer set.
 */
interface PrefsState {
	/** `network:address` → nickname. */
	names: Record<string, string>;
	/** Treasuries opened at least once (others are marked "new" in the rail). */
	seen: string[];
	/** Treasuries taken out of this browser's list. */
	hidden: string[];
	/** "While you were away" shows its title only, on every page that has it. */
	awayFolded: boolean;
	/**
	 * The first-run card on the start page is folded to its title (the name
	 * is from when it was put away for good; it unfolds again now).
	 */
	walkthroughSeen: boolean;
	/** The one line above a first proposal to sign was read ("Got it"). */
	firstSignSeen: boolean;
	/** Treasuries whose "added to this tool by…" panel was closed. */
	provenanceClosed: string[];
	setAwayFolded: (folded: boolean) => void;
	setWalkthroughFolded: (folded: boolean) => void;
	/** "Got it" on the first-sign line: it goes, and the first-run card folds. */
	dismissFirstSign: () => void;
	rename: (network: Network, address: Address, name: string) => void;
	markSeen: (network: Network, address: Address) => void;
	setHidden: (network: Network, address: Address, hidden: boolean) => void;
	closeProvenance: (network: Network, address: Address) => void;
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
			names: {},
			seen: [],
			hidden: [],
			awayFolded: false,
			walkthroughSeen: false,
			firstSignSeen: false,
			provenanceClosed: [],
			setAwayFolded: (folded) => set({ awayFolded: folded }),
			setWalkthroughFolded: (folded) => set({ walkthroughSeen: folded }),
			dismissFirstSign: () =>
				set({ firstSignSeen: true, walkthroughSeen: true }),
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
			closeProvenance: (network, address) =>
				set((s) => {
					const key = treasuryKey(network, address);
					return s.provenanceClosed.includes(key)
						? s
						: { provenanceClosed: [...s.provenanceClosed, key] };
				}),
		}),
		{
			name: MULTISIG_PREFS_KEY,
			storage: createJSONStorage(() => localStorage),
			partialize: (s) => ({
				names: s.names,
				seen: s.seen,
				hidden: s.hidden,
				awayFolded: s.awayFolded,
				walkthroughSeen: s.walkthroughSeen,
				firstSignSeen: s.firstSignSeen,
				provenanceClosed: s.provenanceClosed,
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
					names,
					seen: strings(p.seen),
					hidden: strings(p.hidden),
					awayFolded: p.awayFolded === true,
					walkthroughSeen: p.walkthroughSeen === true,
					// before it had a flag of its own, putting the card away hid it too
					firstSignSeen: p.firstSignSeen === true || p.walkthroughSeen === true,
					provenanceClosed: strings(p.provenanceClosed),
				};
			},
		},
	),
);

// a nickname, a hidden treasury or a card put away in another tab holds here too (audit F-080)
followOtherTabs(useMultisigPrefs);

/** True once the stored preferences are in; until then nothing depending on them is shown. */
export function usePrefsHydrated(): boolean {
	return usePersistHydrated(useMultisigPrefs.persist);
}
