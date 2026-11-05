import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "#/lib/docs/source";

/**
 * The docs' search (⌘K), answered by this server from the docs' own pages.
 * A page's `keywords:` (other spellings a reader may type, like "EIP712") are
 * indexed as one more line of the page, so a search for them lands on it.
 */
const search = createFromSource(source, {
	language: "english",
	async buildIndex(page) {
		const { structuredData } = await page.data.load();
		const keywords = page.data.keywords ?? [];
		return {
			id: page.url,
			url: page.url,
			title: page.data.title,
			description: page.data.description,
			structuredData: keywords.length
				? {
						...structuredData,
						contents: [
							...structuredData.contents,
							{ heading: undefined, content: keywords.join(" · ") },
						],
					}
				: structuredData,
		};
	},
});

export const Route = createFileRoute("/api/search")({
	server: {
		handlers: {
			GET: ({ request }) => search.GET(request),
		},
	},
});
