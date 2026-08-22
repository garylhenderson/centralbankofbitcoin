## Findings

### HIGH — A missing distribution ledger is treated as a first run; it can erase the anti-double-payment record

**Construct:** `bank/distribute.mjs`, `load = () => readLedger(STATE, { days: {} })`; `bank/alarm.mjs`, distribution-ledger gate:

```js
if (dist !== null || fs.existsSync(DIST)) {
  findings.push(...D.detectDistribution(dist, ...))
}
```

**Exploit / failure sequence:**

1. A daily distribution completes and `distributions.json` records every paid vault.
2. The file is deleted rather than corrupted: accidental cleanup, failed restore, host compromise, or a process running as the same `ubuntu` account.
3. `distribute.mjs` accepts the missing file as `{ days: {} }`, creates a new record for the current UTC day, and regards every vault as unpaid.
4. If run again that same day—manually, after a cron repair, or by a duplicate/alternate scheduler—it will distribute the currently available cbBTC again to every activated vault.
5. `alarm.mjs` does **not** call `detectDistribution(null)` when the file is absent. It silently skips the distribution detector entirely. There is no “has run before” marker analogous to `.alarm-has-run`, and no distribution deadman cron.

This is not protected by the lock: the lock prevents concurrent writers, not a fresh process with a newly accepted empty ledger.

**Evidence that would exist:** remove `distributions.json` after a completed test-day run, invoke `distribute.mjs` again before UTC midnight, and inspect the new ledger and transfer signatures. The new ledger will contain fresh intents for vaults already paid that day. Run `alarm.mjs`; it will not emit `distribution_ledger_unreadable` because it deliberately does not inspect an absent ledger.

**Fix:**

- Missing distribution state must be fatal after explicit initialization, not a fresh start.
- Create an independent durable marker, e.g. `/opt/cbob-vaults/bank/.distribution-has-run`, before the first real transfer.
- Make `distribute.mjs` refuse a missing ledger when that marker exists.
- Make `alarm.mjs` emit **CRITICAL** for a missing distribution ledger after initialization, not merely an unreadable one.
- Add a deadman check for both the distribution ledger/state and the daily job’s completion.
- Prefer a durable transactional store or append-only signed/replicated payment journal over a mutable JSON file that is itself the sole anti-replay control.

---

### HIGH — The post-sweep Jupiter quote accepts a missing `priceImpactPct` as zero after SOL has already left the revenue PDA

**Construct:** `bank/revenue.mjs`, post-sweep quote validation:

```js
const impact2 = Math.abs(Number(q2.priceImpactPct ?? 0))
if (!Number.isFinite(impact2) || impact2 > MAX_PRICE_IMPACT_PCT)
  throw new Error(...)
```

The pre-sweep quote correctly rejects an omitted field:

```js
if (q.priceImpactPct === undefined || q.priceImpactPct === null)
  throw new Error(...)
```

But the second quote—the one actually submitted after the SOL sweep—reintroduces the exact missing-measurement-as-zero failure.

**Exploit / failure sequence:**

1. The operator obtains an acceptable initial quote and calls `sweep_sol_for_swap`; up to the on-chain sweep cap moves to the operator.
2. The fresh `q2` response has `outAmount` and a valid route but omits `priceImpactPct`, whether from an API schema change, degraded response, intermediary tampering, or a mocked/bad upstream response.
3. `q2.priceImpactPct ?? 0` becomes `0`; the script treats the route as zero-impact and submits it.
4. The script swaps customer SOL despite having explicitly defined missing price-impact data as unacceptable before the sweep.

The defect matters more after the sweep because the money is already outside the revenue PDA. A refusal at that point leaves a visible open cycle; acceptance can realize the bad trade.

**Evidence that would exist:** unit-test or mock Jupiter’s second quote as:

```json
{ "outAmount": "1", "swapTransaction": "..." }
```

with no `priceImpactPct`. The first validation would reject this shape; the `q2` path computes `impact2 === 0` and proceeds to `/swap`.

**Fix:**

```js
if (q2.priceImpactPct === undefined || q2.priceImpactPct === null) {
  throw new Error('post-sweep quote has no priceImpactPct; do not swap')
}
const impact2 = Math.abs(Number(q2.priceImpactPct))
```

Also, `priceImpactPct` is not a price floor. It measures route/liquidity impact, not whether cbBTC/SOL moved materially between `q` and `q2`. Preserve the pre-sweep quote and require a minimum output, for example:

```js
const minOut = BigInt(q.outAmount) * 9_800n / 10_000n; // policy value
if (BigInt(q2.outAmount) < minOut) refuse
```

The chosen tolerance needs an explicit business policy, but accepting any fresh absolute rate merely because the route reports low impact is not a meaningful execution-price bound.

---

### MEDIUM — Vaults minted after proposal creation can vote on a denominator that excludes them

**Construct:** `programs/cbob-vault-gov/src/lib.rs`:

- `create_proposal` snapshots only `minted_total`:

```rust
let quorum_supply = read_mint_config(&ctx.accounts.mint_config)?.1;
p.quorum_supply = quorum_supply;
```

- `cast_vote` accepts any currently owned collection asset and has no issuance/eligibility cutoff:

```rust
let (owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
require_keys_eq!(collection, ctx.accounts.config.collection, GovError::ForeignVault);
```

- The `VoteRecord` prevents a second vote by the **same asset**, but not voting by a newly minted asset.

**Exploit sequence:**

1. Supply is 190 when an attacker creates a proposal. `quorum_supply` is fixed at 190.
2. During the voting period, an open mint round permits new vaults. The attacker mints vaults, with the Bank co-signing ordinary mints as required by the current MINT design.
3. Each newly minted vault can immediately cast one vote.
4. Those votes count toward quorum and threshold, although the vaults did not exist when the proposal and its quorum divisor were established.

The snapshot therefore prevents later minting from raising the quorum bar, but it also lets later minting create voting power against a smaller historic denominator. The Bank’s mint co-signature is not an on-chain voting-eligibility rule and the stated Bank simulation duty concerns token-account/delegate safety, not deciding which customers may acquire governance votes.

**Evidence that would exist:** validator test:

1. Mint N vaults.
2. Create a proposal and record `proposal.quorum_supply == N`.
3. Mint another vault after creation.
4. Cast a vote using that new asset.
5. Observe `yes` increment and execute using votes including the later asset.

**Fix:** stamp a monotonically increasing issuance serial into each vault at `mint_vault`, and snapshot the upper eligible serial in `Proposal`. At vote time, parse and require `vault_serial <= proposal.eligible_through_serial`. The serial must be written in the hardcoded mint provenance and protected from alteration. This preserves continuous sales while preventing post-proposal voting power from entering an open vote.

If the intended policy is explicitly “newly sold vaults vote immediately in already-open proposals,” document that as a governance rule and stop describing `quorum_supply` as a proposal-time electorate snapshot. As written, the code snapshots only the denominator.

---

### LOW — Daily reconciliation invokes the index-completeness detector with counts instead of ID arrays, creating permanent false CRITICALs

**Construct:** `bank/alarm.mjs`, `reconcile()`:

```js
const findings = [...D.detectIndexShortfall(
  cfg['mint.minted_total'], live.length, burnt.length
)]
```

But `detectIndexShortfall(mintedTotal, liveIds, burntIds)` expects arrays of asset IDs:

```js
const live = new Set(Array.isArray(liveIds) ? liveIds : [])
const burnt = new Set(Array.isArray(burntIds) ? burntIds : [])
```

Passing numbers causes both sets to be empty. Any nonzero `minted_total` produces a false `index_disagrees_with_chain` finding reporting zero indexed vaults.

**Impact:** the reconcile still enumerates token accounts afterward, so this does not suppress undeclared-account findings. It does, however, makes the daily reconcile permanently noisy once vaults exist. Persistent false CRITICAL alerts train operators to disregard the exact job intended to catch undeclared token accounts before a destructive burn.

**Evidence that would exist:** with `minted_total = 1`, `live = ['asset']`, `burnt = []`, the current call reports `0 UNIQUE vaults`; changing the call to pass `live, burnt` produces no shortfall.

**Fix:**

```js
const findings = [...D.detectIndexShortfall(
  cfg['mint.minted_total'], live, burnt
)]
```

Add an integration selftest that invokes `reconcile()`’s completeness call shape, not only the detector in isolation.

---

## What I could not break from the supplied code

- I did **not** find a caller-controlled destination in `split_revenue`. The three token accounts are forced to classic-SPL ATAs derived from the revenue PDA, `config.treasury`, and `config.bank_treasury`; the Token Program then enforces the actual transfer semantics.
- The split arithmetic appears internally consistent: Bank share is floored, holder share is `total - bank_cut`, and the transfers sum exactly to the observed source amount. `u128` prevents multiplication overflow for a `u64` token balance.
- `sweep_sol_for_swap` does pin the recipient to `config.swap_operator`, requires that key to sign, rejects zero amount, enforces a nonzero cooldown floor, applies its per-sweep cap, and checks the retained SOL reserve before transfer.
- I found no direct double-vote route via transfer: `VoteRecord` is correctly keyed by proposal and asset, rather than voter wallet.
- Execution is protected against repeat execution, stale execution beyond the execution window, execution of superseded proposal IDs, and installing a round whose closing time has already passed.
- I did not treat price-zero charter mints, bare Core burns, or PDA pre-funding as findings; the supplied constraints and prior measured results address those claims.

## The single thing to fix before this holds real money

**Make the distribution payment ledger non-resettable.** A deleted `distributions.json` currently becomes an accepted clean slate and can erase the only record preventing repeat daily payouts. Until missing-state handling is fail-closed and independently monitored, the payout system has no durable anti-double-payment guarantee.