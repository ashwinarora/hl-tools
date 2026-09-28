# Decisions

Non-obvious choices made while turning hl-tools into a developer tooling hub, and why. Newest decisions are appended at the end of each section.

## Architecture

**`@hl-tools/core` is a Bun workspace package consumed as TypeScript source.** `packages/hl-core/package.json` exports `./src/index.ts` directly; Vite and Vitest compile it, so there is no separate build step or `dist/` to go stale. It has its own `tsconfig` (with `noUncheckedIndexedAccess`, stricter than the app) and its own Vitest config.

**Branded identifiers carry the network in the type.** `ActionAssetId<"mainnet">` is not assignable to `ActionAssetId<"testnet">`. Brands are erased at runtime, so every record also keeps a `network` field and `assertNetwork()` re-checks at boundaries. Resolved results are stamped with the network they came from; the UI drops a selection when the global network changes instead of re-interpreting it.

**Exact decimals are a small in-house `Decimal` (bigint mantissa + scale), not a library.** The protocol needs parse, add/sub/mul, divide-with-explicit-rounding, significant-figure and decimal-place rounding, and exact scaling to/from integers (CoreWriter 1e8, USD 1e6). A ~400-line class with exhaustive tests is easier to audit than a general-purpose library, and it refuses floats entirely (`Decimal.fromInteger(0.1)` throws).

**An order- and lexeme-preserving JSON parser sits in front of signing.** `JSON.parse` reorders integer-like keys, turns `1.0` into `1` and truncates integers above 2^53. All three change the MsgPack bytes and therefore the hash, so the Signing Inspector parses pasted payloads with `parseJson`, which keeps key order, raw number lexemes and source offsets (for error positions).

**MsgPack is implemented in core with byte spans.** The SDK's encoder is correct but opaque. hl-core's encoder matches Python `msgpack.packb` (smallest int formats, float64 for non-integers) and records which bytes belong to which field, which the inspector uses for highlighting and for reporting the first divergent field in compare mode. A decoder is included for round-trip tests and for pasting raw bytes.

**Canonical L1 action shapes come from the Python SDK, not from the TS SDK's valibot schemas.** The server re-serialises the action it parsed, so key order, trailing zeros and address case must match what it produces. The TS SDK's schemas silently "fix" inputs and don't model priority grouping (`{"p": n}`), so hl-core keeps its own shape table (`canonical.ts`) that *reports* each difference and can produce the canonical form.

**Signing vectors are generated from the official Python SDK.** `packages/hl-core/scripts/gen_signing_vectors.py` re-derives the SDK's published test vectors (so every field is present, not just r/s/v) and adds vectors for cancel, cancelByCloid, bracket orders with builder + expiresAfter, spot orders, modify, vault orders, usdSend, approveAgent (named/unnamed), approveBuilderFee, usdClassTransfer, sendAsset, spotSend and tokenDelegate, on both networks. The key is the SDK's own public test key; it only exists in that script. All 49 vectors pass byte-for-byte.

**Metadata is normalised by explicit IDs.** Spot pairs and tokens are keyed by their `index` field — on both networks the array position differs from `index` (verified 2026-09-28), so positional lookup silently returns the wrong asset. Perps have no identifier other than their position in a dex's `universe` (the protocol defines the asset ID that way), so the position is read exactly once during normalisation and stored as `perpIndex`. HIP-3 dex indexes come from `perpDexs` and are cross-checked against the `dex:` prefix of the coins in `allPerpMetas`; a dex whose metadata doesn't line up is dropped with a warning rather than guessed.

**The resolver never auto-selects.** Any query with more than one match is flagged ambiguous and the detail panel stays empty until the user picks. "BTC" is ambiguous on mainnet because several HIP-3 dexes list a `BTC` market; "HYPE" matches a perp, five spot pairs, the token and a HIP-3 market. A single match is shown directly.

**Outcome size decimals are shown as "unknown".** `outcomeMeta` does not publish `szDecimals` for outcome tokens. Rather than infer them from the book, the resolver renders a first-class "unknown" value and the example order uses a whole-number size with an explicit warning.

**CoreWriter units were confirmed against live transactions.** A mainnet usdClassTransfer with `ntl = 10000000` produced a ledger `accountClassTransfer` of `"10.0"` USDC (so `ntl` is 1e6-scaled), and a mainnet limit order with `limitPx = 266710000000`, `sz = 500000` and a cloid matched an order at `2667.1` / `0.005` in `historicalOrders` with the same cloid (1e8 scaling; cloid is the link between layers).

## App shell

**Wallet stack only on `/faucet-miner`.** Initially wagmi + RainbowKit + WalletConnect were mounted at the root, so every read-only tool page called web3modal, WalletConnect's `pulse` telemetry endpoint and an Ethereum RPC. That contradicts "nothing leaves the browser / excluded from analytics", so the providers moved into a `/faucet-miner` layout route. Tool pages now contact only the Hyperliquid APIs, the HyperEVM RPCs the user chooses, and Google Fonts. This also fixed a hydration mismatch (RainbowKit's theme `<style>` differed between server and client).

**MSW mock mode is scoped to the faucet miner and stopped on leave.** It used to start from the root when `localStorage.mock === "1"`, which would have silently fed mocked data to every diagnostic tool.

**Network choice is persisted in localStorage and painted before hydration.** An inline script copies the stored network onto `<html data-network>`; the switch's active segment is styled from that attribute, so the correct segment renders on first paint without a hydration mismatch. The Zustand store uses `skipHydration` and rehydrates after mount.

**Pasted input moves between pages through an in-memory store, never the URL.** The homepage "paste anything" box detects the input type locally and hands it to the target tool via a non-persisted Zustand store. Only non-sensitive inputs (asset queries) are mirrored into the URL (`?q=`). Sample buttons use `?sample=<id>`, which references a built-in sample rather than carrying content.

**No analytics.** The app ships no analytics. Inputs that can hold payloads carry `data-private` so any future analytics integration has an explicit exclusion hook.

**TanStack devtools are opt-in in development** (`?devtools=1` or `localStorage.devtools = "1"`) so the floating launcher doesn't cover tool UI in screenshots.

**Typefaces: Geist + Geist Mono** from Google Fonts with system fallbacks. Geist's tabular figures and Geist Mono's clear `0/O` and `1/l` matter for hex and IDs.

**Design tokens.** A cool neutral ramp, one brand accent (mint), and five semantic roles. "Unknown / unsupported" is violet with a dashed border so it can never be mistaken for an error (red) or a warning (amber). Mainnet and testnet have their own colours (green / amber dot) used by every network badge.

## Testing

**Browser testing uses the Chrome DevTools MCP.** Viewport emulation (`emulate`) gives exact desktop (1440×900) and mobile (375×812, DPR 2) sizes and light/dark `prefers-color-scheme`. The faucet miner is exercised with the Rabby wallet in that browser; mining itself is only run under the existing MSW mock harness so no real funds move.
