import {
	type AssetUniverse,
	COREWRITER_ACTIONS,
	type CoreWriterField,
	coreWriterActionByKey,
	Decimal,
	type Network,
} from "@hl-tools/core";
import { useId } from "react";
import { IndexSearch } from "#/components/hub/IndexSearch";
import { Field, Segmented, Select, TextInput } from "#/components/hub/layout";

export const BUILD_DEFAULTS: Record<string, string> = {
	asset: "1",
	isBuy: "true",
	limitPx: "2667.1",
	sz: "0.005",
	reduceOnly: "false",
	encodedTif: "Ioc",
	cloid: "0x000001a0e798df33f294ce1e316c6981",
	vault: "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303",
	isDeposit: "true",
	usd: "10",
	validator: "0x5ac99df645f3414876c816caa18b2d234024b487",
	wei: "100000000",
	isUndelegate: "false",
	destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a",
	token: "0",
	ntl: "10",
	toPerp: "false",
	encodedFinalizeEvmContractVariant: "Create",
	createNonce: "0",
	apiWallet: "0x9f5c1a0e1b40e1e7a8ab4f4c8b48d6c6b1ee3a0b",
	apiWalletName: "",
	oid: "0",
	maxFeeRate: "10",
	builder: "0x8c967e73e7b15087c42a10d344cff4c96d877f1d",
	subAccount: "0x0000000000000000000000000000000000000000",
	sourceDex: "0",
	destinationDex: "spot",
	encodedOperation: "0",
	user: "0x5e9ee1089755c3435139848e47e6635505d5a13a",
	abstraction: "unifiedAccount",
	question: "0",
	outcome: "0",
};

function hint(
	f: CoreWriterField,
	value: string,
	values: Record<string, string>,
	universe?: AssetUniverse<Network>,
): string {
	const u = f.unit;
	switch (u.kind) {
		case "asset": {
			const a = universe?.byActionId.get(Number(value));
			return a
				? `${a.coin} · ${a.displaySymbol} on ${universe?.network}`
				: universe
					? `No asset ${value} on ${universe.network}`
					: "Action asset ID";
		}
		case "token": {
			const t = universe?.tokensByIndex.get(Number(value));
			return t
				? `${t.name} · weiDecimals ${t.weiDecimals}`
				: universe
					? `No token ${value} on ${universe.network}`
					: "Token index";
		}
		case "fixed":
			return `Human value; encoded × 10^${u.decimals}`;
		case "tokenWei": {
			const decimals =
				u.fixedToken === "HYPE"
					? 8
					: u.tokenField
						? universe?.tokensByIndex.get(Number(values[u.tokenField]))
								?.weiDecimals
						: undefined;
			if (decimals !== undefined && /^\d+$/.test(value))
				return `Raw wei · = ${Decimal.fromScaled(BigInt(value), decimals).toString()}`;
			return "Raw amount in the token's weiDecimals";
		}
		case "dex":
			return 'Perp dex index, or "spot" (uint32 max)';
		case "cloid":
			return "0 for none, or 16-byte hex";
		case "decibps":
			return /^\d+$/.test(value)
				? `${Decimal.fromScaled(BigInt(value), 1).toString()} bps`
				: "Tenths of a basis point";
		default:
			return f.description;
	}
}

export function BuildForm({
	actionKey,
	onActionKey,
	values,
	onValues,
	universe,
}: {
	actionKey: string;
	onActionKey: (k: string) => void;
	values: Record<string, string>;
	onValues: (v: Record<string, string>) => void;
	universe?: AssetUniverse<Network>;
}) {
	const id = useId();
	const spec = coreWriterActionByKey(actionKey);
	return (
		<div className="space-y-4">
			<Field label="Action" htmlFor={`${id}-action`}>
				<Select
					id={`${id}-action`}
					value={actionKey}
					onChange={(e) => onActionKey(e.target.value)}
				>
					{COREWRITER_ACTIONS.map((a) => (
						<option key={a.key} value={a.key}>
							{a.id} · {a.name}
						</option>
					))}
				</Select>
			</Field>
			{spec?.fields.map((f) => {
				const v = values[f.name] ?? "";
				const set = (nv: string) => onValues({ ...values, [f.name]: nv });
				const fid = `${id}-${f.name}`;
				return (
					<Field
						key={f.name}
						htmlFor={fid}
						label={
							<span>
								<span className="font-mono">{f.name}</span>{" "}
								<span className="font-normal text-muted-foreground">
									{f.type}
								</span>
							</span>
						}
						hint={hint(f, v, values, universe)}
					>
						{f.unit.kind === "bool" ? (
							<Segmented
								label={f.name}
								value={v === "true" ? "true" : "false"}
								onChange={set}
								options={[
									{ value: "true", label: "true" },
									{ value: "false", label: "false" },
								]}
							/>
						) : f.unit.kind === "enum" ? (
							<Select id={fid} value={v} onChange={(e) => set(e.target.value)}>
								{Object.entries(f.unit.values).map(([num, label]) => (
									<option key={num} value={label}>
										{num} · {label}
									</option>
								))}
							</Select>
						) : (
							<TextInput
								id={fid}
								mono
								value={v}
								onChange={(e) => set(e.target.value)}
							/>
						)}
						{(f.unit.kind === "asset" || f.unit.kind === "token") &&
							universe && (
								<IndexSearch
									kind={f.unit.kind}
									universe={universe}
									onPick={(index) => set(String(index))}
								/>
							)}
					</Field>
				);
			})}
		</div>
	);
}
