[reasoning only]
Let me work through this carefully. This is round 34 of an ongoing audit of five Solana programs (SEAL, MINT, BURN, GOV, SWEEP) plus off-chain pipeline. Round 33's verdict is bundled and is my first target (R0).

Round 33 verdict: NOT CLEAN, QUORUM MET. Four confirmed findings:
- L1 (LOW): stranger can pre-fund program ids to block standard deploy; repair = deploy runbook note in SPEC road step 9.
- D1 (INFO): SPEC REDEEMING step 1 stale sentence about "does not fit one legacy transaction".
- D2 (INFO): DESIGN-v6 lines 314-315 says MIN_ROUND_PRICE_SATS "fixed at initialize" but it's a compile-time constant.
- D3 (INFO): suite arm 2.1 cannot fail (records `String(!!V.asset)` which is always true).

Plus gate-5 obligations: pin three measured refutations (W1a worst single-signature reveal, W1b many-signer autograph, W2 None-authority royalty re-delegation).

Round 33's VALIDATION.md (bundled) says repairs were made:
- L1: road step 9 updated with pre-deploy read and recovery path.
- D1: SPEC REDEEMING step 1 restated.
- D2: DESIGN says compiled in.
- D3: arm 2.1 records vMint.ok.
- Gate 5: R33.G1, R33.G2a/G2b, R33.G3, R33.G4 arms added; floor 861 -> 866.
- Off-chain: detectSweepState symmetric window, mint.last_sweep_at watched, launch count reader.

The commits show `82bb3ef fix(vaults): repair round 33 findings and pin five more gate-5 refutations` and `90a05ff docs(vaults): record round 33 build and rehearsal validation`.

So my job (R0): verify those repairs hold in this tree, then independently audit the whole tree for surviving defects.

Let me check the repairs first:

1. **D3 (arm 2.1)**: In the bundled `tests/3prog.test.ts`, I see:
```js
const vMint=await att(()=>send([ixMint(V.asset,alice.publicKey,alice.publicKey,{attrs:[]})],[alice,vKp]))
...
rec('2.1','a vault minted in a voted round','ALLOW',vMint.ok?'ALLOW':'REJECT',vMint.err)
```
Yes — "Round 33 (D3): the mint's own outcome, not a keypair that exists either way." The repair is present. Good.

2. **D2 (DESIGN-v6)**: In bundled DESIGN-v6.md, section 6a: "`set_round` refuses any price below `MIN_ROUND_PRICE_SATS`, a constant compiled into the program (no `initialize` argument sets it)." Yes — the repair is present: "a constant compiled into the program (no `initialize` argument sets it)". Good.

3. **D1 (SPEC REDEEMING step 1)**: In bundled SPEC.md, REDEEMING step 1: "create the destination token accounts, and (round 24, A3) any of the VAULT's three reserve accounts that does not exist yet, so the sweep in step 2 can name all three. This step is separate by contract (limit 42): the fully padded page shape with all three creates does not fit a legacy packet (1,367 bytes), although a narrow owner-payer shape does (1,219 bytes, round 26 D4; an offline size measurement, not a landed transaction), and missing reserve accounts are a separate reason." Yes — repaired, matches limit 42's language.

4. **L1 (road step 9)**: SPEC road step 9 now includes: "⚠️ Round 33 (L1): immediately before deploying, read all five program-id addresses; a stranger can pre-fund one (any rent-exempt amount, at least 890,880 lamports; the measurement used 0.01 SOL) so `solana program deploy` refuses it ("already in use"). Measured recovery without changing the id: in one transaction, top the account up to the 36-byte rent-exempt minimum (1,141,440 lamports) if it holds less, and have the program keypair sign System `Allocate(36)` and `Assign(BPFLoaderUpgradeable)`; then `write-buffer` and a hand-built loader `DeployWithMaxDataLen` land, and `program show` reports our upgrade authority (`.cache/triage33p/dusted-recover.mjs`). Rehearse this recovery at a throwaway id before step 9, including with exactly 890,880 lamports of dust (the top-up case is reasoned, not yet measured)." Present. Good.

5. **Gate-5 arms**: R33.G1 (worst single-signature shape revealed), R33.G2a/G2b (many-signer autograph), R33.G3 (royalty re-delegation 0x1b), R33.G4 (wSOL close). Let me check these in the bundled suite:

- R33.G1: In the suite, after `revealAll()` in section 10: "ROUND 33 (gate 5): both owner-reachable worst shapes were revealed by MINT in FIFO order just now, at the default compute budget, with nothing removed." with `rec('R33.G1',...)` checking `await lv(worstShape)` and autograph message length 10198. And the setup in L.12 block: `worstShape=kAt.publicKey` after adding the autograph via PADTAIL wrapper. Present.

Wait — there's a subtlety. The R33.G1 arm checks that the vault was revealed. But the reveal happens in `revealAll()` called in section 10 ("await revealAll()" after mintCU). The arm is after that. Let me check ordering: In the L.12 block, `kAt` vault is minted via v0 with `exact()` attributes (640 bytes), then autograph added. Then in section 10, `await revealAll()` is called after the CU measurements... Actually looking at the code: `const cuPlain=await mintCU(0), cuWide=await mintCU(maxPad); await revealAll()`. Then the R33.G1/G2b arms. So yes, revealAll() reveals all pending vaults in mint order, including kAt (worstShape) and cv (crowdShape). The arms then check the level is 1-5 and the autograph survived. Present.

But wait — does `revealAll()` handle the vaults minted by `mintCU`? Those are minted with `mkV(k,alice,[])`. And kAt was minted with `mkV(kAt,alice,exact())`. And cv with `mkV(cv,alice,[])` — wait, `const cv=await mkVault(0n)` which uses `mkVault` helper that does `mkV(kp,alice,prov)` with prov=[]. OK.

One question: does the reveal of the worst-shape vault actually exercise the "default compute budget" claim? The `ixReveal` sends don't set a compute limit, so they run at the default 200,000 CU per instruction. Round 33 measured 47,971 CU for the isolated shape, so it lands. The arm checks the level was drawn. OK.

- R33.G2a: the many-signer autograph growth via SIGSPDA! wrapper mode. Present in the suite with `rec('R33.G2a',...)` checking `kept>=20`, heap refusal, `now===kept`. And R33.G2b checks reveal with every kept signature. Present.

- R33.G3: royalty re-delegation refused 0x1b, control lands. Present.

- R33.G4: stranger's pre-filled wSOL account closes under swap's own instructions. Present.

6. **Off-chain repairs** (detectSweepState, mint.last_sweep_at, launch count reader): These are in bank/detectors.mjs and bank/selftest.mjs, which are NOT bundled in this prompt. The prompt bundles only a subset of files. Hmm. The audit-coverage gate requires every file's current content to have been bundled in a completed quorate round. But this prompt doesn't include bank/detectors.mjs, bank/alarm.mjs, bank/crank.mjs, bank/revenue.mjs, bank/swap.mjs, bank/selftest.mjs, bank/accrual.mjs, bank/layout.mjs, bank/lock.mjs, bank/redemption-poster.mjs, scripts/check-launch-params.mjs, scripts/run-tests.sh is included, scripts/build-mainnet.sh included... 

Wait, actually the prompt says "THIS IS v6, A REDESIGN, AND THIS ROUND READS IT WHOLE. Nothing below is a diff: you get the files whole." But the bundled files are a subset. The off-chain detectors etc. are not bundled. So I can only audit what's bundled. The round-33 off-chain verdict is referenced but not bundled (only VERDICT-programs.md and VALIDATION.md are bundled). So my focus should be the programs pass primarily, but the prompt asks about the whole tree.

Given the files bundled, I should focus on: the five programs, the suite, the sim, the scripts (run-tests, build-mainnet, rehearsal-tree, token-programs, audit-coverage, validate-core-gate, pob-merkle, probe-mainnet-facts), tests (initauth, probe-round5, probe-round5b, expiry-budget, cpi-wrapper), sim fixtures, launch/mainnet-init.json, SPEC, DESIGN-v6, HOLDER-GUIDE, Anchor.toml, Cargo.toml, the round-33 verdict and validation, RT3.

Now let me hunt for real defects. Let me go through the targets systematically.

**R0: Round 33 verdict verification** — done above; all four repairs present in the bundled files. The gate-5 arms are present. The off-chain repairs can't be verified from this bundle (detectors.mjs not included), but VALIDATION.md records them with selftest 909/909.

Wait — one thing to check: the suite floor. run-tests.sh says MIN_ASSERTIONS=866 with the comment "ROUND 33 (gate 5: worst single-signature and many-signer reveal shapes, royalty re-delegation, wSOL close): 861 -> 866." Let me count: round 32 was 861, round 33 added R33.G1, R33.G2a, R33.G2b, R33.G3, R33.G4 = 5 new arms → 866. ✓.

Also VALIDATION says detector selftest 909/909, and run-tests.sh has DET_FLOOR=909. ✓ (was 907 in round 32, +2 for the sweep window arms... actually VALIDATION says 908 then 909 after fixes. The floor is 909.)

Launch floor 47, poster 23, PoB 14, host 6, mainnet 33, expiry 4, sim 71, swap-fork 16. These match SPEC's stated counts.

Now — is there anything in the round-33 verdict that was NOT repaired? The verdict's "Remaining requirements" lists: repair L1, D1, D2, D3 (done); gate 5 pins (done); items 22, 38, 50, 52, 53 remain open (they're OPEN AND BLOCKING items, not new findings). charter_opens_at and lock_deadline remain unset (still null in launch/mainnet-init.json — confirmed in the bundle: both are null/OPEN). That's consistent with item 38 being OPEN AND BLOCKING.

Now let me look for NEW defects. Let me go target by target.

**R1: Custody — the open/burn pairing.**

SEAL's `open_for_redemption` walks forward from `current+1` looking for a top-level `burn_vault` with matching asset (account 0) and owner (account 2). BURN's `burn_vault` walks backward from 0..current for a matching open. Both bind asset and owner.

Attack vectors:
- CPI wrappers: `load_instruction_at_checked` sees only top-level instructions. A wrapped burn is invisible to SEAL's walk; a wrapped open is invisible to BURN's walk. WR.1-WR.4 test this. ✓
- Two vaults in one transaction: open A, burn B — refused because asset doesn't match. Open A, open B, burn B, burn A: SEAL's open A finds burn A later (yes, at the end); BURN's burn B finds open B earlier (yes). So both pair. But the rate limit refuses the second burn at cap 1. Tested at 4.10a. At cap 2 (sim S9b), both land. That's intended.
- What about `open A, sweep A, burn A, open B, sweep B, burn B` where the sweeps are interleaved differently? Each open finds its burn later; each burn finds its open earlier. Fine.
- What about open A, burn A, burn A (same vault twice)? The second burn: the asset is already burned (1-byte tombstone), so `burn_vault`'s initial read `d.len() >= 66 && d[0] == KEY_ASSET_V1` fails → NotACoreAsset. Refused. ✓
- What about open A, burn A, open A? The second open: `read_core_asset` fails on the tombstone → NotACoreAsset. Refused. ✓

- The `i += 1` loop in SEAL: `while let Ok(ix) = load_instruction_at_checked(i, &sysvar)`. If an instruction at index i fails to load (returns Err), the loop STOPS (the `while let` ends). Could an attacker place an unloadable instruction between the open and the burn to hide the burn? `load_instruction_at_checked` fails if the index is out of bounds or the sysvar data is malformed. Top-level instructions are all recorded in the sysvar; indices 0..num_instructions are loadable. So no gap. The loop ends at the first index past the end. Fine.

- BURN walks 0..current with `if let Ok(ix)`, skipping errors. Same reasoning — all indices loadable.

- Account-index binding: SEAL checks `ix.accounts.get(BURN_IX_ASSET_IDX)` (0) == asset and `ix.accounts.get(BURN_IX_OWNER_IDX)` (2) == owner. BURN's BurnVault struct: vault_asset (0), collection (1), owner (2), asset_signer (3), payer (4), config (5), seal_config (6), instructions (7), mpl_core (8), system_program (9), mint_program (10), mint_config (11), vault_record (12), pool_token (13). So account 0 = vault_asset, account 2 = owner. ✓ matches the pinned indices.

- SEAL's OpenForRedemption: vault_asset (0), collection (1), owner (2), payer (3), config (4), seal (5), mpl_core (6), instructions (7), system_program (8). BURN checks SEAL_IX_ASSET_IDX=0, SEAL_IX_OWNER_IDX=2. ✓.

- Could a transaction contain a fake "burn_vault" instruction to the real BURN program with the right discriminator and accounts but that would fail? SEAL only checks the instruction EXISTS, not that it succeeds. But if the burn fails, the whole transaction reverts, including the thaw. So no issue.

- Could the burn be for the same asset and owner but the transaction arranged so the burn executes BEFORE the open? SEAL walks FORWARD from current+1, so the burn must be after the open. BURN walks BACKWARD, so the open must be before the burn. Consistent. ✓

- What about the burn being inside a different top-level instruction that itself CPIs to BURN? `load_instruction_at_checked` sees only top-level. A top-level instruction to program X that CPIs burn_vault: SEAL's walk sees program X's instruction, not BURN's, so `ix.program_id == BURN_PROGRAM_ID` fails → not found → thaw refused. Fail closed. ✓

**The emptiness proof (BURN).**

- `asset_signer.lamports() == 0` required.
- Every reserve mint × both token programs: the ATA derived; must be declared; if the account's owner is neither token program, `continue` (skipped — e.g., doesn't exist or is a system account); if it exists as a token account: owner must be the PDA, no delegate (d[72..76]==0), no delegated amount (d[121..129]==0), no close authority (d[129..133]==0), length exactly 165, amount == 0.

Wait — there's a subtle issue. For the Token-2022 derivation of a classic reserve mint: can such an account exist? F4.2 in probe-round5b measured that creating a T22 ATA for a classic mint is REJECTED. So the T22 derivation for a classic mint can never be a token account. It's skipped. Fine.

But what about the classic derivation of a classic mint — that's the real reserve account. Checked. ✓

- The second loop over all remaining accounts: for any account owned by MPL_CORE, refuse if it's a live asset (d[0] == KEY_ASSET_V1). For token-program-owned accounts with lamports > 0 and owner == pda: require len == 165, no delegate/close authority, amount == 0.

Hmm — wait. In the second loop, `if acc.lamports() == 0 { continue; }`. A token account always has lamports (rent). So this skip is for accounts that were closed earlier in the transaction (e.g., by the sweep helper). A closed account has lamports 0 and... its owner? When SPL Token closes an account, it transfers lamports out and... does it change the owner? Let me think. SPL Token CloseAccount: transfers lamports to destination, then sets the account's data length to 0 and owner to System program? Actually, in SPL Token, `CloseAccount` transfers the lamports and then the account is... Let me recall the implementation: it drains lamports and then calls `delete_account` which sets data len to 0 and assigns owner to system program? In the classic SPL Token program, `close_account` does: transfer all lamports from source to destination, then `source.delete()` — wait, actually in the token program, after transferring lamports, it does `**source.try_borrow_mut_lamports()? = 0;` and then `source.realloc(0, false)?` and `source.assign(&system_program::ID)`? Hmm, I believe the classic SPL token program's CloseAccount processor does:

```rust
// Transfer lamports
let source_lamports = **source_account_info.try_borrow_mut_lamports()?;
**source_account_info.try_borrow_mut_lamports()? = 0;
**destination_account_info.try_borrow_mut_lamports()? = destination_account_info
    .lamports()
    .checked_add(source_lamports)
    .ok_or(TokenError::Overflow)?;
// Then delete
source_account_info.realloc(0, false)?;
source_account_info.assign(&system_program::ID);
```

Hmm, actually I'm not 100% sure it assigns to system program. Let me think about what the sweep helper's close does and how BURN's check sees it. The prompt says (R1s e): "BURN requires every reserve mint's ATA under BOTH token programs to be DECLARED, and skips an account no token program owns. The sweep closes what it empties. Show the closed account passes for the right reason."

So after the sweep helper closes the reserve ATA, the account has lamports 0. In BURN's reserve loop: `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }`. If CloseAccount assigns owner to System, then the closed account is skipped by the owner check. If CloseAccount leaves owner as Token but zeroes data, then `d.len() < TOKEN_ACCOUNT_LEN` → `continue`. Either way it passes. In the second loop: `if acc.lamports() == 0 { continue; }` — passes. So the closed account passes for two independent reasons. OK.

Actually wait, in the classic SPL token program, CloseAccount does NOT reassign the owner. Let me check my memory... In spl-token's `process_close_account`:
```rust
    if !source_account_info.data_is_empty() {
        // ... checks
    }
    let destination_starting_lamports = destination_account_info.lamports();
    **destination_account_info.lamports.borrow_mut() = destination_starting_lamports
        .checked_add(source_account_info.lamports())
        .ok_or(TokenError::Overflow)?;
    **source_account_info.lamports.borrow_mut() = 0;
    source_account_info.realloc(0, false)?;
    source_account_info.assign(&system_program::ID);
```
Hmm, I genuinely can't recall whether `assign` is called. In newer versions of spl-token (4.x/5.x), I believe `close_account` does call `source_account_info.assign(&system_program::ID)`? Actually no — I recall that closed token accounts remain owned by the token program with 0 data length and 0 lamports, and they get garbage collected... no wait, accounts with 0 lamports are removed by the runtime at the end of the transaction! That's the key point: an account with 0 lamports is purged by the runtime when the transaction completes. But DURING the transaction (when BURN checks), it still exists with 0 lamports.

So in BURN's reserve loop, the closed account: owner is still Token (or System if reassigned), lamports 0, data len 0 (realloc'd to 0). `d.len() < TOKEN_ACCOUNT_LEN` → continue. Passes "for the right reason" — it's empty and closed. ✓

And the runtime purges 0-lamport accounts at transaction end, so after the redemption the account is gone entirely. Good.

- What about a declared account that is a token account owned by the PDA with amount 0 but NOT closed (the sweep didn't close it)? It passes the emptiness proof (amount == 0, no delegate). It survives the burn with rent stranded. That's the accepted "close what you empty" client obligation (round 24 D8). Not a protocol defect.

- Token-2022 extensions: `d.len() == TOKEN_ACCOUNT_LEN` (165) required in both loops. A T22 account with ImmutableOwner is 170. Refused. ✓

- What about a classic token account with a delegate that was revoked? d[72..76] == [0,0,0,0] after revoke (probe D2). Passes. ✓

- What about `d[121..129]` (delegated_amount) and `d[129..133]` (close_authority COption tag)? For a classic 165-byte account: delegate COption tag at 72..76, delegate pubkey 76..108, state 108, is_native 109..121, delegated_amount 121..129, close_authority COption tag 129..133, close_authority pubkey 133..165. The checks: d[72..76]==0 (no delegate), d[121..129]==0 (no delegated amount), d[129..133]==0 (no close authority). But it doesn't check d[76..108] (the delegate pubkey residue) — irrelevant if tag is 0. And is_native at 109..121: for a native wSOL account, is_native = Some(1) → d[109..113] = [1,0,0,0]. The check doesn't look at is_native. A native wSOL account with amount 0 passes. Fine — wSOL with 0 amount is empty.

Hmm wait, actually there's a subtlety with native accounts: a native wSOL account's `amount` field tracks the wrapped balance, and its lamports = amount + rent. If amount == 0, lamports = rent. The account is empty of value. OK.

**R1s: The sweep helper.**

(a) Access control: called directly, `signer.is_signer` required — the asset-signer PDA can't sign directly, so direct calls fail (SR.1). Through Core ExecuteV1, Core signs as the PDA. Core's ExecuteV1 authority: only the asset owner (measured SR.5, SR.5a, SR.5c). Can it be reached while frozen? The PermanentFreezeExecute plugin rejects Execute while frozen (3.7, S6.2). So the helper can only run inside a genuine open (thawed), which requires the paired burn. ✓

Wait — one question: SEAL's open thaws the vault. Then Core ExecuteV1 runs the helper. Then BURN burns. What if the transaction is: open, Execute (helper), ... but NO burn? SEAL's open refuses without a following burn. So the thaw reverts. ✓

What if: open, Execute (helper sweeping everything), burn — but the burn is for a DIFFERENT vault? SEAL's open for vault A requires burn_vault for vault A later. So no.

(b) The pair list: 
- Same source twice (SR.12a): first pair closes the source; second pair's `read_token(src)` — the closed account has data len 0 → `d.len() != TOKEN_ACCOUNT_LEN` → InvalidAccountData? Wait, SR.12a's pin says "Provided owner is not allowed" (IllegalOwner). Hmm. After close, if owner is reassigned to System, `*a.owner != SPL_TOKEN_ID` → IllegalOwner. If owner stays Token, len 0 → InvalidAccountData. The measured error is "Provided owner is not allowed" = IllegalOwner, so on this runtime the closed account's owner is System. Interesting — so CloseAccount DOES reassign owner to System. Good to know. And SR.12b pins that the refusal did NOT come from the source-owner guard message (it came from the owner check, not the "is not the vault's" message). OK.
- A destination twice: two sources, same destination. First pair transfers amount and closes source (rent to dest wallet). Second pair transfers to same destination. Fine — destination is just credited twice. No issue.
- A source is also a destination: src owned by signer, dest owned by dest wallet. If src == dest, then owner must be both signer and dest wallet — impossible unless signer == dest wallet, which is refused (`signer.key == dest.key` → InvalidArgument). So src != dest always. ✓
- A source is a native wSOL account: read_token reads mint/owner/amount. wSOL mint is So111...; the destination must be the dest wallet's account for wSOL. Transfer all, close. Fine.
- A source with a delegate or close authority: the helper transfers the full amount (the owner signs, so delegate irrelevant) and closes (owner can close regardless of close authority). BURN's emptiness proof then never sees the account (closed). So a delegate planted before the redemption is neutralized by the close. Tested 3.3a. ✓
- A frozen account: transfer refuses (0x11), whole transaction reverts (SR.14). A frozen account with 0 balance: close succeeds? SPL Token CloseAccount on a frozen account — does it refuse? Hmm. The prompt says "a frozen one holding zero is only closed, measured round 30". So close succeeds on frozen accounts. OK.
- Destination not an ATA: any token account owned by dest wallet with the same mint works. Fine.
- Destination wallet is the vault's own asset-signer: refused (signer == dest). Another vault's asset-signer: allowed! The destination wallet is chosen by the transaction builder (the owner). If the owner names another vault's PDA as destination... the destination token accounts must be owned by that PDA. The swept tokens go into the other vault's accounts. Then BURN's emptiness proof for THIS vault passes (its accounts are empty), but the OTHER vault now holds more. That's the owner's own choice — they own this vault and are moving value to another vault they presumably control. Not a defect (the owner can always just redeem both). The prompt asks about this in (b): "the destination wallet is ... another vault's asset-signer?" — answer: the owner chose it; value goes where the owner said. No theft.
- Odd account list: `(accounts.len() - 4) % 2 != 0` → NotEnoughAccountKeys (SR.7). Zero pairs: just the lamport sweep (SR.13). ✓

(c) Destination checks: the destination wallet is chosen by whoever builds the transaction — the owner, since only the owner can Execute. So it's safe: the owner picks where their own value goes. The lamport transfer to a destination below rent-exemption: System transfer to an existing account below rent... a transfer that would leave the destination below rent-exempt minimum fails? Actually, transfers INTO an account don't fail for rent; the account just becomes non-rent-exempt... no wait. On Solana, a transfer to an account that doesn't exist creates it only if... no, System transfer to a non-existent account fails? Actually `system_instruction::transfer` to a non-existent account: the runtime creates the account? No — a System transfer to an account with 0 lamports that doesn't exist: the account is created with the transferred lamports IF the transfer covers rent? No. Let me think. On Solana, `SystemProgram::transfer` to a non-existent account succeeds and creates a system-owned account with those lamports, but if the resulting balance is below rent-exempt minimum for 0 bytes, the transaction fails with "insufficient funds for rent" — actually the rule is: any account with lamports > 0 must be rent-exempt, or the transaction fails. A 0-byte account needs 890,880 lamports (test validator) / 650,240 (mainnet). So a lamports-only sweep of less than that to a non-existent destination fails. SPEC item 50 says: "A lamports-only sweep needs a destination that exists... The canonical destination is the owner, who pays the fee and so exists." ✓. And to a non-system account (e.g., a token account): the transfer credits lamports to it (R27.S1 measured: allowed, token data unchanged). Fine.

(d) The lamport sweep: moves `signer.lamports()` at execution. After the helper, could anything re-fund the asset-signer before BURN's check? A later instruction in the transaction could deposit lamports into the PDA (anyone can send lamports to any address). But the redemption transaction is built by the owner; a stranger can't add instructions to it. Within the owner's own transaction, after the helper there's only burn_vault. Core's BurnV1 doesn't touch the PDA lamports (measured fact 4). So BURN sees 0. ✓

But wait — what about the ORDER: claim (MINT) ... open (SEAL) ... Execute (helper) ... burn (BURN). The claim pays into the vault's cbBTC account (a token account, not the PDA's lamports). The helper sweeps token balances and PDA lamports. Between the helper and BURN, nothing runs. ✓

Hmm, actually — one more: does Core's ExecuteV1 itself credit or debit the asset-signer PDA? ExecuteV1 makes the PDA sign; the helper's instructions run with the PDA as signer. The helper's last action empties the PDA. After the Execute returns, does Core do anything to the PDA? I don't believe so. And BURN checks `asset_signer.lamports() == 0` after. The suite's SR.4/S8 redemptions land, so empirically fine.

(e) Interaction with BURN's emptiness proof: covered above. The missing-reserve-ATA case: if a vault's reserve ATA doesn't exist when the page builds the transaction, the sweep can't name it (it would fail read_token — actually, naming a non-existent account: `*a.owner != SPL_TOKEN_ID` → IllegalOwner). BURN's reserve loop derives the ATA address and requires it DECLARED (in remaining_accounts), then skips it if no token program owns it (doesn't exist → owner is System → skipped). So a non-existent reserve ATA passes BURN. But a stranger can create the classic ATA for the vault's PDA (permissionless, via the ATA program) and deposit dust into it BEFORE the redemption lands. Then BURN sees a token account with amount > 0 → VaultNotEmpty → redemption refused. The page's prior transaction creates the missing reserve accounts, so the stranger's window is only between... hmm, actually the stranger can create the account at any time before the redemption. If the page creates it in the prior transaction, the stranger can then deposit dust into it before the redemption transaction. But then the sweep helper names it (it exists), transfers the dust to the owner, closes it. So the redemption lands and the owner gets the dust. The griefer can keep depositing dust, but the sweep moves whatever is there at execution — atomic with the burn. So the griefer can only make the owner richer. ✓

What about a Token-2022 ATA for a classic mint? F4.2: can't be created (IncorrectProgramId). A non-ATA token account for a reserve mint owned by the PDA: anyone can create a non-ATA token account (with a random address) owned by the PDA? Creating a token account requires the owner's signature... no — `createAccount` with owner = PDA: the SPL Token `InitializeAccount` requires the account's owner field to be set, but creating an account owned by a PDA doesn't require the PDA to sign (the owner field is just data). Actually, to initialize a token account, you need: a new system account (created with some payer), then InitializeAccount with mint and owner. The owner doesn't sign. So yes, a stranger can create a non-ATA token account for a reserve mint with owner = vault PDA, and deposit dust. Is it declared? BURN's reserve loop only checks the ATA derivation. The second loop checks ALL remaining accounts: any token account with owner == pda must be empty. But the stranger's non-ATA account is only checked if DECLARED (passed in remaining_accounts). If the page doesn't declare it, it's invisible to BURN → destroyed by the burn (accepted limit 44). If the page declares it (via judgeRedemptionCoverage), BURN refuses unless it's empty — and the sweep helper can sweep it (it's a classic token account owned by the PDA; the helper moves it to the owner's account for that mint). So the page can rescue it. ✓ (This is the round 25 D7 "sweep list" behavior.)

A nested Core asset: the helper can't move it; BURN refuses if declared, destroys if not. Accepted limit 44/9.

(f) Does it fit? S8.0 measures 1,061 bytes for claim + open + helper(3 pairs) + burn with owner as fee payer. With compute-budget pair (+52) and separate fee payer (+96) → ~1,209. Fits 1,232. A fourth reserve would add ~66 bytes per pair (2 accounts × 33) — but MAX_RESERVE_MINTS is 3, so no fourth reserve. The in-line monthly run's accounts: the redemption carries the pool account already (POOLK in ixBurn). The claim carries pool + token program. No extra. ✓

(g) Evidence: SR.0-SR.4a, S8.*. Is the helper deployed in the suite from the same bytes build-mainnet.sh proves? run-tests.sh deploys `target/deploy/cbob_vault_sweep.so` (built with --features localnet, but the sweep has no localnet feature so bytes are identical). build-mainnet.sh cmp's dist/cbob_vault_sweep.so (mainnet build) against $CACHE/ln build AND against target/deploy/cbob_vault_sweep.so. So the chain is: suite deploys target/deploy ← build-mainnet proves dist == target/deploy. ✓

**R2: The community pool.**

The invariant: pool balance >= ceil(owed_scaled / ACC_SCALE).

- `split_revenue`: moves revenue ATA balance to pool (85%) and bank (15%). Doesn't touch owed. ✓
- `distribute` / `credit`: avail = balance - ceil(owed); acc += avail*SCALE/w; owed += (avail*SCALE/w)*w = avail*SCALE (rounded down per w... delta = avail*SCALE/w (floor), owed += delta*w <= avail*SCALE). So owed increases by at most avail*SCALE, pool decreases by 0 (credit doesn't move tokens). Pool balance unchanged, owed increases by <= avail*SCALE = (balance - ceil(owed))*SCALE. New owed <= old owed + (balance - ceil(old owed))*SCALE. New ceil(owed) <= balance. ✓
- `claim`: pays out, owed -= settled. Pool decreases by paid, owed decreases by paid*SCALE. ✓
- `retire` (redeemed): owed -= pending (the vault's owed). Pool unchanged. Forfeit case: same. ✓
- `retire_burned`: owed -= pending. Pool unchanged. ✓
- `join`: debt = w*acc, no owed change. ✓
- `reweigh`: carry = owed, debt = new_weight*acc. owed_of unchanged. total_active_weight changes by (after - before). owed_scaled unchanged. ✓

Now the counters:
- `pending_count`: incremented on request, decremented on join and on retire of a pending vault. `pending_this_epoch`: incremented on request, zeroed on advance_epoch, decremented on retire of a pending vault whose request_epoch == dist_epoch.

Hmm — wait. In `retire`, for a pending vault: `if r.request_epoch == c.dist_epoch { c.pending_this_epoch -= 1 }`. But what if the vault requested in an EARLIER epoch (request_epoch < dist_epoch)? Then it's not in pending_this_epoch (that was zeroed at the epoch advance), so only pending_count decrements. ✓. What if request_epoch > dist_epoch? Impossible (request_epoch is set to dist_epoch at request time, and dist_epoch only increases).

- `waiting_to_join = pending_count - pending_this_epoch`. These are vaults eligible to join (requested in an earlier epoch). The gate refuses distributions while > 0. ✓

- `active_count`, `total_active_weight`: join adds, retire subtracts, reweigh adjusts. The host test N1 and the suite's `ledger()`/`books()` check these against the records. ✓

Liveness: can anyone make distributions impossible?
- A vault eligible to join blocks distributions (JoinWaitingFirst). Joining is free and permissionless (claim names it). So a griefer can request activation (needs 21,000 sats in the vault) and... the vault joins on the next claim naming it. Anyone can do that. So the block is temporary and free to clear. But wait — can a griefer keep creating new pending vaults faster than joins? Each request needs a revealed, funded vault (21,000 sats). The griefer must own vaults and fund them. Costly. And joins are free. So no permanent block.
- A due boost blocks distributions (BoostsExpireFirst). Expiring is free (expire_boosts, records only). ✓
- What if a boost is due on a vault whose record... expire_boosts needs only the record. ✓

Can anyone make redemptions impossible for others? The rate limit (accepted limit 32). A frozen pool: redemption forfeits (3c.F2). ✓

Hmm, wait — one thing to check in `claim`: the pending-join path. `if r.pending { require_keys_eq!(dest.key(), r.vault_ata, ...); if dist_epoch > request_epoch { join(...) } continue; }`. The dest check happens BEFORE the join-eligibility check. So a claim naming a pending vault with the WRONG dest refuses the whole batch. Fine.

But here's a subtle one: in `claim`, for a pending vault, `join` is called which sets `r.pending = false; r.active = true; r.debt_scaled = w*acc`. Then `store_record`. Then `continue`. The vault is owed nothing. ✓

What about a vault that is pending AND has a boost? Can't happen — boost requires active && !pending (BoostNeedsActiveVault). ✓

What about `activate` being called on a vault that is pending and the second call: `require!(dist_epoch > request_epoch, ActivationPending)` then `join`. But `activate`'s second call also does `require_live_vault`. And `join` checks `r.pending && !r.active && !r.retired && dist_epoch > request_epoch`. ✓

Now — the `activate` first call: `require!(!r.retired); require!(!r.active); if r.pending { ... second call ... }`. Then checks level, live vault, token balance >= 21,000. Sets pending. What if the vault's level is 0 (not revealed)? NotRevealed. ✓

**R2b: The boost.**

- `boost_vault`: owner-only, terms check, burns price, schedules end = dist_epoch + epochs, ring[end % 64]++, boosts_active++, boost_weight_total += extra, reweigh(c, r, extra), r.boost_end_epoch = end.

Wait — `reweigh(c, r, extra)` sets `r.boost_weight = extra`. But boost_vault requires `r.boost_weight == 0` first (BoostActive). ✓

- The ring: `boost_expiring[end % 64]`. Two boosts with the same end epoch share a slot (counted twice). A boost with end = dist_epoch + 63 (max) and another with end = dist_epoch + 63 + 64? Can't happen: epochs <= max_boost_epochs <= 63 (MAX_BOOST_EPOCHS_BOUND = BOOST_RING - 1 = 63). So end - dist_epoch <= 63 < 64. Two live boosts from the same vault? No (one per vault). From different vaults with ends 64 apart: boost A bought at epoch e with end e+63; boost B bought at epoch e+1 with end e+1+63 = e+64. e+64 % 64 = e % 64 = (e+63+1) % 64... wait (e+63) % 64 vs (e+64) % 64: these differ by 1. Hmm, can two live boosts have ends exactly 64 apart? A: end = e_a + n_a, B: end = e_b + n_b, with e_b > e_a (bought later). end_B - end_A = (e_b - e_a) + (n_b - n_a). For this to be 64: e.g., e_b - e_a = 1, n_b - n_a = 63. n_a >= 1, so n_b >= 64 > 63. Impossible. e_b - e_a = 64, n_b = n_a: but then when B is bought at e_a + 64, A's end = e_a + n_a <= e_a + 63 < e_a + 64 = dist_epoch when B is bought. So A is already due (dist_epoch >= end_A) — and the gate (BoostsExpireFirst) means no distribution ran past A's due point... but B is bought via boost_vault, which is NOT gated by BoostsExpireFirst! Hmm.

Wait — boost_vault calls monthly_inline first, which returns early (does nothing) if boosts_due > 0. Then boost_vault proceeds. So a boost CAN be bought while another boost is due. Let's see: A is due (dist_epoch >= end_A, not yet expired). B is bought at dist_epoch = end_A (say). B's end = end_A + n_B, n_B <= 63. end_B % 64 vs end_A % 64: end_B = end_A + n_B, n_B in 1..=63, so end_B % 64 != end_A % 64. Different slot. OK.

But what if A is due and NOT expired for a long time (distributions are blocked by the gate, so dist_epoch doesn't advance)? Then boosts can be bought at the same dist_epoch repeatedly. Each new boost's end = dist_epoch + n, n <= 63. All fine — they occupy slots (dist_epoch+1..dist_epoch+63) % 64. The due boost A is at slot end_A % 64 = dist_epoch % 64 (if end_A == dist_epoch). New boosts have end > dist_epoch, so slots (dist_epoch + 1..) % 64, never dist_epoch % 64. No collision with A's slot. And A is counted in boosts_due, not in the ring (its ring slot was already moved to boosts_due at advance_epoch). ✓

Hmm wait, actually let me re-check `advance_epoch`: `c.dist_epoch += 1; c.pending_this_epoch = 0; let i = dist_epoch % 64; c.boosts_due += c.boost_expiring[i]; c.boost_expiring[i] = 0;`. So when the epoch advances to e, all boosts with end == e (at slot e % 64) become due. ✓

And `unschedule_boost`: if `dist_epoch >= boost_end_epoch`, decrement boosts_due; else decrement ring[end % 64]. ✓

The host test N1 drives 260 epochs with buys, early retires, due retires, expiries, and checks the ring per slot against the records. That's strong evidence.

- `expire_boost`: requires boost_weight > 0 && dist_epoch >= boost_end_epoch. unschedule (due branch), reweigh to 0, boost_end_epoch = 0. ✓

- Can a record be expired twice? After expiry, boost_weight == 0, so expire_boost requires boost_weight > 0 fails. In expire_boosts (batch), skipped. In claim, `if r.boost_weight > 0 && ...` — skipped. ✓

- Early? `dist_epoch >= boost_end_epoch` required. ✓

- Never? A boost that is due blocks distributions (gate), so it must be expired (free, anyone) before the next distribution. But what if the vault is retired first? retire → unschedule_boost (due branch: boosts_due -= 1). ✓

- `boosts_due` accounting: advance_epoch adds ring[i]; expire_boost subtracts 1 (due branch); retire subtracts 1 (due branch). What if a boost becomes due and then the vault is retired in the same epoch? Due branch. ✓ What if a boost is scheduled (not due) and vault retired? Ring branch. ✓

Now — `reweigh` and the owed invariant: reweigh moves owed to carry, resets debt at new weight. owed_of(r, acc) = weight*acc + carry - debt. Before: w_old*acc + carry_old - debt_old = owed. After: w_new*acc + owed - w_new*acc = owed. ✓ Nothing gained or lost.

But `total_active_weight`: reweigh subtracts `before` and adds `after`. before = level_weight + old_boost, after = level_weight + new_boost. ✓

`boost_weight_total`: boost_vault adds extra; unschedule subtracts r.boost_weight. In expire_boost: `let extra = r.boost_weight; unschedule_boost(c, r)?; reweigh(c, r, 0)?;`. unschedule subtracts r.boost_weight (still = extra at that point). Then reweigh sets boost_weight = 0. ✓

In retire: `if r.boost_weight > 0 { unschedule_boost(c, r)?; }` — subtracts from boosts_active, boost_weight_total, and ring/due. Then `r.debt_scaled = full; r.carry_scaled = 0; r.active = false;`. Note: retire does NOT call reweigh; it directly sets debt = w*acc (full weight including boost) and carry = 0. owed_of after = w*acc + 0 - w*acc = 0. And owed_scaled was already decremented by pending. ✓ And total_active_weight -= w (full weight including boost). ✓

Hmm wait — in retire, `let w = weight_of(r)?` — this includes the boost. `c.total_active_weight -= w`. And unschedule_boost subtracts r.boost_weight from boost_weight_total. So total_active_weight loses (level + boost), boost_weight_total loses boost. Consistent. ✓

**R3: The level draw.**

- `blockhash_in_window`: pinned sysvar, count <= 512, buffer length checked, smallest produced slot in [want, want+64], all-zero hash refused. ✓
- `try_capture`: NotYet if now <= reveal_slot; Expired if now > reveal_slot + 300; else A, B, C each two leader groups after the previous. ✓
- FIFO: reveal requires index == revealed_total. ✓
- Burned vault at head: reveal skips the Core write if positively burned. ✓
- Attribute re-supply hash: `hashv(&[&attributes.try_to_vec()?])` == stored attrs_hash. The stored hash at mint: `hashv(&[&attributes.to_vec().try_to_vec()?])`. Hmm — `attributes.to_vec()` then `try_to_vec()`. For a Vec<VaultAttribute>, `.to_vec()` clones the Vec (Vec<VaultAttribute>), then try_to_vec serializes it. At reveal: `attributes.try_to_vec()`. Same serialization (Borsh Vec: u32 len + items). ✓

Wait, at mint in write_record: `r.attrs_hash = hashv(&[&attributes.to_vec().try_to_vec()?]).to_bytes();`. `attributes` is `&[VaultAttribute]`. `.to_vec()` → Vec<VaultAttribute>. `.try_to_vec()` → Borsh bytes of the Vec (u32 count + each item). At reveal: `attributes.try_to_vec()?` where attributes: Vec<VaultAttribute> → same Borsh bytes. ✓

- What can a minter influence? They choose the asset keypair (grinds the asset address, but the entropy hashes don't exist yet). They can time the mint (choose the slot, hence reveal_slot = slot+16). The leader schedule is public, so a validator-minter can time into its own rotation (accepted limit 26). A crank operator can delay captures (accepted limit 25). A slot leader at C can grind (accepted limit 26).

Is it worse than SPEC 26 states? SPEC 26 says C's leader chooses among many draws. What about A's or B's leader? A is the first produced slot at or after reveal_slot. A's leader produces A knowing... nothing about the draw (hA is the first hash). But A's leader could skip its slot to change which slot becomes A — moving A to the next leader's slot? No wait: A is the smallest produced slot in [reveal_slot, reveal_slot+64]. If A's leader skips all 4 of its slots, A moves to the next leader's first slot. So A's leader can choose between its own first slot and handing A to the next leader. But A's leader doesn't know hB, hC (they're after A). So A's leader's choice affects the draw but without knowing the outcome — it's a one-way influence (change the input blindly). Hmm, actually A's leader CAN compute the draw for each candidate A... no, because B and C depend on A's slot (want advances based on A's slot). And B, C don't exist yet when A is produced. So A's leader can't compute the final draw. It can only choose to produce or skip, blindly. That's weaker than C's leader, who knows hA and hB. SPEC 26 covers C. B's leader knows hA but not hC. B's leader can compute... no, hC doesn't exist yet. So B's leader is also blind. Only C's leader sees hA and hB. SPEC 26 is accurate.

- The cohort issue: every vault minted in the same slot shares reveal_slot, hence the same three hashes, but mixes its own asset address. So C's leader chooses jointly for the cohort. Stated in SPEC 26. ✓

**R4: Governance.**

- One vault one vote, bound to asset via VoteRecord PDA. ✓
- Electorate fixed at creation: index_snapshot (minted_total), quorum_supply (live). ✓
- No proposal before charter closes. ✓
- Quorum: cast >= ceil(snapshot * quorum_bps / 10000), need > 0. Threshold: yes_bps >= threshold. Turnout: yes >= ceil(snapshot * 10%). Key change: yes >= ceil(snapshot * 50%). ✓
- Guardian change and operator arm never bundled. ✓
- Notice via permissionless apply. ✓
- Guardian can cancel pending operator. ✓
- TightenSweep only tighter, inside bounds. ✓
- Overtaken action skipped, logged. ✓

Can a minority carry what it shouldn't? At quorum 21%, threshold 51%: 10.71% YES carries an ordinary action. That's the ruled number (accepted limit 35, DESIGN section 10). Key changes need 50% of snapshot. 

Hmm — one thing: the `key_change` check in execute_proposal looks at `p.actions` for `Brakes { set_guardian: true, .. } | ArmSwapOperator`. What about a Brakes with set_guardian: false but restart flags? Not a key change. ✓

Can a vote reach money it shouldn't? Actions: SetRound (price floor, cap, window), Brakes (restart, arm guardian), TightenSweep (bounded), ArmSwapOperator, SetBoostTerms (bounded). The CPIs go to MINT signed by gov PDA. MINT re-checks everything. The 85/15, destinations, max_supply: no instruction writes them. ✓

Can governance be frozen forever? If live supply drops such that quorum can't be met... quorum is ceil(snapshot * 21%). Snapshot is live at creation. If vaults keep being redeemed, each new proposal snapshots the then-live supply, so the bar falls with supply. At 1 live vault: quorum = ceil(0.21) = 1, threshold 51% of 1 = 1 YES (yes_bps = 10000 >= 5100), turnout ceil(0.1) = 1, key change ceil(0.5) = 1. So 1 vault can do everything. Not frozen. ✓

SPEC 47: stolen guardian key → permanent stop at low turnout. Is it worse? The guardian can also cancel pending operators. And re-stop after every restart. The cure is a guardian replacement vote (50% of snapshot). If turnout < 50%, permanent. Stated. Not worse.

Hmm — wait, one more: `execute_proposal` requires `now <= voting_ends_at + EXECUTION_WINDOW_SECS` (7 days). A passed proposal expires after 7 days. For a guardian replacement under attack: the vote takes min_voting_secs (3 days) + up to 7 days to execute + 7 days notice. During that time the thief re-stops. That's the stated cost. ✓

**R5: The charter claim.**

- PoB identified by address against Merkle root. ✓
- CPI-burned as owner in the same instruction. ✓
- Window fixed at initialize. ✓
- Not gated by guardian. ✓
- pob_extra passed through, never as signers. ✓

The Merkle: leaf = sha256(0x00 || pubkey), node = sha256(0x01 || min || max), odd node promoted. MAX_POB_PROOF = 16, but 240 leaves → depth 8. The JS (pob-merkle.mjs) matches. The selftest proves outsiders don't verify. ✓

Hmm — one thing: `merkle_root_from` in Rust takes the leaf and proof and computes. With a proof shorter than the tree depth, could a non-leaf prove? The leaf is hashed with tag 0x00 first, then nodes with 0x01. A proof of length 0: root == leaf? pob_root is the root of 240 leaves, not a leaf hash (domain-separated). Could an attacker find a pubkey whose leaf hash equals the root? That's a preimage attack on sha256 — infeasible. ✓

What about the odd-node promotion: at depth 8 with 240 leaves, some layers have odd counts. The proof for a leaf under a promoted node just skips that level. The Rust verifier handles it (it just hashes whatever siblings are given). The JS proofOf does the same. Consistent. ✓

SPEC 46 completeness: the hot wallet can (1) end the project (reject all claims), (2) capture governance (admit only own PoBs). Also: per-asset plugins (alarm blind spot), sampling lag (30 min). The positive bound: can't transfer/burn individual PoBs. Is there anything omitted? 

Hmm — the hot wallet is the collection's update authority. Can it change the collection's royalties? The Moments collection has its own royalties plugin (not the CBOB one). Irrelevant to vaults. Can it mint new assets into the collection? Yes ("Proof of Burn #241" lookalike) — but the Merkle root refuses them (C.8). Can it REMOVE assets from the collection? "Moving a Proof of Burn out of the collection is the same brick class as a rejecting hook" — stated. Can it change the name/uri of PoBs? Stated ("Name and uri are the only on-chain marks, and both are writable"). Identity is by address. ✓

What about the hot wallet adding a plugin to the CBOB collection? It's not the CBOB collection's authority (MINT's PDA is). No. ✓

What about a PoB OWNER (not the hot wallet)? They can add owner-managed plugins to their PoB (freeze delegate etc.). A frozen PoB can't be burned while frozen → the owner can't claim until they thaw. Self-inflicted. But wait — can a PoB owner add a plugin that makes the burn do something weird? The burn is a CPI by MINT with the owner signing. Owner-managed plugins (FreezeDelegate, BurnDelegate, TransferDelegate, Autograph, FreezeExecute) — a BurnDelegate with a foreign authority: the burn needs... BurnDelegate allows the delegate to burn; does it restrict the owner's burn? No, the owner can always burn their asset. FreezeDelegate frozen blocks burn — but the owner froze it themselves. So a PoB owner can only brick their own claim. Stated ("owners can also add owner-managed plugins, including a freeze delegate that can block the burn while frozen"). ✓

**R6: One-time configuration.**

- SEAL initialize: collection (any pubkey — only checked against MINT/BURN later via WiringDiverged), reserve_mints 1-3, each passed as account, owner == SPL Token. Not checked: that the account is actually a mint (could be a token account!), duplicates, or that collection is real. Hmm — a reserve "mint" that is a token ACCOUNT (owned by SPL Token): assert_classic_spl only checks `*acc.owner == SPL_TOKEN_ID`. A token account is owned by SPL Token. So SEAL would accept a token account as a reserve mint. What would that lock in? BURN derives ATAs for that "mint" and requires them declared and empty. The ATA derivation for a token-account-as-mint: ATA of (pda, token_program, fake_mint). Such an ATA can exist (any mint-ish address can have ATAs? The ATA program checks the mint is owned by the token program — a token account IS owned by the token program, so ATA creation... hmm, does the ATA program validate the mint is a mint? It checks the mint account's owner is the token program. A token account passes. So ATAs can be created for it). So a wrong-but-accepted reserve mint just adds a checked-but-always-empty account. Not fatal, but the launch checker pins the ruled three (item 38). The real risk: a wrong collection or wrong reserve mints locked forever. MINT's initialize checks SEAL names the same collection and payment_mint is a reserve. BURN checks SEAL's collection matches. GOV checks MINT's collection. So a wrong collection fails at MINT/BURN/GOV init (WiringDiverged) — caught before anything mints. ✓

- MINT initialize: the big one. Checks: INIT_AUTHORITY, cbob_mint (classic SPL mint, initialized, not payment_mint, not GARY), boost bounds, max_supply > 0, bank_treasury != default, notice bounds, sweep bounds, level caps (all > 0, sum <= max_supply), charter window (closes > opens, <= 90 days, closes > now), pob_root != 0, monthly bounds, pob_collection != default, collection (Core-owned, CollectionV1, update authority = mint PDA, no plugins, never minted), SEAL wiring (collection matches, payment_mint is a reserve).

What's NOT checked: guardian could be default (None — legal, retires the brake at launch; is that intended? `guardian: Option<Pubkey>`, `guardian.unwrap_or_default()`. If None, guardian = default pubkey, and require_guardian refuses everyone (NotTheGuardian since c.guardian == default → require_keys_neq fails). So None = no guardian ever. Ruled value is Gary's wallet. The launch checker pins it. If wrongly initialized with None... no brake at launch. Item 38 covers: the checker is the only gate for the guardian's exact value. Hmm, but is None a "wrong-but-accepted" value that locks forever? Yes — but it's a legal value by design (retiring the brake is legal). The checker pins Gary's wallet. OK.

- swap_operator != default checked. Off-curve accepted (item 38 notes; check-launch-params refuses off-curve — wait, A13 in round 33 says "check-launch-params.mjs:96-99 refuses an off-curve guardian, init authority or swap operator (selftest L8)". So the checker refuses off-curve. The program accepts. The checker is the gate. OK.)

- What about `charter_opens_at` in the past? `charter_closes_at > now` checked, but opens could be in the past (window already open). That's fine — the window is [opens, closes), and closes > now means it's claimable now or later. A past opens just means it opens immediately. Not a brick.

- `max_supply` vs level caps: sum(caps) <= max_supply. check_supply requires minted_total < max_supply AND < cap_total. So effective supply = min(max_supply, cap_total). Ruled: 2100 and 945+525+315+210+105 = 2100. Equal. ✓

- BURN initialize: redeem_window_secs 10..86400. Ruled 3600. The program accepts anything in range; the checker pins 3600. Item 38. ✓

- GOV initialize: quorum 500..10000, threshold 5001..7500, voting 60..30d. Ruled 2100/5100/259200. Checker pins. ✓

The swap operator's worst case: cap × cooldown windows until guardian stops, bounded by revenue balance above reserve. Royalty SOL only. Stated in limit 10. ✓

The 10% royalty: plugin authority None. R.3, R.6, R.6a, R33.G3 (can't re-delegate). Nothing in our programs or Core lets anyone change it. ✓

The redemption cap: ring of 64 timestamps, cap = ceil(live × 210/10000) min 1, k = min(cap, 64), kth most recent must be >= window old. Let me verify the ring arithmetic: `head = rate_head % 64; kth = rate_ring[(head + 64 - k) % 64]`. rate_ring[head] is where the NEXT write goes (oldest slot). The most recent write is at (head - 1) % 64 = (head + 63) % 64. The k-th most recent is at (head - k) % 64 = (head + 64 - k) % 64. ✓. Require `now - kth >= window`. Then write rate_ring[head] = now, head = (head+1) % 64. ✓

Edge: fewer than k redemptions so far. The ring starts all zeros. kth = 0 (if not yet overwritten). now - 0 >= window → passes. So the first k redemptions always land (the ring slots not yet written read 0 = "long ago"). ✓ matches "Every slot at time 0, i.e. 'long ago': the first cap redemptions land."

Edge: cap > 64 (live > 3047). k = 64. The 64th most recent must be a window old. So at most 64 per window regardless of cap. Stricter, never looser. Stated. ✓

Edge: cap computed from live supply at each redemption. As supply falls, cap falls. The kth lookup uses the CURRENT cap. Hmm — is there a way to exceed the rolling cap by manipulating live supply? live = minted_total - burned_total - bare_burns_retired. minted_total only grows (mints). burned_total grows with each redemption. bare_burns_retired grows with retire_burned calls. So live can grow (mints) or shrink (burns/retires). If live grows between redemptions, cap grows, k grows, kth looks FURTHER back — could that let more through? Suppose cap was 1 (k=1), one redemption at t0. Then 43 mints happen → live grows → cap = 2 (k=2). Next redemption: kth = 2nd most recent. The ring has only 1 real entry (t0) and zeros. 2nd most recent = 0 → passes. So the mint surge let one extra redemption through immediately. Is that a violation of "no window holds more than the cap"? The cap in force when the second redemption lands is 2, and the window holds 2 (t0 and now). So no — the cap is evaluated at landing time, and the window holds exactly the cap. The invariant "no window of that length holds more redemptions than the cap in force when the last of them landed" holds. ✓ (RL.7 replays each redemption against its own certified cap.)

Hmm, but wait — can someone mint vaults to RAISE the cap and redeem more? Minting requires an open round and payment. The minted vaults are real (paid for). So raising the cap costs real vaults. And the cap is 2.1% — minting 43 vaults to raise the cap by 1 costs 43 × price. Not free. Accepted limit 32 covers spending the budget with your own vaults. This is the same class. OK.

**R7: Cross-program raw reads.**

Let me recompute the offsets from the struct definitions.

MintConfig fields in order (after 8-byte disc):
- version: u8 → 8
- collection: Pubkey → 9..41
- governance: Pubkey → 41..73
- pool_ata: Pubkey → 73..105
- round_id: u32 → 105..109
- opens_at: i64 → 109..117
- closes_at: i64 → 117..125
- price: u64 → 125..133
- cap: u32 → 133..137
- minted_this_round: u32 → 137..141
- minted_total: u64 → 141..149
- max_supply: u64 → 149..157
- bank_treasury: Pubkey → 157..189
- split_bps: u16 → 189..191
- sales_stopped: bool → 191
- sweep_stopped: bool → 192
- guardian: Pubkey → 193..225
- swap_operator: Pubkey → 225..257
- sol_reserve_lamports: u64 → 257..265
- bump: u8 → 265
- max_sweep_lamports: u64 → 266..274
- sweep_cooldown_secs: i64 → 274..282
- last_sweep_at: i64 → 282..290
- level_caps: [u32;5] → 290..310
- level_minted: [u32;5] → 310..330
- revealed_total: u64 → 330..338
- payment_mint: Pubkey → 338..370
- pob_collection: Pubkey → 370..402
- pob_root: [u8;32] → 402..434
- charter_opens_at: i64 → 434..442
- charter_closes_at: i64 → 442..450
- charter_claimed: u32 → 450..454
- bare_burns_retired: u64 → 454..462
- total_active_weight: u64 → 462..470
- active_count: u64 → 470..478
- acc_scaled: u128 → 478..494
- owed_scaled: u128 → 494..510
- last_distribute_at: i64 → 510..518
- sales_stopped_at: i64 → 518..526
- sweep_stopped_at: i64 → 526..534
- pending_swap_operator: Pubkey → 534..566
- pending_swap_operator_at: i64 → 566..574
- monthly_secs: i64 → 574..582
- pending_guardian: Pubkey → 582..614
- pending_guardian_set: bool → 614
- pending_guardian_at: i64 → 615..623
- notice_secs: i64 → 623..631
- sweep_floor_lamports: u64 → 631..639
- cooldown_ceiling_secs: i64 → 639..647
- reserve_ceiling_lamports: u64 → 647..655
- dist_epoch: u64 → 655..663
- pending_count: u64 → 663..671
- pending_this_epoch: u64 → 671..679
- cbob_mint: Pubkey → 679..711
- max_boost_weight: u8 → 711
- max_boost_epochs: u16 → 712..714
- boost_price: u64 → 714..722
- boost_weight: u8 → 722
- boost_epochs: u16 → 723..725
- boosts_active: u32 → 725..729
- boosts_due: u32 → 729..733
- boost_weight_total: u64 → 733..741
- cbob_burned_total: u64 → 741..749
- boost_expiring: [u32;64] → 749..1005
- CONFIG_PADDING: 256 → 1005..1261

MINT_CONFIG_SPACE = 8 + 1 + 32*3 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 1 + 32 + 32 + 8 + 1 + 8 + 8 + 8 + 4*5 + 4*5 + 8 + 32 + 32 + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 16 + 16 + 8 + 8 + 8 + 32 + 8 + 8 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 32 + 1 + 2 + 8 + 1 + 2 + 4 + 4 + 8 + 8 + 4*64 + 256.

Let me sum: 8+1=9; +96=105; +4=109; +8=117; +8=125; +8=133; +4=137; +4=141; +8=149; +8=157; +32=189; +2=191; +1=192; +1=193; +32=225; +32=257; +8=265; +1=266; +8=274; +8=282; +8=290; +20=310; +20=330; +8=338; +32=370; +32=402; +32=434; +8=442; +8=450; +4=454; +8=462; +8=470; +8=478; +16=494; +16=510; +8=518; +8=526; +8=534; +32=566; +8=574; +8=582; +32=614; +1=615; +8=623; +8=631; +8=639; +8=647; +8=655; +8=663; +8=671; +8=679; +32=711; +1=712; +2=714; +8=722; +1=723; +2=725; +4=729; +4=733; +8=741; +8=749; +256=1005; +256=1261. ✓ matches (round 33 says 1,261).

GOV reads: OFF_MINT_GOVERNANCE=41 ✓, OFF_MINT_MINTED_TOTAL=141 ✓, OFF_MINT_BARE_RETIRED=454 ✓, OFF_MINT_CHARTER_CLOSES=442 ✓, OFF_MINT_SOL_RESERVE=257 ✓, OFF_MINT_MAX_SWEEP=266 ✓, OFF_MINT_COOLDOWN=274 ✓, OFF_MINT_SALES_STOPPED=191 ✓, OFF_MINT_SWEEP_STOPPED=192 ✓, OFF_MINT_SALES_STOPPED_AT=518 ✓, OFF_MINT_SWEEP_STOPPED_AT=526 ✓, OFF_MINT_SWEEP_FLOOR=631 ✓, OFF_MINT_COOLDOWN_CEILING=639 ✓, OFF_MINT_RESERVE_CEILING=647 ✓, OFF_MINT_MAX_BOOST_WEIGHT=711 ✓, OFF_MINT_MAX_BOOST_EPOCHS=712 ✓, OFF_MINT_COLLECTION=9 ✓, OFF_MINT_VERSION=8 ✓.

BURN reads: OFF_MINT_MINTED_TOTAL=141 ✓, OFF_MINT_BARE_RETIRED=454 ✓.

GOV's comment block says "sales_stopped_at[518..526] sweep_stopped_at[526..534] ... sweep_floor_lamports[631..639] cooldown_ceiling_secs[639..647] reserve_ceiling_lamports[647..655]" ✓. And "max_boost_weight[711] max_boost_epochs[712..714]" — the constants are OFF_MINT_MAX_BOOST_WEIGHT=711, OFF_MINT_MAX_BOOST_EPOCHS=712. ✓

VaultRecord: disc 8, version 8, asset 9..41, mint_index 41..49, reveal_slot 49..57, level 57, charter 58, entropy_set 59, entropy 60..92, attrs_hash 92..124, bump 124, active 125, retired 126, reschedules 127..129, vault_ata 129..161, debt_scaled 161..177, pending 177, request_epoch 178..186, boost_weight 186, boost_end_epoch 187..195, carry_scaled 195..211, RECORD_PADDING 10 → 211..221.

VAULT_RECORD_SPACE = 8+1+32+8+8+1+1+1+32+32+1 +1+1+2+32+16 +1+8 +1+8+16 +10 = 8+1=9; +32=41; +8=49; +8=57; +1=58; +1=59; +1=60; +32=92; +32=124; +1=125; +1=126; +1=127; +2=129; +32=161; +16=177; +1=178; +8=186; +1=187; +8=195; +16=211; +10=221. ✓ (221 bytes, matches SPEC).

GOV reads: OFF_REC_VERSION=8 ✓, OFF_REC_ASSET=9 ✓, OFF_REC_INDEX=41 ✓.

BurnConfig: disc 8, version 8, collection 9..41, bump 41, burned_total 42..50, redeem_window_secs 50..58, rate_head 58, rate_ring 59..59+512=571, CONFIG_PADDING 256 → 827. Space: 8+1+32+1+8+8+1+8*64+256 = 8+1=9; +32=41; +1=42; +8=50; +8=58; +1=59; +512=571; +256=827. ✓ (round 33 says 827).

GOV reads OFF_BURN_TOTAL=42 ✓.

SEAL Config: disc 8, version 8, collection 9..41, reserve_mints Vec<Pubkey> (u32 len at 41..45, then keys), bump after. Space: 8+1+32+4+32*3+1+256 = 8+1=9; +32=41; +4=45; +96=141; +1=142; +256=398. ✓ (round 33 says 398).

MINT/BURN read: OFF_VERSION=8 ✓, OFF_COLLECTION=9 ✓, OFF_RESERVES=41 ✓.

GovConfig: disc 8, version 8, collection 9..41, quorum_bps 41..43, threshold_bps 43..45, min_voting_secs 45..53, proposal_count 53..61, bump 61, last_round_id 62..70, last_guardian_id 70..78, last_arm_id 78..86, last_boost_id 86..94, padding 256 → 350. Space: 8+1+32+2+2+8+8+1+8+8+8+8+256 = 8+1=9; +32=41; +2=43; +2=45; +8=53; +8=61; +1=62; +8=70; +8=78; +8=86; +8=94; +256=350. ✓ (round 33 says 350).

The suite reads GOV config proposal_count at offset 53 (`data.readBigUInt64LE(53)`) ✓.

Sweep helper: mint 0..32, owner 32..64, amount 64..72, len 165. ✓ (classic SPL layout).

All offsets check out.

**R8: The suite as evidence.**

Let me look for arms that cannot fail or fire for the wrong reason.

- Arm 2.1 (repaired): now records vMint.ok. ✓
- The `because()` pins: many. Let me spot-check a few:
  - `because('3.7','custom program error: 0x9')` — the bare Execute refusal. 0x9 is Core's InvalidAuthority. The comment explains why this is the seal (owner IS the signer, seal frozen). OK.
  - `because('SR.3','Program Tokenkeg... failed: custom program error: 0xb')` — NonNativeHasBalance? Wait, 0xb = 11 decimal. Hmm, the comment says "NonNativeHasBalance: the old sweep cannot even close the account the dust landed in". Actually SR.3 is the exact-amount sweep after dust: the transfer of heldT succeeds, but then closeAccount fails because the account has 1 sat left (NonNativeHasBalance is error 0x0b? Let me think — spl-token errors: 0x00 NotRentExempt, 0x01 InsufficientFunds, 0x02 InvalidMint, 0x03 MintMismatch, 0x04 OwnerMismatch, 0x05 FixedSupply, 0x06 AlreadyInUse, 0x07 InvalidNumberOfProvidedSigners, 0x08 InvalidNumberOfRequiredSigners, 0x09 UninitializedAccount, 0x0a NativeNotSupported, 0x0b NonNativeHasBalance, 0x0c InvalidInstruction, 0x0d InvalidState, 0x0e NotSupported, 0x0f Overflow, 0x10 InvalidStateWithOwner... hmm actually 0x11 is FrozenAccount (17). Wait: 0x0d InvalidState, 0x0e NotSupported... let me recount: spl-token TokenError enum: 0 NotRentExempt, 1 InsufficientFunds, 2 InvalidMint, 3 MintMismatch, 4 OwnerMismatch, 5 FixedSupply, 6 AlreadyInUse, 7 InvalidNumberOfProvidedSigners, 8 InvalidNumberOfRequiredSigners, 9 UninitializedAccount, 10 NativeNotSupported, 11 NonNativeHasBalance, 12 InvalidInstruction, 13 InvalidState, 14 NotSupported, 15 Overflow, 16 ProofGeneration, 17 FrozenAccount (0x11), 18 AccountFrozen? no. So 0xb = 11 = NonNativeHasBalance ✓ and 0x11 = 17 = FrozenAccount ✓ (used in SR.14 and 3c.F1 pins). Good.

- SR.12b: "duplicate-source refusal reached the second, closed source, not the first source-owner guard" — checks the error does NOT include 'CBOB_SWEEP refused: source'. Wait, `rec('SR.12b',...,'false',String(R.find(x=>x.id==='SR.12a')?.n?.includes('CBOB_SWEEP refused: source')))`. So it asserts the note does NOT contain the source-owner message. The refusal for the duplicate: after the first pair closes the source, the second pair's read_token fails at `*a.owner != SPL_TOKEN_ID` (owner is System after close) → IllegalOwner → "Provided owner is not allowed". That error is thrown BEFORE the "is not the vault's" message (which comes after read_token succeeds). So the note contains "Provided owner is not allowed" and NOT "CBOB_SWEEP refused: source". ✓ And `because('SR.12a', 'Program <helper> failed: Provided owner is not allowed')` pins it. ✓

Hmm wait — actually, does the closed account's owner become System? Earlier I reasoned from the measured error that it does. The measured error "Provided owner is not allowed" = IllegalOwner, which is thrown by `if *a.owner != SPL_TOKEN_ID`. So yes, on this runtime, a closed token account's owner is System. OK.

- One thing to check: SR.12a's pair list `[pU, pU]` where pU = [ata(V2.pda), ata(alice.publicKey)]. First pair: transfers h2 (the full balance) to alice, closes the source (rent to alice). Second pair: read_token(src) — src is now closed (owner System, len 0) → IllegalOwner. Refused. The whole transaction reverts, so the first pair's transfer also reverts. V2 keeps everything (SR.5e checks). ✓

- K.7: crank and pair name the same queued record. The crank captures/reschedules it; the pair path skips it (not active). ✓

- BO.36: crank and pair name the same drawn active record. Crank skips (level != 0). Claim pays once. ✓

- BO.32: same vault twice in pairs. First pays (debt reset), second pays 0. owed falls once. ✓

Now — are there claims in the prompt that NO arm exercises? The prompt asks (R8): "claims in this prompt that NO arm exercises". Hmm. Let me think about a few:

- The `expire_boosts` MAX_EXPIRE_BATCH = 30 bound: the suite tests 20 records (BO.18a fits). The expiry-budget test does 20. Is 30 tested? BO.18a measures 20 fit a legacy tx. The bound is 30. Hmm — is a 31-record call refused? Not tested explicitly. But the bound is `rem.len() <= MAX_EXPIRE_BATCH` → BadClaimList. Minor.

- `claim` with crank_n > 0 but rem.len() < k: BadClaimList. Tested? P.19a tests empty pairs. Not a big deal.

- The `distribute` with `burn=true` and `remaining_accounts.len() != 4`: BadBurnAccounts. Tested? Not explicitly that I see. Minor.

These are refusal-path coverage gaps, low value.

Let me now look HARDER for real defects. Let me re-examine some subtle spots.

**`monthly_inline` in `retire_redeemed`:** After retire, monthly_inline runs. If due and pool has avail, it credits the remaining vaults. But wait — `retire_redeemed` is called by BURN via CPI. The pool_token account is passed. monthly_inline checks `pool.key() == c.pool_ata` (WrongPool). BURN passes `ctx.accounts.pool_token` which is unchecked in BURN's struct (just "MINT checks it is the real pool"). MINT's monthly_inline checks it. ✓

**`claim`'s monthly_inline placement:** crank first, then monthly_inline, then payments. The monthly run credits, then the claim pays from the new accumulator. ✓

**`activate`'s monthly_inline:** crank first (captures), then monthly_inline (BEFORE the activation, so a month due belongs to vaults active during it). ✓

**`boost_vault`'s monthly_inline:** first, at old weight. ✓ (BO.22 tests.)

**`mint_vault`/`claim_charter_vault`'s monthly_inline:** first thing. ✓

**A subtle one in `claim`:** the pending-join path does `require_keys_eq!(dest.key(), r.vault_ata, WrongVaultAccount)` BEFORE checking join eligibility. But `r.vault_ata` was recorded at the activate request. Fine.

But here's something: in `claim`, for an ACTIVE vault, `require_keys_eq!(dest.key(), r.vault_ata)`. For a vault that is `!r.active` and `!r.pending` (never activated), `continue` — skipped, no dest check. For a retired vault: `!r.active` → skipped. ✓

**`owed_of` underflow:** `weight*acc + carry - debt`. After a claim: debt = weight*acc, carry = pending - settled (sub-sat remainder). owed = weight*acc + remainder - weight*acc = remainder >= 0. ✓ After reweigh: carry = owed >= 0, debt = new_weight*acc. owed = new_weight*acc + owed - new_weight*acc = owed. ✓ After join: debt = w*acc, carry = 0. owed = 0. ✓ After credit (distribution): acc increases by delta. owed = w*(acc+delta) + carry - debt = w*delta + (w*acc + carry - debt) = w*delta + old_owed >= 0. ✓ After retire: debt = w*acc, carry = 0, owed = 0. ✓

Can carry + weight*acc < debt ever happen? debt is only ever set to weight*acc (at join/claim/reweigh/retire). carry >= 0 always. So owed >= 0. ✓ (checked_sub would abort anyway — overflow-checks on.)

**`ceil_sats`:** (scaled + SCALE - 1) / SCALE. For owed_scaled = 0 → 0. ✓

**`distribute` avail:** balance - ceil(owed). If balance < ceil(owed) → PoolShort. Can balance < ceil(owed) happen? The invariant says no (P.32). Claims reduce both. Credits increase owed by <= avail. Splits increase balance. Retires reduce owed. So balance >= ceil(owed) always. ✓

**A griefer sending cbBTC to the pool:** increases balance, increases avail at next distribute. Fine — that's a donation to holders.

**A griefer sending cbBTC to the revenue ATA:** split into pool/bank at next split. Fine.

**`split_revenue` with a frozen bank ATA:** the whole split reverts (R28.F1). The 85% waits. Accepted (round 23 note in limit 28). ✓

**`sweep_sol_for_swap`:** amount > 0, <= max_sweep, cooldown, reserve, operator signs, not stopped. `bal >= keep + amount`. ✓

Hmm — `last_sweep_at` is set to `now` AFTER the transfer. If the transfer fails, the whole instruction reverts. ✓

**GOV `execute_proposal` — the `calls` vector and CPIs:** each action's CPI is built and then all executed in order. If a CPI fails, all revert. The skips are decided before. ✓

One subtle thing: `Brakes` with `set_guardian: true` and restart flags: the arm_guardian CPI is pushed first, then restart. Both execute. ✓

**GOV `create_proposal` — the `seen` array:** `let mut seen = [false; MAX_ACTIONS]` (5). `a.kind()` returns 0..4. ✓

**GOV `readProp` in the suite** — walks the actions Vec. Fine (test code).

**The `Brakes` action encoding:** tag 1 + 3 bools + Option<Pubkey>. In execute: `d.extend_from_slice(&guardian.try_to_vec()?)` — Option<Pubkey> Borsh: 1 byte tag + 32 if Some. MINT's arm_guardian takes `guardian: Option<Pubkey>`. ✓

**MINT `restart`:** `require!(sales || sweep)`. Checks stop times strictly less than proposal_created_at. GOV passes `p.created_at`. GOV's own skip uses `>=` (stop wins ties). MINT uses `<` (stop must be strictly older). Consistent: a stop at exactly proposal creation time → GOV skips (stop_is_newer), MINT would refuse (StopIsNewer) if it were sent. GOV never sends it (skipped). ✓

**MINT `arm_guardian`:** sets pending_guardian = unwrap_or_default, pending_guardian_set = true, pending_guardian_at = now. No check on the guardian value (None = retire, legal; a default pubkey = None). Some(default) == None (R24.2 tests). ✓

**MINT `apply_guardian`:** requires pending_guardian_set, notice elapsed. Sets guardian = pending_guardian. ✓

**MINT `cancel_swap_operator`:** guardian only, pending != default. Clears. ✓

**MINT `apply_swap_operator`:** pending != default, notice elapsed. Sets swap_operator = pending. ✓

Hmm — `apply_swap_operator` doesn't check `pending_swap_operator_at` overflow: `checked_add(c.notice_secs).ok_or(Overflow)?`. ✓

**SEAL `open_for_redemption`:** reads asset owner and collection, checks owner signed, collection matches config, collection account matches asset's collection. Then the walk. Then set_frozen(false). 

Wait — does SEAL check the asset is currently FROZEN? No. If the vault is already thawed (can that happen?), open would just thaw again. But the vault can only be thawed by SEAL's open (the plugin authority is SEAL's PDA, and set_frozen is only called from open_for_redemption). And open requires a following burn, which destroys the vault. So a vault can never be left thawed. An already-thawed vault can't exist (except transiently within a redemption transaction). Within one transaction: open A (thaws), then... another open A? The second open's walk looks for a burn after it. If the transaction is [open A, open A, burn A]: first open finds burn A at index 2 ✓, thaws. Second open finds burn A at index 2 ✓, thaws again (no-op). Burn A: finds the FIRST open A at index 0 ✓. Lands. So a double-open is harmless. ✓

**BURN `burn_vault` — the `declared` count:** `ctx.remaining_accounts.len() == declared as usize`. The reserve loop requires each reserve ATA (both programs) to be FOUND in remaining_accounts. So declared >= 2 * n_reserves = 6 for 3 reserves. Extra accounts allowed (checked by the second loop). ✓

**BURN — `read_mint_supply`:** pinned address (derived), owner, disc, version. ✓

**BURN — the rate limit and `burned_total`:** incremented AFTER the Core burn and the retire CPI. If those fail, no increment. ✓

**MINT `retire_redeemed`:** stack height check (TRANSACTION_LEVEL_STACK_HEIGHT + 1 = 2). BURN calls it via `invoke` (not signed) from burn_vault (top-level). So the stack: burn_vault (height 1) → retire_redeemed (height 2). ✓. The instructions sysvar check: current instruction (at height 2, `load_current_index_checked` returns the TOP-LEVEL index) is burn_vault with matching disc and asset at account 0. ✓

Hmm wait — `load_current_index_checked` inside retire_redeemed returns the index of the top-level instruction being executed (burn_vault). It checks `ix.program_id == BURN_PROGRAM_ID && disc matches && accounts[0] == asset`. ✓. And the stack height is exactly 2, so retire_redeemed is called directly by burn_vault, not through another CPI layer. ✓

But wait — could burn_vault be called via CPI from another program, and then retire_redeemed's checks still pass? If program X CPIs burn_vault: burn_vault runs at height 2, retire_redeemed at height 3 → stack height check (== 2) fails → NotFromBurn. ✓. And BURN's own open-check: `load_current_index_checked` in burn_vault returns the top-level index of X's instruction; the walk looks for a preceding open_for_redemption at top level. If the attacker put a real open at top level and X's wrapped burn... the open's own check (SEAL) requires a real top-level burn after it. X's instruction is not BURN's burn_vault (program_id is X). So SEAL refuses. ✓ (WR.2, WR.3 test this.)

**MINT `is_burned`:** Core-owned, len 1, byte 0. ✓

**MINT `pool_is_frozen`:** pool.key == pool_ata, owner SPL Token, len 165, state frozen. ✓

**MINT `retire` with forfeit:** `if redeemed && !forfeit { require!(pending < ACC_SCALE, ClaimBeforeBurn) }`. With forfeit, no requirement. owed -= pending. ✓

**MINT `claim` — the frozen-destination deferral:** skips, stays owed. But note: `if touched { store_record }` — the boost expiry is stored even when deferred. BO.37 tests. ✓

**MINT `claim` — `owed_paid` accumulation and final `owed_scaled -= owed_paid`:** ✓.

Hmm — one thing in claim: for a frozen destination, `n_deferred += 1` and the owed stays. But `owed_paid` doesn't include it. ✓

**MINT `claim` — a vault whose dest account was closed (doesn't exist):** `require!(dest.owner == &SPL_TOKEN_ID && dest.lamports() > 0, VaultAccountMissing)`. A closed account: owner System (or lamports 0) → refused, whole batch reverts. Hmm — is that the right behavior? A vault whose cbBTC account was closed... can that happen? The vault's ATA is owned by the asset-signer PDA. Only the PDA can close it (via Execute). Inside a redemption, the sweep closes it — but then the redemption's claim already ran before the sweep. Outside a redemption, the vault is sealed, so the PDA can't sign, so the account can't be closed. So a live sealed vault's account always exists. ✓ (P.21 tests claim-after-sweep-close fails.)

**MINT `activate` — `read_token` on vault_token:** checks mint and owner (the derived signer PDA). The ATA derivation is also checked (`require_keys_eq!(ctx.accounts.vault_token.key(), want)`). ✓

**MINT `activate` — amount >= 21,000.** ✓

**MINT `distribute` — the w == 0 branch (tick):** requires waiting_to_join == 0, !burn, pending_this_epoch > 0, no remaining accounts, month elapsed. Then tick (stamps last_distribute_at, advances epoch). ✓

Hmm — `require!(!burn && c.pending_this_epoch > 0, NoActiveVaults)`. So the burn path with w == 0 is refused (NoActiveVaults). ✓ (3c.A3 tests.)

**MINT `distribute` — the burn path:** checks pool first (read_token at top), boosts_due == 0, w > 0, avail > 0, then burn accounts (4, burner signer, tprog == SPL_TOKEN, gmint == GARY_MINT and classic owner, balance >= 100 GARY, state initialized), waiting_to_join == 0, then the SPL Burn CPI, then credit. ✓

Wait — the pool read happens FIRST (before the boosts_due check). `read_token(&ctx.accounts.pool_token, &payment_mint, &pool_owner)`. If the pool account doesn't exist → VaultAccountMissing. Item 52 notes this (explicit distribute refuses until pool exists). ✓

**MINT `distribute` — `avail > 0` required (NothingToDistribute) before the burn.** So a burn with nothing to distribute burns nothing (PG.7). ✓

**MINT `monthly_inline` — the order of checks:** due? boosts_due > 0 → wait. waiting_to_join > 0 → wait. w == 0 → tick if pending_this_epoch > 0. pool not token → return. pool data checks (mint, owner, not frozen). avail == 0 → return. credit. ✓

Hmm — in monthly_inline, the w == 0 branch: `if c.total_active_weight == 0 { if c.pending_this_epoch > 0 { tick(c, now)?; } return Ok(()); }`. The tick stamps last_distribute_at and advances epoch. But note: this happens BEFORE the pool token checks. So the launch tick works even without a pool account (item 52: "performs the launch tick without reading the pool"). ✓

**A subtle issue with `tick` and `last_distribute_at`:** the tick stamps the month. So after the launch tick, the next free distribution is a month later. Stated (first free crediting payout at close + 60 days). ✓

**MINT `credit`:** delta = avail * SCALE / w (floor). acc += delta. owed += delta * w. last_distribute_at = now. advance_epoch. ✓

delta * w <= avail * SCALE (since delta = floor(avail*SCALE/w)). So owed increases by at most avail*SCALE. ✓

**GOV `cast_vote`:** reads asset owner live, checks proposal open, not executed, index < snapshot. VoteRecord init (fails if exists). ✓

**GOV `execute_proposal` — `read_stops`:** reads sales_stopped, sweep_stopped, and the _at times from MINT config. Used for the restart skip. ✓

**GOV — the `MintView` read:** `d.len() >= OFF_MINT_MAX_BOOST_EPOCHS + 2` = 714. MintConfig is 1261. ✓

**Now let me look at the SWEEP helper once more for anything missed.**

```rust
if data != [0] { return Err(InvalidInstructionData); }
if accounts.len() < 4 || (accounts.len() - 4) % 2 != 0 { return Err(NotEnoughAccountKeys); }
```
✓

```rust
if !signer.is_signer { return Err(MissingRequiredSignature); }
if *token.key != SPL_TOKEN_ID || *system.key != system_program::ID { return Err(IncorrectProgramId); }
if signer.key == dest.key { return Err(InvalidArgument); }
```
✓

Pair loop: read_token(src), read_token(to). src_owner == signer, to_owner == dest && to_mint == src_mint. Transfer if amount > 0. Close. ✓

Wait — `read_token(to)` returns (to_mint, to_owner, _). The destination's amount is ignored. Fine.

What if src == to (same account as source and destination)? Then src_owner == signer and to_owner == dest. signer != dest (checked). So src_owner != to_owner, so src != to. ✓

What if two pairs share the same source but different destinations? First pair closes the source; second pair's read_token fails (owner System). Refused, reverts. ✓

What if the destination is the SOURCE of a later pair? Pair 1: src1 → dest1 (dest1 owned by dest wallet). Pair 2: src2 = dest1? src2 must be owned by signer (the vault PDA). dest1 is owned by dest wallet. signer != dest wallet. So no. ✓

Lamport sweep: `signer.lamports()` read after the pair loop. The closes credit rent to dest (not signer). So signer's lamports are unchanged by the pairs. Then transfer all to dest. ✓

Hmm — wait, the CloseAccount credits the source's lamports (rent) to `dest` (the destination wallet), NOT to the signer. So the rent goes to the owner directly, not through the lamport sweep. ✓ (SR.4a accounts for this: "the closed cbBTC account's rent".)

**One more check on the helper: what if a pair's `to` account is the same as `dest` (the destination wallet itself, not a token account)?** read_token(dest_wallet) — dest_wallet is a system account (owner System) → IllegalOwner. Refused. ✓

**What if `to` is a token account of the right mint and owner but FROZEN?** The transfer to a frozen destination refuses (0x11). Reverts. Hmm — the destination is the OWNER's account. If Coinbase froze the owner's cbBTC account, the redemption can't proceed. But the owner could name a different destination wallet (they choose dest). Actually — the destination wallet is arbitrary; the owner can use any wallet they control with an unfrozen account. So a frozen owner account is route-around-able by the owner. Not a lock. ✓

**Now, the off-chain files bundled.** Let me check a few things.

**scripts/rehearsal-tree.sh:** The map substitution. `pairs[:-1]` in the abbreviated-id check skips the last pair (the root path). Checks no 4-char prefix of any real id remains. The reverse-proof. Looks sound. One thing: the check `if any(n in src for n in news)` — refuses if a file already contains a throwaway id (on rerun after checkout -- ., files are pristine, so fine).

Hmm — the keypairs: `[ -s "$kp" ] || solana-keygen new ...`. Reused across reruns. The map is rebuilt each run (`: > "$MAP"`). ✓

**scripts/token-programs.sh:** pins three token programs by sha256, fetches from mainnet if missing, verifies on the validator. ✓

**tests/expiry-budget.mjs:** synthetic genesis, 20 due boosts, expire_boosts at default and raised CU. Checks logs count 20, counters conserve. The config is hand-encoded via bank/layout.mjs encode. dist_epoch: 1n, boost_end_epoch: 1n for all records → all due (dist_epoch >= end). boosts_due: 20. expire_boosts expires all 20. total_active_weight: 280 → after: 280 - 20*12 = 40. ✓ (20 records × weight 12 boost; base level 1 → weight 2; 20 × 2 = 40 ✓).

Wait — the records have `level: 1, boost_weight: 12`. weight_of = 2 + 12 = 14. After expiry: boost 0, weight 2. total = 20 × 2 = 40. ✓. And `owed_scaled: 2800n * ACC_SCALE` — hmm, that's 20 × 14 × 10 × SCALE? acc_scaled = 10*SCALE. owed per record = 14 × 10×SCALE = 140×SCALE. 20 records → 2800×SCALE. ✓ consistent.

The test asserts `after.total_active_weight === 40n`. ✓

**scripts/audit-coverage.sh:** the coverage gate. It checks every tracked file's current content was in a completed quorate round's bundle. The selftest has 14 cases (9 headline + 5 bundle-shape). Round 33 verdict says 14/14. ✓

Hmm — one thing: the gate reads `audits/round{N}/MANIFEST-{focus}.json` and VERDICT files. For THIS round to count toward coverage, it needs a MANIFEST and a VERDICT with the exact headline format. That's process, not code.

**tests/initauth.test.ts:** the key proof. For each program, builds well-formed initialize args, sends with the test key, expects REJECTS (mainnet) or ACCEPTS (localnet, possibly via REACHED_PAST errors). The mint args list: bank_treasury, swap_operator, guardian Some, sol_reserve 0, max_supply 2100, max_sweep 50 SOL, cooldown 3600, caps 10×5, payment_mint k, pob_collection k, pob_root [1;32], opens now, closes now+86400, monthly 2592000, notice 604800, floor 1 SOL, coolCeil 86400, resCeil 0.1 SOL, maxBW 6, maxBE 24. That's 21 args matching MINT's initialize signature (bank_treasury, swap_operator, guardian, sol_reserve_lamports, max_supply, max_sweep_lamports, sweep_cooldown_secs, level_caps, payment_mint, pob_collection, pob_root, charter_opens_at, charter_closes_at, monthly_secs, notice_secs, sweep_floor_lamports, cooldown_ceiling_secs, reserve_ceiling_lamports, max_boost_weight, max_boost_epochs) = 20 params. Let me count the encoded: pk, pk, Some(pk), u64(0), u64(2100), u64(50e9), i64(3600), 5×u32, pk, pk, [1;32], i64(now), i64(now+86400), i64(2592000), i64(604800), u64(1e9), i64(86400), u64(1e8), u8(6), u16(24). That's 2 + 1 + 3 + 5 + 2 + 1 + 2 + 1 + 1 + 1 + 1 + 1 + 1 = let me count items: bank_treasury✓, swap_operator✓, guardian✓, sol_reserve✓(0), max_supply✓(2100), max_sweep✓(50e9), sweep_cooldown✓(3600), level_caps✓(10,10,10,10,10), payment_mint✓, pob_collection✓, pob_root✓([1;32]), opens✓, closes✓, monthly✓, notice✓, floor✓(1e9), coolCeil✓(86400), resCeil✓(1e8), maxBW✓(6), maxBE✓(24). All 20. ✓

Hmm wait — sol_reserve_lamports = 0. MINT's initialize: `require!(sol_reserve_lamports == 0 || sol_reserve_lamports >= RENT_EXEMPT_0_BYTES)`. 0 passes. And `reserve_ceiling_lamports >= sol_reserve_lamports && >= RENT_EXEMPT_0_BYTES && <= MAX_RESERVE_CEILING_LAMPORTS`: 1e8 >= 0 ✓, 1e8 >= 890,880 ✓, 1e8 <= 1e10 ✓. And sweep_floor 1e9 >= MIN_SWEEP_FLOOR_LAMPORTS (1e8) ✓ and <= max_sweep (50e9) ✓. cooldown_ceiling 86400 >= sweep_cooldown 3600 ✓ and <= MAX_SWEEP_COOLDOWN_SECS (7 days = 604800) ✓. max_sweep 50e9 >= MIN_INIT_SWEEP_LAMPORTS (1e9) ✓ and <= MAX_SWEEP_LAMPORTS (50e9) ✓. sweep_cooldown 3600 in [1, 86400] ✓. notice 604800 in [60, 2592000] ✓. monthly 2592000 in [60, 2592000] ✓. charter: closes > opens ✓, 86400 <= 90 days ✓, closes > now ✓. pob_root [1;32] != 0 ✓. caps: all > 0, sum 50 <= 2100 ✓. maxBW 6 in [1,12] ✓, maxBE 24 in [1,63] ✓.

So on localnet, the probe gets PAST the authority check and fails at... the collection check (k is not a Core collection) → WrongCollection, which is in REACHED_PAST for mint. ✓. On mainnet, NotTheInitAuthority. ✓

**tests/probe-round5.test.ts and probe-round5b.test.ts:** retained v5 probes. Round 33 A14: "retained probes nothing runs or cites". They use v5 shapes (bank keypair, old initialize args). Nothing runs them (run-tests.sh doesn't invoke them). They're dead weight but not harmful. Hmm — wait, does anything run them? grep run-tests.sh: no. They're not in the floors. So they're historical. Fine.

Actually wait — probe-round5.test.ts's MINT initialize call uses the OLD signature (collection, bank, gov, treasury — 4 pubkeys). That would fail Anchor deserialization on the current program. But nothing runs it. OK.

**sim/test-vault.ts:** 71 assertions. S8.0 measures the redemption through the helper at 1,061 bytes (with room for compute pair + separate payer). S8.1a measures CU. S9b two redemptions in one v0 tx. Looks consistent with the claims.

**sim/fixtures.mjs and clone-pob.mjs:** patch only the mint authority / owner, asserted byte-for-byte. ✓

**scripts/probe-mainnet-facts.mjs:** the walk, reserve mints classic, ELF offset 45, PoB set, decimals. 33 assertions (MAINNET_FLOOR=33). Let me count the t() calls: walk: 4 (gap, pages>1000, stops, newest first... wait: capped.gap true (1), pages past cap (2), stops gap false (3), newest index 0 (4), cursor excluded (5). That's 5. Reserve mints: 3 mints × (classic owner (1), no extensions (1), freeze authority (1), T22 ATA refuses (1), classic control (1)) = 15. ELF: 2 programs × 4 = 8. PoB: 240 count (1), root rebuilt (1), every address live-or-burned (1), cbBTC 8 decimals (1), $GARY 9 decimals (1) = 5. Total: 5 + 15 + 8 + 5 = 33. ✓

**scripts/run-tests.sh:** floors: DET 909, ALLOC 39, POSTER 23, POB 14, LAUNCH 47, HOST 6, MAINNET 33, MIN_ASSERTIONS 866, EXPIRY 4. SPEC's stated counts: "866 assertions... (+ 909 detector, 39 allocation, 23 poster, 4 expiry-budget, 14 Proof-of-Burn, 47 launch and 33 live-mainnet... 6 host... 16 swap-fork... 71 simulation". All consistent. ✓

**scripts/build-mainnet.sh:** builds both, asks all four programs both ways, cmp's the sweep helper three ways (dist vs ln build, dist vs target/deploy). ✓

**HOLDER-GUIDE.md vs the code:** Let me check some promises:
- "Opening needs your wallet's signature and nobody else's." ✓ (owner signs open + burn; the sweep's Execute needs the owner).
- "Nothing can leave it while it is closed. Not even by you." ✓ (seal).
- "Opening is all or nothing." ✓.
- "Your level never changes." ✓ (AlreadyRevealed; 11.13-11.15).
- "85% goes to activated vaults. 15% goes to the CBOBTC treasury." ✓.
- "Payouts are credited to your vault every month once due and delivered inside your vault, in cbBTC." ✓.
- "A boost can add up to 12 while it lasts" — max_boost_weight ruled 12. ✓.
- "The first payout cannot happen until a month after the charter window closes, not even by burning $GARY" — hmm. Let me check. last_distribute_at starts at max(now, charter_closes_at). The burn path requires w > 0 (a joined vault). To join, a distribution (epoch advance) must run after the request. The first epoch advance: the free tick at charter_closes_at + 30 days (monthly_secs). Before that tick, no vault can join (dist_epoch == request_epoch for all requests). So before close+30d: w == 0, burn path refused (NoActiveVaults), free path refused (MonthNotElapsed). At close+30d: the free tick advances the epoch (credits nothing). Then vaults join. Then a 100 $GARY burn CAN distribute (w > 0 now). So the first CREDITING payout can be at close+30d via a burn. The guide says "The first payout cannot happen until a month after the charter window closes, not even by burning $GARY: until then no vault has joined the payouts. At that one-month mark, the vaults activated by then join. From then on a 100 $GARY burn can run a payout, and the first free monthly payout comes a month after that." ✓ matches (SPEC round 25 D2).

Hmm wait — "At that one-month mark, the vaults activated by then join." The tick advances the epoch; then a claim joins them. The guide says they join at the one-month mark — approximately right (they join when anyone claims after the tick; the crank does it). OK.

- "If Coinbase freezes your vault's cbBTC, you cannot open it at all... until Coinbase unfreezes it." ✓ (BURN requires empty reserve accounts; a frozen account can't be emptied — the sweep's transfer reverts). Wait — actually, can the redemption proceed if the vault's cbBTC account is frozen? The sweep helper's transfer from the frozen source reverts. So the redemption fails. But what if the frozen account has 0 balance? Then the helper just closes it (close succeeds on frozen, per round 30 measurement). Then BURN sees the closed account (skipped). So a frozen EMPTY account doesn't block. But a frozen account with a balance blocks. The guide says "you cannot open it at all" — true when there's a balance (which is when it matters). ✓

- "If the pool is frozen, payouts stop until it is unfrozen, but you can still open your vault and take everything inside it; only payouts credited and not yet delivered stay behind for the vaults that remain." ✓ (3c.F2 forfeit).

- "A vault held by a multisig or a DAO cannot be opened." ✓ (limit 43).

- "Every opening is public. It is announced on X and on the Bank's website." — item 50: the poster has no sender. This is a promise not yet kept (OPEN AND BLOCKING, the guide is marked DRAFT and may not be published before item 50 ships). ✓ consistent with item 50.

- "the redeem page (being built) will check and warn you before you sign" — "being built" — item 50 says the guide "speaks of these surfaces in the present tense" and may not be published. This sentence says "being built", which is honest. Hmm, round 25 L1 said the guide speaks in present tense; this sentence at least is hedged. But "The redeem page offers this and does the steps for you" (in "How you get paid") is present tense. Item 50 covers this — the guide may not be published before item 50 ships. Not a new finding.

- "the Bank's pages show it" (deposit address) — present tense, not built. Item 50. Same.

- "our payout job runs it, ordinary activity runs it too, and if both ever stopped, anyone can run it for free." ✓.

- "the draw job checks every minute" ✓ (crank reveal lane).

- "A vault that has just become eligible can, with the right timing and as little as one 100 $GARY burn... share in what was waiting." ✓ (limit 55).

- "Someone could send a tiny amount into your vault while you are opening it. On the redeem page that cannot block the opening." ✓ (helper sweeps at execution).

- "The hourly limit slows how fast vaults can be opened, not how fast they can be moved." ✓ (limit 41).

- "Whoever holds it (us, or someone who stole it) could keep up to 10 SOL of royalty money every 6 hours (the launch settings; a vote can only make that smaller) until the guardian stops it." ✓ (limit 10).

- "Even an honest swap can come in up to 1.5% below Pyth's price, and further if Pyth's own price is off." ✓ (150 bps floor).

- "All $CBOB not yet released sits in one online wallet" ✓ (limit 56).

- "During the 7-day charter window, one Gary Club key could decide who gets a vault." ✓ (limit 46).

- "The validator producing the last of those blocks can pick among several results" ✓ (limit 26).

- "A draw nobody records in time is drawn again... the minter could use this to turn down a draw they dislike." ✓ (limit 25).

- "Leave add-ons off your vault NFT... when it holds about 10 KB, Core can no longer empty it or remove any add-on from that vault, including delegates you approved. In tests such a vault still drew its level, its owner locks still came off, and a transfer and a full opening both passed a simulation, but not every combination of add-ons has been tested." ✓ (limit 40 round 28 boundary).

Hmm — "Core can no longer empty it" — wait, the round 28 boundary says Core cannot SHRINK the asset (clear signatures, remove plugins), not that it can't empty the vault. "empty it" here means... the vault's contents can still be swept (R28.A4 simulated the full redemption successfully). Let me re-read the guide: "when it holds about 10 KB, Core can no longer empty it or remove any add-on from that vault". Hmm. "empty it" — if the redemption simulation passed (R28.A4), then the vault CAN still be emptied (swept and burned). The round 28 text says "Core could not shrink that real vault: clearing the signatures and RemovePlugin of even the small FreezeDelegate exhausted the heap". So "empty" in the guide is wrong? Let me re-read: "once you add an autograph book, anyone can sign it, and when it holds about 10 KB, Core can no longer empty it or remove any add-on from that vault, including delegates you approved."

Hmm — "empty it" might mean "empty the autograph book" (clear the signatures). R28.A2: clearing the signatures exhausted the heap. So "Core can no longer empty [the autograph book] or remove any add-on". That reading is accurate. But it's ambiguous — "empty it" could be read as "empty the vault". Given the next sentence says "a transfer and a full opening both passed a simulation", the intended reading is probably "empty the autograph". Borderline. The round-28 limit text says "the owner cannot remove ANY owner-managed plugin from it". The guide's "remove any add-on" matches. "empty it" = clear the autograph. I'll note it as a possible ambiguity but it's defensible. Actually — hmm, wait. Let me reconsider. Is it TRUE that Core can't empty the autograph? R28.A2 measured clearing the signatures reverts (heap exhausted). So yes. OK, defensible.

**Now let me look for anything the round-33 verdict's refutations might have gotten wrong, per the instruction to test its conclusions.**

W1 (the FIFO-halting reveal): refuted by measurement, and now pinned by R33.G1/G2a/G2b in the suite. The suite arms are in the bundle and look real (they check the level was drawn and the autograph survived). ✓

W2 (royalty re-delegation): refuted, pinned by R33.G3. ✓

L1 (pre-funded program id): the repair is in SPEC road step 9. The recovery path is reasoned/measured. OK.

D3 (arm 2.1): repaired. ✓

Now — let me think about whether there are any NEW defects I can find. Let me look at some less-traveled paths.

**`expire_boosts` — `require!(!rem.is_empty() && rem.len() <= MAX_EXPIRE_BATCH, BadClaimList)`.** MAX_EXPIRE_BATCH = 30. The error is BadClaimList (cosmetic, A16 in round 33 — accepted as cosmetic). ✓

**`expire_boosts` — `load_record(ri)` requires owner == crate::ID and version == 4.** A record from another program or wrong version → BadVaultRecord, refuses the whole batch. Hmm — so a batch with one junk record refuses entirely. The comment says "anything else (no boost, not due yet, retired) is skipped" — but a non-record account REFUSES. Is that a liveness issue? The crank builds batches from chain state (real records), so fine. A griefer can't inject records into the crank's batches. OK.

**`claim` — `load_record` same.** A junk record in the pairs refuses the batch. The crank builds from chain state. OK.

**`crank` — skips non-records gracefully.** ✓ (K.3 tests.)

**`capture_entropy` — `require!(r.level == 0 && !r.entropy_set, AlreadyCaptured)`.** ✓

**`reschedule_reveal` — `require!(r.level == 0 && !r.entropy_set)` and `now > reveal_slot + REVEAL_WINDOW_SLOTS`.** Sets reveal_slot = now + 16. ✓

Hmm — can reschedule be called repeatedly to keep pushing the reveal slot forward? Each call requires the window to have passed. After rescheduling to now+16, the next reschedule needs now' > (now+16) + 300. So at most once per ~316 slots. And each is logged and counted. Accepted limit 25. ✓

**`reveal_level` — the `burned` check:** `*a.owner == MPL_CORE_ID && d.len() == 1 && d[0] == 0`. For a live asset: checks owner Core, d[0] == KEY_ASSET_V1. ✓

**`reveal_level` — the draw:** `x = u64::from_le_bytes(entropy[0..8]) % total`. Walks remaining. ✓

**`reveal_level` — `require!(total > 0, LevelCapReached)`.** When the census is exhausted, no more reveals. But check_supply at mint prevents minting beyond the census, so every minted vault gets a draw. ✓

**`write_record` — `reveal_slot = slot + REVEAL_LEAD_SLOTS` (16).** ✓

**`create_vault` — the CreateV2 encoding.** Plugins: PermanentFreezeExecute (frozen=1, authority Address seal_pda), Attributes (authority Address mint_authority). The suite asserts the vault is born frozen (2.3a) and the seal authority is SEAL's PDA (2.3). ✓

**`initialize` — the Royalties plugin install.** AddCollectionPluginV1, Royalties, 1000 bps, 1 creator (revenue PDA, 100%), RuleSet::None, authority None. R.1-R.4 assert on chain. ✓

**`initialize` — the collection checks:** Core-owned, KEY_COLLECTION_V1 (5), update authority = mint PDA, name/uri walked, num_minted == 0, current_size == 0, nothing after (no plugin header). ✓

Hmm — `require!(d.len() == o + 8, CollectionNotClean)`. After name and uri (two length-prefixed strings) and 8 bytes (num_minted + current_size), the length must be exactly o+8. So no plugin registry. ✓

**`check_seal_wiring` / `seal_reserves`:** pinned address, owner, disc, version, collection match. seal_reserves reads n <= 3. ✓

**`split_revenue` — `decimals` parameter:** passed to TransferChecked. The caller supplies it! If wrong decimals, TransferChecked fails (mint's actual decimals don't match). So a wrong decimals just fails. ✓

**`split_revenue` — the two transfers in a loop:** holders first, then bank. If bank_cut == 0, skipped. If holders == 0 (total == bank_cut, i.e., total small)... holders = total - bank_cut. bank_cut = total * 1500 / 10000 (floor). For total = 1: bank_cut = 0, holders = 1. For total = 7: bank_cut = 1, holders = 6 (8.6b/c test). ✓

**`sweep_sol_for_swap` — `require!(amount > 0, SweepAboveCap)`.** Zero refused (6.17b). ✓

**GOV `initialize` — `read_mint_config` and collection match.** ✓

**GOV — `MIN_QUORUM_BPS = 500`, quorum 500..10000, threshold 5001..7500.** Ruled 2100/5100. ✓

**GOV `create_proposal` — `dur >= min_voting_secs && dur <= MAX_VOTING_SECS`.** ✓

**GOV `execute_proposal` — `need > 0` for quorum, turnout, key change.** With snapshot 0 (no live vaults)... can a proposal be created with quorum_supply 0? create_proposal requires the proposer to own a live vault, so minted_total >= 1, but live could be... minted_total - burned - bare = 0 only if all minted vaults are burned. But the proposer's vault is live. So live >= 1. ✓

**Now — a deeper look at the `claim` + `monthly_inline` interaction in a redemption (A15 from round 33).** GLM F2: a claim whose leading monthly_inline is blocked by the last waiting vault, which it then joins, lets the next burn's trailing run credit that vault, so its own later burn refuses ClaimBeforeBurn. Round 33 accepted this as A15: "a reverted, retryable self-grief in a shape the client contract does not use (two helper redemptions do not fit one legacy packet; SPEC 50 measures one). Single-vault redemptions are safe (retire precedes the run)." Let me verify this is truly only a multi-vault issue.

The scenario: transaction = [claim (joins vault W, the last waiting vault), open A, sweep A, burn A, open B, sweep B, burn B]. The claim's monthly_inline runs BEFORE the join (monthly_inline is called after crank, before payments). If the month is due but waiting_to_join > 0 (W waiting), monthly_inline waits (logs CBOB_MONTHLY_WAITS_FOR_JOINS). Then the claim joins W. Now no one is waiting. Burn A: retire_redeemed retires A, then monthly_inline runs — now due and no one waiting → credits W (and others). W is now owed. Burn B: if B == W? No, B is a different vault. Burn B's retire: B is owed? If B was active and owed < 1 sat, fine. The issue is if B is W — but W was just joined, not being redeemed. Hmm, the A15 scenario: "its own later burn refuses ClaimBeforeBurn" — whose burn? Let me re-read: "a claim whose leading monthly_inline is blocked by the last waiting vault, which it then joins, lets the next burn_vault's trailing run credit that vault, so its own later burn refuses ClaimBeforeBurn". So the vault being redeemed IS the one that was waiting (W). Transaction: [claim (joins W), open W, sweep W, burn W]. The claim joins W (owed nothing at join). Open W, sweep W, burn W: retire_redeemed(W) — W is owed 0 (just joined) → retire OK. Then monthly_inline runs (after retire): credits W and others. W is retired, so it's not credited (weight removed). Wait — retire removes W's weight BEFORE monthly_inline. So W is not credited. So no ClaimBeforeBurn. Hmm.

Let me re-read A15 more carefully: "a claim whose leading monthly_inline is blocked by the last waiting vault, which it then joins, lets the next `burn_vault`'s trailing run credit that vault, so its own later burn refuses `ClaimBeforeBurn`." 

Maybe the shape is: [claim(join W), open A, sweep A, burn A, open W, sweep W, burn W] — two redemptions. Burn A's trailing monthly_inline credits W (W was joined by the claim, and burn A's retire only removed A). Then burn W's retire: W is owed >= 1 sat → ClaimBeforeBurn. The whole transaction reverts. Retryable (just claim W first). And two helper redemptions don't fit one legacy packet anyway. So it's a non-issue in practice. Round 33's disposition is correct: single-vault redemptions are safe because retire precedes the trailing monthly run, and the redeemed vault is never credited after its own retire.

Wait, but let me double-check the single-vault case with a waiting vault W elsewhere: [claim (joins W), open A, sweep A, burn A]. Burn A retires A, then monthly_inline credits W (and others). A is already retired, so A is not credited. The transaction lands. W is now owed — but W isn't being redeemed. Fine. ✓

And the case where the redemption itself carries a claim for A (the redeemed vault): [claim A (pays A's owed), open A, sweep A, burn A]. Claim's monthly_inline: if due and no one waiting, credits A (and others) — then the claim pays A's new owed too (the claim reads acc AFTER monthly_inline). So A is paid in full. Then burn A: retire (owed < 1 sat ✓), then monthly_inline (not due — just ran in the claim... wait, did it? monthly_inline stamps last_distribute_at, so the second call in burn A sees not-due). ✓. If the claim's monthly_inline was blocked (waiting joins), then burn A's monthly_inline might run after the joins happened in the claim... but the claim only joins vaults named in its pairs. If the claim names only A, and W is waiting elsewhere, the claim's monthly_inline waits (W waiting), the claim pays A (owed from before), burn A retires A, then burn A's monthly_inline still waits (W still waiting — the claim didn't join W). So no credit. Lands. ✓

OK so single-vault redemptions are safe. A15 is correctly bounded.

**Let me look at the `join` + `retire` interaction for a vault that joined and immediately retires.** join sets active, debt = w*acc. retire: pending = w*acc + 0 - w*acc = 0. owed -= 0. weight -= w. active_count -= 1. ✓

**A vault that requested activation and is then boosted?** boost requires active && !pending. Refused (BO.20). ✓

**A vault that is boosted and then... its level can't change. Its boost_end_epoch can't change. ✓**

**`set_boost_terms` with price 0:** sets weight/epochs to 0. Existing boosts keep their terms (their end_epoch and weight are on the records). ✓

**`boost_vault` when boosts are off (price 0):** BoostsOff. ✓

**`boost_vault` — `require!(price <= max_price && extra >= min_weight && epochs >= min_epochs, BoostTermsMoved)`.** One-sided (favorable moves land). Ruled. ✓

**The $CBOB mint check in boost_vault:** `require_keys_eq!(ctx.accounts.cbob_mint.key(), cbob)` and owner SPL_TOKEN. The burner's token account: read_token checks mint == cbob and owner == burner. Then SPL Burn CPI. ✓

**`cbob_burned_total`:** += price. ✓ (BO.18.)

**Now — the off-chain `bank/` files are mostly not bundled.** The prompt bundles bank/txread.mjs and bank/sigwalk.mjs only (plus references). Let me check those two.

**bank/txread.mjs:** validates parsed transactions. v1 requires transactionConfig and no lookup-table keys. The truncatedLogs flag. The money-instruction validation. Looks careful. One thing: `need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key')` — v1 transactions have inline accounts (64), so lookup tables... v1 doesn't use address lookup tables the same way? The prompt says v1 allows 64 inline accounts. So refusing lookupTable source in v1 is a coverage refusal (fail-closed). S2 in round 33 (shared with off-chain): "bank/txread.mjs refuses v1 lookup-table keys — fail-closed by design". OK.

**bank/sigwalk.mjs:** pages with before/until, gap if maxPages exceeded. startBefore for resume. ✓

**Now let me think about whether the round-33 repairs introduced NEW defects (R0: "verify every repair at all sites of its shape and for regressions").**

The repairs: SPEC text (2), DESIGN text (1), suite arm 2.1 (1), road step 9 text (1), four new suite arms (R33.G1, G2a, G2b, G3, G4), off-chain (detectors — not bundled).

Regression check on the new suite arms:
- R33.G1/G2b: they run after `revealAll()` in section 10. They check `worstShape` and `crowdShape` vaults have levels and intact autographs. If the reveal of those vaults had failed, `revealAll()` would have thrown (it awaits each reveal send). So the arms are consistent. But wait — do these arms actually pin the "default compute budget" claim? The reveals in revealAll use `ixReveal` without a compute-budget instruction, so they run at the default 200,000 CU. If the worst-shape reveal needed more, the send would fail and revealAll would throw → suite red. So the pin is real. ✓

- R33.G2a: the SIGSPDA! wrapper grows the autograph until Core's heap refuses. `kept>=20` required. The measured max was 56/57. The arm requires kept >= 20 (conservative) and the refusal to be a heap error, and `now===kept` (chain kept the list). ✓

- R33.G3: re-delegation refused 0x1b, control lands. ✓

- R33.G4: the wSOL close. It loads bank/swap.mjs via a node child (ESM), gets the swap's instruction list, filters out the venue call and cbBTC accounts, runs the rest (wrap, sync, close) against a stranger's pre-filled wSOL account. Checks the account closed and the operator got the lamports. Hmm — this tests that the swap's own instruction sequence closes a pre-filled wSOL account. The stranger's 0.5 SOL goes to the operator (the close sends rent + balance to the operator). Wait — is that the DESIRED behavior? A stranger pre-fills the operator's wSOL account with 0.5 SOL; the swap's close sends it all to the operator. So the operator gains the stranger's lamports. That's a gift to the operator, not a loss. The point is the close doesn't fail (a pre-filled account doesn't break the swap). ✓

Hmm, one thing about R33.G4: `SL.ixs.length` should be 7 (the seven-instruction sequence). The arm checks `${SL.ixs.length}` == 7. ✓ (part of the want string `ALLOW,7,true,closed,true`).

**Now, are there any sites of the round-33 finding SHAPES that were missed?**

D3's shape (an arm that can't fail): are there other arms like the old 2.1? Let me scan for `rec(` calls where the `got` is a constant or always-true... 

- `rec('C.2','alice burns PoB #1 and claims a charter vault, ALONE, at price 0','true',String(!!C1))` — C1 is built by `claim(alice,0)` which awaits send; if the claim failed, send throws and the suite crashes (FATAL). So `!!C1` is always true, but the claim's failure would crash the run (exit 2), not pass. Hmm — is this an arm that cannot fail? The `claim` helper: `await send([...crankCU(o),ixClaim(...)],[owner,kp])` — send = sendAndConfirmTransaction, which throws on failure. So if the claim fails, the suite crashes red (exit 2), and the floor check (866 == 866) fails too. So C.2 can't false-pass. It's like A7 in round 33 ("arms that throw — a crash is FATAL, exit 2, red; no false pass"). OK.

- Similar: `rec('P.2a',...)` computes from chain state. `rec('RL.6',...)` reads the bucket. These measure.

- `rec('WR.pre','(precondition) a live, sealed, funded vault alice owns','true',String(!!T))` — if T is null, this records false → red. ✓ can fail.

- `rec('SR.pre',...)` same. ✓

- `rec('BO.pre',...)` checks mine.length >= 4. ✓

**Let me look at the `ledger()` / `books()` checks (BK.*).** They recompute weights, boost totals, ring, pool >= owed, owed == sum of shares from every record. The BK arms assert the labels were all pushed (i.e., ledger() balanced after each named operation). If ledger() failed after an operation, the label is missing and the BK arm fails. ✓ This is a strong invariant check.

Hmm — one gap: `ledger()` iterates `VAULTS` (the suite's local list). Every vault minted in the suite is in VAULTS (mkV pushes). Vaults minted by mintCU? `mkV(k,alice,[])` — yes pushed. The v0-minted kAt — `mkV(kAt,alice,exact())` pushed. The crowd vault cv — `mkVault(0n)` pushes. OK. And deduped by address. ✓

**Now let me check the `capAt`/`stampCaps` logic (RL.S1-S6, RL.7).** The cap certification across snapshot intervals. RL.7 replays the ring. The stamps map ordinal → cap. If an interval is ambiguous (cap changed within), the run fails. This is the round-26 repair. Looks sound.

**Let me look at `waitRedeemToken` / `bucket`.** Computes live, cap, ring, room. The k-th most recent: `recent(k) = ring[((head-k)%64+64)%64]`. Matches the program. ✓

**Now — potential issue: the suite's `send` waits for a redeem token before any burn.** But `sendNow` doesn't. RL section uses sendNow to fill the window. OK.

**Let me look at the `ixBurn` POOLK:** the pool is passed as read-only in ixBurn (`POOLK={pubkey:POOL,isSigner:false,isWritable:false}`). But BURN's BurnVault has `pool_token: UncheckedAccount` (not mut). And MINT's retire_redeemed passes it to monthly_inline which only reads it. ✓. But wait — monthly_inline doesn't write the pool; it reads the balance. The claim writes the pool (mut). In ixPoolClaim, pool is writable. ✓

**Hmm — in `retire_redeemed`, monthly_inline is called with `&ctx.accounts.pool_token`. monthly_inline may call `credit` which... doesn't touch the pool account (credit only updates config). So pool read-only is fine. ✓**

**Let me check `claim`'s pool writability:** the claim transfers OUT of the pool (invoke_signed with config as authority). pool_token is `#[account(mut)]`. ✓

**Now — a careful look at `monthly_inline`'s pool data check:**
```rust
if d.len() != TOKEN_ACCOUNT_LEN || d[0..32] != c.payment_mint.to_bytes() || d[32..64] != config_key.to_bytes() {
    return Ok(());
}
```
So a pool account that is a token account of the wrong mint or owner → treated as "holds nothing" (return Ok). But `require_keys_eq!(pool.key(), c.pool_ata, WrongPool)` at the top pins the ADDRESS. The pool ATA is derived from config PDA + SPL Token + payment_mint. Only that address. If somehow that address holds a non-token account or wrong-mint account (impossible for an ATA — the ATA program creates it correctly), it degrades gracefully. ✓

**`pool_is_frozen`:** same address pin. ✓

**Now — let me reconsider R2's core invariant once more, looking for a leak.**

"the pool always holds at least ceil(owed)". 

Outflows from the pool: (1) claim payments (reduce owed by the same scaled amount), (2) nothing else. `split_revenue` sends TO the pool. `distribute`/`credit` doesn't move tokens. So the pool's balance only decreases via claim, and claim decreases owed by exactly paid*SCALE. So balance - ceil(owed) is non-decreasing... wait: balance -= pay; owed -= pay*SCALE; ceil(owed) -= pay. So balance - ceil(owed) unchanged by a claim. By credit: balance unchanged, owed += delta*w <= avail*SCALE, so ceil(owed) increases by <= avail. balance - ceil(owed) >= 0 preserved. By split: balance += holders. By retire: owed -= pending. By forfeit: same. So the invariant holds. ✓

Can anyone move tokens OUT of the pool except claim? The pool is the config PDA's ATA. The config PDA signs only in `claim` (invoke_signed with CONFIG_SEED). No other instruction uses config as a signer for a token transfer. `split_revenue` uses REVENUE_SEED. So no. ✓

**Can the config PDA's authority be abused?** `claim`'s invoke_signed: `[&[CONFIG_SEED, &[bump]]]`. The transfer is from pool_token to dest, authority = config PDA. The dest is checked (r.vault_ata). The amount is `pay` (computed). So the claim can only move `pay` to the vault's own account. ✓

**Now — GOV's CPI into MINT:** `invoke_signed` with GOV_SEED. The accounts: mint_config (mut), gov_pda (signer). MINT's Governed struct: `config` (seeds CONFIG_SEED, bump, has_one governance), `governance: Signer`. So MINT checks the config is the real one (seeds) and governance matches config.governance. The gov PDA is derived from GOV's id. MINT's config.governance was set at initialize to the gov PDA. ✓

**Could GOV be initialized pointing at a different MINT?** GOV's initialize reads MINT's config (pinned address derived from MINT_PROGRAM_ID) and requires the collection matches. MINT_PROGRAM_ID is a constant. ✓

**Could MINT's config.governance be anything else?** Set at initialize to `Pubkey::find_program_address(&[GOV_SEED], &GOV_PROGRAM_ID)`. GOV_PROGRAM_ID is a constant. Never written again. ✓

**Now — the `has_one = governance` constraint:** config.governance == governance.key(). And governance must be a signer. Only the gov PDA can sign (via GOV's invoke_signed). ✓

**Let me look at `set_round` once more:** round_id += 1, sets opens/closes/price/cap, minted_this_round = 0. A new round while an old one is open: overwrites. The old round's mints stop (round_id changed, but mint_vault checks the CURRENT round's window/cap/price). Hmm — `mint_vault` checks `cfg.round_id > 0`, `now >= opens_at && now < closes_at`, `minted_this_round < cap`, `price <= max_price`. It doesn't check which round the buyer "meant". If a new round is set between the buyer's simulation and landing, `max_price` protects the price. The window and cap are the new round's. The buyer mints in the new round at the new price (if <= max_price). That's the slippage guard's job. ✓

**`mint_vault` — `check_supply`:** minted_total < max_supply AND < cap_total. ✓

**`mint_vault` — the payment:** TransferChecked of cfg.price from payer_token to revenue ATA. The revenue ATA is derived. The payment mint is checked (config.payment_mint, SPL owner, 82 bytes). decimals read from the mint. ✓

**`mint_vault` — `check_seal_wiring` and collection match.** ✓

**`mint_vault` — `create_vault` with the hardcoded plugins.** ✓

**`mint_vault` — `write_record` then `crank`.** ✓

**`claim_charter_vault` — the PoB checks:** Core asset, KEY_ASSET_V1, owner == signer, update authority disc == Collection (2), collection == pob_collection. Merkle proof. Burn CPI with extras. Then create_vault with charter attribute. ✓

Hmm — the PoB's `d[33] == UA_DISC_COLLECTION` and collection at d[34..66]. For a Core AssetV1: key(1) + owner(32) + update_authority. The update authority is a enum: disc byte + maybe pubkey. UA_DISC_COLLECTION = 2 means "Collection", followed by the collection pubkey. ✓ (same read as require_live_vault and read_core_asset.)

**`claim_charter_vault` — `pob_extra` accounts passed to the burn.** Never as signers. ✓

**`claim_charter_vault` — `check_attributes(&attributes, MAX_ATTRS - 2)` (6).** The program appends charter and later level. ✓

**`mint_vault` — `check_attributes(&attributes, MAX_ATTRS - 1)` (7).** Level appended later. ✓

**`check_attributes` — reserved keys (redemption, level, charter), duplicates, length, non-empty.** ✓

**`write_record` — `bytes <= MAX_ATTR_BYTES` (640).** Sum of 8 + key.len + value.len per attribute. ✓

Hmm — the Borsh size of a VaultAttribute is 4 (key len) + key + 4 (value len) + value = 8 + key + value. ✓ matches.

**Now — the reveal's attribute re-send:** `data.extend((attributes.len() + 1) as u32)` then each attr, then push_attr(level). So the reveal writes the minted attributes + level. The hash check is on the minted attributes (without level). ✓

**Now — a question about `reveal_level` and the collection account:** `require_keys_eq!(ctx.accounts.collection.key(), ctx.accounts.config.collection)`. And the UpdatePluginV1 CPI passes the collection. ✓

**Let me look at the `crank` function's error handling:** `match try_capture(...)?` — the `?` propagates errors from try_capture (e.g., BadSlotHashes). So a malformed SlotHashes sysvar refuses the whole host instruction. But the sysvar is pinned (accts[0].key() == slot_hashes::ID). The real sysvar is always well-formed. So no issue. But wait — `try_capture` calls `blockhash_in_window` which can return BadSlotHashes for a zero hash. On a real chain, slot hashes are never zero. OK.

Hmm — but `crank` is called from mint/claim/activate with caller-supplied accounts. `accts[0]` must be the SlotHashes sysvar (checked). The records are skipped if not writable/owned/loadable. But `try_capture(&accts[0], ...)?` — if the sysvar is real, no error. ✓

**`crank` — `require!(accts.len() - 1 <= MAX_CRANK, TooManyCranked)`.** K.4 tests 5. ✓

**Now — let me look at the `Capture` logic once more:**

```rust
if now <= reveal_slot { return NotYet; }
if now > reveal_slot + REVEAL_WINDOW_SLOTS { return Expired; }
```
So capture is possible in (reveal_slot, reveal_slot + 300]. The reveal_slot = mint_slot + 16. The three hashes: A in [reveal_slot, reveal_slot+64], B in [group(A)+8, +64], C in [group(B)+8, +64]. Worst case C: A at reveal_slot+64, B at group(A)+8+64 = (reveal_slot+64)/4*4 + 8 + 64... let me compute the worst span. A <= reveal_slot + 64. group(A) = A/4 (integer). want_B = (A/4 + 2)*4 <= A + 8 + 3 = A + 11 (rounding). Actually (A/4+2)*4 = A - A%4 + 8 <= A + 8. B <= want_B + 64 <= A + 72. want_C = (B/4+2)*4 <= B + 8. C <= want_C + 64 <= B + 72 <= A + 144 <= reveal_slot + 208. The comment says "C is at most ~3 x (8 + MAX_SKIPPED_SLOTS) past reveal_slot, inside the window" — 3 × 72 = 216. So C <= reveal_slot + ~208-216 < reveal_slot + 300. ✓ within the capture window.

And A must still be in the 512-slot SlotHashes buffer when captured: capture happens by reveal_slot + 300, A >= reveal_slot, so A is at most 300 slots old. ✓ within 512.

**Now — the host tests.** `the_lookup_takes_the_smallest_produced_slot_in_the_window`, `a_full_buffer_reads_and_malformed_ones_are_refused`, `capture_skips_at_a_b_and_c_and_matches_the_model`, `the_boost_ring_wraps_exactly_against_a_model`, `the_boost_schedule_through_the_programs_own_functions_across_four_wraps`. That's 5 named tests + Anchor's generated `test_id` = 6 (HOST_FLOOR=6). ✓ (measured fact 11 says HOST_FLOOR counts test_id.)

**Now — let me look at the `blank_config` in host tests:** `MintConfig::deserialize(&mut &zeros[8..])`. A zeroed MintConfig. version 0... deserialize doesn't check version. OK for tests.

**`the_boost_ring_wraps_exactly_against_a_model`:** 1000 iterations, buys 0-3 boosts, expires sometimes, advances epoch, checks boosts_due and ring sum == active. ✓

**`the_boost_schedule_through_the_programs_own_functions_across_four_wraps` (N1):** 260 epochs, joins, buys (copied scheduling lines), early retires, due retires/expiries, credit/tick, then a full model check per slot. Coverage assertions ensure the branches are hit. Strong. ✓

Hmm — one thing: the N1 test copies the scheduling lines from boost_vault ("those three lines are copied verbatim below"). If boost_vault's scheduling changed, the test wouldn't catch the drift (it uses its own copy). But the suite's BO.* arms test boost_vault end-to-end on chain. So the drift would be caught there. OK.

**Now let me think about R6's "what a wrong-but-accepted value would lock in FOREVER".**

The most dangerous accepted values:
- SEAL collection: checked by MINT/BURN/GOV (WiringDiverged/ForeignVault) at their initializes. So a wrong SEAL collection is caught before minting. But what if SEAL is initialized with collection X and MINT with collection X (both wrong, consistent)? Then everything works with the wrong collection. The launch checker pins the collection? Item 38 lists "the three reserve mints; pob_root from scripts/pob-set.json" — does it pin the CBOB collection? The collection is created at deploy time (a fresh keypair), so it can't be pinned in advance. Hmm. The collection's update authority must be MINT's PDA (checked). The collection is created by the deploy process. A wrong collection = a collection the deploy process created wrongly (e.g., with a plugin, or wrong authority) — MINT's initialize checks clean/ours/unminted. So the residual is: the deploy creates a valid-but-wrong collection (e.g., wrong name). Cosmetic. OK.

- MINT payment_mint: must be a SEAL reserve (checked). If SEAL's reserves are wrong (but classic SPL), and payment_mint is one of them... the launch checker pins the ruled three reserves and cbBTC payment mint. Item 38. ✓

- guardian: None accepted (no brake). Checker pins Gary. ✓

- swap_operator: any non-default. Checker pins the generated key. ✓

- bank_treasury: any non-default. Checker pins the Squads. A wrong treasury sends 15% to the wrong place forever. The checker is the only gate (item 38 notes the program checks less). ✓

- pob_root: any non-zero. A wrong root = no PoB proves = no charter claims = project can't start (no vaults, no votes, no rounds). The checker recomputes from pob-set.json. ✓

- charter window: closes > opens, <= 90 days, closes > now. A far-future opens (A2 in round 33, accepted as optional — the checker bounds it against lock_deadline). ✓

- level_caps: all > 0, sum <= max_supply. A wrong census is permanent. Checker pins 945/525/315/210/105. ✓

- monthly_secs: 60..2592000. Checker pins 2592000. ✓

- notice_secs: 60..2592000. Checker pins 604800. ✓

- sweep bounds: within absolute limits. Checker pins the ruled values. ✓

- max_boost_weight/epochs: within [1,12]/[1,63]. Checker pins 12/24. ✓

- cbob_mint: any initialized classic SPL mint that's not payment_mint or GARY. Checker pins GMm2yY2z. A wrong cbob_mint = boosts burn the wrong token. Checker is the gate. ✓

- BURN redeem_window_secs: 10..86400. Checker pins 3600. ✓

- GOV quorum/threshold/voting: within bounds. Checker pins 2100/5100/259200. ✓

So the checker (check-launch-params.mjs, 47 assertions) is the gate for the exact ruled values, and item 38 is OPEN AND BLOCKING on the two remaining OPEN values (charter_opens_at, lock_deadline). Consistent.

**Now — the one thing I should double-check: `initialize` can only run once per program (config is an init PDA).** ✓ (0.1i tests second initialize refused — the account exists.)

**Let me now scan for anything in the SWEEP helper's deployment story.** The helper has no initialize, no config, no key. It's deployed like the others and locked. build-mainnet proves byte-identity. ✓

**Now — let me look at the `Anchor.toml`:** only lists cbob_vaults under [programs.mainnet]. The other programs aren't listed. Does that matter? Anchor.toml's program list is used by `anchor deploy` etc., but the build/deploy here uses cargo-build-sbf and solana CLI directly. The suite doesn't use anchor deploy. So the incomplete list is harmless. Hmm — but is it a defect? It only affects anchor CLI workflows, which aren't used. Low.

**`Cargo.toml`:** overflow-checks = true, lto fat, codegen-units 1. ✓ (measured fact 6.)

**Now — let me look at the `tests/cpi-wrapper` once more.** PDASIGN!, PADTAIL!, SIGSPDA! modes. The SIGSPDA! mode: builds an Autograph update with n signatures from the wrapper's PDAs, the n-th signing. Used to grow the autograph. The wrapper is test-only, never deployed beyond the suite's validator. ✓

**Now — let me reconsider the round-33 verdict's "shared" items and whether they belong to this pass.** S1 (shipped bytes never run) and S2 (txread v1 lookup keys) are off-chain topics. The programs verdict left them to the off-chain pass. My bundle doesn't include the off-chain verdict, but the VALIDATION.md covers both passes' repairs. Nothing to do here.

**Now — let me hunt for any remaining subtle defect. Let me re-examine `claim`'s join path once more:**

```rust
if r.pending {
    require_keys_eq!(dest.key(), r.vault_ata, MintError::WrongVaultAccount);
    if ctx.accounts.config.dist_epoch > r.request_epoch {
        join(&mut ctx.accounts.config, &mut r)?;
        store_record(ri, &r)?;
        n_joined += 1;
    }
    continue;
}
```

Wait — `join` is called with `&mut ctx.accounts.config` and `&mut r`. But `ctx.accounts.config` was already borrowed... in Rust, within the loop, `ctx.accounts.config` is accessed mutably multiple times. The borrow checker handles this via reborrowing. Fine (it compiles).

**`join` requires `c.dist_epoch > r.request_epoch`.** ✓

**Now — a vault that is pending and its vault_ata account is closed before joining?** The join path checks dest == r.vault_ata but doesn't check the account exists (join doesn't pay). So a pending vault joins even if its ATA is gone. Then it's active, owed 0. Later claims pay into... the missing account → VaultAccountMissing → the whole batch refuses! Hmm. Wait — can a pending/active vault's ATA be closed? The ATA is owned by the asset-signer PDA. Only Core Execute (by the owner, while thawed inside a redemption) can close it. A redemption retires the vault. So a live, non-retired vault's ATA can't be closed. Unless... the owner closes it via Execute during a redemption that then FAILS? If the redemption fails, everything reverts (the close too). So no. ✓

Hmm, wait — actually, what about this: the owner does [open, Execute(close the ATA), burn]. The burn requires the reserve ATA declared and empty. The closed ATA: skipped (owner System / len 0). So the burn lands, the vault is retired. The ATA is closed. Fine — the vault is gone. ✓

What about [open, Execute(close ATA), ...no burn...]? SEAL's open refuses (no terminal burn). Reverts. ✓

**Now — the `activate` request records `vault_ata = want` (the derived ATA). What if the vault's cbBTC is in a NON-ATA account?** activate requires the canonical ATA with >= 21,000 sats. A non-ATA account doesn't count. The vault's owner would need to move cbBTC to the ATA. But the vault is sealed — the owner can't move tokens out, but anyone can send tokens TO the ATA. So the owner (or anyone) funds the ATA. ✓

**Now — `claim` pays into `r.vault_ata` (the recorded ATA). What if the vault later gets cbBTC in a different account?** Irrelevant — claims pay the recorded ATA. Redemption sweeps any account the page names. ✓

**Let me look at the `retire` function's `returned` value:** `returned = pending` (scaled). Emitted in VaultRetired as `returned_to_pool_sats: (returned / ACC_SCALE) as u64`. For a redeemed vault, pending < ACC_SCALE (or forfeited). For a bare burn, pending is the full unclaimed share. The event reports sats. ✓

**Now — `retire_burned` calls `retire(c, r, false, false)`.** redeemed=false → no ClaimBeforeBurn check, owed -= pending (returned to pool). bare_burns_retired += 1. ✓

**`retire` for a pending vault (not active):** skips the active block, then the pending block: pending_count -= 1, pending_this_epoch -= 1 if same epoch. retired = true. ✓ (F21 tests.)

**`retire` for a vault that is neither active nor pending (never activated):** both blocks skipped. retired = true. bare_burns_retired += 1 (if !redeemed). ✓

Hmm — a never-activated vault redeemed: retire_redeemed → retire(c, r, true, forfeit). r.active false → skip. r.pending false → skip. retired = true. owed unchanged. ✓

**Now — GOV's live supply vs MINT's:** GOV reads minted_total, burned_total (BURN), bare_burns_retired (MINT). live = minted - burned - bare. BURN reads the same for the cap. Consistent. ✓

**Now — a subtle one: BURN's cap uses `ctx.accounts.config.burned_total` (BURN's own count) but reads minted_total and bare_retired from MINT. burned_total is incremented AFTER the cap check. So the cap for THIS redemption uses live BEFORE this burn. ✓ (The vault being redeemed is still live for its own cap check.)**

**Now — the `rate_head` wrap:** `c.rate_head = ((head + 1) % RATE_RING) as u8`. head was `c.rate_head as usize % RATE_RING`. So rate_head stays in 0..63. ✓

**Let me look at the `Initialize` for BURN:** `rate_ring = [0; RATE_RING]`, rate_head = 0. ✓

**Now — potential issue: two redemptions in the same transaction (cap >= 2).** Each burn_vault checks the cap independently. First burn: kth check passes, writes now to ring[head], head++. Second burn: reads the updated ring. kth most recent now includes the first burn's timestamp. If cap >= 2, the 2nd most recent must be a window old. The first burn's timestamp is `now` (same slot), so the 2nd most recent is... the one before it. If the window was empty, that's 0 → passes. So two land (S9b). ✓. At cap 1: second burn's kth (1st most recent) = first burn's now → now - now = 0 < window → RateLimited (4.9). ✓

**Now — `burn_vault` and `open_for_redemption` both check the asset's owner == signer. What if the asset was transferred between open and burn?** Within one transaction: open (owner signs, thaws), then a Core Transfer of the asset to someone else, then burn (owner signs). BURN checks `asset_owner == ctx.accounts.owner.key()` — reads the CURRENT owner from the asset data. If the asset was transferred mid-transaction, the current owner is the new owner, not the signer → NotTheOwner. Refused. ✓. And SEAL's open would... the transfer after the open: Core's TransferV1 on a thawed asset — allowed if the owner signs. But then the burn fails (owner changed). Whole transaction reverts. ✓

**What about a freeze between open and burn?** The owner could re-freeze via... the PermanentFreezeExecute authority is SEAL's PDA; only SEAL's open can change it, and open only sets frozen=false. There's no re-freeze instruction in SEAL. So within a transaction, once thawed, it stays thawed until the burn (or revert). ✓

Hmm wait — actually, can the owner re-freeze via Core directly? The plugin authority is SEAL's PDA, not the owner. So no. ✓

**Now — the `Execute` between open and burn:** Core's ExecuteV1 requires the owner's signature and (for a frozen asset) the plugin's approval. After SEAL's open (thawed), Execute is permitted for the owner. The owner runs the sweep helper (or any instructions). ✓

**Could the owner Execute something OTHER than the sweep helper that leaves value, then burn?** BURN's emptiness proof catches declared value. Undeclared value is destroyed (accepted). The owner can also Execute a transfer of the asset itself? No — Execute runs instructions signed by the PDA, not transfer the asset. The asset transfer is a separate Core instruction. ✓

**Now — let me look at the `declare` helper in the suite:** both ATA derivations (classic + T22) for each reserve mint. For 3 reserves: 6 accounts. ✓ matches BURN's requirement.

**Now — the sim's `declare`:** same. ✓

**Let me now step back and think about what a fresh reader might find that 33 rounds missed. Let me look at the least-audited code paths.**

The newest code is the round-33 suite arms (R33.G1-G4) and the off-chain repairs (not bundled). The programs haven't changed since round 32 (per the verdict: "programs/ and the workspace manifests are unchanged since c5aab17"). So the programs are heavily audited. The suite changed (new arms).

Let me scrutinize the new arms for false-pass risk:

**R33.G1:** `rec('R33.G1', ..., 'true,10198', worstShape ? `${await lv(worstShape)},${(await ag(worstShape))?.[0]?.message?.length ?? 0}` : 'no vault')`. lv checks level 1-5. ag checks the autograph message length. If worstShape is null (the kAt mint failed), got = 'no vault' ≠ want → red. ✓ can fail.

But wait — the want is 'true,10198'. lv returns true/false. ag returns the message length. So got = "true,10198" on success. ✓

**R33.G2a:** want 'true,heap,true'. got = `${kept>=20},${heap?'heap':'other'},${now===kept}`. ✓

**R33.G2b:** want `true,${crowdShape?.n}`. got = `${await lv(crowdShape.asset)},${(await ag(crowdShape.asset))?.length ?? 0}`. So it checks the vault was revealed AND the autograph has exactly `kept` signatures. ✓

**R33.G3:** want 'REJECT-0x1b,ALLOW'. The redel function returns 'REJECT-0x1b' if the error matches 0x1b/CannotRedelegate, 'REJECT-other' otherwise, 'ALLOW' if it lands. ✓

**R33.G4:** want `ALLOW,7,true,closed,true`. Checks the close landed, 7 instructions, pre-filled >= 0.5 SOL, account closed, operator gained the lamports. ✓

These look real.

**Now — one thing to verify: the suite's floor count.** Round 33 added 5 arms (G1, G2a, G2b, G3, G4) → 861 + 5 = 866. ✓

**Let me check the `R28.A1` arm (round 32's, which round 33 said only partly discharged round 31's W1):** it writes the 10,198-byte autograph on C1 (one charter attribute, short name/URI). Round 33's gate-5 obligation 1 said the FULL worst shape (640-byte list, 64/200 name/URI, five plugins, 10,198 autograph) is not pinned. Round 33's repair: R33.G1 uses the kAt vault (640-byte `exact()` list) + 10,198 autograph, revealed by MINT. But does kAt have the five owner plugins and 64/200 name/URI? Looking at the setup: kAt is minted via v0 with `exact()` attributes (640 bytes), name 'CBOBTC Vault' (12 chars), uri 'https://cdn.gary.club/cbob/v.json' (31 chars). NOT 64/200. And no five owner plugins. So R33.G1 covers the 640-byte list + 10,198 autograph, but NOT the 64/200 name/URI or the five plugins. Round 33's W1(a) measurement had all of those at 47,971 CU — far under 200,000. The suite's R33.G1 covers the essential size (the attribute list is what MINT re-sends; the name/URI are fixed at creation and don't affect the reveal's data; the plugins affect Core's heap, which R28.A1/R26.P6 cover on C1 with five plugins + 10,198 autograph). So between R28.A1 (five plugins + autograph on C1) and R33.G1 (640-byte list + autograph on kAt), the coverage is reasonable. The verdict's obligation said "the full worst shape ... is not pinned" — the repair pins the two hard dimensions separately rather than combined. Given the measured CU is ~48k (24% of budget), the combination is not at risk of exceeding. I'll note this as a residual gap in the pin, but it's marginal — the two dimensions are independently pinned and the measured cost is far from the bound. Actually, let me reconsider — is this worth a finding? The gate-5 obligation was to pin the measured refutation. The repair pins the reveal with the 640-byte list + max autograph (the two things that make the reveal's DATA large) and separately the reveal with five plugins + max autograph (the thing that makes Core's HEAP tight). The combination would be data-large AND heap-tight. But the reveal's CPI data size is bounded by the attribute list (640 bytes + level), independent of plugins. And the heap usage is dominated by the autograph + plugins, independent of the attribute list size (the list is passed as instruction data, deserialized into the heap — hmm, actually the attribute list IS deserialized into Core's heap during UpdatePluginV1). So the combination could matter: 640-byte list deserialized + 10,198 autograph + 5 plugins in one 32 KiB heap. Round 33 measured exactly that combination at 47,971 CU and it landed. The suite doesn't pin the combination. But R33.G1 pins 640-list + autograph (no plugins), and R28.A1 pins autograph + 5 plugins (1-attribute list). The measured combination landed with huge margin. Is the pin sufficient? For certification purposes, the refutation was measured (round 33) and the two dimensions are pinned. I'd call this a LOW residual: the exact combined shape isn't in the suite, but both dimensions are, and the measured margin is 4x. Actually — hold on. Let me re-read the round-33 verdict's gate-5 obligation 1: "the full worst shape (640-byte stored list via exact(), 64/200 name and URI, five owner plugins, 10,198 autograph, then reveal_level) is not pinned. Round 32's 'pin round 31's W1 maximum shape' is therefore only partly discharged." And the VALIDATION.md repair says: "R33.G1: the vault with the whole 640-byte attribute budget is given a 10,198-byte owner autograph and must be revealed by MINT in FIFO order at the default compute budget." So the repair deliberately pins the 640-byte budget + autograph, not the full combination. The verdict's remaining requirements say "Gate 5 is unmet: pin the three measured refutations above" — and the repair pins them as described. Whether the repair fully satisfies the obligation is a judgment: the name/URI length and the plugin count are the omitted dimensions. Name/URI don't affect the reveal (they're set at creation, not re-sent). The plugins affect heap. Hmm. I think this is defensible but worth noting as a LOW: the suite pins the two material dimensions separately, not the combined worst shape that was measured. Given the measured margin (48k vs 200k), the risk is low.

Actually, wait. Let me reconsider whether the reveal even re-sends through the same heap-constrained path. The reveal is MINT's UpdatePluginV1 CPI. Core processes it in its 32 KiB heap. The asset already HAS the autograph + plugins (stored on-chain, loaded into the heap when Core deserializes the asset). Adding the attribute list update: Core deserializes the asset (with autograph + plugins) AND the new attribute list. So the heap holds the asset's current state + the update. The 640-byte list adds to that. Round 33 measured the combination lands. The suite's R33.G1 has the 640 list + autograph (heap: asset with autograph + 640 list update). R28.A1 has 1-attr list + autograph + 5 plugins (heap: asset with autograph + 5 plugins + tiny update). The combination (autograph + 5 plugins + 640 list) is what's not pinned. The marginal heap cost of the 640 list vs the 1-attr list is ~600 bytes of deserialized data. The marginal cost of the 5 plugins vs 0 is the plugin registry deserialization. Both were measured together at 47,971 CU. I'm fairly confident the combination is safe (measured), so the pin gap is a LOW at most. Let me note it.

Hmm, actually — I want to be careful here. Round 33's verdict explicitly listed this as gate-5 obligation 1, and the repair was supposed to address it. If the repair deliberately pins a slightly weaker shape, that's a judgment call the project made. As an auditor, I should note whether the pin matches the measurement. It doesn't exactly (missing 64/200 name/URI and the five plugins in the same vault). But the two omitted dimensions are independently covered. I'll file it as LOW with the precise gap.

**Now — let me look for anything else. Let me re-examine the `monthly_inline` call in `claim_charter_vault`:**

```rust
let (extra, crank_accts) = ctx.remaining_accounts.split_at(n_extra);
{ ... monthly_inline(...)?; }
```
monthly_inline is called AFTER the split. The pool_token is a fixed account (POOLK). ✓

**`claim_charter_vault` — `require!(n_extra <= MAX_POB_EXTRA && n_extra <= ctx.remaining_accounts.len(), BadPobExtra)`.** ✓ (OR.3 tests over-claiming.)

**Now — the crank accounts after the extras:** `crank(crank_accts, slot)?` at the end. crank_accts[0] must be SlotHashes. ✓

**Now — let me look at `mint_vault`'s crank:** `crank(ctx.remaining_accounts, slot)?`. remaining_accounts = [SlotHashes, records...]. ✓

**`activate`'s crank:** `crank(ctx.remaining_accounts, ...)` — same. ✓

**`claim`'s crank:** `crank(&rem[..k], ...)` where k = crank_n + 1 (if crank_n > 0). So rem[0] = SlotHashes, rem[1..k] = records. ✓

Hmm — `claim` with crank_n = 0: k = 0, `crank(&rem[..0], ...)` = crank(&[]) → returns Ok immediately (accts.is_empty()). ✓

**`claim` — `require!(rem.len() >= k, BadClaimList)`.** If crank_n = 4 but only 3 accounts → refused. ✓

**Now — a look at the `Distribute` accounts:** config (mut, seeds), pool_token (unchecked, verified in-handler). remaining_accounts for the burn path. ✓

**`ExpireBoosts` accounts:** config (mut, seeds). remaining = records. ✓

**`BoostVault` accounts:** config, vault_record (seeds), asset, burner (signer), burner_token (mut), cbob_mint (mut), token_program (address-pinned), pool_token. ✓

Hmm — cbob_mint is `#[account(mut)]` because the burn reduces its supply. ✓

**`BoostVault` — `require_keys_eq!(*ctx.accounts.cbob_mint.owner, SPL_TOKEN_ID, WrongCbobMint)`.** ✓

**Now — the SPL Burn CPI in boost_vault:** `invoke` (not signed) with burner as the authority (signer). The burner signs the top-level transaction. ✓

**`distribute`'s burn:** same pattern, burner signs. ✓

**Now — let me reconsider the `read_token` in MINT:** checks owner == SPL_TOKEN_ID, len == 165, mint, owner. Returns (amount, state). ✓

**`read_token` doesn't check the account is not frozen for the ACTIVATION balance read.** activate reads (amount, _) — ignores state. A frozen account with >= 21,000 sats can activate. Is that OK? A frozen vault account: the vault can activate, but claims into it are deferred (frozen). And redemption is blocked (frozen source). Accepted limit 28. The alarm pages vault_account_frozen. So activating with a frozen account is allowed but the vault can't be paid or redeemed until thawed. Not a defect — the owner funded it frozen (or Coinbase froze it after funding). ✓

**`boost_vault`'s `read_token` on burner_token:** checks state == INITIALIZED (not frozen). A frozen $CBOB account can't be burned from. ✓ ($CBOB has no freeze authority anyway.)

**`distribute`'s `read_token` on the $GARY account:** checks state == INITIALIZED. ✓

**Now — let me look at the `Initialize` struct for MINT:** config (init, seeds CONFIG_SEED), authority (mut, signer), collection (mut), mint_authority (seeds MINT_SEED), mpl_core (address), system_program, seal_config, cbob_mint. ✓

**`Initialize` for SEAL:** config (init, seeds "config"), authority, system_program. remaining_accounts = reserve mints. ✓

**`Initialize` for BURN:** config (init, seeds "burn-config"), authority, system_program, seal_config. ✓

**`Initialize` for GOV:** config (init, seeds "gov-config"), authority, system_program, mint_config. ✓

**Now — the space allocations:** all verified above. The init allocates EXACTLY the struct size + padding. ✓

**Now — let me think about whether there's a way to steal from the pool via a fake vault record.** load_record checks owner == crate::ID and version == 4 and deserializes. A fake record can't exist (records are init PDAs created by mint/claim_charter). The seeds are checked in the fixed accounts (vault_record seeds = [VAULT_SEED, asset]). In claim/expire_boosts, the records are remaining_accounts — load_record checks owner and version but NOT the PDA derivation! Hmm. So a claim could name ANY VaultRecord account (owned by MINT, version 4) as a pair. But every VaultRecord is a real vault's record (created only by mint/claim_charter with seeds [VAULT_SEED, asset]). There's no way to create a VaultRecord with arbitrary contents. So naming a record just pays that vault's share to its recorded ATA. No theft. ✓

But wait — could someone create a VaultRecord-like account with the right discriminator and version, owned by MINT, at a non-PDA address? Only MINT can create accounts it owns (via init in mint/claim_charter, which sets the seeds constraint). There's no other instruction that creates accounts. So no fake records. ✓

**Similarly `expire_boosts`:** only real records. ✓

**Now — `claim`'s dest check:** `require_keys_eq!(dest.key(), r.vault_ata)`. The dest is the recorded ATA. So even naming another vault's record pays ITS recorded ATA. No redirection. ✓

**Now — let me look at the `Governed` struct:** config (mut, seeds, bump, has_one governance), governance (signer). The bump is `config.bump`. ✓

**`ApplySwapOperator` / `ApplyGuardian` (uses ApplySwapOperator struct):** config (mut, seeds, bump). No signer — permissionless. ✓

**`Guardian` struct:** config (mut, seeds, bump), guardian (signer). require_guardian checks guardian.key() == c.guardian and c.guardian != default. ✓

**Now — let me look at the events.** Each state change emits an event and/or a msg! line. The alarm greps the msg! lines (CBOB_*). ✓

**Now — let me reconsider the round-33 verdict's A15 acceptance once more, and the multi-vault redemption shape.** I verified single-vault is safe. The two-vault shape doesn't fit legacy anyway (S9b used v0 with a lookup table for two). With v0 + LUT, two redemptions fit. So the A15 shape IS reachable via v0! Let me re-examine.

A15: [claim (joins W), open A, sweep A, burn A, open W, sweep W, burn W] in one v0 transaction. The claim joins W (the last waiting vault). Burn A retires A, then its trailing monthly_inline runs: if due and no one waiting (W was joined), it credits W (and others). Now W is owed >= 1 sat (if the credit gives W a whole sat). Burn W's retire_redeemed: pending >= ACC_SCALE → ClaimBeforeBurn → the WHOLE transaction reverts.

So a v0 transaction redeeming A and W together, with a claim that joins W, while the month is due, reverts. The fix: claim W's share first (add W to the claim's pairs after joining... but the claim joins W and pays nothing at join; the credit happens in burn A's trailing run, after the claim). So the client would need to either not join W in the same transaction, or claim W after burn A. This is a real footgun for a multi-redemption v0 client. Round 33 classified it as "a reverted, retryable self-grief in a shape the client contract does not use (two helper redemptions do not fit one legacy packet; SPEC 50 measures one). Single-vault redemptions are safe." 

But S9b PROVES two redemptions fit one v0 transaction with a lookup table. So the shape IS usable. Is A15 worse than round 33 thought? The revert is retryable (just claim W first in a prior transaction, or don't join W in this one). No value is lost (the whole transaction reverts, nothing moves). So it's a liveness footgun, not a loss. And it requires: the month due, W the last waiting vault, the client joining W in the same transaction as two redemptions one of which is W's. A careful client (item 50's contract) claims before sweeping. The scenario is contrived. I'll keep it at LOW/INFO, consistent with round 33's A15. Actually — the prompt says "Do not re-file an old claim merely because the prior verdict contains it; show a surviving defect." A15 is in the prior verdict as accepted. Re-filing it would need it to be worse. It's not worse (revert, retryable, no loss). Skip.

**Now — let me look at something the prompt specifically asks: R1s(e) "is there any account a stranger can create for the vault that neither the sweep can name nor BURN will skip (a Token-2022 ATA for a classic mint, a non-ATA token account, a nested Core asset)?"**

- Token-2022 ATA for a classic mint: can't be created (F4.2). ✓
- Non-ATA token account (classic): the sweep CAN name it (any classic 165-byte account owned by the PDA). BURN's second loop checks it if declared. So it's coverable. ✓
- Token-2022 non-ATA account for a classic mint: can a stranger create a T22 token account (not ATA) with mint = classic mint? The T22 program's InitializeAccount requires the mint to be owned by the T22 program. A classic mint is owned by classic Token. So T22 InitializeAccount refuses. So no T22 account for a classic mint can exist. ✓
- Token-2022 account for a T22 mint: the reserve mints are classic, so irrelevant. But a stranger could create a T22 token account for some T22 mint owned by the PDA. The sweep can't name it (read_token requires classic owner and len 165; a T22 account is owned by T22 program → IllegalOwner). BURN's second loop: if declared, `d.len() == TOKEN_ACCOUNT_LEN` required → T22 accounts are 170+ → ReserveHasExtensions. If undeclared: destroyed (accepted limit 44). So a T22 account blocks the redemption if declared, is destroyed if not. The page's judgeRedemptionCoverage warns. Accepted. ✓
- A nested Core asset: sweep can't move it; BURN refuses if declared (VaultStillHoldsAVault), destroys if not. Accepted. ✓

So the answer: no NEW class. The known classes are covered or accepted.

**Now — R1s(d) revisited: "Can anything leave the asset-signer non-zero afterwards inside the same transaction (a later instruction depositing, Core itself), and does BURN's lamports == 0 check still see exactly what the sweep left?"**

Within the redemption transaction, after the helper's Execute, the instructions are: burn_vault. burn_vault first does its checks (including lamports == 0), then Core BurnV1, then retire CPI. Does Core BurnV1 credit the PDA? Measured fact 4: BurnV1 does NOT sweep the PDA's lamports. Does it CREDIT the PDA anything? The burn returns the asset's rent to the payer (not the PDA). So the PDA stays 0. ✓. And no later instruction deposits (the transaction is fixed). ✓

But wait — what about the Execute itself? Core's ExecuteV1 — does it charge rent or fees to the PDA? The PDA is a system account with 0 data. Execute doesn't modify its lamports (except what the inner instructions do). The helper empties it. After Execute returns, Core doesn't touch it. ✓ (SR.4/S8 redemptions land with lamports == 0.)

**Now — R1s(c): "Does the lamport transfer to a destination below rent-exemption, or to a non-system account, fail in a way that blocks redemption?"**

- To a destination below rent-exemption: if the destination EXISTS (has lamports already), a transfer that keeps it... any account with lamports > 0 must be rent-exempt at transaction end? No — the rule is that an account's balance can't go below rent-exempt if it's > 0, only for DEBITS from... actually the rent rule: after each instruction, any account with lamports > 0 and lamports < rent_exempt_minimum causes the transaction to fail? No — the rule is: an account may not be left with 0 < lamports < rent_exempt_min after an instruction, UNLESS it was already in that state? Hmm. Actually the Solana rule is: credits can bring an account from 0 to any amount, but if the resulting balance is 0 < balance < rent_exempt, the transaction fails ("insufficient funds for rent"). For an account that already exists with lamports >= rent_exempt, adding more is fine. For an account with 0 (doesn't exist), a credit below rent_exempt fails. SPEC item 50 says exactly this: "a credit below rent exemption to an account that does not exist yet is refused. The canonical destination is the owner, who pays the fee and so exists." So the page names the owner (exists, pays fee). ✓. To a non-system account (token account): R27.S1 measured it lands (the token account's lamports increase; its data unchanged). ✓

**Now — let me look at the `system_instruction::transfer` in the helper:** `invoke(&system_instruction::transfer(signer.key, dest.key, lamports), &[signer.clone(), dest.clone(), system.clone()])`. The signer is the PDA (signed via Core). ✓

**Now — one more sweep helper edge: what if `lamports == 0`?** Skipped (no transfer). Then BURN sees 0. ✓ (SR.13 has lamports > 0; a 0-lamport wallet also works — nothing to sweep.)

Hmm wait — can the asset-signer PDA have 0 lamports? It's a system account (PDA, no data). If it has 0 lamports, it... doesn't exist? A 0-lamport account is purged. But the PDA is derived; Core's Execute re-resolves it. Actually the asset-signer PDA might hold rent from being used as a signer? No — PDAs with no data need no rent. If it has 0 lamports it's just absent, and a transfer FROM it of 0 is skipped. BURN's check: `ctx.accounts.asset_signer.lamports() == 0` — 0 passes. ✓

**Now — let me look at the `asset_signer` account in BurnVault:** `#[account(mut, seeds = [EXECUTE_PREFIX, vault_asset.key().as_ref()], bump, seeds::program = MPL_CORE_ID)]`. So BURN verifies the PDA derivation. ✓

**Now — let me reconsider the pairing once more for a subtle gap: SEAL's walk starts at `current + 1`. What if the open is the LAST instruction?** Then no burn follows → not found → refused. ✓

**What if there are multiple burns and the FIRST one matches but a LATER one also matches?** `found = true; break` at the first match. Fine. ✓

**What if the burn matches asset and owner but is for a different COLLECTION?** BURN checks the asset's collection == config.collection. The asset's collection is read from the asset data. SEAL also checks. Same collection. ✓

**Now — a really subtle one: SEAL checks `ix.accounts.get(BURN_IX_OWNER_IDX) == Some(owner)` where owner is the SIGNER of the open. BURN checks the asset's owner == its signer. Suppose the asset's owner is alice, and the transaction has open(alice signs) and burn(alice signs). SEAL binds burn's account 2 == alice. BURN's account 2 is its owner signer = alice. BURN checks asset owner == alice. ✓. Now suppose open(alice) and burn(bob). SEAL: burn's account 2 (bob) != alice → not found → refused. ✓ (3.10 tests.)**

**Now — what if the same instruction appears to match but with the asset at a different position?** The discriminator is checked, and accounts[0] and [2]. A burn_vault instruction always has asset at 0 and owner at 2 (Anchor account order). ✓

**OK. Now let me look at the off-chain `bank/layout.mjs` indirectly — it's not bundled, but the suite's X.* arms test it against the live programs.** X.1-X.7. ✓

**Now — let me look at the `scripts/check-launch-params.mjs` indirectly — not bundled, but run-tests.sh runs its selftest (47 assertions).** Can't audit its content here. The launch JSON is bundled and consistent with the ruled values. ✓

**Now — let me double-check `launch/mainnet-init.json` against the programs' bounds:**
- max_supply 2100 ✓
- level_caps 945/525/315/210/105, sum 2100 = max_supply ✓ (cap_total <= max_supply ✓)
- monthly_secs 2592000 = MONTHLY_SECS ✓ (in [60, 2592000])
- notice_secs 604800 = NOTICE_SECS ✓ (in [60, 2592000])
- redeem_window_secs 3600 ✓ (in [10, 86400])
- min_voting_secs 259200 ✓ (in [60, 2592000])
- quorum_bps 2100 ✓ (in [500, 10000])
- threshold_bps 5100 ✓ (in (5000, 7500])
- sweep_floor_lamports 1e9 ✓ (>= MIN_SWEEP_FLOOR_LAMPORTS 1e8, <= max_sweep 1e10)
- cooldown_ceiling_secs 86400 ✓ (>= sweep_cooldown 21600, <= MAX_SWEEP_COOLDOWN_SECS 604800)
- reserve_ceiling_lamports 1e8 ✓ (>= sol_reserve 5e7, >= RENT_EXEMPT_0_BYTES 890880, <= MAX_RESERVE_CEILING 1e10)
- sol_reserve_lamports 5e7 ✓ (>= RENT_EXEMPT_0_BYTES)
- max_sweep_lamports 1e10 ✓ (>= MIN_INIT_SWEEP 1e9, <= MAX_SWEEP 5e10)
- sweep_cooldown_secs 21600 ✓ (in [1, 86400])
- charter_secs 604800 ✓ (<= MAX_CHARTER_SECS 90 days)
- max_boost_weight 12 ✓ (in [1,12])
- max_boost_epochs 24 ✓ (in [1,63])
- cbob_mint GMm2yY2z... — must be an initialized classic SPL mint, not payment_mint, not GARY. ✓ (created on mainnet.)
- pob_root matches pob-set.json root ✓ (522ac90e...)
- pob_collection F9TDm35J... matches pob-set.json collection ✓
- reserve_mints: cbBTC, GARY, GIRAFFISH ✓
- payment_mint cbBTC ✓ (is a reserve ✓)
- bank_treasury bc92Z... (the Squads) ✓
- guardian = init_authority = Hc6WGt... ✓
- swap_operator bipP7uK5... ✓
- charter_opens_at: null (OPEN) — item 38. ✓
- lock_deadline: null (OPEN) — item 38. ✓

All consistent with the programs' bounds. ✓

**Now — one thing to verify: `charter_secs` 604800 is 7 days. The initialize takes charter_opens_at and charter_closes_at (not charter_secs). The closes = opens + 604800. The checker presumably verifies. ✓**

**Now — let me look at the `scripts/pob-set.json`:** 240 assets, editions 1..240, root 522ac90e.... The probe re-verifies. ✓

**Now — let me look at the `scripts/pob-merkle.mjs` selftest:** sizes 1,2,3,7,8,240; every leaf proves; outsider doesn't; 240-proof <= 8; leaf != node of same bytes. 14 assertions (6 sizes × 2 + 1 + 1 = 14). ✓ POB_FLOOR=14.

**Now — let me think about the `Anchor.toml` [programs.mainnet] listing only cbob_vaults.** Actually — wait, this could matter for `anchor build`/`anchor deploy` workflows, but the project uses cargo-build-sbf directly. And `anchor test` script is defined but not used (run-tests.sh uses npx tsx). So harmless. But it IS a slight inconsistency: the other four programs aren't declared. Not a security issue.

**Now — let me look at the `tests/expiry-budget.mjs` once more for a subtle issue.** It builds a MintConfig via `L.encode('MintConfig', cfg)` from bank/layout.mjs. The config has dist_epoch 1, and 20 records with boost_end_epoch 1. So all 20 are due (dist_epoch >= end). The expire_boosts instruction: keys = [cfgAddr, ...records], data = expire_boosts disc. It runs at default (200k) and raised (800k) CU. Asserts 20 CBOB_BOOST_EXPIRED logs, counters conserve. Then a landed transaction at default. Then checks the on-chain state.

Wait — the config's `boosts_due: 20` and `boost_expiring` — the defaults set boost_expiring to... `t.startsWith('[u32;') ? Array(t === '[u32; 5]' ? 5 : 64).fill(0)`. So boost_expiring is [u32; 64] filled with 0. But the 20 boosts are DUE (end_epoch 1 <= dist_epoch 1), so they're counted in boosts_due (20), not the ring. expire_boost calls unschedule_boost: `if c.dist_epoch >= r.boost_end_epoch { c.boosts_due -= 1 }`. So boosts_due 20 → 0. ✓. And boosts_active 20 → 0. boost_weight_total 240 → 0. total_active_weight 280 → 40. ✓ matches the assertion.

Hmm — but wait: `boosts_due: 20` in the synthetic config, and the ring is all zeros. Is that consistent? The 20 boosts have end_epoch 1 = dist_epoch 1. When the epoch advanced to 1, the ring slot 1 % 64 = 1 would have been drained into boosts_due. So ring all zeros + boosts_due 20 is consistent (they became due at epoch 1). ✓

**Now — the `expire_boosts` instruction in the test doesn't check `boosts_due == 0` first (there's no such gate on expire_boosts — the gate is on distribute).** ✓

**Now — let me look at the `sim/run-sim.sh`:** SIM_FLOOR=71. It rebuilds the localnet build, deploys all five, runs test-vault.ts. ✓

**Now — let me reconsider the round-33 verdict's claim about the suite floor and the new arms once more.** The verdict says round 32 was 861. The repair added 5 → 866. run-tests.sh comment confirms "ROUND 33 ... : 861 -> 866." ✓

**Now — let me look for any issue with the `R33.G4` arm's use of `bank/swap.mjs`.** It imports SW.swapInstructions and SW.WSOL/CBBTC/ORCA via a node child. The child runs with cwd /opt/cbob-vaults. If bank/swap.mjs's interface changed (e.g., swapInstructions signature), the child would throw and the arm would fail (red). So the arm pins the swap's interface. ✓ (bank/swap.mjs is not bundled, so I can't verify the interface, but the arm would fail if it drifted.)

**Now — let me think about whether the suite's `R33.G4` actually tests what it claims.** It builds the swap's instruction list for lamportsIn = 0.1 SOL, filters out the venue (Orca) instruction and any instruction touching the cbBTC account, and runs the rest: compute limit, wSOL ATA create (idempotent), transfer 0.1 SOL to wSOL account, SyncNative, close wSOL account. Against a stranger's pre-created, pre-filled (0.5 SOL) wSOL account. The close sends everything (0.5 + 0.1 SOL + rent) to the operator. Asserts closed and operator gained >= preWsol - 20,000. 

Hmm — wait. The wSOL account was pre-created by the STRANGER (idempotent create is a no-op then). The transfer adds 0.1 SOL. SyncNative syncs the amount. The close sends all lamports to the operator. So the operator gains 0.5 (stranger's) + 0.1 (own) + rent. The assertion `postOp - preOp >= preWsol - 20_000` where preWsol >= 500,000,000. So operator gains >= ~0.5 SOL. ✓. The point: a pre-filled wSOL account doesn't break the swap's wrap-and-close. ✓

But — is there a subtle issue: the idempotent create when the account exists and is pre-filled? createAssociatedTokenAccountIdempotentInstruction on an existing account is a no-op (returns early). ✓. And the account's owner is the operator (the stranger created it FOR the operator via the ATA derivation). ✓

**Now — let me look at the `R31.W2a/W2b` arms (round 32's, pre-funded PDAs).** W2a: SEAL config PDA pre-funded with 1M lamports, initialize still lands (Anchor init takes a funded address). W2b: vault record PDA and reserve ATA address pre-funded, mint and non-idempotent create land. These prove pre-funding can't squat. ✓

Hmm — wait, W2b: the reserve ATA address pre-funded with lamports (system account). Then `createAssociatedTokenAccountInstruction` (non-idempotent) — does it succeed on a funded system account? The ATA program's create: it creates the account via CPI (system create_account with the ATA address as a PDA — signed by the ATA program's seeds). If the address already holds lamports (system-owned, 0 data), the ATA program's create_account... The ATA program uses `system_instruction::create_account` signed with the PDA seeds. The system program's create_account requires the account to have 0 lamports? No — create_account fails if the account already has lamports ("account already in use")? Actually, system create_account requires the destination to be... it transfers lamports and allocates. If the account already has lamports, create_account fails? Hmm. The ATA program handles this: it checks if the account exists (lamports > 0) and if so does allocate + assign + initialize instead of create_account. Yes — the ATA program's `create` instruction: if the account is empty (0 lamports), it does create_account; if it has lamports but is system-owned with 0 data, it does allocate/assign. So a pre-funded ATA address works. W2b measures this. ✓

And Anchor's `init` (for the vault record): Anchor's init also handles pre-funded accounts (it does the same allocate/assign dance via `create_account` which... actually Anchor's init uses `system_instruction::create_account` signed by the PDA seeds, and for a pre-funded account it does transfer + allocate + assign). Round 32 measured it lands. ✓

**Now — let me look at the `R27.C1/C2` arms (program-owned PoB claims through CPI).** A PoB owned by the wrapper's PDA claims via signedOwnerIx (PDASIGN! mode). The wrapper signs as the owner PDA. MINT's claim_charter_vault requires the owner to sign — the PDA "signs" via invoke_signed. So a program-owned PoB CAN claim. And the vault is owned by the off-curve PDA. Then `returnFromPda` transfers it back to alice. So the suite proves a program-owned PoB can claim (the owner signature works via CPI). But then the vault is owned by an off-curve PDA → can't be redeemed (limit 43). The suite transfers it back. Hmm — this is the "off-curve owner can mint but not redeem" gap. The alarm reports unredeemable_owner. Accepted limit 43. ✓

Wait — but this means a program-owned PoB can claim a charter vault, and the resulting vault is unredeemable. Is that a defect? The claim requires the PoB's owner to sign (via CPI). A program that holds a PoB can claim. The vault ends up owned by the program's PDA. If the program can't do top-level signatures, the vault is bricked (its contents locked forever). But the program chose to claim. And the vault can be transferred back (returnFromPda) if the program supports that. So it's recoverable if the program cooperates. Accepted limit 43 (the alarm pages). ✓

**Now — `R27.V1` (program-owned vault votes through CPI).** Same pattern. A program-owned vault can vote (the owner signature via CPI). ✓ — voting doesn't need top-level signatures, just the owner to sign the instruction (CPI signer works). So program-owned vaults can vote but not redeem. Consistent.

**Now — let me look at the `signedOwnerIx` helper:** wraps an instruction with PDASIGN!, replacing the CPI_OWNER's signer flag with false (the wrapper makes it a signer via invoke_signed). ✓

**Now — let me reconsider the `ixClaim` in the suite for the CPI case:** `ixClaim(cpiKp.publicKey, CPI_OWNER, alice.publicKey, POB[1], pobProofFor(1))` — owner = CPI_OWNER (the wrapper's PDA), payer = alice. The owner key is marked isSigner in ixClaim's keys (`{pubkey:owner,isSigner:true,...}`). signedOwnerIx maps it to isSigner:false (the wrapper signs). ✓

**Now — let me look at the `returnFromPda`:** builds a Core transfer of the asset from CPI_OWNER to a destination, authority = noop signer (CPI_OWNER), wrapped with signedOwnerIx. ✓

**Now — let me think about the `ORACLE_OK`/`ORACLE_NO` fixtures.** Genesis accounts with OracleValidation::V1 bytes [1,2,2,burn,2] (create=2 Pass, transfer=2 Pass, burn=0 Approved or 1 Rejected, update=2 Pass). The OR section tests the pass-through. ✓

**Now — let me look at the `addOracle`/`dropOracle`:** addCollectionPlugin with Oracle type, lifecycleChecks burn CAN_REJECT, resultsOffset NoOffset. The oracle account's bytes decide. ✓

**OR.5: a second oracle that REJECTS — the claim with both extras is refused by Core.** ✓ (the ruled limit; the alarm covers a hostile hook.)

**Now — let me look at the `R24.1/1a/1b/1c` arms (owner can't add Oracle/AgentIdentity; update authority can add Oracle but not AgentIdentity).** These pin Core's external-plugin rules. ✓

**Now — let me look at the `R26.P1-P7` arms (owner-managed plugins don't veto the reveal; owner freezes thaw).** ✓

**Now — let me look at the `R28.A2/A3/A4` arms (Core can't shrink the large-autograph vault; transfer and redemption simulate OK).** ✓

**Now — let me look at the `R32.A22a/b` arms (update authority can't transfer/burn a holder's asset; owner can).** ✓

**Now — let me look at the `R33.G1/G2` setup once more for a subtle issue.** The `worstShape` vault (kAt) is minted via v0 with the 640-byte `exact()` list. Then the autograph is added via PADTAIL! wrapper. Then in section 10, revealAll reveals it. But wait — between the L.12 block (where kAt is minted) and section 10, are there other vaults minted that would be ahead of kAt in the FIFO? revealAll reveals in mint order. kAt's mint_index is set at mint. All vaults minted before it must be revealed first. revealAll handles that (it loops from revealed_total). ✓

But — the autograph addition happens in the L.12 block, BEFORE the reveal. The reveal re-sends the attributes (640-byte list) + level via UpdatePluginV1. The autograph is a separate plugin; the reveal doesn't touch it. So after the reveal, the autograph should still be there (checked by R33.G1's ag() call). ✓

**Now — the `crowdShape` vault (cv):** minted with mkVault(0n) (empty attrs). Then an empty Autograph plugin added by the owner. Then strangers (wrapper PDAs) grow it via SIGSPDA! until Core's heap refuses. Then revealed in section 10. R33.G2b checks the reveal landed and the signature count == kept. ✓

Hmm — one subtle thing: the SIGSPDA! growth happens in the L.12 block. The reveal happens in section 10. Between them, more vaults are minted (mintCU etc.). The FIFO order is preserved by revealAll. ✓

**Now — let me look at the `exact()` function:** builds a list of exactly `budget` (640) bytes: 4 pairs of 64-char keys + 64-char values (each 8+64+64 = 136 bytes × 4 = 544), then a 5th pair: key 'k4'.padEnd(8) (8 chars), value of `budget - used - 16 + extra` chars. used = 544. budget - used - 16 = 640 - 544 - 16 = 80. So the 5th pair: 8 + 8 + 80 = 96. Total: 544 + 96 = 640. ✓. With extra=1: 641 (over budget → refused at mint, L.12a). ✓

Wait — `check_attributes(&attributes, MAX_ATTRS - 1)` allows 7 attributes on a paid mint. exact() has 5. And `write_record` checks bytes <= 640. exact() = 640 → allowed. exact(1) = 641 → AttributesTooLarge. ✓

Hmm — but the reveal re-sends the list + level. The list is 5 attributes (640 bytes). The reveal's attribute count: 5 + 1 (level) = 6 <= MAX_ATTRS (8). ✓. And the reveal transaction size: L.12 measures it fits. ✓

**Now — let me look at the `L.12a` arm:** a v0 mint with exact(1) (641 bytes) → refused AttributesTooLarge. ✓

**Now — let me look at the `L.12b` arm:** exact() (640) lands via v0. ✓

**Now — let me reconsider the `sizeFor` / redemption ceiling measurements (9.14*).** These build worst-case redemption transactions with N reserve mints and measure serialized size. EXPECTED_CEILING = 3. 9.14a: 3-mint worst case is 1153 bytes. 9.14b: 2 with destination creates. 9.14c: activated (claim + open + sweep + burn) carries 3. 9.14d: 2 with creates. ✓

Hmm — 9.14a says "a 3-mint worst-case redemption is 1153 bytes (stage 3: 1120; stage 2: 1021; v5, with the Bank: 1119)". And SPEC says the same. The measurement uses the explicit-transfer sweep shape (not the helper). The helper shape is smaller (S8: 1061). The 1153 is the explicit-transfer worst case. Both fit. ✓

**Now — let me look at the `sizeFor` function's sweep:** for each mint, a transfer of 1n + close, plus a lamport transfer of 1. The `decl` includes both derivations. The `withClaim` adds ixPoolClaim. The `createDest` adds destination ATA creates. ✓

**Now — let me look at the `9.13a` arm:** unsigned serialization reserves signature bytes. ✓ (foundation for the size measurements.)

**Now — let me look at the `P.30` arm:** a legacy claim carries a measured number of vaults (maxN > 1 && < 64). ✓

**P.31:** a real claim paying `live.length` vaults under the CU ceiling. ✓

**P.32:** the invariant. ✓

**P.33:** the crank bound on the tightest carrier (charter claim with depth-8 proof + crank of 4). ✓

**3c.P1:** charter claim with Oracle pass-through, separate payer, compute-budget, depth-8 proof, no crank. ✓

**Now — let me look at the `BO.*` arms once more for coverage of the boost invariants.** BO.7-BO.38 cover: boost purchase, carry, two distributions, due, gate, expiry (both ways), retire before/after due, terms votes (newest first, superseded skip), BoostTermsMoved (each leg), favorable move, sold vault (old/new owner), ring wrap, wrapped early retire, duplicate claim, crank/pair overlap, frozen expiry deferral, off/on. Comprehensive. ✓

**Now — let me look at the `expireDue`/`step` helpers in BO:** expireDue finds due boosts and expires them in batches of 20. step expires, distributes, expires. ✓

**Now — let me look at the `freeV` helper:** finds a live, active, unboosted, unboosted alice vault. ✓

**Now — let me look at the `exactDist` helper:** joins waiting, tops up to an exact multiple of weight, distributes by burn, returns sats per weight. ✓

**Now — let me look at the `paid` helper:** claims all, computes got vs want (base weight × k + extras). ✓

**Now — let me reconsider the `books()` check:** recomputes w, bw, n (boosted count), and checks p.w === w, c.wt === bw, c.active === n, c.ring + c.due === c.active, p.bal >= p.owedCeil. ✓

**Now — let me look at the `ledger()` check (BK):** same plus owed == sum of shares. ✓

**Now — let me think about whether there's a defect in the `claim`'s handling of a vault whose boost is due AND whose payment is 0.** `if r.boost_weight > 0 && dist_epoch >= boost_end_epoch { expire_boost; touched = true }`. Then `pending = owed_of; pay = pending / SCALE`. If pay == 0: `if touched { store_record }; continue`. So the expiry is stored even if no payment. ✓

**Now — a vault whose boost is due and payment > 0:** expire, then pay at the EXPIRED weight? No wait — expire_boost calls reweigh(c, r, 0), which moves owed to carry and resets debt at the base weight. Then pending = owed_of (base weight now). pay = pending / SCALE. So the vault is paid its boosted share (carried) at... the carry holds the full boosted owed. pay = carry / SCALE (plus base-weight accrual since the last distribution — but no distribution ran since the boost became due, because the gate blocks distributions while due). So the vault is paid exactly its boosted share. ✓ (BO.14 tests.)

Hmm — wait. Let me think about this more carefully. The boost becomes due when a distribution advances dist_epoch to boost_end_epoch. That distribution credited the vault at its boosted weight (the last one it earned). After that distribution, the gate (boosts_due > 0) blocks further distributions. So when the claim expires the boost: acc is where the last distribution left it. reweigh to 0: carry = owed_of = boosted_weight * acc - debt + old_carry. debt = base_weight * acc. owed_of after = base_weight * acc + carry - base_weight * acc = carry = the full boosted owed. pay = carry / SCALE. ✓. The vault gets exactly its boosted share. ✓

**Now — what if the boost is expired by `expire_boosts` (not claim)?** Same reweigh. The owed stays as carry. The next claim pays it. ✓

**Now — the `BoostsExpireFirst` gate on `distribute` and `monthly_inline`.** distribute: `require!(boosts_due == 0, BoostsExpireFirst)` — checked AFTER reading the pool but BEFORE the burn. monthly_inline: `if c.boosts_due > 0 { return Ok }`. ✓

**Now — a subtle one: `expire_boosts` can be called while boosts_due > 0 (that's its purpose). It expires due ones. After it, boosts_due might still be > 0 if not all due records were in the batch. The gate remains until all are expired. ✓**

**Now — `advance_epoch` adds ring[i] to boosts_due. What if a boost's end_epoch is reached but the vault was retired before?** retire → unschedule_boost (not-due branch: ring[end % 64] -= 1). So the ring doesn't count it. ✓

**Now — what if a boost's end_epoch is reached and the vault was retired in the SAME epoch it became due?** Sequence: distribution advances epoch to E (boost at E becomes due, ring[E%64] drained into boosts_due). Then retire: unschedule_boost — `if c.dist_epoch >= r.boost_end_epoch` (E >= E, true) → boosts_due -= 1. ✓ (BO.17 tests.)

**Now — what if the vault is retired in the same transaction as the distribution that makes its boost due?** E.g., [distribute, burn]. The distribution advances the epoch (boost due). The burn's retire_redeemed → retire → unschedule (due branch). ✓. Or [burn, distribute]: burn retires first (boost not yet due at retire time — dist_epoch < end). unschedule (not-due branch: ring -= 1). Then distribute advances epoch; the ring slot doesn't include the retired boost. ✓. Both orders consistent.

**Now — let me look at the `retire` + `monthly_inline` order in retire_redeemed once more.** retire first (removes weight, unschedules boost), then monthly_inline (credits remaining vaults). ✓

**Now — let me look at the `claim`'s `monthly_inline` BEFORE the payments.** If the month is due, it credits first (at the current weights), then pays. A vault being claimed gets its share of the new distribution too. ✓

**Now — let me look at the `activate`'s `monthly_inline` BEFORE the activation.** A month due is credited to the vaults active during it, not the one being activated. ✓

**Now — `boost_vault`'s `monthly_inline` BEFORE the boost.** Credited at the old weight. ✓ (BO.22.)

**Now — `mint_vault`/`claim_charter_vault`'s `monthly_inline` FIRST.** ✓

**Now — let me look at the `tick` in monthly_inline's w == 0 branch:** `if c.pending_this_epoch > 0 { tick(c, now)?; }`. tick stamps last_distribute_at and advances epoch. So the launch tick requires pending_this_epoch > 0 (someone requested this epoch). If no one requested, no tick (last_distribute_at stays, the month stays due). Hmm — so the launch tick only happens once someone requests activation. That's the design (the door opens when there's someone to join). ✓

Wait — but the explicit `distribute` (free path) with w == 0 requires `pending_this_epoch > 0` too. So both paths need a pending request. ✓

**Now — a subtle liveness point: after the launch tick, dist_epoch = 1, and the requests (made in epoch 0) are now eligible (dist_epoch > request_epoch). waiting_to_join = pending_count - pending_this_epoch = pending_count - 0 = pending_count > 0. So distributions are gated (JoinWaitingFirst) until the vaults join. The crank joins them (free claims). Then distributions can run. ✓**

**Now — what if NO ONE ever requests activation?** Then pending_this_epoch == 0, no tick, last_distribute_at stays at charter_closes_at. The pool accumulates (splits). No distributions. But no vault is activated, so no one is owed. The revenue waits. When someone finally requests (epoch 0 still, since dist_epoch never advanced), the next monthly_inline/distribute ticks (pending_this_epoch > 0), they join, distributions start. ✓. Hmm wait — if dist_epoch is still 0 and someone requests in epoch 0, pending_this_epoch = 1. The next due monthly_inline: w == 0, pending_this_epoch > 0 → tick (epoch 1). Then they join. ✓. But the month was due long ago — the tick stamps last_distribute_at = now. So the first crediting distribution is a month after the tick (or immediately via a burn after joining). ✓

**Now — let me look at the `distribute` free path with w > 0:** requires month elapsed, no remaining accounts, waiting_to_join == 0, avail > 0. Then credit. ✓

**Now — let me reconsider the `PoolShort` refusal:** `balance.checked_sub(owed).ok_or(PoolShort)`. If balance < ceil(owed), refused. The invariant says this can't happen. But if it somehow did (a bug), distribute refuses (loud) rather than distributing money it doesn't have. Fail-closed. ✓

**Now — let me look at the `claim`'s pool balance check.** There isn't one! The claim transfers `pay` from the pool. If the pool's balance < pay, the SPL Transfer fails (insufficient funds), reverting the whole claim. The invariant (pool >= ceil(owed)) ensures this doesn't happen. ✓

**Now — let me look at the `monthly_inline`'s `avail = balance.saturating_sub(ceil_sats(c.owed_scaled))`.** saturating — if balance < owed, avail = 0, return Ok. So monthly_inline never credits from a short pool. ✓ (Defensive; the invariant holds anyway.)

**Now — let me look at the `credit` function's `advance_epoch`:** dist_epoch += 1, pending_this_epoch = 0, ring drain. ✓

**Now — let me look at the `tick`:** last_distribute_at = now, advance_epoch, log. ✓

**Now — let me reconsider the `waiting_to_join` computation:** `pending_count - pending_this_epoch`. pending_count = total waiting. pending_this_epoch = requested in the current epoch (not yet eligible). So waiting_to_join = eligible-but-unjoined. ✓

**Now — a vault that requested in epoch E and dist_epoch is now E+1: eligible. pending_count includes it, pending_this_epoch doesn't (zeroed at the advance). waiting_to_join counts it. ✓**

**Now — a vault that requested in epoch E and dist_epoch is still E: not eligible. pending_count and pending_this_epoch both include it. waiting_to_join = 0. ✓**

**Now — the retire of a pending vault from epoch E when dist_epoch is E+1: pending_count -= 1, pending_this_epoch unchanged (request_epoch != dist_epoch). waiting_to_join decreases. ✓**

**The retire of a pending vault from epoch E when dist_epoch is E: pending_count -= 1, pending_this_epoch -= 1. waiting_to_join unchanged (was 0 for this vault). ✓**

**Now — let me look at the `join` function's counter updates:** total_active_weight += w, active_count += 1, pending_count -= 1. pending_this_epoch NOT decremented (the vault being joined is from an earlier epoch by definition — dist_epoch > request_epoch — so it's not in pending_this_epoch). ✓

**Now — let me look at the `activate` request's counter updates:** pending_count += 1, pending_this_epoch += 1, request_epoch = dist_epoch. ✓

**Now — let me reconsider the `activate` second call (join via activate):** `require!(dist_epoch > request_epoch, ActivationPending)` then `join`. join checks the same. ✓

**Now — `activate` on a pending vault whose asset is wrong:** `require_keys_eq!(ctx.accounts.asset.key(), r.asset, WrongAsset)`. ✓

**`activate` on a pending vault that's been bare-burned:** `require_live_vault` fails (the asset is a tombstone) → NotALiveVault. So a bare-burned pending vault can't join via activate. But it CAN join via claim (claim doesn't check live)! Round 33 A5/limit 27: "a bare-burned vault still WAITING to join can be joined by a claim that names it, adding weight nobody can collect until it is retired". Accepted limit 27. The crank never joins a positively burned vault (fixed in the crank per RT3 finding 2). ✓

**Now — let me look at the `claim`'s lack of a live-asset check once more.** claim pays/joins without checking the asset is alive. For an active vault that was bare-burned: claim pays into its ATA (behind the burned asset — unreachable). Accepted limit 27. The crank retires bare burns first each pass. ✓

**Now — let me look at the `retire_burned`:** requires positively burned. retire(c, r, false, false). ✓

**Now — let me look at the `retire_redeemed`'s `is_burned` check:** the asset must be positively burned (BURN already burned it via Core). ✓

**Now — let me look at the ordering inside burn_vault once more:** checks (owner, collection, open-pairing, rate limit, reserves, lamports, declared accounts) → Core BurnV1 → retire_redeemed CPI → burned_total += 1 → log + event. ✓

**Now — the `invoke` for retire_redeemed is NOT invoke_signed.** MINT's retire_redeemed doesn't need a signer (it proves the caller via stack height + instructions sysvar). ✓

**Now — let me look at the `RetireRedeemed` accounts:** config (mut, seeds), vault_record (mut, seeds [VAULT_SEED, asset]), asset, instructions (address-pinned), pool_token. ✓

**Now — `retire_redeemed` requires `ctx.accounts.vault_record.asset == asset`.** The seeds constraint ties the record to the asset. ✓

**Now — let me look at the `RetireBurned` accounts:** config, vault_record (seeds), asset. ✓

**Now — let me look at the `CaptureEntropy`/`RescheduleReveal`/`RevealLevel` accounts:** vault_record (seeds [VAULT_SEED, vault_record.asset]). ✓

**Now — `RevealLevel` has config (seeds), vault_record (seeds), asset (mut), collection (mut), payer (signer, mut), mint_authority (seeds), slot_hashes, mpl_core (address), system_program. ✓**

**Now — let me look at the `Activate` accounts:** config, vault_record (seeds), asset, vault_token, pool_token. ✓

**Now — let me look at the `Claim` accounts:** config (mut, seeds — also the pool authority), pool_token (mut), token_program (address-pinned). remaining = [SlotHashes?, crank records..., pairs...]. ✓

**Now — let me look at the `Distribute` accounts:** config (mut), pool_token. remaining = burn accounts. ✓

**Now — let me look at the `SplitRevenue` accounts:** config (seeds, NOT mut), revenue (mut), mint, revenue_ata (mut), holders_ata (mut), bank_ata (mut), token_program (address-pinned). ✓

Hmm — config is not mut in SplitRevenue. split_revenue only reads config. ✓

**`SweepSolForSwap` accounts:** config (mut — last_sweep_at), revenue (mut), swap_operator (signer, mut), system_program. ✓

**Now — let me look at the `MintVault` accounts:** config (mut), vault_record (init, seeds), asset (signer, mut), collection (mut), owner (signer), payer (signer, mut), payer_token (mut), payment_mint, revenue_token (mut), token_program (address-pinned), seal_config, mint_authority (seeds), mpl_core (address), system_program, pool_token. ✓

**`ClaimCharterVault` accounts:** config (mut), vault_record (init, seeds), asset (signer, mut), collection (mut), owner (signer), payer (signer, mut), pob_asset (mut), pob_collection (mut), seal_config, mint_authority (seeds), mpl_core (address), system_program, pool_token. ✓

**Now — let me look at the `OpenForRedemption` accounts (SEAL):** vault_asset (mut), collection (mut), owner (signer), payer (signer, mut), config (seeds), seal (seeds SEAL_SEED), mpl_core (address), instructions (address-pinned), system_program. ✓

**`BurnVault` accounts (BURN):** vault_asset (mut), collection (mut), owner (signer), asset_signer (mut, seeds via MPL_CORE), payer (signer, mut), config (mut, seeds), seal_config, instructions (address-pinned), mpl_core (address), system_program, mint_program (address-pinned), mint_config (mut), vault_record (mut), pool_token. ✓

**Now — let me look at the `Initialize` space for SEAL:** `8 + 1 + 32 + 4 + (32 * MAX_RESERVE_MINTS) + 1 + CONFIG_PADDING` = 8+1+32+4+96+1+256 = 398. ✓

**Now — let me look at the `Config` struct for SEAL:** version, collection, reserve_mints Vec (max 3), bump. The Vec is allocated for 3. If initialized with fewer (e.g., 1), the remaining space is zeros (Borsh Vec len = 1, then 1 key, then zeros). seal_reserves reads n = the actual len. ✓

Hmm — wait. If SEAL is initialized with 1 reserve mint, the Vec has len 1. BURN reads n = 1 and checks 1 mint. But production MUST pass all 3 (the comment says). The launch checker pins 3. If initialized with 1, that's locked forever — a vault holding $GARY or $GIRAFFISH would have those destroyed (not checked). The launch checker (item 38) pins the ruled three. The program accepts 1-3. Item 38 covers. ✓

**Now — let me look at the `assert_classic_spl`:** each mint must be passed as a remaining account and owned by SPL_TOKEN. ✓

**Now — let me look at the `read_core_asset` in SEAL:** owner Core, len >= 66, KEY_ASSET_V1, UA_DISC_COLLECTION, returns (owner, collection). ✓

**Now — let me look at the `set_frozen`/`core_plugin_cpi`:** UpdatePluginV1, PermanentFreezeExecute, frozen byte. Accounts: asset, collection, payer (signer), seal (signer via PDA), system_program, mpl_core. invoke_signed with SEAL_SEED. ✓

**Now — let me look at the `Initialize` for SEAL once more:** authority check FIRST (testability), then reserve checks, then config write. ✓

**Now — let me look at the `open_for_redemption`'s `read_core_asset`:** returns (asset_owner, collection). Checks asset_owner == owner (signer), collection == config.collection, collection account == asset's collection. ✓

**Now — let me look at the walk once more:**

```rust
let mut i = current.checked_add(1).ok_or(VaultError::Overflow)?;
while let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
    if matches { found = true; break; }
    i += 1;
}
require!(found, NoTerminalBurn);
```

`i += 1` could overflow if i == u64::MAX... but i is bounded by the number of instructions (small). The checked_add at the start handles current == u64::MAX (absurd). Fine.

**Now — BURN's walk:**

```rust
for i in 0..current {
    if let Ok(ix) = load_instruction_at_checked(i, &sysvar) {
        if matches { found = true; break; }
    }
}
require!(found, NoPrecedingOpen);
```

✓

**Now — let me look at the `read_mint_supply` in BURN:** derives the expected config address from MINT_PROGRAM_ID, checks key, owner, len >= 462, disc, version. Reads minted_total (141) and bare_retired (454). ✓

**Now — let me look at the rate-limit block once more:**

```rust
let (minted_total, bare_retired) = read_mint_supply(&ctx.accounts.mint_config)?;
let live = minted_total.checked_sub(ctx.accounts.config.burned_total)?.checked_sub(bare_retired)?;
let cap = live.checked_mul(REDEEM_RATE_BPS)?.checked_add(9_999)? / 10_000;
let k = (cap.max(1) as usize).min(RATE_RING);
```

live * 210 could overflow u64? live <= 2100 (max_supply). 2100 * 210 = 441,000. No overflow. But minted_total is read from MINT's config — could it be huge? minted_total <= max_supply (checked at mint). max_supply is an initialize value (could be huge in theory, but the checker pins 2100). Even if max_supply were u64::MAX, live * 210 would overflow → checked_mul aborts (Overflow). So a huge supply would brick redemptions. But max_supply is pinned at 2100 by the checker. And minted_total can't exceed max_supply. So live <= 2100. ✓

**Now — `cap.max(1)`:** cap could be 0 if live * 210 < 10000 (live < 48). max(1) → 1. ✓

**Now — the `kth` lookup and the write:** verified above. ✓

**Now — let me look at the reserve-reading block in burn_vault:** pinned seal_config (derived address, owner, disc, version, collection match), reads n (1..=3), reads the mints. ✓

**Now — the emptiness loops:** verified above. ✓

**Now — the Core BurnV1 CPI:** accounts asset, collection, payer (signer), owner (signer), mpl_core ×2. data [IX_BURN_V1, 0]. invoke (owner signs the top-level). ✓

**Now — the retire CPI:** verified above. ✓

**Now — `burned_total += 1` and the log.** ✓

**Now — let me look at the GOV `execute_proposal`'s CPI account list:** `[AccountMeta::new(mint_config, false), AccountMeta::new_readonly(gov_pda, true)]`. MINT's Governed struct expects [config (mut), governance (signer)]. ✓

**Now — the `invoke_signed` with `[&[GOV_SEED, &[gov_bump]]]`.** ✓

**Now — let me look at the GOV `ExecuteProposal` accounts:** config (mut, seeds), proposal (mut, seeds), mint_config (mut), governance (seeds GOV_SEED), mint_program (address-pinned). ✓

**Now — the `Proposal` seeds:** [PROPOSAL_SEED, &proposal.id.to_le_bytes()]. And create uses `&(config.proposal_count + 1).to_le_bytes()`. So proposal id = proposal_count (after increment). ✓

**Now — the `VoteRecord` seeds:** [VOTE_SEED, proposal, asset]. ✓

**Now — let me look at the `CreateProposal` accounts:** config (mut, seeds), proposal (init, seeds), mint_config, burn_config, vault_asset, proposer (signer, mut), system_program. ✓

**`CastVote` accounts:** config (seeds), proposal (mut, seeds), vote_record (init, seeds), vault_asset, vault_record, owner (signer), payer (signer, mut), system_program. ✓

**Now — let me look at the `read_vault_index`:** derives the record PDA from MINT, checks owner, disc, version, asset match, reads mint_index. ✓

**Now — let me look at the `Proposal` struct size:** 8 + 8 + ACTIONS_SPACE + 8 + 8 + 8 + 1 + 1 + 8 + 2 + 2 + 8 + 8. ACTIONS_SPACE = 4 + 5*37 = 189. Total: 8+8+189+8+8+8+1+1+8+2+2+8+8 = 269. The CreateProposal space: `8 + 8 + ACTIONS_SPACE + 8 + 8 + 8 + 1 + 1 + 8 + 2 + 2 + 8 + 8` = same. ✓

Fields: id(8), actions(Vec, 189), voting_ends_at(8), yes(8), no(8), executed(1), bump(1), quorum_supply(8), quorum_bps(2), threshold_bps(2), index_snapshot(8), created_at(8). Sum: 8+189+8+8+8+1+1+8+2+2+8+8 = 261 + 8 (disc) = 269. ✓

**Now — the `VoteRecord` size:** 8 + 32 + 32 + 1 + 1 = 74. ✓

**Now — let me look at the `ACTION_MAX_BYTES`:** Brakes = tag 1 + 3 bools + Option<Pubkey> 33 = 37. ✓ (SetRound 1+28=29, TightenSweep 1+27=28 (3 Options: 1+9+9+9=28... wait, SweepTighten = 3 Options of u64/u64/i64: each Option is 1 + 8 = 9, so 3×9 = 27, + tag 1 = 28. Hmm, the comment says "TightenSweep 1+27". 1 + 27 = 28. But ACTION_MAX_BYTES is 37 (Brakes is the largest). ✓

Wait — but the Vec<ProposalAction> Borsh encoding: each element is tag + payload. Brakes payload: 3 bools (3) + Option<Pubkey> (33) = 36, + tag 1 = 37. ✓. So 5 actions × 37 + 4 (vec len) = 189. ✓

**Now — let me look at the `ProposalAction` enum order:** SetRound(0), Brakes(1), TightenSweep(2), ArmSwapOperator(3), SetBoostTerms(4). The suite's act* helpers encode tags 0-4. ✓

**Now — let me look at the `SweepTighten` in GOV vs MINT:** both have sol_reserve_lamports: Option<u64>, max_sweep_lamports: Option<u64>, sweep_cooldown_secs: Option<i64>. ✓ (8.14a proves byte-for-byte agreement by execution.)

**Now — let me look at the discriminators:** the suite pins them (3.1a-3.1u, BO.29). ✓

**Now — let me look at the `IX_SET_BOOST_TERMS`:** [8, 243, 183, 8, 24, 133, 62, 134]. The suite's BO.29 pins it against sha256("global:set_boost_terms"). ✓

**Now — let me look at the GOV `execute_proposal`'s handling of `SetBoostTerms`:** ordered by last_boost_id, skipped if superseded. ✓

**Now — let me look at the `Brakes` handling:** arm_guardian (if set_guardian and not superseded), then restart (with stop-is-newer skips). ✓

**Now — let me look at the `SetRound` handling:** skipped if superseded (id <= last_round_id) or already over (closes_at <= now). The mark moves before the over-check (RT3 finding 4). ✓

**Now — let me look at the `ArmSwapOperator` handling:** skipped if superseded (id <= last_arm_id). ✓

**Now — let me look at the `TightenSweep` handling:** always executed (monotone, no ordering needed). ✓

**Now — let me reconsider the `key_change` detection:** `matches!(a, Brakes { set_guardian: true, .. } | ArmSwapOperator { .. })`. ✓

**Now — let me look at the `create_proposal`'s `changes_guardian`/`arms_operator` bundle check:** `changes_guardian = any(Brakes { set_guardian: true, .. })`, `arms_operator = any(ArmSwapOperator)`. require !(both). ✓ (3c.K1 tests.)

**Now — let me look at the `create_proposal`'s per-action checks:** SetRound (price floor, window, cap > 0), Brakes (non-empty), TightenSweep (non-empty, tighter, in bounds), ArmSwapOperator (non-default), SetBoostTerms (in bounds if price > 0). ✓

**Now — let me look at the `read_mint_config`'s bounds:** `d.len() >= OFF_MINT_MAX_BOOST_EPOCHS + 2` = 714. ✓

**Now — let me look at the `read_burn_total`:** pinned address, owner, disc, version, len >= 50. ✓

**Now — let me look at the `read_core_asset` in GOV:** same as SEAL's. ✓

**Now — let me look at the `initialize` for GOV:** authority, read_mint_config, collection match, quorum/threshold/voting bounds, config write. ✓

**Now — let me look at the `GovConfig` version:** 4 (last_boost_id appended). ✓

**Now — let me think about whether there's a governance attack via a proposal with a huge `voting_ends_at`.** dur <= MAX_VOTING_SECS (30 days). ✓

**A proposal with `voting_ends_at` in the past?** dur = voting_ends_at - now (checked_sub → BadWindow if negative). ✓

**Now — let me look at the `execute_proposal`'s `ProposalExpired` check:** now <= voting_ends_at + 7 days. ✓

**Now — let me look at the `QuorumNotMet` for cast == 0:** `require!(cast > 0)`. ✓

**Now — let me look at the `yes_bps` computation:** `yes * 10000 / cast`. Floor. threshold 5100 means yes >= 51% (floor could round down — yes * 10000 / cast >= 5100 means yes >= 0.51 * cast, with floor rounding... e.g., yes = 51, cast = 100 → 5100 >= 5100 ✓. yes = 50 → 5000 < 5100 ✓. F18.2 tests exactly 60%.) ✓

**Now — let me look at the `need` (quorum) computation:** ceil(snapshot * quorum_bps / 10000). ✓

**`need_yes` (turnout):** ceil(snapshot * 1000 / 10000) = ceil(snapshot * 10%). ✓

**`need_key`:** ceil(snapshot * 5000 / 10000) = ceil(snapshot * 50%). ✓

**Now — let me look at the `ProposalExecuted` event:** id, yes, no, quorum_supply, minted_now. ✓

**Now — let me look at the `skipped` log:** CBOB_ACTION_SKIPPED proposal action reason. ✓

**Now — let me step back and think about the highest-value remaining attack surface. The programs are heavily audited. The newest program code is... nothing new since round 32. The suite is the newest. Let me look for suite arms that could false-pass in ways round 33 didn't catch.**

Round 33 D3 found arm 2.1 couldn't fail. Let me look for similar patterns: `rec` calls where the `got` is derived from something that exists regardless of the operation's success.

- `rec('C.4','the vault is in the CBOB collection, owned by the PoB holder',alice.publicKey.toBase58(),String(a.owner))` — a = fetchAsset(C1.umiAsset). If the claim failed, C1 wouldn't exist and fetchAsset would throw (crash, red). ✓

- `rec('C.5','its record: charter, mint index 0, level not drawn','1,0,0', ...)` — reads the record. ✓

- `rec('2.3','seal plugin authority is the SEAL program PDA',SEAL.toBase58(),String(a.permanentFreezeExecute?.authority?.address))` ✓

- `rec('K.1','a CHARTER CLAIM captures a queued vault's entropy on its way past','1',String((await recOf(C4.asset))![OFF_REC_SET]))` — C6 = await claim(carol,5,{crank:[C4.asset]}). If the claim failed, crash. The crank captured C4's entropy. ✓

- `rec('L.6','the vault now CARRIES the level its record holds',LNAME[...],String(a.level))` ✓

- `rec('L.10','the level the program drew equals an independent re-computation of the draw',String(want),String(...))` ✓

- `rec('L.23','EVERY draw, replayed in mint order against the census at its turn, matches','0',String(wrong))` ✓

- `rec('X.7','with every level drawn, the crank plans NO reveal on the live chain','0,true', ...)` ✓

- `rec('RL.7', ...)` — replays the ring. ✓

- `rec('BK.IN'/'BK.3c'/'BK.P', ...)` — checks labels. ✓

- `rec('ID.1','every assertion id in this suite is unique','[]', ...)` ✓

Hmm — let me look at `rec('P.11a', ...)` — "Level I : II : III : IV : V pays 1 : 1.5 : 2 : 2.5 : 3, ALL FIVE levels present (here ${picks.length} of 5)". want = 'I:1x II:1x.5 III:2x IV:2x.5 V:3x'. got = perLevel.join(' '). perLevel is computed from picks. If picks.length < 5, perLevel has fewer entries and got != want → red. Round 25 fixed this (the want is fixed). But wait — the label says "ALL FIVE levels present (here X of 5)". If picks.length < 5, the arm fails (got has fewer). So the arm REQUIRES all five levels to be present. Is that guaranteed? P.2a checks the exhausted census guarantees an eligible vault at every level. So picks should have all 5. ✓

Hmm — actually, let me double-check the perLevel computation: `${LNAME[...]}:${got[i+3]/(k*2n)}x${(got[i+3]%(k*2n))*2n/(k*2n)?'.5':''}`. For a level with weight w, got = w*k. got/(k*2) = w/2 (integer division). The remainder: (got % (k*2))*2/(k*2) — for odd w, got = w*k, got % (k*2) = k (if w odd), so k*2/(k*2) = 1 → truthy → '.5'. For even w, got % (k*2) = 0 → ''. So Level I (w=2): 2k/(2k) = 1, no .5 → 'I:1x'. Level II (w=3): 3k/(2k) = 1, .5 → 'II:1x.5'. Level III (w=4): 2 → 'III:2x'. Level IV (w=5): 2.5 → 'IV:2x.5'. Level V (w=6): 3 → 'V:3x'. ✓ matches want.

But — the picks are ordered byLevel[0..4] (by level). perLevel maps over picks (filtered byLevel). got[i+3] — the picks are at indices 3.. in ACT (ACT = [C1, ex, atk, ...picks]). So got[i+3] is the pick's payment. ✓

**Now — let me look at the `P.11` arm:** want.join(',') vs got.join(','). want = weight × k per vault. ✓

**Now — let me look at the `P.12a` arm:** "the pool owes exactly the sub-sat dust it owed before, and holds nothing it does not owe". want = `${q.owed},${q.owedCeil},true`. got = `${e.owed},${e.bal},${q.owed < BigInt(ACT.length)*ACC_SCALE}`. Hmm — the third element checks q.owed < ACT.length * SCALE (sub-sat dust). And e.owed == q.owed (dust unchanged), e.bal == q.owedCeil (holds exactly what it owes). ✓

**Now — let me look at the `P.13` arm:** "the odd sat that does not divide stays IN THE POOL, owed to holders". want '1,1,0'. got = `${q.bal},${q.owedCeil},${q.avail}`. ✓

**Now — let me look at the `PG.*` arms.** PG.1 (burn distribution), PG.1a (supply fell), PG.1b (logged), PG.1c (CU + packet), PG.2-PG.7 (refusals), PG.8/PG.9 (free path). ✓

**Now — let me look at the `IN.*` arms.** IN.0 (due but empty pool, host lands, no distribution), IN.1 (three hosts together, exactly one distributes), IN.2 (exactly one, logged monthly_inline), IN.3 (all credited), IN.4 (not due, none), IN.5 (redemption alone runs it). ✓

**Now — let me look at the `3c.A*` arms (two-step activation).** A1 (request waiting), A3 (burn can't open door), A4 (mint ticks), A4b (gate), A5 (join), A6 (activate+distribute in one tx), A6a (activator gets nothing), A6b (claim joins), A6c (second burn gated), A7 (already active). ✓

**Now — let me look at the `3c.F*` arms (frozen pool).** F0 (owed precondition), F1 (no claim), F2 (redemption lands), F3 (forfeit logged). ✓

**Now — let me look at the `3c.K*` arms (key changes).** K0 (cancel none pending), K1 (bundle refused), K2 (arm short of half), K2p (precondition), K3 (stranger cancel), K4 (guardian cancel), K4a (nothing to land), K5 (armed operator lands), K5a (old operator can't sweep). ✓

**Now — let me look at the `3c.G*` arms (guardian).** G1 (early apply refused), G2 (lands after notice). ✓

**Now — let me look at the `3c.B*` arms (tighten bounds).** B1 (below floor), B2 (above ceiling), B3 (above cooldown ceiling). ✓

**Now — let me look at the `3c.M1` arm (GOV mirrors MINT's rent floor).** ✓

**Now — let me look at the `3c.R1` arm (newer round already over supersedes).** ✓

**Now — let me look at the `E.*` arms (multi-action).** E.1 (two actions), E.2 (overtaken round skipped, tightening lands), E.2a (logged), E.3 (four kinds), E.3a (fits), E.3b (round advanced, operator pending), E.3c (CU), E.4 (no actions), E.5 (six actions), E.6 (two rounds), E.6b (two boosts), E.7 (five kinds executed), E.7a (CU). ✓

**Now — let me look at the `D.*` arms (turnout).** D.0 (precondition), D.1 (turnout refused). ✓

**Now — let me look at the `F18.*` arms (NO votes).** F18.0 (precondition), F18.1 (50% refused), F18.2 (60% passes). ✓

**Now — let me look at the `F21.*` arms (waiting vault retired).** F21.1 (both counters), F21.2 (retired, not waiting). ✓

**Now — let me look at the `G.*` arms.** G.1 (price floor), G.3 (fake record), G.4 (wrong token), G.5 (wrong revenue), G.6 (too new), G.7 (old votes), G.8 (live divisor), G.9 (burns lower divisor), G.10 (passes with exact YES). ✓

**Now — let me look at the `RT1.*` arms.** RT1.1 (first vault alone can't propose in window), RT1.2 (earlier proposal executed after later). ✓

**Now — let me look at the `WR.*` arms (wrapper).** WR.0 (deployed), WR.1 (retire through wrapper), WR.2 (wrapped burn), WR.3 (wrapped open), WR.4 (vault intact). ✓

**Now — let me look at the `SR.*` arms (sweep helper).** SR.0 (deployed), SR.1 (direct call refused), SR.2 (destination not owned), SR.3 (exact-amount fails after dust), SR.4 (helper lands the race), SR.4a (exact lamports), SR.5 (stranger Execute refused), SR.5a (transfer delegate refused), SR.5b (collection authority off-curve), SR.5c (control: collection authority refused), SR.5d (control: owner sweeps), SR.5e (vault intact), SR.6-SR.12a (malformed inputs), SR.12b (duplicate source reason), SR.13 (zero pairs), SR.14 (frozen source). ✓

**Now — let me look at the `R27.*` arms.** R27.C1/C2 (program-owned PoB claims), R27.V1 (program-owned vault votes), R27.S1 (lamports to non-system destination). ✓

**Now — let me look at the `R31.*` arms.** R31.W1a (10,199 refused by runtime), R31.W1b (stranger can't replace signature), R31.W2a (pre-funded SEAL config), R31.W2b (pre-funded record/ATA). ✓

**Now — let me look at the `R28.*` arms.** R28.A1 (largest autograph), R28.A2 (can't shrink), R28.A3 (transfer sim), R28.A4 (redemption sim), R28.F1/F2 (frozen split destination). ✓

**Now — let me look at the `R26.*` arms.** R26.P1-P7 (owner plugins don't veto reveal). ✓

**Now — let me look at the `R24.*` arms.** R24.1/1a/1b/1c (external plugins), R24.2 (Some(default) == None), R24.5 (activate with own crank). ✓

**Now — let me look at the `RL.*` arms.** RL.0 (window floor), RL.0a (config v4), RL.1a (rounds down to 0), RL.2 (cap lands), RL.3 (60% still refused), RL.4 (lands after window), RL.5 (logged), RL.6 (cap of 1 precondition), RL.7 (replayed), RL.S1-S6 (cap stamps). ✓

**Now — let me look at the `OR.*` arms.** OR.1 (add oracle), OR.2 (no pass-through refused), OR.3 (over-claim refused), OR.4 (pass-through lands), OR.5 (rejecting oracle refuses), OR.5! (refused by Core), OR.6 (removed). ✓

**Now — let me look at the `C.*` arms (charter).** C.1 (early refused), C.1a (no round), C.2 (claim lands), C.3 (PoB burned), C.4 (owned), C.4a (charter attr), C.4b (no level), C.5 (record), C.6 (counts), C.7 (same PoB), C.8 (lookalike), C.9 (theft), C.10 (vault as PoB), C.11 (own charter attr), C.12 (wrong proof), C.13 (claim during stop), C.14 (six vaults), C.15 (late refused), C.16 (PoB survives). ✓

**Now — let me look at the `L.*` arms (levels).** L.1 (early capture), L.2 (out of order), L.3 (any order capture), L.3a (stored), L.3b (twice), L.3c (re-derived), L.4 (tampered attrs), L.5 (reveal), L.6 (carries level), L.7 (charter beside), L.8 (census), L.9 (twice reveal), L.10 (independent draw), L.11 (burned before draw), L.11a (still tombstone), L.12 (budget fits), L.12a (over budget), L.12b (exact budget), L.13 (7 pairs), L.14 (8th attr), L.15 (late capture), L.16 (reveal lapsed), L.16a (behind waits), L.16b (early reschedule), L.17 (rescheduled), L.17a (logged), L.17b (counted), L.17c (crank reschedules), L.17d (real entropy), L.17e (behind kept entropy), L.18 (quotas exact), L.19 (minted == caps), L.20 (one more), L.21 (record count), L.22 (attr matches record), L.23 (every draw replayed), L.23a (none without entropy). ✓

**Now — let me look at the `K.*` arms (crank).** K.1 (charter claim captures), K.2 (mint captures), K.3 (junk skipped), K.4 (five refused), K.5 (activation captures), K.6 (claim captures), K.7 (crank+pair overlap). ✓

**Now — let me look at the `X.*` arms (off-chain readers).** X.1-X.7. ✓

**Now — let me look at the `0.*` arms (init).** 0.1 (stranger), 0.1a (init lands), 0.1b (guardian on chain), 0.1c (gov PDA), 0.1d (stops clear), 0.1e (window over), 0.1f (zero root), 0.1g (dirty collection), 0.1h (foreign collection), 0.1i (second init), 0.1j (default treasury), 0.1k (payment not reserve), 0.1l (floor above cap), 0.1m (reserve ceiling above bound), 0.1n (notice under floor), 0.1o-v (boost setup), 0.2 (SEAL stranger), 0.2a (SEAL init), 0.3 (BURN stranger), 0.3a (BURN init), 0.3b (BURN wrong collection), 0.4-i (deleted paths). ✓

**Now — let me look at the `1.*` arms.** 1.1 (init authority sets round directly). ✓

**Now — let me look at the `2.*` arms.** 2.1 (mint lands — repaired), 2.2 (price in revenue), 2.2a (out of payer), 2.2b (not charter), 2.3 (seal authority), 2.3a (born frozen), 2.4 (no transfer delegate), 2.5 (direct mint into collection). ✓

**Now — let me look at the `3.*` arms (redemption).** 3.1 (stranger), 3.1a-f (discriminator/index pins), 3.1j-u (more pins), 3.1v (version agreement), 3.1w (GOV offsets), 3.1y (BURN pins SEAL disc), 3.3 (delegate planted), 3.3a (delegate closed), 3.6 (open alone), 3.7 (bare Execute), 3.8 (burn alone), 3.9 (decoy burn), 3.10 (different owner), 3.11 (partial sweep), 3.11a (still holds). ✓

**Now — let me look at the `4.*` arms.** 4.1 (burn with BTC), 4.2 (full redemption), 4.3 (owner received), 4.4 (vault gone), 4.5 (PDA empty), 4.5a (counted), 4.5b (retired), 4.6 (fits), 4.8 (unrelated transfer), 4.9 (two at cap 1), 4.10 (cross), 4.10a (nested pair). ✓

**Now — let me look at the `5.*` arms.** 5.1 (miscount), 5.2 (owner doesn't sign), 5.3 (bogus seal config). ✓

**Now — let me look at the `6.*` arms.** 6.1 (cap 0), 6.2 (window never closes), 6.3 (provenance stamped), 6.3a (survives level), 6.4 (redeem), 6.5 (gone), 6.6 (provenance unreadable), 6.10 (deployer changes sweep), 6.12 (price above max), 6.13 (T22 reserve), 6.14 (vote lowers cap), 6.14a (holds it), 6.15 (over cap), 6.16 (exact cap), 6.17 (three in one tx), 6.17a (stranger sweep), 6.17b (zero sweep), 6.18 (cooldown tighter), 6.18a (lowers cooldown), 6.19a (after cooldown), 6.19b (inside cooldown), 6.20 (arm operator), 6.20e (not taken over), 6.20f (pending), 6.20g (early apply), 6.20h (pending while stopped), 6.20i (raises cap), 6.21 (stranger arms), 6.23d (default operator), 6.23e (cap zero), 6.23f (sweep to pending), 6.31 (opens -1 closes MAX), 6.34 (lowers reserve), 6.34a (raises reserve), 6.34b (holds it). ✓

**Now — let me look at the `6c.*` arms (guardian).** 6c.1 (stranger stop), 6c.3 (guardian stops), 6c.4 (flags), 6c.5 (mint while stopped), 6c.6 (stop sweep), 6c.7 (sweep while stopped), 6c.8 (guardian restart), 6c.9 (guardian hand over), 6c.10 (guardian sweep bounds), 6c.10a (stops still set), 6c.10b (guardian arms self), 6c.11 (redemption while stopped), 6c.11a (got BTC), 6c.13 (vote restarts), 6c.14 (only sales), 6c.15 (one vote restarts+arms+round), 6c.15a (old guardian in office), 6c.18 (old guardian pulls), 6c.19 (new guardian stops both), 6c.20 (vote restarts both+tightens+round+arms), 6c.20a (both running), 6c.20b (retire brake), 6c.20c (no guardian), 6c.21 (nobody pulls). ✓

**Now — let me look at the `7.*` arms (governance).** 7.0 (stranger init), 7.0a (wrong collection), 7.1 (init), 7.3 (first proposal), 7.4 (non-holder), 7.5 (non-owner vote), 7.6 (owner vote counts), 7.7 (twice), 7.8 (transfer voted vault), 7.9 (new owner votes), 7.11 (execute while open), 7.12 (zero votes), 7.12a (closed round proposal), 7.12d (pre-funded PDA), 7.12e (quorum floor), 7.13 (execute zero), 7.13a (closed round skipped), 7.14 (execute first round), 7.15 (round advanced), 7.16 (price set), 7.17 (execute twice), 7.18 (gov PDA can't sign), 7.25 (newer round), 7.26 (older round skipped), 7.27 (empty brakes), 7.27a (empty tighten). ✓

**Now — let me look at the `8.*` arms (revenue).** 8.1 (revenue holds), 8.2 (anyone splits), 8.2a-c (wrong destinations), 8.2e (untouched), 8.3 (pool 85%), 8.4 (bank 15%), 8.5 (nothing left), 8.6 (empty split), 8.6a (uneven), 8.6b (floor), 8.6c (remainder), 8.7 (breach reserve), 8.7p (precondition), 8.8 (sweep allowed), 8.9 (operator received), 8.10 (wrong address), 8.10b (stranger pays), 8.12 (mint while stopped), 8.13b (new guardian restart), 8.14 (tighten all three), 8.14a (byte for byte), 8.14b (older looser no-op), 8.15 (install guardian), 8.15a (after notice). ✓

**Now — let me look at the `9.*` arms (nesting/airdrops).** 9.0 (burn inner off outer's thaw), 9.1 (nest permitted), 9.2 (inner owned by outer PDA), 9.3 (redeem nested), 9.4 (declared nested), 9.5 (undeclared nested burns), 9.6 (orphaned), 9.7 (airdrop), 9.8 (declared airdrop), 9.9 (undeclared airdrop burns), 9.10 (SOL blocks), 9.11 (swept), 9.12 (asset exists), 9.13 (re-mint refused), 9.13a (unsigned reserves sigs), 9.14 (ceiling), 9.14a-d (sizes), 9.15 (SEAL caps), 9.15a (fits), 9.16 (BURN agrees). ✓

**Now — let me look at the `10.*` arms (CU).** 10.1 (plain mint CU), 10.2 (widest pad), 10.2a (packet stopped), 10.3 (regression ceiling), 10.4 (reveal CU), 10.5 (capture CU), 10.6 (full crank), 10.6a (default budget), 10.6b (one capture). ✓

**Now — let me look at the `11.*` arms.** 11.2 (level beside provenance), 11.3 (own level attr), 11.4 (duplicate attr), 11.13 (owner rewrite), 11.14 (init authority rewrite), 11.15 (level survives). ✓

**Now — let me look at the `P.*` arms (pool).** Covered above. ✓

**Now — let me look at the `BO.*` arms (boost).** Covered above. ✓

OK, the suite is comprehensive. Let me now think about what structural