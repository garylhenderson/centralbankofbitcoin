## R0 — round 37 verdict and repairs

I checked the current tree against the round-37 dispositions:

- **C01** ack arms now use `unredeemable_owner` plus a true/empty-reason/kind-scoping arm; no regression found.
- **C02** the frozen-pool tick is planned, but see **Finding 1**: the join after the tick is not actually sent in that pass.
- **C03** `judgeCronTemplate` now computes `varHasN` from live lines only.
- **C04** `audit()` no longer counts a refused sweep as swept SOL.
- **C07** the contradictory `{sendRejected, sweepSig}` row still pages `rejected_row_has_sweep`.

No confirmed round-37 finding appears to have regressed.

---

## Findings

### Finding 1 — MEDIUM — the revenue swap can be bricked by a stranger-created wSOL token account whose close authority is the stranger

**Target:** R5(g), `bank/swap.mjs` / `bank/revenue.mjs`.

`swapInstructions` wraps into the **derived ATA** of the swap operator:

```js
const ownerWsol = ata(WSOL, owner)
```

and then always closes that same account:

```js
closeAccount = (acct, dest, owner) => new TransactionInstruction({
  programId: TOKEN,
  data: Buffer.from([9]),
  keys: [{ pubkey: acct, ... }, { pubkey: dest, ... }, { pubkey: owner, isSigner: true, ... }],
})
```

`createAtaIdempotent` does not repair an existing token account; the judge checks only addresses, signers, program IDs, and instruction data. Neither reads the wSOL account’s on-chain **close authority**.

After `swap_operator` is public on chain, anyone can:

1. find the canonical ATA address for `wSOL` owned by the operator,
2. create a classic SPL token account at that address with `owner = operator`, `mint = wSOL`, and `close_authority = attacker`,
3. leave it in place.

The attacker can create such an account without the operator’s signature. When the next revenue cycle runs, the wrap and pool swap succeed, but the final `CloseAccount` is signed by the owner; the token program rejects it because the stored close authority is the attacker. The Orca transaction fails; the Meteora fallback uses the same account and fails the same way. The cycle has already swept royalty SOL and is now open.

This does not steal funds, but it converts a public, cheap transaction into a persistent automatic-revenue stoppage until hand recovery. Because the attacker keeps the close authority, the operator cannot simply close/recreate the canonical account.

**Evidence if true:** the wSOL ATA of `bipP7uK5aQDsrChYA8hpZ1Thb8BCw7emRGuEkLkHg6G` would show owner = operator and a non-owner close authority; simulation of `swapInstructions` would fail at `CloseAccount`; revenue would try Orca then Meteora and end with an open cycle.

**Fix:** do not use the publicly derivable operator wSOL ATA as the swap account. Use a swap-specific token account created in the transaction or from a dedicated keypair whose close authority is the operator and whose address is not publicly derivable. The judge should either pin that account’s creation/authority or reject any wSOL token account that was not created in the same transaction.

---

### Finding 2 — LOW — round-37 C02 repair plans the frozen-pool tick join but does not send it

**Target:** R1, `bank/crank.mjs`; round-37 C02.

In `planCrank`, the frozen-pool tick branch now correctly plans:

```js
else if (joinable && poolOk && due && w === 0n && waitingThisEpoch) {
  plan.distribute = true
  plan.distributeKind = 'tick'
}
```

and it populates:

```js
plan.joins.push([r.address, dest])
```

for current-epoch requesters.

But `main()` never sends `plan.joins` directly. It sends only `plan.claims`, and `plan.claims` is created inside:

```js
if (poolOk && !pool.frozen) {
  ...
  ready.push(...plan.joins)
  ...
}
```

With a frozen pool this whole block is skipped, so `plan.claims` is empty while `plan.joins` is non-empty. The vaults whose requests become eligible because of the frozen-pool tick are therefore not joined in the same pass. They will become `preJoins` on the next full pass and be joined then, so this is a delay, not a permanent block.

The selftest arm for C02 asserts `p.joins.length`, not `p.claims.length`, so it does not catch the fact that these joins are not sent.

**Effect:** after a frozen-pool monthly tick, eligible requesters wait up to one full-crank interval before being joined. If the pool thaws before that next pass, any distribution is refused `JoinWaitingFirst` until the next join pass runs.

**Fix:** in the frozen-pool tick case, emit join-only claim batches even when `pool.frozen` is true. Keep payable claims suppressed, but pending joins should be sent separately.

---

### Finding 3 — LOW — a null payment-mint decimal skips the split but leaves the distribution plan running

**Target:** R1, `bank/crank.mjs`.

`planCrank` plans a distribution using `splitToPool` from revenue that will be split this pass. In `main()`:

```js
if (plan.split && payDecimals === null) failures.push('split_revenue NOT sent ...')
else if (plan.split) await run('split_revenue ...')
...
if (plan.distribute) { ... send distribute ... }
```

If `payDecimals` is null, the split is skipped but `plan.distribute` is not re-planned. If the distribution was only payable because of the prospective split, the crank sends a `distribute` that the program refuses `NothingToDistribute`. The refusal is judged as an action failure, causing a false failure page.

**Effect:** a rare payment-mint read failure can waste one fee and page a wrong “action failed”.

**Fix:** when `payDecimals === null`, rebuild the plan with `revenue = null`/`split = false` before sending, or suppress `plan.distribute` if it depended on the split.

---

## Accepted limits — the four questions

### 1. Is any limit worse than stated?

Yes — **limit 10’s operational assumption is worse than stated in one concrete way**. The text says the operator wallet must hold nothing but cycle funds and that this is not on-chain enforced. The accepted framing is that the *operator* can fail or steal. But **Finding 1** shows a stranger can create a token account whose owner is the operator but whose close authority is the stranger, without controlling the operator key. This is not just an operational instruction; it is a public one-fee DoS on the automatic royalty swap and persists until manual recovery.

### 2. Is anything listed as a limit not actually a limit?

I found no accepted item that is already completely closed by code. Some of them are narrower than the text suggests once later repairs are considered, but none of the accepted items appears to describe a threat that no longer exists.

### 3. Is any DISCHARGED item not actually discharged?

The discharged items I could verify (`51`, `54`, `12/17`, `30`, `31`, `33`, the v5 Bank/deck/distributor items) are discharged in the sense claimed: the old mechanism is gone or measured. One loose end is `51`’s phrase “until the Bank releases some”; v6 has no Bank, and no release job is in the bundled tree. That does not contradict the boost mechanism being built, but if the project treats that sentence as a built release path, it is not present here.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

No. Items **22**, **38**, **50**, **52**, and **53** remain in the OPEN AND BLOCKING section of `SPEC.md`. The bundled validation also keeps them open. The tree does not demote them.

---

## Final section — what AI audit structurally cannot do before launch

Concrete steps, not assurances:

1. **A human must build and inspect the actual four `initialize` transactions from `launch/mainnet-init.json`.** The current checker validates the JSON, not the signed transaction. Have Gary or a separate operator sign on an air-gapped machine, then parse and print every `initialize` argument in plain English before broadcast.

2. **A human must run the revenue cycle with a deliberately hostile account shape.** Exercise Finding 1 specifically: pre-create the operator’s canonical wSOL ATA with a stranger close authority, verify the swap fails, verify the alarm pages, and verify hand recovery restores the address or switches it off.

3. **A human must run the dress rehearsal at the release commit, not only the suite.** Re-run `scripts/rehearsal-tree.sh` at the final commit, run `run-tests.sh` inside it, and record `REHEARSAL-RECORD.txt`.

4. **A second set of eyes must verify the deployed bytes after every extend/upgrade step.** `build-mainnet.sh` prints hashes; before final lock, dump the on-chain programs and verify the exact prefix hash plus zero tail.

5. **Key custody must be physically moved before lock.** Specifically:
   - guardian/init authority should be on a hardware wallet, not a hot box key,
   - the $CBOB release wallet secret should be removed from the box and moved to cold custody or a Squads, or the accepted limit 56 risk should be re-approved in writing.

6. **One real mainnet redemption should be performed before removing upgrade authority.** The Test Vault is good, but it is still a simulation. A real vault, real cbBTC, and the real redeem page need to be exercised once.

7. **The final lock should be witnessed.** A human should run the final `set-upgrade-authority --final` for all five programs while two independent parties verify the command and the resulting ProgramData tag; afterward the alarm baselines must be re-taken.

AI can audit code; it cannot verify that the physically signed bytes, the key custody, and the final lock happened the way the documents claim.