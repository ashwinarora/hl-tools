# hl-tools

Mine Hyperliquid testnet USDC using automated faucet claims. Generate wallets, activate them with a small amount of mainnet USDC, and receive ~$1,000 testnet USDC per wallet.

## How It Works

Each Hyperliquid wallet can claim ~$1,000 testnet USDC from the faucet, but needs $2 mainnet USDC to activate. hl-tools generates temporary wallets, activates them, claims the faucet, sends the testnet USDC to you, and forwards the mainnet USDC to the next wallet in the chain. You get it all back minus ~$0.02 per wallet in gas.

### Auto Mode (Recommended)

Specify how many wallets (1-50) and the app handles everything. For N wallets:

| | Amount |
|---|---|
| You send | N + 1 USDC |
| You get back (mainnet) | ~N + 1 USDC minus fees |
| You get (testnet) | N x 1,000 USDC |
| Net cost per wallet | ~$0.02 |

**Example**: 5 wallets = send $6, get back ~$5.90 mainnet + $5,000 testnet.

### Manual Mode

Step-by-step control over each wallet: Add Wallet, Activate ($2), Claim Faucet, Drain Testnet, Drain Mainnet. Useful for testing or when you want full control.

## Getting Started

### Prerequisites

- Node.js 22+ or Bun
- A Web3 wallet (MetaMask, Rabby, etc.)
- Mainnet USDC on Hyperliquid

### Setup

```bash
git clone https://github.com/ashwinarora/hl-tools.git
cd hl-tools
bun install
```

Create a `.env` file:

```
VITE_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
```

You can get a WalletConnect project ID from [cloud.walletconnect.com](https://cloud.walletconnect.com/).

### Development

```bash
bun --bun run dev
```

Opens on [http://localhost:3000](http://localhost:3000).

### Production

```bash
bun --bun run build
node .output/server/index.mjs
```

## Tech Stack

- **Framework**: TanStack Start (React 19, SSR, Nitro)
- **Routing**: TanStack Router (file-based)
- **Web3**: wagmi, viem, RainbowKit
- **Hyperliquid**: @nktkas/hyperliquid SDK
- **Styling**: Tailwind CSS v4, shadcn/ui
- **Animations**: motion (Framer Motion)
- **State**: Zustand, TanStack Query
- **Tooling**: Biome (lint/format), Vitest, TypeScript (strict)

## Scripts

```bash
bun --bun run dev        # Dev server
bun --bun run build      # Production build
bun --bun run test       # Run tests
bun --bun run check      # Lint + format check
bun --bun run lint       # Lint only
bun --bun run format     # Format only
npm run check:no-contact # Build with NO_CONTACT=true and check the result (see below)
```

## No-contact mode

This repo builds two deployments from the same branch. The only difference between them is one environment variable:

| `NO_CONTACT` | Deployment | Result |
| --- | --- | --- |
| unset, or anything but `true` | `hltools.tech` | The normal site |
| `true` | `showcase.hltools.tech` | Identical, except a visitor has no way to contact me or find my contact details |

My GitHub profile leads to my contact details, so a link to this repo counts as a way to reach me. In no-contact mode the build has no "Star on GitHub" button in the header, no "View source" link and no "Open source" item at the foot of the landing page, and every page is `noindex, nofollow`. All of it is decided at build time, so the links are absent from the HTML the server returns and from the JavaScript, not just unrendered.

### Where it lives

| File | Role |
| --- | --- |
| `src/lib/noContact.ts` | **The flag.** Exports `NO_CONTACT`. The only place the app learns which deployment it is |
| `vite.config.ts` | Reads `NO_CONTACT` from the environment and hands it to the app as a build-time constant. Vite only passes `VITE_`-prefixed variables to app code; this is what makes one variable enough |
| `src/components/Header.tsx`, `src/components/LandingHero.tsx` | The links that are left out |
| `src/routes/__root.tsx` | Adds the `robots` meta tag |
| `scripts/check-no-contact.mjs` | `npm run check:no-contact` |

### Rules for future changes

1. **Gate contact UI on `NO_CONTACT`, in the JSX**: `{!NO_CONTACT && <a href="…">…</a>}`, or `...(NO_CONTACT ? [] : [item])` in a list. Test the constant itself, not a value worked out from it, a prop or a CSS class: only then does the bundler delete the whole branch.
2. **Anything that leads to me is contact UI**: an email address, a phone number, a social profile, a calendar link, my GitHub (this repo included), and links to the normal domains of my other sites. If one of those sites should be linked in no-contact mode, link its `showcase.` domain.
3. **Take the words that depend on a link out with it**, and check that what remains reads and lays out as if nothing were missing.
4. **Never hard-code this site's origin.** Nothing uses it today. If canonical or Open Graph tags are added, the no-contact build must say `https://showcase.hltools.tech`.
5. **Add every new route to `REQUESTS`** in `scripts/check-no-contact.mjs`, so the page the server returns for it is checked.
6. **Keep the allowlist narrow.** The wallet libraries ship words like "telegram" and "discord" in their own code. Each `ALLOWED` entry names the files, the pattern and the exact surrounding text, and says why it is safe. Never add one for our own code, and never for a whole directory.
7. **Run `npm run check:no-contact` before pushing.** It builds with `NO_CONTACT=true`, then checks every file in `.output/public` and the pages the built server returns for `/`, `/how-to-use`, an unknown path and `/mcp` (it starts the server on a free port from 4811 to 4819 and stops it again). It fails on email addresses, `mailto:`, `tel:`, Calendly, Telegram, WhatsApp, LinkedIn, X/Twitter, Discord, my GitHub, my name, the source links, the normal domains of my sites, and a missing `noindex`. There is no CI in this repo, so this is the check. It reads text, not pixels: an image that shows a link to me is yours to catch.

### Deploying it

Set `NO_CONTACT=true` on the service, next to `VITE_WALLETCONNECT_PROJECT_ID`, and deploy the default branch. Nothing else is required. The value is read when the app is built, so changing it needs a new build, not a restart.

## Disclaimer

hl-tools sends funds directly to Hyperliquid on your behalf. We don't touch or keep any of it. Use at your own discretion.

## License

MIT
