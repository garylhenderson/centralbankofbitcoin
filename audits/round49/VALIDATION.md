# Round 49 repair validation

Round 49 (THE FINAL ROUND, RULING Gary 2026-10-10: the five programs and the pages
holders and Gary sign, run internally by four fresh Claude agents) audited
`617504d` and was **LAUNCH-CLEAN, quorum met (4 of 4, 3 needed)**. Nothing in the
five programs; nothing in (a)-(d). One item held the deploy: V49-2, a holder-facing
sentence. Gary, 2026-10-10, on that item: "Deploy. It's just a sentence."

## Repairs (`90f808d`), each shown red with its fix reverted

- **V49-2 (INFO, in scope).** The vault page, the holder guide and the README said
  nothing can leave a sealed vault; the rescue moves a CBOB vault sent into one out
  to the Bank's multisig. Each now states that exception, and the README's SEAL row
  says its tokens stay. Selftest arm over all three, red on the old page. No
  transaction changes.
- **V49-1 (LOW, tooling).** The validator lock moved to
  `/home/ubuntu/.cache/cbob-validator.flock`, one per machine, so a rehearsal
  tree's path map cannot give that tree a lock of its own. Arm.
- **V49-3 (INFO).** The programs last changed in round 35 (`0b3ddb3`, which added
  `rescue_nested`), not round 27; corrected in round 48's record.
- **V49-4 (INFO).** V48-1's rule (a waiting vault claims first) in the planner
  header and web/README.
- **Floors.** Detectors 1091, web 806.

## Validation (at `90f808d`)

Certifying runner `/tmp/claude-1000/validate-90f808d.sh`, under the machine-wide
lock, live mainnet probe enforced:

- `.cache/90f808d-suite.log`: **RC 0**. Mainnet probe 35/35, on-chain
  **913/913**, detectors **1091/1091**, allocation 39/39, web offline **806/806**,
  Core watch 29/29, README facts current, expiry budget 4/4, swap fork 16/16.
- `.cache/90f808d-web-e2e.log`: **154/154**, RC 0.
- `.cache/90f808d-sim.log`: **71/71**, RC 0.

## Road step 9 (done the same day)

On Gary's word the five ids were upgraded from the placeholder to the `d2ae5fc`
release build, each dumped back and checked (first `len(dist)` bytes hash to
`dist/`, zero tail), and each verified by OtterSec from this repository
(`https://verify.osec.io/status/<program id>`). Upgrade authorities are kept for
step 11. See SPEC's road table.
