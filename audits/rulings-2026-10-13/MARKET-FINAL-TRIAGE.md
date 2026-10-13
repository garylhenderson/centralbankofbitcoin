**Verdict: no blockers for `c04299dc…`. I approve the pin, with two limits.**

I used file tools only. I ran no tests, builds or hashes. The 27-case pass and the byte-identical claim for the browser files rest on the provided evidence, not on my own check.

## What I verified
- **Source identity:** `/opt/cbob-vaults/.git/refs/heads/v6` is `c04299dc…`. Both new `BUILD.txt` files name that commit. The `v6` tip in `/opt/cbob-vaults` is `c04299dc…`, but `refs/remotes/origin/v6` there still points at the prior `79f079e2…`, so the new commit is local only.
- **Source matches the diff:** the working copy of `bank/market-index.mjs` matches `correction.diff`.
  - `finalizedSaleTime` is used at `market-index.mjs:140`.
  - `confirmedSaleTime` appears nowhere in the source. It survives only in my prior ruling text.
  - `market.json` is written at `:145`, before the cache. The cache write at `:146` is wrapped in `try/catch` that logs a warning.
  - That fixes non-blocking item 2 from my prior ruling. The public file can no longer go stale because of a cache failure.
  - The rename is a pure rename with no behavior change.
- **Browser files are unchanged from the prior builds:**
  - **Hash comparison:** I compared the `BUILD.txt` sha256 lists against `market-release-sonnet` for both profiles. Every `app.js`, `style.css`, image and other HTML file is identical. That includes the ceremony `app.js` hashes (`6f3734b0…`, `9e58b83c…`) and `history/app.js` (`54342ca2…`).
  - **One expected difference:** only `ceremony-0cfecdcaf80584b6/index.html` differs, in both profiles. I read both versions. The only difference is the footer's `build` id, which changes from `79f079e2ac4f` to `c04299dc235b`. The `app.js` hash and integrity attributes are unchanged. The "byte-identical" claim is true for everything except those two files, and that exception is correct.
  - **Inputs files:** both `*.inputs.json` files carry the same node, esbuild and snapshot hash (`8b6263c3…`) as before. The `config.js`, `market-book`, `market-view` and `pages/market` input hashes match the prior inputs. I did not diff every input line.
- **New tests are sound (read only):**
  - **401 wallets:** the loop makes batches of 100 and four concurrent per 400 wallets. 401 wallets give sizes `[100,100,100,100,1]` with a peak of 4, and the test asserts exactly that.
  - **Partial failure:** the one-wallet batch returns an empty `value`, which trips the length check at `:86`, so the call rejects.
  - **Wallet fixture:** the generated wallet strings are 32 base58 characters, which should pass `assetId`.
  - **Cache as a directory:** the temp write succeeds, then the rename onto the directory fails. The catch absorbs that and `market.json` still has its listing.
- **Test count consistency:** `market-book.test.mjs` goes 25 to 27 and the total goes 59 to 61. The `run-all.mjs` required count and the README both match.
- **Scope:** the diff touches no program, signing or browser source. The new `catch` handles a cache failure only. The `market.json` write is still outside any `try`, so a public-file failure still aborts, as intended.

## Non-blocking
1. **Leftover temp file:** in the cache-directory failure case, `atomic()` leaves `<cacheFile>.<pid>.tmp` behind, since the rename fails after the write. This is harmless but could accumulate if the cache path stays broken.
2. **Earlier items still open:** my prior items 1, 3, 4, 6 and 7 (deploy order, malformed-signature abort, one bad bidder hiding all counts, late rotation, service-role key) are unchanged. None was a blocker.
3. **Pin table:** the README table must match the `BUILD.txt` hashes above. Only the two ceremony `index.html` hashes changed from the prior pin.
4. **Hashes not recomputed:** the on-disk bytes are unverified by me. The full-suite run against the recorded hashes remains the integrity check.

Both switches stay off, and nothing is deployed.

Reviewed source commit: `c04299dc235b14a4162e5f6cfb232a7235750a66`
Pin acceptance: APPROVED for `c04299dc235b14a4162e5f6cfb232a7235750a66`
