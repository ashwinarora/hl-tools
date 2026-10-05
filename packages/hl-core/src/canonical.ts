/**
 * Canonical shapes of L1 actions.
 *
 * The exchange re-serialises the action it parsed and hashes *that*, so an
 * action whose keys are in a different order, whose decimals carry trailing
 * zeros, or whose addresses are upper-case, hashes differently from what the
 * server computes — and the server recovers a different (usually unknown)
 * signer. Key orders here follow the official Python SDK.
 */

import { Decimal } from "./decimal.ts";
import { type Issue, issue } from "./issues.ts";
import {
	isIntegerLexeme,
	type JsonEntry,
	type JsonNode,
	type JsonObject,
} from "./json.ts";
import { CLOID_RE, GROUPINGS } from "./rules/orders.ts";

export type Shape =
	| { kind: "object"; fields: readonly FieldShape[]; allowExtra?: boolean }
	| { kind: "array"; of: Shape }
	| { kind: "decimal" }
	| { kind: "int" }
	| { kind: "bool" }
	| { kind: "string" }
	| { kind: "address" }
	| { kind: "cloid" }
	| { kind: "literal"; value: string }
	| { kind: "enum"; values: readonly string[] }
	/** Object with exactly one of the listed keys. */
	| { kind: "oneOf"; options: readonly FieldShape[] }
	| { kind: "grouping" }
	/** oid (int) or cloid (hex string) */
	| { kind: "oidOrCloid" };

export interface FieldShape {
	readonly name: string;
	readonly shape: Shape;
	readonly optional?: boolean;
	/** Must be omitted rather than set to this value (e.g. cancel `f: false`). */
	readonly omitWhen?: boolean;
	readonly doc?: string;
}

const d: Shape = { kind: "decimal" };
const int: Shape = { kind: "int" };
const bool: Shape = { kind: "bool" };
const str: Shape = { kind: "string" };
const addr: Shape = { kind: "address" };
const obj = (fields: FieldShape[]): Shape => ({ kind: "object", fields });
const fld = (
	name: string,
	shape: Shape,
	extra: Partial<Omit<FieldShape, "name" | "shape">> = {},
): FieldShape => ({ name, shape, ...extra });
const type = (value: string) => fld("type", { kind: "literal", value });

const ORDER_WIRE = obj([
	fld("a", int, { doc: "asset" }),
	fld("b", bool, { doc: "isBuy" }),
	fld("p", d, { doc: "limit price" }),
	fld("s", d, { doc: "size" }),
	fld("r", bool, { doc: "reduceOnly" }),
	fld("t", {
		kind: "oneOf",
		options: [
			fld(
				"limit",
				obj([
					fld("tif", {
						kind: "enum",
						values: ["Gtc", "Ioc", "Alo", "FrontendMarket"],
					}),
				]),
			),
			fld(
				"trigger",
				obj([
					fld("isMarket", bool),
					fld("triggerPx", d),
					fld("tpsl", { kind: "enum", values: ["tp", "sl"] }),
				]),
			),
		],
	}),
	fld("c", { kind: "cloid" }, { optional: true, doc: "cloid" }),
]);

export const L1_ACTION_SHAPES: Readonly<Record<string, Shape>> = {
	order: obj([
		type("order"),
		fld("orders", { kind: "array", of: ORDER_WIRE }),
		fld("grouping", { kind: "grouping" }),
		fld("builder", obj([fld("b", addr), fld("f", int)]), { optional: true }),
	]),
	cancel: obj([
		type("cancel"),
		fld("cancels", { kind: "array", of: obj([fld("a", int), fld("o", int)]) }),
		fld("f", bool, { optional: true, omitWhen: false }),
	]),
	cancelByCloid: obj([
		type("cancelByCloid"),
		fld("cancels", {
			kind: "array",
			of: obj([fld("asset", int), fld("cloid", { kind: "cloid" })]),
		}),
		fld("f", bool, { optional: true, omitWhen: false }),
	]),
	modify: obj([
		type("modify"),
		fld("oid", { kind: "oidOrCloid" }),
		fld("order", ORDER_WIRE),
	]),
	batchModify: obj([
		type("batchModify"),
		fld("modifies", {
			kind: "array",
			of: obj([fld("oid", { kind: "oidOrCloid" }), fld("order", ORDER_WIRE)]),
		}),
	]),
	scheduleCancel: obj([
		type("scheduleCancel"),
		fld("time", int, { optional: true }),
	]),
	updateLeverage: obj([
		type("updateLeverage"),
		fld("asset", int),
		fld("isCross", bool),
		fld("leverage", int),
	]),
	updateIsolatedMargin: obj([
		type("updateIsolatedMargin"),
		fld("asset", int),
		fld("isBuy", bool),
		fld("ntli", int),
	]),
	twapOrder: obj([
		type("twapOrder"),
		fld(
			"twap",
			obj([
				fld("a", int),
				fld("b", bool),
				fld("s", d),
				fld("r", bool),
				fld("m", int),
				fld("t", bool),
			]),
		),
	]),
	twapCancel: obj([type("twapCancel"), fld("a", int), fld("t", int)]),
	vaultTransfer: obj([
		type("vaultTransfer"),
		fld("vaultAddress", addr),
		fld("isDeposit", bool),
		fld("usd", int),
	]),
	subAccountTransfer: obj([
		type("subAccountTransfer"),
		fld("subAccountUser", addr),
		fld("isDeposit", bool),
		fld("usd", int),
	]),
	subAccountSpotTransfer: obj([
		type("subAccountSpotTransfer"),
		fld("subAccountUser", addr),
		fld("isDeposit", bool),
		fld("token", str),
		fld("amount", d),
	]),
	createSubAccount: obj([type("createSubAccount"), fld("name", str)]),
	setReferrer: obj([type("setReferrer"), fld("code", str)]),
	evmUserModify: obj([type("evmUserModify"), fld("usingBigBlocks", bool)]),
	reserveRequestWeight: obj([type("reserveRequestWeight"), fld("weight", int)]),
	noop: obj([type("noop")]),
};

function num(node: JsonNode): string | null {
	return node.kind === "number" ? node.raw : null;
}

export interface CanonicalResult {
	/** The canonical form of the action (same as input if already canonical). */
	readonly canonical: JsonNode;
	readonly issues: readonly Issue[];
	/** True if canonicalisation changed anything that affects the hash. */
	readonly changed: boolean;
	/** Whether a canonical shape exists for this action type. */
	readonly known: boolean;
}

/**
 * Lint an action against its canonical shape and return the canonical form.
 * Unknown action types are returned unchanged with an info issue.
 */
export function canonicalizeAction(action: JsonNode): CanonicalResult {
	const issues: Issue[] = [];
	if (action.kind !== "object") {
		return {
			canonical: action,
			issues: [
				issue(
					"action.not_object",
					"error",
					"The action must be a JSON object.",
				),
			],
			changed: false,
			known: false,
		};
	}
	const typeNode = action.entries.find((e) => e.key === "type")?.value;
	if (!typeNode || typeNode.kind !== "string") {
		return {
			canonical: action,
			issues: [
				issue(
					"action.no_type",
					"error",
					'The action needs a string "type" field.',
					{ path: "type" },
				),
			],
			changed: false,
			known: false,
		};
	}
	const shape = L1_ACTION_SHAPES[typeNode.value];
	if (!shape) {
		return {
			canonical: action,
			issues: [
				issue(
					"action.unknown_shape",
					"info",
					`No canonical shape for "${typeNode.value}" in hl-core; the payload is hashed exactly as written. Key order still matters.`,
				),
			],
			changed: false,
			known: false,
		};
	}
	let changed = false;
	const markChanged = () => {
		changed = true;
	};
	const canonical = walk(action, shape, "", issues, markChanged);
	return { canonical, issues, changed, known: true };
}

function walk(
	node: JsonNode,
	shape: Shape,
	path: string,
	issues: Issue[],
	markChanged: () => void,
): JsonNode {
	const at = path || "(root)";
	switch (shape.kind) {
		case "literal":
			if (node.kind !== "string" || node.value !== shape.value) {
				issues.push(
					issue("field.literal", "error", `Expected "${shape.value}".`, {
						path: at,
					}),
				);
			}
			return node;
		case "string":
			if (node.kind !== "string") {
				issues.push(
					issue("field.type", "error", "Expected a string.", { path: at }),
				);
			}
			return node;
		case "bool":
			if (node.kind !== "bool") {
				issues.push(
					issue("field.type", "error", "Expected true or false.", { path: at }),
				);
			}
			return node;
		case "int": {
			const raw = num(node);
			if (raw === null || !isIntegerLexeme(raw)) {
				issues.push(
					issue(
						"field.type",
						"error",
						node.kind === "string"
							? "Expected an integer number, got a string."
							: "Expected an integer.",
						{
							path: at,
							fix: "Integers (asset IDs, oids, usd amounts) are JSON numbers, not strings.",
						},
					),
				);
			}
			return node;
		}
		case "enum":
			if (node.kind !== "string" || !shape.values.includes(node.value)) {
				issues.push(
					issue(
						"field.enum",
						"error",
						`Expected one of ${shape.values.map((v) => `"${v}"`).join(", ")}.`,
						{
							path: at,
						},
					),
				);
			}
			return node;
		case "decimal": {
			if (node.kind === "number") {
				issues.push(
					issue(
						"decimal.not_string",
						"error",
						`Prices and sizes must be strings; got the number ${node.raw}.`,
						{
							path: at,
							fix: `Use "${node.raw}".`,
						},
					),
				);
				const parsed = Decimal.tryParse(node.raw);
				if (parsed) {
					markChanged();
					return {
						kind: "string",
						value: parsed.toString(),
						start: node.start,
						end: node.end,
					};
				}
				return node;
			}
			if (node.kind !== "string") {
				issues.push(
					issue("field.type", "error", "Expected a decimal string.", {
						path: at,
					}),
				);
				return node;
			}
			const parsed = Decimal.tryParse(node.value);
			if (
				!parsed ||
				!/^\d+(\.\d+)?$/.test(node.value.replace(/^-/, "")) ||
				node.value.startsWith("-")
			) {
				issues.push(
					issue(
						"decimal.invalid",
						"error",
						`"${node.value}" is not a plain non-negative decimal.`,
						{ path: at },
					),
				);
				return node;
			}
			const canonical = parsed.toString();
			if (canonical !== node.value) {
				issues.push(
					issue(
						"decimal.not_canonical",
						"error",
						`"${node.value}" is hashed as-is but the server hashes "${canonical}". Trailing/leading zeros change the signature.`,
						{ path: at, fix: `Use "${canonical}".` },
					),
				);
				markChanged();
				return { ...node, value: canonical };
			}
			return node;
		}
		case "address": {
			if (node.kind !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(node.value)) {
				issues.push(
					issue(
						"address.invalid",
						"error",
						"Expected a 0x-prefixed 20-byte address.",
						{ path: at },
					),
				);
				return node;
			}
			const lower = node.value.toLowerCase();
			if (lower !== node.value) {
				issues.push(
					issue(
						"address.uppercase",
						"error",
						"Addresses must be lower-case before signing; the network lowercases fields parsed as bytes, so a mixed-case address hashes differently.",
						{ path: at, fix: `Use "${lower}".` },
					),
				);
				markChanged();
				return { ...node, value: lower };
			}
			return node;
		}
		case "cloid": {
			if (node.kind !== "string" || !CLOID_RE.test(node.value)) {
				issues.push(
					issue(
						"cloid.invalid",
						"error",
						"A cloid is 16 bytes of hex: 0x followed by 32 hex digits.",
						{
							path: at,
						},
					),
				);
				return node;
			}
			const lower = node.value.toLowerCase();
			if (lower !== node.value) {
				issues.push(
					issue(
						"cloid.uppercase",
						"warning",
						"Use lower-case hex for cloids.",
						{ path: at },
					),
				);
				markChanged();
				return { ...node, value: lower };
			}
			return node;
		}
		case "oidOrCloid":
			if (node.kind === "string")
				return walk(node, { kind: "cloid" }, path, issues, markChanged);
			return walk(node, { kind: "int" }, path, issues, markChanged);
		case "grouping":
			if (node.kind === "string") {
				if (!(GROUPINGS as readonly string[]).includes(node.value)) {
					issues.push(
						issue(
							"grouping.invalid",
							"error",
							`grouping must be "na", "normalTpsl", "positionTpsl" or {"p": n}.`,
							{
								path: at,
							},
						),
					);
				}
				return node;
			}
			if (node.kind === "object") {
				return walk(node, obj([fld("p", int)]), path, issues, markChanged);
			}
			issues.push(
				issue("grouping.invalid", "error", "Invalid grouping.", { path: at }),
			);
			return node;
		case "array":
			if (node.kind !== "array") {
				issues.push(
					issue("field.type", "error", "Expected an array.", { path: at }),
				);
				return node;
			}
			if (node.items.length === 0) {
				issues.push(
					issue(
						"array.empty",
						"error",
						"Empty batches are rejected in pre-validation.",
						{ path: at },
					),
				);
			}
			return {
				...node,
				items: node.items.map((it, i) =>
					walk(it, shape.of, `${path}[${i}]`, issues, markChanged),
				),
			};
		case "oneOf": {
			if (node.kind !== "object" || node.entries.length !== 1) {
				issues.push(
					issue(
						"field.oneOf",
						"error",
						`Expected an object with exactly one of: ${shape.options.map((o) => o.name).join(", ")}.`,
						{
							path: at,
						},
					),
				);
				return node;
			}
			const [entry] = node.entries as [JsonEntry];
			const option = shape.options.find((o) => o.name === entry.key);
			if (!option) {
				issues.push(
					issue("field.oneOf", "error", `Unexpected key "${entry.key}".`, {
						path: at,
					}),
				);
				return node;
			}
			return {
				...node,
				entries: [
					{
						...entry,
						value: walk(
							entry.value,
							option.shape,
							`${path}.${entry.key}`,
							issues,
							markChanged,
						),
					},
				],
			};
		}
		case "object":
			return walkObject(node, shape, path, issues, markChanged);
	}
}

function walkObject(
	node: JsonNode,
	shape: Extract<Shape, { kind: "object" }>,
	path: string,
	issues: Issue[],
	markChanged: () => void,
): JsonNode {
	const at = path || "(root)";
	if (node.kind !== "object") {
		issues.push(
			issue("field.type", "error", "Expected an object.", { path: at }),
		);
		return node;
	}
	const obj: JsonObject = node;
	const known = new Set(shape.fields.map((f) => f.name));
	const out: JsonEntry[] = [];
	for (const field of shape.fields) {
		const entry = obj.entries.find((e) => e.key === field.name);
		const childPath = path ? `${path}.${field.name}` : field.name;
		if (!entry) {
			if (!field.optional) {
				issues.push(
					issue(
						"field.missing",
						"error",
						`Missing required field "${field.name}".`,
						{ path: childPath },
					),
				);
			}
			continue;
		}
		if (
			field.omitWhen !== undefined &&
			entry.value.kind === "bool" &&
			entry.value.value === field.omitWhen
		) {
			issues.push(
				issue(
					"field.must_omit",
					"error",
					`"${field.name}": ${String(field.omitWhen)} must be omitted entirely; actions hashed with it are rejected.`,
					{ path: childPath, fix: `Remove "${field.name}".` },
				),
			);
			markChanged();
			continue;
		}
		out.push({
			...entry,
			value: walk(entry.value, field.shape, childPath, issues, markChanged),
		});
	}
	for (const e of obj.entries) {
		if (!known.has(e.key) && !shape.allowExtra) {
			issues.push(
				issue(
					"field.unknown",
					"error",
					`Unknown field "${e.key}" — it is hashed but the server ignores or rejects it.`,
					{
						path: path ? `${path}.${e.key}` : e.key,
						fix: `Remove "${e.key}".`,
					},
				),
			);
			markChanged();
		}
	}
	const inputOrder = obj.entries
		.filter((e) => known.has(e.key))
		.map((e) => e.key);
	const canonicalOrder = out.map((e) => e.key);
	if (
		inputOrder.join(",") !== canonicalOrder.join(",") &&
		inputOrder.length === canonicalOrder.length
	) {
		issues.push(
			issue(
				"field.order",
				"error",
				`Key order ${inputOrder.join(", ")} differs from the canonical ${canonicalOrder.join(", ")}. MsgPack preserves key order, so the hash differs from the server's.`,
				{ path: at, fix: "Reorder the keys (use Canonicalise)." },
			),
		);
		markChanged();
	}
	return { ...obj, entries: out };
}
