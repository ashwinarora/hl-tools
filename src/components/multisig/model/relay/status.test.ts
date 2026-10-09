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
	...over,
});
const NONE = { takeBack: false, withdraw: false, decline: false };

describe("relayActions", () => {
	it("lets the proposer withdraw", () => {
		expect(relayActions(input())).toEqual({
			takeBack: false,
			withdraw: true,
			decline: false,
		});
	});

	it("lets the finaliser decline", () => {
		expect(relayActions(input({ me: B }))).toEqual({
			takeBack: false,
			withdraw: false,
			decline: true,
		});
	});

	it("offers a proposer who is also the finaliser one way out, not two", () => {
		expect(relayActions(input({ finaliser: A }))).toEqual({
			takeBack: false,
			withdraw: true,
			decline: false,
		});
	});

	it("lets any signer take back their own signature, and only if it is on the relay", () => {
		expect(relayActions(input({ me: C, relaySigners: [C] })).takeBack).toBe(
			true,
		);
		expect(relayActions(input({ me: C, relaySigners: [A, B] }))).toEqual(NONE);
		expect(relayActions(input({ relaySigners: [A] }))).toEqual({
			takeBack: true,
			withdraw: true,
			decline: false,
		});
	});

	it("offers nothing once the proposal is over, expired, unknown to the relay, or nobody is signed in", () => {
		const all = { me: A, relaySigners: [A] } as const;
		expect(relayActions(input({ ...all, status: "withdrawn" }))).toEqual(NONE);
		expect(relayActions(input({ ...all, status: "declined" }))).toEqual(NONE);
		expect(relayActions(input({ ...all, status: "accepted" }))).toEqual(NONE);
		expect(relayActions(input({ ...all, expired: true }))).toEqual(NONE);
		expect(relayActions(input({ ...all, known: false }))).toEqual(NONE);
		expect(relayActions(input({ me: null, relaySigners: [A] }))).toEqual(NONE);
	});
});
