import { Link } from "@tanstack/react-router";
import { SOCIAL } from "#/lib/social";
import { cn } from "#/lib/utils";
import { DiscordMark, GithubMark, MULTISIG_WRAP, XMark } from "./Header";

const ICON_LINK =
	"inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-surface-2 hover:text-foreground";

export default function Footer() {
	const year = new Date().getFullYear();
	// as wide as the header on every page
	const wrap = MULTISIG_WRAP;

	return (
		<footer className="border-t border-border text-muted-foreground">
			<div
				className={cn(
					wrap,
					"flex flex-col gap-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between",
				)}
			>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span className="font-mono font-semibold text-foreground">
						hl-tools
					</span>
					<span>Hyperliquid tools &amp; utilities</span>
				</div>
				<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
					<Link
						to="/docs/$"
						params={{ _splat: "" }}
						className="hover:text-foreground"
					>
						Docs
					</Link>
					<Link to="/changes" className="hover:text-foreground">
						Rule changes
					</Link>
					<Link to="/privacy" className="hover:text-foreground">
						Privacy
					</Link>
					<div className="-mx-2 flex items-center gap-1">
						<a
							href={SOCIAL.github}
							target="_blank"
							rel="noopener noreferrer"
							className={ICON_LINK}
							aria-label="GitHub repository"
						>
							<GithubMark className="size-4" />
						</a>
						<a
							href={SOCIAL.discord}
							target="_blank"
							rel="noopener noreferrer"
							className={ICON_LINK}
							aria-label="Discord"
						>
							<DiscordMark className="size-4" />
						</a>
						<a
							href={SOCIAL.x}
							target="_blank"
							rel="noopener noreferrer"
							className={ICON_LINK}
							aria-label="hl-tools on X"
						>
							<XMark className="size-3.5" />
						</a>
					</div>
					<p>&copy; {year} hl-tools</p>
				</div>
			</div>
		</footer>
	);
}
