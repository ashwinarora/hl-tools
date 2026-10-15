import type { ReactNode } from "react";
import { cn } from "#/lib/utils";
import { useStickyTop } from "./useStickyTop";

/**
 * Where the two columns begin: `shell` beside the rail (861 px, the two
 * columns share the width), `xl` only from 1280 px, for screens whose main
 * column holds a form that needs its width.
 */
type From = "shell" | "xl";

const GRID: Record<From, string> = {
	shell:
		"grid grid-cols-1 items-start gap-4 min-[861px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-5",
	xl: "grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-5",
};

const STICKY: Record<From, string> = {
	shell: "min-[861px]:sticky",
	xl: "xl:sticky",
};

/**
 * A screen in two columns: a wide main one, and beside it a narrower one
 * that stays in view (the signatures, the preview and Create, a summary).
 * `top` sits above the main column, across both on a mid-sized screen; from
 * 1280 px the side column rises beside it. On a phone everything is one
 * column, and the reading order is always the order given: top, main, side.
 */
export function Split({
	top,
	main,
	side,
	from = "shell",
}: {
	top?: ReactNode;
	main: ReactNode;
	side: ReactNode;
	from?: From;
}) {
	const withTop = top !== undefined && top !== null && top !== false;
	const sticky = useStickyTop<HTMLDivElement>();
	return (
		<div
			className={cn(
				GRID[from],
				// the side column's extra height goes below the main column, never between it and `top`
				withTop && "xl:grid-rows-[auto_1fr]",
			)}
		>
			{withTop && (
				<div
					className={cn(
						"flex min-w-0 flex-col gap-4 xl:col-start-1 xl:row-start-1",
						from === "shell" && "min-[861px]:col-span-2 xl:col-span-1",
					)}
				>
					{top}
				</div>
			)}
			<div
				className={cn(
					"flex min-w-0 flex-col gap-4",
					from === "shell"
						? withTop
							? "min-[861px]:col-start-1 min-[861px]:row-start-2"
							: "min-[861px]:col-start-1 min-[861px]:row-start-1"
						: withTop
							? "xl:col-start-1 xl:row-start-2"
							: "xl:col-start-1 xl:row-start-1",
				)}
			>
				{main}
			</div>
			<div
				ref={sticky.ref}
				// only a sticky column reads `top`; one column on a phone ignores it
				style={{ top: sticky.top }}
				className={cn(
					"flex min-w-0 flex-col gap-4 self-start",
					STICKY[from],
					from === "shell"
						? withTop
							? "min-[861px]:col-start-2 min-[861px]:row-start-2 xl:row-span-2 xl:row-start-1"
							: "min-[861px]:col-start-2 min-[861px]:row-start-1"
						: withTop
							? "xl:col-start-2 xl:row-span-2 xl:row-start-1"
							: "xl:col-start-2 xl:row-start-1",
				)}
			>
				{side}
			</div>
		</div>
	);
}
