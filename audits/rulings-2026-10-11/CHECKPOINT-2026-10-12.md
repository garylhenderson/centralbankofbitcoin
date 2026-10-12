# Correction checkpoint, October 12 UTC

Source ed02630e6515896e37119ab933ecf26c989e88be is pushed on v6.
First-party Claude closed R-1/R-2 with no source-checkpoint blocker. Its full
review is COUNTER-CLOSURE-REVIEW.md. This is not pin or signing approval.

Validation: 94 preparation tests pass. Fresh read-only two-provider preflight on
clean ed02630 passes all 34 checks (resume-preflight-ed02630.json outside repo).
Prior batch: 164 ceremony assertions, 27 Club browser scenarios, eight ceremony
browser scenarios, and clean-source hosted startup fixture pass. Full offline
suite remains blocked by 14 stale published fingerprints; other 16 files pass.
No full release pass is claimed. Live data timer remains active/successful.

Gary Club integration is pushed on cbob-d6-integration at eb80dcfc, based on
f2625c18 current main at creation. Ten CBOB test groups and full TypeScript pass.
Compiled-route HTTP tests use mocked external services. Real member, RLS and
built-app deployment acceptance are still outstanding. No production deployment.

## Explicit release follow-ups

- Existing provenance/rebuild, artifact pins, actual systemd/nginx and owner
  browser delivery gates remain. Holder actions and trading remain off.
- Claude N-2 was checked after review: expectMint, expectBurn and expectGov DO
  include initial counters. The current independent raw-account comparison masks
  those fields, while readStep checks initial values against provider A only.
  Before signing approval, run step verdicts against both providers and require
  both to satisfy the launch expectations. This checkpoint does not claim that
  counters or funding balances have already been independently corroborated.
- N-1: a pinned governance change between differing finalized slots still refuses;
  record slots and distinguish an unstable snapshot from a same-slot disagreement.
- N-3/N-4/N-5: expand pinned-field regression assertions, assert layout/profile
  program identity, and produce commit-bound preparation evidence before pins.
- Earlier F-1 through F-7 remain in RECOVERY-FINAL-TRIAGE.md. Do not mark those
  closed on the strength of the narrow counter review.

Gary requested completion/decision texts. A direct requested reply was sent via
Luna's existing Linq transport with transactional governor logging, not a model
call. Message 8bd42ac1-9013-478a-8aba-ce8b88ea6d21 contains D2/D6/D10/D13
recommendations and Thursday signing timing, including the permanent charter-date
consequence. No reply or approval has been recorded at this checkpoint.
