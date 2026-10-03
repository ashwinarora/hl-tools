// Builds the app with NO_CONTACT=true and fails if anything that leads to me is in what a
// visitor can receive. Run it with `npm run check:no-contact`. See README "No-contact mode".
//
// This app is server-rendered, so it checks two things:
//   1. every file in .output/public (the JS, CSS and other files the browser downloads), and
//   2. the responses of the built server itself, which it starts on a free local port,
//      requests each route from, and stops again.
// A contact detail left in the bundle behind a runtime check, or rendered only on the
// server, fails either way. To check an existing build without rebuilding: `--no-build`.
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(import.meta.url), "../..");
const output = join(repo, ".output");
const publicDir = join(output, "public");
const serverEntry = join(output, "server/index.mjs");

/** The server is started on the first free port in this range. */
const PORTS = [4811, 4812, 4813, 4814, 4815, 4816, 4817, 4818, 4819];

/** Requests made to the built server. Add every new route here. */
const REQUESTS = [
	{ path: "/", html: true },
	{ path: "/how-to-use", html: true },
	// An unknown path: the "Not Found" page is rendered inside the same header and footer.
	{ path: "/check-no-contact-unknown-path", html: true },
	// The MCP endpoint. `initialize` reads the server's name and capabilities and changes nothing.
	{
		path: "/mcp",
		method: "POST",
		body: {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "check-no-contact", version: "1.0.0" },
			},
		},
	},
];

if (!process.argv.includes("--no-build")) {
	// The WalletConnect id is only needed for the build and the server to run. A real
	// one is used if it is set; the placeholder never leaves this machine.
	const env = {
		...process.env,
		NO_CONTACT: "true",
		VITE_WALLETCONNECT_PROJECT_ID:
			process.env.VITE_WALLETCONNECT_PROJECT_ID || "check-no-contact",
	};
	execSync("npm run build", { cwd: repo, stdio: "inherit", env });
}

// The normal (not no-contact) domains of my sites. "showcase.hltools.tech" contains
// "hltools.tech", so each pattern excludes that prefix.
const NORMAL_DOMAINS = [
	"ashwinarora.com",
	"ashdex.app",
	"lizardpoisonspock.com",
	"hltools.tech",
	"ethtactoe.com",
	"socialnetwrk.in",
	"ethhousie.com",
];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const FORBIDDEN = [
	{
		name: "email address",
		pattern: /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi,
	},
	{ name: "mailto:", pattern: /mailto:/gi },
	{ name: "tel:", pattern: /\btel:/gi },
	{ name: "calendly", pattern: /calendly/gi },
	{ name: "t.me link", pattern: /(?<![a-z0-9-])t\.me\//gi },
	{ name: "wa.me link", pattern: /(?<![a-z0-9-])wa\.me\//gi },
	{ name: "telegram", pattern: /telegram/gi },
	{ name: "whatsapp", pattern: /whatsapp/gi },
	{ name: "linkedin", pattern: /linkedin/gi },
	{ name: "x.com", pattern: /(?<![a-z0-9-])x\.com(?![a-z0-9-])/gi },
	{ name: "twitter.com", pattern: /twitter\.com/gi },
	{
		name: "twitter:creator / twitter:site",
		pattern: /twitter:(?:creator|site)/gi,
	},
	{ name: "my GitHub", pattern: /github\.com\/ashwin\w*/gi },
	{ name: "my name or handle", pattern: /(?<!github\.com\/)ashwin/gi },
	{
		name: "link to the source",
		pattern: /Star on GitHub|View source|Open source/gi,
	},
	{ name: "discord", pattern: /discord/gi },
	...NORMAL_DOMAINS.map((domain) => ({
		name: `normal domain ${domain}`,
		pattern: new RegExp(
			`(?<!showcase\\.)(?<![a-z0-9-])${escapeRegExp(domain)}`,
			"gi",
		),
	})),
];

// Matches that are known not to lead to me: strings inside the wallet libraries that ship
// in the bundle. Every entry is a hole in the check, so each one is limited to the files
// it was found in (`file`), the patterns it answers (`what`) and the exact text the match
// must be part of (`text`), and says why it is safe. None of them can apply to a page the
// server returns. Never allow a whole directory, and never allow anything in our own
// code: remove it instead.
const ALLOWED = [
	{
		why: "Reown AppKit and WalletConnect (the WalletConnect option in RainbowKit) test whether they are running inside Telegram's in-app browser, and remember it under this key. Detection code, no link.",
		file: /^assets\/(?:core|basic|index\.es)-[\w-]{8}\.js$/,
		what: ["telegram"],
		text: /\bisTelegram\(\)|window\.Telegram(?:WebviewProxy(?:Proto)?)?\b|\b(?:get|set|remove)TelegramSocialProvider\b|\bformatTelegramSocialLoginUrl\b|\bTELEGRAM_SOCIAL_PROVIDER\b|"Unable to (?:get|set|remove) telegram social provider"/g,
	},
	{
		why: "Reown AppKit's default list of social sign-in providers, a feature this app does not turn on. Names only, no link.",
		file: /^assets\/core-[\w-]{8}\.js$/,
		what: ["discord"],
		text: /socials:\["google","x","discord","farcaster","github","apple","facebook"\]/g,
	},
	{
		why: "Reown AppKit's icon set: the table that loads each icon on demand. Drawings, no link.",
		file: /^assets\/index-[\w-]{8}\.js$/,
		what: ["telegram", "discord"],
		text: /\b(?:telegram|discord):async\(\)=>|\{(?:telegram|discord)Svg:\w+\}|\)\.(?:telegram|discord)Svg\b|"(?:\.\/|assets\/)(?:telegram|discord)-[\w-]{8}\.js"/g,
	},
	{
		why: "Reown AppKit's icon set: the two icon files that table points at, by name and by export.",
		file: /^assets\/(?:telegram|discord)-[\w-]{8}\.js$/,
		what: ["telegram", "discord"],
		text: /^assets\/(?:telegram|discord)-[\w-]{8}\.js$|\bexport\{\w+ as (?:telegram|discord)Svg\}/g,
	},
	{
		why: "Safe Apps SDK (wagmi's Safe connector): its list of social platform names. Names only, no link.",
		file: /^assets\/index-[\w-]{8}\.js$/,
		what: ["telegram", "discord"],
		text: /\b\w+\.(DISCORD|TELEGRAM)="\1"/g,
	},
	{
		why: "MetaMask SDK: an error message of the Stencil runtime it is built with, naming Stencil's own community server.",
		file: /^assets\/metamask-sdk-[\w-]{8}\.js$/,
		what: ["discord"],
		text: /report this on the Stencil Discord server \(https:\/\/chat\.stenciljs\.com\)/g,
	},
	{
		why: "ua-parser-js (in RainbowKit and in the Base Account SDK): the rule that recognises LinkedIn's in-app browser from a user-agent string.",
		file: /^assets\/(?:main|index)-[\w-]{8}\.js$/,
		what: ["linkedin"],
		text: /\/\\{1,2}\[\(linkedin\)app\\{1,2}\]\/i/g,
	},
	{
		why: "TanStack Router: the URL schemes it accepts in a link, its guard against javascript: URLs. A list, not a link.",
		file: /^assets\/main-[\w-]{8}\.js$/,
		what: ["mailto:", "tel:"],
		text: /\["http:","https:","mailto:","tel:"\]/g,
	},
	{
		why: "React DOM: its table of <input> types that take text, of which `tel` is one.",
		file: /^assets\/main-[\w-]{8}\.js$/,
		what: ["tel:"],
		text: /\bsearch:!0,tel:!0,text:!0\b/g,
	},
];

/** Characters of context around a match: shown in a finding, and searched by ALLOWED. */
const CONTEXT = 80;

const findings = [];
const used = new Set();

function scan(source, text) {
	for (const { name, pattern } of FORBIDDEN) {
		for (const hit of text.matchAll(pattern)) {
			const from = Math.max(0, hit.index - CONTEXT);
			const context = text.slice(from, hit.index + hit[0].length + CONTEXT);
			const start = hit.index - from;
			const end = start + hit[0].length;
			// An entry applies only if its text contains the match itself, not just sits near it.
			const allowed = ALLOWED.find(
				(entry) =>
					entry.what.includes(name) &&
					entry.file.test(source) &&
					[...context.matchAll(entry.text)].some(
						(found) =>
							found.index <= start && found.index + found[0].length >= end,
					),
			);
			if (allowed) used.add(allowed);
			else
				findings.push({
					source,
					what: name,
					match: hit[0],
					context: context.replace(/\s+/g, " "),
				});
		}
	}
}

async function walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) =>
			entry.isDirectory()
				? walk(join(dir, entry.name))
				: [join(dir, entry.name)],
		),
	);
	return files.flat();
}

// 1. Every file the browser can download. Images are read as text too, which covers
//    their metadata; what an image shows is not something this script can see.
const files = await walk(publicDir);
for (const file of files) {
	const name = relative(publicDir, file);
	scan(name, name);
	scan(name, await readFile(file, "utf8"));
}

// 2. What the built server returns.
function portIsFree(port) {
	return new Promise((done) => {
		const probe = createServer();
		probe.once("error", () => done(false));
		probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)));
	});
}

async function freePort() {
	for (const port of PORTS) {
		if (await portIsFree(port)) return port;
	}
	throw new Error(`No free port in ${PORTS[0]}-${PORTS.at(-1)}`);
}

if (!existsSync(serverEntry)) {
	throw new Error(`${serverEntry} does not exist. Run without --no-build.`);
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [serverEntry], {
	cwd: repo,
	env: {
		...process.env,
		PORT: String(port),
		HOST: "127.0.0.1",
		NODE_NO_WARNINGS: "1",
	},
	stdio: ["ignore", "ignore", "inherit"],
});
const exited = new Promise((done) => server.once("exit", done));
// The server closes its port on SIGTERM but the wallet libraries keep the process
// alive afterwards, so it is killed outright. Nothing it holds needs a clean shutdown.
const stop = () => server.kill("SIGKILL");
process.once("exit", stop);

async function waitForServer() {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (server.exitCode !== null)
			throw new Error("The built server exited before it could be checked");
		try {
			await fetch(origin, { signal: AbortSignal.timeout(2000) });
			return;
		} catch {
			await new Promise((done) => setTimeout(done, 200));
		}
	}
	throw new Error(`The built server did not answer on ${origin}`);
}

let responses = 0;
try {
	await waitForServer();
	for (const { path, method = "GET", body, html } of REQUESTS) {
		const source = `${method} ${path}`;
		const response = await fetch(origin + path, {
			method,
			headers: body ? { "content-type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(15000),
		});
		const text = await response.text();
		const headers = [...response.headers]
			.map(([key, value]) => `${key}: ${value}`)
			.join("\n");
		scan(source, `${headers}\n\n${text}`);
		responses += 1;
		if (html && !/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(text)) {
			findings.push({
				source,
				what: "missing noindex",
				match: '<meta name="robots" content="noindex, nofollow">',
			});
		}
	}
} finally {
	stop();
	await exited;
}

for (const entry of ALLOWED) {
	if (!used.has(entry)) {
		console.warn(
			`check:no-contact: allowlist entry matched nothing and can be removed: ${entry.what.join(", ")} in ${entry.file}`,
		);
	}
}

if (findings.length > 0) {
	console.error(
		`\ncheck:no-contact FAILED: ${findings.length} finding(s) in .output\n`,
	);
	for (const finding of findings) {
		console.error(
			`  ${finding.source}: ${finding.what}: ${JSON.stringify(finding.match)}`,
		);
		if (finding.context) console.error(`      …${finding.context}…`);
	}
	console.error(
		'\nGate the UI on NO_CONTACT (src/lib/noContact.ts). See README "No-contact mode".',
	);
	process.exit(1);
}

console.log(
	`check:no-contact passed: ${files.length} files in .output/public and ${responses} server responses (${REQUESTS.map((request) => request.path).join(", ")}) checked`,
);
