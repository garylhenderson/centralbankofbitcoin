**Result: no blockers found in the source I could read. This is a read-only static review. I executed nothing, and the operator logs below are operator evidence, not mine.**

Reviewed source commit: `7f0825204e12b5af47a972a799c75653b46adf22`
Pin acceptance: APPROVED for `7f0825204e12b5af47a972a799c75653b46adf22`

This approval covers the source diff only. It depends on the operator conditions below, which are not source defects.

**Gary:** the exact migration `20261013h_gc_cbob_offer_email.sql` (via `apply-offer-email.py --execute`) and the feature deployment are both **approved with holder and trading flags OFF**. This is not real-wallet acceptance or Friday exact-live-Core certification.

## Conditions the operator must clear
1. **Missing test evidence.** `cbob-three-web-tests.log` ends at `vault-move.test.mjs` and then `FAILED: 1 file(s)`. It has no `move-recovery.test.mjs` line and no final "87" summary. Nothing in the audit logs mentions `move-recovery`. Those 8 cases cover save-receipt-before-broadcast, Web Locks and corrupt-receipt handling. Please provide a full `run-all` log at `7f08252` that shows them passing.
2. **Bundle hashes.** I can't compute hashes with read-only tools, so I did not verify any bundle bytes.
   - Both provenance files say snapshot `8b6263c3…0038e94`. Their `inputs` sections look identical, but I only compared them by eye.
   - The 14 stale hash failures cover vault, redeem, claim, buy, market, account and governance, in both profiles. That is consistent with the changed imports. Ceremony and history are not in the failure list.
   - `ceremony.mjs` imports none of the changed modules, so the ceremony bundle should be byte-identical to the installed one. Please confirm that by byte comparison.
3. **Engine adapter hash.** The committed `club-engine.cjs.sha256` is `599d81c6…`, but `adapter-check/club-engine.cjs.sha256` in the audit directory is `1182baf2…`. It may be an older artifact. Please reconcile it, and rebuild and compare the generated engine against Bank `club-engine.mjs`. I only confirmed that the committed `.cjs` contains the move code.
4. **Migration prerequisite.** `20261013_gc_cbob_order_notices.sql` must already be live. The deployment record says the notices table is live. `apply-offer-email.py` also aborts unless orders, notices and intents are all zero, and `--check` should run first.
5. **nginx.** Add `email-preferences` to the live allowlist before publishing the Bank account UI. Without it the preference card just shows "temporarily unavailable".

## Should-fix (none blocks launch)
1. **Missing mail transport is only detected late.** `src/lib/cbob/offer-email.ts:72` checks `MAILGUN_API_KEY` after up to five rounds of RPC, DB and Auth reads. Every tick burns its five slots deferring, and notices older than 24h are then dropped as `old_notice` (`:51`). Move the transport check ahead of the claim at `:39`.
2. **Permanently invalid vaults retry for 24 hours.** `tradableVault` at `:55` throws coded errors (`CBOB_ORDER_INVALID`, `CBOB_OWNER_MISMATCH`). The catch at `:82` treats them as "read unavailable", so the row retries every 5 minutes for 24 hours. Map those codes to `skip('owner_or_vault_changed')`, as `portal-orders.ts` `readOrderValidity` does.
3. **No time budget on the email pass.** `cbob-portal-reconcile/route.ts` waits on up to five sequential RPC reads and 10-second sends. Recovery has already finished and is safe, but a hung RPC read can stall the cron response. Add an overall budget and RPC timeouts.
4. **Default opt-in.** `offer-email.ts:14` and the migration's `DEFAULT true` mean members who never chose it get mail, and the UI shows the box pre-checked. This is a product decision, but please confirm it.
5. **Retargeted offers now trigger email.** After a `move` completes, retargeting offers inserts a new `offer_received` notice (`portal-market.ts:257`). Under the migration's trigger, that emails the new owner about existing offers. This is probably intended; I'm noting it.
6. **Misleading failure message.** `external-move.mjs:83` says "Confirmation is uncertain" even when `sendSigned` threw a definite on-chain error. The receipt is kept and the status check then resolves it, so it is only a wording problem.
7. **Reserve list and re-review.** `vault-move.mjs:28-31` shows only the three `profile.tokenNames` mints. Any reserve change between review and confirm changes the effect hash and forces a re-review. That is safe, though someone can use it to annoy a holder.
8. **Display and layout nits.**
   - `sale-round.mjs:19` shows `sold_out` before `scheduled`, while `planBuy` checks "not yet open" first.
   - `bank/vault-index.mjs:30` imports a browser module that pulls `ui.mjs` into the indexer service. Move `roundSnapshot` into a DOM-free file.
   - Tests hardcode `/opt/cbob-vaults/web/test/.out` and `/home/ubuntu/luna-remotion`.

## What I verified (static)
- **Email queue and migration**
  - The queue is forward-only with no backfill.
  - Claim uses `FOR UPDATE SKIP LOCKED` with a 2-minute rotating lease. Every worker update is fenced on status and lease.
  - `checking`→`sending` is a one-way fence; stale `sending` rows become `unknown` after 5 minutes and are never reclaimed.
  - Preference, mute, Auth and suppression reads all fail closed with the row deferred. The worker's own suppression read (`:70`) is strict, but `sendEmail`'s read just before the Mailgun call (`welcome.ts`) is fail-open, so a database blip between the two could still let a send through to a suppressed address; this is tolerable.
  - Ownership, order, reserves and funding are re-read per row.
  - Unverified, banned, synthetic or suppressed addresses are skipped. At most 5 rows are processed per tick, and trading off means no queries.
  - The cron route runs email after `reconcilePending`, and an email error cannot erase the recovery result.
  - RLS is enabled. `service_role` gets only SELECT, INSERT and UPDATE; `anon`, `authenticated` and PUBLIC get nothing.
  - Functions are SECURITY INVOKER with an empty `search_path`, and execute is granted to `service_role` only.
  - The apply script uses `ON_ERROR_STOP` and verifies the catalog after applying.
  - The 10 disposable-PostgreSQL groups pass in `offer-email-db-tests.log`.
- **Preferences route:** same-origin, CSRF and session are enforced by `portalSession(req, true)`. The body must be exactly `{offer_emails: boolean}`. It works with both flags off.
- **Custodial move**
  - It is a named holder action, independent of trading.
  - The input is exactly two fields.
  - The recipient must be on-curve, System-owned with no data, and not the sender.
  - Owner, collection, live record and genesis are verified.
  - Reserves, destination and the consent acknowledgment are part of the effect hash.
  - `confirmIntent` re-prepares fresh before signing, and the asset fence is the existing lock.
  - Status and reconcile paths skip `enabled()`, so recovery works with actions off.
  - Orders are retired and offers retargeted on completion.
  - The PostgREST filter interpolation is safe because the recipient is base58-validated.
- **External inbound move**
  - The destination is fixed to the session wallet and re-checked before and after signing.
  - There is a Web Locks exclusive lock and a fresh re-plan that must match the reviewed details, plus a fee-match check and a storage probe.
  - The receipt is persisted and read back before broadcast. Corrupt receipts are retained and block new transfers.
  - The recovery button is available with actions off.
- **Proxy:** the Core TransferV1 exception requires a configured collection, a single non-ComputeBudget instruction, data `[14,0]`, the collection account at index 1 and 7 accounts. `getFeeForMessage` uses the same check. It is inert when the collection is null, and `getGenesisHash` and `getBlockHeight` are already allowed. The SDK-parity test asserts bytes and roles, and I read the test but did not run it.
- **Public round:** the snapshot comes from the same MintConfig object as the bank totals, and the field names match the decoder. The display fails closed on stale (>30 minutes), future-dated, corrupt or inconsistent data. Price is a validated exact string with a 21,000-sat floor that matches `sale-proposal.mjs`. Remaining capacity is bounded by round, lifetime and level allotment, and nothing shows a bad value as zero. It renders before login on Buy and Market.
- **Counts and logs:** 9+5+6+6+8+27+10+8+8 = 87, matching `run-all.mjs`. `cbob-three-gary-final-tests.log` shows 22 tests and 97 portal checks, and `features-browser-final.log` has no failures. `gary-tests.log` is an older run (91 checks), so ignore it.

## Not verified
- **Not run or hashed:** I did not run any test, so the browser, PostgreSQL and SDK-parity results are the operator's, and I did not recompute any bundle hash.
- **Not read:** `judgeWalletEdits`, the full generated engine, the deployed nginx config, and the proxy server's collection wiring.
- **Out of scope:** the proxy is staged, not installed; I did not require installing it. The installed ceremony server is untouched in this diff.
