# Round 30 repair validation

Round 30 is NOT CLEAN, and its programs pass did not reach quorum (5/8 counted,
six required). Repairs cannot retroactively clear it; consecutive clean rounds
remain 0/2. The source audited was clean `c5aab17`. Ten distinct topics: one
MEDIUM (shared), four LOW and five INFO. No live alarm entrypoint, money job,
notification, deployment or lock was run.

## Repairs

- **M1 (MEDIUM).** `bank/sigwalk.mjs` takes a `startBefore` resume point. The
  alarm keeps `backlogs[program] = { head, before }` in its state: a gapped pass
  records how far it got, the next pass resumes there, and the cursor moves to
  the backlog's head only when a pass reaches the old cursor (checking the
  cursor is still resolvable when the resumed walk comes back empty). A cleared
  cursor drains the same way. The poster keeps `st.backlog` with the same rule.
  The `scan_gap` page now says what is happening instead of claiming nothing is
  skipped. SPEC states the remaining bound ("Scan backlog boundary").
- **L (programs L1).** `scripts/audit-coverage.sh` now also requires every
  tracked file's CURRENT content (git blob) to equal its content at the frozen
  HEAD of a completed round that bundled it, whose runner counted a quorum and
  whose independent verdict exists and does not record a failed quorum.
  `--prepared` credits the next prepared round's bundle for preflight only. It
  then named seven files, including `tests/initauth.test.ts`; all are in round
  31's bundle.
- **L (off-chain L1).** `log_coverage_gap` pages only when SEAL, MINT, BURN,
  GOV or the sweep helper executed in the transaction (top level or inner); a
  stranger's transaction that only names one is `log_truncated_foreign`, INFO.
- **L (off-chain L2).** `budgetPlan` runs the base plan whenever the key covers
  it and budgets reveals only from what lies above the floor, warning when the
  key is below it.
- **L (off-chain L3).** `sweepAmount` (`bank/swap.mjs`) returns nothing to sweep
  below `MIN_SWEEP_LAMPORTS` (0.01 SOL) above the reserve.
- **INFO.** Mainnet record rent 1,772,920 lamports (SPEC 672 and item 49,
  DESIGN); the drain time is about 209 hours as the cap falls with live supply;
  build-mainnet's banner attaches "reaching a later check" to the localnet
  acceptance; rehearsal RECOVERED, FAILED TO RUN, DID NOT RUN and RECONCILE
  FAILED notices carry REHEARSAL; SPEC item 44 says a frozen stray holding a
  balance reverts, one holding zero is closed.

## Validation

- Detector selftest: **895/895** (`.cache/r30-selftest5.log`). New arms: a
  25,000-signature flood through the real `signaturesSince` and the actual
  extracted walk gaps one pass, then drains, reads the buried transaction just
  after the cursor, reaches the head, then reads what arrived since; a cleared
  cursor recovers. Stranger-shape truncation is INFO and unpaged while an
  invoked shape pages HIGH. Budget arms at and under the floor. Dust and the
  minimum sweep, with the caps.

An independent reviewer read every repair and mutation-tested the arms in a
scratch copy. It found four problems, all fixed: (1) an EMPTY resumed walk was
treated as a drained backlog, so a resume point the RPC no longer knows could
skip the rest silently (alarm) or always (poster); a drain now needs positive
proof that the cursor is the next signature, otherwise the backlog is kept and
`scan_backlog_unproven` pages CRITICAL; (2) the crank's floor reserve applied
only when the full plan was unaffordable, so a key covering the whole plan by a
lamport ran every reveal and ended near zero; the reserve now applies on every
path, and a floor warning has its own stream and marker; (3) the poster's
backlog and (4) the rehearsal tags had no failing test. Also: foreign truncated
transactions stay out of the bounded `logGaps`, the coverage gate reads each
round's bundle from the script at its audited commit and checks the verdict's
first five lines, and SPEC states our read cost and the drain proof. Re-measured
in a scratch copy: a poster that ignores its backlog, an alarm that skips the
drain proof, and an untagged rehearsal RECOVERED notice each fail (897/898).
Selftest after the fixes: **898/898** (`.cache/r30-selftest7.log`).

**Canonical full runner: PASSED, exit 0** (`.cache/run-tests.r30.frozen.sh`,
`.cache/r30-full-pass.log`, on-chain `.cache/r30-onchain-855.log`): **855/855**
on-chain, **898/898** detector, **39/39** allocation, **22** poster, **14** PoB,
**47** launch, **6** host, **33/33** live mainnet probe, **4/4** expiry budget and
**16/16** swap fork, every floor equal to its count. Fork venues: Orca
**1,409,049** and Meteora **1,409,150** sats against oracle expectation
**1,411,481** and minimum **1,390,308** (150 bps); fork transactions, not live
money. The round-28 **71/71** simulation (`.cache/r28-sim.log`) is reused: round
30 changes no program, simulation code, fixture or dependency pin.

The coverage gate in strict mode correctly fails until round 31, which bundles
every changed file, has run and been triaged; `--prepared` passes.

## Post-commit build and rehearsal

Repairs were committed and pushed as `0d13b03`. The clean-tree post-commit
`build-mainnet.sh` passed (`.cache/r30-build-mainnet.log`, `dirty no`) and all
five dist artifacts match `.cache/r30-dist-before.sha256`. The rehearsal worktree
was refreshed at `0d13b03` (`.cache/r30-rehearsal.log`): 53 patched files, exact
reverse proof to HEAD, all five keys preserved. Nothing was built, deployed or
sent at the throwaway IDs.

Live launch dates, holder surfaces, the Phantom ceremony, the both-venue revenue
cycle and forced post-sweep recovery remain open launch obligations. Round 30
stays NOT CLEAN; rounds 31 and 32 must each be clean.
