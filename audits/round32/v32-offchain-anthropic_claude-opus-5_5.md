# Round 32 Off-Chain Audit (v6, HEAD after `dee953e`)

## Result

**NOT CLEAN. 0 CRITICAL, 0 HIGH, 2 MEDIUM, 3 LOW, 5 INFO.**

All of this is source reading. I executed nothing. Each finding states the evidence that would exist if it is true, so it can be measured before anyone acts on it. Where I could not establish a mechanism, the finding is marked unproven.

The repairs for round 31 L1 and L2 are present at their sites. Each one closes the shape round 31 measured, but leaves a cheaper variant open (M1 and M2 below).

---

## R0. Round 31 verdict and its repairs

- **C01, wSOL dust: the disproof holds.** SPL Token closes a native account with its balance. I agree with that disproof.
- **C02, v1 lookup tables: the disproof holds.**
- **C04, offsets: the disproof holds.** Recomputing `L.offsets('MintConfig')` by hand gives `minted_total` = 141 and `bare_burns_retired` = 454.
- **L1 repair (`detectLogGaps`, level condition, watermark): present.** It creates a new residual (M2).
- **L2 repair (`PER_PROGRAM_READS` = 2,000): present.** Round 31's preferred repair, "report the pre-walk findings before walking", was **not** taken.
  - `main()` still computes drift, pool, brake and upgrade-authority findings before the walk, and only `report()`s them after it.
  - L3 shows why that ordering now matters more than a delay.
- **D2 poster SOL: correct.** The helper's lamport move is a System `transfer` CPI from the asset-signer PDA. It appears as a parsed inner instruction with `source === vaultPda`, and `releasedFromTx` counts it. Token-account close rent is correctly not counted.
- **Floors are consistent.** DET 901, POSTER 23, ALLOC 39, LAUNCH 47, HOST 6, MAINNET 33, EXPIRY 4, SWAP 16 and on-chain 855 agree across `run-tests.sh`, `selftest.mjs` `FLOOR`, SPEC and VALIDATION.

---

## Findings

### M1 (MEDIUM). A sustained MINT-scan flood blinds the only theft detector on the one trusted hop, at about 1% of what the theft yields.

**Construct.**
- `bank/alarm.mjs`, the walk over `[SEAL, MINT, BURN, GOV]`, together with `D.detectUnledgeredSweeps`.
- An operator-key sweep that `bank/revenue.mjs` did not make is detected only by finding the `sweep_sol_for_swap` instruction in MINT's signature walk.
- No state-derived check exists:
  - `mint.last_sweep_at` is produced by `readConfigs` but is in neither `WATCH` nor any detector.
  - The revenue PDA's lamport fall is used only to reset the `royalties_unswept` clock.

**Mechanism.**
- Anyone can add a MINT-naming transaction for 5,000 lamports (round 29 measured this).
- Under a flood above 2,000 transactions per pass, each backlog drains at 2,000 per pass while new flood traffic accumulates above its head. The scanner's lag grows linearly with attacker spend.
- Delaying any one sweep by D passes costs about 0.01 SOL × D. A day (48 passes) costs about 0.48 SOL.
- A thief holding the operator key can take 10 SOL per 6 h (40 SOL a day at the ruled cap). The alert that summons the guardian (`unledgered_sweep` CRITICAL) never fires.
- The only signal is `scan_gap`. It is a level kind, so the stream opens once and is then suppressed.

**Why this is limit 10 worse than stated.**
- Limit 10 bounds theft by "cap × cooldown windows until the guardian pulls `emergency_stop_sweep`", which assumes detection.
- SPEC's backlog boundary describes the delay as "its size divided by 2,000". It does not say the size is attacker-chosen at about 1% of the stealable amount.

**Evidence if true.**
- Source-extract the walk exactly as R30 M1 does.
- Use a stub cluster that inserts 2,500 new MINT signatures per pass and one sweep signature just after the cursor, with no ledger row for the sweep.
- Expected: across 10 passes, no `unledgered_sweep` is produced, and only `scan_gap` is.

**Fix.** Add a flood-immune state detector each pass:
- If `mint.last_sweep_at` advanced since the previous snapshot and no ledger row has a sweep landing in [prev, now], raise CRITICAL.
- Separately, if `royaltyLamports` fell by at least the sweep floor with no ledger cycle opened in the grace window, raise CRITICAL.

Both values are already read. Add both-direction arms.

### M2 (MEDIUM, detection). Limit 25's "the alarm pages on a reschedule" can be silenced, and the genuine signature can be evicted from `logGaps`.

**Construct.**
- `D.detectLogGaps`, which keeps `.slice(-500)`.
- The alarm's `ran`/`OURS` test.
- The fixed, signature-free `log_coverage_gap` text.

**The silencing path.**
- Round 31 established that a stranger can make "ours ran" true by putting a no-op `expire_boosts` after memo padding.
- `reschedule_reveal` is equally permissionless. When it is padded the same way, the `CBOB_REVEAL_RESCHEDULED` line is truncated and no `reveal_rescheduled` is produced.
- The gap stream does page, but only if it is not already open. An attacker first opens it with one no-op gap. The reschedule then adds to `logGaps` without an email, which SPEC concedes.

**The eviction path.**
- The attacker then adds 500 more no-op gaps, about 0.0025 SOL.
- The genuine reschedule signature is pushed out of the kept list.
- When the reviewer reviews, the transaction to inspect is no longer recorded.
- Round 30's comment ("Only real gaps go in the bounded `logGaps` record, so a stranger's padding cannot push them out of it") became false when round 31 L1 showed "real" gaps are free.

**Why it matters.**
- The reschedule page is limit 25's control on the re-roll.
- The lapse itself still requires that nobody captures during the window, which is limit 25's own premise.
- `reveal_queue_stalled` will not catch it, because the queue moves within minutes.

**Evidence if true.**
- Feed the fixture into the extracted walk with a top-level MINT reschedule before `Log truncated`, preceded by an open gap and followed by 501 no-op gaps.
- Expected: no `reveal_rescheduled` finding, no new email, and the reschedule signature absent from `keep`.

**Fix.**
- Detect reschedules from state. `VaultRecord.reschedules` and `reveal_slot` jumps are cheap to read with a `level == 0` memcmp filter, as the crank does. Page on any increase.
- Never evict an unreviewed gap in favour of a newer one. Cap the list, and refuse or page CRITICAL when it overflows.
- Correct the stale comment.

### L1 (LOW). One reader refusal aborts the whole alarm pass, so every pre-walk CRITICAL is lost with it.

**Construct.** `readParsedTransaction(...)` inside the walk is not wrapped. `validateParsedTransaction` throws on any refused shape, and only `null` is counted as `tx_unreadable`.

**Consequence.**
- The throw escapes `main()`, so only `run_failed` is sent.
- Already-computed findings are never reported: `config_drift`, `pool_frozen`, `brake_pulled`, `program_not_locked`, `test_value_in_production`.
- State is not written, so every later pass re-reads the same transaction and dies the same way.
- I found **no** attacker-controlled way to make a successful transaction fail validation, so this is unproven as an attack. As robustness, it means one parser or RPC shape change blinds every detector at once.

**Evidence if true.** Stub `readParsedTransaction` to throw for one signature. Expected: `report()` is never called, and a `pool_frozen` finding computed earlier never reaches the router.

**Fix.**
- Catch per transaction, record `tx_unreadable` and hold that program's cursor (the existing `unread` path).
- Separately, `report()` the pre-walk findings before the walk. This is round 31's own recommended L2 repair, which was not taken.

### L2 (LOW, gate). `audit-coverage.sh` lets a combined `VERDICT.md` credit both foci from a one-focus headline.

**Construct.** `first_line_quorate(..., combined=vf.endswith('VERDICT.md'))` accepts either label.

**Consequence.**
- Suppose a round has `MANIFEST-offchain.json` meeting the runner's count but no `VERDICT-offchain.md`, and its `VERDICT.md` reads `# Round N, PROGRAMS pass: CLEAN; QUORUM MET`.
- The off-chain bundle is then credited without any off-chain triage.
- This contradicts the gate's comment that "only a TRIAGED pass counts".

**Evidence if true.** Make a scratch git round directory with that layout and run the gate. The off-chain files are reported covered.

**Fix.** For `VERDICT.md`, require the label to match the focus being credited, or require per-focus verdict files from round 19 onward.

### L3 (LOW, process). The log-gap reviewer's instructions are not consistent with how `logGaps` is ordered.

**Construct.** The detail text and code comment say "newest last". Pushes within a pass follow the walk order, which is newest-first, then SEAL→MINT→BURN→GOV. Backlog drains append older gaps after newer ones.

**Consequence.**
- A reviewer who writes the newest-in-time signature as the watermark leaves array-later entries unreviewed.
- This fails in the loud direction, but it trains the reviewer to distrust the page.

**Fix.** Either sort `keep` by `blockTime` with the signature as tie-break, or instruct "write the LAST element of `logGaps`".

---

## R1. The crank

I traced plan versus program for joins, ticks, pre-/post-expiry, retirement freeing `owed`, split blockers, frozen pools and budgeted reveals. **No plan the program refuses was found** beyond the races already classified. Points checked:

- **`w` accounting.**
  - `total + preJoinWeight − retiringWeight(with boost) − expiringWeight` equals the post-state denominator.
  - Pre-expired owed equals `atExpiry + level·Δacc`, which matches `claim`.
- **Post-expiries.** They are sent before claims, at the post-distribution accumulator. That is the correct carry, because the boost covered that distribution.
- **Split share.** The crank hardcodes 1,500 bps instead of reading `cfg.split_bps`. This is harmless only because `split_bps` is fixed at 8,500 forever (INFO).
- **Value movement.** No value moves anywhere unpinned. Source-asserted arms show the crank calls only MINT, uses `distribute(false)`, and builds no transfer.

## R2. The alarm

Beyond M1, M2 and L1, dangerous states that read as quiet:

- **`mint.last_sweep_at` is unwatched.** See M1.
- **A wrong initialized guardian, operator or reserve inside the bands becomes baseline unpaged.** This is disclosed in round 31 D1 and SPEC 38. A post-`initialize` read-back against `launch/mainnet-init.json`, run before the lock, is still the right control.

Routine states paging every pass:

- **`redemptions_near_cap` while live supply is small.** With 240 live vaults the cap is 6 and `near` is 1, so the 5th redemption in an hour pages HIGH. That is a reasonable rush signal, and I am not filing it.

## R3 and R4. Layouts and accrual arithmetic

- **Seeds (round 24 D6).** The seed assertion now exists (`D6:` arms). The SEEDS comment is true.
- **cbBTC mint copies (INFO).** The mint is duplicated in `layout.mjs`, `detectors.mjs`, `swap.mjs`, `revenue.mjs` and `alarm.mjs` with no equality arm. The L7 arm covers program IDs only. Add the mint to it.
- **Accrual.** `pendingScaled` equals `owed_of`, and `credit` matches. After a claim, carry equals `pending − settled` and debt equals `w·acc`, which is consistent. I found no divergence.

## R5. The swap

### (a) Oracle math
- The exponent handling is correct for both signs.
- Rounding goes toward the operator's loss: the floor is rounded down.
- `satsPerLamport` is a float and is used only for the deviation gate, so no overflow path exists. At SOL ≈ $120 and BTC ≈ $86k it equals 1.40e-4.
- Orca's square-root spot and Meteora's inverse bin power both give sats per lamport in raw units. The direction is correct.

### (b) Pyth
- The offsets are correct for Full verification: feed 41, price 73, conf 81, expo 89, publish_time 93. They match the fork's stamping at 93.
- **Residual (INFO, unproven).** The push oracle's update is permissionless. If it only accepts strictly newer genuine prices, an adversary can still choose when to refresh, either holding a price up to 179 s old or posting any newer genuine one. The effective oracle is therefore any genuine price within about 3 minutes, by the adversary's choice.
- **Check:** read the push-oracle `update_price_feed` source for its monotonicity rule.

### (c) and (d) Deviation gate and minimum-out
- These are correct and use the same `m2` floor.
- The units are sats for both venues.

### (e) Judge
- It is complete for value-moving roles.
- Unchecked writable flags or liquidity accounts cannot redirect value.

### (i) Extraction bound (INFO, quantitative)
- The fork shows an honest 10 SOL fill about 30 bps under the oracle. The floor sits 150 bps under.
- About 120 bps is therefore available to a sandwich on a transaction sent through public RPC: roughly 17k sats (about $14) per cycle.
- At full throughput (4 cycles a day) that is roughly $1.7k a month, about 1.2% of royalty volume. The oracle-timing choice in (b) adds to this during volatility.
- This is material only at scale, and it is disclosed as "up to 1.5%".
- **Cheap improvement:** set the floor at about 60–75 bps, which the fork data supports, and/or submit swaps privately (Jito bundle).

### Operator key worst case
- It is unchanged from limit 10, except that M1 removes its detection premise.
- **(h) Retries:** I found no double-swap path. `classifySendFailure` combined with the open-cycle guard holds.

## R6. Gates

- **Coupling (INFO).** In `--selftest` mode, `audit-coverage.sh` still runs the never-sent branch first and exits 1 if any tracked file is unnamed. The detector selftest's R31 L1 arm then fails, so adding a file turns `run-tests.sh` red until an audit script names it. Move the `--selftest` dispatch above the git enumeration.
- **`build-mainnet.sh`.** It proves the sweep helper's byte identity against both the localnet rebuild and `target/deploy`. It proves key rejection and acceptance for the four programs with keys.
- **`cron-install.sh`.** It arms only from tagged, uncommented, end-anchored lines, and it refuses rehearsal trees.

---

## The accepted limits

**1. Worse than stated.**
- **Limit 10:** detection can be delayed indefinitely at about 1% of the theft (M1).
- **Limit 25:** the reschedule page can be suppressed and its signature evicted (M2).
- **SPEC "Scan backlog boundary":** the phrase "delays detection" understates that every pre-walk CRITICAL also waits on the walk, or is lost on a refusal (L1).

**2. Not actually a limit, or closed.**
- Limits 9 and 44 are narrower for classic tokens through the helper, as already noted.
- Limit 8 is effectively confined to backlog conditions now that `seenRedemptions` persists across passes.

**3. Discharged but not fully discharged.**
- No item in this group. Item 54's crank claims check out: capture is about 114.8k CU and reveal about 150.3k, both under the default 200k.

**4. OPEN items quietly treated as accepted.**
- **Item 53:** the rehearsal value set and the crank/revenue rehearsal notice isolation (round 31 C13) are still unbuilt.
- **Item 22(3)–(4):** the revenue cycle is still unrun by any gate.
- Neither is labelled accepted, but nothing schedules them either.

---

## What should be done before launch that AI audit cannot do

1. **A 30-day production-value canary at throwaway IDs with real small funds**, run on the ruled `monthly_secs`, `notice_secs` and `min_voting_secs` rather than shortened ones.
   - The 30-day free distribution, the 7-day key notice and the 3-day vote have only ever run at test lengths.
   - Run the crank and alarm live throughout. Let charter close plus 60 days pass for the first free crediting distribution.
2. **An adversarial rehearsal day.** Have someone outside this box attack it for real:
   - flood MINT naming (M1);
   - pad a no-op MINT call and a reschedule (M2);
   - dust the revenue PDA and vault wallets;
   - sandwich a revenue swap.
   Record what paged and when.
3. **An off-box, state-only second alarm** on a second RPC provider and a different host and user. It should watch `last_sweep_at`, revenue lamports, pool state, program hashes and authorities, and the PoB collection. This survives a box compromise (limit 10(3)) and scan floods.
4. **An independent reproducible build** (`solana-verify` or equivalent) from a clean second machine, and a comparison of the deployed program hashes before the authority is removed.
5. **A witnessed `initialize`** built mechanically from `launch/mainnet-init.json`, simulated, signed by Gary, then read back field by field against the file before the lock.
6. **Custody decisions only a human can make for the charter window:**
   - move the Giraffish Moments update authority and the $CBOB release wallet off hot keys (limits 46 and 56);
   - otherwise accept those limits in writing.
7. **Host fuzzing of MINT accrual and boost state** with `proptest`/`cargo-fuzz` for hours, and a paid bug bounty open before the authority is removed. Both search spaces too large for reading.