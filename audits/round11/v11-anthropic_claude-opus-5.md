# ROUND 11 — FINDINGS

## 1. HIGH — `splitByOther` never fires: the round-10 wedge fix keys on an Anchor error *name* that lives in `logs`, not `message`

`bank/revenue.mjs`, split step:

```js
if (/NothingToSplit/.test(String(e.message)) && left === 0n) { cycle.splitByOther = true … }
throw e
```

`sendAndConfirmTransaction` throws `SendTransactionError`, whose `.message` is the RPC-level string (`… Transaction simulation failed: … custom program error: 0x1775`). The Anchor name `NothingToSplit` is emitted in **program logs**, exposed as `e.logs` / `getLogs()`, and whether it is spliced into `.message` is a version-dependent formatting detail of web3.js. **This file's two other rejection tests deliberately avoid depending on it** (`/custom program error|Error Code:|Transaction simulation failed/` in the sweep path; the same generic set in `distribute.mjs`), and the suite's own `att()` harvests `e.logs` precisely because the code names are not in the message. So the one site that needed the name is the one site that reads the wrong field.

Exploit: anyone watches the revenue ATA and sends `split_revenue` (permissionless) after our return transfer lands. Our split reverts on `NothingToSplit`, the regex misses, `throw e` — the cycle keeps `returnedSats` with no `splitSig`/`splitByOther`, so `cycleIsOpen` is true and **every subsequent `revenue.mjs` run dies at the open-cycle guard**. Cost to the attacker: one transaction fee, once. Secondary: `detectUnreconciledRevenue` raises `cycle_unsplit` HIGH forever about cbBTC that *was* split.

Fix: make the **emptiness proof the decider** — if `revAta` balance is 0 after our split failed, the split happened; record `splitByOther` regardless of the error text. If you keep a text test, match `e.logs` and the numeric code, not the name in `.message`.

## 2. HIGH — the 200-assertion suite never asserts the seal. A vault born UNFROZEN, or a thaw with no paired close, produces a fully green run

`tests/3prog.test.ts` asserts the freeze plugin's *authority* (2.3) and never its *state*. Nothing asserts `permanentFreezeExecute.frozen === true`. Nothing sends an `open_for_redemption` **without** a `close_redemption` (`NoTerminalClose` is unexercised — while its mirror, `NoPrecedingOpen`, is tested at 5.1: one of two identical sites again). Nothing sends a bare Core `Execute` by the owner with no open at all.

Consequence: flip `data.push(1); // frozen` to `0` in `mint_vault`, or break the sysvar-introspection loop in `open_for_redemption` (an Anchor version that changes `DISCRIMINATOR`, a reordered account list — `ix.accounts.get(2)` is a positional read), and **every one of the 200 assertions still passes**: 2.3 reads the authority, 3.2/4.2 thaw-then-sweep inside one transaction either way, 5.1 is unaffected. The property "no key anywhere can unseal a vault" — the customer's entire basis for paying — is the one property with no test. Round 5 "measured" it once by hand; the project's own standard is a permanent test (they added one for the pre-funded proposal PDA).

Fix: three assertions. `fetchAsset(...).permanentFreezeExecute.frozen === true` at mint; `send([ixOpen(V,…)])` alone must REJECT with `NoTerminalClose`; `send(sweep(V,SATS,0))` with no open must REJECT (Core 0x9).

## 3. MEDIUM — `resolvedBy` was added to one of two filters, and a frozen destination ATA becomes unbounded permanent noise

`detectDistribution`:

```js
const unresolved = rows.filter(([,r]) => !r.sig && !r.skipped && !r.rejected && !r.resolvedBy)
const refused    = rows.filter(([,r]) => r.rejected)          // ← no resolvedBy
```

cbBTC has a live freeze authority. One frozen vault ATA ⇒ `done[v].rejected = true` ⇒ (a) `distribution_refused` HIGH for that day, with **no way for a human to close it**, and (b) because `finishedAt` is only set when `!failed.length && !ambiguous.length`, that day *also* raises `distribution_unfinished` HIGH forever — and `resolvedBy` does not restore `finishedAt` either, so the round-10 resolution path cannot resolve the day even for the finding it does cover. `detectDistribution` iterates **every day ever recorded**, so a persistently frozen ATA yields two new permanent HIGHs per day, every 30 minutes, indefinitely. Nothing retries a refused row (the next day builds a fresh `paid: {}`), so the detector's own claim "they are retryable" is true only of a human.

Fix: add `&& !r.resolvedBy` to `refused`; let `resolvedBy` on the last outstanding row set `finishedAt`; bound the day loop to a horizon (as `detectSplitClaims` already does).

## 4. MEDIUM — the six oldest negative assertions do not check *why* the transaction was rejected

`because()` covers everything from §6 onward and **nothing** in §1–§5: `1.1`, `3.1` (close without the Bank), `3.3` (delegate planted during the thaw), `4.1` (burn while the BTC is inside), `4.4` (burn without the Bank), `5.1`, `8.12`. These are the 2-of-2 and the emptiness proof — the assertions the whole product rests on — and each passes on *any* rejection: a transaction-size limit, a missing signer, a Core quirk. This is exactly the false-pass class the suite documents having found three of. Add `because('3.1','NotTheBank')`, `('3.3','ReserveDelegated')`, `('4.1','VaultNotEmpty')`, `('4.4','NotTheBank')`, `('5.1','NoPrecedingOpen')`, `('8.12','MintPaused')`.

## 5. MEDIUM — the "class-closing" assertion still does not cover everything the standing checks read

`detectStandingRisks` reads `seal.collection`, `mint.collection`, `burn.collection`, `gov.collection` for `collections_disagree`. **None of the four appears in `WATCH` or in `WATCHED_KEYS`.** They happen to be produced today, so nothing fails — which is precisely the failure mode the round-9/10 mechanism exists to prevent: drop `collection` from any one program's field list in `readConfigs` and `colls.length > 1` stays true, the check silently compares fewer programs, and the report reads calm. The round-10 claim "it now asserts against everything the standing checks read" is false. Add the four keys (and note they are also not drift-watched — a program upgrade is the only thing that could move them, caught only by `prog.*.hash`).

## 6. MEDIUM — "tightening a bound is always admin's to do today" is false: admin alone can wedge the revenue cycle, and the standing check only looks the other way

`needs_governance` lets admin alone set `sweep_cooldown_secs` **up** to 7 days and `max_sweep_lamports` **down** to 1 lamport. `revenue.mjs` obeys both (`if (amount > chainCap) amount = chainCap`; early return inside the cooldown), so the pipeline sweeps 1 lamport a week and SOL piles up in the revenue PDA. Undoing it needs the governance signature, which in production is a PDA that can only sign `set_round` — so recovery is a governance rotation (≥3 days), and a *hostile* admin holds `cancel_pending_admin`/`cancel_pending_governance` and can block it indefinitely. `detectStandingRisks` checks only `cooldown < 3600` and `cap === 0`; a 7-day cooldown and a 1-lamport cap raise **no standing finding at all** (one drift CRITICAL, on the single pass it changed). Fix: bound admin-only tightening (e.g. cooldown ≤ 24h, cap ≥ some floor) and add the symmetric standing checks.

## 7. MEDIUM — no config migration path: the next appended field bricks MINT, including the only route cbBTC can leave the revenue PDA

Fields were appended to `MintConfig` in rounds 6, 8 and 10 (`pending_operator*` now ends at 489). `Initialize` allocates exactly the current size; there is no `realloc` instruction in any of the four programs. After mainnet init, an upgrade that appends one field makes every `Account<MintConfig>` deserialize fail — `mint_vault`, `sweep_sol_for_swap`, **and `split_revenue`**, which is the only instruction that can move cbBTC out of the revenue PDA. Given the observed cadence of appends, this is a when, not an if. Fix before launch: reserve padding in all four `Initialize` space calculations, or ship a `migrate` instruction now and test it.

## 8. LOW — three one-of-two-sites leftovers
- `bank/distribute.mjs --selftest` has **no assertion floor** (`process.exit(R.every(Boolean) ? 0 : 1)` — an empty/partial `R` exits 0), while its sibling `selftest.mjs` got `FLOOR = 135` in round 10. `run-tests.sh` [6/7] treats it as a gate.
- `acquireLock` breaks a stale lock purely on age, with **no liveness test** on the recorded pid. Combined with the 20-hour payout timeout, a genuinely slow run can be joined by a second runner, which is the one thing the lock exists to prevent. Add `process.kill(pid, 0)`.
- `revenue.mjs` writes the literal string `'split-by-another-caller'` into `cycle.splitSig`. Every current reader checks `splitByOther` first; the next one won't. Leave `splitSig` undefined.
- The `mint config not initialised` branch in `alarm.mjs` calls `writeState(...)` **before** `report(...)`, so an undelivered finding on that path advances the baseline — the round-7 defect surviving in its idle twin.

# WHAT I TRIED AND COULD NOT BREAK

- **Manufacturing the empty-ATA proof.** No route empties the revenue cbBTC ATA except `split_revenue`, which pins both destinations from config, verifies all three ATAs by derivation, and uses `TransferChecked` (so a wrong `decimals` fails). The ATA address is a PDA of the ATA program, so no attacker can pre-allocate data there; `d.len() >= 72` therefore implies a real token account. Rounding: Bank floors, holders take the remainder, the two sum exactly; `total > 0` is required.
- **Sweep.** Destination pinned in config, operator must sign, `amount > 0`, cap, reserve check, and two sweeps in one transaction share `unix_timestamp` so the 1-second floor really does close the atomic bypass.
- **GOV.** Double-vote by transfer (VoteRecord seeded by asset), by a burned vault (the account is closed, `read_core_asset` fails), by the collection, by a delegate; replay (`last_executed_id`), stale execution (`EXECUTION_WINDOW_SECS` + `RoundAlreadyOver`), quorum flooring (ceiling division, `MIN_QUORUM_BPS`, `max(snapshot, live)`), retroactive rule changes (both bps snapshotted into the Proposal). A ratified proposal can still only set two fields, and `max_supply` bounds it independently.
- **Offsets.** `MintConfig` = 489 bytes exactly; `Initialize` space, `alarm.mjs` (`pending_operator` @449/481), the test's `subarray(449,481)` and GOV's `read_mint_config` (105/205) all agree.
- **lock.mjs / ledgers.** Atomic temp+fsync+rename; missing-vs-corrupt distinction; marker semantics tested in both directions. `--dry-run` in `distribute.mjs` and the no-`--live` path in `revenue.mjs` write nothing, including no marker.
- **Index completeness.** Unique-and-exact against `minted_total` in both the alarm and `distribute.mjs`; the wrong-shape throw is real.

# THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Assert the seal. Add the three missing assertions to `tests/3prog.test.ts` — the plugin decodes `frozen: true` at mint, `open_for_redemption` **alone** is refused with `NoTerminalClose`, and a bare owner `Execute` with no open is refused by Core — plus `because()` on 3.3 and 4.1. Right now the one property a customer's Bitcoin depends on is the one property a green 200-assertion run does not test, and a single flipped byte in `mint_vault` would ship it silently.