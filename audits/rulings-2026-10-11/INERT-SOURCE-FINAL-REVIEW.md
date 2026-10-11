# Final narrow audit: CBOB inert build and prelock rehearsal

Reviewed source commit: `ae23fce1c4291989b074b2af80e7efd9df88304d`

## Verdict

**APPROVED, with conditions, for these four things only:**
1. Accepting the ten unchanged "after" fingerprints below.
2. Reinstalling the root helper `scripts/seal-prelock.py` as committed at this source.
3. The inert `prepare-ceremony.sh --build`.
4. A full `prelock-check.sh --rehearse`.

This approval does not cover `--run`, `--install`, publication or signing.

## Scope and method

- **Files read:** the evidence file, the pin diff JSON, the prior pin triage and the final-fixes patch. I also read these sources in full: `web/deploy/prepare-ceremony.sh`, `web/build.mjs`, `scripts/prelock-receipt.mjs`, `scripts/seal-prelock.py`, `scripts/prelock-check.sh` and `web/deploy/install-ceremony.py`. I grepped the `web/README.md` pin rows and `scripts/update-web-hashes.mjs`.
- **Branch tip:** `.git/refs/heads/v6` is `ae23fce1…`, and HEAD points at `v6`.
- **Source matches the patch:** the working-tree files I read match the "after" side of the patch.
- **Restrictions:** I made no edits and used no execution, network or external models.

## Confirmed

- **Prior triage findings are closed.**
  - **F1:** every row that differs from the reviewed README, plus both ceremony rows, must be named in the review (`prepare-ceremony.sh:44-47`). The README at `ae23fce` still holds all ten "before" values (`web/README.md:398-415`), so all ten "after" hashes below must appear in the review.
  - **F2:** the review must name its source commit, which must be an ancestor of the pin-record source. The only file allowed to change between them is the review file (`:40-43`).
  - **F3:** both diffs use `--no-renames -z` (`:36`).
  - `update-web-hashes.mjs:21` still enforces exactly 20 unique rows, so a removed row cannot slip past.
- **The `.cache` pin is consistent everywhere it is checked:**
  - `prelock-check.sh:7`
  - `prelock-receipt.mjs:52-55`, where the seal staging check is now an exact `dirname` match, stricter than the old prefix match
  - `seal-prelock.py:8-11`
  - `install-ceremony.py:7-9`

  JS `realpathSync` and Python `resolve()` agree on the canonical target.
- **The build normalization cannot change the canonical root build.**
  - **Identity mapping at root:** when the root is `/opt/cbob-vaults`, every out-of-root label maps to itself (`build.mjs:122`), so the root build is a byte no-op.
  - **No re-encoding:** the UTF-8 read/write round-trip is lossless because esbuild runs with `charset: 'utf8'`.
  - **Only labels are rewritten:** rewrites are limited to whole-line `// <input>` comments and wrapper property keys whose decoded value exactly equals a metafile input outside the root.
  - **No runtime effect:** wrapper keys only select the wrapper function, so behavior is unchanged.
- **Staging and atomic rename:** staging now sits under the same `/scratch` filesystem as the candidate (`prepare-ceremony.sh:21,69`). No `rm -rf` and no `worktree remove --force` remain.

## Findings

### N1 (MEDIUM, must be fixed before signing; a procedural mitigation is enough for the inert build): the review file path is not constrained
- **Where:** `prepare-ceremony.sh:33,39,43`
- **Problem:** the review path (`record[1]`) comes from the editable README line. The only delta allowed between `reviewed` and `record[2]` is "the file named as the review".
- **Failure path:** someone names a code file, for example `web/deploy/launch-ceremony.mjs`, as the "review". They add the `Reviewed source commit:` line and the hashes as comments, and change its code in the same commit. Every check passes. Separately, the review file is read at `:39` before the `..`/absolute-path safety check at `:60`.
- **Fix:**
  - Require `record[1]` to match `^audits/rulings-\d{4}-\d{2}-\d{2}/[A-Za-z0-9._-]+\.md$`.
  - Require that `git diff --no-renames --name-status -z reviewed record[2]` is exactly `A <record[1]>` (a newly added file).
  - Move the path-safety check ahead of the first read.
- **Mitigation for this build:** the operator records the output of `git diff --no-renames --name-status ae23fce1c4291989b074b2af80e7efd9df88304d <record[2]>`. It must show exactly one `A audits/rulings-…/<review>.md` line.

### N2 (LOW): normalization could hide an isolated build reading from the live checkout
- **Where:** `build.mjs:119-123`
- **Problem:** in an isolated build, an input that resolves into `/opt/cbob-vaults/...` (outside the isolated root) gets relabelled. It then looks identical to an in-tree file, masking that the build read the mutable live checkout instead of the isolated source.
- **Current risk:** none observed. Inputs today are in-tree files and `/opt/gary-club/node_modules`.
- **Fix:** when `ROOT !== '/opt/cbob-vaults'`, die if any input's absolute path is under `/opt/cbob-vaults/`. Also die on label collisions.

### N3 (LOW): `prepare-ceremony.sh` does not itself assert the cache layout
- **Where:** lines 11 and 20 use the symlinked `.cache/ceremony-artifacts`, while line 21 hardcodes `/scratch/...`.
- **Problem:** if the layout drifts, the `mv` on line 69 may cross filesystems, and the problem is only caught at install. Also, if the candidate directory appears between lines 19 and 69, `mv` nests the artifact inside it instead of failing.
- **Fix:** add the guard from `prelock-check.sh:7` at the top of the script, and use `mv -T`.

### N4 (INFO): `--verify` depends on the cache layout it doesn't use
- **Where:** `prelock-receipt.mjs:52-53`
- **Problem:** `--verify` refuses unless `.cache` resolves to `/scratch`, even though verification reads only `/var/lib`. On lock day, this couples verification to an unrelated layout.
- **Ruling:** acceptable, but it should be documented.

### N5 (INFO): a check-then-read race in the root sealer, with no impact
- **Where:** `seal-prelock.py:14-16`
- **Problem:** between the `is_symlink` check and the read, the ubuntu-writable source could be swapped.
- **Why it doesn't matter:** the digest must equal the value the caller supplies, so root can only archive bytes the caller already knows. Nothing can be disclosed. This predates the fix, which only moved the base directory.

### N6 (INFO): the review gate checks presence, not acceptance
- **Problem:** the gate only checks that each hash appears somewhere in the review (`review.includes`), and the commit regex takes its first match.
- **For this file:** it states its commit line once and contains no "before" hashes, so this does not affect this approval.

## Not verifiable with my tools; the operator must record these

- Byte equality of all 20 outputs (root vs isolated vs `8d493bf`), and the eight line-strip reproductions of the "before" hashes.
- That the tree is clean at `ae23fce` and the evidence files are committed.
- The installed `/usr/local/sbin/cbob-seal-prelock` bytes (`prelock-check.sh:16-17` enforces `cmp` and root:root 0755).
- That the sudoers entry is limited to that helper.

## Conditions of approval

1. N1 mitigation output recorded.
2. The build commit differs from `ae23fce` only by this review file and `web/README.md`.
3. No `npm install` or deploy in `/opt/gary-club` or `/home/ubuntu/luna-remotion` (the esbuild source, `build.mjs:31`) between rehearsal and build.
4. Use `--rehearse` and `--build` only.

## Approved fingerprints (from INERT-PIN-DIFF.json, "after")

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

## Remaining signing gates

Signing stays blocked until all of these close: the N1 code fix, the frozen dependency manifest and independent off-box rebuild (including esbuild provenance), exact-creation-signature recovery, the final hosted-path test and day-of delivery script, day-of chain reads, origin/env hardening, the owner's D2/D10/D13 and timing decisions, and independent triage.
