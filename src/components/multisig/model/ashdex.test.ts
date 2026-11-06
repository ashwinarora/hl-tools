import { describe, expect, it } from "vitest";
import { ashdexOrigin, ashdexTreasuryLink, isAshdexName } from "./ashdex";

const T = "0x146432842836EF7381187DFC5A279EDAA668233E";

describe("Ashdex links", () => {
	it("needs the site of that network, set at build time", () => {
		expect(ashdexOrigin("mainnet", {})).toBe(null);
		expect(
			ashdexOrigin("testnet", { VITE_ASHDEX_URL: "https://ashdex.app" }),
		).toBe(null);
		expect(
			ashdexOrigin("testnet", {
				VITE_ASHDEX_TESTNET_URL: " https://testnet.ashdex.app/x ",
			}),
		).toBe("https://testnet.ashdex.app");
		expect(ashdexOrigin("mainnet", { VITE_ASHDEX_URL: "javascript:x" })).toBe(
			null,
		);
		expect(ashdexOrigin("mainnet", { VITE_ASHDEX_URL: "not a url" })).toBe(
			null,
		);
	});

	it("carries only public identifiers", () => {
		const link = ashdexTreasuryLink("https://testnet.ashdex.app", {
			network: "testnet",
			treasury: T,
			agent: "0xDBE64ADD3251883BA828AA29D9AB39860A67BE89",
		});
		expect(link).toBe(
			`https://testnet.ashdex.app/treasury?network=testnet&treasury=${T.toLowerCase()}&agent=0xdbe64add3251883ba828aa29d9ab39860a67be89`,
		);
		expect(
			ashdexTreasuryLink("http://localhost:3020", {
				network: "testnet",
				treasury: T,
			}),
		).toBe(
			`http://localhost:3020/treasury?network=testnet&treasury=${T.toLowerCase()}`,
		);
	});

	it("knows the names Ashdex gives", () => {
		expect(isAshdexName("ashdex dbe6")).toBe(true);
		expect(isAshdexName("ashdex")).toBe(true);
		expect(isAshdexName("Ashdex 1a2b")).toBe(true);
		expect(isAshdexName("ashdexbot")).toBe(false);
		expect(isAshdexName("rebalancer")).toBe(false);
		expect(isAshdexName("")).toBe(false);
	});
});
