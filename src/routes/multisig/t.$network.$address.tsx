import { createFileRoute } from "@tanstack/react-router";
import {
	TREASURY_TABS,
	TreasuryScreen,
	type TreasuryTab,
} from "#/components/multisig/treasury/TreasuryScreen";

export const Route = createFileRoute("/multisig/t/$network/$address")({
	// a network and an account address: public identifiers
	validateSearch: (s: Record<string, unknown>): { tab?: TreasuryTab } => ({
		tab: TREASURY_TABS.includes(s.tab as TreasuryTab)
			? (s.tab as TreasuryTab)
			: undefined,
	}),
	component: TreasuryPage,
});

function TreasuryPage() {
	const { network, address } = Route.useParams();
	const { tab } = Route.useSearch();
	return (
		<TreasuryScreen
			network={network}
			address={address}
			tab={tab ?? "pending"}
		/>
	);
}
