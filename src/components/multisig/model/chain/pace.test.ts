import { describe, expect, it } from "vitest";
import { Pacer } from "./pace";

function setup(burst: number, everyMs: number) {
	let time = 0;
	let timers: { at: number; fn: () => void }[] = [];
	const pacer = new Pacer({
		burst,
		everyMs,
		now: () => time,
		setTimer: (fn, ms) => {
			timers.push({ at: time + ms, fn });
			return 0;
		},
	});
	const started: number[] = [];
	const ask = (n: number) => {
		for (let i = 0; i < n; i++)
			void pacer.turn().then(() => started.push(time));
	};
	/** Move the clock, firing due timers in order, and let promises settle. */
	const advance = async (ms: number) => {
		const end = time + ms;
		for (;;) {
			const due = timers
				.filter((t) => t.at <= end)
				.sort((a, b) => a.at - b.at)[0];
			if (!due) break;
			timers = timers.filter((t) => t !== due);
			time = due.at;
			due.fn();
			await Promise.resolve();
		}
		time = end;
		await Promise.resolve();
	};
	return { pacer, started, ask, advance, timers: () => timers.length };
}

describe("Pacer", () => {
	it("lets a burst through at once, then one every interval, in order", async () => {
		const { pacer, started, ask, advance } = setup(3, 1000);
		ask(6);
		await advance(0);
		expect(started).toEqual([0, 0, 0]);
		expect(pacer.queued).toBe(3);
		await advance(999);
		expect(started).toHaveLength(3);
		await advance(1);
		expect(started).toEqual([0, 0, 0, 1000]);
		await advance(2000);
		expect(started).toEqual([0, 0, 0, 1000, 2000, 3000]);
		expect(pacer.queued).toBe(0);
	});
	it("earns the burst back while idle, and never more than the burst", async () => {
		const { started, ask, advance } = setup(2, 1000);
		ask(2);
		await advance(0);
		await advance(60_000);
		ask(4);
		await advance(0);
		// two at once after a long quiet spell, not sixty
		expect(started).toEqual([0, 0, 60_000, 60_000]);
		await advance(1000);
		expect(started).toHaveLength(5);
	});
	it("keeps partial progress towards the next turn", async () => {
		const { started, ask, advance } = setup(1, 1000);
		ask(1);
		await advance(0);
		await advance(600);
		ask(1);
		await advance(399);
		expect(started).toEqual([0]);
		await advance(1);
		expect(started).toEqual([0, 1000]);
	});
	it("sets one timer however many are waiting", async () => {
		const { ask, advance, timers } = setup(1, 1000);
		ask(5);
		await advance(0);
		expect(timers()).toBe(1);
	});
	it("treats nonsense settings as the smallest sensible ones, and runs on real timers by default", async () => {
		const p = new Pacer({ burst: 0, everyMs: 0 });
		await p.turn();
		const t0 = Date.now();
		await p.turn();
		expect(Date.now() - t0).toBeLessThan(200);
		expect(p.queued).toBe(0);
	});
});
