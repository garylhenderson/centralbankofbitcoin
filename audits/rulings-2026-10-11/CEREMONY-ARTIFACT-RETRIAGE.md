# CBOB signing follow-up audit at 8d493bf (`/opt/cbob-vaults`)

**How I reviewed it.** I used Read, Grep and Glob only. I made no edits and ran no git commands, tests, builds, network calls or external models. I opened no env or key files.

I read:
- `SECURITY-FOLLOWUP-2.md`, `CEREMONY-FOLLOWUP-TRIAGE.md` and `PREFLIGHT-0f964ce.json`;
- the signing hunks of `security-followup-v2.patch`;
- the working tree's `prepare-ceremony.sh`, `install-ceremony.py`, `bundle-ceremony.mjs`, `ceremony-build.mjs`, `launch-ceremony.mjs`, `cbob-ceremony@.service`, `verify-ceremony.mjs` and `update-web-hashes.mjs`;
- `ceremony-reads.mjs:80-196`, `ceremony-local.mjs:40-152`, `ceremony.mjs:51-168` and the `web/README.md` pin table.

**What I could not confirm:**
- That `node_modules` is git mode 120000. `.git/index` has exactly one `node_modules` entry, and `.gitignore:2` (`node_modules/`) does not match a symlink, so the claim is consistent. `prepare-ceremony.sh:26` enforces the link target at build time.
- That the patch is exactly 8d493bf. The working-tree files I read match the patch hunks.

---

## Verdict

- **Inert `--build`: nothing makes it unsafe.** It writes only under `/tmp` and `.cache/ceremony-artifacts`, starts no unit, and changes no DNS. It reads no RPC; the only network call is `git fetch`.
- **The build will refuse until the pins are re-accepted (V2-2).** After acceptance, it is fine as an inert candidate.
- **It is not yet usable as the reference for the independent rebuild (V2-1).**
- **`--install`: not until the independent rebuild exists.** The code now requires an explicit review commit and digest, which is correct.
- **Signing: BLOCKED.** See the list at the end.

---

## New findings

### V2-1 — HIGH (for the independent-rebuild gate): the signing page's dependencies are not recorded at all
- **Where:**
  - `bundle-ceremony.mjs:28-34` records metafile inputs, Node and esbuild versions for the **server** bundle only.
  - The page bundles come from `web/build.mjs`, which has `logLevel:'error'` (line 109), no metafile and no input record.
  - `ceremony-*/app.js` is the code that builds the transactions Phantom signs. It is compiled from `/opt/gary-club/node_modules`, the target of the tracked symlink (`prepare-ceremony.sh:26`). That is the live Gary Club app's dependency tree, changed by that app's own deploys.
  - esbuild itself comes from `/home/ubuntu/luna-remotion` (`build.mjs:31`).
- **Failure path:**
  1. The off-box rebuilder has no manifest of package versions or integrity to obtain independently. The only source is a copy of this box's tree.
  2. So a byte-identical "independent" rebuild proves only that the same bytes were copied, which is the exact threat SECURITY-FOLLOWUP-2 says it must defeat.
  3. Separately, any `npm install` or deploy in `/opt/gary-club` between pin acceptance and build or rebuild changes `app.js`. That fails closed at `prepare-ceremony.sh:28`, but costs a full new cycle.
- **Fix:**
  - Emit a metafile for both profiles' page bundles.
  - Record every input with its package `name@version`, the `package.json` integrity where available, and the file sha256 in the artifact.
  - At pin acceptance, freeze a dependency snapshot (a hashed tarball, or a dedicated `/opt/cbob-build-deps/<sha>` tree) and build from it, never from live `/opt/gary-club`.
  - The rebuilder fetches the named versions from the registry with integrity checks and must reproduce the bytes.

### V2-2 — MEDIUM (blocks pin acceptance as currently bound): stale review evidence, and a binding that is not checked
- **The pins are almost certainly stale:**
  - The patch changes `ceremony.mjs:63` and `ceremony-reads.mjs:175`. Both are bundled into `ceremony-0cfecdcaf80584b6/app.js` for both profiles (`README.md:399`, `:409`).
  - The patch has no `web/README.md` hunk.
  - So `update-web-hashes.mjs:24-27` exits 1 and `prepare-ceremony.sh:28` aborts under `set -e`.
- **If the README did change, that change is outside the reviewed patch.** Either way, the pins must be re-accepted.
- **The current record is an old review:** `README.md:681` binds `BATCH-2-RETRIAGE.md` at source `03e1c1e`.
- **The binding is not checked:**
  - `ceremony-build.mjs:37` checks the `source commit` field for format only.
  - `update-web-hashes.mjs:30` accepts any file of at least 100 bytes as "a completed review".
  - So a review of an older source, or of nothing, satisfies runtime and install.
- **Fix:**
  - In `prepare-ceremony.sh`, require that the review's source commit is an ancestor of `$commit`, and that `git diff --name-only <review-src> $commit` equals exactly `web/README.md`.
  - Require the review file to contain the accepted pin hashes, or `$commit`.
- **Acceptance condition:** the pin diff must touch only the two `ceremony-*/app.js` rows (and the directory name, if it changes). Do not accept a change to any other `mainnet` (public Bank) row under this review; the public site stays at 7298f12.

### V2-3 — MEDIUM (signing gate): a stranger's history padding still breaks the ceremony on day-of
**(a) Step 0 can still be re-offered.**
- The new stop (`ceremony-reads.mjs:175`) fires only for browser memory.
- The runbook mandates a fresh Brave profile. After step 0, if storage is lost or another profile is used, a padded genuine collection reaches `:190`. Step 0 is then re-offered with the copy "If you did not create any of them, step 0 below creates the real one" (`ceremony.mjs:63`).
- The impact is a duplicate collection, not lost funds, but N5 is only partly fixed.

**(b) The recovery cannot fit in the window.**
- The new recovery is "record it in the launch file and rebuild".
- That means a new commit, pin acceptance, independent rebuild, review and install, inside `RuntimeMaxSec=5400` (service line 22). Done in practice, this aborts the ceremony for days.
- A stranger can force it for about 0.025 SOL.

**(c) A padded history can block the lock permanently.**
- `verify-ceremony.mjs:46-47` (N6, correct in principle) needs `collectionCreator` to reach the create transaction on both providers.
- A padded history (more than 5,000 signatures, `:113`) makes `--after` refuse permanently, with no override.

**Fix for all three:**
- Capture the step-0 **transaction signature** out of band.
- Add an exact-signature path to both the page (the operator pastes it) and `verify-ceremony` (`--creation-signature`).
- Fetch that one transaction from both providers. Accept only if it succeeded, is Core `CreateCollectionV2` for exactly that address, and fee payer and signer are the launch key.
- A collection can be created only once, so padding cannot forge this.

### V2-4 — LOW/MEDIUM (signing gate): the new preflight arm is unproven and can be made to fail
- **Lamports are compared across providers at different slots** (`verify-ceremony.mjs:79-82`).
  - `minContextSlot` is a floor, not equality.
  - Anyone can credit lamports to REVENUE, the ATAs, the mints, the config PDAs or the collection with a plain transfer. A dust loop for 90 minutes costs well under 0.1 SOL and fails this hard gate.
  - An honest step landing between the two reads does the same.
  - There is no retry.
- **The N7 classification is still unfixed.** `independentPrograms()` (`:36`) is not wrapped in `need`, so a provider disagreement is still reported as "network read or decoding failed" (`:93`).
- **This code has never run successfully.**
  - `PREFLIGHT-0f964ce.json:128` shows the old check name.
  - None of these have passing evidence: the ATA, mint and collection comparison; lamports; the two-provider `collectionCreator`.
  - `collectionCreator` on `api.mainnet-beta` can make up to 5 `getSignaturesForAddress` and 25 `getTransaction` calls, which the public endpoint may rate-limit.
- **Fix:**
  - Compare owner and data only, or lamports at or above rent-exempt.
  - Retry a bounded number of times, aligning slots.
  - Report disagreement as its own named check, separate from network failure.

### V2-5 — LOW: "builtin-only runtime" covers only `require`
- **What the banner covers:** it wraps `require` only (`bundle-ceremony.mjs:12`).
- **What it does not cover:**
  - a non-literal `import()`;
  - a dependency's own `createRequire` or `module.createRequire`;
  - `process.dlopen`.
- **Why the build checks miss these:**
  - esbuild hides warnings from files in `node_modules` by default, so `built.warnings.length` (`:26`) does not see them.
  - The metafile `imports` (`:27`) does not list unresolved non-literal imports.
- **Why it is LOW:** runtime resolution from `/opt/cbob-ceremony/<c>/web/deploy` walks only root-controlled paths, so exploiting it needs root.
- **Fix:**
  - After bundling, scan `ceremony-server.mjs` and fail on any `import(` not followed by a string literal, any `createRequire` beyond the banner, and any `dlopen`.
  - Add `TemporaryFileSystem=/opt:ro` and `BindReadOnlyPaths=/opt/cbob-ceremony/%i` to the unit.
  - Confirm with the scan on the inert candidate.

### V2-6 — LOW: environment guard gaps
- **`UnsetEnvironment` is a denylist** (service line 11). It misses:
  - `LD_PRELOAD` and `LD_LIBRARY_PATH`, which systemd passes on from `EnvironmentFile`;
  - `NODE_USE_ENV_PROXY` and `HTTPS_PROXY` (Node 24 and later).
- **The launcher check cannot see `NODE_OPTIONS`.** `launch-ceremony.mjs:6` reads `execArgv`, which does not reflect `NODE_OPTIONS`.
- **The parent directory is not checked.** `check-ceremony-env.py:5-7` checks the files but not `/etc/cbob` itself. systemd re-reads env files when it spawns `ExecStart`, so a writable directory allows a rename-swap after the check.
- **Fix:**
  - Have the launcher allow only the expected `CBOB_*`, `PATH` and systemd variables.
  - Check that `/etc/cbob` is root-owned and not group- or world-writable.
- Exploiting any of this needs root under the stated threat model.

### V2-7 — LOW: no test exercises the production chain
- **The bundle smoke test** (`ceremony-build.test.mjs:997-1010`):
  - runs the default `mainnet-local` profile with no `CBOB_CEREMONY_COMMIT`;
  - so `pinnedBuildFor` returns null (`ceremony-local.mjs:131-133`), and an **unpinned, unrestricted** listener is tested.
- **The served-bytes / extra-file test** (`:988-996`) drives the source `localListener`, not the bundle.
- **Untested end to end:** launcher → `verifyCeremonyArtifact` → bundle → `hostedListener` (secret, path regex `:85`) with the manifest.
- **Fragile:** the 1.2 s kill timer can be flaky, and the gated suite now depends on `/home/ubuntu/luna-remotion`.
- **Fix:**
  - Add a test of the bundle in the `mainnet-hosted` profile with a manifest and secret.
  - Run the launcher path in a root-run rehearsal.
  - Make the day-of delivery script (F7) cover it.

### V2-8 — LOW: the installed installer is not verified
- `prepare-ceremony.sh:14` executes whatever is at `/usr/local/sbin/cbob-install-ceremony`.
- Nothing checks that copy against the reviewed `install-ceremony.py`.
- **Fix:**
  - Record its sha256 in the review.
  - The operator compares it out of band before `--install`.

### V2-9 — LOW: a partial candidate can be left behind
- **The move is not atomic.** `prepare-ceremony.sh:49` moves from `/tmp` to `/opt`. If those are separate filesystems, `mv` copies and then deletes.
- **One failure forces a new commit.** A failure mid-move leaves a partial `$candidate`, and `:18` then refuses any re-run for that commit.
- **Fix:** stage in `.cache/ceremony-artifacts/.tmp-*` on the same filesystem, then rename.
- **N10 is cosmetic.** `:27` still copies the live, untracked `dist`. The `config.js` program pins are the real control.

### V2-10 — INFO: reproducibility preconditions for the digest comparison
- **Why the digest is environment-sensitive:**
  - `build-inputs.json` records absolute dependency paths (`/opt/gary-club/node_modules/...`) and `process.version`.
  - `ARTIFACT.json` hashes `build-inputs.json`.
  - esbuild path comments depend on the source depth relative to `/tmp/<x>/tree`.
- **What the rebuild must match exactly:**
  - the Node version;
  - the esbuild version;
  - the absolute dependency path;
  - the staging depth.
- **Alternatively,** compare per file and diff `build-inputs.json` separately.
- **Write these requirements into the rebuild procedure.**

---

## Status of the earlier findings

| ID | Status |
|---|---|
| N1 | **PASS in code.** `install-ceremony.py:4-10` requires an explicit review commit and a 64-hex digest, hardens git, and compares the committed bytes to the digest. Nothing in code can tell an independent digest from one copied off the candidate; that is procedure only. See also V2-8. |
| N2 | The bad `ln` is gone (`:24-26`). Building in the stage directory and moving only on success: **PASS.** Dependency provenance: **OPEN** (V2-1). |
| N3 | **PARTIAL** (V2-5). |
| N4 | **PARTIAL** (V2-6). |
| N5 | **PARTIAL** (V2-3a/b). The copy is corrected and the test is strengthened (`ceremony.test` `:320`). |
| N6 | **PASS in code**, with no passing evidence. There is an availability risk (V2-3c). |
| N7 | **PARTIAL** (V2-4). The cross-check is widened; the disagreement classification is still wrong. |
| N8 | **OPEN by policy** (`verify-ceremony.mjs:42`). It needs an explicit owner acknowledgement. |
| N9 | **PARTIAL.** The gate is in place (`run-tests.sh`, floor 55, tests = pass = 55, fail 0). The production chain is untested (V2-7). |
| N10 | **Cosmetic** (V2-9). |
| N11 | **Runbook only.** I saw no 444 `default_server` config. Verify it on the box before any DNS record exists. |
| N12 | **PARTIAL** (V2-2). |

---

## Blockers to accepting the pins and building an inert artifact
1. **Re-accept the pins against 8d493bf, with a review that actually covers it** (V2-2). Confirm the pin diff is limited to the `ceremony-*/app.js` rows, then commit the README and build from that exact commit.
2. **Pass the current-source preflight and full offline suite at that commit**, including the 55-test preparation gate.
3. **Not a blocker for the inert build, but a blocker for using it as the rebuild reference:**
   - record the dependency and version manifest for the page bundles, and freeze the dependency snapshot (V2-1);
   - write the rebuild preconditions from V2-10 into the procedure.

## Remaining gates before signing
1. An independent off-box or separate-operator rebuild from an independently sourced, pinned dependency set, with the digest delivered out of band (V2-1, V2-10).
2. The installed installer's hash verified (V2-8), then `--install` with the operator-typed review commit and digest.
3. A day-of delivery script, which does not exist yet (F7). It must:
   - compare the listener PID with `MainPID`;
   - fetch every attested file through the real nginx path and get 200 with the same bytes;
   - get 404 for an unlisted file;
   - compare against the out-of-band digest;
   - exercise the hosted listener (V2-7).
4. Box checks:
   - `/etc/cbob` and its env files are root-owned and not writable by others;
   - the env allowlist or extra unsets from V2-6;
   - a 444 `default_server` on ports 80 and 443 before the `sign.*` DNS record exists (N11).
5. A passing two-provider preflight on current code inside the window. Fix the lamport flapping first (V2-4) and the disagreement classification (N7).
6. The exact-signature collection path, or the owner's written acceptance of the padding-abort risk (V2-3, N8).
7. D2, D10 and D13, plus the timing acknowledgement.
8. Independent triage of this report.
