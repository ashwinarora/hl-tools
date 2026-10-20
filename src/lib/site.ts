/**
 * The site's own address and what a link to it shows when it is shared (an
 * Open Graph and a Twitter card). A link preview needs absolute URLs, so the
 * one host named here is the site's own: crawlers read these tags, and a
 * visitor's browser never fetches anything because of them
 * (`thirdParty.test.ts` allows this origin and no other).
 */
export const SITE_ORIGIN = "https://hltools.tech";

export const SHARE = {
	siteName: "hl-tools",
	title: "hl-tools — Manage, test and build on Hyperliquid",
	description:
		"The most seamless way to run a multisig on Hyperliquid, a faucet for testnet USDC with no daily cap, and read-only developer tools. Open source.",
	image: `${SITE_ORIGIN}/og-image.png`,
	imageAlt:
		"hl-tools: manage money together on Hyperliquid, $1 of mainnet USDC for ~$1,000 of testnet USDC, and developer tools.",
	imageWidth: "1200",
	imageHeight: "630",
} as const;

/** The tags of a shareable page; a route passes its own title, description and path. */
export function shareMeta(
	page: { title?: string; description?: string; path?: string } = {},
) {
	const title = page.title ?? SHARE.title;
	const description = page.description ?? SHARE.description;
	return [
		{ property: "og:type", content: "website" },
		{ property: "og:site_name", content: SHARE.siteName },
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		...(page.path
			? [{ property: "og:url", content: `${SITE_ORIGIN}${page.path}` }]
			: []),
		{ property: "og:image", content: SHARE.image },
		{ property: "og:image:width", content: SHARE.imageWidth },
		{ property: "og:image:height", content: SHARE.imageHeight },
		{ property: "og:image:alt", content: SHARE.imageAlt },
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:title", content: title },
		{ name: "twitter:description", content: description },
		{ name: "twitter:image", content: SHARE.image },
		{ name: "twitter:image:alt", content: SHARE.imageAlt },
	];
}
