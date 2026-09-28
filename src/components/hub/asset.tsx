import {
	type Asset,
	MATCH_REASON_LABEL,
	type ResolvedMatch,
	type TokenRef,
} from "@hl-tools/core";
import { cn } from "#/lib/utils";

type Kind = Asset["venue"]["kind"] | "token";

const KIND: Record<Kind, { label: string; cls: string }> = {
	perp: { label: "PERP", cls: "border-info/40 text-info" },
	hip3: { label: "HIP-3", cls: "border-brand/45 text-brand" },
	spot: { label: "SPOT", cls: "border-success/40 text-success" },
	outcome: { label: "HIP-4", cls: "border-unknown/45 text-unknown" },
	token: { label: "TOKEN", cls: "border-border-strong text-muted-foreground" },
};

export function KindBadge({
	kind,
	className,
}: {
	kind: Kind;
	className?: string;
}) {
	const k = KIND[kind];
	return (
		<span
			className={cn(
				"inline-flex h-5 w-14 shrink-0 items-center justify-center rounded border font-mono text-2xs font-semibold tracking-wide",
				k.cls,
				className,
			)}
		>
			{k.label}
		</span>
	);
}

export function matchKey(m: ResolvedMatch): string {
	return m.kind === "asset" ? `a:${m.asset.coin}` : `t:${m.token.index}`;
}

export function matchKind(m: ResolvedMatch): Kind {
	return m.kind === "asset" ? m.asset.venue.kind : "token";
}

export function matchTitle(m: ResolvedMatch): string {
	return m.kind === "asset"
		? m.asset.displaySymbol
		: (m.token.fullName ?? m.token.name);
}

export function MatchRow({
	match,
	selected,
	onSelect,
	mid,
}: {
	match: ResolvedMatch;
	selected: boolean;
	onSelect: () => void;
	mid?: string | null;
}) {
	const a = match.kind === "asset" ? match.asset : null;
	const t: TokenRef | null = match.kind === "token" ? match.token : null;
	return (
		<button
			type="button"
			onClick={onSelect}
			aria-pressed={selected}
			className={cn(
				"grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
				selected && "bg-brand-soft hover:bg-brand-soft",
			)}
		>
			<KindBadge kind={matchKind(match)} />
			<div className="min-w-0">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="truncate font-mono text-[13px] font-medium">
						{a ? a.coin : t?.name}
					</span>
					<span className="truncate text-xs text-muted-foreground">
						{matchTitle(match)}
					</span>
				</div>
				<div className="truncate text-2xs text-subtle-foreground">
					matched as {MATCH_REASON_LABEL[match.reason]}
					{a?.isDelisted ? " · delisted" : ""}
				</div>
			</div>
			<div className="text-right font-mono text-xs">
				{a ? (
					<>
						<div className="text-foreground">a={a.actionAssetId}</div>
						<div className="text-2xs text-subtle-foreground">
							{mid ? `mid ${mid}` : " "}
						</div>
					</>
				) : (
					<>
						<div className="text-foreground">token {t?.index}</div>
						<div className="text-2xs text-subtle-foreground">
							wei {t?.weiDecimals}
						</div>
					</>
				)}
			</div>
		</button>
	);
}
