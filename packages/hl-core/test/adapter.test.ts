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
			userAbstraction: "unifiedAccount",
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
		expect((await client.userAbstraction(USER)).data).toBe("unifiedAccount");
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
		expect(seen.length).toBe(7);
		// within the TTL nothing is re-fetched; after it everything is
		await client.extraAgents(USER);
		await client.userAbstraction(USER);
		await client.userRole(USER);
		expect(seen.length).toBe(7);
		// unless the caller wants what the chain says now
		await client.userAbstraction(USER, { fresh: true });
		await client.userRole(USER, { fresh: true });
		await client.clearinghouseState(USER, { fresh: true });
		await client.spotClearinghouseState(USER, { fresh: true });
		expect(seen.length).toBe(11);
		now += 10_001;
		await client.extraAgents(USER);
		expect(seen.length).toBe(12);
	});
	it("lists every API wallet: the named ones and the one without a name, which `extraAgents` leaves out", async () => {
		const named = [
			{
				name: "lab",
				address: "0x008d90fc2bebe284380f32bd9632f6922b701bc5",
				validUntil: 1799175795549,
			},
		];
		const unnamed = "0xd7532a99c52cd216b4123115eac148a3ec9f93d5";
		const { seen, transport } = fakeTransport({
			extraAgents: named,
			webData3: {
				userState: { agentAddress: unnamed, agentValidUntil: 1793047055525 },
			},
		});
		let now = 5_000;
		const client = new InfoClient("testnet", { transport, now: () => now++ });
		const all = await client.apiWallets(USER);
		expect(all.data).toEqual([
			{ name: "", address: unnamed, validUntil: 1793047055525 },
			...named,
		]);
		expect(all.network).toBe("testnet");
		// as old as the older of the two answers
		expect(all.observedAt).toBe(5_002);
		expect(seen).toEqual([
			{ type: "extraAgents", user: USER.toLowerCase() },
			{ type: "webData3", user: USER.toLowerCase() },
		]);
		// an account with none
		const none = new InfoClient("testnet", {
			transport: fakeTransport({
				extraAgents: named,
				webData3: {
					userState: { agentAddress: null, agentValidUntil: null },
				},
			}).transport,
		});
		expect((await none.apiWallets(USER)).data).toEqual(named);
	});
	it("fails rather than show a list that may be short one wallet", async () => {
		// the second read fails
		const down = new InfoClient("testnet", {
			transport: fakeTransport({ extraAgents: [] }).transport,
		});
		await expect(down.apiWallets(USER)).rejects.toThrow(/unexpected webData3/);
		// it answers, and does not say
		const silent = new InfoClient("testnet", {
			transport: fakeTransport({ extraAgents: [], webData3: {} }).transport,
		});
		await expect(silent.apiWallets(USER)).rejects.toMatchObject({
			name: "InfoRequestError",
			message:
				"The answer does not say whether the account has an API wallet without a name.",
			body: { type: "webData3", user: USER.toLowerCase() },
		});
		// the first read fails
		const half = new InfoClient("testnet", {
			transport: fakeTransport({
				webData3: { userState: { agentAddress: null } },
			}).transport,
		});
		await expect(half.apiWallets(USER)).rejects.toThrow(
			/unexpected extraAgents/,
		);
	});
	it("reads an account's vault deposits and a vault's details, parsed", async () => {
		const VAULT = "0x49D05977597b22e3c73d654c351adde9d9920e18";
		const { seen, transport } = fakeTransport({
			userVaultEquities: [
				{ vaultAddress: VAULT, equity: "5.0", lockedUntilTimestamp: 9 },
			],
			vaultDetails: null,
		});
		const client = new InfoClient("testnet", { transport });
		expect((await client.vaultDeposits(USER)).data).toEqual([
			{ vault: VAULT.toLowerCase(), equity: "5", lockedUntil: 9 },
		]);
		// an address that is no vault
		expect((await client.vault(VAULT)).data).toEqual({ kind: "none" });
		// with the account whose deposit is asked about
		await client.vault(VAULT, USER, { fresh: true });
		expect(seen).toEqual([
			{ type: "userVaultEquities", user: USER.toLowerCase() },
			{ type: "vaultDetails", vaultAddress: VAULT.toLowerCase() },
			{
				type: "vaultDetails",
				vaultAddress: VAULT.toLowerCase(),
				user: USER.toLowerCase(),
			},
		]);
		// an answer that is no list
		const odd = new InfoClient("testnet", {
			transport: fakeTransport({ userVaultEquities: {} }).transport,
		});
		expect((await odd.vaultDeposits(USER)).data).toBeNull();
	});
	it("`fresh` asks the network whatever is cached, and later readers get the new answer", async () => {
		const answers: Record<string, unknown> = {
			userToMultiSigSigners: {
				authorizedUsers: ["0x5e7c3420160987d04db5e8ed6d5bc14f61237216"],
				threshold: 1,
			},
			extraAgents: [],
		};
		const { seen, transport } = fakeTransport(answers);
		const client = new InfoClient("testnet", { transport, now: () => 1_000 });
		expect((await client.multiSigSigners(USER)).data?.threshold).toBe(1);
		// the signer set changes on chain inside the cache window
		answers.userToMultiSigSigners = {
			authorizedUsers: ["0x5e7c3420160987d04db5e8ed6d5bc14f61237216"],
			threshold: 2,
		};
		expect((await client.multiSigSigners(USER)).data?.threshold).toBe(1);
		expect(seen.length).toBe(1);
		expect(
			(await client.multiSigSigners(USER, { fresh: true })).data?.threshold,
		).toBe(2);
		expect(seen.length).toBe(2);
		expect((await client.multiSigSigners(USER)).data?.threshold).toBe(2);
		expect(seen.length).toBe(2);
		// the same for API wallets
		await client.extraAgents(USER);
		await client.extraAgents(USER, { fresh: true });
		await client.extraAgents(USER);
		expect(seen.length).toBe(4);
	});
	it("a non-multisig user answers null", async () => {
		const { transport } = fakeTransport({ userToMultiSigSigners: null });
		const client = new InfoClient("mainnet", { transport });
		expect((await client.multiSigSigners(USER)).data).toBeNull();
	});
});

describe("InfoClient staking methods", () => {
	const USER = "0xF8365A35694F401a554E4Ffa51b5AfE3B203d148";
	const VALIDATOR = "0x946bf3135c7d15e4462b510f74b6e304aabb5b21";
	it("ask for the account in lowercase and read the answers", async () => {
		const { seen, transport } = fakeTransport({
			delegatorSummary: {
				delegated: "0.0205",
				undelegated: "0.01",
				totalPendingWithdrawal: "0.0005",
				nPendingWithdrawals: 5,
			},
			delegations: [
				{
					validator: VALIDATOR,
					amount: "0.0199",
					lockedUntilTimestamp: 1791820832327,
				},
			],
			delegatorHistory: [
				{
					time: 1791820707922,
					hash: "0x7b66ac4dd6eb43d97ce0042b8694b0010600c43371ee62ab1f2f57a095ef1dc4",
					delta: { cDeposit: { amount: "0.02" } },
				},
			],
			validatorSummaries: [
				{
					validator: VALIDATOR,
					name: "Hypurr",
					description: "",
					stake: 701023300824871,
					isJailed: false,
					isActive: true,
					commission: "1.0",
					stats: [],
				},
			],
		});
		const client = new InfoClient("testnet", { transport, now: () => 5 });

		const summary = await client.delegatorSummary(USER);
		expect(summary.data).toEqual({
			delegated: "0.0205",
			undelegated: "0.01",
			pendingTotal: "0.0005",
			pendingReturns: 5,
		});
		expect(summary.network).toBe("testnet");
		expect(summary.observedAt).toBe(5);
		expect((await client.delegations(USER)).data).toEqual([
			{ validator: VALIDATOR, amount: "0.0199", lockedUntil: 1791820832327 },
		]);
		expect((await client.delegatorHistory(USER)).data?.[0]?.kind).toBe(
			"moveIn",
		);
		expect((await client.validatorSummaries()).data?.[0]).toMatchObject({
			address: VALIDATOR,
			name: "Hypurr",
			stake: "7010233.00824871",
			commission: "1",
		});
		expect(seen).toEqual([
			{ type: "delegatorSummary", user: USER.toLowerCase() },
			{ type: "delegations", user: USER.toLowerCase() },
			{ type: "delegatorHistory", user: USER.toLowerCase() },
			{ type: "validatorSummaries" },
		]);
	});

	it("reads Hyperliquid's own clock, fresh every time, and nothing from an answer without one", async () => {
		const { seen, transport } = fakeTransport({
			exchangeStatus: { specialStatuses: null, time: 1791827287580 },
		});
		const client = new InfoClient("testnet", { transport, now: () => 5 });
		expect((await client.exchangeTime()).data).toBe(1791827287580);
		expect((await client.exchangeTime()).data).toBe(1791827287580);
		expect(seen).toEqual([
			{ type: "exchangeStatus" },
			{ type: "exchangeStatus" },
		]);
		for (const answer of [
			null,
			"down",
			{},
			{ time: "now" },
			{ time: -1 },
			{ time: 1.5 },
		]) {
			const other = new InfoClient("testnet", {
				transport: fakeTransport({ exchangeStatus: answer }).transport,
			});
			expect((await other.exchangeTime()).data).toBeNull();
		}
	});

	it("answer null for a shape they cannot read, and are never served from a cache", async () => {
		const { seen, transport } = fakeTransport({
			delegatorSummary: "down for maintenance",
			validatorSummaries: { error: "unknown type" },
		});
		const client = new InfoClient("testnet", { transport, now: () => 5 });
		expect((await client.delegatorSummary(USER)).data).toBeNull();
		expect((await client.delegatorSummary(USER)).data).toBeNull();
		expect((await client.validatorSummaries()).data).toBeNull();
		expect(seen).toHaveLength(3);
	});
});
