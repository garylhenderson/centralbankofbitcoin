# Round 29 Off-Chain Audit — Independent Verification

**Audited tree:** HEAD at `de3d56f` (post-Round-28 repairs). All files read whole. No live alarm, crank, revenue, notification, or mainnet money operation was run. All measurements below are source-level reads and selftest-floor verification against the bundled code.

---

## R0 — Round 28 Verdict Verification

Round 28 was **NOT CLEAN**: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 4 LOW, 2 INFO. I independently verified every repair against the bundled source.

| R28 ID | Claim | Repair present? | Evidence in bundled code |
|---|---|---|---|
| M1 | Runtime `Log truncated` accepted as complete coverage | **YES** | `bank/txread.mjs` line: `need(!meta.logMessages.includes('Log truncated'), 'logs truncated by runtime')`. Selftest arms: `R28 M1: user log text cannot impersonate the runtime marker` and `R28 M1: runtime truncation holds actual consumer cursors…` (both in the bundled `bank/selftest.mjs`). The marker check is an exact string match against the standalone runtime marker, not a substring that would catch a program's own `Program log: Log truncated` text. |
| L1 | Alarm chain deadlines judged against `Date.now()` | **YES** | `bank/alarm.mjs` reads `SYSVAR_CLOCK_PUBKEY` into `nowSec` and throws if null. `lockGate` uses `nowSec` (chain). `wallSec` is retained only for local observation durations (heartbeat age, royalty observation, crank posture). Selftest arms: `R28 clock: actual alarm retains separate clocks under ±7h skew` and `R28 clock: actual lock wiring obeys chain deadline under ±7h skew`. |
| L2 | Heartbeat truncated to first 50 problems | **YES** | `bank/crank.mjs` heartbeat write: `problems: plan.problems` — no slice. Selftest arms: `R28 heartbeat: actual writer retains 150 rotating planner problems` and `R28 heartbeat: every persistent problem reaches its third-pass alarm` (both assert 150). |
| L3 | Rehearsal isolation omits `launch/` | **YES** | `scripts/rehearsal-tree.sh` python block: `git ls-files -- programs bank scripts tests sim launch Anchor.toml` — `launch` is in scope. Selftest arms: `R28 rehearsal: actual forward/reverse proof isolates copied launch paths` (true) and the counterfactual `deleting launch from the substitution scope defeats that isolation check` (false). |
| L4 | Redemption evidence forgotten before DAS catches up | **YES** | `bank/detectors.mjs` `rememberRedemptions` merges `previous` with current findings. `bank/alarm.mjs` persists `next.seenRedemptions` and passes it to `correlateBurns`. Selftest arms: `R28 burn: earlier confirmed instruction evidence correlates later DAS burn only for that asset` and `R28 burn: an untrusted event or missing signature is not persisted evidence`. |
| D1 | SPEC opening stale "not yet a multi-model round" | **Addressed per VALIDATION.md**; the bundled SPEC opening no longer contains that phrase. |
| D2 | HOLDER-GUIDE promises level "a few seconds" | **Addressed**; bundled HOLDER-GUIDE reads: "the draw job checks every minute, and busy queues can take longer." |

**Verdict on R0:** All seven Round 28 findings are repaired in the bundled tree. No repair is partial or regressed. The selftest floor moved from 860 (Round 27) to 888 to accommodate the new arms, and the floor is an equality check, not a lower bound.

---

## R1 — The Crank (`bank/crank.mjs`)

**No new defect found.** Verified:

- **Reveal order:** `planCrank` iterates from `revealed_total` upward, stopping at the first not-ready vault. Strict FIFO. A capture planned this pass counts as ready (`capturedThisPass`). Burned vaults are included (the program handles them by skipping the Core write). The `revealAttrSource` function returns `'empty'` only for positively burned assets, `'skip'` for unreadable ones. The `judgeRevealAttrs` hash check runs before any fee is spent.
- **Join-before-distribute:** `preJoins` are sent before `distribute`; `postExpires` after. The program's `JoinWaitingFirst` and `BoostsExpireFirst` gates are respected by the plan.
- **Fee budgeting:** `budgetPlan` degrades gracefully: if the key can't cover all reveals, it sends captures and as many reveals (in mint order) as the balance allows, and pages the dropped count. The `planCostLamports` function correctly counts claim batches (not individual claims), expire batches, and per-reveal attribute rent.
- **Race handling:** `BENIGN` regex covers all expected race codes. `judgeDistributeRefusal` re-reads the config and treats `NothingToDistribute`/`BoostsExpireFirst`/`JoinWaitingFirst` as benign only if `dist_epoch` or `last_distribute_at` moved. `PoolShort` is never benign. `mintFailureCode` retrieves missing SDK logs via `getLogs` with a 5-second timeout and fails closed.
- **Value movement:** The crank sends only permissionless MINT instructions (`activate`, `capture_entropy`, `claim`, `distribute`, `expire_boosts`, `reschedule_reveal`, `retire_burned`, `reveal_level`, `split_revenue`). No SPL transfer, no system transfer, no program other than MINT. The selftest asserts this by scanning the source.

---

## R2 — The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No new defect found.** Verified:

- **Chain clock separation (L1 repair):** `nowSec` (chain) is used for all on-chain deadline comparisons (distribution overdue, redemption rate, lock deadline, unsplit revenue). `wallSec` is used for local observation durations (heartbeat age, royalty observation, crank posture). The `revenue_age_unknown` migration path handles legacy mixed-clock timers.
- **Production value checks:** The `detectStandingRisks` production list matches DESIGN-v6 and `launch/mainnet-init.json` exactly: 21% quorum, 51% threshold, 3-day voting, 7-day notice, 30-day month, 1-hour redemption window, 1 SOL / 24h / 0.1 SOL tighten bounds, 2100 supply, 945/525/315/210/105 census, cbBTC payment mint, CBOBTC Squads treasury, three reserve mints, PoB root, PoB collection, $CBOB mint, 12/24 boost ceilings.
- **Config drift:** The WATCH list covers all fixed-forever fields, vote-reachable fields, guardian stops, program upgrade authorities and hashes (all five programs + Core + four third-party programs), collection plugin hashes, and PoB collection plugins/update authority. The `carryConfigBaseline` function preserves the last non-null value across transient read failures.
- **Freeze transitions:** `applyFrozenTransitions` pages a freeze once (urgent) and lists it at INFO while it stands. The `coveredFreezes` parameter in `detectCrankHealth` prevents double-paging for conditions already covered by freeze detectors.
- **Notification delivery:** `planAlarmNotices` groups by kind, sends one notice per kind, marks one-shots urgent, and sends recoveries for level kinds that cleared. The `defangForRouter` function prevents level-finding text from being misclassified as recovery by the alert router.
- **Redemption evidence retention (L4 repair):** `rememberRedemptions` merges previous and current evidence. `correlateBurns` uses the merged evidence. State persists `seenRedemptions` across passes.

---

## R3 — The Layouts (`bank/layout.mjs`)

**No new defect found.** Verified:

- **Struct parity:** The selftest parses `pub struct` definitions from all four program sources and compares field-for-field against `STRUCTS`. The parser rejects private fields, `pub(crate)` fields, and multi-line fields (throws instead of silently dropping).
- **Cross-program offsets:** The selftest scrapes every `OFF_*` constant from GOV, BURN, and MINT source and compares against `offsets()`. The L2 arm asserts no scraped constant goes un-compared.
- **PDA seeds (Round 24 D6 repair):** The selftest scrapes seed constants from each program and compares against `SEEDS`. All 11 seeds are checked. A mistyped seed or unmapped seed is caught.
- **Layout versions:** The selftest scrapes `*_VERSION` constants from all programs and compares against `STRUCTS[*].version`. A bumped version in any copy is caught.
- **Account spaces:** The selftest evaluates `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` expressions from the Rust source (substituting named constants) and compares against `fixedLength()`. Padding is subtracted. A one-byte change is caught.
- **Collection plugin hash:** `collectionPluginsHash` skips the base fields (key, update_authority, name, uri, num_minted, current_size) and hashes only the plugin region. The selftest verifies that changing `num_minted` does not change the hash, but changing a plugin byte does.

---

## R4 — The Money Arithmetic (`bank/accrual.mjs`)

**No new defect found.** Verified against MINT's `credit`, `owed_of`, `reweigh`, `ceil_sats`, `join`:

- `credit`: `delta = avail * ACC_SCALE / w`; `owed += delta * w`. Matches MINT.
- `pendingScaled`: `(weight + boost) * acc + carry - debt`. Matches MINT's `owed_of`.
- `reweigh`: moves owed to carry, restarts debt at new weight. Matches MINT.
- `ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. Matches MINT's `ceil_sats`.
- `available`: `poolBalance - ceilSats(owedScaled)`, floored at 0. Matches MINT.
- The crank's pre-expiry owed calculation correctly computes the boosted share at the pre-distribution accumulator, then adds the level-weight share from the distribution delta. This matches the program's `expire_boost` → `reweigh` → `claim` sequence.
- The 39-assertion allocation selftest covers weights, dust, timing, pool, frozen/retired vaults, and the $CBOB boost carry. The floor is an equality check.

---

## R5 — The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`)

**No new defect found.** Verified:

- **Oracle math:** `oracleFloor` computes `sats = lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)` using BigInt. The exponent handling is correct for both signs. The `satsPerLamport` float uses the same formula. The 150 bps tolerance is applied as `expectedSats * 9850 / 10000`, rounded down.
- **Pyth verification:** `readPyth` checks owner (Pyth receiver), verification level (Full only), feed ID, and account length. The `PriceUpdateV2` offsets are correct: disc(8) + write_authority(32) + verification_level(1) + feed_id(32) + price(8) + conf(8) + expo(4) + publishTime(8).
- **Pool spot prices:** `orcaSpot` = `(sqrtPrice / 2^64)^2` (raw units, sats per lamport for wSOL/cbBTC). `meteoraSpot` = `1 / (1 + binStep/10000)^activeId` (inverse of lamports per sat, giving sats per lamport for cbBTC/wSOL). Both are correct for their respective token orderings.
- **Deviation filter:** `deviationBps = |pool - oracle| / oracle * 10000`. The 100 bps threshold is applied in `market()`. A pool outside the threshold is excluded from `venues`.
- **Minimum out:** The same `minSats` from `oracleFloor` is used for both the deviation filter and the on-chain floor. Orca's `other_amount_threshold` and Meteora's `min_amount_out` both carry this value. The units are correct (sats for both).
- **Judge:** `judgeSwapInstructions` requires exactly 7 instructions in the exact sequence. It checks: compute-unit limit (400k, no priority fee), both ATA creations (owner's own accounts), System transfer of exactly `lamportsIn`, SyncNative, venue swap with correct amount/floor/direction/pool/input/output/signer, and CloseAccount of wSOL back to owner. The selftest arms all eight Round 25 tampers on both venues and verifies the old judge passed them (proving the arms can fail).
- **Account derivation:** Orca tick arrays use `["tick_array", pool, start]` with starts computed from `tickCurrent` and `tickSpacing`. Meteora bin arrays use `["bin_array", pool, index]` with indexes computed from `activeId`. The bitmap extension is passed as the program ID when absent (Anchor's "None" convention).
- **wSOL handling:** Wrap exactly `lamportsIn`, SyncNative, swap, CloseAccount. The close returns any un-swapped wSOL to the operator.
- **Failure and retry:** `classifySendFailure` distinguishes refused (nothing moved), landed (record it), and unknown (keep cycle open). Meteora is tried only if Orca was refused, never on an unconfirmed send. The open-cycle guard prevents double-swapping.
- **Revenue cycle:** The `sweepCooldownOver` function uses the chain clock. The return step transfers the full operator ATA balance but records only the delta. The split step handles `NothingToSplit` (front-run) by checking if the revenue ATA is provably empty. The `closesCycle` function anchors on the return's block time.

---

## R6 — The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

**No new defect found.** Verified:

- **Floor equality:** All floors use equality checks (`-eq`), not lower bounds. `MIN_ASSERTIONS=855`, `DET_FLOOR=888`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=22`, `POB_FLOOR=14`, `LAUNCH_FLOOR=47`, `HOST_FLOOR=6`, `MAINNET_FLOOR=33`, `EXPIRY_FLOOR=4`, `SWAP_FLOOR=16`. The `floor()` function in `run-tests.sh` enforces equality.
- **Both-direction arms:** Every detector in `bank/selftest.mjs` has a fires-when-it-should and a quiet-when-it-should arm. The selftest floor is 888, matching the bundled count.
- **No vacuous checks:** The `audit-coverage.sh` script checks both legacy `f('path')` and new `['path', ...]` patterns. The `judgeCronTemplate` function checks for `flock -n` (not just `flock`). The `wiringGate` in the selftest strips comments and checks that detector results are actually consumed.
- **Swap fork:** `sim/swap-fork.sh` clones real pool state from mainnet, runs real swaps through both venues, and checks the oracle floor. The `SWAP_FLOOR=16` is an equality check.
- **Expiry budget:** `tests/expiry-budget.mjs` executes 20 synthetic due-boost records at the default 200k CU budget. The test is correctly scoped (synthetic genesis, not full lifecycles). The `EXPIRY_FLOOR=4` matches.
- **Build-mainnet:** `scripts/build-mainnet.sh` builds both mainnet and localnet, deploys to a validator, and checks that mainnet rejects the test key while localnet accepts it. The sweep helper's bytes are checked for identity across mainnet, localnet, and `target/deploy`.

---

## Accepted Limits — Four Questions

### 1. Is any limit WORSE than stated?

**No.** I verified the following against the code:

- **Limit 10 (swap operator):** The on-chain cap (`max_sweep_lamports`), cooldown (`sweep_cooldown_secs`), and reserve (`sol_reserve_lamports`) are enforced in `sweep_sol_for_swap`. The guardian's `emergency_stop_sweep` is immediate and one-way. The `cancel_swap_operator` clears only a pending operator. The alarm's `detectUnsweptRoyalties` grace follows the on-chain cooldown. The stated bound (cap × windows until guardian stops) matches the code.
- **Limit 28 (cbBTC freeze):** The program's `claim` defers frozen vault accounts. `retire_redeemed` forfeits the undelivered share when the pool is frozen. `monthly_inline` never credits from a frozen pool. The alarm pages `pool_frozen`, `vault_account_frozen`, and `revenue_account_frozen`. All match the stated limit.
- **Limit 32 (redemption rate):** The ring of 64 redemption times is correctly implemented. The cap is `max(1, ceil(live × 210 / 10000))`, bounded by 64. The alarm's `redemptionCapacity` matches BURN's arithmetic.
- **Limit 40 (Core upgradeability):** The three consequences (tombstone format, UpdatePluginV1, ExecuteV1 authority) are stated. The Round 28 Core heap boundary is now documented in SPEC item 40 and the holder guide.
- **Limit 46 (PoB collection hot key):** The two attack paths (block all claims, capture governance) are stated. The alarm watches the collection account but not individual assets (stated blind spot). The positive bound (the key cannot transfer or burn individual PoBs) is stated.

### 2. Is anything listed as a limit not actually a limit?

**No.** All listed limits correspond to real code paths or structural impossibilities. The discharged items (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24, 30, 31, 33, 51, 54, 12/17, 14, 19) are properly discharged: the Bank, co-signer, deck, and distributor no longer exist; the on-chain fixes are measured.

### 3. Is any DISCHARGED item not actually discharged?

**No.** Each discharged item has a named reason and measurement:
- Items 1a–5, 11, 15, 16, 18, 20, 21, 23, 24: Gone with the Bank/co-signer/deck/distributor. The files are deleted (selftest asserts this).
- Item 51 ($CBOB boost): Built and measured (suite section BO, init arms 0.1o–0.1v).
- Item 54 (compute): Measured (suite arms 10.5, 10.6, 10.6a).
- Items 12/17 (compute units): Measured on the v5 artifact.
- Item 14 (duplicate attributes): Closed on chain (`DuplicateAttribute`).
- Item 19 (unlevelled-vault halt): Closed by construction (`activate` refuses `NotRevealed`).
- Items 30, 31, 33: Superseded by stage 3b/3c.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** All five OPEN AND BLOCKING items are properly listed and none is treated as accepted:
- **Item 22** (live distribution): The dress rehearsal hasn't happened. The item correctly lists the named pass/fail items.
- **Item 38** (initialize values): `charter_opens_at` and `lock_deadline` are still OPEN in `launch/mainnet-init.json`. The checker refuses to pass while any value is OPEN.
- **Item 50** (holder surfaces): The redeem page, deposit-address page, and redemption poster sender are not built. The sweep helper is built but nothing calls it yet.
- **Item 52** (pool/Squads/revenue ATAs): Road step 10 creates these. Not yet done.
- **Item 53** (dress rehearsal at throwaway IDs): The rehearsal tree script exists but the rehearsal hasn't been run at the release commit.

---

## Findings

**No new CRITICAL or HIGH findings.**

After independent verification of all Round 28 repairs and a full re-read of every bundled file, I found no surviving defect at CRITICAL or HIGH severity. The repairs are complete, the selftest arms are real and bidirectional, and the floors are equality-checked.

### LOW-1: `readParsedTransaction` depends on web3.js private `_rpcRequest`

**File:** `bank/txread.mjs`, `readParsedTransaction` function.

**Construct:** `conn._rpcRequest('getTransaction', ...)` accesses a private method of the `Connection` class. The installed SDK's public `getParsedTransaction` rejects v1 transactions (its `version` schema accepts only `legacy` and `0`), which is why the reader bypasses it. But `_rpcRequest` is an internal API with no stability guarantee.

**What an accident gains:** A web3.js upgrade that renames or removes `_rpcRequest` would break every transaction reader (alarm, revenue, poster) simultaneously. The selftest catches this (it exercises the actual installed SDK), so it would be a loud build failure, not a silent gap. But the failure would block all monitoring until the reader is adapted.

**Evidence if true:** `node -e "const {Connection} = require('@solana/web3.js'); console.log(typeof new Connection('http://localhost')._rpcRequest)"` prints `function` today. A future SDK upgrade that prints `undefined` would confirm the break.

**Fix:** Pin the web3.js version in `package.json` (already done implicitly by the shared `node_modules`). Alternatively, wrap the `_rpcRequest` call in a try/catch that falls back to a manual JSON-RPC fetch via the connection's `rpcEndpoint`. This is a maintenance hardening, not a current defect.

**Severity:** LOW. The selftest catches any break, and the SDK version is pinned by the shared `node_modules`. The risk is a future upgrade requiring reader adaptation, not a current gap.

### INFO-1: `expiry-budget.mjs` scope is correctly stated but narrow

**File:** `tests/expiry-budget.mjs`.

The test creates 20 synthetic genesis records and executes `expire_boosts` at the default CU budget. It does not exercise full mint/activation/boost lifecycles. This is correctly stated in the file header and in VALIDATION.md. The test is valid for what it claims (isolated expiry cost), but it does not certify the interaction between expiry and other instructions in a real claim batch. The suite's BO section covers that interaction separately.

**Severity:** INFO. The scope is correctly stated. No action needed.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The following are things AI audit structurally cannot do, and that must be done before launch:

1. **Run the mainnet dress rehearsal (item 22) with real SOL and real cbBTC.** The crank, alarm, and revenue cycle have never run against a live cluster with ~2,100 vaults. The rehearsal must include: one full live revenue cycle through BOTH pools (Orca forced to refuse once), one forced post-sweep failure walked through hand recovery, and the alarm in rehearsal mode. AI can verify the code is correct; it cannot verify that the RPC endpoint, DAS indexer, and network conditions allow the pipeline to function at scale.

2. **Execute the `initialize` ceremony and verify the on-chain values match `launch/mainnet-init.json`.** The checker validates the JSON, but whoever builds the four `initialize` transactions must build them FROM that file. AI can verify the checker is correct; it cannot verify that the human running the ceremony uses the right file and reads the output correctly.

3. **Remove the upgrade authority from all five programs and verify immutability on-chain.** This is a one-way operation. AI can verify the build-mainnet script is correct; it cannot verify that the human removes the authority from the right programs and doesn't accidentally remove it from the wrong one.

4. **Fund the operator wallet, the revenue address, and the three cbBTC accounts (item 52).** These are operational prerequisites that no code check can substitute for. AI can verify the code handles missing accounts correctly (it does: loud refusals); it cannot verify the accounts are funded.

5. **Build the holder-facing surfaces (item 50).** The redeem page, deposit-address page, and redemption poster sender are not built. Until they exist, items 9 and 44 have no preventive control. AI can verify the pure functions are correct; it cannot build the pages.

6. **Establish an out-of-band witness for the alarm.** The alarm, the revenue ledger, and the crontab all belong to one user on one box. Whoever can write the ledger can also stop the alarm. AI can verify the detection logic is correct; it cannot provide an independent witness. A second box running a read-only alarm against a different RPC endpoint would close this gap.

7. **Verify the PoB collection's update authority custody through the charter window.** The Giraffish Moments collection's update authority is a hot wallet (accepted limit 46). Through the 7-day charter window, whoever holds it can block all claims or capture governance. AI can verify the alarm detects changes; it cannot verify the key is secure. Moving it to cold storage or a multisig through the window would close this gap.

8. **Run the Test Vault simulation and the swap fork at the release commit.** The VALIDATION.md records these as passing, but they must be re-run at the exact commit that ships. AI can verify the test code is correct; it cannot verify the tests pass at a commit it hasn't seen.