import { describe, expect, it } from "vitest";
import { CHANGE, convertBackLines } from "./change";
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
			"1 waiting proposal can no longer be submitted afterwards.",
		);
		expect(CHANGE.backWaiting(2)).toContain("2 waiting proposals");
	});
});
