# Final delivery revision

Claude re-triage closes the core activation, shutdown and runtime credential
findings. This candidate additionally resolves its remaining operational items:

- A1: owner mode refuses any loaded verification timer; harness stops/reset-failed
  before owner-mode restart and in finally.
- A2/A3: root-private locks; active and rendered location configuration hashes
  checked against the installed state record.
- I1: private exclusive temp-file creation, fsync and root ownership before rename.
- I2/I3: committed operational scripts, explicit exception guards, root-owned
  execution with Python -I, seven exact source-file pins checked before mutation,
  and pushed-branch ancestry check.
- I4: runtime auth replacement holds the activation lock and requires an open gate.
- V1: harness adds startup failure, live lock contention, complete closure checks,
  unit properties, legacy route, redirect, ACME and DNS checks. Results will be
  recorded after execution; source tests do not stand in for live evidence.

Validation: six closure tests, eight activation tests and thirteen existing
artifact-build regression tests pass. Real nginx fixture validates all templates,
authentication, Authorization stripping, proxy secret handling and immediate
runtime gate closure. No immutable artifact, program or public page changed.

The installer, harness and final delta need a narrow Claude check before use.
