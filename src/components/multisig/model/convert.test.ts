import {
	type PlainObject,
	type Policy,
	type Sig,
	signUserAction,
	viemSigner,
} from "@hl-tools/core";
import { describe, expect, it, vi } from "vitest";
import { A, ACCOUNTS, B, C, NONCE, NOW, TREASURY } from "#/test/keys";
import {
	type ConvertDeps,
	type ConvertInput,
	convertChain,
	READ_BACK,
	runConvert,
} from "./convert";
import { outcomeText } from "./create";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import { submitUserAction, type UserActionResult } from "./submit";

type Account = NonNullable<(typeof ACCOUNTS)[number]>;
const treasuryKey = ACCOUNTS[0] as Account;
const strangerKey = ACCOUNTS[4] as Account;
const SET = { authorizedUsers: [A, B, C].sort(), threshold: 2 };
const POLICY: Policy = { ...SET, observedAt: NOW };
const input: ConvertInput = {
	network: "testnet",
	account: TREASURY,
	set: SET,
	signatureChainId: "0x3e6",
	nonce: NONCE,
};
const OK: UserActionResult = {
	httpStatus: 200,
	response: { status: "ok", response: { type: "default" } },
	explained: { id: "ok", message: "", cause: "", fix: "" } as never,
	ok: true,
};
const refused = (id: string, message: string): UserActionResult => ({
	httpStatus: 200,
	response: { status: "err", response: message },
	explained: { id, message, cause: "", fix: "" } as never,
	ok: false,
});
function deps(over: Partial<ConvertDeps> = {}): ConvertDeps & {
	posted: { action: PlainObject; signature: Sig }[];
	steps: string[];
} {
	const posted: { action: PlainObject; signature: Sig }[] = [];
	const steps: string[] = [];
	return {
		posted,
		steps,
		sign: (action) =>
			signUserAction(action, viemSigner(treasuryKey), {
				expectedSigner: TREASURY,
			}),
		post: async (action, signature) => {
			posted.push({ action, signature });
			return OK;
		},
		readSigners: async () => POLICY,
		wait: async () => {},
		onStep: (s) => steps.push(s),
		...over,
	};
}

describe("runConvert", () => {
	it("signs, sends and reads the signer set back", async () => {
		const d = deps();
		const out = await runConvert(input, d);
		expect(out).toEqual({ kind: "converted", policy: POLICY });
		expect(d.steps).toEqual(["wallet", "sending", "reading"]);
		expect(d.posted).toHaveLength(1);
		expect(d.posted[0]?.action).toEqual({
			type: "convertToMultiSigUser",
			signatureChainId: "0x3e6",
			hyperliquidChain: "Testnet",
			signers: JSON.stringify(SET),
			nonce: NONCE,
		});
	});
	it("waits for the signer set to show, and says so if it does not", async () => {
		let reads = 0;
		const slow = deps({
			readSigners: async () => (++reads < 3 ? null : POLICY),
		});
		expect((await runConvert(input, slow)).kind).toBe("converted");
		expect(reads).toBe(3);
		const never = deps({
			readSigners: async () => null,
			wait: vi.fn(async () => {}),
		});
		expect(await runConvert(input, never)).toEqual({ kind: "unconfirmed" });
		expect(never.wait).toHaveBeenCalledTimes(READ_BACK.tries - 1);
		// another signer set than the one asked for is not a confirmation either
		const other = deps({
			readSigners: async () => ({ ...POLICY, threshold: 3 }),
		});
		expect((await runConvert(input, other)).kind).toBe("unconfirmed");
	});
	it("sends nothing when the wallet refuses", async () => {
		const d = deps({
			sign: (action) =>
				signUserAction(
					action,
					{
						signTypedData: async () => {
							throw new Error("User rejected the request.");
						},
					},
					{ expectedSigner: TREASURY },
				),
		});
		const out = await runConvert(input, d);
		expect(out.kind).toBe("not-signed");
		expect(out.kind === "not-signed" && out.reason).toContain("User rejected");
		expect(d.posted).toEqual([]);
		// a signer that gives no reason still gets a sentence
		const silent = deps({
			sign: async () => ({
				signature: null,
				recovered: null,
				digest: null,
				issues: [],
			}),
		});
		expect(await runConvert(input, silent)).toEqual({
			kind: "not-signed",
			reason: "The wallet did not sign.",
		});
	});
	it("sends nothing when the wallet signs with another key", async () => {
		const d = deps({
			sign: (action) =>
				signUserAction(action, viemSigner(strangerKey), {
					expectedSigner: TREASURY,
				}),
		});
		const out = await runConvert(input, d);
		expect(out).toEqual({
			kind: "wrong-key",
			signedBy: strangerKey.address.toLowerCase(),
		});
		expect(d.posted).toEqual([]);
	});
	it("sends nothing either when the signer hands back another key's signature without a word", async () => {
		// a signer that was told to expect the wrong account raises no issue;
		// the check where the request is sent is the one that counts
		const asStranger = (action: Parameters<typeof signUserAction>[0]) =>
			signUserAction(action, viemSigner(strangerKey), {
				expectedSigner: strangerKey.address.toLowerCase() as typeof TREASURY,
			});
		const d = deps({ sign: asStranger });
		const out = await runConvert(input, d);
		expect(out).toEqual({
			kind: "wrong-key",
			signedBy: strangerKey.address.toLowerCase(),
		});
		expect(d.posted).toEqual([]);
		// and one that says nothing about who signed is not believed
		const mute = deps({
			sign: async (action) => ({
				...(await asStranger(action)),
				recovered: null,
			}),
		});
		expect(await runConvert(input, mute)).toEqual({
			kind: "wrong-key",
			signedBy: null,
		});
		expect(mute.posted).toEqual([]);
	});
	it("reports Hyperliquid's refusal by its id, and reads nothing", async () => {
		const read = vi.fn(async () => POLICY);
		const d = deps({
			post: async () =>
				refused(
					"multisig-signer-missing",
					"Multi-sig authorized user must exist on L1",
				),
			readSigners: read,
		});
		expect(await runConvert(input, d)).toEqual({
			kind: "refused",
			id: "multisig-signer-missing",
			message: "Multi-sig authorized user must exist on L1",
		});
		expect(read).not.toHaveBeenCalled();
	});
	it("does not guess when the request got no answer: the signer set decides", async () => {
		const lost = async () => {
			throw new TypeError("Failed to fetch");
		};
		expect(await runConvert(input, deps({ post: lost }))).toEqual({
			kind: "unanswered",
			converted: true,
			policy: POLICY,
		});
		expect(
			await runConvert(
				input,
				deps({ post: lost, readSigners: async () => null }),
			),
		).toEqual({ kind: "unanswered", converted: false, policy: null });
		expect(
			await runConvert(
				input,
				deps({
					post: lost,
					readSigners: async () => {
						throw new Error("offline");
					},
				}),
			),
		).toEqual({ kind: "unanswered", converted: null, policy: null });
	});
	it("refuses to start from a chain id that is not hex", async () => {
		const d = deps();
		const out = await runConvert(
			{ ...input, signatureChainId: "998" as never },
			d,
		);
		expect(out.kind).toBe("invalid");
		expect(d.steps).toEqual([]);
	});
});

describe("convertChain", () => {
	it("stays on the wallet's chain when it is a chain of the network being converted", () => {
		expect(convertChain(998, "testnet")).toEqual({
			hex: "0x3e6",
			id: 998,
			switches: false,
		});
		expect(convertChain(421614, "testnet")).toMatchObject({
			hex: "0x66eee",
			switches: false,
		});
		expect(convertChain(999, "mainnet")).toMatchObject({
			hex: "0x3e7",
			switches: false,
		});
		expect(convertChain(42161, "mainnet")).toMatchObject({
			hex: "0xa4b1",
			switches: false,
		});
	});
	it("never signs a conversion under the other network's chain", () => {
		// the audit's case: a mainnet conversion, the wallet on HyperEVM testnet (998)
		expect(convertChain(998, "mainnet")).toEqual({
			hex: "0x3e7",
			id: 999,
			switches: true,
		});
		expect(convertChain(421614, "mainnet")).toMatchObject({
			hex: "0x3e7",
			switches: true,
		});
		// and the mirror image
		expect(convertChain(999, "testnet")).toMatchObject({
			hex: "0x3e6",
			switches: true,
		});
		expect(convertChain(42161, "testnet")).toMatchObject({
			hex: "0x3e6",
			switches: true,
		});
	});
	it("asks for this network's HyperEVM from any other chain", () => {
		expect(convertChain(1, "mainnet")).toEqual({
			hex: "0x3e7",
			id: 999,
			switches: true,
		});
		expect(convertChain(137, "testnet")).toEqual({
			hex: "0x3e6",
			id: 998,
			switches: true,
		});
		expect(convertChain(null, "testnet")).toMatchObject({
			hex: "0x3e6",
			switches: true,
		});
	});
});

describe("submitUserAction", () => {
	const action = {
		type: "convertToMultiSigUser",
		signatureChainId: "0x3e6",
		hyperliquidChain: "Testnet",
		signers: JSON.stringify(SET),
		nonce: NONCE,
	} as PlainObject;
	const sig = {
		r: `0x${"11".repeat(32)}`,
		s: `0x${"22".repeat(32)}`,
		v: 27,
	} as Sig;
	const answering =
		(status: number, body: string) =>
		async (url: unknown, init?: RequestInit) => {
			calls.push({ url: String(url), body: String(init?.body) });
			return new Response(body, { status });
		};
	const calls: { url: string; body: string }[] = [];

	it("posts the action with its own number and the signature, to the network's exchange", async () => {
		calls.length = 0;
		const r = await submitUserAction("testnet", action, sig, {
			fetch: answering(
				200,
				'{"status":"ok","response":{"type":"default"}}',
			) as never,
		});
		expect(r.ok).toBe(true);
		expect(r.explained.id).toBe("ok");
		expect(calls[0]?.url).toBe("https://api.hyperliquid-testnet.xyz/exchange");
		expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
			action,
			nonce: NONCE,
			signature: sig,
		});
	});
	it("turns an error body, an HTTP error and a body that is not JSON into answers", async () => {
		const refusedBody = await submitUserAction("testnet", action, sig, {
			fetch: answering(
				200,
				'{"status":"err","response":"Multi-sig authorized user cannot be vault or sub-account"}',
			) as never,
		});
		expect(refusedBody.ok).toBe(false);
		expect(refusedBody.explained.id).toBe("multisig-signer-kind");
		const limited = await submitUserAction("mainnet", action, sig, {
			fetch: answering(429, "") as never,
		});
		expect(limited.ok).toBe(false);
		expect(limited.httpStatus).toBe(429);
		expect(limited.response).toBe("");
	});
	it("rejects only when no answer came", async () => {
		await expect(
			submitUserAction("testnet", action, sig, {
				fetch: (async () => {
					throw new TypeError("Failed to fetch");
				}) as never,
			}),
		).rejects.toThrow("Failed to fetch");
	});
});

describe("outcomeText", () => {
	const all = [
		outcomeText({ kind: "converted", policy: POLICY }, TREASURY),
		outcomeText(
			{ kind: "not-signed", reason: "The wallet refused." },
			TREASURY,
		),
		outcomeText({ kind: "wrong-key", signedBy: A }, TREASURY),
		outcomeText({ kind: "wrong-key", signedBy: null }, TREASURY),
		outcomeText(
			{ kind: "refused", id: "multisig-self", message: "x" },
			TREASURY,
		),
		outcomeText({ kind: "unconfirmed" }, TREASURY),
		outcomeText(
			{ kind: "unanswered", converted: true, policy: POLICY },
			TREASURY,
		),
		outcomeText(
			{ kind: "unanswered", converted: false, policy: null },
			TREASURY,
		),
		outcomeText(
			{ kind: "unanswered", converted: null, policy: null },
			TREASURY,
		),
		outcomeText({ kind: "invalid", issues: [] }, TREASURY),
		outcomeText(
			{
				kind: "invalid",
				issues: [{ code: "x", severity: "error", message: "Bad chain." }],
			},
			TREASURY,
		),
	];
	it("says plainly whether anything was sent, and never claims what it does not know", () => {
		expect(all[0]).toMatchObject({ tone: "success" });
		expect(all[0]?.body).toContain("is now a 2-of-3 treasury");
		expect(all[1]?.body).toBe(
			"Nothing was signed or sent. The wallet refused.",
		);
		// as the core reports a wallet that said no (seen in the browser): said without its "the signer"
		expect(
			outcomeText(
				{
					kind: "not-signed",
					reason: "The signer refused or failed: You declined in the wallet.",
				},
				TREASURY,
			).body,
		).toBe("Nothing was signed or sent. You declined in the wallet.");
		expect(all[2]?.body).toContain(
			"Nothing was sent: the wallet signed with 0x",
		);
		expect(all[3]?.body).toContain("another key");
		expect(all[4]?.body).toContain("Nothing changed.");
		expect(all[5]?.tone).toBe("warning");
		expect(all[6]?.tone).toBe("success");
		expect(all[7]?.body).toContain("is not a treasury");
		expect(all[8]?.tone).toBe("warning");
		expect(all[8]?.body).not.toMatch(/nothing was sent/i);
		expect(all[9]?.body).toContain("could not be built");
		expect(all[10]?.body).toContain("Bad chain.");
		for (const t of all)
			for (const claim of FORBIDDEN_CLAIMS) {
				expect(t.title).not.toMatch(claim);
				expect(t.body).not.toMatch(claim);
			}
	});
});
