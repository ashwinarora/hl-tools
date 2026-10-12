import type { Address, Policy, Proposal } from "@hl-tools/core";
import { RELAY_COPY } from "../model/relay/copy";
import type { Objection } from "../model/relay/positions";
import { seenBy, seenLabel, type ViewRow } from "../model/relay/views";
import { agoWords, localDateTime, utcDateTime } from "../model/time";
import { Who } from "../names/Names";
import { Help } from "../shell/Help";
import { Card, PersonRow, Pips, Tag } from "../shell/kit";
import { useNow } from "../shell/live";

const NOBODY: readonly Objection[] = [];

/** What the relay knows about who has opened the proposal. */
export interface SeenInfo {
	readonly views: readonly ViewRow[];
	readonly proposer: Address | null;
	readonly createdAt: number | null;
}

/**
 * Who has signed, against the signer set the chain reports now. "Verified"
 * means this browser recovered the signature to that signer; a signature that
 * does not verify is not listed here at all (the details below say why).
 * For a proposal on the relay, a signer who has not signed is shown as having
 * opened it or not: the proposer can tell "has not looked" from "looked".
 * A signer who said no is shown as that: it is their position, like a signature.
 */
export function SignaturesPanel({
	proposal,
	policy,
	counted,
	me,
	closed = false,
	seen = null,
	objected = NOBODY,
	now: given,
}: {
	proposal: Proposal;
	/** The live signer set; null while unknown. */
	policy: Policy | null;
	/** Current signers whose signature verified; null while signatures are being checked. */
	counted: readonly Address[] | null;
	me: Address | null;
	/** Nothing more can be signed (submitted, withdrawn, declined, expired). */
	closed?: boolean;
	/** Null when the relay does not have the proposal: nothing is said about who looked. */
	seen?: SeenInfo | null;
	/** The current signers who said no: an objection, shown on their row. */
	objected?: readonly Objection[];
	/** The page's clock, when the page has one: every age on it is then told alike. */
	now?: number;
}) {
	const ticking = useNow();
	const now = given ?? ticking;
	const finaliser = proposal.payload.outerSigner;
	const signers = policy?.authorizedUsers ?? [];
	const need = policy && policy.threshold > 0 ? policy.threshold : null;
	// signed, but by a wallet the chain no longer lists (removed since, or never a signer)
	const former =
		policy && signers.length > 0
			? proposal.signatures
					.map((x) => x.signer)
					.filter((a) => !signers.includes(a))
			: [];
	return (
		<Card
			title={
				<span className="inline-flex items-center gap-1.5">
					Signatures <Help k="threshold" />
				</span>
			}
			actions={
				need !== null && counted ? (
					<Pips have={counted.length} need={need} />
				) : null
			}
		>
			{signers.length === 0 ? (
				<span className="text-sm text-muted-foreground">
					{policy
						? `This account has no signer set on ${proposal.payload.network}.`
						: "Reading the signer set from Hyperliquid…"}
				</span>
			) : (
				signers.map((a) => {
					const no = objected.find((o) => o.signer === a);
					const label =
						counted === null
							? null
							: seenLabel(
									seenBy(a, {
										counted,
										views: seen?.views ?? null,
										proposer: seen?.proposer ?? null,
										createdAt: seen?.createdAt ?? null,
									}),
									{ closed, now },
								);
					return (
						<PersonRow
							key={a}
							trailing={
								no ? (
									// amber, not red: a no is a position, not a fault
									<Tag
										tone="warn"
										title={`${localDateTime(no.at)} (${utcDateTime(no.at)})`}
									>
										said no · {agoWords(no.at, now)}
									</Tag>
								) : label === null ? (
									<Tag>checking…</Tag>
								) : (
									<Tag
										tone={label.signed ? "ok" : "gray"}
										title={
											label.at === null
												? undefined
												: `${localDateTime(label.at)} (${utcDateTime(label.at)})`
										}
									>
										{label.text}
									</Tag>
								)
							}
						>
							<Who address={a} className="text-[13px]" />{" "}
							{a === me && <Tag tone="you">you</Tag>}{" "}
							{a === finaliser && <Tag>finaliser</Tag>}
						</PersonRow>
					);
				})
			)}
			{seen && !closed && signers.length > 0 && (
				<p className="mt-2.5 text-xs text-subtle-foreground">
					{RELAY_COPY.seenNote} <Help k="seen" />
				</p>
			)}
			{former.length > 0 && (
				<p className="mt-2.5 text-xs text-muted-foreground">
					Also signed by{" "}
					{former.map((a, i) => (
						<span key={a}>
							{i > 0 && ", "}
							<Who address={a} />
						</span>
					))}
					, not in the current signer set:{" "}
					{former.length === 1 ? "it does" : "they do"} not count.
				</p>
			)}
			{policy && signers.length > 0 && !signers.includes(finaliser) && (
				<p className="mt-2.5 text-xs text-warning">
					The finaliser <Who address={finaliser} /> is not in the current signer
					set.
				</p>
			)}
		</Card>
	);
}
