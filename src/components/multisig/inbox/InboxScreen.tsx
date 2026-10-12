import type { Address } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
import { useNetwork } from "#/store/networkStore";
import { CREATE } from "../model/create";
import { RELAY_COPY } from "../model/relay/copy";
import { groupInbox, orderMatters } from "../model/relay/inbox";
import { type OpenProposal, useOpenProposals } from "../relay/openProposals";
import { useTreasuries } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { Help } from "../shell/Help";
import {
	Card,
	Empty,
	GroupTitle,
	linkButton,
	NetTag,
	SignsTag,
} from "../shell/kit";
import { ShellPage } from "../shell/ShellPage";
import { useTreasuryNames } from "../treasuryName";
import { AwayNotice } from "./AwayNotice";
import { ProposalRows } from "./ProposalRows";

/**
 * "Needs you": what waits for the signed-in wallet across its treasuries on
 * the header's network, most urgent first. Counted against the relay's copy
 * of each signer list, with every signature verified here first; opening a
 * proposal judges it against the live chain.
 */
export function InboxScreen() {
	const network = useNetwork();
	const relay = useRelay();
	const me = relay.wallet as Address;
	const { items, unverified, loading, issue } = useOpenProposals();
	const { rows: treasuries, loading: loadingTreasuries } = useTreasuries();
	const nameOf = useTreasuryNames();
	const hydrated = usePrefsHydrated();
	const hidden = useMultisigPrefs((s) => s.hidden);

	const shown = items.filter(
		(p) => !(hydrated && hidden.includes(treasuryKey(p.network, p.treasury))),
	);
	const groups = groupInbox(shown, me, network);
	// Oldest first where the reader submits: the kinds Hyperliquid takes only in
	// the order they were proposed are then safe to work down the list.
	const finish = [...groups.finish].sort((a, b) => a.row.nonce - b.row.nonce);
	// said only when it applies: two such actions waiting on one treasury
	const perTreasury = new Map<string, unknown[]>();
	for (const p of finish) {
		const key = treasuryKey(p.network, p.treasury);
		perTreasury.set(key, [
			...(perTreasury.get(key) ?? []),
			p.proposal.payload.action,
		]);
	}
	const ordered = [...perTreasury.values()].some(orderMatters);
	const total =
		groups.finish.length +
		groups.sign.length +
		groups.waiting.length +
		groups.dead.length;
	const name = (p: OpenProposal) => nameOf(p.network, p.treasury);
	const hasTreasuries = treasuries.some((t) => t.network === network);

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
			<div className="flex flex-col gap-4">
				<AwayNotice scope="all" />
				{groups.finish.length > 0 && (
					<section>
						<GroupTitle count={groups.finish.length}>
							Ready for you to finish
							<Help k="inboxFinish" />
						</GroupTitle>
						<Card flush>
							<ProposalRows items={finish} me={me} treasuryName={name} />
						</Card>
						<p className="mx-0.5 mt-1.5 text-xs text-subtle-foreground">
							You were named finaliser on these. One click signs what is left
							and submits.
							{ordered
								? " Some of these have to go in order: finish the older one first."
								: ""}
						</p>
					</section>
				)}
				{groups.sign.length > 0 && (
					<section>
						<GroupTitle count={groups.sign.length}>
							Waiting for your signature
							<Help k="inboxSign" />
						</GroupTitle>
						<Card flush>
							<ProposalRows items={groups.sign} me={me} treasuryName={name} />
						</Card>
					</section>
				)}
				{groups.waiting.length > 0 && (
					<section>
						<GroupTitle count={groups.waiting.length}>
							You signed, waiting on others
							<Help k="inboxWaiting" />
						</GroupTitle>
						<Card flush>
							<ProposalRows
								items={groups.waiting}
								me={me}
								treasuryName={name}
							/>
						</Card>
					</section>
				)}
				{groups.dead.length > 0 && (
					<section>
						<GroupTitle count={groups.dead.length}>
							Cannot be finished
							<Help k="inboxDead" />
						</GroupTitle>
						<Card flush>
							<ProposalRows items={groups.dead} me={me} treasuryName={name} />
						</Card>
						<p className="mx-0.5 mt-1.5 text-xs text-subtle-foreground">
							Hyperliquid would refuse these now, so nothing here needs a
							signature. Open one to see why and to propose it again.
						</p>
					</section>
				)}
				{total === 0 && (
					<Card flush>
						<Empty>
							{loading || loadingTreasuries ? (
								"Reading what your co-signers have proposed…"
							) : issue ? (
								issue.message
							) : hasTreasuries ? (
								<>
									<b className="font-semibold text-foreground">
										Nothing needs you on {network}.
									</b>
									<br />
									New proposals from your co-signers appear here the moment they
									are created.
								</>
							) : (
								<>
									<b className="font-semibold text-foreground">
										No treasuries on {network} yet.
									</b>
									<br />
									Add a multi-sig account you sign for; your co-signers will see
									it too. Or turn this wallet's own account into one.
									<span className="mt-3 flex flex-wrap justify-center gap-2">
										<Link to="/multisig/add" className={linkButton}>
											{RELAY_COPY.addExisting}
										</Link>
										<Link to="/multisig/create" className={linkButton}>
											{CREATE.title}
										</Link>
									</span>
								</>
							)}
						</Empty>
					</Card>
				)}
				{unverified > 0 && (
					<p className="mx-0.5 text-xs text-warning">
						{unverified === 1
							? "1 proposal on the relay does not verify (its document does not match its digest) and is not shown."
							: `${unverified} proposals on the relay do not verify and are not shown.`}
					</p>
				)}
			</div>
		</ShellPage>
	);
}
