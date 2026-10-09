/**
 * The relay end to end, against the local Supabase stack: the app's own
 * session and api modules, real wallet sign-ins (random keys), the lookup
 * worker fed by a stand-in for Hyperliquid, real proposals with real
 * signatures, and the realtime channel. `bun run test:relay`.
 *
 * The treasuries here live under the relay's "mainnet" label only because
 * that label's lookup address is the one pointed at the stand-in for the
 * length of the run; nothing here ever talks to Hyperliquid.
 */
import {
	type Address,
	createProposal,
	type Proposal,
	type Receipt,
	signProposal,
	viemSigner,
} from "@hl-tools/core";
import { generateSiweNonce } from "viem/siwe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	database,
	type InfoStub,
	infoStub,
	newAccount,
	newClient,
	newWallet,
	ORIGIN,
	type Sql,
	type TestWallet,
	until,
	untilWorker,
} from "#/test/relayStack";
import { assembleProposal, removedSigners } from "../model/relay/assemble";
import { planPush, publishRow } from "../model/relay/push";
import { buildSignInMessage } from "../model/relay/siwe";
import {
	addSignature,
	endProposal,
	getProposal,
	getRequest,
	listEvents,
	listOpenProposals,
	listProposalEvents,
	listTreasuries,
	type ProposalKey,
	publishProposal,
	recordReceipt,
	removeSignature,
	requestTreasury,
} from "./api";
import { type ChannelState, subscribeWallet } from "./realtime";
import { sessionWallet, signIn, signOut } from "./session";

const NET = "mainnet" as const;
const REAL_INFO = "https://api.hyperliquid.xyz/info";

let sql: Sql;
let stub: InfoStub;
let a: TestWallet;
let b: TestWallet;
let c: TestWallet;
let outsider: TestWallet;
/** A 2-of-3 of a, b, c that exists only in the stand-in. */
let treasury: Address;

const codes = (i: { code: string } | null) => i?.code ?? null;

async function add(
	w: TestWallet,
	address: Address,
	kind: "add" | "check" = "add",
) {
	const asked = await requestTreasury(w.client, w.address, NET, address, kind);
	if (!asked.data) throw new Error(`request refused: ${asked.issue?.code}`);
	const id = asked.data.id;
	let status = asked.data.status;
	let reason = asked.data.reason;
	if (status === "pending") {
		await untilWorker(sql, async () => {
			const r = await getRequest(w.client, id);
			status = r.data?.status ?? status;
			reason = r.data?.reason ?? null;
			return status !== "pending";
		});
	}
	return { status, reason };
}

/** A real proposal for `treasury`, proposed by a, finalised by b, signed by whoever is listed. */
async function proposal(
	title: string,
	signers: TestWallet[] = [],
	action: Record<string, unknown> = {},
): Promise<Proposal> {
	const now = Date.now();
	const made = createProposal(
		{
			network: NET,
			multiSigUser: treasury,
			outerSigner: b.address,
			action: {
				type: "usdSend",
				signatureChainId: "0x3e7",
				hyperliquidChain: "Mainnet",
				destination: outsider.address,
				amount: "1",
				time: now,
				...action,
			},
			nonce: now,
			title,
			createdBy: a.address,
		},
		{ now },
	);
	if (!made.proposal) throw new Error(JSON.stringify(made.issues));
	let p = made.proposal;
	for (const w of signers) {
		const s = await signProposal(p, viemSigner(w.account), { at: now });
		if (!s.signature) throw new Error(JSON.stringify(s.issues));
		p = { ...p, signatures: [...p.signatures, s.signature] };
	}
	return p;
}

const keyOf = (p: Proposal): ProposalKey => ({
	network: NET,
	treasury,
	digest: p.digest,
});
const sigOf = (p: Proposal, w: TestWallet) => {
	const s = p.signatures.find((x) => x.signer === w.address);
	if (!s) throw new Error("not signed by that wallet");
	return { r: s.r, s: s.s, v: s.v };
};
const receipt = (ok: boolean, submittedAt = Date.now()): Receipt =>
	({
		submittedAt,
		signatureChainId: "0x3e7",
		outerSignature: {
			r: `0x${"11".repeat(32)}`,
			s: `0x${"22".repeat(32)}`,
			v: 27,
		},
		httpStatus: 200,
		response: ok
			? { status: "ok", response: { type: "default" } }
			: { status: "err", response: "Invalid multi-sig inner signer" },
	}) as Receipt;

async function read(w: TestWallet, p: Proposal) {
	const got = await getProposal(w.client, p.digest);
	const row = got.data?.rows[0] ?? null;
	const assembled = row ? await assembleProposal(row) : null;
	return {
		row,
		proposal: assembled?.assembled?.proposal ?? null,
		issues: assembled?.issues ?? [],
		signers:
			assembled?.assembled?.proposal.signatures.map((s) => s.signer) ?? [],
	};
}

beforeAll(async () => {
	sql = database();
	stub = await infoStub();
	await sql`update private.settings set value = ${stub.url} where key = 'info_url.mainnet'`;
	[a, b, c, outsider] = await Promise.all([
		newWallet(),
		newWallet(),
		newWallet(),
		newWallet(),
	]);
	treasury = newAccount().address;
	stub.answer(treasury, {
		signers: [a.address, b.address, c.address],
		threshold: 2,
	});
});

afterAll(async () => {
	await sql`update private.settings set value = ${REAL_INFO} where key = 'info_url.mainnet'`;
	await sql.end();
	await stub.close();
});

describe("signing in", () => {
	it("opens a session that speaks for the wallet that signed", async () => {
		expect(await sessionWallet(a.client)).toBe(a.address);
		expect(await sessionWallet(newClient())).toBeNull();
	});

	it("re-checks a wallet's stale treasuries when its session is renewed (the token hook)", async () => {
		const w = await newWallet();
		const own = newAccount().address;
		stub.answer(own, { signers: [w.address], threshold: 1 });
		expect(await add(w, own)).toEqual({ status: "done", reason: null });
		// a copy checked within the last ten minutes is left alone; make this one older
		await sql`update public.treasuries set checked_at = now() - interval '11 minutes' where address = ${own}`;
		const asked = () => stub.calls.filter((x) => x === own).length;
		const before = asked();
		const renewed = await w.client.auth.refreshSession();
		expect(renewed.error).toBeNull();
		await untilWorker(sql, async () => asked() > before);
		const fresh = await until(
			async () =>
				((await listTreasuries(w.client)).data?.rows[0]?.checkedAt ?? 0) >
				Date.now() - 60_000,
			10_000,
		);
		expect(fresh).toBeLessThan(10_000);
	});

	it("refuses to start from an address the relay cannot sign in from, without asking the wallet", async () => {
		const { account } = newAccount();
		let asked = false;
		const r = await signIn(
			newClient(),
			{
				address: account.address,
				chainId: 999,
				signMessage: async (m) => {
					asked = true;
					return account.signMessage({ message: m });
				},
			},
			{ origin: "http://127.0.0.1:3000", nonce: generateSiweNonce() },
		);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.issue.code).toBe("relay.signin_origin");
		expect(asked).toBe(false);
	});

	it("reports a declined wallet prompt as cancelled", async () => {
		const { account } = newAccount();
		const r = await signIn(
			newClient(),
			{
				address: account.address,
				chainId: 999,
				signMessage: async () => {
					throw Object.assign(new Error("User rejected the request."), {
						code: 4001,
					});
				},
			},
			{ origin: ORIGIN, nonce: generateSiweNonce() },
		);
		expect(r).toMatchObject({ ok: false, cancelled: true });
	});

	it("is refused for a message that has expired, was signed for another site, or by another key", async () => {
		const { account } = newAccount();
		const other = newAccount().account;
		const wallet = {
			address: account.address,
			chainId: 999,
			signMessage: (m: string) => account.signMessage({ message: m }),
		};
		const old = await signIn(newClient(), wallet, {
			origin: ORIGIN,
			nonce: generateSiweNonce(),
			now: Date.now() - 11 * 60_000,
		});
		expect(!old.ok && old.issue.code).toBe("relay.signin_rejected");
		const elsewhere = await signIn(newClient(), wallet, {
			origin: "https://evil.example",
			nonce: generateSiweNonce(),
		});
		expect(!elsewhere.ok && elsewhere.issue.code).toBe("relay.signin_rejected");
		const forged = await signIn(
			newClient(),
			{ ...wallet, signMessage: (m) => other.signMessage({ message: m }) },
			{ origin: ORIGIN, nonce: generateSiweNonce() },
		);
		expect(!forged.ok && forged.issue.code).toBe("relay.signin_rejected");
	});

	it("accepts a message for ten minutes from its Issued At, whatever expiry it states (no nonce store, no expiry check)", async () => {
		// Written down so a change in Supabase's behaviour is noticed: see model/relay/siwe.ts.
		const { account } = newAccount();
		const sign = async (issuedMinutesAgo: number) => {
			const message = buildSignInMessage({
				address: account.address,
				chainId: 999,
				origin: ORIGIN,
				nonce: generateSiweNonce(),
				now: Date.now() - issuedMinutesAgo * 60_000,
			});
			const signature = await account.signMessage({ message });
			return { message, signature };
		};
		// six minutes old: past the five-minute expiry the message states, and still accepted
		const stale = await sign(6);
		const first = await newClient().auth.signInWithWeb3({
			chain: "ethereum",
			...stale,
		});
		expect(first.error).toBeNull();
		// and the same message and signature sign in a second time
		const again = await newClient().auth.signInWithWeb3({
			chain: "ethereum",
			...stale,
		});
		expect(again.error).toBeNull();
		// eleven minutes old: refused
		const old = await newClient().auth.signInWithWeb3({
			chain: "ethereum",
			...(await sign(11)),
		});
		expect(old.error?.message).toMatch(/issued too long ago/);
	});

	it("signs out in this client only", async () => {
		const w = await newWallet();
		await signOut(w.client);
		expect(await sessionWallet(w.client)).toBeNull();
		expect((await listTreasuries(w.client)).issue).not.toBeNull();
	});
});

describe("adding a treasury", () => {
	it("stores it for a signer, and every co-signer then sees it without adding", async () => {
		expect((await listTreasuries(a.client)).data?.rows).toEqual([]);
		expect(await add(a, treasury)).toEqual({ status: "done", reason: null });
		for (const w of [a, b, c]) {
			const mine = (await listTreasuries(w.client)).data?.rows ?? [];
			expect(mine).toHaveLength(1);
			expect(mine[0]).toMatchObject({
				network: NET,
				address: treasury,
				threshold: 2,
				addedBy: a.address,
				frozenAt: null,
			});
			expect(mine[0]?.signers).toEqual(
				[a.address, b.address, c.address].sort(),
			);
		}
		expect(stub.calls).toContain(treasury);
	});

	it("is done at once for a wallet already listed", async () => {
		const calls = stub.calls.length;
		expect(await add(b, treasury)).toEqual({ status: "done", reason: null });
		expect(stub.calls.length).toBe(calls);
	});

	it("is refused for a wallet that is not one of its signers, which then still sees nothing", async () => {
		expect(await add(outsider, treasury)).toEqual({
			status: "rejected",
			reason: "not_a_signer",
		});
		expect((await listTreasuries(outsider.client)).data?.rows).toEqual([]);
	});

	it("is refused for an account that is not a multi-sig", async () => {
		expect(await add(a, newAccount().address)).toEqual({
			status: "rejected",
			reason: "not_multisig",
		});
	});

	it("gives one treasury when two signers add it at the same moment", async () => {
		const second = newAccount().address;
		stub.answer(second, { signers: [a.address, b.address], threshold: 1 });
		const [ra, rb] = await Promise.all([add(a, second), add(b, second)]);
		expect([ra.status, rb.status]).toEqual(["done", "done"]);
		const rows =
			await sql`select count(*)::int as n from public.treasuries where address = ${second}`;
		expect(rows[0]?.n).toBe(1);
		expect(
			(await listTreasuries(a.client)).data?.rows.map((t) => t.address).sort(),
		).toEqual([treasury, second].sort());
	});

	it("leaves a first history entry the signers can read and nobody else", async () => {
		const mine = (await listEvents(c.client, NET, treasury)).data?.rows ?? [];
		expect(mine.map((e) => e.kind)).toEqual(["treasury_added"]);
		expect(mine[0]?.actor).toBe(a.address);
		expect(
			(await listEvents(outsider.client, NET, treasury)).data?.rows,
		).toEqual([]);
	});

	it("will not write under a wallet the session does not speak for", async () => {
		const r = await requestTreasury(a.client, b.address, NET, treasury, "add");
		expect(codes(r.issue)).toBe("relay.wrong_wallet");
	});
});

describe("sharing and signing a proposal", () => {
	let p: Proposal;

	it("shares the proposer's proposal and signature in the order the plan gives", async () => {
		p = await proposal("integration: share and sign", [a]);
		const ops = planPush({
			doc: p,
			me: a.address,
			relay: null,
			storedSigner: true,
			publish: true,
			removed: new Set(),
			explicit: true,
		});
		expect(ops.map((o) => o.kind)).toEqual(["publish", "sign"]);
		expect(
			(await publishProposal(a.client, a.address, publishRow(p))).issue,
		).toBeNull();
		expect(
			(await addSignature(a.client, a.address, keyOf(p), sigOf(p, a))).issue,
		).toBeNull();
	});

	it("lets a co-signer read it and verify the digest and the signature in their own client", async () => {
		const seen = await read(b, p);
		expect(seen.issues).toEqual([]);
		expect(seen.proposal?.digest).toBe(p.digest);
		expect(seen.proposal?.payload).toEqual(p.payload);
		expect(seen.signers).toEqual([a.address]);
		expect(seen.row).toMatchObject({
			status: "open",
			createdBy: a.address,
			finaliser: b.address,
			ending: null,
			receipts: [],
		});
	});

	it("shows it among the open proposals of every signer", async () => {
		for (const w of [a, b, c]) {
			const open = (await listOpenProposals(w.client)).data?.rows ?? [];
			expect(open.map((r) => r.digest)).toContain(p.digest);
		}
	});

	it("treats sharing or signing twice as done, not as an error", async () => {
		expect(await publishProposal(a.client, a.address, publishRow(p))).toEqual({
			data: true,
			issue: null,
		});
		expect(
			await addSignature(a.client, a.address, keyOf(p), sigOf(p, a)),
		).toEqual({ data: true, issue: null });
		expect((await read(b, p)).signers).toEqual([a.address]);
	});

	it("keeps both signatures when two signers sign at once", async () => {
		const withB = await proposalSignedBy(p, b);
		const withC = await proposalSignedBy(p, c);
		const [rb, rc] = await Promise.all([
			addSignature(b.client, b.address, keyOf(p), sigOf(withB, b)),
			addSignature(c.client, c.address, keyOf(p), sigOf(withC, c)),
		]);
		expect([rb.issue, rc.issue]).toEqual([null, null]);
		expect((await read(a, p)).signers.sort()).toEqual(
			[a.address, b.address, c.address].sort(),
		);
	});

	it("ignores, in the reader's client, a stored signature that does not verify", async () => {
		// c replaces its signature with one made over nothing in particular
		await removeSignature(c.client, c.address, keyOf(p));
		await addSignature(c.client, c.address, keyOf(p), {
			r: `0x${"ab".repeat(32)}`,
			s: `0x${"12".repeat(32)}`,
			v: 27,
		});
		const seen = await read(a, p);
		expect(seen.signers.sort()).toEqual([a.address, b.address].sort());
		expect(seen.issues.map((i) => i.code)).toEqual(["relay.signature_dropped"]);
		await removeSignature(c.client, c.address, keyOf(p));
	});

	it("hides it from a wallet that signs for nothing, and refuses that wallet every write", async () => {
		expect((await getProposal(outsider.client, p.digest)).data?.rows).toEqual(
			[],
		);
		expect((await listOpenProposals(outsider.client)).data?.rows).toEqual([]);
		expect(
			(await listProposalEvents(outsider.client, keyOf(p))).data?.rows,
		).toEqual([]);
		const other = await proposal("integration: outsider");
		expect(
			codes(
				(
					await publishProposal(
						outsider.client,
						outsider.address,
						publishRow(other),
					)
				).issue,
			),
		).toBe("relay.not_allowed");
		expect(
			codes(
				(
					await addSignature(outsider.client, outsider.address, keyOf(p), {
						r: `0x${"11".repeat(32)}`,
						s: `0x${"22".repeat(32)}`,
						v: 27,
					})
				).issue,
			),
		).toBe("relay.not_allowed");
		expect(
			codes(
				(
					await endProposal(
						outsider.client,
						outsider.address,
						keyOf(p),
						"declined",
					)
				).issue,
			),
		).toBe("relay.not_allowed");
		expect(
			codes(
				(
					await recordReceipt(
						outsider.client,
						outsider.address,
						keyOf(p),
						receipt(true),
					)
				).issue,
			),
		).toBe("relay.not_allowed");
	});

	it("refuses a document filed under a digest it does not carry", async () => {
		const other = await proposal("integration: mismatch");
		const row = {
			...publishRow(other),
			digest: p.digest.replace(/.$/, (x) =>
				x === "0" ? "1" : "0",
			) as typeof p.digest,
		};
		expect(codes((await publishProposal(a.client, a.address, row)).issue)).toBe(
			"relay.document_mismatch",
		);
	});

	it("lets a signer take their signature back, and records that they did", async () => {
		expect(
			(await removeSignature(b.client, b.address, keyOf(p))).issue,
		).toBeNull();
		expect((await read(a, p)).signers).toEqual([a.address]);
		const events =
			(await listProposalEvents(a.client, keyOf(p))).data?.rows ?? [];
		expect([...removedSigners(events, p.digest)].sort()).toEqual(
			[b.address, c.address].sort(),
		);
		// signing again clears it
		const again = await proposalSignedBy(p, b);
		await addSignature(b.client, b.address, keyOf(p), sigOf(again, b));
		const after =
			(await listProposalEvents(a.client, keyOf(p))).data?.rows ?? [];
		expect([...removedSigners(after, p.digest)]).toEqual([c.address]);
	});
});

async function proposalSignedBy(p: Proposal, w: TestWallet): Promise<Proposal> {
	const s = await signProposal(
		{ ...p, signatures: [] },
		viemSigner(w.account),
		{ at: Date.now() },
	);
	if (!s.signature) throw new Error(JSON.stringify(s.issues));
	return { ...p, signatures: [s.signature] };
}

describe("live updates", () => {
	it("pings every signer's own channel within two seconds of a change, and nobody else's", async () => {
		const pings = { b: 0, c: 0, outsider: 0 };
		const states: Record<string, ChannelState> = {};
		const leave = [
			subscribeWallet(
				b.client,
				b.address,
				() => {
					pings.b += 1;
				},
				(s) => {
					states.b = s;
				},
			),
			subscribeWallet(
				c.client,
				c.address,
				() => {
					pings.c += 1;
				},
				(s) => {
					states.c = s;
				},
			),
			subscribeWallet(
				outsider.client,
				outsider.address,
				() => {
					pings.outsider += 1;
				},
				(s) => {
					states.outsider = s;
				},
			),
		];
		try {
			await until(
				() =>
					states.b === "joined" &&
					states.c === "joined" &&
					states.outsider === "joined",
				10_000,
			);
			// joining counts as one ping each (the page re-reads on join); let them land
			await new Promise((r) => setTimeout(r, 400));
			const before = { ...pings };
			const p = await proposal("integration: ping");
			await publishProposal(a.client, a.address, publishRow(p));
			const ms = await until(
				() => pings.b > before.b && pings.c > before.c,
				2_000,
			);
			expect(ms).toBeLessThan(2_000);
			await new Promise((r) => setTimeout(r, 300));
			expect(pings.outsider).toBe(before.outsider);
		} finally {
			for (const l of leave) l();
		}
	});

	it("refuses a wallet that tries to join another wallet's channel", async () => {
		let state: ChannelState = "joining";
		const leave = subscribeWallet(
			outsider.client,
			a.address,
			() => {},
			(s) => {
				state = s;
			},
		);
		try {
			await until(() => state !== "joining", 10_000);
			expect(state).toBe("refused");
		} finally {
			leave();
		}
	});
});

describe("ending a proposal", () => {
	it("lets the proposer withdraw and nobody else", async () => {
		const p = await proposal("integration: withdraw", [a]);
		await publishProposal(a.client, a.address, publishRow(p));
		await addSignature(a.client, a.address, keyOf(p), sigOf(p, a));
		expect(
			codes(
				(await endProposal(c.client, c.address, keyOf(p), "withdrawn")).issue,
			),
		).toBe("relay.not_proposer");
		expect(
			codes(
				(await endProposal(a.client, a.address, keyOf(p), "declined")).issue,
			),
		).toBe("relay.not_finaliser");
		expect(
			(await endProposal(a.client, a.address, keyOf(p), "withdrawn")).issue,
		).toBeNull();
		const seen = await read(b, p);
		expect(seen.row?.status).toBe("withdrawn");
		expect(seen.row?.ending).toMatchObject({
			kind: "withdrawn",
			endedBy: a.address,
		});
		expect(
			(await listOpenProposals(b.client)).data?.rows.map((r) => r.digest),
		).not.toContain(p.digest);
		// over: no more signatures, no second ending, no taking back
		const withB = await proposalSignedBy(p, b);
		expect(
			codes(
				(await addSignature(b.client, b.address, keyOf(p), sigOf(withB, b)))
					.issue,
			),
		).toBe("relay.proposal_closed");
		expect(
			codes(
				(await endProposal(b.client, b.address, keyOf(p), "declined")).issue,
			),
		).toBe("relay.proposal_closed");
		expect(
			codes((await removeSignature(a.client, a.address, keyOf(p))).issue),
		).toBe("relay.proposal_closed");
	});

	it("lets the finaliser decline", async () => {
		const p = await proposal("integration: decline");
		await publishProposal(a.client, a.address, publishRow(p));
		expect(
			(await endProposal(b.client, b.address, keyOf(p), "declined")).issue,
		).toBeNull();
		expect((await read(c, p)).row?.status).toBe("declined");
	});
});

describe("recording the result", () => {
	it("keeps a rejection retryable and closes on acceptance; only the finaliser may report", async () => {
		const p = await proposal("integration: receipt", [a]);
		await publishProposal(a.client, a.address, publishRow(p));
		expect(
			codes(
				(await recordReceipt(a.client, a.address, keyOf(p), receipt(true)))
					.issue,
			),
		).toBe("relay.not_finaliser");

		const first = receipt(false, Date.now() - 2000);
		expect(
			(await recordReceipt(b.client, b.address, keyOf(p), first)).issue,
		).toBeNull();
		let seen = await read(a, p);
		expect(seen.row?.status).toBe("open");
		expect(seen.proposal?.receipt).toEqual(first);
		// the same attempt reported twice is one attempt
		expect(
			(await recordReceipt(b.client, b.address, keyOf(p), first)).issue,
		).toBeNull();
		expect((await read(a, p)).row?.receipts).toHaveLength(1);

		const second = receipt(true);
		expect(
			(await recordReceipt(b.client, b.address, keyOf(p), second)).issue,
		).toBeNull();
		seen = await read(c, p);
		expect(seen.row?.status).toBe("accepted");
		expect(seen.row?.receipts.map((r) => r.accepted)).toEqual([false, true]);
		expect(seen.proposal?.receipt).toEqual(second);
		expect(
			codes(
				(
					await recordReceipt(
						b.client,
						b.address,
						keyOf(p),
						receipt(true, Date.now() + 5),
					)
				).issue,
			),
		).toBe("relay.proposal_closed");

		const kinds = (
			(await listProposalEvents(a.client, keyOf(p))).data?.rows ?? []
		).map((e) => e.kind);
		expect(kinds).toEqual([
			"proposal_created",
			"submission_recorded",
			"submission_recorded",
		]);
	});

	it("re-checks the signers ahead of everything when an accepted action changed them", async () => {
		const p = await proposal("integration: signer change", [], {
			type: "convertToMultiSigUser",
			signers: JSON.stringify({
				authorizedUsers: [a.address, b.address],
				threshold: 2,
			}),
			nonce: Date.now(),
			time: undefined,
			destination: undefined,
			amount: undefined,
		});
		await publishProposal(a.client, a.address, publishRow(p));
		// the chain (the stand-in) now reports the new set
		stub.answer(treasury, { signers: [a.address, b.address], threshold: 2 });
		const calls = stub.calls.length;
		expect(
			(await recordReceipt(b.client, b.address, keyOf(p), receipt(true))).issue,
		).toBeNull();
		await untilWorker(sql, async () => stub.calls.length > calls);
		await until(
			async () =>
				((await listTreasuries(a.client)).data?.rows.find(
					(t) => t.address === treasury,
				)?.signers.length ?? 0) === 2,
			10_000,
		);
		const kinds = (
			(await listEvents(a.client, NET, treasury)).data?.rows ?? []
		).map((e) => e.kind);
		expect(kinds[0]).toBe("signers_changed");
	});
});

describe("a signer removed on chain", () => {
	it("loses the treasury and everything in it once the copy is refreshed", async () => {
		// c was removed by the change above
		expect(
			(await listTreasuries(c.client)).data?.rows.map((t) => t.address),
		).not.toContain(treasury);
		expect((await listOpenProposals(c.client)).data?.rows).toEqual([]);
		expect((await listEvents(c.client, NET, treasury)).data?.rows).toEqual([]);
		const p = await proposal("integration: after removal");
		expect(
			codes((await publishProposal(c.client, c.address, publishRow(p))).issue),
		).toBe("relay.not_allowed");
		expect(
			codes(
				(await requestTreasury(c.client, c.address, NET, treasury, "check"))
					.issue,
			),
		).toBe("relay.not_allowed");
	});

	it("is found by a signer's re-check request when the chain changed outside the relay", async () => {
		stub.answer(treasury, {
			signers: [a.address, b.address, c.address],
			threshold: 3,
		});
		// the copy was checked a moment ago; a request is only taken when it is older than 30 s
		await sql`update public.treasuries set checked_at = now() - interval '1 minute' where address = ${treasury}`;
		expect(await add(a, treasury, "check")).toEqual({
			status: "done",
			reason: null,
		});
		const t = (await listTreasuries(c.client)).data?.rows.find(
			(x) => x.address === treasury,
		);
		expect(t?.threshold).toBe(3);
		expect(t?.signers).toHaveLength(3);
	});
});

describe("when the relay cannot be reached", () => {
	it("answers every call with an 'unreachable' issue instead of throwing", async () => {
		const { createClient } = await import("@supabase/supabase-js");
		const dead = createClient("http://127.0.0.1:9", "sb_publishable_none", {
			auth: { persistSession: false, autoRefreshToken: false },
		});
		const r = await listTreasuries(dead);
		expect(r.data).toBeNull();
		expect(codes(r.issue)).toBe("relay.unreachable");
		expect(codes((await getProposal(dead, `0x${"00".repeat(32)}`)).issue)).toBe(
			"relay.unreachable",
		);
		expect(await sessionWallet(dead)).toBeNull();
	});
});
