**Verdict: I'm not approving the pin for `a862675ad3a8c5333c74ea61f204f4d2dd226af7`.** One defect should be fixed before publication. Most of the batch is sound; the details are below.

This was a read-only review with file tools only. I didn't run tests or builds, so I couldn't recompute any sha256. The test results quoted below are yours. Gary source came from this worktree because `/opt/gary-club` is outside my allowed paths.

## What I verified
- **Commit:** `/opt/cbob-vaults` HEAD is `v6` → `a862675`, parent `1fef0c4`. Spot-checked lines in the working tree match the diff.
- **Provenance:** both `BUILD.txt` files name commit `a862675`. The snapshot hash (`8b6263…`), node v20.20.2, esbuild 0.25.0 and the browser package integrities all match `launch/build-dependency-lock.json`.
- **Pin changes:** compared with the README table, exactly 18 of 20 pinned files change: 9 per profile. The ceremony `app.js` is unchanged in both (`6f3734b0…`, `9e58b83c…`). All 8 other bundles change because `market-view.mjs` now imports `market-book.mjs`. Each frozen bundle contains that code, which explains the change. The frozen market bundles and HTML contain the new UI strings and markup.
- **Privacy:** the projection publishes only these fields: asset, price, expiry, signature and `sold_at`. It never outputs `id`, `wallet`, `member_id` or payload.
- **Query fields:** Gary inserts trade intents with `action` = `buy_order`/`accept_offer`, a price in `summary.details.price_lamports`, and `signature` = the first tx signature. That matches the publisher's query and its `signatures[0]` check. A unique index allows only one active listing per asset, so the duplicate-listing throw can't fire on valid data.
- **No buy path from the public feed:** `tradePanel` (`web/src/lib/club-actions.mjs:187`) uses only `v.asset` and the authenticated club API. The public feed can't authorize a purchase.
- **No new mutation or signing paths:** the publisher only GETs from PostgREST and makes two read-only RPC calls (`getGenesisHash`, `getTransaction`). It writes two local files atomically. The browser only makes one new GET.
- **Flags:** `CBOB_PORTAL_TRADING_ENABLED==='1'` matches Gary exactly, and the flag only changes a label.
- **Output injection:** `el()` inserts text with `textContent`, and every href is regex-validated.
- **Prices:** prices stay as strings and BigInt throughout, so all 9 decimal places are preserved.
- **Staleness:** asks and offers hide after 30 minutes, and expired asks drop locally on the existing 120s reload.
- **Pagination:** exact content ranges, bounded page sizes and duplicate/gap refusal are all tested.

## Blocker
**B1. The public offer count includes offers Gary deliberately hides.** `projectMarket` counts every active, unexpired non-owner offer (`bank/market-index.mjs:27-37`). Gary's `marketState` hides offers from other holders when it can't confirm the bidder can pay (`src/lib/cbob/portal-market.ts:61-93`); the UI says "Unverified offers are hidden". So the public page can say "3 standing offers recorded" while the owner who signs in sees none. Any member can raise that public demand signal on any vault without holding any SOL, and the disclaimer doesn't fix the contradiction.

Fix: run the same funding check in the publisher, either:
- read rent-exempt minimum plus bidder balances with `getMultipleAccountsInfo` in batches of 100, using the same `canFundOffer` rule, or
- drop offer counts from `market.json` until they can be checked.

If funding can't be read, publish counts as unavailable, not as zero or the raw total. Add a unit case for an unfunded offer.

## Should-fix
1. **An RPC outage hides the order book.** If `getGenesisHash` fails, `publishMarket` throws whenever any receipt lacks a cached time (`market-index.mjs:108-110`). Asks then go stale and hide, even though the database read succeeded. A corrupt cache file (`JSON.parse` at `:99`) has the same effect. Instead, treat both as "no new receipt reads this run" and mark sales as partial.
2. **The publisher's header comment is now wrong.** `public-data.mjs:2` still says "no key or signer", but the job now loads `SUPABASE_SERVICE_ROLE_KEY`. That key can write to every table even though the code only reads. Correct the comment. Longer term, use a restricted role or a view that exposes only the public columns.
3. **Errors are discarded.** The `publishMarket` catch throws away the error. The messages are fixed strings with no secrets, so logging `e.message` is safe and helps diagnose failures.
4. **Sale times are cached forever from `confirmed` reads.** Use `finalized` for any time you cache permanently.
5. **`publishMarket` itself has no tests.** The budget, cache pruning and reuse, the genesis gate and the base-URL allowlist are untested.

## Polish
- **Mobile heading size:** `.market-board h3{font-size:32px}` in the mobile media query loses to `.experience .market-board h3`, so the heading stays 38px on phones.
- **Accessibility:** `.market-floors` has an `aria-label` but no role; add `role="group"`. The `role="status"` note is rebuilt on every 120s render, which can produce noisy or missed screen-reader announcements.
- **Sort persistence:** "Lowest asking price" stays selected after leaving the For sale tab, and still shows when no asks exist.
- **Sale signatures:** each one links on-chain to buyer and seller wallets. That's inherent to public chain data, but worth one line in the README's privacy statement.
- **Unresolvable receipts:** a receipt whose transaction can never be found is retried every run, along with the genesis call.

The rolling 200-receipt scope is labeled correctly everywhere, with no claim of all-time history.

Pin acceptance: **REFUSED** for `a862675ad3a8c5333c74ea61f204f4d2dd226af7`. After B1 is fixed, ideally with should-fix 1, rebuild both profiles and re-review the new commit and its fingerprints.
