import {
	type ExplainedEntry,
	explainResponse,
	type Outcome,
	toPlain,
	tryParseJson,
} from "@hl-tools/core";
import { ArrowUpRight, MessageSquareWarning } from "lucide-react";
import { useMemo } from "react";
import {
	EmptyState,
	Field,
	Panel,
	TextArea,
	Workspace,
} from "#/components/hub/layout";
import { Callout, Pill, type Tone } from "#/components/hub/status";
import { cn } from "#/lib/utils";

export const EXPLAIN_SAMPLES: {
	id: string;
	label: string;
	response: string;
	request?: string;
}[] = [
	{
		id: "resting",
		label: "Resting order",
		response:
			'{"status":"ok","response":{"type":"order","data":{"statuses":[{"resting":{"oid":77738308}}]}}}',
	},
	{
		id: "partial",
		label: "IOC partial fill",
		response:
			'{"status":"ok","response":{"type":"order","data":{"statuses":[{"filled":{"totalSz":"0.4","avgPx":"100.5","oid":1}}]}}}',
		request:
			'{"type":"order","orders":[{"a":0,"b":true,"p":"101","s":"1","r":false,"t":{"limit":{"tif":"Ioc"}}}],"grouping":"na"}',
	},
	{
		id: "bracket",
		label: "Bracket accepted",
		response:
			'{"status":"ok","response":{"type":"order","data":{"statuses":[{"resting":{"oid":5}},"waitingForFill","waitingForFill"]}}}',
	},
	{
		id: "tick",
		label: "Tick size",
		response:
			'{"status":"ok","response":{"type":"order","data":{"statuses":[{"error":"Price must be divisible by tick size. asset=0"}]}}}',
	},
	{
		id: "signer",
		label: "Unknown signer",
		response:
			'{"status":"err","response":"L1 error: User or API Wallet 0x0123456789abcdef0123456789abcdef01234567 does not exist."}',
	},
	{
		id: "422",
		label: "HTTP 422",
		response:
			"422 Failed to deserialize the JSON body into the target type: orders[0].p: invalid type: floating point `100.5`, expected a string",
	},
	{
		id: "status",
		label: "orderStatus: reduce-only canceled",
		response:
			'{"status":"order","order":{"order":{"coin":"ETH","side":"A","limitPx":"2500.0","sz":"0.1","oid":42,"timestamp":1790000000000,"origSz":"0.1","tif":"Gtc"},"status":"reduceOnlyCanceled","statusTimestamp":1790000001000}}',
	},
];

const OUTCOME: Record<Outcome, { tone: Tone; label: string }> = {
	accepted: { tone: "success", label: "accepted" },
	resting: { tone: "info", label: "resting" },
	filled: { tone: "success", label: "filled" },
	"partially-filled": { tone: "warning", label: "partially filled" },
	waiting: { tone: "info", label: "waiting" },
	cancelled: { tone: "neutral", label: "cancelled" },
	rejected: { tone: "danger", label: "rejected" },
	error: { tone: "danger", label: "error" },
	unknown: { tone: "unknown", label: "unknown" },
};

function EntryCard({ e }: { e: ExplainedEntry }) {
	const o = OUTCOME[e.outcome];
	return (
		<article
			className={cn(
				"min-w-0 rounded-lg border bg-surface",
				e.outcome === "rejected" || e.outcome === "error"
					? "border-danger/35"
					: e.outcome === "unknown"
						? "border-dashed border-unknown/45"
						: "border-border",
			)}
		>
			<div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
				<div className="min-w-0">
					{e.index !== null && (
						<div className="font-mono text-2xs text-muted-foreground">
							statuses[{e.index}]
						</div>
					)}
					<h3 className="break-words text-sm font-semibold">{e.title}</h3>
				</div>
				<Pill tone={o.tone}>{o.label}</Pill>
			</div>
			<div className="space-y-3 px-4 py-3">
				<div className="scrollbar-thin overflow-x-auto">
					<table className="w-full min-w-[380px] border-collapse text-xs">
						<tbody>
							{e.fields.map((f) => (
								<tr
									key={f.path}
									className="border-b border-border/60 align-top last:border-0"
								>
									<td className="w-1/3 py-1.5 pr-3 font-mono text-syn-key">
										{f.path}
									</td>
									<td className="w-1/4 break-all py-1.5 pr-3 font-mono">
										{f.value}
									</td>
									<td className="py-1.5 text-muted-foreground">{f.meaning}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{e.order && (
					<div className="rounded-md bg-surface-2 px-3 py-2 font-mono text-2xs text-muted-foreground">
						request order: {JSON.stringify(e.order)}
					</div>
				)}
				{e.cause && (
					<div className="text-sm">
						<span className="font-medium">Cause: </span>
						<span className="text-muted-foreground">{e.cause}</span>
					</div>
				)}
				{e.fix && (
					<div className="text-sm">
						<span className="font-medium">Fix: </span>
						<span className="text-muted-foreground">{e.fix}</span>
					</div>
				)}
				{e.catalog && (
					<div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
						<Pill tone={e.catalog.documented ? "success" : "unknown"}>
							{e.catalog.documented ? "documented" : "undocumented"}
						</Pill>
						<span>category {e.catalog.category}</span>
						<a
							href="https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/error-responses"
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-0.5 hover:text-foreground"
						>
							Error responses <ArrowUpRight className="size-3" />
						</a>
					</div>
				)}
			</div>
		</article>
	);
}

export function ExplainTab({
	response,
	request,
	onResponse,
	onRequest,
}: {
	response: string;
	request: string;
	onResponse: (v: string) => void;
	onRequest: (v: string) => void;
}) {
	const reqParsed = useMemo(() => {
		if (!request.trim())
			return { value: undefined as unknown, error: null as string | null };
		const r = tryParseJson(request);
		return r.ok
			? { value: toPlain(r.node) as unknown, error: null }
			: { value: undefined, error: r.error.message };
	}, [request]);
	const explanation = useMemo(
		() => (response.trim() ? explainResponse(response, reqParsed.value) : null),
		[response, reqParsed.value],
	);
	return (
		<Workspace
			input={
				<Panel
					title="Response or error"
					description="Paste the JSON body, an orderStatus result, orderUpdates items, a bare error string or an HTTP error line."
				>
					<div className="space-y-4">
						<Field label="Response" htmlFor="x-resp">
							<TextArea
								id="x-resp"
								rows={9}
								value={response}
								onChange={(e) => onResponse(e.target.value)}
								placeholder='{"status":"ok","response":{"type":"order","data":{"statuses":[…]}}}'
								data-private
							/>
						</Field>
						<Field
							label="Request action (optional)"
							htmlFor="x-req"
							error={reqParsed.error ?? undefined}
							hint="Pairs each status with its order and detects partial fills."
						>
							<TextArea
								id="x-req"
								rows={5}
								className="min-h-24"
								value={request}
								onChange={(e) => onRequest(e.target.value)}
								placeholder='{"type":"order","orders":[…]}'
								data-private
							/>
						</Field>
						<div className="space-y-1.5">
							<div className="text-xs font-medium">Samples</div>
							<div className="flex flex-wrap gap-1.5">
								{EXPLAIN_SAMPLES.map((s) => (
									<button
										key={s.id}
										type="button"
										onClick={() => {
											onResponse(s.response);
											onRequest(s.request ?? "");
										}}
										className="rounded border border-border bg-surface px-2 py-1 text-xs hover:border-border-strong hover:bg-surface-2"
									>
										{s.label}
									</button>
								))}
							</div>
						</div>
					</div>
				</Panel>
			}
			output={
				!explanation ? (
					<EmptyState
						icon={MessageSquareWarning}
						title="Explain an exchange response"
						description="Distinguishes accepted, resting, filled, partially filled, cancelled and rejected; maps error strings and HTTP failures to causes and fixes."
						sample="Price must be divisible by tick size.  →  tickRejected · round to 5 sig figs"
						action={
							<button
								type="button"
								onClick={() => onResponse(EXPLAIN_SAMPLES[3]?.response ?? "")}
								className="text-xs text-foreground underline"
							>
								Try with a sample
							</button>
						}
					/>
				) : (
					<div className="space-y-4">
						<Callout
							tone={
								explanation.kind === "malformed-json"
									? "danger"
									: explanation.kind === "unrecognised"
										? "unknown"
										: explanation.entries.some(
													(e) =>
														e.outcome === "rejected" || e.outcome === "error",
												)
											? "danger"
											: explanation.entries.some(
														(e) => e.outcome === "partially-filled",
													)
												? "warning"
												: "success"
							}
							title={explanation.summary}
						>
							{explanation.notes.length > 0 && (
								<ul className="mt-1 list-disc space-y-0.5 pl-4">
									{explanation.notes.map((n) => (
										<li key={n}>{n}</li>
									))}
								</ul>
							)}
						</Callout>
						{explanation.entries.map((e, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: entries are positional
							<EntryCard key={i} e={e} />
						))}
						{explanation.unknownFields.length > 0 && (
							<Callout tone="unknown" title="Fields hl-core doesn't recognise">
								{explanation.unknownFields.join(", ")}
							</Callout>
						)}
					</div>
				)
			}
		/>
	);
}
