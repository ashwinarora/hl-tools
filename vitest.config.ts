import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Keeping this config separate from vite.config.ts avoids loading the TanStack
// Start / Nitro plugins, whose dev server otherwise keeps Vitest from exiting.
// "app" covers the pure (non-React) modules under src/; UI is verified in the
// browser (TESTING.md).
export default defineConfig({
	test: {
		projects: [
			"packages/*",
			{
				resolve: {
					alias: { "#": fileURLToPath(new URL("./src", import.meta.url)) },
				},
				test: {
					name: "app",
					include: ["src/**/*.test.ts"],
					environment: "node",
				},
			},
		],
	},
});
