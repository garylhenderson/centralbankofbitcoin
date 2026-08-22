[reasoning only]
Let me start by understanding the scope. This is round 15 of an AI-only audit of a Solana vault system. The diff under audit is e16c5e2..2f84b40. The primary targets are:

R1. `bank/cosign.mjs` — brand new co-signer
R2. `bank/lock.mjs` — break rewritten with atomic rename
R3. Round 14's other repairs (acks, unredeemable_owner, REDEMPTION_NOISE, validate-core-gate.sh, ceiling harness, floors)
R4. Comments — drift between comments and what runs

Then carry-over list, verdict challenges, and a final section.

Let me attack these in order, reading the actual code carefully.

## R1: bank/cosign.mjs

Let me read the full file carefully.

```javascript
import fs from 'fs'
import { PublicKey, Connection, Transaction, Keypair } from '/opt/gary-club/node_modules/@solana/web3.js/lib/index.cjs.js'
import * as D from './detectors.mjs'
import { pinnedAccountData } from './anchor.mjs'
import { createHash } from 'crypto'

const SEAL = new PublicKey('9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273')
const BURN = new PublicKey('8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8')
const CORE = new PublicKey(D.CORE_ID)
const TOK = new PublicKey(D.TOKEN_ID)
const TOK22 = new PublicKey(D.TOKEN22_ID)
const KEYFILE = process.env.CBOB_BANK_KEY || '/opt/cbob-vaults/bank/keys/bank.json'
const BURN_FIXED_ACCOUNTS = 11
const disc = n => [...createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)]
```

Key observations:

1. **`Transaction.from` only handles legacy transactions.** The code does `Transaction.from(Buffer.from(b64, 'base64'))`. In web3.js, `Transaction.from` handles legacy transactions. If a customer submits a **versioned transaction** (v0 with address lookup tables), `Transaction.from` will throw or misparse. Actually, let me think. `Transaction.from` in older web3.js throws on versioned transactions. In newer versions, there's `VersionedTransaction.deserialize`. The customer composes the transaction. If they use a versioned transaction, this tool either crashes (fails closed, good) or... let me check. Actually `Transaction.from` with a versioned transaction buffer will throw "Versioned transactions not supported" in most web3.js versions. That fails closed. But wait — the prompt asks "What can a redeeming customer add to a well-formed redemption that this tool blesses? Be concrete and exhaustive: instructions, accounts, signer sets, fee payer, address tables, the transaction version."

So the transaction version question: if the customer submits a versioned transaction, `Transaction.from` throws, so the tool refuses (fails closed). That's actually fine for safety but it means the tool can't co-sign versioned transactions at all. But the redemption ceiling is 3 mints at 1119 bytes in a legacy transaction, so versioned isn't needed yet. OK.

But wait — there's a subtle issue. Let me re-read. The tool does `Transaction.from` TWICE: once in `inspect()` and once in `main()` when signing. Both parse the same base64. So that's consistent.

2. **The shape judgement `judgeRedemptionTx`**. Let me read it carefully.

```javascript
export function judgeRedemptionTx(ixs, cfg, isOnCurve) {
  const bad = []
  const has = (ix, disc) => ix.data && disc.every((b, i) => ix.data[i] === b)
  const opens = ixs.filter(ix => ix.programId === cfg.sealProgram && has(ix, cfg.openDisc))
  const burns = ixs.filter(ix => ix.programId === cfg.burnProgram && has(ix, cfg.burnDisc))

  if (opens.length !== 1 || burns.length !== 1) {
    bad.push(...)
    return { ok: false, ... }
  }
  const open = opens[0], burn = burns[0]
  if (ixs.indexOf(open) > ixs.indexOf(burn)) bad.push('burn_vault appears BEFORE open_for_redemption')

  const asset = open.accounts?.[0] ?? null
  const owner = open.accounts?.[2] ?? null
  ...
```

Now, the critical question: **what does the Bank's signature actually authorize?** A Solana signature authorizes EVERY instruction in the transaction. The tool checks:
- Exactly one open and one burn
- open before burn
- Same asset, same owner, same bank
- owner is on-curve
- No extra instructions to SEAL or BURN
- declared count matches

But it does NOT check:
- **Other instructions to OTHER programs.** The customer can add ANY instruction to any other program. The Bank signs the whole transaction, so it authorizes those too. What can those do?

Let me think about what's dangerous. The Bank is a signer on the transaction. The Bank's signature is on `open_for_redemption` (account 3, `bank: Signer`) and `burn_vault` (account 3, `bank: Signer`). So the Bank is a required signer for those two. But the Bank's signature, once on the transaction, authorizes ALL instructions that list the Bank as a signer.

Wait, but does the customer need the Bank's signature for anything else? The Bank is just a keypair. If the customer adds another instruction that requires the Bank's signature... but the Bank only signs once. The customer can't add an instruction that requires the Bank's signature unless the Bank is a signer on it, and the Bank IS signing the transaction, so any instruction listing the Bank as a signer WOULD be authorized.

But what instruction would list the Bank as a signer and be dangerous? Let me think about the MINT program. `mint_vault` requires `bank: Signer`. So a customer could add a `mint_vault` instruction to the redemption transaction, listing the Bank as the bank signer! The Bank's signature would authorize minting a new vault!

Wait, let me check. `mint_vault` accounts:
```rust
pub struct MintVault<'info> {
    pub config: ...,
    pub asset: Signer<'info>,
    pub collection: ...,
    pub owner: Signer<'info>,
    pub bank: Signer<'info>,
    pub payer: Signer<'info>,
    pub revenue: ...,
    pub seal_config: ...,
    pub mint_authority: ...,
    pub mpl_core: ...,
    pub system_program: ...,
}
```

So `mint_vault` needs `bank: Signer`. The Bank is signing the redemption transaction. If the customer adds a `mint_vault` instruction with the Bank as the bank account, the Bank's signature covers it. The customer would need to provide the `asset` signer and `owner` signer and `payer` signer, which they can (they're the customer). And they'd pay the price... but wait, the price goes to the revenue address. Hmm.

Actually, this is a real issue but let me think about the severity. The Bank co-signing a mint isn't necessarily a theft — minting requires payment (unless price is 0). But the Bank has a DUTY to refuse mints while a proposal's voting window is open (from SPEC: "refuse to co-sign a mint while a proposal's voting window is open"). So if the customer bundles a mint into a redemption, the Bank would be co-signing a mint without checking the proposal window. That's a policy bypass.

But more importantly: **the tool does not restrict instructions to only the redemption pair.** It only refuses extra instructions to SEAL or BURN. It allows arbitrary instructions to MINT, GOV, Core, Token, System, etc.

Let me enumerate what a customer can add:
- A `mint_vault` instruction (MINT program) with the Bank as bank signer → Bank co-signs a mint, bypassing the proposal-window duty.
- Actually wait, can they even? The Bank signs the transaction. `mint_vault` requires bank to sign. Yes. So the customer gets a free Bank co-signature on a mint. They still have to pay the price and provide asset/owner/payer. But the point is the Bank is authorizing something it didn't inspect.

Hmm, but is there anything that STEALS from the Bank or from other vaults? The Bank doesn't hold funds (it's just a signer). So the direct theft vector is limited. But the Bank's signature is a valuable authorization.

Actually, let me reconsider. The really dangerous thing: **the customer can add instructions that move OTHER vaults' contents, IF those instructions need the Bank's signature.** But moving a vault's contents needs the OWNER's signature (Core ExecuteV1 requires asset owner), not the Bank. So the Bank's signature alone can't move another vault's contents.

But wait — what about `open_for_redemption` for ANOTHER vault? That needs the Bank's signature AND the other vault's owner signature. The customer doesn't have the other owner's signature. So no.

What about the MINT program's `sweep_sol_for_swap`? That needs `swap_operator: Signer`, not the Bank. So no.

What about `split_revenue`? Permissionless, no Bank needed.

So the main thing the Bank's signature unlocks that the customer could add is `mint_vault`. Let me check if there are others.

Actually, let me reconsider the whole thing. The deeper issue: **the tool judges the instruction list but the Bank's signature covers the entire transaction including any instructions the customer adds.** The tool explicitly only refuses extra instructions to SEAL/BURN. It does NOT refuse extra instructions to MINT (where the Bank is also a signer for mint_vault). So the customer can smuggle a `mint_vault` past the Bank.

Is this CRITICAL? Let me think about what it gains. The customer mints a vault. They pay the price. The Bank co-signs. The harm: the Bank's duty to refuse mints during a proposal window is bypassed. Also, if the round is paused... no, mint checks paused. Actually the mint would still be subject to all on-chain checks (round open, cap, price, supply). So the customer can't mint for free or past the cap. The only thing bypassed is the Bank's OFF-CHAIN duty (proposal window, proof-of-burn for charter). 

Hmm, this is MEDIUM at most. But it's a real gap: the tool claims "the Bank sees the whole transaction and must refuse" but it only refuses extra SEAL/BURN instructions, not extra MINT instructions where the Bank is also a signer.

Actually, wait. Let me reconsider whether this is even the right framing. Let me re-read the prompt: "Enumerate exactly what this tool will and will not put the Bank's name on. What can a redeeming customer add to a well-formed redemption that this tool blesses?"

So the answer should enumerate. Let me be exhaustive:

The tool blesses a transaction containing:
- Exactly one `open_for_redemption` (SEAL)
- Exactly one `burn_vault` (BURN)
- ANY number of instructions to ANY OTHER program (Core, Token, Token-2022, ATA, System, MINT, GOV, Compute Budget, Memo, etc.)

The constraints it enforces:
- open before burn
- same asset/owner/bank in both
- owner on-curve
- declared count matches burn's remaining accounts

What it does NOT constrain:
- Fee payer: the customer sets it. The Bank doesn't check who pays fees. Actually the fee payer must sign, and the Bank signs, but the fee payer could be the customer or the Bank. Wait — if the customer sets the Bank as fee payer, then the Bank pays the fees. That's a (tiny) cost to the Bank. But more importantly, the fee payer is a signer, and the Bank is signing, so the customer COULD set the Bank as fee payer and the Bank would pay fees. Minor.

Actually, hold on. Let me reconsider the fee payer. In `main()`, the tool does `tx.partialSign(bank)`. It doesn't check `tx.feePayer`. If the customer set `feePayer = bank.publicKey`, then the Bank's signature is the fee payer signature, and the Bank pays fees. If the customer set `feePayer = customer`, then the customer must also sign, and the Bank's partialSign is just a co-signature. The tool doesn't verify the fee payer is the customer. So a customer could make the Bank pay fees. Minor grief, not critical.

- Address lookup tables: `Transaction.from` for legacy doesn't support ALTs. If the customer uses a v0 transaction with ALTs, `Transaction.from` throws → fails closed. So ALTs can't be used. Good (fails closed) but means the tool is legacy-only.

- Compute budget instructions: the customer can add `ComputeBudgetProgram.setComputeUnitLimit` etc. These don't need the Bank's signature. They could set a very low compute limit causing the burn to fail, or a very high one. Not a theft. But they could also set a priority fee with the Bank as... no, priority fee is paid by fee payer.

- **Memo, and arbitrary programs**: The customer can add instructions to programs where the Bank is NOT a signer — those don't get authorized by the Bank beyond being in the same transaction. But they're still executed. Could they be harmful? Only if they interact with the redemption. E.g., the customer could add a Token approve instruction... but that would need the PDA's signature (the vault's asset-signer PDA), which only Core ExecuteV1 can produce, which needs the owner. Actually during the redemption the vault is thawed, so the owner CAN ExecuteV1. But that's the customer's own vault.

Hmm wait, here's a subtle one. The redemption thaws the vault (open_for_redemption), then sweeps, then burns. Between open and burn, the vault is thawed. The customer adds their own ExecuteV1 instructions (that's the sweep). But could the customer add an ExecuteV1 that does something OTHER than sweep? Like approve a delegate? Well, the burn checks for delegates on the reserve ATAs and refuses. And the burn checks the PDA lamports and declared accounts. So if the customer approves a delegate during the thaw, the burn refuses (ReserveDelegated). So that's caught on-chain.

But what about an ExecuteV1 that transfers the vault's contents to somewhere, then... no, the burn requires emptiness.

OK here's the real question the prompt is driving at. Let me think about **what the Bank's signature authorizes that the tool doesn't inspect.**

The Bank is a signer on:
1. `open_for_redemption` (SEAL) — inspected
2. `burn_vault` (BURN) — inspected
3. `mint_vault` (MINT) — NOT inspected, NOT refused
4. Any other instruction listing the Bank as signer

So the concrete finding: **the customer can add a `mint_vault` instruction and get the Bank's co-signature on a mint.** The tool only refuses extra instructions to SEAL and BURN, not to MINT.

Let me verify `mint_vault` needs the bank. Yes: `require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, MintError::NotTheBank);` and `pub bank: Signer<'info>`.

So this is a real gap. Severity: the mint is still subject to on-chain checks (price, cap, supply, round open, not paused). So the customer can't steal. But they bypass the Bank's off-chain duties. Also — and this is important — the Bank's alarm watches `mint.minted_total` and the co-signer is supposed to be the control for "refuse mints during proposal window." If mints can be smuggled into redemptions, that control is bypassed.

Actually, let me reconsider. Is the Bank even the same key for MINT and SEAL? The tool reads `bank` from the SEAL config. The MINT config has its own `bank`. They're checked to agree by `mint_vault` (it reads seal_config and checks `WiringDiverged`). So yes, the Bank is the same key across MINT, SEAL, BURN. So the Bank's signature on a redemption transaction DOES authorize a `mint_vault`.

This is a real finding. Let me note it as HIGH or MEDIUM. Given that it bypasses a stated control (the Bank's duty during proposal windows) and the tool's entire raison d'être is "the Bank sees the whole transaction," I'd say HIGH. But the actual monetary harm is bounded (mint still costs the price, respects cap). Let me call it HIGH because it defeats the stated purpose of the co-signer.

Wait, actually, let me reconsider more carefully. Is there a worse version? What if the customer adds a `mint_vault` with `price_lamports = 0`? That requires a round with price 0 (charter round). If a charter round is open, the customer could mint for free, and the Bank would co-sign. But the Bank's duty is to refuse charter-priced mints not backed by a burned Proof of Burn. So the customer bypasses that duty. Still bounded by cap.

Hmm, but actually there might be something worse. Let me think about whether the customer can make the Bank sign something that moves the Bank's... no, the Bank holds no funds.

Let me also consider: **can the customer add a second `open_for_redemption`/`burn_vault` pair?** No, the tool refuses opens.length !== 1 || burns.length !== 1. Good.

**Can the customer add an instruction to SEAL or BURN that's NOT open/burn?** The tool refuses any extra instruction to SEAL or BURN. Good. But wait — it checks `ix.programId === cfg.sealProgram || ix.programId === cfg.burnProgram` for any ix that isn't the open or burn. So extra SEAL/BURN instructions are refused. Good.

But it does NOT check MINT or GOV. So extra MINT/GOV instructions are allowed. For MINT, the Bank is a signer on mint_vault. For GOV, the Bank is not a signer on anything (gov instructions use admin, governance, proposer, owner). So GOV is less of a concern for Bank-authorization, but the customer could still add gov instructions (they'd need their own signatures).

So the concrete, exhaustive answer to "what can a customer add":
1. A `mint_vault` instruction → Bank co-signs a mint (bypasses proposal-window and proof-of-burn duties). HIGH.
2. Arbitrary instructions to Core/Token/ATA/System/Memo/ComputeBudget where the Bank is not a signer → these execute but don't get extra Bank authorization. Mostly harmless to the Bank, but could affect the redemption (e.g., a ComputeBudget instruction setting a low CU limit could make the burn fail — grief, not theft).
3. Set the Bank as fee payer → Bank pays fees. LOW.
4. A versioned transaction → `Transaction.from` throws, fails closed. (Not a blessing; a refusal.)

Actually wait, I should double check #4. Does `Transaction.from` throw on versioned? In @solana/web3.js, `Transaction.from(Buffer)` — if the buffer is a versioned transaction, it throws. Let me assume it throws (fails closed). Actually, I recall that `Transaction.from` can silently misparse in some versions. Let me be careful. The prompt says "the transaction version" as something to enumerate. Let me flag that the tool uses `Transaction.from` which is legacy-only, and if a versioned tx is submitted it either throws (fail closed) or misparses. I should note this needs verification. Actually, given the redemption must be legacy (3 mints fit in legacy), and the tool is for redemptions, versioned support isn't needed. But the failure mode should be confirmed as closed.

Hmm, actually there's a subtle issue with `Transaction.from`. Let me recall: web3.js `Transaction.from(serialized)` — for a versioned transaction, older versions throw `Error: Versioned transactions not supported`. Newer versions (1.78+?) also throw. So it fails closed. OK.

3. **`scanPda` — what value can a PDA hold that this scan does not see?**

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
  const r = await fetch(rpcUrl(), { ... getAssetsByOwner ... })
  const j = await r.json()
  if (j.error) throw new Error(...)
  for (const it of (j.result?.items || [])) {
    if (it.burnt) continue
    owned.push({ address: it.id, kind: 'asset' })
  }
  if ((j.result?.items || []).length >= 1000) throw new Error('DAS returned a full page...')
  return owned
}
```

The prompt asks: "given a response the scan DOES get back, what does it mis-read or discard?"

Let me look at the token account reading: `account.data.readBigUInt64LE(64)`. This reads the `amount` field at offset 64. But:
- **It discards token accounts with amount '0'.** `if (amount !== '0')`. So a zero-balance token account is NOT added to `owned`. But the burn DESTROYS zero-balance token accounts too (they're still closed/destroyed). Wait, does it? The burn checks that declared reserve ATAs are empty. But a NON-reserve zero-balance token account that's undeclared — does the burn destroy it? The burn's second loop checks `if acc.lamports() == 0 { continue; }` for remaining accounts, but only for DECLARED accounts. An undeclared zero-balance token account is invisible to the burn. When the vault is burned, the PDA becomes unsignable, so the zero-balance account is... well, it still exists but nobody can sign for it. It's not "destroyed" in the sense of losing value (it has 0 value), but its rent is locked. Actually the token account holds rent (~0.002 SOL). When the PDA is burned and unsignable, that rent is locked forever. So a zero-balance token account still has rent that gets stranded/destroyed.

But the co-signer DISCARDS zero-balance accounts (`if (amount !== '0')`). So it won't refuse a burn that destroys a zero-balance account's rent. Is this a problem? The value is just the rent (~0.002 SOL). Minor. But the prompt is asking what it mis-reads. The discard of zero-balance accounts means the scan doesn't see them. Actually, wait — is this a real issue? Let me reconsider. The `judgeRedemptionCoverage` checks that every `owned` holding is declared. If a zero-balance account is not in `owned`, it's not required to be declared. So the burn proceeds and the zero-balance account's rent is locked. This is a (tiny) value destruction that the co-signer blesses. But it's only rent. LOW.

Hmm, but actually there's a more important mis-read. Let me look again:

`account.data.readBigUInt64LE(64)` — this assumes the account data is at least 72 bytes. If a token account is malformed (0 data, or short), `readBigUInt64LE(64)` throws a RangeError. The `scanPda` function has no try/catch around this. So a malformed token account owned by the PDA would cause `scanPda` to throw, which propagates up and the tool refuses (fails closed). Actually, `inspect` doesn't catch it, so `main` catches it and prints FATAL, exit 9. That fails closed. OK, so malformed → fail closed. Good, but worth noting it's a crash rather than a clean refusal.

Wait, but there's a griefing angle: a stranger can create a malformed token account... no, `getTokenAccountsByOwner` only returns accounts owned by the specified token program. A 0-data account is owned by System program, not the token program, so it wouldn't be returned. Actually, `getTokenAccountsByOwner(pda, { programId })` returns token accounts owned by `programId`. A poisoned 0-data account at a derived ATA address is owned by System program (until initialized), so it wouldn't match `programId: TOK`. So `getTokenAccountsByOwner` wouldn't return it. So the readBigUInt64LE wouldn't hit it. OK.

But what about a Token-2022 account with extensions? The amount is still at offset 64 for Token-2022 (the base layout is the same, extensions are appended). So `readBigUInt64LE(64)` reads the base amount. For a confidential balance extension, the base amount might be 0 while there's real value. But the reserve mints are classic SPL, so this is about airdropped T22 tokens. The scan would read amount 0 for a confidential T22 account and discard it. Then the burn destroys it. But this is the known airdrop gap. Not new.

Now, **what value can a PDA hold that this scan does not see?** The prompt says the author knows about the airdrop race (don't re-file). Ask a different question: given a response the scan DOES get back, what does it mis-read or discard?

Let me think about what `getTokenAccountsByOwner` returns and what the scan discards:
- Discards amount == '0' accounts (rent locked on burn). LOW.
- **Does not read `delegate` or `close_authority`.** The scan only reads amount. But the burn checks delegates on declared accounts. The co-signer's coverage check only checks that holdings are declared, not that they're delegate-free. But the on-chain burn checks delegates. So if a declared account has a delegate, the burn refuses on-chain. So the co-signer doesn't need to check it. OK.

What about **native SOL in the PDA**? The scan doesn't check `pda.lamports`. The burn requires `asset_signer.lamports() == 0`. So if the PDA has lamports, the burn refuses unless swept. The co-signer doesn't scan PDA lamports. But the redemption must sweep them (the burn refuses otherwise). So the co-signer doesn't need to check — the on-chain burn does. But wait, the co-signer's job is to refuse BEFORE signing if something would be destroyed. PDA lamports are swept in the redemption, not destroyed. So OK.

Hmm, but actually — what if the PDA has lamports and the redemption does NOT sweep them? Then the burn refuses on-chain, and the Bank's signature is wasted (transaction fails). The co-signer would have signed a failing transaction. Not a theft, just a failed tx. The Bank doesn't lose anything (fees maybe). Not critical.

Now the DAS part: `getAssetsByOwner`. It reads `j.result?.items`. For each item, `if (it.burnt) continue; owned.push({ address: it.id, kind: 'asset' })`. 

What does it discard/mis-read?
- **It discards burnt assets.** `if (it.burnt) continue`. A burnt nested asset is already gone, so that's fine.
- **It only reads `it.id`.** It doesn't check whether the asset is one of OUR vaults or a foreign asset. But for coverage, any nested Core asset (foreign or ours) that's undeclared is destroyed. So treating all as holdings is correct (conservative).
- **The full-page refusal at limit 1000.** If DAS returns exactly 1000 items, it throws. But what if DAS returns fewer than the actual count due to pagination, but not a full page? E.g., DAS has a bug and returns 999 of 1500. The tool wouldn't know. But that's a DAS correctness issue, not a code issue.

The prompt asks: "The DAS full-page refusal at limit 1000. Is it the right guard, and is it the ONLY way that call can fail to answer?"

Let me think about other ways `getAssetsByOwner` can fail to answer:
- `j.error` → throws. Good.
- `j.result` is undefined/null → `j.result?.items || []` is `[]`, so `owned` gets no assets, and the length check `0 >= 1000` is false, so it returns empty. **This is a silent empty result.** If DAS returns a response with no `result` field (but no `error` either), the scan sees zero assets and the co-signer blesses a burn that might destroy nested assets. This is a FAIL-OPEN.

Wait, let me check. `const j = await r.json()`. If the RPC returns `{ jsonrpc: '2.0', id: 'c' }` with neither result nor error (malformed), then `j.error` is undefined (falsy), so no throw. `j.result?.items || []` is `[]`. The loop adds nothing. The length check is `0 >= 1000` false. Returns `[]`. So the coverage check passes (no holdings), and the Bank signs. **If DAS silently returns nothing, the co-signer blesses a burn that destroys everything.** This is a fail-open.

Is this reachable? A DAS provider could return a malformed response. Or the `getAssetsByOwner` method could be unsupported by the provider (some RPC providers don't support DAS). If unsupported, they might return an error (caught) or a weird result. Actually, if the method is unsupported, JSON-RPC returns an error (`method not found`), which is caught. But if the provider returns `{result: null}` or `{result: {}}`, it's a silent empty.

Actually, more concretely: `j.result?.items` — if `j.result` is `{ total: 5, items: undefined }` or `{}`, then `items` is undefined, `|| []` gives `[]`. Silent empty. Fail-open.

This is a real finding. The guard only checks for a full page (>= 1000), not for a missing/empty result that should have had content. But how would the tool know it "should have had content"? It can't, without a prior expectation. But the point is: a DAS response with no items and no error is treated as "the vault holds no assets," which is a fail-open for nested assets.

Hmm, but the tool has no baseline. It can't distinguish "vault holds nothing" from "DAS returned nothing." This is a fundamental limit. But the code could be more defensive: e.g., require `j.result` to be present and have a `total` field, and check `total` against `items.length`. If DAS provides a `total`, the tool could verify `items.length === total` (or that pagination is complete). Let me note this.

Actually, DAS `getAssetsByOwner` returns `{ total, limit, page, items, ... }`. The tool ignores `total`. If `total > items.length`, there are more assets than returned (pagination needed), but the tool only fetches page 1. The full-page guard catches `items.length >= 1000`, but if `total` is, say, 1500 and the provider caps `items` at 1000, the guard fires. But if the provider returns `items.length = 500` with `total = 1500` (weird), the guard doesn't fire. More realistically: the tool should check `j.result.total` and refuse if `total > items.length`. Let me note that the tool ignores `total`.

Actually, the more I think, the key fail-open is: **a DAS response with `result` present but `items` empty/missing and no error is treated as "no holdings."** Combined with the fact that the tool can't distinguish this from a genuinely empty vault, this is a structural weakness. But the specific code defect is not checking `j.result` existence / `total`.

Let me also reconsider: the prompt says "What value can a PDA hold that this scan does not see?" Beyond the airdrop race. Let me think:
- **Token accounts owned by the PDA but under a DIFFERENT token program** (not TOK or TOK22). The scan only checks TOK and TOK22. Are there other token programs? There's the possibility of other SPL token program forks, but in practice only these two matter. Not a real gap.
- **The PDA's own lamports** (native SOL). Not scanned, but handled on-chain.
- **Stake accounts, vote accounts, or other program accounts owned by the PDA.** A PDA can own... well, the PDA can't sign, so it can't create stake accounts. But someone could assign... no, you can't change an account's owner to a PDA without the PDA signing. Except token accounts (which can be created with the PDA as owner without its signature) and Core assets (which can be transferred to the PDA). So the only things a PDA can hold without signing are: token accounts, Core assets, and lamports. The scan covers token accounts and Core assets. Lamports handled on-chain. So the scan is structurally complete EXCEPT for the airdrop race and the DAS fail-open.

Wait, actually — can someone create a token account owned by the PDA under a token program that's NOT TOK or TOK22? Like a custom token program? Yes, in principle. But the burn's emptiness proof only checks TOK and TOK22 accounts (the reserve loop and the second loop both check `acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }`). So a custom-token-program account owned by the PDA would be invisible to BOTH the scan and the burn. But such tokens would be destroyed on burn. However, this is exotic — nobody's using a custom token program for real value here. And the scan matches the burn's visibility. Not a new gap worth filing.

Let me focus on the concrete mis-reads:
1. Zero-balance token accounts discarded → rent locked on burn. LOW.
2. DAS `result` missing/empty with no error → silent empty, fail-open for nested assets. HIGH (because it defeats the whole nested-asset protection).
3. DAS `total` ignored → if provider returns partial page below 1000 with more available, not caught. MEDIUM.

Actually, let me reconsider #2's severity. The co-signer's main value-add over the on-chain burn is nested-asset detection (the burn can't enumerate). If DAS can silently return empty, then the nested-asset protection is bypassable by... well, not by the customer (they don't control DAS). But by a DAS outage or a malicious/compromised RPC provider. The RPC is Helius (from `.env.local`). If Helius is compromised or has a bug, the co-signer blesses destroying nested assets. This is a real but somewhat external risk. I'd call it HIGH because the co-signer is the ONLY pre-sign control for nested assets, and it fails open on a malformed-but-not-error response.

Actually, let me reconsider. Is there a more concrete way? What if the customer knows the vault has a nested asset, and they submit the redemption when DAS is lagging? DAS indexes asynchronously. If the nested asset was JUST transferred in, DAS might not have indexed it yet. Then `getAssetsByOwner` returns no items for it, and the co-signer blesses. This is the "DAS lag" version of the airdrop race, but for nested assets. The author claims the co-signer "DOES close the nested-vault case in practice, because nesting requires the owner's own cooperation and does not happen between two slots by accident." But the owner IS the customer doing the redemption. So the customer CAN nest an asset and immediately redeem before DAS indexes it. Wait, but nesting requires transferring the inner asset to the outer vault's PDA. The customer owns both. They can do this in the SAME transaction as the redemption? No — the co-signer judges the transaction, and if the nesting is IN the transaction, the DAS scan (which is pre-transaction) wouldn't see it. But wait, the nesting would be a Core TransferV1 instruction in the transaction. The tool allows arbitrary instructions to Core! So the customer could:
1. Add a Core TransferV1 instruction transferring inner asset → outer vault's PDA (nesting it).
2. Then open, sweep, burn the outer vault.

The tool's shape check only refuses extra SEAL/BURN instructions. A Core TransferV1 is to Core, so it's allowed. The DAS scan (pre-transaction) doesn't see the nesting (it hasn't happened yet). The coverage check passes. The Bank signs. The transaction executes: nests the inner asset, then burns the outer vault, destroying the inner asset.

Wait, but why would the customer destroy their own inner asset? Maybe the inner asset is worthless to them but they want to... hmm. Actually, this doesn't gain them anything directly. They're destroying their own property. Unless the inner asset belongs to someone else? No, to transfer it they must own it.

But here's the thing: the customer could be destroying an asset that has value to extract something. Or it could be that the "inner asset" is a vault they bought and want to... no.

Actually, the more realistic attack: the customer nests someone else's... no, they can't transfer what they don't own.

Let me reconsider. The point is the tool ALLOWS a Core TransferV1 in the redemption transaction. This means the customer can change the vault's holdings DURING the transaction, after the scan. The scan is pre-transaction. So:
- Customer's vault PDA holds nothing (scan sees nothing).
- Customer adds a TransferV1 moving a valuable asset INTO the PDA, then burns. Destroys it. Self-harm, not theft.
- OR: Customer's vault PDA holds a nested asset. Scan sees it. Customer must declare it or be refused. If declared, burn refuses (VaultStillHoldsAVault). So they can't burn with a declared live asset. So they'd have to remove it first.

Hmm, the real issue is the REVERSE: the customer can add instructions that MOVE VALUE OUT of the PDA between scan and burn, but that's the sweep (legitimate). Or move value IN (self-harm). 

But wait — there's a subtler issue. The scan checks that all holdings are declared. The declared accounts are checked by the burn for emptiness. But between the scan and the burn, the customer could add an instruction that... let me think. The customer wants to destroy an undeclared holding to... why? Destroying your own holdings isn't profitable. UNLESS the holding is something they're obligated to preserve, or it belongs to a counterparty.

Actually, I think the realistic threat model is: the vault is sold/resold, and the buyer expects the vault to contain its reserve. But the redemption is done by the owner. If the owner is redeeming, they're burning the vault and taking the contents. Destroying extra contents is their choice. So the co-signer's protection is really about NOT destroying things the owner might not know about (airdrops) or things that can't be recovered (nested vaults where the inner owner is different).

Wait, nested vault: if vault A contains vault B, and vault B is owned by vault A's PDA, then vault B's CONTENTS belong to whoever owned vault B. If the owner of vault A redeems and burns A, vault B is destroyed, and vault B's contents are lost. If vault B was owned by a different person... but to nest B into A, someone had to own B and transfer it. If B was transferred into A's PDA by B's owner (maybe by mistake, maybe as a gift), then A's owner burning A destroys B's contents.

The co-signer protects against this by refusing to burn A if A's PDA holds B (undeclared). But if the customer adds a TransferV1 in the redemption transaction to move B OUT first... that's fine, B is saved. Or to move B IN and burn — that's destroying B, which the customer must own.

OK I think I'm overcomplicating. Let me step back. The concrete findings for R1 so far:

**R1-A (HIGH): The co-signer allows arbitrary non-SEAL/non-BURN instructions, including `mint_vault` to the MINT program where the Bank is a signer.** A customer can bundle a mint into a redemption and get the Bank's co-signature, bypassing the Bank's off-chain duties (refuse mints during proposal window, refuse charter mints without proof-of-burn). The tool's claim "the Bank sees the whole transaction and must refuse" is only enforced for SEAL/BURN, not MINT.

Actually, let me double-check: does the Bank's signature actually authorize the mint? The Bank signs the transaction via `partialSign`. For `mint_vault` to execute, the `bank` account must be a signer and must have signed. The Bank's signature is on the transaction. So yes. The customer includes `bank.publicKey` as the bank account in mint_vault, marks it as signer, and the Bank's partialSign satisfies it.

Let me also verify the tool doesn't check `tx.instructions` for MINT. It only filters opens (SEAL) and burns (BURN), and refuses extra SEAL/BURN. MINT instructions pass through. Confirmed.

**R1-B (HIGH): DAS fail-open.** `scanPda` treats a DAS response with no `result.items` and no `error` as "vault holds no assets." A malformed or empty DAS response (provider issue, lag, or a response shape without `items`) makes the coverage check pass, and the Bank signs a burn that destroys nested assets. The guard only catches `items.length >= 1000`, not missing/empty results. Also ignores `total`.

Let me reconsider whether this is truly fail-open in a reachable way. The most reachable version: **DAS indexing lag.** The customer nests an asset into the vault, then immediately (before DAS indexes the ownership change) runs the co-signer. `getAssetsByOwner` doesn't yet show the nested asset. Coverage passes. Bank signs. Transaction burns, destroying the nested asset. But again — the customer owned the nested asset (to nest it). So they're destroying their own. Unless... the nesting happened via a marketplace or a transfer from someone else. Hmm.

Actually, the cleanest fail-open: the RPC provider returns an error-ish response that isn't in `j.error`. E.g., HTTP 200 with `{result: null}`. Or the fetch succeeds but `r.json()` gives something unexpected. Let me focus on the code defect: no validation that `j.result` is a valid object with an `items` array, and no use of `total`. I'll frame it as: the scan cannot distinguish "vault holds nothing" from "DAS returned nothing," and the only guard is the full-page check. Evidence: submit a mock DAS response `{result: {}}` and observe `scanPda` returns `[]` without throwing.

**R1-C: `getTokenAccountsByOwner` encoding.** The scan calls `conn.getTokenAccountsByOwner(pda, { programId }, 'confirmed')`. The third argument is the commitment, but there's no encoding specified. The default encoding for `getTokenAccountsByOwner` in web3.js... let me recall. `getTokenAccountsByOwner(owner, filter, commitment)` — the default encoding is `jsonParsed`? Or base64? Actually, web3.js `getTokenAccountsByOwner` returns `RpcResponse<Array<{pubkey, account}>>` where `account.data` is a Buffer. The default encoding is `base64` I think, and web3.js decodes it to Buffer. So `account.data.readBigUInt64LE(64)` works. But if the encoding were `jsonParsed`, `account.data` would be an object, not a Buffer, and `readBigUInt64LE` would fail. Let me check web3.js. Actually, `getTokenAccountsByOwner` with no encoding param defaults to `jsonParsed`? No. Let me recall the signature: `getTokenAccountsByOwner(owner: PublicKey, filter: TokenAccountsFilter, commitment?: Commitment): Promise<RpcResponseAndContext<Array<{pubkey: PublicKey, account: AccountInfo<Buffer>}>>>`. The account info has `data: Buffer`. web3.js requests base64 encoding by default for this method and decodes to Buffer. So `readBigUInt64LE` works. OK. But this is an assumption about web3.js behavior. If the default changed, it'd break. Worth a note but not a finding.

Actually, wait. Let me reconsider. There's a real issue: `getTokenAccountsByOwner` with `{ programId }` filter. This returns all token accounts owned by `pda` under that program. But it PAGINATES. Does web3.js `getTokenAccountsByOwner` handle pagination? No! It returns a single page (max 1000? or whatever the RPC limit is). Actually, `getTokenAccountsByOwner` doesn't paginate in web3.js — it returns all matches up to the RPC's internal limit. Hmm, actually the RPC method `getTokenAccountsByOwner` returns all accounts (no pagination param). But there might be a limit. Let me not overclaim. The DAS one has explicit pagination; the token one doesn't. If a PDA had >N token accounts, some RPCs might truncate. But that's exotic. I'll mention it lightly or skip.

Let me reconsider the zero-balance discard (R1 low). Actually, I realize there might be a more important version. The scan discards `amount === '0'`. But consider a reserve ATA that's empty. The burn requires it declared and empty. The co-signer's coverage check: if the reserve ATA is empty, it's not in `owned`, so not required to be declared. But the burn REQUIRES every reserve mint's ATA to be declared (ReserveNotDeclared). So the burn would refuse if the reserve ATA isn't declared, regardless of the co-signer. So the co-signer's discard of empty accounts doesn't cause the burn to miss them — the burn independently requires them. So the only accounts affected by the discard are NON-reserve empty accounts, whose rent gets locked. LOW.

Now, **`judgeRedemptionCoverage`**:
```javascript
export function judgeRedemptionCoverage(owned, declared) {
  const bad = []
  const seen = new Set(declared)
  for (const h of owned) {
    if (seen.has(h.address)) continue
    bad.push(...)
  }
  return { ok: bad.length === 0, reasons: bad }
}
```
This checks every owned holding is declared. But it does NOT check the reverse: that every declared account is actually owned by the PDA. A customer could declare accounts they don't own. But the burn checks `ReserveNotOurs` (owner == pda) for reserve accounts, and for declared non-reserve accounts, the second loop checks `if Pubkey::new_from_array(o) == pda`. So declared accounts not owned by the PDA are... let me check. The second loop: `for acc in ctx.remaining_accounts.iter() { if acc.owner == &MPL_CORE_ID { ... } if acc.lamports() == 0 { continue; } if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; } let d = ...; if d.len() >= TOKEN_ACCOUNT_LEN { let o = owner; if o == pda { checks } } }`. So a declared account NOT owned by the PDA is just skipped (no check). It doesn't cause a refusal. So declaring extra accounts you don't own is harmless on-chain. The co-signer doesn't need to check. OK.

But wait — there's a subtle issue. The coverage check ensures owned ⊆ declared. But what if the customer declares a bunch of junk accounts AND the real holdings? The burn checks the real holdings (reserve ATAs must be declared and empty). Junk declared accounts are skipped. So no issue.

Now, **the shape judgement's account indices**. `open.accounts?.[0]` is asset, `[2]` is owner, `[3]` is bank. `burn.accounts?.[0]` asset, `[2]` owner, `[3]` bank. These mirror the on-chain account order. Let me verify against the programs.

SEAL `OpenForRedemption`:
```rust
pub vault_asset: ... // 0
pub collection: ...  // 1
pub owner: Signer    // 2
pub bank: Signer     // 3
pub payer: Signer    // 4
pub config: ...      // 5
pub seal: ...        // 6
pub mpl_core: ...    // 7
pub instructions: ...// 8
pub system_program:  // 9
```
Yes, asset=0, owner=2, bank=3. Matches.

BURN `BurnVault`:
```rust
pub vault_asset: // 0
pub collection:  // 1
pub owner:       // 2
pub bank:        // 3
pub asset_signer:// 4
pub payer:       // 5
pub config:      // 6
pub seal_config: // 7
pub instructions:// 8
pub mpl_core:    // 9
pub system_program: // 10
```
Yes, 11 fixed accounts, asset=0, owner=2, bank=3. `BURN_FIXED_ACCOUNTS = 11`. Matches. `declared = burn.accounts.slice(11)`. Good.

Now, **what happens if these drift?** The prompt asks: "`BURN_FIXED_ACCOUNTS = 11` and the account indices 0 / 2 / 3 are hard-coded mirrors of two programs' account lists. What happens if they drift, and does it fail open or closed?"

If BURN's account list changes (e.g., an account is inserted before position 2), then the co-signer would read the wrong account as owner/bank. Let's say BURN inserts an account at position 1. Then owner moves to 3, bank to 4. The co-signer reads `burn.accounts[2]` as owner (which is now something else) and `[3]` as bank (now owner). It would compare these to the open's owner/bank. Likely mismatch → refusal (fail closed). But it depends. If the drift happens to align, it could fail open. But the on-chain programs also cross-check (SEAL and BURN pin each other's account indices, and a drift breaks the pairing → fail closed on-chain). So the co-signer drift would likely fail closed or be caught on-chain. The comment says "SEAL's forward match would break first, which fails closed." So the on-chain pairing fails closed. The co-signer is a pre-sign check; if it mis-reads but the on-chain still enforces, the worst case is the Bank signs a transaction that then fails on-chain (no theft) or the Bank refuses a valid one (no theft). So drift fails safe-ish. But the co-signer could theoretically bless a bad transaction if the drift makes it mis-read in a way that passes. However, the on-chain burn would still enforce. So no theft. I'll note it as LOW/informational: the hard-coded indices are a maintenance hazard but fail closed due to on-chain enforcement.

Actually, wait. There's a scenario: if the co-signer's `BURN_FIXED_ACCOUNTS` is too SMALL (say 10 instead of 11), then `declared = burn.accounts.slice(10)` would include one extra fixed account as "declared." This would make `declared.length` larger than `stated` (the u8 in data), causing a refusal (stated !== declared.length). Fail closed. If too LARGE (12), `declared` would be missing one, and `stated !== declared.length` → refusal. Fail closed. So the count check catches fixed-account drift. Good. Unless the customer also adjusts `stated` to match. But then the declared set is wrong, and coverage might pass incorrectly. Hmm. Let me think: if BURN_FIXED_ACCOUNTS is 12 (too big) but the real fixed is 11, then `declared = accounts.slice(12)` drops the first real declared account. If the customer sets `stated = declared.length` (matching the wrong slice), the count check passes. Then coverage checks owned ⊆ declared. If the dropped account was a holding, coverage would fail (holding not declared). If not a holding, coverage passes. But on-chain, the burn uses the REAL fixed=11, so `declared_onchain = accounts.slice(11)`, which includes the dropped account. The burn checks `remaining_accounts.len() == declared` (the u8). The u8 the customer set matches the co-signer's wrong count, not the on-chain count. So on-chain `remaining_accounts.len()` (which is `accounts.len() - 11`) vs `declared` (u8 = `accounts.len() - 12`). Mismatch → DeclarationMismatch → fail closed on-chain. So drift fails closed. Good. I'll note this as LOW (maintenance hazard, fails closed).

Now, **the Bank read from SEAL config vs BURN's own copy.** The prompt: "It reads the Bank from the SEAL config on chain through `pinnedAccountData`. BURN keeps its OWN copy of `bank`. Can those disagree, and what happens if they do?"

BURN's `burn_vault` reads the SEAL config and checks `require_keys_eq!(Pubkey::new_from_array(b), cfg.bank, BurnError::WiringDiverged)` where `b` is the SEAL config's bank and `cfg.bank` is BURN's own bank. So on-chain, BURN enforces that SEAL's bank == BURN's bank. If they disagree, the burn refuses (WiringDiverged). So they can't disagree at burn time. The co-signer reads SEAL's bank. If BURN's bank differs, the co-signer would check against SEAL's bank, but the on-chain burn would refuse (WiringDiverged). So the Bank signs a failing tx. No theft. But the co-signer doesn't check BURN's bank. Actually, the co-signer checks `burn.accounts[3] === cfg.bank` where cfg.bank is SEAL's bank. And on-chain, BURN checks `ctx.accounts.bank.key() == cfg.bank` (BURN's bank) AND `seal_config.bank == cfg.bank`. So if SEAL bank != BURN bank, on-chain refuses. The co-signer uses SEAL bank. So the co-signer's check is consistent with what on-chain will enforce via the SEAL config cross-check. Actually, the co-signer should ideally check against BURN's bank too, but since on-chain enforces agreement, it's fine. If they disagree, everything halts (fail closed). I'll note this as not a vulnerability but worth stating: disagreement fails closed on-chain.

Hmm wait, but there's a rotation scenario. Bank rotations in SEAL and BURN are separate (each has its own update_config/apply_pending). If someone rotates SEAL's bank but not BURN's bank, they disagree, and all redemptions halt (WiringDiverged). That's a DoS but fail-closed. The alarm watches both `seal.bank` and `burn.bank` and would detect drift. OK.

Now, **`judgeRedemptionTx` does not verify the `open` actually matches the SEAL on-chain expectations beyond the discriminator.** It checks the discriminator and account positions. But it doesn't verify, e.g., that `open.accounts[5]` is the SEAL config, or `[6]` is the seal PDA, etc. So a customer could construct an `open_for_redemption` instruction with the right discriminator and asset/owner/bank at positions 0/2/3 but WRONG other accounts. Would that matter? On-chain, SEAL's `open_for_redemption` uses Anchor's account validation (`#[account(seeds = ...)]`), so wrong config/seal accounts would fail on-chain. So the co-signer doesn't need to check them. But the co-signer's job is to refuse BEFORE signing. If it signs a tx that fails on-chain, the Bank wastes a signature (and maybe fees). Not a theft. But there's a subtler issue: what if the customer passes a WRONG `collection` account at position 1? On-chain SEAL checks `require_keys_eq!(ctx.accounts.collection.key(), collection, WrongCollectionAccount)`. So it'd fail. OK.

But here's a real one: **the co-signer doesn't verify the `asset` is actually one of OUR vaults (in the collection).** It reads `asset = open.accounts[0]`. It doesn't check that this asset belongs to the CBOB collection. On-chain, SEAL checks `read_core_asset` and `require_keys_eq!(collection, ctx.accounts.config.collection, ForeignVault)`. So a foreign asset would fail on-chain. But the co-signer computes the PDA from `shape.asset` and scans it. If the asset is foreign, the PDA is a foreign PDA, and the scan might see nothing, coverage passes, Bank signs. Then on-chain refuses (ForeignVault). So the Bank signs a failing tx. Not a theft. But it means the co-signer could be tricked into signing for a foreign asset — but on-chain saves it. LOW.

Actually, more importantly: the co-signer scans the PDA of `shape.asset`. If the customer passes a foreign asset with an empty PDA, coverage passes. But the burn is for the foreign asset, which on-chain refuses. So no harm. But the co-signer's "clean" verdict is misleading. Minor.

Let me now think about **whether the co-signer checks that the `burn` is actually the terminal instruction / that there's nothing after it.** The tool checks open before burn (index). But it doesn't require burn to be last. On-chain, SEAL requires the burn to appear AFTER the open (forward scan). BURN requires the open BEFORE it (backward scan). Neither requires burn to be last. The tool matches. A customer could put instructions after the burn. After the burn, the vault is destroyed. What could an instruction after the burn do? The vault's PDA is now unsignable. The customer's other instructions execute. They could be anything (to other programs). The Bank signs them. E.g., a `mint_vault` after the burn. Same as R1-A. So R1-A covers it.

Now let me reconsider R1-A's severity and whether there's a WORSE instruction than mint_vault. Let me enumerate all instructions where the Bank is a signer:
- SEAL: `open_for_redemption` (bank signer). Checked.
- BURN: `burn_vault` (bank signer). Checked.
- MINT: `mint_vault` (bank signer). NOT checked.
- Any others? Let me scan. SEAL `initialize` (admin signer, not bank). `update_config` (admin). BURN `initialize`/`update_config` (admin). MINT `initialize` (admin), `update_wiring` (admin), `set_round` (governance), `sweep_sol_for_swap` (swap_operator), `split_revenue` (none), `set_collection_royalties` (admin+governance), `set_paused` (admin). GOV: none use bank. So the ONLY instruction besides open/burn where the Bank is a signer is `mint_vault`. Confirmed. So R1-A is specifically about mint_vault.

Is there a way mint_vault could be harmful beyond bypassing duties? Let me think. The customer mints a vault. They pay the price (goes to revenue). They become owner. The Bank co-signs. If a proposal is open, the Bank should refuse (duty). Bypassed. If it's a charter round (price 0), the Bank should refuse without proof-of-burn. Bypassed. So the customer gets a vault they shouldn't have gotten (governance vote, future distribution). This dilutes other holders. But bounded by cap and round. I'll call it HIGH because it defeats a stated control and the co-signer's purpose, but note the monetary harm is bounded.

Actually, wait. Let me reconsider. Is there an even simpler issue: **the tool doesn't check that the transaction doesn't ALSO contain instructions that spend the Bank's signature in ways that could be replayed?** No, a signature is per-transaction (includes blockhash). Not replayable.

Let me also consider: **the tool signs whatever base64 is given, after judging. But between `inspect` and `partialSign`, it re-parses `Transaction.from(argv[i+1])`.** It parses the SAME base64 twice. So no TOCTOU between inspect and sign (same input). Good. But note: `inspect` returns a verdict, and `main` signs the same base64. There's no re-inspection of the exact object being signed, but since it's the same base64, it's the same transaction. OK.

Wait, actually there IS a subtle issue. In `inspect`, it does `const tx = Transaction.from(...)` and extracts `tx.instructions`. In `main`, it does `const tx = Transaction.from(...)` again and `tx.partialSign(bank)`. Both from the same base64. So the signed tx is the one inspected. Good. No gap.

But: **`Transaction.from` with `requireAllSignatures: false`?** No, `Transaction.from` just deserializes. The customer's base64 might already contain OTHER signatures (e.g., the customer's own signature). `partialSign(bank)` adds the Bank's. Then `serialize({requireAllSignatures: false})`. So the output has all signatures. Fine.

Hmm, one more: **the tool doesn't verify the recentBlockhash or that the transaction isn't expired.** Not a security issue for the Bank (it just signs; if blockhash is old, tx won't land). Minor.

Let me also reconsider: **does the tool check that the owner signature is present?** The owner must sign open and burn. The tool checks `owner` is on-curve but doesn't check that the owner actually signed the transaction. But that's the customer's problem — if the owner didn't sign, the tx fails on-chain. The Bank signing a tx where the owner didn't sign just means the tx fails. Not a theft. But actually, the customer IS the owner (they're redeeming their own vault). So they'll sign. Fine.

Now, let me reconsider the **fee payer** issue more carefully. If the customer sets `feePayer = bank.publicKey`, then the Bank is the fee payer. The Bank's `partialSign` provides the fee payer signature. The Bank pays the fee (~5000 lamports + priority). This is a tiny cost. But could it be used for griefing at scale? The customer could submit many redemptions with the Bank as fee payer, draining the Bank's SOL. But each redemption burns a vault (the customer's own), so it's limited by the customer's vaults. Minor grief. LOW. But the tool should check `tx.feePayer` is not the Bank, or at least not assume. Actually, the tool never checks feePayer at all. Let me note it as LOW.

Hold on, let me reconsider. There's actually a more important fee-payer angle. If the Bank is the fee payer, and the transaction FAILS, the Bank still pays the fee. But more importantly, the fee payer is the FIRST signer. If the customer sets feePayer = bank, then the Bank's signature is the fee payer. The Bank signs. But the customer ALSO needs to sign (as owner). So the tx has 2+ signatures. Fine. The Bank paying fees is the issue. LOW.

Let me now also reconsider **whether the co-signer should refuse transactions where the Bank is the fee payer or where there are unexpected signers.** The prompt asks to enumerate signer sets. The tool doesn't inspect `tx.signatures` or the signer flags beyond what's in the instruction accounts. So it doesn't know the full signer set. A customer could add extra signers (e.g., for a mint_vault's asset/owner/payer). The tool doesn't check. This is part of R1-A.

OK, I think R1's main findings are:
- R1-A (HIGH): arbitrary non-SEAL/BURN instructions allowed, specifically `mint_vault` gets the Bank's co-signature, bypassing Bank duties. Also fee-payer grief (LOW sub-point).
- R1-B (HIGH): DAS fail-open on missing/empty `result` (no items, no error) → blesses destroying nested assets; ignores `total`.
- R1-C (LOW): zero-balance token accounts discarded → rent locked on burn.
- R1-D (LOW): hard-coded account indices / BURN_FIXED_ACCOUNTS drift fails closed (on-chain saves it), maintenance hazard.
- R1-E (INFO): versioned transactions — `Transaction.from` is legacy-only; need to confirm it fails closed. Also the tool can't co-sign versioned txs (future 4th mint needs them).

Wait, I should reconsider R1-B more. Let me re-read the exact code:

```javascript
const r = await fetch(rpcUrl(), { ... })
const j = await r.json()
if (j.error) throw new Error(`DAS getAssetsByOwner: ${JSON.stringify(j.error)}`)
for (const it of (j.result?.items || [])) {
  if (it.burnt) continue
  owned.push({ address: it.id, kind: 'asset' })
}
if ((j.result?.items || []).length >= 1000) throw new Error('DAS returned a full page...')
```

So if `j.result` is undefined, `j.result?.items` is undefined, `|| []` is `[]`. No error thrown. Returns empty. Fail open. Confirmed.

Also, if the fetch itself fails (network error), `r.json()` throws, propagates up, tool refuses (fail closed). Good. If `r` is a non-200 HTTP with a JSON error body, `j.error` might be set. If non-JSON, `r.json()` throws (fail closed). Good. So the fail-open is specifically a well-formed JSON response with no error and no/empty items.

Is this reachable in practice? A DAS provider returning `{result: {total: 0, items: []}}` for a PDA that actually owns assets would be a provider bug or lag. The author's stated mitigation for nested assets relies on this scan. If the scan can silently return empty, the mitigation is weaker than claimed. I'll frame R1-B as: the scan has no positive assertion that DAS answered about THIS owner; an empty items array is indistinguishable from "no assets." Suggest checking `j.result` exists, is an object, and if a `total` field exists, that `items.length` accounts for it (or refuse when `total > 0 && items.length === 0`). Actually the cleanest: refuse if `j.result` is not an object with an `items` array. And if `total` is present and `total !== items.length` (for a single page with limit 1000), refuse.

Hmm, but `total` could legitimately be 0. The issue is distinguishing "DAS says 0" from "DAS said nothing." If DAS returns `{result: {total: 0, items: []}}`, that's DAS saying 0. The tool can't know if DAS is wrong. So the fail-open is really about DAS being wrong/lagging, which is the airdrop-race-ish problem. But the CODE defect is not validating the response shape. Let me be precise: the code treats a missing `result` (protocol-level non-answer) the same as `result.items = []` (DAS answering "none"). A missing `result` with no `error` is a malformed JSON-RPC response and should be refused. That's the fixable defect. DAS-lag is the known open problem.

Let me separate:
- R1-B1 (code defect): missing/malformed `result` treated as empty → should refuse. Fixable.
- The airdrop/DAS-lag race is known-open, don't re-file.

Now let me move to **R2: bank/lock.mjs break rewrite.**

The new break uses atomic `rename`. Let me read carefully.

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

The idea: to break a stale lock, atomically rename `file` → `stolen` (unique name with my token). Only one racer can win the rename (the loser gets ENOENT). Then read the renamed file to check if it's the lock I expected (held.token). If yes, claim a fresh lock. If no (someone replaced it), put it back.

Let me analyze the interleavings.

**TWO racers, A and B, both see the same stale lock with token T.**

Both pass the re-read (`still.token === held.token === T`). Both compute their own `stolen` name (unique per token: A uses token_A, B uses token_B). Both attempt `renameSync(file, stolen_A)` and `renameSync(file, stolen_B)`.

`rename` is atomic: only ONE succeeds. Say A succeeds: `file` → `stolen_A`. B's rename gets ENOENT (file is gone) → B returns lostRace. Good. So exactly one wins the rename. A then reads `stolen_A`, sees token T === held.token, claims `file` with its payload, unlinks `stolen_A`, returns ok. B lost. Exclusive. 

So the two-racer case is fixed. The atomic rename ensures only one takes the lock away.

**But wait — the restore path.** Let me think about the scenario where the rename succeeds but the renamed file is NOT the expected token (takenToken !== held.token). When does this happen? The re-read confirmed `still.token === held.token` just before the rename. So the file at `file` had token T. Then I rename it to `stolen`. The renamed file should have token T. So `takenToken` should be T. When would it differ?

The comment says: "a racer that won its own break in that gap left a FRESH lock here." Let me reconstruct. The gap is between the re-read and the rename. In that gap:
- I re-read `file`, see token T (stale).
- Another process C breaks the lock (renames `file` → `stolen_C`, claims a fresh `file` with token C).
- Now `file` has token C (fresh).
- I rename `file` → `stolen_A`. This takes C's FRESH lock!
- I read `stolen_A`, see token C ≠ T. So I detect I stole a replacement.
- I try to put it back: `openSync(file, 'wx')`. But C's lock is... wait, C claimed `file` already. So `file` exists (C's lock). My `openSync(file, 'wx')` fails with EEXIST (caught, swallowed). So I don't restore (C's lock stands, but I have C's lock in `stolen_A`!). Then I `unlinkSync(stolen)` — **I DELETE `stolen_A` which contains C's lock data!** But C's lock is still at `file` (C claimed it). Wait, no. Let me re-trace.

Hold on. Let me re-trace very carefully. This is the critical path.

Timeline:
1. Stale lock at `file` with token T (dead holder).
2. A and C both read it, both see token T, both pass re-read.
3. C wins the rename first: `rename(file, stolen_C)`. Now `file` is gone, `stolen_C` has token T.
4. C reads `stolen_C`, sees T === held.token (C's held.token is T). Good.
5. C calls `claim(file, payload_C)`. `claim` does `linkSync(tmp_C, file)`. `file` doesn't exist, so link succeeds. Now `file` has C's payload (token C). C unlinks tmp_C.
6. C unlinks `stolen_C`. C returns ok, holds lock with token C.

Now A (slightly behind):
3'. A attempts `rename(file, stolen_A)`. But at this point, has C already renamed? If C renamed at step 3, then `file` was gone until C re-created it at step 5. There's a window between step 3 (file gone) and step 5 (file re-created). If A's rename lands in that window, A gets ENOENT → A loses. Good.

But if A's rename lands AFTER step 5 (C re-created `file` with token C), then A renames `file` (token C) → `stolen_A`. Now A has C's fresh lock in `stolen_A`, and `file` is gone.
4'. A reads `stolen_A`, sees token C ≠ T (A's held.token). A detects theft.
5'. A tries to restore: `openSync(file, 'wx')`. `file` is currently GONE (A renamed it away). So `openSync(file, 'wx')` SUCCEEDS (creates `file`). A writes `stolen_A`'s bytes (token C) into `file`. So `file` now has token C again. A closes fd.
6'. A `unlinkSync(stolen_A)`. Cleans up.
7'. A returns lostRace.

So after this: `file` has token C (C's lock restored). C holds the lock. A lost. This seems OK! The restore worked because `file` was gone when A restored.

But wait — there's a race in the restore. Between A renaming `file` away (step 3') and A restoring it (step 5'), `file` is GONE. In that window, another process D could `claim(file)` (create a fresh lock). Then A's `openSync(file, 'wx')` would fail (EEXIST) because D's lock is there. A swallows the error and does NOT restore. Then A unlinks `stolen_A` (which had C's token C data). Now: D holds `file` (token D). C's lock data is deleted (stolen_A unlinked). But C thinks it holds the lock (token C)! C's lock was at `file`, A renamed it away, D created a new `file`, A failed to restore C's, and deleted the copy. So C's lock is GONE, and D holds a different lock. **Now both C and D think they hold the lock.** Double payment!

Wait, let me re-examine. C claimed `file` with token C at step 5. Then A renamed `file` → `stolen_A` (taking C's lock). Now `file` gone. D claims `file` (token D). Now `file` has token D. A tries to restore C's lock: `openSync(file, 'wx')` → EEXIST (D's lock). A swallows, doesn't restore. A unlinks `stolen_A` (C's lock data gone). 

Now state: `file` = token D (D holds). C's lock (token C) is destroyed. C is running its money job thinking it holds the lock. D is running its money job holding the lock. **Both C and D run concurrently → double payment.**

But wait — does C detect that its lock was stolen? C's `withLock` runs `fn`, then in `finally` calls `releaseLock(file, C.token)`. `releaseLock` reads `file`, sees token D ≠ C.token, returns false, and `withLock` prints a WARNING "did NOT release ... Another runner holds it now; this run may have been running beside it." So C detects AT THE END that it was running beside someone. But by then, C has already done its money moves. So the double payment happened; the warning is post-hoc.

So the restore path has a window where a third process D can claim the lock, causing the restore to fail, leaving C and D both holding. This is the "THREE racers" case the prompt asks about.

Let me re-read the prompt: "Is the new break actually exclusive? Write out the interleavings. TWO racers, and then THREE." and "The restore path. It re-creates the lock with an exclusive `wx` open and swallows the failure. What is true of the filesystem between the rename and the restore, and what can another process do in that interval?"

So YES, this is exactly the finding. Between A's rename (taking C's lock) and A's restore attempt, `file` is absent. Another process D can claim it. Then A's restore fails (EEXIST), A swallows it and deletes the copy of C's lock. Result: C and D both believe they hold. Double payment.

But let me check: is this window reachable? It requires:
- C breaks a stale lock and claims `file` (token C).
- A, who also passed the re-read of the ORIGINAL stale lock (token T), renames `file` AFTER C re-created it.

For A to pass the re-read seeing token T, A must have re-read BEFORE C's rename. But A's actual `rename` happens AFTER C re-created `file`. So the sequence is:
- A re-reads `file` → token T. (before C acts)
- C re-reads `file` → token T.
- C renames `file` → `stolen_C`. (file gone)
- C claims `file` → token C. (file back, token C)
- A renames `file` → `stolen_A`. (takes C's lock, file gone)
- A reads `stolen_A` → token C ≠ T. Detects theft.
- D claims `file` → token D. (file back, token D)  [D could be a fresh process that sees no lock]
- A tries restore `openSync(file, 'wx')` → EEXIST (D's). Swallows.
- A unlinks `stolen_A` (C's lock destroyed).
- Now C holds (thinks), D holds (actually). Double.

Wait, but D claiming `file` — D would be a process calling `acquireLock`. D first tries `claim(file, payload_D)`. If `file` is absent (A renamed it away), claim succeeds. So D holds. Yes.

Actually, even simpler: D doesn't need to be breaking a stale lock. D is a fresh runner. It calls `acquireLock`. `claim(file)` — if `file` is absent, it creates and returns ok. So during the window where A has renamed `file` away and hasn't restored it, a fresh D can claim the lock. Then A's restore fails.

So the window is: from A's `renameSync(file, stolen_A)` to A's `openSync(file, 'wx')`. This is a few syscalls (read stolen, then open). Microseconds to milliseconds. Small, but real. And this is EXACTLY the double-payment the lock exists to prevent.

Moreover, even WITHOUT D: after A restores C's lock and unlinks stolen_A, we're back to C holding. That's fine. But the window for D is real.

Actually, let me reconsider whether C is really "holding" in a way that matters. C claimed `file` with token C and returned ok from acquireLock. C then runs its money job. Meanwhile A renamed C's lock away. C's lock file is gone (renamed to stolen_A). But C is still running. D claims a fresh lock. D runs. So C and D run concurrently. Yes, double payment.

The fundamental issue: **the lock file's existence is the lock, and it can be renamed away from under a live holder.** The atomic rename fixed the "two breakers both win" case, but introduced "a breaker can rename away a LIVE holder's lock." The token check after rename catches that you took the wrong lock, but the restore is racy and can fail, and during the window the lock is absent so a new claimer can enter.

The author's header admits: "A microsecond TOCTOU remained between the re-read and the unlink. The durable answer is a lock nobody has to break — an OS lease on an open fd — and that is recorded as the next step rather than half-built here." Wait, but the round-14 comment says "ROUND 14 CLOSED THE TOCTOU THIS PARAGRAPH USED TO ADMIT." Let me re-read.

The header now says:
```
* ROUND 14 CLOSED THE TOCTOU THIS PARAGRAPH USED TO ADMIT. The break is now a
* single atomic `rename` to a name only this process knows, so two racers can
* never both take the lock out of the way. What follows described the old
* narrowing, and is kept because the reasoning is still why the re-read is there.
*
* A microsecond TOCTOU remained between the re-read and the unlink. The durable
* answer is a lock nobody has to break — an OS lease on an open fd — and that
* is recorded as the next step rather than half-built here.
```

So the header claims round 14 closed the TOCTOU. But the TOCTOU it closed was "two racers both unlink." It did NOT close the "rename away a live holder's lock + racy restore" TOCTOU. In fact, it INTRODUCED the restore path which has its own TOCTOU. So the header's claim "ROUND 14 CLOSED THE TOCTOU" is overstated. The durable answer (fd lease) is still not built.

Actually, let me reconsider. The old TOCTOU was: A and B both see stale T, A unlinks+claims, B unlinks (deletes A's fresh lock)+claims. Both hold. The rename fixes this because only one can rename the stale lock away. BUT the rename creates a NEW problem: the rename doesn't distinguish stale from fresh. If A re-reads stale T, but by the time A renames, C has already broken it and created a fresh lock, A renames away C's FRESH lock. The token check catches this, but the restore is racy.

So the rename narrowed the original TOCTOU but the break is STILL not exclusive in the three-racer case. The header saying "ROUND 14 CLOSED THE TOCTOU" is misleading — it closed ONE toctou and opened another (smaller?) one.

Let me assess severity. This is a money lock. The window is small (microseconds between rename and restore), and requires three racers with specific timing. But the consequence is double payment. The author explicitly says the durable fix (fd lease) is "the next step rather than half-built here." So the author acknowledges it's not fully fixed. But the header ALSO says "ROUND 14 CLOSED THE TOCTOU" which contradicts. This is both a real residual vulnerability AND a comment/claim drift (R4 territory).

Let me also check `releaseLock`, `readLedger`, `writeLedger`, marker, `withLock` finally, per the prompt.

`releaseLock`:
```javascript
export function releaseLock(file, token) {
  let held = null
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (e) { return e.code === 'ENOENT' }
  if (!token || held?.token !== token) return false
  try { fs.unlinkSync(file) } catch { /* already gone */ }
  return true
}
```
This reads the lock, checks token, unlinks. There's a TOCTOU between read and unlink: between reading (token matches) and unlinking, another process could break the lock and create a new one. Then my unlink deletes the NEW one. But this requires my lock to be broken (stale) while I'm releasing, which means I was very slow. Edge case. The unlink is unconditional after the token check. If the lock was replaced between read and unlink, I delete the replacement. But the token check just passed on MY token, so the replacement would have to happen in the microsecond window. Rare. This is the same class. LOW.

Actually, more importantly: `releaseLock` returns `true` if `e.code === 'ENOENT'` (lock already gone). So if my lock was stolen, releaseLock returns true (because file is ENOENT), and withLock doesn't warn. Wait: `catch (e) { return e.code === 'ENOENT' }`. If the file is gone (ENOENT), returns true. So withLock's finally: `if (!releaseLock(...))` — if releaseLock returns true (file gone), no warning. But if my lock was stolen and replaced by D, then `readFileSync` succeeds (D's lock), `held.token !== token`, returns false → withLock warns. Good. But if my lock was stolen and NOT replaced (file gone), releaseLock returns true, no warning. But that's the case where the file is just gone. Hmm. Minor.

`readLedger` / `writeLedger` / marker: these look robust. `writeLedger` writes temp, fsync, then marker, then rename. Wait, let me re-read:
```javascript
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
The marker is written BEFORE the rename. The comment explains: if marker written after rename and it fails, you'd have a ledger with no marker. Written first, the only error is refusing a fresh start. This seems fine. But note: the marker write is NOT fsync'd and not atomic. If the marker write partially fails... it's a small file. And `fs.writeFileSync(marker, ...)` — if it throws, the whole writeLedger throws, and the rename doesn't happen, so the ledger isn't updated. That's fine (the old ledger stands). But the tmp file is left behind. Minor cleanup issue, not a payment issue.

Actually, wait: there's a subtle issue. The tmp filename is `.${basename}.tmp${process.pid}`. If two processes write the same ledger concurrently... but they hold the lock, so only one writes. And the pid makes it unique per process. But if the same process writes twice concurrently (it doesn't), fine. OK.

The marker: `if (marker && !fs.existsSync(marker)) fs.writeFileSync(marker, ...)`. It only writes the marker if it doesn't exist. So the marker is written once. If the marker exists but the ledger is deleted, readLedger refuses. Good.

`withLock` finally: releases the lock. If release fails, warns. Discussed.

So the main R2 finding is the three-racer restore-path double-payment. Let me also note the header overclaim ("CLOSED THE TOCTOU").

Let me reconsider: is the two-racer case REALLY fixed? Let me re-examine. A and B both see stale T. Both re-read T. Both rename. Only one rename succeeds (atomic). Say A. B gets ENOENT → lostRace. A reads stolen_A = T, claims, done. So two racers: exclusive. Yes, fixed.

But what about: A and B both see stale T. A re-reads T, B re-reads T. A renames (wins). B's rename: at this instant, has A re-created `file`? A renames file→stolen_A (file gone). A then reads stolen_A, then claims file (re-creates). B's rename could land:
- Before A re-creates: B gets ENOENT → loses. Good.
- After A re-creates (token A): B renames file (token A) → stolen_B. B reads stolen_B = token A ≠ T. B detects theft, tries to restore. openSync(file, 'wx') — file is gone (B renamed it). So creates file, writes token A back. Unlinks stolen_B. B loses. A still holds. Good (assuming no third process D in the window).

So even the two-racer case has the restore window, but with only two racers, after B restores A's lock, A holds and B lost. No double. The double requires a THIRD process to claim during B's restore window. So THREE racers needed for the double payment. Matches the prompt.

Actually, wait. Let me reconsider the two-racer restore. B renames A's fresh lock away. Now file gone. B restores it (openSync wx succeeds since file gone). Now file has token A again. But A is running. A's lock is restored. Fine. But during B's rename→restore window, file was gone. If there's no third process, nothing claims it. So A's lock is briefly absent then restored. A doesn't notice (A isn't re-reading its lock during execution). So no double with two racers. With three (D claims in the window), double. Confirmed.

So R2 finding: **three-racer interleaving on the restore path can double-pay.** Severity: it's a money lock, but requires 3 concurrent racers and microsecond timing. The author admits the durable fix isn't built. I'd call it HIGH (because double payment of real funds) but note the low probability and that the author partially acknowledges it. Actually, the prompt says "does the code claim more than it delivers?" — yes, the header says "ROUND 14 CLOSED THE TOCTOU" but it didn't close this one. So it's both a residual vuln and an overclaim.

Hmm, let me reconsider the severity. The lock guards `distribute.mjs` (daily cbBTC payout) and `revenue.mjs` (sweep/swap). For a double payment, you need 3 runners racing on a stale lock. Stale locks only happen after a crash (staleMs = 20h for distribute, 2h for revenue/alarm). So the scenario: a run crashes, leaving a stale lock. Then 3 new runs start near-simultaneously after the stale timeout. Two of them race the break, one wins, the third claims during the restore window. This is unlikely in normal ops (cron fires once). But "cron firing while someone runs it by hand, or a run that overruns its own interval" is the stated threat. With a 20h stale timeout and daily cron, you'd need the cron to fire while a stale lock exists AND someone manually runs AND another cron... unlikely but the code is supposed to be the guarantee. I'll call it HIGH because it's the exact failure the lock exists to prevent, but note it requires 3 racers.

Actually, let me reconsider — is it MEDIUM? The probability is low (3 racers, microsecond window, only after a crash). But the impact is double payment. Given the project's standard (this is what the lock exists to prevent), and that the author claims it's closed, I'll say HIGH. But I should be measured. Let me say HIGH with clear note that it's a narrow three-racer window, and that the author's own header admits the durable fix (fd lease) is not built.

Now **R3: Round 14's other repairs.**

Let me go through each:

**R3-1: `applyAcks` / `parseAcks` and `bank/acks.json`.**

The ack mechanism: an ack downgrades a finding to INFO, keyed `<kind>:<asset>`, reason mandatory.

Prompt asks: "Can an ack silence something it should not, or fail to silence what it should? Is `<kind>:<asset>` the right key?"

Let me look at `applyAcks`:
```javascript
export function applyAcks(findings, acks = {}) {
  return findings.map(f => {
    if (!f.asset || !f.kind) return f
    const why = acks[`${f.kind}:${f.asset}`]
    if (typeof why !== 'string' || !why.trim()) return f
    return { ...f, severity: S.INFO, acked: true, detail: `${f.detail}\n     ACKNOWLEDGED: ${why.trim()}` }
  })
}
```

It downgrades ANY finding with a matching `<kind>:<asset>` key to INFO. The concern: can an ack silence something it should not?

The ack is applied in `alarm.mjs` at the very end: `findings = D.applyAcks(findings, readAcks())`. It's applied to ALL findings, including ones that might be newly actionable. The key is `<kind>:<asset>`. 

Consider: an ack for `nested_vault:VaultA` (because it's bricked and accepted). But later, `VaultA`'s situation changes — e.g., the nested vault is rescued. The ack still downgrades any `nested_vault:VaultA` finding forever. The comment acknowledges "BLIND TO: an ack that was true when written and is not any more." So this is known. But the finding still PRINTS under INFO with the reason, so it's visible. So it's not fully silenced. OK.

But here's a concern: **the ack applies to ALL severities, downgrading to INFO.** What if someone acks a kind that shouldn't be ackable? E.g., `unledgered_sweep` (a real theft indicator). The ack file is writable by whoever controls the box. If an attacker (or a careless operator) adds `unledgered_sweep:<asset>` or `config_drift:...`, they could downgrade real alarms. But the ack file is on the same host as the keys, so whoever can write it already has broad access. The mitigation is that acked findings still print (under INFO) and the count is shown. So it's not a full mute. But it DOES stop paging (the SMS/email only fires on CRITICAL+HIGH). So an acked CRITICAL no longer pages. That's the point (stop nagging on unactionable). But it could be abused to stop paging on actionable things.

Is `<kind>:<asset>` the right key? Some findings don't have an `asset` (e.g., `config_drift`, `unledgered_sweep` has a signature not asset, `watchdog_gap`). `applyAcks` skips findings without `f.asset`. So those can't be acked. Good — the most systemic ones (config_drift) can't be acked. But `unledgered_sweep` — does it have an asset? Let me check. `detectUnledgeredSweeps` returns `{ kind: 'unledgered_sweep', severity, detail }` — no `asset` field. So it can't be acked. Good. `vault_burned`, `nested_vault`, `unredeemable_owner`, `vault_left_index`, `deactivated`, `reserve_fell`, `undeclared_token_account` have `asset`. These are the per-vault ones. So acks are per-vault-per-kind. That seems right.

But wait — `approve_by_vault_pda`? Let me check. Actually the detector is `detectApprovals` returning `{ kind: 'approve', severity, pda, detail }`. It has `pda`, not `asset`. So `f.asset` is undefined → can't be acked. Good (approves are always actionable).

Hmm, but `detectApprovals` uses `pda` field, while `applyAcks` checks `f.asset`. So approve findings can't be acked. Good.

What about `nested_vault` — it has `asset` (the inner vault). So it can be acked per inner vault. If the inner vault is bricked forever, ack it. Fine.

Is there a finding that SHOULD be ackable but isn't (fails to silence what it should)? The prompt asks both directions. Findings without `asset` can't be acked. E.g., `vault_index_shrank` (no asset), `index_disagrees_with_chain` (no asset). These are systemic index issues that might be permanent (e.g., DAS consistently wrong). They can't be acked, so they'd nag forever. But they're also genuinely actionable (fix the index). So not acking them is probably right. 

Actually, the concern in the prompt is more about: can an ack silence something it should NOT. Let me think about `correlateBurns` interaction. The ack is applied AFTER `correlateBurns`. So a `vault_burned` that was downgraded to INFO by correlateBurns (legit redemption) is already INFO. An ack wouldn't change it. A `vault_burned` that stayed CRITICAL (bare burn, no burn_vault seen) could be acked. If someone acks `vault_burned:VaultA`, then a REAL bare burn of VaultA would be downgraded to INFO and not page. That's dangerous — a bare burn is the one attack the programs can't prevent, and acking `vault_burned` for a specific vault would hide it. But you'd have to know the vault in advance and add the ack. And it still prints under INFO. But it stops the page. This is a real abuse vector but requires the attacker to control the ack file (same host as keys). I'll note it as MEDIUM: acks are powerful and the file is a mute button for specific vault/kind pairs; the mitigation is visibility (still prints, count shown).

Actually, the bigger structural point: **the ack file is a plaintext JSON on the same host as the signing keys, writable by the same user.** Anyone who compromises that user can add acks to silence alarms AND steal keys. So the ack file doesn't add a new attack surface beyond what the key compromise already gives. But a careless operator could over-ack. The design (still prints, count shown, reason mandatory) mitigates. I'll call the ack mechanism LOW-MEDIUM, noting the `vault_burned` ack abuse.

Hmm, let me reconsider. Is there a finding where the key `<kind>:<asset>` is wrong because the same asset could have the same kind for different reasons? E.g., `nested_vault:InnerVault` — the inner vault is nested in OuterA. Acked. Later, InnerVault is moved and nested in OuterB. The ack still applies (same kind:asset), downgrading a NEW nesting in a different host. The reason ("bricked in OuterA") no longer matches. But it still prints with the old reason. So a new, possibly-different nesting is downgraded based on an old ack. This is the "ack was true when written and is not any more" blindness. MEDIUM. But again, still visible.

I think the ack mechanism is mostly sound with known limits. Let me note:
- R3-1 (LOW/MEDIUM): acks can downgrade actionable per-vault findings (e.g., `vault_burned`, `nested_vault`) and thus stop paging; a stale ack applies to a new occurrence of the same kind:asset. Mitigated by continued visibility + count. The ack file is a partial mute button writable by the same user as the keys.

**R3-2: `unredeemable_owner` in `detectNestedVaults`.**

The detector now flags any vault owned by an off-curve address. Prompt: "False positives? False negatives? Marketplace escrows?"

```javascript
for (const { id, owner } of vaults) {
  if (!owner) continue
  if (owners.has(owner)) continue            // already named above, more precisely
  let ok
  try { ok = isOnCurve(owner) } catch { ok = null }
  if (ok === null || ok) continue            // unreadable is NOT a verdict
  out.push({ kind: 'unredeemable_owner', ... })
}
```

`owners` is a Map from PDA → vault id (for our vaults' asset-signer PDAs). If the owner is one of our vaults' PDAs, it's handled by the nested_vault arm (skipped here). Otherwise, if off-curve, flag.

False positives: an off-curve owner that IS recoverable. The comment names marketplace escrows. If a Core marketplace escrows the asset to an off-curve PDA while listed, the vault is temporarily unredeemable but recoverable (delist). The detector flags it CRITICAL. That's a false positive (it's not permanently sealed). The comment acknowledges this and names both readings. So known. But it's a real false positive that would nag. Since nothing has minted, zero false positives today. But once vaults are listed on marketplaces, this could fire. MEDIUM (operational noise, potential to bury real findings). But the author chose to err toward flagging. Acceptable, but worth noting the marketplace escrow false positive will need an allowlist once marketplaces are used.

Actually, the prompt says "Marketplace escrows?" — so I should address it. The detector can't distinguish a marketplace escrow (recoverable) from a DAO that permanently holds it (unrecoverable). Both are off-curve. So false positives for listed vaults. This is acknowledged. I'll note it as a known limit that will become real once vaults trade.

False negatives: an owner that is ON-curve but still can't sign a top-level instruction. E.g., a smart wallet that's on-curve but operated via a relayer/CPI. The detector uses `isOnCurve` as a proxy. An on-curve address that's actually a program... wait, programs are off-curve. An on-curve address is a valid ed25519 point, so it COULD be a keypair. But it might be a keypair nobody holds (e.g., a burn address) or a smart wallet that signs via CPI. The detector would NOT flag it (ok === true → continue). So a vault owned by an on-curve-but-unusable address is a false negative. The comment in `detectBankIsNotSignable` mentions this: "BLIND TO: an ON-curve key that is nonetheless operated through a wrapper." So known. But for the owner case, it means a vault owned by a smart-wallet that signs via CPI would not be flagged, and would be unredeemable. FALSE NEGATIVE. But it's inherent to the on-curve proxy (can't check on-chain). I'll note it.

Actually, wait — is there a more concrete false negative? What about the System Program or other well-known PDAs? Those are off-curve, so flagged. What about a vault owned by `11111111111111111111111111111111` (System program)? That's... `111...` is the System program ID, which is off-curve? Actually the System program ID is all 1s, which is off-curve (it's a program). So it'd be flagged. Fine.

Let me also check: does `isOnCurve` in the alarm/cosign correctly handle all cases? In `alarm.mjs`, it's `k => PublicKey.isOnCurve(new PublicKey(k).toBytes())`. If `k` is not a valid pubkey, `new PublicKey(k)` throws, caught → null → not a verdict. Good.

So R3-2 findings:
- False positives: marketplace escrows (recoverable) flagged CRITICAL. Known, will need allowlist.
- False negatives: on-curve addresses that can't actually sign top-level (smart wallets via CPI, burn addresses). Inherent to the proxy.
Both are acknowledged in comments. I'll note them as stated limits, maybe MEDIUM for the false-positive operational impact once trading starts.

**R3-3: `REDEMPTION_NOISE` allowlist in `correlateBurns`.**

Prompt: "four finding kinds are downgraded when a `burn_vault` for the same asset was seen. Is the allowlist too wide? Can a bare Core BurnV1, an approve by the vault's PDA, a nested vault, or an undeclared account be laundered into INFO?"

```javascript
const REDEMPTION_NOISE = {
  vault_burned: ...,
  vault_vanished: ...,
  deactivated: ...,
  reserve_fell: ...,
}
export function correlateBurns(findings) {
  const viaProgram = new Set()
  for (const f of findings) if (f.kind === 'burn_via_program' && f.asset) viaProgram.add(f.asset)
  ...
  for (const f of findings) {
    if (f.kind === 'burn_via_program') { ... dedupe ... }
    if (f.asset && viaProgram.has(f.asset) && REDEMPTION_NOISE[f.kind]) {
      out.push({ ...f, severity: S.INFO, detail: REDEMPTION_NOISE[f.kind](f.asset) })
      continue
    }
    ...
  }
}
```

So only `vault_burned`, `vault_vanished`, `deactivated`, `reserve_fell` are downgraded, and only when a `burn_via_program` for the same asset was seen. The allowlist explicitly EXCLUDES `approve_by_vault_pda`, `nested_vault`, `undeclared_token_account`, `vault_left_index`. So those stay loud. The selftest asserts this.

Can a bare Core BurnV1 be laundered? A bare burn produces `vault_burned` (from detectVaultSetChange) with NO `burn_via_program`. So `viaProgram.has(asset)` is false → not downgraded → stays CRITICAL. Good. Unless the attacker ALSO triggers a `burn_via_program` for the same asset. How? `burn_via_program` comes from `detectBurns` seeing a `burn_vault` instruction in a scanned transaction. To get a `burn_via_program` for asset A, the attacker needs a transaction that calls `burn_vault` on asset A and is scanned. But `burn_vault` requires the open+burn pairing and Bank signature. The attacker can't call `burn_vault` on A without the Bank. BUT — `detectBurns` fires on ANY `burn_vault` instruction in a scanned transaction, even if it FAILS? Let me check.

`detectBurns`:
```javascript
if (ix.program === burnProgramId) {
  if (burnVaultDiscriminator && !(ix.dataBytes && burnVaultDiscriminator.every(...))) continue
  out.push({ kind: 'burn_via_program', severity: S.INFO, asset: ix.accounts?.[0] ?? null, ... })
  continue
}
```
It doesn't check whether the transaction succeeded. The alarm's `normalise` is fed from `walkSigs`, which does `if (s.err) continue` — so FAILED transactions are skipped. Let me verify. In `alarm.mjs`:
```javascript
for (const s of sigs) {
  if (s.err) continue
  const tx = await conn.getParsedTransaction(...)
  ...
}
```
Yes, `if (s.err) continue`. So failed transactions are not scanned. So a failed `burn_vault` doesn't produce `burn_via_program`. Good. So the attacker can't manufacture a `burn_via_program` via a failed burn.

But could the attacker get a SUCCESSFUL `burn_vault` on asset A without actually redeeming A? `burn_vault` on A requires open_for_redemption on A (same asset+owner) earlier in the tx, and Bank signature, and A's owner signature. If it succeeds, A is burned (legitimately redeemed). So a successful `burn_via_program` on A means A was legitimately redeemed. Then a `vault_burned` on A is correctly downgraded. So no laundering.

But here's the carry-over concern (from the list): "`burn_via_program` does not verify the asset is one of ours, so the correlation key is caller-supplied." Let me think. `detectBurns` reads `asset: ix.accounts?.[0]`. This is the first account of the `burn_vault` instruction, which is the vault_asset. It's whatever the caller passed. But `burn_vault` on-chain verifies it's a Core asset in the collection. So if it SUCCEEDS, the asset IS one of ours. So the correlation key is trustworthy for successful burns. The carry-over says it's "caller-supplied" — but since failed txs are skipped, and successful burn_vault validates the asset, it's fine. Unless... the asset is one of ours but the burn is for a DIFFERENT vault than the one that vanished. But correlation is per-asset: `viaProgram.has(f.asset)` where f.asset is the vanished vault. So it only downgrades if the SAME asset had a burn_vault. So a burn of vault B doesn't launder vault A's disappearance. Good.

Wait, but the carry-over #5 says "burn_via_program does not verify the asset is one of ours, so the correlation key is caller-supplied." Let me reconsider. Is there a way to get a successful `burn_vault` recorded with a wrong asset? No, because burn_vault validates. So the concern is maybe about a `burn_vault` that succeeds but on an asset that's not in our collection — but that's refused on-chain (ForeignVault). So it can't succeed. So the correlation key is reliable. I think carry-over #5 is actually not exploitable, but let me note it.

Hmm, actually wait. Let me reconsider. `detectBurns` is also called with the discriminator check. But what if a transaction calls `burn_vault` and it's included in a scanned tx, but the tx overall succeeded while the burn_vault instruction itself... no, if any instruction fails, the whole tx fails (s.err set). So all instructions in a successful tx succeeded. So burn_vault succeeded. So asset validated. OK.

So the allowlist is NOT too wide for the four kinds. And the excluded kinds stay loud. The selftest proves it. I think R3-3 is sound. But let me double-check the four downgraded kinds can't be abused.

`vault_vanished`: from detectDeactivations, when an activated vault is no longer readable. If a burn_vault was seen for it, downgraded. Correct (it was redeemed).
`deactivated`: reserve fell below activation. If burned, downgraded. Correct.
`reserve_fell`: reserve dropped. If burned, downgraded. Correct.

Could an attacker drain a vault (via a delegate, say) and ALSO burn it, to launder the drain? If they burn it, the vault is destroyed. The drain findings (`reserve_fell`, `deactivated`) get downgraded because burn_vault was seen. But the drain happened BEFORE the burn. Is that a problem? Well, if the vault was drained and then burned, the contents were taken by the drain (via delegate) and the burn destroyed the empty vault. The `reserve_fell` would have fired when the drain happened (in an earlier pass, before the burn). Then when the burn happens, `reserve_fell` for that asset (if still present from lag) gets downgraded. But the original drain was already reported. Hmm, but if the drain and burn happen in the SAME pass (same 30-min window), then `reserve_fell` (from the drain) and `burn_via_program` (from the burn) are both in the same findings list. `correlateBurns` downgrades `reserve_fell` because burn_vault was seen. So the drain is laundered!

Wait, let me think. Can an attacker drain via delegate and burn in the same transaction/pass? To drain via delegate, they need a delegate approved on the reserve ATA. But the burn checks for delegates and refuses (ReserveDelegated). So they can't burn with a live delegate. Unless they drain AND revoke the delegate AND close the account, then burn. But draining via delegate moves the funds out, then they burn the empty vault. The `reserve_fell` detector compares balances between passes. If the drain+burn happen between two passes, the vault vanishes (burned), so `detectBalanceDrops` skips it (`after === undefined`). So `reserve_fell` wouldn't fire (it skips vanished vaults). Instead `vault_burned` fires, downgraded by burn_vault. So the drain isn't separately reported. But the drain was done by the OWNER (via delegate during a thaw?). Actually, to approve a delegate you need a thaw (ExecuteV1), which requires open_for_redemption, which requires a burn. So you can't approve a delegate without burning. The whole redemption is atomic. So the "drain then burn" is just a normal redemption (sweep then burn). The owner takes their own funds. Not an attack.

The real attack would be a NON-owner draining. But non-owners can't (need owner signature or delegate, and delegates are checked). So I don't think the allowlist launders a real attack. The four downgraded kinds are all "the vault disappeared/changed because it was redeemed," which is correct when burn_vault was seen.

But let me reconsider the carry-over #1: "Cross-pass correlation lag: if the signature walk reaches the burn in a LATER pass than the DAS diff, the CRITICAL already went out and nothing retracts it." This is the false-alarm direction (legit redemption reported as bare burn because the sig walk lagged). That's fail-safe (false alarm, not silence). Known. Not a laundering.

So R3-3: the allowlist is sound. I'll confirm it's not too wide, but note the interaction is subtle. Actually, the prompt says "Is the allowlist too wide? Can X, Y, Z be laundered?" — I should answer: no, the four excluded kinds (approve, nested, undeclared, vault_left_index) stay loud, and the four included kinds are legitimately produced by redemptions. A bare burn (no burn_vault) stays CRITICAL. I don't find a laundering path. But let me note one thing: `vault_left_index` is NOT in the allowlist, so it stays loud. Good, that's the bare-burn detector. 

Wait, actually there's a subtle issue. `vault_left_index` is produced when a vault leaves the index and is NOT flagged burnt. `vault_burned` is when it leaves AND is flagged burnt. A bare Core burn would flag the asset as burnt in DAS, so it'd be `vault_burned`, not `vault_left_index`. So `vault_left_index` is for non-burn disappearances (moved out of collection, or index error). Both stay loud unless downgraded. `vault_burned` is downgraded only if burn_vault seen. A bare burn → `vault_burned` with no burn_vault → stays CRITICAL. Good.

OK R3-3 is sound. I'll note it as confirmed, maybe with a minor note.

**R3-4: `scripts/validate-core-gate.sh` rewrite.**

The script now has `set -euo pipefail`, `must_fire`/`must_pass` that exit non-zero. Let me check for issues.

```bash
must_fire(){ if gate "$1"; then die "FALSE PASS — the gate accepted $2. The gate is useless."; fi; echo "  correct: fired"; }
must_pass(){ if ! gate "$1"; then die "FALSE FAIL — the gate rejected $2. It would reject every good validator."; fi; echo "  correct: passed"; }
```

`gate` does `solana program dump` and `cmp`. Under `set -e`, `gate` returning non-zero inside `if gate` is fine (conditional context). `must_fire` expects gate to fail (return non-zero). If gate succeeds (returns 0), die. Good.

But there's a subtlety: `gate` uses `return 1` on failure. Under `set -e`, a function returning non-zero in a conditional is OK. Let me check `gate`:
```bash
gate(){ 
  solana -u "$RPC" program dump "$CORE" "$CACHE/g-onchain.so" >/dev/null 2>&1 || { echo "  GATE FIRED: Core not present"; return 1; }
  cmp -s "$CACHE/g-onchain.so" "$1" || { echo "  GATE FIRED: Core differs from expected"; return 1; }
  echo "  GATE PASSED"; return 0; }
```
The `|| { ...; return 1; }` handles the failure without triggering set -e. Good.

ARM 1: boot validator WITHOUT Core, `must_fire "$CACHE/core-mainnet.so"`. The gate should fire (Core not present). `solana program dump` fails → gate returns 1 → must_fire sees gate failed → correct. Good.

ARM 2: boot WITH Core, tamper expected, `must_fire "$CACHE/g-tampered.so"`. Gate dumps on-chain Core, compares to tampered → differs → returns 1 → must_fire correct. Good.

ARM 3: `must_pass "$CACHE/core-mainnet.so"`. Gate dumps on-chain, compares to real → matches → returns 0 → must_pass correct. Good.

Potential issue: ARM 2 boots with `--bpf-program "$CORE" "$CACHE/core-mainnet.so"`, then tampers a COPY. The gate compares on-chain dump to the tampered copy. They differ. Good. But note: the on-chain Core is the REAL one (booted from core-mainnet.so). The tampered file is a separate copy. So cmp(on-chain, tampered) differs. Correct.

Another issue: the script uses `CACHE="${CBOB_CACHE:-/opt/cbob-vaults/.cache}"`, matching run-tests.sh. Good. It checks `[ -s "$CACHE/core-mainnet.so" ]` at the start. But it does NOT verify the sha256 against the pinned hash (run-tests.sh does). So if core-mainnet.so is tampered, this script would validate the gate against the tampered file. But that's a separate concern (the pinning is run-tests.sh's job). The script's job is to validate the gate logic, not the cache. Acceptable. But note: ARM 3 "passes on the real thing" assumes core-mainnet.so is the real thing. If it's tampered, ARM 3 would still "pass" (gate matches the tampered cache). So the script doesn't independently verify the cache is mainnet. But run-tests.sh does (pinned hash). So defense in depth. I'll note it as a minor observation, not a finding.

Actually, wait — there's a potential issue with `set -e` and the `boot` function. `boot` ends with `die "validator never came up"` if it times out. But `boot` is called as `kill_v; boot; must_fire ...`. Under `set -e`, if `boot` returns non