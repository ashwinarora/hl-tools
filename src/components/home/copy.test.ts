/**
 * The home page speaks for the Multisig, so it keeps the section's promises
 * about wording: none of the forbidden claims (no secrecy, no price, no "no
 * server"), and the section's own words for what happens (the finaliser
 * sends, never "submits"; Hyperliquid's record, never "the ledger" or "the
 * chain"; the hl-tools server, never "the relay" or "the sharing service").
 * The developer tools' vocabulary (RPC, payload, HyperCore) stays allowed:
 * their cards are for developers. A line that must break a rule says why in a `wording:` comment.
 *
 * Only text that reads as a sentence is checked, as in the section's
 * `jargon.test.ts`: string literals with a space, and JSX text, outside
 * attributes that hold code.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_CLAIMS } from "#/components/multisig/model/relay/copy";
import { TOOLS } from "#/lib/tools";
import { MULTISIG, SITE } from "./facts";

const SECTION_WORDS: readonly RegExp[] = [
	/\brelay\b/i,
	/\bledger\b/i,
	/\bthe chain\b/i,
	/\bon[ -]?chain\b/i,
	/\bsubmi(t|ts|tted|tting|ssion|ssions)\b/i,
	/\bsigner set\b/i,
	/\bre-?propos/i,
	// the section's word for its server is "hl-tools server" (CLAUDE.md)
	/\bsharing service\b/i,
];

const RULES = [...FORBIDDEN_CLAIMS, ...SECTION_WORDS];

const HERE = new URL(".", import.meta.url).pathname;
const SRC = new URL("../../", import.meta.url).pathname;
const HOME = join(SRC, "routes/index.tsx");

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path);
		return /\.tsx?$/.test(name) && !/\.(test|itest)\.tsx?$/.test(name)
			? [path]
			: [];
	});
}

const CODE_ATTRIBUTES = new Set([
	"className",
	"id",
	"htmlFor",
	"key",
	"to",
	"href",
	"name",
	"type",
	"variant",
	"size",
	"role",
	"rel",
	"target",
	"inputMode",
	"autoComplete",
]);

interface Found {
	readonly where: string;
	readonly text: string;
}

function sentences(path: string): Found[] {
	const source = readFileSync(path, "utf8");
	const lines = source.split("\n");
	const file = ts.createSourceFile(
		path,
		source,
		ts.ScriptTarget.Latest,
		true,
		path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const out: Found[] = [];
	const allowed = (line: number) =>
		/wording:/.test(lines[line] ?? "") ||
		/wording:/.test(lines[line - 1] ?? "");
	const code = (node: ts.Node): boolean => {
		const parent = node.parent;
		if (!parent) return false;
		if (
			ts.isImportDeclaration(parent) ||
			ts.isExportDeclaration(parent) ||
			ts.isLiteralTypeNode(parent) ||
			(ts.isPropertyAssignment(parent) && parent.name === node) ||
			ts.isElementAccessExpression(parent)
		)
			return true;
		if (ts.isJsxAttribute(parent) || ts.isJsxExpression(parent)) {
			const attribute = ts.isJsxAttribute(parent)
				? parent
				: ts.isJsxAttribute(parent.parent)
					? parent.parent
					: null;
			const name = attribute?.name.getText(file) ?? "";
			if (CODE_ATTRIBUTES.has(name) || name.startsWith("data-")) return true;
		}
		return false;
	};
	const visit = (node: ts.Node) => {
		let text: string | null = null;
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
			text = code(node) ? null : node.text;
		else if (
			ts.isTemplateHead(node) ||
			ts.isTemplateMiddle(node) ||
			ts.isTemplateTail(node)
		)
			text = node.text;
		else if (ts.isJsxText(node)) text = node.text;
		if (text !== null && (ts.isJsxText(node) || /\s/.test(text.trim()))) {
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
			if (!allowed(line))
				out.push({
					where: `${relative(SRC, path)}:${line + 1}`,
					text: text.replace(/\s+/g, " ").trim(),
				});
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return out;
}

const broken = (found: readonly Found[]) =>
	found.flatMap((f) =>
		RULES.filter((r) => r.test(f.text)).map(
			(r) => `${f.where} ${r.source}: ${f.text.slice(0, 120)}`,
		),
	);

describe("the home page's wording", () => {
	it("makes none of the forbidden claims and uses the Multisig's words", () => {
		const found = [...files(HERE), HOME].flatMap(sentences);
		expect(found.length).toBeGreaterThan(20);
		expect(broken(found)).toEqual([]);
	});

	it("keeps the facts it states within the same rules", () => {
		const deck = JSON.stringify({ MULTISIG, SITE });
		expect(RULES.filter((r) => r.test(deck)).map((r) => r.source)).toEqual([]);
	});

	it("describes the two sections that sign in the Multisig's words", () => {
		const said = TOOLS.filter((t) => t.writes).flatMap((t) => [
			t.title,
			t.description,
			t.answers,
		]);
		expect(
			said.flatMap((s) => RULES.filter((r) => r.test(s)).map(() => s)),
		).toEqual([]);
	});
});
