import { Callout } from "#/components/hub/status";

/** Shown at the top of every signer screen: this section is not read-only. */
export function SignerCallout({ className }: { className?: string }) {
	return (
		<Callout
			tone="warning"
			title="This section signs and sends real transactions"
			className={className}
		>
			Proposals are signed with your wallet and submitted to Hyperliquid from
			this browser. No server holds anything: a proposal travels as a link or a
			file, and every signature is verified locally before anything is sent.
			Rehearse on testnet first.
		</Callout>
	);
}
