/**
 * Rows as the relay returns them, read defensively. The relay is a database
 * the browser does not control: a row is input like a pasted document is, so
 * every field is checked for shape here and anything malformed is dropped and
 * counted, never passed on. (Whether a signature is genuine is decided later,
 * by recovering it.)
 */
import type { Address, Hex, Network } from "@hl-tools/core";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH32 = /^0x[0-9a-f]{64}$/;
const CHAIN_ID = /^0x[0-9a-f]{1,16}$/;

export type ProposalStatus = "open" | "withdrawn" | "declined" | "accepted";
export type RequestStatus = "pending" | "done" | "rejected" | "failed";
export type RequestKind = "add" | "check";
export type EndingKind = "withdrawn" | "declined";

export const EVENT_KINDS = [
	"treasury_added",
	"signers_changed",
	"treasury_frozen",
	"treasury_unfrozen",
	"proposal_created",
	"signature_added",
	"signature_removed",
	"proposal_withdrawn",
	"proposal_declined",
	"submission_recorded",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface TreasuryRow {
	readonly network: Network;
	readonly address: Address;
	readonly threshold: number;
	/** Unix ms; null while the account is a multi-sig. */
	readonly frozenAt: number | null;
	readonly checkedAt: number;
	readonly changedAt: number;
	readonly addedBy: Address;
	readonly createdAt: number;
	/** Lowercase, sorted. */
	readonly signers: readonly Address[];
}

export interface SignatureRow {
	readonly signer: Address;
	readonly r: Hex;
	readonly s: Hex;
	readonly v: 27 | 28;
	readonly createdAt: number;
}

export interface EndingRow {
	readonly kind: EndingKind;
	readonly endedBy: Address;
	readonly endedAt: number;
}

export interface ReceiptRow {
	readonly submittedAt: number;
	readonly submittedBy: Address;
	readonly signatureChainId: Hex;
	readonly outerR: Hex;
	readonly outerS: Hex;
	readonly outerV: 27 | 28;
	readonly httpStatus: number;
	/** The exchange's answer as JSON text, exactly as the finaliser's browser encoded it. */
	readonly response: string;
	/** The relay's reading of `response`; display only, the browser re-derives it. */
	readonly accepted: boolean;
	readonly recordedAt: number;
}

export interface ProposalRow {
	readonly network: Network;
	readonly treasury: Address;
	readonly digest: Hex;
	readonly document: string;
	readonly createdBy: Address;
	readonly finaliser: Address;
	readonly nonce: number;
	readonly expiresAt: number;
	readonly status: ProposalStatus;
	readonly closedAt: number | null;
	readonly createdAt: number;
	readonly signatures: readonly SignatureRow[];
	readonly ending: EndingRow | null;
	readonly receipts: readonly ReceiptRow[];
}

export interface EventRow {
	readonly id: number;
	readonly network: Network;
	readonly treasury: Address;
	readonly digest: Hex | null;
	readonly kind: EventKind;
	readonly actor: Address | null;
	readonly data: Readonly<Record<string, unknown>>;
	readonly at: number;
}

export interface RequestRow {
	readonly id: string;
	readonly network: Network;
	readonly address: Address;
	readonly kind: RequestKind;
	readonly status: RequestStatus;
	readonly reason: string | null;
	readonly createdAt: number;
	readonly finishedAt: number | null;
}

export interface Parsed<T> {
	readonly rows: readonly T[];
	/** Rows that did not have the expected shape and were left out. */
	readonly dropped: number;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw =>
	!!v && typeof v === "object" && !Array.isArray(v);

/** Thrown inside a row reader; the row is dropped. */
class Bad extends Error {}
const bad = (): never => {
	throw new Bad();
};

const address = (v: unknown): Address =>
	typeof v === "string" && ADDRESS.test(v) ? (v as Address) : bad();
const hash = (v: unknown): Hex =>
	typeof v === "string" && HASH32.test(v) ? (v as Hex) : bad();
const network = (v: unknown): Network =>
	v === "mainnet" || v === "testnet" ? v : bad();
const int = (v: unknown): number =>
	typeof v === "number" && Number.isSafeInteger(v) ? v : bad();
const text = (v: unknown): string => (typeof v === "string" ? v : bad());
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T =>
	typeof v === "string" && (all as readonly string[]).includes(v)
		? (v as T)
		: bad();
const recid = (v: unknown): 27 | 28 => (v === 27 || v === 28 ? v : bad());
/** A Postgres timestamp (ISO text) as unix ms. */
const time = (v: unknown): number => {
	const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
	return Number.isFinite(t) ? t : bad();
};
const optional = <T>(v: unknown, read: (x: unknown) => T): T | null =>
	v === null || v === undefined ? null : read(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : bad());

function each<T>(data: unknown, read: (r: Raw) => T): Parsed<T> {
	if (!Array.isArray(data)) return { rows: [], dropped: data == null ? 0 : 1 };
	const rows: T[] = [];
	let dropped = 0;
	for (const item of data) {
		try {
			rows.push(read(isObj(item) ? item : bad()));
		} catch (e) {
			if (!(e instanceof Bad)) throw e;
			dropped += 1;
		}
	}
	return { rows, dropped };
}

export function treasuryRows(data: unknown): Parsed<TreasuryRow> {
	return each(data, (r) => {
		const signers = list(r.treasury_signers)
			.map((s) => address(isObj(s) ? s.signer : bad()))
			.sort();
		const threshold = int(r.threshold);
		if (threshold < 1 || threshold > signers.length) bad();
		return {
			network: network(r.network),
			address: address(r.address),
			threshold,
			frozenAt: optional(r.frozen_at, time),
			checkedAt: time(r.checked_at),
			changedAt: time(r.changed_at),
			addedBy: address(r.added_by),
			createdAt: time(r.created_at),
			signers,
		};
	});
}

function signatureRow(v: unknown): SignatureRow {
	const r = isObj(v) ? v : bad();
	return {
		signer: address(r.signer),
		r: hash(r.r),
		s: hash(r.s),
		v: recid(r.v),
		createdAt: time(r.created_at),
	};
}

function endingRow(v: unknown): EndingRow {
	const r = isObj(v) ? v : bad();
	return {
		kind: oneOf(r.kind, ["withdrawn", "declined"] as const),
		endedBy: address(r.ended_by),
		endedAt: time(r.ended_at),
	};
}

function receiptRow(v: unknown): ReceiptRow {
	const r = isObj(v) ? v : bad();
	const chain = text(r.signature_chain_id);
	if (!CHAIN_ID.test(chain)) bad();
	return {
		submittedAt: int(r.submitted_at),
		submittedBy: address(r.submitted_by),
		signatureChainId: chain as Hex,
		outerR: hash(r.outer_r),
		outerS: hash(r.outer_s),
		outerV: recid(r.outer_v),
		httpStatus: int(r.http_status),
		response: text(r.response),
		accepted: r.accepted === true,
		recordedAt: time(r.recorded_at),
	};
}

export function proposalRows(data: unknown): Parsed<ProposalRow> {
	return each(data, (r) => {
		// one ending at most: PostgREST embeds it as an object, or null
		const ending = Array.isArray(r.endings)
			? (r.endings[0] ?? null)
			: r.endings;
		return {
			network: network(r.network),
			treasury: address(r.treasury),
			digest: hash(r.digest),
			document: text(r.document),
			createdBy: address(r.created_by),
			finaliser: address(r.finaliser),
			nonce: int(r.nonce),
			expiresAt: time(r.expires_at),
			status: oneOf(r.status, [
				"open",
				"withdrawn",
				"declined",
				"accepted",
			] as const),
			closedAt: optional(r.closed_at, time),
			createdAt: time(r.created_at),
			signatures: list(r.signatures ?? []).map(signatureRow),
			ending: optional(ending, endingRow),
			receipts: list(r.receipts ?? [])
				.map(receiptRow)
				.sort((a, b) => a.submittedAt - b.submittedAt),
		};
	});
}

export function eventRows(data: unknown): Parsed<EventRow> {
	return each(data, (r) => ({
		id: int(r.id),
		network: network(r.network),
		treasury: address(r.treasury),
		digest: optional(r.digest, hash),
		kind: oneOf(r.kind, EVENT_KINDS),
		actor: optional(r.actor, address),
		data: isObj(r.data) ? r.data : {},
		at: time(r.at),
	}));
}

export function requestRows(data: unknown): Parsed<RequestRow> {
	return each(data, (r) => ({
		id: text(r.id),
		network: network(r.network),
		address: address(r.address),
		kind: oneOf(r.kind, ["add", "check"] as const),
		status: oneOf(r.status, ["pending", "done", "rejected", "failed"] as const),
		reason: optional(r.reason, text),
		createdAt: time(r.created_at),
		finishedAt: optional(r.finished_at, time),
	}));
}

/** Addresses out of an event's `data` field (signers, added, removed). */
export function addressList(v: unknown): Address[] {
	return Array.isArray(v)
		? v.filter((x): x is Address => typeof x === "string" && ADDRESS.test(x))
		: [];
}
