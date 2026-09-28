# Testing

Browser verification is the acceptance gate. Every tool was exercised end to end in Chrome via the Chrome DevTools MCP against the dev server (`bun --bun run dev`, port 3000): real inputs typed into the real controls, rendered output read back from the DOM, screenshots reviewed. Unit tests (`packages/hl-core`, Vitest) cover the protocol core.

Viewports: desktop 1440×900 (DPR 1) and mobile 375×812 (DPR 2, touch), each in dark and light themes (`prefers-color-scheme` emulation plus the in-app theme setting).

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
