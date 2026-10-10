import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useHandoffStore } from "#/store/handoffStore";
import { useNetwork } from "#/store/networkStore";
import { HistoryList } from "./HistoryList";
import { OpenProposal } from "./OpenProposal";
import { StartProposal } from "./StartProposal";
import { NetTag, SignsTag } from "./shell/kit";
import { ShellPage } from "./shell/ShellPage";
import { useMounted } from "./shell/WalletBox";

/**
 * Proposals as links and files, with no sign-in: start one for a treasury,
 * open one somebody sent, or return to one this browser has seen. Everything
 * here works with no relay at all.
 */
export function OpenScreen() {
	const network = useNetwork();
	const mounted = useMounted();
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
		<ShellPage
			title="Open or start a proposal"
			meta={
				<>
					<span>As a link or a file, on</span>
					{/* the stored network is restored after mount */}
					{mounted && <NetTag network={network} />}
					<SignsTag />
				</>
			}
		>
			<div className="grid gap-4 lg:grid-cols-2">
				<StartProposal wallet={address} />
				<div className="space-y-4">
					<OpenProposal handed={handed} />
					<HistoryList network={network} />
				</div>
			</div>
		</ShellPage>
	);
}
