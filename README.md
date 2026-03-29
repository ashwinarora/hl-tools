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
```

## Disclaimer

hl-tools sends funds directly to Hyperliquid on your behalf. We don't touch or keep any of it. Use at your own discretion.

## License

MIT
