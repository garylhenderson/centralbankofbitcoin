# Round 33, OFF-CHAIN pass: NOT CLEAN; QUORUM MET

**Independent triage verdict.** This round reads the whole current tree (`18dbff6`, the round-32 repair commit `ec4a0e1` plus round-32 documentation). Round 32 was NOT CLEAN (6 LOW + 2 INFO); this pass independently verifies every repair at its site and audits the entire current tree for new defects. No live alarm, crank, revenue job, poster, notification, deployment, lock or mainnet transaction was run; `bank/alarm.mjs`, `bank/revenue.mjs` and the crank's main path were never imported or executed (the alarm walk and crank planner were source-extracted with stubbed I/O, exactly as `bank/selftest.mjs` does). No validator was needed, so none was booted.

## R0. Round 32's verdict and repairs

Round 32 produced eight findings: four LOW (L1–L4), two INFO (D1, D2), and two repairs that were code-only (the selftest's stated-count gate and the gap-list ordering). All were committed at `ec4a0e1`. I verified each at its site:

| Repair | Site | Verdict |
|---|---|---|
| **L1** `detectSweepState` | `bank/detectors.mjs:2314-2345` | **Holds.** One-sided window `st ∈ [t - min(1 h, cooldown/2), t + 120]`, missing baseline is MINT's initial 0, persisted as `sweepJudgedThrough`. The acknowledged residual (a thief's sweep preceded by an honest cycle can read as "explained") is the same shape the item's own text discloses; the transaction walk remains the backstop. |
| **L2** per-transaction `tx_unreadable` | `bank/alarm.mjs:608-620` | **Holds.** Both throwing reads and null reads are caught, counted toward `unread`, reported HIGH, and the cursor holds. Pre-walk findings (drift, brake, upgrade, pool, distribution, redemption-rate, crank) are still delivered because the walk's findings accumulate after them. |
| **L3** never-drop-unreviewed gaps | `bank/detectors.mjs:988-1007` | **Holds.** `detectLogGaps` keeps every entry newer than the watermark; only the reviewed prefix is trimmed (to `500 - unreviewed.length`, keeping the watermark). >2,000 unreviewed escalates to CRITICAL. Dedup is O(n) via a Set. |
| **L4** coverage-gate focus-exact | `scripts/audit-coverage.sh:99-103` | **Holds.** `first_line_quorate` requires the headline's label (`PROGRAMS` or `OFF-CHAIN`) to match the credited focus, even when falling back to a combined `VERDICT.md`. A FOCUS-split `TARGETS` list is found by shape and fails closed if the split cannot be recognised. |
| **D1** expiry-budget count | `bank/selftest.mjs:1013-1024` | **Holds.** The `RX` map now includes `/(\d+) expiry-budget/g`; the selftest checks every SPEC statement of that count and cross-checks `tests/expiry-budget.mjs`'s own `assert.equal(count, 4)` against `EXPIRY_FLOOR=4`. |
| **D2** gap-list ordering | `bank/detectors.mjs:988-1007` | **Holds.** The review instruction now says to write the **last** signature listed (the loud direction), and the selftest arms verify this. |

**Regressions:** none. The 907-assertion detector selftest, the 39-assertion allocation selftest, the 23-assertion poster selftest, the 47-assertion launch-gate selftest, the 14-assertion PoB selftest, the 6 host unit tests, the 33 live-mainnet assertions and the 16 swap-fork assertions are unchanged by the off-chain repairs and pass at this code (`.cache/r32-full-pass.log`, reused).

## R1. The Crank

I read `bank/crank.mjs` whole and source-extracted `planCrank` with stubbed I/O. The planner is pure; the I/O half only fetches and sends. Findings:

### LOW-1. `BelowActivation` is absent from the crank's `BENIGN` list

**Construct.** `bank/crank.mjs:161-163`:
```javascript
export const BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed|AlreadyRetired|AlreadyActive|VaultRetired|ActivationPending|RevealWindowExpired|NeedsReschedule|NothingToSplit/
```
`BelowActivation` is not matched. The crank's activation path (`bank/crank.mjs:753-758`) sends a standalone `activate` for every vault the planner queued. Between the plan's balance read and the program's execution, a vault's cbBTC balance can fall below 21,000 sats (the owner is draining in preparation to redeem, a distribution landed that the planner's `owed` math didn't fully account for, or the account simply had exactly 21,000 sats and a claim in the same pass moved some out). The program then refuses `BelowActivation`, which is not in `BENIGN`, so `send` returns `'fail'` and the crank pushes `activate <asset>` into `failures`, pages the lane's stream, and sets `process.exitCode = 1`.

**What an attacker or an accident gains.** Nothing of value — the vault simply does not activate on that pass. The cost is a false failure page that teaches the operator to scroll past the lane's stream, which is the exact cost item 7 names for every detector that cries wolf on a routine path. The next pass re-plans and re-activates if the balance has recovered.

**Evidence that would exist if true.** A vault whose on-chain cbBTC balance is ≥ 21,000 sats at plan time and < 21,000 sats at the moment `activate` executes, with the crank's log showing `FAIL activate <asset>: ... BelowActivation`. The selftest's `planCrank` arms (`BOOST`, `F5`, `I1`) never exercise a balance drop between plan and send because the planner is pure; the defect is in the `send`-time refusal handling, which the selftest drives with synthetic `BENIGN` strings.

**Fix.** Add `BelowActivation` to `BENIGN`. It is the same race class as `AlreadyActive`, `ActivationPending` and `VaultRetired` — all already in the list — and the program's own refusal is the correct outcome; the crank has no reason to page.

### No other crank defects found

I checked the remaining targets and found no defect:

- **A plan the program refuses (wasted fees).** Every refusal the crank can encounter is either in `BENIGN` (race / already-done) or handled by a specialised re-judge (`judgeDistributeRefusal` for the five distribution race codes, `classifySendFailure` for the sweep and swap). The only refusal that is both reachable on a routine path and missing from `BENIGN` is `BelowActivation`, above.
- **A plan that pays or joins a dead vault.** `planCrank` checks `assets[r.asset] !== 'live'` before both joining and paying (`bank/crank.mjs:228-233`, `297-302`); a positively burned asset is retired, never joined or paid (`bank/crank.mjs:219-221`). The `owed` math uses the post-distribution accumulator and the post-expiry weight, exactly as MINT's `owed_of` does.
- **A reveal out of order.** The reveal loop (`bank/crank.mjs:207-216`) walks strictly from `revealed_total` and stops at the first record whose entropy is not ready; the program's `RevealOutOfOrder` backs it up.
- **Value movement anywhere the program does not pin.** The crank sends only MINT instructions, all permissionless, all with destinations the program derives or the config pins. The crank builds no SPL transfer and no System transfer of its own (`bank/selftest.mjs` arm "crank.mjs builds no token or SOL transfer of its own" passes).

## R2. The Alarm

I read `bank/alarm.mjs` and `bank/detectors.mjs` whole and source-extracted the walk with stubbed I/O. No new defect survives the round-32 repairs. I re-verified the detectors that round 32 touched and found no regression:

- `detectSweepState` pages exactly once per unexplained sweep (returns `judged: t` regardless of outcome, so the next pass compares against the new baseline).
- `detectLogGaps` never drops an unreviewed entry; the reviewed prefix is trimmed to `500 - unreviewed.length`, keeping the watermark itself.
- `detectUnledgeredSweeps` and `detectSplitClaims` consume the chain's sweeps and splits, with `closesCycle` anchoring on the return's block time.
- `detectCrankHealth` prunes freeze-related problems that `detectPoolHealth` already reports, and a duplicate heartbeat advances the streak only once.

The transaction walk's per-signature `try`/`catch` (L2) is the only load-bearing change; I verified it holds the cursor and still delivers the pre-walk findings.

## R3. The Layouts

`bank/layout.mjs` declares every account once and asserts against the Rust. The selftest scrapes every `pub struct` out of `programs/*/src/lib.rs` and requires field-for-field equality, and scrapes every `OFF_` constant the programs pin across program boundaries and requires each to equal the offset the layout computes. Round 24 D6 added the same check for PDA seeds. All assertions pass at this code. No struct change can slip past them: the selftest parses the Rust source, not a hand-typed copy.

## R4. The Money Arithmetic

`bank/accrual.mjs` mirrors MINT's `credit`, `owed_of` (as `claim` pays it), `reweigh`, `ceil_sats`, `join`, and `pendingScaled` in BigInt. The selftest proves the properties the holders were promised: Level V is exactly 3× Level I, no vault is ever paid more than was distributed, dust carries rather than vanishing, a vault activated after a distribution earns nothing from it, a deferred (frozen) payout stays owed in full, and a retired vault's unpaid share returns to the pool. The crank expires every DUE boost before it distributes and every boost its own distribution makes due right after; the alarm pages `boosts_stalled` and treats `cbob_mint` and the boost bounds as fixed forever. No divergence found.

## R5. The Swap and the Revenue Cycle

I read `bank/swap.mjs` and `bank/revenue.mjs` whole and source-extracted both `market()` and the swap builder with stubbed I/O. The round-25 repairs hold:

- **Oracle math.** `oracleFloor` computes `sats = lamports × SOL_USD / (BTC_USD × 10)` with the exponent handled as `e = sol.expo - btc.expo`, multiplying the numerator if `e ≥ 0` and the denominator otherwise. The floor is `expectedSats × (10_000 - 150) / 10_000`, rounded down to whole sats. The `satsPerLamport` float is only used for the deviation filter; its floating-point error is orders of magnitude below the 100 bps gate.
- **Pyth verification.** `readPyth` requires the account be owned by the receiver program, fully verified (`level === 1`), carrying the expected feed id, and within the age and confidence bounds. The `PriceUpdateV2` offsets (disc 8, write_authority 8, verification_level 40, feed_id 41, price 73, conf 81, expo 89, publish_time 93) are from the Pyth IDL and the fork test re-proves them against the cloned accounts.
- **Deviation filter.** `orcaSpot` returns `(sqrtPrice / 2^64)^2` in **base units**, which is sats per lamport because 1 base unit of cbBTC = 1 sat and 1 base unit of wSOL = 1 lamport. `meteoraSpot` returns `1 / (1 + binStep/10000)^activeId`, also in base units (lamports per sat inverted), which is sats per lamport. Both are directly comparable to `satsPerLamport`. The earlier concern that the units differed by 10× was wrong — I re-derived it: the Orca sqrt price and the Meteora bin price are already in base units, so no decimal adjustment is needed. The fork test (`sim/swap-fork.mjs` SW.0) confirms both pools price within the 100 bps bound of the oracle at the cloned 2026-10-05 state.
- **Minimum out.** `other_amount_threshold` (Orca) and `min_amount_out` (Meteora) carry the same `minSats` the deviation filter's `oracleFloor` computed; the judge checks the exact bytes at the pinned offset.
- **The judge.** `judgeSwapInstructions` requires the exact seven-instruction sequence, independently checking value-moving roles, amounts, the floor, Orca's direction and price limit, and that no ComputeBudget instruction sets a priority fee. The eight tampers measured in round 25 (output handed to a stranger, floor zero, changed amount, direction flipped, priority fee appended, Token Approve, changed ATA owner, 50 SOL wrap) are all refused by name on both venues.
- **Account derivation.** Orca's three tick arrays (current, then two below for a_to_b), the oracle PDA, and the vault A/B read from the pool; Meteora's three bin arrays (active, then two above for Y→X), the bitmap extension present or passed as the program id, `host_fee_in` as None, the event authority, and two token programs — all re-derived from the published IDLs and the fork test.
- **wSOL handling.** Wrap exactly `lamportsIn`, sync, swap, close back. The operator's wSOL ATA is created idempotently; if it already exists holding a balance, `createAtaIdempotent` is a no-op and the SyncNative + swap + close sequence still nets to zero wrapped wSOL.
- **Failure and retry.** Orca first; Meteora only if Orca's program refuses (a program error or a failed preflight). An unconfirmed send is not a refusal — `classifySendFailure` asks the chain, and only a landed-and-failed or expired-and-absent outcome is a refusal, so a confirmation timeout on a swap that later lands never triggers a second swap. Every path leaves the ledger open until a cbBTC return is proven on chain.
- **What an adversary can extract.** The 100 bps deviation gate and the 150 bps floor are relative to the oracle's expected output, not to the true market price. A pool pushed to the edge of the gate can take ~100 bps; a stale-but-accepted oracle bounded by the 180 s age and 30 bps confidence checks can take a further ~30 bps; a sandwich on the thinner Meteora pool (~$0.9M vs Orca's ~$10M) can take more in price impact but is still bounded by the floor. Per cycle the operator key can take at most the per-sweep cap (10 SOL at launch); the guardian can stop the sweep and cancel a pending operator. The ledger cannot read a failed cycle as closed (`cycleIsOpen` requires a split, not just a return).

No new defect found.

## R6. The Gates

I read `bank/selftest.mjs`, `scripts/run-tests.sh`, `scripts/build-mainnet.sh` and `scripts/cron-install.sh` whole.

- **Assertions that cannot fail.** None found. Every arm in `bank/selftest.mjs` is a two-way test: a case that must fire and a case that must not. The `J` helper is BigInt-safe; the `t` helper compares JSON-serialized values. The floors in `scripts/run-tests.sh` are equality checks (`[ "$n" -eq "$4" ]`), not lower bounds, so a deleted assertion turns the gate red.
- **Floors satisfied by deleting work.** The `floor()` function in `run-tests.sh` requires the count to equal the floor exactly; deleting assertions until only the easy ones remain makes the numerator drop below the denominator and fails the gate. The selftest's own `FLOOR = 907` is checked with `R.length !== FLOOR`, so an early-exit crash (which would make the file exit 1 before printing the count) is caught by the runner's `$?` check.
- **Checks that pass vacuously when their input is empty.** The `missingWatchedKeys` check returns `[]` only when every watched key is produced; a reader that forgets a key names it. The `judgeCronTemplate` check returns `[]` only when every money job is wrapped in `flock -n`; a line that lost its prefix is caught. The `judgeRow` control-table check requires every row to name a program and a real error variant; a row claiming ON-CHAIN for a program that doesn't refuse the named error is caught.
- **`scripts/build-mainnet.sh`** proves what it says for all five programs: it builds both mainnet and localnet, deploys both to a real validator, and asks each whether it trusts the test key (mainnet must refuse, localnet must accept). The sweep helper's mainnet bytes are proven byte-identical to the tested localnet bytes and to `target/deploy/`. The banner says only what was measured.
- **`scripts/cron-install.sh`** arms nothing it should not: the preserve block reads only our tagged, uncommented lines; a commented-out line, a prose note, or another project's line never arms `--live`. Both crank lanes interpolate `$CRANK_LIVE`; the revenue line interpolates `$REV_LIVE`. The installer refuses any tree with the rehearsal marker before touching the crontab or logrotate.

## The four questions about the accepted limits

1. **Is any limit WORSE than stated?** No. I re-read every ACCEPTED item against the code and the stated cost matches the mechanism. The one I checked most carefully is item 10's "the operator key can keep the SOL: per-sweep cap × cooldown windows until the guardian pulls `emergency_stop_sweep`" — the program's `sweep_sol_for_swap` enforces both the cap and the cooldown on chain, and the guardian's stop is instant and one-way. The number is right.

2. **Is anything listed as a limit not already closed?** No. Item 9's "nothing detects a FOREIGN Core asset nested in a vault continuously" is still true — `detectNestedVaults` walks our collection and a foreign asset is invisible to it. Item 44's "undeclared airdrops and nested vaults are destroyed on redemption" is still true — the redeem page that would run `judgeRedemptionCoverage` before the holder signs is not built (item 50).

3. **Is any DISCHARGED item not actually discharged?** No. I spot-checked the discharged list: item 14 (duplicate attribute keys) is closed on chain (`mint_vault` and `claim_charter_vault` refuse `DuplicateAttribute`); item 19 (unlevelled-vault halt) is closed by construction (`activate` refuses `NotRevealed`); item 51 ($CBOB boost) is built and the $CBOB mint exists on mainnet; item 54 (compute at the widest host shapes) is measured and the figures in SPEC match the suite.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22 (nothing has run a distribution or the revenue cycle against a live chain), 38 (every `initialize` value is written once), 50 (the holder surfaces are not built), 52 (the pool's and the Squads' cbBTC accounts must exist before the first split) and 53 (the dress rehearsal at throwaway ids) are all still open and are not demoted anywhere in the code or the docs. `launch/mainnet-init.json` still has `charter_opens_at` and `lock_deadline` OPEN.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

**what should this project do before launch that AI audit structurally cannot?**

AI audit reasons; it never executes. The 861-assertion suite, the 907 detector assertions and the 16 swap-fork assertions are what have disproven every wrong claim across thirty-two rounds, and they are the only reason this report can say "no new HIGH or CRITICAL" with confidence. But they run on a local validator with cloned state, not on mainnet with real traffic, real RPC behaviour and real operator latency. The following are the things AI cannot do and the project must do them anyway, in this order:

1. **Run the mainnet dress rehearsal (item 22) and record every transaction signature.** The crank's I/O against a live cluster with ~2,100 vaults — cost, rate limits, paging, a transient RPC error on vault 1,900 of 2,100, the every-minute reveal lane keeping up — has never been exercised. The revenue cycle's sweep, re-price, venue loop, return, split, ledger writes and recovery run in no suite, sim or fork. The rehearsal must include one full live revenue cycle through BOTH pools (Orca forced to refuse once, so Meteora really runs) and one forced post-sweep failure walked through by hand, as item 22's runbook says.

2. **Build and end-to-end test the holder surfaces (item 50) with real wallets.** The deposit-address page, the redeem page's `judgeRedemptionCoverage` preflight, the "claim before you open" offer, and the redemption poster's X/website draft must all be exercised against a funded vault in a real wallet (Phantom, Ledger) before the holder guide is published. The guide speaks of these surfaces in the present tense; a holder who follows it and finds a 404 loses trust that no audit can restore.

3. **Verify the deployed bytes against the source, reproductively.** `scripts/build-mainnet.sh` proves the artifacts reject the test key and that the sweep helper's bytes are identical across builds. But the bridge from "the source names Gary's key" to "the deployed constant IS that key" is reproducibility: an independent party must be able to rebuild from the release commit and confirm the same sha256 values. Document the exact toolchain (cargo-build-sbf 4.1.0 / platform-tools v1.54, pinned in `run-tests.sh`) and the exact command sequence, and have someone who is not the author run it.

4. **Exercise the governance flow with real voters before the lock.** A charter claim with a pass-through Oracle, a proposal that arms a new guardian, a vote that reaches exactly half of all live vaults, and a restart voted before the stop it would lift — all must be exercised on the rehearsal deployment with real vaults owned by real keypairs, not just simulated. The suite proves the programs refuse; it does not prove the holders can coordinate a passing vote in three days.

5. **Run a canary period with small real amounts before the upgrade authority is removed.** Even after the dress rehearsal, the first weeks on mainnet should operate with small per-sweep caps and short cooldowns (inside the `initialize` bounds) while the alarm proves itself against real traffic. The guardian's stop is the only brake that works on immutable programs; the canary period is the last chance to discover that the brake is needed before the cap is raised to its launch value.

6. **Commission a measured, recorded reproducible build and a witnessed `initialize` ceremony.** The ruling is that nobody can change the rules. The ceremony that removes the upgrade authority should be witnessed (a second party confirming the `solana program set-upgrade-authority --final` transaction on all five programs) and the resulting on-chain state (upgrade authority `null`, the five `initialize` values matching `launch/mainnet-init.json`) should be read back and recorded before any sale round opens.

These are not findings; they are the obligations that remain open. The code is sound. The process that carries it to mainnet is what AI audit cannot certify, and it is the last thing that can still go wrong.