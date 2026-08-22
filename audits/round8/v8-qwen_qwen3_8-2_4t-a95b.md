

## FINDINGS

### 1. CRITICAL — `bank/detectors.mjs` `detectUnledgeredSweeps` checks only the signature, not the swept amount
`detectUnledgeredSweeps` builds `known` from `ledger.cycles[].sweepSig` and only asks “is this transaction signature present?” It never parses the `sweep_sol_for_swap` argument from `ix.dataBytes[8..16]`.

Concrete exploit:
1. Swap operator (or malware on the bank host) sends `sweep_sol_for_swap(50 SOL)`.
2. It writes a ledger row: `{sweepSig: <real tx>, sweptLamports: "1", quotedSats: "1", returnedSats: "1"}`.
3. `detectUnledgeredSweeps` sees the signature and stays quiet.
4. `detectUnreconciledRevenue` reconciles the self-reported 1 lamport, not the 50 SOL that actually left.

This re-introduces the exact “ledger is the audited key’s own testimony” hole round 7 claimed to close.

Fix: parse the u64 amount from the instruction data and require a ledger row whose `sweepSig` matches and whose `sweptLamports`/`intendedLamports` equals the on-chain amount. Alert on mismatch.

---

### 2. HIGH — `bank/alarm.mjs` `readConfigs` cannot read u32 fields; `mint.round_id` and `mint.cap` are read as one byte
`readConfigs` handles only `pk`, `u64`, `i64`, `u16`; every other kind falls back to `d[off]`.

But it requests:
```js
['round_id',169,'u32']
['cap',197,'u32']
```
So `round_id` and `cap` are read as a single byte.

Concrete exploit / failure:
- Governance changes `cap` from `256` to `512`. Low byte is `0` in both cases. `detectConfigDrift` sees no change, despite a CRITICAL watched field changing.
- Any `round_id` reporting after 255 is wrong by construction.

Also `gov.last_executed_id` is read at offset `93`. With the current `GovConfig` layout it is at `94` (`... proposal_count[85..93], bump[93], last_executed_id[94..102]`). The watcher is reading the bump byte plus seven bytes of the counter.

Fix: add `u32` support (`readUInt32LE`) and correct `gov.last_executed_id` to offset `94`. Also watch `gov.proposal_count`.

---

### 3. HIGH — `bank/alarm.mjs` calls `detectIndexShortfall` with lengths, but the detector requires arrays
In `main()`:
```js
D.detectIndexShortfall(cfg['mint.minted_total'], vaults.length, burnt.length)
```
and in `reconcile()`:
```js
D.detectIndexShortfall(cfg['mint.minted_total'], live.length, burnt.length)
```
But `detectIndexShortfall` does:
```js
const live = new Set(Array.isArray(liveIds) ? liveIds : [])
```
So it always sees zero unique assets.

Result:
- If `minted_total > 0`, the alarm emits a constant false CRITICAL about “0 unique vaults”.
- If operators mute that finding, the real short-index / duplicate-id protection is dead.
- The detector’s duplicate-collapse fix is not actually exercised by the live pipeline.

Fix: pass the arrays: `vaults`, `burnt`, `live`, `burnt`.

---

### 4. HIGH — missing `distributions.json` after first run is silent; deletion can re-baseline payouts and double-pay
`alarm.mjs`:
```js
let dist = null
try { dist = JSON.parse(fs.readFileSync(DIST, 'utf8')) } catch { dist = null }
if (dist !== null || fs.existsSync(DIST)) { ... }
```
If `distributions.json` is deleted, `dist === null` and `existsSync` is false, so `detectDistribution` is never called. The comment claims a vanished ledger is caught by the state marker, but no such marker exists for the distribution ledger.

`distribute.mjs` treats a missing state file as a first run:
```js
const load = () => readLedger(STATE, { days: {} })
```

Concrete exploit / failure:
1. Daily distribution runs and pays vaults.
2. Attacker or operator deletes `distributions.json` later the same UTC day.
3. Alarm says nothing.
4. A manual re-run, or any same-day re-invocation, sees no payments and pays every activated vault again.

Fix: create a `.distribution-has-run` marker like the alarm state marker; if the ledger is absent but the marker exists, abort `distribute.mjs` and make the alarm raise CRITICAL. Alternatively always call `detectDistribution(null)` after first run.

---

### 5. HIGH — GOV: snapshotted quorum divisor plus live voting rights lets newly minted vaults supply votes without raising quorum
This is not the rejected “require `minted_now == quorum_supply` at execute” liveness fix. The issue is different:

- `create_proposal` snapshots `quorum_supply`.
- `cast_vote` allows any live vault owner to vote, including vaults minted after proposal creation.
- New vaults increase YES/NO counts but do not increase the quorum divisor.

Concrete exploit:
1. `minted_total = 190`, quorum 50% => need 95 votes.
2. Attacker controls 48 existing vaults.
3. A public mint round is open; attacker mints 47 more vaults (Bank co-signature is the only gate).
4. Attacker votes all 47 new vaults YES.
5. `cast = 95`, `need = 95`, proposal passes.

The only control is the Bank refusing to co-sign mints while proposals are open. That is off-chain and not encoded in the alarm.

Fix: at minimum, add an alarm detector for `mint_vault` while any GOV proposal is in voting. Operationally, Bank must refuse mint co-signatures during open proposals. If continuous minting is required, governance eligibility needs a real snapshot mechanism.

---

### 6. HIGH/MEDIUM — `bank/revenue.mjs` post-sweep quote bypasses the impact ceiling when `priceImpactPct` is missing
First quote correctly refuses missing impact:
```js
if (q.priceImpactPct === undefined || q.priceImpactPct === null) throw ...
```
But after SOL has already been swept:
```js
const impact2 = Math.abs(Number(q2.priceImpactPct ?? 0))
```
If Jupiter omits `priceImpactPct`, impact becomes `0` and the swap proceeds against an unmeasured route with customer SOL already on the operator key.

Fix: throw if `q2.priceImpactPct` is `undefined` or `null`, exactly as before the sweep.

---

### 7. MEDIUM — revenue cycle is treated as closed after cbBTC return even if `split_revenue` never completes
`revenue.mjs` sets `returnedSats` before the split. If `split_revenue` throws, the cycle has `returnedSats > 0`, so `cycleIsOpen` is false and `detectUnreconciledRevenue` stays quiet. The cbBTC sits in the revenue ATA, not in the distributor ATA, so daily distribution does not see it.

This is not permanent theft — `split_revenue` is permissionless — but it is a silent stall of holder funds with no detector.

Fix:
- `detectUnreconciledRevenue` should flag cycles with `returnedSats > 0` but no `splitSig`/`finishedAt` after a grace period.
- `revenue.mjs` should retry split before starting a new cycle or leave a distinct `splitPending` state.

---

### 8. MEDIUM — `update_wiring` still puts two controls behind the production-unobtainable governance signature
`needs_governance` includes:
```rust
|| sol_reserve_lamports.is_some()
|| governance_timelock_secs.is_some()
```
But once `config.governance` is the GOV PDA, it can only sign `set_round`. Therefore:
- `governance_timelock_secs` can never be raised in production, despite the comment saying it is ratchetable upward.
- `sol_reserve_lamports` can never be adjusted in production.

This is the same class round 6 found: a gate that is unsatisfiable in the intended wiring.

Fix: split by direction. Raising `governance_timelock_secs` and increasing `sol_reserve_lamports` are tightening operations and should be admin-only. Decreasing `sol_reserve_lamports` can remain governance-gated, but if that is intentionally impossible, state it and alarm on it.

---

### 9. LOW — `bank/revenue.mjs` `audit()` re-implements the open-cycle predicate
Round 7 centralized this in `cycleIsOpen`, but `audit()` still uses:
```js
const open = l.cycles.filter(c => (c.sweptLamports || c.intendedLamports) && BigInt(c.returnedSats ?? 0) === 0n)
```
This ignores `sendRejected`, so a program-rejected sweep appears as an unreconciled cycle in `--audit`.

Fix: use `cycleIsOpen` everywhere.

---

### 10. LOW — build/test cache lives in `/tmp`
`run-tests.sh` and `build-mainnet.sh` use `/tmp/cbob-vault-test`, including `core-mainnet.so` and upgrade-authority keypairs. On a multi-user host this is poisonable. The logs were moved out of `/tmp`; the certification cache was not.

Fix: use a private directory under `/opt/cbob-vaults`, chmod `700`, and pin a known Core hash rather than trusting whatever dump is present.

---

## WHAT I TRIED AND COULD NOT BREAK

- Double-voting by transferring a vault: `VoteRecord` is seeded by proposal + asset, so the asset itself is consumed once per proposal.
- Voting by delegate, collection, or burned asset: `cast_vote` reads the live owner bytes and requires that owner’s signature; burned/closed assets fail the Core asset read.
- Executing a proposal twice, after expiry, or after a newer proposal: `executed`, execution window, and monotonic `last_executed_id` block these paths.
- `split_revenue` destination hijack: holder/bank ATAs are derived from pinned config addresses; caller-supplied accounts cannot redirect funds.
- `split_revenue` rounding: u128 math is safe; bank share is floored; transfers sum exactly to the balance.
- `sweep_sol_for_swap` atomic bypass: signer + `amount > 0` + cooldown floor 1 close same-transaction repeated sweeps.
- SEAL open/close pairing: open requires a later close for the same asset and owner; close requires a prior open and re-seals; reserve delegate/close-authority checks reject delegated canonical ATAs.
- Proposal PDA pre-funding: already measured false; I did not find a new pre-create/reinit path for `VoteRecord` or `Proposal`.
- `set_collection_royalties` byte layout: I could not identify a concrete byte-level failure that would silently misroute royalties; wrong add/update selection fails loudly rather than moving funds.

---

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Fix the off-chain watcher so it cannot be quietly wrong about money movement: make `detectUnledgeredSweeps` verify the on-chain sweep amount, fix `alarm.mjs` u32/gov-offset reads, pass real arrays to `detectIndexShortfall`, and treat a missing distribution ledger after first run as CRITICAL. The programs may be sound, but right now the alarm can miss or misreport exactly the fund flows it exists to catch.