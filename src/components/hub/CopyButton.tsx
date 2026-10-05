import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "#/lib/utils";

export function CopyButton({
	value,
	label = "Copy",
	className,
	size = "sm",
}: {
	value: string;
	label?: string;
	className?: string;
	size?: "sm" | "xs";
}) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1400);
		return () => clearTimeout(t);
	}, [copied]);
	return (
		<button
			type="button"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
				} catch {
					// Clipboard can be unavailable (permissions / insecure origin).
				}
			}}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-surface-2 hover:text-foreground",
				size === "sm" ? "h-7 px-2 text-xs" : "h-6 px-1.5 text-2xs",
				className,
			)}
			aria-label={copied ? "Copied" : label}
		>
			{copied ? (
				<Check className="size-3.5 text-success" aria-hidden />
			) : (
				<Copy className="size-3.5" aria-hidden />
			)}
			<span className={size === "xs" ? "sr-only" : ""}>
				{copied ? "Copied" : label}
			</span>
		</button>
	);
}
