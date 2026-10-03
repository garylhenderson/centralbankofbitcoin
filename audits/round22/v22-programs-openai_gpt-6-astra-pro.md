# Audit result

**Do not treat this round as a clean round.** I found failures in the stated revenue-admission invariant, omissions in the emptiness proof, understated entropy influence, and certification assertions that do not exercise the properties they claim.

This was a **source review, not an executed test run**. Each finding below states the evidence that should be produced to confirm it. I do not claim a demonstrated unauthorized drain of a sealed vault or demonstrated pool insolvency.

**Scope limitation:** the four programs, suite, simulation, runner, and supplied documents were available. Most of the off-chain implementation was not: notably `bank/crank.mjs`, `bank/detectors.mjs`, `bank/alarm.mjs`, `bank/layout.mjs`, `bank/revenue.mjs`, the launch checker, and the simulation runner. Their descriptions and imported test calls are not substitutes for reviewing their implementations.

---

# R1. Custody and terminal burn

## R1-1 — MEDIUM: The emptiness proof permits burning while declared token accounts still hold recoverable SOL

**Expected evidence:** Create a vault’s canonical cbBTC ATA, leave its token amount at zero, and transfer SOL directly into that ATA. Submit `open_for_redemption` followed by `burn_vault`, declaring both reserve derivations but not closing the cbBTC ATA.

The expected result is:

- the redemption succeeds;
- the asset becomes Core’s one-byte tombstone;
- the token account retains its lamports;
- its token owner remains the now-unusable asset-signer PDA.

This is different from an **undeclared** airdrop: the account is declared and is a canonical reserve account.

**Construct**

`programs/cbob-vault-burn/src/lib.rs`, `burn_vault`:

```rust
require!(ctx.accounts.asset_signer.lamports() == 0, ...);
```

Both token-account loops subsequently check the SPL `amount`, delegate fields, close authority, and length—but not the lamports remaining in those accounts.

**Consequence**

An empty token account still holds rent. It may also hold arbitrarily more SOL than rent: a System transfer into an SPL-owned account does not increase that account’s cbBTC amount.

Therefore, the burn’s proof of emptiness is not a proof that all recoverable value has left the declared accounts. The owner can lose both rent and additional SOL. No third-party theft is needed.

The suite’s sweep helper reinforces this blind spot: it closes an account only inside its `amt > 0n` branch. A zero-token account can therefore be omitted from cleanup despite holding SOL.

**Fix**

Require closure of declared token accounts owned by the asset-signer PDA before the terminal burn, rather than treating `amount == 0` as fully empty. Update the client to close zero-token accounts too.

Measure the revised path against:

- all three reserve accounts;
- empty and frozen-empty accounts;
- excess lamports above rent;
- the claim-plus-redemption packet;
- additional declared non-reserve accounts.

**Do not remove the existing asset-signer lamports check.** It protects a separate location.

### Pairing assessment

I did not find a source-level route that satisfies the supplied top-level pairing and leaves the opened asset alive:

- SEAL requires a later, genuine top-level BURN instruction naming the asset and owner.
- BURN independently checks ownership and an earlier top-level SEAL instruction.
- A failed later BURN rolls back the thaw.
- A CPI BURN also cannot complete its retirement: MINT requires the direct CPI depth and the current top-level instruction to be BURN.

That is a bounded source conclusion, not an executed wrapper attack. The missing wrapper tests are addressed under R8.

---

# R2. Community-pool money

## R2-1 — MEDIUM: Two-step activation does not enforce “no payment for revenue received before joining”

**Expected evidence:** With an existing joined vault and a large historical balance in the revenue ATA:

1. Put a small amount, such as one sat, into the pool.
2. Request activation for a new funded vault.
3. Distribute the small pool balance.
4. Join the new vault.
5. Call `split_revenue` on the historical revenue balance.
6. Distribute again and claim.

The new vault receives its weighted share of income that the protocol received before that vault joined—and potentially before it existed.

No forged account, wrong destination, or accounting underflow is required.

**Construct**

`programs/cbob-vault-mint/src/lib.rs`:

- `split_revenue` transfers the current revenue balance into the pool without preserving its arrival epoch.
- `activate` records only `request_epoch`.
- `join` sets `debt_scaled = weight * acc_scaled`.
- `credit` divides the currently available pool balance among the current joined weights.

There is no relationship between the activation epoch and the age of money in the revenue account.

**Consequence**

The implemented protection is:

> A new vault does not receive accumulator credits made before it joined.

It is **not**:

> A new vault does not receive revenue that arrived before it joined.

An attacker can use a small distribution to cross the admission boundary before a much larger historical balance is split. The attacker then participates in that historical balance.

There is an additional, smaller timing gap even after revenue reaches the pool: money can arrive after the eligibility-making distribution but before the actual join. That money is also shared with the joining vault at the next distribution.

**Why the measured runs do not contradict this**

`3c.A6` tests a backlog that is **already inside the pool** when the admission-making distribution executes. It does not test an unsplit revenue backlog.

The simulation actually demonstrates a documented bootstrap exception: S7 splits sales revenue before the Test Vault joins, then pays that pre-join revenue to it afterward. I am not re-reporting that explicitly described genesis behavior as a new defect. It does, however, disprove the prompt’s literal universal invariant.

**Fix**

First decide which invariant is intended:

- If eligibility is defined by **distribution epochs**, state that accurately and explicitly disclose capture of previously received but unsplit revenue.
- If revenue must belong to the cohort present when it arrived, the accounting must preserve that cohort boundary. Merely setting debt at join is insufficient.

A repair needs to account for revenue held outside the pool, direct pool deposits, zero-active periods, and forfeited shares. Do not “fix” only the two-instruction `activate → distribute` example.

### Solvency: conditional arithmetic proof

Let:

- \(B\) be the pool’s token balance;
- \(S = 10^{12}\);
- \(O\) be `owed_scaled`;
- \(A\) be `acc_scaled`;
- \(W\) be total active weight.

Assuming valid program-created records and ordinary classic-SPL behavior, the supplied transitions preserve:

\[
O=\sum_{\text{active }i}(w_i A-d_i)
\]

and, at committed instruction boundaries:

\[
B \ge \lceil O/S\rceil.
\]

| Transition | Accounting effect |
|---|---|
| Request activation | No liability or active weight added |
| Join | Adds weight with debt exactly `weight × A`, so adds zero liability |
| Credit | Adds `floor(avail × S / W) × W ≤ avail × S` to liability |
| Claim | Removes exactly `pay × S` from liability and `pay` from pool balance |
| Retirement | Removes that record’s remaining liability without reducing pool balance |
| Empty epoch tick | Changes neither balance nor liability |

The pending counters also have a consistent source-level interpretation:

- request increments both pending counters;
- credit/tick advances the epoch and clears `pending_this_epoch`;
- joining removes an older-epoch pending record only;
- retirement decrements `pending_this_epoch` only for a current-epoch request.

I found no counterexample in these transitions. **P.32 does not prove this invariant:** it samples one endpoint. Stateful testing is still required, particularly for duplicate remaining accounts, retirement orderings, and failures inside batches.

---

# R3. Level draw

## R3-1 — MEDIUM: The accepted validator-grinding limit understates both its reach and its timing

**Expected evidence:**

1. Mint multiple vaults in the same slot. Reconstruct the selected A/B/C slots: they share the entropy slots.
2. Replay candidate C hashes against those assets and the FIFO census. Changing one C hash changes multiple draw results.
3. In a controlled leader schedule, skip the first eligible C slot. The next eligible slot can belong to the **same leader**, not the next leader.
4. Schedule attacker mints so their C target falls inside the attacker’s known future leader rotation.

**Construct**

`programs/cbob-vault-mint/src/lib.rs`:

- `write_record`: `reveal_slot = mint_slot + 16`;
- `try_capture`: fixed leader-group arithmetic;
- `blockhash_in_window`: first produced slot within the allowed window;
- entropy includes the asset address but uses the same slot hashes for vaults sharing those targets.

**Consequence**

Accepted limit 26 says:

> “ONE vault’s draw within one slot’s time”

and the source comment says skipping:

> “hands C to the next leader.”

Neither bound follows from the code.

- **One block can influence multiple vaults.** The asset address separates hashes; it does not isolate the block producer’s influence to one vault.
- **Skipping need not hand control away.** A leader commonly owns four consecutive slots.
- **The attacker’s own mints need not encounter its C leadership with merely random stake-share probability.** The leader schedule is public, and mint timing is selectable. Inclusion remains a constraint, but the attacker can target favorable scheduled rotations.

This does not establish unlimited grinding or a specific achievable bias. It establishes that the accepted exposure bound is too narrow.

**Fix**

Correct the threat model and measure it with:

- batched mints sharing C;
- consecutive leader slots;
- targeted mint timing;
- FIFO effects on multiple candidate assets.

If the intended guarantee is stronger than that measured residual, change the entropy mechanism before immutability. Adding another ordinary public blockhash does not eliminate last-contributor selection.

---

## R3-2 — MEDIUM: Protocol traffic does not guarantee capture; accepted limit 25 states a stronger fallback than exists

**Expected evidence:** Mint a vault, then keep submitting successful host instructions throughout its capture window with no crank accounts—or crank accounts naming other records. After the window expires:

- protocol traffic has continued;
- the target’s `entropy_set` remains false;
- `reschedule_reveal` succeeds.

**Construct**

`programs/cbob-vault-mint/src/lib.rs`:

```rust
fn crank(accts: &[AccountInfo], now: u64) -> Result<()> {
    if accts.is_empty() { return Ok(()); }
```

All four host paths let the caller select the crank records. `claim` expressly permits `crank_n = 0`.

**Consequence**

A lapse does **not** require:

> “a crank outage AND no protocol traffic for the whole window.”

It requires nobody successfully capturing **that particular vault**. There can be abundant protocol traffic.

Even cooperative traffic carrying four records does not, by itself, guarantee coverage of a larger ripe queue.

**Fix**

Replace the claimed fallback with the actual condition: capture depends on a functioning keeper or clients explicitly supplying the relevant record.

If ordinary traffic is supposed to guarantee coverage, enforce a defined queue-coverage rule on chain and measure its packet and compute costs. Otherwise, keep it as an off-chain reliability obligation and test sustained mint bursts, not only single-record opportunistic captures.

---

# R4. Governance

## R4-1 — LOW: Second-resolution stop timestamps allow a proposal created before a stop to restart it

**Expected evidence:** In one transaction, create a restart proposal and then invoke the guardian stop. Both receive the same `unix_timestamp`.

After the proposal passes and its voting period ends, execution restarts the stopped function instead of logging `stop_is_newer`.

**Construct**

`programs/cbob-vault-gov/src/lib.rs`, `execute_proposal`:

```rust
stops.sales_stopped_at > p.created_at
```

`programs/cbob-vault-mint/src/lib.rs`, `restart`:

```rust
c.sales_stopped_at <= proposal_created_at
```

Both use seconds rather than an ordering identifier.

**Consequence**

A restart proposed before the emergency can survive the stale-action guard if the stop lands in the same second. The attacker still needs a passing vote; this is not an immediate guardian bypass.

It is nevertheless a failure of the stated rule that a proposal created before the stop cannot restart it.

**Fix**

Use separate monotonically increasing sales-stop and sweep-stop generations. Snapshot those generations in proposals and compare them at execution.

A slot number alone still leaves same-slot ordering ambiguous.

### Other governance conclusions

The supplied action enum does not expose the pool destination, treasury destination, split, reserve set, or lifetime supply cap. The key-change threshold uses the snapshotted live supply as specified.

The tests do not adequately establish the ordinary YES threshold; see R8-1.

---

# R5. Charter claim

## R5-1 — LOW: The benign-hook compatibility promise exceeds the pass-through implementation

**Expected evidence:** Construct an otherwise valid PoB burn that Core accepts when supplied more than eight necessary external-plugin accounts. The same configuration cannot pass through `claim_charter_vault` because `pob_extra > 8` is rejected.

A concrete test candidate is a collection with multiple distinct approving Oracle plugins whose required accounts exceed the bound. **That Core configuration must be executed before claiming a reproduced incident.** The program-side limit is explicit.

**Construct**

`programs/cbob-vault-mint/src/lib.rs`, `claim_charter_vault`:

```rust
require!(n_extra <= MAX_POB_EXTRA ...);
```

`MAX_POB_EXTRA = 8`.

The suite executes one approving Oracle and a two-Oracle rejecting configuration. `3c.P1` measures one extra account’s packet shape.

**Consequence**

The mitigation supports a **bounded set of benign hook configurations**, not the claim that a benign or approving hook cannot brick charter claims.

A benign collection change can require an unsupported account shape. Restoring compatibility may require the hot collection authority to remove or change that configuration before the irreversible window closes.

This is not a new allegation that the hot wallet can maliciously deny claims; that is already accepted.

**Fix**

Publish and test the actual supported plugin/account envelope. Before opening the charter window, validate every committed PoB against the live collection configuration, including required extra accounts and transaction size.

Do not equate “one real Oracle succeeded” with general external-plugin compatibility.

### Signer qualification

Appending an extra meta with `is_signer = false` does not guarantee that its pubkey is nonsigning everywhere in the CPI: duplicate keys already used as the owner or payer receive the privileges of that key.

I found no resulting privilege escalation here. The accurate guarantee is **no additional signing authority is introduced by the extra-account list**, not that every extra occurrence is necessarily nonsigning at runtime.

---

# R6. One-time configuration, trusted hop, royalties, and cap

## R6-1 — LOW: SEAL validates SPL ownership, not that reserve addresses are initialized mint accounts

**Expected evidence:** On a fresh validator:

1. Supply an ordinary classic-SPL token account address as a reserve “mint.”
2. Initialize SEAL.
3. Use that same address as MINT’s `payment_mint`.

SEAL’s owner check and MINT’s reserve-membership check accept it. A subsequent paid mint fails `WrongPaymentMint` because the account is 165 bytes rather than an 82-byte mint.

**Construct**

`programs/cbob-vaults/src/lib.rs`, `assert_classic_spl`:

```rust
require_keys_eq!(*acc.owner, SPL_TOKEN_ID, ...);
```

It does not deserialize a mint or verify its initialized flag. SEAL also accepts duplicate reserve entries.

MINT’s `initialize` accepts the payment mint as a pubkey and checks membership, not the mint account’s data.

**Consequence**

A wrong account can be locked into the immutable configuration despite passing the advertised “classic SPL mint” validation. A duplicated reserve list can also appear to contain three entries while covering fewer than three distinct assets.

The ruled-address launch checker may prevent these production mistakes, but its implementation was not supplied. On-chain initialization does not.

**Fix**

At SEAL initialization, deserialize each supplied classic-SPL mint, require initialization, and reject duplicate addresses. Independently validate the exact three production addresses before signing.

This supplements blocker 38; it does not discharge it.

### Initialization boundaries actually present

| Program | What it checks | Important values it still accepts |
|---|---|---|
| SEAL | Authorized initializer; 1–3 entries; supplied accounts owned by classic SPL | Duplicates, non-mint SPL accounts, arbitrary collection pubkey |
| MINT | Clean unminted Core collection; MINT update authority; SEAL agreement; payment mint in reserves; numerical bounds | Non-ruled periods and census; nondefault but wrong treasury/operator; arbitrary nonzero root; charter duration up to 90 days |
| BURN | SEAL collection agreement; window 10 seconds–24 hours | Any window in that range, not specifically one hour |
| GOV | MINT collection agreement; quorum/threshold/voting-period bounds | Non-ruled values within those bounds |

Those broad parameter ranges are not new findings: blocker 38 already requires exact launch-value checking.

### Trusted-hop bound

For cap \(C\), cooldown \(D\), and an interval containing an immediately available first sweep, the maximum scheduled outflow is bounded by:

\[
C\bigl(1+\lfloor T/D\rfloor\bigr),
\]

subject to actual revenue balances above the reserve and any stop. Future deposits can replenish that exposure. It is not a lifetime cap.

I found no supplied instruction allowing that operator to sign for the cbBTC pool or a vault.

### Royalty qualification

The code installs `Royalties` with authority `None` and contains no later royalty-write path. The supplied tests exercise Core update/removal refusal on control collections and owner-level override refusal.

However, **an immutable royalty percentage is not proof of mandatory royalty payment on every sale**. Core transfers in this very suite succeed without paying royalty SOL. The DESIGN sentence promising 8.5% “of every resale” is stronger than the implemented fee metadata and marketplace-dependent collection.

Correct that wording; do not claim the plugin forces an arbitrary marketplace or private settlement to pay.

### Rolling cap qualification

The ring implements admission against the cap derived from **pre-redemption live supply**. It is not an hourly reset or a continuously refilling bucket.

The documents’ “45 per hour at 2,100 live” is an initial cap, not a guaranteed 45-redemption burst. With no intervening mints, the cap falls during the burst; starting at 2,100, the 45th immediate redemption is refused after 44 have landed.

This is stricter, not a bypass. The tests should still cover cap transitions and ring wraparound.

---

# R7. Cross-program raw reads and account space

I recomputed the Borsh offsets from the supplied definitions, without native Rust alignment. I found **no offset or account-space mismatch** in those definitions.

The following is the recomputed map, not a claim that the omitted off-chain reader agrees with it.

## MINT config

Offsets include the eight-byte discriminator.

| Field(s) | Offset(s) |
|---|---|
| version, collection, governance, pool ATA | 8, 9, 41, 73 |
| round ID, opens, closes, price | 105, 109, 117, 125 |
| cap, minted this round, minted total, max supply | 133, 137, 141, 149 |
| treasury, split | 157, 189 |
| sales stopped, sweep stopped | 191, 192 |
| guardian, swap operator | 193, 225 |
| SOL reserve, bump | 257, 265 |
| max sweep, cooldown, last sweep | 266, 274, 282 |
| level caps, level minted, revealed total | 290, 310, 330 |
| payment mint, PoB collection, PoB root | 338, 370, 402 |
| charter opens, closes, claimed | 434, 442, 450 |
| bare burns retired, active weight, active count | 454, 462, 470 |
| accumulator, owed | 478, 494 |
| last distribution | 510 |
| sales stop time, sweep stop time | 518, 526 |
| pending operator, its timestamp, monthly period | 534, 566, 574 |
| pending guardian, set flag, timestamp | 582, 614, 615 |
| notice, sweep floor, cooldown ceiling, reserve ceiling | 623, 631, 639, 647 |
| distribution epoch, pending count, pending this epoch | 655, 663, 671 |

Serialized length: **679 bytes**, including discriminator. Allocated: **935 bytes**.

## Other accounts

| Account | Recomputed layout / allocation |
|---|---|
| SEAL `Config` | version 8; collection 9; vector length 41; keys 45; bump `45 + 32n`. Serialized `46 + 32n`; maximum 142; allocation **398** |
| `VaultRecord` | version 8; asset 9; index 41; reveal slot 49; level 57; charter 58; entropy flag 59; entropy 60; attribute hash 92; bump 124; active 125; retired 126; reschedules 127; ATA 129; debt 161; pending 177; request epoch 178. Serialized **186**; allocation **221** |
| `BurnConfig` | version 8; collection 9; bump 41; burned total 42; window 50; head 58; ring 59–570. Serialized **571**; allocation **827** |
| `GovConfig` | version 8; collection 9; quorum 41; threshold 43; voting period 45; proposal count 53; bump 61; ordering marks 62, 70, 78. Serialized **86**; allocation **342** |
| `VoteRecord` | discriminator 8 + two keys 64 + support 1 + bump 1 = **74** |
| `Proposal` | allocation **222**. Largest individual action is 37 bytes. Four distinct maximum-sized kinds total 127 action bytes, so the allocation is sufficient |

All supplied GOV/BURN raw-read offsets agree with this map.

---

# R8. Suite and simulation as evidence

## R8-1 — MEDIUM: The suite does not test failure of the governance YES threshold

**Expected evidence:** Delete or neutralize the `ThresholdNotMet` requirement while retaining the other checks. The supplied governance test inputs provide no NO-vote scenario that distinguishes the mutant from the original.

**Construct**

`programs/cbob-vault-gov/src/lib.rs`, `execute_proposal`, versus governance sections of `tests/3prog.test.ts` and `sim/test-vault.ts`.

The supplied voting calls use `support = true`. The main suite uses 5% quorum and 60% threshold; the simulation uses production ratios but passes its round with unanimous YES.

**Consequence**

The suite can certify a program with a broken YES/NO threshold. Checking the configured value is not a behavioral test of the threshold.

**Fix**

Add mixed-vote cases that:

- meet quorum and the 10% YES floor;
- fail solely on threshold;
- then pass at the exact threshold boundary.

Run both the production 21%/51% configuration and rounding-sensitive small electorates. Assert `ThresholdNotMet`, not merely rejection.

---

## R8-2 — MEDIUM: Draw replay validates selection from stored entropy, not the entropy’s derivation

**Expected evidence:** Retain the timing and SlotHashes validation in `try_capture`, but replace its final hash with a hash of the asset alone.

The principal level assertions still compare levels against the entropy that the modified program itself stored. They do not independently prove that A, B, and C contributed to it.

**Construct**

`tests/3prog.test.ts`:

- L.10;
- L.17d;
- L.23;
- `drawOf`.

These read `VaultRecord.entropy` as the input to their independent calculation.

**Consequence**

A program could use predictable or incorrectly selected entropy while passing quota checks, FIFO checks, stored-entropy replay, and attribute matching.

The single-validator tests also do not exercise actual skipped-slot selection or distinct leader groups.

**Fix**

Archive the relevant SlotHashes state and independently calculate:

1. the selected A slot;
2. the selected B slot;
3. the selected C slot;
4. the three hashes;
5. the final hash including the asset.

Compare that result with the record. Add controlled skipped-slot cases and leader-group boundary cases.

---

## R8-3 — LOW: Several named assertions are vacuous or weaker than the advertised property

**Expected evidence and constructs**

| Assertion | What it actually establishes |
|---|---|
| **X.7**, crank FIFO | Runs after the census has been completely revealed. An empty `plan.reveal` passes `every(...)`. It does not exercise a pending reveal queue. |
| **RL.1** | Recomputes a cap already computed by the suite’s `bucket()` helper. There is no stored on-chain cap being compared. |
| **RL.7** | Compares all windows against a cap derived from final lifetime minted supply, not the live cap in force at each redemption. It can miss violations of a lower historical cap. |
| **P.32** | Checks solvency once, near the end—not after every transition or ordering. |
| **6.17**, three sweeps in one transaction | Immediately follows a successful sweep. Without an explicit cooldown wait, rejection can occur at the **first** sweep, so `SweepTooSoon` alone does not prove the intra-transaction restriction. |
| **S6.11**, “redeem page’s check” | Calls a detector directly. It does not run a page, signature flow, or `judgeRedemptionCoverage` integration. |
| **S9.2**, direct Core re-creation | Rejection has no pinned reason despite the simulation’s statement that every negative is reason-pinned. |

**Consequence**

The assertion count can stay exact while the amount of independently established behavior is overstated.

**Fix**

- Require nonempty fixtures where a nonempty behavior is being tested.
- Prove the first sweep can execute before testing rejection of the second.
- Record live-supply history for rate-limit replay.
- Assert accounting after each generated transition.
- Name detector tests as detector tests.
- Pin the direct-Core re-creation failure to the actual on-chain reason.

### Important unexercised paths

These are test requirements, not assertions that the programs necessarily fail:

- successful adversarial CPI-wrapper attempts against the pairing;
- all 64 ring positions and wraparound—neither supplied run performs 65 redemptions;
- production-size cap changes;
- independent SlotHashes derivation and skipped-slot handling;
- maximum ready-record cranks on every host, with measured CU consumption;
- retirement of both current-epoch and eligible-older-epoch pending records;
- historical unsplit revenue across admission;
- excess SOL in declared zero-token accounts;
- a worst-case three-reserve redemption combining an actually owed claim, all sweeps, account closure, and PDA SOL cleanup.

---

# The four questions about accepted limits

## 1. Is any accepted limit worse than stated?

**Yes.**

- **25:** Missing capture does not require absence of protocol traffic. Crank coverage is optional and record-specific.
- **26:** A C leader can influence multiple vaults sharing entropy slots, can retain control after a skip within its rotation, and can target its own mint timing toward known leader slots.
- **46:** The benign-hook mitigation covers bounded configurations, not arbitrary approving hooks.
- **44 does not cover R1-1:** the value is in a **declared canonical reserve account**, not an omitted holding.

The pre-join revenue invariant also needs correction or redesign; its failure is not listed as an accepted allocation limit.

## 2. Is anything described as a limit already closed or overstated?

Some language overstates the restriction rather than understating the risk:

- A **frozen pool** does not stop every invocation of `claim`: a pending-only join or a claim owing no whole sats can complete without a token transfer. It stops delivery from the pool.
- The cap is stricter than “45 immediately redeemable at 2,100” because live supply shrinks during the burst.
- An off-curve owner cannot perform this top-level redemption while it owns the vault. That is not proof that every program-controlled owner is permanently trapped: a controller capable of transferring the asset to a normal wallet may recover that situation. The guide should distinguish inability to redeem directly from inability to transfer out.

I would not mark an accepted item discharged solely from these qualifications.

## 3. Is any DISCHARGED item not actually discharged?

The most significant overreach is **12/17’s universal compute conclusion**.

The measured transactions establish their own CU usage. Extrapolating the cost of cheap System-transfer padding does not prove that every byte-fitting supported composition has the same CU-per-byte behavior. Four ready captures are not equivalent to four System transfers.

I am **not** reporting an observed CU exhaustion or reopening the original “nothing was measured” finding. I am rejecting the broader proof claim.

Item **11** correctly says the old off-chain ledger is gone, but P.32 is not a proof of the replacement invariant. The arithmetic argument and stateful transition tests must carry that claim.

The supplied source supports the structural reasons for the other listed removals; I found no demonstrated reopening of them.

## 4. Is OPEN AND BLOCKING being quietly treated as accepted?

**Item 50 is being described as operational in evidence that never runs it.**

- The holder guide says the page checks and warns.
- S6.11 labels a direct detector call as the page’s check.
- No page or signing flow exists in the supplied implementation.

That assertion must not serve as evidence for closing 50.

For **22**, local programs and pure planners do not establish a live 2,100-vault crank deployment.

For **38**, `run-tests.sh` runs the launch checker’s **selftest**. That does not demonstrate that the eventual deployment transaction is constructed from, and byte-for-byte agrees with, a checked final launch file. The actual checker and signing path were not supplied here.

All three remain launch blockers.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

The missing backstop must be replaced by **executed, independently inspectable evidence**, not another count of agreeing readers.

1. **Turn every finding above into a reproducible transaction or mutation test.**  
   Preserve signatures, complete logs, before/after account bytes, and the exact artifact hashes. Do not close findings from verbal rebuttals or generic rejection.

2. **Run an independent state-machine test of the pool.**  
   Generate requests, joins, distributions, duplicate claim pairs, freezes, claims, bare burns, redemptions, and failures in varied orders. After every successful transition, independently recompute liabilities, active weight, and both pending counters from all records. Require the claimed invariants, not merely agreement with a second copy of the same implementation.

3. **Mutation-test the certification itself.**  
   Deliberately disable threshold enforcement, remove one pairing binding, make entropy predictable, corrupt a raw offset, and introduce a double-payment. Every mutation must make the relevant suite fail for the intended reason. Exact assertion counts do not establish this.

4. **Execute a multi-validator entropy exercise.**  
   A single local leader cannot validate the claimed leader separation, skipping behavior, or adversarial scheduling bounds. Record the actual leader schedule and independently reconstructed entropy.

5. **Run the real off-chain jobs through operational failure.**  
   At approximately 2,100 records, inject RPC throttling, timeout after submission, restart mid-batch, a wedged lock, missing history, and an unavailable indexer. Demonstrate recovery without losing queue coverage or silently skipping holders. Deliver an actual alarm to the actual responder and measure response time.

6. **Build and test the real holder signing surfaces before closing item 50.**  
   Use the supported wallets, including hardware-wallet flows. Test zero-token accounts holding SOL, unexpected holdings, frozen accounts, join-gate handling, destination-account preparation, stale balances, and transaction-size limits. Show what the holder actually sees before signing.

7. **Perform an artifact-and-configuration ceremony.**  
   Independently reproduce the mainnet builds; compare deployed program bytes; decode every signed initialization transaction independently of its builder; verify all resulting accounts against the final ruled manifest. Archive this evidence before removing authorities.

8. **Use the production clocks in a full dress rehearsal.**  
   Short-clock tests are useful arithmetic tests. They do not exercise three-day voting operations, seven-day notice response, thirty-day keeper continuity, or real key custody. Those require elapsed time and real operators.

9. **Keep the release decision separate from the author’s harness.**  
   Whoever operates the launch must require the evidence bundle and refuse authority removal when a required run is absent, skipped, or performed against different bytes. No model’s assurance can substitute for that act.

**Until the empirical counterexamples are resolved, the invariant wording is made precise, and blockers 22, 38, and 50 are discharged with actual artifacts, removing the upgrade authorities would permanently lock in unresolved behavior.**