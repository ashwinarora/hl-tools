import type { Address, Policy, Proposal } from "@hl-tools/core";
import { shortAddress } from "../model/stage";
import { Card, PersonRow, Pips, Tag } from "../shell/kit";

/**
 * Who has signed, against the signer set the chain reports now. "Verified"
 * means this browser recovered the signature to that signer; a signature that
 * does not verify is not listed here at all (the details below say why).
 */
export function SignaturesPanel({
	proposal,
	policy,
	counted,
	me,
	closed = false,
}: {
	proposal: Proposal;
	/** The live signer set; null while unknown. */
	policy: Policy | null;
	/** Current signers whose signature verified; null while signatures are being checked. */
	counted: readonly Address[] | null;
	me: Address | null;
	/** Nothing more can be signed (submitted, withdrawn, declined, expired). */
	closed?: boolean;
}) {
	const finaliser = proposal.payload.outerSigner;
	const signers = policy?.authorizedUsers ?? [];
	const need = policy && policy.threshold > 0 ? policy.threshold : null;
	return (
		<Card
			title="Signatures"
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
					const has = counted?.includes(a) ?? false;
					return (
						<PersonRow
							key={a}
							trailing={
								counted === null ? (
									<Tag>checking…</Tag>
								) : has ? (
									<Tag tone="ok">signed · verified</Tag>
								) : (
									<Tag>{closed ? "did not sign" : "not yet"}</Tag>
								)
							}
						>
							<span className="font-mono text-[13px]" title={a}>
								{shortAddress(a)}
							</span>{" "}
							{a === me && <Tag tone="you">you</Tag>}{" "}
							{a === finaliser && <Tag>finaliser</Tag>}
						</PersonRow>
					);
				})
			)}
			{policy && signers.length > 0 && !signers.includes(finaliser) && (
				<p className="mt-2.5 text-xs text-warning">
					The finaliser {shortAddress(finaliser)} is not in the current signer
					set.
				</p>
			)}
		</Card>
	);
}
