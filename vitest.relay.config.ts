import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The relay's integration suite: real sign-in, real rows, real pings, against
// the local Supabase stack (`bun run db:start`). Kept out of the default
// `test` run, which stays hermetic.
export default defineConfig({
	resolve: {
		alias: { "#": fileURLToPath(new URL("./src", import.meta.url)) },
	},
	test: {
		name: "relay",
		include: ["src/**/*.itest.ts"],
		environment: "node",
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
