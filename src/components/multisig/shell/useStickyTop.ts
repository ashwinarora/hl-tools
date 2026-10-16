import { type CSSProperties, useEffect, useRef, useState } from "react";

/** The air between the site's header and a column that sticks under it. */
const GAP = 16;
/** Until the header is measured: its usual height (56 px and its border). */
const HEADER = 57;
/** The room kept under a column that sticks. */
const BOTTOM = 16;

/**
 * The site's header, which stays at the top of the window: the first
 * `header` element that is sticky. Its height is read, never assumed, since
 * it is taller on a narrow screen with its menu open.
 */
function siteHeader(): HTMLElement | null {
	for (const el of document.querySelectorAll<HTMLElement>("header")) {
		const position = getComputedStyle(el).position;
		if (position === "sticky" || position === "fixed") return el;
	}
	return null;
}

/**
 * Where a column stays in view (the rail, a screen's side column). One that
 * fits the window under the site's header sticks there, with a little air:
 * the header is measured, so nothing of the column ever sits under it. One
 * that does not fit scrolls with the page like the rest of it, and is never
 * cut into a scrolling box of its own. The column decides from which width
 * it is sticky (`sticky` from some width up); `style` only sets where, or
 * turns it off.
 */
export function useStickyTop<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [state, setState] = useState({ top: HEADER + GAP, fits: true });
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const header = siteHeader();
		const measure = () => {
			const top = Math.round(
				(header?.getBoundingClientRect().height ?? HEADER) + GAP,
			);
			const fits = el.offsetHeight <= window.innerHeight - top - BOTTOM;
			setState((s) => (s.top === top && s.fits === fits ? s : { top, fits }));
		};
		measure();
		const seen = new ResizeObserver(measure);
		seen.observe(el);
		if (header) seen.observe(header);
		window.addEventListener("resize", measure);
		return () => {
			seen.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	const style: CSSProperties = state.fits
		? { top: state.top }
		: { position: "relative" };
	return { ref, style, top: state.top };
}
