import type { KeyboardEvent } from "react";
import { describe, expect, it } from "vitest";
import { tabsKeyDown } from "./tabs";

const TABS = ["overview", "pending", "log"] as const;

/** A key pressed on the tab row: which tab it showed, and which one got the focus. */
function press(key: string, current: (typeof TABS)[number]) {
	let shown: string | null = null;
	let focused: number | null = null;
	let prevented = false;
	const tabs = TABS.map((_, i) => ({ focus: () => (focused = i) }));
	const e = {
		key,
		preventDefault: () => {
			prevented = true;
		},
		currentTarget: { querySelectorAll: () => tabs },
	} as unknown as KeyboardEvent<HTMLElement>;
	tabsKeyDown(e, TABS, current, (v) => {
		shown = v;
	});
	return { shown, focused, prevented };
}

describe("tabsKeyDown", () => {
	it("moves with the arrows, wrapping, and the focus follows", () => {
		expect(press("ArrowRight", "overview")).toEqual({
			shown: "pending",
			focused: 1,
			prevented: true,
		});
		expect(press("ArrowRight", "log").shown).toBe("overview");
		expect(press("ArrowLeft", "overview")).toMatchObject({
			shown: "log",
			focused: 2,
		});
	});

	it("jumps to the ends with Home and End", () => {
		expect(press("Home", "log").shown).toBe("overview");
		expect(press("End", "overview").shown).toBe("log");
	});

	it("leaves every other key alone, the up and down arrows included", () => {
		for (const key of ["ArrowDown", "ArrowUp", "Tab", "Enter", "a"])
			expect(press(key, "pending")).toEqual({
				shown: null,
				focused: null,
				prevented: false,
			});
	});
});
