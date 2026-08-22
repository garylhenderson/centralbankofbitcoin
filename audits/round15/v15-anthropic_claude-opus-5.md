# INDEPENDENT SECURITY AUDIT — ROUND 15

Scope: `e16c5e2..2f84b40`, with emphasis on `bank/cosign.mjs`, `bank/lock.mjs`, the round-14 repairs, and comment/control drift. I have tried to make every claim falsifiable and to state the observation that would confirm or refute it.

---

# R1 — `bank/cosign.mjs`

## R1-1 — CRITICAL: `Transaction.from()` **cannot parse a v0 transaction**, so `cosign.mjs` refuses versioned transactions — but the failure is a bare exception, not a documented refusal, and the tool's stated guarantee ("it sees the whole transaction") silently excludes the only transaction format that can carry an address lookup table

**Exact construct.** `inspect()`:

```js
const tx = Transaction.from(Buffer.from(b64, 'base64'))
```

`Transaction.from` (legacy) reads `numRequiredSignatures` at the first byte of the message. For a v0 message the first byte is `0x80 | 0` = `128`. Legacy `Message.from` will read 128 required signatures, then try to slice 128×64 = 8192 signature bytes out of a ~1200-byte buffer, and throw something like `RangeError`/`Reached end of buffer unexpectedly` — or, worse, on some web3.js versions produce a *garbage* Message with nonsense account keys and header, because the legacy decoder does not validate the version bit.

Two consequences, and the second is the dangerous one:

1. **Benign case:** it throws, `main()` catches, prints `FATAL <message>`, exits 9. Fine — a refusal.
2. **Non-benign case:** the decode does *not* throw and yields a Message whose `instructions` list is not the real instruction list. `tx.instructions` is then a fabrication, `judgeRedemptionTx` judges a fabrication, `shape.ok` can be true, `scanPda` runs on a fabricated asset, and **`tx.partialSign(bank)` signs the ORIGINAL bytes** — because `partialSign` re-serializes `tx.compileMessage()` from the *decoded* structure, which is where it gets subtle: if the decode is lossy, `compileMessage()` produces a *different* message than the one the customer sent, so the signature does not verify against the customer's transaction. That is a denial of service, not a theft. But if the decode is *faithful for the account list and lossy only in how instructions are grouped* (which is exactly what a mis-parsed version byte does — it shifts the compiled-instruction section), you get a case where the Bank signs bytes it did not audit.

**Why this matters even in the benign reading.** The header says:

> `⚠️ THIS FILE EXISTS BECAUSE EVERY OTHER FILE CLAIMED IT ALREADY DID.`
> "it refuses everything it can see"

and SPEC's control table says the co-signer catches "the whole redemption, BEFORE a signature". Neither states that **only legacy transactions are accepted**. That is a real gap in the argument, because SPEC *also* says (in the reserve-mint section) that a fourth reserve mint "requires a versioned transaction with an address lookup table". So the project has documented a future in which redemptions are v0, and has built a co-signer that cannot read v0 at all. The very thing that would make the co-signer most necessary (an ALT hiding accounts behind a table index) is the thing it structurally cannot inspect.

**Evidence that would exist if I am right.**
```
node bank/cosign.mjs --tx "$(base64 -w0 <v0-serialized-tx>)"
```
Expect either `FATAL ...` (exit 9) or — worse — a printed `redemption: asset <nonsense>`. Construct the v0 tx with `new VersionedTransaction(new TransactionMessage({...}).compileToV0Message([lookupTable]))`. Also assert, in `selftest.mjs`, that a v0 byte string is **explicitly rejected with a named reason**, not by exception.

**Fix.**
```js
const first = Buffer.from(b64,'base64')[0]
if (first & 0x80) throw new Error(
  `this is a VERSIONED (v${first & 0x7f}) transaction. This tool judges LEGACY transactions only: `
  + `an address lookup table can hide accounts behind a table index, and nothing here resolves tables. REFUSING.`)
```
And add the corresponding assertion. If you ever need v0, the resolution must be: fetch every `addressTableLookups` table, materialise the full account list, and *then* judge — and refuse if any table cannot be fetched.

---

## R1-2 — CRITICAL: the tool does not check **the fee payer, the signer set, or the writable set**. A redeeming customer can make the Bank the fee payer, or add a second signature requirement, and get it blessed

**Exact construct.** `inspect()` maps only `programId`, `accounts` (pubkeys) and `data`. It drops `isSigner` and `isWritable` entirely, and never looks at `tx.feePayer`, `tx.signatures`, or the compiled header.

What a customer can add to a well-formed redemption that this tool blesses (exhaustive, for legacy txs):

| Addition | Blessed? | Consequence |
|---|---|---|
| **`tx.feePayer = bank`** | **YES** | The Bank pays the fee for every redemption. Small per tx (~5k lamports), unbounded in aggregate, and a griefer can spam refused-but-signed transactions… except they can't, because the Bank only signs clean ones. Still: the Bank is drained at 5,000 lamports × N redemptions with zero consent, and `partialSign` will happily sign as fee payer. |
| **`{pubkey: bank, isSigner: true, isWritable: true}` in an arbitrary instruction to a THIRD program** | **YES** | This is the real one. A signature authorises every instruction. Add `SystemProgram.transfer({fromPubkey: bank, toPubkey: attacker, lamports: <bank's whole balance>})`. `judgeRedemptionTx` iterates instructions and only complains if `programId === sealProgram || burnProgram`. The System program is neither. **The Bank's entire SOL balance is stolen by a transaction this tool calls `clean`.** |
| Any SPL `transfer`/`approve`/`closeAccount` naming the Bank as authority | **YES** | Any token the Bank holds is stolen. Same mechanism. |
| `BPFLoaderUpgradeable` `SetAuthority`/`Upgrade` if the Bank key is ever an upgrade authority | **YES** | Program takeover. |
| A `Memo` / `ComputeBudget` instruction | YES, harmless | Fine. |
| An extra instruction to SEAL/BURN | NO — refused | Correct. |
| A second `open`/`burn` pair | NO — refused | Correct (see R1-6). |
| Instructions to MINT (`sweep_sol_for_swap`, `update_wiring`, `mint_vault`) | **YES** | `mint_vault` requires the Bank as a signer. A redeeming customer can bundle a **mint** into their redemption and get it co-signed for free. Under the charter round (`price_lamports = 0`, legal by design) that is a free vault. Under any round it bypasses the two written Bank duties (refuse a mint during an open proposal; refuse an unbacked charter mint) — which SPEC calls the *entire control* on those. |
| Instructions to GOV | **YES** | Nothing in GOV needs the Bank, so lower severity — but `create_proposal`/`cast_vote` bundled here are still things the Bank has signed without being asked. |

The `mint_vault` case is worth restating because it is the same class of defect this whole project keeps finding: **`revenue.mjs` learned this lesson and `cosign.mjs` did not.** `revenue.mjs` inspects the Jupiter transaction before signing:

```js
const signers = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures)
if (signers.length !== 1 || !signers[0].equals(operator.publicKey)) throw ...
const FORBIDDEN = ['BPFLoaderUpgradeab1e...', MINT_PROG.toBase58()]
```

That is a **denylist of programs and a signer-set check**, in a file written rounds ago, guarding a key that holds transient funds. `cosign.mjs` — guarding the key that co-signs the one irreversible instruction in the system — has neither. One of two sites, again, and this time the site that was skipped is the more valuable key.

**Evidence that would exist if I am right.** Build:
```js
const tx = new Transaction()
  .add(ixOpen(V, alice, bank))
  .add(...sweepIxs)
  .add(ixBurn(V, alice, bank, decl))
  .add(SystemProgram.transfer({fromPubkey: bank.publicKey, toPubkey: attacker, lamports: 1_000_000_000}))
tx.feePayer = alice.publicKey
tx.recentBlockhash = '...'
node bank/cosign.mjs --tx <base64> --live
```
Expected output today: `every holding this scan can see is declared in the burn.` then `SIGNED.` Then submit it and watch 1 SOL leave the Bank. This is a two-minute test and it should be in `selftest.mjs` as a pure assertion on `judgeRedemptionTx`.

**Fix (all three parts; a partial fix here is worse than none because it reads as covered).**

```js
// in judgeRedemptionTx, add cfg.allowedPrograms and cfg.feePayer, and:

// 1. THE PROGRAM ALLOWLIST. A DENYLIST IS THE WRONG SHAPE: the set of programs
//    that can move the Bank's money is not enumerable. Only these may appear.
const ALLOWED = new Set([cfg.sealProgram, cfg.burnProgram, cfg.coreProgram,
  cfg.tokenProgram, cfg.token22Program, cfg.ataProgram, cfg.systemProgram,
  cfg.computeBudget, cfg.memo])
for (const ix of ixs) {
  if (!ALLOWED.has(ix.programId))
    bad.push(`instruction to UNKNOWN program ${ix.programId}. A Bank signature authorises EVERY instruction in the transaction; this tool will not sign a program it cannot reason about.`)
}

// 2. THE BANK MAY SIGN NOTHING ELSE. This is the check that actually stops theft.
for (const ix of ixs) {
  if (ix === open || ix === burn) continue
  const i = ix.accounts.indexOf(cfg.bank)
  if (i >= 0 && ix.signers?.[i])
    bad.push(`the Bank is a SIGNER on instruction to ${ix.programId} — that is not part of a redemption`)
  if (i >= 0)
    bad.push(`the Bank appears as an account on instruction to ${ix.programId} at index ${i}`)
}

// 3. THE FEE PAYER IS NOT OURS TO BE.
if (cfg.feePayer === cfg.bank)
  bad.push('the Bank is the FEE PAYER. The redeemer pays for their own redemption.')
```

And `inspect()` must carry `isSigner`/`isWritable` per account and `tx.feePayer` into the pure judgement:
```js
const ixs = tx.instructions.map(ix => ({
  programId: ix.programId.toBase58(),
  accounts: ix.keys.map(k => k.pubkey.toBase58()),
  signers:  ix.keys.map(k => k.isSigner),
  writable: ix.keys.map(k => k.isWritable),
  data: [...ix.data],
}))
```

Note also that **SEAL's `open_for_redemption` takes `payer: Signer` at index 4 and BURN's `burn_vault` takes `payer: Signer` at index 5.** The tool does not check who those are. A customer sets both to the Bank and the Bank pays the Core plugin-update rent and the burn's fees. That is inside the *allowed* pair, so even a program allowlist does not catch it — index 4 of `open` and index 5 of `burn` need explicit `!== bank` assertions.

---

## R1-3 — HIGH: `scanPda` mis-reads and discards responses it *does* get back

Four separate defects, in a function whose entire purpose is completeness.

**(a) `readBigUInt64LE(64)` with no length guard — the exact defect `bank/spl.mjs` exists to prevent.**

```js
const amount = account.data.readBigUInt64LE(64).toString()
```

`bank/spl.mjs`'s header is explicit about this:

> "Every one of those did `info.data.readBigUInt64LE(64)` behind nothing but `if (!info)` … a present account with no data throws a RangeError … reachable by a stranger for one lamport."

`readTokenAccount` was written to fix exactly this, is imported by `alarm.mjs`, and **`cosign.mjs` does not import it.** In practice `getTokenAccountsByOwner` will only return accounts the token program owns, so a 0-data account should not appear — but `account.data` from `getTokenAccountsByOwner` without `encoding: 'jsonParsed'` comes back as a `Buffer` only in some web3.js versions and as `{data: [base64, 'base64']}` in others. If it is the latter, `account.data.readBigUInt64LE` is `undefined` and this **throws TypeError**, which means the co-signer refuses everything, forever, which is the safe direction — but it means the tool has never been run. Which is consistent with there being **no test of `scanPda` anywhere**.

**(b) `if (amount !== '0') owned.push(...)` — a ZERO-balance account is DISCARDED, and `detectUndeclaredTokenAccounts` deliberately does the opposite.**

The selftest for the sibling detector asserts:

```js
t('an undeclared account with a ZERO balance still fires (it is still destroyed)',
  D.detectUndeclaredTokenAccounts(ASSET, [ATA_OK], [{ address: ATA_BAD, amount: 0n }]).length, 1)
```

So the project has already decided, in an assertion, that a zero-balance undeclared account is a finding — because the *account* is destroyed (its rent, ~2039 lamports of customer money, and its identity) even at zero balance. `scanPda` throws that case away. Two detectors that should agree, disagreeing — the class this repository names as its own most repeated defect, appearing again in the newest file.

Worse: a zero-balance account **can be non-empty by the time the transaction lands**. Between the scan and execution, someone funds an existing zero-balance ATA the tool decided not to mention. That is not the airdrop race (which is about *new* accounts); it is the tool actively discarding an account it saw, that it knows exists, that it knows the burn will destroy. The airdrop race is unfixable; **this is one character.**

**(c) `it.burnt` is the only DAS field consulted.** DAS returns `compression`, `interface`, `ownership.owner`, `ownership.ownership_model`. A **compressed NFT (cNFT)** owned by the PDA has `compression.compressed: true`; it is not a Core asset, its ownership lives in a merkle tree, and it is *not* destroyed by a Core BurnV1 of the host — but it *is* unreachable, because moving a cNFT requires the owner's signature and the owner is a dead PDA. The tool will list it as `kind: 'asset'` and demand it be declared in the burn, which **BURN cannot accept** (`declared` accounts must be either token accounts or Core-owned; a cNFT has no account at all — its `it.id` is a derived asset ID that does not exist as an account). So a PDA holding a cNFT is **permanently unredeemable through this tool**: coverage will never pass, and there is no way to satisfy it. That is a soft-brick with no error message explaining it.

Same for a **Token-2022 NFT** or any DAS-indexed asset that is not a Core AssetV1: the tool demands declaration, BURN's `remaining_accounts` loop skips non-Core non-token accounts (`if (acc.lamports() == 0) continue; if (acc.owner != TOKEN && != TOKEN22) continue`), so declaring it passes BURN — but then the tool has forced the customer to add accounts to a 1119-byte transaction with 113 bytes of headroom, and at 32 bytes per account it takes **four** such assets to make the redemption unserializable.

**(d) The mint is not read.** `owned` carries `{address, amount, kind}` and no `mint`. `judgeRedemptionCoverage` matches on `address` only. Since `declared` is a list of *addresses* that BURN derives as canonical ATAs, this works — but it means the tool cannot tell a **reserve** ATA from a junk-token ATA, so it cannot say anything useful to the operator about *what* is in the vault, and cannot warn that the declared list is missing a *reserve* mint (which BURN would refuse anyway) versus containing junk (which BURN allows only if empty).

**Evidence.** For (b): create a PDA-owned ATA, drain it to zero, leave it open, run `cosign.mjs`. Today it prints `holds N thing(s)` with the zero account absent, and `clean`. Then run `alarm.mjs --reconcile` and watch `detectUndeclaredTokenAccounts` fire CRITICAL on the same account. Two instruments, opposite verdicts, same slot.

**Fix.**
```js
import { readTokenAccount } from './spl.mjs'
...
for (const { pubkey, account } of r.value) {
  const t = readTokenAccount(account)
  if (t.state !== 'ok') {          // present but not readable is a REFUSAL, not a skip
    throw new Error(`token account ${pubkey.toBase58()} owned by this PDA is ${t.state} — refusing to judge`)
  }
  // ZERO BALANCE STILL COUNTS. The account itself is destroyed with the vault,
  // and it can be funded between this scan and execution.
  owned.push({ address: pubkey.toBase58(), amount: t.amount.toString(), kind: 'token' })
}
...
for (const it of (j.result?.items || [])) {
  if (it.burnt) continue
  if (it.compression?.compressed)
    throw new Error(`this PDA owns COMPRESSED asset ${it.id}. It cannot be declared in a burn (no account exists) `
      + `and it cannot be moved after the burn. This vault cannot be redeemed until it is transferred out.`)
  owned.push({ address: it.id, kind: 'asset', iface: it.interface })
}
```

---

## R1-4 — MEDIUM: the DAS full-page guard is the wrong guard, and it is not the only way that call fails to answer

```js
if ((j.result?.items || []).length >= 1000) throw new Error('DAS returned a full page...')
```

Right instinct, three problems.

1. **It fires after the loop has already pushed all 1000 items.** Cosmetic — the throw aborts — but it means the guard is written as an afterthought rather than a gate. Move it above the loop.
2. **It compares against a hard-coded 1000 rather than the limit it asked for.** If someone lowers `limit` to 100 for cost reasons, the guard becomes unreachable and truncation is silent. Compare against the requested limit, or better, read `j.result.total`.
3. **It is not the only failure.** The call can fail to answer in ways this does not catch:
   - `j.result` is `undefined` because the provider returned `{jsonrpc, id, result: null}` (Helius does this for an un-indexed owner). `(j.result?.items || [])` → `[]` → **the tool concludes the PDA owns no Core assets** and passes coverage. That is a false clean.
   - HTTP 429 / 502 with a **non-JSON body**. `r.json()` throws, `main()` catches, exits 9. Safe.
   - HTTP 200 with `{result: {items: [], total: 0}}` when the indexer is behind. Reads as "owns nothing", passes. This is the same class as `alarm.mjs`'s own rule — *"a read that fails is an ALARM, never a pass"* — violated in the file that most needs it.
   - No `r.ok` check at all.

**Fix.**
```js
if (!r.ok) throw new Error(`DAS getAssetsByOwner HTTP ${r.status} — a read that fails is not an answer`)
if (j.error) throw new Error(...)
if (!j.result || !Array.isArray(j.result.items))
  throw new Error(`DAS returned no items array for ${pda.toBase58()} — cannot tell "owns nothing" from "did not answer"`)
if (j.result.items.length >= LIMIT || (j.result.total ?? 0) > j.result.items.length)
  throw new Error(`DAS paged out (${j.result.items.length} of ${j.result.total}) — refusing to judge a truncated list`)
```
And: **cross-check the two instruments.** `getTokenAccountsByOwner` and DAS are independent. If DAS returns zero items for a PDA that `getTokenAccountsByOwner` says owns three token accounts, DAS is very likely behind, because DAS also indexes fungible token accounts under `getAssetsByOwner` on Helius. A disagreement between the two is a reason to refuse.

---

## R1-5 — HIGH: the co-signer never checks the vault's **collection**, the vault's **owner on chain**, or the SEAL config's **collection** — so it will happily co-sign a redemption of a foreign asset

`judgeRedemptionTx` reads `open.accounts[0]` (asset), `[2]` (owner), `[3]` (bank). It never checks `open.accounts[1]` — the collection — against `SEAL.config.collection`, which `inspect()` has already loaded and could read at offset 41 with the same pinned buffer.

On-chain SEAL and BURN both check `ForeignVault`, so a foreign asset's redemption *reverts*. So this is not a theft. But:

- The tool computes `pda` from the caller-supplied asset and does a live scan on it. A customer names an asset outside the collection, the scan finds nothing, the tool prints `clean` and **signs**. The Bank's signature is now on a transaction with an arbitrary asset in it. It reverts on chain, so nothing is lost — *unless* one of the added instructions (R1-2) is the actual payload and the revert is the point of the exercise. A transaction that reverts still consumes the signature? No — a reverted transaction lands and the whole thing reverts. So the exposure is limited. But it means the tool's verdict `clean` does not mean what it says.
- More usefully: **the on-chain owner is never compared to `open.accounts[2]`.** `inspect()` already has a `Connection`; reading the asset account and checking `data[1..33] == owner` and `data[34..66] == config.collection` is two lines and turns "this transaction is shaped like a redemption" into "this is a redemption of one of our vaults by its actual owner". Without it, the tool cannot distinguish a redemption from a transaction that will revert, and the operator cannot use a `clean` verdict as evidence of anything.

**Fix.** In `inspect()`, after computing `shape`:
```js
const assetAcc = await conn.getAccountInfo(new PublicKey(shape.asset), 'confirmed')
if (!assetAcc || !assetAcc.owner.equals(CORE)) throw new Error('the named asset is not a Core asset')
const d2 = assetAcc.data
if (d2[0] !== 1) throw new Error('the named asset is not a live AssetV1')
const onChainOwner = new PublicKey(d2.subarray(1,33)).toBase58()
const onChainColl  = new PublicKey(d2.subarray(34,66)).toBase58()
if (onChainOwner !== shape.owner) throw new Error(`the transaction names ${shape.owner} as owner; the chain says ${onChainOwner}`)
if (onChainColl !== collectionFromSealConfig) throw new Error('this asset is NOT in the CBOB collection')
```

---

## R1-6 — LOW/MEDIUM: refusing two redemptions in one transaction is *defensible* but the stated reason is wrong, and it breaks something the project has measured as legitimate

The comment says the programs permit two "and that is correct on-chain — but … a transaction carrying two redemptions doubles what has to be true at once for no benefit to anyone."

"No benefit to anyone" is false. SEAL's own header names the benefit:

> "Two redemptions may share a transaction (open A, sweep A, burn A, open B, sweep B, burn B)"

and the measured ceiling is **831 bytes for a one-mint redemption**. Two one-reserve-mint redemptions fit in 1232 comfortably. A holder with two vaults saves a transaction, a blockhash round-trip, and — materially — halves the window in which a partial failure leaves them mid-redemption. The refusal costs them nothing much, so I would not call it a defect on its own.

What *is* a defect: **the refusal is not written down anywhere a client author will read it.** SPEC's control table says the co-signer catches "the pair" — it does not say "exactly one pair". A client built against SEAL's documented behaviour (two redemptions per tx) produces transactions the Bank refuses, with the reason `expected exactly one open_for_redemption and one burn_vault, found 2 and 2`, which reads like a bug in the client. Put it in SPEC, next to the ATA-creation requirement, as an operational constraint of the co-signer.

Also: the early `return` on this branch means **no other reason is ever collected**. A transaction with two pairs *and* a stolen-SOL instruction reports only "found 2 and 2". Losing the more serious reason is the wrong order of priority for an operator reading a refusal.

---

## R1-7 — MEDIUM: `BURN_FIXED_ACCOUNTS = 11` fails **OPEN**, not closed, and the comment claims the opposite

The comment:

> "⚠️ If BURN's account list changes, this changes with it — and SEAL's forward match would break first, which fails closed. Asserted against the suite's own builder in 3.1c-3.1f."

Two false statements.

**(1) 3.1c–3.1f assert nothing about this constant.** They read `BURN_IX_ASSET_IDX`, `BURN_IX_OWNER_IDX`, `SEAL_IX_ASSET_IDX`, `SEAL_IX_OWNER_IDX` out of the Rust source. There is **no assertion anywhere** that BURN's `BurnVault` struct has exactly 11 fixed accounts, and no assertion tying `bank/cosign.mjs`'s `11` to anything. Grep the suite for `BURN_FIXED_ACCOUNTS` — you will find zero hits. This is a comment naming a control that does not run: **the exact class R4 exists to catch, in the newest file, in the commit written to remove that class.** I count this as the most on-brand finding in the round.

**(2) The drift fails OPEN.** Suppose a future BURN gains a 12th fixed account (say, a `rent` sysvar) appended *after* `system_program` and before `remaining_accounts`. Then:
- SEAL's forward match still works: it binds account **0** (asset) and **2** (owner), which did not move. `IX_BURN_VAULT_DISC` is derived from the *name*, which did not change. **SEAL does not break.** The comment's claim that "SEAL's forward match would break first" is wrong — SEAL binds only two low indices precisely so it *doesn't* break on account-list changes.
- BURN's own `require!(ctx.remaining_accounts.len() == declared as usize)` still passes, because the runtime splits fixed vs remaining by the struct, not by an index constant.
- But `cosign.mjs` computes `declared = burn.accounts.slice(11)`, which now includes the new 12th fixed account. So `declared.length` is one greater than `stated`, and **`judgeRedemptionTx` refuses every redemption** with `burn_vault states 4 declared accounts but carries 5`.

That is fail-closed in the *availability* direction (redemptions halt), which is survivable. Now the other direction: suppose an account is **removed** (or the order changes so that `remaining_accounts` starts at index 10). Then `slice(11)` **drops the first declared account**. `stated` is 4, `declared.length` is 3 → mismatch → refuse. Also fail-closed.

The genuinely open case: an account is **inserted at index 0, 1, 2 or 3**. Then `asset`, `owner` and `bank` are read from the wrong positions in the *burn* instruction — `burn.accounts[0]` is no longer the asset. The comparison `burn.accounts[0] !== asset` then fails and the tool refuses. Still closed. Good.

The actually-open case: **`stated` is read as `burn.data[8]`, a single byte, and `declared` count is a `u8`.** If BURN's `burn_vault` ever gains a second argument before `declared`, or `declared` widens, `burn.data[8]` reads a different field and can coincidentally equal `declared.length` — at which point the count check silently passes and the tool's only structural check on the declared list is gone. Low probability; worth an assertion.

**Fix.** Add a real assertion, in `tests/3prog.test.ts`, that the constant matches the struct:
```ts
// count the fields of BurnVault<'info> in the source and pin it
const burnFixed = (BURN_SRC.match(/pub struct BurnVault<'info> \{([\s\S]*?)\n\}/)![1]
  .match(/^\s*pub \w+:/gm) || []).length
rec('3.1g','BURN_FIXED_ACCOUNTS in bank/cosign.mjs equals BurnVault\'s field count',
  String(burnFixed), (readFileSync('bank/cosign.mjs','utf8').match(/BURN_FIXED_ACCOUNTS = (\d+)/)||[])[1] ?? 'NOT FOUND')
```
And **delete the false claim** from the comment, replacing it with what is true: *"nothing asserts this today; if BURN's account list changes this constant must change with it, and the failure mode is that every redemption is refused."*

---

## R1-8 — MEDIUM: `cosign.mjs` reads the Bank from SEAL; BURN keeps its own copy. They can disagree, and the tool cannot see it

`inspect()` reads `bank` from SEAL's `Config` at offset 73 and checks *both* `open.accounts[3]` and `burn.accounts[3]` against that single value. BURN has its own `BurnConfig.bank` at offset 73 of its own account.

Can they disagree? **Yes, for up to seven days plus however long nobody calls `apply_pending`.** Both SEAL and BURN have independent `pending_bank` / `apply_pending`. `apply_pending` is permissionless in both. So the sequence:

1. Admin arms a Bank rotation in SEAL and in BURN, same moment, same target.
2. Seven days pass.
3. Someone calls SEAL's `apply_pending`. SEAL's `bank` is now the new key.
4. Nobody calls BURN's `apply_pending`. BURN's `bank` is still the old key.

Now: `cosign.mjs` compares both instruction's account 3 against **SEAL's** bank. A redemption naming the new bank in both halves passes the tool, the Bank signs with the new key — and **BURN reverts with `NotTheBank`**. Redemptions are dead until someone notices. The tool's verdict was `clean` and the transaction cannot land.

Worse in the other order: BURN applied, SEAL not. A redemption naming the *old* bank passes the tool (SEAL still says old), old key signs, SEAL accepts, **BURN reverts**. Same halt.

Note that BURN *does* cross-check `SEAL.config.bank == BurnConfig.bank` at burn time (`WiringDiverged`), so the on-chain failure is loud and named. But the tool's `clean` verdict does not reflect it, and the `--live` path will put the Bank's key on a transaction that cannot execute.

Also: `alarm.mjs` watches `seal.bank`, `burn.bank` and `mint.bank` for drift *individually*. It does **not** compare them to each other. `detectStandingRisks` has `collections_disagree` for the four collections and no equivalent `banks_disagree`. Given that BURN's on-chain check makes divergence fatal to redemption, and given that the whole point of the collection check was "three programs each holding their own copy can silently diverge", this is the same finding one field over.

**Evidence.** Query the three config accounts on a deployed system mid-rotation; `seal.bank !== burn.bank`. In the alarm's report: two separate `config_drift` findings, no finding saying they now disagree.

**Fix.**
- `cosign.mjs`: read BURN's config too, and require `sealBank === burnBank === open[3] === burn[3]`.
- `detectors.mjs`: add to `detectStandingRisks`, mirroring `collections_disagree`:
```js
export const BANK_KEYS = ['seal.bank', 'burn.bank', 'mint.bank']
const banks = BANK_KEYS.map(k => [k, cur[k]]).filter(([,v]) => v && v !== DEFAULT_PUBKEY)
if (banks.length > 1 && new Set(banks.map(([,v]) => v)).size > 1) {
  out.push({ kind: 'banks_disagree', severity: S.CRITICAL,
    detail: `SEAL and BURN name different Banks: ${banks.map(([k,v])=>`${k}=${v}`).join(', ')}. `
      + `BURN refuses on WiringDiverged, so EVERY REDEMPTION IS HALTED until apply_pending is called on both.` })
}
```
and put `BANK_KEYS` in `WATCHED_KEYS` the way `COLLECTION_KEYS` is, so the check and the watch cannot drift.

---

## R1-9 — MEDIUM: what the selftest's 20 assertions do **not** cover

Enumerating, since the prompt asks:

- **Nothing about the fee payer, signer sets, writable sets, or foreign programs.** (R1-2 — the biggest hole.)
- **Nothing about `scanPda`.** Zero assertions. It is I/O, but its *parsing* (the `readBigUInt64LE`, the zero-filter, the `burnt` filter, the page guard) is pure logic living in an I/O function and is therefore untested by construction. Extract it: `parseOwnedFromScan(tokenAccounts, dasItems) -> owned[]` and test both directions.
- **Nothing about `BURN_FIXED_ACCOUNTS`** against BURN's real struct (R1-7).
- **Nothing about the v0 case** (R1-1).
- **Nothing about `disc()`** — the discriminators are computed at runtime from names, never asserted against SEAL's `IX_BURN_VAULT_DISC` / BURN's `IX_OPEN_FOR_REDEMPTION_DISC`. If someone renames an instruction, `cosign.mjs` computes the new discriminator and the *programs* still carry the old constants: the tool would bless a transaction the programs refuse. A one-line assertion fixes it.
- **Nothing about `pinnedAccountData`'s failure path here.** `inspect()` throws if SEAL's layout moved; no test that this produces a *refusal* rather than a crash that an operator might retry past.
- **`mkOpen` has 10 accounts and `mkBurn` has 11 + declared** — both hard-coded in the *test*, so the test cannot catch the constant drifting. The test's account lists must be derived from the same place the tool's constant is, or from the source.
- The assertion `t('an UNDECLARED nested Core asset is refused', cov(...)[ 'ok' ], false)` uses bracket access with stray spaces — works, but it is a tell that this block was written fast. `cov([...], ['ata1'])['ok']` — fine.
- **`t('a well-formed redemption is ACCEPTED', j([mkOpen(), 'sweep', mkBurn()].filter(x => x !== 'sweep')).ok, true)`** — the `.filter` removes the string, so this is identical to `j([mkOpen(), mkBurn()])`. The test *looks* like it proves a sweep instruction between the pair is tolerated, and proves nothing of the kind. **There is no assertion that an intervening Core `ExecuteV1` is accepted.** Given that every real redemption has one, that is the single most important positive case and it is absent. Replace the string with a real third instruction to `CORE`.

---

# R2 — `bank/lock.mjs`

## R2-1 — the new break IS exclusive for two racers. It is **NOT** exclusive for three.

Let me write it out, because this is the question asked.

**Two racers, A and B, one stale dead lock with token `S`.**

Both read `S`. Both pass freshness and liveness. Both reach `_beforeSteal`. Then:

- A: `rename(file, file.breaking.tA)` → succeeds. `file` no longer exists.
- B: `rename(file, file.breaking.tB)` → **ENOENT** → `return {ok:false, lostRace:true}`. B is out.
- A: reads `file.breaking.tA`, token is `S`, matches `held.token`. Proceeds.
- A: `claim(file, payload)` → `link()` succeeds (nothing there). A holds. Unlinks the temp.

Exactly one winner. **Correct.** The `rename` primitive does what the comment claims for N=2.

**Three racers, A, B, C.** Same start.

- A: renames to `.breaking.tA` → OK.
- A: token matches → `claim(file, A)` → **A HOLDS**, fresh lock with token `tA`.
- B: renames `file` → **succeeds**, because A's *fresh* lock is now sitting at `file`. B gets `.breaking.tB` containing `{token: tA}`.
- B: `takenToken (tA) !== held.token (S)` → **restore path.** Reads bytes, `openSync(file, 'wx')` → succeeds (file is gone, B removed it) → writes A's lock back → unlinks `.breaking.tB` → returns `lostRace`. B is out. **`file` now contains A's lock again.**
- C: renames `file` → succeeds → gets A's lock → mismatch → restore → `wx` succeeds → A's lock back. C out.

Still exactly one holder. **Also correct**, and this is the case the round-14 auditors said was broken. The restore path genuinely closes it.

**Now the interleaving that is NOT closed.** The restore is `read → open(wx) → write → close`, which is **three** operations, and between B's `rename` and B's `wx`, `file` **does not exist**. So:

- A holds (token `tA` at `file`).
- B renames it away. **`file` is now absent.** A still believes it holds the lock — nothing told A otherwise.
- **D arrives** (a fourth process, or the cron firing). D calls `acquireLock`. `claim()` runs `link(tmp, file)` → **succeeds**, because `file` is absent. **D HOLDS.** D starts paying.
- B now does its restore: `openSync(file, 'wx')` → **EEXIST** (D is there) → swallowed by `catch { /* somebody already holds it; theirs stands */ }`. B unlinks its temp, returns `lostRace`.

**Final state: `file` contains D's lock. A's lock is GONE. A and D are both running.** A's `withLock` finally will call `releaseLock(file, tA)`, read D's lock, see `held.token !== tA`, return false, and print `WARNING: did NOT release`. Correct behaviour — but by then both have paid.

This is the **same double-payment the file exists to prevent**, one indirection out. The window is small — a `readFileSync` of ~120 bytes plus an `openSync`, so microseconds — but that is precisely the width of the window the previous version admitted to and this version claims to have closed. The header says:

> "ROUND 14 CLOSED THE TOCTOU THIS PARAGRAPH USED TO ADMIT."

**It did not close it. It moved it from the break path to the restore path, and narrowed it.** That is a real improvement and it should be described as one. Claiming closure is the defect.

Severity: **HIGH**. It requires a 3-process interleaving with a specific timing, which is unlikely under `23,53 * * * *` cron + occasional manual run — but "unlikely" is what the round-11 and round-12 versions were too, and both were found and both were real. And the consequence is a duplicate payout of the day's cbBTC.

**Additional problems on the restore path:**

**(a) The restored lock has the *original holder's* `at` timestamp.** B writes back A's bytes verbatim, including `at`. Correct — A's lock should keep A's start time. Fine.

**(b) But if the restore fails and D took the lock, nothing is reported.** `catch { /* somebody already holds it; theirs stands */ }` — B silently accepts that it just destroyed A's lock. The one case that matters is invisible. This is the `broke: null` shape from round 12: *"the one break that is definitely unsafe was the one break that happened in silence."* Same defect, new location.

**(c) `_afterUnlink?.()` now fires between the rename and the token read**, not between the unlink and the claim as its own comment describes. Its docstring:

> "The lost-race branch below is only reachable when a SECOND process creates the lock between our unlink and our O_EXCL create"

There is no unlink any more. The seam now fires between the rename and the *ownership check*, so a test that writes a lock in `_afterUnlink` (as `selftest.mjs` line ~"a runner that loses the create race" does) is testing a different thing than the comment says. The test still passes because `claim` fails on EEXIST, but the comment describing the seam is now wrong.

**(d) `${file}.breaking.${token}` — a crash between rename and unlink leaves the lock's only copy in `.breaking.<uuid>` and `file` absent, forever.** The next runner sees no lock, claims freely, and the *previous* run's state — which the lock existed to serialise against — is not consulted. There is nothing that cleans up `.breaking.*`. The selftest's assertion for this is:

```js
t('the steal leaves no temp file behind',
  fsx.readdirSync(fsx.existsSync(L) ? '.' : '.').filter(x => x.includes('.breaking.')).length, 0)
```

`fsx.existsSync(L) ? '.' : '.'` — **both branches are `'.'`**. The ternary is dead code, and the test lists the **current working directory**, while `L` is `${TMPDIR}/.cbob-selftest-<pid>.lock` so the temp files are in `/tmp`. **This assertion reads a directory that never contains the files it is looking for. It cannot fail.** It is a gate that flatters itself, in the commit written to fix a gate that flattered itself (9.14). That is the third instance of this class in this diff.

**Fix for the assertion:**
```js
t('the steal leaves no temp file behind',
  fsx.readdirSync(require('path').dirname(L)).filter(x => x.startsWith(require('path').basename(L) + '.breaking.')).length, 0)
```

**Fix for the restore window.** The restore cannot be made atomic with three syscalls. Two options:

1. **`link` instead of `open(wx)`** — restore by `linkSync(stolen, file)`, which is a single atomic syscall that fails EEXIST. Same exclusivity as `claim`. Then unlink `stolen`. This removes the read-and-rewrite entirely and shortens the window to one syscall — but the window between `rename` and `link` still exists.
2. **Do not rename at all when you might not own it.** Restructure so the break is `rename` → **check** → and if it is not ours, **`rename` it straight back** — no, that clobbers. The honest answer is the one the header already names:

> "The durable answer is a lock nobody has to break — an OS lease on an open fd"

`flock(2)` on an open fd, via a tiny native addon or `child_process.execFileSync('flock', ['-n', fd, ...])`. Node has no built-in `flock`, but `flock(1)` is in util-linux and on this box already (`fuser` is used elsewhere). A wrapper script that holds the flock for the lifetime of the child is ~5 lines and is *actually* exclusive with no break path at all, because the kernel releases it when the process dies. **That removes the entire stale-break mechanism**, which removes every one of these findings, rounds 11 through 15.

**Recommendation: stop iterating on this file and do the flock.** Five rounds of narrowing a window that the kernel would eliminate is the highest-cost, lowest-value work in this repository.

---

## R2-2 — MEDIUM: `withLock`'s `finally` cannot distinguish "I was robbed" from "I already released"

```js
finally {
  if (!releaseLock(file, l.token)) {
    console.error(`WARNING: did NOT release ${file} ...`)
  }
}
```

`releaseLock` returns `true` on ENOENT:
```js
catch (e) { return e.code === 'ENOENT' }
```
So a lock that has been **stolen and then released by the thief** (file absent) reports success. The one case the warning exists for — "another runner holds it now; this run may have been running beside it" — is reported only if the thief is *still* holding. If the thief finished first, this run sees ENOENT and reports a clean release.

Given R2-1, that is the *likely* ordering: D takes the lock, D is a short run, D releases, A finishes and sees ENOENT, prints nothing. **The double payment happens and the log is clean.**

**Fix.** `releaseLock` should distinguish:
```js
export function releaseLock(file, token) {
  let held = null
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (e) { return e.code === 'ENOENT' ? 'vanished' : 'unreadable' }
  if (!token || held?.token !== token) return 'stolen'
  try { fs.unlinkSync(file) } catch {}
  return 'released'
}
```
and `withLock` must treat `'vanished'` and `'stolen'` as **loud**, not silent — and, given that both mean another runner may have been alongside, should notify. This is a money job; a silent "my lock vanished" is the signal that a duplicate payment just happened.

---

## R2-3 — MEDIUM: `writeLedger` writes the marker before the rename, and the marker is *outside* the lock

```js
if (marker && !fs.existsSync(marker)) fs.writeFileSync(marker, ...)
fs.renameSync(tmp, file)
```

The comment argues correctly that marker-first is safer. But note what it costs: **a crash between marker-write and rename leaves a marker with no ledger.** `readLedger` then throws forever until a human deletes the marker. For `distributions.json` on day one that is an outage on the first run; the comment acknowledges this ("costs a human one deliberate `rm`"). Accept.

The real issue: **`readLedger`/`writeLedger` are not inside the lock in every caller.** `alarm.mjs`:
```js
const readState = () => readLedger(STATE_FILE, null)
...
withLock(LOCK, main, ...)
```
`main()` calls `readState()` and `writeState()` inside the lock. Good. But `reconcile()` runs under `LOCK + '.reconcile'` — **a different lock** — and calls `readAcks()` and `report()`. It does not touch state.json. Good.

`distribute.mjs` and `revenue.mjs` both do `load()` inside `main()` inside `withLock`. Good.

So: no cross-job ledger race today. But the **acks file** is read inside the lock and written by hand, outside any lock, by an operator with an editor. A half-written `acks.json` (editor writing in place) parses as malformed → `parseAcks` returns `{acks:{}, problem}` → logs to stderr → **acks nothing**. Correct direction (fail loud, ack nothing). Fine. Worth documenting that acks.json should be written atomically (write-tmp-and-rename) or the operator will see spurious "present but malformed" lines.

---

## R2-4 — LOW: `pidStart` field index is wrong for the documented field number

```js
/** Linux field 22 of /proc/<pid>/stat is the process START TIME */
return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] || null
```

`/proc/pid/stat` fields are 1-indexed in `proc(5)`. Field 1 is pid, field 2 is comm (in parens), field 3 is state. After `lastIndexOf(')') + 2` you are positioned at field 3. So `split(' ')[0]` is field 3, and `[19]` is field **22**. **The code is correct and the comment is correct.** Withdrawn as a defect — recording it because a reader will second-guess it, and because the comment says "field 22" while the index says 19, which is the kind of thing that gets "fixed" wrongly. Add `// [19] is 0-based from field 3, i.e. field 22` to stop that.

---

# R3 — Round 14's other repairs

## R3-1 — HIGH: `applyAcks` can silence a finding an operator did **not** intend to silence, because the same `kind:asset` key covers findings with different *causes*

`applyAcks` keys on `${f.kind}:${f.asset}`. The comment says this is right because "acknowledging one vault's nesting says nothing about the next vault's, and acknowledging a nesting says nothing about an approve on the same asset."

True as far as it goes. What it misses: **several kinds are not asset-specific in their meaning.** In particular:

- `undeclared_token_account` on asset X. An operator acks it for one known junk airdrop. **A second, different undeclared account appears on the same vault later — same kind, same asset, same key → silently downgraded to INFO with the *old* reason attached.** The detail text will say `ACKNOWLEDGED: gary: the SHIB airdrop, accepted` while describing a new account holding 3 BTC. That is a mute button with a misleading label. `detectUndeclaredTokenAccounts` emits one finding per *account*, so the right key is `kind:asset:address`.
- `nested_vault` on host H: the finding's `asset` is the **inner** vault, so acking is per-inner-vault. Fine.
- `reserve_fell` on asset X: acking it acks **every future fall** on that vault. A vault that fell 1 sat and was acked is now silent when it falls a whole bitcoin. This is the worst one, because `reserve_fell` is the detector for the drain the seal exists to prevent, and it is *in* `REDEMPTION_NOISE` too (see R3-3). Acking `reserve_fell:X` permanently blinds you to X being drained.
- `deactivated`, `vault_unreadable`: same shape.

The comment's own "BLIND TO" says: *"an ack that was true when written and is not any more. That is why it downgrades rather than drops."* Downgrading is not enough here, because the *reason printed* is stale and actively misleads. An operator reading `INFO [reserve_fell] vault X reserve fell 100000000 sats ... ACKNOWLEDGED: gary: dust rounding, accepted` will believe the ack.

**Fix.** Two changes:
1. **Allowlist which kinds may be acked.** Only the three the mechanism was built for: `vault_owns_itself`, `nested_vault`, `unredeemable_owner`. Everything else is a transient condition and must not be ackable at all. Refuse (and report) an ack whose kind is not in the list — an ack for an unackable kind is an operator mistake and should be loud.
2. **Include a value in the key for any kind that can recur with different content.** For `undeclared_token_account`, key on the account address. Better: add an optional `f.ackKey` that each detector supplies, defaulting to `kind:asset`.

Also: `if (!f.asset || !f.kind) return f` means findings with no asset can never be acked — correctly asserted. But `config_drift`, `rotation_armed`, `weak_voting_period` and every standing risk have no `asset`, so they are unackable. That is right for drift. It is *wrong* for `governance_rotation_armed` and `rotation_armed`, which fire **CRITICAL every pass for seven days** by explicit design — "the whole value of the timelock is that somebody looks during the week it is ticking". Seven days × 48 passes = 336 CRITICALs for one intentional rotation. That is exactly the "nag forever" condition `applyAcks` was built for, and it is the one condition it cannot address. Add an ack key for those (`kind:pendingValue`) so an operator can say "yes, I armed this, it lands Tuesday" and still see it under INFO.

**Evidence.** Ack `undeclared_token_account:X` with reason "the SHIB dust". Create a second PDA-owned account on X with 1 BTC. Run `--reconcile`. Expect: one INFO line about the 1 BTC account carrying the SHIB reason. That is a silenced CRITICAL.

---

## R3-2 — MEDIUM: `unredeemable_owner` — false positives are guaranteed the day a marketplace lists a vault, and the finding is unactionable and unackable-per-listing

The detector fires CRITICAL on any off-curve owner. The docstring is honest that a marketplace escrow reads identically and names both readings. Good.

The problem is operational. Every listing on a Core marketplace that escrows (Tensor's Core support, Magic Eden's) produces a CRITICAL per listed vault, per pass, forever, until delisted. At 2,100 vaults with a normal 2–5% listing rate that is **40–100 CRITICALs every thirty minutes**. `applyAcks` can silence each one individually with a written reason — but the operator must write an ack per asset, and **delete it when the vault delists**, or the ack persists and a genuinely sealed vault at that address later reads INFO. There is no expiry on an ack.

Two things make this worse than stated:

1. **The finding's severity is wrong for the common case.** A listed vault is *recoverable* and *normal*. A DAO-held vault is *permanently sealed*. Same kind, same severity, and the detector cannot tell them apart — so the operator learns to ack the kind wholesale, which is how the DAO case gets acked too.
2. **It is distinguishable, cheaply, and the detector does not try.** A marketplace escrow PDA is derived from a *known program*. `PublicKey` cannot tell you which program owns a PDA, but `getAccountInfo(owner)` **can**: an escrow PDA that holds an asset is typically a real account with an `owner` field naming the marketplace program, while a Squads vault PDA is usually a **non-existent account** (Squads vaults hold no data). So:
   - `owner` account does not exist → almost certainly a bare PDA (Squads vault, or a program's signing PDA) → **permanently sealed** → CRITICAL.
   - `owner` account exists and is owned by program P → look P up in a small list of known marketplaces → **listed, recoverable** → HIGH or INFO with the program named.
   
   This is one `getAccountInfo` per off-curve owner, and off-curve owners are rare. It converts a guaranteed alarm-fatigue generator into an accurate one.

**Fix.** Inject an `ownerProgramOf: pubkey -> programId|null` alongside `isOnCurve`, split the finding into `unredeemable_owner` (no account, or an unknown program → CRITICAL) and `vault_escrowed` (a known marketplace → INFO, named). Keep the ambiguity honest for unknown programs.

**False negatives.** The detector is quiet on:
- An **on-curve** address whose key is lost or is a smart-wallet relayer. The docstring for `detectBankIsNotSignable` names this blindness; `detectNestedVaults` does not repeat it. Add it.
- An off-curve owner where `PublicKey.isOnCurve` throws — correctly treated as "not a verdict". But `alarm.mjs` passes `k => PublicKey.isOnCurve(new PublicKey(k).toBytes())` **without a try/catch**, and `new PublicKey('junk')` throws. The detector catches it (`try { ok = isOnCurve(owner) } catch { ok = null }`), so this is handled. Fine.
- The `owners.has(owner)` early-continue skips any vault whose owner is a *vault PDA*, delegating to the nesting arm. Correct, and asserted.

---

## R3-3 — HIGH: `REDEMPTION_NOISE` is too wide. `reserve_fell` and `deactivated` should NOT be in it, and `burn_via_program`'s asset is caller-supplied

Three problems, compounding.

**(a) The correlation key is attacker-controlled.** Carry-over item 5 says `burn_via_program` "does not verify the asset is one of ours". Look at the source:

```js
if (ix.program === burnProgramId) {
  if (burnVaultDiscriminator && !(ix.dataBytes && ...)) continue
  out.push({ kind: 'burn_via_program', severity: S.INFO, asset: ix.accounts?.[0] ?? null, ... })
```

There is **no check that `ix.accounts[0]` is in `assetSet`**, and — crucially — **no check that the instruction SUCCEEDED**. `alarm.mjs` skips transactions with `s.err` (`if (s.err) continue`), so a *failed transaction* does not reach `normalise`. Good. But an instruction that ran inside a transaction that **overall succeeded** while `burn_vault` itself... no, if `burn_vault` reverts the transaction reverts. So the discriminator match on a top-level or inner instruction in a *successful* transaction does mean `burn_vault` executed.

But: does it mean it executed **on that asset**? `ix.accounts[0]` is `vault_asset`, and `burn_vault` requires `asset_owner == owner`, `collection == cfg.collection`, and a preceding paired `open`. So a successful `burn_vault` naming asset A **did** burn A, in our collection. The laundering path is therefore **closed on-chain**, which matches round 14's finding that no laundering could be constructed. I confirm that.

**However** — the finding is generated from *inner* instructions too (`normalise` flattens `innerInstructions`). Can `burn_vault` appear as an inner instruction in a successful transaction without having burned that asset? Only if a program CPI'd into `burn_vault` and it succeeded — in which case it burned. And BURN's `NoPrecedingOpen` uses `load_current_index_checked`, which for a CPI returns the **outer** index, so a CPI'd `burn_vault` needs a genuine top-level `open` before it. So no.

**But there is a path the analysis misses: a transaction that CONTAINS a `burn_vault` for asset A and, separately, a bare Core `BurnV1` for asset B.** Then:
- `detectBurns` emits `burn_via_program` for A (INFO) **and** `bare_core_burn` for B (CRITICAL). `bare_core_burn` is not in `REDEMPTION_NOISE`, so B stays CRITICAL. ✓
- `detectVaultSetChange` next pass emits `vault_burned` for both A and B. `viaProgram` contains only A. B's `vault_burned` stays CRITICAL. ✓

Good. That path is closed and the selftest asserts it (`a bare burn is NOT laundered by an unrelated redemption in the same pass`).

**(b) `reserve_fell` and `deactivated` must NOT be downgraded, and the reason given for including them is wrong.**

The comment says these fire "same lag" — DAS still listing a burned vault with its ATA already closed. Let's check whether that is the *only* way they fire on an asset with a `burn_via_program`.

`detectBalanceDrops` compares `prevBalances[asset]` to `current[asset]`, and **skips when `current[asset] === undefined`**. A burned vault is absent from `live`, so it is not in `balances`, so `reserve_fell` does not fire. It fires only if DAS still lists the burned vault as live — the lag case. So far the comment is right.

But consider: **a vault whose reserve fell AND which was redeemed in the same pass, where the fall was not the redemption.** Under v5 a live vault's reserve cannot legitimately fall (the detector's own docstring says so: "no sanctioned path produces" it). So if the alarm sees `reserve_fell` on asset X *and* `burn_via_program` on X in the same pass, there are two readings:
1. DAS lag: X was redeemed, the ATA closed, DAS is behind. Benign.
2. **X was drained through a delegate planted in a previous thaw, and THEN redeemed** — the drain and the redemption are two separate events, and the redemption laundered the drain into INFO.

Reading 2 requires a surviving delegate, which 3.3 refuses at burn time on an *open* account and 3.3a **explicitly ALLOWS** on a closed one. So: plant a delegate during thaw N, close the ATA in the same redemption... no, the vault is burned by then.

Try again with the actual v5 mechanics: there is no re-seal, so a delegate cannot survive a thaw into the future. The drain-then-redeem sequence needs two thaws and there is only ever one. **So reading 2 is unreachable and the downgrade is safe for `reserve_fell`.** I withdraw the exploit claim.

What survives is a **correctness-of-reasoning** objection: the downgrade is safe because of a property of v5 (one thaw, terminal burn) that the comment does not state. If v6 ever reintroduces any non-terminal thaw, this allowlist becomes a laundering channel and nothing will flag it. Add the dependency to the comment: *"safe ONLY because v5 has exactly one thaw per vault and it is terminal; if a non-terminal thaw is ever reintroduced, reserve_fell and deactivated must leave this list."*

**(c) The real finding here: `vault_left_index` is not in the allowlist, and it should be considered.**

`REDEMPTION_NOISE` covers `vault_burned`, `vault_vanished`, `deactivated`, `reserve_fell`. `vault_left_index` is deliberately excluded, and the selftest asserts it stays CRITICAL even with a `burn_via_program` for the same asset. The reasoning: `vault_left_index` means "gone from the index and *not flagged burnt*", which is the bare-burn signature.

But consider a **genuine redemption where DAS has removed the asset from the live set but not yet marked it burnt.** Is that possible? DAS derives `burnt` from the asset account's `Key::Uninitialized` state. A redeemed vault's account survives (9.12) at `Key::Uninitialized`. If the indexer removes it from `getAssetsByGroup` before setting `burnt: true` — or if it drops it from the collection group entirely because the account no longer decodes as an AssetV1 with a collection — then `vault_left_index` fires on an honest redemption, **at CRITICAL, with a `burn_via_program` sitting right next to it in the same report**, and the message will say "it was burned, moved out of the collection, or the index is wrong."

That is a false CRITICAL on the normal path — the exact thing `correlateBurns` exists to remove. And it is *more* likely than the `vault_burned` case, because "removed from the group" is what an indexer does with an account that no longer parses.

**Fix.** Do not put `vault_left_index` in `REDEMPTION_NOISE` (that would destroy the bare-burn signal). Instead, when `vault_left_index` correlates with a `burn_via_program` for the same asset, **rewrite the detail to name the correlation and keep it at HIGH** — it is still worth a look (the index disagreeing with the chain about burnt-ness is itself news) but it is not the bare-burn CRITICAL:

```js
if (f.kind === 'vault_left_index' && f.asset && viaProgram.has(f.asset)) {
  out.push({ ...f, severity: S.HIGH,
    detail: `vault ${f.asset} left the index and is NOT flagged burnt, but burn_vault ran on it in a `
      + `transaction this pass scanned. This is most likely the indexer dropping a burned asset from the `
      + `collection group before flagging it. It is NOT a bare Core BurnV1. Confirm on chain.` })
  continue
}
```
and assert both directions.

---

## R3-4 — MEDIUM: the rewritten `validate-core-gate.sh` — two remaining holes

The `set -euo pipefail` + `must_fire`/`must_pass` rewrite is correct and closes the round-14 finding. Two things left.

**(a) The script does not verify the pinned hash.** `run-tests.sh` checks `sha256sum "$CACHE/core-mainnet.so"` against a hardcoded `CORE_SHA256_EXPECTED`. `validate-core-gate.sh` checks only `[ -s ... ]`. So if the cache holds a *mock* Core whose bytes are self-consistent, all three arms pass: arm 1 fires (no Core), arm 2 fires (tampered vs mock), arm 3 passes (mock vs mock). The script prints "core gate validated in BOTH directions" about a mock. This is the **exact defect** the script's own header describes for the directory ("proved a gate over bytes the real gate never reads") — fixed for the *path* and not for the *content*.

`run-tests.sh`'s comment is explicit that this class of tautology was the original sin:
> "the gate below was a tautology: the validator is booted with `--bpf-program CORE <cache file>`, then Core is dumped OFF that validator and compared to the same file."

`validate-core-gate.sh` reproduces that tautology exactly. Every arm compares the cache to itself (or to a mutation of itself). **It validates that `cmp` works.** It does not validate that the cache is mainnet Core.

**Fix:** duplicate the pinned-hash check, or better, factor it:
```sh
CORE_SHA256_EXPECTED=f03e75373ae9cae07b5875f7818c55147b73c5607ca0f96968bab93cd583dc6e
got=$(sha256sum "$CACHE/core-mainnet.so" | cut -d' ' -f1)
[ "$got" = "$CORE_SHA256_EXPECTED" ] || die "the cache is not the pinned mainnet Core ($got)"
```
Note `build-mainnet.sh` already does exactly this, hardcoded, with the same constant — so this is **the third copy of a pinned hash**, and two of three sites have it. One of N sites, again. Put it in `scripts/lib-core-pin.sh` and source it from all three.

**(b) `must_fire` uses `if gate "$1"; then die`.** Under `set -e`, `gate` returning 1 inside an `if` condition is fine. Correct. But `gate` also writes `$CACHE/g-onchain.so` on every call, and arm 1 runs `gate` against a validator with no Core — `solana program dump` fails, `g-onchain.so` may be left as a **zero-byte file from a previous run**, and `cmp -s` of a stale `g-onchain.so` against `core-mainnet.so` could theoretically pass if `g-onchain.so` happened to be a copy. The `|| { echo; return 1; }` on the dump prevents reaching `cmp`, so this is safe. But `rm -f "$CACHE/g-onchain.so"` should happen at the top of `gate`, not at the end of the script — a stale artifact from an aborted run is a hazard in a script whose whole purpose is proof.

**(c) Arm 3 reuses the validator from arm 2 without re-booting.** That is deliberate and fine (the validator has real Core). But arm 2 leaves `g-tampered.so` and the script `rm -f`s it at the end. If the script dies between arm 2 and the cleanup (`set -e` + a `die`), `g-tampered.so` persists in `$CACHE` — the same directory `run-tests.sh` reads. It is not named `core-mainnet.so`, so nothing picks it up. Low. Add a `trap` cleanup.

---

## R3-5 — MEDIUM: the ceiling harness — 9.14a's pinned `1119` is measured under a **best-case declared list**, and 9.14b's `2` contradicts `MAX_RESERVE_MINTS = 3`

**(a) 9.14a pins `sizes[2] === 1119`.** Good — a literal, so a shape change goes red. But look at what `sizeFor(3)` builds:

```js
const decl = ms.flatMap(m => [ata(m,pda,true), ata(m,pda,true,TOKEN_2022_PROGRAM_ID)])
```

Exactly 6 declared accounts for 3 mints. That is the **minimum** BURN accepts. It is not the worst case, because BURN's second loop iterates `remaining_accounts` and a real redemption of a griefed vault must **also declare the junk account** — 9.9 proves an undeclared junk token is destroyed, and the co-signer (R1) will *refuse to sign* unless it is declared. So the worst case a co-signed redemption can present is `6 + (number of junk accounts the co-signer found)`. At 32 bytes each plus a sweep instruction per junk account (transfer + close = ~2 inner instructions), **one airdropped junk token pushes a 3-mint redemption over 1232.**

Concretely: 1119 + 32 (declared) + ~70 (transfer+close inner instructions and their account refs) ≈ 1221. Two junk tokens: over. So the true statement is:

> **Three reserve mints fit only for a vault with zero undeclared holdings. One airdrop makes a 3-reserve-mint redemption unserializable, and the co-signer will refuse to sign the version that omits it.**

That is a **deadlock**, not a size limit: the co-signer refuses the small transaction (undeclared holding) and the wire refuses the large one (too big). The vault cannot be redeemed at all until someone sweeps the junk out — which requires a thaw, which requires a burn, which is the transaction that does not fit. **The junk must be swept in a redemption that fits, i.e. the customer must redeem with fewer reserve mints declared — which BURN refuses (`ReserveNotDeclared`).**

Is this reachable? It needs: 3 reserve mints configured, and ≥1 junk token airdropped into a vault. 9.7 proves anyone can do the second for the price of an ATA rent. So **once the third reserve mint is added, any vault can be permanently bricked by a stranger for ~0.002 SOL.** That is a griefing attack with a permanent, unrecoverable outcome, and it costs the attacker two dollars.

Mitigating: the customer could sweep the junk in a *prior* transaction — no, they can't; sweeping needs `ExecuteV1`, which needs the thaw, which needs the terminal burn. **There is no way to move anything out of a vault except in a redemption.** So this is real.

The escape: **the co-signer could sign the redemption that omits the junk**, destroying the junk. That is the ALLOW that 9.9 asserts. So the operator's choice is: destroy the customer's airdropped token (documented, accepted), or the vault is bricked. The project has already decided to accept destruction (measured fact 11 / the known-and-open list). So the deadlock resolves by the co-signer overriding its own coverage check — which means **`--live` will be run with the coverage check knowingly bypassed**, and there is no flag for that, no record of it, and no assertion covering it.

**Fix.** Either
- lower `MAX_RESERVE_MINTS` to **2** and re-measure with a junk-token allowance, or
- add a `--accept-loss "<reason>"` flag to `cosign.mjs` that signs despite a coverage failure, **prints exactly what will be destroyed**, and requires the reason to be non-empty (same discipline as `applyAcks`), and
- add a suite assertion: `sizeFor(3, false, 1 /* junk accounts */) > 1232`, pinned as a literal, so the headroom claim ("113 bytes to spare") is measured against the real worst case rather than the clean one.

**(b) 9.14b measures `2` and nothing enforces it.** The assertion records the number and SPEC writes down "destination ATAs MUST be created in a PRIOR transaction". Nothing in the repository builds a redemption, so nothing can be checked. **The co-signer is the natural place to enforce it**, and it does not: `judgeRedemptionTx` allows an `AssociatedTokenAccount` `createIdempotent` instruction (it is not SEAL and not BURN, so the loop ignores it). So a client that folds ATA creation in gets *blessed by the co-signer* and then fails at the wire with `Transaction too large` — which is at least a loud client-side failure, so the consequence is small. But the co-signer should refuse it with a named reason, because "the tool told me it was clean and then it wouldn't send" is how an operator loses an hour.

**Fix.** In `judgeRedemptionTx`, refuse ATA-program instructions with a pointer to the requirement:
```js
if (ix.programId === cfg.ataProgram)
  bad.push(`this transaction creates an associated token account. Destination ATAs MUST be created in a `
    + `PRIOR transaction (measured, suite 9.14b: only TWO reserve mints fit otherwise).`)
```

**(c) `MAX_RESERVE_MINTS` assertions 9.15/9.16 compare against `fits`, not against `EXPECTED_CEILING`.**
```js
rec('9.15','SEAL caps reserve mints at a count redemption has been MEASURED to carry', String(fits), capInSeal)
```
`fits` is computed, `capInSeal` is read from source. If the shape changes so `fits` becomes 2, 9.14 goes red (it compares to the literal 3) **and 9.15 goes red too** (2 vs "3"). Good. But if the shape changes so `fits` becomes 4, 9.14 goes red and 9.15 also goes red (4 vs 3) — which is correct but confusing: the constant is *right* and the measurement moved. Compare 9.15/9.16 against `EXPECTED_CEILING` so the constant-vs-source check is independent of the measurement-vs-literal check. Minor, but this is the assertion that certifies an on-chain bound.

---

## R3-6 — MEDIUM: `selftest.mjs`'s `FLOOR = 275` and `run-tests.sh`'s floors can be defeated, and one already is

**(a) `FLOOR` is checked only on `R.length`, and assertions can be deleted while the count stays.** The mechanism: `t()` pushes one entry per call. Delete a meaningful assertion, add a trivial one (`t('x', 1, 1)`), and the count is unchanged. The floor detects *early exit*, not *deletion*. The comment claims otherwise:

> `run-tests.sh`: "deleting assertions until only the easy ones remain kept it green"

and the fix (a floor) does not address deletion at all — it addresses truncation. That is a comment claiming a control the mechanism does not provide. Both floors have this property; it is inherent to counting.

The only real defence is **per-section floors** or a **manifest of assertion names**. Cheap version: hash the sorted list of assertion *names* and pin it.
```js
const NAMES_SHA = 'a1b2...'   // sha256 of R.map(r=>r.name).sort().join('\n')
const got = createHash('sha256').update(R.map(r=>r.name).sort().join('\n')).digest('hex')
if (got !== NAMES_SHA) console.error(`⚠️ the assertion SET changed (${got}). If deliberate, re-pin NAMES_SHA and say why.`)
```
This turns deletion-with-replacement into a visible diff. It does not fail the build (name changes are legitimate) but it makes the change loud, which is what the floor was reaching for.

**(b) The `floor()` helper's regex reads the LAST match. `tail -1`.** 
```sh
local n; n=$(grep -oE "$3" <<<"$2" | grep -oE '^[0-9]+' | tail -1)
```
`selftest.mjs` prints `${R.length - bad.length}/${R.length} detector assertions as predicted`. So `n` is the **passed** count, not the total. If 275 assertions run and 3 fail, `n = 272` and the floor `>= 275` fails — but the build has *already* failed on `DET_RC != 0`, so this is unreachable. Harmless. But note the floor is measuring the wrong number, and if someone ever makes the selftest exit 0 on failures, the floor silently becomes "passed >= 275" which a shrinking suite with all-passes satisfies. Read the denominator:
```sh
n=$(grep -oE '[0-9]+/[0-9]+ detector assertions' <<<"$2" | tail -1 | cut -d/ -f2 | grep -oE '^[0-9]+')
```

**(c) `FLOOR = 275` — is it the real count?** The round-14 verdict says "`250` detector" in its STATE section while `selftest.mjs` says `FLOOR = 275` and `run-tests.sh` says `DET_FLOOR=275`. **The verdict and the code disagree by 25.** The prompt's header says "275 off-chain detector assertions". So either the verdict's STATE line is stale (most likely) or the floor is 25 above reality and **the selftest fails on every run**. That is trivially checkable: `node bank/selftest.mjs | tail -1`. If it prints `275/275`, the verdict is wrong. If it prints `250/250`, **the build has been red since the commit** and the floor was never run. Given the diff also contains the `DET_RC` fix that makes a failing selftest visible, and given the verdict claims "Every floor equals its real count", one of those two statements is false. **Check this first.** It is a five-second measurement and it decides whether the round-14 repairs were ever executed.

**(d) `run-tests.sh`'s `MIN_ASSERTIONS=267` vs the suite.** The diff adds 9.13a, 9.14a, 9.14b and 3.1c–3.1f were already there. 259 → 267 is +8; the diff adds 9.13a, 9.14a, 9.14b = 3 new `rec()` calls, plus `because()` entries... The verdict says 267. Same check: run it.

---

# R4 — THE COMMENTS

I read every header in the diff and in the four programs against what executes. Findings, in severity order.

## R4-1 — CRITICAL (as a defect class): SEAL's header and BURN's header still say **NO CO-SIGNING TOOL EXISTS**, which is now false

This is the drift running the *other* way, exactly as the prompt anticipated.

**SEAL, `programs/cbob-vaults/src/lib.rs`, module header:**
```
//!   * The Bank's co-signature could refuse in the moment — a Solana signature
//!     covers the whole transaction, so the Bank sees every instruction — but
//!     **NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY.** Nothing scans before it
//!     signs, because nothing signs. Until that is built, the pre-signature
//!     control is a human procedure, not a control.
```

`bank/cosign.mjs` exists. This is wrong, and it is wrong in the most dangerous direction: it tells a reader that the pre-signature control is a human procedure, so a reader will not run the tool. **A comment denying a control that runs is worse than one asserting a control that doesn't**, because the first causes the control to be skipped and the second only causes false confidence.

**BURN, module header:**
```
//! ⚠️ AND READ "the Bank must alarm on every burn" AS EXACTLY THAT — an alarm,
//! AFTER the fact. `bank/alarm.mjs` now reports a nested vault every pass and an
//! undeclared token account daily, but **no Bank co-signing tool exists in this
//! repository**, so nothing scans before it signs. The pre-signature refusal is a
//! human procedure until one is built. Do not read the co-signature as a control
//! that runs.
```

Same. And note the diff **did** update BURN's other paragraph (the "CANNOT prove: completeness" one) to point at SPEC — so BURN's header now contains, within thirty lines of each other, a paragraph that points at SPEC's control table (which lists `cosign.mjs` as a pre-signature control) and a paragraph that says no such tool exists. **The file contradicts itself.** That is the sixth-round class, seventh instance, in the file the repair touched.

**SPEC's own "PROVEN IMPOSSIBILITIES" item 2:**
```
   mints are covered deterministically; anything else rests on **whatever the
   control table in "THE SHIP GATE" says actually runs** — which today is two
   post-hoc detectors and, explicitly, NOT the Bank co-signature, because nothing
   in this repository signs a redemption.
```
Points at the table (good) and then **restates a stale answer anyway** (bad), and the stale answer directly contradicts the table two sections down, which lists `bank/cosign.mjs` first. The round-14 verdict claims this exact line was fixed: *"SPEC's proven impossibility 2 — the last contradicting SPEC's own table two sections away … All three now point at the control table in SPEC rather than restating it."* It points at the table **and** restates. The repair was half-applied.

**Fix.** All three: delete the restatement, keep only the pointer.

## R4-2 — HIGH: `SetPaused`/redemption claim in BURN's `burn_vault` doc — "it must SCAN THE PDA BEFORE IT SIGNS and alarm on every call"

```rust
/// Destroy a vault, and with it release everything it held. Owner AND Bank must
/// sign — the Bank because this is the one instruction that can permanently
/// remove value, so it must SCAN THE PDA BEFORE IT SIGNS and alarm on every call.
```

This one is now *true* (cosign.mjs scans) but it is a **restatement of the control**, which is what R4's rule forbids. And "alarm on every call" is false in a specific way: `burn_via_program` is INFO and `correlateBurns` downgrades `vault_burned` to INFO, so a redemption produces **no alarm at all** — by design, correctly. The comment says the Bank "must alarm on every burn". Nothing alarms on a correlated burn. Point at the table.

## R4-3 — MEDIUM: `bank/cosign.mjs`'s own header over-claims

```
 * So the honest claim is: it refuses everything it can see, and what it can see
 * is one slot old.
```

It does **not** refuse everything it can see. It sees `isSigner`/`isWritable` and the fee payer in the parsed transaction and **discards them** (R1-2). It sees zero-balance token accounts and **discards them** (R1-3b). It sees `it.compression` and discards it. "Everything it can see" is a claim about a superset of what it checks.

Also:
```
 *   node bank/cosign.mjs --selftest               # the judgement, both ways
```
`--selftest` runs **no assertions**. It prints three lines of prose saying the judgement lives elsewhere. The usage line promises a selftest and delivers a `console.log`. Either make it `import('./selftest.mjs')` (as `alarm.mjs --selftest` does) or rename the flag `--about`. A flag named `--selftest` that tests nothing is a gate that always says OK.

## R4-4 — MEDIUM: `detectNestedVaults`' docstring asserts a MINT defect that is real but frames the fix wrongly

```
 * IT IS REACHABLE BY ACCIDENT, NOT JUST BY MISTAKE. MINT requires `owner: Signer`
 * and its comment calls that "strictly stronger" than an on-curve test. It is not:
 * `is_signer` is TRUE for a PDA passed as a CPI signer, so a DAO buying a charter
 * vault from its Squads treasury satisfies it, pays, deposits real cbBTC and
 * receives a permanently sealed asset.
```

Correct, and MINT's comment is still uncorrected (carry-over 7). But note the consequence the docstring does *not* state: **`mint_vault` also requires `bank: Signer`.** A DAO minting from its Squads treasury needs the Bank's signature in the same transaction, and a Squads execution is one top-level instruction CPI-ing its contents — so the Bank's signature must be *inside* the Squads transaction, i.e. the Bank must be a Squads member or must pre-sign. In practice: **the Bank has to co-sign a DAO's mint, and the Bank is the party that should refuse it.** So this is not "reachable by accident" in the sense of nobody noticing — it is reachable only with the Bank's active participation. The written Bank duty ("refuse to co-sign a mint while a proposal is open") should gain a third clause: **refuse to co-sign a mint whose `owner` is off-curve.** That is enforceable, cheap, and the *only* place it can be enforced. And it should live in `cosign.mjs` too — a `judgeMintTx` sibling — since the Bank now has a tool.

## R4-5 — LOW: `lock.mjs`'s header (R2-1 restated as a comment defect)

> "ROUND 14 CLOSED THE TOCTOU THIS PARAGRAPH USED TO ADMIT."

It narrowed it. The restore path has its own window (R2-1). And:

> "`rename` IS atomic. Two racers renaming the same path to their own unique names cannot both succeed"

True and correctly reasoned. But the paragraph then says "Exactly one process can ever take the lock out of the way, and it is the same process that then claims it" — which is false: the *loser* of a race with a fresh replacement also takes the lock out of the way (renames it), and then does not claim it. That is the whole restore branch. The comment describing the mechanism contradicts the branch immediately below it.

## R4-6 — LOW: `alarm.mjs`'s all-clear text

```js
: 'no approvals, no unexpected PDA token accounts, no nested vaults, no burn this'
  + '\npass could not account for, no vault left the'
  + '\ncollection, no reserve fell, ...'
```

"no nested vaults" is now over-broad: `detectNestedVaults` also emits `unredeemable_owner`, and the all-clear does not mention it. If an off-curve-owner finding were acked to INFO, the report would print this line **while an INFO `unredeemable_owner` sits below it**. Same shape as the "no burns" correction the comment above it describes. Add "no vault owned by an address that cannot sign".

Also: `if (acked) lines.push('⚠️ N finding(s) DOWNGRADED...')` is above the severity blocks, and the all-clear line at the bottom is chosen on `crit.length || high.length` — which is **post-ack**. So a pass whose only findings are acked CRITICALs prints the ⚠️ line *and* the full all-clear paragraph. Contradictory. The all-clear should be suppressed when `acked > 0`.

## R4-7 — LOW: `MINT`'s dead redemption stamp comments (carry-over 7, unchanged)

```rust
const MAX_ATTRS: usize = 8;
/// SEAL owns this key and rewrites it on every close; MINT must never set it.
const ATTR_REDEMPTION: &str = "redemption";
```
"rewrites it on every close" — there is no close. And:
```rust
/// Provenance stamped at creation. Bounded so the Attributes plugin stays within
/// what SEAL's `mark_opened` is willing to parse and rewrite
```
`mark_opened` does not exist in SEAL. Two comments naming instructions that were deleted in v5. Carry-over 7 says this is known; I am recording that it is **two** comments plus the `PLUGIN_ATTRIBUTES` delegation to `seal_pda`, not one.

---

# CARRY-OVER LIST

**1. Cross-pass correlation lag — WORSE than stated.** The verdict says "the CRITICAL already went out and nothing retracts it." True, and there is a second half: `alarm.mjs` reverts `next.cursors` to `prev.cursors` when delivery fails, but on *success* the cursor advances. So a `vault_burned` CRITICAL that goes out in pass N, correlated in pass N+1, is fine. But if the burn transaction was in the window pass N *scanned* and the DAS diff was in pass N, they correlate. If DAS is *ahead* (sees the burn before the signature walk reaches it) the CRITICAL goes out at N and the correlation happens at N+1 — but at N+1 the vault is **already out of `prev.vaults`**, so `detectVaultSetChange` does not re-emit `vault_burned`, so **nothing at N+1 says "that CRITICAL was a redemption."** The correction never arrives. The fix the verdict names (a short memory of recent `burn_via_program` assets) is necessary but insufficient — you also need a memory of *emitted* CRITICALs so the retraction can be printed. Add `next.pendingCorrelation: [{asset, kind, at}]` and emit an INFO "the CRITICAL for X in the pass at T was a redemption" when it resolves.

**2. Compute units — YES, there is a CU ceiling below the byte ceiling, and it is close.** Unmeasured is right; here is the arithmetic that makes it urgent. A 3-reserve-mint redemption contains: `open_for_redemption` (Core `UpdatePluginV1` CPI + a sysvar walk over ~8 instructions), one `ExecuteV1` wrapping 7 inner instructions (3× transfer, 3× close, 1× SystemProgram.transfer), and `burn_vault` (a sysvar walk, a SEAL-config parse, 6 ATA `find_program_address` calls at ~1,500 CU each = 9,000, plus a `remaining_accounts` loop, plus Core `BurnV1`). `find_program_address` alone is 9,000 CU for the reserve loop and 3,000 for the asset-signer seed check. Core's `ExecuteV1` with 7 inner CPIs is easily 60–100k. The default per-transaction limit is **1.4M** with a `ComputeBudget` instruction and **200k × instruction count** without — and a legacy transaction gets `min(1.4M, 200k × n)`. With n=3 top-level instructions that is **600k**, and each *inner* CPI does not raise it. 600k for two sysvar walks, 6 PDA derivations, a Core plugin update, a Core burn, and 7 inner token instructions is **plausibly tight and possibly over**. And adding a `ComputeBudget::SetComputeUnitLimit` instruction costs ~**40 bytes** against 113 bytes of headroom — which is affordable but must be **in the measured worst case**, and 9.14 does not include it.

**This is a hard blocker on `MAX_RESERVE_MINTS = 3`** and it is measurable in one afternoon: run the real 3-mint redemption on the validator and read `consumedComputeUnits` off the transaction meta. Add it as assertion 9.14c with a pinned literal. If it exceeds 600k, `MAX_RESERVE_MINTS` must be 2, or every client must include a ComputeBudget instruction and the byte measurement must include it.

**3. `prog.*.hash` at offset 45 — worse for Core specifically.** Core's ProgramData has an upgrade authority today, so `data[12] === 1` and the ELF starts at 45. Correct today. If Metaplex ever makes Core **immutable** (a plausible, even desirable, event), `data[12] === 0`, the ELF starts at 13, and `subarray(45)` hashes the ELF minus its first 32 bytes — **which changes the hash**, producing a `prog.core.hash` CRITICAL drift on the pass Core becomes immutable, correctly alarming, and then a *stable* wrong hash thereafter. So the consequence is one false CRITICAL and then a silently-wrong-but-stable baseline. That is survivable. The real problem: `prog.core.upgrade_authority` would go from a pubkey to `'IMMUTABLE'` in the same pass, so an operator sees two CRITICALs and understands. **Low severity, easy fix:** `const off = acc.data[12] === 1 ? 45 : 13`.

**4. Foreign Core asset nested in a vault — now CLOSED by `cosign.mjs`, and SPEC says so.** SPEC's control table row for the co-signer says it catches "every token account or nested Core asset the vault holds that the burn does not declare", and `scanPda`'s DAS call is owner-scoped, so a foreign Core asset **is** seen. So carry-over 4 is resolved for the pre-signature path and open for the post-hoc path. SPEC states exactly this. **Correct as written** — one of very few places where the documentation matches. But see R1-3c: a *compressed* asset is seen and cannot be declared, so it is a soft-brick rather than a caught case.

**5. `burn_via_program`'s caller-supplied key — analysed in R3-3a. On-chain checks make it non-exploitable.** Confirmed. But add the check anyway (`if (!assetSet.has(asset)) severity = HIGH, kind='burn_via_program_foreign'`), because the *reasoning* that makes it safe depends on four on-chain properties in another program, and a one-line set membership test is cheaper than that dependency.

**6. SPEC contradicts implementation on sweep authorisation.** Confirmed, unchanged:
> "| 1. `sweep_sol_for_swap` | **on-chain**, bounded by a SOL fee reserve, destination PINNED in config | permissionless |"

`sweep_sol_for_swap` requires `swap_operator: Signer`. The table says permissionless. Two sections later SPEC says "**the swap operator SIGNS**". Same document, both readings. And the stale counts: "178 assertions", "93 detector and 14 allocation", "69 assertions", "13 AI audit rounds", "v10 spec". A document whose own numbers are wrong in five places is a document nobody trusts on the sixth.

**7. MINT's dead stamp + "strictly stronger" — see R4-4 and R4-7.** Both still present. The "strictly stronger" claim is now *contradicted by an assertion in the same repository* (`detectNestedVaults`' docstring), which is the worst state: two files, opposite claims, no test.

**8. Distribution reconciles against a ledger the payer wrote.** Unchanged. Note one thing that makes it *worse* than stated: `detectDistribution` reads `distributions.json`, and `distribute.mjs` writes it, and both run as `ubuntu` with the distributor key on the same box. But `detectDistribution` also has no chain-derived cross-check equivalent to `detectUnledgeredSweeps` — the alarm scans MINT's signatures for sweeps and **does not scan cbBTC transfers out of the distributor**. A `getSignaturesForAddress(distributor)` walk demanding a ledger row per transfer is the exact mirror of the sweep check and is not implemented. That is a named gap in the round-12 fix, one of two sites.

**9a. Duplicate attribute keys.** Unchanged. `mint_vault` validates `len`, `key.len()`, `value.len()`, and `key != ATTR_REDEMPTION`, and never checks for duplicates. Core's Attributes plugin stores a list, so two `charter` keys both persist and any reader gets whichever it iterates first. Impact: provenance ambiguity on a vault whose provenance SPEC says is destroyed at redemption anyway. Genuinely low. One line: build a `BTreeSet` and `require!(set.len() == attributes.len())`.

**9b. A vault minted during a proposal may vote.** Unchanged, stated. Note the Bank duty is *now enforceable*: `cosign.mjs` exists, so a `judgeMintTx` could read `gov.proposal_count` and the newest proposal's `voting_ends_at` and refuse. The duty has been "not enforceable on-chain" — true — and is now enforceable *off-chain at signature time*, which is where the Bank's other duties moved this round. Recommend building it, since the tool is there.

**9c. Atomic reserve-continuity verification for a buyer.** Unchanged. Worth noting a cheap partial: the buyer can, in the same transaction as their purchase, include a **read-only** instruction to a tiny new program that asserts `asset_signer`'s cbBTC ATA balance ≥ N and reverts otherwise. That is a ~50-line program and it makes reserve continuity atomic with the purchase. Not required; recording it because SPEC calls it impossible and it is not.

---

# VERDICT CHALLENGES

## V1 — The admin exemption. CONFIRMED CORRECT, with one caveat the verdict does not name.

I checked every admin-gated instruction in all four programs for instruction introspection or a top-level-signature requirement:

- **SEAL**: `initialize` (INIT_AUTHORITY = Squads, off-curve, works today by CPI — proven by `build-mainnet.sh`), `update_config`, `cancel_pending`. No introspection. `apply_pending` is permissionless. ✓
- **MINT**: `initialize`, `update_wiring`, `set_paused`, `set_collection_royalties`, `cancel_pending_*`. `set_collection_royalties` needs `admin` AND `governance` as two top-level Signers — a Squads admin CPI-ing this **would** work, because Anchor's `Signer` check is `is_signer`, which is true for a CPI signer. No introspection. ✓
- **BURN**: `initialize`, `update_config`, `cancel_pending`. ✓
- **GOV**: `initialize`, `update_gov_config`, `cancel_pending_admin`. ✓

**No admin instruction breaks under a PDA admin.** The exemption is correct.

**The caveat.** `set_collection_royalties` requires admin **and** governance as top-level signers, and SPEC notes the ordering constraint (do it before governance becomes the GOV PDA). If admin is a Squads vault and governance is a keypair, both must sign the *same* transaction — meaning the keypair's signature must be inside the Squads proposal, which Squads supports (additional signers). Fine. But `update_wiring`'s `needs_governance` path has the same shape and the same requirement, and test 7.18 asserts it becomes unreachable once governance is a PDA. So: **admin-as-Squads is fine; admin-as-Squads AND governance-as-PDA together means the governance-gated setters need a governance rotation, which admin arms.** That is documented. No new finding.

## V2 — The closed-ATA delegate ALLOW (3.3a). CONFIRMED SAFE, and the reasoning is sound.

A delegate on an account that is closed in the same transaction: the account is gone, so the delegation is gone with it. Re-creating the ATA at the same address yields a fresh account with no delegate. The PDA can never sign again. Nothing the delegate could authorise exists.

One thing the test does not cover and should: **the ATA is closed to `alice`, not to the PDA.** `createCloseAccountInstruction(ata(pda), alice.publicKey, pda)` sends the rent to alice. So the *rent* of the reserve ATA goes to the redeemer, which is correct (they paid for the vault). But it means a redemption where the customer closes the ATA to a **third party** is also allowed, and the co-signer does not check the close destination. Immaterial (it's the customer's rent), recording for completeness.

## V3 — "Only TWO reserve mints fit if the redeemer must create their destination ATAs" — the written requirement is NOT sufficient.

The verdict says: *"Creating them need not be atomic with the burn, so it MUST be a prior transaction — now a written requirement on any redemption client instead of a silent assumption."*

A written requirement in SPEC is not a control. What happens if a client ignores it:

- With 1 or 2 reserve mints: it works. 991 and 1215 bytes, both under 1232. So a client that folds ATA creation in **works fine today** and will keep working until the third reserve mint is added — at which point it breaks for every user simultaneously, with `Transaction too large`, and nobody will connect it to a config change made weeks earlier.
- The failure is client-side (web3.js refuses to serialize) so no money is lost. But the *timing* is the problem: the third reserve mint is an additive-only config change, irreversible, and it silently breaks every client that made the reasonable choice.

**The requirement must be enforced, not written.** Two places:
1. `cosign.mjs`: refuse ATA-program instructions (R3-5b). Then a non-compliant client is refused at inspect time, before the third mint exists, with a message naming the reason.
2. **`update_config` should require the new reserve list to be measured.** It cannot measure a transaction on-chain. But it *can* be gated behind the same notice period as everything else: a reserve-mint addition currently takes effect **immediately** on one admin signature. Given that it is additive-only, irreversible, and can (per R3-5a) brick vaults, it is the single most dangerous admin write in the system and it is the only one with **no notice period**. SEAL's `update_config` timelocks `bank` and `admin` and applies `reserve_mints` instantly. That is an inconsistency the verdict does not name and I would call it a finding in its own right:

### V3-a — HIGH: adding a reserve mint takes effect INSTANTLY, while every other SEAL config change waits seven days

```rust
if let Some(x) = reserve_mints {
    require!(x.len() <= MAX_RESERVE_MINTS, ...);
    require!(!x.is_empty(), ...);
    for old in c.reserve_mints.iter() { require!(x.contains(old), ...); }
    assert_classic_spl(&x, ctx.remaining_accounts)?;
    c.reserve_mints = x;      // ← immediate
}
```

Every consequence of a reserve-mint addition is irreversible and affects existing vaults: it adds two declared accounts and one sweep pair to every future redemption (144 bytes), it moves the byte ceiling, and (R3-5a) at three mints it makes a single junk airdrop unredeemable. The list cannot shrink. And the alarm reports it as `seal.reserve_mints` drift at **HIGH**, up to thirty minutes later, after every vault is already affected.

`bank` and `admin` — which are recoverable by another rotation — get seven days. The one irreversible field gets zero. That is backwards.

**Fix.** `pending_reserve_mints: Vec<Pubkey>` + `pending_reserve_mints_at`, applied by `apply_pending`, and raise the alarm's `seal.reserve_mints` to CRITICAL with a `reserve_mint_addition_armed` standing risk. The account already has `CONFIG_PADDING = 256`, so there is room for one more Vec if declared last — but a Vec after a Vec moves the pending-bank offsets that `alarm.mjs` computes from `109 + n*32`. Simpler: a fixed `[Pubkey; MAX_RESERVE_MINTS]` + a count, declared last.

## V4 — Is one of round 14's seven fixes wrong?

Yes, three of them, and I rank them:

1. **Fix 4 (`applyAcks`) is too broad** — R3-1. It can silence a new CRITICAL under an old reason. This is the highest-value one because the mechanism's *purpose* is to reduce noise, so its failure mode is silence, and silence is the only failure mode nobody notices.
2. **Fix 6's floor (`FLOOR = 275`) may not equal its real count** — R3-6c. The verdict asserts "Every floor equals its real count" while its own STATE line says 250. One of the two is wrong and one of the two possibilities is "the build has been red since the commit".
3. **Fix 7's harness** — R3-5a. The pinned 1119 is the *clean-vault* worst case, not the worst case. The comment claims the opposite ("THE WORST CASE INCLUDES THE LAMPORT SWEEP"), having added the lamport sweep and stopped there. One of N sites: the harness was corrected for the *SOL* grief (9.10/9.11) and not for the *token* grief (9.7/9.9), which is the same measured attack, in the same section, three assertions away.

And one that is not wrong but is misdescribed:

4. **Fix 1 (`validate-core-gate.sh`)** — R3-4a. The rewrite is correct for what it fixed. But the script still validates a cache it does not authenticate, which is the same tautology its own header describes. The fix is right; the claim "core gate validated in BOTH directions" is broader than what runs.

Plus the `lock.mjs` one, which is fix-adjacent: **R2-1**, the break is not exclusive for three racers with a fresh replacement, and the header says it is.

---

# SEVERITY SUMMARY

| # | Sev | Finding |
|---|---|---|
| R1-2 | **CRITICAL** | `cosign.mjs` signs arbitrary added instructions naming the Bank as signer/fee payer. Bank's SOL and tokens stealable by a redeeming customer; `mint_vault` bundling bypasses two written Bank duties. |
| R1-1 | **CRITICAL** | `Transaction.from` cannot parse v0; no explicit refusal; ALT-carrying transactions are exactly what the tool most needs to inspect. |
| R4-1 | **CRITICAL** (class) | SEAL and BURN headers and SPEC impossibility 2 all still say **no co-signing tool exists**. BURN's header now contradicts itself within thirty lines. |
| R2-1 | **HIGH** | The lock break's restore path leaves `file` absent for 2 syscalls; a fourth process can claim it and both hold. Header claims the TOCTOU is closed. Plus the `.breaking.` selftest assertion can never fail (`? '.' : '.'`). |
| R1-3 | **HIGH** | `scanPda`: no `readTokenAccount`, zero-balance accounts discarded (contradicting a sibling assertion), compressed assets create an unsatisfiable coverage demand, no mint recorded. |
| R1-5 | **HIGH** | Co-signer never checks the asset's on-chain owner or collection, so `clean` does not mean "this will execute". |
| R3-1 | **HIGH** | `applyAcks` key `kind:asset` silences *future different* findings of the same kind under a stale reason; `reserve_fell` and `undeclared_token_account` are the dangerous cases; armed rotations cannot be acked at all. |
| R3-3c | **HIGH** | `vault_left_index` will fire CRITICAL on honest redemptions when DAS drops a burned asset from the group before flagging it burnt. |
| V3-a | **HIGH** | Adding a reserve mint takes effect **instantly**; every other SEAL config change waits seven days. It is the only irreversible field and the only one with no notice. |
| CO-2 | **HIGH** | Compute units unmeasured and plausibly the binding constraint at 3 reserve mints (600k limit for a 3-instruction legacy tx). Blocks `MAX_RESERVE_MINTS = 3`. |
| R3-5a | **HIGH** | 3-reserve-mint ceiling measured on a clean vault. One junk airdrop makes the redemption unserializable *and* the co-signer refuses the version that omits it → permanent brick for ~$2, with no flag to override. |
| R1-7 | MEDIUM | `BURN_FIXED_ACCOUNTS = 11` — the comment claims 3.1c–3.1f assert it; they do not; grep returns zero hits. |
| R1-8 | MEDIUM | SEAL/BURN `bank` can diverge for 7+ days; co-signer reads only SEAL; no `banks_disagree` detector. |
| R1-4 | MEDIUM | DAS guard fires after the loop, hard-codes 1000, and misses `result: null`, `!r.ok`, and a behind-indexer empty answer. |
| R2-2 | MEDIUM | `releaseLock` returns true on ENOENT, so "my lock was stolen and the thief already released" reports a clean release. |
| R3-2 | MEDIUM | `unredeemable_owner` will produce 40–100 CRITICALs per pass once vaults are listed; distinguishable with one `getAccountInfo` and isn't. |
| R3-4 | MEDIUM | `validate-core-gate.sh` does not verify the pinned hash — validates a cache it does not authenticate. Third copy of the pinned constant, two of three sites have the check. |
| R3-6 | MEDIUM | Floors detect truncation, not deletion (comment claims otherwise); `floor()` reads the passed count not the total; `FLOOR=275` vs verdict's `250` — measure this first. |
| R3-5b | MEDIUM | The 9.14b "prior transaction" requirement is written, not enforced; a compliant-looking client silently breaks the day the third reserve mint lands. |
| R4-4 | MEDIUM | MINT's "strictly stronger" claim is contradicted by a docstring in the same repo, with no test either way. The Bank *can* now enforce it (`judgeMintTx`) and doesn't. |
| CO-1 | MEDIUM | Cross-pass lag: the correction never arrives, because at N+1 the asset is out of `prev.vaults` and `vault_burned` is not re-emitted. |
| CO-8 | MEDIUM | No chain-derived cross-check on distribution transfers — the mirror of `detectUnledgeredSweeps`, not implemented. |
| R1-6 | LOW | Two-redemptions refusal is defensible but undocumented in SPEC and short-circuits before collecting worse reasons. |
| R4-3 | LOW | `cosign.mjs --selftest` runs no assertions; usage line promises otherwise. |
| R4-6 | LOW | All-clear text omits `unredeemable_owner` and is printed alongside the ack warning. |
| R4-5 | LOW | `lock.mjs` header: "exactly one process can ever take the lock out of the way" contradicts the restore branch below it. |
| CO-3 | LOW | `subarray(45)` → `subarray(data[12] ? 45 : 13)`. |
| R2-4 | LOW | `pidStart`'s `[19]`/"field 22" comment mismatch invites a wrong "fix". |

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Fifteen rounds of AI reading have produced a repository whose *reasoning* is unusually good and whose *execution* is unverified in exactly the places that matter. The structural gap is not "the models are wrong" — it is that **reading cannot distinguish a control that runs from a control that is described.** Every finding I am most confident about above is of that shape: a comment saying 3.1c-3.1f assert something they don't; a selftest listing the wrong directory; a floor that may be 25 above reality; a co-signer that has, as far as I can tell from the code, **never been executed even once** (the `readBigUInt64LE` on a possibly-non-Buffer, the `--selftest` that tests nothing, the zero assertions on `scanPda`, the header claiming the file doesn't exist).

Five things no amount of AI reading can do, in order of value:

**1. Run every entry point once, on the real box, and paste the output into the repo.** Not a test — an *execution log*. `node bank/cosign.mjs --tx <a real base64 redemption built by the suite>`. `node bank/selftest.mjs | tail -1`. `bash scripts/validate-core-gate.sh`. `bash scripts/audit-coverage.sh`. Commit the transcripts under `evidence/`. Half the findings above would have been caught by the transcript existing, and the *absence* of a transcript is the single strongest signal in this repository that something has never run. A model cannot produce this. A `for f in <every entrypoint>; do ... done` can.

**2. Measure compute units.** It is the one hard ceiling in the system that nothing has ever looked at, four rounds have flagged it, and it takes one `getTransaction` and one `meta.computeUnitsConsumed`. If it comes back over 600k, `MAX_RESERVE_MINTS = 3` is wrong on-chain and the fix is a config-time bound, not a comment.

**3. Build the redemption client, and make `cosign.mjs` the only way to sign.** Right now the co-signer accepts a transaction from an unspecified source in an unspecified format, and its input is hostile by construction. If the same repository also *builds* the transaction, the co-signer's job shrinks from "judge arbitrary hostile bytes" to "confirm these bytes match what I would have built" — which is a byte comparison, not a semantic analysis, and it closes R1-1, R1-2, R1-5 and R3-5b in one stroke. This is the highest-leverage engineering change available and no audit round will produce it, because it is a design decision, not a finding.

**4. Do the flock and delete the break path.** Five rounds have narrowed a window the kernel eliminates. `flock -n` on an open fd, released by the kernel on process death, no staleness, no break, no restore, no `.breaking.` files, no three-racer analysis. Every `lock.mjs` finding from rounds 11–15 disappears. The header already knows this. Stop iterating.

**5. Put a second pair of eyes on the *numbers*, mechanically.** The floors, the assertion counts, the pinned bytes (1119), the pinned hashes (three copies, one un-checked), the SPEC counts (five stale), the `BURN_FIXED_ACCOUNTS`. Every one is a constant in one file that describes a fact in another, and this repository's own history says that is where it fails. A twenty-line script that extracts every such pair and asserts equality would fail today on at least four of them, and would keep failing usefully forever. Call it `scripts/pin-check.sh` and put it in the freeze gate beside `audit-coverage.sh`.

And one thing about the process itself: the SHIP GATE's condition 3 — two consecutive clean rounds against a frozen tree with different model rosters — is the right idea and it has never been attempted, because there has never been a freeze. Every round including this one audited code written after the previous round read the tree. **The gate is unreachable by construction and will stay unreachable until someone stops writing for two rounds.** That is not an engineering problem; it is a decision, and it is the only one that can end this.