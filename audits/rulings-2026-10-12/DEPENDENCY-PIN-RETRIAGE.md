# Independent re-triage: CBOB build-dependency fixes and pin acceptance at `/opt/cbob-vaults` 1173a21

**Bottom line:** I found no blocker for accepting the 20 fingerprints. Install, private delivery, signing, holder or trading enablement, lock, and publication of the public pages are all still not approved. Three recommended fixes should land soon: F-1 before the acceptance run, F-2 before any `publish-ecosystem.sh --execute`, and F-3 before the first workflow run.

**How I worked:**
- I used only Read, Glob and Grep. I edited nothing and ran no git commands, builds, tests, workflows or network calls. I read no env, key or credential files, and made no model calls besides this session.
- `.git/HEAD` is `v6` at `1173a21790e2eebbaa3db92d11e5794c67c62076`, and it is the last entry in `logs/HEAD`. I could not check the working tree for uncommitted changes, because that needs `git status`.
- I did not read `dependency-pin-retriage.md` in the audit directory, so this re-triage stays independent of it.

**Read in full:**
- **Dependency builder and freeze:** `build-dependencies.mjs`, `freeze-build-deps.py`, `build-dependencies.test.mjs`, `freeze-build-deps.test.py`, `dependency-rebuild-check.mjs`
- **Builds and fingerprint scripts:** `build.mjs`, `bundle-ceremony.mjs`, `scripts/update-web-hashes.mjs`, `scripts/pin-review.mjs` and its test
- **Artifact path:** `ceremony-build.mjs`, `rebuild-ceremony.mjs`, `install-ceremony.py`, `launch-ceremony.mjs`, `recover-release-dist.py`, `prepare-ceremony.sh`, `ceremony-hosted-rehearsal.mjs`, `ceremony-build.test.mjs`
- **Workflow, config and publishing:** `.github/workflows/ceremony-rebuild.yml`, root `package.json`, `publish-ecosystem.sh`, `gen-errors.mjs`
- **Evidence:** the preparation log, hosted log, rebuild receipt, both freeze logs, release inputs and the pin candidate for 1173a21; both candidate `BUILD.txt` files; `ballot-build-final.log`; `BALLOT-STATUS.md`, `BALLOT-FINAL-ADDENDUM.md` and `STEP-CHECK-STATUS.md`

**Read in part:**
- `launch/build-dependency-lock.json`, lines 1-12 and 180-392
- `run-tests.sh`, lines 285-309
- `CEREMONY-WINDOW.md`, lines 60-149
- `web/src/config.js` (program pins)
- `pages/governance.mjs` (`externalError` lines)
- the candidate `*-inputs.json` files (header and `source/` rows)
- `.gitignore`

---

## D-1 to D-11: status after 1173a21

| ID | Status | Basis |
|---|---|---|
| D-1 | **Closed** | `buildToolchain` honors `--require-frozen` (`build-dependencies.mjs:40`). `rebuild-ceremony.mjs:40,45` passes the flag to both builds. The installer compares the artifact lock byte-for-byte with `git show <commit>:launch/build-dependency-lock.json` (`install-ceremony.py:42-43,5`). The installer (`:7-15`) and the launcher (`ceremony-build.mjs:42-57,81`) both refuse installed-mode, mismatched or unpinned records. |
| D-2 | **Closed** | The `resolved` URL must equal the canonical form for its name and version, and the package key must end in `/node_modules/<name>` (`freeze-build-deps.py:26-36`). Tested at `freeze-build-deps.test.py:44-50`. |
| D-3 | **Mostly closed** | Root `package.json` is `{"private":true,"type":"module"}`; every build passes `tsconfigRaw:{}`; the snapshot has neutral `app/` and `tools/` package boundaries. Adding `type:module` changed no output: browser hashes equal 3c18048 and the server bundle is still `d53ae9fe…`. I grepped for CommonJS `.js` files in the repo and found none. Residual risk: F-4. |
| D-4 | **Closed** | `env -i` in `prepare-ceremony.sh:22`; minimal child environment in `update-web-hashes.mjs:19` and `rebuild-ceremony.mjs:13,37`; `python3 -I -B` in the workflow and runbook. Residual risk: F-5 (the publish path). |
| D-5 | **Closed** | `update-web-hashes.mjs:11,20-21` requires the committed pin, passes `--require-frozen` and checks the provenance `snapshot` field. |
| D-6 | **Mostly closed** | Hardlinks are refused, the directory set is pinned (`build-dependencies.mjs:26,30`), and the snapshot is verified before and after each build. A same-user window between checks remains; it is accepted as LOW. |
| D-7 | **Closed** | Key-shape regex at `freeze-build-deps.py:34`. |
| D-8 | **Closed** | The receipt now records node, esbuild, both freeze logs and input-record hashes, and checks for a clean tree after the builds (`dependency-rebuild-check.mjs:25-26,52`). The relocation evidence is no longer used as a gate. |
| D-9 | **Closed** | `-I` is used, and `encoding='utf-8'` throughout. |
| D-10 | **Partly closed** | A real-esbuild frozen escape test is in the gated 118 (`build-dependencies.test.mjs:59-91`, test 105). There is still no end-to-end test of `rebuild-ceremony.mjs` (F-6). |
| D-11 | **Closed in code; not yet run** | Portable `rebuild-ceremony.mjs`, `recover-release-dist.py` and a manual workflow. By design, the workflow can only run after fingerprints are accepted, because `rebuild-ceremony.mjs:18-33` needs a Pin review line. |

---

## Findings

### F-1 · LOW-MEDIUM: accepting fingerprints does not check the new hashes against the review that approves them
- **Where:** `update-web-hashes.mjs:40-43` checks only that the review has the approval line and the right commit chain (`pin-review.mjs`). It then writes whatever its own fresh build produced into the README.
- **Gap:** the check that every changed row's hash appears in the review text exists only in `rebuild-ceremony.mjs:31-33`. That covers the ceremony artifact path, but not `publish-ecosystem.sh`.
  - `publish-ecosystem.sh:35-36` compares the staged bytes only with the README rows.
- **Failure path:** suppose the acceptance build differs from the candidate reviewed here, through nondeterminism or on-box interference.
  - This review's approval would then be attached to hashes it never listed.
  - The public `mainnet` pages could be published from those hashes.
  - Only the ceremony path, and the off-box rebuild, would catch the mismatch.
- **Fix:** in `--accept-reviewed`, refuse unless every row that differs from `git show <reviewed>:web/README.md`, plus every `ceremony-*` row, has its hash in the review text. This is the same rule as `rebuild-ceremony.mjs:33`.
- **Until fixed:** have the operator compare the README diff against the after-hash table at the end of this report before committing it.

### F-2 · LOW-MEDIUM (missing verification): the off-box rebuild covers only the `mainnet-local` profile
- **Where:** `ceremony-rebuild.yml:49` runs only `rebuild-ceremony.mjs`, which builds only `--profile mainnet-local` (`rebuild-ceremony.mjs:40`).
- **Gap:** the publicly published `mainnet` pages (vault, redeem, claim, buy, market, account, governance, history) rest only on same-box reproducibility.
  - That reproducibility evidence is the installed build agreeing with both frozen builds.
  - Some of those pages build wallet transactions.
  - `CEREMONY-WINDOW.md:63-70` itself says on-box evidence does not protect against a malicious operator on this box.
- **Fix:**
  - Add a workflow step that runs `build.mjs --require-frozen --profile mainnet --dist <recovered> --out $RUNNER_TEMP/mainnet --provenance …`, prints `BUILD.txt`, and asserts every `| \`mainnet\` |` README row.
  - Treat that run as required before `publish-ecosystem.sh --execute` of these pins.

### F-3 · LOW: workflow trust inputs that cannot be confirmed from source
- **Unverified action pins:** `ceremony-rebuild.yml:23,28` pins `actions/checkout@11d5960a…` and `actions/setup-node@49933ea5…`.
  - I could not confirm offline that these SHAs are official tags.
  - A SHA in an action reference can resolve to a commit that exists only in a fork.
  - Record which tag each SHA corresponds to, from the official repository.
- **Workflow file source:** `workflow_dispatch` runs the YAML from the dispatch ref, not from `inputs.source_commit`.
  - The builder scripts do come from the reviewed commit.
  - The evidence should record the run's workflow SHA and confirm the YAML is unchanged.
- **Artifact expiry:** `:41` depends on CI artifact `11672956089`, which will expire under GitHub retention. The runbook (`CEREMONY-WINDOW.md:126-127`) covers this; record the expiry date.
- **Fine as is:** `inputs.source_commit` is validated through an env var, not interpolated into the shell. Credentials are not persisted, and the token is scoped to one step.

### F-4 · LOW (needs confirmation): the neutral package boundaries may not stop `browser` maps inherited from parent directories
- **Where:**
  - `build-dependencies.mjs:54` hands every resolution inside the snapshot to esbuild's default resolver.
  - `freeze-build-deps.py:130-132` writes `{"private":true}` as the boundary.
- **Concern:** as I understand esbuild's resolver, the enclosing `browser` scope carries down through directories whose `package.json` has *no* `browser` field. If so, a `browser` map in a parent `package.json` (above the snapshot or the source) could still:
  - map a file to `false`;
  - swap one in-tree file for another.

  Both would pass the escape checks.
- **Today:** there is no `package.json` at `/`, `/opt`, `/scratch` or the snapshot's parent directory. The installed and frozen builds agree, which they would not if a parent map were interfering. Off-box, any interference would show as a digest mismatch and fail closed.
- **Fix:**
  - Add a fixture test with a parent `package.json` containing a `browser` map and `sideEffects:false`, plus a parent `tsconfig.json` with `paths`, and assert identical output.
  - If output changes, add `"browser":{}` to the neutral boundaries and the root `package.json`, then confirm esbuild treats an empty map as a scope boundary.

### F-5 · LOW: the publish path still builds from the live dependency tree with the operator's environment
- **Where:** `publish-ecosystem.sh:17-18` runs `update-web-hashes.mjs` and `build.mjs` without `--require-frozen` or `env -i`.
- **Effect:** published bytes are checked against the pins (`:36`), so the result fails closed. But the toolchain and environment that actually produce them are not the reviewed ones.
- **Fix:** require `CBOB_BUILD_DEPS`, pass `--require-frozen`, and run under `env -i`, as `prepare-ceremony.sh:22` does.

### F-6 · LOW (missing verification): `rebuild-ceremony.mjs` has no test
- **Untested gates:**
  - the review chain: Pin review line, only README changed since the review commit, only the review file changed since the reviewed source, and every changed hash present in the review (`:18-33`);
  - the clean tree after builds (`:46`);
  - the self-verification (`:53`).
- **When first exercised:** in the real off-box run.
- **Fix:** add a fixture repository test with positive cases and one refusal per gate, and add it to the `PREPARATION_FLOOR` set in `run-tests.sh:297-298`.

### F-7 · LOW: the fingerprint dirty check skips the root `package.json`
- **Where:** `update-web-hashes.mjs:38` limits `git status` to `web bank scripts launch`.
- **Why it matters:** the root `package.json` now affects how esbuild and Node resolve files.
- **Effect:** an uncommitted edit there could change accepted pins. A later clean rebuild or publish would fail closed.
- **Fix:** check the whole tree, as `rebuild-ceremony.mjs:15` does.

### F-8 · INFO
- **Synthesized release record:** `recover-release-dist.py:24` writes `commit <RELEASE_COMMIT>` and `dirty no` into `MANIFEST.txt`. So `build.mjs:76-77` passes on a label taken from config, not from the archive. The real binding is the hash check (`:19`, and again at `build.mjs:79-84`), which is sound.
  - I confirmed `dependency-release-inputs.json` matches all five `config.js:51-55` hashes, and the release commit is `d2ae5fce…`.
  - The archive itself comes from CI source `a30924c7…` (`CEREMONY-WINDOW.md:120`).
- **Python and Node checks differ slightly:** in `install-ceremony.py:14-15`, extra fields in a package entry are refused; in `ceremony-build.mjs:52-55` they are allowed. The installer is the stricter one, which is harmless.
- **Identity file after rename:** `install-ceremony.py:46-50` writes the identity file after the rename. If it already exists, the artifact is left installed without one, which fails closed.
- **Output-directory race:** `rebuild-ceremony.mjs:34,54` checks that the output does not exist, then renames into it. On Linux the rename can replace an empty directory created in between. Same user only.
- **Check scope:** the launcher checks README pins only for the ceremony app and `style.css` (`ceremony-build.mjs:33-36`). The other attested pages rest on the artifact digest.

No other replay, concurrency or custody issues are in this scope.

---

## Evidence assessment

- **Preparation suite** (`dependency-preparation-1173a21.log`): 118/118 against a clean 1173a21. That includes the real frozen escape test (105) and the 12 Python freeze, installer and recovery cases (104).
- **Rebuild receipt** (`dependency-rebuild-1173a21.json`):
  - Both profiles produce identical files in all three builds: installed, frozen-a and frozen-b.
  - The two frozen input records are identical (`dcc8…`). The installed records differ only in `snapshot` and `packages`; the build-input lists are asserted equal.
  - The server bundle is `d53ae9fe…` in all three builds.
  - The tree is clean before and after.
  - The two freezes came from different inputs: a discovery record `5028…`, and `3128…`, which is the committed lock (matching the hosted log's lock hash). Both reconstruct snapshot `8b6263c3…`, the value in `build-dependency-lock.json:391`.
- **Hosted log:** shows the real launcher, attestation and frozen server-bundle path, with refusals. The page record in it is synthetic, as labeled.
- **Candidate:**
  - Every after-hash equals the receipt's profile hashes and the two `BUILD.txt` files. Both files record commit 1173a21 with no dirty marker.
  - Every before-hash equals `web/README.md:396-415`.
  - Its provenance records show snapshot `8b6263c3…`, node v20.20.2 and esbuild 0.25.0.
  - 18 rows change; `history/app.js` is unchanged in both profiles.
  - Because my tools are read-only, I could not hash the candidate files myself. The byte identity rests on the build tool's own hashes and the three-way receipt.
- **Link to the reviewed UI:**
  - `ballot-build-final.log` (pre-`5b2dbfa`) already shows the same mainnet `vault`, `market`, `claim`, `buy`, `redeem`, `account`, `style.css` and ceremony `app.js` hashes.
  - `governance/app.js` changed afterwards. I confirmed that the only bundled change recorded since, `5b2dbfa`, is the addendum's recommended `externalError=null` (`pages/governance.mjs:45`).
  - `STEP-CHECK-STATUS.md:26` states no `web/` or `bank/` changes through `a07a510`.
  - I could not run `git diff 5b2dbfa 1173a21` on the bundled paths. Attaching that diff to the acceptance record is recommended.

---

## Verdicts

- **Portable builder, installer and workflow at 1173a21:** no security or correctness blocker as inert preparation source. F-1 should land before the acceptance run, or the README diff should be checked by hand. F-2 should land before publishing the `mainnet` pages. F-3 should be confirmed before the first workflow run.
- **Fingerprint acceptance:** supported. It binds reviewed source 1173a21, built with the committed frozen snapshot, to the 20 hashes below. It relies on the earlier ballot reviews for the content of the bundles.
- **Not approved by this review:**
  - install;
  - private or hosted delivery;
  - signing;
  - holder or trading enablement;
  - lock;
  - publication of the `mainnet` pages.
- **Still required:**
  - the full offline suite rerun after acceptance;
  - the off-box workflow run, with its digest compared to the local candidate and delivered outside the Bank site;
  - real Phantom and member acceptance;
  - independent triage of this report.

**Accepted after-hashes** (all 20 rows; 18 changed, `history/app.js` unchanged in both profiles):

| profile | file | before | after |
|---|---|---|---|
| mainnet | claim/app.js | fe71122fa5954ab4be1c5852756fdae3d84f1c9925186b16a6b961d204f09c32 | e52f3609dd1a5cd8957db8f1a598773869b385c826ddc505815614faac0d24d4 |
| mainnet | market/app.js | 5d119f12e0a507c098f5b6c3c008fc55c1378b1dd86479134df159654ffdc62b | 9dcc29bb0cbbe129f590b2efe69c73fbec5cb82b2e96a1a0c3f9ddc41b9e553d |
| mainnet | buy/app.js | fd44306ac9e4585a23140f4e2c378ead5404a3d691512e8c3db6a9011d81e9d9 | e88d75aed5e012e5e98a80408ef331c3d29a0dffef25e769b7c2102274d4f8d5 |
| mainnet | account/app.js | 36f8fb5facd3917eab93fe8cae3480f899a89728c4a1f9eec079dddc7813a663 | e5fe2d2084a6ab7aaa75c72ae8dac841c816e4db077ef927f1a8e3377f427e36 |
| mainnet | history/app.js | 0eaaa91c0590cd73dad1ad3534ddca7eb666186cc67793d64c9b9ab9c85ad44e | 0eaaa91c0590cd73dad1ad3534ddca7eb666186cc67793d64c9b9ab9c85ad44e |
| mainnet | assets/style.css | 3085e60282d8743e2c0fc4148662ff3ad130b346647ecec6a83505c1c5291656 | 84770aad9ec0e9c572e298187e39ed82fac4835ee08a2b06646a22f1ab492684 |
| mainnet | governance/app.js | 388867209dea280552919f4a63d04d88757abfc8e147dcffa6a4ed5536c5c494 | f6e2c29980ce65bdb52bb85b082878f974d3e5fefbee04dc6f405b11403af5f0 |
| mainnet | redeem/app.js | 25221d4df2f50b61859f6f5041807a301b636c2f451e2a6fad4a81f45e6c3134 | 6e633071e6a2b2cbd0720c7ca13d0a4b5a9536387d4d92f1f9a372edd1d6e86d |
| mainnet | vault/app.js | 5e1501ad62e45c94c47a8eb6218968c37e66b40a735c6f0282a60837e508971f | 3cf17f15d4f8f56398cde5abe19ab72c3873aefb2374dd7b49b98a6c60319be6 |
| mainnet | ceremony-0cfecdcaf80584b6/app.js | 419b8b90adfd033f59f97a8bec0b212bc04f5c4e5a661c60c87f3f0b736e1666 | 6f3734b0f56b730b75db2c8b492267499bf1b193f3cdb9cba03ea890b4ca98ba |
| mainnet-local | claim/app.js | ae193dfeee6d5af4457147e1c7975672634b8b79e70f20b1066d7475d30dd62c | b12e9f1dc3c5676797f8b341eb128ace1af3189e9222bdb64dba105d9854241b |
| mainnet-local | market/app.js | 7116c8ec5f50530e74e23554ebb968c867e2829e6ce755d024c450fd282b0cff | 0b2792d797aee1772ccd16f252c5edea13e9a5077c5ad148271db97f95a63f0f |
| mainnet-local | buy/app.js | e747e952bb7e05127a802f9e8dada2e34eb0b56e5ccd567b0f6b053be15f2c2a | 4423509c7e8aab206ccb79cc5deb67001ffe895ae53029b59e1d341777fd8db2 |
| mainnet-local | account/app.js | 36f8fb5facd3917eab93fe8cae3480f899a89728c4a1f9eec079dddc7813a663 | e5fe2d2084a6ab7aaa75c72ae8dac841c816e4db077ef927f1a8e3377f427e36 |
| mainnet-local | history/app.js | 0eaaa91c0590cd73dad1ad3534ddca7eb666186cc67793d64c9b9ab9c85ad44e | 0eaaa91c0590cd73dad1ad3534ddca7eb666186cc67793d64c9b9ab9c85ad44e |
| mainnet-local | assets/style.css | 3085e60282d8743e2c0fc4148662ff3ad130b346647ecec6a83505c1c5291656 | 84770aad9ec0e9c572e298187e39ed82fac4835ee08a2b06646a22f1ab492684 |
| mainnet-local | governance/app.js | 388867209dea280552919f4a63d04d88757abfc8e147dcffa6a4ed5536c5c494 | d4e0db088a4862e6299256f3c5d98ce1f68f044ba3f9b2bfae13dcf403a83b80 |
| mainnet-local | redeem/app.js | 327cdfcdcd7d3709d2a49459397519e1de14925ea225d44cf515fc541b296b9d | 70c6f40a54b98708842a20e90419b0a732d5271a99bef66965f15e8803ad6de5 |
| mainnet-local | vault/app.js | 0bbd70cb812c1da467c727125aa55352129cb225c4e022d9ab45d270f001067d | 6dfcb65c7e91d99d0390e4d8e732ca067de33e89b61f8d7d161f6dab3ecc6ea6 |
| mainnet-local | ceremony-0cfecdcaf80584b6/app.js | f6deea8396e39216a82d650a77859268bcb84cf6aed450b2ec9bb2200b115621 | 9e58b83c4844dfbbb397ded18fb047620832e091a5156958fb18407cd4d8ff5e |

Snapshot: `8b6263c38564d9ae4197f80d305324d569d4f6af45190e7e34146640c0038e94`. Node v20.20.2, esbuild 0.25.0.

Reviewed source commit: `1173a21790e2eebbaa3db92d11e5794c67c62076`
Pin acceptance: APPROVED for `1173a21790e2eebbaa3db92d11e5794c67c62076`
