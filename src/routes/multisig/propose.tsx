import { createFileRoute } from "@tanstack/react-router";
import { ProposeScreen } from "#/components/multisig/propose/ProposeScreen";

export const Route = createFileRoute("/multisig/propose")({
	// both are public identifiers: an account address and the digest of the proposal being replaced
	validateSearch: (
		s: Record<string, unknown>,
	): { treasury?: string; supersedes?: string } => ({
		treasury: typeof s.treasury === "string" ? s.treasury : undefined,
		supersedes: typeof s.supersedes === "string" ? s.supersedes : undefined,
	}),
	component: ProposePage,
});

function ProposePage() {
	const { treasury, supersedes } = Route.useSearch();
	return <ProposeScreen treasury={treasury} supersedes={supersedes} />;
}
