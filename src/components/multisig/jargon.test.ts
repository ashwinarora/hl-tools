/**
 * The section's screens in plain words: every sentence a reader can meet
 * (string literals, template text, JSX text) is checked against the words
 * a newcomer cannot be expected to know (`HELP_JARGON`). The help texts and
 * the relay's copy have their own tests; this one covers everything else,
 * so the screens cannot drift back.
 *
 * Only text that reads as a sentence is checked: a string with a space in
 * it, or JSX text. Codes, keys and class names have none. A line that has to
 * use such a word (an expert panel, a field named as the wallet shows it)
 * carries a comment with `jargon:` and why, on that line or the one above.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { HELP_JARGON } from "./model/help";

/**
 * The section's own vocabulary on top of the help texts' list: the finaliser
 * sends (never "submits"), Hyperliquid's record (never "the ledger" or "the
 * chain"), the sharing service (never "the relay"), the signers (never "the
 * signer set"), proposing again (never "re-proposing"). A vault's "leader"
 * is Hyperliquid's own word for the one who trades it, and stays.
 */
const SCREEN_WORDS: readonly RegExp[] = [
	...HELP_JARGON,
	/\brelay\b/i,
	/\bledger\b/i,
	/\bthe chain\b/i,
	/\bsubmi(t|ts|tted|tting|ssion|ssions)\b/i,
	/\bon chain\b/i,
	/\bsigner set\b/i,
	/\bre-?propos/i,
];

const ROOT = new URL(".", import.meta.url).pathname;
/** The section's routes say things too. */
const ROUTES = new URL("../../routes/multisig/", import.meta.url).pathname;

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path);
		return /\.tsx?$/.test(name) && !/\.(test|itest)\.tsx?$/.test(name)
			? [path]
			: [];
	});
}

/** Attributes whose value is code, not text a reader sees. */
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
	"tone",
	"role",
	"inputMode",
	"autoComplete",
	"rel",
	"target",
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
		/jargon:/.test(lines[line] ?? "") || /jargon:/.test(lines[line - 1] ?? "");
	const code = (node: ts.Node): boolean => {
		const parent = node.parent;
		if (!parent) return false;
		if (
			ts.isImportDeclaration(parent) ||
			ts.isExportDeclaration(parent) ||
			ts.isLiteralTypeNode(parent) ||
			(ts.isPropertyAssignment(parent) && parent.name === node) ||
			ts.isElementAccessExpression(parent) ||
			ts.isCaseClause(parent)
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
		// a comparison or a call that takes the text as a key: `x === "…"`, `.includes("…")`
		if (ts.isBinaryExpression(parent)) return true;
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
					where: `${relative(ROOT, path)}:${line + 1}`,
					text: text.replace(/\s+/g, " ").trim(),
				});
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return out;
}

describe("the section's screens, in plain words", () => {
	it("say none of the words a newcomer cannot be expected to know", () => {
		const found = [...files(ROOT), ...files(ROUTES)].flatMap(sentences);
		expect(found.length).toBeGreaterThan(1000);
		const jargon = found.flatMap((f) =>
			SCREEN_WORDS.filter((p) => p.test(f.text)).map(
				(p) => `${f.where} ${p.source}: ${f.text.slice(0, 120)}`,
			),
		);
		expect(jargon).toEqual([]);
	});
});
