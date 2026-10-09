import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { InboxScreen } from "#/components/multisig/inbox/InboxScreen";
import { Landing } from "#/components/multisig/inbox/Landing";
import { OpenScreen } from "#/components/multisig/OpenScreen";
import { useRelay } from "#/components/multisig/relay/useRelay";
import { useHandoffStore } from "#/store/handoffStore";

export const Route = createFileRoute("/multisig/")({ component: MultisigHome });

/**
 * The section's front door. With no relay it is the link-and-file screen;
 * with one, the inbox when signed in and the two ways in when not.
 */
function MultisigHome() {
	const relay = useRelay();
	const navigate = useNavigate();
	// A proposal pasted on the home page or sent over from the inspector is opened on the
	// link-and-file screen, whoever is signed in.
	const handed = useHandoffStore((s) => s.pending?.tool === "multisig-sign");
	useEffect(() => {
		if (handed && relay.mode !== "off") {
			void navigate({ to: "/multisig/open", replace: true });
		}
	}, [handed, relay.mode, navigate]);

	if (relay.mode === "off") return <OpenScreen />;
	if (relay.mode === "on") return <InboxScreen />;
	return <Landing />;
}
