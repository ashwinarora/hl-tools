import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { policyQueryOptions } from "#/components/tools/multisig/policyQuery";
import { SELF_STALE_MS } from "../model/selfTreasury";
import {
	rememberSelfTreasury,
	selfTreasuryQueryOptions,
} from "./useSelfTreasury";

const WALLET = "0x00000000000000000000000000000000000000Aa";

describe("is the connected wallet a treasury?", () => {
	it("shares its answer with a treasury page's signer set, and is asked once in five minutes", () => {
		const o = selfTreasuryQueryOptions("testnet", WALLET);
		expect(o.queryKey).toEqual(policyQueryOptions("testnet", WALLET).queryKey);
		expect(o.staleTime).toBe(SELF_STALE_MS);
		expect(SELF_STALE_MS).toBe(300_000);
		// never on a timer, never because the tab came back
		expect(o.refetchInterval).toBe(false);
		expect(o.refetchOnWindowFocus).toBe(false);
	});

	it("is written in directly after a conversion made on the page", () => {
		const queries = new QueryClient();
		const policy = {
			authorizedUsers: [
				"0x00000000000000000000000000000000000000bb",
				"0x00000000000000000000000000000000000000cc",
			],
			threshold: 2,
			observedAt: 1_700_000_000_000,
		} as const;
		rememberSelfTreasury(queries, "testnet", WALLET, policy as never, 5);
		const key = selfTreasuryQueryOptions(
			"testnet",
			WALLET.toLowerCase(),
		).queryKey;
		expect(queries.getQueryData(key)).toMatchObject({
			network: "testnet",
			observedAt: 5,
			data: policy,
		});
		// and taken out again when the account is converted back
		rememberSelfTreasury(queries, "testnet", WALLET, null, 6);
		expect(queries.getQueryData(key)).toMatchObject({ data: null });
	});
});
