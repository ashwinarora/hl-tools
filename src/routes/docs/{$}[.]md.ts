import { createFileRoute } from "@tanstack/react-router";
import { slugsOfMarkdown } from "#/lib/docs/shared";
import { docsLlms, source } from "#/lib/docs/source";

/**
 * A docs page as Markdown (`/docs/multisig/create.md`, `/docs/index.md`), for
 * "Copy page" and AI assistants. Kept out of search: the HTML page is the one
 * to find.
 */
async function markdown({
	params,
}: {
	params: { _splat?: string };
}): Promise<Response> {
	const slugs = slugsOfMarkdown(
		params._splat?.split("/").filter(Boolean) ?? [],
	);
	const page = source.getPage(slugs);
	if (!page)
		return new Response("Not found\n", {
			status: 404,
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	return new Response(await docsLlms.page(page), {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"x-robots-tag": "noindex",
			"cache-control": "public, max-age=3600",
		},
	});
}

export const Route = createFileRoute("/docs/{$}.md")({
	server: { handlers: { GET: markdown, HEAD: markdown } },
});
