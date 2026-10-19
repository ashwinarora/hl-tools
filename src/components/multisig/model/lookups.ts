/**
 * Asking Hyperliquid about the addresses someone wants as signers, without
 * hammering it. Each address costs two info requests (`userRole`, weight 60,
 * and `userToMultiSigSigners`, weight 20) from the reader's own network
 * address, and a pasted list can hold ten. So: at most two addresses are
 * asked about at a time, an address that got its answer is never asked again
 * (only "Check again" does that, for one address), and an address taken off
 * the list before its turn is not asked at all.
 *
 * Pure: the read is handed in, so this runs against stubs.
 */
import type { Address } from "@hl-tools/core";
import type { SignerCheck } from "./signerSet";

export const LOOKUPS_AT_ONCE = 2;

const LOADING: SignerCheck = { state: "loading" };
const FAILED: SignerCheck = { state: "failed" };

export class SignerLookups {
	private readonly results = new Map<Address, SignerCheck>();
	private queue: Address[] = [];
	private flying = 0;
	private stopped = false;

	constructor(
		private readonly read: (address: Address) => Promise<SignerCheck>,
		/** Called whenever `snapshot()` would return something new. */
		private readonly onChange: () => void,
		private readonly atOnce = LOOKUPS_AT_ONCE,
	) {}

	/** The addresses that need an answer now. Known ones are left alone. */
	want(addresses: readonly Address[]): void {
		const wanted = new Set(addresses);
		// not asked yet and no longer wanted: never asked
		const dropped = this.queue.filter((a) => !wanted.has(a));
		this.queue = this.queue.filter((a) => wanted.has(a));
		for (const a of dropped) this.results.delete(a);
		let changed = dropped.length > 0;
		for (const a of addresses) {
			if (this.results.has(a)) continue;
			this.results.set(a, LOADING);
			this.queue.push(a);
			changed = true;
		}
		if (changed) this.onChange();
		this.pump();
	}

	/** Ask again about one address: it was never used, or could not be read. */
	recheck(address: Address): void {
		if (this.results.get(address)?.state === "loading") return;
		this.results.set(address, LOADING);
		this.queue.push(address);
		this.onChange();
		this.pump();
	}

	/** What is known, as a new map each time (a screen compares by identity). */
	snapshot(): ReadonlyMap<string, SignerCheck> {
		return new Map(this.results);
	}

	/** Being asked right now. */
	get inFlight(): number {
		return this.flying;
	}

	/** The page went away: answers still on their way are dropped. */
	stop(): void {
		this.stopped = true;
		this.queue = [];
	}

	private pump(): void {
		while (!this.stopped && this.flying < this.atOnce) {
			const next = this.queue.shift();
			if (next === undefined) return;
			this.flying += 1;
			this.read(next)
				.catch(() => FAILED)
				.then((check) => {
					this.flying -= 1;
					if (this.stopped) return;
					this.results.set(next, check);
					this.onChange();
					this.pump();
				});
		}
	}
}
