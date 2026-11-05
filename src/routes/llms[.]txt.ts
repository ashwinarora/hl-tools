import { createFileRoute } from "@tanstack/react-router";
import { llmsIndex } from "#/lib/docs/source";

/** The docs' index for AI assistants: every page with its Markdown address. */
function index(): Response {
	return new Response(llmsIndex(), {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}

export const Route = createFileRoute("/llms.txt")({
	server: { handlers: { GET: index, HEAD: index } },
});
