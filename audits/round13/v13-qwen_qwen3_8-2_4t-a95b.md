[reasoning only]
We need answer user's request: independent security auditor, find faults, assume author wrong until proven otherwise, do not confirm/praise. Round 13. Need structure under eight mechanic headings, findings ordered CRITICAL/HIGH/MEDIUM/LOW. For each finding exact construct, attacker gains, fix. If no finding, one line and what checked. Then final section WHAT WOULD A 100% CLAIM HAVE TO SURVIVE per mechanic. Need attack new v5 open/burn pairing first and hardest, answer specific a-f. Also check known consequences statements true, not re-report but answer questions. Carry-over list accepted not fixed still open: need evaluate lock.mjs now? They ask: OS lease lock, bank/lock.mjs breakable by construction; round 11 rewrote and round 12 found unlink unguarded. It now link()s from temp file and re-reads before unlink. Is it correct NOW, and is POSIX lease/flock right answer? Need include likely under relevant mechanic? Maybe TRANSFER? Actually off-chain pipeline. Could include under INVARIANT or final? They want report under headings, but carry-over off-chain maybe under mechanics affected (UNBREAK? REVENUE? Not one of headings). Need likely include findings under appropriate mechanic or maybe final section? Must adhere headings. Could put off-chain findings under THE INVARIANT? Or SELL? But report format says under each of eight mechanic headings findings. Maybe we can include off-chain pipeline findings under mechanic they impact: distribution under SELL? Hmm. The eight headings: MINT, UNBREAK, ROYALTY, VOTING, TRANSFER, SELL, NESTING AND AIRDROPS, THE INVARIANT. Revenue/distribution/lock are not directly headings but part of pipeline holding/moving real Bitcoin. Need still find faults. Could include under THE INVARIANT (everything stays in vault until broken) or MINT (revenue). But user specifically mentions off-chain pipeline beside them will hold/move real Bitcoin. Need audit that too. We can create findings under closest mechanic, e.g., revenue swap under MINT? But headings fixed. Maybe under SELL? No. Could include a subsection after eight? They say REPORT FORMAT. Under each of eight headings... Then final section. We should not add extra heading except maybe within THE INVARIANT include off-chain controls? But lock/distribute/revenue are not invariant? The invariant includes everything stays in vault until broken open; revenue is outside vault. But the pipeline moves cbBTC to vaults. Maybe put distribution under SELL? No. We need satisfy. Could mention in final 100% claims. But findings about lock should be somewhere. Maybe under UNBREAK because Bank co-signature and alarm? Or under THE INVARIANT because off-chain pipeline is part of guarantee? We can include "OFF-CHAIN PIPELINE FINDINGS" under THE INVARIANT as it is the overall guarantee. But user asked headings. We can put all off-chain under THE INVARIANT with note that they undermine the invariant's operational controls. Or under MINT because revenue from mint/royalties and distribution. Need decide later.

Need deeply analyze code for real defects. Must avoid false claims. Need evidence from tests/known facts. Need be careful. Let's reason thoroughly.

We have four programs: SEAL, BURN, MINT, GOV. New v5 pairing via instructions sysvar. Need answer a-f.

First understand Solana instruction introspection. Sysvar instructions account holds serialized transaction instructions? load_current_index_checked returns index of currently executing instruction within top-level transaction message. load_instruction_at_checked(i) returns instruction at index i if exists. It only sees top-level instructions in the message, not CPI. For versioned transactions? The sysvar instructions contains all top-level instructions including address lookup table resolved accounts? Need specifics. In versioned tx, instruction accounts may be loaded via ALT; load_instruction_at_checked returns CompiledInstruction with account indexes into message account keys? For v0 message, account keys include static keys plus loaded writable/read-only from ALT? I think sysvar instructions data includes compiled instructions with account indexes into the full account keys array after ALT loading? Need verify. But code uses ix.accounts.get(idx).map(|a| a.pubkey). In load_instruction_at_checked returns Instruction with AccountMeta list? The solana_program sysvar instructions helper deserializes into Instruction? It likely constructs Instruction with pubkeys resolved from message account keys, including ALT loaded addresses. Need know if ALT can affect binding. If accounts at index 0/2 can be ALT loaded, still pubkey resolved. So binding complete if account indices correct.

Potential issue: open_for_redemption scans from current+1 for burn. burn_vault scans 0..current for open. Both require same asset and owner. They don't require bank same? Bank checked in each handler by config. Both configs cross-check bank? SEAL config bank vs BURN config bank? burn reads seal config and requires collection and bank equal cfg.bank. open uses SEAL config bank. So bank must match both. If bank rotation diverged? BURN config bank must equal SEAL config bank via WiringDiverged. Good.

a) Can vault be thawed and not burned? Transaction atomicity: If any instruction fails, entire transaction fails and all writes reverted. So if open succeeds then later burn reverts, transaction fails and thaw reverted. But question: burn present but reverts in a way thaw survives? Solana atomic: no. Unless open is in separate transaction? It requires burn in same transaction. Could use durable nonce? Still transaction atomic. Nested CPI? open sees only top-level burn. If open called via CPI, current index is outer instruction? Let's examine. If a wrapper program CPIs SEAL open_for_redemption, inside SEAL load_current_index_checked returns index of the wrapper's top-level instruction? I think yes: current index is index in top-level transaction of instruction that caused current execution? For CPI, sysvar instructions current index returns top-level index of instruction being executed? Need exact: load_current_index_checked returns index of the instruction in the transaction that is currently executing. For CPI, is it the inner instruction? Sysvar instructions only top-level, but CPI stack? I recall sysvar instructions contains top-level instructions; current index for CPI is index of top-level instruction that invoked? Actually when program CPIs, the instruction being executed is not in top-level message; sysvar instructions current index maybe index of top-level instruction that is the origin? Let's verify from Solana docs: instructions sysvar can be used to inspect transaction instructions. load_current_index_checked returns index of current instruction in transaction. For CPI, I think it returns index of the top-level instruction that caused the invocation? There is `get_instruction_relative` and current index? In CPI, the instruction being executed is not in the top-level list, but runtime still tracks current instruction? Hmm. The author claims open reached BY CPI reports OUTER instruction's index, so wrapper would need genuine top-level burn later. Need prove/refute. If CPI current index is outer, then scanning from current+1 sees top-level after outer. If wrapper top-level contains CPI open and no top-level burn, open fails. If wrapper top-level includes burn later? But wrapper can't hide burn? If top-level burn exists for same asset/owner, open can thaw. Then wrapper could CPI open, then top-level burn? But burn requires preceding top-level open. If open is CPI inside wrapper at index i, burn at top-level j>i sees top-level instructions 0..j. Does it find open? It scans for program_id SEAL and discriminator at top-level index i? But top-level instruction at i is wrapper program, not SEAL. The CPI open is invisible. So burn fails NoPrecedingOpen. Thus wrapper cannot pair unless there is also top-level open. If top-level open exists, then normal. Could wrapper call open via CPI and also include top-level burn? burn won't find top-level open (unless also top-level open). Could include top-level open for same asset? Then thaw exists. But then wrapper not needed. Could top-level open and top-level burn for asset A, and CPI open for asset B? The top-level open for A paired with burn A; CPI open B sees current outer index maybe i (top-level open A?) Wait if wrapper is separate top-level after open A? Let's construct: top-level instruction 0: open A (SEAL). 1: wrapper CPI open B? 2: burn A? For open B via CPI, current index maybe 1 (wrapper top-level). It scans from 2 and finds burn A, but requires asset B and owner B? If burn A account index 0 asset A, not B, so no. If burn B top-level later, burn B requires preceding top-level open B, not present. So no.

Could two redemptions share transaction: open A, burn A, open B, burn B. open A scans later and sees burn A and maybe burn B. It requires matching asset/owner. Good. burn A scans earlier sees open A. Good. Could open A pair with burn B if same owner and asset? no.

Could a burn instruction be present but fail intentionally after open, but transaction atomic reverts open. No thaw survives.

Could open be executed, then later burn instruction is a different program with same discriminator? SEAL checks program_id == BURN_PROGRAM_ID. Good.

Could account indices be manipulated via address lookup tables such that ix.accounts.get(0) is not asset? For compiled instruction, account indexes can point to ALT loaded keys. But load_instruction_at_checked returns resolved pubkeys? Need if not, maybe index 0 could be program ID? Let's recall `load_instruction_at_checked` returns `Instruction` with `program_id` and `accounts` Vec<AccountMeta>. It uses `message.instructions[index]` and `message.account_keys` to resolve. For v0, account_keys includes loaded addresses from ALT? The sysvar instructions account data is created from sanitized message? I think it includes all account keys (static + loaded) and compiled instructions account indexes refer to that combined list. So pubkey resolved. If ALT lookup fails transaction fails before execution. So okay.

Could a durable nonce allow transaction to be executed later with different instructions? No, signature covers message.

Potential issue: instruction introspection with inner CPIs can be spoofed by program that writes to instructions sysvar? Sysvar is read-only, cannot.

Could a top-level burn_vault instruction be present but its accounts are not writable/signer as required? SEAL only checks pubkey at indices, not whether owner is signer or asset writable. But burn itself will enforce owner signer via Anchor `owner: Signer` and asset account? If burn instruction in same tx has owner at index 2 but not marked signer in compiled message? In transaction, account metas include is_signer. Anchor will require signer. If not signer, transaction fails at burn, reverting open. So no thaw. But could open succeed if burn present but will fail early due to missing signature? Still atomic.

Could open be thawed and burn skipped due to compute budget exceeded? Transaction fails, revert.

Could a successful open be included in a transaction where burn is present but not executed because instruction after open is a program that changes account data? No, all top-level instructions execute sequentially; if burn not reached due to prior failure, tx fails.

Thus a likely no.

But need look for subtle: open_for_redemption requires burn later in same transaction. It does not require that burn instruction's `bank` account equals config.bank? It binds asset and owner only. Burn will check bank. If burn instruction has wrong bank, burn fails, tx reverts. Fine.

Could an attacker cause open to match a burn instruction that is not actually BURN's burn_vault but some other instruction in BURN program with same discriminator? Discriminator is 8 bytes; BURN program only has burn_vault with that disc. If BURN upgraded maliciously, could have instruction with same disc but different semantics. But upgrade authority separate; if compromised, many things fail. Author claims drift fails closed. Need analyze c.

b) Can burn pair to different vault's thaw? Both bind account index 0 asset and index 2 owner. Is binding complete? Need consider if same owner has two vaults A and B. Transaction: open A, sweep A, burn B? open A scans for burn with asset A, owner A; burn B asset B so not found -> open fails. Transaction: open A, open B, burn A, burn B? open A sees burn A; open B sees burn B. burn A sees open A; burn B sees open B. Fine. Could burn B use open A if same owner? burn B scans for open with asset B and owner; open A asset A so no. Could account index 0 in open/burn be something else due to Anchor remaining accounts? The hardcoded indices assume account order. In BurnVault struct: asset 0, collection 1, owner 2, bank 3, asset_signer 4, payer 5, config 6, seal_config 7, instructions 8, mpl_core 9, system_program 10. In OpenForRedemption: asset 0, collection 1, owner 2, bank 3, payer 4, config 5, seal 6, mpl_core 7, instructions 8, system_program 9. Yes.

But introspection only checks pubkey at index 0 and 2. It does not check that the instruction's program_id account or data length? It checks data disc. It does not check that burn's `config` or `seal_config` are correct. Burn will check. It does not check that burn's `bank` is config bank. Burn will check. It does not check that burn's `asset_signer` PDA corresponds to asset. Burn will check via seeds. Good.

Potential missing: open's matching burn could be a burn_vault instruction for same asset and owner but with a different `declared` count or remaining accounts that will fail burn. That just makes open fail if burn fails. No leak.

Could burn pair to open that was not executed because open instruction earlier in tx is present but fails? burn scans top-level instructions before current regardless of success? Important: If an earlier open instruction is present but fails, does transaction continue? No, if any instruction fails, transaction aborts immediately; burn not executed. But what if earlier open is for same asset/owner but is a different program? It checks program_id SEAL and disc. If earlier open instruction exists but will fail due to e.g. wrong bank, then transaction fails before burn. No issue. If earlier open is present but skipped? No.

But there is a subtle case: burn requires preceding open. It scans instructions before current. It does not require that the open instruction actually succeeded, only that it exists. But Solana executes sequentially; if open earlier failed, burn wouldn't execute. If open earlier succeeded but later an instruction between open and burn fails, burn wouldn't execute. If burn executes, all prior instructions succeeded. So okay.

What about multiple top-level instructions with same index? no.

c) Hardcoded discriminator and account indices. Discriminator from name. Drift fails closed? Need examine. If BURN upgrade adds an account before index 2, then BURN_IX_OWNER_IDX in SEAL remains 2, but actual owner moves to 3. open scans for burn instruction with account index 2 equal owner. If index 2 is now something else (e.g., new account), match fails -> NoTerminalBurn -> thaw refused. Halt. If BURN upgrade adds account after index 2, match still okay if asset/owner positions unchanged. If BURN changes instruction name, discriminator changes -> fail. If BURN changes account order but accidentally index 2 still equals owner? Could pair but burn's actual owner check maybe at different index? If Anchor BurnVault struct changed but constants not, could open match an instruction where account 2 is owner but burn's actual owner is elsewhere? If discriminator same (name same), account list changed. Suppose BURN upgrade reorders: asset index 0, new account index1, owner index3, but index2 is some attacker-controlled account. SEAL checks index2 == owner (the signer passed to open). If attacker sets index2 to owner pubkey but burn's actual owner account index3 is different? Burn will require actual owner signer and asset owner equals it. If index3 is not asset owner, burn fails. If index3 is asset owner, then open's owner (index2) may be different? open requires ctx.accounts.owner == asset owner. So open's owner is asset owner. If burn's actual owner is asset owner too, but index2 also asset owner? Could be duplicate pubkey at index2 and index3. Then match succeeds. Is that a problem? Burn still requires actual owner signer. If duplicate, okay. But if BURN's actual owner index moved and index2 is some other pubkey equal to owner? The transaction can include duplicate accounts. If index2 is owner but not signer in burn's actual struct? Anchor will require signer at actual index. If actual index is owner and signs, fine. The pairing still binds asset/owner because index2 equals owner. But if actual burn can be called with owner at index3 different from index2? For open to succeed, index2 must equal open owner (asset owner). Burn's actual owner could be index3 = attacker not asset owner? Burn would fail asset ownership check. Could be index3 = same asset owner. So no leak. But if BURN upgrade changes semantics such that burn_vault can burn without owner signature but keeps name and account index2 owner? Then all bets off; BURN program compromised/upgraded. The claim is drift fails closed for account reordering, but a malicious/buggy BURN upgrade with same discriminator and same account 0/2 could bypass its own internal checks? Since SEAL trusts BURN program id and discriminator, if BURN upgraded to a malicious burn_vault that mints? It could thaw and not burn? But burn is separate upgrade authority. If BURN upgrade authority compromised, can destroy/burn incorrectly. But fail-closed only for accidental drift, not malicious upgrade. Need mention.

Specifically question c: "including a BURN upgrade that adds an account before index 2, or a Core upgrade?" If BURN adds account before index 2, owner index shifts, match fails -> halt. True. If Core upgrade? SEAL/BURN hardcode Core instruction indices and asset layout. Core upgrade could change BurnV1 opcode or plugin update opcode, but programs pin MPL_CORE_ID. If Core upgrade changes behavior, could fail. But Core is not under their control. If Core upgrade changes asset data layout, read_core_asset may misread. But mainnet Core cloned; upgrade authority? Metaplex could upgrade Core. Is that a risk? Core is immutable? It might be upgradeable? Need not invent. They say real cloned mainnet Core. A Core upgrade could break everything. But question asks drift fails closed in every case including Core upgrade? For Core upgrade, if Core instruction discriminator/opcode changes, CPIs fail, likely halt. But if Core upgrade changes BurnV1 to not close asset or change semantics, maybe burn not terminal. However Core program upgrade is outside. Need state not provable. But maybe Core is immutable? Metaplex Core program likely upgradeable? Need avoid false. We can say for BURN accidental drift true for reorders before bound indices; for Core upgrade no fail-closed guarantee except CPI failures if interface changes; if Core retains interface but changes semantics, all bets. But is that a finding? Maybe MEDIUM/HIGH under UNBREAK/TRANSFER? The system depends on Core program bytes and upgrade authority. Alarm watches program hash? Only their four programs, not Core. SPEC says runner pins Core hash for tests, but mainnet Core could upgrade. Need include as 100% claim gap. But maybe not a code defect? It is a dependency.

d) load_instruction_at_checked top-level only. Author claims load-bearing both directions and CPI wrapper cannot exploit. Need prove. We did. But need consider a top-level instruction that is not executed? All top-level instructions execute unless transaction fails. Could a wrapper program at top-level contain CPI open and later top-level burn? burn won't find open. Could a wrapper make burn CPI and open top-level? open requires burn top-level later; CPI burn invisible to open. So no. Could a wrapper use `load_instruction_at_checked` inside CPI to see top-level and spoof? No, only SEAL/BURN use. Could an attacker include a top-level burn_vault instruction with correct accounts but inside a program that intercepts? No, program_id must BURN. Top-level burn will execute after open. If open is top-level and burn is CPI inside wrapper later, open won't see CPI burn -> fail. Thus both directions require top-level. True.

But there is a subtle issue: If open is top-level, burn is top-level, but between them a wrapper CPIs another open for same asset? Could that affect state? open thaws; second open maybe tries thaw again? Core plugin update frozen=false when already false? Might succeed? But burn later burns. No issue. Could a wrapper transfer vault after open before burn? Transfer requires not frozen? Once open thawed, asset unfrozen. Transfer could happen between open and burn. Then burn's owner check: burn requires owner signer and asset owner bytes equal owner. If transfer changed owner to attacker, original owner no longer owner; burn with original owner fails, transaction reverts. But if transfer to a PDA? Then burn fails. Could transfer to burn's owner? The owner signer in burn is original owner; if asset transferred away, burn fails. So no contents leak? But open thawed, then transfer, then burn fails -> entire tx reverts, including thaw and transfer. Atomic.

Could between open and burn, an instruction modifies asset owner to same owner? no effect.

Could an instruction sweep contents to attacker but burn fails due to emptiness? If sweep is before burn and transfers all reserves to owner, burn succeeds. If sweep transfers to non-owner? The sweep uses Core ExecuteV1 requiring owner signature; owner can specify destination. In redemption, owner receives. If attacker is owner, fine. If bank co-signs, bank should only sign sweep to owner? Actually owner can sweep to anyone via Execute? Core Execute requires asset owner signature, and owner can include arbitrary instructions moving PDA tokens to any destination. Bank co-signature covers whole transaction, so Bank must refuse if sweep not to owner's account? The design says owner gets Bitcoin. But on-chain burn only requires emptiness, not destination. Owner can burn vault and send contents to any address they control (or anyone) in same tx. That's expected: owner can dispose. But if marketplace buyer basis? Not issue.

Could open thaw, then ExecuteV1 approves delegate, then burn? Burn refuses if delegate on declared reserve ATA left open. If sweep closes ATA, delegate gone. If approve on non-reserve undeclared account, burn may not see. Bank duty.

e) Transaction size. Redemption one tx with open + sweeps + burn. Measured 802 bytes with one reserve mint, 17 accounts. Reserve list additive up to 8. Does adding reserve mints strand every vault by pushing past ceiling? Need compute real maximum. Need consider each reserve mint requires two declared ATAs (classic SPL and Token-2022 derivation) in burn remaining_accounts. But for classic SPL mint, Token-2022 ATA derivation likely nonexistent. burn loops for each mint over both token programs, derives expected ATA, requires account in remaining_accounts. It then checks `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }`. So declared account can be a dummy? It must exist at that address? It finds by pubkey in remaining_accounts. If account doesn't exist, `acc.owner` is system program? It continues (skip) because not token program. But it still must be included as an account in transaction. For each reserve mint, two addresses must be in remaining accounts, even if one doesn't exist. With one mint, declare two accounts (classic ATA and T22 ATA). Test `declare` returns both. For 8 mints, 16 extra accounts. Each account in legacy transaction adds 32 bytes if not in header? Actually compact account metas. 17 distinct accounts with 1 mint. Additional reserve mint adds two token accounts (maybe distinct) plus mint? The mint itself not passed to burn. Sweep for each reserve adds instructions: transferChecked (or transfer) and close account. Need accounts: source ATA (PDA), destination ATA (owner), PDA signer via Core Execute, token program. ExecuteV1 instruction includes inner instructions? The sweep is built via Core ExecuteV1, which wraps arbitrary instructions. The transaction includes ExecuteV1 top-level with accounts asset, collection, payer, authority owner, system? plus inner instructions serialized in data? In test, `execute` returns instructions: likely one Core ExecuteV1 instruction with data containing inner instructions. For each reserve, inner instructions add bytes and maybe accounts? Core ExecuteV1 account list may include asset, collection, payer, authority, system program, optional? Inner instructions' accounts must be included in top-level ExecuteV1 account list? Metaplex Core ExecuteV1 takes a list of instructions and accounts? Need know. The test's `sweep` uses `execute(umi, {asset, collection, instructions: ixs, signers, authority})` and maps returned instructions. It likely creates one ExecuteV1 instruction whose accounts include all accounts needed by inner instructions? In mpl-core ExecuteV1, accounts: asset, collection, payer, authority, system_program, maybe instructions? Data includes serialized instructions? Actually Core ExecuteV1 can execute arbitrary CPIs; the instruction data includes a Vec of instructions and the account list must include all accounts for those instructions plus signers. So each additional reserve sweep adds accounts: source ATA, destination ATA, mint, token program, maybe close authority? The PDA signer is included as noop signer? ExecuteV1 requires asset owner signature, not PDA; Core derives asset_signer PDA internally and signs CPI. The inner token transfer uses PDA as authority; the PDA pubkey must be in account list but not signer. Close account uses PDA. So additional accounts per reserve: source ATA (already maybe declared in burn), destination ATA (owner's ATA for that mint), mint, token program. Some may overlap. Burn requires declared source ATAs (two per mint) and maybe destination not. So transaction size grows significantly.

Need estimate maximum reserve mints in legacy 1232 bytes. They measured 802 bytes for 1 mint, 17 distinct accounts. Additional mint maybe adds: burn declared 2 accounts (64 bytes in message account keys plus 1 byte in instruction account index? Actually each unique account in message adds 32 bytes in account keys plus account meta in instruction). Execute inner data adds transferChecked instruction (accounts 4? source, mint, dest, authority) + close (3? account, destination, owner) serialized. Also burn instruction data declared u8 unchanged, but remaining accounts count increases; each remaining account in instruction adds 1 byte index. open instruction unchanged. Need rough. 802 with 1 mint. Headroom 430. Each extra reserve maybe >100 bytes. Max likely 3 or 4. Need be precise enough? User asks "What is the real maximum? Does an address lookup table actually rescue it, given open and burn both need the same accounts?" We need answer. Could compute from Solana legacy tx limits: 1232 bytes max. Account addresses: message header + blockhash 32 + account keys 32*n + instructions compiled. Signatures: 2? owner and bank and payer? In redemption, owner signer, bank signer, payer signer maybe bank? Test uses bank as payer? ixOpen has payer bank writable signer; ixBurn payer bank; sweep execute payer? authority alice, payer bank? Transaction signers [bank, alice]. So two signatures (fee payer bank, owner alice). 2*64=128 + message. 17 accounts => 32*17=544 + header 3 + blockhash 32 = 707. Instructions compiled: each instruction has program id index 1, account indices length compact, data length compact. open 10 accounts, burn 11+2=13? sweep Execute maybe many. Total 802. Additional accounts add 32 each plus instruction index bytes. ALT can reduce account key size? Versioned transaction with ALT: account addresses loaded via table, message uses 1 byte index? Actually v0 message has static account keys plus address table lookups; writable/read-only loaded addresses are not repeated in static keys, but lookup table account and indexes. It can reduce size if many accounts already in ALT. But each instruction still references accounts by 1-byte index into combined message account list. ALT lookup entries cost: table pubkey 32 + indexes bytes + maybe bitmap. For each lookup table, message includes table address and list of indexes. If all accounts in one ALT, cost 32 + compact len + indexes (1 byte each) + maybe 1 byte per lookup? Need compare. It can rescue up to more accounts. But open and burn both need same accounts? They need asset, collection, owner, bank, payer, configs, seal, instructions, core, system. Those are static. Reserve ATAs only burn and sweep. ALT can load reserve ATAs, destination ATAs, mints, token programs. But open and burn both need instructions sysvar? Sysvar cannot be in ALT? It can be loaded? Address lookup tables can include any address, including sysvar? I think sysvar addresses can be loaded via ALT? Some sysvars not? Instructions sysvar maybe can be in ALT. But even if ALT rescues byte size, compute unit limit may be issue. Also burn requires remaining_accounts count declared u8, max 255. 16 reserve accounts okay. But transaction account count limit: max 64 accounts per transaction? Solana transaction can include up to 64 accounts? Actually max account keys in legacy message is 64? Because instruction account indexes are u8 and there are reserved program ids? I recall transaction max 64 account addresses. Versioned with ALT can load more? Total loaded accounts max 64? Let's recall: Solana transaction message account keys length max 64? Instruction account indexes are u8, but compiled message uses 1-byte indexes, so max 256? However runtime limit: 64 accounts per transaction? There is a limit of 128? Need know. There is max 64 account keys in a message? I think legacy transaction max accounts is 64 due to bitset? Let's verify memory: Solana transaction can have up to 64 account metas? The 1232 byte limit with 32-byte pubkeys gives theoretical ~35 accounts if no instructions, but with ALT can reference more? There is also max 64 address table lookups? Hmm. Need avoid false. The test says 17 distinct accounts. Adding 8 mints: each mint two declared burn accounts =16, plus destination ATAs maybe 8, mints 8, token program maybe 1, etc. Could exceed 64? Let's estimate: base 17 includes: SEAL, BURN, CORE, System, Token? Actually with one mint: accounts likely: asset, collection, owner, bank/payer, SEAL config, seal PDA, Core, instructions, System, BURN config, seal_config for burn, asset_signer PDA, reserve ATA classic, reserve ATA T22 (nonexistent), owner destination ATA, mint, Token program? 17. Additional mint adds: source classic ATA, source T22 ATA, owner dest ATA, mint. Token program same. So +4 distinct accounts per mint. For 8 mints: 17 + 7*4 = 45 distinct accounts. Plus maybe burn declared accounts includes both token programs for each mint, yes. 45 under 64. Instruction data may exceed. With ALT, can reduce 32*45=1440 alone >1232, so legacy impossible for 8. ALT can load 45 accounts: static maybe 10, ALT indexes 35 bytes + table 32 + etc, possible. But open and burn need same accounts? ALT doesn't require duplicate; instruction indexes refer to loaded accounts. So yes ALT can rescue byte size up to account limit. But does open and burn both need same accounts? They both need instructions sysvar, configs, etc. ALT can include them. However Anchor account constraints with `Account<'info, Config>` etc require account infos passed; using ALT is client-side. Programs don't care. But there is a catch: instruction introspection `load_instruction_at_checked` returns account metas. In versioned transaction with ALT, does it return pubkeys for accounts loaded via ALT? I think yes. If not, binding fails. Need verify. Solana sysvar instructions for v0 supports ALT? There was a limitation: instructions sysvar only contains static account keys? Let's recall. The instructions sysvar is constructed from the message; for versioned messages, account indexes may refer to loaded addresses? I think since v0, the sysvar instructions account includes all account keys (static + loaded) in the loaded message. But `load_instruction_at_checked` may fail for instructions that use ALT? Need know. There is `load_instruction_at_checked` that takes a sysvar and returns `Instruction`; it uses `sysvar::instructions::load_instruction_at` which reads compiled instruction and account metas from the transaction message. For v0, the message includes address table lookups, not loaded addresses? The sysvar data might not include ALT loaded addresses? Actually the instructions sysvar is a serialized `Message`? Let's recall implementation: The sysvar instructions account data is not a full message; it's a custom serialization of instructions with account metas? It may only support legacy messages? There is feature `instructions_sysvar_updated`? Hmm. In Solana, the Instructions sysvar contains the instructions in the transaction, but for versioned transactions it may not include address lookup table loaded addresses? Let's search memory: `load_instruction_at_checked` is safe for instruction introspection. It returns `Instruction` with `accounts` Vec<AccountMeta>. For v0 messages, the runtime fills in account keys from loaded message including ALT? I think yes because sanitized message includes loaded addresses. But there were issues: sysvar instructions cannot be used with ALT? Let's reason: The transaction message account keys include static keys plus loaded writable/read-only keys. The compiled instruction account indexes refer to this combined list. The sysvar instructions data likely includes number of instructions and for each: program_id index, account indices, data. It also includes the message account keys? Actually to return pubkeys, it must have account keys. The sysvar instructions account data is built from the message, includes account keys. For v0, it may include loaded addresses. So likely works.

But there is a more serious issue: open_for_redemption scans top-level instructions and matches BURN instruction by account index 0 and 2. If the burn instruction uses an address lookup table for the owner account at index 2, load_instruction_at_checked returns pubkey, okay. But if the BURN instruction's account list length is large and uses ALT, index positions remain. Good.

However, ALT may allow hiding the burn instruction? No, top-level still visible.

Real maximum: Need maybe compute exact with legacy and ALT. Could derive from code/test. They measured 802 bytes for 1 reserve. Need estimate per additional reserve. Let's approximate. Additional reserve mint adds to burn remaining accounts 2 (source ATAs). It also adds sweep inner instructions: transferChecked (or createTransferInstruction) and close. In test with one mint, sweep uses `createTransferInstruction` (not checked) and `createCloseAccountInstruction`. For each additional mint, need transfer instruction (accounts 3: source, dest, authority) and close (accounts 3: account, destination, owner). But inside Core Execute, inner instructions are serialized with program_id and accounts? Core ExecuteV1 data includes instructions maybe using Anchor `Instruction` with program_id and account metas? Each inner instruction adds program_id pubkey? If program id is in account list? Need not exact.

The question asks "Does adding reserve mints strand every vault by pushing redemption past the transaction ceiling? What is the real maximum? Does an address lookup table actually rescue it, given open and burn both need the same accounts? THE AUTHOR BELIEVES THIS IS THE MOST LIKELY WAY THE NEW DESIGN KILLS SOMEBODY'S BITCOIN." We need provide evidence-based answer. We can say with legacy transaction, max is likely 3 reserve mints (maybe 4) given 802 at 1 and each extra reserve adds ~150-180 bytes; 8 impossible. ALT can rescue byte size but not compute units and not if introspection fails? Need be precise. Let's attempt calculate more accurately.

Solana legacy transaction size: signatures (compact u16? 1 byte for count + 64 each). For 2 signatures: 1+128=129. Message: header 3, blockhash 32, account keys count compact (1 byte if <=127) + 32*N, instructions count compact (1) + compiled instructions.
802 total for N=17. So message+instr = 673. Account keys = 1+544=545. Header+blockhash=35. So instructions compiled = 673-580=93 bytes? That seems too low. Wait 802 includes signatures? Test serialize with requireAllSignatures false maybe includes signatures? It sets feePayer and recentBlockhash but not sign? serialize({requireAllSignatures:false}) likely includes empty signature placeholders? For 2 signatures maybe 128. If 802, message 674. Account keys 545, header/blockhash 35 => 580, leaving 94 for instructions. That seems small but possible: open instruction: 1 prog index + compact accounts len (10 -> 1 byte) + 10 account index bytes + data len (1? disc 8 -> 1) + 8 = 21. burn: 1 + len 13? (11 fixed +2 extra =13) +13 + data len 9 (disc+declared) +9 = 34. Execute instruction maybe many accounts/data? 94-55=39, too small. Maybe account keys count not 17? Or serialized size includes more. Let's not rely.

Actually `Transaction.serialize` with requireAllSignatures false may serialize message only? It might include signature placeholders? It likely includes signatures if fee payer set? If no signatures, maybe 0 signatures? It may serialize message only? The size 802 maybe message only? Hmm.

Need not exact. We can state need empirical measurement. But user asks real maximum. As auditor, we can compute conservative bound from known 802 and approximate. Could say at 1 mint 802; each additional classic reserve adds at minimum: two burn-declared ATAs (64 bytes account keys + 2 instruction index bytes), a destination ATA (32), mint (32), two inner CPI instructions (transfer+close) serialized inside ExecuteV1 (~70-100 bytes), plus Execute account indices (~6-8). Total ~170-200 bytes. 1232-802=430, so legacy supports at most 2 additional mints, i.e. 3 reserve mints total; possibly 4 if optimistic but not 8. Need be defensible. Let's estimate +150 => 3.9. If +200 => 3.15. So real max 3. With 8, stranded unless ALT/versioned. But if reserve list already 3 intended (cbBTC, GARY, GIRAFFISH), then no room to add. The spec says three intended reserve mints. If 3 mints, transaction may be near or over 1232. They measured 1 mint 802. Adding two mints maybe +300-400 -> 1100-1200, maybe fits barely. Adding third extra fails. So max 3 likely. Need mention must measure with actual three mints; if 3 intended already, any additive reserve strands.

ALT rescue: Versioned tx with ALT can reduce account key repetition, but open and burn both need same accounts? ALT loads accounts once; instructions reference by index. It can rescue account-key byte cost. However inner Core ExecuteV1 still must include all sweep accounts, and burn remaining accounts. ALT lookup costs: one table address (32) + 1 byte per loaded index + maybe writable/read-only counts. If many reserve accounts are in table, saves 32 bytes each but adds 1 byte each. Net saving ~31 bytes per account. For 45 accounts, saves ~1000 bytes, so yes can fit. But there are caveats: ALT cannot include the instructions sysvar? Actually can, but if not, static. Also the bank must sign the versioned transaction; simulation. The programs' introspection must resolve ALT accounts. Need verify on validator. If load_instruction_at_checked does not resolve ALT, pairing fails closed (redemption halts), not leak. But could it cause open to not find burn even though present, stranding. So ALT rescues only if introspection supports ALT. Need test. The author asks "given open and burn both need the same accounts?" Yes, same accounts can be loaded once; no issue. But if open and burn require signers, ALT cannot load signers? Signers must be static? In v0, signers can be in static account keys only? Address table lookups cannot be signers? I think ALT accounts cannot be signers? Actually loaded addresses can be writable/read-only but not signers? The message header numRequiredSignatures applies to static account keys; ALT loaded accounts cannot be signers. Owner and bank must be static signers. Asset and collection writable non-signers can be ALT. Payer signer static. So open/burn signers static. The same accounts needing signer (owner, bank, payer) cannot be ALT, but they are few. Reserve ATAs non-signers can be ALT. So rescue.

But there is another issue: Anchor `Signer<'info>` for owner/bank requires account is signer in transaction. If loaded via ALT as non-signer impossible. So keep static.

Compute units: Each reserve sweep adds CPI token transfer/close, burn loops over 2*reserves and remaining accounts. With 8 reserves, CU may exceed 1.4M? Need mention. Could strand due to compute budget even if bytes fit. Need estimate. burn loops 8*2=16 accounts, checks data; not heavy. Execute inner transfers maybe 200k each? Could exceed. Need set priority. But not sure.

f) burn_vault requires preceding open. Does that create any way to strand a vault that could previously be destroyed — e.g., vault whose SEAL thaw fails for reason burn would not have cared about? Under old design burn_vault maybe didn't require open? Actually v5 burn requires open. If open fails due to e.g. ForeignVault, NotTheOwner, NotTheBank, NoTerminalBurn, etc. Burn would also fail many. Could there be a vault that could be burned empty under old (without open) but now cannot because open fails for a reason unrelated to emptiness? Example: vault transferred to PDA owner (bricked). open requires owner signature; burn requires owner signature too (owner Signer and asset_owner == owner). So both fail. Vault with wrong collection? burn checks collection; open checks too. Bank lost? open and burn both require bank; old burn maybe required bank? v5 burn requires bank. If bank lost, cannot burn. But could previously destroy? If old burn required bank? It says owner+Bank signatures for burn? TRUE 2-of-2 every open and burn needs owner+Bank. So no.

What about a vault that is already thawed? There is no persistent thaw because open only in same tx. But if a vault was thawed under v2-v4 and never closed? v5 upgrade might leave asset frozen=false. burn requires preceding open in same tx. Can you open again? set_frozen(false) when already false maybe Core update plugin? It might succeed or fail? If already unfrozen, open_for_redemption could still run (it calls set_frozen(false)). Core UpdatePluginV1 with same value maybe succeeds? If it fails because plugin already in that state? Need know. If it fails, burn cannot pair, stranding previously thawed vault. But under v5 no thaw should persist? Migration from v2-v4 could have vaults marked redemption opened and thawed. The code says close deleted. If existing thawed vaults from old versions exist, burn requires open. If open cannot re-thaw an already thawed asset (Core error?), then cannot burn. But nothing has minted? SPEC says nothing has minted. But for mainnet if upgrade after v2? They say nothing holds real value. But question asks could strand a vault that could previously be destroyed. If asset is already unfrozen, open might still succeed? Core UpdatePluginV1 to frozen=false likely idempotent? Need not assume. If it errors due to plugin already in requested state? Metaplex Core might not error; it updates. Could be. Need flag as migration risk if any v2-v4 thawed vaults exist. But known: nothing minted? Still maybe test environment. Could be MEDIUM.

Another strand: open_for_redemption requires a terminal burn later. If burn would fail due to transaction size (reserve list too large), open fails too, so vault cannot be redeemed. Previously under v2-v4, could open in one tx, sweep in multiple txs, close in another; transaction size per reserve could be split. Now all in one, so large reserve list strands. That's e.

Also burn requires open even for empty never-funded vault. open requires bank and terminal burn. If bank refuses or unavailable, cannot destroy mis-mint. But old burn maybe required bank too. The author says never-funded mis-mint served by same shape with no sweep. If bank key lost, cannot burn. But rotation exists.

Need inspect other mechanics for defects.

MINT:
- mint_vault price, lifetime cap, round window, owner+Bank signatures, provenance attributes, collection binding.
Potential issues:
1. `mint_vault` reads SEAL config canonical wiring: collection and bank. It checks config.collection == seal collection, config.bank == seal bank. But does not check BURN config bank/collection. BURN reads SEAL config and checks against its own. If BURN config diverged, mint could proceed but burn fail? BURN initialize/update can rotate bank/collection? collection not rotatable in BURN update_config? It has update_config(bank, admin) no collection. Initialize sets collection. If BURN collection wrong, burn fails ForeignVault. Mint checks only SEAL. Could mint vaults unredeemable if BURN config collection diverged. But BURN config initialized separately; alarm watches collections_disagree across four programs. On-chain not enforced in mint. Is that a finding? Cross-program wiring: MINT and BURN read SEAL config canonical. BURN reads SEAL and compares to BURN config. MINT reads SEAL and compares to MINT config. If BURN config wrong, BURN refuses burns (halt), not leak. Could strand. But alarm. Maybe MEDIUM: mint does not refuse if BURN config diverged, so could sell vaults that cannot be redeemed until BURN config fixed (but collection immutable? BURN collection not rotatable, so if wrong at init permanent? BURN initialize one-time; if wrong collection, burn impossible for all vaults. Mint could still mint if SEAL/MINT agree. Need include? But initialization by INIT_AUTHORITY. Maybe LOW/MEDIUM.

2. `mint_vault` attributes: MINT delegates Attributes plugin authority to SEAL PDA, but SEAL no longer writes attributes. Dangling capability. Is it reachable? MINT creates asset with plugin Attributes and authority address SEAL PDA. The SEAL program has no instruction to update attributes. But SEAL PDA is also authority for PermanentFreezeExecute. Could SEAL's `core_plugin_cpi` be used to update arbitrary plugin? It only calls set_frozen with data UpdatePluginV1, plugin 17, frozen. No attributes. No other instruction. Could an attacker use SEAL PDA as authority for Attributes via Core directly? The PDA cannot sign except via programs that own it. Only SEAL can invoke_signed with seed "seal". It only does freeze update. So not reachable. But MINT still refuses "redemption" attribute for stamp no longer exists. Leaving it is harmless but confusing. Dangling authority: If future SEAL upgrade adds attribute-writing instruction, could modify provenance of existing vaults? Since Attributes plugin authority is SEAL PDA, an upgraded SEAL could rewrite attributes. Upgrade authority risk. But current no. Need mention as LOW: unnecessary capability expands upgrade blast radius; remove by setting authority to none or owner? But permanent? Plugin authority can be updated? At mint, could set Attributes authority to none? Core plugin authority maybe can be set. If attributes are immutable? They can be updated by authority. To reduce, set authority to asset owner or none? But provenance should be immutable? If owner can edit, bad. Maybe set authority to unattainable? But Core may require. Since SEAL no longer needs, set Attributes plugin authority to `Pubkey::default()`? Need know Core. Could leave as finding: dangling capability and stale reserved attribute check; fix by removing authority or documenting.

3. Mint price: payer sets max_price_lamports. If price=0 charter legal. Revenue goes to revenue PDA. Bank co-signs. Owner signs. Good.
4. Lifetime cap: `minted_total < max_supply`, `max_supply` ratchets down. Good.
5. Round window: `now >= opens_at && now < closes_at`. set_round bounded. Good.
6. Collection binding: collection update authority is MINT PDA, so only mint_vault can create asset in collection. But `mint_vault` does not explicitly verify collection's update authority is mint_authority; Core CreateV2 with collection and mint_authority signer will enforce. It passes mint_authority PDA signed via invoke_signed. Good.
7. MINT `update_wiring` governance gate: needs_governance includes sol_reserve_lamports any change, governance_timelock_secs any, max_sweep if raise or below floor, sweep_cooldown if lower or above max admin. But then later for max_sweep_lamports it only checks `x > 0 && x <= MAX_SWEEP_LAMPORTS`, not `x >= MIN_ADMIN_SWEEP_LAMPORTS` when governance signs. So governance can set below working floor? The code comment says admin may tighten only as far as working pipeline; past these holders involved. `needs_governance` true if x < MIN_ADMIN_SWEEP_LAMPORTS. Then governance can set x=1? It checks x>0 and <=MAX. So yes, with governance, cap can be set to 1 lamport, wedging pipeline. Is that intended? It says even governance cannot raise cap past 50 SOL (test 6.20i). But can governance set cap below 1 SOL? Test? 6.20g admin alone below floor REJECT. No test for governance below floor. The code allows governance to set any positive <=MAX. The comment: "admin may tighten only as far as a WORKING pipeline: past these, the holders are involved." So with governance (holders) it may wedge? Maybe deliberate: holders can decide to stop pipeline. But standing alarm flags wedge. Not a security hole? Could be griefing by governance. But governance can already set rounds. Maybe LOW.

Similarly sweep_cooldown: needs_governance if x < current or x > MAX_ADMIN_SWEEP_COOLDOWN_SECS. Then later require within MIN..MAX (1s..7d). Governance can set 1s (not operational) or 7d. Admin alone can raise to max 24h, not 7d. Governance can set 7d. Deliberate.

sol_reserve_lamports: any change needs governance, can set zero or rent-exempt. Fine.

8. `update_wiring` bank rotation uses `governance_timelock_secs` not separate ROTATION_NOTICE_SECS. If timelock floor 60s, bank rotation can be fast if launch config low. Alarm asserts days. On-chain floor low. Known.

9. `apply_pending_admin` uses `ApplyPendingGovernance` accounts (config only). It checks pending_admin. Good. But `apply_pending_bank` and operator same. Permissionless. Good.

10. `set_collection_royalties`: requires admin and governance signer. But after governance becomes GOV PDA, cannot sign, so royalties can only be set before or via governance rotation. Known. If need update royalty later, must rotate governance to a key, set, rotate back? Timelock. This is a liveness issue. Could be MEDIUM under ROYALTY. Also if initial governance is key and then rotated to PDA, no on-chain route to adjust royalties without temporarily replacing governance. But business can. Need mention.

11. Royalty plugin: basis_points <= 1000. One creator revenue PDA at 100%. RuleSet None. Does Core enforce royalties? Marketplaces may. No on-chain enforcement. Need under ROYALTY. Potential issue: `set_collection_royalties` uses `add` bool. If plugin already exists and add=true, Core may error; if not exists and add=false, error. No security. Could set royalty to 0? basis_points 0 allowed? require <= MAX, no minimum. 0 royalty possible with governance+admin. Could be policy. Maybe LOW.

12. Revenue split: `split_revenue` reads revenue ATA balance and transfers entire balance to holders/bank. It does not check mint decimals except caller passes decimals. If wrong decimals, transferChecked fails? It uses TransferChecked with provided decimals. If mint has different decimals, token program rejects. Good. It floors bank cut. But if `bank_cut == 0`, skips; holders get all. If total small, okay. Destination ATAs must exist; if not, transfer fails. Permissionless. Could an attacker pass a mint with revenue ATA balance but wrong holders/bank ATAs? They are derived from config and checked. Good.

Potential issue: `split_revenue` uses `ctx.accounts.revenue_ata` balance as total and transfers entire balance. If there are multiple tokens in revenue ATA? Only one mint per call. If someone sends cbBTC to revenue ATA, split moves it. Fine. If revenue ATA has delegate? Transfer by PDA owner? The PDA signs via invoke_signed; delegate doesn't matter. If revenue ATA has close authority? Not checked. Could a close authority drain revenue ATA? Token account close authority can close account and send lamports to destination, but cannot move tokens unless delegate? Close authority can close if balance zero. If balance non-zero, close fails. So okay.

13. `sweep_sol_for_swap`: requires swap_operator signer, amount <= cap, cooldown, reserve. It transfers from revenue PDA to `ctx.accounts.swap_operator.key()`, which is signer and checked equals config.swap_operator. Good. But `swap_operator` account is mutable signer; system transfer credits. Fine. Paused stops sweep. Good.

14. MINT config padding: space includes padding. But `MintConfig` struct has many fields; need ensure space calculation matches. Could be off? They have comments. If space too small, init fails. If too large, okay. But Borsh trailing padding ignored. However Anchor `Account<Config>` deserializes all fields; trailing bytes ignored? Borsh deserialize stops after struct, doesn't require exact length. So padding okay. But if future append within padding, need realloc? They allocate padding but struct doesn't include padding field. When appending field, space already enough, but Anchor deserialize will read new field if program upgraded; old account data has zeros? If new field appended after padding? Wait padding is at end of allocated space, but struct fields currently end before padding. If future field appended to struct, it will be serialized at current end, within padding bytes. Existing accounts have uninitialized padding bytes (zeros? init zeroed). Deserialization of new field will read zeros. Need migration maybe. But room exists. Good.

But SEAL Config has `reserve_mints: Vec<Pubkey>` before pending fields. Space allocated 4 + 32*MAX + ... Padding after. If reserve_mints length less than max, pending fields are serialized immediately after actual vec length, not after max. The space calculation includes max but actual data length is smaller. If later append field after pending, within allocated? Yes if actual len + new field <= allocated. But raw offset readers (MINT/BURN) read pending fields? BURN reads only up to reserves. Alarm reads pending bank/admin at offset after reserve vec length dynamically. Good.

Potential issue: SEAL `Initialize` space includes `4 + (32 * MAX_RESERVE_MINTS) + 1` for reserve vec and bump? Let's parse: 8 +1 version +32 admin +32 collection +32 bank +4 reserve vec len +32*8 +1? Then +32+8+32+8 + CONFIG_PADDING. But struct fields after reserve_mints: pending_bank(32), pending_bank_at(8), pending_admin(32), pending_admin_at(8), bump(1). The space line: `8 + 1 + 32 + 32 + 32 + 4 + (32 * MAX_RESERVE_MINTS) + 1 + 32 + 8 + 32 + 8 + CONFIG_PADDING`. The `+1` after reserves maybe bump? But then pending fields after bump? Struct order: reserve_mints, pending_bank, pending_bank_at, pending_admin, pending_admin_at, bump. So space should be 8+1+32+32+32+4+32*MAX +32+8+32+8+1 + padding. Their line has +1 before pending fields, so they allocated bump before pending? But Anchor space calculation just total size; order doesn't matter for total. Total includes +1. Good.

But BURN raw offset reads SEAL config: OFF_VERSION=8, OFF_COLLECTION=41, OFF_BANK=73, OFF_RESERVES=105. Let's verify struct: disc 0-7, version 8, admin 9-40, collection 41-72, bank 73-104, reserve_mints vec len 105-108, items 109..., pending after. Good. They don't read pending.

MINT raw offsets for SEAL: OFF_VERSION 8, OFF_COLLECTION 41, OFF_BANK 73. Good.

GOV reads MINT config offsets. Need verify MintConfig layout:
disc 0-7
version 8
admin 9-40
collection 41-72
bank 73-104
governance 105-136
treasury 137-168
round_id u32 169-172
opens_at i64 173-180
closes_at 181-188
price 189-196
cap u32 197-200
minted_this_round u32 201-204
minted_total u64 205-212
max_supply u64 213-220
bank_treasury 221-252
split_bps u16 253-254
paused bool 255
swap_operator 256-287
sol_reserve 288-295
bump 296
then max_sweep 297-304
cooldown 305-312
last_sweep 313-320
pending_gov 321-352
pending_gov_at 353-360
gov_timelock 361-368
pending_admin 369-400
pending_admin_at 401-408
pending_bank 409-440
pending_bank_at 441-448
pending_operator 449-480
pending_operator_at 481-488.
Alarm reads these. Good.

Potential issue: MINT `Initialize` space calculation: `8 + 1 + 32*5 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 32 + 8 + 1 + 8 + 8 + 8 + 32 + 8 + 8 + 32 + 8 + 32 + 8 + 32 + 8 + CONFIG_PADDING`. Need count fields: version1, admin,collection,bank,governance,treasury (5*32), round_id4, opens8,closes8,price8,cap4,minted_this_round4,minted_total8,max_supply8,bank_treasury32,split_bps2,paused1,swap_operator32,sol_reserve8,bump1,max_sweep8,cooldown8,last_sweep8,pending_gov32,pending_at8,gov_timelock8,pending_admin32,at8,pending_bank32,at8,pending_operator32,at8. Sum matches? 8+1+160+4+8+8+8+4+4+8+8+32+2+1+32+8+1+8+8+8+32+8+8+32+8+32+8+32+8 =? plus padding. Good.

15. MINT `update_wiring` emits WiringUpdated with current values but not pending rotations. It emits separate events. Fine.

16. MINT `set_round` does not check `opens_at` in future. It allows past opens_at, as long closes > opens and duration <= year. Governance could set round already started or ended? execute_proposal checks proposal.closes_at > now. But direct set_round by governance key (before PDA) could set past? If governance is key, could set round opens_at now-60 closes now+3600. That's used in tests. If closes_at <= now, mint fails RoundClosed. Not security.

17. MINT `mint_vault` owner must sign, bank must sign. But `payer` is also signer and mutable. In accounts, `payer` is separate from owner and bank. In test, payer=bank. Could payer be anyone? Yes, if bank co-signs and owner signs, payer can be third party. Price transfer from payer to revenue. That's fine.

18. MINT `mint_vault` does not check `asset` is new? Core CreateV2 will fail if exists. Good.

19. MINT `mint_vault` builds CreateV2 data with plugins. Need parse: `data.push(1); data.extend_from_slice(&2u32.to_le_bytes());` number of plugins? Then plugin permanent freeze execute: push PLUGIN_PERMANENT_FREEZE_EXECUTE (17), push 1 frozen, push 1; push PLUGIN_AUTHORITY_ADDRESS; push seal_pda bytes. Then plugin attributes: push PLUGIN_ATTRIBUTES, attributes list, then `data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref()); data.push(1); data.extend_from_slice(&0u32.to_le_bytes());` Wait number of plugins set to 2, but after attributes there seems extra authority? Let's inspect Core CreateV2 plugin encoding. They push 1 (Option collection? maybe has collection), then 2 plugins. For each plugin: plugin type, then plugin data, then authority? The code: 
```
data.push(1); // collection? maybe Option<Collection> = Some?
data.extend_from_slice(&2u32.to_le_bytes());
data.push(PLUGIN_PERMANENT_FREEZE_EXECUTE);
data.push(1); // frozen
data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref());
data.push(PLUGIN_ATTRIBUTES);
data.extend_from_slice(&(attributes.len() as u32).to_le_bytes());
for ...
data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref());
data.push(1); data.extend_from_slice(&0u32.to_le_bytes());
```
Maybe first `data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); ...` is authority for permanent freeze plugin. Then after attributes, authority for attributes. Then final `data.push(1); data.extend_from_slice(&0u32.to_le_bytes());` maybe Option<plugins> for collection? Not sure. Could be wrong encoding but tests pass (2.3/2.3a). So okay.

20. MINT attributes max 8 and 128 bytes. Could attributes be too large for transaction? Mint transaction size maybe. Not critical.

UNBREAK (open+burn):
Need analyze deeply for faults.

SEAL open_for_redemption:
- Reads asset owner/collection via raw data. Requires asset.owner == MPL_CORE_ID, len>=66, key=1, ua disc collection. Good.
- require owner == ctx.owner, collection == config.collection, collection account == collection, bank == config.bank.
- Scans later instructions for BURN_PROGRAM_ID, disc, account 0 asset, account 2 owner.
- set_frozen(false) via Core UpdatePluginV1. Payer signs, seal PDA signs. Good.

Potential faults:
A. The matching burn can be present but not executable due to account order? It only checks indices. If BURN instruction has correct asset/owner at 0/2 but is not actually a valid burn (e.g., missing required accounts), open may thaw, then burn fails, tx reverts. No issue. But could open's Core thaw have side effects that are not reverted if CPI fails later? Solana reverts all account changes on transaction failure. Yes.

B. `set_frozen(false)` occurs after matching burn found. If Core CPI fails (e.g., plugin authority wrong), open fails. No thaw.

C. The burn instruction could be a valid burn for same asset/owner but its `bank` signer is not config.bank? Burn fails, revert.

D. Introspection account indices and data: It checks `ix.data.len() >= disc.len()` and disc. It does not check instruction data after disc, e.g., `declared` count. Burn will check. Fine.

E. The burn instruction might be in same transaction but before open? open scans only later. If burn before open, open fails. Could burn before open still burn? burn scans earlier open, fails. So no.

F. Two opens one burn: open A scans later and sees burn A? If only burn B? no. If one burn for A, open B might also see burn A if asset/owner same? If A and B different assets same owner, open B requires burn B asset. no. If same asset duplicate open? open A first sees burn A; second open A later (before burn) also sees burn A. Both could succeed? If duplicate open for same asset in same tx, first thaws, second attempts thaw again. If Core update frozen=false idempotent, both succeed. Burn once. No issue. If second open fails, tx reverts. Could be used to grief? no.

G. Could an attacker include a matching burn instruction but make it not execute by using a program that consumes compute before? If compute budget exceeded, tx fails. no.

H. Could open be called via CPI and current index behavior different? We think safe.

I. Important: The instructions sysvar account must be passed to open and burn. Anchor checks address. But if transaction uses versioned message with ALT, `load_instruction_at_checked` may return instructions with account metas that have `is_signer`/`is_writable` flags? It only uses pubkey. Good.

J. Potential issue with `load_current_index_checked` and CPI: If open is invoked via CPI from a program that is itself top-level, current index might be the CPI's index? The author claims outer. Need verify. If instead current index inside CPI returns index of the inner instruction? But inner instructions not in sysvar, so load_current_index_checked might fail? There is known behavior: instructions sysvar current index is updated for CPI? Let's recall. The sysvar instructions account contains the top-level instructions. During CPI, `load_current_index_checked` returns index of the top-level instruction that is currently executing? Actually if a program CPIs another program, the runtime pushes the CPI instruction onto the instruction stack, but the sysvar instructions account maybe only top-level. There is `load_current_index_checked` uses `InstructionSysvar::get()`? It may return index of current instruction in the syscall context, which could be the CPI instruction index relative to top-level? I need be precise. There have been vulnerabilities around instruction introspection and CPI. The `instructions` sysvar contains serialized instructions of the transaction, not CPI. `load_current_index_checked` returns the index of the instruction in the transaction that is currently being executed. For CPI, I think it returns the index of the top-level instruction that invoked the program? Example: if top-level instruction 0 is program A, A CPIs program B, inside B `load_current_index_checked` returns 0? I believe yes. The author's claim likely true. If it returned some invalid, open via CPI would fail or scan from wrong. Could a wrapper exploit if current index inside CPI is 0 even if wrapper top-level later? Suppose wrapper top-level index 0 CPIs open for asset A. current=0, open scans from 1 and finds burn A at index 1. burn A scans 0..1 and looks for top-level open A. It won't find because index0 is wrapper, not SEAL. So burn fails. If wrapper top-level index 0 is open A (SEAL), and CPI something else, no exploit.

Could a wrapper top-level instruction have program_id SEAL? No, wrapper cannot be SEAL unless it's open itself.

K. Could burn be satisfied by an open that is later in transaction? burn scans earlier only. no.

L. Pairing does not bind the `payer` or `bank`. Could open with owner O, asset A, bank B, payer P; burn with same asset/owner but different payer/bank? Burn will require bank config and payer signer. If burn's bank wrong fails. If payer different okay. No leak.

M. Binding owner by account index 2 only. In open, `owner` is Signer at index2. In burn, owner at index2. But what if transaction includes open instruction with account 2 = owner pubkey but not marked signer? Anchor open requires owner Signer, so transaction must have signature. For burn matching, it doesn't check `is_signer` flag of matched burn's account 2. If burn instruction includes owner pubkey at index2 but not marked signer in top-level message, burn will fail Anchor signer check. Revert. No thaw survives. Could open succeed if matched burn has owner at index2 not signer but burn will fail? open succeeds then burn fails -> revert. no.

N. Could matched burn instruction be a simulated instruction in a transaction that is not executed because it is after a `return`? Solana no conditional skipping. All instructions executed until failure.

O. Could an attacker use a transaction with open and burn, but between them an instruction that changes the asset's owner to the owner itself? no.

P. The burn emptiness proof unchanged. Need inspect for faults.

BURN burn_vault:
- Checks bank == cfg.bank, asset owner Core, read asset owner/collection, owner == asset_owner, collection == cfg.collection, collection account.
- Scans earlier top-level open matching asset/owner.
- Reads SEAL config PDA, checks owner SEAL program, disc, version, collection and bank equal BURN config. Reads reserve_mints vec from SEAL config.
- Requires asset_signer.lamports()==0.
- Requires remaining_accounts.len() == declared.
- For each reserve mint, for each token program [SPL, T22], derive ATA address with pda, token_program, mint. Find in remaining_accounts. If not found ReserveNotDeclared. If account owner not token program continue. If data len <165 continue. Then read owner at 32..64 equals pda. Check delegate fields: d[72..76] == 0 (delegate option COption? Actually token account layout: mint 0-32, owner 32-64, amount 64-72, delegate option 72-76 (4 bytes), delegated amount 76-84? Wait they check d[72..76] zero, d[121..129] zero, d[129..133] zero. Token account layout: 0 mint, 32 owner, 64 amount, 72 delegate option (4), 76 delegated amount (8), 84 state (1), 85 is_native option (4), 89 native amount (8), 97 close_authority option (4), 101 close_authority pubkey (32) ending 133. Actually delegate option at 72, delegated amount at 76, state at 84, is_native option 85, native amount 89, close authority option 97, close authority 101. They check 121..129 and 129..133? That seems off. Let's recalc: SPL Token account size 165. Offsets: mint 0, owner 32, amount 64, delegate COption: option 72 (4), delegate pubkey 76 (32) -> 108, delegated amount 108 (8) ->116, state 116 (1) ->117, is_native COption: option 117 (4) ->121, native amount 121 (8) ->129, close_authority COption: option 129 (4) ->133, close_authority pubkey 133 (32) ->165. Ah code checks d[72..76] delegate option, d[121..129] native amount? Wait comment says delegate or close authority. They check d[121..129] == 0 (native amount) and d[129..133] == 0 (close authority option). They do NOT check delegate pubkey or delegated amount? If delegate option zero, delegated amount should be zero? Token program may leave stale data? If option zero, delegate inactive. They don't check delegate pubkey bytes 76..108 or delegated amount 108..116. If option zero, okay. They check close authority option zero but not close authority pubkey. If option zero, okay. They also check is_native amount zero? d[121..129] is native amount, not close authority. Why refuse native amount? Maybe to avoid wrapped SOL? But reserve mints classic SPL not native. If a token account has is_native option nonzero? They don't check option at 117..121, only native amount zero. Could be issue. For reserve ATA, is_native should be none. If option nonzero but amount zero? They allow? They check d[121..129] zero. If native option set but amount zero, maybe okay. But close authority option at 129..133 zero. Good.

But they don't check `state` byte at 116. If account frozen? Token account state can be frozen (2) by mint freeze authority. If reserve ATA frozen, balance may be zero but transfer? Burn doesn't transfer; sweep before burn must transfer. If frozen, sweep fails, burn refuses if balance not zero. If zero and frozen, burn allows? A frozen zero account can't hold value; after burn PDA unreachable. No issue. But if frozen with balance? amount check catches. If confidential? T22 not allowed.

- Requires d.len() == 165 (ReserveHasExtensions). For classic ATA, length 165. For nonexistent account, owner system and data len 0, skip before length? It checks owner not token program continue, so nonexistent T22 ATA skipped. Good.
- amount zero.

Then second loop over all remaining_accounts:
- If acc.owner == MPL_CORE_ID: require data empty or first byte != KEY_ASSET_V1. This catches declared nested Core assets. But if a Core asset account has data len 0? Burned asset maybe? It allows. If nested asset burned? It may have key byte not 1. Fine.
- If acc.lamports()==0 continue. Wait for token accounts with zero lamports? Token accounts have rent lamports, so not zero. If account closed, lamports 0 and data maybe empty, skip. Good.
- If acc.owner not token program continue.
- If data len >=165, read owner == pda. If so require len==165, delegate/close checks, amount zero.
This catches any declared PDA-owned token account, including non-reserve. But only if declared in remaining_accounts. Undeclared invisible.

Potential issues in emptiness proof:
1. It only checks accounts passed in remaining_accounts. The `declared` count must equal remaining_accounts.len(). But there is no requirement that declared accounts include all PDA-owned token accounts. Off-chain duty. Known gap.
2. It derives both SPL and T22 ATAs for each reserve mint and requires them in remaining_accounts. For classic SPL mint, T22 ATA derivation is unreachable? The author asks: "burn_vault requires BOTH token-program ATA derivations to be declared for every reserve mint, while assert_classic_spl already guarantees every reserve mint is classic SPL. The author believes that is dead weight that halves redemption capacity but did not touch it... Is the Token-2022 derivation reachable at all for a classic SPL mint?" Need answer. ATA program derivation includes token program id. For a classic SPL mint, can there be a Token-2022 ATA at that derived address? The ATA program's create instruction takes mint and token program; it will create account owned by the token program passed. For a classic SPL mint, can Token-2022 program initialize an account for that mint? Token-2022 can only handle mints owned by Token-2022. If mint owned by classic Token, Token-2022 initialize account would fail (mint mismatch). The ATA program for Token-2022 likely checks mint's token program? It may allow creating ATA for any mint with token program parameter? Actually AssociatedTokenAccount program derives address with wallet, token_program, mint. To create, it invokes token program to initialize account; token program checks mint belongs to it? Token-2022 cannot initialize account for a mint owned by classic token program. So T22 ATA for classic mint is unreachable as a token account; it will be nonexistent/system. Burn requires it declared but skips if owner not token program. So dead weight, but not reachable. It costs transaction capacity. Need state true: not reachable for classic mint, but declaration required. Could remove T22 derivation for classic mints to save capacity, but emptiness proof unchanged? Since assert_classic_spl ensures reserve mints classic, T22 loop is indeed dead weight. However if a classic mint somehow migrates? SPL token mints cannot change owner. So safe. Finding: MEDIUM/LOW capacity waste. The author didn't touch; we can recommend remove T22 derivation or make config per mint token program. But careful: if remove T22 declaration, a future Token-2022 mint cannot enter config due assert_classic_spl. So safe. This doubles capacity. Under UNBREAK or invariant.

3. Delegate check on closed account skipped. Author asks if argument true: delegate on non-existent account can authorise nothing, re-created ATA is fresh, PDA can never sign again. Need verify. After burn, asset_signer PDA remains with lamports? Burn requires PDA lamports==0, but token account rent can be swept to owner via close. The PDA cannot sign because asset burned; Core Execute requires asset owner? Actually asset_signer PDA is derived from burned asset; Core BurnV1 does not sweep PDA but PDA's key still exists? It may have lamports 0, data empty. Can anyone sign for PDA? The PDA is owned by Core? It is a system account? Core's Execute can sign with asset if asset exists? After burn, asset account data maybe key=0? Core BurnV1 closes asset? Measured asset gone (data length maybe 0 or key 0). The PDA cannot be signer because no program can invoke with its seeds? Core Execute would require asset account and owner; asset burned so fails. Token program cannot close/recreate ATA with PDA owner? ATA can be recreated by anyone for the burned asset's PDA? The ATA address derivation still exists. If someone recreates ATA for PDA, owner is PDA. But PDA cannot sign to approve delegate or transfer. However a delegate on a re-created ATA? If ATA is fresh, no delegate. If an attacker had previously approved delegate on an ATA, then ATA closed during sweep, delegate gone. Re-created ATA has no delegate. If ATA not closed but balance moved out with owner authority leaving delegate, burn refuses. If ATA closed, safe. Could a close authority planted on ATA close it after burn and steal rent? Close authority on zero-balance token account can close account and receive lamports. If burn allows closed account skipped, but if ATA is closed during sweep, close authority irrelevant. If ATA left open with zero balance and close authority? Burn refuses close authority option nonzero. If ATA closed, account no longer exists. After burn, can someone recreate ATA with close authority? ATA program creates with owner PDA, no close authority. So safe. The argument true.

But what if sweep closes reserve ATA to a destination that is not owner? Close account instruction destination can be any pubkey; rent lamports go there. The PDA signs close via Execute. Owner can choose destination. Bank should simulate. Not a vault invariant issue; owner can burn value. But if destination is attacker? Owner is attacker. Fine.

4. burn_vault requires `asset_signer.lamports() == 0`. But Core BurnV1 does not sweep asset_signer PDA. The redemption must sweep lamports via SystemProgram.transfer from PDA. Can PDA sign System transfer? Core ExecuteV1 can make PDA sign arbitrary CPI, including system transfer? System program transfer requires source signer. PDA can sign via Execute. Test 9.11 sweeps lamports. Good.

5. If a griefer sends lamports to PDA, owner can sweep in same tx. But what if lamports amount makes PDA rent-exempt and system transfer out all lamports? System transfer can reduce to zero if account not executable/data? PDA is 0-byte system account; can transfer all lamports, leaving 0. Runtime allows account with 0 lamports. Good.

6. burn_vault's second loop skips accounts with lamports==0. A token account with zero lamports cannot exist (rent exempt), unless data empty. Fine.

7. The reserve loop checks both token programs for each mint. For classic ATA, it checks owner == SPL or T22. If account is classic ATA, owner SPL. It checks len==165. Good. But it does not verify the account's MINT field equals the reserve mint! Important! It derives expected ATA address from pda, token_program, mint, and finds account with that pubkey. For a valid ATA, the data's mint field should equal mint. But if account owner is not token program, skip. If account exists at derived ATA address but is not a token account? For classic ATA address, owner should be SPL if initialized. If someone created a non-token account at that address? ATA derivation is PDA of ATA program; only ATA program can create with that address? Anyone can send lamports to the PDA address before creation, making a 0-data system account. Then owner system, skip. If account owned by token program but data mint field different? Can that happen at derived ATA address? ATA program ensures mint. But raw token program initializeAccount3 could initialize an account at arbitrary address? Token accounts are PDAs? Classic token accounts can be any address, but ATA is PDA. To have a token account at ATA address with different mint, one would need ATA program? The ATA program derives address with mint, so cannot create different mint at same address. Token program cannot initialize account at PDA without ATA? It can initializeAccount3 with address maybe any system account? The address must be signer? For initializeAccount3, account is not signer? It can initialize a token account at any address that is not owned? Actually token program requires account to be rent-exempt and not already initialized; it can be any pubkey, no signature? InitializeAccount3 takes account pubkey and mint, owner; account must be signer? Let's recall: initializeAccount3 instruction accounts: account (writable, not signer?), mint, rent? No authority signer? It may require account signer? Classic token initialize account requires account signer? For ATA, payer creates. If account is PDA, cannot sign, so only ATA program can create via invoke_signed. So derived ATA address can only be created by ATA program for that mint. So mint field implicit. But for T22 derivation nonexistent skip.

However, second loop over remaining accounts checks any token account owned by PDA, but does not check its mint. It only checks owner == pda and amount zero. If a declared token account is not a reserve and has zero balance but holds some other mint, okay. If has balance, refuses. No need mint.

8. Potential bug: reserve loop `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }` means if the declared ATA account is not owned by token program (e.g., system account with lamports), it skips emptiness check. But if it has lamports, second loop: `if acc.lamports() == 0 { continue; } if acc.owner != token... continue;` So a system-owned account with lamports at reserve ATA address is skipped in second loop because owner not token. Could this hide value? A system account with lamports is not token value; but it is an account owned by PDA? Wait the account itself is the reserve ATA address, not owned by PDA. Its lamports belong to that account, not to asset_signer PDA. If it's a 0-data system account with lamports at the ATA address, after burn it remains with lamports. Who can access? The ATA address is PDA derived from asset_signer PDA, token program, mint. If it's system-owned (not token), can asset_signer PDA sign to withdraw lamports? System program transfer requires account owner signer; the ATA address is a PDA not owned by token program. Can Core Execute sign for arbitrary PDA? It signs only asset_signer PDA, not the ATA address. The ATA address is derived from asset_signer but not the same. No program can sign for ATA PDA except ATA program? If system-owned, no. Lamports stranded/destroyed. But burn_vault only requires asset_signer lamports zero, not declared accounts lamports zero if not token. Could a griefer send lamports to reserve ATA address (system account) before creation, causing burn to allow and strand lamports? The ATA when created will take ownership? If pre-funded ATA address with lamports, ATA create idempotent may fail? Actually ATA creation requires address not have data/lamports? If pre-funded, create_associated_token_account_idempotent may succeed if account exists? If system account with lamports, ATA program may fail because account not rent-exempt? It can wrap? Not sure. But if reserve ATA already exists, it is token-owned and rent lamports checked? The reserve loop doesn't check lamports of token account, only amount. Token account rent is locked; after burn, if ATA left open with rent, those lamports are stranded? But sweep should close ATAs to recover rent. If not closed, burn allows a zero-balance token account with rent lamports. Then after asset burned, ATA remains owned by token program with owner PDA, zero balance, rent lamports. Can anyone recover? Close authority? If no close authority, only owner PDA can close; PDA unreachable. So rent lamports are destroyed/stranded. The emptiness proof does NOT require reserve ATAs to be closed, only amount zero and no delegate/close authority. If sweep transfers balance but does not close ATA, burn succeeds, leaving rent in ATA forever. Is that a defect? The invariant says everything stays in vault until broken open; when broken, vault burned. It doesn't require recovering rent. But customer SOL in ATA rent is lost if not closed. The test sweep closes ATA (`close=true` when full sweep). But if owner forgets close, burn allows. Under old design close_redemption maybe required? It checked no delegate/close but not closure? The author says normal sweep closes ATA. But on-chain does not enforce closure. A user could lose rent lamports. Is that security? Low. More importantly, if ATA left open with zero balance, it could later be used? Owner PDA unreachable, no. Delegate cannot be set. Safe for reserves. But lamports loss. Could Bank require closure in co-signature. Maybe LOW.

But wait: burn_vault second loop skips token accounts with lamports==0 only; token accounts have lamports >0. For PDA-owned token accounts, it checks amount zero but not lamports. So open zero-balance ATAs pass. Thus rent not swept. This is not a theft by attacker, but user error. Could a malicious griefer create zero-balance token accounts owned by PDA with rent, forcing rent loss? They can airdrop token accounts? Creating token account for PDA requires payer; if they create non-reserve token account and declare it, burn refuses if balance >0; if zero, burn allows, rent lost to griefer? Griefer pays rent, lost. Not attacker gain.

Could an attacker plant a zero-balance token account with `is_native` option and lamports? Native SOL token account? Wrapped SOL account can hold lamports as token balance. If amount zero but native amount? They check d[121..129] zero (native amount) but not is_native option. If is_native option nonzero and native amount zero, account may be closable by close authority? Not relevant. If amount field zero but native amount nonzero? For wrapped SOL, amount equals native amount? Token program sync native updates amount. They check amount zero and native amount zero. Good.

9. Delegate/close authority offsets: They check d[129..133] close authority option zero. But close authority pubkey at 133..165 not checked. Option zero enough. Delegate option zero enough. However, what about `delegate` option nonzero but delegated amount zero? They refuse. Good. What about account state frozen? Not checked. If frozen zero balance, no value. If frozen with balance, amount check catches. If frozen and balance zero but could be unfrozen by mint freeze authority after burn? PDA unreachable, cannot sign to unfreeze? Freeze authority is mint's, can freeze/unfreeze token account regardless owner. If account frozen zero, after burn still frozen. No value. If freeze authority later unfreezes, still zero. No issue.

10. Token-2022 extensions: reserve loop refuses len !=165. For classic mints, T22 ATA nonexistent skip. For non-reserve T22 token accounts declared, second loop refuses len !=165 if owner PDA. Good. But undeclared T22 accounts invisible. Known.

11. `declared: u8` limits remaining accounts to 255. With 8 reserves 16 plus extras <255. Fine.

12. burn_vault reads reserve list from SEAL config, but does not pass reserve mint accounts to verify they are classic SPL at burn. SEAL config update ensures. If SEAL config initialized with classic mints. If SEAL program compromised/upgraded, could change. Alarm.

13. BURN config has no reserve list, but has bank/collection. It reads SEAL config and requires bank/collection equal BURN config. If SEAL bank rotated with notice, BURN config must also rotate separately? BURN update_config has its own pending bank. If they diverge, burn fails WiringDiverged. This is fail-closed but liveness. Need operational duty to rotate both. Alarm watches collections and bank? WATCH has seal.bank, burn.bank but does it compare? detectStandingRisks only collections_disagree, not bank disagreement. BURN on-chain checks. If bank drift between SEAL and BURN, redemptions halt. Could be griefing if admin rotates one not other. Alarm drift individually. Maybe LOW.

14. open_for_redemption uses SEAL config bank; burn uses BURN config bank and SEAL config bank equal. If BURN bank differs, burn fails. Good.

15. The burn's Core BurnV1 instruction accounts: 
```
AccountMeta::new(vault_asset, false),
AccountMeta::new(collection, false),
AccountMeta::new(payer, true),
AccountMeta::new_readonly(owner, true),
AccountMeta::new_readonly(MPL_CORE_ID, false),
AccountMeta::new_readonly(MPL_CORE_ID, false),
```
Data `[IX_BURN_V1, 0]`. Is this correct Core BurnV1 account list? Metaplex Core BurnV1 likely accounts: asset, collection, payer, authority, system_program, ? Maybe duplicate Core? They pass MPL_CORE_ID twice as readonly. Tests pass. But note: they do NOT pass `asset_signer` PDA to Core BurnV1. Core BurnV1 does not sweep it. Good. They pass owner as authority. If asset has plugins, burn may require additional accounts? Core BurnV1 can burn asset if owner signs and collection? PermanentFreezeExecute plugin? Does burn require freeze plugin authority? Known fact: bare Core BurnV1 by owner cannot be prevented; PermanentFreezeDelegate blocks transfer not burn. So burn works even if frozen? Wait burn_vault requires open thaw first. But if freeze plugin only gates Execute, not burn. Core BurnV1 likely ignores PermanentFreezeExecute. So thaw not needed for burn itself, but for sweeps. Pairing ensures sweep. Good.

16. Could owner call Core BurnV1 directly while vault sealed, destroying contents? Yes known. Under new rule owner burning own vault IS unbreak, but must not destroy contents rather than release. Direct burn destroys contents. Alarm detectVaultSetChange. No on-chain prevention. Known.

17. `burn_vault` requires preceding open. Does this prevent direct bare burn? No, bare Core BurnV1 not through BURN program. It only shapes program burn. Known.

18. Could an attacker use BURN program's burn_vault without open but with a fake instructions sysvar? The sysvar address checked. No.

19. Instruction introspection can be disabled if transaction not include instructions sysvar? Anchor requires address. Good.

20. Potential critical: open_for_redemption matches a burn instruction later in transaction, but does not ensure that the burn instruction is executed AFTER all sweeps? It only requires burn exists later. Sweeps can be after burn? Transaction order: open, burn, sweep? If burn before sweep, burn will refuse non-empty, tx fails. If sweep after burn not executed. So sweeps must be before burn to succeed. Fine.

21. Could open be paired with burn, but burn's emptiness proof sees accounts after sweep. If sweep creates a new token account owned by PDA after open but before burn, and doesn't declare it, burn may allow destroying value. But Bank signs. If sweep instruction itself creates a PDA-owned token account (e.g., destination? no). Could owner use Execute to create a token account owned by PDA for a new mint, transfer value into it, not declare, burn destroys. That's owner destroying own value; Bank should refuse if it sees creation. But if Bank co-signature compromised? Off-chain.

22. The Bank co-signature is supposed to scan before signing. Is bank/alarm.mjs implemented to scan BEFORE signing? There is no signing code in provided bank files except revenue/distribute. The Bank key for mint/open/burn is presumably offline/manual? They ask: "is the off-chain control (the Bank must scan with getTokenAccountsByOwner and DAS BEFORE it signs, not after) actually implemented in bank/alarm.mjs, or only asserted in a comment?" Need inspect alarm.mjs. It has `reconcile()` that scans live vault PDAs with getTokenAccountsByOwner and DAS, reports undeclared token accounts. But it is a daily reconcile, not a pre-signature service. There is no code that, given a redemption transaction, simulates and scans before co-signing. alarm.mjs only watches after the fact. It does not implement Bank co-signing. So the control is only asserted in comments. Need finding CRITICAL/HIGH: The required pre-signature enumeration is not present; alarm reconcile is daily and post-hoc, cannot prevent signing a burn that destroys undeclared holdings. The Bank key process not provided. Exact: `bank/alarm.mjs --reconcile` runs daily and detects undeclared token accounts after they exist, but no function to scan asset PDA immediately before co-signing open/burn transaction, no simulation hook, no signer service. Attacker gain: if Bank signs based on UI without scan, undeclared nested vault/token destroyed. Fix: implement mandatory co-signer service that refuses to sign unless fresh getTokenAccountsByOwner + DAS + nested asset query returns only declared accounts, and include scan hash in transaction? Off-chain.

But the prompt says known consequences: "QUESTION FOR YOU: is there ANY on-chain construction that closes this, and is the off-chain control ... actually implemented in bank/alarm.mjs, or only asserted in a comment?" Need answer: No on-chain construction can close enumeration gap (Core cannot enumerate PDA-owned token accounts or nested assets; burn only checks declared). Could close by forbidding nesting/transfers to PDAs? Core permits transfer; no on-chain. Could use a wrapper? Not with existing Core. Off-chain: alarm.mjs has reconcile but not pre-signature; only comment. So finding.

23. Is there any on-chain construction that closes nested/airdrop gap? Maybe require declared accounts include result of `getTokenAccountsByOwner` via oracle? No trustless. Could use Core plugin to deny transfers to asset_signer PDA? Core transfer cannot be restricted by plugin? PermanentFreezeDelegate blocks transfer but kills resale. There is no burn-only lock. Could add a delegate that blocks transfer to PDA? Not. Could make burn_vault require a DAS proof via oracle? Not on-chain trustless. So no.

24. Known consequence: redeemed charter vault destroys provenance. Is mint transaction plus DAS burnt record sufficient? Need answer. On-chain mint transaction includes attributes? The Attributes plugin data is stored on asset account, not in transaction? The mint transaction contains attributes as instruction data, so it is on-chain forever if transaction history available. DAS may index burnt asset? After burn, asset account data maybe zero; DAS may retain burnt record? Metaplex DAS might show burnt=true but attributes? If asset account closed, DAS may not retain full attribute list? The test says DAS burnt record. But if DAS provider purges? The mint transaction is canonical. It includes the CreateV2 instruction data with attributes, so can be parsed. However, if attributes are large and transaction history pruned? Solana keeps signatures but transaction data may be pruned by RPC providers; on-chain ledger doesn't store full history forever? Validators prune. So not permanent. There is no on-chain surviving account state. Surfaces that report charter membership incorrectly: any indexer/UI reading live asset attributes will see absent/burnt and may not show charter. If they rely on vault existence, redeemed charter appears non-charter. The mint tx can prove, but not readily queryable. Need state business trade. Not a defect per prompt, but answer question. Is there a surface that now reports charter membership incorrectly? Yes: any DAS asset fetch for burned vault returns no attributes or burnt; if a marketplace/provenance viewer checks asset attributes, it will report no charter. The mint transaction is sufficient for a determined auditor but not for typical surfaces. Maybe LOW/INFO.

25. Known consequence: MINT delegates Attributes plugin to SEAL PDA, SEAL no attribute instruction. Dangling capability reachable? As above, not reachable by current SEAL. But future SEAL upgrade could. Also Core `UpdatePluginV1` can be called by plugin authority. The SEAL PDA is authority. Only SEAL program can sign for it. Current SEAL `core_plugin_cpi` only used by set_frozen. No instruction to update attributes. So unreachable. But stale `ATTR_REDEMPTION` refusal and comments. Is leaving it right? It is harmless but technical debt; could be removed to avoid confusion. Since attributes authority remains with SEAL, if SEAL compromised/upgraded, can rewrite provenance. But upgrade authority already can do worse. Finding LOW.

26. detectBurns severity HIGH on every burn_vault. Under v5 every legitimate redemption is burn. Is severity right? The detector raises HIGH for burn_via_program. The comment says cries wolf. Legitimate redemptions expected; HIGH every redemption may be noisy. But every burn is irreversible and should be reconciled; maybe HIGH is too high if frequent. They have detectVaultSetChange CRITICAL for any burned vault. detectBurns HIGH adds route info. If many redemptions, HIGH noise. Could lower to INFO for paired open+burn? But detector doesn't parse pairing. It could check same transaction has open_for_redemption and sweep? It normalises inner/top. It could classify legitimate redemption vs bare burn. Currently bare Core burn CRITICAL, program burn HIGH. Under v5 program burn is expected but still destruction; maybe HIGH okay if volume low. But if daily redemptions, alarm emails HIGH -> urgent. They say detector cries wolf. Need answer: severity likely should be INFO or WARN unless no paired open? But detectBurns only sees instruction, not transaction pairing? It has transaction ixs; could check for SEAL open disc same asset. It doesn't. Finding MEDIUM/LOW: HIGH on every legitimate redemption desensitizes; should parse paired open and downgrade or include context. But detectVaultSetChange CRITICAL every burn too! It reports any vault burned as CRITICAL. Under v5 every redemption burns, so CRITICAL every redemption. That's even worse. The alarm's bottom line says no burns. If redemptions are normal, CRITICAL noise. But maybe redemptions are rare and always human-reviewed. Yet severity question specifically detectBurns HIGH. Need discuss. The known consequences ask "Is the severity still right?" I'd say no: if burn_vault is the normal redemption path, HIGH (and vault_set CRITICAL) will fire on every legitimate redemption; unless the Bank has a workflow expecting it, this is alarm fatigue. But a burn is destruction of an NFT and release of BTC; maybe should be HIGH until reconciled. However the file's own comment says cries wolf. Recommend detectBurns parse paired open and sweeps; if program burn with paired open and no undeclared findings from pre-scan, INFO; bare Core burn CRITICAL. detectVaultSetChange should distinguish expected program burns? It currently CRITICAL for any burnt. Could cross-reference burn_via_program and open events. But alarm post-hoc. Finding MEDIUM.

27. Carry-over: chain-derived reconciliation of distribution outputs. distributor key can move whole pool while alarm reconciles against ledger same user wrote. Need evaluate. distribute.mjs uses distributor key (treasury) to send to vaults. It records payments in distributions.json. Alarm detectDistribution reads that ledger and reports missing/ambiguous. But the distributor key could send cbBTC to arbitrary address outside distribute.mjs, and alarm only watches? Does alarm scan MINT program transactions, not distributor wallet token transfers. detectDistribution only checks ledger, not chain. It does not reconcile distributor ATA balance or outgoing transfers from chain. The distributor holds 85% pool; compromised key can drain. Alarm's config drift watches treasury address, but not transactions from treasury. There is no chain-derived reconciliation of distribution outputs. The carry-over says accepted not fixed. Need report as HIGH/CRITICAL under? Maybe THE INVARIANT or SELL? It's off-chain pipeline. Need include. Exact construct: attacker with distributor key signs SPL transfer from treasury ATA to themselves. distribute.mjs ledger may not record; alarm detectors don't scan treasury wallet or cbBTC transfers, only MINT program signatures and state files. detectDistribution only sees ledger. Attacker gains entire holders' pool. Fix: alarm must scan treasury owner signatures and reconcile every outgoing cbBTC transfer to distributions.json rows, or move treasury to multisig/PDA with on-chain distribution program. Since carry-over accepted not fixed, still open. Severity CRITICAL? It holds real Bitcoin. But known carry-over accepted; user says still open. We should report, maybe HIGH/CRITICAL. They said do not re-report? "ROUND 12'S CARRY-OVER LIST — ACCEPTED, NOT FIXED. STILL OPEN." It lists chain-derived reconciliation, OS-lease lock, fresh per-cycle swap operator. They likely expect us to check if lock fixed and still report open items? "Do not re-report" applies known consequences, not carry-over? It says carry-over accepted, not fixed, still open. We should include them? They ask lock.mjs is correct NOW? So report on lock. For chain-derived reconciliation and fresh operator, maybe mention still open under final or findings. But avoid repeating as new? We can state still open and severity.

28. OS-lease lock. Need analyze lock.mjs. Current implementation:
- claim(file,payload): write tmp file, linkSync(tmp,file), unlink tmp. If link EEXIST return false. Atomic link fails if file exists. Good.
- acquireLock: try claim. If fails, read lock JSON. If unreadable -> refuse. If age < staleMs -> refuse. If held.pid alive and not recycled -> refuse. If stale and dead: _beforeBreak, re-read still, if token mismatch -> lostRace. unlink file. _afterUnlink. claim again. If claim fails -> lostRace. Return ok.
- releaseLock: read file, if token matches unlink.

Question: Is it correct NOW, and is POSIX lease/flock right answer? Need find remaining TOCTOU. They acknowledge microsecond TOCTOU between re-read and unlink. Let's analyze. Two processes A and B see same stale dead lock token T. A re-reads T, unlinks, claims. B re-reads before A unlinks? B sees T, then A unlinks and claims new token A. B then unlinks (deletes A's lock) because its re-read already passed? Code: `_beforeBreak`; still=read(); if token mismatch return; try unlink; `_afterUnlink`; claim. If B reads still=T before A unlinks, then A claims, B unlinks A's lock, B claims. Both hold. The re-read before unlink does not close TOCTOU because read and unlink are not atomic. They acknowledge microsecond. Is it exploitable? Two cron runners could race. Probability low but real. To be correct, need atomic replacement of stale lock without unlink? Use `rename`? If lock file exists, link fails. To break stale lock atomically, could use `mkdir` lock directory (atomic) or use `flock` on open file descriptor. The current link/unlink still has race. Could use `fs.renameSync(tmp, file)`? rename over existing file atomically replaces, but then a live holder's lock could be overwritten if stale judgment wrong. Need combine with token? If stale and dead, replacing via rename would avoid unlink race? Two racers both rename tmp to file; last wins, but first may think it holds? Need after rename verify content token? If both write unique tmp and rename over stale file, both succeed sequentially; last overwrites first. First would need detect it lost by re-reading after rename? There is still race. Better: use OS advisory lock `flock` or `lockf` on an open fd. Node `fs.open` then `flock` not built-in sync? Could use `proper-lockfile`? But POSIX `flock`/`fcntl` locks tied to open file descriptor and released on process death, no stale breaking needed. However NFS issues. For local cron, flock is right. `flock` can be exclusive non-blocking; if process crashes kernel releases. Long-running live lock not broken. Stale timeout not needed except wedged process still alive. If process hung but alive, flock won't release; you may still want manual kill. For money jobs, refusing concurrent is enough. Need answer: current lock reduces but does not eliminate race; not fully correct. The microsecond TOCTOU is real. Also `pidAlive` and `/proc` start time only Linux; on other OS fallback. But production likely Linux.

Other lock issues:
- `claim` writes tmp file in same directory. If tmp file exists? name includes pid+random, unlikely. It unlinks tmp in finally. If link succeeds, tmp remains? It unlinks tmp, lock file is hard link to inode. Good. If process crashes after link but before unlink tmp, tmp leftover; not lock. Fine.
- If lock file is a hard link? `linkSync` creates hard link. If an attacker can pre-create file as symlink? `linkSync` on symlink? It follows? Could be symlink attack if directory writable? Lock dir under /opt/cbob-vaults/bank, not world-writable. Fine.
- releaseLock reads then unlinks. TOCTOU: if lock broken and replaced between read and unlink, release sees old token? It reads held token, if matches own token then unlink. If replaced with same token impossible random. If it reads own token, then before unlink another process cannot replace unless lock stale broken; but own process alive, so not broken. Fine.
- withLock staleMs: for distribute 20h, alarm 2h, revenue 2h. If job runs longer than staleMs but alive, acquireLock refuses to break because aliveHolder true. Good. But if pid recycled and start time unavailable (`pidStart` null), recycled false? Code: `held.start && nowStart && held.start !== nowStart`; if nowStart null, recycled false, so alive holder -> refuse. Safe.
- If held.start null (non-Linux at creation) and pid alive but recycled? It refuses. Could be permanent if pid reused and start null? On Linux start recorded. Fine.
- The stale break re-reads and requires same token. But if the stale lock file is replaced by a fresh lock with same token? impossible.
- The race: A and B both decide stale. A unlinks, claims. B's re-read may occur after A claim, sees new token -> lostRace. If B re-read before A unlink, then B unlinks A's new lock. The window is between B's re-read and B's unlink. They admit. Could be widened by `_beforeBreak` but in production small. Is there a way to make it correct with link? Use `unlink` only if file still has same inode? Could `fs.stat` before/after? Still TOCTOU. Use `O_NOFOLLOW`? Not. Use `flock`.

Thus finding: lock not fully correct; use flock/lease. Severity MEDIUM? It prevents double-pay in common cases but race remains. Since money jobs, maybe HIGH? The race requires two runners meeting stale dead lock. Cron de-dup and locks reduce. But if a crash leaves stale lock and two manual runs after staleMs race, double-pay possible. LOW/MEDIUM. The carry-over asks is it correct NOW? Answer: no, residual TOCTOU; POSIX flock is right answer for local FS. Include under THE INVARIANT or maybe final. Since off-chain pipeline, maybe under THE INVARIANT.

29. Fresh per-cycle swap operator wallet. revenue.mjs uses long-lived operator key at /opt/cbob-vaults/bank/keys/swap-operator.json. It checks key matches config, floor balance. It inspects Jupiter swap tx for one signer and forbidden programs, but operator key persists and can hold funds. A compromised key can sweep up to cap/cooldown and sign arbitrary swaps? The on-chain sweep destination pinned to operator; if key compromised, attacker can call sweep_sol_for_swap (operator signs) up to cap every cooldown. Cap 50 SOL, cooldown production hours. They can also fail to return. Fresh per-cycle wallet would limit. Not implemented. Carry-over open. Severity HIGH? The rule unenforceable with long-lived key. Include under MINT/revenue? Maybe THE INVARIANT? Actually revenue pipeline. Could put under MINT (sweep) or final. The report headings don't include revenue, but MINT includes revenue? The mechanic MINT includes price and revenue? The architecture money. We can include under MINT as HIGH: long-lived swap operator key. But heading MINT primarily mint_vault. Maybe acceptable.

30. alarm.mjs issues. Need audit off-chain pipeline for new faults.

alarm.mjs:
- Uses `bs58decode` for instruction data. If data is base64? jsonParsed transaction instructions `ix.data` may be base58 string for parsed? It assumes bs58. Could fail silently returning empty buffer if invalid char. Then dataBytes empty, detectors miss. But normalise uses `ix.data ? [...Buffer.from(bs58decode(ix.data))] : undefined`. If bs58decode returns empty for base64, sweep discriminator missed. Is RPC jsonParsed data base58? For parsed instructions, `data` is base58 string? I think yes. For inner instructions maybe. But if not, issue. Could be LOW.

- `normalise` includes top and inner instructions. detectBurns for program burn via BURN program: if burn_vault is top-level, okay. If inside CPI? It would see inner too. But on-chain pairing requires top-level; alarm seeing inner might classify? detectBurns doesn't distinguish top-level vs inner. It could HIGH on CPI burn_vault (which cannot be legitimate redemption because open requires top-level? Actually burn_vault via CPI would fail NoPrecedingOpen unless top-level open exists? If top-level open and CPI burn, open won't see CPI burn, fail. So CPI burn not legitimate. Alarm HIGH okay. But detectUnledgeredSweeps might see inner sweeps? sweep is top-level by revenue. If another program CPIs sweep, alarm would detect as unledgered maybe. Fine.

- `detectBurns` uses `ix.accounts?.[0]` for asset. For burn_vault, account 0 asset. Good. It doesn't check owner/bank. Severity HIGH.

- `detectVaultSetChange` CRITICAL for every burned vault. It doesn't know legitimate program burn. Could noise.

- `listVaults` uses DAS getAssetsByGroup. It pages max 50*1000=50k. max_supply 2100. Fine. If DAS returns burnt assets? It uses `i.burnt`. Good.

- `readConfigs` missingWatchedKeys throws if a watched key not produced. But `WATCHED_KEYS` includes `gov.pending_admin`, `gov.pending_admin_at` etc. readConfigs gov reads pending_admin at 102, pending_admin_at 134. GovConfig layout: version8, admin9-40, collection41-72, quorum73-74, threshold75-76, min_voting77-84, proposal_count85-92, bump93, last_executed94-101, pending_admin102-133, pending_admin_at134-141. Good.

- BURN config offsets: version8, admin9, collection41, bank73, bump105? BurnConfig struct: version, admin, collection, bank, bump, pending_bank, pending_bank_at, pending_admin, pending_admin_at. Offsets: disc0-7, version8, admin9-40, collection41-72, bank73-104, bump105, pending_bank106-137, at138-145, pending_admin146-177, at178-185. alarm reads pending_bank106, at138, pending_admin146, at178. Good.

- SEAL config pending offsets dynamic after reserves. readConfigs reads n at 105, after=109+n*32. pending_bank after, at after+32, pending_admin after+40, at after+72. Struct: reserve vec len at105, items, pending_bank, pending_bank_at, pending_admin, pending_admin_at, bump. Wait order in SEAL Config: reserve_mints, pending_bank, pending_bank_at, pending_admin, pending_admin_at, bump. So after = 109+n*32. pending_bank after..+32, pending_bank_at after+32..+40, pending_admin after+40..+72, pending_admin_at after+72..+80. Good. It doesn't read seal.bump. Not watched.

- MINT config offsets: alarm reads pending_operator 449, at481. Good.

- WATCHED_KEYS includes 'seal.pending_bank', etc. readConfigs produces only if d.length >= after+80. If SEAL config data length insufficient (e.g., initialized with fewer reserves but space allocated padding, length should be full space including padding, so enough). If not, missing keys -> throw. Good.

- `collection.hash`: reads mint.collection account. If collection account data large, hash. Good.

- Program upgrade authority/hash: reads ProgramData. If program is frozen (no authority), hasAuth=0 -> IMMUTABLE. In tests deploy upgradeable. Mainnet should multisig. Good. But they don't watch Core program upgrade authority/hash. Core is critical. Could include finding: alarm does not watch Metaplex Core program bytes or upgrade authority, despite dependence on Core BurnV1/Execute/plugin semantics. If Core upgrades, vault mechanics can change. Under TRANSFER/UNBREAK. Severity HIGH? The code watches four programs but not Core. SPEC says test runner pins Core hash, but production alarm not. Need include. Is Core upgradeable? If not, maybe no. But can still watch hash. If Core immutable, no authority. But should watch. We can say if Core is upgradeable, this is a gap; if immutable, watching hash still detects unexpected. Need avoid invented mechanics. We know program ID; can read ProgramData. It's likely upgradeable? Metaplex programs often upgradeable? Core maybe immutable? Not sure. The prompt says real Metaplex Core cloned from mainnet. It doesn't state upgrade authority. We can frame as unmonitored dependency: any change to Core (upgrade or hard fork) invalidates assumptions; alarm does not include Core in program hash watch. This is a 100% gap, not necessarily exploitable today. MEDIUM.

- alarm scan cursors: for each program, walkSigs. If gap or unread, cursor not advance. Good. But `walkSigs` uses `until` cursor. If cursor is unresolvable, it reports CRITICAL only if `cursors[id] && sigs.length === 0`. If unresolvable cursor but there are newer signatures? `getSignaturesForAddress` with until unresolvable returns empty? Then sigs.length 0, check. Good. If cursor unresolvable but RPC returns some? unlikely.

- `detectUnledgeredSweeps` reads amount from data bytes 8..16 little endian by loop `for (let i=7; i>=0; i--) onchain = (onchain << 8n) | BigInt(d[8+i])`. This reads d[15] down to d[8], little-endian? For LE bytes [b0..b7], value = b7<<56 ... b0. Loop i=7 -> d[15]=b7, then d[14]=b6, ... d[8]=b0. Yes.

- It requires d.length <16 skip. Sweep instruction data is disc 8 + u64 8 =16. Good.

- `detectSplitClaims` uses `seenSplits` from alarm scan of MINT program where split instruction account index 2 == CBBTC. SplitRevenue accounts: config 0, revenue 1, mint 2, revenue_ata 3, holders_ata 4, bank_ata 5, token_program 6. Good. But if split via CPI inner? It scans normalised top+inner. If a program CPIs split_revenue, it would count. split is permissionless. Fine.

- `detectSplitClaims` horizon verifyLastN=200. It checks recent cycles for splitSig not seen. But if ledger has >200 cycles and an old cycle with splitSig not seen, it may not report unless reused. They justify. Could attacker add 200 dummy cycles to push fraudulent cycle out of window? The ledger is written by operator. If compromised, they could backdate/add rows. But detectUnledgeredSweeps chain-derived catches sweeps. For split claims, a cycle could claim splitSig that never happened but be pushed out of verification window by 200 later cycles. However cycleIsOpen would keep it open? If splitSig claimed, cycle considered closed. detectUnreconciledRevenue checks cycles regardless of window? It iterates all cycles, if returned>0 and !splitSig? If splitSig claimed, no unreconciled. detectSplitClaims only verifies last 200. So operator could create a fake cycle with fake splitSig, then 200 later cycles, and it stops being checked. But to close cycle, returnedSats must be >0? They can write fake returnedSats. detectUnreconciledRevenue short return checks quoted vs returned, but if fake returned matches quote, no alarm. The chain-derived sweep detector catches sweeps not ledgered, but if sweep is ledgered and cbBTC never returned, they could fake return and split. The splitSig verification window limited. Is this a defect? The ledger is written by operator; alarm tries to anchor splits on chain. A fake splitSig not seen would be CRITICAL until pushed out by 200 cycles. An attacker who can write ledger and wait could silence it. But 200 cycles is long (months). Still, a horizon based on ledger position is operator-controlled. They could insert 200 dummy cycles with splitByOther anchored? Need maybe. But carry-over chain-derived reconciliation of distribution outputs not fixed. For revenue, split verification not fully chain-derived for all history. Could be MEDIUM.

- `detectUnreconciledRevenue` for closed cycles with swept=0 or returned=0 continue. If a cycle has sendRejected true, closed. Good. If ledger row has sweptLamports but returnedSats 0 and age > grace, CRITICAL. Good. If operator edits returnedSats fake, short return maybe if quoted fake too. They can write quoted. But splitSig anchor. Not perfect.

- `reconcile()` reads configs, listVaults, detectIndexShortfall, then for each live vault, getTokenAccountsByOwner for token and token2022, detectUndeclaredTokenAccounts. It does NOT check nested Core assets owned by vault PDA via DAS. The known gap includes nested assets. `getTokenAccountsByOwner` only token accounts. DAS can enumerate assets owned by PDA? Maybe `getAssetsByOwner`? alarm reconcile does not call it. It only listVaults by collection. It does not detect a vault nested inside another vault. The spec says Bank must scan getTokenAccountsByOwner and DAS BEFORE signs. `reconcile` uses getTokenAccountsByOwner but not DAS for nested assets. It uses listVaults for collection but not owner. It could detect if a vault's owner is a PDA? listVaults returns items maybe ownership? It doesn't. So nested vault gap not reconciled. Finding: reconcile does not scan for nested Core assets; only token accounts. Under NESTING. Severity HIGH. The question asks is there on-chain construction closes this and is off-chain control implemented in alarm.mjs? Answer: no on-chain; alarm.mjs only partially implements token account reconcile, not pre-sign and not nested DAS owner scan. Need include.

- `detectUndeclaredTokenAccounts` expected ATAs only classic token program? In reconcile, expected = reserve.map(m => ata(m,p)) where `ata` uses TOKEN program ID only, not Token-2022. But burn_vault expects both SPL and T22 ATA derivations for each reserve. For classic mints, T22 unreachable. If a T22 ATA somehow exists for PDA (for non-reserve T22 mint), detectUndeclared flags CRITICAL. Good. But if reserve list includes T22 mint (shouldn't), expected missing T22? Not.

- alarm's `ata` helper uses TOK only. For burn declaration, T22 ATAs not expected. If a canonical T22 reserve ATA existed (impossible for classic), it would be flagged undeclared. Fine.

- `detectPdaTokenAccounts` expectedAtas set built only classic ATAs for live vaults. If a T22 ATA for reserve created, would CRITICAL non-canonical. But impossible.

- alarm does not watch BURN program's transactions for open/burn pairing? It scans BURN signatures, detectBurns. Good.

- alarm does not verify Bank co-signature transactions before signing; post-hoc.

distribute.mjs:
- Uses DAS listVaults and checks unique live+burnt == mintedTotal. If burnt assets count includes redeemed vaults, mintedTotal never decrements. Good. But if DAS index lags, distribution refuses. Safe.
- Balances: reads cbBTC ATA of vault PDA. If vault has cbBTC in non-ATA token account, balance reads 0 and not paid. But activation assumes canonical ATA. Bank reconcile flags non-ATA. Fine.
- If a vault is burned mid-run, it checks asset account live before transfer. But it does not check ATA owner? If asset burned but ATA still exists, transfer to it would succeed and be stranded. It checks asset live before transfer. Good. Race between check and transfer. Could burn after check before transfer; transfer lands to PDA ATA of burned vault, stranded. Small race. Since burn requires owner+Bank and distribution runs daily, possible if user redeems concurrently. The transfer transaction could be in flight. Fix: use on-chain distribution atomic with burn? Not. Severity LOW. It records skipped if burned before check, but race remains.
- Distribute pays equal per activated vault. If plan fixed and a vault burned after plan, it skips if burned before transfer. If vault redeemed after plan but before transfer, its cbBTC ATA may be closed; transfer to absent ATA? `createTransferCheckedInstruction` to absent ATA fails? Token transfer to nonexistent account fails. It catches rejected and retries? It will fail, row rejected. But if vault redeemed, it shouldn't get distribution for that day? The plan fixed includes it; failure reported. Could be grief. Business rule maybe holding at snapshot? They use activated at run time. If redeemed before distribution, missing ATA -> balances 0, not activated. If after plan, fail. LOW.
- Distributor key can drain as noted.

revenue.mjs:
- Checks operator key file mode. Good.
- Reads config with pinnedAccountData (not provided but selftest references anchor.mjs). We don't have anchor.mjs source. Need maybe assume. But user didn't include bank/anchor.mjs. Could be missing. We can note cannot audit anchor.mjs because not provided? But report should find faults in provided code. If a dependency missing, maybe finding: `bank/anchor.mjs` not supplied, cannot verify pinning used by revenue/distribute. But maybe omitted accidentally. Should we mention? The prompt includes all code? It doesn't include anchor.mjs. selftest imports it. If missing, tests fail. As auditor, note unavailable? Could be LOW/INFO. But maybe not needed.

- revenue.mjs sweep instruction keys: operator.publicKey is `isSigner: false`? Wait code:
```
keys: [{...MINT_CFG}, {...REVENUE}, { pubkey: operator.publicKey, isSigner: false, isWritable: true }, {...SystemProgram}]
```
But `sweep_sol_for_swap` requires `swap_operator: Signer<'info>`. The transaction is signed by `[operator]`, but the instruction account meta says isSigner:false. In Solana, transaction signing is determined by message header; if account is signer in transaction but instruction meta says false? The compiled message marks signers based on TransactionInstruction `isSigner` fields and fee payer. If operator is not fee payer and instruction says isSigner:false, the message will not mark it as signer, so Anchor `Signer` check fails. But test 6.16 uses `sweepTo` with keys `{pubkey:dest,isSigner:true,isWritable:true}`. revenue.mjs uses isSigner:false! Let's verify: In revenue.mjs sweep send:
```
cycle.sweepSig = await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({
    programId: MINT_PROG, data: ...,
    keys: [{ pubkey: MINT_CFG, ...},
      { pubkey: REVENUE, ...},
      { pubkey: operator.publicKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, ... }] })),
    [operator], ...)
```
Yes operator isSigner false. But `sendAndConfirmTransaction` with signers [operator] will add signature for operator only if operator.publicKey is in message signers. If instruction says false and not fee payer, it won't be required signer. The transaction may fail simulation due to missing required signature? Actually if program expects signer but account not signer, runtime error. So revenue.mjs live sweep would fail with AccountNotSigner. Is this a real defect? Let's check MINT program SweepSolForSwap accounts: config, revenue, swap_operator Signer, system_program. Anchor requires swap_operator signer. If instruction meta false, Anchor error. The test 6.17a stranger sweeps without operator signing uses isSigner:false and expects REJECT AccountNotSigner. revenue.mjs replicates that. So CRITICAL: revenue cycle cannot sweep live; or if it somehow does? It will throw, mark sendRejected, no SOL moved. This is a functional bug that stops revenue pipeline. But security? It prevents sweep, maybe denial. Since it moves real Bitcoin, operational critical. Need report under MINT/revenue. But the heading MINT? Yes. Exact construct: revenue.mjs sweep instruction marks operator `isSigner:false`; program requires signer. Attacker gains? No attacker, but pipeline fails; if someone "fixes" by removing signer check? Hmm. The prompt says find faults, assume author wrong. This is a real code bug. Need verify if web3.js `sendAndConfirmTransaction` might override isSigner if signer array includes key? It builds message from instructions; `Transaction.compile()` adds fee payer and collects signers from instructions where isSigner true. It does not automatically mark an account as signer just because a keypair is provided, except fee payer. If a signer provided for non-signer account, it may add signature? I think `Transaction.sign` sets signatures for public keys that are required signers; if not required, ignored. `sendAndConfirmTransaction` calls `transaction.sign(...signers)`; signers not in message required are ignored. So fail. This is likely a CRITICAL functional defect. But has it been tested? revenue.mjs default dry run; --live not tested. The test suite uses correct isSigner:true. So yes.

- revenue.mjs after sweep, `cycle.sweptLamports = String(amount); save(led)`. If sendRejected, it sets sendRejected and throws. Good.

- revenue.mjs swap transaction inspection: FORBIDDEN includes BPFLoaderUpgradeab and MINT_PROG. It does not forbid TOKEN program, ATA, System? It allows arbitrary programs except those. A malicious Jupiter response could include instructions to transfer SOL from operator to attacker? The operator signs; the message has exactly one signer operator. If it includes a system transfer from operator to attacker, that's a value movement but operator holds swept SOL; a blank cheque. The check only forbids upgrade and MINT program. It says narrow and honest; dedicated operator wallet holding only cycle funds is other half. But if operator wallet holds accumulated SOL? It should hold only cycle. Still, a substituted swap tx could drain operator SOL to attacker, not necessarily cbBTC. Since operator has swept SOL, that's theft. The inspection does not ensure the transaction is only a Jupiter swap. It could include a system transfer instruction to attacker, signed by operator. It only checks signers length 1 and no forbidden keys. It doesn't check program IDs allowed list (Jupiter, Token, ATA, System?). It checks addressTableLookups <=4. So a malicious HTTP response can craft a transaction with one signer operator and a SystemProgram.transfer to attacker, no forbidden keys, and revenue.mjs signs it. This is CRITICAL: blank cheque for operator's SOL (and any cbBTC in operator ATA) because it could include SPL token transfer too. The comment acknowledges "This is a bound, not a proof... dedicated operator wallet holding nothing but cycle's funds". But even cycle's funds are the swept SOL; attacker can steal them. The swap operator key is trusted hop, but the code signs arbitrary transaction from Jupiter API. If API compromised/MITM, funds lost. They do check exactly one signer, but that signer is operator, so any instruction moving operator funds is authorized. Need fix: allowlist program IDs (Jupiter v6, Token, ATA, System maybe only for wrap/unwrap?), verify no transfers to non-route, or use Jupiter SDK with verified route, simulate and assert only expected balance deltas. Severity CRITICAL under MINT/revenue. The known carry-over fresh per-cycle wallet reduces but not eliminate (cycle funds stolen). This is likely a real finding.

- revenue.mjs `FORBIDDEN` includes MINT_PROG to prevent calling sweep/split? But attacker could include BURN/SEAL/GOV? Not value. Could include Token program to transfer cbBTC from operator ATA to attacker. Allowed. So yes.

- revenue.mjs uses `wrapAndUnwrapSol: true`. Jupiter transaction may include System transfer to operator? It could. Need delta checks after signing? It checks swap credited cbBTC delta >= minOut. If transaction also transfers SOL to attacker, the swap may still return cbBTC? But swept SOL amount could be reduced; if attacker takes some SOL, swap output lower, may fail minOut. If attacker takes all SOL, no swap output, fails delta, but SOL already gone. The code confirms swap transaction before checking delta? It sends swap, confirms, then reads ATA delta. If swap tx includes SOL drain and no swap, delta 0, throws, but SOL gone. So CRITICAL.

- revenue.mjs re-quote after sweep uses amount same. If sweep landed but quote fails, SOL on operator. It throws; open cycle. Manual. Okay.

- revenue.mjs return step: `got = after` (operator ATA total after swap). It sends `createTransferCheckedInstruction(opAta, CBBTC, revAta, operator.publicKey, got, 8)` transferring entire balance. If operator ATA had pre-existing cbBTC (from previous failed cycle or attacker), it sends all to revenue, but records delta. Good. But if operator ATA was poisoned with a delegate? The operator signs transfer; delegate irrelevant. If ATA has close authority? Could close after? Not.

- revenue.mjs creates operator ATA before sweep if absent. It uses `readTokenAccount(opInfo).state === 'absent' ? 0n : requireTokenAmount(...)`. If opInfo foreign/malformed, requireTokenAmount throws before sweep? It is before sweep, good. If absent, creates. Good.

- revenue.mjs `if (!cfg) ...` after `cfg = { data: pinnedAccountData(...) }`; `if (!cfg.data)` then `if (!cfg)` redundant. Fine.

- revenue.mjs reads config offsets directly after pinnedAccountData. It doesn't check version? pinned does. Good.

- revenue.mjs uses `MAX_PER_CYCLE_LAMPORTS = 50 SOL` and chainCap. Good.

- The swap operator key file permissions check only mode &0o077. If file is symlink? It reads; local privilege? Not.

distribute.mjs:
- It reads distributor key and checks equals config.treasury. Good. But distributor key can be used outside script; alarm not chain-derived.
- It uses `readTokenAccount(info)` for vault ATAs. If absent, balances 0 and missing. If poisoned, balances 0 and report. Good.
- It refuses to create missing ATA. Good.
- It fixes plan and saves. If plan includes vaults with balances >=21000 at run time. If a vault's balance falls after plan but before transfer, it still pays? It doesn't recheck balance. Could pay a vault that redeemed? If vault redeemed, asset burned and ATA closed; transfer fails. If balance fell below activation but ATA open, it pays anyway. Plan fixed. Business maybe okay. LOW.
- It checks `stillThere` asset live before transfer. If asset account exists but not Core? data[0] !==1 skip. Good.
- It doesn't check destination ATA still exists before transfer; if closed after plan, transfer fails rejected. Good.
- Double-pay ambiguity: paymentState handles. Good.

alarm.mjs `detectDistribution` uses ledger only, not chain. As above.

31. GOV:
Need analyze voting mechanic. Potential faults.

- One vault one vote: VoteRecord PDA ["vote", proposal, asset]. Init. If vote exists, fails. Good.
- Standing: read asset owner bytes, require owner signer. Good. If asset transferred after vote, new owner cannot vote. Good.
- Quorum: divisor max(snapshot minted_total at proposal creation, live minted_total at execute). Snapshot from MINT config. Tally rule snapshotted. Good.
- Execute: requires now >= voting_ends_at, not executed, within execution window, proposal.closes_at > now. Checks governance == gov_pda in MINT config. Computes need ceiling. threshold yes_bps >= threshold_bps. last_executed_id forward. CPI set_round.

Potential issues:
A. `create_proposal` seeds proposal PDA with `config.proposal_count + 1`. It increments config.proposal_count before init? Code: `cfg.proposal_count = cfg.proposal_count.checked_add(1)...; let p = &mut ctx.accounts.proposal; p.id = cfg.proposal_count;` Accounts struct init seeds `&(config.proposal_count + 1).to_le_bytes()`. In Anchor, account constraints evaluated before handler? The seeds use current config before mutation. If config.proposal_count = N, seeds expect N+1. Handler increments to N+1 and sets id. Good. If two proposals concurrent? config mutable, PDA unique. Transactions conflict on config write; one lands. Good.

B. `create_proposal` does not check `voting_ends_at` in future relative to now? It computes dur = voting_ends_at - now, require dur >= min and <= max. If voting_ends_at < now, checked_sub underflows? It uses checked_sub, if negative returns None -> BadWindow. Good.

C. It does not check proposal round `opens_at`/`closes_at` relative to voting_ends_at. A proposal could have voting end after round closes? execute checks proposal.closes_at > now at execute. If round opens/closes before voting ends, after voting passes, execute may fail if closes_at <= now. That's okay. Could create proposal with round already closed; test 7.12a allows. It wastes vote. Not security.

D. VoteRecord init space 8+32+32+1+1 =74. Struct fields proposal Pubkey, asset Pubkey, support bool, bump u8. Good.

E. `cast_vote` does not check proposal.voting_ends_at > now? It does `now < voting_ends_at`. Good. It does not check proposal round? no.

F. Double vote: VoteRecord PDA init fails if exists. But what if vote record exists from a previous proposal? Seed includes proposal. Good.

G. Vote can be cast by owner signer. If vault owned by PDA (nested), owner cannot sign. Good.

H. Quorum divisor uses `minted_now` from MINT config at execute. If MINT config governance not GOV PDA, execute fails. Good.

I. `execute_proposal` permissionless? Accounts no signer. Anyone can execute after voting. Good. But it can execute a proposal that sets round with price/cap. If proposal passed. Fine.

J. Potential overflow in yes_bps: yes*10000 / cast. yes/no u64, cast u128. Max supply 2100, safe. If max_supply huge, u64 votes could overflow u128? yes*10000 with u64 max ~1e23 < u128. safe.

K. `need` ceiling: divisor * quorum_bps +9999 /10000. If divisor huge, u128 safe? minted_total u64 max 1.8e19 *10000=1.8e23 < u128. safe.

L. `threshold_bps` >5000 and <=7500 at init/update. But proposals snapshot can have old threshold >? If config initialized with 6000. Good.

M. Admin can lower quorum to MIN_QUORUM 500. With max(snapshot,live), if many burned, quorum may be impossible? Lowering helps. But admin can also raise quorum to 10000? update allows x >= MIN and <=10000, no ratchet direction for quorum. Admin can raise to 10000, making governance hard. But threshold cap prevents 10000 threshold. Quorum 10000 means all minted supply must vote; burned vaults make impossible. Admin can set 10000 and then lower later? It can lower to MIN. If admin hostile, can raise to 10000 and lower? They can move both ways. The spec says quorum may move both ways deliberately. But raising to 10000 can deadlock if any burned. Admin can lower, so not permanent. But if admin loses key? Governance stuck. Rotation timelock. MEDIUM? Known design.

N. `update_gov_config` admin rotation: pending_admin_at uses ROTATION_NOTICE_SECS constant 7d. apply/cancel. Good.

O. GOV reads MINT config raw offsets. If MINT config version changes, fail. Good.

P. Vote renting: atomically transfer to broker, vote, transfer back. Known stated limit. Could a broker vote multiple proposals with same vault? VoteRecord per proposal; if transfer back, owner can vote on other proposals. Renting possible. No fix.

Q. Proposal creation standing: requires proposer owner of vault. If vault transferred after proposal, proposer can still execute? execute permissionless. Vote records by asset. Fine.

R. A vault minted during voting can vote? Standing live. Quorum divisor max live includes it, so bar rises. Bank duty to refuse mints during proposal. Off-chain. Known.

S. GOV `execute_proposal` CPI set_round accounts: mint_config writable, gov_pda signer. MINT SetRound accounts: config (has_one governance), governance Signer. It passes `ctx.accounts.governance` which is the ["gov"] PDA? In ExecuteProposal accounts, `governance: UncheckedAccount` seeds [GOV_SEED]. It uses invoke_signed with gov seed. Good. But it also passes `ctx.accounts.mint_program` but not used in instruction? It constructs Instruction program_id MINT_PROGRAM_ID and accounts [mint_config, gov_pda]. It doesn't include mint_program account in invoke_signed account_infos? It passes only mint_config and governance. Anchor CPI to MINT set_round expects accounts config and governance; no program account needed. Good.

T. `execute_proposal` checks `governance == gov_pda` from read_mint_config. It reads `ctx.accounts.mint_config`. But the CPI also writes to same account. Good.

U. If MINT config governance is GOV PDA but `mint_program` account passed is wrong? Anchor constraint address MINT_PROGRAM_ID. Good.

V. GOV config `collection` not rotatable. If wrong at init, proposals/votes fail. Alarm.

Potential GOV finding: `create_proposal` snapshots `quorum_supply = read_mint_config(...).1` (minted_total). But it does not snapshot `max_supply` or round bounds? MINT enforces. Good.

Potential GOV finding: Voting period min is config, but `voting_ends_at` chosen by proposer. Proposer can set voting end far future up to 30 days. Execute window 7 days. Good.

Potential GOV finding: `execute_proposal` requires proposal.closes_at > now. If proposal round opens_at in past and closes_at future, set_round may open round immediately. Fine.

Potential GOV finding: last_executed_id only prevents older proposals after newer executed. But if proposal IDs not sequential due to failed creates? proposal_count increments only success. IDs sequential. Good.

Potential GOV finding: A proposal can be executed multiple times? p.executed true. Good.

Potential GOV finding: If two proposals pass, executing newer then older fails. If execute older first then newer? last_executed_id updates to older, then newer id > older can execute, overwriting. That's okay; sequence can be manipulated by anyone if both executable. If older has malicious price and newer fixes, attacker could execute older after newer? last_executed_id prevents if newer already executed. But if both pending, order matters. Anyone can choose. Governance should execute desired. Not a vulnerability.

Potential GOV finding: No cancel proposal. A bad proposal cannot be cancelled; must wait voting end and then not execute, or execute newer superseding? If it passes, it can be executed within 7 days. Admin cannot cancel. If hostile majority passes bad round, no veto. Design.

Potential GOV finding: Quorum uses minted_total including burned vaults. If many redemptions burn vaults, quorum may become unreachable unless admin lowers quorum. Admin key risk. Known.

TRANSFER:
Core transfer plus PermanentFreezeExecute seal.
- Vaults born frozen true. PermanentFreezeExecute plugin authority SEAL PDA. ExecuteV1 gated. Transfer? Which plugin gates transfer? PermanentFreezeExecute likely prevents Execute when frozen, not transfer? The spec says PermanentFreezeDelegate blocks transfer but not burn; FreezeDelegate blocks both. Wait PermanentFreezeExecute? They use plugin 17 PermanentFreezeExecute, not delegate. It gates ExecuteV1. Does it block transfer? The spec says vaults freely transferable? "A bare Core BurnV1 by owner cannot be prevented while vault stays freely transferable. PermanentFreezeDelegate blocks transfer but not burn; FreezeDelegate blocks both and kills resale." They use PermanentFreezeExecute, not PermanentFreezeDelegate. So transfer is not blocked by freeze? The seal prevents Execute (moving contents), but asset can transfer. Buyer gets sealed contents. Good.
- Core transfer by owner. No program restrictions. If asset transferred to PDA, bricked. Known. If transferred while thawed? Thaw only within redemption tx; cannot end thawed. Good.
- PermanentFreezeExecute plugin is create-only? Permanent plugins cannot be removed? They set authority SEAL PDA. SEAL can update frozen state. Could SEAL upgrade remove plugin? Core permanent plugins maybe cannot be removed even by authority? Update can change frozen/authority? Permanent means cannot be removed, but authority can update? It can set frozen false. Good.
- Transfer mechanic: Since contents sealed, transfer sells vault. No on-chain check of contents. Marketplace relies on off-chain. Known.
Potential finding: No transfer hook to prevent transfer to asset_signer PDA or nested vault. Core permits. Known impossibility? They say vault transferred to own PDA bricked, Core permits. Blocked in UI only. This is a user fund loss. Could on-chain prevent? No plugin? Maybe PermanentTransferDelegate? But would kill resale? There might be Core transfer delegate plugin that can approve/reject transfers. They chose not. Known. Report as MEDIUM under TRANSFER: no on-chain guard against bricking transfers; only UI. Fix: wallet/marketplace warnings, or use Core TransferDelegate? But would affect resale. Since known measured fact, do not re-file as bug? It is under measured facts #3. They say do not re-file these as bugs. So not a finding, but include in 100% claim gaps.

SELL:
Marketplace resale, buyer basis vault contains reserve.
- Royalties plugin set. Marketplace may enforce. No on-chain escrow. Buyer must trust vault sealed. Since contents can be airdropped/nested? Reserve can be drained only via thaw+burn or owner direct burn? Owner can bare burn destroying contents, but then vault gone. While sealed, contents cannot leave. So buyer can verify reserve by checking PDA token accounts. But no on-chain guarantee of completeness (undeclared airdrops not part basis). The seller cannot drain reserve without burning vault. However seller can borrow? No delegate because burn refuses? During sealed state, owner cannot Execute because frozen. Could owner approve delegate on reserve ATA? The ATA is owned by asset_signer PDA; owner cannot sign for PDA unless Execute thawed. So no. Good.
- But owner can transfer vault to a PDA and brick it; buyer should check owner not PDA. Off-chain.
- If vault has undeclared nested vault or airdropped token, buyer may not know; DAS reconcile. Marketplace basis only reserve. Not a defect? Could be finding: no on-chain attestation of reserve completeness at sale; royalty doesn't escrow. But known gap.
- detectBalanceDrops alarms reserve fell, but legitimate redemption. For sale, buyer can query balance.

Potential SELL finding: Royalties plugin destination revenue PDA, but marketplace enforcement optional. If marketplace ignores, royalties not paid. No on-chain. LOW.

NESTING AND AIRDROPS:
We covered. Need findings:
- CRITICAL/HIGH: No pre-signature scan implemented; alarm reconcile lacks nested asset scan. Undeclared holdings destroyed. Off-chain control only comment.
- MEDIUM: Airdropped SOL can grief burn until swept; but owner can sweep same tx. Known.
- LOW: Nested vault unredeemable while nested; no on-chain prevention. Known.

THE INVARIANT:
Everything stays in vault until broken, vault burned never exists again.
- Direct Core BurnV1 by owner can destroy contents without releasing. Known impossibility. But under new rule owner burning own vault IS unbreak; what must not be possible is burn that DESTROYS contents rather than releasing them. Direct burn destroys. Alarm only post-hoc. This is a fundamental gap. Should be CRITICAL? The prompt says measured fact do not re-file as bug. But they also say "What must not be possible is a burn that DESTROYS the contents rather than releasing them." Since bare Core BurnV1 cannot be prevented, the invariant is not 100%. It is known impossibility. We should not re-file as bug, but in final 100% claim must survive. Maybe mention as accepted risk, not finding. But if asked find faults, we can state no on-chain fix; alarm insufficient. But do not re-report measured fact. We can discuss under final.
- Undeclared holdings destroyed by legitimate burn. Known.
- Off-chain alarm gaps (pre-sign, nested, distribution chain-derived, lock, swap inspection) undermine invariant.
- Everything stays in vault: reserve mints in canonical ATAs cannot leave while frozen. But non-reserve tokens airdropped can be destroyed. The invariant for declared reserves holds except direct burn. Need final.

Need also answer specific known consequences true/false:
- Nested/airdropped holding destroyed not stranded: True. Core cannot enumerate; burn allows undeclared; inner orphaned; token destroyed. On-chain construction closes? No. alarm pre-scan implemented? No, only reconcile token accounts daily, no nested, no pre-sign.
- Redeemed charter vault destroys provenance: True. Mint tx plus DAS burnt record? Sufficient for audit maybe, but surfaces may report incorrectly. Need answer.
- MINT delegates Attributes to SEAL, SEAL no write: dangling capability unreachable currently. Leaving MINT unchanged right? It is safe but stale; recommend remove/cleanup. ReservedAttribute refusal for nonexistent stamp harmless but misleading.
- Delegate check unreachable when ATA closed: argument true. A delegate on nonexistent account authorizes nothing; recreated ATA fresh; PDA never signs. But if ATA closed, rent destination chosen by sweep; okay.
- Token-2022 derivation reachable? For classic SPL mint, no. Dead weight. It halves capacity. Could remove.
- detectBurns severity? Probably not right; should be contextual/downgraded for paired program burns, keep CRITICAL for bare Core burns.

Need answer a-f in UNBREAK section maybe as subsection before findings. The prompt specifically asks attack this first and hardest and answer a-f. We can include under UNBREAK a "Direct answers to a–f" then findings.

Need ensure no false claims. Let's validate revenue.mjs isSigner false. Could `sendAndConfirmTransaction` with signers array automatically mark all provided signers as required? In web3.js, `Transaction.sign(...signers)` calls `this.serializeMessage()` then `signers.forEach`? Actually `Transaction.sign` accepts signers and adds signatures for those that are required signers. It determines required signers from message. If operator not required, signature not added. `sendAndConfirmTransaction` may call `transaction.sign(...signers)`; if no required signature, transaction simulation fails due to program signer check. So yes. This is a real bug. But maybe `operator.publicKey` is fee payer? No, fee payer not set explicitly; `sendAndConfirmTransaction` uses first signer as fee payer? In web3.js, if transaction.feePayer not set, `sign` sets feePayer to first signer? `sendAndConfirmTransaction(connection, transaction, signers)` sets transaction.feePayer = transaction.feePayer || signers[0].publicKey? I think yes. In revenue.mjs, signers [operator], so operator becomes fee payer. Fee payer is always a required signer regardless of instruction meta. So operator will sign as fee payer. But Anchor `Signer` check requires the account meta in instruction to have isSigner true? Runtime checks if account is signer in transaction message. Fee payer is marked signer in message header. Even if instruction meta says isSigner:false, the account may still be a required signer due to fee payer. Does Anchor's `Signer<'info>` check `is_signer` on AccountInfo, which is derived from transaction message for that account, not instruction meta? If operator is fee payer, `is_signer` true. Then program passes. Ah! Important. In Solana, an account can be signer even if instruction meta says false if it's fee payer or marked signer in another instruction? The message header numRequiredSigners includes fee payer and all accounts with isSigner in any instruction. If fee payer operator, it is signer. The instruction account meta compiled may have isSigner flag? When compiling, if account is fee payer, it is included in signers. The AccountInfo is_signer will be true. Anchor Signer checks account_info.is_signer. So revenue.mjs may work because operator is fee payer. But if operator is fee payer, it also pays transaction fee, okay. The instruction meta isSigner false is sloppy but not fatal because fee payer signer. However if someone else fee payer? signers [operator], operator fee payer. So sweep succeeds. Test 6.17a stranger sweeps without operator signing: keys operator isSigner false, signers [alice]. Alice fee payer, operator not signer, fails. In revenue, operator is signer as fee payer. So not a bug? It still relies on fee payer, not instruction signer. If operator is fee payer, Anchor sees is_signer true. So okay. But if they later use VersionedTransaction or separate fee payer, could fail. LOW: instruction should mark isSigner true for clarity. Not critical. Good catch. Need not overstate.

But wait `sendAndConfirmTransaction` in web3.js v1: It does not automatically set feePayer? The function `sendAndConfirmTransaction(connection, transaction, signers, options)` calls `transaction.sign(...signers)`? `Transaction.sign` sets feePayer if not set? Looking at web3.js: `sign(...signers) { if (signers.length === 0) ...; const message = this.serializeMessage(); ... }` It may not set feePayer. `serializeMessage` throws if feePayer missing? In tests, they often set transaction.feePayer. `sendAndConfirmTransaction` maybe sets `transaction.feePayer = transaction.feePayer || signers[0].publicKey`. I think yes in Connection? Let's recall: `sendAndConfirmTransaction` in @solana/web3.js: 
```
transaction.feePayer = transaction.feePayer || signers[0].publicKey;
transaction.sign(...signers);
```
Probably. So operator fee payer. Thus works. Still should mark isSigner true. LOW.

Revenue swap inspection remains CRITICAL. Because operator signs versioned transaction from Jupiter; fee payer likely operator. It can drain.

Need inspect `revenue.mjs` swap tx: It deserializes VersionedTransaction from Jupiter. It checks `msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures)` signers length 1 and equals operator. It does not check if operator is writable? It signs. If transaction includes a system transfer from operator to attacker, operator is signer and writable. Allowed. So yes.

Could Jupiter API be trusted? It's external. If DNS/MITM, blank cheque. They use HTTPS. Still supply chain. The code says bound not proof. We can file as HIGH/CRITICAL because it violates "operator holds nothing but cycle's funds" but even cycle funds can be stolen. The recommended fix: positive allowlist of program IDs and/or simulate balance changes; restrict to Jupiter program and token program, no system transfers except wrap/unwrap, no delegates, no close authorities, no upgrade. But Jupiter routes through many programs, allowlist hard. Use Jupiter's verified transaction? Maybe sign with a separate ephemeral wallet funded exactly amount? Still swap tx could send SOL to attacker. Need verify route instructions. Could use simulation with `replaceRecentBlockhash` and balance changes. But simulation can be bypassed? If sign exactly what simulated. Use trusted Jupiter SDK. Anyway.

32. bank/anchor.mjs missing. `pinnedAccountData` used but not provided. Could be a fault: cannot verify. But maybe omitted for brevity. We can note as insufficient evidence. But final answer should focus.

33. MINT `update_wiring` needs_governance for `max_sweep_lamports.map_or(false, |x| x > c.max_sweep_lamports || x < MIN_ADMIN_SWEEP_LAMPORTS)`. If governance present, it allows lowering below MIN_ADMIN? Yes. But if admin alone tries to lower below MIN, needs_governance true and fails without governance. With governance, allowed. But later require x >0 && <=MAX. So governance can wedge to 1 lamport. The comment says past these holders involved. So maybe intended. But if governance is GOV PDA, cannot sign update_wiring, so wedge via governance impossible unless rotate. So admin alone cannot wedge below floor. Good.

34. MINT `update_wiring` needs_governance for `sweep_cooldown_secs.map_or(false, |x| x < c.sweep_cooldown_secs || x > MAX_ADMIN_SWEEP_COOLDOWN_SECS)`. If admin wants to lower cooldown but still >= MIN, needs governance. If governance PDA impossible. So cooldown cannot be lowered by admin; can be raised up to 24h admin, beyond governance. Good.

35. MINT `update_wiring` if needs_governance and governance signer present, it only checks gov.key == c.governance. It does not check governance is not default? c.governance set at init. Good.

36. MINT `set_collection_royalties` accounts: config has_one admin? `#[account(seeds..., has_one = admin)]` and admin Signer, governance constraint. Good. But `payer` is Signer mutable, `mint_authority` PDA. It invokes Core add/update collection plugin. The collection account must be mutable. Good.

37. Royalty plugin RuleSet::None. Does RuleSet None mean no restrictions? It might allow transfers? Royalties plugin has rule set for enforcement? Core royalties can have rule set for programmable? None likely marketplace standard. Fine.

38. MINT `mint_vault` plugin encoding: It sets PermanentFreezeExecute frozen=1 authority SEAL. It also sets Attributes authority SEAL. What about plugin count? It says 2 plugins. But then after attributes authority, `data.push(1); data.extend_from_slice(&0u32.to_le_bytes());` Could be `Option<Collection>`? Let's parse CreateV2 instruction: Core CreateV2 maybe has data: name, uri, Option<Collection>, Option<Vec<Plugin>>? If so, they push 1 for plugins? Hmm. Tests pass. Not issue.

39. BURN `burn_vault` account `asset_signer` seeds with bump. It requires `seeds::program = MPL_CORE_ID`. Good. If Core changes PDA derivation, fail.

40. BURN reads SEAL config `reserve_mints` but does not check `d.len()` includes padding? It checks len >= OFF_RESERVES+4+n*32. Good.

41. BURN `require!(ctx.remaining_accounts.len() == declared as usize)`. declared u8. If remaining accounts >255 impossible? no.

42. BURN second loop: For Core assets, it requires `d.is_empty() || d[0] != KEY_ASSET_V1`. If a nested Core asset is declared but already burned (key byte maybe 0 or account empty), it allows. If a burned inner vault still owns contents? Burned inner asset's PDA may hold tokens; but inner asset burned, its PDA unreachable. Declaring a burned inner asset doesn't catch its contents. But if inner vault burned, its contents already destroyed/released. Not relevant. If an attacker nests a burned asset? no value.

43. Could a nested vault be hidden by declaring its asset account but data empty? Core asset burned data maybe not empty but key 0? If key !=1, allows. If inner vault is live, key=1, refuses. Good.

44. Could a nested vault be owned by PDA but not declared; burn allows. Known.

45. Could a token account owned by PDA be declared but data length <165 and owner token program? The reserve loop: if d.len() < TOKEN_ACCOUNT_LEN continue; second loop: if d.len() >= TOKEN_ACCOUNT_LEN check; if <165 skip. A malformed short token account with balance? Token program accounts are 165 or T22 extensions >165. Short data cannot hold balance. If owner token program and len<165 but lamports>0, skipped. Could this hide lamports? The lamports are rent; not token balance. After burn, short account with lamports stranded. Could an attacker create a token account with short data? Token program initializes fixed size. Not possible except owned by token program but data truncated? Account data cannot be truncated. So okay.

46. The reserve loop for T22 derivation: if account exists owned by T22 with len 170 (ImmutableOwner extension), `d.len() <165` false, then checks owner, delegate offsets, then `require!(d.len() == 165, ReserveHasExtensions)`. So T22 reserve ATA would refuse. But classic mint T22 unreachable. If a non-reserve T22 account declared, second loop refuses extensions. Good.

47. The burn's delegate/close checks offsets for T22 accounts with extensions? It requires len==165 before, so no T22 extensions. For second loop, same. Good.

48. Could a Token-2022 confidential transfer account have base amount zero but actual confidential balance nonzero, len >165, refused. Good.

49. Could a classic SPL token account have `close_authority` option zero but pubkey nonzero; no effect. Good.

50. Could a reserve ATA have delegate option zero but delegated amount nonzero stale; no effect. Good.

51. The burn requires PDA lamports zero. It does not require PDA data empty. PDA is system account maybe data? Core asset_signer PDA likely no data. If someone assigns data to PDA? System program cannot assign data without owner? PDA owner is system? Core Execute could maybe assign? Not. If PDA has data but zero lamports, after burn remains? Could be. Not value.

52. The open/burn pairing uses instruction sysvar. There is a known vulnerability with address lookup tables and instructions sysvar? Need be certain. Let's research from memory: The Instructions Sysvar does not support versioned transactions? There was a note: `load_instruction_at_checked` only works with legacy transactions? Actually sysvar instructions was updated to support v0? The feature `enable_transaction_account_loading`? Hmm. If not, using ALT would cause load_instruction_at_checked to fail or return wrong accounts, potentially fail closed. But could it be exploited? If open cannot find burn when ALT used, redemption halts. Not leak. If burn cannot find open, halt. So safe. But if sysvar instructions for versioned tx includes only static keys, an attacker could put burn's asset/owner in ALT such that load_instruction_at_checked returns index out of bounds? It would fail closed. No leak.

But could an attacker use ALT to make `ix.accounts.get(BURN_IX_ASSET_IDX)` return a different pubkey than actual executed burn? If sysvar resolution mismatch between compile-time and runtime? The runtime executes with loaded message; sysvar should match. If not, maybe. Need not speculate.

53. Could a transaction include two instructions with same program/data/accounts but one is a duplicate? no.

54. Could open_for_redemption be front-run? Bank and owner sign; no.

55. Could an attacker replay RedemptionOpened event? no.

56. SEAL `update_config` reserve_mints additive-only: requires every old in new. It allows adding duplicates? `x.contains(old)` but doesn't check x unique. Could admin add same mint twice? reserve_mints vec may contain duplicates. Burn loops duplicates, requiring same ATA twice? It iterates reserves; duplicate mint leads same expected ATA, find in remaining accounts; okay but declared count? It doesn't require unique. Could cause no harm but waste. Could add duplicate to inflate? MAX 8. LOW.

57. SEAL `update_config` reserve_mints can replace with a superset but order can change. Additive-only by contains; can reorder. BURN reads list order; no issue. Could remove by replacing with same set plus new? no removal. Good.

58. SEAL `assert_classic_spl` requires remaining accounts include each mint. In `initialize`, reserve_mints passed and remaining_accounts? Anchor `Initialize` accounts only config, admin, system. The mints are in `ctx.remaining_accounts`. Good. In `update_config`, remaining accounts. If duplicate mint, find first. Good.

59. SEAL `initialize` requires admin == INIT_AUTHORITY. But admin account is Signer mutable. If INIT_AUTHORITY is Squads PDA off-curve, it signs by CPI. Can Squads CPI call initialize with admin as PDA signer? Anchor Signer requires is_signer true. Squads can CPI with PDA signer? Yes if Squads program invokes and passes admin PDA as signer via invoke_signed? But admin is not a PDA of Squads? Squads vault PDA is owned by Squads program; it can sign CPI. Anchor account_infos is_signer true if runtime. Good. Localnet test uses keypair.

60. BURN initialize also INIT_AUTHORITY. Good.

61. Program upgrade authorities: four separate. But if upgrade authority not moved to multisig, can upgrade. SPEC says must move. Alarm watches upgrade authority. Good.

62. CONFIG_PADDING: They allocate padding but Anchor `Account<Config>` deserialization may fail if account data larger than struct? Borsh deserialize ignores trailing? Anchor uses `try_deserialize` which may check length? Anchor's `Account` uses `T::try_deserialize(&mut data)`; Borsh deserialize does not require exact length, leaves trailing. Good.

63. Events: RedemptionOpened emitted after thaw. If transaction later burn fails, event not persisted? Events only on success. Good.

64. BURN emits VaultBurned after Core burn. Good.

65. Alarm `detectBurns` uses `assetSet` including burnt. For program burn, it doesn't check assetSet; any burn_vault instruction. Good.

66. Alarm `detectVaultSetChange` uses prevLive from state. On first run, no findings. If state deleted, EVER marker prevents. Good.

67. Alarm `report` bottom line claims "no burns" etc. If findings include HIGH program burn, bottom line ACTION REQUIRED. Good.

68. Alarm `--reconcile` calls report with looked txs 0. It does not update state. Good.

69. Alarm `main` writes state after report delivered. If not delivered, reverts baselines but keeps cursors? It sets next.config=prev.config, activation, balances, cursors, vaults, deferredSweeps. It does not revert seenSplits? If undelivered, next seenSplits includes current seen splits? It constructs next with seenSplits dedupe current+prev before delivered. If not delivered, it doesn't reset seenSplits. That means splits observed in a failed alert pass are recorded as seen even though findings not delivered. Could suppress later split_not_on_chain? If a CRITICAL finding delivery failed, state not written? Wait `if (!DRY) writeState(next)` occurs regardless delivered? Code: after report, if !delivered revert some fields, then if !DRY writeState(next). So state is written with reverted baselines but seenSplits not reverted. If delivery failed, the pass still advances seenSplits, potentially silencing split claims next pass. But if report failed, findings not delivered; state should not consume. They revert cursors to prev to re-report transactions, but seenSplits derived from transactions would also be re-scanned because cursors reverted? If cursors reverted, next pass rescans same transactions and re-adds seenSplits. But seenSplits already stored; no harm? It may anchor splitByOther. But if a split claim finding failed to deliver, next pass with cursors reverted will rescan and see split again. seenSplits persisted maybe duplicate. Dedupe. Not issue.

But they revert `next.cursors = prev?.cursors ?? {}`, so transactions re-scanned. Good.

70. Alarm `detectUnledgeredSweeps` deferred sweeps: if delivery failed, next.deferredSweeps includes prev + current deduped. Good.

71. Alarm `readConfigs` throws if missing watched keys. If a program not deployed, `_missing` keys. missingWatchedKeys ignores if `snap?.[prog._missing]`. Good. But if program missing, collection keys missing? It ignores. Fine.

72. Alarm `WATCHED_KEYS` includes `burn.pending_bank_at` etc. readConfigs burn reads. Good.

73. Alarm `detectStandingRisks` checks `mint.paused === 1`. readConfigs paused u8. Good.

74. Alarm `detectStandingRisks` collections_disagree only if colls.length >1. If one program missing, no alarm. But missing program itself reported? If mint missing idle. If burn missing but mint present, colls length 3, distinct maybe 1. Missing burn not compared. But readConfigs missingWatchedKeys ignores missing program; no drift. If BURN not deployed, redemptions impossible. Alarm maybe should CRITICAL. But initial deployment. LOW.

75. Alarm does not compare seal.bank vs burn.bank vs mint.bank standing. It watches drift individually. If all change together? Drift from prev catches. If initialized with mismatched bank, first run baseline no standing check. `readConfigs` could check bank agreement. On-chain burn/mint will fail if mismatch. But first pass wouldn't alarm. Could be LOW.

76. `detectStandingRisks` split_bps must be 8500. But update_wiring governance can change split_bps with governance. If holders vote? Actually governance PDA cannot sign update_wiring, so split_bps unrotatable after governance PDA unless rotate. If changed, CRITICAL. Good.

77. `detectStandingRisks` weak_rotation_timelock only checks mint.governance_timelock_secs. SEAL/BURN/GOV use constant 7d, not configurable. Good.

78. `detectStandingRisks` sweep_cooldown_too_short min default 3600. Program floor 1. Good. sweep_cooldown_wedged max default 12h, but program admin max 24h, governance max 7d. If cooldown set 13h, alarm HIGH. Maybe operational. Good.

79. `detectStandingRisks` sweep_cap_wedged min default 5 SOL. Program admin floor 1 SOL. If cap 2 SOL, alarm HIGH. Good.

80. `detectUnreconciledRevenue` missing ledger CRITICAL. Good.

81. `cycleIsOpen`: if returnedSats zero but splitSig present? It returns true because returnedSats 0. Good. If splitByOther true but returnedSats 0, still open? `return BigInt(c?.returnedSats ?? 0) === 0n || !(c?.splitSig || c?.splitByOther)`. If returned 0, open. Good.

82. revenue.mjs split catch: if `isProvablyEmpty(revAta)` then splitByOther. But if revAta empty because swap returned zero and split never happened, it could falsely close cycle? However before split, it checked delta >= minOut and returnedSats recorded >0. If delta >0, revenue ATA should have balance. If someone else split, empty. If return transaction failed? It confirms return before split. Good. If revAta absent? isProvablyEmpty false for absent. Good.

83. revenue.mjs return uses `got = after` total operator ATA balance. If operator ATA had preexisting cbBTC not from this cycle, it returns all, records delta. Good. If preexisting from attacker, project gains. Fine.

84. revenue.mjs swap inspection: It forbids MINT_PROG but not TOKEN_2022? Could interact with T22. Not value? Could approve delegate on operator cbBTC ATA? Token program approve allowed. A malicious swap tx could approve delegate on operator's cbBTC ATA to attacker, then later drain. It signs. The inspection doesn't forbid Approve. CRITICAL. It could also set close authority. Need mention.

85. revenue.mjs uses `conn.confirmTransaction` for swap. If swap tx includes a self-transfer of cbBTC to revenue? It could fake delta? The delta check reads operator ATA after. If malicious tx transfers cbBTC from attacker to operator, delta positive, could satisfy minOut without actually swapping swept SOL. But attacker would need to fund; not beneficial. Could be used to cover theft of SOL? If tx drains SOL to attacker and transfers cbBTC from attacker to operator, delta okay, revenue gets cbBTC, but SOL stolen. The operator key is compromised? If Jupiter API malicious, it could use attacker's cbBTC to satisfy delta while stealing SOL. Then cycle appears returned. This is possible if API compromised. Inspection allowlist needed. CRITICAL.

86. The swap operator long-lived key can hold SOL from previous cycles if not swept? It should be fresh. Open.

87. bank/detectors.mjs `detectBurns` for program burn doesn't verify discriminator if `burnVaultDiscriminator` null. alarm passes IX_BURN_VAULT. Good.

88. `detectPdaTokenAccounts` for ATA program parsed info: `wallet` and `account`. If ATA creation idempotent for existing account, parsed maybe? Fine.

89. `detectApprovals` fallback ataOwner only maps reserve ATAs. If approve on non-reserve PDA token account, ataOwner undefined, pdaSet.has(info.owner) maybe if parsed owner present. If parsed owner missing and non-reserve, miss. But reconcile covers. LOW.

90. `detectIndexShortfall` if mintedTotal is string, BigInt. Good.

91. `distribute.mjs` uses `readTokenAccount` which only accepts classic TOKEN program. cbBTC classic. Good.

92. `distribute.mjs` if DAS returns duplicate live ids, unique. If duplicate burnt, Set. If live+burnt unique count equals mintedTotal. Good.

93. `distribute.mjs` plan activated sorted. If balances object has vaults with missing ATA 0. Good.

94. `distribute.mjs` fee floor `needSol = 5_000 * outstanding * 2`. Why *2? Maybe transfer fee and ATA creation? It doesn't create ATAs. 10k lamports per transfer. Fine. If distributor SOL below, exit 1. Good.

95. `distribute.mjs` if `plan.skip`, marks nothingToDo finished. Good.

96. `distribute.mjs` ambiguous rows never retried until human resolves. Good.

97. `lock.mjs` readLedger marker: writeLedger writes marker before rename. If marker write succeeds but rename fails, marker exists without ledger; next read missing ledger throws. Safe (refuses fresh start). If rename succeeds but marker missing? write marker first. Good.

98. `lock.mjs` claim tmp file: `fs.writeFileSync(tmp, payload)` default mode 0o666? umask. Lock file permissions maybe world-readable? Contains pid/token, not secret. Fine.

99. `lock.mjs` withLock passes `l` to fn? fn doesn't use. release token. Good.

100. `scripts/run-tests.sh` MIN_ASSERTIONS=259. The test suite output count? It has many rec. We don't need run.

101. `scripts/build-mainnet.sh` asks initauth test. Not provided tests/initauth.test.ts. Could be missing. But not code under audit? Maybe.

102. `cron-install.sh` deadman uses find on state file. If state file missing, `[ ! -f ]` true notify. Good. Logs in /var/log/cbob. Fine.

Now need prioritize findings under headings.

Potential CRITICAL findings:
1. UNBREAK/NESTING: Bank pre-signature completeness scan not implemented; alarm reconcile only post-hoc and misses nested Core assets. Undeclared holdings destroyed. This is probably CRITICAL because real Bitcoin destroyed if Bank signs without scan. But known consequence? They ask question; not re-report known gap? The gap itself is known and asserted as allowed. The new fault is the control claimed in comments is not implemented. That is a real defect. CRITICAL.
2. MINT/revenue: revenue.mjs signs arbitrary Jupiter versioned transaction with only negative allowlist; operator can be tricked into signing SOL drain / delegate approval. CRITICAL.
3. THE INVARIANT/distribution: distributor key can move whole pool; alarm reconciles distribution only against self-written ledger, no chain-derived outgoing transfer reconciliation. CRITICAL/HIGH. Carry-over accepted not fixed. Since real Bitcoin, CRITICAL.
4. UNBREAK capacity: legacy transaction size with additive reserves can strand vaults; max ~3, no ALT support tested. HIGH maybe CRITICAL? Author believes most likely kills Bitcoin. If reserve list already 3, adding any strands. But currently 1 in tests; intended 3. If 3 fits? Need determine. If 3 may be near limit. If 8 impossible. This is liveness/stranding, not theft. HIGH.
5. UNBREAK: T22 ATA declaration dead weight halves capacity. MEDIUM.
6. UNBREAK: burn allows zero-balance reserve ATAs left open, stranding rent lamports; not enforced closure. LOW/MEDIUM.
7. ROYALTY: after governance PDA, set_collection_royalties unreachable without rotation; liveness. MEDIUM/LOW.
8. VOTING: no on-chain cancellation of passed proposal; execution window and forward only. Maybe LOW.
9. VOTING: quorum divisor includes burned vaults; admin lower quorum only remedy; potential governance deadlock if admin lost. Known. MEDIUM/LOW.
10. TRANSFER: no on-chain prevention of bricking transfer to PDA/nesting. Known measured fact, not bug. But final gap.
11. SELL: marketplace cannot on-chain verify completeness; buyer basis relies on off-chain. Known. LOW.
12. MINT: dangling Attributes authority and stale redemption attribute. LOW.
13. MINT: BURN config not checked at mint; if BURN collection/bank diverged, mint sells unredeemable vaults. MEDIUM? Alarm watches collections but bank divergence? On-chain burn fails. Could be LOW.
14. UNBREAK: SEAL/BURN pairing hardcodes indices; fail-closed true for accidental drift but not for malicious BURN upgrade. If BURN upgrade authority compromised, can bypass. But upgrade authority risk general. LOW/INFO.
15. Alarm severity noise: detectBurns HIGH and vault_set CRITICAL on every legitimate redemption. MEDIUM/LOW.
16. lock.mjs residual TOCTOU; use flock. MEDIUM/LOW.
17. revenue.mjs sweep instruction isSigner false but fee payer saves; fragile. LOW.
18. alarm.mjs bs58decode silent empty on non-base58; maybe LOW.
19. alarm.mjs does not watch Core program hash/upgrade authority. MEDIUM.
20. GOV/MINT: governance timelock floor 60s, deployed must days; alarm asserts. Known. LOW if not production.
21. MINT `update_wiring` governance can set sweep cap to 1 lamport/cooldown 7d, wedging pipeline. If governance is holders, maybe accepted. LOW.
22. BURN `burn_vault` requires preceding open; if SEAL open fails for a reason burn wouldn't (e.g., already thawed migration), could strand. Need evaluate. Since no live vaults, LOW. But if v2-v4 thawed vaults exist, migration risk. MEDIUM? The prompt asks f. Answer: yes, any condition that makes open fail but burn's own checks would pass now strands, because burn requires open. Examples: lost bank key (burn also requires bank), wrong collection (burn also), owner PDA (burn also). Already thawed legacy asset if Core update plugin to false errors. Also if instructions sysvar not passed? burn requires. Under v5 no persistent thaw except legacy. So mostly no new stranding except legacy thawed or size capacity. We'll state.

Need think about possible critical pairing bypass: Could open_for_redemption thaw and burn not execute if burn instruction is present but account index 2 owner matches, yet burn instruction's data has disc but is not Anchor `burn_vault` because BURN program has another instruction with same discriminator? Discriminator unique per name. If BURN program upgraded to include instruction with same disc but not burn? Accidental unlikely. Malicious upgrade. No.

Could an attacker create a transaction where open matches a burn instruction that is present but the BURN program is not executable because account not loaded? If program_id BURN but account not executable? Transaction validation fails before execution. no.

Could open be paired with burn in same transaction but burn instruction's accounts use address lookup table such that `load_instruction_at_checked` returns account at index 2 as owner, but at execution the account at index 2 is different due to ALT loading failure? Runtime resolves before execution; if mismatch, transaction fails. no.

Could a CPI wrapper call open with instructions sysvar account that is not the real sysvar? Anchor address check. no.

Could an attacker pass a fake instructions sysvar account owned by a program that mimics load_instruction_at_checked? The sysvar ID is fixed; account must be sysvar. no.

Could open's scan be fooled by a burn instruction in the same transaction but in a different message? No.

Could durable nonce allow a transaction to be signed with open+burn, then later modify instructions? Nonce only blockhash; message signed. no.

Could two redemptions share transaction and cross-pair via same owner? Suppose open A scans and finds burn B? It checks asset A, so no. open B finds burn B. If burn A and burn B both present, okay. If sweep A uses B's burn? no.

Could burn A scan earlier and find open B if same owner but asset different? checks asset. no.

Could owner be same but asset account index 0 in burn is collection, not asset, due to account reordering? If BURN account order drift, fail closed or maybe cross? If BURN upgrade moves asset to index1 but owner remains index2, open checks index0 (now collection) == asset? false -> halt. If moves collection to index0 and asset to index1 but collection pubkey equals asset? impossible. If owner moved but index2 happens to be owner duplicate, maybe. But burn's own checks. Accidental drift likely halt.

Could a Core upgrade change asset data layout so read_core_asset returns wrong owner/collection, allowing burn of foreign asset? Both programs read raw. If Core upgrade changes layout but keeps program ID, catastrophic. But Core semantics. Not in code.

Potential issue: `read_core_asset` assumes collection pubkey at bytes 34..66 if data[33]==2. For Core AssetV1, update authority enum: 0 None? 1 Pubkey? 2 Collection? If collection, byte 33 disc, bytes 34..66 collection. Good. If asset not in collection but update authority pubkey, data[33]!=2 -> ForeignVault. Good.

Potential issue: BURN `burn_vault` reads asset owner/collection before checking open. If asset account data is mutable and can be changed between open and burn? Core asset owner can change via transfer. If transfer between open and burn, burn's owner check fails. Revert. If transfer to same owner? no.

Potential issue: open checks asset owner == owner before thaw. If between open and burn, an instruction changes asset owner to a PDA that cannot sign but burn's owner still original? Burn reads current owner; if changed, fails. Revert. Good.

Potential issue: The sweep instructions between open and burn can transfer the vault asset itself to another owner after open. Then burn fails. Revert. No leak.

Potential issue: The owner can sweep contents to a third party, not themselves. Bank co-signature should refuse if not customer? But on-chain allows. If Bank key compromised or malicious, can co-sign drain to attacker and burn. True 2-of-2 means Bank trusted. Not a defect.

Potential issue: Bank co-signature cannot be enforced to scan; if Bank key is offline but signs blindly, risk. Operational.

Potential issue: `open_for_redemption` requires bank signer but does not check bank signed the exact transaction? Solana signature covers. Good.

Potential issue: The Bank key is also used as payer in tests; in production maybe same. If bank key compromised, can co-sign malicious redemptions but cannot move without owner. It can enable owner? If owner malicious, they already can redeem to themselves. Bank compromise alone cannot steal because needs owner signature. But can co-sign burns for owners? Needs owner. So 2-of-2.

Potential issue: MINT bank co-signature: if bank compromised, can mint arbitrary vaults in rounds? It needs owner and payer. Could mint to itself? It can be owner/payer if round open and cap. But price goes revenue. Not theft.

Potential issue: GOV admin key can lower quorum to 500 and raise threshold? Threshold ratchet up only; quorum both. If admin compromised, can make governance capture easier but proposals still need votes. Could lower quorum to 500 (5%) and if attacker holds vaults? Need buy/rent vaults. Vote renting possible. MEDIUM.

Potential issue: Vote renting atomic. Known.

Potential issue: Proposal create uses live asset owner; if vault transferred to a contract that can flash-loan? No.

Potential issue: GOV `execute_proposal` can be called by anyone during execution window. If a proposal passes but round should not be set due to market conditions, no cancel. Governance could execute newer superseding proposal. If none, anyone can execute. This is intended. LOW.

Potential issue: MINT `set_round` can be called by governance key before rotation to PDA without vote. Initial governance is a keypair in tests; production should be GOV PDA. If not, admin/gov key can set rounds unilaterally. The initialize sets governance pubkey; rotation timelock needed. Alarm watches pending. But if initial governance is not GOV PDA, risk. SPEC says once governance is PDA. Need ensure deployment. Finding: governance must be rotated to GOV PDA before mainnet; until then set_round and royalty changes can be done by key. But known. LOW/MEDIUM.

Potential issue: `set_collection_royalties` requires governance signer. If governance is GOV PDA, impossible. If initial governance key malicious, can set royalty up to 1000 bps with admin. Admin+gov. If admin and gov same entity? Timelock prevents admin appointing gov quickly, but initial gov may be key. Operational.

Potential issue: MINT `update_wiring` treasury requires governance signer. If governance key not PDA, admin+gov can change treasury. If admin and gov collude, no timelock. But governance should be PDA. Known.

Potential issue: `apply_pending_governance` permissionless. If pending governance armed accidentally to wrong key, after timelock anyone can apply. Admin can cancel before. Good.

Potential issue: `cancel_pending_bank` admin only. If admin compromised, can cancel bank rotation. But admin rotation timelocked. Good.

Potential issue: SEAL/BURN rotation notice constant 7d, not configurable. If bank key compromised, admin can arm rotation, but attacker admin? Admin rotation also 7d. Good.

Potential issue: SEAL `update_config` reserve_mints addition requires assert_classic_spl with remaining accounts. If admin adds a mint that is classic but has freeze authority? cbBTC has freeze authority? A reserve mint with freeze authority could freeze vault PDA's ATA, preventing sweep, stranding vault. The config only checks classic SPL, not mint freeze authority. cbBTC has live freeze authority (mentioned in distribute comments). If freeze authority freezes a vault's cbBTC ATA, redemption sweep fails, burn refuses non-empty. Vault stranded until unfrozen. This is a real risk: reserve mint's freeze authority can DoS all vaults holding that mint. The author knows cbBTC has freeze authority? They mention in distribute.mjs: "cbBTC has a live freeze authority, so a frozen destination ATA is refused". For vault PDA ATAs, cbBTC freeze authority could freeze them. If cbBTC issuer freezes a vault's ATA, contents stranded. Is this a finding? The system chooses cbBTC as reserve; cannot avoid. But adding a reserve mint with malicious freeze authority could strand. assert_classic_spl doesn't check freeze authority == none. Under UNBREAK/INVARIANT. Severity MEDIUM/HIGH because admin could add a mint with freeze authority, or cbBTC issuer can freeze. But cbBTC is real Bitcoin token, trusted. For reserve list additive, admin mistake can strand. Recommend check mint freeze authority disabled? SPL mint has freeze_authority option. Could require None for reserve mints. But cbBTC may have freeze authority live, so cannot. If require none, cbBTC fails. So accepted external risk. But for future mints, should check. Maybe MEDIUM.

Potential issue: A reserve mint with transfer fees (Token-2022) not allowed. Classic SPL has no transfer fee. Good.

Potential issue: A reserve mint with decimals mismatch? Sweep uses client decimals; burn only amount zero. If mint decimals large, no issue.

Potential issue: If cbBTC freeze authority freezes ATA during redemption after open before burn, sweep fails, tx reverts. No loss. But if frozen with zero balance? burn allows? It doesn't check state. If zero frozen, burn succeeds. Fine.

Potential issue: The burn emptiness proof checks amount zero but not that token account is initialized/state. If account uninitialized? owner not token program. If token account state uninitialized? Token program data state byte at 116 =0. Could an uninitialized token account with amount zero pass? It is owned by token program, len 165, owner PDA. If state uninitialized, it cannot hold tokens. Burn allows. After burn, no issue. But could it be later initialized? Owner PDA unreachable. No.

Potential issue: The PDA could own a token account that is not rent-exempt? Token accounts must rent-exempt. no.

Potential issue: `burn_vault` second loop for Core assets: if acc.owner == MPL_CORE_ID and data empty, allows. But a Core asset account with lamports? Core assets hold rent. If declared nested asset live, refuses. If declared burned asset with lamports, allows; its lamports maybe stranded? Burned asset account may have lamports? Core BurnV1 closes asset and returns rent to payer? If inner vault burned, its asset account maybe empty. Not value.

Potential issue: If outer vault holds an inner vault, and inner vault is declared, burn refuses. To redeem outer, must first un-nest inner? Inner owner is outer PDA, cannot sign to transfer out. So outer unredeemable if inner nested, even declared. The only remedy? Could Core Execute by outer owner transfer inner out? Wait inner vault owner is outer asset_signer PDA. To transfer inner asset out, Core TransferV1 requires inner asset owner signature? The owner is outer PDA. Outer PDA can sign via Core ExecuteV1 for outer asset, with outer owner's signature. So while outer is thawed, outer owner can use ExecuteV1 to transfer inner vault out (because outer PDA is the owner of inner, and Core Execute can make outer PDA sign arbitrary CPIs, including TransferV1 for inner asset). Is that possible? The inner vault is a Core asset owned by outer PDA. To transfer inner, authority is owner (outer PDA). Core ExecuteV1 on outer asset can make outer PDA sign CPI to Core TransferV1, transferring inner to alice. Thus a declared nested vault can be swept out before burning outer! The test 9.4 declares inner and burn refuses; but they didn't test sweeping inner out. The known consequence says nested vault is unredeemable because its owner is a PDA cannot sign (9.3) — that's for inner's own redemption. But outer owner can extract inner asset via Execute? Does ExecuteV1 allow signing for nested asset transfer? The outer PDA is owner of inner; Core TransferV1 requires owner signature. ExecuteV1 can sign as asset_signer of outer for arbitrary instructions, so yes, it can sign TransferV1 for inner. But does PermanentFreezeExecute plugin on inner prevent transfer? Inner vault is frozen with its own seal; freeze plugin maybe doesn't block transfer? It gates Execute, not transfer. If inner has no transfer restrictions, outer PDA owner can transfer inner out. However outer PDA cannot sign top-level, but Execute can. So a nested vault is not necessarily orphaned if declared and outer redeemed: owner can sweep inner out to themselves, then burn outer. The test 9.4 only tried burn with inner declared, not sweep inner. The prompt's measured 9.3 says nested vault unredeemable because owner PDA cannot sign. That is true for redeeming inner directly. But it can be transferred out by outer's Execute if outer owner knows. Is that a fault in their known consequences? They assert "a nested vault is unredeemable because its owner is a PDA that cannot sign (9.3); DECLARED, the burn refuses (9.4, 9.8); UNDECLARED, the burn ALLOWS and the inner vault is orphaned forever (9.5)". If declared, burn refuses, but there is a path: transfer inner out in same redemption. Is it actually possible? Need verify Core ExecuteV1 can transfer a nested asset owned by the PDA. ExecuteV1 requires asset owner's signature (outer owner) and makes asset_signer PDA sign. The inner asset's owner is outer asset_signer PDA. Core TransferV1 accounts: asset, collection, payer, authority owner, newOwner, system? If authority is PDA, it must sign. Execute can CPI with PDA signer. So yes. Unless Core TransferV1 checks authority is transaction signer, and CPI signer PDA okay. So declared nested vault can be rescued. The test suite may not have tried. If true, their statement "DECLARED, the burn refuses" is correct but incomplete: declared nested holding can be swept out (the asset itself) before burn. For undeclared, if Bank doesn't know, destroyed. But on-chain construction can close? The owner can always declare and sweep nested Core assets out if they know. The burn refuses until removed. So for nested vaults, there is an on-chain recovery path for declared. For airdropped tokens, if declared, can sweep via token transfer. If undeclared, destroyed. The completeness gap remains. Need not contradict measured tests? Test 9.4 says burn outer with nested declared REJECT. It doesn't say cannot sweep. 9.3 says redeem nested vault (inner directly) REJECT. Fine. The question: "is there ANY on-chain construction that closes this" (undeclared holdings destroyed). For declared nested, yes sweep out. For undeclared, no enumeration. Could a construction require all nested assets declared by using DAS? No on-chain. So answer nuanced.

But wait: inner vault is frozen with PermanentFreezeExecute. Does that prevent transfer? The plugin type is Execute, not Transfer. The spec says PermanentFreezeDelegate blocks transfer but not burn; they use PermanentFreezeExecute, which gates ExecuteV1. It likely does not block transfer. So inner can be transferred by owner PDA via Execute? To call Core TransferV1, the authority is inner's owner (outer PDA). Does inner's PermanentFreezeExecute frozen=true block TransferV1? No, only ExecuteV1 on inner? The plugin is on inner asset; TransferV1 may check freeze delegate? Not freeze execute. So transfer allowed. Good.

Could this be used to steal? If someone accidentally sends vault to another vault's PDA, the outer owner can take it. That's actually recovery. But if outer owner malicious? They own outer, inner was sent to them effectively. Fine.

For undeclared inner, if outer owner doesn't declare, burn destroys. Bank scan could detect via DAS getAssetsByOwner? Need implement.

Potential issue: burn_vault's Core asset check only applies to declared remaining accounts. If inner asset is undeclared, invisible. If declared, refuses. But if inner is transferred out, no longer owned. Good.

Potential issue: The sweep of nested Core asset requires the inner asset's collection account? TransferV1 may need collection. The outer owner can pass. Transaction size increases.

Now, any way to close undeclared gap on-chain by forcing all Core assets owned by PDA to be declared? No enumeration. Could use a plugin on vault that blocks receiving assets? Core doesn't have receive hook. Could use Token-2022 transfer hook? Not for Core. So no.

91. Another potential pairing bypass: The instructions sysvar contains all instructions, but `load_instruction_at_checked` may fail if instruction data is too large? It reads. If burn instruction data has extra bytes, match disc. Good.

92. Could open_for_redemption be called with `instructions` sysvar account but transaction is versioned and current index returns index in loaded message; if there are address table lookups, the number of instructions same. Good.

93. Could an attacker include a burn_vault instruction with correct asset/owner but with `declared` count 0 and no remaining accounts, so burn will fail ReserveNotDeclared. open matches, thaws, burn fails, revert. no.

94. Could an attacker use a burn_vault instruction that is present but not signed by bank, causing burn fail; revert. no.

95. Could open be paired with burn but burn's preceding open scan finds an open instruction earlier that is not the one that thawed because there are multiple opens? If an earlier open for same asset/owner exists but fails? If it fails, burn not reached. If earlier open succeeds and later another open succeeds, burn finds first. Fine.

96. Could a transaction have open A, burn A, but burn A's scan finds open A; open A's scan finds burn A. If burn A fails due to non-empty, tx reverts. Good.

97. Could an attacker use a failed open instruction earlier (e.g., wrong bank) and a later burn, but open failed so tx aborts before burn. no.

98. Could an attacker use a successful open but then modify instructions sysvar? Sysvar read-only.

99. Could an attacker use a transaction with open and burn but the burn instruction's account index 2 is owner, but owner is not signer in burn instruction; however owner is fee payer and signer. Anchor `owner: Signer` checks is_signer true. Fee payer is signer. If owner is fee payer, okay. If not, burn fails. no.

100. Could bank co-signature be replayed across transactions? Signature covers blockhash and instructions. no.

Now think about exact report style. Need be stern, no praise. Findings ordered per heading. Need include exact construct accounts, instruction order, signatures, attacker gains, fix. For operational/off-chain, construct maybe scenario.

Need decide severity ratings carefully. The prompt warns prior criticals wrong. We should only mark CRITICAL if clear loss/destruction of customer funds or pipeline theft. Let's assign:

CRITICAL:
- C1 (NESTING/AIRDROPS or UNBREAK): No pre-signature completeness scan implemented; alarm reconcile post-hoc and lacks nested Core asset enumeration. Undeclared holdings destroyed when Bank signs. Attacker gain: if Bank signs a redemption without fresh scan, nested vault/airdropped tokens destroyed; if Bank process absent, real customer Bitcoin lost. Fix: build mandatory signing service that before co-signing open/burn simulates tx, queries getTokenAccountsByOwner for both token programs and DAS getAssetsByOwner for asset_signer PDA, compares to declared accounts, refuses otherwise; include scan attestation in ops. This is arguably CRITICAL.
- C2 (MINT/revenue): revenue.mjs signs arbitrary Jupiter transaction with insufficient inspection; can drain operator's swept SOL or approve delegates. Attacker gain: MITM/compromised Jupiter API can steal cycle SOL. Fix: positive program allowlist / simulate balance deltas / ephemeral operator wallet with exact funds and verify post-swap. CRITICAL.
- C3 (THE INVARIANT/distribution): distributor key can move entire holders' pool; alarm distribution detection relies on self-written ledger, no chain-derived reconciliation of treasury outgoing transfers. Attacker gain: compromised distributor key steals 85% pool. Fix: on-chain distribution program or multisig/PDA treasury, and alarm scan treasury signatures reconciling every SPL transfer. CRITICAL.

HIGH:
- H1 (UNBREAK): Redemption transaction capacity with legacy tx and additive reserve list. Real maximum likely 3 reserve mints; 8 strands all vaults. ALT not implemented/tested; if introspection with ALT not verified, redemptions halt. Fix: measure with 3 mints, implement versioned tx + ALT for redemption builder, test pairing with ALT, or reduce required accounts (remove T22 derivations). HIGH.
- H2 (UNBREAK): burn_vault requires both SPL and T22 ATA declarations for classic mints, dead weight consuming capacity and increasing strand risk. Fix: since assert_classic_spl, derive/require only classic SPL ATAs, or store token program per mint. HIGH? Maybe MEDIUM because capacity. Since author says halves capacity; with 3 mints maybe critical. Let's call HIGH due to stranding risk.
- H3 (UNBREAK/NESTING): alarm `--reconcile` does not scan nested Core assets owned by vault PDAs; only token accounts. Thus even post-hoc detection of nested vaults missing. Fix: add DAS getAssetsByOwner for each asset_signer PDA and alarm on any owned Core asset; include in pre-sign. HIGH.
- H4 (MINT): long-lived swap operator wallet; rule "operator holds nothing but cycle's funds" unenforceable. Combined with C2. HIGH.
- H5 (UNBREAK): burn_vault does not require reserve ATAs to be closed; zero-balance ATAs can remain, stranding rent lamports permanently after asset burn. User loses SOL rent if sweep forgets close; Bank/UI may not enforce. Fix: require token accounts be closed (lamports zero / account absent) or at least emit warning; but cannot require absence if account not closed? Could check acc.lamports()==0? For token accounts, lamports >0. To enforce closure, require declared reserve ATA either absent/system-owned or lamports==0? But if closed in same tx, account lamports 0 and data empty. Could require `acc.lamports() == 0` for reserve ATAs after sweep. However if ATA exists with zero balance, lamports rent >0; burn would refuse, forcing close. This would protect rent but increase accounts? It can be done. But if ATA never created, lamports 0 skip. Fix: in reserve loop, after amount zero, require acc.lamports()==0 or owner not token program? But if token account exists, lamports >0, refuse. That would require sweep close all ATAs. Good. Severity MEDIUM maybe, because rent small. But many ATAs rent ~0.002 SOL each; not huge. MEDIUM.
- H6 (ROYALTY): set_collection_royalties unreachable once governance is GOV PDA; royalty rate/destination cannot be adjusted without rotating governance to a key, exposing timelock. If marketplace changes or royalty needs fix, liveness. Severity MEDIUM.
- H7 (VOTING): quorum divisor includes burned vaults; as redemptions increase, quorum may become unreachable; only admin can lower quorum, and admin rotation timelock. If admin key lost, governance deadlock. Known but still HIGH? Maybe MEDIUM.
- H8 (ALARM): detectVaultSetChange CRITICAL and detectBurns HIGH on every legitimate redemption; alarm fatigue. MEDIUM.
- H9 (LOCK): lock.mjs residual TOCTOU can allow two runners after stale break, double-payment. MEDIUM.
- H10 (MINT): mint_vault does not verify BURN config wiring; if BURN collection/bank diverged, mint can create vaults that cannot burn/redeem. MEDIUM.
- H11 (ALARM): alarm does not watch Core program hash/upgrade authority. MEDIUM.

LOW:
- L1 (MINT): dangling Attributes authority and stale ATTR_REDEMPTION check. LOW.
- L2 (MINT): revenue.mjs sweep instruction marks operator isSigner false; works only because operator is fee payer, fragile. LOW.
- L3 (SEAL): reserve_mints duplicates allowed. LOW.
- L4 (GOV): no proposal cancellation; passed proposals bearer-like within window. LOW.
- L5 (SELL): royalty enforcement relies on marketplaces; no on-chain escrow. LOW.
- L6 (ALARM): bs58decode silently returns empty on unexpected encoding; detectors could miss. LOW.
- L7 (MINT): governance can set sweep cap/cooldown to wedging values; alarm only detects. LOW.
- L8 (BURN): freeze state of token accounts not checked; zero-balance frozen accounts pass. LOW.
- L9 (DISTRIBUTE): race between live-asset check and transfer can pay a burned vault's ATA if burned concurrently. LOW.
- L10 (MINT): `update_wiring` emits WiringUpdated without pending values maybe confusion. LOW.

Need not overdo; final answer desired oververbosity 9, so detailed.

Need ensure findings are real and not contradicted by tests. For C1, tests assert gap allowed. The defect is not gap itself (known) but absence of pre-sign scan. The prompt asks "is off-chain control actually implemented in bank/alarm.mjs, or only asserted in a comment?" We can say only asserted; alarm.mjs has daily reconcile but no pre-sign. That's a finding. Good.

For H1 capacity, need provide real maximum. We need be cautious. Could say based on 802 bytes at 1 mint and conservative +160-200 bytes per additional reserve, legacy max is 3 mints (maybe 4 only if no destination ATAs preexist and compact encoding favorable; must measure). Since intended 3 reserves, any addition strands. With 8 impossible. ALT can rescue byte size but must be tested because instruction introspection must resolve ALT-loaded accounts; open/burn signers remain static. If ALT not supported by sysvar introspection on current cluster, it fails closed (halts), not leaks. But still strands if not implemented. Need maybe compute more exact: Additional reserve mint adds at least 4 new 32-byte account keys (classic ATA, T22 ATA, owner destination ATA, mint) =128 bytes, plus ~4 instruction account index bytes, plus two inner instructions (transfer+close) with program/account/data ~80-120 bytes, plus ExecuteV1 account list growth ~8-12 bytes. Total ~220 bytes. 802+220=1022 for 2 mints; +220=1242 for 3 mints -> over. But if some accounts shared (token program, payer) and destination ATAs maybe already in table? For each mint, destination ATA unique, mint unique, source ATAs unique. So maybe max 2? Wait 1 mint 802. Add second mint +~200 => 1002. Add third => 1202, maybe fits under 1232. Add fourth => 1402. So max 3. If per mint 220, third 1242 over; max 2. Need not exact; say empirical measurement required, conservative max 2-3. But prompt asks "What is the real maximum?" We should give a number. Let's try better estimate from known 17 accounts. For N reserve mints, distinct accounts = base? Base with 1 mint 17. Additional mint +4 accounts (source classic, source T22, dest ATA, mint) = 4. For N=3, accounts=25. Account keys extra 8*32=256 bytes over 1 mint. If 802 includes 17 accounts, adding 256 alone -> 1058. Instruction data for extra sweeps: each Execute inner transfer+close. The ExecuteV1 instruction data includes serialized inner instructions. For one mint, sweep already includes one transfer+close. Additional mint adds two inner instructions. Classic transfer instruction data 1+8=9 bytes, accounts 3; close data 1, accounts 3. Serialized inside Core maybe includes program_id? If using instruction with program_id and account metas, maybe 32+... Could be ~80 each. Two ~160. Plus Execute account indices +6. Total +~420 for two extra mints -> 1222. So 3 mints maybe just fits. If using TransferChecked (more data) bigger. Test uses createTransferInstruction (9 bytes). Real cbBTC might need TransferChecked? They use transfer. So 3 fits barely. Add 4th impossible. Thus real maximum legacy likely 3. With 8 impossible. Good. State "at most 3, and that assumes no optional accounts, compact signatures, and existing destination ATAs; measure because one extra attribute or priority fee instruction can push it over". Priority fees? Compute budget instructions add bytes. If redemption uses priority fee (likely), reduces headroom. So maybe 2 in production. We can say safe maximum 2 if priority fees/memo; measured 3 under bare test. The author measured 802 with 1; headroom 430. If each extra reserve ~200, 3 total ~1200; with priority fee maybe over. So real maximum is 3 bare, 2 operational. Need include.

ALT rescue: It can reduce 32-byte keys to 1-byte indexes but adds table lookup. For 8 reserves, accounts ~45; ALT can fit byte limit. But total account count limit? Need check. Solana max accounts per tx 64? 45 okay. Compute units maybe. Open and burn both need same accounts: ALT loads once, both instructions reference same indexes. Signers cannot be ALT; keep owner/bank/payer static. So yes, ALT can rescue if client uses versioned tx and programs' introspection resolves ALT. Must test. If sysvar instructions cannot resolve ALT, pairing fails closed and redemptions halt; no leak. Need state.

Question f: burn requires preceding open. Strand vault that could previously be destroyed? Under v5, any vault that cannot open cannot burn via program. Cases:
- Legacy thawed vault where open cannot be repeated (if Core errors on idempotent update) would strand. Need verify? We can say if any v2-v4 vault remains unfrozen, the requirement to call open again is a new dependency; if Core UpdatePluginV1 to frozen=false on an already-unfrozen asset errors, program burn is impossible and only bare Core BurnV1 (destroying contents) remains. Since nothing has minted, not current, but migration risk. Fix: allow burn if asset already unfrozen? But rule says open required. Could add a no-op open or check. But maybe open idempotent. Need test. Recommend measure.
- Transaction size: open refuses if burn cannot fit, so large reserve list strands (same as H1).
- Bank rotation divergence: if BURN bank differs from SEAL bank, open may pass? open uses SEAL bank; burn checks BURN bank and SEAL bank equal. If BURN bank stale, open succeeds? It scans burn instruction with bank maybe stale? Burn will fail WiringDiverged, so open+burn fails; vault stranded until BURN bank rotated. But open itself would thaw? If burn fails, tx reverts. So no leak. This is a liveness issue. Could happen if admin rotates SEAL bank but not BURN. Alarm watches both but no standing comparison. MEDIUM.
- If SEAL config collection diverges from BURN config, burn fails. Mint checks SEAL, not BURN. Could mint vaults unredeemable. H10.

Need include direct answers a-f perhaps as bullet list under UNBREAK before findings.

Let's formulate each answer:
a) No, not in any construction that leaves a thawed vault. Solana transactions atomic; if burn reverts, open reverted. CPI wrapper cannot satisfy top-level requirement; nested CPI invisible; current index outer; both directions require top-level. Two redemptions okay because asset+owner binding. ALT/durable nonce don't change atomicity. Only caveat: if BURN program is upgraded maliciously with same discriminator to no-op burn, then thaw could survive? Wait if malicious BURN instruction succeeds without burning, open would thaw and burn "succeeds" but not burn. That is a BURN upgrade compromise, not construction under current code. Also if Core BurnV1 fails after open? tx reverts. So answer no under current programs and honest upgrade authorities.
b) No, binding asset index0 and owner index2 in both directions is complete for pairing. It doesn't bind bank/payer/config, but burn independently enforces. Duplicate pubkeys/ALT resolved. A different vault's thaw cannot be used.
c) For accidental account/discriminator drift, yes fail-closed: mismatch -> NoTerminalBurn/NoPrecedingOpen -> halt. Adding account before index 2 shifts owner -> mismatch -> halt. Reordering that coincidentally keeps asset/owner at 0/2 but changes semantics could pass pairing, but BURN's own checks still apply; if BURN upgraded maliciously/semantically different with same name/disc and same 0/2, pairing cannot detect. Core upgrade: not covered; if Core changes layout/semantics, fail-closed not guaranteed. Also discriminator from name only; if BURN renames instruction but keeps old disc? Discriminator would change if name changes; if manually same disc? Anchor uses derive. Malicious upgrade can do anything. So author's claim true only for accidental drift, not malicious/semantic upgrades or Core.
d) True: top-level only. CPI burn cannot satisfy open; CPI open cannot satisfy burn. A wrapper would need genuine top-level open and burn, which are then independently checked. If wrapper tries to interleave, atomicity. Need mention if open/burn reached by CPI current index outer; even if not, invisible CPI fails.
e) Adding reserves can strand under legacy. Real max bare ~3 reserve mints; operational maybe 2 with priority fees/memos. 8 impossible. ALT can rescue byte limit; open/burn can share ALT-loaded non-signer accounts; signers static. Must verify instruction introspection with ALT on target cluster and compute units. Without ALT, additive reserve list is a permanent DoS of redemption. Also T22 dead weight worsens.
f) Yes in liveness sense: any failure of open now prevents program burn, even if burn's emptiness proof would pass. Examples: legacy already-unfrozen vault if re-open errors; SEAL/BURN bank or collection divergence; transaction size; missing Bank key. Under current fresh deployment and consistent configs, no value is stranded that was previously destroyable except via bare Core burn (which destroys contents). But migration and config divergence need tests/alarms.

Need check known consequences statements:
- "A NESTED OR AIRDROPPED HOLDING IS NOW DESTROYED, NOT STRANDED." True for undeclared. But declared nested can be extracted before burn; declared airdropped token can be swept. The statement "DECLARED, the burn refuses" true unless swept. "UNDECLARED, burn allows and inner orphaned/destroyed" true. On-chain construction closes? No for undeclared. Off-chain pre-sign implemented? No; alarm reconcile only token accounts daily, no nested, no pre-sign.
- "A REDEEMED CHARTER VAULT DESTROYS ITS OWN PROVENANCE." True. Mint tx + DAS burnt record? Sufficient for forensic if tx history/DAS retain; not sufficient for ordinary surfaces; charter membership may report absent. Business trade.
- "MINT still delegates Attributes plugin to SEAL PDA... dangling capability." True. Unreachable by current SEAL. Leaving it is safe but stale; reserved attribute check now meaningless. Recommend cleanup.
- "THE DELEGATE CHECK IS UNREACHABLE WHEN THE REDEMPTION CLOSES ITS TOKEN ACCOUNT... ALLOW safe?" True. Delegate on closed account no effect; recreated ATA fresh; PDA cannot sign. But note rent destination can be chosen by sweep; Bank should ensure close destination acceptable.
- "Token-2022 derivation reachable?" No for classic SPL mint; dead weight.
- "detectBurns HIGH severity?" Not right if every redemption; should be contextual. Also detectVaultSetChange CRITICAL every burn. Need fix.

Carry-over lock: Is it correct now? No residual TOCTOU; use flock/lease. Need include finding.

Now need think if any actual critical on-chain pairing bug exists. Let's scrutinize instruction introspection account indices with Anchor remaining accounts. In burn_vault, `ctx.remaining_accounts` are after fixed accounts. The top-level instruction's accounts list includes all remaining accounts. The `declared` u8 argument is in data. open matches burn instruction by data disc and accounts 0 and 2. It does not check that the matched burn instruction's `declared` count equals number of extra accounts. Burn checks. Good.

Could an attacker include a burn instruction with correct asset/owner at indices but with extra accounts that cause burn to fail after open but somehow open's side effect persists due to CPI to Core updating plugin before transaction failure? Solana rolls back all account changes on failure. There is no intermediate persistence. Good.

Could open's Core CPI update plugin be non-revertible if Core uses something? No, account data changes reverted on tx failure.

Could a partial success occur if burn fails but open succeeded and some later instruction success? Transaction fails if any instruction fails; all changes reverted. Good.

Could an attacker use a transaction with open and burn, but burn instruction is executed in a different program due to program id spoof? program_id checked. Good.

Could an attacker use a lookalike BURN program with same program id? Program id is address; only deployed BURN. If upgrade authority compromised, malicious.

Could an attacker use a transaction that includes open and burn but the burn is after a `Return`? Solana no.

Could an attacker use compute budget to cause burn to fail after open but not revert? no.

Could an attacker use a wrapper program that CPIs open and catches error? CPI errors propagate; cannot continue if open fails. If open succeeds and later top-level burn fails, tx fails. Wrapper cannot isolate errors. There is no try/catch in Solana runtime for CPI? A program can invoke and handle error, but if top-level instruction returns error, transaction fails. If wrapper CPIs open and ignores success, but open requires top-level burn later. If wrapper top-level succeeds, later burn fails -> tx fail. If wrapper CPIs burn? open won't see. no.

Could a wrapper program be the BURN program? No.

Could an attacker use a transaction with open and a burn that is valid but burns a different vault with same owner and then also a Core BurnV1 for the opened vault? open requires burn for same asset. If burn different, open fails. If open A paired with burn A, and also Core BurnV1 B? no issue.

Could an attacker use two owners same pubkey? no.

Potential issue: open scans from current+1 to end. If open is invoked via CPI from a top-level instruction at index i, current index maybe i. It scans later top-level. If there is a top-level burn for same asset/owner later, open succeeds. But burn later scans earlier top-level for open; it won't find because open is CPI inside wrapper at index i, top-level program not SEAL. Thus burn fails, tx reverts. So no thaw. But what if wrapper top-level instruction at index i is itself SEAL open? Then not CPI. Good.

Could a wrapper top-level instruction have program_id SEAL but data not open? Then not open. no.

What if open is CPI from BURN program itself during burn_vault? burn_vault does not CPI open. If it did, current index outer burn, open scans later none. no.

Now check BURN's preceding open scan: It scans `for i in 0..current`. If open is at index current? no. If open and burn same index impossible. If open earlier but after a failed instruction? failed stops. Good.

Potential issue with instruction sysvar and inner CPIs: `load_instruction_at_checked` may return instructions including CPI? The author says top-level only. If it returned CPIs, a wrapper could hide? But Solana docs: only top-level. We accept.

Potential issue: The sysvar instructions account can be passed as writable? Anchor UncheckedAccount address check; runtime sysvar read-only. no.

Potential issue: open's matching burn could be a burn instruction that is not signed by owner because owner is fee payer? If owner at index2 but not signer in instruction, but fee payer? If fee payer is owner, is_signer true. If fee payer different, burn fails. no.

Potential issue: The owner signature in open and burn can be same. Transaction signatures: owner and bank. If owner is also bank? Then 2-of-2 collapses if bank key == owner? Config bank could be any pubkey. If a vault owner is also the Bank, they can redeem alone. Is that allowed? The Bank is operator, not customer. If customer somehow is bank key, yes. Bank key should not be customer. Not code defect. But `mint_vault` owner can be bank? If bank mints vault to itself, can redeem. Business.

Potential issue: `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.config.bank)` but bank is Signer. If bank key compromised, can co-sign all. Rotation. Known.

Potential issue: SEAL config admin is INIT_AUTHORITY Squads. update_config admin can add reserve mints. If admin compromised, can add classic SPL mint with freeze authority or many mints to strand. But admin is multisig. Alarm.

Potential issue: BURN config admin can rotate bank/admin. If compromised, can set pending bank to its key, wait 7d, then co-sign burns. But bank co-signature with owner needed; if attacker also needs owner. Could target victims? If bank compromised, attacker can co-sign redemption for any owner who signs? They could phish owners. But 2-of-2 weakened. Rotation notice. Alarm.

Potential issue: MINT admin can pause, rotate pending. Timelocks. Good.

Potential issue: GOV admin can lower quorum to 500 and change threshold up. If compromised, can capture governance with fewer votes. But threshold ratchet up only; can't lower. Quorum lower to 5%. If attacker holds/rents 5% of vaults, can pass proposals. Vote renting atomically possible. This is a governance capture path. Severity MEDIUM/HIGH. Since proposals only set rounds, not funds. But can set price 0 and cap high, mint vaults? Lifetime max_supply bounds. If max_supply 2100, could mint free vaults if round price 0? set_round can price 0. Governance could set a free round with cap up to remaining supply. That gives attacker vaults? They need pay? price 0. But mint requires Bank co-signature and owner signature. Bank duty refuses charter-priced mint without proof-of-burn. If Bank compromised? Not. So limited. Still LOW/MEDIUM.

Potential issue: GOV quorum uses minted_total, not max_supply. If many burned, divisor high. Admin lower quorum. Known.

Potential issue: Proposal can set price_lamports arbitrary high/low, cap arbitrary u32. MINT lifetime cap bounds. If governance captured, can set round price 0 and cap large, but Bank co-signs each mint. Bank could refuse. Good.

Potential issue: `set_round` does not bound price_lamports max. Could set huge price, no mint. Governance. Fine.

Potential issue: `execute_proposal` can set round with opens_at in past and closes_at future, immediate. Fine.

Potential issue: `create_proposal` does not require voting_ends_at before round opens? A proposal could set round already open and voting ends later; if executed after voting, round may be partially over. execute checks closes_at > now. If opens_at < now, round starts retroactively? set_round just sets config; mint checks now >= opens_at. If opens_at past, round open immediately after execution. Fine.

Potential issue: GOV VoteRecord PDA init can be griefed by pre-funding? Anchor init uses create_account; if PDA already has lamports, init fails? Test 7.12d pre-funded proposal PDA and create succeeded? They measured ALLOW. For VoteRecord, a griefer could pre-fund vote PDA to prevent voting? Anchor init may fail if account already has lamports? Test for proposal pre-funded allowed, so Anchor can handle? Actually Anchor `init` with PDA can create if account has lamports? System create_account requires destination lamports 0? If pre-funded, `create_account` fails unless using `create_account_with_seed`? Anchor may transfer? Test 7.12d says create proposal at pre-funded PDA ALLOW. So maybe Anchor init can handle pre-funded PDAs by using `create_account`? Wait Solana system create_account requires account not exist or lamports 0? If account has lamports but no data, create_account can allocate if lamports already enough? System program `CreateAccount` instruction can only create account with lamports 0? Actually if account already has lamports, create_account fails `account already in use`? But test says allow. Maybe they pre-funded after? Let's read: `await send(SystemProgram.transfer to propId(idP7))`, then create proposal. rec 7.12d ALLOW. So Anchor init succeeded with pre-funded PDA. How? Anchor's `init` uses `create_account` with lamports from payer; if account already has lamports, maybe it uses `allocate` and `assign`? Anchor has handling for PDAs with lamports? It may use `create_account` with zero lamports? Not sure. If it works, no grief. For VoteRecord, likely works. Good.

Potential issue: VoteRecord could be pre-created by attacker with wrong data? Anchor init requires PDA empty? If pre-created with data, fails. If attacker can create VoteRecord PDA? It is PDA of GOV, only GOV can assign data. They can send lamports but not data. If Anchor init handles lamports, okay. If not, voting grief. Test proposal suggests okay. But not tested for vote. Could be LOW. Need not.

Potential issue: GOV `cast_vote` uses `init` vote_record with payer = payer, not owner. Anyone can pay. If vote record PDA pre-funded, maybe. Fine.

Potential issue: GOV `cast_vote` does not close vote record; votes persist. No issue.

Potential issue: GOV `execute_proposal` does not check `proposal.voting_ends_at` before `now >=` and execution window. Good.

Potential issue: MINT `split_revenue` can be called with any mint and decimals. If revenue ATA for a junk mint has balance, it splits to treasury/bank. Could an attacker use this to create fake split anchors for alarm? alarm detectSplitClaims filters seenSplits by mint account index 2 == CBBTC. Good. On-chain no issue. But if config.treasury/bank_treasury ATAs for junk mint don't exist, transfer fails. Attacker can create them and split junk. No loss. Could spam events. LOW.

Potential issue: `split_revenue` reads revenue ATA balance and transfers all. If there is a delegate on revenue ATA, the PDA owner signs transfer; delegate not issue. If close authority on revenue ATA, could close when zero after split? The revenue PDA is owner; close authority could be set by whoever created ATA? ATA program sets owner revenue PDA, no close authority. If attacker somehow gets close authority? Need PDA signature. no.

Potential issue: revenue PDA ATA could be created with a different token program? For cbBTC classic. Good.

Potential issue: `sweep_sol_for_swap` paused check. Pausing sale stops sweeps but not redemptions. If paused, revenue SOL cannot sweep; cbBTC split still works. Fine.

Potential issue: `sweep_sol_for_swap` uses `bal >= keep + amount`. If keep=0, can sweep entire balance, leaving revenue PDA 0 lamports. A 0-lamport PDA can be recreated. Fine. If keep between 0 and rent-exempt, init rejects. Good.

Potential issue: `sol_reserve_lamports` can be set to huge with governance, wedging sweeps until revenue enough. Alarm. LOW.

Potential issue: MINT `initialize` requires `sol_reserve_lamports ==0 || >= RENT_EXEMPT_0_BYTES`. But update_wiring sol_reserve needs governance and same check. Good.

Potential issue: MINT `update_wiring` `needs_governance` includes `sol_reserve_lamports.is_some()`, so admin alone cannot set to 0 even if lowering? If reserve too high, needs governance. Good.

Potential issue: MINT `update_wiring` `max_supply` ratchets down and >= minted_total. If admin lowers max_supply to minted_total, no more mints. Good.

Potential issue: MINT `update_wiring` `bank` rotation uses governance_timelock_secs, which can be 60s floor. Alarm. Known.

Potential issue: SEAL/BURN rotation constant 7d. Good.

Potential issue: BURN `update_config` uses BurnError::NothingPending for require_keys_neq default, wrong error but not security.

Potential issue: SEAL `update_config` uses VaultError::NotTheBank/NotTheAdmin for default. Fine.

Potential issue: BURN `initialize` no reserve mints; reads SEAL. Good.

Potential issue: BURN `burn_vault` does not check `ctx.accounts.instructions` is actually sysvar? Anchor address check. Good.

Potential issue: BURN `burn_vault` `declared` u8 but remaining_accounts length could be >255? Anchor remaining accounts max transaction accounts; no.

Potential issue: BURN `burn_vault` if `declared` is 0 and reserves require accounts, fails ReserveNotDeclared. Good.

Potential issue: BURN `burn_vault` if a reserve ATA is declared twice in remaining_accounts? `find` returns first. remaining_accounts.len == declared counts duplicates. Duplicates could inflate declared count but no harm. Could hide an undeclared account? If duplicates, len includes duplicate, but reserve loop finds required. Second loop iterates duplicates. No security. But declared count mismatch could be used? If duplicate reserve ATA and omit another required, ReserveNotDeclared. Fine.

Potential issue: open/burn pairing with duplicate accounts: burn instruction could have account index0 asset, index2 owner, but also duplicate owner at another index. Anchor uses first? It uses account list order; duplicates allowed? Anchor may error if same account passed twice with different constraints? It might allow. If BURN struct expects owner at index2, duplicate elsewhere not issue.

Potential issue: BURN reads asset owner from asset data. If asset is a collection? data[33] maybe update authority not collection; ForeignVault. Good.

Potential issue: SEAL `read_core_asset` and BURN read asset data without checking data borrow length after? They check >=66. Good.

Potential issue: Core asset account could be reallocated? No.

Potential issue: The collection account passed to open/burn is unchecked but required equals asset collection and config. Good.

Potential issue: In open, `require_keys_eq!(collection, ctx.accounts.config.collection, ForeignVault); require_keys_eq!(ctx.accounts.collection.key(), collection, WrongCollectionAccount);` Good.

Potential issue: In burn, reads reserves from SEAL config after checking preceding open. If SEAL config account not writable? It is read-only. Good.

Potential issue: BURN `burn_vault` requires `ctx.accounts.seal_config.owner == SEAL_PROGRAM_ID`. If SEAL program upgraded and changed config owner? Program owns its accounts. Good.

Potential issue: BURN reads SEAL config disc and version. If SEAL adds fields but version unchanged, raw offsets still valid for fields read. If SEAL reorders before reserves, version should bump. If not, misread. Operational.

Potential issue: MINT reads SEAL config disc/version. Good.

Potential issue: GOV reads MINT config disc/version. Good.

Potential issue: Alarm readConfigs uses account discriminators computed from struct names. It imports `acctDisc`. Good.

Potential issue: `WATCHED_KEYS` includes `seal.pending_bank` etc. readConfigs produces only if data length >= after+80. With padding, yes. If SEAL config initialized with fewer reserves, allocated space includes max reserves and padding, so data length full. Anchor init allocates full space. Good.

Potential issue: `CONFIG_PADDING` 256 but `Initialize` space includes padding. If account data length > Anchor struct, deserialization okay. Good.

Potential issue: If future field appended beyond padding, deserialization fails. They know. Padding helps. But no realloc. If append beyond 256, brick. LOW.

Potential issue: `MINT` config padding 256 but many fields; future appends okay. Good.

Potential issue: `scripts/build-mainnet.sh` proves source names Squads key and artifacts reject test key, but cannot prove compiled constant is Squads. It relies on reproducibility. If compiler miscompiles? Low. They state. Could mention final gap.

Potential issue: `run-tests.sh` uses `CBOB_CORE_SHA256_EXPECTED` hardcoded. If Core upgrades, must re-pin. Good.

Potential issue: `cron-install.sh` logrotate copytruncate may lose logs between copy and truncate? Standard. LOW.

Potential issue: deadman uses find -mmin +120; if state file updated but alarm findings not delivered? It writes state only if delivered? If report fails, state written with reverted baselines but mtime updated, deadman quiet though findings undelivered. However report returns delivered false and writeState still occurs, updating mtime. So deadman sees activity even if alerts failed. But alarm process exit code 2 maybe cron email? The deadman only checks state freshness, not delivery. If notification script fails, state still updated? Code: if !delivered, revert fields, then writeState(next). So mtime updates. Deadman won't fire. But report function prints ALERT DELIVERY FAILED and exit code 2; cron log maybe. No separate notification of delivery failure? It tries notify with findings; if notify fails, code=2 delivered=false. It doesn't send another alert because channel failed. Deadman not cover. Could be finding: alert delivery failure does not trigger deadman because state file refreshed. But if notify script failed, the only channel is broken; deadman should fire? It doesn't. Maybe LOW/MEDIUM. The report says watchdog cannot report own death; but delivery failure while state updates can hide. Could include under THE INVARIANT/off-chain. But many prior rounds? Not sure. Let's analyze: `report` if urgent and !DRY, execFileSync NOTIFY. If throws, code=2 delivered=false. main then if !delivered reverts baselines but still `if (!DRY) writeState(next)`. So state mtime now. Deadman sees fresh. Cron may capture exit code 2 but no email? Cron doesn't mail? The notify script failed, so no alert. Could be silent. Fix: on delivery failure, do not update state mtime? But need preserve baselines. Could write separate delivery-failure marker for deadman. MEDIUM.

Potential issue: alarm `main` if `report` returns false due to no urgent findings? It returns true if no urgent. If urgent and notify succeeds true. If notify fails false. Good.

Potential issue: alarm `--reconcile` report findings but if notify fails, process exit? report sets process.exitCode. It doesn't revert. Fine.

Potential issue: alarm `readConfigs` throws if missing watched keys; withLock catches and notifies "FAILED TO RUN". Good.

Potential issue: alarm `normalise` inner instructions: for inner, `ix.accounts` may be numbers? It maps numbers to keys. Good. For versioned tx with ALT, accountKeys includes loaded addresses? web3.js parsed transaction message accountKeys includes all? likely.

Potential issue: alarm `bs58decode` handles leading '1's. If data empty string, returns empty. Good.

Potential issue: detectors `detectUnledgeredSweeps` uses `d.length < 16` skip. If dataBytes undefined due to bs58 fail, skip. Could miss sweep. LOW.

Potential issue: detectors `detectSplitClaims` matching splitByOther anchor uses blockTime tolerance -60s. If blockTime null, cannot anchor. Good. If returnedAt missing, uses startedAt. Operator could backdate returnedAt? It uses Date.parse(c.returnedAt || c.startedAt). Operator controls returnedAt. Could set returnedAt far future to require later anchor? Not beneficial. Could set returnedAt far past to accept old split? The check `splitTime *1000 >= afterMs -60000`. If set returnedAt to epoch, any split after epoch anchors. But cycle also has startedAt; recent window. An operator could backdate returnedAt to allow an old unclaimed split to vouch. However round 12 changed horizon to ledger position but returnedAt still operator-controlled. For splitByOther anchoring, returnedAt is used as lower bound. If operator sets returnedAt before the actual return, an old split could anchor. But the old split must be unclaimed and in seenSplits. Could use a split from a previous cycle? If unclaimed. This is a weakness. But to fake a cycle, operator needs cbBTC returned? They could claim splitByOther with no return, set returnedAt old, anchor with any unclaimed split. However detectUnreconciledRevenue would see returnedSats? If splitByOther cycle with returnedSats 0, cycleIsOpen true (returned 0) -> unreconciled CRITICAL. They must set returnedSats >0. They can fake returnedSats. The chain-derived split anchor only checks existence of a split after returnedAt. If returnedAt forged old, an old split can vouch. But the split must be on chain and unclaimed. The operator could create a real split of cbBTC (from other funds) to anchor fake cycle. Since split_revenue permissionless, they could send cbBTC to revenue ATA and split, creating an unclaimed split. Then write fake cycle with splitByOther and returnedAt before split. This could close fake cycle without actual swap return. But the alarm also detectUnledgeredSweeps chain-derived sweeps: if no sweep, no cycle? They could write fake cycle with sweptLamports 0? cycleIsOpen false if moved 0. Not issue. To steal, operator key holds swept SOL; they could not return cbBTC, but fake split anchor? They need a real split on chain. They could use their own cbBTC to split, then claim cycle returned. The split amount not checked (blind to amount). So a compromised operator could sweep 50 SOL, keep it, buy/transfer 1 sat cbBTC to revenue ATA, split, and close cycle with splitByOther? detectUnreconciledRevenue short_swap_return checks returnedSats vs quotedSats tolerance. They control quotedSats and returnedSats; can set returnedSats = quotedSats. But revenue ATA split amount would be tiny; alarm doesn't parse amount. So fake. The split anchor temporal check can be satisfied by setting returnedAt just before the fake split. Thus splitByOther anchoring still not amount-bound. They acknowledge blind to amount. This is a real weakness: operator can close cycles with self-funded splits, no amount verification. Severity? The trusted hop already relies on operator honesty for return amount; alarm checks quote vs returned but returned is ledger word unless split amount parsed. The split event has amount; they don't parse. Could be HIGH. But carry-over chain-derived reconciliation not fixed. We can include in C3 or H. For revenue, detectUnreconciledRevenue short return uses ledger returnedSats, not chain. The split anchor only existence. So operator can lie about return amount if they can produce any split. However if they don't return cbBTC, revenue ATA balance won't increase. The split transaction moves whatever balance. They could fund revenue ATA with dust and split. The alarm doesn't check revenue ATA balance delta. So yes. Need recommend parse RevenueSplit event or read token balance deltas from chain. This is part of chain-derived reconciliation. Under MINT/revenue or THE INVARIANT. Severity HIGH/CRITICAL? Since operator key is trusted hop but alarm supposed to detect theft. If operator can sweep 50 SOL and close with dust split, theft hidden. CRITICAL. But the operator key is already trusted to perform swap; the alarm is detective. The design says one trusted hop bounded and reconciled. If reconciliation can be fooled by amount-blind split, it's a critical detective failure. Need include.

Let's detail construct:
1. Operator runs revenue.mjs or directly calls sweep_sol_for_swap (with signature) moving 50 SOL to operator.
2. Writes ledger cycle with sweptLamports, quotedSats, returnedSats equal quote, splitByOther true, returnedAt time T.
3. Sends dust cbBTC to revenue ATA from external funds, calls split_revenue (permissionless) at time >T. Alarm sees split on chain with CBBTC mint, unclaimed, anchors splitByOther. No amount check. detectUnreconciledRevenue sees returnedSats >0 and splitByOther, no short return because quoted=returned. Sweep is ledgered, amount matches chain. Theft hidden.
But detectUnledgeredSweeps checks sweep amount matches ledger; they can ledger real sweep. cycleIsOpen closed by splitByOther. So yes. The only missing is cbBTC return transfer from operator to revenue; alarm does not verify token transfer amount. It could parse revenue ATA balance changes. This is a critical reconciliation gap. The code comment admits blind to amount. They say it closes cheap lie, not amount. But the threat is operator stealing swept SOL; amount-blind split allows closing. So severity CRITICAL. However the operator would need external cbBTC to fund dust split; cheap. The quote could be huge; returnedSats fake. No check that returnedSats <= revenue ATA delta. Fix: parse RevenueSplit event `total` or monitor token transfers to revenue ATA; require chain-observed return amount matches ledger within tolerance.

This is a strong finding. Include under MINT or THE INVARIANT. Since revenue pipeline, maybe MINT heading (money). The prompt's headings don't include revenue, but MINT includes income. We'll put under MINT as CRITICAL: revenue reconciliation amount-blind.

But the carry-over list already says "CHAIN-DERIVED RECONCILIATION OF DISTRIBUTION OUTPUTS. The distributor key can move the whole pool while the alarm reconciles against a ledger the same user wrote." That's distribution, not revenue. The revenue split amount-blind is similar. Need report.

Also distribution: distributor key can move pool; alarm detectDistribution ledger-only. Construct: distributor key signs transferChecked from treasury ATA to attacker. No ledger row. detectDistribution only checks ledger rows for planned vaults; it doesn't scan treasury. detectBalanceDrops watches vault reserves, not treasury. detectUnledgeredSweeps watches MINT sweeps, not treasury transfers. So hidden. CRITICAL.

Now, any on-chain issue with distribution? The treasury is a wallet, not PDA. 85% sent to treasury ATA by split_revenue. Then distributor key sends daily. No on-chain enforcement of equal distribution. Known. Could be critical. Fix: move holders' share to a PDA and on-chain claim/distribution, or require multisig.

Need think about "SELL" mechanic: buyer's basis reserve. Could a seller drain reserve by direct Core BurnV1? That destroys vault, not sell. Could seller transfer vault to PDA and sell? Marketplace should check owner. Could seller nest vault inside another and sell outer? Buyer of outer gets inner? If inner undeclared, maybe. But buyer can scan. No on-chain. Maybe finding: marketplace cannot verify undeclared holdings; but known.

Potential issue: Royalties plugin basis_points max 1000 (10%). But `set_collection_royalties` can update to 0. If governance+admin set 0, no royalties. Alarm drift? WATCH doesn't include collection royalty value except collection.hash drift CRITICAL. Good.

Potential issue: `set_collection_royalties` uses `add` bool. If add=false but plugin not exists, Core error. If add=true but exists, error. No security.

Potential issue: Royalty destination revenue PDA derived from MINT program ID. If MINT program upgraded, revenue PDA same (program ID). Good.

Potential issue: `split_revenue` can split royalty income, but royalties may be paid in SOL? Core royalties likely SOL to creator address. The revenue PDA can receive SOL; sweep swaps. If marketplace pays royalty in SPL? Maybe SOL. Good.

Potential issue: Revenue PDA ATA for cbBTC used for split. Royalties in SOL need swap. Good.

Potential issue: If revenue PDA receives non-cbBTC tokens, split_revenue can split any token if ATAs exist. Destination treasury/bank_treasury ATAs for that mint. If not, fail. No issue.

Potential issue: MINT `initialize` sets `bank` but bank rotation pending uses governance_timelock. If initial bank wrong, alarm drift. Good.

Potential issue: `INIT_AUTHORITY` Squads key is also 15% bank_treasury? SPEC says Squads receives 15%. The same multisig is init authority and bank treasury. If Squads compromised, can initialize configs? After init, init authority no longer used. It receives 15%. Not code.

Potential issue: `scripts/build-mainnet.sh` uses local validator to ask artifacts; but deploys mainnet artifacts with upgrade authority keypair from cache, not Squads. It prints sha256. Deployment must set upgrade authority Squads. If not, alarm watches. Good.

Potential issue: `run-tests.sh` deactivates SIMD features. Mainnet may activate later; if so, Core behavior? Need monitor. LOW.

Now need decide final structure.

Report format:
```
## 1. MINT
### CRITICAL
... findings
### HIGH
...
### MEDIUM
...
### LOW
...
```
For each finding exact construct, attacker gains, fix. If no finding, one line.

Need include direct answers a-f under UNBREAK maybe before findings. The prompt asks specific questions author wants answered. We can put "Answers to a–f" then findings. Ensure not too verbose but detailed.

Need include final section "WHAT WOULD A 100% CLAIM HAVE TO SURVIVE" per mechanic. For each mechanic list unmet proofs.

Let's outline findings per heading:

1. MINT
CRITICAL:
M-C1: Revenue cycle signs under-verified Jupiter tx; operator SOL can be drained. (Though revenue not strictly mint, but money from mint). Construct: sweep 50 SOL to operator; malicious swap tx includes SystemProgram.transfer to attacker or TokenApprove; revenue.mjs signs because only one signer and no forbidden programs. Gain: stolen cycle SOL. Fix: allowlist, simulate balance deltas, ephemeral wallet, verify instructions.
M-C2: Revenue reconciliation amount-blind; operator can fake return/split with dust. Construct: sweep ledgered, no cbBTC return, fund revenue ATA dust, permissionless split_revenue, ledger returnedSats=quotedSats, splitByOther or splitSig. Alarm sees split, no amount. Gain: hide theft of swept SOL. Fix: parse RevenueSplit event total/holders/bank or chain token balance deltas; require returnedSats match.
HIGH:
M-H1: Long-lived swap operator key (carry-over). Gain: compromised key repeatedly sweeps within cap/cooldown; cannot enforce fresh wallet. Fix: per-cycle ephemeral operator, on-chain temporary destination? Since destination pinned config, rotation timelock; maybe use PDA sub-accounts? At minimum fresh wallet and immediate return.
M-H2: Mint does not cross-check BURN config; if BURN collection/bank diverged, mint can sell unredeemable vaults. Construct: initialize BURN with wrong collection/bank; MINT/SEAL agree; mint_vault succeeds; burn fails. Gain: customers buy stranded vaults. Fix: mint read BURN config too or initialize via one tx; alarm standing compare burn.bank/collection to seal before mint.
MEDIUM:
M-M1: Dangling Attributes authority and stale redemption attribute. Fix remove authority or update comments.
M-M2: `update_wiring` with governance can wedge sweep cap/cooldown; alarm only. Maybe accepted. Fix document or on-chain minimum for governance? If governance is PDA unreachable, not issue. LOW.
LOW:
M-L1: revenue.mjs sweep instruction isSigner false fragile. Fix mark true.
M-L2: `split_revenue` can be spammed with junk tokens; alarm filters CBBTC but events noise. Fix optional.

But MINT heading also includes mint_vault price/cap/provenance. Need mention checked and no on-chain mint findings? We can say no finding on price/cap/round window after checking. But we have findings revenue. Good.

2. UNBREAK
Direct answers a-f.
CRITICAL? Maybe pre-sign scan not implemented could be under UNBREAK or NESTING. Since burn destroys undeclared, put under NESTING? The prompt asks under NESTING AND AIRDROPS. We'll put C1 there. Under UNBREAK maybe HIGH capacity, MEDIUM T22 dead weight, rent not closed, lock? Lock off-chain maybe THE INVARIANT.
UNBREAK findings:
HIGH:
U-H1: Legacy transaction capacity max ~3 reserves; additive list can strand. Fix ALT/versioned, remove T22 dead weight, measure.
U-H2: T22 derivation dead weight; remove.
MEDIUM:
U-M1: burn does not enforce closure of zero-balance ATAs; rent stranded. Fix require lamports zero/absent.
U-M2: burn requires preceding open; legacy thawed vaults or config divergence can strand. Fix migration test/idempotent open, standing wiring compare.
LOW:
U-L1: Hardcoded discriminator/index coupling fails closed only for accidental drift, not malicious BURN upgrade/Core upgrade. Fix upgrade multisig, alarm, versioned interface contract.
U-L2: BURN `declared` u8 and duplicate accounts? Not issue.

3. ROYALTY
MEDIUM:
R-M1: Royalty governance unreachable after GOV PDA; rotation required. Fix set before rotation, or add GOV-executable royalty instruction? But GOV only set_round. Could expand? Maybe not.
LOW:
R-L1: Marketplace enforcement not on-chain; royalty can be evaded by noncompliant markets. Fix business.
R-L2: 0 bps allowed. Fix if policy.
No critical.

4. VOTING
HIGH? Maybe quorum burned deadlock. MEDIUM:
V-M1: quorum divisor includes burned vaults; redemptions can make quorum unreachable; only admin lower quorum, admin key loss => deadlock. Fix consider live supply or burn-adjusted divisor, but they chose. Maybe MEDIUM.
V-M2: Vote renting atomic; known limit. MEDIUM/LOW.
LOW:
V-L1: No proposal cancel; executed window. LOW.
V-L2: Proposal creation/vote PDA pre-funding? Tests show okay. Maybe no.
Check one vault one vote, quorum, thresholds, execution: mostly okay. Need say no double-vote finding.

5. TRANSFER
No on-chain finding? Known bricking transfers. But measured fact do not re-file. We can say no new finding; checked Core transfer, freeze plugin, owner signatures. But include 100% gap: cannot prevent transfer to PDA. Maybe LOW? Since measured fact, not bug. One line no finding.

6. SELL
MEDIUM/LOW:
S-M1: Buyer cannot on-chain verify complete vault contents; undeclared airdrops/nested may be destroyed or hidden. But known. Maybe no new finding? The sell mechanic basis reserve; reserve canonical can be verified. Undeclared not basis. Could say no finding beyond known enumeration gap; checked royalty, transfer, balance reads. But off-chain marketplace should show reconcile. LOW: no escrow/royalty enforcement.

7. NESTING AND AIRDROPS
CRITICAL:
N-C1: Pre-signature scan not implemented; alarm reconcile post-hoc and missing nested Core assets. Construct: attacker airdrops token or sends inner vault to PDA; owner requests redemption; Bank signs without fresh scan; burn destroys/orphans. Gain: destruction of customer Bitcoin; if inner vault belongs to another customer, loss. Fix: mandatory pre-sign service with getTokenAccountsByOwner + DAS getAssetsByOwner, refuse unless declared; add nested scan to reconcile.
HIGH:
N-H1: alarm reconcile lacks nested Core asset scan. Could merge with C1 but separate: even daily detective doesn't see nested vaults. Fix.
MEDIUM:
N-M1: Declared nested vault can be recovered via Execute transfer, but tooling/tests don't demonstrate; redemption builder must support sweeping nested Core assets. If not, declared nested causes refusal and user may not know how to extract. Fix implement/test nested sweep.
LOW:
N-L1: Airdropped SOL grief but sweep same tx. Known.

8. THE INVARIANT
CRITICAL:
I-C1: Distribution treasury key can drain holder pool; alarm ledger-only. Construct: compromised distributor signs token transfer to attacker; no ledger row; detectors quiet. Gain: 85% pool. Fix chain-derived treasury reconciliation, multisig/PDA distribution.
HIGH:
I-H1: lock.mjs residual TOCTOU; double-run possible after stale lock. Fix flock/OS lease.
I-H2: Alarm does not watch Core program bytes/upgrade authority. Fix add Core to program hash watch.
MEDIUM:
I-M1: Alert delivery failure updates state mtime, deadman may not fire. Fix separate delivery-failure marker or don't update state on failed notify.
I-M2: detectBurns/detectVaultSetChange severity noise on legitimate redemptions. Fix classify paired open+burn, downgrade.
LOW:
I-L1: Direct bare Core BurnV1 destroys contents; known impossibility. Not re-filed but invariant not 100%. Maybe final.

Need avoid too many findings? The user wants thorough. We can include. But ensure severity order per heading.

Need also include "If a mechanic has no finding, say so in one line and say what you checked." For TRANSFER and SELL maybe no finding? But we have low. Could say no finding beyond known limits. For ROYALTY we have findings. For VOTING findings.

Need final section per mechanic: what 100% claim must survive that codebase doesn't prove. List:
MINT: production governance must be GOV PDA, bank duties, no mint during proposals, proof-of-burn charter, upgrade authorities multisig, BURN wiring.
UNBREAK: ALT/versioned redemption tested, reserve capacity, pre-sign scan, legacy thaw migration, Core/BURN upgrade drift.
ROYALTY: marketplace enforcement, royalty adjustability after gov PDA.
VOTING: quorum with burned supply, vote renting, snapshotless standing, admin quorum power.
TRANSFER: bricking transfers, freeze plugin semantics, Core upgrade.
SELL: buyer completeness verification, royalty enforcement, no escrow.
NESTING: enumeration gap, pre-sign scan, nested recovery tooling.
INVARIANT: bare Core burn, off-chain pipeline trust (distributor/operator), lock, alarm Core watch, alert delivery.

Need phrase as faults, no praise. Do not confirm work. But we can say "I checked X and found no defect" where required.

Let's verify some claims with code evidence.

Pre-sign scan not implemented: alarm.mjs has `reconcile()` but no transaction signing. It uses `getTokenAccountsByOwner` in reconcile. It does not have DAS getAssetsByOwner. It only `listVaults` by collection. No function to scan before co-sign. The Bank co-signature is just a key in tests; no co-signer service. So true.

Nested Core asset scan missing: reconcile loops token accounts only. `listVaults` could identify assets whose owner is a vault PDA if DAS returns owner, but it doesn't inspect. So true.

Distribution chain reconciliation missing: detectors.mjs detectDistribution only ledger. alarm.mjs scans MINT/SEAL/BURN/GOV signatures, not treasury wallet. It does not call getSignaturesForAddress on treasury or treasury ATA. So true.

Revenue split amount-blind: detectSplitClaims comment says blind to amount. It filters CBBTC mint but not total. So true.

Swap tx inspection insufficient: revenue.mjs FORBIDDEN only two program IDs. It doesn't allowlist. True.

Lock TOCTOU: code comment admits. True.

Core program not watched: readConfigs loops four programs, not CORE. True.

Alert delivery failure updates state: main writes state after report regardless; if delivered false, reverts baselines but writes. mtime updates. Deadman watches state mtime. True. However if notify fails, report returns false, main writes state. So deadman quiet. Could be finding.

detectBurns severity: detectors.mjs `burn_via_program` HIGH. detectVaultSetChange `vault_burned` CRITICAL. Under v5 every redemption triggers both. True.

T22 derivation unreachable: assert_classic_spl ensures reserve mint owner SPL. ATA for T22 with classic mint cannot be initialized by Token-2022. Need be careful: The ATA program address derivation is independent; someone could send lamports to the T22 ATA address, making system account. Burn requires declared, skips if owner not token. It cannot be a Token-2022 token account for classic mint because Token-2022 initialize account checks mint owner? I believe true. State "not reachable as a live token account; only a zero-data/system placeholder can exist, which burn skips." Good.

Delegate closed account argument: true.

MINT attributes authority unreachable: current SEAL no attribute instruction. But could SEAL PDA sign Core UpdatePluginV1 for attributes if invoked by `core_plugin_cpi`? That function data can be any, but only caller set_frozen with plugin 17. No other. So unreachable.

Potential on-chain issue: MINT's `mint_vault` sets Attributes plugin authority to SEAL PDA. If SEAL PDA is also PermanentFreezeExecute authority. Could Core UpdatePluginV1 for PermanentFreezeExecute also update Attributes if data plugin id changed? No.

Potential issue: `open_for_redemption` uses `payer` signer for Core plugin update. If payer not willing, fail. In redemption, payer can be owner or bank. Good.

Potential issue: `burn_vault` Core BurnV1 uses payer signer and owner signer. If payer != owner, okay. It passes owner readonly signer. Good.

Potential issue: `burn_vault` does not require `vault_asset` writable? It is `#[account(mut)]`. Good.

Potential issue: `open_for_redemption` collection mutable; Core plugin update may need collection writable. Good.

Potential issue: `burn_vault` after Core BurnV1, asset account may still have lamports? Core closes asset and returns rent to payer? Test 4.4 gone. asset_signer PDA lamports zero required before. Good.

Potential issue: If asset_signer PDA has data or is assigned to a program, lamports zero check passes? If data non-empty but lamports zero, account may be rent-exempt? Zero lamports account is deallocated? Runtime accounts with zero lamports are purged. If data exists but zero lamports impossible? Maybe. no.

Potential issue: The burn emptiness proof checks PDA lamports zero before Core burn. If PDA owns token accounts, their lamports are separate. Good.

Potential issue: If PDA holds SOL in a system account and sweep doesn't transfer all, burn refuses. Good.

Potential issue: If PDA holds stake account or other program data with lamports, burn only checks PDA lamports zero. It cannot enumerate program-owned accounts by PDA? The PDA itself is one account; if it has lamports, check. If PDA is assigned to another program with data and lamports? The PDA is asset_signer account; if assigned/staked, lamports >0, refuses. Could owner sweep? Depends. If assigned to stake program, cannot system transfer. Could strand. But how would PDA become stake account? Requires PDA signature, only Execute. Owner could do it via Execute while thawed, but then burn refuses until undone. If impossible to undo, self-inflicted. A stranger cannot assign PDA without signature. So no.

Potential issue: PDA could be owner of a token account that is also the asset_signer? No.

Potential issue: The reserve loop derives ATA with `Pubkey::find_program_address(&[pda.as_ref(), token_program.as_ref(), mint.as_ref()], &ATA_PROGRAM_ID)`. ATA program derivation order is wallet, token_program, mint. Correct.

Potential issue: The second loop checks any remaining account owned by token program and owner PDA. If a non-ATA token account is declared, it checks. Good.

Potential issue: If a token account owned by PDA has close authority set to PDA? Close authority option nonzero, refuse. If close authority is none, okay.

Potential issue: If a token account has delegate option nonzero but delegated amount zero, refuse. Good.

Potential issue: If a reserve ATA is closed and recreated in same transaction after sweep? If recreated, it is fresh zero balance? The burn would see token account with zero balance and rent, allow (if not requiring closure). If recreated with delegate/close authority? Burn refuses. If recreated by ATA program, no delegate. But PDA unreachable later. Safe. Could recreate with malicious extension? For classic, no.

Potential issue: If sweep closes ATA, then later in same tx before burn someone recreates it with a delegate? The PDA cannot sign approve, but ATA create doesn't set delegate. Could initializeAccount3 with close authority? Requires PDA signer? Token initialize account requires account owner? For non-ATA, maybe account signer, not PDA. ATA program creates with owner PDA, no close authority. So no.

Potential issue: If a delegate was approved before thaw, and sweep transfers balance out via delegate (not owner), delegate remains, ATA left open. Burn refuses. Good. If delegate transfers and closes? Delegate cannot close unless close authority. Good.

Potential issue: If a delegate drains during thaw before burn, bank signed? The owner can approve delegate only via Execute while thawed. Bank sees. If delegate on pre-existing account before thaw? PDA cannot sign approve unless thawed. So no.

Potential issue: The Bank co-signature on open and burn is same bank key. If bank signs a transaction with open+burn+sweep to attacker, owner is attacker? If customer owner signs malicious sweep to attacker, they lose own funds. Bank duty to ensure sweep to customer? Not on-chain. True 2-of-2 doesn't protect owner from themselves. But if Bank is supposed to protect customers from owner mistakes? The spec says Bank must simulate and refuse any tx that creates PDA-owned token account or delegate. It doesn't say refuse sweep to non-owner. If owner can sweep to any address, that's redemption. Fine.

Potential issue: Marketplace buyer may assume reserve belongs to vault, but owner can redeem to any address? Redemption burns vault; buyer would not. While sealed, cannot move reserve. Good.

Potential issue: If vault is sold while redemption transaction in flight? Atomic; owner signs. no.

Potential issue: If vault owner signs a malicious transaction that opens and burns but sweep sends BTC to seller's other wallet, then sells empty? Burn happens, vault gone, no sale. no.

Potential issue: If open_for_redemption emits event before burn; if transaction fails, event not stored. no.

Potential issue: Alarm `detectBalanceDrops` will fire HIGH on every legitimate redemption (reserve fell to zero and vault burned). It says expected if redeemed. Noise. Similar to burn severity. Could include in H8.

Potential issue: Alarm `detectDeactivations` fires HIGH on redeemed vault if balance below activation before burn? If vault burned, detectVaultSetChange CRITICAL. Noise.

Potential issue: The daily distribution pays activated vaults. If a vault redeems (burns) after snapshot, distribute skips if burned before transfer. If distribution paid before redemption, customer got daily payout. Fine.

Potential issue: If a vault's cbBTC ATA is missing, distribute treats balance 0 and missing. If later activated, paid next day. Fine.

Potential issue: If a vault holds cbBTC in non-ATA account, distribute sees 0 and doesn't pay; alarm reconcile flags non-ATA. Fine.

Potential issue: If a vault holds cbBTC in ATA but frozen by cbBTC freeze authority, readTokenAccount reads amount, distribute pays? Transfer to frozen ATA fails? Destination frozen, transfer rejected. Row rejected, alarm. The vault may be activated but frozen; no pay. External.

Potential issue: cbBTC freeze authority could freeze revenue ATA, blocking split. Revenue cycle fails. External trusted token.

Potential issue: SPL token program upgrade? Not watched. Token program is immutable? Probably. Could watch.

Potential issue: System program? no.

Now need write final answer with enough detail but not insane. We have token budget 16k. Need be comprehensive. We can condense findings but include constructs.

Let's decide final severity list per heading, maybe not too many. Need ensure exact construct for each. For off-chain findings, construct as steps.

Detailed findings:

1. MINT
CRITICAL-M1: Unsigned/uninspected Jupiter swap transaction.
Construct:
- `revenue.mjs --live` after `sweep_sol_for_swap` sends up to 50 SOL to operator.
- It fetches `swapTransaction` from Jupiter HTTP API, deserializes VersionedTransaction.
- Checks only: exactly one required signer = operator; message does not contain BPFLoaderUpgradeable or MINT program; <=4 ALT lookups.
- It then `vtx.sign([operator])` and sends.
A malicious/compromised API response can include instructions: `SystemProgram.transfer(operator, attacker, sweptAmount)`, `TokenApprove(operator cbBTC ATA, attacker)`, or transfers of any SOL/cbBTC held by operator. None of these programs are forbidden. Gain: steal the cycle's swept SOL and any cbBTC in operator ATA; hide because swap confirmation may still be manipulated? If it just drains SOL and no cbBTC delta, revenue.mjs throws after SOL gone. Fix: positive allowlist, simulate pre/post balances for SOL and cbBTC, reject any delegate/close authority/transfer to unknown, use ephemeral operator wallet with exact funds, pin Jupiter program or use verified SDK.

CRITICAL-M2: Amount-blind revenue reconciliation.
Construct:
- Operator sweeps 50 SOL and writes ledger row with `sweptLamports`, `quotedSats`, `returnedSats=quotedSats`, `splitByOther:true`, `returnedAt` set.
- Operator does not return cbBTC. Instead sends dust cbBTC to revenue ATA from another wallet and calls permissionless `split_revenue` (or lets revenue.mjs split? If splitByOther, another caller). Alarm's `seenSplits` records a CBBTC split signature. `detectSplitClaims` anchors the cycle because an unclaimed split exists after `returnedAt`; it never reads `RevenueSplit.total` or token balance deltas. `detectUnreconciledRevenue` trusts `returnedSats`. Gain: theft of swept SOL hidden from alarm. Fix: parse Anchor event `RevenueSplit` (total, holders, bank) from transaction logs or read chain token balance changes; require ledger `returnedSats` match chain-observed split total within tolerance; do not allow `splitByOther` to close on existence alone.

HIGH-M3: Long-lived swap operator key (carry-over). Construct: key file persists; if compromised, attacker can sign sweeps whenever cap/cooldown allows and sign arbitrary swap tx. Fix: fresh per-cycle wallet, rotate destination on-chain? Since destination pinned, could use ephemeral child key and update config with timelock? Not feasible. At least hardware/isolated signer, immediate forwarding. But carry-over asks fresh wallet; not implemented.

HIGH-M4: Mint does not verify BURN config wiring. Construct: init BURN with wrong collection or bank; MINT/SEAL correct; `mint_vault` succeeds; later `burn_vault` fails `ForeignVault`/`WiringDiverged`. Gain: customers mint vaults that can never redeem; funds locked. Fix: `mint_vault` should also read BURN config PDA and require collection/bank match, or deployment script initializes all atomically and alarm standing check compares before minting.

MEDIUM-M5: Dangling Attributes authority/stale redemption attribute. Construct: minted asset has Attributes plugin authority SEAL PDA; SEAL has no attribute instruction. Not reachable now. But future SEAL upgrade or accidental instruction could rewrite provenance. `ATTR_REDEMPTION` refusal is dead. Fix: set attribute authority to none/immutable if Core supports, or remove plugin authority; delete stale checks/comments.

LOW-M6: revenue.mjs sweep `isSigner:false` fragile. It works only because operator is fee payer. Fix mark true.

Maybe also LOW-M7: `split_revenue` accepts arbitrary token decimals from caller; if wrong, transferChecked fails. no.

2. UNBREAK
Start with answers a-f.
Then findings:
HIGH-U1: Transaction capacity/ALT. Construct: reserve list N. Legacy tx with open, Execute sweeps for each mint, burn. At 1 mint 802 bytes. Each additional mint adds source/T22/dest/mint accounts and inner transfer+close. Bare maximum ~3; with priority fee/memo likely 2; 8 impossible. If reserve list grows, open refuses because burn cannot fit; vault stranded. Fix: versioned tx + ALT, remove T22 dead weight, batch sweeps? Could use one Execute with multiple inner; already. Maybe allow multi-tx? But rule one tx. Implement ALT and test introspection.

HIGH-U2: T22 ATA dead weight. Construct: for each classic reserve, burn requires declaring T22-derived address. It can only be system/uninitialized; no value. Costs 32 bytes/account and index. Fix: require only classic ATA for classic mints; store token program if future T22 allowed.

MEDIUM-U3: Burn does not force closure of zero-balance token accounts. Construct: open; sweep transfer amount but omit close; burn sees amount 0, no delegate, passes; ATA remains with rent owned by burned PDA. Gain: user loses rent permanently; if many reserves, SOL stranded. Fix: require declared PDA-owned token accounts have `lamports()==0` or are absent/system-owned after sweeps; i.e., force close.

MEDIUM-U4: Pairing creates new liveness dependencies. Construct: legacy already-unfrozen vault (if any) or SEAL/BURN bank divergence; open fails or burn fails, cannot destroy via program. Fix: test idempotent open on unfrozen asset; standing alarm compare SEAL/BURN bank/collection; migration path.

LOW-U5: Hardcoded discriminator/index coupling only fail-closed for accidental drift. A BURN upgrade keeping name/disc and indices but changing semantics could satisfy open; Core upgrade can break raw asset reads. Fix: interface version constants, on-chain registry? At minimum treat BURN/Core upgrades as critical ops, alarm.

3. ROYALTY
MEDIUM-R1: Royalty instruction unreachable after governance PDA. Construct: once `mint.governance` = GOV PDA, `set_collection_royalties` requires governance signer; PDA cannot sign update_wiring/royalty. To change royalty, rotate governance to a key (timelock), change, rotate back. If royalty needs urgent fix (wrong bps/destination), delayed. Fix: add a GOV-executable instruction to set royalties, or perform initial royalty before rotation and accept immutability; document.
LOW-R2: Royalty enforcement depends on marketplaces; RuleSet None; no on-chain escrow. Fix: accept/marketplace integration.
LOW-R3: 0 bps allowed. Fix min if policy.

4. VOTING
MEDIUM-V1: Quorum divisor includes burned vaults; redemptions can make quorum unreachable. Admin can lower quorum to 500, but if admin lost or timelock delayed, governance halts. Fix: consider divisor max(snapshot, live supply minus burned?) but on-chain burned count? DAS not trustless. Or lower floor? Already. Document.
MEDIUM-V2: Vote renting/flash transfer. Construct: transfer vault to broker, vote, transfer back in one tx. Binding to asset stops double vote but not lending. Fix snapshot (rejected by design). State.
LOW-V3: No proposal cancellation; a passed stale proposal can be executed by anyone within 7 days if not superseded. Mitigated by execution window/forward. Fix add cancel by admin/governance if desired.
No finding on double-vote: checked VoteRecord PDA, owner signature, live asset read.

5. TRANSFER
No finding (one line): checked Core transfer path, PermanentFreezeExecute only gates Execute, owner signature, known bricking transfers not re-filed.
But maybe include LOW? The prompt says if no finding one line. We'll say no new finding; known impossibilities remain.

6. SELL
LOW-S1: Buyer's basis cannot be proven on-chain for undeclared holdings; marketplace must query canonical ATAs and reconcile. Royalties not enforced on-chain. Fix: expose signed vault state attestation from Bank, or read-only API.
Maybe no critical.

7. NESTING AND AIRDROPS
CRITICAL-N1: No pre-signature completeness scan implemented. Construct: attacker airdrops non-reserve tokens or nests inner vault into outer PDA. Owner requests redemption; Bank key signs open/burn because no automated pre-sign check. `burn_vault` only inspects declared accounts; undeclared holdings destroyed/orphaned. Gain: permanent loss of customer Bitcoin. Fix: implement co-signing service that before signing runs `getTokenAccountsByOwner` (Token & Token-2022) and DAS `getAssetsByOwner` for asset_signer PDA, compares to transaction declared accounts, refuses on any undeclared; log attestation. `alarm.mjs --reconcile` is not this: daily, post-hoc, and token-only.
HIGH-N2: Reconcile misses nested Core assets. Construct: inner vault transferred to outer PDA; `reconcile` only token accounts, so no finding until burn. Fix add DAS owner scan.
MEDIUM-N3: Declared nested vault recovery path not in redemption builder/tests. Construct: burn refuses declared nested asset; owner must use Execute TransferV1 to move inner out before burn. No test/tooling shown. If unsupported, declared nesting strands outer redemption. Fix add sweep-nested-asset instruction path and tests.
LOW-N4: Airdropped SOL grief; known same-tx sweep.

8. THE INVARIANT
CRITICAL-I1: Distribution treasury key chain reconciliation absent. Construct: compromised distributor key signs `TransferChecked` from holders' ATA to attacker; `detectDistribution` only reads `distributions.json`; no scan of treasury signatures/balance deltas. Gain: entire 85% holder pool. Fix: move treasury to PDA with on-chain distribution, or alarm must scan treasury wallet/ATA signatures and reconcile every outgoing transfer to ledger rows; require multisig for treasury key.
HIGH-I2: lock.mjs residual TOCTOU. Construct: two runners meet stale dead lock; both read same token before unlink; one unlinks and claims, other unlinks winner's lock and claims; both run distribute/revenue, double-pay or double-sweep. Fix: use `flock`/`fcntl` advisory lock on an open fd (or OS lease), not stale-file breaking; if file locks must be portable, use atomic `rename` with post-claim verification? But flock right answer for local Linux. Current not 100%.
HIGH-I3: Alarm does not watch Core program. Construct: Core upgrade changes BurnV1/Execute/plugin semantics; alarm watches four programs only. Fix add Core program hash/upgrade authority to watch, pin expected Core hash in production.
MEDIUM-I4: Alert delivery failure updates state mtime, deadman may not fire. Construct: notify script down; report returns false; main writes reverted state, updating mtime; deadman sees fresh state, no alert. Fix separate delivery-failure marker or do not touch state file when notify fails; deadman watch delivery marker.
MEDIUM-I5: Alarm severity noise for legitimate redemptions. Construct: every v5 redemption triggers `burn_via_program` HIGH and `vault_burned` CRITICAL plus balance drop HIGH. Operators learn to scroll. Fix parse paired open and expected redemption; downgrade program burn with paired open to INFO/WARN after reconcile; keep bare Core burn CRITICAL.
LOW-I6: Direct bare Core BurnV1 can destroy contents (known impossibility). Not re-filed as bug but invariant not 100%.

Need maybe include lock under THE INVARIANT? It's off-chain but affects double-pay. Good.

Now final section "WHAT WOULD A 100% CLAIM HAVE TO SURVIVE" per mechanic. We'll list concise.

MINT 100% would have to survive:
- No unauthorized mint: collection update authority PDA, round/cap/lifetime, bank+owner signatures. It does, but must also survive BURN wiring divergence, upgrade authority compromise, Bank co-sign duties (no mint during proposal, charter proof), production governance PDA, revenue swap/reconciliation. Current not prove revenue path.

UNBREAK:
- Atomic pairing, no thaw without burn, no burn without open, same asset/owner, emptiness, all-or-nothing. It survives current constructions but not: transaction size/ALT, reserve list growth, undeclared holdings, Core/BURN upgrades, legacy thawed vaults, rent closure, pre-sign scan.

ROYALTY:
- Correct rate/destination, enforcement. It survives plugin write but not marketplace evasion, governance unreachable, rate changes.

VOTING:
- One vault one vote, quorum/threshold, execution. Survives double-vote but not vote renting, burned supply quorum, admin quorum changes, no cancel.

TRANSFER:
- Transfer cannot move contents. Survives because Execute gated; but transfer to PDA/nesting bricks, direct burn. Not 100%.

SELL:
- Buyer can know reserve. Survives canonical reserve balances while sealed; not undeclared/nested, freeze authority, marketplace royalty.

NESTING/AIRDROPS:
- Survives declared cases (refuse/sweep); not undeclared enumeration, no pre-sign, no nested reconcile.

INVARIANT:
- Everything stays until burn and vault gone. Survives program redemption if Bank honest and scan; not bare Core burn, off-chain key compromise, distribution/operator theft, alarm gaps.

Need ensure final answer not too praising. Use phrases "I do not accept", "fault", "must fix".

Let's also include direct true/false for known consequences maybe under relevant headings. The prompt says known consequences do not re-report, do check whether each statement is true. We can include a section "Verification of stated known consequences" maybe after answers or final. But report format says under headings. We can incorporate in findings/answers. Maybe under UNBREAK answers and NESTING. Need explicitly answer each question. We can add a short "Known-consequence checks" within UNBREAK or final. But to satisfy, maybe after direct answers a-f, include "Known consequence checks" bullet list before headings? The user requested structure under headings. We can put under UNBREAK (for delegate/T22), NESTING (for nested), MINT (charter/attributes), THE INVARIANT (detectBurns). Let's ensure each question answered:
- Nested/airdrop destroyed: under N-C1 answer true/no on-chain/pre-sign not implemented.
- Charter provenance: under MINT maybe M-M5 or final. Answer: true; mint tx + DAS sufficient only forensically; surfaces may report incorrectly.
- Dangling attributes: under MINT M-M5. Answer: unreachable now, leaving is safe but stale.
- Delegate closed ATA: under UNBREAK maybe answer true. Could include in U-M3? The delegate check unreachable when closed; argument true. We can state in answers or low note.
- T22 derivation: under U-H2 answer no unreachable.
- detectBurns severity: under I-M5 answer no.

Need answer a-f in UNBREAK. Good.

Let's refine some technical details to avoid false claims:

For swap tx inspection: The code checks `msg.addressTableLookups?.length > 4` throws. It doesn't check inner instructions? Versioned message with ALT can contain many instructions. It checks staticAccountKeys for forbidden. If a forbidden program is loaded via ALT, it might not be in staticAccountKeys. It only checks `keys = msg.staticAccountKeys.map(...)`. A malicious transaction could put BPFLoaderUpgradeable or MINT_PROG in an address table lookup, not static keys, and bypass FORBIDDEN check. Even worse! It only checks static keys. Jupiter may use ALT for route programs. A malicious API could include MINT program via ALT and call sweep? But operator signature? It could call `sweep_sol_for_swap` again? The operator is signer, but sweep destination is config operator, so could sweep more SOL from revenue if revenue has funds. It could include MINT program via ALT to call split? Not direct theft but bypass. It could include BPFLoader to upgrade? Needs upgrade authority signer, operator not. But MINT via ALT could call `sweep_sol_for_swap` with operator signer, moving additional revenue SOL to operator (if cooldown/cap). This is a real bypass of the negative allowlist. Also Token program could be ALT? Token program likely static? But could be ALT. The check insufficient. Need mention: forbidden list only static keys; ALT-loaded forbidden programs bypass. Fix check resolved account keys including ALT lookups (but table contents need fetch) or disallow ALT beyond expected? It allows up to 4 lookups but doesn't validate. CRITICAL. Good catch.

Also signers check uses `staticAccountKeys.slice(0, numRequiredSignatures)`. In v0, required signers are always static? Yes. Good.

Could malicious swap tx include an instruction to MINT program loaded via ALT and call `sweep_sol_for_swap`? The operator is signer and config.swap_operator. It would sweep revenue PDA additional amount to operator. If revenue has SOL, attacker gains more than cycle. But cooldown/cap. Could include multiple sweeps? Cooldown same timestamp prevents multiple in one tx. But one extra up to cap. If operator already swept cycle, revenue may have reserve only. But if revenue has more, yes. Could include `split_revenue`? Not theft. Could include `update_wiring`? Needs admin signer, operator not. Could include `set_paused`? admin no. So MINT via ALT mostly sweep. Forbidden list intended to prevent MINT, but bypass via ALT. Include in M-C1.

Could malicious tx include Token program via ALT and approve delegate? Token program likely static if SPL transfer; but could be ALT. The check doesn't parse instructions. So yes.

Revenue.mjs also doesn't fetch ALT contents, so cannot know resolved keys. This strengthens.

For amount-blind split, `detectSplitClaims` seenSplits only records split if `ix.accounts?.[2] === CBBTC`. If split instruction uses ALT for mint account, `ix.accounts` from normalise may resolve? For jsonParsed, inner/top accounts are pubkeys? It maps numbers to keys from `tx.transaction.message.accountKeys`, which for versioned includes loaded? Probably. If not, could miss. But alarm scans MINT program; split likely top-level with static accounts. Not crucial.

For lock TOCTOU, is `flock` available in Node? Built-in no synchronous flock. Could use `fs.open` + `flock` via native or `proper-lockfile`? The right answer is OS lease/flock. Need state current not correct.

For distribution reconciliation, the alarm does scan MINT program signatures, and split_revenue moves from revenue ATA to treasury ATA. It could detect incoming to treasury, but not outgoing from treasury. It doesn't scan treasury. Good.

For Core program watch, if Core is immutable, reading ProgramData upgrade authority may show no authority. Still hash watch. Add.

For alert delivery failure, if notify script fails, `report` sets exit code 2. Cron may not email because output redirected to log. Deadman not. Could be MEDIUM.

Now, need maybe mention missing `bank/anchor.mjs`? The code imports it but not provided. If we cannot verify pinnedAccountData, maybe finding: critical money paths rely on an unprovided/unaudited module. But maybe omitted from prompt. Should we include? It says THE CODE includes off-chain files but not anchor.mjs. selftest tests it. If not in report, maybe ignore. But as auditor, if dependency missing, we can say cannot verify; but find faults? Could be LOW: `bank/anchor.mjs` not supplied, so pinning claims in revenue/distribute cannot be audited. However selftest includes assertions. But we don't have source. The user likely expects audit of provided code; mentioning missing file may be useful. But avoid if not central. Could include under THE INVARIANT LOW: unaudited helper. But maybe they omitted for space. Hmm.

Need check `bank/alarm.mjs` imports `./anchor.mjs`? No, alarm doesn't. revenue/distribute import `pinnedAccountData` from './anchor.mjs'. selftest imports. Not provided. If anchor.mjs has bug, money paths misread config. Since not provided, we can state "I cannot verify the pinning helper; if it does not enforce owner/disc/version exactly, the offsets reads are unsafe." But the prompt asks find faults in provided code. Maybe include as evidentiary gap in final 100%. Good.

Potential issue: `revenue.mjs` reads config offsets after `pinnedAccountData`, but then also `if (!cfg)` redundant. If `pinnedAccountData` throws on wrong owner/disc, okay. If absent returns null, `cfg.data` null. Good.

Potential issue: `distribute.mjs` calls `pinnedAccountData(cfgAcc, ...)` but ignores return? It then reads `cfgAcc.data`. If pinnedAccountData throws on wrong, okay. If it returns null for absent, but cfgAcc checked not null. Good.

Potential issue: `alarm.mjs` readConfigs uses own offsets, not anchor.mjs. It checks disc/version. Good.

Now, think about possible false positive: revenue.mjs swap inspection allowlist. Jupiter swap transaction may legitimately include SystemProgram for wrap/unwrap SOL. A malicious system transfer is possible. The code's comment admits bound not proof. We can file as critical because it can steal cycle funds. The operator wallet should hold only cycle funds, but cycle funds are real Bitcoin (SOL). So yes.

Potential false positive: amount-blind split. The alarm also has `detectUnreconciledRevenue` short return comparing returnedSats to quotedSats, but both ledger. If operator fakes returnedSats, hidden. The split anchor existence can be manufactured by operator with dust. Yes. Critical.

Potential false positive: distribution treasury key. The distributor key is intended to hold 85% and send daily. If compromised, theft. Alarm ledger-only. Yes.

Potential false positive: lock TOCTOU. They admit. Good.

Potential false positive: Core not watched. True.

Potential false positive: detectBurns severity. Subjective but asked. Good.

Potential false positive: T22 dead weight. True.

Potential false positive: burn not forcing ATA closure. Is rent "customer SOL"? The ATA rent is paid by whoever created ATA (bank in tests). If vault redeemed, rent could be returned to owner. If not closed, lamports locked forever. It's a loss of SOL, small. Finding valid.

Potential false positive: BURN config divergence at mint. If BURN config wrong, burn fails. But initialization is trusted. Still a liveness/safety check missing. Valid.

Potential false positive: Royalty unreachable after gov PDA. True. But maybe intended. Still liveness finding.

Potential false positive: Quorum burned. Known, but still a 100% gap. We can mention as MEDIUM not new? It is in SPEC known limits. The prompt says known consequences do not re-report; quorum burned not in known consequences but SPEC known limits. It says "KNOWN CONSEQUENCES OF THE REWRITE — ALREADY FOUND, DO NOT RE-REPORT" list only. Carry-over list. The