import { defineRuleSet, docs } from "./meta.ts";

export const FAUCET_RULES = defineRuleSet({
	id: "faucet",
	title: "Testnet faucet & account activation",
	version: "1.0.1",
	verifiedAt: "2026-10-11",
	summary:
		"The testnet faucet pays 1,000 mock USDC to an address that has deposited on mainnet. Sending USDC with `sendAsset` to an address that does not yet exist on HyperCore charges the sender a flat activation fee on top of the amount (a `usdSend` takes it out of the amount instead: see the transfers rule set). The faucet miner relies on both.",
	sources: [
		docs("onboarding/testnet-faucet", "Testnet faucet"),
		docs(
			"for-developers/api/exchange-endpoint",
			"Exchange endpoint (sendAsset / usdSend)",
		),
	],
	changelog: [
		{ version: "1.0.0", date: "2026-09-28", note: "Initial encoding." },
		{
			version: "1.0.1",
			date: "2026-10-11",
			note: "Wording only: the fee is on top of the amount for `sendAsset`, which the faucet miner uses; measured per method in the transfers rule set.",
		},
	],
});

export const FAUCET_DRIP_USDC = "1000";
