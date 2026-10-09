import { useNetwork } from "#/store/networkStore";
import { Card, Empty, NetTag, SignsTag } from "../shell/kit";
import { ShellPage } from "../shell/ShellPage";

/** "Needs you": what waits for the signed-in wallet across its treasuries. */
export function InboxScreen() {
	const network = useNetwork();
	return (
		<ShellPage
			title="Needs you"
			meta={
				<>
					<span>Across all your treasuries on</span>
					<NetTag network={network} />
					<SignsTag />
				</>
			}
		>
			<Card flush>
				<Empty>
					<b className="font-semibold text-foreground">
						Nothing needs you on {network}.
					</b>
					<br />
					New proposals from your co-signers appear here the moment they are
					created.
				</Empty>
			</Card>
		</ShellPage>
	);
}
