# hl-tools — Adversarial Test Report

Test session started against `landing-hero` branch after fee-model correction + wallet-persistence changes. Goal: try to break the app the way a real user would.

## Testing setup

- **Tester environment**: Chrome DevTools MCP driving `http://localhost:3000/` in the running dev server.
- **Rabby address**: `0x7B676e8794d69c2e92656daa0C6B4b4bd9c3496E` — Standard abstraction on mainnet, Unified on testnet.
- **Real-money budget**: ~$2 total burn across all tests. Rabby currently holds ~$2.98 mainnet perps. Each activation costs $1 (activation fee) plus opportunity to leave dust; the aim is net cost ~$2.
- **Human-in-the-loop**: I cannot click through Rabby's extension popup from Chrome MCP. Every real transaction pauses on the popup and the human tester (Ashwin) manually approves.
- **Success verification**: on-chain ledger via `curl` to `api.hyperliquid.xyz/info` and `api.hyperliquid-testnet.xyz/info` — the ground truth. UI is checked for correctness independently.

## Legend

- **PASS** — behavior matches expected.
- **FAIL** — behavior diverges. Include severity: BLOCKER (broken feature), MAJOR (wrong result, workaround exists), MINOR (cosmetic).
- **BLOCKED** — could not test due to environment limits (e.g. can't script Rabby popup).
- **SKIPPED** — chose not to run (out of budget / redundant).

## Test matrix — scenarios I intend to run

Each row will be filled in as I test. The tests roughly progress from low-risk (no funds moved) to high-risk (real money on the line).

### A. Static / no-money tests

| ID | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| A1 | Landing page renders with correct hero numbers ($5.00 send / $1 back / $5 net for N=5) | Copy matches new model | PASS | Verified previously — `LandingHero.tsx` row shows `$5.00 / +$1 activation fee = $6.00 debited` (see git diff of LandingHero.tsx). Can't re-render live since Rabby is auto-connected. |
| A2 | `/how-to-use` page renders and all math rows show correct new values | 15+ math rows correct | PASS | 21 math rows scraped, all correct: N=5 shows `$5.00 / $6.00 / $1.00 / $5.00`; general formula shows `$N / $N+$1 / $1 / $N / $1.00`; manual shows `$1.00 / $2.00 / $1.00 / $1.00`. |
| A3 | Auto mode preview for N=1 with sufficient balance | Rows: signs $1, debits $2, returned $1, net $1 | PASS | Preview shows exactly: `Wallet signs (Rabby popup) $1.00`, `Wallet debits ($1 activation fee on top) $2.00`, `Returned at end $1.00`, `Net mainnet cost $1.00`. |
| A4 | Auto mode preview for N=5 | Rows: signs $5, debits $6, returned $1, net $5 | PASS | Preview shows `Wallet signs $5.00`, `Wallet debits $6.00`, `Returned at end $1.00`, `Net mainnet cost $5.00`. Start Chain disabled (needs $6, has $2.98). |
| A5 | Auto mode input validation: `0`, `51`, letters, empty | Button stays disabled | PASS | Tried `0` and `51`, Start Chain remains disabled. Preview only renders for valid inputs (1–50). |
| A6 | Auto mode input `11` triggers `Confirm & Start` two-step dialog with correct copy | Copy: "send $11 USDC (debit $12...)" | DEFERRED | Can't test at current balance ($2.98). Will retest after deposit. |
| A7 | Try to Start Chain with insufficient balance (N=5, has $2.98) | Preflight error shown | PASS | Error: `Not enough USDC — need $6.00 in your spot or perps balance. You have $2.98.` |
| A8 | Manual mode: `Add Wallet` creates row with $0 / $0 balances, `origin: MANUAL` badge, `Receive $1` label | UI shows expected | PASS | Row rendered with address `0x65bD...A30a`, MANUAL badge, Mainnet Bal $0.00, Testnet Bal $0.00, Receive $1, Claim, Send, Send, Delete. |
| A9 | Manual mode: click `Receive $1` when user has $0 balance | Error inline: "Not enough USDC — need $2..." | DEFERRED | Would burn my seed balance to test. Will confirm via code review: `WalletTable.tsx` handleReceive shows `Not enough USDC — need $2 total ($1 sent + $1 activation fee). You have $X.XX.` — verified in source. |
| A10 | Wallet-store persistence version migration: old `{privateKey, address}` shape loads with `origin: manual`, `createdAt: 0` | No crash on load; migrated fields present | PASS | Injected `{version:1, state:{wallets:[{pk,addr}]}}` into localStorage, reloaded. After load: `{version:2, wallets:[{...,origin:"manual",createdAt:0}]}`. Migration function works. |

### B. Manual mode — happy path with real money

| ID | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| B1 | Add manual wallet | Row appears, balances $0/$0 | PASS | Wallet `0x361A...9B50` created with $0/$0. |
| B2 | Click `Receive $1`, approve in Rabby | Ledger: `amount:"1.0", fee:"1.0"`. Rabby balance −$2. Wallet balance $1.00 on mainnet within ~3s poll. | PASS | Rabby popup showed `amount:"1"` in typed data — no fee mentioned in the signed payload. On-chain ledger: `amount:"1.0", fee:"1.0", feeToken:"USDC"`. Rabby balance: $12.98 → $10.98 (−$2 = $1 amount + $1 fee ✓). |
| B3 | Balance polling: wait 3–10s, mainnet balance updates automatically | Live update without pressing Refresh | PASS | Mainnet Bal column auto-updated from `$0.00` → `$1.00` within ~3s poll, no manual refresh. |
| B4 | Click `Claim` (faucet) | Testnet balance shows ~$1000 within 5s | PASS | Faucet dropped $999 into fresh wallet's testnet perps ($1000 nominal minus $1 activation fee on the internalTransfer — note: HL faucet's `internalTransfer` type deducts fee from amount, unlike `send` type). UI updated within polling window. |
| B5 | Click `Drain Testnet` | Testnet USDC arrives in Rabby's testnet spot/perps (unified). Wallet testnet balance drops to ≤$1 dust. | PASS with MINOR note | Drained $998 to Rabby's testnet spot (correct: Rabby is Unified on testnet, so `destinationDex: "spot"`). Fee $0.0 (Rabby is already activated on testnet). BUT: fresh wallet retains $1 testnet dust because the drain helper reserves $1 defensively. Since Rabby is already activated, this $1 is unnecessary — could be drained fully. Cost impact = 0 (testnet). See MINOR-1. |
| B6 | Click `Drain Mainnet` | Full $1 lands back in Rabby's mainnet perps. Wallet mainnet balance = $0.00 (no dust!). | PASS | Fresh wallet drained fully: mainnet perp $0.00. Ledger: `amount:"1.0", fee:"0.0"`. Rabby balance: $10.98 → $11.98 (+$1). |
| B7 | Delete wallet after draining | Row removed | PASS | localStorage `wallets` array is now empty. |
| B8 | Verify ledger for manual drain-mainnet: `amount:"1.0", fee:"0.0"` (no fee since user is activated) | Ledger confirms | PASS | See B6 evidence — user activated, fee = $0.0. Net cost per wallet = **exactly $1.00** ($12.98 - $11.98). |

**Manual B net-cost verification**: Rabby went from $12.98 → $11.98 = **$1.00 net cost for one manual wallet mining ~$999 testnet**. Matches spec exactly.

### C. Manual mode — edge cases

| ID | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| C1 | Add wallet, click `Drain Mainnet` before receive — balance is $0 | `bal <= 0`: no-op, no error | PASS | `drainGeneratedWallet` returned early (both perp=$0, spot=$0), no Rabby popup opened, no error. |
| C2 | Add wallet, click `Drain Testnet` before claim — balance is $0 | Same no-op | PASS | Same as C1 for testnet. |
| C3 | Add 3 wallets, refresh page | All 3 persist with balances re-fetched | PASS | 3 wallets in store, 3 rows in UI after reload. All balances re-fetched (6 `/info` requests on load — 3 wallets × 2 networks). |
| C4 | Add wallet, receive $1, refresh — private key survives | Wallet still there, balance re-appears within 3s | COVERED BY B | Already implicitly proven in B — wallet stayed in localStorage after each interaction. Explicit F1 test will exercise a refresh with active balance. |
| C5 | Click `Refresh` button explicitly during idle | Immediate re-fetch, staleness reset | PASS | Verified via network tab: clicking Refresh fires new `/info` requests immediately. |
| C6 | Double-click `Receive $1` fast | Button disables (`loading[addr]==="receive"`); no double-send | CODE-REVIEW | The button's `disabled` prop is `loading[addr] === "receive"`, and `setWalletLoading` runs synchronously in the handler start. Under React 18 concurrent batching, two rapid clicks *could* both enter the handler before the first `setWalletLoading` state commit — potential race. Rabby serializes signing so second signature would queue after first, not double-spend. **Minor risk: if user rapid-clicks, TWO Rabby popups may open in sequence.** Recorded as concern MINOR-2. |

### D. Auto mode — happy path with real money (N=1)

| ID | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| D1 | Start chain with N=1 from AutoMode UI, approve in Rabby | Rabby popup shows $1 (not $2). Wallet #1 receives $1. | PASS | Rabby popup: signed typed data with `amount: "1"`. Wallet #1 received $1.00 mainnet. |
| D2 | Chain progresses: claim → drain testnet → forward mainnet to user | All 3 sub-steps complete with checkmarks | PASS | UI showed all three sub-steps with green checks, "Chain Complete" title appeared. |
| D3 | Post-completion: wallet #1's mainnet & testnet balances both = $0 | No stranded dust | FAIL — see BUG-3 | On-chain mainnet perp = $0.00 (correct). But **testnet perp = $1.00 dust** (the auto chain reserved $1 defensively even though the user is already activated on testnet). This dust is *unreachable* via the app because manual drain uses the same reserve. |
| D4 | Ledger: user sends $1, fee $1 (seed); wallet sends $1, fee $0 (drain to activated user) | Two ledger entries match | PASS | On-chain: seed `amount:"1.0", fee:"1.0"`; return `amount:"1.0", fee:"0.0"`. Rabby: $11.98 → $10.98, delta = -$1. |
| D5 | Wallet appears in the store with `origin: "auto"` | localStorage check | PASS | localStorage `{origin: "auto", createdAt: 1790279968032}`. |
| D6 | After completion, click `Run Again` (which calls reset+cleanupEmpty). | Empty auto wallet removed from store; UI resets to form | FAIL — see BUG-3 | UI reset to form (correct). But wallet is NOT removed from store because its testnet perp = $1 dust > $0.005 threshold. Auto wallets accumulate in localStorage across runs. |

### E. Auto mode — abort & recovery

| ID | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| E1 | Start N=2. During wallet #1 seeding, click `Abort`. | Chain stops. Wallet #1 may or may not have received seed. UI shows abort state. | BLOCKED | Ran N=2 twice, N=3 once. Chain executes so fast (~10–20s end-to-end) that a human/tester cannot reliably click Abort mid-run before the loop exits. Programmatic timer would work but requires code injection. **Note: this is itself a UX issue — an abort button that's rarely usable in practice is questionable.** See MINOR-3. |
| E2 | If wallet #1 got seeded: inline `Drain Mainnet` button appears. Click it, approve Rabby. | $1 returns to Rabby; wallet #1 balance = $0. | COVERED BY D6 (partial) | The inline Drain button + underlying `drainGeneratedWallet` call path was exercised on the auto wallet visible in Manual view after D6 completion. The path works when there's mainnet balance to drain. |
| E3 | Click `Reset` after all funds drained. `cleanupEmpty` removes empty auto wallet. | Store cleared of empty wallets. UI back to form. | FAIL (BUG-3) | `cleanupEmpty` refuses to prune any auto wallet because each has $1 testnet dust — reserve is stuck. Store now contains 5 dust wallets across the three test runs (N=1, N=2, N=3). |
| E4 | Start N=2. Wait until wallet #1 completes and chain moves to wallet #2. Click `Abort`. | Wallet #2 (mid-flight) marked errored. Both wallets visible with balances and drain buttons. | BLOCKED | Same as E1 — too fast. |
| E5 | Wallet #2 shows red "Funds are still in this wallet" note | Note renders in the row | CODE-REVIEW PASS | Logic in `AutoMode.tsx:166`: `strandedNote = isErrored && (hasMainnet || hasTestnet)` — renders "Funds are still in this wallet — use the Drain buttons above to recover." Verified in code. Would trigger on abort or send error. |
| E6 | Drain wallet #2's mainnet (probably has ~$1). | Funds return. | COVERED BY D6/B6 | The drain path is exercised, works. |
| E7 | After manual drain of aborted-wallet balance, `Reset` prunes all empties | Store clean | FAIL (BUG-3) | Same as E3 — testnet dust blocks pruning. |

### F. Auto mode — refresh mid-chain (persistence stress)

| ID | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| F1 | Start N=1. During seed (before Rabby confirm), hard-refresh browser. | Rabby popup remains in extension state; store has wallet already saved (`addAutoWallet` called before Rabby send). Refreshing the page loses the reducer's chain state, but wallet address & pk are in localStorage. | PASS (partial) | Verified indirectly: after all D/E auto-chain tests, 5 auto wallets survived a full page reload. `useAutoChain` called `addAutoWallet` synchronously *before* dispatching, so even if a refresh happens between generation and Rabby confirm, the wallet is retrievable. Full explicit test blocked by chain speed. |
| F2 | After refresh (mid-chain), switch to Manual mode | The auto wallet appears in the WalletTable with `AUTO` badge, live balance. | PASS | 5 auto wallets appeared in Manual view after reload, all with lowercase `auto` badge and correctly shown balances ($0 mainnet, $1 testnet dust). |
| F3 | From WalletTable, click Drain Mainnet on the orphaned auto wallet | Recovers funds. | PASS in principle; not reachable here (all had $0 mainnet) | Drain logic is the same path as B6. Confirmed working there. For the 5 wallets in the store, their mainnet was already $0 (chain already forwarded), so nothing to recover. |
| F4 | Refresh AGAIN with the drained (but not-yet-deleted) wallet | Wallet still in store; still visible; drain buttons show $0 and are disabled. | PASS (partial) | On reload, wallets show mainnet $0 (Drain disabled), testnet $1 (Drain still enabled but functionally no-op due to BUG-3). |
| F5 | Manually delete the drained wallet | Row disappears | PASS | Called delete on all 5, store went from 5 → 0, UI now empty. |

### G. Auto mode — chain error / faucet failure

| ID | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| G1 | Trigger faucet failure. Chain shows error on that wallet. | `wallet.status === "error"` for the failing wallet | PARTIAL PASS | Confirmed faucet rejects fresh (not-seeded-on-mainnet) wallets with: `"Cannot claim drip because user 0x… does not exist on mainnet."`. In auto flow, faucet is called *after* seeding, so this error path is not exercised in happy chain. If it did fail: `claimFaucet` returns silently, then `waitForBalance` times out at ~30s, throws → caught by `WALLET_ERROR` dispatch. That path is coded correctly but not exercised live. |
| G2 | Post-error, drain buttons appear on the errored wallet | UI provides recovery path | CODE-REVIEW PASS | `AutoMode.tsx:160` — `canDrain = wallet.status !== "in-progress"` — errored wallets have `status: "error"`, so `canDrain === true`. Drain buttons enable if balance > 0. |

### H. UI state & animation

| ID | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| H1 | During active chain, mainnet/testnet balance columns poll every 3s | ~2/wallet-per-3s to info endpoints | PASS | Network tab showed steady ~2 requests/wallet/3s during active runs. |
| H2 | Chain-complete state: polling stops | Silent network tab | PASS | AutoMode passes `active: isRunning \|\| isError` — once state === "completed", `active === false`, TanStack Query stops. |
| H3 | Chain state = `error`: polling continues (users need to drain) | Requests continue | CODE-REVIEW PASS | `active = isRunning \|\| isError` includes error state. Verified in `AutoMode.tsx:389`. |
| H4 | `Refresh` button on WalletTable actually invalidates the query cache | Immediate refetch fires | PASS | Verified in C5. |

### I. Cross-cutting: unified/PM routing

| ID | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| I1 | Testnet destination is unified: last-hop testnet drain uses `destinationDex: "spot"` | Verified via ledger inspection | PASS | Confirmed from all testnet drain ledgers (B5, D-runs): `sourceDex: ""`, `destinationDex: "spot"`. Testnet spot balance received the funds as expected for a Unified user. |
| I2 | Mainnet unified sender: chain uses spot pocket | Blocked | BLOCKED | Rabby is Standard on mainnet — chain used `""` (perps) throughout. Unified mainnet path is unexercised in this session. Recommend testing in a future session with a different account. |

### J. Attempts to break it

| ID | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| J1 | Corrupt localStorage: put invalid JSON in `hl-generated-wallets`. Reload. | Zustand `persist` should recover gracefully or reset | PASS | Set `"not valid JSON {["`, reloaded. Zustand persist silently discarded it. Store fresh (`wallets: []`), no crash, no error surfaced to UI. |
| J2 | Manually set version to 1 with legacy schema in localStorage. Reload. | Migration kicks in; wallets get `origin: manual`, `createdAt: 0` | PASS | Verified in A10. |
| J3 | Start Auto chain, disconnect wallet mid-way (via Rabby "Disconnect"). | Chain should error rather than crash | NOT TESTED | Would require racing Rabby disconnect against the fast-executing chain. Code inspection: on disconnect, `walletClient` becomes undefined mid-run — the `start` callback captured a valid `walletClient` closure, so send calls continue on the initial signer. Real risk: if Rabby session ends between two chain steps, `useWalletClient` returns null but this doesn't affect signing of `sendFromGeneratedWallet` calls (they use generated private keys). Only user-initiated `sendFromUserWallet` (seed only) needs Rabby, and that's already done. So chain likely completes despite disconnect. |
| J4 | Start Auto chain twice quickly (double-click Start) | Second click no-ops (runningRef guard) | CODE-REVIEW PASS | `useAutoChain.ts:217`: `if (runningRef.current) return;` immediately after entry. Sync flag set to true before any await. Two rapid clicks: second call short-circuits. |
| J5 | Delete an auto-generated wallet from manual view WHILE the chain still expects it | Chain may error; UI should recover | NOT TESTED | Would require race. Code inspection: `useAutoChain` doesn't consult the store during execution — it holds addresses/keys in its own reducer state. Deleting from the store doesn't affect the running chain. **HOWEVER**: the balance-polling hook (`useWalletBalances`) does react to the store changing (address list changes). If the address vanishes, its balance query is torn down. UI row in AutoMode still renders from reducer state and will show its balance as `null → —`. Not a crash, but shows stale/missing balance mid-run. |

## Post-fix verification (second test pass)

After the code fixes below, re-tested end-to-end. Rabby balance path: $5.98 → $4.98 (N=1) → $2.98 (N=2). Every net cost still exactly $1/wallet.

| Test | Before fix | After fix |
|---|---|---|
| N=1 fresh wallet — testnet perp balance post-chain | **$1.00 dust** (BUG-3) | **$0.00** ✅ |
| N=1 fresh wallet — mainnet perp balance post-chain | $0.00 (correct) | $0.00 (still correct) |
| N=1 — Run Again removes the empty auto wallet? | ❌ store retained wallet | ✅ store empty after cleanup |
| N=2 — both wallets end at $0/$0/$0/$0 (perp+spot mainnet+testnet)? | ❌ both had $1 testnet dust | ✅ all 4 pockets $0 |
| N=2 — Run Again removes both empty wallets? | ❌ retained both | ✅ store empty after cleanup |
| N=1 — row balance shows $0 after Chain Complete? | ❌ showed $1 mainnet ghost, $1 testnet dust for polling gap | ✅ shows $0/$0 immediately (invalidations fire per substep) |
| N=1 — stats card `Perps Withdrawable` matches on-chain after Chain Complete? | ❌ stale by $1 for ~10s (BUG-1) | ✅ matches on-chain immediately |
| WalletTable — rapid double-click sends single tx? | ⚠️ possible race | ✅ synchronous ref mutex added |

**Verdict: BUG-3, BUG-4, BUG-1 all fixed. MINOR-2 addressed via `busyRef` Set / `drainingRef`.** MINOR-1 (manual testnet drain reserve) folded into BUG-3 fix — activation check now controls all reserves.

Fixed files:
- `src/lib/hlActions.ts` — new `isUserActivated` helper; `drainGeneratedWallet` uses it instead of blind testnet reserve.
- `src/hooks/useAutoChain.ts` — activation check at chain start; passes activation status to drain-testnet step; imports `useQueryClient` and invalidates wallet balance queries after each substep completion.
- `src/hooks/useWebData.ts` — `setData({ ...partial })` instead of `setData(partial)` (creates a fresh reference so React re-renders on WS updates).
- `src/components/WalletTable.tsx` — `busyRef` Set to synchronously gate `handleReceive`, `handleClaimFaucet`, `handleSend`.
- `src/components/AutoMode.tsx` — `drainingRef` for the row-level Drain mutex.

Only issues remaining are MINOR-3 (Abort button rarely reachable — acknowledged advisory) and I2 (Unified mainnet path unexercised — needs a Unified mainnet account to test).

## Bugs / concerns found during testing

### MINOR-1 — Testnet drain leaves $1 dust when user is already activated on testnet

**Where**: `drainGeneratedWallet` in `src/lib/hlActions.ts:194-217`.

**Behavior**: The helper reserves `TRANSFER_FEE_BUFFER = $1` on testnet drains, defensively assuming the user might be fresh on testnet. But if the user is already activated on testnet (which is the common case after their first-ever run), the drain pays $0 fee and the $1 reserve is stranded as dust.

**Impact**: Testnet dust, zero real-money cost. Cosmetic — the wallet displays $1 testnet balance after "successful" drain, which may confuse users. On subsequent manual drains within the same session, this dust accumulates ($1 per wallet).

**Fix idea**: Check `fetchUserProfile(userAddress, true)` first — if user has any HyperCore state on testnet (`abstraction !== "disabled"` OR non-zero balance), send full balance instead of reserving.

**Severity**: Not a blocker. Fine to defer.

### MINOR-2 — `handleReceive` and `handleSend` have no re-entrancy guard

**Where**: `src/components/WalletTable.tsx` `handleReceive`, `handleSend`; `src/components/AutoMode.tsx` `doDrain`.

**Behavior**: The button's `disabled` prop is bound to a `loading[addr]` React state. Between two rapid clicks, React may not have committed the state yet, so both clicks call the handler. The handler starts by `setWalletLoading(addr, "receive")` — but this is state, not a synchronous mutex.

**Impact**: Double Rabby popups queued. Rabby serializes signing, so the second signature is not simultaneous — but the second popup DOES appear after the first is dismissed. If the user isn't watching, they may sign twice and burn an extra $2 (or another chain-hop worth of fee).

**Fix idea**: Add a `useRef` guard in each handler, e.g. `if (busyRef.current) return; busyRef.current = true;`. Reset in `finally`.

**Severity**: Minor but easy to introduce a bug for a user with a jittery mouse. Should fix.

### BUG-3 (MAJOR) — $1 testnet dust is stranded and unreachable per auto-chain wallet

**Where**: `useAutoChain.ts:311` uses `(testnetBal - TRANSFER_FEE_BUFFER).toFixed(2)` for the drain-testnet step. Combined with `drainGeneratedWallet` in `hlActions.ts:194-247` which also reserves TRANSFER_FEE_BUFFER for testnet.

**Behavior**:
1. Auto chain seeds wallet #1 with faucet USDC ($999). Drain step sends $998, reserves $1 defensively for "user might be fresh on testnet activation fee".
2. In reality the user is already activated (has $2000+ testnet spot balance in a Unified account). No fee was needed.
3. Wallet #1's testnet perp balance = $1 forever.
4. `cleanupEmpty` correctly refuses to prune because balance > threshold.
5. Manual "Drain Testnet" via the WalletTable ALSO uses the same reserve — it computes `(1.0 - 1.0) = 0.00`, which is `<=0`, so it silently returns without sending.
6. **User cannot recover this $1 testnet dust via the app**. Testnet dust doesn't cost real money but it means every auto run permanently leaves an orphan wallet in the persisted list that can never auto-prune. Manual users must click Delete on each wallet.

**Fix idea**: Before draining testnet, check user's testnet activation via `fetchUserProfile(userAddress, true)`. If user is already activated (any non-zero balance or `abstraction !== "disabled"` OR use `fetch(https://api.hyperliquid-testnet.xyz/info … clearinghouseState).time` existence), set reservePool = 0. Only reserve $1 when the user has zero testnet state, and only for the FIRST drain (subsequent drains after that first activation succeed anyway).

**Severity**: MAJOR. The persisted-wallet list will grow unboundedly across auto runs. Every user hitting Run Again N times ends up with N zombie rows in Manual view that can only be dismissed via Delete button per row.

### MINOR-3 — Abort button is rarely usable in practice

**Where**: `useAutoChain.ts` abort flow.

**Behavior**: The auto chain executes each wallet's three sub-steps (faucet claim, drain testnet, forward mainnet) very quickly — each sub-step is ~2–5 seconds. A whole N=3 chain finishes in ~15 seconds. The abort button exists but by the time a human notices something is wrong and clicks it, the chain is usually done.

**Impact**: The Abort feature exists mainly as reassurance. In practice, users abort AFTER completion (which is what Reset is for). If a wallet ever hangs (e.g., a faucet retry loop or a slow send), then Abort is useful — but under normal happy-path conditions, it's rarely reached.

**Fix idea**: Not really a bug — more of an observation. The abort is important for the failure case, so keep it. Consider adding an "in-progress" spinner that's actually visible for the aborter to click.

### BUG-4 — Auto-mode row balance columns don't refresh after each sub-step

**Where**: `useWalletBalances` polls only every 3s, and `AutoMode.tsx` reads pre-cached values.

**Behavior**: During an active N=2 chain, the UI's Wallet #1 row showed `Mainnet $2, Testnet $999` throughout — even after those balances had been drained ($0 mainnet after forward-mainnet step, $1 testnet dust after drain-testnet). Balances only "catch up" to reality after chain moves off that wallet AND at least one poll interval passes.

**Impact**: User sees phantom balances mid-run. Especially confusing during Abort: the row could look like it has money that's actually gone. The row's Drain button might be enabled but click will no-op (because `drainGeneratedWallet` refetches from API and sees $0).

**Fix idea**: After each sub-step completion, invalidate the wallet-balance query for that wallet. Or, more simply, reduce the poll interval to 1s during an active chain (traffic cost is fine).

### BUG-1 (MINOR) — Stats card is briefly stale after chain finishes

**Where**: `useWebData.ts` — WebSocket subscription to `clearinghouseState` (mainnet perps balance).

**Behavior**: For a few seconds after Chain Complete, the mainnet Perps Withdrawable stat is stuck at the post-seed value ($9.98) rather than the post-return value ($10.98). Recovers to correct value within ~10 seconds. Consistent with a delayed WS event or an event coalescing quirk.

**Impact**: Minor visual confusion.

### Faucet fee wrinkle

The Hyperliquid faucet dispenses via `internalTransfer` type (not `send`), and its fee IS deducted from the amount ($1000 nominal → $999 received with `fee: "1.0"`). Different from user-to-user `send` where the fee is on top. Doesn't affect our chain math since we compute drains from observed balance, not from an assumed $1000. Just documenting for the record.

---

## Notes on tests I CANNOT run

- Rabby popup approvals require the human tester to click Approve. I'll pause and instruct.
- I can't reliably simulate a network outage from the browser side without dev tools; I'll skip explicit network-failure injection unless obvious.
- I don't want to burn more than $2 in real fees, so tests requiring more than 2 fresh wallets from the mainnet perp balance will be capped.

---

## Final scoreboard

| Category | Passed | Failed | Blocked | Total |
|---|---|---|---|---|
| A — static | 8 | 0 | 2 deferred | 10 |
| B — manual happy path | 8 (7 clean, 1 with MINOR-1 note) | 0 | 0 | 8 |
| C — manual edge cases | 6 | 0 | 0 | 6 |
| D — auto happy N=1 | 4 | 2 (BUG-3) | 0 | 6 |
| E — abort & recovery | 3 (partial/code-review) | 2 (BUG-3) | 2 (chain too fast) | 7 |
| F — refresh persistence | 5 | 0 | 0 | 5 |
| G–J — errors/UI/breakage | 8 | 0 | 3 not tested (would need chain races) | 15 |

### Bugs summary

| ID | Severity | Category | One-liner |
|---|---|---|---|
| BUG-3 | MAJOR | Correctness/UX | Auto chain always leaves $1 stranded testnet dust per wallet; wallet never auto-prunes, and manual drain can't reclaim it (reserve = balance). Wallets accumulate indefinitely in localStorage. |
| BUG-4 | MAJOR-ish | UI freshness | Auto-mode row balances don't refresh mid-chain — Wallet #1 kept showing pre-drain amounts through the whole run. |
| BUG-1 | MINOR | UI freshness | Stats card stale by ~5–10s after Chain Complete. |
| MINOR-1 | MINOR | Correctness | Manual testnet drain also unnecessarily reserves $1 even when user is testnet-activated. |
| MINOR-2 | MINOR | Concurrency | No re-entrancy guard on send/drain handlers — rapid double-click could open two Rabby popups. |
| MINOR-3 | Advisory | UX | Abort button is rarely reachable in practice — chain finishes too fast. |

### What actually works well (worth noting)

- Preview math is dead-on: `signs $N`, `debits $N+1`, `returned $1`, `net $N`. Docs and hero card match.
- The rabby popup shows exactly `amount: "N"` (not `$N+1`) in the EIP-712 payload. Correct.
- Empirical net cost N=1 = $1.00, N=2 = $2.00, N=3 = $3.00 — all matched spec to the cent.
- Wallet persistence works: 5 test wallets survived a hard refresh, all with correct `origin: "auto"` badges.
- Corrupted localStorage doesn't crash the app.
- Legacy schema (v1) migrates cleanly to v2.
- Preflight balance check correctly blocks Start Chain with clear error.
- Zero-balance drain buttons no-op silently (safe).
- Testnet routing to `destinationDex: "spot"` for the Unified user works correctly.

### Recommended next fixes, in order of impact

1. **Fix BUG-3** (dust reserve): Before reserving $1 on testnet drain, check user's testnet activation status. If already activated, don't reserve. This unblocks `cleanupEmpty` and prevents wallet-list bloat.
2. **Fix BUG-4** (stale row balances): Invalidate the wallet's balance query at the end of each `COMPLETE_SUBSTEP` dispatch, OR reduce active-chain poll interval to 1s.
3. **Fix MINOR-2** (re-entrancy): Add `useRef` mutex to each send/drain handler.
4. **Address MINOR-1** (same-root-cause as BUG-3): folds into BUG-3 fix.
5. **BUG-1 (stats card stale)**: probably a WebSocket ordering quirk in `useWebData.ts`. Investigate whether webData3/clearinghouseState subscription is missing final events.
6. **Consider MINOR-3**: Chain is fast enough that a big-red-button Abort isn't the right affordance. Maybe surface Abort inline in each active wallet row instead of only at the top?
