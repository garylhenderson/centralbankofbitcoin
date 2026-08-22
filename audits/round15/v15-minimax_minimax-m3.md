[reasoning only]
Let me work through this systematically. This is round 15 of an AI audit of a Solana program suite for CBOB vaults. I need to be thorough and skeptical. Let me read carefully and identify real issues.

The prompt is asking me to audit:
- R1: bank/cosign.mjs - new co-signer for redemptions
- R2: bank/lock.mjs - rewritten atomic break
- R3: Other repairs (applyAcks, unredeemable_owner, REDEMPTION_NOISE, validate-core-gate.sh, FLOOR, MAX_RESERVE_MINTS=3)
- R4: Comments claiming controls that don't run (or denying ones that do)

Plus the carry-over list, and verdict challenges.

Let me think carefully about each target. I need to find REAL bugs, not imagined ones. The author has been honest about many issues. Let me look for what might still be wrong.

Starting with R1: bank/cosign.mjs

The cosign.mjs file inspects a base64 transaction. Let me trace what a customer can put in:

1. The transaction can include any number of instructions
2. The judgeRedemptionTx function:
   - Requires exactly one open_for_redemption AND exactly one burn_vault
   - Checks order (open must come before burn)
   - Checks asset/owner binding between the two
   - Checks Bank in both
   - Checks owner is on-curve
   - Checks no extra SEAL/BURN instructions
   - Checks declared count matches accounts carried

What can a redeeming customer add?
- Compute budget instructions (set compute unit price/limit)
- ATA program instructions (Create ATA for a reserve mint) - already covered as operational requirement
- System program transfer (lamport movement, fee payer)
- Address Lookup Table extensions (but versioned tx has a different instruction format)
- Memo program instructions
- Other program instructions (token transfer, etc)
- The fee payer can be anyone

The judge iterates over top-level instructions. The Transaction.from() returns a Transaction object - I should check whether this is legacy or versioned. 

Looking at the code: `Transaction.from(Buffer.from(b64, 'base64'))` - this constructs a `Transaction` object, which is legacy format. Versioned transactions are constructed with `VersionedTransaction.deserialize()`. So a versioned transaction with ALT lookup addresses won't deserialize here at all - it would throw.

That's actually significant: A versioned transaction using ALT addresses would crash the inspector. But the cosign is only running inspect-only by default, and --live signs... Hmm, but if `Transaction.from()` throws, the process exits, no signature is added. So this is fail-closed but loses the pre-sign refusal entirely.

Wait - but the inspection fails with an error. The code throws, the customer gets nothing, the Bank signature is not added. That's fail-closed in a sense. But the customer can craft a v0 transaction that's versioned! Then the cosign.mjs refuses with a crash. The program-pairing might still fail in the on-chain code if the versioned transaction is rejected. So this is probably OK.

But here's a more subtle issue: a customer could put OTHER top-level instructions to other programs in the transaction:
- An instruction to the SPL token program to create a token account for a PDA
- An instruction to a Jupiter program
- An instruction to System program
- Any compute budget instruction

The judge only checks that there's no EXTRA instruction to SEAL or BURN. So a customer could include any number of other-program instructions.

What could a malicious customer do?
- The burn must declare every account that holds value. If a customer adds a CreateATA for some weird mint and deposits tokens there, they'd need to declare it. They can declare it because they put it there.
- The customer could create another token account at an unusual address (not the canonical ATA) for the asset-signer PDA, deposit tokens, declare it, and burn. That's allowed.
- The customer could also include instructions that interact with THIRD PARTY programs that affect the PDA's state. For instance, could a customer call some DeFi program that interacts with the vault's tokens? Those tokens would need to be declared, but if they're declared...

Wait, the judge doesn't check WHAT the other instructions do. It only counts opens and burns. So a customer could:
1. Create an ATA for some random mint on the PDA
2. Mint tokens to that ATA (if they own the mint) - but they can't mint to a PDA's account without owning the mint
3. Actually... only the mint authority can mint. So a customer can't put arbitrary tokens in a PDA's account unless they own the mint.

What the customer CAN do:
- Create ATAs on the PDA for various mints they own - but the burn only checks for declared accounts
- Actually the judge only checks declarations of accounts in the burn, not whether there are undeclared accounts the customer CREATES.

Here's a problem: The judge says "every holding this scan can see is declared in the burn". The scan reads what the PDA owns via getTokenAccountsByOwner. If a customer creates a new token account for the PDA during the redemption transaction (between scan and burn), that holding is undeclared and gets destroyed.

But wait - this is the airdrop race. The airdrop can happen between scan and burn. The customer can't really exploit this because:
1. If customer creates an account on the PDA, the BURN would need that account declared for the customer's redemption to succeed (because the burn refuses on any balance it sees including in remaining_accounts)
3. Actually wait - if customer creates a token account with 0 balance for the PDA, declares it, then later in the same tx transfers tokens into it... no, the burn refuses on non-zero balance.

Let me think again. The customer is redeeming. they want to redeem cleanly. Can they sabotage their own redemption in a way that benefits an attacker?

Actually, let me look at the REDEMPTION_NOISE allowlist more carefully:

```javascript
const REDEMPTION_NOISE = {
  vault_burned: a => ...,
  vault_vanished: a => ...,
  deactivated: a => ...,
  reserve_fell: a => ...,
}
```

So `correlateBurns` looks at `f.asset && viaProgram.has(f.asset) && REDEMPTION_NOISE[f.kind]` to decide if a finding should be downgraded.

But the viaProgram set is built from `burn_via_program` findings with assets. A `burn_via_program` finding is INFO, so it's added to seenInfo and reported ONCE.

The downgrade happens for findings of those kinds where f.asset matches an asset that has a burn_via_program for it.

What if a malicious actor does a BARE burn (via Core's BurnV1) of asset A, in a transaction that's NOT scanned? The DAS diff picks up that vault is gone. A vault_burned finding fires CRITICAL.

But this doesn't get correlated with a burn_via_program (because there isn't one). So it stays CRITICAL. That's correct.

What if a malicious actor does Core's BurnV1 of asset A in a transaction that ALSO invokes burn_vault for asset B (a legitimate-looking redemption of B)? Then:
- The transaction is scanned because it touches burn (via burn_vault)
- A burn_via_program finding fires for asset B
- The DAS diff sees A and B both gone
- vault_burned fires for A and B
- For B: correlated, downgraded to INFO ✓
- For A: correlated (because viaProgram has A in the set via the burn_vault of B)... NO! viaProgram only contains B. So A is NOT correlated.

Wait, let me re-read. viaProgram is `new Set()` of assets from `burn_via_program` findings. Each `burn_via_program` finding has `f.asset` set to the asset. So viaProgram contains B (the asset in the legitimate burn_vault). A is not in viaProgram. So vault_burned for A stays CRITICAL.

Hmm. But what if the attacker does TWO bare burns: A and B. They craft a transaction that includes burn_vault for B (a real redemption). Hmm, they can't do that without owning B and being its owner.

Actually, what about this: 
- Attacker does a BARE burn of A in a transaction that's NOT seen
- Same transaction includes burn_vault of A for some legitimate path
- Wait, they can't, because they don't own A

OK let me re-examine. A BARE Core BurnV1 requires the OWNER's signature. So only the owner can do it. If the owner does a bare burn of A, the scan sees... well, Core isn't scanned. So the scan doesn't see the bare burn.

But the DAS diff DOES see A's removal from the live set, and the index sees a burnt flag.

For the correlation: vault_burned for A is produced. viaProgram only has assets that have burn_via_program findings. If A was bare-burned with NO burn_vault at all, there's no burn_via_program for A. So viaProgram doesn't contain A. vault_burned for A stays CRITICAL. ✓

What if the bare burn happens in a transaction that ALSO contains a burn_vault of B (legit)? Then viaProgram has B. vault_burned for A still doesn't correlate. ✓

OK the correlation looks correct for this case. Let me check the allowlist itself.

The REDEMPTION_NOISE allowlist includes:
- vault_burned
- vault_vanished
- deactivated
- reserve_fell

And the rejected ones:
- approve_by_vault_pda
- nested_vault
- undeclared_token_account
- vault_left_index

The test "a burn does NOT quiet X on the same asset" tests X in [approve_by_vault_pda, nested_vault, undeclared_token_account, vault_left_index].

But wait - what about OTHER finding kinds that might be relevant? Like... is there a "non_ata_token_account" finding? Looking at the code... no, there's "reserve_ata_created" (INFO) and "non_ata_token_account" (CRITICAL). And there's "scan_gap", "tx_unreadable", "watchdog_gap", etc.

Hmm, but those are not asset-specific. The allowlist is keyed by f.asset.

What about "vault_unreadable"? Looking at detectDeactivations, that's HIGH severity with `asset` set. If a vault was unreadable in the previous pass (couldn't read balance), and then redemption happens, the burn completes - but the vault was unreadable so a vault_unreadable finding fired. Now the redemption happens, and... vault_unreadable is not in REDEMPTION_NOISE! So it stays at HIGH.

Actually wait, can a vault be "unreadable" if it's being redeemed? In the redemption, the redeemer's transaction calls `burn_vault`. The PDA's lamports become zero after sweep. The vault's existence... hmm, this is getting complicated.

Let me look at detectDeactivations again:
```javascript
for (const [asset, wasActive] of Object.entries(prev || {})) {
    if (!wasActive) continue
    if (unread.has(asset)) continue
    const bal = current[asset]
    if (bal === undefined) {
      out.push({ kind: 'vault_vanished', severity: S.CRITICAL, asset, ... })
      continue
    }
    if (BigInt(bal) < ACTIVATION_SATS) {
      out.push({ kind: 'deactivated', severity: S.HIGH, asset, ... })
    }
  }
```

So `vault_vanished` fires when the balance is undefined. That's only possible if the vault is no longer in the activation map. With the reconcile, every live vault has its balance read (or in unread[]). If a vault is gone from the live set, it's not in the activation map.

Hmm, but a vault that has been burnt would no longer be in the live set, so it wouldn't have a balance key, so it would be removed from `prev`. Actually, `prev.activation` is for the *previous* pass's activations. The current pass's activations are computed in this pass.

Actually, looking more carefully:
```javascript
const activation = {}, balances = {}, unreadable = []
for (const v of vaults) {
    // ... read balance, set activation[v] = ...
}
findings.push(...D.detectDeactivations(prev?.activation, balances, unreadable))
```

`prev?.activation` is from the previous state. `balances` is the current pass's balances (only for vaults currently in the live set). `unreadable` is for vaults whose balance couldn't be read THIS pass.

So detectDeactivations fires:
- vault_unreadable: from unread array
- vault_vanished: a vault in prev.activation with truthy activation but NOT in current balances
- deactivated: a vault in prev.activation with truthy activation, in current balances, but below activation

vault_vanished fires when a vault was previously activated but is NOT in current balances. That includes:
- The vault was burnt (no longer in DAS)
- The vault was redeemed (should be in DAS but burnt)
- The vault was transferred out of the collection (no longer in our live set)
- The vault is still in DAS but somehow no balance was recorded

Actually, the prev.activation only contains vaults that were activated. After redemption+burn, a vault is no longer in `vaults` (the live list). So `balances[v]` doesn't exist for burnt vaults. Hence vault_vanished.

So both vault_burned and vault_vanished fire on the same redemption. Both are in REDEMPTION_NOISE. ✓

deactivated: a vault that's still in current balances (so still live) but below activation. This could happen with index lag - DAS is slow to remove the burnt vault from live. So it sees balance 0, which is below 21000. The asset has been redeemed but DAS hasn't updated yet. Both `deactivated` and `reserve_fell` could fire.

But wait - if DAS lagged, the vault's reserve token account was closed by the redemption. So `balances[v]` = 0. And prev.activation[v] = true. So `deactivated` fires.

In that case, does the burn_vault show up? It depends on whether the burn transaction was scanned. If signature walk catches it, burn_via_program fires. If DAS lags, then the vault is still in the live set when we scan DAS. So we see it as "deactivated" with balance 0.

This is good - deactivated is in REDEMPTION_NOISE for the same asset, so it gets downgraded to INFO.

OK let me look at the redact logic again:
```javascript
if (f.asset && viaProgram.has(f.asset) && REDEMPTION_NOISE[f.kind]) {
```

What about findings that DON'T have f.asset? They get passed through.

What about findings WITH f.asset but a kind NOT in REDEMPTION_NOISE? They stay loud.

What about an asset that has both a legitimate burn_vault AND a vault that's been tampered with? Like:
- Legitimate burn_vault of A
- Same vault A also has an undeclared_token_account

Then viaProgram has A. The undeclared_token_account finding for A would not be in REDEMPTION_NOISE. It stays CRITICAL. ✓

Wait, but undeclared_token_account is in the allowlist REJECTED set:
```javascript
for (const k of ['approve_by_vault_pda', 'nested_vault', 'undeclared_token_account', 'vault_left_index']) {
    t(`a burn does NOT quiet ${k} on the same asset`,
      sev(D.correlateBurns([{ kind: k, severity: 'CRITICAL', asset: A, detail: 'x' }, via(A)]), k, A), 'CRITICAL')
  }
```

OK so undeclared_token_account would stay CRITICAL. But wait - if the burn_vault refuses undeclared token accounts in the burn, how could an undeclared token account get to a burn? The burn refuses! So undeclared_token_account wouldn't fire for a successfully redeemed vault - the burn would have refused. Unless...

Hmm, actually, undeclared_token_account could fire from the reconcile, which is daily. So in the same pass as a redemption, the reconcile might find an undeclared token account on a vault that's being redeemed. Hmm, but the reconcile is daily, the alarm is every 30 min. So they're separate passes.

Actually, looking at the alarm, the daily reconcile generates findings via detectUndeclaredTokenAccounts. The alarm then... wait, the reconcile's findings are reported but the daily CRITICAL state is set. But the alarm pass every 30 min would not see this until next reconcile.

OK, let me move on. Let me look at the actual cosign.mjs shape judgement carefully.

The judge iterates over top-level instructions:
```javascript
const opens = ixs.filter(ix => ix.programId === cfg.sealProgram && has(ix, cfg.openDisc))
const burns = ixs.filter(ix => ix.programId === cfg.burnProgram && has(ix, cfg.burnDisc))
```

This uses programId (string) and discriminator match. OK.

```javascript
const open = opens[0], burn = burns[0]
if (ixs.indexOf(open) > ixs.indexOf(burn)) bad.push('burn_vault appears BEFORE open_for_redemption')
```

OK - indexOf works on the ixs array, which has order.

```javascript
const asset = open.accounts?.[0] ?? null
const owner = open.accounts?.[2] ?? null
if (!asset || !owner) bad.push('open_for_redemption is missing its asset or owner account')
if (asset && burn.accounts?.[0] !== asset) bad.push(...)
if (owner && burn.accounts?.[2] !== owner) bad.push(...)
```

Wait. `open.accounts?.[2]` is the OWNER. But looking at the SEAL program's `OpenForRedemption`:
```
pub vault_asset: UncheckedAccount<'info>,  // 0
pub collection: UncheckedAccount<'info>,    // 1
pub owner: Signer<'info>,                  // 2
pub bank: Signer<'info>,                   // 3
pub payer: Signer<'info>,                  // 4
...
```

So open.accounts[2] is the owner. ✓

For burn:
```
pub vault_asset: UncheckedAccount<'info>,  // 0
pub collection: UncheckedAccount<'info>,    // 1
pub owner: Signer<'info>,                  // 2
pub bank: Signer<'info>,                   // 3
pub asset_signer: UncheckedAccount<'info>,  // 4
pub payer: Signer<'info>,                  // 5
...
```

So burn.accounts[2] is the owner. ✓ And burn.accounts[0] is the asset. ✓

OK so asset and owner binding look right.

```javascript
if (open.accounts?.[3] !== cfg.bank) bad.push(`open_for_redemption names ${open.accounts?.[3]} as the Bank, not ${cfg.bank}`)
if (burn.accounts?.[3] !== cfg.bank) bad.push(`burn_vault names ${burn.accounts?.[3]} as the Bank, not ${cfg.bank}`)
```

open.accounts[3] is the Bank. burn.accounts[3] is the Bank. ✓

```javascript
if (owner) {
    let ok
    try { ok = isOnCurve(owner) } catch { ok = null }
    if (ok === false) bad.push(`the owner ${owner} is OFF-CURVE ...`)
}
```

OK.

```javascript
for (const ix of ixs) {
    if (ix === open || ix === burn) continue
    if (ix.programId === cfg.sealProgram || ix.programId === cfg.burnProgram) {
      bad.push(`an extra instruction to ${ix.programId} is in this transaction and is not part of the pair`)
    }
}
```

OK.

```javascript
const declared = (burn.accounts || []).slice(cfg.burnFixedAccounts)
const stated = burn.data?.[cfg.burnDisc.length]
if (stated !== declared.length) {
    bad.push(`burn_vault states ${stated} declared accounts but carries ${declared.length}`)
}
```

OK. burnFixedAccounts = 11 (matches BURN_FIXED_ACCOUNTS).

Wait, but the order check. `if (ixs.indexOf(open) > ixs.indexOf(burn))`. This relies on `ixs.indexOf(open)` working. `open = opens[0]` and `opens = ixs.filter(...)`. So `open` is a reference to an element in `ixs`. `ixs.indexOf(open)` should find it. ✓

But wait - the original ixs is built from `tx.instructions.map(ix => ({...}))`. So `opens[0]` is a NEW object, not the original. `ixs.indexOf(opens[0])` would NOT find the original ix, because they're different references! This is a bug!

Let me double-check. Looking at inspect:
```javascript
const tx = Transaction.from(Buffer.from(b64, 'base64'))
const ixs = tx.instructions.map(ix => ({
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map(k => k.pubkey.toBase58()),
    data: [...ix.data],
  }))
```

Then in judgeRedemptionTx:
```javascript
const opens = ixs.filter(ix => ix.programId === cfg.sealProgram && has(ix, cfg.openDisc))
const burns = ixs.filter(ix => ix.programId === cfg.burnProgram && has(ix, cfg.burnDisc))
```

`opens[0]` is one of the elements of `ixs`, since filter preserves references. So `ixs.indexOf(opens[0])` should work. ✓

OK that works.

Now let me think about the actual transaction. The customer composes a Transaction object. `Transaction.from()` deserializes it. Then we map to plain objects. The serialization uses web3.js's transaction format.

A customer can include ANY instructions. The judge only cares about:
1. Exactly one open_for_redemption
2. Exactly one burn_vault
3. Bank signed in both (judge doesn't verify signature, just compares account address)
4. Owner signed (judge doesn't verify signature, just checks on-curve)
5. No other SEAL or BURN instructions
6. Declared count matches accounts

But wait - the judge checks `owner is on-curve`, but doesn't check that owner is actually a signer! That's a CRITICAL bug. The seal program's open_for_redemption requires `owner: Signer<'info>` AND `bank: Signer<'info>`. If a customer just NAMES those accounts as if they were signers but doesn't have their actual signatures, the transaction would fail on-chain. But the cosign tool would bless it.

Actually wait - the cosign tool's job is to add the BANK's signature. The customer's transaction already has the owner's signature (the owner is the customer's wallet, presumably). So owner signature is provided by the customer. The Bank adds its own.

But what if the customer crafts a transaction where:
- owner account is named in the right position
- BUT owner didn't actually sign
- The transaction still gets the Bank's signature

Then on-chain, the transaction would fail because owner: Signer<'info> requires owner to have signed. But the cosign tool still added the Bank's signature to a broken transaction.

The fix: the cosign tool should check that the owner is a signer in the transaction. But how do you check that? You'd need to inspect the actual signatures on the transaction.

Actually, looking at `tx.serialize({ requireAllSignatures: false })` - this serializes with all signatures that exist. If owner didn't sign, owner would not be in the signature set. To check, you'd compare the required signer count to actual signatures.

Hmm, actually I realize a subtle issue. The seal program checks `owner: Signer<'info>`. This is enforced by Anchor. So if owner didn't sign, Anchor rejects with AccountNotSigner.

But the cosign tool doesn't check that. It only checks that owner is on-curve. So if a customer submits a transaction where owner is on-curve but didn't sign, cosign blesses it, the on-chain fails with AccountNotSigner, the burn doesn't happen, but the Bank has now blessed a redemption. The customer's UX is "rejected" but they could craft a fresh one.

Actually, the more concerning thing: a customer could BLAME the Bank for the rejection. "I gave you a proper redemption and you signed it" - but actually, the customer's transaction was malformed. Not a fund-loss issue.

OK so this isn't a CRITICAL, but it IS a weakness. The cosign should check signatures. Let me note it.

Actually wait - the Bank signature is meant to be a proof that "the Bank saw this transaction and approved". If a transaction later fails on-chain for a different reason (no owner signature), the Bank's signature is not a security issue - it just means the Bank didn't catch that the owner's signature was missing.

But the Bank's signature is for redemption. If the Bank signs a transaction where the owner wasn't a real signer... hmm, well, on-chain it would fail. So no actual loss of funds.

Let me look for a more critical issue. What about fee payer? A customer can set any fee payer. If they set it to the BANK's pubkey (without the Bank's signature), the Bank's signature on the rest of the transaction would still be honored. The fee payer pays SOL, not the Bank.

What if fee payer is set to some other account? The Bank's lamports don't go down. OK.

What about the addresses the Bank looks at? The judge reads SEAL config from the chain to get the Bank pubkey. The seal config is at PDA [config] of SEAL program. The Bank reads this and uses it as cfg.bank.

What if the seal config has been rotated? The Bank reads from chain, so it gets the latest. ✓

But here's a thing: the cosign only compares Bank pubkey. It doesn't verify that the SEAL config account is actually owned by SEAL. If a customer constructs a fake seal config... no, they can't, it's a PDA.

What if the seal config was DELETED? The judge checks `if (!acc) throw`. So that throws. ✓

What if the seal config was MALFORMED? `pinnedAccountData` throws. ✓

OK so the Bank reading is fine.

Now let me think about REDEMPTION_NOISE more carefully. The verdict challenge mentioned this:

> The REDEMPTION_NOISE allowlist in correlateBurns: four finding kinds are downgraded when a burn_vault for the same asset was seen. Is the allowlist too wide? Can a bare Core BurnV1, an approve by the vault's PDA, a nested vault or an undeclared account be laundered into INFO?

So the question is whether an attacker could launder these into INFO. Let me think...

The viaProgram set has ASSETS that have a burn_via_program. So for a finding to be downgraded, f.asset must equal the asset of an observed burn_vault.

What if the attacker does:
- Transaction T1: Core BurnV1 of vault A (bare burn)
- Same transaction: NOTHING ELSE
- This is not scanned because Core isn't in the scan list. But DAS still picks up A as gone.

In T2, the attacker could do:
- Burn_vault of A - but they don't own A, so they can't sign as owner.
- Actually the attacker can NEVER do burn_vault of A because they don't own A.

So the only way to get a burn_via_program for asset A is for A's owner to do a legitimate burn_vault of A. The attacker cannot manufacture burn_via_program for A.

So the laundering risk is: an attacker tricks the legitimate owner of A into doing burn_vault of A, then the attacker's bare burn of A (somehow) is laundered. But wait, the attacker can't do a bare burn of A without owning A.

Hmm, this is actually well-protected. Let me check the test:

```javascript
t('a bare burn is NOT laundered by an unrelated redemption in the same pass',
    sev(D.correlateBurns([gone(A), via(A), gone(B)]), 'vault_burned', B), 'CRITICAL')
```

This tests that a bare burn of B is not laundered by a burn_vault of A. ✓

What about: same asset, multiple burns? Like:
- Burn_vault of A (legit)
- Bare Core BurnV1 of A (also happens)

Wait, after burn_vault of A, the asset is burned. So a second burn would fail (asset is gone). So an attacker can't double-burn.

What about a single transaction with burn_vault AND a Core BurnV1 of the SAME asset? They'd be in the same TX. The signature walk catches burn_vault (because it touches burn program). The burn_vault's first instruction finds the matching open_for_redemption. Then the Core BurnV1 fires - but Core isn't scanned.

The DAS diff sees A as gone. vault_burned fires for A. burn_via_program for A (from burn_vault). So vault_burned for A is correlated and downgraded to INFO.

But there was also a bare Core BurnV1 of A! That wasn't seen, but it doesn't matter because Core BurnV1 doesn't add anything - the burn_vault already burned A. So downgrading to INFO is correct.

What about an approve by vault's PDA? Can a burn_vault and an approve happen in the same transaction?

Looking at the burn_vault: it does Core's BurnV1 at the end. After that, the asset is burned. There's no opportunity for further owner-signed operations on that asset.

But the OWNER's PDA can have operations on its token accounts BEFORE the burn. The burn checks remaining_accounts for the declared accounts. So if the owner approved a delegate on a token account BEFORE the burn, but that account is then declared, the burn would... hmm let me look.

Actually, the reserve loop:
```rust
let d = acc.try_borrow_data()?;
if d.len() < TOKEN_ACCOUNT_LEN { continue; }
let mut o = [0u8; 32]; o.copy_from_slice(&d[32..64]);
require_keys_eq!(Pubkey::new_from_array(o), pda, BurnError::ReserveNotOurs);
require!(d[72..76] == [0,0,0,0], BurnError::ReserveDelegated);
```

So the burn refuses if the declared reserve token account has a delegate (d[72..76] is COption tag).

But what about the NON-reserve token accounts on the PDA? They're checked in the OTHER loop:
```rust
for acc in ctx.remaining_accounts.iter() {
    if acc.owner == &MPL_CORE_ID { ... continue; }
    if acc.lamports() == 0 { continue; }
    if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
    let d = acc.try_borrow_data()?;
    if d.len >= TOKEN_ACCOUNT_LEN {
        let mut o = [0u8; 32]; o.copy_from_slice(&d[32..64]);
        if Pubkey::new_from_array(o) == pda {
            require!(d.len == TOKEN_ACCOUNT_LEN, BurnError::ReserveHasExtensions);
            require!(d[72..76] == [0,0,0,0], BurnError::ReserveDelegated);
            ...
        }
    }
}
```

So a non-reserve token account on the PDA can have a delegate, and it would be checked but with `ReserveDelegated` error. The burn would refuse.

What about an approve inside the redemption transaction, on a token account NOT declared? The burn wouldn't see it. The PDA could have an approve set on it, but the burn would still try to burn the asset.

Wait - here's a thought. If the owner approves a delegate on a token account, then the redemption happens (sweep, burn). The sweep empties the account. The burn destroys the asset. Now the token account has 0 balance and a delegate. The delegate could later close the account or transfer tokens... but there's nothing to transfer because the account is empty.

Hmm, but if the account is empty, the delegate can't do anything. But what about the closing? A delegate CAN close an empty account and receive the rent. The rent goes back to whoever - actually I need to check SPL token semantics. With a delegate set, the owner can't close the account. Only the delegate or a designated close authority.

So if owner approves delegate, owner can't close. The delegate can close. Delegate receives the rent (which is small, ~0.0014 SOL).

That's not a fund loss. But the delegate could keep the account alive, then later... no, if it's empty, there's nothing to do.

Hmm OK, the test 3.3 (close-ATA delegate ALLOW) tests exactly this. Approved delegate, then sweep+close, then burn. The sweep+close empties and closes the account. The burn sees no token account to check. So the burn proceeds. ✓

OK I think the REDEMPTION_NOISE is well-bounded.

Now let me look at the validate-core-gate.sh change. The previous version couldn't fail. The new version uses `must_fire` and `must_pass` with `die` on incorrect results. That looks right.

But wait - the new gate validator shares CACHE with run-tests.sh. That's good. The validator boot/death is the same.

Hmm, one issue: `must_fire` calls `gate "$1"`. `gate` calls `solana program dump`. If solana is not in PATH, this would fail differently. Let me check... `export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"` is at the top. ✓

Actually, here's a subtle issue with the gate: when running validate-core-gate.sh ARM 2 (tampered bytes), the script boots with `--bpf-program CORE core-mainnet.so`, then dumps the on-chain Core to a different file (g-onchain.so), then tampers (modifies core-mainnet.so to g-tampered.so), then runs gate(g-tampered.so). Gate compares g-onchain.so to g-tampered.so. g-onchain.so is from mainnet (untampered). g-tampered.so is from the cache (tampered). So they differ, gate fires. ✓

But wait - when booting with --bpf-program, does it modify the cache file? Let me think. --bpf-program tells the validator to load CORE from that file. The validator doesn't write back to the file. The dump (`solana program dump`) reads from the validator's loaded program. So g-onchain.so is the on-chain Core. Tampering core-mainnet.so doesn't affect what the validator has loaded. ✓

OK, the gate seems right.

Now let me think about MAX_RESERVE_MINTS = 3 and the harness. The harness was rewritten to include:
1. The lamport sweep (1 lamport from PDA to alice)
2. Both ATA derivations declared
3. Optional: destination ATA creation

For 3 mints, the size is 1119 bytes. The literal pinned. ✓

The test 9.14a pins 1119. If anything changes, this turns red. ✓

OK now let me think about the LOCK. The lock was rewritten with rename being atomic. Let me trace through this carefully.

```javascript
const stolen = `${file}.breaking.${token}`
_beforeSteal?.()
try { fs.renameSync(file, stolen) }
catch (e) {
    if (e.code === 'ENOENT') return { ok: false, broke: null, held, ageMs: age, lostRace: true }
    throw e
}
_afterUnlink?.()
let takenToken = null
try { takenToken = JSON.parse(fs.readFileSync(stolen, 'utf8'))?.token ?? null } catch { /* unreadable */ }
if (takenToken !== held.token) {
    // Put it back, but with an EXCLUSIVE create, never a rename
    try {
        const bytes = fs.readFileSync(stolen)
        const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, bytes); fs.closeSync(fd)
    } catch { /* somebody already holds it; theirs stands */ }
    try { fs.unlinkSync(stolen) } catch { /* nothing to clean */ }
    return { ok: false, broke: null, held, ageMs: age, lostRace: true }
}
if (!claim(file, payload)) {
    try { fs.unlinkSync(stolen) } catch { /* nothing to clean */ }
    return { ok: false, broke: null, held, ageMs: age, lostRace: true }
}
try { fs.unlinkSync(stolen) } catch { /* nothing to clean */ }
return { ok: true, broke: held, ageMs: age, token }
```

So:
1. Read stale lock file
2. Decide to break
3. Atomically rename stale lock to .breaking.<token>
4. Read the stolen file (now at .breaking.<token>)
5. If the token in stolen file matches held.token, this was the lock we read
6. Otherwise, restore the stolen file to its original location (with O_EXCL)
7. Claim the lock (with O_EXCL via link)

Now interleavings:

TWO RACERS A and B, both reading same stale lock:

A: read stale (token = T_old)
B: read stale (token = T_old)

Both decide to break.

A: rename(stale, .breaking.T_a) - succeeds. Now stale is gone, .breaking.T_a has T_old content.
A: read .breaking.T_a - has T_old. matches held.token (T_old).
A: claim(stale, T_a_payload) - succeeds. A holds.
A: unlink .breaking.T_a - cleans up.

B: rename(stale, .breaking.T_b) - FAILS with ENOENT because stale was already renamed by A.
B: returns ok: false, lostRace: true.

So only A holds. ✓

THREE RACERS A, B, C all reading same stale lock:

A: read T_old
B: read T_old
C: read T_old

All decide to break.

A: rename(stale, .breaking.T_a) - succeeds.
A: read .breaking.T_a = T_old. matches.
A: claim(stale, T_a) - succeeds. A holds.

B: rename(stale, .breaking.T_b) - FAILS ENOENT.
B: returns lostRace.

C: same as B. lostRace.

So A holds, others fail. ✓

But wait - what about THIS interleaving:

A: read T_old
B: read T_old
A: rename(stale, .breaking.T_a) - succeeds.
B: rename(stale, .breaking.T_b) - FAILS ENOENT.
B: returns lostRace.
A: read .breaking.T_a = T_old. matches.
A: claim(stale, T_a) - succeeds. A holds.

OK that's fine.

Now: what if A reads T_old, then a third party X creates a FRESH lock at `stale` with T_new, then A renames `stale` to `.breaking.T_a`?

A: read T_old (file at `stale` had T_old content)
X: claim(stale, T_new_payload) - creates new lock
A: rename(stale, .breaking.T_a) - succeeds, file now has T_new content (because X just wrote it)
A: read .breaking.T_a = T_new. doesn't match T_old.
A: restores: tries to write T_new_payload back to stale with wx. But X already has it. ENOENT? Or just fails because file exists? Actually `wx` is exclusive create - file exists, so it fails. Caught by `catch { /* somebody already holds it */ }`. So the existing T_new lock at `stale` is preserved.
A: unlink .breaking.T_a - cleans up.
A: returns lostRace.

X holds. ✓ (X is the rightful owner now, not the stale lock)

But wait - here's the issue. The restore is via `wx` (exclusive create). If X already holds stale, wx fails. The lock at stale (X's) is preserved. But what if X has already RELEASED stale before A's restore? Then stale is gone, and A's restore succeeds - putting the stale lock back. Then A returns lostRace. So the lock is back to stale, even though X has come and gone. That seems OK - lostRace means A doesn't claim.

Hmm but what if X has come and gone, A's restore puts stale back, then a NEW racer D reads stale and decides to break? D would break a "fresh" lock (because the timestamp is old). That's a bug.

Wait let me trace this more carefully:
1. stale lock at file `L` with timestamp T_old
2. A reads L: held = { token: T_old, ... }, age is stale
3. X creates fresh lock at L with T_new_payload (timestamp now, token T_new)
4. A renames L to .breaking.T_a (atomic)
5. A reads .breaking.T_a = T_new_payload (because X wrote it last)
7. A sees takenToken != held.token (T_new != T_old)
8. A tries to restore: open L with wx - fails because L exists... wait, L was renamed. So L doesn't exist anymore.

Hmm wait. After step 4, L is renamed to .breaking.T_a. So L doesn't exist. X had created at L (step 3), but then A renamed it (step 4). So X's lock is now at .breaking.T_a (containing X's payload).

A: tries to open L with wx - succeeds! L doesn't exist anymore. A writes T_new_payload to L.
A: unlinks .breaking.T_a.

Now L contains T_new_payload (X's lock), but at the original location. A's restore preserved X's lock at the original location. ✓

OK that seems fine.

But what if this happens:
1. stale lock at L with timestamp T_old
2. A reads L: held = { token: T_old, ... }
3. X creates fresh lock at L with T_new_payload (atomic, link)
4. X releases L (unlinks)
5. A renames L to .breaking.T_a (atomic) - succeeds. .breaking.T_a has T_new_payload.
6. A reads .breaking.T_a = T_new_payload
7. A sees takenToken != held.token
8. A tries to restore: open L with wx - L doesn't exist. A writes T_new_payload to L. 

But wait - at step 8, A is putting back X's lock at L. X has already released. So A is putting back a lock that nobody currently holds. This could be a problem!

Now what if Y reads L (with X's content) and decides it's stale? Y's read says timestamp is T_new_payload (relatively fresh, just from a moment ago). Y would NOT decide to break. So Y returns lostRace (or whatever appropriate state).

But what about the LATER racers who look at L with T_new_payload? They'd see it as fresh, not stale. So they wouldn't try to break it. ✓

Hmm but the timestamp in T_new_payload could be from a while ago if the test seam doesn't reflect real time. In production, T_new_payload has `at: new Date(now).toISOString()` which is "now". So racers reading L would see age = 0, not stale. So no one would try to break. ✓

OK so the interleaving is fine. The atomic rename IS the fix.

But wait - there's another subtle issue. Let me trace:

1. stale lock at L with T_old
2. A reads L (held = T_old)
3. A decides to break
4. A renames L to .breaking.T_a (atomic)
5. A reads .breaking.T_a = T_old. matches.
6. A claims L with O_EXCL via link
7. A returns ok, holds

Now B comes along:
8. B reads L (held = T_a_payload, timestamp now, token T_a)
9. B sees fresh lock, NOT stale, returns ok: false (not stale)

So B doesn't try to break. ✓

OK the lock looks correct.

Now let me think about the restore path more carefully. The comment says:
> Put it back, but with an EXCLUSIVE create, never a rename: if a third process has claimed `file` since, restoring by rename would clobber a live lock and make things worse than the bug.

So they use O_EXCL create. If a third process has claimed file (L), the wx fails, and the comment says "theirs stands". ✓

But what if A's restore puts the file back, then ANOTHER process B reads it and sees it's T_new_payload (X's content, which had X's timestamp). B would see fresh. B's correct action is to not break. ✓

OK the lock logic is sound.

Now let me check the `_beforeSteal` test seam. The selftest uses `_beforeSteal` to simulate another runner creating a fresh lock between our re-read and our rename. Let me trace:

```javascript
try { fsx.unlinkSync(L) } catch {}
const stale3 = { pid: 999999, token: 'stale-3', start: null,
    at: new Date(Date.now() - 9 * 3600_000).toISOString() }
fsx.writeFileSync(L, JSON.stringify(stale3))
let racer = null
const misSteal = LK.acquireLock(L, { alive: dead, _beforeSteal: () => {
    // another runner broke it and is holding a FRESH lock, AFTER our re-read
    try { fsx.unlinkSync(L) } catch {}
    racer = LK.acquireLock(L, { alive: dead })
} })
```

So:
1. stale3 lock at L
2. acquireLock starts, reads L = stale3
3. _beforeSteal fires:
   - delete L
   - acquireLock (recursive) on L - this reads L... but wait, we just deleted L!

Hmm, the recursive call to acquireLock(L, { alive: dead }) would find no lock at L. The first attempt at `claim(file, payload)` would succeed because L doesn't exist. So racer gets a fresh lock.

Wait, let me re-read acquireLock:
```javascript
if (claim(file, payload)) return { ok: true, broke: null, token }
```

So if claim succeeds, return ok. The recursive call would find no L, claim would succeed (link from temp to L), return.

So racer gets a lock with token X (some new token).

Now back to misSteal:
4. After _beforeSteal, file L has racer's lock content
5. misSteal calls renameSync(L, .breaking.misSteal_token)
6. Reads .breaking.misSteal_token = racer's content
7. takenToken = racer's token, doesn't match held.token (stale-3)
8. Restore path: tries wx on L - succeeds (just deleted racer's lock by renaming it to .breaking.misSteal_token; but wait, racer's lock content was at L before rename, after rename .breaking.misSteal_token has it).

Wait, let me retrace:
- Before step 5: L has racer's content (because step 3.2 created racer's lock at L)
- Step 5: rename L to .breaking.misSteal_token. After: L doesn't exist, .breaking.misSteal_token has racer's content.
- Step 6: read .breaking.misSteal_token = racer's content.
- Step 7: takenToken (racer's token) != held.token (stale-3). So enter restore path.
- Step 8: open L with wx - succeeds (L doesn't exist). Write racer's bytes (read from .breaking.misSteal_token) to L. Close. Now L has racer's content.
- Step 9: unlink .breaking.misSteal_token.

So the restore puts racer's lock back at L. misSteal returns lostRace.

Then the test checks:
```javascript
t('...and the replacement is PUT BACK, not destroyed',
    (() => { try { return JSON.parse(fsx.readFileSync(L, 'utf8')).token === racer.token } catch { return false } })(), true)
```

So L should have racer's token. ✓

Then:
```javascript
t('...and the winner can still free its own lock', LK.releaseLock(L, racer.token), true)
```

releaseLock reads L, finds racer's token, unlinks. ✓

OK the test passes.

But there's an issue with the test! The selftest deletes L between iterations:
```javascript
try { fsx.unlinkSync(L) } catch {}
```

But then the test for misSteal sets up stale3, which is fine.

Wait actually I see something. Let me look at the full setup for misSteal:
```javascript
try { fsx.unlinkSync(L) } catch {}
const stale3 = ...
fsx.writeFileSync(L, JSON.stringify(stale3))
let racer = null
const misSteal = LK.acquireLock(L, { alive: dead, _beforeSteal: () => {
    // another runner broke it and is holding a FRESH lock, AFTER our re-read
    try { fsx.unlinkSync(L) } catch {}
    racer = LK.acquireLock(L, { alive: dead })
} })
```

So:
1. fsx.unlinkSync(L) - delete L (in case it exists from prior tests)
2. fsx.writeFileSync(L, stale3) - write stale3 to L
3. misSteal = LK.acquireLock(L, { alive: dead, _beforeSteal: ... })
4. Inside acquireLock: read L = stale3. Decide to break. _beforeSteal fires:
   - fsx.unlinkSync(L) - delete L
   - racer = LK.acquireLock(L, { alive: dead }) - this recursive call:
     - read L - ENOENT (just deleted)
     - claim(L, payload) - succeeds (no existing lock)
     - return { ok: true, broke: null, token: racer_token }
   - so racer = { ok: true, broke: null, token: ... }
5. Continue acquireLock for misSteal:
   - renameSync(L, .breaking.misSteal_token) - but L doesn't exist! ENOENT.

Oh! The acquireLock at step 5 gets ENOENT from renameSync, returns { ok: false, ..., lostRace: true }.

Hmm so the test passes because misSteal returns lostRace... but not for the right reason. The test was supposed to test the restore path. Let me re-read.

Actually wait. After _beforeSteal:
- L doesn't exist
- racer is { ok: true, broke: null, token: ... } (racer holds L)

Wait, racer holds L. So L DOES exist after _beforeSteal. Let me retrace:

- _beforeSteal fires:
  - fsx.unlinkSync(L) - delete L (was stale3)
  - racer = LK.acquireLock(L, { alive: dead })
    - read L - ENOENT
    - claim(L, payload) - this writes payload to temp file, then linkSync(temp, L). If L doesn't exist, linkSync succeeds, creating L. racer holds.
  - So now L has racer's content.

- Back in misSteal's acquireLock:
  - renameSync(L, .breaking.misSteal_token) - succeeds. After: L doesn't exist, .breaking.misSteal_token has racer's content.
  - read .breaking.misSteal_token = racer's content. takenToken = racer.token.
  - takenToken != held.token (stale-3). Enter restore path.
  - open L with wx - succeeds (L doesn't exist). Write racer's bytes. Now L has racer's content.
  - unlink .breaking.misSteal_token.

OK so the restore is correct. But notice that the test only triggers this branch because _beforeSteal unlinked L and re-created it via racer. So the test is correct.

But what if _beforeSteal did something different, like rename L to a different name and put a fresh lock at L? Then:
- Before _beforeSteal: L has stale3
- _beforeSteal: rename L to somewhere else. Create fresh lock at L. Return.
- After _beforeSteal: L has fresh lock.
- misSteal's renameSync(L, .breaking.misSteal_token) - succeeds. L doesn't exist, .breaking.misSteal_token has fresh lock's content.
- read .breaking.misSteal_token = fresh lock's content. takenToken = fresh_token.
- takenToken != held.token. Restore path.
- open L with wx - L doesn't exist. Write fresh lock's content. Now L has fresh lock.

OK same logic. The restore preserves whatever was at L.

What if _beforeSteal left L with a DIFFERENT stale lock (T_stale2, also stale)?
- _beforeSteal: create stale lock at L with token T_stale2.
- misSteal's renameSync(L, .breaking.misSteal_token) - succeeds.
- read .breaking.misSteal_token = T_stale2. takenToken = T_stale2.
- T_stale2 != T_old. Restore path. open L with wx - L doesn't exist. Write T_stale2 to L.
- Now L has T_stale2 (another stale lock).

So another stale lock is preserved at L. Another racer reading L would see T_stale2, also stale, and try to break. They'd also go through the restore path if there was yet another racer. Eventually someone wins.

Hmm but this is OK - the lock is exclusive. Each racer races, one wins, others lose. The winner holds. ✓

OK lock is correct.

Now let me look at the comments more carefully. Let me re-read some headers...

OK actually let me focus on finding real bugs. The author has self-audited extensively. Let me look for things they missed.

Let me think about the bank/cosign.mjs:

1. The Bank reads from chain via `pinnedAccountData`. ✓
2. The shape check passes 20+ assertions.
3. The coverage check uses scanPda.

What does scanPda do? It calls getTokenAccountsByOwner for SPL and Token-2022, plus DAS for Core assets.

Let me look at scanPda more carefully:
```javascript
async function scanPda(conn, pda) {
  const owned = []
  for (const programId of [TOK, TOK22]) {
    const r = await conn.getTokenAccountsByOwner(pda, { programId }, 'confirmed')
    for (const { pubkey, account } of r.value) {
      const amount = account.data.readBigUInt64LE(64).toString()
      if (amount !== '0') owned.push({ address: pubkey.toBase58(), amount, kind: 'token' })
    }
  }
  // DAS for Core assets...
  const r = await fetch(rpcUrl(), { method: 'POST', ...
    body: JSON.stringify({ jsonrpc: '2.0', id: 'c', method: 'getAssetsByOwner',
      params: { ownerAddress: pda.toBase58(), page: 1, limit: 1000 } }) })
  const j = await r.json()
  if (j.error) throw new Error(`DAS getAssetsByOwner: ${JSON.stringify(j.error)}`)
  for (const it of (j.result?.items || [])) {
    if (it.burnt) continue
    owned.push({ address: it.id, kind: 'asset' })
  }
  if ((j.result?.items || []).length >= 1000) throw new Error('DAS returned a full page for one PDA — refusing to judge a truncated list')
  return owned
}
```

Hmm, the DAS call uses `getAssetsByOwner` with the PDA address. But the PDA is a Core asset-signer PDA - it's not a wallet, but rather a derived PDA. Will DAS find it?

Looking at the DAS API, `getAssetsByOwner` typically takes a wallet pubkey. PDAs can own assets but DAS may or may not index them. Let me think about this...

Actually, in production, the Bank would need to know if the PDA owns any Core assets. The DAS API would need to support this. If DAS doesn't support PDA owners, the check would return empty (no assets), and the Bank would bless the redemption without catching nested vaults.

This is the same gap as `detectNestedVaults`. The author knows this and states it.

But here's a thought - `getAssetsByOwner` is specifically for wallet owners. PDAs are different. The check might always return empty. If so, the Bank's "check" is silent on nested Core assets.

Actually the author writes: "The DAS full-page refusal at limit 1000. Is it the right guard, and is it the ONLY way that call can fail to answer?"

So if the DAS call returns success but empty items, that's treated as "no assets owned". The Bank would bless a redemption that destroys a nested asset.

This is a real gap, but the author knows and acknowledges it. Is it worth flagging again? The prompt says:
> given a response the scan DOES get back, what does it mis-read or discard?

The scan reads:
- amount from token accounts via readBigUInt64LE(64). What if amount is 0? Then the account is NOT added to the list. But the burn still checks declared accounts - if the customer doesn't declare a 0-balance token account, the burn sees it as 0 and lets it pass (because the burn refuses on non-zero balance for declared accounts).

Hmm wait, the BURN does:
```rust
require!(acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID, ...)
let d = acc.try_borrow_data()?;
if d.len() < TOKEN_ACCOUNT_LEN { continue; }
let mut o = [0u8; 32]; o.copy_from_slice(&d[32..64]);
require_keys_eq!(Pubkey::new_from_array(o), pda, BurnError::ReserveNotOurs);
require!(d[72..76] == [0,0,0,0], BurnError::ReserveDelegated);
require!(d[121..129] == [0u8; 8], BurnError::ReserveDelegated);
require!(d[129..133] == [0,0,0,0], BurnError::ReserveDelegated);
require!(d.len() == TOKEN_ACCOUNT_LEN, BurnError::ReserveHasExtensions);
let mut amt = [0u8; 8]; amt.copy_from_slice(&d[64..72]);
require!(u64::from_le_bytes(amt) == 0, BurnError::VaultNotEmpty);
```

So the burn refuses on:
- account owner != SPL or T22 (continue)
- data length < 165 (continue)
- account's owner field != pda (refuse)
- has a delegate (refuse)
- has extensions (refuse, len != 165)
- has non-zero balance (refuse)

The burn skips accounts that aren't ours, are too small, etc. (continue). For ours, it checks all the things.

So the scan's `if (amount !== '0')` filter is CORRECT - if amount is 0, the burn would let it pass. But the scan discards 0-balance accounts.

Wait - the scan discards 0-balance accounts because the burn would let them through. So the scan only reports non-zero balances that need to be declared.

But what if a token account has a delegate set but 0 balance? The burn would refuse on the delegate, even though the balance is 0. The scan would NOT report it (because amount is 0). The customer could include this account in declared accounts, and the burn would refuse with ReserveDelegated. That's the bank's refusal to bless.

But what if the customer doesn't declare this account? The burn wouldn't see it (only checks declared accounts). The burn would proceed. After burn, the asset is gone. The 0-balance-with-delegate token account is owned by a PDA that nobody can sign for. The delegate could close the account and take the rent... but the account is empty, no value.

So no fund loss, but a slightly broken state. Not CRITICAL.

But wait - is there a worse case? What about a delegate on a NON-reserve SPL account? Like an attacker creates an account for cbBTC (a reserve mint), but with extensions (Token-2022), so the burn refuses. If the customer doesn't declare this account, the burn proceeds. After burn, the PDA still owns the account. The PDA is unsignable.

But the cbBTC ATA is at the canonical address (derived). The attacker can't put cbBTC at a non-canonical address because... wait, actually anyone can create an account at ANY address with any mint, if they own the mint.

Actually wait, anyone can create token accounts. They just need to call createAccount. They can create an account at any address (well, any address they specify), with any mint. The PDA doesn't need to sign to receive a token account.

So an attacker can:
1. Create a Token-2022 ATA for the PDA's address, for cbBTC mint
2. Mint cbBTC to that account (if they own the cbBTC mint - they don't, cbBTC is by Coinbase)
3. Or transfer cbBTC to that account (if they have cbBTC - they might)

But the attacker would need cbBTC to transfer. They could buy cbBTC and transfer it. But this is just an airdrop, not a theft vector.

Hmm OK. So the airdrop gap is acknowledged.

What about: the attacker creates an empty Token-2022 ATA for the PDA. The PDA now owns it. The customer redeems. The burn... checks the declared accounts only. If the customer doesn't declare this Token-2022 ATA, the burn doesn't see it. The burn proceeds. After burn, the PDA owns the empty Token-2022 ATA.

But the PDA can never sign, so nobody can do anything with this ATA. The account sits there forever (or until rent runs out, which Solana accounts don't do).

This isn't a fund loss. But it's a state issue. And the bank's cosign tool would bless it (because the scan doesn't see 0-balance accounts).

Actually wait - the scan returns 0-balance accounts to the judge via the `owned` array. Let me re-read:

```javascript
for (const { pubkey, account } of r.value) {
    const amount = account.data.readBigUInt64LE(64).toString()
    if (amount !== '0') owned.push({ address: pubkey.toBase58(), amount, kind: 'token' })
}
```

Only non-zero balance accounts are added. So 0-balance accounts are dropped.

Then in judgeRedemptionCoverage:
```javascript
export function judgeRedemptionCoverage(owned, declared) {
  const bad = []
  const seen = new Set(declared)
  for (const h of owned) {
    if (seen.has(h.address)) continue
    bad.push(`${h.kind === 'asset' ? 'a Core ASSET' : `${h.amount} units of a token`} at ${h.address} is owned by this vault and is NOT declared in the burn — it would be DELETED`)
  }
  return { ok: bad.length === 0, reasons: bad }
}
```

This compares owned (what the scan sees, non-zero only) to declared. If a 0-balance account is undeclared, it's not flagged. That's consistent with the burn's behavior (which only cares about non-zero).

But wait - what about the Core asset scan? Let me re-read:
```javascript
for (const it of (j.result?.items || [])) {
    if (it.burnt) continue
    owned.push({ address: it.id, kind: 'asset' })
}
```

Core assets don't have a "balance" check. They're added if not burnt. So nested Core assets (regardless of contents) would be added to `owned`. Good.

But what about a nested Core asset that the customer declares? Would the burn refuse? Yes:
```rust
for acc in ctx.remaining_accounts.iter() {
    if acc.owner == &MPL_CORE_ID {
        let d = acc.try_borrow_data()?;
        require!(d.is_empty() || d[0] != KEY_ASSET_V1, BurnError::VaultStillHoldsAVault);
        continue;
    }
```

So if the declared account is a Core asset and it's a live AssetV1 (data[0] == KEY_ASSET_V1), the burn refuses. The customer must declare it and the burn would refuse. If they don't declare it, the burn proceeds and the inner vault is orphaned.

So the scan correctly catches nested Core assets.

But what about a NESTED Core asset that's not indexed by DAS? The scan relies on DAS. If DAS doesn't index PDAs, the scan misses it. This is acknowledged.

Hmm OK, what else.

Let me look at the lock more carefully. The header says "The durable answer is a lock nobody has to break — an OS lease on an open fd — and that is recorded as the next step rather than half-built here." So the author knows the current lock has TOCTOU window. The "narrowing" is documented.

But wait - actually, looking at the code:

The break is now ATOMIC (rename). The re-read is no longer needed for atomicity. So actually... the re-read and the comment about "two process interleaving" don't apply anymore. The comment was kept for context.

But there's a TOCTOU: between `read()` (initial read) and `rename()`, another process could break the lock and replace it. Then our rename would rename the NEW lock. Then our `takenToken !== held.token` check catches this, and we restore the new lock.

But wait, in the restore, we write the new lock's content back to the original location. So another racer could then read it and try to break it... but the lock is now the new lock, with a fresh timestamp. So they'd see it's fresh, not stale, and not try to break.

Actually, that's the case if the new lock has a fresh timestamp. In production, the new lock has `at: new Date(now).toISOString()` which is now. So it's fresh.

OK so the restore preserves the fresh lock, and other racers correctly identify it as fresh and don't try to break. ✓

But there's STILL a TOCTOU window: between `read()` and `rename()`. The window is the time it takes to execute a few instructions. In practice, this is microseconds. During this window, another process could:
1. See the lock
2. Decide it's stale
3. Break it
4. Replace it

Our `rename()` would then rename the new lock to .breaking.ours. We'd read it, see it doesn't match held.token, and restore.

In the restore, we write the new lock's content back. Now the file has the new lock content. ✓

But during the rename and restore, the new lock content is at .breaking.ours. Then we move it back. What if ANOTHER racer starts during this window?

Racer Y:
1. Sees the lock at `stale` (or rather, doesn't see it because we renamed it)
2. Tries to acquire - finds no lock, claims fresh

So Y takes a fresh lock. Then our restore puts the new lock content back at stale. Now Y holds stale, and stale has fresh content (Y's claim).

Actually wait, Y takes a lock by claiming stale. If stale is empty, Y's claim succeeds. Y writes Y_payload to stale. Y holds.

Then we (A) write A_payload to stale (in restore). We OVERWRITE Y's lock! 

Wait let me re-trace. The restore is:
```javascript
try {
    const bytes = fs.readFileSync(stolen)
    const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, bytes); fs.closeSync(fd)
} catch { /* somebody already holds it; theirs stands */ }
try { fs.unlinkSync(stolen) } catch { /* nothing to clean */ }
```

It opens `file` (which is `stale`) with wx (exclusive create). If file exists, wx fails. If file doesn't exist, wx succeeds and we write.

So if Y has already claimed `stale` (written Y_payload there), our wx fails. We don't overwrite. ✓

If Y hasn't claimed yet (Y is about to), there's a race. But the wx is exclusive - if Y's claim succeeds first, our wx fails. If our wx succeeds first, Y's claim fails. ✓

OK no overwrite. Good.

Hmm but here's another subtle issue. The restore path puts back the `stolen` content (which is the new lock's content). What if the new lock's content was from a process that has now crashed and left the file in a weird state? Like, the new lock was never properly finalized?

Actually, the new lock is created via `claim` which uses `link` (atomic). So it's always fully formed. The restore preserves this. ✓

OK the lock is solid.

Let me check the readLedger and writeLedger for any issues:

```javascript
export function readLedger(file, fallback, marker = null) {
  let raw
  try { raw = fs.readFileSync(file, 'utf8') }
  catch (e) {
    if (e.code === 'ENOENT') {
      if (marker && fs.existsSync(marker)) {
        throw new Error(`${file} is MISSING, but ${marker} says it has been written before. ...`)
      }
      return structuredClone(fallback)
    }
    throw e
  }
  try { return JSON.parse(raw) }
  catch (e) {
    throw new Error(`${file} exists but will not parse (${e.message}). REFUSING to treat a corrupt ledger as an empty one — ...`)
  }
}

export function writeLedger(file, obj, marker = null) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp${process.pid}`)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(obj, null, 2))
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  if (marker && !fs.existsSync(marker)) fs.writeFileSync(marker, new Date().toISOString())
  fs.renameSync(tmp, file)
}
```

The marker is stamped before rename. If marker write fails... `fs.writeFileSync` would throw. So a failure would propagate. But after marker write, rename could fail (e.g., disk full). Then the marker exists but the file doesn't. That's a state inconsistency.

Wait - the marker is written FIRST. Then the rename. If rename fails:
- tmp exists
- marker exists
- file doesn't (or is the old one)

If the process dies between marker write and rename:
- tmp may exist or not
- marker exists
- file may be old or non-existent

A subsequent readLedger would see marker exists, file missing (if rename never happened), throw "marker says written before but file missing". That's correct.

If file is old (rename failed mid-flight - though rename is atomic, so this is unlikely), then readLedger reads the OLD ledger. The marker exists, file is old. readLedger reads old ledger without error.

Hmm, but what if the OLD ledger had a different state than expected? E.g., a payment was processed, written to old ledger. Then new run starts. writeLedger is called: tmp is written, marker exists (from before), file is renamed. But marker was already there from a previous run. `!fs.existsSync(marker)` is false, so marker is NOT re-written. ✓

But what if the marker was DELETED between runs? Then `!fs.existsSync(marker)` is true, marker is re-written. Then file is renamed. If rename fails, marker exists but file is old. Next run: marker exists, file is old. readLedger reads old. OK.

If marker was deleted and file was deleted? writeLedger writes marker, then tries rename. But the tmp file... wait, the tmp is created via `fs.openSync(tmp, 'w')`. If tmp already exists, it's truncated. Then fsync, close. Then marker write, then rename.

Actually `fs.openSync(tmp, 'w')` truncates if exists. So tmp is always our content. Then rename is atomic. If rename succeeds, file has new content, old tmp is gone. If rename fails (e.g., cross-device?), tmp is leftover. We don't clean up. Next writeLedger: tmp is overwritten. OK.

Hmm but the tmp file name includes pid. So multiple processes could write to different tmp files. If process A's tmp is `.ledger.tmp12345` and process B's is `.ledger.tmp67890`, they don't conflict. But the rename target is `file`, which is shared. So if A and B both try to write at the same time, one's rename would clobber the other's.

But that's the lock's job - to prevent concurrent writes. So if the lock holds, only one process writes at a time. ✓

OK ledger is fine.

Now let me look at the actual deliverables again. The diff includes:

1. alarm.mjs: applyAcks wired in, plus the daily reconcile uses detectNestedVaults with isOnCurve
2. detectors.mjs: judgeRedemptionTx, judgeRedemptionCoverage, parseAcks, applyAcks new; correlateBurns allowlist rewritten; detectNestedVaults extended with isOnCurve
3. lock.mjs: rename-based atomic break
4. selftest.mjs: assertions added
5. cosign.mjs: new file
6. scripts/validate-core-gate.sh: rewritten with must_fire/must_pass
7. scripts/run-tests.sh: floor updated
8. tests/3prog.test.ts: ceiling harness fixed

Let me look at the existing comments again. The R4 target is "every comment claiming a control that does not run, OR denying a control that now does run".

Let me check the headers...

cosign.mjs has:
```
* ⚠️ THIS FILE EXISTS BECAUSE EVERY OTHER FILE CLAIMED IT ALREADY DID.
```

OK, the cosign tool exists. ✓

Now the SELFTEST FLOOR is 275. The actual count is R.length. If R.length < 275, it dies. If R.length >= 275 and some failed, exit 1.

Wait actually, looking at the floor:
```javascript
const FLOOR = 275
const bad = R.filter(r => !r.ok)
if (R.length < FLOOR) {
  console.error(`\nONLY ${R.length} assertions ran; the floor is ${FLOOR}. The file stopped early.`)
  process.exit(1)
}
console.log(`\n${'='.repeat(60)}\n${R.length - bad.length}/${R.length} detector assertions as predicted`)
console.log(`every detector proven in BOTH directions: fires when it should, quiet when it should`)
process.exit(bad.length ? 1 : 0)
```

So:
- If R.length < 275, die (someone deleted assertions)
- Otherwise, exit 1 if any failed

Hmm, can the floor be defeated? If assertions are deleted but R.length >= 275, the bad assertions would still be checked. So floor is correct.

But what if someone changes an assertion to always pass? Then R.length stays the same, bad.length drops. That defeats the floor.

Or what if someone deletes a TEST (so the assertion count drops but they remove it from FLOOR too)? Then we have an off-by-some. The floor needs to equal the actual count.

The author writes: "It is the current count and it moves with the suite."

So FLOOR = current count. If someone adds assertions, they should bump FLOOR. If they remove assertions, they should lower FLOOR. The floor is a tripwire.

But there's a subtle thing: if you ADD assertions, the count goes up. You bump FLOOR to match. Now if you REMOVE some assertions, count drops below FLOOR, dies. ✓

If you REPLACE assertions (delete some, add others), count stays same. FLOOR matches. The new assertions might be weaker, but they pass. So the floor alone doesn't catch this.

OK the floor is a reasonable defense.

Now let me look at the "carries through to" details. Things the round-14 verdict carried forward.

Actually, let me focus on what might be wrong vs right.

Looking at the SPEC text mentioning "Bank alarm" and the "UNBREAKING IS BURNING" section:

> `bank/cosign.mjs` — the Bank's co-signer
> the whole redemption, BEFORE a signature: the pair, the asset/owner binding, the Bank named in both, an off-curve owner, extra instructions to SEAL or BURN, a lying declared count, and every token account or nested Core asset the vault holds that the burn does not declare

The cosign checks these things. But the customer's signature on the transaction is provided by the customer. The Bank adds its own signature. So the customer's signature on the transaction must ALREADY include the owner signature (otherwise the on-chain owner: Signer check fails).

But the cosign tool doesn't VERIFY the owner's signature. It just checks owner is on-curve. So if a customer submits a transaction where:
- open_for_redemption is signed by some random wallet, NOT the owner
- the owner account is named correctly (but didn't sign)
- The Bank signs it

On-chain, Anchor's `owner: Signer` would refuse because owner didn't sign. So the customer's transaction fails.

But the Bank has now blessed a transaction that fails on-chain. This is a UX issue but not a fund-loss issue.

Unless... the customer could try a different shape? Hmm, not really.

OK let me look at the validate-core-gate.sh in detail. The new version:

```bash
must_fire(){ if gate "$1"; then die "FALSE PASS — the gate accepted $2. The gate is useless."; fi; echo "  correct: fired"; }
must_pass(){ if ! gate "$1"; then die "FALSE FAIL — the gate rejected $2. It would reject every good validator."; fi; echo "  correct: passed"; }
```

So `must_fire` asserts gate RETURNS FALSE (i.e., the gate fires). `must_pass` asserts gate RETURNS TRUE (i.e., the gate accepts).

`gate` is:
```bash
gate(){
  solana -u "$RPC" program dump "$CORE" "$CACHE/g-onchain.so" >/dev/null 2>&1 || { echo "  GATE FIRED: Core not present"; return 1; }
  cmp -s "$CACHE/g-onchain.so" "$1" || { echo "  GATE FIRED: Core differs from expected"; return 1; }
  echo "  GATE PASSED"; return 0
}
```

OK so gate returns 1 on fail, 0 on pass. ✓

Arm 1: validator WITHOUT Core. gate dumps Core, but Core is not on validator. DUMP fails, gate returns 1. must_fire expects gate to return 1. If gate returns 1, no die. ✓

But wait - what if `solana program dump` exits non-zero for a different reason (like RPC timeout)? The gate returns 1, must_fire is satisfied. But actually the validator has no Core, so any attempt to dump Core would fail. ✓

But there's a subtlety: if validator is not running at all, dump would fail too. But that's the same outcome - gate fires, must_fire satisfied.

Arm 2: validator WITH real Core, but expected bytes tampered. dump succeeds (Core is on validator), but cmp fails (on-chain doesn't match tampered). gate returns 1. must_fire satisfied. ✓

Arm 3: validator WITH real Core, untampered. dump succeeds, cmp succeeds. gate returns 0. must_pass satisfied. ✓

OK the gate validator is sound.

Now let me look at the run-tests.sh floors. DET_FLOOR=275, ALLOC_FLOOR=17, MIN_ASSERTIONS=267.

Actually wait, MIN_ASSERTIONS=267 (the on-chain suite). DET_FLOOR=275 (off-chain detector suite). All match the actual counts.

Let me check the on-chain suite count. Looking at tests/3prog.test.ts... it's huge. Lots of assertions. The number 267 is the documented count.

OK.

Now let me think about the comments. The author's rule is: every claim about a control should point at SPEC.md's "THE SHIP GATE" table rather than restating it.

Let me check SPEC.md for the control table.

Looking at SPEC.md, there's "### THE CONTROL TABLE — the ONE place that says what actually runs":

```
| control | what it catches | when |
|---|---|---|
| **`bank/cosign.mjs`** — the Bank's co-signer | the whole redemption, BEFORE a signature: the pair, the asset/owner binding, the Bank named in both, an off-curve owner, extra instructions to SEAL or BURN, a lying declared count, and **every token account or nested Core asset the vault holds that the burn does not declare** | **pre-signature** |
| `detectNestedVaults` (alarm, EVERY pass) | a CBOB vault owned by any vault's asset-signer PDA, a vault owned by its OWN, and any vault owned by an off-curve address | post-hoc, ≤30 min |
| `detectUndeclaredTokenAccounts` (`--reconcile`) | any token account a vault PDA owns that is not a canonical reserve ATA | post-hoc, daily |
```

OK, so the table lists cosign.mjs as the pre-signature control. But the cosign tool is inspect-only by default! It doesn't actually sign unless --live is added.

Hmm. The cosign tool, even when called, might be called in inspect-only mode. In production, who runs cosign.mjs? Is there a wrapper that runs with --live?

Looking at the diff... no, cosign.mjs is just a new file. There's no integration with the crontab or anything else. So the cosign tool exists but isn't wired in.

The header says: "There is no Bank key on this box yet." So the Bank doesn't have a key, so cosign.mjs can't actually be called with --live.

This is consistent with "no Bank co-signing tool exists in this repository" being revised to "the tool exists but isn't wired in".

OK that's fine. But it's a state of the repo: the cosign tool exists but isn't used.

Let me look at where the Bank's cosign might be invoked. The crontab has:
- alarm.mjs every 30 min
- distribute.mjs daily
- revenue.mjs every 6 hours
- alarm.mjs --reconcile daily
- deadman

None of these call cosign.mjs. So the cosign tool is not integrated.

This isn't a bug, just a state. The author is being honest about it.

OK let me look at the round 14 verdict challenges:

> * The admin EXEMPTION from `detectBankIsNotSignable` was confirmed correct by three models. Name an admin instruction in any of the four programs that breaks under a PDA admin, or confirm none does.

So the question is: which admin instructions are there, and does any of them break under a PDA admin?

Admin instructions in SEAL:
- `update_config(bank?, admin?, reserve_mints?)` - admin: Signer
- `apply_pending` - permissionless
- `cancel_pending` - admin: Signer (via UpdateConfig struct)
- `initialize` - INIT_AUTHORITY signer

For PDA admin to sign `update_config`, the PDA's owner program must be a Squads program that does CPI. Squads does CPI. So PDA admin can sign via CPI. The on-chain check is `admin: Signer<'info>`. A CPI signer can sign with `is_signer: true` (because the CPI context makes the PDA a signer).

So PDA admin works for admin instructions. ✓ The exemption is correct.

Admin instructions in MINT:
- `initialize` - INIT_AUTHORITY
- `update_wiring` - admin: Signer
- `apply_pending_*` - permissionless
- `cancel_pending_*` - admin: Signer
- `set_paused` - admin: Signer
- `set_collection_royalties` - admin: Signer (and governance: Signer)
- `set_round` - governance: Signer (not admin)

PDA admin works for admin instructions (update_wiring, set_paused, cancel_pending). PDA admin does NOT work for set_round (needs governance). ✓

Admin instructions in BURN:
- `initialize` - INIT_AUTHORITY
- `update_config` - admin: Signer
- `apply_pending` - permissionless
- `cancel_pending` - admin: Signer
- `burn_vault` - owner AND bank: Signer (not admin)

PDA admin works for update_config and cancel_pending. ✓

Admin instructions in GOV:
- `initialize` - INIT_AUTHORITY
- `update_gov_config` - admin: Signer
- `apply_pending_admin` - permissionless
- `cancel_pending_admin` - admin: Signer
- `create_proposal` - proposer: Signer (any vault holder)
- `cast_vote` - owner: Signer
- `execute_proposal` - permissionless

PDA admin works for update_gov_config and cancel_pending_admin. ✓

So none of the admin instructions break under PDA admin. The exemption is correct.

But wait - let me check the **MINT** `update_wiring` for one specific case: it sometimes requires governance signature. The check is in the handler:
```rust
let needs_governance = treasury.is_some() || bank_treasury.is_some() || split_bps.is_some()
    || sol_reserve_lamports.is_some()
    || governance_timelock_secs.is_some()
    || max_sweep_lamports.map_or(false, |x| x > c.max_sweep_lamports || x < MIN_ADMIN_SWEEP_LAMPORTS)
    || sweep_cooldown_secs.map_or(false, |x| x < c.sweep_cooldown_secs || x > MAX_ADMIN_SWEEP_COOLDOWN_SECS);
if needs_governance {
    let gov = ctx.accounts.governance.as_ref().ok_or(MintError::TreasuryNeedsGovernance)?;
    require_keys_eq!(gov.key(), c.governance, MintError::TreasuryNeedsGovernance);
}
```

So if the change needs governance, the caller must pass governance as Signer. PDA admin (signed by Squads via CPI) can satisfy this... wait, governance is a SEPARATE field. The admin is the admin, and governance is governance.

So for `update_wiring(treasury=X)`, the caller passes:
- admin: Signer (the PDA admin, signed by Squads)
- governance: Signer (which is the GOV program's PDA)

The GOV program's PDA signs via CPI. Squads calls GOV's execute CPI... no, actually, the GOV program's PDA only signs `set_round` (per its CPI authority). So when admin calls update_wiring with governance field set, the Squads admin would need to ALSO sign the GOV program's PDA as a signer. That requires the GOV program's PDA to be a CPI signer in the same transaction.

But the GOV program's PDA can only sign in a CPI from GOV. So it can only sign when GOV is in the transaction. If GOV is not in the transaction, the GOV PDA can't sign.

So PDA admin can NOT do `update_wiring(treasury=X)` because that requires the GOV PDA's signature, which requires GOV to be in the transaction.

Wait actually, looking at the program more carefully. The PDA can be a Signer in any transaction if it's a CPI signer from some program. The Squads admin calls update_wiring, which is on MINT. The admin field is the PDA. The PDA can be marked is_signer: true if some program (the Squads program) made it a CPI signer.

But the Squads program would call MINT's update_wiring with the admin PDA as a CPI signer. So the admin PDA has is_signer: true.

Now for governance: MINT expects governance to be Signer. If governance is the GOV PDA, the GOV program must be in the transaction as a CPI caller (with governance as a CPI signer).

But Squads doesn't have to call GOV. Squads just calls MINT directly.

So PDA admin (signed by Squads) can sign admin instructions that DON'T require governance. But instructions that DO require governance need the GOV PDA to be a CPI signer too.

Hmm but the test 6.18 (admin ALONE redirects who gets paid) is REJECT because `TreasuryNeedsGovernance`. So that requires governance signature, which admin (even PDA admin) cannot provide without GOV in the tx.

OK so PDA admin has the same constraints as keypair admin. The exemption is correct.

Now let me look at:

> The closed-ATA delegate ALLOW (3.3a) was confirmed safe.

The test 3.3a is:
```
delegate planted during the thaw, then the ATA is CLOSED by the sweep → burn ALLOW
```

Let me re-read the burn's delegate check:
```rust
require!(d[72..76] == [0,0,0,0], BurnError::ReserveDelegated);
```

So if the reserve token account has a delegate set (d[72..76] != [0,0,0,0]), burn refuses. But if the sweep CLOSES the account before the burn, the account no longer exists. The burn doesn't see it. The burn proceeds. ✓

But what if the sweep transfers out and CLOSES the account, but the delegate was also set on a DIFFERENT account on the PDA? Like, the delegate is on a non-reserve SPL account. Then the burn's reserve loop doesn't see it (different mint), but the "all declared" loop might see it. Wait, declared accounts are checked. If the customer declares the account with delegate, the burn refuses.

If the customer doesn't declare, the burn doesn't see it. Burn proceeds. After burn, the PDA owns an account with a delegate set, but the account is now... hmm, is it still there?

If the sweep only touches reserve ATAs, a non-reserve SPL account with delegate is untouched. Burn proceeds. After burn, the PDA owns this account (with delegate) but the PDA is unsignable. The delegate could close the account and take the rent. Small loss.

Actually wait - could the delegate TRANSFER tokens out? If the account has a balance, yes! The delegate could call transfer on the account. So if there's an account on the PDA with delegate set AND a balance, the delegate could drain it before the burn happens).

Hmm wait, the burn happens IN THE SAME TRANSACTION as the sweep and delegate planting. So everything is atomic. The delegate can't transfer BETWEEN the sweep and burn because they're in the same tx.

Actually, the delegate would be set DURING the thaw, before the burn. The burn happens at the end of the same tx. The delegate can't act until the tx completes. After the tx, the PDA is unsignable. But the delegate can sign with their own key - they don't need the PDA's signature.

So if there's an account on the PDA with delegate set and a balance, the delegate could transfer the tokens AFTER the burn (when the asset is gone, but the PDA still owns the token account).

Wait, after the burn, the asset is gone. The PDA is unsignable. But the PDA still owns the token accounts that were not closed by the sweep. The delegate set on those accounts... can the delegate transfer?

The SPL token rules: a delegate can transfer up to the delegated amount. If delegated amount was the full balance, delegate can transfer everything. After burn, the delegate can call transfer on the account and drain it.

So if the customer plants a delegate during the thaw, and the delegate transfers the tokens AFTER the burn... wait but the burn is supposed to verify that no declared account has a delegate. And the sweep is supposed to empty the accounts.

But the NON-reserve accounts aren't checked by the burn's reserve loop. They're checked in the "all declared" loop:
```rust
for acc in ctx.remaining_accounts.iter() {
    if acc.owner == &MPL_CORE_ID { ... continue; }
    if acc.lamports() == 0 { continue; }
    if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
    let d = acc.try_borrow_data()?;
    if d.len() >= TOKEN_ACCOUNT_LEN {
        let mut o = [0u8; 32]; o.copy_from_slice(&d[32..64]);
        if Pubkey::new_from_array(o) == pda {
            require!(d.len == TOKEN_ACCOUNT_LEN, BurnError::ReserveHasExtensions);
            require!(d[72..76] == [0,0,0,0], BurnError::ReserveDelegated);
            require!(d[121..129] == [0u8; 8], BurnError::ReserveDelegated);
            require!(d[129..133] == [0,0,0,0], BurnError::ReserveDelegated);
            let mut amt = [0u8; 8]; amt.copy_from_slice(&d[64..72]);
            require!(u64::from_le_bytes(amt) == 0, BurnError::VaultNotEmpty);
        }
    }
}
```

So if a non-reserve SPL account on the PDA is DECLARED and has a delegate, the burn refuses with ReserveDelegated. ✓

But if it's NOT DECLARED, the burn doesn't see it. The burn proceeds. After burn, the delegate can drain.

So the customer could:
1. Plant a delegate on a non-reserve SPL account owned by PDA (using owner's Core Execute during thaw)
2. Have a balance in that account (transferred in via Core Execute too)
3. NOT declare this account in burn_vault's remaining_accounts
4. Burn proceeds, asset destroyed
5. Delegate transfers tokens out

That's a real vulnerability! Wait let me double-check. The customer's intent in a redemption is to get their tokens out. Why would they plant a delegate on themselves?

Hmm, but a malicious customer could do this. Plant a delegate to a friend's address. Friend drains after the burn.

Actually wait - the customer is REDEEMING. They want their tokens. So they'd plant a delegate to themselves, then drain before the burn. That defeats the purpose.

But wait - the sweep happens BEFORE the burn. The sweep transfers tokens from the reserve ATAs to the customer. If the customer plants a delegate, then they themselves can drain. But why would they?

Oh I see. The delegate's purpose is to allow SOMEONE ELSE to transfer. The customer themselves is the owner of the PDA. They can already sign transactions through Core Execute during thaw. Why need a delegate?

Hmm, but actually the customer can Core Execute during thaw (asset owner). They can transfer tokens from the PDA's accounts to anyone via Core Execute (using the asset owner's authority).

So the delegate adds nothing for the customer's own redemption. It adds something for an accomplice who can later drain.

Hmm, but for the accomplice to drain, the tokens need to still be in the account. The burn refuses on non-zero balance for declared accounts. The sweep empties declared accounts. So if all the value is in declared accounts and gets swept, the post-burn account is empty, delegate has nothing to drain.

But if there's an UNDECLARED account with value, the burn doesn't see it, the sweep doesn't touch it. After burn, the account still has value, delegate can drain.

So the attack: customer creates an UNDECLARED SPL account on the PDA, transfers tokens to it (or has them airdropped), plants a delegate. Redeems. Burn doesn't see this account. After burn, delegate drains.

But the BANK's cosign would catch this (if the scan sees the undeclared account with non-zero balance). The cosign would refuse. ✓

OK so the Bank's cosign is the control for this case. Good.

But what about: the customer's wallet is offline and the cosign runs on a cron. If the cron runs before the customer broadcasts, the scan might miss an airdrop that happens just before broadcast.

This is the airdrop race. Acknowledged. ✓

Now let me look at "Only TWO reserve mints fit if the redeemer must create their destination ATAs" - so ATA creation MUST be a prior transaction.

The selftest 9.14b measures this. ✓ The requirement is now stated in the SPEC.

What happens if a client ignores it? They fold the ATA creation into the redemption transaction. The transaction is too big for 3 reserve mints. It fails to serialize (or fails on chain with TransactionTooLarge). The customer's transaction fails. They lose SOL on fees. No fund loss.

But the customer's redemption doesn't go through. They need to send two transactions. Not ideal UX, but not a security issue.

OK let me look at the bigger picture. The fixes for round 14:

1. bank/cosign.mjs: new co-signer ✓
2. bank/lock.mjs: atomic rename ✓
3. applyAcks, REDEMPTION_NOISE allowlist, detectNestedVaults with isOnCurve ✓
4. validate-core-gate.sh: fixed ✓
5. floor update ✓
6. ceiling harness fix ✓

Are there any actual bugs in these fixes?

Let me look at the Bank's reading of the seal config. The pin:
```javascript
const data = pinnedAccountData(acc, { program: SEAL, struct: 'Config', version: 1, what: 'the SEAL config' })
const bank = new PublicKey(data.subarray(73, 105)).toBase58()
```

This reads offset 73-105 (32 bytes) as the Bank pubkey. Looking at SEAL's Config struct:
```rust
pub struct Config {
    pub version: u8,                    // offset 8 (after discriminator)
    pub admin: Pubkey,                  // 9..41
    pub collection: Pubkey,             // 41..73
    pub bank: Pubkey,                   // 73..105
    pub reserve_mints: Vec<Pubkey>,     // 105 onwards
    ...
}
```

So bank is at offset 73..105. ✓

The reserve_mints Vec follows. The Bank doesn't need to read this for the shape check. ✓

OK, the bank extraction is fine.

Hmm let me also consider: the cosign tool runs on... what machine? It's not integrated into anything. So someone has to manually run it on each redemption transaction. That's a UX gap, not a security issue.

Actually wait - the comment says "There is no Bank key on this box yet." So the cosign tool can't be USED to sign. The whole thing is aspirational until the Bank key is set up.

OK that's fine.

Now let me look at the redeem/co-signer integration. The customer's transaction flow:
1. Customer builds transaction (with their owner's signature)
2. Submits to Bank (somehow - TBD)
3. Bank runs cosign.mjs (with --live)
4. cosign.mjs adds Bank's signature
5. Customer broadcasts

Step 4 requires the Bank's key. Where is the Bank's key? In `KEYFILE = /opt/cbob-vaults/bank/keys/bank.json`. This doesn't exist yet.

OK fine.

Let me look at one more thing - the off-curve owner check. The judge checks `isOnCurve(owner)`. If true, ok. If false, refuse. If null (unreadable), allow.

Wait, what if owner is null/undefined? `if (owner)` is false, no check. OK.

What if owner is an empty string? `new PublicKey('')` throws. isOnCurve catches it and returns null. So ok.

What if owner is malformed pubkey (not 32 bytes)? `new PublicKey(k).toBytes()` throws. Caught, returns null. So ok.

Hmm. The judge then has `if (ok === false) bad.push(...)`. If null, no push. ✓

But here's a thought - what about a PDA that's off-curve but the customer tries to wrap it in a smart wallet? The cosign would refuse (off-curve). But the on-chain check also rejects PDA owners (well, requires signature). So the customer's transaction fails on-chain too. ✓

OK the cosign is reasonably defensive.

Let me now think about what might be ACTUALLY broken.

Hmm. Let me look at the LOCK's releaseLock:
```javascript
export function releaseLock(file, token) {
  let held = = null
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (e) { return e.code === 'ENOENT' }
  if (!token || held?.token !== token) return false
  try { fs.unlinkSync(file) } catch { /* already gone */ }
  return true
}
```

Returns true on success, false if not the holder or ENOENT. Wait, ENOENT returns `e.code === 'ENOENT'` which is `false`. So it returns false if file is missing.

Hmm, but if the file is missing (lock already released), should releaseLock return true (success - lock was already not held by us) or false (no lock to release)?

Actually returning false means "you didn't release the lock" but the lock is also not held. So the caller might think they failed. But actually the state is correct.

In withLock:
```javascript
finally {
    if (!releaseLock(file, l.token)) {
      console.error(`WARNING: did NOT release ${file} — it no longer carries this run's token. `
        + 'Another runner holds it now; this run may have been running beside it.')
    }
}
```

So if releaseLock returns false, withLock logs a warning. This warning would fire if:
1. The file is missing (ENOENT)
2. The file has a different token (someone else holds)

Case 1: lock was already released. Should this be a warning? Well, if the lock was released by someone, then another runner holds. So the warning is appropriate.

Case 2: lock was taken by another. Definitely a warning.

OK releaseLock is fine.

But wait - `return e.code === 'ENOENT'` - this returns a BOOLEAN. If ENOENT, returns true (because ENOENT === 'ENOENT' is true). Hmm wait, 'ENOENT' is a string. e.code === 'ENOENT' is true if e.code is 'ENOENT'. So if ENOENT, returns true. Hmm that seems wrong.

Let me re-check. If file is missing, what does releaseLock return?
- fs.readFileSync throws with e.code === 'ENOENT'
- catch returns e.code === 'ENOENT' which is `true`
- So returns true

So ENOENT returns true (lock "released" successfully). Other errors return... actually no, only ENOENT is caught. Other errors propagate.

Hmm wait, looking again:
```javascript
try { held = JSON.parse(fs.readFileSync(file, 'utf8')) }
catch (e) { return e.code === 'ENOENT' }
```

If e.code === 'ENOENT', return true.
If e.code !== 'ENOENT', return e.code === 'ENOENT' which is false.

Wait no, if the catch fires, the return statement runs. It returns `e.code === 'ENOENT'`. For ENOENT, returns true. For other errors, returns false (because e.code !== 'ENOENT').

But other errors should propagate, not be silently caught. The author probably intended:
```javascript
catch (e) {
    if (e.code === 'ENOENT') return true
    throw e
}
```

But as written:
```javascript
catch (e) { return e.code === 'ENOENT' }
```

This is functionally:
- If ENOENT: returns true
- If not ENOENT: returns false (silently)

Hmm, but for non-ENOENT errors (EACCES, EIO, etc.), we'd want to throw. As written, they return false, which the caller interprets as "didn't release". But the issue is more severe (disk error, etc.).

Actually looking at the comment:
```javascript
/** Unlink ONLY a lock still carrying this run's token. Returns whether it did.
 *  A lock that has been broken out from under us is left alone: it belongs to
 *  whoever holds it now, and deleting it is how a third runner gets in. */
```

So the return is "whether it released". ENOENT (file gone) - the lock WAS released (we don't need to do anything). Other errors - it's ambiguous.

Hmm actually for non-ENOENT errors, the right thing is to throw. But the current code returns false. So a disk error would be hidden.

Wait wait wait. Let me re-read more carefully:

```javascript
try { held = JSON.parse(fs.readFileSync(file, 'utf8')) }
catch (e) { return e.code === 'ENOENT' }
```

The try is INSIDE the catch. The catch returns the boolean. So if readFileSync throws (e.g., ENOENT), we catch and return. If JSON.parse throws, we catch and return.

JSON.parse can throw SyntaxError, which has e.code === undefined. So `e.code === 'ENOENT'` is `undefined === 'ENOENT'` which is false. So JSON.parse errors return false.

For readFileSync with EACCES, e.code === 'EACCES', not 'ENOENT'. So returns false. Silently swallows permission errors.

For readFileSync with ENOENT, returns true.

Hmm. This is a bit sloppy. Non-ENOENT errors should probably propagate. But as written, they return false.

Actually, looking at this more carefully, the return value's interpretation in the caller (withLock):
```javascript
if (!releaseLock(file, l.token)) {
    console.error(`WARNING: did NOT release ${file} ...`)
}
```

So if releaseLock returns false, log a warning. If returns true (e.g., ENOENT), no warning.

But if EACCES (disk error), we want to know. The warning says "did NOT release", which covers this case. So the caller is informed.

OK so the behavior is: any error during release logs a warning. Acceptable.

But actually, the original intent might have been to specifically handle ENOENT as success (lock already gone). Other errors are unexpected and the warning is appropriate.

OK releaseLock is fine.

Now let me look at the version check. MINT's `apply_pending_*`:
```rust
pub fn apply_pending_admin(ctx: Context<ApplyPendingGovernance>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.config;
    require_keys_neq!(c.pending_admin, Pubkey::default(), MintError::NoPendingGovernance);
    require!(now >= c.pending_admin_at, MintError::GovernanceTimelockActive);
    c.admin = c.pending_admin;
    c.pending_admin = Pubkey::default();
    c.pending_admin_at = 0;
    ...
}
```

So apply_pending_admin checks pending_admin, not pending_bank. The other `apply_pending_*` similarly.

But wait - apply_pending_admin does NOT touch the bank rotation. The header says:
> IT DOES NOT TOUCH THE BANK ROTATION. It did, because the two-line clear was pattern-matched into this handler as well as into `initialize` — so a permissionless `apply_pending_admin` silently deleted a Bank rotation that was waiting out the same notice period

So apply_pending_admin doesn't touch pending_bank. ✓

But wait - what about a permissionless `apply_pending_governance`? Does it touch bank or admin?

Looking at apply_pending_governance:
```rust
pub fn apply_pending_governance(ctx: Context<ApplyPendingGovernance>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.config;
    require_keys_neq!(c.pending_governance, Pubkey::default(), MintError::NoPendingGovernance);
    require!(now >= c.pending_governance_at, MintError::GovernanceTimelockActive);
    c.governance = c.pending_governance;
    c.pending_governance = Pubkey::default();
    c.pending_governance_at = 0;
    ...
}
```

Only touches pending_governance. ✓

OK these are fine.

Hmm let me look at the scanPda one more time. The DAS `getAssetsByOwner`:

The Bank's PDA address is the asset-signer PDA: ["mpl-core-execute", asset]. This PDA could own Core assets if a vault was transferred into it.

DAS's `getAssetsByOwner` typically queries by wallet pubkey. It might or might not work for PDAs. If it doesn't work, the scan returns empty, and the Bank misses nested vaults.

The author acknowledges this. But it's a critical gap - if DAS doesn't index PDA-owned assets, the cosign is silent on nested vaults for that case.

Let me see if there's a way to confirm. The DAS API might have a separate method for this, like `getAssetsByOwner` with a `showZeroBalance` option or `tree` option.

Actually, looking at the Metaplex DAS docs (from memory), `getAssetsByOwner` works for any owner, including PDAs. But this depends on the DAS provider's indexing. Helius's DAS might index PDA owners.

The author writes: "The DAS full-page refusal at limit 1000. Is it the right guard, and is it the ONLY way that call can fail to answer?"

So the author is aware. The 1000 limit guard is to detect truncation. But what about errors? The current code:
```javascript
const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'c', method: 'getAssetsByOwner',
      params: { ownerAddress: pda.toBase58(), page: 1, limit: 1000 } }) })
const j = await r.json()
if (j.error) throw new Error(`DAS getAssetsByOwner: ${JSON.stringify(j.error)}`)
for (const it of (j.result?.items || [])) {
    if (it.burnt) continue
    owned.push({ address: it.id, kind: 'asset' })
}
if ((j.result?.items || []).length >= 1000) throw new Error('DAS returned a full page for one PDA — refusing to judge a truncated list')
return owned
```

If DAS returns an error, throws. If returns empty (no assets), returns empty owned. If returns full page, throws.

But what if DAS returns SUCCESS but with fewer items than expected? The check is `length >= 1000`. If length < 1000, no error. The scan accepts the partial result. But maybe DAS just paged through and we missed the rest?

Actually, the call is `page: 1, limit: 1000`. So we ask for page 1 of up to 1000 items. If the response has 1000 items, there might be more pages. The check throws.

But what if DAS doesn't paginate and just returns all items, capped at 1000? Then length < 1000 means we've got everything. But we can't tell.

The author's guard is `>= 1000`. If 1000, refuse. If < 1000, accept. This is a reasonable heuristic.

But what if DAS's actual behavior is different? What if `getAssetsByOwner` returns ALL items in one call, with no pagination? Then length < 1000 is fine, and >= 1000 is the cap.

Or what if DAS paginates but the page parameter is different? We'd miss the rest.

The author notes this is something to verify. Without running the code, I can't confirm.

OK let me look at a different angle - the `enumeration` gap.

Actually, the prompt asks:
> What value can a PDA hold that this scan does not see?

The scan sees:
- Token accounts on SPL
- Token accounts on Token-2022
- Core assets via DAS

The scan does NOT see:
- Token accounts on Token-2022 if the ATA is not standard (custom length)
- Native SOL held by the PDA (but the burn refuses if PDA has SOL, so the sweep handles this)
- Tokens held in unknown token programs
- Core assets not indexed by DAS (e.g., if DAS hasn't indexed the vault yet)

For the burn's emptiness proof, the scan needs to know all the token accounts. If the scan misses any, the burn proceeds and destroys the value.

Hmm, are there other token programs on Solana? SPL Token (Tokenkeg) and Token-2022 are the standard. There's also "Token Extensions" which is just Token-2022. Any other token program? Probably not standard, but a custom program could be deployed.

If someone created a token account on a custom program... that's exotic but possible. The scan would miss it.

For DAS Core assets: DAS might not index all PDA-owned assets. But this is a provider-level issue.

OK the gaps are acknowledged. Let me move on.

Let me think about the carry-over list:

> 1. Cross-pass correlation lag: if the signature walk reaches the burn in a LATER pass than the DAS diff, the CRITICAL already went out and nothing retracts it.

This is a real issue. The fix mentioned: "a short memory of recently-seen `burn_via_program` assets." Not implemented in this round. So still an open gap.

> 2. Compute units are unmeasured anywhere.

The comment says "max 200K CU, 1.4M CU is the limit." Not measured. Open.

> 3. `prog.*.hash` slices at a fixed offset 45, which is wrong when a program's upgrade authority is absent.

Looking at alarm.mjs:
```javascript
const hasAuth = acc.data[12] === 1
snap[`prog.${name}.upgrade_authority`] = hasAuth
    ? new PublicKey(acc.data.subarray(13, 45)).toBase58()
    : 'IMMUTABLE'
snap[`prog.${name}.hash`] = createHash('sha256').update(acc.data.subarray(45)).digest('hex').slice(0, 32)
```

So if hasAuth is false, hash starts at offset 45 (where the ELF would normally begin). If hasAuth is true, the authority is at 13..45, then ELF at 45.

Hmm wait, if hasAuth is true:
- [12] = 1 (Some)
- [13..45] = authority pubkey
- [45..] = ELF

If hasAuth is false:
- [12] = 0 (None)
- [13..] = ELF (no authority bytes)

So the hash should be data.subarray(13) when hasAuth is false (skip the discriminant byte, then ELF starts at 13). When hasAuth is true, ELF starts at 45 (after discriminant + 32-byte authority).

But the code does `acc.data.subarray(45)` in both cases. If hasAuth is false, this skips 32 bytes of the ELF! That's wrong!

Let me confirm the layout. From the Solana docs (from memory):
ProgramData layout:
- [0..4]: enum (u32 LE) - should be 3 for upgradeable
- [4..12]: slot (u64 LE) - the slot the program was last upgraded
- [12]: Option<Pubkey> - discriminant (0 = None, 1 = Some)
- if Some: [13..45] = upgrade authority pubkey
- if None: [13..] = ELF starts here (after just the discriminant byte)
- [if Some: 45..] = ELF starts here

So the ELF starts at offset 13 if no authority, or 45 if authority.

The code hashes `acc.data.subarray(45)` regardless. So for an immutable program, this includes 32 bytes of the ELF as part of the "hash" slice that doesn't matter, but it's actually skipping the first 32 bytes of the ELF!

So the hash for an immutable program is `sha256(ELF[32..])`, not `sha256(ELF)`. This is WRONG.

This is the carry-over finding #3:
> `prog.*.hash` slices at a fixed offset 45, which is wrong when a program's upgrade authority is absent (the ELF starts at 13 then). Now applies to Core too.

The author notes this but doesn't fix it. So the hash is wrong for immutable programs.

How does this manifest in the alarm? The hash is used to detect drift. If a program's hash changes between passes (real upgrade), the alarm fires CRITICAL. If the hash is computed wrong (skipping 32 bytes), then a real upgrade that changes the skipped bytes might not be detected.

But wait - if a program is immutable, there's no upgrade authority. So there's no upgrade to detect. The hash is still useful for detecting... what? Nothing, really. Immutable programs don't change.

But the hash is also used to compare to the pinned mainnet dump. If the alarm's hash is computed wrong, it might not match the pinned dump, and the alarm would fire a false CRITICAL on every run.

Hmm wait, but currently the four programs are upgradeable (the upgrade authority is set). So the hash is computed correctly (45 is right). The bug only manifests for immutable programs.

But Core might be immutable on mainnet. If Core is immutable, the hash is wrong. If the alarm compares this hash to a pinned dump (which IS the right hash), the alarm might see drift that isn't real.

Actually looking at alarm.mjs:
```javascript
snap[`prog.${name}.hash`] = createHash('sha256').update(acc.data.subarray(45)).digest('hex').slice(0, 32)
```

This is stored as `prog.core.hash`. The drift detector compares to prev's hash. If the program is immutable, the hash never changes, so no drift.

The pinned hash from `probe-mainnet-facts.mjs` is for mainnet. Mainnet might have Core as immutable or upgradeable. If immutable, the alarm's hash is wrong, but mainnet doesn't change, so drift doesn't trigger.

Actually this might be a non-issue in practice, because:
1. Mainnet's Core doesn't change (or changes rarely)
2. When it changes, the upgrade authority is exercised, which means it has an authority, so hasAuth is true, so offset 45 is correct.

So the bug only matters if:
- The program is currently immutable
- And we want to hash the ELF

In production, the four programs are upgradeable (with the Squads multisig). Core on mainnet - I'd have to check. If Core has an upgrade authority, this bug doesn't affect the alarm.

OK so the bug is real but only matters in specific scenarios. The author carries it forward.

Let me move on to other things.

Actually wait, I realize there's one more potential issue. Let me look at the judge's:

```javascript
const declared = (burn.accounts || []).slice(cfg.burnFixedAccounts)
const stated = burn.data?.[cfg.burnDisc.length]
if (stated !== declared.length) {
    bad.push(`burn_vault states ${stated} declared accounts but carries ${declared.length}`)
}
```

The judge checks that the stated count matches the declared count. Good.

But the burn instruction's data format: discriminator (8 bytes) + u8 (declared count) + ... So burn.data[8] is the declared count. ✓

But the judge uses `cfg.burnDisc.length` which is 8. ✓

OK that's right.

Now let me think about what else could be wrong. Let me look at the lock's release path with attention to cleanup:

```javascript
try { fs.unlinkSync(stolen) } catch { /* nothing to clean */ }
```

If unlink fails (file already gone), swallow. OK.

But what if multiple restore attempts leave multiple .breaking files? Let me check the test:
```javascript
t('the steal leaves no temp file behind',
    fsx.readdirSync(fsx.existsSync(L) ? '.' : '.').filter(x => x.includes('.breaking.')).length, 0)
```

This checks for `.breaking.` files. The test expects 0. So after the test runs, no `.breaking.*` files should remain.

In the misSteal test:
- `stolen` is created via rename
- Read it
- Restore path: opens L with wx, writes content, closes
- Unlink stolen
- Returns lostRace

So `stolen` is unlinked. ✓

What if the rename throws ENOENT (file already gone)? The catch returns lostRace. No `stolen` file to clean up. ✓

What if claim fails after a successful rename? Then:
- `stolen` exists
- Try to claim (which uses temp file + linkSync). linkSync to file. If linkSync fails (file exists from another racer), claim fails.
- `try { fs.unlinkSync(stolen) } catch { /* nothing to clean */ }` - unlinks stolen

So stolen is unlinked. ✓

What about the case where rename succeeds but takenToken matches held.token, then claim fails?
- stolen has held.token content (because takenToken === held.token means stolen content matches what we read)
- claim tries to linkSync to file. If file exists (somehow), claim fails. (But we just ren'd it, so file shouldn't exist.)
- Actually wait, `rename` moves file to stolen. So file (L) doesn't exist after rename.
- claim creates temp file, linkSync(temp, file). file doesn't exist, linkSync succeeds. claim returns true.

So claim should always succeed if rename succeeded and takenToken matches. Unless a racer recreates file at L in between. Let me trace:

A: read L = T_old
A: rename L -> .breaking.T_a
B: sees .breaking.T_a exists, but doesn't have access. (B can't really see it unless B is also racing for L)
... actually B would see L doesn't exist, claim fresh lock at L.
A: claim(L) - L exists (B's lock). claim fails (EEXIST).

So if B races in between A's rename and A's claim, A's claim fails. A returns lostRace. ✓

In the misSteal case:
- A reads L = T_old
- _beforeSteal: B claims L (fresh)
- A: rename L -> .breaking.T_a. L no longer exists, .breaking.T_a has B's content.
- A: read .breaking.T_a = B's content. takenToken = B's token, != T_old. Restore path.

So we don't reach the `claim` step. We restore.

OK the lock is correct.

Let me think about something different. The `applyAcks` function:

```javascript
export function applyAcks(findings, acks = {}) {
  return findings.map.map((f) => {
    if (!f.asset || !f.kind) return f
    const why = acks[`${f.kind}:${f.asset}`]
    if (typeof why !== 'string' || !why.trim()) return f
    return { ...f, severity: S.INFO, acked: true,
      detail: `${f.detail}\n     ACKNOWLEDGED: ${why.trim()}` }
  })
}
```

The acks key is `<kind>:<asset>`. So an ack applies to one kind on one asset. ✓

What if acks contains the same key multiple times? Well, acks is a JS object, so duplicates collapse. ✓

What if `f.kind` contains a colon? Like `burn_via_program` - no colon. But other kinds might. Like `unredeemable_owner` - no colon. The current findings have single-word kinds, so this is fine.

What if `f.asset` is null or undefined? The condition `if (!f.asset || !f.kind) return f` skips. ✓

OK applyAcks is correct.

Hmm let me also think about how the cosign tool is invoked. Currently, there's no infrastructure. So in practice, no redemptions go through the cosign.

For round 14 carry-overs:
> 6. Compute units are unmeasured — a second ceiling that may sit below the byte ceiling (four auditors).

CU ceiling: Solana's transaction limit is 1.4M CU for a transaction. Each instruction uses CU. BURN's emptiness proof iterates over declared accounts, each check takes CU. For with 3 reserve mints × 2 token programs × ~5 checks per account = 30 checks. Each check is a few CU. Plus the rest of the transaction.

Probably fits in 200K CU. But not measured.

Let me move on.

Actually, let me carefully look at the comments for R4 - the drift in either direction. The author fixed the "claim exists" direction (claim non-existent controls). Now I should check for "deny exists" (claim a control doesn't run when it does).

Let me grep through the diff for comments...

Looking at the new cosign.mjs, the header is accurate. It describes what the tool does and what it cannot do.

Looking at detectors.mjs:
- `judgeRedemptionTx` docstring: accurate
- `judgeRedemptionCoverage` docstring: accurate
- `parseAcks` docstring: accurate
- `applyAcks` docstring: accurate
- `detectNestedVaults` docstring: accurate

In alarm.mjs:
- applyAcks wired in with comment: accurate
- parseAcks: accurate

In lock.mjs:
- the new atomic rename comment: accurate
- _beforeSteal seam: accurate

In BURN's lib.rs:
- The "WHAT ACTUALLY COVERS IT" paragraph points to SPEC.md. ✓

In SEAL's lib.rs:
- The "WHAT ACTUALLY COVERS IT" section: ✓

OK comments are clean.

Let me look at the Bank rotation question. The challenge:
> Only TWO reserve mints fit if the redeemer must create their destination ATAs - so ATA creation MUST be a prior transaction. Is that written requirement sufficient, and what happens if a client ignores it?

The SPEC says:
> ⚠️ AND ONLY TWO FIT IF THE REDEEMER MUST CREATE THEIR DESTINATION ATAs (measured, 9.14b: 1 -> 991, 2 -> 1215, 3 -> over). Every other number here assumes the redeemer already owns an ATA for each reserve mint. A first-time redeemer does not. Creating them is not required to be atomic with the burn — unlike the sweep — so it MUST be a prior transaction. That is an operational requirement on any redemption client, it was a silent assumption until round 14, and a client that naively folds the creation into the redemption fails at three reserve mints.

OK written in SPEC. If a client ignores it, they get a transaction that's too big. Solana rejects with TransactionTooLarge. The customer's transaction fails. They pay SOL on fees.

But wait - is this actually rejected by Solana? Let me think. The transaction is too big to serialize. The customer's wallet might catch it client-side. Or it might try to send and get rejected by the network.

Either way, no fund loss. Just bad UX.

Hmm, but the wallet might keep retrying, paying fees each time. Or might charge a fee for the failed transaction. Either way, customer inconvenience, not project loss.

OK this is acceptable.

Now let me think about the verdict challenge:
> "Only TWO reserve mints fit if the redeemer must create their destination ATAs" - so ATA creation MUST be a prior transaction. Is that written requirement sufficient, and what happens if a client ignores it?

The requirement is written. If ignored, transaction fails. Acceptable.

But here's a thought - what if the Bank's cosign is run on a transaction that includes ATA creation? The cosign checks shape, asset/owner binding, etc. The cosign doesn't check transaction SIZE. So the cosign would bless a transaction that's too big.

But the customer can't broadcast a too-big transaction anyway. So no actual loss.

The Bank's signature is wasted (the customer can't use it), but that's the customer's problem.

OK.

Let me look at one more thing. The judgeRedemptionTx iterates over `ixs`:

```javascript
const ixs = tx.instructions.map(ix => ({
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map(k => k.pubkey.toBase58()),
    data: [...ix.data],
  }))
```

But tx.instructions might be empty for some transactions. Or might not exist if it's a versioned transaction.

Actually, Transaction.from() is for legacy transactions. If the input is a versioned transaction, it throws. So the cosign tool can't process versioned transactions.

The customer's transaction must be legacy (no versioned, no ALT). This is a constraint on the customer.

What if a customer wraps their transaction as a versioned transaction to bypass the Bank's shape check? They can't, because the Bank's tool can't parse it. The Bank would fail to add its signature. The customer's transaction can't be signed by the Bank.

So the customer must use legacy transactions. ✓

But wait - what about Address Lookup Tables (ALT)? Versioned transactions can use ALTs. Legacy transactions can't. The customer can't use ALTs in a legacy transaction.

But the spec says a fourth reserve mint requires ALT to fit. So if we ever add a fourth mint, the customer would need ALT, which means versioned transactions, which means the cosign tool can't handle them.

So the cosign tool would NEED to be updated for a fourth mint. This is a known limitation (we don't add a fourth mint).

OK.

Actually hmm, there's a subtle issue. The customer's transaction might be intended for versioned submission, but the cosign tool fails to parse. The Bank doesn't sign. The customer's transaction never gets the Bank's signature. They need to use legacy.

If the customer is forced to legacy, they lose ALT support. For 3 reserve mints, this is OK (1119 bytes fits legacy). For 4+ reserve mints, they need versioned. ✓ (consistent with MAX_RESERVE_MINTS = 3)

Now let me think about the SEAL config. The pin:
```javascript
const data = pinnedAccountData(acc, { program: SEAL, struct: 'Config', version: 1, what: 'the SEAL config' })
```

pinnedAccountData verifies the discriminator and version byte. The SEAL config has discriminator `account:Config` and version 1. ✓

The offset for bank is 73. Config struct:
```rust
pub struct Config {
    pub version: u8,             // offset 8
    pub admin: Pubkey,           // 9..41
    pub collection: Pubkey,      // 41..73
    pub bank: Pubkey,            // 73..105
    ...
}
```

So bank is at 73..105. ✓

Now the BURN program reads the same config:
```rust
let reserves: Vec<Pubkey> = {
    let d = ctx.accounts.seal_config.try_borrow_data()?;
    require!(d.len() >= OFF_RESERVES + 4, BurnError::BadSealConfig);
    require!(d[..8] == SEAL_CONFIG_DISC, BurnError::BadSealConfig);
    require!(d[OFF_VERSION] == SEAL_CONFIG_VERSION, BurnError::SealConfigVersion);
    let mut c = [0u8; 32]; c.copy_from_slice(&d[OFF_COLLECTION..OFF_COLLECTION + 32]);
    let mut b = [0u8; 32]; b.copy_from_slice(&d[OFF_BANK..OFF_BANK + 32]);
    require_keys_eq!(Pubkey::new_from_array(c), cfg.collection, BurnError::WiringDiverged);
    require_keys_eq!(Pubkey::new_from_array(b), cfg.bank, BurnError::WiringDiverged);
    let n = u32::from_le_bytes([d[OFF_RESERVES], d[OFF_RESERVES + 1], d[OFF_RESERVES + 2], d[OFF_RESERVES + 3]]) as usize;
    require!(n > 0 && n <= MAX_RESERVE_MINTS, BurnError::NoReserveMints);
    require!(d.len() >= OFF_RESERVES + 4 + n * 32, BurnError::BadSealConfig);
    (0..n).map(|i| {
        let o = OFF_RESERVES + 4 + i * 32;
        let mut k = [0u8; 32]; k.copy_from_slice(&d[o..o + 32]);
        Pubkey::new_from_array(k)
    }).collect()
};
```

So BURN reads the reserve_mints Vec from the SEAL config. It uses OFFSET 105 for the Vec length, 109 for the first mint.

Now there's a subtle issue. BURN's check is:
```rust
require_keys_eq!(Pubkey::new_from_array(c), cfg.collection, BurnError::WiringDiverged);
require_keys_eq!(Pubkey::new_from_array(b), cfg.bank, BurnError::WiringDiverged);
```

So BURN verifies that the SEAL config's collection matches its own cfg.collection. And SEAL config's bank matches BURN's cfg.bank.

But what if SEAL's bank (in SEAL config) differs from what the Bank in BURN's config? BURN checks. ✓

And BURN's bank is what the BURN's burn_vault requires:
```rust
require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, BurnError::NotTheBank);
```

So BURN's bank must sign. The Bank's Bank pubkey is from BURN's config, which is verified to match SEAL's config. ✓

So the Bank pubkey is consistent across programs. ✓

Now let me think about the cosign tool's Bank reading. It reads the SEAL config's bank. But the Bank's signature is for BURN (the burn_vault instruction). So the cosign checks BURN's bank, not SEAL's bank.

Wait, let me re-read. The cosign reads SEAL config to get bank. But the bank in burn_vault is from BURN's config. If BURN's bank differs from SEAL's bank, the cosign would check against SEAL's bank, but burn_vault requires BURN's bank.

But BURN checks that SEAL's bank matches BURN's bank (WiringDiverged). So if BURN's burn_vault is to be called, BURN's bank must match SEAL's bank. And the cosign verifies SEAL's bank is in the burn_vault's accounts.

So the cosign is consistent.

OK I think I've covered most of the code. Let me look at the off-curve owner check more carefully:

```javascript
if (owner) {
    let ok
    try { ok = isOnCurve(owner) } catch { ok = null }
    if (ok === false) bad.push(`the owner ${owner} is OFF-CURVE ...`)
}
```

But the Bank should check that owner SIGNED, not just that owner is on-curve. Let me think...

Actually, the seal program requires `owner: Signer<'info>`. If owner didn't sign, on-chain fails. So the customer's transaction fails on-chain.

But the Bank should catch this BEFORE signing. The Bank should check that owner is a signer.

But the cosign tool doesn't check signers. It only checks shapes. So a transaction where owner is not a signer would be blessed by the Bank, then fail on-chain.

Is this a security issue? No, because no funds move on-chain. The Bank's signature is wasted.

Is this a UX issue? Yes, the customer wastes time and fees. They need to construct a valid transaction.

So the cosign is not catching all errors. But it doesn't claim to. It catches a SUBSET of errors.

OK so this is a minor improvement opportunity, not a critical bug.

Hmm let me look at a specific scenario: what if the customer crafts a transaction where:
- The OWNER slot is filled with a DIFFERENT keypair (not actually the owner of the asset)
- The customer signs with this keypair
- The Bank sees a valid signature
- The Bank signs

The seal program requires owner: Signer<'info>. But it ALSO checks the asset's owner matches:
```rust
let (asset_owner, collection) = read_core_asset(&ctx.accounts.vault_asset)?;
require_keys_eq!(asset_owner, owner, VaultError::NotTheOwner);
```

So owner (the signer) must match the asset's owner (read from chain). If they differ, NotTheOwner.

But on-chain, the asset's owner is stored in the Core asset data. So the seal program verifies this.

But the cosign doesn't verify this. It just checks the shape. The on-chain check would catch a wrong owner.

OK so this is fine.

What about: the customer signs with the correct owner keypair, but the cosign tool's check of on-curve fails (e.g., the owner is a PDA). The cosign refuses. Good.

But what if the on-curve check passes (owner is a real keypair), but the customer doesn't actually have that keypair (it's some random keypair)? They can't sign with it, so the transaction fails on-chain (no signature). But the cosign would bless it.

Hmm. The cosign doesn't check that signatures actually exist.

Actually wait - the customer provides a signed transaction. The cosign sees the signatures. So if owner didn't sign, the transaction has fewer signatures than required. But the cosign doesn't check.

Actually, looking at `Transaction.from()` - this deserializes without verifying signatures. So the cosign sees the transaction as-is, including whatever signatures are there.

To check signatures, the cosign would need to:
1. Parse the signatures
2. For each required signer, verify their signature is in the set

But the cosign doesn't do this. So a transaction with missing signatures would be blessed.

This is a weakness but not a critical bug (on-chain fails).

OK let me move on.

Hmm let me look at the test for "a well-formed redemption is ACCEPTED":
```javascript
const mkOpen = (a = AST, o = OWN, b = BANKK) =>
    ({ programId: SEALP, data: OPEN_D, accounts: [a, 'coll', o, b, 'p', 'cfg', 'seal', 'core', 'sysvar', 'sys'] })
const mkBurn = (a = AST, o = OWN, b = BANKK, decl = []) =>
    ({ programId: BURNP, data: [...BURN_D, decl.length],
       accounts: [a, 'coll', o, b, 'signer', 'payer', 'cfg', 'sealcfg', 'sysvar', 'core', 'sys', ...decl] })
const j = (ixs) => D.judgeRedemptionTx(ixs, CFG, curve)

t('a well-formed redemption is ACCEPTED', j([mkOpen(), 'sweep', mkBurn()].filter(x => x !== 'sweep')).ok, true)
```

Hmm, this filters out 'sweep' (the string). Then passes [mkOpen(), mkBurn()] to j. The order check is open before burn (indexOf(open) < indexOf(burn)). ✓

What about a transaction with TWO burn_vault and ONE open_for_redemption? The judge:
```javascript
if (opens.length !== 1 || burns.length !== 1) {
    bad.push(`expected exactly one open_for_redemption and one burn_vault, found ${opens.length} and ${burns.length}`)
    return { ok: false, reasons: bad, ... }
}
```

If burns.length !== 1, returns fail. ✓

But what about TWO open_for_redemption and ONE burn_vault? opens.length !== 1, fails. ✓

What about ONE open_for_redemption and ZERO burn_vaults? fails. ✓

What about ZERO open and ONE burn? fails. ✓

OK shape check is sound.

What about a transaction with the burn BEFORE the open? `if (ixs.indexOf(open) > ixs.indexOf(burn)) bad.push(...)`. ✓

What about a transaction with the open AFTER the burn? Same, fails. ✓

OK.

Hmm let me look at one more thing. The judge's `state: 'absent'` for SPL accounts:

```javascript
if (amount !== '0') owned.push({ address: pubkey.toBase58(), amount, kind: 'token' })
```

The scan only adds non-zero accounts. What about an account with a delegate set but zero balance? The scan doesn't add it.

The burn would refuse on declared account with delegate. So if the customer declares this account, burn refuses. ✓

But if the customer doesn't declare, burn doesn't see it. After burn, the delegate could... wait, the account has 0 balance. The delegate has nothing to drain.

But wait - the delegate could close the account and take the rent. The rent is small (~0.0014 SOL). Not a fund loss for the customer.

But what about an account with a delegate AND a balance? The scan adds it (because non-zero). The customer must declare it. If they don't, burn doesn't see it, but the account has balance. After burn, delegate drains.

But wait - the sweep happens before the burn. The sweep transfers tokens out of declared accounts. But undeclared accounts aren't swept. So an undeclared non-reserve account on the PDA with balance survives the sweep.

After burn, the asset is gone. The PDA is unsignable. The delegate can transfer tokens out of the undeclared account.

Hmm so this IS a vulnerability IF the customer can plant a delegate on a non-reserve SPL account on the PDA during the thaw. Let me think about this...

The customer is the owner of the asset. During the thaw, the customer can sign Core ExecuteV1 instructions. Core Execute allows arbitrary instructions (including SPL Token approve). So the customer can:
1. Core Execute: SPL Token approve on a non-reserve SPL account owned by PDA, setting delegate to accomplice
2. Core Execute: SPL Token transfer (or just have balance already there)
4. Burn (don't declare this account)

Wait but for SPL Token approve, the PDA must be the authority. The PDA is the owner of the token account. Approve requires the token account's owner authority. The PDA can sign via Core Execute (because Execute allows PDA to sign). So approve via Core Execute is allowed.

So the customer can plant a delegate during the thaw, on a non-reserve SPL account owned by PDA, with balance in it.

Then NOT declare this account in burn_vault. Burn proceeds. Asset destroyed.

After burn, the delegate can transfer the balance out (the PDA still owns the account, delegate can transfer up to delegated amount).

Wait, the customer themselves can transfer during the redemption (via Core Execute, since they're the asset owner). So they could just transfer the tokens to themselves. Why use a delegate?

Hmm, maybe the customer's transaction has a constraint. Or maybe the accomplice scenario is the concern.

Let me think about the accomplice scenario:
- Mallory wants to drain Alice's vault
- Alice initiates a redemption (thaw)
- During the thaw (one transaction), Mallory... wait, Mallory can't be involved in Alice's transaction

So this isn't really a vulnerability from Mallory's perspective. The customer themselves is the one calling redeem. They wouldn't drain their own vault.

UNLESS the customer is malicious and wants to drain a vault that doesn't belong to them. But then they'd need to be the asset owner.

So the only "attack" is: a customer who legitimately owns a vault plants a delegate for some reason, then drains via delegate after burn. But they could just drain via Core Execute during thaw. The delegate adds nothing.

Hmm OK so this is not really exploitable.

Actually wait - there's a subtlety. The customer might want to drain tokens that are LOCKED somehow. Like, if the customer's Core Execute is somehow limited, the delegate gives another route.

But Core Execute has no limits. The customer can do anything. So delegate doesn't help.

OK so the delegate-on-undeclared-account scenario isn't really a fund-loss vector. Just an edge case.

But the BANK's cosign is the catch. The scan adds non-zero accounts. So if the customer has an undeclared account with balance, the scan catches it. The cosign refuses. ✓

So the cosign is the right control here.

Alright, let me now think about what I might be missing. Let me re-read the prompt.

The prompt is asking for CRITICAL/HIGH/MEDIUM/LOW findings. Let me think about what's actually broken vs just theoretical.

Actually, I realize I should look more carefully at the redeemer's transaction. The customer's transaction:
- Open (signed by owner and bank)
- Sweep (Core Execute by owner)
- Burn (signed by owner and bank)

The Bank's signature is added by the cosign tool. So the Bank signs it.

But what if the customer's transaction includes instructions that the seal/burn programs don't expect? The judge only checks SEAL and BURN. Other programs are unrestricted.

For example, the customer could include an instruction to a Jupiter program that does a swap. Or an instruction to some other program that affects state.

These other instructions could be malicious if the programs are compromised. But that's not the vault's concern.

The vault programs (SEAL, BURN, MINT, GOV) only see the instructions in their own sysvar introspection. The seal checks for a top-level burn_vault. The burn checks for a top-level open_for_redemption. Both look at top-level instructions only.

Wait, both look at TOP-LEVEL instructions only. So CPI instructions don't matter to the seal/burn introspection. ✓

But other top-level instructions could affect state. For example:
- A top-level instruction to MINT to rotate the treasury
- A top-level instruction to update a config

If these are in the customer's transaction and they're signed correctly, they'd execute. But the customer doesn't have MINT admin authority (MINT admin is the Squads multisig). So these instructions would fail with Unauthorized.

Wait, but a top-level instruction to update MINT config requires admin: Signer. The customer doesn't have that. So it fails. ✓

A top-level instruction to vote on a GOV proposal - requires the owner of the vault being voted. The customer has it. So this could work.

So the customer's transaction could include a vote. Hmm. The customer can vote AND redeem in one transaction. Is that OK? It's not a security issue, just an interesting capability.

OK no issue.

Let me look at a specific scenario: what if the customer adds a top-level instruction that does something destructive to the SEAL or BURN programs' state?

The seal program has update_config (admin). The customer isn't admin. So update_config fails.

The seal program has no other state-changing instructions that the customer can call (open_for_redemption is the only one, and it's gated).

So the customer can't affect SEAL/BURN state except via open_for_redemption and burn_vault. ✓

OK.

Hmm let me look at one more thing. The lock's release path with ENOENT. As I noted, returns true. So withLock doesn't log a warning. But actually wait:

```javascript
try { held = JSON.parse(fs.readFileSync(file, 'utf8')) }
catch (e) { return e.code === 'ENOENT' }
```

This returns the BOOLEAN, not throws. So withLock sees `releaseLock returns true`, which means "released successfully". But ENOENT actually means "already gone", which is "released by someone else".

Hmm, but actually if the file is gone, no one holds it. So "success" is correct.

But what if ENOENT happens because the file was deleted by accident (e.g., disk error, manual deletion)? The lock is just gone, no one holds it. Returning true is fine.

OK ENOENT handling is OK.

But wait, what if the file is missing because the lock was BROKEN by another process? Then the new process holds. Our `releaseLock` should not delete the new lock.

Let's trace:
1. Process A: acquire lock at L
2. Process B: tries to acquire, lock is fresh, fails
3. Process A: dies (lock not released)
4. After staleMs, Process B: acquires L by breaking A's lock
5. Process A's lock is at .breaking.T_a (then deleted by B's restore or claim cleanup)
6. Now L has B's lock
7. A's finally runs (in some weird scenario - maybe A is still alive but slow)
8. A calls releaseLock(L, A.token)
9. releaseLock reads L = B's lock. held.token = B's token, not A's. Returns false.

So A correctly doesn't release B's lock. ✓

What if A is dead and somehow its finally runs? Doesn't matter, A is dead.

What if A is alive but slow, and its lock was broken by B? A's `withLock` has a finally that calls releaseLock. If releaseLock returns false (B holds), A logs a warning. The warning indicates A's lock was taken by another. ✓

OK release is sound.

Now let me think about the ack file. The acks file is read with `readAcks`:

```javascript
function readAcks() {
    let raw
    try { raw = fs.readFileSync(ACKS, 'utf8') }
    catch (e) {
        if (e.code === 'ENOENT') return {}
        console.error(`acks file ${ACKS} is present but unreadable: ${e.message} — acking NOTHING`)
        return {}
    }
    const { acks, problem } = D.parseAcks(raw)
    if (problem) console.error(`acks file ${ACKS} is present but ${problem} — acking NOTHING`)
    return acks
}
```

So:
- File missing: return {} (no acks)
- File unreadable: log error, return {}
- File present but malformed: log error, return {}

In all "problem" cases, acks is empty. So no findings are downgraded. ✓

The first version of readAcks called `readFileSync` (without fs. prefix), which would ReferenceError. The catch... wait, ReferenceError is not caught by try/catch for fs errors. Actually, ReferenceError IS caught by try/catch because it's a throw.

Hmm, actually the original was:
```javascript
function readAcks() {
  let raw
  try { raw = readFileSync(ACKS, 'utf8') }  // bare readFileSync, no fs prefix
  catch (e) {
    if (e.code === 'ENOENT') return {}
    ...
  }
}
```

`readFileSync` without fs prefix would ReferenceError. The catch fires. e.code would be undefined. So returns... let me check: `e.code === 'ENOENT'` is `undefined === 'ENOENT'` which is false. Then... the next line would console.error and return {}. So it returns {} (no acks).

So the original readAcks would silently return empty acks. The whole mechanism wouldn't work. ✓ Fixed now.

OK the fix is correct.

Alright, let me look for things I might have missed.

Actually, I want to verify one thing. Let me look at `pinnedAccountData`:

```javascript
export function pinnedAccountData(acc, { program, struct, version = 1, what = 'config' }) {
  if (!acc) return null
  if (!acc.owner || acc.owner.toBase58() !== ! program.toBase58()) {
    throw new Error(...)
  }
  if (acc.data.length < 9) throw new Error(...)
  const want = accountDiscriminator(struct)
  if (!acc.data.subarray(0, 8).equals(want)) {
    throw new Error(...)
  }
  if (acc.data[8] !== version) {
    throw new Error(...)
  }
  return acc.data
}
```

OK, checks owner (program matches), checks discriminator, checks version. ✓

Then in cosign:
```javascript
const data = pinnedAccountData(acc, { program: SEAL, struct: 'Config', version: 1, what: 'the SEAL config' })
const bank = new PublicKey(data.subarray(73, 105)).toBase58()
```

So bank is read from offset 73..105 in the SEAL config. ✓

But wait - what if the SEAL config's reserve_mints Vec length is 0? Then offset 73..105 is bank, 105 is start of Vec. The Vec would have length 0, and the Vec data is empty.

In the SEAL config struct:
```rust
pub struct Config {
    pub version: u8,             // 8
    pub admin: Pubkey,           // 9..41
    pub collection: Pubkey,      // 41..73
    pub bank: Pubkey,            // 73..105
    pub reserve_mints: Vec<Pubkey>, // 105 onwards
    pub pending_bank: Pubkey,    // after Vec
    pub pending_bank_at: i64,
    pub pending_admin: Pubkey,
    pub pending_admin_at: i64,
    pub bump: u8,
}
```

OK bank at 73..105. ✓

What about the BURN program reading the same? Same offsets. ✓

OK.

Let me look at one more subtle thing. The BURN's reading of the reserve_mints Vec length:
```rust
let n = u32::from_le_bytes([d[OFF_RESERVES], d[OFF_RESERVES + 1], d[OFF_RESERVES + 2], d[OFF_RESERVES + 3]]) as usize;
```

OFF_RESERVES = 105. So reads bytes 105..109 as u32 LE. That's the Vec length. ✓

In Anchor's serialization, a `Vec<T>` is serialized as u32 length followed by elements. So this is correct.

What about the `require!(n > 0 && n <= MAX_RESERVE_MINTS, ...)`? MAX_RESERVE_MINTS = 3. So 1..=3. ✓

What about `require!(d.len() >= OFF_RESERVES + 4 + n * 32, ...)`? This checks the buffer is large enough for the Vec contents. ✓

OK.

Alright, let me try to find an actual bug now. Let me look at the carry-overs and the verdict challenges more carefully.

Verdict challenge 1: Admin exemption from detectBankIsNotSignable. I verified - none of the admin instructions break under PDA admin.

Verdict challenge 2: Closed-ATA delegate ALLOW. I verified - 3.3a tests this.

Verdict challenge 3: ATA creation prior transaction. I verified - written requirement, if ignored, transaction fails.

Let me look at the round 14 carry-overs:

1. Cross-pass correlation lag - acknowledged, fix proposed (memory of recent burn_via_program assets), not implemented. Still open.
2. CU not measured - acknowledged, not measured. Still open.
3. Hash slice at offset 45 wrong for immutable programs - acknowledged, not fixed.
4. Foreign Core asset nested in vault - not caught. Acknowledged.
5. burn_via_program doesn't verify asset is one of ours - correlation key is caller-supplied.
6. SPEC contradicts implementation on sweep authorization - acknowledged.
7. MINT carries dead redemption stamp - acknowledged.
8. Distribution reconciles against ledger payer wrote - acknowledged.
9. Duplicate attribute keys not rejected - acknowledged.

#5 is interesting. `burn_via_program` doesn't verify the asset is one of ours. So if someone calls `burn_vault(asset=X)` where X is NOT a CBOB vault, the burn fails on-chain (ForeignVault or similar). But the alarm sees a burn_via_program finding for X.

This X goes into viaProgram. Now any findings for asset X (like vault_burned) would be correlated. But X isn't a CBOB vault, so no findings for X exist. So no actual harm.

But the viaProgram set grows with non-CBOB assets. Over time, viaSet could grow large. But this isn't a memory issue since it's per-pass.

Hmm, actually, what if an attacker crafts many burn_vault calls with foreign assets? Each one creates a burn_via_program finding (INFO), which is added to viaProgram. The next pass's viaProgram is fresh, so this doesn't accumulate.

So #5 is theoretical. Not exploitable.

OK let me think about what might be a real bug...

Actually, let me look at the comment more carefully. R4 says "every such claim POINTS AT the control table in SPEC.md's 'THE SHIP GATE' section rather than restating it". Let me check if all the comments point to SPEC.md.

Looking at BURN's header:
> ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section — ONE place, so this can never drift from what actually runs.

OK, points to SPEC.md.

Looking at SEAL's header:
> ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section — ONE place, so a claim here can never drift from what actually runs.

OK, points to SPEC.md.

What about the comment in SEAL's Config doc:
> ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section — ONE place, so a claim here can never drift from what actually runs.

OK.

Now the SPEC.md "THE SHIP GATE" section - what's there?

Looking at SPEC.md, "THE CONTROL TABLE" is in the " UNBREAKING IS BURNING" section:
```
| control | what it catches | when |
|---|---|---|
| **`bank/cosign.mjs`** — the Bank's co-signer | the whole redemption, BEFORE a signature: the pair, the asset/owner binding, the Bank named in both, an off-curve owner, extra instructions to SEAL or BURN, a lying declared count, and **every token account or nested Core asset the vault holds that the burn does not declare** | **pre-signature** |
| `detectNestedVaults` (alarm, EVERY pass) | a CBOB vault owned by any vault's asset-signer PDA, a vault owned by its OWN, and any vault owned by an off-curve address | post-hoc, ≤30 min |
| `detectUndeclaredTokenAccounts` (`--reconcile`) | any token account a vault PDA owns that is not a canonical reserve ATA | post-hoc, daily |
```

OK so the SPEC.md table mentions detectUndeclaredTokenAccounts. But it says it catches "any token account a vault PDA owns that is not a canonical reserve ATA". This detector is the daily reconcile.

But what about the cosign tool's coverage check? That's covered in the cosign row.

What about the post-hoc detection of NESTED Core assets? It's covered in detectNestedVaults.

What about FOREIGN Core assets nested in a vault? The SPEC table doesn't mention this explicitly. The text below the table says:
> One gap remains in the post-hoc detection, stated rather than implied: `detectNestedVaults` sees CBOB vaults only, so a **foreign** Core asset nested in a vault is caught by the co-signer but not by the alarm.

OK, stated in the prose.

Hmm, the control table says cosign catches "every token account or nested Core asset the vault holds that the burn does not declare". This includes foreign Core assets, IF the DAS scan sees them. If DAS doesn't index PDA owners, the cosign doesn't see them. The text below acknowledges this.

Actually wait, looking at the cosign row: "every token account or nested Core asset the vault holds that the burn does not declare". This implies the cosign DOES see these. But the text below says the cosign CAN'T see foreign nested Core assets (because DAS doesn't index PDAs).

So there's a tension between the table (claims cosign sees) and the prose (admits cosign doesn't see). This is a small inconsistency.

But the cosign row says "every ... that the burn does not declare" - meaning if the burn doesn't declare it. The cosign's coverage check compares owned (from scan) to declared (from burn). If the scan is incomplete, owned is incomplete, comparison might pass.

The text below corrects: "One gap remains in the post-hoc detection, stated rather than implied: `detectNestedVaults` sees CBOB vaults only, so a **foreign** Core asset nested in a vault is caught by the co-signer but not by the alarm."

Wait, this says foreign nested Core assets are "caught by the co-signer". But if DAS doesn't index PDAs, the co-signer wouldn't see them either.

Actually, looking at the cosign row more carefully: "every token account or nested Core asset the vault holds that the burn does not declare". So the cosign checks: does the scan's owned list match the burn's declared list? If they don't match, refuse.

For a foreign nested Core asset, if DAS doesn't see it, the scan's owned list doesn't include it. The burn's declared list doesn't include it either (because the customer can't declare what they don't have). The comparison: owned (no foreign asset) vs declared (no foreign asset) - they match. So the cosign doesn't catch it.

The text says "caught by the co-signer but not by the alarm" - but this is wrong if DAS doesn't index PDAs. The co-signer also misses it.

Hmm, but maybe DAS DOES index PDA-owned Core assets. If DAS indexes them, the scan returns them, and the cosign catches undeclared foreign assets.

Let me look at the text more carefully:
> One gap remains in the post-hoc detection, stated rather than implied: `detectNestedVaults` sees CBOB vaults only, so a **foreign** Core asset nested in a vault is caught by the co-signer but not by the alarm.

So the gap is "post-hoc detection" - the alarm doesn't catch foreign nested Core assets. The cosigner is described as catching them. So the assumption is that the cosign CAN see foreign nested assets (via DAS).

If DAS doesn't index PDA owners, this is wrong. But the author might have verified DAS does work for PDAs.

OK without running it, I'll trust the author's verification.

Alright, let me look at the broader pattern. Are there any genuine findings I should write?

Let me reconsider the cross-pass correlation lag. The verdict says:
> 3. **Cross-pass correlation lag** (kimi R1-b, glm R1-a): the "self-correcting" claim is too strong. If the signature walk reaches the burn in a *later* pass than the DAS diff, the CRITICAL already went out and nothing retracts it. The fix is a short memory of recently-seen `burn_via_program` assets.

The fix is proposed but not implemented. So this is still a known issue. Not a new finding.

Hmm let me look at one more thing. The `judgeRedemptionTx` function uses `tx.instructions` to iterate over top-level instructions. But what about versioned transactions with inner instructions?

The Transaction.from() returns a legacy Transaction object. Legacy transactions don't have inner instructions in the top-level Instruction list. Inner instructions are in `tx.meta.innerInstructions` (only available from getParsedTransaction, not from raw deserialization).

So for the cosign tool to see inner instructions, it would need to fetch the transaction from RPC. But the cosign tool takes a base64 transaction from the customer, so it can't fetch.

If the customer puts a CPI instruction that the cosign should reject, the cosign wouldn't see it.

Hmm wait, the cosign tool takes a serialized Transaction from the customer. The customer composes a transaction with their wallet. The customer can include CPI instructions... no wait, the customer composes TOP-LEVEL instructions. Inner instructions are CPIs from programs.

So the customer's transaction has top-level instructions. The cosign sees them.

What about top-level instructions that do CPIs? For example, the customer calls Jupiter, which does internal CPIs. The Jupiter instruction is top-level. The CPIs are inner.

The cosign sees the Jupiter top-level instruction. But it doesn't see the inner CPIs (they're not in tx.instructions).

So the cosign could miss an inner CPI that affects state. But this is true of any tool that doesn't fetch the transaction.

Actually, the cosign doesn't need to see inner CPIs because the SEAL/BURN programs only care about TOP-LEVEL instructions. They walk the instructions sysvar which has top-level instructions.

OK no issue.

Hmm let me check one more thing. The BURN's instructions-sysvar walk:
```rust
let current = load_current_index_checked(&sysvar)? as usize;
let mut found = false;
for i in 0..current {
    if let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
        if ix.program_id == SEAL_PROGRAM_ID
            && ix.data.len() >= IX_OPEN_FOR_REDEMPTION_DISC.len()
            && ix.data[..IX_OPEN_FOR_REDEMPTION_DISC.len()] == IX_OPEN_FOR_REDEMPTION_DISC
            && ix.accounts.get(SEAL_IX_ASSET_IDX).map(|a| a.pubkey) == Some(asset)
            && ix.accounts.get(SEAL_IX_OWNER_IDX).map(|a| a.pubkey) == Some(owner)
        { found = true; break; }
    }
}
```

So BURN walks from 0 to current, looking for an open_for_redemption. The current is the index of the burn instruction itself. So BURN looks at top-level instructions BEFORE the burn.

What if the open_for_redemption is at index current+1 (after burn)? BURN doesn't check that. So if burn is BEFORE open, BURN wouldn't find it.

But the SEAL program checks the other direction:
```rust
let mut i = current + 1;
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
    if ix.program_id == BURN_PROGRAM_ID && ... {
        found = true;
        break;
    }
    i += 1;
}
```

SEAL looks for burn AFTER the open. ✓

So both checks are complementary. The transaction must have open BEFORE burn (BURN finds open) AND burn AFTER open (SEAL finds burn). Both directions bound.

OK.

What about: open and burn at the SAME index? Not possible, they're different instructions.

What about: open wrapped in a CPI? CPI instructions are at the SAME index as the wrapping top-level. Actually wait, in Solana, the instructions sysvar includes both top-level and inner instructions. `load_instruction_at_checked` reads any instruction in the sysvar, including inner.

But the SEAL/BURN programs look at top-level only. Let me check...

Actually, `load_instruction_at_checked(i, &sysvar)` reads the instruction at index i in the sysvar. The sysvar is a flat array of all instructions (top-level and inner). So if i is an inner index, this reads the inner instruction.

But SEAL iterates from current+1 onwards, looking for BURN. current is the index of the open instruction. So SEAL looks at indices after open.

If the burn is wrapped in a CPI from a top-level instruction, the burn's sysvar index is... actually let me think. The sysvar index for an inner instruction is its position in the entire transaction's instruction list.

So if a top-level instruction is at index 5, and it does a CPI to burn, the burn is at index 6 in the sysvar.

If SEAL's open is at index 4, and the CPI-wrapped burn is at index 6, SEAL would find it. But the burn's instruction data wouldn't be at the top level - it's inner.

Wait, the program_id in the sysvar is the actual program being called. So if the inner instruction is to BURN program, sysvar.program_id == BURN_PROGRAM_ID. So SEAL would match it.

But SEAL checks for the burn to be a TOP-LEVEL instruction? Let me re-read.

Actually SEAL just looks at `ix.program_id`. It doesn't check if it's top-level or inner. So an inner burn_vault would satisfy SEAL's check.

But BURN also checks. BURN looks for an open_for_redemption. If the open is at a lower index in sysvar than the burn (which it must be for BURN to find it), then BURN is satisfied.

Hmm but the SEAL/BURN pairing was specifically designed to be top-level only. Let me re-check...

Looking at the SEAL comment:
> a `burn_vault` hidden inside another program's CPI is invisible here, so it cannot satisfy this requirement;

So SEAL's claim is that inner burn_vault doesn't satisfy. But the code just checks `ix.program_id == BURN_PROGRAM_ID` - it doesn't distinguish top-level from inner.

Wait, but the sysvar indexes instructions in the order they execute. Top-level instructions are first, then their inner instructions. So if a CPI-wrapped burn is at index 6, and a top-level open is at index 4, SEAL would find the inner burn at index 6.

This contradicts the comment. So this might be a real bug.

Hmm wait, let me re-read the SEAL code:
```rust
let mut found = false;
let mut i = current + 1;
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
    if ix.program_id == BURN_PROGRAM_ID
        && ix.data.len() >= IX_BURN_VAULT_DISC.len()
        && ix.data[..IX_BURN_VAULT_DISC.len()] == IX_BURN_VAULT_DISC
        && ix.accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(asset)
        && ix.accounts.get(BURN_IX_OWNER_IDX).map(|a| a.pubkey) == Some(owner)
    {
        found = true;
        break;
    }
    i += 1;
}
```

So SEAL iterates from current+1 to the end, looking for BURN. Doesn't distinguish top-level from inner.

This contradicts the header comment which claims "a `burn_vault` hidden inside another program's CPI is invisible here".

So this is a discrepancy between code and comment. Either the comment is wrong, or the code is wrong.

If the code is correct (and the comment is wrong), then inner burns can satisfy the check. But this might be intentional - to allow burns wrapped in CPIs from Jupiter or other programs.

If the comment is correct (and the code is wrong), then the seal program should reject inner burns, but doesn't.

Hmm, this is ambiguous. The author may have intended one and written the other.

Let me look at the BURN code:
```rust
for i in 0..current {
    if let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
        if ix.program_id == SEAL_PROGRAM_ID
            ...
```

BURN also doesn't distinguish. So the same ambiguity.

If the intent was to require TOP-LEVEL only, both programs need to check `is_top_level` or similar. Solana's `load_instruction_at_checked` returns the instruction but doesn't have an is_top_level flag.

Actually, looking at Solana docs: `load_instruction_at` reads the instruction at the given index in the sysvar. The sysvar contains ALL instructions (top-level and inner), in execution order.

To check if an instruction is top-level, you'd need to look at the structure. Inner instructions are nested under top-level in the transaction's `message.instructions` vs `meta.innerInstructions`.

Actually, on Solana, `load_instruction_at(i)` returns the instruction at index i in the sysvar. The program can check `ix.program_id` but not directly if it's top-level.

To determine top-level, you'd need to compare against the transaction's `message.instructions`. But within an on-chain program, you don't have access to that structure directly.

Hmm wait, actually, the sysvar instructions are indexed such that top-level instructions come first. The number of top-level instructions is the count in `message.instructions`. Inner instructions follow.

So a program could check: if i < num_top_level, it's top-level; otherwise inner.

But neither SEAL nor BURN does this. So both programs treat all instructions in the sysvar as candidates.

This means: a CPI-wrapped burn_vault would satisfy SEAL's check, and a CPI-wrapped open_for_redemption would satisfy BURN's check.

Is this a security issue? Let me think...

Scenario: Mallory wants to redeem Alice's vault. Mallory doesn't own Alice's vault.

Wait, Mallory can't open Alice's vault because open requires owner's signature. Mallory isn't the owner.

So Mallory can't initiate a redemption for someone else's vault. ✓

What if Mallory wants to redeem their own vault, but in a way that confuses the system? Like, open their vault, then... hmm, the burn needs owner signature too. Mallory can sign as their own owner. So Mallory's redemption is just normal.

OK so this isn't exploitable.

But the COMMENT is wrong. The comment says inner burns can't satisfy, but they can. The author should fix the comment.

But wait, the comment also says: "an `open_for_redemption` reached BY a CPI reports the OUTER instruction's index". Let me think about this. If the open is in a CPI, the outer instruction's index... hmm, this is also ambiguous.

Actually, I think the comment is describing a scenario where the open is in a CPI, and the BURN (which uses load_instruction_at) sees the open. The comment says "the outer instruction's index" - meaning the open's sysvar index IS the outer (top-level) instruction's index, not the open's own index. Hmm, but that's not how Solana works. Each instruction has its own sysvar index.

Wait, looking at Solana's source: `load_instruction_at(i)` reads the i-th instruction in the sysvar. The sysvar is a flat array of all instructions (top-level and inner) in execution order. So each instruction has a unique sysvar index.

So the comment's claim "the outer instruction's index" is wrong. The open's sysvar index is its own position in the sysvar, which depends on what came before it.

OK so the comments are wrong. The code might be too permissive.

But actually, let me reconsider. The whole point of the pairing is to prevent a lone burn without a thaw. If a CPI-wrapped burn is allowed to satisfy the thaw check, then... well, the customer can't initiate a CPI burn without a top-level thaw first. So a CPI burn without a thaw is impossible.

But what if the customer does: top-level thaw, then burn wrapped in a Jupiter CPI? The thaw is at index N. The CPI burn is at index N+something. The seal's check finds it. So burn proceeds.

Is this exploitable? The customer's burn succeeds. They redeemed their vault. Nothing unusual.

What if the customer's burn is wrapped in a CPI from a different program (not Jupiter)? The CPI burn would have to be signed by the program doing the CPI. The program signs... hmm, this is getting complicated.

Actually, the CPI burn needs the burn's account signatures. Specifically, owner: Signer, bank: Signer. If the burn is in a CPI from a program, the program would have to provide these signatures. The owner and bank are the CPI signers from the calling program.

So the customer (asset owner) could be the CPI caller, signing the burn through CPI. The bank could be... wait, the bank needs to sign too. If the bank is just a normal keypair, it can be a top-level signer, not a CPI signer.

Hmm, but the burn instruction's accounts include `bank: Signer<'info>`. For the burn in a CPI, the calling program would need to set `bank` as a CPI signer. But the bank isn't signing the CPI; only the calling program is.

So a CPI burn can't have bank as a Signer, unless bank signs the CPI somehow.

Actually, this is where it gets complicated. Let me think more carefully.

In Solana, when program A CPIs to program B, program A is the "caller". Program A's instruction's accounts become the CPI context. Any of program A's signers become signers for program B (with is_signer: true). But external signers (those who signed the original transaction) don't automatically become CPI signers unless the CPI includes them with is_signer: true.

So for a CPI burn_vault:
- The CPI's accounts include the burn_vault's required accounts
- `bank: Signer<'info>` requires bank to be a signer in the CPI context
- For bank to be a signer in the CPI, the CPI's `invoke`/`invoke_signed` call must include bank with is_signer: true
- This requires the CPI to have signed bank somehow

If program A is doing the CPI, program A has its own signers (the PDA it derives). Bank isn't one of them unless program A has access to bank's signature.

In practice, the customer can't get bank to sign a CPI unless bank's key is exposed somewhere. The bank's key is private. So the customer can't do this.

Unless... the customer does the CPI themselves? Like, the customer's Core Execute does a CPI to BURN's burn_vault. The customer's instruction (Core Execute) has the customer as a signer. The CPI context has the customer as a signer (since Core Execute's signer passes through).

Then `bank: Signer<'info>` in the CPI burn_vault... hmm, the customer is a signer, but not bank. The bank account is named but not a signer.

Wait, can a non-signer account be a `Signer<'info>` in Anchor? Let me think. `Signer<'info>` in Anchor is a type that wraps `AccountInfo` and checks `is_signer == true`. If the account is not a signer, the deserialization fails.

So if the CPI to burn_vault doesn't have bank as is_signer: true, Anchor refuses with AccountNotSigner.

So for a CPI burn to satisfy bank's Signer check, bank must be a CPI signer. Which requires bank to sign the wrapping instruction.

Bank's key is private. The customer doesn't have it. So the customer can't make bank sign a CPI.

UNLESS the customer uses Core Execute to call burn_vault directly? Core Execute is a top-level instruction. The customer signs it. Inside Core Execute, the customer can call other programs (including BURN).

Wait, Core Execute allows arbitrary instructions. So the customer can have Core Execute invoke BURN's burn_vault. But BURN's burn_vault requires bank: Signer. Core Execute can pass through its signers to the CPI context. The customer's signature becomes a CPI signer.

But the burn_vault requires bank as a signer. Customer is not bank. So bank's slot is filled with... bank's pubkey (the correct account), but is_signer: false? Or customer as bank?

If the customer puts their own pubkey in the bank slot, Anchor's require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, BurnError::NotTheBank) catches it. Different pubkey.

If the customer puts the bank's pubkey in the bank slot but with is_signer: false, Anchor's Signer<'info> deserialization refuses.

So the customer can't fake bank's signature.

OK so a CPI burn can't satisfy bank's Signer check unless bank actually signs the CPI.

For bank to sign a CPI, bank would need to call some program that does the CPI. But bank's key is offline. The cosign tool signs the customer's top-level transaction. Bank doesn't make CPIs.

So a CPI-wrapped burn can't have bank's signature, unless bank does the CPI. Which bank doesn't do.

So the inner-burn loophole is theoretical - can't be exploited because bank can't be a CPI signer.

UNLESS... the customer uses Core Execute to invoke BURN, and Core Execute's "signer" mechanism... hmm, Core Execute requires the asset owner's signature. The customer is the asset owner. So Core Execute has customer's signature as signer.

In the CPI context, customer becomes a signer. But not bank. So burn_vault's bank: Signer<'info> still fails.

OK so the inner-burn loophole isn't exploitable. The seal comment is wrong (claims inner burns can't satisfy), but the actual security is maintained by bank's signature requirement.

Hmm OK so this is a comment-vs-code discrepancy, not a security bug.

Wait, let me check the BURN comment:
> an `open_for_redemption` reached BY a CPI reports the OUTER instruction's index, so the wrapper would need a genuine top-level burn for this exact asset and owner later in the same transaction

This comment is also suspect. "the outer instruction's index" - I think the author is saying that when open is reached via CPI, the sysvar reports it under the outer instruction's index. This isn't how Solana works (each instruction has its own index), but the spirit of the comment is correct: a CPI-wrapped open wouldn't satisfy BURN's check because the bank still needs to sign.

Wait, actually the comment might be right in spirit. Let me re-read.

Actually no, `load_instruction_at(i)` reads the i-th instruction in the sysvar. Each instruction (top-level and inner) gets its own index. So a CPI-wrapped open has its own index.

But the SEAL comment says:
> an `open_for_redemption` reached BY a CPI reports the OUTER instruction's index

This is technically wrong. The open's index is its own position in the sysvar, not the outer instruction's index.

But maybe the author meant: when open is in a CPI, the BURN's sysvar check would see the OUTER instruction (which is the wrap), not the inner open. So BURN would need the actual open to be top-level.

Hmm, this is getting confusing. Let me think about what actually happens.

If a top-level instruction A does a CPI to B's burn_vault:
- Top-level instruction A is at sysvar index N
- CPI instruction B (burn_vault) is at sysvar index N+1

When BURN's burn_vault runs at index N+1, the sysvar's current_index is N+1. BURN looks at indices 0..N+1 (current exclusive, so 0..N+1 is up to and including N). So BURN looks at indices 0..N+1, which is 0, 1, ..., N.

If the open was at index M < N+1, BURN finds it.

So a CPI-wrapped open CAN satisfy BURN's check, even though it's "inner" from the perspective of the CPI structure.

Similarly for SEAL: if burn is at index K, SEAL's check at current+1.. finds burn.

So both programs CAN be satisfied by inner instructions, contradicting the comments.

But this doesn't lead to exploitation, because bank must sign the burn. The customer can't make bank sign via CPI.

OK so this is a comment-vs-code discrepancy, not a security bug.

Hmm but wait - the seal header says:
> the wrapper would need a genuine top-level burn for this exact asset and owner later in the same transaction — and BURN independently demands a genuine top-level open before it. Both halves bind asset AND owner, so neither can be borrowed from another vault's redemption sharing the transaction.

So the seal claim is: the CPI wrapper needs a top-level burn. But the code doesn't check this. The code checks for ANY burn (top-level or inner).

So this is a discrepancy. Either the comment is wrong, or the code should be stricter.

If the code is correct: inner burns can satisfy seal's check. But this is only exploitable if bank signs an inner burn. Since bank signs top-level transactions (via cosign), and the customer can't make bank sign a CPI, this is not exploitable.

Hmm, but actually wait. The customer could construct a transaction like:
- Top-level: open_for_redemption (signed by owner and bank)
- Top-level: some other program X (signed by whoever)
- Top-level: BURN's burn_vault (which is just a regular top-level instruction, not a CPI)

This is the normal redemption. ✓

But what if:
- Top-level: open_for_redemption (signed by owner and bank)
- Top-level: Jupiter program (CPI to Jupiter's routing)
- CPI from Jupiter: SPL token transfer
- Top-level: BURN's burn_vault (signed by owner and bank)

Here the CPI from Jupiter doesn't include burn_vault. So burn_vault is at the top level. SEAL finds it. ✓

What if:
- Top-level: open_for_redemption (signed by owner and bank)
- Top-level: Core Execute (signed by owner)
- CPI from Core Execute: BURN's burn_vault

The burn_vault is now in a CPI from Core Execute. The CPI's signer set includes the customer (since Core Execute's signer passes through). bank isn't a CPI signer.

So burn_vault's bank: Signer<'info> fails. Burn reverts.

OK so this doesn't work.

What if:
- Top-level: Core Execute (signed by owner, calling burn_vault)
- The Core Execute is BEFORE any open_for_redemption

The burn_vault is in a CPI. bank isn't a signer. Burn reverts.

Or what if the customer does TWO top-level instructions:
- Top-level: open_for_redemption (signed by owner and bank)
- Top-level: Core Execute (signed by owner, doing nothing relevant)
- Top-level: BURN's burn_vault

The burn_vault is at the top level. SEAL finds it. ✓

This is normal.

So the "inner burn" loophole is only exploitable if:
- The burn is wrapped in a CPI
- The CPI has bank as a signer (so bank's Signer<'info> check passes)
- The seal's sysvar check finds the inner burn

For bank to be a CPI signer, the wrapping program must have bank as a signer. The wrapping program would have to be signed by bank. But bank only signs the top-level transaction (via cosign). Bank doesn't sign wrapping programs.

Unless the wrapping program is BURN itself? BURN is a separate program, not the wrapping one.

Hmm wait, what if the wrapping program is the SPL token program, and it does a CPI to BURN's burn_vault as part of its normal operation? SPL token doesn't call burn_vault normally. This isn't a thing.

OK so the inner burn loophole is theoretical.

Alright, I think I've been thorough. Let me now write up what I found.

Let me re-read the R4 prompt:
> The drift can also run the other way — a comment DENYING a control that now does run is the same defect.

So I should look for comments that deny a control that does run.

Looking at the SEAL header:
> ⚠️ WHAT ACTUALLY COVERS IT, AS OPPOSED TO WHAT IS USUALLY CLAIMED:
>   * `bank/alarm.mjs` reports a NESTED VAULT every pass (`detectNestedVaults`, free — DAS already returns the owner) and an UNDECLARED TOKEN ACCOUNT in the daily `--reconcile`. Both are PERIODIC and POST-HOC.
>   * The Bank's co-signature could refuse in the moment — a Solana signature covers the whole transaction, so the Bank sees every instruction — but **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it signs, because nothing signs. Until that is built, the pre-signature control is a human a management, not a control.

OK SEAL says "no co-signing tool exists". But cosign.mjs is the new tool. So the comment is WRONG (out of date) for the new tree, but it's accurate to the old tree.

Wait, looking at the diff... actually the SEAL header hasn't been updated. The new cosign.mjs exists in the tree, but SEAL's header still says no tool exists.

Hmm but the SPEC.md says the tool exists. And cosign.mjs's own header says it exists.

So SEAL's header is OUT OF DATE. It says no tool exists, but one does (cosign.mjs).

Hmm but does SEAL claim the tool exists or doesn't? Let me re-read...

> The Bank's co-signature could refuse in the moment — a Solana signature covers the whole transaction, so the Bank sees every instruction — but **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it signs, because nothing signs. Until that is built, the pre-signature control is a human a management, not a control.

So SEAL says no tool exists. But cosign.mjs exists. So SEAL is WRONG.

The cosign.mjs header says:
> DEFAULT IS INSPECT-ONLY. `--live` is what signs, and it is a decision, the same way `revenue.mjs` is installed without it. Inspecting needs no key at all.

So the tool exists but is inspect-only by default. The "no tool exists" claim in SEAL is somewhat misleading - the tool exists, but it's not deployed as part of a workflow.

But the cosign header also says:
> There is no Bank key on this box yet.

So even if the tool exists, there's no key to sign with. So in production, the Bank doesn't sign yet.

So SEAL's claim "no co-signing tool exists in this repository" is WRONG - the tool exists, just not deployed. And "no Bank key on this box yet" means it can't actually sign yet.

This is a minor comment discrepancy.

But wait - the SEAL header also says "do not restate the answer here, point at it." So the rule is to point at SPEC.md. Let me check if SEAL points at SPEC.md.

Looking at the SEAL header:
> ⚠️ WHAT ACTUALLY COVERS IT, AS OPPOSED TO WHAT IS USUALLY CLAIMED: ... Until that is built, the pre-signature control is a human a management, not a control.

This says "Until that is built" - implying it's not built. But it IS built (cosign.mjs exists). So this comment is out of date.

But maybe by "built" the author means "deployed and operational". The tool exists in code but isn't deployed. So "not built" might mean "not operational".

OK this is a fine distinction. Let me not file this as a finding.

Hmm, but the diff shows the SEAL header WAS updated in this round (the "What ACTUALLY COVERS IT" section was added in round 13, and the "point at SPEC.md" comment was added in round 14). So it's current.

Wait, let me look at the actual diff for SEAL. Looking at the diff:
```
-//! MEASURED, not estimated (suite 9.14), by building the real transaction:
-///     1 mint -> 802 bytes   2 -> 946   3 -> 1090   4 -> cannot be serialized
+/// MEASURED, not estimated (suite 9.14), by building the real WORST-CASE
+/// transaction — every reserve swept AND closed, both ATA derivations declared,
+/// and the PDA's lamports swept too, because a stranger can put lamports in any
+/// vault for free (9.10) and the burn then refuses until the same transaction
+/// takes them out (9.11):
+///     1 mint -> 831 bytes   2 -> 975   3 -> 1119   4 -> cannot be serialized
```

So the byte counts were updated. OK.

And the "WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md" comment was added in SEAL. Let me check.

Looking at the SEAL header in the new tree:
```
/// reserve_mints still cannot be enumerated by any program.
```

Wait, this is part of the Config struct comment. Looking at the diff for this:
```
-    /// Unknown airdropped tokens still cannot be enumerated by any program — that gap is covered by
-    /// the Bank co-signature and the off-chain scanner, stated plainly rather
-    /// than papered over.
+    /// Unknown airdropped tokens still cannot be enumerated by any program.
+    /// ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section —
+    /// ONE place, so a claim here can never drift from what actually runs. It
+    /// used to say "the Bank co-signature and the off-chain scanner", and no file
+    /// in this repository signs a redemption, so half of that named a control
+    /// that does not exist. Round 14 found this class in three separate comments
+    /// AFTER the round-13 repair for it; do not restate the answer here, point at
+    /// it.
```

OK so the Config.reserve_mints doc was updated. Now it points at SPEC.md. ✓

So the comment is current: it points at SPEC.md rather than restating.

Now the SPEC.md table says:
| `bank/cosign.mjs` — the Bank's co-signer | ... | pre-signature |

So SPEC.md says cosign.mjs is the pre-signature control. ✓

The cosign.mjs file itself is now in the tree (added in this round). So the SPEC table is consistent with the code.

OK comments are clean.

Hmm but wait - the SEAL header still says "No co-signing tool exists". Let me re-check.

Looking at the SEAL lib.rs in the new tree:
```
//! ⚠️ WHAT ACTUALLY COVERS IT, AS OPPOSED TO WHAT IS USUALLY CLAIMED:
//!   * `bank/alarm.mjs` reports a NESTED VAULT every pass (`detectNestedVaults`,
//!     free — DAS already returns the owner) and an UNDECLARED TOKEN ACCOUNT in the
//!     daily `--reconcile`. Both are PERIODIC and POST-HOC.
//!   * The Bank's co-signature could refuse in the moment — a Solana signature
//!     covers the whole transaction, so the Bank sees every instruction — but
//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
//!     signs, because nothing signs. Until that is built, the pre-signature
//!     control is a human procedure, not a control.
```

OK so SEAL says "no co-signing tool exists in this repository". But cosign.mjs was added in this round. So the comment is OUT OF DATE.

Wait, let me look at the diff for SEAL more carefully:

Looking at the diff for programs/cbob-vaults/src/lib.rs:
```
+//! THE RESERVE LIST IS ADDITIVE-ONLY BY DESIGN, so that landmine would be armed
+//! by an ordinary future config change. Refusing at config time turns a customer
+//! funds-loss into an admin error message.
```

Hmm but I don't see a change to the "no co-signing tool" claim. Let me search the full SEAL lib.rs...

Actually I realize I should check the SEAL header around the "no co-signing tool" claim. The diff doesn't include changes to that section, which means it's UNCHANGED from round 13 (or earlier).

So the SEAL header still says "no co-signing tool exists". But cosign.mjs exists now.

Hmm but the cosign.mjs header says:
> DEFAULT IS INSPECT-ONLY. `--live` is what signs, and it is a decision, the same way `revenue.mjs` is installed without it. Inspecting needs no key at all.

So the tool is inspect-only. It doesn't sign unless --live is added. And:
> There is no Bank key on this box yet.

So even with --live, there's no key to sign with. So in production, the Bank doesn't sign.

So the comment "no co-signing tool exists" is technically accurate if you interpret "co-signing tool" as a fully-wired Bank co-signer. The tool exists in code, but isn't deployed.

But this is a fine distinction. The comment could be more clear.

OK let me think about whether this is a real issue worth filing.

The R4 prompt says:
> The drift can also run the other way — a comment DENYING a control that now does run is the same defect.

So a comment that denies a control that DOES run is the same defect. The SEAL comment denies a control (the Bank co-signer) that now does exist (cosign.mjs). But the comment is qualified with "no co-signing tool exists in this repository" - which is wrong now.

This is a discrepancy. Let me file it.

Actually wait, looking more carefully at the SEAL header:
```
//!   * The Bank's co-signature could refuse in the moment — a Solana signature
//!     covers the whole transaction, so the Bank sees every instruction — but
//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
//!     signs, because nothing signs. Until that is built, the pre-signature
//!     control is a human procedure, not a control.
```

And looking at the diff for this section... actually I don't see a recent change to this section. The diff shows:
```
//! ⚠️ WHAT ACTUALLY COVERS IT, AS OPPOSED TO WHAT IS USUALLY CLAIMED:
//!   * `bank/alarm.mjs` reports a NESTED VAULT every pass ...
```

Wait, looking at the diff I was given:
```
-//! MEASURED, not estimated (suite 9.14), by building the real transaction:
+/// MEASURED, not estimated (suite 9.14), by building the real WORST-CASE
+/// transaction ...
```

Hmm, the diff I see only shows the byte count update, not the header comment. But the SEAL header in the tree includes the "no co-signing tool exists" claim.

So either:
1. The SEAL header was updated in this round but I missed it in the diff
2. The SEAL header was not updated and is now out of date

Looking at the SEAL lib.rs source as given in the prompt:
```
//! ⚠️ WHAT ACTUALLY COVERS IT, AS OPPOSED TO WHAT IS USUALLY CLAIMED:
//!   * `bank/alarm.mjs` reports a NESTED VAULT every pass (`detectNestedVaults`,
//!     free — DAS already returns the owner) and an UNDECLARED TOKEN ACCOUNT in the
//!     daily `--reconcile`. Both are PERIODIC and POST-HOC.
//!   * The Bank's co-signature could refuse in the moment — a Solana signature
//!     covers the whole transaction, so the Bank sees every instruction — but
//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
//!     signs, because nothing signs. Until that is built, the pre-signature
//!     control is a human procedure, not a control.
```

So the comment is current. But it says "no co-signing tool exists in this repository". Now cosign.mjs DOES exist.

Wait, but cosign.mjs is "inspect-only by default". So maybe "co-signing tool" means a tool that actually signs (with --live). In that case, the tool exists but doesn't sign by default. So the comment is still accurate.

Hmm but the cosign.mjs exists. So "no co-signing tool exists in this repository" is at least misleading.

Actually wait, let me look at the BURN lib.rs comment:
```
//! ⚠️ AND READ "the Bank must alarm on every burn" AS EXACTLY THAT — an alarm,
//! AFTER the fact. `bank/alarm.mjs` now reports a nested vault every pass and an
//! undeclared token account daily, but **no Bank co-signing tool exists in this
//! repository**, so nothing scans before it signs. The pre-signature refusal is a
//! human procedure until one is built. Do not read the co-signature as a control
//! that runs.
```

Same claim in BURN. Both say "no Bank co-signing tool exists in this repository".

So both SEAL and BURN claim no tool exists. But cosign.mjs exists.

If the rule is "every comment points at SPEC.md", then these comments should point at SPEC.md rather than restating. But they DON'T point at SPEC.md - they restate "no tool exists".

So this is a violation of the rule. The rule says:
> Now that bank/cosign.mjs exists, the drift can also run the other way — a comment DENYING a control that now does run is the same defect.

So a comment denying a control (the Bank co-signer) that now runs (cosign.mjs exists) is the defect. The SEAL and BURN headers deny the Bank co-signer, which now exists.

This is the R4 finding. The SEAL and BURN headers should be updated to point at SPEC.md rather than restating "no tool exists".

Actually wait, let me look at the Config.reserve_mints comment, which was updated:
```
+    /// Unknown airdropped tokens still cannot be enumerated by any program.
+    /// ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section —
+    /// ONE place, so a claim here can never drift from what actually runs. It
+    /// used to say "the Bank co-signature and the off-chain scanner", and no file
+    /// in this repository signs a redemption, so half of that named a control
+    /// that does not exist.
```

So the Config.reserve_mints comment was updated to point at SPEC.md. But the file-level header in SEAL and BURN still restate "no tool exists".

This is an inconsistency. The fix was applied to one site but not others.

OK so the R4 finding is: SEAL and BURN file-level headers still restate "no co-signing tool exists" instead of pointing at SPEC.md. After cosign.mjs was added, the comments are now wrong.

Let me file this.

Hmm but wait, looking at the BURN diff:
```
+//! ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section —
+//! ONE place, so this can never drift from what actually runs. This paragraph
+//! used to assert the Bank's co-signature as the control ("a Solana signature
+//! covers the whole transaction, so the Bank sees every instruction"), which is
+//! true of Solana and false of this repository: NOTHING HERE SIGNS A REDEMPTION.
+//! The ⚠️ above corrected the general claim and this paragraph quietly reasserted it,
+//! which is how round 14 found the class surviving in three comments inside its own repair.
```

So BURN's "WHAT THIS CAN AND CANNOT PROVE" section was updated to point at SPEC.md. But the file header above that section still says "no Bank co-signing tool exists".

So the fix was applied to some sites but not all. The file-level headers of SEAL and BURN still restate.

Actually wait, the diff doesn't include a change to the file-level header. So it wasn't updated. The fix was only applied to the inner section.

So the file-level header is OUT OF DATE. It says "no tool exists" but cosign.mjs now exists.

This is the drift the author warns about. The fix was applied at one site (Config.reserve_mints doc, BURN's WHAT THIS CANNOT PROVE section), but the file-level headers in SEAL and BURN still restate the claim.

OK this is a real finding worth filing.

Actually let me look at all the comments that say "no co-signing tool exists":

SEAL lib.rs file header (line ~36 in the prompt):
```
//!   * The Bank's co-signature could refuse in the moment — a Solana signature
//!     covers the whole transaction, so the Bank sees every instruction — but
//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
//!     signs, because nothing signs. Until that is built, the pre-signature
//!     control is a human procedure, not a control.
```

BURN lib.rs file header:
```
//! ⚠️ AND READ "the Bank must alarm on every burn" AS EXACTLY THAT — an alarm,
//! AFTER the fact. `bank/alarm.mjs` now reports a nested vault every pass and an
//! undeclared token account daily, but **no Bank co-signing tool exists in this
//! repository**, so nothing scans before it signs. The pre-signature refusal is a
//! human procedure until one is built. Do not read the co-signature as a control
//! that runs.
```

Both say "no tool exists". Both are in file headers. Both are now wrong because cosign.mjs exists.

OK this is a finding. Let me file it.

Wait actually I realize that "no co-signing tool exists in this repository" can be interpreted as "no tool that co-signs a redemption actually runs" rather than "no source file exists for a co-signing tool". The cosign.mjs file exists but doesn't actually co-sign (it's inspect-only, and even with --live there's no Bank key).

So in this interpretation, the comment is still accurate. The tool exists but doesn't run.

Hmm. This is ambiguous.

OK let me look at the rule:
> The rule now is that every such claim POINTS AT the control table in SPEC.md's "THE SHIP GATE" section rather than restating it.

So claims should point at SPEC.md rather than restating. The file-level headers in SEAL and BURN restate the claim. So they should point at SPEC.md.

So the file-level headers are non-compliant with the rule. They restate the claim rather than pointing at the table.

This is the finding. Let me file it.

Actually wait, looking at the Config.reserve_mints doc:
```
/// ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section —
/// ONE place, so a claim here can never drift from what actually runs. It
/// used to say "the Bank co-signature and the off-chain scanner", and no file
/// in this repository signs a redemption, so half of that named a control
/// that does not exist.
```

So this comment (in Config.reserve_mints doc) does point at SPEC.md. And notes that the OLD comment claimed "the Bank co-signature and the off-chain scanner", which was wrong.

But the file-level headers in SEAL and BURN are in the same category - they restate the claim rather than pointing at SPEC.md. So they should be updated.

OK let me file this.

Now let me think about what else.

Actually wait, looking at the SEAL file header more carefully:
```
//! ⚠️ WHAT ACTUALLY COVERS IT, AS OPPOSED TO WHAT IS USUALLY CLAIMED:
//!   * `bank/alarm.mjs` reports a NESTED VAULT every pass (`detectNestedVaults`,
//!     free — DAS already returns the owner) and an UNDECLARED TOKEN ACCOUNT in the
//!     daily `--reconcile`. Both are PERIODIC and POST-HOC.
//!   * The Bank's co-signature could refuse in the moment — a Solana signature
//!     covers the whole transaction, so the Bank sees every instruction — but
//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
//!     signs, because nothing signs. Until that is built, the pre-signature
//!     control is a human procedure, not a control.
```

The first bullet points at alarm.mjs (a real control). The second bullet points at... the Bank's co-signature, which is now bank/cosign.mjs. So this should be updated to "see SPEC.md".

But the comment doesn't point at SPEC.md. It restates the claim.

OK so the file-level header is non-compliant.

Wait, let me check if the file-level header was supposed to be updated in this round. The diff for SEAL lib.rs only shows the byte count change. The file-level header was not updated in this round.

So this is a missed fix. The rule says to point at SPEC.md. The file-level header doesn't.

OK let me file this.

Hmm actually wait. Let me look at the file-level header in BURN. It's the same pattern.

And in BURN, the inner section ("WHAT THIS CAN AND CANNOT PROVE") was updated to point at SPEC.md. But the file-level header wasn't.

So both SEAL and BURN have:
- File-level header: NOT pointing at SPEC.md (claims no tool exists)
- Inner section (Config.reserve_mints or "WHAT CANNOT PROVE"): Points at SPEC.md

This is inconsistent. The fix was applied at some sites but not others.

OK this is the finding.

Let me also think about other things. The author mentions:
> Now that bank/cosign.mjs exists, the drift can also run the other way — a comment DENYING a control that now does run is the same defect.

So any comment that DENIES the Bank co-signer is wrong. Both file-level headers in SEAL and BURN deny it.

Wait, actually the file-level headers DENY the Bank co-signer? Let me re-read.

SEAL: "no co-signing tool exists in this repository" - this says no tool exists. So the co-signer doesn't run.

BURN: "no Bank co-signing tool exists in this repository" - same.

Both DENY that the co-signer runs. But cosign.mjs DOES exist and DOES run (in inspect-only mode by default).

So both comments are wrong.

OK let me file this.

Actually, hmm, I want to be careful. The comments say "no co-signing tool exists in this repository". Now cosign.mjs exists. But cosign.mjs is inspect-only by default.

If "co-signing tool" means "a tool that produces Bank signatures", then cosign.mjs doesn't qualify (it's inspect-only).

If "co-signing tool" means "a tool that does the pre-sign check", then cosign.mjs qualifies.

The author's intent is probably the latter. The cosign tool is the "co-signing tool" because it does the pre-sign check (and optionally signs).

But cosign.mjs's header says:
> DEFAULT IS INSPECT-ONLY. `--live` is what signs

So cosign.mjs is inspect-only by default. Without --live, it doesn't sign. So in the default mode, it's not actually co-signing.

Hmm OK so the ambiguity is real. Let me not file this as a finding. The comment can be interpreted either way.

Actually wait, let me look at SPEC.md. The control table says:
| **`bank/cosign.mjs`** — the Bank's co-signer | ... | **pre-signature** |

So SPEC.md treats cosign.mjs as "the Bank's co-signer". So the tool is THE Bank co-signer, regardless of whether it signs by default.

So the SEAL and BURN file headers saying "no co-signing tool exists" are WRONG by SPEC.md's standard.

OK this is a finding. Let me file it.

Actually wait, the file header in BURN also says:
```
//! ⚠️ AND READ "the Bank must alarm on every burn" AS EXACTLY THAT — an alarm,
//! AFTER the fact. `bank/alarm.mjs` now reports a nested vault every pass and an
//! undeclared token account daily, but **no Bank co-signing tool exists in this
//! repository**, so nothing scans before it signs.
```

"so nothing scans before it signs" - this is contradicted by cosign.mjs which DOES scan (in inspect-only mode).

So the file header in BURN is wrong in TWO ways:
1. Claims no tool exists (cosign.mjs does)
2. Claims nothing scans before signing (cosign.mjs does scan, in inspect mode)

OK this is the R4 finding. Let me file.

Alright let me also check if there are any other places that say "no co-signing tool exists"...

Looking at the BURN lib.rs:
```
//! The Bank must alarm on every burn.
```

Hmm, "must alarm" suggests it's a post-hoc alarm, not a pre-sign check. This might be the correct framing.

But the file header says "no co-signing tool exists" which is wrong.

OK let me file this.

Hmm wait, but the rule says "Now that bank/cosign.mjs exists, the drift can also run the other way — a comment DENYING a control that now does run is the same defect."

So a comment that DENIES the Bank co-signer is the defect. Both file headers do this.

OK let me file this finding.

Now let me also think about other things. Let me look at the validators.

Actually, looking at the cosign.mjs more carefully:

```javascript
async function inspect(b64) {
  const tx = Transaction.from(Buffer.from(b64, 'base64'))
  const ixs = tx.instructions.map(ix => ({
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map(k => k.pubkey.toBase58()),
    data: [...ix.data],
  }))
  const conn = new Connection(rpcUrl(), 'confirmed')
  const sealCfg = PublicKey.findProgramAddressSync([Buffer.from('config')], SEAL)[0]
  const acc = await conn.getAccountInfo(sealCfg, 'confirmed')
  if (!acc) throw new Error('the SEAL config is not deployed — there is nothing to co-sign against')
  const data = pinnedAccountData(acc, { program: SEAL, struct: 'Config', version: 1, what: 'the SEAL config' })
  const bank = new PublicKey(data.subarray(73, 105)).toBase58()

  const shape = D.judgeRedemptionTx(ixs, {
    sealProgram: SEAL.toBase58(), burnProgram: BURN.toBase58(), bank,
    openDisc: disc('open_for_redemption'), burnDisc: disc('burn_vault'),
    burnFixedAccounts: BURN_FIXED_ACCOUNTS,
  }, k => { try { return PublicKey.isOnCurve(new PublicKey(k).toBytes()) } catch { return null } })

  if (!shape.ok) return { ok: false, stage: 'shape', reasons: shape.reasons, bank }
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from('mpl-core-execute'), new PublicKey(shape.asset).toBuffer()], CORE)[0]
  const owned = await scanPda(conn, pda)
  const cover = D.judgeRedemptionCoverage(owned, shape.declared)
  return { ok: cover.ok, stage: cover.ok ? 'clean' : 'coverage', reasons: cover.reasons,
    bank, asset: shape.asset, owner: shape.owner, pda: pda.toBase58(), owned, declared: shape.declared }
}
```

Wait, the sealCfg is derived from SEAL program pubkey. But the SEAL program pubkey is a constant `SEAL = new PublicKey('9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273')`. This is a constant.

In production, the SEAL program has this address. But on a local validator (with --features localnet), the program might have a different address.

Hmm, but cosign.mjs is meant for production use, not local testing. So using the production address is correct.

OK no issue there.

But wait - what if the SEAL program has been redeployed to a different address? Constants can't be changed without code changes. So cosign.mjs would point at the wrong program.

But Anchor programs are deployed to a fixed address (or upgradeable). If SEAL is upgradeable, the address stays the same. If SEAL is migrated to a different program, the address changes (but that's a hard fork).

OK no issue.

Hmm let me think about the BURN program. Cosign checks burnProgram against BURN.toBase58(). Same constant. ✓

Now what about the BURN_FIXED_ACCOUNTS = 11? This is the number of fixed accounts in burn_vault (before remaining_accounts). Let me count from the burn_vault struct:
- vault_asset (0)
- collection (1)
- owner (2)
- bank (3)
- asset_signer (4)
- payer (5)
- config (6)
- seal_config (7)
- instructions (8)
- mpl_core (9)
- system_program (10)

That's 11 accounts. ✓

So burnFixedAccounts = 11. The judge slices the burn.accounts from index 11 onwards as declared. ✓

Hmm but what if the burn program adds more accounts in the future? The constant would be wrong. The cosign would incorrectly slice the declared list.

But the constant has a comment:
> ⚠️ If BURN's account list changes, this changes with it — and SEAL's forward match would break first, which fails closed.

So if BURN's account list changes:
- SEAL's match would break (because burn_vault's asset/owner positions shift)
- BURN's forward match would fail
- The burn would refuse

So the seal program fails first. The cosign's hardcoded 11 doesn't matter because the burn doesn't get called.

OK.

Alright, let me think about what's left.

Hmm, let me look at the applyAcks more carefully:
```javascript
export function applyAcks(findings, acks = {}) {
  return findings.map((f) => {
    if (!f.asset || !f.kind) return f
    const why = acks[`${f.kind}:${f.asset}`]
    if (typeof why !== 'string' || !why.trim()) return f
    return { ...f, severity: S.INFO, acked: true,
      detail: `${f.detail}\n     ACKNOWLEDGED: ${why.trim()}` }
  })
}
```

The key is `<kind>:<asset>`. What if kind or asset contains a colon? Let me check...

In the test:
```javascript
t('acking one KIND does not ack another on the same asset',
    one(D.applyAcks([crit('nested_vault', A2)], { [`vault_owns_itself:${A2}`]: 'x' })).severity, 'CRITICAL')
```

So the kind is `nested_vault` and the asset is A2. The key is `vault_owns_itself:A2`. The ack doesn't apply because kind doesn't match.

What if a finding kind had a colon? Like `unredeemable_owner:metadata`? The key would be `unredeemable_owner:metadata:<asset>`. The parsing might split wrong. But no finding kinds have colons, so this is hypothetical.

OK applyAcks is fine.

Now let me think about the lock's atomicity more carefully.

The author's claim:
> `rename` IS atomic. Two racers renaming the same path to their own unique names cannot both succeed: the loser gets ENOENT because the source is already gone.

This is correct on POSIX filesystems. `rename` is atomic.

But wait - what if the rename fails for a different reason (e.g., permission denied)? The code:
```javascript
try { fs.renameSync(file, stolen) }
catch (e) {
    if (e.code === 'ENOENT') return { ok: false, broke: null, held, ageMs: age, lostRace: true }
    throw e
}
```

So ENOENT is treated as lostRace. Other errors propagate. ✓

What about EACCES? Propagates. ✓

What about EEXIST? Can rename fail with EEXIST? `rename(old, new)` shouldn't fail with EEXIST because new is created by the rename. But if new already exists, rename might overwrite (POSIX) or fail (Windows). On Linux, rename overwrites.

So on Linux, rename(old, new) where new exists: overwrites. If new contains some other process's data, that data is gone.

Hmm wait, the "stolen" file is `file + ".breaking." + token`. So it's unique to this process. No other process should be writing to the same stolen file.

But what if two processes use the same token? `token = crypto.randomUUID()`. UUIDs are unique. So two processes won't collide.

So `stolen` is unique. Rename can create it without overwriting anything. ✓

OK the lock is sound.

Hmm let me think about the round-13 carry-over #5:
> `burn_via_program` does not verify the asset is one of ours, so the correlation key is caller-supplied.

So if a foreign vault (not CBOB) is burned via BURN's burn_vault, the alarm sees burn_via_program for that asset. The asset goes into viaProgram. But since it's a foreign asset, no findings fire for it (because the alarm only watches CBOB vaults).

So no impact.

But wait - what if the SAME foreign asset ID happens to be a CBOB vault ID? That's astronomically unlikely. Pubkeys are 32 bytes. Collision is impossible.

OK no issue.

Let me think about the round-13 carry-over #6:
> SPEC contradicts the implementation on sweep authorization and carries stale counts.

Hmm, where does the SPEC contradict on sweep authorization? Let me look.

SPEC says:
> | step | where | who |
> |---|---|---|
> | 1. `sweep_sol_for_swap` | **on-chain**, bounded by a SOL fee reserve, destination PINNED in config | permissionless |

But the program requires the swap_operator to sign. So it's NOT permissionless. The SPEC says "permissionless" but the program requires a signature.

This is a SPEC contradiction.

Hmm let me check the program:
```rust
#[account(mutmut, swap_operator: Signer<'info>, ...)]
```

So swap_operator is Signer. The SPEC says permissionless. This is a contradiction.

Wait actually let me re-check. Looking at the sweep_sol_for_swap:
```rust
pub fn sweep_sol_for_swap(ctx: Context<SweepSolForSwap>, amount: u64) -> Result<()> {
    ...
    require_keys_eq!(ctx.accounts.swap_operator.key(), cfg.swap_operator, MintError::WrongTreasury);
    ...
}
```

So swap_operator must be the configured operator AND must sign. So it's signed.

But the SPEC says permissionless. Hmm, the SPEC's table says "permissionless" but the program requires the operator to sign. These contradict.

Actually wait, maybe by "permissionless" the SPEC means "no admin permission required" (i.e., any caller can invoke it). The signer requirement is for the operator, which is a different kind of permission.

But the SPEC clearly says "permissionless" in the "who" column. And the program requires the operator to sign. So the operator must sign - this is NOT permissionless.

This is a real SPEC contradiction. The author notes it as a carry-over.

Actually wait, let me look at the program's comment:
```rust
/// THE OPERATOR SIGNS. It does not need the multisig — that was the reason it
/// was opened up in round 5, and that reason still holds — but "permissionless"
/// was a mistake, and round 6 made it a worse one by adding a cooldown.
```

So the operator signs. The previous version was "permissionless" (which was a mistake). The current version requires the operator to sign.

So the SPEC saying "permissionless" is outdated. The carry-over notes this.

OK this is acknowledged. Not a new finding.

Hmm let me think about what else.

Actually let me look at the carry-over #9:
> Duplicate attribute keys are not rejected at mint. A vault minted during a proposal may vote. A buyer cannot verify reserve continuity atomically at purchase.

So duplicate attribute keys can be minted. Looking at MINT's mint_vault:
```rust
for a in attributes.iter() {
    require!(a.key.len() <= MAX_ATTR_STR && a.value.len() <= MAX_ATTR_STR, MintError::TooManyAttributes);
    require!(!a.key.is_empty(), MintError::TooManyAttributes);
    require!(a.key != ATTR_REDEMPTION, MintError::ReservedAttribute);
}
```

So keys are checked for length and reserved name, but NOT for duplicates. Two attributes with key "charter" could be minted.

This is acknowledged. Not a new finding.

Alright, I think I've covered most of the code. Let me organize my findings.

REAL FINDINGS:

1. R4: SEAL and BURN file-level headers still restate "no co-signing tool exists" instead of pointing at SPEC.md. After cosign.mjs was added, this is wrong.

2. R1: The cosign tool doesn't verify signatures. A transaction missing owner signature would be blessed.

3. The seal/burn programs claim to only match top-level instructions but the code matches any instruction in the sysvar. Comment vs code discrepancy.

4. Round-13 carry-over: SPEC says sweep is permissionless, but program requires operator signature. Already noted.

Hmm. Let me think about #3 more carefully. The SEAL header says:
> a `burn_vault` hidden inside another program's CPI is invisible here, so it cannot satisfy this requirement;

But the code:
```rust
let mut i = current + 1;
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
    if ix.program_id == BURN_PROGRAM_ID ... {
```

So the code doesn't distinguish inner from top-level. Any instruction at index >= current+1 in the sysvar.

Is this a security issue? The customer can wrap burn_vault in a CPI. But bank's signature is still required. The customer can't make bank sign a CPI without exposing bank's key.

So this is a code-vs-comment discrepancy, not a security bug.

Hmm, but it might be worth flagging as a MEDIUM/LOW because the comment misrepresents the behavior. Auditors or future developers might rely on the comment.

OK let me list my findings.

Actually let me check the BURN comment too:
> An `open_for_redemption` buried inside another program's CPI cannot satisfy this, and a `burn_vault` reached BY a CPI sees the OUTER instruction's index

Wait this says "the OUTER instruction's index" for burn_vault reached by CPI. But the code uses `load_instruction_at_checked(i)` which reads the i-th instruction regardless of top-level/inner.

Hmm, but if burn_vault is reached BY a CPI (the burn is the inner instruction), then in the sysvar, burn_vault is at its own index (the next after the outer). So the sysvar index is NOT the outer's index.

Wait, maybe the comment is wrong about this too. Let me think.

When a program A does `invoke` or `invoke_signed` to program B's instruction X:
- The transaction's top-level instructions are indexed 0, 1, 2, ...
- When top-level instruction 5 calls program A which CPIs to program X:
  - Program X is added to the sysvar at the next index
  - The sysvar index for X is 6 (or whatever the next is)
- When X is being executed, `load_current_index_checked` returns 6

So X has its own index, not the outer instruction's index.

The BURN comment says: "a `burn_vault` reached BY a CPI sees the OUTER instruction's index". This is wrong. Burn_vault at index 6 sees 6, not 5.

Hmm, but maybe the comment means: when SEAL walks the sysvar looking for burn_vault AFTER the open, it might find an inner burn_vault. The inner burn_vault's index is after the outer, so SEAL finds it.

Either way, the comment is confusing. The code matches any instruction.

OK so the comment is misleading. But again, not exploitable due to bank's signature requirement.

Let me file this as a finding.

Hmm, actually wait. Let me re-read the comment:
> An `open_for_redemption` buried inside another program's CPI cannot satisfy this

This says inner open can't satisfy BURN's check. But the code:
```rust
for i in 0..current {
    if let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
        if ix.program_id == SEAL_PROGRAM_ID
            && ix.data.len() >= IX_OPEN_FOR_REDEMPTION_DISC.len()
            && ix.data[..IX_OPEN_FOR_REDEMPTION_DISC.len()] == IX_OPEN_FOR_REDEMPTION_DISC
            && ix.accounts.get(SEAL_IX_ASSET_IDX).map(|a| a.pubkey) == Some(asset)
            && ix.accounts.get(SEAL_IX_OWNER_IDX).map(|a| a.pubkey) == Some(owner)
        { found = true; break; }
    }
}
```

So BURN looks at indices 0..current, including inner instructions. An inner open would be in this range.

So the BURN code finds inner opens too. The comment says it doesn't. Discrepancy.

But again, not exploitable because bank's signature is required for burn_vault.

OK let me file this. It's a comment-vs-code discrepancy.

Hmm, one more thing. Let me check the seal's match. Does seal look at the burn's outer instruction?

The BURN comment says "a `burn_vault` reached BY a CPI sees the OUTER instruction's index". This implies: when burn is in a CPI, the burn's sysvar index is the outer's index. Which is wrong.

But maybe the comment is saying: when burn is in a CPI, the burn is at the outer's position in the sysvar, and the outer is not the actual burn_vault instruction. So BURN's check for burn_vault looks at the outer's index, but the outer's program is not BURN. So BURN's check fails.

Hmm but the code uses `load_instruction_at_checked(i)` which reads the i-th instruction. So if i is the outer's index, the code reads the outer, which is NOT burn_vault. So the seal's check fails.

But wait, the seal's check iterates from current+1, where current is the open's index. If open is at index 5, seal iterates 6, 7, 8, ...

If burn is in a CPI from a top-level at index 6, then burn is at index 7 in the sysvar. Seal iterates 6 (outer, not burn), 7 (burn, matches). So seal finds burn.

So actually, the code matches the inner burn (index 7) regardless of what comes between.

So the comment is wrong. The code DOES find inner burns. And the comment is wrong about "the OUTER instruction's index".

OK the comments are misleading.

Hmm wait actually let me re-think. The sysvar instructions are indexed. The way Solana orders them is: top-level instructions in order, then for each top-level, its inner instructions in order, then the next top-level's inners, etc.

So if top-level instruction 0 calls inner 0.0, 0.1, 0.2; top-level instruction 1 calls inner 1.0; etc.

Sysvar indices: 0, 1 (0.0), 2 (0.1), 3 (0.2), 4 (1.0), 5, 6 (5.0), ...

Wait, this isn't quite right. Let me think.

Actually, the sysvar contains ALL instructions in the order they execute. So if instruction 0 calls CPI to 0.1, then 0.1 calls CPI to 0.1.1, the order is 0, 0.1, 0.1.1.

Hmm but how are sysvar indices assigned? I believe they're sequential as instructions execute.

Anyway, the point is: load_instruction_at(i) reads the i-th instruction in execution order. Inner instructions are in this sequence.

The code doesn't distinguish inner from top-level. It just reads the i-th.

So inner instructions CAN satisfy the seal/burn checks.

The comment says they can't. The comment is wrong.

OK let me file this.

Alright, my findings are:

FINDING 1 (R4): SEAL and BURN file-level headers still restate "no co-signing tool exists" instead of pointing at SPEC.md. After cosign.mjs was added in this round, these claims are wrong.

FINDING 2: SEAL's comment claims inner burn_vault can't satisfy the forward match, but the code matches any instruction in the sysvar including inner instructions. Comment-vs-code discrepancy.

FINDING 3: BURN's comment claims inner open can't satisfy the backward match, but the code matches any instruction in the sysvar including inner instructions. Comment-vs-code discrepancy.

Hmm, let me also think about whether there's anything else.

Actually wait, looking at the SEAL header one more time:
```
//! ⚠️ WHAT ACTUALLY COVERS IT, AS OPPOSED TO WHAT IS USUALLY CLAIMED:
//!   * `bank/alarm.mjs` reports a NESTED VAULT every pass (`detectNestedVaults`,
//!     free — DAS already returns the owner) and an UNDECLARED TOKEN ACCOUNT in the
//!     daily `--reconcile`. Both are PERIODIC and POST-HOC.
//!   * The Bank's co-signature could refuse in the moment — a Solana signature
//!     covers the whole transaction, so the Bank sees every instruction — but
//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
//!     signs, because nothing signs. Until that is built, the pre-signature
//!     control is a human procedure, not a control.
```

This was written in round 13 (the last update). The diff shows changes to this section... actually no, the diff I was given only shows the byte count change. The file-level header wasn't updated.

So in round 14, this comment wasn't updated. In round 15, cosign.mjs was added. So the comment is now wrong.

OK finding 1 is a R4 finding: comment denying a control that now does run.

Let me also check MINT, BURN more carefully...

MINT's file header (around line 1-30):
```
//! CBOB Vault MINT — the only way a vault is created, and the only thing the
//! governors can steer.
```

No mention of "no co-signing tool". Good.

GOV's file header (around line 1-40):
```
//! CBOB Vault GOVERNANCE — one vault, one vote.
```

No mention. Good.

So only SEAL and BURN file headers have the wrong claim.

OK finding 1 is confirmed for SEAL and BURN.

Let me think if there's anything else worth filing.

Actually wait, let me look at the inner section of BURN. The diff shows:
```
+//! ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section —
+//! ONE place, so this can never drift from what actually runs. This paragraph
+//! used to assert the Bank's co-signature as the control ("a Solana signature
+//! covers the whole transaction, so the Bank sees every instruction"), which is
+//! true of Solana and false of this repository: NOTHING HERE SIGNS A REDEMPTION.
```

This says "NOTHING HERE SIGNS A REDEMPTION". But cosign.mjs can sign a redemption (with --live).

Wait but no Bank key exists. So nothing actually signs. The tool exists but doesn't sign because there's no key.

Hmm. So the comment is technically accurate (nothing currently signs) but misleading (the tool exists and could sign if there were a key).

OK this is a fine distinction. Let me not file this as a separate finding - it's the same as the file-level header.

Alright, let me also check if there are other "no tool exists" or similar claims elsewhere...

Actually, the file header in BURN:
```
//! WHAT THIS CAN AND CANNOT PROVE — stated plainly, because the previous version
//! shipped a burn that LOOKED like a proof:
//!   * CAN prove: PDA lamports are zero; every reserve mint's ATA (both token
//!     programs) is declared, PDA-owned, undelegated and empty; no declared account
//!     is a live Core asset (a nested vault).
//!   * CANNOT prove: completeness. Core exposes no way to enumerate the token
//!     accounts a PDA owns, so a NON-ATA account holding value and simply not
//!     declared is invisible here. ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN
//!     SPEC.md, "THE SHIP GATE" section — ONE place, so this can never drift from
//!     what actually runs.
```

OK this points at SPEC.md. ✓

And the SEAL's Config.reserve_mints doc points at SPEC.md. ✓

So the inner sections point at SPEC.md, but the file headers don't. Inconsistent.

Alright, let me finalize my findings.

Hmm, let me also think about the BANK's cosign - what happens if the Bank's key is exposed and an attacker signs?

The Bank's key is at /opt/cbob-vaults/bank/keys/bank.json. If an attacker steals this key, they can sign any redemption transaction.

This includes:
- Burn an asset (no fund value there directly)
- Burn without declaring all accounts (a fund loss if the customer has un declared accounts)

But the customer is the OWNER who submits their own redemption. If the Bank signs, the customer redeems their vault. The customer gets the cbBTC. The customer already owns the vault, so this is normal.

The Bank signing doesn't enable theft. The Bank's signature just enables the customer's redemption.

Unless the attacker is the customer AND the vault belongs to someone else. But the customer can't sign as the owner unless they have the owner's key. So this scenario requires the attacker to have both owner's key AND Bank's key.

So stealing Bank's key alone isn't enough for theft.

OK no exploit.

Hmm what about the BANK being a malicious operator who signs for some redemptions but not others? This would be a censorship attack. But the customer could always bare-burn via Core BurnV1 (no Bank needed). So censorship is partial.

OK not a critical issue.

Alright let me also think about what happens if the BANK signer's --live mode is accidentally turned on or off.

If accidentally on: Bank signs everything. No fund loss (just operational).
If accidentally off: Bank doesn't sign. Redemptions fail. Customer inconvenience.

Neither is a fund loss.

OK.

Let me think about one more thing. The cosign tool uses `--live` to sign. If the operator runs with --live by default, every transaction they inspect gets signed. If they don't, no signatures.

The default is inspect-only. So no signatures by default. The operator must consciously add --live.

OK that's by design.

Alright, let me also look at the lock test seam:
```javascript
_beforeSteal?: () => void
```

This is for testing. It's never set in production. ✓

```javascript
_beforeBreak?: () => void
_afterUnlink?: () => void
```

Same. ✓

OK.

Let me also check if there's a regression in any existing test...

Actually let me look at the FLOOR comment in selftest:
```javascript
// ROUND 14: this said 195 against a real count of 221 while the commit beside it
// added an EXTERNAL floor and claimed "every floor equals its real count". A
// floor 26 below reality is the same defeat round 12 fixed on-chain, left
// standing in the fix for it — and SPEC documents running this file DIRECTLY,
// which bypasses the runner's floor entirely. It is the current count.
const FLOOR = 275
```

So FLOOR is 275. The actual count is R.length after all tests run. The comment says it's the current count.

If you run `node bank/selftest.mjs`, the FLOOR check runs. If R.length < 275, exit 1. If R.length >= 275 and bad.length > 0, exit 1. If R.length >= 275 and bad.length == 0, exit 0.

So the floor catches deletions. ✓

But what if assertions are weakened? They still run, but pass. bad.length == 0. Exit 0. So the floor doesn't catch weakened assertions.

Hmm. The floor is a coarse defense. Sufficient against deletions but not against semantic weakening.

OK that's a known limitation.

Alright, I think I've covered everything. Let me write up my findings.

Wait, one more thing. Let me look at the round 14 verdict's note about MAX_RESERVE_MINTS = 3:

> "Only TWO reserve mints fit if the redeemer must create their destination ATAs" - so ATA creation MUST be a prior transaction. Is that written requirement sufficient, and what happens if a client ignores it?

The SPEC.md says this. But does any code enforce it? No, it's an operational requirement on the client. If the client ignores, transaction is too big.

But here's a thought: what if a redemption client tries to be helpful and INCLUDES the ATA creation in the redemption transaction? The transaction fails (too big). The client's UX is bad.

But the client can't broadcast the transaction. So the redemption doesn't go through. The customer loses the SOL on fees.

This is acceptable UX, not a fund loss.

OK.

Alright, my findings are:

1. R4 finding: SEAL and BURN file-level headers deny the Bank co-signer that now exists (cosign.mjs). They should point at SPEC.md.

2. R1 minor: cosign doesn't verify signatures (e.g., owner's signature). Could bless a transaction that fails on-chain for missing signature.

3. Comment discrepancy: SEAL header and BURN header claim inner instructions can't satisfy their pairing checks, but the code matches any instruction in the sysvar. Not a security bug but a misleading comment.

Actually let me also verify the comment in SEAL's open_for_redemption:
```rust
/// `load_instruction_at_checked` sees TOP-LEVEL instructions only, which is
/// deliberate and load-bearing in both directions:
///   * a `burn_vault` hidden inside another program's CPI is invisible here,
///     so it cannot satisfy this requirement;
```

The comment is in the SEAL function for open_for_redemption. The comment claims inner burn_vault is invisible.

But looking at the code:
```rust
let mut i = current + 1;
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
    if ix.program_id == BURN_PROGRAM_ID
        ...
```

The code uses `load_instruction_at_checked(i)` which reads the i-th instruction in the sysvar. There's no filter for top-level only.

So inner burn_vault CAN satisfy this check, contradicting the comment.

The comment is wrong.

OK let me also check BURN:
```rust
/// Top-level instructions only. An `open_for_redemption` buried inside another
/// program's contract cannot satisfy this, and a `burn_vault` reached BY a CPI sees
/// the OUTER instruction's index — so the wrapper would need a genuine top-level
/// open for this exact asset and owner before it, which SEAL in turn only
/// permits when a genuine top-level burn for the same pair follows.
```

The comment in BURN's burn_vault. Claims inner open is invisible.

But the code:
```rust
for i in 0..current {
    if let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
        if ix.program_id == SEAL_PROGRAM_ID
            ...
```

Doesn't filter for top-level.

So inner open CAN satisfy this check, contradicting the comment.

The comment is wrong.

OK so I have two comment-vs-code discrepancies in SEAL and BURN.

Hmm, but actually wait. Maybe the sysvar implementation treats inner instructions differently? Let me think.

Actually, I recall that `load_instruction_at_checked` reads from the instructions sysvar, which contains ALL instructions including inner. The sysvar doesn't have a separate "top-level only" mode.

But maybe the documentation says to use a specific way to distinguish? Let me think...

Actually I recall now - in some Solana documentation, there's a discussion about how the instructions sysvar includes inner instructions, and programs need to be careful. The convention is: top-level instructions are in `message.instructions` (with indices in the sysvar matching), inner instructions follow.

But within a program, you can't easily check "is this inner or top-level" without comparing against `message.instructions` (which you don't have access to directly).

So the SEAL/BURN code matches all instructions in the sysvar, including inner. The comment is wrong.

But again, not a security bug. Bank's signature requirement protects.

OK let me file my findings.

Hmm actually one more thought. Let me look at what the comment claims versus the actual exploitability:

> a `burn_vault` hidden inside another program's CPI is invisible here, so it cannot satisfy this requirement;

The comment says inner burn can't satisfy. So if a customer puts a top-level open and an inner burn (in a CPI from another program), the open would fail because no top-level burn exists.

But actually, the code DOES find inner burn. So the open succeeds.

So if the customer is the asset owner and can make Core Execute CPIs to BURN's burn_vault, and bank's signature is somehow propagated... but bank's signature can't be propagated via CPI.

UNLESS bank's signature is a top-level signature (which it is, via cosign). Then bank's signature is on the top-level transaction. In a CPI, bank's signature doesn't propagate.

So bank's Signer<'info> check fails in CPI. So burn_vault in CPI fails.

OK so the comment is wrong about inner burns being invisible, but the security holds because bank's signature can't be in a CPI.

Alright, let me finalize my report.

Wait, actually, I want to reconsider finding #1 once more. Let me look at the file headers in SEAL and BURN.

SEAL file header (line ~31):
```
//!   * The Bank's co-signature could refuse in the moment — a Solana signature
//!     covers the whole transaction, so the Bank sees every instruction — but
//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
//!     signs, because nothing signs. Until that is built, the pre-signature
//!     control is a human procedure, not a control.
```

BURN file header (line ~21):
```
//! ⚠️ AND READ "the Bank must alarm on every burn" AS EXACTLY THAT — an alarm,
//! AFTER the fact. `bank/alarm.mjs` now reports a nested vault every pass and an
//! undeclared token account daily, but **no Bank co-signing tool exists in this
//! repository**, so nothing scans before it signs.
```

Both restate "no tool exists". Both should point at SPEC.md.

OK finding 1 is real.

Hmm, but wait. The round 14 prompt said:
> Round 14 found the class surviving in three comments after the repair.

So three comments were found in round 14. The author fixed them. Then in this round, the file-level headers weren't fixed. So either:
1. The file-level headers were already correct (no fix needed)
2. The fix was missed

If (1), the author thinks the file headers are correct. They claim "no tool exists" - which was true before cosign.mjs was added. Now cosign.mjs exists. So the claim is false.

Unless the author means "no tool exists that actually runs" (i.e., the tool exists but isn't deployed). Then the claim is technically true.

Hmm. The author might mean this. The cosign.mjs file exists but isn't deployed. So "no co-signing tool exists" can be interpreted as "no co-signing tool runs in production".

But the cosign.mjs exists. If a future operator runs it (with --live), it would co-sign. So "no tool exists" is misleading.

OK I'll file this as a LOW finding because it's about a comment that could be interpreted either way, but is now potentially misleading.

Actually, let me upgrade to MEDIUM. The rule (point at SPEC.md) was established specifically to prevent this kind of drift. The fix was applied to one site (Config.reserve_mints doc) but not others. This is exactly the kind of drift the rule prevents.

OK MEDIUM.

Let me also think about the cosign tool signature verification. The cosign tool's job is to add the Bank's signature after validating. If it doesn't verify owner's signature, it could miss that the owner didn't actually sign. This is a weakness.

But the on-chain check (owner: Signer<'info>) catches this. So no fund loss.

But the cosign tool's job is to be a pre-sign check. If it misses owner signature, it's incomplete. Not a critical bug but a gap.

OK LOW for this.

For the SEAL/BURN comment vs code (inner instructions): the comment is wrong, but the security holds. LOW.

Alright, my findings are:
- MEDIUM: R4 drift in SEAL and BURN file headers
- LOW: cosign doesn't verify owner's signature
- LOW: SEAL/BURN comment claims inner instructions are invisible, code matches inner

Let me also think about whether I missed anything significant.

Hmm, let me look at the cosign one more time:

```javascript
if (!fs.existsSync(KEYFILE)) { console.error(`\nno Bank key at ${KEYFILE} — cannot sign`); process.exit(3) }
const bank = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYFILE, 'utf8'))))
if (bank.publicKey.toBase58() !== v.bank) {
    console.error(`\nthe key at ${KEYFILE} is ${bank.publicKey.toBase58()}, but the chain says the Bank is ${v.bank}`)
    process.exit(4)
}
```

So the Bank's key is loaded and verified to match the on-chain Bank. ✓

If the key is wrong, exits with 4. ✓

If the key doesn't exist, exits with 3. ✓

OK.

Let me look at how the customer's transaction is signed. The customer constructs a Transaction, signs it with their owner keypair, then base64 encodes and passes to cosign.

The cosign's `inspect(b64)` decodes, inspects, then if --live is set, adds Bank's signature via `tx.partialSign(bank)`.

After partialSign, the transaction has both signatures. The customer can then broadcast.

What about the owner's signature? The customer provided it. The cosign doesn't re-verify it.

What if the customer's signature is invalid (wrong owner keypair)? On-chain, the owner's Signer<'info> check would fail.

What if the customer's signature is missing? On-chain fails.

What if the customer's signature is on a different transaction (replay)? Then the partialSign adds Bank's signature to a different transaction. The customer broadcasts the original (without Bank's signature) or this tampered one. Either way, on-chain fails.

OK no exploit.

Let me also check the cosign's broadcast step. The cosign tool doesn't broadcast. It just outputs the signed transaction base64. The customer broadcasts.

So the Bank's signed transaction is returned to the customer. The customer can broadcast it (or not, or store it, or analyze it). The Bank doesn't know if the customer actually uses it.

Hmm, this means the Bank can't enforce that the customer uses the signature correctly. But this is by design - the Bank is a co-signer, not a broadcaster.

OK.

Actually, hmm, one more thing. The Bank's signature on a transaction can be REUSED if the customer broadcasts the same signed transaction multiple times. Wait, no - Solana transactions include a recent blockhash, which makes them unique. The same transaction can't be broadcast twice (it would fail because the blockhash is too old).

Actually, if the recent blockhash is recent enough, the same transaction CAN be broadcast twice. Solana's dedup might catch it. Or the second transaction might succeed, paying the customer twice.

Hmm wait, this is a concern. The Bank's signature is on a specific transaction. If the customer broadcasts it once, fine. If they broadcast it twice... the second one would either fail (recent blockhash expired) or succeed (if recent).

If it succeeds, the vault is redeemed twice. But a vault can only be redeemed ONCE (because burn destroys the asset). So the second transaction would fail (asset doesn't exist).

Hmm wait, the asset is destroyed after the first burn. The second burn's asset slot would point to a destroyed asset. The seal/burn programs would fail.

Actually, the seal program requires the asset to be live. After the first burn, the asset is burnt. So the second open would fail (asset not live).

OK no double-redemption.

But this is a non-issue because of the asset destruction.

Alright, I think I've covered everything. Let me write my findings.

Actually, one more thing. Let me check if there's a way for the cosign to miss the Bank's signature being needed.

The customer's transaction has the Bank in two places:
- open_for_redemption's bank: Signer
- burn_vault's bank: Signer

Both need Bank's signature.

The cosign tool adds Bank's signature to the transaction. The signature covers the whole transaction. So both halves get the signature. ✓

But what if Bank's signature is on the transaction, but the actual signer doesn't match what's expected (e.g., wrong keypair)? On-chain, both halves check `require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, ...)`. If the bank's keypair is different from cfg.bank, the check fails.

Wait, the Bank's keypair is the one in cfg.bank (in BURN's config and SEAL's config). The cosign reads SEAL's config to get bank. The Bank's keypair from KEYFILE must match.

The cosign checks: `if (bank.publicKey.toBase58() !== v.bank) process.exit(4)`. So if the keyfile's pubkey doesn't match SEAL's config's bank, exit 4.

So the Bank's keypair is verified to match the on-chain Bank. ✓

If someone swaps the keyfile with a different keypair, the cosign refuses. So only the correct Bank keypair can sign. ✓

OK.

Hmm, actually wait. The cosign checks `bank.publicKey.toBase58() !== v.bank`. v.bank is from SEAL config. BURN config also has a bank. Are they the same?

BURN checks `require_keys_eq!(governance, Pubkey::new_from_array(b), cfg.bank, BurnError::WiringDiverged)` - so BURN checks that SEAL's bank matches BURN's bank.

But the cosign doesn't check this. The cosign reads SEAL's bank. What if BURN's bank differs from SEAL's bank?

Then a redemption would have the Bank's signature (matching SEAL's bank), but BURN's burn_vault requires BURN's bank to sign. If BURN's bank differs, the burn fails.

But BURN checks for divergence at burn_vault time, refusing with WiringDiverged.

So if there's divergence, the burn fails. The Bank's signature is on the transaction but the burn doesn't go through.

This is caught on-chain. But it would be nice if the cosign also checked BURN's bank.

Hmm, the cosign reads SEAL's bank (via pinnedAccountData). It doesn't read BURN's config. So the cosign might miss BURN's bank being different.

Is this exploitable? Let me think.

If BURN's bank differs from SEAL's bank, the burn fails with WiringDiverged. The customer's transaction fails. No fund loss.

So it's caught on-chain. The cosign missing it just means the cosign blesses a transaction that fails on-chain. UX issue, not security.

OK LOW priority if I file this.

Alright, let me write my findings.

Actually, I want to reconsider finding 1 (R4 drift). Let me see if the comment is just out of date or actively misleading.

The comment in SEAL file header says:
> **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.**

After cosign.mjs was added, this is false. The tool exists.

The comment in BURN file header says:
> **no Bank co-signing tool exists in this repository**

Same issue.

These are concrete false claims. The author should update them.

The fix (per the rule) is to point at SPEC.md rather than restating. Let me file this as MEDIUM because it's exactly the kind of drift the rule prevents.

OK final findings:

1. MEDIUM (R4): SEAL and BURN file-level headers restate "no co-signing tool exists" instead of pointing at SPEC.md. After cosign.mjs was added, the claims are wrong. Rule violation.

2. LOW (R4): SEAL's open_for_redemption comment and BURN's burn_vault comment claim inner instructions can't satisfy the pairing checks. The code matches any instruction in the sysvar. Comment-vs-code discrepancy.

3. LOW (R1): Cosign tool doesn't verify owner's signature is actually on the transaction. Could bless a transaction missing owner's signature (which fails on-chain). Not exploitable due to on-chain check.

4. LOW (R1): Cosign tool reads SEAL's bank but doesn't verify it matches BURN's bank. If they differ, the burn fails on-chain with WiringDiverged. UX issue, not security.

Alright, let me write up the report.

Actually, one more pass. Let me see if there's anything I missed in R3.

R3 covers:
- applyAcks / parseAcks / bank/acks.json
- unredeemable_owner in detectNestedVaults
- REDEMPTION_NOISE allowlist
- validate-core-gate.sh
- ceiling harness 9.14/9.14a/9.14b
- FLOOR in selftest.mjs and run-tests.sh

For applyAcks: I verified it's correct. ✓
For unredeemable_owner: I verified it's a real concern (Squads treasury can buy a vault). ✓
For REDEMPTION_NOISE: I verified it's correctly scoped. ✓
For validate-core-gate.sh: I verified it works. ✓
For ceiling harness: I verified it's correct (lamport sweep included, both ATA derivations declared, pinned to literal). ✓
For FLOOR: I verified it's correct (matches real count). ✓

Are there bugs in any of these?

Hmm, applyAcks's key is `<kind>:<asset>`. What if kind or asset contains a colon? Let me check...

Actually I already checked this. No finding kinds have colons.

What about kind = '' (empty string)? The condition `if (!f.asset || !f.kind)` would catch !f.kind (empty is falsy). ✓

What about asset = '' (empty string)? Same, catches. ✓

OK applyAcks is fine.

For REDEMPTION_NOISE, are there other findings that should be in the allowlist?

Looking at the kinds:
- vault_burned ✓
- vault_vanished ✓
- deactivated ✓
- reserve_fell ✓
- burn_via_program (already INFO, not in allowlist)
- approve, non_ata_token_account, reserve_ata_created (other kinds, not in allowlist)
- vault_owns_itself (CRITICAL, but...)
- nested_vault (CRITICAL)
- undeclared_token_account (CRITICAL)
- undeclared_token_account (CRITICAL)
- ...

What about vault_owns_itself? A vault owned by its own asset-signer PDA. This is bricked. But the redemption would burn the vault. Would the burn trigger vault_owns_itself?

Hmm, vault_owns_itself is detected by detectNestedVaults when the owner equals the vault's own PDA. After the vault is burned, the owner is still the (now-dead) PDA. So detectNestedVaults would fire vault_owns_itself for the burnt vault.

But burnt vaults are not in the live set (DAS removes them). So detectVaultSetChange fires vault_burned (which is in REDEMPTION_NOISE). The vault is gone from the reconcile, so detectNestedVaults doesn't see it.

Hmm but the order matters. detectNestedVaults runs every pass. detectVaultSetChange runs every pass. Both fire on burnt vaults.

Actually, detectVaultSetChange uses `prev.vaults` and current `vaults`. If a vault is in prev but not current, it's "gone". Detect fires vault_burned (if burnt) or vault_left_index.

detectNestedVaults uses `everyVault` which includes burnt ones (per the diff: `const { live: vaults, burnt, all: everyVault } = await listVaults(...)` and `findings.push(...D.detectNestedVaults(everyVault, ...))`).

So detectNestedVaults sees burnt vaults too. For a burnt vault, owner is still the (now-dead) PDA. The check:
```javascript
if (host === id) {
    out.push({ kind: 'vault_owns_itself', severity: S.CRITICAL, asset: id,
      detail: `vault ${id} is owned by its OWN asset-signer PDA. ...` })
    continue
}
```

Wait, this is for live vaults whose owner is the PDA. For a burnt vault, the asset-signer PDA exists (Core doesn't close it). So `host === id` might be true.

But is the burnt vault's owner still the PDA? When the vault is burnt, the asset is destroyed. The owner bytes in the asset's data... hmm, let me think. After BurnV1, the asset's data is left at Key::Uninitialized (1 byte). So owner bytes are not preserved.

`read_core_asset` checks:
```rust
require!(data.len() >= 66 && data[0] == KEY_ASSET_V1, VaultError::NotACoreAsset);
```

For a burnt asset, data[0] != KEY_ASSET_V1. So read_core_asset fails.

So detectNestedVaults, which uses `ownership.owner` from DAS (not from raw bytes), would get the owner from DAS. DAS might still report the owner even after burn.

Hmm, this depends on DAS's behavior. Let me assume DAS reports the owner even after burn.

Then for a burnt vault:
- DAS says owner = original_owner (alive, off-curve PDA, or whatever)
- DAS says burnt = true
- DAS says owner_pda == vault_pda? Depends on original owner

For a vault that was owned by its own PDA before burning:
- Original owner = own PDA
- After burn, DAS might still report this owner
- detectNestedVaults sees owner = own PDA
- Fires vault_owns_itself

Hmm but the vault is burnt. The finding is for a burnt vault.

In correlateBurns, vault_owns_itself is NOT in REDEMPTION_NOISE. So this finding stays CRITICAL.

But the vault is bricked (impossible to redeem anyway). So the finding is informational, not actionable.

Hmm. Is this a problem?

Looking at the REDEMPTION_NOISE list: vault_burned, vault_vanished, deactivated, reserve_fell. vault_owns_itself is not there.

Should it be? If a vault was owned by its own PDA AND was burnt (via what? impossible to redeem), then vault_owns_itself + vault_burned both fire. The vault_burned is in REDEMPTION_NOISE, downgraded to INFO. The vault_owns_itself stays CRITICAL.

But the vault is BRICKED. The finding is unfixable. So it should be acked (or downgraded).

The author's ack mechanism handles this. A human can ack `vault_owns_itself:<bricked_vault>` to downgrade it.

OK so the system handles it.

But wait - how would a vault be owned by its own PDA AND be burnt? The vault is bricked (can't redeem). It can be burnt via Core BurnV1 directly by the owner... but the owner is a PDA. PDAs can't sign top-level. So a bare burn by a PDA owner isn't possible.

But the PDA could sign via CPI (e.g., Core Execute). But Core Execute requires the owner's signature (which is a PDA, so via CPI).

This is convoluted. Let me think.

Actually, the original Core BurnV1 requires the asset owner's signature. The owner is the PDA. The PDA can sign via CPI. So a CPI from some program could call Core BurnV1 with the PDA as a signer.

But the CPI's signer set must include the PDA. The CPI's calling program must have the PDA in its signer set. The calling program is... Core Execute? But Core Execute is a top-level instruction that requires the asset owner's signature (the PDA). To call Core Execute, the PDA must sign the top-level tx. But the PDA can't sign top-level.

So no program can call Core BurnV1 with a PDA owner. The vault is permanently unburnable.

OK so vault_owns_itself + burnt isn't a real scenario.

But wait - what if the owner of the vault was transferred to its own PDA AFTER some redemptions? Like:
- Vault has owner = Alice
- Alice redeems (vault is gone)
- Vault is bricked somehow... no wait, after burn, the asset is gone.

OK so this scenario doesn't exist in practice.

Alright, vault_owns_itself + burnt doesn't happen. Not a finding.

OK let me look for other issues.

Hmm let me look at the applyAcks edge case. What if acks is not an object (e.g., a string)? parseAcks would return `{acks: {}, problem: 'not a JSON object'}`. alarm.mjs logs the error and returns `{}`. So no acks applied. ✓

What if acks has invalid keys? `acks[\`${f.kind}:${f.asset}\`]` would return undefined. The condition `typeof why !== 'string'` would be true (undefined is not string). Return f. ✓

What if acks has the key but the value is null? Same as undefined. ✓

What if acks has the key with a non-string value (e.g., a number)? `typeof why !== 'string'` catches. ✓

OK applyAcks is robust.

Alright, my findings:
1. MEDIUM: SEAL and BURN file headers still restate "no co-signing tool exists"
2. LOW: Comment vs code in SEAL/BURN about inner instructions
3. LOW: cosign doesn't verify owner's signature
4. LOW: cosign doesn't verify BURN's bank matches SEAL's bank

Actually wait, I should re-examine my LOW findings. Let me check if any are MEDIUM-worthy.

The cosign's lack of owner signature verification: this is a gap. The cosign is supposed to be a comprehensive pre-sign check. Missing owner signature is a hole. But it's not a critical bug because the on-chain check catches it.

Hmm. MEDIUM might be appropriate.

The cosign's lack of cross-checking BURN's bank with SEAL's bank: this is also a gap. But it's caught on-chain. LOW.

The comment vs code about inner instructions: this is a comment issue, not a code bug. The code is "right" by Solana's design. The comment is misleading. LOW.

OK my findings stand.

Actually, let me look at one more thing. The seal program has the comment in open_for_redemption:
> `load_instruction_at_checked` sees TOP-LEVEL instructions only

But the seal code iterates from current+1, where current is the index of the open instruction. The open is top-level (we're in it). current+1 is the next index. This includes both top-level and inner instructions at higher indices.

But what if burn is in a CPI from a top-level at index current+1? Then burn is at current+2 (inner). The seal iterates current+1 (the outer, not burn), then current+2 (the inner burn, match).

Hmm but what if burn is at current+1 directly (top-level)? Then seal iterates current+1 (the burn, match). Both work.

So the seal finds the burn regardless of whether it's top-level or inner. The comment is wrong about "TOP-LEVEL instructions only".

The comment is wrong but not a security bug.

OK let me finalize.

Actually wait, I want to also think about whether the comment about "TOP-LEVEL instructions only" was wrong in a different way.

Looking at the SEAL comment again:
> `load_instruction_at_checked` sees TOP-LEVEL instructions only, which is
> deliberate and load-bearing in both directions:

So the author CLAIMS load_instruction_at_checked sees only top-level. But this is wrong - it sees all instructions (top-level and inner) in the sysvar.

Hmm wait. Maybe I'm wrong about this. Let me think again.

Actually, I recall now - the Solana documentation says `load_instruction_at(i)` reads the i-th instruction in the sysvar. The sysvar contains ALL instructions.

But maybe there's a specific way the indices are assigned? Let me think.

Actually, the sysvar's instructions are indexed in the order they appear in the transaction's message. Top-level instructions come first, then their inner instructions, then the next top-level, etc.

So:
- Top-level 0 → sysvar index 0
- Top-level 0's inner 0 → sysvar index 1
- Top-level 0's inner 1 → sysvar index 2
- Top-level 1 → sysvar index 3
- etc.

`load_instruction_at(0)` reads top-level 0.
`load_instruction_at(1)` reads inner 0 (from top-level 0).

So inner instructions are in the sysvar and accessible via load_instruction_at.

The comment claims top-level only. The code matches any instruction. Discrepancy.

Hmm, but maybe the AUTHOR is right and I'm wrong? Let me think about this more carefully.

Actually, I think the convention might be different. Let me check.

Looking at Solana's `solana_program::sysvar::instructions`:
- The sysvar stores instructions in the order they execute
- Top-level instructions and their inner instructions are all stored
- `load_instruction_at(i)` reads the i-th instruction

So inner instructions ARE in the sysvar. They're accessible.

The seal/burn code matches any instruction in the sysvar. So inner instructions CAN satisfy.

The comment is wrong.

OK this is a comment-vs-code discrepancy. Let me file as LOW.

Alright, let me write up my findings now.

Hmm, actually I want to verify one more thing about the spec contradiction. Let me look at the SPEC:

```
| step | where | who |
|---|---|---|
| 1. `sweep_sol_for_swap` | **on-chain**, bounded by a SOL fee reserve, destination PINNED in config | permissionless |
```

The "who" column says permissionless. But the program requires operator signature. Contradiction.

The carry-over list notes this as #6: "SPEC contradicts the implementation on sweep authorization and carries stale counts."

So this is a known issue. Not a new finding.

OK final findings:

1. MEDIUM (R4): SEAL and BURN file headers restate "no co-signing tool exists"
2. LOW (R4): Comment vs code about inner instructions in SEAL and BURN
3. LOW (R1): Cosign doesn't verify owner signature
4. LOW (R1): Cosign doesn't verify SEAL bank matches BURN bank

Actually, let me also think about whether the cosign verifies the RECENT BLOCKHASH is valid. The cosign doesn't check this. But Solana verifies it on-chain. So no issue.

OK let me also check the BURN's reserve_mints list. The cosign reads bank from SEAL config. It doesn't read reserve_mints. The cosign doesn't check that the reserve_mints in the burn's remaining_accounts match SEAL's reserve_mints.

But on-chain, BURN reads reserve_mints from SEAL config and iterates. It requires each reserve mint's ATA to be declared. If the burn doesn't declare them, BURN fails.

The cosign doesn't verify this. It just checks that the DECLARED count matches the accounts carried.

Hmm, but on-chain, BURN iterates and requires each reserve mint's ATA. If a reserve mint's ATA isn't declared, BURN fails with ReserveNotDeclared.

So the cosign blessing a transaction that fails on-chain with ReserveNotDeclared is a UX issue, not security.

OK LOW for the cosign's incomplete checking.

Alright, let me finalize. My findings are:
1. MEDIUM (R4): SEAL and BURN file headers restate "no co-signing tool exists"
2. LOW (R4): Comment vs code about inner instructions in SEAL and BURN
3. LOW (R1): Cosign doesn't verify owner signature

I'll consolidate findings 2 and 3 as they're similar.

Let me write up.

Wait, I also want to verify one more thing. The cosign's `disc()` function:

```javascript
const disc = n => [...createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)]
```

So `disc('open_for_redemption')` returns the 8-byte Anchor discriminator for `open_for_redemption`. ✓

The cosign uses these discriminators in the shape check. The discriminators must match what BURN and SEAL programs use.

The SEAL program has `IX_BURN_VAULT_DISC` as a constant, asserted in the test. So it matches.

The BURN program has `IX_OPEN_FOR_REDEMPTION_DISC` as a constant, asserted in the test. So it matches.

OK discriminators are correct.

Alright, my findings are:

1. MEDIUM (R4): SEAL and BURN file-level headers still restate "no co-signing tool exists" after cosign.mjs was added. Should point at SPEC.md.

2. LOW (R4): SEAL's open_for_redemption comment and BURN's burn_vault comment claim inner instructions can't satisfy the pairing checks, but the code matches any instruction in the sysvar. Comment-vs-code discrepancy.

3. LOW (R1): Cosign tool's shape check doesn't verify owner or bank signatures are present on the transaction. It only verifies the shape and the pubkeys. On-chain `Signer<'info>` checks catch this, so not a security bug, but the cosign's coverage is incomplete.

Let me also think about whether the cosign tool reads the SEAL config's BANK (correct) or could it mismatch. Looking again:

```javascript
const sealCfg = PublicKey.findProgramAddressSync([Buffer.from('config')], SEAL)[0]
const acc = await conn.getAccountInfo(sealCfg, 'confirmed')
if (!acc) throw new Error('the SEAL config is not deployed — there is nothing to co-sign against')
const data = pinnedAccountData(acc, { program: SEAL, struct: 'Config', version: 1, what: 'the SEAL config' })
const bank = new PublicKey(data.subarray(73, 105)).toBase58()
```

So it reads SEAL's config, verifies it's the right type/version, then reads the bank at offset 73..105.

What about BURN's config? The cosign doesn't read it. So it doesn't know what bank BURN expects.

But on-chain, BURN verifies that SEAL's bank matches BURN's bank (WiringDiverged). So if they differ, BURN fails.

The cosign missing this is OK (caught on-chain).

But here's a thought - what if BURN's bank is rotated independently of SEAL's? The cosign reads SEAL's bank. If they're different, the burn fails. But the customer might think the cosign's blessing is sufficient.

This is a UX issue, not a security issue.

OK LOW if I file this.

Alright, final findings:

1. MEDIUM (R4): SEAL and BURN file-level headers restate "no co-signing tool exists"
2. LOW (R4): SEAL/BURN comment claims inner instructions can't satisfy pairing checks
3. LOW (R1): Cosign tool's signature verification is incomplete (doesn't check signatures are present)
4. LOW (R1): Cosign tool doesn't cross-verify BURN's bank with SEAL's bank

Let me also add a finding for the cross-pass correlation lag, which is a known issue but I want to mention it's still real:

5. The cross-pass correlation lag is still a real issue. The CRITICAL for vault_burned fires before the burn_vault is seen, and nothing retracts it.

But this is acknowledged. Not a new finding.

Alright, let me write the report.

Actually let me also think about the "Given that no human firm will ever see this" question. The prompt asks:
> GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that fifteen rounds of AI audit structurally cannot?

This is asking for process recommendations. Let me think:

1. The AI audit has clear blind spots - it can't execute code, can't observe real-time behavior, can't run for long periods.
2. The audit covers design/code/docs but not deployment/operations.
3. A human firm would catch certain things AI misses:
   - Operational procedures
   - User experience issues
   - Real-world attack scenarios
   - Long-term performance

So the project should:
1. Run extensive integration tests with real Solana tools
2. Have a manual security review by experts (impossible per the ruling)
3. Maintain a "ship gate" with multiple validators
4. Have a public bug bounty program (crowdsourced)
5. Have a "pause" mechanism that can be triggered by any concerning behavior
6. Run in shadow mode before real money
7. Have extensive monitoring/alerting beyond what the alarm does

Let me think about what would actually help:
- Bug bounty: real money for finding bugs, attracts security researchers
- Shadow mode: deploy to mainnet but don't actually take customer funds yet
- Monitoring: more than just the alarm - transaction-level monitoring
- Pause mechanism: admin can pause everything if something looks wrong
- Time-delayed operations: certain actions require a delay (already partly done)

OK let me write this up.

Let me also think about whether the audit process itself can be improved:
- More models, less correlation of failures
- Specific probes (e.g., always measure on-chain after every fix)
- Adversarial scenarios pre-built
- Round-robin audit assignments

OK let me write my report.

Hmm actually let me also look at the carry-overs again to see if any are worse than stated.

1. Cross-pass correlation lag - real, not fixed. CRITICAL can fire and not retract. This is a real issue but acknowledged.
2. CU unmeasured - real, acknowledged. Risk is unknown.
3. Hash slice at 45 wrong for immutable - real bug, but only affects immutable programs. In production, the four programs are upgradeable, so doesn't affect alarm. But Core on mainnet... if Core's upgrade authority is absent, the hash is wrong. If Core is ever upgraded (now using the wrong authority), the alarm would falsely detect drift.
4. Foreign Core asset nested - real gap, acknowledged.
5. burn_via_program doesn't verify asset - theoretical, not exploitable.
6. SPEC contradicts implementation on sweep - acknowledged.
7. MINT carries dead redemption stamp - acknowledged.
8. Distribution reconciles against ledger payer wrote - acknowledged, fundamental.
9. Duplicate attribute keys - acknowledged.

These are all real issues. None are NEW findings, they're carry-overs.

OK let me finalize my report.

Actually, let me look at #3 once more. The hash slice at 45 for an immutable program:

```javascript
const hasAuth = acc.data[12] === 1
snap[`prog.${name}.upgrade_authority`] = hasAuth
    ? new PublicKey(acc.data.subarray(13, 45)).toBase58()
    : 'IMMUTABLE'
snap[`prog.${name}.hash`] = createHash('sha256').update(acc.data.subarray(45)).digest('hex').slice(0, 32)
```

For immutable (hasAuth = false), the hash is sha256 of `acc.data.subarray(45)`. But for immutable, the ELF starts at offset 13 (after the discriminant byte at 12). So this hashes the wrong bytes - it skips the first 32 bytes of the ELF (bytes 13-44) and includes 32 zero bytes (or whatever is at 45+).

So the hash is wrong for immutable programs.

This is a real bug. But it only matters if the alarm compares to a pinned hash. Looking at alarm.mjs, the hash is stored in snap but not compared. The drift detection compares prev to cur, but only if both have the same hash computation.

If a program was always immutable, the hash never changes (the program is immutable). So drift detection wouldn't fire incorrectly.

If a program was upgradeable and then became immutable (authority removed), the hash would change. But this is intentional - removing authority is a meaningful change. The drift would correctly fire (if computed correctly).

But the computed hash is wrong. So the drift would say "hash changed from X to Y" but neither X nor Y is the real hash.

Hmm, this is subtle. If the pinned mainnet dump for an immutable program is hashed correctly, but the alarm computes the wrong hash, they wouldn't match. The alarm would see a "drift" on every run.

So for an immutable Core program, the alarm would constantly fire a CRITICAL saying Core changed. False positive.

This is a real bug. Worth noting.

But the carry-over #3 acknowledges this. So it's a known issue.

Hmm, the carry-over says "Now applies to Core too." So the author is aware.

OK so this is a real, acknowledged issue. Not a new finding, but worth noting as a real issue.

Let me also think about #2 - CU unmeasured. The byte ceiling is 1232 for legacy. The CU ceiling is 1.4M. Each instruction uses CU. For burn_vault with 3 reserve mints, each reserve mint has 2 token program derivations, so 6 ATA checks per reserve mint × 3 = 18 ATA checks. Plus the rest.

The 4.6 test measures bytes but not CU. The CU could be the limiting factor.

If burn_vault uses more than 1.4M CU, the transaction fails with ComputeBudgetExceeded. So even if it fits in bytes, it might not fit in CU.

This is acknowledged.

Alright, let me write my report.

Hmm one more thing. Let me check the comments one more time.

Looking at the SEAL header:
```
//! ⚠️ AND NEITHER CAN A VAULT'S OWNER. A DAO CANNOT HOLD A VAULT.
//! 
//! Round 14: the Bank rule is the narrow case. **Any address that cannot sign a
//! top-level instruction cannot redeem a vault it owns** — the pairing needs two
//! top-level owner signatures, and a program signs only by CPI. So a DAO buying
//! a charter vault from its Squads treasury pays real money, deposits real cbBTC, and
//! receives a permanently sealed asset.
```

This says "Any address that cannot sign a top-level instruction cannot redeem". This is accurate. The PDA owner case.

```
//! **An off-curve owner may also be a marketplace escrow holding a listed vault, which is
//! recoverable. We do not yet know whether Core marketplaces escrow the asset or use a
//! transfer delegate that leaves ownership alone, so there is no allowlist here and the
//! finding names both readings.
```

OK, the SPEC and the headers are consistent on this point.

Alright, my findings are final. Let me write the report.

Wait, I want to also double-check one thing. The validate-core-gate.sh script:

```bash
must_fire(){ if gate "$1"; then die "FALSE PASS — the gate accepted $2. The gate is useless."; fi; echo "  correct: fired"; }
must_pass(){ if ! gate "$1"; then die "FALSE FAIL — the gate rejected $2. It would reject every good validator."; fi; echo "  correct: passed"; }
```

`must_fire`: gate returns 0 (gate passed), die. gate returns non-zero (gate fired), no die.
`must_pass`: gate returns 0 (gate passed), no die. gate returns non-zero (gate fired), die.

So must_fire expects gate to NOT pass. must_pass expects gate to pass.

In bash: `if gate "$1"; then` is true if gate returns 0. So:
- must_fire: if gate returns 0, die. if gate returns non-zero, no die.
- must_pass: if gate returns non-zero, die. if gate returns 0, no die.

OK that's correct.

But wait, the `if ! gate` syntax. In bash, `! cmd` negates the exit status. `if ! gate` is true if gate returns non-zero. So `if ! gate "$1"; then die` dies if gate returns non-zero.

Hmm let me trace again:
- `if ! gate "$1"; then die` → enters `then` if `! gate` is true, i.e., gate returned non-zero.
- So dies if gate returned non-zero. ✓ (must_pass expects gate to pass, returns 0; dies if non-zero)

OK correct.

Hmm but in `must_fire`:
- `if gate "$1"; then die` → enters `then` if gate returned 0.
- Dies if gate returned 0 (passed). ✓ (must_fire expects gate to fire, returns non-zero; dies if 0)

OK both correct.

Alright, let me write my report.

Oh wait, I realize I should also check if the new SELFTEST passes. Let me look at the assertions added:

```javascript
console.log("── the Bank's pre-signature judgement on a redemption ──")
{
  ...
  t('a well-formed redemption is ACCEPTED', ...)
  t('...and it reports the asset and owner it bound', ...)
  t('a thaw with NO burn is refused', ...)
  t('a burn with NO thaw is refused', ...)
  t('TWO redemptions in one transaction are refused', ...)
  t('the burn BEFORE the thaw is refused', ...)
  t('a burn naming a DIFFERENT asset is refused', ...)
  t('a burn naming a DIFFERENT owner is refused', ...)
  t('a thaw naming someone else as the Bank is refused', ...)
  t('a burn naming someone else as the Bank is refused', ...)
  t('an OFF-CURVE owner is refused (it could never sign the pair anyway)', ...)
  t('an EXTRA instruction to SEAL is refused', ...)
  t('a declared COUNT that disagrees with the accounts carried is refused', ...)
  t('...and every refusal SAYS why', ...)
  t('an unreadable curve check does not refuse on its own', ...)
  // coverage
  t('coverage passes when every holding is declared', ...)
  t('an UNDECLARED token account is refused', ...)
  t('an UNDECLARED nested Core asset is refused', ...)
  t('...and the refusal says it would be DESTROYED', ...)
  t('a vault that holds nothing passes', ...)
}
```

These are 19 assertions for the cosign judge. Plus more for applyAcks.

Let me count: I see about 19 for the redemption judgement, plus 5 for coverage, plus several for acks. Let me count more carefully.

Bank judgement: 14 assertions
Coverage: 5 assertions
Acking: 12 assertions
That's about 31 new assertions in selftest. The floor went from ~221 to 275 = +54. So that's consistent.

OK.

Let me also look at the new lock tests:
```javascript
const misSteal = LK.acquireLock(L, { alive: dead, _beforeSteal: () => {
    try { fsx.unlinkSync(L) } catch {}
    racer = LK.acquireLock(L, { alive: dead })
} })
t('a runner that renames away a REPLACEMENT lock does not keep it', misSteal.ok, false)
t('...and says it lost the race', !!misSteal.lostRace, true)
t('...and the replacement is PUT BACK, not destroyed', ...)
t('...and the winner can still free its own lock', LK.releaseLock(L, racer.token), true)
t('the steal leaves no temp file behind', ...)
```

That's 5 new lock assertions.

OK.

Alright, let me write the report now.

Let me reconsider one more time before writing.

Hmm, looking at the diff one more time:

```
+//! ⚠️ WHAT ACTUALLY COVERS IT, AS OPPOSED TO WHAT IS USUALLY CLAIMED:
+//!   * `bank/alarm.mjs` reports a NESTED VAULT every pass (`detectNestedVaults`,
+//!     free — DAS already returns the owner) and an UNDECLARED TOKEN ACCOUNT in the
+//!     daily `--reconcile`. Both are PERIODIC and POST-HOC.
+//!   * The Bank's co-signature could refuse in the moment — a Solana signature
+//!     covers the whole transaction, so the Bank sees every instruction — but
+//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
+//!     signs, because nothing signs. Until that is built, the pre-signature
+//!     control is a human procedure, not a control.
```

This is in the diff as added. Let me check if this was added in this round or earlier.

Actually wait, looking at the diff format more carefully. The diff shows what changed. Lines starting with `-` are removed, lines starting with `+` are added. If I see lines starting with `-` for these header comments, it means they were REMOVED. If I see lines starting with `+`, they were ADDED.

Let me look at the actual diff for SEAL's file header...

Hmm, the diff I was given for SEAL is:
```
-//! MEASURED, not estimated (suite 9.14), by building the real transaction:
-///     1 mint -> 802 bytes   2 -> 946   3 -> 1090   4 -> cannot be serialized
+/// MEASURED, not estimated (suite 9.14), by building the real WORST-CASE
+/// transaction ...
```

This shows changes to the byte count comment, not the file header.

But the file header in the new tree still says "no co-signing tool exists". So either:
- The header was already there (added in earlier round, unchanged this round)
- The header was updated in this round but the diff doesn't show

Let me re-check the file header text in the prompt...

```
//! ⚠️ WHAT ACTUALLY COVERS IT, AS OPPOSED TO WHAT IS USUALLY CLAIMED:
//!   * `bank/alarm.mjs` reports a NESTED VAULT every pass (`detectNestedVaults`,
//!     free — DAS already returns the owner) and an UNDECLARED TOKEN ACCOUNT in the
//!     daily `--reconcile`. Both are PERIODIC and POST-HOC.
//!   * The Bank's co-signature could refuse in the moment — a Solana signature
//!     covers the whole transaction, so the Bank sees every instruction — but
//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
//!     signs, because nothing signs. Until that is built, the pre-signature
//!     control is a human procedure, not a control.
```

Yes, this is in the new SEAL lib.rs. So this comment is currently in the file.

Was it added or unchanged? Looking at the diff... the diff doesn't show this comment. So either:
1. The comment was added in a previous round and unchanged here
2. The comment was added in this round and I'm missing it in the diff

Actually, looking at the diff for the Config.reserve_mints comment (which IS in the diff):
```
-    /// Unknown airdropped tokens still cannot be enumerated by any program — that gap is covered by
-    /// the Bank co-signature and the off-chain scanner, stated plainly rather
-    /// than papered over.
+    /// Unknown airdropped tokens still cannot be enumerated by any program.
+    /// ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section —
```

So the Config.reserve_mints doc was updated. The new comment says "WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md".

And the FILE-LEVEL header for SEAL still says "no co-signing tool exists". So the file-level header was NOT updated.

This is inconsistent. The file-level header should also point at SPEC.md.

OK this is a finding. Let me write it up.

Hmm wait, let me check BURN's file header diff too. The BURN diff shows:
```
+//! ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section —
+//! ONE place, so this can never drift from what actually runs. This paragraph
+//! used to assert the Bank's co-signature as the control ("a Solana signature
+//! covers the whole transaction, so the Bank sees every instruction"), which is
+//! true of Solana and false of this repository: NOTHING HERE SIGNS A REDEMPTION.
```

So this is an ADDED comment. The line numbers place it after the file header.

Looking at BURN's file header in the new tree:
```
//! ⚠️ AND READ "the Bank must alarm on every burn" AS EXACTLY THAT — an alarm,
//! AFTER the fact. `bank/alarm.mjs` now reports a nested vault every pass and an
//! undeclared token account daily, but **no Bank co-signing tool exists in this
//! repository**, so nothing scans before it signs. The pre-signature refusal is a
//! human procedure until one is built. Do not read the co-signature as a control
//! that runs.
```

And then later:
```
//! WHAT THIS CAN AND CANNOT PROVE — stated plainly, because the previous version
//! shipped a burn that LOOKED like a proof:
//!   * CAN prove: ...
//!   * CANNOT prove: completeness. ...
//! ⚠️ WHAT COVERS THAT GAP IS THE TABLE IN SPEC.md, "THE SHIP GATE" section —
//! ONE place, so this can never drift from what actually runs. ...
```

So the BURN file header has the "no co-signing tool exists" claim. And there's a NEW inner section that points at SPEC.md.

So BURN has the same inconsistency: file header restates, inner section points at SPEC.md.

OK both SEAL and BURN have this. Let me file.

Alright, my report is:

FINDINGS:

1. MEDIUM (R4): The file-level headers of SEAL and BURN still claim "no Bank co-signing tool exists in this repository" — this is now wrong because bank/cosign.mjs exists. The rule says to point at SPEC.md rather than restate. The fix was applied at some sites (Config.reserve_mints in SEAL, "WHAT CANNOT PROVE" section in BURN) but not at the file headers.

2. LOW (R4): The comments in SEAL's `open_for_redemption` and BURN's `burn_vault` claim that `load_instruction_at_checked` sees TOP-LEVEL instructions only and that inner instructions are invisible. The code uses `load_instruction_at_checked(i)` which reads the i-th instruction in the sysvar (which includes inner instructions). The comment is misleading. Security holds because bank must sign burn_vault and can't sign via CPI.

3. LOW (R1): The cosign tool's shape check verifies addresses and order but doesn't verify that owner and bank signatures are actually present on the transaction. A transaction missing owner signature would be blessed by the cosign, then fail on-chain. UX problem, not security.

4. LOW (R1): The cosign tool reads the Bank pubkey from SEAL's config but doesn't cross-verify against BURN's config. If they differ (admin error), the burn fails on-chain with WiringDiverged. The cosign misses this check.

5. Process recommendation: The project should consider adding public bug bounty programs, extensive mainnet shadow-mode testing, and a clear pause mechanism that can be triggered by any concerning behavior.

OK let me write this up.

Actually let me revisit finding 1 one more time. The author writes in the SPEC:

| control | what it catches | when |
|---|---|---|
| **`bank/cosign.mjs`** — the Bank's co-signer | the whole redemption, BEFORE a signature: ... | **pre-signature** |

So SPEC treats cosign.mjs as a real control. The file headers in SEAL and BURN claim it doesn't exist.

The rule is: comments should point at SPEC.md, not restate. The file headers restate (incorrectly).

This is a clear violation of the rule. MEDIUM.

OK finding 1 is solid.

Alright, let me write the report.

Hmm one more thing. Let me check the new selftest's count vs FLOOR.

```
const FLOOR = 275
```

If I count the assertions in selftest.mjs... it's a lot. The author says 275. Let me trust that.

If a test is deleted, count drops, FLOOR catches. ✓

If a test is modified to always pass, count stays, FLOOR doesn't catch. But that's not the floor's