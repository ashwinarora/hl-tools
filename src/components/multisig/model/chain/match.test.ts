import type { ExplorerTx, Hex, LedgerRow } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	approvalOf,
	candidatesFor,
	hashesToLookUp,
	judgeTx,
	LANDS_AFTER_NONCE_MS,
	LANDS_BEFORE_NONCE_MS,
	ledgerEvidence,
	type MatchCandidate,
	type RowProposal,
	rowProposal,
	sameAction,
	withdrawalNumber,
} from "./match";

const T = `0x${"f8".repeat(20)}`;
const DEST = `0x${"5e".repeat(20)}`;
const OTHER = `0x${"b7".repeat(20)}`;
const NONCE = 1_791_400_180_224;
const digest = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

const usdSend = (over: Record<string, unknown> = {}) => ({
	type: "usdSend",
	signatureChainId: "0x66eee",
	hyperliquidChain: "Testnet",
	destination: DEST,
	amount: "110",
	time: NONCE,
	...over,
});
const proposal = (
	n: number,
	action: Record<string, unknown> = usdSend(),
	over: Partial<MatchCandidate> = {},
): MatchCandidate => ({
	digest: digest(n),
	action: action as MatchCandidate["action"],
	nonce: NONCE,
	finaliser: OTHER,
	...over,
});
const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
	key: "k",
	time: NONCE + 568,
	hash: `0x${"72".repeat(32)}`,
	type: "internalTransfer",
	direction: "out",
	token: "USDC",
	amount: "110.0",
	counterparty: DEST,
	fromVenue: "perp",
	toVenue: "perp",
	fee: "1.0",
	feeToken: "USDC",
	requested: null,
	delta: {
		type: "internalTransfer",
		usdc: "110.0",
		user: T,
		destination: DEST,
		fee: "1.0",
	},
	...over,
});
const tx = (over: Partial<ExplorerTx> = {}): ExplorerTx => ({
	time: NONCE + 568,
	user: T,
	action: usdSend() as ExplorerTx["action"],
	block: 723825086,
	hash: `0x${"72".repeat(32)}`,
	error: null,
	...over,
});

describe("candidatesFor", () => {
	it("no proposal could be behind money that arrived, or what the account did not do", () => {
		expect(candidatesFor(row({ direction: "in" }), [proposal(1)])).toEqual({
			kind: "not-applicable",
		});
		expect(
			candidatesFor(row({ direction: "other", type: "liquidation" }), [
				proposal(1),
			]),
		).toEqual({ kind: "not-applicable" });
	});
	it("finds the proposal that agrees with what the row shows", () => {
		expect(
			candidatesFor(row(), [
				proposal(1),
				proposal(2, usdSend({ amount: "5" })),
			]),
		).toEqual({
			kind: "candidates",
			digests: [digest(1)],
		});
		// "110" and "110.0" are the same amount; addresses compare without case
		expect(
			candidatesFor(row(), [
				proposal(
					1,
					usdSend({ destination: DEST.toUpperCase().replace("0X", "0x") }),
				),
			]).kind,
		).toBe("candidates");
	});
	it("is 'none' without a request when nothing on record could be it", () => {
		expect(candidatesFor(row(), [])).toEqual({ kind: "none" });
		expect(
			candidatesFor(row(), [proposal(1, usdSend({ amount: "111" }))]).kind,
		).toBe("none");
		expect(
			candidatesFor(row(), [proposal(1, usdSend({ destination: OTHER }))]).kind,
		).toBe("none");
		// another kind of action cannot have produced a perps transfer
		expect(
			candidatesFor(row(), [
				proposal(1, {
					type: "spotSend",
					destination: DEST,
					amount: "110",
					token: "USDC:0x1",
				}),
			]).kind,
		).toBe("none");
	});
	it("only inside the window in which that number could have landed", () => {
		const at = (time: number) =>
			candidatesFor(row({ time }), [proposal(1)]).kind;
		expect(at(NONCE - LANDS_BEFORE_NONCE_MS)).toBe("candidates");
		expect(at(NONCE - LANDS_BEFORE_NONCE_MS - 1)).toBe("none");
		expect(at(NONCE + LANDS_AFTER_NONCE_MS)).toBe("candidates");
		expect(at(NONCE + LANDS_AFTER_NONCE_MS + 1)).toBe("none");
	});
	it("knows what each kind of row shows of its action", () => {
		const spot = row({
			type: "spotTransfer",
			delta: {
				type: "spotTransfer",
				token: "USDC",
				amount: "0.5",
				user: T,
				destination: DEST,
			},
		});
		const spotSend = (over = {}) => ({
			type: "spotSend",
			destination: DEST,
			token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
			amount: "0.5",
			time: NONCE,
			...over,
		});
		expect(candidatesFor(spot, [proposal(1, spotSend())]).kind).toBe(
			"candidates",
		);
		expect(
			candidatesFor(spot, [proposal(1, spotSend({ token: "HYPE:0x2" }))]).kind,
		).toBe("none");
		expect(
			candidatesFor(spot, [proposal(1, spotSend({ amount: "0.6" }))]).kind,
		).toBe("none");

		const move = row({
			type: "accountClassTransfer",
			direction: "within",
			delta: { type: "accountClassTransfer", usdc: "399.0", toPerp: true },
		});
		const classTransfer = (over = {}) => ({
			type: "usdClassTransfer",
			amount: "399",
			toPerp: true,
			nonce: NONCE,
			...over,
		});
		expect(candidatesFor(move, [proposal(1, classTransfer())]).kind).toBe(
			"candidates",
		);
		expect(
			candidatesFor(move, [proposal(1, classTransfer({ toPerp: false }))]).kind,
		).toBe("none");

		const send = row({
			type: "send",
			delta: {
				type: "send",
				user: T,
				destination: DEST,
				sourceDex: "",
				destinationDex: "xyz",
				token: "USDC",
				amount: "7",
			},
		});
		const sendAsset = (over = {}) => ({
			type: "sendAsset",
			destination: DEST,
			sourceDex: "",
			destinationDex: "xyz",
			token: "USDC",
			amount: "7",
			nonce: NONCE,
			...over,
		});
		expect(candidatesFor(send, [proposal(1, sendAsset())]).kind).toBe(
			"candidates",
		);
		expect(
			candidatesFor(send, [proposal(1, sendAsset({ amount: "8" }))]).kind,
		).toBe("none");
		expect(
			candidatesFor(send, [proposal(1, sendAsset({ destination: OTHER }))])
				.kind,
		).toBe("none");
		expect(
			candidatesFor(send, [proposal(1, sendAsset({ token: "HYPE" }))]).kind,
		).toBe("none");
	});
	it("leaves a withdrawal, and kinds whose cause is not known, to the transaction", () => {
		const withdrawal = row({
			type: "withdraw",
			delta: { type: "withdraw", usdc: "19", nonce: NONCE, fee: "1" },
		});
		expect(
			candidatesFor(withdrawal, [
				proposal(1, {
					type: "withdraw3",
					destination: DEST,
					amount: "20",
					time: NONCE,
				}),
				proposal(2),
			]),
		).toEqual({ kind: "candidates", digests: [digest(1)] });
		const vault = row({
			type: "vaultDeposit",
			direction: "within",
			delta: { type: "vaultDeposit", vault: OTHER, usdc: "10" },
		});
		expect(
			candidatesFor(vault, [
				proposal(1, {
					type: "vaultTransfer",
					vaultAddress: OTHER,
					isDeposit: true,
					usd: 10_000_000,
				}),
			]).kind,
		).toBe("candidates");
	});
	it("names a proposal once however often it is listed", () => {
		expect(candidatesFor(row(), [proposal(1), proposal(1)])).toEqual({
			kind: "candidates",
			digests: [digest(1)],
		});
	});
});

describe("hashesToLookUp", () => {
	const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
	it("asks for the newest row first, each transaction once", () => {
		const ledger = [
			row({ key: "a", time: NONCE + 100, hash: hash(1) }),
			row({
				key: "b",
				time: NONCE + 900,
				hash: hash(3).toUpperCase().replace("0X", "0x"),
			}),
			row({ key: "c", time: NONCE + 500, hash: hash(2) }),
			// one transaction can leave two rows
			row({ key: "d", time: NONCE + 900, hash: hash(3) }),
		];
		expect(hashesToLookUp(ledger, [proposal(1)])).toEqual([
			hash(3),
			hash(2),
			hash(1),
		]);
		// the ledger itself is left as it was
		expect(ledger.map((r) => r.key)).toEqual(["a", "b", "c", "d"]);
	});
	it("asks for nothing that cannot be a known proposal's", () => {
		const ledger = [
			row({ key: "in", direction: "in" }),
			row({ key: "far", time: NONCE + LANDS_AFTER_NONCE_MS + 1 }),
			// Hyperliquid gives some entries no transaction
			row({ key: "zero", hash: `0x${"0".repeat(64)}` }),
		];
		expect(hashesToLookUp(ledger, [proposal(1)])).toEqual([]);
		expect(hashesToLookUp([row()], [])).toEqual([]);
	});
});

describe("sameAction", () => {
	it("needs the same keys in the same order with the same values", () => {
		expect(sameAction(usdSend(), usdSend())).toBe(true);
		expect(sameAction(usdSend(), usdSend({ amount: "110.0" }))).toBe(false);
		expect(sameAction(usdSend(), usdSend({ time: NONCE + 1 }))).toBe(false);
		expect(sameAction({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
		expect(sameAction({ a: 1 }, { a: 1, b: undefined })).toBe(false);
		expect(sameAction({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(
			true,
		);
		expect(sameAction({ a: [1, 2] }, { a: [1] })).toBe(false);
		expect(sameAction({ a: [1] }, { a: { 0: 1 } })).toBe(false);
		expect(sameAction({ a: null }, { a: null })).toBe(true);
		expect(sameAction({ a: null }, { a: {} })).toBe(false);
		expect(sameAction({ a: true }, { a: "true" })).toBe(false);
		expect(sameAction("x", "x")).toBe(true);
	});
	it("an integer is the same as a number or as a bigint; an inexact number equals nothing", () => {
		expect(sameAction({ wei: 100000000n }, { wei: 100000000 })).toBe(true);
		expect(sameAction({ wei: 100000000 }, { wei: 100000000n })).toBe(true);
		expect(sameAction({ wei: 5n }, { wei: 6 })).toBe(false);
		expect(sameAction({ wei: 5n }, { wei: "5" })).toBe(false);
		expect(sameAction({ wei: 5n }, { wei: 5.5 })).toBe(false);
		const huge = 2 ** 60;
		expect(sameAction({ wei: BigInt(huge) }, { wei: huge })).toBe(false);
		expect(sameAction({ wei: huge }, { wei: huge })).toBe(false);
		expect(sameAction({ px: 1.5 }, { px: 1.5 })).toBe(true);
		expect(sameAction({ n: 1 }, { n: "1" })).toBe(false);
	});
});

describe("judgeTx", () => {
	it("matches the proposal whose action is the transaction's action", () => {
		expect(
			judgeTx(tx(), T, [
				proposal(1),
				proposal(2, usdSend({ time: NONCE + 1 })),
			]),
		).toEqual({
			kind: "matched",
			digest: digest(1),
		});
		expect(
			judgeTx(tx({ user: T.toUpperCase().replace("0X", "0x") }), T, [
				proposal(1),
			]).kind,
		).toBe("matched");
	});
	it("is 'none' for another action, and for another account's transaction", () => {
		expect(
			judgeTx(tx(), T, [proposal(1, usdSend({ time: NONCE + 1 }))]),
		).toEqual({ kind: "none" });
		expect(judgeTx(tx(), T, [])).toEqual({ kind: "none" });
		expect(judgeTx(tx({ user: OTHER }), T, [proposal(1)])).toEqual({
			kind: "none",
		});
	});
	it("says so when the hash is a rejected attempt", () => {
		expect(
			judgeTx(tx({ error: "Insufficient balance for withdrawal." }), T, [
				proposal(1),
			]),
		).toEqual({
			kind: "failed",
			error: "Insufficient balance for withdrawal.",
		});
	});
	it("does not choose between twins: the same action and number, two finalisers", () => {
		expect(
			judgeTx(tx(), T, [
				proposal(1),
				proposal(2, usdSend(), { finaliser: DEST }),
				proposal(1),
			]),
		).toEqual({ kind: "ambiguous", digests: [digest(1), digest(2)] });
	});
});

describe("rowProposal", () => {
	const known = [proposal(1)];
	it("never claims 'none on record' before the transaction is known", () => {
		expect(rowProposal(row(), T, known, undefined)).toEqual({
			kind: "checking",
		});
		expect(rowProposal(row(), T, known, { state: "pending" })).toEqual({
			kind: "checking",
		});
		expect(rowProposal(row(), T, known, { state: "failed" })).toEqual({
			kind: "unchecked",
		});
		expect(rowProposal(row(), T, known, { state: "unknown-hash" })).toEqual({
			kind: "unchecked",
		});
	});
	it("needs no look-up for rows that cannot be a proposal's", () => {
		expect(rowProposal(row({ direction: "in" }), T, known, undefined)).toEqual({
			kind: "not-applicable",
		});
		expect(rowProposal(row(), T, [], undefined)).toEqual({ kind: "none" });
	});
	it("says which proposal, once the transaction is known", () => {
		expect(rowProposal(row(), T, known, { state: "found", tx: tx() })).toEqual({
			kind: "matched",
			digest: digest(1),
		});
		// the same visible fields, another number: a send made outside the tool
		expect(
			rowProposal(row(), T, known, {
				state: "found",
				tx: tx({
					action: usdSend({ time: NONCE + 5 }) as ExplorerTx["action"],
				}),
			}),
		).toEqual({ kind: "none" });
		expect(
			rowProposal(
				row(),
				T,
				[proposal(1), proposal(2, usdSend(), { finaliser: DEST })],
				{
					state: "found",
					tx: tx(),
				},
			),
		).toEqual({ kind: "ambiguous", digests: [digest(1), digest(2)] });
	});
	it("judges against the row's own candidates only", () => {
		// proposal 2 has the transaction's action but disagrees with what the row shows
		const stray = proposal(2, usdSend({ amount: "5" }));
		expect(
			rowProposal(
				row(),
				T,
				[proposal(1, usdSend({ time: NONCE + 9 })), stray],
				{
					state: "found",
					tx: tx({ action: usdSend({ amount: "5" }) as ExplorerTx["action"] }),
				},
			),
		).toEqual({ kind: "none" });
	});
	it("a hash that is a rejected attempt is not this row's transaction", () => {
		expect(
			rowProposal(row(), T, known, {
				state: "found",
				tx: tx({ error: "nope" }),
			}),
		).toEqual({ kind: "none" });
	});
});

describe("a bridge withdrawal's ledger row", () => {
	// as Hyperliquid reports it (mainnet and testnet, 2026-10-12): the row lands
	// minutes later under the bridge's own hash, and its nonce is the action's time x 1000
	const withdraw3 = (time = NONCE, amount = "2") => ({
		type: "withdraw3",
		destination: DEST,
		amount,
		time,
	});
	const landed = (time = NONCE, over: Partial<LedgerRow> = {}) =>
		row({
			type: "withdraw",
			time: time + 10 * 60_000,
			hash: `0x${"ab".repeat(32)}`,
			amount: "2.0",
			counterparty: null,
			delta: { type: "withdraw", usdc: "2.0", nonce: time * 1000, fee: "1.0" },
			...over,
		});

	it("reads the action's number out of the row", () => {
		expect(withdrawalNumber(landed())).toBe(NONCE);
		// a string, as JSON of a large number may arrive
		expect(
			withdrawalNumber(
				landed(NONCE, {
					delta: { type: "withdraw", nonce: String(NONCE * 1000) },
				}),
			),
		).toBe(NONCE);
		// reported in the action's own unit: still that number
		expect(
			withdrawalNumber(
				landed(NONCE, { delta: { type: "withdraw", nonce: NONCE } }),
			),
		).toBe(NONCE);
	});

	it("claims nothing from a row that shows no usable number", () => {
		expect(withdrawalNumber(row())).toBeNull();
		for (const nonce of [undefined, null, "abc", 0, -5, 1.5, 12_000, 2 ** 60])
			expect(
				withdrawalNumber(landed(NONCE, { delta: { type: "withdraw", nonce } })),
				String(nonce),
			).toBeNull();
	});

	it("is tied to its proposal by that number, with no look-up", () => {
		const known = [
			proposal(1, withdraw3()),
			proposal(2, withdraw3(NONCE + 5_000)),
			proposal(3),
		];
		expect(rowProposal(landed(), T, known, undefined)).toEqual({
			kind: "matched",
			digest: digest(1),
		});
		// whatever a look-up of the bridge's hash said or did not say
		expect(rowProposal(landed(), T, known, { state: "failed" })).toEqual({
			kind: "matched",
			digest: digest(1),
		});
		expect(hashesToLookUp([landed()], known)).toEqual([]);
	});

	it("says none on record when no proposal has that number: the number was compared", () => {
		expect(
			rowProposal(
				landed(),
				T,
				[proposal(2, withdraw3(NONCE + 5_000))],
				undefined,
			),
		).toEqual({ kind: "none" });
		// a send with the same time is not a withdrawal
		expect(
			rowProposal(landed(), T, [proposal(3, usdSend())], undefined),
		).toEqual({ kind: "none" });
	});

	it("cannot tell two proposals of the same withdrawal apart", () => {
		expect(
			rowProposal(
				landed(),
				T,
				[proposal(1, withdraw3()), proposal(2, withdraw3())],
				undefined,
			),
		).toEqual({ kind: "ambiguous", digests: [digest(1), digest(2)] });
	});

	it("is left to the transaction when the row shows no number", () => {
		const bare = landed(NONCE, { delta: { type: "withdraw", usdc: "2.0" } });
		expect(rowProposal(bare, T, [proposal(1, withdraw3())], undefined)).toEqual(
			{ kind: "checking" },
		);
	});
});

describe("approvalOf", () => {
	const AGENT = `0x${"a8".repeat(20)}`;
	const approve = (
		n: number,
		over: Record<string, unknown> = {},
		accepted = true,
		nonce = NONCE,
	) => ({
		digest: digest(n),
		action: {
			type: "approveAgent",
			agentAddress: AGENT,
			agentName: "bot",
			nonce,
			...over,
		} as MatchCandidate["action"],
		nonce,
		accepted,
	});
	it("names the accepted proposal that approved the wallet", () => {
		expect(
			approvalOf(AGENT.toUpperCase().replace("0X", "0x"), [approve(1)]),
		).toBe(digest(1));
	});
	it("ignores proposals that were not accepted, name another wallet, or are another action", () => {
		expect(approvalOf(AGENT, [approve(1, {}, false)])).toBeNull();
		expect(approvalOf(AGENT, [approve(1, { agentAddress: OTHER })])).toBeNull();
		expect(
			approvalOf(AGENT, [
				{
					digest: digest(1),
					action: usdSend({ agentAddress: AGENT }) as MatchCandidate["action"],
					nonce: NONCE,
					accepted: true,
				},
			]),
		).toBeNull();
		expect(approvalOf(AGENT, [])).toBeNull();
	});
	it("takes the newest when the wallet was approved more than once", () => {
		expect(
			approvalOf(AGENT, [
				approve(1),
				approve(2, {}, true, NONCE + 10),
				approve(3, {}, false, NONCE + 20),
			]),
		).toBe(digest(2));
	});
});

describe("staking rows of the ledger", () => {
	const moveIn = (hype: number, over: Record<string, unknown> = {}) => ({
		type: "cDeposit",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		wei: hype * 100_000_000,
		nonce: NONCE,
		...over,
	});
	const staking = (isDeposit: boolean, over: Partial<LedgerRow> = {}) =>
		row({
			type: "cStakingTransfer",
			direction: "within",
			token: "HYPE",
			amount: "0.03",
			counterparty: null,
			fromVenue: isDeposit ? "spot" : "staking",
			toVenue: isDeposit ? "staking" : "spot",
			fee: null,
			feeToken: null,
			delta: {
				type: "cStakingTransfer",
				token: "HYPE",
				amount: "0.03",
				isDeposit,
			},
			...over,
		});

	it("a move into staking is tied to the proposal that moved that amount in, and to no other kind", () => {
		const proposals = [
			proposal(1, moveIn(0.03)),
			proposal(2, moveIn(0.5)),
			// a send of the same day is no candidate for a staking row
			proposal(3),
			proposal(4, {
				type: "tokenDelegate",
				validator: DEST,
				wei: 3_000_000,
				isUndelegate: false,
				nonce: NONCE,
			}),
		];
		expect(candidatesFor(staking(true), proposals)).toEqual({
			kind: "candidates",
			digests: [digest(1)],
		});
		expect(
			rowProposal(staking(true), T, proposals, {
				state: "found",
				tx: tx({ action: moveIn(0.03) as ExplorerTx["action"] }),
			}),
		).toEqual({ kind: "matched", digest: digest(1) });
		expect(candidatesFor(staking(true), [proposal(3)])).toEqual({
			kind: "none",
		});
	});

	it("a return that landed is Hyperliquid's own step: no proposal is looked for, none is called missing", () => {
		const landed = staking(false, { hash: `0x${"0".repeat(64)}` });
		const proposals = [proposal(1, moveIn(0.03)), proposal(3)];
		expect(candidatesFor(landed, proposals)).toEqual({ kind: "own-step" });
		expect(rowProposal(landed, T, proposals, undefined)).toEqual({
			kind: "own-step",
		});
		expect(hashesToLookUp([landed], proposals)).toEqual([]);
	});
});

describe("vault rows of the ledger", () => {
	const VAULT = "0x49d05977597b22e3c73d654c351adde9d9920e18";
	const HLP = "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0";
	const vaultAction = (
		usdc: number,
		isDeposit = true,
		vaultAddress = VAULT,
	) => ({
		type: "vaultTransfer",
		vaultAddress,
		isDeposit,
		usd: Math.round(usdc * 1_000_000),
	});
	/** The rows as Hyperliquid wrote them on testnet (fixtures/multisig/vaults.json). */
	const deposited = (usdc = "5.0", over: Partial<LedgerRow> = {}) =>
		row({
			type: "vaultDeposit",
			direction: "within",
			amount: usdc,
			counterparty: VAULT,
			fromVenue: "perp",
			toVenue: "vault",
			fee: null,
			feeToken: null,
			delta: { type: "vaultDeposit", vault: VAULT, usdc },
			...over,
		});
	const withdrawn = (
		requestedUsd = "2.999999",
		over: Partial<LedgerRow> = {},
	) =>
		row({
			type: "vaultWithdraw",
			direction: "within",
			amount: requestedUsd,
			counterparty: VAULT,
			fromVenue: "vault",
			toVenue: "perp",
			fee: null,
			feeToken: null,
			delta: {
				type: "vaultWithdraw",
				vault: VAULT,
				user: T,
				requestedUsd,
				commission: "0.0",
				closingCost: "0.0",
				basis: "3.000035",
				netWithdrawnUsd: requestedUsd,
			},
			...over,
		});

	it("ties a deposit to the one proposal that agrees with it, as likely and never as certain", () => {
		const proposals = [
			proposal(1, vaultAction(5)),
			// another amount, another vault, the other direction, another kind
			proposal(2, vaultAction(6)),
			proposal(3, vaultAction(5, true, HLP)),
			proposal(4, vaultAction(5, false)),
			proposal(5),
		];
		expect(candidatesFor(deposited(), proposals)).toEqual({
			kind: "candidates",
			digests: [digest(1)],
		});
		// with no look-up at all: the transaction could not say which proposal it was
		expect(rowProposal(deposited(), T, proposals, undefined)).toEqual({
			kind: "likely",
			digest: digest(1),
		});
		// and a transaction that carries the very same action changes nothing
		expect(
			rowProposal(deposited(), T, proposals, {
				state: "found",
				tx: tx({ action: vaultAction(5) as never }),
			}),
		).toEqual({ kind: "likely", digest: digest(1) });
		expect(hashesToLookUp([deposited()], proposals)).toEqual([]);
	});

	it("does not tell two proposals for the same deposit apart", () => {
		const twins = [
			proposal(1, vaultAction(5)),
			proposal(2, vaultAction(5), { nonce: NONCE + 60_000 }),
		];
		expect(rowProposal(deposited(), T, twins, undefined)).toEqual({
			kind: "ambiguous",
			digests: [digest(1), digest(2)],
		});
	});

	it("says none on record for a deposit no proposal asked for (an API wallet can make one)", () => {
		expect(rowProposal(deposited(), T, [proposal(5)], undefined)).toEqual({
			kind: "none",
		});
		// a proposal from outside the window in which its number could have landed
		expect(
			rowProposal(
				deposited(),
				T,
				[
					proposal(1, vaultAction(5), {
						nonce: NONCE - LANDS_AFTER_NONCE_MS - 10_000,
					}),
				],
				undefined,
			),
		).toEqual({ kind: "none" });
	});

	it("ties a withdrawal by what was asked for, which the row may show a millionth short", () => {
		const proposals = [
			proposal(1, vaultAction(3, false)),
			proposal(2, vaultAction(2.9, false)),
			proposal(3, vaultAction(3, true)),
		];
		// 3 USDC asked for stood in the row as "2.999999"
		expect(rowProposal(withdrawn("2.999999"), T, proposals, undefined)).toEqual(
			{
				kind: "likely",
				digest: digest(1),
			},
		);
		expect(rowProposal(withdrawn("3.0"), T, proposals, undefined)).toEqual({
			kind: "likely",
			digest: digest(1),
		});
		// further off than rounding, or more than was asked: not that proposal
		expect(rowProposal(withdrawn("2.99999"), T, proposals, undefined)).toEqual({
			kind: "none",
		});
		expect(rowProposal(withdrawn("3.000001"), T, proposals, undefined)).toEqual(
			{
				kind: "none",
			},
		);
		// a row that does not say what was asked for is tied to nothing
		const silent = withdrawn("3.0");
		expect(
			rowProposal(
				{ ...silent, delta: { type: "vaultWithdraw", vault: VAULT } },
				T,
				proposals,
				undefined,
			),
		).toEqual({ kind: "none" });
	});

	it("ties nothing to an action whose amount or vault cannot be read", () => {
		for (const odd of [
			{ ...vaultAction(5), usd: "5000000" },
			{ ...vaultAction(5), usd: 0 },
			{ ...vaultAction(5), vaultAddress: null },
		])
			expect(
				rowProposal(deposited(), T, [proposal(1, odd)], undefined),
			).toEqual({
				kind: "none",
			});
	});
});

describe("what the ledger says of one proposal", () => {
	const mine = digest(1);
	const a = row({ hash: `0x${"a1".repeat(32)}` as Hex });
	const b = row({ hash: `0x${"b2".repeat(32)}` as Hex });
	const cells = (...kinds: RowProposal[]) => {
		const byHash = new Map([a, b].map((r, i) => [r.hash, kinds[i]]));
		return (r: LedgerRow) => byHash.get(r.hash) ?? { kind: "none" as const };
	};
	it("a row tied to it by its number is its transaction", () => {
		expect(
			ledgerEvidence(
				[a, b],
				cells({ kind: "none" }, { kind: "matched", digest: mine }),
				mine,
			),
		).toEqual({ tied: b.hash, like: false });
		// a row tied to another proposal says nothing of this one
		expect(
			ledgerEvidence([a], cells({ kind: "matched", digest: digest(2) }), mine),
		).toEqual({ tied: null, like: false });
	});
	it("a row that could not be told is 'like it', never proof", () => {
		for (const cell of [
			{ kind: "unchecked" },
			{ kind: "checking" },
			{ kind: "likely", digest: mine },
			{ kind: "ambiguous", digests: [digest(2), mine] },
		] as RowProposal[])
			expect(ledgerEvidence([a], cells(cell), mine), cell.kind).toEqual({
				tied: null,
				like: true,
			});
		// likely or ambiguous for other proposals, or nothing to do with one
		for (const cell of [
			{ kind: "likely", digest: digest(2) },
			{ kind: "ambiguous", digests: [digest(2), digest(3)] },
			{ kind: "none" },
			{ kind: "own-step" },
			{ kind: "not-applicable" },
		] as RowProposal[])
			expect(ledgerEvidence([a], cells(cell), mine), cell.kind).toEqual({
				tied: null,
				like: false,
			});
	});
	it("proof beats a look-alike, and no ledger says nothing", () => {
		expect(
			ledgerEvidence(
				[a, b],
				cells({ kind: "unchecked" }, { kind: "matched", digest: mine }),
				mine,
			),
		).toEqual({ tied: b.hash, like: false });
		expect(ledgerEvidence(null, cells(), mine)).toEqual({
			tied: null,
			like: false,
		});
	});
});
