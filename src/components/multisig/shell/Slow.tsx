import { type ReactNode, useEffect, useState } from "react";
import { Btn } from "./kit";

/** How long a wait that should be short may last before the page says so. */
export const SLOW_MS = 10_000;

/**
 * A wait that should be short. Past `after` it says so and offers a way out
 * (by default, reloading the page), so nobody is left in front of a message
 * that never changes.
 */
export function Slow({
	children,
	after = SLOW_MS,
	wayOut,
	small = false,
}: {
	children: ReactNode;
	after?: number;
	/** What to offer instead of reloading the page. */
	wayOut?: ReactNode;
	/** The rail's narrow box: one size down. */
	small?: boolean;
}) {
	const [late, setLate] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setLate(true), after);
		return () => clearTimeout(timer);
	}, [after]);
	return (
		<>
			{children}
			{late && (
				<output
					className={`mt-2 flex flex-wrap items-center gap-2 text-muted-foreground ${small ? "text-xs" : "text-sm"}`}
				>
					<span>This is taking longer than it should.</span>
					{wayOut ?? (
						<Btn
							size="sm"
							variant="outline"
							onClick={() => window.location.reload()}
						>
							Reload the page
						</Btn>
					)}
				</output>
			)}
		</>
	);
}
