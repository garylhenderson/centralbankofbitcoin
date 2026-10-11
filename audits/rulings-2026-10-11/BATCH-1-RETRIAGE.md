# Re-triage of Rulings Batch 1 (R2 correction and treasury naming, R1–R3 record)

## Verdict: PASS

- **Public site publication: passes.** Both of the earlier review's points are closed. F1 is fixed by a dated sentence about Section VI. F3 is fixed by "Vaults issued at the founding charter exchange…".
- **Pin acceptance of the source diff: passes, with one condition.** The ceremony and buy changes only alter display text. The condition: the new fingerprints go into the committed pin table in `web/README.md` in the same commit, and that table must match a clean rebuild of that commit (N1, N2 below).
- **Hosted ceremony deployment** was not asked for and is not covered here.

I made 12 tool calls: the patch, BATCH-1.md, the earlier review, both pinned build manifests, the README pin table, and targeted Greps. I edited nothing and ran nothing.

## What I checked in the diff

**1. Both ceremony changes are display text only.**
- `web/src/lib/plan-ceremony.mjs:261`: the only change is the first string in the mint step's `describe:` array. The unchanged context line 258 (`build: (ids, a, v) => [IX.sealInit(...)]`) shows no instruction builder changed.
- That string is only displayed. Its one consumer, `web/src/pages/ceremony.mjs:206`, maps each description line into an `<li>` as text. Grep found no other use.
- `web/src/pages/ceremony.mjs:120`: only the message argument of `line(...)` changed. The check `v.bankTreasury === squadsFor(P, v)` is untouched, so the 15% destination check works exactly as before.
- The new string `"the Bank's treasury (CBOBTC Squads)"` is valid JS in that ternary.
- `web/src/pages/buy.mjs:73`: the change is inside a `box('note', …)` string, after the dry run and before signing. `signExact` and `sendSigned` are not touched.

**2. The original Section V and the numbered statement bodies are untouched.**
- P&F: the first change adds only a new `<aside id="purchase-price-correction">` before `<section class="sec" id="section-v">`. The section's opening lines are unchanged context. The next change is at old line 480, which is the Section VI line, so nothing between them changed.
- Statement 2026-3: only the existing dated correction `<aside>` gains one sentence. The `<h1>`, the film and the original body are unchanged context.
- `feed.xml`: one sentence is added to the correction paragraph of the 2026-3 `<description>`. The `guid`, `pubDate`, enclosure and the "Original statement:" body are unchanged.
- No other statement is in the patch.

**3. There is no CSP change.**
- The patch touches no headers, nginx, deploy or `_headers` file.
- The only HTML change in `buy.html` is a line in the body's task guide. The ceremony HTML is not in the patch.
- R3 is recorded as a ruling only.

**4. Charter wording and the treasury name.**
- The correction says the founding charter exchange is free. It says sale-round proceeds split 85/15 to activated vaults and the Bank's treasury, and that a bought vault starts empty and needs its own 21,000-sat deposit plus an activation request.
- The Section VI rename is disclosed with its earlier wording ("as first issued it named Gary Club").
- No treasury controller is invented. The earlier review's F2 stays tracked.

**5. The old fingerprints in BATCH-1.md are right.**
- Both OLD values for each profile match `web/README.md:398-399` and `408-409`.
- They also match `web/test/.out/dist-check/BUILD.txt` and `web/test/.out/dist-mainnet-local/BUILD.txt`, which are both builds of commit 7a00e2c.
- In those manifests every other `app.js` hash equals the README table, so only `buy` and `ceremony` change. That is consistent with the source diff.

## Findings (none blocking)

**N1. The pin table in the README is not in the patch. Low; this is the acceptance step itself.**
- `web/README.md:398-399` and `408-409` still list the OLD hashes for `buy/app.js` and `ceremony-0cfecdcaf80584b6/app.js`.
- The README says a bundle test fails unless this table equals a fresh build of both profiles.
- The ceremony footer also tells people to compare against this table before connecting.
- **Failure path:** if the source lands without the table update, the bundle test goes red. Anyone checking a ceremony page built from the new source would then see a mismatch, which looks like tampering.
- **Fix:** update all four rows to the NEW values in the same commit that accepts the pins.

**N2. I could not reproduce the NEW fingerprints from any build on disk. Low.**
- No `BUILD.txt` on the box contains the four NEW hashes.
  - `web/dist/BUILD.txt` and both `test/.out` manifests are from 7a00e2c, with the OLD hashes.
  - `web/dist-mainnet-local/BUILD.txt` is a stale build of `1ddbb438… (web/ has uncommitted changes)`. Its `buy/app.js` hash (`390da37c…`) matches neither the OLD nor the NEW pin.
- So the NEW values are what BATCH-1.md says, not something I checked.
- **Fix:** take the pins only from a clean (not dirty) build of both profiles at the commit that contains this patch, and let the bundle test confirm the match.
- Make sure the stale, dirty `dist-mainnet-local/` is not the folder `ceremony-local.mjs` serves when the hosted rebuild happens.

**N3. The Schedule of Vaults wording was changed in place without a dated note. Low.**
- Section IV changed from "fifteen percent retained by the Bank" to "fifteen percent to the Bank's treasury".
- This names the same recipient more precisely. That is unlike F1, where the named party changed.
- An optional one-line note would keep the dated-entry convention consistent. It is not required for publication.

**N4. The patch does not record its base commit. Low.**
- BATCH-1.md says Section V is byte-identical to 7a00e2c, but the patch has only blob index lines and no base reference. I can't resolve those blobs with read-only file tools.
- The changes themselves show Section V untouched relative to the patch's base.
- **Fix:** record the exact command (`git diff 7a00e2c -- …`) in BATCH-1.md.

## Not verified

- The NEW sha256 values (N2).
- Whether any test asserts the old display strings ("the CBOBTC Squads", "CBOBTC treasury"). The repo-wide Grep returned 43 KB, mostly SPEC.md text about Squads rescue, and I did not review the test files within the read budget. A full test run before the pin commit will settle this.
- BATCH-1.md's claim that the server never lists the `launch/` directory, so the new `launch/RULINGS-2026-10-11.md` is harmless (earlier F5). I did not reopen `ceremony-local.mjs`.
- The CSP and header files themselves. "Unchanged" is based on their absence from the patch.
- Whether the working tree contains changes beyond this patch. The new string at `plan-ceremony.mjs:261` does match the patch.
