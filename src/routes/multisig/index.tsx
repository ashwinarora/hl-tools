import { createFileRoute } from "@tanstack/react-router";
import { useAccount } from "wagmi";
import { HistoryList } from "#/components/multisig/HistoryList";
import { OpenProposal } from "#/components/multisig/OpenProposal";
import { SignerPage } from "#/components/multisig/SignerPage";
import { StartProposal } from "#/components/multisig/StartProposal";
import { useNetwork } from "#/store/networkStore";

export const Route = createFileRoute("/multisig/")({ component: SignerStart });

function SignerStart() {
	const network = useNetwork();
	const { address } = useAccount();
	return (
		<SignerPage>
			<div className="grid gap-4 lg:grid-cols-2">
				<StartProposal wallet={address} />
				<div className="space-y-4">
					<OpenProposal />
					<HistoryList network={network} />
				</div>
			</div>
		</SignerPage>
	);
}
