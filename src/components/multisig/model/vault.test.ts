import {
	accountMode,
	HLP_VAULT,
	type Issue,
	parseVaultDetails,
	type VaultLookup,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { RECIPIENT } from "#/test/keys";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import {
	isVaultKind,
	kindOffered,
	lockupWords,
	planVault,
	usdcShown,
	VAULT,
	VAULT_REFUSALS,
	type VaultInput,
	type VaultRead,
	vaultActionLine,
	vaultActions,
	vaultFactLines,
	vaultFacts,
	vaultLabel,
	vaultStepSentence,
	vaultsSummaryLine,
	vaultsView,
} from "./vault";

const V = "0x49d05977597b22e3c73d654c351adde9d9920e18";
const HLP = HLP_VAULT.testnet;
const NOW = 1_791_900_000_000;
const DAY = 24 * 3_600_000;
const MANUAL = accountMode("default");
const UNIFIED = accountMode("unifiedAccount");
const detail = (over: Record<string, unknown> = {}): VaultLookup =>
	parseVaultDetails({
		name: "Crazy Franck",
		vaultAddress: V,
		leader: RECIPIENT,
		leaderCommission: 0.1,
		apr: 0.0486,
		portfolio: [
			["day", { accountValueHistory: [[NOW - 1000, "142444.19"]] }],
			["allTime", { accountValueHistory: [[1_700_000_000_000, "10"]] }],
		],
		isClosed: false,
		allowDeposits: true,
		...over,
	});
const read = (over: Partial<VaultRead> = {}): VaultRead => ({
	mode: MANUAL,
	perps: "100",
	spot: "40",
	deposits: [],
	vault: detail(),
	...over,
});
const dep = (amount: string, vault = V): VaultInput => ({
	kind: "vaultDeposit",
	amount,
	vault,
});
const wd = (amount: string, vault = V): VaultInput => ({
	kind: "vaultWithdraw",
	amount,
	vault,
});
const plan = (form: VaultInput, r: VaultRead | null = read()) =>
	planVault(form, r, "testnet", NOW);
const codes = (issues: readonly Issue[]) =>
	issues.map((i) => `${i.severity}:${i.code}`);

describe("a copy of the app without the signing network", () => {
	it("offers no vault form, and every other form as before", () => {
		expect(kindOffered("vaultDeposit", false)).toBe(false);
		expect(kindOffered("vaultWithdraw", false)).toBe(false);
		expect(kindOffered("vaultDeposit", true)).toBe(true);
		for (const kind of ["sendUsdc", "stake", "accountMode", "raw"]) {
			expect(kindOffered(kind, false)).toBe(true);
			expect(kindOffered(kind, true)).toBe(true);
		}
	});
});

describe("a deposit", () => {
	it("is one step when the perps balance can release it", () => {
		const p = plan(dep("50"));
		expect(p.steps).toEqual([{ kind: "deposit", vault: V, amount: "50" }]);
		expect(p.issues).toEqual([]);
		expect(p.opensAt).toBeNull();
	});

	it("is two steps when the rest is in spot: the missing part moves to perps first", () => {
		const p = plan(dep("120"));
		expect(p.steps).toEqual([
			{ kind: "toPerps", amount: "20" },
			{ kind: "deposit", vault: V, amount: "120" },
		]);
		expect(p.issues).toEqual([]);
	});

	it("is always one step in a unified account, taken from its one balance", () => {
		const p = plan(dep("30"), read({ mode: UNIFIED, perps: "0", spot: "40" }));
		expect(p.steps).toEqual([{ kind: "deposit", vault: V, amount: "30" }]);
		expect(p.issues).toEqual([]);
		// more than that one balance holds
		const over = plan(
			dep("41"),
			read({ mode: UNIFIED, perps: "0", spot: "40" }),
		);
		expect(over.steps).toBeNull();
		expect(over.issues[0]?.message).toBe(
			"This deposits more USDC than the treasury can move into a vault now. Its balance can release 40 USDC, and this deposits 41 USDC.",
		);
	});

	it("is blocked where Hyperliquid would refuse, with the reason beside the right field", () => {
		const cases: [VaultInput, VaultRead, string, string, string][] = [
			[
				dep("4.99"),
				read(),
				"error:vault.vault-min-deposit",
				"amount",
				"at least 5 USDC",
			],
			[
				dep("141"),
				read(),
				"error:vault.deposit-funds",
				"amount",
				"The perps balance can release 100 USDC and spot holds 40 USDC, and this deposits 141 USDC.",
			],
			[
				dep("50"),
				read({ vault: detail({ isClosed: true }) }),
				"error:vault.vault-closed",
				"vaultAddress",
				"This vault is closed",
			],
			[
				dep("50"),
				read({ vault: detail({ allowDeposits: false }) }),
				"error:vault.vault-no-deposits",
				"vaultAddress",
				"switched deposits off",
			],
			[
				dep("50"),
				read({ vault: { kind: "none" } }),
				"error:vault.vault-unregistered",
				"vaultAddress",
				"There is no vault at this address",
			],
		];
		for (const [form, r, code, field, text] of cases) {
			const p = plan(form, r);
			expect(codes(p.issues), text).toEqual([code]);
			expect(p.issues[0]?.path).toBe(`action.${field}`);
			expect(p.issues[0]?.message).toContain(text);
			expect(p.steps).toBeNull();
		}
	});

	it("says in one amber line that adding to a deposit locks all of it again", () => {
		const p = plan(
			dep("50"),
			read({
				deposits: [{ vault: V, equity: "200.5", lockedUntil: NOW - DAY }],
			}),
		);
		expect(codes(p.issues)).toEqual(["warning:vault.relocks"]);
		expect(p.issues[0]?.message).toBe(
			"The treasury already has 200.5 USDC in this vault. Adding to it locks all of it again: none of it can be withdrawn for 20 seconds.",
		);
		expect(p.steps).toHaveLength(1);
		// a deposit elsewhere is no deposit here
		expect(
			plan(
				dep("50"),
				read({ deposits: [{ vault: HLP, equity: "9", lockedUntil: 0 }] }),
			).issues,
		).toEqual([]);
	});

	it("warns, and does not guess, about what it could not read", () => {
		const noMode = plan(dep("120"), read({ mode: null }));
		expect(codes(noMode.issues)).toEqual(["warning:mode.unread"]);
		// one step: no balance is assumed to be the one a deposit takes from
		expect(noMode.steps).toEqual([
			{ kind: "deposit", vault: V, amount: "120" },
		]);
		const noVault = plan(dep("50"), read({ vault: null }));
		expect(codes(noVault.issues)).toEqual(["warning:vault.unread"]);
		expect(noVault.steps).toHaveLength(1);
		expect(
			codes(plan(dep("50"), read({ vault: { kind: "unreadable" } })).issues),
		).toEqual(["warning:vault.unread"]);
		// an answer about another address says nothing about this one
		expect(
			codes(
				plan(dep("50", HLP), read({ vault: detail({ isClosed: true }) }))
					.issues,
			),
		).toEqual(["warning:vault.unread"]);
		// while the mode is on its way nothing is said, and nothing is judged by a balance
		const loading = plan(dep("120"), read({ mode: undefined }));
		expect(loading.issues).toEqual([]);
		expect(loading.steps).toEqual([
			{ kind: "deposit", vault: V, amount: "120" },
		]);
		// balances not read: nothing is refused for them
		expect(plan(dep("5000"), read({ perps: null, spot: null })).issues).toEqual(
			[],
		);
	});

	it("needs an amount and an address before anything is said", () => {
		expect(codes(plan(dep("")).issues)).toEqual(["error:field.required"]);
		expect(codes(plan(dep("50", "")).issues)).toEqual(["error:field.required"]);
		expect(codes(plan(dep("50", "0x12")).issues)).toEqual([
			"error:address.invalid",
		]);
		expect(codes(plan(dep("1.0000001")).issues)).toEqual([
			"error:amount.precision",
		]);
		expect(plan(dep("50"), null)).toEqual({
			steps: null,
			issues: [],
			opensAt: null,
		});
	});
});

describe("a withdrawal", () => {
	const held = (equity: string, lockedUntil = NOW - DAY) =>
		read({ deposits: [{ vault: V, equity, lockedUntil }] });

	it("is one step, from a deposit whose lockup has ended", () => {
		const p = plan(wd("20"), held("100"));
		expect(p.steps).toEqual([{ kind: "withdraw", vault: V, amount: "20" }]);
		expect(p.issues).toEqual([]);
		expect(p.opensAt).toBeNull();
	});

	it("can be proposed and signed inside the lockup, and says when it can be submitted", () => {
		const p = plan(wd("20"), held("100", NOW + 2 * DAY));
		expect(p.steps).toHaveLength(1);
		expect(p.issues).toEqual([]);
		// a little after the lockup's end: clocks differ, and a refusal uses the proposal up
		expect(p.opensAt).toBe(NOW + 2 * DAY + 5_000);
	});

	it("is blocked when the lockup ends only after the proposal would have closed", () => {
		// HLP: four days locked, and a proposal is open for two (three at most)
		const locked = held("100", NOW + 4 * DAY);
		const closes = NOW + 2 * DAY;
		const p = planVault(wd("20"), locked, "testnet", NOW, closes);
		expect(codes(p.issues)).toEqual(["error:vault.lockup_outlasts"]);
		expect(p.steps).toBeNull();
		expect(p.opensAt).toBeNull();
		// beside the vault it is about, with both lengths, and what to do
		expect(p.issues[0]?.path).toBe("action.vaultAddress");
		expect(p.issues[0]?.message).toBe(
			"The deposit this takes from is locked longer than this proposal would stay open: it can be withdrawn in 4 days, and a proposal made now closes in 2 days. Hyperliquid would refuse it the whole time. Make this proposal once the lockup has less time left than the signing window.",
		);
		// the longer window is long enough for a lockup of under three days
		const fits = planVault(
			wd("20"),
			held("100", NOW + 2 * DAY + 3_600_000),
			"testnet",
			NOW,
			NOW + 3 * DAY - 3_600_000,
		);
		expect(fits.issues).toEqual([]);
		expect(fits.opensAt).toBe(NOW + 2 * DAY + 3_600_000 + 5_000);
		// the few seconds kept after the lockup's end count: ending with the
		// window is too late
		const edge = planVault(
			wd("20"),
			held("100", closes - 5_000),
			"testnet",
			NOW,
			closes,
		);
		expect(codes(edge.issues)).toEqual(["error:vault.lockup_outlasts"]);
		// a caller that names no closing moment holds no lockup against it
		expect(plan(wd("20"), locked).issues).toEqual([]);
		// and a deposit is never held up by it
		expect(
			codes(planVault(dep("20"), locked, "testnet", NOW, closes).issues),
		).toEqual(["warning:vault.relocks"]);
	});

	it("is blocked when it asks for more than the deposit is worth, or there is none", () => {
		const over = plan(wd("100.01"), held("100"));
		expect(codes(over.issues)).toEqual(["error:vault.vault-equity"]);
		expect(over.issues[0]?.message).toBe(
			"This withdraws more USDC than the treasury's deposit in that vault is worth now. It is worth 100 USDC, and this withdraws 100.01 USDC.",
		);
		expect(over.steps).toBeNull();
		// also while it is locked: the amount is judged as of the lockup's end
		expect(codes(plan(wd("100.01"), held("100", NOW + DAY)).issues)).toEqual([
			"error:vault.vault-equity",
		]);
		const none = plan(wd("5"), read({ deposits: [] }));
		expect(none.issues[0]?.message).toContain(
			"The treasury has nothing in this vault.",
		);
		// what Hyperliquid says can be taken out now is the limit when it said so
		const capped = plan(
			wd("95"),
			read({
				deposits: [{ vault: V, equity: "100", lockedUntil: 0 }],
				vault: detail({
					followerState: { vaultEquity: "100", allTimePnl: "1" },
					maxWithdrawable: 90,
				}),
			}),
		);
		expect(capped.issues[0]?.message).toContain("It is worth 90 USDC");
	});

	it("says in one amber line that an amount close to all of it may be refused later", () => {
		const p = plan(wd("99.5"), held("100"));
		expect(codes(p.issues)).toEqual(["warning:vault.nearly_all"]);
		expect(p.issues[0]?.message).toContain(
			"This is nearly all of the deposit, which is worth 100 USDC now.",
		);
		expect(p.steps).toHaveLength(1);
		expect(plan(wd("98.99"), held("100")).issues).toEqual([]);
		expect(codes(plan(wd("100"), held("100")).issues)).toEqual([
			"warning:vault.nearly_all",
		]);
	});

	it("warns when the deposits could not be read, and blocks nothing for it", () => {
		const p = plan(wd("20"), read({ deposits: null }));
		expect(codes(p.issues)).toEqual(["warning:deposits.unread"]);
		expect(p.steps).toHaveLength(1);
	});
});

describe("the actions of a plan", () => {
	const HEAD = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
	it("are a readable move to perps with its own number, then the vault action with none", () => {
		expect(
			vaultActions(
				[
					{ kind: "toPerps", amount: "20" },
					{ kind: "deposit", vault: V, amount: "120" },
				],
				HEAD,
				NOW,
			),
		).toEqual([
			{
				type: "usdClassTransfer",
				...HEAD,
				amount: "20",
				toPerp: true,
				nonce: NOW,
			},
			{
				type: "vaultTransfer",
				vaultAddress: V,
				isDeposit: true,
				usd: 120_000_000,
			},
		]);
		expect(
			vaultActions([{ kind: "withdraw", vault: V, amount: "1.5" }], HEAD, NOW),
		).toEqual([
			{
				type: "vaultTransfer",
				vaultAddress: V,
				isDeposit: false,
				usd: 1_500_000,
			},
		]);
		// an amount the action cannot carry exactly makes no action
		expect(
			vaultActions(
				[{ kind: "deposit", vault: V, amount: "0.0000001" }],
				HEAD,
				NOW,
			),
		).toEqual([]);
	});
});

describe("the judge's facts", () => {
	it("take a unified account's one balance as what a deposit draws on", () => {
		expect(
			vaultFacts(read({ mode: UNIFIED, perps: "0", spot: "40" }), V),
		).toMatchObject({
			unified: true,
			perps: "40",
			deposit: "none",
		});
		expect(vaultFacts(read({ deposits: null }), V).deposit).toBeNull();
		expect(
			vaultFacts(
				read({ deposits: [{ vault: V, equity: "1", lockedUntil: 2 }] }),
				V,
			).deposit,
		).toEqual({ vault: V, equity: "1", lockedUntil: 2 });
		// what can be withdrawn is the read vault's word, and only about that vault
		expect(vaultFacts(read(), HLP).maxWithdrawable).toBeNull();
	});
});

describe("words", () => {
	it("names HLP by its name and any other vault by its own, always with the address", () => {
		expect(vaultLabel(HLP, "testnet")).toBe("HLP (0xa150…b0a0)");
		expect(vaultLabel(V, "testnet")).toBe("vault 0x49d0…0e18");
		expect(vaultLabel(V, "testnet", " Crazy Franck ")).toBe(
			"“Crazy Franck” (0x49d0…0e18)",
		);
		// testnet's HLP is an ordinary address on mainnet
		expect(vaultLabel(HLP, "mainnet")).toBe("vault 0xa150…b0a0");
		expect(vaultLabel(V, "testnet", "x".repeat(60))).toContain(
			`“${"x".repeat(40)}”`,
		);
	});

	it("says each step, and a vault action as a line in a list", () => {
		expect(
			vaultStepSentence({ kind: "toPerps", amount: "20" }, "testnet"),
		).toBe("Move 20 USDC from the spot balance to the perps balance");
		expect(
			vaultStepSentence(
				{ kind: "deposit", vault: HLP, amount: "50000" },
				"testnet",
			),
		).toBe("Deposit 50,000 USDC into HLP (0xa150…b0a0)");
		expect(
			vaultStepSentence(
				{ kind: "withdraw", vault: V, amount: "1.5" },
				"testnet",
				"Crazy Franck",
			),
		).toBe("Withdraw 1.5 USDC from “Crazy Franck” (0x49d0…0e18)");
		expect(
			vaultActionLine(
				{
					type: "vaultTransfer",
					vaultAddress: V,
					isDeposit: true,
					usd: 5_000_000,
				},
				"testnet",
			),
		).toBe("Deposit 5 USDC into vault 0x49d0…0e18");
		expect(vaultActionLine({ type: "usdSend" }, "testnet")).toBeNull();
	});

	it("gives a lockup's length, and says so when it is the documentation's", () => {
		expect(lockupWords(HLP, "testnet")).toBe("4 days");
		expect(lockupWords(V, "testnet")).toBe("20 seconds");
		expect(lockupWords(V, "mainnet")).toBe(
			"1 day (as Hyperliquid's documentation gives it)",
		);
		expect(lockupWords(HLP_VAULT.mainnet, "mainnet")).toContain("4 days (as");
	});

	it("lists a vault's facts as Hyperliquid reports them, judging nothing", () => {
		const time = { locale: "en-GB", timeZone: "UTC" };
		const info = (l: VaultLookup) => (l.kind === "vault" ? l.vault : null);
		expect(vaultFactLines(info(detail()) as never, "testnet", time)).toEqual([
			"Led by 0x5aae…eaed, who keeps 10% of a depositor's profit.".replace(
				"0x5aae…eaed",
				`${RECIPIENT.slice(0, 6)}…${RECIPIENT.slice(-4)}`,
			),
			"Holds 142,444 USDC now.",
			"Past yearly rate, as Hyperliquid works it out: 4.86%. A past rate promises nothing.",
			"In use since 14 Nov 2023.",
			"Takes deposits.",
		]);
		const hlp = info(
			parseVaultDetails({
				name: "HLP",
				vaultAddress: HLP,
				leader: RECIPIENT,
				isClosed: true,
			}),
		);
		expect(vaultFactLines(hlp as never, "testnet", time)).toEqual([
			"Hyperliquid's own vault (HLP). Nobody takes a share of the profit.",
			"Closed: it takes no more deposits.",
		]);
		const quiet = info(
			detail({ leaderCommission: 0, allowDeposits: false, apr: -0.02 }),
		);
		const lines = vaultFactLines(quiet as never, "testnet", time);
		expect(lines[0]).toContain("who takes no share of the profit");
		expect(lines).toContain("Its leader has switched deposits off.");
		expect(lines.join(" ")).toContain("-2%");
		const bare = info(detail({ leaderCommission: undefined }));
		expect(vaultFactLines(bare as never, "testnet", time)[0]).toMatch(
			/^Led by 0x.{4}….{4}\.$/,
		);
	});

	it("has a sentence for every refusal the judge can give, and promises nothing", () => {
		expect(Object.keys(VAULT_REFUSALS).sort()).toEqual([
			"deposit-funds",
			"transfer-balance",
			"vault-closed",
			"vault-equity",
			"vault-lockup",
			"vault-min-deposit",
			"vault-no-deposits",
			"vault-unregistered",
		]);
		const texts = [
			...Object.values(VAULT_REFUSALS),
			...(Object.values(VAULT).filter(
				(v) => typeof v === "string",
			) as string[]),
			...Object.values(VAULT.kinds).flatMap((k) => [k.label, k.description]),
			...Object.values(VAULT.amount),
		];
		for (const text of texts)
			for (const pattern of FORBIDDEN_CLAIMS)
				expect(text, `${pattern}`).not.toMatch(pattern);
		expect(isVaultKind("vaultDeposit")).toBe(true);
		expect(isVaultKind("stake")).toBe(false);
	});
});

describe("the Vaults tab", () => {
	const deposits = [
		{ vault: V, equity: "7.00119779", lockedUntil: NOW - DAY },
		{ vault: HLP, equity: "10.00017", lockedUntil: NOW + 2 * DAY },
	];
	it("lists each deposit with what Hyperliquid reports about it, the largest first", () => {
		const details = new Map<string, VaultLookup>([
			[
				V,
				detail({
					followerState: {
						vaultEquity: "7.00119779",
						allTimePnl: "0.0115",
						vaultEntryTime: NOW - 9 * DAY,
						lockupUntil: NOW - DAY,
					},
					allowDeposits: false,
				}),
			],
		]);
		const view = vaultsView(deposits, details, "testnet", NOW);
		expect(view.total).toBe("17.00136779");
		expect(view.rows).toEqual([
			{
				vault: HLP,
				// not read yet: no name, no figures invented
				name: "",
				hlp: true,
				equity: "10.00017",
				pnl: null,
				since: null,
				lockedUntil: NOW + 2 * DAY,
				locked: true,
				shut: false,
			},
			{
				vault: V,
				name: "Crazy Franck",
				hlp: false,
				equity: "7.00119779",
				pnl: "0.0115",
				since: NOW - 9 * DAY,
				lockedUntil: NOW - DAY,
				locked: false,
				shut: true,
			},
		]);
	});

	it("says nothing while the deposits are unread, and an empty list when there are none", () => {
		expect(vaultsView(null, new Map(), "testnet", NOW)).toEqual({
			rows: null,
			total: null,
		});
		expect(vaultsView([], new Map(), "testnet", NOW)).toEqual({
			rows: [],
			total: "0",
		});
	});

	it("shows a deposit's figures cut, never rounded up, and dust as it is", () => {
		expect(usdcShown("24.999999")).toBe("24.99");
		expect(usdcShown("25.000202")).toBe("25.00");
		expect(usdcShown("1234.5")).toBe("1,234.50");
		expect(usdcShown("0")).toBe("0.00");
		// what "withdraw everything" leaves, a first hour's profit, a small loss
		expect(usdcShown("0.000653")).toBe("0.000653");
		expect(usdcShown("0.0001374779")).toBe("0.000137");
		expect(usdcShown("-0.0000004733")).toBe("0");
		expect(usdcShown("-12.349")).toBe("-12.34");
		expect(usdcShown("much")).toBe("much");
	});

	it("gives the Overview one line, cut and not rounded up", () => {
		expect(vaultsSummaryLine(deposits)).toBe("17.00 USDC in 2 vaults");
		expect(vaultsSummaryLine(deposits.slice(0, 1))).toBe(
			"7.00 USDC in 1 vault",
		);
		expect(
			vaultsSummaryLine([{ vault: V, equity: "1234.999", lockedUntil: 0 }]),
		).toBe("1,234.99 USDC in 1 vault");
		// nothing in a vault, dust that is no money, or not read: no line
		expect(vaultsSummaryLine([])).toBeNull();
		expect(vaultsSummaryLine(null)).toBeNull();
		expect(
			vaultsSummaryLine([{ vault: V, equity: "0", lockedUntil: 0 }]),
		).toBeNull();
	});
});
