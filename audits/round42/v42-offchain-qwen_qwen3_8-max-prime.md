# Round 42 Independent Audit — Off-Chain Pipeline, Sweep Helper, and Holder-Page Tests

I audited the tree at the round-41 repair commit independently. I did not run the validator suite or the fork; every claim below is from reading the code as bundled, and where I state that a repair is present I name the construct that carries it. I attempted to disprove the round-41 verdict rather than adopt it.

---

## R0. Round 41's verdict and its repairs

The off-chain verdict recorded two LOW findings (C01, C02) and one documentation-exception INFO (C03). I verified each repair against the bundled source.

**C01 (poster drops second redemption in one transaction) — repair present and effective.**
`bank/redemption-poster.mjs` now keys the dedupe by `draftKey(w) = signature:vault` (exported function near the top of the file), and `draftPost` writes `web.vault` as the 1-based padded mint index. The main loop computes `const key = draftKey(p.web)` and checks `queued.has(key) || queued.has(\`${s.signature}:*\`)` before appending; the queue rebuild at the top of `main()` re-derives `queued` from the file using the same `draftKey`. Two redemptions in one transaction therefore produce distinct keys (`sig:0011`, `sig:0012`) and both draft. The truncated-log rejection path writes `web` without a `vault` field, so its key is `sig:*`, matching the `queued.has(\`${s.signature}:*\`)` guard. I found no way for a second redemption in a transaction to be silently skipped now.

**C02 (oracle age bound unpinned 100–399 s) — repair present and effective.**
`bank/selftest.mjs` contains the arm labelled `R41 C02` that asserts, in literals, that a price 181 s old is refused, a price 180 s old is accepted, and `SW.MAX_ORACLE_AGE_SECS === 180`. If the constant were moved to 300, the 181 s case would no longer be refused and the constant check would fail, so the arm turns red. This closes the gap the round-41 verdict identified (the older `M1` arm computed its boundary from `SW.MAX_ORACLE_AGE_SECS` itself and moved with it).

**C03 (SPEC crank-row budgeting sentence) — repair present.**
The SPEC control-table crank row now reads "is refused only below what the pass costs WITHOUT its reveals; it then runs that base plan and as many reveals as keep the key at or above 0.005 SOL," which matches `budgetPlan` in `bank/crank.mjs` (base plan judged with `floor: 0n`, reveals trimmed to keep `FEE_FLOOR_LAMPORTS`).

**Verdict on R0:** the three recorded repairs are in the tree and each would fail its gate if reverted. I did not find a fourth surviving defect from round 41.

---

## R1. The crank (`bank/crank.mjs`)

I traced `planCrank` and the send path. I did not find a plan the program would refuse, a plan that pays or joins a dead vault, or an out-of-order reveal.

- Reveal ordering iterates from `cfg.revealed_total` and stops at the first not-ready record; a capture planned this pass counts as ready (`capturedThisPass`). This matches MINT's `RevealOutOfOrder` FIFO.
- Burned vaults are excluded from joins, claims, and activation, and are retired first each pass. This matches red-team 3 finding 2 and the `retire_burned` ordering.
- The frozen-pool branch plans only join-only claims (which move no tokens) and the free tick, matching MINT's `claim` pending-branch and the stage-3c forfeit rule.
- `budgetPlan` keeps the floor in reserve and only trims reveals; the base plan runs whenever it is covered. I checked the arithmetic in `planCostLamports` and found the transaction count and reveal-rent accounting consistent.

No finding.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I checked that every state the brief requires to be paged has a detector, and looked for a dangerous state read as quiet and a routine state paged every pass.

- Fixed-forever values: the `WATCH` list covers the collection keys, reserve mints, governance PDA, pool, treasury, split, supply, payment mint, level caps, PoB collection/root, charter window, monthly period, redemption window, notice, the three tighten bounds, the $CBOB mint and boost bounds, and the GOV quorum/threshold/voting period. All CRITICAL.
- Pending guardian and swap operator: `mint.pending_guardian*` and `mint.pending_swap_operator*` are watched; `detectStandingRisks` raises `guardian_armed` and `swap_operator_armed`.
- PoB collection plugins and update authority: `pob_collection.plugins_hash` and `pob_collection.update_authority` are watched CRITICAL.
- Redemption window near cap: `detectRedemptionRate` with the idle-window guard (no page when `remaining >= cap`).
- Frozen/insolvent pool: `detectPoolHealth` raises `pool_frozen` and `pool_insolvent`.
- Distribution overdue: `detectDistributionOverdue` with the joins/boosts/launch-tick stall variants.
- Upgrade authority past lock date for all five programs: `detectUpgradeAuthorityAfterLock` iterates `['seal','mint','burn','gov','sweep']`, and `WATCH` includes `prog.sweep.upgrade_authority` and `prog.sweep.hash`.
- Production values (21/51/3-day, 7-day notice, tighten bounds, 30-day month, 1-hour window): `detectStandingRisks` with `production: true`.

I did not find a dangerous on-chain state that reads as quiet, nor a routine state that pages every pass. The `detectSweepState` half-cooldown window is safe against a thief's sweep because the on-chain cooldown forces any subsequent sweep to land at least a full cooldown after the previous one, which exceeds the half-cooldown match window.

No finding.

---

## R3. The layouts (`bank/layout.mjs`)

The brief asked me to confirm the round-24 D6 repair (SEEDS assertion). It is present: `bank/selftest.mjs` has the `D6` block that scrapes each `pub const <NAME>: &[u8] = b"..."` from the four program sources and compares against `L.SEEDS`, asserting 11 seeds and that a mistyped or extra seed is caught. I confirmed the layout's `SEEDS` has 11 entries and that the `rescue` seed (used only internally by MINT's `rescue_nested`) is correctly absent from the off-chain seed table, since no off-chain code derives the rescue PDA.

I spot-checked the `MintConfig`, `VaultRecord`, `BurnConfig`, `GovConfig`, and `SealConfig` field lists against the Rust excerpts and found them consistent, including the stage-3c and $CBOB-boost appended fields. The `readProgramData` ELF offset of 45 (regardless of authority presence) matches the measured mainnet behaviour described in the probe.

No finding.

---

## R4. The money arithmetic (`bank/accrual.mjs`)

I compared each mirrored function against the MINT source:

- `credit`: `delta = avail * ACC_SCALE / w`, `acc += delta`, `owed += delta * w`. Matches.
- `owed_of` / `pendingScaled`: `weight*acc + carry - debt`, with `weight = LEVEL_WEIGHTS[level-1] + boost`. Matches, including the carry-before-debt ordering that avoids negative debt on weight reduction.
- `reweigh`: `carry = owed_of(...)`, `debt = new_weight * acc`. Matches.
- `ceil_sats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. Correct ceiling division.
- `available`: `balance - ceil(owed)`, floored at 0. Matches the program's `PoolShort` behaviour.
- `debtAtActivation` and the join debt (`weight * acc`, `carry = 0`). Matches MINT's `join`.

The selftest asserts the 1:1.5:2:2.5:3 ratio, dust carry, boost carry, and the exact-sum invariant. I found no divergence.

No finding.

---

## R5. The swap and revenue cycle

I checked the oracle math, Pyth parsing, deviation filter, minimum-out, the judge, account derivation, wSOL handling, and failure/retry.

- `oracleFloor`: I re-derived the sats formula and confirmed `lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)`, with correct BigInt exponent handling. Sanity-checked against $120 SOL / $85000 BTC → ~141176 sats per SOL. Correct.
- `readPyth`: owner check, Full-verification check (`level === 1`), feed-id check, and the PriceUpdateV2 offsets (discriminator 8, write_authority 32, verification level 1, feed_id 32, then price/conf/expo/publish_time). The minimum length of 101 covers publish_time. Correct. A non-Full or unknown verification level fails closed.
- Deviation filter and minimum-out: the 100 bps pool-deviation gate and the 150 bps on-chain floor are separate and both present. The floor rides in the swap instruction data (`other_amount_threshold` / `min_amount_out`).
- `judgeSwapInstructions`: requires the exact seven-instruction sequence, the compute-unit limit with no priority fee, the two idempotent ATA creates for the operator's own wallet, the exact wrap amount, SyncNative, the venue swap with pinned pool/input/output/amount/floor (and Orca direction + price limit), and the single wSOL close back to the operator. It refuses a missing `lamportsIn`/`minSats`. I found no bypass.
- Account derivation: Orca tick arrays (current and two below for a_to_b), oracle PDA, vaults from the pool; Meteora bin arrays (active and two above for Y→X), bitmap extension or program-id placeholder, event authority, two token programs. These are exercised by the fork test.
- wSOL handling: wrap exactly `lamportsIn`, SyncNative, swap, close. A pre-existing wSOL balance is handled by the close returning all lamports; R33.G4 in the suite covers a stranger pre-filled wSOL account.
- Failure/retry: `classifySendFailure` distinguishes refused / landed / unknown by asking the chain; the venue loop only falls through to Meteora on a refusal, never on an unknown. The open-cycle guard uses the shared `cycleIsOpen` predicate and blocks a new cycle while one is open.

No finding.

---

## R6. The gates

I checked `bank/selftest.mjs`, `scripts/run-tests.sh`, and `sim/swap-fork.sh` for assertions that cannot fail, floors satisfiable by deleting work, and vacuous checks.

- The `floor` function in `run-tests.sh` requires the assertion count to EQUAL the floor (`-eq`), not merely meet it, so deleting work drops the count below the floor and fails. Deliberately lowering the floor in the same commit is a conscious change, not an accident the gate should catch.
- The selftest's control arms I inspected (ack arms, layout mutation arms, seed arms, judge arms) have both a positive and a negative case, and the negative cases assert a specific refusal rather than a generic truthy value. The `D6` seed arm asserts both that the real seeds pass and that a mistyped seed is caught.
- The swap-fork floor is 16 and the runner requires the printed count to equal 16.

I did not find an assertion that cannot fail or a floor satisfiable by deleting work.

No finding.

---

## The four questions on the accepted limits

**1. Is any limit worse than stated?** I did not find one. I specifically examined limit 10 (swap operator), limit 27 (claim between bare burn and retirement), limit 28 (frozen pool), and limit 32 (redemption cap). Each matches the code. The `short_swap_return` tolerance of 2% means a partial theft under 2% per sweep would not be flagged by that specific detector, but the limit is stated in terms of the operator keeping the SOL (full sweep with no return), which is detected; the on-chain floor bounds swap-price slippage. I do not count this as a misstatement.

**2. Is anything listed as a limit not actually a limit, or already closed?** I did not find one. The limits that reference stage-3c behaviour (forfeit on frozen pool, join gate, rolling window) match the implemented code.

**3. Is any DISCHARGED item not actually discharged?** I did not find one. The v5 items discharged by removal of the Bank/co-signer/deck/distributor are genuinely gone (the files are deleted and the selftest asserts no imports of them). Items 51 and 54 are backed by suite sections.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** I did not find one. Items 22, 38, 50, 52, 53 are still described as open, and `launch/mainnet-init.json` still carries OPEN entries for `charter_opens_at`, `lock_deadline`, and `vault_collection`, consistent with item 38.

---

## Anything else

**LOW — Poster availability is coupled to reveal-FIFO progress (refinement of round-41 C04, not a re-file).**
- Construct: `bank/redemption-poster.mjs`, `main()` loop; `draftPost` throws `level ${level} is not I..V` for a level-0 record, and the throw occurs before `st.cursor = s.signature`, so the cursor is not advanced.
- What an accident gains: if a vault is redeemed before its level is drawn, the poster crashes on that transaction and re-crashes on every subsequent run, unable to advance past it. No later redemption is drafted until the reveal FIFO draws that vault's level. Because the poster is the intended public alarm for mass redemptions, its drafting (and thus the alarm feed, once a sender exists) is disabled for as long as it is stuck.
- Why this survives the round-41 disposition: the verdict's "self-heals" argument rests on `reveal_level` eventually drawing the burned vault in FIFO order. That is true only while the reveal FIFO is progressing. The FIFO only advances when the crank or protocol traffic reveals each earlier unrevealed vault in order; if the crank is down and traffic is thin, the FIFO can stall, and the poster stays stuck for the same duration. The verdict treated the crash as merely "loud," but a loud crash that blocks the redemption alarm while a separate stall (the reveal queue) persists is a coupling, not a clean failure.
- Evidence that would exist if I am right: a `REDEEMED` event for a vault whose `VaultRecord.level` is 0, followed by repeated poster runs exiting 3 (`POSTER FAILED`) with `st.cursor` unchanged across runs, while `reveal_queue_stalled` or `crank_silent` is simultaneously asserted.
- Fix: in the poster, treat a level-0 redemption the way the truncated-log path is treated — queue a `rejected` hand-draft entry keyed `signature:*` (or `signature:vault`) and advance the cursor, rather than throwing. Alternatively, draw the level from the record's stored entropy off-chain for drafting purposes only. Either keeps the alarm feed moving without waiting on the reveal FIFO.
- Severity rationale: LOW. The poster has no sender today, so there is no live alarm to disable yet, and the condition requires a level-0 redemption coinciding with a stalled reveal queue. But it is a real availability coupling that the round-41 "self-heals" reasoning does not fully cover, and it becomes material the moment a sender is attached (item 50).

I flag this as an observation refining C04's disposition, not as a re-filed C04: the mechanism is the same, but the specific flaw in the "self-heals" argument (dependence on reveal-FIFO progress) was not addressed by the verdict.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the mainnet dress rehearsal (item 22) with a human at the terminal, and treat any unexplained refusal as blocking.** AI rounds can reason about the crank, alarm, and revenue cycle against synthetic and forked state, but they cannot substitute for watching these jobs run against a live cluster with real RPC latency, real rate limits, and real confirmation flakiness. The named pass/fail items in item 22 (including one full revenue cycle through each pool and one forced post-sweep failure walked through hand recovery) must be executed by a person who can intervene and record signatures.

2. **Have a human independently confirm the `initialize` values at the moment of signing, not just the checker's output.** `scripts/check-launch-params.mjs` validates the JSON, but the four `initialize` transactions are built from that JSON by a separate step (accepted limit 38 / round-24 A6). A human should read the actual transaction parameters being signed against `launch/mainnet-init.json` and the rulings, because an AI cannot bear responsibility for a one-time immutable write.

3. **Decide and record the still-OPEN launch values (`charter_opens_at`, `lock_deadline`, `vault_collection`) before the freeze, and have Gary personally confirm the charter opening date.** These are product decisions, not technical ones, and no amount of auditing can resolve them.

4. **Physically secure the hot keys the accepted limits depend on** (swap operator, guardian, the $CBOB release wallet, the Giraffish Moments collection key through the charter window, and the deploy authority). AI audit can state the exposure (limits 10, 46, 56) but cannot protect a key on a server. The charter-window exposure in limit 46 in particular is a human-custody problem: an AI cannot hold a key cold or in a multisig; only Gary can.

5. **Establish a human response path for the alarm before launch.** The alarm pages a person; if no person is reachable, the detection is decorative. A concrete on-call arrangement (who gets paged, who holds the guardian wallet, who can pull `emergency_stop_sweep` and `emergency_stop_sales`) must exist and be tested with a live drill. AI can build the alarm but cannot be the responder.

6. **Publish the holder surfaces (item 50) and run at least one real redemption end-to-end through the published redeem page before the lock.** The page's `judgeRedemptionCoverage`, the sweep-helper integration, and the prior-transaction ATA creation are obligations nothing enforces on-chain. A human must exercise the actual page, not the staged build, to confirm the promised behaviour, because the holder guide is a contract with users and an AI cannot stand behind it.

7. **Commit to a post-lock monitoring commitment.** Once the upgrade authority is removed, the only recourse against a discovered bug is detection and community response. The project should confirm that the alarm, the crank, and the revenue job will be run and watched indefinitely, and that there is a named human accountable for acting on CRITICAL pages. Immutability makes the monitoring load-bearing; AI cannot guarantee operational continuity.