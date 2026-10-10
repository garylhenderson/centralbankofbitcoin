# Independent Security Audit — CBOB Vaults v6, Off-Chain Pipeline (Round 47)

## R0. Round 46's Verdict and Its Repairs

**Round 46 was LAUNCH-CLEAN on both passes (quorum 6/8, no margin). REQUIRES CHANGES: V46-1..V46-8, V46o-1..V46o-5.** I independently verified every repair at its construct.

| Repair | Construct verified | Holds? |
|---|---|---|
| V46-1 (resumable multi-send steps) | `rehearsal-steps.mjs` marks every multi-send step `resumable: true`; `nextAction` re-enters only with `--resume`; `SINGLE_SEND_STEPS` names only one-send steps | Yes |
| V46-2 (values re-filled before step 10) | `ceremony-values` sits after every upgrade, before `ceremony-collection`; `recheckAction` re-runs a done recheck step whose read-back no longer holds; `judgeValuesFresh` refuses a stale date | Yes |
| V46-3 (rescue records the nest) | `rehearsal-steps.mjs` rescue step records `nestedSent` when vault-3 is already at the nest PDA or treasury, before the branch that would nest it again | Yes |
| V46-4 (hand recovery after a landed swap) | `rehearsal-recover.mjs` `handRecover` completes return and split after a landed swap; reads an already hand-closed cycle as done | Yes |
| V46-5 (mainnet-local refuses overrides) | `bundle.test.mjs` proves `--rpc`, `--collection`, `--launch-json` refused on mainnet-local at build time; `activeProfile` ignores injected overrides on mainnet/mainnet-local | Yes |
| V46-6 (refused values end preflight) | `ceremony.mjs` preflight returns null on `fails.length` before program/mint/account reads | Yes |
| V46-7 (SPEC 53 stale sentence) | SPEC records the `e7c192a` re-proof. **But see V47-1 below: the "what keeps it open" text is now itself stale.** | Partially |
| V46-8 (init key by genesis) | `initKeyFor('mainnet')` returns Gary's wallet; `judgeInitAccount` refuses a program-owned account; `judgeRehearsal` accepts only the network's key | Yes |
| V46o-1 (ack arm on ackable kind) | `selftest.mjs` drives `unredeemable_owner` with no asset and a well-formed ack; asserts CRITICAL and no `acked` | Yes |
| V46o-2 (undelivered pass rollback) | `alarm.mjs` `!delivered` block restores `unreadPasses` and `unreadSkips` | Yes |
| V46o-3 (load-time refusal pages) | `refuseStrayOverridesAtLoad` reaches the literal production notifier once, writes its marker, exits 3 | Yes |
| V46o-4 (tracked placeholder fixture) | `web/test/fixtures/placeholder/` is tracked with SHA256SUMS; `ceremony.test.mjs` reads from there | Yes |
| V46o-5 (audit prompt bundle claims) | `scripts/audit47.ts` computes its bundle claims from its file list | Yes |

**Post-46 changes (not seen by any auditor):** the five mainnet rehearsal faults (REHEARSAL-OPEN collection status, wallet-edit judge, stray listing via `getTokenAccountsByOwner`, show-my-vaults), the Core re-pin to `51d41542`, the Core watch, the README with generated facts, and the stripped release build (`d2ae5fc`). Each is new code. I audited each below.

---

## R1. The Crank (`bank/crank.mjs`)

**No defect found.** Specific checks:

- **A plan the program will refuse:** `planCrank` sends `distribute` only when `joinable && poolOk && due && w > 0n` and `avail > 0n`, or `joinable && poolOk && due && w === 0n && waitingThisEpoch` (tick). The on-chain `distribute` has the same gates (`BoostsExpireFirst`, `JoinWaitingFirst`, `MonthNotElapsed`, `PoolShort`, `NothingToDistribute`, `NoActiveVaults`). Races are handled by `judgeDistributeRefusal` (benign only if the epoch moved). `PoolShort` is never benign. No plan the program will refuse except in a narrow race, which pages correctly.

- **Pays or joins a dead vault:** `planCrank` skips `assets[r.asset] !== 'live'` for both joins and claims. A burned vault is retired first (`retireBurned`), never joined or paid. `unreadableEligible` blocks the distribution entirely. Correct.

- **Reveal out of order:** Reveals run strictly from `cfg.revealed_total` in mint order, stopping at the first not-ready vault. `reveal_level` enforces `RevealOutOfOrder` on chain. Correct.

- **Value movement:** The crank sends only permissionless MINT instructions (`activate`, `capture_entropy`, `claim`, `distribute`, `expire_boosts`, `reschedule_reveal`, `rescue_nested`, `retire_burned`, `reveal_level`, `split_revenue`). No SPL transfer, no System transfer, no other program. The selftest asserts this. Correct.

- **Fee budget:** `budgetPlan` runs the base plan whenever the key covers it, sends reveals only while keeping the floor, and pages dropped reveals. `judgeFeePayer` checks the minimum first (round 24 L6a repair). Correct.

---

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No defect found.** Specific checks:

- **Dangerous state read as quiet:** Every detector I checked fires in both directions (proven by the 1072-assertion selftest). `detectVaultSetChange` catches bare burns. `detectSweepState` catches unledgered sweeps from account state. `detectUnreconciledRevenue` catches missing returns. `detectPoolHealth` catches insolvent pools. `detectDistributionOverdue` catches missed distributions. `detectCrankSilent` catches a stalled crank. No dangerous state reads as quiet.

- **Routine state paged every pass:** Freezes are one-shot (`applyFrozenTransitions`). Level conditions (`distribution_overdue`, `crank_silent`, etc.) re-assert but send a RECOVERY when they clear. `sales_stopped` and `sweep_stopped` are INFO, not paged. Correct.

- **Gary's production values:** `detectStandingRisks` with `production: true` asserts 21%/51%/3 days, 7-day notice, the tighten bounds, 30-day month, 1-hour window. The selftest proves each both ways. Correct.

- **All five programs watched:** `WATCH` includes `prog.sweep.upgrade_authority` and `prog.sweep.hash`. `detectUpgradeAuthorityAfterLock` checks all five. Correct.

---

## R3. The Layouts (`bank/layout.mjs`)

**No defect found.** Every account is declared once in `STRUCTS` and asserted against the Rust via `parseRustStruct` (field-for-field, type-for-type). Every cross-program pinned offset is asserted against the computed offset. The SEEDS assertion exists (round 24 D6 repair): all 12 seeds are scraped from the Rust and compared. A struct change would turn the build red. Correct.

---

## R4. The Money Arithmetic (`bank/accrual.mjs`)

**No divergence found.** `credit`, `pendingSats`, `pendingScaled`, `reweigh`, `ceilSats`, `available` all match MINT's Rust (`credit`, `owed_of`, `reweigh`, `ceil_sats`, `join`). The selftest proves the 1:1.5:2:2.5:3 ratio, dust carrying, and boost carry. The crank expires due boosts before distributing and post-distribution boosts after. `boosts_stalled` and `cbob_mint`/boost bounds are watched. Correct.

---

## R5. The Swap (`bank/swap.mjs`, `bank/revenue.mjs`)

**(a) Oracle math:** `oracleFloor` computes `sats = lamports * sol_price * 10^(sol_expo - btc_expo) / (btc_price * 10)`. Verified against the selftest's pinned vector (280,355 expected, 276,149 floor at 150 bps). Integer division floors `minSats` (safe direction). BigInt prevents overflow. `satsPerLamport` uses Number only for the deviation filter (acceptable precision). Correct.

**(b) Pyth verification:** `readPyth` requires the account to be owned by the Pyth receiver, fully verified (level 1), and carry the expected feed id. Staleness (180 s) and future-dating (30 s) are judged against the chain's Clock sysvar. The account address is derived (sponsored feed PDA). A stale or chosen price requires compromising Pyth's publisher set (accepted limit 10). Correct.

**(c) Deviation filter:** `orcaSpot` = `(sqrt_price / 2^64)^2` in sats per lamport (verified: token A is wSOL, token B is cbBTC, raw units match). `meteoraSpot` = `1 / (1 + binStep/10000)^activeId` in sats per lamport (verified: X is cbBTC, Y is wSOL, inverted correctly). Both compared against `f.satsPerLamport`. Floating point cannot pass a pool it should refuse (the 100 bps bound is generous relative to float precision). Correct.

**(d) Minimum out:** `minSats` from `oracleFloor` is passed as `other_amount_threshold` (Orca) and `min_amount_out` (Meteora), both in cbBTC sats. The judge verifies the threshold bytes match. Same floor as the deviation filter assumed. Correct.

**(e) The judge:** `judgeSwapInstructions` requires the exact 7-instruction sequence, checks programs, signers, the swap's amount/threshold/direction/price-limit, the wrap amount, the ATA creations, the close, and refuses any priority fee or extra Token instruction. I found no tamper that passes both the judge and the on-chain program. The judge is defense in depth; the pool programs validate vaults, bin arrays, and tick arrays on chain. Correct.

**(f) Account derivation:** Orca tick arrays: `[s0, s0-span, s0-2*span]` for a_to_b (verified against mainnet). Meteora bin arrays: `[i, i+1, i+2]` for Y-to-X (verified). Negative ticks/ids floor correctly. The bitmap is passed as the program id (None) when absent. Correct.

**(g) wSOL handling:** Wrap exactly `lamportsIn`, sync, swap, close. A pre-existing wSOL balance is returned by the close. A partial fill is caught by the post-swap delta check. Correct.

**(h) Failure and retry:** Orca first; Meteora only if Orca REFUSES (on-chain error or failed preflight). `classifySendFailure` distinguishes refused/landed/unknown by asking the chain. An unconfirmed send stops the cycle (open and loud). No double-swap. Correct.

**(i) Adversary extraction:** With a 100 bps deviation gate and 150 bps floor, the worst case is ~51 bps (pool at 99 bps from oracle, floor at 150 bps). A sandwich on the Meteora pool (~$0.9M) could extract more through price impact, but the floor still binds. The cycle size (10 SOL max) makes this material only at the margin. Accepted limit 10 covers the trusted hop.

---

## R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

**No assertion that cannot fail.** The floors use exact equality (`-eq`, not `-ge`). The selftest's `FLOOR = 1072` must equal the count. Mutation tests prove each arm can fail (e.g., removing `!f.asset ||` from `applyAcks` turns V46o-1's arm red). No vacuous checks found. `scripts/build-mainnet.sh` proves all five programs (key behaviour for four, byte identity for the sweep helper). `scripts/cron-install.sh` arms nothing it should not (the preserve block reads only tagged, uncommented lines).

---

## The Four Questions About Accepted Limits

1. **Is any limit WORSE than stated?** No. Every limit I checked is accurately described. Limit 10 (swap operator) correctly states the bound as cap × cooldown windows. Limit 46 (PoB hot key) correctly states the charter-window exposure. Limit 56 ($CBOB hot wallet) correctly states the theft cost.

2. **Is any listed limit not actually a limit?** No. Each is live and unrepaired.

3. **Is any DISCHARGED item not actually discharged?** No. Items 1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24 went with the Bank/deck/distributor. Items 12/17, 14, 19, 30, 31, 33, 51, 54 are measured closed.

4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still open and blocking. Item 22's scale gap (5 vaults vs 2,100) is explicitly recorded. Item 50's pages are staged, not published.

---

## Findings

### V47-1 — LOW — SPEC item 53's "what keeps it open" text contradicts the SPEC's own road table

**Construct:** `SPEC.md`, item 53, the sentence "and the dress rehearsal itself (road step 8, item 22) has not yet run to its end on mainnet." The SPEC's road table (step 8) says "done on mainnet 2026-10-09 to 10-10", and `audits/rehearsal-2026-10-09/RECORD.md` records the completed run.

**What an attacker or accident gains:** Nothing. This is a documentation inconsistency that could mislead a future reader into thinking item 53 is blocked on a rehearsal that has already happened, delaying launch unnecessarily.

**Evidence if right:** `SPEC.md` item 53 text vs `SPEC.md` road table step 8 vs `audits/rehearsal-2026-10-09/RECORD.md`. All three are in the bundle.

**Fix:** Update item 53's "what keeps it open" to remove the rehearsal reason (it has run) and state only the remaining reason (every repair commit needs the in-tree run). This is documentation-only, changes no code/test/page/build, and misstates nothing about a holder's money or rights.

### V47-2 — INFO — `detectLogGaps`'s comment misstates the keep bound

**Construct:** `bank/detectors.mjs`, `detectLogGaps`, the comment "the reviewed prefix is trimmed to 500 in all, keeping the watermark itself." The code trims to `max(1, 500 - unreviewed.length)`, so the total `keep` is `max(1, 500 - unreviewed.length) + unreviewed.length`, which exceeds 500 when `unreviewed.length > 499`.

**What an attacker or accident gains:** Nothing. The behaviour is correct (never evict unreviewed entries). The comment could mislead a maintainer into thinking the state is bounded at 500.

**Evidence if right:** `detectors.mjs` `detectLogGaps` code vs its comment. The selftest's R32 L3 arm proves 600 unreviewed entries are kept.

**Fix:** Reword the comment to say "the reviewed prefix is trimmed so the total is at most 500 when few entries are unreviewed; unreviewed entries are always kept in full."

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

AI audit reasons about code. It cannot do these seven things, and each one is load-bearing for a system that will hold real Bitcoin forever:

**1. Have a human restore from a backup and verify the keys work.** The nightly R2 backup includes `bank/keys/`. Nobody has ever tested a restore. A backup that has never been restored is a hope, not a backup. Before the lock, someone must actually restore the swap operator key, the deploy authority, and the $CBOB release wallet from backup onto a clean machine and verify each one signs correctly. If any key is missing or corrupt, launch must stop.

**2. Have a non-technical person get a vault, fill it, and open it using only the holder guide and the pages.** The guide promises "the Bank's pages show it" and "the redeem page will take out the other ordinary tokens." If a normal person cannot complete the four steps without calling support, the surfaces are not ready. Watch them struggle. Fix what they stumble on. This is a usability test, not a code review.

**3. Practice the emergency procedures under stress.** Pull the guardian brake. Replace the swap operator key. Recover a failed revenue cycle by hand. Have someone who was not involved in writing the runbook do each one, timed, with only the documentation. If they cannot do it in 30 minutes, the procedures are not real. Write the runbook first if it does not exist.

**4. Run the crank, alarm, and revenue cycle at realistic scale before locking.** The mainnet rehearsal was 5 vaults. The crank's claim batches,