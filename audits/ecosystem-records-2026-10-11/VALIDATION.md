# Bank decisions, opening records and independent design review

October 11, 2026. This release adds `/governance/` and `/history/`, a read-only public
governance publisher, and a custodial cast-vote adapter. It refines the homepage,
Gary Club Bank authentication, shared navigation and mobile record hierarchy.

The design review used fresh first-party Claude sessions on 375px and 1440px screenshots.
Changes applied: all five vault specimens on the front door; fewer competing calls to
action; honest pre-issuance totals; consistent Market/Numbers/Votes/History/Your vaults
navigation; records before explanatory rules; prominent "Had they waited?" comparisons;
state stamps; share/download actions; compact authentication artwork.

## Security and correctness review

First-party Claude reports and independent triage remain server-private in
`/home/ubuntu/cbob-ecosystem-audit/`: `governance-review.md`, `governance-triage.md`,
`governance-final-delta.md`, `governance-delta-verification.md`,
`independent-design-review.md`, and `independent-design-final.md`. No OpenRouter.

The final full triage found no blocker to publishing with actions disabled and collection
uninitialized. It reconfirmed accepted Gary Club custody. A custody-approval discrepancy
monitor is a possible operational enhancement; it is not a new signing-authority rule.
No notification or alarm jobs were added or armed by this release.

Corrections include retained reviews during polling, all entry controls disabled during
confirmation, completed vote exclusion while the public register catches up, distinct
account-outage rendering, exact readable action amounts, summary-to-click binding,
guardian-removal and restart timing, explicit custody disclosure, and session activation
state. Canonical accepted consent IDs, member, session hash, effect hash and confirmation
time persist before signing. Proposal tally changes do not invalidate the selected vote.

## Verification

- 981 offline assertions across 16 files, including 36 governance decoding/index tests
  and 13 engine tests. Instruction bytes match the existing suite implementation.
- Custodial vote fixtures cover current ownership, snapshot boundary, prior vote,
  deadline, executed proposal, PDA identity, changed choice, guardian removal, and
  burned/retired refusal. No real vote was submitted.
- Gary Club auth/portal/runtime/email fixtures (9 groups) and TypeScript.
  Missing consent refuses a signature; approval metadata persists before broadcasting;
  unknown client-supplied consent IDs are omitted from the audit record.
- Synthetic browser records at 375/1440: archives, readable Yes/No review, consent,
  polling, pending confirmation, recovery to proposals, disabled actions, account outage,
  opening filters and deep links, PNG contents, genuine empty versus unavailable states.
  All account mutations were intercepted. No personal test account or email was used.
- Homepage/login/signup/recovery layouts at both sizes: no horizontal overflow, missing
  images or JavaScript exceptions. Consent uses the browser's real Origin/CSP navigation
  with intercepted responses. Share-card buttons and downloads are exercised separately.
- Existing market review/browser checks cover retained consent, focus, observed exports,
  and missing/bare-burn payout labels. Dashboard checks passed before the record additions.
- Issued statements, Schedule and Purposes text equal the prior git version after removing
  shared navigation and stylesheet links. Local script/style SRI matches its bytes.
- Generated adapter uses pinned esbuild 0.25.0, bs58 6.0.0 and base-x 5.0.1. Release procedure
  rebuilds it from the committed Bank tree and byte-compares before Gary Club deployment.

## Limits and launch state

Proposal creation/execution are not implemented in this UI. The new engine build/sign/cast
path has not been landed on a validator; the offline and browser fixtures are not that
certification. The public index currently scans every governance account and ships one
JSON snapshot. Future scaling needs pagination. Status is evaluated at the server's
observation timestamp, which can differ slightly from chain time near a deadline. The
server rechecks the chain deadline before preparing/signing. Delayed data is labelled;
publisher failures retain the prior file and set a nonzero exit, without a new alert route.

The mainnet collection remains null and Gary Club financial actions remain disabled.
No frozen program or pinned release binary changed, no funds moved, no date was ruled,
and no initialization, final lock, distribution, alarm or revenue action ran.

Before activating financial actions, the prior adapter retry/opening/order findings in
`../ecosystem-journey-2026-10-11/VALIDATION.md` still require resolution and verification.
This release does not mark those launch gates complete.
