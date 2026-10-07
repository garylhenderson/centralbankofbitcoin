# Round 33, OFF-CHAIN pass — independent audit of the whole tree at `ec4a0e1`/`18dbff6`

Method: every bundled file read in full; every arithmetic, offset, seed, account order and instruction byte the off-chain code must agree with recomputed by hand against the bundled MINT source and the published Orca/Meteora/Pyth layouts; every round-32 repair located at its site and traced in both directions. No tool was run; where a claim below depends on a measurement I say exactly what the measurement is.

**Result: NOT CLEAN at LOW. No CRITICAL, HIGH or MEDIUM. Two LOW defects, four INFO.** The round-32 repairs are present and work as described, with one residual in the L1 repair that round 32's own arm cannot see.

---

## R0. Round 32's verdict and its repairs

| R32 item | Verified at this tree | Residual |
|---|---|---|
| L1 `detectSweepState` | Present (`bank/detectors.mjs`), wired in `alarm.mjs` after the walk, baseline persisted and rolled back on non-delivery (`next.sweepJudgedThrough = prev?.sweepJudgedThrough ?? null`). One-sided window, cooldown-aware. | **F1 (LOW) and F2 (INFO) below.** |
| L2 per-transaction `tx_unreadable` | Both the listing (`walkSigs` in `try`) and the read (`readParsedTransaction` in `try`) are caught; `unread++` holds the cursor; `looked.programs++; continue` keeps the other three programs walking. | **F3 (INFO):** a held cursor re-reads the same window next pass, and one-shot findings on those transactions are paged a second time with a new pass stamp; `deferredSweeps` is appended without dedup on the delivered path. Loud direction only. |
| L3 `detectLogGaps` never evicts unreviewed | Correct: `reviewed = all.slice(0, at+1).slice(-max(1, 500-unreviewed))` keeps the watermark; unreviewed is never sliced; CRITICAL above 2,000. | None. |
| L4 coverage gate | `first_line_quorate` is anchored to the credited focus; `bundles()` fails closed on an unrecognised FOCUS header. | None found by reading; not executed. |
| D1 expiry count | `RX.expiry` added; cross-check to `EXPIRY_FLOOR` added. | None. |
| D2 "LAST signature listed" | Text corrected. The array order is still walk order (newest first per program, older appended on a drain); the instruction now matches the array, not time. | None. |

Round 32's measurement limits are honest (stub clusters, no fork for C03). I found no claim in the verdict contradicted by the tree. Its C14 statement that "the judge's unpinned Meteora optional keys are validated by the venue" is only partly true (F5).

---

## Findings

### F1 — LOW — `detectSweepState` compares a BOX wall-clock stamp with the CHAIN clock, the one domain mix round 28 removed everywhere else

**Construct.** `bank/detectors.mjs` `detectSweepState`: `t = Number(lastSweepAt)` is MINT's `last_sweep_at`, written from the on-chain Clock sysvar (`sweep_sol_for_swap`: `c.last_sweep_at = now` where `now = Clock::get()?.unix_timestamp`). `st = Date.parse(c.startedAt) / 1000` is `revenue.mjs`'s `new Date().toISOString()`, the box wall clock. The explanation window is `t >= st - 120 && t <= st + after`.

**What it does.** Round 28 established (and the selftest pins, "R28 clock: actual alarm retains separate clocks under ±7h skew") that the alarm never compares `wallSec` to `nowSec` directly; `cycleStartMs` explicitly "translates its age into the caller's wall-clock domain, never compare the two clocks". This detector compares them with a 120 s tolerance in one direction. If the box clock is more than 120 s ahead of the chain's `unix_timestamp` (a box with NTP broken, exactly the box state round 25 L2 worried about), every honest sweep pages `sweep_unledgered_state` CRITICAL (one-shot, urgent) telling the operator the key "is being used by someone else". If the box is behind the chain by more than `after` (3,600 s at the ruled cooldown), honest sweeps are also unexplained, but that skew is implausible. The direction of the error is a false CRITICAL, not a silent thief; it is a LOW because its text instructs the guardian to consider `emergency_stop_sweep`, and a CRITICAL that fires on every honest cycle is the one the project's own history says gets scrolled past.

**Evidence if true.** On the dress-rehearsal box, set the clock 3 minutes ahead (`date -s` or `faketime`), run one honest `revenue.mjs --live` cycle, run the alarm 15 minutes later: `sweep_unledgered_state` CRITICAL is emitted for a sweep whose row carries `sweepSig`.

**Why the gate did not catch it.** The round-32 arm (`R32 L1: a sweep seen in account state is explained only by...`) builds `startedAt` as `new Date(st*1000)` with `st` in the same numeric domain as `T`, so it cannot express a skew between the two clocks.

**Fix.** The alarm already has both clocks in `main()`; pass `nowSec` and `wallSec` and judge `st + (nowSec - wallSec)`, or, better, anchor on the sweep's chain block time when the walk has seen it (`seenSweeps[sig].blockTime`, the way `cycleStartMs` does) and fall back to the translated wall stamp only when it has not. Add an arm with `startedAt` stamped 300 s ahead of the chain `t` under a +300 s wall offset: explained; and the same row with no offset: unexplained.

### F2 — INFO — An OPEN cycle's `pendingSweepSig` explains a sweep that may not be its own

`detectSweepState` treats a row with `pendingSweepSig` (an uncertain send, round 26) as a sweep that "landed". When the honest job's sweep send times out AND the transaction never lands (the status lookup threw, so `classifySendFailure` said `unknown`), the row is open, `last_sweep_at` did not move, and the cooldown is free. A thief's sweep within `[st-120, st+3600]` of that row's `startedAt` is then explained by it. Bounded: the open intent row pages `unreconciled_swap` CRITICAL after 60 minutes regardless, the transaction walk pages `unledgered_sweep` for the thief's signature (unless flooded, the L1 premise), and the hand recovery's first step (look up the candidate's status) shows the honest candidate never landed while `last_sweep_at` moved. Worth a sentence in SPEC limit 10's round-32 paragraph: the state check is masked for one window after an honest UNCERTAIN sweep as well as during alarm downtime.

### F3 — INFO — Held cursors re-page one-shot kinds and duplicate deferred sweeps

`alarm.mjs`: when `unread > 0` the cursor and backlog hold, so the next pass re-reads the same window. Findings from the transactions that WERE read (`approve`, `bare_core_burn`, `unledgered_sweep` after grace) are one-shot kinds whose text carries the pass stamp, so each re-read emails again. `detectUnledgeredSweeps` also pushes a fresh sweep into `deferredSweeps` on every re-read, and on the delivered path `next.deferredSweeps = dsw.keep` is not deduplicated (the undelivered branch is), so when it ages past the grace it can produce two identical `unledgered_sweep` findings. Loud direction; dedupe `deferredSweeps` by `sig` on both paths.

### F4 — LOW — The reveal lane's liveness depends on the pinned mpl-core JS deserializer accepting every plugin an owner may attach to the FIFO-head vault

**Construct.** `bank/crank.mjs` `mintedAttributes` uses `deserializeAssetV1` from `@metaplex-foundation/mpl-core` to read the Attributes plugin. Umi's enum deserializers throw on an unknown discriminant. A vault owner may add owner-managed plugins (round 28 proved Autograph, FreezeDelegate etc. land), and Core is upgradeable by Metaplex (limit 40). If the asset at `revealed_total` carries a plugin or external-adapter variant the pinned JS does not know, `mintedAttributes` throws, the crank logs `skip reveal ... could not read its attributes` and `break`s, every minute, forever. Because the FIFO is strict, no later vault can be revealed or activated by the crank. Note the program needs no parser (it checks a hash), so the queue is cranked by anyone who writes a minimal parser; the automatic lane is what stops.

**What the alarm sees.** `reveal_queue_stalled` HIGH after one 30-minute pass (level). The crank itself does not page: a parser failure is a `skip`, not a `failure`, so the `cbob-vault-crank:reveal` stream stays clean while the lane is dead. Limit 25's accepted re-roll class does not apply (the capture still happens; only the reveal stalls), but every mint behind it waits.

**Evidence if true.** Build an AssetV1 byte image with a plugin registry record whose type byte is outside the pinned SDK's `PluginType` enum (or set `deserializeAssetV1` against the R28.A1 asset after mutating one registry byte) and call `mintedAttributes`: it throws; `planCrank`'s reveal list is unaffected but `main()` breaks before sending.

**Fix.** Read only what the reveal needs with a minimal, dependency-free parser: AssetV1 base fields, then the plugin header's registry offset, then the `Attributes` registry record and its Borsh `Vec<(String,String)>`. That is the same bytes `attrs_hash` was computed from, and `judgeRevealAttrs` already fails closed on any disagreement. And make N consecutive skips at the same `mint_index` a `failure`, so the reveal lane pages itself.

### F5 — INFO — The swap judge leaves Meteora key 9 (`host_fee_in`) and key 1 (bitmap) unpinned

`judgeSwapInstructions` pins keys 0, 4, 5, 10 of the Meteora `swap` and relies on the venue for the rest. `host_fee_in` is a referral account that receives a share of Meteora's PROTOCOL fee; a tampered builder could name a stranger's wSOL account there. It never touches the user's output (the floor still binds), so no holder value is at risk, and it is inside limit 10's box-owner residue anyway; pinning key 9 to `METEORA.program` costs one line and closes the only unpinned account that receives value. Key 1 is a pass/fail account (wrong → refusal → fallback).

### F6 — INFO — The effective per-cycle adversarial bound is about 250 bps, not 150

See R5(i). Disclosed loosely ("further if Pyth's own price is off"); the number can be stated.

---

## R1. The crank (`bank/crank.mjs`)

Everything the planner sends was checked against the MINT accounts structs and refusal order:

- `reschedule_reveal` `[W record]`; `capture_entropy` `[W record, R SlotHashes]`; `reveal_level` nine accounts in struct order; `retire_burned` `[W cfg, W record, R asset]`; `claim` `[W cfg, W pool, R Token, pairs]` with `crank_n = 0` so `k = 0`; `expire_boosts` `[W cfg, W records...]`, batch 20 ≤ `MAX_EXPIRE_BATCH` 30 (asserted); `split_revenue` seven accounts in order, decimals read from the mint; `distribute(false)` `[W cfg, R pool]`; `activate` `[W cfg, W record, R asset, R canonical ATA, R pool]`. All match.
- **Reveal order:** strictly from `revealed_total`, stopping at the first vault not ready; the record at `revealed_total` is unrevealed by construction, so the level-0 filter in the fast lane cannot hide the head. `readySlot` reproduces `try_capture`'s B/C targets (`(slot/4 + 2)*4` twice) and `slot > readySlot` guarantees C's hash is an ancestor. Correct.
- **Pays or joins a dead vault:** only `'live'` is joined or paid; `'burned'` is retired first; `'other'` is reported. The only window is between the read and the send (limit 27).
- **Plans the program refuses:** I traced the pre-join → expire-before → split → distribute → expire-after → activate → claims order against `monthly_inline`'s gates in every host (`boosts_due`, `waiting_to_join`, `w == 0` tick). `claim`'s in-line run cannot credit before all pre-joins land because `waiting_to_join > 0` until the last pre-join batch's own loop, and nothing re-runs the month inside that instruction. The tick needs `pending_this_epoch - retiringThisEpoch > 0`, mirroring `retire`'s decrement. `w` includes pre-join weight and subtracts retiring and expiring weight, matching the on-chain denominator at the moment `distribute` lands. `splitToPool = total - total*1500/10000` equals `holders = total - bank_cut`. `owedAfterRetire` mirrors `retire`'s `owed_scaled -= pending`. No refusal path found beyond the accepted races, which `BENIGN` and `judgeDistributeRefusal` classify correctly (`PoolShort` always fails).
- **Claims arithmetic** (R4) for plain, pre-joined, pre-expired and post-expired vaults each reproduce `claim`'s `expire_boost` → `reweigh` → `owed_of` sequence exactly (`atExpiry + w·(acc−acc0)`).
- **Value:** no program but MINT, no transfer of its own (asserted both ways in the selftest); the key is fee payer and reveal-rent payer only.
- **Fee budget:** `budgetPlan` keeps the floor in reserve for reveals, runs captures below the floor, refuses only when the base plan is unaffordable. Correct.

Residual: F4.

## R2. The alarm

Every value the brief lists as fixed forever is in `WATCH` at CRITICAL (collection keys, reserve set, governance PDA, pool, treasury, split, supply, payment mint, census, PoB root/collection, charter dates, monthly, redeem window, notice, the three tighten bounds, cbob mint, boost bounds, GOV's three). Pending guardian/operator are both CRITICAL drift and CRITICAL level. PoB collection plugins and update authority are read correctly (`data[0] === 5`, bytes 1..33). Redemption window, frozen/insolvent pool (with `owed_scaled` read in the same `getMultipleAccountsInfo` as the pool), overdue distribution, and all five programs' upgrade authority after the lock are covered. The production list asserts 2,100 / 5,100 / 259,200, 604,800, the tighten bounds, 2,592,000 and 3,600.

Dangerous states read as quiet: none found beyond those SPEC already names (the 240 individual PoB assets, the $CBOB metadata authority, the collection's own update authority, which no instruction can change). Routine states paged every pass: none; `redemptions_near_cap` and `gov.proposal_count` page on intended events. Clock discipline is right everywhere except F1.

## R3. Layouts

`STRUCTS.MintConfig` matches the Rust struct field for field (checked against the bundled source); `offsets()` gives `minted_total` 141 and `bare_burns_retired` 454, the pins GOV and BURN use. `parseRustStruct` throws on any line it cannot read, so a non-`pub` field cannot hide. The SEEDS assertion round 24 D6 asked for exists (`seedOf` against each `pub const *_SEED`), with a mistyped and an unmapped seed proven caught. `BOOST_RING`, every `OFF_` constant, the layout versions in every program's copies, and `MINT_CONFIG_SPACE − CONFIG_PADDING = 1005` are all scraped from the Rust rather than typed. A struct change cannot slip past.

## R4. Money arithmetic

`credit`, `ceilSats`, `available`, `pendingScaled` (`(w+boost)·acc + carry − debt`), `reweigh`, `debtAtActivation` are the Rust formulas in BigInt. The crank expires every DUE boost before the distribution (`dist_epoch >= boost_end_epoch`, the same test `expire_boosts` uses, excluding records being retired) and every boost its distribution makes due right after (`boost_end_epoch == dist_epoch + 1`). `boosts_stalled` pages after the grace; `cbob_mint`, `max_boost_weight`, `max_boost_epochs` are CRITICAL drift and pinned in production. No divergence.

## R5. The swap and the revenue cycle

**(a)** `sats = lamports·sol·10^(es−eb) / (btc·10)`: correct for either sign of either exponent; integer floor on `expectedSats` and on `minSats` (conservative). `satsPerLamport` as a float: Pyth USD prices (~8.6e12) are far inside 2^53; a positive exponent would still be exact in float. The fork measured Orca 22 bps and Meteora 24 bps under the oracle at the ruled 10 SOL, so the 150 bps floor is well below an honest pool's output.

**(b)** `PriceUpdateV2` offsets recomputed: disc 8, write_authority 32, `verification_level` tag at 40 (Full = 1, Partial = 0 + u8), feed id 41..73, price 73, conf 81, exponent 89, publish_time 93. Correct, and the fork's clock arm writes at 93. The account is a PDA of the push-oracle program `[shard u16 LE, feed_id]`, owned by the receiver, so only the push oracle's CPI can write it, and the push oracle refuses a non-increasing `publish_time` (`UpdatesNotMonotonic`): nobody can post an OLD price or an unsigned one. What anyone CAN do is select, among genuine Pyth prices newer than the stored one, the one least favourable to us (see (i)). The Clock is read in the same `getMultipleAccountsInfo` as the prices; it is as trustworthy as the one RPC endpoint (limit 10 (b)). `MAX_ORACLE_FUTURE_SECS = 30` can be tripped by the chain's own clock lagging real time by more than 30 s, which Solana has done; the result is a refused cycle (loud), not a bad trade.

**(c)** `orcaSpot = (sqrt_price/2^64)^2` is token B per token A in raw units = sats per lamport, the oracle's unit. `meteoraSpot = 1/(1+bin_step/10^4)^active_id`: DLMM prices X in Y in raw units (lamports per sat), inverted correctly. Float error is ~1e-16 relative against a 100 bps gate; the symmetric gate also skips a pool priced in OUR favour, which is conservative. The read-time gate does not bind at execution (stated).

**(d)** Orca `other_amount_threshold` with `amount_specified_is_input = true` is a minimum output in token B raw units; Meteora `min_amount_out` is in X raw units. Both carry `guaranteed = m2.f.minSats`, the same floor the second deviation read used, and the post-swap delta is held to the same number. Consistent.

**(e)** The judge pins all seven positions, the exact CU-limit bytes, both ATA creations' six keys, the wrap's keys and amount, SyncNative, the swap's amount/floor/direction/price-limit bytes, pool, input, output and signer slots, and the single close. A tampered builder can still route: Meteora `host_fee_in` (F5); account `isWritable`/`isSigner` flags (not value-moving: a wrong flag fails the transaction, and a stranger signer is caught). ComputeBudget: only one instruction, `d[0]===2`, 400,000; a price instruction (`d[0]===3`) is refused by name, and any other budget instruction breaks the count or position. The base fee is the only fee.

**(f)** Orca: `start = floor(tick/(88·spacing))·span` for negative ticks is the SDK's rule (−88733/1408 → −64 → −90112, asserted); a_to_b crosses downward: `s0, s0−span, s0−2span`; seeds `["tick_array", pool, start.toString()]`, `["oracle", pool]`; the eleven accounts and 42 data bytes are v1 `swap`'s. Meteora: `floor(id/70)` is `div_euclid` for a positive divisor; selling Y moves the active bin UP: `i, i+1, i+2`; `["bin_array", pair, i64 LE]`, `["bitmap", pair]`, `["oracle", pair]`, `["__event_authority"]`; the fifteen accounts and 24 data bytes are `swap`'s; optionals passed as the program id, writable only when present. An uninitialised tick or bin array, a boundary crossed between the read and the send, or a disabled pair (`status` is read and never judged, round 32 C03) each produce a venue refusal → the next venue → the open-cycle hand path. No value path.

**(g)** Exactly `lamportsIn` is wrapped, synced, sold, and the wSOL account closed back; the native mint has no freeze authority; a delegate on the wSOL ATA does not block `Transfer` by the owner or `CloseAccount`; an ATA created by a stranger is still the operator's. If the venue consumed less than the input (it cannot with exact-input at the minimum price limit), the remainder returns as SOL on the operator key, where the ledger does not see it; that is the "wallet holds nothing but the cycle's funds" instruction, not a defect.

**(h)** Orca first; Meteora only on `refused`; `unknown` throws with the candidate kept. `TransactionExpiredTimeoutError` carries `.signature`, so `statusOf` is asked; a null status without a blockheight-exceeded error is `unknown`, so a swap that lands after a timeout can never be followed by a second swap by the automatic path. The one judged-refused-but-landed case (blockhash expired, RPC not yet indexing the landing) would try Meteora, which cannot afford the wrap because the Orca swap consumed the SOL, so it refuses, the cycle stays open and the alarm's delta/`unledgered` checks fire: no double swap while the operator wallet holds only its float. Every path leaves the row open until `returnedSats` is written after a confirmed return, and `cycleIsOpen` closes only on `sendRejected` (chain-checked) or a split.

**(i) The bound, as a number.** Per cycle the adversary can extract at most the gap between the pool's spot at read time and the on-chain floor. The floor is 150 bps under the oracle, and the oracle can sit up to 100 bps from the pool while passing the gate (by waiting for, or pushing, the least favourable genuine Pyth price inside the 180 s window). So the worst case is ≈250 bps of the swept amount: 0.25 SOL on a 10 SOL cycle, 1 SOL a day at the 40 SOL/day throughput ceiling, ~30 SOL a month only if royalty flow sits at that ceiling and every cycle is attacked. The cron fires at a predictable minute with no priority fee, which is what makes a sandwich cheap to aim. A manipulated Meteora pool cannot take more than the same floor, and pushing a $0.9M pool 1% to win 1.5% of ~$2,000 is uneconomic. A 180 s-stale oracle alone only refuses trades (both pools fall outside the gate). Material relative to royalty revenue (percent-level), immaterial relative to vault principal, which the key cannot reach. **Recommendation (not a defect):** with 22–24 bps measured on both venues at the cap, `SWAP_TOLERANCE_BPS` could be 75 and `MAX_ORACLE_AGE_SECS` 60 without false refusals, halving the bound; the holder guide's "up to 1.5%" should read "about 2.5% in the worst case".

**Operator key worst case (limit 10 restated):** per-sweep cap × cooldown windows until `emergency_stop_sweep`, never more than the PDA holds above the reserve; what the key trusts is two pool programs, Pyth, and the one RPC. The ledger cannot read a failed cycle as closed: `sendRejected` is set only on a chain-checked refusal, and a landed sweep under a refused row is CRITICAL from the walk and, now, from account state (F1/F2 qualify the latter).

## R6. The gates

- `floor()` demands equality; each numerator-reading regex is backed by the suite's own non-zero exit, so a partial pass cannot slip through.
- `everywhere()` refuses zero occurrences. `audit-coverage.sh --selftest` runs the never-sent check first (round 32 C12), so a new unnamed file turns the detector selftest red: loud.
- **A gate that cannot see its subject:** the round-32 `detectSweepState` arm uses one numeric domain for `startedAt` and `last_sweep_at` (F1). Add a skewed arm.
- `build-mainnet.sh` proves what it says for all five: four behavioural key proofs plus the sweep helper's byte identity to both the control rebuild and `target/deploy/`. It still cannot prove the compiled constant IS Gary's key (stated).
- `cron-install.sh` arms only from our tagged, uncommented full-pass line; six jobs, the reveal lane inheriting the full lane's flag; refuses a rehearsal tree. The deadman watches `${CBOB_ALARM_STATE:-default}` at INSTALL time; a differing env var in the installer's shell would make it watch a file the cron alarm never writes: a false page, not silence.
- `CBOB_SHIP_GATE=1` is what forbids a skipped probe/fork; nothing records whether the certifying run set it. Procedure, as SPEC says.

---

## The accepted limits, four questions

**1. Worse than stated?** Limit 10's round-32 paragraph understates two things: the state check is also masked for one window after an honest UNCERTAIN sweep (F2), and it can cry wolf on a skewed box (F1). The extraction bound is ~250 bps worst case, not 150 (F6). Nothing else is worse than written.

**2. Not actually a limit / already closed?** Limit 35 is correctly described (10.71% > 10%). Limit 42's narrow 1,219-byte shape remains unlanded, as stated. Nothing listed is closed unnoticed.

**3. A DISCHARGED item not discharged?** Item 54's "the crank is unaffected" holds for captures and reveals at the measured shapes; round 32 C02's boundary (a reveal of an asset grown to the Core heap limit) is the only unmeasured corner and is the accepted limit-40 class. Item 51 and the v5 items hold.

**4. OPEN AND BLOCKING quietly accepted?** No. Items 22, 38, 50, 52 and 53 are still open in SPEC and in round 32's VALIDATION; the rehearsal tree was re-made at `ec4a0e1` but `run-tests.sh` has not been re-run inside it, so 53 is correctly still open.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What AI reading structurally cannot do is EXECUTE against the real cluster, HOLD a key, or WAIT. Before the authority is removed:

1. **Run item 22 exactly as written, and add an adversarial day.** On the throwaway deployment: one real cycle through Orca, one through Meteora with Orca forced to refuse, one forced post-sweep failure recovered by hand, AND a day in which a second operator (not the author) floods MINT with 25,000 no-op transactions, pads a reschedule's logs, sends dust to the revenue PDA and to a vault's PDA mid-redemption, and skews the box clock by five minutes. Record which pages arrived, when, and whether the hand recovery runbook was followable by someone who did not write it. F1 would show up in the last step.
2. **Reproduce the five binaries on a second machine** from the release commit and compare sha256 to `dist/SHA256SUMS` before deploy; the whole "which key shipped" argument rests on that bridge.
3. **Witnessed `initialize`:** build the four transactions FROM `launch/mainnet-init.json` with a script that fails if any argument differs from the file, dry-run them, have Gary sign each, then read every config back through `bank/layout.mjs` and compare to the file before step 11.
4. **An off-box watcher.** Point a second, independently hosted copy of `bank/alarm.mjs` (different user, different RPC provider, `--dry-run` off, router state outside the main box) at the same programs. Limit 10 (3) is the box-owner residue; a second box is the only thing that shrinks it.
5. **Custody decisions only Gary can make, decided before the lock, in writing:** the Moments collection key through the 7-day window (limit 46), the $CBOB release wallet (limit 56), and whether the swap operator's cron should submit through a private relay.
6. **A timed drill** with the guardian wallet: from a CRITICAL email to a landed `emergency_stop_sweep`, by Gary, on the rehearsal deployment, with the clock running. The whole swap bound is "cap × windows until the guardian acts"; nobody has measured the denominator.
7. **Holder surfaces (item 50) exercised by real wallets** (Phantom, Ledger, a Gary Club custodial wallet) on the rehearsal deployment, including one redemption with a stray classic token and one attempt from a Squads vault, before the guide is published.
8. **Pin and read the dependency tree once** (`@solana/web3.js`, `@metaplex-foundation/mpl-core`, `@solana/spl-token`) and record their hashes; the crank's reveal lane (F4) and the revenue job are only as sound as those bytes on this box.