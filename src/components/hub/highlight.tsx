import type { ReactNode } from "react";

export type Lang = "json" | "bash" | "solidity" | "text";

type TokenKind =
	| "key"
	| "string"
	| "number"
	| "bool"
	| "null"
	| "punct"
	| "comment"
	| "keyword"
	| "type"
	| "plain";

interface Token {
	kind: TokenKind;
	text: string;
}

const CLASS: Record<TokenKind, string> = {
	key: "text-syn-key",
	string: "text-syn-string",
	number: "text-syn-number",
	bool: "text-syn-bool",
	null: "text-syn-null",
	punct: "text-syn-punct",
	comment: "text-syn-comment italic",
	keyword: "text-syn-bool",
	type: "text-syn-key",
	plain: "",
};

function tokenizeJson(src: string): Token[] {
	const out: Token[] = [];
	const re =
		/("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])|(\s+)|(.)/gy;
	let m: RegExpExecArray | null = re.exec(src);
	while (m !== null) {
		if (m[1] !== undefined) {
			if (m[2] !== undefined) {
				out.push({ kind: "key", text: m[1] });
				out.push({ kind: "punct", text: m[2] });
			} else out.push({ kind: "string", text: m[1] });
		} else if (m[3] !== undefined) out.push({ kind: "number", text: m[3] });
		else if (m[4] !== undefined) out.push({ kind: "bool", text: m[4] });
		else if (m[5] !== undefined) out.push({ kind: "null", text: m[5] });
		else if (m[6] !== undefined) out.push({ kind: "punct", text: m[6] });
		else out.push({ kind: "plain", text: m[0] });
		m = re.exec(src);
	}
	return out;
}

const SOL_KEYWORDS = new Set([
	"pragma",
	"solidity",
	"contract",
	"interface",
	"library",
	"function",
	"external",
	"internal",
	"public",
	"private",
	"view",
	"pure",
	"returns",
	"return",
	"memory",
	"calldata",
	"storage",
	"import",
	"struct",
	"event",
	"emit",
	"new",
	"if",
	"else",
	"for",
	"require",
	"constant",
	"immutable",
	"true",
	"false",
]);
const SOL_TYPES = /^(address|bool|string|bytes\d*|u?int\d*|mapping)$/;

function tokenizeCode(src: string, lang: "bash" | "solidity"): Token[] {
	const out: Token[] = [];
	const comment = lang === "bash" ? /#[^\n]*/y : /\/\/[^\n]*|\/\*[\s\S]*?\*\//y;
	const re =
		/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/gy;
	let i = 0;
	while (i < src.length) {
		comment.lastIndex = i;
		const c = comment.exec(src);
		if (c && c.index === i) {
			out.push({ kind: "comment", text: c[0] });
			i += c[0].length;
			continue;
		}
		re.lastIndex = i;
		const m = re.exec(src);
		if (!m) break;
		if (m[1] !== undefined) out.push({ kind: "string", text: m[1] });
		else if (m[2] !== undefined) out.push({ kind: "number", text: m[2] });
		else if (m[3] !== undefined) {
			const w = m[3];
			if (lang === "solidity" && SOL_KEYWORDS.has(w))
				out.push({ kind: "keyword", text: w });
			else if (lang === "solidity" && SOL_TYPES.test(w))
				out.push({ kind: "type", text: w });
			else if (lang === "bash" && /^(cast|curl|send|call|export)$/.test(w))
				out.push({ kind: "keyword", text: w });
			else out.push({ kind: "plain", text: w });
		} else if (m[4] !== undefined) out.push({ kind: "plain", text: m[4] });
		else out.push({ kind: "punct", text: m[0] });
		i += m[0].length;
	}
	return out;
}

export function highlight(src: string, lang: Lang): ReactNode[] {
	if (lang === "text") return [src];
	const tokens = lang === "json" ? tokenizeJson(src) : tokenizeCode(src, lang);
	return tokens.map((t, i) =>
		t.kind === "plain" ? (
			t.text
		) : (
			// biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional and static per render
			<span key={i} className={CLASS[t.kind]}>
				{t.text}
			</span>
		),
	);
}
