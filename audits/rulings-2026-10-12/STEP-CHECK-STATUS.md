# Ceremony verification checkpoint, October 12

Runtime source: `a07a510371e7cad75b52850c7b8f0bd159fc7790`.
Test/runbook follow-up: `3629ddef29965f51eca7f2e0600bcfb6d8f0b93c`.

Finalized account reads now record their actual slots and cannot precede the
agreeing setup snapshots. Both providers must report the same step verdict;
a disagreement gets one retry. Snapshot mismatches record account indices,
retry at most three times, and distinguish persistent cross-slot disagreement.
All currently pinned layout fields have complement-loop regression checks,
and a separate literal allowlist prevents accidental expansion of the counter
mask. The after-signing command documents and gates its initial-state window.

First-party Claude subscription review: `STEP-CHECK-FOLLOWUP-REVIEW.md`.
No blockers in this scope. No OpenRouter calls. G1 was subsequently fixed in
tests; G2 operational guidance was added. Those follow-ups changed no runtime
source and were tested locally, not re-reviewed by Claude.

Evidence:
- `step-check-a07a510.log`: clean source identity, 76 node tests and 164 ceremony
  assertions passing on the reviewed runtime commit.
- `step-check-3629dde.log`: clean source identity, 77 node tests and 164 ceremony
  assertions passing after the test/runbook follow-up.
- `step-check-preflight-a07a510.json`: 35 live read-only checks passed against
  independent providers at 14:05:46 UTC October 12. No keys/signatures/sends.
- Git diff from previous checkpoint bbfc6dc confirms no changes to web/, bank/,
  programs/, release dist/, Anchor.toml or Cargo files. No artifact was rebuilt,
  so this is source evidence, not a newly measured bundle fingerprint.

The review could not find these fresh logs because they were then outside the
repo and their exact paths were not in its prompt. Its missing-evidence notes
are superseded by the attached logs, not by a claim it reviewed those logs.

Remaining low/informational findings (no unsafe acceptance found):
- G2 diagnostic: earlier operator activity can still produce the generic broken
  verdict; the runbook now explicitly keeps those actions dormant.
- G3: a step retry uses the snapshot floor rather than the newest first-attempt
  read slot; provider lag may cause a safe refusal and require another run.
- G4: stale read rejection lacks a retained per-read diagnostic.
- G5: initial time-window check reads one confirmed clock; per-provider initial
  state checks remain independent and finalized.
- G6: full verifier orchestration still needs injected-provider coverage; pure
  helpers, existing real readStep regressions, and live preflight are covered.

No publish, program edit, signature, production migration or switch change.
Holder actions and trading stay off. This does not approve release fingerprints,
the private hosted artifact, owner delivery, signing or the program lock.
Next: dependency provenance/frozen independent rebuild and private signing
installation/delivery, real Phantom/member acceptance, proposal creation and
remaining trading flows. Previously settled policy questions stay settled.
