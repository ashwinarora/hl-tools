import { useEffect, useRef, useState } from "react";

/** Below the site's header (56 px) with a little air. */
const TOP = 80;
/** The room kept under a column that is taller than the screen. */
const BOTTOM = 16;

/**
 * How far from the top a column sticks (the rail, a screen's side column).
 * One that fits the screen sticks under the header. A taller one scrolls
 * with the page until its end is in view and sticks there, so its last
 * items (Create, Send, the last treasury) are never out of reach and never
 * hidden in a scrolling box of their own. The column itself decides where
 * it is sticky (`sticky` from some width up); `top` alone does nothing.
 */
export function useStickyTop<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [top, setTop] = useState(TOP);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () =>
			setTop(Math.min(TOP, window.innerHeight - el.offsetHeight - BOTTOM));
		measure();
		const seen = new ResizeObserver(measure);
		seen.observe(el);
		window.addEventListener("resize", measure);
		return () => {
			seen.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	return { ref, top };
}
