/**
 * Import boundaries that keep promises made elsewhere:
 *  - the read-only tools never load the signer's code (wallet libraries, the
 *    relay client), so "read-only, no wallet" stays true for their chunks;
 *  - the Supabase client is loaded in one place only, on demand;
 *  - the signer's model stays pure (no React, no wallet, no network client),
 *    which is what lets it be tested without a browser.
 * A bundler would not tell us when one of these breaks; this does.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return files(path);
		return /\.(ts|tsx)$/.test(name) ? [path] : [];
	});
}

interface Import {
	readonly file: string;
	readonly spec: string;
	/** `import type` / `export type`: erased at build, loads nothing. */
	readonly typeOnly: boolean;
}

const IMPORT =
	/(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(path: string): Import[] {
	const file = relative(SRC, path);
	const text = readFileSync(path, "utf8");
	const out: Import[] = [];
	for (const m of text.matchAll(IMPORT)) {
		const spec = m[3] ?? m[4];
		if (spec) out.push({ file, spec, typeOnly: !!m[2] });
	}
	return out;
}

const isTest = (file: string) =>
	/\.(test|itest)\.tsx?$/.test(file) || file.startsWith("test/");
const all = files(SRC).flatMap(importsOf);
const runtime = all.filter((i) => !i.typeOnly && !isTest(i.file));
const offenders = (list: Import[]) => list.map((i) => `${i.file} → ${i.spec}`);

/** A specifier that reaches into the signer (alias or relative). */
const intoSigner = (i: Import) =>
	/^#\/components\/multisig(\/|$)/.test(i.spec) ||
	/^#\/routes\/multisig(\/|$)/.test(i.spec);
const inSigner = (file: string) =>
	file.startsWith("components/multisig/") ||
	file.startsWith("routes/multisig/");
const intoRelayRuntime = (i: Import) =>
	/^#\/components\/multisig\/relay(\/|$)/.test(i.spec) ||
	(i.file.startsWith("components/multisig/") &&
		/(^|\/)relay\//.test(i.spec) &&
		!i.file.startsWith("components/multisig/model/"));

describe("import boundaries", () => {
	it("found the source tree", () => {
		expect(all.length).toBeGreaterThan(500);
		expect(all.some((i) => i.file === "lib/detect.ts")).toBe(true);
	});

	it("loads the Supabase client in one module only", () => {
		const supabase = runtime.filter((i) => i.spec.startsWith("@supabase/"));
		expect(
			offenders(
				supabase.filter(
					(i) => i.file !== "components/multisig/relay/client.ts",
				),
			),
		).toEqual([]);
	});

	it("mentions Supabase types only inside the relay runtime", () => {
		const typed = all.filter(
			(i) => i.spec.startsWith("@supabase/") && !isTest(i.file),
		);
		expect(
			offenders(
				typed.filter((i) => !i.file.startsWith("components/multisig/relay/")),
			),
		).toEqual([]);
	});

	it("keeps the relay runtime inside the signer", () => {
		expect(
			offenders(
				runtime.filter((i) => intoRelayRuntime(i) && !inSigner(i.file)),
			),
		).toEqual([]);
	});

	it("keeps the signer out of the read-only tools", () => {
		const tools = runtime.filter(
			(i) =>
				i.file.startsWith("components/tools/") ||
				i.file.startsWith("routes/tools/") ||
				i.file.startsWith("components/hub/"),
		);
		expect(offenders(tools.filter(intoSigner))).toEqual([]);
	});

	it("lets the rest of the app reach into the signer for its pure model only", () => {
		const outside = runtime.filter((i) => !inSigner(i.file) && intoSigner(i));
		expect(
			offenders(
				outside.filter(
					(i) => !/^#\/components\/multisig\/model\//.test(i.spec),
				),
			),
		).toEqual([]);
	});

	it("keeps the signer's model pure: the core, viem, shared helpers, and itself", () => {
		const MODEL = "components/multisig/model/";
		const allowed = (i: Import) => {
			if (i.spec.startsWith(".")) {
				// a relative import must stay inside the model
				const target = posix.normalize(
					posix.join(posix.dirname(i.file), i.spec),
				);
				return target.startsWith(MODEL);
			}
			return (
				i.spec === "@hl-tools/core" ||
				/^viem(\/|$)/.test(i.spec) ||
				/^#\/lib\//.test(i.spec) ||
				// another tool's own pure model
				/^#\/components\/tools\/[a-z]+\/model$/.test(i.spec)
			);
		};
		const model = runtime.filter((i) => i.file.startsWith(MODEL));
		expect(model.length).toBeGreaterThan(20);
		expect(offenders(model.filter((i) => !allowed(i)))).toEqual([]);
	});

	it("keeps the home page's paste detection free of everything but the model", () => {
		const detect = runtime.filter((i) => i.file === "lib/detect.ts");
		expect(
			offenders(
				detect.filter(
					(i) => intoSigner(i) && !/\/model\/transport$/.test(i.spec),
				),
			),
		).toEqual([]);
	});
});
