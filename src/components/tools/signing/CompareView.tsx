import {
	diffJson,
	firstByteDivergence,
	type Inspection,
	type JsonChange,
	type JsonNode,
	stringifyJson,
} from "@hl-tools/core";
import { DiffView } from "#/components/hub/DiffView";
import { HexView } from "#/components/hub/HexView";
import { Panel } from "#/components/hub/layout";
import { Callout, Pill } from "#/components/hub/status";
import { stringifyTyped } from "./model";

function repr(n: JsonNode): string {
	switch (n.kind) {
		case "string":
			return JSON.stringify(n.value);
		case "number":
			return n.raw;
		case "bool":
			return String(n.value);
		case "null":
			return "null";
		default:
			return n.kind === "object" ? "{…}" : "[…]";
	}
}

function ChangeRow({ c }: { c: JsonChange }) {
	return (
		<li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border/60 px-3 py-2 text-xs last:border-0">
			<Pill
				tone={
					c.kind === "added"
						? "success"
						: c.kind === "removed"
							? "danger"
							: c.kind === "reordered"
								? "warning"
								: "info"
				}
			>
				{c.kind}
			</Pill>
			<span className="font-mono text-foreground">{c.path}</span>
			{c.kind === "changed" && (
				<span className="font-mono">
					<span className="text-danger">{repr(c.a)}</span> →{" "}
					<span className="text-success">{repr(c.b)}</span>
				</span>
			)}
			{c.kind === "added" && (
				<span className="font-mono text-success">{repr(c.b)}</span>
			)}
			{c.kind === "removed" && (
				<span className="font-mono text-danger">{repr(c.a)}</span>
			)}
			{c.kind === "reordered" && (
				<span className="font-mono text-muted-foreground">
					{c.a.join(", ")} → {c.b.join(", ")}
				</span>
			)}
			{c.kind === "changed" && c.note && (
				<span className="w-full text-muted-foreground">{c.note}</span>
			)}
		</li>
	);
}

export function CompareView({
	a,
	b,
	actionA,
	actionB,
}: {
	a: Inspection;
	b: Inspection;
	actionA: JsonNode;
	actionB: JsonNode;
}) {
	const changes = diffJson(actionA, actionB);
	const bytesA = a.l1?.actionBytes;
	const bytesB = b.l1?.actionBytes;
	const div =
		bytesA && bytesB
			? firstByteDivergence(
					bytesA,
					bytesB,
					a.l1?.actionSpans,
					b.l1?.actionSpans,
				)
			: null;
	const digestSame =
		a.hashes && b.hashes ? a.hashes.digest === b.hashes.digest : null;
	const idSame = a.l1 && b.l1 ? a.l1.connectionId === b.l1.connectionId : null;
	const familyMismatch = a.family !== b.family;
	return (
		<div className="space-y-5">
			{familyMismatch ? (
				<Callout tone="warning" title="Different signing families">
					A is {a.family}, B is {b.family}; their bytes are not comparable.
					Field-level differences are still listed.
				</Callout>
			) : digestSame === true ? (
				<Callout tone="success" title="Identical signing digests">
					Both payloads produce the same{" "}
					{a.family === "l1" ? "action hash and " : ""}EIP-712 digest, so the
					same signature recovers the same signer.
				</Callout>
			) : (
				<Callout tone="danger" title="The payloads sign different bytes">
					{div ? (
						<>
							First divergent MsgPack byte at offset <code>{div.offset}</code>:
							A has{" "}
							<code>
								{div.a === null
									? "end of data"
									: `0x${div.a.toString(16).padStart(2, "0")}`}
							</code>{" "}
							in <code>{div.pathA ?? "—"}</code>, B has{" "}
							<code>
								{div.b === null
									? "end of data"
									: `0x${div.b.toString(16).padStart(2, "0")}`}
							</code>{" "}
							in <code>{div.pathB ?? "—"}</code>.
						</>
					) : idSame === true ? (
						"The action bytes and hash match; the digest differs because of the network (phantom agent source)."
					) : a.family === "l1" && bytesA && bytesB ? (
						"Action bytes are identical; the preimage differs in nonce, vault address or expiresAfter."
					) : (
						"The typed-data messages differ (see below)."
					)}
				</Callout>
			)}

			<Panel
				title="Field-level differences"
				description="Sensitive to key order, number lexemes (1 vs 1.0) and letter case — all of which change the hash."
				bodyClassName="p-0"
			>
				{changes.length ? (
					<ul>
						{changes.map((c, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: changes are positional
							<ChangeRow key={i} c={c} />
						))}
					</ul>
				) : (
					<p className="px-4 py-3 text-sm text-muted-foreground">
						The two actions are structurally identical.
					</p>
				)}
			</Panel>

			<DiffView
				left={stringifyJson(actionA)}
				right={stringifyJson(actionB)}
				leftLabel="A · action"
				rightLabel="B · action"
			/>

			{bytesA && bytesB && (
				<div className="grid min-w-0 gap-4 md:grid-cols-2">
					<Panel title="A · MsgPack">
						<HexView
							bytes={bytesA}
							spans={a.l1?.actionSpans}
							highlight={
								div ? { start: div.offset, end: div.offset + 1 } : null
							}
						/>
					</Panel>
					<Panel title="B · MsgPack">
						<HexView
							bytes={bytesB}
							spans={b.l1?.actionSpans}
							highlight={
								div ? { start: div.offset, end: div.offset + 1 } : null
							}
						/>
					</Panel>
				</div>
			)}
			{!a.l1 && !b.l1 && a.typedData && b.typedData && (
				<DiffView
					left={stringifyTyped(a.typedData)}
					right={stringifyTyped(b.typedData)}
					leftLabel="A · typed data"
					rightLabel="B · typed data"
				/>
			)}
			{a.hashes && b.hashes && (
				<Panel title="Digests">
					<dl className="grid gap-2 font-mono text-xs">
						<div className="break-all">
							<dt className="inline text-muted-foreground">A </dt>
							<dd className="inline">{a.hashes.digest}</dd>
						</div>
						<div className="break-all">
							<dt className="inline text-muted-foreground">B </dt>
							<dd className="inline">{b.hashes.digest}</dd>
						</div>
					</dl>
				</Panel>
			)}
		</div>
	);
}
