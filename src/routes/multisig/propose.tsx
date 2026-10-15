import { createFileRoute } from "@tanstack/react-router";
import { ProposeScreen } from "#/components/multisig/propose/ProposeScreen";

export const Route = createFileRoute("/multisig/propose")({
	// public identifiers (an account address, the digest of the proposal being
	// replaced) and the kind of action the form opens on: never a payload
	validateSearch: (
		s: Record<string, unknown>,
	): {
		treasury?: string;
		supersedes?: string;
		kind?: string;
		agent?: string;
		vault?: string;
		network?: string;
	} => ({
		treasury: typeof s.treasury === "string" ? s.treasury : undefined,
		supersedes: typeof s.supersedes === "string" ? s.supersedes : undefined,
		kind: typeof s.kind === "string" ? s.kind : undefined,
		// Remove API wallet: the wallet's name as Hyperliquid lists it, which is
		// public; "" is the one approved without a name
		agent: typeof s.agent === "string" ? s.agent : undefined,
		// a vault form: the vault's address, which is public
		vault: typeof s.vault === "string" ? s.vault : undefined,
		// the form's network: without it a reload would take whatever the header holds by then
		network: typeof s.network === "string" ? s.network : undefined,
	}),
	component: ProposePage,
});

function ProposePage() {
	const { treasury, supersedes, kind, agent, vault, network } =
		Route.useSearch();
	return (
		<ProposeScreen
			treasury={treasury}
			supersedes={supersedes}
			kind={kind}
			agent={agent}
			vault={vault}
			network={network}
		/>
	);
}
