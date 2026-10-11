import { createFileRoute } from "@tanstack/react-router";
import { CreateScreen } from "#/components/multisig/create/CreateScreen";

export const Route = createFileRoute("/multisig/create")({
	component: CreateScreen,
});
