## Findings

### 1. HIGH — `--dry-run` stamps `.alarm-has-run` and does not write `state.json`
`bank/alarm.mjs`: `fs.writeFileSync(EVER, started)` runs unconditionally; `writeState(next)` is behind `if (!DRY)`.

**What happens:** first command the header recommends is `node bank/alarm.mjs --dry-run`. That creates `/opt/cbob-vaults/bank/.alarm-has-run` and leaves `state.json` absent. The next live pass hits:

```js
if (!prev && fs.existsSync(EVER) && !ARGS.has('--first-run')) throw …
```

Cron then exits 3 every 30 minutes. The watcher that is supposed to see approvals, bare burns, and unledgered sweeps never takes a baseline. Round 9 stopped dry-run from *consuming* findings; it left dry-run *creating* the has-run marker without the file that marker attests to.

**Fix:** do not write `EVER` when `DRY`. Same for any other “we have run” side effect.

### 2. HIGH — Ambiguous distribution rows are dead-lettered for one UTC day, then blindly retried
`bank/distribute.mjs`: intent is written (`sig: null`) *before* `sendAndConfirmTransaction`. `paymentState` returns `ambiguous` unless `rejected`. The loop `continue`s. `finishedAt` is withheld. The next UTC day is a new `st.days[day]` with no memory of yesterday’s intent.

Solana routinely confirms a landed tx after `sendAndConfirmTransaction` throws. Their own comments say so.

- Landed + timeout → same day: not retried (underpay). Next day: paid again (**double pay** of that vault’s share).
- Intent saved, process killed before send → same day: never sent, never retried. Next day: paid once (late, not double).

No attacker required. One congested 9:07 run does it. This is project cbBTC, not vault reserves, but it is still customer money.

**Fix:** resolve `ambiguous` against chain (signature scan or ATA delta) before any later day may pay that vault. Do not treat a new UTC key as a clean slate.

### 3. HIGH — Daily payout can be absent forever and the alarm stays quiet
`bank/alarm.mjs` only calls `detectDistribution` when the ledger file or `${DIST}.has-run` exists. `detectUnreconciledRevenue(null)` is always a CRITICAL; distribution is the opposite.

If `cron-install.sh` is skipped, the distribute line is edited out, or the job never succeeds once, there is no file, no has-run, no `distribution_missed`, no `distribution_ledger_unreadable`. Holders’ 85% sits on the distributor. The 30-minute report still prints the “no unreconciled sweep / no drift” closer.

**Fix:** run `detectDistribution` unconditionally. Missing ledger after `mint.minted_total > 0` (or after any `split_revenue`) is CRITICAL, same shape as the revenue ledger.

### 4. HIGH — `distribute` stale lock is 6 hours, wall-clock of a full run can exceed that
`withLock(LOCK, main, { staleMs: 6 * 3600_000 })`. Lock break is time-only (`selftest.mjs`: `now + 7h` steals a live lock). ~2,100 sequential `sendAndConfirmTransaction` calls on a congested cluster are often >6h (30s each → 17h). Next morning’s cron steals the lock. Two writers, one `distributions.json`. Last `writeLedger` wins and can erase the other’s receipts → finding 2 at scale.

At charter size (~190) this is unlikely. At the stated 2,100 it is the default failure mode.

**Fix:** lock must be held by a live pid (or heartbeat), not a wall clock. Stale-break only if the holder is dead.

### 5. CRITICAL *if* mainnet cbBTC is Token-2022 — the money path is wired to Tokenkeg
Confirm: `getAccountInfo(cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij).owner`. If it is `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`, the following is live, and the 82-assertion suite does not cover it (it moves classic SPL).

- `split_revenue` pins `SPL_TOKEN_ID` and derives ATAs with Tokenkeg. It cannot split real cbBTC. The on-chain 85/15 never runs on the income token.
- `assert_classic_spl` **forbids** putting that mint in `reserve_mints`. `inspect_reserves` / the burn reserve loop therefore never look at the Bitcoin ATA. A delegate planted in a thaw survives re-seal; Bank simulation is the only check, and it is optional in the program.
- `alarm.mjs`, `revenue.mjs`, `distribute.mjs` all `getAssociatedTokenAddressSync(CBBTC, …)` with default Tokenkeg. Activation reads empty accounts → 0 sats → nobody is “activated” → `allocate` skips everyone. Return-from-swap lands in a Tokenkeg ATA that cannot hold cbBTC.

SEAL’s own comment names “cbBTC, $GARY, $GIRAFFISH” as the reserve set and “classic SPL only” in the same breath. Those cannot both be true for Coinbase cbBTC.

**Fix:** if the mint is T22, the programs and every ATA derivation must use Token-2022, and `inspect_reserves` must reason about T22 base+extensions (or refuse to close/burn without a Bank-signed remaining-account that *is* the cbBTC ATA and empty/undelegated). If the mint is actually Tokenkeg, withdraw this finding.

### 6. MEDIUM — `set_paused` also kills `sweep_sol_for_swap`
`MintError::MintPaused` on sweep. Comments: “Emergency stop on the SALE only. Redemption and burn are unaffected.” Sweep is not the sale. Pause-for-incident freezes SOL in the revenue PDA for the whole pause. Not theft; it is a comment the code does not implement, on the hop that already cannot be paused by governance.

**Fix:** drop the pause check on sweep, or change the comment and the alarm copy so operators know pause wedges the cycle.

### 7. MEDIUM — `missingWatchedKeys` still does not cover everything standing risks read
`gov.pending_admin` is in the every-pass rotation loop, is populated by `readConfigs`, and is **not** in `WATCH` or `WATCHED_KEYS`. Same for the four `*.collection` keys `collections_disagree` uses. Round 9’s mechanical close of “watched but never read” is incomplete: delete the `pending_admin` field from the gov read list and the GOV admin notice period goes quiet again with no throw. That is the same class as `mint.pending_bank`.

**Fix:** `WATCHED_KEYS` = every key `detectConfigDrift` **or** `detectStandingRisks` reads. Selftest a deletion.

---

## Could not break

- Open/close pairing + Bank on both halves; close without open / open without close revert; thaw+close atomic so a failed close does not leave a vault unfrozen.
- VoteRecord `["vote", proposal, asset]` — transfer-then-vote-again cannot double-cast; collection account fails `KEY_ASSET_V1`.
- `execute_proposal`: `executed`, `last_executed_id` monotonic, `EXECUTION_WINDOW_SECS`, `RoundAlreadyOver`; CPI data matches `set_round`; MINT still enforces `cap > 0`, one-year window, `minted_total < max_supply`.
- Quorum divisor `max(snapshot, live)`, ceiling, `need > 0`, bps snapshotted at create. Minting during a vote is still net-positive below 100% — that is written, not hidden; the Bank co-sign is the real brake.
- `split_revenue` destinations are config ATAs, not caller-chosen; Bank share floored; two transfers sum to `total`.
- `sweep_sol_for_swap` destination is `config.swap_operator` and that key must sign; cap + cooldown on-chain; reserve 0-or-≥rent.
- Lifetime cap is read. Instruction-sysvar matching binds asset (and owner on the open→close direction).
- Suite-tested Core plugin encodings: not re-litigated.

---

**THE SINGLE THING:** stop `--dry-run` from writing `.alarm-has-run` without `state.json`, then make `detectDistribution` fire when the payout ledger has never existed. A watcher that cannot start, and a daily cbBTC job whose absence is silent, is how real reserves get unwatched.