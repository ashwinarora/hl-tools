import { Check, CheckCircle2, Clock3 } from "lucide-react";
import {
	AnimatePresence,
	motion,
	useInView,
	useReducedMotion,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { SAMPLE } from "#/components/home/mocks/sample";
import { cn } from "#/lib/utils";
import { Avatar } from "./Avatar";

/**
 * A proposal as a treasury's list shows it, laid over the treasury's
 * window: what it pays, to whom, and who has signed. When it comes into view
 * Bob's signature arrives and it turns ready to send; with reduced motion it
 * shows that state and nothing moves. Decorative and inert where it is drawn.
 */
const EASE = [0.22, 1, 0.36, 1] as const;

export function PendingCard({ className }: { className?: string }) {
	const s = SAMPLE;
	const p = s.proposal;
	const ref = useRef<HTMLDivElement>(null);
	const seen = useInView(ref, { once: true, amount: 0.5 });
	const still = useReducedMotion();
	const [ready, setReady] = useState(false);

	useEffect(() => {
		if (still) {
			setReady(true);
			return;
		}
		if (!seen) return;
		const t = setTimeout(() => setReady(true), 1500);
		return () => clearTimeout(t);
	}, [seen, still]);

	const signed = (name: string) =>
		name === "Alice" || (name === "Bob" && ready);
	return (
		<div
			ref={ref}
			className={cn(
				"overflow-hidden rounded-2xl border border-border-strong bg-surface text-left shadow-[0_30px_60px_-28px_rgb(0_0_0/0.6)]",
				className,
			)}
		>
			<div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2">
				<span className="text-[11px] font-medium text-muted-foreground">
					Pending
				</span>
				<span className="relative grid text-[11px] font-medium">
					<AnimatePresence mode="popLayout" initial={false}>
						<motion.span
							key={ready ? "ready" : "collecting"}
							initial={{ opacity: 0, y: 6, scale: 0.96 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: -6, scale: 0.96 }}
							transition={{ duration: 0.35, ease: EASE }}
							className={cn(
								"inline-flex items-center gap-1 justify-self-end rounded-full border px-2 py-0.5",
								ready
									? "border-brand/45 bg-brand-soft text-foreground"
									: "border-info/40 bg-info-soft text-info",
							)}
						>
							{ready ? (
								<CheckCircle2 className="size-3 text-brand" aria-hidden />
							) : (
								<Clock3 className="size-3" aria-hidden />
							)}
							{ready ? "Ready to send" : "1 of 2 signed"}
						</motion.span>
					</AnimatePresence>
				</span>
			</div>

			<div className="px-4 pt-3 pb-3.5">
				<div className="truncate text-sm font-semibold tracking-tight">
					{p.title}
				</div>
				<div className="mt-1 flex items-baseline gap-1.5">
					<span className="text-[28px] leading-8 font-semibold tabular-nums tracking-[-0.03em]">
						{p.amount}
					</span>
					<span className="text-xs text-muted-foreground">{p.unit}</span>
				</div>
				<div className="mt-0.5 truncate text-[11px] text-muted-foreground">
					to <span className="text-foreground">{p.toName}</span>{" "}
					<span className="font-mono">{p.toShort}</span>
				</div>

				<div className="mt-3 flex items-center justify-between gap-3">
					<span className="flex items-center gap-2">
						{s.signers.map((x) => (
							<span key={x.name} className="relative">
								<Avatar name={x.name} ring />
								<AnimatePresence initial={false}>
									{signed(x.name) && (
										<motion.span
											key="tick"
											initial={{ scale: 0, opacity: 0 }}
											animate={{ scale: 1, opacity: 1 }}
											transition={{
												type: "spring",
												stiffness: 420,
												damping: 18,
											}}
											className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-success text-background ring-2 ring-surface"
											aria-hidden
										>
											<Check className="size-2.5" strokeWidth={3} />
										</motion.span>
									)}
								</AnimatePresence>
							</span>
						))}
					</span>
					<span className="flex items-center gap-1" aria-hidden>
						{[0, 1].map((i) => (
							<span
								key={i}
								className="relative h-1.5 w-6 overflow-hidden rounded-full bg-border-strong"
							>
								<motion.span
									className="absolute inset-0 origin-left rounded-full bg-brand"
									initial={false}
									animate={{ scaleX: i === 0 || ready ? 1 : 0 }}
									transition={{ duration: 0.5, ease: EASE }}
								/>
							</span>
						))}
					</span>
				</div>
			</div>
		</div>
	);
}
