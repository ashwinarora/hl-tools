import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { remarkDocs } from "./src/lib/docs/remark.ts";

/**
 * The faucet miner's mock (`?mock=1`, development only) runs in a service
 * worker that must be served from the site's root. It lives in `dev/`, not
 * `public/`, so a production build never carries it: the dev server alone
 * serves it.
 */
function devMockWorker(): Plugin {
	return {
		name: "hl-tools:dev-mock-worker",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use("/mockServiceWorker.js", (_req, res) => {
				res.setHeader("content-type", "text/javascript; charset=utf-8");
				res.end(readFileSync("dev/mockServiceWorker.js"));
			});
		},
	};
}

const config = defineConfig({
	resolve: {
		// Fumadocs brings its own lucide-react; one copy for the server and the
		// browser, or the docs' icons render with other class names on each
		// side and React reports a mismatch
		dedupe: ["lucide-react"],
	},
	plugins: [
		// the browser console stays in the browser: the pipe sent every log through the dev server
		devtools({ consolePiping: { enabled: false } }),
		devMockWorker(),
		// the docs (content/docs/*.mdx), compiled before TanStack Start sees them
		fumadocsMdx({
			globalOptions: {
				mdxOptions: {
					remarkPlugins: [remarkDocs],
					// pictures are served from public/ as they are; nothing to import
					remarkImageOptions: false,
					// search indexes a component's text, never the component itself
					remarkStructureOptions: { filterElement: () => false },
				},
			},
		}),
		nitro(),
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});

export default config;
