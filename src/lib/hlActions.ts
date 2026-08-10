import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import type { WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const mainnetHttp = new HttpTransport();
const testnetHttp = new HttpTransport({ isTestnet: true });

const mainnetInfo = new InfoClient({ transport: mainnetHttp });
const testnetInfo = new InfoClient({ transport: testnetHttp });

export type AbstractionMode = "unifiedAccount" | "portfolioMargin" | "disabled";

// A `Pocket` mirrors Hyperliquid's dex identifier for `sendAsset`.
// "" = main perps dex ; "spot" = spot balance.
export type Pocket = "" | "spot";
export type PocketLocal = "perp" | "spot"; // for local balance queries
export type SendKind = "usd" | "spot"; // kept for backwards compat: usd=>perps, spot=>spot

// Reserve enough per transfer to cover Hyperliquid's $1 fee charged on
// transfers to fresh recipients (every generated wallet is fresh).
export const TRANSFER_FEE_BUFFER = 1.02;

const usdcTokenCache: Partial<Record<"mainnet" | "testnet", string>> = {};

export async function getUsdcTokenId(isTestnet: boolean): Promise<string> {
	const key = isTestnet ? "testnet" : "mainnet";
	const cached = usdcTokenCache[key];
	if (cached) return cached;
	const info = isTestnet ? testnetInfo : mainnetInfo;
	const meta = await info.spotMeta();
	const usdc = meta.tokens.find((t) => t.name === "USDC");
	if (!usdc) throw new Error(`USDC token not found in ${key} spotMeta`);
	const id = `USDC:${usdc.tokenId}`;
	usdcTokenCache[key] = id;
	return id;
}

export async function fetchUsdcBalance(
	address: `0x${string}`,
	isTestnet: boolean,
	pocket: PocketLocal,
): Promise<number> {
	const info = isTestnet ? testnetInfo : mainnetInfo;
	if (pocket === "perp") {
		const state = await info.clearinghouseState({ user: address });
		return Number.parseFloat(state.withdrawable);
	}
	const state = await info.spotClearinghouseState({ user: address });
	const usdc = state.balances.find((b) => b.coin === "USDC");
	return usdc ? Number.parseFloat(usdc.total) : 0;
}

// Legacy wrapper — reads perps withdrawable.
export async function fetchBalance(
	address: `0x${string}`,
	isTestnet: boolean,
): Promise<number> {
	return fetchUsdcBalance(address, isTestnet, "perp");
}

export type UserProfile = {
	abstraction: AbstractionMode;
	perpsWithdrawable: number;
	spotUsdc: number;
};

export async function fetchUserProfile(
	address: `0x${string}`,
	isTestnet: boolean,
): Promise<UserProfile> {
	const host = isTestnet
		? "https://api.hyperliquid-testnet.xyz"
		: "https://api.hyperliquid.xyz";
	const [webData3Res, perpsWithdrawable, spotUsdc] = await Promise.all([
		fetch(`${host}/info`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "webData3", user: address }),
		}).then((r) => r.json()),
		fetchUsdcBalance(address, isTestnet, "perp"),
		fetchUsdcBalance(address, isTestnet, "spot"),
	]);
	const abstraction: AbstractionMode =
		webData3Res?.userState?.abstraction ?? "disabled";
	return { abstraction, perpsWithdrawable, spotUsdc };
}

export function isUnifiedLike(mode: AbstractionMode): boolean {
	return mode === "unifiedAccount" || mode === "portfolioMargin";
}

export function decideChainKind(
	profile: UserProfile,
	requiredAmount: number,
): SendKind | null {
	if (isUnifiedLike(profile.abstraction)) {
		return profile.spotUsdc >= requiredAmount ? "spot" : null;
	}
	if (profile.perpsWithdrawable >= requiredAmount) return "usd";
	if (profile.spotUsdc >= requiredAmount) return "spot";
	return null;
}

export function pocketForKind(kind: SendKind): PocketLocal {
	return kind === "spot" ? "spot" : "perp";
}

// Convert a SendKind to the Hyperliquid `sourceDex`/`destinationDex` string.
export function dexForKind(kind: SendKind): Pocket {
	return kind === "spot" ? "spot" : "";
}

// Pick the destination dex for a transfer landing on `user`, given
// the chain's default pocket. Unified/PM users can only receive on spot.
export function userDestinationDex(
	userAbstraction: AbstractionMode,
	fallback: Pocket,
): Pocket {
	return isUnifiedLike(userAbstraction) ? "spot" : fallback;
}

export async function claimFaucet(address: `0x${string}`): Promise<unknown> {
	const res = await fetch("https://api-ui.hyperliquid-testnet.xyz/info", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ type: "claimDrip", user: address }),
	});
	return res.json();
}

async function sendAssetTransfer(
	exchange: ExchangeClient,
	destination: `0x${string}`,
	amount: string,
	sourceDex: Pocket,
	destinationDex: Pocket,
	isTestnet: boolean,
): Promise<unknown> {
	const token = await getUsdcTokenId(isTestnet);
	return exchange.sendAsset({
		destination,
		sourceDex,
		destinationDex,
		token,
		amount,
		fromSubAccount: "",
	});
}

export async function sendFromGeneratedWallet(
	privateKey: `0x${string}`,
	destination: `0x${string}`,
	amount: string,
	isTestnet: boolean,
	sourceDex: Pocket,
	destinationDex: Pocket,
): Promise<unknown> {
	const wallet = privateKeyToAccount(privateKey);
	const transport = isTestnet ? testnetHttp : mainnetHttp;
	const exchange = new ExchangeClient({ transport, wallet });
	return sendAssetTransfer(
		exchange,
		destination,
		amount,
		sourceDex,
		destinationDex,
		isTestnet,
	);
}

export async function sendFromUserWallet(
	walletClient: WalletClient,
	destination: `0x${string}`,
	amount: string,
	sourceDex: Pocket,
	destinationDex: Pocket,
	isTestnet = false,
): Promise<unknown> {
	const transport = isTestnet ? testnetHttp : mainnetHttp;
	const exchange = new ExchangeClient({
		transport,
		wallet: walletClient as never,
	});
	return sendAssetTransfer(
		exchange,
		destination,
		amount,
		sourceDex,
		destinationDex,
		isTestnet,
	);
}
