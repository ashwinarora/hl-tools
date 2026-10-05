import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Droplets, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
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

const REPO = "https://github.com/ashwinarora/hl-tools";

export default function Header() {
	const [open, setOpen] = useState(false);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	// biome-ignore lint/correctness/useExhaustiveDependencies: close the mobile menu on navigation
	useEffect(() => setOpen(false), [pathname]);

	return (
		<header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
			<nav className="page-wrap flex h-14 items-center gap-3">
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
					<Link
						to="/faucet-miner"
						className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
						activeProps={{ className: "text-foreground" }}
					>
						<Droplets className="size-3.5" aria-hidden />
						Faucet miner
					</Link>
					<Link
						to="/changes"
						className="inline-flex h-8 items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
						activeProps={{ className: "text-foreground" }}
					>
						Changes
					</Link>
				</div>

				<div className="ml-auto flex items-center gap-1.5">
					<NetworkSwitch compact />
					<a
						href={REPO}
						target="_blank"
						rel="noopener noreferrer"
						className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground sm:inline-flex"
						aria-label="GitHub repository"
					>
						<GithubMark className="size-4" />
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
				<div className="page-wrap grid gap-1 py-3">
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
						to="/changes"
						className="rounded-md px-2 py-2 text-sm hover:bg-surface-2"
					>
						Protocol rule changes
					</Link>
					<a
						href={REPO}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-2"
					>
						<GithubMark className="size-4" /> GitHub
					</a>
				</div>
			</div>
		</header>
	);
}
