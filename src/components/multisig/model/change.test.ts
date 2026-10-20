import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	agentsStayLine,
	CHANGE,
	changeLines,
	convertBackLines,
} from "./change";
import { HELP_JARGON } from "./help";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

describe("the Change signers form's sentences", () => {
	const texts = [
		...Object.values(CHANGE).flatMap((v) => (typeof v === "string" ? [v] : [])),
		CHANGE.whoDecides(2, 3),
		CHANGE.whoDecides(3, 3),
		CHANGE.whoDecides(1, 1),
		CHANGE.backWaiting(1),
		CHANGE.backWaiting(3),
		...convertBackLines({
			agents: [{ name: "bot", validUntil: 10 }],
			now: 1,
		}).map((l) => l.text),
		...convertBackLines({ agents: null, now: 1 }).map((l) => l.text),
		agentsStayLine(
			[{ name: "bot", address: "0x01" as never, validUntil: 10 }],
			1,
		)?.text ?? "",
		changeLines({
			next: { authorizedUsers: [], threshold: 1 },
			current: { authorizedUsers: [], threshold: 1, observedAt: 0 },
			self: "0x01",
			checks: new Map(),
			me: null,
			leader: "0x01",
			agents: null,
			now: 1,
		}).blockedBy ?? "",
	];
	it("promise nothing the product does not provide, in plain words", () => {
		for (const t of texts) {
			for (const claim of FORBIDDEN_CLAIMS)
				expect(t, `${claim} in "${t}"`).not.toMatch(claim);
			for (const word of HELP_JARGON)
				expect(t, `${word} in "${t}"`).not.toMatch(word);
		}
	});
	it("say who decides, by the number that holds now", () => {
		expect(CHANGE.whoDecides(2, 3)).toBe(
			"The current signers decide this: any 2 of the 3.",
		);
		expect(CHANGE.whoDecides(3, 3)).toContain("all 3 of them");
		expect(CHANGE.whoDecides(1, 1)).toContain("the one signer");
	});
	it("warns about the account's own key every time, and blocks nothing", () => {
		const plain = convertBackLines({ agents: [], now: 1 });
		expect(plain.map((l) => [l.level, l.code])).toEqual([
			["warning", "back.key"],
			["shown", "back.holds"],
		]);
		expect(plain[0]?.text).toContain("locked for good");
	});
	it("names the API wallets that keep working, and says when they could not be read", () => {
		const live = convertBackLines({
			agents: [
				{ name: "bot", validUntil: 10 },
				{ name: "old", validUntil: 0 },
				{ name: "", validUntil: 10 },
			],
			now: 1,
		});
		expect(live.find((l) => l.code === "back.agents")?.text).toContain(
			'2 API wallets ("bot", "unnamed") keep acting for the account afterwards',
		);
		expect(
			convertBackLines({ agents: null, now: 1 }).map((l) => l.code),
		).toContain("back.agents_unread");
	});
	it("counts the waiting proposals that end", () => {
		expect(CHANGE.backWaiting(0)).toBe("");
		expect(CHANGE.backWaiting(1)).toBe(
			"1 waiting proposal can no longer be sent afterwards.",
		);
		expect(CHANGE.backWaiting(2)).toContain("2 waiting proposals");
	});
});

describe("a signer change, as every co-signer reads it (decision D3, audit F-092, F-023)", () => {
	const ZERO = "0x0000000000000000000000000000000000000000" as Address;
	const SELF = "0x00000000000000000000000000000000000000aa";
	const A = "0x00000000000000000000000000000000000000a1" as Address;
	const B = "0x00000000000000000000000000000000000000b2" as Address;
	const C = "0x00000000000000000000000000000000000000c3" as Address;
	const current = { authorizedUsers: [A, B, C], threshold: 2, observedAt: 0 };
	const base = {
		current,
		self: SELF,
		checks: new Map(),
		me: A,
		leader: A,
		agents: [],
		now: 1_000,
	};
	const texts = (r: { lines: readonly { text: string }[] }) =>
		r.lines.map((l) => l.text);

	it("says that a list nobody can sign for locks the treasury for good, and that it hands the treasury over", () => {
		const r = changeLines({
			...base,
			next: { authorizedUsers: [ZERO], threshold: 1 },
		});
		expect(texts(r)).toContain(
			"Nobody could ever sign for this treasury: everything in it would be locked for good.",
		);
		expect(texts(r)).toContain(
			"None of the current signers remain. This hands the treasury over.",
		);
		expect(texts(r)).toContain(
			"You are removing yourself. After this you cannot sign for this treasury or see its proposals.",
		);
		expect(r.lines.every((l) => l.level === "warning")).toBe(true);
	});

	it("turns signing off only for a change Hyperliquid would not take", () => {
		expect(
			changeLines({ ...base, next: { authorizedUsers: [A, B], threshold: 3 } })
				.blockedBy,
		).toBe("This asks for 3 of 2 signers, which Hyperliquid cannot take.");
		expect(
			changeLines({ ...base, next: { authorizedUsers: [A, B], threshold: 2 } })
				.blockedBy,
		).toBeNull();
	});

	it("says that approved API wallets keep acting, only when there are some", () => {
		const next = { authorizedUsers: [A, B], threshold: 1 };
		expect(texts(changeLines({ ...base, next })).join(" ")).not.toContain(
			"API wallet",
		);
		const withBot = changeLines({
			...base,
			next,
			agents: [{ name: "qa-bot", address: C, validUntil: 5_000 }],
		});
		expect(texts(withBot)).toContainEqual(
			expect.stringContaining(
				'1 API wallet ("qa-bot") keeps acting for the treasury after this change',
			),
		);
		// one that has expired acts for nobody
		expect(
			agentsStayLine([{ name: "old", address: C, validUntil: 500 }], 1_000),
		).toBeNull();
	});

	it("for converting back, says what the form says", () => {
		const r = changeLines({ ...base, next: null });
		expect(texts(r)[0]).toContain("If nobody holds the account's own key");
		expect(r.blockedBy).toBeNull();
	});
});
