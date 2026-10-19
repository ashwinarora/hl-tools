import { describe, expect, it } from "vitest";
import {
	RECONNECT_FIRST_MS,
	RECONNECT_MAX_MS,
	reconnectDelay,
} from "./reconnect";

describe("reconnectDelay", () => {
	it("starts a few seconds after the first failure and doubles", () => {
		expect([0, 1, 2, 3].map(reconnectDelay)).toEqual([
			5_000, 10_000, 20_000, 40_000,
		]);
		expect(reconnectDelay(0)).toBe(RECONNECT_FIRST_MS);
	});

	it("settles at once a minute and never stops", () => {
		expect(reconnectDelay(4)).toBe(RECONNECT_MAX_MS);
		expect(reconnectDelay(50)).toBe(RECONNECT_MAX_MS);
		expect(reconnectDelay(5_000)).toBe(RECONNECT_MAX_MS);
	});

	it("treats a nonsense count as the first failure", () => {
		expect(reconnectDelay(-3)).toBe(RECONNECT_FIRST_MS);
		expect(reconnectDelay(Number.NaN)).toBe(RECONNECT_FIRST_MS);
		expect(reconnectDelay(Number.POSITIVE_INFINITY)).toBe(RECONNECT_FIRST_MS);
		expect(reconnectDelay(1.9)).toBe(10_000);
	});

	it("never waits longer than the cap or shorter than the first step", () => {
		for (let n = 0; n < 200; n++) {
			const d = reconnectDelay(n);
			expect(d).toBeGreaterThanOrEqual(RECONNECT_FIRST_MS);
			expect(d).toBeLessThanOrEqual(RECONNECT_MAX_MS);
		}
	});
});
