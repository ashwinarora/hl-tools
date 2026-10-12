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
		network?: string;
	} => ({
		treasury: typeof s.treasury === "string" ? s.treasury : undefined,
		supersedes: typeof s.supersedes === "string" ? s.supersedes : undefined,
		kind: typeof s.kind === "string" ? s.kind : undefined,
		// the form's network: without it a reload would take whatever the header holds by then
		network: typeof s.network === "string" ? s.network : undefined,
	}),
	component: ProposePage,
});

function ProposePage() {
	const { treasury, supersedes, kind, network } = Route.useSearch();
	return (
		<ProposeScreen
			treasury={treasury}
			supersedes={supersedes}
			kind={kind}
			network={network}
		/>
	);
}
