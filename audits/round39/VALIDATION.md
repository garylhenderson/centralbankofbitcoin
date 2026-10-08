# Round 39 repair validation

Round 39 is NOT CLEAN on both passes, quorum met (programs 8/8, off-chain 8/8;
every seat completed on the first run). Audited tree `21f36e1`, scope-frozen.
No confirmed defect in the five programs (none since round 27) and no repair
changes a program. Consecutive clean rounds stay 0 of 2.

## Repairs, programs pass (`VERDICT-programs.md`), all in `web/`

- **V39-1 (MEDIUM, regression from round 38's V38-2):** a stray the page
  promised could be dropped at the press and destroyed, unlabelled, when the
  press-time re-read failed or the stray sat beyond the 200 accounts read in
  full. At the press every promised account is now re-read BY ADDRESS with the
  three reserves; one missing, unreadable or no longer movable stops the press
  with a box about it; a failed re-read stops it before any dry run; "arrived
  after your check" is said only of what the check did not see.
- **V39-2 (LOW):** a stranger could block an opening by sending a CBOB vault
  into the victim's deposit address. A nested CBOB vault is never a refusal:
  the set-up step offers `rescue_nested` to the CBOBTC Squads as an optional
  group, and if it cannot happen the opening proceeds and the inner vault can be
  rescued afterwards (item 58).

## Repairs, off-chain pass (`VERDICT-offchain.md`): tests that could not fail

Each repaired test was shown RED under the mutation that breaks its property,
on scratch copies outside the repo.
- **C01:** R39 C01 runs `crank.mjs`'s actual send block with recording stubs:
  every step in red-team 3's order, and the frozen-pool joins leaving `main()`
  in a claim batch. Red under: no claims sent (mA), activation moved before the
  distribution (mD), round 38's join fix reverted (mR).
- **C02:** R39 C02 runs the alarm's actual balance write and vault-set line: a
  read balance stored, a null element's last value carried (never 0) and paged,
  an untrustworthy vault list not adopted. Red under: round 24 L7's original
  line restored (mH), the write deleted (mB), the list adopted (mC).
- **C03:** `bundle.test.mjs` now runs the BUNDLED `planRedemption` on six
  snapshots against node's. Red when it throws, and when only the bundle
  diverges.
- **C04:** the ceremony's step-0 key: fresh per build, never written to any
  browser store, used only to sign. Red under each of three mutations.
- **C05 (INFO, documentation exception):** HOLDER-GUIDE no longer calls the
  redeem page "being built". **Independently re-verified before round 40:
  PASS** (`.cache/drift40.md`).

## Pre-round-40 drift sweep

5 holder-facing items (all the same staleness: four texts still said a nested
CBOB vault refuses the opening; one guide line said something must come out
first) and 9 internal items (README stop list, page copy and comments), all
fixed.

## Validation

- Detector selftest **930/930**; launch 49/49; poster 24/24; web offline
  **642/642**.
- Canonical run (`.cache/r39-suite.log`, `CBOB_SHIP_GATE=1`): **EXIT 0**,
  on-chain 895/895, allocation 39/39, mainnet walk 33/33, expiry 4/4, swap fork
  16/16.
- Pages end to end (`.cache/r39-web-e2e.log`): **120/120**, including a CBOB vault
  sent into the host just before the press (the opening lands; the inner vault is
  then rescued from the burned host to the Squads) and every promised balance
  delivered through a 112-account flood and a failed listing.
