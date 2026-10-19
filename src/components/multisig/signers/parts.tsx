/**
 * The pieces "Create a treasury" and "Change signers" share: a line at one of
 * the three levels, the box signers are typed or pasted into, the picker for
 * how many must sign and what that number means.
 */
import { Ban, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { TextInput } from "#/components/hub/layout";
import { cn } from "#/lib/utils";
import { CREATE } from "../model/create";
import {
	type Level,
	type Line,
	parsePasted,
	type ThresholdLines,
} from "../model/signerSet";
import { Btn } from "../shell/kit";

const TONE: Record<Level, string> = {
	blocked: "text-danger",
	warning: "text-warning",
	shown: "text-muted-foreground",
};

/** One line of the three levels: what stops this, what to know, a plain fact. */
export function LevelLine({ line }: { line: Line }) {
	const Icon =
		line.level === "blocked"
			? Ban
			: line.level === "warning"
				? TriangleAlert
				: null;
	return (
		<li
			className={cn("flex items-start gap-1.5 text-[13px]", TONE[line.level])}
		>
			{Icon && <Icon className="mt-[3px] size-3.5 shrink-0" aria-hidden />}
			<span>
				{line.level === "blocked" && (
					<span className="sr-only">Stops this: </span>
				)}
				{line.level === "warning" && <span className="sr-only">Note: </span>}
				{line.text}
			</span>
		</li>
	);
}

export function Lines({
	lines,
	className,
}: {
	lines: readonly Line[];
	className?: string;
}) {
	if (lines.length === 0) return null;
	return (
		<ul className={cn("flex flex-col gap-1", className)}>
			{lines.map((l) => (
				<LevelLine key={l.code} line={l} />
			))}
		</ul>
	);
}

/**
 * Where signers come from: typed one at a time, or pasted, several at once.
 * A pasted list goes straight to `onAdd`; what was left out is said by the
 * caller in `note`.
 */
export function PasteBox({
	disabled,
	note,
	onAdd,
}: {
	disabled: boolean;
	/** What the last paste left out, and why; empty when nothing. */
	note: string;
	onAdd(text: string): void;
}) {
	const [input, setInput] = useState("");
	const add = (text: string) => {
		onAdd(text);
		setInput("");
	};
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-wrap items-start gap-2">
				<TextInput
					mono
					name="signer-address"
					aria-label="Signer address"
					placeholder="0x…"
					value={input}
					disabled={disabled}
					className="min-w-0 flex-1 basis-[280px]"
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						// not a form of its own: this sits inside the propose form too
						if (e.key !== "Enter") return;
						e.preventDefault();
						if (input.trim()) add(input);
					}}
					onPaste={(e) => {
						const text = e.clipboardData.getData("text");
						if (parsePasted(text).addresses.length === 0) return;
						e.preventDefault();
						add(text);
					}}
				/>
				<Btn
					variant="outline"
					disabled={disabled || !input.trim()}
					onClick={() => add(input)}
				>
					Add
				</Btn>
			</div>
			<p className="text-xs text-muted-foreground">{CREATE.pasteHint}</p>
			{note && (
				<output className="block text-[13px] text-warning">{note}</output>
			)}
		</div>
	);
}

/**
 * "How many must sign": one button per possible number. With `value` null
 * none is chosen, and the first takes the keyboard focus.
 */
export function HowMany({
	n,
	value,
	disabled,
	onChange,
}: {
	n: number;
	value: number | null;
	disabled: boolean;
	onChange(k: number): void;
}) {
	const numbers = Array.from({ length: n }, (_, i) => i + 1);
	return (
		<div
			role="radiogroup"
			aria-label={`${CREATE.howManyTitle}, out of ${n}`}
			className="flex flex-wrap items-center gap-1.5"
			onKeyDown={(e) => {
				if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
				e.preventDefault();
				const at = value ?? (e.key === "ArrowRight" ? 0 : n + 1);
				const next = Math.min(
					n,
					Math.max(1, at + (e.key === "ArrowRight" ? 1 : -1)),
				);
				onChange(next);
				(
					e.currentTarget.querySelector(
						`[data-k="${next}"]`,
					) as HTMLElement | null
				)?.focus();
			}}
		>
			{numbers.map((i) => (
				// biome-ignore lint/a11y/useSemanticElements: the ARIA radio pattern on buttons, as in the hub's Segmented
				<button
					key={i}
					type="button"
					role="radio"
					data-k={i}
					aria-checked={value === i}
					tabIndex={value === i || (value === null && i === 1) ? 0 : -1}
					disabled={disabled}
					onClick={() => onChange(i)}
					className={cn(
						"h-8 min-w-9 rounded-md border px-2.5 font-mono text-[13px] tabular-nums transition-colors disabled:opacity-60",
						value === i
							? "border-brand bg-brand-soft font-semibold text-brand"
							: "border-border-strong bg-surface text-foreground hover:bg-surface-2",
					)}
				>
					{i}
				</button>
			))}
			<span className="text-[13px] text-muted-foreground">
				of {n} {n === 1 ? "signer" : "signers"}
			</span>
		</div>
	);
}

/** What the chosen number means: who can act, and the two risks it trades. */
export function ThresholdMeaning({ lines }: { lines: ThresholdLines }) {
	return (
		<div className="flex flex-col gap-1 text-[13px]">
			<p className="font-medium">{lines.summary}</p>
			<p className="text-muted-foreground">{lines.stolen}</p>
			<p className="text-muted-foreground">{lines.lost}</p>
			{lines.warning && (
				<ul>
					<LevelLine
						line={{ level: "warning", code: "threshold", text: lines.warning }}
					/>
				</ul>
			)}
		</div>
	);
}
