import { describe, expect, it } from "vitest";
import { InfoClient } from "../src/index.ts";

/** A fake transport that answers each info type and records the bodies it saw. */
function fakeTransport(answers: Record<string, unknown>) {
	const seen: unknown[] = [];
	return {
		seen,
		transport: {
			async request<T>(_endpoint: "info", payload: unknown): Promise<T> {
				seen.push(payload);
				const type = (payload as { type: string }).type;
				if (!(type in answers)) throw new Error(`unexpected ${type}`);
				return answers[type] as T;
			},
		},
	};
}

describe("InfoClient account methods", () => {
	const USER = "0xF8365A35694F401a554E4Ffa51b5AfE3B203d148";
	it("lowercase the user, type the answers and cache for 10 s", async () => {
		const { seen, transport } = fakeTransport({
			userToMultiSigSigners: {
				authorizedUsers: [
					"0xB70C120cd3702225FbE3657aCE137ED5889F36eE",
					"0x5e7c3420160987d04db5e8ed6d5bc14f61237216",
				],
				threshold: 2,
			},
			userRole: {
				role: "agent",
				data: { user: "0x5e7c3420160987d04db5e8ed6d5bc14f61237216" },
			},
			extraAgents: [
				{
					name: "lab",
					address: "0x008d90fc2bebe284380f32bd9632f6922b701bc5",
					validUntil: 1799175795549,
				},
			],
			clearinghouseState: {
				marginSummary: {
					accountValue: "1.0",
					totalNtlPos: "0",
					totalMarginUsed: "0",
				},
				withdrawable: "1.0",
				assetPositions: [],
				time: 1,
			},
			spotClearinghouseState: {
				balances: [{ coin: "USDC", token: 0, total: "10.5", hold: "0" }],
			},
			openOrders: [
				{
					coin: "BTC",
					side: "B",
					limitPx: "50000.0",
					sz: "0.001",
					oid: 1,
					timestamp: 2,
					origSz: "0.001",
				},
			],
		});
		let now = 1_000;
		const client = new InfoClient("testnet", { transport, now: () => now });
		const policy = await client.multiSigSigners(USER);
		expect(policy.data).toEqual({
			authorizedUsers: [
				"0x5e7c3420160987d04db5e8ed6d5bc14f61237216",
				"0xb70c120cd3702225fbe3657ace137ed5889f36ee",
			],
			threshold: 2,
			observedAt: 1_000,
		});
		expect(policy.network).toBe("testnet");
		expect((await client.userRole(USER)).data).toEqual({
			role: "agent",
			data: { user: "0x5e7c3420160987d04db5e8ed6d5bc14f61237216" },
		});
		expect((await client.extraAgents(USER)).data[0]?.name).toBe("lab");
		expect((await client.clearinghouseState(USER)).data.withdrawable).toBe(
			"1.0",
		);
		expect(
			(await client.spotClearinghouseState(USER)).data.balances[0]?.coin,
		).toBe("USDC");
		expect((await client.openOrders(USER)).data[0]?.oid).toBe(1);
		expect(
			seen.every((b) => (b as { user: string }).user === USER.toLowerCase()),
		).toBe(true);
		expect(seen.length).toBe(6);
		// within the TTL nothing is re-fetched; after it everything is
		await client.extraAgents(USER);
		expect(seen.length).toBe(6);
		now += 10_001;
		await client.extraAgents(USER);
		expect(seen.length).toBe(7);
	});
	it("a non-multisig user answers null", async () => {
		const { transport } = fakeTransport({ userToMultiSigSigners: null });
		const client = new InfoClient("mainnet", { transport });
		expect((await client.multiSigSigners(USER)).data).toBeNull();
	});
});
