import type { Address } from "@hl-tools/core";
import { ProposalRows } from "../inbox/ProposalRows";
import type { OpenProposal } from "../relay/openProposals";
import { Card, Empty } from "../shell/kit";

/** A treasury's open proposals, whoever they wait for. */
export function PendingTab({
	items,
	loading,
	me,
	frozen,
}: {
	items: readonly OpenProposal[];
	loading: boolean;
	me: Address;
	frozen: boolean;
}) {
	return (
		<Card flush>
			{items.length > 0 ? (
				<ProposalRows items={items} me={me} />
			) : (
				<Empty>
					{loading
						? "Reading the pending proposals…"
						: frozen
							? "Nothing pending."
							: "Nothing pending. Propose an action and your co-signers will see it at once."}
				</Empty>
			)}
		</Card>
	);
}
