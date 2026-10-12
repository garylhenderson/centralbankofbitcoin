# Audit: CBOB signing delivery, automatic closure (on-disk changes after fbad5be)

**Scope read in full:** `web/deploy/signing-refuse.py`, `signing-refuse.test.py`, `cbob-signing-refuse.service`, `cbob-ceremony@.service`, `nginx-signing-active.conf`, `nginx-signing-location.conf.example`, `nginx-signing-refusal.conf`, `launch/SIGNING-DELIVERY-2026-10-12.md`, and the prior review.

**Narrow cross-checks:**
- the `include` lines in `/etc/nginx/nginx.conf`;
- a `/home/` grep across `/etc/nginx` (file names only);
- `hostedListener`, `serverConfig` and `forwardFetch` in the installed artifact's `ceremony-server.mjs` (lines 31717–31726 and 31874–32013).

I read no secrets, env files, htpasswd or PM2 data. Nothing was run.

## Verdict

The design is sound. The gate is removed before any step that can fail, nginx re-checks it on every request with no file cache, and it fails closed at boot. But two defects can leave the gate **open after the backend has died** (D1, D2). Activation exists only as prose (D4). **Fix D1–D4 before Stage 2 step 5 (activation).** D1–D3 are a few lines each. Installing the units (Stage 2 steps 3–4) is fine once D1's fix is in the committed unit.

## Defects

**D1. High, blocker. Systemd's start rate limit can silently skip closure on the stop path.**
- *Where:* `cbob-signing-refuse.service` has no `StartLimitIntervalSec`. `cbob-ceremony@.service:12,21,22` starts it three times per ceremony lifecycle (ExecStartPre, ExecStop, ExecStopPost).
- *Why it fails:* the default limit is 5 starts in 10 s, and it counts every start of a oneshot unit, successful or not. Once it is hit, `systemctl start` is refused immediately with "start request repeated too quickly". The helper never runs, so `/run/cbob-signing/open` is never removed.
- *How it happens:* two quick start/stop cycles are enough. Examples: a start that fails at check-env, then a retry, then the planned stop and forced-kill tests (plan lines 198–199) run back to back. A crash shortly after a restart does the same.
- *Result:* the backend is dead but the gate is open. nginx keeps sending Gary's authenticated requests to 127.0.0.1:8790, and any local process can bind that port (see D3).
- *Fix:*
  - Add `StartLimitIntervalSec=0` to the refuse unit's `[Unit]` section.
  - In the ceremony unit, add `ExecStop=+/usr/bin/rm -f /run/cbob-signing/open` and the same as `ExecStopPost=+…`, each placed before the matching `systemctl start` line. That removes the gate even when no new systemd job is allowed to start, which also covers D5.
  - Add a rapid-cycle check to the stop/kill rehearsal: six or more refuse starts within 10 s, then confirm the marker is absent.

**D2. Medium-High. The closure blocks forever on the lock, and the gate is only removed after the lock is taken.**
- *Where:* `signing-refuse.py:55-57`. `fcntl.flock(LOCK_EX)` has no timeout, and `gate.unlink` runs inside `close()`, after the lock is acquired.
- *How it fails:* an activator holds `delivery.lock` and hangs or is paused (a stalled operator shell or REPL), and the ceremony then crashes or expires.
  - The ExecStop closure waits on the lock until its `TimeoutStartSec=25` kills it.
  - The ExecStopPost closure does the same.
  - The gate is never touched, so the route stays open with no backend.
  - This is a lock deadlock. The activator side is not implemented, so nothing bounds how long it holds the lock.
- *Fix:*
  - Unlink the gate before taking the lock, which needs no lock.
  - Acquire the lock with a bounded wait (`LOCK_NB` retried for about 15 s), then unlink again and do the vhost swap.
  - If the lock cannot be acquired, still exit non-zero, with the gate already gone.
  - The activator must recheck MainPID while holding the lock, immediately before creating the marker. Then the activator either sees the death or its marker is removed by the second unlink.

**D3. Medium. nginx forwards Gary's basic-auth password to whatever is listening on 8790.**
- *Where:* `nginx-signing-location.conf.example:19-25`. nginx passes the client's `Authorization` header upstream by default.
- *Why it is avoidable:* the artifact never uses that header. `hostedListener` checks only `x-cbob-ceremony` (`ceremony-server.mjs:31927-31931`), and `forwardFetch` sends only `content-type` to the RPC (`:31721`).
- *Result:* any window covered by D1 or D2, plus the milliseconds between a crash and ExecStop, hands Gary's reusable password to a rogue listener on 8790.
- *Fix:* add `proxy_set_header Authorization "";` to the location template. The server needs no change.

**D4. Medium, blocker for Stage 2 step 5. Activation is prose only, with no reviewed code and no tests.**
- *Where:* plan lines 194–197. It describes the most safety-critical sequence: hold the lock, check MainPID, write the vhost, run a strict `nginx -t`, reload, recheck MainPID, and create the marker last. A session would perform it by hand.
- *Fix:* commit a root-only `signing-activate.py` and review it like `signing-refuse.py`. It should:
  - refuse to run unless the ceremony unit is `ActiveState=active` and `SubState=running`;
  - check that MainPID owns the only listener on 8790, with nothing on `0.0.0.0:8790` or `[::]:8790`;
  - write the active vhost atomically;
  - fail on `conflicting server name` or any `nginx -t` warning outside the recorded baseline (the refuse helper is right to be lenient here; activation must not be);
  - reload nginx, recheck MainPID, then create the marker root-owned 0644 with `O_CREAT|O_EXCL`;
  - on any exception, unlink the marker and run `systemctl start cbob-signing-refuse`.

  Add injected-runner tests in the style of `signing-refuse.test.py`: a MainPID change between the two checks, validation failure, reload failure, an extra listener on 8790, and a closure racing the activator.

**D5. Low. The closure cannot run during system shutdown.**
- *Why:* the refuse unit has default dependencies, so it conflicts with `shutdown.target`. During a shutdown, ExecStop's `systemctl start` is rejected.
- *Impact:* small. The gate lives on tmpfs, so it is fail-closed after reboot. Only the few seconds while nginx outlives the ceremony are exposed.
- *Fix:* the direct `rm -f` lines from D1 cover this.

**D6. Low-Medium. Retirement order can break nginx for every site on the box.**
- *Why:* both vhost states reference the `sign` certificate. The active state also includes `cbob-signing-location.conf`, which includes the proxy-secret file.
- *How it fails:* running `certbot delete`, or deleting either include, while `sites-enabled/cbob-signing` still exists makes `nginx -t` fail for the whole box. The next restart by any session then takes every site down. The same happens if a closure failed and the active vhost is still on disk.
- *Fix:* record the order in the plan's lifecycle section: remove the symlink, run `nginx -t`, reload, and only then delete the includes and the certificate.

**D7. Low. Helper filename mismatch in the plan.**
- *Where:* plan line 182 says to install `signing-refuse.py`, but the unit runs `/usr/local/libexec/cbob-signing-refuse.py` (`cbob-signing-refuse.service:7`).
- *Impact:* a mismatch fails closed (the ceremony cannot start), but it would waste the window.
- *Fix:* state the destination name.

**D8. Low, optional. Closed-state responses reveal the path.**
- *Where:* `location.conf.example:17`. The gate check runs in the rewrite phase, before auth, so the private path answers 503 while every other path answers 404.
- *Fix:* `return 404` makes the path indistinguishable from any other.

## Missing verification

- **Test coverage:** the tests exercise only `close()`. Nothing covers:
  - `main()`: the unsafe-directory check, a missing directory, lock contention (D2);
  - a missing target vhost;
  - unit-level behaviour.
- **Before the owner window:** on top of the planned normal-stop and forced-kill tests, check:
  - start-failure handling (ExecStopPost runs and the marker is absent);
  - the D1 rapid-cycle case;
  - a closure while the lock is held (D2).

  After each, confirm: the refuse unit's `Result=success`; the on-disk vhost SHA-256 equals the refusal template's; the marker is absent; HTTPS refuses; 8790 is closed.
- **Expiry:** the RuntimeMaxSec path is never exercised. It relies on systemd running ExecStop and ExecStopPost on a timeout stop, which it does. If you want direct evidence, rehearse on a throwaway instance with a temporary shorter drop-in, removed afterwards and never on the reviewed instance.
- **Unit properties:** record `systemctl show cbob-signing-refuse -p StartLimitIntervalUSec,DefaultDependencies,RuntimeDirectoryPreserve` after the D1 fix.

## Confirmed as stated

- The gate is unlinked before any read, write, validation or reload (`signing-refuse.py:31`), so a failed `nginx -t` or reload still closes the route. The tests check this before every external command.
- `open_file_cache off` sits in the same location as `if (!-f …)`, so the marker is re-checked on every request in already-running workers.
- `/run` is tmpfs, and only root can create `/run/cbob-signing` (refuse unit, mode 0755). After a reboot the marker is absent and any leftover active vhost answers 503.
- Neither unit has an `[Install]` section, so neither can be enabled at boot.
- The `+` prefix runs the hook commands outside DynamicUser, ProtectSystem and PrivateTmp. The node process cannot write `/run` (ProtectSystem=strict, plus directory ownership).
- No dependency cycle: the refuse unit declares nothing about the ceremony. Its 25 s timeout is under the ceremony's 30 s TimeoutStopSec. Concurrent closures are serialized by the systemd job plus the flock.
- ExecStop runs after a crash, a kill and a RuntimeMaxSec stop, and it closes the gate *before* SIGTERM on a normal stop. ExecStopPost also runs when startup fails.
- `nginx.conf` includes only `conf.d/*.conf` and `sites-enabled/*`. So `/etc/nginx/cbob-signing-*.conf` and the `.cbob-signing-*` temp files in `sites-available` are never loaded globally.
- No nginx config references `/home/`, so the refuse unit's `ProtectHome=yes` cannot break its `nginx -t`.
- RPC forwarding sends no client headers upstream, so the proxy secret and basic-auth credentials stay on the box.
