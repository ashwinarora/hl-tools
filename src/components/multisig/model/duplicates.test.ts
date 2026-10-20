import type { Proposal } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	makeProposal,
	NONCE,
	NOW,
	RECIPIENT,
	TREASURY,
	usdSend,
} from "#/test/keys";
import { LIKE_WAITING, likeWaiting, paymentOf } from "./duplicates";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import type { OnRecord } from "./signerSet";

const record = (p: Proposal, over: Partial<OnRecord> = {}): OnRecord => ({
	digest: p.digest,
	title: p.meta.title ?? "",
	proposal: p,
	status: "open",
	accepted: false,
	...over,
});
const sendAsset = (over: Record<string, unknown> = {}) => ({
	type: "sendAsset",
	signatureChainId: "0x3e6",
	hyperliquidChain: "Testnet",
	destination: RECIPIENT,
	sourceDex: "",
	destinationDex: "spot",
	token: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
	amount: "1",
	fromSubAccount: "",
	nonce: NONCE,
	...over,
});

describe("a payment proposed twice (decision D4, audit F-026)", () => {
	const first = makeProposal({ title: "Invoice 42" });

	it("finds a waiting proposal that pays the same amount of the same token to the same place", () => {
		const like = likeWaiting(usdSend(), [record(first)], {
			now: NOW,
			except: "0xother",
		});
		expect(like?.title).toBe("Invoice 42");
		// another kind of send that moves the same USDC there is the same payment
		expect(
			likeWaiting(sendAsset({ amount: "1.000" }), [record(first)], {
				now: NOW,
			}),
		).not.toBeNull();
		// an address written in capitals is the same address
		expect(
			likeWaiting(
				usdSend({ destination: RECIPIENT.toUpperCase().replace("0X", "0x") }),
				[record(first)],
				{ now: NOW },
			),
		).not.toBeNull();
	});

	it("is not the proposal itself, nor one that differs in amount, token or destination", () => {
		expect(
			likeWaiting(usdSend(), [record(first)], {
				now: NOW,
				except: first.digest,
			}),
		).toBeNull();
		for (const other of [
			usdSend({ amount: "1.000001" }),
			sendAsset({ token: "HYPE:0x7317beb7cceed72ef0b346074cc8e7ab" }),
			usdSend({ destination: TREASURY }),
		])
			expect(likeWaiting(other, [record(first)], { now: NOW })).toBeNull();
	});

	it("counts only proposals still waiting: never one sent, ended, refused or past its window", () => {
		for (const over of [
			{ accepted: true },
			{ status: "withdrawn" },
			{ status: "carried_out" },
		])
			expect(
				likeWaiting(usdSend(), [record(first, over)], { now: NOW }),
			).toBeNull();
		expect(
			likeWaiting(usdSend(), [record(first)], {
				now: NONCE + 3 * 86_400_000,
			}),
		).toBeNull();
	});

	it("leaves out moves between the treasury's own balances and actions that pay nobody", () => {
		expect(paymentOf(usdSend({ destination: TREASURY }), TREASURY)).toBeNull();
		expect(paymentOf({ type: "usdClassTransfer", amount: "1" })).toBeNull();
		expect(paymentOf({ type: "approveAgent" })).toBeNull();
		expect(
			paymentOf({ type: "withdraw3", destination: RECIPIENT, amount: "2" }),
		).toMatchObject({ kind: "withdrawal", token: "USDC" });
	});

	it("says it in words the section may use", () => {
		for (const claim of FORBIDDEN_CLAIMS)
			expect(LIKE_WAITING).not.toMatch(claim);
	});
});
