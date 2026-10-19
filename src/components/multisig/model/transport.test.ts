import {
	decodeProposal,
	encodeProposal,
	judgeMove,
	PROPOSAL_SIZE_WARN_BYTES,
	type Proposal,
	tieSteps,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { parseShareFragment, shareFragment } from "#/lib/share";
import { makeProposal, NONCE, NOW, signAs } from "#/test/keys";
import {
	documentFromFragment,
	documentsFromFragment,
	fileTransport,
	linkTransport,
	moveFilename,
	moveText,
	openAll,
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

describe("a move travels as one link or one file", () => {
	const HEAD = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
	const X = "0x946bf3135c7d15e4462b510f74b6e304aabb5b21";
	/** "Stake 100 HYPE with X", both steps signed by A. A whole number above 2^53 rides along. */
	const move = async (): Promise<[Proposal, Proposal]> => {
		const [one, two] = tieSteps(
			makeProposal({
				action: {
					type: "cDeposit",
					...HEAD,
					wei: 9_007_199_300_000_000n,
					nonce: NONCE,
				},
			}),
			makeProposal({
				action: {
					type: "tokenDelegate",
					...HEAD,
					validator: X,
					wei: 9_007_199_300_000_000n,
					isUndelegate: false,
					nonce: NONCE + 1,
				},
				nonce: NONCE + 1,
			}),
		);
		return [await signAs(one, 1), await signAs(two, 1)];
	};

	it("the link carries both, and a build from before moves still finds step 1 where it looks", async () => {
		const [one, two] = await move();
		const out = link.publish(one, [two]);
		const hash = new URL(out.url as string).hash;
		expect(documentsFromFragment(hash)).toEqual([
			encodeProposal(one),
			encodeProposal(two),
		]);
		expect(documentFromFragment(hash)).toBe(encodeProposal(one));
		expect(new URL(out.url as string).search).toBe("");
		// the size that matters is that of both
		expect(link.publish(one).bytes).toBeLessThan(out.bytes);
	});

	it("opens whole from the link: both steps, exact, and still one move", async () => {
		const [one, two] = await move();
		const opened = openAll(link.publish(one, [two]).url as string, NOW);
		expect(opened.issues).toEqual([]);
		expect(opened.proposals).toEqual([one, two]);
		const [a, b] = opened.proposals as [Proposal, Proposal];
		expect(a.payload.action.wei).toBe(9_007_199_300_000_000n);
		// the documents name no proposer here, so the page is told who it was
		expect(judgeMove(a, b, { a: "0xaa", b: "0xaa" }).move?.kind).toBe("stake");
	});

	it("the file holds both steps as they are written by themselves", async () => {
		const [one, two] = await move();
		const saved: [string, string][] = [];
		const out = fileTransport((name, text) => saved.push([name, text])).publish(
			one,
			[two],
		);
		expect(out.filename).toBe(moveFilename(one));
		expect(out.filename).toMatch(/^multisig-testnet-[0-9a-f]{8}-move\.json$/);
		const text = saved[0]?.[1] as string;
		expect(text).toBe(moveText([one, two]));
		expect(text).toContain(encodeProposal(one, { pretty: true }));
		expect(openAll(text, NOW).proposals).toEqual([one, two]);
		// a single proposal's file is what it always was
		const single = fileTransport(() => undefined).publish(one);
		expect(single.filename).toBe(proposalFilename(one));
	});

	it("opens one proposal as before, from its link, its file or its text", async () => {
		const p = await signAs(makeProposal(), 1);
		for (const source of [
			link.publish(p).url as string,
			encodeProposal(p, { pretty: true }),
			encodeProposal(p),
		])
			expect(openAll(source, NOW)).toEqual({ proposals: [p], issues: [] });
	});

	it("opens a move whole or not at all", async () => {
		const [one, two] = await move();
		// the second step's own digest no longer fits its payload
		const broken = moveText([one, two]).replace(
			`"digest": "${two.digest}"`,
			`"digest": "0x${"00".repeat(32)}"`,
		);
		expect(broken).not.toBe(moveText([one, two]));
		const opened = openAll(broken, NOW);
		expect(opened.proposals).toEqual([]);
		expect(opened.issues.map((i) => i.code)).toContain(
			"proposal.digest_mismatch",
		);
		expect(opened.issues[0]?.message).toMatch(/^Step 2: /);
	});

	it("says what does not open", () => {
		expect(openAll("not a proposal").proposals).toEqual([]);
		expect(openAll("not a proposal").issues.length).toBeGreaterThan(0);
		expect(
			openAll(
				`${ORIGIN}/x#${shareFragment("signing", { doc: "{}" })}`,
			).issues.map((i) => i.code),
		).toEqual(["transport.link"]);
		// a fragment whose extra documents are not text carries only the first
		const odd = `${ORIGIN}${PROPOSAL_PATH}#${shareFragment(SHARE_TOOL, {
			doc: encodeProposal(makeProposal()),
			also: [1, null],
		})}`;
		expect(openAll(odd).proposals).toHaveLength(1);
	});
});
