# Narrow follow-up audit: prelock NB1–NB3 at `/opt/cbob-vaults` 8d493bf

**Method and limits:** read-only, using Read, Grep and Glob, with 9 file reads. I ran nothing: no tests, sudo, rehearsal or RPC. I read no env or sudoers files. I read:
- `SECURITY-FOLLOWUP-2.md` and `PRELOCK-FOLLOWUP-TRIAGE.md`;
- the working-tree `prelock-receipt.mjs`, `prelock-receipt.test.mjs`, `seal-prelock.py`, `prelock-check.sh`, `prelock-core.mjs` and `PRELOCK-R1.md`;
- the prelock section of `run-tests.sh`, by grep;
- the patch: lines 1–608 in full, then a hunk-index grep. The prelock hunks I read match the working tree.

Glob finds nothing under `/usr/local/sbin/cbob-*`, so the helper isn't installed yet, as expected. Glob can't tell me whether `/var/lib/cbob-prelock*` directories exist.

## Verdict

- **Installing the root sealer: OK**, using the exact command in R1 below.
- **Running `--rehearse`: hold for one small fix (B1).** As written, the rehearsal will very likely finish the suites and the archive, then fail at `--verify-rehearsal` with EACCES. The fix is one line in `seal-prelock.py`, or two `install -d` commands. Without it you lose a multi-hour run. Worse, fixing it by hand only for the rehearsal folder would leave the certification archive with the same defect.
- **Certification and lock: not assessed, and not authorized by this review.**

## New blocker (fix before the rehearsal run)

### B1. The archive parent folder is created mode 0700, so the ubuntu-side verifier can't read it — MEDIUM

**Where:**
- `prelock-check.sh:6` sets `umask 077`. That umask passes through `node`, then `execFileSync('sudo', …)` (`prelock-receipt.mjs:48`), then the helper.
- `seal-prelock.py:17` runs `parent.mkdir(mode=0o755, exist_ok=True)`.

**Failure path:**
1. By default, sudo runs the command with the user's umask combined with the sudoers default (0022). So the helper runs with umask 077, and `mkdir(0o755)` actually creates `/var/lib/cbob-prelock-rehearse` as `root:root 0700`.
2. The run folder (`chmod 0o550`, line 30) and the files (`0o440`, line 29) get explicit modes, but the parent doesn't.
3. The rehearsal CLI then starts `--verify-rehearsal` as ubuntu (`prelock-receipt.mjs:94`). `fs.realpathSync('/var/lib/cbob-prelock-rehearse/run-X')` (line 51) fails with EACCES, and the run ends in `NO LOCK: EACCES …` after the full suites.
4. Retrying `--seal` doesn't help. Python takes the "Identical evidence already archived" branch and exits 0, and verify fails again.
5. If someone fixes this by hand with `chmod 755 /var/lib/cbob-prelock-rehearse`, `/var/lib/cbob-prelock` is still created 0700 during the real certification. The final `--verify` then fails minutes before the lock. That is the NB1 failure class this rehearsal exists to remove.

**Caveat:** this assumes stock sudo behaviour (`umask=0022`, no `umask_override`). I didn't read sudoers. If either parent folder already exists as `root 0755`, that run won't hit this.

**Fix (either):**
- At the top of `seal-prelock.py`, add `os.umask(0o022)`. After the mkdir, explicitly `parent.chmod(0o755)`. Keep the existing ownership and permission refusal.
- Or create both parents once at install time, and have `prelock-check.sh` check them before starting any suite. The check should require owner `0:0`, mode 755 and not a symlink, for both `/var/lib/cbob-prelock` and `/var/lib/cbob-prelock-rehearse`.

Then add the install command to R1, for example:
```
sudo install -o root -g root -m 0755 scripts/seal-prelock.py /usr/local/sbin/cbob-seal-prelock
sudo install -d -o root -g root -m 0755 /var/lib/cbob-prelock /var/lib/cbob-prelock-rehearse
```

## Should-fix (not blocking the rehearsal)

### S1. The runner checks the helper's bytes but not its owner, mode or exec bit — LOW

**Where:** `prelock-check.sh:15`. It runs only `-f` and `cmp -s`.

**Failure path:**
- An `install` without `-m 0755` (or `cp` under `umask 077`) gives a root 0600 or 0700 file. `cmp` as ubuntu can't open it, so the runner refuses early with a misleading "Install the reviewed root sealer first". That's acceptable.
- A file that is world-readable but not executable passes `cmp`, and then `sudo -n` fails only at seal time, after the suites. That is retry-safe but wastes the run.
- An ubuntu-owned or group-writable install passes silently. That contradicts R1:13-14 ("root-owned, mode-0755").

**Fix:** also require `[ -x … ]` and `stat -c '%u:%g %a'` equal to `0:0 755`. Also require the `/usr/local/sbin` ancestors to be root-owned and not writable.

### S2. The "Python parity" test checks a copy of the digest code, not `seal-prelock.py` — LOW

**Where:** `prelock-receipt.test.mjs:39-44` runs an inline `python3 -c` reimplementation. Line 45 checks only that the `FILES` list matches. `seal-prelock.py:5` exits unless euid is 0, so no test ever runs its digest (line 14) or its archive logic. The rehearsal will be the first execution.

**Fix:** move the digest into a function behind `if __name__ == '__main__'`, import it from the test with `python3 -I`, and compare against `evidenceDigest`. The SECURITY-FOLLOWUP-2 wording ("agrees with Python") should say it agrees with a Python reimplementation until then.

### S3. An unexpected Bank upgrade authority is reported as an RPC failure — LOW

**Where:**
- `prelock-core.mjs:9` throws "Unexpected Bank upgrade authority".
- The `catch` at line 14 discards it and prints "inspect RPC and retry".
- `prelock-receipt.mjs:47` also discards stderr (`stdio: [..., 'ignore']`), so the operator sees only "Command failed".

**Failure path:** a real security signal (the SF2 pin tripping) reads as a provider glitch, and invites retries instead of escalation. Same shape as ceremony N7.

**Fix:** print a distinct message (and exit code) for the authority mismatch and for `matches: false`. Have `observe()` keep stderr.

### S4. The root sealer follows symlinks between its check and its read — INFO, under the stated threat model

**Where:** `seal-prelock.py:12-13` checks `is_symlink()` and then calls `read_bytes()`, in a folder ubuntu owns.

Because ubuntu already has unrestricted sudo, this gives no new privilege, and service identities can't write the `mktemp` 0700 staging folder. For defence in depth, open each file with `os.open(..., O_NOFOLLOW)` and `fstat` the descriptor.

## Status of NB1–NB3 (for the rehearsal only)

**NB1 — fixed in code, pending B1.**
- `--seal` always calls the archive (`prelock-receipt.mjs:83`), then the CLI runs `--verify-rehearsal` through `runReceipt` (line 94). Verify goes through the same owner, mode and ancestor checks, the `--expect` digest, `judgeEvidence`, a fresh `observe()` and `judgeReceipt`.
- `--verify` accepts only `/var/lib/cbob-prelock` with mode `certification` and status `passed`, so a rehearsal archive or status can't certify (lines 52, 55, 63; test line 64).
- Python independently binds the source folder to the mode (`seal-prelock.py:7-8, 16`).
- Retry rewrites nothing:
  - the JS side revalidates an existing `result.json` against raw evidence and the fresh read (lines 76-80; tests 58, 63);
  - Python's rename is atomic, and its existing-target branch accepts only byte-identical content (lines 20-25).

**NB2 — fixed.**
- Evidence is read as Buffers (line 58) and hashed raw (line 13). Text is decoded only for judging (line 15).
- The JS and Python digest formulas are the same construction, and the file lists are parity-tested.
- See S2 for what that test does and doesn't cover.

**NB3 — fixed in code and documented.**
- A fixed path is called with `sudo -n` and fixed arguments (`prelock-receipt.mjs:48`), with a `-I` shebang.
- The runner byte-compares the installed helper before the suites start (`prelock-check.sh:15-16`). See S1 for ownership and mode.
- R1:19-26 states that ubuntu has unrestricted sudo and limits root ownership to operational protection.

**SF2 — fixed for the pre-lock read.** `prelock-core.mjs:9` pins `FZjLB4e9…` for all five Bank programs, which matches `PREFLIGHT-0f964ce.json`. See S3 for the error message.

**SF6/N9 — gated.** `run-tests.sh:297-299` requires `# tests 55`, `# pass 55` and `# fail 0` across the three preparation files. I count 35 tests in `prelock-receipt.test.mjs`. I didn't count the other two files.

## What the rehearsal must show (it is evidence, not a blocker)

1. The helper is installed root 0755, and both archive parents are root 0755 (after B1).
2. The Python digest equals the printed JS digest on real logs.
3. The archived run folder is 0550 and its files are 0440 `root:ubuntu`, and `--verify-rehearsal` passes as ubuntu.
4. All four two-provider reads succeed, with the SF7 provider sizes and rate limits. `/etc/cbob/rpc-proxy.env` is readable by the runner.
5. The tree is still clean after all three suites, and `# tests 55` appears in `full-suite.log`.
