import { CircleHelp } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "#/components/ui/popover";
import { cn } from "#/lib/utils";

/** How long the pointer may be on its way from the mark to the text before the text closes. */
const LEAVE_MS = 140;

/**
 * A small "?" next to a word a newcomer may not know. The explanation opens
 * when the mark is hovered, focused with the keyboard, or tapped; a tap (or
 * click) keeps it open until the next tap, a click elsewhere or Escape. It
 * never takes the focus away from where the reader was.
 */
export function Hint({
	title,
	children,
	className,
}: {
	/** The term, as the heading of the explanation; also names the mark for screen readers. */
	title: string;
	children: ReactNode;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	// kept open by a tap or click, as opposed to passing over it
	const pinned = useRef(false);
	const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
	const id = useId();

	const stay = () => {
		if (leaving.current) clearTimeout(leaving.current);
		leaving.current = null;
	};
	const show = () => {
		stay();
		setOpen(true);
	};
	const leave = () => {
		stay();
		if (pinned.current) return;
		leaving.current = setTimeout(() => setOpen(false), LEAVE_MS);
	};
	// a timer still running when the mark goes away must not fire
	useEffect(
		() => () => {
			if (leaving.current) clearTimeout(leaving.current);
		},
		[],
	);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				// Escape, or a click elsewhere
				if (!next) {
					pinned.current = false;
					stay();
					setOpen(false);
				}
			}}
		>
			<PopoverAnchor asChild>
				<button
					type="button"
					aria-label={`What is this: ${title}`}
					aria-expanded={open}
					aria-controls={open ? id : undefined}
					onClick={(e) => {
						// inside a label or a link, the mark must not act for them
						e.preventDefault();
						e.stopPropagation();
						pinned.current = !pinned.current;
						if (pinned.current) show();
						else setOpen(false);
					}}
					onPointerEnter={(e) => {
						if (e.pointerType === "mouse") show();
					}}
					onPointerLeave={(e) => {
						if (e.pointerType === "mouse") leave();
					}}
					onFocus={(e) => {
						if (e.currentTarget.matches(":focus-visible")) show();
					}}
					onBlur={leave}
					className={cn(
						"inline-flex size-4 shrink-0 items-center justify-center rounded-full align-[-2px] text-subtle-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand aria-expanded:text-foreground",
						// a finger needs more than 16 pixels: the mark stays small, its target does not
						"relative after:absolute after:-inset-2.5 after:content-['']",
						className,
					)}
				>
					<CircleHelp className="size-3.5" aria-hidden />
				</button>
			</PopoverAnchor>
			<PopoverContent
				id={id}
				role="note"
				side="top"
				onOpenAutoFocus={(e) => e.preventDefault()}
				onCloseAutoFocus={(e) => e.preventDefault()}
				onPointerEnter={stay}
				onPointerLeave={(e) => {
					if (e.pointerType === "mouse") leave();
				}}
				className="text-left font-sans text-[13px] font-normal normal-case leading-relaxed tracking-normal text-muted-foreground"
			>
				<p className="mb-1 text-[13px] font-semibold text-foreground">
					{title}
				</p>
				{children}
			</PopoverContent>
		</Popover>
	);
}
