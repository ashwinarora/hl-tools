import { Fragment } from "react";
import { cn } from "#/lib/utils";
import { amountIn } from "../model/headline";

const ADDRESS = /(0x[0-9a-fA-F]{40})/;

/**
 * The type of a whole address on a line of its own: monospace, as large as
 * the column lets 42 characters be (a character of the monospace face is 0.6
 * of its size), up to `max`, and never under 10 px: a column narrower than
 * that (a 320 px phone) wraps the address instead of shrinking it past
 * reading (audit F-111).
 */
export const ADDRESS_MIN_PX = 10;
export const fittedAddress = (max: number, room = "0px") => ({
	fontSize: `clamp(${ADDRESS_MIN_PX}px, calc((100cqi - ${room}) / 25.4), ${max}px)`,
});

const SIZE = {
	lg: {
		plain: "text-[19px] font-semibold leading-snug min-[861px]:text-[21px]",
		// the verb, the figure and where it goes, each on a line of its own
		line: "block",
		after: "mt-1 block",
		words: "text-[15px] text-muted-foreground",
		figure: 44,
		figureClass: "font-semibold leading-[1.1] tracking-[-0.02em]",
		unit: "text-lg font-medium text-muted-foreground min-[861px]:text-xl",
		address: 17,
	},
	sm: {
		plain: "text-[15px] font-medium leading-snug",
		// one line up to the address, the address whole under it
		line: "inline",
		after: "inline",
		words: "text-[13px] text-muted-foreground",
		figure: 24,
		figureClass: "font-semibold leading-tight tracking-[-0.01em]",
		unit: "text-[13px] font-medium text-muted-foreground",
		address: 14,
	},
} as const;

/** The words of a sentence, every whole address in it on a line of its own. */
function Words({ text, size }: { text: string; size: keyof typeof SIZE }) {
	const parts = text.split(ADDRESS);
	return (
		<>
			{parts.map((p, i) =>
				i % 2 === 1 ? (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed sentence
						key={i}
						className="block font-mono font-normal tracking-normal text-foreground [overflow-wrap:anywhere]"
						style={fittedAddress(SIZE[size].address)}
					>
						{p}
					</span>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed sentence
					<Fragment key={i}>{p}</Fragment>
				),
			)}
		</>
	);
}

/**
 * What a proposal does, set like a transfer confirmation: the verb, then the
 * amount as the largest figure, then where it goes, its address whole on a
 * line of its own. The sentence is the same one, word for word, in the same
 * order, and a screen reader reads it whole. A sentence without an amount is
 * shown as it is, in large type.
 */
export function Headline({
	text,
	size = "lg",
	className,
}: {
	text: string;
	size?: keyof typeof SIZE;
	className?: string;
}) {
	const s = SIZE[size];
	const cut = amountIn(text);
	if (!cut)
		return (
			<p
				className={cn(
					"@container min-w-0 text-balance [overflow-wrap:anywhere]",
					s.plain,
					className,
				)}
			>
				<Words text={text} size={size} />
			</p>
		);
	// the figure as large as the column lets it be, its unit beside it
	const figure = {
		fontSize: `min(${s.figure}px, calc((100cqi - 4.5rem) / ${(0.6 * cut.figure.length + 0.2).toFixed(2)}))`,
	};
	return (
		<p className={cn("@container min-w-0", className)}>
			{cut.before && (
				<>
					<span className={cn(s.line, "[overflow-wrap:anywhere]", s.words)}>
						<Words text={cut.before} size={size} />
					</span>{" "}
				</>
			)}
			<span className={cn(s.line, "whitespace-nowrap")}>
				<span
					className={cn("font-mono tabular-nums", s.figureClass)}
					style={figure}
				>
					{cut.figure}
				</span>{" "}
				<span className={s.unit}>{cut.unit}</span>
			</span>
			{cut.after && (
				<>
					{" "}
					<span className={cn(s.after, "[overflow-wrap:anywhere]", s.words)}>
						<Words text={cut.after} size={size} />
					</span>
				</>
			)}
		</p>
	);
}
