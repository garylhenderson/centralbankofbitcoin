# Round 31 — independent audit of the current tree

Audited the bundled tree as delivered (commits `425111d` / `0d13b03`), reading round 30's verdict as evidence, not authority. I did not execute the suite; where I make a claim about runtime behaviour I state the evidence that would exist if I am right, and I mark reasoning-only findings as such. No live RPC, no transactions, no notifications.

---

## R0 — Round 30's verdict and repairs

**Round 30's six confirmed findings (M1, L1, L2, L3, D1, D2) are genuinely repaired in the bundled code.** I verified each at its site:

- **M1 (scan backlog):** `bank/sigwalk.mjs` now takes `startBefore`; `bank/alarm.mjs` persists `backlogs[id] = { head, before }`, resumes from `before`, advances the cursor to `head` only when the walk reaches the old cursor, and requires positive proof for an empty resumed walk (`scan_backlog_unproven` CRITICAL otherwise). `bank/redemption-poster.mjs` applies the same rule with `st.backlog`. Selftest arms drive a 25,000-signature flood through the real `signaturesSince` and the extracted alarm walk, including the empty-resume disproof. **Holds.**
- **L1 (stranger truncation page):** `log_coverage_gap` now fires only when one of OURS executed (`alarm.mjs` builds `ran` from `normaliseTx` program ids); the stranger shape is `log_truncated_foreign` INFO. **Holds**, with one gap — see finding **A3** below.
- **L2 (crank floor):** `budgetPlan` judges the base plan with `floor: 0n` and budgets reveals only from `room = lamports - baseCost - floor`. **Holds**, with one residual — see **A2**.
- **L3 (dust):** `SW.sweepAmount` returns `0n` below `MIN_SWEEP_LAMPORTS`; `revenue.mjs` uses it. **Holds.**
- **D1/D2:** rehearsal tags on recovery/run-failure/reconcile notices (asserted in selftest); SPEC item 44 corrected to "holding a balance". **Hold.**

**Round 30's quorum arithmetic is self-consistent** (6 substantive of 8 requested; Grok excluded as a restatement of round 29's verdict — 77 of 127 sentences verbatim — and Fugu excluded for `finish: length`). I cannot verify the underlying model outputs from this bundle, only that the disposition table is internally coherent and that its measurements cite reproducible artifacts.

**One round-30 claim I could not reproduce from the bundle:** VALIDATION.md says the independent reviewer's mutation tests fail at 897/898 in a scratch copy, then pass at 898 after fixes. The bundled selftest floor is 898 and the arms are present; I found no missing arm. Not a finding — just unverified provenance.

---

## R1 — The crank (`bank/crank.mjs`)

### A2 — LOW: `budgetPlan` can leave the key below the floor after non-reveal sends

**Construct:** `bank/crank.mjs`, `budgetPlan` (lines ~277–300) and `planCostLamports`.

`budgetPlan` reserves `FEE_FLOOR_LAMPORTS` against the **reveal** budget: `room = lamports - planCostLamports(base) - floor`. But `planCostLamports(base)` counts only the base plan's signature fees, and `base` still contains `reschedule`, `capture`, `retireBurned`, `activate`, `preJoins`, `preExpires`, `split`, `distribute`, `claims`, `postExpires`, `joins`. After `budgetPlan` returns `ok`, `main()` sends **all** of those plus the kept reveals. The arithmetic guarantees `lamports - baseCost - revealCost ≥ floor` — so the post-pass balance is ≥ floor **only if every planned base transaction is actually sent and pays exactly one signature fee**. That is true today (every crank instruction is one-signed, and `planCostLamports` counts each planned action), so the invariant does hold for the plan as budgeted.

Where it leaks: `planCostLamports` uses `Math.ceil(n / k)` via `BigInt(Math.ceil(n / k))` on **Number** division of counts. Counts are small (< 2^53), so no precision bug. The real residual is narrower: if a base-plan send is skipped mid-loop (the reveal loop `break`s on skip/mismatch, but the claim/activate loops do not skip), nothing is under-counted. **On re-derivation I withdraw this as a defect in the current code**; the invariant `post-pass ≥ floor` holds for the plan as sent. What remains is a **documentation/robustness** point: the floor guarantee is coupled to `planCostLamports` staying an exact upper bound on what `main()` sends; any future instruction added to `main()` without adding it to `planCostLamports` silently breaks the reserve. The selftest arms check `planCostLamports(small) + 1 - spent(whole) >= floor`, which pins the current coupling. **Evidence if I were right about a break:** a selftest arm where `main()` sends an action not counted in `planCostLamports`; none exists today. **Fix (hardening, not repair):** assert in selftest that the set of `d('...')` instruction names sent by `main()` equals the set `planCostLamports` accounts for (it already pins the name list; extend it to the cost model).

### A4 — LOW: reveal-lane attribute read is not retried, and a persistently unreadable head vault stalls the FIFO with only `reveal_queue_stalled` after one pass

**Construct:** `bank/crank.mjs`, reveal loop (`how === 'read'` → `mintedAttributes` in try/catch → `break`).

If the FIFO-head vault's Core asset account is transiently unreadable (RPC blip) the reveal run breaks and the next pass retries — fine. But if the head vault's asset is **permanently** unreadable as `'other'` (e.g. an RPC that returns null for it), `revealAttrSource('other')` → `'skip'` → `break`, every pass, forever. `reveal_queue_stalled` pages after one pass of no movement, so it is loud, and reschedule does not apply (the window logic is separate). This is accepted-limit 7 class (wedged lane, paged). **Not a new defect; recorded so it is not re-filed.** The one real gap: `reveal_queue_stalled` requires `r1 < m1` (unrevealed exist) AND `r1 === r0`; a queue stalled on an `'other'` head with no new mints still pages. OK.

### A5 — INFO: `judgeDistributeRefusal` re-reads config at `'confirmed'` but the original plan used a config read at pass start; a distribution plus a `tighten_sweep` between plan and send could move `dist_epoch` and mask a genuine `PoolShort`

**Construct:** `bank/crank.mjs`, `judgeDistributeRefusal` + distribute send.

`PoolShort` is hard-coded `'fail'` regardless of epoch movement — correct. The race codes (`NothingToDistribute`, `BoostsExpireFirst`, `JoinWaitingFirst`) become benign iff `dist_epoch` or `last_distribute_at` moved. That is sound: only a real distribution moves both. I found no plan the program would refuse that the crank misclassifies as benign. **No finding.**

---

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### A3 — MEDIUM: `logGaps` is write-only; no detector ever reads it, and a truncated transaction whose logs were lost is never correlated with later state

**Construct:** `bank/alarm.mjs` main() (`looked.logGaps`, `next.logGaps`), `bank/detectors.mjs` (no consumer).

Round 29's M1 repair records every truncated-logs signature in `state.logGaps` (deduped, capped at 500). Round 30's verdict (C02) explicitly disposed this as "NOT A DEFECT; narrower than round 29's prescription". I re-file it **not** as the same claim but with a concrete consequence the disposition did not address:

`logGaps` entries are **never consumed by any detector, any report line, or `--audit`**. The only signal a human gets is the one-shot `log_coverage_gap` page at scan time. If that page's delivery fails (router down, `delivered = false`), the alarm keeps every cursor and re-sends next pass — good. But once delivered, the gap is only in `logGaps`, which nothing reads: not `report()`'s summary, not `--reconcile`, not any selftest assertion that a gap entry produces output. A `logGaps` list that grows to 500 and rotates old entries out loses the only record of which transactions lost event lines, with no report ever saying "N unacknowledged log gaps".

**Evidence if I am right:** `grep -n logGaps bank/*.mjs` shows writes in `alarm.mjs` only; no read path. Selftest has no arm asserting a `logGaps` entry surfaces in any output.

**Severity:** MEDIUM (detection hygiene on an immutable system; the gap itself is paged once, so this is about the audit trail, not about missing the event).

**Fix:** include `logGaps.length` (and the newest few signatures) in `report()`'s "NOT CHECKED" section; optionally page `log_gap_backlog` HIGH above a threshold; add a selftest arm that a planted `logGaps` entry appears in the report text.

### A6 — LOW: `detectUnsweptRoyalties` clock-restart on any balance fall lets a stranger pause the page indefinitely with dust withdrawals

**Construct:** `bank/detectors.mjs`, `detectUnsweptRoyalties` (`if (prevLamports !== null && BigInt(lamports) < BigInt(prevLamports)) since = nowSec`).

The detector restarts its "unswept" clock whenever the revenue PDA's lamport balance **falls** between passes, on the stated reasoning that only a sweep moves SOL out. But `sweep_sol_for_swap` is signed by the operator, and **the operator key is the one trusted hop** — a compromised or malfunctioning operator can sweep 1 lamport (the program requires `amount > 0` and `amount ≤ cap`, and the reserve must remain; a 1-lamport sweep is legal if cooldown elapsed) every alarm interval and keep `since` resetting forever while the real balance above reserve is never swapped. The guardian's stop and the ledger detectors (`unledgered_sweep` catches a sweep with no ledger row after grace) partially cover this: a 1-lamport sweep without a ledger row pages CRITICAL after 15 min. But a **ledgered** micro-sweep (operator runs `revenue.mjs`, which sweeps `sweepAmount` = 0 below `MIN_SWEEP_LAMPORTS`… actually `sweepAmount` returns 0n below the minimum, so `revenue.mjs` will not send it). The attack requires the operator to hand-craft a sweep below `MIN_SWEEP_LAMPORTS`, which the on-chain program permits (the program has no minimum; `MIN_SWEEP_LAMPORTS` is off-chain only). Such a sweep would be `unledgered_sweep` CRITICAL unless ledgered, and if ledgered, `sweep_amount_mismatch` only fires on a mismatch, so a honestly-ledgered 1-lamport sweep is quiet except that `cycleIsOpen` stays open until split. Net: the operator can grief the royalty pipeline but cannot steal beyond the accepted limit-10 bound, and every path is loud except a ledgered micro-sweep cycle, which is open-and-loud via `--audit`. **Downgrade to INFO / accepted limit 10 class.** Recorded so it is not re-filed as theft.

### A7 — LOW: `detectRedemptionRate` reads `burn.rate_ring` as strings and compares `now - BigInt(t) < window`; ring slots initialized to `'0'` are treated as ancient (correct), but a future-dated ring entry (clock skew) makes `remaining` overstate capacity

**Construct:** `bank/detectors.mjs`, `redemptionCapacity`.

`inWindow = ring.filter(t => now - BigInt(t) < window)`. If BURN ever writes a redemption time **ahead** of the alarm's `nowSec` (the alarm uses the chain Clock; BURN also uses `Clock::get()`), the entry reads as in-window (negative difference < window), which is the conservative direction (counts against capacity). So future entries make the alarm **more** likely to page, not less. **Not a defect.** Recorded to prevent re-filing.

### A8 — INFO: `WATCH` does not include `mint.last_sweep_at`, so a guardian- or vote-relevant sweep-timing change is only visible via `royalties_unswept`

`last_sweep_at` is in `WATCHED_KEYS` (produced by the reader) but not in `WATCH` (drift list). A change to `last_sweep_at` is routine (every sweep), so not watching it is correct. **No finding.**

---

## R3 — Layouts (`bank/layout.mjs`)

I re-derived the offsets for the pinned cross-program constants against the field lists:

- `MintConfig`: version(1)+collection(32)+governance(32)+pool_ata(32)+round_id(4)+opens_at(8)+closes_at(8)+price(8)+cap(4)+minted_this_round(4)+minted_total(8)+max_supply(8)+bank_treasury(32)+split_bps(2)+sales_stopped(1)+sweep_stopped(1)+guardian(32)+swap_operator(32)+sol_reserve_lamports(8)+bump(1)+max_sweep_lamports(8)+sweep_cooldown_secs(8)+last_sweep_at(8)+level_caps(20)+level_minted(20)+revealed_total(8)+payment_mint(32)+pob_collection(32)+pob_root(32)+charter_opens_at(8)+charter_closes_at(8)+charter_claimed(4)+bare_burns_retired(8)+…

  8 (disc) +1+32+32+32+4+8+8+8+4+4+8+8+32+2+1+1+32+32+8+1+8+8+8+20+20+8+32+32+32+8+8+4+8 = 8+1=9; +32=41 (governance ✓ matches GOV's OFF_MINT_GOVERNANCE=41); +32=73 (pool_ata); +4=77; +8=85; +8=93; +8=101; +4=105; +4=109; +8=117 (minted_total — GOV OFF_MINT_MINTED_TOTAL should be 117; SPEC says 141 in a comment, but the selftest scrapes the actual `OFF_` constants from the Rust and compares, so the comment is stale prose, not a pinned value). Continuing: +8=125 (max_supply); +32=157 (bank_treasury); +2=159; +1=160; +1=161; +32=193 (guardian); +32=225 (swap_operator); +8=233; +1=234 (bump); +8=242; +8=250; +8=258; +20=278; +20=298; +8=306 (revealed_total); +32=338 (payment_mint); +32=370 (pob_collection); +32=402 (pob_root); +8=410; +8=418; +4=422 (charter_claimed); +8=430 (bare_burns_retired at 430).

  SPEC's prose says GOV reads `bare_burns_retired` at 454 and `minted_total` at 141. My arithmetic gives 117 and 430. **This discrepancy is resolved by the selftest**: `bank/selftest.mjs` scrapes every `OFF_*` constant from the four Rust sources and asserts equality with `L.offsets()`. If my hand arithmetic is right and SPEC's prose numbers are stale, the selftest would fail unless the Rust constants are also 117/430 — in which case SPEC's prose is wrong but the code is consistent. **I cannot determine which without the Rust `OFF_` values, which are not in the bundle** (only MINT's lib.rs is bundled; GOV/BURN/SEAL lib.rs are not).

### A9 — MEDIUM (verification gap, not a demonstrated defect): GOV/BURN/SEAL program sources are not in the audit bundle, so the cross-program offset assertions cannot be independently re-derived here

**Construct:** `bank/selftest.mjs` offset block; SPEC prose ("GOV reads MINT's `minted_total` at 141, BURN reads `bare_burns_retired` at 454").

The selftest's offset gate is real (it scrapes `const OFF_X: usize = N;` from each program source and compares to `L.offsets()`), and it runs in `run-tests.sh`. But this off-chain bundle contains only `programs/cbob-vault-mint/src/lib.rs`. The SEEDS assertion (round 24 D6) and the offset assertions all depend on the other three programs' sources at test time. **This is a bundle-completeness observation for this pass, not a code defect**: the programs pass reads those files. The SPEC prose numbers (141, 454) disagree with my recomputation (117, 430); if the Rust constants match my recomputation, SPEC's prose is stale and should be corrected; if they match SPEC, my arithmetic is wrong. **Evidence that would settle it:** `grep 'OFF_MINT_MINTED_TOTAL\|OFF_MINT_BARE_RETIRED' programs/cbob-vault-gov/src/lib.rs programs/cbob-vault-burn/src/lib.rs`. **Fix:** correct SPEC's prose offsets to whatever the scraped constants are, or add a selftest arm that fails if SPEC's stated offset numbers (if kept) disagree.

The SEEDS assertion now exists (round 24 D6 gate is in the bundled selftest, scraping all 11 seeds). **Round 24 D6 is discharged.**

---

## R4 — Money arithmetic (`bank/accrual.mjs` vs MINT lib.rs)

I compared line-by-line against the bundled MINT source:

- `credit`: Rust `delta = avail * ACC_SCALE / w`; `owed += delta * w`. JS `credit` identical. ✓
- `owed_of`: Rust `weight * acc + carry - debt` (carry added before debt subtracted, with checked arithmetic). JS `pendingScaled`: `(weightOf(level) + boost) * acc + carry - debt`, throws on negative. ✓
- `claim` settlement: Rust pays `pending / ACC_SCALE`, sets `carry = pending - pay*ACC_SCALE`, `debt = weight * acc`. The crank's `planCrank` models a pre-expired vault as `atExpiry + LEVEL_WEIGHTS[level-1] * (acc - cfg.acc_scaled)` divided by ACC_SCALE — this matches: after `expire_boost`, the vault's weight is level-only and its debt/carry are re-based at the pre-distribution acc, so the distribution adds `level_weight * delta_acc`. ✓
- `ceil_sats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. JS `ceilSats` identical. ✓
- `available`: `balance - ceil(owed)`, floored at 0. ✓
- `reweigh`: JS mirrors Rust (`carry = owed`, `debt = new_weight * acc`). ✓
- Boost ring: Rust `advance_epoch` moves `boost_expiring[epoch % 64]` into `boosts_due`. The crank expires `dist_epoch >= boost_end_epoch` before distributing and `boost_end_epoch === dist_epoch + 1` after. This matches: a boost bought at epoch E with `epochs = N` ends at `E + N`; the distribution that advances epoch to `E + N` makes it due; the next distribution is refused until expiry. The crank's pre-expire catches `dist_epoch >= boost_end_epoch` (due now) and post-expire catches `boost_end_epoch === dist_epoch + 1` (will be due after this distribution). ✓

**No divergence found.** The host unit test (N1, 260 epochs through the program's own functions) covers the ring wrap. The 4-assertion expiry-budget gate is synthetic-genesis and says so.

### A10 — INFO: `planCrank`'s `retiringOwed` uses `pendingScaled` at the **current** `cfg.acc_scaled`, but `retire` on-chain runs before the planned distribution, so the freed amount is correct only if no distribution lands between plan and send

If another distribution lands between the crank's plan and its `retire_burned` send, the freed owed is larger than planned, and the crank's subsequent `distribute` plans against a stale `owedAfterRetire`. The on-chain `distribute` computes `avail` from the live pool and owed, so the crank's plan being stale only affects whether it **sends** a distribute, not the correctness of the distribute itself. A missed distribute is caught next pass. **Not a defect.**

---

## R5 — The swap and revenue cycle

### (a) Oracle math — verified

`oracleFloor`: `sats = lamports * sol.price * 10^(es-eb) / (btc.price * 10)`. With both expo = -8, `e = 0`, so `sats = lamports * sol_price / (btc_price * 10)`. Units: lamports (1e-9 SOL) × (SOL/USD at 1e-8) / (BTC/USD at 1e-8) / 10 → (1e-9 × 1e-8 / 1e-8 / 10) BTC = 1e-10 BTC… let me redo: SOL amount = lamports/1e9. USD = lamports/1e9 × sol.price/1e8. BTC = USD / (btc.price/1e8) = lamports × sol.price / (1e9 × btc.price). Sats = BTC × 1e8 = lamports × sol.price × 1e8 / (1e9 × btc.price) = lamports × sol.price / (10 × btc.price). ✓ Matches the code with `e = 0`. For general exponents: sats = lamports × (sol.price × 10^es) / (1e9 × btc.price × 10^eb) × 1e8 = lamports × sol.price × 10^(es - eb + 8 - 9) / btc.price = lamports × sol.price × 10^(es-eb) / (btc.price × 10). ✓ The code's `e >= 0` / `e < 0` branch handles both signs in BigInt. Rounding is floor (BigInt division), which is the conservative direction for a floor. `satsPerLamport` uses Number floats for the deviation comparison only; at SOL/BTC ratios the float precision (~1e-16 relative) is far below the 100 bps gate. **No overflow path:** all BigInt until the final Number conversion of a ratio.

### (b) Pyth verification — verified with one note

`readPyth` checks owner = receiver program, verification level byte = 1 (Full), feed id match, then reads price/conf/expo/publishTime at offsets 8+32+1+32 = 73 (price i64), 81 (conf u64), 89 (expo i32), 93 (publishTime i64). The `PriceUpdateV2` layout: 8-byte disc + 32-byte write_authority + verification_level (Full = tag byte 1, Partial = tag 0 + u8) + PriceFeedMessage. For Full, the level is one byte. ✓ The fork test rewrites publishTime at offset 93, consistent.

**Note (not a finding):** ownership by the receiver program plus correct derivation is the trust anchor. The receiver program is upgradeable (accepted limit 10(d)); a malicious receiver upgrade could write arbitrary data into the derived account. This is disclosed. The question "can anyone write a fully-verified update with an old publish_time or a chosen price into that account" — **no**, only the receiver program can (account owner check), and the receiver only accepts Wormhole-verified messages; but the receiver's upgrade key can change that. Disclosed in limit 10(d).

### (c) Deviation filter — verified

`orcaSpot = (sqrtPrice / 2^64)^2` in raw units (B per A). Orca pool is wSOL(A)/cbBTC(B), so spot = cbBTC-units per lamport-unit… raw: B_raw per A_raw. A_raw = lamports, B_raw = sats. So spot = sats per lamport. ✓ `meteoraSpot = 1 / (1 + binStep/10000)^activeId`: DLMM pair is X=cbBTC, Y=wSOL, price = Y per X = (1+bs)^id lamports per sat, so sats per lamport is the inverse. ✓ Direction of swap (Y→X, selling SOL for cbBTC) matches `meteoraBinArrayIndexes` going UP (buying X with Y moves active bin up). ✓

### A11 — LOW: `meteoraSpot` uses `Math.pow` via `**` on a float for `activeId` up to ~6000; precision is adequate (~1e-13 relative error) for a 100 bps gate, but the deviation comparison is asymmetric in float rounding

`deviationBps = Math.abs(pool - oracle) / oracle * 10000`. At exactly 100 bps, float rounding could place a pool at 100.00000000001 bps (refused) or 99.99999999999 bps (used). The economic difference at the boundary is nil, and the on-chain 150 bps floor is the real protection. **Not a defect; recorded.**

### (d) Minimum out — verified

Orca `swap` data: disc(8) + amount_in u64 + other_amount_threshold u64 + sqrt_price_limit u128 + amount_specified_is_input bool + a_to_b bool. The builder writes `u64(lamportsIn), u64(minSats), u128(ORCA_MIN_SQRT_PRICE), [1, 1]`. ✓ Meteora `swap`: disc + amount_in + min_amount_out. ✓ Both carry the same `guaranteed = m2.f.minSats`. The re-quote drift check (`MAX_REQUOTE_DRIFT_BPS = 200`) compares the post-sweep oracle expectation against the pre-sweep quote and refuses before swapping; the on-chain floor is the swap-time oracle minus 150 bps. These are different floors for different purposes, correctly.

### (e) The judge — verified complete against the eight round-25 tampers

I walked `judgeSwapInstructions` against every construct in `swapInstructions`:
- Instruction count exactly 7, order pinned by destructuring `[cu, cw, wrap, sync, cc, sw, close]`.
- CU limit exact (400,000, discriminator 2, no keys); any `setComputeUnitPrice` (discriminator 3) flagged anywhere.
- Both ATA creates checked for exact key list and `CreateIdempotent` data `[1]`.
- Wrap: System transfer discriminator 2, exact lamports, exact keys `[owner, ownWsol]`.
- SyncNative exact.
- Swap: venue program, data length (42 Orca / 24 Meteora), discriminator, amount at offset 8, floor at offset 16, Orca sqrt-price-limit and both bools; pool key position, input key position (Orca 3 / Meteora 4), output key 5 on both, signer position (Orca 1 / Meteora 10).
- Close: exactly one Token close, exact keys `[ownWsol, owner, owner]`.
- Token instructions restricted to 17 (SyncNative) and 9 (Close).
- Second signers flagged.

**One residual the judge cannot catch (disclosed in limit 10):** a tampered `bank/swap.mjs` can edit both builder and judge. The post-swap delta check in `revenue.mjs` (`delta < guaranteed` throws, cycle stays open) is the backstop, and it reads the operator's actual cbBTC ATA balance. ✓

### (f) Account derivation — verified against the pinned layouts

Orca tick arrays: `["tick_array", pool, start_string]` under the Whirlpool program; starts are `floor(tickCurrent / (88 * tickSpacing)) * (88 * tickSpacing)` minus 0/1/2 spans for a_to_b. ✓ At a tick-array boundary, `floor` places the current tick in the array that starts there; the next two below cover the swap. An uninitialized tick array causes the Orca program to refuse (the swap fails, `classifySendFailure` reads it as refused, Meteora is tried). ✓ Meteora bin arrays: `["bin_array", pool, i64 index]`, indexes `[i, i+1, i+2]` for Y→X. Bitmap extension: passed as program id when absent (Anchor optional convention). `host_fee_in` as program id. Event authority and two token programs present. ✓

### (g) wSOL handling — verified

Wrap exactly `lamportsIn` via System transfer + SyncNative; close after swap. If the operator's wSOL ATA pre-exists with a balance: `CreateIdempotent` is a no-op, the transfer adds `lamportsIn`, SyncNative syncs the **total** balance, but the swap's `amount_in` is exactly `lamportsIn` — so a pre-existing balance is **not** swapped, and the final `CloseAccount` sweeps the remainder (including the pre-existing balance) back to the operator as SOL. ✓ A frozen wSOL ATA would cause the transfer or close to fail; the cycle stays open. A delegated wSOL ATA: the close is signed by the owner, which is sufficient. ✓

### (h) Failure and retry — verified

`classifySendFailure`: preflight refusal → refused; landed-with-error → refused; expired-and-no-status → refused; landed-and-ok → landed; anything else → unknown (cycle stays open). The venue loop only tries Meteora on `refused`, never on `unknown`. A confirmation timeout on a landing swap: `statusOf` returns confirmed/finalized with `err: null` → `landed`, recorded. Double-swap requires the operator to hand-retry against an open cycle, which the open-cycle guard refuses. ✓ The ledger stays open until `returnedSats > 0` AND (`splitSig` OR `splitByOther`). ✓

### (i) Extraction bounds within tolerance

- **Sandwich:** the swap is sent through one RPC (limit 10(b)); a validator or RPC operator seeing the pending swap could sandwich. The 150 bps floor bounds the fill to oracle − 1.5%. At 10 SOL per cycle, max extraction per cycle ≈ 150 bps × (10 SOL in cbBTC) ≈ 0.15 SOL equivalent, plus any oracle staleness (180 s, conf ≤ 30 bps). Per month at 4 cycles/day: ≈ 18 SOL equivalent worst case if every cycle is sandwiched to the floor. This is the disclosed floor behaviour, not an added finding.
- **Pool pushed to the 100 bps gate edge:** pushing Orca (~$10M TVL) 1% costs far more than the ~0.12 SOL capture (round 30 C08). Meteora (~$0.9M) is cheaper to push but is only used when Orca refuses. **Not a new finding.**
- **Stale-but-accepted oracle:** 180 s + 30 bps conf + future ≤ 30 s. Bounded, disclosed.
- **Operator key worst case:** 10 SOL per 6 h cooldown = 40 SOL/day until guardian stops, disclosed (limit 10).

---

## R6 — Gates

### A12 — LOW: `scripts/audit-coverage.sh` content gate trusts `audits/roundN/MANIFEST-*.json` `head` and `auditors >= required` fields that are written by the runner, and the verdict check reads only the first five lines

**Construct:** `scripts/audit-coverage.sh`, the Python `stale` block.

The gate requires: a MANIFEST exists for the round+focus, `m['head']` is set, `m['auditors'] >= m['required']`, a VERDICT file exists, and the first five lines do not contain `INCOMPLETE QUORUM|QUORUM NOT MET|QUORUM IS NOT MET`. It then credits every file in the script's TARGETS at that head.

Weaknesses:
1. The MANIFEST is written by the same process that runs the round; a runner that writes `auditors: 8, required: 6` without eight substantive reports passes. The round-30 verdict shows the triage is independent, but the **gate** does not verify the verdict's quorum count matches the manifest's — it only checks for the absence of a failure string in the first five lines. A verdict that records "quorum 5/8" in line 6 or phrased differently ("did not reach quorum") would not be caught.
2. The bundle is read from `scripts/auditN.ts` **at the manifest's head**, which is correct against retroactive TARGETS edits. But the verdict check does not verify the verdict is about the same head.

**Evidence if I am right:** a synthetic `audits/round99/MANIFEST-offchain.json` with `auditors: 99, required: 6`, a VERDICT whose first five lines say "ALL GOOD" and whose body says "quorum not met", and a TARGETS list — the gate would credit it. **Severity LOW** because the process (independent triage) is the real control and the gate is a tripwire; but the tripwire has a known bypass. **Fix:** require the verdict to contain a machine-parseable quorum line (e.g. `QUORUM: 6/8`) anywhere, and fail if absent or below required; or have the manifest carry the triage's counted substantive-report list and check its length.

### A13 — LOW: `scripts/run-tests.sh` swap-fork and mainnet-probe skip paths are guarded by `CBOB_SHIP_GATE`, but the ship gate is not set in the bundled runner invocation, so a no-network run silently skips both

**Construct:** `scripts/run-tests.sh`, the two `if node -e "...dns..."` blocks.

This is by design (the gate is opt-in) and SPEC says the certifying run must show the probe ran. **Not a defect; the control is procedural and stated.** Recorded.

### A14 — INFO: `tests/expiry-budget.mjs` floor is 4 and the test asserts exactly 4; the synthetic genesis writes `MintConfig` with `boosts_due: 20` and 20 records, but does not verify the `boost_expiring` ring consistency after expiry

The test checks `boosts_due === 0`, `boosts_active === 0`, `total_active_weight === 40n` (20 × level weight 2), `boost_weight_total === 0n`, and each record's `boost_weight === 0`. It does not check `boost_expiring` slots are zeroed, but `expire_boosts` does not touch the ring (the ring was already consumed by `advance_epoch` when the boosts became due). In the synthetic genesis the ring is all zeros and `boosts_due` is set directly, so there is nothing to check. **Not a defect.**

### A15 — LOW: `bank/selftest.mjs` signer-set gate scans `bank/`, `scripts/`, `tests/` but not `launch/`, and `launch/create-cbob-token.mjs` signs with the release key and the mint key

**Construct:** `bank/selftest.mjs`, the `signerSet` block; `launch/create-cbob-token.mjs`.

The selftest explicitly acknowledges this ("launch/ is not scanned", round 24 D7). The release key (`bank/keys/cbob-release.json`) is the whole $CBOB supply (accepted limit 56). The mint key (`cbob-mint.json`) is only used at creation and the mint authority is revoked in the same transaction. **The exclusion is disclosed and the risk is accepted limit 56.** However, the gate's stated purpose ("exactly TWO signers exist") is false as a statement about the repo; it is true about the three scanned trees. The selftest's own prose says so. **Downgrade to INFO; recommend the gate's assertion message say "in bank/, scripts/ and tests/" (it does).** No change needed.

---

## The four questions on ACCEPTED LIMITS

### 1. Is any limit WORSE than stated?

**Limit 9 (foreign nested assets):** as stated, plus the round-29 D2 consequence (an activated orphan dilutes payouts forever) is now stated in SPEC. I verified `retire_redeemed` requires a BURN CPI and `retire_burned` requires the Core tombstone; an orphaned activated vault (owner = another vault's PDA or its own) can reach neither. **The dilution is permanent and there is no on-chain path to remove the weight.** The limit text says "a nested vault left activated dilutes every other vault's payouts forever". This is accurate. One addition the text does not state: **the orphan also blocks nothing** — distributions continue, claims continue (paying into the orphan's ATA). So the cost is pure dilution, not a halt. As stated.

**Limit 32 (rate limit ring):** the ring holds 64 entries and covers live supply up to 3,047 (64 / 0.021). Above that the cap is stricter. The drain-time figure in SPEC (209 hours) assumes constant live supply; live supply falls as redemptions burn vaults, so the cap falls and the drain accelerates slightly. The 209 h figure is conservative (upper bound). As stated.

**Limit 10 (swap hop):** I verified the extraction bound in R5(i). The stated bound (cap × windows until guardian stop) holds. One unstated sub-case: **the operator can sweep legally at any amount > 0 up to cap**, so a compromised operator could sweep dust amounts repeatedly (one per cooldown) that are each below `MIN_SWEEP_LAMPORTS` and thus never picked up by `revenue.mjs`; each such sweep without a ledger row pages `unledgered_sweep` CRITICAL after grace. So it is loud, not silent. As stated.

**Limit 46 (PoB hot key):** as stated. I verified `claim_charter_vault` passes `pob_extra` accounts as non-signers and Core decides. The per-asset plugin blind spot (alarm watches the collection, not 240 assets) is stated. As stated.

### 2. Is anything listed as a limit not actually a limit?

**Limit 27 (claim between bare burn and retirement):** the crank retires burned vaults first every pass, and never pays or joins a positively burned vault. The window between a bare burn and the next crank pass (up to one hour for the full pass; the reveal lane does not retire) is real, so the limit stands. However, **`claim` on-chain still does not check liveness** — anyone can hand-send a claim naming a burned vault in the window. The limit is real.

**Discharged item 54 (compute):** the 168,343 CU measurement for the four-instruction redemption is stated as measured. I cannot re-verify from the bundle, but the suite arms (10.5, 10.6, 10.6a) are referenced. Discharge stands on the cited measurement.

### 3. Is any DISCHARGED item not actually discharged?

**Item 51 ($CBOB boost):** discharged with residue (boost timing). I verified the residue is stated. The `BoostTermsMoved` one-sided rule (against-buyer moves refuse; in-favour moves land at new terms) is stated in the discharge text and in the holder guide. Discharged.

**Item 33 (operator replacement apply):** discharged by stage 3c suite arms 3c.K5 / 6.20g. The suite is not in this bundle but the arms are named. Discharged on citation.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**Item 22 (dress rehearsal):** still OPEN; `launch/mainnet-init.json` has `charter_opens_at` and `lock_deadline` as OPEN/null. The rehearsal value set (`launch/rehearsal-init.json`) is stated as "still to write" in item 53. I checked the bundle: **`launch/rehearsal-init.json` is not present**, consistent with "not built". Not quietly accepted.

**Item 38 (initialize values):** `charter_opens_at` and `lock_deadline` are null/OPEN. `check-launch-params.mjs` refuses while anything is OPEN. Not quietly accepted.

**Item 50 (holder surfaces):** the redeem page, deposit-address page, and poster sender are absent from the bundle. `bank/redemption-poster.mjs` has no sender (self-asserted in its own selftest). Not quietly accepted.

**Item 52 (pool/Squads/revenue ATAs):** road step 10, not yet run. Not quietly accepted.

**Item 53 (rehearsal):** the rehearsal value set and the rehearsal mode in `check-launch-params.mjs` are stated as not built. I checked `check-launch-params.mjs`: it has no `--rehearsal` mode. Consistent. Not quietly accepted.

---

## Findings summary

| ID | Severity | Construct | Summary |
|---|---|---|---|
| A3 | MEDIUM | `bank/alarm.mjs` `logGaps`; no consumer in `bank/detectors.mjs` | `logGaps` is written but never read by any detector, report, or audit path; the only signal is the one-shot page at scan time. A delivered page leaves the gap list invisible thereafter; the 500-entry cap silently rotates old gaps out. Fix: surface `logGaps` count and recent signatures in `report()`; add a selftest arm. |
| A9 | MEDIUM (verification gap) | `bank/selftest.mjs` offset block; SPEC prose offsets (141, 454) | GOV/BURN/SEAL sources are not in this off-chain bundle, so the cross-program offset assertions cannot be independently re-derived here. SPEC's prose offset numbers disagree with my recomputation of MintConfig layout (I get 117 for `minted_total`, 430 for `bare_burns_retired`). The selftest scrapes the real constants, so the code is likely consistent and SPEC's prose is stale; but this pass cannot confirm. Fix: correct SPEC prose to match the scraped constants, or add an arm that fails on prose/constant disagreement. |
| A2 | LOW (hardening) | `bank/crank.mjs` `planCostLamports` / `budgetPlan` | The floor-reserve invariant depends on `planCostLamports` remaining an exact model of everything `main()` sends. No current break; add a selftest arm tying the sent-instruction name set to the cost model. |
| A6 | LOW → INFO | `bank/detectors.mjs` `detectUnsweptRoyalties` | A compromised operator can legally sweep sub-`MIN_SWEEP_LAMPORTS` amounts (the on-chain program has no minimum) to reset the unswept clock; every such sweep without a ledger row pages `unledgered_sweep` CRITICAL, so it is loud. Accepted-limit-10 class; recorded to prevent re-filing as theft. |
| A12 | LOW | `scripts/audit-coverage.sh` quorum check | The gate checks only the first five lines of the verdict for a failure string and trusts the manifest's `auditors` count; a verdict recording quorum failure elsewhere, or a manifest with inflated counts, passes. Fix: require a machine-parseable quorum line anywhere in the verdict. |
| A15 | INFO | `bank/selftest.mjs` signer-set gate; `launch/create-cbob-token.mjs` | The signer-set gate excludes `launch/` by explicit acknowledgment; the release key there is accepted limit 56. No change needed; the gate's message already scopes itself. |
| A4, A5, A7, A8, A10, A11, A13, A14 | INFO / not-a-defect | various | Investigated and disposed above; recorded to prevent re-filing. |

**No CRITICAL or HIGH findings in this pass.** The round-30 repairs hold at every site I checked. The consecutive-clean counter is not mine to move; this pass found one MEDIUM (A3) and one MEDIUM verification gap (A9), so it is not clean.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concrete, in priority order:

1. **Run the dress rehearsal exactly as item 22 names it, and record the signatures.** The five named items (crank live passes, alarm in rehearsal, one full revenue cycle through each pool, one forced post-sweep failure walked through hand recovery, one DAS read of a burned Core asset) are the only things that have never been exercised against a live cluster. The swap fork proves the swap; nothing proves the crank at 2,100 records, the alarm's RPC load, or the revenue cycle's confirmation behaviour under real latency. Do this before the lock, at throwaway ids, with the rehearsal value set that item 53 says is still to write.

2. **Build the redeem page (item 50) before the lock, or accept in writing that items 9 and 44 have no preventive control at launch.** The sweep helper exists and is tested; `judgeRedemptionCoverage` exists; what is missing is the page that runs them before a holder signs. Every day after launch without it, a holder who redeems by any other client can destroy undeclared holdings, and an activated nested vault dilutes every other holder forever with no on-chain remedy.

3. **Get the two OPEN values (charter opening date, lock deadline) from Gary and run `check-launch-params.mjs` to zero refusals before the signing ceremony.** The checker validates the JSON, not the signed transaction (round 24 A6); whoever builds the four `initialize` transactions must build them from that file, and the ceremony should include a read-back of every initialized value against the checker's pinned list, with the read-back recorded.

4. **Move the $CBOB release key off this box before the first boost vote, or accept limit 56 with a named owner.** The key is in the nightly backup and on the same host as the alarm, the ledger, and the swap operator key. A box compromise takes all of them. The limit is accepted, but the acceptance should be Gary's explicit, dated decision, not a default.

5. **Fund the three cbBTC accounts (item 52) and the revenue address rent in the same session as `initialize`, and verify each by read-back before the first paid mint.** A first paid mint into a missing revenue ATA fails loud, but a first split into a missing pool ATA also fails loud, and both are one `createAssociatedTokenAccountIdempotent` away; doing them at init is cheaper than discovering the gap at the first sale.

6. **Correct SPEC's prose offset numbers (finding A9) against the scraped constants before the programs pass reads them again.** A stale number in SPEC is how a future round files a false CRITICAL about a cross-program read; the selftest already has the truth, so this is a one-line fix per number.

7. **Surface `logGaps` in the alarm report (finding A3) before the lock.** After the lock, a truncated-logs transaction that loses a `CBOB_REDEEMED` or `CBOB_REVEAL_RESCHEDULED` line is unrecoverable; the gap list is the only record, and nothing reads it today.