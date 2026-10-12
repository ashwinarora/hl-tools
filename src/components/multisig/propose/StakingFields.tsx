import type { Network } from "@hl-tools/core";
import { RefreshCw } from "lucide-react";
import { Field, Segmented, Select, TextInput } from "#/components/hub/layout";
import type { Staking } from "../live/useStaking";
import type { ActionForm } from "../model/actions";
import { amountText } from "../model/chain/columns";
import type { Line } from "../model/signerSet";
import {
	lockupWords,
	queueWords,
	STAKING,
	STAKING_KINDS,
	type StakingKind,
	type StakingPlan,
	stepSentence,
	validatorLabel,
} from "../model/staking";
import { untilWords } from "../model/time";
import { Help } from "../shell/Help";
import { When } from "../shell/live";
import { Lines } from "../signers/parts";
import { ValidatorPicker } from "./ValidatorPicker";

/**
 * The three staking forms. Each names where the HYPE should end up; what is
 * already in the staking balance decides whether that takes one proposal or
 * two, and the steps are spelled out before anything is created.
 */
export function StakingFields({
	form,
	set,
	error,
	network,
	staking,
	spotAvailable,
	plan,
	now,
}: {
	form: ActionForm;
	set: <K extends keyof ActionForm>(key: K, value: ActionForm[K]) => void;
	error: (field: keyof ActionForm) => string | undefined;
	network: Network;
	staking: Staking;
	/** Spot HYPE that is not on hold; null while not read. */
	spotAvailable: string | null;
	plan: StakingPlan;
	now: number;
}) {
	const kind = form.kind as StakingKind;
	const validators = staking.validators;
	const stakes = staking.delegations ?? [];
	const hype = (v: string | null | undefined) =>
		v === null || v === undefined ? "…" : `${amountText(v)} HYPE`;
	const unread = !staking.pending && staking.summary === null;

	/** One of the treasury's own stakes, to unstake from. */
	const fromStake = (id: string, label: string) => (
		<Field
			label={label}
			htmlFor={id}
			trailing={<Help k="stakeLockup" />}
			error={error("validator")}
			hint={
				staking.delegations === null
					? "Reading the treasury's stakes…"
					: stakes.length === 0
						? "The treasury has nothing staked."
						: undefined
			}
		>
			<Select
				id={id}
				value={form.validator.trim().toLowerCase()}
				onChange={(e) => set("validator", e.target.value)}
				aria-invalid={!!error("validator")}
				disabled={stakes.length === 0}
			>
				<option value="">Choose a validator…</option>
				{stakes.map((d) => (
					<option key={d.validator} value={d.validator}>
						{validatorLabel(d.validator, validators)} · {hype(d.amount)} staked
						{d.lockedUntil > now
							? ` · locked, ${untilWords(d.lockedUntil, now)}`
							: ""}
					</option>
				))}
			</Select>
		</Field>
	);

	/** A validator to stake with: from the list, or typed when the list could not be read. */
	const toValidator = (
		field: "validator" | "toValidator",
		label: string,
		exclude?: string,
	) => (
		<Field
			label={label}
			trailing={<Help k="validatorState" />}
			error={error(field)}
		>
			{validators ? (
				<ValidatorPicker
					network={network}
					validators={validators}
					value={form[field]}
					onChange={(address) => set(field, address)}
					label={label}
					exclude={exclude}
				/>
			) : staking.checking ? (
				<p className="text-sm text-muted-foreground" aria-busy="true">
					Reading the validators from Hyperliquid…
				</p>
			) : (
				<TextInput
					value={form[field]}
					onChange={(e) => set(field, e.target.value)}
					placeholder="0x… the validator's address"
					aria-invalid={!!error(field)}
				/>
			)}
		</Field>
	);

	// the plan's amber lines; errors stand under their fields
	const lines: Line[] = plan.issues
		.filter((i) => i.severity === "warning")
		.map((i) => ({ level: "warning", code: i.code, text: i.message }));
	const steps = plan.steps;
	const needsUnstake =
		kind === "returnToSpot" &&
		(steps === null
			? plan.issues.some((i) => i.code === "validator.needed")
			: steps.length === 2);

	return (
		<div className="space-y-4">
			<Segmented<StakingKind>
				label="What to do"
				value={kind}
				onChange={(v) => set("kind", v)}
				options={STAKING_KINDS.map((k) => ({
					value: k,
					label: STAKING.kinds[k].label,
					title: STAKING.kinds[k].description,
				}))}
			/>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
				<span>
					In spot, not on hold:{" "}
					<span className="font-mono text-foreground">
						{hype(spotAvailable)}
					</span>
				</span>
				<span className="inline-flex items-center gap-1">
					In the staking balance, not staked:{" "}
					<span className="font-mono text-foreground">
						{unread ? "not read" : hype(staking.summary?.undelegated)}
					</span>
					<Help k="stakingBalance" />
				</span>
				{unread && (
					<button
						type="button"
						onClick={staking.refetch}
						className="inline-flex items-center gap-1 underline underline-offset-2"
					>
						<RefreshCw className="size-3" aria-hidden /> Read again
					</button>
				)}
			</div>

			{kind === "moveStake" &&
				fromStake("ms-stake-from", STAKING.validator.moveStake)}

			<Field
				label={STAKING.amount[kind]}
				htmlFor="ms-stake-amount"
				error={error("amount")}
				hint="In HYPE, with up to 8 decimals. It is never rounded for you."
			>
				<TextInput
					id="ms-stake-amount"
					inputMode="decimal"
					value={form.amount}
					onChange={(e) => set("amount", e.target.value)}
					placeholder="100"
					aria-invalid={!!error("amount")}
				/>
			</Field>

			{kind === "stake" && toValidator("validator", STAKING.validator.stake)}
			{needsUnstake &&
				fromStake("ms-stake-from", STAKING.validator.returnToSpot)}
			{kind === "moveStake" &&
				toValidator(
					"toValidator",
					STAKING.toValidator,
					form.validator.trim().toLowerCase() || undefined,
				)}

			{steps && (
				<div className="rounded-md border border-border px-3 py-2.5">
					<p className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
						{steps.length === 1 ? STAKING.oneStep : STAKING.twoSteps}
						{steps.length === 2 && <Help k="moveSteps" />}
					</p>
					<ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-sm">
						{steps.map((s) => (
							<li
								key={`${s.kind}:${s.amount}`}
								className="[overflow-wrap:anywhere]"
							>
								{stepSentence(s, validators)}
							</li>
						))}
					</ol>
					<ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
						{steps.some((s) => s.kind === "stake") && (
							<li>
								A stake cannot be unstaked for {lockupWords(network)} after it
								is made or added to.
							</li>
						)}
						{steps.some((s) => s.kind === "return") && (
							<li>
								The HYPE lands in spot {queueWords(network)} after the return is
								submitted, by itself, with no further signature.
							</li>
						)}
						{plan.opensAt !== null && (
							<li>
								The stake this takes from is locked. It can be proposed and
								signed now, and submitted from <When at={plan.opensAt} /> (
								{untilWords(plan.opensAt, now)}).
							</li>
						)}
					</ul>
				</div>
			)}
			<Lines lines={lines} />
		</div>
	);
}
