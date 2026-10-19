import { Link, useRouterState } from "@tanstack/react-router";
import { Card, linkButton } from "./kit";
import { ShellPage } from "./ShellPage";

/** Inside the section's frame, for an address under /multisig that is no page. */
export function NotHere() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	return (
		<ShellPage title="There is no page at this address">
			<Card>
				<div className="flex flex-col items-start gap-3">
					<p className="text-sm text-muted-foreground">
						<code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.92em] text-foreground [overflow-wrap:anywhere]">
							{pathname}
						</code>{" "}
						is not a page of the Multisig section. A link to a treasury or a
						proposal may have been cut short when it was copied.
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<Link to="/multisig" className={linkButton}>
							Multisig home
						</Link>
						<Link to="/multisig/open" className={linkButton}>
							Open or start a proposal
						</Link>
					</div>
				</div>
			</Card>
		</ShellPage>
	);
}
