## FINDINGS

### HIGH — Jupiter response is still effectively a blank cheque on the swap-operator wallet
**File:** `bank/revenue.mjs`, Jupiter transaction validation immediately before `vtx.sign([operator])`

The checks do not establish that the returned transaction is a swap, nor that it spends only the intended SOL amount.

They check only:

- exactly one required signer, the operator;
- static account keys do not include the upgradeable loader or the CBOB MINT program;
- at most four address-table lookups.

That does not prevent a malicious/substituted Jupiter `/swap` response from containing:

- a `SystemProgram::Transfer` from the operator to an attacker;
- SPL `Transfer` / `Approve` / `SetAuthority` instructions affecting operator-held cbBTC or other tokens;
- malicious program IDs supplied through address lookup tables, which are not inspected at all;
- a legitimate-looking swap plus an extra transfer draining residual operator funds.

The operator is precisely the signer required for all of those actions. “One signer” proves only that the attacker does not need an additional signature.

**Concrete exploit:**  
An attacker able to alter the HTTPS/API response, compromise Jupiter infrastructure/DNS/proxying, or exploit a dependency serving the response waits until `sweep_sol_for_swap` sends up to `max_sweep_lamports` to the operator. They return a versioned transaction requiring only the operator signature. It includes an ordinary SOL transfer or SPL transfer to the attacker, optionally alongside a plausible Jupiter route. `revenue.mjs` signs and submits it. The on-chain sweep cap limits what reaches the operator per cycle, but does not protect funds once the script signs arbitrary operator-authorized instructions.

**Evidence that would prove this:** a test fixture containing a valid one-signer `VersionedTransaction` with a `SystemProgram::Transfer` to a test attacker, or an SPL transfer from the operator ATA, should currently pass the validation block and be signed.

**Fix:** Do not sign an opaque aggregator transaction under a wallet holding swept funds.

Minimum acceptable hardening:

1. Use a fresh, single-cycle operator wallet with no residual SOL or tokens beyond the exact sweep.
2. Decode **all compiled instructions**, including loaded address-table accounts.
3. Enforce an explicit instruction/account policy, including expected input/output mints, maximum input amount, permitted destination accounts, and no authority-changing instructions.
4. Simulate and independently verify expected pre/post token deltas before signing.
5. Persist `swapSig` immediately after `sendRawTransaction`, before confirmation.

The durable fix is a constrained swap executor or an on-chain DEX route. If this remains an off-chain trusted hop, it must be treated as trust in both the operator key **and the transaction constructor/API**, not merely the operator.

---

### HIGH — Daily distributions can still be sent into an irredeemable PDA after the “live asset” check
**File:** `bank/distribute.mjs`, payout loop, `stillThere` check before `sendAndConfirmTransaction`

The previous fix checks that the Core asset exists immediately before sending cbBTC to its asset-signer PDA:

```js
const stillThere = await conn.getAccountInfo(new PublicKey(v), 'confirmed')
...
const sig = await sendAndConfirmTransaction(...)
```

This is a TOCTOU check. A vault owner can bare-burn the Core asset after the RPC read and before the distributor’s transfer executes. Core permits that burn; the asset-signer PDA survives; SPL accepts the transfer into its ATA; no owner can later redeem the newly paid cbBTC because the asset is gone.

**Concrete exploit:**  
The owner of an activated vault waits for the predictable daily distribution. After the distributor reads `stillThere`, the owner submits a bare Core `BurnV1` for their vault, racing the transfer. If the burn lands first, the subsequent distribution transfer succeeds into the surviving asset-signer PDA. The owner has caused their allocated daily cbBTC to become unrecoverable. Repeating this across controlled activated vaults can blackhole a material portion of a day’s distribution.

This is not the rejected claim that Core burn sweeps the signer PDA. It does not. The surviving PDA is exactly why the subsequent payout succeeds and becomes stranded.

**Evidence that would prove this:** a validator test should construct: (1) an activated vault; (2) distributor’s final asset-existence read; (3) owner bare `BurnV1`; (4) distributor SPL transfer to the signer PDA ATA. The transfer should succeed after the burn, while no redemption path remains.

**Fix:** The current business rule—pay cbBTC into a PDA whose controlling Core asset can always be bare-burned—cannot provide a durable guarantee that a payout remains redeemable. The pre-send check only narrows timing; it cannot solve this.

Choose and document a different payout model before production, for example:

- distribute to the current Core asset owner’s ATA rather than the asset-signer PDA;
- maintain a claim ledger and let the current owner claim from a distributor-controlled account;
- hold distribution entitlement off-PDA until claimed, with explicit treatment of burned assets.

Any model paying directly into the asset-signer PDA must explicitly accept that a holder can permanently blackhole future distributions at any time.

---

### HIGH — MINT Bank rotations are not actually watched during their notice period
**Files:**  
- `bank/alarm.mjs`, `readConfigs()` MINT field list  
- `bank/detectors.mjs`, `detectStandingRisks()`

The code claims every armed rotation in all four programs is CRITICAL every pass. That is false for `mint.pending_bank`.

`detectStandingRisks()` checks:

```js
['mint.pending_bank', 'the Bank that co-signs every mint']
```

But `readConfigs()` never reads or writes `mint.pending_bank` or `mint.pending_bank_at` into `cfg`.

From `MintConfig`, after:

- `pending_admin` at offset 369,
- `pending_admin_at` at offset 401,

the omitted fields are:

- `pending_bank`: offset **409**, 32 bytes;
- `pending_bank_at`: offset **441**, `i64`.

Therefore an armed MINT Bank rotation is absent from both standing-risk alerts and config-drift comparison. The alarm notices only after `apply_pending_bank` changes `mint.bank`, eliminating the promised notice window.

**Concrete exploit:**  
A compromised MINT admin arms a replacement Bank key. The alarm remains quiet throughout the configured timelock because `mint.pending_bank` is `undefined` in the snapshot. Once the timelock expires, the attacker applies it and obtains the MINT Bank co-signing role before the first alert caused by `mint.bank` drift.

This does not directly let the replacement Bank rewrite MINT code, but it removes the Bank party from every future mint authorization and defeats the stated operational control during the exact period the timelock was intended to provide.

**Evidence that would prove this:** initialize a MINT config, call `update_wiring(bank: Some(new_key), ...)`, then run `readConfigs()` / `detectStandingRisks()`. No `mint.pending_bank` snapshot field or `rotation_armed` finding will appear.

**Fix:** Add both fields to the MINT config reader:

```js
['pending_bank', 409, 'pk'],
['pending_bank_at', 441, 'i64'],
```

Add `mint.pending_bank_at` to drift watching, and add an integration test that arms each of the four programs’ Bank/admin rotations and asserts the alarm snapshot and standing-risk detector report them.

---

### MEDIUM — Landed swap/return transactions can be omitted from the ledger on confirmation failure
**File:** `bank/revenue.mjs`, swap and return confirmation paths

`cycle.swapSig` is assigned before confirmation but is not persisted until after:

```js
cycle.swapSig = await conn.sendRawTransaction(...)
await conn.confirmTransaction(...)
save(led)
```

If the raw transaction lands but `confirmTransaction` throws or times out, the cycle remains in the ledger without `swapSig`. The same pattern exists for `returnSig` and `returnedSats`: a landed return followed by a confirmation failure leaves the ledger reporting an unreconciled cycle.

This is not a silent loss—the alarm should complain—but it blocks future cycles behind `cycleIsOpen` and leaves human recovery dependent on reconstructing the transaction history.

**Fix:** Save immediately after each signature is obtained, then confirm separately. Reconcile unresolved signatures on restart using `getSignatureStatuses` and transaction/account deltas before deciding whether a cycle is open.

---

## What I could not break

- `VoteRecord` is correctly seeded by proposal and asset. Transferring a vault after voting does not permit a second vote from the new owner.
- MINT’s `split_revenue` destination addresses are derived from `config.treasury` and `config.bank_treasury`, not caller-selected accounts. SPL Token’s own `TransferChecked` validation supplies the source/destination mint and authority checks.
- The governance execute path independently retains MINT’s round cap, bounded-window, and lifetime-supply checks. A ratified proposal cannot directly mint past `max_supply`.
- The `max(snapshot_supply, live_minted_total)` quorum divisor is actually used at execute; minting can no longer lower the quorum bar.
- The fixed `detectIndexShortfall` call sites pass arrays, not lengths, in the provided `alarm.mjs` and `reconcile()` paths.
- I did not find a second-vote, VoteRecord PDA reinitialization, or direct caller-controlled sweep destination path.

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Stop signing opaque Jupiter-provided transactions with the swap-operator key.** The current validator checks do not constrain what that signature authorizes. Use a transaction policy that fully decodes static and lookup-table instructions and enforces exact spend/destination behavior, preferably with a fresh single-cycle wallet or a constrained executor.