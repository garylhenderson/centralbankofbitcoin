# Independent audit — CBOB v6 off‑chain pipeline (MINT + sweep helper as context)

**Scope read whole:** `bank/crank.mjs`, `bank/detectors.mjs`, `bank/alarm.mjs`, `bank/layout.mjs`, `bank/accrual.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `bank/selftest.mjs`, `bank/spl.mjs`, `bank/anchor.mjs`, `bank/lock.mjs`, `bank/sigwalk.mjs`, `bank/txread.mjs`, `bank/redemption-poster.mjs`, `sim/swap-fork.{mjs,sh}`, `scripts/{run-tests,cron-install,build-mainnet,audit-coverage,rehearsal-tree,token-programs,probe-mainnet-facts,check-launch-params}.*`, `tests/expiry-budget.mjs`, `tests/fixtures/mainnet-v1.json`, `launch/*`, `programs/cbob-vault-mint/src/lib.rs`, `programs/cbob-vault-sweep/src/lib.rs`, SPEC, DESIGN‑v6, HOLDER‑GUIDE, RT3, round‑33 VERDICT + VALIDATION.

**Measurement limits of this pass, stated up front.** I executed nothing. `tests/3prog.test.ts`, `sim/test-vault.ts`, `sim/fixtures.mjs`, `scripts/pob-merkle.mjs`, `scripts/pob-set.json` and `tests/initauth.test.ts` were **not bundled**, so every claim VALIDATION makes about on‑chain arms (including R33.G1–G4) is unverified by me. Where a finding depends on a suite arm existing, I say so. All layout/offset/arithmetic claims below are derived by hand from the bundled source and are checkable without a validator.

---

## R0. Round 33's verdict, independently validated

I re‑derived the four confirmed round‑33 findings against this tree and they are **genuinely repaired at the sites I can read**:

| R33 item | Verified at |
|---|---|
| **L1** symmetric sweep window | `detectSweepState` (`detectors.mjs`) now uses `Math.abs(t - st) <= Math.floor(cooldownSecs/2)`. Both‑ways boundaries armed in the selftest (`at(T-10800)`→0, `at(T-10801)`→1, and the 3600 s cooldown pair at ±1800). The skew cases (+300 s, −3700 s) are armed. ✓ |
| **D1** uncertain send confirmed by a direct lookup | `landed` set threaded in; `alarm.mjs` builds it from `getSignatureStatuses(pendingSigs, {searchTransactionHistory:true})` and admits only `err===null && (confirmed|finalized)`. The overstated comment is gone. ✓ |
| **D2** `mint.last_sweep_at` watched | Present in `WATCHED_KEYS`; `missingWatchedKeys` therefore names a reader that drops it. ✓ |
| **D3** launch count reader | `RX.launch` widened to `/(\d+) launch\b/g`; planted‑stale arm present. ✓ |

**Review‑33's own correction is sound and I checked its consequence.** `cooldownSeen = Math.min(prev, cfg, 21600)` cannot be widened by a vote because MINT's `tighten_sweep` takes `max` and `21600` is a hard term in the `min`. Note the persisted `sweepCooldownSeen` is therefore **dead state** at the ruled launch values (the current value is always ≥ 21 600) — harmless, not a defect.

**One round‑33 claim I could not confirm and one I can refine:**

* R33's Gate‑5 obligation (the pre‑existing‑wSOL case, filed twice as C06) is recorded in VALIDATION as discharged by on‑chain arm **R33.G4**. `judgeSwapInstructions` + `swapInstructions` do permit the case correctly (SPL `CloseAccount` refuses only `!is_native() && amount != 0`; wSOL is native), so the *reasoning* is right. **Verify R33.G4 exists in `tests/3prog.test.ts` before treating the obligation as closed.**
* SPEC's "Scan backlog boundary" says *"the walk itself pages at most 20 of 1,000 signatures"*. For the alarm that is wrong: `walkSigs(conn, prog, cursor, Math.min(20, Math.ceil(2000/1000)), 1000, …)` → **maxPages = 2**. 20 is the poster's figure only. Documentation, not behaviour.

---

## R1. THE CRANK — findings: none that survive measurement

I reconstructed every instruction the crank builds against MINT's `#[derive(Accounts)]` structs and handlers, and the send order in `main()` against MINT's gate order. **I found no plan the program refuses, no plan that pays or joins a dead vault, and no out‑of‑order reveal.** Specifically:

* **Account lists, order and writability** match `MintVault`/`CaptureEntropy`/`RescheduleReveal`/`RevealLevel`/`RetireBurned`/`Activate`/`Distribute`/`Claim`/`ExpireBoosts`/`SplitRevenue` exactly, including `pool_token` read‑only on `activate`/`distribute` (MINT's `monthly_inline` only reads) and writable on `claim` (it transfers).
* **Gate order holds.** Join batches (step 5) are `claim`s, which run `monthly_inline` *first* — but `waiting_to_join(c) > 0` at that moment in every batch, so the in‑line month is a documented no‑op and cannot pre‑empt the planned `distribute`. `preExpires` (step 6) clears `boosts_due` before `distribute` (step 8). `postExpires` (step 9) clears exactly the boosts `advance_epoch` just made due. `activate` (step 10) lands after the epoch tick, so new requests carry the new epoch.
* **`w` matches the chain.** `total_active_weight + preJoinWeight − retiringWeight − expiringWeight` uses level‑only weight for joins and `level+boost` for retires/expiries, which is exactly what MINT's `join`, `retire` and `unschedule_boost`/`reweigh` do.
* **No value movement.** Every instruction is permissionless and pins its destination; claim pairs are `(record, record.vault_ata)` read off chain, and `claim` re‑checks `dest.key() == r.vault_ata`. The selftest's derived instruction‑name set plus the "no transfer is built, no program but MINT" arm is real and can fail.
* **Dead vaults.** `'other'` (a null RPC element) is never joined or paid, only reported; `'burned'` is retired first, never joined or paid. `retire_burned` is planned at any level.

**One observation worth recording (not a finding):** the crank sets **no compute‑unit limit on any transaction**, relying on the legacy 200 000 default. A reveal was measured at 150 344 CU (25 % spare) and an `expire_boosts` of 20 under 200 000 (`tests/expiry-budget.mjs`). A 14‑pair claim batch is *extrapolated*, not measured. Because the crank's own order guarantees nothing is boost‑due when claims run, the worst claim batch is 14 payments + `monthly_inline`; the extrapolation is sound. If `L.CLAIM_BATCH` or MINT's per‑vault claim cost ever moves, this becomes an unmeasured cliff with no gate on it.

---

## R2. THE ALARM

### FINDING A — MEDIUM. The alarm's own state is unbounded and growable by a paying stranger; SPEC's stated bound stops one step short of the consequence

**Construct:** `bank/detectors.mjs` `detectLogGaps` (`keep = [...reviewed, ...unreviewed]`, where `unreviewed` is **never** trimmed, by deliberate round‑32 L3 design), plus `bank/alarm.mjs`'s `next.seenSplits` / `next.seenSweeps` (also never trimmed), all serialised into **one** `state.json` by `writeLedger` (`JSON.stringify(obj, null, 2)` → write → fsync → rename) and re‑parsed by `readState` every pass.

**What SPEC says:** *"the list therefore grows by at most 8,000 entries a pass, at a stranger's cost of one fee each, until a person writes the watermark"* and *"more than 2,000 unreviewed escalate the page to CRITICAL"*. That is the growth *rate* and the *page*. It does not state what the growth does to the watcher.

**What an attacker gains.** `expire_boosts` naming one real `VaultRecord` with no due boost **succeeds doing nothing** (the loop `continue`s, `n = 0`), so "one of our programs RAN" is true for a transaction that costs one signature plus enough padding instructions to cross the runtime's ~10 KB log limit. At `PER_PROGRAM_READS = 2000` × 4 programs that is 8 000 recorded gaps per pass, 2 passes an hour:

* ≈ 384 000 entries/day. At ~95 bytes per indented 88‑char signature that is **≈ 36 MB of `state.json` per day**, for ≈ **1.92 SOL/day** (5 000 lamports × 8 000 × 48).
* A cheaper single‑program variant: 2 000/pass on MINT alone, ≈ 0.48 SOL/day, ≈ 9 MB/day.
* `seenSplits` is a second vector: `split_revenue` is permissionless, so an attacker who sends 1 sat to the revenue ATA and splits it creates a real `seenSplits` entry (~150 bytes) per transaction, up to 2 000/pass.

At ~100 MB (≈3 days) every pass pays seconds of JSON parse + stringify + a 100 MB fsync'd write; at ~250–300 MB (≈1 week, ≈13 SOL) `JSON.parse`/`stringify` of the whole document is an OOM or a multi‑second stall on a small VPS. The alarm then exits `run_failed` — loud, but **down**. And `seenSplits` growth is additionally an *algorithmic* cost: `detectSplitClaims` calls `closesCycle(c, entries, …)` once per cycle in its 200‑cycle window, and `closesCycle` filters **and sorts the whole split list** each time → O(cycles × splits·log splits). At 500 000 splits that is minutes per pass.

Recovery is not trivial under pressure: deleting `state.json` is refused (`.alarm-has-run` exists) without a deliberate `--first-run`, and `--first-run` adopts whatever is on chain as the drift baseline.

**Why this matters here.** While the alarm is down for a whole cooldown, limit 10's own stated masking becomes reachable ("a thief's sweep followed by an honest one while the alarm itself was down for a whole cooldown is masked here"), and `sweep_unledgered_state` — the round‑32 repair that exists *because* the transaction walk is floodable — stops running too.

**Evidence that would exist if I am right:**
1. `node -e "const a=Array.from({length:384000},()=>'S'.repeat(88));console.log(JSON.stringify({logGaps:a},null,2).length)"` → ≈ 3.6 × 10⁷.
2. `detectLogGaps(Array.from({length:384000},(_,i)=>'g'+i), [], null).keep.length === 384000` (no cap).
3. Time `writeLedger`/`readLedger` on a synthetic 150 MB state file and `detectSplitClaims` with 200 cycles × 500 000 `seenSplits`.
4. On chain: `expire_boosts` with one real record and 60 padding instructions lands successfully with `"Log truncated"` in `meta.logMessages`.

**Fix (off‑chain, so still fixable after the lock):**
* Bound `keep`: retain the **oldest** N unreviewed (so a genuine early gap is never pushed out — round 32 L3's property) **plus** the newest M, and carry a `droppedUnreviewed` counter whose non‑zero value escalates the page and is printed in the finding text. Or move `logGaps` to its own append‑only file so the drift/cursor state the alarm cannot work without stays small.
* Trim `seenSplits`/`seenSweeps` by time, with the horizon pinned to the **oldest cycle in `verifyLastN` plus margin** (any tighter horizon would false‑page `split_not_on_chain`).
* Arm both directions: a 500 000‑entry state must still complete a pass under the cron period, and a genuine gap older than the flood must still be reported.

### Routine states it does **not** page on every pass — checked

`joins_waiting`, `sweep_cooldown_wedged`, `sweep_cap_wedged`, `sales_stopped`, `sweep_stopped`, `guardian_retired`, `reserve_ata_created`, `burn_via_program`, `log_truncated_foreign`, `distributed`, `redeemed` are all INFO; freezes transition to INFO after the first page (`applyFrozenTransitions`); every LEVEL kind has its own router stream and a recovery. `detectRedemptionRate` returns `[]` on an idle window (round 22 A3 holds). I found **no** routine state that pages every pass.

### Completeness checks that pass

* Every value MINT/SEAL/BURN/GOV write once at `initialize` is in `WATCH` at CRITICAL, with one exception: **`bump` on all four configs** is produced by `L.flatten` but unwatched. A `bump` change is impossible (nothing writes it), so this is an INFO‑level gap in the "every fixed‑forever value" claim, not a hole.
* The five programs' upgrade authority and bytes, including `prog.sweep.*`, are watched; `detectUpgradeAuthorityAfterLock` iterates all five and `lock_deadline_unset` covers the unset case. ✓
* `pob_collection.plugins_hash` and `pob_collection.update_authority` are CRITICAL. ✓
* `ALARM_KINDS` covers every `kind:` literal in both sources; an unlisted kind defaults to one‑shot/urgent (loud direction). Every label is ≤ 40 chars (`sweep_bound_ineffective` is exactly 40).
* The `I4` argument pin in the selftest is real and tight: I re‑derived the call order in `main()` and it matches the 33 pinned strings exactly, including the three `detectUnreconciledRevenue` sites.

### FINDING B — LOW. The alarm pages that a proposal opened but never reads what it does

`gov.proposal_count` drift is a one‑shot urgent CRITICAL/HIGH, so the operator *is* told. But no detector reads the proposal PDAs, so during the 3‑day window nobody is told that (for example) a `SetRound` with `cap = 2100` at the 21 000‑sat floor is pending — the case SPEC's own concentration analysis names as reachable by the top three holders if enough Proofs of Burn go unclaimed. The only remedy is the guardian's `emergency_stop_sales`, which has to be pulled during or immediately after the window. **Fix:** read `["proposal", index]` for `index` in `(prevCount, count]` and put the decoded action kinds and a round's price/cap into the `config_drift` detail. Cost: a new struct in `layout.mjs` + its Rust assertion, and a reset of the clean‑round counter (gate 2). Owner's call.

---

## R3. THE LAYOUTS — no findings; round 24 D6 is genuinely discharged

I re‑derived every offset in `offsets()` by hand and checked each against the handlers and against the pinned cross‑program constants:

* **`SEEDS` are now asserted.** The round‑24 D6 defect ("the comment claimed an assertion that did not exist") is closed: the selftest's D6 block maps all 11 seeds to their declaring Rust constant, asserts `Object.keys(L.SEEDS).length === 11`, and flags any **unmapped** key. A twelfth seed added to `layout.mjs` without a mapping fails on both the count and the `UNMAPPED` path. ✓
* **A struct change cannot slip past.** `parseRustStruct` **throws** on any line it cannot read as exactly `pub name: Type,` (private, `pub(crate)`, multi‑line), and the selftest asserts per‑struct equality plus a retyped‑field mutation. Any new type without a `FIXED` entry breaks `offsets`, `encode` and `decode`.
* **Every `OFF_*` any program scrapes is compared**, and the selftest additionally fails on any scraped constant that is *not* in the compared list (round 22 L2). I verified GOV's 20, BURN's 5 and MINT's 3 against the computed offsets (`governance`=41, `minted_total`=141, `bare_burns_retired`=454, `rate_ring` in BurnConfig, `VaultRecord.asset`=9/`mint_index`=41) and found no divergence. The residual: an offset pinned under a name not matching `^const OFF_` would escape the scrape — currently none exists.
* `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated and held to `fixedLength` minus padding (1005/211). ✓ `collectionPluginsHash` parses CollectionV1 correctly and fails closed on a bad length. ✓ `readField('bool')` refuses a non‑0/1 byte. ✓

---

## R4. THE MONEY ARITHMETIC — no divergence found

I checked `bank/accrual.mjs` line‑for‑line against MINT:

| MINT | accrual.mjs | verdict |
|---|---|---|
| `owed_of` = `weight·acc + carry − debt`, `weight = LEVEL_WEIGHTS[l−1] + boost_weight` | `pendingScaled` identical, refuses negative | ✓ |
| `credit`: `delta = avail·ACC_SCALE/w`, `acc += delta`, `owed += delta·w` | `credit` identical | ✓ |
| `ceil_sats` = `(s + 1e12 − 1)/1e12` | `ceilSats` identical | ✓ |
| `claim` settlement: `carry = pending − pay·ACC_SCALE`, `debt = weight·acc` | mirrored in the crank's `pendingSats` usage | ✓ |
| `reweigh`: carry = owed, debt = new_weight·acc, denominator shifts by the delta | `reweigh` identical | ✓ |
| `join`: `debt = level_weight·acc`, `carry = 0` | crank's `pendingSats({level, debt: LEVEL_WEIGHTS[l−1]·cfg.acc}, acc)` | ✓ |
| expire‑then‑credit | crank's `atExpiry + LEVEL_WEIGHTS[l−1]·(acc − cfg.acc)` reproduces `level_w·acc_new + carry − level_w·acc_old` exactly | ✓ |
| `retire` releasing `owed_of` | crank's `retiringOwed` via `pendingScaled`; `owedAfterRetire` feeds `available()` | ✓ |

`L.ACC_SCALE === AC.ACC_SCALE` and `L.LEVEL_WEIGHTS` are both asserted against the Rust (selftest L3). The crank expires every DUE boost before distributing and every boost its own distribution makes due immediately after (`postExpires` keyed on `boost_end_epoch === dist_epoch + 1`). `boosts_stalled` exists and pages HIGH; `mint.cbob_mint`, `mint.max_boost_weight`, `mint.max_boost_epochs` are CRITICAL‑watched. `tests/expiry-budget.mjs`'s synthetic genesis is internally consistent (280 → 40 weight, 2800·ACC_SCALE owed reproduced exactly by 20 × `owed_of`), which is a good sign that the fixture is not papering over a model error.

---

## R5. THE SWAP AND THE REVENUE CYCLE

### FINDING C — MEDIUM. `market()` does not read the accounts the swap will name, so a venue whose tick/bin arrays are not initialised fails **after** the SOL has already been swept to the hot operator key

**Construct.** `bank/swap.mjs` `market()` reads exactly six accounts:

```js
getMultipleAccountsInfo([ORCA.pool, METEORA.pool, pythAccount(SOL), pythAccount(BTC), meteoraBitmap(), SYSVAR_CLOCK])
```

It never reads the **three Orca tick arrays** (`orcaTickArray(s0)`, `s0−span`, `s0−2·span`) or the **three Meteora bin arrays** (`meteoraBinArray(i)`, `i+1`, `i+2`) that `swapInstructions` will unconditionally name. `bank/revenue.mjs` calls `market()` as the pre‑sweep gate, then **sweeps**, then calls `market()` again and only then builds the swap.

**Why that is load‑bearing.** Whirlpool v1 `swap` declares all three arrays as required `AccountLoader<'info, TickArray>` with `has_one = whirlpool`; Meteora's `swap` calls `BinArrayAccount::load_bin_arrays(remaining_accounts)` which `try_from`s every supplied account. In both cases an **uninitialised** array (System‑owned, zero data) fails during Anchor account validation — *before the swap handler runs at all*, and regardless of swap size. A 0.01 SOL swap that would never leave the active array still reverts.

Arrays need not exist. An Orca array at `tickSpacing = 16` spans 1 408 ticks ≈ 15 % of price, so `s0−1` and `s0−2` cover roughly −15 % to −28 % from the current SOL/cbBTC price; a Meteora array at `bin_step = 15` spans ~11 %, so `i+1`/`i+2` cover +11 % to +22 %. Those bands are initialised only if some LP has ever placed a position boundary there. **Meteora is the more fragile of the two, and Meteora is the fallback that exists precisely for when Orca refuses** — on a ~\$0.9 M pool, `i+2` being virgin is entirely plausible after a move.

**What an accident gains.** The cycle sweeps up to the ruled 10 SOL, both venue swaps revert at account validation, `revenue.mjs` throws *"every pinned venue refused the swap … SOL is on the operator key and must be swapped by hand"*, the cycle stays open, `unreconciled_swap` pages CRITICAL after an hour, and **every subsequent run is blocked at the open‑cycle guard**. Royalty conversion halts and up to 10 SOL sits on the single hot key — exactly the exposure limit 10 bounds — until a human runs the hand runbook. It repeats on the next cycle after recovery, because nothing has changed on chain.

**This is not covered by an accepted limit.** Limit 10's hand‑recovery paragraph enumerates market/volatility/confirmation causes of an open cycle; limit 10's trusted list names the pool programs, the RPC, the tree and the third‑party upgrade keys. None of them says the swap can be *built against accounts that do not exist*, discovered only after the sweep, deterministically and repeatably. Item 22's rehearsal would catch it only for the pool state on the day it runs.

**Evidence that would exist if I am right.**
1. `sim/swap-fork.mjs plan` already concedes the premise — it clones only accounts that exist (`want.filter((_, i) => infos[i])`). Today the fork passes 16/16, so today's arrays exist.
2. Decisive test, ~10 lines: in the fork harness, drop `s0−2·span` from the clone list (and separately drop bin array `i+2`), then run. Expected: `market()` still returns `['orca','meteora']` as usable (the deviation gate passes — it reads only the pool), **and** the venue swap fails with Anchor `AccountNotInitialized` (3012 / 0xbc4) or `AccountOwnedByWrongProgram`, with **no** `Instruction: Swap`/`SwapV2` log line — i.e. the failure is pre‑handler.
3. Off chain today: derive the six addresses from the live pools and `getMultipleAccountsInfo` them; record which exist, with the date. Nothing in the repo records this.

**Fix (off‑chain, cheap, and it moves the failure to before the sweep):**
* Add the derived arrays (and the Orca oracle PDA and both vaults, for completeness) to `market()`'s `getMultipleAccountsInfo` call. A venue whose required accounts are not all present/valid is **not usable** — so the cycle refuses *before* `sweep_sol_for_swap`, and nothing gets stuck.
* Better, for Meteora: pass only the bin arrays that exist (they are remaining accounts; the active one suffices for an in‑bin swap). For Orca, either substitute `tick_array_0` into the missing trailing slots (the standard integrator workaround, safe for a swap that does not cross) or skip the venue.
* Arm both directions in the fork: with an array missing, `market()` must drop that venue and the cycle must refuse with nothing swept; with all present, both venues must still swap.

### (a) The oracle math — correct, with one hardening note

`sats = lamports · sol.price · 10^(es−eb) / (btc.price · 10)` is the right identity for 9‑decimal lamports and 8‑decimal sats, and the sign handling is right in both directions (`e ≥ 0` scales the numerator, `e < 0` the denominator). `expectedSats` and `minSats` both truncate **downward**, which is the conservative direction for a floor. All arithmetic is BigInt; no overflow. `satsPerLamport` converts via `Number` on values ≈ 1.2 × 10¹⁰ and 8.6 × 10¹², both well inside 2⁵³, and the resulting ~1.4 × 10⁻⁴ is only ever compared against a 100 bps (10⁻²) gate — float error ~10⁻¹⁶ cannot change a verdict.

Is the floor really below an honest pool's output? Yes with margin, and the fork numbers confirm it: Orca returned **1 408 311** and Meteora **1 407 030** sats against an oracle expectation of **1 408 269** and a floor of **1 387 144** — i.e. honest execution landed **+0.3 bps** and **−8.8 bps** against the oracle, against 150 bps of room. The oracle expectation ignores the pool fee (Orca 0.16 %) and impact; at 10 SOL on a \$10 M pool that is ~20 bps, leaving ~130 bps unused.

**Hardening note (INFO):** `oracleFloor` computes `10n ** BigInt(Math.abs(e))` from a feed‑supplied `exponent` with no bound. A nonsense exponent (only reachable if Pyth's push‑oracle/receiver programs are replaced by their live upgrade keys — limit 10(d)) would hang the revenue job rather than refuse it. One `require |e| <= 24` line.

### (b) Pyth account verification — offsets correct, derivation sufficient

`PriceUpdateV2` is `disc(8) | write_authority(32) | VerificationLevel | PriceFeedMessage | posted_slot(8)`, with `VerificationLevel::Partial{u8}` = tag 0 + 1 byte and `Full` = tag 1 only. Recomputed: level@40, feed_id@41‑73, price@73, conf@81, exponent@89, publish_time@93. **`readPyth` reads exactly those**, requires `level === 1` (Full), the expected feed id, and `owner == PYTH.receiver`, and its `d.length < 101` guard is the exact minimum. `sim/swap-fork.mjs` rewrites publish_time at offset 93, which independently corroborates the layout against the real cloned accounts.

**Is ownership + a derived address sufficient?** Yes, for the question asked. The account is the shard‑0 sponsored PDA `findProgramAddress([u16(0), feed_id], pythWSns…)`; only the push‑oracle program can sign for its own PDA, and the push oracle only writes messages that the receiver has Wormhole‑verified, so neither the price nor the publish time is attacker‑chosen. `write_authority` is unchecked, which I would normally flag — but there is no route to that address that bypasses the push oracle, so it is not exploitable here. The remaining paths (old publish time, chosen price) require the third‑party upgrade keys, which limit 10(d) already names and the alarm watches at HIGH.

**Is the clock trustworthy?** It is the Clock sysvar, address‑pinned via `SYSVAR_CLOCK_PUBKEY` **and owner‑checked** against `Sysvar111…` before `clockUnixTimestamp` is called, and an unreadable clock refuses the cycle. The residual is limit 10(b): everything is read through one RPC. Staleness 180 s / future 30 s / confidence 30 bps are all armed both ways in the selftest and on the fork.

### (c) The deviation filter — right quantities, right directions

* `orcaSpot = (sqrt_price/2⁶⁴)²` is raw B‑per‑raw‑A = **sats per lamport** for a wSOL/cbBTC pool, and `readWhirlpool` refuses any other mint order. Offsets recomputed against the Whirlpool struct: tickSpacing@41, feeRate@45, liquidity@49, sqrtPrice@65, tickCurrent@81, mintA@101, vaultA@133, mintB@181, vaultB@213 — **all correct**, `d.length < 245` is the exact minimum.
* `meteoraSpot = 1/(1+binStep/10⁴)^activeId` inverts the DLMM's Y‑per‑X price, and `readLbPair` refuses any order but cbBTC/wSOL — i.e. **reversed from Orca, as required**. Offsets recomputed: activeId@76, binStep@80, status@82, mintX@88, mintY@120, reserveX@152, reserveY@184 — all correct.
* Sanity cross‑check at the fixture values: `meteoraSpot(binStep 15, activeId 5920) = 1.4 × 10⁻⁴`, and `solFor(target)` built from the real 2026‑10‑05 prices gives the same 1.4 × 10⁻⁴. The two readers and the oracle agree in the same unit.
* Floating point cannot pass a pool it should refuse: the selftest drives `market()` with the oracle placed at 99 and 101 bps **on both sides** of a fixed pool, through the real function, and both venues are exercised independently. Relative float error is ~10⁻¹⁵ against a 10⁻² threshold.

**INFO:** `readLbPair` reads Meteora's `status` byte (0 = Enabled) and never checks it. A disabled pool passes the deviation gate and reverts on chain. Harmless today because Meteora is the fallback, but it is a free check.

### (d) The minimum out — same floor, right units

`guaranteed = m2.f.minSats` is written into Orca's `other_amount_threshold` (bytes 16‑24) and Meteora's `min_amount_out` (bytes 16‑24), both in **cbBTC base units (sats)**, which is the output unit for both venues (Orca a_to_b outputs token B = cbBTC; Meteora Y→X outputs X = cbBTC). The deviation filter in `m2` used the same `m2.f.satsPerLamport`, so the filter and the floor come from the same oracle read. ✓ The alarm's `short_swap_return` tolerance (2 %) is strictly looser than the floor (1.5 %), so an honest swap can never raise a false CRITICAL. ✓

### (e) The judge — complete for its stated scope

I checked each item the prompt asks about. `judgeSwapInstructions` **does** check: the output account is `ata(CBBTC, owner)` (index 5 on both venues); the minimum‑out bytes equal `minSats`; the amount bytes equal `lamportsIn`; Orca's direction and price‑limit bytes (`d[40]=1`, `d[41]=1`, `readU128(d,24) === 4295048016`); that no ComputeBudget instruction sets a price (and the exact 7‑slot shape leaves no room for `RequestHeapFrame` or a data‑size limit either); and that both ATA creations name `[owner, ata(mint,owner), owner, mint, System, Token]` with data `[1]`. The signer slot is positionally checked (Orca 1, Meteora 10) **and** `isSigner`. Since *any* problem refuses, the `ixs.length !== 7` check makes the positional checks exhaustive.

What remains unchecked are the venue's own liquidity accounts (Orca vaults/ticks/oracle; Meteora reserves/mints/oracle/`host_fee_in`/token programs/event authority/bin arrays). **A tampered builder cannot escape through them**: each venue program validates them against the pool it was given, and the only semi‑free one, Meteora's optional `host_fee_in`, can at most redirect a share of the *protocol fee* that is already deducted before our output — which the on‑chain floor still binds. So the residual is exactly the stated 150 bps, plus limit 10(c)'s same‑tree residue (a tamper that can edit `swap.mjs` can edit the judge, and `minSats` itself is supplied by the same module). Pinning Meteora key 9 to `METEORA.program` is a one‑line tightening.

### (f) Account derivation — recomputed, all correct

* Orca tick arrays `[b"tick_array", pool, ascii(start)]`; `start = floor(tick/span)·span` with `span = 88·tickSpacing`. `Math.floor` is the right rounding for negative ticks (`−88733/1408 → −64 → −90112`, which matches the selftest and Orca's `TickUtil.getStartTickIndex`). For a_to_b the price falls, so **current then the two below** is right. A tick exactly on a boundary belongs to the array starting there (`[start, start+span)`), which the selftest pins.
* Orca oracle `[b"oracle", pool]`; vaults read from the pool; 11 accounts in exactly the v1 `Swap` order.
* Meteora bin arrays `[b"bin_array", pool, i64_le(index)]`, `index = floor(activeId/70)`; for Y→X the active bin moves **up**, so `[i, i+1, i+2]` is right. Bitmap `[b"bitmap", pool]`, oracle `[b"oracle", pool]`, event authority `[b"__event_authority"]`, `host_fee_in` = program id for `None`, two classic Token programs — all matching the published lb_clmm account order.
* **At a boundary / uninitialised array:** boundary is fine; uninitialised is **Finding C**.

### (g) wSOL handling — correct, including the pre‑existing‑balance case

Wrap exactly `lamportsIn`, `SyncNative`, swap, `CloseAccount` back to the owner. A pre‑existing wSOL ATA with a stranger's lamports: `CreateIdempotent` no‑ops, the sync makes `amount = lamports − rent`, the swap sells exactly `lamportsIn`, and the close returns rent plus any surplus **to the operator** — SPL `CloseAccount` refuses only `!is_native() && amount != 0`, and wSOL is native. Frozen is impossible (the native mint has no freeze authority). A delegate cannot act inside one atomic transaction and the account is closed every cycle. **Partial fill cannot leave wSOL behind**, because the floor is computed on the full `lamportsIn`: a swap that consumes less necessarily outputs less than `minSats` and the venue program reverts. VALIDATION records R33.G4 as pinning the pre‑filled case on chain — verify that arm exists.

### (h) Failure and retry — sound, and double‑swap is self‑limiting

Only `outcome === 'refused'` advances to the next venue; `'unknown'` records the candidate signature and throws with the cycle open. I checked the three refusal paths against web3.js 1.98: a confirmation that landed‑and‑failed throws with `Status: ({"err":{"InstructionError":[…,{"Custom":…}]}})`, which matches **none** of `PREFLIGHT_REFUSAL`'s three patterns, so it correctly falls through to the chain lookup (the round‑25 L3 repair is real). A timed‑out send with a `null` status plus `TransactionExpiredBlockheightExceededError` is treated as refused, which is the one judgement that could in principle be wrong — and even then a second swap is self‑limiting: the first swap consumed the swept lamports, so the Meteora wrap of another `lamportsIn` would fail for insufficient funds against the 0.02 SOL operator float. `returnedSats` is written only after the return transaction confirms, so **no path closes a cycle before a return is proven**, and `cycleIsOpen` additionally requires a split.

### FINDING D — LOW. `revenue.mjs`'s split‑recovery bounds a chain scan with the box wall clock

```js
const since = Math.min(...returnedUnsplit.map(c => Date.parse(c.returnedAt || c.startedAt)/1000)…)
const splits = await splitsSince(conn, revAtaC, since - 60)
```

`returnedAt`/`startedAt` are the **box's** `new Date()`; `splitsSince` filters on `s.blockTime`, the **chain's**. This is the one domain mix the rest of the tree now forbids (`cycleStartMs`: *"translate its age into the caller's wall‑clock domain, never compare the two clocks"*; `detectSweepState` was repaired for exactly this in round 33 L1). A box clock more than 60 s **ahead** of the chain puts `since` in the chain's future; `splitsSince` then breaks out after its first page with `out = []`, `closesCycle` finds nothing, and the recovery that exists to unwedge a crashed‑before‑save cycle fails — leaving the revenue job permanently refused at the open‑cycle guard until a human intervenes. (The anchor itself is correctly chain‑based: `closesCycle` uses `returnBlockTime`. Only the scan *horizon* is wrong.)

**Evidence:** stub `Date.now()` 5 minutes ahead, place a real split on chain 1 minute before the recorded `returnedAt`, and observe `splitsSince` return `[]` while `getSignaturesForAddress` shows the split. **Fix:** derive `since` from the cycle's `returnBlockTime` when present (filling it from `returnSig` first, which the code already does two lines earlier), else translate `returnedAt` by `chainNow − wallNow`.

### (i) What an adversary can extract inside the tolerance — the bound

* **Per cycle:** the on‑chain floor caps loss at `150 bps × lamportsIn`. At the ruled 10 SOL cap that is **0.15 SOL (~\$18)**, of which 85 % falls on holders.
* **Per day / month:** the 6‑hour cooldown gives 4 cycles/day → **≤ 0.6 SOL/day, ≤ ~18 SOL/month** worst case, against the pipeline's own ~40 SOL/day throughput ceiling, i.e. **≤ 1.5 % of royalty flow**.
* **Achievability.** On Orca (~\$10 M) a sandwich must move the price ~1.5 % and pay 0.16 % each way on its own legs; net extraction on a 10 SOL victim is a small fraction of the 0.15 SOL, so Orca is effectively not worth sandwiching. **On Meteora (~10× thinner) the full 150 bps is realistically capturable**, because moving a \$0.9 M DLMM is cheap. The deviation gate does not help: it is a *read‑time* filter, and the attacker moves the pool after the read.
* **A stale‑but‑accepted oracle** adds at most the drift over 180 s (plus the 30 s future tolerance) on top of 150 bps; a 1 % move in 3 minutes is uncommon but not rare, so the practical worst case is ~250 bps of a cycle.
* **Operator key worst case, restated for limit 10's "limit 10 has changed" question.** The key can still take `cap × cooldown windows` of swept SOL until the guardian stops it — unchanged. What changed is the *swap*: it now trusts two pinned pool programs, Pyth's two programs, the single RPC, and the integrity of `swap.mjs`/`revenue.mjs`. The judge removes the Jupiter‑era "sign bytes a third party chose"; it does **not** remove the same‑tree residue, and `minSats` — the one number the judge enforces — is produced by the same tree it judges.
* **Can the ledger read a failed cycle as closed?** No path I can find. `cycleIsOpen` requires `returnedSats > 0` **and** a split; `sendRejected` is written only on a refusal and never alongside `sweepSig`/`sweptLamports` (the contradiction is itself `rejected_row_has_sweep` CRITICAL); `returnedSats` is written only post‑confirmation; the chain‑side `unledgered_sweep`, `sweep_amount_mismatch`, `split_not_on_chain`, `split_claim_unanchored`, `split_by_other_unanchored` and `sweep_unledgered_state` are each independent of the writer. Finding A is the only way to blunt them, and it does so by taking the whole watcher down loudly.

---

## R6. THE GATES

### FINDING E — LOW. `audit-coverage.sh` still enumerates root‑level files by a hand‑picked list of five

```sh
git ls-files 'programs/*' 'bank/*' 'scripts/*' 'sim/*' 'launch/*' 'tests/*' \
      SPEC.md DESIGN-v6.md HOLDER-GUIDE.md Cargo.toml Anchor.toml
```

Round 29 L1 fixed the *directory* half ("enumerate every TRACKED file under the system's directories instead") and left the **root** half as the same hand‑picked set it was criticising. Any other tracked root file — a `package.json`/`package-lock.json` pinning the `@solana/web3.js`, `@solana/spl-token` and `@metaplex-foundation/mpl-core` versions that `txread.mjs` exists *because of*, a `tsconfig.json` the suite runs under, `.gitignore`, a `Makefile`, `rustfmt.toml` — has never been bundled and **cannot be reported as unaudited**, because the gate never asks about it. Round 15's own words apply verbatim: *"a coverage gate that excludes the files controlling the certification is the same shape as the defect it exists to catch."*

**Evidence:** `git ls-files | grep -vE '^(programs|bank|scripts|sim|launch|tests|audits)/'` — every line not in the five named files is invisible to the gate. **Fix:** enumerate `git ls-files` wholesale and name every exclusion with its reason (as the directory half already does), rather than allow‑listing five root files.

### Everything else in R6 that I could check, and what it is worth

* **Floors are equality, not bounds.** `floor()` dies unless `n == expected`, and `MIN_ASSERTIONS`/`FLOOR`/`SWAP_FLOOR`/`EXPIRY_FLOOR` are all `-eq`. SPEC's stated counts are checked at **every** occurrence of every floor, and a zero‑occurrence pattern is a failure (`found.length > 0 && …`). I cross‑checked the Running‑the‑tests block against the runner: 866 / 909 / 39 / 23 / 14 / 47 / 33 / 4 / 71 / 16 all line up with `MIN_ASSERTIONS`, `DET_FLOOR`, `ALLOC_FLOOR`, `POSTER_FLOOR`, `POB_FLOOR`, `LAUNCH_FLOOR`, `MAINNET_FLOOR`, `EXPIRY_FLOOR`, `SIM_FLOOR`, `SWAP_FLOOR`. ✓
* **Round‑24 arms, both directions.** I spot‑checked the round‑24/25 blocks that the prompt singles out. L1's eight tampers are each applied to the **real** built instructions and each is additionally shown to pass the verbatim round‑24 judge (`judge24`), so the arm can fail. L2's stale/future cases run the real `market()` against a stubbed connection. L3 drives the actual `SendTransactionError`/`TransactionExpiredBlockheightExceededError` objects and shows the round‑24 regex misclassifying two of three. L6a/L6b/R30 L2 exercise the budget boundaries including the floor‑reserve case. L13b's three mutations (deleted call, commented call, result discarded) each name exactly the right detector. **I did not find an arm in the bundled selftest that cannot fail.**
* **Vacuous‑on‑empty.** The two that could be are guarded: `everywhere()` requires `found.length > 0`; the ON‑CHAIN control‑table rows require a named program *and* a refusal that is a real enum variant, with the parser itself asserted to find `NotTheGuardian`.
* **`build-mainnet.sh` for all five.** It proves: the source names Gary's key as the non‑localnet `INIT_AUTHORITY` in all four initialising programs; `dist/` holds **exactly five** `.so`; the sweep helper's mainnet bytes are byte‑identical to both the localnet rebuild **and** `target/deploy/` (the build the suite deployed); and all four mainnet artifacts REJECT the localnet key while all four localnet artifacts ACCEPT it, on a validator that is refused unless Core matches the pinned mainnet sha256. It explicitly does **not** claim the compiled constant *is* Gary's key, and says why. The sweep helper has no key to ask about, so byte identity is the strongest available proof — and it is the right one. ✓
* **`cron-install.sh` arms nothing it should not.** Six tagged jobs; both money jobs are opt‑in; the `ours <job>` preserve is anchored to `$TAG <job>[[:space:]]*$` (closing round 24 L12's `crank` vs `crank-reveal` bleed); the posture print is computed from the crontab actually written; the rehearsal marker refuses installation before anything is touched; `$TAG <job>` at line end is a shell comment, so it never reaches `notify-gary-sms.sh`; every node job carries a literal/indirect `flock -n` and `judgeCronTemplate` is run against the real file. Locks live in `$R/bank/locks`, not the tmpfs `/var/lock`. ✓
* **INFO:** both network‑skip branches end in `[ "${CBOB_SHIP_GATE:-0}" = "1" ] && die …`. Mid‑script that is errexit‑exempt, but the swap‑fork skip is the **last** statement, so a fully passing run on a box with no DNS exits **1**. That is the safe direction (a skipped probe must not look green) but it makes a benign skip indistinguishable from a real failure — the shape of accepted limit 6.

### FINDING F — LOW. `parseCbobLogs` never requires the invoke stack to be empty, so a log array truncated by anything other than the runtime's exact marker loses CBOB events silently

`txread.mjs` detects truncation by `meta.logMessages.includes('Log truncated')` — an exact element match on the runtime's standalone marker (correctly distinguished from a program's own `"Program log: Log truncated"`, which R28 M1 pins). If that string ever changes, or if the RPC provider truncates the array itself without inserting it, the transaction validates clean and `parseCbobLogs` reads the partial log as complete. And `parseCbobLogs` reports a `problem` only on a **mismatched pop** — never on a stack that is still non‑empty at the end — so the loss is silent: the events before the cut are returned, the ones after are gone, `problem: null`, and the alarm advances its cursor.

**Evidence:** `parseCbobLogs(['Program Gsb7…  invoke [1]', 'Program log: CBOB_REVEAL_RESCHEDULED asset=A mint_index=1 old_slot=1 new_slot=2 times=1'])` → `{events:[…reschedule…], problem:null}`; the same array cut one line earlier → `{events:[], problem:null}`. A reschedule (accepted limit 25) or a `CBOB_REDEEMED_POOL_FROZEN` forfeit (a holder losing sats) is then never paged. **Fix (two lines):** return `problem` when `stack.length !== 0` after the loop; the alarm already pages `log_unparseable` HIGH on a `problem` and keeps its cursor behaviour. Arm both ways.

---

## The four questions about the ACCEPTED LIMITS

**1. Is any limit worse than stated?**

* **Limit 10 (the swap hop) — yes, in one specific way.** Its enumeration of what can leave a cycle open after the sweep (market move, confirmation timeout, venue refusal) does not include **Finding C**: a venue whose required tick/bin arrays are uninitialised fails *deterministically and repeatably* at account validation, after the sweep, on both venues, for any swap size. The runbook handles it, but "the automatic path cannot double‑swap" is not the same as "the automatic path cannot strand the cycle every cycle".
* **"Reader coverage boundary" — yes.** The stated bound stops at the growth *rate* ("at most 8,000 entries a pass … until a person writes the watermark") and does not state that the growth is into the single JSON document the alarm must read and rewrite every pass, nor that it is therefore a paid, escalating degradation and eventual stop of the watcher (**Finding A**).
* **Limit 10's round‑32/33 paragraph — not worse.** I verified the symmetric window, the `landed` gating, and the smallest‑cooldown bound, and I could not construct a thief's sweep that falls inside an honest cycle's window: if the honest sweep landed, the thief's next legal sweep is a full cooldown away (> half); if it did not land, it explains nothing unless a direct status lookup confirms it. The residual (an RPC failure on the status lookup → one false CRITICAL) is the loud direction and is one‑shot.
* **Limit 44 — correctly stated.** I confirmed the mechanism: the sweep helper transfers only when `amount > 0` and always closes, and SPL `CloseAccount` does not check the frozen flag, so "a frozen one holding zero is only closed" is right, and "a frozen stray holding a balance reverts the redemption" is right.

**2. Is anything listed as a limit not actually a limit, or already closed?**

* **Round 33's one Gate‑5 obligation** (a native wSOL account closing with a pre‑existing balance) is *logically* closed by the SPL rule and is recorded in VALIDATION as pinned by on‑chain arm **R33.G4**. If that arm exists, the obligation is discharged and should be struck rather than carried a third time. I cannot read the suite; verify and strike.
* **Limit 29** ("only cbBTC splits; anything else stays there for ever") is exactly true of the code: `split_revenue` requires `mint == payment_mint` and `sweep_sol_for_swap` moves only lamports. No instruction moves any other token out of the revenue PDA.
* I found **nothing else** listed as a limit that is already closed.

**3. Is any DISCHARGED item not actually discharged?**

* **Item 51 ($CBOB boost)** claims off‑chain mirroring in `accrual.mjs` (`reweigh`, `pendingScaled`), the crank (expiry before *and* after a distribution) and the alarm (`boosts_stalled`, bounds watched as fixed forever). **All four verified present and correct.** Discharged.
* **Item 54 (compute at the widest host shapes)** is honest about which numbers are measured and which extrapolated. The one extrapolation that still matters — a 14‑vault claim batch at ~4 000 CU/vault — is safe *because of the crank's own ordering* (nothing is boost‑due when claims run, so a claim batch never carries expiries). That dependency is not written down anywhere; if the crank's order ever changes, the extrapolation stops holding and no gate notices. Worth a sentence in item 54.
* **Item 12/17, 14, 19, 30, 31, 33** and the Bank/deck/distributor family: verified gone or closed by construction. The selftest's "retired v5 files are deleted, not stubbed" and "no file imports one of them" arms are real.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No — but the **dependency chain under items 22 and 53 is not merely unrun, it is unbuilt**, and the documents do not say so in one place:

* **Item 53 names two artefacts as "Still to write": `launch/rehearsal-init.json` and a rehearsal mode in `scripts/check-launch-params.mjs`. Both are still absent.** The bundled `check-launch-params.mjs` pins mainnet values unconditionally (`judgeLaunch`'s `PINS` and the `status !== 'RULED'` sweep), so a rehearsal value set cannot pass it today.
* **Item 22's five named rehearsal items therefore cannot start**, and item 22 is a precondition of road steps 9‑11. Item 50 (the holder surfaces, including the redeem page that is the *only* preventive control for limits 9 and 44) is also unbuilt, and is a precondition of removing the upgrade authority.
* **Item 38's enumeration is incomplete in one concrete way:** the **CBOB collection address** is an `initialize` *account*, not a parameter, so it appears neither in `launch/mainnet-init.json` nor in the launch checker's `PINS` nor in the alarm's production list. `collections_disagree` catches a cross‑program mismatch and `initialize` refuses an unclean/foreign‑authority collection, so a *wrong but valid* collection is only reachable by a ceremony mistake — which is exactly what round 24 A6 ("the checker validates the JSON, not the signed transaction") and round 33's C19 ("no deploy/initialize read‑back script") warn about. Add it to the file and to the read‑back.
* **One refinement to item 22 that matters because of Finding C:** when the rehearsal's "one full live revenue cycle through each pool" runs, it must **record the derived Orca tick‑array and Meteora bin‑array addresses and whether each existed on chain**. Otherwise it discharges the swap only for that day's pool state and leaves Finding C live.

---

## Anything else

* **INFO.** `bump` on all four configs is produced by `L.flatten` but not in `WATCH` or `WATCHED_KEYS`. Impossible to change; a completeness nit in "every value fixed forever drifts as CRITICAL".
* **INFO.** `RX.launch` was widened to `/(\d+) launch\b/g` by round 33's repair. It will now also match an incidental "2026 launch" in SPEC and demand it equal `LAUNCH_FLOOR`. A false red later, not a missed check.
* **INFO.** `scripts/rehearsal-tree.sh`'s proof is strong (byte‑exact forward/reverse, git's own diff cross‑checked, the 4‑char abbreviated‑id sweep, a refusal if a file already contains a throwaway id). Its substitution set does not include root `Cargo.toml` — currently it holds no program ids, so this is only a latent gap. The non‑substituted absolute paths (`/opt/gary-club/.env.local`, `/opt/scripts/notify-gary-sms.sh`) are disclosed in the script's own closing text.
* **Verified positives worth recording so they are not re‑litigated:** the Pyth `PriceUpdateV2` offsets (40/41/73/81/89/93); the Whirlpool offsets (41/45/49/65/81/101/133/181/213) and `d.length ≥ 245`; the LbPair offsets (76/80/82/88/120/152/184) and `d.length ≥ 216`; `ORCA_MIN_SQRT_PRICE = 4295048016`; Orca's 42‑byte `swap` data layout and both direction bytes; the three Orca tick‑array starts for a_to_b and the three Meteora bin‑array indices for Y→X; `host_fee_in = program id` as Anchor's `None`; all eleven PDA seeds against their Rust constants; `accrual.mjs` ≡ MINT for `credit`/`owed_of`/`reweigh`/`ceil_sats`/`join`/claim settlement; and the whole crank instruction set against MINT's account structs.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concretely, before launch, do the things no amount of AI reading can substitute for:

1. **Make the pre‑sweep gate a superset of what the swap needs, and prove it on a fork with an account deliberately absent.** This is Finding C, and it is the one item on this list that is both a code change and a test change. The test is the point: delete one tick array and one bin array from `sim/swap-fork.mjs plan`'s clone list and assert (a) `market()` drops that venue and (b) with the current code the swap fails *pre‑handler*. An AI pass cannot discover this because the fork only ever clones the accounts that happen to exist today.

2. **Run item 22's five rehearsal items with an adversary in the room, and record signatures.** Specifically: have a second person, during the rehearsal, (i) flood one rehearsal program with ~2 000 successful padded `expire_boosts` no‑ops and measure the alarm's pass time and `state.json` size growth (this is Finding A, measured rather than argued); (ii) front‑run a `split_revenue`; (iii) land one base unit into a vault reserve mid‑redemption; (iv) force the Orca floor above its price so Meteora really runs; (v) kill the revenue job between sweep and swap and walk the hand runbook end to end. Record the clock skew of the box against the chain during all of it. **Build `launch/rehearsal-init.json` and the rehearsal mode in `check-launch-params.mjs` first** — item 53 blocks item 22 and neither has started.

3. **Reproduce the five `dist/` binaries on a second machine you did not build on**, from the release commit, and compare sha256 with `dist/SHA256SUMS`. `build-mainnet.sh` is explicit that reproducibility is the whole bridge for the `INIT_AUTHORITY` claim; nobody has crossed it yet. Pin the exact toolchain (`platform-tools v1.54`) and the off‑chain dependency versions in this repo, not in `/opt/gary-club` behind a symlink.

4. **A witnessed `initialize` ceremony with a machine‑checked read‑back.** Build the four transactions **from** `launch/mainnet-init.json` (round 24 A6), add the **collection address** to that file, and immediately afterwards run a script that reads all four configs back through `bank/layout.mjs` and asserts every field equals the file — including the five values the alarm's production list does not cover (guardian, swap operator, cap, cooldown, reserve) and the collection. Two people watching, screen recorded. One wrong byte is permanent.

5. **Run the watcher from somewhere that is not this box, on a different RPC provider.** Limit 10(b) and limit 10(3) are the same sentence twice: one RPC endpoint and one uid hold the ledger, the crontab, the alarm and the signing keys. A second, read‑only `alarm.mjs --dry-run` on different hardware against a different provider, whose output a human diffs against the primary's, is the cheapest correction to both, and it is the only way the box‑owner residue stops being unbounded.

6. **Resolve the three custody rulings as *operations*, not documents.** The Giraffish Moments hot key (limit 46) can end the project during the 7‑day window; the $CBOB release wallet (limit 56) holds 2.1 billion tokens on this box; the swap operator key signs the only trusted hop. Before the charter window opens, decide and *execute*: cold or multisig custody for the Moments key through the window, and the $CBOB supply moved off the box. Both are reversals of a ruling, so they are Gary's; but they are the two largest single‑key exposures in the system and neither is a code problem.

7. **Exercise the holder surfaces with real wallets before the lock.** Item 50's redeem page is the *only* preventive control for limits 9 and 44, and it must do seven specific things (prior ATA transaction, no claim during a pool freeze, sweep through the helper, the 1 209‑byte packet, compute limits, `judgeRedemptionCoverage`, close what it empties). Build it outside `programs/`/`bank/`/`scripts/` so it does not reset the freeze, then redeem a real funded vault — with a stranger depositing dust mid‑transaction — through Phantom and through Ledger.

8. **Time a guardian drill.** From "page received" to "`emergency_stop_sweep` landed", on real hardware, with the real wallet, at 03:00. Limit 10's bound is literally `cap × windows until the guardian stops it`; that number is unknown until someone measures it. Do the same for `emergency_stop_sales` after a `config_drift` page on `mint.price`/`mint.cap`, which is the only remedy for a hostile ordinary proposal.

9. **Put a bounty and a canary in front of the lock.** Deploy at the real ids with the real values, mint a handful of vaults funded with ~\$50 each, publish the addresses and a bounty, and leave the upgrade authority in place for a fixed public window. The one thing an audit round structurally cannot do is give an adversary an incentive to try; that window is the only place in this plan where somebody who wants the money gets to look at it while you can still fix what they find.