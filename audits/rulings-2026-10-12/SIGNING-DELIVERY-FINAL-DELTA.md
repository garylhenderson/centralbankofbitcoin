# CBOB final delivery delta audit, `cb90612`

**What I read:** `SIGNING-DELIVERY-FIXES.md`, `install-signing-delivery.py`, `verify-signing-delivery.py`, `signing-activate.py`, `signing-refuse.py`, both units, the three nginx templates, and plan lines 195–267. The local `refs/heads/v6` is `cb90612cb9404de4d253725d229cb2b1e0b131a0` and HEAD is v6. I could not compute SHA-256 values, so the seven pins are unconfirmed. If they are wrong, the installer refuses before changing anything (lines 18–21).

## Blocker

**B-1. Medium (blocks execution, fails closed). The harness aborts at its first service start, because the I2 change broke its two retry loops.**
- **Where:** `verify-signing-delivery.py:113-120` and `:155-160` catch only `AssertionError`. Since I2, `mainpid()` raises `RuntimeError` at lines 62 and 66, and `run()` does too at line 36.
- **What happens:**
  1. `Type=simple` means `systemctl start` (line 112) returns as soon as node is forked.
  2. The first `mainpid()` call almost certainly runs before node binds 8790, so the `ss` check raises `RuntimeError`.
  3. That error escapes the retry loop and goes to `finally`, so the harness never gets past `sole_listener_matches_dynamic_service`.
- **Safety:** cleanup is still correct. No activation has happened at that point, and `finally` closes everything. So this is not a safety defect, but the harness cannot pass, and V1 evidence cannot be produced.
- **Fix:**
  - Catch `RuntimeError`, or better a dedicated `NotReady` exception raised by `mainpid()`, in both loops.
  - Add the missing `else: raise RuntimeError('Service failed to listen')` to the second loop. Today it falls through to `activate()`, which does fail closed through `listener_pid`, but it hides the cause.
- **Tests:** none of the 14 helper tests or 13 regression tests run the harness, which is why this was not caught.

## Not blocking: preflight items and cheap fixes

- **N-1. Low. The apex-edge check may fail falsely.**
  - Line 205 sends urllib's default `Python-urllib/3.10` User-Agent to the Cloudflare-proxied apex. Cloudflare's bot and browser-integrity checks commonly answer that with a 403.
  - That would fail `old_apex_edge_refuses` at the very end, after every closure test has already run.
  - **Fix:** send a normal User-Agent there, or use curl the same way line 206 does.
- **N-2. Low. The direct-origin check needs a publicly trusted apex certificate on the origin.**
  - Line 206 runs curl with verification on. If the apex origin serves a Cloudflare Origin CA certificate, curl exits 60 and the check fails.
  - **Preflight:** check once, by hand, which certificate the apex origin serves.
- **N-3. Info. A leftover drop-in fails safe but would block the owner window.**
  - If the harness is SIGKILLed between line 169 and its `finally`, `/run/systemd/system/cbob-ceremony@<commit>.service.d/99-…` stays until reboot.
  - The real owner start would then fail. It fails closed, because ExecStopPost clears the marker.
  - **Fix:** add "`systemctl cat` the unit shows no drop-in" to the owner-window checklist, next to the timer check.
- **N-4. Info. Lock files must not predate the A2 change.**
  - `delivery.lock` is now required to be root-owned with no group or other bits. A 0644 lock left in `/run/cbob-signing` from any earlier manual run since boot would make the refusal unit fail.
  - It still clears the gate first, so this fails closed.
  - **Preflight:** the lock is either absent or root-owned 0600.
- **N-5. Info. A late installer failure leaves partial state.**
  - Installer validation (`check-ceremony-env`, `systemd-analyze verify` on the template unit, and `daemon-reload`) runs after files are written at lines 61–73.
  - If it fails, the run cannot be repeated: lines 53 and 59 refuse because files now exist. The plan (lines 249–251) documents the manual restore, so this is accepted.
  - **Preflight:** confirm this host's systemd version accepts `systemd-analyze verify` on a template file.

## A1, A2, A3, I1–I4 and V1: confirmed closed

- **A1, closed.**
  - In normal mode, activation requires the timer to show `LoadState=not-found` and `ActiveState=inactive` (`signing-activate.py:153-158`). A failed or elapsed transient timer stays loaded, so activation refuses (fails closed).
  - The harness retires and resets the timer at line 151, before the owner-mode `activate()` at line 161, and again in `finally` (line 213).
- **A2, closed.** Both scripts create the lock with `O_CREAT|O_NOFOLLOW` and mode 0600, then check with `fstat` that it is root-owned with no group or other bits.
- **A3, closed.** Activation compares the active vhost and the rendered location include against the hashes recorded in the state file. The installer records the rendered hash at line 78.
- **I1, closed.** The installer creates temp files with umask 077 and `O_EXCL|O_NOFOLLOW`, sets owner and mode before writing (`fchown`), and calls `fsync` before `os.replace`.
- **I2, closed.** All safety checks are explicit raises. Execution from root-owned `-I` copies is documented at plan line 244.
- **I3, closed.** The ancestry check plus seven pins all run before any mutation, and the installer reads every file from the git object, never the working tree.
- **I4, closed.** The harness swaps the runtime auth under `delivery_lock`, only while the gate exists (lines 144–147).
- **V1, present.** The harness covers:
  - startup failure;
  - lock contention while the backend is stopped;
  - after each closure: refusal bytes, `Result=success`, no runtime auth, port closed;
  - HTTP 301, ACME, direct DNS, and the 410 edge and origin checks;
  - recording of the refuse and ceremony unit properties.

## Disposition

**The installer is ready to run as root from the pinned `cb90612` object.** I found no correctness or security blocker in it, or in the A1–A3 changes.

**The harness is not ready.** Fix B-1, a two-line exception change, and re-pin before running it. N-1 and N-2 are recommended in the same edit, so the run does not false-fail after doing all the closure work. Nothing in the delta can leave the signing route open.
