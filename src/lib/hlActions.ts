import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import type { WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const mainnetHttp = new HttpTransport();
const testnetHttp = new HttpTransport({ isTestnet: true });

const mainnetInfo = new InfoClient({ transport: mainnetHttp });
const testnetInfo = new InfoClient({ transport: testnetHttp });

export async function fetchBalance(
	address: `0x${string}`,
	isTestnet: boolean,
): Promise<number> {
	const info = isTestnet ? testnetInfo : mainnetInfo;
	const state = await info.clearinghouseState({ user: address });
	return Number.parseFloat(state.withdrawable);
}

export async function claimFaucet(address: `0x${string}`): Promise<unknown> {
	const res = await fetch("https://api-ui.hyperliquid-testnet.xyz/info", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ type: "claimDrip", user: address }),
	});
	return res.json();
}

export async function sendFromGeneratedWallet(
	privateKey: `0x${string}`,
	destination: `0x${string}`,
	amount: string,
	isTestnet: boolean,
): Promise<unknown> {
	const wallet = privateKeyToAccount(privateKey);
	const transport = isTestnet ? testnetHttp : mainnetHttp;
	const exchange = new ExchangeClient({ transport, wallet });
	return exchange.usdSend({ destination, amount });
}

export async function sendFromUserWallet(
	walletClient: WalletClient,
	destination: `0x${string}`,
	amount: string,
): Promise<unknown> {
	const exchange = new ExchangeClient({
		transport: mainnetHttp,
		wallet: walletClient as never,
	});
	return exchange.usdSend({ destination, amount });
}
