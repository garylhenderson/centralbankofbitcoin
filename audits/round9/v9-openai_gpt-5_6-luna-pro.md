## FINDINGS

### 1. HIGH — Jupiter transaction validation does not constrain loaded programs or value flows

**Construct:** `bank/revenue.mjs`, the validation block before `vtx.sign([operator])`.

The code checks:

- exactly one static signer;
- that signer is the operator;
- two forbidden static program IDs;
- no more than four address-table lookups.

This does **not** validate the instructions or the programs/accounts loaded through address lookup tables. A malicious or compromised Jupiter response can place an arbitrary program ID in a lookup table, then construct a transaction signed only by the operator that transfers the operator’s SOL or cbBTC elsewhere. The program will pass the current checks because the malicious program is not in `staticAccountKeys`.

**Concrete exploit:** compromise or substitute the Jupiter HTTP response. Return a versioned transaction with the operator as its only signer, an address lookup table containing an attacker-controlled transfer program, and an instruction that moves the swept SOL to the attacker. The transaction satisfies the current signer/static-key checks. The revenue script then waits for confirmation and fails later when the expected cbBTC output is absent. The on-chain sweep has already moved customer revenue to the operator, and the operator key holder can keep it.

Even without address tables, the validation does not establish that the transaction is a swap. It permits any unlisted program in the static message.

**Fix:** decode every compiled instruction, resolve address-table lookups, and enforce an explicit allowlist of program IDs and accounts. Validate the exact input account, input amount, output mint, output account, and minimum output. Prefer a dedicated swap wallet with no unrelated assets, but do not treat that as a substitute for transaction validation.

---

### 2. HIGH — The return “delta” is not cryptographically tied to the swap

**Construct:** `bank/revenue.mjs`, `opBefore` / `after` / `delta`.

The code records the operator ATA balance before the swap and treats any subsequent increase as the swap’s output:

```js
const delta = after > opBefore ? after - opBefore : 0n
```

That balance can be increased by any transfer to the operator ATA, not just by the Jupiter transaction. The later transfer sends the entire ATA balance and records only the delta as this cycle’s output. The alarm compares the ledger’s claimed return to the quote, not to the swap transaction’s actual token balance change.

**Concrete exploit:** after the script records `opBefore`, an operator or accomplice sends cbBTC to the operator ATA. The Jupiter transaction can produce no cbBTC or a short amount. If the injected amount makes `delta >= minOut`, the script accepts the cycle, transfers the injected tokens to the revenue PDA, and records a full successful return. A compromised operator can therefore manufacture a clean ledger and defeat the primary reconciliation mechanism. More importantly, the code has no proof that the returned amount came from the swap rather than an unrelated funding source.

**Fix:** reconcile the swap transaction itself: inspect its token balance deltas and require the expected output mint and recipient ATA to receive the amount. Record the exact post-swap balance associated with the confirmed swap transaction, not an arbitrary balance increase between two RPC reads. Do not send unrelated pre-existing ATA funds as part of the cycle.

---

### 3. HIGH — Revenue and distribution ledgers remain mutable trust roots

**Construct:** `bank/revenue.mjs`, `bank/distribute.mjs`, and `bank/alarm.mjs`.

The same host/user controls:

- the swap or distributor private key;
- the ledger files;
- the alarm state;
- the process that writes the ledgers.

The fixes detect some discrepancies from chain, but important distribution facts still originate in the local ledger. In particular, distribution rows with a signature are treated as paid without verifying that the signature actually transferred the recorded amount from the configured distributor ATA to the intended vault ATA.

**Concrete exploit:** a process compromise, local operator, or writable-file attack edits `distributions.json` to insert:

```json
{ "amount": "100000", "sig": "some-existing-signature" }
```

or records a legitimate unrelated signature. `paymentState()` returns `paid`; the next run permanently skips that vault. `detectDistribution()` checks only whether a signature exists, not whether the signature contains the expected transfer, source, destination, mint, and amount. A vault can therefore be omitted while the watcher reports a receipt.

The analogous revenue ledger checks sweep amounts against the sweep instruction, but return amounts and split claims are still ledger-derived except for the existence of a split signature.

**Fix:** make chain state authoritative. For every paid row, fetch and verify the transaction, token mint, source ATA, destination ATA, authority, amount, and success status. For returns, verify token balance deltas in the swap and return transactions. Treat local ledgers as caches/intents, not receipts. Use append-only or separately authenticated audit storage owned by a different principal.

---

### 4. MEDIUM — `distribute.mjs` can pay a stale daily plan to a vault that is no longer eligible

**Construct:** `bank/distribute.mjs`, the persisted `st.days[day].plan` and resume path.

The plan stores the activated asset list and amount once per day. On resume, it is reused without rechecking:

- that each asset is still a live Core asset;
- that it is still owned by the expected asset-signer PDA;
- that its cbBTC balance still meets the activation condition.

The normal loop checks that the Core asset still exists, but it does not re-read the reserve balance or verify the asset’s collection/owner before transferring. A vault can be transferred, drained, or otherwise changed after the plan is fixed and still receive that day’s allocation.

**Concrete exploit:** a vault is activated and included in the plan. Before its turn, the owner transfers the Core asset or drains its reserve. The script only checks that the account is still an AssetV1 (`data[0] === 1`), not that it remains in the configured collection or that the destination PDA corresponds to the current asset state. It can send the day’s payment to a stale or now-unredeemable destination.

**Fix:** immediately before each payment, verify the asset owner, collection, live status, and current activation balance. If the business requires a daily snapshot, persist and explicitly document the entitlement snapshot, but do not pay a destination that is no longer a valid vault.

---

### 5. MEDIUM — Governance has no cancellation or explicit rejection lifecycle, allowing proposal spam and stale-state pressure

**Construct:** `programs/cbob-vault-gov/src/lib.rs`; `create_proposal`, `cast_vote`, `execute_proposal`.

There is no proposal cancellation, rejection finalization, or cleanup path. Any current vault owner can create unlimited proposals, each requiring a rent-funded `Proposal` account and incrementing `proposal_count`. Proposals can remain open for up to 30 days, and passed proposals remain executable for another seven days.

This is not a direct unauthorized mint, but it creates a persistent governance-state and operational burden. The monotonic execution rule does not prevent a large backlog of proposals or a proposer from filling the governance surface with economically meaningless proposals.

**Concrete exploit:** one owner repeatedly creates proposals with valid windows and caps, paying only account rent. Operators must inspect and alarm on every proposal, and proposal IDs grow without a bounded lifecycle. If proposal creation is expected to be open to every vault, this is an unpriced governance DoS vector.

**Fix:** add a proposal creation fee or per-proposer rate limit, and add explicit `cancel_proposal` / `expire_proposal` state transitions. Permit reclamation of rent only after expiry or cancellation, while preserving executed-history identifiers.

---

## What I tried and could not break

- I could not derive a duplicate vote from transferring a vault: the `VoteRecord` PDA is seeded by proposal and asset.
- I could not vote with a burned Core asset through `cast_vote`: the live AssetV1 read fails.
- I could not bypass the lifetime supply cap through successive rounds: `minted_total < max_supply` is checked independently in `mint_vault`.
- I could not make governance execute twice: `executed` and `last_executed_id` are both checked.
- I could not lower the tally rule retroactively: quorum and threshold are copied into the proposal.
- I could not redirect `split_revenue` destinations through its account arguments: the revenue PDA and all three ATA derivations are checked, and the classic SPL token program is constrained.
- I could not bypass the sweep amount/cooldown in one transaction: both are stored and enforced on-chain, and zero amounts are refused.
- I could not make a malformed or partial DAS response silently pass when its unique live-plus-burnt count disagrees with `minted_total`.
- I could not confirm the Royalties CPI encoding from the supplied source alone. That path needs a real Core add/update test against the deployed Core version; the source’s comments are not evidence of correct wire bytes.

## THE SINGLE THING to fix before this holds real money

Replace the Jupiter “signer/static-key” check with complete transaction and value-flow validation, including resolved address-table instructions and transaction-level proof that the swept SOL was exchanged for the reported cbBTC and returned to the revenue PDA.