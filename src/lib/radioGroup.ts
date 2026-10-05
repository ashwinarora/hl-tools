import type { KeyboardEvent } from "react";

const NEXT = new Set(["ArrowRight", "ArrowDown"]);
const PREV = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * Keyboard behaviour for an ARIA radio group of buttons (WAI-ARIA APG):
 * arrow keys move the selection (wrapping), Home/End jump to the ends, and
 * focus follows the selection. Only the checked radio is in the tab order.
 */
export function radioGroupKeyDown<T>(
	e: KeyboardEvent<HTMLElement>,
	values: readonly T[],
	current: T,
	onChange: (v: T) => void,
) {
	const i = values.indexOf(current);
	let next: number;
	if (NEXT.has(e.key)) next = (i + 1) % values.length;
	else if (PREV.has(e.key)) next = (i - 1 + values.length) % values.length;
	else if (e.key === "Home") next = 0;
	else if (e.key === "End") next = values.length - 1;
	else return;
	e.preventDefault();
	const value = values[next];
	if (value === undefined) return;
	onChange(value);
	e.currentTarget
		.querySelectorAll<HTMLElement>('[role="radio"]')
		[next]?.focus();
}
