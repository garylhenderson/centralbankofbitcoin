# Recovery and hosted startup correction batch

Prepared October 11 Austin time; continuing October 12 UTC. Not published and not
permission to sign. Holder actions and trading stay off. The programs, release
binaries and program build configuration are untouched.

## First-party reviews and corrections

RECOVERY-INITIAL-REVIEW.md covers the first uncommitted correction batch over
ec2dbc6. B1 was confirmed and corrected: the receipt is displayed outside the
step list; in-session confirmation does not demand immediate finalization; a
refused manually entered receipt never becomes active recovery state.

B2: all page entry and step actions serialize across tabs using Web Locks, and
old step handlers refuse after a new run. The browser saves the public collection,
transaction signature and validity height before broadcast. Reloads wait for a
finalized creation receipt or finalized failure/expiry. Unknown transactions with
an account at the target address remain blocked. The independent receipt form can
recover a verified collection even if a stored hint is malformed. A checkbox gates
step 0 when the page lists unverified discovered collections.

B3: independent checks compare every byte except mutable mint supply, token amount
and collection counters. Owner, executable state, authorities, metadata, plugins
and Bank configuration remain covered. Network/configuration failures, provider
agreement failures and audited program changes have separate non-secret labels.

F1: pin approval now requires one explicit approval line for the exact reviewed
source in addition to the ancestor, added-review-only diff and committed evidence
checks. F6: successful finalized creation receipts are cached per connection and
complete identity; unavailable, failed and other-creator receipts are not cached.

HOSTED-FIXTURE-INITIAL-REVIEW.md correctly leaves V2-7 partial. The synthetic test
now defaults to clean source, records source/tool/file identities, tests the real
accepted-origin relay path against a dead loopback upstream, rejects a wrong
origin and disallowed method, and exercises root ownership, writable modes,
incorrect digest and tampered-byte startup refusals. Stdio closes before assertions.
Signal handlers clean the test's own marked fixture. Development runs are labeled
and do not satisfy a release gate. Actual systemd/nginx delivery is still required.

## Validation

- 89 preparation tests, including exact receipts, pending-send recovery, stable
  independent account comparison, source-bound pin reviews and artifact checks.
- 164 ceremony assertions.
- 27 synthetic Gary Club browser scenarios, including stale failure suppression,
  pending/lost confirmations, incorrect order identity/arithmetic and order locking.
- Eight synthetic browser scenarios execute the actual ceremony page: duplicate
  Connect, confirmed-before-finalized step 0, persistent receipt display, reload
  while pending, verified expiry, refused manual recovery and failed-send recovery.
- Root-owned synthetic hosted startup rehearsal passes. Re-run from this batch's
  clean commit for release evidence; the development log is not such evidence.

The full offline release suite still refuses the previous published fingerprints.
They have deliberately not been accepted: D6 backend integration/release checks,
exact source review and deliberate fingerprint approval remain required. No full
suite pass is claimed for this batch. The earlier complete program rehearsal at
ec8008a is retained; this batch does not certify Friday's lock.

## Remaining before signing or enabling

Independent source/dependency provenance and rebuild, immutable artifact approval,
real unit/nginx/owner-browser delivery checks, current two-provider preflight, and
owner D2/D6/D10/D13 plus timing acknowledgment remain open. No DNS or production
service was changed by these tests. D6 built-app/member integration is still open.

Nonblocking review follow-ups still carried: additional launch-created collection
warnings; standing-order lost-response recovery; cross-panel state and form reset;
stricter source environment key validation. The source pin table's old approval
record cannot authorize this new source. A later reviewed release must renew it.
