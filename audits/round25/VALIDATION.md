# Round 25 repair validation

The first full certifying run after resumption stopped after 479 successful
assertions, before SR.5: its setup sent 100,000 lamports into a previously absent
vault wallet. The Token and System instructions succeeded, then the runtime
rejected the resulting account for insufficient rent exemption. This was a test
fixture failure, not a vault-program refusal. The same setup defect existed for
the control asset's wallet before SR.5c.

An independent read-only triage (`triage_r25_fixture`) confirmed both sites and
reviewed the remaining SR setups and later round-25 additions. Both deposits
were changed to 1,000,000 lamports, matching SR.4 and SR.13. Expectations remain
unchanged: SR.5e compares the measured starting balance, and SR.5d requires zero
after the owner sweeps. No program source or logic changed for this correction.

The interrupted inherited run and this failed run do not certify the repairs.
The fresh run after the two fixture corrections completed successfully:
829/829 on-chain assertions, 740/740 detector assertions, 39/39 allocation,
22/22 poster, 14/14 Proof-of-Burn, 35/35 launch, and six host tests (five
explicit tests plus Anchor's generated `test_id`). The live-mainnet probe ran,
passing 24/24 after walking 1,599 signatures over two pages; it was not skipped.
The runner also completed the swap fork, 16/16. At the ruled 10 SOL cap, Orca
returned 1,403,740 sats and Meteora 1,402,806 against 1,406,095 expected and a
1,385,003-sat floor (16.7 and 23.4 bps below the oracle, respectively).

Evidence: `.cache/r25-cert-suite.log`, `.cache/suite.log`; the first failed run
is retained as `.cache/r25-cert-suite-attempt1.log` and
`.cache/r25-suite-attempt1.log`. These are local verification logs, not audit
rounds; the clean-round counter remains zero.

Independent follow-up triage also confirmed a missed I3 documentation site:
SPEC still called the current confidence threshold 1% while code used 30 bps.
SPEC and the adjacent swap comment now state the per-feed 0.3% confidence check
and the 150 bps output floor relative to the oracle, without claiming a hard
true-market-price bound. No executable code changed for this correction.

The repair checklist review independently confirmed three further omissions:
N6's per-deployment SHA-256 log lines and ship-gate-5 pins W1/W4. The runner now
logs all five artifact hashes and the test wrapper's hash. These new log lines
were not in the completed runner; the current artifact hashes are separately
recorded in `.cache/r25-tested-artifacts.sha256`. The mainnet probe now checks
each reserve's exact recorded freeze authority and simulates Token-2022 ATA
creation (exact `IncorrectProgramId`) with a succeeding classic-token control.
Its fresh off-curve owner prevents an existing ATA from making the control a
no-op. Simulations are unsigned, with signature checking disabled; no key is
loaded and no transaction is sent. Independent follow-up review found no
vacuous pass in these arms. The expanded probe passed **33/33** separately
(`.cache/r25-mainnet33.log`), and its runner floor and SPEC count are now 33.
The detector suite was rerun after these changes: **740/740**.

The Test Vault simulation completed **71/71** (`.cache/r25-sim.log`). S8.0
measured 1,061 bytes, or about 1,209 with the reserved 52-byte compute-budget
pair and 96-byte separate payer. S8.1a measured **168,343 CU**. S9b landed two
redemptions atomically at a cap of two in a 444-byte v0 transaction using 30
lookup-table keys; both assets burned and both sats reached their owner.

A fresh mainnet-feature build in `.cache/n-check` was compared byte for byte
with the certified `dist/*.so` from `2b67fb1`. All five artifacts are identical.
The MINT addition is host-only tests; GOV changes comments without moving the
Anchor error sites. The separate post-commit `build-mainnet.sh` gate still has
to prove the shipped helper equals the actual suite artifact in `target/deploy`.
