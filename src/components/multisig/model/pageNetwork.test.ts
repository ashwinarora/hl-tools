import { describe, expect, it } from "vitest";
import { pageNetworkStep, type SeenNetworks } from "./pageNetwork";

/** Run the steps a page would, applying each one, and return what happened. */
function run(
	events: readonly (
		| { link: "mainnet" | "testnet" | null }
		| { header: "mainnet" | "testnet" }
	)[],
	start: { asked: "mainnet" | "testnet" | null; header: "mainnet" | "testnet" },
) {
	let { asked, header } = start;
	let seen: SeenNetworks | null = null;
	const log: string[] = [];
	const settle = () => {
		for (let i = 0; i < 4; i++) {
			const step = pageNetworkStep({ asked, header, seen });
			seen = step.seen;
			if (step.header) {
				header = step.header;
				log.push(`header→${step.header}`);
			}
			if (step.link) {
				asked = step.link;
				log.push(`link→${step.link}`);
			}
			if (!step.header && !step.link) break;
		}
	};
	settle();
	for (const e of events) {
		if ("link" in e) asked = e.link;
		else header = e.header;
		settle();
	}
	return { asked, header, log };
}

describe("the network of a page that signs", () => {
	it("is the link's when the page opens, whatever another tab left in the header", () => {
		// the audit's two-tab case: this page was mainnet, another tab switched to testnet, reload
		expect(run([], { asked: "mainnet", header: "testnet" })).toEqual({
			asked: "mainnet",
			header: "mainnet",
			log: ["header→mainnet"],
		});
		// and the mirror image, the dangerous direction
		expect(run([], { asked: "testnet", header: "mainnet" })).toEqual({
			asked: "testnet",
			header: "testnet",
			log: ["header→testnet"],
		});
	});

	it("does nothing when they agree", () => {
		expect(run([], { asked: "testnet", header: "testnet" }).log).toEqual([]);
	});

	it("writes the header's network into a link that names none, once", () => {
		expect(run([], { asked: null, header: "testnet" })).toEqual({
			asked: "testnet",
			header: "testnet",
			log: ["link→testnet"],
		});
	});

	it("follows the header when the reader uses its switch on the open page", () => {
		expect(
			run([{ header: "mainnet" }], { asked: "testnet", header: "testnet" }),
		).toEqual({ asked: "mainnet", header: "mainnet", log: ["link→mainnet"] });
	});

	it("follows a new link opened on the same page", () => {
		expect(
			run([{ link: "mainnet" }], { asked: "testnet", header: "testnet" }),
		).toEqual({
			asked: "mainnet",
			header: "mainnet",
			log: ["header→mainnet"],
		});
	});

	it("is not confused by an effect that runs twice with what it already applied", () => {
		// React runs effects twice in development: the second run sees the header already moved
		const first = pageNetworkStep({
			asked: "mainnet",
			header: "testnet",
			seen: null,
		});
		expect(first.header).toBe("mainnet");
		const second = pageNetworkStep({
			asked: "mainnet",
			header: "mainnet",
			seen: first.seen,
		});
		expect(second).toEqual({ seen: first.seen });
		// and a run that still sees the old header (its update not yet applied) changes nothing
		const stale = pageNetworkStep({
			asked: "mainnet",
			header: "testnet",
			seen: { asked: "mainnet", header: "testnet" },
		});
		expect(stale.header).toBeUndefined();
		expect(stale.link).toBeUndefined();
	});

	it("never ends with the link and the header apart", () => {
		const nets = ["mainnet", "testnet"] as const;
		for (const asked of [null, ...nets])
			for (const header of nets)
				for (const then of [
					{ header: "mainnet" as const },
					{ header: "testnet" as const },
					{ link: "mainnet" as const },
					{ link: "testnet" as const },
				]) {
					const end = run([then], { asked, header });
					expect(end.asked, JSON.stringify({ asked, header, then })).toBe(
						end.header,
					);
				}
	});
});
