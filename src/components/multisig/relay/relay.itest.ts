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
	judgeMove,
	overtakenBy,
	type Proposal,
	type Receipt,
	signProposal,
	tieSteps,
	viemSigner,
} from "@hl-tools/core";
import { createClient } from "@supabase/supabase-js";
import { generateSiweNonce } from "viem/siwe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	database,
	type InfoStub,
	infoStub,
	newAccount,
	newBrowser,
	newClient,
	newWallet,
	ORIGIN,
	type Sql,
	signInWith,
	stack,
	type TestWallet,
	until,
	untilWorker,
} from "#/test/relayStack";
import { partsText } from "../model/parts";
import { assembleProposal, removedSigners } from "../model/relay/assemble";
import {
	awayItems,
	awayProposal,
	firstMark,
	isEnding,
	type MarkChain,
	markAfter,
} from "../model/relay/away";
import { relayIssue } from "../model/relay/errors";
import { acceptNicknames } from "../model/relay/nicknames";
import { standing } from "../model/relay/positions";
import { planPush, publishBlocker, publishRow } from "../model/relay/push";
import { latestMarks, type ProposalRow } from "../model/relay/rows";
import { buildSignInMessage } from "../model/relay/siwe";
import { buildTimeline } from "../model/relay/timeline";
import {
	adoptLegacy,
	RELAY_LEGACY_KEY,
	slotKey,
	storedWallets,
} from "../model/relay/wallets";
import {
	addObjection,
	addObjections,
	addSignature,
	getProposal,
	getRequest,
	lastSignatureOf,
	listCarriedOutAfter,
	listEvents,
	listEventsAfter,
	listLapsed,
	listMarks,
	listNicknames,
	listOpenProposals,
	listProposalEvents,
	listProposalsIn,
	listReports,
	listSignatureEvents,
	listTreasuries,
	listViews,
	markRead,
	type ProposalKey,
	publishMove,
	publishProposal,
	recordReceipt,
	recordView,
	removeObjection,
	removeObjections,
	removeSignature,
	removeSignatures,
	reportExecution,
	requestTreasury,
	setNickname,
	shareMove,
	withdrawMove,
	withdrawProposal,
} from "./api";
import { endStoredSession } from "./client";
import { type ChannelState, subscribeWallet } from "./realtime";
import {
	endSession,
	probeFor,
	probeSession,
	sessionWallet,
	signIn,
	signOut,
} from "./session";

const NET = "mainnet" as const;
const REAL_INFO = "https://api.hyperliquid.xyz/info";
const REAL_EXPLORER = "https://rpc.hyperliquid.xyz/explorer";

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

/** A decline as an older page would still send it: the relay no longer takes one. */
const decline = (w: TestWallet, p: Proposal) =>
	w.client.from("endings").insert({ ...keyOf(p), kind: "declined" });

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
	await sql`update private.settings set value = ${stub.url} where key = 'explorer_url.mainnet'`;
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
	await sql`update private.settings set value = ${REAL_EXPLORER} where key = 'explorer_url.mainnet'`;
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

	it("keeps the session there was until another wallet has signed in, then ends it (audit F-002)", async () => {
		const first = await newWallet();
		const held = (await first.client.auth.getSession()).data.session;
		const other = newAccount();
		const deps = () => ({ origin: ORIGIN, nonce: generateSiweNonce() });
		const declined = await signIn(
			first.client,
			{
				address: other.account.address,
				chainId: 999,
				signMessage: async () => {
					throw Object.assign(new Error("User rejected the request."), {
						code: 4001,
					});
				},
			},
			deps(),
		);
		expect(declined).toMatchObject({ ok: false, cancelled: true });
		expect(await sessionWallet(first.client)).toBe(first.address);

		const swapped = await signIn(
			first.client,
			{
				address: other.account.address,
				chainId: 999,
				signMessage: (message) => other.account.signMessage({ message }),
			},
			deps(),
		);
		expect(swapped).toEqual({ ok: true, wallet: other.address });
		expect(await sessionWallet(first.client)).toBe(other.address);
		// the replaced session cannot be renewed from anywhere
		const renewed = await newClient().auth.refreshSession({
			refresh_token: held?.refresh_token as string,
		});
		expect(renewed.error).not.toBeNull();
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

	it("tells a stored session's worth apart: ready, none, or the relay not answering", async () => {
		expect(await probeSession(a.client)).toEqual({
			status: "ready",
			wallet: a.address,
		});
		expect(await probeSession(newClient())).toEqual({ status: "none" });
	});

	it("signs out in this client only", async () => {
		const w = await newWallet();
		await signOut(w.client);
		expect(await sessionWallet(w.client)).toBeNull();
		expect((await listTreasuries(w.client)).issue).not.toBeNull();
	});
});

describe("several wallets signed in in one browser", () => {
	// One browser, one storage, a slot and a client per wallet: what the page
	// has when the wallet extension is switched between accounts.
	const config = () => ({ url: stack().url, key: stack().key });
	const end = (raw: string) => endStoredSession(config(), raw);

	it("keeps each wallet's session in its own slot, and each client speaks only for its wallet", async () => {
		const here = newBrowser();
		const one = newAccount();
		const two = newAccount();
		expect(
			(await signInWith(here.clientFor(one.address), one.account)).ok,
		).toBe(true);
		expect(
			(await signInWith(here.clientFor(two.address), two.account)).ok,
		).toBe(true);
		expect(storedWallets(here.slots).sort()).toEqual(
			[one.address, two.address].sort(),
		);
		// signing in as the second did not touch the first: both answer, each as itself
		expect(
			await probeFor(here.clientFor(one.address), one.address, here.slots),
		).toBe("ready");
		expect(
			await probeFor(here.clientFor(two.address), two.address, here.slots),
		).toBe("ready");
		expect(await sessionWallet(here.clientFor(one.address))).toBe(one.address);
		expect(await sessionWallet(here.clientFor(two.address))).toBe(two.address);
	});

	it("never files a write under the other wallet, whichever signed in last", async () => {
		const here = newBrowser();
		const one = newAccount();
		const two = newAccount();
		await signInWith(here.clientFor(one.address), one.account);
		await signInWith(here.clientFor(two.address), two.account);
		const account = newAccount().address;
		stub.answer(account, { signers: [one.address, two.address], threshold: 2 });
		// through the second wallet's client, in the first wallet's name: stopped in the page
		const crossed = await requestTreasury(
			here.clientFor(two.address),
			one.address,
			NET,
			account,
			"add",
		);
		expect(codes(crossed.issue)).toBe("relay.wrong_wallet");
		// and with the page's check skipped, the relay does not take the name from the row:
		// the attempt is refused, or filed under the wallet whose session sent it
		await here.clientFor(two.address).from("treasury_requests").insert({
			network: NET,
			address: account,
			kind: "add",
			requested_by: one.address,
		});
		const forged = await sql`
			select requested_by from public.treasury_requests where address = ${account}`;
		expect(forged.map((r) => r.requested_by)).not.toContain(one.address);
		// each through its own client: taken, and filed under its own name
		const mine = await requestTreasury(
			here.clientFor(one.address),
			one.address,
			NET,
			account,
			"add",
		);
		expect(mine.issue).toBeNull();
		const filed = await sql`
			select requested_by from public.treasury_requests where address = ${account}`;
		expect(filed.filter((r) => r.requested_by === one.address)).toHaveLength(1);
	});

	it("joins each wallet's channel with that wallet's own session", async () => {
		// The channel is private to its wallet. With both signed in in one
		// browser, the first wallet's client is let into the first wallet's
		// channel, and the second wallet's client is refused there: the join
		// carries the session of the client it was made through, not of
		// whoever signed in last.
		const here = newBrowser();
		const one = newAccount();
		const two = newAccount();
		await signInWith(here.clientFor(one.address), one.account);
		await signInWith(here.clientFor(two.address), two.account);
		const join = (client: ReturnType<typeof here.clientFor>) => {
			let state: ChannelState | null = null;
			const leave = subscribeWallet(
				client,
				one.address,
				() => {},
				(s) => {
					state = s;
				},
			);
			return { leave, state: () => state };
		};
		const own = join(here.clientFor(one.address));
		const other = join(here.clientFor(two.address));
		await until(() => own.state() === "joined", 8000);
		await until(() => other.state() === "refused", 8000);
		own.leave();
		other.leave();
	});

	it("signs one wallet out and leaves the other signed in", async () => {
		const here = newBrowser();
		const one = newAccount();
		const two = newAccount();
		await signInWith(here.clientFor(one.address), one.account);
		await signInWith(here.clientFor(two.address), two.account);
		const held = JSON.parse(here.map.get(slotKey(one.address)) ?? "{}") as {
			refresh_token: string;
		};

		const ended = endSession(one.address, here.slots, end);
		// gone from the browser before the relay has answered
		expect(storedWallets(here.slots)).toEqual([two.address]);
		expect(await ended).toBe("ended");
		// its renewal token no longer works anywhere
		const renewed = await newClient().auth.refreshSession({
			refresh_token: held.refresh_token,
		});
		expect(renewed.error).not.toBeNull();
		// the wallet's own client now has nothing to speak with
		expect(
			await probeFor(here.clientFor(one.address), one.address, here.slots),
		).toBe("none");
		expect(
			(await listTreasuries(here.clientFor(one.address))).issue,
		).not.toBeNull();
		// the other wallet never noticed
		expect(
			await probeFor(here.clientFor(two.address), two.address, here.slots),
		).toBe("ready");
		expect(
			(await listTreasuries(here.clientFor(two.address))).issue,
		).toBeNull();
		const still = await here.clientFor(two.address).auth.refreshSession();
		expect(still.error).toBeNull();
		expect(await sessionWallet(here.clientFor(two.address))).toBe(two.address);
	});

	it("ends a session whose access token has run out, without putting it back into its slot", async () => {
		const here = newBrowser();
		const one = newAccount();
		await signInWith(here.clientFor(one.address), one.account);
		const raw = here.map.get(slotKey(one.address)) as string;
		const session = JSON.parse(raw) as {
			access_token: string;
			refresh_token: string;
			expires_at: number;
		};
		// The same session as the browser would hold it an hour later: an access
		// token past its time (only its expiry is read here), the renewal token intact.
		const [h, body, sig] = session.access_token.split(".") as [
			string,
			string,
			string,
		];
		const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as {
			exp: number;
		};
		claims.exp = Math.floor(Date.now() / 1000) - 60;
		const lapsed = JSON.stringify({
			...session,
			access_token: `${h}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${sig}`,
			expires_at: claims.exp,
		});
		here.map.set(slotKey(one.address), lapsed);

		expect(await endSession(one.address, here.slots, end)).toBe("ended");
		// renewing on the way to ending it wrote nothing back
		expect([...here.map.keys()]).toEqual([]);
		const renewed = await newClient().auth.refreshSession({
			refresh_token: session.refresh_token,
		});
		expect(renewed.error).not.toBeNull();
	});

	it("says so when the relay cannot be reached, and the browser still holds nothing", async () => {
		const here = newBrowser();
		const one = newAccount();
		await signInWith(here.clientFor(one.address), one.account);
		const nowhere = (raw: string) =>
			endStoredSession({ url: "http://127.0.0.1:9", key: stack().key }, raw);
		expect(await endSession(one.address, here.slots, nowhere)).toBe(
			"unreachable",
		);
		expect(storedWallets(here.slots)).toEqual([]);
		expect(await endStoredSession(config(), "not json")).toBe("gone");
		expect(await endStoredSession(config(), "{}")).toBe("gone");
	});

	it("never uses a session that sits in another wallet's slot", async () => {
		const here = newBrowser();
		const one = newAccount();
		const other = newAccount();
		await signInWith(here.clientFor(one.address), one.account);
		const copied = here.map.get(slotKey(one.address)) as string;
		// the first wallet's session, copied into a slot named after another wallet
		here.map.set(slotKey(other.address), copied);
		expect(
			await probeFor(here.clientFor(other.address), other.address, here.slots),
		).toBe("none");
		expect(here.map.has(slotKey(other.address))).toBe(false);
		// nothing was read as the other wallet
		expect(await sessionWallet(here.clientFor(other.address))).toBeNull();
		// and the copied session was ended on the relay: it cannot be renewed
		const renewed = await newClient().auth.refreshSession({
			refresh_token: (JSON.parse(copied) as { refresh_token: string })
				.refresh_token,
		});
		expect(renewed.error).not.toBeNull();
	});

	it("an ended session's access token stops working at once, not when it runs out", async () => {
		// Before relay_live_sessions the relay read the wallet from the token and
		// never asked whether the session behind it still existed: a copy of the
		// access token taken before "Sign out" worked for the rest of its hour.
		const here = newBrowser();
		const one = newAccount();
		const two = newAccount();
		await signInWith(here.clientFor(one.address), one.account);
		await signInWith(here.clientFor(two.address), two.account);
		const { access_token } = JSON.parse(
			here.map.get(slotKey(one.address)) as string,
		) as { access_token: string };
		/** Whoever holds a copy of the first wallet's access token, and nothing else. */
		const copy = createClient(stack().url, stack().key, {
			auth: { persistSession: false, autoRefreshToken: false },
			global: { headers: { Authorization: `Bearer ${access_token}` } },
		});
		// while the session lives, the copy works
		expect((await copy.rpc("whoami")).data).toBe(one.address);

		expect(await endSession(one.address, here.slots, end)).toBe("ended");

		// refused, and told why, on a function, on a read and on a write
		const who = await copy.rpc("whoami");
		expect(who.data).toBeNull();
		expect(who.status).toBe(401);
		expect(who.error?.message).toBe("relay.session_ended");
		const read = await copy.from("treasuries").select("address");
		expect(read.status).toBe(401);
		expect(read.error?.message).toBe("relay.session_ended");
		const write = await copy
			.from("treasury_requests")
			.insert({ network: NET, address: newAccount().address, kind: "add" });
		expect(write.status).toBe(401);
		expect(codes(relayIssue(write.error))).toBe("relay.session_ended");
		// its channel can no longer be joined either
		let state: ChannelState | null = null;
		const leave = subscribeWallet(
			copy,
			one.address,
			() => {},
			(s) => {
				state = s;
			},
		);
		await until(() => state === "refused" || state === "down", 8000);
		expect(state).not.toBe("joined");
		leave();

		// the other wallet in the same browser is as it was
		expect(
			(await listTreasuries(here.clientFor(two.address))).issue,
		).toBeNull();
		expect(await sessionWallet(here.clientFor(two.address))).toBe(two.address);
	});

	it("stated limit: a channel joined before the session ended still gets the empty signal", async () => {
		// Realtime decides who may hear a channel when it is joined, and does
		// not ask again while the socket stays open. So a socket that was joined
		// before the session ended goes on receiving the "something changed"
		// signal until its token runs out. The signal carries nothing ({}), and
		// nothing can be read with the session any more (the cases above); a
		// new join is refused. The page's own socket is closed when it signs out.
		const here = newBrowser();
		const one = newAccount();
		const client = here.clientFor(one.address);
		await signInWith(client, one.account);
		let pings = 0;
		let state: ChannelState | null = null;
		const leave = subscribeWallet(
			client,
			one.address,
			() => {
				pings++;
			},
			(s) => {
				state = s;
			},
		);
		await until(() => state === "joined" && pings >= 1, 8000);
		const token = (await client.auth.getSession()).data.session
			?.access_token as string;
		const { session_id } = JSON.parse(
			Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
		) as { session_id: string };
		await sql`delete from auth.sessions where id = ${session_id}`;
		const before = pings;
		await sql`select private.ping_wallets(array[${one.address}]::public.address[])`;
		await until(() => pings > before, 5000);
		// what the signal is worth to whoever holds that socket: no read goes through
		expect(codes((await listTreasuries(client)).issue)).toBe(
			"relay.session_ended",
		);
		leave();
	});

	it("tells a page whose session was ended behind its back, instead of showing it nothing", async () => {
		// The page still holds the session (its slot is full), but the relay has
		// ended it: another device signed everything out, or an operator did.
		const here = newBrowser();
		const one = newAccount();
		await signInWith(here.clientFor(one.address), one.account);
		const { session } = (await here.clientFor(one.address).auth.getSession())
			.data;
		await sql`delete from auth.sessions where id = ${
			JSON.parse(
				Buffer.from(
					(session?.access_token ?? "").split(".")[1] ?? "",
					"base64url",
				).toString(),
			).session_id as string
		}`;
		const listed = await listTreasuries(here.clientFor(one.address));
		expect(listed.data).toBeNull();
		expect(codes(listed.issue)).toBe("relay.session_ended");
		// and the next check of the slot empties it: the wallet is asked to sign in again
		expect(
			await probeFor(here.clientFor(one.address), one.address, here.slots),
		).toBe("none");
		expect(storedWallets(here.slots)).toEqual([]);
	});

	it("leaves a request with no session alone: the publishable key by itself is refused nothing new", async () => {
		// the gate is for signed-in requests; an anonymous one sees what it saw before (nothing)
		const anon = createClient(stack().url, stack().key, {
			auth: { persistSession: false, autoRefreshToken: false },
		});
		const read = await anon.from("treasuries").select("address");
		expect(read.error?.message).not.toBe("relay.session_ended");
		expect(read.data ?? []).toEqual([]);
	});

	it("carries the session of the single-slot time over, with no new signature", async () => {
		const here = newBrowser();
		const one = newAccount();
		// as the page stored it before there was a slot per wallet
		const old = createClient(stack().url, stack().key, {
			auth: {
				persistSession: true,
				autoRefreshToken: false,
				detectSessionInUrl: false,
				storageKey: RELAY_LEGACY_KEY,
				storage: here.slots,
			},
		});
		expect((await signInWith(old, one.account)).ok).toBe(true);
		expect([...here.map.keys()]).toEqual([RELAY_LEGACY_KEY]);

		expect(adoptLegacy(here.slots, Date.now())).toBe(one.address);
		expect(here.map.has(RELAY_LEGACY_KEY)).toBe(false);
		expect(storedWallets(here.slots)).toEqual([one.address]);
		expect(
			await probeFor(here.clientFor(one.address), one.address, here.slots),
		).toBe("ready");
		expect(
			(await listTreasuries(here.clientFor(one.address))).issue,
		).toBeNull();
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

describe("an account that registers itself", () => {
	// the wallet that converted its own account into a multi-sig: signed in as
	// that account, and not one of its signers
	let own: TestWallet;

	it("is stored once Hyperliquid names its signers, and they all see it", async () => {
		own = await newWallet();
		stub.answer(own.address, {
			signers: [a.address, b.address],
			threshold: 2,
		});
		expect(await add(own, own.address)).toEqual({
			status: "done",
			reason: null,
		});
		for (const w of [a, b]) {
			const mine = (await listTreasuries(w.client)).data?.rows ?? [];
			const row = mine.find((t) => t.address === own.address);
			expect(row).toMatchObject({
				network: NET,
				threshold: 2,
				addedBy: own.address,
				frozenAt: null,
			});
			expect(row?.signers).toEqual([a.address, b.address].sort());
		}
	});

	it("reads its treasury and its history as its signers do", async () => {
		const mine = (await listTreasuries(own.client)).data?.rows ?? [];
		expect(mine.map((t) => [t.address, t.signers])).toEqual([
			[own.address, [a.address, b.address].sort()],
		]);
		// the first history entry names the account, for it and for its signers
		for (const w of [own, a]) {
			const seen = (await listEvents(w.client, NET, own.address)).data?.rows;
			expect(seen?.map((e) => [e.kind, e.actor])).toEqual([
				["treasury_added", own.address],
			]);
		}
	});

	it("writes nothing for it", async () => {
		expect(
			codes(
				(
					await setNickname(own.client, own.address, {
						network: NET,
						treasury: own.address,
						address: own.address,
						name: "Itself",
					})
				).issue,
			),
		).toBe("relay.not_allowed");
		expect(
			codes(
				(
					await requestTreasury(
						own.client,
						own.address,
						NET,
						own.address,
						"check",
					)
				).issue,
			),
		).toBe("relay.not_allowed");
	});

	it("is refused while Hyperliquid does not show it as a multi-sig", async () => {
		const early = await newWallet();
		expect(await add(early, early.address)).toEqual({
			status: "rejected",
			reason: "not_multisig",
		});
		// and somebody who is neither the account nor a signer is refused as before
		expect(await add(outsider, own.address)).toEqual({
			status: "rejected",
			reason: "not_a_signer",
		});
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

	it("says who signed last, to the treasury's signers only", async () => {
		const treasury = p.payload.multiSigUser as Address;
		const all = await listSignatureEvents(a.client, NET, treasury, 500);
		const rows = all.data?.rows ?? [];
		expect(rows.every((r) => r.kind === "signature_added")).toBe(true);
		const actors = new Set(rows.map((r) => r.actor));
		expect([actors.has(a.address), actors.has(b.address)]).toEqual([
			true,
			true,
		]);
		// newest first, so a full window is the newest part of the history
		const ids = rows.map((r) => r.id);
		expect(ids).toEqual([...ids].sort((x, y) => y - x));
		expect(
			(await listSignatureEvents(a.client, NET, treasury, 1)).data?.rows,
		).toHaveLength(1);
		// one signer by itself: the row a full window could not reach
		const one = await lastSignatureOf(a.client, NET, treasury, b.address);
		expect(one.data?.actor).toBe(b.address);
		expect(
			await lastSignatureOf(a.client, NET, treasury, outsider.address),
		).toEqual({ data: null, issue: null });
		// a wallet that signs for nothing reads none of it
		expect(
			(await listSignatureEvents(outsider.client, NET, treasury, 500)).data
				?.rows,
		).toEqual([]);
		expect(
			(await lastSignatureOf(outsider.client, NET, treasury, a.address)).data,
		).toBeNull();
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
				(await withdrawProposal(outsider.client, outsider.address, keyOf(p)))
					.issue,
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
			codes((await withdrawProposal(c.client, c.address, keyOf(p))).issue),
		).toBe("relay.not_proposer");
		// nobody declines any more, whoever they are
		expect(codes(relayIssue((await decline(a, p)).error))).toBe(
			"relay.decline_retired",
		);
		expect(
			(await withdrawProposal(a.client, a.address, keyOf(p))).issue,
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
			codes((await withdrawProposal(b.client, b.address, keyOf(p))).issue),
		).toBe("relay.proposal_closed");
		expect(
			codes((await removeSignature(a.client, a.address, keyOf(p))).issue),
		).toBe("relay.proposal_closed");
	});

	it("no longer lets the finaliser decline: it says no like any other signer", async () => {
		const p = await proposal("integration: decline");
		await publishProposal(a.client, a.address, publishRow(p));
		const refused = await decline(b, p);
		expect(codes(relayIssue(refused.error))).toBe("relay.decline_retired");
		expect((await read(c, p)).row?.status).toBe("open");
		expect(
			(await addObjection(b.client, b.address, keyOf(p))).issue,
		).toBeNull();
		const seen = await read(c, p);
		// said, and nothing ended by it
		expect(seen.row?.status).toBe("open");
		expect(seen.row?.objections.map((o) => o.signer)).toEqual([b.address]);
	});
});

describe("saying no", () => {
	const position = (row: ProposalRow | null | undefined) =>
		standing({
			signers: [a.address, b.address, c.address],
			threshold: 2,
			finaliser: b.address,
			objections: (row?.objections ?? []).map((o) => ({
				signer: o.signer,
				at: o.createdAt,
			})),
		});
	const kinds = async (p: Proposal) =>
		(await listProposalEvents(a.client, keyOf(p))).data?.rows.map(
			(e) => e.kind,
		);

	it("is seen by every co-signer, ends nothing, and is closed to everybody else", async () => {
		const p = await proposal("integration: a no", [a]);
		await publishProposal(a.client, a.address, publishRow(p));
		await addSignature(a.client, a.address, keyOf(p), sigOf(p, a));
		expect(
			(await addObjection(c.client, c.address, keyOf(p))).issue,
		).toBeNull();
		for (const w of [a, b, c]) {
			const seen = await read(w, p);
			expect(seen.row?.status).toBe("open");
			expect(seen.row?.objections.map((o) => o.signer)).toEqual([c.address]);
			// the proposer's signature is as it was
			expect(seen.row?.signatures.map((x) => x.signer)).toEqual([a.address]);
		}
		// one signer against it in a 2-of-3: it can still pass
		expect(position((await read(a, p)).row).blocked).toBeNull();
		// said twice is said once
		expect(
			(await addObjection(c.client, c.address, keyOf(p))).issue,
		).toBeNull();
		expect((await read(a, p)).row?.objections).toHaveLength(1);
		// an outsider reads nothing of it and cannot say anything
		expect((await getProposal(outsider.client, p.digest)).data?.rows).toEqual(
			[],
		);
		expect(
			codes(
				(await addObjection(outsider.client, outsider.address, keyOf(p))).issue,
			),
		).toBe("relay.not_allowed");
		expect(
			(await outsider.client.from("objections").select("signer")).data,
		).toEqual([]);
		// nor can one signer say it in another's name
		expect(
			codes((await addObjection(b.client, c.address, keyOf(p))).issue),
		).toBe("relay.wrong_wallet");
	});

	it("can be taken back, by the one who said it", async () => {
		const p = await proposal("integration: a no taken back");
		await publishProposal(a.client, a.address, publishRow(p));
		await addObjection(c.client, c.address, keyOf(p));
		// a co-signer's attempt removes nothing
		await b.client
			.from("objections")
			.delete()
			.eq("digest", p.digest)
			.eq("signer", c.address);
		expect((await read(a, p)).row?.objections).toHaveLength(1);
		expect(
			(await removeObjection(c.client, c.address, keyOf(p))).issue,
		).toBeNull();
		expect((await read(a, p)).row?.objections).toEqual([]);
		expect(await kinds(p)).toEqual([
			"proposal_created",
			"objection_added",
			"objection_removed",
		]);
	});

	it("is one position at a time: a no takes the signature back, a signature takes the no back", async () => {
		const p = await proposal("integration: positions", [c]);
		await publishProposal(a.client, a.address, publishRow(p));
		await addSignature(c.client, c.address, keyOf(p), sigOf(p, c));
		expect(
			(await addObjection(c.client, c.address, keyOf(p))).issue,
		).toBeNull();
		let seen = await read(a, p);
		expect(seen.row?.signatures).toEqual([]);
		expect(seen.row?.objections.map((o) => o.signer)).toEqual([c.address]);
		// and signing again replaces the no
		expect(
			(await addSignature(c.client, c.address, keyOf(p), sigOf(p, c))).issue,
		).toBeNull();
		seen = await read(a, p);
		expect(seen.row?.objections).toEqual([]);
		expect(seen.row?.signatures.map((x) => x.signer)).toEqual([c.address]);
		const history = (await listProposalEvents(a.client, keyOf(p))).data?.rows;
		expect(history?.map((e) => e.kind)).toEqual([
			"proposal_created",
			"signature_added",
			"signature_removed",
			"objection_added",
			"objection_removed",
			"signature_added",
		]);
		// which the signing log tells as three steps, not five
		const log = buildTimeline(history ?? [], {
			me: null,
			line: () => "Send 1 USDC",
		}).map((e) => partsText(e.parts));
		expect(log.filter((t) => t.includes("said no"))).toEqual([
			expect.stringContaining(
				"said no to Send 1 USDC, taking back their signature.",
			),
		]);
		expect(log[0]).toContain("signed Send 1 USDC, in place of their no.");
	});

	it("holds a proposal up when enough say no, or its finaliser does, and lets it go when they change their mind", async () => {
		const p = await proposal("integration: held up", [a]);
		await publishProposal(a.client, a.address, publishRow(p));
		await addSignature(a.client, a.address, keyOf(p), sigOf(p, a));
		// the finaliser alone
		await addObjection(b.client, b.address, keyOf(p));
		expect(position((await read(a, p)).row).blocked).toBe("finaliser-no");
		// and a second signer: fewer are left than must sign
		await addObjection(c.client, c.address, keyOf(p));
		const both = await read(a, p);
		expect(position(both.row)).toMatchObject({
			left: 1,
			blocked: "cannot-pass",
		});
		// held up, not ended
		expect(both.row?.status).toBe("open");
		expect(
			(await listOpenProposals(a.client)).data?.rows.map((r) => r.digest),
		).toContain(p.digest);
		await removeObjection(c.client, c.address, keyOf(p));
		await removeObjection(b.client, b.address, keyOf(p));
		expect(position((await read(a, p)).row).blocked).toBeNull();
		// and it can go on as if nothing had been said
		const withB = await proposalSignedBy(p, b);
		expect(
			(await addSignature(b.client, b.address, keyOf(p), sigOf(withB, b)))
				.issue,
		).toBeNull();
	});

	it("freezes with the proposal: nothing is said, or taken back, once it is withdrawn or has lapsed", async () => {
		const p = await proposal("integration: a no, then withdrawn");
		await publishProposal(a.client, a.address, publishRow(p));
		await addObjection(c.client, c.address, keyOf(p));
		await withdrawProposal(a.client, a.address, keyOf(p));
		expect(
			codes((await addObjection(b.client, b.address, keyOf(p))).issue),
		).toBe("relay.proposal_closed");
		expect(
			codes((await removeObjection(c.client, c.address, keyOf(p))).issue),
		).toBe("relay.proposal_closed");
		expect((await read(a, p)).row?.objections).toHaveLength(1);

		const q = await proposal("integration: a no, then lapsed");
		await publishProposal(a.client, a.address, publishRow(q));
		await addObjection(c.client, c.address, keyOf(q));
		await sql`update public.proposals set expires_at = now() - interval '1 second' where digest = ${q.digest}`;
		expect(
			codes((await addObjection(b.client, b.address, keyOf(q))).issue),
		).toBe("relay.proposal_expired");
		expect(
			codes((await removeObjection(c.client, c.address, keyOf(q))).issue),
		).toBe("relay.proposal_expired");
	});

	it("reaches the co-signers' pages within two seconds", async () => {
		const p = await proposal("integration: a no, live");
		await publishProposal(a.client, a.address, publishRow(p));
		let pings = 0;
		let state: ChannelState | null = null;
		const leave = subscribeWallet(
			a.client,
			a.address,
			() => {
				pings += 1;
			},
			(s) => {
				state = s;
			},
		);
		try {
			await until(() => state === "joined", 10_000);
			// joining counts as one ping (the page re-reads on join); let it land
			await new Promise((r) => setTimeout(r, 600));
			const before = pings;
			await addObjection(c.client, c.address, keyOf(p));
			const took = await until(() => pings > before, 2_000);
			expect(took).toBeLessThan(2_000);
		} finally {
			leave();
		}
	});

	it("is limited to thirty an hour per wallet", async () => {
		// twenty-nine on record for a fresh signer of the same treasury would need
		// twenty-nine proposals; the entries are what the limit counts
		const used = Number(
			(
				await sql`select count(*)::int as n from public.events
					where kind = 'objection_added' and actor = ${c.address} and at > now() - interval '1 hour'`
			)[0]?.n ?? 0,
		);
		const some = await proposal("integration: the limit");
		await publishProposal(a.client, a.address, publishRow(some));
		await sql`insert into public.events (network, treasury, digest, kind, actor)
			select ${NET}, ${treasury}, ${some.digest}, 'objection_added', ${c.address}
			from generate_series(1, ${30 - used})`;
		expect(
			codes((await addObjection(c.client, c.address, keyOf(some))).issue),
		).toBe("relay.rate_limited");
		// a signature is not held back by it
		const withC = await proposalSignedBy(some, c);
		expect(
			(await addSignature(c.client, c.address, keyOf(some), sigOf(withC, c)))
				.issue,
		).toBeNull();
		await sql`delete from public.events
			where kind = 'objection_added' and actor = ${c.address} and digest = ${some.digest}`;
	});
});

describe("a move of two steps", () => {
	const VALIDATOR = "0x946bf3135c7d15e4462b510f74b6e304aabb5b21";
	/** "Stake 100 HYPE" when 50 has to come from spot first: proposed by c, finalised by b. */
	function move(): readonly [Proposal, Proposal] {
		const now = Date.now();
		const step = (action: Record<string, unknown>, nonce: number) => {
			const made = createProposal(
				{
					network: NET,
					multiSigUser: treasury,
					outerSigner: b.address,
					action: {
						signatureChainId: "0x3e7",
						hyperliquidChain: "Mainnet",
						...action,
						nonce,
					},
					nonce,
					createdBy: c.address,
				},
				{ now },
			);
			if (!made.proposal) throw new Error(JSON.stringify(made.issues));
			return made.proposal;
		};
		return tieSteps(
			step({ type: "cDeposit", wei: 5_000_000_000 }, now),
			step(
				{
					type: "tokenDelegate",
					validator: VALIDATOR,
					wei: 10_000_000_000,
					isUndelegate: false,
				},
				now + 1,
			),
		);
	}
	const keys = (m: readonly Proposal[]) => m.map(keyOf);

	it("is shared whole and read back as one move, by who the relay says proposed it", async () => {
		const [first, second] = move();
		expect(
			(
				await publishMove(c.client, c.address, [
					publishRow(first),
					publishRow(second),
				])
			).issue,
		).toBeNull();
		const one = await read(a, first);
		const two = await read(a, second);
		expect(one.issues).toEqual([]);
		expect(one.proposal?.meta.steps).toEqual([first.digest, second.digest]);
		expect(two.proposal?.meta.steps).toEqual([first.digest, second.digest]);
		const judged = judgeMove(
			one.proposal as Proposal,
			two.proposal as Proposal,
			{ a: one.row?.createdBy ?? null, b: two.row?.createdBy ?? null },
		);
		expect(judged.move).toMatchObject({
			kind: "stake",
			amount: "100",
			validator: VALIDATOR,
		});
		// the relay stamped the proposer itself; a document's own word would not do
		expect(one.row?.createdBy).toBe(c.address);
		expect(
			judgeMove(one.proposal as Proposal, two.proposal as Proposal, {
				a: one.row?.createdBy ?? null,
				b: a.address,
			}).flaw,
		).toBe("proposer");
		// shared again (another tab, a retry): done, not an error
		expect(
			(
				await publishMove(c.client, c.address, [
					publishRow(first),
					publishRow(second),
				])
			).issue,
		).toBeNull();
		// one step was already there: the other is still shared
		const [third, fourth] = move();
		await publishProposal(c.client, c.address, publishRow(third));
		expect(
			(
				await publishMove(c.client, c.address, [
					publishRow(third),
					publishRow(fourth),
				])
			).issue,
		).toBeNull();
		expect((await read(a, fourth)).row?.status).toBe("open");
		// an outsider shares neither
		const [x, y] = move();
		expect(
			codes(
				(
					await publishMove(outsider.client, outsider.address, [
						publishRow(x),
						publishRow(y),
					])
				).issue,
			),
		).toBe("relay.not_allowed");
		expect((await read(a, x)).row).toBeNull();
		expect((await read(a, y)).row).toBeNull();
	});

	it("shared from its page: both steps with the proposer's signatures, and the step that is missing when one is there", async () => {
		const signedBy = async (p: Proposal, w: TestWallet): Promise<Proposal> => {
			const s = await signProposal(p, viemSigner(w.account));
			if (!s.signature) throw new Error(JSON.stringify(s.issues));
			return { ...p, signatures: [s.signature] };
		};
		const [first, second] = move();
		const steps = [await signedBy(first, c), await signedBy(second, c)];
		expect((await shareMove(c.client, c.address, steps)).issue).toBeNull();
		for (const step of steps) {
			const seen = await read(a, step);
			expect(seen.row?.status).toBe("open");
			expect(seen.row?.signatures.map((x) => x.signer)).toEqual([c.address]);
		}
		// half shared (an older page shared step 1 alone): the same write adds the other
		const [third, fourth] = move();
		await publishProposal(c.client, c.address, publishRow(third));
		expect((await read(a, fourth)).row).toBeNull();
		expect(
			(await shareMove(c.client, c.address, [third, await signedBy(fourth, c)]))
				.issue,
		).toBeNull();
		const other = await read(a, fourth);
		expect(other.row?.status).toBe("open");
		expect(other.row?.signatures.map((x) => x.signer)).toEqual([c.address]);
		// somebody who is no signer shares neither step
		const [x, y] = move();
		expect(
			codes((await shareMove(outsider.client, outsider.address, [x, y])).issue),
		).toBe("relay.not_allowed");
		expect((await read(a, x)).row).toBeNull();
		expect((await read(a, y)).row).toBeNull();
	});

	it("a no, its taking back, signatures taken back and a withdrawal each cover both steps", async () => {
		const m = move();
		await publishMove(c.client, c.address, m.map(publishRow));
		const [first, second] = m;
		const rows = async () => [
			(await read(b, first)).row,
			(await read(b, second)).row,
		];

		// a signs both, then says no to both: one statement, and both signatures go with it
		for (const p of m)
			await addSignature(
				a.client,
				a.address,
				keyOf(p),
				sigOf(await proposalSignedBy(p, a), a),
			);
		expect(
			(await rows()).map((r) => r?.signatures.map((x) => x.signer)),
		).toEqual([[a.address], [a.address]]);
		expect(
			(await addObjections(a.client, a.address, keys(m))).issue,
		).toBeNull();
		for (const r of await rows()) {
			expect(r?.objections.map((o) => o.signer)).toEqual([a.address]);
			expect(r?.signatures).toEqual([]);
			expect(r?.status).toBe("open");
		}
		// said again: done
		expect(
			(await addObjections(a.client, a.address, keys(m))).issue,
		).toBeNull();
		expect(
			(await removeObjections(a.client, a.address, keys(m))).issue,
		).toBeNull();
		expect((await rows()).map((r) => r?.objections)).toEqual([[], []]);

		// b signs both and takes both back
		for (const p of m)
			await addSignature(
				b.client,
				b.address,
				keyOf(p),
				sigOf(await proposalSignedBy(p, b), b),
			);
		expect(
			(await removeSignatures(b.client, b.address, keys(m))).issue,
		).toBeNull();
		expect((await rows()).map((r) => r?.signatures)).toEqual([[], []]);

		// only the proposer withdraws, and then both are closed
		expect(
			codes((await withdrawMove(b.client, b.address, keys(m))).issue),
		).toBe("relay.not_proposer");
		expect((await rows()).map((r) => r?.status)).toEqual(["open", "open"]);
		expect((await withdrawMove(c.client, c.address, keys(m))).issue).toBeNull();
		expect((await rows()).map((r) => r?.status)).toEqual([
			"withdrawn",
			"withdrawn",
		]);
		// nothing more can be said to a closed move, and nothing is half said
		expect(
			codes((await addObjections(a.client, a.address, keys(m))).issue),
		).toBe("relay.proposal_closed");
		expect((await rows()).map((r) => r?.objections)).toEqual([[], []]);
	});
});

describe("a vault deposit or withdrawal", () => {
	const VAULT = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303";
	/** A vault proposal as the form makes it: an L1 action, proposed by a, finalised by b. */
	async function vaultProposal(
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
					type: "vaultTransfer",
					vaultAddress: VAULT,
					isDeposit: true,
					usd: 5_000_000,
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

	it("is shared, and a co-signer reads it and verifies the hash signature in their own client", async () => {
		const p = await vaultProposal("integration: vault deposit", [a]);
		expect(p.meta.kind).toBe("l1");
		expect(publishBlocker(p)).toBeNull();
		expect(
			(await publishProposal(a.client, a.address, publishRow(p))).issue,
		).toBeNull();
		expect(
			(await addSignature(a.client, a.address, keyOf(p), sigOf(p, a))).issue,
		).toBeNull();
		const seen = await read(b, p);
		expect(seen.issues).toEqual([]);
		expect(seen.proposal?.digest).toBe(p.digest);
		expect(seen.proposal?.meta.kind).toBe("l1");
		expect(seen.proposal?.payload).toEqual(p.payload);
		expect(seen.signers).toEqual([a.address]);
		// the finaliser's own result closes it, as it closes any proposal
		expect(
			(await recordReceipt(b.client, b.address, keyOf(p), receipt(true))).issue,
		).toBeNull();
		expect((await read(a, p)).row?.status).toBe("accepted");
	});

	it("is never closed on a report: its action carries no number of its own", async () => {
		const p = await vaultProposal("integration: vault report", [], {
			isDeposit: false,
		});
		expect(
			(await publishProposal(a.client, a.address, publishRow(p))).issue,
		).toBeNull();
		const hash = `0x${"5a".repeat(32)}`;
		expect(
			codes(
				(await reportExecution(a.client, a.address, keyOf(p), hash as never))
					.issue,
			),
		).toBe("relay.report_unnumbered");
		expect((await listReports(a.client, keyOf(p))).data?.rows ?? []).toEqual(
			[],
		);
		expect((await read(b, p)).row?.status).toBe("open");
	});

	it("is refused in any other shape, and so is every other action signed as a hash", async () => {
		const p = await vaultProposal("integration: vault shape");
		const row = publishRow(p);
		// written past the browser's own check, as another client could
		const extra = {
			...row,
			document: row.document.replace('"usd":5000000', '"usd":5000000,"x":1'),
		};
		expect(extra.document).not.toBe(row.document);
		expect(
			codes((await publishProposal(a.client, a.address, extra)).issue),
		).toBe("relay.document_mismatch");
		const claimed = {
			...row,
			document: row.document.replace('"kind":"l1"', '"kind":"user-signed"'),
		};
		expect(claimed.document).not.toBe(row.document);
		expect(
			codes((await publishProposal(a.client, a.address, claimed)).issue),
		).toBe("relay.document_mismatch");
		const now = Date.now();
		const noop = createProposal(
			{
				network: NET,
				multiSigUser: treasury,
				outerSigner: b.address,
				action: { type: "noop" },
				nonce: now,
				createdBy: a.address,
			},
			{ now },
		).proposal as Proposal;
		expect(publishBlocker(noop)).toMatch(/only a vault deposit or withdrawal/);
		expect(
			codes(
				(await publishProposal(a.client, a.address, publishRow(noop))).issue,
			),
		).toBe("relay.document_mismatch");
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

describe("a proposal carried out without the tool", () => {
	let n = 0;
	const tx = () => `0x${(++n).toString(16).padStart(8, "0")}${"7e".repeat(28)}`;
	/** The 30 seconds a report waits, skipped. */
	const due = async (p: Proposal) => {
		await sql`update public.execution_reports set not_before = now() - interval '1 second'
			where digest = ${p.digest} and status = 'pending'`;
	};
	const statusOf = async (w: TestWallet, p: Proposal) =>
		(await read(w, p)).row?.status ?? null;
	const reports = async (w: TestWallet, p: Proposal) =>
		((await listReports(w.client, keyOf(p))).data?.rows ?? []).map(
			(r) => `${r.status}${r.reason ? `:${r.reason}` : ""}`,
		);

	it("is closed for every signer once the relay has seen the transaction for itself", async () => {
		const p = await proposal("integration: carried out", [a]);
		await publishProposal(a.client, a.address, publishRow(p));
		const hash = tx();
		stub.tx(hash, { user: treasury, action: p.payload.action });
		expect(
			(await reportExecution(a.client, a.address, keyOf(p), hash as never))
				.issue,
		).toBeNull();
		expect(await reports(a, p)).toEqual(["pending"]);
		// a co-signer does not read the report itself, and telling twice is fine
		expect(await reports(b, p)).toEqual([]);
		expect(
			(await reportExecution(b.client, b.address, keyOf(p), hash as never))
				.issue,
		).toBeNull();
		expect(await statusOf(a, p)).toBe("open");

		const asked = stub.txCalls.length;
		await due(p);
		await untilWorker(sql, async () => (await statusOf(a, p)) !== "open");
		expect(stub.txCalls.slice(asked)).toEqual([hash]);
		expect(await statusOf(a, p)).toBe("carried_out");
		expect(await statusOf(b, p)).toBe("carried_out");
		expect(await reports(a, p)).toEqual(["confirmed"]);
		const events =
			(await listProposalEvents(a.client, keyOf(p))).data?.rows ?? [];
		const last = events.at(-1);
		expect(last?.kind).toBe("proposal_carried_out");
		expect(last?.actor).toBeNull();
		expect(last?.data).toMatchObject({ tx_hash: hash, reported_by: a.address });
		// it left everyone's pending list, and nothing more can be signed for it
		expect(
			(await listOpenProposals(b.client)).data?.rows.some(
				(r) => r.digest === p.digest,
			),
		).toBe(false);
		expect(
			codes((await withdrawProposal(a.client, a.address, keyOf(p))).issue),
		).toBe("relay.proposal_closed");

		// the finaliser's own result, arriving late, makes it a normal accepted proposal
		expect(
			(await recordReceipt(b.client, b.address, keyOf(p), receipt(true))).issue,
		).toBeNull();
		expect(await statusOf(a, p)).toBe("accepted");
	});

	it("is not believed when the transaction is something else", async () => {
		const p = await proposal("integration: false report", [a]);
		await publishProposal(a.client, a.address, publishRow(p));
		const other = tx();
		stub.tx(other, {
			user: treasury,
			action: { ...p.payload.action, amount: "2" },
		});
		await reportExecution(a.client, a.address, keyOf(p), other as never);
		await due(p);
		await untilWorker(sql, async () => (await reports(a, p))[0] !== "pending");
		expect(await reports(a, p)).toEqual(["rejected:other_action"]);

		// the right action, rejected by the chain
		const failed = tx();
		stub.tx(failed, {
			user: treasury,
			action: p.payload.action,
			error: "Insufficient balance for withdrawal.",
		});
		await reportExecution(a.client, a.address, keyOf(p), failed as never);
		await due(p);
		await untilWorker(
			sql,
			async () =>
				(await reports(a, p)).length === 2 &&
				!(await reports(a, p)).includes("pending"),
		);
		expect((await reports(a, p)).sort()).toEqual([
			"rejected:other_action",
			"rejected:tx_failed",
		]);

		// another account's transaction with the very same action
		const theirs = tx();
		stub.tx(theirs, { user: outsider.address, action: p.payload.action });
		await reportExecution(b.client, b.address, keyOf(p), theirs as never);
		await due(p);
		await untilWorker(sql, async () => (await reports(b, p))[0] !== "pending");
		expect(await reports(b, p)).toEqual(["rejected:other_account"]);
		expect(await statusOf(a, p)).toBe("open");
	});

	it("can only be reported by a signer of that treasury", async () => {
		const p = await proposal("integration: outsider report", [a]);
		await publishProposal(a.client, a.address, publishRow(p));
		expect(
			codes(
				(
					await reportExecution(
						outsider.client,
						outsider.address,
						keyOf(p),
						tx() as never,
					)
				).issue,
			),
		).toBe("relay.not_allowed");
		expect(
			codes(
				(
					await reportExecution(
						a.client,
						a.address,
						{ ...keyOf(p), digest: `0x${"ee".repeat(32)}` },
						tx() as never,
					)
				).issue,
			),
		).toBe("relay.unknown_proposal");
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

describe("nicknames", () => {
	// by now the treasury's signers are a, b and c
	const vendor = newAccount().address;
	const vendor2 = newAccount().address;
	let second: Address;
	const namesIn = async (w: TestWallet, t: Address, signers: Address[]) => {
		const rows = (await listNicknames(w.client)).data?.rows ?? [];
		return Object.fromEntries(
			[...acceptNicknames(rows, { network: NET, treasury: t, signers })].map(
				([address, n]) => [address, n.name],
			),
		);
	};
	const name = (
		w: TestWallet,
		t: Address,
		address: Address,
		text: string | null,
	) =>
		setNickname(w.client, w.address, {
			network: NET,
			treasury: t,
			address,
			name: text,
		});

	beforeAll(async () => {
		second = newAccount().address;
		stub.answer(second, {
			signers: [a.address, outsider.address],
			threshold: 1,
		});
		expect((await add(a, second)).status).toBe("done");
	});

	it("is given by one signer and read by the co-signers, tidied", async () => {
		expect(
			(await name(a, treasury, vendor, "  The   Auditor ")).issue,
		).toBeNull();
		const signers = [a.address, b.address, c.address];
		expect(await namesIn(b, treasury, signers)).toEqual({
			[vendor]: "The Auditor",
		});
		// the treasury itself, and a signer's own address
		expect((await name(b, treasury, treasury, "Operations")).issue).toBeNull();
		expect((await name(a, treasury, a.address, "Alice")).issue).toBeNull();
		expect(await namesIn(c, treasury, signers)).toEqual({
			[vendor]: "The Auditor",
			[treasury]: "Operations",
			[a.address]: "Alice",
		});
	});

	it("stays inside its treasury: the same address is unnamed, or named otherwise, in another", async () => {
		const here = [a.address, outsider.address];
		// outsider signs for the second treasury only: it reads none of the first one's names
		expect(await namesIn(outsider, second, here)).toEqual({});
		expect(
			((await listNicknames(outsider.client)).data?.rows ?? []).filter(
				(r) => r.treasury === treasury,
			),
		).toEqual([]);
		expect((await name(outsider, second, vendor, "Lawyer")).issue).toBeNull();
		expect((await name(a, second, a.address, "A.")).issue).toBeNull();
		expect(await namesIn(a, second, here)).toEqual({
			[vendor]: "Lawyer",
			[a.address]: "A.",
		});
		// and the first treasury still says what it said
		expect(
			(await namesIn(a, treasury, [a.address, b.address, c.address]))[vendor],
		).toBe("The Auditor");
		// b signs for the first only
		expect(
			((await listNicknames(b.client)).data?.rows ?? []).some(
				(r) => r.treasury === second,
			),
		).toBe(false);
	});

	it("leaves a signer's own name to that signer", async () => {
		expect(codes((await name(b, treasury, a.address, "Boss")).issue)).toBe(
			"relay.nickname_not_yours",
		);
		expect(codes((await name(b, treasury, a.address, null)).issue)).toBe(
			"relay.nickname_not_yours",
		);
		expect(codes((await name(a, treasury, b.address, "Bob")).issue)).toBe(
			"relay.nickname_not_yours",
		);
		expect((await name(a, treasury, a.address, null)).issue).toBeNull();
		expect(
			(await namesIn(b, treasury, [a.address, b.address, c.address]))[
				a.address
			],
		).toBeUndefined();
	});

	it("refuses a name that reads like an address, and tells why", async () => {
		const r = await name(a, treasury, vendor2, "0x5e7c…7216");
		expect(codes(r.issue)).toBe("relay.nickname_invalid");
		expect(r.issue?.message).toBe("A nickname cannot look like an address.");
		expect(codes((await name(a, treasury, vendor2, "You")).issue)).toBe(
			"relay.nickname_invalid",
		);
	});

	it("gives a name to one address when two signers choose it at the same moment", async () => {
		const results = await Promise.all([
			name(a, treasury, vendor2, "Payroll"),
			name(b, treasury, newAccount().address, "payroll"),
		]);
		expect(results.map((r) => codes(r.issue) ?? "ok").sort()).toEqual([
			"ok",
			"relay.nickname_taken",
		]);
		const names = Object.values(
			await namesIn(c, treasury, [a.address, b.address, c.address]),
		).filter((n) => n.toLowerCase() === "payroll");
		expect(names).toHaveLength(1);
	});

	it("is closed to anyone who does not sign for that treasury", async () => {
		expect(codes((await name(outsider, treasury, vendor, "Mine")).issue)).toBe(
			"relay.not_allowed",
		);
		expect(codes((await name(b, second, vendor, "Mine")).issue)).toBe(
			"relay.not_allowed",
		);
	});
});

describe("who has seen a proposal", () => {
	// by now the treasury's signers are a, b and c
	it("keeps a signer's first look, tells every signer once, and takes none for a closed proposal", async () => {
		const p = await proposal("integration: seen", [a]);
		expect(
			(await publishProposal(a.client, a.address, publishRow(p))).issue,
		).toBeNull();
		let pings = 0;
		let state: ChannelState = "joining";
		const leave = subscribeWallet(
			a.client,
			a.address,
			() => {
				pings += 1;
			},
			(s) => {
				state = s;
			},
		);
		const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
		const seenBy = async (w: TestWallet) =>
			(await listViews(w.client, keyOf(p))).data?.rows ?? null;
		try {
			await until(() => state === "joined", 10_000);
			await pause(400);
			expect(await seenBy(a)).toEqual([]);

			// one view, one ping
			const before = pings;
			expect(
				(await recordView(b.client, b.address, keyOf(p))).issue,
			).toBeNull();
			await until(() => pings > before, 2_000);
			await pause(400);
			expect(pings - before).toBe(1);
			const first = await seenBy(a);
			expect(first?.map((v) => v.signer)).toEqual([b.address]);
			// the co-signers read the same, the one it is about included
			expect(await seenBy(b)).toEqual(first);
			expect(await seenBy(c)).toEqual(first);

			// a second look is done, not an error: no new row, no new time, no ping
			const after = pings;
			expect(
				(await recordView(b.client, b.address, keyOf(p))).issue,
			).toBeNull();
			await pause(600);
			expect(pings).toBe(after);
			expect(await seenBy(a)).toEqual(first);

			// a wallet that signs for nothing here leaves no mark and reads none
			expect(
				codes(
					(await recordView(outsider.client, outsider.address, keyOf(p))).issue,
				),
			).toBe("relay.not_allowed");
			expect(await seenBy(outsider)).toEqual([]);
			// nor can a mark be left under another wallet's name
			expect(
				codes((await recordView(c.client, b.address, keyOf(p))).issue),
			).toBe("relay.wrong_wallet");

			// once it is closed, looking leaves nothing
			expect(
				(await withdrawProposal(a.client, a.address, keyOf(p))).issue,
			).toBeNull();
			await pause(400);
			const closed = pings;
			expect(
				(await recordView(c.client, c.address, keyOf(p))).issue,
			).toBeNull();
			await pause(600);
			expect(pings).toBe(closed);
			expect(await seenBy(a)).toEqual(first);
		} finally {
			leave();
		}
	});
});

describe("what a signer has read", () => {
	// by now the treasury's signers are a, b and c
	type Mark = NonNullable<Awaited<ReturnType<typeof markOf>>>;
	const newest = async (w: TestWallet) =>
		(await listEvents(w.client, NET, treasury, { limit: 1 })).data?.rows[0]
			?.id ?? 0;
	const markOf = async (w: TestWallet) =>
		latestMarks((await listMarks(w.client)).data?.rows ?? []).get(
			`${NET}:${treasury}`,
		) ?? null;
	const write = (w: TestWallet, eventId: number, chain: MarkChain = {}) =>
		markRead(w.client, w.address, [{ network: NET, treasury, eventId, chain }]);
	/** What the page reads for the notice, and what the notice then says. */
	const news = async (w: TestWallet, mark: Mark) => {
		const events = (
			(await listEventsAfter(w.client, mark.eventId)).data?.rows ?? []
		).filter((e) => e.treasury === treasury);
		const digests = [
			...new Set(
				events.filter(isEnding).flatMap((e) => (e.digest ? [e.digest] : [])),
			),
		];
		const rows = [
			...((await listProposalsIn(w.client, digests)).data?.rows ?? []),
			...((await listLapsed(w.client, mark.markedAt)).data?.rows ?? []),
		].filter((r) => r.treasury === treasury);
		const proposals = [];
		for (const row of rows) {
			const x = await assembleProposal(row);
			if (x.assembled) proposals.push(awayProposal(row, x.assembled.proposal));
		}
		return { events, proposals };
	};
	const told = async (w: TestWallet) => {
		const mark = await markOf(w);
		if (!mark) return null;
		const n = await news(w, mark);
		return awayItems({
			mark,
			...n,
			me: w.address,
			chain: { ledger: null, agents: null },
			now: Date.now(),
		}).map((i) => partsText(i.parts));
	};

	it("starts from now, tells what was carried out without the signer, and stops after 'Got it'", async () => {
		expect(await told(c)).toBeNull();
		const start = await newest(c);
		const first = firstMark({ newestEventId: start, now: Date.now() });
		expect((await write(c, first.eventId, first.chain)).issue).toBeNull();
		expect((await write(a, first.eventId, first.chain)).issue).toBeNull();
		const begun = await markOf(c);
		expect(begun).toMatchObject({ eventId: start, agents: null });
		expect(begun?.ledgerTime).toBe(first.chain.ledgerTime);
		// everything before the first marker is history, not news
		expect(await told(c)).toEqual([]);

		const p = await proposal("integration: away", [a]);
		await publishProposal(a.client, a.address, publishRow(p));
		await addSignature(a.client, a.address, keyOf(p), sigOf(p, a));
		expect(
			(await recordReceipt(b.client, b.address, keyOf(p), receipt(true))).issue,
		).toBeNull();

		const forC = (await told(c)) ?? [];
		expect(forC).toHaveLength(1);
		expect(forC[0]).toMatch(
			/\(“integration: away”\) was carried out\. Signed by 0x.+; you did not sign\.$/,
		);
		// the proposer is told its proposal went through
		expect(((await told(a)) ?? [])[0]).toMatch(
			/, which you proposed, was carried out\. Sent by 0x.+\.$/,
		);

		// "Got it": the marker moves to the newest entry shown, with the API wallets now known
		const mark = (await markOf(c)) as Mark;
		const next = markAfter({
			mark,
			events: (await news(c, mark)).events,
			chain: {
				ledger: null,
				agents: [{ name: "bot", address: outsider.address, validUntil: 0 }],
			},
			ledgerReadAt: null,
		});
		expect(next.eventId).toBeGreaterThan(start);
		expect((await write(c, next.eventId, next.chain)).issue).toBeNull();
		expect(await told(c)).toEqual([]);
		const after = await markOf(c);
		expect(after).toMatchObject({
			eventId: next.eventId,
			agents: [outsider.address],
		});
		// the ledger was not read, so its time stays where it was
		expect(after?.ledgerTime).toBe(begun?.ledgerTime);
		// and a's notice is as it was: a marker is each signer's own
		expect(await told(a)).toHaveLength(1);
	});

	it("tells a proposer whose proposal ran out of time", async () => {
		const p = await proposal("integration: lapsed", [a]);
		await publishProposal(a.client, a.address, publishRow(p));
		// after a's marker, before now
		await sql`update public.proposals set expires_at = now() where digest = ${p.digest}`;
		const forA = (await told(a)) ?? [];
		expect(forA.filter((t) => /“integration: lapsed”/.test(t))).toEqual([
			expect.stringMatching(
				/, which you proposed, expired before it was sent\.$/,
			),
		]);
		// c had no part in it
		expect((await told(c)) ?? []).toEqual([]);
	});

	it("is the signer's own: nobody else reads it or writes it", async () => {
		expect(
			((await listMarks(c.client)).data?.rows ?? []).length,
		).toBeGreaterThan(0);
		expect((await listMarks(b.client)).data?.rows).toEqual([]);
		expect((await listMarks(outsider.client)).data?.rows).toEqual([]);
		const top = await newest(c);
		expect(codes((await write(outsider, top)).issue)).toBe("relay.not_allowed");
		expect(
			codes(
				(
					await markRead(c.client, a.address, [
						{ network: NET, treasury, eventId: top, chain: {} },
					])
				).issue,
			),
		).toBe("relay.wrong_wallet");
	});

	it("only moves forward, never past the newest entry, and takes two at once", async () => {
		const before = (await markOf(c)) as Mark;
		const top = await newest(c);
		expect(codes((await write(c, top + 1000)).issue)).toBe(
			"relay.mark_invalid",
		);
		expect(
			codes((await write(c, top, { agents: ["nope"] } as never)).issue),
		).toBe("relay.mark_invalid");
		// an older "Got it" arriving late from another device is brought level
		expect((await write(c, 1)).issue).toBeNull();
		expect((await markOf(c))?.eventId).toBe(before.eventId);
		// two devices at the same moment: both are taken, nothing comes back
		const both = await Promise.all([write(c, top), write(c, top - 1)]);
		expect(both.map((r) => r.issue)).toEqual([null, null]);
		expect((await markOf(c))?.eventId).toBe(top);
		expect(await told(c)).toEqual([]);
		// what the marker knew of the chain is kept by a write that says nothing of it
		expect((await markOf(c))?.agents).toEqual(before.agents);
	});
});

describe("a newer send carried out before an older one", () => {
	it("is found from the older one's side, by its signers and nobody else", async () => {
		const older = await proposal("integration: older send", [a]);
		await new Promise((r) => setTimeout(r, 5));
		const newer = await proposal("integration: newer send", [a]);
		expect(newer.payload.nonce).toBeGreaterThan(older.payload.nonce);
		await publishProposal(a.client, a.address, publishRow(older));
		await publishProposal(a.client, a.address, publishRow(newer));
		expect(
			(await recordReceipt(b.client, b.address, keyOf(newer), receipt(true)))
				.issue,
		).toBeNull();

		// what the inbox reads: everything carried out since the older one's number
		const since = (w: TestWallet, nonce: number) =>
			listCarriedOutAfter(w.client, nonce).then((r) =>
				(r.data?.rows ?? []).filter((x) => x.treasury === treasury),
			);
		const done = await since(c, older.payload.nonce - 1);
		expect(done.map((r) => r.digest)).toContain(newer.digest);
		// the older one is still open, so it is not in that list itself
		expect(done.map((r) => r.digest)).not.toContain(older.digest);
		expect(
			(await since(c, newer.payload.nonce)).map((r) => r.digest),
		).not.toContain(newer.digest);
		expect(await since(outsider, 0)).toEqual([]);

		// and with the documents verified here, the older send is shut out
		const actions = [];
		for (const row of done) {
			const x = await assembleProposal(row);
			if (x.assembled)
				actions.push({ action: x.assembled.proposal.payload.action });
		}
		expect(overtakenBy(older.payload.action, actions)).not.toBeNull();
		expect(overtakenBy(newer.payload.action, [])).toBeNull();
		await withdrawProposal(a.client, a.address, keyOf(older));
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
		// no stored session: nothing to ask the relay about
		expect(await probeSession(dead)).toEqual({ status: "none" });
	});
});
