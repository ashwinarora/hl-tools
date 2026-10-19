/**
 * Sentences that were true once and are not any more must not come back.
 *
 * An API wallet was described as "trades, cannot withdraw". Measured on
 * testnet (core rule set `multisig` 1.3.0): with no signer it can also put
 * the account's money into a vault and move it between the account's own
 * balances. The wording now lives in `components/multisig/model/apiWallet.ts`
 * and in the core's facts; this scan fails on the old phrases anywhere in the
 * app or the core.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TREES = ["src", "packages/hl-core/src"];

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path);
		return /\.(ts|tsx)$/.test(name) && !/\.(test|itest)\.tsx?$/.test(name)
			? [path]
			: [];
	});
}

const STALE: readonly RegExp[] = [
	/trading becomes single-key/i,
	/make trading single-key/i,
	/bypass the multi-sig for trading/i,
	/trade without the multi-sig/i,
	/Agents cannot move funds/i,
	/It cannot withdraw(?: funds)?\.(?! \w)/,
	/can trade for this treasury(?: without the signers)?\./i,
	/It cannot withdraw or send\./i,
];

describe("stale wording about API wallets", () => {
	const sources = TREES.flatMap((t) => files(join(ROOT, t))).map((path) => ({
		file: relative(ROOT, path),
		text: readFileSync(path, "utf8").replace(/\s+/g, " "),
	}));
	it("found the source trees", () => {
		expect(sources.length).toBeGreaterThan(200);
		expect(sources.some((s) => s.file.endsWith("model/apiWallet.ts"))).toBe(
			true,
		);
	});
	it.each(
		STALE.map((p) => [String(p), p] as const),
	)("%s is nowhere", (_name, pattern) => {
		expect(
			sources.filter((s) => pattern.test(s.text)).map((s) => s.file),
		).toEqual([]);
	});
	it("still catches what it is meant to catch", () => {
		const old =
			"An API wallet can trade for this treasury without the signers. It cannot withdraw.";
		expect(STALE.some((p) => p.test(old))).toBe(true);
		expect(
			STALE.some((p) =>
				p.test("It cannot send funds to another account or withdraw them."),
			),
		).toBe(false);
	});
});
