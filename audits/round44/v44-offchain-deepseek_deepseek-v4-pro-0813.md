## Round 44 off-chain audit

I read the current tree under the targets in order. I did not re-run the canonical suite or a fork. Evidence below is source-level and names the observable on-chain or test-run result that would distinguish a real finding from a wrong one.

The round-43 verdict’s three off-chain LOW repairs are present at their sites:

- V43o-1 `release_gate` in `scripts/run-tests.sh` now handles the recorded rehearsal tree and keeps the web gate skipped there.
- V43o-2 `UNREADABLE_SKIP_PASSES`, `detectUnreadSkips`, the poster’s three-try skip, and the SPEC reader/backlog wording are all in the tree.
- V43o-3 the reveal run is extracted in `bank/selftest.mjs` and run with `'other'`/missing/burned assets.
- V43-1 `planRescues`, the rescue send block, the crank-instruction allowlist arm, and the R43 V43-1 arms are present.

I did not find a failed repair from round 43. I did find two LOW findings in this pass’s targets.

---

## Findings

### LOW-1: a stranger can wedge the royalty swap by pre-funding the operator’s wSOL ATA

- **Construct:** `bank/swap.mjs` `swapInstructions()`, used by `bank/revenue.mjs` in the venue loop.
- **What happens:** `swapInstructions` wraps exactly `lamportsIn` into `ata(WSOL, operator)`, then `SyncNative`, then the venue swap, then `CloseAccount` of that wSOL account back to the operator.
- If the operator’s wSOL ATA already holds any wSOL token balance when the swap runs, `SyncNative` sets the token account amount to `(pre-existing wrapped amount) + lamportsIn`. The swap consumes only `lamportsIn`, leaving the pre-existing wrapped amount in the account. The final `CloseAccount` then fails with the classic SPL token program’s not-empty error, on both Orca and Meteora.
- The revenue job does not read or clear this account before sweeping or swapping. The sweep has already moved royalty SOL to the operator, so the cycle becomes an open, alarmed cycle and stays stalled until a human with the operator key empties/closes the wSOL ATA.
- Anyone can cause this without the operator key: wrap lamports and `transfer`/`transferChecked` one unit of wSOL to the operator’s associated wSOL ATA. Creating that ATA idempotently is permitted by the ATA program. The attacker can do it again after every manual cleanup.
- **Evidence if the claim is true:** on a mainnet fork or local validator, pre-fund `ata(WSOL, operator)` with 1 wSOL token unit, then submit `swapInstructions` for either venue. The transaction fails at instruction 6, `CloseAccount`, with `TokenAccountNotEmpty`; the sweep previously landed and the ledger row remains open under `cycleIsOpen`.
- **Severity:** LOW. This is an off-chain denial of the royalty conversion path. It does not move value out of a vault, the pool, or the revenue address; it does not stop a holder’s redemption; it is loud via `unreconciled_swap`/revenue failure pages.
- **Fix:** before a live swap, read the operator wSOL ATA. If it already holds wSOL, close/empty it in a prior operator transaction, or include a first close at the start of the swap transaction. At minimum, refuse with a specific “clear the operator wSOL ATA” error before sweeping.

---

### LOW-2: an undelivered alarm pass can mark a transient LEVEL finding as paged and lose the original page

- **Construct:** `bank/alarm.mjs`, the `if (!delivered)` branch after `report()`.
- **What happens:** `report()` returns `delivered: false` if any notification delivery fails. But `planAlarmNotices` has already placed the level kinds present this pass into `sent.paged`. The state-write code does:
  ```js
  next.paged = [...new Set([...(prev?.paged || []), ...sent.paged])]
  ```
  even when `delivered` is false.
- On the next pass, `planAlarmNotices` treats those kinds as already paged. If the condition has cleared, it sends a RECOVERY rather than the original finding. The original HIGH or CRITICAL was never delivered.
- This matters for genuinely transient level kinds such as `crank_problem`, `crank_silent`, `crank_failing`, `revenue_unsplit`, `redemptions_near_cap`, `scan_gap`, and similar. They can appear in one pass and clear before the next one.
- **Evidence if the claim is true:** a pure test can drive `planAlarmNotices` and the alarm state-write block with a synthetic LEVEL finding, fail the notifier, then run the next pass with no finding. The next pass produces a recovery notice for that kind, although no prior alert was delivered.
- **Severity:** LOW. This is an alarm reliability defect, not a value path.
- **Fix:** on a not-delivered pass, do not advance `paged` into the persisted set. Preserve only the previous `paged`, or track per-notice delivery. Re-paging a still-present level finding is the safe direction.

---

## Target notes

### R1, crank

I did not find a plan the program would refuse that is not already raced by `BENIGN` or re-judged by `judgeDistributeRefusal`, nor a plan that joins or pays a positively burned vault, nor reveal order inversion. `planRescues` filters to the same host classes MINT’s `rescue_nested` accepts.

### R2, alarm/detectors

The detectors mostly fail closed. Danger-state coverage follows the SPEC control table and the accepted limits. LOW-2 above is the concrete alarm-path defect I found.

One accepted blind spot remains exactly as SPEC item 38 states: `guardian`, `swap_operator`, `max_sweep_lamports`, `sweep_cooldown_secs`, and `sol_reserve_lamports` are not asserted against their ruled production values by the alarm’s `test_value_in_production` check. That is already documented, so I am not re-filing it, but it is the most important “dangerous state the alarm reads as quiet if it was written wrong” in this pass.

### R3, layouts

No struct-vs-Rust or cross-program offset discrepancy found in the bundled MINT/sweep/layout code. The old round-24 D6 seed-assertion gap is now represented by the SEED scrape arms in `bank/selftest.mjs`.

### R4, accrual

`credit`, `pendingScaled`, `reweigh`, `ceilSats`, and `available` match MINT’s formulas. The crank expires due boosts before distribution and post-distribution plan is consistent with `advance_epoch`/`boosts_due`.

### R5, swap and revenue

LOW-1 is the main new swap defect. The pre-signing judge otherwise checks the exact seven-instruction shape, amount, floor, direction, output account, and signer set. I did not find a confirmation-timeout path that double-swaps or reads a failed cycle as closed.

### R6, gates

The assertion floors remain equality floors and are not overridable. The V43o-1 rehearsal gate and Core four-copy pin check are real. I did not find a floor satisfied by deleting its subject.

### Accepted-limit questions

1. **No accepted limit looked materially worse than stated.** The pre-funded wSOL ATA issue is adjacent to limit 10, but limit 10 does not currently name it; I am filing it separately.
2. **Nothing I examined under ACCEPTED appears already closed and wrongly listed.** The still-open items in SPEC are indeed present and the code does not secretly implement them more strongly in a way SPEC misses.
3. **I did not find a DISCHARGED item still open.** The boost, compute-boundary, duplicate-attribute, and deleted-Bank/deck/distributor items all match the current tree. GOV is outside this pass, so GOV-read offsets/items were not independently rechecked here.
4. **No OPEN AND BLOCKING item appears quietly treated as accepted.** Items 22, 38, 50, 52, and 53 remain OPEN in SPEC; `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline`, and `vault_collection` OPEN; `scripts/check-launch-params.mjs` still refuses them.

---

## Given that no human firm will ever see this and the programs will be immutable

What this process still cannot produce is a proof that the off-chain path behaves under a persistent adversary, or that operational people will act correctly on the pages it sends for the first time at launch. Before launch, concretely:

1. **Run the dress rehearsal with injected operational grief**, not only the happy crank/alarm/revenue paths. Pre-fund the operator wSOL ATA, flood MINT signatures, force truncated logs, force a DAS index lag, force an RPC that answers one signature malformed for exactly three passes, and observe that the correct pages fire and the human runbooks clear them.
2. **Exercise the revenue cycle under adversarial wSOL/ATA state** on the fork or rehearsal, including clearing the wSOL ATA with the operator key. This should become a named item in rehearsal item 22, since it currently is not.
3. **Run the redemption page against a mock with a pre-funded operator wSOL ATA** and against a missing revenue ATA after initialize, so the alarm/poster/alarm deliverability assumptions are tested before the page is the only preventive control.
4. **Before removing upgrade authority**, dump every deployed program twice from independent RPCs and check the prefix hash and zero tail against `dist/SHA256SUMS`. Do not rely only on build provenance for the actual mains.
5. **Escrow the guardian/INIT_AUTHORITY and swap-operator operational response plan.** AI cannot verify that a human will pull the guardian stop within the window the chosen cooldown creates. The cooldown/cap is a bound only if the stop is actually pulled, and that is a custody and operations fact, not a code fact.
6. **Keep a signed runbook with exact signatures from the dress rehearsal**, because an off-chain cycle that fails later will be reconstructed from logs and RPCs, and every signature saved at rehearsal time becomes the only trusted evidence that the tooling was exercised while fixable.