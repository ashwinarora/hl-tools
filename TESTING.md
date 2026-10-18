# Testing

Browser verification is the acceptance gate. Every tool was exercised end to end in Chrome via the Chrome DevTools MCP against the dev server (`bun --bun run dev`, port 3000): real inputs typed into the real controls, rendered output read back from the DOM, screenshots reviewed. Unit tests (Vitest) cover the protocol core (`packages/hl-core`) and the app's pure logic (`src/**/*.test.ts`); components are verified in the browser. The Multisig relay adds two more layers, described in §10: pgTAP tests inside Postgres and an integration suite against the local Supabase stack.

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
| `signing.test.ts` | 49 Python SDK vectors (MsgPack bytes, action hash, EIP-712 digest, recovered signer) on both networks; MsgPack int/float formats vs Python; decoder strictness; order-preserving JSON; inspector diagnostics (key order, trailing zeros, uppercase addresses, `f:false`, network mismatch, multisig hand-off, request-body splitting, short r/s padding) |
| `resolver.test.ts` | Cases in `fixtures/resolver/cases.json` against metadata snapshots of both networks; explicit-index normalisation; HIP-3 dex/meta mismatch rejection; cross-network pairing; snippet pricing |
| `corewriter.test.ts` | Decode fixtures (`fixtures/corewriter/cases.json`: every action id, unknown version, unknown action, malformed bytes); encoding reproduces the real mainnet limit-order bytes; inexact fixed-point input refused; cast/Solidity snippets; precompile input/output codec incl. a dynamic struct; trace replays of five recorded transactions (cloid match, ledger match, inference without cloid, unsupported action, sender with no HyperCore history, not-found with other-network check) |
| `orders.test.ts` | Precision linter fixtures (`fixtures/orders/lint-cases.json`: perp/spot/HIP-3 tick and lot rules, sizes that round to zero); composer (normalTpsl bracket, blocking instead of rounding, explicit rounding options, TP/SL side checks, conservative market price, reduce-only close, minimum notional, builder fee caps, post-only crossing); explainer fixtures (`fixtures/orders/explain-cases.json`) |
| `ws.test.ts` | Subscription building and validation for all 20 channels, each with an ordering statement; recorded mainnet l2Book/trades sessions (dedupe by `(time, tid)`, state diff); session files (consistent address pseudonyms, recording bound, strict import with reasons) |
| `probe.test.ts` | URL redaction; probe against scripted endpoints: honest archive node, node answering historical queries with latest state, network mismatch, rate limiting reported as inconclusive (browser bug 2026-09-28), CORS abort |
| `multisig/digest.test.ts` | Inner L1 digest over `[multiSigUser, outerSigner, action]` with vault/expiry markers, byte-identical to `@nktkas/hyperliquid`; user-signed enrichment (`payloadMultiSigUser`, `outerSigner` after `hyperliquidChain`); envelope digest (canonical key order, trimmed inner signatures, `type` excluded, vault/expiry/chain id/network sensitivity) |
| `multisig/action.test.ts` | Canonicalisation of L1 actions (normalisations become warnings, unknown keys stay errors, unknown shapes pass verbatim, floats and integer-like keys rejected, nested envelopes rejected); user-signed strictness (chain fields, nonce/time field equal to the envelope nonce, no unsigned keys, address fields lowercased, approveAgent agentName, convert signers string normalised); risk flags |
| `multisig/signature.test.ts` | Signature forms (`{r,s,v}`, 65-byte, EIP-2098 compact, short/odd/uppercase hex, zero, high-s), trim/pad round trips, recovery, classification (authorized, unauthorized, the multi-sig user's own key, duplicates, signer mismatch, undigestable payload) |
| `multisig/signerSet.test.ts` | `convertToMultiSigUser.signers` parsing (revert sentinel, shape, dedupe, sort, lowercase) and validation (empty, threshold bounds, >10, self, existence, nested multisig, leader removed, all-current removed, no-op, lost keys) |
| `multisig/proposal.test.ts` | `createProposal` (every input rule, nonce window, expiry, meta, digest failure) and `validateProposal` (every invariant of the v1 document, timing as warnings, digest recompute, receipts) |
| `multisig/readiness.test.ts` | Threshold against the current policy, duplicates/outsiders not counted, signer removed or threshold raised since signing, policy null/reverted, stale policy, leader authorized / not-authorized / needs-lookup, expired, not-yet-valid |
| `multisig/envelope.test.ts` | `buildEnvelope` shape and defaults, classified filtering, `exchangeRequestBody`, `signProposal`/`signEnvelope` through a viem signer (recovery-based attribution, expectedSigner, signer failures), `parseEnvelope` round trip, key-order and untrimmed warnings, every error case |
| `multisig/oracle.test.ts` | 300 fast-check scenarios (3000 with `MULTISIG_ORACLE_RUNS`): random network, L1 or user-signed action (all 16 types), nonce, vault, expiry, 1–4 signers, leader; our inner and envelope signatures are byte-identical to the TS SDK's |
| `multisig/sensitivity.test.ts` | Mutation matrix: every signed leaf changes the digest and invalidates the signature; meta/signatures/receipt do not; for user-signed actions network and nonce bind only through `hyperliquidChain` and `time`/`nonce` |
| `multisig/codec.test.ts` | Deterministic encoding, decode errors, bigint lexemes, size guard, merge laws (union by signer, first wins, unverifiable signatures dropped, meta fallback, receipt propagation) |
| `multisig/diagnose.test.ts` | Each divergence named (other network, other leader, nonce ±1/±2, vault or expiry omitted, other signatureChainId, non-canonical action), unknowns, unrecoverable signatures, bounded attempts |
| `multisig/errors.test.ts` | Every error string recorded on testnet → catalogue id with extracted nonce bounds/addresses; every catalogue example maps to itself; ok, per-order statuses, HTTP 422/500 bodies, odd bodies never throw |
| `multisig/property.test.ts` | fast-check: codec round trip, merge idempotent/commutative, trim/pad, `validateProposal`/`prepareInnerAction`/`parseEnvelope`/`explainExchangeError` total over arbitrary input, tampered payloads never validate |
| `multisig/lab.test.ts` | The 124 recorded testnet requests replayed offline: parse, recover every signer, predict the chain's verdict from the policy in force, explain every error, diagnose every injected divergence |
| `multisig/vectors.test.ts` | 44 multi-sig vectors from `hyperliquid-python-sdk` 0.24.0: msgpack bytes, action hash, digest and every signature for inner L1, inner user-signed and envelope |
| `multisig/account.test.ts` | `assessAccount`: the role sentence for every non-multi-sig (user, agent of X, vault, sub-account of X, never seen), threshold 1 / all keys required / 10 signers, nested signers checked and unchecked, agents present / expired / unloadable, HyperEVM unchecked / zero / funds under the dead key (multi-sigs only) |
| `multisig/describe.test.ts` | `describeAction` over every L1 shape and user-signed spec: orders (side, size, price, tif, reduce-only, trigger, builder, cloid, grouping), cancels by oid and cloid, modify, leverage, scheduled cancel, vault and sub-account transfers, sends and withdrawals, agent approval, convert and revert, staking, bigint amounts, unknown types "hashed exactly as written" |
| `explorer.test.ts` | Explorer `userDetails` adapter: a recorded 101-entry response and the truncation flag, non-JSON body, HTTP 429, abort, the default `fetch` |

766 core tests, all passing; the multisig module, its rule set and the explorer adapter are held to 100 % line and branch coverage (`bunx vitest run --coverage` in `packages/hl-core`). `bun --bun run test` runs the workspace projects through a root `vitest.config.ts`.

The app project (`src/**/*.test.ts`, node environment, `fake-indexeddb` where storage is involved, deterministic keys in `src/test/keys.ts`) covers the logic the Multisig Signer decides without React:

| Suite | What it covers |
|---|---|
| `src/lib/idb.test.ts` | Fresh database gets both stores; a version-1 database upgrades and keeps its WebSocket sessions; sessions list newest first, stay bounded to 20, delete; a failed request and a missing IndexedDB reject with a reason |
| `src/lib/signerWallets.test.ts` | The signer's wallet list never contains RainbowKit's generic WalletConnect entry, whose modal reports the page URL to a third party; nor an entry with a WalletConnect QR fallback or Coinbase's pop-up (the connectors of a real wagmi configuration are exactly `injected` and `safe`); "Browser Wallet" only for a provider that injects without announcing itself |
| `src/lib/detect.test.ts` | Proposal documents and signer links route to the Multisig Signer; envelopes and addresses stay with the inspector; other share links and URLs are not mistaken for proposals; every earlier rule still holds |
| `multisig/model/actions.test.ts` | Each of the seven kinds builds an action `createProposal` accepts; title, note, proposer and superseded digest carried; amounts canonical and never rounded (`1.0` → `1`, precision errors); address checks and the self-send warning; spot token against the network's list and its decimals; balance excess warns and never blocks; raw JSON limited to user-signed types (L1 and `convertToMultiSigUser` refused, overridden fields noted); finaliser required and from the current signer set; `formFromAction` rebuilds the same action; issue paths map to form fields |
| `multisig/model/chains.test.ts` | Hex id ↔ number ↔ viem chain for the four offered ids; malformed ids refused; labels for known and unknown chains; a stored id mapped back to the offered choice on its network |
| `multisig/model/nonce.test.ts` | Nonce now or 23 hours ahead; two days and almost three, both submittable at once; closed and not-yet-open windows in words |
| `multisig/model/transport.test.ts` | Link carries the whole document in the fragment of `/multisig/proposal` and round-trips; oversize warning above 16 KiB; only fragments made for proposals are read; fragment parser accepts v1 with or without `#`; file name states network, digest and signature count, body is pretty JSON; `openText` accepts a document, a pretty document and a pasted link, and explains what it cannot open |
| `multisig/model/history.test.ts` | Save and load unchanged; list summary; a returned copy merges by signer instead of appending; a signature that does not recover to its claimed signer is dropped; same digest with a different payload refused; the better receipt kept; newest first, network filter, delete; `rewriteProposal` (the relay's write-through: may remove a signature, refuses a payload conflict); two writers on one digest at the same moment keep both signatures (the per-digest lock, checked by removing it and watching the test fail) |
| `multisig/model/submit.test.ts` | One POST with the canonical envelope (trimmed inner signatures) to the network's exchange endpoint; a chain rejection becomes an explained receipt; a non-JSON body is kept verbatim and an HTTP error never throws; only a request with no answer rejects; a receipt attaches without touching the rest of the document |
| `multisig/model/stage.test.ts` | Phase, wallet role and the sign / finish gates with their reasons: collecting, the one-sitting finish when the finaliser's signature completes the threshold, ready, a leader outside the signer set, the required chain, pending judgement, expired / not yet valid / no signer set, accepted and rejected receipts, refusal of L1 documents and of documents that set a vault address or expiry, a changed signer set; withdrawn and declined (nothing can be signed, re-propose offered); a header network that differs from the proposal's refuses to act and offers the switch |
| `multisig/model/walletErrors.test.ts` | A rejection recognised by code, name, message and nested cause; the chain named when a switch is impossible; fallbacks |
| `multisig/model/roundtrip.test.ts` | The browser milestone offline: A proposes and signs, the link is opened in a fresh history, B signs inner and envelope, a fake exchange asserts the canonical body under `0x3e6`, the receipt is stored and the document re-encodes identically; an outsider's signature never counts and only the finaliser's key can sign the envelope |

| `src/lib/boundaries.test.ts` | A scan of the sources: `@supabase/` is imported at run time by `relay/client.ts` only; nothing outside the Multisig section imports `relay/`; the read-only tools never import the signer; the pure model never imports the relay runtime |
| `multisig/model/relay/rows.test.ts` | Every row shape the relay returns parsed as untrusted input: wrong types, unknown enum values, malformed addresses and hashes, missing nested rows; a bad row is dropped and counted, never thrown on |
| `multisig/model/relay/assemble.test.ts` | Row to proposal: the stored document decoded and its digest recomputed; columns cross-checked against it (network, treasury, finaliser, nonce); a tampered document, a tampered signature and a signature filed under another signer's name are ignored and reported; the best receipt chosen; a signer who took their signature back is dropped from local copies until they sign again; a local copy with another payload under the same digest is not merged (`relay.local_conflict`) |
| `multisig/model/relay/push.test.ts` | What to send after a change here, in order: publish only when asked, the wallet's own signature, the finaliser's receipt; nothing for a closed or expired proposal; a taken-back signature is not pushed again by a background catch-up; why a document cannot be shared |
| `multisig/model/relay/inbox.test.ts` | The three groups (ready for you to finish, waiting for your signature, you signed), counts per treasury and network; a signature no longer asked for once the threshold is met; a frozen treasury's proposals ask nobody for anything |
| `multisig/model/relay/signers.test.ts` | Live signer set against the stored copy: added, removed, threshold change, no longer a multi-sig, a multi-sig again; "not a multi-sig" is an answer and "not known yet" is not; the re-check schedule (at once, then every 35 s, six times) |
| `multisig/model/relay/reconnect.test.ts` | The reconnect schedule: 5 s doubling to once a minute, never stopping, nonsense counts treated as the first failure |
| `multisig/model/relay/status.test.ts` | Who may take back, withdraw and decline, and when none of it applies |
| `multisig/model/relay/timeline.test.ts` | Events to history sentences ("You proposed … and signed. Finaliser: …", "Signers changed: …"), the export text and its file name |
| `multisig/model/relay/message.test.ts` | The message for the team chat names the treasury and links the proposal, and carries no amount and no destination |
| `multisig/model/relay/errors.test.ts` | Database guards, PostgREST and auth errors to sentences; "unreachable" told apart from "refused"; a duplicate insert counts as done |
| `multisig/model/relay/copy.test.ts` | Every relay-era sentence checked against the forbidden claims (private, encrypted, only you, free, no server, browser only), with a self-test that the checker still catches each one |
| `multisig/model/relay/siwe.test.ts` | The sign-in message: domain, URI, chain id, statement, expiry; origins the relay cannot sign in from (an IP address) refused before the wallet is asked |

306 app tests; 1072 tests in total (2026-10-10). The relay's own suites (450 pgTAP assertions, 33 integration tests) are listed in §10.

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
| Paste box: multi-sig request body `{"action":{"type":"multiSig",…},"nonce":…}`, Open | "Multi-sig envelope → Multisig Inspector"; the envelope view opens with the body decoded, nothing in the URL | ✅ (2026-10-09) |
| Paste box: proposal document `{"v":1,"payload":{"multiSigUser":…},…}`, Open | "Multi-sig proposal document → Multisig Signer (review, sign, submit)", button "Open Multisig signer"; lands on the proposal page under `?digest=` with nothing else in the URL | ✅ (2026-10-09; first routed to the inspector's envelope view, moved when the signer shipped. The inspector still opens documents and offers "Open in Multisig Signer") |
| Paste box: a link made by the signer (`…/multisig/proposal#share=…`) | "Multi-sig proposal link → Multisig Signer (review, sign, submit)"; the fragment is decoded locally, the URL is never fetched | ❌ → fixed (2026-10-09). The link was taken for an RPC URL. |
| Paste box: bare address `0xf836…d148`, Open | "Address → Multisig Inspector (signers, agents, balances)"; account view with `?address=` (an address is a public identifier) | ✅ (2026-10-09; previously routed to the asset resolver, where it matched nothing) |
| Paste box: `Order must have minimum value of $10.` | "Error message → failure explainer" | ✅ |
| Paste box: a long English question | "Not recognised — open a tool below.", Open disabled | ✅ |
| Every "Try with a sample" link (7) | tool opens with a result, not an empty state | ❌ → fixed. RPC and WebSocket samples only prefilled; they now run/connect on arrival. The trace sample could render an empty page (SSR crash in `useNetworkHydrated`) or fill the hash without tracing (hydration event never delivered); both fixed. |
| Server-rendered HTML of all 11 pages (`curl`) | full page content, no "switched to client rendering" | ❌ → fixed (same SSR crash on Signing, CoreWriter, Trace, Composer) |
| Network switch with the keyboard | arrow keys move the selection | ❌ → fixed. Arrow keys did nothing and both options were tab stops; network switch and all segmented controls now follow the WAI-ARIA radio pattern. |
| Reload after choosing testnet | testnet segment painted before hydration, no hydration warning | ✅ |
| `/changes` | 13 rule sets (11 at the time; multisig and evm-core-transfers were added later) with version, verified date, sources, tools that use them, changelog; timeline sorted by date | ✅ |
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

One of the two sections that sign (the other is the Multisig Signer, §9). Exercised with the Rabby wallet in the DevTools-controlled Chrome; mining runs only under the existing MSW mock harness (`?mock=1`), so no real funds moved.

| Input | Expected | Result |
|---|---|---|
| `/faucet-miner?mock=1`, Rabby connected | balances for mainnet and testnet, Auto/Manual mode cards, recovery banner for 3 leftover wallets, mock panel intercepting | ✅ |
| Same, light theme | readable banners | ❌ → fixed. Recovery banner and abort notice used hard-coded `amber-200`/`red-200` text (illegible on light); now theme tokens. |
| 375px | wallet buttons and mode cards fit | ❌ → fixed. "How it works" and the address wrapped onto two lines, "Auto Mode Recommended" broke mid-title, warning callout squeezed beside the buttons; now icon-only wallet buttons on small screens, stacked badge, full-width warning. |
| Disconnected (isolated browser context) | one clear call to action | ❌ → fixed. Two "Connect Wallet" buttons (RainbowKit's in a different style); RainbowKit's button now appears only once connected. |
| Connected (Rabby) after that change | account button visible, no Connect CTA | ✅ |
| `/faucet-miner/how-to-use` | hub breadcrumb, accurate copy | ❌ → fixed. Old "Back / How to Use" header, "What is hl-tools?" (now the hub's name) and "click the wallet button in the top-right… stats appear on the home page"; rewritten, page has its own title. |
| `/how-to-use` (old URL) | 301 to `/faucet-miner/how-to-use` | ✅ |

## 8. Multisig Inspector — `/tools/multisig`

Verified 2026-10-09 in the user's own Brave instance through the Chrome DevTools MCP (port 9222), on Hyperliquid testnet against the lab treasury `0xf836…d148` (2-of-3: signers A `0x5e7c…7216`, B `0xb70c…36ee`, C `0x41e8…55b9`; agent `lab`). Nothing is stored; every number on the page is fetched when the user looks. Screenshots: [account](docs/screenshots/multisig-dark-desktop.jpeg) and [envelope](docs/screenshots/multisig-envelope-dark-desktop.jpeg) (all four variants in the table at the end).

| Network | Input | Expected | Result |
|---|---|---|---|
| testnet | sample `lab-treasury` (`?sample=lab-treasury`, flips the header to testnet after hydration) | "multi-sig user · 2 of 3 authorized users must sign every action", signers A/B/C, agent `lab` (valid until 2027-01-05) with the bypass warning, perps value and spot balances, no open orders, raw panel listing 5 requests · weight 64 | ✅ |
| testnet | "Check signers for nesting" | one `userToMultiSigSigners` per signer (3 × 20), none nested, its own observed line | ✅ |
| testnet | "Check HyperEVM" | `eth_getBalance` on the testnet EVM RPC, result in HYPE with its own observed line | ✅ |
| testnet | "Load recent actions" | explorer `userDetails` (weight 40) only on request; newest first with the action described in plain words, failures marked, "showing the most recent N" footer | ✅ |
| testnet | normal user `0x51d3…7fd9` | "not a multi-sig · A normal user: its own key signs every action…"; 6 requests · weight 124 (`userRole` is fetched only when the address is not a multi-sig) | ✅ |
| testnet | agent address `0xed60…368b` (lab agentA) | "An API wallet (agent) of 0x5e7c…7216. Agents sign L1 actions for their master and cannot be multi-sig users or inner signers." | ✅ |
| testnet | reverted signer D `0xb037…db15` | "A normal user… It may have been a multi-sig user before (load recent actions to see conversions)." | ✅ |
| testnet | never-seen address `0x7f9a…2b3c` | "Never seen on Hyperliquid: no deposit has ever reached this address…" | ✅ (`0x…dEaD` was tried first and turned out to be a real testnet user) |
| testnet → mainnet | header switch after a lookup | "This lookup ran on testnet; you are now on mainnet" with "Look up the same address on mainnet"; the result keeps its testnet badge | ✅ |
| — | wording for accounts that are not multi-sigs | the role sentence once (header), no HyperEVM "dead key" flag, API wallets "None." | ❌ → fixed. The sentence appeared twice, the Health list warned about the original key keeping HyperEVM for accounts that have no converted key, and the empty API-wallet panel said "only the multi-sig can act". `assessAccount` now emits the HyperEVM flags for multi-sigs only (test updated). |
| testnet | envelope sample `lab-envelope` (lab recording `ms-order-resting`) | "Limit buy 0.001 BTC at 50000 (Gtc)"; both signatures `valid-authorized` and attributed to A and B; readiness `ready` 2 of 2, leader authorized, envelope signature recovers to the leader; inner digest, action hash, envelope digest; canonical envelope | ✅ |
| testnet | broken sample `lab-broken-envelope` (`neg-B-signed-different-nonce`) | signature 2 `signed different bytes`: "0xb70c…36ee signed with nonce 1791399875145 (−1)"; readiness `not-ready` 1 of 2; "Still able to sign: …" | ✅ |
| — | raw envelope signatures | attributed by recovery | ❌ → fixed in core. A request body has no claimed signers, so every signature was compared with the zero address and shown as `invalid`. `classifySignatures` and `diagnoseSignature` now treat an unclaimed signature as matching whoever it recovers to, and a variant counts when it recovers to any current authorized user (`cls.unclaimed`, `diag.unclaimed`). |
| mainnet | the same L1 body with the header on mainnet | "Checked on mainnet (from the header switch)" plus "0xf8365a35… is not a multi-sig user on mainnet, but it is on testnet · Switch to testnet" | ✅ after fix: a missing policy first rendered as "unknown"; it is now normalised to not-multisig and the other network is probed |
| mainnet | proposal document with a receipt (lab `16-inspector-check.ts`: a testnet `noop` signed by A and B, submitted, `status: ok`) | "This payload is for testnet; the header says mainnet"; "No-op (consumes a nonce, does nothing)" from a proposal document; "Title (unsigned)"; readiness `ready` 2 of 2 with "Submitted 2026-10-08T18:33:22.694Z → ok · The chain accepted this proposal."; no countdown | ✅ |
| mainnet | user-signed envelope `ms-usdSend-5` (`hyperliquidChain: "Testnet"`) | network warning; "Send 5 USDC (perps) to 0x51d3…" flagged "moves funds out"; signer set fetched on testnet; both signatures authorized, leader authorized | ✅ |
| — | `{"action": {"type": "multiSig", "signatures": [` | "The text is not valid JSON — Unexpected end of input at line 1, column 48" | ✅ |
| — | a plain `order` request body | "Not a multi-sig envelope or proposal · action.type must be \"multiSig\"" with "Open in Signing Inspector", which hands the body over | ✅ (the hand-off button was added during this pass) |
| — | Signing Inspector with a multi-sig body | "Multi-sig envelope detected" → "Open in Multisig Inspector" lands on the envelope view with the body | ✅ |
| — | Share | no link until "content is public" is ticked; `#share=` fragment; opening the link restores the envelope view and text and strips the fragment | ✅ |
| — | 1440px signature table | readable | ❌ → fixed. The recovered address wrapped one hex pair per line; with `whitespace-nowrap` the Why column hid behind a horizontal scroll instead. Signatures are now stacked rows (index · recovers to · status pill, then the reason) and fit any width. |
| — | readiness line for a user that is not a multi-sig | says so | ❌ → fixed ("0 valid signatures; signer set unknown" → "no signer set on mainnet; nothing can count") |
| — | 375px, both themes | no page overflow; signer and agent tables scroll inside their wrappers; addresses in the short form below `sm` | ✅ (`scrollWidth = clientWidth = 375`) |
| — | network requests | only `api.hyperliquid(-testnet).xyz/info`, plus the explorer and the EVM RPC on demand; never a server of ours | ✅ (the resolver universe — `meta`, `spotMeta`, `perpDexs`, `outcomeMeta` — is fetched once per network for coin names and cached 5 min) |
| — | console | no errors beyond the known extension noise (MetaMask provider, ObjectMultiplex, MaxListeners) | ✅ |

Tooling note: the DevTools MCP `fill` tool sets a controlled textarea's DOM value without firing React's `onChange`; inputs were therefore set through `evaluate_script` with the prototype value setter plus an `input` event, which is what a real paste produces.

## 9. Multisig Signer — `/multisig`

Since 2026-10-10 the section lives in its own shell (a rail with the wallet, "Needs you" and the treasuries; see §10). The start page described below is now `/multisig/open`, and `/multisig` is the landing page or, signed in, the inbox. The checks in this section were run again in the new shell with the relay switched off.

Verified 2026-10-09 in the user's own Brave instance through the Chrome DevTools MCP (port 9222), on Hyperliquid testnet, with the Rabby wallet in that browser. The test multi-sig is a 2-of-3 built from Rabby's own accounts: a treasury **T** and signers **S1**, **S2**, **S3**, created from the wallet's seed, funded with testnet USDC and converted through Hyperliquid's official testnet UI. Every wallet prompt was approved or declined through the extension page (Rabby asks twice: Sign, then Confirm). No private key was read, typed or stored at any point, and the accounts' addresses are kept out of the repository like everything else personal. The lab treasury `0xf836…d148` is used for read-only checks and for the committed screenshots: [start](docs/screenshots/multisig-sign-dark-desktop.jpeg), [propose](docs/screenshots/multisig-propose-dark-desktop.jpeg), [proposal](docs/screenshots/multisig-proposal-dark-desktop.jpeg) (all variants in the table at the end).

### Shell, wallet and storage

| Input | Expected | Result |
|---|---|---|
| `/multisig`, dark and light | tool header with rule sets, "This section signs and sends real transactions" banner, one "Connect wallet" button | ✅ |
| Connect wallet → Rabby | the page shows the account and the chain the wallet is on; switching the account in Rabby reaches the page | ✅ |
| same | wallet line readable | ❌ → fixed. It read a checksummed address and "on chain 1"; now a lowercase short address and "Ethereum (1)" / "HyperEVM testnet (998)". |
| network requests on load | no repeated third-party lookups | ❌ → fixed. RainbowKit's stock button resolved ENS over `ethereum-rpc.publicnode.com` on every render (11 failed requests on one page). The signer has its own button. |
| network requests on any signer page, wallet connected | Hyperliquid only | ❌ → fixed. Each page load sent `POST pulse.walletconnect.org/e` with a body containing `"url":"http://…/multisig/proposal?digest=0x2f36…"` (the page URL, so the proposal digest or the treasury address), plus `api.web3modal.org/appkit/v1/config`; after connecting, one ENS lookup for the signer's address went to a public Ethereum RPC. Both came from the wallet configuration shared with the faucet miner. The signer now has its own: no generic WalletConnect wallet (the entry that starts the reporting modal) and an Ethereum transport that answers locally. |
| the same after the fix: start, propose, proposal, and a fresh load of a proposal link, wallet connected | only `api.hyperliquid-testnet.xyz/info` and the font files | ✅ in development and from the production build (`bun .output/server/index.mjs`). The faucet miner still makes its two WalletConnect requests, as before. |
| wallet picker on the signer | installed wallets first, no generic WalletConnect entry | ✅ "Installed: Rabby Wallet, MetaMask · Popular: Rainbow, Base Account" |
| connect while the wallet is on Ethereum | the wallet stays on Ethereum; the page says so | ✅ "0x… on Ethereum (1)" |
| `/`, header, `/faucet-miner` | home card "Multisig Signer" with the "Signs & sends" badge (two such cards), pill "read-only unless a card says “Signs & sends”", header links for both sections that sign; the faucet miner renders and its picker is unchanged (Rabby, MetaMask, Rainbow, Base Account, WalletConnect) | ✅ (the two sections keep separate wallet connections) |
| a browser that already had the version-1 `hl-tools` database, `/tools/websocket?sample=l2book` | database upgrades to version 2 with `proposals` and `wsSessions`; a session records and lists; no storage warning | ✅ |
| inspector after the judgement refactor | valid sample "ready 2 of 2", broken sample "signed with nonce … (−1)", receipt document "Submitted … → ok", other-network probe: all as in §8 | ✅ (an effect loop found on the way: the "not a multi-sig" policy object was rebuilt on every render; memoised) |

### Start page

| Input | Expected | Result |
|---|---|---|
| Open: truncated JSON | "Not a proposal this page can open · Not a JSON document: Unexpected end of input at line 1, column 20" (`proposal.parse`); the text stays in the box | ✅ |
| Open: a foreign JSON file (a recorded WebSocket session) | "Unsupported proposal version undefined; this build understands v1." (`proposal.version`) | ✅ |
| Open: a share link made for another tool | "This link does not carry a multi-sig proposal." (`transport.link`) | ✅ |
| Open: the lab receipt document (a testnet `noop` signed by A and B, submitted) | stored and opened: "Submitted · accepted by the chain", lab treasury strip (2 of 3 must sign, API wallet `lab` until 2027-01-05 under "trade without the multi-sig", perps and spot balances, "5 info requests · weight 64 · refreshed every 30 s while open"), wallet role "not in the signer set" | ✅ |
| Recent in this browser | rows newest first: title, action in words, network badge, treasury, signature count, "submitted" / "rejected", time; "all networks" checkbox; the note that this is browser storage and the chain knows nothing of a proposal until it is submitted | ✅ |
| Start a proposal: T's address, Check | "2 of 3 must sign" with the connected signer marked "(you)"; continue to `/multisig/propose?treasury=…` | ✅ |
| first load after the start page's code changed (its chunk hydrates after the root) | buttons usable | ❌ → fixed. React logged a hydration mismatch on `disabled` and left "Lab treasury (testnet)" disabled in the DOM; the panel now starts from the server's answer and enables after mount. |

### Propose

| Input | Expected | Result |
|---|---|---|
| empty form | six kinds (Send USDC, Send spot token, Perps ↔ spot, Withdraw, Approve API wallet, Raw JSON); preview "Fill in the action to see what will be signed." | ✅ |
| a malformed destination, amount `1.0000001` | "Destination must be a 20-byte hex address: 0x followed by 40 hex digits." and "USDC has 6 decimal places; 1.0000001 has 7." | ✅ |
| "Who finalises this?" | "Choose a signer…" then the three current signers, the connected one marked "(you)"; nothing preselected | ✅ |
| Send USDC 1 to S3, finaliser S2 | preview "Send 1 USDC (perps) to 0x…" · "moves funds out", From (multi-sig user), Finaliser (leader), "Signers sign under HyperEVM testnet · 0x3e6", "submittable until … (48 h left)", canonical inner action with `"amount": "1"` | ✅ |
| amount 30 with 25 USDC withdrawable | warning "30 is more than the withdrawable perps balance observed just now (25). The chain will reject it unless funds arrive first."; creating stays possible | ✅ |
| Approve API wallet | "Trading becomes single-key" callout and the risk flag in the preview | ❌ → fixed. Risk flags and the canonical action appeared only once a finaliser was chosen; the preview now canonicalises the action on its own. |
| Raw JSON: an `order` action | ""order" is an L1 action (orders, cancels, leverage, vault and sub-account moves). Those are not proposals here." | ✅ |
| Raw JSON: `approveBuilderFee` carrying its own nonce | accepted; "nonce is set by this page (signing chain, network and nonce) and replaced what you pasted."; inner action in canonical key order | ✅ |
| Send spot token on testnet | a usable token list | ❌ → fixed. 1,668 tokens in one flat list; now "Held by this account" first, then "All spot tokens". |
| signing chain Arbitrum Sepolia, window "Give signers 3 days" | "EIP-712 chain 0x66eee (421614)"; "submittable until … (71 h left)" | ✅ |
| preview with a connected wallet | no spurious warnings | ❌ → fixed. "meta.createdBy was mixed case" appeared because the wallet reports a checksummed address; lowercased before it reaches the core. |
| "Create and sign as S1", wallet on Ethereum (repeated after the wallet configuration change) | Rabby moves to chain 998 and shows `HyperliquidTransaction:UsdSend` with `payloadMultiSigUser` = T, `outerSigner` = S2, `destination` = S3, `amount` 1 and `time`; after Sign and Confirm the proposal page reads "Collecting signatures · 1 of 2", "#1 recovers to S1 · valid-authorized", role "signer", "Title (unsigned): Phase 2 milestone" | ✅ |
| wallet outside the signer set (T's own key) | "… is not in the signer set, so it can draft a proposal but not sign it."; "Create and sign" disabled, "Create without signing" works and lands on "Collecting signatures · 0 of 2" | ✅ |

### Proposal page: sign, pass on, merge

| Input | Expected | Result |
|---|---|---|
| Get link | no link until the acknowledgement is ticked; then `…/multisig/proposal#share=…`, "1750 characters." | ✅ |
| the link opened by S2 with an empty history | lands on `?digest=…` with the fragment stripped, document stored, role "signer · finaliser" | ✅ |
| Merge: malformed JSON | "Not a proposal this page can merge · Not a JSON document: Expected ',' or '}' at line 1, column 7" (`proposal.parse`) | ✅ |
| Merge: the same copy again | "Nothing new: still 1 signature" | ✅ |
| Merge: uploaded file whose `r` was altered | "claims S1 but recovers to 0xc49e…91d2; dropped." (`merge.signature_dropped`); still one signature | ✅ |
| Merge: S1's signature relabelled as S3's | "claims S3 but recovers to S1; dropped." (`merge.signature_dropped`) | ✅ |
| Merge: same digest with an `expiresAfter` added | "This copy has the same digest as a stored proposal but a different payload (vault address or expiry). It was not merged." (`history.payload_conflict`) | ❌ → fixed. The refusal was displayed as "Nothing new"; it is now an error with the fix. |
| Digests and canonical envelope before submission | the envelope under the chain the finaliser will sign (`0x3e6`), marked as an assumption until a receipt exists | ❌ → fixed. The panel showed the hash for the default chain `0x66eee`. |
| Sign, then decline in Rabby | "Not signed: You declined in the wallet."; the button returns; the document is unchanged | ✅ |
| three rapid clicks on Sign | one wallet popup | ✅ |
| Download file | `multisig-testnet-<digest8>-2sig.json`: pretty JSON, both signatures, the receipt with its envelope chain | ✅ (the Blob and file name were captured in the page; no file was written) |
| Copy JSON | the same text on the clipboard | ✅ |
| Inspect, then "Open in Multisig Signer" in the inspector | the document round-trips between the two pages through the in-memory hand-off; neither URL carries it | ✅ |

### Finalise: the milestone

| Input | Expected | Result |
|---|---|---|
| S2 (the finaliser) on the proposal with 1 of 2 | one button for what is left; steps "Your inner signature (completes the threshold)", "Envelope signature (wraps the verified signatures)", "Submit to Hyperliquid testnet" | ✅ |
| press it | prompt 1 `HyperliquidTransaction:UsdSend` (S2's inner signature), prompt 2 `HyperliquidTransaction:SendMultiSig`, both under chain 998; then one request to `api.hyperliquid-testnet.xyz/exchange` | ✅ |
| the answer | `{"status":"ok"}`; stage "Submitted · accepted by the chain"; receipt stored in the document; history row "2 signatures · submitted" | ✅ |
| the chain afterwards | T's perps balance 25 → 24 USDC, S3 0 → 1 USDC, an `internalTransfer` in T's ledger (inspector, "Load recent actions") | ✅ |

### Failure paths and edge cases

| Input | Expected | Result |
|---|---|---|
| a document whose nonce is older than the window | "Expired"; "Re-propose" opens the form pre-filled (destination, amount, finaliser, title) under "Re-proposing · … This is a new proposal with a new nonce: signatures do not carry over."; the new document records the old digest in `meta.supersedes` | ✅ |
| same | no dead controls | ❌ → fixed. "Your signature" and "Finalise" each repeated "Expired"; they now render only in phases where they can act. |
| 100 USDC with 24 withdrawable: S2 proposes and signs, S1 (finaliser) signs and submits | the chain answers HTTP 200 `{"status":"err","response":"Insufficient balance for withdrawal."}`; the page shows "The last submission was rejected: …" with cause and fix, steps done · done · failed, the button still enabled, the receipt kept, history "rejected", stage still "Ready · 2 of 2 signatures" | ✅ (Since §11 a refused proposal ends instead: the button could only be answered "duplicate nonce".) |
| same | the message is explained | ❌ → fixed in core. It was "Not in the error catalogue"; errors 1.2.0 adds `transfer-balance` with a test. |
| proposal page with a wallet outside the signer set | role "not in the signer set"; "Only the finaliser 0x… can submit."; no sign or submit button | ✅ |
| `approveAgent` with a 17,000-character name (17,905 bytes) | input note `proposal.large`; link dialog "24108 characters." with `transport.oversize`: "The document is 17905 bytes; chat apps and browsers may cut links over 16384." Fix: "Send the file instead of the link." | ✅ |
| same | page layout holds | ❌ → fixed. The headline did not wrap and the page was 154,229 px wide; headline, detail lines and title now wrap anywhere, here and in the inspector. |
| disconnect while a proposal is open | "Connect wallet" returns, no role, "Connect a wallet to sign.", the stage and the document unchanged | ✅ |
| a copy whose recorded signer set differs from the live one | "The signer set changed since this was proposed · Readiness below is judged against the signer set the chain reports now, not the one recorded in the document."; readiness still from the live set | ✅ |

### Layout, network, console, build

| Check | Expected | Result |
|---|---|---|
| 375 px, start, propose and proposal | `scrollWidth = clientWidth = 375`, no element wider than the viewport | ✅ |
| network | `api.hyperliquid-testnet.xyz/info`, and `/exchange` only when the finaliser submits; the font files; nothing else, and never a server of ours (see "Shell, wallet and storage" for what was removed) | ✅ |
| console | no errors beyond the known extension noise (MetaMask provider, MaxListeners, ObjectMultiplex) and "Lit is in dev mode" from the wallet picker in development | ✅ |
| `bun --bun run build` | succeeds; wagmi and RainbowKit live in a `WalletProviders-*` chunk that neither the entry chunk nor the inspector's chunk references | ✅ |

### Not run in the browser

- Only `usdSend` went on chain through the signer. The other kinds were built and previewed in the form and are accepted by the core in `actions.test.ts`. Withdrawals do not exist on testnet. Nothing was signed on mainnet.
- The Arbitrum signing chain was selected in the form but not signed under. The chain's acceptance of consistent ids (998, 999, 1, 42161) and its "Invalid multi-sig inner signer" for a mismatch were recorded by the lab; the receipt path is covered by `submit.test.ts`.
- An envelope signed by an account other than the finaliser (`envelope.signer_mismatch`) is covered by `roundtrip.test.ts`. The page offers finalising only to the finaliser's wallet.
- A wallet that refuses or cannot switch chains: `walletErrors.test.ts`. Rabby switches without a prompt.
- The in-memory fallback when IndexedDB is unavailable.

Tooling notes: a client-side navigation started inside `evaluate_script` destroys the script's execution context, so navigations were done with `navigate_page` or scheduled with `setTimeout` and read in a second call. Rabby keeps one current account for every site; it was switched on the extension's own page.

## 10. Multisig relay — sign-in, shared treasuries, live proposals

Verified 2026-10-09 and 2026-10-10 against the local Supabase stack (`bun run db:start`; Postgres 17, Auth, Realtime, `pg_cron`) and Hyperliquid testnet, in the user's own Brave instance through the Chrome DevTools MCP (port 9222) with Rabby. The dev server is opened as `http://localhost:3000`: sign-in with Ethereum refuses an IP address as the site, so `127.0.0.1` cannot sign in.

Who plays whom. The browser is one Rabby account, **S1** (also **S2** for the run with no scripts). Co-signers are lab keys from the gitignored lab, **A**, **B** and **D**, driven by scripts that call the same client functions as the page (`src/components/multisig/relay/api.ts`), so they pass the same access rules. Two treasuries: **T** (2-of-3 of the Rabby accounts S1, S2, S3, from §9) and **T2**, a mixed 2-of-3 of S1, A and B whose signer set the scripts can change on chain. An **outsider** key signs for nothing. As in §9, no key of the wallet was read, typed or stored, and its addresses stay out of the repository.

### Database tests (pgTAP)

`bun run db:reset && bun run db:test`: 11 files, 450 assertions, all passing. Each file runs in a transaction against the local database, acts as real wallets (rows in `auth.users` and `auth.identities`) and uses synthetic `0x7e57…` addresses.

| File | What it proves |
|---|---|
| `010_identity` | The wallet is read from `auth.identities` only: lowercased, exactly one Ethereum identity, nothing for a user with an e-mail identity or two identities, nothing from user-editable metadata or JWT claims; `whoami()` for signed-in and signed-out callers |
| `020_treasuries_rls` | A signer reads its treasuries and their signers; a non-signer and a signed-out caller read nothing; no client role can insert, update or delete them |
| `030_requests` | Add and re-check requests: the requester is stamped by the database and cannot be spoofed; 5 adds and 30 re-checks per wallet per hour, 200 pending adds overall; "already listed" and "checked seconds ago" answered at once; a wallet reads only its own requests |
| `035_parse_signers` | Hyperliquid's answer parsed strictly: a signer set, `null`, and everything malformed (HTML, non-200, threshold out of range, more than ten signers, bad addresses) as a retry, never as "not a multi-sig" |
| `040_apply_lookup` | Every branch of the state change: add by a signer, add by a non-signer rejected, not a multi-sig rejected, two simultaneous adds give one treasury, signers diffed with one "signers changed" event, threshold change, frozen after two nulls at least 30 s apart and not before, unfrozen by a later answer |
| `050_queue_worker` | With the network call stubbed: one look-up per run, priority 0 first, the add and refresh lanes alternating, the per-minute cap, back-off on errors and "failed" after six attempts, a 429 pausing that network for 60 s while the other is still served, the disabled flag; sign-in marks become re-checks of that wallet's treasuries not looked at in the last ten minutes (25 at most); the sweep takes treasuries a day stale (a frozen one once a week), 20 per run |
| `060_hook` | The token hook exists, only the auth service may execute it and it holds nothing on the marks table itself; it returns its input unchanged, leaves one mark for a well-formed event, and still returns its input when the insert fails (sign-in can never be blocked by it) |
| `070_proposals` | Every guard on a shared proposal: the document must be the bare canonical one and agree with the columns (missing nested fields are a refusal, not a NULL that slips through), finaliser in the stored signer set, nonce inside the chain's window, caps (30 an hour, 50 open per treasury, 20 per wallet per treasury), frozen treasury refused |
| `080_signatures_endings_receipts` | Signing only as oneself, only while open and unexpired; taking back only one's own; withdraw by the proposer only, decline by the finaliser only, once; receipts by the finaliser only, "accepted" derived from the stored answer, an accepted receipt closes the proposal even after a withdrawal, an accepted signer change is re-checked first |
| `100_matrix` | Signer, outsider, removed signer, signer of a frozen treasury and signed-out caller against every table and every verb |
| `110_live` | A change pings every current signer's channel and the removed ones on a signer change; a wallet may read only its own channel's messages (the first policy let a wallet that had joined its own channel read other topics' rows; found here and fixed) |

`supabase db advisors --local` reports no issues at warning level or above.

### Integration suite

`bun run test:relay` (opt-in; needs the local stack): 33 tests in `src/components/multisig/relay/relay.itest.ts`, with the deterministic keys of `src/test/keys.ts` and a stub info server standing in for Hyperliquid.

| Group | What it proves |
|---|---|
| Signing in | A real wallet signature opens a session that speaks for that wallet; a declined prompt is "cancelled"; a message for another site or from another key is refused; a message is accepted for ten minutes from its Issued At whatever expiry it states (Supabase keeps no nonce store and does not check the expiry; documented, not assumed); a token renewal re-checks the wallet's stale treasuries; sign-out is local |
| Adding a treasury | Stored for a signer, visible to every co-signer without adding; done at once when already listed; refused for a non-signer and for a normal account; one treasury when two signers add it at the same moment |
| Sharing and signing | Publish then sign in the planned order; a co-signer reads it and verifies digest and signature in their own client; sharing or signing twice is "done", not an error; two signers signing at once keep both signatures; a stored signature that does not verify is ignored by the reader; a document filed under a digest it does not carry is refused; taking a signature back is recorded |
| Live updates | Every signer's channel is pinged within two seconds of a change and nobody else's; joining another wallet's channel is refused |
| Ending and results | Only the proposer withdraws, only the finaliser declines; a rejection leaves the row open (the page ends it, see §11) and an acceptance closes; only the finaliser may report; an accepted signer change is looked up ahead of everything |
| A signer removed on chain | Loses the treasury and everything in it once the copy is refreshed, by the sweep or by a co-signer's re-check request |
| Relay unreachable | Every call answers with an "unreachable" issue instead of throwing |

### Relay off: nothing changed

With the two environment variables unset the section has no sign-in anywhere and never loads supabase-js. The §9 flows were run again inside the new shell on treasury T: start, propose, sign as S1, the paste-box hand-off (now landing on `/multisig/open`), 375 px, both themes. Network: Hyperliquid and the font files only. ✅

### Sign-in and session (browser)

| Input | Expected | Result |
|---|---|---|
| "Sign in with your wallet", S1 | one Rabby prompt showing the message ("Sign in to hl-tools Multisig. This only proves you control this wallet: it cannot move funds or approve anything."), the site, a five-minute expiry; then "signed in · live" | ✅ Rabby flags the message on `http://localhost` ("not associated with the website") and wants "Ignore all" before Sign; to be looked at again on the real domain |
| reload | session restored without a prompt; a skeleton while restoring, no flash of "signed out" | ✅ |
| switch Rabby to S2 | "Signed in as S1, but that is not the connected wallet. Nothing is read from or sent to the relay."; zero requests to the relay after a reload in that state; "Sign in as S2" offered | ✅ |
| switch back to S1 | resumes without a prompt | ✅ |
| "Sign in as S2" | S1's session is replaced; S2 sees its own treasuries only | ✅ |
| sign out | local; rail back to "not signed in"; history in this browser untouched | ✅ |
| production build | supabase-js is its own chunk, referenced only from the Multisig section and fetched only when signing in or restoring a session | ✅ |
| session row deleted on the server (with a 60 s token lifetime to see it quickly) | the next renewal fails; "reconnecting…", then "not signed in" and the landing page; local history intact; no relay requests afterwards | ✅ (46 s and 76 s after the deletion) |
| token renewals with that lifetime | each renewal leaves a mark; a treasury whose copy passed ten minutes is looked up again | ✅ T2 re-checked 10 min 16 s after its previous look-up |
| the database reset under a signed-in browser | the stored session is refused and removed; "not signed in" | ✅ |

### Treasuries (browser + scripts)

| Input | Expected | Result |
|---|---|---|
| Add a treasury: T2's address | the browser reads the signer list itself first: "2 of 3 multi-sig · you are one of its signers", then "Add to my treasuries"; the page moves to the treasury | ✅ look-up by the worker in under a second |
| the same address added by lab A at the same moment | one treasury | ✅ |
| lab B signs in without adding | T2 is in its list | ✅ |
| a normal account; a multi-sig S1 does not sign for | refused before anything is sent, in words | ✅ |
| the outsider asks the relay directly | request rejected `not_a_signer`; still lists nothing | ✅ |
| rename, hide, "added by" | nickname kept in this browser and shown in rail, page and lists; hidden treasury leaves the rail; a treasury added by someone else says who | ✅ |
| signers changed on chain while the page is open | "Hyperliquid's signer list differs from the copy kept here … The relay is looking it up now."; the copy follows | ❌ → fixed. A second change within a minute was never picked up (the relay answers a re-check asked within 30 s with "that answer stands"); the page now asks again every 35 s while a difference lasts, six times at most (`nextRecheck`, unit-tested) |
| page load | no "signer set not loaded" flash while the first read is out | ❌ → fixed (a judgement made before the signer set arrived was shown as final) |

### Shared proposals, inbox, endings, history (browser + scripts)

| Input | Expected | Result |
|---|---|---|
| S1 proposes on T2 with lab B as finaliser and signs | shared as it is created; lab A's watcher is pinged and verifies digest and signature itself | ✅ pings in 100 to 260 ms |
| lab A signs by script | the signature appears on S1's page without a reload and without a "judging" flash | ✅ |
| open a file while signed in | nothing is sent; "This proposal is only in this browser" with "Share with your co-signers" | ✅ no relay write until the button |
| `/multisig/proposal?digest=…` signed out, in a clean browser context | "Sign in to open it, or paste the document"; no request reaches the relay | ✅ |
| header on mainnet, proposal on testnet | the page refuses to act and offers a one-click switch | ✅ |
| Copy message | names the treasury, links the proposal, no amount, no destination | ✅ |
| lab A proposes with S1 as finaliser | appears under "Ready for you to finish" within about a second; rail count rises | ✅ |
| a proposal on the other network | a dot on the header's network switch | ✅ |
| 375 px | the rail becomes a "Go to" select with the counts | ✅ |
| take back, sign again | the signature leaves every signer's view; a stale local copy does not bring it back | ✅ |
| lab A withdraws; S1 declines another | status follows live; buttons gone; "Re-propose" offered | ✅ |
| History tab and its export | one sentence per change with the action in words and the unsigned title in brackets; "Export as a file" holds the entries and the documents they refer to | ✅ |

### The milestone (testnet, 2026-10-09)

| Step | Expected | Result |
|---|---|---|
| lab B finalises a ready proposal of S1's by script (envelope signed, POSTed, receipt recorded) | S1's open page shows "Submitted · accepted by Hyperliquid" without a reload, with "As reported by the finaliser's browser. The ledger is the proof."; History lists it; the ledger has the transfer | ✅ 240 ms from the receipt to the page; ledger `internalTransfer` 1.0 USDC, balance 12.8 → 11.8 |
| the reverse: lab A proposes, S1 is finaliser | "Sign and submit" opens two Rabby prompts (the `UsdSend` typed data with treasury, finaliser, destination and amount; then `SendMultiSig`), both read back from the extension page before approval; accepted; receipt on the relay | ✅ |
| no scripts, treasury T: S1 proposes with S2 as finaliser, Rabby switches to S2 | suspended; "Sign in as S2" (one prompt); T is listed without adding; "Sign and submit" (two prompts); accepted | ✅ balance 24.0 → 23.0 |
| the outsider script | 21 checks: empty reads on every table, every insert, update and delete refused, joining S1's channel refused, add rejected `not_a_signer` | ✅ 21 of 21 |
| a send of 100 USDC from a treasury holding 10.8 | Hyperliquid's "Insufficient balance for withdrawal." stored as a rejected receipt and explained; the proposal stays open with "Submit" (one prompt) | ✅ (Since §11: "Refused by Hyperliquid · cannot be sent again", see the order lab.) |

Small things the milestone turned up: a signer with no signature read "not yet" on a finished proposal (now "did not sign"); the propose screen's back link went to the start page instead of the treasury it came from.

### Negative matrix

| Case | How | Expected | Result |
|---|---|---|---|
| Signer removed | B out, D in on chain, S1's treasury page open | the page reports the difference, the copy follows, B reads nothing of T2 any more, D sees T2 and its earlier history | ✅ 21 s after the change |
| The removed signer's signature | a proposal B had signed | "0 of 2"; B's signature shown as present and not counted | ✅ after a fix: the panel now says "Also signed by 0xb70c…36ee, not in the current signer set: it does not count." |
| Removed while watching | S1 rotated out | the treasury leaves S1's rail; the page says it is not in the list | ✅ 27 s after the change |
| Threshold change, signer added back | 3-of-4 including S1; S1 adds the treasury again | rail "3 of 4", history kept, every count against 3; a proposal that was ready is waiting again | ✅ |
| No longer a multi-sig | T2 reverted to a normal account | frozen after two look-ups; history readable; new proposals and signatures refused `relay.treasury_frozen`; nothing asked of anyone | ❌ → fixed twice. The treasury page never asked for the look-up ("no signer set" was read as "not known yet"; `livePolicy`, unit-tested), and a frozen treasury's proposals stayed under "Needs you" with a "Sign" button (now excluded and tagged). Rail, head and Signers tab say "no longer a multi-sig" / "last known signers" |
| A multi-sig again | T2 converted back | unfrozen by itself | ✅ 5 s after the conversion |
| Relay down | `supabase stop` with a proposal open, then a reload | "reconnecting…", after the reload "Relay unreachable. Links and files still work."; the cached proposal opens; S1 signs (one prompt); the Phase 2 share panel returns | ✅ |
| Relay back | `supabase start` | the page reconnects and pushes the signature made meanwhile | ❌ → fixed. It stayed "unreachable" until "Try again"; it now retries by itself (`reconnectDelay`, unit-tested). After the fix: live 3 s after the stack answered, signature on the relay in the same second |
| Relay drops mid-session | stop for 20 s, no reload | "reconnecting…", lists stay on screen, "live" again by itself | ✅ |
| Submitted outside the tool | the finaliser POSTs the envelope without the page | the relay keeps it pending; a later submit is answered "Invalid nonce: duplicate nonce …", stored and explained | ✅ a "Check the ledger in the inspector" link was added to that rejection |
| A relay limit | the outsider asks for add after add | the sixth in an hour: "A wallet may add 5 treasuries an hour. (Wait a while and retry; links and files have no limit.)" | ✅ (the other caps: pgTAP) |
| Hyperliquid's allowance | the worker pointed at a stub answering 429 | that network paused for 60 s; the add shows "Queued behind other lookups"; stored treasuries keep working; the page moves on by itself afterwards | ✅ 2 s after the pause ended |
| A signature filed under another signer's name; a signature altered by one digit | SQL with triggers off | neither counts; the page says so | ✅ after a fix: "2 stored signatures do not verify and were ignored." was only in the collapsed details and is now a warning at the top |
| A document altered under its digest; a finaliser column that disagrees with the document | SQL with triggers off | not shown in any list ("2 proposals on the relay do not verify and are not shown."); by digest: refused with the reason | ✅ after a fix: the heading said "No proposal with that digest"; it now says "The relay's copy of this proposal does not verify" |
| Same digest, another payload held locally | unit tests | not merged (`history.payload_conflict`, `relay.local_conflict`) | ✅ |
| Simultaneous signatures and publishes | integration suite | both kept; one row | ✅ |
| Token hook failing | pgTAP | sign-in still succeeds | ✅ |
| Sign-in rate limit | 50 sign-ins in a row with the limit set to 3 | a clear message | not reachable locally: the per-IP limiter needs the hosted proxy's client-IP header. The 429 mapping is unit-tested ("Too many sign-ins from this network in the last few minutes."); on the hosted checklist |

### Layout, network, console, copy

| Check | Expected | Result |
|---|---|---|
| landing, add, inbox, treasury, proposal at 375 px and narrower (360) | no horizontal overflow | ✅ `scrollWidth = clientWidth` on each |
| both themes, desktop and phone width | reviewed image by image | ✅ (20 captures, table at the end) |
| network, signed out | Hyperliquid and fonts only | ✅ |
| network, signed in | additionally the relay host (REST, auth, one WebSocket); nothing else | ✅ |
| console | no error and no hydration warning beyond the known extension noise | ✅ one browser notice, "A form field element should have an id or name attribute", fixed by naming five fields |
| wording | no screen with the relay in use says private, encrypted, only you, free, no server or "this browser only" | ✅ `copy.test.ts`; the history panel's "Stored in this browser only" was found by eye and now applies only with the relay off |

### Not run, and limits of what was run

- Everything ran against the local stack. The hosted project is a later phase: there the token hook is a dashboard setting, sign-in is rate-limited per IP, and the relay's outbound address decides whether look-ups can stay inside Postgres.
- Nothing was signed or submitted on mainnet. The mainnet rows used for the other-network dot were seeded in the local database.
- Only `usdSend` went on chain through the relay flow, as in §9.
- The signer-set changes were made by lab scripts, not through the page: `convertToMultiSigUser` is refused by the propose screen on purpose. The relay's "accepted signer change is looked up first" rule is covered by the integration suite with a stub.
- Phone-width captures of the Multisig section in the table below are 360 px wide: they were taken in a desktop window emulated at 375 px, where the scrollbar takes 15 px. The start and propose pages were captured again in the new shell with no wallet connected; the signed-in screens were captured as a lab signer (see DECISIONS.md, "Relay screenshots").

## 11. Multisig — the treasury live, attention, nicknames, help

Verified 2026-10-11 against the local Supabase stack and Hyperliquid testnet, in the user's own Brave instance through the Chrome DevTools MCP (port 9222) with Rabby, as in §10. Who plays whom is unchanged: the browser is the Rabby account **S1**; co-signers are the lab keys **A**, **B**, **C** and **D**, driven by scripts that call the page's own client functions; **T2** is the mixed 2-of-3 of S1, A and B; the **lab treasury** `0xf836…d148` (2-of-3 of A, B, C) holds a small position and two resting orders placed by its API wallet, so the tables have something in them. A second, isolated browser context is signed in as lab signer A with a stand-in wallet that cannot sign; it is the co-signer's screen and the source of every committed capture. No key of the wallet was read, typed or stored, and its addresses stay out of the repository.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 68 files, 1,744 tests (core 1,134, app 610), all passing |
| Core coverage | `cd packages/hl-core && bunx vitest run --coverage` | 100 % statements, branches, functions and lines for `adapter`, `multisig` and `rules` |
| Database (pgTAP) | `bun run db:reset && bun run db:test` | 14 files, 784 assertions, all passing |
| Relay integration | `bun run test:relay` | 48 tests, all passing |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean; the relay client is still its own lazy chunk, imported only by the Multisig layout |
| Database advisors | `supabase db advisors --local` | no issues |

New pgTAP files:

| File | What it proves |
|---|---|
| `120_carried_out` (114) | A report only by a stored signer, stamped by the database; the 30-second wait; a transaction of another account, with an error, or with another action rejected; "not found yet" retried and then failed; twins refused; a proposal closed from open, withdrawn, declined and expired; both orders of the race with the finaliser's own receipt ending in "accepted"; one outbound call per worker step with the explorer counted double; 10 reports an hour |
| `130_nicknames` (146) | A nickname is read only by its treasury's signers and never from another treasury sharing the address; a signer's own address only by that signer; uniqueness within a treasury under simultaneous writes; the text rules (length, address-like, reserved words, invisible characters); 60 changes an hour, 500 per treasury; a nickname others gave is dropped when the address becomes a signer; no client role can write the table itself |
| `140_attention` (63) | A view is taken once, as oneself, only for an open proposal, and pings the signers once; markers are read only by their wallet, only move forward, never pass the newest history entry, keep what an update leaves out, refuse a malformed chain part, and are capped at 600 an hour |

`100_matrix` and `110_live` cover the four new tables against every role and verb.

### Money: Overview and "On Hyperliquid" (browser + scripts)

| Check | Expected | Result |
|---|---|---|
| One socket | one WebSocket per network for the treasury on screen; no HTTP polling of balances | ✅ network panel: one socket, two `info` requests a minute (signers, API wallets) |
| Tables move by themselves | the lab API wallet trades by script | ✅ positions, open orders, trades and order history change without a reload |
| Control | a lab script approves an API wallet | ✅ in the box within the minute; "Checked … ago" and the refresh button |
| Hidden tab | nothing asked while hidden; asked again when looked at | ✅ (visibility simulated; a tab driven by DevTools never reports hidden) |
| Sorting | every column of every table, both directions, `aria-sort` set | ✅ 42 sortable columns in 7 tables (balances, positions, open orders, transfers, trades, orders, funding) |
| Relay down | `supabase stop` with a treasury page open | ✅ balances stay live; the page recovers when the stack is back |
| A transfer and its proposal | S1 finalises a send through the page | ✅ the row appears live with a link to its proposal |
| A send made by script | no proposal exists | ✅ "none on record" |
| "View more" | opens Hyperliquid's own page for that account, on the right host per network | ✅ |

### Switching treasuries (browser, 2026-10-11)

The question: with several treasuries in the rail, is anything still subscribed to or fetched for the one just left? Measured in the isolated lab-signer context with a script that records every WebSocket frame the page sends and receives and every request to Hyperliquid, against the dev server and against the production build (`bun --bun run build`, served on another port).

| Check | Expected | Result |
|---|---|---|
| Click from treasury A to treasury B | B's subscriptions asked for, A's unsubscribed, on the same socket, at once | ✅ 53 ms after the click: 4 subscribes for B, then 4 unsubscribes for A; one socket, never closed. Before the fix A stayed subscribed for the three-second grace period |
| Messages for A after the switch | none | ✅ the last one arrived before the click |
| HTTP after the switch (99 s watched) | only B: signers and API wallets at once and a minute later, one ledger read | ✅ nothing for A; a request for A still in flight is cancelled (`net::ERR_ABORTED`) |
| Six clicks through the rail in 1.2 s | never two treasuries subscribed at the end | ✅ 20 subscribes, 17 unsubscribes, the three live channels belong to the last treasury |
| Treasury page → its own proposal → back | no frames at all | ✅ the grace period still spares the same treasury |
| A proposal of one treasury → the other treasury → browser back, twice | a full swap each time | ✅ |
| What a proposal page follows | holdings and the ledger, not the trades | ✅ 4 subscriptions (was 7): perps, spot, open orders, ledger |
| "On Hyperliquid" tab | adds fills, order history and funding; leaving the tab drops them and keeps the ledger a pending proposal needs | ✅ +3, then −3 within the grace period |
| Leaving the treasury for the inbox | everything unsubscribed after the grace period, socket closed | ✅ 3.06 s |
| Signers and API wallets read on page load | once each | ✅ in the production build. The dev server shows each twice, the first cancelled after 9 ms: React StrictMode mounts every component twice in development (`@tanstack/react-start`'s client entry), which a production build does not do |

Known and deliberate: the home screen's "While you were away" reads the API wallets and the ledger of each of the wallet's first ten treasuries, one at a time, at most once in five minutes each (two `info` requests per treasury). A treasury's own page reads only itself.

### The order lab (testnet, 2026-10-11)

"When does Hyperliquid refuse an action because of its number?", asked of every kind of action a small testnet account can run, on a plain account (its own key) and through the lab 2-of-3 (lab keys only; `labs/multisig/41`, `43`; 385 recorded runs joined with their requests into `fixtures/multisig/nonce-order.json`, 247 questions). Each pair sends the action with the newer number first, then one with an older number that was never used. No bridge withdrawal was made: every `withdraw3` asked for 9,999,999 USDC, so it could only be refused, and the wording of the refusal says whether its number was acceptable.

| Question | Answer |
|---|---|
| Which kinds are refused when an older one follows a newer one of the same kind? | Only `usdSend` ("Nonce already used."), on the plain account and through the envelope alike. Accepted out of order: `spotSend`, `usdClassTransfer`, `sendAsset` (to a user, to the account's own spot), `approveAgent`, `approveBuilderFee`, `cDeposit`, `cWithdraw`, `tokenDelegate`, `convertToMultiSigUser`, `userSetAbstraction`, `userDexAbstraction`, `noop`, `order`, `cancel`, `cancelByCloid`, `modify`, `batchModify`, `twapOrder`, `twapCancel`, `updateLeverage`, `updateIsolatedMargin`, `evmUserModify`, `spotUser`, `setDisplayName`, `reserveRequestWeight`, `vaultTransfer` |
| Does a USDC send invalidate older numbers of other kinds? | No. After a newer send, an older action of each kind above was accepted (24 kinds on the plain account, the two mode switches on throwaway accounts, 16 kinds through the envelope). Only an older send, or an older bridge withdrawal, is refused |
| Does a newer action of another kind invalidate an older send? | No, for every kind above (after `userSetAbstraction` the older send was refused for its balance, which comes after the order check) |
| The other fund-moving kinds against each other | all 12 ordered pairs of spot send, class transfer and the two `sendAsset` forms accepted, on both accounts |
| What exactly is the mark? | The highest `time` among the sends carried out (sent 3000, 1000, 2000, 4000, 3500: only 3000 and 4000 went through). One millisecond older is refused; the same number with another leader is refused too. A send that failed for balance does not move it. The order check comes before the balance check |
| A send dated ahead | Dated 40 s ahead: accepted, a send dated "now" refused until the clock passed it, then accepted. Dated 23 hours ahead on a throwaway account: for the rest of the day `sendAsset`, class transfer, spot send and `noop` dated "now" were accepted, a USDC send and a withdrawal dated "now" were refused, a send dated 1 ms after the mark was accepted |
| Bridge withdrawals | A `withdraw3` older than the latest send: "Nonce already used." A `withdraw3` 1 ms newer, or after a newer action of any other kind: "Error withdrawing from bridge" (its number was fine). A refused withdrawal does not move the mark. Not measured: whether a withdrawal that goes through moves it |
| Does the mark belong to the account or to the signer? | The account. A plain account sent, became a multi-sig, and was refused an older send through the envelope; a multi-sig sent, became a plain account again, and was refused an older send with its own key |
| Is a refused request's number free again? | No. An envelope refused for "Multi-sig threshold not met", for "Invalid multi-sig inner signer", or whose action failed for balance, and a plain request outside the window, were each answered "Invalid nonce: duplicate nonce" when sent again, at once, 60 s later and 3 minutes later, also with what was wrong put right. The same number led by another signer was accepted (number sets are per signer) |
| The window and the "100 highest" rule | On accounts that had used few numbers: 3 days old "nonce too low" (the bound is two days before block time), 47 hours old accepted, 23 hours ahead accepted, 2 days ahead "nonce too high" (one day after block time). After one old number and 100 current ones, another old number was refused with the bound equal to the smallest of the account's 100 highest numbers, 5 ms above it accepted, 5 ms below it refused. Through the envelope the set is the leader's: 47 hours old was refused with leader A (hundreds of numbers used that day) and accepted with leader B |
| An account in unified account mode (`labs/multisig/45`) | `usdSend`, `spotSend` and `usdClassTransfer`: "Action disabled when unified account is active". `sendAsset` from the spot balance to another account's spot or perps: accepted. `sendAsset` from the perps balance: "Unified account only supports sending assets through spot". A withdrawal still reaches the bridge check. In standard mode `sendAsset` also moved USDC from spot straight into another account's perps |
| Kinds that could not be run | Refused for the account's size or state, in both orders: `scheduleCancel`, `createSubAccount`, `registerReferrer` (volume), `userPortfolioMargin` (account value), `claimRewards`, `setReferrer`, `topUpIsolatedOnlyMargin`, `borrowLend`. Not sent at all: `sendToEvmWithData` and a real `withdraw3` (they move funds off HyperCore), `linkStakingUser` (permanent), vault, deployer, validator and sub-account management, and the two agent-only kinds |

What changed in the tool because of it:

| Check | Expected | Result |
|---|---|---|
| The recorded answers | the core's `overtakenBy` predicts every step of every question | ✅ 247 of 247 (`order.test.ts`) |
| A send proposed after one that was dated ahead | numbered just after it, with a sentence saying so; a transfer between perps and spot or a spot send is left alone; a withdrawal is raised too | ✅ browser: the second proposal's number is the first's plus one; "70 h left" instead of 48 |
| The longer signing window on a USDC send | a sentence about what dating it ahead does | ✅ |
| A proposal Hyperliquid refused (a send of 9,999 USDC from the lab treasury, submitted by lab B) | "Refused by Hyperliquid · cannot be sent again", the reason, "Re-propose", no submit button; "Cannot be finished" in the inbox | ✅ co-signer's page and inbox. Until this round the page kept offering "Submit", which could only be answered "duplicate nonce" |
| New refusal texts | explained from the catalogue | ✅ "Too many extra agents for cumulative volume traded", "Action disabled when unified account is active", "Unified account only supports sending assets through spot", "Error withdrawing from bridge" (errors 1.4.1) |

### Carried out elsewhere, cannot be finished

| Check | Expected | Result |
|---|---|---|
| The finaliser submits a ready proposal with a script, telling nobody | a co-signer's open page reports the transaction; the relay checks it against the real explorer and closes the proposal for everyone | ✅ three runs: closed 32 s after the page's report each time, within a minute of the transaction, and linked to it; "Carried out outside this tool" |
| A finaliser rotated out of the signer set | "Cannot be finished", nobody asked to sign, "Re-propose" | ✅ |
| A false report | a real transaction of another action; an unknown hash | ✅ rejected, proposal untouched (pgTAP and integration suite) |

### The order of USDC sends (found in this round)

Two sends were pending for T2. The newer one was finalised first; the older one, signed by two and never submitted, was then answered `Nonce already used.` and no money moved. Measured afterwards on the lab treasury with lab keys, twelve pairs of requests (`fixtures/multisig/send-order.json`): a `usdSend` older than one the account has carried out is refused, whoever leads and whatever the destination; `usdClassTransfer`, `spotSend` and `approveAgent` are taken in any order; a failed attempt does not count. Hyperliquid's documentation does not mention it.

| Check | Expected | Result |
|---|---|---|
| The recorded pairs | the core's `overtakenBy` predicts each answer | ✅ 12 of 12 (`order.test.ts`) |
| Four sends of T2 older than a carried-out one | "Cannot be submitted any more" on their pages with "Re-propose"; "Cannot be finished" in the inbox; not counted as needing anyone | ✅ the three that had asked S1 to finish them no longer do; all four are listed under "Cannot be finished" |
| Two sends pending, S1 finaliser of both | the newer one's page warns that submitting it first shuts the older one out, and links to it; the inbox lists the older one first | ✅ |
| S1 finalises the older one through the page | accepted (two wallet prompts) | ✅ |
| A send made by script while S1 looks at a pending send | the page says "Cannot be submitted any more" by itself | ✅ 0.6 s after the exchange accepted the script's send (ledger row, then the explorer) |
| A recorded refusal with this text | the same state, for every signer | ✅ (`stage.test.ts`) |

A second unknown answer turned up while cleaning up: `User has pending agent removal`, for the second of two API wallet removals a second apart. It is in the catalogue too (errors 1.3.0).

### Nicknames (browser + scripts)

| Check | Expected | Result |
|---|---|---|
| S1 names an address | lab A's open page shows it without a reload | ✅ 0.2 s from stored to shown |
| S1 names lab A's address | refused: only that signer | ✅ "Only that signer can choose the nickname of their own address." |
| Lab A names itself; the same address in another treasury | shown in the first, unnamed in the second | ✅ |
| A second address is given an existing nickname (other letter case, trailing space) | refused | ✅ "Another address in this treasury already has that nickname." |
| An address-like name; "You" | refused with its sentence | ✅ |
| A wallet that does not sign for the treasury | refused; reads none | ✅ |
| A row planted in the database: a signer's address named by another signer | ignored by the page | ✅ not shown anywhere (an address-like name cannot even be planted: a check constraint refuses it) |
| Before a wallet prompt | the destination with its full address, and who gave the nickname and when | ✅ |

### Attention

| Check | Expected | Result |
|---|---|---|
| "Seen" | lab B opens a proposal by script while S1 looks at it | ✅ S1's panel changes from "not seen yet" to "seen just now, not signed" 0.2 s later, no reload |
| A tab nobody looks at | the proposal on screen in a hidden tab for 6 s | ✅ no view recorded; recorded 1.1 s after the tab came to the front |
| A wallet that is not the signed-in one | nothing said about who looked, nothing recorded | ✅ "not yet", as before Phase 4 |
| The first marker | written silently at the newest history entry; nothing "while you were away" on the first visit | ✅ |
| S1 away | lab keys finalise a send without S1, approve an API wallet with a script, send 1 USDC with a script, and submit a proposal S1 had signed with a script | ✅ on return the notice lists all four within 1.6 s (the relay's two at once, then the API wallet, then the transfer once its transaction was compared); a dot on "Needs you" and on the treasury |
| "Got it" | the group goes, the dots go, a reload keeps it gone; lab A's notice is untouched | ✅ |
| "Mark all as read" | one request for every treasury shown | ✅ two markers in one insert |
| Requests | only the local relay and Hyperliquid: two `info` reads per treasury, the explorer only for transfers that could be a proposal's | ✅ |
| Tab title | "(2) Multisig — hl-tools"; follows the inbox live; survives navigation inside the section; plain outside it | ✅ (2) → (3) 0.2 s after a script's proposal |
| "Expires soon" | a proposal with 17 hours left | ✅ "expires in 17 hours", the local time on hover; not shown on one that cannot be finished |

### Help

| Check | Expected | Result |
|---|---|---|
| Every text | no promise of secrecy, price or serverlessness; none of the developer's words; at most 290 characters | ✅ `help.test.ts`, 30 texts |
| Hover, keyboard focus, tap | opens; stays open after a tap; Escape and a click elsewhere close; the focus stays where it was | ✅ |
| Phone width | every hint on the inbox, the treasury tabs, the proposal, the propose form and the add screen opens inside the viewport and does not cover its mark | ✅ 41 marks checked at 375 px |

### Negative matrix

| Case | How | Expected | Result |
|---|---|---|---|
| Socket dropped | network off for 20 s on a live treasury page, then on | "Reconnecting…", live again by itself, no duplicated rows | ✅ "Reconnecting…" after 19 s, "Not updating" after three failed attempts, "Live" 0.5 s after the network returned; 45 rows before and after, the same ones |
| Eleventh account on one network address | cannot be provoked: Hyperliquid does not enforce the cap | "Live updates unavailable" with "Try again" | unit tests only (`wsHub.test.ts`, the store's `refused` state) |
| Explorer answering 429 | `fetch` to the explorer replaced in the page | "could not check"; nothing called "none on record" that could be a proposal's; no report filed; look-ups paced | ❌ → fixed. The cells were right (10 "could not check" after three paced attempts each, 30 requests in 70 s), but the notice said that API wallets could not be checked although they had been read. It now says that some transfers could not be checked yet and stay unread |
| The finaliser's report after "carried out outside" | pgTAP, both orders | ends as "accepted", once in the Signing log | ✅ |
| Twin proposals | pgTAP and `match.test.ts` | neither closed automatically; the row says it matches more than one | ✅ |
| Look-alike address named "Auditor" | script | the copy is refused as taken; the full address is on screen before signing | ✅ |
| Marker from another wallet; marker past the newest entry; a malformed chain part | pgTAP and integration suite | refused | ✅ |
| "Got it" on two devices at once | integration suite | both taken, nothing comes back | ✅ |
| More than ten treasuries | `treasuriesToCheck` | the first ten are asked about, the rest say so and are checked when opened | unit test only |
| Signed out | home, a treasury link, a proposal link | no notice, no marks, plain title | ✅ no request to the relay or to Hyperliquid at all |
| Relay off, relay unreachable | every new hook is switched by the relay's mode | Phase 2 and Phase 3 behaviour | by construction; the money part with the stack stopped was run (above) |
| A role tag before the signer set is read | found while testing | no "not a signer" verdict without a signer set | ❌ → fixed (`stage.test.ts`): the proposal page flashed "you: not a signer" at a signer while loading |
| Hydration, phone width, both themes | full loads of the inbox and a treasury page; every new screen at 375 px and 1440 px in both themes | no console message; `scrollWidth = clientWidth` | ✅ |

### Not run, and limits of what was run

- Everything ran against the local stack and testnet. Nothing was signed or submitted on mainnet.
- The order of `usdSend` was measured on testnet, through multi-sig envelopes. `withdraw3` and `sendAsset` were not tried (no withdrawals in testing), and a plain account was not tried.
- The inbox learns that a send was overtaken from the proposals on record. A newer send made with another tool is noticed on the proposal page, which has the ledger, and by every signer after the first refused attempt.
- "More than ten treasuries" and "live updates refused" have no browser run: the first needs eleven real multi-sigs listing one wallet, the second a limit Hyperliquid does not enforce.
- The committed captures of "On Hyperliquid" are of a tall viewport, not of the full page (see DECISIONS.md).

## 12. Multisig — sends as `sendAsset`, account modes, the fee notice

Verified 2026-10-11 against Hyperliquid testnet and the local Supabase stack, in the same two browsers as §11: the user's Brave with Rabby as the account **S1** (every wallet prompt read before it was approved; no key read, typed or stored), and the isolated context signed in as lab signer **A** with a stand-in wallet that cannot sign. Treasuries: **T2**, the manual 2-of-3 of S1, A and B; **TU**, a 2-of-3 of the same three in unified account mode, made for this round; the **lab treasury** (manual, lab keys A, B, C); and **TUL**, a unified 2-of-3 of lab keys only, made for the committed captures. No migration changed in this round, so the database tests were not run again.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 73 files, 1,968 tests (core 1,288, app 680), all passing |
| Core coverage | `cd packages/hl-core && bunx vitest run --coverage` | 100 % statements, branches, functions and lines for `adapter`, `multisig` and `rules` |
| Relay integration | `bun run test:relay` | 48 tests, all passing (unchanged) |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean; the relay client is still one lazy chunk, imported only by the Multisig layout |

New test files: `test/multisig/transfer.test.ts` (core: every recorded send replayed against `sendRefusal`, `landsIn` and `activationCharge`), `model/send.test.ts`, `model/sendCheck.test.ts`, `model/mode.test.ts` (app), `src/store/hydrated.test.ts` (a jsdom hydration test).

### What was measured first (testnet, lab keys, scripts)

Recorded into `fixtures/multisig/send-modes.json` (78 sends, 6 mode switches) and `activation-fee.json` (49 sends). No bridge withdrawal was made.

| Question | Answer |
|---|---|
| Which ways of sending does a manual account have? (`default` and `disabled` behave alike) | All of them: `usdSend` (perps to perps), `spotSend` (spot to spot), `sendAsset` between any two balances, `usdClassTransfer` between its own two |
| And a unified account? | `usdSend`, `spotSend`, `usdClassTransfer`: "Action disabled when unified account is active". `sendAsset` from perps: "Unified account only supports sending assets through spot". Only `sendAsset` from spot goes through |
| Does the receiver's mode ever refuse a send? | No. A manual receiver gets it in the balance named; a unified one in its single balance, whatever was named |
| A token that is not USDC, into a perps balance | Refused ("Invalid token") |
| The same through a multi-sig | The same answers. An account keeps its mode when it becomes a multi-sig |
| First send to an address never used, by `usdSend` | 1 USDC is taken out of the amount: 5 sent, 4 arrive. An amount of 1 or less is refused ("Usd transfer is smaller than fee.") |
| The same by `spotSend` or `sendAsset` | The receiver gets the whole amount. The sender pays 1 USDC on top: from its spot USDC when what is left there covers it, from perps otherwise; if neither can, "Insufficient USDC balance for token transfer gas." |
| A send to an address in use | Costs nothing, by every method |
| An API wallet address that never held funds | Charged like a new address, and stays an API wallet |
| A unified account with a position and a resting order: how much can be sent? | Exactly the USDC total less `hold`. One cent more was refused, and so was the "after maintenance" figure Hyperliquid also reports |

### The send form, the mode, the check before submitting (browser)

| Check | Expected | Result |
|---|---|---|
| The mode is read and shown | T2 "manual account", TU "unified account", with the signer set and API wallets | ✅ three `info` requests on load and three a minute, none after leaving the page |
| A mode changed elsewhere | noticed within a minute | ✅ (the answer was replaced in the page; the tag, the balances shown and the choices offered followed at the next read) |
| Send USDC on a manual treasury | "Taken from" with each balance, "Arrives in", the action a `sendAsset` | ✅ |
| Send USDC on a unified treasury | no "Taken from", no "Perps ↔ spot", taken from the one balance (`sourceDex: "spot"`) | ✅ |
| The fee line | "costs nothing" for an address in use; "costs 1 USDC, once", who pays and from where, for a new one; "one balance" for a unified receiver | ✅ all three, and "cannot pay both" when the balances do not cover amount plus fee |
| A send to a new address, end to end | S1 proposes 0.5 USDC from T2, Rabby shows `HyperliquidTransaction:SendAsset`, lab B signs, S1 submits | ✅ accepted. T2's perps balance 2.3 → 0.8 (0.5 and the 1 USDC fee), the receiver's 0 → 0.5; "On Hyperliquid" shows the row with fee 1 USDC, tied to the proposal |
| The check before submitting | an old-style `usdSend` proposed for TU by script, signed by A and B, S1 presses Submit | ✅ "Not submitted. Nothing was signed or sent…": five fresh `info` reads, no wallet prompt, no request to the exchange. The page already said "Cannot be sent while the treasury is a unified account" with "Re-propose" |
| Re-propose from there | the new form, as Send USDC from the one balance | ✅ |
| The Overview of a unified treasury | TU with a 0.0002 BTC long and a resting buy placed by script | ✅ Balance 24.29, Can be moved now 21.97, In use 2.32, against Hyperliquid's total 24.287578 and hold 2.315777. The form warned at 23 USDC: less than the balance, more than can be moved |
| A manual treasury | three figures as before | ✅ |

### Negative matrix

| Case | Expected | Result |
|---|---|---|
| Two sends pending, the newer submitted first | both go through; no ordering warning | ✅ S1 submitted the newer (nonce …917741), then the older (…905151): both accepted |
| An old `usdSend` still pending, a newer one carried out | the newer one's page warns that it shuts the older out; the older reads "Cannot be submitted any more"; "Re-propose" opens the new form | ✅ and the check before submitting let the valid old-style send through |
| A new address the treasury cannot pay the fee for | warning in the form; the check stops the submission | ✅ 0.5 USDC with 0.6 in the treasury: `transfer-gas`, nothing signed or sent |
| The address comes into use before submitting | the fee line says "costs nothing"; the same proposal goes through | ✅ accepted, 0.6 → 0.1, no fee. ❌ → fixed first: a page left open kept announcing the fee; it now asks again every minute while the address is new |
| A send from perps proposed for a unified treasury | the form warns; the proposal's page says it cannot be sent, with "Re-propose" | ✅ |
| A manual treasury whose money sits in spot | the form defaults to Spot | ✅ (the lab treasury, moved by script and back) |
| A unified receiver | no "Arrives in" question | ✅ |
| The receiver look-up fails, or is slow | "could not be checked", creating still possible; "Checking…" then the answer | ✅ |
| The mode cannot be read | both balances offered, with a warning | ❌ → fixed: the form said nothing. It now warns that a unified treasury would be refused a payment from perps (`actions.test.ts`) |
| `portfolioMargin`, `dexAbstraction`, an unknown value | like unified and labelled not tested; like manual and labelled; both balances with a caution | ✅ (answers replaced in the page) |
| Send spot token | decimals per token (PURR 5, HYPE 8), USDC allowed, spot to spot | ✅. ❌ → fixed: a token the treasury holds none of gave no balance warning |
| A send written as raw JSON | the fee line under the JSON box | ❌ → fixed: it was shown under the Destination field only |
| Relay not configured; signed out; relay unreachable | mode, balances, fee line and creating work from Hyperliquid alone | ✅ all three (a second dev server without the relay variables; another origin; requests to the relay refused in the page) |
| Switching between treasuries of different modes | only the one on screen is read | ✅ recorded for a minute each: three control reads for the treasury on screen, none for the one left; its four subscriptions dropped on the same socket |
| Opening `/multisig/propose` directly | no hydration warning | ❌ → fixed: an occasional mismatch, from the network store's "restored" flag (`hydrated.test.ts`); two reloads clean afterwards |
| Phone width, both themes | no sideways scroll on the form, the proposal page and the Overview | ✅ `scrollWidth` = 375 |
| The newest row of "On Hyperliquid" | tied to its proposal first | ❌ → fixed: rows were looked up oldest first (`match.test.ts`) |

### Not run, and limits of what was run

- Everything ran on testnet and the local stack. Nothing was signed or submitted on mainnet.
- Portfolio margin and the discontinued DEX abstraction were not measured (an account cannot simply be put into them); the page treats them by the documentation and says so.
- No bridge withdrawal was made, so nothing is known about a withdrawal from a unified account. "Withdraw" is unchanged.
- A treasury's mode was not switched through the page: the tool does not offer it. TU and TUL were switched as plain accounts before they became multi-sigs.
- `sendAsset` to another perps market run by a builder, to a sub-account or to HyperEVM is not built by the form and was not tried through it.
- The read-only Multisig Inspector still shows a unified account with a perps and a spot balance.

## 13. Multisig — creating and changing a treasury

Verified 2026-10-12 against Hyperliquid testnet and the local Supabase stack, in two browsers: the user's Brave with Rabby (the wallet accounts **S1** and **S3**; every prompt read before it was approved; no key read, typed or stored, and the accounts' addresses stay out of the repository), and an isolated context with a stand-in wallet for lab accounts whose keys stay in a local process (see DECISIONS.md, Testing). Lab accounts used as throwaway treasuries: x5 `0x67e7…f105`, outsider `0xed95…c915`, x4 `0xf398…7c8d`; signers lab A `0x5e7c…7216`, B `0xb70c…36ee`, C `0x41e8…55b9`, D `0xb037…db15`. All of them, and S3, are normal accounts again.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 86 files, 2,166 tests (core 1,337, app 829), all passing |
| Core coverage | `cd packages/hl-core && bunx vitest run --coverage` | 100 % statements, branches, functions and lines for `adapter`, `multisig` and `rules` |
| Relay database | `bun run db:reset && bun run db:test` | 14 files, 807 pgTAP tests, all passing; `supabase db advisors --local`: no issues |
| Relay integration | `bun run test:relay` | 52 tests, all passing |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean; the relay client is still one lazy chunk imported only by the Multisig layout; the wizard is its own chunk and names no host |

New test files. Core: `test/multisig/plain.test.ts` (a conversion signed by the account itself: byte-identical to the `@nktkas/hyperliquid` SDK, every recorded conversion recovers to its account), `test/multisig/agentReach.test.ts`. App: `model/signerSet.test.ts`, `create.test.ts`, `change.test.ts`, `convert.test.ts`, `lookups.test.ts`, `selfTreasury.test.ts`, `apiWallet.test.ts`, `relay/register.test.ts`, `relay/lastSigned.test.ts`, `live/useSelfTreasury.test.ts`, `src/lib/wording.test.ts`. Extended: `actions`, `stage`, `sendCheck`, `relay/copy`, `relay/timeline`, `relay.itest.ts`, and the pgTAP files `040_apply_lookup`, `110_live`.

### What was measured first (testnet, lab keys, scripts)

| Question | Answer | Where it lives |
|---|---|---|
| Can an account that never received funds convert itself? | No: "Must deposit before performing actions." | blocked in the wizard; `plain-convert.json` |
| Is an address never used accepted as a signer? | No: "Multi-sig authorized user must exist on L1" | blocked on its row |
| A vault or a sub-account as a signer? | No: "Multi-sig authorized user cannot be vault or sub-account" | blocked; errors 1.6.0 |
| An API wallet as a signer? | Only when the address holds funds itself; `userRole` cannot tell | warning |
| Another multi-sig as a signer? | Yes; its own key signs, not its signers | warning |
| Which signing chains does a plain conversion accept? | HyperEVM (both networks' ids), Arbitrum One, Arbitrum Sepolia, Ethereum | the wizard keeps the wallet's chain |
| How soon is the new signer list readable? | about 0.3 s after the answer, which takes about 0.85 s | read back before "done" |
| A send from an account to itself | `usdSend`, `spotSend`: "Cannot self-transfer."; `sendAsset` into the same balance: "Invalid send"; into the other balance: accepted | `self-send.json`, transfers 1.1.0 |
| What can an API wallet of a multi-sig do without the signers? | deposit into a vault, move between the account's own balances; not send to another account, not withdraw | `agent-reach.json`, multisig 1.3.0 |
| Does a signer that converts its own account keep signing elsewhere? | Yes, and it can still lead there | multisig 1.3.0, `convert-own-key` |

### The milestone: a treasury from nothing (Brave + Rabby, 2026-10-12)

| Step | Result |
|---|---|
| S1 signed in, Rabby switched to S3, `/multisig/create` opened | the sign-in gate: "The connected wallet is not the one signed in…", no wizard |
| "Sign in" as S3 | the wizard: "You are converting your own account", its mode and balances |
| Three signers pasted (S1, lab A, lab B) | each "In use on Hyperliquid." within about a second |
| "2" chosen | "Any 2 of the 3 signers can act." with the stolen and lost lines; the button names the account and "2-of-3" |
| Rabby's prompt | primary type `HyperliquidTransaction:ConvertToMultiSigUser`, Testnet, the three addresses and threshold 2, signed by S3 |
| After the signature | success screen 1.5 s later, read back from Hyperliquid; "Its signers find it in their list" 1.3 s after that; the wallet box shows "treasury account · 2 of 3" |
| "Sign out and open the treasury", Rabby back to S1, sign in | the treasury is in S1's list, its Pending tab says "Create your first proposal"; lab A sees it marked "new", "Registered by the account itself when it was converted" |
| Time | 47 s from the first click to registered; 81 s until S1 had it in the list, wallet switches included |

The same flow with a lab account and the stand-in wallet: sent at 0.1 s, read back at 1.2 s, success screen at 1.4 s, registered at 2.6 s.

### Change signers, waiting proposals, convert back (testnet)

| Check | Result |
|---|---|
| Replace a signer through one proposal (lab treasury x5, lab keys) | accepted 1.5 s after "Submit"; the relay's signer copy followed one second later |
| Two waiting sends, then "replace lab B by lab C" proposed by S1 (the treasury S3 had become) | listed before anything was created: one "can no longer be submitted: 0xb70c…36ee was to submit it", one "loses the signature of 0xb70c…36ee: 0 of 2 left" |
| Rabby's prompt for the change | the treasury, the finaliser, the new list with threshold 2: what the hint under "Your part" says |
| After lab A signed and submitted | the first send read "Cannot be finished", the second "Collecting signatures · 0 of 2": as listed |
| The carried-out change opened from a plain link in a fresh browser context | "In effect · The treasury's signers on Hyperliquid are the ones this proposal asks for." and no "Your part" |
| A change that lowers the number and removes its own proposer and submitter (lab D on x5) | "You are removing yourself…", "The signer who will submit this proposal is removed by it. They can still submit it.", "W1 … becomes ready to submit: 1 of 1"; after D submitted the page said "Submitted" and the treasury left D's list within 5 s; W1 then read "Ready · 1 of 1" |
| The number raised again | "W1 … no longer has enough signatures: 1 of 2" |
| Convert back, from the Signers card (S1 with Rabby, lab A finalising) | the guided form listed both waiting sends as "can no longer be submitted"; Rabby showed `"signers": "null"`; accepted in 1.5 s; Hyperliquid reported no signers at once; the relay marked the treasury "no longer a multi-sig" 32 s later, and S1's list, the page head and the Signing log said so |
| "Last signed" (lab A's view) | "last signed 14 minutes ago" for two signers, "no signature here yet" for one who had not signed there; the exact time on hover |
| Connected as a treasury account | the tag on every page of the section; the sentence with the signers' addresses on that treasury's page (signed in and signed out), in "Your part" and on the propose form; not on the home screen |

### Negative matrix

| Case | Result |
|---|---|
| The wallet's account is switched while the wizard is open | ✅ the sign-in gate replaces it; no prompt opens |
| The wallet signs with another key (stand-in signing as lab D for another account) | ✅ "Not converted. Nothing was sent: the wallet signed with 0xb037…db15, not with 0xed95…c915." Both accounts untouched on Hyperliquid |
| Rejected in the wallet | ✅ the form stays as it was. ❌ → fixed: the sentence quoted the core ("The signer refused or failed: …"); it now reads "Nothing was signed or sent. You declined in the wallet." |
| The account has never been used | ✅ button off: "…has never received anything on Hyperliquid, so it cannot send the conversion yet." |
| The account is already a multi-sig | ✅ button off with the reason; "Register it" offered and answered |
| 14 things pasted: 12 addresses, a duplicate, the own address, a bad checksum, a non-address | ✅ ten kept, "2 addresses were left out…", "Not an address: not-an-address.", own address blocked, checksum amber |
| A signer never used, then funded, then "Check again" | ✅ blocked, then "In use on Hyperliquid." and the button on |
| A signer look-up fails | ✅ amber "Could not be checked…", the button stays on; "Check again" answers |
| The request never leaves; the answer is lost | ✅ "Not converted … the account is not a treasury. You can try again."; and the success screen from the read-back |
| The relay's add limit is reached | ✅ "The account is converted, but it could not be added to its signers' lists just now. Any signer can add it under “Add an existing one”.", with "Register it" again |
| A signer signs in afterwards | ✅ the treasury is in the list, marked new, "Registered by the account itself when it was converted" |
| A document whose unsigned note of the signers was rewritten | ✅ "What changes" unchanged: "Compared with the signers Hyperliquid reports for this treasury now." |
| A signer change pasted as raw JSON | ✅ refused. ❌ → fixed: the way out was in a part of the message the field does not show; the sentence now says "choose “Change signers” above" |
| A withdrawn change, "Re-propose" | ✅ opens in Change signers with the same list, number and "what changes" |
| A send from the treasury into the same balance of itself | ❌ → fixed (found while wiring the measured rule): the form only warned; it now stops with the reason, as do the check before submitting and the proposal's page |
| No relay configured (a second dev server) | ✅ the wizard works on the connected wallet, contacts only Hyperliquid and registers nothing. ❌ → fixed: its opening sentence said "the account you are signed in with" |
| Phone width, both themes, console | ✅ wizard, Change signers and Convert back at 375 px without sideways scroll; console empty on direct loads |

### Not run, and limits of what was run

- Nothing on mainnet. No hosted Supabase project: the local stack only.
- S3's own key was not used again after the conversion back (the tool offers no action for it). That an account's own key acts again was measured with a lab account, which converted itself a second time afterwards.
- The relay answering "not a multi-sig" a moment too early could not be provoked; the retry rule is unit-tested.
- A signer whose last signature is older than the newest 500 is covered by a unit test of the window and an integration test of the one-row read, not by a treasury with that much history.
- Signers that are API wallets, vaults or sub-accounts were tried by script (above), not through the form on a live conversion.
- The wizard was not run with a hardware wallet or with WalletConnect.

## 14. Multisig — hardening after the mainnet audit (2026-10-12)

A second session used the signer for a night on mainnet and testnet (three conversions with the wizard, twelve proposals, sends, a bridge withdrawal, sign-in and sign-out in every order) and compared it with the one hosted alternative. It wrote up 27 numbered findings and a list of polish points; its report stays out of the repository because it names personal accounts. This section records what was changed for each finding and how the change was checked.

The browser checks below were made by that session, not by the one that wrote the fixes: Brave with Rabby against this working tree on `http://localhost:3000` and the local relay, on testnet unless a row says mainnet (the mainnet rows are its own re-checks on its own accounts). Each batch was tested only after it was committed, and every row was answered pass or fail.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 91 files, 2,221 (core 1,340, app 881) tests, all passing |
| Core coverage | `cd packages/hl-core && bunx vitest run --coverage` | 1,340 tests; 100 % statements, branches, functions and lines for `adapter`, `multisig` and `rules` |
| Relay database | `bun run db:test` | 14 files, 807 pgTAP tests, all passing; `supabase db advisors --local`: no issues. Not reset this time (the auditing session's data was in it); no migration changed |
| Relay integration | `bun run test:relay` | 53 tests, all passing |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean |

New test files: `src/lib/thirdParty.test.ts` (no other host in the document head or the stylesheet), `multisig/model/pageNetwork.test.ts`, `repropose.test.ts`, `refusal.test.ts`, `multisig/relay/session.test.ts` (the sign-in swap against a stand-in client). Extended: `src/lib/signerWallets.test.ts` (builds a wagmi configuration and checks its connectors are exactly `injected` and `safe`; what there is to connect to, with a stand-in `window`), core `transfer`, `describe` and `errors` tests (the withdrawal fee), `model/actions`, `send`, `sendCheck`, `convert`, `chain/match`, `relay/away`, `relay/timeline`, `relay/inbox`, `history`, `signerSet`, `create`, `stage`, `help`, and one case in `relay.itest.ts`.

### Findings, what changed, how it was checked

| Finding | What was wrong | Now | Checked |
|---|---|---|---|
| F-C1 | "Re-propose" on a testnet proposal, header on mainnet, opened a mainnet form filled with the testnet proposal's fields | the link names the proposal's network; a source of another network or treasury is refused with "Nothing was copied from it" | browser, testnet; and on an address that is a treasury on both networks (mainnet): the form opened for testnet, and moving to mainnet gave an empty form with the sentence. Unit: `repropose.test.ts` |
| F-C2 | the propose form and the wizard took the network from the header: a reload or a second tab could move a form to the other network | `?network=` in the link; link wins on open, header wins when moved, form rebuilt on any change | browser: reload with the stored network forced to the other one kept the form; a link without a network got it written in; the header's switch moved link and form together. Unit: `pageNetwork.test.ts` |
| F-015 | the wizard signed a mainnet conversion under whatever chain the wallet was on (998 in the prompt) | a chain of the network being converted on | browser: mainnet prompt "Chain HyperEVM" (999) with the wallet on 998; testnet prompt 998 with the wallet on 999 |
| F-011 | a withdrawal of 1 USDC or less went all the way to a refusal that used up the number; the form never said the fee comes out of the amount | refused in the form; the preview says what arrives; the check before submitting catches a raw one; the answer is in the catalogue | browser: 1, 0.5 and 1.0 refused with the sentence; 2 gives "1 USDC arrives", 5 gives 4; a raw `withdraw3` of 1 was stopped at Submit with no wallet prompt |
| F-019 | a bridge withdrawal's ledger row was never tied to its proposal | matched by the row's `nonce` | browser: testnet and mainnet rows now name their proposal |
| F-022 | a raw `userSetAbstraction` built a proposal Hyperliquid refuses, explained with causes that did not apply | refused in the form with a sentence | browser |
| F-006, F-007, F-005 | no checksum note on a destination; the zero address accepted silently as a destination and as a signer | amber notes under the field; the field keeps the capitals as typed | browser: send, withdraw, wizard, Change signers |
| F-008 | withdrawn by the auditor; what was left was a line calling the treasury's own address "in use, costs nothing" | that line is not shown for the treasury itself or the zero address | browser |
| F-013 | "it can be retried" about a refusal that had used up the number | worded from the HTTP status by one function | browser: Signing log and "while you were away" |
| F-016 | an API wallet address already in use on Hyperliquid got no note | an amber note | unit only (`actions.test.ts`): the auditing session does not approve API wallets |
| F-027 | three clicks in one instant on Create made three proposals | one | browser: three same-tick clicks, one proposal |
| F-024 | fonts came from Google on every load | bundled | browser: hard reload with the cache off, no request to a font host; both faces load from the site. Suite: `thirdParty.test.ts` |
| F-025 | picking MetaMask or Rainbow without the extension opened a socket to WalletConnect's relay, then again on every load; Base Account opens Coinbase's pop-up | those entries are gone; "Browser Wallet" only for a wallet that injects without announcing itself; with no wallet the buttons say so | browser, fresh context with no wallet, `fetch` and `WebSocket` wrapped: nothing third-party on the click or on a later load, also with the old remembered choice put back by hand. With stand-in providers in an isolated context: a wallet that announces itself gives only its "Installed" row, a provider that only injects gives "Browser Wallet"; with Rabby itself connected the rail shows no note (Rabby's own picker row was seen before the last change, not after). Suite: `signerWallets.test.ts` |
| F-002 | "Sign in as another wallet" ended the session before the wallet had signed | the session stays until the new one exists | browser: declined, still signed in as the first wallet and back to "live" with no prompt after switching back; signed, the new wallet's treasuries only. Local relay by script: the replaced session's renewal token is refused |
| F-001 | the server's HTML said "Sign in with your wallet" while the page was still loading: on a slow connection for half a minute, in front of a signed-in signer | the session starts as "checking"; the network switch announces no choice until the stored one is restored | browser, throttled to Fast 3G: "Checking your session…" until the session was read (33 s in the development build), "Sign in" never shown |
| F-009 | one wallet's "Signature added" stayed on the page after switching to another wallet | the signing panel's state belongs to the connected wallet | browser |
| F-010 | rule codes and field paths in the section's messages; advice about `buildEnvelope` after an answer the catalogue does not know | a plain issue list in the section (the code on hover); one plain sentence | browser: "Not created yet", the check before submitting, merge errors. The sentence for an unknown answer: unit only |
| F-012 | the Remove buttons in Change signers shared one accessible name | "Remove 0x…", "Undo: keep 0x…" | browser, accessibility tree |
| F-014 | "Finish the oldest first" under any two waiting proposals, guided sends included, on the Pending tab and under the inbox's first group | said only when two waiting actions of one treasury are bound by order | browser, Pending tab: two guided sends, nothing; one raw `usdSend` added, nothing; two raw, the sentence. Inbox: one guided send ready, no order sentence; the inbox with two order-bound actions ready was not staged (four more signatures), that half is unit-tested (`inbox.test.ts`) |
| F-018 | "Sign and submit" on a row that only needed submitting | "Submit" once the finaliser has signed or the others reached the number | browser: Pending tab and inbox |
| F-023 | a former multi-sig kept its waiting proposals in the rail's and the tab's count, and its API wallet card spoke of signers | listed under a line that says why, not counted; the card's sentences fit an ordinary account | browser |
| F-017 | a bare "Not Found" under `/multisig` | a page inside the section's frame, HTTP 404 | browser |
| F-021 | subtle text below AA contrast (4.28:1 on white) | 4.62:1 at worst in the light theme, 4.76:1 in the dark one | browser, light theme: no visible text below 4.5:1 |
| F-026 | merging a copy with a rewritten note added the note while the page said "Nothing new" | the stored copy's unsigned fields stay as they are | browser, also after leaving the page and coming back |
| F-020 | on a treasury page the header's network switch did nothing | it leaves for the other network's inbox | browser |
| Polish | "Fix the fields marked on the left"; the site's skip link landed in front of the section's panel; moving between two propose links by the browser's history kept the old form; the lines about stolen and lost keys counted the zero address as a working key; a merge message began with a field path; "carried out outside this tool" | one blocking sentence, or "Fix the marked fields first."; a second skip link; the form is rebuilt per link; only signers who can sign are counted, and a list nobody can sign with says the account would be locked; a sentence; "carried out, not reported here" | browser, with real key presses for the skip links; the wizard's lines were read, never acted on. The "not reported here" sentences were read in the source: the case could not be provoked a second time |

### Left as it is, and limits

- **F-003** (Rabby shows a red alert on the sign-in message from `http://localhost`): needs the production origin; nothing to change until there is one.
- **F-004** (a proposal finished while signed out stays pending in the relay until a signer has the treasury page open): as designed; the wording it produced was changed ("carried out, not reported here").
- **The "Get link" dialog and its tick box**: the one pop-up in the section. It is the hub's sharing rule (DECISIONS.md, "Sharing uses the URL fragment, behind an explicit confirmation") and was left.
- **Zero address as the only signer**: still only a warning, by the three-level rule, since Hyperliquid takes it; the page now says that nobody could ever sign.
- Not built in this pass: one session per wallet, a draft of an unsaved propose form, a way for any signer to say no, notifications, staking actions.
- An answer from Hyperliquid that the catalogue does not know could not be provoked; its sentence is unit-tested.
- The faucet miner is unchanged: its wallet picker keeps the WalletConnect entries, whose modal contacts WalletConnect and, when it opens, loads its own font from Google.
- Two signers online at the same moment were not tried in this pass (the auditing session has one wallet).
- Mainnet was touched only by the auditing session, on its own accounts. No hosted Supabase project.

## 15. Multisig — several wallets stay signed in (2026-10-12)

Until now the browser kept one relay session, so a signer who holds two of a treasury's keys signed in again on every switch of account. Each wallet now keeps its own session, and the one in use is always the connected wallet (DECISIONS.md, "Several wallets stay signed in"). This is the sign-in path, so it was tested at three levels: the rule by itself, the sessions against the local relay, and the page in a browser with real account switches.

The browser rows were run by the auditing session of §14, not by the one that wrote the code: Brave with Rabby on `http://localhost:3000` against the local relay, testnet, with three of the wallet's accounts (**A** and **B**, signers of one test treasury, and **C**, which had never signed in). No slot's value was printed at any point; storage was checked by key name.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 94 files, 2,288 tests, all passing |
| Relay integration | `bun run test:relay` | 65 tests, all passing (12 of them new) |
| Relay database | `bun run db:test` | 15 files, 850 pgTAP tests, all passing (43 new, `150_live_sessions.sql`); `supabase db advisors --local`: no issues. The one migration (`relay_live_sessions`) was applied with `supabase migration up`, not from a reset: the auditing session's data lives in that database |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean |

New test files: `multisig/model/relay/wallets.test.ts` (the slot per wallet), `multisig/model/relay/identity.test.ts` (which wallet is in use), `multisig/relay/client.test.ts` (hearing the relay's "session ended"), `supabase/tests/150_live_sessions.sql`. Extended: `multisig/relay/session.test.ts`, `model/relay/copy.test.ts`, `model/relay/errors.test.ts`, `relay.itest.ts`; `supabase/tests/_helpers.inc` gives every test wallet a session.

### The rule by itself (`identity.test.ts`, `wallets.test.ts`, `session.test.ts`)

| Case | Result |
|---|---|
| A stored session is checked with the relay before it is used; a wallet with no slot is signed out whoever else is signed in | ✅ |
| A, B, A in quick succession: only the answer to the last question counts, in whatever order the earlier ones arrive | ✅ |
| An answer about the wallet that was left is never applied to the one that is connected | ✅ |
| A sign-in that finishes after the wallet moved on is not applied to the new wallet | ✅ |
| Signed out while a check was still running: the late "ready" cannot bring the session back | ✅ |
| In the one render where the wallet extension already says B and the state still says A, nothing is in use | ✅ |
| 4,000 generated histories of 14 events each (connect, switch, disconnect, answers under any count, sign-in, sign-out, another tab): the wallet in use is always the connected one, and "in use" is only ever reached by an answer or a sign-in under the question that stood | ✅ 56,000 states checked |
| Slots: named after the wallet in lowercase; nothing else under the prefix is read as one; order is most recently used first and survives a damaged note; at most eight, the least recently used dropped, never the one that just signed in | ✅ |
| The single session of before: moved into its wallet's slot once; dropped when its wallet cannot be told or already has a slot | ✅ |
| A slot whose session speaks for another wallet: ended, emptied, never used. The relay not answering: nothing discarded | ✅ |
| Signing out: the slot is empty before the relay is asked anything, and stays empty when the relay cannot be reached or the attempt throws | ✅ |

### Against the local relay (`relay.itest.ts`, "several wallets signed in in one browser")

One storage, a client per wallet, set up exactly as the page sets them up.

| Case | Result |
|---|---|
| Two wallets sign in side by side: two slots, and each client answers `whoami()` as its own wallet | ✅ |
| A write through the second wallet's client in the first wallet's name is stopped by the page (`relay.wrong_wallet`); with that check skipped, the relay does not take the name from the row | ✅ |
| Each wallet's private channel is joined only through that wallet's own client; the other wallet's client is refused there | ✅ |
| Signing one out: its slot is gone before the relay has answered, its renewal token is refused afterwards, and the other wallet reads, writes and renews as before | ✅ |
| A session whose access token has run out is ended on the relay without being written back into its slot | ✅ |
| The relay unreachable: "unreachable" is reported and the browser still holds nothing | ✅ |
| A session copied into another wallet's slot is never used, and is ended | ✅ |
| The single session of before is carried over and works with no new signature | ✅ |
| An ended session's access token is refused at once (HTTP 401, `relay.session_ended`) on a function, a read, a write and its channel, while it worked a moment before and the other wallet in the browser is as it was. Before `relay_live_sessions` this case stated the opposite: the token worked until it ran out | ✅ |
| A session ended behind the page's back is reported as such instead of coming back empty, and the next check empties the slot | ✅ |
| A request with no session (the publishable key by itself) is left alone by the gate | ✅ |
| Stated limit: a channel joined before the session ended still gets the empty "something changed" signal; nothing can be read with that session | ✅ as written; see the limits below |

### The relay's rule for an ended session (pgTAP, `150_live_sessions.sql`)

| Case | Result |
|---|---|
| A session that exists speaks for its wallet, reads what the wallet may read and passes the gate; a time-boxed one does until its time is up | ✅ |
| Its row removed (what Auth does on sign-out): no wallet, `whoami()` names nobody, no treasury and no signer list is read, nothing may be asked or shared, and the gate refuses it. The other signer of the same treasury is untouched | ✅ |
| The gate's answer, exactly: message and code `relay.session_ended`, HTTP 401 | ✅ |
| A session past its time box; another user's session; one that never existed; a token that names none, an empty one, one that is not a UUID (no error raised), a number | ✅ no wallet in every case |
| Requests tied to no session (no token, the anonymous role, the service role) pass the gate | ✅ |
| Wiring: PostgREST is told to run the gate; the `gate` schema holds that one function and no table; every request role can run it; nobody can ask which session a request is; anon still has no access to `private` | ✅ |
| Invariants: no policy (public, private, realtime) reads the user from the token by itself; only the two identity functions and the gate read the token | ✅ |
| The 807 tests that were there before, each wallet now with a session | ✅ unchanged |

### In the browser (testnet, real account switches in Rabby)

| # | Step | Seen |
|---|---|---|
| S1 | reload while signed in from before the change | still "signed in · live", no prompt; the old key gone, the wallet's own slot there |
| S2 | switch to B, never signed in | "B · not signed in", "1 more wallet is signed in here" listing A; nothing of A's on screen; the gate says another wallet is signed in here; one prompt to sign B in |
| S3 | A and B in turn, then A, B, A, B about 0.8 s apart, the page sampled every 60 ms | no prompt; always ended on the connected wallet; never one wallet's address over the other's treasuries; "Checking your session…" for 40 to 50 ms on a switch |
| S4 | B proposes, A signs, back to B | the log says proposed by B, signed by A |
| S5 | a form filled as A, wallet switched to B before Create | the button reads "Create and sign as B"; what is created is B's. With C (a signer, not signed in): the proposal is made locally and is not uploaded under anybody's session |
| S6 | every relay request recorded by the address in its token (the token itself never) | 136 s as A with B signed in: 42 requests, all A's. From the switch on: 21 requests, all B's; the first is `whoami` as B, and a new socket is opened |
| S7 | "Sign out" as B | B's slot gone in the same tick; A still listed; switch to A: signed in, no prompt |
| S8 | B's "Sign out" in the list while A is connected | the list goes, A stays "signed in · live"; switch to B: not signed in |
| S9 | "Sign out all wallets" | nobody signed in, no key of the relay left in storage |
| S10 | site disconnected in the wallet with A and B signed in | "No wallet connected", "2 wallets are signed in here"; connecting A again signs in with no signature prompt |
| S11 | reload in each state (B in use with A parked; C not signed in with two parked; nobody connected) | first paint "Checking your session…", then the same state; never the other wallet |
| S12 | two tabs as A; sign out in the first, sign in again | the second follows within about 50 ms and 200 ms, with no reload |
| S13 | sign-in rejected in the wallet as C | "You declined in the wallet."; A and B untouched; the line is gone after switching to A |
| S14 | B's slot given a dead renewal token while A is connected | A unaffected; on switching to B: "not signed in", the slot removed; back to A with no prompt |
| S15 | A's slot copied into a slot named after C, wallet switched to C, sampled every 30 ms | "Checking…" for 59 ms, then "C · not signed in"; nothing of A's on screen at any sample; the forged slot removed |
| S16 | the wizard open as A with a signer added, wallet switched to B, then to C | B: the headline names B and the list is empty again. C: the sign-in gate. Read only, nothing converted |
| S17 | console and hosts across all of it | no error from the app, no "Multiple GoTrueClient instances"; the relay and Hyperliquid only |
| S18 | 375 px | the list opens and closes in the top bar; no sideways scroll |
| S19 | regression from scratch: sign in, propose, sign, withdraw, the away notice, a nickname | as before |
| — | account switched while the sign-in prompt is open | Rabby closes the prompt; the page shows the new wallet "not signed in"; no slot written |

Four points from that run were changed and looked at again in the browser:

| Seen | Now | Re-check |
|---|---|---|
| For about 34 ms after a reload the rail said "No wallet connected" above the list of wallets signed in, before the wallet came back (measured with a MutationObserver and a 16 ms timer). The wallet stack names an address as soon as its first connector has answered and calls it connected only after asking the others; the relay code went by the address, the rail by "connected" | one function says which wallet is connected, for both; until the stack says so the page is checking | ✅ two reloads: "Checking your session…" → the wallet → "signed in" → live, no other frame. With the site really disconnected it still settles on "No wallet connected · 2 wallets are signed in here" |
| With no wallet connected the gate spoke of "other" wallets and of "this one" | "2 wallets are signed in here. Connect one of them to go on as that one, or sign in with another." | ✅ |
| A signer who is not signed in can create a proposal, which then stays in the browser, with no word about it near the buttons | "You are not signed in, so it stays in this browser until you pass it on: your co-signers do not see it in their lists." | ✅ |
| After the change to what counts as connected: A → B → A, sign out as one, sign in again, reconnect after a disconnect | as before | ✅ |

### In the browser: an ended session (testnet, after `relay_live_sessions`)

Run by the same auditing session. A copy of an access token was kept in a page variable and never printed; the publishable key was taken from the page's own requests.

| # | Step | Seen |
|---|---|---|
| L1 | reload after the migration, with wallets that were signed in before it | still signed in, no prompt, lists load, no 4xx |
| L2 | as B: `whoami` and a read with a kept copy of the token, "Sign out", the same two requests again | before: 200 and B's address, 200 and its treasury. 152 ms after "Sign out": HTTP 401 `relay.session_ended` on both, and the same at 0.8 s, 2.3 s and 5.3 s |
| L3 | B's session ended on the relay behind the page's back (the relay's own logout call with B's token) | at the page's next read (27 ms after its 401): "B · not signed in", under the button "This wallet's sign-in here has ended. Sign in again.", B's slot gone, A still listed. Until that read the page showed what it had read last, never empty lists. One prompt to sign in again |
| L4 | A's slot copied into a slot named after C; wallet to C, then straight to A | C: "not signed in", forged slot removed, nothing of A's at any 30 ms sample. A: "not signed in" at once with the same line (its session was ended when the forged slot was checked; before this change A stayed signed in for up to an hour) |
| L5 | A → B → A; two tabs, sign out in one and sign in again; reload with A in use and B parked | as in S3, S12 and S11; a deliberate sign-out does not show the "has ended" line in the other tab |
| L6 | console and hosts | no error or warning from the app; the only 401s are the ones L2 to L4 are meant to produce; the relay and Hyperliquid only |

### Limits

- **A channel joined before its session ended still gets the empty signal.** Measured (the last integration case): Realtime decides who may hear a channel at the join and does not ask again while the socket is open, so such a socket receives "something changed" (an empty message) until its token runs out, at most an hour. Nothing can be read with that session, and a new join is refused. The page's own socket is closed when it signs out.
- A page whose session was ended behind its back says so at its next request to the relay, not before (21 s in L3, while it sat on a tab that re-reads nothing). Nothing can be read or written with the session in that time; what is on screen is what was read last. It cannot arise from this browser's own sign-outs, which the page hears of at once.
- The gate in front of the API is a setting on the database role PostgREST connects as (`pgrst.db_pre_request`). A database test fails if it is missing; were it lost all the same, an ended session would still read and write nothing (the identity function), it would only be answered with empty lists instead of a refusal.
- `relay_live_sessions` was applied to the local database with `supabase migration up`; it has not been run from an empty database.
- The cap of eight wallets is unit-tested only (the test wallet has six accounts).
- A browser that refuses `localStorage` falls back to the page's memory (signed in until the page is closed); not tried in a browser.
- Whose session a channel joins with was shown against the relay, not read from the socket in the browser.
- One wallet extension (Rabby), one profile. No hardware wallet, no phone.
- §10 and §13 describe the single session of their day ("Signed in as S1, but that is not the connected wallet"): that state no longer exists.

## 16. Multisig — any signer can say no (2026-10-12)

The first part of Phase 6. A signer's no is an objection the others see, never a veto; the finaliser's decline is retired; a proposal that cannot go ahead as things stand stays open and says when it lapses (DECISIONS.md, "A signer's no is an objection, never a veto"). Tested as the sessions were in §15: the rule by itself, the relay's rules in the database, the two together against the local relay, and the page in a browser.

The browser rows were run by the auditing session of §14, with three accounts of one wallet (**A** the proposer, **B** the finaliser, **C** a plain signer) on a 2-of-3 test treasury, testnet, against this working tree and the local relay.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 95 files, 2,335 tests, all passing |
| Relay database | `bun run db:test` | 16 files, 909 pgTAP tests, all passing (58 new in `160_objections.sql`); `supabase db advisors --local`: no issues. The migration `relay_objections` was applied with `supabase migration up` |
| Relay integration | `bun run test:relay` | 72 tests, all passing (7 new, 2 rewritten for the retired decline) |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean |

New test files: `multisig/model/relay/positions.test.ts`, `supabase/tests/160_objections.sql`. Extended: `relay/inbox`, `relay/status`, `stage`, `nonce`, `relay/timeline`, `relay/away` tests, `relay.itest.ts`; the database cases that declined a proposal (`080`, `120`) and the grants matrix (`100`).

### The rule by itself (`positions.test.ts`, `stage.test.ts`, `inbox.test.ts`, `status.test.ts`)

| Case | Result |
|---|---|
| For every treasury of 1 to 10 signers, every number that must sign and every number of signers against it, with and without the finaliser among them (880 combinations): held up exactly when the signers left are fewer than must sign ("cannot pass"), or else when the finaliser said no; never with nobody against it | ✅ |
| A no counts only from somebody who is a signer now, and once per signer | ✅ |
| Every sentence, exact: one signer said no and it can still pass (naming who still has to sign); too many said no; the finaliser said no, as the others and as the finaliser read it; "You said no, 2 hours ago."; the amber line above Sign and Submit | ✅ |
| No sentence says declined, rejected, vetoed, cancelled or blocked, none uses "he" or "she", and none makes a forbidden claim | ✅ |
| The page's states: still "Collecting" or "Ready" while it can pass, and the finaliser can still submit; "Cannot pass" and "Cannot be submitted" stay signable; the finaliser who said no can neither sign nor submit until the no is taken back; what ended a proposal (accepted, withdrawn, expired, refused) is said over any no | ✅ |
| The inbox: a proposal you said no to no longer needs you; a held-up one needs nobody and sits under "Cannot be finished"; it is still one of the treasury's open proposals | ✅ |
| The buttons: the finaliser has exactly a plain signer's choices; a no that stands is taken back, not said again; nothing once the proposal is over | ✅ |
| The Signing log: a no that took a signature back, and a signature in place of a no, read as one step each; a co-signer's step is never folded into one's own | ✅ |
| "While you were away": a no that still stands on something the reader proposed or has to submit, and no other | ✅ |
| When a waiting proposal lapses: "in 1 day 23 hours", "in 5 hours", "in 12 minutes"; nothing once it has closed | ✅ |

### The relay's rules (pgTAP, `160_objections.sql`)

| Case | Result |
|---|---|
| A plain signer, the proposer and the finaliser can each say no; the proposal stays open even with every signer against it | ✅ |
| A stranger, another treasury's signer, an ended session and a request with no wallet can neither say nor read one | ✅ |
| It cannot be filed under another name, dated by its author, or edited; one per signer per proposal | ✅ |
| Taken back by its own signer only | ✅ |
| One position at a time, in both directions, with the history in order; a co-signer's position is never touched | ✅ |
| A withdrawn and a lapsed proposal take no new no and keep the ones they had; a former multi-sig takes none | ✅ |
| Thirty an hour per wallet, and a signature is not held back by it | ✅ |
| An operator removing a proposal removes its positions without an entry that pretends the signer did | ✅ |
| Grants: read and delete only, insert of the proposal's key only, nothing for anon; the table has no column that could hold a reason | ✅ |
| A decline is refused (`relay.decline_retired`), from the finaliser too; a proposal declined before stays declined, with its history entry | ✅ `080`, `120` |

### Against the local relay (`relay.itest.ts`, "saying no")

| Case | Result |
|---|---|
| A no is read by every co-signer and ends nothing; said twice is said once; an outsider reads and writes none; one signer cannot say it in another's name | ✅ |
| Taken back by its own signer only | ✅ |
| A no takes the signature back and a signature takes the no back, each leaving one row; the Signing log tells the five entries as three steps | ✅ |
| Held up by its finaliser, then by too many; still open and still listed; goes on once they change their mind | ✅ |
| Positions freeze when the proposal is withdrawn or has lapsed | ✅ |
| A co-signer's page is pinged within two seconds | ✅ |
| The hourly limit | ✅ |
| A decline as an older page would send it is refused; the finaliser says no instead and the proposal stays open | ✅ |

### In the browser (testnet, a 2-of-3 test treasury)

No wallet prompt opened on any "Say no" or "Take back my no". The halves that need a 3-of-4 treasury were skipped; the truth table covers them.

| # | Step | Seen |
|---|---|---|
| N1 | C, a plain signer, opens A's proposal (finaliser B) and says no | buttons "Sign as C" and "Say no", no "Decline" anywhere. Afterwards C reads "You said no, … ago." with "Sign" and "Take back my no"; C's row reads "said no · …" in amber; A reads "C said no to this, … ago." above Sign; the stage stays "Collecting signatures" |
| N2 | the lists | for C it leaves "Waiting for your signature" (4 → 3, the rail's count too) and sits under "Waiting on others" with "you said no"; for A and B it keeps its place with "1 said no" |
| N3 | it can still pass | A signs, B signs and submits: "Submitted · accepted by Hyperliquid", C's row still "said no" |
| N4 | B and C both say no | "Cannot pass as things stand" with the names, "so only 1 signer is left and 2 must sign", and "Otherwise it lapses on 14 Oct 2026, 19:25, in 1 day 23 hours."; Re-propose offered; under "Cannot be finished" with the tag "cannot pass" in every inbox |
| N5 | a change of mind | "Take back my no": the state before that no; no again, then "Sign as C" (one prompt): the signature in place of the no |
| N6 | a signer who signed says no | the hover text about Hyperliquid still counting the signature; 1 of 2 → 0 of 2; after a reload the browser's own copy holds no signature of C |
| N7 | the finaliser says no, at 0 signatures and at "Ready" | B: "Cannot be submitted as things stand", "You said no. You are the one who has to submit this, so it cannot go ahead unless you change your mind.", only "Take back my no", no Submit. A and C: "B said no, and B is the one who has to submit this proposal. It goes ahead only if B changes their mind. …". Lists: "Cannot be finished", "finaliser said no". Taken back: "Ready · 2 of 2", submitted, accepted |
| N8 | the proposer says no, takes it back, withdraws | all three work; Withdraw (with its inline confirmation) closes it for everyone |
| N9 | a submitted and a withdrawn proposal | no "Say no"; the rows stay as they were |
| N10 | the Signing log | one line per step: "said no to …", "took back their no to …", "signed …, in place of their no.", "said no to …, taking back their signature.", and "You …" for the reader |
| N11 | live | between two tabs of one wallet: a no said in one showed in the other 0.3 s later, no reload. A co-signer's page could not be watched (one wallet); the ping to co-signers is an integration case |
| N12 | "While you were away" | A: "C said no to …, which you proposed." and nothing about B's proposal. B, its finaliser: "…, which you have to submit." Once the proposal was carried out, only that is said |
| N13 | the closing time | on every waiting row in the inbox and the Pending tab: "closes 14 Oct 2026, 19:24 · in 1 day 23 hours"; held-up rows keep it (it is when they lapse) |
| N14 | a proposal declined before the change | still "Declined by the finaliser, …"; no "Say no" |
| N15 | signed out, a proposal from a link | no "Say no", no "said no" rows, everything else as before |
| N16 | 375 px, both themes, console | no sideways scroll, no error |

Two wording bugs and four reading points came out of those rows. Each was fixed (`619b0d5`, `bd70626`) and looked at again:

| Found | Fix | Seen again |
|---|---|---|
| A no said a moment ago read "You said no, in less than a minute." for up to a minute: the relay's stamp was ahead of a page clock that is read once a minute | an age never reads as the future (`agoWords`), and the proposal page has one clock | three first nos on three new proposals, the page read every 100 ms for 8 s after each click: "You said no, less than a minute ago." from the first sample on, never "in …" |
| One no shown with two ages on one page ("2 minutes ago" above Sign, "1 minute ago" on the signer's row) | the same clock for the stage, Your part and the Signatures panel | the two read alike and turned together ("1 minute ago" both, then "2", then "3") over 75 s |
| "It goes ahead only if one of them changes their mind", read by somebody who is one of them | the reader among those who said no is spoken to | B and C, who both said no: "… only if one of you changes your mind."; A, who did not: "… one of them changes their mind." |
| The stage named a signer who said no among those who "can still sign" | they are left out | with C's no standing, A reads "Collecting signatures · 0 of 2 · you, B can still sign" |
| "you said no" twice on the reader's own row in a list | once, on the right | once. The row with two nos that can still pass needs a larger treasury: in a 2-of-3 the second no makes it "cannot pass", which is what was seen |
| The amber "said no" tag measured 3.9:1 on the light theme | the light theme's warning colour was darkened (it applies to every amber text) | the tag 4.79:1, the "Say no" button 5.43:1, an amber tag on another page 4.79:1 |

### Limits

- A no exists for signed-in teams only: with links and files there is no shared place for it.
- A no is not on Hyperliquid. A signature given before a no still counts there until the signing window closes; the page says so where it applies, and the tool treats the no as the signer's word.
- The hourly limit and the refusal of a decline are covered by database and integration tests, not in a browser.
- The browser had one 2-of-3 treasury and one wallet. What needs four signers (two nos that still leave enough to sign, "2 of them change their minds") is covered by the truth table and the sentence tests; a no arriving on a co-signer's open page was seen between two tabs of one wallet, and the ping to the other signers by an integration test.
- One guard was added after the browser rows (`standing` needs at least one no before it says "cannot pass"): a unit test covers it, and it changes nothing for a signer list Hyperliquid can hold.

## 17. Multisig — staking, and two proposals that are one move (2026-10-12)

The second part of Phase 6. Three forms named by where the HYPE ends up, one proposal or two, two shown, signed and submitted as one move, and a Staking section on the treasury page (DECISIONS.md, "Staking is three forms named by where the HYPE ends up"). Tested where each piece of logic lives: Hyperliquid's own answers recorded on testnet and replayed by the core, the forms and the move's states as pure tables, the pair writes in the database and against the local relay, the finaliser's click against a stand-in for Hyperliquid, and the pages in a browser on testnet.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 101 files, 2,722 tests, all passing |
| Core coverage | `bunx vitest run --coverage` in `packages/hl-core` | 100 % of lines, branches, functions and statements for its scope (`src/multisig/**` with the new `staking.ts` and `move.ts`) |
| Relay database | `bun run db:test` | 17 files, 938 pgTAP tests, all passing (29 new in `170_moves.sql`); `supabase db advisors --local`: no issues. No migration |
| Relay integration | `bun run test:relay` | 75 tests, all passing (3 new, "a move of two steps") |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean |

New test files: core `test/multisig/staking.test.ts`, `test/multisig/move.test.ts`; app `multisig/model/staking.test.ts`, `model/move.test.ts`, `model/chain/stakingRecord.test.ts`, `proposal/moveFlow.test.ts`; `supabase/tests/170_moves.sql`. Extended: core `adapter`, `describe`, `explorer`; app `model/actions`, `sendCheck`, `stage`, `transport`, `chain/match`, `chain/pace`, `relay/inbox`, `relay/timeline`, `relay/away` tests, `relay.itest.ts`. One fixture entry was added to `fixtures/explorer/testnet-txdetails.json` (the explorer's answer once the day's allowance is used up).

### What was measured first (testnet, lab keys, a 2-of-3 lab treasury)

Every action below went through the multi-sig envelope. The record is `fixtures/multisig/staking.json` (18 actions in the order they were sent, with what Hyperliquid reported before and after each).

| Question | Answer |
|---|---|
| Do `cDeposit`, `tokenDelegate` and `cWithdraw` go through a multi-sig? | yes, all three |
| Can the second step follow the first at once? | yes: move in then stake, unstake then return, unstake from one validator then stake with another, each within seconds |
| Does a return need a second signature when it lands? | no: it lands by itself, and the staking history then holds a row with no transaction |
| Is a stake with a jailed or an inactive validator refused? | no, it is accepted |
| Does adding to a stake change its lockup? | yes: everything staked with that validator is locked again |
| How sharp is the end of a lockup? | refused 2 seconds before, accepted 1.5 seconds after |
| What happens to a stake removed completely? | it leaves the list of stakes |
| How long are testnet's waits? | lockup 2 minutes, return queue 5 minutes |
| What does Hyperliquid answer when it refuses? | seven texts, recorded word for word (rule set "errors" 1.8.0): `Insufficient funds available to deposit.`, `Insufficient balance to delegate`, `Unknown validator`, `Cannot undelegate during lockup period after delegating or voting.`, `Insufficient balance to undelegate`, `Insufficient balance to withdraw from CStaking`, `Too many concurrent CStaking withdrawals` |
| Is anything about staking on Hyperliquid's socket? | no, on none of the channels the page uses; the ledger carries only the spot ↔ staking transfer |

From Hyperliquid's docs and not measured: the mainnet waits (1 day, 7 days) and the limit of 5 returns at once (the sixth was refused on testnet, as the docs say). Not in the docs: the request that lists validators.

### The core (`staking.test.ts`, `move.test.ts`)

| Case | Result |
|---|---|
| Every action in the record: the answer Hyperliquid gave is the answer predicted from the state before it, and the state predicted after it is the state Hyperliquid then reported | ✅ 18 of 18 |
| Every refusal in the record has an entry in the catalogue, and nothing was refused that is not listed | ✅ |
| HYPE to the integer an action carries and back (8 decimals, integers only); an amount with more decimals, zero or a negative one is not carried | ✅ |
| The four reads (`delegatorSummary`, `delegations`, `delegatorHistory`, `validatorSummaries`): canonical figures, a stable order however rows arrive, a row that cannot be read is left out and the rest kept, another shape is not read at all | ✅ |
| When a return lands: its start plus the network's queue, the first to land first; no time is made up when the history does not account for the summary; fits the lab's five | ✅ |
| Whether a validator pays: jailed, outside the paid set, keeps everything, an expected rate of zero; what is not known is not held against it | ✅ |
| The planner: stake moves in only what the staking balance is missing, or nothing; return unstakes only what is missing; no plan when something must be unstaked and no validator is named; move is unstake then stake | ✅ |
| The judge: the second step is judged against what the first leaves behind; the step that would be refused is named with its reason; nothing is refused on a fact that was not read; a locked stake refuses an unstake of any amount; a first stake is locked for the network's lockup and a top-up locks all of it again | ✅ |
| Tying two proposals: the same list in both, neither digest changes; a proposal that stands alone is written byte for byte as before; a malformed list is dropped with a warning; a merge never ties a proposal that stands alone and never unties one | ✅ |
| Whether two proposals are one move: the three shapes, named by what they come to; not when untied, tied to another list, on another network or treasury, with another finaliser or proposer, out of order, signed under different chains, with a vault or an expiry, or when the actions are any other pair (a send dressed up as a stake among them); who proposed is taken from the relay when it says so | ✅ |

### The forms and the move, as rules (`model/staking.test.ts`, `actions.test.ts`, `sendCheck.test.ts`, `stage.test.ts`, `move.test.ts`, `chain/stakingRecord.test.ts`)

| Case | Result |
|---|---|
| Each form to its steps and its sentences, exact: one proposal or two, the amber line for a validator that pays nothing (four reasons), the amber line for a top-up, an address that is no validator blocked, two equal validators blocked, more than there is said in one amber line and never a stop | ✅ |
| Nothing is worked out before the staking balance was read; an unread validator list is a warning, not a block | ✅ |
| A form makes one or two proposal inputs, numbered one after the other; a staking proposal read back gives its form; a move read back gives the form that made it | ✅ |
| Proposed again from its first step a move is the whole move; from its second, only that step. What is left of a move to another validator, once the unstake has landed, is one stake and never a second unstake | ✅ |
| The check before submitting: a staking step against what was just read, a move's two steps in order; a read that fails stops nothing | ✅ |
| A lockup is judged by Hyperliquid's own clock where it says the time, whatever the device's says (10 s fast, 9 s slow); by the device's where it does not; the clock is asked for only when a step is an unstake | ✅ |
| The lockup gate: an unstake inside the lockup can be signed, Submit is off with the time it opens, and once that moment has passed nothing is held | ✅ |
| A "duplicate nonce" answer says to look at the record before proposing again | ✅ |
| A move's state from its two steps: collecting, ready, held by a lockup, step 1 done, done, halted by step 1, halted by step 2, broken; what each offers | ✅ |
| A step is never said to be "not carried out" when Hyperliquid answered "duplicate nonce", or when the staking history holds a step like it and the explorer did not say; a step refused for a reason of Hyperliquid's own is. Two steps over together say so. Names and moments stay parts, so the page shows a nickname and local time | ✅ |
| One row per move in the inbox, the Pending tab, the counts and the local history; a lone step is tagged with its number only when it is a staking step whose other step is not listed, and the tag asserts no reason | ✅ |
| The Signing log and "While you were away" say a move once | ✅ |
| Whether a staking step was carried out, read from the staking history: nothing is said before it was read; none like it means not carried out; one like it is looked up first; its transaction being this proposal's action means carried out; the same step under another number is somebody else's; with no answer from the explorer one like it is likely this one, never certainly, and several are not told apart; a step made before the proposal existed is never its own, however alike | ✅ |
| "On Hyperliquid": a move into staking is tied to its proposal, a landed return reads as Hyperliquid's own step | ✅ |
| One link and one file carry both steps; a move is opened whole or not at all, each step through the strict decoder by itself; a build from before moves opens step 1 of a link | ✅ |
| A list gives a staking step the same line as its own page, with the validator's own name where the validators are at hand; a validator's total stake is cut to whole HYPE and its rate is the 7-day one | ✅ |
| The explorer's refusal for the day is an error of its own, never "not found" (the recorded answer); after one, nothing is asked for ten minutes, then one look-up may try | ✅ |
| Help texts and sentences against the forbidden claims and the jargon list | ✅ |

### The finaliser's click (`moveFlow.test.ts`, against a stand-in for Hyperliquid)

| Case | Result |
|---|---|
| Asks Hyperliquid first, collects every signature, then sends step 1 and, once that is accepted, step 2 | ✅ |
| Step 1 refused: step 2 is not sent | ✅ |
| Step 2 refused after step 1 went through: said as it is | ✅ |
| Hyperliquid would refuse a step as things stand: stopped before any wallet prompt | ✅ |
| A wallet prompt not answered, whichever it is: nothing is posted | ✅ |
| The relay says a step was withdrawn a moment ago: stopped | ✅ |
| Step 1 already done: only step 2 is sent | ✅ |
| The request for step 2 does not reach Hyperliquid after step 1 was accepted: not called "nothing was submitted" | ✅ |
| A signer signing both steps: one prompt for each step not signed yet; a prompt not answered leaves what was signed | ✅ |

### The relay (pgTAP `170_moves.sql`; `relay.itest.ts`, "a move of two steps")

| Case | Result |
|---|---|
| A document carrying the tie is accepted as it is; the relay keeps two ordinary proposals | ✅ |
| Both steps are filed in one statement: when one would be refused (the hourly limit, the pending limit per treasury or per wallet, a guard) neither is kept | ✅ |
| A withdrawal, a no, taking a no back and taking signatures back cover both steps in one statement, both or neither (one that names somebody else's proposal, or reaches into a closed one, changes neither); a no to both takes back the signature that signer had given on one | ✅ |
| A move counts as two proposals against the limits | ✅ |
| Against the local relay: a move is shared whole and read back as one move, by who the relay says proposed it; a no, its taking back, signatures taken back and a withdrawal each cover both steps; shared from its page it carries the proposer's signatures, and the step that is missing is added when one is there already | ✅ |

### In the browser (testnet, a 2-of-3 test treasury)

Run by the auditing session of §14 with accounts of one wallet on a 2-of-3 test treasury (**A** the proposer, **B** the finaliser, **C** a plain signer), against the committed tree and the local relay. The treasury was given 0.12 test HYPE by a lab account. Testnet's waits are 2 minutes (lockup) and 5 minutes (return), so the whole loop fits in a sitting.

One condition of that day shaped what could be seen: Hyperliquid's testnet explorer answered every transaction look-up from the test machine with "More than 100 archived blocks queried in one day" (see Limits). Everything that depends on a look-up therefore showed its "could not check" side, and the side where a look-up confirms a staking step was not seen.

| # | Step | Seen |
|---|---|---|
| S1 | The Staking tab of a treasury with nothing staked | four figures (in spot 0.12, the other three 0), "Nothing is staked.", "Nothing is on its way back.", "No staking steps yet.", "Checked just now · again every minute while this page is open", the three buttons; no "In staking" line on Overview while everything is zero |
| S3 | The Stake form | every validator with state, commission, expected rate and total stake; "Every validator is listed as Hyperliquid reports it. Which one to stake with is the signers' choice."; the two-proposal preview; one amber line each for a jailed validator, one that "keeps all rewards as its commission" and one "not among the validators that produce blocks and are paid", the button still on |
| S4 | Stake 0.02 with part to come from spot: A proposes and signs, C signs, B finalises | cancelling the second prompt of "Create both and sign" creates nothing; one page headed by the move with both steps; one row tagged "2 steps" in the inbox, the Pending tab and the count; "Sign and submit both steps" asks four times (action and envelope of step 1, then of step 2) and ends "Done · both steps were carried out"; the tab then shows 0.02 staked, the unlock time, two history rows with explorer links, and Overview "In staking: 0.02 HYPE staked" |
| S5 | A stake the staking balance already covers | "This makes one proposal:"; with part missing only the shortfall is moved in |
| S6 | Return 0.01 to spot with nothing unstaked | the form asks which validator to unstake from; inside the lockup both steps can be signed, "Submit both steps" is off with "Submit opens on … (in 1 minute): the stake this takes from is locked until then. You can sign now."; it turned on by itself after the lockup; afterwards "1 of 5 places used" and "in 4 minutes"; five minutes later the HYPE was in spot with no signature, the history said "0.01 HYPE landed in spot" with no transaction, and "On Hyperliquid" called the row "Hyperliquid's own step" |
| S7 | Move 0.01 to another validator | two steps, both accepted, both validators' rows right |
| S8 | Adding to a stake | "The treasury already has 0.02 HYPE staked with …. Adding to it locks all of it again: none of it can be unstaked for 2 minutes." |
| S9 | A no on a move, taken back; a withdrawal by the proposer | each covers both steps; the Pending tab and the Signing log say it once ("… (both steps) was withdrawn by the proposer, you.") |
| S10 | In-between states | the second prompt cancelled while signing both: "step 1: 1 of 2 · step 2: 0 of 2" and "Sign step 2 as …"; a reload forced while step 2 was being sent: see the findings |
| S11 | More than there is | in the form, one amber line: "This moves more HYPE into the staking balance than the spot balance can release now. As things stand Hyperliquid would refuse it (step 1). Spot holds 0.1 HYPE that is not on hold, and this moves 5 HYPE."; at submit time, "Nothing was signed or sent: Hyperliquid would refuse this as things stand." before any prompt |
| S12 | Lists and records | a lone step listed as "step 2 of 2"; the log one line per event with "(both steps)"; "On Hyperliquid" never says "none on record" for a staking row (with the explorer refusing: "could not check") |
| S13 | One link, one file, signed out | "A link to this move" opened in a clean context with no wallet shows one move page with both steps; the downloaded `…-move.json` holds both documents and opens the same way on the start page; no Copy JSON or Inspect on a move |
| S15 | Width, themes, console, requests | no sideways scroll at 390 px on the Staking tab, the form and the move page (the tables scroll inside their own boxes); both themes readable; the console clean; no host other than Hyperliquid and the local relay; the four staking reads go out when the Staking tab opens and again 61 s later, none of them on the Pending tab in 130 s, and Overview asks for the summary alone |

Not reachable in the browser, and covered by the tables above: an address that is no validator (the picker offers only validators) and the same validator twice (the "To" list leaves out the "From" validator). A mainnet treasury's Stake form was not opened: no mainnet treasury existed and making one takes a wallet action.

### The cross-check against Hyperliquid's own staking page

Asked for when the feature was designed: what this section shows has to match what Hyperliquid itself shows.

Two halves, both on testnet, both on `app.hyperliquid-testnet.xyz/staking`: the treasury's own figures, with the treasury's own account connected there (nothing was signed and nothing was done on that page), and the validator table, which is public.

The treasury's own figures, read within a minute of each other:

| Hyperliquid's page | This section | |
|---|---|---|
| "Available to Transfer to Staking Balance 0.09600000 HYPE" | "In spot 0.096 HYPE" | equal |
| "Available to Stake 0.00000000 HYPE" | "Staking balance, not staked 0 HYPE" | equal |
| "Total Staked 0.01400004 HYPE" | "Staked 0.01400004 HYPE" | equal |
| the staked-with row: "Your Stake 0" | "Hyperbeat x P2P x Hypio 0.01400004 HYPE" | their column shows whole HYPE; this one shows the amount |
| "Pending Transfers to Spot Balance 0.01000000 HYPE (1)" | "0.01 HYPE · 1 of 5 places used" | equal |
| the return's time: "Transfer Countdown 6d 23h 58m 6s" | "12 Oct 2026, 23:51 · in 2 minutes" | **differs**: their page counts 7 days on testnet too. The return landed after 5 minutes, as this section said (and as measured) |
| the history: stake 0.014, unstake 0.01, transfer started | the same three rows at the same times | equal |

Earlier in the round the same figures were compared with Hyperliquid's API after a stake and after a return: staked, the staked-with rows, the unlock time, the pending return and its landing all agreed.

The validator table:

| | First comparison | After the fix |
|---|---|---|
| How many | 249 here, 250 there: the largest was missing | 250 and 250 (`714810d`) |
| Total stake | one HYPE apart on several rows: their page cuts to whole HYPE, this one rounded (6,470,703.96 read 6,470,703 there and 6,470,704 here) | 7 of 7 compared rows equal (`9ad63ae`) |
| Share of all stake | computed without the missing validator (11.13 % where 4.10 % is right) | 4.10 % |
| Expected rate | a hundredth apart on one of five (3.66 % here, 3.67 % there): their table shows the 7-day estimate by default, behind a "24h / 7D / 30D" switch, and this one showed the month's | equal on 5 of 5 (3.67, 3.70, 3.66, 3.30 and 3.28 %) (`0830b06`) |
| Commission | equal | equal |
| State | a validator that keeps 100 % commission reads "Active" there and "keeps all rewards" here | left as it is: the word says why a stake with it earns nothing |

### What the review and the browser found, and what changed

A read-only review of the code by a second reader, and the browser rows, each found defects. Every one was fixed in a commit of its own and has a test where its logic is pure.

| Found | By | Fix |
|---|---|---|
| "Propose it again" on a move whose first step was carried out filled in the whole move; for a move to another validator that unstakes a second time | review | the link names the step that is left, and a proposal proposed again from a move's second step fills in that step alone (`00ad30c`) |
| "Share with your co-signers" and "Export as a file" on a move's page acted on step 1 only, so co-signers could be handed half a move | review | both cover both steps; the share is one write, and a move shared in part says so (`1dfca29`) |
| A stopped move (step 1 refused) had no "Your part": its proposer could not withdraw it | review | Withdraw is offered for what the relay still holds open (`1dfca29`) |
| A step answered "duplicate nonce" read "Step 1 was not carried out", though its number may have been used by a submission that went through | review | the move says the step may be carried out already and offers "the whole move again" and "only step 2" (`1dfca29`, `63edf0c`) |
| When the request for step 2 did not reach Hyperliquid the page said "Nothing was submitted" although step 1 had been accepted | review | it says the step before it was accepted and stands (`4e2c382`) |
| With browser storage blocked, a move's link opened as its first step alone | review | the page keeps the steps a link carried (`ca693f1`; read in the code, not run in a browser) |
| A row said "step N of 2 · the other step is no longer waiting" on the word of the unsigned part alone | review | the tag is given only to a staking step whose other step is not listed, and asserts no reason (`3ea2653`) |
| The check before submitting judged a lockup by the device's clock | review | where a step is an unstake it asks Hyperliquid for its own time (`62b308c`) |
| The largest testnet validator was missing from the table, and every share was computed without it: its stake is above 2^53 wei, more than a JSON number holds exactly | review and browser (249 of 250 listed) | the total is a shown figure and is read to the nearest wei the number holds (`714810d`) |
| A reload forced while step 2 was being sent left the move "ready to be sent" for everyone, although Hyperliquid's staking history already held the step and the explorer could not confirm it | browser | the move says the step may be carried out already, that it is marked so once the explorer answers, and that sending it again cannot carry it out twice (`63edf0c`) |
| A withdrawn move read "Step 1 was not carried out, so step 2 is not sent … it stays where it is" | browser | two steps that are over together say so: "… · neither step was carried out" (`63edf0c`) |
| The move's sentences showed addresses and UTC where the section shows nicknames, "you" and local time; "Your wallet is asked 1 times." | browser | the sentences are parts, rendered like a single proposal's (`63edf0c`) |
| Two verbs for one thing ("cannot be removed for 1 day … (2 minutes on testnet)" on the page, "cannot be unstaked for 2 minutes" in the form) | browser | one verb and the action's own network, written from the rule set (`ca9bea9`) |
| A staking proposal named its validator by full address in the lists, by short address in the log, by name on its page | browser | one line for all of them (`b66deec`) |
| With the explorer refusing, a treasury page sent 48 look-ups in two minutes, each transaction three times | browser | the refusal is an error of its own; after the first one nothing is asked of that explorer for ten minutes (`8383557`) |
| A validator's total stake was one HYPE off Hyperliquid's page on several rows | browser | cut to whole HYPE, as their page cuts it (`9ad63ae`) |
| A validator's rate was a hundredth off Hyperliquid's page: theirs is the 7-day estimate, this was the month's | browser | the 7-day one (`0830b06`) |
| A new move was told it "may be carried out already" because of an older, identical step | browser, second look | a step from before the proposal was made is no candidate (`cd73fa1`) |
| The propose form gave its signing window in UTC | browser, second look | local, with UTC on hover (`df7ccc1`, `61f04e6`) |

Looked at again in the browser, against the commits above:

| # | Row | Seen |
|---|---|---|
| R1 | The Stake form's table | 250 validators; the largest listed as "jailed" with its 63.17 % share; totals equal to Hyperliquid's page on 7 of 7 |
| R2 | A two-step move withdrawn by its proposer | "Withdrawn by the proposer, … · neither step was carried out" / "Propose the move again if it is still wanted." |
| R3 | A signer who signed step 1 only | "Collecting signatures · step 1: 1 of 2 · step 2: 0 of 2 · you, …, … can still sign · submittable until 14 Oct 2026, 23:36 (47 h left)" in local time; "Sign step 2 as …"; the finaliser's "Your wallet is asked 4 times." and "… asked twice." |
| R4 | The move whose second step was sent from a page that was reloaded | "Step 1 is carried out · step 2 may be too" with its explanation; the amber line on step 2's card; "step 2 of 2" in Pending with the hover text; after its proposer withdrew it, "Step 1 was carried out · step 2 may be too" and what the staking history holds |
| R5 | The explorer left alone | five look-ups in the first second of a page load (they go out together), every one refused; none in the following 136 s, none on later loads of Pending, the Signing log and the inbox |
| R6 | A move made signed out, then shared | "Only in this browser" with "Share with your co-signers"; one click, and another signer's Pending shows one row "2 steps"; "Export as a file" holds both steps |
| R8 | An unstake at the end of its lockup | Submit off with the time; on 15 s after the lock ended; one `exchangeStatus` request before the first prompt; both steps accepted |
| R9 | Names in lists | the Pending tab, the inbox and the Signing log name the validator with its short address; no validator request on a list without a staking row, exactly one on the Signing log |
| R10 | The wait in one verb | "A stake cannot be unstaked for 2 minutes after it is made or added to." in the form and on the step |
| R11 | A move's file uploaded in a clean context, three times | the move page with both steps each time, console empty |
| R12 | The move page at 390 px, both themes | no sideways scroll, nothing under 4.5:1, console empty |
| R13 | The treasury's own figures on Hyperliquid's page | the table above |

The second look found one new defect, from the fix for the reloaded page: a new move was told "Step 1 may be carried out already" whenever the staking history held an older step of the same kind, amount and validator (a stake of 0.02 proposed 36 minutes after an identical one). A step from before the proposal was made is no candidate now (`cd73fa1`). Seen again: a two-step stake of an amount and with a validator that are in the history, never signed, reads the ordinary "Collecting signatures · step 1: 0 of 2 · step 2: 0 of 2 · … can still sign · submittable until …" with nothing about the history on either step; so does an unstake of an amount unstaked before; withdrawn, both read "… · neither step was carried out". The propose form's signing window, the last moment in the section still written in UTC, is local now (`df7ccc1`). Seen: "If created now: submittable until 14 Oct 2026, 23:53 (48 h left)", UTC on hover; the same row of the form's preview followed in `61f04e6` and was not looked at again.

Not produced in a browser: a first step refused by Hyperliquid at submit time (the page's own check stops the submit first whenever the balance is short), so "Withdraw" on a stopped move was not seen there; it is a table row and reads the relay's state.

### Limits

- **The explorer.** Whether a staking step's transaction, looked up by its hash from Hyperliquid's staking history, comes back as that step's action was not measured: the test machine's allowance on the testnet explorer was used up on the day, before and during the browser rows, and stayed so. The rule for that answer is a unit test against the explorer's recorded shape for other actions. Until it is seen, the page's confirmed "carried out" for a step submitted elsewhere rests on that test; its unconfirmed side ("may be carried out already") was seen.
- **The explorer's allowance is small.** "More than 100 archived blocks queried in one day" per network address on testnet. A treasury page looks up each outgoing ledger row once per page load, so a team behind one address can use it up; the page then says "could not check" and asks nothing for ten minutes. Whether mainnet has the same allowance was not measured.
- **Mainnet waits** (1 day, 7 days) are from Hyperliquid's docs. The request that lists validators is not in its API documentation.
- A list row cannot know about a lockup: it says "Submit" and the page then says when.
- An older copy of the app, or another tool, could send a move's second step before its first; the page then says which step was carried out and offers the other again.
- A move made with no wallet connected names no proposer in its documents, so in link and file mode it is shown as two proposals.
- The move's page with browser storage blocked, the sixth return, and a first step refused by Hyperliquid at submit time were not produced in a browser: the first was read in the code, the other two are covered by the flow and judge tests.
- A mainnet treasury's Stake form was not opened in a browser.

## 18. Multisig — vaults, the signing network, and three smaller parts (2026-10-13)

The third part of Phase 6: vault deposits and withdrawals (signed as a code under chain 1337, which the wallet has to hold as a network), removing an API wallet, switching the account mode, a send to HyperEVM stopped in the form, and a half-filled form kept in the browser (DECISIONS.md, from "A vault action is signed as a code, under a network the wallet has to hold" to "A half-filled form is kept in this browser for a week"). Tested where each piece of logic lives: Hyperliquid's own answers recorded on testnet and replayed by the core, the forms and the wallet sequence as pure tables, the relay's new rule in the database and against the local stack, and the pages in a browser on testnet with a real wallet. This time the browser rows were run by the building session itself, through its own connection to the browser.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 110 files, 2,985 tests, all passing |
| Core coverage | `bunx vitest run --coverage` in `packages/hl-core` | 100 % of lines, branches, functions and statements for its scope (`src/multisig/**` with the new `vault.ts`) |
| Relay database | `bun run db:test` | 18 files, 1,008 pgTAP tests, all passing (70 new in `180_vault_proposals.sql`); `supabase db advisors --local`: no issues. One migration, `relay_vault_proposals` |
| Relay integration | `bun run test:relay` | 78 tests, all passing (3 new, vault proposals) |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean |

New test files: core `test/multisig/vault.test.ts`, `test/multisig/modeSwitch.test.ts`; app `multisig/model/signingNetwork.test.ts`, `model/vault.test.ts`, `model/modeSwitch.test.ts`, `model/drafts.test.ts`, `model/chain/vaultRecord.test.ts`, `src/lib/signingRpc.test.ts`, `src/store/multisigDraftsStore.test.ts`; `supabase/tests/180_vault_proposals.sql`. Extended: core `adapter`, `corewriter`, `account`, `action`, `agentReach`, `describe`, `move`, `oracle`, `staking`, `transfer`; app `model/actions`, `chains`, `parts`, `send`, `sendCheck`, `stage`, `staking`, `chain/match`, `relay/away`, `relay/copy`, `relay/push` tests, `proposal/moveFlow.test.ts`, `relay.itest.ts`. New fixtures: `fixtures/multisig/vaults.json`, `evm-transfer.json`, `agent-unnamed.json`, `mode-switch.json`.

### What was measured first (testnet, lab keys, 2-of-3 lab treasuries)

Every request below went through the multi-sig envelope, the vault actions with their inner signatures made as codes.

| Question | Answer |
|---|---|
| Does a `vaultTransfer` go through a multi-sig? | yes, deposit and withdrawal (`vaults.json`, 17 requests in the order they were sent) |
| Which balance does a deposit take from? | what the perps balance can release, or the one balance of a unified account. A manual account with its USDC in spot is refused although the account value and spot would cover it, and accepted after a move to perps |
| What does Hyperliquid answer when it refuses? | seven texts, recorded word for word (rule set "errors" 1.12.0): `Vault deposits must be at least $5.`, `Vault is closed.`, `This vault does not accept deposits.`, `Vault not registered: <address>`, `Insufficient funds available to deposit.` (the text a staking deposit gets too), `Cannot withdraw during lockup period after depositing.`, `Insufficient vault equity for withdrawal` |
| How long is a deposit locked? | HLP exactly 96 hours; a user vault 20 seconds on testnet |
| Does adding to a deposit change its lockup? | yes: all of it is locked again |
| What comes back? | the amount less the leader's share of the profit; withdrawing everything left a fraction of a cent behind; a row's `requestedUsd` can be a millionth short of the amount asked |
| What does the ledger hold? | `vaultDeposit {vault, usdc}` and `vaultWithdraw {vault, user, requestedUsd, commission, closingCost, basis, netWithdrawnUsd}` |
| Can a multi-sig send a token to HyperEVM? | no (`evm-transfer.json`, 7 sends): `Multi-sig user cannot transfer token to EVM` to the token's own system address, `EVM transfer not configured` to another token's |
| Does an API wallet approved without a name show in `extraAgents`? | no. It is in `webData3`, under `userState` (`agent-unnamed.json`) |
| Can an API wallet be removed through a multi-sig? | yes: `approveAgent` with the zero address and the wallet's name, also the empty name. A name the account does not have: `Extra agent does not exist.`. A second removal within about a minute: `User has pending agent removal` |
| How is a mode switch signed through a multi-sig? | the finaliser's signature has to be made over the mode as one letter ("u" for `unifiedAccount`, "i" for `disabled`); over the long word the answer is `Invalid multi-sig outer signer` (`mode-switch.json`: 2 requests as posted, 7 switches) |
| When is a switch refused? | to unified: never seen refused, also with a position and orders open. Back to manual with anything open: `Cannot disable unified account with open positions, open orders, or active TWAP orders`; with nothing open it is accepted and the USDC stays in spot. Asking for the present mode is accepted and changes nothing |

From Hyperliquid's docs and not measured: the mainnet lockups (HLP 4 days, a user vault 1 day). Not measured: which refusal Hyperliquid names when two apply at once.

### The gate: does a wallet sign the code at all (Rabby, testnet)

The plan put this before any vault form was built.

| Step | Seen |
|---|---|
| Ask the wallet to switch to chain 1337 before it holds such a network | `-32603 Unrecognized chain ID "0x539"`; the page reads that as "missing" and offers "Add the signing network" |
| "Add the signing network" | Rabby's "Add Custom Network to Rabby" with its standing caution and nothing about the name ("Geth Testnet"); on Add the site is on chain 1337 at once. Cancel first: "You declined in the wallet.", nothing signed |
| The signing prompt | "Unknown Signature Type", primary type `Agent`, `{ source: "b", connectionId }`, the `connectionId` equal to the code on the page |
| The finaliser's prompt | `HyperliquidTransaction:SendMultiSig` under chain 998, with `multiSigActionHash` and the proposal's number |
| A deposit of 5 USDC into a testnet user vault, then its withdrawal: two signers, one finaliser | both "Submitted · accepted by Hyperliquid"; the wallet back on its own chain after every click, also when it had been left on 1337 beforehand |

### The core (`vault.test.ts`, `modeSwitch.test.ts`, `move.test.ts`, `transfer.test.ts`, `account.test.ts`)

| Case | Result |
|---|---|
| Every request in the vault record: the answer Hyperliquid gave is the answer predicted from the state before it, and the state predicted after it is the state Hyperliquid then reported (one step allows for the vault's worth moving between the read and the request, and says so) | ✅ 17 of 17 |
| USDC to the integer a vault action carries and back (6 decimals, integers only) | ✅ |
| The two reads (`userVaultEquities`, `vaultDetails`): canonical figures, a row that cannot be read left out, an address that is no vault told apart from an answer that could not be read | ✅ |
| The planner: one step when perps can release the amount or the account is unified; else the shortfall is moved from spot first; nothing is planned on a balance that was not read | ✅ |
| The judge: each of the seven refusals from what was read, in order, the second step against what the first leaves behind; nothing is refused on a fact that was not read | ✅ |
| A two-step deposit is a move: a readable first step and a vault deposit, same network, treasury, finaliser and proposer, numbered in order, the first never moving more than the deposit; a withdrawal, another first step, or a code step in any other move is not | ✅ |
| The envelope's hash for a mode switch uses the one-letter code. For each of the 9 recorded requests: the posted action and every signer's signature carry the long word, the finaliser's signature recovers to the finaliser exactly when it was made over the letter, and Hyperliquid refused exactly the others. The table holds the two measured letters and no more; the SDK agrees over the letter and differs over the envelope as posted | ✅ 9 of 9 |
| A send to a system address from a multi-sig: every recorded send gets its recorded refusal; an ordinary address gets none; the same test serves the cross-layer trace (token indexes of 256 and above included) | ✅ 7 of 7 |
| API wallets: named ones from `extraAgents` and the unnamed one from `webData3` are one list; an unreadable half fails the read instead of shortening the list | ✅ |
| A removal is described as a removal, carries no "approves an API wallet" tag, and is recognised by the zero address alone; a vault deposit carries "moves funds out" | ✅ |

### The forms and the wallet sequence, as rules (`model/signingNetwork.test.ts`, `vault.test.ts`, `modeSwitch.test.ts`, `drafts.test.ts`, `actions.test.ts`, `sendCheck.test.ts`, `stage.test.ts`, `chain/match.test.ts`, `chain/vaultRecord.test.ts`, `relay/away.test.ts`, `signingRpc.test.ts`)

| Case | Result |
|---|---|
| Which chain a proposal's action is signed under, and which its envelope: 1337 for a plain vault action alone, the form's chain for everything readable and for every envelope | ✅ |
| "Switch, else offer Add, then switch" against a fake wallet: already there, switches at once, switches late, an unknown chain under Rabby's error code and under the standard's, the user's refusal, a wallet that says yes and stays where it was, one that adds without switching, one that will not add (it gets the chain id and the link to type in) | ✅ |
| Where the wallet goes when a click is over: back to the chain it was on, or to the network's own when it was found on 1337 | ✅ |
| The stand-in endpoint: chain 1337, a block that moves, zero balances; every transaction refused with its sentence; a batch answered in order; anything that is not a request refused | ✅ |
| A vault action is signable where the build has the signing network; without it the page says it can be read and checked, not signed; every other action of the family stays "inspect only" | ✅ |
| Each vault form to its steps and sentences, exact: one proposal or two, the refusal beside the right field with its figures, the amber line for adding to a deposit, the amber line for "nearly all" of a deposit | ✅ |
| A withdrawal inside the lockup is planned with the moment it opens; one whose lockup ends only after the proposal would have closed is refused with both lengths; a caller that names no closing moment holds no lockup against it | ✅ |
| A copy of the app without the signing network offers no vault form | ✅ |
| The stage: Submit off with the moment while a lockup holds it, "the deposit" and "the stake" each said where it is one; a lockup that outlasts the proposal is one sentence for every reader with both moments as parts, and nothing then promises an opening | ✅ |
| The check before submitting: a removal against the wallets just read, a switch against what is open, a vault step against the balances and the vault, a two-step deposit in order; a read that fails stops nothing | ✅ |
| A vault row in the ledger is tied to a proposal as "likely" and never certain, with no look-up; two alike are not told apart; a withdrawal a millionth short still matches | ✅ |
| Whether a vault step may be carried out already, from the ledger: nothing before it was read, a row from before the proposal was made is no candidate | ✅ |
| The mode switch: what each direction does in words, the refusal for a busy account, the amber line for the present mode, the amber line naming waiting proposals the new mode would refuse | ✅ |
| Remove API wallet: the form holds the wallet's name, "" being the one without; the Approve form refuses the zero address and points to Remove; "While you were away" explains a gone wallet by a removal only when there are at least as many removals as wallets gone | ✅ |
| A send to a system address is an error under Destination in both guided sends and in Raw JSON | ✅ |
| Drafts: what is kept and for how long, the newest twenty, validation field by field on reading back, a link that asks for another kind, wallet, vault or "propose again" wins and leaves the draft alone; the store writes under its own key, replaces and drops a draft, and drops every draft of one account without touching another's | ✅ |
| A sentence about an action is never cut at its colon; only a field and its value are a pair | ✅ |
| A result the relay refuses because it already holds the proposal as accepted is done, not a problem | ✅ |
| The Vaults tab's history, from the ledger rows Hyperliquid recorded for the lab's vault steps: every vault row and nothing else, the newest first; a deposit's amount; for a withdrawal what came back and what the leader kept (8.011514 asked, 8.010349 back, 0.001165 kept); a distribution and a vault's creation; nothing before the ledger was read | ✅ |
| What a treasury page follows for the section on screen (`tabWants`): holdings alone where nothing else is shown and nothing waits; the ledger with look-ups while a proposal waits; everything on "On Hyperliquid"; on the Vaults tab the ledger and no look-up | ✅ |
| Help texts and every new sentence against the forbidden claims and the jargon list | ✅ |

### The finaliser's click on a vault step (`moveFlow.test.ts`, against a stand-in for Hyperliquid)

| Case | Result |
|---|---|
| The finaliser's own signature on the action is given on the signing network, the envelope on the usual one | ✅ |
| A deposit in two steps: each signature under its own network, and the deposit sent only after the move to perps was accepted | ✅ |
| A deposit in two steps when the wallet lacks the signing network: nothing is posted, the move is left whole | ✅ |
| A wallet without the signing network is not a failure: nothing is posted and the page is told to offer "Add" | ✅ |

### The relay (pgTAP `180_vault_proposals.sql`; `relay.itest.ts`)

| Case | Result |
|---|---|
| A document of the code kind is accepted for a `vaultTransfer` of exactly its four fields | ✅ |
| Refused: the code kind with any other action (an order, a sub-account transfer, a user-signed action), with a vault address or an expiry beside it, with an extra or a missing field, with an amount that is zero, negative, a fraction or written as text, with an address in capitals or cut short; a `vaultTransfer` that claims to be user-signed; a kind that is neither | ✅ |
| Signatures, a no, the proposer's withdrawal and the finaliser's result on such a row work as for any proposal; a wallet that signs for nothing cannot share one | ✅ |
| A report that it was carried out is refused (`relay.report_unnumbered`); ten refused reports do not use up the reporter's limit; the worker, handed such a report past the guard, rejects it without comparing a transaction | ✅ |
| A two-step deposit lands both rows or neither | ✅ |
| Against the local stack: a vault proposal is shared, and a co-signer reads it and verifies the code signature in their own client; it is never closed on a report; it is refused in any other shape, and so is every other action signed as a code | ✅ |

### In the browser (testnet, a 2-of-3 test treasury, Rabby)

Run by the building session through its own connection to the browser, with two accounts of one wallet on a 2-of-3 test treasury (**A** the proposer and finaliser, **B** a plain signer), against the local relay and the stand-in endpoint on `localhost:3337`. Every wallet prompt was read before it was approved: its primary type, its chain, and the fields or the code against the page.

| # | Step | Seen |
|---|---|---|
| V1 | Deposit 25 USDC into a user vault from a manual treasury with most of its USDC in spot | "This makes two proposals"; "Create both and sign" asks twice (a readable move under chain 998, a code under 1337); one row and one page for both signers; "Submit both steps" ends "Done · both steps were carried out"; Hyperliquid then held the move, the deposit and 25.000202 USDC in the vault |
| V2 | Withdraw 24.9 of it | the amber "nearly all" line; accepted; the ledger row a millionth short (24.899999) and still tied to its proposal as "likely" |
| V3 | A vault by address that is closed, that takes no deposits, that is no vault; a deposit of 4 USDC; a deposit of more than there is | each blocked under its field: "This vault is closed: it takes no more deposits.", "This vault's leader has switched deposits off.", "There is no vault at this address on this network, and Hyperliquid refuses the request.", "A vault deposit has to be at least 5 USDC.", and the over-balance sentence with both balances |
| V4 | Approve an API wallet without a name (A proposes, B signs, A submits) | accepted; the Overview lists "(unnamed)" with its address, its expiry and "Remove" (before this part it would have read "None approved") |
| V5 | "Remove" from that row | the form opens on that wallet; the prompt shows the zero address and an empty name; accepted; Hyperliquid reports no API wallet; the Overview reads "0 active"; B's "While you were away": "An API wallet is no longer approved: …. A proposal that removes an API wallet was carried out." |
| V6 | Switch to a unified account | the first switch with a real wallet over the one-letter code: accepted; Hyperliquid reports `unifiedAccount`; the Overview shows one balance, the mode form now offers "Manual account", and "Perps ↔ spot" is gone from the chooser |
| V7 | Deposit 6 USDC into the user vault from the unified treasury; B signs after "Switch to the signing network and sign" | one proposal; the code on B's page equal to the wallet's; the wallet back on chain 998 by itself; accepted |
| V8 | Withdraw 6, then deposit 5 into HLP | both accepted; the Vaults tab: HLP "from 17 Oct 2026, 12:52 · in 3 days 23 hours" under "Can be withdrawn", the user vault "now"; the Overview "In vaults: 5.08 USDC in 2 vaults"; "On Hyperliquid" ties each vault row as "likely …" |
| V9 | Withdraw from HLP inside its lockup | see the findings: the first build let it be made though it could never be submitted. After the fix the form refuses it with both lengths, and the proposal made before the fix says in amber, to both signers, that it closes before the lockup ends; once both had signed, Submit was off with its reason and the line under the title said the same |
| V10 | A prompt cancelled by B on the code step | "Not signed · You declined in the wallet.", still 1 of 2, the wallet back on its own chain |
| V11 | Switch back to a manual account (proposed while manual: the amber "already a manual account" line; submitted once unified, with nothing open) | accepted; Hyperliquid reports `disabled`; perps 0 and 27.9 USDC in spot, as the page had said ("The USDC stays in the spot balance afterwards") |
| V12 | A send to `0x2222…2222` | blocked under Destination with Hyperliquid's reason |
| V13 | Drafts | a reload brings the form back with "What you had filled in here … is back. This browser keeps it for a week." and "Clear"; "Clear" and a created proposal each leave `hl-tools:multisig-drafts` empty |
| V14 | A copy of the app started without the signing network's link (and without a relay) | a vault proposal opened from a link: "A vault action: this copy of the app cannot sign it", no Sign or Submit; no "Vault" in the chooser; after the fix a link with `kind=vaultDeposit` opens the plain form |
| V15 | Lists and records | the Pending tab, the Signing log and "While you were away" name a vault step, a removal and a mode switch in words ("Deposit 5 USDC into HLP (0xa150…b0a0)", "Remove the API wallet without a name", "Switch to a unified account: one balance"); a vault other than HLP is named by its short address in a list and by its own name on its page; a proposer's withdrawal of a vault proposal reads as any other |
| V17 | The history on the Vaults tab (added after the round, at the user's request) | seven rows, the newest first: each deposit and withdrawal of the round with its vault, amount, the leader's share where there was one (0.000051 and 0.000065 USDC) and "likely" with a link to its proposal. The frames the page really sent: on the Overview with nothing waiting, holdings alone; on opening the Vaults tab one more, `userNonFundingLedgerUpdates`, and none for trades, orders or funding. No request to the explorer from that tab. No sideways scroll at 390 px, console clean |
| V16 | Width, themes, console | no sideways scroll at 390 px on the Vaults tab, both vault forms and a vault proposal's page with the code panel (the table scrolls in its own box, the code wraps); both themes readable; the console holds nothing of the app's after the fix below (what remains is two wallet extensions arguing over `window.ethereum`) |

### What the browser found, and what changed

| Found | Fix |
|---|---|
| The code panel was shown to a finaliser who only submits, and the line under "Finishing" described the action's prompt while the wallet showed the finaliser's | the panel is for those who sign the action; the hint names the prompt that is open (`720eb76`) |
| A wallet found on chain 1337 when a click was over stayed there | it goes back, to the network's own chain when the earlier one is not known (`720eb76`) |
| An API wallet approved without a name was invisible on every screen | both of Hyperliquid's lists are read (`3f7b103`) |
| A balance rounded up ("23.00" for 22.999935), dust shown as "0.00", one figure rounded two ways | cut, never rounded up; up to six decimals below a cent (`62a5ea2`) |
| A withdrawal from HLP proposed inside its four days can never be submitted, and the form made it | refused in the form; said in amber on a proposal already in that state (`e62a2ac`) |
| "the stake it takes from is locked" on a vault withdrawal that was ready | the sentence names what is locked (`e62a2ac`) |
| Sentences about an action were cut at their colon into a grey label and a rest ("A vault deposit can lose value" / "the vault's leader trades with it."); older sentences had the same fault | only a field and its value are a pair (`e62a2ac`) |
| The vault form said every signer's wallet switches to the chosen chain | it says what the choice is for: the signature the finaliser submits with (`e62a2ac`) |
| "Withdraw" on a row of the Vaults tab opened the form with no vault chosen | the link names the vault (`e62a2ac`) |
| In a copy without the signing network a link still opened the vault form | no vault form from a link, a draft or "propose again" there (`e62a2ac`) |
| The wallet hint of a removal promised "the address of the API wallet" | it says an address of all zeros and the name (`e62a2ac`) |
| "This proposal was already accepted." appeared under two of seven accepted submissions: the click's push of the result and the background catch-up had crossed | the relay's answer to the second is taken as done (`e62a2ac`) |
| A hydration error on every full load of the propose form: the signing window's moment was rendered on the server with its clock and its way of writing a date (from the change that made it local, `df7ccc1`) | the moment is shown once the page runs in the browser (`e62a2ac`) |

### Limits

- **One wallet.** Rabby is the only wallet the code signature was tried with. What another wallet shows when asked to add or switch to chain 1337, and whether a hardware wallet behind it shows the code or the two hashes, was not seen. A Safe cannot add a network and gets its own sentence, which was not seen in a browser either.
- **The stand-in endpoint ran on the test machine.** Where the signing network's link is served for real is a later phase; until then a build needs `bun run rpc:1337` and the env line.
- **Mainnet.** Nothing here was run on mainnet. Its lockups are from Hyperliquid's docs.
- **A vault step's "carried out" has one witness.** The finaliser's own result closes a vault proposal. If that answer is lost, the page says the step may be carried out already and points to "On Hyperliquid"; nobody else can settle it, because the action carries no number of its own.
- **A lockup inside the signing window** (a user vault's 20 seconds on testnet) could not be caught by hand in a browser: Submit held and then opening by itself is covered by the stage tests and was seen for an unstake in §17. What was seen here is the other case, a lockup longer than the proposal.
- **The explorer.** What it shows for a vault action sent through a multi-sig was not measured in this round; the pages do not depend on it. (Seen since, see §19: the inner `vaultTransfer` under the treasury.)
- **No notice for what an API wallet does.** An API wallet can put a treasury's USDC into a vault without the signers. "While you were away" does not announce that, by decision: it stays about what the signers decided and who can act for the treasury. The row is in the Vaults tab's history as "none on record". A vault row that no proposal explains was not produced in a browser (it would take an API wallet's key acting on the test treasury); the unmatched case is a unit test of the matching rule.
- **Not built:** sub-accounts, and every other action of the code family.
- The test treasury was left as a manual account with its USDC in spot, 5 USDC in HLP (locked until 17 Oct 2026) and a few cents of dust in a user vault. The wallet used holds a custom network "Geth Testnet" (chain 1337) that can be removed in its settings.

## 19. Multisig — one explorer request per account (2026-10-13)

To say which proposal caused a transfer the page needs the transaction behind it, with the action's own number, and it asked Hyperliquid's explorer about each such transfer by itself, on every page load. That request is rationed by the day. The page now reads the account's newest transactions in one request and asks about a single transaction only when that list cannot have it (DECISIONS.md, "The explorer is asked once per account, and about a single transaction only when it has to be"). Frontend only: nothing is stored and the relay is not touched.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 111 files, 3,003 tests, all passing |
| Core coverage | `bunx vitest run --coverage` in `packages/hl-core` | 100 % of lines, branches, functions and statements for its scope |
| Relay integration | `bun run test:relay` | 78 tests, all passing (run to confirm nothing moved; no relay change) |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean |

New: app `multisig/model/chain/accountTxs.test.ts`; core fixture `fixtures/explorer/testnet-userdetails.json`. Extended: core `test/explorer.test.ts`. Rule set "rate-limits" is 1.2.0.

### What was measured first (the explorer, testnet unless said otherwise)

| Question | Answer |
|---|---|
| Was the refusal of 12 October a limit, or missing data? | a limit: the very transaction refused that day was returned the next day; an unknown transaction gets other words ("invalid block height", "Unexpected error") |
| Do look-ups of fresh transactions trip it? | 130 look-ups of transactions under half an hour old all went through |
| And older ones? | of transactions two to six days old, the fourth was refused: "More than 100 archived blocks queried in one day" (the day's earlier look-ups counted). How much of the 130 fresh ones counted is not settled |
| What still answers once it is refused? | no `txDetails` at all, a transaction 14 seconds old included; `userDetails` did, for every account asked |
| What does `userDetails` return? | the account's newest transactions, newest first, each with time, account, the action as sent, block, transaction id and error: all 39 of the test treasury; exactly 300 for busy accounts, on mainnet too (it was 101 on 2026-10-08) |
| What counts towards the 300? | everything the account did: proposals carried out, attempts Hyperliquid refused, and every order and cancel its API wallet placed (the lab treasury's 300 covered under two days; HLP's vault's, 53 minutes) |
| Can it reach further back? | no: `startTime`, `endTime`, `from`, `to`, `before`, `limit`, `offset` and `page` are ignored, four other request names answer 422, and Hyperliquid's own explorer page sends the same bare request and pages through "1-10 of 300" |
| Does Hyperliquid's answer to an accepted action carry the transaction id? | no: all 134 accepted submissions on the local relay were answered `{"status":"ok","response":{"type":"default"}}` |
| Settled on the way | a staking step's transaction opens as its action (`tokenDelegate`), which §17 had left open; a vault action sent through a multi-sig shows as the inner `vaultTransfer` under the treasury |

Hyperliquid's docs say that limits are per IP address, that every explorer request weighs 40 of 1,200 a minute, and that "older blocks which have not been recently queried may be weighted more heavily". The daily sentence is not in them, and the explorer's API is not documented at all.

### The rule (`model/chain/accountTxs.test.ts`) and the adapter (`test/explorer.test.ts`)

| Case | Result |
|---|---|
| A transaction the account's list holds is taken from it, whatever the case of its id; an entry without an id is left out | ✅ |
| While the list is on its way nothing is asked about a single transaction | ✅ |
| A list read since the transaction was wanted that does not hold it: the request of its own | ✅ |
| A transaction wanted after the list was read: the list is read once more, and whatever it then holds the transaction is either taken from it or asked about by itself, never a third read | ✅ |
| A list that could not be read: the request of its own for everything; one more try for something wanted later, and not again | ✅ |
| No state asks in a loop (every combination of when it was wanted, when the list was tried and what it held) | ✅ |
| The recorded answer for the lab treasury: newest first, the action with its number, a vault action without one, a refused attempt with its reason, an API wallet's order in the same list; an unused address reads as an empty list | ✅ |
| The daily refusal in answer to `userDetails` is an error of its own, never "no transactions" | ✅ |

### In the browser (testnet, the 2-of-3 test treasury, Rabby)

Run by the building session, on an evening when this machine's allowance for `txDetails` was used up: the request was refused throughout (checked before and after), which is the condition the change is for. Requests to the explorer were counted by wrapping the page's `fetch`.

| # | Case | Seen |
|---|---|---|
| E1 | "On Hyperliquid", fresh load | one `userDetails`, no `txDetails`; all 27 rows settled: 9 tied to their proposal, 7 "likely" (vault rows), 2 "Hyperliquid's own step", 2 "none on record", 7 that need none; no "checking…" and no "could not check" |
| E2 | The same with the four oldest transactions cut out of the answer, as for an account past its newest 300 | one `userDetails` and one `txDetails`, for the one cut transaction a row needed; that row "could not check" (the allowance), every other row as in E1 |
| E3 | The same with `userDetails` answering HTTP 500 | tried twice, then single requests as before the change: three went out, then the ten-minute rest; the rows "could not check" |
| E4 | Overview with nothing waiting, Vaults, Staking, Signing log | no request to the explorer |
| E5 | Away to another tab and back to "On Hyperliquid" | still one request in all |
| E6 | A transfer made while the page was open (1 USDC from spot to perps: proposed, signed by two wallets, submitted from another tab) | the new row appeared, the list was read once more (two `userDetails` in all, no `txDetails`), and the row reads its proposal's title |
| E7 | The page of an open proposal that looks exactly like that transfer and was never sent | one `userDetails`; it stays "Collecting signatures · 0 of 2": the transaction's number is the other proposal's |
| E8 | Console | nothing of the app's |

### Limits

- **Measured on one day, on testnet.** That `userDetails` is not stopped by the daily allowance, and returns 300, is what was seen on 2026-10-13. Whether it has an allowance of its own is not known; mainnet's allowance was not measured (its `userDetails` also returned 300). If the request fails, the page does what it did before.
- **The newest 300 only.** For an account whose API wallet trades, transfers drop out of the list quickly and then depend on the rationed request again. Keeping each proposal's transaction on the relay would cover that; it was considered and left for later.
- **Not seen in a browser:** a treasury with more than 300 transactions of its own (E2 stands in for it with a trimmed answer), the staking step's and the away notice's use of the same look-up (they go through the same hook; the rule's tests cover it).
- The test treasury was left with 1 USDC more in perps (the transfer of E6) and one more withdrawn proposal in its log (E7).

## 20. Multisig: a code review by a second session (2026-10-13)

A second session read the code of both pull requests at `99cf0aa` without running any of it, and listed 41 findings: none critical or high, 6 medium, 19 low, 16 informational. The session that built the section went through them with what it knows of the design. 24 were fixed, each with a test where a rule changed (the last of them, F-1, after a measurement on testnet); the other 17 are left, with the reason, at the end of this section. The review itself changed nothing in the relay. One relay migration was added afterwards, at the owner's word, for a fault found on the way: see "Afterwards" below.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 118 files, 3,114 tests, all passing |
| Core coverage | `bunx vitest run --coverage` in `packages/hl-core` | 100 % of lines, branches, functions and statements for its scope (three new modules included) |
| Database | `bun run db:test` | 1,015 assertions, all passing (7 new for the read markers' turn) |
| Advisors | `supabase db advisors --local` | no issues |
| Relay integration | `bun run test:relay` | 78 tests, all passing, eight runs in a row after the read markers' turn (one had failed once in four before it) |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean |

New: core `multisig/when.ts`, `multisig/shown.ts`, `multisig/receipt.ts` with their tests; app `model/chain/knownState.ts` with its test, and `model/chain/recorded.test.ts`, which runs actions exactly as Hyperliquid's explorer recorded them against the actions the forms build.

### What was fixed

| Finding | What was wrong | What it does now | Test |
|---|---|---|---|
| D-1 (medium) | a receipt ("accepted", "refused") in a copy opened from a link or a file was believed as written; anyone could write one | a receipt in a copy counts only when the signature in it is the finaliser's over this proposal's submission (`checkReceipt`); any other is left out with a sentence, and the proposal stays what it was | core `receipt.test.ts`, app `history.test.ts` |
| E2-1, E2-3 (medium) | the notice of a signer list that differs said "signatures are always counted against the live list" above lists counted against the copy, and "the relay has been asked" also when the ask failed or was given up | it says the lists here count against the copy until the two match, says why an ask did not get through or that six asks did not help, and offers "Ask again" | `relay/signers.test.ts`, `relay/copy.test.ts` |
| E2-2 (medium) | balances that had stopped updating carried no time | beside "Reconnecting…" or "Not updating": "figures as of" the last moment Hyperliquid was heard from while they were live | `live/account.test.ts` |
| F-2 (medium) | a document with a date no calendar holds threw while a page was drawn | such a date is an issue of the document, and every sentence that prints a date is total (`when.ts`) | `when.test.ts`, `proposal.test.ts`, `describe.test.ts` |
| G-1 | a switch to an account mode whose short code was never measured went out and used up the proposal's number | stopped before it is sent, with the reason | `sendCheck.test.ts` |
| D-3 | a move whose second step had been sent alone offered its first step by itself | halted: "Step 2 was carried out by itself, so step 1 is not sent" | `move.test.ts` |
| D-4 | a conversion was posted on the signer's own word that its account had signed | the signature must recover to the account at the point of posting | `convert.test.ts` |
| D-5 | a validator's own name, a vault's name and a proposal's title were shown with characters that do not show (one of them turns the address after a name around) | dropped where the core reads them (`shownLine`, `shownNote`); a text that is signed or names something exactly (an API wallet's name) keeps them, written out | `shown.test.ts`, `proposal.test.ts`, `staking.test.ts`, `vault.test.ts`, `describe.test.ts`, `actions.test.ts` |
| D-7 | a step of a move that could not be written as an action would have been left out without a word | nothing is proposed, with the reason | `actions.test.ts` |
| D-9 | a token send before the token list was read took eight decimals for any token | blocked until the list is read, as Send USDC is | `actions.test.ts` |
| D-11 | a unified treasury's withdrawal was held to the perps figure Hyperliquid reports beside its one balance (0.29 beside 16.6 on a lab treasury) | held to the larger of the two; nothing is claimed while either is unread | `send.test.ts`, `actions.test.ts` |
| E2-4 | "Change signers" stayed on offer for a moment after Hyperliquid stopped reporting a signer set | Hyperliquid's own answer is enough: "Last known signers", no action links | browser |
| E2-6 | "none on record" could be said before this browser's own proposals were read | the record is whole only once both are read; a part that cannot be read makes it "cannot be read" | `chain/knownState.test.ts` |
| E2-8 | the first-use notice of a build without a relay said "No server holds anything" | reworded, and moved under the test for forbidden claims | `relay/copy.test.ts` |
| E2-10 | a transaction id from the feed went into a link as it was | written as one path segment | `chain/columns.test.ts` |
| F-4 | the paste box sent an address beginning `0x01` to the CoreWriter workbench | exact lengths are tested first | `detect.test.ts` |
| F-5, F-6 | the privacy policy said "no trackers" without the faucet miner's wallet picker, and did not name the requests to add or re-check a treasury or what is removed by itself | all three are said | read in the browser |
| N-1, N-2 | answered transfers read "checking…" while the list was read again; a cut list was recognised by one number | answers stay while the list is re-read; a list of 300 or more counts as cut | `chain/accountTxs.test.ts`, `explorer.test.ts` |
| D-8, E2-12, docs | five help texts, one comment and four sentences in the docs said a little more or less than the code does | corrected | `help.test.ts` |

### Measured for it

| Question | Answer |
|---|---|
| What does Hyperliquid report for a unified account (lab treasury, testnet)? | `clearinghouseState.withdrawable` 0.291437 beside a spot USDC balance of 16.614529 with 2.818399 on hold: the perps figure is not what the account can move |
| Does the one-off `allDexsClearinghouseState` frame name its account (E2-7)? | yes, it carries `user`, so a late frame for the previous treasury is filtered out like any other |
| Do the receipts already in a browser pass the new check? | all 53 receipts of real testnet submissions kept in the test browser (sends, moves, vault actions, mode switches) are their finaliser's; checked in 104 ms in all |

### In the browser (testnet, the 2-of-3 test treasury, Rabby)

| # | Case | Seen |
|---|---|---|
| R1 | Treasury page, all six tabs | as before the round: balances live, signers with "Change signers", staking with the validator's name, the vault history, the Signing log, every transfer tied as in §19 |
| R2 | The network cut while Overview is open | "figures as of 13 Oct 2026, 21:14:40 · Not updating · Try again"; "Live" again three seconds after it is back |
| R3 | The relay's copy of the threshold set apart from Hyperliquid's in the local database | the notice: "Threshold on chain: 2. The relay is looking it up now. Until the two match, the lists on this page count signatures against the copy…"; gone once the relay had looked. The row that test left in the relay's history was removed again and the treasury's stamp put back |
| R4 | An accepted proposal's page | "Submitted · accepted by Hyperliquid", as before |
| R5 | A forged "accepted" saved into a proposal that was never sent | left out, with the sentence; the proposal is unchanged |
| R6 | The propose form, every kind; the wizard; the inbox; Add a treasury; the privacy policy; the paste box with an address beginning `0x01`; the inspector with both samples | all render; the token form has its list; the address goes to the inspector; no draft was left behind |
| R7 | Console | nothing of the app's |

### After the reviewer's reply (same day)

The fixed and left list went back to the reviewing session, which answered from the description alone (it had not been given the new code to read). Its points were judged the same way. What they changed:

| Point | What was true | What it does now | Test |
|---|---|---|---|
| A receipt's answer is outside its signature | the check of D-1 proves who sent a proposal, not what Hyperliquid answered: whoever holds a true receipt could write "refused" beside the same signature, and a team would pay twice | the page of a proposal goes by Hyperliquid's own record: a row of the account's ledger tied to the proposal by its number counts over a reported refusal ("Carried out · the refusal reported here is not Hyperliquid's record"); a row like it that could not be compared takes "propose it again" away; and a proposal the relay does not hold is now followed in the ledger too, which is where such a copy arrives | `stage.test.ts`, `chain/match.test.ts` (`ledgerEvidence`), core `receipt.test.ts` |
| Letters written right to left reorder what is next to them with no hidden character | dropping hidden characters did not stop a name from moving the address after it | a name inside a sentence is closed off in an isolate when it holds such letters (`isolated`), and inline names sit in `<bdi>` | `shown.test.ts`, `staking.test.ts`, `vault.test.ts` |
| Invisible characters outside the four classes | Hangul fillers, the braille blank, variation selectors, the combining grapheme joiner, private-use characters and halves of surrogate pairs survived | all dropped; a pile of combining marks is cut to three per letter | `shown.test.ts` |
| Cleaning twice gave another text | composing before dropping left a letter and its accent apart until the second pass, and a title is cleaned when made and again when read | dropped first, composed after; the same text however often | `shown.test.ts` |
| Half a surrogate pair in the feed | `encodeURIComponent`, put into the explorer links by this round, throws on one | dropped before encoding; a name is cut by whole characters | `chain/columns.test.ts`, `vault.test.ts` |
| A vault can name itself "HLP" | in the Vaults table it read like Hyperliquid's own | the real one is told by its address and tagged "Hyperliquid's own vault"; any other name is shown as a quotation | `vault.test.ts`, browser |
| Orders of six to ten signatures | only the copy's own order was tried | also with the finaliser's signature last (where it is at the moment of sending) and in the signers' sorted order; the budget is 3,200, enough for ten signers | core `receipt.test.ts` |
| The mode switch | not shown that a receipt for one is recognised | the accepted switches recorded from testnet pass, and the one Hyperliquid refused for its outer signature does not | core `receipt.test.ts` |
| Two more dates in a document | a receipt's "submitted at" and a stored signer set's "observed at" took any integer, and three sentences printed them unguarded | both bounded by the validator, the sentences total | `proposal.test.ts` |
| A switch to an unmeasured mode | stopped at the moment of sending, after everyone had signed | said on the proposal's page before anyone signs | `stage.test.ts` |
| Is an action tied by the explorer's list as it is by a single look-up? | asserted, not tested | `recorded.test.ts`: the form's action equals the recorded one field for field for a move between perps and spot and for a staking step. It also records that a mode switch is listed with its one-letter code, so it would not be tied by the list as it stands (it is on no path: a mode switch leaves no ledger row) | `chain/recorded.test.ts` |

In the browser: a link was made of a transfer Hyperliquid had accepted, with the answer in its receipt changed to a refusal and the finaliser's real signature left in place, and opened on a copy of the app without a relay, in storage that had never seen the proposal. The page read "Carried out · the refusal reported here is not Hyperliquid's record", with one request to the explorer and no other host than Hyperliquid's. Before this change it read "Refused by Hyperliquid · cannot be sent again" and told the reader to propose it again.

A third message from the reviewer made three further points. Two are answered in DECISIONS.md and left for later (the account's list of transactions could confirm or refute a receipt for every kind of action, not only the ones with a ledger row; a combining-mark limit clips some scripts). The third closed half of F-1 without a measurement: the inspector now puts one amber note on a pasted request whose inner action is not in Hyperliquid's own form, and, at that point, kept judging it as pasted (superseded by the measurement under "Afterwards").

### Afterwards: the measurement for F-1, and the read markers

**F-1, measured and fixed.** With the owner's go, eight requests went through the 2-of-3 lab multi-sig on testnet (`fixtures/multisig/inner-form.json`), each a vault deposit of 1 USDC. That is under the minimum, so every one is refused and nothing moves, and the refusal says whether the signatures were accepted.

| The inner action in the body | The signers signed | The leader signed | Hyperliquid answered |
|---|---|---|---|
| canonical | canonical | canonical | "Vault deposits must be at least $5." (the signatures passed) |
| fields in another order | those bytes | those bytes | "Invalid multi-sig outer signer" |
| fields in another order | canonical | canonical | "Vault deposits must be at least $5." |
| address in capitals | those bytes | those bytes | "Invalid multi-sig outer signer" |
| address in capitals | canonical | canonical | "Vault deposits must be at least $5." |
| fields in another order | those bytes | canonical | "Invalid multi-sig inner signer" |
| address in capitals | those bytes | canonical | "Invalid multi-sig inner signer" |
| canonical | the reordered bytes | canonical | "Invalid multi-sig inner signer" |

So Hyperliquid reads a request, writes the inner action out in its own form and checks every signature against that, whatever form was sent. The inspector judged a pasted request over the action as pasted, which gave Hyperliquid's verdict for two of those eight. It now judges over the canonical action (`requestAsJudged` in the core), as a proposal document always was, says so in one amber note when the pasted form differs, and names a signature made over the pasted bytes as that ("signed the action as originally written"). `test/multisig/innerForm.test.ts` replays all eight and gets Hyperliquid's answer for each; `tools/multisig/model.test.ts` covers the inspector's parser. In the browser, with the recorded requests pasted in: the one Hyperliquid let through reads "ready · 2 of 2 required signatures · leader authorized", the one it refused "not-ready · 0 of 2", both signatures "signed different bytes … as originally written", the envelope's "not the leader". Rule set "multisig" is 1.5.0. Not measured: a decimal string with trailing zeros inside a multi-sig request (a vault action has none).

**The read markers (relay; one migration, `relay_read_mark_turn`).** "Got it" in "While you were away" writes a marker; the newest row per signer and treasury is the marker, newest meaning the highest id. Two "Got it" from one signer at the same moment (two tabs, two devices) were written one after the other under a lock, but a row has its id before that lock is taken, so the one written second could carry the lower id and the marker read back was one entry behind: a notice already read showed once more. It never concerned two different signers, or two treasuries. The relay's integration test "takes two at once" had caught it once in four runs. The turn is now taken per statement and per wallet, before any row has an id. pgTAP (`140_attention.sql`, 7 new): the marker is written under its wallet's own turn, the turn is taken before the row has its id (a test trigger notes the next id when the statement starts), another wallet's turn is its own, the turn is a trigger no client can skip. The integration suite then passed eight times in a row. `supabase db advisors --local`: no issues.

**Two old reports.** `TEST_REPORT.md` and `TEST_REPORT_v2.md`, from the faucet miner's first tests, named a wallet. They are no longer tracked and are ignored from here on; they stay in the history of the commits that had them.

**The reviewer then read the fixes** (`99cf0aa..ea43fbc`, with the owner's word) and confirmed them finding by finding, the migration included. Three small things came out of that reading:

| Point | Answer |
|---|---|
| The fix for F-1 compared the two forms of an action with `JSON.stringify`, which throws on an integer too large for a number; a pasted body can hold one, and the comparison ran while the inspector was drawn (the fault of F-2 again, brought back by a fix) | Compared with the core's own `deepEqual`. Three other places wrote a pasted value out the same way (a document's version, its `meta.kind`, a dex name in a description) and now go through `written`, which cannot throw. Tests in `when.test.ts`, `proposal.test.ts`, `describe.test.ts`, `innerForm.test.ts` and `tools/multisig/model.test.ts`, the last with the reviewer's own example |
| Does the budget of the receipt check cover ten signers? | Yes: 3,072 different selections at most, against a budget of 3,200. A test with ten signers finds a receipt that sits late in the second round, and misses it with half the budget (`receipt.test.ts`). About three seconds of work for the worst document, when a copy is opened, never while a page is drawn |
| Receipts already kept by a browser from before the check existed are not checked again | Left: nobody but the test browsers has such receipts (all 53 of theirs passed), and from the first release on every receipt came in through the check |

118 files, 3,114 unit tests after it; core coverage 100 %.

### Left as they are

| Finding | Why |
|---|---|
| D-1 for receipts read from the relay | The relay takes a receipt only from the finaliser's session, and the browser cannot check it the way it checks a copy: the check needs every signature that was sent, and the relay holds only the ones their signers put there themselves. A true receipt would fail whenever one signature travelled by link. It waits for the relay to keep what was sent, or for Hyperliquid's own record to be asked. |
| A finaliser who reports another answer than Hyperliquid gave | Nothing in a receipt is signed by Hyperliquid. Only its own record settles it; the same later work. |
| D-2, D-12 | D-2 is unreachable through the path named, and the order rule is applied where the lists are made. D-12 is strict on purpose: key order is part of what is compared. |
| E2-7 | Void: the frame carries `user` (measured above). |
| D-6, D-10, D-13, E2-5, E2-9, E2-11, E2-13, F-3, F-7 to F-11 | Informational or cosmetic, none changes what is signed or sent. E2-11: the read is at most ten seconds old and the relay checks again before it stores. |
| F-12 | Two test reports in the repository name a wallet: the owner's decision. |

### Limits

- A unified treasury's withdrawal was not sent: no withdrawal is made in testing. Which of the two figures Hyperliquid holds it to is still not measured; the page stops one only above both.
- The check of receipts tries every order of at most five signatures. With six to ten it tries the copy's order and the sorted order, each with and without the finaliser's signature last; a copy in yet another order would not be recognised. None of the 53 real ones needed more than the first try.
- A copy that says "accepted" is not compared with Hyperliquid's record: a page shows "As reported by the finaliser's browser. The ledger is the proof." under it and no more. Only a reported refusal is checked, because that is the answer that makes a team pay twice.
- A reported refusal can be compared only for actions that leave a row in the ledger and are still among the account's newest 300 transactions (or for which a single look-up answers). For the others the page says what the finaliser's page recorded and to look before proposing again.

## 21. Multisig: the pre-launch fixes from the QA campaign (2026-10-14)

Another session tested the section for mainnet readiness and compared it with HyperSig: four bugs (R1 to R4), a high read rate (P1), 37 smaller points (U1 to U37, C2) and 65 wording points. The owner and the building session went through all of it and decided each one; this section is what was built and checked, in eight commits on `feat/multisig-live`. Nothing here touched mainnet; the browser checks ran on testnet in Brave with Rabby, on the dev server with the signing network's stand-in on :3337.

### Automated suites

| Suite | Command | Result |
|---|---|---|
| Core and app unit tests | `bun --bun run test` | 129 files, 3,330 tests, all passing |
| Core coverage | `bunx vitest run --coverage` in `packages/hl-core` | 41 files, 1,683 tests; 100 % of lines, branches, functions and statements |
| Database | `bun run db:test` | 1,015 assertions, all passing (no migration in this round) |
| Advisors | `supabase db advisors --local` | no issues |
| Relay integration | `bun run test:relay` | 78 tests, all passing |
| Types, lint, build | `bunx tsc --noEmit`, `bun --bun run check`, `bun --bun run build` | clean |

New tests: `model/relay/serial.test.ts` (one push at a time), `model/chain/record.test.ts` and `recordCopy.test.ts` (Hyperliquid's record, replaying `fixtures/multisig/explorer-record.json`), `jargon.test.ts` (every sentence on the section's screens against the jargon list), `src/lib/tabs.test.ts`, `model/notices.test.ts`, `store/multisigPrefsStore.test.ts`, `model/guide.test.ts`, `src/lib/download.test.ts`, `model/chain/csv.test.ts`, and the withdrawal row in core `wsAccount.test.ts` (replaying `fixtures/multisig/unified-withdrawal.json`, measured on mainnet by the QA run).

### The proposal page follows storage, with one push path (R2, R1, P1, U28, U29, U33)

| Check | Before | After |
|---|---|---|
| R2: two tabs on one proposal, the second signature made in the other tab after a wallet switch | the first tab stayed on "1 of 2" until reloaded | it turned "Ready · 2 of 2 signatures" with no reload |
| R1: signing as the second signer | two signature writes, the second answered 409 Conflict | one write, no 409 |
| P1: an open proposal page, idle | 21 relay reads on load, 3 in the next idle minute (the 60-second read of open proposals) | not counted again; by design, a tab coming back into view no longer reads anything while the live channel is joined |
| P1: one signature, start to settled | 36 relay requests in 44 s (proposals 15, views 4, events 6, signatures 2, treasuries 3, nicknames 3, read marks 3) | 21 in 40 s (proposals 10, views 3, events 4, signatures 1, treasuries 1, nicknames 1, read marks 1) |
| U28: a second `#share=` link pasted into the same tab | the old proposal stayed | the new one opens and the fragment is stripped |
| U29: a link opened with `window.open`, and a click from the inbox | could stay on "Opening the proposal…" | opens at once; a request that does not answer within 10 s ends, and "This is taking longer than it should" offers a way out |

### Hyperliquid's record on accepted proposals (R3)

| Case | Seen |
|---|---|
| A testnet send accepted by Hyperliquid | "On Hyperliquid's record. Carried out 14 Oct 2026, 02:29. Transaction" |
| A copy whose refusal was edited to "accepted", opened by link in an isolated context | red: "Refused on Hyperliquid's record: Insufficient balance for withdrawal" |
| The same, with the explorer's list stubbed empty | amber, never folded: "Not on Hyperliquid's record" |
| Signing log of the test treasury | every accepted entry, both steps of each move included, tagged "on Hyperliquid's record", from one explorer request for the page |

Measured for it on five lab multi-sigs: a mode switch is listed with its one-letter code; an envelope refused for its outer signature is not listed at all; a refused execution is listed with its `error`.

### The remaining bugs (R4, U12, U6, U21, U22, U24, C2, U27 and the rest)

| Case | Seen |
|---|---|
| R4: a proposal on a treasury reported as unified (read stubbed) | no Sign button; "Cannot be sent while the treasury is a unified account." in Your part |
| U24: a 100,000 USDC withdrawal proposal | "Hyperliquid would refuse this as things stand: This sends 100000 USDC, and the treasury can move 2 from its perps balance right now." |
| C2, U35: a withdrawal numbered after a waiting send | "An older USDC send is still waiting", on the form and on the page |
| U22: a newer send | "Sending this first shuts out 2 older …", for every signer |
| U16, U10: the withdraw form | no "required" message before a field is left; Create off with the reason beside it |
| U21: inbox | "cannot be finished: refused", "…: a later send went first" |
| U6, U12, U27, U8 and the messages of 3k | by their tests; U6 and U12 by reading the screens after a wallet switch |

All test proposals of these checks were cancelled afterwards; none was sent.

### Phone and accessibility

| Check | Seen |
|---|---|
| Proposal page at 375×812, a signer who can sign | title first, one-line wallet bar, status, summary, the stop notice open, then the action; a bar at the bottom "Sign ▾" that brings "Your part" into view under the sticky header and hides while it is on screen; no bar for a signer who has signed, none at 1440×900 |
| Notes fold | with the proposal reads to the sharing service refused: "1 note", opening to "The sharing service could not be reached. Links and files still work." |
| Light theme at both sizes | right colours; amber text oklch(0.48 0.13 70), 5.9:1 on the page; `theme-color` "#f9fafb" in light (one tag, written by the theme script: the router keeps one tag per name) |
| Treasury tabs at 375 | ArrowLeft from Overview wraps to "On Hyperliquid", focus follows, the row scrolls with a faded edge; Home goes back; the tree has six tabs, one focusable, and a tabpanel named by its tab |
| Network switch with mainnet selected | radio "Testnet" with the description "Something needs you on testnet."; its name stays "Testnet" |
| "While you were away" | folded, still folded after a reload, opened again |
| "Updated … ago" | "Updated just now"; the refresh button 24 px on a desktop, 44 px on a phone |
| Console | nothing of the app's (only the wallet extensions' own messages) |

### Newcomers

| Check | Seen |
|---|---|
| `/multisig` with no wallet (isolated context) | "How this works" in six numbered steps with "Words used here"; the two cards; "Create a treasury" and "Look at a treasury" (the inspector, `?view=account`); "Hide this" hides the card, still hidden after a reload |
| `/multisig/glossary` at 375 | 18 terms, the expert's word beside two; linked from the footer |
| The propose form | "Convert back" after "Change signers"; each switches to the other cleanly |
| Signers pasted on separate lines | both added as two signers (the paste box reads the pasted text itself; a dispatched paste event, since CDP's key press does not paste) |
| A proposal the reader can sign, card not hidden | one line: "You have been asked to sign…" with "Got it" |

### Features

| Check | Seen |
|---|---|
| A testnet bridge withdrawal's row | "−1 USDC, arrives · 2 requested, fee 1 USDC", beside its proposal "withdraw 2 USDC" |
| Download CSV, Transfers (download intercepted in the page) | `hl-transfers-testnet-…-2026-10-14.csv`: the withdrawal as `-1,USDC,1.0,USDC,2,<hash>,<proposal>`, a vault withdrawal as `likely <proposal>` |
| Download CSV, Signing log | first bytes EF BB BF; header `Time (UTC),What happened,Proposal,Hyperliquid's record`; oldest first; addresses whole |
| The whole figure on hover | "1.99 USDC" → 1.996729; table cells 1.99 → 1.996762 and -0.003237 → -0.0032378497; a figure that lost nothing to the cut has no title |

### After a code review of the round (2026-10-15)

Another session read the nine commits (`labs/qa-mainnet-readiness/CODE_REVIEW.md`, 23 findings plus nits). Each was checked against the code before anything changed.

| Finding | Verdict | What changed |
|---|---|---|
| 1. The session re-check when a tab is looked at again never fired | real: Supabase's request builder sends only when its answer is asked for, and `void` never asks | it asks; in the browser one `rpc/whoami` goes out on the event, and none on a second within the minute |
| 2. Without `AbortSignal.any` the 10 s limit was dropped | real (Safari before 17.4, Firefox before 124) | one combined signal by hand; tested with `AbortSignal.any` removed |
| 4. A push sent later relied on `push` never throwing | true, harmless today | caught |
| 6. "Not on Hyperliquid's record" with no moment of sending | latent (every caller passes one) | never "missing" without it: "unchecked" |
| 7. Explorer reads from "While you were away" | the record check read even while the notice was folded | read only while it is open: inbox with nine treasuries, 5 explorer requests open, 3 folded (the 3 are the notice's own transfer matching, as before) |
| 8. CLAUDE.md said the explorer is read only through `useTxLookups` | contradiction | one rule: `live/explorerList.ts`, shared by `useTxLookups` and `useRecords` |
| 9. The refused sentence | "whatever the report of its sending says" read oddly | "It was not carried out, even though it was reported as accepted." The "missing" sentence is the owner's and stays |
| 11. CSV rows not checked read as "no proposal" | real | "not checked", "none on record", "Hyperliquid's own step", as on screen |
| 12. The whole figure only on hover | real for screen readers | also in visually hidden text |
| 13. Results could be announced twice | real: the region turned assertive around a callout that is already an alert | the region stays polite; the danger callout carries the urgency |
| 14. A write the sharing service refused folded into "N notes" | real: co-signers may not see what was done | a stop notice |
| 15, 16. "The relay refused the request." on screen; the jargon test skipped any string beside `??`, `||`, `&&` or `+` | real | the test skips only comparisons, and caught a second sentence; both say "sharing service" |
| 17. "a new proposal would run a second time" | asserted what is not known | "if this one went through, a new proposal would do it a second time" |
| 18. No first-run card or "Look at a treasury" in a build without the sharing service | real | both on its start page |
| 19. `cancelNote` not checked for forbidden claims | real | checked |
| 20. A false "Hyperliquid would refuse this" while the account mode is unread | real for a unified treasury (perps reads 0) | no balance is held against an unread mode; tested |
| 21. The page's older-sends warning had nothing when signed out | real | signed out, it reads this browser's proposals, as the form does (no new request to the sharing service) |
| 22. The plain wallet sentence missing on Sign and Send | real | "Your wallet did not sign (declined or closed). Nothing was added to it." / "… Nothing was sent." |
| 23. "did not answer" matched "aborted" anywhere | loose | names decide; "timed out" stays (a gateway timeout is no answer) |
| Copy audit #13, #15 | still open | "Can't reach the sharing service. Your co-signers' updates will not show until it is back; you can still share by link or file."; the propose form's exact action behind "Show the exact action" |
| Nits | | links into the wizard pass `network`; the address error in plain words; a doc comment moved; "While you were away" no longer opens for a frame before folding; a unified withdrawal's source goes through the core's `withdrawalFrom` |

Left, with the reason: 5 (a copy's "accepted" replacing a stored refusal) is the merge behaviour the owner chose to keep, with Hyperliquid's record shown instead; 3 is a comment made exact, not a change; 10 (a month picker on the CSVs) is not built, because the rows loaded do not always cover a month, and the page now says the file holds the rows listed; the treasury and multi-sig wording, the legacy "said no", "Threshold" against "Number that must sign" and the other nits are wording or polish with no effect on what is signed or sent.

3,333 unit tests pass; types and lint clean.

### Limits

- Phone wallets and WalletConnect are out of this round; the section offers only the wallets in the browser.
- The bottom bar on a phone brings the reader's part into view; it never signs by itself.
- The CSV holds the rows the page has loaded: the Signing log's loaded pages, and the "On Hyperliquid" lists as Hyperliquid sent them (the newest trades and orders, then every new one).
- Hosting and launch work (headers, the faucet miner's origin, production env) come after this round.

## 22. Multisig: more room, chosen by a panel (2026-10-15 to 2026-10-18)

The owner found the section squished: at 1440×900 the page stopped at 1,200 px, the rail took 252 px and the content had 872 px; on the propose form the left column was about 270 px and still split into two, and the API wallet's "until …" tag spilled out of its box. Four visual versions were built in parallel on their own branches, each with the same rules: Multisig only, no wording, flow, request or backend change. They ran side by side with today's on five ports. A matched set of 19 screenshots per version went to a panel of six independent judges, who did not see the builders' or the session's opinion. A+, version A with what the judges asked for, was then built and chosen by the owner.

### The panel (overall score out of 10)

| Judge | Today | A, more room | B, exchange-style | C, workspace | D, calm document |
|---|---|---|---|---|---|
| Exchange product designer | 4 | 7 | 8 | 6 | 5 |
| Treasury operations lead | 5 | 8 | 7 | 6 | 4 |
| Signing-safety specialist | 5 | 8 | 4 | 6 | 7 |
| Design systems and brand lead | 5 | 8 | 7 | 5 | 6 |
| Accessibility and mobile | 5 | 8 | 6 | 6 | 7 |
| First-time co-signer | 5 | 7 | 6 | 8 | 6 |
| Average | 4.8 | 7.7 | 6.3 | 6.2 | 5.8 |

What decided it: B's propose form put "what every signer will sign" in a box with its own scrollbar under a pinned Create card that covered the exact action; C's proposal picture showed the receiver as its first and last four characters (the pattern address poisoning forges) and its multicolour avatars clashed with amber and red; D put a proposal's status after the whole document, below the fold. Every judge wanted D's confirmation block, B's balance tiles and phone section bar, and C's numbered steps carried into A.

### A+ (branch `ui/a-plus`)

| Check | Seen |
|---|---|
| Header and footer | one 1,440 px container on every page: the logo sits at the same x on `/`, `/tools/multisig` and `/multisig` (24 px at 1440, 257 px at 1920) |
| Columns that stay in view | stick at the site header's measured height plus 16 px (73 px), only while they fit the window; the Preview title and its network badge no longer slide under the header |
| Propose form | Preview, then Create, then the exact-action fold, with no inner scroll box; at 1440×900 the Create buttons end at 856 px once the one-time notice is dismissed |
| Blocked buttons | grey, with the reason directly under them |
| Proposal page | status first; under it the action, the amount as the largest figure in tabular numerals, the destination whole, and a Treasury / Destination / Finaliser table with copy buttons; signatures beside it; "Your part" restates the action, the full destination and the network above Sign |
| Treasury page | balance tiles above "While you were away" and the tabs on every tab ("In staking" and "In vaults" on the Overview only, where they are read today); 2×2 on a phone |
| Rail | 248 px; names wrap; "2 of 3" and "no longer a multi-sig" are never cut; the teal shield mark with "Multisig" |
| Phone | a "Multisig · Needs you" bar; help marks have a 24×24 px target |
| Light theme | "you: signer" chip 6.0:1, "signed · verified" 6.23:1 |
| Overflow | no element wider than its box and no sideways page scroll at 375, 1024, 1280, 1440 and 1920, both themes, on the inbox, all six treasury tabs, open, expired and move proposals, both propose forms, the wizard, Open and the glossary |
| An empty network | with mainnet selected and no mainnet treasury: "Looking for testnet? You have 12 treasuries there: switch the network in the header." and in the rail "None on mainnet yet. 12 on testnet." (staged by hiding the mainnet rows in the page only) |
| Wording | every on-screen string compared with the base: unchanged apart from the step numbers and two colons dropped from tile labels |
| Suites | 130 files, 3,335 unit tests; types, lint and build clean (no relay or core change) |

Found on the way and fixed on `feat/multisig-live`: the wallet picker listed every wallet once more each time the section was entered again (wagmi's own bug; `src/integrations/wallet/uniqueConnectors.ts`, tested), and Biome refused to run while a Claude Code worktree sat under `.claude/`.

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

## EVM → Core transfers in the trace (2026-10-05)

From a brief written against the deployed trace page by the author of a staked tic-tac-toe contract on testnet: its payouts go through Circle's `CoreDepositWallet.depositFor`, not CoreWriter, and the page both misled (the "fail silently" explainer under a successful payout) and had a gap (transfers were counted, never verified). Each transaction below was run through `/tools/trace` on testnet in Chrome after the fix; the four marked fixture were also recorded with `record_trace.ts` and replay in `test/corewriter.test.ts`.

| Tx | Expected (from the brief) | Page showed | Fixture |
|---|---|---|---|
| `0x9eb9d39e…7fc4` | 8 USDC to `0x7b67…496e`, credited 10:26:50.001 | "No CoreWriter action; 1 EVM → Core token transfer traced below" · transfer 1 of 1 · `8 USDC` · **credited** · stage 2 "emitter 0x0b80…c206 (USDC linked contract), 0x7b67…496e → 0x2000…0000" · stage 3 "8 USDC → spot of 0x7b67…496e, 8000000 ÷ 10^6" · stage 4 "8 USDC credited to 0x7b67…496e on HyperCore, +0.001 s after the EVM block, 2026-10-05 10:26:50.001 UTC" · comparisons token/amount/account all ✓ · L1 tx link · finding "Credited 0.001 s after the EVM block" · Info API (1) | ✅ `testnet-deposit-credited` |
| `0xa24a07af…7750` | 4 USDC, credited 0.038 s after | `4 USDC` · **credited** | ✅ |
| `0x04366fad…4746` | 2 USDC, credited 0.141 s after | `2 USDC` · **credited** · "+0.141 s after the EVM block" | ✅ |
| `0xd53c9d25…40dd` | two transfers, both credited | "2 EVM → Core token transfers traced below" · "transfer 1 of 2 · 1 USDC · credited" (0xfe13…65ec, +0.067 s) · "transfer 2 of 2 · 1 USDC · credited" (0x7b67…496e) · Info API (2): one ledger query per account | ✅ `testnet-deposit-multi` |
| `0x2628bf11…95f9` | **not credited** | `2 USDC` · **no credit observed** · stage 4 "No HyperCore credit observed" · observed panel "Searched 0 ledger update(s) for 0x7b67…496e between −5 s and +120 s of the EVM block" with expected token/amount/account and observed "—" · finding "HyperCore did not credit this transfer" (bad, inferred) · callout "Why a transfer can be dropped: the protocol does not state a cause" | ✅ `testnet-deposit-dropped` |
| `0xdcceca12…b99a` | **not credited** (`0xe45e…7826`) | `1 USDC` · **no credit observed** | ✅ |
| `0xee9386cc…326a` | **not credited** (`0xfe13…65ec`) | `6 USDC` · **no credit observed** | ✅ |
| `0x3a9db223…cc4f` | no transfer, no CoreWriter action | "This transaction emitted no CoreWriter actions … No ERC-20 Transfer to a system address either, so nothing crossed to HyperCore" · collapsed "Reference: how CoreWriter actions can fail silently (not relevant here …)" · gas used 37,901 with no CoreWriter note · EVM → Core transfers "none" · Info API (0) | ✅ `testnet-no-crossing` |
| `?tx=0x9eb9…` while on mainnet | — | "No transaction … on mainnet. It exists on testnet" with a "Switch to testnet and trace" button; the trace never switches on its own | ✅ |
| `?sample=limit-order` (mainnet CoreWriter order) | unchanged | Action 1 of 1 with the full flow, "Why CoreWriter actions fail silently" shown in full as before, gas note present | ✅ regression |

Unit coverage (5 new replay tests): credited transfer resolves USDC via the emitting contract with evmDecimals 6, credited account = log `from`, observed at +1 ms, exactly one `userNonFundingLedgerUpdates` call; dropped transfer is `inferred` "No HyperCore credit observed" with a bad "did not credit" finding, or a warn "Not credited yet" when `now` is 5 s after the block; two transfers to two accounts are reported separately with two ledger queries; a transaction with no crossing has no transfers and makes no info call.

What the brief got right: everything about the on-chain path, the log order, the ledger entry and the timing. One point to correct: the receipt table's "CoreWriter actions 0" and "EVM → Core transfers" rows were already computed from the receipt, so no RPC change was needed; only the Info API side was missing.

## Final regression pass

Every page, both themes, desktop 1440×900 and mobile 375×812, captured full-page from an isolated browser context (home, orders, signing and CoreWriter re-captured after feedback round 1) (no wallet connected, fresh storage, so nothing personal is in the images). Tool pages were captured with their built-in sample loaded. Each image was reviewed; problems found during the pass are logged in the sections above and were fixed before the final capture.

Also verified at the end: `bun --bun run test` (277 passing after this round), `bun --bun run check` (clean), `bun --bun run build` (succeeds; the mock panel and MSW worker are not in the client bundle).

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
| Multisig Inspector — account (2026-10-09) | [view](docs/screenshots/multisig-dark-desktop.jpeg) | [view](docs/screenshots/multisig-light-desktop.jpeg) | [view](docs/screenshots/multisig-dark-mobile.jpeg) | [view](docs/screenshots/multisig-light-mobile.jpeg) |
| Multisig Inspector — envelope (2026-10-09) | [view](docs/screenshots/multisig-envelope-dark-desktop.jpeg) | [view](docs/screenshots/multisig-envelope-light-desktop.jpeg) | [view](docs/screenshots/multisig-envelope-dark-mobile.jpeg) | [view](docs/screenshots/multisig-envelope-light-mobile.jpeg) |
| Multisig Signer — start, `/multisig/open` (2026-10-10, new shell) | [view](docs/screenshots/multisig-sign-dark-desktop.jpeg) | [view](docs/screenshots/multisig-sign-light-desktop.jpeg) | [view](docs/screenshots/multisig-sign-dark-mobile.jpeg) | [view](docs/screenshots/multisig-sign-light-mobile.jpeg) |
| Multisig — propose, the send form on a manual treasury (2026-10-11) | [view](docs/screenshots/multisig-propose-dark-desktop.jpeg) | [view](docs/screenshots/multisig-propose-light-desktop.jpeg) | [view](docs/screenshots/multisig-propose-dark-mobile.jpeg) | [view](docs/screenshots/multisig-propose-light-mobile.jpeg) |
| Multisig — propose, the send form on a unified treasury (2026-10-11) | [view](docs/screenshots/multisig-propose-unified-dark-desktop.jpeg) | [view](docs/screenshots/multisig-propose-unified-light-desktop.jpeg) | [view](docs/screenshots/multisig-propose-unified-dark-mobile.jpeg) | [view](docs/screenshots/multisig-propose-unified-light-mobile.jpeg) |
| Multisig — proposal, with "seen" marks (2026-10-11) | [view](docs/screenshots/multisig-proposal-dark-desktop.jpeg) | [view](docs/screenshots/multisig-proposal-light-desktop.jpeg) | [view](docs/screenshots/multisig-proposal-dark-mobile.jpeg) | [view](docs/screenshots/multisig-proposal-light-mobile.jpeg) |
| Multisig — landing, signed out (2026-10-10) | [view](docs/screenshots/multisig-landing-dark-desktop.jpeg) | [view](docs/screenshots/multisig-landing-light-desktop.jpeg) | [view](docs/screenshots/multisig-landing-dark-mobile.jpeg) | [view](docs/screenshots/multisig-landing-light-mobile.jpeg) |
| Multisig — Needs you, with "While you were away" (2026-10-11) | [view](docs/screenshots/multisig-inbox-dark-desktop.jpeg) | [view](docs/screenshots/multisig-inbox-light-desktop.jpeg) | [view](docs/screenshots/multisig-inbox-dark-mobile.jpeg) | [view](docs/screenshots/multisig-inbox-light-mobile.jpeg) |
| Multisig — treasury, Overview with "last signed" (2026-10-12) | [view](docs/screenshots/multisig-overview-dark-desktop.jpeg) | [view](docs/screenshots/multisig-overview-light-desktop.jpeg) | [view](docs/screenshots/multisig-overview-dark-mobile.jpeg) | [view](docs/screenshots/multisig-overview-light-mobile.jpeg) |
| Multisig — treasury, Overview of a unified account (2026-10-11) | [view](docs/screenshots/multisig-overview-unified-dark-desktop.jpeg) | [view](docs/screenshots/multisig-overview-unified-light-desktop.jpeg) | [view](docs/screenshots/multisig-overview-unified-dark-mobile.jpeg) | [view](docs/screenshots/multisig-overview-unified-light-mobile.jpeg) |
| Multisig — treasury, On Hyperliquid (2026-10-11, top of the table) | [view](docs/screenshots/multisig-onchain-dark-desktop.jpeg) | [view](docs/screenshots/multisig-onchain-light-desktop.jpeg) | [view](docs/screenshots/multisig-onchain-dark-mobile.jpeg) | [view](docs/screenshots/multisig-onchain-light-mobile.jpeg) |
| Multisig — treasury, Signing log (2026-10-11) | [view](docs/screenshots/multisig-treasury-dark-desktop.jpeg) | [view](docs/screenshots/multisig-treasury-light-desktop.jpeg) | [view](docs/screenshots/multisig-treasury-dark-mobile.jpeg) | [view](docs/screenshots/multisig-treasury-light-mobile.jpeg) |
| Multisig — nickname dialog (2026-10-11) | [view](docs/screenshots/multisig-nickname-dark-desktop.jpeg) | [view](docs/screenshots/multisig-nickname-light-desktop.jpeg) | [view](docs/screenshots/multisig-nickname-dark-mobile.jpeg) | [view](docs/screenshots/multisig-nickname-light-mobile.jpeg) |
| Multisig — add a treasury (2026-10-10) | [view](docs/screenshots/multisig-add-dark-desktop.jpeg) | [view](docs/screenshots/multisig-add-light-desktop.jpeg) | [view](docs/screenshots/multisig-add-dark-mobile.jpeg) | [view](docs/screenshots/multisig-add-light-mobile.jpeg) |
| Multisig — create a treasury (2026-10-12) | [view](docs/screenshots/multisig-create-dark-desktop.jpeg) | [view](docs/screenshots/multisig-create-light-desktop.jpeg) | [view](docs/screenshots/multisig-create-dark-mobile.jpeg) | [view](docs/screenshots/multisig-create-light-mobile.jpeg) |
| Multisig — change signers (2026-10-12) | [view](docs/screenshots/multisig-change-signers-dark-desktop.jpeg) | [view](docs/screenshots/multisig-change-signers-light-desktop.jpeg) | [view](docs/screenshots/multisig-change-signers-dark-mobile.jpeg) | [view](docs/screenshots/multisig-change-signers-light-mobile.jpeg) |
| Multisig — convert back to a normal account (2026-10-12) | [view](docs/screenshots/multisig-convert-back-dark-desktop.jpeg) | [view](docs/screenshots/multisig-convert-back-light-desktop.jpeg) | [view](docs/screenshots/multisig-convert-back-dark-mobile.jpeg) | [view](docs/screenshots/multisig-convert-back-light-mobile.jpeg) |
