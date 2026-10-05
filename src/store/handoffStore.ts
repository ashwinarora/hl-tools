import { create } from "zustand";
import type { ToolId } from "#/lib/tools";

/**
 * In-memory handoff of pasted input between pages (e.g. directory → tool).
 * Deliberately not persisted and never put in the URL: pasted payloads and
 * signatures must not leak into history, referrers or shared links.
 */
interface HandoffState {
	pending: { tool: ToolId; value: string } | null;
	send: (tool: ToolId, value: string) => void;
	take: (tool: ToolId) => string | null;
}

export const useHandoffStore = create<HandoffState>()((set, get) => ({
	pending: null,
	send: (tool, value) => set({ pending: { tool, value } }),
	take: (tool) => {
		const p = get().pending;
		if (!p || p.tool !== tool) return null;
		set({ pending: null });
		return p.value;
	},
}));
