**Verdict: approve the operational delta, with two non-blocking notes.** This is from reading the files only. I ran nothing and computed no hashes. I also can't confirm that the files match commit `584d9e76…`.

**Where I read the files:** The worktree `/scratch/cbob-launch-week` doesn't contain `web/deploy/…`. I read the copies under `/opt/cbob-vaults/web/deploy/` instead. I couldn't check that those copies match the banked commit, so the normal pre-deploy check should confirm it. I also didn't read `ProcessContainerFork.js`, because the tool is restricted to the working directories.

**What I checked**
- **`ecosystem.rpc-proxy.config.cjs`:**
  - It now sets `script: '/usr/bin/node'`, `interpreter: 'none'` and `args: ['--env-file=/etc/cbob/rpc-proxy.env', '/opt/cbob-vaults/web/deploy/rpc-proxy.mjs']`.
  - That makes `process.argv[1]` the real module path, so the guard at `rpc-proxy.mjs:314` (`process.argv[1] === fileURLToPath(import.meta.url)`) passes. That fixes the failure you described.
  - The restart and memory settings are unchanged: `max_memory_restart: '200M'`, `min_uptime: '10s'`, `max_restarts: 20`, `autorestart: true`, one fork instance.
  - I saw no secrets in the file.
  - If the env file is missing, Node exits on `--env-file`, so the failure is closed.
- **`rpc-proxy.mjs`:** The handler and request gate are untouched. The direct-entry block still binds only to `127.0.0.1`.
- **`rpc-startup.test.py`:**
  - It uses a private `PM2_HOME` in a temporary directory and a random loopback port.
  - The environment passed to PM2 is an allowlist (`PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`).
  - The upstream is `example.invalid`, so the test makes no upstream requests.
  - It checks that GET returns 405 with "POST only" and that a POST with no Origin returns 403.
  - It sets `autorestart` to false, runs `pm2 kill` in `finally`, and fails if cleanup fails.
  - It only rewrites the env-file path, so the launch shape stays the same as production.

**Notes (non-blocking)**
1. The test runs the hardcoded `/opt/cbob-vaults/...rpc-proxy.mjs` from the config, not the `ROOT` checkout it was started from. It only tests the code under review if it runs from that deployed path. Run it from `/opt/cbob-vaults` during go-live.
2. Node sets `argv[1]` to the unresolved path, while `import.meta.url` is the resolved real path. If any component of `/opt/cbob-vaults` is ever a symlink, the guard would fail silently again. The private-daemon test would catch that, so keep it in the go-live path.

This approval covers only this startup fix. It isn't a holder, trading or program-lock approval. The normal pins check is still required before deploy.
