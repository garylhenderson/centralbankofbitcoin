## FINDINGS

### HIGH — Revenue reconciliation can be forged with an old unrelated split signature

**Files:** `bank/detectors.mjs`, `cycleIsOpen`, `detectUnreconciledRevenue`, `detectSplitClaims`; `bank/alarm.mjs`, `seenSplits` handling.

A ledger cycle is considered closed solely if it has nonzero `returnedSats` and any `splitSig`:

```js
return BigInt(c?.returnedSats ?? 0) === 0n || !c?.splitSig
```

`detectSplitClaims` then only establishes that the claimed signature exists somewhere in the MINT transaction history:

```js
if (!seen.has(c.splitSig)) { ... }
```

It does **not** establish that:

1. this split occurred after this cycle’s sweep;
2. this split belongs to this cycle rather than an earlier one;
3. the split moved the claimed amount;
4. cbBTC was actually returned to the revenue ATA;
5. a split signature is used by only one ledger cycle.

`seenSplits` is retained across passes without a cycle binding:

```js
seenSplits: [...new Set([...seenSplits, ...(prev?.seenSplits || [])])]
```

#### Concrete exploit

The swap operator, or anyone who can alter the revenue ledger on the operator host:

1. makes or obtains one legitimate historical `split_revenue` transaction signature, `S`;
2. calls on-chain `sweep_sol_for_swap`, receiving up to the on-chain capped SOL;
3. does not return cbBTC;
4. writes a ledger row claiming arbitrary nonzero `returnedSats`, `splitSig: S`, and optionally `quotedSats: "0"` to avoid the quote-floor check.

On the next alarm pass:

- `cycleIsOpen` returns false because `returnedSats != 0` and `splitSig` exists;
- `detectUnreconciledRevenue` does not report an unreconciled swap;
- `detectSplitClaims` accepts `S` because a split with that signature was observed at some point.

The operator is already a trusted hop for conversion, but the stated compensating control is bounded, ledgered, and reconciled. This permits that trusted actor to suppress the reconciliation alarm and reuse one historical chain fact to “close” arbitrarily many false ledger cycles.

**Evidence that should exist in a test:** create two synthetic cycles, give the second cycle the first cycle’s valid `splitSig`, claim a positive return for the second, and verify that the current detector incorrectly produces no finding. The selftest currently tests only “claimed signature seen” versus “not seen”; it does not test signature reuse, ordering, or amount/cycle binding.

**Fix:**

- Parse `RevenueSplit` Anchor events or the two SPL transfer instructions and record the actual split amount and mint from chain.
- Require each `splitSig` to be unique across ledger cycles.
- Require split transaction block time/slot to be after that cycle’s sweep and return.
- Verify `returnSig` on chain: it must contain a cbBTC transfer from the operator ATA to the revenue ATA, with the claimed amount or a chain-derived amount.
- Do not treat operator-written `returnedSats` as evidence of return.
- Add tests for reused historical signatures, signature from before sweep, wrong mint, wrong amount, and a claimed return with no chain transfer.

---

### HIGH — Jupiter transaction inspection ignores address-lookup-table accounts and does not constrain token/system transfers

**File:** `bank/revenue.mjs`, post-quote `VersionedTransaction` validation.

The code examines only static message keys:

```js
const keys = msg.staticAccountKeys.map(k => k.toBase58())
const bad = keys.filter(k => FORBIDDEN.includes(k))
if (bad.length) throw ...
if (msg.addressTableLookups?.length > 4) throw ...
```

A versioned Solana transaction can load accounts, including program IDs and transfer destinations, through address lookup tables. Counting lookup tables is not inspection of their contents. A malicious response can place value-moving program IDs and recipient accounts in a lookup table, so they never appear in `staticAccountKeys`.

Even without the lookup-table bypass, the filter only forbids the upgradeable loader and MINT. It does not decode or constrain instructions to prevent:

- `SystemProgram.transfer` from the operator to an attacker;
- classic SPL `Transfer` / `TransferChecked` from the operator’s cbBTC ATA to an attacker;
- arbitrary instructions to an attacker-controlled program that consume the operator signature.

The “one signer” condition does not protect against this. A single required signer is exactly what a theft transaction from the operator wallet needs.

#### Concrete exploit

A compromised Jupiter API, DNS/TLS interception point, compromised quote endpoint, or compromised upstream route builder returns a versioned transaction that:

1. requires only the swap operator signature;
2. loads System Program, SPL Token Program, the operator ATA, and attacker destination through an ALT;
3. transfers the operator’s SOL and/or cbBTC to the attacker;
4. optionally includes plausible swap-looking instructions.

The current validation sees one signer, sees no forbidden static program key, and at most sees an acceptable number of ALTs. It signs.

The direct sweep is capped, but the operator wallet can contain the current sweep, fee funds, and cbBTC/leftovers. The script itself deliberately transfers the entire operator cbBTC ATA balance on return, acknowledging that leftovers can exist. This makes the blast radius larger than one quoted swap.

**Evidence that should exist in a test:** construct a V0 transaction with an ALT containing System Program plus an attacker destination and a system transfer from the operator. The current check should accept it. A second test should use a static SPL Token Program transfer to show that the existing forbidden-program list does not prevent direct token theft even without an ALT.

**Fix:**

- Resolve all address lookup tables before validation and inspect the complete loaded key set and compiled instructions.
- Do not use a “forbidden program” blocklist as authorization. Decode every instruction and use a strict allowlist of expected Jupiter route programs plus permitted instruction forms and accounts.
- Constrain transfers involving operator-owned accounts to expected temporary route accounts and the expected revenue ATA.
- Better: use a fresh per-cycle operator key funded only with the intended sweep plus fee budget, and sweep residuals immediately. This limits an upstream transaction-substitution failure even if route validation is incomplete.
- Treat the Jupiter response as an untrusted transaction proposal, not as a signed route description.

---

## What I tried and could not break

- I could not identify a caller-controlled destination in `split_revenue`: all three token-account addresses are derived as classic-SPL ATAs from the revenue PDA, `config.treasury`, and `config.bank_treasury`. The SPL CPI then independently requires a valid source/mint relationship.
- I did not find a double-vote route by transfer: `VoteRecord` is seeded by proposal and asset, not wallet.
- I did not find an execute-twice or stale-proposal route: `executed`, execution expiry, `closes_at > now`, and `last_executed_id` collectively close the obvious paths.
- I did not treat the known inability to enumerate PDA-owned token accounts on chain, or bare Core burns, as new findings. Those are structural limits; the defects above are in the advertised off-chain compensating controls.

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Fix the revenue reconciliation so a cycle is closed only by **chain-derived, uniquely bound evidence** of its own cbBTC return and its own subsequent split. Right now the operator-controlled ledger can reuse one old split signature to hide a missing return.