import { describe, expect, it } from "vitest";
import { A, B, C } from "#/test/keys";
import { type RelayActionsInput, relayActions } from "./status";

const input = (over: Partial<RelayActionsInput> = {}): RelayActionsInput => ({
	known: true,
	status: "open",
	expired: false,
	me: A,
	createdBy: A,
	finaliser: B,
	relaySigners: [],
	isSigner: true,
	objected: [],
	...over,
});
const NONE = {
	takeBack: false,
	withdraw: false,
	sayNo: false,
	takeBackNo: false,
};

describe("relayActions", () => {
	it("lets the proposer withdraw, and say no like anyone", () => {
		expect(relayActions(input())).toEqual({
			takeBack: false,
			withdraw: true,
			sayNo: true,
			takeBackNo: false,
		});
	});

	it("gives the finaliser the same no as every other signer: nobody but the proposer ends a proposal", () => {
		const finaliser = relayActions(input({ me: B }));
		const plain = relayActions(input({ me: C }));
		expect(finaliser).toEqual({
			takeBack: false,
			withdraw: false,
			sayNo: true,
			takeBackNo: false,
		});
		expect(plain).toEqual(finaliser);
		expect(Object.keys(finaliser)).not.toContain("decline");
	});

	it("one position at a time: a no that stands is taken back, not said again", () => {
		expect(relayActions(input({ me: C, objected: [C] }))).toEqual({
			takeBack: false,
			withdraw: false,
			sayNo: false,
			takeBackNo: true,
		});
		// somebody else's no changes nothing about one's own choices
		expect(relayActions(input({ me: C, objected: [B] })).sayNo).toBe(true);
		// a signer who signed can say no (it takes the signature back) or take the signature back
		expect(relayActions(input({ me: C, relaySigners: [C] }))).toEqual({
			takeBack: true,
			withdraw: false,
			sayNo: true,
			takeBackNo: false,
		});
	});

	it("offers a no only to a signer of the treasury", () => {
		// an outsider, or anyone on a former multi-sig
		expect(relayActions(input({ me: C, isSigner: false }))).toEqual(NONE);
		// a no left by somebody who is no longer a signer can still be taken back by them
		expect(
			relayActions(input({ me: C, isSigner: false, objected: [C] })).takeBackNo,
		).toBe(true);
	});

	it("lets any signer take back their own signature, and only if it is on the relay", () => {
		expect(relayActions(input({ me: C, relaySigners: [C] })).takeBack).toBe(
			true,
		);
		expect(relayActions(input({ me: C, relaySigners: [A, B] })).takeBack).toBe(
			false,
		);
		expect(relayActions(input({ relaySigners: [A] }))).toMatchObject({
			takeBack: true,
			withdraw: true,
		});
	});

	it("offers nothing once the proposal is over, expired, unknown to the relay, or nobody is signed in", () => {
		const all = { me: A, relaySigners: [A], objected: [A] } as const;
		expect(relayActions(input({ ...all, status: "withdrawn" }))).toEqual(NONE);
		expect(relayActions(input({ ...all, status: "declined" }))).toEqual(NONE);
		expect(relayActions(input({ ...all, status: "accepted" }))).toEqual(NONE);
		expect(relayActions(input({ ...all, status: "carried_out" }))).toEqual(
			NONE,
		);
		expect(relayActions(input({ ...all, expired: true }))).toEqual(NONE);
		expect(relayActions(input({ ...all, known: false }))).toEqual(NONE);
		expect(relayActions(input({ ...all, me: null }))).toEqual(NONE);
	});
});
