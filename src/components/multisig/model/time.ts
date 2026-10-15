/**
 * Times as the Multisig section shows them: in the reader's own zone, with
 * UTC kept for the hover text, exports and the developer panels. The locale
 * and zone are parameters, so tests are the same on every machine.
 */

export interface TimeContext {
	/** BCP 47 tag; the browser's own when left out. */
	readonly locale?: string;
	/** IANA zone; the browser's own when left out. */
	readonly timeZone?: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

type Piece = "date" | "minutes" | "seconds" | "zone";

const OPTIONS: Record<Piece, Intl.DateTimeFormatOptions> = {
	date: { dateStyle: "medium" },
	minutes: { timeStyle: "short" },
	seconds: { timeStyle: "medium" },
	zone: { timeZoneName: "short", hour: "numeric" },
};

function formatter(ctx: TimeContext, piece: Piece): Intl.DateTimeFormat {
	const key = `${ctx.locale ?? ""}|${ctx.timeZone ?? ""}|${piece}`;
	let f = formatters.get(key);
	if (!f) {
		f = new Intl.DateTimeFormat(ctx.locale, {
			timeZone: ctx.timeZone,
			...OPTIONS[piece],
		});
		formatters.set(key, f);
	}
	return f;
}

const valid = (ms: number) => Number.isFinite(ms) && Math.abs(ms) <= 8.64e15;

/** "11 Oct 2026, 01:21" in the reader's zone; with `seconds`, "11 Oct 2026, 01:21:35". */
export function localDateTime(
	ms: number,
	ctx: TimeContext = {},
	opts: { seconds?: boolean } = {},
): string {
	if (!valid(ms)) return "—";
	// The date and the time are formatted apart and joined here: how a browser
	// glues the two ("," or " at ") changes with its locale data, and a table
	// column should not.
	const date = formatter(ctx, "date").format(ms);
	const time = formatter(ctx, opts.seconds ? "seconds" : "minutes").format(ms);
	return `${date}, ${time}`;
}

/** "11 Oct 2026" in the reader's zone: the day alone, where the hour says nothing. */
export function localDate(ms: number, ctx: TimeContext = {}): string {
	return valid(ms) ? formatter(ctx, "date").format(ms) : "—";
}

/** The reader's zone at that moment, as the browser abbreviates it: "GMT+5:30", "CEST". */
export function zoneLabel(ms: number, ctx: TimeContext = {}): string {
	if (!valid(ms)) return "";
	return (
		formatter(ctx, "zone")
			.formatToParts(ms)
			.find((p) => p.type === "timeZoneName")?.value ?? ""
	);
}

/** "2026-10-10 19:51:35 UTC": the same moment for everyone. */
export function utcDateTime(ms: number): string {
	if (!valid(ms)) return "—";
	return `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** For `<time dateTime>`; empty when the number is not a time. */
export function isoDateTime(ms: number): string {
	return valid(ms) ? new Date(ms).toISOString() : "";
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/**
 * How far away a moment is, coarsely: "in 89 days", "in 5 hours", "in 12
 * minutes", "in less than a minute"; past moments read "3 days ago".
 */
export function fromNow(ms: number, now: number): string {
	if (!valid(ms) || !valid(now)) return "—";
	const diff = ms - now;
	const s = Math.abs(diff) / 1000;
	const size =
		s < 60
			? "less than a minute"
			: s < 3600
				? plural(Math.floor(s / 60), "minute")
				: s < 48 * 3600
					? plural(Math.floor(s / 3600), "hour")
					: plural(Math.floor(s / 86400), "day");
	return diff >= 0 ? `in ${size}` : `${size} ago`;
}

/**
 * How long until a moment, finer than `fromNow` where a decision hangs on it:
 * "in 1 day 6 hours", "in 5 hours", "in 12 minutes", "in less than a minute".
 * A moment that has passed reads as `fromNow` reads it.
 */
export function untilWords(ms: number, now: number): string {
	if (!valid(ms) || !valid(now)) return "—";
	const diff = ms - now;
	if (diff <= 0) return fromNow(ms, now);
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "in less than a minute";
	if (minutes < 60) return `in ${plural(minutes, "minute")}`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `in ${plural(hours, "hour")}`;
	const days = Math.floor(hours / 24);
	const rest = hours % 24;
	return rest === 0
		? `in ${plural(days, "day")}`
		: `in ${plural(days, "day")} ${plural(rest, "hour")}`;
}

/**
 * How long ago something happened that has happened: "2 hours ago", "less
 * than a minute ago". Never "in …": the relay's clock can run a little ahead
 * of the reader's, and a page's own clock is read only every so often, so a
 * fresh stamp can lie a moment in what the page takes for the future.
 */
export function agoWords(at: number, now: number): string {
	return fromNow(Math.min(at, now - 1), now);
}
