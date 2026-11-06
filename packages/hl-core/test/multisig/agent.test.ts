import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	agentExpiryTaken,
	agentNameParts,
	agentNameWithExpiry,
	explainExchangeError,
} from "../../src/multisig/index.ts";
import {
	AGENT_DEFAULT_VALID_MS,
	AGENT_MAX_VALID_MS,
} from "../../src/rules/multisig.ts";

interface Run {
	about: string;
	asked: { agentName: string; at: number };
	accepted: boolean;
	answer: { status: string; response?: unknown };
	listed?: { name: string; validUntil: number } | null;
}
const record = JSON.parse(
	readFileSync(
		new URL("../../fixtures/multisig/agent-expiry.json", import.meta.url),
		"utf8",
	),
) as { runs: Run[] };

describe("an API wallet's expiry in its name", () => {
	it("reads the measured form, and nothing else", () => {
		expect(agentNameParts("ashdex dbe6 valid_until 1794258383189")).toEqual({
			name: "ashdex dbe6",
			validUntil: 1794258383189,
		});
		expect(agentNameParts("lab")).toEqual({ name: "lab", validUntil: null });
		// no name before it, two spaces, a trailing space: not the measured form
		for (const n of [
			"valid_until 1794258383189",
			"lab  valid_until 1",
			"lab valid_until 1 ",
			"lab valid_until x",
		])
			expect(agentNameParts(n).validUntil === null || n.includes("  ")).toBe(
				true,
			);
		expect(agentNameParts("valid_until 1794258383189").validUntil).toBe(null);
	});

	it("writes what it reads", () => {
		const n = agentNameWithExpiry("ashdex 531e", 1794000000000.7);
		expect(n).toBe("ashdex 531e valid_until 1794000000000");
		expect(agentNameParts(n)).toEqual({
			name: "ashdex 531e",
			validUntil: 1794000000000,
		});
	});

	it("takes a moment ahead by at most 180 days", () => {
		const at = 1_794_000_000_000;
		expect(agentExpiryTaken(at + AGENT_MAX_VALID_MS, at)).toBe(true);
		expect(agentExpiryTaken(at + AGENT_MAX_VALID_MS + 1, at)).toBe(false);
		expect(agentExpiryTaken(at, at)).toBe(false);
		expect(agentExpiryTaken(at - 3_600_000, at)).toBe(false);
	});
});

describe("as testnet answered (fixtures/multisig/agent-expiry.json)", () => {
	const runs = record.runs;
	it("lists the wallet under its name alone, until the moment asked", () => {
		const taken = runs.filter(
			(r) =>
				r.accepted &&
				r.listed !== undefined &&
				agentNameParts(r.asked.agentName).validUntil,
		);
		expect(taken.length).toBeGreaterThan(0);
		for (const r of taken) {
			const parts = agentNameParts(r.asked.agentName);
			expect(r.listed).toEqual({
				name: parts.name,
				validUntil: parts.validUntil,
			});
			expect(agentExpiryTaken(parts.validUntil as number, r.asked.at)).toBe(
				true,
			);
		}
	});

	it("refuses a moment past or too far ahead, in words the catalogue knows", () => {
		const refused = runs.filter(
			(r) => !r.accepted && /valid_until/.test(String(r.answer.response)),
		);
		expect(refused.length).toBeGreaterThanOrEqual(2);
		for (const r of refused) {
			const v = agentNameParts(r.asked.agentName).validUntil as number;
			expect(agentExpiryTaken(v, r.asked.at)).toBe(false);
			expect(explainExchangeError(r.answer, 200).id).toBe(
				"agent-expiry-refused",
			);
		}
	});

	it("gives a named wallet 90 days without the suffix", () => {
		const plain = runs.filter(
			(r) =>
				r.accepted &&
				r.listed &&
				agentNameParts(r.asked.agentName).validUntil === null,
		);
		expect(plain.length).toBeGreaterThan(0);
		for (const r of plain) {
			const days =
				((r.listed as { validUntil: number }).validUntil - r.asked.at) /
				AGENT_DEFAULT_VALID_MS;
			expect(days).toBeGreaterThan(0.999);
			expect(days).toBeLessThan(1.001);
		}
	});
});
