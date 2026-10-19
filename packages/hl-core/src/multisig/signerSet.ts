/**
 * `convertToMultiSigUser.signers` is a JSON *string* describing the new signer
 * set, or the literal string "null" to revert to a normal user. The rules here
 * mirror what the chain enforces (see rules/multisig.ts) plus lock-out
 * warnings the chain does not give.
 */
import type { Address } from "../identity.ts";
import type { Issue } from "../issues.ts";
import {
	MAX_SIGNERS,
	MIN_THRESHOLD,
	REVERT_SIGNERS,
} from "../rules/multisig.ts";
import { normaliseAddress } from "./address.ts";
import type { PlainObject, Policy, SignerSet } from "./types.ts";

/** An issue that always points at a field. */
export type PathedIssue = Issue & { readonly path: string };

export interface ParsedSigners {
	/** The normalised set (lowercase, deduplicated, sorted), or null when reverting or invalid. */
	readonly set: SignerSet | null;
	/** True when the string means "convert back to a normal user". */
	readonly revert: boolean;
	readonly issues: readonly PathedIssue[];
}

const PATH = "signers";

function issue(
	code: string,
	severity: Issue["severity"],
	message: string,
	extra: { fix?: string; path: string },
): PathedIssue {
	return { code, severity, message, ...extra };
}

export function parseSignersString(value: unknown): ParsedSigners {
	if (typeof value !== "string") {
		return {
			set: null,
			revert: false,
			issues: [
				issue(
					"signers.not_string",
					"error",
					'"signers" must be a JSON string (the chain parses it), not an object.',
					{ path: PATH },
				),
			],
		};
	}
	if (value.trim() === REVERT_SIGNERS) {
		return { set: null, revert: true, issues: [] };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return {
			set: null,
			revert: false,
			issues: [
				issue("signers.not_json", "error", '"signers" is not valid JSON.', {
					path: PATH,
				}),
			],
		};
	}
	if (
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		!Array.isArray((parsed as { authorizedUsers?: unknown }).authorizedUsers)
	) {
		return {
			set: null,
			revert: false,
			issues: [
				issue(
					"signers.shape",
					"error",
					'"signers" must decode to {"authorizedUsers": [...], "threshold": n}; a missing authorizedUsers key is rejected by the chain with "Unexpected error (code=148)".',
					{ path: PATH },
				),
			],
		};
	}
	const obj = parsed as { authorizedUsers: unknown[]; threshold?: unknown };
	const issues: PathedIssue[] = [];
	if (!Number.isInteger(obj.threshold)) {
		issues.push(
			issue("signers.shape", "error", '"threshold" must be an integer.', {
				path: `${PATH}.threshold`,
			}),
		);
	}
	const users: Address[] = [];
	obj.authorizedUsers.forEach((u, i) => {
		const r = normaliseAddress(u, `${PATH}.authorizedUsers[${i}]`);
		issues.push(...(r.issues as PathedIssue[]));
		if (r.address) users.push(r.address);
	});
	const unique = [...new Set(users)];
	if (unique.length !== users.length) {
		issues.push(
			issue(
				"signers.duplicate",
				"warning",
				"authorizedUsers contains duplicates; the chain deduplicates silently, so the effective set is smaller than it looks.",
				{ path: `${PATH}.authorizedUsers` },
			),
		);
	}
	const sorted = [...unique].sort();
	if (sorted.some((a, i) => a !== unique[i])) {
		issues.push(
			issue(
				"signers.unsorted",
				"info",
				"authorizedUsers was not sorted; the chain stores the set sorted ascending.",
				{ path: `${PATH}.authorizedUsers` },
			),
		);
	}
	if (issues.some((i) => i.severity === "error")) {
		return { set: null, revert: false, issues };
	}
	return {
		set: { authorizedUsers: sorted, threshold: obj.threshold as number },
		revert: false,
		issues,
	};
}

/** The canonical `signers` string for a set (sorted, lowercase), as the Python SDK sends it. */
export function signersString(set: SignerSet | null): string {
	if (!set) return REVERT_SIGNERS;
	return JSON.stringify({
		authorizedUsers: [...set.authorizedUsers].sort(),
		threshold: set.threshold,
	});
}

export interface SignerSetContext {
	/** The account being converted; it may not list itself. */
	readonly self: Address;
	/** Its current policy, if it is already a multi-sig user. */
	readonly current?: Policy | null;
	/** The leader of the proposal carrying this change, to warn about removing them. */
	readonly leader?: Address | null;
	/** Addresses known to be dead (lost keys), to warn when the remaining set cannot reach the threshold. */
	readonly lostKeys?: readonly Address[];
	/** Does this address exist on L1? `undefined` = unknown. Omit to skip the check. */
	readonly exists?: (address: Address) => boolean | undefined;
	/** Is this address itself a multi-sig user? `undefined` = unknown. */
	readonly isMultiSig?: (address: Address) => boolean | undefined;
}

/** Rules the chain enforces (errors) plus lock-out and hygiene warnings. */
export function validateSignerSet(
	set: SignerSet,
	ctx: SignerSetContext,
): Issue[] {
	const issues: Issue[] = [];
	const users = set.authorizedUsers;
	const path = `${PATH}.authorizedUsers`;
	if (users.length === 0) {
		issues.push(
			issue(
				"signers.empty",
				"error",
				'An empty authorizedUsers list is rejected ("Invalid multi-sig threshold"). To revert to a normal user send the string "null".',
				{ path },
			),
		);
	}
	if (users.length > MAX_SIGNERS) {
		issues.push(
			issue(
				"signers.too_many",
				"error",
				`At most ${MAX_SIGNERS} authorized users ("Too many multi-sig signers").`,
				{ path },
			),
		);
	}
	if (
		set.threshold < MIN_THRESHOLD ||
		(users.length > 0 && set.threshold > users.length)
	) {
		issues.push(
			issue(
				"signers.threshold",
				"error",
				`threshold must be between ${MIN_THRESHOLD} and the number of authorized users (${users.length}).`,
				{ path: `${PATH}.threshold` },
			),
		);
	} else if (users.length > 1 && set.threshold === users.length) {
		issues.push(
			issue(
				"lockout.all_keys_required",
				"warning",
				"threshold equals the number of signers: losing any one key locks the account forever.",
				{ path: `${PATH}.threshold` },
			),
		);
	}
	if (users.includes(ctx.self)) {
		issues.push(
			issue(
				"signers.self",
				"error",
				'The account cannot be its own authorized user ("Cannot register self as multi-sig authorized user").',
				{ path },
			),
		);
	}
	if (ctx.exists) {
		let unknown = false;
		for (const u of users) {
			const e = ctx.exists(u);
			if (e === false) {
				issues.push(
					issue(
						"signers.nonexistent",
						"error",
						`${u} has never deposited on Hyperliquid ("Multi-sig authorized user must exist on L1"). Send it a small deposit first.`,
						{ path },
					),
				);
			} else if (e === undefined) unknown = true;
		}
		if (unknown) {
			issues.push(
				issue(
					"signers.existence_unknown",
					"warning",
					"Could not confirm that every authorized user exists on L1; the chain will reject the conversion if one does not.",
					{ path },
				),
			);
		}
	} else if (users.length > 0) {
		issues.push(
			issue(
				"signers.existence_unchecked",
				"warning",
				"Authorized users were not checked for existence on L1 (each must have received a deposit).",
				{ path },
			),
		);
	}
	if (ctx.isMultiSig) {
		for (const u of users) {
			if (ctx.isMultiSig(u) === true) {
				issues.push(
					issue(
						"signers.nested",
						"warning",
						`${u} is itself a multi-sig user. Its raw key still signs and leads here; its own threshold is not consulted.`,
						{ path },
					),
				);
			}
		}
	}
	if (ctx.leader && !users.includes(ctx.leader)) {
		issues.push(
			issue(
				"lockout.leader_removed",
				"warning",
				`This change removes the proposal's leader (${ctx.leader}) from the signer set.`,
				{ path },
			),
		);
	}
	const current = ctx.current;
	if (current) {
		if (
			current.authorizedUsers.length > 0 &&
			!current.authorizedUsers.some((a) => users.includes(a))
		) {
			issues.push(
				issue(
					"lockout.all_current_removed",
					"warning",
					"None of the current signers remain in the new set.",
					{ path },
				),
			);
		}
		if (
			current.threshold === set.threshold &&
			current.authorizedUsers.length === users.length &&
			current.authorizedUsers.every((a, i) => a === users[i])
		) {
			issues.push(
				issue(
					"signers.noop",
					"info",
					"The new set and threshold are identical to the current policy.",
					{ path },
				),
			);
		}
	}
	if (ctx.lostKeys?.length) {
		const live = users.filter((u) => !ctx.lostKeys?.includes(u)).length;
		if (live < set.threshold) {
			issues.push(
				issue(
					"lockout.unreachable",
					"warning",
					`Only ${live} signer(s) with live keys remain for a threshold of ${set.threshold}: the account would be locked.`,
					{ path },
				),
			);
		}
	}
	return issues;
}

/** True for a `convertToMultiSigUser` action that reverts to a normal user. */
export function isRevert(action: PlainObject): boolean {
	if (action.type !== "convertToMultiSigUser") return false;
	return parseSignersString(action.signers).revert;
}
