import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowRight, Compass } from "lucide-react";
import { TOOLS } from "#/lib/tools";

/** Rendered inside the shell for any path that matches no route. */
export default function NotFound() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	return (
		<main className="page-wrap pb-16 pt-10 sm:pt-16">
			<div className="mx-auto max-w-xl space-y-6 text-center">
				<span className="mx-auto flex size-12 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground">
					<Compass className="size-5" aria-hidden />
				</span>
				<div className="space-y-2">
					<h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
						There is no page at this address
					</h1>
					<p className="text-sm text-muted-foreground">
						<code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.92em] text-foreground">
							{pathname}
						</code>{" "}
						matches none of the tools. Tool pages live under{" "}
						<code className="font-mono">/tools/…</code>.
					</p>
				</div>
				<ul className="grid gap-1.5 text-left sm:grid-cols-2">
					{TOOLS.map((t) => (
						<li key={t.id}>
							<Link
								to={t.path}
								className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2 text-sm transition-colors hover:border-border-strong hover:bg-surface-2"
							>
								<t.icon
									className={
										t.writes
											? "size-4 text-muted-foreground"
											: "size-4 text-brand"
									}
									aria-hidden
								/>
								<span className="min-w-0 flex-1 truncate">{t.title}</span>
								<ArrowRight
									className="size-3.5 text-subtle-foreground"
									aria-hidden
								/>
							</Link>
						</li>
					))}
				</ul>
				<Link
					to="/"
					className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
				>
					Back to the directory <ArrowRight className="size-3.5" aria-hidden />
				</Link>
			</div>
		</main>
	);
}
