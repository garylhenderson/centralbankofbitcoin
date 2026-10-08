# Round 38 repair validation

Round 38 is NOT CLEAN on both passes, quorum met with no margin (programs 6/8:
Ember failed twice, MiniMax was a plan of an audit, not one; off-chain 6/8: GLM
reasoning-only then failed, MiniMax a permission request, DeepSeek counted from
its same-content re-run). Audited tree `45271f9`, scope-frozen. No confirmed
defect in the five programs and no repair changes a program. Consecutive clean
rounds stay 0 of 2.

## Repairs, programs pass (`VERDICT-programs.md`)

- **V38-1 (LOW, page):** the final re-plan's `splice(-1)` removed the wrong
  stray; it now removes exactly the intended item.
- **V38-2 (MEDIUM, page):** each late arrival got a new tick-box, so a stranger
  landing items repeatedly could keep the page from ever sending. Now one
  standing consent (no address, count or digest in its id) covers anything that
  arrives after the check; late items are never delivered and ask for no new
  box; the press makes at most two dry runs.
- **V38-3 (INFO, page):** the ceremony's collection rule. Final form (after a
  drift-sweep catch, B4, that a padded decoy could stop launch day): pins win and
  stop on disagreement; one collection verified as the launch key's is adopted;
  two verified stop; with none verified, unverifiable candidates are listed with
  a "pin it instead" warning and step 0 is still offered; after step 0 Gary must
  tick that he recorded the address before continuing.
- **V38-4 (INFO, SPEC):** limit 27's cost falls on every other holder.
- **V38-5 (INFO, guide and page):** late reserve-mint deposits into a handed-in
  account with a kept close authority do not come out; the guide no longer
  promises "everything".

## Repairs, off-chain pass (`VERDICT-offchain.md`)

- **C01 (LOW):** round 37's frozen-pool repair planned the joins but never SENT
  them (only the unfrozen block batched claims). The crank now sends join-only
  batches from a frozen pool. Gate 5: R38 C01 asserts the batch in `plan.claims`
  (what the crank sends), shown red with the repair removed. Round 37's
  VALIDATION overstated that repair; this corrects it forward.
- **C02 (INFO):** `detectSweepState`'s comment now matches its code.
- **C03, C04 (INFO, documentation exception):** SPEC's oracle filter applies at
  the read the swap is built from; limit 7 names the daily `--reconcile` and its
  silent stall. Text only. **Independently re-verified before round 39: both
  PASS** (`.cache/drift39.md`, job 1).

## Pre-round-39 drift sweep

2 holder-facing and 4 internal items, all fixed: the guide's three remaining
"everything inside" promises; the redeem page's stop message now names the real
cause; SPEC's unblockability text credits the standing consent; the web README's
count, stop list and collection rule.

## Validation

- Detector selftest **926/926**; launch 49/49; poster 24/24; web offline
  **618/618**.
- Canonical run (`.cache/r38-suite.log`, `CBOB_SHIP_GATE=1`): **EXIT 0**,
  on-chain 895/895, allocation 39/39, mainnet walk 33/33, expiry 4/4, swap fork
  16/16.
- Pages end to end (`.cache/r38c-web-e2e.log`): **113/113**, including a
  stranger landing a freezable stray and a kept-close-authority account before
  each of three presses: the opening lands, nothing late is delivered. The first
  two runs failed only in the test's own arithmetic (a hard-coded late count,
  then a check that compared objects as strings and so could never fail); both
  corrected to the property.
