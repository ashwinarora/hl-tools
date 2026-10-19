/**
 * Spaces out requests that are heavy on Hyperliquid's rate limit. An explorer
 * look-up weighs 40 of the 1200 a network address may spend in a minute, and
 * that budget is shared with everything else the page asks: a few may go at
 * once, then one every few seconds.
 *
 * A token bucket with an injected clock and timers, so it is tested without
 * waiting.
 */

/**
 * Remembers that a service said "no more for now" and that nothing should be
 * asked of it for a while. Hyperliquid's explorer answers every look-up with
 * the same refusal once a network address has used up its allowance for the
 * day: asking on, three times per transaction, only adds requests.
 */
export class Rest {
	private readonly ms: number;
	private readonly now: () => number;
	private until = 0;

	constructor(ms: number, now: () => number = Date.now) {
		this.ms = ms;
		this.now = now;
	}

	/** The service refused: rest from now on. */
	start(): void {
		this.until = this.now() + this.ms;
	}

	get resting(): boolean {
		return this.now() < this.until;
	}
}

export interface PacerOptions {
	/** How many may start at once after a quiet spell. */
	readonly burst: number;
	/** Afterwards, one more every this many ms. */
	readonly everyMs: number;
	readonly now?: () => number;
	readonly setTimer?: (fn: () => void, ms: number) => unknown;
}

export class Pacer {
	private readonly burst: number;
	private readonly everyMs: number;
	private readonly now: () => number;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;
	private tokens: number;
	private refilledAt: number;
	private readonly waiting: (() => void)[] = [];
	private timer = false;

	constructor(options: PacerOptions) {
		this.burst = Math.max(1, Math.floor(options.burst));
		this.everyMs = Math.max(1, options.everyMs);
		this.now = options.now ?? Date.now;
		this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
		this.tokens = this.burst;
		this.refilledAt = this.now();
	}

	/** Resolves when the caller may send its request. First come, first served. */
	turn(): Promise<void> {
		return new Promise((resolve) => {
			this.waiting.push(resolve);
			this.drain();
		});
	}

	/** How many are waiting for their turn. */
	get queued(): number {
		return this.waiting.length;
	}

	private refill(): void {
		const now = this.now();
		const earned = Math.floor((now - this.refilledAt) / this.everyMs);
		if (earned <= 0) return;
		this.tokens = Math.min(this.burst, this.tokens + earned);
		// keep the remainder, unless the bucket is full (time spent full earns nothing)
		this.refilledAt =
			this.tokens === this.burst
				? now
				: this.refilledAt + earned * this.everyMs;
	}

	private drain(): void {
		this.refill();
		while (this.tokens > 0 && this.waiting.length > 0) {
			this.tokens -= 1;
			(this.waiting.shift() as () => void)();
		}
		if (this.waiting.length === 0 || this.timer) return;
		this.timer = true;
		const wait = Math.max(1, this.refilledAt + this.everyMs - this.now());
		this.setTimer(() => {
			this.timer = false;
			this.drain();
		}, wait);
	}
}
