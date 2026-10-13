# October 13 final source checkpoint

Historical 04:00 continuation checkpoint. Later same-day deployment evidence is
in [FEATURES-PUBLICATION.md](FEATURES-PUBLICATION.md) and
[OPERATIONS-PUBLICATION.md](OPERATIONS-PUBLICATION.md). The product gaps, database
rollout and pending publication described below have since advanced; preserve
this original record and use those later reports for current readiness.

This was Gary's one-time scheduled continuation, begun 09:00 UTC (04:00 America/Chicago), with a hard stop before 11:50 UTC. This checkpoint records source work and review only. No publication, migration against a live database, live Auth/member mutation, capability switch, ceremony activation, signature, transaction or program lock occurred. Production /opt/gary-club was not edited. No further run was scheduled.

## Committed implementation

- Bank 8e098e1: opening known/seen/consented context across receiving-account setup and bounded confirmation; explicit maximum network-fee consent that tolerates payout-driven fee changes; per-action proposal execution outcomes, close/expiry warnings, external wallet cost estimate and corrected recovery messages; private offers/notice desk and royalty destination checks. Bank 159a1c9 adds review evidence only.
- Gary 9333dd32 on isolated cbob-launch-week: custody/linked-wallet self-offer guard; caller/owner mismatch protection including inter-read races; repeated positive invalidity checks; staged durable order notices, completed-fill receipts, current recipients and stale-order scans; both-party signed-settlement visibility/recovery; released listing recipient cleanup; recipient refresh cannot lock a landed trade. Includes prior 612dec01 and 2c8fcace source batches.
- Ballot wrapper correction at ae887a60 (prior 1e9f2afe/1fe43fa2): project identity, exact source/digest/remote checks, pinned TLS CA, full catalog/privilege proof, durable evidence and recovery modes. Every receipt branch participates in the unresolved-probe gate. A never-observed create stays on manual hold; elapsed time cannot certify it. The wrapper HAS NOT been applied. Independent guarded SQL and digests are recorded in Gary docs alongside reviews.
- Generated adapter SHA-256 1182baf2785aee311866b981cb4636439f50139eccac53a8cb306929bc8d0e4f; a separate rebuild byte-compares equal. Frozen programs/, root dist/, Anchor/Cargo and RELEASE_COMMIT/config were unchanged from the starting checkpoint.

## Actual review versus tests

11 completed first-party Claude Max subscription review/triage sessions. Fresh auth/usage checks preceded each; extra usage disabled, API key source none, reviewer tools Read/Glob/Grep only, MCP empty. No limit/auth failure or paid fallback. Sanitized review provenance is in review-session-ledger.json. Original reports remain intact, including findings and stated limits.

Final source review of Bank 8e098e1/Gary 612dec01 closed G-A2/B2/N2, F1/G-C6 and F2/F5 in source. Two remaining low A2 follow-ups were fixed atGary 9333dd32 and closed by settlement-delta-review.md. Ballot N1 was closed separately by ballot-ledger-followup.md. Reviews did not run tests or independently compute hashes; Codex test/build evidence is separate. No report accepts publication fingerprints or proves live acceptance.

Verified local evidence:
- Bank: 1,117/1,133 offline assertions in 21 files; all 34 Node cases pass. Exactly 16 unaccepted bundle/style hash pins fail, sole failing file, bundle.test.mjs. NOT a passing release suite. No fingerprint pins were changed or accepted.
- Opening engine 30; proposal planner 42; governance engine 27; trade engine 16; commitment 16. Source planners run with chain-boundary fixtures.
- Gary: 91 portal checks (including real Bank source engine plus real portal authorization/race tests), 12 auth checks, 4 email-return checks, 6 compiled HTTP groups and 6 generated-adapter cases. npm CBOB runner: 10 aggregate groups passes; TypeScript --noEmit exits 0.
- Ballot: 24 mocked wrapper cases and 20 disposable PostgreSQL PASS groups. Order notices: 20 disposable PostgreSQL groups, including privileges, atomic failure rollback, concurrent settlement, recipient changes, fill/release/expiry/cancellation and unsigned abandonment. Disposable test databases cleaned up.
- Local built-page browser checks: proposal 23 and trading desk 18 at 375px/desktop, with mutations intercepted. These are not real-member or wallet acceptance. No shared validator was started.

## Remaining source work and rollout gates

1. Before trading: G-B3 public sale layer (identity-free market feed, prices/filter/sort/floors, sales history and offer counts); G-B4 offer-arrival email; G-B5 actual move-in/out flow; per-vault already-cast-vote disclosure at trade review. Private received-offer inbox is implemented. Current-round minted-count display is deferred. Existing Gary wallet collection cards have a collection allowlist; a generic link to that page does not prove CBOB withdrawal UX.
2. The staged 20261013 order-notice migration needs its own separately authorized production application and actual role/RLS/API verification. Complete recipient scanning/backfill before enabling trading; ambiguous wallet links need correction, and unlinked external owners cannot receive member notices. None of that was performed here.
3. Ballot operator work: choose an exact reviewed clean/pushed commit; independently check recorded migration, guarded-SQL and issuance digests; inspect Auth hooks/webhooks and run read-only intended-project preflight. Only in a separately authorized window may --execute create its bounded probe and apply the migration. Require exact catalog and real anonymous/authenticated/service results plus dual cleanup proof. Preserve all receipts on uncertainty; --verify-only never replays DDL. No live receipt JSON currently exists.
4. Complete real-member/session/RLS and actual wallet fee/signing acceptance, plus the genuine exact-source pin workflow for changed Bank bundles. The current 16 failures remain a release gate. The installed ceremony artifact and its earlier attestation were not replaced by these page changes.
5. Integrate the isolated Gary branch with current unrelated production work using the inactive slot workflow, then build and validate fresh output under separate publication authority. The old placeholder.next MUST NEVER DEPLOY. Commit/push before any eventual deploy script. No merge, deploy or switch enable occurred here.
6. Ceremony remains owner-signed. Prior policy rulings are preserved and need not be re-asked. Friday October 16 noon Austin lock remains conditional on the full suite using exact live Core bytes during the preceding 24 hours. Charter target is Monday October 19 noon Austin. This Tuesday source pass cannot satisfy Friday's 24-hour test window.

Final continuation and private Luna pulse carry the final repository heads and process cleanup after this documentation commit. No claim that the full launch is finished.
