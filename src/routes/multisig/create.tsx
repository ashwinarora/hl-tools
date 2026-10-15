import { createFileRoute } from "@tanstack/react-router";
import { CreateScreen } from "#/components/multisig/create/CreateScreen";

export const Route = createFileRoute("/multisig/create")({
	// the network the wizard converts on: named in the link, like the propose form's
	validateSearch: (s: Record<string, unknown>): { network?: string } => ({
		network: typeof s.network === "string" ? s.network : undefined,
	}),
	component: CreatePage,
});

function CreatePage() {
	const { network } = Route.useSearch();
	return <CreateScreen network={network} />;
}
