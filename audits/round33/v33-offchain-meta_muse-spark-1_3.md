# Off-chain + MINT + sweep pass: NOT CLEAN; QUORUM of one

Audited HEAD `ec4a0e1` (round-32 repairs) plus docs `18dbff6`. No validator booted, no live job imported; all claims checked against source as shipped. `bank/selftest.mjs` arms cited by line; MINT cites are `programs/cbob-vault-mint/src/lib.rs`.

## R0. Round 32's verdict and whether its repairs hold

Round 32 off-chain was `NOT CLEAN; QUORUM MET`, 0 CRITICAL / 0 HIGH / 0 MEDIUM, 4 LOW + 2 INFO. Its repair commit `ec4a0e1` is this tree.

Independently verified at this tree:

* **L1 — state-derived sweep check — HOLDS.** `detectSweepState` (`bank/detectors.mjs`) judges `mint.last_sweep_at` every pass, one-sided window `start-120s … start+min(1h,cooldown/2)`, missing baseline `0`, `sweep_unledgered_state` in `ALARM_KINDS` as `once`, alarm persists `sweepJudgedThrough` and rolls it back when undelivered, selftest R32-L1 arms both directions. No re-file.
* **L2 — throwing reads — HOLDS.** `bank/alarm.mjs` per-program listing `try/catch` and per-signature `try/catch` around `readParsedTransaction` produce `tx_unreadable`, hold cursor/backlog, finish the pass. Selftest R32-L2 arms. No re-file.
* **L3 — gap eviction — HOLDS.** `detectLogGaps` uses a `Set`, never drops entries newer than the watermark, trims only the reviewed prefix, escalates `>2000` to CRITICAL, review instruction says LAST signature. Selftest R32-L3 arms. No re-file.
* **L4 — coverage headline — HOLDS.** `scripts/audit-coverage.sh` `first_line_quorate` is exact-anchored, focus-matched even in combined `VERDICT.md`, FOCUS-split found by shape failing closed, `--selftest` 14/14. No re-file.
* **D1/D2 — expiry count + gap order — HOLD.** `bank/selftest.mjs` checks every SPEC `expiry-budget` occurrence and `tests/expiry-budget.mjs` count vs `EXPIRY_FLOOR`; `detectLogGaps` order documented. No re-file.
* **C02/C03/C04/C05 dispositions — AGREE.** Crank sends no ComputeBudget (true) but suite L.5/L.12b land the R28.A1 and full-budget reveals with no limit; Meteora `status` unread is loud hand-recovery; partial-page advance is RPC-trust boundary; exactly-2000 `scan_gap` is fail-closed.

No surviving defect from L1-L4/D1-D2 found. What follows is new.

## R1. The crank

### LOW-1: a split assumed into the distribution wastes a fee and pages on the common path
**Construct:** `bank/crank.mjs` `planCrank` — `splitToPool`, `avail`, `plan.distribute`.
**What happens:** `avail` is computed as `pool.amount + splitToPool - ceil(owedAfterRetire)`. `plan.distribute=true` is set on that sum. `main()` then sends `split_revenue` and `distribute` as two serial transactions. If the split is refused — frozen/absent destination raced in, `payDecimals===null`, or a stranger split first leaving `NothingToSplit` benign — the distribution still sends against a pool that does not hold the assumed balance and is refused `NothingToDistribute`.
**Gain:** one wasted fee per such pass plus a `distribute (monthly, free)` failure on the lane stream; at the month boundary it is the page operators learn to ignore.
**Evidence if true:** dry-run plan with `pool.amount==0`, `revenue.amount==1000`, healthy destinations shows `split:true, distribute:true`; land a `split_revenue` refusal first on a fork and the following `distribute` returns `NothingToDistribute`. Both branches are in source; no test drives split-fails-then-distribute.
**Fix:** plan `distribute` on pool-alone `avail`, and add a second conditional distribute on pool+split that is sent only if the split landed; or re-read the pool after the split and skip with `benign` + `judgeDistributeRefusal` instead of `fail`.

### INFO-1: tick + eligible-wait interaction is correct only because joins run first — undocumented
`plan.distributeKind==='tick'` with `preJoins.length>0` looks like `JoinWaitingFirst` until the send order (pre-joins → distribute) is read. No defect, but the planner comment says only "they join after it" for the after-case. Name the before-case so a future reorder does not create LOW-1's sibling.

## R2. The alarm

### LOW-2: corrupt supply counters read as quiet
**Construct:** `bank/detectors.mjs` `redemptionCapacity` → `detectRedemptionRate`.
```js
if (live < 0n) return null; // + null on bad window/ring
// detectRedemptionRate: if (!c) return [];
```
`minted_total - burned_total - bare_burns_retired < 0` is impossible by construction — it means a counter moved the wrong way, the exact class `pool_insolvent` pages for. Here it returns `null`, which the rate detector reads as "unreadable, quiet". Same for a malformed `rate_ring`.
**Gain:** a supply-accounting fault silences the 2.1%/hour monitor instead of paging.
**Evidence if true:** synthetic `mint.minted_total=3, burn.burned_total=5` yields `[]`, no finding; selftest has no negative-live arm.
**Fix:** return a distinct `redemption_window_unreadable` HIGH on `live<0` or malformed ring/window, like `pool_unreadable`.

Routine states paging every pass: none found. `sweep_cooldown_wedged`/`sweep_cap_wedged` are `INFO`, freezes transition to `INFO` after the first page, `joins_waiting` is `INFO`, idle windows return `[]` per R22-A3 arm.

## R3. Layouts

No defect. `STRUCTS` equals each `pub struct` field-for-field and type-for-type, mistyped/added-field/retyped arms fail, every `OFF_*` in MINT/BURN/GOV is scraped and compared with none unchecked (L2 arm), `LEVEL_WEIGHTS`/`ACC_SCALE`/`REVEAL_WINDOW_SLOTS`/`readySlot` scraped from Rust (L3 arm, hand-worked values), all 11 seeds scraped (D6 arm), versions and `BOOST_RING` scraped (L6 arms), `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` evaluated from Rust less padding (L13c arm), `bool`/version/discriminator/truncation refusals armed, collection hash blind to counters but not royalty. A struct change cannot slip past without turning `bank/selftest.mjs` red.

## R4. Money arithmetic

No divergence found. `credit` / `pendingSats` / `pendingScaled` / `reweigh` / `debtAtActivation` / `ceilSats` / `available` match MINT `credit` / `owed_of` / `reweigh` / `join` / `ceil_sats` line-for-line in BigInt; crank expires `dist_epoch>=end` before and `end==dist_epoch+1` after; alarm pages `boosts_stalled` and watches `cbob_mint`/`max_boost_weight`/`max_boost_epochs` as CRITICAL drift with `boost_price/weight/epochs` as HIGH. The `retire`-not-mirrored header correctly names no mirror.

## R5. Swap + revenue cycle

### (a) Oracle math — HOLDS
`num=lamports*sol.price*10^e`, `den=btc.price*10`, floor `*9850/10000` floored twice. `satsPerLamport` is display-only. `Number()` conversions hold ~1e10-scale Pyth prices exactly (2^53≈9e15); loss would need prices 1000× live, outside any tradable market. Floor is below an honest pool after 0.16% fee + royalty-size impact per fork SW.1/SW.4/SW.8/SW.9.

### (b) Pyth verification — HOLDS with stated residue
Offsets recomputed: `8+32+1+32+8+8+4+8=101`, price@73/conf@81/expo@89/publish@93 — matches code. Owner must be receiver, level must be `1` (Full), feed id must match, age ≤180s on chain Clock, future ≤30s, confidence ≤30bps each feed, price>0. Ownership+PDA does **not** stop replay of a once-valid Wormhole VAA within the age window — an attacker can re-post a 100s-old favorable price. That is inside limit 10's "bounded, not removed" and the pool-agreement + floor bound it; not a new bypass, but the reason the floor must stay 150bps.

### (c) Deviation filter — HOLDS
`orcaSpot=(sqrt/2^64)^2` sats/lamport for wSOL→cbBTC; `meteoraSpot=1/(1+step/1e4)^id` sats/lamport for Y→X. Directions correct against pinned mint orders, both readers refuse reversed mints. Double error at ~1e-4 bps is 6 orders below the 100bps gate; 99-vs-101 arms pass through `market()`.

### (d) Minimum out — HOLDS
Same `f.minSats` from the same `market()` read rides Orca `other_amount_threshold` (u64@16) and Meteora `min_amount_out` (u64@16), in raw sats as each program expects. Selftest M1 arms pin both slots.

### (e) Judge — HOLDS for theft, thin on DoS-only fields
`judgeSwapInstructions` requires the exact 7-instruction sequence, CU `400000` with no price, both ATAs for the operator, exact wrap amount, `SyncNative`, venue swap amount/threshold/direction/price-limit, input key 3/4 and output key 5 as operator accounts, authority signer, single close last, no other Token instruction. All eight round-24 tampers refused by name on both venues. **Residue (INFO):** it does not pin Orca vaults A/B, oracle, tick arrays, or Meteora reserves/oracle/bitmap/bin arrays/event authority/token programs. A wrong value there refuses on-chain (fee lost) but cannot steal — output/amount/floor/signer are pinned and the post-swap delta check (`delta<guaranteed` throws, cycle open) catches a value-moving miss. Pin them for defense in depth if touched.

### (f) Derivation — HOLDS
Orca `tick_array` PDA `['tick_array',pool,start]` with current-then-two-below for `a_to_b`; oracle PDA `['oracle',pool]`; vaults from pool account. Meteora `bin_array` PDA `['bin_array',pool,i64-LE]` with active-then-two-above for Y→X; bitmap `['bitmap',pool]` or program-id-as-None; `host_fee_in` None; event authority `['__event_authority']`. Boundary starts (`s0-span`, `i+1/i+2`, negative-id floor) armed. Uninitialised array refuses on-chain (loud, hand-recovery class C03).

### LOW-3 (g): any pre-existing wSOL balance bricks every swap until unwrapped by hand
**Construct:** `bank/swap.mjs` `swapInstructions` always ends with `closeAccount(operatorWSOL→operator)`; `bank/revenue.mjs` never unwraps before wrapping.
SPL Token `CloseAccount` refuses a source with `amount!=0`. After any interrupted cycle (swap refused after wrap, or a prior dust deposit), the operator wSOL ATA holds `prior>0`. The next cycle wraps `lamportsIn` on top, swaps exactly `lamportsIn`, leaves `prior`, and its close refuses — so the whole transaction reverts, every cycle, until a human unwraps. The runbook says "read wSOL balances" but no automatic step clears it, and the judge forbids any extra instruction that could.
**Gain:** liveness halt of the royalty pipeline (no theft; floor still enforced when it lands).
**Evidence if true:** fund operator wSOL ATA with 1 unit on the fork, run the honest `swapInstructions`, simulation/landing fails at instruction 6 `CloseAccount`; selftest has no non-zero-prior arm.
**Fix:** before building, read operator wSOL balance; if non-zero, send a standalone unwrap (close or `SyncNative`+transfer-out) first, or use a fresh ephemeral wSOL account per cycle instead of the operator ATA.

### (h) Failure/retry — HOLDS
Orca first, Meteora only on `refused` (preflight/on-chain-failed/expired-absent via `classifySendFailure` + status lookup); `unknown` throws and never tries the next venue; open-cycle guard stops a second sweep/swap; `pending*Sig` are evidence-only; `closesCycle` + delta + split guards keep the ledger open until return+split proven. No double-swap path found.

### (i) Tolerance bound — within stated limits
100bps skip + 150bps floor ≈ up to ~1.5% under oracle per cycle plus oracle error, ~0.18 SOL on a 10 SOL cycle (~$20 at $120 SOL), ~$80/day at 4 cycles/day, against ~4.4 BTC in vaults at full census. Immaterial per cycle/month; material only as permanent rate if the pools are persistently pushed to the gate edge — which the deviation skip is meant to refuse. Operator worst case remains cap×windows until `emergency_stop_sweep` (10 SOL/6h ≈40 SOL/day at ruled values), never vault/pool/sale funds; ledger cannot close a failed cycle as shut (`sendRejected` without `sweepSig`, `rejected_row_has_sweep`/`sweep_on_rejected_row`/`unledgered_sweep` tripwires).

## R6. Gates

No vacuous floor, no unarmed repair, no gate-5 gap found:

* `run-tests.sh` floors (`MIN_ASSERTIONS`/`DET`/`ALLOC`/`POSTER`/`MAINNET`/`LAUNCH`/`POB`/`SIM`/`SWAP`/`EXPIRY`) must EQUAL counts; SPEC every-occurrence map checked; `audit-coverage.sh --selftest` 14/14; `build-mainnet.sh` proves four INIT_AUTHORITY rejections + localnet acceptances and sweep byte-identity to both `$CACHE/ln` and `target/deploy`; `cron-install.sh` installs exactly 6 tagged jobs, preserves `--live` only from tagged uncommented lines, hourly revenue line held to `REVENUE_CRON_PERIOD_SECS` < ruled cooldown, rehearsal tree refused.
* Round-24 "every repair armed both ways" spot-checked: L1/L2/L3/L6b/I1/I2/H1, R30-L2, R31-L1/L2, R32-L1/L2/L3 all have fire + quiet arms; the one-sided `PoolShort`-never-benign and `refusedSig`-never-`sweepSig` arms are present.

## Accepted limits — the four questions

1. **Worse than stated?** No limit found worse than its text. L1's flood price (~0.01 SOL/pass) now has the `sweep_unledgered_state` backstop; L3's eviction is closed; limit 10's "not a hard bound" and 1.5% guide language match the floor math.
2. **Listed but not a limit / already closed?** None. Items claimed closed (14,19,30,31,33,51,54,12/17,1a-24) remain closed at this tree.
3. **DISCHARGED not discharged?** None. 51 (boost) and 54 (compute) behave as discharged text says.
4. **OPEN treated as accepted?** No. 22 (live distribution + both-venue revenue + forced recovery), 38 (charter/lock dates OPEN in `mainnet-init.json`), 50 (redeem page/poster sender), 52 (pool/Squads/revenue funding), 53 (stale rehearsal proof + missing `rehearsal-init.json`/checker mode) remain OPEN in SPEC and in code. Do not launch without them.

## Other

None above LOW. The three LOWs are liveness/observability, no value path, no immutability-locked theft.

---

# GIVEN NO HUMAN FIRM WILL EVER SEE THIS, what AI audit structurally cannot do before launch

1. **Run the dress rehearsal with real money and real latency (item 22).** No assertion suite executes `bank/crank.mjs` I/O against 2,100 vaults, `bank/revenue.mjs` end-to-end through both venues, or the alarm against a live cluster. AI can read the code; it cannot feel a 300s RPC hang, a vault-1900 transient, or a 12-hour cooldown miscount. Record every signature for items 22.1-22.5 and the forced post-sweep hand recovery before the lock.
2. **Reproduce the build from source on a second machine.** `build-mainnet.sh` proves the tested-vs-shipped delta on one box. AI cannot vouch that `dist/*.so` sha256 equals a clean rebuild elsewhere. Do it, compare, publish.
3. **Witness `initialize` from `mainnet-init.json` and read it back.** The checker judges JSON, not the signed transaction, and the programs check less than the checker. Build the four `initialize` transactions FROM the file, land them, read every field back, and set `lock_deadline` 24h before `charter_opens_at`.
4. **Put a second watcher off this box on a second provider.** Limit 10(3) is real: ledger+crontab+alarm share one user. AI cannot survive box compromise. A Squads-signed off-box job that pages `unledgered_sweep`/`sweep_unledgered_state` independently is the only backstop.
5. **Move the $CBOB release wallet and fund the operator float by procedure.** AI cannot delete `bank/keys/cbob-release.json` or top up `OPERATOR_FLOOR`. Decide custody (Gary's wallet or Squads), move it, delete the box key, fund operator above 0.02 SOL, fund revenue above rent, create pool/revenue/Squads cbBTC accounts (item 52).
6. **Build the redeem page before the lock (item 50).** AI cannot warn a holder at signing time. Ship deposit-address display, `judgeRedemptionCoverage` preflight, prior-transaction ATA creation, helper sweep, frozen-pool no-claim path, and close-everything-it-empties, outside `programs/bank/scripts` or before the freeze.
7. **Drill the hand recoveries on a timer.** Open-cycle swap failure, frozen pool/vault/revenue, guardian stop/restart vote, log-gap review watermark write. AI cannot measure human time-to-guardian-wallet. Time it.
