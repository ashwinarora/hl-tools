/**
 * The docs as Fumadocs sees them: the page tree, the pages, and their
 * Markdown for "Copy page", `/docs/*.md` and `llms.txt`. Server-only: the
 * routes call it from server functions and handlers.
 */
import { llms, loader } from "fumadocs-core/source";
import { docs } from "./collection";
import { absoluteUrl, DOCS_ROUTE, markdownUrl } from "./shared";

export const source = loader({
	source: docs.toFumadocsSource(),
	baseUrl: DOCS_ROUTE,
});

type Page = ReturnType<typeof source.getPages>[number];

async function renderPage(page: Page): Promise<string> {
	return `# ${page.data.title}\n\nSource: ${absoluteUrl(page.url)}\n\n${page.data.description ? `${page.data.description}\n\n` : ""}${await page.data.getText("processed")}`;
}

export const docsLlms = llms(source, { renderPage });

interface TreeNode {
	type: string;
	name?: unknown;
	url?: string;
	children?: TreeNode[];
	index?: TreeNode;
}

/** Every page's address, in the sidebar's order. */
function sidebarOrder(): string[] {
	const urls: string[] = [];
	const visit = (nodes: TreeNode[]) => {
		for (const node of nodes) {
			if (node.type === "page" && node.url) urls.push(node.url);
			if (node.type === "folder") {
				if (node.index?.url) urls.push(node.index.url);
				visit(node.children ?? []);
			}
		}
	};
	visit(source.getPageTree().children as TreeNode[]);
	return urls;
}

/**
 * `llms-full.txt`: every page in the sidebar's order, each headed by its
 * title and address, with a rule between pages. A page outside the sidebar
 * comes last rather than not at all.
 */
export async function llmsFull(): Promise<string> {
	const pages = source.getPages();
	const order = sidebarOrder();
	const rank = (url: string) => {
		const i = order.indexOf(url);
		return i === -1 ? order.length : i;
	};
	const sorted = [...pages].sort((a, b) => rank(a.url) - rank(b.url));
	const parts = await Promise.all(sorted.map(renderPage));
	return `${parts.map((p) => p.trim()).join("\n\n---\n\n")}\n`;
}

/**
 * `llms.txt`: what hl-tools is, then every page in the sidebar's order, each
 * linked to its Markdown copy with its one-line description.
 */
export function llmsIndex(): string {
	const lines: string[] = [
		"# hl-tools",
		"",
		"> Manage, test and build on Hyperliquid: a multisig treasury manager, a testnet USDC faucet miner and read-only developer tools. These are its docs.",
		"",
		`Every page below is Markdown. All pages in one file: ${absoluteUrl("/llms-full.txt")}`,
	];
	const line = (url: string) => {
		const page = source.getPages().find((p) => p.url === url);
		if (!page) return;
		const description = page.data.description
			? `: ${page.data.description}`
			: "";
		lines.push(
			`- [${page.data.title}](${absoluteUrl(markdownUrl(page.slugs))})${description}`,
		);
	};
	const visit = (nodes: TreeNode[], depth: number) => {
		for (const node of nodes) {
			if (node.type === "page" && node.url) line(node.url);
			if (node.type === "folder") {
				lines.push(
					"",
					`${"#".repeat(Math.min(depth + 2, 4))} ${String(node.name)}`,
					"",
				);
				if (node.index?.url) line(node.index.url);
				visit(node.children ?? [], depth + 1);
			}
		}
	};
	lines.push("", "## Docs", "");
	visit(source.getPageTree().children as TreeNode[], 0);
	return `${lines.join("\n")}\n`;
}
