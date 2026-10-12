import { useCallback, useEffect, useRef } from "react";
import {
	useDraftsHydrated,
	useMultisigDrafts,
} from "#/store/multisigDraftsStore";
import { DRAFT_SAVE_AFTER_MS, type StoredDraft } from "../model/drafts";

/**
 * One form's draft in this browser (model/drafts.ts): what is stored for it,
 * and a way to write it a moment after typing stops. A form calls `save`
 * from its own setters, never from an effect on its state: the wallet and
 * the stored values arrive after the first render, and an effect would
 * write the still-empty form over the draft before it was put back.
 */
export function useDraft(key: string | null): {
	/** The stored drafts have been read: only then is `stored` an answer. */
	readonly hydrated: boolean;
	readonly stored: StoredDraft | null;
	/** Write this a moment from now; null drops the draft instead. */
	save(draft: Omit<StoredDraft, "at"> | null): void;
	/** Drop the draft now, and anything still waiting to be written. */
	clear(): void;
} {
	const hydrated = useDraftsHydrated();
	const stored = useMultisigDrafts((s) => (key ? s.drafts[key] : undefined));
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pending = useRef<(() => void) | null>(null);

	const flush = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		const write = pending.current;
		pending.current = null;
		write?.();
	}, []);
	// leaving the page within that moment still keeps the last keystrokes
	useEffect(() => flush, [flush]);

	const save = useCallback(
		(draft: Omit<StoredDraft, "at"> | null) => {
			if (!key) return;
			pending.current = () => {
				const store = useMultisigDrafts.getState();
				if (draft) store.save(key, { ...draft, at: Date.now() } as StoredDraft);
				else store.drop(key);
			};
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(flush, DRAFT_SAVE_AFTER_MS);
		},
		[key, flush],
	);

	const clear = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		pending.current = null;
		if (key) useMultisigDrafts.getState().drop(key);
	}, [key]);

	return { hydrated, stored: hydrated ? (stored ?? null) : null, save, clear };
}
