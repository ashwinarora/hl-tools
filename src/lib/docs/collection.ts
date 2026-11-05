/**
 * The docs' pages (`content/docs/**`), compiled by the fumadocs-mdx Vite
 * plugin through its macro: this module is rewritten at build time, so it
 * holds the collection alone (the browser runs it too). The compiler's own
 * options, the docs' remark step among them, are given to the plugin in
 * `vite.config.ts`, so none of that reaches the browser. The loader, search
 * and Markdown copies live in `source.ts`, which only the server imports.
 */
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";

type PageFrontmatter = StandardSchemaV1.InferOutput<typeof pageSchema> & {
	/** Other words a reader may search with: "EIP712", "tick size". */
	readonly keywords?: readonly string[];
};

/**
 * Fumadocs' own frontmatter, plus `keywords` for search. A wrapper rather
 * than `pageSchema.extend`: the zod Fumadocs builds its schema with is not
 * the one this app installs.
 */
const docSchema: StandardSchemaV1<unknown, PageFrontmatter> = {
	"~standard": {
		version: 1,
		vendor: "hl-tools",
		validate(value) {
			const keywords = (value as { keywords?: unknown } | null)?.keywords;
			if (
				keywords !== undefined &&
				!(
					Array.isArray(keywords) &&
					keywords.every((k) => typeof k === "string" && k.trim())
				)
			)
				return {
					issues: [
						{ message: "keywords: a list of words", path: ["keywords"] },
					],
				};
			const add = (
				r: StandardSchemaV1.Result<
					StandardSchemaV1.InferOutput<typeof pageSchema>
				>,
			): StandardSchemaV1.Result<PageFrontmatter> =>
				r.issues ? r : { value: { ...r.value, keywords } };
			const result = pageSchema["~standard"].validate(value);
			return result instanceof Promise ? result.then(add) : add(result);
		},
	},
};

export const docs = defineDocs({
	dir: "content/docs",
	docs: {
		schema: docSchema,
		async: true,
		postprocess: {
			// heading ids would read as noise in a copied page
			includeProcessedMarkdown: { headingIds: false },
		},
	},
});
