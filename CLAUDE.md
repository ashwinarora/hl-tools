# CLAUDE.md

Web app that mines Hyperliquid testnet USDC by chaining generated wallets through faucet claims. See README.md for the user-facing flow.

## Commands

```bash
bun install
bun --bun run dev       # port 3000
bun --bun run build
bun --bun run check     # Biome lint + format
bun --bun run test      # vitest
npm run check:no-contact  # NO_CONTACT=true build + check, see below
```

## Stack

TanStack Start (SSR) + Nitro + Vite. File-based routing in `src/routes/` (`routeTree.gen.ts` is generated). Wallet connection via wagmi + RainbowKit + viem. Hyperliquid SDK: `@nktkas/hyperliquid`. State: Zustand + TanStack Query. UI: Tailwind v4 + shadcn/ui in `src/components/ui/`.

Core logic: `src/lib/hlActions.ts` (activate/claim/drain), `src/hooks/useAutoChain.ts` (auto mode), `src/hooks/useWebData.ts`, `src/components/{AutoMode,WalletTable}.tsx`.

## Conventions

Biome (tabs, double quotes). TS strict. Import alias `#/*` → `src/*`.

## No-contact mode

Two deployments build from `main`. The only difference is the build-time variable `NO_CONTACT`: `true` gives a site on which a visitor has no way to contact the owner or find his contact details; unset, or any other value, gives the normal site, which must not change. README "No-contact mode" has the full description. Rules:

- The flag is `NO_CONTACT` from `src/lib/noContact.ts`, a constant that `vite.config.ts` sets at build time. Do not read the environment for it anywhere else, and do not add a second variable.
- Anything that leads to the owner is contact UI and must be gated: email, phone, social profiles, calendar links, his GitHub (this repo included), links to the normal domains of his other sites.
- Gate directly on the constant, in the JSX: `{!NO_CONTACT && (…)}`, or `...(NO_CONTACT ? [] : [item])` in a list. Not CSS, not a runtime check, not a value worked out from the constant: the content must be absent from the client bundle and from the HTML the server returns.
- Remove the words that depend on a link with it, and check the layout still looks intended without them.
- Add every new route to `REQUESTS` in `scripts/check-no-contact.mjs`.
- `ALLOWED` in that script is for strings inside third-party libraries only. One narrow entry each (files, pattern, exact surrounding text) with its reason. Never allow our own code or a whole directory.
- There is no CI. Run `npm run check:no-contact` after any change to UI, head tags, `public/` or dependencies, and say so if it was not run.
