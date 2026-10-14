import type { Network, Proposal } from "@hl-tools/core";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { Callout } from "#/components/hub/status";
import { useRecord } from "../live/useRecord";
import { explorerTxUrl } from "../model/chain/columns";
import type { OnRecord } from "../model/chain/record";
import { recordQuestion } from "../model/chain/record";
import {
	type RecordTone,
	recordLine,
	recordTagOf,
} from "../model/chain/recordCopy";
import { Tag, type TagTone } from "../shell/kit";
import { When } from "../shell/live";

const TAG_TONE: Record<RecordTone, TagTone> = {
	ok: "ok",
	stop: "warn",
	wrong: "danger",
	quiet: "gray",
};

/** A list row's word on Hyperliquid's record, for one proposal or both steps of a move. */
export function RecordTag({
	verdicts,
}: {
	verdicts: readonly (OnRecord | undefined)[];
}) {
	const known = verdicts.filter((v): v is OnRecord => !!v);
	const tag = known.length === verdicts.length ? recordTagOf(known) : null;
	return tag ? <Tag tone={TAG_TONE[tag.tone]}>{tag.text}</Tag> : null;
}

/**
 * Under a proposal that reads as accepted: whether Hyperliquid's record
 * holds its transaction. Loud only when it does not, or says it was refused;
 * those are never folded away.
 */
export function RecordNote({
	network,
	proposal,
}: {
	network: Network;
	proposal: Proposal;
}) {
	const question = useMemo(() => recordQuestion(proposal), [proposal]);
	const record = useRecord(network, question);
	if (!record) return null;
	const line = recordLine(record);
	if (line.tone === "stop")
		return (
			<Callout tone="warning" title="Not on Hyperliquid's record">
				{line.text}
			</Callout>
		);
	if (line.tone === "wrong")
		return (
			<Callout tone="danger" title="Refused on Hyperliquid's record">
				{line.text}
			</Callout>
		);
	const tx =
		record.kind === "found" || record.kind === "likely" ? record : null;
	return (
		<p className="px-0.5 text-xs text-muted-foreground">
			{line.text}
			{tx && (
				<>
					{" "}
					Carried out <When at={tx.time} />.{" "}
					<a
						href={explorerTxUrl(network, tx.hash)}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-0.5 text-brand underline underline-offset-2"
					>
						Transaction
						<ExternalLink className="size-3" aria-hidden />
					</a>
				</>
			)}
			{line.again && (
				<>
					{" "}
					<button
						type="button"
						onClick={record.retry}
						className="text-brand underline underline-offset-2"
					>
						Check again
					</button>
				</>
			)}
		</p>
	);
}
