> Historical checkpoint. The October13 source/review continuation is recorded in [the current checkpoint](../rulings-2026-10-13/CHECKPOINT.md). No live rollout is implied.

# Governors' desk source checkpoint, October 12 2026

This is implementation and test evidence, not an independent audit or release
approval. Claude's first-party subscription reported its weekly limit during
the ballot installation review. Gary was notified. No OpenRouter or paid API
fallback was used. The new source has not been published.

## Implemented

The voting room now includes a sale-round composer and a review action for
passed proposals. Gary Club remains the default. The visible external-wallet
option uses Wallet Standard. No price, proposer, ballot assignment or sale
schedule is selected on the holder's behalf.

The composer takes a live owned vault, exact cbBTC price, vault cap, voting
deadline and sale dates. Dates explicitly mean Austin time, including DST;
missing or repeated DST times refuse. It explains the separate activation
deposit and 85/15 revenue split. The form freezes while the holder reviews it.
Filing does not cast votes. Execution is a separately reviewed transaction.

Both paths share frozen-protocol instruction builders and live checks for
charter close, voting duration, ownership, collection, live supply, next proposal
address, execution outcome and expiry. A changed proposal counter, electorate,
fee or execution setting requires another review. Key changes retain the
existing separate warning. No program, release binary or ceremony artifact
changed. Creation currently supports sale rounds; execution displays every
existing proposal action and warns that superseded actions can be skipped.

External signing uses the existing exact-transaction guard, Web Locks and a
saved receipt before broadcast. An ambiguous result cannot cause an automatic
new signature. Corrupted receipts remain available for recovery. Gary Club
uses its existing approved-intent and signature-persistence path; both new
named actions belong to the holder lane, independently of trading.

## Tests and limitations

- Sale planner: 28 assertions, including byte/account equality with builders
  extracted from the frozen on-chain suite, negative ownership/state cases,
  exact closing boundaries, decimal precision and DST.
- Real server engine: 26 assertions, including ten new proposal/execution
  effect and acknowledgment checks.
- New receipt and external-signing cases: 12 pass. Mocked signing exercises
  consent, changed terms/fees, storage failure, tab locks, interrupted sends,
  repeat review and definitive recovery. These are not Phantom acceptance.
- Browser: 21 checks against the built page, at 375px and desktop. Covers
  account choices, closed holder lane, terms, exact review, consent, changed
  server price, execution entry and layout. All account/data/mutation endpoints
  are intercepted. No live account, signature or transaction was created.
- Full offline runner: 1,040/1,056 assertions pass across 18 files; all 32
  additional Node cases pass. The sole failing file is the fingerprint gate:
  16 deliberately unapproved bundle/style mismatches. This is NOT a passing
  release suite. Published pins remain unchanged pending Claude review.
- Gary Club integration: 49 portal assertions and six generated-adapter cases
  pass; TypeScript exits 0. The integration branch remains undeployed.

Browser harness: `web/test/browser/proposal.cjs`. Serve a fresh build locally
and set `CBOB_BROWSER_ORIGIN` and `CBOB_BROWSER_CDP` if different from its defaults.
Evidence logs are preserved beside this status. The browser intentionally does
not substitute for real member/RLS acceptance or a live wallet rehearsal.

## Next release gates

1. First-party Claude review and independent triage of this exact source, the
   generated Gary adapter and the separately staged ballot install wrapper.
   Do not accept published fingerprints using this status note as an audit.
2. Install the previously reviewed ballot migration only after the operational
   wrapper is reviewed; prove actual anonymous/authenticated/service access and
   cleanup. The wrapper's local tests do not apply the migration.
3. Complete real-member acceptance and actual-wallet fee/transaction checks;
   coordinate the Bank pages, RPC proxy and Gary Club publication, using the
   ordinary audited pin workflow. Both capability switches remain off.
4. Finish trading findings and holder surfaces. The step-10 owner signing
   appointment and the required exact-live-Core suite before Friday's lock
   remain separate gates. This batch does not certify launch readiness.
