import { createFileRoute } from "@tanstack/react-router";
import { absoluteUrl } from "#/lib/docs/shared";
import { source } from "#/lib/docs/source";

/** Every docs page, for search engines (named in robots.txt beside the main sitemap). */
function sitemap(): Response {
	const urls = source
		.getPages()
		.map((page) => `  <url><loc>${absoluteUrl(page.url)}</loc></url>`)
		.join("\n");
	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
		{
			headers: {
				"content-type": "application/xml; charset=utf-8",
				"cache-control": "public, max-age=3600",
			},
		},
	);
}

export const Route = createFileRoute("/docs/sitemap.xml")({
	server: { handlers: { GET: sitemap, HEAD: sitemap } },
});
