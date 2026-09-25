import { delay, HttpResponse, http, ws } from "msw";
import { recoverTypedDataAddress } from "viem";
import {
	type AddressState,
	applySend,
	type Network,
	useMockLedger,
} from "./ledger";

// EIP-712 types for the sendAsset action (mirrored from
// @nktkas/hyperliquid/api/exchange/_methods/sendAsset.js).
const SendAssetTypes = {
	"HyperliquidTransaction:SendAsset": [
		{ name: "hyperliquidChain", type: "string" },
		{ name: "destination", type: "string" },
		{ name: "sourceDex", type: "string" },
		{ name: "destinationDex", type: "string" },
		{ name: "token", type: "string" },
		{ name: "amount", type: "string" },
		{ name: "fromSubAccount", type: "string" },
		{ name: "nonce", type: "uint64" },
	],
} as const;

// Recover the actual signer of a sendAsset action so the mock ledger knows
// which address to debit. Uses viem's typed-data recovery against the same
// domain the SDK uses to sign.
async function recoverSendAssetSigner(
	action: {
		hyperliquidChain: string;
		destination: `0x${string}`;
		sourceDex: string;
		destinationDex: string;
		token: string;
		amount: string;
		fromSubAccount?: string;
		nonce: number;
		signatureChainId: string;
	},
	signature: { r: `0x${string}`; s: `0x${string}`; v: number },
): Promise<`0x${string}`> {
	const chainId = Number.parseInt(action.signatureChainId, 16);
	const sigHex = `${signature.r}${signature.s.slice(2)}${signature.v
		.toString(16)
		.padStart(2, "0")}` as `0x${string}`;
	return await recoverTypedDataAddress({
		domain: {
			name: "HyperliquidSignTransaction",
			version: "1",
			chainId,
			verifyingContract: "0x0000000000000000000000000000000000000000",
		},
		types: SendAssetTypes,
		primaryType: "HyperliquidTransaction:SendAsset",
		message: {
			hyperliquidChain: action.hyperliquidChain,
			destination: action.destination,
			sourceDex: action.sourceDex,
			destinationDex: action.destinationDex,
			token: action.token,
			amount: action.amount,
			fromSubAccount: action.fromSubAccount ?? "",
			nonce: BigInt(action.nonce),
		},
		signature: sigHex,
	});
}

function respondInfo(network: Network) {
	return http.post(
		`https://api.hyperliquid${network === "testnet" ? "-testnet" : ""}.xyz/info`,
		async ({ request }) => {
			const body = (await request.json()) as { type: string; user?: string };
			const ledger = useMockLedger.getState();
			await delay(ledger.config.delays.info);

			const address = body.user
				? (body.user.toLowerCase() as `0x${string}`)
				: undefined;
			const state: AddressState | undefined = address
				? (ledger[network].get(address) ?? undefined)
				: undefined;

			switch (body.type) {
				case "clearinghouseState": {
					const perp = state?.perp ?? 0;
					const perpStr = perp.toFixed(6);
					return HttpResponse.json({
						marginSummary: {
							accountValue: perpStr,
							totalNtlPos: "0.0",
							totalRawUsd: perpStr,
							totalMarginUsed: "0.0",
						},
						crossMarginSummary: {
							accountValue: perpStr,
							totalNtlPos: "0.0",
							totalRawUsd: perpStr,
							totalMarginUsed: "0.0",
						},
						crossMaintenanceMarginUsed: "0.0",
						withdrawable: perpStr,
						assetPositions: [],
						time: Date.now(),
					});
				}
				case "spotClearinghouseState": {
					const spot = state?.spot ?? 0;
					const balances =
						spot > 0
							? [
									{
										coin: "USDC",
										token: 0,
										total: spot.toFixed(6),
										hold: "0.0",
										entryNtl: spot.toFixed(6),
									},
								]
							: [];
					return HttpResponse.json({ balances });
				}
				case "webData3": {
					return HttpResponse.json({
						userState: {
							abstraction: state?.abstraction ?? "disabled",
						},
						spotState: {
							balances:
								state && state.spot > 0
									? [
											{
												coin: "USDC",
												token: 0,
												total: state.spot.toFixed(6),
												hold: "0.0",
												entryNtl: state.spot.toFixed(6),
											},
										]
									: [],
						},
					});
				}
				case "userNonFundingLedgerUpdates": {
					return HttpResponse.json(state?.events ?? []);
				}
				case "spotMeta": {
					return HttpResponse.json({
						tokens: [
							{
								name: "USDC",
								szDecimals: 6,
								weiDecimals: 8,
								index: 0,
								tokenId: "0x6d1e7cde53ba9467b783cb7c530ce054",
								isCanonical: true,
								evmContract: null,
								fullName: "USDC",
								deployerTradingFeeShare: "0.0",
							},
						],
						universe: [],
					});
				}
				default:
					return HttpResponse.json({});
			}
		},
	);
}

function respondExchange(network: Network) {
	return http.post(
		`https://api.hyperliquid${network === "testnet" ? "-testnet" : ""}.xyz/exchange`,
		async ({ request }) => {
			const body = (await request.json()) as {
				action: {
					type: string;
					destination?: `0x${string}`;
					sourceDex?: string;
					destinationDex?: string;
					token?: string;
					amount?: string;
					fromSubAccount?: string;
					nonce: number;
					signatureChainId?: string;
					hyperliquidChain?: string;
				};
				signature: { r: `0x${string}`; s: `0x${string}`; v: number };
				nonce: number;
			};
			const ledger = useMockLedger.getState();
			await delay(ledger.config.delays.send);

			const action = body.action;

			if (action.type === "sendAsset") {
				let sender: `0x${string}`;
				try {
					sender = (
						await recoverSendAssetSigner(
							{
								hyperliquidChain: action.hyperliquidChain ?? "Mainnet",
								destination: action.destination ?? "0x0",
								sourceDex: action.sourceDex ?? "",
								destinationDex: action.destinationDex ?? "",
								token: action.token ?? "",
								amount: action.amount ?? "0",
								fromSubAccount: action.fromSubAccount ?? "",
								nonce: action.nonce,
								signatureChainId: action.signatureChainId ?? "0xa4b1",
							},
							body.signature,
						)
					).toLowerCase() as `0x${string}`;
				} catch (e) {
					return HttpResponse.json(
						{
							status: "err",
							response: `Signature recovery failed: ${e instanceof Error ? e.message : String(e)}`,
						},
						{ status: 400 },
					);
				}

				const destination = (
					action.destination ?? ""
				).toLowerCase() as `0x${string}`;
				const amount = Number.parseFloat(action.amount ?? "0");
				const sourcePocket: "perp" | "spot" =
					action.sourceDex === "spot" ? "spot" : "perp";
				const destPocket: "perp" | "spot" =
					action.destinationDex === "spot" ? "spot" : "perp";

				const result = applySend(
					network,
					sender,
					destination,
					sourcePocket,
					destPocket,
					amount,
					body.nonce,
				);

				if (!result.ok) {
					return HttpResponse.json(
						{ status: "err", response: result.error },
						{ status: 400 },
					);
				}

				return HttpResponse.json({
					status: "ok",
					response: { type: "default" },
				});
			}

			return HttpResponse.json({
				status: "ok",
				response: { type: "default" },
			});
		},
	);
}

function respondFaucet() {
	return http.post(
		"https://api-ui.hyperliquid-testnet.xyz/info",
		async ({ request }) => {
			const body = (await request.json()) as { type: string; user?: string };
			const ledger = useMockLedger.getState();

			if (body.type !== "claimDrip") {
				return HttpResponse.json({});
			}

			await delay(ledger.config.delays.faucet);

			const user = (body.user ?? "").toLowerCase() as `0x${string}`;
			if (ledger.config.faucet.forceFailure) {
				return HttpResponse.json("Faucet rate-limited (mock forceFailure)");
			}
			// Real HL faucet requires the address to exist on mainnet first.
			const mainnetState = ledger.mainnet.get(user);
			if (!mainnetState || !mainnetState.activated) {
				return HttpResponse.json(
					`Cannot claim drip because user ${user} does not exist on mainnet.`,
				);
			}

			const amount = ledger.config.faucet.amount;
			ledger.credit("testnet", user, "perp", amount);
			ledger.setActivated("testnet", user);
			ledger.appendEvent("testnet", user, {
				time: Date.now(),
				hash: `0x${Date.now().toString(16).padStart(64, "0")}` as `0x${string}`,
				delta: {
					type: "deposit",
					usdc: amount.toFixed(1),
				},
			});
			return HttpResponse.json({});
		},
	);
}

// WebSocket handler for `useWebData` — respond to subscribe with a snapshot.
// Balances are static after subscribe; users need to refresh to see updates in
// mock mode. Fine for testing the chain flow.
function respondWebSocket(network: Network) {
	const url =
		network === "testnet"
			? "wss://api.hyperliquid-testnet.xyz/ws"
			: "wss://api.hyperliquid.xyz/ws";
	const link = ws.link(url);
	link.addEventListener("connection", ({ client }) => {
		client.addEventListener("message", (event) => {
			try {
				const rawData = event.data;
				const text = typeof rawData === "string" ? rawData : "";
				const msg = JSON.parse(text) as {
					method: string;
					subscription?: { type: string; user?: string };
				};
				if (msg.method !== "subscribe" || !msg.subscription) return;
				const sub = msg.subscription;
				const user = (sub.user ?? "").toLowerCase() as `0x${string}`;
				const state = useMockLedger.getState()[network].get(user);
				if (sub.type === "clearinghouseState") {
					client.send(
						JSON.stringify({
							channel: "clearinghouseState",
							data: {
								clearinghouseState: {
									marginSummary: {
										accountValue: (state?.perp ?? 0).toFixed(6),
										totalNtlPos: "0.0",
										totalRawUsd: (state?.perp ?? 0).toFixed(6),
										totalMarginUsed: "0.0",
									},
									crossMarginSummary: {
										accountValue: (state?.perp ?? 0).toFixed(6),
										totalNtlPos: "0.0",
										totalRawUsd: (state?.perp ?? 0).toFixed(6),
										totalMarginUsed: "0.0",
									},
									crossMaintenanceMarginUsed: "0.0",
									withdrawable: (state?.perp ?? 0).toFixed(6),
									assetPositions: [],
									time: Date.now(),
								},
								user,
							},
						}),
					);
				}
				if (sub.type === "spotState") {
					client.send(
						JSON.stringify({
							channel: "spotState",
							data: {
								spotState: {
									balances:
										state && state.spot > 0
											? [
													{
														coin: "USDC",
														token: 0,
														total: state.spot.toFixed(6),
														hold: "0.0",
														entryNtl: state.spot.toFixed(6),
													},
												]
											: [],
								},
								user,
							},
						}),
					);
				}
			} catch {
				// Ignore malformed messages
			}
		});
	});
	return link;
}

export const handlers = [
	respondInfo("mainnet"),
	respondInfo("testnet"),
	respondExchange("mainnet"),
	respondExchange("testnet"),
	respondFaucet(),
	respondWebSocket("mainnet"),
	respondWebSocket("testnet"),
];
