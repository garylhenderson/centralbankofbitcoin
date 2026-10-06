# Round 27 repair validation

Round 27 is NOT CLEAN. Programs counted six of eight substantive auditors;
off-chain counted seven of eight, both meeting the six-auditor requirement.
The program verdict has four confirmed topics (one LOW, three INFO); off-chain
has eight (four LOW, four INFO), with the shared status-documentation topic
counted only once across the two. Repairs do not retroactively clear a round.
The counter remains 0/2.

The original findings changed operational readers/detectors, error handling,
regression fixtures and documentation. Independent triage reviewed each repair.
Four new on-chain assertions exercise PDA-owned charter claims and votes with a
separate fee payer, and a sweep-helper SOL destination owned by the token program.
They extend the previous 844-assertion suite to 848; their execution result is
recorded below when the full run completes.

The first frozen runner, `.cache/run-tests.r27.frozen.sh`, failed before the
on-chain suite when the live-mainnet probe encountered a version-1 transaction.
Its 817 detector and 39 allocation checks passed, but that attempt did not certify
the 848 on-chain assertions. The failed log remains `.cache/r27-suite.log`.

Independent investigation confirmed a MEDIUM compatibility gap in the alarm,
revenue recovery and redemption poster, beyond the probe's sampler. The separate
`VALIDATION-FINDINGS.md` records the observation, independent reproductions,
repair review and limits without changing the external round's counts.
The shared `bank/txread.mjs` now reads validated legacy/v0/v1 jsonParsed history
through the existing connection transport. No package was installed. Missing
monitoring metadata refuses progress; an actual public v1 fixture and synthetic
legacy/v0 controls exercise all three consumers. No live alarm, money operation,
notification or public post ran during these checks.

Canonical detector/integration tests passed **860/860** in
`.cache/r27-v1-selftest4.log`. The independent ten-consumer snippet also passed
before incorporation. The live-mainnet probe passed **33/33** after the reader
repair (`.cache/r27-v1-probe2.log`). These are completed standalone checks,
not a claim that the full runner has finished.

All five freshly compiled mainnet-feature release artifacts match the certified
`dist/*.so` byte-for-byte (`.cache/r27-v1-byte-build2.log`,
`.cache/r27-v1-byte-identity.log`). MINT and SEAL production edits are comments
with preserved line counts. The first standalone build attempt failed because
cargo was absent from PATH; the recorded successful attempt used the same PATH
as the build scripts. No unsuccessful attempt is counted as evidence.

The prior Test Vault simulation's 71/71 result is reused for unchanged simulation
logic and identical program bytes. Its runner's program-count comment changed;
no simulation behavior changed. No CBOB v1 transaction execution is certified;
packet sizes/default compute budgets are qualified to the measured legacy/v0
formats.

## Full validation and post-commit gates

The fresh frozen runner `.cache/run-tests.r27b.frozen.sh` completed with exit 0.
It passed **848/848 on-chain**, **860/860 detector**, **39/39 allocation**,
**22/22 poster**, **14/14 PoB**, **47/47 launch**, **33/33 live-mainnet**, six
host tests (five explicit plus Anchor's test_id), and **16/16 swap-fork**.
The runner enforces exact counts and successful exits for all categories; it
prints the detector/allocation/mainnet/on-chain/fork summaries and checks the
other captured summaries internally. Evidence: `.cache/r27b-suite.log` and the
complete on-chain `.cache/suite.log`. The frozen runner and tracked runner are
byte-identical. The mainnet probe ran; it was not skipped.

All four new on-chain assertions passed: R27.C1/C2 prove a program-owned PoB
claims through invoke_signed with a separate payer, producing a vault owned by
that PDA and consuming the PoB; R27.V1 proves the corresponding owner-program
vote; R27.S1 credits exactly 1,000,000 lamports to a token-program-owned
recipient while preserving its owner/data and emptying the source.
The census and all prior refusal, accounting and timing checks passed too.

Both fork venues passed the 10 SOL bound. Orca returned **1,405,422 sats** and
Meteora **1,404,932**, against oracle expectation **1,407,327** and minimum
**1,386,217** (150 bps tolerance). These were fork transactions, not live money.
The separate-payer charter packet remained 1,114 bytes; the four-capture mint
used 520,088 CU, and a one-capture mint used 184,094 CU with 512 slot hashes.

The final D3 sibling correction changes only the launch file's descriptive
lock-deadline source from four programs to five. Independent JSON comparison
proved all actual values, statuses and other fields unchanged. The read-only
launch checker still refuses the two OPEN dates; validation is not launch
approval and no mainnet deployment or authority removal has occurred.

Repairs were committed and pushed as `e109b31`. The clean-tree post-commit
`build-mainnet.sh` passed (`.cache/r27-build-mainnet.log`): four mainnet builds
reject the test initializer, four localnet controls accept it and reach later
checks, and the helper's shipped bytes match its fresh localnet build and tested
artifact. `sha256sum -c .cache/r27-dist-before.sha256` passed all five artifacts.
Acceptance by Gary's actual signing key is still a launch-ceremony check, not
something this server has proved without his signature.

The rehearsal worktree was refreshed at `e109b31`. Prechecks proved its old
tracked changes were exactly the recorded map, found no unrelated untracked
files or process using the tree, and verified a restricted backup of all five
keys before replacing it. The refreshed 50-file patch reverses exactly to HEAD,
and every preserved key compares equal afterward (`.cache/r27-rehearsal.log`).
This preparation did not build or send at the throwaway IDs. The live Phantom
ceremony, both-venue revenue cycle and forced post-sweep recovery remain open.

Both round-28 dry preflights passed with eight available models per pass,
sufficient context and six substantive auditors required. Round 29 was prepared
with disjoint rosters before the next possible clean round. The new reader and
public fixture are delivered in both passes. Coverage includes all 34 enumerated
system files; this prepared-bundle check is not itself a completed external audit.
Captured external reports are preserved verbatim, including their trailing
whitespace; the authored source and validation documents pass the diff check.
