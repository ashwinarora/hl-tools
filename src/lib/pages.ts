/**
 * The site's entry pages as a search engine sees them: the pages worth
 * finding (the same for every visitor), each with its own title and
 * description, its canonical address and its share tags. The sitemap
 * (`routes/sitemap[.]xml.ts`) lists exactly these. A working page (a
 * treasury, a proposal, a form) is not here: it is one visitor's state, and
 * the Multisig layout keeps it out of search (`NOINDEX`).
 *
 * The wording is held to the home page's rules (`pages.test.ts`).
 */
import { SITE } from "#/components/home/facts";
import { SHARE, SITE_ORIGIN, shareMeta } from "./site";

export interface PageSeo {
	readonly title: string;
	readonly description: string;
}

export const PAGES = {
	"/": { title: SITE.title, description: SITE.description },
	"/multisig": {
		title:
			"Hyperliquid Multisig: create a treasury, propose, sign and send — hl-tools",
		description:
			"Run a multisig treasury on Hyperliquid with your own wallets: create one from your account, propose sends, staking and vault moves, sign and send. Open source.",
	},
	"/multisig/glossary": {
		title: "Hyperliquid Multisig glossary — hl-tools",
		description:
			"The words of a multisig on Hyperliquid in plain language: treasury, signer, threshold, proposal, finaliser, signing window, API wallet, account mode and more.",
	},
	"/tools/assets": {
		title: "Asset Resolver for Hyperliquid — hl-tools",
		description:
			"Look up any Hyperliquid symbol: perp, spot, HIP-3 and HIP-4 asset IDs, token and pair indexes and decimals, side by side on mainnet and testnet.",
	},
	"/tools/signing": {
		title: "Signing Inspector for Hyperliquid — hl-tools",
		description:
			"Debug a Hyperliquid signature: the signing family, MsgPack bytes, action hash, EIP-712 typed data and the recovered signer, compared byte by byte.",
	},
	"/tools/corewriter": {
		title: "CoreWriter Workbench for Hyperliquid — hl-tools",
		description:
			"Decode or build HyperEVM CoreWriter action bytes, see raw integers next to human units, generate cast and Solidity, and query the read precompiles.",
	},
	"/tools/trace": {
		title: "Cross-layer Trace for Hyperliquid — hl-tools",
		description:
			"Follow a HyperEVM transaction into HyperCore: its receipt, decoded CoreWriter actions, the expected effect on HyperCore and what was observed.",
	},
	"/tools/orders": {
		title: "Order Composer & Failure Explainer for Hyperliquid — hl-tools",
		description:
			"Compose Hyperliquid order payloads with a precision check before sending, or paste an exchange response and see why an order failed and how to fix it.",
	},
	"/tools/websocket": {
		title: "WebSocket Workbench for Hyperliquid — hl-tools",
		description:
			"Subscribe to any Hyperliquid WebSocket channel, watch the ack, snapshot and live stream, record a session and test what a disconnect does.",
	},
	"/tools/rpc": {
		title: "RPC Capability Probe for HyperEVM — hl-tools",
		description:
			"Probe a HyperEVM JSON-RPC endpoint: chain ID, head, historical state, eth_getLogs range limits and HyperEVM methods, or compare two endpoints.",
	},
	"/tools/multisig": {
		title: "Multisig Inspector for Hyperliquid — hl-tools",
		description:
			"Inspect a Hyperliquid multisig account (signers, API wallets, balances, recent actions) or decode a multisig request and check every signature.",
	},
	"/faucet-miner": {
		title: "Testnet USDC Faucet Miner for Hyperliquid — hl-tools",
		description:
			"Get more Hyperliquid testnet USDC than one faucet drip: chain generated wallets through the testnet faucet, signed with your own wallet in your browser.",
	},
	"/faucet-miner/how-to-use": {
		title: "How the Hyperliquid testnet faucet miner works — hl-tools",
		description:
			"How the faucet miner turns $1 of mainnet USDC into about $1,000 of Hyperliquid testnet USDC, step by step, and what it signs along the way.",
	},
	"/changes": {
		title: "Hyperliquid protocol rule changes — hl-tools",
		description:
			"Every Hyperliquid protocol rule hl-tools relies on, with the date each was checked and what changed: asset IDs, precision, signing, multisig and more.",
	},
	"/privacy": {
		title: "Privacy Policy — hl-tools",
		description:
			"What hl-tools keeps and what it does not: the diagnostic tools run in your browser, and what the optional hl-tools server holds for the Multisig.",
	},
} as const satisfies Record<string, PageSeo>;

export type PagePath = keyof typeof PAGES;

/** A page's address as it is meant to be found: the site's origin, no query, no fragment. */
export function canonicalUrl(path: PagePath): string {
	return `${SITE_ORIGIN}${path}`;
}

/** Keeps a page out of search; its links are still followed. */
export const NOINDEX = { name: "robots", content: "noindex, follow" } as const;
/** Undoes a layout's `NOINDEX` for an entry page under it. */
export const INDEX = { name: "robots", content: "index, follow" } as const;

/**
 * A leaf route's head: title, description, share tags and canonical link.
 * Only leaf routes call it, because the router adds up every route's links
 * (it keeps only the deepest meta of each name).
 */
export function pageHead(path: PagePath) {
	const page: PageSeo = PAGES[path];
	return {
		meta: [
			{ title: page.title },
			{ name: "description", content: page.description },
			INDEX,
			...shareMeta({ title: page.title, description: page.description, path }),
		],
		links: [{ rel: "canonical", href: canonicalUrl(path) }],
	};
}

const REPO = "https://github.com/ashwinarora/hl-tools";

/**
 * The home page's structured data. `WebSite` gives search results the site's
 * name ("hl-tools", the other spellings people type as alternates); the
 * application carries no price on purpose.
 */
export function siteJsonLd() {
	const url = `${SITE_ORIGIN}/`;
	return {
		"@context": "https://schema.org",
		"@graph": [
			{
				"@type": "WebSite",
				"@id": `${url}#website`,
				name: SHARE.siteName,
				alternateName: ["HLTools", "HL Tools"],
				url,
			},
			{
				"@type": "SoftwareApplication",
				name: SHARE.siteName,
				description: PAGES["/"].description,
				applicationCategory: "FinanceApplication",
				operatingSystem: "Web",
				url,
				author: {
					"@type": "Person",
					name: "Ashwin Arora",
					url: "https://github.com/ashwinarora",
				},
				license: "https://www.gnu.org/licenses/agpl-3.0.html",
				sameAs: [REPO],
			},
		],
	};
}

const xmlEscape = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The sitemap: every entry page, nothing else. */
export function sitemapXml(): string {
	const urls = (Object.keys(PAGES) as PagePath[])
		.map((p) => `  <url><loc>${xmlEscape(canonicalUrl(p))}</loc></url>`)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
