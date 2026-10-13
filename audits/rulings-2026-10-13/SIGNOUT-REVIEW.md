**Verdict: APPROVE**

Reviewed source commit: `fcc3584c6d0fae966cb7a6799c5381775e98af04`
Pin acceptance: APPROVED for `fcc3584c6d0fae966cb7a6799c5381775e98af04`

This was a static read-only review. I ran no commands, hashes, tests or API calls. I did not recompute any hash myself. Everything labeled "operator-provided" is a claim in the operator's files that I read and cross-checked, not something I re-ran.

**Blocker resolution**

1. **Source provenance** (operator-provided, `signout-provenance.json`). It records a clean tree at `fcc3584`. Its `web/src/pages/account.mjs`, `web/src/style.css` and `web/test/browser/account-signout.cjs` entries each have a sha256 and `matches_git_commit: true`.
   - I read `signout-source.patch` and it touches exactly those three files.
   - The style.css hash in the provenance file (`6e658306…`) equals the new hash for `assets/style.css` in both profiles. That is consistent with the CSS passing through the build unchanged.
   - Resolved, subject to the operator's own hash checks.
2. **Pins** (I checked this myself against the file).
   - The 20 "previous" pins in the provenance file match `/opt/cbob-vaults/web/README.md` lines 396–415 entry by entry.
   - Only `account/app.js` and `assets/style.css` are marked changed, in both `mainnet` and `mainnet-local`. The other 16 pins have `new == old`.
   - The README at HEAD still carries the old pins. The pin table will need updating to the new hashes before or at release, and the new hashes come from the provenance file.
   - The four new hashes are:
     - `mainnet` `account/app.js`: `bf353d8e…5312`
     - `mainnet-local` `account/app.js`: `b8400f0b…8c51`
     - `assets/style.css` (both profiles): `6e658306…92b3`
3. **Ceremony** (operator-provided, `signout-ceremony-html-diff.txt` and `signout-installed-ceremony.json`).
   - The diff is a single footer line: build `6659a870ddbf (web/ has uncommitted changes)` versus `fcc3584c6d0f`.
   - The `app.js` sha256 in that footer is unchanged: `e1547dbf…b584`, matching the README ceremony pin.
   - The installed artifact is reported unchanged at `d1b17742…4b9f`.
   - The provenance file reports `publication_excludes_ceremony: true`.
   - I disregarded the precommit build log, as instructed.
4. **Live programs** (operator-provided, `signout-live-programs.json`).
   - The main program hash matches its pin.
   - Seal, mint, burn, gov and sweep are listed with their slots and hashes.
   - Two providers were observed at slots 456578303 and 456578305.
   - `programs_release_binaries_unchanged` is true.
5. **Independent build** (operator-provided, `signout-build-comparison.json`). It reports 26 of 26 files identical at `fcc3584`.

**Release files (my reading)**
- Both profiles' `account/app.js` contain the new sign-out code: the `#account-signout` button, removal on success, and `location.replace("/account/")`. Both profiles' `assets/style.css` contain the `.account-signout` rule.
- The patch matches the earlier review: the control sits in the top nav with a 44px minimum target and an aria-label. A failed sign-out shows a visible error and keeps the retry button. A successful one clears the private desk and returns to sign-in.
- The patch calls the existing `clubRequest('signout')`, so it adds no new signout implementation.
- The browser test blocks non-local requests and asserts exactly five CSRF-bearing signout POSTs and no remote calls.

**Limits of this review**
- The server route at `/scratch/cbob-launch-week/.../route.ts` (lines 151–158) is outside my file-tool access, so I did not read it. The description of its behavior (Bank host, same Origin, deletes the hashed session, expires the cookie) rests on the operator's statement and my earlier review.
- The "13 browser checks / 58 assertions" results are operator-reported, not re-run.

No financial flags, announcements, immutable programs or installed ceremony changes are authorized by this approval. It covers the UI fix you already requested.
