import { createFileRoute } from "@tanstack/react-router";
import {
	DEFAULT_TREASURY_TAB,
	type TreasuryTab,
	treasuryTab,
} from "#/components/multisig/model/tabs";
import { TreasuryScreen } from "#/components/multisig/treasury/TreasuryScreen";

export const Route = createFileRoute("/multisig/t/$network/$address")({
	// a network and an account address: public identifiers
	validateSearch: (s: Record<string, unknown>): { tab?: TreasuryTab } => ({
		tab: treasuryTab(s.tab),
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
			tab={tab ?? DEFAULT_TREASURY_TAB}
		/>
	);
}
