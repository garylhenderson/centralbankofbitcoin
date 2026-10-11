**Verdict: no blocker to public publication from this patch.** It changes only `web/test/bundle.test.mjs`, the change is correct, and it adds a check rather than removing one. Publication still needs the full 1006-test web suite to pass and the conditions from the earlier approval to be met. Hosted signing is still not approved.

## What I checked
I made 3 reads: the patch, the earlier approval (`rulings-batch-2-retriage.md`), and `bundle.test.mjs:40-79` in `/opt/cbob-vaults/web`. I ran nothing.

- **The patch is in the working tree** and has a single hunk, in one test file. No production file is in the diff.
- **The fixed time matches the selftest.** `NOW = 1792108800` (`:49`) is the same fixed time the earlier review accepted for the selftest (17 h before the lock deadline of 1792170000). So the fixture can no longer expire with the real clock, which was the problem the `Date.now()` version had (F6).
- **The pass check now runs on the real dates.** With the two overwrite lines gone, `filled` keeps the committed `charter_opens_at` and `lock_deadline`. `:53` still asserts exactly `[]`, so the bundled browser judge now has to accept the real ruled dates. That matches the ceremony test's `:45` check. Before this patch, the bundled judge was only ever tested with made-up relative dates.
- **The date margin still holds.** The charter opens about 3 days after the lock deadline, which clears the 24 h margin rule. "The charter must open in the future" and "the lock deadline must be in the future" are both true at `NOW`.
- **The two later checks are unchanged.** `:50` and `:55` compare the bundled judge with the node judge on the same input and time, so they cover the same ground as before.

## Findings
- **H1. Info.** The `:50` label says "(refuses today)", but the test only checks that the bundled and node judges agree. It never checks that the result is non-empty, and "today" is now a fixed time. This was already the case before the patch. Fix: either add `judgeLaunch(launch, …).length > 0` or reword the label to "at the fixed pre-lock time".
- **H2. Info.** `1792108800` is typed as a number rather than worked out from `RULED_DATES.lock_deadline - 17*3600`. That is acceptable: if the dates are ever re-ruled, this test fails loudly instead of quietly following the change. Worth a comment saying so.

## What I could not verify
- **Test counts.** I did not reproduce "bundle 133/133" or "full 1006", so both are still claims. Bundle 133 → 133 fits a patch that changes no number of assertions.
- **Fingerprints.** "No fingerprints change" is confirmed only to the extent that the patch touches no production file. I did not check whether any manifest hashes test files.

## Conditions unchanged from the earlier approval
1. Run on a clean, fresh build of the commit that contains this patch. Record launch 72/72, ceremony 161/161, bundle 133/133, and the web suite at or above 1006.
2. Regenerate the generated snapshot on that build and confirm it is identical to the reviewed one.
3. The minor findings G1–G3 from the earlier review are not addressed by this patch. They don't block publication.
4. F3, F5 and the hosted-delivery items still block step 10 signing.
