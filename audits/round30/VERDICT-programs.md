# Round 30, PROGRAMS pass: NOT CLEAN; QUORUM NOT MET

**Final verdict against frozen HEAD `c5aab170a0f15fb644a537e9a7d31b4fe6d6a7b1` (round-29 repair code `88acce2`). Five substantive, completed, current-tree auditors were counted out of eight requests. Six are required, so quorum is NOT met and this pass cannot be clean on that ground alone. Independently confirmed findings also survive, so it would not be clean even with quorum.**

The clean-round counter remains **0/2**.

**28 deduplicated claim groups: five confirmed topics (0 CRITICAL, 0 HIGH, one MEDIUM, one LOW, three INFO; one of the INFO topics was found by this triage while verifying an auditor claim) and 23 other dispositions (16 accepted, covered or optional, 7 refuted).** The MEDIUM overlaps the off-chain pass (off-chain Opus-5 F1 states the same mechanism and files it HIGH). Count it once in the combined round, at the severity the off-chain verdict sets. The LOW overlaps this round's off-chain reports only in part.

## Auditor dispositions

`MANIFEST-programs.json` records the frozen HEAD, an empty dirty-path list, eight requests and a six-auditor requirement. The runner counted six. This triage counts five: it does not accept Grok as a substantive current-tree audit. Every counted report was read in full.

| Auditor | Disposition |
|---|---|
| anthropic/claude-opus-5.5 | Counted. Completed (`stop`), 23,897 characters. Current-tree review of the pairing, emptiness, helper, pool, boost, draw, governance, charter and configuration, with all offsets recomputed, plus evidence-chain and accepted-limit sections. It raised the confirmed MEDIUM (OC-1), LOW (P-1) and two INFO topics. |
| fireworks/ember-1 | Counted. Completed, 32,611 characters. Current-tree review of every target, with a full offset recomputation. Its one finding (GOV `ACTION_MAX_BYTES` comment) is disproved (W1). |
| qwen/qwen3.8-max-prime | Counted. Completed, 26,307 characters. Current-tree review with offsets, pool and ring algebra. Its LOW (wSOL source) is disproved by measurement (W2). |
| sakana/fugu-max | Counted. Completed, 28,945 characters. Current-tree review with a full MintConfig/VaultRecord/BurnConfig/SEAL layout and ring-collision argument. It made no finding. Its R0 restates VALIDATION.md for consumer files that are not in this bundle. That is a weakness, not a disqualifier, because the rest of the report analyzes the bundled tree. |
| z-ai/glm-5.3-prime | Counted. Completed, 29,292 characters. Current-tree review of all targets with offsets recomputed. Its F1 is partly disproved and partly merged into L1. F2 is disproved by measurement. F3 is covered by SPEC. |
| x-ai/grok-4.20 | **Excluded: not a substantive current-tree audit.** It reports `stop` but only 1,397 output tokens and 5,755 characters, in about 30 seconds. Its heading is "**Round 29 verdict: NOT CLEAN**". The body restates the round-29 verdict's four topics and its tallies ("32 deduplicated claim groups", "7/8 counted"). It tells the reader that the M1 and L1 repairs "must be done", but both shipped in `88acce2` and both are visible in its own bundle: `txread.mjs` flag mode, and `audit-coverage.sh` enumerating `git ls-files`. It also says "the round-28 repairs ... are present and verified", which describes the wrong round. None of targets R1 to R8 is analyzed against this tree, and no offset, invariant or arm is checked. A copy of the prior verdict is not an audit of the current code. |
| minimax/minimax-m3 | **Excluded:** `finish_reason: error`, 370,972 characters of reasoning only (`[reasoning only]`, line 1). It reaches no verdict. Its leads were checked anyway (W7). |
| deepseek/deepseek-v4-pro-0813 | **Excluded:** request failed (39 characters). |

## Method and evidence

The five counted reports were read in full, and the minimax partial was scanned for leads. Claims were checked against source at `c5aab17`, the round-29 verdict and validation, retained logs, the round-30 `TARGETS` in `scripts/audit30.ts`, and four bounded new measurements (below). The audit prompt was not re-rendered: `tsx` is not in the shared `node_modules`, and `npx` would have installed it. Bundle membership was read directly from the `TARGETS` arrays, which drive both the bundle and the coverage gate.

No tracked file was changed except this verdict. No live entrypoint was imported, and no crank, revenue, notification, mainnet send, deploy or lock was run. `bank/txread.mjs` was imported only into a read-only mainnet reader probe. Read-only mainnet RPC was used for rent and transaction reads.

One isolated validator window was used, under `.cache/VALIDATOR.lock`. The lock was created atomically with `noclobber` after confirming that no lock existed and that ports 8999 and 9900 were free. Afterwards the validator had exited, both ports were free, and the lock and scratch ledger were removed.

Round-29 repairs were verified present in this tree:
- **M1:** `txread.mjs` refuses `Log truncated` by default and returns `logsTruncated` only in validated `flag` mode. The consumer side is in `bank/alarm.mjs:604-622`: a `log_coverage_gap` HIGH page, `logGaps` kept in state, event lines not read, instruction detectors still run, and the cursor advances.
- **L1:** `audit-coverage.sh` enumerates `git ls-files` with three named exclusions.
- **D1 and D2:** `DESIGN-v6.md §3` describes request-then-join, and SPEC's orphan-dilution note sits beside impossibility 3 and items 9 and 44.

The consumer files are not in the programs bundle by design. They are in round 30's off-chain `TARGETS` (W4).

The gate counts quoted in the prompt are 855 on-chain, 891 detector, 39 allocation, 22 poster, 14 PoB, 47 launch, 6 host, 33 mainnet, 4 expiry and 16 swap-fork, from `.cache/r29b-full-pass.log`, plus 71 simulation from `.cache/r28-sim.log`. They were not rerun here.

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **M1**: Opus OC-1 (shared with off-chain Opus-5 F1) | **MEDIUM** | **A stranger can permanently blind the alarm's signature-walk detectors for one window of time, for about 0.1 SOL, and the page that reports it says the opposite.** `bank/sigwalk.mjs` pages at most 20 × 1,000 signatures, newest first, back toward the cursor. In `bank/alarm.mjs:559-563` a walk that does not reach the cursor pages `scan_gap` HIGH, and line 636 advances the cursor only `if (!gap && ...)`. The signatures newer than a fixed cursor only ever grow in number. So once more than 20,000 accumulate (20,001 ordinary transactions naming MINT as an unused account, about 0.1 SOL in fees), **every later pass also gaps**. The cursor never moves again. The transactions between the old cursor and the start of the flood are never given to the instruction-derived detectors (approvals, PDA token accounts, burns, unledgered sweeps, program events), on any pass, until a human resets the cursor. Each pass also spends 20,000 `getTransaction` reads per flooded program. The page text, "the cursor was left where it was so they are not skipped", is false in exactly this case. SPEC's reader coverage boundary does not mention it. Account-state detectors are unaffected, and the condition is paged (HIGH, level), so it is not silent. This is the volume form of round 29's M1. Verified from source. A 20,001-transaction flood was not run. **Repair:** advance the cursor per processed window (oldest-first paging, or a persisted resume point at the deepest page read), so a backlog drains over several passes instead of growing forever. Correct the `scan_gap` text. State the bound and the cost in SPEC's reader coverage boundary. Add a both-ways selftest arm with a stubbed walk that returns `gap: true` across two passes and requires progress. No program change. |
| **L1**: Opus P-1, GLM F1 (residual), Qwen R0-2 (in part) | **LOW** | **The coverage gate counts a file as covered if its PATH was ever bundled, so a file rewritten after its last bundling passes with its current content never read. One such file carries the build's key proof.** `tests/initauth.test.ts` is the probe `scripts/build-mainnet.sh:85,95` runs to prove that the four mainnet artifacts reject the test key and the four localnet ones accept it. That is the "PROVEN" line every counted auditor relied on. It was last bundled by `scripts/audit17.ts` (prompt commit `2c8cd9b`, 2026-08-22, the v5 code). It has since changed in six v6 commits (`b411095` to `77e7870`, 2026-10-03/04; +47/−13 lines: new stage-3c argument lists and new `REACHED_PAST` patterns). It is in neither round-30 `TARGETS` list, and `audit-coverage.sh` exits 0 ("56 files"). The other six tracked files outside round 30's bundles are unchanged since they were last bundled (`.cache/triage30p/evidence.txt`). SPEC 2176/2182 describes the gate accurately ("counts bundling"), so this is a certification gap, not a false sentence. The same shape as round 29 L1, one level up. **Repair:** bundle `tests/initauth.test.ts` in the next round. Make the gate content-aware: record each bundled file's git blob id per runner, and require every tracked file's current blob to appear in a round that completed with quorum. Prepared rounds must not count toward that. No program change. |
| **D1**: Opus doc error 1 | **INFO** | **The record rent the minter pays is stated at the test-validator rate.** SPEC 49 (line 1617), SPEC line 672 and `DESIGN-v6.md:191-192` ("~0.0024 SOL, 2,429,040 lamports") give `(221+128) × 6,960`. Measured on mainnet now, `getMinimumBalanceForRentExemption(221)` = **1,772,920** (0 bytes = 650,240, 165 bytes = 1,488,440; `.cache/triage30p/mainnet-rent.log`). Anchor's `init` charges the Rent sysvar's figure, so the minter pays about 1,772,920 lamports (~0.0018 SOL), not 2,429,040. SPEC's own fact 9 states the lower mainnet rate. **Repair:** state 1,772,920 lamports on mainnet (measured 2026-10-06), with 2,429,040 as the test-validator figure. |
| **D2**: Opus doc error 2 | **INFO** | **DESIGN §8's drain time is wrong.** `DESIGN-v6.md:377`: "At 2,100 vaults that is 45/hour (ceil of 44.1), ~47h to drain." The 45/hour is right. But BURN recomputes the cap `ceil(2.1% × live)`, floor 1, from live supply at every redemption (`programs/cbob-vault-burn/src/lib.rs:139,284`). As vaults leave, the cap falls. A rolling-window model of the ring drains 2,100 vaults in **209 hours (8.7 days)** (`.cache/triage30p/drain.log`), and a simple hourly-batch model gives 206 h. The real figure is safer than stated, but the sentence is false about the real behavior. **Repair:** "45/hour at 2,100 live, falling as live supply falls, so emptying all 2,100 takes about 209 hours (8.7 days)." |
| **T1**: triage, found while verifying Opus P-2 | **INFO** | **`build-mainnet.sh`'s closing "PROVEN" banner attaches the wrong evidence to the mainnet rejection.** Line 192 says the four mainnet artifacts reject the test key "each for the NotTheInitAuthority reason specifically (or, for SEAL, by reaching a check below it)". In `tests/initauth.test.ts`, a REJECTS verdict requires `NotTheInitAuthority` for every program, SEAL included. "Reaching a later check" (`REACHED_PAST`) is evidence of ACCEPTANCE, and it is admissible for the localnet controls of all four programs, not only SEAL. The gate logic is correct; only the printed proof statement is wrong. **Repair:** move the parenthetical to the localnet clause: "...all four LOCALNET artifacts accept it (directly, or by reaching a check below the authority check)". |

## Accepted limits, covered, bounded or optional

| ID / reports | Disposition |
|---|---|
| A1: Opus R1-H1 | Rescuing a nested Core asset by `Execute(HOST){Core TransferV1(INNER)}` during the host's own thaw is unmeasured. No SPEC sentence is false under either outcome. "Unredeemable while nested" (line 168) holds. "Orphaned forever" applies after an undeclared host burn. Items 9 and 44 cover what dies undeclared. Optional: measure it, and if it lands, offer it on the item-50 page. |
| A2: Opus R1s-I1, GLM F3 | The widest legacy redemption shape (about 1,209 of 1,232 bytes) cannot carry an extra rescue pair (66 bytes or more). The arithmetic is right. SPEC item 50 already says the 1,061-byte S8.0 figure "is the measured shape, not an upper bound for arbitrary extra token pairs" and "mind the packet above, since each pair costs bytes", and S8.1a shows the compute-budget pair is not needed. Optional: state the trade-off explicitly and pin an overflow arm. |
| A3: Opus R1s-I2 | Bytes injected by a wallet into the real redeem transaction belong to item 50/22 real-wallet testing (open, blocking). |
| A4: Opus R1s-I3 | Core `BurnV1` refunds the asset's rent to the `payer` account that BURN forwards (lib.rs 388). No document says otherwise. Optional page-contract note: pass the owner as BURN's `payer`. |
| A5: Opus R1s(g) | Sim S6.2 pins only "Core failed". The same property is pinned exactly in the suite (3.7: `custom program error: 0x9` plus the seal decoding FROZEN). Tightening the pin is optional. |
| A6: Opus R2 minor gaps | `MAX_EXPIRE_BATCH = 30` is the program's bound, and SPEC says "up to 30 records a call". The expiry gate measures 20, and SPEC says so (2240). A 30-record arm and a per-record `carry` check are optional. |
| A7: Opus R5-I1 | Item 46's sentence carries its own bound ("passes up to 8 extra accounts ... so a benign or approving hook cannot brick"), and the next sentences give the measured legacy packet limit (4 in the widest shape, 8 only without payer and compute budget). Optional: an explicit "a hook set needing more accounts bricks like a rejecting one", and an arm at `pob_extra = 8`. |
| A8: Opus R6-I1 | A byte-for-byte read-back between road steps 10 and 11 is inside item 38 (OPEN AND BLOCKING), and the alarm already pages any launch value that is not the ruled one. An explicit pre-lock step is optional. |
| A9: Opus R6 ring note | Ring wrap at k ∈ {45, 64}: same as round 29 A8. The index reads correctly, and RL.7 replays every remembered window. |
| A10: Opus P-2 | `build-mainnet.sh` compares only the helper with `target/deploy`. Measured: at `88acce2` (clean), all five localnet rebuilds in `.cache/ln` equal `target/deploy`, and both equal the hashes in the suite's own log (`.cache/r29b-full-pass.log`). `run-tests.sh:108-110` rebuilds `target/deploy` from the tree under `set -euo pipefail`, so a stale copy cannot carry a passing run. Comparing all five is optional hardening. |
| A11: Opus P-3 | Running the post-init suite against `dist/` is the stated NOT PROVEN boundary. The INIT_AUTHORITY swap is probed behaviorally in both directions. Optional. |
| A12: Opus P-4 | Measured: exactly two `feature = "localnet"` sites in each keyed program, and none in the helper. A count gate is optional. |
| A13: Opus Q2-a/b/c, Sakana item 7 | The tombstone relaxation, decoupling the reveal from Core, `retire_orphaned`, and refusing off-curve owners at mint are owner decisions before the lock. Items 40 and 43 and the D2 note already say a program change is possible only before the lock. |
| A14: Opus OC-2 | Truncation is detected by the exact `Log truncated` element (fails open if the runtime changes the marker). This is an off-chain hardening idea. Referred to the off-chain verdict. |
| A15: all reports, launch sections; Opus Q4 | Live rehearsal (item 22, including the both-venue cycle and forced recovery), the rehearsal re-proof at the release commit (53), launch values (38), holder surfaces (50), the ceremony, independent rebuilds, Core reproduction, a bounty, key custody and human reads are open ship-gate work, not new defects. |
| A16: Opus R4 | A captured guardian cancelling armed operators while the sweep is stopped is inside limit 47 (stuck, not lost). |

## Refuted or unsupported premises

| ID / reports | Independent disposition |
|---|---|
| W1: Ember INFO | **Disproved.** The GOV comment's "`SetRound` 1+28, `TightenSweep` 1+27, `ArmSwapOperator` 1+32, `SetBoostTerms` 1+11" is tag plus payload. The payloads are i64+i64+u64+u32 = 28, three `Option<u64>` = 27, `Pubkey` = 32, and u64+u8+u16 = 11 (`gov lib.rs:746-781`). The 29/28/33/12 totals Ember computes are exactly those sums. The comment is correct. |
| W2: Qwen R1s-1 (LOW) | **Disproved by measurement.** Shipped helper (`dist`, `9e21cc9c…`) on pinned mainnet Token (`8190d3f7…`), called directly with a keypair standing in for the asset-signer: a native wSOL source of 0.5 SOL plus a classic control pair. The transaction landed. The wSOL source was closed, the destination's wSOL amount is exactly 500,000,000, the control moved 777 and closed, the signer was left at 0 lamports, and the destination wallet delta was exact (14,078,560 = both rents plus the signer's lamports). |
| W3: GLM F2 (LOW) | **Disproved by measurement.** Through the shipped `readParsedTransaction` (flag mode) on mainnet, 35 of 60 sampled transactions had no CPI (1 legacy, 3 v0, 31 v1). Every one returned `innerInstructions: []`, not `null`, and all 60 were accepted. |
| W4: GLM F1 (MEDIUM), Opus R0/P-1 instance, Qwen R0-1, Ember boundary note | **Disproved as stated.** The M1 consumers (`alarm`, `revenue`, `redemption-poster`, `selftest`), `bank/swap.mjs`, `scripts/check-launch-params.mjs` and `launch/cbob-token.mainnet.json` are all in round 30's OFF-CHAIN `TARGETS` (`scripts/audit30.ts:101-139`). The programs/off-chain split is deliberate, and the runner refuses a prompt that names a file it does not deliver. VALIDATION's "all eight are in round 30's bundle" is true of the round. The genuine residual (path-only coverage) survives as L1. |
| W5: Opus on D2 text | "Nothing on chain can undo it" describes the program as it will be locked, and SPEC says in the same note that a program change is possible only before the lock and is an owner decision. Not false. |
| W6: Qwen R0-2 (rest) | A future `.mjs` audit script is hypothetical. The `Cargo.lock` exclusion is named in the script and in SPEC 2176. No defect. |
| W7: minimax leads | The "boost earns N−1 when bought outside a distribution" lead is withdrawn by its own later reasoning ("My off-by-one concern was wrong"). BO.34a/b pin that 62 distributions leave the boost undue and the 63rd makes it due, and BO.21/BO.35 pin both in-transaction orders. "Ring slots accumulate" is answered by `advance_epoch` moving each slot into `boosts_due`, by `BoostsExpireFirst`, and by host test N1 reconciling every slot across 260 epochs. |

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| wSOL sweep (W2) | Isolated validator, pinned classic Token (`cmp`-equal to the pin after boot), `dist/cbob_vault_sweep.so` at its program id, Core feature flags as the suite sets them. Landed, exact accounting (above). | `.cache/triage30p/wsol.mjs`, `wsol.log` |
| No-CPI reader (W3) | 60 mainnet transactions, 35 without CPI across legacy, v0 and v1, all `[]`, all accepted | `.cache/triage30p/nocpi.mjs`, `nocpi.log`, `nocpi-60.log` |
| Mainnet rent (D1) | 0 / 165 / 221 bytes → 650,240 / 1,488,440 / 1,772,920 | `.cache/triage30p/mainnet-rent.log` |
| Drain time (D2) | Rolling-ring model 209.0 h (8.71 d) | `.cache/triage30p/drain.py`, `drain.log` |
| Tested bytes (A10), localnet sites (A12), coverage drift (L1) | `.cache/ln` = `target/deploy` = suite-log hashes for all five; 2/2/2/2/0 sites; `initauth` +47/−13 since its last bundling; 7 tracked files outside round 30's bundles, 6 unchanged since bundled | `.cache/triage30p/evidence.txt`, `have.txt`, `r30.txt` |

## Remaining requirements

- **Re-run the programs pass to quorum.** Five of eight is not a verdict-bearing pass. Replace the excluded seats, and reject any output that only restates the prior verdict.
- Repair M1 in the alarm (and the revenue walk, if the off-chain verdict confirms its sibling), with a both-ways selftest, and state the bound in SPEC.
- Repair L1: bundle `tests/initauth.test.ts`, and make the coverage gate content-aware.
- Correct D1, D2 and T1.
- Rerun the affected selftests and gates, and record fresh build and rehearsal proofs before another frozen round.

Because M1 and L1 touch `bank/` and `scripts/`, the freeze resets.

Holder surfaces, the live rehearsal, initialization and the lock ceremony remain separate open ship gates.

**Result: QUORUM NOT MET (5/8 counted; six required; Grok excluded as a restatement of the round-29 verdict) and NOT CLEAN (0 CRITICAL, 0 HIGH, 1 MEDIUM, 1 LOW, 3 INFO). Counter 0/2.**
