import { accountMode, sendRefusal } from "@hl-tools/core";

const MANUAL = accountMode("default");

/**
 * A send from the account to itself that Hyperliquid refuses whatever the
 * account's mode: the two older sends always, `sendAsset` when it names the
 * same balance on both sides (measured: fixtures/multisig/self-send.json).
 * A `sendAsset` to itself from one balance into the other is taken.
 */
export function selfRefusal(
	self: string,
	action: unknown,
): "self-transfer" | "send-invalid" | null {
	const r = sendRefusal(MANUAL, action, self);
	return r === "self-transfer" || r === "send-invalid" ? r : null;
}
