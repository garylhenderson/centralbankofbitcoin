**Verdict: approved. I found no remaining source blocker for the narrow cleanup at `cea6bae7`.** This was a static read of the four files you named, plus a grep of the imports in `reconcile-notices.mjs`. I ran nothing and read no secrets. The test results, in-memory transform, node v20.20.2 and HEAD 405 are your evidence, not something I checked.

All three earlier gaps are closed in the source:
- **`CRON_SECRET`:** the transformer requires it on the Notice line (`cleanup-legacy-crons.py:19`). The test covers a line with `OTHER_SECRET`.
- **Overlap:** the transformer refuses overlapping roles (`:22`).
- **Node:** the installer checks that `/usr/bin/node` is executable and major version 18 or later (`:29-31`).
- **Caller source:** the cron points at `/opt/cbob-public-data/<SHA>`, and the installer compares the caller bytes against the clean `/opt/cbob-vaults` source (`:33`). Because the caller imports only `node:fs` and `node:url`, that one file is the whole dependency, so comparing it is enough.
- **Docs:** they now state the requirement to merge and push v6, to keep the caller worktree, and to re-pin explicitly on updates. The v6 gate is at `:28`.
- **Tests:** the new tests cover a missing credential, commented-out duplicates and a missing final newline.

**Non-blocking nits (none need fixing before `--execute`)**
- **Overlap test:** the overlap fixture (`legacy-crons.test.py:14`, last case) hits the "Unexpected legacy payout schedule" check first, because the line starts with `8 *`. It is still refused, but the new overlap check at `:22` isn't what triggers it. To test it directly, use a line that starts with `7 9 * * *` and also contains the reconcile URL. The reconcile branch would then refuse it earlier on its own schedule check, so the overlap check is effectively unreachable. That makes it harmless defense-in-depth.
- **`/opt` checkout:** the `ROOT=/opt/cbob-vaults` checkout must be on v6 with a clean tree. If `git status` isn't clean or HEAD isn't the reviewed SHA, the script fails closed.

**Before running, confirm these two things:**
1. `/opt/cbob-public-data/<SHA>` exists as the exact worktree. The script only reads its `reconcile-notices.mjs`, so it won't fail if the rest of that worktree is incomplete.
2. `/var/log` is writable via `sudo install`. If the log file already exists, it must be mode 600, owned by uid 1000 and not a symlink. Otherwise the script refuses, which is safe.

Go ahead with `python3 web/deploy/cleanup-legacy-crons.py --execute cea6bae7d68f22bfc477794d9149e459686c490c`, but only after the reviewed commit is pushed to origin/v6 and HEAD in `/opt/cbob-vaults` matches. The commit I've been given as `cea6bae7...` is abbreviated in your message, so use the full 40-character SHA.
