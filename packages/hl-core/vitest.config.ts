import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: [
				"src/multisig/**",
				"src/rules/multisig.ts",
				"src/adapter/explorer.ts",
			],
			// types-only module: nothing to execute
			exclude: ["src/multisig/types.ts"],
			thresholds: {
				lines: 100,
				branches: 100,
				functions: 100,
				statements: 100,
			},
		},
	},
});
