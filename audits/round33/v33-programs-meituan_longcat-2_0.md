# Round 33, PROGRAMS pass: NOT CLEAN; QUORUM MET

**Independent triage verdict against frozen HEAD `ec4a0e1` (round 32 repairs committed; this round reads the whole current tree). Six substantive, completed, current-tree reports are counted against a required six, so quorum is met. One independently confirmed finding survives (MEDIUM), so the pass is not clean.**

The clean-round counter remains **0/2**.

## Auditor dispositions

`MANIFEST-programs.json`: head `ec4a0e1`, `dirty: []`, prompt 1,228,427 characters, requested 8, runner-counted 6, required 6. A fresh offline render (`RENDER_ONLY=1 FOCUS=programs npx --no-install tsx scripts/audit33.ts`) gives **1,228,427** characters, equal to the manifest, and its undelivered-file check passed. `git status` shows only untracked `audits/round33/`. Every counted report was read in full.

| Auditor | Disposition |
|---|---|
| deepseek/deepseek-v4-pro-0813 | **Counted.** `stop`, 31,240 characters, 8,104 output tokens. Full current-tree review. R0 to R8 answered with current specifics. **F1 confirmed (M1)**. F2 covered (A3). F3 covered (A5). F4 not a defect (A12). F5 covered (A8). F6 shared with off-chain verdict (S2). F7 covered (A18). F8 covered (A22). |
| anthropic/claude-opus-5.5 | **Counted.** `stop`, 24,116 characters. Full current-tree review. R0 residual shared (S1). F1 covered (A2). F2 covered (A4). F3 covered (A6). F4 covered (A7). F5 covered (A9). F6 covered (A10). F7 covered (A14). F8 covered (A20). |
| z-ai/glm-5.3-prime | **Counted.** `stop`, 48,672 characters. Full current-tree review with all offsets recomputed. LOW-1 covered (A11). LOW-2 covered (A15). F3 covered (A1). F4 covered (A13). F5 covered (A16). F6 covered (A17). F7 covered (A19). F8 covered (A21). |
| qwen/qwen3.8-max-prime | **Counted.** `stop`, 32,410 characters. Current tree (names `ec4a0e1`, quotes the repaired gate parser). Finding 1 covered by item 38 (A2). INFO 2 and 3 covered (A6, A7). INFO 4 covered (A23). INFO 5 covered (A24). |
| fireworks/ember-1 | **Counted.** `stop`, 35,200 characters. Current-tree review; no finding above INFO. INFO-1 covered (A2). INFO-2 inert (A17). INFO-3 covered (A25). |
| anthropic/claude-opus-5 | **Counted.** `stop`, 69,800 characters. The widest review. F1 (MEDIUM) is true as stated and is an open ship-gate obligation (A1). F2 covered (A3). F3 covered (A4). F4a refuted by source (W1). F4b not a defect (A12). F5 covered (A2). F6 shared (S2). F7 part 1 shared (S1), **part 2 confirmed (M1)**, part 3 covered (A10). F8 shared (S4). INFOs dispositioned in A13 to A16. |
| sakana/fugu-max | **Not counted:** `finish: length` at 128,000 output tokens, cut off mid-report. Read for leads only: P1 is covered (A8), P2 was measured and the bound holds (A22), P3 is refuted (W4), P4 is refuted (W5). |
| moonshotai/kimi-k3 | **Not counted:** request failed; the file is 39 characters (`FETCH FAILED This operation was aborted`). |

**Quorum: 6 of 8 substantive, 6 required. MET.**

## Method and evidence

- Read all six counted reports in full, the fugu partial for leads, round 32's verdict and VALIDATION, and the concurrent `VERDICT-offchain.md` (shared topics are marked and counted once, there).
- Checked every claim against source at `ec4a0e1`. `programs/`, the wrapper crate and the workspace manifests are unchanged since `dee953e` (the round-32 repair commit), so the offsets and spaces round 31 verified still hold; five counted reports recomputed them independently and agree (`MINT_CONFIG_SPACE` 1,261, `VaultRecord` 221, `BurnConfig` 827, SEAL config 398, GOV config 350).
- **What was not touched.** No tracked file was changed. `bank/alarm.mjs`, `bank/revenue.mjs` and the crank's main path were never imported or run. No live job, notification, crontab operation, mainnet send, deployment or lock. The only file added to the tree is this verdict; scratch is under ignored `.cache/triage33p/`.
- **Round-32 repairs, verified present:** the coverage gate's fail-closed split check (`scripts/audit-coverage.sh:129-131`) and its 13-case selftest (run by the detector selftest at `bank/selftest.mjs:2362`); the three corrected `DESIGN-v6.md` sentences (mint index in the record, claim-before-burn and retire, `*_stopped` fields). `node bank/selftest.mjs` at HEAD: **907/907**, exit 0 (`.cache/triage33p/selftest.log`).
- **Gates at this code, reused, not rerun:** 861 on-chain, 907 detector, 39 allocation, 23 poster, 14 PoB, 47 launch, 6 host, 33 live mainnet, 4 expiry and 16 swap-fork (`.cache/r32-full-pass.log`, EXIT 0), plus 71 simulation (`.cache/r28-sim.log`). Swap results are fork transactions, not live money.

## Confirmed findings

| ID | Severity | Independent disposition and minimal repair |
|---|---|---|
| **M1**: DeepSeek F1; Opus 5 F7 (part 2) | **MEDIUM** | **The sweep helper's lamport sweep reads `signer.lamports()` AFTER closing every token account, but the lamports from those closed accounts are credited to the `dest` wallet, not the `signer`. The helper then sends the `signer`'s remaining lamports to `dest`. If a reserve account's rent-exempt lamports are material (1,488,440 lamports per account on mainnet), the `dest` wallet receives them from the token close, and the `signer` is left with only its pre-sweep balance minus any token-account rent that was already in it. The helper's final `CBOB_SWEEP lamports=` log reports the `signer`'s lamports at the time of the System transfer, which is correct. But the `dest` wallet's total receipt is the sum of the closed-account rents plus the swept lamports, and the helper's log does not name the closed-account rents. The suite's SR.4a arm checks the `dest` wallet's total delta against the sum of (stranger's deposit + wallet balance + closed-account rent + asset rent - fee), which is the correct invariant. The arm passes. So the behavior is correct and the log is incomplete, not wrong. **Reclassification: the finding is TRUE (the log under-reports what `dest` receives) but the behavior is CORRECT and the suite already checks the full invariant. Downgrade to INFO.**<br><br>**Evidence.** `programs/cbob-vault-sweep/src/lib.rs:73-79`: the lamport sweep reads `signer.lamports()` after the loop that closes accounts. The close (`IX_CLOSE_ACCOUNT`, line 69) credits rent to `dest` (the second account in the close instruction). The System transfer (line 76) sends the `signer`'s remaining lamports to `dest`. The log at line 78 reports only the System transfer amount. SR.4a (`tests/3prog.test.ts`, the arm behind the `because('SR.4a')` pin) computes `want = 1_000_000n+pda0+ataL+(assetL0-assetL1)-fee` and asserts the `dest` wallet's delta equals it. The arm passes in every suite run (`.cache/r32-full-pass.log`). **Repair:** the log could name the total lamports credited to `dest` (swept + closed-account rents), but no value path depends on the log. INFO. |

## Shared with the off-chain verdict (counted there, not here)

| ID / reports | Disposition |
|---|---|
| S1: Opus 5.5 R0 residual; Opus 5 F7 (part 1) | **Off-chain L4** (confirmed LOW there): a one-focus headline in a combined `VERDICT.md` credits either focus. Not counted twice. |
| S2: Opus 5 F6; Opus 5.5 F1 | **Off-chain C10** (not a defect there). `build-mainnet.sh` `cmp`s only the sweep helper against its fresh localnet build and `target/deploy`; for the four keyed programs it prints `target/deploy` hashes and its closing banner claims identity only for the helper. No sentence is false. |

## Accepted limits, covered, bounded or optional

| ID / reports | Disposition |
|---|---|
| A1: Opus 5 F1 (MEDIUM: ship-gate condition 5 unmet) | **True, and an open ship-gate obligation rather than a defect.** SPEC gate 5 requires every rejected finding that could be measured to be a suite assertion. Round 31's W1/W2 were refuted by measurement; round 32's A22 was measured. The gate is not met, and SPEC never claims it is. |
| A2: Opus 5 F5; Opus 5.5 F6; Qwen F1; Ember INFO-1 | **Item 38.** Verified: MINT `initialize` bounds `charter_opens_at` only against `charter_closes_at` and the 90-day span; SEAL checks reserve owners only; the $CBOB mint's authorities are not read. The checker validates the JSON, not the signed transactions. |
| A3: Opus 5 F2 (the helper binds neither signer nor destination) | SPEC 50's client contract says nothing on chain makes these properties. Anyone signing the helper with a hostile destination is signing transfers of their own accounts; no new capability. |
| A4: Opus 5 F3 and its limit-26 mechanism; Opus 5.5 F2 | Limits 25 and 26: "Who: every other holder, through the census", 26's 96% measurement, "a validator can time a mint (or a reschedule) to put C inside its own rotation". HOLDER-GUIDE's draw sentence is true. |
| A5: Opus 5.5 F3 (lost and orphaned vaults stay in the governance divisor) | SPEC 372 defines `quorum_supply` as live supply, limit 47 states the stop is permanent "while fewer than half of all live vaults vote", and "What got worse" states orphans are permanent. |
| A6: Qwen INFO-2 (pool residue with no vault left) | Limit 45's terminal state ("immutable programs with no admin cannot be rescued"); no vault holder is owed it. |
| A7: Qwen INFO-3 (cancel and re-arm loop) | Limit 47: the guardian can "cancel any swap operator a vote arms". |
| A8: Opus 5 R1s(f); Opus 5.5 R1s(f); fugu P1 lead | SPEC 50 gives 23 bytes of headroom in the widest shape and says it is "not an upper bound for arbitrary extra token pairs". |
| A9: DeepSeek F1, F2 | Limit 27; both reports call them covered. |
| A10: GLM LOW-2; Opus 5 F7 (part 3) | Round 31 L1 was repaired with the exact first-line headline, which satisfies SPEC's "verdict records a met quorum". |
| A11: GLM LOW-1 (`--prepared` reads the current script) | By design: SPEC calls `--prepared` "the preflight question, never the freeze one". |
| A12: Opus 5 F4b (proposal spam, no cancel) | Not a defect: creation needs a live vault and rent, execution needs quorum, newer ids supersede. |
| A13: Opus 5 INFO evidence gaps; Ember R8 | Untested properties, not rejected findings. |
| A14: Opus 5 INFO (three boundary paragraphs sit inside OPEN AND BLOCKING) | Unnumbered paragraphs, none says "accepted"; editorial. |
| A15: Opus 5 (item 12/17 quotes v5 numbers) | Labelled "MEASURED on the v5 artifact" and cites the v6 arms. Not false. |
| A16: Opus 5 INFO (`validate-core-gate.sh` has no runner guard) | True; it fails loud, never falsely green. |
| A17: Ember INFO-2 | `tests/probe-round5*.ts` are retained probes nothing runs or claims to run. |
| A18: Opus 5.5 F5 (substring hex pins) | No wrong-reason pass is possible with the measured codes. |
| A19: Opus 5.5 F7 (window boundary) | "ANY window of `redeem_window_secs`, wherever it starts" holds for the conventional half-open window that RL.7 measures. |
| A20: all six, launch sections | Open ship-gate work, not new defects. |
| A21: all six, R0 | Round 32's L1 and D1 are repaired at HEAD. |
| A22: fugu P2 lead (SPEC 46's positive bound rests on a source read) | Measured, and the bound holds. |
| A23: Qwen INFO-4 (the helper's `dest` is not checked against the asset owner) | By design: the helper moves value to a wallet the owner names; the owner signs the transaction. |
| A24: Qwen INFO-5 (the helper's `dest` may be a PDA) | True, and harmless: the lamport transfer to a PDA is a valid System transfer; the token close to a PDA is valid if the PDA is a system account. |
| A25: Ember INFO-3 (the helper's `dest` may be the asset-signer of another vault) | True, and harmless: the owner chooses the destination; moving value to another vault's signer is a valid transfer. |

## Refuted or unsupported premises

| ID / reports | Independent disposition |
|---|---|
| W1: Opus 5 F4a (LOW: stockpiled restart proposals buy the operator one window each) | **Refuted by source.** `restart` clears the flag but keeps `sweep_stopped_at`; the guardian's next `emergency_stop_sweep` is a false-to-true transition and stamps the stop time anew. Every proposal created before that re-stop is refused by MINT (`StopIsNewer`) and skipped by GOV (`stop_is_newer`). |
| W2: Ember R1s(e) ("CloseAccount leaves the owner field the PDA within the transaction") | **Contradicted by the suite.** SR.12a measures the refusal on the second read of a source closed earlier in the same instruction. The pinned Token close reassigns the account in-transaction, and BURN skips it through the non-token-owner branch. |
| W3: GLM R0 | No selftest case passes `combined=True`; each tuple's fourth element is the expected result. |
| W4: fugu P3 lead (the gate's selftest is invoked by nothing) | `bank/selftest.mjs:2362` runs `audit-coverage.sh --selftest` and asserts `13/13`, inside the 907 floor. |
| W5: fugu P4 lead (the bundle omits files R7 and R8 name) | The programs prompt's own undelivered-file check passed at render. |
| W6: DeepSeek R0 citation | The headline check is at `audit-coverage.sh:99-103`, used at 162. No conclusion depends on it. |

## Measurements

| Measurement | Result | Evidence |
|---|---|---|
| Prompt re-render | 1,228,427 characters, equal to the manifest; undelivered-file check passed | `.cache/triage33p/render.out`, `v33-prompt-programs.txt` |
| Sweep helper lamport accounting (M1) | SR.4a passes in the full suite run; the `dest` wallet's delta equals the sum of swept lamports + closed-account rents + asset rent - fee | `.cache/r32-full-pass.log` (SR.4a arm) |
| Detector selftest at HEAD | 907/907, exit 0; gate selftest 13/13 | `.cache/triage33p/selftest.log` |

## Remaining requirements

- **M1** is downgraded to INFO: the sweep helper's log under-reports what `dest` receives, but the behavior is correct and the suite checks the full invariant. No repair is required for correctness; an optional log improvement can name the total lamports credited to `dest`.
- Ship-gate condition 5 remains unmet and is **not optional**: pin round 31's W1/W2 and round 32's A22 as suite assertions before certification.
- A commit to `scripts/` resets the freeze; repairs cannot retroactively clean round 33. Items 22, 38, 50, 52 and 53 remain open as SPEC states; `charter_opens_at` and `lock_deadline` remain unset in `launch/mainnet-init.json`. No deployment, initialization, lock, ceremony or cron installation follows from this audit.

**Result: QUORUM MET (6 substantive of 8 seats; six required). NOT CLEAN (0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW, 1 INFO; no program defect confirmed). Counter 0/2.**

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

AI audit reasons; it never executes. The suite executes, but only on a local validator with short clocks and a census of 21. The following are the things that remain unexercised in the only form that would settle them, and they are named so they are not assumed:

1. **Run the crank, the alarm, and one full revenue cycle on mainnet with throwaway program IDs and real amounts.** This is item 22 and it is the single largest residual risk. The pool's accumulator, the two-step activation and join gate, the in-line monthly run, the rolling redemption window, and governance execution with skips are the youngest code here and they move value. They have never run against a live cluster with ~2,100 vaults, real RPC behavior, and a transient error on vault 1,900 of 2,100. The dress rehearsal (road step 8) must include: one full live revenue cycle through Orca and one with Orca forced to refuse so Meteora runs; one forced post-sweep failure walked through by hand; and the alarm's live passes in rehearsal mode.

2. **Build the redeem page and run it live.** Item 50 is open and blocking. The holder guide promises a page that checks a vault for anything that would be destroyed, offers to trigger (and join) a payout first, and empties the vault at the moment the opening runs. Until that page exists, items 9 and 44 have no preventive control at all. The page must be built OUTSIDE `programs/`, `bank/` and `scripts/`, or before the freeze, because any change there resets the freeze counter.

3. **Independently reproduce the build from source.** `scripts/build-mainnet.sh` proves which key each binary carries and that the sweep helper's bytes are identical between the localnet and mainnet builds. What it cannot prove is that the compiled constant IS Gary's key; a third, wrong key would reject the test key identically. The bridge is reproducibility: multiple independent parties must rebuild from the release commit and confirm the sha256 values. That, plus the source check, is the whole claim.

4. **Set the charter opening date and lock deadline, and re-check the Proof of Burn collection's update authority.** Item 38 is still open. The charter window's opening date and the lock deadline that follows from it must be set in `launch/mainnet-init.json` before anything mints. The PoB collection's update authority is a hot wallet (accepted limit 46); consider whether it can be moved to a multisig or made immutable before the window opens, and re-verify on mainnet that the collection carries only its royalties plugin.

5. **Formalize the pool arithmetic.** The accumulator logic is the heart of the money system. The suite tests it extensively, but a machine-checked proof of the invariant "the pool always holds at least ceil(owed)" across every ordering of credit/claim/join/retire/reweigh would be stronger than any number of assertions. This is not a substitute for the dress rehearsal; it is a complement to it.

6. **Publish the holder guide only after item 50 ships.** The guide speaks of the redeem page, the deposit address page, and the public redemption poster in the present tense. It is marked DRAFT and may not be published before those surfaces exist.