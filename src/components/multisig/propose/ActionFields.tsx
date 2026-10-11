import { type AccountMode, MULTISIG_FACTS, type Network } from "@hl-tools/core";
import type { ReactNode } from "react";
import {
	Field,
	Segmented,
	Select,
	TextArea,
	TextInput,
} from "#/components/hub/layout";
import { Callout } from "#/components/hub/status";
import { cn } from "#/lib/utils";
import type { ActionForm, PocketChoice, Receiver } from "../model/actions";
import { RELAY_COPY } from "../model/relay/copy";
import type { CostLine } from "../model/send";
import { shortAddress } from "../model/stage";
import { useNames, Who } from "../names/Names";
import { Help } from "../shell/Help";

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

const ADDRESS = /^0x[0-9a-f]{40}$/;

/**
 * Under the destination field: the treasury's nicknamed addresses to pick
 * from, and, once an address is typed or picked, who it is here. A nickname
 * is a label a signer typed: the whole address is shown with it, and that
 * address is what gets signed.
 */
function DestinationNames({
	value,
	onPick,
}: {
	value: string;
	onPick: (address: string) => void;
}) {
	const names = useNames();
	if (!names) return null;
	const typed = value.trim().toLowerCase();
	const known = ADDRESS.test(typed) ? names.of(typed) : null;
	const choices = [...names.all]
		// the treasury does not pay itself
		.filter(([address]) => address !== names.treasury && address !== typed)
		.sort((a, b) => a[1].name.localeCompare(b[1].name));
	return (
		<div className="mt-2 flex flex-col gap-2">
			{known && (
				<p className="rounded-md border border-border bg-surface-2 px-2.5 py-2 text-xs">
					<Who address={typed} full />
				</p>
			)}
			{choices.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="text-xs text-subtle-foreground">
						{RELAY_COPY.nicknamePick}
					</span>
					{choices.map(([address, n]) => (
						<button
							key={address}
							type="button"
							onClick={() => onPick(address)}
							title={address}
							className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs transition-colors hover:bg-surface-2"
						>
							<span className="font-medium">{n.name}</span>
							<span className="font-mono text-subtle-foreground">
								{shortAddress(address)}
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

const COST_TONE: Record<CostLine["tone"], string> = {
	plain: "border-border bg-surface-2 text-muted-foreground",
	fee: "border-info/30 bg-info-soft text-foreground",
	warn: "border-warning/35 bg-warning-soft text-foreground",
	muted: "border-border bg-surface-2 text-subtle-foreground",
};

/** Under a destination: what sending to it costs (see the model's `costLine`). */
export function CostNote({ line }: { line: CostLine | null }) {
	if (!line) return null;
	return (
		<p
			aria-live="polite"
			data-cost={line.tone}
			className={cn(
				"mt-2 rounded-md border px-2.5 py-2 text-xs leading-relaxed",
				COST_TONE[line.tone],
			)}
		>
			{line.text}
			{(line.tone === "fee" || line.tone === "warn") && (
				<>
					{" "}
					<Help k="activationFee" />
				</>
			)}
		</p>
	);
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
	mode,
	receiver,
	cost,
	from,
	movable,
}: {
	form: ActionForm;
	set: <K extends keyof ActionForm>(key: K, value: ActionForm[K]) => void;
	error: (field: keyof ActionForm) => string | undefined;
	network: Network;
	tokens: readonly TokenOption[] | null;
	/** Token indexes the treasury holds, listed first: a network can have thousands. */
	held: readonly number[];
	tokensLoading: boolean;
	/** The treasury's account mode; null while it is not read. */
	mode: AccountMode | null;
	/** What is known about the destination; null while it is not. */
	receiver: Receiver | null;
	/** What sending to the destination costs. */
	cost: CostLine | null;
	/** The balance a USDC send is taken from, as the model resolved it. */
	from: PocketChoice;
	/** What can be moved now from each balance; null while not read. */
	movable: { readonly perps: string | null; readonly spotUsdc: string | null };
}) {
	const unified = mode?.kind === "unified";
	const destination = (hint: ReactNode) => (
		<Field
			label="Destination"
			trailing={<Help k="nickname" />}
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
			<DestinationNames
				value={form.destination}
				onPick={(a) => set("destination", a)}
			/>
			<CostNote line={cost} />
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
		case "sendUsdc":
			return (
				<>
					{destination(
						"Another Hyperliquid account. Not an exchange deposit address.",
					)}
					{amount(
						"USDC",
						unified
							? `Leaves this treasury's balance${movable.spotUsdc !== null ? ` (${movable.spotUsdc} USDC can be moved now)` : ""}. Written exactly as typed, never rounded.`
							: "Written exactly as typed, never rounded.",
					)}
					{!unified && (
						<Field
							label="Taken from"
							trailing={<Help k="pockets" />}
							hint="The balance of this treasury the payment leaves."
						>
							<Segmented<PocketChoice>
								label="Taken from"
								value={from}
								onChange={(v) => set("fromPocket", v)}
								options={[
									{
										value: "perps",
										label: `Perps${movable.perps !== null ? ` · ${movable.perps} USDC` : ""}`,
									},
									{
										value: "spot",
										label: `Spot${movable.spotUsdc !== null ? ` · ${movable.spotUsdc} USDC` : ""}`,
									},
								]}
							/>
						</Field>
					)}
					{receiver?.mode?.kind !== "unified" && (
						<Field
							label="Arrives in"
							hint="The balance of the receiver the payment lands in."
						>
							<Segmented<PocketChoice>
								label="Arrives in"
								value={form.toPocket}
								onChange={(v) => set("toPocket", v)}
								options={[
									{ value: "perps", label: "Their perps balance" },
									{ value: "spot", label: "Their spot balance" },
								]}
							/>
						</Field>
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
		case "sendToken":
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
						unified
							? "Leaves this treasury's balance and arrives in the receiver's spot balance."
							: "Leaves the spot balance and arrives in the receiver's spot balance.",
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
					{/* a send written by hand pays somebody too: the same line as under a destination */}
					<CostNote line={cost} />
				</Field>
			);
	}
}
