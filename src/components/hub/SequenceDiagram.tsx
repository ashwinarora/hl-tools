import { Fragment } from "react";
import { cn } from "#/lib/utils";

export interface SequenceStep {
	from: string;
	to: string;
	label: string;
	note?: string;
}

/**
 * Minimal sequence diagram: participant lifelines with arrows between them.
 * On narrow screens it degrades to a numbered list of the same steps.
 */
export function SequenceDiagram({
	participants,
	steps,
}: {
	participants: readonly string[];
	steps: readonly SequenceStep[];
}) {
	const col = (p: string) => Math.max(0, participants.indexOf(p));
	const n = participants.length;
	return (
		<div className="min-w-0">
			<ol className="space-y-2 sm:hidden">
				{steps.map((s, i) => (
					<li key={`${i}-${s.label}`} className="flex gap-2.5 text-sm">
						<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-2xs">
							{i + 1}
						</span>
						<span className="min-w-0">
							<span className="font-medium">
								{s.from === s.to ? s.from : `${s.from} → ${s.to}`}
							</span>
							<span className="block text-muted-foreground">{s.label}</span>
							{s.note && (
								<span className="block text-xs text-subtle-foreground">
									{s.note}
								</span>
							)}
						</span>
					</li>
				))}
			</ol>
			<div className="scrollbar-thin hidden overflow-x-auto sm:block">
				<div
					className="relative min-w-[560px]"
					style={{
						display: "grid",
						gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
					}}
				>
					{participants.map((p, i) => (
						<div
							key={p}
							className="z-10 flex justify-center pb-3"
							style={{ gridColumn: i + 1, gridRow: 1 }}
						>
							<span className="rounded-md border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-medium">
								{p}
							</span>
						</div>
					))}
					{/* lifelines */}
					{participants.map((p, i) => (
						<div
							key={`${p}-line`}
							className="pointer-events-none flex justify-center"
							style={{ gridColumn: i + 1, gridRow: `2 / span ${steps.length}` }}
							aria-hidden
						>
							<div className="h-full border-l border-dashed border-border-strong" />
						</div>
					))}
					{steps.map((s, i) => {
						const a = col(s.from);
						const b = col(s.to);
						const self = a === b;
						const left = Math.min(a, b);
						const right = Math.max(a, b);
						const rtl = b < a;
						return (
							<Fragment key={`${i}-${s.label}`}>
								<div
									className="relative px-2 py-2.5"
									style={{
										gridRow: i + 2,
										gridColumn: self
											? `${a + 1} / span 1`
											: `${left + 1} / ${right + 2}`,
									}}
								>
									{self ? (
										<div className="mx-auto w-fit max-w-full rounded-md border border-dashed border-border-strong bg-surface px-2 py-1 text-center">
											<div className="text-xs font-medium">{s.label}</div>
											{s.note && (
												<div className="text-2xs text-muted-foreground">
													{s.note}
												</div>
											)}
										</div>
									) : (
										<div
											className="relative"
											style={{
												marginLeft: `calc(${100 / (right - left + 1) / 2}%)`,
												marginRight: `calc(${100 / (right - left + 1) / 2}%)`,
											}}
										>
											<div className="mb-1 text-center text-xs font-medium leading-snug">
												<span className="font-mono text-2xs text-subtle-foreground">
													{i + 1}.{" "}
												</span>
												{s.label}
											</div>
											<div className="relative h-2">
												<div className="absolute inset-x-0 top-1/2 border-t border-foreground/50" />
												<div
													className={cn(
														"absolute top-1/2 size-0 -translate-y-1/2 border-y-[5px] border-y-transparent",
														rtl
															? "left-0 border-r-[7px] border-r-foreground/60"
															: "right-0 border-l-[7px] border-l-foreground/60",
													)}
												/>
											</div>
											{s.note && (
												<div className="mt-1 text-center text-2xs text-muted-foreground">
													{s.note}
												</div>
											)}
										</div>
									)}
								</div>
							</Fragment>
						);
					})}
				</div>
			</div>
		</div>
	);
}
