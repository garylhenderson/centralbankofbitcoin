# Tuesday publication and readiness

Published Bank commit: `37a8c1e27a56f6ee5c48f91f60e36e75b454cfaf`.
Claude independently approved source `79f1790` and both profiles' exact bundle
fingerprints in `RELEASE-PIN-REVIEW.md`. The audit-only commit and README-only
pin commit follow the enforced review workflow. All 20 accepted pins equal the
reviewed build manifests; the installed ceremony artifact was not replaced.

Validation: all **1,153 offline assertions in 21 files plus 34 Node cases** pass.
The publication preflight passed, and the publisher backed up, installed and
byte-checked 39 files without deleting site files. The pinned public-data job
refreshed successfully and its timer remains active, now using the exact
published commit. No timer was newly armed.

Live verification covers eight page HTML files, eight app bundles and the
stylesheet. All 17 origin files match the reviewed build. At the public edge,
all nine executable/style files match exactly. Cloudflare adds its existing
analytics beacon to the eight HTML responses; removing only that exact beacon
leaves bytes identical to the reviewed HTML. Existing CSP still blocks it on
the holder surfaces; no analytics setting was changed. The first raw HTML hash
comparison correctly reported that transformation and is retained privately.

The signing service stays closed, the owner-approved a9dcaca artifact is
unchanged, and holder actions and trading remain off. No program, release
binary, charter parameter, wallet signature or upgrade authority changed.

## Production database

Gary source a0dd566d fixed the runner's refusal of the existing custom domain,
binding only the independently verified domain/project pair. The original ballot
migration installed, and a subsequent f6193af6 grant correction removed excess
Supabase backend defaults. The original applied source and receipt are preserved.
Exact catalog verification and all six real anon/authenticated/service API proofs
passed; the temporary Auth user was deleted, with SQL and Auth absence proved.

The notice migration b90a0451 installed after a fresh Claude triage of its empty
state guard and complete migration-chain tests. It passes exact live catalog
comparison plus anonymous denial and service controls; no order or intent was
created. Authenticated notice denial is catalog-only, not a separate Auth API
probe. See the adjacent sanitized verification summary. Schema refresh and the
void RPC's HTTP 204 required verification-only follow-up, never DDL replay.

Gary has 25 mocked ballot-runner cases, 20 ballot DB groups and 22 notice DB
groups passing. A fresh generated adapter matches the committed checksum
`887272c641349eb94de144eabfd9369aa03cad334b79a49188bc98dfa141217b`.

## Owner materials and remaining gates

The owner signing checklist and exact, unpublished statement 2026-8, holder
notice and X draft are in `launch/OWNER-SIGNING-CHECKLIST-2026-10-13.md` and
`launch/ANNOUNCEMENT-DRAFTS-2026-10-13.md`. Claude's pin review checked their
facts. The X draft is 267 weighted characters; the drafts have no em dashes.
Owner wording approval and a Thursday signing time are still needed.

Gary integration is proceeding separately with both switches off. Built-page
authentication tests passed with mutations intercepted; they do not establish
real-member authentication or wallet acceptance. The collection is still OPEN,
the only launch-parameter refusal, because step 10 has not occurred.

Before enablement: owner ceremony and immediate independent read-back, collection
configuration and coordinated rebuild, real member/wallet/fee acceptance, then
separate holder/trading release decisions. Friday locking still requires the
witnessed exact-live-Core full suite after Thursday noon Austin, independent
digest recording, and explicit authority-removal authorization.

Public sales/feed/filter/history, offer-arrival email, actual moves into/out of
Gary Club and current-round minted counts remain product work. This release does
not claim those are complete. All reviews used first-party Claude Max with extra
usage disabled, no API key source, no MCP and no paid fallback.
