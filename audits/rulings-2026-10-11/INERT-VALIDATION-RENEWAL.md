I've finished reading the assigned files and am writing up the verdict.

# Narrow renewal audit: CBOB inert build and prelock rehearsal

Reviewed source commit: `782052d4ab2b778894b14b0522289f8020053e38`

## Verdict

**The approval for the earlier commit (`ae23fce`, recorded at `cfa3cf5` and `a5f0ae0`) extends to `782052d`.** It covers the same four things and nothing more:
1. Accepting the ten unchanged fingerprints below.
2. Reinstalling the root helper `scripts/seal-prelock.py` as committed.
3. The inert `prepare-ceremony.sh --build`.
4. A full `prelock-check.sh --rehearse`.

It does not cover `--run`, `--install`, publication, the ceremony install or signing. The renewal holds only if the conditions below are met.

## What I checked

- **Commit chain:** `.git/refs/heads/v6` is `782052d…`. The HEAD reflog (`.git/logs/HEAD:286-289`) shows `ae23fce → cfa3cf5` (review recorded) `→ a5f0ae0` (pins accepted) `→ 782052d` ("Check corrected recovery wording and allow explicit review renewal").
- **The working tree matches the "after" side of the patch:**
  - `scripts/update-web-hashes.mjs:24`
  - `web/test/ceremony.test.mjs:347-348`
  - `web/README.md:488`
  - I cannot run `git diff`. So "only this patch since `a5f0ae0`" is checked against the working tree, not proven from git objects. Condition 1 below closes that.
- **No runtime surface changed.**
  - None of the three files is a bundle input. `build.mjs` and `web/src/**` don't reference the test or the updater.
  - `web/README.md` is copied into the artifact, so the README file hash in `ARTIFACT.json` changes. That is expected, but it is not one of the ten app.js fingerprints.
  - The 10 bundle hashes cannot move because of this patch.
- **The test change is a correction, not a weakening.**
  - The old assertion required the string `do NOT create another: pin it instead`, which no longer exists in the page.
  - The new one still requires exactly 2 `unverifiedBox(found.unverified)` call sites (`ceremony.mjs:105,161`). It also requires three phrases, all present at `ceremony.mjs:63`: `do NOT create another`, `independent step-0 receipt` and `Browser memory alone does not verify it`.
  - That makes it stricter, and it matches the reviewed independent-receipt wording.
- **The updater change fails closed.**
  - Without the flag, behaviour is unchanged. The isolated build at `prepare-ceremony.sh:29` calls the updater without `--accept-reviewed`, so it still exits 0 when the rows match.
  - With `--accept-reviewed` and unchanged rows, the updater now goes on to the existing checks: a review file is required (`:30`), and the tree must be clean in web/bank/scripts/launch (`:31-32`). It then rewrites only the `Pin review:` line.
  - Before this patch, renewing a review without a hash change was impossible. Now it is explicit.
  - The clean-tree check does not cover `audits/`. If the operator accepts before committing the review file, the later `prepare-ceremony.sh:38` delta check refuses the build. So a wrong ordering fails closed, it does not slip through.
- **Test counts:**
  - `offline-inert-final.log` shows 16 files ok and `ceremony.test.mjs 163/164`. The one failure is exactly the stale B4 assertion this patch replaces.
  - The final line of `ceremony-final-count.log` is `ceremony: 164/164 passed`.
  - The floors add up to 1010 across 17 files, which matches README `:488`.
  - Nothing claims the failed run passed.

## Findings

- **R1 (LOW, missing verification):** the 1010 total comes from two separate runs. Neither log identifies the commit it ran on. Before `--build`, record one `node web/test/run-all.mjs` at `782052d` showing all 17 files ok and no `FAILED` line.
- **R2 (INFO):** `--accept-reviewed` now always rewrites the `Pin review:` line, even when nothing changed. That is acceptable, because the review-file and clean-tree gates still apply. The new line does not prove the review's content. That is the prior N6 issue, and it still stands.
- **Prior N1 (MEDIUM) is still open and unchanged.** The review path is still unconstrained (`prepare-ceremony.sh:33,39`, and now also `update-web-hashes.mjs:29-33`). The procedural mitigation must be repeated against the new commit: run `git diff --no-renames --name-status 782052d4ab2b778894b14b0522289f8020053e38 <record[2]>`. It must show exactly one `A audits/rulings-…/<this review>.md` line.
- **Prior N2 to N5 are unaffected by this patch.**

## Conditions of renewal

1. Commit this review as a newly added file directly after `782052d`. Then run `update-web-hashes.mjs --accept-reviewed --review <this file>`. The README diff must change only the `Pin review:` line, with zero pin-row changes (which confirms the ten hashes are unchanged). Commit that.
2. Record the N1 mitigation output against `782052d`, as above.
3. Record the single full test run from R1.
4. No `npm install` or deploy in `/opt/gary-club` or `/home/ubuntu/luna-remotion` between rehearsal and build.
5. Use `--rehearse` and `--build` only.

## Approved fingerprints (unchanged, copied from the prior review)

| Profile | File | Approved SHA256 |
|---|---|---|
| `mainnet` | `buy/app.js` | `fd44306ac9e4585a23140f4e2c378ead5404a3d691512e8c3db6a9011d81e9d9` |
| `mainnet` | `ceremony-0cfecdcaf80584b6/app.js` | `419b8b90adfd033f59f97a8bec0b212bc04f5c4e5a661c60c87f3f0b736e1666` |
| `mainnet` | `claim/app.js` | `fe71122fa5954ab4be1c5852756fdae3d84f1c9925186b16a6b961d204f09c32` |
| `mainnet` | `redeem/app.js` | `25221d4df2f50b61859f6f5041807a301b636c2f451e2a6fad4a81f45e6c3134` |
| `mainnet` | `vault/app.js` | `5e1501ad62e45c94c47a8eb6218968c37e66b40a735c6f0282a60837e508971f` |
| `mainnet-local` | `buy/app.js` | `e747e952bb7e05127a802f9e8dada2e34eb0b56e5ccd567b0f6b053be15f2c2a` |
| `mainnet-local` | `ceremony-0cfecdcaf80584b6/app.js` | `f6deea8396e39216a82d650a77859268bcb84cf6aed450b2ec9bb2200b115621` |
| `mainnet-local` | `claim/app.js` | `ae193dfeee6d5af4457147e1c7975672634b8b79e70f20b1066d7475d30dd62c` |
| `mainnet-local` | `redeem/app.js` | `327cdfcdcd7d3709d2a49459397519e1de14925ea225d44cf515fc541b296b9d` |
| `mainnet-local` | `vault/app.js` | `0bbd70cb812c1da467c727125aa55352129cb225c4e022d9ab45d270f001067d` |

## Signing gates

Signing stays blocked until all of these close: the N1 code fix, the frozen dependency manifest and independent off-box rebuild (with esbuild provenance), exact-creation-signature recovery, the final hosted-path test and day-of delivery script, day-of chain reads, origin/env hardening, the owner's D2/D10/D13 and timing decisions, and independent triage.
