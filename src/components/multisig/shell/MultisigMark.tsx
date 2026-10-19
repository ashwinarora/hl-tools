import { cn } from "#/lib/utils";

/**
 * The section's mark: a shield holding two keys, in the section's teal on
 * the same rounded square as the site's own logo. Decoration only; the word
 * next to it names the section.
 */
export function MultisigMark({ className = "size-6" }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={cn("shrink-0", className)}
		>
			<rect
				x="1"
				y="1"
				width="22"
				height="22"
				rx="5"
				className="fill-brand-soft stroke-brand/35"
				strokeWidth="1"
			/>
			<path
				d="M12 5.2 17.6 7.2v4.3c0 3.4-2.3 6-5.6 7.3-3.3-1.3-5.6-3.9-5.6-7.3V7.2L12 5.2Z"
				className="stroke-brand"
				fill="none"
				strokeWidth="1.6"
				strokeLinejoin="round"
			/>
			<circle cx="10.1" cy="10.6" r="1.25" className="fill-brand" />
			<circle cx="13.9" cy="10.6" r="1.25" className="fill-brand" />
			<path
				d="M10.1 11.8v2.2M13.9 11.8v2.2"
				className="stroke-brand"
				strokeWidth="1.3"
				strokeLinecap="round"
			/>
		</svg>
	);
}
