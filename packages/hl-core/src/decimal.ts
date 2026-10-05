/**
 * Exact decimal arithmetic on (bigint mantissa, base-10 scale) pairs.
 *
 * No protocol value in hl-core ever passes through a JavaScript `number`
 * floating point. Prices, sizes, notionals and amounts are parsed from
 * strings, operated on as scaled bigints and serialised back to canonical
 * strings (trailing zeros removed, as Hyperliquid's signing requires).
 */

export type RoundingMode =
	/** Toward zero (truncate). */
	| "down"
	/** Away from zero. */
	| "up"
	/** Toward negative infinity. */
	| "floor"
	/** Toward positive infinity. */
	| "ceil"
	/** Nearest, ties away from zero. */
	| "half-up"
	/** Nearest, ties to even (banker's rounding). */
	| "half-even";

export class DecimalParseError extends Error {
	readonly input: string;
	constructor(input: string, reason: string) {
		super(`Cannot parse "${input}" as a decimal: ${reason}`);
		this.name = "DecimalParseError";
		this.input = input;
	}
}

export class InexactError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InexactError";
	}
}

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const TEN = 10n;

function pow10(n: number): bigint {
	if (n < 0) throw new RangeError("pow10 of negative exponent");
	return TEN ** BigInt(n);
}

function abs(n: bigint): bigint {
	return n < 0n ? -n : n;
}

/** Round the exact rational `num / den` to an integer using `mode`. */
function roundQuotient(num: bigint, den: bigint, mode: RoundingMode): bigint {
	if (den === 0n) throw new RangeError("Division by zero");
	const negative = num < 0n !== den < 0n;
	const n = abs(num);
	const d = abs(den);
	let q = n / d;
	const r = n % d;
	if (r !== 0n) {
		const twice = r * 2n;
		let increment: boolean;
		switch (mode) {
			case "down":
				increment = false;
				break;
			case "up":
				increment = true;
				break;
			case "floor":
				increment = negative;
				break;
			case "ceil":
				increment = !negative;
				break;
			case "half-up":
				increment = twice >= d;
				break;
			case "half-even":
				increment = twice > d || (twice === d && q % 2n === 1n);
				break;
		}
		if (increment) q += 1n;
	}
	return negative ? -q : q;
}

export class Decimal {
	/** Unscaled value: the decimal equals `mantissa / 10^scale`. */
	readonly mantissa: bigint;
	/** Number of fractional digits (always >= 0). */
	readonly scale: number;

	private constructor(mantissa: bigint, scale: number) {
		this.mantissa = mantissa;
		this.scale = scale;
	}

	static readonly ZERO = new Decimal(0n, 0);
	static readonly ONE = new Decimal(1n, 0);

	/**
	 * Parse a decimal string. Accepts optional sign, integer and/or fraction
	 * digits and an optional exponent (`1.5e-3`). Rejects empty strings, hex,
	 * NaN, Infinity, whitespace and thousands separators.
	 */
	static parse(input: string): Decimal {
		if (typeof input !== "string") {
			throw new DecimalParseError(String(input), "expected a string");
		}
		if (input.length === 0) throw new DecimalParseError(input, "empty input");
		if (input.trim() !== input) {
			throw new DecimalParseError(input, "leading or trailing whitespace");
		}
		const m = DECIMAL_RE.exec(input);
		if (!m) throw new DecimalParseError(input, "not a decimal number");
		const [, sign, intPart = "", fracPart = "", expPart] = m;
		if (intPart.length === 0 && fracPart.length === 0) {
			throw new DecimalParseError(input, "no digits");
		}
		const digits = `${intPart}${fracPart}` || "0";
		let mantissa = BigInt(digits);
		if (sign === "-") mantissa = -mantissa;
		let scale = fracPart.length;
		if (expPart !== undefined) {
			const exp = Number.parseInt(expPart, 10);
			if (!Number.isSafeInteger(exp) || Math.abs(exp) > 1000) {
				throw new DecimalParseError(input, "exponent out of range");
			}
			scale -= exp;
		}
		if (scale < 0) {
			mantissa *= pow10(-scale);
			scale = 0;
		}
		return new Decimal(mantissa, scale).normalize();
	}

	/** Parse without throwing. */
	static tryParse(input: string): Decimal | null {
		try {
			return Decimal.parse(input);
		} catch {
			return null;
		}
	}

	static isValid(input: string): boolean {
		return Decimal.tryParse(input) !== null;
	}

	/** Construct from an integer scaled by `10^scale` (e.g. a CoreWriter 1e8 value). */
	static fromScaled(value: bigint | number | string, scale: number): Decimal {
		if (!Number.isInteger(scale) || scale < 0) {
			throw new RangeError(`Invalid scale ${scale}`);
		}
		const big = typeof value === "bigint" ? value : BigInt(value);
		return new Decimal(big, scale).normalize();
	}

	static fromBigInt(value: bigint): Decimal {
		return new Decimal(value, 0);
	}

	/**
	 * Construct from a safe JS integer. Refuses non-integers: floats never
	 * enter the numeric layer.
	 */
	static fromInteger(value: number): Decimal {
		if (!Number.isSafeInteger(value)) {
			throw new InexactError(
				`${value} is not a safe integer; pass protocol values as strings`,
			);
		}
		return new Decimal(BigInt(value), 0);
	}

	/** Remove trailing fractional zeros. */
	normalize(): Decimal {
		let { mantissa, scale } = this;
		if (mantissa === 0n) return scale === 0 ? this : new Decimal(0n, 0);
		while (scale > 0 && mantissa % TEN === 0n) {
			mantissa /= TEN;
			scale -= 1;
		}
		return scale === this.scale ? this : new Decimal(mantissa, scale);
	}

	private rescale(scale: number): bigint {
		if (scale < this.scale) throw new RangeError("rescale would lose digits");
		return this.mantissa * pow10(scale - this.scale);
	}

	private static align(a: Decimal, b: Decimal): [bigint, bigint, number] {
		const scale = Math.max(a.scale, b.scale);
		return [a.rescale(scale), b.rescale(scale), scale];
	}

	add(other: Decimal): Decimal {
		const [x, y, s] = Decimal.align(this, other);
		return new Decimal(x + y, s).normalize();
	}

	sub(other: Decimal): Decimal {
		const [x, y, s] = Decimal.align(this, other);
		return new Decimal(x - y, s).normalize();
	}

	mul(other: Decimal): Decimal {
		return new Decimal(
			this.mantissa * other.mantissa,
			this.scale + other.scale,
		).normalize();
	}

	/** Divide and round to `decimals` fractional digits. */
	div(
		other: Decimal,
		decimals: number,
		mode: RoundingMode = "half-even",
	): Decimal {
		if (other.isZero()) throw new RangeError("Division by zero");
		// (m1 / 10^s1) / (m2 / 10^s2) * 10^decimals = m1 * 10^(s2+decimals) / (m2 * 10^s1)
		const num = this.mantissa * pow10(other.scale + decimals);
		const den = other.mantissa * pow10(this.scale);
		return new Decimal(roundQuotient(num, den, mode), decimals).normalize();
	}

	neg(): Decimal {
		return new Decimal(-this.mantissa, this.scale);
	}

	abs(): Decimal {
		return this.mantissa < 0n ? this.neg() : this;
	}

	cmp(other: Decimal): -1 | 0 | 1 {
		const [x, y] = Decimal.align(this, other);
		return x < y ? -1 : x > y ? 1 : 0;
	}

	eq(other: Decimal): boolean {
		return this.cmp(other) === 0;
	}
	lt(other: Decimal): boolean {
		return this.cmp(other) < 0;
	}
	lte(other: Decimal): boolean {
		return this.cmp(other) <= 0;
	}
	gt(other: Decimal): boolean {
		return this.cmp(other) > 0;
	}
	gte(other: Decimal): boolean {
		return this.cmp(other) >= 0;
	}

	isZero(): boolean {
		return this.mantissa === 0n;
	}
	isNegative(): boolean {
		return this.mantissa < 0n;
	}
	isPositive(): boolean {
		return this.mantissa > 0n;
	}
	isInteger(): boolean {
		return this.normalize().scale === 0;
	}

	/** Number of fractional digits after removing trailing zeros. */
	decimalPlaces(): number {
		return this.normalize().scale;
	}

	/**
	 * Significant figures: digits from the first non-zero digit to the last
	 * non-zero digit. `0` has 0 significant figures; `1200` has 2.
	 */
	significantFigures(): number {
		const n = this.normalize();
		if (n.mantissa === 0n) return 0;
		let digits = abs(n.mantissa).toString();
		digits = digits.replace(/0+$/, "");
		return digits.length;
	}

	/** Count of digits in the integer part (0 for |x| < 1). */
	integerDigits(): number {
		const n = this.normalize();
		const intPart = abs(n.mantissa) / pow10(n.scale);
		return intPart === 0n ? 0 : intPart.toString().length;
	}

	private roundInternal(decimals: number, mode: RoundingMode): Decimal {
		if (decimals >= this.scale) return this;
		const q = roundQuotient(this.mantissa, pow10(this.scale - decimals), mode);
		return new Decimal(q, decimals);
	}

	/** Round to at most `decimals` fractional digits. */
	roundToDecimals(decimals: number, mode: RoundingMode): Decimal {
		if (!Number.isInteger(decimals) || decimals < 0) {
			throw new RangeError(`Invalid decimals ${decimals}`);
		}
		return this.roundInternal(decimals, mode).normalize();
	}

	/** Round to at most `sigFigs` significant figures. */
	roundToSignificantFigures(sigFigs: number, mode: RoundingMode): Decimal {
		if (!Number.isInteger(sigFigs) || sigFigs < 1) {
			throw new RangeError(`Invalid significant figures ${sigFigs}`);
		}
		const n = this.normalize();
		if (n.isZero()) return n;
		const totalDigits = abs(n.mantissa).toString().length;
		const excess = totalDigits - sigFigs;
		if (excess <= 0) return n;
		// Number of fractional digits to keep (may be negative: round into the
		// integer part).
		const keep = n.scale - excess;
		if (keep >= 0) return n.roundInternal(keep, mode).normalize();
		const shifted = new Decimal(n.mantissa, n.scale - keep); // divide by 10^-keep
		const rounded = shifted.roundInternal(0, mode);
		return new Decimal(rounded.mantissa * pow10(-keep), 0).normalize();
	}

	/**
	 * Exact conversion to an integer scaled by `10^decimals`. Throws
	 * `InexactError` if the value has more fractional digits than `decimals`.
	 */
	toScaledBigInt(decimals: number): bigint {
		const n = this.normalize();
		if (n.scale > decimals) {
			throw new InexactError(
				`${n.toString()} has ${n.scale} decimal places; cannot represent exactly with ${decimals}`,
			);
		}
		return n.mantissa * pow10(decimals - n.scale);
	}

	/** Canonical string: no exponent, no trailing zeros, "-0" never appears. */
	toString(): string {
		const n = this.normalize();
		const negative = n.mantissa < 0n;
		const digits = abs(n.mantissa).toString();
		if (n.scale === 0) return `${negative ? "-" : ""}${digits}`;
		const padded = digits.padStart(n.scale + 1, "0");
		const intPart = padded.slice(0, padded.length - n.scale);
		const fracPart = padded.slice(padded.length - n.scale);
		return `${negative ? "-" : ""}${intPart}.${fracPart}`;
	}

	/** Fixed number of fractional digits; pads, never rounds (throws if inexact). */
	toFixedExact(decimals: number): string {
		const scaled = this.toScaledBigInt(decimals);
		return Decimal.formatScaled(scaled, decimals);
	}

	private static formatScaled(scaled: bigint, decimals: number): string {
		const negative = scaled < 0n;
		const digits = abs(scaled)
			.toString()
			.padStart(decimals + 1, "0");
		if (decimals === 0) return `${negative ? "-" : ""}${digits}`;
		const intPart = digits.slice(0, digits.length - decimals);
		const fracPart = digits.slice(digits.length - decimals);
		return `${negative ? "-" : ""}${intPart}.${fracPart}`;
	}

	/** Human display with thousands separators; exact digits preserved. */
	toDisplay(options: { minDecimals?: number } = {}): string {
		const s = this.toString();
		const negative = s.startsWith("-");
		const body = negative ? s.slice(1) : s;
		const [intPart = "0", fracPart = ""] = body.split(".");
		const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		const frac = fracPart.padEnd(options.minDecimals ?? 0, "0");
		return `${negative ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
	}

	toJSON(): string {
		return this.toString();
	}
}

/** Convenience: parse a string into a Decimal. */
export function dec(value: string): Decimal {
	return Decimal.parse(value);
}

/**
 * Hyperliquid's wire format for numbers in signed payloads: canonical decimal
 * string with trailing zeros removed. Mirrors the Python SDK's
 * `float_to_wire`, but without ever passing through a float.
 */
export function toWire(value: Decimal | string): string {
	const d = typeof value === "string" ? Decimal.parse(value) : value;
	return d.toString();
}
