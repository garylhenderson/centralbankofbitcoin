## FINDINGS

### HIGH — `sweep_sol_for_swap` has no on-chain 50 SOL cap; anyone can sweep the entire revenue balance above reserve in one call
**File / construct:** `programs/cbob-vault-mint/src/lib.rs`, `sweep_sol_for_swap`

The stated 50 SOL maximum exists only in `bank/revenue.mjs`:

```js
if (amount > MAX_PER_CYCLE_LAMPORTS) amount = MAX_PER_CYCLE_LAMPORTS
```

The on-chain instruction accepts caller-selected `amount` and checks only:

```rust
require!(bal >= keep.checked_add(amount)?, MintError::ReserveWouldBreach);
```

There is no `amount <= 50 SOL` condition, no per-cycle state, and no rate limit.

**Exploit:** Any external caller, needing no signature, submits `sweep_sol_for_swap(amount = revenue_lamports - sol_reserve_lamports)`. The MINT program signs the System transfer and sends all sweepable SOL to `config.swap_operator`.

The destination is pinned, so this is not an arbitrary-recipient theft. It is nevertheless a direct violation of the stated blast-radius guarantee: compromise, loss, operational failure, or malicious use of the swap-operator key now exposes the entire accumulated SOL balance, not 50 SOL. The off-chain script’s cap does not constrain hostile direct calls.

**Evidence expected:** Fund the revenue PDA with more than 50 SOL above reserve on a validator, then invoke `sweep_sol_for_swap` directly with the full excess. It should succeed under this code.

**Fix:** Enforce `amount <= MAX_SOL_PER_CYCLE` on-chain. If “per cycle” means more than per instruction, add on-chain sweep-cycle state with a time window and cumulative amount; otherwise callers can split a large sweep across transactions.

---

### HIGH — The alarm transaction cursor is permanently stale and misses most relevant transactions after the first run
**File / construct:** `bank/alarm.mjs`, transaction scan in `main()`

```js
let newest = prev?.lastSignature || null
for (const prog of [SEAL, MINT, BURN, GOV, CORE]) {
  const sigs = await conn.getSignaturesForAddress(prog,
    { until: prev?.lastSignature || undefined, limit: 200 }, 'confirmed')
  if (!newest && sigs.length) newest = sigs[0].signature
  ...
}
writeState({ ..., lastSignature: newest })
```

After the first pass, `prev.lastSignature` is non-null, so `newest` is initialized to that old value and is never updated. Every later run writes the same cursor back.

There is also only one cursor for five unrelated address histories. A signature from SEAL is not a reliable boundary in MINT, BURN, GOV, or especially Core history.

**Exploit / impact:** The detector is the asserted monitor for bare Core burns, PDA-owned non-ATA token accounts, and approval transactions. An attacker can arrange for a relevant transaction to fall outside the latest 200 transactions returned for the queried program. Core activity alone is sufficiently high-volume that `limit: 200` is not a meaningful complete tail. Because the cursor never advances, old unseen entries remain unseen forever.

A bare Core `BurnV1` of a vault can therefore be missed by the only watcher meant to raise the emergency alarm. Likewise, a noncanonical account creation or approval that should cause the Bank to intervene can be absent from the report.

**Evidence expected:** Run the alarm twice with a mocked RPC history containing more than 200 signatures after the first stored cursor. Inspect `state.json`: `lastSignature` remains the original value. Put a synthetic burn at entry 201 or older; it is never normalized or passed to `detectBurns`.

**Fix:** Maintain an independent cursor per queried address. Advance it only after all pages have been fetched and processed successfully. Paginate until the stored cursor is reached; alarm loudly if a provider/history limit prevents complete traversal. Do not use Core-program transaction history as the sole source for asset-specific critical events; use indexed asset/account transaction histories and periodic full reconciliation.

---

### HIGH — Daily distribution can double-pay under concurrent invocation and underpay after a crash
**File / construct:** `bank/distribute.mjs`, `load/save`, daily state, and payout loop

The “one distribution per UTC day” guard is a plain JSON read-modify-write with no file lock, process lock, transaction nonce, or chain-side idempotency:

```js
const st = load()
st.days[day] ||= { paid: {}, startedAt: ... }
...
if (done[v]) continue
...
const sig = await sendAndConfirmTransaction(...)
done[v] = { amount: String(plan.per), sig }
save(st)
```

Two cron/manual processes can both load an empty `paid` map, both compute the same allocation, and both transfer to every activated vault before either process writes its state.

There is a separate restart accounting failure. `plan.per` is recomputed from the *current remaining distributor balance* but divided by the original full activated set. Previously paid vaults are then skipped:

```js
const plan = allocate(balances, available)
...
if (done[v]) continue
```

`st.days[day].per` is written only after the entire run finishes, so it cannot preserve the original per-vault amount during recovery.

**Concrete crash exploit / failure:**
1. Two activated vaults, A and B; distributor has 100 sats.
2. First run calculates 50 sats each and successfully pays A.
3. Process crashes before B and before `finishedAt`.
4. Restart sees 50 sats available, calculates `50 / 2 = 25` sats each, skips already-paid A, and pays B 25 sats.
5. A receives 50, B receives 25, and 25 remain undistributed.

**Concurrent case:** Start the daily cron and a manual invocation together. Both see no recorded payments and each sends the full allocation. Customers receive twice, draining the distributor.

**Evidence expected:** This is reproducible with a mocked sender or local validator by pausing both processes after `load()` and before the first `save()`, or by killing a process after its first confirmed transfer.

**Fix:** Use `flock` in cron and an application-level exclusive lock for manual execution. Persist an immutable daily plan—including eligible asset list, per-vault amount, source balance, and run identifier—before sending transfers. Recovery must use that stored plan, not recalculate from remaining balance. Reconcile submitted signatures and destination balance deltas before retrying an ambiguous transfer.

---

### HIGH — Revenue “reconciliation” accepts any nonzero return and can report a failed swap as reconciled
**File / construct:** `bank/revenue.mjs`, `audit()` and return step; `bank/detectors.mjs`, `detectUnreconciledRevenue`

The ledger and alarm define success as `returnedSats` being truthy:

```js
if (!c.sweptLamports) continue
if (c.returnedSats) continue
```

There is no comparison between:
- swept SOL,
- Jupiter’s quoted `outAmount`,
- the actual swap transaction output,
- the pre/post cbBTC balance of the revenue ATA, or
- a minimum acceptable output.

Further, the returned amount is read as the entire operator ATA balance:

```js
const got = (await conn.getAccountInfo(opAta, 'confirmed')).data.readBigUInt64LE(64)
```

It is not the cbBTC delta attributable to this cycle.

**Concrete exploit / failure:** The operator receives 50 SOL. The swap fails, is front-run disastrously, or the operator key is used to retain the proceeds. The operator returns 1 sat, or has a pre-existing 1 sat/other cbBTC balance and returns it. The cycle gets `returnedSats = "1"`. `--audit` reports no open cycle, and `detectUnreconciledRevenue` is quiet despite essentially all swept value being absent.

This does not eliminate the explicitly accepted trusted swap hop. It defeats the claimed reconciliation and alarm around that hop.

**Evidence expected:** Create a ledger cycle with `sweptLamports: "50000000000"` and `returnedSats: "1"`. `revenue.mjs --audit` treats it as reconciled; `detectUnreconciledRevenue` returns no finding.

**Fix:** Record a pre-swap revenue-ATA balance and require an observed on-chain post-return delta. Store the quote, route, swap signature, return signature, and a minimum-output policy. Alert on returns materially below quote/minimum, not merely missing returns. Treat operator ATA balances as untrusted residual state; sweep only the attributable output or use a fresh cycle-specific token account.

---

### MEDIUM — Royalty configuration and governance-protected treasury rotation are unreachable with the intended governance PDA
**File / construct:** `programs/cbob-vault-mint/src/lib.rs`, `SetCollectionRoyalties.governance` and `UpdateWiring.governance`

MINT is configured to name the GOV program’s `["gov"]` PDA as `config.governance`. But these instructions require that address as a top-level `Signer`:

```rust
pub governance: Signer<'info>
```

A PDA has no private key and cannot be a transaction signer. It can sign only through `invoke_signed` from its owning program. The GOV program has one CPI path, `execute_proposal`, and that CPI only calls MINT `set_round`; it has no path to call `set_collection_royalties` or `update_wiring`.

**Impact:** Once `config.governance` is the intended GOV PDA:
- `set_collection_royalties` cannot be called;
- a treasury, bank-treasury, or split-bps change requested through `update_wiring` cannot be called.

This leaves the untested royalty path operationally dead and makes the claimed governance co-signature mechanism unavailable rather than protective.

**Evidence expected:** Initialize MINT with the GOV PDA as `governance`, then submit `set_collection_royalties` with that PDA supplied as the `Signer`. The transaction fails before the Core CPI because no signature can exist for the PDA. No existing GOV instruction can produce that signature for this MINT instruction.

**Fix:** Add explicit proposal/action types in GOV and CPI from GOV using `invoke_signed` to narrowly scoped MINT instructions. Do not replace this with an unchecked pubkey comparison.

---

### MEDIUM — `build-mainnet.sh` can continue after a failed build and checksum stale artifacts; it also tests only MINT
**File / construct:** `scripts/build-mainnet.sh`, build commands and `ask()`

The build uses:

```bash
CARGO_TARGET_DIR=/tmp/cbob-mn cargo-build-sbf --arch v3 2>&1 | grep -E "^error" -A5 && die ...
```

Because this pipeline is the left side of `&&`, `set -e` does not reliably make a failed `cargo-build-sbf` fatal. If Cargo fails without output matching `^error`, the script can continue and copy old `.so` files already present in `/tmp/cbob-mn`.

Also, `ask()` deploys only:

```bash
"$1/cbob_vault_mint.so"
```

So the claimed proof of `INIT_AUTHORITY` does not exercise SEAL, BURN, or GOV artifacts.

**Fix:** Build into a fresh directory and use explicit failure handling:

```bash
if ! cargo-build-sbf ... >"$log" 2>&1; then cat "$log"; exit 1; fi
```

Then deploy and test every produced program artifact, or at minimum independently prove every artifact hash and feature-dependent authority behavior.

---

## WHAT I TRIED AND COULD NOT BREAK

- I did not find a duplicate-vote route through transfer: `VoteRecord` is correctly seeded by `(proposal, asset)`, so transfer changes standing for future votes but cannot create a second record for the same asset/proposal.
- I did not find a delegate voting route: governance compares live Core owner bytes to a required signer; token delegates are irrelevant.
- MINT independently retains meaningful limits on a ratified `set_round`: nonzero cap, bounded window, and `minted_total < max_supply` at mint time. A governance proposal cannot directly evade the lifetime cap.
- `split_revenue` derives all three token-account addresses from config wallets and the supplied mint, and computes the holders amount first. The two transfer amounts sum exactly to the observed source amount; the division remainder goes to the Bank remainder only because the Bank is explicitly `total - holders`, not because of overflow or loss.
- I did not assert a Core royalties wire-format defect. The path is untested against real Core in the material provided, but I cannot responsibly name a bad byte without the actual SDK/Core layout or a validator failure.

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Enforce the SOL sweep cap **on-chain** in `sweep_sol_for_swap`. The present permissionless instruction can move the entire revenue balance above reserve in one transaction, making the advertised 50 SOL trusted-hop limit fictitious.