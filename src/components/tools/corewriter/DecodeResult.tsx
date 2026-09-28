import {
	bytesToHex,
	type CoreWriterDecode,
	coreWriterSnippets,
	type Network,
	networkConfig,
} from "@hl-tools/core";
import { Clock } from "lucide-react";
import { useMemo, useState } from "react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import { type HexSegment, HexView } from "#/components/hub/HexView";
import { Field, Panel, Segmented, TextInput } from "#/components/hub/layout";
import {
	Callout,
	IssueList,
	NetworkBadge,
	Pill,
} from "#/components/hub/status";

function segmentsFor(
	decode: Extract<CoreWriterDecode, { kind: "decoded" }>,
): HexSegment[] {
	const segs: HexSegment[] = [
		{ label: "version", start: 0, end: 1, description: "Encoding version" },
		{ label: "action id", start: 1, end: 4, description: "u24 big-endian" },
	];
	const allStatic = decode.spec.fields.every(
		(f) => f.type !== "string" && !f.type.endsWith("[]"),
	);
	if (allStatic) {
		decode.spec.fields.forEach((f, i) => {
			segs.push({ label: f.name, start: 4 + i * 32, end: 4 + (i + 1) * 32 });
		});
		const end = 4 + decode.spec.fields.length * 32;
		if (decode.bytes.length > end)
			segs.push({ label: "trailing", start: end, end: decode.bytes.length });
	} else {
		segs.push({ label: "abi body", start: 4, end: decode.bytes.length });
	}
	return segs;
}

function decodedJson(
	decode: Extract<CoreWriterDecode, { kind: "decoded" }>,
): string {
	const obj: Record<string, unknown> = {
		version: decode.version,
		actionId: decode.actionId,
		action: decode.spec.name,
	};
	for (const f of decode.fields) {
		obj[f.field.name] =
			f.human && f.human !== f.rawDisplay
				? { raw: f.rawDisplay, human: f.human }
				: f.rawDisplay;
	}
	return JSON.stringify(obj, null, 2);
}

export function DecodeResult({
	decode,
	network,
}: {
	decode: CoreWriterDecode;
	network: Network;
}) {
	const [sender, setSender] = useState("");
	const [snippet, setSnippet] = useState<
		"cast-send" | "cast-call" | "solidity" | "calldata"
	>("cast-send");
	const snippets = useMemo(() => {
		if (decode.kind !== "decoded") return null;
		const values = Object.fromEntries(
			decode.fields.map((f) => [f.field.name, f.raw]),
		);
		const from = /^0x[0-9a-fA-F]{40}$/.test(sender.trim())
			? sender.trim()
			: undefined;
		return coreWriterSnippets(
			decode.spec,
			values,
			bytesToHex(decode.bytes) as `0x${string}`,
			networkConfig(network).evmRpcUrl,
			from,
		);
	}, [decode, network, sender]);

	if (decode.kind === "unknown-version") {
		return (
			<div className="space-y-4">
				<Callout
					tone="unknown"
					title={`Unknown encoding version ${decode.version}`}
				>
					Only version 1 is defined. The body is deliberately not decoded — a
					future version may lay out its fields differently, so any decode would
					be a guess.
					{decode.actionId !== null && (
						<>
							{" "}
							Bytes 1–3 read as action ID <code>{decode.actionId}</code> under
							version 1's layout.
						</>
					)}
				</Callout>
				<HexView
					bytes={decode.bytes}
					segments={[
						{ label: "version", start: 0, end: 1 },
						{ label: "undecoded", start: 1, end: decode.bytes.length },
					]}
				/>
			</div>
		);
	}
	if (decode.kind === "unknown-action") {
		return (
			<div className="space-y-4">
				<Callout
					tone="unknown"
					title={`Action ID ${decode.actionId} is not defined for version ${decode.version}`}
				>
					HyperCore would drop this action. Defined IDs are 1–13 and 15–17.
				</Callout>
				<HexView
					bytes={decode.bytes}
					segments={[
						{ label: "version", start: 0, end: 1 },
						{ label: "action id", start: 1, end: 4 },
						{ label: "body", start: 4, end: decode.bytes.length },
					]}
				/>
			</div>
		);
	}
	if (decode.kind === "malformed") {
		return (
			<div className="space-y-4">
				<IssueList issues={decode.issues} />
				{decode.bytes && decode.bytes.length > 0 && (
					<HexView bytes={decode.bytes} />
				)}
			</div>
		);
	}

	return (
		<div className="space-y-5">
			<Panel
				title={
					<span className="flex flex-wrap items-center gap-2">
						{decode.spec.name}
						<Pill>id {decode.actionId}</Pill>
						<Pill>v{decode.version}</Pill>
						<NetworkBadge network={network} />
					</span>
				}
				description={`HyperCore equivalent: ${decode.spec.coreActionType}. ${decode.spec.notes ?? ""}`}
				actions={
					decode.spec.delayed ? (
						<span className="inline-flex items-center gap-1 text-xs text-warning">
							<Clock className="size-3.5" aria-hidden /> Delayed a few seconds
							on HyperCore
						</span>
					) : null
				}
				bodyClassName="p-0"
			>
				<div className="scrollbar-thin overflow-x-auto">
					<table className="w-full min-w-[560px] border-collapse text-sm">
						<thead>
							<tr className="border-b border-border bg-surface-2 text-left text-2xs uppercase tracking-wide text-subtle-foreground">
								<th className="px-4 py-2 font-medium">field</th>
								<th className="px-3 py-2 font-medium">type</th>
								<th className="px-3 py-2 font-medium">raw</th>
								<th className="px-3 py-2 font-medium">human</th>
							</tr>
						</thead>
						<tbody>
							{decode.fields.map((f) => (
								<tr
									key={f.field.name}
									className="border-b border-border/60 align-top last:border-0"
								>
									<td className="px-4 py-2.5">
										<div className="font-mono text-[13px] text-syn-key">
											{f.field.name}
										</div>
										<div className="text-2xs text-muted-foreground">
											{f.field.description}
										</div>
									</td>
									<td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
										{f.field.type}
									</td>
									<td className="break-all px-3 py-2.5 font-mono text-xs">
										{f.rawDisplay}
									</td>
									<td className="px-3 py-2.5">
										{f.human !== null ? (
											<div className="break-all font-mono text-xs text-foreground">
												{f.human}
											</div>
										) : (
											<span className="text-xs text-subtle-foreground">—</span>
										)}
										{f.note && (
											<div className="text-2xs text-muted-foreground">
												{f.note}
											</div>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Panel>
			{decode.issues.length > 0 && <IssueList issues={decode.issues} />}
			<CodeBlock
				title={`${decode.bytes.length} bytes`}
				views={[
					{
						id: "raw",
						label: "Raw",
						content: bytesToHex(decode.bytes),
						render: (
							<div className="p-3">
								<HexView bytes={decode.bytes} segments={segmentsFor(decode)} />
							</div>
						),
					},
					{
						id: "decoded",
						label: "Decoded",
						content: decodedJson(decode),
						lang: "json",
					},
				]}
			/>
			{snippets && (
				<Panel
					title="Send it yourself"
					description="Generated commands never include a private key."
				>
					<div className="space-y-4">
						<Field
							label="Calling contract / sender (optional)"
							htmlFor="cw-sender"
							hint="Used as --from for cast call. The sender must already exist on HyperCore."
						>
							<TextInput
								id="cw-sender"
								mono
								value={sender}
								onChange={(e) => setSender(e.target.value)}
								placeholder="0x…"
							/>
						</Field>
						<Segmented
							label="Snippet"
							value={snippet}
							onChange={setSnippet}
							options={[
								{ value: "cast-send", label: "cast send" },
								{ value: "cast-call", label: "cast call" },
								{ value: "solidity", label: "Solidity" },
								{ value: "calldata", label: "Calldata" },
							]}
						/>
						{snippet === "cast-send" && (
							<CodeBlock lang="bash" content={snippets.castSend} />
						)}
						{snippet === "cast-call" && (
							<CodeBlock lang="bash" content={snippets.castCall} />
						)}
						{snippet === "solidity" && (
							<CodeBlock
								lang="solidity"
								content={snippets.solidity}
								maxHeight="32rem"
							/>
						)}
						{snippet === "calldata" && (
							<CodeBlock lang="text" content={snippets.calldata} defaultWrap />
						)}
					</div>
				</Panel>
			)}
		</div>
	);
}
