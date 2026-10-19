import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { SignerLookups } from "./lookups";
import type { SignerCheck } from "./signerSet";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const READY: SignerCheck = { state: "ready", role: "user", multiSig: null };

/** A read that answers only when the test says so. */
function stub() {
	const asked: Address[] = [];
	const open = new Map<
		Address,
		{ resolve(c: SignerCheck): void; reject(e: Error): void }
	>();
	return {
		asked,
		read: (a: Address) =>
			new Promise<SignerCheck>((resolve, reject) => {
				asked.push(a);
				open.set(a, { resolve, reject });
			}),
		async answer(a: Address, c: SignerCheck = READY) {
			open.get(a)?.resolve(c);
			await new Promise((r) => setTimeout(r, 0));
		},
		async fail(a: Address) {
			open.get(a)?.reject(new Error("429"));
			await new Promise((r) => setTimeout(r, 0));
		},
	};
}

describe("looking signers up", () => {
	it("asks about two addresses at a time, in the order they were given", async () => {
		const s = stub();
		let changes = 0;
		const q = new SignerLookups(s.read, () => changes++);
		q.want([1, 2, 3, 4, 5].map(addr));
		expect(s.asked).toEqual([addr(1), addr(2)]);
		expect(q.inFlight).toBe(2);
		// all five say "loading" from the start
		expect([...q.snapshot().values()].map((c) => c.state)).toEqual(
			Array(5).fill("loading"),
		);
		await s.answer(addr(1));
		expect(s.asked).toEqual([addr(1), addr(2), addr(3)]);
		expect(q.snapshot().get(addr(1))).toEqual(READY);
		await s.answer(addr(2));
		await s.answer(addr(3));
		await s.answer(addr(4));
		await s.answer(addr(5));
		expect(s.asked).toHaveLength(5);
		expect(q.inFlight).toBe(0);
		expect(changes).toBeGreaterThanOrEqual(6);
	});

	it("never asks twice about an address that got its answer", async () => {
		const s = stub();
		const q = new SignerLookups(s.read, () => {});
		q.want([addr(1)]);
		await s.answer(addr(1));
		q.want([addr(1), addr(2)]);
		q.want([addr(2), addr(1)]);
		expect(s.asked).toEqual([addr(1), addr(2)]);
		// taken off the list and put back: still known
		q.want([addr(2)]);
		q.want([addr(1), addr(2)]);
		expect(s.asked).toEqual([addr(1), addr(2)]);
	});

	it("does not ask about an address removed before its turn", async () => {
		const s = stub();
		const q = new SignerLookups(s.read, () => {});
		q.want([1, 2, 3].map(addr));
		q.want([addr(1), addr(2)]); // 3 was waiting
		await s.answer(addr(1));
		await s.answer(addr(2));
		expect(s.asked).toEqual([addr(1), addr(2)]);
		expect(q.snapshot().has(addr(3))).toBe(false);
	});

	it("records a read that failed as unknown, and asks again only on request", async () => {
		const s = stub();
		const q = new SignerLookups(s.read, () => {});
		q.want([addr(1)]);
		await s.fail(addr(1));
		expect(q.snapshot().get(addr(1))).toEqual({ state: "failed" });
		q.want([addr(1)]);
		expect(s.asked).toHaveLength(1);
		q.recheck(addr(1));
		expect(q.snapshot().get(addr(1))?.state).toBe("loading");
		// pressing twice while it is being asked does nothing more
		q.recheck(addr(1));
		expect(s.asked).toHaveLength(2);
		await s.answer(addr(1), {
			state: "ready",
			role: "missing",
			multiSig: null,
		});
		expect(q.snapshot().get(addr(1))?.role).toBe("missing");
	});

	it("hands out a new map on every change and drops late answers once stopped", async () => {
		const s = stub();
		const q = new SignerLookups(s.read, () => {});
		q.want([addr(1), addr(2), addr(3)]);
		const before = q.snapshot();
		q.stop();
		await s.answer(addr(1));
		expect(q.snapshot()).not.toBe(before);
		expect(q.snapshot().get(addr(1))?.state).toBe("loading");
		// the third was never asked
		expect(s.asked).toEqual([addr(1), addr(2)]);
	});
});
