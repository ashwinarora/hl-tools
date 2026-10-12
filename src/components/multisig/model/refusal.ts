/**
 * What the proposal page says under an answer Hyperliquid refused with.
 *
 * The core's catalogue is written for the inspector, for someone holding the
 * envelope's bytes. An answer it does not know yet gets a plain sentence here
 * in place of advice about the code (audit F-010, F-011).
 */
import type { ErrorExplanation } from "@hl-tools/core";

export const UNKNOWN_REFUSAL =
	"This tool does not know that answer yet, so it cannot say more than Hyperliquid did.";

export function refusalNote(e: ErrorExplanation): string {
	if (e.id !== "unknown") return `${e.cause} ${e.fix}`;
	// a transport note ("HTTP 502: …") is still worth reading
	const rest = e.cause.replace(/^Not in the error catalogue\.?\s*/, "");
	return rest ? `${rest} ${UNKNOWN_REFUSAL}` : UNKNOWN_REFUSAL;
}
