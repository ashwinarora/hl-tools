/**
 * Plain-words description of an action, for review screens. Pure and total:
 * any object with a `type` gets a headline; known shapes get the details.
 * Amounts are rendered exactly as the action carries them (strings for
 * decimals, integers for USD micro-units), never re-rounded.
 */

import { riskFlags } from "./action.ts";
import { parseSignersString } from "./signerSet.ts";
import type { PlainObject, RiskFlag } from "./types.ts";

export interface DescribeContext {
	/** Perp asset index → coin name (from the resolver universe). */
	readonly coin?: (asset: number) => string | undefined;
}

export interface ActionDescription {
	readonly type: string;
	/** One line, e.g. "Limit buy 0.001 BTC at 50000 (Gtc)". */
	readonly headline: string;
	/** Further lines, one fact each. */
	readonly lines: readonly string[];
	readonly flags: readonly RiskFlag[];
	/** False when the type is not modelled; the headline then says so. */
	readonly known: boolean;
}

const s = (v: unknown): string =>
	typeof v === "string"
		? v
		: typeof v === "bigint"
			? v.toString()
			: v === undefined
				? "?"
				: JSON.stringify(v);
const usd = (v: unknown): string => {
	if (typeof v === "number" || typeof v === "bigint") {
		const n = BigInt(v);
		const whole = n / 1_000_000n;
		const frac = (n % 1_000_000n)
			.toString()
			.padStart(6, "0")
			.replace(/0+$/, "");
		return frac ? `${whole}.${frac} USDC` : `${whole} USDC`;
	}
	return `${s(v)} (raw)`;
};
const coinOf = (ctx: DescribeContext, asset: unknown): string =>
	typeof asset === "number"
		? (ctx.coin?.(asset) ?? `asset #${asset}`)
		: `asset ${s(asset)}`;

function describeOrder(
	o: Record<string, unknown>,
	ctx: DescribeContext,
): string {
	const side = o.b === true ? "buy" : o.b === false ? "sell" : "order";
	const coin = coinOf(ctx, o.a);
	const t = o.t as Record<string, unknown> | undefined;
	let kind: string;
	let extra = "";
	if (t && typeof t === "object" && "limit" in t) {
		kind = "Limit";
		extra = ` (${s((t.limit as Record<string, unknown>)?.tif)})`;
	} else if (t && typeof t === "object" && "trigger" in t) {
		const tr = t.trigger as Record<string, unknown>;
		kind = `${s(tr?.tpsl).toUpperCase()} ${tr?.isMarket ? "market" : "limit"} trigger`;
		extra = ` at trigger ${s(tr?.triggerPx)}`;
	} else {
		kind = "Order";
	}
	const parts = [`${kind} ${side} ${s(o.s)} ${coin} at ${s(o.p)}${extra}`];
	if (o.r === true) parts.push("reduce-only");
	if (typeof o.c === "string") parts.push(`cloid ${o.c}`);
	return parts.join(", ");
}

export function describeAction(
	action: PlainObject,
	ctx: DescribeContext = {},
): ActionDescription {
	const type =
		typeof action.type === "string" ? action.type : String(action.type);
	const flags = riskFlags(action);
	const done = (
		headline: string,
		lines: string[] = [],
		known = true,
	): ActionDescription => ({
		type,
		headline,
		lines,
		flags,
		known,
	});
	switch (type) {
		case "order": {
			const orders = Array.isArray(action.orders)
				? (action.orders as Record<string, unknown>[])
				: [];
			const lines = orders.map((o) => describeOrder(o, ctx));
			if (action.grouping && action.grouping !== "na")
				lines.push(`grouping ${s(action.grouping)}`);
			const b = action.builder as Record<string, unknown> | undefined;
			if (b && typeof b === "object")
				lines.push(`builder ${s(b.b)} fee ${s(b.f)} (tenths of a bp)`);
			return done(
				orders.length === 1 ? (lines[0] as string) : `${orders.length} orders`,
				orders.length === 1 ? lines.slice(1) : lines,
			);
		}
		case "cancel": {
			const cs = Array.isArray(action.cancels)
				? (action.cancels as Record<string, unknown>[])
				: [];
			return done(
				`Cancel ${cs.length} order${cs.length === 1 ? "" : "s"}`,
				cs.map((c) => `oid ${s(c.o)} on ${coinOf(ctx, c.a)}`),
			);
		}
		case "cancelByCloid": {
			const cs = Array.isArray(action.cancels)
				? (action.cancels as Record<string, unknown>[])
				: [];
			return done(
				`Cancel ${cs.length} order${cs.length === 1 ? "" : "s"} by cloid`,
				cs.map((c) => `cloid ${s(c.cloid)} on ${coinOf(ctx, c.asset)}`),
			);
		}
		case "modify": {
			const o = (action.order ?? {}) as Record<string, unknown>;
			return done(`Modify order ${s(action.oid)}`, [describeOrder(o, ctx)]);
		}
		case "batchModify": {
			const ms = Array.isArray(action.modifies)
				? (action.modifies as Record<string, unknown>[])
				: [];
			return done(
				`Modify ${ms.length} orders`,
				ms.map(
					(m) =>
						`${s(m.oid)}: ${describeOrder((m.order ?? {}) as Record<string, unknown>, ctx)}`,
				),
			);
		}
		case "scheduleCancel":
			return action.time === undefined
				? done("Remove the scheduled cancel (dead man's switch off)")
				: done(
						`Schedule cancel-all at ${new Date(Number(action.time)).toISOString()}`,
						[
							"Dead man's switch: every open order is cancelled at that time unless rescheduled.",
						],
					);
		case "updateLeverage":
			return done(
				`Set ${coinOf(ctx, action.asset)} leverage to ${s(action.leverage)}x ${action.isCross ? "cross" : "isolated"}`,
			);
		case "updateIsolatedMargin":
			return done(
				`${action.isBuy ? "Add" : "Remove"} ${usd(action.ntli)} isolated margin on ${coinOf(ctx, action.asset)}`,
			);
		case "twapOrder": {
			const t = (action.twap ?? {}) as Record<string, unknown>;
			return done(
				`TWAP ${t.b ? "buy" : "sell"} ${s(t.s)} ${coinOf(ctx, t.a)} over ${s(t.m)} min`,
				[t.r ? "reduce-only" : "", t.t ? "randomised timing" : ""].filter(
					Boolean,
				),
			);
		}
		case "twapCancel":
			return done(`Cancel TWAP ${s(action.t)} on ${coinOf(ctx, action.a)}`);
		case "vaultTransfer":
			return done(
				`${action.isDeposit ? "Deposit" : "Withdraw"} ${usd(action.usd)} ${action.isDeposit ? "into" : "from"} vault ${s(action.vaultAddress)}`,
			);
		case "subAccountTransfer":
			return done(
				`${action.isDeposit ? "Deposit" : "Withdraw"} ${usd(action.usd)} ${action.isDeposit ? "into" : "from"} sub-account ${s(action.subAccountUser)}`,
			);
		case "subAccountSpotTransfer":
			return done(
				`${action.isDeposit ? "Deposit" : "Withdraw"} ${s(action.amount)} ${s(action.token)} ${action.isDeposit ? "into" : "from"} sub-account ${s(action.subAccountUser)}`,
			);
		case "createSubAccount":
			return done(`Create sub-account "${s(action.name)}"`);
		case "setReferrer":
			return done(`Set referrer code "${s(action.code)}"`);
		case "evmUserModify":
			return done(
				`${action.usingBigBlocks ? "Use" : "Stop using"} HyperEVM big blocks`,
				["Touches the HyperEVM side of the account."],
			);
		case "reserveRequestWeight":
			return done(`Reserve ${s(action.weight)} request weight`, [
				"Costs 0.0005 USDC per request reserved.",
			]);
		case "noop":
			return done("No-op (consumes a nonce, does nothing)");
		case "usdSend":
			return done(
				`Send ${s(action.amount)} USDC (perps) to ${s(action.destination)}`,
			);
		case "spotSend":
			return done(
				`Send ${s(action.amount)} ${String(action.token ?? "?").split(":")[0]} (spot) to ${s(action.destination)}`,
				[`token ${s(action.token)}`],
			);
		case "withdraw3":
			return done(
				`Withdraw ${s(action.amount)} USDC to ${s(action.destination)} on Arbitrum`,
				["Leaves Hyperliquid through the bridge."],
			);
		case "usdClassTransfer":
			return done(
				`Move ${s(action.amount)} USDC ${action.toPerp ? "spot → perps" : "perps → spot"}`,
			);
		case "sendAsset":
			return done(
				`Send ${s(action.amount)} ${s(action.token)} to ${s(action.destination)}`,
				[
					`from dex "${s(action.sourceDex)}" to dex "${s(action.destinationDex)}"`,
					action.fromSubAccount
						? `from sub-account ${s(action.fromSubAccount)}`
						: "",
				].filter(Boolean),
			);
		case "approveAgent":
			return done(
				`Approve API wallet ${s(action.agentAddress)}${action.agentName ? ` named "${s(action.agentName)}"` : " as the main (unnamed) agent"}`,
				[
					"This wallet will trade for the account without multi-sig signatures until it expires or is replaced.",
				],
			);
		case "approveBuilderFee":
			return done(
				`Approve builder ${s(action.builder)} up to ${s(action.maxFeeRate)}`,
			);
		case "tokenDelegate":
			return done(
				`${action.isUndelegate ? "Undelegate" : "Delegate"} ${s(action.wei)} wei of HYPE ${action.isUndelegate ? "from" : "to"} validator ${s(action.validator)}`,
			);
		case "cDeposit":
			return done(`Move ${s(action.wei)} wei of HYPE from spot into staking`);
		case "cWithdraw":
			return done(
				`Move ${s(action.wei)} wei of HYPE from staking back to spot`,
				["Staking withdrawals take about 7 days to unlock."],
			);
		case "linkStakingUser":
			return done(
				`${action.isFinalize ? "Finalise" : "Start"} linking staking user ${s(action.user)}`,
			);
		case "sendToEvmWithData":
			return done(
				`Send ${s(action.amount)} ${s(action.token)} to HyperEVM recipient ${s(action.destinationRecipient)}`,
				[
					`chain ${s(action.destinationChainId)}, gas limit ${s(action.gasLimit)}, data ${s(action.data)}`,
				],
			);
		case "userDexAbstraction":
			return done(
				`${action.enabled ? "Enable" : "Disable"} HIP-3 dex abstraction for ${s(action.user)}`,
			);
		case "userSetAbstraction":
			return done(
				`Set abstraction mode "${s(action.abstraction)}" for ${s(action.user)}`,
			);
		case "userPortfolioMargin":
			return done(
				`${action.enabled ? "Enable" : "Disable"} portfolio margin for ${s(action.user)}`,
			);
		case "convertToMultiSigUser": {
			const parsed = parseSignersString(action.signers);
			if (parsed.revert)
				return done("Convert back to a normal user (remove the multi-sig)", [
					"After this the account's own private key sends every action again; approved API wallets keep working.",
				]);
			if (!parsed.set)
				return done(
					"Change the multi-sig signer set (unparseable signers string)",
					parsed.issues.map((i) => i.message),
				);
			const n = parsed.set.authorizedUsers.length;
			return done(
				`Set the multi-sig to ${parsed.set.threshold} of ${n} signer${n === 1 ? "" : "s"}`,
				parsed.set.authorizedUsers.map((a) => `signer ${a}`),
			);
		}
		default:
			return done(
				`Unknown action "${type}" (hashed exactly as written)`,
				Object.keys(action)
					.filter((k) => k !== "type")
					.map((k) => `${k}: ${s(action[k])}`),
				false,
			);
	}
}
