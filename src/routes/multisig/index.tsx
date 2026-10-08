import { createFileRoute, Link } from "@tanstack/react-router";
import { FileSignature } from "lucide-react";
import { EmptyState } from "#/components/hub/layout";
import { SignerPage } from "#/components/multisig/SignerPage";

export const Route = createFileRoute("/multisig/")({ component: SignerStart });

function SignerStart() {
	return (
		<SignerPage>
			<EmptyState
				icon={FileSignature}
				title="Propose, sign and submit multi-sig actions"
				description="Connect the wallet of a signer to begin. To look at a multi-sig account or check a request without a wallet, use the Multisig Inspector."
				action={
					<Link
						to="/tools/multisig"
						className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface px-3 text-sm hover:bg-surface-2"
					>
						Open the Multisig Inspector
					</Link>
				}
			/>
		</SignerPage>
	);
}
