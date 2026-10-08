import { MULTISIG_FACTS, type Network } from "@hl-tools/core";
import type { ReactNode } from "react";
import {
	Field,
	Segmented,
	Select,
	TextArea,
	TextInput,
} from "#/components/hub/layout";
import { Callout } from "#/components/hub/status";
import type { ActionForm } from "../model/actions";

export interface TokenOption {
	readonly index: number;
	readonly name: string;
	readonly tokenId: string;
}

/** What the treasury holds first, then every other token by name. Names repeat; the id tells them apart. */
function tokenGroups(
	tokens: readonly TokenOption[],
	held: readonly number[],
): { label: string; tokens: TokenOption[] }[] {
	const mine = tokens.filter((t) => held.includes(t.index));
	const rest = tokens
		.filter((t) => !held.includes(t.index))
		.sort((a, b) => a.name.localeCompare(b.name));
	return [
		{ label: "Held by this account", tokens: mine },
		{ label: "All spot tokens", tokens: rest },
	].filter((g) => g.tokens.length > 0);
}

/** The inputs of the chosen action. Errors come from the model, keyed by field. */
export function ActionFields({
	form,
	set,
	error,
	network,
	tokens,
	held,
	tokensLoading,
}: {
	form: ActionForm;
	set: <K extends keyof ActionForm>(key: K, value: ActionForm[K]) => void;
	error: (field: keyof ActionForm) => string | undefined;
	network: Network;
	tokens: readonly TokenOption[] | null;
	/** Token indexes the treasury holds, listed first: a network can have thousands. */
	held: readonly number[];
	tokensLoading: boolean;
}) {
	const destination = (hint: ReactNode) => (
		<Field
			label="Destination"
			htmlFor="ms-destination"
			error={error("destination")}
			hint={hint}
		>
			<TextInput
				id="ms-destination"
				mono
				value={form.destination}
				onChange={(e) => set("destination", e.target.value)}
				onBlur={(e) => set("destination", e.target.value.trim().toLowerCase())}
				placeholder="0x…"
				aria-invalid={!!error("destination")}
			/>
		</Field>
	);
	const amount = (unit: string, hint: ReactNode) => (
		<Field
			label={`Amount (${unit})`}
			htmlFor="ms-amount"
			error={error("amount")}
			hint={hint}
		>
			<TextInput
				id="ms-amount"
				mono
				inputMode="decimal"
				value={form.amount}
				onChange={(e) => set("amount", e.target.value)}
				placeholder="0.0"
				aria-invalid={!!error("amount")}
			/>
		</Field>
	);

	switch (form.kind) {
		case "usdSend":
			return (
				<>
					{destination(
						"Another Hyperliquid account. Not an exchange deposit address.",
					)}
					{amount(
						"USDC",
						"Leaves the perps balance. Written exactly as typed, never rounded.",
					)}
				</>
			);
		case "withdraw3":
			return (
				<>
					{destination(
						`The address that receives USDC on Arbitrum${network === "testnet" ? " Sepolia" : ""}.`,
					)}
					{amount(
						"USDC",
						"Leaves the perps balance through the bridge; the bridge takes a 1 USDC fee.",
					)}
				</>
			);
		case "spotSend":
			return (
				<>
					{destination("Another Hyperliquid account.")}
					<Field
						label="Token"
						htmlFor="ms-token"
						error={error("token")}
						hint={
							tokensLoading
								? `Loading the spot tokens of ${network}…`
								: "The action carries the token as NAME:tokenId."
						}
					>
						<Select
							id="ms-token"
							value={form.token}
							onChange={(e) => set("token", e.target.value)}
							aria-invalid={!!error("token")}
						>
							<option value="">Choose a token…</option>
							{tokenGroups(tokens ?? [], held).map((g) => (
								<optgroup key={g.label} label={g.label}>
									{g.tokens.map((t) => (
										<option key={t.tokenId} value={`${t.name}:${t.tokenId}`}>
											{t.name} · {t.tokenId.slice(0, 10)}…
										</option>
									))}
								</optgroup>
							))}
						</Select>
					</Field>
					{amount(
						form.token.split(":")[0] || "token",
						"Leaves the spot balance.",
					)}
				</>
			);
		case "usdClassTransfer":
			return (
				<>
					<Field label="Direction">
						<Segmented
							label="Direction"
							value={form.toPerp}
							onChange={(v) => set("toPerp", v)}
							options={[
								{ value: "perp", label: "Spot → perps" },
								{ value: "spot", label: "Perps → spot" },
							]}
						/>
					</Field>
					{amount("USDC", "Stays inside this account.")}
				</>
			);
		case "approveAgent":
			return (
				<>
					<Callout tone="warning" title="Trading becomes single-key">
						{MULTISIG_FACTS.find((f) => f.id === "agent-bypass")?.text} Whoever
						holds this key can place and cancel orders with the treasury's funds
						on their own. It cannot withdraw or send.
					</Callout>
					<Field
						label="API wallet address"
						htmlFor="ms-agent"
						error={error("agentAddress")}
						hint="The address of a key generated elsewhere. This page never creates or holds keys."
					>
						<TextInput
							id="ms-agent"
							mono
							value={form.agentAddress}
							onChange={(e) => set("agentAddress", e.target.value)}
							onBlur={(e) =>
								set("agentAddress", e.target.value.trim().toLowerCase())
							}
							placeholder="0x…"
							aria-invalid={!!error("agentAddress")}
						/>
					</Field>
					<Field
						label="Name (optional)"
						htmlFor="ms-agent-name"
						error={error("agentName")}
						hint="A named API wallet sits beside others; the unnamed one replaces the previous unnamed one."
					>
						<TextInput
							id="ms-agent-name"
							value={form.agentName}
							onChange={(e) => set("agentName", e.target.value)}
							placeholder="trading-bot"
						/>
					</Field>
				</>
			);
		case "raw":
			return (
				<Field
					label="Action JSON"
					htmlFor="ms-raw"
					error={error("raw")}
					hint="A user-signed action such as sendAsset or approveBuilderFee. The signing chain, the network and the nonce are filled in by this page."
				>
					<TextArea
						id="ms-raw"
						value={form.raw}
						onChange={(e) => set("raw", e.target.value)}
						rows={7}
						placeholder='{"type":"approveBuilderFee","maxFeeRate":"0.001%","builder":"0x…"}'
						aria-invalid={!!error("raw")}
						data-private
					/>
				</Field>
			);
	}
}
