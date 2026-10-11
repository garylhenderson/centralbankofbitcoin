# Operator evidence for the inert signing build and prelock rehearsal

No public publication, ceremony installation or signing is proposed by this
record. Live site/data remain 7298f12. Owner signing decisions remain pending.

- The current-source preflight at cb9f656 passed all 34 checks after bounded
  same-request retries were added. Two providers agree on live program identities
  and the widened setup/mint/account reads. No collection is initialized yet.
- All 58 preparation tests pass. The bank detector suite passes 1091/1091.
- The real Python sealer was exercised with a deliberately ineligible fixture,
  including non-UTF-8 bytes. Its digest agrees with JS, a second identical archive
  call succeeds, and files/parents have the intended root:ubuntu 0440/0550 and
  root 0755 modes. The fixture is explicitly status=fixture, never certification.
- This actual exercise exposed a server-layout issue missed by the pure tests:
  `.cache` is a long-standing symlink to `/scratch/cbob-vaults-cache`. Receipt
  validation now pins that exact canonical target rather than rejecting all real
  runs. The signing installer also checks the canonical candidate target.
- An actual isolated build exposed esbuild's location-dependent generated
  module labels. The builder now normalizes only those generated comments and
  commonJS wrapper labels to the canonical repository path, preserving disabled
  module tags. All 20 mainnet/local script and style fingerprints compare equal
  between root and isolated builds AND to the reviewed 8d493bf candidate. No
  canonical output byte changed from this normalization.
- Candidate staging now uses the same scratch filesystem as the destination,
  so final rename is atomic. Logs are retained; no broad recursive deletion is
  used. Failed or dirty worktrees are retained for diagnosis.
- Pin provenance now requires the review to name its full source commit. That
  source may differ from the pin-record source only by the review file itself;
  the build commit may differ from the pin-record source only by web/README.md.
  NUL-separated, no-rename diffs enforce both boundaries. Every changed pin must
  occur in the review, and both ceremony hashes must always occur there.

The ten changed fingerprints from the earlier pin review remain unchanged.
For each of the eight holder bundles, removing exactly the one generated
RULED_DATES declaration reproduces its prior published hash. This is a measured
byte comparison. The full before/after pairs follow in the pin evidence file.

Remaining signing gates are not claimed closed: dependency provenance/snapshot
and independent build, exact-creation-signature recovery, final hosted-path
test and delivery script, day-of chain reads, origin/env checks, and owner
D2/D10/D13/timing. Inert candidate and full rehearsal only.
