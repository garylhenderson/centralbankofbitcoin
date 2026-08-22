## FINDINGS

### 1. HIGH — `detectUnledgeredSweeps` treats any ledger row with the same sig as proof (amount is still the operator’s word)
`bank/detectors.mjs` `detectUnledgeredSweeps` only checks `c.sweepSig`. It never decodes the `u64` at `dataBytes[8..16]`.

Round 7 added this specifically because the ledger is written by the same process that holds the swap key. That control still trusts the ledger for the only number that matters.

**Exploit:** operator key + write to `revenue-ledger.json` (same host). Call `sweep_sol_for_swap(max_sweep_lamports)`, then write `{sweepSig, sweptLamports:'1', quotedSats:'1', returnedSats:'1'}`. Chain moved 50 SOL; detector is quiet; `detectUnreconciledRevenue` is quiet (return ≥ 98% of the fake quote). `--audit` is quiet.

**Fix:** decode the on-chain amount; require `BigInt(c.sweptLamports||c.intendedLamports) === onchainAmount`. Flag any mismatch CRITICAL. Do not accept a row that only matches the signature.

### 2. HIGH — Round 7 unique-id check is never given ids
`detectIndexShortfall(mintedTotal, liveIds, burntIds)` does `new Set(Array.isArray(liveIds) ? liveIds : [])`.

Both production callers pass **numbers**:

- `bank/alarm.mjs` `main`: `detectIndexShortfall(..., vaults.length, burnt.length)`
- `reconcile`: `detectIndexShortfall(..., live.length, burnt.length)`

`Array.isArray(5) === false` → both sets empty → `seen = 0`. After the first mint this is a permanent false CRITICAL (`0 UNIQUE vaults but the chain says N`). Duplicate ids, the thing the fix was for, are never examined. Selftest passes arrays, so the suite stays green.

`distribute.mjs` still does the unique/`minted_total` check itself, so this is a blind watcher, not a double-pay by itself.

**Fix:** pass `vaults` and `burnt` arrays. Add a selftest that `detectIndexShortfall('2', 2, 0)` is CRITICAL (catches the next call-site regression).

### 3. HIGH — Post-sweep Jupiter quote still uses `?? 0` (relocated round-7 bug)
`bank/revenue.mjs`: the *pre*-sweep quote rejects a missing `priceImpactPct`. After SOL has already moved:

```javascript
const impact2 = Math.abs(Number(q2.priceImpactPct ?? 0))
```

Missing field → 0% → swap into an unmeasured route. That is the exact bug they closed on `q`, left alive on `q2`, on the side of the hop where the money is already gone.

**Fix:** same reject as `q`. Simulate the Jupiter tx; require operator SOL Δ ≈ sweep and cbBTC Δ ≈ quote; no other balance changes.

### 4. HIGH — `mint.bank` is admin-only and not in the drift watch list
`update_wiring` `needs_governance` omits `bank`. Admin alone replaces the mint co-signer.

`detectConfigDrift` watches `seal.bank` and `burn.bank`, not `mint.bank`. `readConfigs` *does* snapshot `mint.bank` (offset 73). A watch list that stores a key and never compares it is quieter than no watch.

**Exploit:** one `update_wiring(bank=attacker)` signature. Every later `mint_vault` is co-signed without the operational Bank’s simulate-and-refuse policy (PDA token accounts, etc.). Alarm: no finding.

**Fix:** treat `bank` like treasury (governance, or at least the same timelock as admin). Add `mint.bank` to the watch list as CRITICAL.

### 5. HIGH — GOV admin is still instant and can still ratify a round in `min_voting_secs`
Round 7 snapshotted `quorum_bps` into the Proposal (kills the *atomic* path). It did not touch:

```rust
// update_gov_config
if let Some(x) = quorum_bps { c.quorum_bps = x; }
if let Some(x) = admin { c.admin = x; }  // no default-key reject, no timelock
```

`need = quorum_supply * quorum_bps / 10_000` truncates. `quorum_bps = 1` and `supply < 10_000` → `need = 0`; `cast > 0` plus one YES clears a 5001 threshold.

**Exploit:** GOV admin (not MINT admin — the “they can just become governance in seven days” defence is a different key) sets `quorum_bps=1`, `create_proposal` + `cast_vote` with one vault, wait `min_voting_secs` (code floor **60s**), `execute_proposal` → `set_round(price=0, cap=big, window=1y)`. Alarm interval is 30 minutes. Vault BTC is still 2-of-2; issuance and price are not.

Also: `admin = Pubkey::default()` bricks every future `update_gov_config`. MINT rejects default; GOV does not.

**Fix:** timelock GOV admin like MINT. New `quorum_bps` cannot be lower than the value snapshotted into any still-open proposal, or require the same notice period. Refuse `Pubkey::default()`. Do not ship with `min_voting_secs` at the floor (alarm already says this; initialize must not be allowed to leave it there).

### 6. HIGH — “Core is byte-identical to mainnet” compares a file to itself
`scripts/run-tests.sh` / `build-mainnet.sh`: if `/tmp/cbob-vault-test/core-mainnet.so` exists and starts `7fELF`, they skip the mainnet dump, boot the validator with that file, dump it back, `cmp` to the same path. That `cmp` cannot fail.

Round 7 moved *logs* out of world-writable `/tmp` and left the Core cache there. A local uid plants any ELF → green run, banner claims mainnet identity. This is the same class of false green the runner already produced four ways.

**Fix:** pin a mainnet Core sha256 (or dump fresh every run to a second path and cmp those). Refuse a cache hit that does not match the pin.

### 7. MEDIUM — `distribute.mjs` pays the plan, not the live set
Plan is frozen, then each transfer goes to `ataOf[v]` with no re-check that `v` is still live. `burn_vault` requires empty reserve ATAs. Order: empty → Bank co-signs burn → later resume pays that ATA → asset is gone → PDA cannot sign → that day’s share is orphaned.

Bank followed the spec; the job did not. Re-check DAS/live (or skip if the asset account is no longer `KEY_ASSET_V1`) immediately before each send.

### 8. MEDIUM — `set_paused` also kills `sweep_sol_for_swap`
Comment: pause is sale-only; redemptions/burns unaffected. Code: `require!(!cfg.paused)` in `sweep_sol_for_swap`. Holder yield stays as SOL in the revenue PDA for the whole incident. Split still works; conversion does not.

---

## Could not break
- Transfer-then-vote-again: `VoteRecord` seeds `["vote", proposal, asset]`; `init` fails. Standing is live owner bytes; that is the model.
- Execute-time quorum/threshold: both bps and `quorum_supply` come from the Proposal; `execute_proposal` does not read `GovConfig` for the tally.
- `split_revenue` destination swap: ATAs derived from `config.treasury` / `config.bank_treasury` / `["revenue"]`; token program pinned `Tokenkeg…`. Hostile mint only splits that mint to the real wallets. Frozen dest fails closed. Bank share is the floored term; amounts sum to `total`.
- `sweep_sol_for_swap` destination: must equal `config.swap_operator` **and** sign; `amount > 0`; cap + cooldown on-chain; reserve checked with `checked_add`.
- `set_round` past `max_supply`, `cap==0`, year+ window, execute after `closes_at`, execute twice, execute an older id after a newer one.
- Proposal PDA pre-fund (already measured).
- SEAL 2-of-2 open/close pairing and reserve delegate check (not re-opened).
- `state.json` `rm` silent rebaseline (`.alarm-has-run`).
- Sequential double-pay in `distribute` (intent-before-send + lock + `paymentState` ambiguous).
- `detectBurns` on `initialize` when the discriminator is passed (production does).

`set_collection_royalties` encoding is not re-raised: round 6 ran both opcodes against cloned mainnet Core. No new byte-level evidence.

---

**THE SINGLE THING:** Make the two round-7 eyes honest before any customer cbBTC sits behind them — decode sweep **amounts** from chain (not just sigs), and pass **id arrays** into `detectIndexShortfall`. Then gate `mint.bank` and GOV admin the way MINT admin already is. Right now the trusted hop and the DAS completeness check can both print CRITICAL/all-clear independently of the truth, and the suite will not catch either.