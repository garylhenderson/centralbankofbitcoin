# Round 48 repair validation

Round 48 (audited `d0e77e0`, round 47's repairs, round 46's roster) confirmed
nothing in (a)-(d) on either pass. Its programs pass did not meet quorum (5 of 8
real audits after three same-prompt re-runs); its off-chain pass was
LAUNCH-CLEAN (6 of 8). Both required changes: programs V48-1 to V48-3, off-chain
V48o-1 to V48o-7, all LOW or INFO, all outside the five programs.

**RULING, Gary 2026-10-10 (audit cost):** after these repairs, ONE final round
(round 49) on the five programs and the pages holders and Gary sign, run
internally by Claude agents, not through OpenRouter. If it requires no change
there, deploy. Tooling and documentation findings are fixed but no longer reset
the count.

## Repairs (`128d84d`), each shown red with its fix reverted

- **V48-1 (LOW), the redeem page.** A vault WAITING to join now claims first in
  its opening (`web/src/lib/plan-redeem.mjs`), so a join and a credit that land
  while the holder approves are collected instead of refused `ClaimBeforeBurn`;
  not while the pool is frozen, as for an active vault. MINT's `claim` skips a
  waiting vault, or joins it owing nothing, and never fails it (read in
  `programs/cbob-vault-mint/src/lib.rs`, `claim`). Plan arm (red on the old
  planner) and two on-chain e2e arms: a claim naming the waiting vault succeeds
  before and after it may join.
- **V48-2 (LOW) and V48o-4 (LOW), the validator lock.** `sim/rehearsal-local.sh`
  and `scripts/validate-core-gate.sh` take the shared lock before their trap or
  first kill and boot without it. The selftest no longer names five runners: it
  FINDS every tracked shell script that boots or kills a validator (seven) and
  checks each, and checks that the one node script that boots its own validator
  runs only under `run-tests.sh`. Red with the old gate script.
- **V48-3 (INFO), web/README.md.** The token-listing paragraph (one
  `getTokenAccountsByOwner` per program since round 46) and the offline count,
  now pinned to `WEB_FLOOR` by a selftest arm (which caught the next floor move).
- **V48o-1 (LOW), the Core watch.** Every diagnostic result and its marker carry
  the run's pid and boot id. A result still queued, waiting or running whose run
  is gone reads as DIED: one URGENT "unknown, treat as failed" email with the
  command to run it again, never a restart and never "waiting" forever; a dead
  marker no longer blocks a hand restart. Four arms; red under mutation.
- **V48o-2 (LOW), the gates.** `run-tests.sh` runs the Core watch selftest at an
  EQUAL floor (`CORE_WATCH_FLOOR=29`), the selftest enforces its own count, and a
  selftest arm pairs the two floors. Red with an arm deleted.
- **V48o-3 (LOW), the alarm.** A token account created for a BURNT vault's
  wallet is one INFO (`burnt_vault_token_account`), never a false CRITICAL; a live
  vault's non-canonical account still pages CRITICAL. Arm run through the alarm's
  own map-building block; red without the fix.
- **V48o-5 (INFO).** The diagnostic counts failures in its own log.
- **V48o-6 (INFO), the reader.** A System `transfer` must carry its accounts and
  a whole, non-negative lamport amount. Five mutations of the real v1 fixture
  refused, the real one passes; red without the check.
- **V48o-7 (INFO), the installer.** `cron-install.sh` refuses, listing them, when
  untagged CBOB jobs are already in the crontab. Seven-case arm; red with a
  narrower matcher. The box's own untagged lines are removed when the tagged set
  is installed at go-live.
- **Floors.** Detectors 1089, web 806, e2e 154, Core watch 29 (new). The README
  facts list the Core watch.

## Validation (at `128d84d`)

Certifying runner `/tmp/claude-1000/validate-128d84d.sh`, under the shared lock,
live mainnet probe enforced:

- `.cache/128d84d-suite.log`: **RC 0**. Mainnet probe 35/35, on-chain
  **913/913**, detectors **1089/1089**, allocation 39/39, web offline **806/806**,
  Core watch 29/29 (gated, silent on success), README facts current, expiry
  budget 4/4, swap fork 16/16.
- `.cache/128d84d-web-e2e.log`: **154/154**, RC 0 (both V48-1 arms green on
  chain).
- `.cache/128d84d-sim.log`: **71/71**, RC 0.

Offline at `128d84d`: launch 69/69, poster 24/24, allocation 39/39.

## Next

Round 49, the final round, on this tree: the programs pass only, four Claude
auditor agents and one independent triage. The five programs are unchanged since round 35 (`0b3ddb3`, which added
`rescue_nested`; round 49's V49-3 corrected an earlier "round 27"). The release
build is still `d2ae5fc`.
