# Trading source checkpoint, October 12 2026

Implementation and local verification only. Gary authorized continuing in Codex
without Claude while the first-party subscription is unavailable. We chose
that option; no 4:00 AM Austin restart was scheduled. No Claude, OpenRouter or
paid API fallback was used in this batch. This is not an independent audit.
Nothing in this batch is published and both live capability switches remain off.

## Changes

Audit A2: standing orders now bind a versioned vault identity, drawn level and
minimum amounts of the three known reserve tokens. Additional deposits, claims,
and activation transitions leave the authorization valid. Reduced reserves,
frozen accounts, wrong token ownership, changed NFT ownership, retirement or
burning refuse preparation. Fresh checks precede confirmation. The effect hash
uses the reviewed minimums, so harmless balance growth does not invalidate a
prepared transaction. Old opaque hashes require a new explicit authorization;
there is no silent migration of old consent.

Listing and offer review show the level, exact reserve minimums, payment split
and Austin expiry before authorization. The confirming member's review shows
the minimums again. These are off-chain checks immediately before signing;
this change does not add an on-chain reserve predicate or change any program.

A verified invalid-order error retires an active order before another signature.
RPC errors preserve the order. The database settlement locks and recovery path
remain in control of an in-progress transaction.

Audit G-A3: active offers are checked against current bidder SOL balances using
bounded batches. Unfunded offers disappear from counterparties' views while
remaining cancellable by their bidder. Adding enough SOL makes them visible
again. No money is reserved. An unavailable funding read is explicitly unknown,
not a zero balance: unverified offers cannot be accepted through the page, and
a member can still see and cancel their own orders. The existing reconciliation
worker expires active orders but leaves settling orders to transaction recovery.

## Verification

- 16 commitment checks and 16 real server-engine checks pass, covering reserve
  growth and decline, level/owner identity, account state and exact transfer
  payment instructions. Engine fixtures stub chain reads, not the planners.
- 31 local browser checks pass, including underfunded/unknown offers, explicit
  reserve consent, malformed commitments, independent capability switches,
  cancellation and interrupted confirmations. No real wallet or chain writes.
- Gary Club: 57 portal checks, six compiled HTTP route/security checks and six
  generated-adapter cases pass. TypeScript --noEmit exits 0.
- Full offline runner: 1,072/1,088 assertions pass in 20 files, plus all 32
  Node cases. The only failing file is the fingerprint gate with 16 deliberately
  unapproved bundle/style pins. This is NOT a passing release suite. Exact
  output is in trading-offline.log; no published pins were changed.
- Adapter SHA-256: 3a4ee705ff55d3adb3e551e7aad9dbaa46f894018a9b8a400c6d557c78334b07.

## Remaining work

A2 is partial: persistent notices to both parties and proactive stale-vault
order scanning are not implemented. Invalid orders are retired when somebody
tries to prepare or confirm them; expiry cleanup runs on reconciliation.
G-A3 source fixes need independent review and deployment before closure.
Other trading work includes linked-wallet self-offers, public listings, an
offers inbox, wallet transfers and already-cast-vote disclosures. Gary Club
opening consent-set handling remains a separate finding (G-A2).

The previous proposal integration and staged ballot installation wrapper still
need first-party Claude review. The ballot migration has not been applied.
Publication also needs approved exact fingerprints and member/wallet acceptance.
No programs, release binaries, ceremony artifact, production switches or live
orders changed. The owner's step-10 signatures and Friday's exact-live-Core
suite remain separate launch gates.
