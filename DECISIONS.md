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

**Sharing uses the URL fragment, behind an explicit confirmation.** The Signing Inspector and the failure explainer can share their input, but only after the user ticks "this content is public". The state goes into `#share=<base64url>`, which browsers never send to the server or in `Referer`, and it is stripped from the address bar as soon as the receiving page has read it. Samples use `?sample=<id>` instead, which names a built-in sample and carries no content.

**"Try with a sample" always shows a result.** A sample that only prefilled inputs made two tools look empty on arrival, so the RPC probe runs its sample comparison and the WebSocket Workbench connects on arrival. Both are bounded, read-only and public. Samples that carry a network (the testnet `usdSend` vector, testnet trace hashes) switch the global network *after* the stored preference has been restored, so the preference cannot override them a moment later.

**`useNetworkHydrated` rehydrates its own store.** Sample logic waits for the persisted network. Relying only on the root layout's `rehydrate()` call proved fragile: during server rendering zustand attaches no `persist` API at all (localStorage is unavailable), which crashed SSR, and in development Vite can load a second copy of the store module after a hot update, so the listener never fired. The hook now tolerates a missing API and calls `rehydrate()` itself; it's an idempotent localStorage read.

**Radio groups follow the WAI-ARIA pattern.** The network switch and every segmented control are button-based radio groups (to keep the segmented styling); arrow keys, Home and End move the selection and only the checked option is a tab stop. Shared in `src/lib/radioGroup.ts`.

**The faucet miner keeps its behaviour and adopts the shell.** Its logic is unchanged. Only presentation moved: hub `ToolPage` header with the same verified-date/source block, a warning callout stating it is the one tool that signs, theme tokens instead of hard-coded amber/red text, and RainbowKit's button only once a wallet is connected (the landing hero already offers Connect Wallet). The old `/how-to-use` URL 301-redirects to `/faucet-miner/how-to-use`.

**Template leftovers removed.** The initial TanStack Start template shipped a public `POST /mcp` route with an `addTodo` demo that wrote `mcp-todos.json` to disk. It had nothing to do with the product and was a writable endpoint on a public site, so it was deleted with its dependencies (`@modelcontextprotocol/sdk`, `zod`).

## Tools

**Signing Inspector samples are generated from the Python SDK vectors.** `scripts/gen_signing_samples.py` turns vectors into full request bodies (`src/samples/signing.ts`), so every sample's signature really recovers to the SDK's public test address and a sample can never drift from what the tests check. The inspector has no private-key field; it only hashes and recovers.

**Compare mode reports the first divergent byte, not just a text diff.** Two payloads that look identical as JSON can hash differently (`"100"` vs `"100.0"`, key order). The compare view encodes both with byte spans and names the field containing the first differing byte, then shows the JSON diff for context.

**The Signing Inspector hands multisig envelopes to the multisig module.** Detected `multiSig` payloads get an explicit diagnostic pointing at `envelopeDigest` / `classifySignatures` (and, from Phase 1, the Multisig Inspector) instead of a wrong hash. The inspector itself still hashes single-signer actions only.

**CoreWriter decoding never guesses.** An unknown version byte, an undefined action id and malformed ABI data each produce their own explicit result (`unknown-version`, `unknown-action`, `malformed`). The body of an unknown version is not decoded. The builder refuses human inputs that are not exactly representable at the action's scale (e.g. `limitPx` with more than 8 decimals) rather than truncating.

**Trace conclusions carry evidence labels.** Each link is `observed` (read from the chain or info API), `inferred` (derived by a stated rule, e.g. matching an order without cloid by coin/side/price/size/time) or `unknown`. A cloid makes a limit order observable via `orderStatus`; without one the match is inferred and labelled so. Limit orders, `usdClassTransfer` and `sendAsset`/`spotSend` are traced; other decoded actions say "trace not supported for this action yet". A hash that isn't on the selected network is looked up on the other network and reported, but the tool never switches networks on its own.

**Trace timing is reported with its resolution.** HyperEVM block timestamps are whole seconds, so "+0.437 s after the block" carries a "(block time has 1 s resolution)" caveat.

**The composer never rounds user input.** An invalid price or size blocks the payload and offers the nearest valid values in each direction with the delta; the user picks one. A positive size that rounds to zero lots is a prominent blocking error. Values the composer derives itself (market price = mid ± slippage) are rounded in the conservative direction (buys down, sells up) and the rounding is shown. Sizes and prices are `Decimal` end to end; prefills from live mids never pass through floats.

**The failure explainer treats `"status":"ok"` as the start, not the answer.** A batch response is explained per status entry, a single error for a multi-order request is flagged as a whole-batch pre-validation rejection, and a truncated response is reported as malformed JSON rather than matched against the error catalogue.

**WebSocket reconnect analysis is honest about what the protocol allows.** No Hyperliquid channel has sequence numbers or a resume cursor (stated per channel in the ordering table). After a simulated disconnect the workbench diffs state before and after; for `trades` it compares the re-subscribe replay with REST `recentTrades` to count what was missed. That `trades` replays recent trades on subscribe without an `isSnapshot` flag was found while testing and encoded in websocket rules 1.1.0.

**Recorded sessions are bounded and sanitised.** Recording stops at 5,000 messages, 8 MB or 30 minutes; IndexedDB keeps the 20 newest sessions. Exports replace every address with a stable pseudonym (`0x000…0001`, …) and imports are strictly validated (format, version, monotonic timestamps) with a specific reason on rejection.

**The RPC probe decides "historical" with exact controls.** Comparing a historical answer with the latest one only shows they differ. The probe uses a nonce oracle instead: a transaction from X with nonce n in block B proves X's nonce at B−1 was exactly n. It also checks that a well-known contract (USDC) has no code at block 1000. Public HyperEVM RPCs failed both on 2026-09-28 (they answer historical queries with latest state) and are flagged. dRPC passed.

**The probe is bounded, paced and runs `eth_getLogs` last.** Around 25 requests, 250 ms apart, for the public endpoint's 100 requests/minute limit. Large log ranges exhausted the public testnet limit for the checks after them, so the range probe now runs last. A rate-limited check is reported as "inconclusive · rate limited", never as unsupported. Endpoint URLs are shown redacted (`?apikey=•••`) and are never persisted or put in the page URL; a CORS-blocked endpoint aborts with an explanation.

**The resolver surfaces wrapped assets by substring, below exact matches.** Spot BTC on Hyperliquid is the token `UBTC`, so an exact-name resolver showed no spot market for "BTC". Queries of three or more alphanumerics now also match perps, spot bases and tokens whose name *contains* the query, labelled "name contains the query" and ranked below every exact match. Pair queries (`UBTC/USDC`) and dex-prefixed queries never use it. Delisted markets always sort after live ones regardless of score.

**Composer intents are listed simplest first and IOC is the default.** The TP/SL brackets were first because they are the richest demo, but a first-time user meets the most complex payload first. Order is now IOC → post-only → market → reduce-only close → long TP/SL → short TP/SL.

**The limit price shows its relation to the live mid.** Whether an IOC fills or a post-only is rejected depends on where the price sits against the mid, so the price field's hint states the mid, the percentage distance and "would take" / "would rest" (amber when it would take), with a Use-mid shortcut. The mid is informational; the composer still never changes a typed price.

**Format/Minify in the Signing Inspector go through the order-preserving parser.** `JSON.parse` + `JSON.stringify` would reorder integer-like keys and rewrite `1.0` as `1`, changing the bytes hashed. `parseJson` → `stringifyJson` keeps key order and number lexemes, so reformatting is guaranteed not to change the digest (verified: digest identical before and after).

**Precompile index parameters can be filled by name.** Nobody knows HYPE is token 150 or perp 159. Each perp/spot/token/asset parameter has a name search backed by the resolver, filtered to the identities that parameter accepts, showing the index each option maps to. The numeric field stays editable and the "resolves to" line confirms the mapping.

**Decoded precompile output is the headline; the raw JSON-RPC is collapsed.** A user read the hex `result` in the raw block and concluded the output wasn't human-readable, even though the decoded table sat above it. The table now has a title and field/raw/human headers, and the raw exchange is behind a disclosure.

**The faucet miner is a regular directory card plus a header link.** It was in a separate "Also in the hub" section to mark it as the one tool that signs; the owner found that read as second-class. It now sits in the main grid with its "Signs & sends" badge and has a direct header link.

**Similar names are suggestions, not candidates: they never make a query ambiguous.** After substring matching was added, "HYPE" reported 16 ambiguous identities, 9 of which were KHYPE, STHYPE and friends; the count alarmed more than it informed. The resolver now exposes `isSimilarMatch` and computes `ambiguous` over direct matches only. The UI lists direct matches first, then a "Similar names" section, and the market picker does the same; "BTC" is still ambiguous (the perp plus HIP-3 BTC markets), "ETH" plus its six look-alikes is not. A query with no direct match says so instead of pretending the look-alikes are matches.

**"Use mid" writes a valid price, rounded towards the resting side.** Mids carry more significant figures than an order may (84654.5 on BTC), so inserting the mid verbatim produced an immediately blocked payload. The shortcut rounds to the market's tick, down for buys and up for sells, so the inserted price never crosses the mid just by rounding. This is the one place the composer rounds, and it is a button the user presses, not a typed value.

**The signing verdict never promises a digest that doesn't exist.** A bare action without a nonce showed "the digest below is what a wallet would sign" above an empty pipeline. The verdict now says what is missing, and the nonce field offers "Use now" (the current millisecond timestamp, as a client would send) so a pasted action can be walked through without inventing a number.

**Modes and public identifiers live in the URL; payloads never do.** CoreWriter and Orders keep their tab in `?tab=`, and a trace keeps its transaction hash in `?tx=`, so a reload or a shared link lands on the same view. Pasted bytes, responses and signatures still travel only through the in-memory handoff or an explicit Share link.

**Index fields in the CoreWriter builder are searchable by name**, with the same resolver-backed search the precompile panel uses; it moved to `components/hub/IndexSearch` so both share one implementation.

**Unknown paths get a real page.** TanStack's default not-found component rendered a bare "Not Found" inside the shell; the hub now renders its own page listing every tool.

**The resolver teaches the vocabulary, not just the answer.** Hyperliquid has five identifier families that overlap in one text box (coin string, action asset ID, display symbol, token, outcome encoding), and the page used to show the result without naming any of them. `classifyQuery` in the core names the shape of what was typed from its syntax alone, before any network call, so `@107`, `#83061`, `100083061` and a bare `150` each get a one-line explanation and the spellings that follow from the input itself. The identity card is a "spelling · value · used in" table from `identitySpellings`, with the API word first (`exchange a`, `spotSend / sendAsset`) and plain words on hover. A "Same asset elsewhere" row from `relatedIdentities` lets the user hop perp → spot → token in place, and the legend at the bottom of the page holds the whole model with live examples. A separate glossary page was rejected: the confusion happens while resolving, so the explanation has to sit next to the result.

**Settled outcomes are looked up, not reported as missing.** `outcomeMeta` lists only live outcomes; a 60-second BTC binary that settled is gone from it, and so are its book, mids and candles. The API keeps the spec and result behind `settledOutcome`, so an outcome-shaped query (`#…`, `+…`, `100000000 + …`) that has no live match falls back to it and shows both sides with their payout per share, stamped with network and observation time and a "settled" badge. A live or unknown outcome returns null from that endpoint, and the page says "neither live nor settled" rather than "nothing found". Verified against mainnet outcome 8306 (recorded as a fixture).

**Search params are kept as the strings they were typed.** TanStack Router's default codec JSON-parses each value, so `?q=100083061` reached the route as a number, failed its string check and was dropped; once accepted it was re-serialised as `?q=%22100083061%22`. The router now parses values as-is and never quotes strings. Every search param in the app is a string, and the faucet miner reads its `?mock=1` through `URLSearchParams` directly, so it is unaffected.

**EVM → Core token transfers are verified, not just counted.** A contract that pays out through Circle's `CoreDepositWallet.depositFor` never touches CoreWriter: the only EVM evidence is a `Transfer(from, to = system address, value)` log from the token's linked contract, and HyperCore credits the `from` address, which is neither the transaction sender nor the calling contract. On testnet such transfers can be dropped with no error on either side, and the page used to show the same output for a credited and a dropped one. The trace now resolves the token from `spotMeta` by the emitting contract (decimals = `weiDecimals + evmExtraWeiDecimals`, system address = `0x20…<index>`), then makes one `userNonFundingLedgerUpdates` query per credited account and matches a `spotTransfer` from the system address with the same token, amount and destination at or after the block. A match is `observed` with the ledger time; no match is `inferred` as "No HyperCore credit observed", downgraded to "Not credited yet" when the block is under a minute old; an unlinked emitter or a failed query is `unknown` with the reason. The page reports whether a credit was observed and never asserts a cause: the protocol does not state one. Native HYPE sent to `0x2222…2222` emits no log and is not detected, which the rule set says. Rule set `evm-core-transfers@1.0.0` carries the sources.

**Reference material is not a finding.** "Why CoreWriter actions fail silently" sat under the verdict of a transaction with no CoreWriter action, and the owner of the game contract read it as a diagnosis of a payout that had in fact succeeded. On such transactions it is now a collapsed reference block that says so in its title, the CoreWriter gas note is only shown when a CoreWriter action exists, and the transfer line in the receipt reads "8 USDC → HyperCore spot of 0x7b67…496e" instead of raw units and the system address.

**Bare addresses route to the Multisig Inspector.** The paste box used to send a 40-hex address to the asset resolver, where it matched nothing. An address is an account, and the inspector answers for every account: a multi-sig gets its signers, a normal user, agent, vault or sub-account gets its role explained. 32-hex token IDs still go to the resolver.

**The Multisig Inspector stores nothing.** Every number is fetched from Hyperliquid when the user looks and stamped with its network and observation time; the only cache is TanStack Query's 10 s. There is no table to drift from the chain, and later phases add storage only for what the chain cannot answer (proposals and signatures that have not been submitted yet).

**One account lookup costs 64 of the 1200 weight per minute; the rest is conditional or on demand.** `userToMultiSigSigners` 20, `extraAgents` 20, `clearinghouseState` 2, `spotClearinghouseState` 2, `openOrders` 20, in one `Promise.allSettled` so a failed section never blanks the others. `userRole` (60) runs only when the address is not a multi-sig, because then the role is the explanation. Per-signer nesting checks (20 each, at most 10), the HyperEVM balance and explorer history (40) are buttons, and the raw-requests panel lists every call with its weight. There is no auto-refresh.

**Explorer history is capped and attributed with a caveat.** `userDetails` on `rpc.hyperliquid(-testnet).xyz/explorer` is CORS-open and returns the newest ~101 entries with no paging, so the panel says "showing the most recent N". The explorer records envelope actions against the multi-sig user without the leader or the signatures, so history can show *what* the account did but never *who* signed; the panel says that too.

**The envelope view takes the network from the payload when the payload carries one.** User-signed inner actions name it in `hyperliquidChain`, so the view pins that network, warns when the header disagrees and fetches the signer set there. L1 payloads carry no network: the header decides, the page says so, and when the multi-sig user does not exist there the view probes the other network and offers a one-click switch instead of reporting "unknown".

**A raw envelope has no claimed signers, so recovery decides.** Proposal documents name each signer; exchange request bodies carry only `{r, s, v}`. The core treats a zero-address claim as "unclaimed": the signature is attributed to whoever it recovers to, and the diagnosis accepts a variant when it recovers to any current authorized user. Found in the browser (every signature of a pasted envelope showed as invalid) and fixed in core with tests, per the hub rule.

**Signatures render as stacked rows, not a table.** Index, recovered address, status and the reason do not fit four columns in a half-width workspace: the address either wrapped one hex pair per line or pushed the reason behind a horizontal scroll. One row per signature with the reason underneath reads at every width.

## Testing

**Browser testing uses the Chrome DevTools MCP.** Viewport emulation (`emulate`) gives exact desktop (1440×900) and mobile (375×812, DPR 2) sizes and light/dark `prefers-color-scheme`. The faucet miner is exercised with the Rabby wallet in that browser; mining itself is only run under the existing MSW mock harness so no real funds move.

**Every browser bug becomes a fixture or a regression test where the logic lives in core.** Examples: `@abc` malformed-prefix note (resolver cases), truncated exchange response (explain cases), rate-limited probe (probe test). Presentation-only bugs are logged in TESTING.md with the fix.

**Committed screenshots come from an isolated browser context at DPR 1.** No wallet is connected and storage is fresh, so no address or balance appears in the repository. DPR 1 keeps full-page mobile captures of long pages small enough to review and to commit.

**The root Vitest config runs the workspace projects** rather than inheriting `vite.config.ts`, whose TanStack Start/Nitro plugins kept the process alive after every run.

**A multi-sig proposal is identified by the digest signers sign, and the document keeps signed and unsigned parts apart.** `packages/hl-core/src/multisig` defines `{ payload, digest, signatures, meta, receipt }`: everything in `payload` (network, multi-sig user, leader, canonical action, nonce, vault address, expiry) is bound into every inner signature; title, note, policy snapshot and receipt are not. The digest is the EIP-712 digest actually signed (Agent struct for L1 actions, enriched `HyperliquidTransaction:*` struct for user-signed ones), so verification is one recovery for both schemes, and `validateProposal` recomputes it on every load. Title and note stay unsigned so the hash matches what the official SDKs produce (verified byte for byte against `@nktkas/hyperliquid` over 3000 random scenarios and against `hyperliquid-python-sdk` 0.24.0 vectors).

**The envelope is built in canonical key order with trimmed inner signatures, never derived from pasted order.** The chain re-serialises inner signatures without leading zero digits before re-hashing the envelope (testnet: an untrimmed inner `r` fails as "Invalid multi-sig outer signer"), so `buildEnvelope` trims and `parseEnvelope` reports untrimmed or reordered input as a warning and normalises it. The envelope's `signatureChainId` is a leader-time choice bound only into the outer signature (the chain accepted `0xa4b1` and `0x1` on testnet), so it lives in the receipt, not in the signed payload.

**Readiness is computed against the *current* signer set, never stored.** A proposal document carries only signatures; `classifySignatures` recovers each one, counts distinct authorized signers against the policy passed in, and a rotation that removes a signer silently un-readies the proposal. A leader outside the signer set is `needs-lookup` (warning), because an API wallet of a signer may lead once the agent address holds a deposit (testnet, 2026-10-07) and only the info API can tell.

**Lab recordings are fixtures.** `fixtures/multisig/lab-envelopes.json` holds the 124 real testnet requests of the multi-sig lab (public data only, extracted by `scripts/extract_lab_envelopes.ts` from the gitignored `labs/multisig/runs`), with the signer policy in force at each. `lab.test.ts` requires every signer to recover to a lab wallet unless the recording deliberately diverged, readiness to predict every threshold/signer rejection, every error string to map to the catalogue, and `diagnoseSignature` to name every injected divergence. The multisig module is held to 100 % line and branch coverage (`vitest.config.ts` thresholds scoped to `src/multisig`).

