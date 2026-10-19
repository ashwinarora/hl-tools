import { Link } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import { tool } from "#/lib/tools";
import { cn } from "#/lib/utils";
import { MultisigMark } from "./MultisigMark";
import { WalletBox } from "./WalletBox";

const item =
	"relative flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground no-underline transition-colors hover:bg-surface-2 hover:text-foreground";
// where the reader is: a filled row with a short mark in the section's colour on its edge
const current =
	"bg-surface-3 font-medium text-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand";

export function RailHeading({ children }: { children: ReactNode }) {
	return (
		<h3 className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-[0.08em] text-subtle-foreground">
			{children}
		</h3>
	);
}

/**
 * One destination in the rail: a name, an optional second line, an optional
 * count. The route is given loosely (a path and its params); the router still
 * resolves it, the compiler just does not check the pair here.
 */
export function RailLink({
	children,
	sub,
	trailing,
	to,
	params,
	search,
	exact = false,
}: {
	children: ReactNode;
	sub?: ReactNode;
	trailing?: ReactNode;
	to: string;
	params?: Record<string, string>;
	search?: Record<string, string>;
	/** Current only on exactly this path, not on the pages under it. */
	exact?: boolean;
}) {
	const target = { to, params, search } as unknown as Pick<
		ComponentProps<typeof Link>,
		"to"
	>;
	return (
		<Link
			{...target}
			activeOptions={{ exact }}
			className={item}
			activeProps={{ className: cn(item, current), "aria-current": "page" }}
		>
			{/* never cut: a long name or its second line wraps instead */}
			<span className="min-w-0 flex-1">
				<span className="block [overflow-wrap:anywhere]">{children}</span>
				{sub && (
					<span className="block font-mono text-2xs text-subtle-foreground">
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
			<SectionMark />
			<WalletBox />
			{children}
			<div className="flex flex-col gap-0.5 border-t border-border pt-2.5">
				{foot}
			</div>
		</>
	);
}

/** The section's mark and name: where the reader is, at the top of the rail. */
export function SectionMark({ className }: { className?: string }) {
	return (
		<Link
			to="/multisig"
			className={cn(
				"inline-flex items-center gap-2 self-start rounded-md px-1 py-0.5 text-foreground no-underline",
				className,
			)}
		>
			<MultisigMark className="size-6" />
			<span className="text-[15px] font-semibold tracking-tight">
				{tool("multisig-sign").short}
			</span>
		</Link>
	);
}
