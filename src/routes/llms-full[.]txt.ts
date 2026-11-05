import { createFileRoute } from "@tanstack/react-router";
import { llmsFull } from "#/lib/docs/source";

/** Every docs page in one Markdown file, for AI assistants. Kept out of search. */
async function full(): Promise<Response> {
	return new Response(await llmsFull(), {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"x-robots-tag": "noindex",
			"cache-control": "public, max-age=3600",
		},
	});
}

export const Route = createFileRoute("/llms-full.txt")({
	server: { handlers: { GET: full, HEAD: full } },
});
