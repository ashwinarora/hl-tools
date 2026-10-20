import { Decimal, type Network, type Validator } from "@hl-tools/core";
import { useMemo, useState } from "react";
import { TextInput } from "#/components/hub/layout";
import {
	ratePercent,
	STAKING,
	stakingPageOrder,
	validatorState,
	wholeHype,
} from "../model/staking";
import { type DataColumn, DataTable } from "../shell/DataTable";
import { Help } from "../shell/Help";
import { Tag } from "../shell/kit";
import { ValidatorName } from "../treasury/StakingTab";

interface Row {
	readonly v: Validator;
	readonly state: ReturnType<typeof validatorState>;
	/** Its part of all HYPE staked on the network, in percent. */
	readonly share: number;
}

const percent = (fraction: string | null): string =>
	fraction === null ? "—" : `${(Number(fraction) * 100).toFixed(2)}%`;

/**
 * Every validator of the network as Hyperliquid reports it, in the order of
 * Hyperliquid's own staking page (`stakingPageOrder`). One is chosen with its
 * radio button. Nothing is hidden and nothing is recommended: a validator
 * that pays nothing says so in its row.
 */
export function ValidatorPicker({
	network,
	validators,
	value,
	onChange,
	label,
	exclude,
}: {
	network: Network;
	validators: readonly Validator[];
	/** The chosen validator's address, as the form holds it. */
	value: string;
	onChange: (address: string) => void;
	/** What is being chosen, for screen readers: "Validator to stake with". */
	label: string;
	/** An address that cannot be chosen here (the validator a move takes from). */
	exclude?: string;
}) {
	const [query, setQuery] = useState("");
	const chosen = value.trim().toLowerCase();
	const rows = useMemo<Row[]>(() => {
		const total = validators.reduce(
			(sum, v) => sum.add(Decimal.parse(v.stake)),
			Decimal.ZERO,
		);
		const all = Number(total.toString());
		const q = query.trim().toLowerCase();
		return validators
			.filter((v) => v.address !== exclude)
			.filter(
				(v) =>
					!q ||
					v.address === chosen ||
					v.name.toLowerCase().includes(q) ||
					v.address.includes(q),
			)
			.map((v) => ({
				v,
				state: validatorState(v),
				share: all > 0 ? (Number(v.stake) / all) * 100 : 0,
			}))
			.sort((a, b) => stakingPageOrder(a.v, b.v));
	}, [validators, query, exclude, chosen]);

	const columns = useMemo<DataColumn<Row>[]>(
		() => [
			{
				id: "pick",
				header: "",
				cell: (r) => (
					<input
						type="radio"
						name={`validator-${label}`}
						className="size-3.5 accent-brand"
						checked={r.v.address === chosen}
						onChange={() => onChange(r.v.address)}
						aria-label={`Choose ${r.v.name || r.v.address}`}
					/>
				),
			},
			{
				id: "validator",
				header: "Validator",
				cell: (r) => <ValidatorName address={r.v.address} name={r.v.name} />,
			},
			{
				id: "state",
				header: "State",
				headerExtra: <Help k="validatorState" />,
				cell: (r) => (
					<Tag tone={r.state.idle ? "warn" : "ok"}>{r.state.text}</Tag>
				),
			},
			{
				id: "commission",
				header: "Commission",
				numeric: true,
				cell: (r) => percent(r.v.commission),
			},
			{
				id: "rate",
				header: "Expected rate",
				numeric: true,
				headerExtra: <Help k="expectedRate" />,
				cell: (r) => ratePercent(r.v) ?? "—",
			},
			{
				id: "stake",
				header: "Total stake",
				numeric: true,
				cell: (r) => `${wholeHype(r.v.stake)} HYPE · ${r.share.toFixed(2)}%`,
			},
		],
		[chosen, onChange, label],
	);

	return (
		<div className="space-y-2">
			{validators.length > 12 && (
				<TextInput
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Find a validator by name or address"
					aria-label="Find a validator"
				/>
			)}
			<div className="max-h-80 overflow-y-auto rounded-md border border-border">
				<DataTable
					label={`${label} on ${network}`}
					columns={columns}
					rows={rows}
					rowKey={(r) => r.v.address}
					empty="No validator matches."
				/>
			</div>
			<p className="text-xs text-muted-foreground">
				{STAKING.noRecommendation}
			</p>
		</div>
	);
}
