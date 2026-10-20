import type { ReactNode } from "react";
import { CopyButton } from "#/components/hub/CopyButton";
import { cn } from "#/lib/utils";
import { fittedAddress } from "./Headline";

/**
 * A table of what a proposal names: the treasury, who receives, who sends
 * it, and its fields. A label beside its value; in a narrow column the label
 * above it, so an address keeps the whole width.
 */
export function Facts({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<dl className={cn("@container min-w-0 divide-y divide-border", className)}>
			{children}
		</dl>
	);
}

const ROW =
	"grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0 @min-[30rem]:grid-cols-[8.5rem_minmax(0,1fr)_auto]";
const LABEL =
	"col-start-1 row-start-1 flex items-center gap-1 pt-0.5 text-xs text-muted-foreground @min-[30rem]:pt-1";
const VALUE =
	"col-span-2 row-start-2 min-w-0 @min-[30rem]:col-span-1 @min-[30rem]:col-start-2 @min-[30rem]:row-start-1";

/** A field and its value. */
export function Fact({
	label,
	children,
}: {
	label: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className={ROW}>
			<dt className={LABEL}>{label}</dt>
			<dd className={cn(VALUE, "text-sm [overflow-wrap:anywhere]")}>
				{children}
			</dd>
		</div>
	);
}

/**
 * An address in full, on one line however narrow the column (its type
 * shrinks rather than the address breaking), with a button that copies it.
 * `children` shows it with its nickname; `room` keeps space on its line for
 * what follows the address there (the nickname button).
 */
export function AddressFact({
	label,
	address,
	children,
	room,
}: {
	label: ReactNode;
	address: string;
	children?: ReactNode;
	room?: string;
}) {
	return (
		<div className={ROW}>
			<dt className={LABEL}>{label}</dt>
			<dd className={VALUE}>
				<span className="@container block min-w-0">
					<span className="block" style={fittedAddress(13, room)}>
						{children ?? (
							<span className="font-mono [overflow-wrap:anywhere]">
								{address}
							</span>
						)}
					</span>
				</span>
			</dd>
			<dd className="col-start-2 row-start-1 -my-0.5 @min-[30rem]:col-start-3">
				<CopyButton value={address} size="xs" />
			</dd>
		</div>
	);
}
