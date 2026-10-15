import { ChevronDown } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { Btn } from "../shell/kit";

/**
 * On a phone, the reader's next step stays one tap away: a bar fixed to the
 * bottom of the screen that brings their part of the page into view, and
 * hides while that part is on screen. It never signs or sends by itself:
 * what is signed is read in that part first.
 */
export function ActionBar({
	label,
	target,
}: {
	/** What the connected wallet can do now (`nextStepLabel`); null hides the bar. */
	label: string | null;
	target: RefObject<HTMLElement | null>;
}) {
	const [inView, setInView] = useState(true);
	useEffect(() => {
		const el = target.current;
		if (!el || !label || typeof IntersectionObserver === "undefined") return;
		const watch = new IntersectionObserver(([e]) =>
			setInView(!!e?.isIntersecting),
		);
		watch.observe(el);
		return () => watch.disconnect();
	}, [label, target]);
	if (!label) return null;
	const go = () => {
		const el = target.current;
		if (!el) return;
		el.scrollIntoView({ behavior: "smooth", block: "start" });
		el.focus({ preventScroll: true });
	};
	return (
		<>
			{/* room at the end of the page, so the bar never covers its last lines */}
			<div aria-hidden className="h-16 min-[861px]:hidden" />
			<div
				hidden={inView}
				className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur min-[861px]:hidden"
			>
				<Btn
					variant="brand"
					className="w-full"
					onClick={go}
					aria-label={`${label}: go to your part of the page`}
				>
					{label}
					<ChevronDown className="size-4" aria-hidden />
				</Btn>
			</div>
		</>
	);
}
