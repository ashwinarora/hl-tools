import {
	type Address,
	type Policy,
	type Proposal,
	validateSignerSet,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	A,
	B,
	C,
	makeProposal,
	NONCE,
	NOW,
	OUTSIDER,
	POLICY,
	signAs,
	TREASURY,
} from "#/test/keys";
import { partsText } from "./parts";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import {
	addEntries,
	affectedProposals,
	changeSummary,
	judgeSet,
	type OnRecord,
	parsePasted,
	SET_CODE,
	SIGNERS_MAX,
	type SignerCheck,
	sameSet,
	signerCheck,
	signerRows,
	signersField,
	thresholdLines,
	toLookUp,
	waitingProposals,
	wantedSet,
} from "./signerSet";

const D = "0x00000000000000000000000000000000000000dd" as Address;
const CHECKSUMMED = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const ok: SignerCheck = { state: "ready", role: "user", multiSig: null };
const checks = (entries: Record<string, SignerCheck>) =>
	new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
const codes = (lines: readonly { code: string }[]) => lines.map((l) => l.code);

describe("parsePasted", () => {
	it("takes one address or many, whatever stands between them", () => {
		const p = parsePasted(
			`${A}, ${B}\n  ${C};${D}\t"${CHECKSUMMED}" (${OUTSIDER}).`,
		);
		expect(p.addresses).toEqual([A, B, C, D, CHECKSUMMED, OUTSIDER]);
		expect(p.rejected).toEqual([]);
	});
	it("keeps an address once and as typed, and says what is no address", () => {
		const p = parsePasted(
			`${A} ${A.toUpperCase().replace("0X", "0x")} Bob: 0x1234 hello`,
		);
		expect(p.addresses).toEqual([A]);
		expect(p.rejected).toEqual(["Bob", "0x1234", "hello"]);
		expect(parsePasted("  \n ").addresses).toEqual([]);
	});
});

describe("addEntries", () => {
	it("adds what is new, counts what was there, and stops at ten", () => {
		expect(
			addEntries([A], [A, B, B.toUpperCase().replace("0X", "0x")]),
		).toEqual({
			entries: [A, B],
			duplicates: 2,
			overMax: 0,
		});
		const many = Array.from(
			{ length: 12 },
			(_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`,
		);
		const r = addEntries([], many);
		expect(r.entries).toHaveLength(SIGNERS_MAX);
		expect(r.overMax).toBe(2);
	});
});

describe("signerCheck", () => {
	it("reads Hyperliquid's two answers", () => {
		expect(signerCheck({ role: "user" }, null)).toEqual({
			state: "ready",
			role: "user",
			agentOf: null,
			multiSig: null,
		});
		expect(signerCheck({ role: "missing" }, null).role).toBe("missing");
		expect(
			signerCheck({ role: "agent", data: { user: TREASURY } }, null),
		).toMatchObject({
			role: "agent",
			agentOf: TREASURY,
		});
		expect(
			signerCheck({ role: "user" }, { authorizedUsers: [A, B], threshold: 2 })
				.multiSig,
		).toEqual({ threshold: 2, signers: 2 });
	});
	it("claims nothing about an answer it cannot read", () => {
		expect(signerCheck("nonsense", "nonsense")).toMatchObject({
			role: "unknown",
			multiSig: null,
		});
		expect(signerCheck({ role: "somethingNew" }, { threshold: "2" }).role).toBe(
			"unknown",
		);
		expect(
			signerCheck(null, { authorizedUsers: "x", threshold: 1 }).multiSig,
		).toBeNull();
	});
});

describe("signerRows: what stands on each row", () => {
	const rows = (
		entries: string[],
		c: Record<string, SignerCheck> = {},
		current: readonly Address[] | null = null,
	) => signerRows({ entries, self: TREASURY, checks: checks(c), current });

	it("an address in use is fine and says so", () => {
		const [r] = rows([A], { [A]: ok });
		expect(r).toMatchObject({
			address: A,
			kind: "added",
			level: "ok",
			recheck: false,
		});
		expect(codes(r?.lines ?? [])).toEqual(["signer.ok"]);
	});
	it("blocks what Hyperliquid refuses: never used, a vault, a sub-account, the account itself", () => {
		const never = rows([A], { [A]: { state: "ready", role: "missing" } })[0];
		expect(never?.level).toBe("blocked");
		expect(codes(never?.lines ?? [])).toEqual(["signer.missing"]);
		expect(never?.recheck).toBe(true);
		for (const role of ["vault", "subAccount"] as const) {
			const r = rows([A], { [A]: { state: "ready", role } })[0];
			expect(r?.level).toBe("blocked");
			expect(codes(r?.lines ?? [])).toEqual(["signer.kind"]);
			expect(r?.lines[0]?.text).toContain(
				role === "vault" ? "vault" : "sub-account",
			);
		}
		const self = rows([TREASURY.toUpperCase().replace("0X", "0x")])[0];
		expect(self?.level).toBe("blocked");
		expect(codes(self?.lines ?? [])).toEqual(["signer.self"]);
	});
	it("warns about an API wallet, a nested multi-sig and a bad checksum, without blocking", () => {
		const agent = rows([A], {
			[A]: { state: "ready", role: "agent", agentOf: TREASURY },
		})[0];
		expect(agent?.level).toBe("warning");
		expect(agent?.lines[0]?.text).toContain("API wallet of 0x");
		const anon = rows([A], { [A]: { state: "ready", role: "agent" } })[0];
		expect(anon?.lines[0]?.text).toContain("This is an API wallet.");
		const nested = rows([A], {
			[A]: {
				state: "ready",
				role: "user",
				multiSig: { threshold: 2, signers: 3 },
			},
		})[0];
		expect(nested?.level).toBe("warning");
		expect(nested?.lines[0]?.text).toContain("2 of 3");
		const typo = CHECKSUMMED.replace("5aA", "5Aa");
		const bad = rows([typo], { [typo]: ok })[0];
		expect(bad?.level).toBe("warning");
		// the look-up's answer is still said next to the warning
		expect(codes(bad?.lines ?? [])).toEqual(["signer.checksum", "signer.ok"]);
		expect(codes(nested?.lines ?? [])).toEqual(["signer.nested", "signer.ok"]);
		// in good order: nothing to say about the capitals
		expect(rows([CHECKSUMMED], { [CHECKSUMMED]: ok })[0]?.level).toBe("ok");
	});
	it("says that nobody can sign with the zero address, which Hyperliquid takes as in use", () => {
		const zero = "0x0000000000000000000000000000000000000000";
		const r = rows([zero], { [zero]: ok })[0];
		expect(r?.level).toBe("warning");
		expect(codes(r?.lines ?? [])).toEqual(["signer.zero", "signer.ok"]);
		expect(r?.lines[0]?.text).toBe(
			"This is the zero address. Nobody holds its key, so it can never sign.",
		);
	});
	it("puts the worst line first when several apply", () => {
		const typo = CHECKSUMMED.replace("5aA", "5Aa");
		const r = rows([typo], { [typo]: { state: "ready", role: "missing" } })[0];
		expect(codes(r?.lines ?? [])).toEqual([
			"signer.missing",
			"signer.checksum",
		]);
		expect(r?.level).toBe("blocked");
	});
	it("waits while Hyperliquid is asked, and claims nothing when it could not be", () => {
		expect(rows([A])[0]).toMatchObject({ level: "pending", lines: [] });
		expect(rows([A], { [A]: { state: "loading" } })[0]?.level).toBe("pending");
		const failed = rows([A], { [A]: { state: "failed" } })[0];
		expect(failed?.level).toBe("warning");
		expect(failed?.recheck).toBe(true);
		expect(codes(failed?.lines ?? [])).toEqual(["signer.unchecked"]);
		const odd = rows([A], { [A]: { state: "ready", role: "unknown" } })[0];
		expect(codes(odd?.lines ?? [])).toEqual(["signer.unchecked"]);
	});
	it("for a change: who stays, who is new, who goes", () => {
		const r = rows([A, B, D], { [D]: ok }, POLICY.authorizedUsers);
		expect(r.map((x) => [x.address, x.kind])).toEqual([
			[A, "kept"],
			[B, "kept"],
			[D, "added"],
			[C, "removed"],
		]);
		// a signer who stays is one already: nothing is asked and nothing said
		expect(r[0]).toMatchObject({ level: "ok", lines: [] });
		expect(codes(r[3]?.lines ?? [])).toEqual(["signer.removed"]);
	});
});

describe("toLookUp", () => {
	it("asks only about addresses that would be new signers, each once", () => {
		expect(
			toLookUp(
				[A, D, D.toUpperCase().replace("0X", "0x"), TREASURY, OUTSIDER],
				TREASURY,
				POLICY.authorizedUsers,
			),
		).toEqual([D, OUTSIDER]);
		expect(toLookUp([A, B], TREASURY)).toEqual([A, B]);
	});
});

describe("judgeSet: the set as a whole", () => {
	const all = checks({ [A]: ok, [B]: ok, [C]: ok, [D]: ok });
	const judge = (over: Partial<Parameters<typeof judgeSet>[0]> = {}) =>
		judgeSet({
			entries: [A, B, C],
			threshold: 2,
			self: TREASURY,
			checks: all,
			...over,
		});

	it("lets a sound set through", () => {
		expect(judge()).toEqual({
			lines: [],
			blockedBy: null,
			unchanged: false,
			pending: false,
		});
	});
	it("is blocked until there is a list and a number", () => {
		expect(judge({ entries: [], threshold: null }).blockedBy).toBe(
			"Add at least one signer.",
		);
		expect(judge({ threshold: null }).blockedBy).toBe(
			"Choose how many must sign.",
		);
		expect(judge({ threshold: 4 }).blockedBy).toBe(
			"Choose how many must sign.",
		);
	});
	it("is blocked by a row Hyperliquid would refuse, naming it", () => {
		const j = judge({
			checks: checks({
				[A]: ok,
				[B]: { state: "ready", role: "missing" },
				[C]: ok,
			}),
		});
		expect(j.blockedBy).toContain("Never used on Hyperliquid");
		expect(j.blockedBy).toContain("…");
		expect(judge({ entries: [A, TREASURY], threshold: 1 }).blockedBy).toContain(
			"cannot be its own signer",
		);
	});
	it("waits for look-ups that have not answered", () => {
		expect(judge({ checks: checks({ [A]: ok }) }).pending).toBe(true);
	});
	it("warns, without blocking, when every signer is needed", () => {
		const j = judge({ threshold: 3 });
		expect(j.blockedBy).toBeNull();
		expect(codes(j.lines)).toEqual(["lockout.all_keys_required"]);
		expect(j.lines[0]?.level).toBe("warning");
	});
	it("for a change: nothing changed yet, removing yourself, handing over", () => {
		const same = judge({ current: POLICY });
		expect(same.unchanged).toBe(true);
		expect(same.blockedBy).toBeNull();
		const leaving = judge({ entries: [B, C, D], current: POLICY, me: A });
		expect(codes(leaving.lines)).toEqual(["signers.self_removed"]);
		expect(leaving.unchanged).toBe(false);
		// somebody else is removed: nothing to say to me
		expect(judge({ entries: [A, B, D], current: POLICY, me: A }).lines).toEqual(
			[],
		);
		const handover = judge({
			entries: [D, OUTSIDER],
			threshold: 1,
			current: POLICY,
			checks: checks({ [D]: ok, [OUTSIDER]: ok }),
		});
		expect(codes(handover.lines)).toContain("lockout.all_current_removed");
		const submitter = judge({ entries: [A, B, D], current: POLICY, leader: C });
		expect(submitter.lines).toEqual([
			expect.objectContaining({
				code: "lockout.leader_removed",
				level: "shown",
			}),
		]);
	});
	it("gives every finding of the core a place", () => {
		// each code the core's validation can produce, provoked once
		const found = new Set<string>();
		const collect = (
			set: { authorizedUsers: Address[]; threshold: number },
			ctx: Parameters<typeof validateSignerSet>[1],
		) => {
			for (const i of validateSignerSet(set, ctx)) found.add(i.code);
		};
		const eleven = Array.from(
			{ length: 11 },
			(_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as Address,
		);
		collect({ authorizedUsers: [], threshold: 0 }, { self: TREASURY });
		collect({ authorizedUsers: eleven, threshold: 1 }, { self: TREASURY });
		collect(
			{ authorizedUsers: [A, TREASURY], threshold: 2 },
			{ self: TREASURY },
		);
		collect(
			{ authorizedUsers: [A, B], threshold: 1 },
			{
				self: TREASURY,
				exists: (a) => (a === A ? false : undefined),
				isMultiSig: () => true,
				leader: C,
				lostKeys: [A, B],
				current: { ...POLICY, authorizedUsers: [C], threshold: 1 },
			},
		);
		collect(
			{ authorizedUsers: [...POLICY.authorizedUsers], threshold: 2 },
			{
				self: TREASURY,
				current: POLICY,
			},
		);
		expect([...found].sort()).toEqual(Object.keys(SET_CODE).sort());
	});
});

describe("thresholdLines: what a number means", () => {
	it("says nothing until there is a number that fits", () => {
		expect(thresholdLines(3, null)).toBeNull();
		expect(thresholdLines(0, 1)).toBeNull();
		expect(thresholdLines(3, 0)).toBeNull();
		expect(thresholdLines(3, 4)).toBeNull();
	});
	it("for three signers", () => {
		expect(thresholdLines(3, 1)).toEqual({
			summary: "Any one of the 3 signers can act alone.",
			stolen: "Stolen keys: 1 key is enough to take everything.",
			lost: "Lost keys: with 2 lost it still works. With 3 lost it is locked for good.",
			warning: "Any one signer alone controls everything.",
		});
		expect(thresholdLines(3, 2)).toEqual({
			summary: "Any 2 of the 3 signers can act.",
			stolen: "Stolen keys: 1 is not enough to move anything. 2 are.",
			lost: "Lost keys: with 1 lost it still works. With 2 lost it is locked for good.",
			warning: null,
		});
		expect(thresholdLines(3, 3)).toEqual({
			summary: "All 3 signers must sign every time.",
			stolen: "Stolen keys: 2 are not enough to move anything. 3 are.",
			lost: "Lost keys: 1 lost key locks it for good.",
			warning:
				"One lost key locks the account for good. Hyperliquid has no recovery.",
		});
	});
	it("for one signer, and for every size up to ten", () => {
		expect(thresholdLines(1, 1)?.warning).toContain("only changes which key");
		for (let n = 2; n <= SIGNERS_MAX; n++) {
			for (let k = 1; k <= n; k++) {
				const t = thresholdLines(n, k);
				expect(t, `${k} of ${n}`).not.toBeNull();
				expect(t?.warning === null).toBe(k > 1 && k < n);
				for (const text of [t?.summary, t?.stolen, t?.lost, t?.warning ?? ""])
					for (const claim of FORBIDDEN_CLAIMS) expect(text).not.toMatch(claim);
			}
		}
	});
});

describe("changeSummary", () => {
	const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
	it("says who goes, who comes, and what the number does", () => {
		const parts = changeSummary(POLICY, {
			authorizedUsers: [A, B, D].sort(),
			threshold: 2,
		});
		expect(partsText(parts)).toBe(
			`${short(C)} is removed · ${short(D)} is added · still 2 of 3`,
		);
		// the addresses are parts a screen can show by nickname
		expect(parts.filter((p) => p.who).map((p) => p.who)).toEqual([C, D]);
		expect(
			partsText(
				changeSummary(POLICY, {
					authorizedUsers: POLICY.authorizedUsers,
					threshold: 3,
				}),
			),
		).toBe("2 of 3 becomes 3 of 3");
		expect(
			partsText(
				changeSummary(POLICY, { authorizedUsers: [A, B], threshold: 2 }),
			),
		).toBe(`${short(C)} is removed · 2 of 3 becomes 2 of 2`);
	});
	it("says so when the account stops being a multi-sig", () => {
		expect(partsText(changeSummary(POLICY, null))).toContain(
			"no signers any more",
		);
	});
});

describe("sameSet", () => {
	it("is true for the same signers and number in any order", () => {
		expect(sameSet(POLICY, { authorizedUsers: [C, A, B], threshold: 2 })).toBe(
			true,
		);
		expect(sameSet(POLICY, { authorizedUsers: [A, B, C], threshold: 3 })).toBe(
			false,
		);
		expect(sameSet(POLICY, { authorizedUsers: [A, B], threshold: 2 })).toBe(
			false,
		);
		expect(sameSet(POLICY, { authorizedUsers: [A, B, D], threshold: 2 })).toBe(
			false,
		);
	});
});

describe("waiting proposals and what a change does to them", () => {
	const record = (p: Proposal, over: Partial<OnRecord> = {}): OnRecord => ({
		digest: p.digest,
		title: p.meta.title ?? "",
		proposal: p,
		status: "open",
		accepted: false,
		...over,
	});
	const now = NOW;

	it("waitingProposals keeps what can still be submitted", () => {
		const p = makeProposal();
		const refused: Proposal = {
			...p,
			receipt: {
				httpStatus: 200,
				response: { status: "err", response: "Multi-sig threshold not met" },
			} as never,
		};
		const list = [
			record(p),
			record(p, { status: null }),
			record(p, { accepted: true }),
			record(p, { status: "withdrawn" }),
			record(p, { status: "carried_out" }),
			record(refused),
		];
		expect(waitingProposals(list, now)).toEqual([list[0], list[1]]);
		// two days after its number the window has closed
		expect(waitingProposals(list, NONCE + 3 * 86_400_000)).toEqual([]);
	});

	it("a removed signer's signature stops counting; a removed submitter cannot submit", async () => {
		const signedByC = await signAs(
			makeProposal({ leader: B, title: "pay the auditor" }),
			3,
		);
		const ledByC = await signAs(
			makeProposal({ leader: C, title: "withdraw" }),
			1,
		);
		const untouched = await signAs(
			makeProposal({ leader: B, title: "other" }),
			1,
		);
		const next = { authorizedUsers: [A, B, D].sort(), threshold: 2 };
		const out = await affectedProposals(
			[record(signedByC), record(ledByC), record(untouched)],
			POLICY,
			next,
		);
		expect(out.map((a) => [a.title, a.effects])).toEqual([
			["pay the auditor", ["loses-signature"]],
			["withdraw", ["cannot-submit"]],
		]);
		expect(out[0]).toMatchObject({ lost: [C], have: 0, need: 2 });
		expect(partsText(out[0]?.parts ?? [])).toMatch(
			/loses the signature of 0x.*: 0 of 2 left/,
		);
		expect(partsText(out[1]?.parts ?? [])).toMatch(
			/can no longer be submitted: 0x.* was to submit it/,
		);
	});

	it("a higher number leaves a ready proposal short; a lower one makes another ready", async () => {
		const two = await signAs(
			await signAs(makeProposal({ title: "ready" }), 1),
			2,
		);
		const one = await signAs(makeProposal({ title: "half" }), 1);
		const raised = await affectedProposals([record(two), record(one)], POLICY, {
			authorizedUsers: POLICY.authorizedUsers,
			threshold: 3,
		});
		expect(raised.map((a) => [a.title, a.effects, a.have, a.need])).toEqual([
			["ready", ["falls-short"], 2, 3],
		]);
		expect(partsText(raised[0]?.parts ?? [])).toBe(
			"no longer has enough signatures: 2 of 3",
		);
		const lowered = await affectedProposals(
			[record(two), record(one)],
			POLICY,
			{ authorizedUsers: POLICY.authorizedUsers, threshold: 1 },
		);
		expect(lowered.map((a) => [a.title, a.effects])).toEqual([
			["half", ["becomes-ready"]],
		]);
		expect(partsText(lowered[0]?.parts ?? [])).toBe(
			"becomes ready to submit: 1 of 1",
		);
	});

	it("several things can happen to one proposal, and the change itself is left out", async () => {
		// signed by C and to be submitted by C, and C goes
		const both = await signAs(makeProposal({ leader: C, title: "both" }), 3);
		const change = makeProposal({ leader: A, title: "the change" });
		const out = await affectedProposals(
			[record(both), record(change)],
			POLICY,
			{ authorizedUsers: [A, B], threshold: 2 },
			change.digest,
		);
		expect(out).toHaveLength(1);
		expect(out[0]?.effects).toEqual(["cannot-submit", "loses-signature"]);
		expect(partsText(out[0]?.parts ?? [])).toContain(" · ");
	});

	it("a proposal whose submitter was never a signer is not called unsubmittable", async () => {
		const odd = await signAs(
			makeProposal({ leader: OUTSIDER, title: "odd" }),
			1,
		);
		expect(
			await affectedProposals([record(odd)], POLICY, {
				authorizedUsers: [A, B],
				threshold: 2,
			}),
		).toEqual([]);
	});

	it("converting back ends every waiting proposal", async () => {
		const p = await signAs(makeProposal({ title: "pending" }), 1);
		const out = await affectedProposals([record(p)], POLICY, null);
		expect(out).toEqual([
			expect.objectContaining({
				title: "pending",
				effects: ["ends"],
				lost: [A],
			}),
		]);
		expect(partsText(out[0]?.parts ?? [])).toBe("can no longer be submitted");
	});
});

describe("the sentences", () => {
	it("promise nothing the product does not provide", () => {
		const policy: Policy = POLICY;
		const texts = [
			...judgeSet({
				entries: [D],
				threshold: 1,
				self: TREASURY,
				checks: checks({ [D]: ok }),
				current: policy,
				me: A,
				leader: C,
			}).lines.map((l) => l.text),
			...signerRows({
				entries: [A, B, C, TREASURY],
				self: TREASURY,
				checks: checks({
					[A]: { state: "ready", role: "missing" },
					[B]: { state: "ready", role: "agent" },
					[C]: { state: "failed" },
				}),
			}).flatMap((r) => r.lines.map((l) => l.text)),
		];
		expect(texts.length).toBeGreaterThan(5);
		for (const t of texts) {
			expect(t).toMatch(/^[A-Z].*\.$/);
			for (const claim of FORBIDDEN_CLAIMS) expect(t).not.toMatch(claim);
		}
	});
});

describe("the form's one field", () => {
	const NOW_SET = { authorizedUsers: [A, B, C].sort(), threshold: 2 };

	it("stands for the treasury's own signers while it is untouched", () => {
		expect(wantedSet("", NOW_SET)).toEqual({
			revert: false,
			entries: NOW_SET.authorizedUsers,
			threshold: 2,
		});
		// nothing read yet: nothing to start from
		expect(wantedSet("  ", null)).toEqual({
			revert: false,
			entries: [],
			threshold: null,
		});
	});

	it("reads back exactly what it wrote, lowercased, sorted, each address once", () => {
		const upper = `0x${D.slice(2).toUpperCase()}`;
		const field = signersField([C, upper, A, D], 3);
		expect(field).toBe(
			JSON.stringify({ authorizedUsers: [A, C, D].sort(), threshold: 3 }),
		);
		expect(wantedSet(field, NOW_SET)).toEqual({
			revert: false,
			entries: [A, C, D].sort(),
			threshold: 3,
		});
	});

	it("keeps a cleared number cleared", () => {
		const field = signersField([A, B], null);
		expect(field).toContain('"threshold":0');
		expect(wantedSet(field, NOW_SET).threshold).toBeNull();
	});

	it("knows the conversion back, and starts over from a string no form made", () => {
		expect(wantedSet("null", NOW_SET)).toEqual({
			revert: true,
			entries: [],
			threshold: null,
		});
		expect(wantedSet("{not json", NOW_SET).entries).toEqual(
			NOW_SET.authorizedUsers,
		);
	});
});
