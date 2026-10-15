import { describe, expect, it } from "vitest";
import { queues, serial } from "./serial";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("serial", () => {
	it("runs one task at a time, in the order they were queued", async () => {
		const q = serial();
		const seen: string[] = [];
		let open: () => void = () => {};
		const first = q.run(
			() =>
				new Promise<string>((r) => {
					seen.push("first starts");
					open = () => r("a");
				}),
		);
		const second = q.run(async () => {
			seen.push("second starts");
			return "b";
		});
		await tick();
		expect(seen).toEqual(["first starts"]);
		expect(q.idle).toBe(false);
		open();
		expect(await first).toBe("a");
		expect(await second).toBe("b");
		expect(seen).toEqual(["first starts", "second starts"]);
		expect(q.idle).toBe(true);
	});

	it("goes on after a task fails, and hands the failure to its caller", async () => {
		const q = serial();
		const failed = q.run(async () => {
			throw new Error("refused");
		});
		const next = q.run(async () => "ran");
		await expect(failed).rejects.toThrow("refused");
		expect(await next).toBe("ran");
		expect(q.idle).toBe(true);
	});

	it("is not idle while a push is held, and a release counts once", () => {
		const q = serial();
		const release = q.hold();
		expect(q.idle).toBe(false);
		release();
		release();
		expect(q.idle).toBe(true);
	});

	it("a push held across a save keeps a second push from starting beside it", async () => {
		// the click's save sets off the catch-up; the catch-up asks first
		const q = serial();
		const writes: string[] = [];
		const relay = new Set<string>();
		const push = async (who: string) => {
			// read, then write what is missing: the duplicate the queue prevents
			const missing = !relay.has("sig");
			await tick();
			if (missing) {
				relay.add("sig");
				writes.push(who);
			}
		};
		const release = q.hold();
		const catchUp = q.idle ? q.run(() => push("catch-up")) : null;
		await q.run(() => push("click"));
		release();
		expect(catchUp).toBeNull();
		expect(writes).toEqual(["click"]);
		// side by side, both read before either wrote: the duplicate
		relay.clear();
		writes.length = 0;
		await Promise.all([push("click"), push("catch-up")]);
		expect(writes).toEqual(["click", "catch-up"]);
		// queued, the second reads what the first wrote and sends nothing
		relay.clear();
		writes.length = 0;
		await Promise.all([
			q.run(() => push("click")),
			q.run(() => push("catch-up")),
		]);
		expect(writes).toEqual(["click"]);
	});
});

describe("queues", () => {
	it("gives the same queue for the same key and another for another key", () => {
		const of = queues();
		expect(of("me:0xa")).toBe(of("me:0xa"));
		expect(of("me:0xa")).not.toBe(of("me:0xb"));
	});
});
