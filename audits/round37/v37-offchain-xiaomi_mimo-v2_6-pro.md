# Round 37 Off-Chain Audit — Independent Verdict

## R0 — Round 36's verdicts and repairs

I independently verified each confirmed finding's repair against the current tree.

**L1 (sweep-helper text):** Repaired. SPEC "Known limits" and item 44 both say the helper "cannot handle it at all" for a kept-close-authority account and describe the page's separate Core `ExecuteV1` transfer path. Correct.

**L2 (rescue destination text): REPAIR INCOMPLETE — surviving defect.** See Finding 1 below.

**L3 (`unredeemable_owner` text):** Repaired. `detectNestedVaults`'s off-curve branch now names both the host-owner execute and `rescue_nested`; the selftest arm (`R36 L3`) confirms "sealed for good" is absent. Correct.

**L4 (`ACKABLE_KINDS`):** Repaired. `ACKABLE_KINDS = new Set(['unredeemable_owner'])`. The selftest refuses acks on `nested_vault` and `vault_owns_itself` at CRITICAL with `ackRefused`, and still accepts `unredeemable_owner`. Correct.

**L5 (index-lag text):** Repaired. SPEC "Known limits" states every observed lag pages once followed by an ALL CLEAR. The selftest arm (`R36 L5`) pins the 30-minute alarm interval exceeding the 25-minute router grace. Correct.

**Round 36 Gate-5 obligations:** C06 (revenue.mjs sweep compiles with operator as fee payer/signer) is pinned by a source-extracted, compiled assertion. L3, L4, L5 have selftest arms. L1's page-side behaviour is in `web/`, outside this bundle.

**Round 36 C06-C30 dispositions:** I re-tested the C06 refutation (compiled the actual sweep — the operator IS fee payer and signer via web3.js's message header) and C07 (6 host tests including `test_id`). Both hold. I found no regression in any accepted limit or rejected claim.

---

## Finding 1 — LOW (documentation, misstates holder property)

**Construct:** `SPEC.md`, "What got worse, stated plainly" (the round-29 D2 passage, ~line 181-184).

**Defect:** The passage reads *"`rescue_nested` now extracts it, **to the host's owner while the host lives** and to the CBOBTC Squads once it is burned"* — exactly the design Gary rejected at review 35 M1. The code (`programs/cbob-vault-mint/src/lib.rs`, `rescue_nested`) sets `let dest = a.config.bank_treasury` unconditionally, and item 58 says so. Limit 44's heading was updated ("a nested vault is not [destroyed] … it is rescued, item 58") but this second site was not.

**What it misstates:** A holder reading this text would believe a vault sent to a live host's deposit address would be rescued *to the host's owner* (a stranger), when in fact it goes to the CBOBTC Squads, which returns it to the sender. That is a difference in where holder property is sent.

**Evidence if true:** `SPEC.md` contains the string "to the host's owner while the host lives" in the D2 passage. `programs/cbob-vault-mint/src/lib.rs` `rescue_nested` contains `let dest = a.config.bank_treasury` with `require_keys_eq!(a.new_owner.key(), dest, …)` and no branch on host liveness for the destination.

**Fix:** Replace "to the host's owner while the host lives and to the CBOBTC Squads once it is burned" with "always to the CBOBTC Squads (whether the host lives, is burned, or is the vault itself; review 35 M1), which returns it by hand." Pin it (Gate 5).

**Qualification under SPEC gate 3:** This is documentation-only (no code, test, page or build changes), but it *does* misstate where a holder's vault is sent. Under Gary's 2026-10-07 ruling that misstates holder property, it breaks the clean streak.

---

## R1 — The crank (`bank/crank.mjs`)

I traced every plan branch against the program's refusal set. Specific things checked and found correct:

- **Reveal order** is strict FIFO from `revealed_total`; the first un-ready vault stops the run. A rescheduled vault returns `RevealTooEarly` (benign), correctly halting the run rather than skipping ahead.
- **Pre-join before distribute** matches MINT's `JoinWaitingFirst`. The pre-join batch is a `claim` with `crank_n=0`, which joins without paying (the `claim` handler's `r.pending` branch joins and `continue`s).
- **Owed for pre-joined vaults** is computed at `weight × (post_acc − pre_acc)`, matching `join` setting `debt = weight × acc` before the distribution. If `monthly_inline` fires during the pre-join batch (before the joins in the same instruction), the vaults join at the *post*-distribution accumulator and earn from the next one — the designed behaviour, not a loss.
- **`retiringOwed`** correctly subtracts retiring vaults' pending (including boost weight and carry) before computing `avail`, matching `retire`'s `checked_sub(pending, owed_scaled)`.
- **Pre/post boost expiry** matches `BoostsExpireFirst`: due boosts (`dist_epoch ≥ boost_end_epoch`) expire before; boosts becoming due this distribution (`boost_end_epoch == dist_epoch + 1`) expire after. The owed computation for pre-expired vaults (`atExpiry + level_weight × delta`) matches `expire_boost`'s `reweigh` (carry = owed, debt = level × acc) followed by `credit`.
- **Fee budgeting** (`budgetPlan`): the base plan runs whenever the key covers it; reveals are budgeted down to zero keeping the floor in reserve. A reveal drop blocks the FIFO, which the alarm's `reveal_queue_stalled` catches.
- **BENIGN / DISTRIBUTE_RACE:** `PoolShort` is always a failure; `NothingToDistribute`/`BoostsExpireFirst`/`JoinWaitingFirst` are benign only when `dist_epoch` or `last_distribute_at` moved. Correct.
- **The crank sends only MINT instructions** and builds no token or SOL transfer of its own (verified by source scan, selftest-asserted).

No new defect found in the crank.

---

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

Every detector was traced both directions against the selftest arms. Specific checks:

- **Log attribution** (`parseCbobLogs`) correctly tracks the invoke stack and attributes CBOB lines only to the owning program. Unbalanced stacks return `problem`, never a guess.
- **Log gaps** (`detectLogGaps`): unreviewed gaps are never evicted; the watermark is always kept; >2,000 unreviewed escalates to CRITICAL. Verified against the selftest's 600-gap and 2,001-gap arms.
- **`detectIndexShortfall`** correctly accepts `total ≤ seen ≤ after` (the minted_total re-read race) and refuses the wrong shape (counts instead of arrays, via `TypeError`).
- **`detectSweepState`** symmetric window `|t − start| ≤ cooldown/2` is skew-proof; the smallest-ever cooldown is used. Confirmed by the selftest's R32/R33 arms.
- **`cycleIsOpen`** correctly treats `sendRejected` as closed and `returnedSats == '0'` (string) as open.
- **`closesCycle`** binary search is proven identical to the old linear form on 400 random cases.

### Finding 2 — LOW (detector correctness)

**Construct:** `bank/detectors.mjs`, `detectSweepState`, the `explained` predicate.

**Defect:** The predicate accepts any cycle with `c.sweepSig` as explaining a sweep, without checking `!c.sendRejected`. A `sendRejected` row means no SOL moved; it cannot explain `last_sweep_at` advancing. `revenue.mjs` writes `refusedSig` (not `sweepSig`) for refused rows, so this does not arise in normal operation — but a corrupted or hand-edited ledger row carrying both `sendRejected: true` and `sweepSig` would make `detectSweepState` quiet about a real sweep.

**What an attacker gains:** A box-resident actor (who can edit the ledger) could suppress the flood-immune `sweep_unledgered_state` CRITICAL for an off-book sweep. The walk-derived `unledgered_sweep` and `rejected_row_has_sweep` would eventually catch the contradiction, but only after the scan catches up — defeating the purpose of the state-derived backstop.

**Evidence if true:** `detectSweepState`'s `explained` check reads `if (!(c.sweepSig || (c.pendingSweepSig && landed.has(…)))) return false` with no `sendRejected` test. A selftest arm feeding `{sendRejected: true, sweepSig: 'X', startedAt: T}` with `lastSweepAt = T` would return quiet.

**Fix:** Add `if (c.sendRejected) return false` at the top of the `explained` predicate. Pin both directions.

---

## R3 — The layouts (`bank/layout.mjs`)

Every struct was compared to the Rust (via the selftest's `parseRustStruct` arms). Every cross-program pinned offset (25 constants across GOV, BURN, MINT) equals the layout-computed value. Every PDA seed (11 of 11) equals the Rust's `pub const *_SEED`. `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` evaluated from the Rust equal the layout's fixed lengths less padding. The `u128` read/write is correct (low-64 at offset 0, high-64 at offset 8). The `Vec<Pubkey>` reader bounds-checks length and total. The D6 seed assertion now exists and is tested both ways.

No defect found.

---

## R4 — The money arithmetic (`bank/accrual.mjs` vs MINT)

I compared each formula line-by-line:

| accrual.mjs | MINT lib.rs | Match? |
|---|---|---|
| `credit`: `delta = avail × ACC_SCALE / w`; `acc += delta`; `owed += delta × w` | `credit`: identical | ✓ |
| `pendingScaled`: `(weight+boost) × acc + carry − debt` | `owed_of`: identical | ✓ |
| `reweigh`: `carry = owed`; `debt = new_weight × acc` | `reweigh`: identical | ✓ |
| `ceilSats`: `(scaled + ACC_SCALE − 1) / ACC_SCALE` | `ceil_sats`: identical | ✓ |
| `available`: `max(0, balance − ceil(owed))` | `avail = balance − owed` with `PoolShort` refusal | ✓ (JS clamps, Rust refuses) |

The selftest proves: Level V = exactly 3× Level I; shares sum to exactly what was distributed; dust carries; frozen payouts stay owed; retired shares return to the pool; boost carry preserves earnings across weight changes.

The crank expires every DUE boost before distributing and every boost its distribution makes due right after (verified in R1). The alarm pages `boosts_stalled` and treats `cbob_mint` and the boost bounds as fixed-forever CRITICAL drift (verified in the WATCH list and selftest).

No divergence found.

---

## R5 — The swap and the revenue cycle

### (a) Oracle math
`sats = lamports × sol.price × 10^(es−eb) / (btc.price × 10)` is correct for every sign of `e = es − eb`. Integer floor division gives `expectedSats`; `minSats = expected × 9850 / 10000` is exactly `SWAP_TOLERANCE_BPS = 150` below. `satsPerLamport = SOL/BTC / 10` is correct. BigInt throughout the floor; `Number` only for the deviation check (satsPerLamport ~0.001–0.01, well within double precision). No overflow path found.

### (b) Pyth verification
`readPyth` pins owner (Pyth receiver), requires `VerificationLevel::Full` (tag 1), checks the feed ID. The offsets (disc 8 + authority 32 + tag 1 + feed 32 + price 8 + conf 8 + expo 4 + publish_time 8 = 101) match `PriceUpdateV2`'s Borsh layout. Ownership + derived address is necessary but not sufficient alone — the account is writable only by the Pyth receiver program, which validates a Wormhole-verified VAA. A replayed old update is refused by the 180 s staleness check against the **Clock sysvar** (trustworthy: chain-maintained, monotonic). A future-dated update is refused at 30 s. The residual trust in Wormhole/Pyth is stated (limit 10).

### (c) Deviation filter
`orcaSpot = (√price / 2^64)²` is Q64.64 → raw price in cbBTC-sats-per-lamport (correct for wSOL/cbBTC at 9/8 decimals). `meteoraSpot = 1/(1 + binStep/10⁴)^activeId` is the inverse of Meteora's X-in-Y price (cbBTC-in-wSOL), same units. Direction is correct: Orca a_to_b walks tick arrays *downward* (current, then two below); Meteora Y→X walks bin arrays *upward* (active, then two above). Floating point cannot pass a pool it should refuse: NaN/Infinity/0 all produce deviations > 100 bps.

### (d) Minimum out
Orca's `other_amount_threshold` and Meteora's `min_amount_out` both carry `minSats` at data offset 16, the *same* oracle floor (150 bps under `expectedSats`), in each program's expected units (raw base units). Verified in the fork test and the selftest.

### (e) The judge
`judgeSwapInstructions` requires the exact seven-instruction sequence with `lamportsIn` and `minSats` told. It checks: compute-limit 400 000 and no priority fee; both ATA creations for the operator's own wallet/mint at the right keys; the wrap amount exactly `lamportsIn` to the operator's own wSOL ATA; SyncNative; the swap's input (key 3/4), output (key 5), amount (offset 8), floor (offset 16), pool (key 2/0), signer (key 1/10), and for Orca direction and price limit; the close of wSOL to the operator. It refuses a second signer, a foreign program, a Token instruction beyond SyncNative/CloseAccount, and any extra instruction. Eight tampers are pinned refused on both venues. Remaining gap (known, limit 10): Meteora key 9 (`host_fee_in`) is not pinned — but it diverts pool fees, not user output, and the on-chain floor bounds the user's loss. A tampered *builder* is the box-owner residue (limit 10(c)).

### (f) Account derivation
Orca: tick-array starts computed correctly for positive and negative ticks (verified: `orcaTickArrayStarts(-88733, 16) = [-90112, -91520, -92928]`); a tick on an array boundary starts that array; an uninitialised array causes Orca to refuse (loud). Meteora: `binArrayIndex` floors correctly for negative IDs; the bitmap is passed as the program ID when absent (Anchor None). Seeds are derived with `findProgramAddressSync`, never typed.

### (g) wSOL handling
Wrap exactly `lamportsIn`, sync, swap, close back. Pre-existing wSOL balance stays and is returned by the close (the swap is exact-input). A frozen wSOL ATA fails at `SyncNative` (transaction reverts). A delegate cannot interfere (close requires owner signature). ATA is derived from the owner, so it cannot belong to someone else.

### (h) Failure and retry
`classifySendFailure` asks the chain: preflight refusal → `refused`; landed-and-errored → `refused`; expired-and-absent → `refused`; landed-and-succeeded → `landed`; anything else → `unknown`. Meteora is tried only after Orca is `refused` (never after `unknown`). A confirmation timeout → `unknown` → `pendingSwapSig` recorded, cycle stays open, next run refused at the open-cycle guard. No path reads a failed cycle as closed.

### (i) Adversary extraction
A sandwich attacker can push the pool to the edge of the 100 bps gate and extract up to 150 bps (the floor tolerance) per swap. At the ruled 10 SOL cap: 0.15 SOL per cycle, ~0.6 SOL/day, ~18 SOL/month. The SPEC correctly states this is not a hard bound. The oracle's ~1.5 bps confidence (measured) makes oracle manipulation expensive; the pool-agreement check limits pool manipulation. All stated.

### Finding 3 — LOW (audit display)

**Construct:** `bank/revenue.mjs`, `audit()`, the `swept` total.

**Defect:** `swept = l.cycles.reduce((a, c) => a + BigInt(c.sweptLamports || c.intendedLamports || 0), 0n)`. A `sendRejected` row has `intendedLamports` but no `sweptLamports`; the `||` fallback counts the refused amount as swept. The label "SOL swept out to the operator" is then wrong for refused rows.

**What an operator gains:** A misleading `--audit` total during hand recovery, which is exactly when accuracy matters most.

**Evidence if true:** `audit()` prints a `swept` total that includes `intendedLamports` of `sendRejected` rows. A selftest arm with `[{sendRejected: true, intendedLamports: '5000'}]` would show `swept = 5000` when zero moved.

**Fix:** `c.sendRejected ? 0n : BigInt(c.sweptLamports || c.intendedLamports || 0)`. Pin both ways.

---

## R6 — The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

Every floor uses **equality** (`-eq` or `!==`), confirmed in `floor()`, the suite check, the selftest's own `FLOOR = 920`, and `swap-fork.sh`'s `[ "$T" -eq "$SWAP_FLOOR" ]`. The stated-count gate checks **every** occurrence of each floor in SPEC. The wiring gate is derived from `detect*` exports and reads function bodies (comments stripped), proven able to fail by mutation. The control-table gate parses ON-CHAIN/AUTOMATIC/PROCEDURE rows against the real error enums and the real cron installer. The program-id gate checks all 14 copies plus the keypairs. The coverage gate requires current *content* in a completed, quorate round's bundle.

### Finding 4 — LOW (gate bypass by comment)

**Construct:** `bank/detectors.mjs`, `judgeCronTemplate`, the `varHasN` regex.

**Defect:** `varHasN = /FLOCK="?\$FLOCK\s+-n"?/.test(src) || …` matches *anywhere* in the file text, including inside a shell comment. A comment line `# FLOCK="$FLOCK -n"` alongside a real `FLOCK=/usr/bin/flock` (no `-n`) sets `varHasN = true`, so every `$FLOCK` crontab line passes the gate while actually using a *blocking* flock. A blocking flock queues a second run, which pays the same day twice when the first finishes — the exact defect the gate exists to prevent.

**What an accident gains:** An editor who removes `-n` from the FLOCK definition but leaves (or adds) a comment mentioning it would pass the selftest while every money cron becomes non-exclusive.

**Evidence if true:** `judgeCronTemplate('# FLOCK="$FLOCK -n"\nFLOCK=/usr/bin/flock\n7 9 * * * cd $R && $FLOCK /x node bank/distribute.mjs')` returns `[]` (pass). It should return 1.

**Fix:** Strip comment lines before computing `varHasN`, or anchor the regex to non-comment lines. Pin both directions.

---

## The accepted limits — four questions

**1. Is any limit worse than stated?** No. Each limit I checked (10: the swap trust chain; 25/26: draw manipulation; 32: rate-limit queueing; 41: transfer escape; 46: charter-window PoB key; 55: unsplit-revenue edge; 56: $CBOB custody) is stated at or below its true severity. Limit 10's description of what the swap trusts (two pool programs, Pyth, one RPC, the code, four third-party upgrade keys) is now complete after round 25 D1.

**2. Is anything listed as a limit not actually a limit?** Limit 58 (rescue) genuinely closes the "orphaned forever" residue of round 29 D2 for CBOB vaults. But Finding 1 shows the descriptive text in "What got worse" still describes the *rejected* design, which is the inverse problem: a limit's *description* is wrong even though the limit is correctly handled. Everything else on the list is real.

**3. Is any DISCHARGED item not actually discharged?** Item 19 (unlevelled-vault DoS) is genuinely closed by construction (`activate` requires `NotRevealed` → refuses). Item 51 (boost) is built and tested through 260 epochs across four ring wraps. Item 54 (compute) is measured. Items 12/17, 14, 30, 31, 33 all check out.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 each carry explicit "not started" or "OPEN" status in the road table and in `launch/mainnet-init.json`. Item 22's named rehearsal items (live revenue cycle through both pools, forced post-sweep failure) are clearly scoped. Item 50's pages are "staged, not published" and the guide is marked DRAFT.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the mainnet dress rehearsal (item 22) with real money and a human watching.** No AI can simulate 2,100 vaults on a real cluster, real RPC rate limits, real network congestion, or a real transient failure at vault 1,900. The named items — live crank passes, live alarm passes, a full revenue cycle through *both* pools (Orca forced to refuse once), and a forced post-sweep failure walked through hand recovery — must each land on chain with recorded signatures. This is the single highest-value thing not yet done.

2. **Test alert delivery end to end, every kind.** The alarm's 60+ finding kinds route through `/opt/scripts/notify-gary-sms.sh`. No gate proves a page reaches Gary's phone. Trigger each severity class (one-shot urgent, level, recovery) and confirm the SMS arrives. A silent alarm is worse than none.

3. **Assess the box's key custody independently.** The swap operator key, the $CBOB release wallet key, the deploy authority key, and the crank fee-payer key all live on one host under one uid. An AI reads code; it cannot assess file permissions, backup encryption, SSH access, or whether the nightly R2 backup is itself protected. Get a human with ops-security experience to look at the host.

4. **Have a non-technical reader read HOLDER-GUIDE.md against the live page.** The guide makes specific promises ("the Bank's pages show it", "the redeem page offers this"). An AI can check the sentences against the code; only a human can judge whether the language is honest and clear to the audience that will send Bitcoin into these vaults.

5. **Write a one-page runbook per alert kind.** For each CRITICAL and HIGH the alarm can emit, write what the operator should *do* (not just what it means). This is operational judgment, not code review. During a live incident, nobody will read SPEC.md.

6. **Exercise the swap under volatile market conditions on the fork.** The 150 bps floor and 100 bps deviation gate are calibrated against measured calm-market confidence (1.5 bps). Push the cloned pools around on the fork during simulated volatility and confirm the gates bind. Real markets gap.

7. **Do a final key ceremony for the upgrade-authority removal (step 11).** Verify each program's bytes on chain *one more time* immediately before `set-upgrade-authority --final`, with two people present. This is the irreversible act. An AI can check the runbook; it cannot witness the ceremony.

8. **Get a legal/compliance read on the holder-facing financial claims.** The guide promises specific payout mechanics and royalty flows. That is outside AI audit scope entirely.