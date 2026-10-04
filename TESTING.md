# Testing

Browser verification is the acceptance gate. Every tool was exercised end to end in Chrome via the Chrome DevTools MCP against the dev server (`bun --bun run dev`, port 3000): real inputs typed into the real controls, rendered output read back from the DOM, screenshots reviewed. Unit tests (`packages/hl-core`, Vitest) cover the protocol core.

Viewports: desktop 1440×900 (DPR 1) and mobile 375×812 (touch; DPR 2 while testing, DPR 1 for the committed full-page screenshots to keep them small), each in dark and light themes (`prefers-color-scheme` emulation plus the in-app theme setting).

Screenshots from the final regression pass are in [`docs/screenshots/`](docs/screenshots/) and linked per page below.

## Unit tests

```bash
bun --bun run test          # app + core
cd packages/hl-core && bunx vitest run
```

| Suite | What it covers |
|---|---|
| `decimal.test.ts` | Parsing (valid/invalid lexemes, exponents), exact add/sub/mul, divide with each rounding mode, decimal-place and significant-figure rounding, 1e8/1e6 scaling round trips, wire formatting |
| `signing.test.ts` | 49 Python SDK vectors (MsgPack bytes, action hash, EIP-712 digest, recovered signer) on both networks; MsgPack int/float formats vs Python; decoder strictness; order-preserving JSON; inspector diagnostics (key order, trailing zeros, uppercase addresses, `f:false`, network mismatch, multisig out of scope, request-body splitting, short r/s padding) |
| `resolver.test.ts` | Cases in `fixtures/resolver/cases.json` against metadata snapshots of both networks; explicit-index normalisation; HIP-3 dex/meta mismatch rejection; cross-network pairing; snippet pricing |
| `corewriter.test.ts` | Decode fixtures (`fixtures/corewriter/cases.json`: every action id, unknown version, unknown action, malformed bytes); encoding reproduces the real mainnet limit-order bytes; inexact fixed-point input refused; cast/Solidity snippets; precompile input/output codec incl. a dynamic struct; trace replays of five recorded transactions (cloid match, ledger match, inference without cloid, unsupported action, sender with no HyperCore history, not-found with other-network check) |
| `orders.test.ts` | Precision linter fixtures (`fixtures/orders/lint-cases.json`: perp/spot/HIP-3 tick and lot rules, sizes that round to zero); composer (normalTpsl bracket, blocking instead of rounding, explicit rounding options, TP/SL side checks, conservative market price, reduce-only close, minimum notional, builder fee caps, post-only crossing); explainer fixtures (`fixtures/orders/explain-cases.json`) |
| `ws.test.ts` | Subscription building and validation for all 20 channels, each with an ordering statement; recorded mainnet l2Book/trades sessions (dedupe by `(time, tid)`, state diff); session files (consistent address pseudonyms, recording bound, strict import with reasons) |
| `probe.test.ts` | URL redaction; probe against scripted endpoints: honest archive node, node answering historical queries with latest state, network mismatch, rate limiting reported as inconclusive (browser bug 2026-09-28), CORS abort |

253 tests, all passing. `bun --bun run test` runs the workspace projects through a root `vitest.config.ts`.

## 0. Homepage, shell and `/changes`

| Input | Expected | Result |
|---|---|---|
| Paste box: `HYPE` | "Symbol or ID → asset resolver" | ✅ |
| Paste box: tx hash `0x4b65…d949`, Enter | routes to `/tools/trace` and traces it; the hash is handed over in memory and never appears in the URL | ✅ URL stays `/tools/trace` |
| Paste box: 70-byte CoreWriter hex `0x01000002…0f4240` | "Starts with version byte 0x01 → CoreWriter action bytes" | ✅ |
| Paste box: `https://rpc.hyperliquid.xyz/evm` | "URL → RPC capability probe" | ✅ |
| Paste box: exchange response `{"status":"ok","response":{…tick size…}}`, Enter | "Exchange response → failure explainer"; explainer opens with "1 rejected · tick size" | ✅ |
| Paste box: `{"action":{"type":"cancel",…},"nonce":…}` | "Action payload → signing inspector" | ✅ |
| Paste box: `{"method":"subscribe",…}` | "Subscription message → WebSocket workbench" | ✅ |
| Paste box: `Order must have minimum value of $10.` | "Error message → failure explainer" | ✅ |
| Paste box: a long English question | "Not recognised — open a tool below.", Open disabled | ✅ |
| Every "Try with a sample" link (7) | tool opens with a result, not an empty state | ❌ → fixed. RPC and WebSocket samples only prefilled; they now run/connect on arrival. The trace sample could render an empty page (SSR crash in `useNetworkHydrated`) or fill the hash without tracing (hydration event never delivered); both fixed. |
| Server-rendered HTML of all 11 pages (`curl`) | full page content, no "switched to client rendering" | ❌ → fixed (same SSR crash on Signing, CoreWriter, Trace, Composer) |
| Network switch with the keyboard | arrow keys move the selection | ❌ → fixed. Arrow keys did nothing and both options were tab stops; network switch and all segmented controls now follow the WAI-ARIA radio pattern. |
| Reload after choosing testnet | testnet segment painted before hydration, no hydration warning | ✅ |
| `/changes` | 11 rule sets with version, verified date, sources, tools that use them, changelog; timeline sorted by date | ✅ |
| 375px, both themes | no horizontal scroll on any page | ✅ (`scrollWidth − innerWidth = 0` measured on every page) |

## 1. Asset Resolver — `/tools/assets`

| Network | Input | Expected | Result |
|---|---|---|---|
| mainnet | sample (`?sample=hype` → `HYPE`) | 7 identities, flagged ambiguous, nothing selected | ✅ HYPE perp a=159, @107/@207/@232/@255 spot, token 150, hyna:HYPE (delisted HIP-3) |
| mainnet | click `@107` | spot, a=10107 (10000+107), base token 150, szDecimals 2, max px decimals 6, live mid | ✅ matches docs (HYPE mainnet token 150 / spot 107) |
| mainnet | Snippets tab for `@107` | l2Book REST JSON + curl, WS subscribe, post-only example order at valid tick and ≥10 USDC notional | ✅ |
| mainnet | `xyz:TSLA` | single HIP-3 match, 110001 = 100000 + 1×10000 + 1, mid from the xyz dex allMids | ✅ |
| mainnet | `110001`, `150`, `#<outcome>`, token ID `0x0d01…11ec`, `BTC` | numeric decode notes; `150` ambiguous (perp id / spot index / token index); outcome side name; token first for tokenId; BTC ambiguous (HIP-3 BTC markets) | ✅ |
| mainnet | malformed `@abc` | no match + explanation | ❌ → fixed. Initially no explanation. Now "“@” must be followed only by digits…". Fixture added. |
| mainnet | malformed `nope:ABC`, `#12102` | "No perp dex named nope"; "#12102 has side 2; only sides 0 and 1 exist" | ✅ |
| testnet | switch network with `@107` selected | selection cleared, results re-resolved on testnet | ✅ |
| testnet | `HYPE` | token 1105, spot @1035 (a=11035) | ✅ matches docs (testnet token 1105 / spot 1035) |
| testnet | `xyz:TSLA` | exists on testnet as a=750001 (dex 65) | ✅ real cross-network difference surfaced |
| both | reload | network choice persisted, no hydration error | ✅ |
| both | Compare networks for `HYPE/USDC` | @107/10107/token 150 vs @1035/11035/token 1105, differing cells highlighted, decimals equal | ✅ |
| — | network requests from the page | only Hyperliquid API + Google Fonts | ❌ → fixed. wagmi/WalletConnect telemetry and an Ethereum RPC were called from every page; wallet stack moved to `/faucet-miner`. |
| — | 375px light | no horizontal scroll | ✅ after fix: observed-line metadata was truncated with an ellipsis; now wraps |

## 2. Signing Inspector — `/tools/signing`

| Network | Input | Expected | Result |
|---|---|---|---|
| mainnet | sample `order` (`?sample=order`, Python SDK vector, full request body) | L1 family, canonical, 72-byte MsgPack, r/s/v = SDK vector, recovered `0x1479…9325` = expected | ✅ |
| mainnet | sample `approveBuilderFee` via picker | user-signed, `HyperliquidTransaction:ApproveBuilderFee`, domain chainId 421614 (0x66eee), matches expected signer | ✅ |
| mainnet | sample `bracket` (normalTpsl + builder + expiresAfter) | 286-byte MsgPack; preimage segments action/nonce/vault marker/expires marker/expiresAfter | ✅ |
| testnet | own input: `{"type":"cancel","cancels":[{"a":10107,"o":558821730696}]}`, nonce 1790000000000 | connectionId `0x7c59…a490`, digest `0x2fd5…1d33` computed independently with the Python SDK | ✅ exact match |
| mainnet | same + vaultAddress `0xdfc2…f303` + expiresAfter 1790000060000 | Python SDK: connectionId `0xd13f…aa71`, digest `0x9f05…1d9d` | ✅ exact match |
| mainnet | own input: testnet `usdSend` pasted while on mainnet | error "hyperliquidChain Testnet but inspector set to mainnet"; no silent cross-network hashing | ✅ |
| — | malformed JSON `{"type":"order", "orders": [1,2,]}` | "Trailing comma at line 1, column 32" | ✅ |
| — | nonce `12.5` | "Nonce must be a non-negative integer" | ✅ |
| — | signature `0x1234` | "A hex signature must be exactly 65 bytes" | ✅ |
| mainnet | Compare → "trailing zero in price" example | first divergent byte 29 in `orders[0].p` (`0xa3` vs `0xa5`), field diff `"100" → "100.0"`, divergent byte outlined in both hex dumps | ✅ |
| — | diff header count | "1 changed line" | ❌ → fixed. Said "2 changed lines" (counted delete + insert). |
| — | Share | no link until "content is public" is ticked; link uses URL fragment; opening it restores compare mode and both payloads, then strips the fragment | ✅ |
| — | 375px light | no page overflow; hex wraps; code panels scroll internally | ✅ after fix: hex status hint broke mid-word ("encode s."); now wraps at words and says "hover or tap" |

## 3a. CoreWriter Workbench — `/tools/corewriter`

| Network | Input | Expected | Result |
|---|---|---|---|
| mainnet | sample `limit-order` (bytes from tx `0x4b65…d949`) | Limit order v1 id 1: asset 1 → ETH-PERP, limitPx 266710000000 → 2667.1, sz 500000 → 0.005, tif 3 → Ioc, cloid → `0x000001a0…6981`; "delayed" warning; per-field byte colouring | ✅ |
| mainnet | sample usdClassTransfer | ntl 10000000 → 10 USDC, toPerp false | ✅ (matches the ledger's `accountClassTransfer` of 10.0) |
| mainnet | sample sendAsset (Circle CoreDepositWallet) | sourceDex uint32 max → spot, destinationDex 0 → first perp dex, token 0 → USDC, wei 14380000000 → 143.8 USDC | ✅ cross-checked: recipient ledger shows a 143.8 USDC `send` spot → perp 350 ms after the block |
| mainnet | sample unknown version (`0x02…`) | explicit "Unknown encoding version 2", body not decoded | ✅ |
| — | `0x01zz`, `0x0100`, truncated body, action id 14, trailing bytes | non-hex / too short / ABI decode error / undefined action / non-canonical warning | ✅ all five explained |
| mainnet | Build: defaults (ETH, 2667.1, 0.005, Ioc, cloid) | reproduces the real transaction's 228 bytes exactly | ✅ |
| mainnet | Build: limitPx `2667.123456789`, `2667.12345`, asset 99999, spotSend with bad address, spotSend token 150 wei 250000000 | inexact refusal; 5-sig-fig tick error after ÷1e8; unknown asset; address error; 2.5 HYPE | ✅ |
| mainnet | Precompiles: oraclePx(0), spotBalance, l1BlockNumber, coreUserExists | BTC 83139.4 (÷10^(6−5)), live L1 height, `exists true` | ✅ |
| mainnet | Precompiles: tokenInfo(999999) | revert explained ("invalid input … consumes all gas") with raw JSON-RPC error −32003 | ✅ |
| testnet | Precompiles: oraclePx(0) | resolves to SOL (szDecimals 2) → 118.865 via testnet RPC | ✅ |
| — | all 19 precompile layouts | decode against live mainnet (script run during development) | ✅ |

## 3b. Cross-layer Trace — `/tools/trace`

| Network | Input | Expected | Result |
|---|---|---|---|
| mainnet | sample limit order `0x4b65…d949` (with testnet stored as the preference) | switches to mainnet after hydration; order observed by cloid; 6/6 fields match; filled 0.005 @ avg 2653.8; +0.437 s after the block; sender existed | ✅ |
| mainnet | sample usdClassTransfer `0x38ba…0fb3` | ledger accountClassTransfer 10.0 USDC perp → spot, observed | ✅ |
| mainnet | sample sendAsset `0x619a…124f` | ledger `send` 143.8 USDC, dexes match, observed | ✅ |
| testnet | sample limit order without cloid `0xde61…16c9` | matched in historicalOrders by coin/side/px/size/time → **inferred** | ✅ |
| testnet | sample cancel `0x8d20…6158` | decodes; "Trace not supported for this action yet" (unknown) | ✅ |
| mainnet | own: plain tx `0x9890…6a2d` (first tx of block 47107698) | "emitted no CoreWriter actions" | ✅ |
| mainnet | own: testnet hash `0xde61…16c9` | "No transaction on mainnet · It exists on testnet"; network not switched | ✅ |
| — | click "Switch to testnet and trace" | switches explicitly, traces on testnet | ✅ |
| — | switch global network afterwards | banner "This trace ran on testnet; you are now on mainnet"; result stays pinned | ✅ |
| — | own: `0xabab…ab` (nonexistent) | "isn't on the other network either" | ✅ |
| — | malformed `0x1234` | inline hash-format error, Trace disabled | ✅ |
| — | decoded booleans | real booleans | ❌ → fixed: shown as strings "true"/"false" |
| — | delay precision | sub-second delays are relative to a whole-second block timestamp | ❌ → fixed: caveat "(block time has 1 s resolution)" added |
| — | 375px light | vertical flow, no overflow | ✅ |

## 4. Order Composer & Failure Explainer — `/tools/orders`

| Network | Input | Expected | Result |
|---|---|---|---|
| mainnet | sample `tpsl` | BTC perp picked explicitly by the sample; prefilled from live mid (83374.5): 0.00018 BTC @ 81707, TP 90044, SL 78372; normalTpsl payload with reduce-only trigger children; notional 14.707 ≥ 10; sequence diagram | ✅ |
| mainnet | price `81707.5` | blocked (6 sig figs); options ↓81707 (−0.5) / ↑81708 (+0.5); no payload | ✅ |
| mainnet | click ↓81707 | price field set to 81707, payload appears | ✅ |
| mainnet | size `0.000001` | prominent "This size rounds to zero … smaller than one lot (0.00001)" | ✅ |
| mainnet | size `0.0001` | "Notional 8.1707 USDC is below the 10 USDC minimum" | ✅ |
| mainnet | post-only buy at 90000 (above mid) | warning: would immediately match (badAloPx) | ✅ |
| mainnet | market buy | "mid 83380.5 + 5% = 87549.525, rounded down to a valid tick → 87549" | ✅ |
| mainnet | reduce-only close, sell | `b:false`, `r:true`, Ioc at mid − 5% rounded up (79242) | ✅ |
| mainnet | builder fee 150 | "Builder fees are capped at 10 bps (0.1%) on perps" | ✅ |
| testnet | picker `HYPE` | "29 markets match — pick one", nothing composed until picked | ✅ |
| testnet | pick `@1035`, post-only 12.3456789 × 1.5 | spot rule "≤ 6 decimals (8 − szDecimals 2)"; options 12.345 / 12.346 | ✅ |
| — | Explain samples: resting, IOC partial (with request), bracket, tick, unknown signer, HTTP 422, orderStatus reduceOnlyCanceled | resting · partially filled 0.4 of 1 · resting+waiting×2 · rejected (tick) · error (signer-missing) · error (deserialize) · cancelled | ✅ |
| — | own: mixed `[{"error":"Insufficient margin…"},{"filled":{…cloid}}]` | rejected + filled | ✅ |
| — | own: "Order has insufficient spot balance to trade" | rejected (insufficientSpotBalanceRejected) | ✅ |
| — | own: one error for a 3-order request | note: whole batch rejected in pre-validation | ✅ |
| — | malformed request JSON `{"type": "order", "orders": [,]}` | "Unexpected character ',' at line 1, column 30" | ✅ |
| — | malformed response `{"status":"ok",` | reported as malformed JSON | ❌ → fixed. Was explained as an unknown error string. Fixture added. |
| — | 375px light | pre-flight readable | ❌ → fixed. The table hid the size column; now stacked cards below `sm`. |

## 5. WebSocket Workbench — `/tools/websocket`

| Network | Input | Expected | Result |
|---|---|---|---|
| mainnet | sample `l2book` → Connect | ack (server echoes `nSigFigs:null, mantissa:null, fast:false`), first snapshot, live stream, freshness | ✅ |
| mainnet | Simulate disconnect 5 s → Reconnect | state diff before/after (time, bids, asks changed); "snapshot channel: nothing to backfill" | ✅ |
| mainnet | `trades` BTC, disconnect 10 s → Reconnect | REST recentTrades: 9 trades happened during the gap; the re-subscribe replay recovered 9 | ✅ |
| mainnet | Record 6 s → Stop & save | session listed (5 msgs, 6.0 s) in IndexedDB | ✅ |
| mainnet | Export (captured in-page, no file written) | format `hl-tools.ws-session`, `sanitized: true`, 15 addresses all pseudonymised | ✅ |
| — | Import that export | parsed, saved and replayed | ✅ |
| — | Replay bundled sample | "Replay finished (15 messages, 8.0 s recorded)" | ✅ |
| — | Import `not json at all` / wrong format / out-of-order messages | specific rejection for each | ✅ |
| mainnet | l2Book coin `HYPE/USDC` | "not a coin string on mainnet. Did you mean @107 (HYPE/USDC)?" | ✅ |
| mainnet | userFills user `0x1234` | "user must be a 20-byte address", connect disabled | ✅ |
| mainnet | userFills HLP vault | snapshot message flagged isSnapshot (0 fills) | ✅ |
| testnet | switch global network with a mainnet stream open | banner "This connection is on mainnet; the global network is now testnet"; stream stays pinned | ✅ |
| testnet | Resubscribe l2Book BTC | `wss://api.hyperliquid-testnet.xyz/ws`, testnet snapshot | ✅ |
| — | finding while testing | trades' first message replays 30 recent trades with no `isSnapshot` flag (undocumented) | encoded in websocket rules 1.1.0 |
| — | 375px light | no overflow | ✅ |

## 6. RPC Capability Probe — `/tools/rpc`

| Network | Input | Expected | Result |
|---|---|---|---|
| both | sample `public` (mainnet vs testnet public RPCs) | chain 999 / 998, client versions, heads; historical checks | ✅ both **flagged**: historical `eth_getTransactionCount` returned the current nonce (e.g. 161170 where the account's nonce at that block was provably 161159), historical `eth_getCode` returned USDC's 1798-byte code for block 1000, historical `eth_call` equals latest; `eth_getLogs` accepts 500-block ranges vs the documented 50 |
| mainnet | own: `https://hyperliquid.drpc.org` | real archive behaviour | ✅ nonce oracle exact (15765 at the past block, 16241 now), code empty at block 1000, historical call differs from latest; logs accept 51, reject 500; `eth_getSystemTxsByBlockNumber` unsupported |
| mainnet | compare public mainnet vs dRPC | side-by-side statuses, expandable raw requests/responses per check | ✅ |
| — | own: `https://rpc.hyperliquid.xyz/evm?apikey=abcdefghijklmnopqrstuvwxyz123456` | shown as `…?apikey=•••`; key never rendered, stored in localStorage or put in the page URL | ✅ |
| — | malformed `not a url` | inline error, Run disabled | ✅ |
| — | `https://example.com/` (no CORS) | "Endpoint unreachable from the browser (CORS or network). Remaining checks skipped." | ✅ |
| testnet | default endpoint after switching network | uses the testnet public RPC | ✅ |
| — | repeated probes within a minute | rate limiting surfaced | ❌ → fixed. Rate-limited checks showed "unsupported" (batch) or silently dropped the logs upper bound; now "inconclusive · rate limited". Regression test added. |
| testnet | full probe | all checks resolve | ❌ → fixed. Large `eth_getLogs` ranges exhausted the public testnet limit for the checks after them; the logs check now runs last. |
| — | 375px light | statuses visible | ❌ → fixed. Table hid the status column; stacked layout below `sm`. |

## 7. Testnet Faucet Miner — `/faucet-miner`

The only tool that signs. Exercised with the Rabby wallet in the DevTools-controlled Chrome; mining runs only under the existing MSW mock harness (`?mock=1`), so no real funds moved.

| Input | Expected | Result |
|---|---|---|
| `/faucet-miner?mock=1`, Rabby connected | balances for mainnet and testnet, Auto/Manual mode cards, recovery banner for 3 leftover wallets, mock panel intercepting | ✅ |
| Same, light theme | readable banners | ❌ → fixed. Recovery banner and abort notice used hard-coded `amber-200`/`red-200` text (illegible on light); now theme tokens. |
| 375px | wallet buttons and mode cards fit | ❌ → fixed. "How it works" and the address wrapped onto two lines, "Auto Mode Recommended" broke mid-title, warning callout squeezed beside the buttons; now icon-only wallet buttons on small screens, stacked badge, full-width warning. |
| Disconnected (isolated browser context) | one clear call to action | ❌ → fixed. Two "Connect Wallet" buttons (RainbowKit's in a different style); RainbowKit's button now appears only once connected. |
| Connected (Rabby) after that change | account button visible, no Connect CTA | ✅ |
| `/faucet-miner/how-to-use` | hub breadcrumb, accurate copy | ❌ → fixed. Old "Back / How to Use" header, "What is hl-tools?" (now the hub's name) and "click the wallet button in the top-right… stats appear on the home page"; rewritten, page has its own title. |
| `/how-to-use` (old URL) | 301 to `/faucet-miner/how-to-use` | ✅ |

## Feedback round 1 (2026-10-04)

Changes from the first round of user feedback, each verified in the browser (desktop 1440×900 dark, plus 375×812 light for the composer).

| Page | Input | Expected | Result |
|---|---|---|---|
| `/` | directory grid | faucet miner is a regular card (8 cards, "Signs & sends" badge), "Faucet miner" link in the header | ✅ |
| `/tools/orders` | market picker `BTC` | perp first, then live spot pairs `@142` UBTC/USDC and `@234` UBTC/USDH as "name contains the query", delisted HIP-3 markets last | ✅ (first pass ranked delisted HIP-3 above live spot → fixed, fixture ordering assertion added) |
| `/tools/orders` | intent list | IOC limit first and selected by default; TP/SL brackets last; arrow keys move the selection | ✅ |
| `/tools/orders` | pick BTC-PERP, prefilled price | "mid 84707.5 · 2% below the mid · would rest" under the price field, "Use mid" sets the price to the mid | ✅ |
| `/tools/orders` | 375px | mid reference wraps under the field, no overflow | ✅ |
| `/tools/signing` | sample `order` → Minify → Format | one line, then the identical 26-line text; digest `0xa5cf…801e` and recovered signer unchanged throughout | ✅ |
| `/tools/corewriter` → Read precompiles | Mark price → "Find perp by name" `HYPE` | options "HYPE-PERP → 159", "HYPER-PERP → 191"; picking fills `159`, "resolves to: HYPE · szDecimals 2" | ✅ |
| same | Query live | "Decoded output" table with field / raw / human headers: markPx 892322 → 89.2322 (÷ 10^(6 − 2)); raw JSON-RPC collapsed by default | ✅ |
| same | Spot balance → "Find token by name" `usdc`, `zzzz`, `hype` | "USDC → 0"; "No token matches “zzzz” on mainnet."; HYPE fills `150` | ✅ |

## UX review round (2026-10-04)

A full pass over every non-faucet page as a Hyperliquid developer would use it (Chrome DevTools MCP, desktop 1400×900 dark, 390×844 mobile, light theme spot-checked), typing real inputs and reading the output. The faucet miner was excluded from this round. Findings and the verified fix for each:

| Page | Input | Found | Fix | Verified |
|---|---|---|---|---|
| `/` paste box | `wss://api.hyperliquid.xyz/ws` | routed to the RPC probe | WebSocket URLs open the WebSocket workbench; 20-byte addresses and 16-byte token IDs name the resolver explicitly | ✅ "WebSocket URL → WebSocket workbench", "EVM address → asset resolver (linked HyperCore token)" |
| `/tools/assets` | `HYPE` | "Ambiguous — matches 16 identities", 9 of them similar names (KHYPE, STHYPE…) | ambiguity counts direct matches only; similar names listed in their own section | ✅ "7 matches · 9 similar names", warning says 7; `ETH` → 3 direct, 6 similar |
| `/tools/assets` | `HYP` | 17 similar names presented as matches | "0 matches · 17 similar names" with a note that nothing is named exactly `HYP` | ✅ |
| `/tools/assets` | `0x5555…5555`, `0x5555…5555` (16 bytes), `xyz:` | empty list, no explanation | resolver notes for an unlinked EVM address, an unknown token ID and a bare dex prefix (fixture cases added) | ✅ |
| `/tools/orders` | BTC, "Use mid" | inserted `84654.5` → "6 significant figures" error, payload blocked | mid rounded to the tick towards the resting side | ✅ buy → `84668`, sell → `84669`, "just below/above the mid · would rest", payload emitted |
| `/tools/orders` | Explain tab, reload | tab lost | `?tab=explain` kept in the URL (responses never are) | ✅ |
| `/tools/signing` | bare `order` action, no nonce | "the digest below is what a wallet would sign" with no digest below | verdict says "enter the nonce to compute the digest"; "Use now" button fills `Date.now()` | ✅ button fills `1791062533661`, all six steps appear, button hides |
| `/tools/signing` | `[1,2,3]` | same misleading sentence | "Nothing to sign — see the diagnostics." | ✅ |
| `/tools/corewriter` → Build | `asset` field | integer only, no way to find an asset by name | resolver-backed name search under `asset`/`token` fields (shared `IndexSearch`) | ✅ `HYPE` → "HYPE-PERP → 159", picking fills `159`, hint "HYPE · HYPE-PERP on mainnet" |
| `/tools/corewriter` | switch to Read precompiles, reload | tab lost | `?tab=` kept in the URL | ✅ `?tab=precompiles` |
| `/tools/corewriter` → Build | `asset` = `abc` | "Fix the inputs below" (inputs are on the left) | "Fix the highlighted fields" | ✅ |
| `/tools/trace` | sample "Limit order" | result not linkable | `?tx=<hash>` kept in the URL on submit (hash is public; network stays on the global switch) | ✅ `?tx=0x4b65…d949` |
| `/tools/nope` | — | bare "Not Found" line inside the shell (TanStack default) | designed not-found page listing every tool | ✅ |

Checked and found correct in this round (no change): paste detection for symbols, hashes, CoreWriter hex, action JSON, exchange responses and error strings; resolver notes for `@`, `@99999`, bare numbers; signing diagnostics for trailing zeros, nonce window, unknown action types and arrays; CoreWriter build linting (tick, lot, min notional, unknown asset, negative price, non-integer input); composer linting (sig figs, decimals, lot, min notional, TP on the wrong side, no TP/SL); every explainer sample plus bare errors, cancel batches, unrecognised text and `default` responses; the trace sample end to end; WebSocket connect, simulated disconnect, reconnect diff ("3 changed · 1 unchanged") and unsubscribe; the public mainnet-vs-testnet RPC comparison (14 checks each, historical state flagged on both); `/changes`; mobile layout of the home page and composer; light theme.

## Identifier vocabulary and settled outcomes (2026-10-04)

Built from the owner's question "I entered `100083061`, a 15-minute BTC outcome that has expired, and it says nothing found" and the follow-up that Hyperliquid's naming (`@`, `#`, `+`, `dex:`, bare numbers) is hard to keep straight. Verified in the Chrome DevTools browser on mainnet.

| Page | Input | Expected | Result |
|---|---|---|---|
| `/tools/assets` | `100083061` | "You typed · number · ACTION ASSET ID", derived `100000000 + 83061 → outcome 8306, side 1 (No)`, coin `#83061`, token `+83061`; left: "Outcome 8306 is not live on mainnet — it has settled"; right: settled card with sides 0 · Yes `#83060` / `+83060` / `100083060` paid 0 USDC and 1 · No `#83061` / `+83061` / `100083061` paid 1 USDC (the asked-for side highlighted), settle fraction 0, spec `perp:BTC … threshold:85252 … time:20261004-1115`, observed line with `settledOutcome` | ✅ |
| `/tools/assets` | `#83061`, `+83061` | same outcome decoded from the coin and token spellings; `classifyQuery` test covers all three | ✅ (unit) |
| `/tools/assets` | `@107` | strip: "spot pair index · COIN STRING", derived spot pair index 107 · asset ID 10107; identity: spelling table coin `@107` (info, WebSocket) · display `HYPE/USDC` (app only) · asset ID `10107` (exchange a, CoreWriter) · spot pair index · base token name/index/ID/string · quote token; "Same asset elsewhere": HYPE perp, @207, @232, @255, HYPE token | ✅ |
| same | click the "HYPE token" chip | identity switches to the token in place (token name/index/ID/string), panel says "Related to “@107”, not one of its matches", chips now include @107 | ✅ |
| `/tools/assets` | `?q=100083061` in the URL | query survives a reload as typed | ✅ (first pass: router parsed it as a number and dropped it, then re-wrote it quoted → router codec fixed; `?tab=`, `?sample=`, `?tx=` on every other tool re-checked) |
| `/tools/assets` | 390 px wide | strip wraps the explanation under the badge; legend renders as stacked cards instead of a 760 px table | ✅ |
| `/tools/assets` | legend | five families with examples, "used in" chips (API word, plain words on hover) and derivation | ✅ |

Unit coverage: `packages/hl-core/test/identifiers.test.ts` (13 tests): query classification for every shape, outcome side validation, spellings of a spot pair / perp / outcome / token, related identities for HYPE and for an outcome's other side, and `normalizeSettledOutcome` against the recorded mainnet response plus a partial `settleFraction`.

## Final regression pass

Every page, both themes, desktop 1440×900 and mobile 375×812, captured full-page from an isolated browser context (home, orders, signing and CoreWriter re-captured after feedback round 1) (no wallet connected, fresh storage, so nothing personal is in the images). Tool pages were captured with their built-in sample loaded. Each image was reviewed; problems found during the pass are logged in the sections above and were fixed before the final capture.

Also verified at the end: `bun --bun run test` (272 passing after this round), `bun --bun run check` (clean), `bun --bun run build` (succeeds; the mock panel and MSW worker are not in the client bundle).

| Page | Dark · desktop | Light · desktop | Dark · mobile | Light · mobile |
|---|---|---|---|---|
| Home `/` | [view](docs/screenshots/home-dark-desktop.jpeg) | [view](docs/screenshots/home-light-desktop.jpeg) | [view](docs/screenshots/home-dark-mobile.jpeg) | [view](docs/screenshots/home-light-mobile.jpeg) |
| Rule changes `/changes` | [view](docs/screenshots/changes-dark-desktop.jpeg) | [view](docs/screenshots/changes-light-desktop.jpeg) | [view](docs/screenshots/changes-dark-mobile.jpeg) | [view](docs/screenshots/changes-light-mobile.jpeg) |
| Asset Resolver | [view](docs/screenshots/assets-dark-desktop.jpeg) | [view](docs/screenshots/assets-light-desktop.jpeg) | [view](docs/screenshots/assets-dark-mobile.jpeg) | [view](docs/screenshots/assets-light-mobile.jpeg) |
| Signing Inspector | [view](docs/screenshots/signing-dark-desktop.jpeg) | [view](docs/screenshots/signing-light-desktop.jpeg) | [view](docs/screenshots/signing-dark-mobile.jpeg) | [view](docs/screenshots/signing-light-mobile.jpeg) |
| CoreWriter Workbench | [view](docs/screenshots/corewriter-dark-desktop.jpeg) | [view](docs/screenshots/corewriter-light-desktop.jpeg) | [view](docs/screenshots/corewriter-dark-mobile.jpeg) | [view](docs/screenshots/corewriter-light-mobile.jpeg) |
| Cross-layer Trace | [view](docs/screenshots/trace-dark-desktop.jpeg) | [view](docs/screenshots/trace-light-desktop.jpeg) | [view](docs/screenshots/trace-dark-mobile.jpeg) | [view](docs/screenshots/trace-light-mobile.jpeg) |
| Order Composer | [view](docs/screenshots/orders-dark-desktop.jpeg) | [view](docs/screenshots/orders-light-desktop.jpeg) | [view](docs/screenshots/orders-dark-mobile.jpeg) | [view](docs/screenshots/orders-light-mobile.jpeg) |
| WebSocket Workbench | [view](docs/screenshots/websocket-dark-desktop.jpeg) | [view](docs/screenshots/websocket-light-desktop.jpeg) | [view](docs/screenshots/websocket-dark-mobile.jpeg) | [view](docs/screenshots/websocket-light-mobile.jpeg) |
| RPC Capability Probe | [view](docs/screenshots/rpc-dark-desktop.jpeg) | [view](docs/screenshots/rpc-light-desktop.jpeg) | [view](docs/screenshots/rpc-dark-mobile.jpeg) | [view](docs/screenshots/rpc-light-mobile.jpeg) |
| Faucet Miner | [view](docs/screenshots/faucet-dark-desktop.jpeg) | [view](docs/screenshots/faucet-light-desktop.jpeg) | [view](docs/screenshots/faucet-dark-mobile.jpeg) | [view](docs/screenshots/faucet-light-mobile.jpeg) |
| Faucet Miner — how it works | [view](docs/screenshots/faucet-how-dark-desktop.jpeg) | [view](docs/screenshots/faucet-how-light-desktop.jpeg) | [view](docs/screenshots/faucet-how-dark-mobile.jpeg) | [view](docs/screenshots/faucet-how-light-mobile.jpeg) |
