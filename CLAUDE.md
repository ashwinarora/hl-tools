# CLAUDE.md

Hyperliquid developer tooling hub: read-only diagnostic tools (asset resolver, signing inspector, CoreWriter workbench, cross-layer trace, order composer/explainer, WebSocket workbench, RPC probe, multisig inspector) on one protocol core, plus the two sections that sign with a connected wallet: the multisig signer (`/multisig`: propose, sign, submit native multi-sig actions; with an optional Supabase relay for sign-in, shared treasuries and live proposals) and the original testnet faucet miner. See README.md for the user-facing overview, DECISIONS.md for why things are built this way, TESTING.md for what was verified.

## Commands

```bash
bun install
bun --bun run dev       # port 3000
bun --bun run build
bun --bun run check     # Biome lint + format
bun --bun run test      # vitest: core (packages/*) + app (src/**/*.test.ts) via vitest.config.ts
bun run db:start        # local relay (Supabase CLI + Docker); also db:stop, db:reset
bun run db:test         # pgTAP: supabase/tests/*.sql against the local database
bun run test:relay      # relay client against the local stack (src/**/*.itest.ts)
```

## Layout

- `packages/hl-core/` (`@hl-tools/core`, consumed as TS source): identifiers, `Decimal`, order-preserving JSON, MsgPack, signing, resolver, CoreWriter codec/precompiles, orders, trace, WS, RPC probe, multisig (`src/multisig/`: proposal document, digests, signatures, readiness, envelope, codec, diagnosis), versioned rules (`src/rules/`). No React. Tests in `test/`, fixtures in `fixtures/`, recorders/generators in `scripts/`.
- `src/routes/`: `index.tsx` (directory + paste box), `changes.tsx`, `tools/*.tsx`, `multisig/` (signer: `index` landing or inbox, `open`, `add`, `t.$network.$address`, `propose`, `proposal`; `route.tsx` mounts wallet, relay session and shell), `privacy.tsx` and `faucet-miner/`. The wallet providers are mounted only by those two layouts (`route.tsx`), each with its own wagmi config (`src/lib/wagmiConfig.ts` for the faucet miner, `src/lib/signerWagmiConfig.ts` for the signer); MSW mocks only by the faucet miner. `routeTree.gen.ts` is generated.
- `src/components/hub/`: shared design system (ToolPage, Panel, Callout, CodeBlock, HexView, DiffView…). `src/components/tools/<tool>/`: tool UIs.
- `src/lib/tools.ts`: tool registry (titles, samples, rule sets, primary sources). `src/store/networkStore.ts`: global network (persisted; use `useNetworkHydrated` before acting on it).
- Multisig signer: `src/components/multisig/` (screens and wallet hooks) over `src/components/multisig/model/` (pure and tested, no React: action builders, chain ids, nonce, transport, history, submit, stage; `model/relay/` is the relay's pure half: row parsers, assembling a proposal from rows, what to push, inbox groups, signer comparison, schedules, history sentences, copy). `relay/` is the relay runtime (`client.ts`, `session.ts`, typed reads and writes in `api.ts`, the wallet's channel in `realtime.ts`, `RelayProvider`); screens live in `shell/`, `inbox/`, `treasury/`, `add/`, `proposal/`, `propose/`. It reuses the inspector's review (`src/components/tools/multisig/{useJudgement,EnvelopeView}`); the inspector must never import from it, so the wallet stack stays out of read-only chunks. Shared helpers: `src/lib/idb.ts` (one IndexedDB, stores `wsSessions` and `proposals`), `src/lib/share.ts`, `src/lib/download.ts`. Test keys for app suites: `src/test/keys.ts`.
- `supabase/`: the optional relay. `migrations/` (hand-written SQL: tables with RLS, guards raising `relay.*`, the look-up worker and its queue, live pings, cron), `tests/` (pgTAP, shared helpers in `_helpers.inc`), `config.toml` (local stack). Stores: `src/store/{multisigPrefsStore,walletBusyStore,networkHintStore}.ts`.
- Faucet miner logic: `src/lib/hlActions.ts`, `src/hooks/useAutoChain.ts`, `src/components/{AutoMode,WalletTable}.tsx`.

## Conventions

Biome (tabs, double quotes). TS strict. Import alias `#/*` → `src/*`. Read-only everywhere except the faucet miner and the multisig signer. Signing UIs never hold or generate keys: the connected wallet signs. Never put pasted payloads in URLs; proposal documents travel in the URL fragment, a file or IndexedDB, never in a query string (`?digest=`, `?treasury=` are public identifiers). The signer's pages contact only Hyperliquid and, when someone signs in, the relay: keep RainbowKit's generic WalletConnect wallet out of `src/lib/signerWallets.ts` (its modal reports the page URL to a third party; a test guards this). Every fetched result shows its network and observation time. Every browser bug in core logic becomes a fixture or test. When a protocol rule changes, bump its rule set's `version`/`verifiedAt` and changelog.

Relay: optional at build time (no `VITE_SUPABASE_*` means no sign-in and no supabase-js) and never trusted (the browser verifies every document and signature and judges readiness against the chain). Only `relay/client.ts` imports supabase-js, dynamically; `src/lib/boundaries.test.ts` enforces that and that nothing outside the Multisig section imports `relay/`. Clients insert rows and call no RPC other than `whoami()`; every change to a policy, grant, trigger or guard needs a pgTAP case, and `supabase db advisors --local` stays clean. Sentences about what is stored live in `model/relay/copy.ts` and never say private, encrypted, only you, free or no server. Local stack only: no hosted Supabase project is touched from here. Relay sign-in needs the app opened as `http://localhost:3000`, not `127.0.0.1`. New migrations: `supabase migration new <name> < /dev/null`.
