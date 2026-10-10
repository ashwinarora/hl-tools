import { Link } from "@tanstack/react-router";
import { GithubMark } from "./Header";

export default function Footer() {
	const year = new Date().getFullYear();

	return (
		<footer className="border-t border-border text-muted-foreground">
			<div className="page-wrap flex flex-col gap-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
				<div className="space-y-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="font-mono font-semibold text-foreground">
							hl-tools
						</span>
						<span>Hyperliquid tools &amp; utilities</span>
					</div>
					<p className="text-xs text-subtle-foreground">
						Independent open-source project; not affiliated with Hyperliquid.
						Diagnostics are read-only and run in your browser; the Multisig
						section and the faucet miner sign with your own wallet.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
					<Link to="/changes" className="hover:text-foreground">
						Rule changes
					</Link>
					<Link to="/privacy" className="hover:text-foreground">
						Privacy
					</Link>
					<a
						href="https://github.com/ashwinarora/hl-tools"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 hover:text-foreground"
					>
						<GithubMark className="size-4" />
						GitHub
					</a>
					<p>&copy; {year} hl-tools</p>
				</div>
			</div>
		</footer>
	);
}
