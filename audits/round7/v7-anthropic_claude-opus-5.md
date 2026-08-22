# ROUND 7 — FINDINGS

---

## 1. CRITICAL — GOV: `quorum_bps`/`threshold_bps` are read at EXECUTE time and are admin-mutable with no timelock. One key + one vault installs any round.

`execute_proposal` reads `ctx.accounts.config.quorum_bps` and `config.threshold_bps` **live**, while `Proposal.quorum_supply` is snapshotted. `update_gov_config` lets `admin` set `quorum_bps` to `1` in a single instruction, immediately, and the comment blesses it ("quorum_bps IS THE EXCEPTION").

Exploit, in order: admin (who holds ≥1 charter vault — the top holder has 21%) calls `create_proposal(opens_at=now, closes_at=now+364d, price_lamports=0, cap=1911, voting_ends_at=now+min_voting_secs)`; casts **one** YES vote with their own vault; nobody else votes. `cast = 1`, `yes_bps = 10000` ≥ any threshold. Quorum would fail (`need = 190 * 2000/10000 = 38`). So in the same block as the execute: `update_gov_config(quorum_bps: 1)` → `need = 190*1/10000 = 0` → `cast >= need` → `execute_proposal` CPIs `set_round(price 0, cap 1911)`. Then mint the entire remaining supply free.

The authors' defence ("an admin hostile enough to lower quorum can already arm a governance rotation and BE governance in seven days") is false in the dimension that matters: the rotation is **days long, published on-chain, and fires a CRITICAL alarm**; this is **atomic and fires a HIGH drift up to 30 minutes later, after the mint**. The real defect is not that quorum can move — it is that it is applied **retroactively to proposals already created and voted under a different rule**.

**Fix (3 lines):** add `quorum_bps: u16, threshold_bps: u16` to `Proposal`, set them in `create_proposal` next to `quorum_supply`, read them in `execute_proposal`. Never read `config` for a tally rule.

---

## 2. CRITICAL — the alarm watches neither the round nor the supply, and a *missing* state file silently re-baselines the whole watcher.

Three compounding holes in `readConfigs`/`detectConfigDrift`:

* **`mint.round_id`, `price_lamports`, `cap`, `opens_at`, `closes_at` are never read.** The single output of the entire governance system — the price strangers pay and the cap — changes with zero findings.
* **New vaults are silent by construction.** `detectVaultSetChange` only reports disappearances (selftest: *"QUIET when nothing left (and a NEW vault appeared)"*); `minted_total` is read but is **not in the `watch` list**; `detectIndexShortfall` only fires when the index is *short*. Minting 1,911 vaults in one day produces **no finding at all** — only a different number on the `looked at:` line.
* **Drift-only, with a deletable baseline.** `detectConfigDrift(null, cur)` returns `[]`. `readState()` treats **absent** as a first run (round 6 only fixed *corrupt*). `rm /opt/cbob-vaults/bank/state.json` (same host, same user as the signing keys) → next pass adopts the attacker's treasury/swap_operator/upgrade-authority/program-hash as canonical, reports "no config drift", exits 0. And the deadman cron is blind to it: `find state.json -mmin +120 | grep -q .` prints nothing for a file that **does not exist**, so it never fires.

**Fix:** a committed, root-owned `expected.json` of absolute values (treasury, bank, swap_operator, governance, all four upgrade authorities and hashes, collection hash) asserted **every pass** independent of history; watch `round_id/price/cap/minted_total`; make a missing state file a CRITICAL unless `--first-run`; deadman: `[ -f f ] || alert`.

---

## 3. CRITICAL — the revenue ledger is the audited key's own testimony, and the Jupiter transaction is blind-signed.

`detectUnreconciledRevenue` and `--audit` reconcile `sweptLamports` against `returnedSats` — **both written by `revenue.mjs`, which runs as the same user, on the same box, as `keys/swap-operator.json`**. A compromised operator key sweeps 50 SOL, keeps it, and writes `returnedSats: <quotedSats>` into `revenue-ledger.json`. Every detector is quiet, forever. The only independent facts (the on-chain `SolSweptForSwap` event and the revenue ATA's cbBTC balance) are never read by the alarm.

Second, `vtx = VersionedTransaction.deserialize(sw.swapTransaction); vtx.sign([operator])` signs whatever `quote-api.jup.ag` returns — no program allowlist, no simulation, no pre/post balance assertion, no check that the output lands in the operator's own ATA. A compromised/DNS-hijacked endpoint drains the operator wallet outright; the on-chain `max_sweep_lamports` bounds the sweep and nothing bounds this.

**Fix:** the alarm must compute swept from `getSignaturesForAddress(MINT)`+`SolSweptForSwap` logs and returned from the revenue ATA's balance deltas, and treat the ledger as an *intent log only*. Simulate the Jupiter tx and assert `postTokenBalances[opAta] - pre >= quote*(1-slippage)` and that no other owned account decreases.

---

## 4. HIGH — `governance_timelock_secs` is asserted nowhere. The comment says the alarm does it.

MINT: *"⚠️ THE DEPLOYED VALUE MUST BE DAYS. The Bank alarm asserts the live value."* `readConfigs` reads offsets up to 353 (`pending_governance_at`) and **stops**. Offset 361 is never read; `detectStandingRisks` has no check. Since the field **ratchets up only**, an `initialize` at the 60-second floor is permanent, and admin can arm+apply a self-rotation to governance in 60 seconds — after which admin alone satisfies every governance gate. Nothing in the pipeline says a word. (Contrast `gov.min_voting_secs`, which *is* asserted — proving the omission is an oversight, not a policy.)

**Fix:** read offset 361; `detectStandingRisks` → CRITICAL if `< 3*86400`.

---

## 5. HIGH — round 6's "swap_operator is now rotatable" is unreachable in the production wiring.

Every one of `treasury, bank_treasury, split_bps, swap_operator, sol_reserve_lamports, max_sweep_lamports, sweep_cooldown_secs, governance_timelock_secs` requires `governance` to **sign** `update_wiring`. In the intended end state `config.governance` is GOV's `["gov"]` PDA, whose only CPI is `set_round`. So the moment the handover happens, **all of them freeze** — including the emergency response to a compromised swap-operator key. `MIN_GOVERNANCE_TIMELOCK_SECS`'s own comment names this and claims the timelock fixes it; it does not — the only route is rotate governance to a signing key (days, CRITICAL alarm, **governance/rounds dead for the duration**), rotate the operator, then rotate back (days again). Meanwhile the attacker takes `max_sweep_lamports` every `sweep_cooldown_secs`. The only same-day control is `set_paused`, which also stops the sale.

**Fix:** admin-only `set_swap_operator` (it can only ever move OUR SOL to a pinned address — it does not need the holders' consent), or a second `revenue_governance` key held by the Squads that is *not* the GOV PDA.

---

## 6. HIGH — any failed sweep permanently wedges the revenue cycle and fires a FALSE CRITICAL "the SOL is on the operator key".

`revenue.mjs` writes the intent row (`intendedLamports`) **before** the send. If the sweep instruction reverts — `SweepTooSoon`, `MintPaused`, `SweepAboveCap` (the script's own `MAX_PER_CYCLE_LAMPORTS = 50 SOL` is a hardcoded constant and **never compared to on-chain `max_sweep_lamports`** at offset 297), blockhash expiry, RPC error — the exception escapes and the row stays with no `sweptLamports` and no `returnedSats`.

Consequences: (a) every later run throws at the open-cycle guard → the cycle is dead until someone hand-edits the ledger; (b) `detectUnreconciledRevenue` computes `swept = intendedLamports` and emits CRITICAL *"N lamports left the revenue address and NO cbBTC came back"* — **for lamports that never moved**. This is *guaranteed* by the shipped cron: `41 */6` against any sane `sweep_cooldown_secs > 6h` produces `SweepTooSoon` on the very next run.

**Fix:** wrap the send; on failure, confirm by signature and either delete the row or mark `failed: true`, and only count rows with a signature as open.

---

## 7. HIGH — nothing watches the daily distribution, and `sig:null` rows are never resolved.

`distributions.json` is read by no detector. `detectors.mjs` has no distribution check at all. Failure modes that are therefore permanently silent after one SMS: (a) the `catch` writes `done[v] = {sig:null, error}` — `done[v]` is truthy, so **that vault is skipped for the rest of the day and never retried**, and a confirmation timeout on a landed transfer is indistinguishable from a rejected one, forever; (b) the `needSol` guard `return`s with **`process.exitCode` still 0** — a day where nobody was paid exits green; (c) no reconciliation of `Σ done[].amount` against the distributor ATA's balance delta.

**Fix:** a `detectDistribution(ledger, expectedActivated, now)` — CRITICAL if yesterday has no `finishedAt`, if any row has `sig:null`, if `paid.length < activated.length`, or if the ledger is unreadable (same discipline as the revenue ledger). Exit non-zero on the SOL-floor abort.

---

## 8. MEDIUM — the third copy of the truthy-`'0'` bug survives, in `revenue.mjs`'s own pre-flight guard.

Round 6 claims *"All three fixed."* `audit()` and `detectors.mjs` use `BigInt(c.returnedSats ?? 0) === 0n`. The guard in `main()` does not:

```js
const open = (led.cycles||[]).filter(c => (c.sweptLamports||c.intendedLamports) && !c.returnedSats)
```

`!'0'` is `false`, so a cycle that returned **zero sats** (`cycle.returnedSats = String(got)` with `got === 0n`; a `transferChecked` of 0 succeeds) reads as closed and a fresh sweep stacks on top of it. Two copies of the same predicate that disagree. **Fix:** one exported predicate, used by all three.

---

## 9. MEDIUM — one unreadable balance erases that vault's baseline permanently.

`alarm.mjs` carries `activation[v]` forward on a read failure but leaves `balances[v]` **unset**, and `next.balances = balances`. `detectBalanceDrops` iterates `Object.entries(prevBalances)`, so on the following pass the vault is absent and **no comparison is ever made again**. A vault drained 1.0 BTC → 0.5 BTC across the unreadable pass stays activated and produces no finding — exactly the "99.98% of a customer's Bitcoin" case `detectBalanceDrops` was written for. **Fix:** `balances[v] = prev?.balances?.[v] ?? undefined` carry-forward for unreadable vaults, symmetric with `activation`.

---

## 10. MEDIUM — `run-tests.sh`'s assertion floor is defeated by the same mechanism it guards, and does not match the advertised suite.

`MIN_ASSERTIONS="${CBOB_MIN_ASSERTIONS:-120}"` exists because `CBOB_TEST_FILE` is overridable — but the floor is overridable by env var too: `CBOB_MIN_ASSERTIONS=1 CBOB_TEST_FILE=tiny.ts ./run-tests.sh` is green. Also, the brief states an **82**-assertion suite while the floor is **120**: either step [7/7] has never passed with defaults, or the floor is routinely overridden. Both readings are bad. Additionally `sed … | tail -1` extracts the **denominator**, so a suite printing a later, smaller `n/m as predicted` line lowers the measured count. **Fix:** hardcode the floor, assert `numerator == denominator == expected`, and refuse if `CBOB_TEST_FILE` is set.

---

## 11. MEDIUM — `build-mainnet.sh` omits the two gates `run-tests.sh` documents as load-bearing.

`boot()` does `kill_v; sleep 2` and starts the validator **without waiting for :8999/:9900 to be free** and **without asserting Core is present or byte-identical** — the exact "a half-dead validator answers `cluster-version` and your deploys land on it" trap that `run-tests.sh` spends a paragraph on. It also consumes `$CACHE/core-mainnet.so` which it never dumps or hash-checks (populated only by `run-tests.sh`). The script whose entire purpose is *proof* can therefore certify bytes on the strength of answers from a validator it did not boot. **Fix:** reuse `run-tests.sh`'s port wait + `cmp` gate verbatim; fail if the cache is absent.

---

## 12. MEDIUM — logs and money live in world-writable `/tmp`; keys, both ledgers and the watcher share one uid.

`/tmp/cbob-*.log` rotated by root (`su root root`, `copytruncate`) in a world-writable directory is the classic logrotate target; any local user can pre-create `/tmp/cbob-x.log`. The same host holds `keys/swap-operator.json` (the trusted hop), `keys/distributor.json` (**the holders' entire 85%**, uncapped accumulation, pinned to `config.treasury` so it cannot be a cold wallet), `revenue-ledger.json`, `distributions.json` and `state.json` — all writable by the process that signs. Findings 2 and 3 are both consequences. **Fix:** logs to `/var/log/cbob` (mode 750, owner ubuntu); state/ledgers owned by a *different* uid than the signer, or append-only + hash-chained off-host.

---

## 13. LOW (cluster)

* `sweep_cooldown_secs` is accepted as **0** by `initialize` and `update_wiring` (`(0..=MAX)`), the exact configuration `detectStandingRisks` calls CRITICAL and "not a bound". Make it `1..=`. Symmetrically, `max_sweep_lamports` has no upper bound, so `u64::MAX` + `cooldown=1` passes the alarm's "both are set" check.
* `Number(q.priceImpactPct ?? 0)` — a response that **omits** the field reads as 0% impact and passes the ceiling. Require the field.
* `distribute.mjs --dry-run` still calls `save(st)` on the skip path and writes `finishedAt`/`per` at the end. A dry run must not touch the money ledger.
* `split_revenue` is all-or-nothing: cbBTC has a live freeze authority, so one frozen destination ATA (bank *or* holders) blocks the other's 85% indefinitely. Consider two independent instructions.
* GOV: N simultaneously-passed proposals are each independently executable inside a 7-day window, and each `set_round` resets `minted_this_round` — a majority can multiply a round's cap by N up to `max_supply`. Bounded, but not what "the per-round cap" says.
* `set_collection_royalties` becomes permanently uncallable after the governance handover (same root cause as #5).

---

## WHAT I TRIED AND COULD NOT BREAK

* **`set_collection_royalties` byte encoding.** Checked against Core's layout: opcode 3/7 for Add/UpdateCollectionPluginV1 ✓; `Plugin::Royalties` = 0 ✓ (consistent with 6=Attributes and 17=PermanentFreezeExecute, both measured working); `basis_points: u16` LE ✓; `creators: Vec<Creator>` = `u32 len` + `Pubkey` + `u8 percentage` ✓; `RuleSet::None` = 0 ✓; `Option<PluginAuthority> = None` trailing byte present **only** on the Add path, absent on Update ✓ (`UpdateCollectionPluginV1Args` has no authority field). Accounts `collection, payer, authority, system_program, MPL_CORE(=absent log_wrapper)` match the SEAL CPI shape that provably works. **I found no wrong byte.**
* **`split_revenue` destination substitution.** All three ATAs are re-derived in-handler from `["revenue"]`, `cfg.treasury`, `cfg.bank_treasury`; a hostile mint only lets you split a token nobody wants; `decimals` is validated by TransferChecked; the derived ATA address cannot be squatted with a fake account (only the ATA program can allocate there). Rounding is exact: `bank_cut` floored, `holders = total - bank_cut`, sum == balance, and `total > 0` is required. Round 6's floor fix is **real**.
* **MintConfig offsets.** Byte-walked every field: GOV's `governance@105`/`minted_total@205`, the alarm's 18 offsets, and `Initialize::space` (369) all agree exactly, including the round-6 append-after-`bump`.
* **Double voting.** `VoteRecord` at `["vote", proposal, asset]` with `init` and no close instruction; transfer-then-revote, delegate voting, collection-as-voter, and voting a burned vault (the account is gone, `read_core_asset` fails) all refused.
* **`sweep_sol_for_swap` pin.** Destination comes only from `cfg.swap_operator`, checked against the passed account; `keep + amount` overflow-checked; the revenue PDA holds no data so there is no rent-exemption trap; the cap+cooldown genuinely defeat the "N sweeps in one transaction" bypass.
* **The `mint_vault` vote-buying variant of #1** — minting yourself votes against the frozen `quorum_supply` divisor is real in principle, but `mint_vault` requires `bank: Signer`, so the Bank gates every new voter. That is load-bearing and written down nowhere: record it as an explicit Bank duty ("refuse mints while a proposal's voting window is open") and add it to the alarm.

---

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Snapshot `quorum_bps` and `threshold_bps` into `Proposal` at creation, beside `quorum_supply`, and read them from the proposal in `execute_proposal`.** Three lines. Without them, one admin signature plus one vault converts the entire remaining ~1,911-vault supply into a free mint, and the alarm — which watches neither `round_id`, nor `price_lamports`, nor `minted_total` — will not report it.