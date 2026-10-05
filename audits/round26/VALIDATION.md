# Round 26 repair validation

Round 26 is NOT CLEAN, with programs quorum 5/8 (six required) and off-chain
quorum 6/8. Repairing a finding does not retroactively clear the round. Both
independent verdicts describe the audited `93d04fe` tree and every exclusion.

The repairs change off-chain tools, fixtures and documentation; no program
source, Cargo configuration or simulation source changed. The previous
71-assertion Test Vault simulation remains evidence for those unchanged files
and program bytes, not a new simulation run.

Independent repair review checked the cap interval, five-level fixture bound,
Core plugin integration, second-source reason pin, notice ownership, launch
detector wiring and rehearsal refusal. It caught an incomplete-census false
recovery in the initial reconciliation draft. Remeasurement of the actual
reconcile/report functions proved that the corrected version retains history
on incomplete coverage and recovers it after a later complete scan, without
touching the main watch's failure marker. No live alarm entrypoint was imported.

The repaired detector suite passed **789/789** (`.cache/r26-selftest.log`).
Launch self-tests passed **47/47** (`.cache/r26-launch.log`), including eleven
new imported-detector refusal arms and unknown-field rejection. Shell tests
use synthetic directories and stubbed commands; no production crontab was read
or written. Revenue tests extract handlers with stubbed sends and notification
delivery; no live money operation or notification was sent.

The full frozen validator runner completed successfully (exit 0): **844/844**
on-chain, **789/789** detector, **39/39** allocation, **22/22** poster,
**14/14** Proof-of-Burn, **47/47** launch, and six host tests (five explicit
plus Anchor's `test_id`). The live-mainnet probe actually ran **33/33**, walking
1,599 signatures over two pages. Evidence: `.cache/r26-suite.log`,
`.cache/suite.log` and the runner's individual self-test logs. The frozen runner
compares byte-identically to `scripts/run-tests.sh`.

The 15 new on-chain assertions all passed: six cap-bound checks, seven
owner-plugin checks, one eligibility-bound check and one refusal-reason check.
The census filled exactly 21 of each level, with 20 excluded fixtures and all
five payout levels represented. RL.7 replayed 18 redemptions using exact
certified caps of one or two; no window exceeded its applicable cap.

The embedded swap fork passed **16/16**. At 10 SOL, Orca returned 1,403,675 sats
and Meteora 1,402,806 against oracle expectation 1,407,003 and on-chain minimum
1,385,897 (150 bps tolerance). These are fork transactions, not live revenue
operations. The separate-payer/depth-eight charter packet measured 1,114 bytes;
the full four-capture mint measured 523,088 CU, and a one-capture mint measured
187,094 CU with 512 slot-hash entries.

Post-commit mainnet build and rehearsal refresh are pending and will be recorded
before the next external audit starts.

Round-27 dry preflight passed for both focuses, with eight available model IDs
per pass, sufficient context and a required six substantive auditors. Round 28
is prepared with a disjoint roster before round 27; its missing round-27
verdict inputs will be supplied by that audit, not invented in advance.
