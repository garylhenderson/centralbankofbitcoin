# Narrow deployment follow-up audit: `/opt/cbob-vaults` ecd31bf

**Verdict**
- **R1, R2 and R3 are resolved.** The delta adds no release blocker.
- **The new deployment path is approved for the owner-arranged re-triage.** Nothing here permits deployment by itself.
- **One material limitation remains (M1)**, plus six low-severity items. None blocks.

**Method:** Read, Glob and Grep only, in 12 targeted reads. I read:
- the full delta patch;
- `pin-public-data.sh`, `run-public-data.py`, `publish-ecosystem.sh` and the base `cbob-public-data.service` on disk, in full;
- `activate-public-data.py` in full through the patch (it is a new file, so the patch holds the whole file);
- owner-triage R1/R2/R3 and the TRIAGE-HANDOFF follow-up;
- targeted greps of `vault-index.mjs`, `governance-index.mjs`, `generate.mjs` and `publish-files.py`.

I ran no tests, git commands, network calls or tools. I have not checked the "9/9 pass" and "full offline suite" claims.

---

## R1: resolved (the factual correction is accepted)

- **What changed:** the earlier finding said a new worktree could not start because it had no dependencies. That premise was wrong: `node_modules` is a tracked symlink, so every worktree gets it.
- **New check:** `--check` (`run-public-data.py:14`) now proves at activation time that `bs58` (including the shape of its `encode` export), `@solana/web3.js` and all three data modules actually import.
- **The imports are side-effect free, which I verified:**
  - `vault-index.mjs:313` only runs when `import.meta.url === file://argv[1]`, and under `node -e`, `argv[1]` is undefined.
  - `generate.mjs:195` has the same kind of guard.
  - `governance-index.mjs` has no top-level calls.
- **The smoke check is effectively read-only:**
  - `--dry` returns before any write (`vault-index.mjs:268`). Its only side effect is `mkdirSync(STATE_DIR)` (`:214`).
  - The producer reads its RPC from an absolute path (`:123`, `:128`), so running the smoke from `/opt/cbob-vaults` instead of the worktree does not change behaviour.

**M1 (Medium, remaining limitation, not a blocker): the producer's dependencies are not pinned to the reviewed commit.**
- The symlink resolves to `/opt/gary-club/node_modules`. That tree changes whenever the gary-club app reinstalls its packages, and it sits in the same trust domain as the editing checkout.
- The git checks in `run-public-data.py:9` cover the symlink itself, not what it points to.
- **Failure paths:**
  - **Upgrade or partial reinstall:** if a gary-club deploy upgrades `@solana/web3.js` or `bs58`, or the install is caught midway, the timer runs code nobody reviewed.
  - **A missing import fails closed:** the public record goes stale, but nothing wrong is published.
  - **A change in behaviour is not caught:** a dependency that still imports but behaves differently could publish wrong public data.
  - **Re-check frequency:** `--check` runs only at activation, never on each timer run.
- **Fix (can wait):**
  - Have `--check` read each package's `package.json` version and assert it against a list kept in the repo.
  - Have the timer run the same quick version check before each refresh.
  - Long term, use a separately reviewed install with a lockfile.
- TRIAGE-HANDOFF:27 already states this honestly. Carry it into STATUS.md as an accepted risk.

## R2: resolved

- **The fail-closed base is now installed.** `activate()` writes the repo base unit (`ExecStart=/usr/bin/false`) before the override goes in (`activate-public-data.py:29`) and never puts the old base back.
- **It refuses a symlinked unit file** (`:12`).
- **Rollback never falls through to the editing checkout:**
  - If there was a previous override, rollback restores it on top of the new base.
  - If there was none, the timer stays disabled.
- **The new base works with the restored 61a4cf6 override.** The base only adds `NoNewPrivileges` and a timeout. The override resets `ExecStart` and sets `WorkingDirectory`, so the two are compatible.
- **Remaining gap:** the live box keeps the old editing-checkout base until the first successful `--execute`. That is unchanged and expected.

## R3: resolved

- **The order is now right:**
  1. `--prepare`: check plus the dry smoke. The unit is untouched (`pin:23`).
  2. Publish the pages.
  3. `--execute`: repeat the checks, install base and override, run `daemon-reload`, then the first refresh.
  4. On any failure, restore the pages and exit 1 (`publish-ecosystem.sh:46-49`).
- **The lock holds during activation.** The pin script keeps the `public-data.flock` lock on fd 8 in the parent bash process. sudo closes that fd in the child, but the parent still holds the lock, so the timer's `flock -n` cannot run during activation.
- **`publish-files.py --restore` exists** (`:57`).

---

## New low-severity items (none blocking)

| # | Where | Failure path | Fix |
|---|---|---|---|
| L1 | `activate-public-data.py:34-38,52-53`; `publish-ecosystem.sh:47-48` | If the restore write or reload inside `except` itself raises, the original error is hidden and the message still says "Previous override restored". The publisher also prints "restoring the previous pages" before the restore runs, and a failed `--restore` leaves no distinct error. | Catch restore failures on their own and print a separate "RESTORE FAILED, manual action" message. Check the result of `--restore`. |
| L2 | `activate-public-data.py:47` | The first run has no timeout, although the unit has `TimeoutStartSec=480`. A hung RPC call keeps new pages live and the lock held indefinitely, and rollback cannot start. | Add `subprocess.run(..., timeout=480)` and treat a timeout as a failure. |
| L3 | first-run failure path | `vault-index` writes `vaults.json`, `history.json` and the opened/financial ledgers. If `public-data.mjs` then fails at a later stage, pages and override are rolled back but those data and ledger writes stay. The schema is unchanged in this delta, so impact is low. | Document it, or snapshot `data/` and the ledger files into the activation backup and restore them. |
| L4 | `activate-public-data.py:48` | Full stdout and stderr go into `/var/backups/cbob-public-data/*/first-run.log`. The directory is root-only (`mkdtemp` makes it 0700). The producer handles `HELIUS_RPC_URL`, which contains a key, and any error that includes the URL would persist there. | Confirm `secret-log-sweeper` covers that path, or mask URLs before writing. |
| L5 | `pin-public-data.sh:16,19-21` | On a `--dry` failure, the trap deletes the smoke log before the operator can read it. | Print the tail of `$smoke` to stderr on failure. |
| L6 | `pin:18`; `--execute` repeats the network `--dry` | A transient RPC failure, or a timer run longer than 10s (it is allowed up to 480s), makes the publisher roll the pages back. This fails closed and only costs availability. | Make the `flock` wait longer, or accept and document. |

## Missing verification

- **The tests stub out the real paths:**
  - The import-guard tests use stub modules (`export const fixture = true`), so they never exercise the real `--check` import of the real modules.
  - The activation tests replace `daemon-reload` and the first run with lambdas.
- **Not tested at all:**
  - the real `runuser` and `systemctl` path;
  - refusal of a symlinked unit file;
  - a failing restore;
  - `pin-public-data.sh --prepare` and `--execute`;
  - the publisher's page-restore branch.
- **Unconfirmed claims:** the 9/9 result and the full offline suite. Re-triage should confirm both.
- **Publication gate:** `git diff --name-only 5f6b993 ecd31bf` should list only `web/deploy/*`, `web/test/public-data-deploy.test.py` and `audits/`. I could not run it.

## Carried-forward constraints (unchanged)

- Until the new source is installed, the live 61a4cf6 producer still reads `launch/mainnet-init.json` from the editing checkout. Do not edit that file uncommitted.
- `STATE_DIR` is still hard-coded inside the editing checkout (`vault-index.mjs:42`), so a `git clean -fdx` there would wipe the opened-vault ledger. This is the earlier N3.
- Publication waits for the owner-arranged re-triage.
