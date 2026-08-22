/** Round 5 independent audit — v4 three-program architecture.
 *  THREE NEW MODEL FAMILIES (deepseek / qwen / z-ai). Rounds 1-4 used
 *  openai, x-ai, google, moonshotai, anthropic. */
import * as fs from 'fs'
const K=(fs.readFileSync('/opt/gary-club/.env.local','utf8').match(/^OPENROUTER_API_KEY=(.*)$/m)||[])[1]
const MODELS=['anthropic/claude-opus-5']
const R='/opt/cbob-vaults/programs'
const seal=fs.readFileSync(`${R}/cbob-vaults/src/lib.rs`,'utf8')
const mint=fs.readFileSync(`${R}/cbob-vault-mint/src/lib.rs`,'utf8')
const burn=fs.readFileSync(`${R}/cbob-vault-burn/src/lib.rs`,'utf8')

const PROMPT=`You are an independent security auditor. These three Solana programs will hold real Bitcoin (cbBTC) belonging to real customers. FIND FAULTS. Assume the author is wrong until proven otherwise. Do NOT confirm their work, and do not praise it.

This is ROUND 5. Four prior audit rounds each found real defects, and roughly a third of prior "CRITICAL" findings were WRONG (a headline its own body refuted, invented sysvar mechanics, a borsh claim contradicted by mints that demonstrably work on a validator against real cloned Core). So: before you write a finding, ask what evidence would exist on-chain if your claim were true. If the claim implies "this never works at all", note that all three programs pass a 19/19 suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens. A claim that contradicts that is a claim about your own reasoning.

ARCHITECTURE
- A "vault" is a Metaplex Core NFT (CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d). Contents live in Core's asset-signer PDA ["mpl-core-execute", asset]. Core's ExecuteV1 makes that PDA sign arbitrary CPIs and REQUIRES the asset owner's signature.
- A PermanentFreezeExecute plugin gates whether ExecuteV1 is allowed at all. The SEAL program's ["seal"] PDA holds that plugin's authority. Permanent plugins are CREATE-ONLY.
- THREE programs, three separate upgrade authorities: SEAL (the seal + open/close), MINT (rounds + mint_vault), BURN (burn_vault alone).
- The COLLECTION's update authority is the MINT program's ["mint"] PDA, so only mint_vault can create an asset in the collection.
- Claimed model: TRUE 2-of-2. Every open, close and burn needs the OWNER's signature AND the BANK's co-signature. A Solana signature covers the whole transaction, so the Bank is expected to SIMULATE and refuse any tx that creates a PDA-owned token account or approves a delegate. Enumeration completeness is explicitly an OFF-CHAIN Bank duty; the authors know Core cannot enumerate a PDA's token accounts and say so.
- Activation (>= 21,000 sats of cbBTC in the vault) is deliberately OFF-CHAIN — a read, not a rule.

THE BUSINESS THIS ENCODES (audit the code against THIS, not against a generic NFT drop)
- ~2,100 vaults are intended to exist in total: ~190 free "charter" mints redeemed against a burned Proof-of-Burn token, then public rounds at a fee. "Future mints will be at a fee and will be controlled by governor vote."
- Governance is ONE VOTE PER VAULT. Concentration is known and accepted: one holder has ~21% and the top 3 wallets ~48% of charter vaults, voting over the price strangers pay for the remaining ~1,911.
- Mint revenue is split 85% back to vault holders / 15% to the Bank. The 85% flows through the treasury account.
- Vaults are freely transferable and are expected to be RESOLD on secondary marketplaces. A buyer's entire basis for paying is "this vault still contains its reserve".
- Charter provenance (a Notice serial, Governor standing) is intended to be stamped onto the vault at mint and to be the ONLY surviving record that a holder was a charter member — the Proof-of-Burn token and the Notice are both destroyed at redemption.

ALREADY FIXED IN THIS VERSION — do not re-report, but DO check whether each fix is real or merely relocated:
burn-on-lamports==0 destroying BTC; standalone close burning; nested-vault guard opt-in; collection vaults un-redeemable; missing provenance binding; close missing the Core-owner check; a token delegate surviving the re-seal; Token-2022 hidden balances; 1-lamport ATA griefing; mint requirements documented but unenforced; initialize front-runnable; a stale hardcoded seal PDA in MINT (now derived); three configs able to diverge (MINT and BURN now READ the SEAL config as canonical); collection made non-rotatable; reserve mints non-droppable; close now requires a preceding open; mint refuses an owner equal to the asset-signer PDA.

KNOWN AND ACCEPTED — re-report ONLY if you can show the REASONING is wrong:
- A bare Core BurnV1 by the owner cannot be prevented while the vault stays freely transferable (PermanentFreezeDelegate blocks transfer not burn; FreezeDelegate blocks both; there is no burn-only lock).
- Token accounts owned by a PDA cannot be enumerated on-chain; non-ATA completeness is the Bank's job.
- A vault transferred to its own asset-signer PDA is bricked; blocked in the UI only.

HUNT HERE FIRST — these three surfaces have had the LEAST scrutiny:

(A) CROSS-PROGRAM ECONOMICS. set_round / price_lamports / cap / minted_this_round / minted_total / treasury / governance.
    - Is the ~2,100 lifetime supply actually enforced anywhere, or only counted? What is minted_total FOR?
    - Can a hostile-but-legitimate governor majority (remember: 3 wallets hold 48% of the votes) extract value, mint for free, mint forever, or re-open a round to evade a cap? What is the WORST thing a ratified vote can do?
    - Can admin (update_wiring) and governance (set_round) fight, or can one silently neutralise the other? Who can redirect the treasury, and what does that cost the 85%?
    - Payment: ordering vs asset creation, refunds, over/under-payment, price 0, price = u64::MAX, closes_at = i64::MAX, cap = 0, round_id overflow, Clock manipulation.
    - Is there ANY on-chain link between paying and receiving? Who can call mint_vault, for whom, at what price?

(B) THE "SEAL CONFIG IS CANONICAL" PATTERN. MINT and BURN each re-derive the SEAL config PDA and read raw bytes at fixed offsets: disc[0..8] admin[8..40] collection[40..72] bank[72..104].
    - Is that byte layout right for an Anchor account whose struct is admin/collection/bank/Vec<Pubkey>/u8? What happens on a SEAL program upgrade that reorders or inserts a field? What happens if SEAL is re-initialised, or if the config is closed and re-created?
    - The check is read-only and unsigned. Does reading a config prove anything the caller could not have faked? Is there a version/discriminator check? What is NOT cross-checked (reserve_mints, admin, the seal PDA itself)?
    - MINT holds SEAL_PROGRAM_ID as a compile-time constant. What breaks if SEAL is redeployed at a new address?

(C) THE ATTRIBUTES PROVENANCE STAMP as an anti-resale-fraud signal. close_redemption calls mark_opened, which builds an UpdatePluginV1 for Plugin::Attributes with an attribute_list of exactly one pair {"redemption":"opened"}.
    - What happens to any OTHER attributes already on the asset — the charter provenance the business depends on?
    - Is the stamp monotonic? Can it be removed, reset, or forged? Who else can write that plugin? Can a seller launder a drained vault back to looking pristine before resale?
    - Is "opened once" even the right signal for a buyer, given the owner may open, take nothing, and close?
    - Is the stamp SET on every path that can remove value, or only on some?

ALSO SWEEP: anything that thaws without a genuine terminal close or ends a tx thawed; any path letting a non-owner or a party without the Bank move/destroy/seize a vault; missing account validation on UncheckedAccounts; instruction-introspection edge cases (CPI, duplicate instructions, address-lookup tables); the burn reserve loop and token-account byte offsets; anything the code claims in a comment that it does not actually do.

Be concrete. For each finding: SEVERITY (CRITICAL/HIGH/MEDIUM/LOW), the exact construct, a CONCRETE exploit (who signs what, in what order), and the fix. State plainly what you tried and COULD NOT break. Under 1600 words, FINDINGS FIRST, most severe first. End with THE SINGLE THING to fix before this holds real money.

SECOND TASK - ADJUDICATE THESE DISPUTED CLAIMS FROM OTHER AUDITORS.
Answer each with UPHELD / REJECTED / UNRESOLVED and one paragraph of reasoning. Be willing to say another auditor was simply wrong; roughly a third of prior "CRITICAL" findings on this codebase were.

D1. "mint_vault and burn_vault are non-functional: the hand-built Core CPI data begins vec![IX_CREATE_V2, 0] and vec![IX_BURN_V1, 0], and that extra 0 byte breaks Borsh so every call reverts."
D2. "The reserve check reads a 1-byte COption tag. SPL Token does not zero the 32 payload bytes when a delegate is revoked, so a legitimately-undelegated account can fail require!(d[72..76] == [0,0,0,0]) and permanently trap a vault." (Note the code checks bytes [72..76], [121..129] and [129..133] and reads nothing else.)
D3. "mint_vault transfers the price to the treasury BEFORE the Core CreateV2 CPI, so if a later check fails the buyer has paid and received nothing."
D4. "burn_vault requiring asset_signer.lamports() == 0 is a griefing vector; the fix is to drop the check and let Core BurnV1 sweep any remaining lamports to the payer."
D5. "Vaults may be born UNFROZEN. mint_vault hand-encodes PermanentFreezeExecute as push(17); push(1 /*frozen*/); push(1); push(3 /*authority=Address*/); <32-byte seal pda>. If that encoding is wrong the asset is created unsealed and the owner can Execute the contents out with no Bank co-signature. No existing test asserted frozen == true after mint." - reason about the exact byte layout Core PluginAuthorityPair expects.
D6. "BURN keeps its OWN reserve_mints list and cross-checks only collection and bank against the SEAL config, so a reserve mint added to SEAL but not to BURN is never derived, never required and never checked - and a vault holding it burns cleanly, destroying the token. The BURN header comment claims the cross-check prevents exactly this."

=== SEAL PROGRAM (programs/cbob-vaults/src/lib.rs) ===
${seal}

=== MINT PROGRAM (programs/cbob-vault-mint/src/lib.rs) ===
${mint}

=== BURN PROGRAM (programs/cbob-vault-burn/src/lib.rs) ===
${burn}
`
async function ask(model:string){
  const t0=Date.now()
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',
      headers:{'Authorization':`Bearer ${K}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,messages:[{role:'user',content:PROMPT}],max_tokens:64000,temperature:0.2})})
    const j:any=await r.json()
    if(j.error) return {model,ok:false,text:`ERROR ${JSON.stringify(j.error).slice(0,400)}`,secs:0,usage:''}
    const m=j.choices?.[0]?.message
    const text=(m?.content&&m.content.trim())?m.content:(m?.reasoning?'[reasoning only]\n'+m.reasoning:JSON.stringify(j).slice(0,500))
    const u=j.usage||{}
    return {model,ok:true,text,secs:Math.round((Date.now()-t0)/1000),usage:`in=${u.prompt_tokens} out=${u.completion_tokens} finish=${j.choices?.[0]?.finish_reason}`}
  }catch(e:any){ return {model,ok:false,text:`FETCH FAILED ${e.message}`,secs:0,usage:''} }
}
async function main(){
  const DIR='/tmp/claude-1000/-home-ubuntu/4b41531a-f141-4348-8064-0dabed62ba75/scratchpad/cbob5c'
  console.log(`prompt chars=${PROMPT.length}`)
  const out=await Promise.all(MODELS.map(ask))
  for(const o of out){
    fs.writeFileSync(`${DIR}/v5opus-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
    console.log(`${o.model.padEnd(28)} ${o.ok?`${o.secs}s ${o.usage}`:'FAILED'} chars=${o.text.length}`)
  }
}
main().catch(e=>console.error('FATAL',e?.message||e))
