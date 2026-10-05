# CLAUDE.md

Hyperliquid developer tooling hub: read-only diagnostic tools (asset resolver, signing inspector, CoreWriter workbench, cross-layer trace, order composer/explainer, WebSocket workbench, RPC probe) on one protocol core, plus the original testnet faucet miner (the only tool that signs). See README.md for the user-facing overview, DECISIONS.md for why things are built this way, TESTING.md for what was verified.

## Commands

```bash
bun install
bun --bun run dev       # port 3000
bun --bun run build
bun --bun run check     # Biome lint + format
bun --bun run test      # vitest (workspace projects via vitest.config.ts)
```

## Layout

- `packages/hl-core/` (`@hl-tools/core`, consumed as TS source): identifiers, `Decimal`, order-preserving JSON, MsgPack, signing, resolver, CoreWriter codec/precompiles, orders, trace, WS, RPC probe, versioned rules (`src/rules/`). No React. Tests in `test/`, fixtures in `fixtures/`, recorders/generators in `scripts/`.
- `src/routes/`: `index.tsx` (directory + paste box), `changes.tsx`, `tools/*.tsx`, `faucet-miner/` (wallet providers and MSW mocks are scoped to this route). `routeTree.gen.ts` is generated.
- `src/components/hub/`: shared design system (ToolPage, Panel, Callout, CodeBlock, HexView, DiffView…). `src/components/tools/<tool>/`: tool UIs.
- `src/lib/tools.ts`: tool registry (titles, samples, rule sets, primary sources). `src/store/networkStore.ts`: global network (persisted; use `useNetworkHydrated` before acting on it).
- Faucet miner logic: `src/lib/hlActions.ts`, `src/hooks/useAutoChain.ts`, `src/components/{AutoMode,WalletTable}.tsx`.

## Conventions

Biome (tabs, double quotes). TS strict. Import alias `#/*` → `src/*`. Read-only everywhere except the faucet miner; never put pasted payloads in URLs; every fetched result shows its network and observation time. Every browser bug in core logic becomes a fixture or test. When a protocol rule changes, bump its rule set's `version`/`verifiedAt` and changelog.
