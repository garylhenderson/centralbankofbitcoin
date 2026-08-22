**HIGH — `acquireLock` stale-break is not exclusive; `releaseLock` then deletes the winner’s lock.** `bank/lock.mjs` `acquireLock` / `withLock`. After `EEXIST`, a stale lock is overwritten with plain `writeFileSync` (no `wx`). Two waiters both see `age >= staleMs`, both get `{ok:true}`, both run. `withLock`’s `finally { releaseLock }` unlinks whoever’s file is there — a finishing loser deletes the survivor’s lock and a third runner can enter.

Distribute is the blast: two loops both see `paymentState === 'unpaid'`, both `createTransferChecked`, customer ATAs get paid twice. Revenue is partly saved by `cycleIsOpen`, but the same race before the first `save(led)` is two sweeps.

Round 10 only raised `staleMs` to 20h. That makes a *live* overrun + next 09:07 cron possible once the lock is older than the work (the case they were fixing). No pid/`kill(0)` check, so a stuck-but-alive job is stolen.

Exploit: crash or 20h hang leaves/ages the lock; cron + a manual retry (or two crons) start together; or hung `distribute.mjs` still sending when the next daily job breaks the lock.

Fix: reopen with `wx` after unlink, or `link()` a new lock over the old; refuse to break if `kill(pid,0)` succeeds; never `unlink` a file whose pid is not us.

**HIGH — `splitByOther` is an unverified close; unclaimed on-chain splits close later cycles.** `bank/revenue.mjs` (catch on `split_revenue`) + `detectSplitClaims` / `cycleIsOpen` / `detectUnreconciledRevenue`.

The empty-ATA check runs only in the operator process, once. The alarm then *skips* every `splitByOther` row and never asks whether a split happened. `seenSplits` still records that permissionless `split_revenue`. A later cycle can set `splitSig` to that unclaimed signature: reuse only compares rows that *claim* a sig, `split_not_on_chain` is quiet because the scan saw it, `cycleIsOpen` is false, `cycle_unsplit` does not fire. Holders’ cbBTC stays in the revenue ATA.

The operator already writes this ledger — the alarm exists because that testimony is not enough. Round 10 closed “two rows, one sig” and opened “one real split, no claimant, later row steals it.” An outsider cannot write the ledger; they *can* create the unclaimed sig (front-run split). The operator (or anyone who can edit `revenue-ledger.json`) does the rest.

Fix: require a unique on-chain split in the cycle’s time window, or have the alarm treat `splitByOther` as still open until it sees a `split_revenue` after `returnSig` that no other row owns. Do not skip `splitByOther` in `detectSplitClaims`.

**MEDIUM — `WATCHED_KEYS` still does not cover what standing checks read.** `detectStandingRisks` compares `seal|mint|burn|gov.collection`. None of those four keys are in `WATCH` or the extra `WATCHED_KEYS` list. `missingWatchedKeys` therefore cannot fail if `readConfigs` drops `gov.collection` (or any of them). `collections_disagree` uses `.filter(([,v]) => v)` — a missing read looks like agreement. Same class as `gov.pending_admin` / `mint.pending_bank`; the mechanical close is still one field list short.

Fix: build `WATCHED_KEYS` from every key `detectStandingRisks` and `detectConfigDrift` actually index, and assert that in the selftest.

**MEDIUM — assertion floor fixed on one selftest, not the other.** `bank/selftest.mjs` now has `FLOOR = 135`. `distribute.mjs --selftest` still ends with `process.exit(R.every(Boolean) ? 0 : 1)` and no floor. `run-tests.sh` runs it and only `tail`s the last lines. A throw after two passing `t()` calls is a green payout-arithmetic gate. Fifth round of “one of two sites.”

Fix: the same floor (and `passed === total`) on `distribute.mjs --selftest` and `probe-mainnet-facts.mjs`.

---

**Could not break (checked, not praised):** SEAL 2-of-2 + `inspect_reserves` delegate/close bits; BURN reserve list read from SEAL; `split_revenue` destinations derived from config + Tokenkeg (stranger cannot redirect; they can only do the real split); operator rotation is actually pending + `governance_timelock_secs`, `set_paused` still kills `sweep_sol_for_swap` in the same tx; `--dry-run` no longer writes `.alarm-has-run` or `state.json`; `detectDistribution` treats `rejected` as refused; Core sha is a source constant in both shell scripts; `gov.pending_admin` is produced and watched; fee-payer compilation means `revenue.mjs` marking the operator `isSigner: false` does **not** brick sweeps (operator is the payer). Jupiter still unconstrained; that remains the stated ops rule, not a new code hole.

**Single thing before real money:** make the lock exclusive on the stale path and never unlink another pid’s file. That is the only new defect that pays a vault twice.