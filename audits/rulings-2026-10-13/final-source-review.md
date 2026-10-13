I found no blocking regressions in G-A2, F1/G-C6/A2 or F2/F5. Two Low findings in the order-notice and recipient logic remain open, and some items can only be closed as "implemented in source". I read both trees as they are now; I didn't run git or any tests, so every test count below comes from author logs I did not run. Nothing here is live acceptance or fingerprint approval.

## Findings

**L1. A failed settlement leaves a stale recipient on a listing.** Low.
- Reserving an order for settlement stores the confirming member as its recipient (`portal-market.ts:338`).
- `gc_cbob_release_order` (`20261010_gc_cbob_portal.sql:81-84`) puts the order back to `active` but never clears that recipient.
- So when a buyer's attempt fails or is abandoned, the listing still names that buyer. Every later cancellation, expiry or invalidation notice goes to them through the trigger (`20261013_gc_cbob_order_notices.sql:33-36`).
- A release because the order expired or the maker asked to cancel is also recorded as `'cancelled'`, not `'expired'`.
- The 16 DB groups don't test release followed by a later notice.
- **Fix:** clear the recipient on release for listings, or restore the saved recipient for offers.

**L2. A recipient-refresh error after a landed trade keeps its record "sending".** Low.
- In `recordOutcome`, `retargetOffers` (`portal-market.ts:255`) runs before the record is marked complete (`:257`).
- If the buyer's wallet is linked to more than one account (503 at `portal-orders.ts:49`), or the DB write fails:
  - the member gets an error even though the trade landed;
  - the record stays "sending" and every retry fails the same way, so the per-vault lock stays held.
- The order's completion and filled notices have already committed, so nothing is lost. The link conflict should be rare because the buyer is a custodial wallet.
- **Fix:** do the refresh after the status update, or catch it and leave it to the scan.

## Closure against the exact requirements

**G-A2 / B2 / N2 (opening): closed in source.**
- For the `open` stage the effect hash binds only the stage and the saved server context: owner, asset, known, seen and consented (`club-engine.mjs:153`). Balances and amounts owed are no longer in it.
- The context comes only from the encrypted prepared record (`club-opening.mjs:16-17`), and caller-supplied context is rejected (test `:35`).
- The fee cap is the observed quote plus 1,400,000 CU at the existing 100,000 micro-lamport price, so +140,000 lamports (`club-engine.mjs:150`, `tx.mjs:84`). That covers every possible priority fee, because the page's CU limit is capped at 1.4M (`tx.mjs:97`).
- `confirmIntent` (`portal-market.ts:319-323`):
  - accepts a fresh fee only if it is at or below the **saved** maximum, and ignores the fresh maximum;
  - refuses old quotes that have no maximum;
  - still requires an exact fee for setup and for every other action.
- The `opening_fee_budget` acknowledgment and the original acknowledgments must all be ticked (`:316`). The maximum is shown in the review (`club-actions.mjs:77`).
- Optional rescues are filtered out (`club-opening.mjs:24`).
- Refusals still hold at confirm: new loss acknowledgments, a lost promised account (opening test `:28`), a newly frozen pool or reserve, an owner change, and a failed dry run.
- No program, payment or economics change.

**A2 / F1 / G-C6 (orders): closed in source apart from L1 and L2.**
- Orders now bind level plus minimum reserves (`trade-state.mjs:26`), and the not-frozen check is at `club-engine.mjs:45`.
- An order is retired only when two consecutive reads agree on the same reason (`portal-orders.ts:40-45, 71-74`). An RPC failure keeps the order.
- A caller who doesn't own the vault gets a 403 and nothing else changes (`portal-market.ts:156-166`).
- Placing an offer no longer cancels another member's listing (`:136-138`). Only expired listings are cleaned up, by database time.
- Self-offers are refused through both custodial and linked wallets (`:122`).
- A fill notifies both the maker and the actual counterparty in the same transaction (trigger `:33-36`). Replays add no duplicate notices because of `UNIQUE(order_id,member_id,reason)`.
- Remaining offers are pointed at the new owner after a trade and during scans, and the same update sends the new owner's offer notice.
- Orders being settled are never retired or cancelled as stale.
- Both participants can read and recover a settlement once it is signed or sending (`:59, :300`). Unsigned quotes stay private, and only the member can confirm (`:308`).
- **Caveat:** the "real engine" portal tests (`portal.test.mjs:120-127`) rebuild from Bank **source**, not from the generated `club-engine.cjs` that actually ships. I spot-checked that the generated bundle contains the new code (`:3026, :3099, :3274`) but did not verify its checksum. A rebuild and hash check is still needed.

**F2 / F5 (proposals): closed in source.**
- The near-close and near-expiry acknowledgments each trigger at 600 s or less (`sale-proposal.mjs:57, 98-101`). Both are part of the hashed details, so an outcome flip forces a new review (engine test `:53`).
- "Unset" and "ended" rounds now get their own messages (`governance-view.mjs:20-21`).
- The newer-stop / competing-proposal clause is in both the consent text and the banner.
- The creation-time warning is at `proposal-desk.mjs:45`.
- The other-tab / no-receipt message after "Check transaction" is fixed (`external-proposal.mjs:91`).
- The external SOL estimate uses the existing `account` read plus the simulated balance, with no new proxy method (`:45-50`).
- The royalty destination is compared with the Bank's `REVENUE` (`club-actions.mjs:59`).
- I could not find a test that the external path refuses a flipped outcome, and I didn't check the 23 browser proposal cases individually.

## What the logs claim (not run by me)

- `bank-offline.log` shows `bundle.test.mjs` at 117/133. The 16 failures are exactly the README hash pins (mainnet and mainnet-local). The other files pass, the log ends `FAILED: 1 file(s)`, and the 34 Node cases (9+5+6+6+8) pass.
- I didn't add up the 1117/1133 total line by line.
- Portal: 89 checks passed. Notice DB: 16 groups passed.
- **This is not a passing release suite.**

## Still open

- **Fixes from this review:** L1 and L2.
- **Generated bundle:** rebuild `club-engine.cjs` and verify its hash.
- **Known open items, unchanged:**
  - G-B4 offer-arrival email
  - G-B3 public sales layer
  - G-B5 move in/out guidance
  - current-round mint count display
  - a rollout decision for legacy offers with no saved recipient
  - live migration and RLS
  - real-member and wallet acceptance
  - acceptance of the 16 hash pins, and publication

I did not repeat the ballot-wrapper (`ae887a60` N1) audit; nothing in these changes touches it.
