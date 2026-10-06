# Round 29 repair validation

Round 29 is NOT CLEAN; repairs cannot retroactively clear it. Consecutive clean
rounds remain 0/2. The source audited was clean `76753e8`. Programs counted 7/8
with four confirmed topics; off-chain counted 6/8 with three. The MEDIUM
(runtime log truncation halting the scanners) and the LOW (coverage gate scope)
are shared: five distinct topics, one MEDIUM, one LOW and three INFO.
No live alarm entrypoint, money job, notification, deployment or lock was run.

## Repairs

- **M1.** `bank/txread.mjs` still refuses the runtime's `Log truncated` marker by
  default. A walking scanner passes `{ truncatedLogs: 'flag' }` and receives the
  transaction, otherwise fully validated, marked `logsTruncated`. `bank/alarm.mjs`
  pages it as `log_coverage_gap` (HIGH, classified one-shot), records it in the
  state's `logGaps`, does not parse its event lines, still runs every
  instruction- and token-movement detector, and advances its cursor (the alarm
  still keeps every cursor when a page is not delivered). `bank/revenue.mjs`
  reads the outflow, which comes from instructions and inner instructions.
  `bank/redemption-poster.mjs` never drafts from truncated logs; it queues a
  REJECTED hand-draft entry when BURN was invoked at the top level, and moves on.
  SPEC's reader coverage boundary states the remaining gap honestly.
- **L1.** `scripts/audit-coverage.sh` enumerates every tracked file under
  `programs/`, `bank/`, `scripts/`, `sim/`, `launch/` and `tests/` plus SPEC,
  DESIGN, the holder guide and the workspace manifests, with named exclusions,
  and refuses an empty listing. It then reported eight never-bundled files; all
  eight are in round 30's bundle, so it passes on **prepared** coverage.
- **INFO.** DESIGN's `activate` bullet now says request-then-join. SPEC states
  the permanent dilution an activated orphaned vault imposes on every other
  vault (beside impossibility 3 and in items 9 and 44); a program change is an
  owner decision before the lock. The selftest's signer and retired-key scans now
  include `tests/*.mjs`.

## Validation

- Detector selftest: **891/891** (`.cache/r29-selftest5.log`). New arms: flag mode
  marks truncation and still refuses other defects and an unknown option; the
  actual extracted alarm walk pages one gap, still reports an instruction
  finding and advances; the revenue scan keeps its outflow; the poster advances
  and queues a REJECTED entry only for a top-level BURN call. The round-28 arm
  that required the halt was replaced.

An independent reviewer read every repair and ran the selftest against a scratch
copy with 13 mutations; 11 of the 12 that applied were caught. Its fixes were
applied: SPEC's dilution note now says the orphan's share is paid into its own
unredeemable reserve and measures it against `total_active_weight`, not the
full census; the coverage gate exits 2 with its own message when git cannot
list files (measured with a bad `GIT_DIR`); the alarm arm now places a real
`CBOB_REVEAL_RESCHEDULED` line before the marker and asserts it is not paged
(re-measured: a scratch copy that parses truncated logs fails it, 890/891); the
poster arm adds an inner-only program control; the mainnet probe's fee-payer
sampling accepts truncated logs; the gap page names the event kinds that can be
lost. Selftest after the fixes: **891/891** (`.cache/r29-selftest6.log`).
An interim full run started before the review was stopped and is retained
(`.cache/r29-suite-stopped-for-review-fixes.log`); it is not counted.

**Canonical full runner: PASSED, exit 0** (`.cache/run-tests.r29b.frozen.sh`,
`.cache/r29b-full-pass.log`, on-chain `.cache/r29b-onchain-855.log`): **855/855**
on-chain, **891/891** detector, **39/39** allocation, **22** poster, **14** PoB,
**47** launch, **6** host, **33/33** live mainnet probe, **4/4** expiry budget and
**16/16** swap fork, every floor equal to its count. Fork venues: Orca
**1,406,947** and Meteora **1,407,038** sats against oracle expectation
**1,410,995** and minimum **1,389,830** (150 bps); fork transactions, not live
money.

The **71/71** Test Vault simulation from round 28 (`.cache/r28-sim.log`) is
reused explicitly: round 29 changes no program, no test-vault code, no token
or Core pin and no simulation fixture, only off-chain readers, the coverage
gate and documentation.

Pending: commit and push, post-commit build-mainnet and rehearsal refresh.
