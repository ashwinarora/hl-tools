import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "#/components/home/HomePage";
import homeCss from "#/components/home/home.css?url";
import { pageHead, siteJsonLd } from "#/lib/pages";

/**
 * The structured data, written by the router as `<script type="application/ld+json">`.
 * It is data, not a script, so the security policy does not apply to it. The
 * router renders this entry, but its React head type leaves it out.
 */
const jsonLd = { "script:ld+json": siteJsonLd() } as unknown as {
	name: string;
	content: string;
};

export const Route = createFileRoute("/")({
	head: () => {
		const head = pageHead("/");
		return {
			meta: [...head.meta, jsonLd],
			links: [...head.links, { rel: "stylesheet", href: homeCss }],
		};
	},
	component: HomePage,
});
