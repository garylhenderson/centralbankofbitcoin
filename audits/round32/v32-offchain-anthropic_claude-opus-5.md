# Independent audit — v6 off-chain pipeline (crank, alarm, layouts, accrual, swap, revenue, gates)

**Verdict: NOT CLEAN.** Three MEDIUM and five LOW/INFO findings survive measurement-by-reading, plus corrections to three accepted limits. Round 31's four repairs are present and, with one exception noted in R0, do what they claim. Nothing I found loses customer Bitcoin; two findings make the *detection layer* and the *one trusted hop* materially less available than SPEC claims, and one is a permissionless grief on the level queue that the shipped crank cannot recover from.

Where I did not execute, I say so and name the measurement that would settle it. I verified several of the round-31 verdict's claims arithmetically from first principles (offsets, Meteora/Orca layouts, oracle algebra, rent figures) rather than taking them on trust; those verifications are recorded so they are re-checkable.

---

## R0. Round 31's verdict and its repairs

### What I independently confirmed

| round 31 item | repair at HEAD | my check |
|---|---|---|
| off-chain **L1** (urgent page per fee for a truncation gap) | `detectLogGaps` + `ALARM_KINDS.log_coverage_gap: 'level'` + `bank/log-gaps-reviewed` watermark | **Holds.** The finding carries no `signature` and no `urgent`, so `planAlarmNotices` classifies it non-urgent; its text is byte-identical across passes (the selftest asserts `n(g1).text === n(g3).text`); a watermark absent from `keep` leaves every gap unreviewed (loud direction); `.slice(-500)` can evict the watermark, which also fails loud. Only real gaps (`ran.length`) enter `logGaps`; a stranger's padded transaction is INFO. ✓ |
| off-chain **L2** (a flood delays every page) | `PER_PROGRAM_READS = 2000`, resumable backlog | **Bounded, not fixed, and SPEC now says so.** `maxPages = min(20, ceil(2000/1000)) = 2`, so the walk itself stops at 2,000 and `walked.sigs.length > PER_PROGRAM_READS` is dead at the default (the 1,500-budget arms are what exercise the trim). The *other half* of L2 — findings computed before the walk are reported only after it — was **not** repaired; `main()` still pushes drift/pool/brake/upgrade findings into `findings` at lines before the walk and calls `report()` only after it. SPEC's "Scan backlog boundary" now discloses 16–52 minutes. My finding **M2** shows that bound is not actually bounded. |
| off-chain **D1** (SPEC 38 overstated the alarm) | SPEC 38 rewritten | **Accurate.** I checked all five: `mint.guardian`, `mint.swap_operator` (CRITICAL) and `mint.sol_reserve_lamports`, `mint.max_sweep_lamports`, `mint.sweep_cooldown_secs` (HIGH) are all in `WATCH`, and none is in the production `want` list. The new sentence is true. |
| off-chain **D2** (poster says "Nothing was held." for a SOL-only redemption) | `releasedFromTx` counts System transfers out of the vault PDA; `ASSETS` gains the native mint | **Holds.** The helper's lamport move is a System `transfer` whose `source` is the asset-signer PDA (`programs/cbob-vault-sweep/src/lib.rs` 75-79), which is exactly what the new branch keys on; inbound SOL is not counted; the both-ways arm exists. The R27 pinned reader value moved by exactly 1,000 lamports, which is the fixture's System transfer from the same address — consistent, not a regression. |
| programs **L1** (coverage gate credited any wording) | `first_line_quorate` exact headline + 8 self-test cases | **Holds,** and the bundled `audits/round31/VERDICT-offchain.md` line 1 matches the required form. The gate correctly credits a `NOT CLEAN; QUORUM MET` round (coverage ≠ cleanliness). |

### Verdict claims I re-derived rather than trusted

* **C01 (wSOL dust does not break the cycle): correct.** SPL Token's `process_close_account` applies the `amount == 0` requirement only to *non-native* accounts, so a native account closes with its balance; the stranger's dust and rent land on the operator. I also checked the adjacent variants: a wSOL ATA cannot be frozen (the native mint has no freeze authority) and a delegate is irrelevant because the swap moves tokens under the owner's authority. Nothing in the judge or the builder breaks on a pre-existing wSOL ATA.
* **C04 (SPEC offsets 141/454): correct, and the layout is right.** I recomputed `offsets('MintConfig')` by hand from `STRUCTS`: `minted_total` = 141, `bare_burns_retired` = 454, `sales_stopped` = 191, and `fixedLength('MintConfig')` = 1005, `fixedLength('VaultRecord')` = 211 — matching the pinned `[1005, 211]` and limit 49's 221-byte record. Qwen Max's 117/430 came from an incomplete field list, as the verdict said.
* **Rent figures (not challenged by round 31, worth recording):** 650,240 / 1,488,440 / 1,772,920 / 1,513,840 are all `(128 + size) × 5080`, and the bundled mainnet fixture's *newly created* 170-byte ATA cost exactly 1,513,840 while *pre-existing* 165-byte accounts hold 2,039,280 (the old `× 6960` rate). The figures are internally consistent; the programs' `RENT_EXEMPT_0_BYTES = 890_880` is stricter, as measured fact 9 says.
* **Round 31 L2's read-rate arithmetic:** with the walk capped at 2 pages and four programs, 8,000 serial `getTransaction` calls per pass is right. At the 300 ms public-RPC latency the verdict measured, one pass is ~40 minutes of wall clock; the cron fires every 30 minutes and `flock -n` silently skips the overlapping tick. That is disclosed, but see **M2**.

### Where the prior verdict was too generous

Round 31 L2 was closed as "bounded". The bound it rests on is *that the walk always completes*. It does not: a single read error anywhere in those 8,000 calls throws out of `main()` and the pass reports nothing at all (**M2**). The prior pass measured the walk's *throughput*; it did not probe its *failure* path.

---

## R1. THE CRANK (`bank/crank.mjs`)

I reconstructed every instruction the crank sends against MINT's account structs and gates. **Account order, mutability, signer flags, discriminators and data encodings all match** (`reveal_level`'s 9 accounts in `RevealLevel` order; `split_revenue`'s read-only config; `distribute`/`activate`'s read-only `pool_token` vs `claim`'s writable one; `expire_boosts` ≤ `MAX_EXPIRE_BATCH`; `claim`'s `crank_n = 0`). The one thing that looked wrong — `sweep`/`split`/`reveal` passing the operator or payer with `isSigner: false` in the instruction meta — is not a defect: `Transaction.compileMessage` forces the fee payer's meta to `isSigner: true`, and `is_signer` is a property of the message's account list, so Anchor sees a signer. I checked this rather than assume it.

The ordering against the program's gates is correct in the ways that matter: bare burns are retired **before** joins (so `pending_count`/`pending_this_epoch`/`boosts_due` are decremented before `JoinWaitingFirst` and `BoostsExpireFirst` are evaluated), `preJoins` precede `expire-before` precede `distribute`, `postExpires` covers exactly `boost_end_epoch == dist_epoch + 1`, join-only batches are the only `claim` sent while the pool is frozen or absent (so they land), and `plan.reveal` is a contiguous run from `revealed_total` that `budgetPlan` truncates from the tail (preserving mint order). I found no plan the program refuses for a reason the crank could have predicted, no path that pays or joins a positively burned vault, no out-of-order reveal, and no instruction that moves value anywhere MINT does not already pin.

Two findings follow.

---

### M1 — MEDIUM: the crank sets **no compute-unit limit on anything**, and a vault owner can inflate their own reveal's cost; the FIFO then stalls the whole level queue and the crank cannot recover

**Construct.** `bank/crank.mjs` `main()` builds every transaction as `new Transaction().add(...ixs)` with no `ComputeBudgetProgram` instruction. Accepted limit 54 exempts the crank on the strength of two measurements: a capture at **114,756 CU** and "each reveal alone (150,344 with its inline capture, arm 10.4)" — 75% of the legacy/v0 default 200,000, measured on the suite's vaults.

**What an attacker or an accident gains.** `reveal_level` is strictly FIFO (`RevealOutOfOrder`), and `activate` refuses `NotRevealed`. So the *cheapest* vault whose reveal exceeds 200,000 CU blocks every later vault's level, hence every later activation, hence every later payout — for everyone, not just its owner. Two ways to reach it:

1. **Attribute budget.** MINT allows 640 stored Borsh bytes of attributes (`MAX_ATTR_BYTES`), and `reveal_level` must re-send the whole list through Core's `UpdatePluginV1` (serialize + realloc). Arm 10.4's 150,344 is not stated to be at that budget. 640 bytes versus a typical suite vault is plausibly tens of thousands of CU.
2. **Owner-managed plugins.** Round 28 measured that an owner may grow an Autograph plugin and that **the MINT reveal of a 10,150-byte-message vault landed (R28.A1)**. Whether it landed *under 200,000 CU* is nowhere recorded, and the suite "now sets the limit" on crank-carrying sends — so the suite may well be proving the reveal works at a raised limit that the shipped crank never sets. Growing the plugin costs the owner one fee and is irreversible (round 28: Core can no longer shrink it), so this is a cheap, permanent, *griefing* lever, not just self-harm.

The consequences are loud (`reveal_queue_stalled` HIGH, `crank_failing` HIGH after three passes) and recoverable by **anyone** sending a reveal with a raised limit — but the shipped crank will never do it, so recovery requires a human editing code or hand-sending, every time, forever, under immutability.

**Evidence that would exist if I am right.** Re-run suite arm 10.4 against (a) a vault at the full 640-byte attribute budget and (b) the round-28 vault with the 10,150-byte Autograph, with a full 512-entry SlotHashes, **without** a `setComputeUnitLimit` instruction, and read `meta.computeUnitsConsumed` off the landed transaction. If either exceeds 200,000 the reveal fails with "exceeded CUs meter" and the FIFO head is stuck. Check `.cache/suite.log` for whether R28.A1's reveal carried a compute-budget instruction. Conversely, if both land under ~160,000 CU, this is a LOW margin note rather than a reachable grief.

**Fix.** One instruction, no fee change (a CU *limit* without a CU *price* does not change the fee), ~36 bytes of packet:
```js
new Transaction()
  .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
  .add(...ixs)
```
on at least the reveal and capture lanes, and on claim batches for the same reason (14 pairs extrapolated from a 6-vault measurement, plus up to 14 joins, up to 14 boost expiries and a possible in-line monthly distribution in one instruction). Add a both-ways arm: a worst-case reveal refused at the default and accepted at 400,000. Separately, limit 40's round-28 paragraph should say that an un-revealable vault halts the queue **for every later vault**, not only that "the owner cannot remove any owner-managed plugin from it" — the FIFO makes that cost collective.

---

### L1 — LOW: the crank splits revenue *after* it joins and expires, so ordinary traffic can run the in-line month over the pre-split pool, and the resulting under-distribution is swallowed as benign

**Construct.** `main()`'s send order is `… retireBurned → preJoins → expire('before') → split → distribute …`. `planCrank` nevertheless counts the split into the distribution it plans: `avail = available(pool.amount + splitToPool, owedAfterRetire)`.

Between the `expire('before')` batch landing and `split_revenue` landing there is a window (one or two confirmations) in which, on chain, `waiting_to_join == 0`, `boosts_due == 0` and the month is due. Any host instruction by anyone — a mint, a charter claim, an `activate`, someone else's `claim`, a redemption — runs `monthly_inline`, which credits `pool_balance − ceil(owed)` **excluding** the revenue we are about to split. Our `split_revenue` then lands, and our `distribute` is refused `MonthNotElapsed`, which is in `BENIGN` and is printed as *"done by other traffic, or not yet"*. The 85% just split therefore sits undistributed until the next month or someone's 100 $GARY burn, and `distribution_overdue` cannot fire because `last_distribute_at` is fresh.

**Gain.** Up to one pass's revenue (≈ an hour of sales) delayed by up to 30 days, invisibly. Nothing is lost.

**Evidence.** A crank log showing `ok split_revenue` immediately followed by `skip distribute: another distribution landed since the plan`, with a `CBOB_DISTRIBUTED path=monthly_inline` event whose `amount` equals the pool balance *before* that split.

**Fix.** Move `split` to the top of the pass (before `preJoins`); nothing in `split_revenue` depends on joins or expiries. Keep `planCrank` as it is — then plan and chain agree. Optionally distinguish `MonthNotElapsed` on an explicit `distribute` whose own planned `avail` was non-zero (log it as "under-distributed: revenue split after the in-line month").

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

Against the checklist: every fixed-forever value is in `WATCH` at CRITICAL (I checked the split, both destinations, `max_supply`, `level_caps`, `payment_mint`, `pob_root`, `pob_collection`, both charter bounds, `monthly_secs`, `notice_secs`, the three tighten bounds, `redeem_window_secs`, the three GOV tally values, `cbob_mint`, `max_boost_weight/epochs`); pending guardian and swap operator page CRITICAL at arm and standing; the PoB collection's plugins **and** update authority page CRITICAL; `redemptions_near_cap`, `pool_frozen`, `pool_insolvent`, `pool_unreadable`, `distribution_overdue`, `boosts_stalled`, `joins_stalled`, `launch_tick_overdue` all present; `detectUpgradeAuthorityAfterLock` loops all five programs including `sweep`, and `readConfigs` produces `prog.sweep.*`. `redemptionCapacity` reproduces BURN's ring arithmetic exactly (`ceil(live × 210/10000)`, floor 1, clamp 64 — and 64 ⇒ live ≤ 3,047 as SPEC says). The production list matches Gary's rulings.

I found one availability defect, and three "quiet" gaps.

---

### M2 — MEDIUM: one failed transaction read throws out of the whole alarm pass, so every finding already computed is discarded; the `tx_unreadable` machinery written for this case is unreachable

**Construct.** `bank/alarm.mjs`, the per-signature loop:

```js
for (const s of sigs) {
  if (s.err) continue
  const tx = await readParsedTransaction(conn, s.signature, { truncatedLogs: 'flag' })
  if (!tx) { unread++; findings.push({ kind: 'tx_unreadable', ... }); continue }
```

`readParsedTransaction` returns `null` **only** when the RPC answers `result: null`. Every other failure *throws*: an RPC error envelope (`getTransaction RPC error -32…`), a malformed envelope, or any `need()` refusal inside `validateParsedTransaction`. There is no `try/catch` in the loop, so the exception escapes `main()`, lands in `withLock(...).catch`, and the process exits 3 with `writeState` never called.

**What is gained / lost.** The pass has, by that point, already computed `config_drift`, `brake_pulled`/`brake_released`, `test_value_in_production`, `program_not_locked`, `pool_insolvent`, `pool_frozen`, `distribution_overdue`, `redemptions_near_cap`, `royalties_unswept`, `crank_silent` and the reserve-freeze findings. **All of them are thrown away.** The operator gets one non-urgent `cbob-vault-alarm:run_failed` email, which the router then suppresses for 12 h with a daily reminder, plus the deadman at >2 h of stale state. Detection is off until a human looks.

Reachability:
* **Transient:** ~8,000 serial `getTransaction` calls per pass against one provider. web3.js retries HTTP 429, not 500/503. A single 503 kills the pass. This is not exotic at that call volume; it is the expected steady-state failure.
* **Deterministic:** anything that makes `validateParsedTransaction` refuse the same bytes forever — e.g. a future transaction `version` the reader does not know, or a transaction whose stored `meta.logMessages`/`meta` is genuinely absent. The cursor can never advance past it, so the alarm is **permanently** blind with the page suppressed. The same shape exists one level up: `readConfigs` → `L.readPinned` throws on an unexpected config version, which (pre-lock) would blind the alarm forever.

I probed for an *attacker-constructed* refusal and did not find one, which is to the reader's credit: duplicate account keys are rejected on chain (`TransactionError::AccountLoadedTwice`, so the reader's uniqueness check matches the runtime); unknown instructions fall back to the raw form, which only needs base58 data and in-message accounts; every money-program parsed shape the reader insists on (`transfer`, `transferChecked`, `approve`, `approveChecked`, `initializeAccount*`, ATA `create`/`createIdempotent`) matches jsonParsed's actual fields; v0 lookup-table keys appear in `accountKeys` and are covered by `preBalances`. **So this is a reliability finding, not an attack.** It is nevertheless the one that decides whether the detection layer is up.

**Evidence that would exist if I am right.** Drive the source-extracted walk (exactly as `bank/selftest.mjs` already does) with a stub `_rpcRequest` that throws on the third signature: the extracted body rejects, `cursors` and `backlogs` are unchanged, and no findings are returned. In production: `/var/log/cbob/alarm.log` lines reading `CBOB VAULT ALARM FAILED TO RUN: getTransaction RPC error …` or `unreadable parsed transaction: …`, with no report above them, and `bank/state.json`'s `startedAt` unchanged across those passes.

**Fix (small, and it makes an existing control real).**
```js
let tx
try { tx = await readParsedTransaction(conn, s.signature, { truncatedLogs: 'flag' }) }
catch (e) { tx = null; why = e.message }
if (!tx) { unread++; findings.push({ kind: 'tx_unreadable', severity: 'HIGH', signature: s.signature,
  detail: `could not read ${s.signature} on ${id} (${why ?? 'not found'}); its instructions were NOT examined. The cursor stays where it was.` }); continue }
```
`unread` already blocks the cursor and the backlog advance, so coverage stays fail-closed while the pass still *reports*. Add the two arms (a throwing read and a `null` read both produce `tx_unreadable`, keep the cursor, and do not suppress the rest of the pass's findings). Separately, and independently useful: report the pre-walk findings before walking (or on their own notify pass), which is the half of round 31 L2 that was never repaired.

---

### L2 — LOW: nothing judges the boost volume, so the one on-chain symptom of the hot $CBOB release key (accepted limit 56) is read every pass and never looked at

**Construct.** `WATCHED_KEYS` includes `mint.boosts_active` and `mint.boosts_due`; `readConfigs` also produces `mint.boost_weight_total` and `mint.cbob_burned_total`. `WATCH` contains none of them, and no detector reads them except `detectDistributionOverdue` (`boosts_due` → `boosts_stalled`).

**Gain.** Limit 56's stated cost is that whoever reads `bank/keys/cbob-release.json` can "burn it to boost vaults they own, each by up to +12 weight … for up to 24 distributions", diluting every other vault's payouts. On chain that appears as a step change in `boosts_active` and `boost_weight_total` (and `cbob_burned_total`). Today it appears in no email. A silent 50% dilution of every distribution for 24 distributions is the materialisation of an accepted limit, and the accepted limit's mitigation section names only custody, never detection.

**Evidence.** Replay two snapshots with `boost_weight_total` going 0 → 240 and `boosts_active` 0 → 20: `detectConfigDrift` returns `[]` and no other detector produces a finding.

**Fix.** Add to `detectStandingRisks`/a new detector: page HIGH when `boost_weight_total` rises by more than a fraction (say 10%) of `total_active_weight` between passes, or when `boosts_active` rises by more than a few in one pass; drift-watch `mint.cbob_burned_total` at INFO so the burn total is in the digest. Both numbers are already fetched; this is a comparison, not a new read.

---

### L3 — LOW: the CBOB collection's **own** update authority is not watched, while the foreign PoB collection's is

**Construct.** `readConfigs` produces `pob_collection.update_authority` (CRITICAL on change) and `collection.plugins_hash`. `L.collectionPluginsHash` starts hashing at offset 33, i.e. **after** `key(1) | update_authority(32)` — so our collection's update authority is in no hash and in no watched key.

**Gain.** "Only MINT can put an asset into the CBOB collection" rests entirely on that authority being MINT's `["mint"]` PDA. No MINT instruction can change it, so today it cannot move without a Core defect or a pre-lock MINT upgrade — but the asymmetry is exactly the shape this project keeps finding (the foreign key is watched, the load-bearing one is not), and the downstream signal (`index_disagrees_with_chain`) only fires *after* a stranger has minted into the collection.

**Evidence.** Two snapshots differing only in the CBOB collection account's bytes 1..33 produce no finding from `detectConfigDrift`.

**Fix.** Produce `snap['collection.update_authority']` the same way `pob_collection.update_authority` is produced (`data[0] === 5`, `subarray(1,33)`), add it to `WATCH` at CRITICAL, and to the production list pinned to MINT's derived `["mint"]` PDA.

---

### Not findings (checked, and quiet for a good reason)

* `swap_operator_armed` / `guardian_armed` CRITICAL every pass for 7 days: level kinds, so the router emails once plus a daily reminder. Correct.
* Royalty between `MIN_SWEEP_LAMPORTS` (0.01 SOL) and `sweep_floor_lamports` (1 SOL) never pages `royalties_unswept`: disclosed in limit 7, and the revenue job does sweep it.
* The alarm cannot say *what* a new proposal proposes (`gov.proposal_count` HIGH is the only signal; no `Proposal` struct exists in `bank/layout.mjs`). Bounded by GOV's action set and by the CRITICAL at arm time. Worth an operator runbook line, not a finding.
* Undelivered-pass handling: `config`, `balances`, `cursors`, `backlogs`, `vaults`, `frozen`, `revenueSince`, `deferredSweeps` and `paged` are all restored from `prev`; `logGaps`, `seenSplits`, `seenSweeps`, `royaltySince` and `crankHealth` are not, and all four are additive or monotone, so nothing is lost. Correct.

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

**Sound, and the round-24 D6 gap is genuinely closed.** `bank/selftest.mjs` now maps all eleven `SEEDS` entries to the `*_SEED` constant of the program that declares them, asserts `Object.keys(L.SEEDS).length === 11`, and fails on a mistyped seed *or* one no program declares. I verified the five MINT/SEAL seeds against the bundled Rust by eye.

I recomputed `offsets('MintConfig')` and `offsets('VaultRecord')` by hand (above) and they agree with the pinned cross-program constants (141, 454) and with the sizes limit 49 and the suite quote (1005 + 256 padding; 211 + 10 padding = 221). Borsh has no alignment padding, so the computed offsets are the real ones. `parseRustStruct` is strict (throws on any line it cannot read as one `pub name: Type,`), so a private, `pub(crate)` or multi-line field cannot slip past, and the selftest proves both the "field added" and "type changed under the same name" directions.

One INFO-level note on the gate's reach:

### I1 — INFO: the "every pinned offset is compared" gate is a regex over `^const OFF_(\w+): usize = (\d+);`

A cross-program offset written as `pub const OFF_X`, under a different name, or as an expression (`8 + 32`) is invisible to the scrape **and** therefore to the "none scraped and ignored" completeness check, which only proves that everything the regex found was compared. Fix: widen the scrape to `^(?:pub )?const (OFF_\w+): usize = ([^;]+);`, evaluate literal arithmetic as the `judgeSpace` helper already does, and fail on any `OFF_` constant the regex cannot evaluate.

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

**Equal to the program's, line for line.** I checked each against `programs/cbob-vault-mint/src/lib.rs`:

| off chain | on chain | agrees |
|---|---|---|
| `credit`: `delta = avail*SCALE/w; owed += delta*w` | `credit` | ✓ |
| `pendingScaled`: `(w+boost)*acc + carry − debt`, throws if negative | `owed_of` + `checked_sub` | ✓ (and `carry` is added **before** the subtraction in both, which is what keeps a post-claim debt above `w*acc` from underflowing) |
| `ceilSats` | `ceil_sats` | ✓ |
| `available` clamped at 0 | `balance.checked_sub(owed)` then `> 0` | ✓ (the crank plans no distribution where the program would say `PoolShort`/`NothingToDistribute`) |
| `reweigh`: `carry = owed; debt = w_new*acc` | `reweigh` | ✓ |
| `debtAtActivation = w*acc` | `join` (`debt = w*acc`, `carry = 0`, level weight only — a pending vault cannot be boosted) | ✓ |

The crank's two special cases are also right: a vault joined earlier in the same pass is valued as `w*(acc_new − acc_old)`, and a vault expired earlier in the pass as `atExpiry + w_level*(acc_new − acc_old)` — which is exactly what the program leaves behind (`carry = atExpiry`, `debt = w_level*acc_old`).

**The expiry obligations hold.** `preExpires` is `dist_epoch >= boost_end_epoch` (the program's `BoostNotDue` boundary) and is sent before `distribute`; `postExpires` is `boost_end_epoch === dist_epoch + 1` and is sent immediately after; a burned boosted vault goes to `retireBurned` instead (and `retire` unschedules the boost, so `boosts_due` is decremented before the gate is evaluated). The alarm pages `boosts_stalled`, and `cbob_mint`, `max_boost_weight`, `max_boost_epochs` are CRITICAL-on-change. All as required.

No divergence found.

---

## R5. THE SWAP (`bank/swap.mjs`) AND THE REVENUE CYCLE (`bank/revenue.mjs`)

### (a) Oracle math — correct in every sign, and the floor really is below an honest fill

`sats = lamports × 10^-9 × 10^8 × (P_sol·10^es)/(P_btc·10^eb) = lamports·P_sol·10^(es−eb)/(10·P_btc)`. `oracleFloor` implements exactly that, putting `10^e` in the numerator for `e ≥ 0` and `10^-e` in the denominator otherwise — both branches correct; integer division floors `expectedSats`, and `minSats = floor(expectedSats × 9850/10000)`. Flooring makes the floor marginally *lower* (more permissive) by at most 1 sat, which is immaterial. `satsPerLamport` converts only `P_sol` (~1.2e10) and `P_btc` (~8.6e12) to `Number`, both far inside 2^53; no overflow, relative error ~1e-16. Sanity check with the real numbers: 120.45/85,929/10 = 1.402e-4 sats/lamport ⇒ 1 SOL ≈ 140,200 sats ≈ $120 at $85.9k. ✓

Against an honest fill: Orca's fee is 16 bps and a 10 SOL swap in a ~$10M pool has negligible impact, so 150 bps of headroom is ~9× the honest cost. The fork run's own numbers confirm it (Orca 1,410,051 vs expected 1,414,249 = 29.7 bps under; floor 1,393,035).

### (b) Pyth verification — offsets correct; ownership + derivation is sufficient; the clock is the chain's

I recomputed `PriceUpdateV2`: disc 8 + `write_authority` 32 ⇒ `verification_level` at **40**; `Full` is a 1-byte tag ⇒ `feed_id` at **41**, `price` 73, `conf` 81, `exponent` 89, `publish_time` 93. That is exactly what `readPyth` reads and what the selftest fixture writes. The length guard (101) covers every field read.

Can anyone write a chosen or stale price into the derived account? No: the account is the sponsored shard-0 PDA under the push-oracle program, is **owned by the receiver**, and the receiver only writes Wormhole-verified Pyth messages; `readPyth` additionally requires `verification_level == Full` and the expected `feed_id`. A *stale* write is prevented by the push oracle's "newer publish_time only" rule, and a withheld update is caught by the 180 s age check. The clock is the on-chain `Clock` sysvar, owner-checked (`SYSVAR_OWNER`) in `market()`, with an unreadable clock refusing the cycle and a `publishTime` more than 30 s ahead of it refused. I could not construct a route past this.

One structural protection worth recording, because it is load-bearing and undocumented: if the *feed id constants themselves* were wrong (a different asset's feed), `readPyth` would happily accept the matching account — but then both pools would deviate from the "oracle" by far more than 100 bps, `venues` would be empty, and the cycle would refuse to sweep. The deviation gate is the cross-check on the pins, and the fork's SW.0 is its test. Fail-safe.

### (c) The deviation filter — right quantities, right directions

`orcaSpot = (sqrt_price/2^64)^2` is token-B-per-token-A in raw units, i.e. sats per lamport, with A = wSOL and B = cbBTC as `readWhirlpool` enforces. `meteoraSpot = (1 + bin_step/10^4)^(−active_id)`: Meteora's price is Y-per-X raw = lamports per sat with X = cbBTC, Y = wSOL as `readLbPair` enforces, so the inverse is sats per lamport — the reversal versus Orca is handled, and both land on the oracle's 1.40e-4 (I checked with `activeId = 5920`, `binStep = 15`: 1/1.0015^5920 = 1.399e-4). Double-precision error is ~1e-13 relative against a 1e-2 gate; floating point cannot pass a pool it should refuse.

I independently re-derived both account layouts rather than trusting the comment. Whirlpool: `tick_spacing` 41, `fee_rate` 45, `liquidity` 49, `sqrt_price` 65, `tick_current_index` 81, `mint_a` 101, `vault_a` 133, `mint_b` 181, `vault_b` 213 ✓. LbPair: `StaticParameters` (2+2+2+2+4+4+4+4+2+1+5 = 32) then `VariableParameters` (4+4+4+4+8+8 = 32) ⇒ `active_id` at **76**, `bin_step` 80, `status` 82, `token_x_mint` 88, `token_y_mint` 120, `reserve_x` 152, `reserve_y` 184 ✓. Both match the code exactly.

### (d) The minimum out — the same floor, in the right units

`guaranteed = m2.f.minSats` is taken from the **same** `market()` read whose deviation filter produced `m2.venues`, and is what both the Orca `other_amount_threshold` (data[16..24]) and the Meteora `min_amount_out` carry, both of which are output-token base units (sats) for an exact-input swap. The judge is told the same `minSats` it must find in the bytes. ✓

### (e) The judge — complete for every value-moving role; one residue is accepted

`judgeSwapInstructions` pins the exact seven-instruction sequence and, specifically: the CU limit's exact bytes and empty key list; both ATA creations' full six-key lists (payer = owner, account = `ata(mint, owner)`, owner, mint); the System transfer's exact key pair and `lamportsIn`; SyncNative's single key; the swap's discriminator, length, `amount`, `minSats`, and for Orca the `sqrt_price_limit`/exact-input/`a_to_b` bytes; the pool at its pinned index, **the input account at index 3 (Orca) / 4 (Meteora) and the output account at index 5 on both**, the signer slot; one close, last, back to the owner; no Token instruction but SyncNative and that close; no `setComputeUnitPrice` anywhere; no second signer; no foreign program. I checked the account orders against both programs' published interfaces (Orca `swap`: token_program, authority, whirlpool, owner_a, vault_a, owner_b, vault_b, ticks 0-2, oracle; Meteora `swap`: lb_pair, bitmap?, reserve_x, reserve_y, user_token_in, user_token_out, mint_x, mint_y, oracle, host_fee_in?, user, token_x_program, token_y_program, event_authority, program) — the indices the judge pins are the right ones.

What it does **not** check — the pool-owned liquidity accounts (vaults, tick/bin arrays, oracles, bitmap, event authority) — is covered by the venue programs' own constraints (`address = whirlpool.token_vault_a`, `has_one = whirlpool`, mint checks against the pool), so a tampered builder cannot redirect value there; it can only make the swap fail. The residue is the one limit 10 already accepts: whoever can edit `bank/swap.mjs` can edit the judge. Post-signing, `revenue.mjs`'s `delta < guaranteed` throw is the backstop.

### M3 — MEDIUM: `market()` validates prices and spot prices but never checks that the venue can actually execute, so the SOL is swept before anything can discover that neither pool is usable

**Construct.** `SW.market()` reads exactly six accounts: the two pools, the two Pyth accounts, the Meteora bitmap and the Clock. It never reads:

* **Orca's three tick arrays** (`orcaTickArray(s0)`, `(s0 − span)`, `(s0 − 2·span)`). Whirlpool's `swap` declares all three as `#[account(mut, has_one = whirlpool)] AccountLoader<'info, TickArray>`, so **every one must already be initialised even if the swap would never cross into it** — an uninitialised account fails Anchor's owner/discriminator check. Two of the three are *below* the current array: with tick spacing 16 that is up to ~30% below spot, a region that is initialised only if the price has traded there or an LP opened a position spanning it.
* **Meteora's three bin arrays** (`[i, i+1, i+2]`), which `lb_clmm` deserializes as zero-copy `BinArray`s with an `lb_pair` match — same consequence.
* **`p.status`**, which `readLbPair` *reads and discards*. A disabled pool (status ≠ 0) passes the deviation filter and is refused by the program.

`revenue.mjs` decides to sweep on `m1.venues.length`, so a venue that prices perfectly but cannot execute counts as usable. The sweep lands, then the Orca swap is refused at preflight (`classifySendFailure` → `refused`, correctly), then Meteora is refused the same way, and the job throws *"every pinned venue refused the swap … SOL is on the operator key and must be swapped by hand"* — an **open cycle**, every cycle, until someone changes code.

**Gain.** No theft and no loss: the SOL is on the operator key and the failure is loud (`cbob-revenue:swap`, then `unreconciled_swap` CRITICAL an hour later, and the next run refused at the open-cycle guard). The cost is that an *ordinary market condition* — liquidity having never been opened two arrays below spot, or Meteora disabling a pool, or a venue interface change — forces repeated use of the **hand recovery path**, which limit 10 itself identifies as the only path that can double-swap. It converts "the automatic path cannot double-swap" into "the automatic path refuses and hands every cycle to the risky path".

Why no existing gate catches it: `sim/swap-fork.mjs plan` clones only accounts that **exist** (`want.filter((_, i) => infos[i])`), so the fork can never be in the failing state, and the 16 fork assertions therefore certify today's mainnet liquidity shape, not the invariant.

**Evidence that would exist if I am right.** On a mainnet fork, drop one of the three Orca tick arrays from the clone list (or zero its owner): `SW.1` flips to REJECT with an Anchor `AccountNotInitialized`/`ConstraintHasOne` error while `SW.0` still passes (both pools price within 100 bps). A production trace would show `revenue.log` lines: `oracle: … usable venues: orca, meteora`, a confirmed `sweep_sol_for_swap`, then two preflight refusals naming a tick/bin array, then the open-cycle throw.

**Fix (in order of strength).**
1. **A simulated canary before the sweep.** In `market()` (or just before the sweep), build `swapInstructions({ venue, lamportsIn: 1_000_000, minSats: 1n, … })` and `simulateTransaction` it with the operator's existing float as the funding source. That exercises the *entire* account set, the pool status, and any venue interface change, for zero cost and no signature; a venue whose canary errors is `unusable`. This also subsumes the next item.
2. Failing that, fetch the three tick arrays and three bin arrays in `market()`'s existing `getMultipleAccountsInfo` call (it already fetches the bitmap for exactly this reason) and require each to exist and be owned by the venue program; require `p.status === 0`.
3. Either way: keep the "no usable venue ⇒ do not sweep" path, which already exists and is correct — royalties then accumulate and `royalties_unswept` pages, which is the right failure.
4. Add both-ways selftest arms with the existing stub connection: one array returned as `null` ⇒ that venue absent from `venues`; all present ⇒ both venues usable.

### (g) wSOL handling — correct, including the hostile cases

Wrap is exactly `lamportsIn`; a pre-existing balance (a stranger's dust, or residue) survives `SyncNative`, is **not** sold (the swap's `amount_in` is `lamportsIn`), and is returned to the operator by the final `CloseAccount` along with the rent — which is legal for a native account, as round 31 measured and as I re-derived from `process_close_account`. A frozen wSOL ATA is impossible (no freeze authority on the native mint). A delegate is irrelevant (the swap and the close are under owner authority). An ATA created by a stranger *for the operator* is the same address with the same owner. Nothing is left wrapped: the close is mandatory and the judge requires it to be last.

### (h) Failure and retry — sound, with one operational trap

The venue loop advances only on `outcome === 'refused'`, which requires a preflight refusal, a landed-with-`err` status, **or** `TransactionExpiredBlockheightExceededError` with no status (and an expired blockhash cannot land later). Anything the chain cannot settle is `unknown`, which records a `pendingSwapSig` candidate and throws with the cycle open. `cycleIsOpen` is the single predicate everywhere (`--audit`, the guard, the alarm). The ledger is never closed on a return alone — only on a split — and the recovery path closes a cycle only against a chain-visible split that is at or after the return's **block time** and at least as large. I could not construct a double swap, a double count, or a cycle read as closed.

The trap: because the judge **forbids a compute-unit price**, the swap can never be prioritised. Under congestion both venues will expire-unlanded, which is classified `refused`, and the cycle ends open with SOL on the hot key — the same hand path as M3. A bounded price (e.g. a cap expressed in lamports, judged against `lamportsIn`) would remove it without reopening the drain the round-25 repair closed. Recorded as an option, not filed as a separate finding.

### (i) What an adversary can extract within the tolerance

* **Per cycle:** the on-chain floor is `expected × 0.985`, so the maximum any combination of sandwich, edge-of-gate pool and accepted-but-skewed oracle can take is **150 bps of the swap**, minus the honest 16 bps fee and impact ⇒ ~134 bps ≈ **0.134 SOL on a 10 SOL cycle** (~$16 at $120/SOL). The 100 bps read-time gate adds nothing against a sandwich (it is read, not executed, as SPEC says); its value is against a *persistently* mispriced pool.
* **Per month:** throughput is capped at 10 SOL per 6 h ⇒ ≤ 40 SOL/day ⇒ ≤ 1,200 SOL/month, so ≤ **18 SOL/month** (~$2,200) *if every cycle is maximally extracted*. A sandwicher on Orca must actually move a ~$10M pool 150 bps and back to collect that, which costs them fees and inventory risk on each of 120 cycles; on Meteora (~10× thinner) the capital cost is lower but so is the per-cycle prize. Realistically the extractable value is a small fraction of that bound.
* **The oracle leg:** each USD feed must be ≤ 180 s old with confidence ≤ 30 bps (measured live at 1.0–1.5 bps). A stale-but-accepted pair at the 180 s edge adds whatever SOL/BTC moved in 180 s — unbounded in principle, bounded in practice to tens of bps, and *not* bounded by any check. SPEC states this honestly ("These checks do not establish a hard bound on deviation from the true SOL/cbBTC market price").
* **Is it material?** At 1,200 SOL/month of royalties the worst case is 1.5% of royalty revenue, i.e. ~1.3% of the holders' 85% of royalties only (mint prices never touch this hop). Compared with the operator key's own disclosed exposure (10 SOL per 6 h until the guardian stops it), the swap tolerance is second-order. **The cycle size does not make it material.**

### The operator key's worst case, restated for the new trust set

What it can take is unchanged by the Jupiter removal: royalty SOL at the on-chain cap × cooldown windows until `emergency_stop_sweep`, never more than the revenue PDA holds above the reserve, never cbBTC, never the pool, never a vault. What it now *trusts* is two pool programs plus Pyth's two programs (four live third-party upgrade keys, watched HIGH), one RPC endpoint, and the integrity of two files in this tree. I confirm the ledger still cannot read a failed cycle as closed: `cycleIsOpen` requires `returnedSats > 0` **and** a split, `sendRejected` closes only rows with no `sweepSig`/`sweptLamports` (and a row with both is `rejected_row_has_sweep` CRITICAL), and a sweep the chain shows with no row is `unledgered_sweep` CRITICAL.

---

## R6. THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

The floors are equalities, not lower bounds, so deleting work fails. I looked specifically for assertions that cannot fail and for vacuous-on-empty checks and found the gates in better shape than the code: `routerRun` returns a sentinel string that fails the comparison if the router is missing; `wiringGate`, `pinDiff`, the `L7` id-mutation arm (`[14, true]` — adding a copy site changes the count) and the installer arms all carry planted-positive controls; the DAS-reader discovery is guarded against discovering nothing; `signerSet(null)` is an exact two-element equality.

Two gaps:

### L4 — LOW: the stated-count gate does not cover the expiry-budget floor, and that floor is stored twice with nothing comparing the copies

`bank/selftest.mjs`'s `RX` map covers on-chain, detector, allocation, poster, mainnet, launch, pob, sim and swap — **not** expiry-budget, although `SPEC.md`'s "Running the tests" block states "4 expiry-budget assertions". And `EXPIRY_FLOOR=4` in `scripts/run-tests.sh` duplicates `assert.equal(count, 4, 'expiry assertion floor')` inside `tests/expiry-budget.mjs`, with no cross-check of the kind the file already applies to `DET_FLOOR` vs `const FLOOR` ("a fact stored twice is a fact that will disagree; if it must be stored twice, the disagreement must be red"). `HOST_FLOOR = 6` is likewise compared to nothing.

**Fix.** Add `'expiry': /(\d+) expiry-budget\b/g` to `RX`, scrape `assert.equal(count, N` out of `tests/expiry-budget.mjs` and assert it equals `EXPIRY_FLOOR`, and state the host count in SPEC (or stop stating counts the gate does not read).

### L5 — LOW: `build-mainnet.sh` proves the *sweep* helper's bytes are the bytes the suite deployed, and proves nothing of the sort for the other four

Round 25 N6 added `cmp "$OUT/cbob_vault_sweep.so" "$ROOT/target/deploy/cbob_vault_sweep.so"` — "the file the suite actually deployed". The four initializing programs get no such comparison: step 4's behavioural control runs the **freshly rebuilt** `$CACHE/ln/...` artifacts, while the suite deployed `target/deploy/*.so`. The script prints the `target/deploy` sha256 under a banner that calls them "the five programs as the suite and the sim DEPLOYED them", which is true of the print and not of the proof. One of five sites, again.

**Fix.** `cmp -s "$LN_DIR/$f.so" "$ROOT/target/deploy/$f.so"` for all five, dying with the same message; or record the commit at which `target/deploy` was produced and require it to equal `$COMMIT`.

### `scripts/cron-install.sh` — arms nothing it should not

Verified: six tagged jobs; `--live` preserved for crank and revenue only from **our tagged, uncommented, end-anchored** line (the selftest executes the real shell for both directions, including the round-24 L12 `--live --reveal-only` flag-order trap); the rehearsal marker is checked before `crontab -l`, `sudo` or any write, and the rehearsal tree's substitution of the repo root makes that check point at the rehearsal copy; locks live in `$R/bank/locks`, not the tmpfs `/var/lock` and not `$LOGDIR`; logrotate runs `su ubuntu ubuntu` with `copytruncate`; the deadman is plain `test`/`find`, fires on a *missing* state file, and has its own stream. The posture print is computed from the crontab actually written.

One cosmetic note: with no network, the last command executed in `run-tests.sh` is `[ "${CBOB_SHIP_GATE:-0}" = "1" ]`, so the script exits **1** after printing SKIPPED. That is the safe direction (an offline run cannot be claimed as a pass), but it is accidental rather than designed; an explicit `exit 0`/`die` would say which was meant.

---

## The four questions about the ACCEPTED LIMITS

### 1. Is any limit worse than stated?

**Yes, three.**

* **Limit 10 (the swap hop) is worse than stated in frequency, not in amount.** Its runbook frames the hand path as the response to a crash or a confirmation timeout. **M3** adds a routine cause — uninitialised tick/bin arrays, a disabled Meteora pool, a venue interface change — that no detector anticipates and the fork test structurally cannot see, and which recurs on **every** cycle until code changes. The judge's refusal of any compute-unit price adds a second routine cause (congestion ⇒ both venues expire ⇒ `refused` ⇒ open cycle). Limit 10 should say: *the automatic path refuses rather than double-swapping, and ordinary market or network conditions can force the hand path repeatedly; that path is the only one that can double-swap.*
* **Limit 7 / the "survivable rather than silent" claim is worse than stated for the alarm.** SPEC's reader boundary says a refusal means "scanners keep their cursors, and the alarm reports a failed pass". **M2** shows the pass does not *report* — every state-derived finding already computed in that pass is discarded, and a deterministic refusal (or an unexpected config version pre-lock) is permanent blindness behind a 12-hour-suppressed email plus the deadman. The round-31 "Scan backlog boundary" paragraph's 16–52 minute bound silently assumes the walk completes.
* **Limit 56 (the hot $CBOB release key) is worse than stated in observability.** Its cost paragraph is accurate; nothing in the pipeline judges the on-chain symptom (**L2**), although `boosts_active`, `boosts_due`, `boost_weight_total` and `cbob_burned_total` are already fetched every pass. The limit reads as "custody is the only control"; in fact *detection* is also absent, and it is three lines of code.

Two limits I checked and found correctly stated (not worse): limit 32's ring arithmetic and its 3,047 bound; limit 35's 10.71% ("the turnout rule never binds") — 0.51 × 0.21 = 10.71% exactly; limit 36's list of in-line-month skip conditions matches `monthly_inline` branch for branch; limit 46's 33-bytes-per-extra-account packet arithmetic; limit 49's 221 bytes and 1,772,920 lamports.

### 2. Is anything listed as a limit not actually a limit, or already closed?

Nothing is *falsely* listed, but two are closed further than the text admits:

* **Limit 44's "nested Core assets" half is now the only genuinely destructive case for classic tokens**, which round 25 D7 already recorded; the text is current.
* **Limit 29 ("Only cbBTC splits")** is complete and I confirm it: `split_revenue` pins `mint == payment_mint`, and the revenue PDA signs nothing else except `sweep_sol_for_swap` (SOL only). A foreign SPL token sent to a revenue-PDA-owned account is stuck forever. Still a real limit.
* **Limit 10's "(b) THE ONE RPC ENDPOINT"** deserves promotion in prominence rather than removal: with **M2**, that single endpoint is also the single point of failure for *all* detection, not just for the swap's pricing.

### 3. Is any DISCHARGED item not actually discharged?

* **Item 51 (the $CBOB boost): discharged correctly.** I verified every claim in its text: `reweigh`/`pendingScaled` mirror the program; the crank expires before and after; the alarm pages `boosts_stalled` and watches the mint and both ceilings as fixed-forever. The only thing missing is boost-volume detection, which item 51 never claimed (see L2).
* **Item 54 (compute at the widest host shapes): discharged on a measurement whose worst case is not the worst case.** Its "the bank's crank is unaffected" rests on a reveal at **150,344 CU** — 75% of the default — measured on suite vaults, while MINT itself permits 640 bytes of attributes and Core permits an owner-grown plugin region that round 28 measured at 10,150 bytes. **M1** names the measurement that settles it. Until that measurement exists, the discharge is conditional, and the condition is holder-controlled.
* **Items 12/17, 14, 19, 30, 31, 33 and the v5 Bank family: discharged correctly** as far as this bundle lets me check (19 in particular is closed *by construction* — `activate` refuses `NotRevealed`, so no activated-but-unlevelled state exists).

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

No — but one is being treated as *smaller* than it is, and one is drifting.

* **Item 22 is being honoured** (the crank is installed dry-run; the revenue job is opt-in; SPEC names the five rehearsal pass/fail items). **M3** adds a sixth item that the rehearsal must cover: *a cycle in which a venue's liquidity accounts are deliberately absent, proving the job refuses to sweep rather than sweeping into an unexecutable swap.*
* **Item 50 is the load-bearing one and it is still fully open.** Nothing in this round changed that, and the holder guide's present-tense promises ("The Bank's pages show it", "Every opening is public. It is announced on X and on the Bank's website", "the redeem page offers this and does the steps for you") remain false until it ships. The guide's own DRAFT marking plus item 50's publication bar covers this, so I do not file it; I note that the bar is the only thing standing between those sentences and a holder reading them.
* **Item 53's "still to write" list (`launch/rehearsal-init.json` and a rehearsal mode for `check-launch-params.mjs`) does not exist in this tree.** It is correctly filed as open; it is also a precondition of item 22, which means item 22 cannot be started today. Worth stating in the road table rather than leaving implied.
* **Item 38's two OPEN values (`charter_opens_at`, `lock_deadline`) are still null in `launch/mainnet-init.json`,** and `check-launch-params.mjs` correctly refuses. Its round-24 A6 residue — the checker validates the JSON, not the signed transaction — is unaddressed, and no script builds the four `initialize` transactions *from* that file. That is the single highest-leverage unbuilt gate in the project, because every value it covers is permanent.

---

## Anything else

* **`bank/txread.mjs` is unusually well hardened** and I want to record what I failed to break, so the next reader does not redo it: duplicate account keys are rejected on chain (`AccountLoadedTwice`), so the uniqueness check matches the runtime; unknown instructions of known programs fall back to the raw form, which only needs in-message accounts and base58 data; every parsed shape the reader insists on matches jsonParsed's real fields for classic Token, Token-2022, System and ATA; v0 lookup-table keys appear in `accountKeys` and are covered by `preBalances`; the `Log truncated` marker is distinguished from a program's own log text (the R28.M1 arm). I found no attacker-constructed transaction that the reader refuses deterministically. That is what makes **M2** a reliability finding rather than a grief.
* **One future-proofing note:** the reader accepts `version ∈ ['legacy', 0, 1]`. If Solana activates v2 while the programs are immutable, every v2 transaction naming one of our programs throws, and by **M2** the alarm dies permanently. Fixing M2 converts that from "blind" to "flagged gap", which is the whole point of the round-29/30/31 repair line.
* **`sim/swap-fork.sh`'s `SWAP_FLOOR=16` equality** is enforced and SPEC's stated 16 is gate-checked. The fork's SW.0 is doing more work than its name suggests (it is the only check that the Pyth feed ids are the *right assets*); that deserves a sentence in SPEC so nobody "simplifies" it.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Nine things this process structurally cannot do. They are ordered by what I would refuse to launch without.

1. **Run the dress rehearsal (item 22), with a stopwatch on the hand recovery.** I can read `revenue.mjs` and tell you the state machine is sound; I cannot discover that Helius returns a 503 on read 4,112 of 8,000, that `getProgramAccounts` on 2,100 records takes 11 s and trips a plan timeout, or that the forced post-sweep recovery takes a human 90 minutes at 3 a.m. and that step 4 of the runbook is ambiguous. **Add to the named list: one cycle where a venue's tick/bin arrays are deliberately absent (finding M3), and one where a single `getTransaction` is made to fail mid-pass (finding M2).** Record signatures for every item.
2. **Make the custody decisions that close limits 10(3) and 56.** The swap-operator key and the entire unreleased $CBOB supply sit on the same box, under the same user, as the ledger, the crontab and the alarm. No amount of code review changes that. Moving the $CBOB supply to Gary's wallet or a Squads and deleting `bank/keys/cbob-release.json`, and putting the operator key behind a signer that is not the box owner, are the only real fixes, and they are rulings, not findings.
3. **Decide the Moments key's custody for the 7-day charter window (limit 46).** This is the one exposure that can end the project before it starts or capture the entire electorate permanently. Keeping it hot is a ruling I am told not to argue; what AI cannot do is sit with the consequence and choose. If the ruling stands, at minimum: a second pair of eyes watching that collection every few minutes for the whole window (the alarm samples it every 30 minutes and cannot see per-asset plugins), and a pre-agreed response.
4. **Commission an independent reproducible build and compare it to the deployed bytes, publicly.** `build-mainnet.sh` honestly says what it does not prove ("that the compiled constant IS that key"). The bridge is a second party rebuilding from the published commit on different hardware and publishing matching sha256s, then a third reading the on-chain ProgramData hash. Nothing in this process can attest to a binary.
5. **Provision an off-box, second-provider witness.** Every control in R2 runs on one host, as one user, through one RPC endpoint. A ten-line independent watcher elsewhere — reads `prog.*.upgrade_authority`, `mint.split_bps`, `mint.guardian`, the pool balance against `owed_scaled`, and the alarm's own state-file mtime, and emails a different address — breaks the single-point-of-failure that limit 10(3) and finding M2 share. AI can write it; only a person can put it somewhere else.
6. **Build the holder surfaces (item 50) and then watch a real person use them with a real wallet.** `judgeRedemptionCoverage` is a pure function with no page; the sweep helper has no caller; the poster has no sender. Until a human redeems a vault holding a stray token through the actual page, on a phone, with a wallet that may silently drop a compute-budget instruction (item 54's own warning), the redemption contract is a document, not a path.
7. **Run the `initialize` ceremony from `launch/mainnet-init.json`, with witnesses and a read-back.** Round 24 A6 is unclosed: the checker validates the JSON, nothing builds the transactions from it, and the programs check less than the checker does. Write the builder *and* a post-initialize read-back that diffs every on-chain field against that file, and run the read-back **before** removing the upgrade authority. Two numbers (`charter_opens_at`, `lock_deadline`) are still null and only Gary can set them.
8. **Buy adversarial attention with incentives.** Twenty-one v5 rounds plus eleven v6 rounds have converged on the monitoring layer because that is where the youngest code is, and a third of AI "CRITICAL"s were wrong. A small canary deployment holding real (modest) Bitcoin for a fixed period, with a published bounty, is the only mechanism that recruits attackers whose payoff is finding what thirty-odd readers did not. Immutability makes that spend cheap by comparison.
9. **Fuzz the Core boundary that round 28 could only sample.** SPEC says the round-28 heap results are "bounded observations … not a proof for every plugin shape or size combination", and finding M1 shows the FIFO turns any un-revealable vault into a global halt. That calls for machine time over a human-chosen space of plugin shapes and sizes on a validator with the pinned binary — hundreds of combinations, each reveal measured for CU and for success — not another reading pass.

And one thing to do *before* the next round rather than after: **fix M2 first.** Of everything here it is the cheapest change with the largest effect, because every other control in this system reports through the pass that it currently discards.