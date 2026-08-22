## FINDINGS

### 1. HIGH — first live revenue cycle sweeps, then aborts on a normal missing ATA
**Where:** `bank/revenue.mjs` (`requireTokenAmount` on the operator cbBTC ATA) + `bank/spl.mjs` `requireTokenAmount`.

Round 11 made “absent ≠ 0” the money-path rule. That is correct for the **distributor** ATA and for `isProvablyEmpty`. It is wrong for the **operator** ATA, and it is wired **after** `sweep_sol_for_swap` has already moved SOL.

```text
sweep confirms → cycle.sweptLamports saved
→ requireTokenAmount(operator cbBTC ATA)     // NEW
→ only then Jupiter
```

`requireTokenAmount(null)` throws (`does not exist`). Nothing in this repo creates that ATA. Jupiter would have created it — and never runs.

**What a test run would show:** on a fresh operator key, `revenue.mjs --live` prints a sweep signature, then throws; `revenue-ledger.json` has an open cycle; `cycleIsOpen` is true; every later cron dies on “Resolve them by hand”. The 217 on-chain assertions never execute this file.

**Exploit (no attacker required):** first production cycle, or any cycle after the ATA was closed. SOL is on the operator; holders are not paid; the pipeline is wedged until a human creates the ATA, swaps, returns, and edits the ledger.

**Fix:** treat **absent** as `0n` here only (foreign/malformed still refuse). Create the ATA idempotently. Do the read **before** the sweep. Absent is a first-run state, not a poison account.

This is the class the prompt named: a repair that turned a **normal** condition into a wedge, applied at one of two sites, helper unit-tested, **caller untested**.

---

### 2. MEDIUM — `MIN_ASSERTIONS=160` no longer bounds the suite it claims to
**Where:** `scripts/run-tests.sh` (`MIN_ASSERTIONS=160`).

The suite is described as 217 assertions (seal state, `NoTerminalClose`, Core `0x9`, operator notice, sweep floors, `because()` on 3.x/4.x/5.x). The runner still accepts 160. Deleting every round-11 assertion — including the three that exist only because earlier “passes” were false — still exits 0.

Same defeat as making the floor an env var, just by not moving the constant. `distribute.mjs --selftest` (17) and `selftest.mjs` (170) were updated; the runner that certifies the programs was not.

**Fix:** set the floor to the current `N` in `N/N as predicted` (and bump it when tests are added).

---

### 3. LOW — `releaseLock` is still read-then-unlink
**Where:** `bank/lock.mjs` `releaseLock`.

Token match is not atomic with unlink. A live holder cannot be broken (`pidAlive`), so this is not the double-pay path today. It becomes one if `pidAlive` is ever wrong (PID namespace, reused pid after reboot + stale clock). Break is now exclusive (`unlink` + `wx`); release is not.

`_afterUnlink` is only a parameter defaulting to `null`. Production callers pass `{ staleMs }`. Not reachable without a code change. Leave it, or gate it with `process.env.CBOB_SELFTEST`.

Refusing a live holder **is** paged: `ELOCKED` → `NOTIFY`, and the alarm deadman watches `state.json`. Not silent.

---

## What I could not break

- **`isProvablyEmpty`:** absent/foreign/malformed are false. Only a Tokenkeg account with `amount == 0` counts. `split_revenue` is the only drain of the revenue ATA and pins both destinations. A 1-lamport system account at that PDA does **not** prove a split. Front-running the real split is the intended `splitByOther` path; `detectSplitClaims` now requires N unclaimed on-chain splits for N such rows (inside the horizon).
- **`readTokenAccount` states:** callers that must move money use `requireTokenAmount` (distributor, post-swap operator). Per-vault poison in `distribute.mjs` is isolated. Alarm activation treats non-ok as 0 — correct for never-created ATAs; a real ATA cannot be overwritten with a 0-data account.
- **`signaturesSince`:** `until`+paging matches the mainnet probe (gap, >1000 sigs, newest first, cursor excluded). Alarm does not advance a cursor on `gap` or unread txs. First-run `until === undefined` is fine.
- **Lock break:** stale ∧ dead, then `wx`. Two racers cannot both win. Release is by token; `finally` will not unlink a replacement. `process.kill(pid, 0)` / `EPERM` is the right liveness test on one host; reboot+recycled pid can stall a job, but it pages.
- **Padding:** MINT/BURN/GOV space matches Borsh + 256. SEAL over-allocates (~32 extra, bump counted early) — harmless. No `data.len() == fixed` check on configs. Offset readers use `>=`.
- **WATCHED_KEYS / `COLLECTION_KEYS`:** standing collection compare and the watch list are the same array. `missingWatchedKeys` would fail the pass if `readConfigs` dropped one. `gov.pending_admin` is standing-checked every pass.
- **`resolvedBy`:** above `rejected` in `paymentState`; payout loop skips `resolved`; all three nag paths in `detectDistribution` honour it. Not attacker-reachable without the ledger file (same trust as the keys).
- **Vault/seal/burn/gov:** still consistent with a green 217-run against real Core. Did not re-litigate those.
- **Jupiter / ALTs:** still an operational bound, not a code one. SPEC (operator holds only cycle funds) is the control; nothing new makes that insufficient.

`revenue.mjs` / `distribute.mjs` still raw-offset-read the mint config with no disc/owner check. That is the alarm’s old shape, but the address is a mint PDA — a stranger cannot plant a fake. Not a theft path.

---

## THE SINGLE THING

**Do not treat a missing operator cbBTC ATA as a hard fault after the sweep.** Measure-or-create it first; only then move SOL. Until that change, the first `--live` cycle (the one that puts real income on the trusted hop) is the one that wedges the pipeline with SOL already gone.