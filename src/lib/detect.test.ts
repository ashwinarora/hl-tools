import { encodeProposal } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { linkTransport } from "#/components/multisig/model/transport";
import { makeProposal, TREASURY } from "#/test/keys";
import { detectInput } from "./detect";
import { shareFragment } from "./share";

const tool = (v: string) => detectInput(v)?.tool ?? null;

describe("detectInput", () => {
	it("sends proposal documents and proposal links to the signer", () => {
		const p = makeProposal();
		expect(tool(encodeProposal(p))).toBe("multisig-sign");
		expect(tool(encodeProposal(p, { pretty: true }))).toBe("multisig-sign");
		const link = linkTransport(() => "https://hltools.test").publish(p).url;
		expect(detectInput(link as string)).toEqual({
			tool: "multisig-sign",
			reason:
				"Multi-sig proposal link → Multisig Signer (review, sign, submit)",
		});
	});

	it("keeps envelopes and addresses with the inspector", () => {
		expect(
			tool('{"action":{"type":"multiSig","signatures":[]},"nonce":1}'),
		).toBe("multisig");
		expect(tool('{"type":"multiSig","signatures":[]}')).toBe("multisig");
		expect(tool(TREASURY)).toBe("multisig");
	});

	it("does not mistake other links for proposals", () => {
		expect(tool("https://rpc.hyperliquid.xyz/evm")).toBe("rpc");
		// a share link of another tool, and a fragment that is not a share at all
		expect(
			tool(
				`https://hltools.test/tools/signing#${shareFragment("signing", { a: 1 })}`,
			),
		).toBe("rpc");
		expect(tool("https://example.org/#share=garbage")).toBe("rpc");
		expect(tool("wss://api.hyperliquid.xyz/ws")).toBe("websocket");
	});

	it("still routes everything else as before", () => {
		expect(tool("")).toBeNull();
		expect(tool(`0x${"ab".repeat(32)}`)).toBe("trace");
		expect(tool("0x01000001aabbccdd")).toBe("corewriter");
		expect(tool(`0x${"ab".repeat(16)}`)).toBe("assets");
		expect(tool("HYPE")).toBe("assets");
		expect(tool('{"status":"ok","response":{}}')).toBe("orders");
		expect(tool('{"method":"subscribe","subscription":{}}')).toBe("websocket");
		expect(tool('{"action":{"type":"order"},"nonce":1}')).toBe("signing");
		expect(tool("[1,2]")).toBe("orders");
		expect(tool("Order must have minimum value of $10.")).toBe("orders");
		expect(
			tool(
				"a long question   with wide gaps that is certainly not a symbol or anything else we know",
			),
		).toBeNull();
	});
});
