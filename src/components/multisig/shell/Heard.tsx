import { type ReactNode, useEffect, useRef } from "react";

/**
 * Where the result of a click lands: announced to a screen reader (a live
 * region that is always in the page, so a change to it is heard) and
 * scrolled into view, so a reader on a phone sees it however far down the
 * button was. `when` changes with every new result; `urgent` for a refusal.
 */
export function Heard({
	when,
	urgent = false,
	children,
}: {
	when: unknown;
	urgent?: boolean;
	children: ReactNode;
}) {
	const region = useRef<HTMLOutputElement>(null);
	useEffect(() => {
		if (when == null) return;
		region.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [when]);
	return (
		<output
			ref={region}
			aria-live={urgent ? "assertive" : "polite"}
			className="block scroll-mb-24"
		>
			{children}
		</output>
	);
}
