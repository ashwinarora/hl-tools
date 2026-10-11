/**
 * A user-signed action signed by the account itself (the first conversion to
 * a multi-sig): byte-identical to the SDK, and every conversion recorded on
 * testnet recovers to the account that sent it.
 */
import { readFileSync } from "node:fs";
import { ConvertToMultiSigUserTypes } from "@nktkas/hyperliquid/api/exchange";
import { signUserSignedAction } from "@nktkas/hyperliquid/signing";
import { describe, expect, it } from "vitest";
import {
	checksumMismatch,
	conversionAction,
	explainExchangeError,
	type PlainObject,
	parseSignersString,
	plainDigest,
	recoverInnerSigner,
	type Sig,
	signUserAction,
	trimSig,
	userActionBody,
	viemSigner,
} from "../../src/multisig/index.ts";
import { A, ACCOUNTS, ADDRESSES, B, C, NONCE, TREASURY } from "./_helpers.ts";

type Account = NonNullable<(typeof ACCOUNTS)[number]>;
const treasury = ACCOUNTS[0] as Account;
const stranger = ACCOUNTS[4] as Account;

interface Recorded {
	about: string;
	account: string;
	action: PlainObject;
	signature: Sig;
	accepted: boolean;
	answer: { status: string; response?: unknown };
	signer?: { role: string; funded: boolean | null };
}
const recorded = (
	JSON.parse(
		readFileSync(
			new URL("../../fixtures/multisig/plain-convert.json", import.meta.url),
			"utf8",
		),
	) as { conversions: Recorded[] }
).conversions;

const convert = (over: Partial<Parameters<typeof conversionAction>[0]> = {}) =>
	conversionAction({
		network: "testnet",
		signatureChainId: "0x3e6",
		set: { authorizedUsers: [A, B, C], threshold: 2 },
		nonce: NONCE,
		...over,
	});

describe("conversionAction", () => {
	it("builds the canonical action: signers lowercased, deduplicated and sorted", () => {
		const built = convert({
			set: {
				authorizedUsers: [
					C,
					A.toUpperCase().replace("0X", "0x"),
					B,
					A,
				] as never,
				threshold: 2,
			},
		});
		expect(built.issues).toEqual([]);
		expect(built.action).toEqual({
			type: "convertToMultiSigUser",
			signatureChainId: "0x3e6",
			hyperliquidChain: "Testnet",
			signers: JSON.stringify({
				authorizedUsers: [A, B, C].sort(),
				threshold: 2,
			}),
			nonce: NONCE,
		});
		expect(Object.keys(built.action as object)).toEqual([
			"type",
			"signatureChainId",
			"hyperliquidChain",
			"signers",
			"nonce",
		]);
	});
	it("converts back with the one value Hyperliquid takes for that", () => {
		expect(convert({ set: null }).action?.signers).toBe("null");
		expect(
			convert({ network: "mainnet", set: null }).action?.hyperliquidChain,
		).toBe("Mainnet");
	});
	it("says so when the chain is not a hex id", () => {
		const bad = convert({ signatureChainId: "998" });
		expect(bad.action).toBeNull();
		expect(bad.issues.map((i) => i.code)).toContain(
			"usersigned.signatureChainId",
		);
	});
});

describe("plainDigest and signUserAction", () => {
	const action = convert().action as PlainObject;
	it("leads the wallet to the signature the SDK produces", async () => {
		for (const chain of ["0x3e6", "0x66eee", "0xa4b1", "0x1"]) {
			const a = convert({ signatureChainId: chain }).action as PlainObject;
			const ours = await signUserAction(a, viemSigner(treasury), {
				expectedSigner: TREASURY,
			});
			const theirs = await signUserSignedAction({
				wallet: treasury,
				action: a as never,
				types: ConvertToMultiSigUserTypes,
			});
			expect(ours.issues).toEqual([]);
			expect(trimSig(ours.signature as Sig)).toEqual(trimSig(theirs));
			expect(ours.recovered).toBe(TREASURY);
			expect(ours.digest).toBe(plainDigest(a).digest);
		}
	});
	it("signs the fields a wallet shows: the chain, the signers, the number", () => {
		const d = plainDigest(action);
		expect(d.typedData?.primaryType).toBe(
			"HyperliquidTransaction:ConvertToMultiSigUser",
		);
		expect(d.typedData?.domain.chainId).toBe(998);
		expect(d.typedData?.message).toEqual({
			hyperliquidChain: "Testnet",
			signers: action.signers,
			nonce: BigInt(NONCE),
		});
	});
	it("refuses a signature from another key: Hyperliquid would act for whoever signed", async () => {
		const r = await signUserAction(action, viemSigner(stranger), {
			expectedSigner: TREASURY,
		});
		expect(r.signature).toBeNull();
		expect(r.recovered).toBe(ADDRESSES[4]);
		expect(r.issues.map((i) => i.code)).toEqual(["signature.signer_mismatch"]);
		expect(r.issues[0]?.message).toContain("nothing was sent");
	});
	it("needs to know which account is meant", async () => {
		const r = await signUserAction(action, viemSigner(treasury), {
			expectedSigner: "0x1234",
		});
		expect(r.signature).toBeNull();
		expect(r.issues.map((i) => i.code)).toEqual(["address.invalid"]);
	});
	it("reports a wallet that refuses", async () => {
		const r = await signUserAction(
			action,
			{
				signTypedData: async () => {
					throw new Error("User rejected the request.");
				},
			},
			{ expectedSigner: TREASURY },
		);
		expect(r.signature).toBeNull();
		expect(r.issues.map((i) => i.code)).toEqual(["signer.failed"]);
	});
	it("only signs what is user-signed and complete", async () => {
		const order = { type: "order", orders: [], grouping: "na" };
		expect(plainDigest(order).issues.map((i) => i.code)).toEqual([
			"plain.not_user_signed",
		]);
		expect(plainDigest({ nothing: true }).digest).toBeNull();
		const noChain = { ...action } as Record<string, unknown>;
		delete noChain.signatureChainId;
		expect(plainDigest(noChain as PlainObject).typedData).toBeNull();
		const r = await signUserAction(order, viemSigner(treasury), {
			expectedSigner: TREASURY,
		});
		expect(r.issues.map((i) => i.code)).toEqual(["plain.not_user_signed"]);
		// a number beyond uint64 makes the EIP-712 encoder throw
		expect(
			plainDigest({ ...action, nonce: 1n << 64n } as PlainObject).issues.map(
				(i) => i.code,
			),
		).toEqual(["digest.failed"]);
	});
});

describe("userActionBody", () => {
	it("posts the action with its own number as the request's", () => {
		const action = convert().action as PlainObject;
		const sig = { r: "0x01", s: "0x02", v: 27 } as Sig;
		expect(userActionBody(action, sig)).toEqual({
			action,
			nonce: NONCE,
			signature: sig,
		});
		// the older sends carry their number as `time`
		expect(
			userActionBody({ type: "usdSend", time: 5 } as PlainObject, sig).nonce,
		).toBe(5);
		expect(
			userActionBody({ type: "order", nonce: 7 } as PlainObject, sig).nonce,
		).toBe(7);
	});
});

describe("conversions recorded on testnet", () => {
	it("cover every signing chain tried, and each kind of signer", () => {
		expect(recorded).toHaveLength(12);
		expect(
			new Set(
				recorded
					.filter((r) => r.accepted)
					.map((r) => r.action.signatureChainId),
			),
		).toEqual(new Set(["0x3e6", "0x66eee", "0x1", "0xa4b1", "0x3e7"]));
	});
	it.each(
		recorded.map((r) => [r.about, r] as const),
	)("%s: the signature recovers to the account that sent it", async (_name, r) => {
		const d = plainDigest(r.action);
		expect(d.issues).toEqual([]);
		expect(await recoverInnerSigner(d.digest as never, r.signature)).toBe(
			r.account,
		);
		expect(userActionBody(r.action, r.signature).nonce).toBe(r.action.nonce);
		// and this module builds that same action from its parts
		const set = parseSignersString(r.action.signers).set;
		expect(set).not.toBeNull();
		const rebuilt = conversionAction({
			network: "testnet",
			signatureChainId: String(r.action.signatureChainId),
			set,
			nonce: Number(r.action.nonce),
		});
		expect(JSON.stringify(rebuilt.action)).toBe(JSON.stringify(r.action));
	});
	it("explains each refusal", () => {
		const id = (about: RegExp) =>
			explainExchangeError(
				recorded.find((r) => about.test(r.about))?.answer,
				200,
			).id;
		expect(id(/never received funds$/)).toBe("must-deposit");
		expect(id(/API wallet never funded/)).toBe("multisig-signer-missing");
		expect(id(/vault among/)).toBe("multisig-signer-kind");
	});
	it("says who Hyperliquid takes as a signer", () => {
		const by = (role: string, funded: boolean | null) =>
			recorded.find(
				(r) => r.signer?.role === role && r.signer.funded === funded,
			)?.accepted;
		expect(by("agent", true)).toBe(true);
		expect(by("agent", false)).toBe(false);
		expect(by("vault", null)).toBe(false);
		expect(by("user (itself a multi-sig)", true)).toBe(true);
	});
});

describe("checksumMismatch", () => {
	const good = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
	it("is true only for capitals that contradict the checksum", () => {
		expect(checksumMismatch(good)).toBe(false);
		expect(checksumMismatch(` ${good} `)).toBe(false);
		expect(checksumMismatch(good.replace("5aA", "5Aa"))).toBe(true);
	});
	it("says nothing about an address in one case, or about what is no address", () => {
		expect(checksumMismatch(good.toLowerCase())).toBe(false);
		expect(checksumMismatch(`0x${good.slice(2).toUpperCase()}`)).toBe(false);
		expect(checksumMismatch("0x1234")).toBe(false);
		expect(checksumMismatch("")).toBe(false);
	});
});
