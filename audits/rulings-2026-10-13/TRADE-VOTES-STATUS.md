# Vault vote disclosure source checkpoint, October 13 2026

Source implementations: Bank eb864fe (after 78939ef), Gary f70de069 (after
7fdbc22b). No public release, migration, wallet signature or capability switch
change. The previous scheduled pass is complete; this is the subsequent
owner-requested continuation after subscription access returned.

## Behavior

Orders now include a version-3 commitment to the vault's canonical ballot
history as well as identity, level and minimum reserves. Fresh confirmed GOV
reads validate discriminator, exact 74-byte record size, asset and vote PDA.
The read requires a context slot obtained after the vault/reserve reads. RPC
failure, malformed records and duplicate proposals refuse; no failed read is
reported as an empty history.

The listing/offer review verifies the displayed history against the commitment.
Every included vote can be opened in the review, with a proposal link and YES/NO
choice. The same history is shown at settlement with explicit acknowledgment
that transfers do not reset votes. A newly cast vote invalidates the standing
order before signing; reserve increases and activation still leave it valid.
Existing two-read retirement and both-party notices apply to changed history.

This is a pre-signing check, not an on-chain vote predicate. The review explicitly
warns that a vote can still land before the transfer completes. No frozen program
or economics changed. A load-balanced provider can serve different nodes; the
context floor does not prove every vault/reserve/vote read came from one slot.
Histories over 512 records refuse trading until a future
complete-review implementation supports them; they are never truncated. Empty
history is not presented as proof of eligibility on every proposal.

## Verification and review boundaries

- 21 commitment assertions and 31 real engine assertions pass, including exact
  query filters/slot, added votes, malformed flags/discriminators/lengths,
  foreign owners/assets/PDAs, duplicate votes, oversized/nonarray responses and
  unavailable reads.
- 34 browser control checks and 19 built-page account desk checks pass, covering
  all 21 fixture votes, changed disclosure, explicit review and mobile/desktop
  fit. All mutation endpoints are fixtures; these are not live-wallet acceptance.
- Gary: 95 portal assertions, six HTTP route/security groups, six adapter cases
  and TypeScript --noEmit pass. New cases cover history propagation, a vote
  between quote and authorization, and two-read retirement with both notices.
- Full offline: 1,137/1,153 assertions across 21 files plus all 34 Node cases.
  The sole failing file is the publication fingerprint gate with 16 unapproved
  bundle/style pins. This is NOT a passing release suite. Pins are unchanged.
- Generated adapter SHA-256:
  887272c641349eb94de144eabfd9369aa03cad334b79a49188bc98dfa141217b.

Claude's initial first-party subscription review found the first-20-only
consent gap, buyer-specific wording, read-slot and response-size concerns and
missing tests. These drove the follow-up source above. The original report is
preserved. Fresh triage at eb864fe/f70de069 found no remaining source blockers: the
medium and three low findings are fixed; legacy notice wording remains the
rollout gate below. Both sessions used first-party Claude Max, extra usage
disabled, no API key source and Read/Glob/Grep only, with no MCP or fallback.
The reports and sanitized provenance are committed alongside this note.
Local test output must not be represented as an auditor running tests.

## Rollout gate and remaining work

Before deploying version 3, prove zero active legacy orders against the intended
live database. This batch did not perform that live query. If there are any,
stop and prepare distinct migration/re-consent notices: existing invalid_vault
wording would be misleading for a format-only retirement. Legacy versions are
never silently upgraded to new consent.

This batch does not approve publication fingerprints. Remaining launch work
includes public sales/feed/filter/history, offer-arrival email, actual vault
movement into/out of Gary Club, staged ballot/order-notice migrations with live
role/API proofs, current-round count display, real member/wallet acceptance,
coordinated fresh app build and publication, owner ceremony signatures, and the
exact-live-Core full suite in Friday's required 24-hour window. See CHECKPOINT.md
for the previously reviewed batches and full operational conditions.
