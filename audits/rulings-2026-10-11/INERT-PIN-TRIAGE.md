# Pin acceptance audit: ten fingerprints for the inert CBOB ceremony candidate

## Verdict

**APPROVED, with conditions, for an inert candidate and offline/prelock rehearsal only.** This does not cover public publication, `--install`, or signing.

## How I checked

I read the request, `CEREMONY-ARTIFACT-RETRIAGE.md` and `web/deploy/prepare-ceremony.sh`. I grepped `RULED_DATES` and the `web/README.md` pin table. I made no edits and used no network, execution or external models.

- **"Before" hashes:** all ten match the current README rows at `web/README.md:398-415`.
- **`RULED_DATES`:** it is a plain frozen object literal at `bank/detectors.mjs:15`. Its only readers are `alarm.mjs`, `check-launch-params.mjs` and the prelock scripts and tests. None of them are holder pages.
- **Object.freeze:** esbuild keeps it because it treats the call as possibly side-effecting. Freezing a fresh literal has no observable effect, so the eight holder bundles should behave the same.

**What I could not verify:**
- **The byte-equivalence claim.** I cannot hash files with Read/Grep/Glob. "Removing that one line reproduces the old SHA256" is the operator's evidence, not mine.
- **That 87c1299's frontend matches 8d493bf.** Confirming that needs git.

## Ancestry and README-only delta enforcement

- **Ancestry is enforced.** `prepare-ceremony.sh:35` runs `git merge-base --is-ancestor <review-src> <commit>` through `execFileSync`. A non-zero exit throws, node exits 1, and `set -e` aborts.
- **The README-only delta is enforced.** `:36-37` refuses any file other than `web/README.md` in `git diff --name-only <review-src> <commit>`.
- **The pin table must match the fresh build.** `:29` runs `update-web-hashes.mjs` and aborts on any mismatch.
- **The review file is bound by hash.** `:55-56` checks it against the README record, and it is read from the isolated tree.
- **Only `mainnet-local` is packaged** (`:44`). The `mainnet` rows change the README only.

## Findings

### F1 — MEDIUM: the build checks only two of the ten fingerprints against the review
- **Where:** `prepare-ceremony.sh:39-40`.
- **Problem:** the review must name only the two `ceremony-*/app.js` hashes. The eight holder rows, including four public `mainnet` rows, can change with no review naming them, as long as they match a fresh build. The previous rule (retriage V2-2: "Do not accept a change to any other `mainnet` row") is therefore not enforced in code.
- **Fix:** require `review.includes(h)` for every pin-table hash that differs from the previously recorded pin table, or for all ten rows here.
- **Mitigation now:** the committed review file must contain all ten "after" hashes below.

### F2 — MEDIUM: nothing ties the review's stated source to the README's source commit
- **Why this arises:** `:38` reads the review from the tree, and `:37` allows only `web/README.md` to change after `record[2]`. So the review file must already exist at `record[2]`. That makes `record[2]` a commit after 87c1299, not 87c1299 itself.
- **Problem:** nothing checks that `record[2]` differs from the reviewed 87c1299 only by the review file. Nothing checks that the review text names `record[2]` either.
- **Failure path:** a commit that adds the review file plus any code change, for example to unpinned ceremony server or launcher code, passes every check.
- **Fix:** have the review name its source commit S. Require `git diff --name-only S record[2]` to equal exactly `[record[1]]`, or require `review.includes(record[2])`.
- **Mitigation now:** before building, the operator confirms that `git diff --name-only 87c129992eb4e49a2d64ecce9ec2f762d3b1c28d <record[2]>` lists only the review file path, and records that output.

### F3 — LOW: the delta check depends on git's rename settings
- **Where:** `:36`.
- **Problem:** `git diff --name-only` follows `diff.renames`.
- **Fix:** use `git diff --no-renames --name-only -z` and split on NUL.

### F4 — LOW/INFO: the public pin rows will no longer match what the public site serves
- **Problem:** the four accepted `mainnet` holder rows will differ from the bytes the public site serves (7298f12).
- **Condition:** no public deploy may be built from this README, and nothing that checks the public site may be pointed at these rows, until a separate publication review.
- **Side benefit:** the line-strip equivalence, if true, also shows the shared `/opt/gary-club/node_modules` dependencies of those eight bundles had not drifted at build time (V2-1). It shows nothing for the ceremony bundles.

## Conditions of approval
1. The committed pin review contains all ten exact "after" hashes below, and, for each of the eight holder files, the operator's stripped-line SHA256 matching its "before" value.
2. The F2 procedural diff check is done and recorded.
3. The build uses exactly that commit, with no `npm install` or deploy in `/opt/gary-club` in between.
4. No publication, installation or signing proposal comes from this acceptance.

## Accepted fingerprints (exact SHA256)

| Profile | File | Accepted SHA256 |
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

## Still pending
Signing stays blocked by every gate in `CEREMONY-ARTIFACT-RETRIAGE.md`:
- the frozen dependency manifest and independent off-box rebuild (V2-1, V2-10);
- the installed installer's hash check (V2-8);
- the exact-signature collection path (V2-3);
- the preflight lamport and disagreement fixes (V2-4, N7);
- runtime and env hardening (V2-5, V2-6);
- a production-chain test (V2-7);
- staging the candidate on the same filesystem (V2-9);
- the F7 day-of delivery script;
- box checks, including N11;
- D2, D10 and D13 plus the timing acknowledgement;
- independent triage.
