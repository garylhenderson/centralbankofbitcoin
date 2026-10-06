## R0. ROUND 26 VERDICT AND REPAIRS — INDEPENDENTLY RE-CHECKED

Round 26 off-chain was **NOT CLEAN**: 9 confirmed rows, 0 CRITICAL/HIGH/MEDIUM, 6 LOW + 3 INFO. Current tree is `8fe3120` repair of `93d04fe`.

All nine repairs are present in the shipped source and armed both ways. This is verification, not trust:

* **L1 unknown-send candidate loss — HOLDS.** `bank/revenue.mjs:rememberAttempt` is called in all four catch paths: `Sweep` on `unknown`, `Swap` on `unknown` with venue, `Return` via `.catch`, `Split` via `.catch`. `sendFailureSignature` preserved, never written to `sweepSig/swapSig/returnSig/splitSig`. `--audit` lists them as `candidate signatures … not confirmations`. Selftest `R26 Sweep/Swap/Return/Split` extracts the real handler and proves save-before-throw, no-signature no-save, no confirmed-field pollution.
* **L2 `splitByOther` ignores `returnBlockTime` — HOLDS.** `bank/detectors.mjs:detectSplitClaims` now anchors both branches through `closesCycle`. `closesCycle` uses `returnBlockTime` when present, `returnedAt-60s` only for legacy rows. Selftest `R26 anonymous/explicit`, `I1` prove early-split refuses, on-time split passes, one split cannot anchor two rows.
* **L3 one revenue stream — HOLDS.** `REVENUE_STAGES`, `revenueNotices`, `publishRevenueNotices` with per-stage `cbob-revenue:<stage>` labels, durable markers under lock, recovery only for passed stages, dry/probe/audit silent, `ALERT_URGENT` stripped. Router experiment in selftest proves second stage queues while first open, recovery closes.
* **L4 reconcile no memory — HOLDS.** `bank/alarm.mjs:reconcile` reads `prev.paged`, calls `report(...{prevPaged,fullPass:complete,scope:'reconcile',prefix:RECONCILE_LABEL,failedMarker})`, writes `paged` only on delivered+complete, preserves on incomplete/failed delivery, separate labels/state. Selftest `L4` drives real `report/reconcile` extraction: dirty→clean recovery, incomplete preserves, failed delivery retains.
* **L5 launch gate duplicate pins — HOLDS.** `scripts/check-launch-params.mjs:judgeLaunch` builds `cur` and calls imported `D.detectStandingRisks(cur,{production:true})`, rejects unknown `RULED` field, pins all ruled values. Selftest `L5` mutates each imported pin and proves refusal, good fixture passes.
* **L6 rehearsal replaces production cron — HOLDS.** `scripts/cron-install.sh` first lines: `[ ! -e "$R/REHEARSAL-RECORD.txt" ] || exit 1`. Selftest `L6` runs installer prelude with synthetic roots: production passes, rehearsal exits 1 before any read/write.
* **D3 swap-floor count gate — HOLDS.** `bank/selftest.mjs:RX.swap`, floor map reads `sim/swap-fork.sh:SWAP_FLOOR=16`, `everywhere` loop includes `swap`. Stale later occurrence refused by test.
* **D1 rehearsal header counts — HOLDS.** `scripts/rehearsal-tree.sh` header now says six substitutions / five ids + root. `SPEC 53` says same. Executable `PROGS` has five + root.
* **D2 judge helper-independence comment — HOLDS.** `bank/swap.mjs:judgeSwapInstructions` header now says “Both share pure ATA/discriminator/byte primitives; the venue program validates its pool-owned liquidity accounts.”

No surviving defect from those nine was re-measured. No regression in floors: `844/844` on-chain, `789/789` detector, `39` allocation, `22` poster, `14` PoB, `47` launch, `6` host, `33` mainnet, `16` swap-fork all equality-gated.

## R1. CRANK

No value-moving, dead-vault-pay, or out-of-order reveal defect survives. Verified: only `d('activate','capture_entropy','claim','distribute','expire_boosts','reschedule_reveal','retire_burned','reveal_level','split_revenue')`, no SPL/System transfer constructed, no program but MINT, free `distribute(false)` only, burned never joined/paid, reveal strictly from `revealed_total` with break-on-fail, split requires live unfrozen pool + Squads + revenue, fee budgeted with reveal-rent and FIFO prefix.

**R1-I1 INFO — conservative tick withheld while pool frozen.**
Construct: `bank/crank.mjs:planCrank` `if(joinable && poolOk && !pool.frozen && due ...)` gates both `credit` and `tick`.
Gain/accident: during a pool freeze no launch tick is planned, so eligible→joinable transition waits for thaw or other traffic, delaying first cohort by freeze duration. Program’s `monthly_inline` and explicit tick path allow a bookkeeping-only tick without moving funds.
Evidence if true: `pool.frozen=true`, `w=0`, `pending_this_epoch>0`, `due` → `plan.distribute=false`; chain `distribute(false)` with same state would advance epoch. Observable in dry-run plan vs landed tick.
Fix: keep as explicit policy or split tick from credit gate with comment; do not silently treat as program refusal.

## R2. ALARM

Production pins, third-party watches, sweep watches, boost watches, overdue/insolvent/brake/armed/reschedule/frozen/unsplit/unswept/silent/posture/health all wired and both-ways armed. No quiet-dangerous or always-noisy state found beyond disclosed grace.

**R2-I1 INFO — first-seen third-party program blind for one pass.**
Construct: `bank/detectors.mjs:detectConfigDrift` `if(prev[k]===undefined && THIRD_PARTY_KEYS.has(k)) continue`.
Gain: a baseline predating round 25 that first records a malicious Orca/Meteora/Pyth hash/authority change records it without paging; paging starts on next change. One-pass window.
Evidence if true: `prev={}` vs `cur={prog.orca.hash:'evil'}` → `[]`; second pass with `'evil'→'evil2'` → HIGH. Selftest already proves second half.
Fix: document as intentional bootstrap; alternatively page INFO on first record. Not a silent-loss: split/swap floor and delta check still bound execution.

## R3. LAYOUTS

Assertions are real. `bank/selftest.mjs` parses every `pub struct` from Rust and requires field-for-field + type equality, compares every `OFF_*` scraped from GOV/BURN/MINT against `layout.mjs:offsets`, checks versions, `BOOST_RING`, `MINT_CONFIG_SPACE/VAULT_RECORD_SPACE` less padding evaluated from Rust, seeds (11/11, D6 repaired), round-trip and refusals, suite `OFF_*` copies. No scraped constant goes uncompared. A struct edit, retype, added field, moved offset, bumped version, mistyped seed, or changed space fails the build. No finding.

## R4. MONEY ARITHMETIC

`bank/accrual.mjs:credit/pendingScaled/pendingSats/reweigh/debtAtActivation/ceilSats/available` equals `programs/cbob-vault-mint:credit/owed_of/reweigh/join/retire/ceil_sats`. Crank expires `preExpires` before and `postExpires` after every distribution, skips retired, uses `weight+boost` denominator with `carry`. Alarm pages `boosts_stalled`, watches `cbob_mint/max_boost_weight/max_boost_epochs` as CRITICAL drift and boost terms as HIGH. Selftest proves sats not batch counts, expiry math, carry. No divergence.

## R5. SWAP AND REVENUE CYCLE

(a) Oracle math correct. `oracleFloor: sats=lamports*sol*10^(es-eb)/(btc*10)` matches `SOL_USD=sol.price*10^es`, `BTC_USD=btc.price*10^eb`. Integer division floors twice, `minSats>0` required. `satsPerLamport` float only for deviation display; operands <2^53, no overflow. Floor below honest pool after 0.16% fee + royalty impact, proven by 10 SOL fork: Orca 1,403,675 / Meteora 1,402,806 vs expected 1,407,003 floor 1,385,897.
(b) `readPyth` offsets verified: 8+32+1+32+8+8+4+8, `level==1` Full only, feed id exact, owner==receiver, age 180s on chain Clock, future 30s refused, conf 30bps per feed. Derived PDA + owner + Full + feed + freshness is sufficient under stated trust (pool programs, Pyth, single RPC, tree integrity). Clock owner checked, unreadable refuses.
(c) Deviation correct direction: `orcaSpot=(sqrt/2^64)^2` sats/lamport raw, `meteoraSpot=1/(1+step/10000)^active_id` X/Y raw. Both compared to same `satsPerLamport`. Float error ~1e-15 vs 100bps gate; 99/101 both sides proven through `market()`.
(d) Minimum out same floor both venues: Orca `other_amount_threshold` and Meteora `min_amount_out` both bytes 16..24, checked equal to `minSats`, same `f.minSats` deviation filter assumed.
(e) Judge complete for our-defect class. Checks 7-length, CU 400k only, no price, exact ATA creates for own wallet/mint, exact wrap amount/dest, SyncNative, swap amount/threshold/direction/price-limit, pool, input key 3/4 output key 5, authority signer slot, single close last, no other Token ix. Eight round-25 tampers refused by name on both venues.
(f) Derivations correct and fork-proven: Orca `[s0,s0-span,s0-2span]` for a_to_b, `tick_array/pool/String(start)`, oracle PDA; Meteora `[i,i+1,i+2]` for Y→X, `bin_array/pool/i64LE`, bitmap or program-id, `host_fee_in=None`, event authority, two TOKEN. Boundary handled; uninitialised array → on-chain refusal → fallback, never silent.
(g) wSOL wrap-exact/sync/close atomic. Pre-existing wSOL unwrapped on close to same owner, no loss. Frozen/delegate/closed edge below.
(h) Retry safe. `classifySendFailure`: preflight/on-chain-err/expired-absent→`refused`, settled-success→`landed`, else `unknown` stays open. Meteora only on `refused`, never on `unknown`. No double-swap on timeout-landed; ledger stays open until split (`cycleIsOpen` requires `splitSig/splitByOther`).
(i) Extraction bounded, not removed. 100bps gate +150bps floor ≈250bps below oracle plus ≤30bps per-feed confidence slack; sandwich/edge-pushed/thin-Meteora cannot breach on-chain floor in one tx. At 10 SOL ≈1.4M sats, ≈35k sats ≈$30/cycle, ≈$120/day at 4/day. Materiality is throughput-capped, disclosed. Operator worst case unchanged: 10 SOL × windows until `emergency_stop_sweep`, trusts pool programs+oracle+RPC+tree, ledger held to chain (`rejected_row_has_sweep/sweep_on_rejected_row/split_claim_unanchored`, horizon follows scan, start capped by block time).

**R5-L1 LOW — operator wSOL ATA health not pre-checked.**
Construct: `bank/revenue.mjs:prepare` reads operator cbBTC ATA, creates if absent, never reads operator wSOL ATA frozen/delegate/close state before sweep.
Gain: sweep lands, swap refuses (frozen wSOL or delegate), SOL sits on operator key, cycle open loud, hand recovery needed. Not theft, but avoidable post-sweep failure.
Evidence if true: wSOL ATA `state==frozen` or `delegate!=null` → fork `swapInstructions` + `sendAndConfirm` fails, `sweptLamports` set, `swapSig` absent, `--audit` open, alarm `unreconciled_swap` after grace. Pre-sweep `getAccountInfo` would have shown it.
Fix: in `prepare`, read operator wSOL ATA if exists; refuse sweep with named fault if frozen or delegated; else proceed (absent is fine, builder creates idempotent).

**R5-I2 INFO — liquidity accounts left to venue program.**
Construct: `bank/swap.mjs:judgeSwapInstructions` does not compare Orca vaultA/B/tick-arrays/oracle or Meteora reserves/bin-arrays/bitmap/oracle to derived values.
Gain: none demonstrated without box compromise (accepted box-owner residue); a builder defect swapping in stranger-owned liquidity would still pass judge but must still clear on-chain floor and venue validation. Post-swap delta check catches value loss.
Evidence if true: mutated tick/bin/vault in built ixs → `judgeSwapInstructions==[]` (by design), fork send refuses or floor holds.
Fix: derive expected arrays/vaults/reserves from `w/p` and require equality in judge; keep venue validation as second layer.

## R6. GATES

No vacuous floor, no deletable work, no empty-input pass. `run-tests.sh` equality floors for on-chain/detector/allocation/poster/PoB/launch/host/mainnet, `swap-fork.sh SWAP_FLOOR=16` equality, `sim SIM_FLOOR`, selftest `FLOOR=789` equality, launch `47`, Spec every-occurrence gate now includes `swap-fork`. `build-mainnet.sh` proves four init-authority rejects/accepts + sweep byte-identity to fresh rebuild and to `target/deploy` deployed bytes, five artifacts hashed, dirty-tree refused. `cron-install.sh` installs exactly six tagged jobs, hourly revenue shorter than ruled cooldown, rehearsal marker refused, preserve anchored to `TAG job$`, posture computed from written crontab. Round-24 both-directions arms verified; L13b/L5/I4 mutation arms prove deletion/comment/discard caught.

## ACCEPTED LIMITS — FOUR QUESTIONS

1. **Worse than stated? No.** Spot-checked cap×windows, forfeit, packet 1,209/1,367 vs narrow 1,219 offline, re-roll window, C-grind best-of-4, ring 64→3,047, Core three consequences, hot-collection end/capture, unsplit 100/200 GARY, CBOB custody, operator cap. None understated; tolerances explicitly not hard true-price bounds.
2. **Listed but not a limit / already closed? No.** Narrow packet variant still offline-only, prior-tx rule still required. No accepted item found closed by unnoticed code.
3. **DISCHARGED not discharged? No.** 51 boost terms/owner-only/carry/gates measured; 54/CU/host shapes measured; 12/17,14,19,30,31,33,1a-24 remain gone with Bank/deck/distributor or measured closed.
4. **OPEN treated as accepted? No.** 22 rehearsal/live-cycle/hand-recovery still gated, 38 dates still OPEN and checker-refused, 50 surfaces still DRAFT/unbuilt with publication block, 52 pool/Squads/revenue funding still road-step-10, 53 rehearsal proof stale and value-set unbuilt. No code assumes them done.

## ELSE — NONE ABOVE LOW

No new theft, unseal, payout mis-accounting, supermajority bypass, or silent-loss path established. Unrun hypotheses (sparse-array fork mutation, 2,100-sale load, null-status-actually-landed RPC trace) remain missing evidence, not findings.

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS AND PROGRAMS WILL BE IMMUTABLE — WHAT AI AUDIT STRUCTURALLY CANNOT DO

* **Run the dress rehearsal with real value and real failure.** AI can read `rehearsal-tree.sh` but cannot certify 2,100-vault crank I/O, both-venue live revenue cycles, forced post-sweep hand recovery with signatures, alarm rehearsal mode without muting production, DAS burnt-flag read. Do road step 8 at throwaway ids with small real SOL/cbBTC, record every signature, re-run `run-tests.sh` at release commit. Do not lock before this.
* **Perform the launch ceremony by hand.** AI cannot ensure `launch/mainnet-init.json` ruled values become the four signed `initialize` transactions, SEAL-first ordering, three cbBTC accounts created + revenue funded above rent, charter/lock dates set 24h apart, deploy verification against `build-mainnet.sh` SHA256 on an independent machine, then `set-upgrade-authority --final` on all five. Require two humans, one reading JSON one reading chain, with offline signing.
* **Custody the hot keys outside the box.** AI cannot move swap-operator float, CBOB release supply, guardian wallet, or PoB collection authority to cold/multisig where ruled, delete box secrets, or verify backups. The box-owner residue (limit 10(3)) and CBOB supply (limit 56) survive every static gate. Close or explicitly accept with Gary signature before mint.
* **Build the holder surfaces the guide promises.** AI cannot ship deposit-address page, pre-signature `judgeRedemptionCoverage` + sweep-list + prior-tx creator, claim-first offer, packet/CU handling, X/website poster sender. Item 50 blocks publication and lock; building it inside `bank/scripts/programs` resets freeze.
* **Reproduce builds independently.** AI cannot prove compiled constant equals Gary key (third-wrong-key indistinguishability admitted by `build-mainnet.sh`). Rebuild from commit on a second host and compare `dist/SHA256SUMS` before deploy.
* **Watch the trusted third parties after lock.** AI cannot monitor Orca/Meteora/Pyth upgrade keys, Core hash, cbBTC freeze authority, RPC integrity in production. Fund the alarm, deadman, and human guardian path; define who tops up operator/crank floats and who pulls `emergency_stop_sweep` within one alarm cadence.