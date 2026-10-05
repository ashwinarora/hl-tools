/**
 * Cross-layer trace: HyperEVM transaction → CoreWriter actions → HyperCore.
 *
 * Every conclusion carries an evidence label:
 * - observed: read directly from the chain or the info API,
 * - inferred: derived from observed data by a stated rule or heuristic,
 * - unknown: could not be determined from available data.
 *
 * Network access is injected (`TraceDeps`) so traces can be replayed from
 * recorded responses in tests.
 */

import { type Hex, keccak256, toHex } from "viem";
import {
	type CoreWriterDecode,
	decodeCoreWriterAction,
} from "../corewriter/codec.ts";
import { Decimal } from "../decimal.ts";
import type { Network } from "../network.ts";
import { networkConfig } from "../network.ts";
import type { AssetUniverse } from "../resolver/metadata.ts";
import { hexToBigInt, type RpcExchange } from "../rpc/client.ts";
import {
	COREWRITER_ADDRESS,
	RAW_ACTION_TOPIC,
	TIF_ENCODING,
} from "../rules/corewriter.ts";
import { SYSTEM_ADDRESSES, tokenSystemAddress } from "../rules/hyperevm.ts";
import { ORDER_STATUSES } from "../rules/orders.ts";

export type Evidence = "observed" | "inferred" | "unknown";

export interface InfoExchange {
	readonly body: Record<string, unknown>;
	readonly response: unknown;
	readonly error: string | null;
}

export interface TraceDeps {
	readonly rpc: (method: string, params: unknown[]) => Promise<RpcExchange>;
	/** Same method against the other network's RPC (used only to explain a miss). */
	readonly otherRpc?: (
		method: string,
		params: unknown[],
	) => Promise<RpcExchange>;
	readonly info: (body: Record<string, unknown>) => Promise<InfoExchange>;
	readonly universe?: AssetUniverse<Network>;
	readonly now?: () => number;
}

export interface Comparison {
	readonly field: string;
	readonly expected: string;
	readonly observed: string | null;
	readonly match: boolean | null;
}

export interface Finding {
	readonly title: string;
	readonly evidence: Evidence;
	readonly detail: string;
	readonly tone?: "ok" | "warn" | "bad" | "neutral";
}

export interface ObservedEffect {
	readonly evidence: Evidence;
	readonly headline: string;
	readonly detail: string;
	readonly comparisons: readonly Comparison[];
	/** Milliseconds from EVM block timestamp to the Core event, when known. */
	readonly delayMs: number | null;
	readonly coreTime: number | null;
	readonly l1Hash: string | null;
	readonly data: unknown;
}

export interface ActionTrace {
	readonly logIndex: number;
	readonly sender: `0x${string}`;
	readonly dataHex: Hex;
	readonly decode: CoreWriterDecode;
	readonly supported: boolean;
	readonly expected: {
		readonly headline: string;
		readonly lines: readonly string[];
	} | null;
	readonly observed: ObservedEffect | null;
	readonly findings: readonly Finding[];
}

/**
 * An ERC-20 `Transfer` from a linked contract to a system address: HyperCore
 * credits `from` (not the EVM sender, not the calling contract) with the
 * amount scaled by the token's EVM decimals.
 */
export interface EvmToCoreTransfer {
	readonly logIndex: number;
	/** Emitting contract (the token's linked EVM contract). */
	readonly contract: string;
	/** The HyperCore account that gets credited. */
	readonly from: `0x${string}`;
	/** System address the tokens were sent to. */
	readonly to: `0x${string}`;
	/** Raw EVM units from the log. */
	readonly amount: bigint;
	/** Token resolved from spotMeta by the emitting contract, if linked. */
	readonly token: {
		readonly index: number;
		readonly name: string;
		readonly weiDecimals: number;
		readonly evmDecimals: number;
	} | null;
	/** Amount in token units (only when the token is known). */
	readonly humanAmount: string | null;
	/** True when `to` is the system address of the resolved token. */
	readonly systemAddressMatches: boolean | null;
}

export interface TransferTrace {
	readonly transfer: EvmToCoreTransfer;
	readonly expected: {
		readonly headline: string;
		readonly lines: readonly string[];
	};
	readonly observed: ObservedEffect;
	readonly findings: readonly Finding[];
}

export interface ReceiptSummary {
	readonly status: "success" | "reverted";
	readonly blockNumber: bigint;
	readonly blockHash: string;
	readonly blockTimestamp: number | null;
	readonly from: string;
	readonly to: string | null;
	readonly gasUsed: bigint;
	readonly effectiveGasPrice: bigint | null;
	readonly logCount: number;
	readonly coreWriterLogCount: number;
	readonly evmToCoreTransfers: readonly EvmToCoreTransfer[];
	readonly bigBlock: boolean | null;
}

export type TxTrace =
	| {
			readonly kind: "ok";
			readonly network: Network;
			readonly txHash: string;
			readonly observedAt: number;
			readonly receipt: ReceiptSummary;
			readonly actions: readonly ActionTrace[];
			/** EVM → Core token transfers, each checked against the recipient's ledger. */
			readonly transfers: readonly TransferTrace[];
			readonly rpcLog: readonly RpcExchange[];
			readonly infoLog: readonly InfoExchange[];
	  }
	| {
			readonly kind: "not-found";
			readonly network: Network;
			readonly txHash: string;
			readonly observedAt: number;
			readonly foundOnOtherNetwork: boolean | null;
			readonly rpcLog: readonly RpcExchange[];
	  }
	| {
			readonly kind: "error";
			readonly network: Network;
			readonly txHash: string;
			readonly observedAt: number;
			readonly message: string;
			readonly rpcLog: readonly RpcExchange[];
	  };

const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));

function isSystemAddress(addr: string): boolean {
	const a = addr.toLowerCase();
	return (
		a.startsWith("0x20000000000000000000000000000000000000") ||
		a === "0x2222222222222222222222222222222222222222"
	);
}

function topicAddress(topic: string | undefined): `0x${string}` {
	return `0x${(topic ?? "").slice(-40)}` as `0x${string}`;
}

interface RawLog {
	address: string;
	topics: string[];
	data: Hex;
	logIndex: string;
}

function decodeRawActionData(data: Hex): Hex | null {
	// data = abi.encode(bytes): offset (32) | length (32) | payload
	const body = data.slice(2);
	if (body.length < 128) return null;
	const len = Number.parseInt(body.slice(64, 128), 16);
	const payload = body.slice(128, 128 + len * 2);
	if (payload.length !== len * 2) return null;
	return `0x${payload}` as Hex;
}

function fmt(d: Decimal): string {
	return d.toString();
}

export function isTxHash(v: string): boolean {
	return /^0x[0-9a-fA-F]{64}$/.test(v.trim());
}

export async function traceTransaction(
	network: Network,
	txHash: string,
	deps: TraceDeps,
): Promise<TxTrace> {
	const now = deps.now ?? Date.now;
	const rpcLog: RpcExchange[] = [];
	const infoLog: InfoExchange[] = [];
	const rpc = async (m: string, p: unknown[]) => {
		const r = await deps.rpc(m, p);
		rpcLog.push(r);
		return r;
	};
	const info = async (body: Record<string, unknown>) => {
		const r = await deps.info(body);
		infoLog.push(r);
		return r;
	};
	const hash = txHash.trim().toLowerCase();
	const receiptEx = await rpc("eth_getTransactionReceipt", [hash]);
	if (receiptEx.failure) {
		return {
			kind: "error",
			network,
			txHash: hash,
			observedAt: now(),
			message: `eth_getTransactionReceipt failed: ${JSON.stringify(receiptEx.failure)}`,
			rpcLog,
		};
	}
	const receipt = receiptEx.result as null | {
		status: string;
		blockNumber: string;
		blockHash: string;
		from: string;
		to: string | null;
		gasUsed: string;
		effectiveGasPrice?: string;
		logs: RawLog[];
	};
	if (!receipt) {
		let foundOnOtherNetwork: boolean | null = null;
		if (deps.otherRpc) {
			const other = await deps.otherRpc("eth_getTransactionReceipt", [hash]);
			rpcLog.push(other);
			foundOnOtherNetwork = other.failure ? null : other.result !== null;
		}
		return {
			kind: "not-found",
			network,
			txHash: hash,
			observedAt: now(),
			foundOnOtherNetwork,
			rpcLog,
		};
	}
	const blockEx = await rpc("eth_getBlockByNumber", [
		receipt.blockNumber,
		false,
	]);
	const block = blockEx.result as null | { timestamp: string };
	const blockTimestamp = block ? Number(hexToBigInt(block.timestamp)) : null;
	const logs = receipt.logs ?? [];
	const cwLogs = logs.filter(
		(l) =>
			l.address.toLowerCase() === COREWRITER_ADDRESS &&
			l.topics[0]?.toLowerCase() === RAW_ACTION_TOPIC,
	);
	const transfers: EvmToCoreTransfer[] = logs
		.filter(
			(l) =>
				l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
				l.topics.length === 3 &&
				isSystemAddress(topicAddress(l.topics[2])),
		)
		.map((l) => {
			const contract = l.address.toLowerCase();
			const to = topicAddress(l.topics[2]);
			const amount = hexToBigInt(l.data) ?? 0n;
			const ref = deps.universe?.tokens.find(
				(t) => t.evmContract?.address.toLowerCase() === contract,
			);
			const token =
				ref?.evmContract != null
					? {
							index: Number(ref.index),
							name: ref.name,
							weiDecimals: ref.weiDecimals,
							evmDecimals:
								ref.weiDecimals + ref.evmContract.evmExtraWeiDecimals,
						}
					: null;
			return {
				logIndex: Number(hexToBigInt(l.logIndex) ?? 0n),
				contract,
				from: topicAddress(l.topics[1]),
				to,
				amount,
				token,
				humanAmount:
					token && token.evmDecimals >= 0
						? fmt(Decimal.fromScaled(amount, token.evmDecimals))
						: null,
				systemAddressMatches: token
					? to === tokenSystemAddress(token.index) ||
						(to === SYSTEM_ADDRESSES.hype && token.name === "HYPE")
					: null,
			};
		});
	const summary: ReceiptSummary = {
		status: receipt.status === "0x1" ? "success" : "reverted",
		blockNumber: hexToBigInt(receipt.blockNumber) ?? 0n,
		blockHash: receipt.blockHash,
		blockTimestamp,
		from: receipt.from.toLowerCase(),
		to: receipt.to?.toLowerCase() ?? null,
		gasUsed: hexToBigInt(receipt.gasUsed) ?? 0n,
		effectiveGasPrice: receipt.effectiveGasPrice
			? hexToBigInt(receipt.effectiveGasPrice)
			: null,
		logCount: logs.length,
		coreWriterLogCount: cwLogs.length,
		evmToCoreTransfers: transfers,
		bigBlock: null,
	};
	const ctx = { universe: deps.universe };
	const accountCache = new Map<string, Promise<Finding[]>>();
	const actions: ActionTrace[] = [];
	for (const log of cwLogs) {
		const sender = topicAddress(log.topics[1]);
		const dataHex = decodeRawActionData(log.data) ?? ("0x" as Hex);
		const decode = decodeCoreWriterAction(dataHex, ctx);
		let expected: ActionTrace["expected"] = null;
		let observed: ObservedEffect | null = null;
		const findings: Finding[] = [];
		let supported = false;
		if (decode.kind === "decoded") {
			const v = Object.fromEntries(
				decode.fields.map((f) => [f.field.name, f.raw]),
			) as Record<string, bigint | boolean | string>;
			const h = Object.fromEntries(
				decode.fields.map((f) => [f.field.name, f.human ?? f.rawDisplay]),
			);
			if (decode.spec.key === "limitOrder") {
				supported = true;
				const coin =
					deps.universe?.byActionId.get(Number(v.asset))?.coin ?? null;
				const px = Decimal.fromScaled(v.limitPx as bigint, 8);
				const sz = Decimal.fromScaled(v.sz as bigint, 8);
				const tif =
					TIF_ENCODING[String(v.encodedTif)] ?? `tif ${String(v.encodedTif)}`;
				expected = {
					headline: `${v.isBuy ? "Buy" : "Sell"} ${fmt(sz)} ${coin ?? `asset ${String(v.asset)}`} @ ${fmt(px)} (${tif}${v.reduceOnly ? ", reduce-only" : ""})`,
					lines: [
						`An order placed for ${sender} (the calling contract is the HyperCore user).`,
						"Enqueued, then executed on HyperCore a few seconds after the EVM block (CoreWriter orders are delayed).",
						(v.cloid as bigint) !== 0n
							? `Identifiable by cloid ${h.cloid}.`
							: "No cloid: it can only be matched by asset, side, price, size and time.",
					],
				};
				observed = await observeLimitOrder(
					info,
					sender,
					v,
					coin,
					blockTimestamp,
				);
			} else if (decode.spec.key === "usdClassTransfer") {
				supported = true;
				const amount = Decimal.fromScaled(v.ntl as bigint, 6);
				expected = {
					headline: `Move ${fmt(amount)} USDC ${v.toPerp ? "spot → perp" : "perp → spot"} for ${sender}`,
					lines: [
						"Processed in the same L1 block, right after the EVM block (not delayed).",
						"Appears in userNonFundingLedgerUpdates as an accountClassTransfer.",
					],
				};
				observed = await observeClassTransfer(
					info,
					sender,
					amount,
					v.toPerp as boolean,
					blockTimestamp,
				);
			} else if (
				decode.spec.key === "sendAsset" ||
				decode.spec.key === "spotSend"
			) {
				const tokenIdx = Number(v.token);
				const token = deps.universe?.tokensByIndex.get(tokenIdx);
				if (token) {
					supported = true;
					const amount = Decimal.fromScaled(v.wei as bigint, token.weiDecimals);
					const dexName = (n: bigint | boolean | string | undefined) => {
						if (n === undefined) return "spot";
						const big = BigInt(n as bigint);
						if (big === 4294967295n) return "spot";
						if (big === 0n) return "";
						return (
							deps.universe?.dexes.find((d) => d.index === Number(big))?.name ??
							String(big)
						);
					};
					const isSendAsset = decode.spec.key === "sendAsset";
					const src = isSendAsset ? dexName(v.sourceDex) : "spot";
					const dst = isSendAsset ? dexName(v.destinationDex) : "spot";
					const label = (d: string) =>
						d === "" ? "perp" : d === "spot" ? "spot" : `dex ${d}`;
					const sub = isSendAsset ? String(v.subAccount) : "";
					expected = {
						headline: `Send ${fmt(amount)} ${token.name} from ${label(src)} to ${String(v.destination)} (${label(dst)})`,
						lines: [
							`Debited from ${sender}${sub && sub !== "0x0000000000000000000000000000000000000000" ? ` (sub-account ${sub})` : ""}.`,
							`Amount = wei ÷ 10^${token.weiDecimals} (${token.name} weiDecimals).`,
							"Processed right after the EVM block; appears in both parties' ledger updates.",
						],
					};
					observed = await observeSend(
						info,
						sender,
						String(v.destination).toLowerCase(),
						amount,
						token.name,
						src,
						dst,
						blockTimestamp,
						decode.spec.key,
					);
				} else {
					expected = {
						headline: `${decode.spec.name} of token ${tokenIdx}`,
						lines: [
							`Token ${tokenIdx} is unknown on ${network}, so the amount can't be converted or matched.`,
						],
					};
				}
			} else {
				expected = {
					headline: `${decode.spec.name} (${decode.spec.coreActionType})`,
					lines: [
						"Decoded, but the trace does not verify this action's HyperCore effect yet.",
					],
				};
			}
		}
		if (!accountCache.has(sender))
			accountCache.set(
				sender,
				checkAccount(info, sender, blockTimestamp, transfers),
			);
		findings.push(...(await (accountCache.get(sender) as Promise<Finding[]>)));
		if (summary.status === "reverted") {
			findings.unshift({
				title: "EVM transaction reverted",
				evidence: "observed",
				detail:
					"A reverted transaction's logs are discarded, so HyperCore never sees this action.",
				tone: "bad",
			});
		}
		actions.push({
			logIndex: Number(hexToBigInt(log.logIndex) ?? 0n),
			sender,
			dataHex,
			decode,
			supported,
			expected,
			observed,
			findings,
		});
	}
	const transferTraces = await traceTransfers(
		info,
		network,
		transfers,
		blockTimestamp,
		summary.status,
		now(),
	);
	return {
		kind: "ok",
		network,
		txHash: hash,
		observedAt: now(),
		receipt: summary,
		actions,
		transfers: transferTraces,
		rpcLog,
		infoLog,
	};
}

/**
 * Check each EVM → Core transfer against the credited account's ledger: a
 * `spotTransfer` from the token's system address to that account with the
 * same token and amount, at or just after the EVM block. One ledger query
 * per credited account per trace; the public API rate-limits this call.
 */
async function traceTransfers(
	info: (b: Record<string, unknown>) => Promise<InfoExchange>,
	network: Network,
	transfers: readonly EvmToCoreTransfer[],
	blockTs: number | null,
	status: ReceiptSummary["status"],
	nowMs: number,
): Promise<TransferTrace[]> {
	const out: TransferTrace[] = [];
	if (transfers.length === 0) return out;
	const blockMs = blockTs !== null ? blockTs * 1000 : null;
	const ledgers = new Map<string, Promise<InfoExchange>>();
	const ledgerFor = (user: string) => {
		const cached = ledgers.get(user);
		if (cached) return cached;
		const p =
			blockMs === null
				? Promise.resolve<InfoExchange>({
						body: {},
						response: null,
						error: "block timestamp unavailable",
					})
				: info({
						type: "userNonFundingLedgerUpdates",
						user,
						startTime: blockMs - 5_000,
						endTime: blockMs + 120_000,
					});
		ledgers.set(user, p);
		return p;
	};
	// Two transfers of the same amount to one account must match two entries.
	const consumed = new Set<string>();
	for (const t of transfers) {
		const who = `${t.from.slice(0, 6)}…${t.from.slice(-4)}`;
		const amountText = t.humanAmount
			? `${t.humanAmount} ${t.token?.name ?? ""}`.trim()
			: `${t.amount.toString()} raw units`;
		const expected = {
			headline: `Credit ${amountText} to the HyperCore spot balance of ${t.from}`,
			lines: [
				`The linked contract ${t.contract} emitted Transfer(from, to, value) with to = system address ${t.to}; HyperCore credits the from address, not the EVM sender.`,
				t.token
					? `Amount = value ÷ 10^${t.token.evmDecimals} (${t.token.name} weiDecimals ${t.token.weiDecimals} + evmExtraWeiDecimals ${t.token.evmDecimals - t.token.weiDecimals}).`
					: `The emitter is not a linked contract in ${network} spotMeta, so the token and amount can't be resolved.`,
				"Credited in the same L1 block, right after the EVM block is built (not delayed). Appears as a spotTransfer from the system address in the recipient's userNonFundingLedgerUpdates.",
			],
		};
		const findings: Finding[] = [];
		let observed: ObservedEffect;
		const unknown = (headline: string, detail: string): ObservedEffect => ({
			evidence: "unknown",
			headline,
			detail,
			comparisons: [],
			delayMs: null,
			coreTime: null,
			l1Hash: null,
			data: null,
		});
		if (status === "reverted") {
			observed = unknown(
				"EVM transaction reverted",
				"A reverted transaction's logs are discarded, so HyperCore never saw this transfer.",
			);
			findings.push({
				title: "EVM transaction reverted",
				evidence: "observed",
				detail: "Nothing crossed to HyperCore.",
				tone: "bad",
			});
		} else if (!t.token || !t.humanAmount) {
			observed = unknown(
				"Token not linked in metadata",
				`${t.contract} is not the evmContract of any ${network} token in spotMeta, so there is nothing to match in the ledger.`,
			);
		} else if (t.systemAddressMatches === false) {
			observed = unknown(
				"Sent to another token's system address",
				`${t.token.name}'s system address is ${tokenSystemAddress(t.token.index)} but the tokens went to ${t.to}. HyperCore only credits transfers to the token's own system address.`,
			);
			findings.push({
				title: "Wrong system address for this token",
				evidence: "inferred",
				detail: `Expected ${tokenSystemAddress(t.token.index)}.`,
				tone: "bad",
			});
		} else if (blockMs === null) {
			observed = unknown(
				"Block timestamp unavailable",
				"Cannot search the ledger without a time window.",
			);
		} else {
			const r = await ledgerFor(t.from);
			if (r.error) {
				observed = unknown(
					"Could not read the recipient's ledger",
					`userNonFundingLedgerUpdates failed: ${r.error}.`,
				);
			} else {
				const list = Array.isArray(r.response)
					? (r.response as LedgerUpdate[])
					: [];
				const token = t.token;
				const amount = Decimal.parse(t.humanAmount);
				const candidates = list.filter(
					(u, i) =>
						!consumed.has(`${t.from}:${i}`) &&
						u.delta.type === "spotTransfer" &&
						String(u.delta.user ?? "").toLowerCase() === t.to &&
						String(u.delta.destination ?? "").toLowerCase() === t.from &&
						u.delta.token === token.name &&
						(Decimal.tryParse(String(u.delta.amount ?? ""))?.eq(amount) ??
							false) &&
						u.time >= blockMs - 1_000,
				);
				const hit = candidates.sort(
					(a, b) => Math.abs(a.time - blockMs) - Math.abs(b.time - blockMs),
				)[0];
				if (hit) {
					consumed.add(`${t.from}:${list.indexOf(hit)}`);
					const delayMs = hit.time - blockMs;
					observed = {
						evidence: "observed",
						headline: `${t.humanAmount} ${token.name} credited to ${who} on HyperCore`,
						detail: `spotTransfer from ${t.to} to ${t.from} in the recipient's ledger, ${(delayMs / 1000).toFixed(3)} s after the EVM block.`,
						comparisons: [
							{
								field: "token",
								expected: token.name,
								observed: String(hit.delta.token),
								match: true,
							},
							{
								field: "amount",
								expected: t.humanAmount,
								observed: String(hit.delta.amount),
								match: true,
							},
							{
								field: "credited account",
								expected: t.from,
								observed: String(hit.delta.destination),
								match: true,
							},
						],
						delayMs,
						coreTime: hit.time,
						l1Hash: hit.hash,
						data: hit,
					};
					findings.push({
						title: `Credited ${(delayMs / 1000).toFixed(3)} s after the EVM block`,
						evidence: "observed",
						detail: `Ledger time ${new Date(hit.time).toISOString()}.`,
						tone: "ok",
					});
				} else {
					const ageMs = nowMs - blockMs;
					const recent = ageMs < 60_000;
					const spotTransfers = list.filter(
						(u) => u.delta.type === "spotTransfer",
					).length;
					observed = {
						evidence: "inferred",
						headline: "No HyperCore credit observed",
						detail: `Searched ${list.length} ledger update(s) for ${t.from} between −5 s and +120 s of the EVM block${spotTransfers ? ` (${spotTransfers} spotTransfer(s) with a different token, amount or source)` : ""}. A dropped EVM → Core transfer leaves no record on either side.`,
						comparisons: [
							{
								field: "token",
								expected: token.name,
								observed: null,
								match: null,
							},
							{
								field: "amount",
								expected: t.humanAmount,
								observed: null,
								match: null,
							},
							{
								field: "credited account",
								expected: t.from,
								observed: null,
								match: null,
							},
						],
						delayMs: null,
						coreTime: null,
						l1Hash: null,
						data: list,
					};
					findings.push(
						recent
							? {
									title: "Not credited yet",
									evidence: "inferred",
									detail: `The block is ${Math.round(ageMs / 1000)} s old; credits normally land within a second, but the ledger can lag. Trace again in a minute before concluding it was dropped.`,
									tone: "warn",
								}
							: {
									title: "HyperCore did not credit this transfer",
									evidence: "inferred",
									detail: `No matching spotTransfer within 120 s of a block that is ${Math.round(ageMs / 60_000)} min old. The EVM side succeeded, so nothing reports the failure; the cause is not stated by the protocol.`,
									tone: "bad",
								},
					);
				}
			}
		}
		out.push({ transfer: t, expected, observed, findings });
	}
	return out;
}

interface HistoricalOrder {
	order: {
		coin: string;
		side: "A" | "B";
		limitPx: string;
		sz: string;
		oid: number;
		timestamp: number;
		origSz: string;
		tif: string | null;
		reduceOnly: boolean;
		cloid: string | null;
		orderType?: string;
	};
	status: string;
	statusTimestamp: number;
}

interface Fill {
	coin: string;
	px: string;
	sz: string;
	side: string;
	time: number;
	oid: number;
	hash: string;
	fee: string;
	crossed: boolean;
}

function orderComparisons(
	v: Record<string, bigint | boolean | string>,
	coin: string | null,
	o: HistoricalOrder["order"],
): Comparison[] {
	const px = Decimal.fromScaled(v.limitPx as bigint, 8);
	const sz = Decimal.fromScaled(v.sz as bigint, 8);
	const tif = TIF_ENCODING[String(v.encodedTif)];
	const cmp = (
		field: string,
		expected: string,
		observed: string | null,
		eq?: boolean,
	): Comparison => ({
		field,
		expected,
		observed,
		match: observed === null ? null : (eq ?? expected === observed),
	});
	const obsPx = Decimal.tryParse(o.limitPx);
	const obsSz = Decimal.tryParse(o.origSz);
	return [
		cmp(
			"coin",
			coin ?? String(v.asset),
			o.coin,
			coin ? coin === o.coin : undefined,
		),
		cmp(
			"side",
			v.isBuy ? "B (buy)" : "A (sell)",
			o.side === "B" ? "B (buy)" : "A (sell)",
		),
		cmp("limit price", px.toString(), o.limitPx, obsPx ? obsPx.eq(px) : false),
		cmp("size", sz.toString(), o.origSz, obsSz ? obsSz.eq(sz) : false),
		cmp("tif", tif ?? "?", o.tif ?? null),
		cmp("reduce-only", String(v.reduceOnly), String(o.reduceOnly)),
	];
}

async function observeLimitOrder(
	info: (b: Record<string, unknown>) => Promise<InfoExchange>,
	user: `0x${string}`,
	v: Record<string, bigint | boolean | string>,
	coin: string | null,
	blockTs: number | null,
): Promise<ObservedEffect> {
	const cloid = v.cloid as bigint;
	const blockMs = blockTs !== null ? blockTs * 1000 : null;
	let order: HistoricalOrder | null = null;
	let evidence: Evidence = "unknown";
	let matchNote = "";
	if (cloid !== 0n) {
		const cloidHex = `0x${cloid.toString(16).padStart(32, "0")}`;
		const r = await info({ type: "orderStatus", user, oid: cloidHex });
		const resp = r.response as {
			status?: string;
			order?: HistoricalOrder;
		} | null;
		if (resp?.status === "order" && resp.order) {
			order = resp.order;
			evidence = "observed";
			matchNote = `orderStatus by cloid ${cloidHex} for ${user}.`;
		} else {
			matchNote = r.error
				? `orderStatus failed: ${r.error}`
				: `orderStatus returned "${resp?.status ?? "no data"}" for cloid ${cloidHex}: no order with this cloid exists for ${user}.`;
		}
	} else if (coin && blockMs !== null) {
		const r = await info({ type: "historicalOrders", user });
		const list = Array.isArray(r.response)
			? (r.response as HistoricalOrder[])
			: [];
		const px = Decimal.fromScaled(v.limitPx as bigint, 8);
		const sz = Decimal.fromScaled(v.sz as bigint, 8);
		const candidates = list.filter(
			(h) =>
				h.order.coin === coin &&
				(h.order.side === "B") === Boolean(v.isBuy) &&
				Decimal.tryParse(h.order.limitPx)?.eq(px) &&
				Decimal.tryParse(h.order.origSz)?.eq(sz) &&
				h.order.timestamp >= blockMs - 5_000 &&
				h.order.timestamp <= blockMs + 120_000,
		);
		const unique = [
			...new Map(candidates.map((c) => [c.order.oid, c])).values(),
		];
		if (unique.length === 1) {
			order = unique[0] as HistoricalOrder;
			evidence = "inferred";
			matchNote =
				"Matched in historicalOrders by coin, side, price, size and a 2-minute window after the EVM block (no cloid to match exactly).";
		} else if (unique.length > 1) {
			evidence = "unknown";
			matchNote = `${unique.length} orders in historicalOrders match coin, side, price, size and time; without a cloid they cannot be told apart.`;
		} else {
			matchNote =
				"No order in historicalOrders matches coin, side, price, size and time window.";
		}
	} else {
		matchNote = coin
			? "EVM block timestamp unavailable; cannot search by time."
			: "Asset is unknown on this network, so the order cannot be looked up.";
	}
	if (!order) {
		return {
			evidence: "unknown",
			headline: "No matching HyperCore order found",
			detail: `${matchNote} The action may have been rejected before an order existed (see checks below).`,
			comparisons: [],
			delayMs: null,
			coreTime: null,
			l1Hash: null,
			data: null,
		};
	}
	const o = order.order;
	const statusText = ORDER_STATUSES[order.status] ?? order.status;
	let fills: Fill[] = [];
	if (blockMs !== null) {
		const fr = await info({
			type: "userFillsByTime",
			user,
			startTime: blockMs - 10_000,
			endTime: blockMs + 600_000,
		});
		fills = (Array.isArray(fr.response) ? (fr.response as Fill[]) : []).filter(
			(f) => f.oid === o.oid,
		);
	}
	const filledSz = fills.reduce(
		(acc, f) => acc.add(Decimal.parse(f.sz)),
		Decimal.ZERO,
	);
	const notional = fills.reduce(
		(acc, f) => acc.add(Decimal.parse(f.px).mul(Decimal.parse(f.sz))),
		Decimal.ZERO,
	);
	const avgPx = filledSz.isZero()
		? null
		: notional.div(filledSz, 8, "half-even");
	const rejected = /rejected/i.test(order.status);
	return {
		evidence,
		headline: `Order ${o.oid}: ${order.status}${fills.length ? ` · ${filledSz.toString()} filled${avgPx ? ` @ avg ${avgPx.toString()}` : ""}` : ""}`,
		detail: `${statusText}. ${matchNote}${rejected ? " HyperCore accepted the CoreWriter action but rejected the order itself." : ""}`,
		comparisons: orderComparisons(v, coin, o),
		delayMs: blockMs !== null ? o.timestamp - blockMs : null,
		coreTime: o.timestamp,
		l1Hash: fills[0]?.hash ?? null,
		data: { order, fills },
	};
}

interface LedgerUpdate {
	time: number;
	hash: string;
	delta: {
		type: string;
		usdc?: string;
		toPerp?: boolean;
		[k: string]: unknown;
	};
}

async function observeClassTransfer(
	info: (b: Record<string, unknown>) => Promise<InfoExchange>,
	user: `0x${string}`,
	amount: Decimal,
	toPerp: boolean,
	blockTs: number | null,
): Promise<ObservedEffect> {
	if (blockTs === null) {
		return {
			evidence: "unknown",
			headline: "Block timestamp unavailable",
			detail: "Cannot search the ledger without a time window.",
			comparisons: [],
			delayMs: null,
			coreTime: null,
			l1Hash: null,
			data: null,
		};
	}
	const blockMs = blockTs * 1000;
	const r = await info({
		type: "userNonFundingLedgerUpdates",
		user,
		startTime: blockMs - 5_000,
		endTime: blockMs + 120_000,
	});
	const list = Array.isArray(r.response) ? (r.response as LedgerUpdate[]) : [];
	const classTransfers = list.filter(
		(u) => u.delta.type === "accountClassTransfer",
	);
	const exact = classTransfers.filter(
		(u) =>
			u.delta.toPerp === toPerp &&
			Decimal.tryParse(String(u.delta.usdc ?? ""))?.eq(amount),
	);
	const hit = exact.sort(
		(a, b) => Math.abs(a.time - blockMs) - Math.abs(b.time - blockMs),
	)[0];
	if (!hit) {
		return {
			evidence: "unknown",
			headline: "No matching accountClassTransfer in the ledger",
			detail: `Searched ${list.length} ledger update(s) between −5 s and +120 s of the EVM block${classTransfers.length ? ` (${classTransfers.length} class transfer(s) with a different amount or direction)` : ""}. If the transfer was rejected (e.g. insufficient balance, unified account mode, or the sender didn't exist yet) nothing is recorded.`,
			comparisons: [],
			delayMs: null,
			coreTime: null,
			l1Hash: null,
			data: list,
		};
	}
	return {
		evidence: "observed",
		headline: `accountClassTransfer of ${hit.delta.usdc} USDC ${hit.delta.toPerp ? "spot → perp" : "perp → spot"}`,
		detail:
			"Found in userNonFundingLedgerUpdates with the same amount and direction.",
		comparisons: [
			{
				field: "amount",
				expected: amount.toString(),
				observed: String(hit.delta.usdc),
				match: true,
			},
			{
				field: "direction",
				expected: toPerp ? "toPerp" : "toSpot",
				observed: hit.delta.toPerp ? "toPerp" : "toSpot",
				match: true,
			},
		],
		delayMs: hit.time - blockMs,
		coreTime: hit.time,
		l1Hash: hit.hash,
		data: hit,
	};
}

async function observeSend(
	info: (b: Record<string, unknown>) => Promise<InfoExchange>,
	user: `0x${string}`,
	destination: string,
	amount: Decimal,
	tokenName: string,
	sourceDex: string,
	destinationDex: string,
	blockTs: number | null,
	kind: string,
): Promise<ObservedEffect> {
	if (blockTs === null) {
		return {
			evidence: "unknown",
			headline: "Block timestamp unavailable",
			detail: "Cannot search the ledger without a time window.",
			comparisons: [],
			delayMs: null,
			coreTime: null,
			l1Hash: null,
			data: null,
		};
	}
	const blockMs = blockTs * 1000;
	const r = await info({
		type: "userNonFundingLedgerUpdates",
		user,
		startTime: blockMs - 5_000,
		endTime: blockMs + 120_000,
	});
	const list = Array.isArray(r.response) ? (r.response as LedgerUpdate[]) : [];
	const candidates = list.filter((u) => {
		const d = u.delta as Record<string, unknown>;
		if (d.type !== "send" && d.type !== "spotTransfer") return false;
		if (String(d.destination ?? "").toLowerCase() !== destination) return false;
		if (String(d.token ?? "") !== tokenName) return false;
		return Decimal.tryParse(String(d.amount ?? ""))?.eq(amount) ?? false;
	});
	const hit = candidates.sort(
		(a, b) => Math.abs(a.time - blockMs) - Math.abs(b.time - blockMs),
	)[0];
	if (!hit) {
		return {
			evidence: "unknown",
			headline: `No matching ${kind === "sendAsset" ? "send" : "spotTransfer"} in the sender's ledger`,
			detail: `Searched ${list.length} ledger update(s) between −5 s and +120 s of the EVM block for ${amount.toString()} ${tokenName} to ${destination}. Nothing recorded usually means the action was rejected (insufficient balance, unknown token or dex, or the sender didn't exist yet).`,
			comparisons: [],
			delayMs: null,
			coreTime: null,
			l1Hash: null,
			data: list,
		};
	}
	const d = hit.delta as Record<string, unknown>;
	const comparisons: Comparison[] = [
		{
			field: "amount",
			expected: amount.toString(),
			observed: String(d.amount),
			match: true,
		},
		{
			field: "token",
			expected: tokenName,
			observed: String(d.token),
			match: true,
		},
		{
			field: "destination",
			expected: destination,
			observed: String(d.destination).toLowerCase(),
			match: true,
		},
	];
	if (d.type === "send") {
		comparisons.push(
			{
				field: "source dex",
				expected: sourceDex || '""',
				observed: String(d.sourceDex) || '""',
				match: String(d.sourceDex) === sourceDex,
			},
			{
				field: "destination dex",
				expected: destinationDex || '""',
				observed: String(d.destinationDex) || '""',
				match: String(d.destinationDex) === destinationDex,
			},
		);
	}
	return {
		evidence: "observed",
		headline: `${String(d.type)} of ${String(d.amount)} ${String(d.token)} to ${String(d.destination)}`,
		detail: `Found in userNonFundingLedgerUpdates${d.fee && d.fee !== "0.0" ? ` (fee ${String(d.fee)} ${String(d.feeToken ?? "")})` : ""}.`,
		comparisons,
		delayMs: hit.time - blockMs,
		coreTime: hit.time,
		l1Hash: hit.hash,
		data: hit,
	};
}

async function checkAccount(
	info: (b: Record<string, unknown>) => Promise<InfoExchange>,
	user: `0x${string}`,
	blockTs: number | null,
	transfers: ReceiptSummary["evmToCoreTransfers"],
): Promise<Finding[]> {
	const findings: Finding[] = [];
	const first = await info({
		type: "userNonFundingLedgerUpdates",
		user,
		startTime: 0,
	});
	const list = Array.isArray(first.response)
		? (first.response as LedgerUpdate[])
		: [];
	const earliest = list.reduce<number | null>(
		(m, u) => (m === null || u.time < m ? u.time : m),
		null,
	);
	const blockMs = blockTs !== null ? blockTs * 1000 : null;
	if (earliest === null) {
		findings.push({
			title: "Sender has no HyperCore ledger history",
			evidence: "inferred",
			detail: `${user} has never received a HyperCore transfer or deposit. CoreWriter actions from an account that doesn't exist on HyperCore are dropped without an EVM revert.`,
			tone: "bad",
		});
	} else if (blockMs !== null && earliest > blockMs + 999) {
		findings.push({
			title: "Sender did not exist on HyperCore at the time",
			evidence: "inferred",
			detail: `First ledger event ${new Date(earliest).toISOString()} is after this EVM block (${new Date(blockMs).toISOString()}). The action was almost certainly dropped.`,
			tone: "bad",
		});
	} else if (
		blockMs !== null &&
		earliest >= blockMs - 999 &&
		transfers.length > 0
	) {
		findings.push({
			title: "Account first funded in this same block",
			evidence: "inferred",
			detail:
				"This transaction bridges assets EVM → Core and the sender's first ledger event is in the same second. EVM→Core transfers are processed before CoreWriter actions but after the EVM block is built, so an account created this way is too late for a CoreWriter action in the same block.",
			tone: "bad",
		});
	} else {
		findings.push({
			title: "Sender existed on HyperCore before this block",
			evidence: blockMs !== null ? "inferred" : "unknown",
			detail:
				blockMs !== null
					? `Earliest ledger event: ${new Date(earliest).toISOString()}.`
					: "Block time unknown.",
			tone: "ok",
		});
	}
	return findings;
}

export function explorerLinks(
	network: Network,
	txHash: string,
	sender: string,
) {
	const cfg = networkConfig(network);
	return {
		evmTx: cfg.evmExplorerTx(txHash),
		coreAddress: cfg.coreExplorerAddress(sender),
	};
}
