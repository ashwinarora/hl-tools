import { RULE_REGISTRY } from "@hl-tools/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronRight, History } from "lucide-react";
import { TOOLS } from "#/lib/tools";

export const Route = createFileRoute("/changes")({
	component: Changes,
	head: () => ({ meta: [{ title: "Protocol rule changes — hl-tools" }] }),
});

function Changes() {
	const timeline = RULE_REGISTRY.flatMap((r) =>
		r.changelog.map((c) => ({ ...c, rule: r })),
	).sort(
		(a, b) =>
			b.date.localeCompare(a.date) || a.rule.title.localeCompare(b.rule.title),
	);
	return (
		<main className="page-wrap pb-16 pt-6 sm:pt-8">
			<nav
				aria-label="Breadcrumb"
				className="mb-4 flex items-center gap-1 text-xs text-muted-foreground"
			>
				<Link to="/" className="hover:text-foreground">
					Tools
				</Link>
				<ChevronRight className="size-3" aria-hidden />
				<span className="text-foreground">Changes</span>
			</nav>
			<header className="mb-8 max-w-3xl space-y-2 border-b border-border pb-6">
				<div className="flex items-center gap-2.5">
					<span className="flex size-8 items-center justify-center rounded-md border border-border bg-surface text-brand">
						<History className="size-4" aria-hidden />
					</span>
					<h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
						Protocol rule versions
					</h1>
				</div>
				<p className="text-sm leading-relaxed text-muted-foreground">
					Every rule the tools apply lives in{" "}
					<code className="rounded bg-surface-2 px-1 font-mono text-[0.92em]">
						@hl-tools/core
					</code>{" "}
					as a versioned rule set with the date it was last checked against its
					primary sources. This page is generated from that metadata.
				</p>
			</header>

			<div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
				<div className="min-w-0 space-y-4">
					{RULE_REGISTRY.map((r) => {
						const usedBy = TOOLS.filter((t) => t.ruleSets.includes(r.id));
						return (
							<section
								key={r.id}
								id={r.id}
								className="scroll-mt-20 rounded-lg border border-border bg-surface"
							>
								<div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
									<div className="min-w-0">
										<h2 className="text-sm font-semibold">{r.title}</h2>
										<div className="mt-0.5 font-mono text-xs text-muted-foreground">
											{r.id}@{r.version}
										</div>
									</div>
									<div className="text-right text-xs text-muted-foreground">
										verified{" "}
										<span className="font-mono text-foreground">
											{r.verifiedAt}
										</span>
									</div>
								</div>
								<div className="space-y-4 px-4 py-4 text-sm">
									<p className="leading-relaxed text-muted-foreground">
										{r.summary}
									</p>
									<div className="grid gap-4 sm:grid-cols-2">
										<div>
											<h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle-foreground">
												Sources
											</h3>
											<ul className="space-y-1">
												{r.sources.map((s) => (
													<li key={s.url}>
														<a
															href={s.url}
															target="_blank"
															rel="noreferrer"
															className="inline-flex items-start gap-1 text-foreground hover:underline"
														>
															{s.label}
															<ArrowUpRight
																className="mt-0.5 size-3 shrink-0 text-muted-foreground"
																aria-hidden
															/>
														</a>
													</li>
												))}
											</ul>
										</div>
										<div>
											<h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle-foreground">
												Used by
											</h3>
											{usedBy.length ? (
												<ul className="space-y-1">
													{usedBy.map((t) => (
														<li key={t.id}>
															<Link to={t.path} className="hover:underline">
																{t.title}
															</Link>
														</li>
													))}
												</ul>
											) : (
												<p className="text-muted-foreground">
													Shared by the core only.
												</p>
											)}
										</div>
									</div>
									<div>
										<h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle-foreground">
											Changelog
										</h3>
										<ol className="space-y-1.5">
											{r.changelog.map((c) => (
												<li key={c.version} className="flex gap-3">
													<span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
														{c.version}
													</span>
													<span className="w-22 shrink-0 font-mono text-xs text-muted-foreground">
														{c.date}
													</span>
													<span className="min-w-0">{c.note}</span>
												</li>
											))}
										</ol>
									</div>
								</div>
							</section>
						);
					})}
				</div>
				<aside className="lg:sticky lg:top-20 lg:self-start">
					<h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						Timeline
					</h2>
					<ol className="relative space-y-4 border-l border-border pl-4">
						{timeline.map((e) => (
							<li key={`${e.rule.id}-${e.version}`} className="relative">
								<span
									className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-brand"
									aria-hidden
								/>
								<div className="font-mono text-2xs text-muted-foreground">
									{e.date}
								</div>
								<a
									href={`#${e.rule.id}`}
									className="text-sm font-medium hover:underline"
								>
									{e.rule.title}{" "}
									<span className="font-mono text-xs text-muted-foreground">
										{e.version}
									</span>
								</a>
								<p className="text-xs leading-relaxed text-muted-foreground">
									{e.note}
								</p>
							</li>
						))}
					</ol>
				</aside>
			</div>
		</main>
	);
}
