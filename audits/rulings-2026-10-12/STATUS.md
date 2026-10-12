# Owner-ruling implementation, October 12 UTC

Gary's ten answers are recorded in launch/RULINGS-2026-10-12.md. No repeat policy
approval is needed. The owner targets all holder/trading work for this week and
will personally sign the ceremony. First sale proposal proceeds through Governors
and vault-holder governance; no price has been invented or signed on their behalf.

Source checkpoint 2d55ca5 adds independent step checks at both RPC providers,
bounded retries for differing-slot setup snapshots, a separate unstable-read
result, slot evidence, layout/profile identity checks and additional configuration
field regressions. 98 preparation tests pass on clean 2d55ca5 with commit-bound
log; a fresh preflight passes 35 checks. Neither check signs or sends anything.
Claude's narrow source review is STEP-CHECK-REVIEW.md. It found no code blocker
to a source checkpoint and closed N1, N2 and N4. Its missing-evidence comments
reflect looking under /opt for logs held under /home/ubuntu; exact clean-source
preparation/preflight evidence is now copied alongside this note. N3 remains
partial: named fields are tested, but not every complement field.

Reviewer D1/D2 lacked the questions Gary answered. The ruling now quotes all
ten questions and recommendations verbatim. Question 1 explicitly asked whether
Gary Club may vote WITHOUT holder instruction; Gary explicitly said NO. This
is not a new unresolved policy choice. The review's suggested re-confirmation
is unnecessary given the actual conversation; no unattended voting is authorized.

Remaining low technical follow-ups: finalized/min-slot step reads and recorded
slots, require matching preflight step verdicts, richer persistent-disagreement
diagnostics, full pinned-field complement tests and retry-loop tests. The
post-signing initial-state verifier is intended before public charter activity,
not as an operational steady-state checker. These remain signing acceptance work.

The voting-page policy now states that Gary Club signs only holder-approved votes.
Bulk/split voting and general external-wallet connection remain implementation
work; the policy copy does not advertise those as already delivered.

D9: only the exact annual legacy weights-publisher cron was retired. Full crontab
bytes are backed up privately with mode 0600; readback equals the prior bytes
minus that one line. Core-watch and all unrelated lines remain. No jobs armed.
Untagged legacy bank jobs need coordinated replacement by the reviewed v6 jobs;
removing a watcher without replacement would violate the ruled Core-watch policy.

Technical signing provenance/rebuild, artifact fingerprints and actual private
origin/systemd/nginx/owner-browser delivery remain. Holder/member integration,
trading, all-vault/split voting and the remaining interface work are unfinished.
No production page publish, initialization, lock or holder/trading enablement.
