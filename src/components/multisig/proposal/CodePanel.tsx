import type { ProposalPayload } from "@hl-tools/core";
import { useMemo } from "react";
import {
	CODE_COPY,
	signingCodeOf,
	signingNetwork,
} from "../model/signingNetwork";
import { Help } from "../shell/Help";
import { Btn } from "../shell/kit";

/**
 * What a signer is told about an action that is signed as a code: the wallet
 * cannot show the action, so the page shows the code the wallet will show,
 * worked out here from the proposal itself, for the signer to compare. When
 * the wallet turned out not to have the signing network, the button that
 * adds it sits here too.
 */
export function CodePanel({
	payload,
	needsNetwork = false,
	busy = false,
	onAdd,
	failed,
}: {
	payload: ProposalPayload;
	/** The wallet answered that it does not have the signing network. */
	needsNetwork?: boolean;
	busy?: boolean;
	onAdd?: () => void;
	/** Why adding the network did not work, in words. */
	failed?: string | null;
}) {
	const code = useMemo(() => signingCodeOf(payload), [payload]);
	if (!code) return null;
	const here = signingNetwork() !== null;
	return (
		<div className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[13px]">
			<p className="flex flex-wrap items-center gap-1 text-muted-foreground">
				<span>{CODE_COPY.intro}</span>
				<Help k="signingCode" />
			</p>
			<p className="mt-1.5 font-mono text-xs [overflow-wrap:anywhere]">
				{code.code}
			</p>
			<p className="mt-1.5 text-muted-foreground">
				{CODE_COPY.check} {CODE_COPY.asShown(code.source)}
			</p>
			<details className="mt-1.5 text-xs text-subtle-foreground">
				<summary className="cursor-pointer">
					A wallet that shows only hashes
				</summary>
				<dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono [overflow-wrap:anywhere]">
					<dt>domain hash</dt>
					<dd>{code.domainHash}</dd>
					<dt>message hash</dt>
					<dd>{code.messageHash}</dd>
				</dl>
			</details>
			{here && needsNetwork && (
				<div className="mt-2.5 border-t border-border pt-2.5">
					<p className="flex flex-wrap items-center gap-1 text-warning">
						<span>{CODE_COPY.missing}</span>
						<Help k="signingNetwork" />
					</p>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<Btn variant="brand" disabled={busy} onClick={onAdd}>
							{busy ? CODE_COPY.adding : CODE_COPY.add}
						</Btn>
					</div>
					{failed && <p className="mt-2 text-danger">{failed}</p>}
				</div>
			)}
		</div>
	);
}
