## R0. Round 29/30 verdict and repairs

Round 30 off-chain was NOT CLEAN: M1 MEDIUM, L1-L3 LOW, D1-D2 INFO. Validation `0d13b03` claims all repaired. Independently verified at this tree:

* **M1 scan backlog:** `bank/sigwalk.mjs:signaturesSince(...,startBefore)` + `bank/alarm.mjs:backlogs[prog]={head,before}`, cursor moves only when walk reaches old cursor, empty-resume needs positive proof or `scan_backlog_unproven` CRITICAL; poster `st.backlog` same. Selftest R30-M1 drives 25,000 stub sigs through the real walk and the extracted alarm/poster loops. Holds.
* **L1 truncation page:** `bank/alarm.mjs:ran=[...OURS]`; `log_coverage_gap` HIGH only if SEAL/MINT/BURN/GOV/SWEEP ran, else `log_truncated_foreign` INFO. `detectors.mjs:ALARM_KINDS` classifies both. Holds.
* **L2 budget floor:** `bank/crank.mjs:budgetPlan` runs base when key covers `planCostLamports(base)`, `room=lamports-cost(base)-floor`, reveals only from above floor, separate `fee_floor` marker. Holds.
* **L3 dust:** `bank/swap.mjs:sweepAmount/MIN_SWEEP_LAMPORTS=10M` returns 0, `bank/revenue.mjs` uses it, `amount===0` early return. Holds.
* **D1 rehearsal tags:** `detectors.mjs:planAlarmNotices(...,rehearsal)` tags RECOVERED, `alarm.mjs` FAILED/DID-NOT-RUN/RECONCILE-FAILED carry `(REHEARSAL)`. Holds.
* **D2 frozen zero:** `programs/cbob-vault-sweep/src/lib.rs:62-68` skips transfer when `amount==0`, only closes; SPEC 44 now says “holding a balance”. Holds.

No surviving defect from those six is re-filed. What follows is new.

## R1. Crank `bank/crank.mjs`

No plan the program will refuse, no dead-vault pay/join, no out-of-order reveal found. `planCrank` retires positively-burned at any level before join/pay, joins eligible before distribute, expires `preExpires(dist_epoch>=end)` before and `postExpires(end==epoch+1)` after, splits only into live-unfrozen pool+Squads, delivers at post-distribution `acc` with `owed{addr}` in sats, batches `CLAIM_BATCH=14`, reveals strictly from `revealed_total`, `[]` only for `burned`, `skip`+break for `other`, fee judged by `budgetPlan`, distribute refusal re-judged by `judgeDistributeRefusal` with fresh `dist_epoch/last_distribute_at`, chain Clock only.

No R1 finding above INFO.

## R2. Alarm `bank/detectors.mjs`, `bank/alarm.mjs`

### LOW R2-1: `seenSplits`/`seenSweeps` grow without bound — `bank/alarm.mjs` state
**Construct:** `next.seenSplits=dedupeSeenSplits([...seenSplits,...prev])`, `allSweeps=[...prev.seenSweeps,...seenSweeps]` — never sliced. `logGaps` is capped `.slice(-500)`, these are not.
**Gain:** operator cost only: state file grows ~24 splits/day + sweeps forever, every pass re-scans larger arrays in `closesCycle/detectSplitClaims`. No value path, no silence — loud/slow direction.
**Evidence if true:** `bank/state.json` byte size monotonic across months; `detectSplitClaims` input length equals total history. Would show in any long rehearsal.
**Fix:** prune to verification horizon e.g. keep splits/sweeps younger than 30d or last `verifyLastN+margin`, like `logGaps`.

No dangerous-quiet or routine-page found otherwise. `test_value_in_production`, pending keys, PoB plugins/authority, window-near-full, frozen/insolvent pool, overdue distribution, upgrade authority for all five incl. sweep+third-party, Gary values, tighten bounds, 30d month, 1h window all fire both ways in selftest.

## R3. Layouts `bank/layout.mjs`

Assertions are real. `bank/selftest.mjs` parses each `pub struct` from Rust and requires equality incl. type, throws on private/`pub(crate)` lines, compares every `OFF_*` scraped from GOV/BURN/MINT against `offsets()`, compares 11 seeds (D6), versions incl. sibling copies, `MINT_CONFIG_SPACE/VAULT_RECORD_SPACE` scraped+evaluated less padding vs `fixedLength`, `LEVEL_WEIGHTS/ACC_SCALE/REVEAL_WINDOW_SLOTS/LEADER_GROUP_SLOTS/ENTROPY_GROUP_STRIDE`, suite `OFF_*`, `BOOST_RING=64`, round-trip + refusals, `collectionPluginsHash` mint-counter blindness. A struct change without mirror turns build red. SEEDS comment now true.

No R3 finding.

## R4. Money arithmetic `bank/accrual.mjs` vs `programs/cbob-vault-mint/src/lib.rs`

No divergence. `credit(delta=avail*ACC_SCALE/w)`, `owed_of=w*acc+carry-debt`, `reweigh` via carry, `ceil_sats`, `join(debt=w*acc)`, `boost_weight/carry_scaled` match. Crank expires before/after as above; alarm pages `boosts_stalled`, watches `cbob_mint/max_boost_weight/max_boost_epochs` CRITICAL. Selftest asserts sats not counts (L4).

## R5. Swap `bank/swap.mjs` + revenue `bank/revenue.mjs`

**(a) Oracle math:** `sats=lamports*sol*10^(es-eb)/(btc*10)` correct for 1e9 lamports/SOL, 1e8 sats/BTC. `minSats=expected*(10000-150)/10000` floored. `satsPerLamport` via `Number` loses <1e-9 relative; at 100bps boundary error ~1e-6 bps — cannot flip gate. Overflow impossible in BigInt. Floor 150bps covers 16bps Orca fee + ~1bps impact on 10 SOL vs ~$10M — below honest fill. No defect.

**(b) Pyth:** `readPyth` checks `owner==receiver`, `level==1` Full, feed id, length 101, offsets 40/41/73/81/89/93 correct, age 180s, future 30s, `conf*10000<=price*30`, `price>0`, chain Clock via `clockUnixTimestamp` with Sysvar owner check, unreadable refuses. Derived PDA `[0,0,feed]` under push program. Fully-verified needs Wormhole verification in push program — not writable by anyone. Old `publish_time` beyond 180s refused; within 180s bounded. Clock is chain, not box. No defect.

**(c) Deviation:** `orcaSpot=(sqrt/2^64)^2` sats/lamport for A=wSOL/B=cbBTC, `meteoraSpot=1/(1+step/1e4)^id` for X=cbBTC/Y=wSOL — directions correct, proven by fork SW.0 both within bound. `deviationBps=|p-o|/o*1e4`, double error negligible vs 1bps. No defect.

**(d) Minimum out:** Orca `other_amount_threshold` bytes 16..24, Meteora `min_amount_out` same offset, both `==minSats` from same `market()` read as deviation gate. Units sats. Judge checks `readBigUInt64LE(16)==floor`. No defect.

**(e) Judge `judgeSwapInstructions`:** complete for value movement. Requires exact 7 ix, CU-limit 400k no price, two ATA creates for operator's own accounts, System transfer exactly `lamportsIn` to own wSOL, SyncNative, venue swap with own wSOL in (Orca 3/Meteora 4), own cbBTC out (5), amount+threshold exact, Orca exact-input/a_to_b/min-price, signer slot, close own wSOL to owner once, no Token but SyncNative/Close. Tampered builder cannot route past it to steal without failing judge; residual pool-owned accounts (vaults/tick/bin/bitmap/oracle/event) are validated by pool programs — wrong ones fail closed. Box-owner tamper residue correctly stated in limit 10. No defect.

**(f) Derivation:** Orca `[s0,s0-span,s0-2span]` below current for a_to_b, `tick_array/pool/String(start)`; Meteora `[i,i+1,i+2]` above for Y→X, `bin_array/pool/i64LE`, bitmap or program-id, `host_fee_in=None`, event authority, two TOKENs — match IDLs and fork. Uninitialised/boundary array refuses on chain (loud, Meteora fallback). No defect.

**(g) wSOL:** wrap exactly, sync, swap exact-input, close. Prior balance stays SOL and returns via close; frozen impossible (native mint no freeze auth); delegate would fail swap loud; leftover after exact-input is only prior SOL. No defect.

**(h) Retry:** Orca first, Meteora only on `refused` (preflight/on-chain-err/expired-absent via `classifySendFailure`+status), `unknown` stops open with `pendingSwapSig/Venue`. No double-swap automatically; open-cycle guard blocks next; ledger stays open until split (`cycleIsOpen` needs `splitSig/splitByOther`). No defect.

**(i) Tolerance bound:** worst fill = oracle-150bps; oracle ≤30bps confidence + ~20bps 3-min drift. ~200bps on 10 SOL (~$1,200) ≈$2.4/cycle; 40 SOL/day ceiling ≈$48/day; ~$1.4k/month vs pool. Sandwich to gate edge costs far more than capture on $10M Orca; $0.9M Meteora thinner but same floor enforces. Not material. Operator worst case still cap×windows until `emergency_stop_sweep`, ledger cannot read failed as closed (`sendRejected` without `sweepSig`, `rejected_row_has_sweep`, `unledgered_sweep` fallback). No defect.

## R6. Gates

Floors equal counts, `build-mainnet.sh` proves 5 incl. sweep byte-identity to tested+deployed, `cron-install.sh` preserves `--live` only on tagged uncommented lines, `rehearsal-tree.sh` reverse-proves. Round-24 both-ways arms hold.

### LOW R6-1: poster omits SOL — `bank/redemption-poster.mjs:releasedFromTx/draftPost`
**Construct:** `releasedFromTx` sums only `transfer/transferChecked` from vault-PDA token accounts; helper's final `system_instruction::transfer(vault lamports→dest)` never counted; `draftPost` lists only `released`.
**Gain:** public record understates: “0.0005 BTC … released” while SOL also released. No funds lost; copy false-completeness.
**Evidence if true:** any redemption with vault lamports >0 drafts post without SOL line; S8 redemption through helper moves lamports yet draft has no SOL part. Would show on first live redemption.
**Fix:** include System transfers from vault PDA in `releasedFromTx` and render SOL (9 decimals) in `draftPost`; add both-ways arms.

## Accepted limits

1. **Worse than stated?** No. Frozen-zero narrowing (D2), 1219-byte narrow three-create correction (item 42), orphan-dilution math (29-D2), cap×windows (limit 10) all as stated or favourable.
2. **Not actually a limit?** D2 zero-balance close, 42 narrow fit — already narrowed in SPEC, correctly.
3. **DISCHARGED not discharged?** No. 51/54/12-17 etc. remain closed with stated residues (boost timing, extrapolated 14-batch CU).
4. **OPEN treated as accepted?** No. 22/38/50/52/53 stay OPEN; guide stays DRAFT and must not publish before 50; dates unset in `mainnet-init.json`.

## What AI audit structurally cannot do before launch

* Run the live dress rehearsal (item 22 + L5): crank I/O at 2,100 vaults, alarm in rehearsal mode, one full revenue cycle per venue with Orca forced to refuse, one forced post-sweep failure with hand recovery and `--audit` clean, DAS burnt-flag read — with signatures recorded. No suite simulates fees, RPC stalls, or operator handling.
* Witness `initialize` FROM `mainnet-init.json` and authority removal on all five: checker validates JSON, not signed tx; `build-mainnet.sh` cannot prove compiled constant IS Gary's key. Needs independent rebuild + on-chain verify + `--final` ceremony.
* Decide custody: swap-operator float, $CBOB release wallet on box, PoB hot wallet, guardian hot wallet — rulings, not code.
* Build/test holder surfaces (item 50) with real wallets: deposit-address page, `judgeRedemptionCoverage` pre-sign, prior-ATA creation, packet/CU shapes, hand-draft queue.
* Put a second-provider off-box alarm witness: box-owner compromise kills ledger+crontab+alarm together (limit 10(3)).
