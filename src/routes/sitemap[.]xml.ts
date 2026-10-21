import { createFileRoute } from "@tanstack/react-router";
import { sitemapXml } from "#/lib/pages";

/** The entry pages for search engines (`src/lib/pages.ts`); working pages are not listed. */
function sitemap(): Response {
	return new Response(sitemapXml(), {
		headers: {
			"content-type": "application/xml; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}

export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: sitemap,
			HEAD: sitemap,
		},
	},
});
