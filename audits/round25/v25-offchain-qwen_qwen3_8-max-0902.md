# Round 25 off-chain audit — findings

Scope: the whole bundled tree, read against the round-24 verdict and the accepted-limits list. I attempted to disprove each round-24 repair before looking for new faults, and I treated the two never-audited value-movers (`bank/swap.mjs`, `programs/cbob-vault-sweep`) as hostile until measured.

---

## R0 — Round 24's off-chain repairs

I re-derived every repair against the code at HEAD. Result: **all 20 confirmed repairs hold, at every site of their shape, and none breaks a neighbour.** Details of what I checked, so the next reader does not redo it:

- **H1 (notify path).** `planAlarmNotices` groups by kind, labels `cbob-vault-alarm:<kind|short>`, marks every baseline-advancing kind urgent with `at pass <ISO stamp>` embedded in the head (so the router sees new text each pass), sends the full detail list truncated at 60,000 chars with an "and N more" tail, and emits RECOVERY only for *level* kinds on a full pass. One-shot kinds are correctly excluded from recovery (a recovery would cancel a still-pending retry). `report()` sets `delivered=false` if *any* notice fails, and `main()` preserves every baseline (config, balances, cursors, vault set, frozen set, deferred sweeps, paged list) when `!delivered`. I looked for a finding that advances a baseline while undelivered and did not find one: the write is gated on `delivered && !DRY`. I looked for a routine state that now pages every pass: the freeze kinds are transition-paged then held at INFO (`applyFrozenTransitions`), the brakes are transition-paged, `sales_stopped`/`sweep_stopped`/`joins_waiting`/`guardian_retired` are INFO. No per-pass pageer found.
- **L1.** `BENIGN` includes `NothingToSplit`; `judgeDistributeRefusal` re-reads config and treats `NothingToDistribute|BoostsExpireFirst|JoinWaitingFirst` as benign only when `dist_epoch` or `last_distribute_at` moved; `PoolShort` is never benign. Matches MINT's refusal order (boosts_due → JoinWaitingFirst → PoolShort/NothingToDistribute → MonthNotElapsed).
- **L2.** `revealAttrSource` returns `skip` for `'other'`, and the reveal loop breaks before sending; `splitDecimalsByte` returns null for a non-byte and the split is refused.
- **L3.** `planCrank` reads pool *and* `bank` (Squads ATA) and plans no split when either is absent/frozen; a blocked split does not count toward `splitToPool`.
- **L4.** `crankPosture` is tri-state; `detectCrankPosture` keeps `armedSince` on unreadable and pages HIGH; `readCrankBeat` carries `failures` and `problems`; `detectCrankHealth` streaks both.
- **L5.** `carryConfigBaseline` persists last non-null per key and skips `._missing` flags. I traced old→missing→new and confirmed the comparison happens against the carried value.
- **L6.** `judgeFeePayer` checks `min(need, floor)` before the ceiling; `budgetPlan` sends everything except as many reveals (in mint order) as the balance covers, and pages the dropped count.
- **L7.** `judgeReserveRead` carries the prior value on a non-ok element and reports; absent-never-funded is quietly `'0'`.
- **L8.** `detectBalanceDrops` splits `vault:mint` keys and emits `asset: vault, mint`, so `correlateBurns` matches all three reserves.
- **L9.** `readMintedTotal()` re-read after the DAS walk at both call sites; `detectIndexShortfall` accepts any count between the two reads.
- **L10a–d.** `rejected_row_has_sweep`, `sweep_on_rejected_row`, explicit-`splitSig` anchoring via `closesCycle`, chain-following horizon (`sweptOnChain`), and `cycleStartMs` capping `startedAt` at the sweep's blockTime — all present and wired.
- **L11.** `closesCycle` is the single predicate used by both the alarm's `cycle_unsplit` suppression and `revenue.mjs`'s recovery; the recovery runs before the provably-empty proof.
- **L12.** `ours()` anchors `$TAG crank[[:space:]]*$`, so `crank-reveal` cannot arm the full pass in either flag order.
- **L13.** The wiring gate is comment-stripped, per-function, and requires the result to be consumed; the SPACE constants are scraped from the Rust, evaluated, and compared to `fixedLength`; the `attrsHash` arm uses a pinned hand-computed vector and `readySlot` is held to hand-worked values.
- **I1.** `retiringOwed` is subtracted from `owed_scaled` before `available`.
- **I2.** `clockUnixTimestamp` reads byte 32 of Clock; `planCrank` gets `chainSec ?? nowSec`.
- **I3.** `REDEEMED_POOL_FROZEN` is parsed, attributed to MINT, and paged urgent HIGH.
- **I4.** `check-launch-params` requires RULED status on every key including the two dates, and enforces the 24 h lock margin.
- **I5.** Freeze kinds transition-page then stand at INFO.

No new finding in the repairs themselves.

---

## R1 — The crank (`bank/crank.mjs`)

I checked the plan against every MINT refusal it could provoke:

- **Order.** Send order is reschedule → capture → reveal (strictly from `revealed_total`, breaks on first failure/benign) → retire → preJoin → preExpire → split → distribute → postExpire → activate → claims. This matches red-team 3 finding 6's required order (activate after distribute; joins before distribute; expires before distribute).
- **Dead vaults.** Burned assets are retired, never joined (`assets[r.asset] === 'burned'` skipped in the join loop), never paid (skipped in the claim loop), and never expired (retiring set excluded). Unrevealed bare burns are retired (I1).
- **Reveal order.** The reveal plan walks `byIndex` from `revealed_total` and stops at the first not-ready; the send loop breaks on any non-ok, so an out-of-order reveal cannot be sent.
- **Value movement.** Every instruction is a permissionless MINT call (`activate, capture_entropy, claim, distribute, expire_boosts, reschedule_reveal, retire_burned, reveal_level, split_revenue`); the key signs only as fee payer; there is no `SystemProgram.transfer` or token transfer in the file. The selftest's grep arms confirm this.
- **Fee budgeting.** `planCostLamports` counts each reschedule/capture/reveal/retire/activate as one tx, claims by batch count, joins/expires by ceil(len/batch), plus split and distribute; reveal rent is added per reveal. I recomputed for a 60-reveal plan: 60×(5,000+111,360) lamports, matching the arm.
- **Distribute race.** A refused distribute re-reads config and is benign only if the epoch/timestamp moved; `PoolShort` always fails. `MonthNotElapsed` is in BENIGN, which is correct for the box-clock-ahead case that I2 narrows.

No finding.

---

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

- **Fixed-forever values.** `WATCH` covers every initialize-permanent field including `cbob_mint`, `max_boost_weight`, `max_boost_epochs`, `notice_secs`, the three tighten bounds, `redeem_window_secs`, `monthly_secs`, and both charter timestamps; `detectStandingRisks` in production pins all 21 ruled values including `pob_collection` and the boost ceilings.
- **Pending keys.** `swap_operator_armed` and `guardian_armed` page CRITICAL every pass while set; the default pubkey is not armed.
- **PoB collection.** `pob_collection.plugins_hash` and `pob_collection.update_authority` are read and drift as CRITICAL.
- **Redemption window.** `redemptionCapacity` reimplements BURN's ring arithmetic (cap = max(1, ceil(live×210/10000)), bounded at 64); `detectRedemptionRate` pages when remaining ≤ max(1, floor(cap×0.2)) and is quiet on an idle window.
- **Frozen/insolvent pool.** `detectPoolHealth` pages `pool_frozen` (urgent), `pool_unreadable`, and `pool_insolvent` (balance < ceil(owed_scaled/1e12)); the pool and owed are read in one `getMultipleAccountsInfo` to avoid the split-read race.
- **Distribution overdue.** `detectDistributionOverdue` pages when weight>0, poolAvail>0, and the period+grace has passed; it also pages `joins_stalled`, `boosts_stalled`, and `launch_tick_overdue`.
- **Upgrade authority.** `detectUpgradeAuthorityAfterLock` covers all five programs including `sweep`, uses `lockDeadlineOf(file, charter_opens_at)`, and pages `lock_deadline_unset` in production when no deadline is recorded.
- **Gary's production values.** 21%/51%/3 days, 7-day notice, tighten bounds 1 SOL/24 h/0.1 SOL, 30-day month, 1-hour window — all asserted.

I looked for a dangerous state read as quiet: a config that vanishes for SEAL/BURN/GOV is surfaced on the second pass via carried-baseline drift (the first pass carries the old value; the second compares old→null and pages). A one-pass blip is correctly not drift. I looked for a routine state that pages every pass and found none (all standing conditions are INFO or transition-only).

No finding.

---

## R3 — The layouts (`bank/layout.mjs`)

- Every struct's field list is parsed out of the Rust by `parseRustStruct` and compared name-and-type; the parser throws on a line it cannot read (private, `pub(crate)`, multi-line), and the selftest mutates the Rust to prove a field addition and a type change are both caught.
- Every cross-program `OFF_*` constant in GOV, BURN, MINT and the suite is scraped and compared to `offsets()`; the "none scraped and ignored" arm confirms completeness.
- **D6 closed:** every PDA seed in `SEEDS` is scraped from the declaring program's `pub const …_SEED` and compared; a mistyped seed or an unmapped one is caught. There is now a real assertion where the comment once claimed one.
- Layout versions are scraped from every program's `*VERSION` constants and compared; the boost ring's 64 is compared in three places.
- `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` are scraped, evaluated (with the three named constants substituted), and held to `fixedLength` minus padding.

No finding.

---

## R4 — The money arithmetic (`bank/accrual.mjs`)

Line-for-line against MINT:

- `credit`: `delta = avail×ACC_SCALE/w; acc += delta; owed += delta×w`. Matches.
- `owed_of`/`pendingScaled`: `(weight+boost)×acc + carry − debt`, throws on negative. Matches.
- `ceil_sats`: `(scaled + ACC_SCALE − 1)/ACC_SCALE`. Matches.
- `reweigh`: `carry = owed; debt = new_weight×acc`. Matches.
- `join`/`debtAtActivation`: `debt = level_weight×acc` (no boost at join). Matches.

The crank expires every boost with `dist_epoch >= boost_end_epoch` before distributing (`preExpires`), and every boost with `boost_end_epoch == dist_epoch+1` right after a planned distribute (`postExpires`). The alarm pages `boosts_stalled` and watches `cbob_mint`, `max_boost_weight`, `max_boost_epochs` as CRITICAL drift.

No finding.

---

## R5 — The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

This is the new code. I went through every sub-question.

### (a) Oracle math — correct
`sats = lamports × sol.price × 10^(sol.expo−btc.expo) / (btc.price × 10)`. The exponent is handled by moving the power of ten to numerator (e≥0) or denominator (e<0); division is BigInt floor, which rounds the expected output *down* and the floor further down — the conservative direction. `satsPerLamport` converts to Number; with both feeds at expo −8 and realistic prices the magnitudes (~1e11, ~1e13) are far inside `Number.MAX_SAFE_INTEGER`, so no precision loss. The 150 bps tolerance covers Orca's 0.16% fee plus impact of a ≤10 SOL swap on a ~$10M pool (impact ≪ 1 bp) plus the oracle's ≤1% confidence.

### (b) Pyth verification — correct
`pythAccount` derives `[0u16 shard, feed_id]` under the push program; `readPyth` requires owner = receiver program, verification level byte = 1 (Full; Partial = 0 is refused), and the exact 32-byte feed id, then reads price/conf/expo/publishTime at the correct offsets (8+32+1 for the level, then 32 feed, then i64/u64/i32/i64). Only the push-oracle program can write this PDA, so a stranger cannot inject a price or a stale `publish_time`; staleness (180 s) and confidence (≤1%) are enforced against the box clock, which is the only clock available off-chain and is a stated operational trust, not a code defect.

### (c) Deviation filter — correct direction and quantity
`orcaSpot = (sqrtPrice/2^64)²` is sats per lamport for the wSOL(A)/cbBTC(B) pool; `meteoraSpot = 1/(1+binStep/10000)^activeId` is sats per lamport for the cbBTC(X)/wSOL(Y) pool (the inverse, because the pair prices X in Y and we sell Y). Both compare against `satsPerLamport` at a 100 bp gate. Float precision at these magnitudes is ~1e-16 relative, far below 1 bp.

### (d) Minimum out — same floor, correct units
The on-chain floor is `m2.f.minSats` (oracle expected − 150 bp) from the *second* oracle read; the first read is guarded by the 200 bp re-quote drift check. Orca's `other_amount_threshold` and Meteora's `min_amount_out` are both in the output token's base units (sats), which is what `minSats` is.

### (e) The judge — **FINDING, HIGH**

**Construct:** `bank/swap.mjs`, `judgeSwapInstructions`.

**What it checks:** allowed program ids; exactly one signer (the operator); exactly one swap instruction naming the pinned pool; exactly one System transfer into the operator's own wSOL ATA; exactly one Token `close` of that wSOL ATA back to the operator.

**What it does not check, and a tampered or buggy builder can therefore pass:**
1. **The swap's OUTPUT account.** Nothing asserts that the swap's cbBTC destination key is `ata(CBBTC, owner)`. A builder that substitutes any other pubkey there sends the entire swap output to a stranger while every existing judge arm stays green.
2. **The swap's minimum-out bytes.** The floor (`minSats`) rides in instruction data (offset 16 for both venues) but the judge never reads it back; a builder can set it to 0 and the pool program will execute at any price.
3. **The direction byte / which side is input.** For Orca the `a_to_b` and `amount_specified_is_input` bytes (data[40], data[41]) are unchecked; for Meteora the ordering of `user_token_in`/`user_token_out` in the account list is unchecked. A builder that flips them signs a swap in the opposite direction or an exact-output swap.
4. **The swap amount.** The input amount in the swap data is not compared to the SOL transfer's `lamportsIn`.
5. **ComputeBudget fee.** `ComputeBudgetProgram.setComputeUnitPrice` is an allowed program; the judge does not bound the priority fee, so a builder can attach one that spends the operator's entire native balance on fees.
6. **The two ATA-creation instructions.** The judge does not verify that `createAtaIdempotent` calls derive the wSOL and cbBTC ATAs for the operator (the ATA program derives deterministically, which limits this, but the judge's claim of "the transaction is judged before signing" does not cover it).

**What an attacker gains:** in the threat model the judge exists for — a builder that is not the exact code reviewed (a stale import, a bad merge, a compromised module the file later grows a dependency on) — items 1 and 2 are a direct theft of the whole swap output (up to the sweep cap, 10 SOL ≈ 1.4M sats per cycle) with the operator's own signature.

**Evidence that would exist if I am right:** `SW.6`/`SW.6a`/`SW.6b` in `sim/swap-fork.mjs` and the M1 judge arms in `bank/selftest.mjs` test second-signer, two-swaps, foreign-program, wrong-SOL-destination and wrong-venue. There is **no arm** that mutates the swap's output account, its `minSats` bytes, its direction byte, or its amount and asserts the judge refuses. Running `judgeSwapInstructions` on a copy of the built Orca instructions with `keys[5]` (ownerCbbtc) replaced by a fresh pubkey returns `[]`.

**Fix:** in `judgeSwapInstructions`, for the single swap instruction: assert `ownerCbbtc = ata(CBBTC, owner)` appears as the output account (Orca key index 5; Meteora key index 5); read `data.readBigUInt64LE(8)` (amount in) and require it equals `lamportsIn`; read `data.readBigUInt64LE(16)` and require it equals the `minSats` the caller is about to enforce; for Orca require `data[40]===1 && data[41]===1`; for Meteora require the in/out account order is (reserveX, reserveY, ownerWsol, ownerCbbtc); reject any `setComputeUnitPrice` instruction or bound its value; assert each ATA-create names the correct mint and owner. Add a both-ways selftest arm for each.

### (f) Account derivation — correct
Orca: three tick arrays at `[s0, s0−span, s0−2×span]` for a_to_b (price falls), `s0 = floor(tickCurrent/span)×span` (correct for negative ticks), oracle PDA `["oracle", pool]`, vaults read from the pool account. Meteora: bin arrays `[i, i+1, i+2]` for Y→X (active bin rises), `i = floor(activeId/70)` (correct for negative ids), bitmap passed as program id when absent, `host_fee_in` as program id (None), event authority `["__event_authority"]`, two token program entries. At a tick/bin boundary the floor function selects the correct array; an uninitialised array is a program refusal, which the revenue loop treats as "try the next venue".

### (g) wSOL handling — correct
Wrap exactly `lamportsIn`, `syncNative`, swap (exact input), close to the operator. A pre-existing wSOL balance is returned by the close; a frozen wSOL ATA makes the swap revert whole; a delegate is irrelevant (the owner is the authority); a stranger-created ATA at the derived address is still the operator's ATA. Exact input means the swap consumes all of `lamportsIn` or reverts; nothing is left wrapped.

### (h) Failure and retry — correct
Meteora is tried only on an Orca *refusal* (regex on program error / simulation failure); an unconfirmed send throws and leaves the cycle open. The open-cycle guard at the top of the next run refuses to start a new cycle while any cycle has `sweptLamports>0` and no return+split. `cycleIsOpen` requires `returnedSats>0` AND (`splitSig` OR `splitByOther`), and L10/L11 hold both to chain evidence, so a failed cycle cannot read as closed.

### (i) Extraction bound within tolerance
The on-chain floor is 150 bp below oracle and the pool must be within 100 bp of oracle to be used at all. Worst per-cycle loss to a sandwich or a pool pushed to the gate edge is bounded by the 150 bp floor: on a 10 SOL sweep (~$1,200) that is ~$18, and the attacker must pay to move a $10M (Orca) or $0.9M (Meteora) pool to capture even that. A stale-but-accepted oracle is ≤180 s old with ≤1% confidence. Meteora is ~10× thinner, but it is only used if Orca's *program* refuses, and the same 100 bp gate applies. Per month at the ruled 10 SOL / 6 h cap the absolute ceiling is ~$2,160, and that is the theoretical maximum if every cycle executed at the worst legal price; royalty inflow is far below the cap, so the realistic exposure is immaterial. The operator key's worst case is unchanged from limit 10: cap × cooldown windows until the guardian stops the sweep, bounded by the revenue PDA's balance above the reserve. What is trusted now is two pool programs and the Pyth price, which is strictly less than trusting an HTTP reply from a host that no longer exists.

---

## R6 — The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

- Every floor is an **equality** (`-eq`), not a lower bound: `MIN_ASSERTIONS=774`, `DET_FLOOR=677`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=22`, `POB_FLOOR=14`, `LAUNCH_FLOOR=35`, `HOST_FLOOR=5`, `MAINNET_FLOOR=24`, `SWAP_FLOOR=10`, and `bank/selftest.mjs`'s own `FLOOR=677` is compared to `run-tests.sh`'s `DET_FLOOR`.
- The detector selftest's round-24 section arms every repair in both directions; I specifically looked for a one-directional arm and did not find one (L5 has old→missing→new and old→missing→old; L6 has all four funded/short × above/below combinations; L10d has the future-stamp page and the honest-grace quiet; H1 has the router sequence in a scratch state dir including the old single-label shape measured swallowing a finding).
- The wiring gate is mutation-tested: deleting `detectIndexShortfall` from `main()`, commenting out `detectPoolHealth`, and discarding its result each turn the gate red.
- `scripts/build-mainnet.sh` builds **five** programs, proves the sweep helper's mainnet bytes are byte-identical to the tested localnet bytes, asks all four keyed programs whether they trust the test key (mainnet must REJECT, localnet ACCEPT), and refuses a dirty tree.
- `scripts/cron-install.sh` arms money only from a tagged, uncommented `--live` line; the preserve logic is anchored per-job and cannot be armed by a comment, prose, or another project's line.

No vacuous gate found.

---

## The accepted limits — the four questions

1. **Is any limit WORSE than stated?** No. I re-measured the ones the brief flagged: limit 10's operator exposure is unchanged by the new swap (the on-chain cap × cooldown bound still holds, and the swap's own slippage is now bounded on-chain rather than by a third party's quote); limit 27's crank behaviour matches (burned vaults are retired first, never joined or paid); limit 32's ring arithmetic in `redemptionCapacity` matches BURN's; limit 55's 100-$GARY edge is correctly stated after round 24's D1 correction.

2. **Is anything listed as a limit not actually a limit?** No. Each ACCEPTED item I checked still describes live code behaviour. The swap hop (limit 10) is *narrower* than the v5 text implied (no third-party-built transaction is signed), which is an improvement, not a false limit.

3. **Is any DISCHARGED item not actually discharged?** No. Item 51 (boost) is built in MINT and GOV and mirrored off-chain; item 54 (compute) is measured; items 12/17, 14, 19, 30, 31, 33 are each closed by the code they cite.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still genuinely open: the crank is installed dry-run; `charter_opens_at` and `lock_deadline` are null in `launch/mainnet-init.json`; the redeem page and the redemption poster's sender do not exist; the pool/revenue/Squads accounts are created by road step 10 (not yet run); the rehearsal proof is stale at `d57ee3a` and the rehearsal value set is not written.

---

## Other observations (not findings)

- The sweep helper (`programs/cbob-vault-sweep`) is correct: it refuses any data but `[0]`, requires the signer to be a signer and distinct from the destination, requires each source to be owned by the signer and each destination to be owned by the destination wallet with a matching mint, transfers the live balance, closes each source (rent to the destination), and sweeps all lamports. Called directly it moves nothing, because the sources belong to the asset-signer PDA, which only Core signs for, and only for the asset's owner. It does not check its own program id, which is harmless for a stateless helper reached only via a caller-supplied `ExecuteV1`.
- `readWhirlpool` and `readLbPair` offsets match the published IDLs (I recomputed each against the field order).
- The revenue cycle's delta-based return (`after − opBefore`) is the correct defence against a pre-existing operator balance being counted as this cycle's return, and the full balance is forwarded to the revenue address while only the delta is recorded.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

AI audit can read, re-derive, and prove detectors both ways. It structurally cannot do the following, and each is a launch prerequisite:

1. **Run the crank against a live cluster at 2,100 vaults (item 22).** The reveal lane's per-minute throughput, 150 claim batches, RPC rate limits, and a transient error on vault 1,900 are all unexercised. The dress rehearsal must run the crank `--live` on throwaway ids with real SOL and real cbBTC dust, and must include a deliberate RPC outage and a deliberate reveal-lane kill, to prove `crank_silent` and `crank_failing` page.

2. **Execute one real sweep→swap→return→split cycle on mainnet (or the fork with real pool state) before arming the revenue cron.** The swap-fork test clones pools, but the first live cycle is the first time the operator key signs a transaction that moves real value through a real Orca program with real Pyth accounts. Do it with 0.1 SOL, and reconcile the ledger by hand.

3. **Verify the deployed bytes of all five programs against `dist/SHA256SUMS` by dumping them from the cluster after deployment**, not by trusting the build script's output. `solana program dump` each of the five, `sha256sum` them, and compare to the manifest. Then remove the upgrade authorities in one transaction set and confirm the alarm reads all five as `IMMUTABLE`.

4. **Have a human eyeball the four `initialize` transactions against `launch/mainnet-init.json` at the signing ceremony.** The checker validates the JSON; nothing validates that the transactions being signed were built from it. Print the decoded instruction data and diff it against the file before Gary signs.

5. **Test the redemption path end-to-end with the sweep helper, including a stranger's dust deposit between the page's read and the send.** The Test Vault simulation does this on a local validator; the dress rehearsal must do it against the deployed helper at its real program id, because the helper is permanent and its compute fit with three reserves plus a claim has not been measured on a mainnet-shaped transaction.

6. **Exercise a guardian stop and a key-change vote in the rehearsal.** Pull `emergency_stop_sweep`, confirm the sweep refuses, pass a restart vote, confirm the 7-day notice is enforced, and confirm the guardian cannot cancel its own replacement. This is the only time these paths will run before real value depends on them.

7. **Verify the two pinned pool addresses and both Pyth feed ids against a second source** (Orca's and Meteora's own UIs, Pyth's hermes catalogue) at the moment of launch, not from this bundle. A typo in a pinned address is exactly the kind of thing every reader of this bundle will carry forward together.

8. **Stand up the alert router and the notify path in their production location and send one test alert per kind-class (urgent-new, level-open, recovery) through the real `/opt/scripts/alert-router.py`.** The selftest runs the router in a scratch dir; the production router's state directory, log path, and email gateway are outside every test in this repo.

9. **Write the emergency runbook on paper, outside this box:** how to pull each guardian stop, where the guardian key lives, how to rotate the swap operator under fire, and who has the `INIT_AUTHORITY` key during the lock window. AI cannot hold a key, cannot be paged, and cannot decide to pull a brake.

10. **Fix the R5(e) judge before the first live swap.** It is the one finding in this pass, it is in the new code, and it is cheap: six assertions and six selftest arms. The judge is the last thing that looks at the transaction before the operator key signs it, and right now it does not look at where the output goes.