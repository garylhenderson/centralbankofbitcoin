# Round 47 repair validation

Round 47 (audited `487a8b4`, the stripped release build) was **LAUNCH-CLEAN on
both passes, quorum met** (7 of 8 seats counted on each pass, after same-prompt
re-runs of five failed seats). No confirmed finding in (a)-(d). It was **not a
no-change round**: the programs pass confirmed V47-1 to V47-9 and the off-chain
pass V47o-1 to V47o-9, all LOW or INFO, all outside the five programs. Gary's
rule of 2026-10-09 therefore still needs a later round that requires no changes.

## Repairs (`bba189a`), each shown red with its fix reverted

- **README facts** (`scripts/readme-facts.mjs`). Only TRACKED audit rounds are
  counted, so an audit in progress no longer stops the certifying suite (V47-1,
  V47o-4). `REQUIRES CHANGES: NONE` reads as owing nothing (V47-2, V47o-5). SEAL
  and BURN are described as they are; the sweep helper pays the reserves out,
  through Core (V47-6). Three selftest arms; red under each mutation (untracked
  directories counted again, the old regex, the old SEAL wording).
- **SPEC and the README road row** (V47-7, V47-8, V47o-3). Items 22 and 53
  restated after the rehearsal, 22.2's result recorded, and, in `70dafdf`,
  **RULING, Gary 2026-10-10: 22.2 is accepted as passed** (a true detection: the
  alarm caught the real Core upgrade). The road row says so. Item 22 stays open
  only for the ~2,100-vault scale; item 53's last in-tree run is `e7c192a`.
- **Core watch** (`scripts/core-watch.mjs`, `scripts/core-watch-suite.sh`). The
  diagnostic writes its result with `JSON.stringify`; an unreadable result is one
  URGENT "unknown, treat as failed" email and never a restart (V47o-1). An earlier
  build's result is still sent, once, after a second Core change (V47o-7). The
  probe's floor is read from `MAINNET_FLOOR` (C19). Seven new arms (25/25); red
  under four mutations.
- **One validator at a time** (`scripts/validator-lock.sh`, NEW; V47o-2). A
  kernel flock every runner takes before its exit trap; runners a holder starts
  inherit it; the validator is booted without it, so a killed run frees it and the
  next run's cleanup removes the orphan. `run-tests.sh` re-hashes the booted Core
  against the pin at [4/7]. The diagnostic waits on the same lease and restores
  the pinned Core a crashed diagnostic left swapped. Four arms; red under four
  mutations. One arm failed on first writing and found a real gap (the validator
  inherited the lock, so a killed run's orphan would have held everyone off);
  fixed before commit.
- **Installer** (`scripts/cron-install.sh`, V47o-6). The Core watch under
  `flock`, off the */10 tick, and its own deadman (state missing or over an hour
  old). Eight jobs; the selftest's list moved with it; red with the lines removed.
- **Pages.** The ceremony gives the wallet-edit judge its compute floor from the
  step's own dry run (the measured need, so Phantom's 200,000 still passes;
  V47-4). The judge refuses a signer or writable the wallet removed (V47-5). The
  mock RPC serves the page's `getTokenAccountsByOwner` listing (V47o-8). Each
  red under its mutation (the V47o-8 arm against the old mock).
- **Suite R.4** (`tests/3prog.test.ts`, V47-3). It reads the collection's raw
  plugin registry; the new control R.4b creates a collection that also carries an
  AppData adapter and must read as more than Royalties. The raw read was first
  checked on two real mainnet Core collections (the Proof of Burn collection and
  the rehearsal collection: `Royalties|0` each). On-chain floor 912 -> 913.
- **Clean clone** (V47o-9). `run-tests.sh` names a missing `dist/` before the
  page tests; the README gives the bootstrap order. Proxy comment: five shapes
  (V47-9).
- **Floors.** On-chain 913, detectors 1081, web 805 (plan 172, ceremony 161,
  tx 37).

## Validation (at `bba189a`; `70dafdf` and `6dfca99` change only SPEC and README text)

Certifying runner `/tmp/claude-1000/validate-bba189a.sh`, under the new shared
lock, live mainnet probe enforced:

- `.cache/bba189a-suite.log`: **RC 0**. Mainnet probe 35/35, on-chain **913/913** (R.4 and its control R.4b
  green on the real chain), detectors **1081/1081**, allocation 39/39, web offline
  **805/805**, README facts current, expiry budget 4/4, swap fork 16/16.
- `.cache/bba189a-web-e2e.log`: **152/152**, RC 0.
- `.cache/bba189a-sim.log`: **71/71**, RC 0.

Offline, at `bba189a`: detectors 1081/1081, web 805/805, launch 69/69, poster
24/24, allocation 39/39, Core watch 25/25.

## Open before road step 9

Round 48 audits this tree and, by Gary's rule, must require no changes. The five
programs are unchanged since round 27, and the release build is still `d2ae5fc`.
