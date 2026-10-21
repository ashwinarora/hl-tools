import { createFileRoute } from "@tanstack/react-router";
import { GlossaryScreen } from "#/components/multisig/GlossaryScreen";
import { pageHead } from "#/lib/pages";

export const Route = createFileRoute("/multisig/glossary")({
	head: () => pageHead("/multisig/glossary"),
	component: GlossaryScreen,
});
