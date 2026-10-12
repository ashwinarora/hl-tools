/**
 * The finaliser's click on a move of two steps, against a stand-in for
 * Hyperliquid: what is asked, what is signed and what is posted, in which
 * order, and where it stops.
 */
import {
	classifySignatures,
	createProposal,
	type Proposal,
	readiness,
	signProposal,
	type TypedDataSigner,
	tieSteps,
	viemSigner,
} from "@hl-tools/core";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A, ACCOUNTS, B, NOW, POLICY, TREASURY } from "#/test/keys";
import { loadProposal, saveProposal } from "../model/history";
import { deriveStage } from "../model/stage";
import type { WalletSigner } from "../useWalletSigner";
import { finalise, finaliseMove, type MoveStep, signMove } from "./actions";

const X = "0x946bf3135c7d15e4462b510f74b6e304aabb5b21";
const HEAD = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
const HYPE = 100_000_000;

/** What happened, in order: every read, wallet prompt and post. */
let log: string[];
/** What the stand-in answers. */
let spotHype: string;
let unstaked: string;
/** Hyperliquid's answer to each post, in order: a refusal, null for "ok", or an error for a request that does not get there. */
let exchange: (string | null | Error)[];
let declineAt: number | null;
/** Every request body posted to Hyperliquid, as it was sent. */
let posted: { action: { signatureChainId: string } }[];
/** The pretend wallet does not hold the signing network. */
let lacksNetwork: boolean;

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
	log = [];
	spotHype = "400";
	unstaked = "50";
	exchange = [];
	declineAt = null;
	posted = [];
	lacksNetwork = false;
	vi.spyOn(Date, "now").mockReturnValue(NOW);
	vi.stubGlobal("fetch", (async (url: string, init: RequestInit) => {
		const body = JSON.parse(init.body as string);
		const json = (v: unknown) =>
			new Response(JSON.stringify(v), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		if (String(url).endsWith("/exchange")) {
			log.push(`post ${body.action.payload.action.type}`);
			posted.push(body);
			const answer = exchange.shift();
			if (answer instanceof Error) throw answer;
			return json(
				answer
					? { status: "err", response: answer }
					: { status: "ok", response: { type: "default" } },
			);
		}
		log.push(`read ${body.type}`);
		switch (body.type) {
			case "userToMultiSigSigners":
				return json({
					authorizedUsers: POLICY.authorizedUsers,
					threshold: POLICY.threshold,
				});
			case "spotClearinghouseState":
				return json({
					balances: [
						{ coin: "HYPE", token: 150, total: spotHype, hold: "0" },
						{ coin: "USDC", token: 0, total: "100", hold: "0" },
					],
				});
			// a manual account with 30 USDC that perps can release, and nothing in a vault yet
			case "userAbstraction":
				return json("default");
			case "clearinghouseState":
				return json({
					marginSummary: {
						accountValue: "30",
						totalNtlPos: "0",
						totalMarginUsed: "0",
					},
					withdrawable: "30",
					assetPositions: [],
				});
			case "userVaultEquities":
				return json([]);
			case "vaultDetails":
				return json({
					name: "A vault",
					vaultAddress: body.vaultAddress,
					leader: body.vaultAddress,
				});
			case "delegatorSummary":
				return json({
					delegated: "0",
					undelegated: unstaked,
					totalPendingWithdrawal: "0",
					nPendingWithdrawals: 0,
				});
			case "delegations":
				return json([]);
			case "validatorSummaries":
				return json([{ validator: X, name: "Hypurr", stake: 1, stats: [] }]);
			default:
				throw new Error(`unexpected read ${body.type}`);
		}
	}) as unknown as typeof fetch);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** A wallet that signs as B and writes down every prompt. */
function walletOfB(): WalletSigner {
	const real = viemSigner(ACCOUNTS[2] as never);
	let prompts = 0;
	const signer: TypedDataSigner = {
		signTypedData: async (args) => {
			prompts += 1;
			if (declineAt === prompts) throw new Error("User rejected the request.");
			log.push(`sign ${(args as { primaryType: string }).primaryType}`);
			return real.signTypedData(args);
		},
	};
	return {
		address: B,
		chainId: 998,
		connected: true,
		busy: false,
		signerFor: async (hex) => {
			log.push(`chain ${hex}`);
			if (hex === "0x539" && lacksNetwork)
				return { ok: false, error: "no such network", needsNetwork: true };
			return { ok: true, signer };
		},
		addSigningNetwork: async () => ({ ok: true }),
		run: async (_label, fn) => fn(),
	};
}

/** "Stake 100 HYPE with X" with 50 to come from spot: both steps signed by A, B finalises. */
async function move(): Promise<[Proposal, Proposal]> {
	const step = (action: Record<string, unknown>, nonce: number) => {
		const made = createProposal(
			{
				network: "testnet",
				multiSigUser: TREASURY,
				outerSigner: B,
				action: { ...action, ...HEAD, nonce },
				nonce,
				createdBy: A,
			},
			{ now: NOW },
		);
		if (!made.proposal) throw new Error(JSON.stringify(made.issues));
		return made.proposal;
	};
	const tied = tieSteps(
		step({ type: "cDeposit", wei: 50 * HYPE }, NOW),
		step(
			{
				type: "tokenDelegate",
				validator: X,
				wei: 100 * HYPE,
				isUndelegate: false,
			},
			NOW + 1,
		),
	);
	const out: Proposal[] = [];
	for (const p of tied) {
		const sig = await signProposal(p, viemSigner(ACCOUNTS[1] as never), {
			expectedSigner: A,
			at: NOW,
		});
		if (!sig.signature) throw new Error(JSON.stringify(sig.issues));
		out.push(
			(await saveProposal({ ...p, signatures: [sig.signature] })).proposal,
		);
	}
	return out as [Proposal, Proposal];
}

/** A step as the page hands it to the flow: its stage for B, and a document that is stored locally. */
async function stepOf(
	p: Proposal,
	over: Partial<MoveStep["doc"]> = {},
): Promise<MoveStep> {
	const classified = await classifySignatures(p, POLICY);
	return {
		proposal: p,
		stage: deriveStage({
			proposal: p,
			readiness: readiness(p, POLICY, classified, { now: NOW }),
			policy: POLICY,
			wallet: B,
			walletChainId: 998,
			now: NOW,
			// this build has the signing network
			codeSigning: true,
		}),
		doc: {
			store: async (incoming) => ({
				proposal: (await saveProposal(incoming)).proposal,
				issues: [],
			}),
			refresh: async () => null,
			relay: { known: false } as MoveStep["doc"]["relay"],
			...over,
		} as MoveStep["doc"],
	};
}
const stored = async (p: Proposal) =>
	(await loadProposal(p.digest)).proposal as Proposal;
const marks = () => {
	const seen: string[] = [];
	return {
		seen,
		mark: (index: number, id: string, state: string) =>
			seen.push(`${index + 1}.${id}:${state}`),
	};
};

describe("the finaliser's click on a move of two steps", () => {
	it("asks first, collects every signature, then sends step 1 and, once that is accepted, step 2", async () => {
		const [one, two] = await move();
		const steps = [await stepOf(one), await stepOf(two)];
		// B's own signature completes each step
		expect(steps.map((s) => s.stage.executeAddsSignature)).toEqual([
			true,
			true,
		]);
		const m = marks();
		const result = await finaliseMove({
			steps,
			wallet: walletOfB(),
			mark: m.mark,
		});
		expect(result).toEqual({ ok: true, accepted: true, sent: 2 });
		const prompts = log.filter((l) => l.startsWith("sign"));
		const posts = log.filter((l) => l.startsWith("post"));
		expect(prompts).toHaveLength(4);
		expect(posts).toEqual(["post cDeposit", "post tokenDelegate"]);
		// nothing is posted before the last signature is given
		expect(log.indexOf("post cDeposit")).toBeGreaterThan(
			log.lastIndexOf(prompts[3] as string),
		);
		// the whole move was checked before the first prompt
		expect(log.indexOf("read delegatorSummary")).toBeLessThan(
			log.indexOf(prompts[0] as string),
		);
		for (const p of [one, two]) {
			const after = await stored(p);
			expect(after.receipt?.response).toEqual({
				status: "ok",
				response: { type: "default" },
			});
			expect(after.signatures.map((s) => s.signer).sort()).toEqual(
				[A, B].sort(),
			);
		}
		expect(m.seen.at(-1)).toBe("2.submit:done");
	});

	it("does not send step 2 when Hyperliquid refuses step 1", async () => {
		const [one, two] = await move();
		exchange = ["Insufficient funds available to deposit."];
		const result = await finaliseMove({
			steps: [await stepOf(one), await stepOf(two)],
			wallet: walletOfB(),
			mark: marks().mark,
		});
		expect(result).toEqual({ ok: true, accepted: false, sent: 1 });
		expect(log.filter((l) => l.startsWith("post"))).toEqual(["post cDeposit"]);
		expect((await stored(one)).receipt?.response).toMatchObject({
			status: "err",
		});
		// step 2 was never sent: no answer on it, and its number is unused
		expect((await stored(two)).receipt).toBeNull();
	});

	it("says so when step 2 is refused after step 1 went through", async () => {
		const [one, two] = await move();
		exchange = [null, "Unknown validator"];
		const result = await finaliseMove({
			steps: [await stepOf(one), await stepOf(two)],
			wallet: walletOfB(),
			mark: marks().mark,
		});
		expect(result).toEqual({ ok: true, accepted: false, sent: 2 });
		expect((await stored(one)).receipt?.response).toMatchObject({
			status: "ok",
		});
		expect((await stored(two)).receipt?.response).toMatchObject({
			status: "err",
			response: "Unknown validator",
		});
	});

	it('a request for step 2 that does not get there is not called "nothing was submitted"', async () => {
		const [one, two] = await move();
		exchange = [null, new TypeError("Failed to fetch")];
		const result = await finaliseMove({
			steps: [await stepOf(one), await stepOf(two)],
			wallet: walletOfB(),
			mark: marks().mark,
		});
		// step 1 went through and stands; the page titles this "Step 2 was not sent"
		expect(result).toMatchObject({ ok: false, index: 1, sent: 1 });
		const said = result.ok ? "" : (result.issues[0]?.message ?? "");
		expect(said).toBe(
			"The request for this step did not reach Hyperliquid: The request did not reach the API (network error, blocked request or CORS). The step before it was accepted and stands. This step was not submitted; it is safe to try again.",
		);
		expect(said).not.toContain("Nothing was submitted");
		expect((await stored(one)).receipt?.response).toMatchObject({
			status: "ok",
		});
		expect((await stored(two)).receipt).toBeNull();
		// the first request not getting there is still "nothing was submitted"
		globalThis.indexedDB = new IDBFactory();
		const [three, four] = await move();
		exchange = [new TypeError("Failed to fetch")];
		const none = await finaliseMove({
			steps: [await stepOf(three), await stepOf(four)],
			wallet: walletOfB(),
			mark: marks().mark,
		});
		expect(none).toMatchObject({ ok: false, index: 0, sent: 0 });
		expect(none.ok ? "" : none.issues[0]?.message).toContain(
			"Nothing was submitted; it is safe to try again.",
		);
	});

	it("stops before any wallet prompt when Hyperliquid would refuse a step as things stand", async () => {
		const [one, two] = await move();
		spotHype = "10";
		const m = marks();
		const result = await finaliseMove({
			steps: [await stepOf(one), await stepOf(two)],
			wallet: walletOfB(),
			mark: m.mark,
		});
		expect(result).toMatchObject({ ok: false, index: 0, sent: 0 });
		expect(result.ok ? [] : result.issues.map((i) => i.code)).toEqual([
			"preflight.deposit-funds",
		]);
		expect(result.ok ? "" : result.issues[0]?.message).toContain("Step 1: ");
		expect(log.filter((l) => /^(sign|post)/.test(l))).toEqual([]);
	});

	it("posts nothing when a wallet prompt is not answered, whichever it is", async () => {
		for (const at of [1, 2, 3, 4]) {
			globalThis.indexedDB = new IDBFactory();
			log = [];
			declineAt = at;
			const [one, two] = await move();
			const result = await finaliseMove({
				steps: [await stepOf(one), await stepOf(two)],
				wallet: walletOfB(),
				mark: marks().mark,
			});
			expect(result.ok, `prompt ${at}`).toBe(false);
			expect(result).toMatchObject({
				index: at <= 2 ? 0 : 1,
				step: at % 2 === 1 ? "inner" : "envelope",
				sent: 0,
			});
			expect(log.filter((l) => l.startsWith("post"))).toEqual([]);
			expect((await stored(one)).receipt).toBeNull();
			expect((await stored(two)).receipt).toBeNull();
		}
	});

	it("stops when the relay says a step was withdrawn a moment ago", async () => {
		const [one, two] = await move();
		const withdrawn = {
			known: true,
		} as MoveStep["doc"]["relay"];
		const result = await finaliseMove({
			steps: [
				await stepOf(one),
				await stepOf(two, {
					relay: withdrawn,
					refresh: async () =>
						({
							ending: { kind: "withdrawn", endedBy: A, endedAt: NOW },
						}) as never,
				}),
			],
			wallet: walletOfB(),
			mark: marks().mark,
		});
		expect(result).toMatchObject({ ok: false, index: 1, sent: 0 });
		expect(result.ok ? [] : result.issues.map((i) => i.code)).toEqual([
			"relay.proposal_closed",
		]);
		expect(log.filter((l) => /^(sign|post)/.test(l))).toEqual([]);
	});

	it("sends only what is left: step 2 alone, once step 1 is done", async () => {
		const [, two] = await move();
		// step 1 has landed: the staking balance holds what step 2 stakes
		unstaked = "100";
		const result = await finaliseMove({
			steps: [await stepOf(two)],
			wallet: walletOfB(),
			mark: marks().mark,
		});
		expect(result).toEqual({ ok: true, accepted: true, sent: 1 });
		expect(log.filter((l) => l.startsWith("post"))).toEqual([
			"post tokenDelegate",
		]);
		expect(
			await finaliseMove({
				steps: [],
				wallet: walletOfB(),
				mark: marks().mark,
			}),
		).toEqual({
			ok: true,
			accepted: true,
			sent: 0,
		});
	});
});

describe("a signer signing both steps in one visit", () => {
	it("one prompt for each step not signed yet; a prompt not answered leaves what was signed", async () => {
		const [one, two] = await move();
		const steps = async () =>
			Promise.all(
				[one, two].map(async (p) => {
					const s = await stepOf(await stored(p));
					return { proposal: s.proposal, stage: s.stage, store: s.doc.store };
				}),
			);
		declineAt = 2;
		const first = await signMove({ steps: await steps(), wallet: walletOfB() });
		expect(first.outcome.ok).toBe(false);
		expect(first.signed).toBe(1);
		expect((await stored(one)).signatures).toHaveLength(2);
		expect((await stored(two)).signatures).toHaveLength(1);
		// asked again, only the missing one is signed
		declineAt = null;
		log = [];
		const second = await signMove({
			steps: await steps(),
			wallet: walletOfB(),
		});
		expect(second).toEqual({ outcome: { ok: true }, signed: 1 });
		expect(log.filter((l) => l.startsWith("sign"))).toHaveLength(1);
		expect((await stored(two)).signatures).toHaveLength(2);
	});
});

describe("a vault action, which is signed as a code", () => {
	const VAULT = "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0";
	/** Deposit 5 USDC, signed by A (a code under the signing network), B finalises. */
	async function deposit(): Promise<Proposal> {
		const made = createProposal(
			{
				network: "testnet",
				multiSigUser: TREASURY,
				outerSigner: B,
				action: {
					type: "vaultTransfer",
					vaultAddress: VAULT,
					isDeposit: true,
					usd: 5_000_000,
				},
				nonce: NOW,
				createdBy: A,
			},
			{ now: NOW },
		);
		if (!made.proposal) throw new Error(JSON.stringify(made.issues));
		expect(made.proposal.meta.kind).toBe("l1");
		const sig = await signProposal(
			made.proposal,
			viemSigner(ACCOUNTS[1] as never),
			{ expectedSigner: A, at: NOW },
		);
		if (!sig.signature) throw new Error(JSON.stringify(sig.issues));
		return (
			await saveProposal({ ...made.proposal, signatures: [sig.signature] })
		).proposal;
	}

	it("the finaliser's own signature on the action is given on the signing network, the envelope on the usual one", async () => {
		const p = await deposit();
		const step = await stepOf(p);
		expect([step.stage.signsCode, step.stage.requiredChain?.hex]).toEqual([
			true,
			"0x539",
		]);
		const m = marks();
		const result = await finalise({
			...step,
			wallet: walletOfB(),
			mark: m.mark.bind(null, 0),
		});
		expect(result).toEqual({ ok: true, accepted: true });
		// the code first, under 1337; then the readable envelope, under the chain the wallet was on
		expect(log.filter((l) => /^(chain|sign|post)/.test(l))).toEqual([
			"chain 0x539",
			"sign Agent",
			"chain 0x3e6",
			"sign HyperliquidTransaction:SendMultiSig",
			"post vaultTransfer",
		]);
		expect(posted[0]?.action.signatureChainId).toBe("0x3e6");
		const after = await stored(p);
		expect(after.signatures.map((x) => x.signer).sort()).toEqual([A, B].sort());
		expect(after.receipt?.response).toMatchObject({ status: "ok" });
	});

	/** "Deposit 50 USDC" with 20 to come from spot first: both steps signed by A, B finalises. */
	async function vaultMove(): Promise<[Proposal, Proposal]> {
		const step = (action: Record<string, unknown>, nonce: number) => {
			const made = createProposal(
				{
					network: "testnet",
					multiSigUser: TREASURY,
					outerSigner: B,
					action,
					nonce,
					createdBy: A,
				},
				{ now: NOW },
			);
			if (!made.proposal) throw new Error(JSON.stringify(made.issues));
			return made.proposal;
		};
		const tied = tieSteps(
			step(
				{
					type: "usdClassTransfer",
					...HEAD,
					amount: "20",
					toPerp: true,
					nonce: NOW,
				},
				NOW,
			),
			step(
				{
					type: "vaultTransfer",
					vaultAddress: VAULT,
					isDeposit: true,
					usd: 50_000_000,
				},
				NOW + 1,
			),
		);
		const out: Proposal[] = [];
		for (const p of tied) {
			const sig = await signProposal(p, viemSigner(ACCOUNTS[1] as never), {
				expectedSigner: A,
				at: NOW,
			});
			if (!sig.signature) throw new Error(JSON.stringify(sig.issues));
			out.push(
				(await saveProposal({ ...p, signatures: [sig.signature] })).proposal,
			);
		}
		return out as [Proposal, Proposal];
	}
	const doing = () => log.filter((l) => !l.startsWith("read "));

	it("a deposit in two steps: each signature under its own network, and the deposit sent only after the move to perps", async () => {
		const [one, two] = await vaultMove();
		expect([one.meta.kind, two.meta.kind]).toEqual(["user-signed", "l1"]);
		const steps = [await stepOf(one), await stepOf(two)];
		const { seen, mark } = marks();
		const result = await finaliseMove({ steps, wallet: walletOfB(), mark });
		expect(result).toEqual({ ok: true, accepted: true, sent: 2 });
		// every signature first, then the posts in order
		expect(doing()).toEqual([
			// step 1: B's own signature on the readable step, then as finaliser
			"chain 0x3e6",
			"sign HyperliquidTransaction:UsdClassTransfer",
			"chain 0x3e6",
			"sign HyperliquidTransaction:SendMultiSig",
			// step 2: the code under the signing network, the envelope back on the usual one
			"chain 0x539",
			"sign Agent",
			"chain 0x3e6",
			"sign HyperliquidTransaction:SendMultiSig",
			"post usdClassTransfer",
			"post vaultTransfer",
		]);
		// no envelope is ever signed under the signing network
		expect(posted.map((b) => b.action.signatureChainId)).toEqual([
			"0x3e6",
			"0x3e6",
		]);
		expect(seen.at(-1)).toBe("2.submit:done");
	});

	it("a deposit in two steps is left whole when the wallet lacks the signing network: nothing is posted", async () => {
		lacksNetwork = true;
		const [one, two] = await vaultMove();
		const steps = [await stepOf(one), await stepOf(two)];
		const result = await finaliseMove({
			steps,
			wallet: walletOfB(),
			mark: marks().mark,
		});
		expect(result).toMatchObject({ ok: false, needsNetwork: true, sent: 0 });
		expect(doing().filter((l) => l.startsWith("post"))).toEqual([]);
		// and a signer signing both steps hears the same, with step 1 signed
		lacksNetwork = true;
		const done = await signMove({
			steps: steps.map((s) => ({
				proposal: s.proposal,
				stage: s.stage,
				store: s.doc.store,
			})),
			wallet: walletOfB(),
		});
		expect(done.outcome).toMatchObject({ ok: false, needsNetwork: true });
	});

	it("a wallet without the signing network is not a failure: nothing is posted and the page is told to offer it", async () => {
		const p = await deposit();
		lacksNetwork = true;
		const result = await finalise({
			...(await stepOf(p)),
			wallet: walletOfB(),
			mark: () => undefined,
		});
		expect(result).toMatchObject({
			ok: false,
			step: "inner",
			needsNetwork: true,
		});
		expect(log.filter((l) => l.startsWith("post"))).toEqual([]);
		expect((await stored(p)).signatures).toHaveLength(1);
		// the same for a signer who only signs
		const s = await stepOf(p);
		const signed = await signMove({
			steps: [{ proposal: s.proposal, stage: s.stage, store: s.doc.store }],
			wallet: walletOfB(),
		});
		expect(signed.outcome).toMatchObject({ ok: false, needsNetwork: true });
		expect(signed.signed).toBe(0);
	});
});
