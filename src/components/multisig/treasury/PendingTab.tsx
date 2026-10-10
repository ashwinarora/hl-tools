import type { Address } from "@hl-tools/core";
import { ProposalRows } from "../inbox/ProposalRows";
import type { OpenProposal } from "../relay/openProposals";
import { Help } from "../shell/Help";
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
		<Card
			flush
			footer={
				items.length > 1 ? (
					<span className="inline-flex flex-wrap items-center gap-x-1">
						Finish the oldest first: Hyperliquid takes a treasury's USDC
						payments in the order they were proposed.
						<Help k="sendOrder" />
					</span>
				) : undefined
			}
		>
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
