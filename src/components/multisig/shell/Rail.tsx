import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";
import { WalletBox } from "./WalletBox";

const item =
	"flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted-foreground no-underline transition-colors hover:bg-surface-2 hover:text-foreground";
const current = "bg-surface-3 font-medium text-foreground";

export function RailHeading({ children }: { children: ReactNode }) {
	return (
		<h3 className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-subtle-foreground">
			{children}
		</h3>
	);
}

/** One destination in the rail: a name, an optional second line, an optional count. */
export function RailLink({
	children,
	sub,
	trailing,
	...link
}: {
	children: ReactNode;
	sub?: ReactNode;
	trailing?: ReactNode;
} & Pick<
	React.ComponentProps<typeof Link>,
	"to" | "params" | "search" | "activeOptions"
>) {
	return (
		<Link
			{...link}
			className={item}
			activeProps={{ className: cn(item, current), "aria-current": "page" }}
		>
			<span className="min-w-0 flex-1">
				<span className="block truncate">{children}</span>
				{sub && (
					<span className="block truncate font-mono text-[11px] text-subtle-foreground">
						{sub}
					</span>
				)}
			</span>
			{trailing}
		</Link>
	);
}

/**
 * The section's left panel: who you are, then where you can go. Without a
 * relay, or signed out, it is short: the identity box and the screen that
 * opens and starts proposals.
 */
export function Rail({
	children,
	foot,
}: {
	children?: ReactNode;
	foot?: ReactNode;
}) {
	return (
		<>
			<WalletBox />
			{children}
			<div className="flex flex-col gap-0.5 border-t border-border pt-3">
				{foot}
			</div>
		</>
	);
}
