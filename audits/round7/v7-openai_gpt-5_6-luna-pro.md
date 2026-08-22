## FINDINGS

### HIGH — `sweep_sol_for_swap` can be permanently rate-limited by zero-value calls

**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `sweep_sol_for_swap`.

The instruction permits `amount == 0`. It still checks the cooldown and then writes:

```rust
c.last_sweep_at = now;
```

Because the instruction is permissionless, any account can repeatedly submit a zero-lamport sweep and reset `last_sweep_at`. With a one-hour cooldown, an attacker can front-run each legitimate sweep with a zero-value transaction and keep the revenue PDA from being swept indefinitely. The attacker pays only transaction fees.

**Exploit:** Submit:

```text
sweep_sol_for_swap(amount = 0)
```

with the correct revenue PDA and any `swap_operator` account matching config. Repeat immediately after each cooldown interval.

**Impact:** Revenue cannot reach the swap operator, so SOL accumulates and the revenue cycle stalls. This is an on-chain denial of service that bypasses the Bank lock and all off-chain controls.

**Fix:** Require `amount > 0`. Also consider requiring `amount >= configured minimum` and making `last_sweep_at` advance only after a positive transfer.

---

### HIGH — Failed distribution attempts are permanently marked paid

**Construct:** `bank/distribute.mjs`, distribution loop.

Before sending, the script writes:

```js
done[v] = { amount: String(plan.per), sig: null, sentAt: ... }
```

If the transfer fails, it replaces that entry with:

```js
done[v] = { amount: String(plan.per), sig: null, error: ... }
```

On every later run:

```js
if (done[v]) continue
```

The failed entry is therefore treated as complete forever. A transient RPC error, temporary destination issue, blockhash failure, or temporary token-account state causes that vault to receive nothing for the entire day, with no retry path. This contradicts the stated “resume” behavior.

**Exploit:** Cause or induce one transfer to fail—for example, make the destination temporarily frozen or make the RPC fail during that vault’s transaction. The ledger records a truthy failed object. Every subsequent invocation skips that vault.

**Impact:** Activated customers can permanently miss that day’s payment. The error is logged, but a later run cannot repair it.

**Fix:** Distinguish `intent`, `confirmed`, and `failed`. Do not skip `failed` entries. For an ambiguous `intent`, reconcile the chain before retrying; for a known pre-send failure, retry automatically. Only a confirmed signature should suppress future payment.

---

### HIGH — Distribution does not reject an index containing extra assets

**Constructs:** `bank/distribute.mjs` and `bank/detectors.mjs`, `detectIndexShortfall`.

The distribution job rejects:

```js
live.length + burnt.length < mintedTotal
```

but accepts a collection index containing *more* assets than `minted_total`. It then treats every live asset in that collection as a vault and includes any activated one in the divisor and payment set.

`detectIndexShortfall` has the same one-sided comparison:

```js
if (seen < total) ...
```

There is no `seen > total` finding.

**Exploit:** If an unintended asset is placed into the collection—through a collection/plugin authority compromise, a faulty upgrade, or an indexer response containing foreign assets—and its asset-signer PDA has at least 21,000 cbBTC, it is included in `allocate()`. It receives a distribution share and changes the amount paid to every legitimate vault.

**Impact:** Customer distributions are diluted and funds can be sent to an asset that is not represented by MINT’s supply accounting.

**Fix:** Require exact equality:

```text
live + burnt == minted_total
```

and separately validate every indexed asset’s Core structure, collection, and expected provenance. Abort distribution on either surplus or shortfall.

---

### MEDIUM — Governance quorum rounds down to zero at low supply

**Construct:** `programs/cbob-vault-gov/src/lib.rs`, `execute_proposal`.

The required quorum is computed as:

```rust
let need = (p.quorum_supply as u128)
    * (ctx.accounts.config.quorum_bps as u128)
    / 10_000u128;
```

This floors the result. For example, with `quorum_supply = 1` and `quorum_bps = 1_000` (10%), `need == 0`. The code separately requires `cast > 0`, so one vote is enough to satisfy the nominal 10% quorum. More generally, the effective quorum is lower than configured whenever the product is not divisible by 10,000.

**Exploit:** At low supply, create a proposal, cast one YES vote with the only existing vault, wait for the voting period, and execute it. The proposal passes despite not reaching the configured percentage quorum.

**Impact:** Early governance can be captured by a single vault even when configuration says a meaningful fraction of supply must participate. This is particularly relevant during charter/early-launch periods.

**Fix:** Use ceiling arithmetic:

```rust
let need = supply
    .checked_mul(quorum_bps)?
    .checked_add(9_999)?
    / 10_000;
```

Also explicitly define whether a quorum of one vote is acceptable when the computed percentage is below one whole vault.

---

### MEDIUM — Swap accounting returns the operator’s entire cbBTC balance, not this cycle’s output

**Construct:** `bank/revenue.mjs`.

After Jupiter confirms, the script reads:

```js
const got = (await conn.getAccountInfo(opAta, 'confirmed'))
  .data.readBigUInt64LE(64)
```

It does not record the operator ATA balance before the swap and subtract it afterward. It then transfers `got`—the entire balance—to the revenue ATA and records all of it as this cycle’s return.

**Exploit:** Have the operator ATA contain cbBTC before the cycle, either from an earlier unresolved cycle, an unrelated operational transfer, or an unsolicited transfer. The next run attributes and returns all existing cbBTC as the current swap output.

**Impact:** Cycles become financially misattributed; unrelated operator funds can be swept into the project distribution, and the ledger can report a return larger than the Jupiter quote. More importantly, if an earlier cycle’s output remains in the ATA, a later cycle can falsely appear reconciled while the original accounting is unresolved.

**Fix:** Use a dedicated per-cycle destination, or record the pre-swap token balance and return only the post-swap delta. Enforce that the returned amount is tied to the fresh quote and reject unexpected pre-existing balances.

---

### MEDIUM — `readConfigs()` does not validate account owner, discriminator, or layout version

**Construct:** `bank/alarm.mjs`, `readConfigs()`.

The on-chain programs validate sibling configuration accounts using PDA, owner, discriminator, and version. The alarm only derives the PDA, fetches bytes, and reads fixed offsets. It does not verify:

- account owner;
- Anchor discriminator;
- config version;
- expected data length.

It reports the version byte as a watched field, but that does not prevent misparsing a wrong account or malformed layout before the comparison.

**Exploit:** A failed deployment, closed/reinitialized account, incompatible upgrade, or malformed RPC response that still returns enough bytes can be interpreted as configuration. The alarm may produce misleading values or fail to detect the actual state. On a first run, there is no prior baseline, so drift comparison is absent.

**Impact:** The off-chain control that is supposed to detect wiring and upgrade drift can operate on untrusted bytes and potentially report a clean or actionable result for the wrong state.

**Fix:** Mirror the programs’ validation: verify the expected owner, exact discriminator, supported version, and minimum/expected account length before parsing. Treat any mismatch as a critical unreadable-config failure. Do not establish a baseline from invalid bytes.

---

### MEDIUM — Swap operator compromise remains a recurring fund-drain path

**Constructs:** `sweep_sol_for_swap` and `bank/revenue.mjs`.

The swap operator key is the destination of every sweep and controls the SOL after transfer. The on-chain cap limits each sweep, but a compromised operator can submit one permitted sweep every cooldown period, send the SOL anywhere, and never return cbBTC. The operator also controls any cbBTC already present in its ATA.

**Exploit:** Compromise the key, submit valid sweeps at each allowed interval, and omit the swap/return. The alarm eventually detects the missing return, but detection is after funds have left the revenue PDA.

**Impact:** Repeated loss of project SOL up to the configured per-cycle cap and available balance, subject only to the cooldown and reserve. This is larger than a single transaction and is not prevented by the Bank co-signature model.

**Fix:** Use a multisig or constrained execution authority for the swap hop, or perform the swap through a verified DEX CPI. At minimum, configure a short-lived operational key with an independently enforced cumulative daily limit, not merely a per-sweep limit, and require explicit reconciliation before the next sweep.

---

## What I tried and could not break

- The governance vote PDA is correctly bound to `(proposal, asset)`, so transferring a vault does not create a second vote.
- `cast_vote` reads the current Core owner and requires that owner’s signature; a delegate, collection account, or stale owner cannot vote.
- A burned asset cannot be presented as a live Core asset to cast a new vote.
- `execute_proposal` marks execution before CPI, but Solana atomicity rolls that state back if `set_round` fails; I found no execute-twice path.
- MINT independently enforces the lifetime supply cap, positive per-round cap, and maximum round duration. Governance cannot bypass those through `set_round`.
- `split_revenue` pins the revenue account, both destination ATAs, the mint-derived ATA addresses, and the classic SPL Token program. Its bank share is floored and the holder share is the exact remainder; the two transfers sum to the observed source balance.
- The sweep destination is read from config rather than supplied by the caller, and positive sweeps cannot breach the configured reserve.
- The alarm’s per-program cursors, pagination, unreadable-transaction handling, and state locking address the previously identified cursor and concurrent-run failures.
- The distribution plan is durably fixed before the first transfer, and its lock prevents the previously identified concurrent ledger overwrite.
- I cannot claim the Royalties byte encoding is wrong from this source alone. The exact Core wire format and `AddPluginV1`/`UpdatePluginV1` behavior require an actual live-Core test; the supplied suite’s prior success does not establish this newly claimed path because the prompt states it has not been tested.

## THE SINGLE THING to fix before this holds real money

Fix the off-chain payout and revenue state machines—especially failed-distribution retry handling and exact swap-balance accounting—then add live failure-injection tests. These are the paths that can silently lose or misdirect real customer funds even when every on-chain assertion passes.