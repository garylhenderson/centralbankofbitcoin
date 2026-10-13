I've finished the read-only follow-up audit. I found no blocking regressions in F1, G-C6, or the settling/RPC-failure protections. A2 is still incomplete in two concrete ways, and the G-A2 claim that openings "permit payout changes" doesn't fully hold through the Gary confirm gate.

**Scope limits:**
- `/home/ubuntu/CBOB-AUDIT-2026-10-11.md` and `/home/ubuntu/cbob-ecosystem-audit/bank-journey-triage.md` are outside the paths I'm allowed to read. I used `OPENING-TRADING-STATUS.md` and the proposal-trading review and triage as the stand-in requirements, so the exact G-A2/G-C6/A2/G-A3/G-B4 wording is unchecked.
- I had no git access, so neither tree is checked against e1679b3 or 2c8fcace. I read the files as I found them.
- I ran no tests. Every test claim below comes from reading assertions.

## Findings

**1. Medium (A2): a fully filled order notifies neither party.**
- When a trade lands, `portal-market.ts:245` sets the filled order to `complete`. The notice trigger at `20261013_gc_cbob_order_notices.sql:33` only fires on `cancelled`.
- The order's maker (the listing seller, or the bidder whose offer was accepted) also has no intent row, because `marketState` lists only the caller's own intents (`portal-market.ts:58`).
- So a bidder whose SOL just left their wallet gets no durable record of it. `account.mjs:75` has no "filled" reason either.
- **Fix:**
  - Add `'filled'` to both reason CHECK lists.
  - In the trigger, when status changes from `settling` to `complete`, insert notices for `member_id` and `target_member_id`.
  - Show the counterparty's settlement in `marketState`, which `reconcilePending` already does via `payload->>counterparty`.
  - Add a DB test and a portal test for it.

**2. Medium (A2/privacy): the saved offer recipient goes stale after an ownership change.**
- After a trade, `portal-market.ts:252` only retires listings and the buyer's own offers. Other bidders' offers stay `active` with `target_member_id` still pointing at the previous owner.
- The new owner never gets `offer_received`. The old owner keeps getting cancellation and expiry notices about a vault they no longer hold. This would also apply to transfers, which aren't built yet.
- **Fix:** in the same statement as the trade completion, set `target_member_id` to the single `walletMembers(buyer)` match (or null) for the remaining active offers, and send `offer_received` to the new owner. `scanOrders` should do the same when it sees the owner differ from the saved target.

**3. Medium (G-A2): a payout change can still refuse at confirmation.**
- For the `open` stage, the effect hash covers only stage and context (`club-engine.mjs:146`). But `confirmIntent` also requires the network fee to match exactly (`portal-market.ts:317`).
- That fee includes a compute-unit priority fee proportional to measured compute (`tx.mjs:97,103`). A payout that adds the `poolClaim` instruction, or dust that changes the sweep, changes the compute and therefore the fee. The confirmation is then refused with "vault or transaction changed."
- The Bank tests at `opening-engine.test.mjs:19-22` hide this: their fee fixture is a constant 5000 and they assert only the effect hash.
- **Fix:** for openings, compare against a reviewed maximum fee (shown to the member) instead of requiring equality. Add a Gary portal test where the fee changes between prepare and confirm because of a payout.

**4. Low–Medium (false invalidation): creating an offer can cancel someone else's listing.**
- `portal-market.ts:136` cancels every active listing on the asset whose wallet differs from the owner seen in one RPC read, at line 121. Any member's offer authorization triggers it.
- A lagging or load-balanced read can retire a valid new listing as `owner_changed`. This is the same pattern F1 fixed for offers.
- **Fix:** remove this side effect and leave it to the scan and the `buy_order` path, which rely on the engine's positive owner-mismatch result.

**5. Low (false invalidation): retirement trusts a single read.**
- `scanOrders` (`portal-orders.ts:41-43`) and `prepareTrade` retire an order on one `tradableVault` or `orderMatches` read.
- A read that returns a null account (`club-engine.mjs:35`) or reserves older than the commitment can retire a valid order.
- **Fix:** before retiring, re-read with `minContextSlot` at or above the slot saved when the order was created, or require two consistent reads.

**6. Low:**
- `prepareTrade` retires a listing whose maker changed with the reason `invalid_vault` (`portal-market.ts:169`). The scan uses `owner_changed` for the same case (`portal-orders.ts:51`), so the maker's notice text is inconsistent.
- `reconcilePending(member)` is never called; only the cron calls it (`api/cron/cbob-portal-reconcile/route.ts:8`). The per-member scan is dead code.
- In `portal.test.mjs`, line 105 deletes `tmp` and then line 114 builds into `tmp`, so the real-engine bundle is left on disk.
- During the press, an account already seen at the check whose balance grew is dropped silently (`plan-redeem.mjs:279`). The late-arrival consent covers this, but no `lateInfo` is shown. Consider adding it.

## Confirmed by reading code and tests

- **G-A2:**
  - The context is encrypted on the server, and context in the request input is rejected (`club-engine.mjs:69`, test `:34`).
  - Old prepared openings are refused (`club-opening.mjs:17`).
  - `priorOpening` only uses the same member's setup from the last 30 minutes, approved with every acknowledgement, and turns a decryption failure into a 409 (`portal-market.ts:190-203`).
  - The known and seen sets are kept through setup and continuation (test `:33`). Late arrivals are shown as information only.
  - A lost promised account or a newly frozen payout pool requires fresh consent (test `:27-28`).
  - Nested-vault rescue is optional (`club-opening.mjs:24`). Dry runs are capped at 2 (`plan-redeem.mjs:324`).
- **F1:**
  - The caller check runs at prepare and again at confirm. An owner mismatch for the caller is a 403 at both reads (`portal-market.ts:157-167`), while a mismatch for the listing maker still retires the listing.
  - Tests cover the prepare/confirm race (`portal.test.mjs:95`) and the real engine with a two-read race (`:116-124`).
- **G-C6:**
  - Offers check both custodial and signature-verified linked wallets (`gc_connected_wallets` has a unique `public_key`).
  - The check runs at review and again at authorization, and a lookup failure refuses with a 503 (tests `:89-91`). The scan also retires offers where the bidder now owns the vault.
- **A2 (parts that work):**
  - Retirement and notices commit together, and a notice failure rolls the retirement back.
  - `settling` orders can't be retired, including under concurrency (`order-notices-db.py:24,32,36`).
  - RPC failures leave orders untouched and still rotate the scan (`portal.test.mjs:100`). Notices are restricted to the service role with RLS.
- **G-A3:** the rent rule `balance == price || balance - price >= rentMin` reads `rentMin` from RPC and is applied at both `marketState` and offer creation (tests `:103-104`).

## Still open

- No offer-arrival email.
- G-B3 public sale layer and G-B5 transfer guidance.
- Legacy offers with no saved recipient need a rollout decision.
- The migration has not been applied to a live database, and there's no live RLS or wallet check.
- Production state was not queried.
- F2's guarantee horizon (whether a sale round could close before execution lands).
- The 16 published hash pins still fail.

None of this is a release approval or pin acceptance.
