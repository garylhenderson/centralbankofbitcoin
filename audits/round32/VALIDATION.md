# Round 32 repair validation

Round 32 is NOT CLEAN; quorum was met on both passes (programs 6/8, off-chain
7/8). Repairs cannot retroactively clear it; consecutive clean rounds remain 0/2.
The source audited was clean `dee953e`. Eight distinct topics: five LOW and three
INFO, none above LOW, no program defect. No live alarm entrypoint, money job,
notification, deployment or lock was run.

## Repairs

- **L (off-chain L1).** `detectSweepState` judges MINT's `last_sweep_at` every pass:
  a newer sweep, once past a 15-minute grace, needs a revenue-ledger cycle that
  recorded a sweep (confirmed or uncertain) within an hour of it, or it pages
  `sweep_unledgered_state` CRITICAL. Read from account state, it cannot be delayed
  by flooding the transaction scan. The first pass takes a baseline.
- **L (off-chain L2).** A transaction read that throws, and a signature listing
  that throws, are reported per item as `tx_unreadable`; the cursor holds and the
  pass finishes, so its other findings are delivered.
- **L (off-chain L3).** `detectLogGaps` never drops an unreviewed gap; only the
  reviewed prefix is trimmed (keeping the watermark), and more than 2,000
  unreviewed gaps escalate the finding to CRITICAL with its own text. The review
  instruction says to write the LAST signature listed.
- **L (off-chain L4, programs L1).** The coverage gate credits a focus only from a
  headline naming that focus, even in a combined `VERDICT.md`, and finds a
  FOCUS-split TARGETS list by its shape, failing closed if the split cannot be
  found. Its self-test has 13 both-ways cases; the new parser gives identical sets
  for every real round script 19-33.
- **INFO.** The selftest now checks every SPEC statement of the expiry-budget
  count and that `tests/expiry-budget.mjs`'s own count equals `EXPIRY_FLOOR`;
  three DESIGN sentences corrected (mint index in the record, claim-before-burn
  and retire, `*_stopped` fields); SPEC limit 10, limit 25, the reader boundary
  and the gap cost restated.
- **Ship-gate 5 (suite).** Six on-chain arms: R31.W1a (10,199-byte autograph
  refused by the RUNTIME; the test wrapper's own guard was raised above the CPI
  limit so it is not the thing refusing), R28.A1 now writes the 10,198-byte
  maximum, R31.W1b (a stranger's own signature alone refused 0x28), R31.W2a (a
  pre-funded SEAL config PDA still initializes), R31.W2b (a pre-funded record PDA
  and reserve address: mint and a non-idempotent create land), R32.A22a/b (on a
  Moments-shaped collection the update authority's transfer and burn are refused
  0x1a; owner controls land). On-chain floor 855 -> 861.

## Validation

- Detector selftest: **906/906** (`.cache/r32-selftest3.log`). New arms: the sweep
  state both ways (explained, uncertain, unexplained, fresh, baseline); 600 cheap
  gaps cannot evict an unreviewed one, review trims only the prefix, a flood
  escalates; a throwing read and a throwing listing each become `tx_unreadable`
  with the cursor held and all four programs visited; the gate's 13 cases; the
  expiry-budget counts.

An independent reviewer read every repair, reviewed the new on-chain arms
without running them, and mutation-tested the rest in a scratch copy: all five
requested mutations failed a test. It found, and these were fixed: (1) the sweep
baseline and its undelivered rollback were not pinned, and the matching window
was symmetric and an hour wide, so at a short cooldown a thief's next legal sweep
could read as explained; the window is now one-sided (cycle start - 120 s to
start + min(1 h, cooldown/2)), a missing baseline is MINT's initial 0, boundary
arms cover both sides and a 3,600 s cooldown, and the persistence lines are
pinned; (2) the never-drop gap list deduped in O(n^2), letting a paid flood slow
every pass; it uses a Set and SPEC states the growth bound; (3) a FOCUS header
in an unrecognised form fell through to crediting both foci; it fails closed (14
gate cases); (4) R31.W1a did not check WHY 10,199 was refused, so it would also
pass if our wrapper refused; it now requires the runtime's own "too large (10241
> 10240)"; (5) stale SPEC texts (10,150, the reschedule page, the scope of
"finishes the pass", the sweep check seeing only the latest sweep). A first full
run of the new arms (`.cache/r32-onchain-partial-superseded.log`, stopped after
307 on-chain checks with no failure to rerun the final code) already measured
all six gate-5 arms passing, including the runtime's refusal text.
Selftest after the fixes: **907/907**.

**Canonical full runner: PASSED, exit 0** (`.cache/run-tests.r32b.frozen.sh`,
`.cache/r32-full-pass.log`, on-chain `.cache/r32-onchain-861.log`): **861/861**
on-chain (all six gate-5 arms measured: the runtime's own "too large (10241 >
10240)" refusal, the 10,198-byte maximum, 0x28 for a stranger's signature, the
pre-funded config, record and reserve addresses, and 0x1a for the update
authority with owner controls), **907/907** detector, **39/39** allocation, **23**
poster, **14** PoB, **47** launch, **6** host, **33/33** live mainnet probe, **4/4**
expiry budget and **16/16** swap fork, every floor equal to its count. Fork venues:
Orca **1,413,681** and Meteora **1,413,381** sats against oracle expectation
**1,416,848** and minimum **1,395,595** (150 bps); fork transactions, not live
money. The round-28 **71/71** simulation (`.cache/r28-sim.log`) is reused: round
32 changes no program, simulation code, fixture or dependency pin (the test-only
CPI wrapper is not in the simulation).

## Post-commit build and rehearsal

Repairs were committed and pushed as `ec4a0e1`. The clean-tree post-commit
`build-mainnet.sh` passed (`.cache/r32-build-mainnet.log`, `dirty no`) and all
five dist artifacts match `.cache/r32-dist-before.sha256`. The rehearsal worktree
was refreshed at `ec4a0e1` (`.cache/r32-rehearsal.log`): 55 patched files (the
prepared round-33 script also names the program IDs), exact reverse proof to
HEAD, all five keys preserved. Nothing was built, deployed or sent at the
throwaway IDs.

Live launch dates, holder surfaces, the Phantom ceremony, the both-venue revenue
cycle and forced post-sweep recovery remain open launch obligations. Round 32
stays NOT CLEAN; rounds 33 and 34 must each be clean.
