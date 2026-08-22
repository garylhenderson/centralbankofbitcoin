## 1. MINT

### MEDIUM — provenance attributes are not canonical, unique, or semantically validated

**Construct.** A mint caller supplies `attributes: Vec<VaultAttribute>` directly to `mint_vault`. The program limits count and string lengths and reserves only the key `"redemption"`. It does not reject duplicate keys and does not validate charter/notice values against an on-chain issuance record.

A customer and Bank can therefore mint, for example:

```text
("charter", "0042")
("charter", "not-charter")
("notice",  "CBOB-NOTICE-0042")
("notice",  "other")
```

Core will store both. Consumers disagree depending on whether they take the first, last, or all values. The supplied test itself uses `Object.fromEntries`, which silently adopts the last duplicate.

**Gain.** This does not bypass the Bank co-signature. It does mean that “provenance stamped at mint” is not a uniquely interpretable on-chain fact. A Bank mistake, compromised Bank signing process, or downstream parser mismatch can present a vault as charter/non-charter inconsistently.

**Evidence that should exist.** Mint a vault with repeated `charter` and `notice` keys, then query Core/DAS and multiple consumers. The stored attribute list should contain both entries; parsers using map conversion will overwrite one.

**Fix.**
- Reject duplicate keys at mint.
- Define an allowlist/schema for provenance keys that have business consequences.
- If charter standing must be authoritative, bind it to an immutable serial/claim record, not caller-provided free-form strings.

### LOW — the dangling Attributes authority is not reachable in the shown code

No finding for reachable unauthorized attribute mutation.

I checked whether assigning the Attributes plugin authority to the global SEAL PDA creates a callable authority path. In this version, SEAL has no generic CPI dispatcher and its only Core CPI uses fixed `UpdatePluginV1` data for the permanent-freeze plugin. A caller cannot make SEAL sign an arbitrary Attributes update. The capability becomes dangerous again if a future SEAL instruction signs arbitrary or caller-controlled Core data.

The stale `"redemption"` reserved-key rule and stale comments should be removed, but they are not currently a value-moving vulnerability.

---

## 2. UNBREAK

### CRITICAL — the claimed pre-sign completeness control is not implemented, and cannot be made race-free off-chain

**Construct.** A redemption transaction can be:

1. `SEAL::open_for_redemption(asset, owner, bank, ...)`
2. Core `ExecuteV1` sweeps declared reserve accounts
3. `BURN::burn_vault(asset, owner, bank, ..., declared accounts)`

`burn_vault` only examines accounts supplied to it. It cannot enumerate:
- non-canonical SPL accounts owned by the asset-signer PDA;
- nested Core assets owned by that PDA.

The claimed compensating control is that “the Bank must run `getTokenAccountsByOwner` + DAS BEFORE it signs.” The supplied implementation does not implement a Bank redemption-signing service that does that scan immediately before signing the specific redemption transaction. `bank/alarm.mjs --reconcile` is a scheduled daily scan. It is not part of the signing path, does not bind a scan result to a transaction, and does not scan nested Core ownership at all.

`reconcile()` does this:

```js
getTokenAccountsByOwner(p, { programId: TOK })
getTokenAccountsByOwner(p, { programId: TOKEN22 })
```

It never performs a DAS ownership query for Core assets owned by `p`.

**Exact loss construction: nested vault.**

1. Alice owns `OUTER` and `INNER`.
2. Alice transfers `INNER` to `OUTER`’s Core asset-signer PDA.
3. The daily reconcile may run and detect no undeclared token account; it does not enumerate nested Core assets.
4. The Bank signs a nominally clean redemption of `OUTER`.
5. Alice submits:

```text
SEAL open_for_redemption(OUTER, Alice, Bank)
Core ExecuteV1: sweep OUTER's cbBTC ATA
BURN burn_vault(OUTER, Alice, Bank, declared = only reserve ATAs)
```

6. `BURN` cannot see `INNER`; it burns `OUTER`.
7. `INNER` remains owned by the now-unsignable PDA of the burned outer asset. Its reserve is permanently unreachable.

The test explicitly proves this at 9.5/9.6. The alleged off-chain closure is absent for the nested case.

**Exact loss construction: post-scan token airdrop.**

Even if the Bank adds a token-account scan immediately before signing:

1. Bank scans the PDA.
2. An account is created or token is transferred to the PDA after the scan and before transaction execution.
3. The Bank-signed transaction burns the vault without declaring that account.
4. The token account is stranded behind the burned asset signer.

There is no transaction-level read lock over “all accounts owned by this PDA,” and there is no on-chain enumeration primitive to put that check into `burn_vault`.

**Gain.** Destruction of any undeclared holding. For a nested vault, this can destroy access to another vault’s real cbBTC reserve.

**Evidence that should exist.**
- Search `alarm.mjs`: no DAS `getAssetsByOwner`/owner scan exists in `reconcile()`.
- Search the supplied off-chain code: there is no redemption transaction builder/signer that performs scans and binds them to a signed transaction.
- Run section 9.5: it already demonstrates the on-chain half.

**Fix.**
- Do not claim this invariant is closed by the current alarm pipeline.
- Add a Bank signing service that, immediately before signing, performs:
  - `getTokenAccountsByOwner` for classic SPL and Token-2022;
  - DAS/Core ownership enumeration for all assets owned by the asset-signer PDA;
  - validation that every discovered holding is either swept, explicitly resolved, or blocks signing.
- Treat the result as a best-effort operational control, not a proof. It cannot close the scan-to-execution race.
- If the required property is genuinely “no undeclared holding can ever be destroyed,” this architecture cannot meet it while using a burn as the terminal action and Core lacks owner-account enumeration.

### HIGH — the additive reserve list can make redemptions unrepresentable in a legacy transaction

**Construct.** Current measured one-reserve redemption size is 802 bytes in a 1232-byte packet. Every added reserve mint requires at least:
- two additional declared BURN remaining accounts, one for classic SPL ATA derivation and one for Token-2022 ATA derivation;
- sweep/close operations if the vault holds that reserve.

The two additional account keys alone cost 64 bytes per mint in a legacy message when they are new static keys. Seven additions cost 448 bytes:

```text
802 + (7 × 64) = 1250 bytes
```

That already exceeds 1232 bytes before counting the additional transfer/close instruction encoding. Therefore an eight-reserve full redemption cannot fit in the measured legacy transaction shape. The actual legacy maximum is lower than eight and must be measured with the worst-case “every configured reserve exists and must be swept and closed” transaction.

**Gain / impact.** An admin can perform an additive-only `SEAL::update_config(reserve_mints: Some(...))` that leaves previously minted vaults unable to execute the mandatory open+sweep+burn transaction. Since the reserve set cannot be reduced, recovery requires an upgrade/migration or a new redemption mechanism. Customer cbBTC becomes sealed.

**Evidence that should exist.**
- The 802-byte baseline is asserted by test 4.6.
- The BURN loop requires two ATA derivations per configured reserve.
- Build the eight-reserve worst-case transaction and serialize it. It must exceed the legacy packet limit by the account-key lower bound alone.

**Address lookup tables.** A v0 transaction with an ALT can substantially reduce wire size: non-signer accounts, including accounts used by both open and burn, need not occupy 32-byte static-key slots. Shared use by open and burn does not prevent lookup loading. This is a real mitigation, not a reason to ignore the issue. It is not implemented or enforced here, however, and it does not remove runtime account-count/compute constraints. The exact supported reserve maximum must be proven with the actual v0 redemption builder.

**Fix.**
- Do not allow reserve-list additions unless an admission test constructs and simulates the worst-case redemption transaction for all configured reserves.
- Ship and require a v0+ALT redemption client before adding reserve mints beyond the measured legacy limit.
- Reduce dead account pressure: for classic-SPL-only reserve mints, do not require the Token-2022 ATA derivation.
- Better: make the reserve configuration immutable per vault version, rather than retroactively expanding obligations for every existing vault.

### LOW — `burn_vault` HIGH alerts are now routine redemption noise

`detectBurns()` assigns HIGH to every `burn_vault`. Under v5, every legitimate redemption invokes `burn_vault`. This guarantees HIGH findings for normal customer exits.

A detector that fires HIGH for every expected terminal action is not distinguishing an attack from the normal path. Bare Core `BurnV1` should remain CRITICAL. A paired, valid `open -> sweep -> burn_vault` redemption should be INFO/audit-level unless it has a discrepancy: unexpected holdings, abnormal reserve movement, missing paired open, bad transaction composition, or a failed pre-sign scan.

---

## 3. ROYALTY

No direct exploit found in the shown royalty CPI path.

Checked:
- `basis_points <= 1000`;
- add and update paths execute against real Core in tests;
- sole creator is derived `["revenue"]`;
- collection and update authority are pinned;
- `set_collection_royalties` requires both current admin and governance signer.

The remaining operational problem is governance liveness: after MINT governance becomes the GOV PDA, the PDA cannot provide the top-level `Signer` required by `set_collection_royalties`. The documented escape hatch is a timelocked governance rotation. That is an availability/governance design choice, not an immediate royalty redirection bypass.

---

## 4. VOTING

### MEDIUM — no on-chain rule stops issuance during a vote; the stated Bank duty is not implemented by the shown pipeline

The code admits that newly minted vaults can vote during an existing proposal. The `max(snapshot, minted_now)` divisor prevents free quorum reduction, but it does not prevent a party able to obtain Bank co-signatures from minting votes during the voting period. At any quorum below 100%, each new vault contributes one possible YES vote while increasing required turnout by only `quorum_bps / 10,000` of a vote.

The stated countermeasure is: “the Bank must refuse mints while a proposal’s voting window is open.” No shown Bank mint-signing service enforces that. `alarm.mjs` reports `minted_total` and `proposal_count` after the fact. It cannot prevent the mint or reverse the vote.

**Construct.**
1. A proposal opens.
2. A party obtains Bank co-signatures for N mint transactions during the voting period.
3. The party votes the newly minted vaults YES.
4. The increased votes can improve its position despite the increased divisor.

**Gain.** Governance influence beyond the holdings present when the proposal opened.

**Evidence that should exist.** Create a proposal, mint a new vault before `voting_ends_at`, and cast with it. The code has no creation-slot or proposal-window check in `mint_vault` or `cast_vote`.

**Fix.**
- If the business requirement is one-vault-one-vote at proposal opening, this needs a snapshot/escrow/checkpoint design.
- If the design retains live standing, implement the Bank mint refusal in the actual signer service and explicitly label it as an operational policy, not an on-chain voting property.
- Alarm on a mint during any open proposal immediately; a 30-minute polling alarm is not prevention.

---

## 5. TRANSFER

No new direct bypass of the `PermanentFreezeExecute` seal was found.

Checked:
- the freeze plugin gates Execute, not Core asset transfer;
- `open_for_redemption` requires current Core owner plus Bank;
- a wrapper/CPI cannot satisfy the bilateral pairing without genuine top-level counterparts:
  - a CPI-only burn is invisible to SEAL’s forward scan;
  - a CPI-only open is invisible to BURN’s backward scan;
  - one genuine top-level half plus a CPI other half still fails the other program’s top-level scan.

The known transfer-to-own-PDA and transfer-into-another-vault-PDA bricking behavior remains. It is not prevented on-chain and remains a resale/UI risk.

---

## 6. SELL

### HIGH — a buyer cannot derive “this vault still contains its reserve” from the NFT alone, and the current operational monitor is not a transactional sale guarantee

The resale thesis relies on reserve contents, while the NFT is freely transferable. A buyer can inspect the canonical cbBTC ATA at a given slot, but there is no atomic buyer-side settlement condition tying:
- the observed reserve balance,
- the vault transfer,
- absence of undeclared holdings/delegates,
- and the exact asset being purchased.

The v5 burn rewrite removes the old “empty but sellable vault” path, which is important, but it does not turn a secondary sale into an atomic proof-of-reserves transaction.

This is especially material because the off-chain monitor:
- is periodic rather than in the sale transaction;
- does not close undeclared Core nesting;
- cannot prevent a bare Core burn by the owner;
- cannot make a buyer’s pre-purchase balance read stable through a later transaction.

**Construct.**
1. Buyer reads the reserve ATA and sees the expected balance.
2. Seller and buyer settle the NFT transfer through a marketplace or OTC flow.
3. Any event that destroys/drains/bricks the reserve before or after settlement is not prevented by the buyer’s prior read. A bare Core burn remains possible by the owner; undeclared-holding hazards remain unobservable on-chain.

**Fix.**
- Do not market the NFT alone as a cryptographic reserve claim.
- For a marketplace integration, use an atomic sale program that checks the canonical reserve ATA balance and relevant Core state in the same transaction as payment and transfer.
- Even that cannot prove absence of undeclared accounts or nested assets without changing the custody architecture.

---

## 7. NESTING AND AIRDROPS

### CRITICAL — `alarm.mjs --reconcile` does not implement the promised DAS nested-asset scan

This is distinct from the known on-chain completeness gap. The code claims the Bank must scan “`getTokenAccountsByOwner` + DAS” before signing. The actual reconciliation code only scans token accounts:

```js
for (const prog of [TOK, TOKEN22]) {
  await conn.getTokenAccountsByOwner(p, { programId: prog }, 'confirmed')
}
```

`listVaults(collection)` enumerates assets by collection. It does not enumerate Core assets where the vault PDA is owner. There is no DAS `getAssetsByOwner` equivalent call, no owner-field query, and no detector for nested Core assets.

**Construct.**
- Same as the outer/inner construction in the UNBREAK finding.
- Run `node bank/alarm.mjs --reconcile`.
- It will inspect token accounts but cannot produce a nested-asset finding from the shown code.

**Gain.** A nested vault can be orphaned by a Bank-approved outer redemption despite the claimed off-chain protection.

**Fix.**
- Implement and test Core/DAS asset enumeration by owner for every vault asset-signer PDA.
- Reject Bank signing if any owned Core asset exists, whether or not it belongs to the CBOB collection.
- Add a detector and a selftest fixture for a nested asset.
- Do not describe this as implemented until the signer path—not merely a daily reconciliation path—uses it.

### HIGH — no off-chain scan can eliminate the airdrop race

Even a correctly implemented pre-sign scan is not atomic with the burn. A third party can create/fund a PDA-owned token account after the scan and before the transaction lands. The attacker’s own airdropped token may be sacrificed, but this means the stated universal invariant cannot be guaranteed by the proposed scan.

For nested assets, the relevant owner must cooperate in transferring the inner vault, but user mistakes are sufficient to cause irreversible loss. The system has no chain-level rescue once the outer burn succeeds.

**Fix.** This requires a change in custody/recovery architecture, not another detector. If arbitrary holdings must survive, do not make burning the controlling asset the only redemption completion mechanism.

---

## 8. THE INVARIANT

### HIGH — `bank/lock.mjs` still has the stale-lock unlink race and can permit concurrent money jobs

The code comments acknowledge a remaining TOCTOU, but the actual remaining window is not harmless.

**Exact interleaving.**

Assume stale lock `L` is held by dead process token `T0`.

1. Runner A reads `L`, decides it is stale and dead.
2. Runner B reads `L`, decides it is stale and dead.
3. A re-reads `L`, sees `T0`.
4. B re-reads `L`, sees `T0`.
5. A executes `unlinkSync(file)`.
6. A `claim()`s the lock and begins a distribution/revenue/alarm run with fresh token `TA`.
7. B executes `unlinkSync(file)`, deleting A’s fresh lock.
8. B `claim()`s the path with token `TB`.
9. A and B both execute the protected operation.

The “re-read and compare token immediately before unlink” does not make compare-and-unlink atomic. It only narrows the interval.

For `distribute.mjs`, this can load two in-memory ledger copies and permit concurrent transfers. The entire lock exists to prevent exactly that double-payment class.

**Evidence that should exist.** This needs a two-process test, not the existing single-process seam. Coordinate two children so both complete the confirming read before either unlink; allow A to unlink+claim; then release B to unlink+claim. Both will receive `{ok: true}` under this implementation.

**Fix.**
- Use a kernel-managed advisory lock held on an open FD (`flock`/`fcntl` lock) for the lifetime of the process.
- Do not implement stale breaking by unlinking a pathname while a process may still be operating.
- If an operator must recover from a dead process, use explicit operator intervention after verifying the holder; do not convert “age” into permission to replace a lock.
- For a distributed/multi-host future, use a proper lease protocol with fencing tokens and make every ledger write validate the fence.

### MEDIUM — “everything stays in the vault” is not an on-chain invariant because arbitrary assets can enter without the vault’s cooperation

Any party can:
- transfer SPL tokens into a PDA-owned account;
- create a noncanonical token account controlled by that PDA through paths not visible to the four programs;
- send SOL to the PDA;
- in applicable owner-controlled cases, nest Core assets.

The programs prove only:
- configured reserve ATAs, when presented, are empty;
- declared token/Core accounts are checked;
- PDA lamports are zero.

They do not prove completeness. This is already partly acknowledged, but it is incompatible with a literal 100% invariant. The off-chain scan reduces operational risk; it does not transform it into a chain guarantee.

---

# Pairing and introspection answers

### a) Can a vault thaw and not burn through CPI, wrappers, ALTs, nonce, or rollback behavior?

I found no construction from the shown programs that leaves a successful thaw without a successful matching top-level `burn_vault` in the same committed transaction.

- An ALT changes address encoding, not the instruction sysvar’s top-level instruction view.
- A durable nonce does not split transaction atomicity.
- A later burn failure reverts the entire transaction, including the prior Core plugin update made by `open_for_redemption`.
- A burn hidden in CPI cannot satisfy SEAL’s top-level scan.
- An open hidden in CPI cannot satisfy BURN’s top-level scan.
- A wrapper with one genuine top-level counterpart still fails the opposite program’s scan.

This conclusion depends on Solana transaction atomicity and the current exact program behavior; it is not a proof against a future upgrade with changed semantics.

### b) Can a burn pair to another vault’s thaw?

Not under the current handlers.

Both sides bind:
- account 0 as the asset; and
- account 2 as owner.

More importantly, both actual handlers independently parse the Core asset and require its live owner to equal their `owner` signer. An unrelated asset/owner pair cannot pass those checks merely by appearing at selected positions in the other instruction.

### c) Does account-order drift fail closed?

For an accidental account insertion/reorder in a future BURN or SEAL version while current ownership checks remain intact, the likely result is denial of service: the positional comparison no longer sees the expected owner and redemption halts sealed.

That is not a universal “fails closed” property of upgrades. An upgrade authority can change:
- account validation,
- owner semantics,
- the meaning of the instruction discriminator,
- or the burn logic itself.

The hardcoded discriminator/account-index coupling is a fragile compatibility contract, not a security boundary against the upgraded program. A future upgrade must be treated as a complete re-audit of both sides and their transaction-builder tests.

### d) Is top-level-only instruction introspection load-bearing in both directions?

Yes, for the current bilateral pairing design. It prevents CPI-only counterparts from satisfying either scan. The wrapper argument is sound because each side requires a genuine top-level counterpart that the other side will also recognize.

### e) Does reserve expansion strand vaults? Does ALT rescue it?

Yes, eight configured reserves cannot fit in the measured legacy shape. The 64-byte-per-added-mint static-account lower bound alone pushes `802` to `1250` bytes at eight reserves, before added sweep instructions.

An ALT can materially rescue wire size because non-signers can be lookup-loaded even when used by both open and burn. It is not currently a deployed requirement, and the exact maximum must be measured using the real worst-case v0 transaction, not inferred from a one-reserve test.

### f) Does requiring a preceding open create a new destruction strand?

For an empty vault, an owner can still bare-burn through Core, so destruction is not technically unavailable. For a vault with contents, requiring SEAL thaw is necessarily an additional availability dependency: a SEAL/Core plugin incompatibility, Bank loss, frozen config wiring, or transaction-capacity failure now blocks the only safe redemption path. That is an intentional consequence of making burn terminal, but it is still a real liveness dependency and must be tested as an upgrade/recovery scenario.

---

# WHAT A 100% CLAIM WOULD HAVE TO SURVIVE

### MINT
- Unique, canonical, verifiable provenance rather than duplicate caller strings.
- A Bank signing implementation that enforces charter eligibility and vote-period mint policy before signing.
- A frozen, tested production build with the actual production authority configuration.

### UNBREAK
- Worst-case redemption transactions for every supported reserve count and holding combination.
- v0+ALT construction, simulation, and account/compute-limit testing where legacy packets do not fit.
- Upgrade compatibility tests proving both instruction-pairing contracts remain aligned.
- A clear statement that undeclared holdings cannot be proven absent on-chain.

### ROYALTY
- Collection plugin state monitoring and an exercised governance route for legitimate royalty changes after governance becomes a PDA.
- Marketplace behavior tests; Core plugin installation alone does not prove marketplaces honor royalties.

### VOTING
- A decision whether votes are live, snapshot-based, or intentionally rentable.
- If issuance during voting is prohibited, an actual enforcing signer service or an on-chain snapshot mechanism.
- Governance liveness after burned supply reduces the voter population.

### TRANSFER
- Explicit buyer and UI handling for transfers to irrecoverable PDA owners.
- Acknowledgment that transferability and an unpreventable owner bare burn cannot both yield a fully trustless reserve guarantee.

### SELL
- Atomic buyer-side proof of canonical reserve balance at settlement.
- A statement that no such settlement can prove absence of undeclared token accounts or nested Core assets under this architecture.

### NESTING AND AIRDROPS
- A real signer-path scan for both token accounts and Core assets owned by every asset-signer PDA.
- Tests proving nested-asset detection fires.
- Recognition that off-chain scans cannot eliminate post-scan airdrop races.
- If “nothing is ever destroyed unseen” is mandatory, a different custody model.

### THE INVARIANT
- A lock implementation with actual lifetime ownership, not stale-path unlinking.
- Crash recovery with fencing, durable journals, and reconciliation that does not permit concurrent writers.
- A narrower claim: configured and declared holdings are checked; arbitrary PDA-owned holdings are not chain-enumerable.
- Removal of the literal “everything stays in the vault 100% of the time” claim unless the system ceases to rely on an unenforceable completeness assumption.