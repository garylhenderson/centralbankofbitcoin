## FINDINGS

### 1. CRITICAL — Jupiter swap transaction is not constrained to a swap

**Location:** `bank/revenue.mjs`, validation block immediately before `vtx.sign([operator])`.

The code checks only:

- exactly one static signer, the operator;
- absence of `BPFLoaderUpgradeable` and the MINT program;
- no more than four address-table lookups.

It does **not** validate the transaction’s instruction program IDs, instruction data, token destinations, SOL input, or cbBTC output. Address lookup table entries are not inspected at all.

The comment calls this a “bound,” but an attacker controlling or compromising the Jupiter response can return a versioned transaction signed only by the operator that:

1. transfers the swept SOL to an attacker-controlled account through `SystemProgram`;
2. transfers existing operator cbBTC through the SPL Token program;
3. invokes an arbitrary program that drains or redirects assets; or
4. hides forbidden program/account keys in address-table lookups.

The quote’s `outAmount` and price-impact checks do not help: a malicious transaction can satisfy the quoted output fields while performing unrelated transfers. The operator wallet holds the swept SOL and possibly prior cbBTC, so compromise of the quote/API response is a direct fund-loss path.

**Fix:** Do not sign an arbitrary aggregator transaction. Decode every compiled instruction, including loaded address-table keys, and enforce an allowlist of program IDs and exact account/data patterns. Verify the input transfer is exactly `amount` SOL from the operator, the only output is the expected cbBTC mint to the operator ATA, and no other writable value-bearing accounts are involved. Better: use a tightly constrained swap venue/CPI or an isolated operator wallet that contains no funds except the current cycle.

---

### 2. HIGH — Distribution receipts are self-attested and not verified on-chain

**Location:** `bank/distribute.mjs`, `paymentState()` and the transfer loop; `bank/detectors.mjs`, `detectDistribution()`.

A distribution row with any nonempty `sig` is treated as paid:

```js
if (row.sig) return 'paid'
```

`detectDistribution()` only checks whether a signature string exists. It never fetches that transaction or verifies:

- the transaction succeeded;
- the source was the configured distributor ATA;
- the mint was cbBTC;
- the destination was the intended vault PDA ATA;
- the amount equaled the recorded `plan.per`.

Concrete exploit with the distributor key: transfer the distributor’s cbBTC to an attacker ATA, write arbitrary or unrelated signatures into every victim row, and set `finishedAt`. The alarm reports no unresolved transfers and the next run skips every row. A compromised filesystem user who can edit the ledger can produce the same false “paid” state, although the chain transfer still requires the distributor key.

This is especially dangerous because the distributor wallet is an ordinary signer and the payout path has no on-chain recipient authorization.

**Fix:** Treat the chain as the receipt. For every recorded signature, fetch and verify the finalized transaction and exact SPL transfer fields. Reconcile all outgoing transfers from the distributor ATA against the immutable daily plan, and alarm on transfers to unplanned destinations or incorrect amounts. Do not accept an arbitrary string as a receipt.

---

### 3. HIGH — A split signature can falsely close an unrelated revenue cycle

**Location:** `bank/detectors.mjs`, `detectSplitClaims()` and `detectUnreconciledRevenue()`.

The ledger supplies `cycle.splitSig`. The detector verifies only that this signature appears in the scanned MINT-program transactions:

```js
if (!seen.has(c.splitSig)) ...
```

The scan records signatures containing **any** `split_revenue` instruction, without binding the split to:

- this cycle’s returned cbBTC;
- the revenue ATA balance;
- the cbBTC mint;
- the expected amount;
- the expected holders and Bank destination accounts.

An operator can return cbBTC to the revenue ATA, then record an unrelated valid split transaction—or a split of another token—as this cycle’s `splitSig`. `cycleIsOpen()` then returns false, and the unsplit-balance check is skipped. The cbBTC can remain in the revenue ATA while the alarm reports the cycle closed.

Even without malicious behavior, a stale or copied signature can produce the same false closure.

**Fix:** Decode and verify the `RevenueSplit` event and/or SPL transfers. Bind a cycle to the returned amount and require a subsequent split of the expected mint from the revenue ATA, with the configured holder and Bank ATAs receiving the exact calculated amounts. A signature string alone must never close a money-accounting state machine.

---

### 4. MEDIUM — Distribution does not retry failed days, so rejected payouts are permanently omitted from that day

**Location:** `bank/distribute.mjs`, `main()`.

The job processes only:

```js
const day = today()
```

and only the current day’s `st.days[day]`. A program-rejected payout is correctly marked `rejected`, and `paymentState()` returns `unpaid`, but that row is never revisited after UTC day rollover. The next run creates a new plan for the new day. The customer may receive a later day’s allocation, but the missed day’s entitlement is never retried or separately settled.

This is reachable with a transient frozen destination ATA, temporary token-account state, or other definite program rejection:

1. the day’s plan is created;
2. one destination rejects;
3. the row is marked `rejected`;
4. UTC rolls over;
5. no code resumes the old day.

The detector can report the incomplete historical day, but reporting does not pay it.

**Fix:** Add an explicit retry/settlement queue for rejected rows and process old unfinished days before or alongside the current day. Preserve the original plan and retry only definite rejections; keep ambiguous rows quarantined until chain resolution.

---

## What I tried and could not break

- I found no new duplicate-vote path in `GOV`: `VoteRecord` is seeded by proposal and asset, and the current owner must sign.
- Transfer between votes does not let one asset vote twice; the existing PDA remains occupied.
- `GOV` snapshots quorum and tally parameters into the proposal, so later admin changes do not retroactively alter an open vote.
- Proposal execution is one-way through `executed` and `last_executed_id`, and the execution window plus `closes_at > now` blocks stale closed rounds.
- `MINT` independently enforces the lifetime supply cap, round cap, bounded duration, and nonzero round cap.
- `split_revenue` pins the revenue PDA and all three ATA addresses, and classic SPL Token CPI validation prevents substituting an arbitrary token-account owner or mint merely by changing caller-supplied accounts.
- `sweep_sol_for_swap` enforces the configured destination signer, per-sweep cap, reserve, and cooldown on-chain.
- The reserve inspection loops now check delegates and close authorities in both SEAL and BURN, and the BURN non-reserve loop includes the same checks.
- The listed Core royalty encoding issue is not supportable from this submission: the prompt states the live suite fetches and decodes both royalty updates against cloned mainnet Core. I did not re-report it.
- The detector wiring fixes for watched keys, deferred sweeps, index shape, dry-run state, and missing/corrupt ledgers appear directionally correct from the supplied code; I did not treat the prior fixed defects as current findings.

## THE SINGLE THING to fix before this holds real money

**Stop signing an opaque Jupiter transaction.** The swap transaction must be fully decoded and constrained to an explicitly allowed swap route with verified input, output, destinations, and loaded address-table accounts. As written, the one “trusted hop” can authorize an arbitrary one-signer transaction holding the project’s swept SOL and cbBTC.