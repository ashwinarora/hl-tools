import { createFileRoute } from "@tanstack/react-router";
import { AddTreasuryScreen } from "#/components/multisig/add/AddTreasuryScreen";

export const Route = createFileRoute("/multisig/add")({
	component: AddTreasuryScreen,
});
