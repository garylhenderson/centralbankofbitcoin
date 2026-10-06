# Round 31 repair validation

Round 31 is NOT CLEAN. Quorum was met on both passes (8/8 each after same-commit
re-runs of seats that failed for provider reasons). Repairs cannot retroactively
clear it; consecutive clean rounds remain 0/2. The source audited was clean
`425111d`. Seven distinct topics: three LOW and four INFO. No program defect.
No live alarm entrypoint, money job, notification, deployment or lock was run.

## Repairs

- **L (off-chain L1).** Any no-op call to a permissionless instruction makes
  "one of our programs ran" true, so `log_coverage_gap` is now ONE finding per
  pass, classified `level`, with text free of signatures and counts; the
  signatures stay in the state's `logGaps`. The router holds an unchanged text
  instead of sending an urgent email per fee. SPEC states the cost: a second,
  genuine gap inside an open stream adds to `logGaps` without a new email.
- **L (off-chain L2).** The alarm reads at most `PER_PROGRAM_READS` (2,000)
  transactions per program per pass; the rest of the window becomes the same
  resumable backlog as a gap. A flood slows only that program's transaction scan;
  one pass reads at most 8,000 transactions in all before reporting.
- **L (programs L1).** The coverage gate credits a pass only when its verdict's
  first line says QUORUM MET and nothing that negates it.
- **INFO.** The round-32 prompt names round 31, and its prose check derives the
  prior round from the script's own number; SPEC 38 says which values the alarm
  judges and that it pages later changes to the rest as `config_drift`
  (verified: all five are watched); the poster counts the vault wallet's SOL swept
  by a System transfer and names it; the probe's usage line names itself.

## Validation

- Detector selftest: **900/900** (`.cache/r31-selftest4.log`). New arms: a
  25,000-transaction flood under the 2,000 budget drains in 13 passes, none reading
  more than 2,000, and the buried transaction is read; the gap is one level,
  non-urgent finding per pass with no signature and identical notice text across
  passes. A pinned R27 reader value moved by 1,000 lamports because that fixture's
  System transfer from the same address is now counted as released SOL.
- Poster selftest: **23/23** (new arm: SOL swept from the vault wallet is released
  and named, SOL sent to it is not).

An independent reviewer read every repair and mutation-tested in a scratch copy.
It found: (1) a one-per-pass `level` gap is a ONE-SHOT condition, and the router
deletes a held alert whose recovery arrives inside its 25-minute window, so a
slow gap pass followed by a quick one could swallow a genuine gap; the gap is now
a true level condition, `detectLogGaps`, standing every pass while any kept gap is
newer than a reviewed-through watermark a person writes to
`bank/log-gaps-reviewed`, and clearing only then; (2) the read-budget trim and the
over-budget gap had no failing test at the default budget; arms at a 1,500
budget now cover both, including a walk that ends naturally between the budget
and two pages; (3) the gate's quorum check accepted made-up wordings and had no
test; it now requires the exact headline `# Round N, FOCUS pass: [NOT ]CLEAN;
QUORUM MET`, with eight both-ways cases run by the detector selftest; (4) stale
"rounds 22 through 27" prompt text, and SPEC overstatements on the four-program
flood, the poster's page count and item 38's "only value gate", all corrected.
Re-measured by mutation: removing the trim, the over-budget gap, or making the
gap stand only on passes with new gaps each fails a test (900/901).
Selftest after the fixes: **901/901**; poster **23/23**.

**Canonical full runner: PASSED, exit 0** (`.cache/run-tests.r31.frozen.sh`,
`.cache/r31-full-pass.log`, on-chain `.cache/r31-onchain-855.log`): **855/855**
on-chain, **901/901** detector, **39/39** allocation, **23** poster, **14** PoB,
**47** launch, **6** host, **33/33** live mainnet probe, **4/4** expiry budget and
**16/16** swap fork, every floor equal to its count. Fork venues: Orca
**1,410,051** and Meteora **1,409,128** sats against oracle expectation
**1,414,249** and minimum **1,393,035** (150 bps); fork transactions, not live
money. The round-28 **71/71** simulation (`.cache/r28-sim.log`) is reused: round
31 changes no program, simulation code, fixture or dependency pin.

The coverage gate in strict mode correctly fails until round 32, which bundles
every changed file, has run and been triaged; `--prepared` passes.

## Post-commit build and rehearsal

Repairs were committed and pushed as `4ae79d6`. The clean-tree post-commit
`build-mainnet.sh` passed (`.cache/r31-build-mainnet.log`, `dirty no`) and all
five dist artifacts match `.cache/r31-dist-before.sha256`. The rehearsal worktree
was refreshed at `4ae79d6` (`.cache/r31-rehearsal.log`): 54 patched files (the
prepared round-32 script also names the program IDs), exact reverse proof to
HEAD, all five keys preserved. Nothing was built, deployed or sent at the
throwaway IDs.

Live launch dates, holder surfaces, the Phantom ceremony, the both-venue revenue
cycle and forced post-sweep recovery remain open launch obligations. Round 31
stays NOT CLEAN; rounds 32 and 33 must each be clean.
