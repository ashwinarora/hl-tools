/**
 * The row under a page's title: copy the page as Markdown, and a menu to view
 * that Markdown, hand it to an AI assistant, see the page's source or report
 * a problem. Nothing is sent anywhere until the reader picks an entry.
 */
import { MarkdownCopyButton } from "fumadocs-ui/layouts/docs/page";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Popover } from "radix-ui";
import { absoluteUrl, reportUrl, sourceUrl } from "#/lib/docs/shared";

interface Props {
	readonly title: string;
	readonly url: string;
	readonly markdownUrl: string;
	/** The page's file inside `content/docs`. */
	readonly path: string;
}

const BUTTON =
	"inline-flex items-center gap-2 rounded-md border border-fd-border bg-fd-secondary px-2.5 py-1.5 font-medium text-fd-secondary-foreground text-sm transition-colors hover:bg-fd-accent";

export function PageActions({ title, url, markdownUrl, path }: Props) {
	const prompt = `Read ${absoluteUrl(markdownUrl)} so I can ask questions about it.`;
	const items = [
		{ label: "View as Markdown", href: markdownUrl, external: false },
		{
			label: "Open in ChatGPT",
			href: `https://chatgpt.com/?${new URLSearchParams({ prompt, hints: "search" })}`,
			external: true,
		},
		{
			label: "Open in Claude",
			href: `https://claude.ai/new?${new URLSearchParams({ q: prompt })}`,
			external: true,
		},
		{
			label: "View the source on GitHub",
			href: sourceUrl(path),
			external: true,
		},
		{ label: "Report a problem", href: reportUrl(title, url), external: true },
	];

	return (
		<div className="not-prose -mt-2 mb-2 flex flex-wrap items-center gap-2 border-fd-border border-b pb-5">
			<MarkdownCopyButton markdownUrl={markdownUrl}>
				Copy page
			</MarkdownCopyButton>
			<Popover.Root>
				<Popover.Trigger className={BUTTON}>
					More
					<ChevronDown
						className="size-3.5 text-fd-muted-foreground"
						aria-hidden
					/>
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content
						align="start"
						sideOffset={6}
						className="z-50 flex min-w-56 flex-col rounded-lg border border-fd-border bg-fd-popover p-1 text-fd-popover-foreground shadow-lg"
					>
						{items.map((item) => (
							<a
								key={item.label}
								href={item.href}
								{...(item.external
									? { target: "_blank", rel: "noreferrer noopener" }
									: {})}
								className="inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground"
							>
								{item.label}
								{item.external ? (
									<ExternalLink
										className="ms-auto size-3.5 text-fd-muted-foreground"
										aria-hidden
									/>
								) : null}
							</a>
						))}
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
		</div>
	);
}
