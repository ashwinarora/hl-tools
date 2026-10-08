import { createFileRoute } from "@tanstack/react-router";
import { HistoryList } from "#/components/multisig/HistoryList";
import { OpenProposal } from "#/components/multisig/OpenProposal";
import { SignerPage } from "#/components/multisig/SignerPage";
import { useNetwork } from "#/store/networkStore";

export const Route = createFileRoute("/multisig/")({ component: SignerStart });

function SignerStart() {
	const network = useNetwork();
	return (
		<SignerPage>
			<div className="grid gap-4 lg:grid-cols-2">
				<OpenProposal />
				<HistoryList network={network} />
			</div>
		</SignerPage>
	);
}
