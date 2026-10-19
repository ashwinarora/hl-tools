import { activationCharge, withdrawalOutcome } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	maxClassTransfer,
	maxFor,
	maxSendToken,
	maxSendUsdc,
	maxStaking,
	maxVaultDeposit,
	maxVaultWithdrawal,
	maxWithdrawal,
} from "./max";

const DEST = "0x1111111111111111111111111111111111111111";
const amountOf = (m: ReturnType<typeof maxSendUsdc>) =>
	m.kind === "ok" ? m.amount : null;

/** What Hyperliquid's own rule says of a sendAsset of `amount` to a new address. */
const charge = (
	amount: string,
	from: "perps" | "spot",
	perps: string,
	spot: string,
) =>
	activationCharge({
		action: {
			type: "sendAsset",
			destination: DEST,
			sourceDex: from === "spot" ? "spot" : "",
			destinationDex: "",
			token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
			amount,
		},
		receiverNew: true,
		spotUsdc: spot,
		perpsUsdc: perps,
	});

describe("Max for a USDC send", () => {
	const base = {
		unified: false,
		from: "perps" as const,
		perps: "12.5",
		spot: "3",
	};

	it("waits for the destination: the fee is not known before", () => {
		for (const receiver of [null, "loading"] as const)
			expect(maxSendUsdc({ ...base, receiver }).kind).toBe("none");
		// an API wallet's address or one that could not be read: the fee cannot be told
		for (const receiver of ["agent", "unknown", "other"] as const)
			expect(maxSendUsdc({ ...base, receiver }).kind).toBe("none");
	});

	it("to an address in use: all of the balance it leaves", () => {
		expect(amountOf(maxSendUsdc({ ...base, receiver: "active" }))).toBe("12.5");
		expect(
			amountOf(maxSendUsdc({ ...base, from: "spot", receiver: "active" })),
		).toBe("3");
	});

	it("to a new address: all of it when the other balance pays the fee", () => {
		const m = maxSendUsdc({ ...base, receiver: "new" });
		expect(amountOf(m)).toBe("12.5");
		expect(m.kind === "ok" && m.basis).toMatch(
			/fee for a new address comes from spot/,
		);
		// Hyperliquid's own rule agrees: the fee is paid, from spot
		expect(charge("12.5", "perps", base.perps, base.spot)).toMatchObject({
			paidFrom: "spot",
			refusal: null,
		});
	});

	it("to a new address: the fee kept back only when nothing else can pay it", () => {
		const poor = { ...base, spot: "0.4", receiver: "new" as const };
		expect(amountOf(maxSendUsdc(poor))).toBe("11.5");
		expect(charge("11.5", "perps", poor.perps, poor.spot)).toMatchObject({
			paidFrom: "perps",
			refusal: null,
		});
		// one millionth more would leave the fee unpaid
		expect(charge("11.500001", "perps", poor.perps, poor.spot).refusal).toBe(
			"transfer-gas",
		);
	});

	it("agrees with Hyperliquid's rule from either balance, for many balances", () => {
		const figures = [
			"0",
			"0.5",
			"0.999999",
			"1",
			"1.000001",
			"2",
			"7.25",
			"100",
		];
		for (const perps of figures)
			for (const spot of figures)
				for (const from of ["perps", "spot"] as const) {
					const m = maxSendUsdc({
						unified: false,
						from,
						perps,
						spot,
						receiver: "new",
					});
					if (m.kind !== "ok") continue;
					// Max is always a send Hyperliquid takes, fee included
					expect(charge(m.amount, from, perps, spot).refusal).toBeNull();
				}
	});

	it("a unified treasury pays the fee from its one balance", () => {
		expect(
			amountOf(
				maxSendUsdc({
					unified: true,
					from: "perps",
					perps: null,
					spot: "20",
					receiver: "new",
				}),
			),
		).toBe("19");
	});

	it("cuts a spot balance down to the 6 decimals a send carries, and says what stays", () => {
		const m = maxSendUsdc({
			...base,
			from: "spot",
			spot: "3.12345678",
			receiver: "active",
		});
		expect(amountOf(m)).toBe("3.123456");
		expect(m.kind === "ok" && m.basis).toMatch(/last 0\.00000078 USDC stays/);
	});

	it("has nothing to fill when the fee takes everything, or the balance is unread", () => {
		expect(
			maxSendUsdc({
				...base,
				from: "spot",
				spot: "1",
				perps: "0",
				receiver: "new",
			}).kind,
		).toBe("none");
		expect(maxSendUsdc({ ...base, perps: null, receiver: "active" }).kind).toBe(
			"none",
		);
		// the fee's balance unread: whether it comes off cannot be told
		expect(maxSendUsdc({ ...base, spot: null, receiver: "new" }).kind).toBe(
			"none",
		);
	});
});

describe("Max for the other amounts", () => {
	it("a spot token: all that is not on hold, cut to the token's decimals", () => {
		const m = maxSendToken({
			coin: "PURR",
			available: "123.456789",
			decimals: 2,
		});
		expect(m).toMatchObject({ kind: "ok", amount: "123.45" });
		expect(m.kind === "ok" && m.basis).toMatch(/last 0\.006789 PURR stays/);
		expect(
			maxSendToken({ coin: "PURR", available: "5", decimals: null }).kind,
		).toBe("none");
	});

	it("perps ↔ spot: all of the balance it leaves, no fee", () => {
		expect(
			maxClassTransfer({ toPerp: true, perps: "4", spot: "9.5" }),
		).toMatchObject({
			kind: "ok",
			amount: "9.5",
		});
		expect(
			maxClassTransfer({ toPerp: false, perps: "4", spot: "9.5" }),
		).toMatchObject({
			kind: "ok",
			amount: "4",
		});
		expect(
			maxClassTransfer({ toPerp: false, perps: "0", spot: "9" }).kind,
		).toBe("none");
	});

	it("a bridge withdrawal: all of it, the bridge's 1 USDC coming out of it", () => {
		const m = maxWithdrawal({ unified: false, perps: "9.999999", spot: "1" });
		expect(m).toMatchObject({ kind: "ok", amount: "9.999999" });
		expect(m.kind === "ok" && m.basis).toMatch(/so 8\.999999 USDC arrives/);
		const done = withdrawalOutcome({
			type: "withdraw3",
			destination: DEST,
			amount: "9.999999",
		});
		expect(done?.refusal).toBeNull();
		// 1 USDC or less: refused by the bridge, so no Max
		expect(maxWithdrawal({ unified: false, perps: "1", spot: "50" }).kind).toBe(
			"none",
		);
		// a unified treasury withdraws from its one balance
		expect(
			maxWithdrawal({ unified: true, perps: "0.29", spot: "16.6" }),
		).toMatchObject({
			amount: "16.6",
		});
	});

	it("a vault deposit: what perps can release, at least 5 USDC", () => {
		expect(
			maxVaultDeposit({ unified: false, perps: "9.999999" }),
		).toMatchObject({
			kind: "ok",
			amount: "9.999999",
		});
		expect(maxVaultDeposit({ unified: false, perps: "4.999999" }).kind).toBe(
			"none",
		);
	});

	it("a vault withdrawal: exactly what Hyperliquid releases, never the deposit's worth", () => {
		// the mainnet case of 2026-10-19: the worth read 10.005691, Hyperliquid released 10.005689
		expect(maxVaultWithdrawal({ maxWithdrawable: "10.005689" })).toMatchObject({
			kind: "ok",
			amount: "10.005689",
		});
		expect(maxVaultWithdrawal({ maxWithdrawable: null }).kind).toBe("none");
		expect(maxVaultWithdrawal({ maxWithdrawable: "0" }).kind).toBe("none");
	});
});

describe("Max for staking", () => {
	const V1 = "0xa82fe73bbd768bc15d1ef2f6142a21ff8bd762ad";
	const V2 = "0x5ac99df645f3414876c816caa18b2d234024b487";
	const base = {
		spot: "2.5",
		undelegated: "0.25",
		delegations: [{ validator: V1, amount: "0.0099029" }],
		from: "",
	};

	it("stake: all the HYPE in spot and in the staking balance", () => {
		expect(maxStaking({ ...base, kind: "stake" })).toMatchObject({
			kind: "ok",
			amount: "2.75",
		});
	});

	it("move: all of the stake with the validator it leaves, once chosen", () => {
		expect(maxStaking({ ...base, kind: "moveStake" }).kind).toBe("none");
		expect(maxStaking({ ...base, kind: "moveStake", from: V1 })).toMatchObject({
			kind: "ok",
			amount: "0.0099029",
		});
		expect(maxStaking({ ...base, kind: "moveStake", from: V2 }).kind).toBe(
			"none",
		);
	});

	it("back to spot: one validator holding stake is taken whole, and named", () => {
		expect(maxStaking({ ...base, kind: "returnToSpot" })).toMatchObject({
			kind: "ok",
			amount: "0.2599029",
			validator: V1,
		});
	});

	it("back to spot with several validators: what is unstaked, or a word to choose", () => {
		const two = [
			{ validator: V1, amount: "1" },
			{ validator: V2, amount: "2" },
		];
		const m = maxStaking({ ...base, kind: "returnToSpot", delegations: two });
		expect(m).toMatchObject({ kind: "ok", amount: "0.25" });
		expect("validator" in m).toBe(false);
		expect(
			maxStaking({
				...base,
				kind: "returnToSpot",
				delegations: two,
				undelegated: "0",
			}).kind,
		).toBe("none");
		// a validator chosen: its stake is added
		expect(
			maxStaking({ ...base, kind: "returnToSpot", delegations: two, from: V2 }),
		).toMatchObject({ amount: "2.25", validator: V2 });
	});

	it("cuts to HYPE's 8 decimals, and waits for what it needs", () => {
		expect(
			maxStaking({
				...base,
				kind: "stake",
				spot: "1.123456789",
				undelegated: "0",
			}),
		).toMatchObject({ amount: "1.12345678" });
		expect(maxStaking({ ...base, kind: "stake", undelegated: null }).kind).toBe(
			"none",
		);
		expect(maxStaking({ ...base, kind: "stake", spot: null }).kind).toBe(
			"none",
		);
		expect(
			maxStaking({ ...base, kind: "returnToSpot", delegations: null }).kind,
		).toBe("none");
	});
});

describe("the Max of each form", () => {
	const facts = {
		modeKnown: true,
		unified: false,
		perps: "9.999999",
		spotUsdc: "1",
		from: "perps" as const,
		receiver: "active" as const,
		token: null,
		maxWithdrawable: "0.00569",
		staking: { spot: "0", undelegated: "0", delegations: [] },
	};
	const form = (kind: string) => ({
		kind,
		toPerp: "perp" as const,
		validator: "",
	});

	it("picks each form's own rule", () => {
		expect(maxFor(form("sendUsdc"), facts)).toMatchObject({
			amount: "9.999999",
		});
		expect(maxFor(form("withdraw3"), facts)).toMatchObject({
			amount: "9.999999",
		});
		expect(maxFor(form("usdClassTransfer"), facts)).toMatchObject({
			amount: "1",
		});
		expect(maxFor(form("vaultWithdraw"), facts)).toMatchObject({
			amount: "0.00569",
		});
		expect(maxFor(form("vaultDeposit"), facts)).toMatchObject({
			amount: "9.999999",
		});
		expect(maxFor(form("sendToken"), facts)?.kind).toBe("none");
		expect(maxFor(form("stake"), facts)?.kind).toBe("none");
		// a kind with no amount has no Max
		expect(maxFor(form("approveAgent"), facts)).toBeNull();
	});

	it("a unified treasury deposits from its one balance", () => {
		expect(
			maxFor(form("vaultDeposit"), { ...facts, unified: true, spotUsdc: "12" }),
		).toMatchObject({ amount: "12" });
	});

	it("does not guess the balance while the account mode is unread", () => {
		for (const kind of ["sendUsdc", "withdraw3", "vaultDeposit"])
			expect(maxFor(form(kind), { ...facts, modeKnown: false })?.kind).toBe(
				"none",
			);
		// a class transfer and a vault withdrawal do not depend on it
		expect(
			maxFor(form("usdClassTransfer"), { ...facts, modeKnown: false })?.kind,
		).toBe("ok");
	});
});
