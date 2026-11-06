import {
	agentNameParts,
	isAgentRemoval,
	type Network,
	type PlainObject,
} from "@hl-tools/core";
import { ExternalLink } from "lucide-react";
import {
	ASHDEX,
	ashdexOrigin,
	ashdexTreasuryLink,
	isAshdexName,
} from "../model/ashdex";
import { Card, linkButton } from "../shell/kit";

/**
 * An approval Ashdex asked for, once Hyperliquid has it: where to trade with
 * that API wallet. Null for anything else, or in a build that names no Ashdex.
 */
export function AshdexCard({
	action,
	network,
	treasury,
}: {
	action: PlainObject;
	network: Network;
	treasury: string;
}) {
	const origin = ashdexOrigin(network);
	if (!origin || action.type !== "approveAgent" || isAgentRemoval(action))
		return null;
	const name =
		typeof action.agentName === "string"
			? agentNameParts(action.agentName).name
			: "";
	const agent =
		typeof action.agentAddress === "string" ? action.agentAddress : "";
	if (!isAshdexName(name) || !agent) return null;
	return (
		<Card title="Trade with it">
			<p className="text-[13px] text-muted-foreground">{ASHDEX.approved}</p>
			<a
				href={ashdexTreasuryLink(origin, { network, treasury, agent })}
				target="_blank"
				rel="noopener noreferrer"
				className={`${linkButton} mt-3`}
			>
				{ASHDEX.trade}
				<ExternalLink className="size-3.5" aria-hidden />
			</a>
		</Card>
	);
}
