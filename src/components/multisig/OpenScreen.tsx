import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useHandoffStore } from "#/store/handoffStore";
import { useNetwork } from "#/store/networkStore";
import { HistoryList } from "./HistoryList";
import { FirstRun } from "./inbox/FirstRun";
import { CREATE } from "./model/create";
import { START } from "./model/guide";
import { OpenProposal } from "./OpenProposal";
import { useRelay } from "./relay/useRelay";
import { StartProposal } from "./StartProposal";
import { linkButton, NetTag, SignsTag } from "./shell/kit";
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
	// with a relay the wizard is offered to a signed-in wallet, in its list
	const noRelay = useRelay().mode === "off";
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
			actions={
				noRelay ? (
					<>
						<Link
							to="/tools/multisig"
							search={{ view: "account" }}
							className={linkButton}
						>
							{START.lookTitle}
						</Link>
						<Link
							to="/multisig/create"
							search={{ network }}
							className={linkButton}
						>
							{CREATE.title}
						</Link>
					</>
				) : undefined
			}
		>
			{/* a build with no sign-in: this is the start page, so it says how this works */}
			{noRelay && (
				<div className="mb-4">
					<FirstRun sharing={false} />
				</div>
			)}
			{/* the two ways in side by side, what this browser keeps across the page under them */}
			<div className="grid items-start gap-4 lg:grid-cols-2 xl:gap-5">
				<StartProposal wallet={address} />
				<OpenProposal handed={handed} />
				<div className="min-w-0 lg:col-span-2">
					<HistoryList network={network} />
				</div>
			</div>
		</ShellPage>
	);
}
