import { HLP_VAULT, type Network, type VaultLookup } from "@hl-tools/core";
import { Field, Segmented, TextInput } from "#/components/hub/layout";
import { cn } from "#/lib/utils";
import type { Vaults } from "../live/useVaults";
import type { ActionForm } from "../model/actions";
import { amountText } from "../model/chain/columns";
import type { Line } from "../model/signerSet";
import { shortAddress } from "../model/stage";
import { untilWords } from "../model/time";
import {
	lockupWords,
	VAULT,
	VAULT_KINDS,
	type VaultKind,
	type VaultPlan,
	vaultFactLines,
	vaultLabel,
	vaultStepSentence,
} from "../model/vault";
import { Help } from "../shell/Help";
import { When } from "../shell/live";
import { Lines } from "../signers/parts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The two vault forms. A deposit names a vault by its address (HLP has a
 * button); a withdrawal picks one of the vaults the treasury has money in.
 * What Hyperliquid reports about the vault is shown as it is, and the steps
 * are spelled out before anything is created.
 */
export function VaultFields({
	form,
	set,
	error,
	network,
	vaults,
	lookup,
	lookupLoading,
	names,
	movable,
	unified,
	plan,
	now,
}: {
	form: ActionForm;
	set: <K extends keyof ActionForm>(key: K, value: ActionForm[K]) => void;
	error: (field: keyof ActionForm) => string | undefined;
	network: Network;
	/** The treasury's own deposits. */
	vaults: Vaults;
	/** The vault at the address in the form; null while it is not read. */
	lookup: VaultLookup | null;
	lookupLoading: boolean;
	/** The names of the vaults the treasury has money in, by address, as far as they are read. */
	names: ReadonlyMap<string, string>;
	/** What can be moved now; null while not read. */
	movable: { readonly perps: string | null; readonly spotUsdc: string | null };
	/** The treasury is a unified account: one balance. */
	unified: boolean;
	plan: VaultPlan;
	now: number;
}) {
	const kind = form.kind as VaultKind;
	const deposit = kind === "vaultDeposit";
	const typed = form.vault.trim().toLowerCase();
	// to the last decimal: a figure rounded up would promise more than can be moved
	const usdc = (v: string | null | undefined) =>
		v === null || v === undefined ? "…" : `${amountText(v)} USDC`;
	const info =
		lookup?.kind === "vault" && lookup.vault.address === typed
			? lookup.vault
			: null;
	const hlp = HLP_VAULT[network];
	const deposits = vaults.deposits;

	// the plan's amber lines; errors stand under their fields
	const lines: Line[] = plan.issues
		.filter((i) => i.severity === "warning")
		.map((i) => ({ level: "warning", code: i.code, text: i.message }));
	const steps = plan.steps;

	return (
		<div className="space-y-4">
			<Segmented<VaultKind>
				label="What to do"
				value={kind}
				onChange={(v) => set("kind", v)}
				options={VAULT_KINDS.map((k) => ({
					value: k,
					label: VAULT.kinds[k].label,
					title: VAULT.kinds[k].description,
				}))}
			/>

			{deposit && (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
					{unified ? (
						<span>
							Can be moved now:{" "}
							<span className="font-mono text-foreground">
								{usdc(movable.spotUsdc)}
							</span>
						</span>
					) : (
						<>
							<span>
								The perps balance can release:{" "}
								<span className="font-mono text-foreground">
									{usdc(movable.perps)}
								</span>
							</span>
							<span>
								In spot, not on hold:{" "}
								<span className="font-mono text-foreground">
									{usdc(movable.spotUsdc)}
								</span>
							</span>
						</>
					)}
				</div>
			)}

			{deposit ? (
				<Field
					label={VAULT.address}
					htmlFor="ms-vault"
					trailing={<Help k="vault" />}
					error={error("vault")}
					hint={VAULT.addressHint}
				>
					<TextInput
						id="ms-vault"
						mono
						value={form.vault}
						onChange={(e) => set("vault", e.target.value)}
						onBlur={(e) => set("vault", e.target.value.trim())}
						placeholder="0x…"
						aria-invalid={!!error("vault")}
					/>
					<div className="mt-2 flex flex-wrap items-center gap-1.5">
						<button
							type="button"
							onClick={() => set("vault", hlp)}
							aria-pressed={typed === hlp}
							title={hlp}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors",
								typed === hlp
									? "border-brand bg-brand-soft"
									: "border-border bg-surface hover:bg-surface-2",
							)}
						>
							<span className="font-medium">{VAULT.hlp}</span>
							<span className="font-mono text-subtle-foreground">
								{shortAddress(hlp)}
							</span>
						</button>
					</div>
				</Field>
			) : (
				<Field
					label={VAULT.pick}
					trailing={<Help k="vault" />}
					error={error("vault")}
				>
					{deposits === null ? (
						<p className="text-[13px] text-muted-foreground">
							{vaults.failed ? VAULT.depositsUnread : VAULT.reading}
						</p>
					) : deposits.length === 0 ? (
						<p className="text-[13px] text-muted-foreground">
							{VAULT.noDeposits}
						</p>
					) : (
						<div
							role="radiogroup"
							aria-label={VAULT.pick}
							className="flex flex-col gap-1.5"
						>
							{deposits.map((d) => {
								const on = typed === d.vault;
								return (
									// biome-ignore lint/a11y/useSemanticElements: the ARIA radio pattern on buttons, as in the hub's Segmented
									<button
										key={d.vault}
										type="button"
										role="radio"
										aria-checked={on}
										onClick={() => set("vault", d.vault)}
										title={d.vault}
										className={cn(
											"flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-md border px-3 py-2 text-left text-sm transition-colors",
											on
												? "border-brand bg-brand-soft"
												: "border-border-strong bg-surface hover:bg-surface-2",
										)}
									>
										<span className="font-semibold">
											{vaultLabel(d.vault, network, names.get(d.vault))}
										</span>
										<span className="font-mono text-xs text-muted-foreground">
											{usdc(d.equity)}
										</span>
										<span className="ml-auto text-xs text-subtle-foreground">
											{d.lockedUntil > now
												? `locked, ${untilWords(d.lockedUntil, now)}`
												: "can be withdrawn"}
										</span>
									</button>
								);
							})}
						</div>
					)}
				</Field>
			)}

			{ADDRESS.test(typed) && (deposit || info) && (
				<div
					data-vault-facts
					className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[13px]"
				>
					{info ? (
						<>
							<p className="font-medium [overflow-wrap:anywhere]">
								{info.name}{" "}
								<span className="font-mono text-xs font-normal text-muted-foreground">
									{info.address}
								</span>
							</p>
							<ul className="mt-1 space-y-0.5 text-muted-foreground">
								{vaultFactLines(info, network).map((line) => (
									<li key={line}>{line}</li>
								))}
							</ul>
							<p className="mt-1.5 text-xs text-subtle-foreground">
								{VAULT.noRecommendation}
							</p>
						</>
					) : lookupLoading ? (
						<p className="text-muted-foreground" aria-busy="true">
							{VAULT.reading}
						</p>
					) : lookup?.kind === "none" ? null : (
						<p className="text-muted-foreground">{VAULT.vaultUnread}</p>
					)}
				</div>
			)}

			<Field
				label={VAULT.amount[kind]}
				htmlFor="ms-vault-amount"
				error={error("amount")}
				hint="In USDC, with up to 6 decimals. It is never rounded for you."
			>
				<TextInput
					id="ms-vault-amount"
					inputMode="decimal"
					value={form.amount}
					onChange={(e) => set("amount", e.target.value)}
					placeholder={deposit ? "5" : "0.0"}
					aria-invalid={!!error("amount")}
				/>
			</Field>

			{steps && (
				<div className="rounded-md border border-border px-3 py-2.5">
					<p className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
						{steps.length === 1 ? VAULT.oneStep : VAULT.twoSteps}
						{steps.length === 2 && <Help k="moveSteps" />}
					</p>
					<ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-sm">
						{steps.map((s) => (
							<li
								key={`${s.kind}:${s.amount}`}
								className="[overflow-wrap:anywhere]"
							>
								{vaultStepSentence(
									s,
									network,
									"vault" in s ? (info?.name ?? names.get(s.vault)) : undefined,
								)}
							</li>
						))}
					</ol>
					<ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
						{deposit && (
							<>
								<li>
									A deposit cannot be withdrawn for{" "}
									{lockupWords(typed, network)} after it is made or added to.
								</li>
								<li>{VAULT.risk}</li>
							</>
						)}
						{!deposit && (
							<li>
								It arrives in the{" "}
								{unified ? "treasury's balance" : "perps balance"}, less the
								leader's share of the profit.
							</li>
						)}
						{plan.opensAt !== null && (
							<li>
								The deposit this takes from is locked. It can be proposed and
								signed now, and submitted from <When at={plan.opensAt} /> (
								{untilWords(plan.opensAt, now)}).
							</li>
						)}
						<li className="flex flex-wrap items-center gap-1">
							<span>{VAULT.code}</span>
							<Help k="signingCode" />
						</li>
					</ul>
				</div>
			)}
			<Lines lines={lines} />
		</div>
	);
}
