import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { BookOpen } from "lucide-react";
import { Suspense, use } from "react";
import { useMDXComponents } from "#/components/docs/mdx";
import { PageActions } from "#/components/docs/PageActions";
import { docs } from "#/lib/docs/collection";
import { absoluteUrl, markdownUrl } from "#/lib/docs/shared";
import { source } from "#/lib/docs/source";
import { INDEX } from "#/lib/pages";
import { shareMeta } from "#/lib/site";

/**
 * The docs: every page under /docs, from `content/docs`. Rendered on the
 * server for each request (the security policy's nonce is per response, so
 * these pages are not prerendered). Fumadocs' provider is mounted here only,
 * with its theme handling off: the site's own theme script already puts the
 * `dark` class on <html>.
 */
export const Route = createFileRoute("/docs/$")({
	component: Page,
	notFoundComponent: DocsNotFound,
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/").filter(Boolean) ?? [];
		const data = await serverLoader({ data: slugs });
		await docs.getPage(data.path)?.preload();
		return data;
	},
	head: ({ loaderData }) => {
		if (!loaderData) return {};
		const title = docsTitle(loaderData.url, loaderData.title);
		return {
			meta: [
				{ title },
				{ name: "description", content: loaderData.description },
				INDEX,
				...shareMeta({
					title,
					description: loaderData.description,
					path: loaderData.url,
				}),
			],
			links: [{ rel: "canonical", href: absoluteUrl(loaderData.url) }],
		};
	},
});

/** What the part of the docs is about, for a search result's title. */
const SECTIONS: readonly (readonly [string, string])[] = [
	["/docs/multisig", "Hyperliquid Multisig"],
	["/docs/faucet", "Hyperliquid testnet faucet"],
	["/docs/tools", "Hyperliquid developer tools"],
];

function docsTitle(url: string, title: string): string {
	if (url === "/docs")
		return "hl-tools docs: Hyperliquid multisig, testnet faucet and dev tools";
	const section = SECTIONS.find(([prefix]) => url.startsWith(prefix))?.[1];
	return section && !title.includes("Hyperliquid")
		? `${title} · ${section} — hl-tools docs`
		: `${title} — hl-tools docs`;
}

const serverLoader = createServerFn({ method: "GET" })
	.inputValidator((slugs: string[]) => slugs)
	.handler(async ({ data: slugs }) => {
		const page = source.getPage(slugs);
		if (!page) throw notFound();
		return {
			path: page.path,
			url: page.url,
			title: page.data.title,
			description: page.data.description ?? "",
			markdownUrl: markdownUrl(page.slugs),
			pageTree: await source.serializePageTree(source.getPageTree()),
		};
	});

function Content({
	path,
	url,
	markdownUrl,
}: {
	path: string;
	url: string;
	markdownUrl: string;
}) {
	const page = docs.getPage(path);
	if (!page) throw new Error(`unknown page: ${path}`);
	const { toc } = use(page.load());
	const MDX = page.body;
	return (
		<DocsPage toc={toc} tableOfContent={{ style: "clerk" }}>
			<DocsTitle>{page.title}</DocsTitle>
			<DocsDescription>{page.description}</DocsDescription>
			<PageActions
				title={page.title}
				url={url}
				markdownUrl={markdownUrl}
				path={path}
			/>
			<DocsBody>
				<MDX components={useMDXComponents()} />
			</DocsBody>
		</DocsPage>
	);
}

function Page() {
	const data = useFumadocsLoader(Route.useLoaderData());
	return (
		<RootProvider theme={{ enabled: false }}>
			<DocsLayout
				tree={data.pageTree}
				nav={{
					title: (
						<span className="inline-flex items-center gap-2 font-medium">
							<BookOpen className="size-4" aria-hidden />
							Docs
						</span>
					),
					url: "/docs",
				}}
				themeSwitch={{ enabled: false }}
			>
				<Suspense>
					<Content
						path={data.path}
						url={data.url}
						markdownUrl={data.markdownUrl}
					/>
				</Suspense>
			</DocsLayout>
		</RootProvider>
	);
}

/** No Fumadocs component here: this renders outside the docs' provider. */
function DocsNotFound() {
	return (
		<main className="page-wrap pb-16 pt-10 sm:pt-16">
			<div className="mx-auto max-w-xl space-y-4 text-center">
				<h1 className="font-semibold text-xl tracking-tight sm:text-2xl">
					There is no docs page at this address
				</h1>
				<p className="text-muted-foreground text-sm">
					It may have moved. Start from the docs' first page, or search there
					with ⌘K.
				</p>
				<Link
					to="/docs/$"
					params={{ _splat: "" }}
					className="inline-flex rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground text-sm"
				>
					Open the docs
				</Link>
			</div>
		</main>
	);
}
