import { defineConfig } from "vitest/config";

// Tests live in the workspace packages. Keeping this config separate from
// vite.config.ts avoids loading the TanStack Start / Nitro plugins, whose dev
// server otherwise keeps Vitest from exiting.
export default defineConfig({
	test: {
		projects: ["packages/*"],
	},
});
