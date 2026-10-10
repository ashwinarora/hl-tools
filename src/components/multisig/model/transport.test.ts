import {
	decodeProposal,
	encodeProposal,
	PROPOSAL_SIZE_WARN_BYTES,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { parseShareFragment, shareFragment } from "#/lib/share";
import { makeProposal, signAs } from "#/test/keys";
import {
	documentFromFragment,
	fileTransport,
	linkTransport,
	openText,
	PROPOSAL_PATH,
	proposalFilename,
	SHARE_TOOL,
	sizeIssues,
} from "./transport";

const ORIGIN = "https://hltools.test";
const link = linkTransport(() => ORIGIN);

describe("link transport", () => {
	it("puts the whole document in the fragment of the proposal page", async () => {
		const p = await signAs(makeProposal(), 1);
		const out = link.publish(p);
		expect(out.transport).toBe("link");
		expect(out.url?.startsWith(`${ORIGIN}${PROPOSAL_PATH}#share=`)).toBe(true);
		expect(out.bytes).toBe(out.url?.length);
		expect(out.issues).toEqual([]);
		// nothing of the document is in the path or a query string
		const url = new URL(out.url as string);
		expect(url.pathname).toBe("/multisig/proposal");
		expect(url.search).toBe("");
		const doc = documentFromFragment(url.hash);
		expect(doc).toBe(encodeProposal(p));
		expect(decodeProposal(doc as string).proposal).toEqual(p);
	});

	it("warns when the document is larger than links survive", () => {
		expect(sizeIssues(PROPOSAL_SIZE_WARN_BYTES)).toEqual([]);
		const over = sizeIssues(PROPOSAL_SIZE_WARN_BYTES + 1);
		expect(over.map((i) => [i.code, i.severity])).toEqual([
			["transport.oversize", "warning"],
		]);
		expect(over[0]?.fix).toBe("Send the file instead of the link.");
	});

	it("reads only fragments made for proposals", () => {
		expect(documentFromFragment("#share=not-base64!")).toBeNull();
		expect(documentFromFragment("#other=1")).toBeNull();
		expect(
			documentFromFragment(`#${shareFragment("signing", { doc: "x" })}`),
		).toBeNull();
		expect(
			documentFromFragment(`#${shareFragment(SHARE_TOOL, { doc: 5 })}`),
		).toBeNull();
		expect(
			documentFromFragment(shareFragment(SHARE_TOOL, { doc: "text" })),
		).toBe("text");
	});
});

describe("parseShareFragment", () => {
	const b64 = (v: unknown) =>
		`share=${Buffer.from(JSON.stringify(v)).toString("base64url")}`;
	it("accepts v1 payloads with or without the hash sign and rejects the rest", () => {
		const ok = { v: 1, tool: "t", state: { a: 1 } };
		expect(parseShareFragment(b64(ok))).toEqual(ok);
		expect(parseShareFragment(`#${b64(ok)}`)).toEqual(ok);
		for (const bad of [
			{ v: 2, tool: "t", state: {} },
			{ v: 1, tool: 7, state: {} },
			{ v: 1, tool: "t", state: "x" },
			{ v: 1, tool: "t", state: null },
		])
			expect(parseShareFragment(b64(bad))).toBeNull();
		expect(parseShareFragment("share=%%%")).toBeNull();
		expect(parseShareFragment("")).toBeNull();
	});
});

describe("file transport", () => {
	it("saves pretty JSON under a name that says network, digest and signatures", async () => {
		const p = await signAs(makeProposal(), 1);
		const saved: [string, string][] = [];
		const out = fileTransport((name, text) => saved.push([name, text])).publish(
			p,
		);
		expect(out.filename).toBe(
			`multisig-testnet-${p.digest.slice(2, 10)}-1sig.json`,
		);
		expect(proposalFilename({ ...p, signatures: [] })).toMatch(/-0sig\.json$/);
		expect(saved).toHaveLength(1);
		expect(saved[0]?.[0]).toBe(out.filename);
		expect(saved[0]?.[1]).toContain('\n  "payload": {');
		expect(out.bytes).toBe(saved[0]?.[1].length);
		expect(decodeProposal(saved[0]?.[1] as string).proposal).toEqual(p);
	});
});

describe("openText", () => {
	it("opens a document, a pretty document and a pasted link alike", async () => {
		const p = await signAs(makeProposal(), 1);
		expect(openText(encodeProposal(p)).proposal).toEqual(p);
		expect(
			openText(`\n${encodeProposal(p, { pretty: true })}\n`).proposal,
		).toEqual(p);
		expect(openText(` ${link.publish(p).url} `).proposal).toEqual(p);
	});

	it("explains what it cannot open", () => {
		expect(openText("{oops").issues.map((i) => i.code)).toEqual([
			"proposal.parse",
		]);
		const wrong = openText(
			`${ORIGIN}/tools/signing#${shareFragment("signing", { a: 1 })}`,
		);
		expect(wrong.proposal).toBeNull();
		expect(wrong.issues.map((i) => i.code)).toEqual(["transport.link"]);
		// a JSON document that merely mentions a share link is still treated as a document
		expect(
			openText('{"note":"see https://x/#share=abc"}').issues.map((i) => i.code),
		).not.toContain("transport.link");
		expect(openText('{"v":2}').proposal).toBeNull();
	});
});
