/**
 * "Try it": opens the screen a page is about. A plain link, so it works the
 * same from the page, its Markdown copy and a search result.
 */
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

export function TryIt({
	to,
	children,
}: {
	readonly to: string;
	readonly children?: ReactNode;
}) {
	return (
		<p className="not-prose my-6">
			<a
				href={to}
				className="inline-flex items-center gap-2 rounded-md bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground text-sm no-underline transition-opacity hover:opacity-90"
			>
				{children ?? "Try it"}
				<ArrowRight className="size-4" aria-hidden />
			</a>
		</p>
	);
}
