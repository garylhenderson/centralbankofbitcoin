# Round 44 repair validation

Round 44, the confirmation round on the tree round 43's repairs changed, is
**LAUNCH-CLEAN on both passes, quorum met** (programs 6/8 counted, audited
`03b70f9`; off-chain 8/8 counted, audited `2e8c979`, which differs only in the
`sendV0` test helper). Same-prompt re-runs: Qwen max-prime on programs (provider
failure) and DeepSeek on off-chain (cut off); first-run manifests and failed
outputs are kept. No confirmed finding in (a)-(d); rounds 41-43's twelve confirmed
findings were independently re-checked by both triages and stand outside (a)-(d).

## Repairs (`94f06a8`)

Programs pass: V44-1 the rehearsal signing page accepts `launch/rehearsal-init.json`
(rehearsal-mode judge, init key and treasury from the value file); V44-2
`release_gate` requires the id map to be exactly the five pinned program ids plus
the root and refuses untracked build files; V44-3 `audit-coverage.sh` credits
LAUNCH-CLEAN headlines; V44-4..V44-7 docs and labels. Off-chain pass: V44o-1 the
poster's unreadable count survives a draining backlog; V44o-2 revenue's split
recovery records a refused signature instead of throwing; V44o-3 a null SEAL
config keeps every reserve baseline; V44o-4 the no-network exit names what was
skipped; V44o-5 the rehearsal swap-operator key lives where `revenue.mjs` reads it
and crank and revenue notices carry REHEARSAL. Each fix was shown red when
reverted, in copies whose absolute paths were rewritten (the earlier forks'
evidence had partly read `/opt`; these did not).

## Found after the repairs, and fixed

- **The V44-2 gate refused every real rehearsal tree** (its ids and root were
  literals that the rehearsal substitution rewrites; its own fixture was rewritten
  the same way, so it passed). Found by building the rehearsal driver; fixed in
  `a3cfd79` (ids from `web/src/config.js`, the root assembled).
- **The rehearsal driver** (`a3cfd79`): box-signed, dry run by default, a hard
  `--max-sol`, resumable state that never re-sends a completed step and re-reads an
  unknown outcome. Proven on a local chain at `63bb723`: deploy, ceremony with every
  config read back, three charter claims, a voted sale round, two buys, activation,
  items 22.1 (crank) and 22.2 (alarm) PASS, a crack paying 56,700 sats (21,000
  deposited plus the 85% pool share of two sales), the programs closed. Items
  22.3-22.5 need mainnet. Selftest +22 arms, each red under its mutation.
- **The page end-to-end test and the Test Vault simulation waited on the box's
  clock for on-chain windows.** Under load (average 47 on 16 cores) the validator's
  clock lagged and they were refused `VotingOpen` and `CharterNotOpen`. All eight
  such waits now read the cluster's Clock, as the programs and the suite do.

## Validation

- Offline at `c9a811d`: detectors **1004/1004**, web **695/695**, launch 68/68,
  poster 24/24, allocation 39/39; audit coverage complete (121 files, round 45
  prepared).
- Canonical run (`.cache/c9a811d-suite.log`, `CBOB_SHIP_GATE=1`): **RC 0**. On-chain
  **912/912**, detectors 1004/1004, mainnet probe 35/35 (the deployed Core is the
  pin), web offline 695, swap fork 16/16.
- Pages end to end (`.cache/chainclock-web-e2e.log`, chain-clock waits):
  **132/132**, RC 0. Test Vault simulation (`.cache/chainclock-sim.log`): **71/71**,
  RC 0. (Before the clock fix, the same tree failed both under load:
  `.cache/c9a811d-web-e2e.log`, `.cache/c9a811d-sim.log`.)
- The rehearsal proof (the full suite inside the rehearsal tree) last passed at
  `2e8c979`; it is re-run on the final commit before the rehearsal.
