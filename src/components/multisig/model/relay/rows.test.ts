import { describe, expect, it } from "vitest";
import { A, B, C, makeProposal, signAs, TREASURY } from "#/test/keys";
import { rawProposal, rowFor } from "#/test/relayRows";
import {
	addressList,
	eventRows,
	proposalRows,
	requestRows,
	treasuryRows,
} from "./rows";

const ISO = "2026-10-09T18:54:44.915368+00:00";
const treasury = (over: Record<string, unknown> = {}) => ({
	network: "testnet",
	address: TREASURY,
	threshold: 2,
	frozen_at: null,
	checked_at: ISO,
	changed_at: ISO,
	added_by: A,
	created_at: ISO,
	treasury_signers: [{ signer: C }, { signer: A }, { signer: B }],
	...over,
});

describe("treasuryRows", () => {
	it("reads a treasury with its signers, sorted, and timestamps as unix ms", () => {
		const { rows, dropped } = treasuryRows([treasury()]);
		expect(dropped).toBe(0);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.signers).toEqual([A, B, C].sort());
		expect(rows[0]?.checkedAt).toBe(Date.parse(ISO));
		expect(rows[0]?.frozenAt).toBeNull();
	});

	it("reads a frozen treasury", () => {
		const { rows } = treasuryRows([treasury({ frozen_at: ISO })]);
		expect(rows[0]?.frozenAt).toBe(Date.parse(ISO));
	});

	it.each([
		[
			"an uppercase address",
			{ address: TREASURY.toUpperCase().replace("0X", "0x") },
		],
		["a short address", { address: "0x1234" }],
		["an unknown network", { network: "devnet" }],
		["a threshold above the signer count", { threshold: 4 }],
		["a zero threshold", { threshold: 0 }],
		["a fractional threshold", { threshold: 1.5 }],
		["a malformed signer", { treasury_signers: [{ signer: "0xnope" }] }],
		["signers that are not a list", { treasury_signers: null }],
		["a timestamp that is not a date", { checked_at: "yesterday" }],
		["a missing adder", { added_by: null }],
	])("drops a row with %s", (_label, over) => {
		const { rows, dropped } = treasuryRows([treasury(), treasury(over)]);
		expect(rows).toHaveLength(1);
		expect(dropped).toBe(1);
	});

	it("survives anything that is not a list of objects", () => {
		expect(treasuryRows(null)).toEqual({ rows: [], dropped: 0 });
		expect(treasuryRows(undefined)).toEqual({ rows: [], dropped: 0 });
		expect(treasuryRows("oops")).toEqual({ rows: [], dropped: 1 });
		expect(treasuryRows([1, null, "x", []])).toEqual({ rows: [], dropped: 4 });
	});
});

describe("proposalRows", () => {
	it("round-trips what PostgREST returns for a signed proposal", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 2);
		const row = rowFor(p);
		const { rows, dropped } = proposalRows([rawProposal(row)]);
		expect(dropped).toBe(0);
		expect(rows[0]).toEqual(row);
	});

	it("reads an ending as an object, as a one-item list, or as nothing", () => {
		const row = rowFor(makeProposal());
		const ending = { kind: "withdrawn", ended_by: A, ended_at: ISO };
		const read = (endings: unknown) =>
			proposalRows([{ ...rawProposal(row), endings }]).rows[0]?.ending;
		expect(read(ending)).toEqual({
			kind: "withdrawn",
			endedBy: A,
			endedAt: Date.parse(ISO),
		});
		expect(read([ending])?.kind).toBe("withdrawn");
		expect(read(null)).toBeNull();
		expect(read([])).toBeNull();
	});

	it("sorts receipts by submission time", () => {
		const row = rowFor(makeProposal());
		const receipt = (submitted_at: number) => ({
			submitted_at,
			submitted_by: B,
			signature_chain_id: "0x3e6",
			outer_r: `0x${"11".repeat(32)}`,
			outer_s: `0x${"22".repeat(32)}`,
			outer_v: 28,
			http_status: 200,
			response: "{}",
			accepted: false,
			recorded_at: ISO,
		});
		const { rows } = proposalRows([
			{
				...rawProposal(row),
				receipts: [receipt(30), receipt(10), receipt(20)],
			},
		]);
		expect(rows[0]?.receipts.map((r) => r.submittedAt)).toEqual([10, 20, 30]);
	});

	it.each([
		["an unknown status", { status: "cancelled" }],
		["a digest that is not 32 bytes", { digest: "0x1234" }],
		["a document that is not text", { document: { v: 1 } }],
		["a nonce that is a string", { nonce: "1791399781235" }],
		[
			"a signature with a bad recovery id",
			{
				signatures: [
					{
						signer: A,
						r: `0x${"11".repeat(32)}`,
						s: `0x${"22".repeat(32)}`,
						v: 1,
						created_at: ISO,
					},
				],
			},
		],
		[
			"a signature with a short r",
			{
				signatures: [
					{
						signer: A,
						r: "0x11",
						s: `0x${"22".repeat(32)}`,
						v: 27,
						created_at: ISO,
					},
				],
			},
		],
		[
			"a receipt with a bad chain id",
			{
				receipts: [
					{
						submitted_at: 1,
						submitted_by: B,
						signature_chain_id: "998",
						outer_r: `0x${"11".repeat(32)}`,
						outer_s: `0x${"22".repeat(32)}`,
						outer_v: 27,
						http_status: 200,
						response: "{}",
						accepted: true,
						recorded_at: ISO,
					},
				],
			},
		],
		[
			"an ending of an unknown kind",
			{ endings: { kind: "cancelled", ended_by: A, ended_at: ISO } },
		],
	])("drops a row with %s", (_label, over) => {
		const raw = rawProposal(rowFor(makeProposal()));
		const { rows, dropped } = proposalRows([{ ...raw, ...over }]);
		expect(rows).toEqual([]);
		expect(dropped).toBe(1);
	});

	it("treats only a literal true as accepted", () => {
		const row = rowFor(makeProposal());
		const receipt = {
			submitted_at: 1,
			submitted_by: B,
			signature_chain_id: "0x3e6",
			outer_r: `0x${"11".repeat(32)}`,
			outer_s: `0x${"22".repeat(32)}`,
			outer_v: 27,
			http_status: 200,
			response: "{}",
			accepted: "yes",
			recorded_at: ISO,
		};
		const { rows } = proposalRows([
			{ ...rawProposal(row), receipts: [receipt] },
		]);
		expect(rows[0]?.receipts[0]?.accepted).toBe(false);
	});
});

describe("eventRows", () => {
	const event = (over: Record<string, unknown> = {}) => ({
		id: 7,
		network: "testnet",
		treasury: TREASURY,
		digest: null,
		kind: "treasury_added",
		actor: A,
		data: { signers: [A, B], threshold: 2 },
		at: ISO,
		...over,
	});

	it("reads an event", () => {
		expect(eventRows([event()]).rows[0]).toEqual({
			id: 7,
			network: "testnet",
			treasury: TREASURY,
			digest: null,
			kind: "treasury_added",
			actor: A,
			data: { signers: [A, B], threshold: 2 },
			at: Date.parse(ISO),
		});
	});

	it("reads an event without an actor or data", () => {
		const row = eventRows([
			event({ actor: null, data: null, kind: "treasury_frozen" }),
		]).rows[0];
		expect(row?.actor).toBeNull();
		expect(row?.data).toEqual({});
	});

	it("drops an event of a kind this version does not know", () => {
		expect(eventRows([event({ kind: "treasury_renamed" })])).toEqual({
			rows: [],
			dropped: 1,
		});
	});
});

describe("requestRows", () => {
	it("reads a request", () => {
		const { rows } = requestRows([
			{
				id: "a3b00b57-1c89-4ba6-a51c-f7369db44ecf",
				network: "testnet",
				address: TREASURY,
				kind: "add",
				status: "rejected",
				reason: "not_a_signer",
				created_at: ISO,
				finished_at: ISO,
			},
		]);
		expect(rows[0]?.status).toBe("rejected");
		expect(rows[0]?.reason).toBe("not_a_signer");
		expect(rows[0]?.finishedAt).toBe(Date.parse(ISO));
	});

	it("drops a request with an unknown status", () => {
		expect(
			requestRows([
				{
					id: "x",
					network: "testnet",
					address: TREASURY,
					kind: "add",
					status: "queued",
					reason: null,
					created_at: ISO,
					finished_at: null,
				},
			]).dropped,
		).toBe(1);
	});
});

describe("addressList", () => {
	it("keeps well-formed lowercase addresses only", () => {
		expect(addressList([A, "0xNOPE", 5, null, B.toUpperCase()])).toEqual([A]);
		expect(addressList("nope")).toEqual([]);
		expect(addressList(undefined)).toEqual([]);
	});
});
