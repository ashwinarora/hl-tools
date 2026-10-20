import type { Address, Proposal } from "@hl-tools/core";
import { wouldShutOut } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { Callout } from "#/components/hub/status";
import { sendsBefore } from "../model/send";
import { waitingProposals } from "../model/signerSet";
import { useOpenProposals } from "../relay/openProposals";
import { useRelay } from "../relay/useRelay";
import { useNow } from "../shell/live";
import { useKnownProposals } from "../treasury/useKnownProposals";

/** A proposal still waiting, as this warning names it. */
export interface Waiting {
	readonly digest: string;
	readonly label: string;
	readonly action: { readonly type?: unknown };
}

/** "an older USDC send", "2 older withdrawals", "3 older USDC sends and withdrawals". */
function older(items: readonly Waiting[]): string {
	const withdrawals = items.filter((p) => p.action.type === "withdraw3").length;
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
function Named({ items }: { items: readonly Waiting[] }) {
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
						{p.label}
					</Link>
				</span>
			))}
		</>
	);
}

export interface Older {
	/** Older sends that this one, carried out first, would shut out for good. */
	readonly shutOut: readonly Waiting[];
	/** For a withdrawal: older sends that should go first. */
	readonly before: readonly Waiting[];
	/** The warning's title, or null when there is nothing to say. */
	readonly title: string | null;
}

const NONE: Older = { shutOut: [], before: [], title: null };

/**
 * The older USDC sends this proposal has to respect, worked out once for the
 * page: the notice and the line above the buttons both say what this says.
 * With `enabled` false (a proposal that can no longer be sent) nothing is read.
 */
export function useOlderSends(proposal: Proposal, enabled: boolean): Older {
	const relay = useRelay();
	const now = useNow();
	const { network, multiSigUser, action } = proposal.payload;
	// signed in, the hl-tools server's list holds what the co-signers shared;
	// otherwise this browser's own proposals, as the propose form reads them
	const signedIn = relay.mode === "on";
	const open = useOpenProposals();
	const known = useKnownProposals(
		network,
		multiSigUser as Address,
		enabled && !signedIn,
	);
	if (!enabled) return NONE;
	const items: Waiting[] = signedIn
		? open.items
				.filter(
					(p) =>
						p.open &&
						!p.stuck &&
						!p.frozen &&
						p.network === network &&
						p.treasury === multiSigUser,
				)
				.map((p) => ({
					digest: p.digest,
					label: p.title ?? p.line,
					action: p.proposal.payload.action,
				}))
		: waitingProposals(known.proposals, now).map((k) => ({
				digest: k.digest,
				label: k.title,
				action: k.action as Waiting["action"],
			}));
	const waiting = items
		.filter((p) => p.digest !== proposal.digest)
		.map((item) => ({ action: item.action, item }));
	const shutOut = wouldShutOut(action, waiting).map((x) => x.item);
	const before = sendsBefore(action, waiting).map((x) => x.item);
	const title =
		shutOut.length > 0
			? `Sending this first shuts out ${older(shutOut)}`
			: before.length > 0
				? before.length === 1
					? "An older USDC send is still waiting"
					: `${before.length} older USDC sends are still waiting`
				: null;
	return { shutOut, before, title };
}

/**
 * Older USDC sends of the treasury still waiting, said to every signer while
 * this proposal can be signed: a send carried out first shuts older sends and
 * withdrawals out for good, and a withdrawal should let older sends go first
 * (what it does to them was not measured). Never folded away. What it says is
 * `useOlderSends`'s, which the page also repeats above its buttons.
 */
export function OlderSends({ older }: { older: Older }) {
	const { shutOut, before, title } = older;
	if (shutOut.length > 0 && title) {
		const one = shutOut.length === 1;
		return (
			<Callout tone="warning" title={title}>
				Hyperliquid takes a treasury's USDC sends, and its withdrawals after
				them, in the order they were proposed. Still waiting from before this
				one: <Named items={shutOut} />. Send {one ? "it" : "them"} first, or{" "}
				{one ? "it" : "they"} will have to be proposed again.
			</Callout>
		);
	}
	if (before.length > 0 && title) {
		const one = before.length === 1;
		return (
			<Callout tone="warning" title={title}>
				This withdrawal is numbered after <Named items={before} />. Send{" "}
				{one ? "it" : "them"} first: whether a withdrawal carried out first
				stops an older send from going through has not been measured.
			</Callout>
		);
	}
	return null;
}
