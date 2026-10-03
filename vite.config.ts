import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// No-contact mode. NO_CONTACT is the only variable a deployment sets. It is not
// VITE_-prefixed, so it is passed to the app as a build-time constant here and read
// in src/lib/noContact.ts. See README "No-contact mode".
const NO_CONTACT = process.env.NO_CONTACT === "true";

const config = defineConfig({
	define: {
		__NO_CONTACT__: JSON.stringify(NO_CONTACT),
	},
	plugins: [
		devtools(),
		nitro({ rollupConfig: { external: [/^@sentry\//] } }),
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});

export default config;
