/**
 * The two inputs every form has, read into what an action carries: an
 * address (lowercased) and an amount (never rounded: too many decimals is an
 * error, not a silent truncation). What is wrong is added to `issues` under
 * the field's path.
 */
import {
	checksumMismatch,
	Decimal,
	type Issue,
	issue,
	isZeroAddress,
} from "@hl-tools/core";
import { ADDRESS_RE } from "#/components/tools/multisig/model";

export function addressField(
	value: string,
	path: string,
	what: string,
	issues: Issue[],
	/** Money is sent to this address (false: it is given a role). */
	receives = true,
): string | null {
	const v = value.trim();
	if (!v) {
		issues.push(
			issue("field.required", "error", `${what} is required.`, { path }),
		);
		return null;
	}
	if (!ADDRESS_RE.test(v)) {
		issues.push(
			issue(
				"address.invalid",
				"error",
				`${what} must be a 20-byte hex address: 0x followed by 40 hex digits.`,
				{ path },
			),
		);
		return null;
	}
	// two things worth a line where a typo costs money; neither is refused by Hyperliquid
	if (checksumMismatch(v)) {
		issues.push(
			issue(
				"address.checksum",
				"warning",
				"The capital letters do not match this address's checksum. Check it for a typo.",
				{ path },
			),
		);
	}
	if (isZeroAddress(v)) {
		issues.push(
			issue(
				"address.zero",
				"warning",
				receives
					? "This is the zero address. Nobody holds its key: whatever is sent to it is lost."
					: "This is the zero address. Nobody holds its key.",
				{ path },
			),
		);
	}
	return v.toLowerCase();
}

export function amountField(
	value: string,
	maxDecimals: number,
	unit: string,
	issues: Issue[],
	path = "action.amount",
): Decimal | null {
	const v = value.trim();
	if (!v) {
		issues.push(
			issue("field.required", "error", "Amount is required.", { path }),
		);
		return null;
	}
	// a person types 12.5, not 1.25e1; refuse the exponent form the parser would accept
	const d = /[eE]/.test(v) ? null : Decimal.tryParse(v);
	if (!d) {
		issues.push(
			issue(
				"amount.invalid",
				"error",
				"Amount must be a plain decimal number such as 12.5.",
				{ path },
			),
		);
		return null;
	}
	if (!d.isPositive()) {
		issues.push(
			issue(
				"amount.not_positive",
				"error",
				"Amount must be greater than zero.",
				{
					path,
				},
			),
		);
		return null;
	}
	if (d.decimalPlaces() > maxDecimals) {
		issues.push(
			issue(
				"amount.precision",
				"error",
				`${unit} has ${maxDecimals} decimal places; ${v} has ${d.decimalPlaces()}.`,
				{
					path,
					fix: "Shorten the amount yourself; it is never rounded for you.",
				},
			),
		);
		return null;
	}
	return d;
}
