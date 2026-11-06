import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { SOCIAL } from "#/lib/social";
import { TOOLS } from "#/lib/tools";
import { cn } from "#/lib/utils";
import NetworkSwitch from "./NetworkSwitch";
import ThemeToggle from "./ThemeToggle";

export function GithubMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 16 16"
			fill="currentColor"
			className={className}
			aria-hidden="true"
		>
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
		</svg>
	);
}

export function DiscordMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			className={className}
			aria-hidden="true"
		>
			<path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.1.246.198.373.292a.077.077 0 0 1-.007.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.175 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
		</svg>
	);
}

export function XMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			className={className}
			aria-hidden="true"
		>
			<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
		</svg>
	);
}

export function Logo() {
	return (
		<Link
			to="/"
			className="flex items-center gap-2 text-foreground no-underline"
			aria-label="hl-tools home"
		>
			<svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
				<rect
					x="1"
					y="1"
					width="22"
					height="22"
					rx="5"
					className="fill-surface-2 stroke-border-strong"
					strokeWidth="1"
				/>
				<path
					d="M7 7v10M7 12h5M12 7v10M16 7v10h3"
					className="stroke-brand"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					fill="none"
				/>
			</svg>
			<span className="font-mono text-[15px] font-semibold tracking-tight">
				hl-tools
			</span>
		</Link>
	);
}

/**
 * The site's header and footer, and the Multisig section, run up to 1440 px
 * wide. The header and the footer use it on every page, so the logo and the
 * navigation stay put between pages; a page's own content keeps its width
 * (the tools: `page-wrap`).
 */
export const MULTISIG_WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6";

export default function Header() {
	const [open, setOpen] = useState(false);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const wrap = MULTISIG_WRAP;
	// biome-ignore lint/correctness/useExhaustiveDependencies: close the mobile menu on navigation
	useEffect(() => setOpen(false), [pathname]);

	return (
		<header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
			<nav className={cn(wrap, "flex h-14 items-center gap-3")}>
				<Logo />
				<div className="ml-4 hidden items-center gap-1 md:flex">
					<DropdownMenu>
						<DropdownMenuTrigger className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground data-[state=open]:bg-surface-2 data-[state=open]:text-foreground">
							Tools
							<ChevronDown className="size-3.5" aria-hidden />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-80 p-1.5">
							<DropdownMenuLabel className="text-xs text-muted-foreground">
								Read-only diagnostics
							</DropdownMenuLabel>
							{TOOLS.filter((t) => !t.writes).map((t) => (
								<DropdownMenuItem key={t.id} asChild>
									<Link to={t.path} className="flex items-start gap-2.5 py-2">
										<t.icon className="mt-0.5 size-4 text-brand" aria-hidden />
										<span className="min-w-0">
											<span className="block text-sm font-medium">
												{t.title}
											</span>
											<span className="line-clamp-1 block text-xs text-muted-foreground">
												{t.answers}
											</span>
										</span>
									</Link>
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							{TOOLS.filter((t) => t.writes).map((t) => (
								<DropdownMenuItem key={t.id} asChild>
									<Link to={t.path} className="flex items-center gap-2.5 py-2">
										<t.icon
											className="size-4 text-muted-foreground"
											aria-hidden
										/>
										<span className="text-sm">{t.title}</span>
									</Link>
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
					{/* The sections that sign get direct links, outside the read-only list. */}
					{TOOLS.filter((t) => t.writes).map((t) => (
						<Link
							key={t.id}
							to={t.path}
							className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
							activeProps={{ className: "bg-surface-2 text-foreground" }}
						>
							<t.icon className="size-3.5" aria-hidden />
							{t.short}
						</Link>
					))}
					<Link
						to="/docs/$"
						params={{ _splat: "" }}
						className="inline-flex h-8 items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
						activeProps={{ className: "text-foreground" }}
					>
						Docs
					</Link>
				</div>

				<div className="ml-auto flex items-center gap-1.5">
					<NetworkSwitch compact />
					<a
						href={SOCIAL.github}
						target="_blank"
						rel="noopener noreferrer"
						className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground sm:inline-flex"
						aria-label="GitHub repository"
					>
						<GithubMark className="size-4" />
					</a>
					<a
						href={SOCIAL.discord}
						target="_blank"
						rel="noopener noreferrer"
						className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground sm:inline-flex"
						aria-label="Discord"
					>
						<DiscordMark className="size-4" />
					</a>
					<a
						href={SOCIAL.x}
						target="_blank"
						rel="noopener noreferrer"
						className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground sm:inline-flex"
						aria-label="hl-tools on X"
					>
						<XMark className="size-3.5" />
					</a>
					<ThemeToggle />
					<button
						type="button"
						className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground md:hidden"
						aria-expanded={open}
						aria-controls="mobile-nav"
						aria-label={open ? "Close menu" : "Open menu"}
						onClick={() => setOpen((o) => !o)}
					>
						{open ? <X className="size-4" /> : <Menu className="size-4" />}
					</button>
				</div>
			</nav>
			<div
				id="mobile-nav"
				hidden={!open}
				className={cn("border-t border-border bg-background md:hidden")}
			>
				<div className={cn(wrap, "grid gap-1 py-3")}>
					{TOOLS.map((t) => (
						<Link
							key={t.id}
							to={t.path}
							className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-surface-2"
						>
							<t.icon
								className={cn(
									"size-4",
									t.writes ? "text-muted-foreground" : "text-brand",
								)}
								aria-hidden
							/>
							{t.title}
						</Link>
					))}
					<div className="my-1 h-px bg-border" />
					<Link
						to="/docs/$"
						params={{ _splat: "" }}
						className="rounded-md px-2 py-2 text-sm hover:bg-surface-2"
					>
						Docs
					</Link>
					<a
						href={SOCIAL.github}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-2"
					>
						<GithubMark className="size-4" /> GitHub
					</a>
					<a
						href={SOCIAL.discord}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-2"
					>
						<DiscordMark className="size-4" /> Discord
					</a>
					<a
						href={SOCIAL.x}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-2"
					>
						<XMark className="size-4" /> X
					</a>
				</div>
			</div>
		</header>
	);
}
