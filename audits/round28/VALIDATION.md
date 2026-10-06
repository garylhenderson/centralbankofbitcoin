# Round 28 repair validation

Round 28 is NOT CLEAN; repairs cannot retroactively clear it. Consecutive clean
rounds remain 0/2. The source audited was clean `93f8c36`. The off-chain pass
finished with six of eight substantive reports and seven confirmed findings
(one MEDIUM, four LOW, two INFO). The programs pass finished with five of eight substantive reports (six required)
and five confirmed findings (one MEDIUM, one LOW, three INFO). Runtime-log
truncation and stale SPEC status overlap: ten distinct confirmed topics overall
(one MEDIUM, five LOW, four INFO).

All repairs were prepared in an isolated worktree while external auditors read
unchanged MAIN. Independent triage checked confirmed findings before changes.
No live alarm entrypoint, money job, notification, deployment or lock was run.

## Completed draft checks

- Detector/integration checks: **888/888**, `.cache/r28-draft-selftest6.log`.
  Draft execution redirected hardcoded repository reads into the draft; this is
  not the canonical full-runner result. New checks exercise exact runtime log
  truncation in all three readers, chain/wall clock separation, timer migration
  and failed-delivery retry, rotating 150-problem heartbeats, retained redemption
  evidence and actual rehearsal substitution with an omission counterfactual.
- All five freshly built mainnet-feature release binaries are byte-identical to
  `dist/*.so`: `.cache/r28-byte-build.log`, `.cache/r28-byte-identity.log`.
  Production Rust changes are comments with preserved line positions.
- Mainnet Classic Token, Token2022 and ATA byte pins loaded successfully and
  compared exactly after startup. A one-byte cached ATA mutation is refused and
  not overwritten (`.cache/r28-pin-negative.log`). These snapshot pins are not
  protection against future upstream upgrades.
- Durable expiry-budget test: **4/4**, exit 0, `.cache/r28-draft-expiry2.log`.
  Twenty distinct synthetic due-boost records execute actual MINT at the default
  legacy budget: **103,976 CU / 870 bytes**; the raised-budget control uses
  **104,126 CU / 910 bytes**. The landed default transaction clears all twenty
  boosts and conserves aggregate base weight. This is synthetic genesis evidence,
  not twenty complete mint/boost lifecycles. The earlier draft passed its checks
  but retained an SDK websocket after cleanup and was terminated; only the fixed
  polling-confirmation run is counted as a completed gate.
- Coverage enumeration includes both new files and JavaScript tests: **36**
  enumerated files. This is prepared bundle coverage, not completed future audits.

## Canonical validation

Canonical detector checks passed **888/888** (`.cache/r28-main-selftest.log`,
and again on the final documentation text, `.cache/r28-final-selftest.log`).

Three full-runner attempts failed and are preserved; none is counted as a pass.
Each passed 137 on-chain assertions, including the 10,150-byte owner Autograph
write and the actual FIFO-head reveal through all five owner plugins, and then
failed in fixture cleanup. Run one: Core `RemovePlugin` (of the small
FreezeDelegate) exhausted its heap (`.cache/r28-suite.log`,
`.cache/r28-first-onchain-failed.log`). Run two: editing the existing message was
refused with `0x29 InvalidPluginOperation`, which Core's Autograph rules require
(`.cache/r28b-suite.log`, `.cache/r28-second-onchain-failed.log`). Run three:
clearing `signatures: []` passed authorization, then UpdatePlugin exhausted the
heap at 27,476 CU (`.cache/r28c-suite.log`, `.cache/r28-third-onchain-failed.log`).

Resolution, measured rather than assumed: the pinned Core uses the default
entrypoint's fixed 32 KiB heap, and a requested heap frame does not change it
(isolated probe `.cache/r28-recovery-probe.mjs`, `.cache/r28-recovery/`). On the
revealed real vault Core cannot shrink the asset at all. This is an upstream
size boundary and is now pinned rather than worked around: R28.A2 asserts the
heap refusal with level, seal and message unchanged; R26.P7 asserts both owner
freezes still thaw; R28.A3 and R28.A4 simulate a transfer and the complete
redemption (SEAL open, Execute sweep of its funded cbBTC, BURN) on that real
vault, both succeeding without changing it. The vault then keeps the autograph
and all five plugins through the rest of the suite. An independent reviewer
required the real-shape A3/A4 evidence after the probe's simpler asset proved
able to remove FreezeDelegate where the real vault could not. SPEC item 40 and
the holder guide now state the boundary and its limits. Details:
`VALIDATION-FINDINGS.md`.

**Canonical full runner: PASSED, exit 0** (`.cache/run-tests.r28e.frozen.sh`,
`.cache/r28e-full-pass-855.log`, on-chain `.cache/r28e-onchain-855.log`):
**855/855** on-chain (floor 855 = 848 + frozen destination 3 + autograph A1-A4),
**888/888** detector, **39/39** allocation, **22** poster, **14** PoB, **47**
launch, **6** host, **33/33** live mainnet probe, **4/4** expiry budget and
**16/16** swap fork. Every validator in the run reported all three token
programs matching the pinned mainnet bytes. The frozen 15% destination refuses
the split with Token `0x11` and leaves revenue and both destinations unchanged
(R28.F1/F2). Fork venues: Orca **1,400,902** and Meteora **1,400,725** sats
against oracle expectation **1,405,348** and minimum **1,384,267** (150 bps).
These were fork transactions, not live money. An earlier green run of the same
code before A3/A4 existed (853/853, `.cache/r28d-full-pass-853.log`) is retained
as supporting evidence only.

A separate INFO validation clarification scopes the third fallback layer to
monthly distribution. Activation, joining and delivery require explicit calls;
ordinary traffic does not complete every crank task. See `VALIDATION-FINDINGS.md`.

**Fresh Test Vault simulation: PASSED, 71/71, exit 0** (`.cache/r28-sim.log`).
Its validator also reported all three token programs matching the pinned mainnet
bytes, so the simulation now covers the round-28 Token2022/ATA dependency change;
the round-27 simulation was not reused.

## Post-commit build and rehearsal

Repairs were committed and pushed as `de3d56f`. The clean-tree post-commit
`build-mainnet.sh` passed (`.cache/r28-build-mainnet.log`, `dirty no`): four
mainnet builds reject the test initializer, four localnet controls accept it,
and the sweep helper's shipped bytes match its localnet build. `sha256sum -c
.cache/r28-dist-before.sha256` passed all five artifacts. Acceptance by Gary's
actual signing key remains a launch-ceremony check.

The rehearsal worktree was refreshed at `de3d56f` with the prepared
key-preserving script (`.cache/r28-rehearsal.log`). Prechecks proved its prior
changes were exactly the recorded map with no unrelated files or process, and a
restricted backup of all five keys was verified first. The refreshed 52-file
patch, now including `launch/create-cbob-token.mjs`, reverses exactly to HEAD,
and every preserved key compares equal afterward. Outside the patch, original
program IDs remain only in SPEC's documentation. Nothing was built, deployed or
sent at the throwaway IDs.

## Remaining

Live launch dates, holder surfaces, the Phantom ceremony, the both-venue revenue
cycle and forced post-sweep recovery remain open launch obligations. Round 28
stays NOT CLEAN; the next frozen rounds (29, then 30) must each be clean.
