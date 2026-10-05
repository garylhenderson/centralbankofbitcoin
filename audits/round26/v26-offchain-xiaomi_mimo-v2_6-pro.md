# SECURITY AUDIT — CBOB v6 OFF-CHAIN PIPELINE + SWEEP HELPER

**Commit under audit:** `ba67127` / `2b67fb1` tree as bundled. Read-only. Every finding states the evidence that would exist on chain or in a test run if the claim is true.

---

## R0. ROUND 25'S OFF-CHAIN REPAIRS

### L1 — judgeSwapInstructions exact-sequence check

**Repairs verified at every site.** The judge (`bank/swap.mjs:255-365`) now takes `{ lamportsIn, minSats }`, requires exactly seven instructions, pins the ComputeBudget to `SetComputeUnitLimit(400_000)` with no `setComputeUnitPrice`, validates each ATA creation as `CreateIdempotent(owner, ata(mint, owner), owner, mint, SystemProgram, TOKEN)`, checks the System transfer is discriminator 2 from owner to own wSOL for exactly `lamportsIn`, validates SyncNative, the venue swap's amount/threshold/direction/price-limit bytes and account positions, and the single Token CloseAccount. Token instructions other than SyncNative and CloseAccount are refused. All eight tampers in the selftest are armed on both venues and refused by name. **L1 repair holds.**

### L2 — Chain clock oracle age

`market()` reads `SYSVAR_CLOCK_PUBKEY` in the same `getMultipleAccountsInfo` as the Pyth accounts, validates the sysvar's owner via `SYSVAR_OWNER`, decodes with `clockUnixTimestamp` (reused from `crank.mjs`), and refuses if null. `oracleFloor` takes `nowSec` and refuses stale (>180 s) and future-dated (>30 s) prices. `revenue.mjs` calls `SW.market(conn, lamports)` and `SW.sweepCooldownOver({..., chainNowSec: chainNow})`. No box clock remains in the swap or cooldown path. **L2 repair holds.**

### L3 — classifySendFailure

Three shapes distinguished: preflight refusal (regex on message+logs), landed-failure (`statusOf` returns confirmed/finalized with `err`), expired-unlanded (blockhash expired + no status), and unknown (everything else). Revenue marks `sendRejected` only on `refused`, records `refusedSig` not `sweepSig`, and tries Meteora only on a confirmed Orca refusal. The chain's status is asked with `searchTransactionHistory: true`. **L3 repair holds.**

### L4 — Revenue cron hourly

`cron-install.sh` installs `41 * * * *` for revenue. `REVENUE_CRON_PERIOD_SECS = 3600` in `detectors.mjs`. The selftest asserts `cronPeriod(revLine) === 3600 && 3600 < ruledCooldown`. `sweepCooldownOver` compares against the chain clock. **L4 repair holds.**

### L5 — Revenue cycle named in rehearsal

SPEC item 22 now names items 3 and 4 (full live cycle through each pool, forced post-sweep failure through hand recovery). **L5 repair holds as documentation.** Item 22 remains OPEN AND BLOCKING.

### L6 — Swap fork 10 SOL cap and offline deviation arms

`swap-fork.mjs` SW.8/SW.9 swap 10 SOL through each venue. SW.7/SW.7a/SW.7b exercise fresh/stale/future oracle ages against the fork's Clock. The selftest's round-25 section arms `deviationBps` at 99/101 bps both sides both venues through `market()`. **L6 repair holds.**

### L7 — Program-ID gate

14 copies across 8 files plus 5 keypair pubkeys, each compared to `L.PROGRAM_IDS`. One-character mutation in any copy turns the gate red. A 4-char-prefix stray literal is caught. **L7 repair holds.**

### I1–I4, D1/D2

I1: `closesCycle` anchors on `returnBlockTime` when present. I2: four third-party programs watched at HIGH. I3: `MAX_ORACLE_CONF_BPS = 30`. I4: 30 detector calls argument-pinned. D1: limit 10 text now names the full trusted set and the judge's limits. D2: item 50 says "BUILT". **All hold.**

---

## R1. THE CRANK (`bank/crank.mjs`)

### FINDING C1 — LOW: Crank `readySlot` ignores skipped slots and can waste a fee on every capture-ripe vault

**Construct:** `crank.mjs:162-165` `readySlot(revealSlot)` computes `a = revealSlot; for(i=0;i<2;i++) a = (floor(a/4)+2)*4`. The docstring says "a fork that skips nothing." On mainnet, slots are routinely skipped, so the real "three hashes exist" slot can be later than `readySlot` predicts. The planner at `crank.mjs:236-237` sends `capture_entropy` for every record where `slot > readySlot(reveal_slot)`, but the program's `try_capture` returns `RevealTooEarly` (a BENIGN code) if C's hash is not yet in SlotHashes.

**What an attacker or accident gains:** Wasted transaction fees (5,000 lamports per capture attempt per pass). At a sale hour with 100 ripe vaults and a reveal lane running every minute, that is 100 × 5,000 = 500,000 lamports per minute of wasted fees on the crank key, until the slots advance. The key has 0.005 SOL floor so it cannot drain, but the pattern is persistent.

**Evidence if true:** A crank log showing `skip capture ... RevealTooEarly` entries in bursts after slot gaps. On a local validator with forced slot skips, the planner would emit captures before the program accepts them.

**Fix:** After a `RevealTooEarly` refusal, add a backoff: skip that record for N passes (or compare against the current slot minus a margin of `MAX_SKIPPED_SLOTS × 3`). Alternatively, read the SlotHashes sysvar and check whether C's target slot is actually present before planning the capture.

### FINDING C2 — LOW: `budgetPlan` can drop ALL reveals and leave the crank silently not revealing

**Construct:** `crank.mjs:210-222` `budgetPlan`. When the fee payer's balance covers the base plan (captures, retires, splits, distributes, claims) but not all reveals, it computes `n = room / (SIG_FEE + REVEAL_RENT)` and keeps `min(reveal.length, n)`. If `n` is 0, `plan.reveal` becomes `[]` and `dropped` is set to `plan.reveal.length`. The caller (`crank.mjs:573-574`) pushes a failure message.

**What an attacker or accident gains:** Nothing directly — the failure is paged. But if the fee payer's balance hovers at exactly the base-plan cost (e.g. the operator tops up to just cover captures but not reveals), every pass drops all reveals, and the `reveal_queue_stalled` detector in the alarm fires only after two 30-minute passes see no movement. During a sale hour with a queue of 100+ unrevealed vaults, that is 60 minutes of stalled draws.

**Evidence if true:** Crank heartbeat showing `failures: 1` with the "could not pay for N reveal(s)" message every pass, and the alarm's `reveal_queue_stalled` firing 30-60 minutes later.

**Fix:** When `budgetPlan` drops reveals, page HIGH immediately (it already pushes to `failures`), and consider a minimum reveal count: if the key cannot cover at least one reveal, refuse the pass entirely (which is what `judgeFeePayer` does when `need > lamports` — the budget path bypasses that for the non-reveal portion).

**Severity: LOW.** Paged loudly; no value moves incorrectly.

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

### FINDING A1 — MEDIUM: `detectUnsweptRoyalties` resets `since` to `null` whenever excess drops below floor, causing the grace period to restart on oscillation

**Construct:** `detectors.mjs:2022-2024`: `if (excess < BigInt(floor)) return { since: null, findings: [] }`. The caller (`alarm.mjs`) stores `royalty.since` as `royaltySince` in state. When excess drops below the 1 SOL floor (e.g. a partial sweep, or a vote tightening `max_sweep_lamports` so that the excess falls below `sweep_floor_lamports`), `since` resets to `null`. On the next pass where excess is again ≥ floor, `since` initializes to `nowSec`.

**What an attacker or accident gains:** A revenue job that sweeps irregularly (e.g. sweeps 0.9 SOL when excess is 1.1 SOL, leaving 0.2 SOL which is below floor, then new royalties push it above 1 SOL again) will NEVER trigger `royalties_unswept`, because the clock resets on every dip below floor. The detector is documented as "restarts on every fall" (accepted limit 10 / A2), but the current behavior is worse: it restarts on every dip below the floor threshold, even when no sweep occurred. A dead revenue job with the balance oscillating around 1 SOL due to incoming royalties is silently undetected.

**Evidence if true:** A revenue ledger with no new cycles, the revenue PDA's lamports oscillating between 0.9 and 1.2 SOL over 48 hours, and `royalties_unswept` never firing. The `since` value in state would show `null` at every pass where `excess < 1 SOL`.

**Fix:** Only reset `since` to `null` when the balance actually FALLS (which indicates a sweep), not when `excess < floor`. The existing `prevLamports` comparison already detects a fall; the `excess < floor` early-return should still carry the `since` forward, or at minimum set `since` to `prevSince ?? nowSec` rather than `null`.

**Severity: MEDIUM.** Silently disables the only detector for a dead revenue job when the balance hovers around the threshold. No value is lost (the SOL stays in the revenue PDA), but the "layer one" automation can be dead indefinitely without paging.

### FINDING A2 — LOW: `detectConfigDrift` does not watch `mint.boost_weight_total` or `mint.cbob_burned_total`, so a program bug that corrupts boost accounting is undetected

**Construct:** `detectors.mjs:375-380` `WATCH` list includes `mint.boosts_active`, `mint.boosts_due`, `mint.cbob_mint`, `mint.max_boost_weight`, `mint.max_boost_epochs`, `mint.boost_price`, `mint.boost_weight`, `mint.boost_epochs` but NOT `mint.boost_weight_total` or `mint.cbob_burned_total`. These are status values (like `minted_total`), but unlike `minted_total` they are supposed to be exact sums of live boost weights and total burned $CBOB. A MINT program bug that corrupts either would not drift.

**What an attacker or accident gains:** Nothing directly — the boost accounting is checked by the host unit test N1 (260 epochs, four ring wraps). But if the program were to have a bug that double-counts or drops a boost's weight from `boost_weight_total`, the alarm would not notice, and `total_active_weight` would diverge from the sum of individual vault weights.

**Evidence if true:** `boost_weight_total` ≠ sum of `boost_weight` across all active vault records, with no alarm firing.

**Fix:** Add `mint.boost_weight_total` and `mint.cbob_burned_total` to `WATCHED_KEYS` (so a reader that drops them is caught) and optionally compare them against a sum computed from records in the alarm pass. LOW because the program arithmetic is proven by N1 and the on-chain suite.

**Severity: LOW.** Defense-in-depth gap; the primary check (N1) exists.

### FINDING A3 — INFO: `detectCrankHealth` problem-key normalization over-aggressively collapses distinct problems

**Construct:** `detectors.mjs:2125` `problemKey = p => String(p).replace(/\b\d+\b/g, '#')`. This replaces ALL numbers with `#`, so "vault A is owed 9 sats" and "vault B is owed 9000 sats" both normalize to "vault # is owed # sats". If two different vaults have the same problem shape (e.g. both have a missing recorded account), they count as the same streak. Conversely, "vault A is owed 9 sats but X is absent" and "vault A is owed 9 sats but Y is absent" normalize to different keys (X vs Y are not digits), so they count as two separate problems.

**What an attacker or accident gains:** Nothing — it only affects when `crank_problem` fires (needs 3 consecutive passes). The over-collapsing makes it fire sooner (which is the safe direction); the under-collapsing makes it fire later for problems that differ only in a non-numeric token.

**Evidence if true:** Two vaults with different numeric values in the same problem shape are counted as one streak.

**Fix:** Use the vault's asset address (which is stable) as the key instead of the full message, or normalize only the trailing numbers. **INFO.** Cosmetic.

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

### All assertions verified real.

- `parseRustStruct` is strict: a private or `pub(crate)` field throws. Selftest round-22 L1 arms both.
- Field-for-field comparison against all five structs: both directions (added field caught, retyped field caught).
- Every cross-program `OFF_` constant in GOV, BURN, and MINT is scraped and compared (round-22 L2 gate: "every OFF_ constant any program pins is compared").
- Seeds: all 11 asserted against Rust declarations (round-24 D6). A mistyped or unmapped seed is caught.
- Layout versions: every `*_VERSION` constant in all four programs is compared (round-23 L6). A bumped version in any copy is caught.
- `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` scraped and evaluated against `fixedLength` minus padding (round-24 L13c).
- Suite's `OFF_*` constants compared against the layout.

**No defect found in R3.** A struct change cannot slip past: the parser refuses what it cannot read, and the selftest proves it in both directions.

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs` vs MINT)

### Formula-by-formula comparison:

| accrual.mjs | MINT lib.rs | Match? |
|---|---|---|
| `credit`: `delta = avail * ACC_SCALE / w; acc += delta; owed += delta * w` | `credit`: `delta = (avail as u128) * ACC_SCALE / (w as u128); acc += delta; owed += delta * w` | ✅ |
| `pendingScaled`: `(weight + boost) * acc + carry - debt` | `owed_of`: `weight_of * acc + carry - debt` | ✅ |
| `ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE` | `ceil_sats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE` | ✅ |
| `available`: `balance - ceilSats(owed)` | `distribute`: `avail = balance - ceil_sats(owed)` | ✅ |
| `reweigh`: `carry = owed; debt = newWeight * acc` | `reweigh`: `carry = owed; debt = after * acc` | ✅ |
| `weightOf`: `WEIGHTS[level-1]` | `weight_of`: `LEVEL_WEIGHTS[level-1] + boost` | ✅ |

**Boost expiry before and after distribution:** The crank plans `preExpires` (due at `dist_epoch`) and `postExpires` (due at `dist_epoch + 1` after this pass's distribution). Verified against the selftest round-24 BOOST arms.

**Alarm `boosts_stalled` and fixed-forever bounds:** `detectDistributionOverdue` includes `boosts_stalled` when `boosts_due > 0` past grace. `detectStandingRisks` production list pins `max_boost_weight = 12`, `max_boost_epochs = 24`, `cbob_mint = CBOB_MINT`.

**No divergence found in R4.**

---

## R5. THE SWAP AND THE REVENUE CYCLE

### (a) Oracle math

**Exponent handling:** `e = sol.expo - btc.expo`. If `e >= 0`: `num *= 10^e`. If `e < 0`: `den *= 10^(-e)`. Both exponents are typically -8 (Pyth convention), so `e = 0` and neither adjustment fires. For the general case the logic is correct: the formula `sats = lamports * solPrice * 10^(es-eb) / (btcPrice * 10)` is algebraically right.

**Integer rounding:** `expectedSats = num / den` (floor). The floor (`minSats`) is `expectedSats * (10000 - 150) / 10000` (floor). Both round down, which is conservative for a minimum-out.

**Overflow in `satsPerLamport`:** `Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10`. With live values (sol.price ~1.2e10, btc.price ~8.6e12, expo -8): `Number(1.2e10) * 1e-8 = 120.45`, `Number(8.6e12) * 1e-8 = 85929`. Result: `120.45 / 85929 / 10 ≈ 1.4e-5`. No overflow. The float is used only for `deviationBps`, not for the floor.

**Floor below honest pool return:** The floor is oracle-expected minus 150 bps. The pool fee (Orca 0.16%) and impact of a 10 SOL swap are covered within 150 bps at the pinned pools' liquidity (~$10M for Orca). The fork proves it for 10 SOL (SW.8).

**No defect found in (a).**

### (b) Pyth account verification

The account is derived (shard 0 PDA under `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`), owned by `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, fully verified (byte 40 = 1), and carries the expected feed ID. The `PriceUpdateV2` offsets are: disc(8) + write_authority(32) + verification_level(1, since Full is variant 1 after Partial{u8}) + feed(32) + price(8) + conf(8) + expo(4) + publish_time(8) = 93 bytes minimum. The selftest constructs this layout and verifies parsing.

**Can anyone write a fully-verified update with an old publish_time?** Only through the Pyth receiver program, which validates Wormhole signatures. A replay of an old signed update would have an old `publishTime`, which `oracleFloor` refuses (>180 s stale or >30 s future). The 30-second future window is narrow.

**Is the clock trustworthy?** The Clock sysvar is set by the runtime and cannot be forged. A validator that produces a wrong clock would need to be dishonest at the runtime level, which is the same trust as the chain itself.

**No defect found in (b).**

### (c) Deviation filter

`orcaSpot`: `(sqrt_price / 2^64)^2` in raw units (cbBTC per wSOL base units). `meteoraSpot`: `1 / (1 + binStep/10000)^activeId` in the same units (sats per lamport). Both compared to `f.satsPerLamport` (the oracle's sats per lamport). Direction is correct: Orca's `sqrt_price` is token B per token A (cbBTC per wSOL), and Meteora's pair prices X in Y (cbBTC in wSOL) so its spot is wSOL per cbBTC inverted.

**Float passing a pool it should refuse:** At the live values (sqrt_price ~ 2^64 × 0.0014, activeId 5920, binStep 15), the float computation differs from exact by < 1e-9 bps (round-25 wrong-claims measurement). The 100 bps tolerance absorbs this entirely.

**No defect found in (c).**

### (d) Minimum out

`SWAP_TOLERANCE_BPS = 150` is applied to the oracle's `expectedSats` to produce `minSats`. The same `minSats` is passed to `swapInstructions` (which encodes it as `other_amount_threshold` for Orca and `min_amount_out` for Meteora) and to `judgeSwapInstructions` (which verifies the bytes). The deviation filter's assumption is the oracle price; the floor is 150 bps below it. **Same floor, same units. No defect.**

### (e) The judge

**Verified complete for the fields that matter.** The judge checks:
- Programs allowed (5: ComputeBudget, System, TOKEN, ATA, venue).
- All signers = owner only.
- Exactly 7 instructions.
- CU limit = 400,000, no CU price.
- ATA creations for operator's own wSOL and cbBTC.
- System transfer of exactly `lamportsIn` to own wSOL.
- SyncNative of own wSOL.
- Swap with amount = `lamportsIn`, threshold = `minSats`, correct accounts and direction.
- Close of own wSOL to owner.

**What a tampered builder could still route past it:** The Meteora swap data is 24 bytes (disc + amount + threshold). The judge checks the length and the two u64s. Meteora's `swap` instruction has no other data fields (the bin arrays are remaining accounts). Orca's swap data is 42 bytes (disc + amount + threshold + sqrt_price_limit + a_to_b + amount_specified_is_input); all four fields are checked. **No tamper path found.**

### (f) Account derivation

**Orca tick arrays:** `orcaTickArrayStarts(tickCurrent, tickSpacing)` computes `s0 = floor(tickCurrent / span) * span`, then `[s0, s0 - span, s0 - 2*span]`. For an `a_to_b` swap (selling wSOL, pushing price down), the tick moves down, so the arrays below the current one are correct. The selftest proves `-88733` at spacing 16 gives `[-90112, -91520, -92928]`.

**Meteora bin arrays:** `meteoraBinArrayIndexes(activeId)` = `[i, i+1, i+2]` where `i = floor(activeId / 70)`. For a Y→X swap (buying X with Y), the active bin moves up, so the arrays above are correct. A negative `activeId` floors down correctly (e.g. `-1` gives `[-1, 0, 1]`).

**Bitmap extension:** `opt(mPda('bitmap', METEORA.pool), bitmapExists)` — passed as the program ID (Anchor's None) when absent. `host_fee_in` is `opt(null, false)` — always None.

**Uninitialized array:** Orca refuses `AccountNotInitialized`; Meteora refuses similarly. This causes a venue refusal → fallback, which is correct.

**No defect found in (f).**

### (g) wSOL handling

Wrap exactly `lamportsIn`, sync, swap, close. If the wSOL ATA already exists with a balance: `CreateAtaIdempotent` is a no-op, the transfer adds to it, `SyncNative` updates the balance, the swap consumes from it, and `CloseAccount` returns the remainder (wSOL is a native mint, so `CloseAccount` succeeds with any balance and the lamports go to the destination). If the ATA is frozen: the native mint has no freeze authority (wSOL is `So111...112`, a well-known system-created mint with no freeze). If the ATA has a delegate: the swap uses `Transfer` (not `TransferChecked`), which checks the authority (owner), not the delegate. The owner signs the transaction.

**Leftover after a swap that consumes less than input:** The remainder stays in the wSOL ATA and is returned to the owner by `CloseAccount`. Nothing is lost.

**No defect found in (g).**

### (h) Failure and retry

Orca first; Meteora only on a confirmed refusal (`classifySendFailure` → `refused`). An unconfirmed send (`unknown`) throws and the cycle stays open. A send that lands after a timeout is classified `landed` and recorded. The ledger stays open until `returnedSats > 0` and `splitSig` or `splitByOther` is set.

**Double-swap risk:** The `classifySendFailure` with `statusOf(sig, {searchTransactionHistory: true})` reads the chain's verdict. If the chain says `landed`, the signature is recorded. If `refused`, Meteora is tried. If `unknown`, the cycle is left open. **The only double-swap risk is the hand recovery path**, which is documented (limit 10 A3).

**No defect found in (h).**

### (i) What an adversary can extract within the tolerance

**Sandwich attack within the gate:** An adversary can push the pool to the edge of the 100 bps deviation gate. The floor is 150 bps below oracle. Worst case: the fill is at the floor, 150 bps below oracle. At 10 SOL per cycle: `10 × 0.015 = 0.15 SOL` lost to the adversary per cycle. At 4 cycles/day: 0.6 SOL/day, ~18 SOL/month. This is material but bounded by the on-chain floor.

**Pool pushed to edge of gate:** Same as above. The Meteora pool (~$0.9M) is thinner; a 10 SOL swap has more impact. The fork proves 10 SOL fits within 150 bps at current liquidity.

**Stale-but-accepted oracle:** The age limit is 180 s. A price 180 s stale could be 50-100 bps off in a fast market. Combined with the 150 bps floor: worst case 250 bps below true price. At 10 SOL: 0.25 SOL per cycle, 30 SOL/month. This is the documented ~250 bps worst case (limit 10).

**Manipulated Meteora pool:** At ~$0.9M liquidity, a 10 SOL (~$2,000) swap could move the price by ~0.2-0.5% (20-50 bps). The deviation gate catches anything > 100 bps. Within the gate: 50 bps extraction per cycle.

**Operator key worst case (limit 10 updated):** The operator can keep `max_sweep_lamports` (10 SOL) every `sweep_cooldown_secs` (6 h) until the guardian stops the sweep. That is 40 SOL/day, bounded by what the revenue PDA holds above `sol_reserve_lamports` (0.05 SOL). The trusted set is now two pool programs + the oracle + the RPC endpoint + the code tree (round-25 D1 correctly enumerates all of these).

**The ledger cannot read a failed cycle as closed:** `cycleIsOpen` returns `true` when `returnedSats == 0` or no `splitSig`/`splitByOther`. The delta check throws if `delta < guaranteed`. **Confirmed.**

---

## R6. THE GATES

### Assertions that cannot fail: **None found.**

Every arm in `selftest.mjs` is checked in both directions. The round-25 L1 section proves the old judge passed all eight tampers (by implementing `judge24` and asserting it returns `[]` for each), and the new judge refuses each by name. The round-25 L2 section proves the old box-clock behavior (by calling `oracleFloor` with a shifted `nowSec`) and the new chain-clock behavior. The round-25 L3 section proves the old regex classified on-chain failures as unconfirmed.

### Floors satisfiable by deleting work: **No.**

All floors must EQUAL the count (`floor()` in `run-tests.sh`, `R.length !== FLOOR` in `selftest.mjs`). Deleting any assertion drops below the floor and fails.

### Checks that pass vacuously on empty input: **One found.**

**FINDING G1 — LOW: `detectRedemptionRate` returns `[]` when `redemptionCapacity` returns `null`, which happens when `rate_ring` is not exactly 64 entries.**

**Construct:** `detectors.mjs:2044`: `if (!Array.isArray(ring) || ring.length !== RATE_RING) return null`. `detectRedemptionRate` at `detectors.mjs:2055`: `if (!c) return []`. If the `rate_ring` in BURN's config is somehow not 64 entries (e.g. a layout mismatch that `decode` would catch, but if `flatten` were to produce a wrong shape), `redemptionCapacity` returns `null` and `detectRedemptionRate` returns `[]` — quiet.

**What an attacker or accident gains:** Nothing directly — the layout assertions would catch a malformed `rate_ring` at decode time (the `[i64; 64]` reader refuses a truncated account). But if a future code change made `flatten` produce a non-array for `rate_ring`, the detector would silently pass.

**Evidence if true:** `redemptionCapacity(cur, nowSec)` returns `null` with a populated config, and `detectRedemptionRate` returns `[]`.

**Fix:** Have `detectRedemptionRate` report a finding when `redemptionCapacity` returns `null` on a non-empty config (i.e. "the rate ring is unreadable, the redemption cap cannot be checked"). **LOW.** The layout gate prevents the precondition.

### Round-24 section arms: **All verified armed in both directions.** L1 through I5 each have a "measured before the fix" arm and a "now correct" arm. D5 (rehearsal seam) is tested for exact-match `CBOB_ALARM_REHEARSAL=1`. I4 (argument pinning) catches positional swaps and wrong option values.

### `scripts/build-mainnet.sh`: Proves all five programs. The sweep helper is compared byte-for-byte against both `$CACHE/ln` and `target/deploy`. All four key-carrying programs are behaviorally tested (mainnet rejects test key, localnet accepts). **No defect.**

### `scripts/cron-install.sh`: Installs exactly 6 jobs (crank, crank-reveal, deadman, reconcile, revenue, watcher). Money armed only from uncommented tagged lines. The posture print is computed from the installed crontab. **No defect.**

---

## THE FOUR QUESTIONS ABOUT ACCEPTED LIMITS

### 1. Is any limit WORSE than stated?

**Limit 10 (swap operator) — slightly worse than stated in one dimension.** The text says "per-sweep cap x cooldown windows until the guardian pulls `emergency_stop_sweep`." The cooldown is 6 h, so the cap is 4 sweeps/day = 40 SOL/day. But the revenue cron runs hourly (round-25 L4 fix), and `sweepCooldownOver` uses the chain clock. A sweep that lands at 00:00:01 makes the next sweep eligible at 06:00:01. The hourly cron picks it up at 06:41. So the effective rate is 4 sweeps/day, not 6. This matches the documented "40 SOL a day." **Not worse than stated** — the "about 40 SOL a day" figure in limit 10 is correct.

**Limit 25 (draw lapse / re-roll) — the round-25 A1 measurement (300.8 s RPC stall) is worse than the "~2 minutes" window implies.** A single stalled RPC socket blocks the reveal lane for 300.8 s, which is 2.5x the 300-slot (~2 min) capture window. The next `flock -n` runs skip silently. The text already says "a crank that is up but slow also lapses windows in a burst" and the A1 note names 300.8 s. **Accurately stated, but the operational implication (one bad socket = guaranteed lapse for every vault in the window) deserves emphasis.** The fix (20 s `AbortSignal.timeout` on the reveal lane) is named in A1 but not yet implemented.

### 2. Is anything listed as a limit not actually a limit?

**Limit 8 (cross-pass correlation lag):** The text says "the CRITICAL has already gone out and nothing retracts it." This is accurate. `correlateBurns` runs post-pass and cannot un-say a CRITICAL from a previous pass.

**Limit 36 (in-line monthly run skipped by early host):** Accurate. `monthly_inline` checks `now >= last_distribute_at + monthly_secs` and returns `Ok(())` if early.

**No item is listed as a limit but is actually closed.**

### 3. Is any DISCHARGED item not actually discharged?

**Item 51 ($CBOB boost):** The host unit test N1 drives 260 epochs through the program's own functions. The suite's BO section tests `boost_vault`, `expire_boosts`, `set_boost_terms`. The crank's pre/post expire arms are tested. The alarm's `boosts_stalled` is tested. **Discharged.**

**Item 54 (compute at widest host shapes):** Measured 168,343 CU for the four-instruction redemption (S8.1a). The crank sends captures separately. Holder pages must set CU limit. **Discharged for the crank; the holder-pages obligation is carried in item 50 (OPEN).**

**Item 12/17 (compute units):** Measured on the artifact. The byte wall binds 25x before the compute wall. **Discharged.**

**No discharged item is not actually discharged.**

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 22 (nothing has run a distribution against a live chain):** The round-25 L5 addition named the revenue cycle as a rehearsal obligation. Road step 8 lists 5 named items. **Not treated as accepted.**

**Item 38 (initialize values):** `launch/mainnet-init.json` has two OPEN fields (`charter_opens_at`, `lock_deadline`). `check-launch-params.mjs` refuses to pass while anything is OPEN. **Not treated as accepted.**

**Item 50 (holder surfaces):** OPEN AND BLOCKING. The holder guide is marked DRAFT. **Not treated as accepted.**

**Item 53 (dress rehearsal at throwaway IDs):** The rehearsal tree is built and proven at `d57ee3a`, but the proof is stale. **Not treated as accepted.**

**No OPEN item is being quietly treated as accepted.**

---

## ANYTHING ELSE

### FINDING X1 — LOW: `readPyth` does not verify `publishTime` is monotonically increasing across reads

**Construct:** `swap.mjs:84-100` `readPyth` parses `publishTime` from the account but does not compare it against a previous reading. If the Pyth receiver program allows a replay of an older signed update (which would require a bug in Pyth's receiver), a stale-but-within-180s price could be accepted. The `oracleFloor` staleness check bounds this to 180 s.

**What an attacker or accident gains:** At most 180 s of stale price, which in a fast market could be 50-100 bps. Combined with the 150 bps floor: up to 250 bps below true price (the documented worst case). The attack requires a bug in the Pyth receiver program (which is not ours).

**Evidence if true:** Two consecutive `readPyth` calls returning decreasing `publishTime` values with the later one being accepted.

**Fix:** Track the last-seen `publishTime` per feed and refuse a price older than the last accepted one. **LOW.** The receiver program is trusted (limit 10's trusted set).

### FINDING X2 — INFO: `rehearsal-tree.sh` does not verify the sweep helper's program ID is among the patched files

**Construct:** `rehearsal-tree.sh:106-109`: the `need` list requires `programs/cbob-vaults/src/lib.rs`, `programs/cbob-vault-mint/src/lib.rs`, `programs/cbob-vault-burn/src/lib.rs`, `programs/cbob-vault-gov/src/lib.rs`, and `bank/layout.mjs` to be in `changed`. It does NOT require `programs/cbob-vault-sweep/src/lib.rs` or `bank/swap.mjs` or `bank/detectors.mjs`. The sweep helper has no `declare_id!` (it is stateless), so its program ID appears only in `bank/layout.mjs` and `bank/detectors.mjs`. If the sweep helper's ID literal were present in a file not in the `changed` set, the rehearsal would run at the wrong ID for the helper.

**What an attacker or accident gains:** Nothing — the helper's ID is in `bank/layout.mjs` (which IS in the `need` list) and `bank/alarm.mjs` and `bank/detectors.mjs` (both of which have the ID as a `new PublicKey('...')` literal that WOULD be caught by the 4-char-prefix check). But the `need` list is a belt-and-braces check that the most important files were patched; missing `bank/swap.mjs` and `bank/detectors.mjs` means those files could theoretically escape the patch and still reverse-clean.

**Evidence if true:** `rehearsal-tree.sh` runs, `changed` does not include `bank/swap.mjs`, but the reverse map still recreates HEAD (because `swap.mjs` has no program ID literal — it uses `SW.ORCA.program` etc. which are `new PublicKey('...')` literals).

**Fix:** Add `bank/swap.mjs`, `bank/detectors.mjs`, and `bank/revenue.mjs` to the `need` list. **INFO.** The 4-char-prefix check and the reverse-map proof make actual escape unlikely.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, WHAT SHOULD THIS PROJECT DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT?

1. **Run the dress rehearsal end-to-end at throwaway IDs with real money on devnet or a mainnet fork, including the revenue cycle through both pools and the hand recovery.** No AI audit can execute the revenue cycle; item 22's five named items are the only proof that `revenue.mjs` works against a live chain. Record every transaction signature. If the rehearsal finds a bug, fix it and re-freeze.

2. **Have a human (Gary or a designated operator) manually walk through one full redemption on the redeem page, from the deposit-address display through the coverage check, the sweep helper call, and the public post.** The redeem page does not exist yet (item 50). When it is built, its UX correctness — "does the holder understand what they are signing" — is not something AI can judge.

3. **Physically verify the custody of all three hot keys on the box: the swap operator key, the $CBOB release key, and the Moments collection key.** Read the file permissions, confirm the backup contains them, confirm no other user can read them. AI can verify the code checks permissions; it cannot verify the filesystem.

4. **Run `scripts/build-mainnet.sh` at the exact release commit and record the sha256 of all five `.so` files in a document that is NOT in the repo** (e.g. printed and stored in a safe). Then deploy from those exact bytes and verify the on-chain hash matches. AI can verify the script is correct; it cannot verify the deployment used those bytes.

5. **After deploying and verifying, remove the upgrade authority from all five programs in the presence of a witness.** Record the transaction signatures. This is the single irreversible act that makes every surviving bug permanent. AI cannot perform it or witness it.

6. **Test the alert pipeline end-to-end: trigger a real finding (e.g. temporarily change a watched value on a rehearsal deployment) and confirm the alert arrives on Gary's phone.** The selftest proves the router classifies correctly; it cannot prove the SMS gateway delivers.

7. **Before publishing the holder guide, have a non-technical person read it and explain back what they think the system does.** If their explanation contains a false promise, the guide is wrong regardless of what the code does. AI can check every sentence against the code; it cannot check whether a human understands the sentences.