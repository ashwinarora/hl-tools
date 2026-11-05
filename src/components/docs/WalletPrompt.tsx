/**
 * A drawing of a wallet's signature request, with the fields to check
 * numbered. Drawn rather than photographed: every wallet lays it out
 * differently, but the fields are Hyperliquid's and the same everywhere.
 */
import {
	checksOf,
	isPromptKind,
	onTestnet,
	PROMPTS,
	type Prompt,
	type PromptKind,
} from "#/lib/docs/prompts";

function Dot({ n }: { n: number }) {
	return (
		<span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-fd-primary font-semibold text-[11px] text-fd-primary-foreground tabular-nums leading-none">
			{n}
		</span>
	);
}

function Row({
	field,
	value,
	n,
}: {
	field: string;
	value: string;
	n: number | null;
}) {
	return (
		<div
			className={`relative grid gap-px rounded-md px-3 py-1 leading-tight ${n ? "bg-fd-primary/8 ring-1 ring-fd-primary/60" : ""}`}
		>
			{n ? (
				<span className="-left-2.5 absolute top-1.5">
					<Dot n={n} />
				</span>
			) : null}
			<span className="text-[11px] text-fd-muted-foreground">{field}</span>
			<span className="break-all font-mono text-[11.5px] text-fd-foreground leading-tight">
				{value || <span className="text-fd-muted-foreground">(empty)</span>}
			</span>
		</div>
	);
}

export function WalletPrompt({
	kind,
	testnet = false,
}: {
	kind: PromptKind | string;
	/** Drawn as a testnet signer sees it. */
	testnet?: boolean;
}) {
	if (!isPromptKind(kind)) return null;
	const prompt: Prompt = testnet ? onTestnet(PROMPTS[kind]) : PROMPTS[kind];
	const checks = checksOf(prompt);
	let n = 0;

	return (
		<figure className="not-prose my-6 leading-normal">
			<div className="grid gap-4 rounded-xl border border-fd-border bg-fd-muted/40 p-4 sm:grid-cols-[minmax(0,25.5rem)_1fr] sm:items-start sm:p-6">
				<div
					role="img"
					aria-label={prompt.alt}
					className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-lg"
				>
					<div aria-hidden>
						<div className="flex items-center gap-3 border-fd-border border-b px-4 py-3">
							<span className="grid size-8 place-items-center rounded-full bg-fd-secondary text-fd-muted-foreground">
								<svg
									aria-hidden="true"
									viewBox="0 0 16 16"
									className="size-4 fill-none stroke-current"
									strokeWidth="1.5"
								>
									<rect x="2" y="4" width="12" height="9" rx="2" />
									<path d="M10.5 8.5h1.5M4 4l7-2.2V4" />
								</svg>
							</span>
							<span className="grid">
								<span className="font-medium text-fd-foreground text-sm">
									Signature request
								</span>
								<span className="text-[11px] text-fd-muted-foreground">
									hltools.tech
								</span>
							</span>
						</div>
						<div className="grid gap-1 px-3 py-2.5">
							{prompt.network ? (
								<Row
									field="Network"
									value={prompt.network.value}
									n={prompt.network.check ? ++n : null}
								/>
							) : null}
							<Row field="Message" value={prompt.message} n={null} />
							<div className="my-1 border-fd-border border-t" />
							{prompt.rows.map((row) => (
								<Row
									key={row.field}
									field={row.field}
									value={row.value}
									n={row.check ? ++n : null}
								/>
							))}
						</div>
						<div className="grid grid-cols-2 gap-2 border-fd-border border-t px-4 py-3">
							<span className="rounded-lg border border-fd-border py-1.5 text-center text-fd-muted-foreground text-sm">
								Reject
							</span>
							<span className="rounded-lg bg-fd-primary py-1.5 text-center font-medium text-fd-primary-foreground text-sm">
								Sign
							</span>
						</div>
					</div>
				</div>
				<div className="grid gap-3">
					<p className="font-medium text-fd-foreground text-sm">
						Check in your wallet
					</p>
					<ol className="grid gap-2 text-fd-muted-foreground text-sm">
						{checks.map((c, i) => (
							<li key={c} className="flex items-start gap-2">
								<Dot n={i + 1} />
								<span>{c}</span>
							</li>
						))}
					</ol>
					<p className="text-[12px] text-fd-muted-foreground leading-snug">
						A drawing, not a real wallet: yours lays it out its own way, with
						the same fields.
					</p>
				</div>
			</div>
		</figure>
	);
}
