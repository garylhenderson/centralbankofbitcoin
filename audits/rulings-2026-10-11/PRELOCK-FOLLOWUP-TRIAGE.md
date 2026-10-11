# Independent audit: commit 0f964ce (prelock follow-up) and the proposed `r1-alarm-v2.patch`

**Method and limits:** read-only, with Read/Grep/Glob only. Nothing was run: no tests, rehearsal, alarm, RPC or sudo. I did not read any env, credential or sudoers files. The committed `prelock-receipt.mjs` matches `security-followup.patch`; I spot-checked lines 47, 51 and 69. Pass counts quoted below come from the commit's own record, not from runs I did.

## Verdict

- **Signing pages and lock: not certifiable yet.** Two blockers remain, both in the seal → archive → verify path. Neither the rehearsal nor any test has exercised that path, and it depends on a sudo setup that hasn't been decided.
- **Alarm patch v2: safe to apply once precondition P1 below is met.** It is strictly better than the live code for F3. It doesn't relax any check, and rehearsal behaviour is unchanged.

---

## Blockers

### NB1. The rehearsal never exercises archiving or `--verify`, so their first real run is inside the 24-hour window

**Where:** `scripts/prelock-receipt.mjs:45`, `:47`, `:68-69`.

**What happens:**
- In `--rehearse` mode, `--seal` prints "REHEARSAL PASSED" (line 68). It never calls `sudo python3 seal-prelock.py`.
- `--verify` refuses every path except `/var/lib/cbob-prelock/run-*` (line 47).
- So the rehearsal skips all of these:
  - the sudo call (it might prompt for a password and hang unattended, or be denied);
  - the Python sealer;
  - checking that the Python and JS digests agree (see NB2);
  - creating the root archive and checking its permissions;
  - the ancestor-permission loop (line 53);
  - the `--expect` comparison;
  - the whole verify path, including the third and fourth two-provider reads.
- If any of these fails during certification, `result.json` has already been written with `wx` (line 66). Re-sealing the same directory then fails, so the only fix is a new multi-hour run inside the window.

**Fix:**
- Rehearsal should go through the same sealer into a separate root path (for example `/var/lib/cbob-prelock-rehearse/`).
- Add a `--verify-rehearsal` mode that shares every check except the window and the `passed` status. It must still never be accepted by `--verify`.
- Separately, add fixture tests that call the CLI end to end on a temp directory with injected fake `prelock-core` output.
- Run the rehearsal before the window.

### NB2. The JS digest is over UTF-8-decoded text but the Python digest is over raw bytes, so any non-UTF-8 byte in a log aborts archiving

**Where:** `prelock-receipt.mjs:51` reads `fs.readFileSync(f,'utf8')`, and `evidenceDigest` (line 13) hashes the re-encoded string. `seal-prelock.py:12-14` hashes `read_bytes()`.

**What happens:**
- A stray invalid byte in any of the three suite logs (validator or cargo output, a truncated multibyte character, a progress bar) gets replaced by U+FFFD in JS.
- The two digests then differ, and Python exits with "Receipt changed before archival". Combined with the `wx` collision in NB1, the certification run is lost.
- Second, smaller effect: different raw bytes that decode to the same string share a digest, so the digest is weaker than it claims.

**Fix:**
- Read every evidence file as a `Buffer` and hash the raw bytes.
- Decode to text only inside `judgeEvidence`.
- Add a test with a `0xff` byte in a log, checked against a Python reference digest.
- Also add a test that `FILES` in `seal-prelock.py:4` equals `EVIDENCE_FILES` (it is currently a duplicated list that can drift).

### NB3. The sealer runs under sudo from the ubuntu-writable tree, and the sudo model isn't defined

**Where:** `prelock-receipt.mjs:69` runs `sudo python3 /opt/cbob-vaults/scripts/seal-prelock.py`.

**What happens:**
- **If** someone adds the natural scoped sudoers rule for that path, any process running as ubuntu can edit `scripts/seal-prelock.py` and run arbitrary code as root. That is a privilege escalation.
- **If** ubuntu already has broad passwordless sudo, then "root-owned archive" (B1 fix item 3) is not a boundary against same-uid automation at all. The only real anchor left is the externally recorded digest.
- No document says which of these is the case.

**Fix:**
- Have root install the sealer (and the verify-side trust checks) from the reviewed commit to a root-owned path such as `/usr/local/sbin/cbob-seal-prelock`. This is the same pattern `install-ceremony.py` already uses.
- Point any sudoers rule only at that installed path, with fixed arguments.
- Write down in PRELOCK-R1 which sudo model applies and what it does and does not protect.

---

## Should-fix

### SF1. Evidence provenance (B1 residual)

`--seal` accepts any staged files written by ubuntu (`prelock-receipt.mjs:51-59`):
- `.status` files containing `0`;
- logs containing the floor strings;
- a `core-before.json` and `core-after.json` that could be produced by actually running `prelock-core`.

So a session can fabricate a "passed" run, call `--seal`, and print a digest the owner would then record. The external digest proves "these bytes existed at seal". It does not prove "the suites ran".

**Fix:**
- The owner launches `prelock-check.sh --run` interactively and records the digest from that terminal only. State this explicitly in PRELOCK-R1.
- Preferably, run certification under a dedicated identity whose staging directory ubuntu cannot write.

### SF2. Bank upgrade authorities are compared for equality but never checked against an expected key

**Where:** `bank/live-programs.mjs:33`; `CORE_KEYS` and `judgeReceipt` in `prelock-receipt.mjs:10` and `:36`.

**What happens:** an unexpected authority (a compromised or misconfigured key) that stays the same before, after and at verify passes every check. `web/src/config.js` has no pin for the expected upgrade authority.

**Fix:** pin the expected pre-lock upgrade authority for each of the five programs, and refuse in `programObservation` if any differs.

### SF3. A date-pin mismatch makes the whole alarm pass throw, so every other detector goes blind

**Where:** v2 patch `lockDeadline()` throw, called at `alarm.mjs:434`. The catch is at lines 994-1007.

**What happens:**
- Drift, or any `git show` failure, kills the entire pass: revenue, config drift, vault and reserve checks all stop.
- The only thing still reported is the generic "ALARM FAILED TO RUN".
- It is loud, but for the whole duration it is a total loss of monitoring.

**Fix:**
- Push a CRITICAL `launch_date_pin_drift` finding instead of throwing.
- Return `min(running, committed, env>0?env:Infinity)`. If `git show` fails, fall back to `min(running, env)`.
- Add tests for both cases.

### SF4. The alarm's commit check stops uncommitted edits only

The patch checks `HEAD:bank/detectors.mjs`. A local, unpushed, unreviewed commit that postpones `RULED_DATES` passes without any notice.

**Fix:** also compare against `origin/v6:bank/detectors.mjs` using the last fetched ref, or against a root-owned pin. Report any difference as CRITICAL.

### SF5. Seal-path and CLI tests are still missing (S6)

There are no tests for:
- a dirty tree at seal;
- a directory outside `.cache/prelock`;
- a `wx` collision;
- a symlinked evidence file;
- a non-root or group-writable archive, or a writable ancestor;
- a wrong `--expect`;
- a mismatched mode file;
- `result.json` disagreeing with its raw evidence (line 63);
- `seal-prelock.py` (it has no tests at all).

All 24 tests target the pure functions only.

### SF6. Neither new test file runs in any certified suite

Grep finds no reference to `alarm-r1.test.mjs` or `prelock-receipt.test.mjs` in `scripts/*.sh`.

**Fix:** wire both into `run-tests.sh` with floors, so a regression fails certification.

### SF7. Second-provider fragility (S3)

**Where:** `live-programs.mjs:39` reads Core plus five ProgramData accounts (several MB of base64) from the public `api.mainnet-beta.solana.com` with `disableRetryOnRateLimit:true`.

This fails closed, but a 429 or a response-size limit can fail any of the four reads, including the verify that must be ≤60 s old right before the lock.

Also, `providerRpc()` (lines 9-13) reads `/etc/cbob/rpc-proxy.env`. That file was made minimal for the DynamicUser ceremony service (F8). It is unverified whether ubuntu can read it when `prelock-core.mjs` runs unprivileged.

**Fix:** prove both of these during the NB1 rehearsal. Pick a second provider that can serve the response sizes involved.

---

## The alarm patch (`r1-alarm-v2.patch`)

**What I checked:**
- `D` and `execFileSync` are already imported (`alarm.mjs:43`, `:45`), and no import of `check-launch-params` is added.
- In production the deadline is `min(ruled, valid env)`. The editable `mainnet-init.json` is never read in production.
- Invalid or ≤0 overrides fall back to the ruled value.
- Rehearsal behaviour is byte-identical to the live code.
- The regex matches the committed `detectors.mjs` line exactly.
- `lockDeadlineOf` still takes the minimum with `charter_opens_at`.
- The throw is caught by the `run_failed` notify path (lines 994-1007), so it fails loudly rather than silently.
- The bank selftest extracts `main()` with `lockDeadline` injected (lines 3737 and 4197), so the selftest doesn't depend on the function's internals.

**The tests (`scripts/alarm-r1.test.mjs`):**
- They extract the real function body text, which genuinely closes B2.
- They stub `execFileSync`, so they never exercise:
  - the `git` binary or the cron's PATH;
  - `cwd`;
  - git's `safe.directory` / dubious-ownership refusal when the cron user differs from the repo owner.
- Any of those failures turns into a permanent "ALARM FAILED TO RUN" and monitoring goes blind (SF3).

**P1, precondition for applying the patch:** as the crontab user of the alarm, confirm that `git -C /opt/cbob-vaults show HEAD:bank/detectors.mjs` succeeds, then confirm one `node bank/alarm.mjs --dry-run` completes. This is the owner's call to run; I did not run it.

**Afterwards:** SF3 and SF4 are recommended follow-ups. They are not reasons to hold the patch.

---

## Old findings: PASS / FAIL

| ID | Status | Evidence / residual |
|---|---|---|
| B1 | **PASS (verify side)** | `--verify` re-runs `judgeEvidence`, checks result.json against raw evidence (line 63), requires a root-owned non-writable archive and ancestors (51-53), and requires the `--expect` digest (54). Residual: SF1 provenance, NB3 sudo model. |
| B2 | **PASS** | 8 tests over the real function text are in the reviewed diff. Residual: git is stubbed (P1); not wired into any suite (SF6). |
| S1 | **PASS** | The pin moved to `detectors.mjs:15`; `check-launch-params.mjs:41` re-exports it; the alarm adds no new import. |
| S2 | **PARTIAL** | Uncommitted drift is now caught. A committed-but-unreviewed postponement is not (SF4). Drift kills the whole pass (SF3). The runbook text was added. |
| S3 | **PASS** | Dedicated provider plus public mainnet. They must agree on genesis and on every program's address, programdata, slot, authority, length and sha256 (`live-programs.mjs:37-41`). Residual: SF7. |
| S4 | **PASS (bytes) / PARTIAL (authority)** | All five Bank programs are checked against profile `programBytes` at HEAD, and must be equal before, after and at verify. The authority's expected value isn't pinned (SF2). |
| S5 | **PASS (runner)** | `prelock-check.sh:9-10` fetches, then requires `$3 == HEAD == origin/v6`, and prints why on refusal. Minor gaps: a `git fetch` failure exits with no message under `set -e`, and `--verify` doesn't re-check origin/v6. |
| S6 | **PARTIAL** | `judgeEvidence` cases are added. The CLI, sealer and archive refusals are untested (SF5). |
| S7 | **PARTIAL / not run** | The mode exists but has never run, and it skips archive and verify (NB1). If a Core-change diagnostic holds the validator lock, certification refuses because of `flock -n` (`validator-lock.sh:32`); that is correct, but it should be in the runbook. |
| S8 | **PASS** | The DRAFTS X text now includes "subject to the final lock and readiness checks". |
| S9 | **PASS** | The guide now says "diagnostic" and states that the Bank can't adapt after lock. |
| Minor: lock not tied to verify | **OPEN** | The lock step still doesn't call `--verify` itself. Note that verify can't be re-run between authority removals, because `bank_programs.*.upgrade_authority` changes. Use a dedicated per-step re-read instead. |
| Minor: stale message | **OPEN** | `detectors.mjs:2348` still names `mainnet-init.json`, and it becomes unreachable in production once v2 is applied. |

---

## Verification still needed (nothing here is certified)

1. **P1:** git and an alarm `--dry-run` as the cron user, after applying the alarm patch.
2. **An end-to-end rehearsal that covers sudo, archive and verify** (NB1). It must show:
   - the JS and Python digests agree on real logs;
   - two-provider reads succeed four times;
   - `/etc/cbob/rpc-proxy.env` is readable by the runner;
   - the tree stays clean after all three suites.
3. **The sudo model is decided and the sealer is installed root-owned** (NB3).
4. **The SF5 and SF6 tests are added and wired into floors.**
