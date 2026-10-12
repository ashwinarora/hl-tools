import type { Address, Network } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { ProposalRows } from "../inbox/ProposalRows";
import { CREATE } from "../model/create";
import { orderMatters } from "../model/relay/inbox";
import type { OpenProposal } from "../relay/openProposals";
import { Help } from "../shell/Help";
import { Card, Empty, linkButton } from "../shell/kit";

/** A treasury's open proposals, whoever they wait for. */
export function PendingTab({
	items,
	loading,
	me,
	frozen,
	first,
	network,
	address,
}: {
	items: readonly OpenProposal[];
	loading: boolean;
	me: Address;
	frozen: boolean;
	/** Nothing was ever proposed for this treasury, as far as the page can read. */
	first: boolean;
	network: Network;
	address: Address;
}) {
	return (
		<Card
			flush
			footer={
				frozen && items.length > 0 ? (
					<span>
						This account is no longer a multi-sig, so these can no longer be
						signed or submitted. They stay listed until their signing window
						closes.
					</span>
				) : orderMatters(items.map((i) => i.proposal.payload.action)) ? (
					<span className="inline-flex flex-wrap items-center gap-x-1">
						Some of these have to go in order: finish the older one first.
						<Help k="sendOrder" />
					</span>
				) : undefined
			}
		>
			{items.length > 0 ? (
				<ProposalRows items={items} me={me} />
			) : (
				<Empty>
					{loading ? (
						"Reading the pending proposals…"
					) : frozen ? (
						"Nothing pending."
					) : first ? (
						<>
							Nothing has been proposed for this treasury yet.
							<span className="mt-3 block">
								<Link
									to="/multisig/propose"
									search={{ treasury: address, network }}
									className={linkButton}
								>
									{CREATE.firstProposal}
								</Link>
							</span>
						</>
					) : (
						"Nothing pending. Propose an action and your co-signers will see it at once."
					)}
				</Empty>
			)}
		</Card>
	);
}
