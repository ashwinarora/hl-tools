import { Card, Empty } from "../shell/kit";

/** A treasury's open proposals. */
export function PendingTab() {
	return (
		<Card flush>
			<Empty>
				Nothing pending. Propose an action and your co-signers will see it at
				once.
			</Empty>
		</Card>
	);
}
