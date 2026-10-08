import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { HistoryList } from "#/components/multisig/HistoryList";
import { OpenProposal } from "#/components/multisig/OpenProposal";
import { SignerPage } from "#/components/multisig/SignerPage";
import { StartProposal } from "#/components/multisig/StartProposal";
import { useHandoffStore } from "#/store/handoffStore";
import { useNetwork } from "#/store/networkStore";

export const Route = createFileRoute("/multisig/")({ component: SignerStart });

function SignerStart() {
	const network = useNetwork();
	const { address } = useAccount();
	const take = useHandoffStore((s) => s.take);
	// A proposal pasted on the home page or sent over from the inspector arrives in memory,
	// never in the URL.
	const [handed, setHanded] = useState<string | null>(null);
	useEffect(() => {
		const value = take("multisig-sign");
		if (value) setHanded(value);
	}, [take]);
	return (
		<SignerPage>
			<div className="grid gap-4 lg:grid-cols-2">
				<StartProposal wallet={address} />
				<div className="space-y-4">
					<OpenProposal handed={handed} />
					<HistoryList network={network} />
				</div>
			</div>
		</SignerPage>
	);
}
