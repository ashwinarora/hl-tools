/**
 * The docs' reference tables, built from the protocol core's rule files so a
 * table never says something the app no longer does. A page writes
 * `<RuleTable id="corewriter-actions" />`; the docs' remark step (`remark.ts`)
 * puts a real table in its place, in the page and in its Markdown copy, with
 * the rule set it comes from and the date it was last checked under it.
 *
 * Like `facts.ts`, the rule files are imported by path (this module runs while
 * the docs are compiled). A cell is inline Markdown: text, with code between
 * backticks.
 */
import {
	COREWRITER_ACTIONS,
	COREWRITER_ADDRESS,
	COREWRITER_RULES,
	type FieldUnit,
	RAW_ACTION_TOPIC,
	SEND_RAW_ACTION_SELECTOR,
	SUPPORTED_ENCODING_VERSIONS,
} from "../../../packages/hl-core/src/rules/corewriter.ts";
import type { RuleSetMeta } from "../../../packages/hl-core/src/rules/meta.ts";
import {
	MIN_ORDER_NOTIONAL,
	OPEN_ORDER_HARD_CAP,
	OPEN_ORDER_SOFT_LIMIT,
	ORDER_RULES,
} from "../../../packages/hl-core/src/rules/orders.ts";
import {
	MAX_DECIMALS,
	MAX_SIGNIFICANT_FIGURES,
	PRECISION_RULES,
} from "../../../packages/hl-core/src/rules/precision.ts";
import {
	PRECOMPILE_RULES,
	PRECOMPILES,
} from "../../../packages/hl-core/src/rules/precompiles.ts";
import {
	ADDRESS_LIMITS,
	EVM_RPC_REQUESTS_PER_MINUTE,
	EXPLORER_REQUEST_WEIGHT,
	RATE_LIMIT_RULES,
	REST_WEIGHT_PER_MINUTE,
	WS_LIMITS,
} from "../../../packages/hl-core/src/rules/rateLimits.ts";
import {
	NONCE_WINDOW,
	SIGNING_RULES,
} from "../../../packages/hl-core/src/rules/signing.ts";
import { waitText } from "./facts.ts";

export interface RuleTableData {
	/** The column titles. */
	readonly head: readonly string[];
	/** The rows, each a cell per column, as inline Markdown. */
	readonly rows: readonly (readonly string[])[];
	/** The rule sets the figures come from. */
	readonly from: readonly RuleSetMeta[];
}

const code = (s: string | number) => `\`${s}\``;
const count = (n: number) => n.toLocaleString("en-US");

/** A CoreWriter field's unit in a few words, where the raw integer needs one. */
function unitText(unit: FieldUnit): string {
	switch (unit.kind) {
		case "fixed":
			return ` × 10^${unit.decimals}`;
		case "tokenWei":
			return unit.fixedToken
				? ` in ${unit.fixedToken} wei`
				: " in the token's wei";
		case "cloid":
			return ", 0 = none";
		case "dex":
			return ", uint32 max = spot";
		case "decibps":
			return " in tenths of a basis point";
		case "enum":
			return ` (${Object.entries(unit.values)
				.map(([k, v]) => `${k} = ${v}`)
				.join(", ")})`;
		default:
			return "";
	}
}

export const TABLES = {
	"corewriter-encoding": {
		head: ["What", "Value"],
		rows: [
			["CoreWriter contract", code(COREWRITER_ADDRESS)],
			[
				"Function",
				`${code("sendRawAction(bytes)")}, selector ${code(SEND_RAW_ACTION_SELECTOR)}`,
			],
			[
				"Encoding version (byte 0)",
				SUPPORTED_ENCODING_VERSIONS.map(code).join(", "),
			],
			["Action ID", "Bytes 1 to 3, big-endian"],
			[
				"Fields",
				"The rest: the ABI encoding of the action's fields as one tuple",
			],
			[
				"Log",
				`${code("RawAction(address indexed user, bytes data)")}, topic ${code(RAW_ACTION_TOPIC)}`,
			],
		],
		from: [COREWRITER_RULES],
	},
	"corewriter-actions": {
		head: ["ID", "Action", "HyperCore action", "Fields", "Delayed"],
		rows: COREWRITER_ACTIONS.map((a) => [
			String(a.id),
			a.name,
			code(a.coreActionType),
			a.fields
				.map((f) => `${code(f.name)} ${f.type}${unitText(f.unit)}`)
				.join("; "),
			a.delayed ? "Yes, a few seconds" : "No",
		]),
		from: [COREWRITER_RULES],
	},
	precompiles: {
		head: ["Address", "Reads", "Inputs", "Returns"],
		rows: PRECOMPILES.map((p) => [
			code(`0x…${p.address.slice(-4)}`),
			p.name,
			p.params.length
				? p.params.map((x) => `${code(x.name)} ${x.type}`).join(", ")
				: "Nothing",
			`${p.output.kind === "array" ? "A list of " : ""}${p.output.fields
				.map((f) => code(f.name))
				.join(", ")}`,
		]),
		from: [PRECOMPILE_RULES],
	},
	"order-rules": {
		head: ["What", "Value"],
		rows: [
			[
				"Significant figures in a price, at most",
				`${MAX_SIGNIFICANT_FIGURES} (a whole-number price is always allowed)`,
			],
			[
				"Decimals in a price, at most",
				`${MAX_DECIMALS.perp} − ${code("szDecimals")} on perps, ${MAX_DECIMALS.spot} − ${code("szDecimals")} on spot and outcomes`,
			],
			["Decimals in a size, at most", code("szDecimals")],
			[
				"Smallest order value",
				`${MIN_ORDER_NOTIONAL} in the quote token (USDC on perps)`,
			],
			[
				"Open orders per account",
				`${count(OPEN_ORDER_SOFT_LIMIT)}, raised with trading volume up to ${count(OPEN_ORDER_HARD_CAP)}`,
			],
		],
		from: [PRECISION_RULES, ORDER_RULES],
	},
	"signing-rules": {
		head: ["What", "Value"],
		rows: [
			[
				"Nonce window",
				`From ${waitText(NONCE_WINDOW.pastMs)} before to ${waitText(NONCE_WINDOW.futureMs)} after the block's time`,
			],
			[
				"Nonces kept per signer",
				`The highest ${NONCE_WINDOW.storedHighest}: a new one must be above the smallest of them and not used before`,
			],
		],
		from: [SIGNING_RULES],
	},
	"rate-limits": {
		head: ["What", "Limit"],
		rows: [
			["REST weight per IP", `${count(REST_WEIGHT_PER_MINUTE)} a minute`],
			["One explorer request", `${EXPLORER_REQUEST_WEIGHT} of that weight`],
			[
				"Requests per address",
				`${count(ADDRESS_LIMITS.initialBuffer)} to start, plus ${ADDRESS_LIMITS.requestsPerUsdcTraded} per USDC traded; when used up, one every ${waitText(ADDRESS_LIMITS.whenLimitedOneRequestEveryMs)}`,
			],
			["WebSocket connections per IP", String(WS_LIMITS.maxConnections)],
			[
				"New WebSocket connections",
				`${WS_LIMITS.maxNewConnectionsPerMinute} a minute`,
			],
			["Subscriptions", count(WS_LIMITS.maxSubscriptions)],
			[
				"Different users in user subscriptions",
				String(WS_LIMITS.maxUniqueUsersInUserSubscriptions),
			],
			[
				"WebSocket messages sent",
				`${count(WS_LIMITS.maxMessagesPerMinute)} a minute`,
			],
			["Posts waiting on a socket", String(WS_LIMITS.maxInflightPosts)],
			["A quiet socket is closed after", waitText(WS_LIMITS.idleTimeoutMs)],
			[
				"HyperEVM JSON-RPC (Hyperliquid's own endpoint)",
				`${EVM_RPC_REQUESTS_PER_MINUTE} requests a minute per IP`,
			],
		],
		from: [RATE_LIMIT_RULES],
	},
} as const satisfies Record<string, RuleTableData>;

export type TableId = keyof typeof TABLES;

export function isTableId(id: string): id is TableId {
	return Object.hasOwn(TABLES, id);
}

/** The line under a table: which rule sets, their version and check date. */
export function provenance(table: RuleTableData): string {
	return table.from
		.map((r) => `${r.title} (rules ${r.version}, checked ${r.verifiedAt})`)
		.join("; ");
}
