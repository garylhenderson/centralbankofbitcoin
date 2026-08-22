/** Round 13 independent audit — ORGANISED BY MECHANIC, not by file.
 *  Twelve rounds were aimed at source files, which is how a whole mechanic can be
 *  "covered" while nobody ever asked whether the mechanic itself is right. This
 *  round is aimed at Gary's eight acceptance mechanics, plus the redemption path
 *  that was REBUILT hours ago. */
import * as fs from 'fs'
const K=(fs.readFileSync('/opt/gary-club/.env.local','utf8').match(/^OPENROUTER_API_KEY=(.*)$/m)||[])[1]
const MODELS=(process.env.MODELS||[
  'openai/gpt-5.6-terra-pro',
  'x-ai/grok-4.6',
  'anthropic/claude-opus-5',
  'moonshotai/kimi-k3',
  'z-ai/glm-5.3',
  'qwen/qwen3.8-2.4t-a95b',
  'minimax/minimax-m3',
  'openai/gpt-5.6-luna-pro',
].join(',')).split(',')
const OUT=process.env.OUTDIR||'/opt/cbob-vaults/audits/round13'
const R='/opt/cbob-vaults'
const f=(p:string)=>fs.readFileSync(`${R}/${p}`,'utf8')

const PROMPT=`You are an independent security auditor. These four Solana programs and the off-chain pipeline beside them will hold and move real Bitcoin (cbBTC) belonging to real customers. FIND FAULTS. Assume the author is wrong until proven otherwise. Do NOT confirm their work and do not praise it.

This is ROUND 13. TWELVE prior rounds each found real defects AND roughly a third of prior "CRITICAL" findings were WRONG — a headline its own body refuted, invented sysvar mechanics, a Borsh claim contradicted by mints that demonstrably work on a validator against real cloned mainnet Core, and one recommendation that would have DESTROYED customer SOL. So before you write a finding, ask: what evidence would exist on-chain, or in a test run, if my claim were true? All four programs pass a 259-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens. A claim that contradicts that is a claim about your own reasoning.

=====================================================================
THIS ROUND IS ORGANISED BY MECHANIC, AND THAT IS THE POINT
=====================================================================
Every prior round was organised by SOURCE FILE. That is how a whole mechanic gets "covered" while nobody ever asks whether the mechanic itself is right — which is exactly what happened to the redemption path, see below. The owner's acceptance standard, verbatim:

  "My goal. The unbreak mechanic is 100%. The mint mechanic is 100%. The royalty mechanic is 100%. The voting mechanic is 100%. The nest mechanic is 100%, the sell mechanic is 100%, the transfer mechanic is 100% — and the fact that EVERYTHING stays in the vault 100% of the time until it's broken open, and when it is, the vault is burned and never exists again."

Structure your report under these headings, and under each one ask what a 100% claim would have to survive:

  1. MINT — mint_vault: price, lifetime cap, round window, owner+Bank signatures, provenance attributes, the collection binding.
  2. UNBREAK (which IS burn — see below) — open_for_redemption + burn_vault, the pairing, the emptiness proof, the sweep.
  3. ROYALTY — set_collection_royalties and the Core Royalties plugin.
  4. VOTING — the whole GOV program: one vault one vote, quorum, thresholds, execution.
  5. TRANSFER — Core transfer plus the PermanentFreezeExecute seal.
  6. SELL — marketplace resale, where the buyer's entire stated basis is "this vault still contains its reserve".
  7. NESTING AND AIRDROPS — a vault sent into another vault, an asset or token nobody declared, and unbreaking in either state.
  8. THE INVARIANT — everything stays in the vault until it is broken open, and then the vault is burned and never exists again.

=====================================================================
WHAT CHANGED HOURS AGO. THIS IS THE NEWEST CODE AND NOBODY HAS AUDITED IT.
=====================================================================
The owner ruled: "THE ONLY WAY to break open a vault is to burn it." The built system was the EXACT INVERSE of that rule and had been through twelve audits without anyone noticing, because every round audited the files and none asked what the mechanic was supposed to be.

BEFORE (v2-v4): open_for_redemption thawed, arbitrary sweeps ran, close_redemption re-sealed and stamped "redemption: opened". The vault SURVIVED — empty, transferable, sellable. A PARTIAL sweep was legal: take half, re-seal, resell.

NOW (v5):
  * open_for_redemption REFUSES to thaw unless cbob_vault_burn::burn_vault for the SAME ASSET AND OWNER appears later in the same transaction.
  * burn_vault REFUSES unless that open appeared earlier in the same transaction.
  * close_redemption is DELETED, along with mark_opened, read_attributes and inspect_reserves in SEAL.
  * The emptiness proof in burn_vault is UNCHANGED, line for line. It is now satisfied by a sweep in the same transaction instead of by a previous one.

ATTACK THIS FIRST AND HARDEST. Specific questions the author wants answered, and the author's own answers are in the code comments — decide whether each is TRUE, not whether it is well argued:
  a) Can a vault be thawed and NOT burned, in any construction? Nested CPI, a wrapper program, two redemptions sharing a transaction, an address lookup table, a durable nonce, instruction introspection edge cases, a transaction where the burn is present but reverts in a way the thaw survives?
  b) Can a burn be paired to a DIFFERENT vault's thaw? Both halves bind account index 0 (asset) and index 2 (owner). Is that binding complete?
  c) Each program HARDCODES the other's Anchor discriminator and account indices (SEAL::BURN_PROGRAM_ID, SEAL::IX_BURN_VAULT_DISC, BURN::IX_OPEN_FOR_REDEMPTION_DISC, and BURN_IX_ASSET_IDX / SEAL_IX_OWNER_IDX etc). A discriminator is derived from the instruction NAME, not its account list. The author claims a drift FAILS CLOSED (the match fails, the thaw is refused, the vault stays sealed). Is that true in every case, including a BURN upgrade that adds an account before index 2, or a Core upgrade?
  d) load_instruction_at_checked sees TOP-LEVEL instructions only. The author claims this is load-bearing in BOTH directions and that a CPI wrapper cannot exploit it. Prove or refute.
  e) Redemption is now ONE transaction: open + every sweep + burn. Measured at 802 bytes of 1232 with ONE reserve mint, 17 distinct accounts. The reserve list is ADDITIVE-ONLY and may hold 8. Does adding reserve mints strand every vault by pushing redemption past the transaction ceiling? What is the real maximum? Does an address lookup table actually rescue it, given open and burn both need the same accounts? THE AUTHOR BELIEVES THIS IS THE MOST LIKELY WAY THE NEW DESIGN KILLS SOMEBODY'S BITCOIN.
  f) burn_vault requires a preceding open. Does that create any way to strand a vault that could previously be destroyed — for example a vault whose SEAL thaw fails for a reason the burn would not have cared about?

=====================================================================
KNOWN CONSEQUENCES OF THE REWRITE — ALREADY FOUND, DO NOT RE-REPORT. DO CHECK WHETHER EACH STATEMENT IS TRUE.
=====================================================================
  * A NESTED OR AIRDROPPED HOLDING IS NOW DESTROYED, NOT STRANDED. Core cannot enumerate the token accounts or nested Core assets a PDA owns, so burn_vault can only refuse what it is SHOWN. Under the old design an undeclared holding survived a burn. Now every redemption ends in a burn, so it is destroyed, and Core's BurnV1 does not sweep the asset-signer PDA. MEASURED on a validator in test section 9: Core PERMITS nesting (9.1); a nested vault is unredeemable because its owner is a PDA that cannot sign (9.3); DECLARED, the burn refuses (9.4, 9.8); UNDECLARED, the burn ALLOWS and the inner vault is orphaned forever (9.5) or the airdropped token is destroyed (9.9). These are asserted as ALLOW deliberately, so the suite goes red the day anyone believes the chain is catching it. QUESTION FOR YOU: is there ANY on-chain construction that closes this, and is the off-chain control (the Bank must scan with getTokenAccountsByOwner and DAS BEFORE it signs, not after) actually implemented in bank/alarm.mjs, or only asserted in a comment?
  * A REDEEMED CHARTER VAULT DESTROYS ITS OWN PROVENANCE. Round 5 made mark_opened preserve charter attributes because the vault was stated to be the only surviving record of charter membership. v5 destroys the vault. Asserted at 6.5/6.6. The owner has been told; it is a business trade, not a defect. QUESTION: is the mint transaction plus the DAS burnt record genuinely sufficient, or is there a surface that now reports charter membership incorrectly?
  * MINT still delegates the Attributes plugin to the SEAL PDA, and SEAL no longer has any instruction that writes attributes. That is a dangling capability. MINT also still refuses a "redemption" attribute at mint (MintError::ReservedAttribute) for a stamp that no longer exists, and a MINT comment still says attributes must fit within what SEAL can preserve. The author left MINT unchanged deliberately rather than making two risky changes in one session. Is leaving it right, and is the dangling authority reachable by anything?
  * THE DELEGATE CHECK IS UNREACHABLE WHEN THE REDEMPTION CLOSES ITS TOKEN ACCOUNT. burn_vault refuses a reserve ATA carrying a delegate or close authority, but a normal sweep closes the ATA, and a closed account is skipped (it is no longer owned by a token program). Test 3.3 exercises the shape where it MUST fire (delegate planted, balance moved out with the OWNER authority which does not clear the delegate, ATA left open) and 3.3a records the closed-account case as a measured ALLOW. The author's argument that the ALLOW is safe: a delegate on a non-existent account can authorise nothing, a re-created ATA is fresh, and the PDA can never sign again. IS THAT ARGUMENT TRUE?
  * burn_vault requires BOTH token-program ATA derivations to be declared for every reserve mint, while assert_classic_spl already guarantees every reserve mint is classic SPL. The author believes that is dead weight that halves redemption capacity but did not touch it, because the emptiness proof was deliberately left unchanged. Is the Token-2022 derivation reachable at all for a classic SPL mint?
  * bank/detectors.mjs detectBurns raises HIGH on every burn_vault. Under v5 that is now every legitimate redemption, and the file's own comment says a detector that cries wolf is one people learn to scroll past. Is the severity still right?

=====================================================================
ROUND 12'S CARRY-OVER LIST — ACCEPTED, NOT FIXED. STILL OPEN.
=====================================================================
  * CHAIN-DERIVED RECONCILIATION OF DISTRIBUTION OUTPUTS. The distributor key can move the whole pool while the alarm reconciles against a ledger the same user wrote. bank/distribute.mjs and bank/alarm.mjs.
  * AN OS-LEASE LOCK. bank/lock.mjs is breakable by construction; round 11 rewrote it and round 12 still found the unlink unguarded. It now link()s from a temp file and re-reads before unlink. Is it correct NOW, and is a POSIX lease or flock the right answer?
  * A FRESH PER-CYCLE SWAP OPERATOR WALLET. The rule "the operator holds nothing but the cycle's funds" is unenforceable with a long-lived key.

=====================================================================
MEASURED FACTS. DO NOT RE-FILE THESE AS BUGS.
=====================================================================
1. A bare Core BurnV1 by the owner cannot be prevented while the vault stays freely transferable. PermanentFreezeDelegate blocks transfer but not burn; FreezeDelegate blocks both and kills resale. There is no burn-only lock. NOTE: under the new rule an owner burning their own vault IS the unbreak. What must not be possible is a burn that DESTROYS the contents rather than releasing them.
2. Token accounts owned by a PDA cannot be enumerated on-chain, and neither can nested Core assets.
3. A vault transferred to its own asset-signer PDA is bricked forever, and Core permits the transfer.
4. Core BurnV1 does NOT sweep the asset-signer PDA. Measured: after a burn the PDA still held all 5,000,000 lamports and the payer got only the asset rent. A previous auditor recommended dropping the lamports==0 check on the theory that Core sweeps it; that would DESTROY customer SOL on every burn.
5. Pubkey::is_on_curve is host-only and panics on BPF.
6. The workspace sets overflow-checks = true, so arithmetic overflow ABORTS.
7. The charter round is free by design; price_lamports = 0 is legal and intended.
8. INIT_AUTHORITY is a Squads multisig vault (off-curve, signs by CPI). --features localnet swaps a test key in so the suite can run; scripts/build-mainnet.sh proves the shipped binary carries the Squads key by BEHAVIOUR, because a byte search cannot tell which pubkey constant a build carries (the compiler folds the 32-byte compare into immediates).

=====================================================================
ARCHITECTURE
=====================================================================
- A vault is a Metaplex Core NFT (CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d). Contents live in Core's asset-signer PDA ["mpl-core-execute", asset]. Core ExecuteV1 makes that PDA sign arbitrary CPIs and REQUIRES the asset owner's signature.
- A PermanentFreezeExecute plugin gates whether ExecuteV1 is allowed at all. The SEAL program's ["seal"] PDA holds that plugin's authority. Permanent plugins are CREATE-ONLY.
- FOUR programs, four separate upgrade authorities: SEAL (the seal and the thaw), MINT (rounds, mint_vault, revenue), BURN (burn_vault), GOV (proposals and votes).
- The COLLECTION's update authority is the MINT program's ["mint"] PDA, so only mint_vault can create an asset in the collection.
- Claimed model: TRUE 2-of-2. Every open and every burn needs the OWNER's signature AND the BANK's co-signature. A Solana signature covers the whole transaction, so the Bank is expected to SIMULATE and refuse any transaction that creates a PDA-owned token account or approves a delegate. Enumeration completeness is explicitly an OFF-CHAIN Bank duty.
- Money: income -> the MINT ["revenue"] PDA -> sweep_sol_for_swap (on-chain, permissionless, destination PINNED) -> a Jupiter swap OFF-CHAIN, the one trusted hop -> cbBTC back to the revenue PDA -> split_revenue (on-chain, enforced 85/15) -> daily equal payout to vaults holding at least 21,000 sats.

REPORT FORMAT. Under each of the eight mechanic headings: findings ordered CRITICAL / HIGH / MEDIUM / LOW. For each finding give the exact construct (accounts, instruction order, signatures), what an attacker gains, and the fix. If a mechanic has no finding, say so in one line and say what you checked. Then a final section: WHAT WOULD A 100% CLAIM HAVE TO SURVIVE, per mechanic, that this codebase does not currently prove.

=====================================================================
THE CODE
=====================================================================
=== SEAL: programs/cbob-vaults/src/lib.rs (REWRITTEN HOURS AGO — close_redemption deleted, the terminal instruction moved) ===
${f('programs/cbob-vaults/src/lib.rs')}

=== BURN: programs/cbob-vault-burn/src/lib.rs (REWRITTEN HOURS AGO — now requires a preceding open) ===
${f('programs/cbob-vault-burn/src/lib.rs')}

=== MINT: programs/cbob-vault-mint/src/lib.rs (UNCHANGED this round — its attribute handling now refers to a stamp that no longer exists) ===
${f('programs/cbob-vault-mint/src/lib.rs')}

=== GOV: programs/cbob-vault-gov/src/lib.rs ===
${f('programs/cbob-vault-gov/src/lib.rs')}

=== SPEC.md — the claims this system makes about itself ===
${f('SPEC.md')}

=== THE TEST SUITE (tests/3prog.test.ts) — sections 3, 4, 5, 9 are new or rewritten ===
${f('tests/3prog.test.ts')}

=== OFF-CHAIN: bank/detectors.mjs ===
${f('bank/detectors.mjs')}

=== OFF-CHAIN: bank/alarm.mjs ===
${f('bank/alarm.mjs')}

=== OFF-CHAIN: bank/revenue.mjs ===
${f('bank/revenue.mjs')}

=== OFF-CHAIN: bank/distribute.mjs ===
${f('bank/distribute.mjs')}

=== OFF-CHAIN: bank/lock.mjs ===
${f('bank/lock.mjs')}

=== OFF-CHAIN: bank/spl.mjs ===
${f('bank/spl.mjs')}

=== OFF-CHAIN: bank/sigwalk.mjs ===
${f('bank/sigwalk.mjs')}

=== OFF-CHAIN: bank/selftest.mjs ===
${f('bank/selftest.mjs')}

=== OPS: scripts/run-tests.sh ===
${f('scripts/run-tests.sh')}

=== OPS: scripts/build-mainnet.sh ===
${f('scripts/build-mainnet.sh')}

=== OPS: scripts/cron-install.sh ===
${f('scripts/cron-install.sh')}
`
/** ONE HUNG MODEL MUST NOT LOSE THE ROUND. Rounds 6 and 7 both ran under a bare
 *  Promise.all with no deadline and no incremental write, so nothing at all
 *  reached disk until the slowest of eight returned — and a model that never
 *  returned would have cost the entire round. */
const DEADLINE_MS=Number(process.env.MODEL_TIMEOUT_MS||45*60_000)
async function ask(model:string){
  const t0=Date.now()
  const ctl=new AbortController()
  const timer=setTimeout(()=>ctl.abort(),DEADLINE_MS)
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:ctl.signal,
      headers:{'Authorization':`Bearer ${K}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,messages:[{role:'user',content:PROMPT}],max_tokens:64000,temperature:0.2})})
    const j:any=await r.json()
    if(j.error) return {model,ok:false,text:`ERROR ${JSON.stringify(j.error).slice(0,600)}`,secs:0,usage:''}
    const m=j.choices?.[0]?.message
    const text=(m?.content&&m.content.trim())?m.content:(m?.reasoning?'[reasoning only]\n'+m.reasoning:JSON.stringify(j).slice(0,800))
    const u=j.usage||{}
    return {model,ok:true,text,secs:Math.round((Date.now()-t0)/1000),usage:`in=${u.prompt_tokens} out=${u.completion_tokens} finish=${j.choices?.[0]?.finish_reason}`}
  }catch(e:any){ return {model,ok:false,text:`FETCH FAILED ${e.message}`,secs:Math.round((Date.now()-t0)/1000),usage:''} }
  finally{ clearTimeout(timer) }
}
/** Write as each one lands, not after all of them. */
function land(o:any){
  fs.writeFileSync(`${OUT}/${process.env.TAG||'v13'}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
  console.log(`${o.model.padEnd(30)} ${o.ok?`${o.secs}s ${o.usage}`:`FAILED after ${o.secs}s`} chars=${o.text.length}`)
}
async function main(){
  console.log(`prompt chars=${PROMPT.length}  models=${MODELS.length}`)
  await Promise.all(MODELS.map(m=>ask(m).then(land)))
}
main().catch(e=>console.error('FATAL',e?.message||e))
