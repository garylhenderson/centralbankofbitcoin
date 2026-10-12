# Audit: `ceremony-hosted-rehearsal.mjs` and CEREMONY-WINDOW.md step 5

Read-only review. I read:
- `web/deploy/ceremony-hosted-rehearsal.mjs`, `launch-ceremony.mjs`, `ceremony-build.mjs`, `bundle-ceremony.mjs`, `ceremony-local.mjs`
- `rpc-proxy.mjs` (handler only)
- `cbob-ceremony@.service`, `check-ceremony-env.py`, `install-ceremony.py`, `prepare-ceremony.sh`
- `CEREMONY-WINDOW.md`, the V2-7 entry in `audits/rulings-2026-10-11/CEREMONY-ARTIFACT-RETRIAGE.md`, and `hosted-rehearsal.log`

**Verdict:** The script really runs the launcher, `verifyCeremonyArtifact` and the bundled `hostedListener` as uid 65534, against a root-owned tree at the real path `/opt/cbob-ceremony/<commit>`, including the real ancestor-ownership walk. I found no safety defect that could touch production. The fixture is inert:
- random port and secret;
- RPC upstream `127.0.0.1:1`;
- no env files are read;
- non-recursive `mkdirSync`, so it cannot delete an existing artifact.

The evidence is weaker than its labels, though, and is not tied to any commit. V2-7 should be recorded as **PARTIAL**, not closed.

---

## R1: MEDIUM. The PASS is not tied to the reviewed source or the candidate artifact

**Where:**
- `ceremony-hosted-rehearsal.mjs:18` and `:27`: `source` is whatever working tree contains the script, and it is re-bundled from scratch.
- `:34`: the launcher, `ceremony-build.mjs` and `check-ceremony-env.py` are copied from that same working tree.
- `hosted-rehearsal.log`: two PASS lines and nothing else.

**What goes wrong:** Nothing checks that the tree is clean, records `HEAD`, or records the hashes of the launcher, `ceremony-build.mjs`, the generated `ceremony-server.mjs` and `build-inputs.json` that were tested.
- The doc says "from the reviewed source" (CEREMONY-WINDOW.md:46-47), but nothing enforces it.
- A PASS from a dirty or older checkout reads exactly like a PASS from the reviewed commit.
- The test also exercises a fresh bundle, not the server bytes `prepare-ceremony.sh --build` placed in the candidate. V2-10 already says those bytes depend on the environment.
- So the log says nothing about the artifact that will actually be installed.

**Fix:**
- Refuse to run unless `git status --porcelain --untracked-files=all` is empty.
- Print `HEAD`, `process.version`, the esbuild version and the sha256 of every fixture file under `web/deploy/` into the log.
- Better: take `web/deploy/{launch-ceremony.mjs,ceremony-build.mjs,ceremony-server.mjs,build-inputs.json}` byte-for-byte from `/opt/cbob-vaults/.cache/ceremony-artifacts/<commit>`. Check them against that candidate's `ARTIFACT.json`, and pair them with synthetic pages. The PASS would then cover the attested server bundle itself.

## R2: LOW-MEDIUM. "RPC read guard" is mislabeled, and the accepted-origin path is never exercised

**Where:**
- Rehearsal `:65-67`.
- `rpc-proxy.mjs:244` (405 for anything but POST) and `:246` (403 when there is no Origin header, or it is not allowlisted).

**What goes wrong:** Node's `fetch` sends no `Origin`, so the POST 403 comes from the origin gate at `:246`. It is not a read or method guard. The rehearsal never sends:
- `Origin: https://sign.centralbankofbitcoin.com` with `Sec-Fetch-Site: same-origin`;
- a request from a wrong origin;
- a disallowed method from an accepted origin.

So a regression that stops `serverConfig` (`ceremony-local.mjs:113-117`) or the bundled handler from accepting the one hosted origin would still pass. It would first show up as a failed page in the owner's browser during the window. `refusal()` and the program allowlist in the hosted bundle are also never exercised.

**Fix:** Add three requests:
1. Accepted origin, `getSlot` → expect **502**. That proves the origin was accepted and the dead upstream was reached.
2. Accepted origin, a method that should be refused → expect **403** with the `-32601` refusal body.
3. `Origin: https://centralbankofbitcoin.com` → expect **403**.

Then change the PASS text to describe what was actually checked.

## R3: LOW. Nothing tests the root-ownership gate failing

**Where:**
- `ceremony-build.mjs:12` and `:47` (uid 0 and mode `& 0o022`).
- `ceremony-build.test.mjs:38-45` always passes `requireRootOwned:false`.

**What goes wrong:** No test anywhere runs the ownership or mode gate with a bad input. A root-run rehearsal is the only place one can. Today it only passes a good tree, so a regression that makes `check` or `trusted` accept non-root or group-writable files goes unnoticed. The startup refusals for a wrong digest, a wrong commit, and a page listed in `BUILD.txt` but missing from `ARTIFACT.json` (`ceremony-build.mjs:65`) are also untested through the real launcher.

**Fix:** Before the tamper step, run each case on a restored copy and assert the exit code and stderr:
- chown one page file to 65534 → `Writable or redirected artifact`
- `chmod 0664` on one file → same
- chmod the dist directory group-writable → same
- wrong `CBOB_CEREMONY_ARTIFACT_SHA256` → `Artifact attestation differs`
- a file listed only in `BUILD.txt` → `Unattested page file`

## R4: LOW. The tamper check races stdio against `exit`

**Where:** `:70-72`, `once(proc,'exit')` followed by `assert.match(stderr, …)` and `assert.equal(stdout, '')`.

**What goes wrong:** `exit` can fire before the child's stdout and stderr have been fully read.
- `assert.match(stderr, /Artifact bytes differ/)` can fail at random (a false failure).
- `stdout === ''` can pass without proving anything, because late stdout isn't captured yet.

**Fix:** Wait for `once(proc,'close')`, which fires after the stdio streams end.

## R5: LOW. Cleanup depends on `finally`, which signals skip

**Where:** `:74-79`.

**What goes wrong:** Ctrl-C, SIGTERM or an SSH hangup kills the process without running `finally`. That leaves a root-owned synthetic tree at `/opt/cbob-ceremony/<40-hex>`:
- It carries a valid `ARTIFACT.json`, and its name cannot be told apart from a real commit.
- It sits in the directory the runbook keeps as audit evidence (CEREMONY-WINDOW.md:125).
- If only the parent is killed, the nobody-owned listener can be left orphaned. It is inert, since the secret died with the parent, but it still holds a port.

The steps inside `finally` are also chained. If `stop()` or the first `rmSync` throws, the `parent` and `stage` cleanup is skipped.

**Fix:**
- Install SIGINT, SIGTERM and SIGHUP handlers that run the same cleanup.
- Print the fixture path before creating it.
- Write a marker such as `SYNTHETIC-REHEARSAL` at the tree root, outside the dist root, where the verifier doesn't look. Sweep marked leftovers at startup.
- Wrap each cleanup step in its own try.

## R6: LOW. The systemd startup wrapper is untested, and the doc doesn't say so

**Where:** rehearsal `:55` spawns node directly as 65534. Compare `cbob-ceremony@.service:5-22`.

**What goes wrong:** The rehearsal never exercises:
- `ExecStartPre` / `check-ceremony-env.py`, which is copied in (`:34`) but never run;
- `EnvironmentFile` parsing;
- `UnsetEnvironment`;
- DynamicUser, ProtectSystem and `RuntimeMaxSec`.

The launcher's `execArgv` check cannot see `NODE_OPTIONS` (V2-6), so the unit's `UnsetEnvironment` is the only guard against it, and that guard is still untested. CEREMONY-WINDOW.md:51-52 lists nginx, the certificate and owner-browser checks as still required, but not the unit wrapper.

**Fix:** Add one sentence to step 5 saying the systemd unit (env check, env stripping, sandbox, expiry) is not covered. Make the F7 day-of script assert it: listener PID equals MainPID, `ExecStartPre` succeeded, and the process environment has no `NODE_*` or `LD_*` variables.

## R7: LOW. V2-7 is closed for one run, not guarded against regressions

**Where:** CEREMONY-WINDOW.md:46-52, and the V2-7 fix list in the retriage document.

**What goes wrong:** The rehearsal needs sudo and is not part of the gated `run-tests.sh` suite. A later change to any of these files would still pass the gate without the hosted chain being re-checked:
- `launch-ceremony.mjs`
- `ceremony-build.mjs`
- `ceremony-local.mjs` (`hostedListener` regex, `serverConfig`)
- `rpc-proxy.mjs`
- `bundle-ceremony.mjs`

**Fix:**
- In the doc, require the rehearsal to be re-run on the exact build commit after any change to those files, and keep the R1-style log next to the review.
- Record V2-7 as PARTIAL until F7 exercises the hosted listener through real nginx.

## R8: INFO. Two of the three "unlisted file" probes prove less than they appear to

**Where:** `:64`.
- `/planted.js` and `/web/deploy/ceremony-server.mjs` are refused by the path regex (`ceremony-local.mjs:85`) before the attested-set check runs. The second path doesn't even exist under the dist root, so that probe proves nothing.
- Only `/ceremony-b2/app.js`, where "b2" is hex, reaches the `allowed` set check (`ceremony-local.mjs:66`).
- The test is correct but redundant. Keep the b2 probe as the real check and drop or relabel the other two.

## R9: INFO. `SUDO_GID` is not validated

**Where:** `:17` validates only `SUDO_UID`.

**What goes wrong:** A missing `SUDO_GID` gives NaN, and `chownSync` then fails safely. `SUDO_GID=0` would run the bundler as group root.

**Fix:** Apply the same non-zero digit check to `SUDO_GID`.

---

## Not covered by this rehearsal, and still open as separate gates

These are correctly not claimed by the script:
- real nginx and the basic-auth path;
- the certificate;
- `Cache-Control: no-transform`, which the server never sends. The server sends `no-store` only, so nginx must add it;
- the 444 `default_server` (N11);
- the independent off-box rebuild and dependency provenance (V2-1, V2-10);
- runtime tampering after startup. Files are served from disk without re-hashing, so this relies on root ownership plus the unit's ProtectSystem.
