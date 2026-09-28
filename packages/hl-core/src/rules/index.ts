import { ASSET_ID_RULES } from "./assetIds.ts";
import { COREWRITER_RULES } from "./corewriter.ts";
import { ERROR_RULES } from "./errors.ts";
import { FAUCET_RULES } from "./faucet.ts";
import { HYPEREVM_RULES } from "./hyperevm.ts";
import type { RuleSetMeta } from "./meta.ts";
import { ORDER_RULES } from "./orders.ts";
import { PRECISION_RULES } from "./precision.ts";
import { PRECOMPILE_RULES } from "./precompiles.ts";
import { RATE_LIMIT_RULES } from "./rateLimits.ts";
import { SIGNING_RULES } from "./signing.ts";
import { WEBSOCKET_RULES } from "./websocket.ts";

export * from "./assetIds.ts";
export * from "./corewriter.ts";
export * from "./errors.ts";
export * from "./faucet.ts";
export * from "./hyperevm.ts";
export * from "./meta.ts";
export * from "./orders.ts";
export * from "./precision.ts";
export * from "./precompiles.ts";
export * from "./rateLimits.ts";
export * from "./signing.ts";
export * from "./websocket.ts";

/** Every versioned rule set, in display order. Drives the /changes page. */
export const RULE_REGISTRY: readonly RuleSetMeta[] = [
	ASSET_ID_RULES,
	PRECISION_RULES,
	ORDER_RULES,
	SIGNING_RULES,
	RATE_LIMIT_RULES,
	ERROR_RULES,
	COREWRITER_RULES,
	PRECOMPILE_RULES,
	HYPEREVM_RULES,
	WEBSOCKET_RULES,
	FAUCET_RULES,
];

export function ruleSet(id: string): RuleSetMeta {
	const found = RULE_REGISTRY.find((r) => r.id === id);
	if (!found) throw new Error(`Unknown rule set ${id}`);
	return found;
}
