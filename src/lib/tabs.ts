import type { KeyboardEvent } from "react";

/**
 * Keyboard behaviour for a row of ARIA tabs (WAI-ARIA APG, automatic
 * activation): Left and Right move to the next tab and show it (wrapping),
 * Home and End jump to the ends. Only the selected tab is in the tab order,
 * so Tab moves on to the panel.
 */
export function tabsKeyDown<T>(
	e: KeyboardEvent<HTMLElement>,
	values: readonly T[],
	current: T,
	onChange: (v: T) => void,
): void {
	const i = values.indexOf(current);
	let next: number;
	if (e.key === "ArrowRight") next = (i + 1) % values.length;
	else if (e.key === "ArrowLeft")
		next = (i - 1 + values.length) % values.length;
	else if (e.key === "Home") next = 0;
	else if (e.key === "End") next = values.length - 1;
	else return;
	e.preventDefault();
	const value = values[next];
	if (value === undefined) return;
	onChange(value);
	e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
}
