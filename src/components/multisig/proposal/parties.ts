import type { ActionPartyRole } from "@hl-tools/core";

/** What an address named in an action is to it, as the proposal pages label it. */
export const PARTY: Record<ActionPartyRole, string> = {
	destination: "Destination",
	agent: "API wallet",
	signer: "Signer",
	vault: "Vault",
	subAccount: "Sub-account",
	builder: "Builder",
	validator: "Validator",
	user: "Account",
};
