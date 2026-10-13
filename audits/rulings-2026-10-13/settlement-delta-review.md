I found no new regressions, and both L1 and L2 are closed in source. I only read files (no git, no tests, no hashing). Every test count below comes from your logs.

## L1 (release leaves a stale recipient): closed in source

The new `gc_cbob_release_order` is at `supabase/migrations/20261013_gc_cbob_order_notices.sql:66-74`.

- **Listing that goes back to active:** the failed buyer is cleared. The trigger takes its first branch (`:28`) because the recipient changed and the order is active, but that branch only sends notices for offers, so the cleared buyer gets nothing.
- **Offer that goes back to active:** the recipient is kept unchanged. Neither trigger branch matches, so no duplicate offer notice is sent.
- **Release after the maker asked to cancel, or after expiry:** the order becomes `cancelled` with reason `cancelled` or `expired`, and the recipient is kept. The trigger's second branch (`:33-36`) sends one notice each to the maker and the attempted buyer under that reason. If both apply, `cancelled` wins, which is reasonable.
- **Old reasons on re-activation:** a stale `status_reason` is cleared to NULL.
- **Interactions:** expiry is judged by database time, as before. The function signature is unchanged, so `CREATE OR REPLACE` is safe. `gc_cbob_abandon_unsigned` (`20261011…:54`) picks up the new version automatically and stays atomic. Permissions are revoked again at `:75-76`.
- **Tests** (`tests/cbob/order-notices-db.py`) run against the real migrations (`:19`), not a stand-in:
  - a released listing has no recipient, and a later expiry notifies only the maker (`:30`)
  - a released offer keeps its recipient (`:31`)
  - release after expiry and after cancellation each record the right reason and notify 2 people (`:32-35`)
  - unsigned abandonment releases the listing and clears the buyer (`:36`)
  - public roles still can't call release (`:38`)
- I count 20 `passed(...)` groups in the file, which matches your log.
- One behaviour to be aware of, not a regression: when a release happens after expiry or cancellation, the failed buyer still gets that final notice. The response document says this is intended.

## L2 (refresh error keeps the record "sending"): closed in source

- `portal-market.ts:255-257`:
  - The order is marked filled at `:246-248`, which fires the filled notices (trigger `:33-36`).
  - The cleanup of other stale orders at `:252-254` still has to succeed.
  - Both of those still commit before the record is completed at `:260`. So filled notices are still mandatory and come first.
- `retargetOffers` is now wrapped in try/catch. A lookup error or a conflicting-link 503 (`portal-orders.ts:49`) is logged and skipped, and the record still reaches `complete`, so the per-vault lock is released. The regular scan (`portal-orders.ts:77`) catches up the recipient later.
- The refresh still runs before the record is completed rather than after. That's fine because it can't fail the request. A slow lookup only delays completion; it can't hold the lock.
- `tests/cbob/portal.test.mjs:117` covers both the lookup-failure and conflicting-link cases. It checks that the record and order complete, the transaction is sent only once (`sends===1`), and a later status check doesn't send it again.
- That test uses mock tables, so it doesn't exercise the trigger. The DB test covers filled notices separately (`order-notices-db.py:27-28`).

## Ballot source artifact

`docs/cbob-audits/2026-10-13/ballot-guarded-source.sql` matches what the wrapper would produce:

- It is `20261012_gc_cbob_ballot_fence.sql` line for line, plus one inserted line 6. That line is exactly the `DO $$ … 'Intent state changed' … $$;` guard that `guarded_sql()` (`scripts/cbob-ballot-release.py:57-61`) adds straight after the single `LOCK TABLE … ACCESS EXCLUSIVE MODE;` line.
- Every other line (1-5 and 7-63 against migration lines 1-62) matches exactly as displayed.
- I could only compare the text as the Read tool shows it. I did not byte-compare trailing whitespace or newlines, and I did not compute any of the SHA-256 values in `ballot-source-digests.json`. Those values are your own claims.
- The JSON itself records `applied: false` and `production_authority: false`.
- I didn't repeat the wrapper audit, since `ae887a60` N1 already closed it.

## Limits

Nothing in this review or in the digest file authorizes live execution, accepts fingerprints, applies a migration or approves deployment. The no-live-receipts state is your own local check, which I did not repeat. Everything still listed as open in `final-review-response.md` is unchanged.
