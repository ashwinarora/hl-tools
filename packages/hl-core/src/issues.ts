/** A diagnostic produced by any hl-core check. */
export interface Issue {
	/** Stable machine code, e.g. "px.too_many_sig_figs". */
	readonly code: string;
	readonly severity: "error" | "warning" | "info";
	readonly message: string;
	/** What to do about it. */
	readonly fix?: string;
	/** JSON-path-ish pointer to the offending field, e.g. "orders[0].p". */
	readonly path?: string;
}

export function issue(
	code: string,
	severity: Issue["severity"],
	message: string,
	extra: { fix?: string; path?: string } = {},
): Issue {
	return { code, severity, message, ...extra };
}

export function hasErrors(issues: readonly Issue[]): boolean {
	return issues.some((i) => i.severity === "error");
}
