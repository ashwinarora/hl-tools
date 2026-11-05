/**
 * The docs' drawings, built from boxes and the site's colours so they follow
 * the theme and stay sharp at any size. Each one is named in a page as
 * `<Diagram name="…" alt="…" />`; `alt` is what a screen reader and the
 * page's Markdown copy say instead.
 */
import { ArrowDown, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

function Box({
	title,
	children,
	tone = "plain",
}: {
	readonly title: ReactNode;
	readonly children?: ReactNode;
	readonly tone?: "plain" | "brand";
}) {
	return (
		<div
			className={`min-w-0 flex-1 rounded-lg border p-3 ${
				tone === "brand"
					? "border-fd-primary/50 bg-fd-primary/10"
					: "border-fd-border bg-fd-card"
			}`}
		>
			<p className="font-medium text-fd-foreground text-sm">{title}</p>
			{children ? (
				<p className="mt-1 text-fd-muted-foreground text-xs leading-relaxed">
					{children}
				</p>
			) : null}
		</div>
	);
}

function Arrow({ label }: { readonly label?: string }) {
	return (
		<div className="flex shrink-0 flex-col items-center justify-center gap-0.5 px-1 text-fd-muted-foreground">
			<ArrowRight className="hidden size-4 sm:block" aria-hidden />
			<ArrowDown className="size-4 sm:hidden" aria-hidden />
			{label ? <span className="text-[11px]">{label}</span> : null}
		</div>
	);
}

function Row({ children }: { readonly children: ReactNode }) {
	return (
		<div className="flex flex-col items-stretch gap-1 sm:flex-row sm:gap-0">
			{children}
		</div>
	);
}

const DIAGRAMS: Record<string, () => ReactNode> = {
	"propose-sign-send": () => (
		<Row>
			<Box title="1. Propose">
				Any signer writes down one action. Nothing moves.
			</Box>
			<Arrow />
			<Box title="2. Sign">
				Signers approve it in their wallets until enough have signed.
			</Box>
			<Arrow />
			<Box title="3. Send to Hyperliquid" tone="brand">
				The finaliser sends it. It is final once Hyperliquid accepts it.
			</Box>
		</Row>
	),
	move: () => (
		<Row>
			<Box title="Step 1">Signed together with step 2.</Box>
			<Arrow label="accepted" />
			<Box title="Step 2" tone="brand">
				Sent only after Hyperliquid accepted step 1.
			</Box>
		</Row>
	),
	balances: () => (
		<div className="grid gap-2 sm:grid-cols-2">
			<Box title="Perps balance">
				USDC that backs trading, and the source of vault deposits and
				withdrawals to Arbitrum.
			</Box>
			<Box title="Spot balance">
				USDC and every other token. HYPE goes to staking from here.
			</Box>
			<Box title="Staking">
				HYPE staked with validators, and HYPE on its way back to spot.
			</Box>
			<Box title="Vaults">
				USDC deposited in HLP or another vault, until it is withdrawn.
			</Box>
		</div>
	),
	"faucet-chain": () => (
		<Row>
			<Box title="Your wallet">
				Sends the first wallet the amount you chose, plus the 1 USDC fee.
			</Box>
			<Arrow />
			<Box title="Each new wallet" tone="brand">
				Claims the testnet faucet, sends the testnet USDC to you, and passes the
				rest of the mainnet USDC on.
			</Box>
			<Arrow />
			<Box title="The last wallet">
				Sends the mainnet USDC that is left back to you.
			</Box>
		</Row>
	),
};

export const DIAGRAM_NAMES = Object.keys(DIAGRAMS);

export function Diagram({
	name,
	alt,
}: {
	readonly name: string;
	readonly alt: string;
}) {
	const draw = DIAGRAMS[name];
	if (!draw) throw new Error(`Unknown diagram: ${name}`);
	return (
		<figure className="not-prose my-6" aria-label={alt}>
			{draw()}
		</figure>
	);
}
