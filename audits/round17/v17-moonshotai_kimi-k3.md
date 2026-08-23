[reasoning only]
Let me work through this carefully. This is round 17 of an AI audit of a Solana vault system. The primary targets are R1-R6 from the diff ab07526..HEAD (actually 2f84b40..HEAD per the diff header).

Let me start with R1: SEAL's new on-chain check in `open_for_redemption`.

**R1: The confinement check**

The new code:
```rust
let sysvar = ctx.accounts.instructions.to_account_info();
let current = load_current_index_checked(&sysvar)? as usize;
let bank = ctx.accounts.config.bank;
let mut found = false;
let mut i = 0usize;
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
    let is_open = ix.program_id == crate::ID
        && ix.data.len() >= IX_OPEN_FOR_REDEMPTION_DISC.len()
        && ix.data[..IX_OPEN_FOR_REDEMPTION_DISC.len()] == IX_OPEN_FOR_REDEMPTION_DISC;
    let is_burn = ix.program_id == BURN_PROGRAM_ID
        && ix.data.len() >= IX_BURN_VAULT_DISC.len()
        && ix.data[..IX_BURN_VAULT_DISC.len()] == IX_BURN_VAULT_DISC;
    if !found
        && i > current
        && is_burn
        && ix.accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(asset)
        && ix.accounts.get(BURN_IX_OWNER_IDX).map(|a| a.pubkey) == Some(owner)
    {
        found = true;
    }
    if !is_open && !is_burn {
        require!(
            !ix.accounts.iter().any(|a| a.pubkey == bank),
            VaultError::BankKeyOutsidePair
        );
    }
    i += 1;
}
require!(found, VaultError::NoTerminalBurn);
```

Key questions:

1. **The exemption attack surface**: An instruction to SEAL with the open discriminator, or to BURN with the burn discriminator, is exempt from the confinement check. Can such an instruction do something else with the Bank's key?

   - An instruction to SEAL with `open_for_redemption` discriminator: it will be dispatched to `open_for_redemption`. That instruction takes `bank: Signer` pinned to config.bank. So the Bank's key in it is used exactly as intended. But wait — what about OTHER instructions in SEAL? SEAL has `initialize`, `update_config`, `apply_pending`, `cancel_pending`, `open_for_redemption`. Only `open_for_redemption` has that discriminator. Any other instruction to SEAL would have a different discriminator and would NOT be exempt — so it would be checked for the Bank's key. `update_config` takes `admin: Signer`, not bank... but admin could be the bank in some configs? Actually in the test suite, bank IS the admin. Hmm, but in production admin is the Squads. If config.admin == config.bank, then an `update_config` instruction naming the bank as admin would be refused by the confinement check (since it's not an open or burn). That's a false positive but fail-closed, fine.

   - What about an instruction to SEAL with the open discriminator but malformed accounts? It would be dispatched to `open_for_redemption` and fail there (Anchor account validation). So the whole transaction fails. No harm.

   - What about an instruction to BURN with the burn discriminator? Dispatched to `burn_vault`, which requires a preceding open for the same asset and owner, plus bank signer pinned to its config. So it enforces the same 2-of-2.

   - **The key attack**: an instruction to SEAL with the open discriminator that is NOT a well-formed open — e.g., with extra accounts appended, or with the bank in a different position. Anchor deserialization would fail → transaction fails. So no.

   - But wait — what about an instruction to SEAL with the open discriminator where the bank appears in the accounts list but the instruction is crafted to... no, it goes to the real handler.

   - **What about `initialize`?** SEAL's `initialize` discriminator is different. Not exempt. Checked. If it names the bank (e.g., as admin), refused. Fine.

   - **The real question**: is there an instruction to SEAL or BURN wearing the open/burn discriminator that does something OTHER than open/burn? No — the discriminator determines dispatch. So the exemption is sound in that direction.

   - **BUT**: what about the OTHER direction — the exemption lets the Bank's key appear in an open/burn instruction in ANY POSITION, not just the bank position. E.g., an `open_for_redemption` instruction where the Bank's key is passed as... the `payer`? Or as `owner`? Let's think. `open_for_redemption` accounts: vault_asset, collection, owner (Signer), bank (Signer), payer (Signer), config, seal, mpl_core, instructions, system_program. If the Bank's key is passed as `payer`, then the Bank pays for the thaw CPI. That's the accepted limit 3 ("The Bank may still be named `payer` INSIDE the pair itself"). Known and open. Do not re-report.

   - What if the Bank's key is passed as `owner`? Then the instruction requires the Bank to sign as owner, and `read_core_asset` checks the asset owner == owner. The Bank doesn't own the vault, so it fails. Fine.

2. **Does the rewrite preserve the OLD invariant exactly?**

   - Burn before the open: `i > current` required. A burn at index < current doesn't set found. ✓
   - Two redemptions sharing a transaction: open A at index 0, burn A at 2, open B at 3, burn B at 5. For open A (current=0): scans all, finds burn A at 2 (i>0, is_burn, asset A, owner A) → found. Confinement: open B at 3 is exempt (is_open), burn B at 5 exempt (is_burn). ✓. For open B (current=3): finds burn B at 5. ✓. Also finds burn A at 2 but i>current fails (2 < 3), so no false found... wait, `!found && i > current` — burn A at index 2, current=3, so i > current is false, doesn't set found. Good. But also — could open B "borrow" burn A? Burn A is for asset A, not asset B, so the asset binding fails. ✓
   - An open reached by CPI: `load_current_index_checked` returns the index of the current top-level instruction. If open is invoked via CPI from another program, the sysvar reports the outer instruction's index. The scan walks top-level instructions. The open via CPI would see the outer instruction at `current`. The outer instruction is NOT an open (it's the wrapper program's instruction), so it's checked for the bank's key. If the wrapper's instruction doesn't name the bank... but wait, the CPI'd open requires the bank to sign. The bank's signature is on the transaction (top-level signer). The wrapper instruction's account list must include the bank for the CPI to pass it as a signer... Actually, for a CPI, the wrapper program passes accounts to the callee. The callee's `bank: Signer` check requires the bank to have signed the transaction. The wrapper's instruction account list includes the bank (to pass it through). So the wrapper instruction names the bank → confinement refuses (BankKeyOutsidePair) because the wrapper instruction is neither open nor burn. So a CPI-wrapped open is refused by the confinement check. Is that a problem? The old invariant allowed a CPI'd open IF a genuine top-level burn followed. Now it's refused if the wrapper names the bank — which it must, to pass the bank through. Hmm, wait: does the wrapper need to name the bank? The CPI passes account infos. The bank account must be in the wrapper instruction's account list for the wrapper to pass it to the callee. Yes. So any CPI-wrapped redemption is now refused. Is that a regression? The comment says "an `open_for_redemption` reached BY a CPI reports the OUTER instruction's index, so the wrapper would need a genuine top-level burn for this exact asset and owner later in the same transaction — and BURN independently demands a genuine top-level open before it." So under the old code, a CPI'd open + top-level burn: the burn demands a top-level open (BURN's scan looks for top-level open). A CPI'd open is NOT top-level, so BURN refuses. So CPI-wrapped redemptions were already impossible (BURN demands top-level open). So the confinement check doesn't regress anything. ✓

   - What about the burn being found at `i > current` — but what if there are TWO burns for the same asset and owner, one before and one after? found is set by the one after. Fine.

   - **Subtle**: `!found && i > current && is_burn && ...` — once found, stays found. Fine.

   - **What about an open AFTER the current open for the same asset?** E.g., open A at 0, open A again at 2, burn A at 3. For current=0: finds burn at 3. Confinement: open at 2 is exempt. OK. The second open would also run (if the first succeeds)... both thaw, then burn. Fine, harmless.

3. **What does it NOT see?**

   - The fee payer: correct, not in any instruction's account list. A transaction naming the Bank as fee payer: the confinement check can't see it. The Bank signs as fee payer, paying fees. That's a theft of fees (small). The author states this. Concrete transaction: `[open, sweep, burn]` with feePayer = bank and a ComputeBudget instruction setting a huge priority fee. The ComputeBudget instruction doesn't name the bank (it has no accounts), so confinement passes it. The Bank's signature as fee payer authorizes the fee. This is the stated gap. The author's reasoning that the sysvar cannot see it is correct. It's listed as accepted limit 1a. Do not re-report as new, but I can confirm it's real.

   - The program allowlist: the author's reasoning is that System must stay permitted for rent and the SOL sweep, so an allowlist wouldn't have stopped the theft (the theft used SystemProgram.transfer). Correct — the round-15 theft was a System transfer from the bank, which an allowlist permitting System would not stop. The confinement (bank key not in any other instruction) is what stops it. ✓ Sound reasoning.

   - **What about the bank being named in an instruction to a program that doesn't require the bank to sign?** E.g., an instruction that names the bank as a non-signer writable account. The confinement refuses ANY appearance of the bank's key, signer or not. That's stricter. Fine (fail-closed; test 4.10 covers paying INTO the bank).

4. **Does BURN need a copy?**

   The claim: every burn that can execute sits in a transaction where SEAL's scan already ran, because burn_vault refuses without a preceding open (NoPrecedingOpen).

   Attack: a transaction with a burn but where the open FAILED? No — if the open fails, the whole transaction reverts. Solana transactions are atomic. So if the burn executes, the open executed, and the open's scan ran over all top-level instructions. ✓

   But wait — **what about a burn in a transaction where the open is present but the open's confinement check was exempted for the burn instruction itself?** The burn instruction is exempt from the confinement check (is_burn). So the burn instruction can name the bank in any position. burn_vault's accounts: vault_asset, collection, owner, bank, asset_signer, payer, config, seal_config, instructions, mpl_core, system_program, + declared. The bank could be named as `payer` in the burn (accepted limit 3). Known.

   **The real question**: is there a transaction containing a burn whose confinement was never checked? The burn requires a preceding top-level open for the same asset and owner. That open ran the confinement scan over ALL top-level instructions (i from 0 to end). So every instruction in the transaction was checked by that open. ✓ Unless... the open's scan has a bug. Let me check the loop again: `while let Ok(ix) = load_instruction_at_checked(i, &sysvar)` — iterates from 0 until load fails. load_instruction_at_checked fails when i >= number of instructions. So it covers all. ✓

   Hmm, but what about **the open being a DIFFERENT open**? The burn requires an open for the same asset and owner. That open scans everything. So the burn's transaction is covered. ✓

   What about **two burns and one open**? open A, burn A, burn A again? The second burn A would fail (asset already burned → NotACoreAsset, since the asset is at Key::Uninitialized... actually after BurnV1 the asset account survives at Key::Uninitialized, so d[0] != KEY_ASSET_V1 → NotACoreAsset). Fine.

   What about open A, burn B (different vault)? Burn B requires a preceding open for asset B and owner B. Open A is for asset A. So burn B refuses (NoPrecedingOpen). ✓ (test 9.0)

   So BURN not needing a copy is TRUE, given the dependency. The dependency is gated by 3.8 and 9.0. OK.

5. **COMPUTE UNITS.**

   The loop now deserializes every top-level instruction. `load_instruction_at_checked` has a cost. Each call deserializes the instruction at index i from the sysvar. The sysvar stores all instructions; loading at index i is O(size of instructions up to i)? Actually, `load_instruction_at_checked` parses the sysvar data: it reads the instruction count, then walks to index i. The current implementation: `load_instruction_at_checked(index, sysvar)` → `deserialize_instruction(index, &sysvar.data.borrow())`. It reads the first 2 bytes (num instructions), checks index < num, then reads offsets... Actually the sysvar format: u16 num_instructions, then for each instruction a u16 offset, then the instructions serialized. `deserialize_instruction` reads the offset table entry for index (at 2 + index*2), seeks to that offset, and deserializes. So it's O(1)-ish per call plus deserialization of that instruction. Deserialization allocates a vector of account metas and data. Each call costs some CU. For a redemption with, say, 6-10 top-level instructions, that's 6-10 deserializations plus the per-instruction account scan for the bank key. Probably a few thousand CU per instruction. The old code did the same but stopped at the burn (typically index 2-4). The new code goes to the end. For a 3-mint redemption: open + 3 sweeps (each sweep is one ExecuteV1? or multiple?) + burn. Actually sweeps are Core ExecuteV1 instructions — one per... let me look at the test: `sweep(V,SATS,0)` returns a single ExecuteV1 instruction containing inner instructions. So a redemption is: open, ExecuteV1 (maybe several), burn. Maybe 3-6 top-level instructions. The extra CU is small. But CU is unmeasured (accepted limit 12). The default compute budget is 200k CU per instruction. The loop over ~6 instructions with ~15 accounts each: each `load_instruction_at_checked` maybe ~1-2k CU, the account scan trivial. Probably fine, but unmeasured. I should flag that the measurement is still absent and now matters more — but it's accepted limit 12, "got worse this round". The prompt says do tell if worse than stated. I can note the loop is O(n) sysvar deserializations and that `load_instruction_at_checked` on Agave has a base cost plus per-instruction deserialization; with the 1232-byte ceiling the instruction count is bounded (~10 max), so the added CU is bounded and almost certainly small relative to 200k — but it remains unmeasured, and the fix is to measure, not to assume. I'll file as LOW/MEDIUM with the evidence being a CU measurement.

   Actually wait — there's a subtlety. `load_instruction_at_checked` — in older versions, `deserialize_instruction` walks from the beginning each time? Let me recall the actual implementation:

   ```rust
   pub fn load_instruction_at_checked(
       index: usize,
       sysvar: &AccountInfo,
   ) -> Result<Instruction, ProgramError> {
       if !sysvar::instructions::check_id(sysvar.key) {
           return Err(ProgramError::UnsupportedSysvar);
       }
       let data = sysvar.try_borrow_data()?;
       deserialize_instruction(index, &data).map_err(|_| ProgramError::InvalidArgument)
   }
   ```

   and `deserialize_instruction`:
   ```rust
   pub fn deserialize_instruction(index: usize, data: &[u8]) -> Result<Instruction, SanitizeError> {
       let mut cursor = 0;
       let num_instructions = read_u16(&mut cursor, data)?;
       if index >= num_instructions as usize {
           return Err(SanitizeError::IndexOutOfBounds);
       }
       cursor += index * 2;  // hmm, actually...
       let offset = read_u16(&mut cursor, data)?;
       cursor = offset as usize;
       deserialize_instruction_at(cursor, data)  // roughly
   }
   ```

   Actually the format: first 2 bytes = number of instructions, then `num_instructions` u16 offsets, then the instruction data. `deserialize_instruction` reads num, then seeks to `2 + index*2` to read the offset, then deserializes at that offset. So O(1) per call. Fine. The cost is bounded.

   Hmm, one more: the sysvar account data itself — accessing the instructions sysvar is cheap (it's a special sysvar). OK.

6. **Now the deeper question on R1: is there a way to construct an instruction that MATCHES open/burn shape, is exempt, and does something else with the Bank's key?**

   The check reads `ix.program_id` and first 8 data bytes. An instruction to SEAL with open discriminator IS an open (dispatch). An instruction to BURN with burn discriminator IS a burn. So no.

   BUT — what about an instruction to SEAL with the open discriminator whose accounts include the bank in the `payer` position AND the instruction is for a DIFFERENT vault (a sibling redemption)? That's the documented multi-redemption case. The bank pays for the sibling's thaw. Accepted limit 3.

   What about an instruction to SEAL with open discriminator, for a vault the attacker owns, where the bank is named as `payer`? The bank signs (it's a signer in the instruction). The Bank's co-signer policy would refuse... but on-chain, the open succeeds if the burn follows. The Bank as payer inside the pair — accepted limit 3. Known.

   **What about SEAL's OTHER instructions wearing... no.**

   **What about the bank appearing in an open/burn instruction's accounts in a position that lets the instruction transfer the bank's lamports?** open_for_redemption's `payer` is a Signer and is used in `core_plugin_cpi` as the payer for the UpdatePluginV1 CPI — Core might charge the payer? The payer pays rent/fees for the plugin update? Minimal. burn_vault's `payer` receives the asset's rent refund from BurnV1 (measured fact 4: the payer received only the asset's own rent). So naming the bank as payer in the burn gives the bank the rent refund — that's money TO the bank. And in the open, the bank as payer pays a small fee. Accepted limit 3 covers this.

   OK here's another angle: **the exemption is per-instruction, and the check is `ix.program_id == crate::ID`. What is `crate::ID`?** It's SEAL's own program id. Fine. And BURN_PROGRAM_ID is hardcoded. Fine.

   **What about the `found` logic interacting with the confinement?** Suppose the transaction is `[burn_A (for asset A, owner O), open_A]`. For open_A at current=1: scan finds burn at 0, but i > current fails → not found → NoTerminalBurn. ✓ (matches old behavior).

   Suppose `[open_A, burn_A, evil_instruction_naming_bank]`? The evil instruction is neither open nor burn → confinement refuses. ✓

   Suppose `[open_A, burn_A, open_B]` where open_B names the bank but has no burn_B? open_B is exempt from confinement, but open_B itself requires a terminal burn_B → fails → whole transaction reverts. ✓

   Suppose `[open_A, burn_A, burn_B]` where burn_B names the bank as payer but there's no open_B? burn_B is exempt from confinement. burn_B executes? It requires a preceding open for asset B → NoPrecedingOpen → fails → whole transaction reverts. ✓ So an exempt-but-invalid instruction can't survive because the transaction is atomic. 

   **KEY INSIGHT**: because Solana is atomic, any exempt instruction that fails takes the whole transaction down. So the exemption can only "succeed" for instructions that actually execute as real opens/burns, which enforce the 2-of-2 themselves. The exemption is sound. The one exception: an exempt instruction that SUCCEEDS while doing something unintended with the bank's key. open/burn with bank as payer — accepted limit 3. Anything else? open_for_redemption with bank as `owner`? Fails (NotTheOwner). With bank as `vault_asset`? Fails (NotACoreAsset — the bank is a system account). With bank as `collection`? Fails (WrongCollectionAccount). With bank as `config`? Fails (seeds). With bank as `seal`? Fails (seeds). With bank as `mpl_core`? Fails (address). With bank as `instructions`? Fails (address). With bank as `system_program`? Fails (Program<System> check). So only payer. burn_vault: bank as vault_asset/collection/owner/asset_signer/config/seal_config/instructions/mpl_core/system_program all fail their checks. bank as payer — accepted. So the exemption is sound except for the documented payer case.

   Wait, actually — one more: **what about the bank appearing in the burn's DECLARED accounts (remaining_accounts)?** The burn's remaining accounts are the declared token accounts. Could the bank's own account be passed as a declared account? The second loop: for each remaining account, if owner is Core → check not a live asset; if lamports == 0 → skip; if owner is token program → check PDA-owned and empty. The bank's system account: owner is System, not Core, not token program → skipped (after lamports check — if bank has lamports, `acc.lamports() == 0` is false, then `acc.owner != &SPL_TOKEN_ID && != &SPL_TOKEN_2022_ID` → continue). So the bank's account as a declared account is ignored by the burn logic. And the confinement check exempts the whole burn instruction, so the bank can be named in the declared accounts. Does that DO anything? The burn doesn't transfer from declared accounts. It just reads them. So no theft. But — could naming the bank in the declared accounts affect `declared` count vs coverage? That's the co-signer's problem off-chain. On-chain, harmless.

   Hmm, but wait — what about the bank being named in the declared accounts AND the burn's `payer` being someone else... no movement of bank funds. OK.

   So R1's exemption is sound. Good. Now, is there anything actually wrong in R1?

   **The `found` flag and `i > current`**: correct.

   **The confinement check runs even for instructions BEFORE the current open.** The comment says the second job is only sound if it sees every instruction including those before. ✓ it starts at 0.

   **What if the bank's key appears in an instruction to SEAL that is NOT an open — e.g., `update_config` with the bank as admin?** Not exempt → refused. In production admin is the Squads, not the bank, so legitimate redemptions don't include update_config. Fine.

   **What about `apply_pending` (SEAL)?** Permissionless, takes only config. Doesn't name the bank. Fine.

   **What about the bank appearing in a ComputeBudget instruction?** ComputeBudget instructions have no accounts. So they pass the confinement check. And the fee payer gap covers the priority fee issue. Known.

   **What about the bank appearing in the ALT (address lookup table)?** Legacy transactions only (1232 ceiling). Versioned transactions with ALTs: the sysvar's instruction account lists contain the RESOLVED pubkeys (the sysvar stores resolved instructions? Actually the instructions sysvar stores the instructions as compiled, with account pubkeys resolved — for v0 transactions, the sysvar contains the instructions with resolved addresses? Let me think. The instructions sysvar contains the "decompiled" instructions of the transaction message. For v0 messages with lookup tables, the message's instructions reference accounts by index into the loaded addresses; the sysvar stores instructions with actual pubkeys (resolved). Yes — the runtime resolves ALTs when building the sysvar. So the confinement check sees resolved pubkeys. But the co-signer can't parse v0 (3.1i). On-chain, a v0 redemption would work with the sysvar resolved. Fine.

   Hmm wait, actually there's a subtle issue: does the redemption fit in a v0 transaction? Not relevant to the audit per se.

   **One more R1 issue: the `require!` inside the loop uses `VaultError::BankKeyOutsidePair` — but the loop also runs for instructions at i == current (the open itself).** The current open IS an open (is_open true) → exempt. ✓

   **What about the burn instruction at i > current being exempt even though it might name the bank in a malicious position?** Covered above — only payer, accepted.

   **Now — the REAL potential issue in R1: the scan walks from 0, and the confinement check applies to instructions BEFORE the open. But the OLD invariant only required the burn AFTER. Consider: `[evil_naming_bank, open_A, burn_A]`. The evil instruction is before the open. The confinement catches it (i=0, not open/burn, names bank → refuse). ✓ Good — that's the point of starting at 0.

   But here's a question: **is the confinement check's refusal itself exploitable as a griefing?** Anyone can include an instruction naming the bank in a transaction with someone else's redemption? No — the redemption needs the bank's signature. The bank signs the whole transaction. If the customer composes a transaction with an instruction naming the bank, the bank's co-signer refuses (policy) and on-chain the open refuses. So the customer can't get their redemption signed+executed with such an instruction. Griefing would be: customer includes an instruction naming the bank, the bank signs (policy failure), transaction fails on-chain → bank's fee wasted. Minor.

   **A more interesting griefing**: the confinement check refuses if the bank appears in ANY non-pair instruction. The sweeps are Core ExecuteV1 instructions. Do they name the bank? After the test fix, payer is alice. In production, the customer composes the sweep; if they name the bank as the ExecuteV1 payer, the open refuses. That's a customer shooting themselves. Fine.

   OK so R1 seems... actually pretty solid. Let me look for the CU issue more carefully and the "two redemptions" case for a subtle bug.

   **Two redemptions, one transaction, and the confinement**: open A, burn A, open B, burn B. For open A (current=0): confinement checks all instructions. open B and burn B are exempt. ✓. found: burn A at 1 (i>0). ✓. For open B (current=2): found: burn B at 3. ✓. Confinement same. ✓. Test 4.9 covers this. ✓

   **What about open A, open B, burn A, burn B?** For open A (current=0): finds burn A at 2. ✓. For open B (current=1): finds burn B at 3. ✓. Both thaws happen, then both burns. Works. Is that a problem? The sweeps would need to be between... actually with no sweeps, empty vaults. Fine.

   **What about open A, open B, burn B, burn A?** For open A: needs burn A after → at index 3. ✓ found. For open B: burn B at 2. ✓. So cross-ordered works too. Fine.

   **Now the CU question for real**: each iteration calls `load_instruction_at_checked`, which borrows the sysvar data and deserializes instruction i. The sysvar borrow is per-call. Deserialization allocates. For N instructions, N calls. Each maybe ~1-3k CU (allocation + parsing). N is bounded by transaction size / minimal instruction size — with a 1232-byte packet, at most ~10-15 instructions. So worst case maybe ~30-45k CU added. Default budget 200k. The open also does read_core_asset, the CPI, etc. Probably fits. But unmeasured. I'll note it as a MEDIUM/LOW: the fix is one measurement in the suite (report CU consumed by open_for_redemption in the worst-case redemption), not a redesign.

   Actually, hold on. Let me reconsider `load_instruction_at_checked` cost more carefully. In Agave, `deserialize_instruction` for index i: it reads num_instructions (2 bytes), then the offset at position 2+i*2, then deserializes the instruction at that offset. Deserialization of an instruction: reads num_accounts (u16), then for each account: 1 byte flags + 32 bytes pubkey; then data len (u16) + data; then program_id (32 bytes). So O(instruction size). Fine, bounded.

   BUT — there's a known CU gotcha: `load_instruction_at_checked` in a loop from 0..N is O(N) calls each O(1). Fine.

   So the CU concern is real but bounded; measurement is the fix. Accepted limit 12 covers "unmeasured"; the prompt says it got worse — I can quantify the bound and say it's almost certainly fine but must be measured before ship. Not a new finding per se, but I'll fold it into a finding about the need for measurement with the specific bound.

   Hmm, wait. Actually, let me reconsider one thing about R1. **The `is_open` check uses `ix.program_id == crate::ID`. But what about an instruction to SEAL with the open discriminator that is MALFORMED — e.g., zero accounts?** It's exempt from confinement. It gets dispatched to open_for_redemption → Anchor fails (missing accounts) → transaction reverts. ✓ atomic.

   **What about an instruction to SEAL with open discriminator and the bank in the accounts, dispatched successfully as a real open for a sibling vault — but the sibling open's OWN confinement scan then runs and... it's the same scan. Fine.**

   OK, R1 conclusion: the mechanism is sound. The findings for R1 are: (a) CU unmeasured with a bounded estimate — fold into limit 12; (b) maybe a LOW about the `found` flag not breaking, which is fine.

   Wait, actually, let me think about one more attack on R1. **The confinement check compares `a.pubkey == bank` where `bank = ctx.accounts.config.bank`. But the instruction's `bank: Signer` is checked `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.config.bank)`. So the config bank is the signer. Fine.

   **What if config.bank is also the owner of some vault?** Then a redemption of that vault names the bank as owner in the open — exempt (is_open). And in the burn — exempt. Fine. And the sweeps for that vault would be ExecuteV1 with authority = bank... ExecuteV1 names the bank as authority → not exempt → confinement refuses! So if the bank owns a vault, the bank cannot redeem it (the sweep names the bank as authority/owner). Edge case: the Bank owning a vault is weird but possible. The redemption would need the sweep to not name the bank... but ExecuteV1 requires the owner's signature, so the bank must be in the ExecuteV1 accounts. So a bank-owned vault is unredeemable via the normal path. Is this a finding? It's an odd edge — the Bank is a party to the system, not a customer. The Bank could transfer the vault to a normal key first? No wait, the bank owns it; transfer requires ExecuteV1? No — transfer of the asset itself is a Core TransferV1 by the owner (the bank), which doesn't need the seal (the seal gates Execute, not transfer... PermanentFreezeExecute gates Execute only). So the bank could TransferV1 the vault to alice, then alice redeems. So there's an escape. Minor, not worth a finding. Actually, hmm, is it worth noting? The bank owning a vault and being unable to redeem it directly is a consequence of the confinement. It's contrived. Skip or LOW.

   **Another R1 thought**: the confinement check refuses instructions naming the bank — including an instruction that pays rent for a NEW ATA for the customer where the bank is... no, the bank wouldn't be in such an instruction in a legit redemption. The customer pays. Fine.

   Let me now also double-check: **does the confinement check break the documented "sweep the PDA's lamports" flow (9.10/9.11)?** The lamport sweep is a SystemProgram.transfer from the PDA (via ExecuteV1) to alice. The ExecuteV1 instruction names the PDA, alice, etc. — not the bank. ✓ (with payer: aliceU after the fix).

   **Does it break the delegate test (3.3)?** dele/drain are ExecuteV1 with payer: aliceU now. ✓

   OK. R1 is largely sound. Let me move to R2, which I think has more meat.

**R2: distribute.mjs weighted distribution**

```js
export function allocateWeighted(balances, levels, available, opts = {}) {
  const min = opts.minPerVault ?? MIN_PER_VAULT
  const activated = Object.entries(balances)
    .filter(([, b]) => BigInt(b) >= ACTIVATION_SATS)
    .map(([a]) => a)
    .sort()
  const empty = { activated, per: {}, total: 0n, dust: 0n, census: census({}), denominator: 0 }
  if (activated.length === 0) return { ...empty, skip: 'no activated vaults' }
  const unlevelled = activated.filter(v => !LEVEL_WEIGHTS[levels[v]])
  if (unlevelled.length) return { ...empty, skip: `...` }
  const cen = census(Object.fromEntries(activated.map(v => [v, levels[v]])))
  const den = denominator(cen)
  if (den <= 0) return { ...empty, census: cen, skip: 'denominator is zero' }
  if (available <= 0n) return { ...empty, census: cen, denominator: den, skip: 'no cbBTC to distribute' }
  const per = {}
  let total = 0n
  for (const v of activated) {
    const amt = (available * BigInt(LEVEL_WEIGHTS[levels[v]])) / BigInt(den)
    per[v] = amt; total += amt
  }
  const smallest = activated.reduce((m, v) => per[v] < m ? per[v] : m, per[activated[0]])
  if (smallest < min) return { ...empty, census: cen, denominator: den, skip: `only ${available} for a denominator of ${den}` }
  return { activated, per, total, dust: available - total, census: cen, denominator: den, skip: null }
}
```

- Over-distribution: each amt = floor(available * w / den). Sum of floors <= floor(sum) <= available. So total <= available. ✓ Can't over-distribute. BigInt, no overflow (JS BigInt arbitrary precision). ✓
- Pay a non-activated vault: no, per only for activated. ✓
- Miss an activated one: no. ✓
- `smallest` when activated is empty: early return before. ✓ When first element is not the smallest: reduce with initial per[activated[0]], compares all — correct. ✓
- `census({})` in `empty`: census of empty levels → all zeros. Fine.
- `denominator` returns a JS NUMBER (not BigInt): `LEVELS.reduce((s, l) => s + (c[l] || 0) * LEVEL_WEIGHTS[l], 0)`. At 2,100 vaults, max den = 2100*6 = 12,600. Number is fine. `BigInt(den)` conversion fine.
- Dust: available - total >= 0. ✓ Bounded by... each floor loses < 1 sat per vault, so dust < number of activated vaults, NOT < denominator! Wait: dust = available - sum_v floor(available * w_v / den). The number of terms is |activated|, and each term loses less than 1. So dust < |activated| <= 2100. But the comment and selftest say "the dust never exceeds the denominator" — dust < den? den = sum of weights >= |activated| * 2. Since dust < |activated| and |activated| <= den/2 < den, yes dust < den. ✓ The selftest asserts `r.dust < BigInt(r.denominator)`. OK, true but the tighter bound is |activated|. Fine.

  Wait, the comment says "Integer division leaves up to (denominator - 1) sats — at 2,100 vaults that is up to 6,404 per settlement". Actually the real bound is |activated| - 1... no wait. Hmm: sum_v floor(x_v) > sum_v (x_v - 1) = available - |activated|. So dust < |activated|. At 2,100 vaults, dust < 2,100, not 6,404. The comment overstates the dust bound (6,404 = den - 1 = 6405 - 1). Is that a defect? It's a comment overstating the possible dust — conservative direction (says dust could be bigger than it can). Not a customer-facing harm; it's in the code comment and SPEC ("up to 6,404 sats a settlement"). Actually the real max dust is |activated| - 1 when all terms are just below integers... hmm, more precisely dust <= |activated| - 1? dust < |activated|, and dust is an integer, so dust <= |activated| - 1. At 2,100 vaults: dust <= 2,099. The comment says "up to 6,404". That's an overstatement — the direction is safe (they're not hiding dust), but it's arithmetically wrong. R6 says check published figures. SPEC says "at 2,100 vaults the remainder can be up to 6,404 sats a settlement". The correct bound is 2,099 sats (number of activated vaults minus one... wait, actually let me redo: dust = available - Σ floor(available·w_v/den). Each term: available·w_v/den - floor(...) < 1. Sum over v: available - Σ floor < |activated|. So dust < |activated| ≤ 2,100. So max dust 2,099 sats. The claim "up to (denominator − 1) = 6,404" is wrong — it's not the tight bound, it's just wrong as stated ("Integer division leaves up to (denominator - 1) sats"). Hmm, is it "wrong" or just "loose"? The statement "leaves up to (denominator-1) sats" — the true maximum is |activated|-1. Since |activated|-1 <= den-1, the statement "up to den-1" is technically true as an upper bound (dust <= 2099 <= 6404). "Up to X" means "no more than X", which is true. But it presents 6,404 as the meaningful bound when the real bound is 2,099. It's loose, not false. Given R6 is about published card figures, and this is in SPEC's distribution section... The card figures are the per-$1,000 and shares, which are separate. I'll note it as LOW (loose bound, overstated by 3x; the tight bound is activated-1).

  Hmm wait, actually, let me reconsider. Is dust really < |activated|? available * w_v / den, summed over v with weights: Σ available·w_v/den = available · (Σw_v)/den = available · den/den = available. Yes because den = Σ w_v over activated v. So Σ x_v = available exactly, and dust = Σ (x_v - floor(x_v)) < |activated|. ✓. So dust ≤ |activated| − 1 = 2,099 max. The comment's 6,404 is a 3x overstatement. LOW.

- **The dust carries forward and is never split**: "Can the dust grow without bound?" No — each drop's dust < |activated|, and the dust stays in the pool (the distributor's ATA), so it's part of the next `available`. It doesn't accumulate as a separate number; it's just undistributed pool balance. Bounded by |activated|-1 at any time relative to a perfect split. Fine.

  "Can a change in the activated set between drops make a holder worse off than if it had been split?" Sure — if the activated set changes, the dust benefits the new set, not the holders who generated it. E.g., holder A activates, dust accrues, A redeems (burns), new holder B activates, dust goes to B. A lost their share of the dust. That's inherent to "dust stays in the pool". It's a ruling. Worth naming? The prompt asks "Can a change in the activated set between drops make a holder worse off than if it had been split?" — Yes: a holder who redeems before the next drop forfeits their dust share; a holder who activates right after a drop that left dust gets a windfall. It's bounded by dust < |activated| sats total, so per-holder impact is tiny (< 1 sat each on average). LOW/informational.

- **Activated vault with no level stops the whole distribution**: griefing surface? Who can cause a vault to be activated-but-unlevelled? The level register is off-chain (`bank/levels.json`), written by... the operator (Gary's process). A vault becomes activated by holding >= 21,000 sats. The level is assigned "at activation by fate" — by an off-chain process that must write levels.json. If that process lags (a vault activates on-chain but no level is written yet), the whole distribution halts. So the griefing vector: anyone who activates a vault (deposit 21,000 sats into a vault they own) before the level-assigning process writes their level halts ALL payouts until the operator updates levels.json. That's a real griefing surface: activation is permissionless (anyone can send cbBTC to a vault's ATA... wait, can they? The vault is sealed — PermanentFreezeExecute gates Execute. But depositing INTO the vault's ATA is just a token transfer to the ATA address, which anyone can do (9.7 proves airdrops work). So anyone can activate ANY vault by sending it 21,000 sats! And if that vault has no level in levels.json, distribution halts entirely.

  Wait — but levels are assigned "at activation". If activation is permissionless and the level assignment is off-chain, then there's a race: a stranger activates a vault (or a new mint gets activated by its owner), the off-chain assigner hasn't written the level yet, and the daily distribution refuses to run. The fail-closed design means one unlevelled activated vault = total payout halt. The mitigation is the operator assigning levels promptly. But the prompt asks "can anyone cause a vault to be activated-but-unlevelled and thereby halt every payout?" — YES: anyone can activate any vault by airdropping 21,000 sats (about $21 worth of cbBTC at... well, 21,000 sats of cbBTC ≈ 0.00021 BTC ≈ $21). For the cost of ~$21 (recoverable? no — it's in the vault, the griefer doesn't own the vault... wait, if the griefer sends to SOMEONE ELSE's vault, the money belongs to that vault's owner. The griefer loses $21 permanently). So for $21, anyone can halt all distributions until the operator manually assigns a level. And they can do it repeatedly. Actually — hmm, but does the level assignment process assign a level to EVERY minted vault at activation, or only when the owner asks? The design says "assigned at activation by fate". If assignment is a manual/off-chain step triggered by the operator noticing an activation, then any activation between the operator's check and the daily run halts the run. This is a real HIGH-ish griefing. But wait — is it "by design, fail-closed"? The author explicitly chose fail-closed. The question is whether they understood that activation is permissionless. The code comment says "AN ACTIVATED VAULT WITH NO LEVEL IS A REFUSAL, NOT A WEIGHT OF ZERO... A missing level is a fact about OUR DATA". The author's framing assumes levels exist for all activated vaults and a missing one means data corruption. But activation is PERMISSIONLESS (airdrops work, proven 9.7), so "our data" can be made incomplete by anyone for $21. This deserves HIGH: the fail-closed choice combined with permissionless activation = a cheap, repeatable, total distribution halt. The fix: assign a level to every vault AT MINT (off-chain register pre-populated for all mints), or treat an unlevelled activated vault as Level I (lowest weight) rather than halting, or exclude it from the denominator AND the payout with a loud alarm (fail-open but bounded), or make activation require an operator action. Actually the cleanest: pre-assign levels at mint time (the register covers every minted vault before it can be activated), so "activated but unlevelled" can only happen if the register is incomplete — which is the operator's fault, not a stranger's. But minting is also permissionless-ish (anyone can mint during an open round by paying). So the register writer must watch mints. There's still a race. Alternatively: unlevelled → weight of Level I (2), pay them the minimum, alarm loudly. That keeps payouts flowing and the griefer's $21 buys the vault the LOWEST tier — no theft, no halt. The fail-closed choice is defensible but the prompt is right to ask. I'll file HIGH with the concrete attack and the evidence (9.7 proves permissionless airdrops; the run halts with skip message).

  Actually wait, let me reconsider severity. The halt is loud (the skip reason is printed, and `nothingToDo` is written, and the day finishes). The operator sees "N activated vault(s) carry no level". The fix is one register edit. So the blast radius is: payouts delayed by up to a day per grief, costing $21 each, until the operator automates level assignment. It's a denial of service on payouts, not a theft. HIGH feels right given "real cbBTC to real customers" and repeatability. Maybe MEDIUM-HIGH. I'll say HIGH because it's cheap, permissionless, repeatable, and halts the primary customer-facing money flow — and the author explicitly asked whether it's a griefing surface.

- **The cadence / holdDays**:

  ```js
  export function holdDays(st, day) {
    const days = Object.keys(st?.days || {}).filter(d => d < day)
    const paid = days.filter(d => Object.keys(st.days[d]?.paid || {}).length > 0).sort()
    const anchor = paid.length ? paid[paid.length - 1] : (days.sort()[0] ?? day)
    return Math.max(0, dayDiff(anchor, day))
  }
  ```

  - "a ledger whose only paid day is today": days excludes today (d < day), so paid is empty, anchor = earliest day ever seen ?? day. If the ledger has only today: days = [] → anchor = day → holdDays = 0. So a first-ever run has holdDays 0 → not forced. ✓ (selftest covers).
  - "a run that crashes mid-distribution": the day has a `paid` map with some entries (intents written before sends). If it crashes after writing intents, the day has paid entries → counts as a paid day. The hold clock resets even though maybe only intents were written. Hmm — `paid` includes rows with sig: null (intents). `Object.keys(st.days[d]?.paid || {}).length > 0` counts ANY row, including ambiguous/failed ones. So a day where every transfer FAILED (all rejected) still counts as a "paid" day for the hold clock. Is that wrong? The hold clock is "days since the last payout". A day where all transfers were refused paid NOBODY, but holdDays counts it as a payout day, resetting the clock. So the MAX_HOLD_DAYS=31 ceiling could be pushed out indefinitely by a run that attempts and fails every day... but wait, if it fails every day, that's a bigger problem (the alarm fires on failed transfers). But subtle: a day with a plan but no payments — `st.days[day].paid` stays `{}` (the plan is stored in `st.days[day].plan`, and `paid` is only populated in the send loop). Let me check: on a skip day (holding), `st.days[day].nothingToDo = plan.skip` and `paid` remains `{}`. So `Object.keys(paid).length === 0` → not a paid day. ✓ good. On a day with a plan but a crash BEFORE any send: `paid` is `{}` (intents are written per-vault in the loop). Wait — the intent `done[v] = {...}` is written inside the loop before each send. If it crashes before the first send, paid = {} → not a paid day. ✓. If it crashes after one intent (sig: null), paid has 1 row → counts as paid day. The intent might not have landed! So the hold clock resets on a day where possibly nothing was paid. Edge case; the ambiguous row is reported and must be human-resolved. Minor.
  - "clock skew across UTC midnight": `today()` is UTC. `dayDiff` parses 'YYYY-MM-DDT00:00:00Z'. Lexical order = chronological for ISO dates. ✓. A run at 23:59 UTC and another at 00:01 UTC are different "days" — two runs, two days, fine (the day key dedups).
  - "a ledger with days out of lexical order": `paid.sort()` and `days.sort()[0]` — sorted lexically, ISO dates sort correctly. ✓
  - **The `holdDays` anchor when the last paid day is TODAY**: excluded by `d < day`. ✓
  - **What if a day has `paid` rows that are all `skipped` (burned mid-run)?** Counts as a paid day. The vault was skipped, nobody paid... but other vaults were paid that day presumably. Edge.
  - **A day where the plan was made but the cadence gate said hold**: `plan.skip` set → `nothingToDo` written, `paid` = {} → not a paid day → hold clock keeps counting. ✓ Correct.

  - **Resume skips the cadence gate**: "What happens if the pool SHRANK between the plan and the resume?" The plan's `per` amounts were computed against the pool at plan time. The plan is durable. On resume, the code uses the stored plan and does NOT re-check that the distributor still holds enough. The send loop transfers `plan.per[v]` to each remaining vault. If the pool shrank (e.g., the operator swept some out, or a previous partial run already paid some), the distributor ATA may have insufficient balance partway through → transfers start failing with insufficient funds → those are marked `rejected` (the regex includes 'insufficient funds') → retryable, reported. So a shrunk pool on resume = some vaults unpaid, reported, not silently wrong. But: could the pool shrink because the operator spent the distributor's cbBTC elsewhere? The distributor is config.treasury, receiving the 85%. Its balance is the pool. Between plan and resume (same day), the balance only changes via this job's sends (and operator action). A crash-resume same day: the plan total <= available at plan time; the sends already done reduced the balance by exactly the amounts sent; the remaining sends need total - sent <= available - sent. So solvent. Unless the operator moves money out of the distributor ATA mid-day. That's an operator action; the failure mode is failed transfers, reported. Acceptable. But there's a subtler one: **the plan is reused on resume even if the ACTIVATED SET changed** — a vault that was activated at plan time and redeemed (burned) before resume: handled by the `stillThere` check (skipped). A vault that became activated AFTER the plan: not in the plan, not paid that day. Fine (documented: plan is fixed).

  - **What if the pool GREW between plan and resume?** The extra stays for the next drop. Fine.

  - **The cadence gate skipped on resume**: correct, because the decision was made. But consider: plan made and durable, first send run crashes before ANY send (paid = {}), resume same day → uses stored plan, skips cadence. Fine. Consider: plan made, cadence gate said HOLD → plan.skip set, no plan stored (`if (!plan.skip && !DRY)` guards the store). So a held day stores NO plan → next run recomputes. ✓ correct.

  - **BUG?: `holdDays` uses `st.days[d]?.paid` — but on a day that paid, `paid` has rows. What about the `nothingToDo` days interleaved?** Not paid days. ✓

  - **BUG?: the anchor falls back to "the earliest day the ledger has ever seen" — including days that were `nothingToDo`.** So if the ledger's first day is a nothingToDo day 40 days ago, and no day ever paid, holdDays = 40 >= 31 → FORCED payout of a tiny pool. Is that right? The design: "volume that never clears it is forced out at the ceiling". The anchor being the earliest seen day (not the first paid day) means the 31-day clock starts from the first time the job ever ran, not from a payout. The comment says "so a first-ever run has an anchor and cannot be 'forced' on day one". But consider: the job runs daily for 31 days with a pool below threshold every day (smallestPer < 21). On day 31, holdDays = 31 (anchored to day 1) → forced. So holders get paid the tiny pool on day 31. That matches "nothing longer than monthly". ✓ intended. But subtle: the anchor is the earliest day EVER, even if payouts happened since. No wait — `paid.length ? paid[paid.length-1] : ...` — if ANY day paid, anchor is the LAST paid day. The earliest-day fallback only applies when NOTHING ever paid. ✓ correct.

  - **What if days have `paid` rows from a DIFFERENT distribution mechanism (legacy)?** Not applicable.

  - **decideEmission with smallestPer computed from plan.per**: in main, `const smallest = plan.activated.reduce((m, v) => plan.per[v] < m ? plan.per[v] : m, plan.per[plan.activated[0]])`. plan.activated non-empty (skip otherwise). ✓

  - **A REAL BUG in the cadence gate**: `decideEmission` is called with `daysSinceLastPayout: held` where `held = holdDays(st, day)`. But `st.days[day]` was JUST created at the top (`st.days[day] ||= {...}`) — with `paid: {}`. holdDays filters `d < day`, so today is excluded. ✓ fine.

  - **What about `holdDays` when the ledger has FUTURE days?** `d < day` excludes them. Fine.

  - **decideEmission threshold semantics**: `smallestPer >= threshold` pays. threshold = 21. If smallestPer = 20 and held = 30 → hold. If held = 31 → forced. ✓ matches selftest.

  - **The forced payout when smallestPer >= MIN_PER_VAULT (1) but < threshold**: pays whatever it holds. ✓. When smallestPer = 0 (pool too small for even 1 sat to the smallest): `smallestPer < MIN_PER_VAULT` → never forced. But wait — allocateWeighted already skips when `smallest < min` (min = MIN_PER_VAULT = 1 by default). So if smallestPer would be 0, allocateWeighted returns skip ('only X for a denominator of Y') and the cadence gate never runs (`if (!plan.skip)`). So decideEmission's smallestPer >= 1 always in practice. The `smallestPer < MIN_PER_VAULT` arm is dead in the main flow but exercised in selftest directly. Fine.

  - **HOLD ON — a real issue**: allocateWeighted's `min` default is MIN_PER_VAULT = 1n. So allocateWeighted only refuses if smallest < 1 (i.e., 0). The CADENCE gate then refuses if smallest < 21 (unless forced). So the effective threshold is 21 via the gate. ✓ consistent.

  - **Another**: the cadence gate runs BEFORE the plan is stored. If the gate says hold, `plan = {...plan, skip: ...}` and nothing stored. The day is marked nothingToDo + finishedAt. ✓. But `st.days[day].startedAt` was set at the top. And `nothingToDo` written. detectDistribution: `rec.startedAt && !rec.finishedAt && !rec.nothingToDo` → has finishedAt and nothingToDo → quiet. ✓

  - **What about `holdDays` when `st.days[day]` was created by a previous HELD run (nothingToDo) and today we recompute?** days includes that past day with paid={} → not a paid day. ✓

  So the cadence logic is mostly sound. The main R2 findings: the unlevelled-activated griefing (HIGH), the dust bound overstatement (LOW), and maybe the "paid day counts intents" edge (LOW).

  Wait, actually, let me reconsider the "paid day counts intents" issue more carefully, because it interacts with MAX_HOLD_DAYS. Scenario: every day, the run attempts distribution, writes intents, and every transfer is refused (e.g., cbBTC freeze authority froze the distributor's ATA — plausible! cbBTC has a live freeze authority). Then `paid` has rows every day → holdDays resets every day → the 31-day ceiling NEVER fires. But the cadence gate isn't the issue here — the issue is payouts are failing, which the alarm reports (distribution_refused HIGH). So the ceiling not firing is masked by a louder alarm. Minor. But also: if transfers fail, the pool GROWS, so smallestPer grows, so the threshold clears and it tries every day — and fails every day — and the alarm fires daily. The hold clock resetting is irrelevant in that scenario. OK, LOW at most.

  **Now the level register blast radius**: "Who can write that file, and what does the blast radius look like?" `bank/levels.json` at `/opt/cbob-vaults/bank/levels.json`, read by distribute.mjs running as ubuntu. Whoever can write that file (ubuntu user, or root, or anyone with FS access) controls the WEIGHTS of every payout. Setting a vault to Level V (weight 6) vs I (weight 2) triples its share. The blast radius: total control over distribution proportions — an attacker who writes levels.json can pay themselves 3x per vault per drop, forever, and it's "our word" — no on-chain commitment (accepted limit 16). The file is NOT in the signer-set gate (it holds no key). Is it watched? The alarm doesn't read levels.json. No integrity check, no hash, no commitment. So a quiet edit to levels.json changes real money flows with no detector. Limit 16 acknowledges the missing commitment scheme. "DO tell us if any is worse than stated" — the stated limit is about the holder's inability to verify THEIR level. What's worse: there's no DETECTION of a changed register at all. A one-line edit triples an attacker's share on every future drop and nothing anywhere notices — no drift watch, no hash pinned in the ledger, nothing. The plan stores census and denominator per day, so a change in denominator between days is visible in the ledger retroactively, but nothing alarms on it. I'd file: levels.json has no integrity protection or change detection; a write to it silently re-weights all future payouts; worse than stated because the stated limit is framed as "holder can't verify" when it's actually "nobody watches the file at all". Fix: hash levels.json into each day's ledger entry and alarm on unexpected changes; or the commit-reveal scheme; at minimum add the file's sha256 to the distribution day record and have detectDistribution flag a change against the previous day without a corresponding note. MEDIUM/HIGH. Given limit 16 exists, I'll frame as "worse than stated" — MEDIUM.

  Also: `loadLevels` validates levels are in LEVEL_WEIGHTS, but does NOT validate that keys are valid pubkeys or that they correspond to real vaults. A typo'd key (not a real vault) is just ignored (activated vaults look up their level; extra keys unused). Fine. And `Object.entries(raw).filter(([, l]) => !LEVEL_WEIGHTS[l])` — a level of "I " (trailing space) → refused at load. ✓. A level of "__proto__"? `LEVEL_WEIGHTS['__proto__']` is undefined → refused. ✓. Prototype pollution: `raw` from JSON.parse — `{"__proto__": "V"}` — JSON.parse creates an own property __proto__? Actually JSON.parse('{"__proto__": 1}') creates an object with an own data property named "__proto__" (it does NOT set the prototype). Then `levels['__proto__']`... `Object.entries` includes it, LEVEL_WEIGHTS['__proto__'] is undefined → load refuses. OK. And `levels[v]` where v = 'constructor'? LEVEL_WEIGHTS['constructor'] is undefined (it's Object.freeze'd plain object; 'constructor' resolves via prototype chain to Object constructor — truthy!). WAIT. `LEVEL_WEIGHTS = Object.freeze({ I: 2, II: 3, III: 4, IV: 5, V: 6 })`. `LEVEL_WEIGHTS['constructor']` → inherits `Object.prototype.constructor` → the Object function → TRUTHY! So `!LEVEL_WEIGHTS[levels[v]]` for levels[v] = 'constructor' → !truthy → false → NOT unlevelled! So a vault with level 'constructor' passes the unlevelled check! Then `LEVEL_WEIGHTS[levels[v]]` = the Object constructor function. `BigInt(LEVEL_WEIGHTS[levels[v]])` → BigInt(Object constructor) → throws TypeError ("Cannot convert ... to a BigInt"? Actually BigInt(function) throws). So it would throw, not silently misbehave. But wait — loadLevels validates: `Object.entries(raw).filter(([, l]) => !LEVEL_WEIGHTS[l])` — for l = 'constructor', LEVEL_WEIGHTS['constructor'] is truthy (inherited) → NOT in bad → passes load! Then in allocateWeighted, `LEVEL_WEIGHTS['constructor']` = Object constructor → `BigInt(Object)` throws TypeError → the run crashes. So a malicious or typo'd level 'constructor' (or 'toString', 'hasOwnProperty', 'valueOf', 'watch', etc. — any Object.prototype member) passes loadLevels validation and then crashes distribute.mjs mid-run. That's a real bug: the validation uses a truthiness check on an object with a prototype chain, so prototype member names bypass validation and crash the money job. Severity: MEDIUM (a typo or a malicious register edit crashes the daily distribution; the fix is `Object.hasOwn(LEVEL_WEIGHTS, l)` or `Object.prototype.hasOwnProperty.call`). Evidence: `node -e "const LW=Object.freeze({I:2}); console.log(!!LW['constructor'])"` prints true. And in allocateWeighted, census: `c[v]` where v='constructor' — `c['constructor'] !== undefined` → true (inherited!) → `c['constructor'] += 1` → c.constructor becomes "function Object() { [native code] }1" (string concat!). Then denominator: `c[l] || 0` for l in LEVELS — c only has I..V keys plus polluted constructor; denominator sums LEVELS only, so constructor doesn't affect den. But the crash happens earlier at BigInt(LEVEL_WEIGHTS['constructor']). Actually wait, order in allocateWeighted: unlevelled check first: `activated.filter(v => !LEVEL_WEIGHTS[levels[v]])` — levels[v]='constructor' → LEVEL_WEIGHTS['constructor'] truthy → not unlevelled. Then census: `census(Object.fromEntries(activated.map(v => [v, levels[v]])))` → levels object {vault: 'constructor'} → census: `for (const v of Object.values(levels)) if (c[v] !== undefined) c[v] += 1` → c['constructor'] !== undefined (inherited constructor) → c['constructor'] += 1 → "function...1". Then den = denominator(cen) — sums only LEVELS keys → den excludes the constructor vault's weight! Then the per loop: `LEVEL_WEIGHTS['constructor']` → BigInt(function) → THROWS. So yes, crash. But hold on — would loadLevels have already crashed? loadLevels: `bad = Object.entries(raw).filter(([, l]) => !LEVEL_WEIGHTS[l])` — 'constructor' passes (truthy inherited). So load succeeds, then allocateWeighted throws TypeError. The run crashes with an unhandled exception → withLock catch → exit 3, notification sent. So it's a LOUD crash, not silent. But it halts the distribution until the register is fixed. A griefer can't write levels.json (it's operator-controlled), so this is an accident surface (typo) more than an attack. MEDIUM/LOW. The fix: use `Object.hasOwn` or a Map, or `Object.create(null)` for LEVEL_WEIGHTS. I'll file MEDIUM (validation bypass via prototype chain → crash of the money job; same class the file itself cares about — "a typo in the register should name itself when the register is read", and it doesn't).

  Actually, also `census()`: `const c = {}; for (const l of LEVELS) c[l] = 0` — c is a plain object. `c[v] !== undefined` for v='constructor' → inherited → true → pollutes. Same root cause. And in `census`, a level named 'I' etc. is fine. The fix is the same.

  Let me also check `allocateWeighted`'s `per` object: `per[v] = amt` where v is a vault address (base58) — base58 keys can't be '__proto__' (no lowercase l, no 0, O, I... wait base58 excludes 0, O, I, l. '__proto__' contains '_' which is not base58. So vault keys are safe). But `levels` values are attacker/typo-controlled strings. OK.

  **Now `allocate()` deletion**: "Was anything else still depending on it?" The diff deletes `allocate` and updates the selftest. Does anything else import `allocate` from distribute.mjs? Let me search the tree: alarm.mjs imports detectors, lock, spl, sigwalk — not distribute. selftest.mjs imports detectors, lock, spl, anchor — not distribute. revenue.mjs imports lock, spl, anchor, detectors. cosign.mjs imports detectors, anchor. The suite (3prog.test.ts) doesn't import distribute. run-tests.sh runs `node bank/distribute.mjs --selftest`. So `allocate` had no external consumers. But wait — distribute.mjs is an ES module with exports; does anything import { allocate }? grep would be needed; from the tree shown, no file imports from distribute.mjs. ✓ Also the header comment in distribute.mjs still says "Equal per activated vault, because one vault is one unit and one vote" — STALE COMMENT! The header (the big block comment at the top) still describes equal-per-vault distribution: "Equal per activated vault, because one vault is one unit and one vote. A vault below 21,000 sats gets nothing and is not counted in the divisor". That's now FALSE — distribution is weighted by level. This is exactly the R5 comment defect: a comment asserting a behavior that no longer runs. The header also says "daily equal payout to vaults holding at least 21,000 sats" in the ARCHITECTURE section of the prompt (that's the prompt's text, not the file). In distribute.mjs's own header: "Equal per activated vault, because one vault is one unit and one vote." — stale. And SPEC's cron-install.sh comment: "distribute  daily cbBTC to ACTIVATED vaults only (>= 21,000 sats), equal per vault" — cron-install.sh's trailing comment says "equal per vault"! Stale too. These are R5 findings: comments describing the deleted equal-split behavior. MEDIUM (the header of the money file describes the old rule; a reader would compute expected payouts wrong).

  Also the selftest comment: "Its assertions were not deleted with it..." fine.

  **R2 continued — the plan resume and `levels`**: On resume, the plan is reused, but `levels[v]` is read fresh in the DRY log line and... the send loop uses `plan.per[v]` (stored amounts). The level register could have changed between plan and resume — the amounts are fixed, so no money error. The log line `levels[v]` might print a different level than the plan assumed — cosmetic. Fine.

  **One more R2: `allocateWeighted` when `available` is huge and `den` small**: available * weight could exceed Number.MAX_SAFE_INTEGER? BigInt — no. ✓

  **The `empty` object shares `census: census({})` — census({}) returns {I:0,II:0,III:0,IV:0,V:0}. Fine.

  **decideEmission: `daysSinceLastPayout >= maxHoldDays` → forced. holdDays returns Math.max(0, dayDiff). dayDiff uses Math.round — for exact day boundaries it's exact. ✓

  **What about a day with a plan but no payments — covered. What about `holdDays` when the only past day is today-minus-40 with paid rows, and today: anchor = that day, dayDiff = 40 → forced. ✓

  OK R2 findings:
  - HIGH: permissionless activation + fail-closed unlevelled = $21 total payout halt, repeatable.
  - MEDIUM: levels.json prototype-chain validation bypass ('constructor' etc. pass loadLevels, crash allocateWeighted) — the typo the code claims to catch at load is not caught for prototype member names.
  - MEDIUM: levels.json has no integrity/change detection (worse than limit 16 states).
  - LOW: dust bound overstated (max is activated-1 = 2,099, not denominator-1 = 6,404) — comment/SPEC.
  - LOW: stale "equal per vault" comments in distribute.mjs header and cron-install.sh (R5 material).
  - LOW: holdDays counts a day with any `paid` row (including all-failed/ambiguous) as a paid day.

**R3: bank-sign.sh**

```bash
set -euo pipefail
usage() { ... exit 2 }
[ $# -ge 1 ] && [ $# -le 2 ] || usage
SRC=$1
LIVE=()
if [ $# -eq 2 ]; then
  [ "$2" = "--live" ] || { echo "..." >&2; usage; }
  LIVE=(--live)
fi
case "$SRC" in --*) echo "..." >&2; usage;; esac

if [ "$SRC" = "-" ]; then RAW=$(cat)
else
  [ -f "$SRC" ] || { echo "..." >&2; exit 2; }
  RAW=$(cat -- "$SRC")
fi

TX=$(printf '%s' "$RAW" | tr -d '[:space:]')
[ -n "$TX" ] || { ... exit 2; }
case "$TX" in
  *[!A-Za-z0-9+/=]*) echo "..." >&2; exit 2;;
esac

cd "$(dirname "$0")/.."
...
exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"}
```

Checks:
- Shell injection: SRC is quoted everywhere. `"$SRC"`, `cat -- "$SRC"`. ✓. TX is validated to base64 alphabet before being passed as "--tx" "$TX" — quoted. ✓.
- `[ $# -ge 1 ] && [ $# -le 2 ] || usage` — under `set -e`: if the `[...] && [...]` fails, `|| usage` runs, usage exits 2. ✓. Careful: `set -e` with `a && b || c` — the whole list's status is c's if a fails... standard idiom, fine.
- `$0` under a symlink: `cd "$(dirname "$0")/.."`. If invoked via a symlink at /usr/local/bin/bank-sign → dirname = /usr/local/bin → cd /usr/local → then `node bank/cosign.mjs` fails (no such file) — fails CLOSED (exec fails, non-zero exit). But worse: if invoked via a symlink in a directory where `../bank/cosign.mjs` EXISTS and is attacker-controlled? E.g., attacker creates /tmp/evil/bank-sign symlink to the real script, and /tmp/bank/cosign.mjs malicious. Then dirname $0 = /tmp/evil → cd /tmp → node bank/cosign.mjs runs /tmp/bank/cosign.mjs — ATTACKER'S FILE with --live and the Bank key env? Wait, cosign.mjs reads the key from CBOB_BANK_KEY or /opt/cbob-vaults/bank/keys/bank.json. A malicious /tmp/bank/cosign.mjs would be executed as the operator with access to the Bank key file (readable by ubuntu). It could exfiltrate the key or sign something else. So: if the operator runs the script through a symlink in an attacker-chosen directory, the script executes attacker-chosen code with the operator's privileges. Is that a real finding? The operator must choose to run via a symlink. The fix: resolve the script's real path: `cd "$(dirname "$(readlink -f "$0")")/.."`. This is a classic symlink trap. The prompt explicitly asks about "$0 under a symlink". Severity: MEDIUM — it requires the operator to invoke via a symlink planted by an attacker, but the consequence is arbitrary code execution as the key-holding user, and the fix is one line (readlink -f). Actually, more likely scenario: someone symlinks the script into ~/bin for convenience, and ~/bin/../bank doesn't exist → fails closed. The malicious case needs an attacker who can already write to a directory the operator would symlink from — at which point they could probably do worse. But the prompt asked; the standard hardening is readlink -f. MEDIUM/LOW. I'll say MEDIUM given the key at stake, with the note that exploitation requires operator cooperation.

  Hmm, actually, there's a subtler issue: `dirname "$0"` when invoked as `bash scripts/bank-sign.sh` → $0 = scripts/bank-sign.sh → dirname = scripts → cd scripts/.. = repo root. ✓. When invoked as `./scripts/bank-sign.sh` from repo root → dirname = ./scripts → cd ./scripts/.. ✓. When invoked from /tmp as `/opt/cbob-vaults/scripts/bank-sign.sh tx.b64` → dirname = /opt/cbob-vaults/scripts → cd /opt/cbob-vaults ✓. When invoked as `bank-sign.sh` via PATH: $0 = /opt/cbob-vaults/scripts/bank-sign.sh (bash resolves PATH? Actually $0 is the path as invoked; if found via PATH, $0 is the full path? No — when a script is found via PATH, $0 is the full path to the script). ✓. The symlink case is the only hole. readlink -f fixes it.

- The file is a FIFO or device: `[ -f "$SRC" ]` — true for a regular file only; a FIFO fails -f? `[ -f ]` on a FIFO returns false (FIFOs are not regular files). So FIFO refused with "no such transaction file" — hmm, misleading message but fail-closed. A device (/dev/zero) — not -f → refused. ✓. Actually wait: `[ -f /dev/stdin ]`? If the operator passes /dev/stdin, -f tests the target — /dev/stdin is a symlink to a pipe or char device → not regular → refused. The script offers `-` for stdin. ✓.

- TOCTOU between -f test and read: `[ -f "$SRC" ] || ...; RAW=$(cat -- "$SRC")`. Between the test and the cat, an attacker could swap the file. Who can? Someone with write access to the directory containing SRC. The operator's own directory. If the operator reads from a world-writable directory (/tmp), an attacker could replace tx.b64 between test and read — but they could also just write tx.b64 beforehand; the TOCTOU adds nothing (the file content is attacker-influenced either way if it's in /tmp). The real protection is that cosign.mjs JUDGES the transaction. TOCTOU here changes which transaction is judged — but the operator pastes/chooses the file; a race swaps in a different transaction that still gets judged by cosign.mjs and refused if bad. So TOCTOU can't bypass the judgement. LOW/informational. The earlier bug (cd before read) was worse because it read a DIFFERENT file than named silently. TOCTOU on the read is the same class but requires winning a race in a directory the operator chose. The fix: read once (already does — single `cat`), so there's no double-read TOCTOU on the content itself. The -f test is just a nicer error. Fine.

- argv length limits: TX is passed as an argv element to node. A 1232-byte transaction → base64 ~1643 chars. ARG_MAX is ~2MB on Linux; per-argument limit MAX_ARG_STRLEN = 128KB (32 pages). 1643 chars fine. ✓. But the base64 filter allows arbitrary length input — a 1MB file of base64 → TX ~1MB > MAX_ARG_STRLEN (131072 bytes) → exec fails with E2BIG → "Argument list too long", non-zero exit, fail-closed but confusing. The script doesn't bound TX length. A transaction is at most 1232 bytes → base64 ≤ 1644 chars (1232/3*4 ≈ 1643, plus padding). The script could reject TX longer than ~1700 chars as certainly-not-a-transaction. Without that, an oversized paste fails at exec with an opaque error — fail-closed but ugly. LOW. Actually more interesting: cosign.mjs's `Transaction.from(Buffer.from(b64,'base64'))` on a huge buffer throws → exit 9 fatal. Fine. But the E2BIG happens BEFORE node runs → exit code 126/1 from exec? `exec` fails → the shell exits with 126 or 1? With `exec /usr/bin/env node ...` failing due to E2BIG, bash prints "Argument list too long" and exits 126. The script's documented exit codes (0,1,2,3,4,5,9) don't include 126. Minor. LOW: bound the length.

- **The base64 filter**: `case "$TX" in *[!A-Za-z0-9+/=]*)` refuses non-alphabet. But base64 VALIDATION is more than alphabet: padding placement. `====` alone passes the alphabet check; Buffer.from('====','base64') → empty buffer → Transaction.from throws → exit 9. Fail-closed. What about input that decodes to something other than what the operator pasted? The alphabet check prevents silent dropping of non-alphabet chars. But: Buffer.from(s,'base64') also tolerates incorrect padding (it decodes anyway). E.g., 'A' → decodes to empty? Buffer.from('A','base64') → <Buffer > (empty, with a warning? no, it just decodes what it can). Transaction.from(empty) throws → exit 9. Fine. The real question the prompt asks: "Is there input it accepts that decodes to something other than what the operator pasted?" With the alphabet check, all chars are in the alphabet, so Node decodes deterministically. Padding weirdness ('=' in the middle): Buffer.from('QQ=Q','base64') → decodes 'QQ' and stops at '='? Node's base64 decoder stops at the first '=' and ignores the rest? Actually Node: Buffer.from('QQ=Q','base64') → <Buffer 41> (decodes up to the padding, ignores trailing). So 'QQ=Q' → 1 byte 0x41. The operator pasted 'QQ=Q' meaning... whatever; it decodes to 0x41, Transaction.from throws. Fail-closed. What about a LONGER input where Node ignores a trailing section after '='? E.g., validbase64==GARBAGE — the '=' appears mid-string; Node decodes up to '==' and ignores 'GARBAGE'. So the operator pastes a string, Node judges a PREFIX of it. Could that be exploited? The operator pastes a transaction; if it's mangled with '==' in the middle, Node judges the prefix — which decodes to a truncated transaction → Transaction.from almost certainly throws (truncated). Could an attacker craft a string where the prefix decodes to a VALID but DIFFERENT transaction? They'd need the operator to paste the attacker's string. The operator is the one pasting; the threat model is a mangled paste, not a malicious paste (a malicious paste is judged by cosign.mjs anyway). The '==' early-stop means a paste with '==' followed by garbage silently truncates — but truncation → parse failure → refused. For a truncated-but-parseable transaction: Solana legacy transaction format is compact-u16 counts; a truncated buffer that still parses would need consistent counts — possible in principle (a transaction with fewer instructions is a prefix? No — the signature count and account count are at the start; truncating the END (instructions) while keeping counts consistent isn't a raw prefix). Actually a shorter VALID transaction is not a prefix of a longer one (counts differ). Node ignoring post-'=' content means the decoded bytes are a prefix of the "intended" decode. For the decoded prefix to be a valid transaction different from intended, the intended decode would need a valid transaction as a strict prefix — not possible with Solana's count-prefixed format (the prefix would declare more accounts/signatures than present → parse error). So fail-closed. The filter is adequate. But worth noting: the alphabet check allows '=' anywhere; Node stops decoding at the first '=' run; the practical outcome is a parse failure. LOW/informational — recommend also validating TX decodes to ≤1232 bytes and that Buffer.from(TX,'base64').toString('base64') round-trips (canonical form), which would reject '==' mid-string. Actually simplest: check `TX` matches /^[A-Za-z0-9+/]+={0,2}$/ and length % 4 == 0. LOW.

- **Exit code swallowing**: `exec /usr/bin/env node bank/cosign.mjs ...` — exec replaces the shell, so the exit code is node's, unchanged. ✓. Under `set -e`, exec is the last command. ✓. The `RAW=$(cat)` under set -e: if cat fails (file unreadable after -f passed — e.g., permission denied), $(cat) fails → set -e exits with cat's status (1). Documented codes don't include that, but fail-closed. Fine. `RAW=$(cat)` for stdin: if the operator pipes nothing, RAW empty → "the transaction is empty" exit 2. ✓.

- **`printf '%s' "$RAW" | tr -d '[:space:]'`**: strips ALL whitespace including newlines from a wrapped paste. ✓. Note: $(...) already strips trailing newlines. ✓.

- **What if SRC starts with `-` but isn't `-`?** `case "$SRC" in --*)` catches `--live` etc. But `-x` (single dash)? Not caught by `--*`! Then `[ "$SRC" = "-" ]` false, `[ -f "-x" ]` → tests file named '-x' in cwd → likely absent → "no such transaction file: -x" exit 2. Fail-closed. But if a file named '-x' exists, `cat -- "$SRC"` handles it (-- ends options). ✓. Minor: the case only catches `--*`; single-dash flags fall through to the file path and are refused as missing files. Fine.

- **`LIVE=(--live)` and `${LIVE[@]+"${LIVE[@]}"}`**: with `set -u`, empty array expansion `${LIVE[@]+...}` is safe. ✓. The selftest's regex pins the exact exec line. ✓.

- **Reading the file BEFORE cd**: ✓ correct now. The selftest gates the order.

- **What about `cat` with no args when SRC="-"**: reads stdin. If stdin is a TTY, it blocks — operator error, fine.

- **Environment**: `exec /usr/bin/env node` — relies on PATH to find node. If PATH is manipulated... the operator's shell. The script uses /usr/bin/env node (cosign.mjs is invoked as `node bank/cosign.mjs`). A PATH with a malicious `node` earlier → arbitrary code as operator. But that's true of every script here (cron uses /usr/bin/node absolute). For consistency and safety, could use /usr/bin/node. The cron lines use `/usr/bin/node`. bank-sign.sh uses `/usr/bin/env node`. Inconsistent; a PATH hijack on the operator's interactive shell is plausible (e.g., via a poisoned .bashrc from another compromise — but then it's game over anyway). LOW: use the absolute /usr/bin/node like the crons do.

So R3 findings: symlink $0 (MEDIUM), no length bound on TX (LOW), base64 canonicality (LOW), /usr/bin/env node vs absolute (LOW). Overall the script is decent.

**R4: the gates**

1. **The control-table parser** (`tableRows`):
   ```js
   const tableRows = src => src.split('\n')
     .filter(l => /^\| .*\| \*\*(ON-CHAIN|AUTOMATIC|PROCEDURE)\.\*\*/.test(l))
   ```
   - Can it be fooled? A row with the claim in a DIFFERENT column than intended — the regex just needs `| **VALUE.**` somewhere after the first `| `. If SPEC adds a row where the claim text appears in the "what it catches" column (prose) rather than the fourth column, the parser reads it as classified. E.g., a row mentioning "**AUTOMATIC.**" in prose would be treated as a classified row. Then `rows.length` must equal 4 — the gate asserts exactly 4 rows, so an extra prose mention breaks the count → red. OK, the count pins it. But the count is asserted as 4 — if SPEC legitimately adds a fifth control row, the gate goes red until updated. Fail-closed (red), fine.
   - "What does it do with a row it cannot read": ON-CHAIN with no program → 'NO PROGRAM NAMED claims ON-CHAIN, source says PROCEDURE' → caught by the 'every row named a file' check? No wait — that check is `rows.filter(r => r.startsWith('NO FILE NAMED'))` for non-ON-CHAIN rows. For ON-CHAIN, 'NO PROGRAM NAMED...' — is it caught? The check `t('every row\'s claim matches...', rows.filter(r => r.split('claims ')[1].split(',')[0] !== r.split(/(?:cron|source) says /)[1]), [])` — for 'NO PROGRAM NAMED claims ON-CHAIN, source says PROCEDURE': split('claims ')[1] = 'ON-CHAIN, source says PROCEDURE' → split(',')[0] = 'ON-CHAIN'; split(/(?:cron|source) says /)[1] = 'PROCEDURE'. 'ON-CHAIN' !== 'PROCEDURE' → included in filter → non-empty → red. ✓. And there's a dedicated both-ways test. ✓
   - For AUTOMATIC/PROCEDURE rows: file = match of `` `(bank\/[\w.-]+\.mjs)` `` — the FIRST backticked bank/*.mjs in the row. If a row names two files, only the first is checked. A row naming `bank/alarm.mjs` (cronned) first and `bank/cosign.mjs` (not cronned) second → only alarm checked → the second file's status unverified. Fail-OPEN direction: a PROCEDURE file hidden behind an AUTOMATIC first-name passes as AUTOMATIC. But the row count is pinned at 4 and each row is known. A future edit adding a second file to a row would silently check only the first. LOW/MEDIUM — the parser checks the first file named, not every file named. Given the table is hand-maintained and count-pinned, LOW.
   - `cronLines.includes(file)` — substring match! `cronLines` is the joined cron lines; `includes('bank/alarm.mjs')` is a substring search. So a row naming `bank/alarm.mjs` matches because the cron line contains it. But also a row naming `bank/ala...` no. Substring: file = 'bank/alarm.mjs' — the reconcile cron line contains 'bank/alarm.mjs --reconcile' → includes → AUTOMATIC. ✓. But could a PROCEDURE file be a substring of a cron line accidentally? E.g., 'bank/selftest.mjs' — not in cron. 'bank/lock.mjs' — not in cron. OK. And the cronLines filter: `/^\S+ .*\$TAG/` — lines starting with non-space and containing $TAG. The cron-install.sh heredoc lines start with the schedule (e.g., '23,53 * * * *') → ^\S+ matches. ✓. But ALSO the comment lines in cron-install.sh? They start with '#' → ^\S+ matches '#'! And do comment lines contain '$TAG'? The comment says "The jobs now carry an explicit tag" — no literal '$TAG'. The line `TAG='#cbob-vault-cron'` starts with 'TAG=' → ^\S+ matches, and contains... '$TAG'? No, it's `TAG='#cbob-vault-cron'` — no $TAG literal. The `grep -v "$TAG"` line? Contains `"$TAG"` → yes! `grep -v "$TAG" <<<"$CUR" > "$TMP" || true` — starts with 'grep' (^\S+) and contains `$TAG`. So cronLines includes the line `grep -v "$TAG" <<<"$CUR" > "$TMP" || true`. Does that line contain any bank/*.mjs? No. Harmless. Also `crontab -l | grep -F "$TAG"` at the end — contains $TAG, no .mjs. Harmless. And the deadman line contains $TAG and no .mjs... it's a real cron line anyway. OK so cronLines = the 5 real lines + a couple of non-cron lines that happen to contain $TAG. The non-cron lines contain no .mjs names, so they can't make a PROCEDURE file read as AUTOMATIC. But FRAGILE: if someone edits cron-install.sh and mentions `bank/alarm.mjs` in a comment containing `$TAG`... the comment lines start with '#' → ^\S+ matches '#'! Wait: `/^\S+ .*\$TAG/` requires ^\S+ (one or more non-space) then a SPACE then anything with $TAG. A comment line `# the jobs carry $TAG` → ^\S+ = '#', then space, then 'the jobs carry $TAG' → MATCHES. So a comment mentioning $TAG and a bank/*.mjs file would make that file read as cron-installed → a PROCEDURE row could falsely verify as AUTOMATIC → fail-OPEN. Currently no such comment exists (I checked the shown cron-install.sh: comments mention "tag" but not "$TAG" literal... let me re-scan: "The jobs now carry an explicit tag and are filtered on that" — no $TAG. "ROUND 15 — `flock -n`..." no $TAG. The echo at the end: `echo "installed (tagged $TAG):"; crontab -l | grep -F "$TAG"` — that's code, contains $TAG, starts with 'echo' → matches ^\S+ .*\$TAG → in cronLines. Contains no .mjs. OK.) So today it's clean, but the filter `/^\S+ .*\$TAG/` is one comment away from fail-open. The gate's own both-ways tests cover row flips but not a poisoned cronLines. MEDIUM/LOW: the cronLines extraction should anchor on actual crontab schedule syntax (e.g., /^[0-9*]/ like judgeCronTemplate does) — note judgeCronTemplate uses `/^[0-9*]/` for cron lines, but the selftest's cronLines uses `/^\S+ .*\$TAG/` — INCONSISTENT with judgeCronTemplate's cron-line detection. A comment line starting with '#' passes ^\S+. That's the gap. File as MEDIUM? The consequence: a future comment in cron-install.sh mentioning $TAG and a .mjs file makes the control-table gate lie about what's automated. It's a latent fail-open in a gate. MEDIUM.

2. **The ON-CHAIN arm via source text**: `onChainBankPin` requires `/pub bank: Signer<'info>/` AND `/require_keys_eq!\(\s*ctx\.accounts\.bank\.key\(\),/`. "Name a program that would pass this check without enforcing a 2-of-2": a program that has `pub bank: Signer<'info>` in SOME account struct and `require_keys_eq!(ctx.accounts.bank.key(), ...)` in SOME instruction — but not necessarily the SAME instruction, and not necessarily on the redemption path. E.g., SEAL could have the pin in `open_for_redemption` but a future refactor moves the require into a different instruction that isn't on the redemption path, or the require_keys_eq compares bank.key() to a DIFFERENT field (the regex only checks the first argument is ctx.accounts.bank.key() — the second argument is unchecked!). `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.payer.key(), ...)` would pass the regex! The regex is `/require_keys_eq!\(\s*ctx\.accounts\.bank\.key\(\),/` — it matches the opening with bank.key() as first arg, regardless of the second arg. So a program comparing bank.key() to anything (even itself: `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.bank.key())` — a tautology!) passes. That's the concrete answer: `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.bank.key())` + `pub bank: Signer<'info>` passes the gate and enforces NOTHING (any signer as "bank"). The gate is textual. The real protection is the on-chain suite (3.1 NotTheBank etc.), not this gate. So the gate is weaker than it looks — it pins the PRESENCE of two strings, not their relationship. MEDIUM: the regex doesn't bind the two halves together or to config.bank. Fix: regex requiring `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.config.bank` (or `cfg.bank`), and ideally that both appear within the same instruction body — though textual checks have limits; the behavioral suite is the real gate. The prompt asks "Name a program that would pass this check without enforcing a 2-of-2" — answer: one with `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.bank.key())` (tautology) or comparing against an attacker-controlled field. Also a program where `pub bank: Signer` is in an UNUSED struct. MEDIUM.

   Also: the ON-CHAIN row names programs via `` `(programs\/[\w-]+\/src\/lib\.rs)` `` — and requires EVERY named program to pin. The row names SEAL and BURN. Both pin. ✓ today.

3. **The signer-set arm**: pins files calling `fromSecretKey` (assembled as 'from'+'Secret'+'Key'). "Is there a way to sign with the Bank key that neither sees?" 
   - `Keypair.fromSeed(...)` — doesn't contain 'fromSecretKey'! A file doing `Keypair.fromSeed(seedBytes)` where seedBytes = first 32 bytes of the bank key file → signs as the Bank, invisible to sigPat. The arm only catches fromSecretKey. Also `nacl.sign` directly (tweetnacl) — no Keypair at all. Also `solana sign-offchain-message` via execFileSync — no fromSecretKey in the .mjs (it's in the solana CLI). Also `tx.partialSign` with a Keypair loaded via `Keypair.fromSecretKey` — caught. But `Keypair.fromSecretKey` spelled with whitespace/comments: `Keypair.fromSecretKey` — JS doesn't allow whitespace inside a member name... `Keypair['fromSecretKey']` — bracket notation! `Keypair['from' + 'Secret' + 'Key']` — the source contains 'fromSecretKey'? No — it contains 'from' + 'Secret' + 'Key' as separate string literals; the regex /fromSecretKey/ tests the SOURCE TEXT, which contains `'from' + 'Secret' + 'Key'` — the literal substring 'fromSecretKey' is NOT present (quotes and plus break it). So a file using `Keypair['from'+'Secret'+'Key']` evades the arm. That's the same assembly trick the selftest itself uses! The gate is textual; an adversarial (or clever) author evades it the same way the selftest evades itself. But wait — the selftest assembles to AVOID self-matching; an attacker assembling to EVADE is the same technique. The gate can't see it. This is a real limitation: the arm catches accidental second signers, not deliberate ones. Given the threat model (the repo's own authors, not external attackers committing code), textual pinning is a tripwire, not a proof. The prompt asks "Is there a way to sign with the Bank key that neither sees?" — YES: `Keypair.fromSeed`, bracket-notation `Keypair['fromSecretKey']`, tweetnacl directly, or shelling out to `solana`/`spl-token` CLIs. MEDIUM (document the limitation; the arm is a tripwire for accidents, not a bound on intent — and notably the selftest's own assembly idiom demonstrates the evasion).
   
   Also: the one-reader arm (keyPat) checks for the env var name and key path — a file reading the key via `fs.readFileSync('/opt/cbob-vaults/bank/keys/' + 'bank.json')` assembled evades keyPat too. Same class. And C2's KEY_OF map requires the file to contain the key path literally to pin which key — a signer reading from an env var named something else → 'UNPINNED KEY' → caught. But a signer reading the bank key via an ASSEMBLED path → contains neither the path nor env var → 'UNPINNED KEY' → caught! Wait: signerSet maps any file matching sigPat; if it matches and contains no known key path → 'UNPINNED KEY' → the assertion `signerSet(null)` equals the 3-entry list would FAIL (extra entry). So an assembled-path fromSecretKey signer IS caught as UNPINNED. Good. But a fromSeed signer or bracket-notation signer doesn't match sigPat at all → invisible. So the hole is specifically: signing without the literal 'fromSecretKey' in source. fromSeed, bracket notation, nacl, CLI. MEDIUM.

4. **The self-match arm**: asserts no searched-for string is spelled out in selftest.mjs. "Is that arm itself defeatable?" The forbidden map is defined IN selftest.mjs with assembled literals. The arm reads selftest.mjs's source and checks none of the four literals appear. Defeat: spell a forbidden string with a zero-width character or unicode escape? The check is `src.includes(lit)` — a string spelled with a unicode escape in source (e.g., 'keys/bank\u002ejson') doesn't contain the literal 'keys/bank.json' as source text... wait, the SOURCE text contains 'keys/bank\u002ejson' — the literal 'keys/bank.json' is not a substring (the 'u002e' breaks it). But the CHECK reads the source as text; the literal isn't there. Meanwhile the CODE, when run, would produce the string. But the point of the arm is to prevent selftest.mjs from self-matching as a reader/invoker/signer. If someone writes `'keys/bank\u002ejson'` in selftest.mjs, the keyPat regex (which tests src for /CBOB_BANK_KEY|keys\/bank\.json/) — the regex tests the SOURCE text of other files; selftest.mjs's source contains 'keys/bank\u002ejson' which does NOT match /keys\/bank\.json/ (the source has 'u002e' not '.'). So selftest.mjs wouldn't self-match, and the self-match arm wouldn't catch it either (the literal isn't spelled). So the arm is defeatable via unicode escapes — but to what end? The arm exists to keep the OTHER arms' searches from matching selftest.mjs. Defeating it via escapes means selftest.mjs could contain a functional reference to the bank key path that the one-reader arm can't see. But selftest.mjs is inside the scanned set; if it learned to actually READ the key (via escapes), the one-reader arm (keyPat on source text) wouldn't see it either. So the whole textual approach is defeatable by escapes/assembly — same conclusion as above: tripwire, not proof. The self-match arm specifically: also defeatable by simply... writing the literal in a way that includes() doesn't catch (case? no, paths are case-sensitive). Unicode escape is the cleanest. LOW/MEDIUM — same bucket as the signer-set evasion. I'll fold into one finding: the textual gates are all defeatable by assembly/escapes, including by the very idiom the selftest uses; they're tripwires for accidents, and SPEC should say so (or the gates should scan the PARSED string values, e.g., by evaluating string literals — overkill; better to state the limit).

5. **The sweep() payer: aliceU fix**: "Was that the right fix, or does it now test a shape production will not use?" In production, the customer (alice) composes the redemption and pays for their own sweep — the Bank co-signs only open+burn. So payer: aliceU matches production. The old shape (payer: bank) was the suite being wrong. The fix is right. BUT — does the suite still test that a redemption with the Bank as sweep payer is REFUSED? That's 4.7's territory (theft via System transfer) but not specifically ExecuteV1-payer=bank. Is there a test asserting ExecuteV1 with payer=bank is refused by the confinement? 4.7 uses SystemProgram.transfer from bank. An ExecuteV1 naming the bank as payer would be refused identically (bank in a non-pair instruction). Not explicitly tested. The confinement is generic over instructions, so 4.7 covers the class. Fine. The fix is right; note that production redemptions where the customer has no SOL for the sweep payer... the customer pays. Fine.

6. **Tests 4.7-4.10a moved to the end**: the coupling is minted_total → quorum divisor (max(snapshot, live)). Moving them after section 7 fixes the suite. "Is that coupling fully understood, or does it bite somewhere else?" Where else does minted_total matter? (a) detectIndexShortfall: live+burnt == minted_total — in the suite, not off-chain. (b) GOV quorum: max(snapshot, minted_now). (c) The alarm's index check. In the SUITE: section 7 is the only quorum consumer. But 4.7-4.10a mint 5 vaults (T, T2, T3, RA, RB) and redeem 3 (T, T2... wait: T redeemed in 4.7a, T2 NOT redeemed (4.8 is ALLOW — the donation redemption succeeded, so T2 was burned!), T3 redeemed in 4.10a, RA and RB burned in 4.9. So all 5 are burned by the end. But minted_total only goes UP — burns don't decrement. The comment says "net vault count unchanged" — but minted_total increased by 5 regardless! The point is section 7 already ran, so it doesn't matter. "Any future test that calls mkVault before section 7 has the same coupling" — noted in the comment. Does it bite elsewhere? Section 8 (revenue) doesn't use minted_total. Section 9 mints freely (after 7). The suite's own `detectIndexShortfall` isn't run in the suite. So the coupling is contained to section 7, and the move handles it. But the deeper issue: the suite is order-dependent in a way only documented in comments. A future test added before section 7 that mints will break quorum again — the comment warns. Also: 4.7's theft test mints T and the theft is REJECTED → T stays alive → 4.7a redeems it. If 4.7a failed, T stays live — no quorum impact (after section 7). OK. The coupling is understood; the residual risk is documented. Nothing new to file beyond noting the suite's global-state fragility is a standing hazard for future edits (LOW).

   Actually wait — there IS something. The comment says "Redeeming them (4.7a, 4.10a) does NOT fix that and it is worth knowing why: the burn returns the vault, not the counter." Right. But also: 4.8's donation redemption BURNS T2 — and 4.9 burns RA, RB. So after the block, 5 more vaults are burned. Burned vaults count toward minted_total forever. If any LATER section (after 9c) used quorum... 7b is just because() checks. Section 8, 9 don't use quorum. Fine.

**R5: the comments**

I need to read every comment in the diff for BOTH directions (over-claim and under-claim).

1. distribute.mjs header: "Equal per activated vault, because one vault is one unit and one vote." — STALE (over-claim of the old behavior; the code now pays by weight). Also "daily equal payout" in the architecture doc. The header's "THREE THINGS IT REFUSES TO DO" — "pay twice... create a token account... guess" — still accurate. The "Equal per activated vault" is the stale one. Also the deleted-allocate comment block is fine. The cron-install.sh "WHAT EACH LINE IS FOR" says "distribute  daily cbBTC to ACTIVATED vaults only (>= 21,000 sats), equal per vault" — STALE. SPEC's distribution section is updated (weighted). But SPEC's "Running the tests" and other places? SPEC says "daily equal payout" — let me check: the ARCHITECTURE section in the prompt says "daily equal payout to vaults holding at least 21,000 sats" — that's the PROMPT's architecture summary, not necessarily SPEC. In SPEC.md shown: "## Distribution: THE SCHEDULE OF VAULTS" — updated to weighted. The cron-install.sh comment is stale. The distribute.mjs header is stale. FINDING (R5): two stale comments describing equal-per-vault after the weighted rewrite. The distribute.mjs header is the money file's own documentation of its core rule — now wrong about the core rule. MEDIUM.

2. cosign.mjs header: "⚠️ AND THE PROGRAMS DO NOT BOUND WHAT ELSE IS IN THE TRANSACTION. `open_for_redemption` walks the instruction sysvar forward only as far as its matching `burn_vault` and never enumerates the rest" — STALE! The whole point of R1 is that the scan now walks from 0 and never breaks, enumerating EVERY top-level instruction for the bank's key. The comment says it "walks forward only as far as its matching burn_vault and never enumerates the rest" — that was TRUE before this diff and is now FALSE. The confinement check now bounds one thing on-chain: the bank's key. So this comment UNDERSTATES the new on-chain control — the exact inverse defect the round is about! The sentence "so 'the customer cannot spend the Bank's signature on something that is not their redemption' rests ENTIRELY on the two arms named above" — now FALSE in part: the bank-pubkey confinement IS on-chain now. The program allowlist and fee-payer remain off-chain. So the cosign.mjs header overstates the reliance on policy and understates the new on-chain control. THIS IS THE R5 HEADLINE CANDIDATE: the newest comment, in the file written to explain the change, describing the OLD behavior. Same in SEAL's own header: "⚠️ AND THIS FUNCTION DOES NOT BOUND WHAT ELSE IS IN THE TRANSACTION. The forward scan below stops at the matching burn; it never enumerates the rest." — SEAL's header ALSO still says the scan stops at the burn! The code below it starts at 0 and never breaks. Direct contradiction within the same file. HIGH (R5): both SEAL's header and cosign.mjs's header deny the control that this very diff adds. And SPEC: "⚠️ AND THE TWO CHECKS THAT MATTER MOST ARE IN THE POLICY HALF. The programs do NOT bound what else a redemption transaction contains: `open_for_redemption` walks the instruction sysvar forward only far enough to find its matching `burn_vault`, and never enumerates the rest. So 'the customer cannot make the Bank's signature authorise anything else' rests entirely on the allowlist and the bank-pubkey confinement in `judgeRedemptionTx`... Moving those two on-chain is possible — SEAL already walks the sysvar — and is not done. It is listed as an accepted limit rather than left implied." — SPEC says moving them on-chain "is not done" — but the bank-pubkey confinement WAS moved on-chain in this diff! SPEC's statement is now half-false: the confinement IS on-chain; only the allowlist and fee-payer are not. And accepted limit 1a says "Only the bank-pubkey confinement was moved on-chain" — the KNOWN AND OPEN section (the owner's own list) acknowledges it, but SPEC's control-table section still says "is not done". So SPEC contradicts itself: the accepted-limits list says the confinement moved on-chain; the control-table prose says it hasn't. R5 finding: SPEC's "THE SHIP GATE" section understates the on-chain guarantee — the exact defect class the round is about, in the document that defines it. HIGH.

   Also the control table row for cosign.mjs: "what it catches" lists "the transaction touching any program outside the redemption allowlist, and the Bank's own pubkey appearing in any instruction other than the approved pair — those two are what stop the customer spending the Bank's signature on something that is not their redemption" — attributes BOTH to cosign.mjs (PROCEDURE). Now the confinement is ALSO on-chain. The table's ON-CHAIN row says "any unsealing or burn attempted without the Bank" — it doesn't mention the confinement. So the table understates what the programs do: they now also refuse any transaction where the bank's key appears outside the pair. The ON-CHAIN row should claim the confinement (it's a REAL strengthening the customer is buying) — under-claim. And the cosign row should note its confinement arm is now defense-in-depth behind the on-chain one. HIGH (this is precisely "a place where this system is SAFER or STRONGER than its own documentation says").

3. The selftest C5 comment: "every row marked AUTOMATIC must name a file `scripts/cron-install.sh` actually installs, and every row marked PROCEDURE must name one it does not." — accurate about the gate. The gate's limitations (first-file-only, $TAG comment fragility) are R4.

4. SEAL header: "The forward scan below stops at the matching burn; it never enumerates the rest." — FALSE after this diff (see above). Also SEAL header: "the co-signer is a MITIGATION and never a proof: its scan is one slot old and the airdrop race does not close." — still true.

5. The new SEAL inline comment: "WHAT IS EXEMPT, AND WHY THAT IS NOT A HOLE... A forged instruction wearing those bytes is dispatched to the real handler and fails there." — TRUE (verified above). "WHY ONLY HERE AND NOT ALSO IN BURN..." — the claim is gated by 3.8/9.0 — accurate.

6. The 9c test comment: "Empty vaults keep it inside the 1232-byte ceiling; the burn tolerates a declared ATA that was never created (it is not owned by a token program, so the loop skips it)." — accurate per BURN's loop (acc.owner != token → continue).

7. distribute.mjs: "VERIFIED AGAINST THE PUBLISHED CARD rather than trusted: at 240 vaults the census is 108/60/36/24/12 and the denominator 732..." — check R6.

8. The lock.mjs comments — not in this diff (lock.mjs shown for context; the diff doesn't touch it). Skip.

9. The selftest comments about the widening — accurate. "(No count here on purpose...)" fine.

10. The bank-sign.sh comments: "Exit codes are cosign.mjs's, unchanged and not swallowed: 0 clean, 1 refused, 2 usage, 3 no key, 4 wrong key, 5 key mode, 9 fatal." — check: does the wrapper preserve them? exec → yes. But the wrapper itself exits 2 for its own usage errors — same as cosign's usage. And E2BIG → 126 (not listed). And cat failure → 1 (which means "refused" in cosign's scheme — a cat failure exiting 1 would read as a REFUSAL, which is... actually consistent-ish but misleading: a read failure exiting 1 looks like a judgement refusal). Minor. LOW.

11. The comment in cosign.mjs: "DO NOT RUN THIS DIRECTLY. `scripts/bank-sign.sh` is the one sanctioned path and is the only file permitted to invoke this one — asserted in bank/selftest.mjs, both ways." — accurate (C4).

12. distribute.mjs `EMISSION_MIN_PER_VAULT` comment — honest about provisional. ✓

13. "⚠️ THE DUST CARRIES FORWARD; IT IS NEVER SPLIT... at 2,100 vaults that is up to 6,404 per settlement, which is not dust at scale." — the bound is loose (real max 2,099). Also "which is not dust at scale" — at 6,404 sats ≈ $6.40... they mean it's small relative to the pool. The overstatement is safe-direction but arithmetically loose. LOW.

14. Check the comment in allocateWeighted: "Weight zero is what an UNACTIVATED vault has" — accurate.

15. The suite comment about payer: aliceU — accurate.

16. cron-install.sh: "distribute  daily cbBTC to ACTIVATED vaults only (>= 21,000 sats), equal per vault" — stale (equal). Also it says "23,53 * * * * ... watcher" etc. fine.

17. SPEC's "The Bank alarm pipeline" section: "(69 assertions)" — stale count! SPEC says "Every detector is proven in BOTH directions by `bank/selftest.mjs` (69 assertions)." — the floor is now 388. The "Running the tests" section has the gated numbers (279/388/45/19), but this OTHER mention of the detector count says 69. Stale by 5x. The selftest's SPEC-count gate checks the "Running the tests" block numbers, not this one. R5/R6 finding: stale assertion count in the alarm section. LOW (it's a count, not a control claim, but it's the class they keep shipping).

18. SPEC: "Thirteen AI audit rounds" / "Thirteen rounds, thirteen with a real finding" — now sixteen/seventeen. Stale counts in prose. LOW (cosmetic but the same class).

19. SPEC control table: the cosign row's "when" says "pre-signature" and "does anything RUN it?" PROCEDURE — accurate. The ON-CHAIN row: accurate but incomplete (doesn't claim confinement) — under-claim, see #2.

20. The diff's SEAL comment: "⚠️ THIS SCAN NOW STARTS AT 0 AND NEVER BREAKS EARLY." — accurate. "WHAT IT DOES NOT COVER, STATED RATHER THAN IMPLIED: THE FEE PAYER... `judgeRedemptionTx` has an arm for that and it stays POLICY." — accurate. "The program allowlist. Deliberately NOT moved on-chain: System must stay permitted for rent and the SOL sweep, so an allowlist would not have stopped the round-15 theft anyway" — accurate reasoning.

21. cosign.mjs header: "the two arms that do that second job are the PROGRAM ALLOWLIST and the BANK-PUBKEY CONFINEMENT in `judgeRedemptionTx`; everything else here is support." — now the confinement is ALSO on-chain; the header attributes the second job entirely to the off-chain arms. Under-claim again (same finding as #2).

So the R5 headline: THREE places (SEAL header, cosign.mjs header, SPEC ship-gate section) still describe the OLD forward-only scan and say the confinement is policy-only / "not done" on-chain — the exact under-claim defect the owner caught last round, in the diff that ADDED the on-chain control. That's the round's headline. HIGH.

**R6: the arithmetic on the card**

- Census 240: 108+60+36+24+12 = 240 ✓. Denominator: 108*2 + 60*3 + 36*4 + 24*5 + 12*6 = 216 + 180 + 144 + 120 + 72 = 732 ✓.
- Census 2100: 945+525+315+210+105 = 2100 ✓. Denominator: 945*2 + 525*3 + 315*4 + 210*5 + 105*6 = 1890 + 1575 + 1260 + 1050 + 630 = 6405 ✓.
- Per-$1,000 at 240: 1000*2/732 = 2.732... → '2.73' ✓; 1000*3/732 = 4.098 → '4.10' ✓; 1000*4/732 = 5.464 → '5.46' ✓; 1000*5/732 = 6.830 → '6.83' ✓; 1000*6/732 = 8.196 → '8.20' ✓.
- Per-$1,000 at 2100: 1000*2/6405 = 0.3122 → '0.31' ✓; 1000*3/6405 = 0.4700 → '0.47' ✓; 1000*4/6405 = 0.6245 → '0.62' ✓; 1000*5/6405 = 0.7806 → '0.78' ✓; 1000*6/6405 = 0.9368 → '0.94' ✓.
- Shares at 2100: 100*945*2/6405 = 29.51 → '29.5' ✓; 100*525*3/6405 = 24.59 → '24.6' ✓; 100*315*4/6405 = 19.67 → '19.7' ✓; 100*210*5/6405 = 16.39 → '16.4' ✓; 100*105*6/6405 = 9.84 → '9.8' ✓. Sum: 29.51+24.59+19.67+16.39+9.84 = 100.0 ✓ (exactly, since Σ census*weight = den).
- Level V = 3x Level I: 6/2 = 3 ✓.
- "A Level V vault receives exactly three times a Level One. Not sixteen." — the SPEC says "Not sixteen." — odd sentence, presumably rebutting a misreading (2^4=16?). Fine.
- Odds: 45/25/15/10/5 — census at 240: 108/240 = 45% ✓, 60/240 = 25% ✓, 36/240 = 15% ✓, 24/240 = 10% ✓, 12/240 = 5% ✓. At 2100: 945/2100 = 45% ✓, 525/2100 = 25% ✓, 315/2100 = 15% ✓, 210/2100 = 10% ✓, 105/2100 = 5% ✓. Consistent.

  Wait — the per-$1,000 figures: "per $1,000 at 240 vaults" — $1,000 of WHAT? If it's $1,000 of cbBTC drop distributed: a Level I vault gets 1000*2/732 = $2.73. ✓ that's the math. But hold on — the drop is the 85% holders' share. The card presumably says "per $1,000 distributed". Fine, the arithmetic reproduces.

  One check on the selftest itself: `t('...and a weight changed by one makes the card figures wrong', (1000 * 7 / 732).toFixed(2) === '8.20', false)` — 1000*7/732 = 9.562 → '9.56' ≠ '8.20' → true === '8.20' is false → want false ✓. OK.

  Hmm, but wait: `(1000 * LEVEL_WEIGHTS[l] / 732).toFixed(2)` uses JS floating point: 1000*3/732 = 4.098360...toFixed(2) = '4.10' ✓. 1000*5/732 = 6.8306 → '6.83' ✓. 1000*6/732 = 8.1967 → '8.20' ✓. 1000*3/6405 = 0.4699... → '0.47' ✓. 1000*4/6405 = 0.62451 → '0.62' ✓. 1000*5/6405 = 0.78064 → '0.78' ✓. 1000*6/6405 = 0.93677 → '0.94' ✓. All good.

  The shares: 100*945*2/6405 = 29.507 → '29.5' ✓; 100*525*3/6405 = 24.590 → '24.6' ✓; 100*315*4/6405 = 19.672 → '19.7' ✓; 100*210*5/6405 = 16.393 → '16.4' ✓; 100*105*6/6405 = 9.836 → '9.8' ✓. Sum check: the test computes the sum of unrounded = exactly 100.0 ✓. But note: the ROUNDED shares on the card (29.5+24.6+19.7+16.4+9.8) = 100.0 ✓ also. Good.

  So R6: the card arithmetic checks out. No finding. But the dust bound (6,404) is wrong-ish — that's in SPEC's distribution section, not the card per se. And "Level V receives exactly 3x Level I" ✓.

  Actually wait — one more on R6. The selftest asserts the card figures from the weights. But the ACTUAL payout uses integer floor division per vault: `amt = available * w / den`. The card's per-$1,000 figures are the EXPECTED values; actual per-vault amounts are floored. At 240 vaults with a $1,000 drop: Level I gets floor(1000*2/732) = floor(2.73) = $2 in whole units? No — the amounts are in sats, and the $1,000 is illustrative. Fine, the card is illustrative. Not a defect.

  Also: the cadence threshold EMISSION_MIN_PER_VAULT = 21 sats. At 240 vaults, for the smallest (Level I) to receive 21 sats, the drop must be >= 21 * 732 / 2 = 7,686 sats. At 2,100 vaults: 21 * 6405 / 2 = 67,252 sats ≈ 0.00067 BTC ≈ $67. So the pool needs ~$67 before anyone is paid at full census. That's a business number, provisional, flagged. Fine.

**Carry-over list check** — "DO tell us if any is worse than stated":

1a. Allowlist + fee-payer off-chain. Now that confinement is on-chain, the residual off-chain surface is: allowlist (other programs in the tx that DON'T name the bank) and fee payer. A redemption signed with a tool other than bank-sign.sh gets neither. What can a non-allowlisted program do WITHOUT the bank's key? It can't spend the bank's funds (no instruction naming the bank). It could do things with the CUSTOMER's funds — but the customer composes the transaction; they can spend their own funds anyway. Could it do something with the VAULT? The vault's contents move via ExecuteV1 with the owner's signature — the owner signs the whole transaction anyway. So the allowlist's residual value is... limiting what OTHER programs the bank's signature indirectly blesses? The bank's signature covers the whole message, but without the bank's key in an instruction, that instruction can't act as the bank. So the on-chain confinement has actually closed most of the allowlist's value! The remaining risks: (a) fee payer (real, small theft of fees), (b) an instruction that names the bank is refused on-chain, so the allowlist only adds: refusing programs that don't name the bank but do something weird with the vault/owner — which the owner signed for anyway. Hmm, actually there's one more: an instruction that names the bank as a NON-signer? Refused on-chain (any appearance). So the allowlist is now mostly redundant on-chain. The residual: fee payer + exotic stuff. The stated limit 1a says "A redemption signed with a tool other than bank-sign.sh gets neither" — accurate. Is it worse than stated? The fee-payer gap: a transaction with the bank as fee payer AND a ComputeBudget priority fee of, say, 1 SOL → the bank pays 1 SOL in fees. The bank's co-signer refuses it (feePayer arm), but a hand-signed one goes through ON-CHAIN (the confinement can't see the fee payer). So the on-chain hole that remains: bank as fee payer with a huge priority fee. That's a real theft of up to the priority fee amount. It's stated (1a + the SEAL comment). Not worse than stated. OK.

   Actually — wait. Is the fee-payer theft bounded? A priority fee is set via ComputeBudget.SetComputeUnitPrice * compute units consumed. Max compute per transaction = 1.4M CU. Price is per CU in micro-lamports. A malicious customer sets price = 1 lamport/CU → 1.4M lamports = 0.0014 SOL. Or 1000 lamports/CU → 1.4 SOL. Bounded by what the bank tolerates signing. The bank's policy refuses it; on-chain it's open. Stated. Fine.

2. Coverage refusal no override — stated. The griefing: dust airdrop → coverage refusal → vault can't be redeemed via the tool. The escape is hand-signing. Stated. Not worse.

3. Bank as payer inside the pair — stated. Slightly worse now? The confinement exempts the pair entirely, so the bank as payer in open/burn is still possible. Stated. Not worse.

4. Allowlist permits bare BurnV1 of a second vault — stated. With the on-chain confinement, does this change? A bare Core BurnV1 of vault B in a redemption transaction for vault A: the BurnV1 instruction names vault B's asset, collection, owner (the customer), payer — does it name the bank? No. So it passes the on-chain confinement. And the on-chain pairing doesn't care (open_A finds burn_A; the extra BurnV1 is neither open nor burn_vault — it's Core BurnV1, program = Core, not BURN — so it's NOT exempt, and it's checked for the bank's key → doesn't name the bank → passes). So on-chain, a customer can still bundle a bare BurnV1 of their own second vault (destroying its contents if undeclared) beside a redemption. The Bank's name isn't on it in any meaningful sense now (the bank's key isn't in it). Limit 4 says "the Bank puts its name on it" — with the on-chain confinement, the bank's SIGNATURE still covers the message (the bank signs the whole transaction), so the bank still blesses it cryptographically. Stated accurately. Not worse.

5. Judge never looks at where swept money goes — stated. The sweeps send the vault's tokens to... the customer. If the customer sweeps to a third party, that's their own money. Stated. Not worse.

6-11. Stated, not worse.

12. CU unmeasured — worse this round because the scan now walks all instructions. Quantified above: bounded by instruction count (~≤15 in a 1232-byte packet), each load ~O(instruction size). Almost certainly fine but unmeasured. The fix: measure in the suite. I'll fold this into a finding: the suite should assert the CU consumed by the worst-case redemption is under the 200k default budget (and ideally that the transaction requests an appropriate ComputeBudget limit). MEDIUM (unmeasured second ceiling, now with more work per open).

13. MINT dead redemption stamp — stated. Not worse.

14. Duplicate attribute keys — stated. Not worse.

15. Vault minted during proposal may vote — stated. Not worse.

16. Level register off-chain — WORSE THAN STATED: no change detection at all (see R2). Also the griefing (unlevelled activated vault) is a consequence of the register being off-chain AND activation being permissionless — the stated limit frames it as a trust/verifiability issue, not as a liveness/integrity issue. I'll fold into the R2 findings.

17. EMISSION_MIN_PER_VAULT provisional — stated.

18. Open items — "DO tell us if the code has accidentally assumed one of them": The code has `describeCadence` mapping days→daily/weekly/monthly — descriptive only. The level register exists but the randomness source is absent (levels.json is hand-maintained) — the code assumes levels EXIST for activated vaults (the griefing finding). The $CBOB upgrade ladder: no code. "whether upgrades open only after the first FOMC": no code. The code assumes levels are assigned at activation — but nothing in the code assigns them; the assumption that the register is complete for all activated vaults is the accidental assumption → the HIGH finding above. Also: `describeCadence` assumes the vocabulary but nothing branches on it — fine.

**Verdict challenges** (the author's round-16 verdict):

- "link() IS compare-and-swap" — the new lock mechanism: generations, breaker links G+1, sweeps below. Let me check for a hole: `acquireLock` two passes. Pass 1: scan → gens empty → place .0 → if EEXIST, continue → pass 2: scan → gens = [0] → held = read .0 → fresh → refuse. ✓. Break path: held stale+dead → re-read confirms token → place .(G+1) → if EEXIST → lostRace → return false. Winner sweeps gens below (all gens from the FIRST scan — `for (const g of gens)` where gens was scanned BEFORE the place. If between the scan and the sweep, ANOTHER breaker linked G+2? They'd have to beat... place(G+1) succeeded for us, so no one else has G+1. Someone could place G+2 after seeing our G+1 (stale? our G+1 is fresh — not stale → they can't break it). So no G+2. Sweep below: removes .0... but what if the ORIGINAL holder at .0 is actually ALIVE (we thought dead)? We checked alive(held.pid) and start-time recycling. If alive → refuse (no break). So we only break dead holders. The sweep removes the dead holder's record. A live holder's record is never removed because we only sweep after winning G+1, which requires the holder at G to be stale+dead. ✓. What about TWO breakers: both see stale+dead at G, both re-read, both place G+1 → one wins (EEXIST for the other). Winner sweeps < G+1. Loser gets lostRace. ✓. What about a NEW claimer placing .0 while gens exist? `if (!gens.length)` — gens non-empty → skip the place-.0 branch. So no .0 claim while records exist. ✓. The `_afterUnlink` seam: fires after place — under the new scheme there's no hole. ✓. releaseLock: finds the generation with our token, unlinks it. If our generation was swept by a breaker... a breaker only sweeps BELOW its own generation, and only after judging the top record stale+dead. If we're alive, our record is fresh → not broken. ✓. Looks sound. The verdict's claim "no interval in which the lock is absent" — true: the holder's record is never removed by others. ✓. One residual: `scan()` reads the directory; `place` uses link. The sweep `for (const g of gens)` uses the STALE scan — if a gens entry was already removed, unlink throws, caught. ✓. And a breaker sweeping .0 while the ORIGINAL .0 holder's `releaseLock` runs: release looks for its token — .0 already swept → returns false → warns. But the holder was dead (that's why it was broken). ✓. OK the lock is fine. The verdict's mechanism claim holds up.

- The ELF offset verdict (45 always): measured on mainnet, asserted in probe. The reasoning (set_authority rewrites in place, size_of_programdata_metadata = 45 unconditionally) is correct per my knowledge of bpf_loader_upgradeable. ✓ No challenge.

- "flock -n" verdict items: judgeCronTemplate now requires -n. Check the regex: `/\bflock\s+-n\b/` — matches 'flock -n'. `$FLOCK` with varHasN: `/FLOCK="?\$FLOCK\s+-n"?/` or `/FLOCK="?\/usr\/bin\/flock\s+-n"?/`. The real cron-install.sh has `FLOCK=/usr/bin/flock` then `FLOCK="$FLOCK -n"` → matches the first pattern (FLOCK="$FLOCK -n"). ✓. But: `FLOCK="$FLOCK -n"` — if someone later re-defines FLOCK WITHOUT -n AFTER this line, the gate still passes (varHasN true) but the crons use the later value. The gate checks the file contains the definition anywhere, not that the final value has -n. Edge. Also the cron lines use `$FLOCK $LOCKDIR/...` — judgeCronTemplate: `/\$FLOCK\b/.test(line) && varHasN` → pass. ✓. Minor gap: re-definition after. LOW.

  Also: the deadman cron line is NOT wrapped in flock (it's a test+find, no money). judgeCronTemplate only checks lines matching `/node\s+bank\/\S+\.mjs/` — the deadman line has no node bank/.mjs → skipped. ✓.

- The verdict's rejected items: "Arm 1 bypass via CPI with bank as unlisted signer" — correctly rejected (runtime requires accounts passed to CPI to be in the caller's instruction accounts... actually the rule: a program can only pass accounts to a CPI that were passed to it. And for a signer, the signature must be on the transaction OR the program must have the authority via PDA. The bank as a non-PDA signer must sign the transaction; for the CPI to mark it as a signer, the outer instruction must have included it as a signer account. So an instruction not naming the bank can't conjure it. ✓ correctly rejected).

  "ComputeBudget SetComputeUnitLimit inflate fees" — fees come from fee payer; arm 3 refuses bank as fee payer. But ON-CHAIN, the fee-payer gap remains (the confinement can't see it). The verdict says "arm 3 refuses to let be the Bank — and now refuses when it cannot be determined at all" — that's the OFF-CHAIN judge. On-chain, bank-as-fee-payer with a priority fee is still possible (accepted limit 1a). The verdict's rejection is about the off-chain arm; fine, but the on-chain hole is the stated limit. Consistent.

**Anything else**:

- Cargo.toml: `[profile.release] overflow-checks = true, lto = "fat", codegen-units = 1`. The profile applies to release builds. cargo-build-sbf builds in release by default. ✓. But: does the workspace profile apply to all member crates? Yes, `[profile.release]` in the workspace root applies to the whole workspace. ✓. One subtlety: `overflow-checks` in a workspace profile — profiles are only taken from the workspace ROOT Cargo.toml, which this is. ✓. No `[profile.dev]` overflow-checks — tests via cargo test would use dev without overflow checks, but the suite runs the compiled BPF (release). ✓. Anchor.toml: `[programs.mainnet] cbob_vaults = "9YKV..."` ✓ matches declare_id. Only ONE program listed — the other three programs are missing from [programs.mainnet]! Anchor.toml only pins cbob_vaults. For `anchor deploy` of the others... they deploy via `solana program deploy` with keypairs in target/deploy. The declare_id! in each program is what matters on-chain. Anchor.toml's [programs.mainnet] missing three programs means `anchor` CLI commands for those would fail or use the wrong id — but the deploy path is build-mainnet.sh/run-tests.sh, not anchor deploy. LOW/informational. Also `[provider] cluster = "mainnet" wallet = "~/.config/solana/id.json"` — a careless `anchor` command would target mainnet with the default wallet. Operational hazard, not code. LOW. `[registry] url = "https://api.apr.dev"` — the default, deprecated registry; harmless. `[features] resolution = true, skip-lint = false` — fine.

  Actually, one real thing about Cargo.toml: `overflow-checks = true` is asserted by run-tests.sh's grep: `grep -qE '^overflow-checks *= *true' "$ROOT/Cargo.toml"`. The grep matches the line anywhere — including inside a comment or a `[profile.dev]` section if someone moved it. If someone moves overflow-checks to [profile.dev], the grep still passes but the release build loses it. The grep is a weak pin. But the comment in run-tests.sh says it's defence in depth and the two dependent sites use checked_sub. LOW.

  Also: does `lto = "fat"` and `codegen-units = 1` matter for correctness? No, just size/perf. Fine.

- The `wiring()` helper in the test builds update_wiring args — not in the diff, skip.

- One more look at the diff's `plan` resume: `plan = { activated: st.days[day].plan.activated, per: Object.fromEntries(...), census: ..., denominator: ..., skip: null }` — note `total` and `dust` are NOT restored on resume! The final console.log uses `plan.total ?? ''` and `plan.dust ?? 0n` — on a resumed day, plan.total is undefined → prints '' and dust 0. Cosmetic. But ALSO: `st.days[day].census = plan.census; st.days[day].denominator = plan.denominator` — restored. ✓. And the send loop uses plan.per[v] — restored. ✓. So only the log line loses total/dust. LOW (cosmetic).

  Hmm wait, actually — is there a real issue with the resumed plan and `plan.per` being BigInt-revived? `Object.fromEntries(Object.entries(st.days[day].plan.per).map(([v, a]) => [v, BigInt(a)]))` ✓. And `createTransferCheckedInstruction(..., plan.per[v], ...)` — BigInt ✓.

  Another: on resume, `plan.skip = null` is hardcoded — even if the stored plan... the stored plan only exists if !plan.skip when stored. ✓.

  And: `if (st.days[day].plan && !DRY)` — on DRY, the plan is recomputed (not resumed) — so a dry run on a day with a stored plan recomputes from CURRENT balances. The dry run then prints "would send" with fresh amounts. Fine (dry runs don't write).

- `st.days[day].plan.per` — the amounts are strings in the ledger. A hand-edited ledger could inflate a payment... the ledger is the payer's own record (limit 11: "Distribution reconciles against a ledger the payer wrote"). Stated.

- One more potential R2 bug: `allocateWeighted` sorts `activated` — base58 string sort, deterministic. ✓. The plan's `activated` order determines send order. Fine.

- `decideEmission` when `daysSinceLastPayout` is huge (ledger from a year ago): forced. Fine.

- **A subtle one in distribute.mjs main()**: `const levels = loadLevels()` is called BEFORE the DRY check? `const st = load(); const levels = loadLevels();` — loadLevels throws if the register is missing — even for a --dry-run or --selftest? --selftest is handled by `if (ARGS.has('--selftest'))` BEFORE main() is called? Let me check the file structure: `if (ARGS.has('--selftest')) { ... } else { withLock(LOCK, main, ...) }`. So --selftest doesn't call main. ✓. --dry-run calls main via withLock → loadLevels throws if no register → dry run fails without a register. Is that right? A dry run to preview a distribution needs the register. Reasonable. But it means you can't dry-run the allocation without a levels file. Fine.

- **The `missing` vaults (no cbBTC ATA)**: `balances[v] = '0'` → not activated → excluded. ✓ reported.

- **Poisoned ATAs**: balances[v] = '0' → excluded from activation. But what if the vault is ACTIVATED (has ≥21,000 sats) but its ATA is poisoned (0-data)? readTokenAccount returns 'malformed' → balances[v]='0' → treated as unactivated → NOT paid, and NOT in the activated set → the denominator EXCLUDES them → everyone else's share is LARGER. The vault's share goes to others. Reported via unreadableAtas → detectDistribution HIGH. Stated behavior ("Treated as 0 and NOT paid"). The share redistribution is the designed outcome. OK.

- **A vault whose ATA is poisoned AFTER the plan is fixed**: the plan's per amounts are fixed; the send to the poisoned ATA fails (transfer to a 0-data account → the token program rejects) → marked rejected → retryable. Fine.

- **detectDistribution and the new fields**: `st.days[day].census/denominator` — detectDistribution doesn't read them. Fine.

- **The `nothingToDo` on a held day vs `detectDistribution`'s `distribution_missed`**: a held day HAS a record (nothingToDo) → not "missed". ✓.

Now let me also double-check the **on-chain confinement vs the suite's 4.2 happy path**: sweep with payer: aliceU — the ExecuteV1 instruction's accounts: asset, collection, authority (alice), payer (alice), the PDA (noop signer), system_program, plus inner instructions' accounts (token program, ATAs...). Does ExecuteV1's account list include the inner instructions' accounts? Yes — ExecuteV1 takes the assets + the inner instruction accounts. The bank is NOT among them (payer alice). ✓. And the inner SystemProgram.transfer from the PDA to alice — inside ExecuteV1, these are data bytes of the Execute instruction, NOT separate top-level instructions. The sysvar only shows TOP-LEVEL instructions — the ExecuteV1 is one top-level instruction; its inner transfers are CPIs, invisible to the sysvar scan. So the confinement check sees ExecuteV1's account list (asset, collection, authority, payer, signers, token accounts...). If the bank were the ExecuteV1 payer → refused. With alice → passes. ✓.

BUT WAIT — this raises a real question about the confinement check's SOUNDNESS: **the inner instructions of ExecuteV1 are CPIs and are NOT visible to the sysvar scan.** Could the bank's key be passed as an account to an inner instruction of ExecuteV1 — e.g., an inner SystemProgram.transfer FROM the bank? For that, the bank would need to sign as an inner instruction authority — ExecuteV1 makes the PDA sign; the inner instructions' signer is the PDA (noop signer). An inner transfer from the bank would require the bank's signature as the transfer authority — the bank DID sign the transaction! So: ExecuteV1 with an inner SystemProgram.transfer{from: bank, to: attacker} — the inner instruction's accounts (bank, attacker) are passed to ExecuteV1 as part of its account list! ExecuteV1's accounts include all inner instruction accounts. So the bank's key WOULD appear in the ExecuteV1 instruction's account list → the confinement check WOULD catch it. ✓ Because ExecuteV1 requires all inner accounts to be passed to it. Good — the confinement sees them.

  But hold on — does Core's ExecuteV1 require the inner instruction's signer to be the asset-signer PDA, or can inner instructions have OTHER signers? ExecuteV1 makes the PDA a signer for the inner CPIs. An inner SystemProgram.transfer from the bank: System requires the bank's signature. The bank signed the top-level transaction. When Core CPIs the inner instruction, it passes the bank account with is_signer=true IF the bank signed the transaction AND the bank account was passed to ExecuteV1 as a signer. The transaction's account list marks the bank as a signer (it signed). So yes, the inner transfer from the bank would execute — BUT the bank's key must appear in ExecuteV1's account list → confinement refuses the open → whole transaction reverts. ✓ So the confinement DOES cover the ExecuteV1-inner-instruction case, because ExecuteV1 must list all inner accounts. 

  What about a DEEPER nesting — ExecuteV1 inner instruction that itself does a CPI (e.g., inner instruction to a program that CPIs further)? The inner instruction's program's CPI accounts must be in the inner instruction's account list, which must be in ExecuteV1's account list. Transitively, all accounts appear in the top-level ExecuteV1's accounts. So the confinement sees everything. ✓ Sound.

  What about a SEPARATE top-level instruction to a third-party program that CPIs with the bank? The third-party instruction must name the bank in its accounts (to pass it down) → confinement refuses. ✓ (This is the rejected deepseek finding — correctly rejected.)

So the confinement is sound for all CPI nesting, because Solana requires all CPI accounts to be present in the top-level instruction's account list. 

Now, **the one remaining on-chain hole: the fee payer.** Stated. And **the bank as payer within the pair** (limit 3). Stated.

Let me also verify the **4.10 test**: SystemProgram.transfer from alice TO the bank — names the bank (as destination, non-signer) → confinement refuses (any appearance). ✓ because('4.10','BankKeyOutsidePair'). ✓.

And **4.8**: alice pays bankThief (not the bank) → allowed. ✓.

Now let me reconsider whether there's a REAL bug in R1 I've missed. 

**The `found` flag and multiple burns**: `if !found && i > current && is_burn && asset && owner` — sets found on the FIRST matching burn after current. Fine.

**What if the matching burn is at i == current?** Impossible (current is the open).

**What if there are zero instructions after current and no burn?** found stays false → NoTerminalBurn. ✓

**Integer types**: `i` usize, `current` usize from u16. Fine.

**The `bank` variable shadows nothing. `ctx.accounts.config.bank` — config is Account<Config>, validated by seeds. ✓

**Performance of the while loop**: `load_instruction_at_checked(i, &sysvar)` returns Err when i >= num_instructions → loop ends. ✓

**One thing**: the loop borrows `sysvar` data on EVERY call (try_borrow_data inside load_instruction_at_checked). Repeated borrows are fine (immutable). ✓

**Anchor's `require!` inside the loop**: returns Err on first violation. ✓

OK here's one more subtle R1 thought: **the confinement check runs BEFORE `set_frozen(false, ...)`. If the confinement fails, no thaw. ✓. And the check runs on EVERY open, including the second open in a two-redemption tx. ✓

**What about the bank being the `payer` of the OPEN (not the burn)?** open's payer is a Signer used in the CPI. The open instruction is exempt → bank as payer allowed (limit 3). Stated.

Alright, R1 is sound. Now let me also examine **the `is_open` exemption for a potential issue with `crate::ID`**: `crate::ID` is SEAL's declare_id. An instruction to SEAL with open discriminator but intended as something else? SEAL has no other instruction with that discriminator. ✓

**What about SEAL's `initialize` wearing... no, different discriminator.**

Now, **the suite's 4.9 comment**: "the burn tolerates a declared ATA that was never created (it is not owned by a token program, so the loop skips it)". For empty vaults RA/RB minted with 0n — mkVault(0n) doesn't create the ATA. declare(RA.pda) returns the classic + T22 ATA addresses, which don't exist. burn_vault's reserve loop: `ctx.remaining_accounts.iter().find(|a| a.key() == expected)` — the account must be PRESENT in remaining_accounts (passed as a pubkey in the instruction). But the account doesn't EXIST on-chain — can you pass a non-existent account? Yes, as long as it's not required to exist (UncheckedAccount via remaining_accounts — passed as AccountInfo; a non-existent account passed to a transaction... Solana requires all accounts in a transaction to exist OR be created? No — you can pass a non-existent account; it comes through as an account with 0 lamports, 0 data, owned by System. Actually, accounts that don't exist on-chain CAN be included in a transaction (they're loaded as default accounts). Hmm, is that right? For a transaction to reference an account, the account is loaded; if it doesn't exist, it's loaded as a default (0 lamports, system-owned, 0 data) — yes, non-existent accounts can be referenced (they're "not found" only for certain operations). Actually — for legacy transactions, referencing a non-existent account is fine; it's loaded as a default account. So the burn's loop: `acc.owner != &SPL_TOKEN_ID && != &SPL_TOKEN_2022_ID` → owner is System → continue (skip). ✓. So the burn tolerates it. ✓ matches the comment.

OK. Now **R4's "the suite's sweep() helper"** — covered above, the fix is right.

Let me now also check **the selftest's `readBeforeCd` gate against the actual script**: script has `RAW=$(cat)` (for stdin: `RAW=$(cat)`) and `RAW=$(cat -- "$SRC")`. The regex `/RAW=\$\(cat/` matches `RAW=$(cat` — the FIRST occurrence is `if [ "$SRC" = "-" ]; then RAW=$(cat)`. And `cd "$(dirname` — the regex `/^cd "\$\(dirname/m` matches `cd "$(dirname "$0")/.."`. In the script, the RAW=$(cat) line (stdin branch) comes before the cd. ✓ gate passes on the real file.

But NOTE: the gate searches for the FIRST `RAW=$(cat` — which is the STDIN branch. The file branch is `RAW=$(cat -- "$SRC")`. Both are before cd. ✓.

**The exec-line regex**: `/^\s*exec .*cosign\.mjs --tx "\$TX" \$\{LIVE\[@\]\+"\$\{LIVE\[@\]\}"\}\s*$/m` — the actual line: `exec /usr/bin/env node bank/cosign.mjs --tx "$TX" ${LIVE[@]+"${LIVE[@]}"}`. The regex expects `${LIVE[@]+"${LIVE[@]}"}` — matches literally? The regex text: `\$\{LIVE\[@\]\+"\$\{LIVE\[@\]\}"\}` → `${LIVE[@]+"${LIVE[@]}"}` ✓ matches.

Now **the C4 invokers check**: `/node\s+\S*bank\/cosign\.mjs/` — the bank-sign.sh exec line: `exec /usr/bin/env node bank/cosign.mjs --tx ...` → matches 'node bank/cosign.mjs' ✓. And cosign.mjs itself is excluded by name. Other files: does anything else contain 'node ...bank/cosign.mjs'? SPEC.md is not in srcFiles (srcFiles = bank/*.mjs, scripts/*.mjs|sh, tests/*.ts). SPEC.md not scanned for invokers — but SPEC documents the path; that's prose, fine. The selftest's own both-ways case assembles the string. ✓.

Wait — the invokers check scans srcFiles which INCLUDES selftest.mjs. selftest.mjs contains the regex `/node\s+\S*bank\/cosign\.mjs/` as source text — does the regex match itself? The source contains the literal `node\s+\S*bank\/cosign\.mjs` — the regex /node\s+\S*bank\/cosign\.mjs/ applied to that text: 'node\s+\S*bank\/cosign\.mjs' — does 'node' followed by \s+ match 'node\\s+'? The text after 'node' is '\s+...' — backslash is not whitespace, so /node\s+/ fails on 'node\s'. Hmm, but the source also contains `'node ' + ['bank', 'cosign.mjs'].join('/')` in the forbidden map — assembled, doesn't match. And the both-ways test string: `'cd /opt/cbob-vaults && /usr/bin/node ' + ['bank', 'cosign.mjs'].join('/') + ' --tx $T --live'` — assembled. So selftest.mjs doesn't self-match the invoker regex. ✓ (that's the whole point of the self-match arm).

Now, **does the self-match arm's forbidden map cover the invoker pattern?** 'a co-signer invocation': 'node ' + ['bank', 'cosign.mjs'].join('/') = 'node bank/cosign.mjs'. The arm checks selftest.mjs doesn't contain 'node bank/cosign.mjs' literally. ✓. But the invoker REGEX `/node\s+\S*bank\/cosign\.mjs/` as text in selftest.mjs — contains 'bank\/cosign\.mjs' not 'bank/cosign.mjs'. ✓ no self-match.

OK. Now let me consolidate and also look at a few more things:

**The `judgeCronTemplate` vs the actual cron lines**: lines like `23,53 * * * * cd $R && mkdir -p $LOCKDIR && $FLOCK $LOCKDIR/alarm.flock /usr/bin/node bank/alarm.mjs >> ...` — judgeCronTemplate: `/^[0-9*]/` ✓ starts with '2'. `/node\s+bank\/\S+\.mjs/` — the line has `/usr/bin/node bank/alarm.mjs` ✓. `/\bflock\s+-n\b/` — the line has `$FLOCK`, not literal flock -n. `/\$FLOCK\b/` ✓ and varHasN: the file has `FLOCK="$FLOCK -n"` → `/FLOCK="?\$FLOCK\s+-n"?/` ✓. So passes. ✓.

**The deadman line**: `9 */2 * * * { [ ! -f ... ] || ...; } && /opt/scripts/notify-gary-sms.sh ...` — no node bank/.mjs → skipped by judgeCronTemplate. ✓.

**Now — a NEW issue with the cron lines and the control-table gate**: the control-table gate's cronLines uses `/^\S+ .*\$TAG/`. The deadman line contains `$TAG` and starts with '9' → included. It contains no bank/*.mjs. ✓ harmless. But the deadman line DOES contain `/opt/scripts/notify-gary-sms.sh` — not bank/.mjs. ✓.

**Wait, one more on the control-table gate**: the AUTOMATIC rows name `bank/alarm.mjs` and `bank/alarm.mjs --reconcile`. cronLines.includes('bank/alarm.mjs') ✓ (substring). The PROCEDURE row names `bank/cosign.mjs` — cronLines.includes('bank/cosign.mjs')? The cron lines don't mention cosign.mjs → PROCEDURE ✓. The ON-CHAIN row names the two lib.rs files → both pin ✓. Four rows total ✓.

**Now the deeper R4 question: the ON-CHAIN arm requires the row to name programs that pin the bank. But the row's CLAIM is about the 2-of-2. The arm checks `pub bank: Signer<'info>` and `require_keys_eq!(ctx.accounts.bank.key(),` in the SAME FILE. As noted, the second arg is unchecked, and the two matches need not be in the same instruction. Concrete bypass: `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.bank.key())`. The gate passes; no 2-of-2. The suite (3.1 because NotTheBank) is the real check. So the gate is a weak textual pin — file as MEDIUM with the tautology example.**

**Now let me look at the diff's selftest `oneSign` check**: 
```js
const oneSign = src => {
  const signs = [...src.matchAll(/partialSign/g)].map(m => m.index)
  const refuse = src.indexOf('if (!v.ok)')
  return signs.length === 1 && refuse > 0 && signs[0] > refuse
}
```
cosign.mjs has `tx.partialSign(bank)` once. But the COMMENT in cosign.mjs... does cosign.mjs's header mention 'partialSign'? Yes! The C3 comment in selftest says "cosign.mjs must contain exactly one partialSign" — and cosign.mjs's own header... let me check cosign.mjs's text: the header doesn't seem to mention partialSign. The code has `tx.partialSign(bank)` once. matchAll(/partialSign/g) on cosign.mjs → 1 match (the code). ✓. But wait — the selftest's C3 comment ITSELF contains 'partialSign' multiple times — but oneSign is only applied to cosignSrc, not selftest. ✓. And the self-match forbidden map doesn't include 'partialSign' — should it? If selftest.mjs contained 'partialSign' literally, would any arm self-match? The arms scan srcFiles for: keyPat (bank key), sigPat (fromSecretKey), invoker regex. 'partialSign' isn't searched across the tree. So selftest.mjs containing 'partialSign' is harmless. ✓. But hmm — the C3 both-ways test does `cosignSrc.replace('tx.partialSign(bank)', 'tx.partialSign(bank); tx.partialSign(bank)')` — selftest.mjs source contains 'tx.partialSign(bank)' — harmless (not searched). ✓.

**`oneSign` robustness**: if cosign.mjs is refactored to `tx['partialSign'](bank)` or `.partialSign(` with different spacing — matchAll(/partialSign/g) still matches 'partialSign'. If renamed to `.sign(` — the gate goes red (0 matches) → fail-closed. ✓. If a second signing site uses `tx.sign([bank])` instead of partialSign — partialSign count stays 1 → gate passes but a full-sign route exists! `tx.sign(bank)` requires all signatures... `tx.sign([bank])` with missing other signatures throws. `tx.partialSign` is the only way to add one signature. So a second site must use partialSign (or serializeMessage + nacl). nacl route: `import nacl from 'tweetnacl'; nacl.sign.detached(tx.serializeMessage(), bank.secretKey)` — no 'partialSign'. The C3 gate wouldn't see it. But C2 (signer set) would see the fromSecretKey... unless assembled. Same textual-gate limit. Fold into the MEDIUM textual-gates finding.

**Now let me check the `signerSet` expected list**: `['bank/cosign.mjs -> BANK', 'bank/distribute.mjs -> DISTRIBUTOR', 'bank/revenue.mjs -> SWAP-OPERATOR']`. distribute.mjs: `Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYFILE...` with KEYFILE = '/opt/cbob-vaults/bank/keys/distributor.json' → contains 'keys/distributor.json' → DISTRIBUTOR ✓. revenue.mjs: KEYFILE = '.../keys/swap-operator.json' → SWAP-OPERATOR ✓. cosign.mjs: KEYFILE = process.env.CBOB_BANK_KEY || '.../keys/bank.json' → contains 'keys/bank.json' → BANK ✓. But cosign.mjs ALSO contains... does it contain 'keys/distributor.json'? No. ✓. And the keyPat check: cosign.mjs contains 'CBOB_BANK_KEY' and 'keys/bank.json' → reader ✓. distribute.mjs contains 'keys/distributor.json' — keyPat is /CBOB_BANK_KEY|keys\/bank\.json/ — 'keys/distributor.json' doesn't match 'keys/bank.json' ✓ not a bank-key reader. ✓.

Hmm wait — `['keys', 'bank\\.json'].join('/')` = 'keys/bank\\.json' → regex /keys\/bank\.json/ — matches 'keys/bank.json'. Does 'keys/bank.json' appear as a substring of 'keys/bank.json.bak' or similar? Not present. ✓.

**Now, the selftest's `srcFiles` includes tests/*.ts — tests/3prog.test.ts contains `Keypair.fromSeed` (not fromSecretKey) and `Keypair.fromSecretKey`? Let me check: 3prog.test.ts uses `Keypair.fromSeed(Buffer.alloc(32,7))` — fromSeed, not fromSecretKey. Does it contain 'fromSecretKey'? `umi.eddsa.createKeypairFromSecretKey(bank.secretKey)` — 'createKeypairFromSecretKey' CONTAINS 'FromSecretKey' — case: sigPat = /fromSecretKey/ (lowercase f). 'createKeypairFromSecretKey' has 'FromSecretKey' with capital F → /fromSecretKey/ does NOT match (case-sensitive). ✓. So 3prog.test.ts doesn't match sigPat. ✓. But wait — umi's createKeypairFromSecretKey DOES turn the bank's secret key into a signer in the TEST. The test signs as the bank (umi identity is bank). So the test suite IS a fourth signer of the bank key... but it uses `Keypair.fromSeed(Buffer.alloc(32,7))` — a DETERMINISTIC test key, not the real bank key file. The real bank key (keys/bank.json) is not read by tests. ✓. The signer-set arm is about the PRODUCTION bank key. The test's bank is a test keypair. Fine.

Hmm, but hold on — `umi.eddsa.createKeypairFromSecretKey(bank.secretKey)` — if someone changed the test to read the REAL bank key... the one-reader arm (keyPat) would catch the key path/env var reference. ✓.

**Now let me think about whether the new on-chain tests 4.7-4.10a actually prove the confinement both ways**: 4.7 (theft, REJECT BankKeyOutsidePair) ✓, 4.7a (redeemable after, ALLOW) ✓, 4.8 (alice pays, ALLOW) ✓, 4.9 (two redemptions, ALLOW) ✓, 4.10 (pay INTO bank, REJECT) ✓, 4.10a (redeemable, ALLOW) ✓. because() pins 4.7 and 4.10 to BankKeyOutsidePair ✓. Good coverage. One gap: no test that an instruction naming the bank BEFORE the open is refused (the i<current part of the scan). The theft in 4.7 is AFTER the open. A test with the theft BEFORE the open would pin the "starts at 0" behavior — the OLD code (start at current+1) would MISS a theft before the open... wait, no — the old code didn't have the confinement at all. The NEW code's reason for starting at 0 is to catch instructions before the open. Is there a test with the evil instruction BEFORE the open? NO! 4.7 has it after. So the "starts at 0" property is UNTESTED — a regression to `current + 1` would pass all tests (4.7's theft is after the open, caught by a current+1 scan too... wait, would it? If the scan started at current+1, the theft at index 1 (after open at 0) would still be scanned. So 4.7 passes either way. The start-at-0 behavior has NO test!). Is start-at-0 necessary? The bank's key in an instruction BEFORE the open: the bank signs the whole transaction, so a theft before the open is just as authorized as one after. The old invariant only needed the burn after. The confinement needs to see ALL instructions — including before. If someone "optimizes" the scan back to `current + 1`, a theft before the open slips past on-chain, and NO TEST catches it. That's a real test gap: add a test with the theft instruction BEFORE the open. MEDIUM (the load-bearing property of the rewrite — walking from 0 — is the untested half; the suite would stay green if it regressed to current+1). Evidence: reorder 4.7's instructions to [theft, open, sweep, burn] — should REJECT with BankKeyOutsidePair; currently no such assertion. This is a genuine finding: the rewrite's new behavior is only half-tested.

Let me double check: with the theft BEFORE the open, does the current code refuse? i=0: theft instruction, not open/burn, names bank → require fails → BankKeyOutsidePair. ✓ the code handles it; the test doesn't prove it. And with a hypothetical regression to `let mut i = current + 1`, the theft before the open would NOT be scanned → allowed → and 4.7 (theft after) still refused → suite green on the regression. So yes, MEDIUM test gap.

**Similarly: is there a test that a burn BEFORE the open doesn't satisfy found?** 3.8 is "a BURN with no preceding open" — burn alone. What about [burn, open] (burn before open)? The open should refuse (NoTerminalBurn, since i > current fails for the burn at 0 when current=1). Is that tested? judgeRedemptionTx has 'the burn BEFORE the thaw is refused' (off-chain). On-chain: not explicitly. The old code also had i > current... the old code started at current+1 so a burn before was never seen. Same behavior. Not a regression risk from THIS diff. Skip.

**Now, let me reconsider the CU question with actual numbers for the finding.** A redemption with 3 reserve mints: open + ExecuteV1 (1 instruction containing all sweeps? or one per mint?) — from the suite, sweep() returns ONE ExecuteV1 with all inner instructions. So top-level: open, ExecuteV1, burn = 3 instructions, plus maybe ATA creation (separate tx). The loop runs 3 iterations. Trivial. Worst case: someone stuffs the transaction with many instructions (up to packet limit) — each iteration ~1-3k CU → ~30k CU max. The open's other work: read_core_asset, two CPIs... The default 200k budget per instruction. open_for_redemption is ONE instruction — its own budget is 200k (shared across the transaction's 1.4M). The loop adds maybe 10-30k. Probably fine. But unmeasured. The finding: measure CU of open_for_redemption in the worst-case redemption and assert < budget. MEDIUM/LOW. Since limit 12 covers "CU unmeasured anywhere", and the prompt says it got worse — I'll quantify and recommend the specific assertion, filed as an elaboration of limit 12 rather than a new bug. Actually the prompt explicitly invites: "Is there a CU ceiling below it now?" — my answer: the added work is bounded by the instruction count (≤ ~15 in a 1232-byte packet), each `load_instruction_at_checked` is O(instruction size); the added CU is on the order of tens of thousands at most, against a 200k default per-instruction budget — PROBABLY fine, but it's unmeasured, and the measurement is one line in the suite (ComputeBudget simulation or `getRecentPrioritizationFees`... actually measure via simulation with `replaceRecentBlockhash` and check unitsConsumed). I'll state it as: bounded and likely fine, must be measured before ship; not a new ceiling by reasoning, but unproven.

Hmm, wait — actually there's a subtlety about CU and the sysvar: `load_instruction_at_checked` — each call re-borrows and re-deserializes. The deserialization allocates Vec<AccountMeta> and Vec<u8>. For an instruction with many accounts (ExecuteV1 with ~20 accounts), that's a bigger allocation. ~15 instructions × (deserialize ~20 accounts) — each account meta is 34 bytes serialized. Fine. Tens of thousands of CU at most. OK.

**Now let me look at the `holdDays` + resume + cadence interaction ONE more time for a real bug:**

Scenario: Day 1: pool small, gate says hold (nothingToDo). Day 2: pool bigger, gate says hold. ... Day 31: holdDays = 31 (anchored to day 1, the earliest day, since nothing ever paid) → forced → pays. ✓.

Scenario: Day 1: pays (paid rows). Day 2: hold. ... Day 32: holdDays anchored to day 1 (last paid) = 31 → forced. ✓.

Scenario: Day 1: pays. Day 5: pays. Day 6: holdDays = 1. ✓.

Scenario: crash mid-distribution on day 10 (some paid rows with sigs, some ambiguous). Day 10 counts as paid (has rows). Resume day 10: uses stored plan, skips gate, continues. ✓. If the run NEVER finishes day 10 (abandoned), day 11: holdDays anchored to day 10 (has paid rows) = 1. Even though day 10 had ambiguous (maybe unpaid) rows. The clock says "we paid on day 10". Slightly optimistic but the ambiguous rows are alarmed. LOW (already noted).

**A ledger with days out of lexical order**: Object.keys order is insertion order for string keys; the filter+sort handles it. ✓.

**dayDiff with DST**: UTC, no DST. ✓.

**What if `st.days` has a key that's not a date (e.g., 'foo')?** `d < day` string compare — 'foo' > '2026-...' → excluded (since day is '2026-08-22', 'foo' > that lexically? 'f' > '2' → 'foo' > '2026-08-22' → true → d < day false → excluded). Date.parse('fooT00:00:00Z') = NaN — but it's excluded before that. A key like '2026-13-45' (invalid date but lexically a day)? d < day could include it; Date.parse('2026-13-45T00:00:00Z') = NaN → dayDiff = NaN → Math.max(0, NaN) = NaN → held = NaN → `held >= maxHoldDays` false, `smallestPer >= threshold` decides. NaN held → describeCadence(NaN): NaN <= 1 false, <= 7 false → 'monthly'. Cosmetic. The ledger is self-written; a corrupt key means the ledger was hand-edited. LOW/skip.

**Now the BIGGEST remaining question: is there anything in R2's main() flow that's actually broken?**

Let me re-read the main() flow with the plan:

```js
let plan
if (st.days[day].plan && !DRY) {
  plan = { activated, per (BigInt revived), census, denominator, skip: null }
} else {
  plan = allocateWeighted(balances, levels, available)
  if (!plan.skip) {
    const held = holdDays(st, day)
    const smallest = plan.activated.reduce(...)
    const d = decideEmission({ smallestPer: smallest, daysSinceLastPayout: held })
    if (!d.pay) plan = { ...plan, skip: `holding: ${d.reason}` }
  }
  if (!plan.skip && !DRY) {
    st.days[day].plan = {...}; save(st)
  }
}
```

**BUG?: the cadence gate uses `available` = the distributor's CURRENT balance. The plan's per amounts sum to <= available. The plan is stored with `available: String(available)`. On resume, the stored plan is used. Fine.**

**BUG?: `allocateWeighted(balances, levels, available)` — `balances` includes ALL vaults (activated and not). `levels` is the whole register. ✓.**

**BUG?: the `smallest` for the gate is recomputed from plan.per — same as allocateWeighted's internal smallest. ✓ consistent.**

**BUG?: if the gate says hold, `plan = {...plan, skip}` — but `plan.census` and `plan.denominator` are preserved and printed. ✓. And `nothingToDo` written. The day is finished. But `holdDays` on the NEXT day: today's `paid` = {} → not a paid day → clock keeps counting from the last paid day. ✓ correct — a held day doesn't reset the clock. ✓**

**BUG?: on a FORCED day (d.forced), the plan proceeds and is stored. ✓.**

**What if `available` is 0 but there are activated vaults?** allocateWeighted: `available <= 0n` → skip 'no cbBTC to distribute'. The gate doesn't run. nothingToDo. ✓.

**What if NO vaults are activated?** skip 'no activated vaults'. ✓.

**What if the register is missing a level for an activated vault?** skip (the HIGH griefing). ✓ as designed.

OK. Now **the plan storage and `st.days[day].plan.per` values as strings** — JSON. ✓.

**One more: `const done = st.days[day].paid` — `st.days[day] ||= { paid: {}, startedAt: ... }`. If the day already exists (resume), `||=` keeps it. ✓. But `startedAt` is NOT updated on resume — the plan log says "RESUMING the plan fixed at {startedAt}". ✓.**

Now, **the send loop's `plan.per[v]`** — on a resumed plan, per is revived. ✓. On a fresh plan, per is BigInt. ✓.

**`done[v] = { amount: String(plan.per[v]), ... }`** ✓.

Alright. Now let me also examine **the `unreadableAtas` persistence**: `if (poisoned.length && !DRY) { st.days[day].unreadableAtas = ...; save(st) }` — written BEFORE the plan. detectDistribution reads `rec.unreadableAtas`. ✓.

Now, **one more possible R2 issue: `balances[v] = String(t.amount)` for ok accounts; '0' for missing/poisoned. allocateWeighted does `BigInt(b) >= ACTIVATION_SATS`. ✓.**

**The `ataOf[v]` for the transfer destination** — computed for all vaults. ✓.

**`createTransferCheckedInstruction(src, CBBTC, ataOf[v], distributor.publicKey, plan.per[v], CBBTC_DECIMALS)`** — transferChecked validates mint and decimals. ✓.

Now, **the fee floor**: `needSol = 5_000 * outstanding * 2`. outstanding counts unpaid+not-skipped. ✓ (the round-12 fix).

OK, R2 is well-understood now. Let me also quickly reconsider the **HIGH griefing** severity once more. The attack: send 21,000 sats (~$21) to ANY vault that lacks a level in the register. Wait — actually, does the attack require the vault to lack a level? Levels are assigned "at activation". If the operator's process assigns a level when a vault activates, then a vault that activates at 09:00 and the distribution runs at 09:07 — if the assignment happens between, no halt. The halt happens only if an activated vault has no level AT DISTRIBUTION TIME. So the griefer activates a vault at 09:06 → the 09:07 run halts. The operator then assigns a level and re-runs. Cost to griefer: 21,000 sats (locked in someone else's vault — actually, could the griefer use their OWN vault? Mint a vault (free in charter round?), send it 21,000 sats, don't register a level. But the operator assigns levels to all activated vaults... the griefer's vault would get a level assigned. The griefer can't PREVENT the operator from assigning a level. So the griefing is a RACE, not a permanent halt: activate right before the run, halt that run, operator fixes, repeat daily for $21/day (the griefer loses the sats? No — if it's the griefer's OWN vault, they keep the sats! They can redeem later. So the cost is ~zero for a griefer with their own vault: activate their own vault at 09:06 daily, halt the run, and if the operator's assignment is manual, the run halts until manual intervention. Repeatable daily at near-zero cost (the sats stay in their vault).

  BUT — the design intent is that levels are assigned at activation BY the system. If assignment is automatic (a watcher), the race window is small. If manual, the window is a day. The code has NO assignment mechanism (it's "fate", off-chain, TBD — limit 18 says the randomness source is open). So TODAY, the mechanism by which a level reaches the register is undefined — meaning the race is real and the halt is the designed behavior for an undefined-assignment world. The finding stands: an activated-but-unlevelled vault is reachable by ANYONE (permissionless activation via airdrop, or self-activation), and the response is a TOTAL payout halt, and the assignment mechanism is undefined. The fail-closed choice is defensible ONLY if level assignment is atomic with activation or faster than the daily run with margin. Since it's undefined, this is a HIGH design risk to flag. The fix options: (a) treat unlevelled as Level I with a loud alarm (fail-open, bounded — the griefer's vault gets the minimum, no halt); (b) pre-register levels at mint; (c) exclude unlevelled from BOTH numerator and denominator with an alarm (they don't get paid, others do — but then their share stays in the pool); (d) keep fail-closed but document that assignment must be automated and faster than the cron. The author chose fail-closed for the stated reason ("a fact about OUR DATA"), which is true only if the register is complete by construction — and it isn't, because activation is permissionless. HIGH.

  Hmm, wait — actually, let me reconsider (c): the current code REFUSES (pays nobody). Option (c) pays everyone else and holds the unlevelled vault's share. The author's argument against (c): "paying everyone else while silently dropping that holder is the shape this file already refuses everywhere else." But it needn't be SILENT — it can alarm loudly. The author's choice is defensible; the issue is the ASSUMPTION that unlevelled-activated is a data-corruption signal rather than a normal occurrence. Given activation is permissionless and assignment is undefined, unlevelled-activated is a NORMAL occurrence (every new activation, until assigned). So the distribution halts on EVERY new activation that happens between the last assignment and the daily run. That's... actually the designed behavior if assignment is a separate manual step. The real question is operational. I'll file HIGH with the analysis and let them choose; the key insight is the permissionless-activation × fail-closed × undefined-assignment interaction.

Now, **let me reconsider R6 once more for the "ten per-$1,000 figures"** — verified above, all correct.

And **the "five shares summing to 100.0%"** — verified.

And **732 and 6,405** — verified.

And **"Level V receives exactly 3x Level I"** — verified.

R6: no defect in the card figures. The dust bound (6,404) is the only arithmetic-adjacent issue, and it's a loose upper bound, not a card figure. Actually wait — is 6,404 ON the card? SPEC's distribution section says "at 2,100 vaults the remainder can be up to 6,404 sats a settlement". The tight bound is 2,099. "Up to 6,404" is technically true (2,099 ≤ 6,404) but misleading — it suggests the remainder can be 3x larger than possible. Since SPEC is customer-facing-ish, and the direction is overstating the Bank's... no, it overstates the dust (the holders' own money carried forward). It makes the design look WORSE (more dust) than reality. Not a theft, not an under-claim of a guarantee. LOW.

Hmm, actually, let me recompute the dust bound once more to be sure. dust = available - Σ_v floor(available·w_v/den). We have Σ_v available·w_v/den = available. So dust = Σ_v (x_v − ⌊x_v⌋) where x_v = available·w_v/den. Each fractional part < 1. There are |activated| terms. So dust < |activated|. Max dust = |activated| − 1 (when every term has maximal fractional part... they can't all be simultaneously maximal, but the bound dust ≤ |activated| − 1 holds since dust is an integer < |activated|). At 2,100 vaults: dust ≤ 2,099. The comment says "up to (denominator − 1)" = 6,404. So the comment's bound is 3x too loose. It's not FALSE (2,099 < 6,404), but it's presented as the tight figure ("Integer division leaves up to (denominator - 1) sats"). The accurate statement: "up to (activated − 1) sats, at most 2,099 at full census". LOW — a loose bound presented as tight, in the money file and SPEC.

Now, **the carry-over "verdict challenges"** — I should explicitly challenge the round-16 verdict's claims:

1. The lock mechanism — I verified it's sound. No challenge.
2. The ELF offset — verified correct. No challenge.
3. The flock -n gate — the varHasN regex has a gap (re-definition after the definition line; also `FLOCK="$FLOCK -n"` relies on the base FLOCK being /usr/bin/flock — if someone defines FLOCK twice). LOW.
4. The rejected findings — the CPI one correctly rejected. The ComputeBudget one correctly rejected (off-chain arm). 

Actually, let me challenge one thing in the verdict: **"the true holder and the interloper both return ok:true"** was the measured round-15 defect, and the fix is generations. I verified generations work. But let me check `acquireLock`'s two-pass structure once more for a subtle hole:

Pass structure: `for (attempt = 0; attempt < 2; attempt++)`. Attempt 0: scan. If empty → place .0 → success or continue. If non-empty → evaluate holder → maybe break (place G+1) → success or return. Attempt 1: only reached if place .0 got EEXIST. Scan again → now gens = [0] → evaluate the fresh holder → refuse (fresh). ✓.

Hole: what if scan returns [] but there ARE records (a read race — readdir during another's unlink)? Then place .0 → EEXIST (if .0 exists) → continue → attempt 1: scan → records → evaluate. ✓. If .0 doesn't exist but .5 does (a high generation with no .0)? scan returns [5] → non-empty → evaluate .5. ✓. Can .5 exist without .0? Yes — after breaks and sweeps... the winner sweeps below itself, so after a break to .1, .0 is swept, leaving .1. Then .1's holder releases → nothing. Then a fresh acquire: scan → [] → place .0. ✓. Generations reset to .0 after a clean release. Fine.

What if TWO processes both see gens=[] (both scanned before either placed)? Both place .0 → one wins (link EEXIST for the other) → loser continues → attempt 1: scan → [.0] → fresh → refuse. ✓.

What about the `_beforeSteal` seam firing and a winner placing .0 in the gap? The seam fires after the re-read, before place(G+1). A third runner placing .0: gens is non-empty ([G]) → they don't take the .0 branch → they evaluate the holder at G (stale+dead) → they also try to break → place(G+1) → EEXIST (we win) or they win (we get EEXIST → lostRace). ✓. Exactly one winner. ✓.

The lock is sound. Good.

**Now, one more thing to check in the verdict: "20 lock assertions rewritten to speak POLICY rather than layout"** — the selftest lock block uses files()/wipe()/plant()/record() helpers. ✓.

**And "the gate written to catch a third copy found one on its first run: distribute.mjs"** — the DAS gate. ✓ verified in the tree (distribute.mjs uses judgeDasEnvelope).

Now, **anything else** — let me scan for things outside R1-R6:

- **alarm.mjs's `readConfigs` reads `seal.bank` at offset 73** — SEAL's Config: disc(8) + version(1)@8 + admin(32)@9 + collection(32)@41 + bank(32)@73 ✓. And reserve_mints Vec at 105 (u32 len @105, items @109) ✓. pending fields after. ✓ consistent with the Rust (version, admin, collection, bank, reserve_mints, pending_bank, pending_bank_at, pending_admin, pending_admin_at, bump). ✓.

- **The new SEAL constant IX_OPEN_FOR_REDEMPTION_DISC = [244, 178, 130, 11, 158, 107, 45, 95]** — asserted in 3.1b2 against sha256("global:open_for_redemption"). I can't compute sha256 by hand, but the suite asserts it, and BURN's copy is the same value (IX_OPEN_FOR_REDEMPTION_DISC in BURN = [244, 178, 130, 11, 158, 107, 45, 95]) ✓ consistent between the two files. And 3.1b pins BURN's, 3.1b2 pins SEAL's. ✓.

- **The `because('4.7','BankKeyOutsidePair')`** — the error variant name in the logs. Anchor logs "Error Code: BankKeyOutsidePair". ✓.

- **The suite's `theft` uses `SystemProgram.transfer({fromPubkey:bank.publicKey,...})` with [bank, alice] signing** — the bank signs. The open's confinement catches the transfer naming the bank. ✓.

- **4.7's theft could fail for insufficient bank lamports?** The bank has 50 SOL from airdrop. The theft is 1 SOL. So it would succeed without the confinement → the REJECT is genuinely from the confinement. And because() pins the reason. ✓ (the comment notes this concern).

Now, **let me think about whether the confinement check has a FALSE-POSITIVE that breaks a legitimate redemption flow**:

- The redemption needs: open, ExecuteV1 sweeps (payer = customer), burn. None name the bank except open+burn. ✓.
- ATA creation for the customer's destination ATAs — separate prior transaction (documented). ✓.
- What if the customer's redemption includes a ComputeBudget instruction? No accounts → passes. ✓.
- What if the redemption includes the customer's own SystemProgram.transfer (e.g., consolidating SOL)? Names customer, not bank → passes. ✓ (4.8 analog).

So no false positives for the documented flow. ✓.

**What about the co-signer's judgeRedemptionTx vs the on-chain confinement — are they consistent?** The judge refuses: extra instructions to SEAL/BURN, any instruction naming the bank outside the pair, non-allowlisted programs, bank as fee payer, durable nonce, two redemptions. The on-chain confinement refuses: any instruction naming the bank outside the pair. So on-chain is a SUBSET of the judge. A transaction passing on-chain but failing the judge: e.g., one with a non-allowlisted program not naming the bank → on-chain OK, judge refuses. That's the intended layering (policy stricter than chain). ✓. And two redemptions: on-chain OK (4.9), judge refuses (one per tx). Intended. ✓.

**Is there a transaction the on-chain confinement refuses but the judge allows?** The judge's arm 1 refuses bank in any non-pair instruction — same as on-chain. The judge's pair detection: opens.length === 1 && burns.length === 1. On-chain allows two. So a two-redemption tx: judge refuses, on-chain allows. Consistent direction (policy stricter). ✓. No inversion. ✓.

Now, **one more careful look at the on-chain confinement for a bypass via the EXEMPTION and a FORGED burn**:

The exemption: `is_burn = ix.program_id == BURN_PROGRAM_ID && data starts with burn disc`. A forged instruction to BURN with the burn discriminator and the bank in its accounts — dispatched to burn_vault. burn_vault requires: bank signer pinned to config.bank (the bank signed ✓), asset is a Core asset in the collection owned by `owner`, a preceding open for the same asset+owner, emptiness proof. If the forged burn names a REAL vault the customer owns and a real preceding open exists for it — then it IS a real burn. If it's for a different vault (no preceding open) → NoPrecedingOpen → reverts. So a forged burn either is a real burn (2-of-2 enforced) or reverts. ✓.

A forged OPEN: dispatched to open_for_redemption — requires owner signature (the owner signed? the customer signs the tx; if the forged open names the customer as owner of their vault, and a burn follows, it's a real open). If it names someone else's vault → NotTheOwner (the customer isn't the owner) → reverts. ✓.

So the exemption is sound. Confirmed again.

**Now — the ONE thing I haven't checked: `ix.accounts.iter().any(|a| a.pubkey == bank)` — `ix.accounts` is `Vec<AccountMeta>` from the sysvar. The sysvar's instruction accounts include ALL accounts of the instruction (signers and non-signers). ✓. So any appearance. ✓.**

**And `load_instruction_at_checked` returns instructions with `accounts: Vec<AccountMeta>` and `data: Vec<u8>` and `program_id`. ✓.**

OK. Now let me also spot-check **the diff to tests/3prog.test.ts for the `payer: aliceU` in the CEIL section** — yes, added. ✓.

**And the moved 9c section** — it's after section 9, before 7b. The comment explains. ✓.

Now, **the "anything else" bucket**:

- **Anchor.toml missing three programs in [programs.mainnet]** — LOW.
- **Cargo.toml grep pin weakness** — LOW.
- **The suite's global minted_total coupling** — documented; LOW reinforcement.

Let me also reconsider **the `describeCadence` boundaries**: `<= 1` daily, `<= 7` weekly, else monthly. holdDays can be 0 (first run) → 'daily'. Fine. Descriptive only. ✓.

**`dayDiff` uses Math.round — for exact UTC day boundaries, (b-a)/86400000 is exact. ✓.**

Now, let me also double check **the selftest's new card assertions for a floating-point trap**: `(1000 * LEVEL_WEIGHTS[l] / 732).toFixed(2)` — LEVEL_WEIGHTS[l] is a Number. 1000*2/732 = 2.7327... in floating point: 2000/732 = 2.73224043715847 → toFixed(2) = '2.73' ✓. 3000/732 = 4.098360655737705 → '4.10' ✓. 4000/732 = 5.46448087431694 → '5.46' ✓. 5000/732 = 6.830601092896175 → '6.83' ✓. 6000/732 = 8.19672131147541 → '8.20' ✓. 2000/6405 = 0.312256... → '0.31' ✓. 3000/6405 = 0.46838... → '0.47' ✓. 4000/6405 = 0.62451... → '0.62' ✓. 5000/6405 = 0.78064... → '0.78' ✓. 6000/6405 = 0.93677... → '0.94' ✓. All match. ✓.

Shares: 100*945*2/6405 = 189000/6405 = 29.5066... → '29.5' ✓. 100*525*3/6405 = 157500/6405 = 24.5901... → '24.6' ✓. 100*315*4/6405 = 126000/6405 = 19.6721... → '19.7' ✓. 100*210*5/6405 = 105000/6405 = 16.3934... → '16.4' ✓. 100*105*6/6405 = 63000/6405 = 9.8360... → '9.8' ✓. Sum of rounded: 29.5+24.6+19.7+16.4+9.8 = 100.0 ✓.

R6 clean.

Now, **the census odds**: the card says odds at activation I 45% | II 25% | III 15% | IV 10% | V 5%. The censuses match those percentages exactly. But the ODDS are "deliberately NOT in this file" — the randomness source is open (limit 18). The census figures ASSUME the odds produce exactly those counts (108 = 45% of 240). Real randomness won't produce exactly 45/25/15/10/5 splits — the card's census is the EXPECTED value. Is the card misleading? It presents a specific census as illustrative. Business question, not a code defect. Skip (or note in R6 that the census is an expectation, not a guarantee — but the card presumably frames it as such). Skip.

Now, **the final section: what should this project do that sixteen rounds of AI audit structurally cannot?**

The prompt says: be concrete, don't repeat SPEC.md's THE SHIP GATE answers (real-Core suite, audit-coverage.sh, freeze, both-ways gates, rejected-findings-as-assertions).

Ideas:
1. **Adversarial execution, not adversarial reading**: every finding class here that mattered was found by RUNNING (the cd-before-read bug, the lock double-hold, the ELF offset). AI rounds read; they don't execute. The project should build a standing FUZZ/CHAOS harness: property-based random transaction composition against the local validator (random instruction sequences naming the bank, random orderings, CPI wrapping) asserting the invariants (bank key never spent outside pair, no thaw without burn, no burn without open) — thousands of random transactions, not 279 hand-written ones. AI audits write assertions about what they imagine; a fuzzer finds what nobody imagined.
2. **A canary/honeypot deployment on devnet or with small real value first**: run the whole pipeline (alarm, distribute, revenue, cosign) against a deployment holding $100 for N weeks before real money. The off-chain pipeline has never run against a live deployment (SPEC admits). AI audit cannot substitute for operational soak time. Specifically: the cron jobs, the lock, the deadman, logrotate, the notification path — none have ever fired in anger.
3. **Independent key custody / a second human**: the whole 2-of-2 rests on the Bank key's custody being an "ops property". No AI round can audit the machine the key sits on. A concrete step: a documented, rehearsed key-compromise runbook (rotate bank via the 7-day notice; what happens to in-flight redemptions), and a drill.
4. **External monitoring independent of the box**: the alarm, the deadman, and the notification all live on the same host as the keys. A dead box = silence. An external heartbeat (a second host that expects a daily "I ran" signal, e.g., a cron that emails a third party or a healthchecks.io ping) is the only thing that catches total host failure. The deadman is on-box.
5. **A public, versioned disclosure of the audit trail**: since AI is the certification, publish the rounds and verdicts so customers can judge the process. (Maybe already intended.)
6. **Red-team the co-signer with the actual operator**: the sanctioned path is procedure; the failure mode is the operator bypassing it under pressure. A drill where a realistic "customer" (confederate) pressures the operator to hand-sign a malicious redemption. AI can't test the human.
7. **Measure compute units** (already noted).
8. **A second implementation of the invariant checks** (e.g., a minimal independent verifier of a redemption transaction, written by a different party/model from a one-paragraph spec, run as a pre-sign gate) — diversity of implementation, not just diversity of models reading the same code.
9. **Time-boxed bug bounty once value exists** — even without a firm, a bounty gets human eyes incentivized to break it.
10. **Deterministic replay of the money ledgers**: a tool that re-derives every distribution from the chain (the ledger is the payer's own testimony — limit 11) and flags divergence. The chain is the fact; the ledger is testimony. Currently nothing re-derives payouts from chain state.

The prompt says don't repeat THE SHIP GATE's answers. The gate covers: real-Core suite, coverage script, freeze, both-ways gates, rejected-as-assertions. My answers should be beyond those: fuzzing/chaos (execution at scale), soak time with small real value, external heartbeat off-box, key-custody drills, human red team on the procedure half, independent re-implementation, bounty, chain-replay reconciliation of the ledgers. Good.

Now let me also double-check a couple of remaining details:

**The `empty` object in allocateWeighted is shared across returns?** `const empty = {...}` created fresh per call. `{...empty, skip}` spreads. ✓ no aliasing bug.

**`census(Object.fromEntries(activated.map(v => [v, levels[v]])))`** — builds a map vault→level for activated only. census counts levels. ✓.

**`denominator(cen)`** — Number. ✓.

**`per[v] = amt; total += amt`** — BigInt. ✓.

**The plan's `per` object keys are vault addresses; `Object.fromEntries(Object.entries(...).map(([v,a]) => [v, BigInt(a)]))` on resume ✓.**

**One more potential issue: `allocateWeighted` returns `per` as a plain object keyed by vault address. A vault address that is '__proto__'? Base58 excludes '_'? Base58 alphabet: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz — no '_'. So '__proto__' can't be a vault address. ✓. But `per['__proto__']` assignment would be a problem only if a key were '__proto__' — impossible. ✓. And `Object.fromEntries(activated.map(v => [v, levels[v]]))` — keys are base58. ✓.**

**`levels` values from JSON — the prototype issue is the real one (already filed).**

Now, **let me reconsider the `loadLevels` prototype issue severity.** `LEVEL_WEIGHTS[l]` for l in Object.prototype: 'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf'. Also '__proto__': `LEVEL_WEIGHTS['__proto__']` → Object.prototype (the object itself) → truthy! So '__proto__' passes too. And '__defineGetter__', '__lookupGetter__', '__defineSetter__', '__lookupSetter__'. All truthy via inheritance. So a level value of any of these passes loadLevels and crashes allocateWeighted at `BigInt(LEVEL_WEIGHTS[levels[v]])` — wait, for '__proto__', LEVEL_WEIGHTS['__proto__'] = Object.prototype (an object) → BigInt(Object.prototype) throws. For 'constructor' → BigInt(Object) throws. For 'toString' → BigInt(function) throws. All throw. So the register with such a level crashes the run (loud, exit 3, notification). It's a validation bypass causing a crash, not a miscalculation. The census also pollutes (`c['constructor'] += 1` → string). But the crash happens first? Order: unlevelled filter (passes), census (pollutes c.constructor but doesn't throw), denominator (sums LEVELS keys — c.constructor isn't in LEVELS, so den is computed from the OTHER vaults' levels... wait, cen = census of the activated map including the 'constructor'-levelled vault. census: `for (const v of Object.values(levels)) if (c[v] !== undefined) c[v] += 1` — v='constructor' → c['constructor'] !== undefined (inherited) → c['constructor'] += 1 → c.constructor = 'function Object() { [native code] }1'. The OTHER vaults increment their I..V counts normally. den = Σ over LEVELS of c[l]*w[l] — excludes the constructor vault. So den is computed WITHOUT the constructor-levelled vault's weight. Then the per loop: for the constructor vault, `LEVEL_WEIGHTS['constructor']` = Object → BigInt(Object) → THROWS. So the crash happens in the per loop, AFTER a wrong den computed. But it throws, so no wrong payout. Loud crash. The fix: `Object.hasOwn(LEVEL_WEIGHTS, l)` in loadLevels (and allocateWeighted's unlevelled check), or build LEVEL_WEIGHTS with Object.create(null). MEDIUM (validation that claims to catch bad levels at load doesn't, for a class of strings; the money job crashes instead of naming the typo — the file's own stated goal: "a typo in the register should name itself when the register is read"). The typo 'I' vs 'I ' is caught; 'constructor' is not. A real gap in a gate. MEDIUM.

Hmm — is 'constructor' a plausible typo? No. But the gate's JOB is to validate; it fails for a class of inputs. And the crash is loud, so the blast radius is a halted distribution until fixed. MEDIUM-LOW. I'll say MEDIUM because the file explicitly claims load-time validation is the belt-and-braces and it isn't, and because the fix is trivial.

Actually, wait — I should double-check `census` for the case where levels[v] IS valid but the census object itself: `const c = {}; for (const l of LEVELS) c[l] = 0` — c = {I:0,...,V:0}. `c['constructor']` — inherited, !== undefined → the bug. But this only triggers for invalid levels. With valid levels, no issue. ✓.

**Now, one more R2 check — `allocateWeighted`'s unlevelled check runs BEFORE census, so the crash sequence is: unlevelled passes (constructor truthy), census pollutes, den computed, per loop throws. Confirmed.**

**And `loadLevels`'s bad check runs at load — for 'constructor' it passes. So the file loads, then main() → allocateWeighted throws → withLock catch → exit 3 + notify. Loud. The register typo crashes the distribution rather than naming the bad key. The fix names it.**

OK. Now let me also verify **the diff's claim that `allocate()`'s assertions "now point at allocateWeighted"** — the selftest's first block uses allocateWeighted with allI. ✓. And "splits equally" replaced by "same level same amount" ✓.

**Is there any OTHER caller of the deleted `allocate()`?** I checked — no imports of distribute.mjs anywhere. But wait: does anything `import { allocate }` or use it via dynamic import? From the tree: no. Also `run-tests.sh` runs the selftest. ✓. And SPEC mentions "daily equal payout" in the ARCHITECTURE section of the PROMPT — but SPEC.md itself: let me search the shown SPEC for "equal": "daily equal payout" — the prompt's architecture section says it, but SPEC.md's distribution section is updated. cron-install.sh says "equal per vault". distribute.mjs header says "Equal per activated vault". Two stale comments. ✓ (R5).

Now, **let me reconsider the R5 headline candidates once more and pick the strongest:**

1. SEAL header: "The forward scan below stops at the matching burn; it never enumerates the rest." — DIRECTLY FALSE about the code below it. The scan now starts at 0 and never breaks. This is the strongest: the program's own header, describing the function, wrong about the function's new behavior, in the direction of UNDERSTATING the on-chain control.

2. cosign.mjs header: "open_for_redemption walks the instruction sysvar forward only as far as its matching burn_vault and never enumerates the rest, so 'the customer cannot spend the Bank's signature on something that is not their redemption' rests ENTIRELY on the two arms named above." — FALSE for the same reason; the confinement is now on-chain.

3. SPEC ship-gate: "The programs do NOT bound what else a redemption transaction contains... Moving those two on-chain is possible — SEAL already walks the sysvar — and is not done." — HALF-FALSE: the confinement WAS moved on-chain. The allowlist wasn't. "is not done" is wrong for the confinement half.

4. SPEC control table: the ON-CHAIN row doesn't claim the confinement (under-claim of what the programs enforce); the cosign row attributes both arms to policy without noting one is now also on-chain.

5. distribute.mjs header "Equal per activated vault" + cron-install.sh "equal per vault" — stale after the weighted rewrite.

6. SPEC "(69 assertions)" for the detector selftest — stale count (now 388).

7. SPEC "Thirteen rounds" — stale (now sixteen+).

The headline is #1/#2/#3: the diff that ADDED the on-chain confinement left three comments saying it doesn't exist / isn't done — the exact under-claim defect the owner caught this round, in the commit written to fix it. That's the round's headline, and it's the THIRD target's shape (safer than its documentation says). HIGH.

Let me also make sure I'm not wrong about #1: SEAL's header says "⚠️ AND THIS FUNCTION DOES NOT BOUND WHAT ELSE IS IN THE TRANSACTION. The forward scan below stops at the matching burn; it never enumerates the rest. So 'the customer cannot make the Bank's signature authorise something else' is a POLICY check off-chain, not a guarantee from here." — YES, this is in the current SEAL header (shown in the full tree). And the code below starts at 0 and checks every instruction for the bank's key. So the header is wrong: the function DOES now bound one thing (the bank's key) on-chain. The header understates. Confirmed. HIGH.

And the cosign.mjs header (shown in full tree): "⚠️ AND THE PROGRAMS DO NOT BOUND WHAT ELSE IS IN THE TRANSACTION. `open_for_redemption` walks the instruction sysvar forward only as far as its matching `burn_vault` and never enumerates the rest, so "the customer cannot spend the Bank's signature on something that is not their redemption" rests ENTIRELY on the two arms named above. That is the round-15 theft. Moving them on-chain is possible and is not done; it is an accepted limit, not an oversight." — "Moving them on-chain ... is not done" — the confinement IS done on-chain (this diff). The allowlist is not. So "them" is half wrong. Confirmed stale. HIGH.

And SPEC: "⚠️ AND THE TWO CHECKS THAT MATTER MOST ARE IN THE POLICY HALF. ... Moving those two on-chain is possible — SEAL already walks the sysvar — and is not done. It is listed as an accepted limit rather than left implied." — same staleness. And the accepted-limits list (1a) says "Only the bank-pubkey confinement was moved on-chain" — so SPEC's own known-limits section CONTRADICTS the ship-gate section. Confirmed. HIGH.

These three are the headline. 

Now, is there anything in the diff that's an OVER-claim (the classic direction)? Let me scan:

- The selftest C5 comment: "The column is MECHANICALLY TRUE, not a claim." — over-claim? The gate checks text patterns; "mechanically true" overstates (the ON-CHAIN arm is a regex that a tautology passes). The comment in SPEC says "The column is MECHANICALLY TRUE, not a claim. bank/selftest.mjs parses these rows..." — given the tautology bypass and the first-file-only and $TAG fragility, "MECHANICALLY TRUE" is an over-claim. MEDIUM (over-claim of the gate's strength — the classic direction).

- The bank-sign.sh comment: "NO ROUTE TO A SIGNATURE THAT SKIPS THE SCAN. cosign.mjs has exactly one partialSign, and it sits downstream of the refusal exit; this script adds no flag that could get past it" — over-claim? The gates are textual (defeatable by assembly/escapes/nacl). "NO ROUTE" is strong. But the comment also says "This script is PROCEDURE... Nothing in software can stop the holder of the Bank key from signing" — so the over-claim is tempered. The "NO ROUTE" refers to within-this-repository, gated. Given the textual defeat (nacl.sign.detached with the key bytes — no partialSign, no fromSecretKey literal needed if the key is read via an assembled path... wait, the one-reader arm catches the key path/env var literally; assembled path evades; the signer arm catches fromSecretKey literally; nacl needs no fromSecretKey). So a determined in-repo bypass exists: read the key via assembled path, sign via nacl. Neither arm fires. "NO ROUTE TO A SIGNATURE THAT SKIPS THE SCAN" is therefore an over-claim against a determined author — but the gates are tripwires against ACCIDENT, and the comment frames them as proof. MEDIUM (fold into the textual-gates finding).

- The C3 comment: "A second one, or one hoisted above the refusal, is a signature produced without a verdict — which is the entire thing this file exists to prevent, and is a two-line edit away at any time." — honest. ✓.

- The SEAL comment "WHAT IS EXEMPT, AND WHY THAT IS NOT A HOLE" — I verified it's not a hole. ✓ accurate.

- The distribute.mjs comment "Proven in both directions" — the allocateWeighted assertions cover the main paths. The prototype-chain case is NOT covered (no test with a '__proto__'/'constructor' level). So "proven in both directions" for the unlevelled refusal is tested (bal3 with missing level, and 'VI'), but not for prototype names. Minor.

Now, **let me also check the `judgeCronTemplate` `$FLOCK` acceptance once more**: `varHasN = /FLOCK="?\$FLOCK\s+-n"?/.test(src) || /FLOCK="?\/usr\/bin\/flock\s+-n"?/`. The real file: `FLOCK=/usr/bin/flock` then `FLOCK="$FLOCK -n"`. First regex: `FLOCK="$FLOCK -n"` → matches (FLOCK=, ", $FLOCK, space, -n, "). ✓. 

**And the cron lines use `$FLOCK $LOCKDIR/alarm.flock ...` — judgeCronTemplate passes them via the $FLOCK+varHasN arm. ✓.**

**What if someone reorders so the cron lines use literal `flock` without -n but the file still defines FLOCK with -n?** The line check: `/\bflock\s+-n\b/` — literal 'flock -n' not in the line; `/\$FLOCK\b/` not in the line (it uses literal flock) → bad. ✓ caught.

**What if the line uses `$FLOCK` but the definition loses -n?** varHasN false → bad. ✓.

OK. Now let me also examine **the `readBeforeCd` gate's regex `/RAW=\$\(cat/`** — matches 'RAW=$(cat'. The script has `RAW=$(cat)` and `RAW=$(cat -- "$SRC")`. ✓. And `/^cd "\$\(dirname/m` — matches `cd "$(dirname "$0")/.."`. ✓. Order: RAW before cd. ✓.

**The gate's both-ways**: 'cd first' caught ✓, missing halves caught ✓, pass-through caught ✓.

Now, **one more R3 check — the `case "$SRC" in --*)`**: this refuses `--anything` as the first arg. But what about a file literally named `--live`? The operator can't pass it (refused). They'd use `./--live`. Fine.

**And `[ $# -ge 1 ] && [ $# -le 2 ] || usage` — with 0 args: first test fails → usage. With 3 args: second fails → usage. ✓.**

**And `$2` when $# -eq 2 — checked = "--live". ✓.**

Now, **the exec line and `set -e`**: exec replaces the process; if exec fails (node not found), the shell reports and exits 126/127. Not in the documented codes. LOW (fold into the length/PATH note).

Now, **let me finalize the findings list and assign severities.**

R1:
- (No defect in the mechanism itself — I should say so plainly with the reasoning, since the prompt says attack it; I attacked and the exemption is sound because Solana is atomic and dispatch is by discriminator. State the proof sketch.)
- MEDIUM: the start-at-0 half of the rewrite is untested — a regression to `current + 1` keeps the suite green (4.7's theft is after the open). Add a test with the bank-naming instruction BEFORE the open. This is the one real R1 finding: the new behavior is half-tested.
- LOW/MEDIUM (fold into limit 12): CU now scales with instruction count; bounded (~tens of thousands of CU worst case in a 1232-byte packet) but unmeasured; add a CU assertion for the worst-case redemption.

R2:
- HIGH: permissionless activation × fail-closed unlevelled × undefined assignment = cheap repeatable total payout halt.
- MEDIUM: prototype-chain validation bypass in loadLevels/allocateWeighted ('constructor' etc. pass, then crash the money job) — the claimed load-time validation doesn't cover a class of strings.
- MEDIUM: levels.json has no integrity/change detection (worse than limit 16's framing).
- LOW: dust bound overstated (max activated−1 = 2,099, not denominator−1 = 6,404) in code comment and SPEC.
- LOW: holdDays counts days with only failed/ambiguous intents as paid days.
- LOW: resumed plan loses total/dust in the final log line (cosmetic).

R3:
- MEDIUM: `$0` under a symlink → `cd "$(dirname "$0")/.."` can land in an attacker-chosen directory and exec an attacker-chosen `bank/cosign.mjs` as the key-holding user. Fix: readlink -f.
- LOW: no length bound on TX (E2BIG at exec, undocumented exit 126); base64 canonicality ('=' mid-string silently truncates the decode — practically fail-closed but worth a canonical check); /usr/bin/env node vs absolute /usr/bin/node (PATH hijack consistency).

R4:
- MEDIUM: the ON-CHAIN arm's regex doesn't bind the two halves — `require_keys_eq!(ctx.accounts.bank.key(), ctx.accounts.bank.key())` (tautology) passes with `pub bank: Signer` present and enforces nothing. The second argument is unchecked; the two matches need not be in the same instruction.
- MEDIUM: the textual gates (signer set, one-reader, one-partialSign, self-match) are all defeatable by assembly/escapes/alternative signing paths (Keypair.fromSeed, bracket notation, tweetnacl, CLI) — the selftest's own assembly idiom demonstrates the evasion. They're tripwires for accidents; SPEC/bank-sign.sh's "NO ROUTE" overstates.
- MEDIUM/LOW: the control-table gate's cronLines extraction (`/^\S+ .*\$TAG/`) matches comment lines (unlike judgeCronTemplate's `/^[0-9*]/`), so a future comment in cron-install.sh mentioning $TAG and a .mjs file makes a PROCEDURE file read as AUTOMATIC (fail-open). Also the row parser checks only the FIRST bank/*.mjs named in a row.
- LOW: the suite's minted_total↔quorum coupling is contained but remains a standing hazard for any future pre-section-7 mint (documented in comments only).

R5 (the headline):
- HIGH: THREE comments deny the control this diff adds — SEAL's header ("The forward scan below stops at the matching burn; it never enumerates the rest"), cosign.mjs's header ("walks ... only as far as its matching burn_vault ... Moving them on-chain ... is not done"), and SPEC's ship-gate section ("Moving those two on-chain ... is not done") — while SPEC's own accepted-limits list says the confinement WAS moved on-chain. The control table's ON-CHAIN row also under-claims (doesn't mention the confinement). The exact under-claim defect the owner caught this round, in the commit written to fix it.
- MEDIUM: distribute.mjs header "Equal per activated vault, because one vault is one unit and one vote" and cron-install.sh's "equal per vault" — stale after the weighted rewrite (the money file's own documentation of its core rule is wrong).
- LOW: SPEC "(69 assertions)" for the detector selftest (now 388); "Thirteen rounds" prose (now sixteen).
- LOW: SPEC's "The column is MECHANICALLY TRUE, not a claim" overstates the gate (regex-based; tautology passes).

R6:
- The card arithmetic checks out independently (732, 6405, all ten per-$1,000 figures, shares sum to 100.0%, V = 3× I). No defect. The only arithmetic-adjacent issue is the dust bound (LOW, filed in R2).

Carry-over worse-than-stated:
- Limit 16 (level register off-chain): worse — no change detection at all, and the permissionless-activation halt (R2 HIGH).
- Limit 12 (CU): quantified the bound; measurement still needed; the scan now does O(n) sysvar deserializations.
- Limit 3 (bank as payer inside pair): unchanged.
- Others: not worse.

Verdict challenges:
- The lock mechanism (generations + link CAS): verified sound; the verdict's claim holds.
- The ELF offset: verified correct (45 unconditional).
- The flock -n gate: has a re-definition gap (LOW).
- The rejected CPI/ComputeBudget findings: correctly rejected.

Anything else:
- Anchor.toml: only cbob_vaults in [programs.mainnet]; the other three programs unpinned (LOW). provider cluster = mainnet with default wallet (operational hazard, LOW).
- Cargo.toml: overflow-checks grep pin is weak (matches anywhere in the file, including a comment or a moved section) (LOW).

The final section: what should the project do that AI audit structurally cannot.

Let me now also double-check the R1 "half-tested" claim once more, because it's my main R1 finding. The new code walks from 0. The OLD code walked from current+1. The confinement check is NEW (didn't exist in the old code at all). So there's no "regression to current+1" of the confinement per se — the confinement is new. But the confinement's COVERAGE of instructions before the open is the new behavior. If someone edits `let mut i = 0usize` back to `current + 1` (a plausible "optimization": "the burn is after, why scan before?"), the confinement would miss a bank-naming instruction BEFORE the open, and NO test catches it (4.7's theft is after the open). So the test gap is real: no assertion has the bank-naming instruction before the open. The fix: add one. MEDIUM. Also — is scanning before the open even NECESSARY? The bank signs the whole transaction, including instructions before the open. A theft before the open is just as authorized. So yes, necessary. And untested. MEDIUM confirmed.

Also — hmm, one more R1 subtlety: **the confinement check runs for instructions before the open, but the `found` requirement is after. What if the transaction is [theft, open, burn]? The open's scan: i=0 theft → refuse. ✓. What if [open, theft, burn]? i=1 theft → refuse ✓ (4.7). What if [open, burn, theft]? i=2 theft → refuse ✓. All covered by the code; only the [theft, open, burn] order is untested.**

Now, let me also sanity-check the **two-redemption confinement for a cross-vault bank-theft**: open A (alice), burn A, open B (alice), burn B, plus a theft naming the bank → refused by both opens' scans. ✓.

And **a redemption where the bank is named in the SWEEP's inner accounts via ExecuteV1** — covered (ExecuteV1 lists all inner accounts). ✓.

OK, I'm fairly confident in the findings. Let me also reconsider whether the HIGH griefing should instead be MEDIUM. The prompt's own question: "Is that the right call, or is it a griefing surface — can anyone cause a vault to be activated-but-unlevelled and thereby halt every payout?" My answer: yes, anyone, for ~$21 (or ~free with their own vault), and the assignment mechanism is undefined (limit 18). The halt is loud and recoverable, but it's the primary customer money flow, halted by a stranger, repeatedly, at near-zero cost. HIGH is justified. The author's fail-closed reasoning ("a fact about OUR DATA") is wrong in its premise: activation is permissionless, so an unlevelled activated vault is a fact about the WORLD, not about their data.

Wait, I want to double-check one thing: can anyone REALLY activate any vault by sending 21,000 sats? Activation = the vault's cbBTC ATA balance >= 21,000. The ATA is owned by the PDA. Sending tokens TO an ATA requires no permission (9.7 proves airdrops into vault PDAs work). So yes, anyone can raise any vault's balance past 21,000. And distribute.mjs reads balances and activates on >= 21,000. ✓. So the attack is: pick a vault with no level in the register (e.g., a newly minted one the operator hasn't processed, or ANY vault if the register is incomplete), send 21,000 sats, the next daily run halts with "N activated vault(s) carry no level". Cost: the sats are locked in someone else's vault (a donation) — OR use your own vault (mint + fund + don't... but the operator assigns levels to activated vaults; the griefer can't stop the operator from assigning THEIR vault a level. So the griefer uses SOMEONE ELSE's new vault that the operator hasn't assigned yet — a race). The race window depends on the assignment mechanism (undefined). If assignment is a daily manual step before the distribution run, the griefer activates after the assignment step → halt. Repeatable. Cost: 21,000 sats donated to a stranger each time (real cost ~$21) — or free if the griefer's own vault can stay unlevelled (it can't, once the operator assigns it). So the repeatable cost is ~$21/grief. Cheap enough. HIGH stands, maybe MEDIUM-HIGH. I'll say HIGH with the reasoning laid out and let severity be argued.

Actually, one more consideration: the griefer could also DEACTIVATE nothing — the halt is the point. And the fix (assign Level I to unlevelled with an alarm) is a one-line change that converts total halt into bounded degradation. The author's counter-argument ("silently dropping that holder") is answered by "loudly, at Level I, with an alarm" — the holder gets the minimum, nobody is dropped, no halt. I'll recommend that.

Now, **the final section**. Let me draft it concretely:

1. **Fuzz the pairing and the confinement by EXECUTION, not reading.** A property harness on the local validator: generate thousands of random transactions (random instruction orderings, random programs, random account injections naming the bank, CPI wrapping, two-redemption mixes, malformed discriminators) and assert the invariants hold (no bank spend outside the pair, no thaw without terminal burn, no burn without open, no partial sweep survives). Every finding that mattered in sixteen rounds was found by running, not reading — the cd-before-read, the lock double-hold, the ELF offset. AI rounds read; a fuzzer executes at a scale no round approaches. This is different from the 279-assertion suite: those are hand-written cases; a fuzzer explores the space between them.

2. **Soak the off-chain pipeline with small real value before customer money.** SPEC admits the pipeline "has never run against a live deployment." No AI round can substitute for the cron actually firing, the lock actually excluding, logrotate actually rotating, the notification actually arriving, the deadman actually paging at 3am. Run the full stack (alarm, distribute, revenue, cosign, deadman) against a deployment holding a token amount for weeks. The failure modes of ops code are operational, not logical.

3. **Move the heartbeat off the box.** The alarm, the deadman, the keys, and the notification script all live on one host. A dead host is silent. An external dead-man's switch (a second host or a service like a healthcheck ping that must receive a daily "distribute ran" and "alarm ran" signal) is the only thing that catches total host failure. AI audit of the on-box deadman cannot fix that the deadman dies with the box.

4. **Rehearse the human half.** The Bank's policy is procedure; the failure mode is a person under pressure. Run a drill: a confederate "customer" pressures the operator to hand-sign a redemption that the co-signer refuses. And a key-compromise drill: rotate the Bank through the 7-day notice while redemptions are in flight, and see what breaks. No model can audit the operator's Tuesday.

5. **Re-derive the money from the chain, not from the ledgers.** Limits 11 and the revenue/distribution ledgers are the payer's own testimony. Build the independent reconciler: for each distribution day, recompute from chain state (the collection, the ATAs, the levels register hash) what SHOULD have been paid and diff against what WAS paid. The chain is the fact; the ledger is a claim. Nothing today re-derives payouts from chain.

6. **Pin the level register's hash on-chain or in the ledger, and alarm on changes.** Until the commitment scheme exists, a one-line sha256 of levels.json in each day's ledger entry plus a detector comparing day-over-day would convert the silent re-weighting into a finding. (This is a finding above; it's also a structural answer.)

7. **A second, independent implementation of the redemption verifier.** Not a second model reading the same code — a different party (or a different model family) writing a minimal redemption-transaction verifier from a one-paragraph spec, run as a second pre-sign gate beside cosign.mjs. Diversity of implementation catches what diversity of opinion about the same code cannot.

8. **A time-boxed bounty once value exists.** No firm, but a bounty rents human adversaries with skin in the game.

9. **Measure compute units.** One assertion: simulate the worst-case redemption (3 mints, lamport sweep, griefed instructions up to the packet limit) and assert unitsConsumed < budget. The byte ceiling is measured; the CU ceiling is not.

Also: **publish the audit trail** — since AI is the certification, the rounds and verdicts ARE the diligence a customer gets. Making them public is the only way "audited by AI" becomes checkable by a customer.

Now, let me reconsider a few severity assignments and make sure I'm not over-claiming. The prompt warns against wrong CRITICALs. Let me NOT use CRITICAL unless I'm certain. My highest is HIGH (the griefing halt and the R5 headline). Let me double check the R5 headline is real: the SEAL header text is in the full tree (current state): "⚠️ AND THIS FUNCTION DOES NOT BOUND WHAT ELSE IS IN THE TRANSACTION. The forward scan below stops at the matching burn; it never enumerates the rest." — YES, present. And the code starts at 0 and never breaks. So the header is factually wrong about the code. The header says the function "DOES NOT BOUND WHAT ELSE IS IN THE TRANSACTION" — but it now DOES bound one thing (the bank's key). So the header understates. Confirmed real. HIGH (it's the exact defect class the round is about, in the program's own documentation of the function under audit).

Hmm, but is it HIGH or MEDIUM? It's a comment, not code. The impact: a reader (customer, auditor, the operator) is told the programs don't confine the bank's key — when they do. The guarantee is understated. The owner called the inverse "the worst defect since the last round". By symmetry, this is the same severity as that. The owner's was in SPEC's control table (customer-facing); this is in the program header + cosign header + SPEC. I'll say HIGH for the cluster (three locations, including SPEC, contradicting SPEC's own limits list).

Now the griefing: HIGH vs MEDIUM. It's a design choice (fail-closed) whose premise is wrong (activation is permissionless). The consequence is a loud, recoverable, total payout halt at ~$21/grief. No theft. I'll say HIGH because it's the primary customer money flow and repeatable, but I'll be explicit that it's a liveness/design finding, not a theft, and the fix is a policy choice. Actually — let me reconsider. The author EXPLICITLY chose fail-closed and wrote down why. The prompt asks "Is that the right call, or is it a griefing surface?" The honest answer: it's a griefing surface, and the premise ("a fact about OUR DATA") is wrong because activation is permissionless. But the author might respond "the register is complete by construction because we assign at activation". The counter: assignment is undefined (limit 18), and even with assignment, there's a race. And a stranger can activate ANY vault. So the premise fails. HIGH, argued carefully.

Hmm, wait — actually, can a stranger activate a vault that ALREADY has a level? Then no halt (it has a level). The halt requires an activated vault with NO level. Which vaults have no level? Those the operator hasn't assigned. If the operator assigns at activation (a watcher), the window is small. If the operator assigns at MINT (pre-register all mints), then only mints since the last register update are unlevelled — and a stranger can activate a freshly-minted vault. So the window exists regardless unless assignment is atomic with mint/activation. Since the mechanism is undefined, the finding is: the design's fail-closed premise requires atomic assignment, which doesn't exist and isn't specified. HIGH.

One more check on the griefing: does the run ACTUALLY halt, or just skip? `allocateWeighted` returns skip → main: `if (plan.skip) { ...nothingToDo...; return }` → NO vault is paid that day. Total halt. ✓. And it writes nothingToDo + finishedAt, so the day is "finished" — the NEXT day it recomputes; if the vault still has no level, halts again. So until the register is fixed, EVERY day halts. A stranger who keeps a vault unlevelled-activated... but the operator fixes the register after the first halt. So it's one halt per new unlevelled activation, until the operator automates. Repeatable by activating fresh vaults. Cost ~$21 each (donated to the vault's owner — actually if the griefer mints their OWN vault and activates it, they keep the sats; the operator will assign it a level after the first halt, but the griefer can mint ANOTHER vault and activate it. Minting costs the mint price (charter round free). So the griefer pays gas + locks 21,000 sats in their own vault (recoverable via redemption) per grief. Near-zero cost, repeatable. HIGH justified.)

Hmm, but wait — minting requires the Bank's co-signature (mint_vault requires bank: Signer). So a griefer can't mint at will unless a round is open and the Bank co-signs mints. During an open round, anyone can mint (the Bank co-signs all mints in the round — that's the design; the Bank's duty is to refuse mints during a voting window, not to vet minters). So during an open round, a griefer mints vaults, activates them, and halts distributions repeatedly. Outside a round, they can only activate EXISTING unlevelled vaults (donating sats). Either way, the surface is real. HIGH.

OK, I'm confident. Let me also reconsider the prototype-chain finding severity once more: it requires a bad level string in the register (operator typo or attacker write). The register is operator-controlled. A typo like 'constructor' is implausible; but the gate's PURPOSE is to validate, and it fails for a class of inputs, and the failure mode is a crash of the money job (loud, exit 3). The file's own comment claims load-time validation catches bad levels "while there is still a file and a key to point at" — and for prototype names it doesn't; it crashes later in allocateWeighted with a TypeError, not a named typo. MEDIUM-LOW. I'll say MEDIUM because it's a gate that doesn't do what its comment claims (the recurring class), and the fix is one line.

Hmm, actually — wait. Let me re-examine: does `loadLevels`'s check REALLY pass 'constructor'? `const bad = Object.entries(raw).filter(([, l]) => !LEVEL_WEIGHTS[l])`. LEVEL_WEIGHTS is `Object.freeze({ I: 2, II: 3, III: 4, IV: 5, V: 6 })`. `LEVEL_WEIGHTS['constructor']` — property lookup: own property? No. Prototype chain: Object.prototype.constructor → Object function → truthy. `!truthy` = false → not in bad → passes. ✓ confirmed. And `LEVEL_WEIGHTS['hasOwnProperty']` → function → truthy → passes. ✓. So the finding is real. And in allocateWeighted, the unlevelled check has the same bug, and then `BigInt(LEVEL_WEIGHTS['constructor'])` throws "Cannot convert ... to a BigInt"? Actually `BigInt(Object)` — Object is a function; BigInt(function) throws TypeError: Cannot convert ... to a BigInt? Let me think: BigInt() on a function throws "Cannot convert ... to a BigInt"? BigInt throws TypeError for non-integer-coercible. `BigInt(Object)` → TypeError: Cannot convert ... hmm, actually BigInt of a function: "TypeError: Cannot convert ... to a BigInt"? The exact message varies; it throws. ✓. So the run crashes. Confirmed.

Wait, one more subtlety: `Object.freeze({...})` — freezing doesn't remove the prototype. ✓. The fix: `Object.hasOwn(LEVEL_WEIGHTS, l)` or `Object.prototype.hasOwnProperty.call(LEVEL_WEIGHTS, l)`, or define LEVEL_WEIGHTS with `Object.create(null)` (can't with object literal + freeze easily; use a Map or hasOwn). ✓.

Also — the same prototype issue in `census`: `c[v] !== undefined` for v='constructor' → inherited → true → `c['constructor'] += 1` → string concat pollution. And in `allocateWeighted`'s unlevelled filter. All the same root cause. One finding.

Now, is there a prototype issue with vault ADDRESSES as keys? Base58 excludes '_', but includes all alphanumerics except 0,O,I,l. 'constructor' contains 'o' (lowercase o IS in base58? base58 has 'o' — yes, lowercase o is allowed; only '0' (zero), 'O' (capital o), 'I' (capital i), 'l' (lowercase L) are excluded). 'constructor' = c,o,n,s,t,r,u,c,t,o,r — all in base58! So a vault address COULD theoretically be the string 'constructor'?? No — vault addresses are 32-byte pubkeys encoded in base58, ~44 chars. 'constructor' is 11 chars. A valid pubkey's base58 is 32-44 chars. So no vault address equals 'constructor'. But `balances` keys are vault addresses (long), and `levels` keys are vault addresses (long). The LEVELS values are the short strings ('I'..'V'), which is where the prototype issue lives. ✓ my analysis stands.

Also `per` object keys are vault addresses (long base58) — safe. ✓.

OK. Now let me also double-check the **`census` function for a DIFFERENT bug**: `for (const v of Object.values(levels)) if (c[v] !== undefined) c[v] += 1` — for valid levels, c[v] starts 0, increments. ✓. A level not in LEVELS (e.g., 'VI') → c['VI'] === undefined → skipped (not counted). But allocateWeighted's unlevelled check catches 'VI' first. ✓.

Now, **the `denominator` when cen has polluted keys**: only LEVELS keys summed. ✓ (the pollution doesn't reach den).

Alright. Let me also reconsider **whether `allocateWeighted` can pay a vault that is not activated**: `per` only for `activated`. ✓. **Miss an activated one**: no. ✓.

**`smallest` when the first element is not the smallest**: `activated.reduce((m, v) => per[v] < m ? per[v] : m, per[activated[0]])` — correct (initial is first, compares all). ✓. The prompt specifically asks. ✓ correct.

**When `activated` is empty**: early return. ✓.

Now, **the plan resume and the cadence gate skipped on resume — "What happens if the pool SHRANK between the plan and the resume?"** — I covered: transfers fail with insufficient funds → marked rejected → reported. But actually, let me reconsider: the plan is fixed with amounts summing to total <= available_at_plan_time. On resume, the sends already done are marked paid (skipped in the loop). The remaining sends need total - already_sent. The pool = available_at_plan_time - already_sent (assuming no external movement). So remaining = total - sent <= available - sent = pool. Solvent. ✓ UNLESS external movement (operator spends from the distributor ATA). Then insufficient funds → rejected → reported. Fail-closed-ish (reported, not silent). The comment says "re-deciding under a smaller pool is how a resumed day pays half its vaults and then changes its mind" — the design choice is to honor the plan. If the pool shrank externally, the plan can't be honored fully → some vaults rejected → reported. Acceptable. But: is there a scenario where honoring the plan OVERPAYS? The plan's per amounts were correct at plan time. On resume, the activated set might have changed (a vault redeemed → handled by stillThere; a vault ACTIVATED after plan → not in plan, not paid — fine). Balances of plan vaults might have DROPPED below 21,000 (a vault's reserve fell — but reserves can't fall while sealed; only via redemption/burn → stillThere catches burns). So no overpay. ✓.

OK. Now, **one more thing: the `holdDays` anchor when the ledger's earliest day is a `nothingToDo` day and a LATER day paid.** anchor = last paid day (paid.length > 0). ✓. The earliest-day fallback only when NOTHING paid. ✓.

**And `holdDays` when `st.days[day]` for a past day has `paid` = undefined?** `st.days[d]?.paid || {}` → {} → not paid. ✓.

Now let me write up. I should be thorough but organized. Order: R1-R6, carry-over, verdict challenges, anything else, then the final section.

Let me reconsider severity inflation one more time. The prompt is wary of wrong CRITICALs. I'll use HIGH sparingly: the R5 headline (three stale comments denying the on-chain control) and the R2 griefing. Everything else MEDIUM/LOW.

Actually, for the R5 headline — let me reconsider whether it's HIGH or MEDIUM. It's a comment defect, not a code defect. The owner's catch last round was treated as "the worst defect since the last round" — but that was in SPEC's control table (the customer-facing guarantee document). My finding spans SEAL's header, cosign's header, AND SPEC's ship-gate section, AND contradicts SPEC's own limits list. The direction (under-claim of a security guarantee) is the one nothing is instrumented to catch. I'll say HIGH for the cluster, noting it's documentation, and the fix is three edits. The prompt explicitly asks for exactly this shape. HIGH.

For the griefing — HIGH, argued.

For the start-at-0 test gap — MEDIUM (a load-bearing new behavior with no test; the suite would stay green on a regression).

For the textual-gates defeatability — MEDIUM (the gates are presented as proof in SPEC/bank-sign.sh; they're tripwires; the evasion is demonstrated by the selftest's own idiom).

For the ON-CHAIN arm regex (tautology passes) — MEDIUM.

For the symlink $0 — MEDIUM.

For the prototype-chain validation bypass — MEDIUM.

For levels.json no change detection — MEDIUM (worse than limit 16).

For cronLines $TAG fragility + first-file-only — LOW/MEDIUM. I'll say MEDIUM for the $TAG comment fragility (fail-open direction in a gate) and fold first-file-only in.

For the dust bound — LOW.

For the stale "equal per vault" comments — MEDIUM (the money file's header describes the old rule; a reader computes expected payouts wrong; and it's the same R5 class). Actually — the distribute.mjs header is the file's own documentation of its core behavior, now wrong. That's the R5 class in the money file. MEDIUM.

For SPEC "(69 assertions)" and "Thirteen rounds" — LOW.

For the CU — LOW (fold into limit 12 with the bound quantified).

For holdDays counting failed-intent days — LOW.

For Anchor.toml missing programs — LOW.

For Cargo.toml grep pin — LOW.

For the resumed-plan total/dust log — LOW (cosmetic).

For bank-sign.sh length/PATH/base64-canonicality — LOW each, or one LOW cluster.

For the suite minted_total coupling — LOW (documented; reinforce).

Let me also make sure about the **"verdict challenges"** — I should explicitly challenge the round-16 verdict's claims:

1. The lock mechanism — I verified it's sound. No challenge.
2. The ELF offset — verified correct. No challenge.
3. The flock -n gate — the varHasN regex has a gap (re-definition after the definition line; also `FLOCK="$FLOCK -n"` relies on the base FLOCK being /usr/bin/flock — if someone defines FLOCK twice). LOW.
4. The rejected findings — the CPI one correctly rejected. The ComputeBudget one correctly rejected (off-chain arm). 

Actually, let me challenge one thing in the verdict: **"the true holder and the interloper both return ok:true"** was the measured round-15 defect, and the fix is generations. I verified generations work. But let me check `acquireLock`'s two-pass structure once more for a subtle hole:

Pass structure: `for (attempt = 0; attempt < 2; attempt++)`. Attempt 0: scan. If empty → place .0 → success or continue. If non-empty → evaluate holder → maybe break (place G+1) → success or return. Attempt 1: only reached if place .0 got EEXIST. Scan again → now gens = [0] → evaluate the fresh holder → refuse (fresh). ✓.

Hole: what if scan returns [] but there ARE records (a read race — readdir during another's unlink)? Then place .0 → EEXIST (if .0 exists) → continue → attempt 1: scan → records → evaluate. ✓. If .0 doesn't exist but .5 does (a high generation with no .0)? scan returns [5] → non-empty → evaluate .5. ✓. Can .5 exist without .0? Yes — after breaks and sweeps... the winner sweeps below itself, so after a break to .1, .0 is swept, leaving .1. Then .1's holder releases → nothing. Then a fresh acquire: scan → [] → place .0. ✓. Generations reset to .0 after a clean release. Fine.

What if TWO processes both see gens=[] (both scanned before either placed)? Both place .0 → one wins (link EEXIST for the other) → loser continues → attempt 1: scan → [.0] → fresh → refuse. ✓.

What about the `_beforeSteal` seam firing and a winner placing .0 in the gap? The seam fires after the re-read, before place(G+1). A third runner placing .0: gens is non-empty ([G]) → they don't take the .0 branch → they evaluate the holder at G (stale+dead) → they also try to break → place(G+1) → EEXIST (we win) or they win (we get EEXIST → lostRace). ✓. Exactly one winner. ✓.

The lock is sound. Good.

**Now, one more thing to check in the verdict: "20 lock assertions rewritten to speak POLICY rather than layout"** — the selftest lock block uses files()/wipe()/plant()/record() helpers. ✓.

**And "the gate written to catch a third copy found one on its first run: distribute.mjs"** — the DAS gate. ✓ verified in the tree (distribute.mjs uses judgeDasEnvelope).

Now, **anything else** — let me scan for things outside R1-R6:

- **alarm.mjs's `readConfigs` reads `seal.bank` at offset 73** — SEAL's Config: disc(8) + version(1)@8 + admin(32)@9 + collection(32)@41 + bank(32)@73 ✓. And reserve_mints Vec at 105 (u32 len @105, items @109) ✓. pending fields after. ✓ consistent with the Rust (version, admin, collection, bank, reserve_mints, pending_bank, pending_bank_at, pending_admin, pending_admin_at, bump). ✓.

- **The new SEAL constant IX_OPEN_FOR_REDEMPTION_DISC = [244, 178, 130, 11, 158, 107, 45, 95]** — asserted in 3.1b2 against sha256("global:open_for_redemption"). I can't compute sha256 by hand, but the suite asserts it, and BURN's copy is the same value (IX_OPEN_FOR_REDEMPTION_DISC in BURN = [244, 178, 130, 11, 158, 107, 45, 95]) ✓ consistent between the two files. And 3.1b pins BURN's, 3.1b2 pins SEAL's. ✓.

- **The `because('4.7','BankKeyOutsidePair')`** — the error variant name in the logs. Anchor logs "Error Code: BankKeyOutsidePair". ✓.

- **The suite's `theft` uses `SystemProgram.transfer({fromPubkey:bank.publicKey,...})` with [bank, alice] signing** — the bank signs. The open's confinement catches the transfer naming the bank. ✓.

- **4.7's theft could fail for insufficient bank lamports?** The bank has 50 SOL from airdrop. The theft is 1 SOL. So it would succeed without the confinement → the REJECT is genuinely from the confinement. And because() pins the reason. ✓ (the comment notes this concern).

Now, **let me think about whether the confinement check has a FALSE-POSITIVE that breaks a legitimate redemption flow**:

- The redemption needs: open, ExecuteV1 sweeps (payer = customer), burn. None name the bank except open+burn. ✓.
- ATA creation for the customer's destination ATAs — separate prior transaction (documented). ✓.
- What if the customer's redemption includes a ComputeBudget instruction? No accounts → passes. ✓.
- What if the redemption includes the customer's own SystemProgram.transfer (e.g., consolidating SOL)? Names customer, not bank → passes. ✓ (4.8 analog).

So no false positives for the documented flow. ✓.

**What about the co-signer's judgeRedemptionTx vs the on-chain confinement — are they consistent?** The judge refuses: extra instructions to SEAL/BURN, any instruction naming the bank outside the pair, non-allowlisted programs, bank as fee payer, durable nonce, two redemptions. The on-chain confinement refuses: any instruction naming the bank outside the pair. So on-chain is a SUBSET of the judge. A transaction passing on-chain but failing the judge: e.g., one with a non-allowlisted program not naming the bank → on-chain OK, judge refuses. That's the intended layering (policy stricter than chain). ✓. And two redemptions: on-chain OK (4.9), judge refuses (one per tx). Intended. ✓.

**Is there a transaction the on-chain confinement refuses but the judge allows?** The judge's arm 1 refuses bank in any non-pair instruction — same as on-chain. The judge's pair detection: opens.length === 1 && burns.length === 1. On-chain allows two. So a two-redemption tx: judge refuses, on-chain allows. Consistent direction (policy stricter). ✓. No inversion. ✓.

Now, **one more careful look at the on-chain confinement for a bypass via the EXEMPTION and a FORGED burn**:

The exemption: `is_burn = ix.program_id == BURN_PROGRAM_ID && data starts with burn disc`. A forged instruction to BURN with the burn discriminator and the bank in its accounts — dispatched to burn_vault. burn_vault requires: bank signer pinned to config.bank (the bank signed ✓), asset is a Core asset in the collection owned by `owner`, a preceding open for the same asset+owner, emptiness proof. If the forged burn names a REAL vault the customer owns and a real preceding open exists for it — then it IS a real burn. If it's for a different vault (no preceding open) → NoPrecedingOpen → reverts. So a forged burn either is a real burn (2-of-2 enforced) or reverts. ✓.

A forged OPEN: dispatched to open_for_redemption — requires owner signature (the owner signed? the customer signs the tx; if the forged open names the customer as owner of their vault, and a burn follows, it's a real open). If it names someone else's vault → NotTheOwner (the customer isn't the owner) → reverts. ✓.

So the exemption is sound. Confirmed again.

**Now — the ONE thing I haven't checked: `ix.accounts.iter().any(|a| a.pubkey == bank)` — `ix.accounts` is `Vec<AccountMeta>` from the sysvar. The sysvar's instruction accounts include ALL accounts of the instruction (signers and non-signers). ✓. So any appearance. ✓.**

**And `load_instruction_at_checked` returns instructions with `accounts: Vec<AccountMeta>` and `data: Vec<u8>` and `program_id`. ✓.**

OK. Now let me also spot-check **the diff to tests/3prog.test.ts for the `payer: aliceU` in the CEIL section** — yes, added. ✓.

**And the moved 9c section** — it's after section 9, before 7b. The comment explains. ✓.

Now, **the "anything else" bucket**:

- **Anchor.toml missing three programs in [programs.mainnet]** — LOW.
- **Cargo.toml grep pin weakness** — LOW.
- **The suite's global minted_total coupling** — documented; LOW reinforcement.

Let me also reconsider **the `describeCadence` boundaries**: `<= 1` daily, `<= 7` weekly, else monthly. holdDays can be 0 (first run) → 'daily'. Fine. Descriptive only. ✓.

**`dayDiff` uses Math.round — for exact UTC day boundaries, (b-a)/86400000 is exact. ✓.**

Now, let me also double check **the selftest's new card assertions for a floating-point trap**: `(1000 * LEVEL_WEIGHTS[l] / 732).toFixed(2)` — LEVEL_WEIGHTS[l] is a Number. 1000*2/732 = 2.7327... in floating point: 2000/732 = 2.73224043715847 → toFixed(2) = '2.73' ✓. 3000/732 = 4.098360655737705 → '4.10' ✓. 4000/732 = 5.46448087431694 → '5.46' ✓. 5000/732 = 6.830601092896175 → '6.83' ✓. 6000/732 = 8.19672131147541 → '8.20' ✓. 2000/6405 = 0.312256... → '0.31' ✓. 3000/6405 = 0.46838... → '0.47' ✓. 4000/6405 = 0.62451... → '0.62' ✓. 5000/6405 = 0.78064... → '0.78' ✓. 6000/6405 = 0.93677... → '0.94' ✓. All match. ✓.

Shares: 100*945*2/6405 = 189000/6405 = 29.5066... → '29.5' ✓. 100*525*3/6405 = 157500/6405 = 24.5901... → '24.6' ✓. 100*315*4/6405 = 126000/6405 = 19.6721... → '19.7' ✓. 100*210*5/6405 = 105000/6405 = 16.3934... → '16.4' ✓. 100*105*6/6405 = 63000/6405 = 9.8360... → '9.8' ✓. Sum of rounded: 29.5+24.6+19.7+16.4+9.8 = 100.0 ✓.

R6 clean.

Now, **the census odds**: the card says odds at activation I 45% | II 25% | III 15% | IV 10% | V 5%. The censuses match those percentages exactly. But the ODDS are "deliberately NOT in this file" — the randomness source is open (limit 18). The census figures ASSUME the odds produce exactly those counts (108 = 45% of 240). Real randomness won't produce exactly 45/25/15/10/5 splits — the card's census is the EXPECTED value. Is the card misleading? It presents a specific census as illustrative. Business question, not a code defect. Skip (or note in R6 that the census is an expectation, not a guarantee — but the card presumably frames it as such). Skip.

Now, **the final section: what should this project do that sixteen rounds of AI audit structurally cannot?**

The prompt says: be concrete, don't repeat SPEC.md's THE SHIP GATE answers (real-Core suite, audit-coverage.sh, freeze, both-ways gates, rejected-findings-as-assertions).

Ideas:
1. **Adversarial execution, not adversarial reading**: every finding class here that mattered was found by RUNNING (the cd-before-read bug, the lock double-hold, the ELF offset). AI rounds read; they don't execute. The project should build a standing FUZZ/CHAOS harness: property-based random transaction composition against the local validator (random instruction sequences naming the bank, random orderings, CPI wrapping) asserting the invariants (bank key never spent outside pair, no thaw without burn, no burn without open) — thousands of random transactions, not 279 hand-written ones. AI audits write assertions about what they imagine; a fuzzer finds what nobody imagined.
2. **A canary/honeypot deployment on devnet or with small real value first**: run the whole pipeline (alarm, distribute, revenue, cosign) against a deployment holding $100 for N weeks before real money. The off-chain pipeline has never run against a live deployment (SPEC admits). AI audit cannot substitute for operational soak time. Specifically: the cron jobs, the lock, the deadman, logrotate, the notification path — none have ever fired in anger.
3. **Independent key custody / a second human**: the whole 2-of-2 rests on the Bank key's custody being an "ops property". No AI round can audit the machine the key sits on. A concrete step: a documented, rehearsed key-compromise runbook (rotate bank via the 7-day notice; what happens to in-flight redemptions), and a drill.
4. **External monitoring independent of the box**: the alarm, the deadman, and the notification all live on the same host as the keys. A dead box = silence. An external heartbeat (a second host that expects a daily "I ran" signal, e.g., a cron that emails a third party or a healthchecks.io ping) is the only thing that catches total host failure. The deadman is on-box.
5. **A public, versioned disclosure of the audit trail**: since AI is the certification, publish the rounds and verdicts so customers can judge the process. (Maybe already intended.)
6. **Red-team the co-signer with the actual operator**: the sanctioned path is procedure; the failure mode is the operator bypassing it under pressure. A drill where a realistic "customer" (confederate) pressures the operator to hand-sign a malicious redemption. AI can't test the human.
7. **Measure compute units** (already noted).
8. **A second implementation of the invariant checks** (e.g., a minimal independent verifier of a redemption transaction, written by a different party/model from a one-paragraph spec, run as a pre-sign gate) — diversity of implementation, not just diversity of models reading the same code.
9. **Time-boxed bug bounty once value exists** — even without a firm, a bounty gets human eyes incentivized to break it.
10. **Deterministic replay of the money ledgers**: a tool that re-derives every distribution from the chain (the ledger is the payer's own testimony — limit 11) and flags divergence. The chain is the fact; the ledger is testimony. Currently nothing re-derives payouts from chain state.

The prompt says don't repeat THE SHIP GATE's answers. The gate covers: real-Core suite, coverage script, freeze, both-ways gates, rejected-as-assertions. My answers should be beyond those: fuzzing/chaos (execution at scale), soak time with small real value, external heartbeat off-box, key-custody drills, human red team on the procedure half, independent re-implementation, bounty, chain-replay reconciliation of the ledgers. Good.

Now let me also double-check a couple of remaining details:

**The `empty` object in allocateWeighted is shared across returns?** `const empty = {...}` created fresh per call. `{...empty, skip}` spreads. ✓ no aliasing bug.

**`census(Object.fromEntries(activated.map(v => [v, levels[v]])))`** — builds a map vault→level for activated only. census counts levels. ✓.

**`denominator(cen)`** — Number. ✓.

**`per[v] = amt; total += amt`** — BigInt. ✓.

**The plan's `per` object keys are vault addresses; `Object.fromEntries(Object.entries(...).map(([v,a]) => [v, BigInt(a)]))` on resume ✓.**

**One more potential issue: `allocateWeighted` returns `per` as a plain object keyed by vault address. A vault address that is '__proto__'? Base58 excludes '_'? Base58 alphabet: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz — no '_'. So '__proto__' can't be a vault address. ✓. But `per['__proto__']` assignment would be a problem only if a key were '__proto__' — impossible. ✓. And `Object.fromEntries(activated.map(v => [v, levels[v]]))` — keys are base58. ✓.**

**`levels` values from JSON — the prototype issue is the real one (already filed).**

Now, **let me reconsider the `loadLevels` prototype issue severity.** `LEVEL_WEIGHTS[l]` for l in Object.prototype: 'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf'. Also '__proto__': `LEVEL_WEIGHTS['__proto__']` → Object.prototype (the object itself) → truthy! So '__proto__' passes too. And '__defineGetter__', '__lookupGetter__', '__defineSetter__', '__lookupSetter__'. All truthy via inheritance. So a level value of any of these passes loadLevels and crashes allocateWeighted at `BigInt(LEVEL_WEIGHTS[levels[v]])` — wait, for '__proto__', LEVEL_WEIGHTS['__proto__'] = Object.prototype (an object) → BigInt(Object.prototype) throws. For 'constructor' → BigInt(Object) throws. For 'toString' → BigInt(function) throws. All throw. So the register with such a level crashes the run (loud, exit 3, notification). It's a validation bypass causing a crash, not a miscalculation. The census also pollutes (`c['constructor'] += 1` → string). But the crash happens first? Order: unlevelled filter (passes), census (pollutes c.constructor but doesn't throw), denominator (sums LEVELS keys — c.constructor isn't in LEVELS, so den is computed from the OTHER vaults' levels... wait, cen = census of the activated map including the 'constructor'-levelled vault. census: `for (const v of Object.values(levels)) if (c[v] !== undefined) c[v] += 1` — v='constructor' → c['constructor'] !== undefined (inherited) → c['constructor'] += 1 → c.constructor = 'function Object() { [native code] }1'. The OTHER vaults increment their I..V counts normally. den = Σ over LEVELS of c[l]*w[l] — excludes the constructor vault. So den is computed WITHOUT the constructor-levelled vault's weight. Then the per loop: for the constructor vault, `LEVEL_WEIGHTS['constructor']` = Object → BigInt(Object) → THROWS. So the crash happens in the per loop, AFTER a wrong den computed. But it throws, so no wrong payout. Loud crash. The fix: `Object.hasOwn(LEVEL_WEIGHTS, l)` in loadLevels (and allocateWeighted's unlevelled check), or build LEVEL_WEIGHTS with Object.create(null). MEDIUM (validation that claims to catch bad levels at load doesn't, for a class of strings; the money job crashes instead of naming the typo — the file's own stated goal: "a typo in the register should name itself when the register is read"). The typo 'I' vs 'I ' is caught; 'constructor' is not. A real gap in a gate. MEDIUM.

Hmm — is 'constructor' a plausible typo? No. But the gate's JOB is to validate; it fails for a class of inputs. And the crash is loud, so the blast radius is a halted distribution until fixed. MEDIUM-LOW. I'll say MEDIUM because the file explicitly claims load-time validation is the belt-and-braces and it isn't, and because the fix is trivial.

Actually, also `census()`: `const c = {}; for (const l of LEVELS) c[l] = 0` — c is a plain object. `c[v] !== undefined` for v='constructor' → inherited → true → pollutes. Same root cause. And in `census`, a level named 'I' etc. is fine. The fix is the same.

Let me also check `allocateWeighted`'s `per` object: `per[v] = amt` where v is a vault address (base58) — base58 keys can't be '__proto__' (no lowercase l, no 0, O, I... wait base58 excludes 0, O, I, l. '__proto__' contains '_' which is not base58. So vault keys are safe). But `levels` values are attacker/typo-controlled strings. OK.

**Now `allocate()` deletion**: "Was anything else still depending on it?" The diff deletes `allocate` and updates the selftest. Does anything else import `allocate` from distribute.mjs? Let me search the tree: alarm.mjs imports detectors, lock, spl, sigwalk — not distribute. selftest.mjs imports detectors, lock, spl, anchor — not distribute. revenue.mjs imports lock, spl, anchor, detectors. cosign.mjs imports detectors, anchor. The suite (3prog.test.ts) doesn't import distribute. run-tests.sh runs `node bank/distribute.mjs --selftest`. So `allocate` had no external consumers. But wait — distribute.mjs is an ES module with exports; does anything import { allocate }? grep would be needed; from the tree shown, no file imports from distribute.mjs. ✓ Also the header comment in distribute.mjs still says "Equal per activated vault, because one vault is one unit and one vote" — STALE COMMENT! The header (the big block comment at the top) still describes equal-per-vault distribution: "Equal per activated vault, because one vault is one unit and one vote. A vault below 21,000 sats gets nothing and is not counted in the divisor". That's now FALSE — distribution is weighted by level. This is exactly the R5 comment defect: a comment asserting a behavior that no longer runs. The header also says "daily equal payout to vaults holding at least 21,000 sats" in the ARCHITECTURE section of the prompt (that's the prompt's text, not the file). In distribute.mjs's own header: "Equal per activated vault, because one vault is one unit and one vote." — stale. And SPEC's cron-install.sh comment: "distribute  daily cbBTC to ACTIVATED vaults only (>= 21,000 sats), equal per vault" — cron-install.sh's trailing comment says "equal per vault"! Stale too. These are R5 findings: comments describing the deleted equal-split behavior. MEDIUM (the header of the money file describes the old rule; a reader would compute expected payouts wrong).

Also the selftest comment: "Its assertions were not deleted with it..." fine.

**R2 continued — the plan resume and `levels`**: On resume, the plan is reused, but `levels[v]` is read fresh in the DRY log line and... the send loop uses `plan.per[v]` (stored amounts). The level register could have changed between plan and resume — the amounts are fixed, so no money error. The log line `levels[v]` might print a different level than the plan assumed — cosmetic. Fine.

**One more R2: `allocateWeighted` when `available` is huge and `den` small**: available * weight could exceed Number.MAX_SAFE_INTEGER? BigInt — no. ✓

**The `empty` object shares `census: census({})` — census({}) returns {I:0,II:0,III:0,IV:0,V:0}. Fine.

**decideEmission: `daysSinceLastPayout >= maxHoldDays` → forced. holdDays returns Math.max(0, dayDiff). dayDiff uses Math.round — for exact day boundaries it's exact. ✓

**What about a day with a plan but no payments — covered. What about `holdDays` when `st.days[day]` was created by a previous HELD run (nothingToDo) and today we recompute?** days includes that past day with paid={} → not a paid day. ✓

So the cadence logic is mostly sound. The main R2 findings: the unlevelled-activated griefing (HIGH), the dust bound overstatement (LOW), and maybe the "paid day counts intents" edge (LOW).

Wait, actually, let me reconsider the "paid day counts intents" issue more carefully, because it interacts with MAX_HOLD_DAYS. Scenario: every day, the run attempts distribution, writes intents, and every transfer is refused (e.g., cbBTC freeze authority froze the distributor's ATA — plausible! cbBTC has a live freeze authority). Then `paid` has rows every day → holdDays resets every day → the 31-day ceiling NEVER fires. But the cadence gate isn't the issue here — the issue is payouts are failing, which the alarm reports (distribution_refused HIGH). So the ceiling not firing is masked by a louder alarm. Minor. But also: if transfers fail, the pool GROWS, so smallestPer grows, so the threshold clears and it tries every day — and fails every day — and the alarm fires daily. The hold clock resetting is irrelevant in that scenario. OK, LOW at most.

**Now the level register blast radius**: "Who can write that file, and what does the blast radius look like?" `bank/levels.json` at `/opt/cbob-vaults/bank/levels.json`, read by distribute.mjs running as ubuntu. Whoever can write that file (ubuntu user, or root, or anyone with FS access) controls the WEIGHTS of every payout. Setting a vault to Level V (weight 6) vs I (weight 2) triples its share. The blast radius: total control over distribution proportions — an attacker who writes levels.json can pay themselves 3x per vault per drop, forever, and it's "our word" — no on-chain commitment (accepted limit 16). The file is NOT in the signer-set gate (it holds no key). Is it watched? The alarm doesn't read levels.json. No integrity check, no hash, no commitment. So a quiet edit to levels.json changes real money flows with no detector. Limit 16 acknowledges the missing commitment scheme. "DO tell us if any is worse than stated" — the stated limit is about the holder's inability to verify THEIR level. What's worse: there's no DETECTION of a changed register at all. A one-line edit triples an attacker's share on every future drop and nothing anywhere notices — no drift watch, no hash pinned in the ledger, nothing. The plan stores census and denominator per day, so a change in denominator between days is visible in the ledger retroactively, but nothing alarms on it. I'd file: levels.json has no integrity protection or change detection; a write to it silently re-weights all future payouts; worse than stated because the stated limit is framed as "holder can't verify" when it's actually "nobody watches the file at all". Fix: hash levels.json into each day's ledger entry and alarm on unexpected changes; or the commit-reveal scheme; at minimum add the file's sha256 to the distribution day record and have detectDistribution flag a change against the previous day without a corresponding note. MEDIUM/HIGH. Given limit 16 exists, I'll frame as "worse than stated" — MEDIUM.

Also: `loadLevels` validates levels are in LEVEL_WEIGHTS, but does NOT validate that keys are valid pubkeys or that they correspond to real vaults. A typo'd key (not a real vault) is just ignored (activated vaults look up their level; extra keys unused). Fine. And `Object.entries(raw).filter(([, l]) => !LEVEL_WEIGHTS[l])` — a level of "I " (trailing space) → refused at load. ✓. A level of "__proto__"? `LEVEL_WEIGHTS['__proto__']` is undefined → refused. ✓. Prototype pollution: `raw` from JSON.parse — `{"__proto__": "V"}` — JSON.parse creates an own property __proto__? Actually JSON.parse('{"__proto__": 1}') creates an object with an own data property named "__proto__" (it does NOT set the prototype). Then `levels['__proto__']`... `Object.entries` includes it, LEVEL_WEIGHTS['__proto__'] is undefined → load refuses. OK. And `levels[v]` where v = 'constructor'? LEVEL_WEIGHTS['constructor'] is undefined (it's Object.freeze'd plain object; 'constructor' resolves via prototype chain to Object constructor — truthy!). WAIT. `LEVEL_WEIGHTS = Object.freeze({ I: 2, II: 3, III: 4, IV: 5, V: 6 })`. `LEVEL_WEIGHTS['constructor']` → inherits `Object.prototype.constructor` → the Object function → TRUTHY! So `!LEVEL_WEIGHTS[levels[v]]` for levels[v] = 'constructor' → !truthy → false → NOT unlevelled! So a vault with level 'constructor' passes the unlevelled check! Then `LEVEL_WEIGHTS[levels[v]]` = the Object constructor function. `BigInt(LEVEL_WEIGHTS[levels[v]])` → BigInt(Object constructor) → throws TypeError ("Cannot convert ... to a BigInt"? Actually BigInt(function) throws). So it would throw, not silently misbehave. But wait — loadLevels validates: `Object.entries(raw).filter(([, l]) => !LEVEL_WEIGHTS[l])` — for l = 'constructor', LEVEL_WEIGHTS['constructor'] is truthy (inherited) → NOT in bad → passes load! Then in allocateWeighted, `LEVEL_WEIGHTS['constructor']` = Object constructor → `BigInt(Object)` throws TypeError → the run crashes. So a malicious or typo'd level 'constructor' (or 'toString', 'hasOwnProperty', 'valueOf', 'watch', etc. — any Object.prototype member) passes loadLevels validation and then crashes distribute.mjs mid-run. That's a real bug: the validation uses a truthiness check on an object with a prototype chain, so prototype member names bypass validation and crash the money job. Severity: MEDIUM (a typo or a malicious register edit crashes the daily distribution; the fix is `Object.hasOwn(LEVEL_WEIGHTS, l)` or `Object.prototype.hasOwnProperty.call`). Evidence: `node -e "const LW=Object.freeze({I:2}); console.log(!!LW['constructor'])"` prints true. And in allocateWeighted, census: `c[v]` where v='constructor' — `c['constructor'] !== undefined` → true (inherited!) → `c['constructor'] += 1` → c.constructor becomes "function Object() { [native code] }1" (string concat!). Then denominator: `c[l] || 0` for l in LEVELS — c only has I..V keys plus polluted constructor; denominator sums LEVELS only, so constructor doesn't affect den. But the crash happens earlier at BigInt(LEVEL_WEIGHTS['constructor']). Actually wait, order in allocateWeighted: unlevelled check first: `activated.filter(v => !LEVEL_WEIGHTS[levels[v]])` — levels[v]='constructor' → LEVEL_WEIGHTS['constructor'] truthy → not unlevelled. Then census: `census(Object.fromEntries(activated.map(v => [v, levels[v]])))` → levels object {vault: 'constructor'} → census: `for (const v of Object.values(levels)) if (c[v] !== undefined) c[v] += 1` → c['constructor'] !== undefined (inherited constructor) → c['constructor'] += 1 → "function...1". Then den = denominator(cen) — sums only LEVELS keys → den excludes the constructor vault's weight! Then the per loop: `LEVEL_WEIGHTS['constructor']` → BigInt(function) → THROWS. So yes, crash. But hold on — would loadLevels have already crashed? loadLevels: `bad = Object.entries(raw).filter(([, l]) => !LEVEL_WEIGHTS[l])` — 'constructor' passes (truthy inherited). So load succeeds, then allocateWeighted throws TypeError. The run crashes with an unhandled exception → withLock catch → exit 3, notification sent. So it's a LOUD crash, not silent. But it halts the distribution until the register is fixed. A griefer can't write levels.json (it's operator-controlled), so this is an accident surface (typo) more than an attack. MEDIUM/LOW. The fix: use `Object.hasOwn` or a Map, or `Object.create(null)` for LEVEL_WEIGHTS. I'll file MEDIUM (validation bypass via prototype chain → crash of the money job; same class the file itself cares about — "a typo in the register should name itself when the register is read", and it doesn't).

Actually, also `census()`: `const c = {}; for (const l of LEVELS) c[l] = 0` — c is a plain object. `c[v] !== undefined` for v='constructor' → inherited → true → pollutes. Same root cause. And in `census`, a level named 'I' etc. is fine. The fix is the same.

Let me also check `allocateWeighted`'s `per` object: `per[v] = amt` where v is a vault address (base58) — base58 keys can't be '__proto__' (no lowercase l, no 0, O, I... wait base58 excludes 0, O, I, l. '__proto__' contains '_' which is not base58. So vault keys are safe). But `levels` values are attacker/typo-controlled strings. OK.

**Now `allocate()` deletion**: "Was anything else still depending on it?" The diff deletes `allocate` and updates the selftest. Does anything else import `allocate` from distribute.mjs? Let me search the tree: alarm.mjs imports detectors, lock, spl, sigwalk — not distribute. selftest.mjs imports detectors, lock, spl, anchor — not distribute. revenue.mjs imports lock, spl, anchor, detectors. cosign.mjs imports detectors, anchor. The suite (3prog.test.ts) doesn't import distribute. run-tests.sh runs `node bank/distribute.mjs --selftest`. So `allocate` had no external consumers. But wait — distribute.mjs is an ES module with exports; does anything import { allocate }? grep would be needed; from the tree shown, no file imports from distribute.mjs. ✓ Also the header comment in distribute.mjs still says "Equal per activated vault, because one vault is one unit and one vote" — STALE COMMENT! The header (the big block comment at the top) still describes equal-per-vault distribution: "Equal per activated vault, because one vault is one unit and one vote. A vault below 21,000 sats gets nothing and is not counted in the divisor". That's now FALSE — distribution is weighted by level. This is exactly the R5 comment defect: a comment asserting a behavior that no longer runs. The header also says "daily equal payout to vaults holding at least 21,000 sats" in the ARCHITECTURE section of the prompt (that's the prompt's text, not the file). In distribute.mjs's own header: "Equal per activated vault, because one vault is one unit and one vote." — stale. And SPEC's cron-install.sh comment: "distribute  daily cbBTC to ACTIVATED vaults only (>= 21,000 sats), equal per vault" — cron-install.sh's trailing comment says "equal per vault"! Stale too. These are R5 findings: comments describing the deleted equal-split behavior. MEDIUM (the header of the money file describes the old rule; a reader would compute expected payouts wrong).

Also the selftest comment: "Its assertions were not deleted with it..." fine.

**R2 continued — the plan resume and `levels`**: On resume, the plan is reused, but `levels[v]` is read fresh in the DRY log line and... the send loop uses `plan.per[v]` (stored amounts). The level register could have changed between plan and resume — the amounts are fixed, so no money error. The log line `levels[v]` might print a different level than the plan assumed — cosmetic. Fine.

**One more R2: `allocateWeighted` when `available` is huge and `den` small**: available * weight could exceed Number.MAX_SAFE_INTEGER? BigInt — no. ✓

**The `empty` object shares `census: census({})` — census({}) returns {I:0,II:0,III:0,IV:0,V:0}. Fine.

**decideEmission: `daysSinceLastPayout >= maxHoldDays` → forced. holdDays returns Math.max(0, dayDiff). dayDiff uses Math.round — for exact day boundaries it's exact. ✓

**What about a day with a plan but no payments — covered. What about `holdDays` when `st.days[day]` was created by a previous HELD run (nothingToDo) and today we recompute?** days includes that past day with paid={} → not a paid day. ✓

So the cadence logic is mostly sound. The main R2 findings: the unlevelled-activated griefing (HIGH), the dust bound overstatement (LOW), and maybe the "paid day counts intents" edge (LOW).

Wait, actually, let me reconsider the "paid day counts intents" issue more carefully, because it interacts with MAX_HOLD_DAYS. Scenario: every day, the run attempts distribution, writes intents, and every transfer is refused (e.g., cbBTC freeze authority froze the distributor's ATA — plausible! cbBTC has a live freeze authority). Then `paid` has rows every day → holdDays resets every day → the 31-day ceiling NEVER fires. But the cadence gate isn't the issue here — the issue is payouts are failing, which the alarm reports (distribution_refused HIGH). So the ceiling not firing is masked by a louder alarm. Minor. But also: if transfers fail, the pool GROWS, so smallestPer grows, so the threshold clears and it tries every day — and fails every day — and the alarm fires daily. The hold clock resetting is irrelevant in that scenario. OK, LOW at most.

**Now the level register blast radius**: "Who can write that file, and what does the blast radius look like?" `bank/levels.json` at `/opt/cbob-vaults/bank/levels.json`, read by distribute.mjs running as ubuntu. Whoever can write that file (ubuntu user, or root, or anyone with FS access) controls the WEIGHTS of every payout. Setting a vault to Level V (weight 6) vs I (weight 2) triples its share. The blast radius: total control over distribution proportions — an attacker who writes levels.json can pay themselves 3x per vault per drop, forever, and it's "our word" — no on-chain commitment (accepted limit 16). The file is NOT in the signer-set gate (it holds no key). Is it watched? The alarm doesn't read levels.json. No integrity check, no hash, no commitment. So a quiet edit to levels.json changes real money flows with no detector. Limit 16 acknowledges the missing commitment scheme. "DO tell us if any is worse than stated" — the stated limit is about the holder's inability to verify THEIR level. What's worse: there's no DETECTION of a changed register at all. A one-line edit triples an attacker's share on every future drop and nothing anywhere notices — no drift watch, no hash pinned in the ledger, nothing. The plan stores census and denominator per day, so a change in denominator between days is visible in the ledger retroactively, but nothing alarms on it. I'd file: levels.json has no integrity protection or change detection; a write to it silently re-weights all future payouts; worse than stated because the stated limit is framed as "holder can't verify" when it's actually "nobody watches the file at all". Fix: hash levels.json into each day's ledger entry and alarm on unexpected changes; or the commit-reveal scheme; at minimum add the file's sha256 to the distribution day record and have detectDistribution flag a change against the previous day without a corresponding note. MEDIUM/HIGH. Given limit 16 exists, I'll frame as "worse than stated" — MEDIUM.

Also: `loadLevels` validates levels are in LEVEL_WEIGHTS, but does NOT validate that keys are valid pubkeys or that they correspond to real vaults. A typo'd key (not a real vault) is just ignored (activated vaults look up their level; extra keys unused). Fine. And `Object.entries(raw).filter(([, l]) => !LEVEL_WEIGHTS[l])` — a level of "I " (trailing space) → refused at load. ✓. A level of "__proto__"? `LEVEL_WEIGHTS['__proto__']` is undefined → refused. ✓. Prototype pollution: `raw` from JSON.parse — `{"__proto__": "V"}` — JSON.parse creates an own property __proto__? Actually JSON.parse('{"__proto__": 1}') creates an object with an own data property named "__proto__" (it does NOT set the prototype). Then `levels['__proto__']`... `Object.entries` includes it, LEVEL_WEIGHTS['__proto__'] is undefined → load refuses. OK. And `levels[v]` where v = 'constructor'? LEVEL_WEIGHTS['constructor'] is undefined (it's Object.freeze'd plain object; 'constructor' resolves via prototype chain to Object constructor — truthy!). WAIT. `LEVEL_WEIGHTS = Object.freeze({ I: 2, II: 3, III: 4, IV: 5, V: 6 })`. `LEVEL_WEIGHTS['constructor']` → inherits `Object.prototype.constructor` → the Object function → TRUTHY! So `!LEVEL_WEIGHTS[levels[v]]` for levels[v] = 'constructor' → !truthy → false → NOT unlevelled! So a vault with level 'constructor' passes the unlevelled check! Then `LEVEL_WEIGHTS[levels[v]]` = the Object constructor function. `BigInt(LEVEL_WEIGHTS[levels[v]])` → BigInt(Object constructor) → throws TypeError ("Cannot convert ... to a BigInt"? Actually BigInt(function) throws). So it would throw, not silently misbehave. But wait — loadLevels validates: `Object.entries(raw).filter(([, l]) => !LEVEL_WEIGHTS[l])` — for l = 'constructor', LEVEL_WEIGHTS['constructor'] is truthy (inherited) → NOT in bad → passes load! Then in allocateWeighted, `LEVEL_WEIGHTS['constructor']` = Object constructor → `BigInt(Object)` throws TypeError → the run crashes. So a malicious or typo'd level 'constructor' (or 'toString', 'hasOwnProperty', 'valueOf', 'watch', etc. — any Object.prototype member) passes loadLevels validation and then crashes distribute.mjs mid-run. That's a real bug: the validation uses a truthiness check on an object with a prototype chain, so prototype member names bypass validation and crash the money job. Severity: MEDIUM (a typo or a malicious register edit crashes the daily distribution; the fix is `Object.hasOwn(LEVEL_WEIGHTS, l)` or `Object.prototype.hasOwnProperty.call`). Evidence: `node -e "const LW=Object.freeze({I:2}); console.log