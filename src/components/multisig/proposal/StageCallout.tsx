import type { ReactNode } from "react";
import { Callout, type Tone } from "#/components/hub/status";
import type { HelpKey } from "../model/help";
import type { Phase, Stage } from "../model/stage";
import { Sentence } from "../names/Sentence";
import { Help } from "../shell/Help";

const TONE: Record<Phase, Tone> = {
	judging: "neutral",
	collecting: "info",
	ready: "success",
	submitted: "success",
	"carried-out": "success",
	closed: "neutral",
	stuck: "warning",
	overtaken: "warning",
	withdrawn: "neutral",
	declined: "neutral",
	"not-yet-valid": "info",
	expired: "danger",
	"not-multisig": "danger",
	unknown: "unknown",
	unsupported: "warning",
};

/** The term a stage's sentence leans on, explained by the mark after it. */
const TERM: Partial<Record<Phase, HelpKey>> = {
	collecting: "signingWindow",
	ready: "signingWindow",
	"not-yet-valid": "signingWindow",
	expired: "signingWindow",
	"carried-out": "outside",
	overtaken: "sendOrder",
	stuck: "finaliser",
};

/** Where the proposal stands, in one sentence, at the top of the page. */
export function StageCallout({
	stage,
	action,
}: {
	stage: Stage;
	action?: ReactNode;
}) {
	return (
		<Callout
			tone={TONE[stage.phase]}
			title={<Sentence parts={stage.headlineParts} />}
			action={action}
		>
			<Sentence parts={stage.detailParts} />
			{TERM[stage.phase] && (
				<>
					{" "}
					<Help k={TERM[stage.phase] as HelpKey} />
				</>
			)}
		</Callout>
	);
}
