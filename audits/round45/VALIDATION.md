# Round 45 repair validation

Round 45, the confirmation of round 44's repairs and the new box-signed
rehearsal driver, is **LAUNCH-CLEAN on both passes, quorum met** (programs 6/8,
off-chain 7/8; both audited `0d58d4e`). Same-prompt re-runs: GLM 5.3 and MiMo
(programs, cut off by provider output limits), Fable 5.1 (off-chain, provider
failure) and Qwen 2.4T (off-chain, a 385-character non-report); first-run
manifests and failed outputs are kept. No confirmed finding in (a)-(d); both
triages re-checked rounds 41-44's 24 confirmed findings and all stand outside.

## Repairs

- **Driver, V45-1..V45-11 (`7a1a683`).** A throwaway `deployer` key is the payer
  and upgrade authority of every rehearsal deploy and close; the deploy wallet only
  funds it, so the real programs' upgrade authority never signs a rehearsal step.
  Every deploy first proves its program keypair is the recorded throwaway id and
  not a mainnet id; only buffers recorded by the run are closed. No RPC provider
  key in any argv (a 600 config file, deleted on exit). Item 22.4 waits out the
  alarm's 60-minute grace and requires `unreconciled_swap`; 22.5 passes only on a
  true/false `burnt`; the rescue re-reads after a lost confirmation; revenue cycles
  count by cycles closed per venue; preparation runs before the deploys, and no
  step after `verify-configs` runs until it passes. The two selftest arms that
  failed inside every rehearsal tree compare through the tree's `.rehearsal-map`.
- **Off-chain, V45o-1..V45o-6 (`e7c192a`).** A null SEAL reserve read is UNKNOWN in
  the alarm's ATA maps and the reconcile (no false CRITICALs); the rehearsal
  switches are refused at LOAD outside a recorded tree, before any read or send;
  the frozen-pool overdue text; the unreadable retry count survives a flood (2
  passes in every shape measured); the coverage freeze message; the crank's floor
  wording. V45o-7 (prompt repetition, pass split) is carried to the next round's
  script.
- Each fix was shown red when reverted, in path-rewritten copies (driver: 14
  mutations; off-chain: 6). Local-run keys from the earlier driver proof were
  archived after confirming none had any mainnet account.

## Validation (all at `e7c192a`)

- Offline: detectors **1032/1032**, web **695/695**, launch 68/68, poster 24/24,
  allocation 39/39.
- Canonical run (`.cache/e7c192a-suite.log`, `CBOB_SHIP_GATE=1`): **RC 0**. On-chain
  **912/912**, mainnet probe 35/35, swap fork 16/16. Pages end to end
  (`.cache/e7c192a-web-e2e.log`): **132/132**. Test Vault simulation
  (`.cache/e7c192a-sim.log`): **71/71**.
- **Item 53, re-proven at the release commit:** the full certifying runner inside
  the recorded rehearsal tree (`/tmp/claude-1000/rehearsal-proof-e7c192a.log`):
  RC 0; program source equals `RELEASE_COMMIT` under the recorded id map; 1032
  detectors, 912/912 on-chain, 16/16 swap fork.
- **The driver, end to end on a local chain** (`/tmp/claude-1000/driver-local-e7c192a.log`,
  record `.rehearsal-run/local-state-e7c192a.json.record.md` in the rehearsal tree):
  RC 0. Item 22.1 PASS at 5 vaults (scale not exercised), 22.2 PASS; 22.3-22.5 need
  mainnet (the real pools, a live Pyth price, DAS). 14.05 SOL out, 13.94 back after
  every program closed: **net 0.105 SOL** at the local rent rate (mainnet's is
  about 27% lower).

## Open before road step 9

The strict coverage gate names 12 files changed since round 45 read them (the
repairs above). Whether a round 46 audits them before the mainnet deploy is put
to Gary. The five programs are unchanged since round 27.
