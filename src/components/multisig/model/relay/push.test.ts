import type { Proposal, Receipt } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, makeProposal, NOW, signAs } from "#/test/keys";
import { bareDocument } from "./assemble";
import {
	isRelayVaultAction,
	type PushInput,
	planPush,
	publishBlocker,
	publishRow,
	type RelayKnown,
	settledAlready,
} from "./push";

const SIG = {
	r: `0x${"11".repeat(32)}`,
	s: `0x${"22".repeat(32)}`,
	v: 27,
} as const;
const receipt = (submittedAt = NOW): Receipt =>
	({
		submittedAt,
		signatureChainId: "0x3e6",
		outerSignature: SIG,
		httpStatus: 200,
		response: { status: "ok", response: { type: "default" } },
	}) as Receipt;
const known = (over: Partial<RelayKnown> = {}): RelayKnown => ({
	status: "open",
	expired: false,
	signers: [],
	receiptTimes: [],
	...over,
});
const plan = (doc: Proposal, over: Partial<PushInput> = {}) =>
	planPush({
		doc,
		me: A,
		relay: known(),
		storedSigner: true,
		publish: false,
		removed: new Set(),
		explicit: true,
		...over,
	});
const kinds = (doc: Proposal, over: Partial<PushInput> = {}) =>
	plan(doc, over).map((o) => o.kind);

describe("planPush", () => {
	it("sends nothing when nobody is signed in", async () => {
		expect(
			kinds(await signAs(makeProposal(), 1), {
				me: null,
				publish: true,
				relay: null,
			}),
		).toEqual([]);
	});

	it("sends nothing for a proposal the relay does not have unless asked to share it", async () => {
		const p = await signAs(makeProposal(), 1);
		expect(kinds(p, { relay: null })).toEqual([]);
		expect(kinds({ ...p, receipt: receipt() }, { relay: null, me: B })).toEqual(
			[],
		);
	});

	it("shares, then signs: creating a proposal while signed in", async () => {
		const p = await signAs(makeProposal(), 1);
		const ops = plan(p, { relay: null, publish: true });
		expect(ops.map((o) => o.kind)).toEqual(["publish", "sign"]);
		expect(ops[0]).toEqual({ kind: "publish", row: publishRow(p) });
		const mine = p.signatures[0];
		expect(ops[1]).toEqual({
			kind: "sign",
			signature: { r: mine?.r, s: mine?.s, v: mine?.v },
		});
	});

	it("shares without signing when the proposer did not sign", () => {
		expect(kinds(makeProposal(), { relay: null, publish: true })).toEqual([
			"publish",
		]);
	});

	it("does not share for a wallet outside the stored signer list", async () => {
		expect(
			kinds(await signAs(makeProposal(), 1), {
				relay: null,
				publish: true,
				storedSigner: false,
			}),
		).toEqual([]);
	});

	it("does not share again what the relay already has", async () => {
		expect(kinds(await signAs(makeProposal(), 1), { publish: true })).toEqual([
			"sign",
		]);
	});

	it("adds this wallet's signature to a shared proposal, never anyone else's", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 2);
		const ops = plan(p, { me: B });
		expect(ops).toHaveLength(1);
		expect(ops[0]).toEqual({
			kind: "sign",
			signature: {
				r: p.signatures[1]?.r,
				s: p.signatures[1]?.s,
				v: p.signatures[1]?.v,
			},
		});
		expect(kinds(p, { me: C })).toEqual([]);
	});

	it("does not send a signature the relay already holds", async () => {
		expect(
			kinds(await signAs(makeProposal(), 1), {
				relay: known({ signers: [A] }),
			}),
		).toEqual([]);
	});

	it("does not sign a proposal that is closed or expired on the relay", async () => {
		const p = await signAs(makeProposal(), 1);
		expect(kinds(p, { relay: known({ status: "withdrawn" }) })).toEqual([]);
		expect(kinds(p, { relay: known({ status: "declined" }) })).toEqual([]);
		expect(kinds(p, { relay: known({ status: "accepted" }) })).toEqual([]);
		expect(kinds(p, { relay: known({ expired: true }) })).toEqual([]);
	});

	it("does not re-send, behind the signer's back, a signature they took back", async () => {
		const p = await signAs(makeProposal(), 1);
		expect(kinds(p, { removed: new Set([A]), explicit: false })).toEqual([]);
		// signing again on purpose is a new signature
		expect(kinds(p, { removed: new Set([A]), explicit: true })).toEqual([
			"sign",
		]);
		// a signature that simply never arrived is caught up in the background
		expect(kinds(p, { explicit: false })).toEqual(["sign"]);
	});

	it("records the result for the finaliser only", async () => {
		const p = { ...(await signAs(makeProposal(), 1)), receipt: receipt() };
		expect(kinds(p, { me: B, relay: known({ signers: [A] }) })).toEqual([
			"receipt",
		]);
		expect(kinds(p, { me: A, relay: known({ signers: [A] }) })).toEqual([]);
		expect(plan(p, { me: B })[0]).toEqual({
			kind: "receipt",
			receipt: p.receipt,
		});
	});

	it("does not record an attempt the relay already has, or anything after acceptance", async () => {
		const p = { ...makeProposal(), receipt: receipt(NOW + 7) };
		expect(
			kinds(p, { me: B, relay: known({ receiptTimes: [NOW + 7] }) }),
		).toEqual([]);
		expect(
			kinds(p, { me: B, relay: known({ receiptTimes: [NOW + 6] }) }),
		).toEqual(["receipt"]);
		expect(kinds(p, { me: B, relay: known({ status: "accepted" }) })).toEqual(
			[],
		);
	});

	it("records a result even on a withdrawn or expired proposal: what happened on chain is kept", () => {
		const p = { ...makeProposal(), receipt: receipt() };
		expect(kinds(p, { me: B, relay: known({ status: "withdrawn" }) })).toEqual([
			"receipt",
		]);
		expect(kinds(p, { me: B, relay: known({ expired: true }) })).toEqual([
			"receipt",
		]);
	});

	it("shares, signs and records in that order when the finaliser submitted a proposal opened from a file", async () => {
		const p = {
			...(await signAs(await signAs(makeProposal(), 1), 2)),
			receipt: receipt(),
		};
		expect(kinds(p, { me: B, relay: null, publish: true })).toEqual([
			"publish",
			"sign",
			"receipt",
		]);
	});
});

describe("settledAlready", () => {
	const closed = { code: "relay.proposal_closed" };
	it("a result the relay refuses because it already holds the proposal as accepted is done", () => {
		expect(
			settledAlready({ kind: "receipt", receipt: receipt() }, closed),
		).toBe(true);
	});
	it("any other refusal of a result is a problem, and so is a closed proposal for a signature", () => {
		const op = { kind: "receipt", receipt: receipt() } as const;
		for (const code of [
			"relay.not_finaliser",
			"relay.rate_limited",
			"relay.unreachable",
			"relay.not_allowed",
		])
			expect(settledAlready(op, { code })).toBe(false);
		// a signature that arrives after the proposal closed was not counted
		expect(settledAlready({ kind: "sign", signature: SIG }, closed)).toBe(
			false,
		);
	});
});

describe("publishRow", () => {
	it("is the bare document filed under its own treasury, finaliser and nonce", async () => {
		const p = { ...(await signAs(makeProposal(), 1)), receipt: receipt() };
		const row = publishRow(p);
		expect(row).toEqual({
			network: "testnet",
			treasury: p.payload.multiSigUser,
			digest: p.digest,
			document: bareDocument(p),
			finaliser: B,
			nonce: p.payload.nonce,
		});
		expect(JSON.parse(row.document).signatures).toEqual([]);
		expect(JSON.parse(row.document).receipt).toBeNull();
	});
});

describe("publishBlocker", () => {
	it("lets a user-signed proposal through", () => {
		expect(publishBlocker(makeProposal())).toBeNull();
	});

	const VAULT = "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0";
	const deposit = {
		type: "vaultTransfer",
		vaultAddress: VAULT,
		isDeposit: true,
		usd: 5_000_000,
	};
	const vaultProposal = (
		action: Record<string, unknown> = deposit,
		kind: "l1" | "user-signed" = "l1",
	) => {
		const p = makeProposal();
		return {
			...p,
			meta: { ...p.meta, kind },
			payload: { ...p.payload, action: action as never },
		};
	};

	it("lets a vault deposit or withdrawal through, in the exact shape the relay stores", () => {
		expect(publishBlocker(vaultProposal())).toBeNull();
		expect(
			publishBlocker(vaultProposal({ ...deposit, isDeposit: false, usd: 1 })),
		).toBeNull();
		expect(isRelayVaultAction(deposit)).toBe(true);
		expect(kinds(vaultProposal(), { relay: null, publish: true })).toContain(
			"publish",
		);
	});

	// the cases of supabase/tests/180_vault_proposals.sql, one for one
	it.each([
		["claims to be user-signed", vaultProposal(deposit, "user-signed")],
		["has a field more", vaultProposal({ ...deposit, note: "x" })],
		[
			"has no direction",
			vaultProposal({ type: "vaultTransfer", vaultAddress: VAULT, usd: 5 }),
		],
		[
			"has no amount",
			vaultProposal({
				type: "vaultTransfer",
				vaultAddress: VAULT,
				isDeposit: true,
			}),
		],
		[
			"carries its amount as text",
			vaultProposal({ ...deposit, usd: "5000000" }),
		],
		["carries nothing", vaultProposal({ ...deposit, usd: 0 })],
		["carries a negative amount", vaultProposal({ ...deposit, usd: -5 })],
		["carries a fraction", vaultProposal({ ...deposit, usd: 5.5 })],
		[
			"carries more than a number holds exactly",
			vaultProposal({ ...deposit, usd: 10 ** 17 }),
		],
		[
			"has its direction as text",
			vaultProposal({ ...deposit, isDeposit: "true" }),
		],
		[
			"names its vault with a capital",
			vaultProposal({ ...deposit, vaultAddress: VAULT.replace("a1", "A1") }),
		],
		["names no address", vaultProposal({ ...deposit, vaultAddress: "0x1234" })],
		["names no vault", vaultProposal({ ...deposit, vaultAddress: null })],
	])("stops a vault action that %s", (_name, blocked) => {
		expect(publishBlocker(blocked)).toBe(
			"This vault action is not in the form the hl-tools server takes, so it cannot be shared through it. It still works as a link or a file.",
		);
		expect(kinds(blocked, { relay: null, publish: true })).toEqual([]);
	});

	it("stops every other action signed as a code, and a user-signed one that claims to be", () => {
		const text =
			"Of the actions signed as a code, only a vault deposit or withdrawal can be shared through the hl-tools server.";
		expect(publishBlocker(vaultProposal({ type: "noop" }))).toBe(text);
		expect(
			publishBlocker(
				vaultProposal({ type: "order", orders: [], grouping: "na" }),
			),
		).toBe(text);
		const p = makeProposal();
		expect(publishBlocker({ ...p, meta: { ...p.meta, kind: "l1" } })).toBe(
			text,
		);
	});

	it("stops a vault action sent for a vault or with an expiry, whatever else holds", () => {
		const p = vaultProposal();
		for (const beside of [{ vaultAddress: C }, { expiresAfter: NOW }])
			expect(
				publishBlocker({ ...p, payload: { ...p.payload, ...beside } }),
			).toMatch(/a vault address or an expiry/);
	});

	it("stops an L1 action, a vault address and an expiry, and plans nothing for them", () => {
		const p = makeProposal();
		const l1 = { ...p, meta: { ...p.meta, kind: "l1" as const } };
		const vault = { ...p, payload: { ...p.payload, vaultAddress: C } };
		const expiring = { ...p, payload: { ...p.payload, expiresAfter: NOW } };
		for (const blocked of [l1, vault, expiring]) {
			expect(publishBlocker(blocked)).toMatch(
				/shared through the hl-tools server/,
			);
			expect(kinds(blocked, { relay: null, publish: true })).toEqual([]);
		}
	});
});
