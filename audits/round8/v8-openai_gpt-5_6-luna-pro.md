## FINDINGS

### 1. CRITICAL — Distribution is wired to an impossible treasury

**Constructs:** `mint_vault`, `split_revenue` in `programs/cbob-vault-mint/src/lib.rs`; `main` in `bank/distribute.mjs`.

`mint_vault` requires the supplied treasury to equal the MINT program’s revenue PDA:

```rust
require_keys_eq!(ctx.accounts.treasury.key(), revenue, MintError::WrongTreasury);
```

But `split_revenue` sends the holders’ share to the ATA derived from `cfg.treasury`:

```rust
let holders_ata = ATA(config.treasury)
```

`distribute.mjs` assumes the holders’ share is in the distributor key’s ATA and rejects unless:

```js
if (!treasury.equals(distributor.publicKey)) throw ...
```

In the stated production wiring, `config.treasury == revenue PDA`, which is off-curve and cannot equal the distributor keypair. Therefore:

1. Mint proceeds arrive at the revenue PDA.
2. `split_revenue` sends 85% to `ATA(revenue PDA)`.
3. `distribute.mjs` reads `ATA(distributor key)`, finds no funds, or fails its equality check before that.
4. Customer distributions never run successfully.

This is a direct contradiction between the on-chain destination and the payout source.

**Fix:** Separate immutable income collection from the holder-distribution treasury. Add an explicitly named `distributor_treasury` field, constrain `split_revenue` to its ATA, and have `distribute.mjs` verify and use that same on-chain address. Do not overload `treasury` with two meanings.

---

### 2. HIGH — The revenue script blindly signs a Jupiter-provided transaction

**Construct:** `bank/revenue.mjs`, the `VersionedTransaction.deserialize`, `vtx.sign([operator])` path.

The script obtains a serialized transaction from the Jupiter HTTP response and signs it without validating its instructions, writable accounts, programs, or token amounts:

```js
const vtx = VersionedTransaction.deserialize(Buffer.from(sw.swapTransaction, 'base64'))
vtx.sign([operator])
```

A compromised, spoofed, or maliciously altered swap response can request arbitrary transactions signed by the operator. The operator wallet receives swept SOL and holds cbBTC returned from previous swaps, so the signed transaction can potentially transfer those assets elsewhere, invoke unexpected programs, or drain the operator wallet.

Concrete attack:

1. Attacker compromises or substitutes the quote/swap response.
2. The script has already swept SOL to the operator.
3. The returned transaction includes a transfer of the operator’s SOL/cbBTC to an attacker-controlled account.
4. The operator signs it automatically.

**Fix:** Use a dedicated wallet containing no assets other than the current cycle’s funds, and strictly decode and validate every instruction before signing. Require the transaction to contain only the expected Jupiter route plus permitted wrapping/ATA operations, with exact source, destination, mint, and amount constraints. Prefer a vetted Jupiter SDK/client and reject unexpected programs/accounts.

---

### 3. HIGH — Returned amount is measured as the operator’s entire cbBTC balance

**Construct:** `bank/revenue.mjs`:

```js
const got = (await conn.getAccountInfo(opAta, 'confirmed')).data.readBigUInt64LE(64)
...
createTransferCheckedInstruction(opAta, CBBTC, revAta, operator.publicKey, got, 8)
cycle.returnedSats = String(got)
```

The script does not measure the balance increase caused by the current swap. It transfers and credits **the entire operator ATA balance** as this cycle’s return.

Concrete cases:

- The operator ATA contains cbBTC from an earlier unresolved cycle.
- Somebody sends cbBTC to the operator ATA.
- A malicious swap returns only a small amount while the ATA already contains a large balance.

The script reports the combined balance as the current swap return, allowing a bad or missing swap to appear reconciled. It also mixes unrelated funds into the project distribution.

**Fix:** Record the operator ATA balance before the swap, then measure the post-swap delta. Return only the delta, and reject unexpected pre-existing balances or require the dedicated operator wallet/ATA to be empty before each cycle. Reconcile the actual on-chain transfer amount, not a locally observed aggregate balance.

---

### 4. HIGH — Post-sweep quote omits the missing price-impact check

**Construct:** `bank/revenue.mjs`, second Jupiter quote:

```js
const impact2 = Math.abs(Number(q2.priceImpactPct ?? 0))
if (!Number.isFinite(impact2) || impact2 > MAX_PRICE_IMPACT_PCT) ...
```

The initial quote correctly rejects a missing `priceImpactPct`. The post-sweep quote instead converts a missing field to zero. Once the first quote has been accepted, SOL has already moved irreversibly to the operator. A malformed or incomplete second quote therefore passes the impact guard and is used to construct the signed swap transaction.

**Fix:** Reject `undefined` and `null` exactly as for the first quote. Also validate `outAmount`, input amount, output mint, and route metadata on both quotes.

---

### 5. HIGH — Governance quorum can mathematically become zero

**Construct:** `execute_proposal` in `programs/cbob-vault-gov/src/lib.rs`:

```rust
let need = (p.quorum_supply as u128)
    .checked_mul(p.quorum_bps as u128)? / 10_000u128;
```

The configuration permits any positive `quorum_bps`, including `1`. Integer flooring means a proposal can require zero votes for quorum whenever:

```text
quorum_supply * quorum_bps < 10,000
```

Even with larger supply, a low quorum can floor to zero. `cast > 0` then becomes the only effective requirement. A single vault owner can create a proposal, cast one YES vote, and satisfy quorum if the YES threshold is met.

**Fix:** Use ceiling division:

```rust
need = (supply * quorum_bps + 9_999) / 10_000
```

Also explicitly require `need > 0`, or enforce a minimum quorum compatible with the intended holder population.

---

### 6. MEDIUM — The alarm’s external sweep reconciliation is forgeable through the ledger

**Constructs:** `detectUnledgeredSweeps` in `bank/detectors.mjs`; ledger handling in `bank/alarm.mjs`.

The detector treats a sweep as reconciled if its transaction signature appears in the local JSON ledger:

```js
const known = new Set((ledger?.cycles || []).map(c => c.sweepSig).filter(Boolean))
if (signature && known.has(signature)) continue
```

The ledger is not authenticated and is written by the same host/process that holds the operator key. A local compromise can:

1. Sweep SOL using the stolen operator key.
2. Add the real signature to the ledger.
3. Add a fabricated return amount and quote.
4. Cause the alarm to report no unledgered sweep and no unreconciled cycle.

This defeats the stated independent check precisely when the operator host is compromised.

**Fix:** Treat the ledger as bookkeeping only. Derive sweeps and returns from chain data, verify the sweep instruction/event and destination, verify the cbBTC transfer into the revenue ATA, and reconcile amounts from independently fetched transactions. Store an append-only, externally authenticated audit record as an additional control.

---

### 7. MEDIUM — The deadman cron ignores configured alarm state paths

**Construct:** `scripts/cron-install.sh`:

```sh
[ ! -f $R/bank/state.json ] || [ -n "$(find $R/bank/state.json -mmin +120 ...)" ]
```

`alarm.mjs` supports:

```js
CBOB_ALARM_STATE
```

but the installed deadman job always checks `/opt/cbob-vaults/bank/state.json`. A deployment using a configured alternate state file can have a healthy alarm while the deadman continually reports it missing, or can delete the actual configured state while the deadman checks an unrelated stale file.

**Fix:** Install the resolved state path into the cron command, or make the deadman invoke a small checker that uses the same configuration source as `alarm.mjs`. Also quote the path.

---

### 8. MEDIUM — Distribution can pay a vault after it has been burned

**Construct:** `bank/distribute.mjs`, fixed daily `plan`.

The plan snapshots activated vault IDs and then pays them later. It does not revalidate that each asset remains live immediately before payment. A vault can be bare-burned after the plan is written but before its turn in the loop. The PDA token account may still exist, so the transfer can succeed to an orphaned asset-signer PDA. The customer cannot redeem it, and the payment is no longer economically attributable to a live vault.

**Fix:** Before each transfer, confirm the asset is still live in the collection and that its current owner/asset account remains valid. If the collection index is stale, stop rather than pay the stale plan.

## What I tried and could not break

- I did not re-report the prior proposal-PDA prefunding claim; the supplied validator measurement disproves it.
- I did not claim that live minting necessarily invalidates proposals; the divisor and tally-rule snapshots address that liveness issue.
- I did not claim Core BurnV1 can be prevented while resale remains enabled.
- I did not claim the Core CPI or Borsh mint path is universally broken; the supplied real-Core suite contradicts that.
- I did not claim the SEAL reserve checks can enumerate arbitrary PDA-owned accounts; that limitation is real and must remain off-chain.
- I did not find a caller-controlled destination in `split_revenue`: the destination ATAs are PDA-derived from configuration. The unresolved problem there is the incorrect treasury/distributor wiring, not arbitrary redirection.

## THE SINGLE THING to fix before this holds real money

**Fix the treasury/distribution wiring first.** In the current production configuration, the on-chain split sends holders’ funds to the revenue PDA while the payout process requires them in a distributor key’s ATA. Until those addresses and responsibilities are separated and made consistent on-chain and off-chain, customer distributions cannot reliably occur.