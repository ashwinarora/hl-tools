# CLAUDE.md

Web app that mines Hyperliquid testnet USDC by chaining generated wallets through faucet claims. See README.md for the user-facing flow.

## Commands

```bash
bun install
bun --bun run dev       # port 3000
bun --bun run build
bun --bun run check     # Biome lint + format
bun --bun run test      # vitest
```

## Stack

TanStack Start (SSR) + Nitro + Vite. File-based routing in `src/routes/` (`routeTree.gen.ts` is generated). Wallet connection via wagmi + RainbowKit + viem. Hyperliquid SDK: `@nktkas/hyperliquid`. State: Zustand + TanStack Query. UI: Tailwind v4 + shadcn/ui in `src/components/ui/`.

Core logic: `src/lib/hlActions.ts` (activate/claim/drain), `src/hooks/useAutoChain.ts` (auto mode), `src/hooks/useWebData.ts`, `src/components/{AutoMode,WalletTable}.tsx`.

## Conventions

Biome (tabs, double quotes). TS strict. Import alias `#/*` → `src/*`.
