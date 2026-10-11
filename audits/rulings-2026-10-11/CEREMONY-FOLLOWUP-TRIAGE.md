# CBOB signing follow-up audit: commit 0f964ce (`/opt/cbob-vaults`)

**Scope and limits.** I used Read, Grep and Glob only. I made no edits, ran no git, tests, network calls or external models, and opened no env or key files. I read:
- the triage file, `SECURITY-FOLLOWUP.md`, and the signing hunks of `security-followup.patch`;
- the working-tree `ceremony-build.mjs`, `ceremony-build.test.mjs`, `ceremony-local.mjs`, `ceremony-reads.mjs`, `verify-ceremony.mjs`, `prepare-ceremony.sh`, `install-ceremony.py`, `bundle-ceremony.mjs`, `cbob-ceremony@.service`, `build.mjs` and `publish-ecosystem.sh`;
- targeted greps of `ceremony.mjs`, `rpc-proxy.mjs`, `config.js`, `.gitignore` and `scripts/`.

**The tree does not match the patch.** Working-tree `prepare-ceremony.sh:23-25` adds `ln -s /opt/cbob-vaults/node_modules "$stage/tree/node_modules"`, and that line is not in `security-followup.patch`. I could not check which one is 0f964ce. Settle that before any review is taken to cover 0f964ce.

**Not verified:**
- The `preflight-v2.json` preflight did not pass: it was refused on the network. **The two-provider claim has no passing evidence.**
- No candidate build, install or unit start has been shown to work.
- I did not assess the prelock, alarm or launch-parameter hunks in the patch.

---

## Verdict
- **Commit and push: safe (inert).** No unit is enabled. `publish-ecosystem.sh:25` copies only the named sections, so no ceremony page reaches the apex. `/var/www/centralbankofbitcoin` has no `ceremony*` path.
- **`--build` an inert candidate: OK only as a rehearsal, and it is expected to fail as written (N2).** Do not commit its `ARTIFACT.json` as the signing attestation.
- **`--install`: do not run** until N1 and N4 are fixed.
- **Signing: BLOCKED.** It needs N1, N2, N4, N5, N6 and N9 fixed, plus D2, D10, D13, the timing acknowledgement, and independent triage of this report.

---

## New findings

### N1 — HIGH (blocks install): the root installer's trust anchor is controlled by `ubuntu`
- **Where:**
  - `prepare-ceremony.sh:13` runs `sudo python3 web/deploy/install-ceremony.py "$candidate" "$(git rev-parse HEAD)" "$commit"`;
  - `install-ceremony.py:8` reads the attestation from that `HEAD`;
  - `install-ceremony.py:30` writes an expected digest computed from those same bytes.
- **How it fails:**
  1. A process running as `ubuntu` rewrites the candidate in `.cache/ceremony-artifacts/<c>`, for example the bundle.
  2. It regenerates `ARTIFACT.json`, commits it as `launch/ceremony-artifact.json` and pushes. Agent sessions hold push credentials, so lines 8-9 pass.
  3. The installer accepts. The identity env file records a digest derived from the same bytes, and `launch-ceremony.mjs` then passes.
  4. Simpler still: edit `install-ceremony.py` between the status check (line 7) and `sudo` (line 13). That file is in the working tree, owned by `ubuntu`, and runs as root.
  5. `python3` without `-I` also puts `web/deploy/` first on `sys.path`. A gitignored planted module there would run as root.
- **The review step cannot catch any of this.** `ARTIFACT.json` is a list of hashes from the same untrusted build.
- **This rests on an unchecked assumption:** that `ubuntu` cannot already act as root. If `ubuntu` has NOPASSWD sudo (the deploy scripts call `sudo` freely), then "root-owned" does not protect against a same-UID attacker. In that case the only real control is an independent rebuild, made off the box or as another user, compared out of band.
- **Fix:**
  - Install a reviewed installer once, root-owned (for example `/usr/local/sbin`), and run it with `python3 -I`.
  - Make the installer require `--expect-artifact-sha256` and `--review-commit`, typed by the operator from the review record and an independent reproducible rebuild. Never take them from `HEAD`.
  - Compare both the `git show` bytes and the candidate against that value.
  - Run git with `GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null -c core.fsmonitor= -c core.hooksPath=/dev/null`, or don't use git at all.

### N2 — HIGH: the build procedure is broken, and dependency integrity has moved to build time, not been fixed
- **The build always refuses.** `prepare-ceremony.sh:25` creates a `node_modules` **symlink** in the worktree, but `.gitignore:2` is `node_modules/`. A pattern ending in a slash matches only directories, and git treats a symlink as a file. So the line-30 `git status --untracked-files=all` should report `?? node_modules`, and every build refuses with "Isolated build changed source".
- **One failed build forces a new commit.** Line 28 has already created `$candidate`, and line 17 then refuses any re-run.
- **The patch version is worse.** Without line 25, resolution from `/tmp/cbob-ceremony-source.*/tree` walks up to `/tmp/node_modules`, which any local user can create.
- **F2's root cause is still there, now at build time.** Even when it works, the dependencies come from `/opt/cbob-vaults/node_modules`, which `ubuntu` can write and which is never checked against the lockfile. esbuild itself loads from `/home/ubuntu/luna-remotion/node_modules` (`bundle-ceremony.mjs:5`, `build.mjs:31`), an unrelated, unpinned tree. The attestation then freezes whatever those trees held.
- **Fix:**
  - Run `npm ci --ignore-scripts --offline` from the committed lockfile into the worktree, so the integrity hashes are checked.
  - Get esbuild from that lockfile and assert its version.
  - Record the node and esbuild versions plus the esbuild `metafile` inputs in `ARTIFACT.json`, and refuse any input outside the worktree.
  - Build in `$stage` and move the result to `$candidate` only on success.
  - Require two independent builds to be byte-identical.

### N3 — MEDIUM: bundle warnings are silenced, so runtime `require()` calls outside the artifact can survive
- **Where:** `bundle-ceremony.mjs:10-11` sets `logLevel:'silent'`, and the banner defines `require=createRequire(import.meta.url)`.
- **Failure path:** an optional dependency esbuild cannot resolve, inside a try/catch (for example `ws`'s `bufferutil`), stays as a live `require`. At runtime it resolves through the Node lookup paths, outside the attested tree. I did not verify whether any such call exists.
- **Fix:** use `logLevel:'warning'` and fail on any warning. Assert from the metafile that no bare external import remains except `node:` builtins.

### N4 — MEDIUM (must verify before install): environment injection can run code before the artifact gate
- **Where:** service lines 7-9 load three `EnvironmentFile`s. `NODE_OPTIONS` or `NODE_PATH` in any of them runs before `launch-ceremony.mjs`.
- **Why it is plausible:** `bank/live-programs.mjs:329` reads `/etc/cbob/rpc-proxy.env` as `ubuntu`, so that file is at least readable by `ubuntu`. If it is also writable, `NODE_OPTIONS=--import=…` defeats the whole attestation.
- **Fix:**
  - Add `UnsetEnvironment=NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS NODE_TLS_REJECT_UNAUTHORIZED`.
  - Add an `ExecStartPre=+` check that all three files are `root:root` and not group- or world-writable.
  - Have the launcher refuse a non-empty `process.execArgv`.

### N5 — MEDIUM: the F1 fix drops the genuine collection whenever its history is unverifiable
- **Where:** `ceremony-reads.mjs:163-166` drops a remembered value that is `unverifiable`. Line 177 then skips it during discovery, so the function returns `unverified` and step 0 is offered again.
- **Failure path:** after step 0 lands and before SEAL is initialized, a stranger pads the new collection's history past 5,000 signatures (about 0.025 SOL), or the RPC prunes it. Any reload then:
  - re-offers step 0, which can create a second collection; or
  - forces a `config.js` pin, which means a new commit, a new attestation and a new install, all inside the 90-minute unit lifetime.
- **The page copy is now wrong.** `ceremony.mjs:63` still says "Open this page in the browser that signed step 0 (it remembers it)".
- **Fix:**
  - If a remembered value is `unverifiable` (as opposed to `other`), do **not** offer step 0. Ask Gary to paste the address from the out-of-band step-0 receipt, and accept it only on an exact match.
  - Correct line 63 and add a test.

### N6 — MEDIUM: `--after` never checks that the final collection was created by the launch key
- **Where:** `verify-ceremony.mjs:33,40` passes `recorded` in as a pin (`fromLaunch`), so `collectionCreator` never runs on it. `readStep('collection')` checks identity fields that a decoy can copy.
- **Failure path:** a compromised page binds a decoy and shows that decoy as the receipt. SEAL then names the decoy, and `--after` passes.
- **Fix:** in `--after`, require `collectionCreator(...).by === 'launch'` on both providers, and record the creating signature.

### N7 — LOW/MEDIUM: the second provider covers only part of the preflight
- **Single-provider checks:** the collection account and its history, the reserve mints, the ATAs and REVENUE, and the probes (lines 39-70).
- **A security signal is reported as an outage.** "Independent providers disagree" (`live-programs.mjs:359`) is thrown outside `need`, so it is reported as "network read or decoding failed" (line 88).
- **False refusals are likely.** The setup-account comparison (lines 75-76) does not align slots, so it can refuse right after a step lands.
- **Fix:** wrap the comparison in `need()`, cross-check the collection account bytes and its creator, and use `minContextSlot` with a retry.

### N8 — LOW: a stranger can make the in-window preflight fail permanently
- **Where:** line 42, `need(!found.unverified?.length)`.
- **Failure path:** a padded decoy naming MINT's PDA fails the mandatory preflight every time, while the page itself would proceed. This check was already there, but the runbook now makes the preflight a hard gate minutes before signing.
- **Fix:** decide the policy. One option is to list the unverified addresses and require an explicit operator acknowledgement.

### N9 — MEDIUM: the artifact tests are not gated, and key paths have no tests
- **Not gated:** no runner references `web/deploy/ceremony-build.test.mjs`. It is not in `scripts/`, and `run-all.mjs`'s `FLOORS` don't include it. A regression would not fail run-tests or prelock.
- **No tests at all for:**
  - `install-ceremony.py`;
  - `bundle-ceremony.mjs`, including that exactly one listener starts;
  - `launch-ceremony.mjs` end to end;
  - `verifyCeremonyArtifact`'s branches for a missing required entry, a `source_commit` mismatch and an "Unattested page file";
  - a positive control that a manifest file is actually served with 200.
- **Tested only with injected stubs:** the tunnel test (line 22) injects `verify`, so it does not exercise the real guard.
- **Fix:** add the file to `run-tests.sh` with a floor, plus a temp-tree end-to-end test of bundle → launcher → listener.

### N10 — LOW: the build reads program bytes from the live tree, not the isolated copy
- **Where:** `prepare-ceremony.sh:26` copies `dist` into the worktree, but line 29 builds with `--dist /opt/cbob-vaults/dist`, the live tree.
- **Risk:** low, because `config.js` pins the program bytes. **Fix:** point line 29 at the copy.

### N11 — LOW: the signing origin can serve Bank content while its vhost is missing
- **Failure path:** while the `sign.*` DNS record exists but its vhost is absent (before install, or during "After signing" removal), nginx's `default_server` answers for that hostname. If that is the Bank vhost, Bank scripts run on the signing origin and can plant storage there: F1 again, on the new origin.
- **Fix:** keep a 444 catch-all `default_server` on ports 80 and 443, and remove the DNS record before removing the vhost.
- **Stale doc:** `nginx-mainnet-ceremony.conf.example:6` still says "Start ceremony-local.mjs".

### N12 — LOW: the review record is still checked by a pattern only
- `ceremony-build.mjs:37` still accepts any line matching `/^Pin review: /m`. Bind it to a review ID or hash.

---

## Earlier findings

| ID | Result | Evidence and what remains |
|---|---|---|
| **F1** | **PASS** for the planted decoy | `ceremony-reads.mjs:160-166` and three tests (`ceremony.test` R1). The hosted profile refuses the apex (`ceremony-local.mjs:115` and the ecosystem test), and the Bank navigation is gone from `ceremony.html`. **Remaining:** the N5 regression, and the out-of-band address comparison is still procedure only. |
| **F2** | **PARTIAL / FAIL** | The runtime symlink is gone and the bundle is attested (PASS at runtime). The build-time dependencies are unverified and can't currently be built (N2); there are silent externals (N3) and environment injection (N4). Startup is not checked against git object hashes, which a bundle can't be anyway. A reproducible-build comparison is needed. |
| **F3** | **PASS** (unit level) | `pinnedBuildFor` (`ceremony-local.mjs:131-136`) runs under `mainnet-local` whenever `CBOB_CEREMONY_COMMIT` is set or the path is under `/opt/cbob-ceremony`. The listener is restricted to the manifest (line 66). There is no end-to-end test (N9). An unpinned ad-hoc run from the working tree is still possible, which matters for F7. |
| **F4** | **FAIL** | The README now comes from the isolated worktree, and the verifier runs from the artifact (good). But the anchor is `HEAD`, and the installer is the working-tree copy run as root (N1). The "Pin review" binding is unchanged (N12). |
| **F5** | **PASS (conditional)** | The build is isolated and `index.html` is covered by the full `ARTIFACT.json`. The README still pins only `app.js` and `style.css`. The attestation is meaningful only with an independent rebuild (N1, N2). |
| **F6** | **PARTIAL** | `DynamicUser` and `RestrictAddressFamilies` are in place, which closes the `/proc/<pid>/environ` exposure. The stray `CBOB_CEREMONY_COMMIT` override is neither documented nor rejected, though it fails closed. Env-file permissions are unverified (N4). The unit has never been started: confirm DNS resolution works without `AF_NETLINK`. |
| **F7** | **PARTIAL** | Runbook text only (`CEREMONY-WINDOW.md`). There is no script that compares the listener PID to `MainPID` and fetches and hashes every attested file against an out-of-band digest. |
| **F8** | **PARTIAL** | Done in code: the dedicated env file (but it is the same provider as the relay), two providers for the programs and the four setup PDAs, `next` required before step 0, a recorded collection required for `--after`, and the slot recorded. **None of it has passing evidence**, because preflight-v2 was refused. Missing: a creator check on `--after` (N6), wider cross-checks (N7) and the DoS case (N8). |
| Doc | **PARTIAL** | Lines 27-28 were rewritten. The doc now makes the dedicated origin primary with the tunnel as fallback. The triage called the tunnel the signing path and said a dedicated origin needs new reviewed code. This change is that code, and D2 is still pending. |
| Blocker 2: guard test under `mainnet-local` | **PASS** (stub only) | See N9. |
| Blocker 3: planted localStorage test | **PASS** | `ceremony.test` R1. |
| Blockers 1, 4, 5 | **OPEN** | F2 and F4 not fixed. D2, D10, D13 and timing pending. The day-of checks have not been run. |

## Verification still needed before signing
1. Establish whether `ubuntu` has passwordless sudo, and state the threat model to match.
2. Produce two byte-identical independent rebuilds, one made off the box or as a different user, with the digest delivered out of band.
3. Get a successful `--build` → review → `--install` → unit start run, with a 404 for an unlisted file and a 200 for every attested file through the real delivery path.
4. Check ownership and modes for `/etc/cbob/*.env`, and confirm `NODE_OPTIONS` is unset in the unit.
5. Get a passing two-provider preflight on the current code, inside the window.
6. Add `ceremony-build.test.mjs` and the new end-to-end tests to the gated runner with floors.
