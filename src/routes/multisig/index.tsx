import { createFileRoute } from "@tanstack/react-router";
import { OpenScreen } from "#/components/multisig/OpenScreen";

export const Route = createFileRoute("/multisig/")({ component: MultisigHome });

function MultisigHome() {
	return <OpenScreen />;
}
