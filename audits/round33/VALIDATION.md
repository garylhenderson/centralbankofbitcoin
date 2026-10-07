# Round 33 repair validation

Round 33 is NOT CLEAN; quorum was met on both passes (programs 7/8, off-chain
8/8; all sixteen seats completed). Repairs cannot retroactively clear it;
consecutive clean rounds remain 0/2. The source audited was clean `18dbff6`.
Eight distinct topics: two LOW and six INFO, none above LOW, no program defect.
No live alarm entrypoint, money job, notification, deployment or lock was run.

## Repairs

- **L (off-chain L1) and INFO (off-chain D1).** `detectSweepState` matches a
  sweep against a cycle whose start is within half a cooldown of it, either side,
  so ordinary box-clock skew cannot page an honest sweep, while a thief's sweep,
  which must wait a full cooldown after the honest one (and revenue.mjs writes a
  row only once the cooldown has passed), cannot fall inside an honest window. A
  row with only an uncertain `pendingSweepSig` explains a sweep only when the
  alarm's direct `getSignatureStatuses` lookup (not the floodable walk) shows it
  landed. The overstated comment is gone; SPEC limit 10 says all this.
- **INFO (off-chain D2).** `mint.last_sweep_at` is in `WATCHED_KEYS`, so a reader
  that dropped it is reported as missing rather than read as "never swept".
- **INFO (off-chain D3).** The launch count reader matches "47 launch", with a
  planted-stale arm.
- **L (programs L1).** Road step 9 now says to read all five program-id addresses
  right before deploying and, if one was pre-funded, to use the measured recovery
  (the program keypair's Allocate and Assign, then write-buffer and a hand-built
  DeployWithMaxDataLen), and to rehearse it at a throwaway id first.
- **INFO (programs D1-D3).** SPEC REDEEMING step 1 states limit 42's measured
  sizes; DESIGN says MIN_ROUND_PRICE_SATS is compiled in; suite arm 2.1 records
  the mint's own outcome.
- **Gate 5 (suite).** R33.G1: the vault with the whole 640-byte attribute budget
  is given a 10,198-byte owner autograph and must be revealed by MINT in FIFO
  order at the default compute budget. R33.G2a/G2b: strangers (the test
  wrapper's PDAs, one more each write, via a new test-only `SIGSPDA!` mode) grow
  an autograph until Core's heap refuses the next write; the chain keeps the list,
  and MINT must reveal that vault with every kept signature. R33.G3: the royalty
  with authority None cannot be re-delegated (0x1b), control lands. R33.G4: a
  stranger's pre-created, pre-filled wSOL account closes under the swap's own
  `swapInstructions` (venue call and cbBTC create removed), returning the
  stranger's lamports to the operator. On-chain floor 861 -> 866.

## Validation

- Detector selftest: **908/908** (`.cache/r33-selftest2.log`), with the sweep
  window's both-ways boundaries at half a cooldown (21,600 and 3,600 s
  cooldowns), clock skew of +300 and -3,700 s quiet, an unconfirmed pending send
  unexplaining and a confirmed one explaining, and the watched key. Gate
  self-test **14/14**.

An independent reviewer read every repair (the new on-chain arms by reading
only, while a run was active) and mutation-tested the selftest arms; every
requested mutation failed a test. It found: (1) the sweep-cooldown premise was
backwards. A vote can only LENGTHEN the cooldown (MINT keeps the maximum, GOV
refuses a shorter one) and anyone may execute a passed proposal, so a key thief
could sweep and then execute a longer cooldown, widening the window until the
honest cycle before explained the theft. The alarm now judges with the SMALLEST
cooldown it has ever seen (persisted, rolled back with an undelivered page, never
above the ruled 6 h), and SPEC limit 10 says so. (2) The lookup body itself (the
error filter, the confirmation level, the throwing path) was untested; the
extracted fragment now runs against stubbed statuses. (3) Road step 9 understated
the dust (any rent-exempt amount, at least 890,880 lamports) and omitted the
top-up to the 36-byte rent-exempt minimum; both added, with the top-up marked as
reasoned and to be rehearsed. (4) The many-signer arm's heap check now names
Core's program. Two runs were stopped and are retained without being counted:
the first failed to compile because importing `bank/swap.mjs` into the
TypeScript suite pulled in the crank's top-level await
(`.cache/r33-suite-transform-failed.log`; the arm now loads the swap's own list
through a node child process), and the second was superseded by these fixes
after 233 on-chain checks with no failure
(`.cache/r33b-onchain-partial-superseded.log`). Selftest after the fixes:
**909/909**.

**Canonical full runner: PASSED, exit 0** (`.cache/run-tests.r33c.frozen.sh`,
`.cache/r33-full-pass.log`, on-chain `.cache/r33-onchain-866.log`): **866/866**
on-chain (R33.G1: the 640-byte-budget vault with a 10,198-byte autograph was
revealed by MINT in FIFO order at the default budget; R33.G2a/G2b: strangers grew
an autograph to 56 signatures before Core's heap refused the 57th, and MINT
revealed that vault with all 56; R33.G3: re-delegation of the None-authority
royalty refused 0x1b, control landed; R33.G4: the pre-filled wSOL account closed
under the swap's own instructions and returned the stranger's 0.5 SOL), **909/909**
detector, **39/39** allocation, **23** poster, **14** PoB, **47** launch, **6**
host, **33/33** live mainnet probe, **4/4** expiry budget and **16/16** swap fork,
every floor equal to its count. Fork venues: Orca **1,408,311** and Meteora
**1,407,030** sats against oracle expectation **1,408,269** and minimum
**1,387,144** (150 bps); fork transactions, not live money. The round-28 **71/71**
simulation (`.cache/r28-sim.log`) is reused: round 33 changes no program,
simulation code, fixture or dependency pin.

Pending: commit and push, post-commit build-mainnet and rehearsal refresh.
