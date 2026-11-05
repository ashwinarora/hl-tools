/**
 * Pictures and videos in the docs. Every file is served from this site
 * (`public/docs/`), sized up front so the page does not jump as it loads.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { type Mark, marksOf } from "./marks";

/* ------------------------------------------------------------------ marks */

/**
 * The marks' colour. The screenshots are always dark, so the marks keep the
 * dark theme's teal in both themes.
 */
const MARK = "oklch(0.83 0.12 175)";
const MARK_INK = "oklch(0.2 0.03 175)";

function pct(part: number, whole: number): string {
	return `${(part / whole) * 100}%`;
}

/** Outlines and numbered dots over a picture of `width` × `height` pixels. */
function Marks({
	marks,
	width,
	height,
}: {
	marks: readonly Mark[];
	width: number;
	height: number;
}) {
	if (marks.length === 0) return null;
	return (
		<span aria-hidden className="pointer-events-none absolute inset-0">
			{marks.map((m, i) => {
				const [x, y, w, h] = m.box;
				return (
					<span
						key={m.label}
						className="absolute rounded-md"
						style={{
							left: pct(x, width),
							top: pct(y, height),
							width: pct(w, width),
							height: pct(h, height),
							boxShadow: `0 0 0 1.5px ${MARK}, 0 0 0 3px rgb(0 0 0 / 0.35)`,
							background: `color-mix(in oklab, ${MARK} 6%, transparent)`,
						}}
					>
						{/* the number is drawn by CSS, not written as text: the list
						    under the picture says it, and the button's name is the
						    picture's description */}
						<span
							data-n={i + 1}
							className="-translate-x-1/2 -translate-y-1/2 absolute top-0 left-0 grid size-[18px] place-items-center rounded-full font-semibold text-[11px] tabular-nums leading-none after:content-[attr(data-n)]"
							style={{
								background: MARK,
								color: MARK_INK,
								boxShadow: "0 0 0 2px rgb(0 0 0 / 0.45)",
							}}
						/>
					</span>
				);
			})}
		</span>
	);
}

/** The labels under a marked picture: the marks' text for every reader. */
function MarkList({ marks }: { marks: readonly Mark[] }) {
	if (marks.length === 0) return null;
	return (
		<ol className="mt-3 grid gap-x-6 gap-y-1.5 text-fd-muted-foreground text-sm sm:grid-cols-2">
			{marks.map((m, i) => (
				<li key={m.label} className="flex items-baseline gap-2">
					<span className="grid size-[18px] shrink-0 translate-y-[3px] place-items-center rounded-full bg-fd-primary/15 font-semibold text-[11px] text-fd-primary tabular-nums leading-none">
						{i + 1}
					</span>
					<span>{m.label}</span>
				</li>
			))}
		</ol>
	);
}

/* ------------------------------------------------------------------- shot */

interface ShotProps {
	/** `/docs/img/….webp` */
	readonly src: string;
	readonly alt: string;
	/** Natural size of the file in pixels (2× the size shown on a desktop). */
	readonly width: number;
	readonly height: number;
	/** One line under the picture, when the picture needs it. */
	readonly caption?: string;
}

/**
 * A screenshot with its marks. A click opens it at full size in a viewer that
 * scrolls when the picture is larger than the screen (on a phone it always is).
 */
export function Shot({ src, alt, width, height, caption }: ShotProps) {
	const marks = marksOf(src);
	const dialog = useRef<HTMLDialogElement>(null);
	const [open, setOpen] = useState(false);

	const close = useCallback(() => dialog.current?.close(), []);

	useEffect(() => {
		const d = dialog.current;
		if (!d) return;
		const onClose = () => setOpen(false);
		d.addEventListener("close", onClose);
		return () => d.removeEventListener("close", onClose);
	}, []);

	// the page behind the viewer stays still while it is open
	useEffect(() => {
		if (!open) return;
		const html = document.documentElement;
		const before = html.style.overflow;
		html.style.overflow = "hidden";
		return () => {
			html.style.overflow = before;
		};
	}, [open]);

	const picture = (
		<span className="relative block">
			<img
				src={src}
				alt={alt}
				width={Math.round(width / 2)}
				height={Math.round(height / 2)}
				loading="lazy"
				decoding="async"
				className="block h-auto w-full rounded-lg border border-fd-border"
			/>
			<Marks marks={marks} width={width} height={height} />
		</span>
	);

	return (
		<figure className="not-prose my-6">
			<button
				type="button"
				onClick={() => {
					dialog.current?.showModal();
					setOpen(true);
				}}
				aria-label={`Open the picture at full size: ${alt}`}
				className="block w-full max-w-full cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:outline-fd-primary focus-visible:outline-offset-2"
				style={{ maxWidth: Math.round(width / 2) }}
			>
				{picture}
			</button>
			<MarkList marks={marks} />
			{caption ? (
				<figcaption className="mt-2 text-center text-fd-muted-foreground text-sm">
					{caption}
				</figcaption>
			) : null}
			<dialog
				ref={dialog}
				aria-label={alt}
				className="m-0 h-dvh max-h-none w-dvw max-w-none bg-transparent p-0 backdrop:bg-black/90"
			>
				{open ? (
					// a click anywhere closes it, as a zoomed picture does elsewhere
					<button
						type="button"
						onClick={close}
						aria-label="Close the picture"
						className="grid min-h-full min-w-full cursor-zoom-out place-items-center overflow-auto p-4 sm:p-8"
					>
						<span
							className="relative block overflow-hidden rounded-lg"
							style={{ width: Math.round(width / 2), maxWidth: "none" }}
						>
							<img
								src={src}
								alt=""
								width={Math.round(width / 2)}
								height={Math.round(height / 2)}
								className="block h-auto w-full"
							/>
							<Marks marks={marks} width={width} height={height} />
						</span>
					</button>
				) : null}
				<button
					type="button"
					onClick={close}
					className="fixed top-3 right-3 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white backdrop-blur focus-visible:outline-2 focus-visible:outline-white"
				>
					Close
				</button>
			</dialog>
		</figure>
	);
}

/* ------------------------------------------------------------------ video */

interface VideoProps {
	/** `/docs/video/….mp4` */
	readonly src: string;
	/** The first frame, shown before the video plays. */
	readonly poster: string;
	/** What the video shows, in one line: its caption and its text for screen readers. */
	readonly caption: string;
	readonly width: number;
	readonly height: number;
}

/** A video plays this many times by itself, then waits for Replay. */
const PLAYS = 3;

function clock(seconds: number, round = Math.round): string {
	const s = Math.max(0, round(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type State = "paused" | "playing" | "done";

interface FullscreenVideo extends HTMLVideoElement {
	webkitEnterFullscreen?: () => void;
}

/**
 * A short silent clip with small controls, so it never passes for a still.
 *
 * - Desktop: plays by itself while on screen, three times, then stops on its
 *   last frame with Replay. A click (or the pill) pauses and plays.
 * - Phone: the first frame with a play button; a tap plays it full screen.
 * - Motion turned off: the same play button; a tap plays it in the page.
 */
export function Video({ src, poster, caption, width, height }: VideoProps) {
	const ref = useRef<FullscreenVideo>(null);
	const bar = useRef<HTMLSpanElement>(null);
	const now = useRef<HTMLSpanElement>(null);
	const plays = useRef(0);
	const [state, setState] = useState<State>("paused");
	const [length, setLength] = useState<number | null>(null);
	// "auto" plays by itself; "tap" waits for the reader (phone or motion off)
	const [mode, setMode] = useState<"auto" | "tap" | "phone">("auto");

	useEffect(() => {
		const video = ref.current;
		if (!video) return;
		// the file's length may have arrived before this page's script ran
		if (video.readyState >= 1) setLength(video.duration);
		const phone = window.matchMedia("(pointer: coarse), (max-width: 639px)");
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
		if (phone.matches) {
			setMode("phone");
			return;
		}
		if (reduce.matches) {
			setMode("tap");
			return;
		}
		const seen = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) {
					if (plays.current < PLAYS) void video.play().catch(() => undefined);
				} else video.pause();
			},
			{ threshold: 0.4 },
		);
		seen.observe(video);
		return () => seen.disconnect();
	}, []);

	// the progress line and the time so far, moved on every frame while
	// playing (no re-render)
	const show = useCallback(() => {
		const v = ref.current;
		if (!v || !(v.duration > 0)) return;
		if (bar.current)
			bar.current.style.transform = `scaleX(${v.currentTime / v.duration})`;
		const text = clock(Math.min(v.currentTime, v.duration), Math.floor);
		if (now.current && now.current.textContent !== text)
			now.current.textContent = text;
	}, []);

	useEffect(() => {
		if (state !== "playing") return;
		let frame = 0;
		const tick = () => {
			show();
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [state, show]);

	// full screen on a phone: the browser's own controls while it lasts
	useEffect(() => {
		const video = ref.current;
		if (!video || mode !== "phone") return;
		const left = () => {
			if (document.fullscreenElement === video) return;
			video.controls = false;
			video.pause();
		};
		document.addEventListener("fullscreenchange", left);
		video.addEventListener("webkitendfullscreen", left);
		return () => {
			document.removeEventListener("fullscreenchange", left);
			video.removeEventListener("webkitendfullscreen", left);
		};
	}, [mode]);

	const press = () => {
		const video = ref.current;
		if (!video) return;
		if (state === "playing") {
			video.pause();
			return;
		}
		if (state === "done") {
			plays.current = 0;
			video.currentTime = 0;
		}
		void video.play().catch(() => undefined);
		if (mode === "phone") {
			video.controls = true;
			if (video.requestFullscreen)
				void video.requestFullscreen().catch(() => undefined);
			else video.webkitEnterFullscreen?.();
		}
	};

	const label =
		state === "playing"
			? `Pause the video: ${caption}`
			: state === "done"
				? `Play the video again: ${caption}`
				: `Play the video: ${caption}`;
	const big = state === "done" || (state === "paused" && mode !== "auto");

	return (
		<figure className="not-prose my-6">
			<div
				className="relative overflow-hidden rounded-lg border border-fd-border bg-fd-muted"
				style={{ aspectRatio: `${width} / ${height}` }}
			>
				<video
					ref={ref}
					src={src}
					poster={poster}
					width={Math.round(width / 2)}
					height={Math.round(height / 2)}
					muted
					playsInline
					preload="metadata"
					aria-hidden="true"
					tabIndex={-1}
					onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
					onPlay={() => setState("playing")}
					onPause={(e) =>
						setState(
							e.currentTarget.ended && plays.current >= PLAYS
								? "done"
								: "paused",
						)
					}
					onEnded={(e) => {
						plays.current += 1;
						const v = e.currentTarget;
						// a phone in full screen keeps playing until the reader leaves
						if (plays.current < PLAYS || document.fullscreenElement === v) {
							v.currentTime = 0;
							void v.play().catch(() => undefined);
						} else setState("done");
					}}
					className="block h-full w-full"
				/>
				<button
					type="button"
					onClick={press}
					aria-label={label}
					className="peer absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-fd-primary focus-visible:-outline-offset-2"
				/>
				{/* drawn over the button, not inside it: its changing time is for
				    the eye, and the button's name already says what it does */}
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 [&_.pill]:transition peer-hover:[&_.pill]:bg-black/80"
				>
					{big ? (
						<span className="absolute inset-0 grid place-items-center bg-black/25">
							<span className="pill flex items-center gap-2 rounded-full bg-black/65 px-4 py-2.5 font-medium text-sm text-white shadow-lg backdrop-blur">
								{state === "done" ? <ReplayIcon /> : <PlayIcon />}
								{state === "done" ? "Replay" : length ? clock(length) : "Play"}
							</span>
						</span>
					) : (
						<span className="pill absolute right-2.5 bottom-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 font-medium text-[11px] text-white tabular-nums backdrop-blur">
							{state === "playing" ? <PauseIcon /> : <PlayIcon />}
							{length ? (
								<span>
									<span ref={now}>0:00</span>
									<span className="text-white/60"> / {clock(length)}</span>
								</span>
							) : (
								"Video"
							)}
						</span>
					)}
				</span>
				<span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
					<span
						ref={bar}
						className="block h-full origin-left bg-fd-primary"
						style={{ transform: state === "done" ? "scaleX(1)" : "scaleX(0)" }}
					/>
				</span>
			</div>
			<figcaption className="mt-2 text-center text-fd-muted-foreground text-sm">
				{caption}
			</figcaption>
		</figure>
	);
}

function PlayIcon() {
	return (
		<svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 fill-current">
			<path d="M3 1.8v8.4a.6.6 0 0 0 .9.5l6.6-4.2a.6.6 0 0 0 0-1L3.9 1.3a.6.6 0 0 0-.9.5Z" />
		</svg>
	);
}

function PauseIcon() {
	return (
		<svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 fill-current">
			<rect x="2.5" y="1.5" width="2.5" height="9" rx=".6" />
			<rect x="7" y="1.5" width="2.5" height="9" rx=".6" />
		</svg>
	);
}

function ReplayIcon() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			className="size-3.5 fill-none stroke-current"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
			<path d="M2.5 2.5v3h3" />
		</svg>
	);
}
