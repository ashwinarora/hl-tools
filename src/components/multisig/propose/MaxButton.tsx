import { type ReactNode, useId, useState } from "react";
import type { MaxAmount } from "../model/max";

/**
 * "Max" beside an amount. One click fills the exact figure (`model/max.ts`
 * works it out) and a line under the field says what it is; with no figure
 * yet, the click fills nothing and the line says why. The line goes once the
 * amount is typed over, or once what Max draws on has changed.
 */
export function useMax(
	max: (MaxAmount & { readonly validator?: string }) | null,
	value: string,
	fill: (amount: string, validator?: string) => void,
): { readonly button: ReactNode; readonly line: ReactNode } {
	const id = useId();
	const [said, setSaid] = useState<{
		readonly text: string;
		readonly at: string;
		readonly sig: string;
	} | null>(null);
	if (!max) return { button: null, line: null };
	const sig =
		max.kind === "ok"
			? `ok ${max.amount} ${max.validator ?? ""} ${max.basis}`
			: `none ${max.reason}`;
	const shown = said && said.sig === sig && said.at === value ? said : null;
	const onClick = () => {
		if (max.kind === "ok") {
			fill(max.amount, max.validator);
			setSaid({ text: max.basis, at: max.amount, sig });
		} else setSaid({ text: max.reason, at: value, sig });
	};
	return {
		button: (
			<button
				type="button"
				onClick={onClick}
				aria-describedby={shown ? id : undefined}
				className="-my-1 inline-flex min-h-11 items-center rounded px-1.5 text-xs font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:min-h-0"
			>
				Max
			</button>
		),
		line: shown ? (
			// an <output> is announced when it changes, as a status line is
			<output
				id={id}
				className="block text-xs text-muted-foreground [overflow-wrap:anywhere]"
			>
				{shown.text}
			</output>
		) : null,
	};
}
