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
| `src/lib/signerWallets.test.ts` | The signer's wallet list never contains RainbowKit's generic WalletConnect entry, whose modal reports the page URL to a third party |
| `src/lib/detect.test.ts` | Proposal documents and signer links route to the Multisig Signer; envelopes and addresses stay with the inspector; other share links and URLs are not mistaken for proposals; every earlier rule still holds |
| `multisig/model/actions.test.ts` | Each of the six kinds builds an action `createProposal` accepts; title, note, proposer and superseded digest carried; amounts canonical and never rounded (`1.0` → `1`, precision errors); address checks and the self-send warning; spot token against the network's list and its decimals; balance excess warns and never blocks; raw JSON limited to user-signed types (L1 and `convertToMultiSigUser` refused, overridden fields noted); finaliser required and from the current signer set; `formFromAction` rebuilds the same action; issue paths map to form fields |
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
| 100 USDC with 24 withdrawable: S2 proposes and signs, S1 (finaliser) signs and submits | the chain answers HTTP 200 `{"status":"err","response":"Insufficient balance for withdrawal."}`; the page shows "The last submission was rejected: …" with cause and fix, steps done · done · failed, the button still enabled, the receipt kept, history "rejected", stage still "Ready · 2 of 2 signatures" | ✅ |
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
| Ending and results | Only the proposer withdraws, only the finaliser declines; a rejection stays retryable and an acceptance closes; only the finaliser may report; an accepted signer change is looked up ahead of everything |
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
| a send of 100 USDC from a treasury holding 10.8 | Hyperliquid's "Insufficient balance for withdrawal." stored as a rejected receipt and explained; the proposal stays open with "Submit" (one prompt) | ✅ |

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
| Multisig Signer — propose (2026-10-10, new shell) | [view](docs/screenshots/multisig-propose-dark-desktop.jpeg) | [view](docs/screenshots/multisig-propose-light-desktop.jpeg) | [view](docs/screenshots/multisig-propose-dark-mobile.jpeg) | [view](docs/screenshots/multisig-propose-light-mobile.jpeg) |
| Multisig Signer — proposal (2026-10-10, new layout) | [view](docs/screenshots/multisig-proposal-dark-desktop.jpeg) | [view](docs/screenshots/multisig-proposal-light-desktop.jpeg) | [view](docs/screenshots/multisig-proposal-dark-mobile.jpeg) | [view](docs/screenshots/multisig-proposal-light-mobile.jpeg) |
| Multisig — landing, signed out (2026-10-10) | [view](docs/screenshots/multisig-landing-dark-desktop.jpeg) | [view](docs/screenshots/multisig-landing-light-desktop.jpeg) | [view](docs/screenshots/multisig-landing-dark-mobile.jpeg) | [view](docs/screenshots/multisig-landing-light-mobile.jpeg) |
| Multisig — Needs you (2026-10-10) | [view](docs/screenshots/multisig-inbox-dark-desktop.jpeg) | [view](docs/screenshots/multisig-inbox-light-desktop.jpeg) | [view](docs/screenshots/multisig-inbox-dark-mobile.jpeg) | [view](docs/screenshots/multisig-inbox-light-mobile.jpeg) |
| Multisig — treasury, History tab (2026-10-10) | [view](docs/screenshots/multisig-treasury-dark-desktop.jpeg) | [view](docs/screenshots/multisig-treasury-light-desktop.jpeg) | [view](docs/screenshots/multisig-treasury-dark-mobile.jpeg) | [view](docs/screenshots/multisig-treasury-light-mobile.jpeg) |
| Multisig — add a treasury (2026-10-10) | [view](docs/screenshots/multisig-add-dark-desktop.jpeg) | [view](docs/screenshots/multisig-add-light-desktop.jpeg) | [view](docs/screenshots/multisig-add-dark-mobile.jpeg) | [view](docs/screenshots/multisig-add-light-mobile.jpeg) |
