import { defineRuleSet, docs } from "./meta.ts";

export const FAUCET_RULES = defineRuleSet({
	id: "faucet",
	title: "Testnet faucet & account activation",
	version: "1.0.0",
	verifiedAt: "2026-09-28",
	summary:
		"The testnet faucet pays 1,000 mock USDC to an address that has deposited on mainnet. Sending USDC to an address that does not yet exist on HyperCore charges the sender a flat activation fee on top of the amount. The faucet miner relies on both.",
	sources: [
		docs("onboarding/testnet-faucet", "Testnet faucet"),
		docs(
			"for-developers/api/exchange-endpoint",
			"Exchange endpoint (sendAsset / usdSend)",
		),
	],
	changelog: [
		{ version: "1.0.0", date: "2026-09-28", note: "Initial encoding." },
	],
});

export const FAUCET_DRIP_USDC = "1000";
