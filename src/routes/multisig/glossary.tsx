import { createFileRoute } from "@tanstack/react-router";
import { GlossaryScreen } from "#/components/multisig/GlossaryScreen";

export const Route = createFileRoute("/multisig/glossary")({
	component: GlossaryScreen,
});
