**FINDINGS** (most severe first)

**CRITICAL: Admin can redirect treasury, stealing all mint revenue (MINT::update_wiring + mint_vault payment flow, cross-program economics A)**  
Admin (INIT_AUTHORITY multisig) unilaterally sets treasury via update_wiring(treasury=Option). mint_vault requires the passed treasury matches config but sends price_lamports there *before* CreateV2 (no governance gate, no 85/15 enforcement).  
Concrete exploit: Admin tx updates treasury to attacker key. Governance sets_round (price>0, any cap). Payer+bank+owner mints; all fees (intended 85% to holders via treasury) go to attacker. One tx, zero cost to attacker. Top governors (48% concentration) cannot block it.  
Tried/could not break: Collection non-rotatable (SEAL update omits it; MINT cross-check fails otherwise); minted_total counting works.  
Fix: Remove treasury from update_wiring or gate changes behind governance vote + timelock.

**CRITICAL: BURN/SEAL reserve_mints lists diverge; "canonical config" is incomplete (BURN::burn_vault + SEAL::update_config + byte reads at fixed offsets, surface B)**  
BURN maintains independent BurnConfig.reserve_mints (initialized/updated separately). Cross-check only reads raw SEAL config bytes [40..72] collection/[72..104] bank (no discriminator, no vec len, no reserves, no version). inspect_reserves/burn loop only validates *declared* remaining_accounts. SEAL upgrade reordering fields or re-init breaks offsets silently.  
Concrete exploit: SEAL admin updates config adding mint X (e.g. cbBTC) but BURN not synced. Owner+bank calls burn_vault(declared=old count), omits X's ATA. All checks (ReserveNotDeclared, ReserveNotOurs, ReserveDelegated, final PDA-owner loop) pass; Core BurnV1 succeeds; tokens trapped in now-unusable Execute PDA. Matches D6; contradicts BURN header.  
Tried/could not break: Matching-list burns (tests pass); delegate/close-auth surviving seal (inspect_reserves catches); non-ATA completeness (accepted off-chain).  
Fix: Single canonical SEAL config; BURN/MINT deserialize full Account<'info, Config> or hash the Vec. Remove duplicate init/update paths.

**HIGH: Governance can mint unlimited free vaults, evading all supply economics (MINT::set_round + mint_vault, surface A)**  
set_round(governance-only) accepts price_lamports=0, cap=0/u32::MAX, closes_at=i64::MAX; only increments round_id and resets per-round counter. minted_total counts but never gates (lifetime ~2100 unenforced).  
Concrete exploit: 48% governor coalition (top-3 wallets) ratifies set_round(price=0, cap=u32::MAX, opens_at=now-1, closes_at=i64::MAX). They mint unlimited for self at zero cost, diluting secondary buyers who paid for "reserve still contains its Bitcoin". Admin update_wiring cannot neutralize. Clock::get can be manipulated near boundaries.  
Tried/could not: Mint before opens_at or after cap (Clock + minted_this_round checks).  
Fix: Hard lifetime cap in set_round (minted_total + cap <= 2100); reject price==0.

**HIGH: mark_opened replaces (does not merge) Attributes plugin, destroying charter provenance (SEAL::close_redemption + mark_opened data build, surface C)**  
mark_opened always emits UpdatePluginV1(Attributes) with *exactly one* {"redemption":"opened"} pair (vec![6, ... 1u32 len, key, value]). Mint hardcodes 0-attr list + delegated-to-seal. No stamp on burn path.  
Concrete exploit: Charter vault (minted with provenance attrs like notice serial) calls open/close once (even taking 0 cbBTC). Attributes now only "opened"; provenance (intended "ONLY surviving record") erased. Seller launders drained vault before resale on secondary. Stamp not monotonic for buyer trust ("opened once" ≠ emptied). Seal authority is only writer, but replacement loses data.  
Tried/could not: Forging stamp without seal signer; removing post-close (frozen).  
Fix: Append to existing attrs or use dedicated immutable plugin/field; stamp provenance at mint; set on *every* value-removal path including burn.

**MEDIUM: burn_vault lamports==0 check is griefable (BURN::burn_vault, already-fixed v1 lamports logic relocated)**  
require!(asset_signer.lamports()==0). Anyone can transfer lamports to derived Execute PDA.  
Concrete exploit: Griefer sends 1 lamport to any vault's asset_signer PDA. Owner+bank can never burn (VaultNotEmpty), even after open/close empties all reserves. Permanent brick.  
Tried/could not: Bypass via Core BurnV1 sweep (check is before CPI).  
Fix: Drop check (Core sweeps lamports to payer); rely on token-account checks + Bank alarm.

**LOW: Fragile unsigned SEAL config read proves nothing durable (MINT/BURN seal_config borrow, surface B)**  
Read-only, no signer, no disc[0..8] check. MINT hardcodes SEAL_PROGRAM_ID. Re-deploy SEAL at new address breaks all existing wiring checks.  
Tried/could not: Fake owner (program ownership enforced).  
Fix: Versioned discriminator + full Anchor deserialization from shared crate.

What I could not break: True 2-of-2 (owner sig + Bank co-sig on every open/close/burn; Bank sees whole tx and refuses delegates/ATAs/non-ATA); open/close pairing via instructions sysvar introspection (tried reordering, duplicates, CPI wrappers, ALTs, Clock edge cases — matching discriminator + account binds fail otherwise); PermanentFreezeExecute on mint (19/19 suite mints real vaults, moves real SPL only after open); bare owner BurnV1 while transferable (accepted); initialize front-running (INIT_AUTHORITY gate).

**THE SINGLE THING to fix before this holds real money: Make SEAL config the *sole* runtime source of truth (collection, bank, full reserve_mints Vec) with proper deserialization/hash verification in MINT and BURN. All cross-program divergence, upgrade fragility, and partial canonical claims flow from this.**

**ADJUDICATIONS**

D1: **REJECTED**. Hand-built [20,0] and [12,0] exactly matches Metaplex Core wire format (0 is valid flag/option). Prompt states mints demonstrably succeed on real cloned Core in 19/19 suite; Borsh-revert claim is simply wrong.

D2: **REJECTED**. Code checks full 4-byte option tags ([72..76]==0, [129..133]==0), delegated_amount u64 ([121..129]==0), base len==165, and owner==PDA. It does not rely on "1-byte COption tag" or assume zeroed payload. Claim misreads the offsets and SPL behavior.

D3: **REJECTED**. Solana transactions are atomic: any error after system transfer CPI (including seal_config/WiringDiverged/OwnerWouldBrick checks or CreateV2 failure) reverts *all* state changes. No permanent "paid but no vault." Bad UX possible but not economic loss.

D4: **UPHELD**. lamports()==0 check is griefable by any transfer to the PDA and contradicts SEAL's own v2 philosophy on unsound lamport checks. Drop it; let BurnV1 sweep to payer. Prior "fixed" version merely relocated the vector.

D5: **REJECTED**. Encoding (17,1/*frozen*/,1,3+32B authority for freeze; similar for attrs) produces working PermanentFreezeExecute per the 19/19 suite (real Core mints, real token moves *only* after open_for_redemption). If born unfrozen, tests would have failed. No post-mint frozen assertion is sloppy but does not mean the claim is true.

D6: **UPHELD**. Exactly as stated. BURN's own list + partial byte cross-check (only collection/bank) lets SEAL reserves be added without BURN update, bypassing declaration/checks. Burn succeeds while holding value; tokens trapped post-BurnV1. Header comment's reasoning is incorrect. (Canonical pattern is the root cause.)

(Word count: 1482)