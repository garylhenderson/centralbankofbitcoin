# 1. MINT

### HIGH — Mint accepts customer-supplied provenance as authoritative

**Construct.** `mint_vault(..., attributes)` accepts arbitrary key/value attributes from the owner and Bank transaction. The only restrictions are count, string length, non-empty keys, and prohibition of `redemption`.

**Impact.** A caller can mint a “charter” vault with arbitrary `charter`, `notice`, standing, or other provenance values. Any off-chain consumer that treats these attributes as evidence rather than untrusted claims can grant benefits, voting weight, allocation priority, or eligibility to an unentitled customer.

The Bank comment says it must refuse charter-priced mints without a burned Proof of Burn, but no such proof is checked on-chain. The mint program itself does not distinguish authoritative provenance from caller-provided text.

**Fix.** Make provenance authoritative:

- derive the attributes from a verified Proof-of-Burn/Notice account;
- or have a dedicated issuer PDA write them after verification;
- or explicitly mark all mint-supplied attributes as untrusted metadata and ensure every consumer ignores them for eligibility.

### MEDIUM — The tested and shipped MINT binary are different builds

**Construct.** `run-tests.sh` builds with `--features localnet`; mainnet artifacts are built without it. `INIT_AUTHORITY` differs between the builds. The suite therefore does not test the exact binary intended to hold customer funds.

**Impact.** The mainnet build has not been exercised through the full mint, configuration, and authority paths against the actual Squads authority. `build-mainnet.sh` checks source text and tests rejection of the localnet key, but it does not prove that the compiled mainnet constant is the intended Squads key.

**Fix.**

- Run the full integration suite against the exact mainnet artifact.
- Test the real Squads CPI initialization path in a fork or dedicated integration environment.
- Verify the compiled constant through behavior using a controlled authority that is cryptographically linked to the expected Squads address, not merely by checking that it rejects the localnet key.

### LOW — Configuration padding is not a migration mechanism

**Construct.** All four `Initialize` instructions allocate fixed space with trailing padding, but there is no migration or `realloc` instruction. The programs deserialize `Account<Config>` using their current layouts.

**Impact.** The next field addition beyond the padding, or any incompatible layout change, can brick minting, revenue movement, governance, or redemption. This is a permanent availability risk for customer funds, not merely a maintainability concern.

**Fix.** Add versioned migrations before any further field additions. Make every upgrade reject deployment unless the migration has been executed, and test upgrading an initialized production-sized account.

---

# 2. UNBREAK — open_for_redemption + burn_vault

### CRITICAL — A direct Core burn can still destroy the vault contents

**Construct.** The owner can invoke Metaplex Core `BurnV1` directly, without `SEAL::open_for_redemption` and without `BURN::burn_vault`. The PermanentFreezeExecute plugin gates Execute, not BurnV1. Core BurnV1 does not sweep the asset-signer PDA.

**Impact.** The owner can burn a still-sealed vault while its cbBTC remains in the asset-signer PDA. The Core asset is destroyed and the PDA becomes permanently unsignable; the Bitcoin is destroyed rather than released.

This directly violates the stated terminal rule that breaking a vault must release its contents. The alarm can detect the event later, but detection does not restore the Bitcoin.

**Fix.** A freely transferable Core asset cannot simultaneously have an owner-authorized burn path disabled and retain resale. Therefore choose an explicit design:

- accept that owner-direct burns are destructive and remove the “burn means release” guarantee;
- use a Core plugin/version that gates burn as well as Execute;
- use a non-transferable or freeze-based design;
- or migrate contents out of the asset before permitting any burn-capable ownership state.

An off-chain alarm is not a preventive control.

### HIGH — The pairing is not cryptographically tied to instruction semantics

**Construct.** SEAL and BURN compare only:

- program ID;
- instruction discriminator;
- account index 0 as asset;
- account index 2 as owner.

The discriminator is derived only from the instruction name. A future BURN upgrade can add or reorder accounts while retaining the same discriminator.

**Impact.** The current BURN handler independently validates its actual Anchor accounts, so the present version does not demonstrate an immediate theft. However, the claimed “fails closed in every case” property is false as a general coupling guarantee. A future upgrade can make SEAL’s positional test validate one account while BURN interprets another account as the owner, asset, or authority. Depending on the changed handler, this can either halt redemption or create a mismatched authorization boundary.

The comments incorrectly elevate two duplicated constants and positional checks into a complete protocol-binding proof.

**Fix.**

- Put the pairing protocol in a shared versioned interface crate.
- Include an explicit pairing nonce or asset/owner hash in instruction data.
- Have BURN and SEAL validate the same versioned payload, not merely positions.
- Reject any unsupported protocol version.
- Add an upgrade compatibility test that mutates account order and confirms both sides reject.

### HIGH — The one-transaction design has an unbounded product-wide denial-of-service

**Construct.** SEAL requires the BURN instruction later in the same transaction. All sweep instructions and all declared reserve accounts must therefore fit in one transaction. `reserve_mints` is additive-only and can grow to eight. No on-chain or configuration-time transaction-size check exists.

**Impact.** A reserve-list addition can make every redemption impossible. The owner can no longer perform the required open/sweep/burn transaction, and the additive-only rule prevents removing the newly added mint. An address lookup table may reduce account-address bytes, but does not remove instruction metas, signatures, instruction data, or the transaction’s 1232-byte ceiling. It also requires pre-provisioned operational infrastructure.

The one-reserve measurement does not prove the maximum. The real maximum must be measured from serialized transactions for each reserve count and transaction version.

**Fix.**

- Measure and enforce the maximum supported reserve count before configuration changes.
- Reject reserve additions unless a complete redemption transaction for every supported vault shape serializes under the selected transaction format.
- Prefer a versioned transaction with a controlled ALT and test it in production-like conditions.
- Better: remove the requirement that the complete sweep be carried in the same transaction, or use a state machine with a burn authorization that cannot leave the asset thawed across transactions.

### HIGH — No pre-signing Bank gate is implemented

**Construct.** `burn_vault` can only inspect declared accounts. `bank/alarm.mjs --reconcile` scans token accounts only when run, and it runs after the fact. No Bank signing service or transaction-construction hook is shown that performs the required `getTokenAccountsByOwner` and DAS scan before co-signing `open_for_redemption` or `burn_vault`.

The reconcile code does not enumerate nested Core assets owned by the asset-signer PDA.

**Impact.** The documented control against undeclared tokens and nested Core assets is a comment and a periodic post-event alarm, not a co-signature gate. A burn can therefore proceed while an undeclared token is destroyed or a nested vault becomes orphaned.

**Fix.**

- Put the scan in the Bank signing path, not merely in a cron.
- Refuse to sign unless the scan is fresh, complete, and tied to the exact asset and transaction.
- Scan both:
  - `getTokenAccountsByOwner` for every token program;
  - DAS/Core ownership queries for nested assets.
- Fail closed on RPC pagination, DAS inconsistency, or unavailable data.
- Record the scan result and transaction hash in an append-only audit store.

### MEDIUM — No transaction-level proof that every sweep covers every holding

**Construct.** The emptiness proof checks declared reserve ATAs and declared remaining accounts, but it does not require that every sweep instruction is actually directed from the asset-signer PDA to the intended recipient. It only checks the post-sweep state.

**Impact.** A malformed or future sweep path could leave a token account empty by transferring value to an unintended destination while still satisfying the burn proof. The Bank is expected to inspect the entire transaction, but this is not enforced by BURN.

**Fix.** Validate the transaction’s sweep instructions or introduce a dedicated sweep primitive that:

- accepts only configured mints;
- accepts only the asset-signer PDA as source;
- accepts only the owner or approved destination;
- validates the exact amount;
- rejects arbitrary CPI routes during redemption.

---

# 3. ROYALTY

### HIGH — The collection royalty configuration is mutable outside the stated “100% royalty mechanic”

**Construct.** `set_collection_royalties` lets admin and governance choose any `basis_points <= 1000`, and `add` selects between add and update. The code routes creators to the revenue PDA, but it does not enforce that the plugin remains present, that its authority remains expected, or that the collection’s full plugin state still matches the intended freeze/royalty configuration.

**Impact.** A collection update or future Core/plugin behavior change can alter royalty enforcement or plugin state. `collection.hash` is only detected by the alarm after a scan; it is not enforced at transaction time. Secondary marketplaces may pay no royalty or route it differently, while the product continues presenting the collection as governed by the stated royalty mechanic.

**Fix.**

- Pin and continuously verify the complete decoded collection plugin state, not only hash drift.
- Add an on-chain authority-controlled repair instruction for the royalty plugin.
- Make the Bank distribution logic independent of secondary royalty assumptions.
- Treat any collection hash/plugin mismatch as a hard operational halt, not merely an email alert.

### MEDIUM — Revenue reconciliation verifies a split discriminator, not the split amount

**Construct.** `alarm.mjs` records a split when it sees MINT’s `split_revenue` discriminator with `CBBTC` at account index 2. The detector explicitly does not parse `RevenueSplit` amounts and does not verify the source balance or destination deltas.

**Impact.** A transaction can contain a genuine `split_revenue(CBBTC)` call that moves an unexpected amount, or a future MINT upgrade can change account semantics while retaining the discriminator. The alarm may mark a cycle as split even though the expected returned cbBTC was not divided as expected.

The on-chain instruction currently pins source and destinations, but the off-chain control is claimed as a reconciliation control and is incomplete.

**Fix.** For each split, verify on chain:

- exact revenue ATA;
- exact holder and Bank ATAs;
- pre/post balances;
- emitted total/holder/Bank amounts;
- that the split amount equals the cycle’s returned amount, subject to the documented rounding rule.

### HIGH — Jupiter swap validation is insufficient to protect operator-held funds

**Construct.** `revenue.mjs` checks that the returned versioned transaction has exactly one static signer, the operator, and that it does not mention the BPF loader or MINT program. It does not constrain the invoked programs, token accounts, source/destination accounts, or instruction semantics.

**Impact.** A substituted or compromised Jupiter response can use the operator signature to:

- transfer existing cbBTC from the operator ATA;
- transfer SOL remaining in the operator wallet;
- approve delegates;
- invoke arbitrary programs;
- route funds to an attacker-controlled account.

The check does not establish that the transaction is a SOL-to-cbBTC swap returning the output to the operator’s expected ATA. “The operator wallet holds nothing else” is not implemented as a technical guarantee.

**Fix.**

- Decode and allowlist every instruction/program in the swap transaction.
- Require exact input source, output destination, input mint, output mint, amount, and minimum output.
- Reject token approvals, arbitrary system transfers, close-authority changes, and unknown programs.
- Use a dedicated swap wallet with enforced balance isolation and no persistent project assets.
- Prefer a DEX/aggregator integration whose transaction format can be verified deterministically.

### MEDIUM — The trusted-hop ledger remains mutable by the key being audited

**Construct.** `revenue-ledger.json` is written by the same process/user controlling the swap operator key. The alarm improves this by checking chain sweep signatures and amounts, but return amounts and some split attribution still originate in the ledger and are correlated heuristically.

**Impact.** A compromised operator can return less than expected, manipulate ledger timestamps or return fields, and delay or misattribute evidence. The chain-derived sweep check catches some lies, but it does not prove that the returned cbBTC came from that swap or that the correct amount was split.

**Fix.** Derive all return and split values from chain transactions and balance deltas. Store immutable, append-only records outside the operator’s security boundary. Reconcile by transaction graph and exact amounts, not timestamps and ledger position.

---

# 4. VOTING

### HIGH — Voting power is live ownership, so votes can be atomically rented

**Construct.** `cast_vote` reads the current Core owner and requires that owner’s signature. A vault can be transferred to a broker, voted, and transferred back in one transaction.

**Impact.** A temporary holder can rent voting power without economically owning the vault at proposal creation or execution. A coalition can buy temporary custody of enough vaults to ratify a round, alter price/cap, or halt/restart sales, while the long-term owners retain the assets afterward.

The specification acknowledges this, but it contradicts an unqualified “one vault one vote” governance claim.

**Fix.** Choose and document a snapshot rule:

- snapshot owners at proposal creation;
- require a voting escrow/lock;
- require the asset to remain owned by the voter through the voting period;
- or explicitly define votes as transferable/rentable and lower the authority of governance accordingly.

### MEDIUM — Quorum is based on cumulative issuance, not eligible voting supply

**Construct.** `quorum_supply` snapshots `minted_total`, which never decrements. Burned vaults remain in the divisor permanently.

**Impact.** As vaults are redeemed, the denominator can become larger than the population capable of voting. Governance can eventually become permanently unable to pass any proposal, including a recovery proposal needed to repair governance or operational parameters.

The code deliberately allows lowering quorum, but that itself is an admin action and not a holder-controlled recovery path.

**Fix.** Use a defined eligible-supply snapshot, such as live unburned vaults, or implement a governance-controlled recovery mechanism that cannot be used to lower quorum on an active proposal.

### MEDIUM — Proposal creation does not enforce that the proposer’s vault remains eligible through voting

**Construct.** `create_proposal` checks the proposer’s current ownership only. Once created, the proposer may transfer or burn the vault. The proposal remains active and can be voted/executed by others.

**Impact.** A proposer can create proposals with stale or strategically selected parameters and exit before the vote. This is not necessarily theft by itself, but it weakens the relationship between proposal sponsorship and current holder accountability.

**Fix.** Either require the proposer to retain the vault until voting ends or remove any implication that proposal creation represents continuing holder support.

---

# 5. TRANSFER

### CRITICAL — Transfer to a PDA can permanently brick customer Bitcoin

**Construct.** Core transfer permits a vault to be transferred to its own asset-signer PDA or another vault’s asset-signer PDA. The new owner cannot produce the direct owner signature required by SEAL and Core Execute.

**Impact.** The vault remains sealed and its cbBTC becomes permanently unreachable. This can occur through a malicious marketplace listing, an incorrect recipient, or a user-supplied transfer destination. The program has no on-chain recovery path.

This is incompatible with a 100% transfer claim unless bricking is explicitly accepted as part of the transfer model.

**Fix.**

- Add an on-chain transfer guard rejecting known asset-signer PDAs and all other off-curve/PDA recipients where possible.
- Enforce recipient validation in the marketplace and wallet/UI.
- Add a recovery mechanism before transfer, or make the asset non-transferable if safe custody cannot be preserved.
- At minimum, prevent transfers to the asset-signer PDA of any Core asset and to all known CBOB vault PDAs.

---

# 6. SELL

### CRITICAL — A buyer cannot verify reserve continuity atomically at purchase

**Construct.** The buyer’s basis is that the vault still holds its reserve. Reserve balances live in token accounts owned by the asset-signer PDA, while Core transfer changes the NFT owner. There is no marketplace-side atomic condition requiring the reserve balance to equal the advertised amount at the moment of sale.

**Impact.** A seller or delegate can drain or alter the reserve before sale, or a marketplace can execute against stale metadata. The buyer acquires the Core asset without an on-chain guarantee that the reserve still exists. The alarm’s periodic `detectBalanceDrops` is retrospective and does not protect the purchase.

**Fix.**

- Require the marketplace settlement instruction to read and validate the reserve balance in the same transaction as transfer and payment.
- Escrow the vault and reserve or use an atomic program-mediated sale.
- Maintain an on-chain reserve commitment/version and require the buyer to specify the expected balance.
- Do not advertise “reserve-backed” resale based only on off-chain scans.

### HIGH — Delegate risk is not covered for all token-account shapes

**Construct.** BURN checks declared token accounts, and the Bank is expected to detect approvals. Non-canonical accounts are not covered by on-chain enumeration. The distribution and sale logic cannot guarantee that a delegate has not been approved on an undeclared account.

**Impact.** A delegate can transfer tokens from a non-canonical PDA-owned account without Core Execute or a Bank signature. If the vault is sold before the delegate is detected, the buyer inherits a compromised reserve.

Closing the ATA during redemption removes that specific delegate, but does not solve the general sale-time problem for accounts that remain alive.

**Fix.** Make the Bank’s pre-sale scan mandatory, or eliminate arbitrary PDA-owned token accounts by using a controlled custody model. A marketplace should refuse sale when any non-canonical account, delegate, close authority, or unexpected token program account exists.

---

# 7. NESTING AND AIRDROPS

### CRITICAL — The documented off-chain control is not implemented for nested Core assets

**Construct.** `reconcile()` calls `getTokenAccountsByOwner` for each asset-signer PDA, but does not perform a DAS/Core asset ownership query for Core assets held by that PDA. `listVaults()` only lists assets in the collection; it does not enumerate assets owned by each asset-signer PDA.

**Impact.** A nested vault can remain invisible to the Bank’s claimed pre-signing scan. The outer vault can then be opened and burned with the inner vault undeclared, orphaning the inner vault and its Bitcoin permanently.

The test suite deliberately demonstrates this behavior; the claimed mitigation is absent from the shown implementation.

**Fix.**

- Query DAS for assets owned by every asset-signer PDA.
- Treat any owned Core asset as a blocking condition.
- Require a complete scan immediately before Bank co-signing.
- Fail closed when DAS is unavailable, paginated incompletely, or inconsistent.

### CRITICAL — The Bank co-signature is not actually a precondition on the scanner result

**Construct.** The programs require only a Bank public-key signature. The shown `alarm.mjs --reconcile` runs on a schedule and calls `report`; it does not authorize or reject the transaction that the Bank signs. No signing service integration is provided.

**Impact.** A Bank key holder or signing process can sign `burn_vault` without the required completeness scan. The “two-of-two” property then reduces to possession of a key, not an enforced Bank review of the transaction and PDA holdings.

**Fix.** Put the scan and transaction validation in the signing service. The service must refuse the Bank signature unless:

- the exact transaction is simulated;
- all declared accounts and sweep instructions are validated;
- token-account enumeration is complete;
- nested Core ownership is checked;
- the scan is fresh and tied to the exact asset;
- all RPC/DAS reads succeed.

### HIGH — Airdropped non-reserve tokens can be destroyed without customer consent

**Construct.** An attacker can create a token account owned by the asset-signer PDA, fund it, omit it from `remaining_accounts`, and cause the owner/Bank redemption transaction to burn the outer vault.

**Impact.** The airdropped token balance is destroyed. This is not merely a stranded nuisance: the v5 burn makes destruction the normal terminal path. The same construction applies to valuable tokens intentionally sent to the PDA but not included in the configured reserve list.

**Fix.** This requires either complete pre-signing enumeration or a custody design where arbitrary PDA-owned holdings cannot be burned without an on-chain sweep authorization. The current post-fact alarm is insufficient.

---

# 8. THE INVARIANT

### CRITICAL — “Everything stays in the vault until broken” is false for direct burns

**Construct.** Core `BurnV1` is callable directly by the owner while the vault is sealed. It removes the asset without releasing the asset-signer PDA’s token holdings.

**Impact.** The system has a reachable path where the vault ceases to exist while customer Bitcoin remains permanently inaccessible. This violates both halves of the invariant:

- contents do not remain safely recoverable until the terminal operation;
- the terminal operation does not release the contents.

**Fix.** The design must prevent or explicitly redesign direct Core burn. Monitoring cannot enforce this invariant.

### HIGH — Distribution proceeds after incomplete reserve reads and can overpay other customers

**Construct.** In `distribute.mjs`, a present-but-malformed ATA is added to `poisoned`, assigned balance zero, and the job continues. `allocate()` then excludes that vault from the activated set while dividing the full distributor balance among the remaining visible activated vaults.

**Impact.** Anyone can place a one-lamport system account or malformed account at a derived ATA address. The affected customer is omitted, while other customers receive too much. The code logs and persists an alarm, but it has already performed an incorrect allocation. This violates the claimed “refuses to guess” invariant.

The same issue can occur for a missing account: it is treated as zero for allocation and only printed as “not created,” without a blocking finding.

**Fix.**

- Abort the entire allocation if any previously activated vault cannot be read.
- Do not treat missing or malformed accounts as a zero balance.
- Recompute only after the account is repaired or an explicit human resolution is recorded.
- Ensure the alarm and the payment job share the same completeness result.

### CRITICAL — The OS lock still has a race that can permit concurrent money jobs

**Construct.** In `acquireLock`, after the second read confirms the stale token, the code performs:

```text
unlink(file)
claim(file, payload)
```

The re-read narrows the race but does not make unlink-and-claim atomic. A possible interleaving is:

1. Runner A reads and confirms the stale lock.
2. Runner A is descheduled before `unlinkSync`.
3. Runner B reads and confirms the same stale lock.
4. Runner B unlinks and claims a fresh lock.
5. Runner A resumes, unlinks B’s fresh lock, and claims it.

Both runners can then execute payment work.

**Impact.** Concurrent distribution or revenue runs can overwrite ledgers and repeat transfers, producing double payments or inconsistent reconciliation.

The source comments acknowledge this remaining TOCTOU, so it is not a theoretical claim about an unconsidered path.

**Fix.** Use an OS primitive that provides ownership and lease semantics:

- `flock` on an open file descriptor;
- a lock daemon/service;
- a lease file with compare-and-delete performed by a filesystem primitive that supports it;
- or a process supervisor that guarantees singleton execution.

Do not break a stale lock using unlink followed by a separately claimable filename.

### HIGH — The alarm’s state marker can be committed before alert delivery

**Construct.** In the normal alarm path:

```js
markEver()
const delivered = report(...)
```

`markEver()` writes `.alarm-has-run` before `report()` attempts notification. If the process dies or notification fails before the state is safely committed, the next invocation can treat a missing state file as a previously initialized pipeline and refuse to establish a baseline.

**Impact.** This is primarily a denial of service, but it can also leave operators with a marker and no corresponding state, preventing normal recovery and complicating whether a finding was delivered.

**Fix.** Commit state and the “has run” marker only after successful report delivery, using an atomic transaction-like protocol:

1. write pending state;
2. deliver notification;
3. atomically commit state and marker;
4. retain pending state if delivery fails.

### HIGH — The alarm cannot guarantee complete coverage of direct Core burns between reconciliations

**Construct.** The regular alarm intentionally does not scan Core signatures. Direct Core burns are detected by DAS collection reconciliation, while the nested/airdrop reconcile is a separate daily job.

**Impact.** A direct destructive burn can occur and remain undetected for up to the reconciliation interval, while customer funds are already irrecoverable. For nested Core assets, the current reconcile does not detect them at all.

**Fix.** Reduce this to a documented detection-only limitation, or add:

- continuous DAS/index monitoring;
- a Core event/indexer feed with completeness proofs;
- and a Bank signing gate that checks the asset immediately before any supported burn.

### MEDIUM — The invariant has no on-chain representation of “all holdings released”

**Construct.** BURN proves emptiness only over accounts supplied in `remaining_accounts`, deterministic reserve ATA addresses, and declared Core accounts. Completeness is explicitly outside the chain.

**Impact.** The strongest product statement—everything remains in the vault until destruction, then is released—cannot be proven or enforced by the programs. It depends on a mutable JSON ledger, RPC availability, DAS correctness, and human response.

**Fix.** Narrow the invariant to what is actually enforced, or redesign custody so the program controls a finite, enumerable set of holding accounts. Do not describe an off-chain best-effort scan as a 100% invariant.

---

# What would a 100% claim have to survive?

## MINT

It would need end-to-end tests proving:

- exact price transfer and slippage behavior;
- lifetime and per-round caps under concurrent mint attempts;
- timestamp boundary behavior;
- owner and Bank signature enforcement;
- authoritative, non-forgeable provenance;
- Core collection membership and update-authority binding;
- exact mainnet artifact behavior, including the Squads authority path;
- upgrades and config migrations without bricking initialized accounts.

The current code does not prove authoritative provenance, exact mainnet-build equivalence, or migration safety.

## UNBREAK

It would need proofs/tests for:

- no direct Core burn can destroy a funded vault;
- open and burn are tied to the same asset, owner, and protocol version;
- CPI wrappers cannot bypass the pairing;
- every supported reserve count fits the selected transaction format;
- every failure before burn leaves the vault sealed and contents recoverable;
- the Bank scan is a mandatory pre-signing condition.

The current design fails the direct-burn property, lacks a complete versioned pairing protocol, has no transaction-size guard, and does not implement the pre-signing scan.

## ROYALTY

It would need:

- immutable or controlled royalty/plugin authority;
- exact creator and destination enforcement;
- validation after every Core/plugin upgrade;
- chain-derived accounting of every royalty, return, and split;
- protection against arbitrary swap transactions;
- an operator wallet that cannot contain or move unrelated customer/project funds.

The current trusted-hop transaction check and split reconciliation are insufficient.

## VOTING

It would need:

- a defined ownership snapshot;
- resistance to atomic vote rental;
- a quorum denominator that matches the eligible electorate;
- recoverability after burns reduce the voting population;
- immutable tally rules per proposal;
- execution ordering and expiry tests;
- a safe governance recovery path if the GOV PDA or upgrade authority fails.

The current system knowingly permits vote rental and uses cumulative issuance as the quorum denominator.

## TRANSFER

It would need:

- rejection of self-PDA and vault-PDA recipients;
- marketplace enforcement of valid owner destinations;
- no transfer path that creates an unredeemable owner;
- tests for transfer, sale, nesting, and recipient poisoning.

The current Core transfer path permits permanent bricking.

## SELL

It would need:

- atomic reserve verification at settlement;
- no outstanding delegate or close authority;
- no undeclared PDA-owned account;
- buyer-visible reserve amount and freshness;
- protection against a drain between quote, purchase, and settlement.

Periodic alarms do not provide those atomic guarantees.

## NESTING AND AIRDROPS

It would need:

- complete token-account enumeration;
- complete DAS/Core asset enumeration;
- pre-signing refusal on any unknown holding;
- behavior for nested assets, airdropped tokens, Token-2022 accounts, malformed accounts, and SOL;
- proof that the control is actually connected to the Bank signer.

The current implementation scans tokens only in a periodic reconcile, does not scan nested Core assets, and does not connect the scan to signing.

## THE INVARIANT

It would need:

- prevention of destructive direct burns;
- an enumerable and enforceable set of all holdings;
- atomic release followed by destruction;
- no partial or stale state;
- no operational race in the payment and alarm pipeline;
- durable, non-forgeable reconciliation records;
- fail-closed behavior on every RPC, DAS, ledger, lock, and notification failure.

The current system has direct destructive burns, incomplete on-chain enumeration, a non-atomic filesystem lock, and an allocation path that continues after incomplete balance reads.