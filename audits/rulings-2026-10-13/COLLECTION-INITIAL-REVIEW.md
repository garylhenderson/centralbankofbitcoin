**BLOCKED.** I found one real blocker, and the fix needs a new commit, so I'm not issuing the approval lines for `2f0a68dec8dae9d9f7bafcc75d9b3939534c8ce8`.

## Blocker: both collection builds say the source tree was dirty

- Both `collection-mainnet/BUILD.txt:2` and `collection-mainnet-local/BUILD.txt:2` read `commit 2f0a68de… (web/ has uncommitted changes)`.
- Every earlier accepted build in that audit directory (`release-*`, `features-*`, `market-release-*`) has a bare 40-character commit with no suffix.
- `web/build.mjs:136-138` adds that suffix when `git status --porcelain -- web` is non-empty at build time.
- Nothing in the patch explains it. It touches only `launch/mainnet-init.json`, `scripts/check-launch-params.mjs` and `web/src/config.js`.
- `web/build.mjs:93-95` rewrites `web/src/generated/launch.json` from `launch/mainnet-init.json` on every build.
- `web/src/generated/launch.json` is tracked: its path is in `.git/index`.
- The working-tree copy already holds the new address (`web/src/generated/launch.json:31`), but the patch has no hunk for it.
- So the committed `launch.json` is most likely still `null`, and each build dirties `web/`. I can't run git, so I couldn't confirm this directly.

The pipeline fails closed on a dirty build, so nothing unsafe gets published. It also means pin acceptance for this commit can't complete:

- `scripts/update-web-hashes.mjs:20` runs the builds before the clean check at `:38-39`. A regenerated `launch.json` makes the tree dirty, so `--accept-reviewed` throws "Commit reviewed source before accepting new pins".
- `web/deploy/publish-ecosystem.sh:19-20` compares the whole `commit    …` line to `HEAD`. The dirty suffix makes it fail with "Build record is not the reviewed commit".
- `web/deploy/go-live.sh:22` runs `publish-ecosystem.sh --check` first, so the release stops there too.
- `scripts/pin-review.mjs:19` requires the recording commit to add only the audit file after the reviewed commit. Committing `launch.json` afterwards would break that, so approving `2f0a68de` would produce an approval that can't be used.

**To fix:**
1. Commit the regenerated `web/src/generated/launch.json`. Check that `git status --porcelain --untracked-files=all` is empty after `node web/build.mjs`.
2. Rebuild both profiles from that clean commit.
3. Confirm `BUILD.txt` shows no dirty suffix.
4. Resubmit for review at the new commit.

If `launch.json` turns out to be committed, the operator needs to say what else dirtied `web/`. Either way I can't accept artifacts that aren't a clean build of the reviewed commit.

## Checked and fine (read evidence only)

- **Patch.** The `mainnet-init.json` record (value, `RULED`, signature) and the `config.js` collection match `ceremony-completed.json:498-499`. The selftest change swaps the old "committed file is OPEN" assertion for a negative fixture, so the refusal of an OPEN `vault_collection` is still tested.
- **Gary adapter.** `club-engine.cjs:1045` holds the same address, and the other `collection:` lines are unchanged. I did not diff or hash it.
- **Dependency snapshot.** Both `*-inputs.json` files carry snapshot `8b6263c3…` with identical contents.
- **Relay and deploy scripts:**
  - `go-live.sh:24-31` requires launch and config to hold the same valid collection.
  - `configure-rpc.py:77` refuses an existing different relay collection.
  - `check-live-rpc.mjs:15` checks the collection is Core-owned and `:21` refuses a foreign group.
  - `rpc-proxy.mjs:170, 213-214` bind vault moves and DAS group queries to the configured collection.
  - Nothing in this delta deletes data: `publish-ecosystem.sh` publishes without deletion and keeps a restore point.
  - It skips the `ceremony-*` bundles (`:36-37`), so the generated ceremony cannot replace the installed `a9dcaca` artifact.
- **Gary flags.** The holder-actions and trading flags are on only when their env vars equal `'1'` (`portal-market.ts:22-23`). The collection value doesn't touch them, so this delta cannot turn them on.

## Residual risk (not a blocker)

- With a collection set, the Bank's `buy`, `claim` and `redeem` pages no longer refuse for lack of one (`buy.mjs:44`, `claim.mjs:43`, `redeem.mjs:77`). The Bank site has no off switch of its own.
- The remaining gates are the on-chain charter window (`plan-get.mjs:49`) and the sale-round open time (`plan-get.mjs:88`). That fits the charterOct19 and 24-hour lock-gate items still pending.
- The relay forwards any transaction that calls a Bank program (`rpc-proxy.mjs:163`). That was already so before this change.

## What I did not do

I ran no tests and no hash commands. I did not verify byte-identical adapter rebuilds, the 40/40 operator read-back, signing-service shutdown, or that `a9dcaca` is untouched; those are operator proof only. I did not review the real login or mainnet holder acceptance or the Friday lock gate.
