import {
	bytesToHex,
	type Inspection,
	networkConfig,
	stringifyJson,
} from "@hl-tools/core";
import { CheckCircle2, CircleSlash, XCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import { CopyButton } from "#/components/hub/CopyButton";
import { DiffView } from "#/components/hub/DiffView";
import { HexView, SpanTable } from "#/components/hub/HexView";
import { KeyValueGrid, Panel, Segmented } from "#/components/hub/layout";
import {
	Callout,
	IssueList,
	NetworkBadge,
	Pill,
} from "#/components/hub/status";
import { cn } from "#/lib/utils";
import { stringifyTyped } from "./model";

function Step({
	n,
	title,
	children,
	aside,
}: {
	n: number;
	title: ReactNode;
	children: ReactNode;
	aside?: ReactNode;
}) {
	return (
		<li className="relative min-w-0 pl-9">
			<span className="absolute left-0 top-0 flex size-6 items-center justify-center rounded-full border border-border-strong bg-surface font-mono text-2xs font-semibold text-muted-foreground">
				{n}
			</span>
			<div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h3 className="text-sm font-semibold">{title}</h3>
				{aside}
			</div>
			<div className="min-w-0 space-y-3">{children}</div>
		</li>
	);
}

function HashRow({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: string;
}) {
	return (
		<div className="min-w-0 rounded-md border border-border bg-surface-2/50 px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs text-muted-foreground">{label}</span>
				<CopyButton value={value} size="xs" />
			</div>
			<div className="break-all font-mono text-[12.5px] text-foreground">
				{value}
			</div>
			{hint && (
				<div className="mt-0.5 text-2xs text-subtle-foreground">{hint}</div>
			)}
		</div>
	);
}

export function Verdict({
	inspection,
	expected,
}: {
	inspection: Inspection;
	expected: string;
}) {
	const exp = expected.trim().toLowerCase();
	const rec = inspection.recovered;
	const match = rec && /^0x[0-9a-f]{40}$/.test(exp) ? rec === exp : null;
	const familyLabel =
		inspection.family === "l1"
			? "L1 action (phantom agent)"
			: inspection.family === "user-signed"
				? "User-signed action"
				: inspection.family === "multisig"
					? "Multi-sig envelope"
					: "Not an action";
	return (
		<div className="grid gap-3 sm:grid-cols-3">
			<div className="rounded-lg border border-border bg-surface p-3.5">
				<div className="text-xs text-muted-foreground">Signing family</div>
				<div className="mt-1 text-sm font-semibold">{familyLabel}</div>
				<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
					{inspection.actionType && <Pill>{inspection.actionType}</Pill>}
					<NetworkBadge network={inspection.network} />
				</div>
			</div>
			<div
				className={cn(
					"rounded-lg border p-3.5 sm:col-span-2",
					match === true && "border-success/40 bg-success-soft",
					match === false && "border-danger/40 bg-danger-soft",
					match === null && "border-border bg-surface",
				)}
			>
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					{match === true ? (
						<CheckCircle2 className="size-3.5 text-success" aria-hidden />
					) : match === false ? (
						<XCircle className="size-3.5 text-danger" aria-hidden />
					) : (
						<CircleSlash className="size-3.5" aria-hidden />
					)}
					Recovered signer
				</div>
				{rec ? (
					<div className="mt-1 flex min-w-0 items-center gap-2">
						<span className="min-w-0 break-all font-mono text-sm font-medium">
							{rec}
						</span>
						<CopyButton value={rec} size="xs" />
					</div>
				) : (
					<div className="mt-1 text-sm text-muted-foreground">
						{inspection.signature
							? "Could not recover — see issues."
							: "No signature given — the digest below is what a wallet would sign."}
					</div>
				)}
				{match === true && (
					<div className="mt-1 text-xs text-success">
						Matches the expected signer.
					</div>
				)}
				{match === false && (
					<div className="mt-1 text-xs text-danger">
						Differs from the expected signer {exp}. The server would recover
						this address too, which is why it reports an unknown user or asks
						you to deposit — the signed bytes differ from the bytes shown here.
					</div>
				)}
			</div>
		</div>
	);
}

export function InspectionView({
	inspection,
	pastedPretty,
}: {
	inspection: Inspection;
	pastedPretty: string;
}) {
	const [msgView, setMsgView] = useState<"bytes" | "decoded">("bytes");
	const [path, setPath] = useState<string | null>(null);
	const { l1, typedData, hashes } = inspection;
	let n = 0;
	return (
		<div className="space-y-5">
			{inspection.issues.length > 0 && (
				<Panel
					title="Diagnostics"
					description="Errors mean the server would hash different bytes than you signed (or reject the payload)."
				>
					<IssueList
						issues={inspection.issues}
						onSelectPath={(p) => setPath(p)}
					/>
				</Panel>
			)}
			{inspection.family === "multisig" && (
				<Callout tone="unknown" title="Multi-sig is out of scope">
					This inspector covers the single-signer L1 and user-signed schemes.
					Paste the inner action to inspect it on its own.
				</Callout>
			)}
			{(l1 || typedData) && (
				<Panel
					title="What gets signed"
					description="Each step reproduces the official Python SDK byte for byte."
				>
					<ol className="space-y-8">
						{l1 && (
							<>
								<Step
									n={++n}
									title="Action as hashed"
									aside={
										l1.canonicalKnown ? (
											l1.canonicalChanged ? (
												<Pill tone="danger">differs from canonical</Pill>
											) : (
												<Pill tone="success">canonical</Pill>
											)
										) : (
											<Pill tone="unknown">no canonical shape</Pill>
										)
									}
								>
									{l1.canonicalChanged ? (
										<>
											<p className="text-sm text-muted-foreground">
												The server re-serialises the action it parsed. Left:
												what you pasted (and what is hashed below). Right: what
												the server hashes.
											</p>
											<DiffView
												left={pastedPretty}
												right={stringifyJson(l1.canonical)}
												leftLabel="as pasted"
												rightLabel="canonical (server)"
											/>
										</>
									) : (
										<CodeBlock
											title="action (key order preserved)"
											content={pastedPretty}
											maxHeight="18rem"
										/>
									)}
								</Step>
								<Step
									n={++n}
									title="MsgPack serialisation"
									aside={
										<Segmented
											size="sm"
											label="MsgPack view"
											value={msgView}
											onChange={setMsgView}
											options={[
												{ value: "bytes", label: "Raw" },
												{ value: "decoded", label: "Decoded" },
											]}
										/>
									}
								>
									{msgView === "bytes" ? (
										<HexView
											bytes={l1.actionBytes}
											spans={l1.actionSpans}
											selectedPath={path}
											onHoverPath={() => undefined}
											label="MsgPack bytes"
										/>
									) : (
										<div className="scrollbar-thin max-h-80 overflow-auto rounded-md border border-border">
											<SpanTable
												bytes={l1.actionBytes}
												spans={l1.actionSpans}
												selectedPath={path}
												onSelect={setPath}
											/>
										</div>
									)}
									<div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-1.5">
										<code className="min-w-0 truncate font-mono text-xs text-muted-foreground">
											{bytesToHex(l1.actionBytes)}
										</code>
										<CopyButton value={bytesToHex(l1.actionBytes)} size="xs" />
									</div>
								</Step>
								<Step n={++n} title="Hash preimage">
									<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
										{l1.segments.map((s, i) => (
											<span
												key={s.label}
												className="inline-flex items-center gap-1.5"
											>
												<span
													className={cn(
														"size-2 rounded-sm",
														[
															"bg-syn-key",
															"bg-syn-number",
															"bg-syn-bool",
															"bg-syn-string",
															"bg-warning",
															"bg-info",
														][i % 6],
													)}
												/>
												<span className="font-mono text-foreground">
													{s.label}
												</span>
												<span className="text-muted-foreground">
													{s.end - s.start}B
												</span>
											</span>
										))}
									</div>
									<HexView
										bytes={l1.preimage}
										segments={l1.segments}
										label="preimage bytes"
									/>
									<p className="text-xs text-muted-foreground">
										{l1.segments.map((s) => s.description).join(" ")}
									</p>
								</Step>
								<Step n={++n} title="Action hash → phantom agent">
									<HashRow
										label="connectionId = keccak256(preimage)"
										value={l1.connectionId}
									/>
									<KeyValueGrid
										items={[
											{
												label: "Agent.source",
												value: `"${networkConfig(inspection.network).l1Source}"`,
												mono: true,
												hint: `"a" = mainnet, "b" = testnet`,
											},
											{
												label: "Agent.connectionId",
												value: "the hash above",
												hint: "bytes32",
											},
										]}
									/>
								</Step>
							</>
						)}
						{!l1 && typedData && inspection.userSigned && (
							<Step n={++n} title="Action fields → EIP-712 message">
								<p className="text-sm text-muted-foreground">
									User-signed actions sign the fields directly. Only fields in{" "}
									<code className="font-mono">
										{inspection.userSigned.spec.primaryType}
									</code>{" "}
									are signed; <code className="font-mono">type</code> and{" "}
									<code className="font-mono">signatureChainId</code> are not.
								</p>
								<div className="scrollbar-thin overflow-x-auto rounded-md border border-border">
									<table className="w-full min-w-[420px] border-collapse font-mono text-xs">
										<thead>
											<tr className="border-b border-border bg-surface-2 text-left text-2xs uppercase tracking-wide text-subtle-foreground">
												<th className="px-3 py-1.5 font-medium">field</th>
												<th className="px-3 py-1.5 font-medium">
													EIP-712 type
												</th>
												<th className="px-3 py-1.5 font-medium">value</th>
											</tr>
										</thead>
										<tbody>
											{inspection.userSigned.spec.fields.map((f) => (
												<tr
													key={f.name}
													className="border-b border-border/60 last:border-0"
												>
													<td className="px-3 py-1.5 text-syn-key">{f.name}</td>
													<td className="px-3 py-1.5 text-muted-foreground">
														{f.type}
													</td>
													<td className="break-all px-3 py-1.5">
														{String(typedData.message[f.name])}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</Step>
						)}
						{typedData && (
							<Step n={++n} title="EIP-712 typed data">
								<CodeBlock
									title={`domain ${typedData.domain.name} · chainId ${typedData.domain.chainId}`}
									content={stringifyTyped(typedData)}
									maxHeight="20rem"
								/>
							</Step>
						)}
						{hashes && (
							<Step n={++n} title="EIP-712 hashes">
								<div className="grid gap-2">
									<HashRow
										label="domainSeparator"
										value={hashes.domainSeparator}
										hint="hashStruct(EIP712Domain)"
									/>
									<HashRow
										label="structHash"
										value={hashes.structHash}
										hint={`hashStruct(${typedData?.primaryType})`}
									/>
									<HashRow
										label="digest (signed)"
										value={hashes.digest}
										hint="keccak256(0x1901 ‖ domainSeparator ‖ structHash)"
									/>
								</div>
							</Step>
						)}
						{inspection.signature && (
							<Step n={++n} title="Signature → signer">
								<KeyValueGrid
									items={[
										{ label: "r", value: inspection.signature.r, mono: true },
										{ label: "s", value: inspection.signature.s, mono: true },
										{
											label: "v",
											value: String(inspection.signature.v),
											mono: true,
											hint: `yParity ${inspection.signature.yParity}`,
										},
										{
											label: "recovered",
											value: inspection.recovered ?? "—",
											mono: true,
										},
									]}
								/>
							</Step>
						)}
					</ol>
				</Panel>
			)}
		</div>
	);
}
