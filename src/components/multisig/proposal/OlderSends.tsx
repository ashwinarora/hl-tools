import { type Proposal, wouldShutOut } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { Callout } from "#/components/hub/status";
import { sendsBefore } from "../model/send";
import { type OpenProposal, useOpenProposals } from "../relay/openProposals";

/** "an older USDC send", "2 older withdrawals", "3 older USDC sends and withdrawals". */
function older(items: readonly OpenProposal[]): string {
	const withdrawals = items.filter(
		(p) => p.proposal.payload.action.type === "withdraw3",
	).length;
	const noun =
		withdrawals === 0
			? "USDC send"
			: withdrawals === items.length
				? "withdrawal"
				: null;
	if (items.length === 1) return `an older ${noun ?? "USDC send"}`;
	return noun
		? `${items.length} older ${noun}s`
		: `${items.length} older USDC sends and withdrawals`;
}

/** The proposals named, each a link to its page. */
function Named({ items }: { items: readonly OpenProposal[] }) {
	return (
		<>
			{items.map((p, i) => (
				<span key={p.digest}>
					{i > 0 && ", "}
					<Link
						to="/multisig/proposal"
						search={{ digest: p.digest }}
						className="underline underline-offset-2"
					>
						{p.title ?? p.line}
					</Link>
				</span>
			))}
		</>
	);
}

/**
 * Older USDC sends of the treasury still waiting, said to every signer while
 * this proposal can be signed: a send carried out first shuts older sends and
 * withdrawals out for good, and a withdrawal should let older sends go first
 * (what it does to them was not measured). Never folded away.
 */
export function OlderSends({ proposal }: { proposal: Proposal }) {
	const open = useOpenProposals();
	const { network, multiSigUser, action } = proposal.payload;
	const waiting = open.items
		.filter(
			(p) =>
				p.open &&
				!p.stuck &&
				!p.frozen &&
				p.network === network &&
				p.treasury === multiSigUser &&
				p.digest !== proposal.digest,
		)
		.map((p) => ({ action: p.proposal.payload.action, item: p }));
	const shutOut = wouldShutOut(action, waiting).map((x) => x.item);
	const before = sendsBefore(action, waiting).map((x) => x.item);
	if (shutOut.length > 0) {
		const one = shutOut.length === 1;
		return (
			<Callout
				tone="warning"
				title={`Sending this first shuts out ${older(shutOut)}`}
			>
				Hyperliquid takes a treasury's USDC sends, and its withdrawals after
				them, in the order they were proposed. Still waiting from before this
				one: <Named items={shutOut} />. Send {one ? "it" : "them"} first, or{" "}
				{one ? "it" : "they"} will have to be proposed again.
			</Callout>
		);
	}
	if (before.length > 0) {
		const one = before.length === 1;
		return (
			<Callout
				tone="warning"
				title={
					one
						? "An older USDC send is still waiting"
						: `${before.length} older USDC sends are still waiting`
				}
			>
				This withdrawal is numbered after <Named items={before} />. Send{" "}
				{one ? "it" : "them"} first: whether a withdrawal carried out first
				stops an older send from going through has not been measured.
			</Callout>
		);
	}
	return null;
}
