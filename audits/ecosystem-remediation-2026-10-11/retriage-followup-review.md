# Audit report: CBOB retriage follow-up fce3672..f179e71

**Verdict: not ready to publish yet.** There is one deployment blocker and one copy fix that defeats the purpose of finding 1. Both are cheap to fix. The JS source changes are acceptable, so their bundle pins can be accepted once they are regenerated as described in the pin section below. Holder actions should stay closed.

## Blocker

### B1. The first-refresh timeout probably doesn't kill the hung producer (medium; deployment)
- **Where:** `web/deploy/activate-public-data.py:10-19, 63`.
- **What the code does:** `run_first_refresh` starts `runuser -u ubuntu -- python3 run-public-data.py` with `start_new_session=True`. On timeout it sends SIGKILL to the process group `proc.pid`.
- **Why that misses the producer:** util-linux `su`/`runuser` forks a watching parent. The child calls `setsid()` unless `--session-command` is used, so the producer (python, which then `execv`s node `bank/public-data.mjs`) ends up in its own session and process group.
  - `killpg(proc.pid)` therefore kills only the runuser parent. SIGKILL also stops that parent from forwarding a signal to its child.
  - I couldn't run runuser here. This is based on su-common's documented behaviour, and the claim is unverified on this box.
- **Failure path:**
  1. An RPC call hangs, and the 480 s deadline passes.
  2. The runuser parent is killed and `first-run.json` records `timed_out:true`.
  3. The override is restored, `ActivationFailed` is raised, and `publish-ecosystem.sh:47-52` restores the pages and prints "Previous pages restored."
  4. `pin-public-data.sh` then exits, which releases flock fd 8.
  5. The orphaned new-source node producer keeps running **without the public-data flock**. It runs alongside the restored timer, and both write the live `data/`, `v/` and `/opt/cbob-vaults/.cache/vault-meta-state.json`.
- **Why it matters:** the operator is told the rollback was clean when it wasn't. Before this change, a hang was at least visible.
- **The test doesn't catch it:** `public-data-deploy.test.py` runs `sys.executable` directly, with no runuser and no `setsid` child.
- **Fix, either option:**
  - (a) Send SIGTERM to `proc.pid` first (su's watching parent forwards it to the child and escalates to SIGKILL after about 2 s), wait a few seconds, then SIGKILL.
  - (b) Better: drop runuser and use `Popen([...], user='ubuntu', group='ubuntu', extra_groups=[], start_new_session=True)`, or `setpriv --reuid/--regid --init-groups`, which doesn't fork. Then the producer really is in the killed group.
- **Test to add:** a fixture child that forks and calls `setsid` and sleeps. After the timeout, assert that no process from that run survives.

## Should-fix before publication (copy only)

### S1. /buy/ timing sentence is scoped to the wrong audience
- **Where:** `web/src/html/buy.html:31`, step 4.
- **The problem:** the canonical text in 2026-7 is global: "The first joining tick is no earlier than thirty days after charter close; the first free crediting distribution is no earlier than sixty days after close."
  - The new /buy/ text says "The **founding cohort** can first join…". That term isn't defined on /buy/.
  - A first-sale-round buyer, the reader finding 1 was written for, will reasonably read it as not applying to them.
- **Fix:** on /buy/, say it is global, e.g. "No vault can first join the payout pool earlier than thirty days after charter close, including vaults bought in the first sale round…"
- The claim page and the 2026-2 notice, which speak to the charter cohort, are fine as written.
- **Minor:** "automatic payout" has replaced "free crediting distribution", meaning one that needs no $GARY burn. Check that "automatic" is still true while the crank/cron cleanup (D9) is undecided.

## Fix-by-fix check

1. **Finding 1 (timing):** present in buy step 4, the claim page and the 2026-2 notice. The /buy/ scoping is wrong (S1).
2. **Finding 2 (claim wording):** fixed. "Joining tick" is removed and the payout is now "triggered by burning 100 $GARY". Correct.
3. **Finding 3 (heading):** both the attribute and the fallback text say "Charter window status" on buy and redeem. Correct.
4. **Dependency guard:**
   - Placement is correct: it runs after the git cleanliness checks and before any application or external import, on both the `--check` and timer paths. The argv check is tightened.
   - It fails closed: a pin file that doesn't parse, an older Node without `import.meta.resolve`, or missing metadata all refuse the refresh.
   - Grep confirms the producer's only bare external imports are `@solana/web3.js`, `bs58` and `@noble/hashes/sha2`. `buffer` resolves to the Node built-in.
   - The stated limits (same-version edits, transitive drift, a concurrent install after the check) are accurate.
5. **Activation hardening:**
   - The restore-failure and activation-failure messages are now distinct and correct.
   - The symlink path refuses without touching the symlink's target.
   - Output is no longer logged (good).
   - The timeout itself is defective (B1).
   - `first-run.json` goes into a `mkdtemp` backup directory (mode 0700). Good.
   - `publish-ecosystem.sh` now reports a failed page restore. Correct.
6. **Polish:**
   - `charter-status.mjs:38-41` shows a loading state and only reports "unavailable" after the first fetch resolves. Correct.
   - `club.mjs:8` maps a non-JSON body to the account-unavailable message. Correct.
   - Austin-time wording is consistent across `exhibition.mjs`, `record-card.mjs` and `plan-redeem.mjs`.
   - "Rolling hour" is technically accurate: `rateLimit` (`plan-redeem.mjs:57-66`) is a 64-slot ring of burn timestamps, which is a sliding window. The cap is clamped to 64, which never binds at the 2,100-vault ceiling.
   - The burn receipt addendum correctly excludes the three non-MAGA mints.

## Bundle pins

- **README pins weren't updated in this range** (`web/README.md:396-415` are unchanged). Every bundle that imports a changed module will mismatch, so the publisher refuses as designed:
  - account, buy, claim, redeem, vault, market, governance and history, in both profiles.
- **The source deltas are acceptable.** Accept the new pins only if they are regenerated from a clean build of the commit that includes the B1 and S1 fixes, and:
  - both ceremony pins and `assets/style.css` are unchanged. `tx.mjs` imports `PACKET_LIMIT` from `plan-redeem.mjs`; if a ceremony hash moves, stop and review.
  - the full `node web/test/run-all.mjs`, including `bundle.test.mjs`, passes. The follow-up reports only the ecosystem (57) and deployment (17) suites. The full run and its pin check are the missing verification.

## Gary adapter

- `club-engine.cjs:1898` carries the plan-redeem wording ("per rolling hour", "Austin time").
- I couldn't confirm the "only this delta" claim without a git diff (read-only tools).
- In `/opt/gary-club-cbob` the `.cjs` and its `.sha256` are **modified but not committed**. Commit both, check the hash matches, and keep it undeployed until holder actions are approved. Main still prints UTC.

## Residual non-blockers

- Earlier activations' `first-run.log` files in `/var/backups/cbob-public-data/source-*/` may still contain RPC URLs. Inspect them with masked output and delete them, or bring that directory into the secret-log sweeper's scan.
- A partial `data/` or ledger write on failure still isn't rolled back (disclosed).
- A5 is still open: `public-data.mjs:19`, `vault-index.mjs` and `governance-index.mjs` read the whole `/opt/gary-club/.env.local`.
- The dependency guard resolves from `web/deploy/`. A future ignored `web/node_modules` would be seen by `web/src` but not by `bank/`, and the git ignored-file check doesn't cover `web/node_modules`.
- The correction notices are dated 11 October. If publication slips, re-date them along with the metadata, feed and index markers.
- Holder actions stay closed pending H1, H2, L4 and the Gary adapter deployment.
