import type { ReactNode } from "react";
import { Callout, type Tone } from "#/components/hub/status";
import type { Phase, Stage } from "../model/stage";
import { Sentence } from "../names/Sentence";

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
		</Callout>
	);
}
