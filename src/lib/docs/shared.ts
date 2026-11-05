/**
 * Addresses of the docs: a page, its Markdown copy and its source on GitHub.
 * Shared by the routes and the page actions; no server code here.
 */
import { createGetUrl } from "fumadocs-core/source";
import { SITE_ORIGIN } from "#/lib/site";

export const DOCS_ROUTE = "/docs";

/** Where the page's source lives, for "Edit on GitHub" and "Report a problem". */
export const REPO = {
	url: "https://github.com/ashwinarora/hl-tools",
	branch: "main",
	contentDir: "content/docs",
} as const;

const docsUrl = createGetUrl(DOCS_ROUTE);

/** The Markdown copy of a page: `/docs/index.md` for the docs' home. */
export function markdownUrl(slugs: readonly string[]): string {
	const segments = [...slugs];
	if (segments.length === 0) segments.push("index.md");
	else segments[segments.length - 1] += ".md";
	return docsUrl(segments);
}

/** The page's slugs from a Markdown copy's path segments. */
export function slugsOfMarkdown(segments: readonly string[]): string[] {
	if (segments.length === 0) return [];
	const out = [...segments];
	out[out.length - 1] = out[out.length - 1].replace(/\.md$/, "");
	if (out.length === 1 && out[0] === "index") out.pop();
	return out;
}

export function absoluteUrl(path: string): string {
	return `${SITE_ORIGIN}${path}`;
}

/** The page's file on GitHub. */
export function sourceUrl(path: string): string {
	return `${REPO.url}/blob/${REPO.branch}/${REPO.contentDir}/${path}`;
}

/** A new GitHub issue about this page, its title filled in. */
export function reportUrl(title: string, pageUrl: string): string {
	const q = new URLSearchParams({
		title: `Docs: ${title}`,
		body: `Page: ${absoluteUrl(pageUrl)}\n\nWhat is wrong or missing:\n`,
	});
	return `${REPO.url}/issues/new?${q}`;
}
