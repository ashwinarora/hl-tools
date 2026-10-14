/**
 * One push to the relay at a time. A page has two ways of sending what it
 * holds: the click that signed or submitted, and the catch-up that notices
 * the relay lacks something. Run side by side, both read the relay before
 * either wrote and both sent the same signature, the second one refused as a
 * duplicate. In a queue, the second reads what the first wrote and has
 * nothing left to send.
 *
 * `hold` marks a push that is on its way but not queued yet (the click saves
 * the copy first), so the catch-up that this very save sets off stays out of
 * its way.
 */
export interface Serial {
	/** Run `task` after every task queued before it, whether they succeeded or not. */
	run<T>(task: () => Promise<T>): Promise<T>;
	/** Mark a push as coming; the returned function says it is no longer coming. */
	hold(): () => void;
	/** Nothing is queued, running or held. */
	readonly idle: boolean;
}

export function serial(): Serial {
	let tail: Promise<void> = Promise.resolve();
	let busy = 0;
	return {
		get idle() {
			return busy === 0;
		},
		hold() {
			busy++;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				busy--;
			};
		},
		run(task) {
			busy++;
			const result = tail.then(task);
			// the queue goes on after a failure; the caller still sees it
			tail = result.then(
				() => undefined,
				() => undefined,
			);
			return result.finally(() => {
				busy--;
			});
		},
	};
}

/** One queue per key, made the first time it is asked for. */
export function queues(): (key: string) => Serial {
	const made = new Map<string, Serial>();
	return (key) => {
		let q = made.get(key);
		if (!q) {
			q = serial();
			made.set(key, q);
		}
		return q;
	};
}
