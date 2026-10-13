**Result: no blockers in the final delta. This is a read-only static review. I ran nothing, and the test results below are from the operator logs I read.**

Reviewed source commit: `a68fff57c7a74d5b6009d03cb2458e6b8830badd`
Pin acceptance: APPROVED for `a68fff57c7a74d5b6009d03cb2458e6b8830badd`

**Gary:** the exact migration `20261013h_gc_cbob_offer_email.sql` (via `apply-offer-email.py --execute`) and the feature deployment at `8343e5373df01dfe5ca81c9b25c31416f321a435` are **approved with the holder and trading flags both OFF**. That is static approval plus operator evidence only. It is not real-wallet acceptance or Friday exact-live-Core certification.

## Prior findings, checked against the diff
- **Transport check first** (`offer-email.ts:75`): it returns `transport_unavailable` before any claim or read. The test asserts zero RPC calls and zero sends.
- **Permanent skips:** `CBOB_ORDER_INVALID` and `CBOB_OWNER_MISMATCH` now skip as `owner_or_vault_changed` (`:155`). The engine throws both with `.code` (`club-engine.cjs:3200-3201`), and the test covers both codes.
- **Time bounds**
  - Every DB, RPC and Auth read goes through `bounded()`, which is capped at 5 seconds or the time left.
  - The pass stops at the earlier of the cron deadline and 20 seconds.
  - There are three checks before the provider call: before the claim, before the `sending` fence, and after it. The send timeout is clamped to the remaining time.
  - `Promise.race` attaches handlers to the late promise, so a late result is discarded and can't continue into a send.
  - A read that times out (before the fence) leaves the row in `checking` or `pending`, so it retries after the lease expires. Late DB writes stay fenced by lease and status.
- **Shared `sendEmail`** (`welcome.ts`): the timeout covers the suppression read, with a deadline check just before `fetch`. The fetch signal uses the remaining time. A late lookup returns "nothing submitted". Callers without `timeoutMs` take the unchanged path.
- **Sending never retries:** a failure after the fence marks the row `unknown`, and the worker never reclaims `sending`.

## Delta findings (non-blocking, fix in a later commit)
1. **Comment mismatch** at `offer-email.ts:76-78`: it says "The caller has a 55-second deadline". The cron actually passes 45 seconds, and the docs also say 45. This is the only comment that doesn't match behavior. It's comment-only, so it doesn't need a re-pin.
2. **Terminal writes share the pass budget.** If a send finishes right at the deadline, the final `sent` update is itself bounded and can throw. The catch then leaves the row in `sending`, it's counted as `unknown`, and the stale sweep confirms it later. This under-reports a real send. It can't cause a duplicate send.
3. **A suppression-lookup timeout inside `sendEmail`** returns `ok:false`, which the worker records as `unknown`. Nothing was submitted, but it is never retried. That is conservative and consistent with the "never retry" rule.
4. **Cron limit:** the route has no `maxDuration`. The operator should confirm the cron caller's timeout is comfortably above 45 seconds.
5. **Test fixtures:** the new tests still hardcode `/home/ubuntu/luna-remotion/node_modules/esbuild`, as before.

## Bank delta
- **`roundSnapshot`:** it moved verbatim to the DOM-free `bank/sale-round.mjs`. `vault-index.mjs` and `web/test/sale-round.test.mjs` import the new path, and there are no other users.
- **`sold_out` priority:** `scheduled` is now checked before `sold_out`, which matches `planBuy`.
- **Confirmation wording:** the new text is accurate. The reserve-token note is accurate: the list shows Bank mints only.
- **Policy decisions:** I did not re-raise the default-on email, the retarget notices, or an owner confirmation. Holder and trading flags are untouched by this delta.

## Evidence
**Operator logs, which I read and did not execute:**
- **`features-prepins-all-tests.log`:** every suite passes. `move-recovery` is 8/8, and the required-case counts are 9+5+6+6+8+27+10+8+8 = 87. The only failure is `bundle.test.mjs` at 119/133, which is exactly the 14 README hash pins. That is the intended pending state.
- **`features-targeted-final-tests.log`:** 26 pass, 0 fail.
- **`features-gary-final-tests.log`:** 29 pass, 0 fail. It includes the 97 portal checks, the two timeout tests, and the new offer-email cases (the one visible numbering run, #23-#27, runs through the new deadline test).
- **`features-tsc-final.log`:** empty, consistent with a clean tsc.

**Claimed in your message but not in files I opened:** `offer-email-db-tests.log`, `independent-verification.json`, the bundle provenance, the adapter hash `599d81c6…`, and the nginx and apply-script checks. I did not open the first three and did not review the last two. I'm taking them from your account.

## What remains
**Operator, before or during deployment**
- Accept the 14 pins. Then run the complete suite, which should show 1153 assertions and 87 cases.
- Run `apply-offer-email.py --execute` once, with the durable receipt and catalog verification.
- Add `email-preferences` to the live allowlist before publishing the Bank page. Back up first, run `nginx -t`, then reload.
- Keep the RPC proxy staged until the ceremony collection is configured.

**Still open**
- Real-wallet acceptance.
- Friday exact-live-Core certification.
