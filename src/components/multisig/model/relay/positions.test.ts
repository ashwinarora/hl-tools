import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import type { Part } from "../parts";
import { FORBIDDEN_CLAIMS } from "./copy";
import {
	blockedTag,
	blockedText,
	type Objection,
	objectionLine,
	objectionNote,
	ownPosition,
	saidNo,
	saidNoTag,
	standing,
} from "./positions";

const w = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const ALICE = w(0xa1);
const BOB = w(0xb0);
const CAROL = w(0xca);
const DAVE = w(0xda);
const NAMES: Record<string, string> = {
	[ALICE]: "Alice",
	[BOB]: "Bob",
	[CAROL]: "Carol",
	[DAVE]: "Dave",
};
/** A sentence as a screen with nicknames would show it. */
const read = (parts: readonly Part[] | null) =>
	(parts ?? [])
		.map((p) =>
			p.who && p.text !== "you" && p.text !== "You"
				? (NAMES[p.who] ?? p.text)
				: p.text,
		)
		.join("");

const NOW = Date.UTC(2026, 9, 13, 10, 20);
const HOUR = 3_600_000;
const no = (signer: Address, hoursAgo = 2): Objection => ({
	signer,
	at: NOW - hoursAgo * HOUR,
});
/** Tue 14 Oct 2026, 16:20 UTC: one day and six hours after NOW. */
const LAPSES = NOW + 30 * HOUR;

describe("where a proposal stands once somebody has said no", () => {
	it("is still open to pass while enough signers have not said no", () => {
		const s = standing({
			signers: [ALICE, BOB, CAROL],
			threshold: 2,
			finaliser: BOB,
			objections: [no(CAROL)],
		});
		expect(s).toMatchObject({ left: 2, threshold: 2, blocked: null });
		expect(s.objected.map((o) => o.signer)).toEqual([CAROL]);
		expect(saidNo(s, CAROL)).toBe(true);
		expect(saidNo(s, ALICE)).toBe(false);
		expect(saidNo(s, null)).toBe(false);
	});

	it("cannot pass once the signers left are fewer than must sign", () => {
		const s = standing({
			signers: [ALICE, BOB, CAROL, DAVE],
			threshold: 3,
			finaliser: BOB,
			objections: [no(CAROL), no(DAVE, 1)],
		});
		expect(s).toMatchObject({ left: 2, blocked: "cannot-pass" });
	});

	it("cannot be submitted once its finaliser said no, however many are left", () => {
		const s = standing({
			signers: [ALICE, BOB, CAROL, DAVE],
			threshold: 2,
			finaliser: BOB,
			objections: [no(BOB)],
		});
		expect(s).toMatchObject({ left: 3, blocked: "finaliser-no" });
	});

	it("says the stronger thing when both hold", () => {
		const s = standing({
			signers: [ALICE, BOB, CAROL],
			threshold: 2,
			finaliser: BOB,
			objections: [no(BOB), no(CAROL)],
		});
		expect(s.blocked).toBe("cannot-pass");
	});

	it("counts a no only from somebody who is a signer now, and once", () => {
		const s = standing({
			signers: [ALICE, BOB, CAROL],
			threshold: 2,
			finaliser: BOB,
			// Dave was removed from the treasury; Carol's row came twice
			objections: [no(DAVE), no(CAROL, 3), no(CAROL, 1)],
		});
		expect(s.objected).toEqual([no(CAROL, 3)]);
		expect(s).toMatchObject({ left: 2, blocked: null });
		// a finaliser who is no longer a signer blocks nothing by a no
		expect(
			standing({
				signers: [ALICE, CAROL],
				threshold: 1,
				finaliser: BOB,
				objections: [no(BOB)],
			}).blocked,
		).toBeNull();
	});

	it("is never held up by numbers alone: with nobody against it, nothing is said", () => {
		// a signer list that does not add up (not read yet, or a stored copy that
		// is out of step) is somebody else's message, never "cannot pass"
		for (const [signers, threshold] of [
			[[], 2],
			[[ALICE], 2],
			[[ALICE, BOB], 3],
			[[ALICE, BOB], 0],
		] as const) {
			const s = standing({
				signers,
				threshold,
				finaliser: BOB,
				objections: [],
			});
			expect(s.blocked).toBeNull();
			expect(s.objected).toEqual([]);
		}
		// and a no from somebody who is not a signer changes nothing about that
		expect(
			standing({
				signers: [ALICE],
				threshold: 2,
				finaliser: BOB,
				objections: [{ signer: CAROL, at: 1 }],
			}).blocked,
		).toBeNull();
	});

	it("holds for every treasury size: blocked exactly when the signers left cannot reach the number", () => {
		let checked = 0;
		for (let n = 1; n <= 10; n++) {
			const signers = Array.from({ length: n }, (_, i) => w(i + 1));
			const finaliser = signers[0] as Address;
			for (let k = 1; k <= n; k++) {
				for (let against = 0; against <= n; against++) {
					for (const withFinaliser of [false, true]) {
						// the objectors: the last `against` signers, or the first ones (the finaliser among them)
						const who = withFinaliser
							? signers.slice(0, against)
							: signers.slice(n - against);
						const s = standing({
							signers,
							threshold: k,
							finaliser,
							objections: who.map((a, i) => ({ signer: a, at: i })),
						});
						const finaliserSaidNo = who.includes(finaliser);
						expect(s.left).toBe(n - against);
						expect(s.blocked, `${k} of ${n}, ${against} against`).toBe(
							n - against < k
								? "cannot-pass"
								: finaliserSaidNo
									? "finaliser-no"
									: null,
						);
						// a no never does more than that: nobody against it, nothing is blocked
						if (against === 0) expect(s.blocked).toBeNull();
						checked++;
					}
				}
			}
		}
		expect(checked).toBe(880);
	});
});

describe("the sentences, as approved", () => {
	const three = [ALICE, BOB, CAROL];

	it("one signer said no and it can still pass", () => {
		const s = standing({
			signers: three,
			threshold: 2,
			finaliser: BOB,
			objections: [no(CAROL)],
		});
		expect(
			read(
				objectionLine({
					standing: s,
					signed: [],
					signers: three,
					me: null,
					now: NOW,
				}),
			),
		).toBe(
			"Carol said no, 2 hours ago. It can still go ahead if Alice and Bob sign.",
		);
		// with Alice's signature already there, only Bob's is still needed
		expect(
			read(
				objectionLine({
					standing: s,
					signed: [ALICE],
					signers: three,
					me: null,
					now: NOW,
				}),
			),
		).toBe("Carol said no, 2 hours ago. It can still go ahead if Bob signs.");
		// read by Bob
		expect(
			read(
				objectionLine({
					standing: s,
					signed: [ALICE],
					signers: three,
					me: BOB,
					now: NOW,
				}),
			),
		).toBe("Carol said no, 2 hours ago. It can still go ahead if you sign.");
		// already ready: the no changes nothing about that
		expect(
			read(
				objectionLine({
					standing: s,
					signed: [ALICE, BOB],
					signers: three,
					me: null,
					now: NOW,
				}),
			),
		).toBe(
			"Carol said no, 2 hours ago. It can still go ahead: 2 signers have signed, and 2 must.",
		);
	});

	it("more can still sign than are needed", () => {
		const four = [ALICE, BOB, CAROL, DAVE];
		const s = standing({
			signers: four,
			threshold: 2,
			finaliser: BOB,
			objections: [no(DAVE)],
		});
		expect(
			read(
				objectionLine({
					standing: s,
					signed: [],
					signers: four,
					me: null,
					now: NOW,
				}),
			),
		).toBe(
			"Dave said no, 2 hours ago. It can still go ahead if 2 of the 3 signers who have not signed yet do.",
		);
	});

	it("too many said no", () => {
		const s = standing({
			signers: [ALICE, BOB, CAROL, DAVE],
			threshold: 3,
			finaliser: BOB,
			objections: [no(CAROL), no(DAVE, 1)],
		});
		const t = blockedText({
			standing: s,
			finaliser: BOB,
			me: null,
			lapsesAt: LAPSES,
			now: NOW,
		});
		expect(read(t?.headline ?? null)).toBe("Cannot pass as things stand");
		expect(read(t?.detail ?? null)).toBe(
			"Carol and Dave said no, so only 2 signers are left and 3 must sign. It goes ahead only if one of them changes their mind. Otherwise it lapses on 2026-10-14 16:20 UTC, in 1 day 6 hours.",
		);
		// the moment is a part of its own, so a screen shows it in the reader's zone
		expect(t?.detail.find((p) => p.when !== undefined)?.when).toBe(LAPSES);
	});

	it("too many said no, in other numbers", () => {
		const one = blockedText({
			standing: standing({
				signers: [ALICE, BOB],
				threshold: 2,
				finaliser: BOB,
				objections: [no(ALICE)],
			}),
			finaliser: BOB,
			me: null,
			lapsesAt: LAPSES,
			now: NOW,
		});
		expect(read(one?.detail ?? null)).toBe(
			"Alice said no, so only 1 signer is left and 2 must sign. It goes ahead only if Alice changes their mind. Otherwise it lapses on 2026-10-14 16:20 UTC, in 1 day 6 hours.",
		);
		const all = blockedText({
			standing: standing({
				signers: [ALICE, BOB, CAROL],
				threshold: 3,
				finaliser: BOB,
				objections: [no(ALICE), no(BOB), no(CAROL)],
			}),
			finaliser: BOB,
			me: CAROL,
			lapsesAt: LAPSES,
			now: NOW,
		});
		expect(read(all?.detail ?? null)).toBe(
			"Alice, Bob and you said no, so no signer is left and 3 must sign. It goes ahead only if 3 of you change your minds. Otherwise it lapses on 2026-10-14 16:20 UTC, in 1 day 6 hours.",
		);
		const mine = blockedText({
			standing: standing({
				signers: [ALICE, BOB],
				threshold: 2,
				finaliser: BOB,
				objections: [no(ALICE)],
			}),
			finaliser: BOB,
			me: ALICE,
			lapsesAt: LAPSES,
			now: NOW,
		});
		expect(read(mine?.detail ?? null)).toMatch(
			/^You said no, so only 1 signer is left and 2 must sign\. It goes ahead only if you change your mind\./,
		);
	});

	it("speaks to the reader who is one of those who said no, not about them", () => {
		// found in the browser: "…and you said no… only if one of them changes their mind"
		const s = standing({
			signers: three,
			threshold: 2,
			finaliser: ALICE,
			objections: [no(BOB), no(CAROL, 1)],
		});
		const asCarol = blockedText({
			standing: s,
			finaliser: ALICE,
			me: CAROL,
			lapsesAt: LAPSES,
			now: NOW,
		});
		expect(read(asCarol?.detail ?? null)).toMatch(
			/^Bob and you said no, so only 1 signer is left and 2 must sign\. It goes ahead only if one of you changes your mind\./,
		);
		// somebody who did not say no reads about the others
		const asAlice = blockedText({
			standing: s,
			finaliser: ALICE,
			me: ALICE,
			lapsesAt: LAPSES,
			now: NOW,
		});
		expect(read(asAlice?.detail ?? null)).toMatch(
			/^Bob and Carol said no, .* only if one of them changes their mind\./,
		);
	});

	it("never tells a no in the future, however the clocks stand", () => {
		// The relay stamps a no with its own clock, and a page reads its clock
		// only every so often: found in the browser as "You said no, in less
		// than a minute." right after the click.
		const ahead = { signer: CAROL, at: NOW + 20_000 };
		const s = standing({
			signers: three,
			threshold: 2,
			finaliser: BOB,
			objections: [ahead],
		});
		expect(
			read(ownPosition({ standing: s, me: CAROL, finaliser: BOB, now: NOW })),
		).toBe("You said no, less than a minute ago.");
		expect(read(objectionNote(s, ALICE, NOW))).toBe(
			"Carol said no to this, less than a minute ago.",
		);
		expect(
			read(
				objectionLine({
					standing: s,
					signed: [],
					signers: three,
					me: null,
					now: NOW,
				}),
			),
		).toMatch(/^Carol said no, less than a minute ago\./);
		// at the very moment, too
		const same = standing({
			signers: three,
			threshold: 2,
			finaliser: BOB,
			objections: [{ signer: CAROL, at: NOW }],
		});
		expect(
			read(
				ownPosition({ standing: same, me: CAROL, finaliser: BOB, now: NOW }),
			),
		).toBe("You said no, less than a minute ago.");
	});

	it("the finaliser said no", () => {
		const s = standing({
			signers: three,
			threshold: 2,
			finaliser: BOB,
			objections: [no(BOB)],
		});
		const others = blockedText({
			standing: s,
			finaliser: BOB,
			me: ALICE,
			lapsesAt: LAPSES,
			now: NOW,
		});
		expect(read(others?.headline ?? null)).toBe(
			"Cannot be submitted as things stand",
		);
		// no "he" or "she": the page knows an address, not a person
		expect(read(others?.detail ?? null)).toBe(
			"Bob said no, and Bob is the one who has to submit this proposal. It goes ahead only if Bob changes their mind. To have someone else submit it, propose it again with a different finaliser. Otherwise it lapses on 2026-10-14 16:20 UTC, in 1 day 6 hours.",
		);
		expect(
			read(ownPosition({ standing: s, me: BOB, finaliser: BOB, now: NOW })),
		).toBe(
			"You said no. You are the one who has to submit this, so it cannot go ahead unless you change your mind.",
		);
		const self = blockedText({
			standing: s,
			finaliser: BOB,
			me: BOB,
			lapsesAt: LAPSES,
			now: NOW,
		});
		expect(read(self?.detail ?? null)).toMatch(
			/^You said no, and you are the one who has to submit this proposal\. It goes ahead only if you change your mind\./,
		);
	});

	it("what the one who said no reads, and the line above Sign and Submit", () => {
		const s = standing({
			signers: three,
			threshold: 2,
			finaliser: BOB,
			objections: [no(CAROL)],
		});
		expect(
			read(ownPosition({ standing: s, me: CAROL, finaliser: BOB, now: NOW })),
		).toBe("You said no, 2 hours ago.");
		expect(
			ownPosition({ standing: s, me: ALICE, finaliser: BOB, now: NOW }),
		).toBeNull();
		expect(read(objectionNote(s, ALICE, NOW))).toBe(
			"Carol said no to this, 2 hours ago.",
		);
		// one's own no is not repeated as a note to oneself
		expect(objectionNote(s, CAROL, NOW)).toBeNull();
		const two = standing({
			signers: [ALICE, BOB, CAROL, DAVE],
			threshold: 2,
			finaliser: BOB,
			objections: [no(CAROL), no(DAVE, 1)],
		});
		expect(read(objectionNote(two, ALICE, NOW))).toBe(
			"Carol and Dave said no to this.",
		);
		expect(read(objectionNote(two, DAVE, NOW))).toBe(
			"Carol said no to this, 2 hours ago.",
		);
	});

	it("nothing is said where nobody said no", () => {
		const s = standing({
			signers: three,
			threshold: 2,
			finaliser: BOB,
			objections: [],
		});
		expect(
			objectionLine({
				standing: s,
				signed: [],
				signers: three,
				me: null,
				now: NOW,
			}),
		).toBeNull();
		expect(objectionNote(s, ALICE, NOW)).toBeNull();
		expect(
			blockedText({
				standing: s,
				finaliser: BOB,
				me: null,
				lapsesAt: LAPSES,
				now: NOW,
			}),
		).toBeNull();
	});

	it("the tags in a list", () => {
		expect(blockedTag("cannot-pass")).toBe("cannot pass");
		expect(blockedTag("finaliser-no")).toBe("finaliser said no");
		expect(saidNoTag(1, false)).toBe("1 said no");
		expect(saidNoTag(1, true)).toBe("you said no");
		expect(saidNoTag(3, true)).toBe("3 said no");
	});

	it('says "said no" throughout, never a word that sounds final, and promises nothing', () => {
		const s = standing({
			signers: [ALICE, BOB, CAROL, DAVE],
			threshold: 3,
			finaliser: BOB,
			objections: [no(BOB), no(DAVE, 1)],
		});
		const all = [
			read(
				objectionLine({
					standing: s,
					signed: [],
					signers: [ALICE, BOB, CAROL, DAVE],
					me: null,
					now: NOW,
				}),
			),
			read(objectionNote(s, ALICE, NOW)),
			read(ownPosition({ standing: s, me: BOB, finaliser: BOB, now: NOW })),
			...["cannot-pass", "finaliser-no"].flatMap((_, i) => {
				const st = standing({
					signers: [ALICE, BOB, CAROL, DAVE],
					threshold: i === 0 ? 3 : 2,
					finaliser: BOB,
					objections: i === 0 ? [no(BOB), no(DAVE)] : [no(BOB)],
				});
				const t = blockedText({
					standing: st,
					finaliser: BOB,
					me: null,
					lapsesAt: LAPSES,
					now: NOW,
				});
				return [read(t?.headline ?? null), read(t?.detail ?? null)];
			}),
			blockedTag("cannot-pass"),
			blockedTag("finaliser-no"),
			saidNoTag(2, false),
		];
		for (const text of all) {
			expect(text).not.toMatch(
				/declin|reject|veto|cancel|block|\bhe\b|\bshe\b|\bhis\b|\bher\b/i,
			);
			for (const claim of FORBIDDEN_CLAIMS) expect(text).not.toMatch(claim);
		}
	});
});
