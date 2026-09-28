import { WrapText } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "#/lib/utils";
import { CopyButton } from "./CopyButton";
import { highlight, type Lang } from "./highlight";

export interface CodeView {
	id: string;
	label: string;
	content: string;
	lang?: Lang;
	/** Custom renderer instead of highlighted text (e.g. a decoded table). */
	render?: ReactNode;
}

/**
 * Code/payload panel: syntax highlighting, wrap toggle, copy, and optional
 * view tabs (e.g. raw / decoded). Wide content scrolls inside the panel.
 */
export function CodeBlock({
	title,
	views,
	content,
	lang = "json",
	actions,
	defaultWrap = false,
	maxHeight = "28rem",
	className,
	footer,
}: {
	title?: ReactNode;
	views?: CodeView[];
	content?: string;
	lang?: Lang;
	actions?: ReactNode;
	defaultWrap?: boolean;
	maxHeight?: string;
	className?: string;
	footer?: ReactNode;
}) {
	const allViews: CodeView[] = views ?? [
		{ id: "code", label: "", content: content ?? "", lang },
	];
	const [active, setActive] = useState(allViews[0]?.id ?? "code");
	const [wrap, setWrap] = useState(defaultWrap);
	const view = allViews.find((v) => v.id === active) ?? allViews[0];
	const tabsId = useId();
	return (
		<div
			className={cn(
				"min-w-0 overflow-hidden rounded-lg border border-border bg-surface",
				className,
			)}
		>
			<div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-2/60 px-3 py-1">
				{title && (
					<div className="min-w-0 text-xs font-medium text-muted-foreground">
						{title}
					</div>
				)}
				{allViews.length > 1 && (
					<div
						role="tablist"
						aria-label="View"
						className="flex items-center rounded-md border border-border bg-surface p-0.5"
					>
						{allViews.map((v) => (
							<button
								key={v.id}
								id={`${tabsId}-${v.id}`}
								type="button"
								role="tab"
								aria-selected={v.id === view?.id}
								onClick={() => setActive(v.id)}
								className={cn(
									"h-6 rounded px-2 text-xs font-medium transition-colors",
									v.id === view?.id
										? "bg-surface-3 text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{v.label}
							</button>
						))}
					</div>
				)}
				<div className="ml-auto flex items-center gap-1">
					{actions}
					{!view?.render && (
						<button
							type="button"
							onClick={() => setWrap((w) => !w)}
							aria-pressed={wrap}
							className={cn(
								"inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs transition-colors hover:border-border hover:bg-surface-2",
								wrap ? "text-foreground" : "text-muted-foreground",
							)}
							title="Toggle line wrapping"
						>
							<WrapText className="size-3.5" aria-hidden />
							<span className="hidden sm:inline">Wrap</span>
						</button>
					)}
					{view && <CopyButton value={view.content} />}
				</div>
			</div>
			{view?.render ? (
				<div
					className="scrollbar-thin overflow-auto"
					style={{ maxHeight }}
					role="tabpanel"
				>
					{view.render}
				</div>
			) : (
				<pre
					className={cn(
						"scrollbar-thin overflow-auto p-3 font-mono text-[12.5px] leading-relaxed",
						wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
					)}
					style={{ maxHeight }}
					role="tabpanel"
				>
					<code>{highlight(view?.content ?? "", view?.lang ?? "json")}</code>
				</pre>
			)}
			{footer && (
				<div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
					{footer}
				</div>
			)}
		</div>
	);
}
