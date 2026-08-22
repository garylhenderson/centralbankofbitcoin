/** Round 6 independent audit — FOUR programs + the off-chain bank/ pipeline + ops.
 *  Rounds 1-5 audited at most three programs and NEVER saw gov, the revenue path,
 *  the distribution engine, the alarm, or the crons. */
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
const OUT=process.env.OUTDIR||'/opt/cbob-vaults/audits/round10'
const R='/opt/cbob-vaults'
const f=(p:string)=>fs.readFileSync(`${R}/${p}`,'utf8')

const PROMPT=`You are an independent security auditor. These four Solana programs and the off-chain pipeline beside them will hold and move real Bitcoin (cbBTC) belonging to real customers. FIND FAULTS. Assume the author is wrong until proven otherwise. Do NOT confirm their work and do not praise it.

This is ROUND 10. Five prior rounds each found real defects AND roughly a third of prior "CRITICAL" findings were WRONG — a headline its own body refuted, invented sysvar mechanics, a Borsh claim contradicted by mints that demonstrably work on a validator against real cloned mainnet Core, and one recommendation that would have DESTROYED customer SOL. So before you write a finding, ask: what evidence would exist on-chain, or in a test run, if my claim were true? If your claim implies "this never works at all", note that all four programs pass an 82-assertion suite on a local validator running REAL Metaplex Core cloned from mainnet, minting real vaults and moving real SPL tokens. A claim that contradicts that is a claim about your own reasoning.

ROUND 9 FOUND AND FIXED ALL OF THE FOLLOWING — for the fourth round running, most of them were defects in the PREVIOUS round's fixes. Do not re-report; DO check whether each is real or relocated, and hunt the same CLASS elsewhere:
  - \`mint.pending_bank\` was in TWO watch lists and read by NEITHER, so the notice period on the Bank co-signer did not run at all. The class is now closed mechanically: \`readConfigs\` ASSERTS it produces every key the watchers reference (\`missingWatchedKeys\`, itself a pure function tested both ways) and throws otherwise. \`gov.pending_admin_at\`, \`seal.pending_*_at\` and \`burn.pending_*_at\` were added at the same time.
  - \`apply_pending_admin\` CLEARED \`pending_bank\`: a two-line clear had been pattern-matched into that handler as well as into \`initialize\`, so a permissionless admin apply silently deleted a Bank rotation waiting out the same notice period.
  - THE GRACE WINDOW WAS A HOLE. A sweep skipped as too fresh was never looked at again, because the scan cursor only moves forward — and the legitimate cron (sweep :41, alarm :53) is ALWAYS inside the window. Deferred sweeps are carried in alarm state and re-judged (\`detectDeferredSweeps\`).
  - A cycle that returned cbBTC and was never SPLIT produced ZERO findings, while \`cycleIsOpen\` calls exactly that money the holders have not been paid.
  - \`--dry-run\` CONSUMED findings: \`report\` returns "delivered" when it did not try to send, so every baseline advanced and the CRITICAL it had just printed was never mentioned again.
  - \`seenSplits.slice(-200)\` kept the OLDEST and dropped the NEWEST, which would have turned every completed cycle into a permanent false CRITICAL. The slice is gone and the check is bounded by age.
  - \`paymentState\` conflated a REFUSED transfer with an unconfirmed one, so a frozen destination ATA meant that vault was never paid again by any later run. A program rejection is now \`unpaid\` and retryable.
  - Two detectors on their way to permanent noise: a vault deliberately skipped as burned read as unresolved forever, and a day with no cbBTC to distribute raised a HIGH daily until the first revenue.
  - BURN's non-reserve loop did not carry the three delegate/close-authority checks its sibling loop does.
  - The GOV comment claiming \`max(snapshot, live)\` makes minting unprofitable is CORRECTED: it makes it less profitable and no longer free. N mints raise the bar by N*quorum_bps/10000 and add N votes, so it is still net positive below 100% quorum. The control on minting is the BANK CO-SIGNATURE, a written duty, because a Core asset carries no creation slot to check against.

MEASURED AND REJECTED IN ROUND 9:
  - "set_collection_royalties may be missing a Data variant byte and nothing asserts Core decoded it" — the suite HAS asserted this since round 6: it adds the plugin, fetches the collection back, and asserts basis_points 500 then 750 with the revenue PDA as sole creator, against the pinned mainnet Core. The auditor was given the programs and bank/ but not the test file.
  - "apply_pending_admin deletes a waiting Bank rotation" — TRUE when raised, fixed above; do not re-raise.

ROUND 8 FOUND AND FIXED ALL OF THE FOLLOWING — again, several were defects in the PREVIOUS round's fixes. Do not re-report; DO check whether each is real or relocated, and DO hunt the same CLASS elsewhere:
  - \`detectIndexShortfall\` took ARRAYS after round 7 and both alarm call sites still passed \`.length\`. The coercion made the set empty, so the completeness check was DEAD and the alarm would have raised a CRITICAL every 30 minutes from the first mint. The selftest passed throughout because it calls the detector directly with arrays: proven in both directions while its WIRING was untested. The function now THROWS on the wrong shape.
  - \`readConfigs\` had no \`u32\` case, so \`mint.round_id\` and \`mint.cap\` were read as ONE BYTE. An unknown width throws now.
  - \`gov.last_executed_id\` was read at offset 93; it is at 94.
  - THE QUORUM SNAPSHOT FROZE THE WRONG DIRECTION. A proposal opened after the ~190-vault charter round carried a divisor of 190 and could execute a month later against 2,100 live vaults. The divisor is \`max(snapshot, live)\` now — the bar only rises with real supply, and a mint can only make a proposal HARDER to pass.
  - Quorum could floor to ZERO (\`supply*bps/10000\`), leaving \`cast > 0\` as the only requirement. Ceiling division, never zero, plus \`MIN_QUORUM_BPS = 500\`. And \`threshold_bps\` is capped at 7500, because unanimity is deadlock and \`set_round\` has no other caller.
  - DELETING a money ledger read as a fresh start: \`rm distributions.json\` made every vault unpaid and a same-day re-run would pay them all again. All three ledgers stamp a \`.has-run\` marker and refuse a MISSING file once it exists; the alarm no longer skips its distribution detector when the file is absent.
  - The POST-SWEEP Jupiter quote still read a missing \`priceImpactPct\` as 0% — the pre-sweep one had been fixed and its twin left. There is also an output FLOOR against the first quote now, because price impact is not a price.
  - The recorded return was the operator ATA's whole BALANCE, so a swap returning almost nothing reconciled if the account already held some. It is a DELTA now.
  - The Jupiter transaction was signed unread. It is checked for exactly one signer and for programs no swap needs.
  - \`detectUnledgeredSweeps\` matched on the SIGNATURE alone, so the operator could sweep the cap and write a row claiming one lamport. The amount is decoded from the instruction data and compared. It also has a grace window so it does not race the writer.
  - A cycle is finished when the cbBTC has been SPLIT, not when it comes back; and a claimed \`splitSig\` must appear in the transaction scan.
  - ROTATIONS WAIT IN ALL FOUR PROGRAMS. Round 7 timelocked MINT's admin and governance only. SEAL's admin could set \`config.bank\` — the co-signer whose refusal stops a seller planting a delegate and selling the vault — in one transaction. SEAL, BURN and GOV now have arm/apply/cancel, and MINT's \`bank\` joined it. Every armed rotation is CRITICAL on its face every pass.
  - \`sol_reserve_lamports\` between 0 and rent exemption wedges every sweep forever; refused.
  - The operator's own SOL balance is checked before sweeping (it pays for four transactions and nothing funded it).
  - A vault burned between the plan being fixed and its turn in the payout loop was still paid, into a PDA nobody can redeem from.
  - The deadman cron watched a hardcoded path while the alarm honours \`CBOB_ALARM_STATE\`.
  - The four programs' \`collection\` fields are cross-checked; \`mint.bank\`, \`gov.proposal_count\` and every pending-rotation slot are watched.
  - The Core byte-identity gate compared a dump of the validator we booted FROM a file TO that same file — a tautology. The mainnet sha256 is PINNED now (f03e7537…, verified against two independent dumps) and the caches moved out of world-writable /tmp.
  - The MintVault account named \`treasury\` is the revenue PDA while \`config.treasury\` is the distributor: one name, two meanings, and an auditor filed a CRITICAL on the confusion. Renamed to \`revenue\`.

MEASURED AND REJECTED IN ROUND 8:
  - "distribution is wired to an impossible treasury, because config.treasury is the revenue PDA" — WRONG. \`config.treasury\` is the DISTRIBUTOR wallet; the MintVault ACCOUNT that was called \`treasury\` is the revenue PDA. Two different things that shared a name, now renamed.
  - "constrain the mint in split_revenue to an allowlist" — REJECTED ON DESIGN. It works for any token deliberately, so a future income source needs no new code; the token program is pinned to classic SPL, so no transfer hook can ride in, and the worst a griefer achieves is paying to create an ATA holding a worthless token.

ROUND 7 FOUND AND FIXED ALL OF THE FOLLOWING — several of them were defects in ROUND 6'S OWN FIXES, which is the most useful thing a round can produce. Do not re-report them; DO check whether each is real or merely relocated, and DO look for the same CLASS elsewhere:
  - GOV read \`quorum_bps\` and \`threshold_bps\` LIVE at execute while \`quorum_supply\` was snapshotted, and round 6 had just made quorum_bps admin-lowerable — so one admin signature plus one vault could ratify anything, atomically. BOTH are now snapshotted into the Proposal at creation and \`execute_proposal\` reads no config value for the tally.
  - \`sweep_sol_for_swap\` was permissionless with no minimum amount, so round 6's cooldown became a GRIEF HANDLE: sweep zero once per window and the real cycle starves for a transaction fee. The swap operator is now a REQUIRED SIGNER, \`amount > 0\` is enforced, and \`sweep_cooldown_secs\` has an on-chain floor of 1 (two sweeps in one transaction share a timestamp, so 1 closes the atomic bypass absolutely).
  - \`update_wiring\` put every bound behind the governance signature, which the production wiring makes UNOBTAINABLE (governance is a PDA that can only sign set_round) — so replacing a compromised swap operator was seven days away. The gate now splits by DIRECTION: tightening a bound and rotating the operator are admin-only; loosening a bound, and anything that changes who gets paid, stillneed governance.
  - \`admin\` rotated INSTANTLY while governance was timelocked, and admin holds the CANCEL on a governance rotation — so an attacker could remove the remedy before it was needed. Admin is now armed and applied on the same notice period, with \`apply_pending_admin\` / \`cancel_pending_admin\`.
  - Proposal execution is MONOTONIC (\`last_executed_id\`): an older ratification cannot reinstate itself after a newer one, which also stops N passed proposals each handing the round its cap again.
  - The revenue ledger is written by the same process that holds the key it audits. The alarm now reads SWEEPS OFF THE CHAIN (\`detectUnledgeredSweeps\` over the MINT signature scan) and demands a ledger row for each.
  - NOTHING watched the daily distribution. \`detectDistribution\` now covers a missed day, an unfinished run, an unreadable ledger, and any transfer with no signature.
  - NOTHING watched \`round_id\`, \`price_lamports\`, \`cap\`, \`opens_at\`, \`closes_at\` or \`minted_total\` — the entire output of the governance system. All are watched now, as is \`gov.admin\`, \`gov.last_executed_id\`, and \`mint.governance_timelock_secs\` (which MINT's own comment claimed the alarm asserted while the reads stopped one offset short of it).
  - \`collection.hash\` was in the drift watch list and NOTHING EVER WROTE THE KEY.
  - A MISSING state file read as a first run, so \`rm state.json\` re-baselined the watcher silently — and the deadman cron could not see it, because \`find\` on an absent path prints nothing. Both fixed.
  - Cursors advanced even when the alert failed to send, so a CRITICAL transaction finding was scanned past and never re-reported.
  - One unreadable balance erased that vault's baseline permanently (activation was carried forward, balances were not).
  - A THIRD copy of the truthy-'0' predicate had crept back into \`revenue.mjs\`'s open-cycle guard. There is now ONE exported \`cycleIsOpen\`.
  - \`revenue.mjs\` never read the on-chain sweep bounds, so a config it disagreed with wedged the pipeline permanently AND raised a CRITICAL about lamports that never moved. It reads them now and distinguishes a REJECTED send from an unconfirmed one.
  - DAS completeness accepted DUPLICATE ids (and \`balances\` is keyed by id, so duplicates collapse and one vault could take the whole day's payout). Unique counts must now agree with \`minted_total\` EXACTLY.
  - \`detectBurns\` called any instruction to the BURN program a burn, including \`initialize\`.
  - The assertion floor was itself an env var; the suite file could be swapped; a partial pass counted. All three closed.
  - \`build-mainnet.sh\` had neither the port wait nor the Core byte-identity gate that \`run-tests.sh\` documents as load-bearing, and its banner claimed the mainnet constant IS the Squads key when the test only shows it is not the LOCALNET key. The banner now states exactly what was proven and what was not.
  - Logs moved out of world-writable /tmp.

MEASURED AND REJECTED IN ROUND 7 — do not re-raise without new evidence:
  - "a griefer can pre-fund the next Proposal PDA and Anchor \`init\` will fail forever, bricking proposal creation" — MEASURED FALSE on a validator: 2,000,000 lamports were sent to the next proposal PDA and \`create_proposal\` succeeded. There is a permanent test for it.
  - "require minted_now == quorum_supply at execute, so any mint during a voting window kills the proposal" — REJECTED ON LIVENESS. During an open public round mints are continuous, so no proposal could ever execute without pausing the sale. The quorum DIVISOR is snapshotted, minting requires the Bank's co-signature, and that co-signature is now written down as an explicit Bank duty rather than an unstated one.

ROUND 6 FOUND AND FIXED ALL OF THE FOLLOWING. Do not re-report them; DO check whether each fix is real or merely relocated, and DO look for the same CLASS of defect somewhere else:
  - the alarm kept ONE lastSignature and used it as \`until\` for five addresses (measured: a foreign signature makes the RPC return an EMPTY list; 200 Core signatures is 117 seconds of a 30-minute pass; the watermark never advanced after the first run). Now: per-address cursors, paged to the sentinel, advanced only over a window read end to end, a gap is a FINDING, Core removed from the scan and replaced by a collection reconcile.
  - sweep_sol_for_swap had no on-chain cap or rate limit; the 50 SOL bound lived only in bank/revenue.mjs. Now max_sweep_lamports AND sweep_cooldown_secs in config, both enforced in the program, both proven in the suite.
  - update_wiring let ADMIN ALONE set config.governance. Now a rotation is armed, published on-chain as pending_governance, and applied only after governance_timelock_secs (a config value with a 60s floor that exists so the apply path is testable; production must be days, the alarm asserts it). Cancellable by admin.
  - swap_operator and sol_reserve_lamports had no setter at all. Now rotatable under admin+governance.
  - GOV quorum was read from MINT's live minted_total at EXECUTE time. Now snapshotted into the Proposal at creation.
  - a passed proposal never expired and could install a round that had already closed. Now EXECUTION_WINDOW_SECS and a RoundAlreadyOver check.
  - GovConfig.admin was written and never read; nothing could change quorum/threshold/min_voting_secs. Now update_gov_config: min_voting_secs and threshold_bps ratchet UP only, quorum_bps may move both ways (deliberate: the divisor never falls while burns remove voters).
  - detectUnreconciledRevenue treated returnedSats of '0' as reconciled (String(0n) is truthy) and never compared the return to the quote; a missing ledger was swallowed. All three fixed.
  - revenue.mjs wrote sweptLamports only after confirmation, so a confirmation timeout on a landed transaction left a row the detector skipped forever. Now an intent is written first.
  - distribute.mjs and revenue.mjs had no lock and read a corrupt ledger as empty; the day's per-vault amount was recomputed on resume; one failed transfer denied every remaining vault; the SOL floor funded under half a run. All fixed.
  - assets was built from the live vault list only, so a SUCCEEDED bare burn dropped out of the set and could never be named. Now includes burnt.
  - nothing watched the four programs' upgrade authorities or bytes, or the collection. Now hashed into the drift snapshot.
  - cron-install's de-dupe filter never matched its own jobs (measured), so re-running installed duplicates; it also silently dropped --live.
  - build-mainnet could certify STALE bytes after a build failure that printed no "^error" line, and proved INIT_AUTHORITY for MINT only.
  - set_collection_royalties had never run against real Core. It now does, both opcodes, and Core decodes what we wrote. basis_points is bounded to 1000.
  - split_revenue floored the holders' share and gave the Bank the remainder, contradicting its own comment. Now the Bank is floored.
  - SEAL's INIT_AUTHORITY check ran after assert_classic_spl, making the property untestable.

MEASURED AND REJECTED IN ROUND 6 — do not re-raise without new evidence:
  - "detectApprovals keys on parsed.info.owner, which may not exist" — MEASURED against the real RPC parser on a validator: a real jsonParsed approve DOES carry info.owner. A fallback that resolves the owner from the account was added anyway.
  - "closes_at - opens_at can overflow and bypass the one-year bound" — the workspace sets overflow-checks = true, so it ABORTS. There is now a test that passes opens_at=-1, closes_at=i64::MAX and asserts the rejection is an overflow, so the profile setting is measured rather than assumed.
  - "bound price 0 to the first 190 mints" — REJECTED ON THE BUSINESS, twice now. The charter round is free by design and 190 is not a number the program should know.

WHAT IS NEW IN THIS ROUND. Earlier rounds saw only three programs. You are the FIRST auditors to see:
  - the GOVERNANCE program (one round of review only),
  - the REVENUE path in MINT (split_revenue, sweep_sol_for_swap, set_collection_royalties),
  - the entire OFF-CHAIN pipeline: bank/alarm.mjs, bank/detectors.mjs, bank/revenue.mjs, bank/distribute.mjs, bank/selftest.mjs,
  - the operational scripts: run-tests.sh, build-mainnet.sh, cron-install.sh.
SPEND YOUR EFFORT THERE. The SEAL program has survived five rounds and the last three found nothing in it.

ARCHITECTURE
- A "vault" is a Metaplex Core NFT (CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d). Contents live in Core's asset-signer PDA ["mpl-core-execute", asset]. Core's ExecuteV1 makes that PDA sign arbitrary CPIs and REQUIRES the asset owner's signature.
- A PermanentFreezeExecute plugin gates whether ExecuteV1 is allowed at all. The SEAL program's ["seal"] PDA holds that plugin's authority. Permanent plugins are CREATE-ONLY.
- FOUR programs, four separate upgrade authorities: SEAL (seal + open/close), MINT (rounds, mint_vault, revenue), BURN (burn_vault), GOV (proposals and votes).
- The COLLECTION's update authority is the MINT program's ["mint"] PDA, so only mint_vault can create an asset in the collection.
- Claimed model: TRUE 2-of-2. Every open, close and burn needs the OWNER's signature AND the BANK's co-signature. A Solana signature covers the whole transaction, so the Bank is expected to SIMULATE and refuse any tx that creates a PDA-owned token account or approves a delegate. Enumeration completeness is explicitly an OFF-CHAIN Bank duty; the authors know Core cannot enumerate a PDA's token accounts and say so.
- Activation (>= 21,000 sats of cbBTC in the vault) is deliberately OFF-CHAIN — a read, not a rule.

THE BUSINESS THIS ENCODES (audit the code against THIS, not against a generic NFT drop)
- ~2,100 vaults intended to exist in total: ~190 free "charter" mints redeemed against a burned Proof-of-Burn token, then public rounds at a fee set by governor vote.
- Governance is ONE VOTE PER VAULT. Concentration is known and accepted: one holder has ~21% and the top 3 wallets ~48% of charter vaults, voting over the price strangers pay for the remaining ~1,911.
- ALL project income points at ONE address: BXzdn56h93KX5cZryRXab89VpwGtwPzWA4wegqsHCiuX, the MINT program's ["revenue"] PDA. Nobody holds its key. Mint prices land there and the collection Royalties plugin names it sole creator at 100%.
- The cycle: revenue PDA accrues SOL -> sweep_sol_for_swap (on-chain, permissionless, destination PINNED in config, keeps a fee reserve) -> swap SOL to cbBTC on Jupiter OFF-CHAIN by the swap operator key (THE ONE TRUSTED HOP, capped at 50 SOL per cycle, ledgered) -> cbBTC returned to the revenue PDA -> split_revenue (on-chain, permissionless, enforced 85/15 to distributor/Bank) -> bank/distribute.mjs pays every ACTIVATED vault an equal share, daily.
- Vaults are freely transferable and are expected to be RESOLD. A buyer's entire basis for paying is "this vault still contains its reserve".

ALREADY FIXED — do not re-report, but DO check whether each fix is real or merely relocated: lifetime supply cap now enforced against minted_total (it used to be counted and never read); set_round now requires cap > 0 and a window bounded to a year; BURN now reads reserve_mints out of the SEAL config instead of keeping its own copy; charter provenance stamped at mint and mark_opened now PRESERVES other attributes instead of replacing the list; reserve mints checked for classic SPL at config time (a Token-2022 reserve mint would have sealed every vault forever); treasury rotation now needs governance too; the owner must SIGN a mint; the payer passes max_price_lamports; cross-program config reads pinned by discriminator AND a version byte.

REJECTED IN PRIOR ROUNDS — re-raise ONLY with new evidence, and expect to be measured against a validator:
  R1. "the trailing 0 byte in the hand-built Core CPI data breaks Borsh so every mint/burn reverts" — REFUTED by the live suite. [12,0] is BurnV1's opcode plus a mandatory Option::None tag.
  R2. "SPL Token's COption tag is 1 byte so a revoked delegate traps a vault" — MEASURED: the tag is 4 bytes, reads [0,0,0,0] after revoke, and the stale 32-byte payload is never read. The proposed fix was strictly weaker than what is there.
  R3. "payment before the CPI can strand a buyer" — transaction atomicity.
  R4. "drop burn's lamports==0 check because Core BurnV1 sweeps the PDA" — MEASURED FALSE. After a real burn the PDA still held all 5,000,000 lamports; Core's BurnV1 account list never includes the asset-signer PDA. APPLYING THIS WOULD HAVE DESTROYED CUSTOMER SOL.
  R5. "vaults may be born unfrozen" — MEASURED: the plugin decodes frozen=true and an owner's bare Execute with no open is refused on-chain with Core error 0x9.
  R6. "require a minimum mint price" — REJECTED ON THE BUSINESS. price 0 is a requirement; the charter round is free by design.

PROVEN IMPOSSIBILITIES — do not file as bugs:
  1. A bare Core BurnV1 by the owner cannot be prevented while the vault stays freely transferable. PermanentFreezeDelegate blocks transfer not burn; FreezeDelegate blocks both and kills resale. There is no burn-only lock.
  2. Token accounts owned by a PDA cannot be enumerated on-chain, and the same is true of nested Core assets. That gap is the Bank alarm's job and is stated, not hidden.
  3. A vault transferred to its own asset-signer PDA is bricked forever; Core permits the transfer.
  4. Core's BurnV1 does NOT sweep the asset-signer PDA.
  5. Pubkey::is_on_curve is HOST-ONLY — it compiles for BPF and panics at runtime. There is no on-chain test for "is this address a PDA"; requiring a signature is the enforceable form.
  6. The SOL->cbBTC swap cannot be trustless without a DEX CPI. The SPLIT is enforced on-chain; the SWAP is the one trusted hop and is bounded, ledgered and reconciled rather than pretended away.

HUNT HERE FIRST — five surfaces, in this order:

(A) THE GOVERNANCE PROGRAM. One vault one vote, standing read live off the asset's owner bytes, VoteRecord PDA at ["vote", proposal, ASSET].
    - Can a vote be cast twice, by transferring the vault mid-proposal, by a delegate, by the collection, by a burned vault, or by a vault that did not exist when the proposal opened? Is standing read at vote time or at proposal time, and which is exploitable?
    - Quorum is measured against MINT's live minted_total, which GROWS during a proposal. Does that let a proposal be passed or blocked by minting? Can a majority mint themselves quorum?
    - What is the WORST thing a ratified proposal can do? Trace the CPI into set_round and prove what MINT independently bounds. Can governance mint free forever, re-open a closed round, evade the lifetime cap, or set a round in the past?
    - Proposal lifecycle: create, vote, tally, execute, cancel, expire. Can execute run twice, run after cancel, run stale, or be front-run? Is there a timelock, and can min_voting_secs be set to 60 seconds in production? Who can call each one?
    - Overflow/underflow in vote counts; i64 timestamps; Clock manipulation by a validator; account-reinit and PDA-close-then-recreate attacks on VoteRecord or Proposal.

(B) THE REVENUE PATH IN MINT. split_revenue, sweep_sol_for_swap, set_collection_royalties.
    - split_revenue is PERMISSIONLESS and moves customer money. Who supplies the destination accounts, and what stops a caller from passing their own? Is the distributor and Bank address read from config or from the caller? Is the token mint constrained? Can it be called with a hostile token, a fake token program, a frozen destination, or an account with a delegate?
    - Integer rounding: does split_bps arithmetic ever round the Bank's way, and do the two transfers always sum to the balance exactly? What happens at balance 0, balance 1, u64::MAX?
    - sweep_sol_for_swap is PERMISSIONLESS and moves SOL out of the revenue PDA to a "pinned" destination. Prove the pin. What is the fee reserve, can the PDA be swept below rent-exemption, and can it be called in a loop to drain the reserve in fee-sized bites? Is there any rate limit, and what does the 50 SOL cap actually bind?
    - set_collection_royalties hand-builds a Core CPI for the Royalties plugin. THIS HAS NEVER BEEN TESTED AGAINST REAL CORE. Check the byte encoding against Core's actual Plugin/Royalties/RuleSet layout: plugin discriminant, basis_points type and width, the creators Vec, the RuleSet enum, and whether AddPluginV1 vs UpdatePluginV1 is the right instruction for a plugin that may or may not already exist. If it is wrong, say exactly which byte.
    - Can royalties be set to something that breaks marketplace resale, or that redirects the creator share away from the revenue PDA?

(C) THE OFF-CHAIN PIPELINE — bank/. No model has ever seen this code.
    - bank/distribute.mjs pays real money on a cron. What happens if it crashes mid-run, runs twice concurrently, is run manually while the cron fires, or the RPC returns a partial vault list? Is the "one distribution per UTC day" guard atomic or a read-then-write race? Is the per-vault ledger written BEFORE or AFTER the transfer, and what does each choice lose?
    - Can a vault be paid twice, paid nothing, or can an attacker mint vaults to farm the distribution? Is the activation threshold checkable by an attacker at zero cost? What stops a single actor holding 500 vaults from taking 500 shares?
    - bank/revenue.mjs holds the swap operator key and moves up to 50 SOL. What is the blast radius of that key, what does --audit actually reconcile, and can the ledger be made to lie?
    - bank/alarm.mjs and detectors.mjs are the ONLY watcher over the off-chain gap. For each detector ask: what is it INCAPABLE of seeing? Can a failed read be mistaken for a pass anywhere? Does any detector depend on data an attacker controls?
    - Key handling, file permissions, error handling, retries, idempotency, what a half-failed job leaves behind, and whether a crash is loud or silent.

(D) OPERATIONS — scripts/. run-tests.sh, build-mainnet.sh, cron-install.sh.
    - Can the test runner produce a GREEN run that proves nothing? It has done exactly that before, four different ways.
    - build-mainnet.sh claims to prove which INIT_AUTHORITY key shipped by deploying both builds and asking each. Is that proof sound, or can both answer the same way for a wrong reason?
    - cron-install.sh: what happens on a re-run, on a partial install, under the wrong user, or when a job overruns its interval?

(E) CROSS-CUTTING. Anything a comment claims that the code does not do. Any field only ever assigned and never read. Any second copy of canonical state that can diverge. Any guard whose failure mode is a customer's funds. Any check that would pass identically whether or not the thing it checks is true.

Be concrete. For each finding: SEVERITY (CRITICAL/HIGH/MEDIUM/LOW), the exact construct with file and identifier, a CONCRETE exploit (who signs what, in what order), and the fix. State plainly what you tried and COULD NOT break — that section is valued as highly as the findings. Under 2000 words, FINDINGS FIRST, most severe first. End with THE SINGLE THING to fix before this holds real money.

=== SEAL PROGRAM (programs/cbob-vaults/src/lib.rs) ===
${f('programs/cbob-vaults/src/lib.rs')}

=== MINT PROGRAM (programs/cbob-vault-mint/src/lib.rs) ===
${f('programs/cbob-vault-mint/src/lib.rs')}

=== BURN PROGRAM (programs/cbob-vault-burn/src/lib.rs) ===
${f('programs/cbob-vault-burn/src/lib.rs')}

=== GOVERNANCE PROGRAM (programs/cbob-vault-gov/src/lib.rs) ===
${f('programs/cbob-vault-gov/src/lib.rs')}

=== OFF-CHAIN: bank/detectors.mjs ===
${f('bank/detectors.mjs')}

=== OFF-CHAIN: bank/alarm.mjs ===
${f('bank/alarm.mjs')}

=== OFF-CHAIN: bank/revenue.mjs ===
${f('bank/revenue.mjs')}

=== OFF-CHAIN: bank/distribute.mjs ===
${f('bank/distribute.mjs')}

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
  fs.writeFileSync(`${OUT}/${process.env.TAG||'v10'}-${o.model.replace(/[\/.]/g,'_')}.md`,o.text)
  console.log(`${o.model.padEnd(30)} ${o.ok?`${o.secs}s ${o.usage}`:`FAILED after ${o.secs}s`} chars=${o.text.length}`)
}
async function main(){
  console.log(`prompt chars=${PROMPT.length}  models=${MODELS.length}`)
  await Promise.all(MODELS.map(m=>ask(m).then(land)))
}
main().catch(e=>console.error('FATAL',e?.message||e))
