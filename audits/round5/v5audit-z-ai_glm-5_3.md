[reasoning only]
Let me work through this carefully. I'm auditing three Solana programs. Round 5, prior rounds had false positives, so I need to be careful and only report things I can actually substantiate from the code.

Let me go through the hunt areas:

**(A) Cross-program economics.**

MINT program:
- `set_round`: governance signer, sets opens_at, closes_at, price_lamports, cap. round_id increments. minted_this_round reset to 0. minted_total never reset.
- Is the ~2,100 lifetime supply enforced anywhere? No. `minted_total` is counted but never checked against anything. There's no `require!(minted_total < MAX_SUPPLY)`. So the "2,100 lifetime" is purely off-chain. Governance can open rounds forever with cap=0 (uncapped). That's a real finding: the claimed supply cap is not enforced on-chain; a hostile governor majority can mint indefinitely. But is that "known and accepted"? The business says "Future mints will be at a fee and will be controlled by governor vote." So governance controlling mints is by design. But the ~2,100 total is a stated business invariant ("~2,100 vaults are intended to exist in total"). The code has `minted_total` with a comment saying "Never reset. `set_round` clears the per-round counter, so without this a governor could lift any cap by simply opening a new round." But minted_total is never USED in any require! It's dead. The comment implies it's a defense but it isn't wired to anything. So the comment claims something the code doesn't do — that's explicitly in the sweep list ("anything the code claims in a comment that it does not actually do"). Finding: MEDIUM/HIGH — no lifetime supply cap enforced; minted_total is write-only. Severity: for a business where scarcity underpins resale value, governance can inflate forever. Since governance is 1-vote-per-vault and top 3 hold 48%, a hostile majority can mint unlimited vaults at price 0 (price_lamports=0 is allowed! set_round has no minimum price check). Wait — price 0: `if cfg.price_lamports > 0` skips payment. So governance can set price to 0 and mint for free... but who receives? mint_vault requires bank co-sign. The Bank co-signs every mint. So free mints need Bank cooperation. Hmm, but the Bank is the Bank — if Bank and governance collude, they mint free vaults. But the Bank is a trusted party anyway (it co-signs everything). Actually wait — does mint_vault require the bank to sign? Yes: `require_keys_eq!(ctx.accounts.bank.key(), cfg.bank, MintError::NotTheBank)` and bank is a Signer. So every mint needs the Bank. So "mint for free" requires governance+Bank collusion. Still, the price=0 path is notable: governance alone can set price 0, and then the Bank's signature is the only gate. The Bank presumably refuses. But the point stands: no on-chain minimum.

More important: **who can call mint_vault, for whom, at what price?** Anyone can be `payer` and anyone can be `owner` (UncheckedAccount, not a signer). The payer pays price to treasury. Fine. Is there any link between paying and receiving? The payer pays, owner receives. That's fine for gifting.

**Payment ordering vs asset creation**: payment happens BEFORE the CreateV2 CPI. If CreateV2 fails, the whole tx reverts, so payment reverts too. Atomic. OK.

**Over/under-payment**: exact transfer of price_lamports. No refunds needed since exact. Over-payment impossible (transfer is exact amount). Under-payment impossible. OK.

**price = u64::MAX**: payer must have that many lamports; fine.

**closes_at = i64::MAX**: round never closes; governance can always set a new round anyway. Not a bug per se.

**cap = 0**: means uncapped (cap==0 || minted_this_round < cap). Documented? The require is `cfg.cap == 0 || cfg.minted_this_round < cfg.cap` — so cap 0 = unlimited. Combined with no minted_total check, governance can set an infinite round. Again governance-scoped.

**round_id overflow**: u32, checked_add, errors at 4 billion rounds. Fine.

**Clock manipulation**: Clock::get is the validator clock; can't be manipulated by users beyond validator consensus. Fine.

**Can admin (update_wiring) and governance (set_round) fight?** update_wiring can rotate `governance` — admin can swap the governance pubkey, neutralizing a hostile governance. Also admin can rotate treasury — redirecting the 85%. Who is admin? INIT_AUTHORITY, presumably multisig. update_wiring can also rotate `collection`! Wait — SEAL's update_config deliberately does NOT allow rotating collection ("collection is deliberately NOT rotatable"), but MINT's update_wiring DOES allow rotating collection: `if let Some(x) = collection { c.collection = x; }`. That's a divergence. If admin rotates MINT's collection, then mint_vault checks cfg.collection against seal_config's collection (bytes 40..72) — WiringDiverged would fire unless the seal config's collection also changed, which it can't (SEAL has no collection rotation). So rotating MINT's collection effectively bricks minting (every mint fails WiringDiverged) — a halt, not a theft. Actually wait, it also requires the collection's update authority to be the mint_authority PDA for CreateV2 to succeed, so a new collection would need its update authority set to the MINT program's PDA. But the seal-config cross-check would fail first. So admin rotating collection = permanent mint halt (until rotated back). That's a griefing/halt vector by admin. MEDIUM/LOW. Also note: the cross-check makes collection rotation in update_wiring useless-but-dangerous — the fix is to remove collection from update_wiring (matching SEAL's stance).

Also: **treasury redirect**: admin can rotate treasury via update_wiring, redirecting 100% of mint revenue (the 85% that's supposed to flow to vault holders via the treasury). The 85/15 split is entirely off-chain trust in admin. Is that a finding? The business says "Mint revenue is split 85% back to vault holders / 15% to the Bank. The 85% flows through the treasury account." On-chain, treasury is just a pubkey the admin can change unilaterally. So the 85% is not enforced. That's worth reporting as MEDIUM (economic trust assumption not encoded; admin can capture 100%). Given admin is presumably a multisig, but still — the audit asks "Who can redirect the treasury, and what does that cost the 85%?" Answer: admin alone, via update_wiring, costing the entire 85%.

**Worst thing a ratified vote can do**: set price to 0 (free mints for whoever the Bank allows), set cap 0 / infinite rounds (unlimited supply), set opens_at in the past and closes_at far future. Cannot touch plugins or existing vaults. Also cannot redirect treasury. So worst = supply inflation at zero price (with Bank co-sign) or DOS-ish pricing (set price astronomically high so no one mints — but that's just their prerogative). Also note governance can set price high and... no, treasury is fixed by admin.

Wait, one more: set_round has no check that the caller is... it does: `has_one = governance` on config and governance is Signer. OK.

**Is there ANY on-chain link between paying and receiving?** The payer pays treasury; owner receives the asset. The Bank co-signs. Fine.

Hmm, what about mint_vault's `asset: Signer<'info>` — the new asset keypair signs. Anyone can generate. Fine.

What about the mint_authority PDA — seeds [MINT_SEED], bump, derived from the MINT program. It signs CreateV2 as collection update authority. For this to work, the collection's update authority must be that PDA. The code doesn't verify the collection account is actually the right collection with the right update authority — it checks cfg.collection == passed collection, and seal_config cross-check. But does it verify the collection's update authority is the mint_authority? No — but CreateV2 would fail if not. OK.

**(B) Seal config canonical pattern — byte layout.**

SEAL Config struct: admin: Pubkey, collection: Pubkey, bank: Pubkey, reserve_mints: Vec<Pubkey>, bump: u8.

Anchor serialization: 8-byte discriminator, then admin (32), collection (32), bank (32), then Vec<Pubkey>: 4-byte length + 32*N, then bump u8.

So disc[0..8], admin[8..40], collection[40..72], bank[72..104]. That matches the comment. Good — the layout is right for THIS struct.

But: MINT and BURN read raw bytes with NO discriminator check! They check `seal_config.owner == SEAL_PROGRAM_ID` (the account is owned by the SEAL program) and the PDA derivation, and `d.len() >= 104`. They do NOT check the 8-byte Anchor discriminator equals Config's discriminator. Does that matter? The account is a PDA derived from SEAL_PROGRAM_ID with seed "config" — only the SEAL program can create accounts at that address (via init, which requires the PDA... wait, actually anyone can create an account at a PDA address? No — to allocate data at a PDA address you need the program to sign via invoke_signed with the seeds; a plain keypair can't be at that address because PDA addresses are off-curve... actually you CAN create an account whose address equals a PDA address only if you have the private key, and PDA addresses have no private key (they're off the ed25519 curve with overwhelming probability). So the account at ["config"] of SEAL_PROGRAM_ID can only be created by the SEAL program itself (or... hmm, actually anyone can call the SEAL program's initialize, but initialize requires INIT_AUTHORITY signature). So the account at that address, if it exists and is owned by SEAL_PROGRAM_ID, was created by SEAL's initialize. Its discriminator will be Config's. Unless... SEAL program is upgraded and the Config struct changes (field reorder/insert). Then old config account data stays as-is (upgrade doesn't rewrite data), but new writes... Actually the real risk: SEAL upgrade changes Config layout (e.g., inserts a field before collection). Then SEAL's own code reinterprets existing bytes, and MINT/BURN's fixed offsets read garbage. The finding: offset-based cross-program reads are fragile across upgrades; no discriminator/version check; recommend an explicit on-demand view instruction or a version byte. Severity: MEDIUM (requires SEAL upgrade authority action, which is a trusted party — but the whole point of the cross-check is to defend against divergence; the pattern itself is brittle). Also: what is NOT cross-checked: reserve_mints! MINT doesn't check reserve mints (doesn't need to). BURN checks its own reserve_mints against... wait, BURN reads seal_config but only cross-checks collection and bank — NOT reserve_mints. BURN's own config holds reserve_mints, and update_config in BURN can... it can't drop mints (ReserveMintDropped check requires new list contains all old). But BURN's reserve list could DIVERGE from SEAL's: e.g., SEAL adds mint X to its reserve list (update_config allows adding new mints — the contains check only prevents dropping), BURN never adds X. Then burn_vault doesn't check X's ATA... but burn requires lamports==0 on the PDA and the generic remaining-accounts sweep checks any declared token account owned by the PDA with amount>0 → VaultNotEmpty. Wait, the second loop: for each remaining account, if it's a token account owned by pda with amount > 0 → error. But that only covers DECLARED accounts (remaining_accounts). A non-ATA token account holding cbBTC that isn't declared is invisible — that's the known/accepted completeness gap (Bank's job). But an ATA for a reserve mint in SEAL's list but not BURN's list: the ATA address is derivable; if not passed in remaining_accounts, it's not checked. Hmm, but the caller chooses remaining_accounts. The Bank co-signs and is supposed to alarm. The known-accepted list says "non-ATA completeness is the Bank's job" — but this is an ATA completeness gap caused by config divergence. Actually wait: can BURN's reserve list diverge from SEAL's? Both are admin-controlled. SEAL admin adds cbBTC-2 to reserve_mints; BURN admin doesn't. Now burn_vault doesn't require the cbBTC-2 ATA to be declared/empty. If the vault holds cbBTC-2 in its ATA... but who would put cbBTC-2 in the vault? The vault contents are deposited by... hmm, how do contents get in? Activation is off-chain: someone transfers cbBTC to the asset-signer PDA's ATA. If a "future reserve mint" is added to SEAL but not BURN, a vault could hold that token and still burn. But the Bank co-signs every burn and must alarm. And the cross-check comment in BURN says "a trimmed reserve list — this becomes a destroy-BTC path" — but the cross-check does NOT actually compare reserve lists! The comment claims it defends against "a trimmed reserve list" but the code only compares collection and bank. That's a comment-vs-code mismatch: BURN's comment says the seal-config check protects against "a different collection, a different bank, a trimmed reserve list" but reserve_mints is not cross-checked. FINDING: the reserve_mints divergence the comment claims to prevent is not prevented. Severity: MEDIUM. Fix: also compare reserve list bytes (offset 104..) or better, have BURN read reserve_mints from the SEAL config directly instead of keeping its own copy.

Wait, actually, let me double check: could BURN just use SEAL's reserve list? The bytes at [104..] are 4-byte vec len + mints. BURN could parse them. It doesn't. So BURN keeps its own list, which can diverge by addition (SEAL adds, BURN doesn't) — divergence by omission in BURN. Can BURN's list be a superset? Yes (BURN adds a mint SEAL doesn't have) — that just makes burn stricter, harmless. The dangerous direction is BURN missing a mint that SEAL has. And update_config in BURN can't drop, but can fail to add. So yes, real.

Also MINT: reads seal config, checks collection and bank. MINT doesn't hold reserve_mints at all, fine.

What about `SEAL_PROGRAM_ID` compile-time constant: if SEAL is redeployed at a new address (program can't be redeployed at a new address with same ID — a new deployment means new program ID), MINT/BURN would derive the seal config PDA from the OLD address and read a stale/nonexistent account. If the old SEAL program's config account still exists (it would, unless closed), MINT would keep reading the old config — which no longer controls anything. New vaults would be minted with seal PDA derived from... wait, MINT derives seal_pda from SEAL_PROGRAM_ID (old address) for the plugin authority. If SEAL moves to a new address, the plugin authority embedded in new vaults points at the OLD program's PDA — the new SEAL program can't sign for it (PDA is derived from old program ID; only the old program can produce that signature). So vaults minted after a SEAL migration would be permanently frozen with no one able to unseal. That's the exact "born permanently frozen" scenario the MINT comments warn about for stale constants — but it recurs via SEAL_PROGRAM_ID if SEAL is ever redeployed at a new address. Severity: LOW/MEDIUM (operational; requires SEAL migration, which is a big deal anyway). Worth one line.

Also: is reading the config "read-only and unsigned" — does it prove anything the caller couldn't fake? The account is owned by SEAL_PROGRAM_ID at the canonical PDA, so it's genuine SEAL state. Caller can't fake it (can't create accounts at that PDA). OK, the check is sound for what it checks.

What about SEAL config being closed and re-created? There's no close instruction in SEAL. Config can't be closed. But if SEAL program itself is upgraded to a version with a close... speculative. Skip.

One more on (B): MINT's `seal_config` is `UncheckedAccount` — validated in-handler via PDA derivation + owner check. Fine. But no discriminator check — if SEAL upgrades and changes Config to a different struct (same owner, same address), the discriminator changes but MINT doesn't check it, so it'd read garbage bytes as collection/bank → WiringDiverged errors (fail-closed, mint halts) or, worse, if the new layout happens to place attacker-influenced data at 40..104... but only SEAL's initialize/update_config write there, gated by INIT_AUTHORITY/admin. So garbage reads → halt, not theft. Fail-closed. Mention as part of the fragility finding.

**(C) Attributes provenance stamp.**

mark_opened builds UpdatePluginV1 for Plugin::Attributes with attribute_list of exactly ONE pair {"redemption":"opened"}.

Key question: what does Core's UpdatePluginV1(Attributes) do to existing attributes? In Metaplex Core, the Attributes plugin's UpdatePlugin... Let me think. Plugin::Attributes { attribute_list: Vec<Attribute> }. UpdatePluginV1 with Attributes REPLACES the entire attribute list with the provided one. Yes — UpdatePlugin replaces the plugin data wholesale. So calling mark_opened with a single-pair list REPLACES the charter provenance attributes (Notice serial, Governor standing) with just {"redemption":"opened"}. The charter provenance — "the ONLY surviving record that a holder was a charter member" — is DESTROYED on first redemption. The business says charter provenance is stamped at mint and is the only surviving record after PoB token and Notice are destroyed. So the first time a charter member redeems, their charter status is erased on-chain. Is that intended? The business framing: "Charter provenance ... is intended to be stamped onto the vault at mint and to be the ONLY surviving record that a holder was a charter member." If close_redemption wipes it, charter members lose their provenance upon redemption. That's a data-destruction bug relative to the stated business. Severity: HIGH? It's loss of provenance record, not funds. For a business where charter status has value (governance standing? future perks?), destroying it on redemption is significant. And it's clearly unintended: the code comment says the stamp makes opened vaults "visibly no longer pristine" — it doesn't say "and wipes everything else." The fix: read existing attributes and append, or use a separate plugin/name field, or include the full list. But on-chain the program can't easily read the current attribute list... actually it can: the asset account data contains plugin data; parsing it is possible but hairy. Alternative: use EditPluginV1 (attribute update) — Core has UpdatePlugin (replace whole plugin) vs... Actually for Attributes there's also the ability via UpdatePlugin only. Hmm, Metaplex Core has "UpdatePlugin" which replaces plugin data, and "EditPlugin" (v1?) which edits individual attributes? Let me recall: Core has `UpdatePluginV1` (replaces plugin) and... there's `UpdateAssetV1` for name/uri. For attributes specifically, I believe there's only UpdatePluginV1 which replaces the whole list. Actually, in mpl-core there IS an "EditPluginV1"? Hmm. There's `UpdatePluginV1` and `UpdateAssetV1`. I recall Core added `UpdateCollectionV1`, `UpdatePluginV1`... I don't think there's a per-attribute edit. So the fix is to include the existing attributes in the replacement list (requires reading them from asset data) or accept the wipe. Report as HIGH (business-critical data destroyed) — actually severity: it destroys the only surviving charter record, which the business explicitly depends on. I'd say HIGH.

Wait — but who writes the charter provenance at mint? MINT's mint_vault creates the asset with `PLUGIN_ATTRIBUTES` and `attribute_list` length 0 (`data.extend_from_slice(&0u32.to_le_bytes())` — zero attributes at mint!). Look: in mint_vault's CreateV2 data: `data.push(PLUGIN_ATTRIBUTES); data.extend_from_slice(&0u32.to_le_bytes());` — the Attributes plugin is created with an EMPTY attribute list. So charter provenance is NOT stamped at mint by this code! The business says "Charter provenance (a Notice serial, Governor standing) is intended to be stamped onto the vault at mint" — but mint_vault takes only name and uri, and creates Attributes with 0 entries. So where does provenance get stamped? Maybe off-chain via the collection update authority (mint_authority PDA can only be used via the MINT program... the MINT program has no instruction to update attributes). The collection's update authority is the MINT PDA, so nobody else can UpdatePlugin on assets? Wait — for asset-level plugins, UpdatePlugin authority is the plugin's authority (the seal PDA for Attributes) OR... In Core, UpdatePluginV1 requires the plugin's update authority. The Attributes plugin was created with authority = seal PDA (PluginAuthority::Address(seal_pda)). So only the seal PDA (i.e., the SEAL program) can update attributes. And the only SEAL instruction that touches attributes is mark_opened, which writes exactly one pair. So: (1) charter provenance is NEVER stamped on-chain by any of these three programs — the "mint requirements documented but unenforced" fix note said "mint requirements documented but unenforced" was fixed... hmm, "ALREADY FIXED: mint requirements documented but unenforced" — maybe that referred to something else. But as the code stands: mint_vault creates Attributes with an empty list, and no program instruction ever writes charter provenance. So the business's "stamped at mint" is not implemented. Unless the Bank or someone else can write it — they can't; the plugin authority is the seal PDA, and the SEAL program only ever writes {"redemption":"opened"}. So charter provenance does not exist on-chain at all. FINDING (HIGH): the only surviving charter record the business depends on is never written; and the first redemption replaces whatever attributes exist with a single pair. Combined: provenance system is absent + destructive.

Hmm wait, let me re-read the CreateV2 data construction to be sure about the attribute list length:

```
data.push(1); // ? 
data.extend_from_slice(&2u32.to_le_bytes()); // 2 plugins
data.push(PLUGIN_PERMANENT_FREEZE_EXECUTE);
data.push(1); // frozen
data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref());
data.push(PLUGIN_ATTRIBUTES);
data.extend_from_slice(&0u32.to_le_bytes()); // attribute_list len = 0
data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend_from_slice(seal_pda.as_ref());
data.push(1); data.extend_from_slice(&0u32.to_le_bytes()); // ?
```

Hmm, the structure: CreateV2 args include name, uri, plugins: Option<Vec<Plugin>>. The `data.push(1)` after uri is probably the Option::Some discriminator for plugins, then vec len 2. Each Plugin is { plugin_header: { version, authority: Option<PluginAuthority> }? ... }. Actually Plugin serialization: Plugin::Attributes(Attributes { attribute_list }) — the plugin union: 1 byte plugin type? Hmm, in Core's CreateV2, plugins are serialized as Vec<Plugin> where Plugin is an enum with a 1-byte... Actually I recall Plugin serialization in Core args is borsh: enum variant index (u8?) then the struct. The header (version + authority) is part of... hmm. The pattern `data.push(PLUGIN_PERMANENT_FREEZE_EXECUTE); data.push(1); data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend(seal_pda)` — for PermanentFreezeExecute, the plugin has no fields, so: variant byte, then plugin header: version u8 =1? then authority Option: 1 = Some, then PluginAuthority enum variant 3 = Address, then 32 bytes. Then for Attributes: variant byte, then header version=1? wait no — `data.push(PLUGIN_ATTRIBUTES); data.extend_from_slice(&0u32.to_le_bytes());` — hmm, that's variant byte then attribute_list len 0, then `data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend(seal_pda)` — that would be... hmm, that ordering is odd: for PermanentFreezeExecute it's variant, 1, 1, 3, pubkey; for Attributes it's variant, 0u32, 1, 3, pubkey. 

Hmm wait, maybe the Plugin serialization is: variant u8, then the plugin struct fields, then... no. Let me think about Core's actual Plugin borsh: In mpl-core, `Plugin` is an enum; each variant wraps a struct. The CreateV2 args `plugins: Option<Vec<Plugin>>`. PluginHeader { version: u8, authority: Option<PluginAuthority> }? No wait — in CreateV2, plugins are passed as `Vec<Plugin>` where Plugin includes the header? Actually I recall: `PluginPair { plugin: Plugin, init_authority: Option<PluginAuthority> }`? Hmm, in newer Core versions, CreateV2 takes `plugins: Option<Vec<PluginPair>>` where PluginPair { plugin: Plugin, init_authority: Option<PluginAuthority> }? Hmm, no...

Actually the test suite passes 19/19 on a real validator with real Core, minting real vaults — so the wire format works. I shouldn't nitpick the exact serialization; the attribute list length 0 is what matters: `&0u32.to_le_bytes()` right after PLUGIN_ATTRIBUTES. If the format is variant, then plugin struct (attribute_list: Vec<Attribute> → len 0), then... but then where's the header for Attributes? The `data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend(seal_pda)` after would be the init authority? Hmm, for PermanentFreezeExecute: variant(17), then `data.push(1)` — PermanentFreezeExecute struct has one field `frozen: bool` = 1. Then `data.push(1)` = Option Some, `PLUGIN_AUTHORITY_ADDRESS` = PluginAuthority::Address variant 3, pubkey. So the pattern is: variant, plugin-struct-fields, Option<PluginAuthority> (1=Some, variant, pubkey). For Attributes: variant(6), attribute_list len 0 (empty struct fields), then Option Some, Address, seal_pda. Then `data.push(1); data.extend_from_slice(&0u32.to_le_bytes())` — hmm, that trailing `1` + `0u32`... maybe that's `external_plugin_adapters` or something? Or maybe plugins vec is followed by... Actually CreateV2 args: name, uri, plugins: Option<Vec<Plugin>>, external_plugin_adapters: Option<Vec<...>>? The trailing `1, 0u32` might be... hmm. Whatever — it works on a validator per the prompt. Not my concern.

So: Attributes created with EMPTY list. Charter provenance never written on-chain. Confirmed finding.

Now: is the stamp monotonic? Can it be removed/reset/forged? The Attributes plugin authority is the seal PDA. Only SEAL (via mark_opened) can update it. mark_opened writes {"redemption":"opened"} — always the same value. So it's monotonic in the sense that once written, only SEAL can change it, and SEAL only writes "opened". Can a seller launder a drained vault? They can't remove the stamp (no instruction does). BUT — here's the thing: can the owner + Bank re-stamp a pristine vault to look opened? Yes (open then close with nothing taken) — that's the "opened once ≠ drained" question. The stamp says "opened", not "drained". A buyer seeing "redemption: opened" knows it was opened at least once — but the vault could have been opened, fully drained, closed (re-sealed with 0 BTC), and resold. The stamp doesn't distinguish "opened and drained" from "opened and intact". So as an anti-resale-fraud signal it's weak but honest — it's a necessary-not-sufficient signal. The prompt asks: "Is 'opened once' even the right signal for a buyer, given the owner may open, take nothing, and close?" — the inverse: opened+drained looks identical to opened+intact. The stamp can only understate risk (pristine = never opened = definitely intact... wait, is pristine = intact? Can value leave WITHOUT open? Burn requires owner+Bank and requires empty. Transfer doesn't move contents. Delegate approval during a thaw window — blocked at close by inspect_reserves... but wait, inspect_reserves only checks ATAs for the configured reserve mints. A delegate on a NON-ATA token account (created during the thaw window by the owner+Bank tx... but Bank refuses those txs per its off-chain duty). Hmm, and a delegate on an ATA of a NON-reserve mint (some random token airdropped)? inspect_reserves only iterates config.reserve_mints. So a delegate on a random-mint token account owned by the PDA survives the re-seal. But that account holds a random token, not cbBTC — unless reserve_mints is incomplete. cbBTC is in reserve_mints presumably. OK.

So pristine (no stamp) ⇒ never opened ⇒ PermanentFreezeExecute was never lifted ⇒ contents never moved (except... burn? burn_vault doesn't require the freeze to be lifted — BurnV1 by owner... wait, does PermanentFreezeExecute block BurnV1? The known-accepted list says a bare Core BurnV1 by the owner cannot be prevented. Hmm — but burn_vault (the program) requires empty reserves. A raw BurnV1 CPI... the owner can call Core BurnV1 directly (not via the program) — does the freeze plugin block it? Known/accepted: "A bare Core BurnV1 by the owner cannot be prevented while the vault stays freely transferable." Wait, that says it cannot be prevented — meaning the owner CAN burn the NFT directly?? But then the asset-signer PDA... when an asset is burned, Core... hmm, does burning the asset close the asset-signer PDA? If the owner can bare-burn a FULL vault, the BTC is stuck (PDA can never sign again — actually the PDA still exists? When a Core asset is burned, Core closes the asset account; the asset-signer PDA... I think Core's Burn closes the asset and the asset signer? If the asset-signer PDA is closed, its lamports go to... and token accounts owned by it become permanently frozen. So bare BurnV1 on a full vault = destroy access to BTC. That's known/accepted per the prompt ("cannot be prevented"). OK, not re-reporting unless reasoning wrong. The reasoning seems right: PermanentFreezeExecute gates Execute only; BurnV1 checks... actually does Core's BurnV1 check freeze plugins? I believe PermanentFreezeDelegate blocks burn; PermanentFreezeExecute doesn't. Fine, accepted.

So pristine ⇒ intact (modulo bare-burn which destroys rather than extracts). Opened ⇒ unknown. The stamp is honest but weak. The REAL problem is (1) it wipes other attributes, (2) provenance never stamped at mint.

Also: "Is the stamp SET on every path that can remove value?" Paths that remove value: (a) open/close redemption — stamped ✓. (b) burn_vault — destroys the asset entirely, no stamp needed (asset gone). (c) bare BurnV1 by owner — asset gone. (d) delegate approved during thaw and exercised after re-seal — blocked by inspect_reserves for reserve mints at close. But wait — what about a delegate approved during the thaw window on an ATA of a reserve mint, where the close's inspect_reserves checks... it checks d[72..76] == 0 (delegate COption tag) and d[121..129] delegated_amount == 0. If a delegate was approved and then REVOKED before close, fine. If still approved → error. OK. But what about transfer during thaw of the whole ATA contents — that's the point of redemption, fine, and the stamp records it.

(e) What about value leaving via a CPI inside the SAME tx as open, where close never happens? open_for_redemption REQUIRES a matching close in the same tx (scans forward). So no thaw-without-close... unless the introspection can be fooled. Let me scrutinize the introspection:

open_for_redemption scans instructions AFTER current index for CloseRedemption discriminator with program_id == crate::ID, accounts[0] == asset, accounts[2] == owner. Note: it checks `ix.accounts.get(2).map(|a| a.pubkey) == Some(owner)` — account 2 of CloseRedemption is `owner` (vault_asset=0, collection=1, owner=2). ✓.

Can an attacker satisfy the scan with a close that then FAILS or is conditional? The close must actually execute for the tx to succeed... no wait — the close just needs to be PRESENT in the tx for open to pass. If the close instruction fails, the whole tx fails. So the close must succeed. But here's a subtlety: the scan looks at the instruction list of the CURRENT transaction only. CPIs don't appear in the instructions sysvar (only top-level instructions of the current tx... actually the instructions sysvar contains the current transaction's static instruction list, and during CPI, load_instruction_at reflects... the sysvar contains the message's instructions; CPI'd instructions are NOT in it. Right — Instructions sysvar = top-level tx instructions only). So the close must be a top-level instruction. Fine.

Duplicate/edge: attacker includes a CloseRedemption for the asset with owner X (accounts[2]=X) where X is a signer... close requires owner signer matching asset owner. So the close is real. What if the attacker puts a close instruction that references the asset but with a DIFFERENT owner (accounts[2] = someone else)? Then open's scan requires accounts[2] == owner (the open's owner signer, who must be the asset owner). So they match. OK.

What about ordering: open at index i, close at index j>i. Between them, the attacker's sweep instructions. Close re-seals. Fine — that's the design.

Can the attacker do: open (index 0), sweep, close (index 2) — but ALSO a second open at index 3 with no close? Second open would fail (no close after). What about open at 0, close at 2, then MORE sweep instructions at 3+ AFTER the re-seal? After re-seal, PermanentFreezeExecute is frozen again, so Execute CPIs fail. But non-Execute moves? Token transfers FROM the PDA's token accounts require the PDA's signature (via Execute) or a delegate. Delegate approved during thaw → close's inspect_reserves catches it (for reserve mints). Delegate on non-reserve-mint accounts → survives, but that's non-reserve tokens. Hmm — wait, actually there's a subtle one: what if the sweep at index 3+ is a Token transfer authorized by a delegate approved BEFORE this tx (in an earlier thaw window)? Then close at index 2 would have caught it (delegate check). OK.

What about: open at 0, close at 2, and the attacker's instructions at 3+ include ANOTHER close (no open)? close requires a preceding open — found (index 0). Second close re-seals again and re-stamps. Harmless.

What about ALTs (address lookup tables)? load_instruction_at_checked returns the resolved instruction (with resolved account pubkeys)? Hmm — actually, the Instructions sysvar stores instructions with pubkeys RESOLVED? Let me think. The instructions sysvar contains the transaction's instructions with account pubkeys... For versioned transactions with ALTs, the instructions sysvar entries contain the RESOLVED pubkeys? I believe yes — the sysvar provides resolved pubkeys (the runtime resolves ALT addresses before execution and the sysvar reflects resolved keys). Actually, I recall that the Instructions sysvar does contain resolved addresses. Hmm, is that true? There was a known issue: instructions sysvar + ALTs — the sysvar returns instructions with resolved account keys. Yes, I'm fairly confident the runtime resolves ALTs and the sysvar shows resolved pubkeys. OK, so ALTs don't break the matching.

What about the close's preceding-open scan: `for i in 0..current` — scans ALL prior instructions, not just... fine.

One more introspection edge: open's forward scan uses `while let Ok(ix) = load_instruction_at_checked(i, ...)` — stops at first error (end of list). Fine.

Now — the BIG one I should check: **does close_redemption verify the asset is currently FROZEN / that open actually thawed it?** Scenario: owner + Bank call close_redemption WITHOUT a real open... no wait, close requires a preceding open in the same tx. And open thaws. So close always follows a real thaw. But: open thaws, then between open and close, could the asset be TRANSFERRED to a new owner? Transfer of a Core asset with PermanentFreezeExecute... does freeze-execute block Transfer? PermanentFreezeExecute gates Execute only. TransferV1 requires owner signature. The owner (signer) could transfer the asset mid-tx to someone else. Then close's owner check: close requires `asset_owner == ctx.accounts.owner.key()` — the owner signer must be the CURRENT owner. If transferred mid-tx, the original owner's close fails (NotTheOwner) unless the new owner also signs... The new owner would need to be a signer of close. But open's forward-scan matched close with accounts[2] == open's owner. If the asset was transferred to NewOwner, close's owner check requires NewOwner to sign, but the scan requires accounts[2] == original owner. Contradiction → tx fails. Unless original owner == new owner (self-transfer, pointless). OK.

What about mid-tx transfer AFTER close? Asset re-sealed, transferred — fine, contents safe.

Hmm, what about this: open at index 0 (owner O, thawed), sweep, then at index k the attacker TRANSFERS the asset to NewOwner, then close at index m with owner = NewOwner signing? Open's scan requires close.accounts[2] == O. NewOwner ≠ O → not found → open fails. So no.

What about TWO vaults in one tx: open(A), open(B), close(A), close(B). Fine.

open(A), close(A), open(B), close(B). Fine.

open(A), open(A) again? Second open: scan forward for close — finds close(A) at index 2 (accounts[0]=A, accounts[2]=owner). Passes! So open(A) can be called TWICE in one tx with only ONE close. Both opens thaw (second is a no-op freeze-wise — set_frozen(false) twice). Then close(A) re-seals. Net: still ends frozen. Fine. What about open(A), close(A), open(A)? Third instruction open(A): scan forward — no close after → fails. OK.

What about open(A) at 0, close(A) at 5, and instructions 1-4 include... another close(A) at 2? close at 2: preceding open found (index 0) ✓, re-seals, stamps. Then instructions 3-4: sweeps — but asset is FROZEN now (re-sealed at 2). Execute fails. Then close(A) at 5: preceding open (index 0) found ✓ — re-seals again (already frozen), stamps again. Ends frozen. OK.

Hmm, what about: open(A) at 0. Instructions 1-3: sweep via Execute (thawed). Instruction 4: close(A) — re-seals. Instruction 5: open(A) again — scan forward: no close after 5 → FAILS. Good.

What about open(A) at 0, close(A) at 10, and at 5 a CPI-based... CPIs can't thaw (only SEAL's seal PDA can sign UpdatePlugin for the freeze plugin, and only via SEAL program instructions, which are top-level... wait, could another program CPI into SEAL? CPI into SEAL's open_for_redemption — Anchor instructions can be CPI'd. If program X CPIs open_for_redemption, the instructions sysvar... the sysvar reflects TOP-LEVEL instructions only. So a CPI'd open would scan the top-level list for a close. Hmm, interesting: a malicious program X could CPI open_for_redemption (providing owner+Bank signers — CPI signers must be actual signers of the tx or PDAs of X... owner and bank are Signer<'info> in the Accounts struct; via CPI, X must pass them as signed, meaning the tx itself must have owner and bank as signers, or X signs with its own PDA... no — Signer requires the account to have signed; in CPI, the signer bit is set if the account signed at the CPI level, which requires X to be a PDA signer or the tx signer. So owner/bank must be tx signers anyway). The scan would look for a top-level close. If present, the CPI'd open thaws. But then the top-level close would also execute and re-seal... unless the top-level close FAILS? No — if any instruction fails, tx fails. Unless the close is positioned AFTER... hmm, wait: what if the top-level close instruction is for a DIFFERENT purpose and succeeds, and the CPI'd open happens in an instruction AFTER the close? Order: top-level ix 0 = close(A) — needs preceding open — fails. Hmm.

What about: top-level ix 0 = X's instruction which CPIs open(A) (thaw), then ix 1 = sweep, then ix 2 = close(A). The CPI'd open at ix 0 scans forward: finds close(A) at ix 2 (top-level, in sysvar) ✓. Thaws. Sweep at 1. Close at 2 re-seals. Same as direct. No gain.

What about: ix 0 = close(A)?? needs preceding open — none. Fails.

Trickier: ix 0 = open(A) [thaw], ix 1 = X's program: CPIs close(A)?? close's preceding-open scan looks at instructions 0..current — current during a CPI is the TOP-LEVEL current index (ix 1). load_current_index_checked returns the current top-level instruction index. So scan 0..1 includes ix 0 = open ✓. CPI'd close re-seals. Then ix 2 = sweep — frozen, fails. Hmm.

What about ix 0 = open(A), ix 1 = sweep, ix 2 = X's program that CPIs close(A) (re-seal), ix 3 = sweep (fails, frozen). No.

The invariant "ends thawed" — is there ANY path? The close always re-seals via set_frozen(true). The only way to end thawed: open succeeds, close never executes. Open requires a close LATER in the tx. If the tx succeeds, all instructions executed, including the close. So the tx ends frozen... UNLESS the close instruction matched by the scan is for the same asset+owner but is a DIFFERENT instruction that shares the discriminator... The discriminator is 8 bytes of close_redemption. Could an attacker craft a transaction where the "close" found by the scan is actually... it must be a SEAL-program instruction with close's discriminator, accounts[0]=asset, accounts[2]=owner. That IS a close_redemption instruction. It will execute and re-seal (or fail). So the invariant holds. 

Wait — one more: what if the close instruction appears in the tx but is NEVER EXECUTED because it's inside a... no, all top-level instructions execute. What about duplicate instruction via CPI — the sysvar only has top-level. OK.

What about `load_current_index_checked` during CPI — returns the top-level index. Yes.

Hmm, but here's a subtle one: open's forward scan matches `ix.accounts.first() == asset && ix.accounts.get(2) == owner`. What if the attacker crafts a close_redemption instruction with accounts[0] = asset, accounts[2] = owner, but with a DIFFERENT config account (accounts[7])? close validates config via seeds [CONFIG_SEED] — Anchor constraint, must be the real config. And bank must match config.bank. So no.

What if the close's `vault_asset` account is the asset but the close FAILS its checks... then tx fails. OK, I'm fairly convinced the open/close pairing is sound.

Now — **inspect_reserves in close**: it checks ATAs for reserve mints. But WAIT: does close_redemption check that the asset_signer PDA's lamports... no, close never burns, fine. Does close check nested vaults? The error VaultStillHoldsAVault exists in SEAL but is never used in close! In v4 SEAL, close_redemption doesn't check nested vaults (the "nested-vault guard opt-in" fix note — "nested-vault guard opt-in" was fixed... in BURN there's the KEY_ASSET_V1 check on remaining accounts. In SEAL's close, inspect_reserves doesn't check for nested Core assets. Hmm, "ALREADY FIXED: nested-vault guard opt-in" — presumably meaning mint refuses... or burn checks. In SEAL close, a nested vault (asset-signer PDA owns another Core asset) — during thaw, the inner vault could be... the inner asset is owned by the PDA; to move it you'd need Execute on the inner asset requiring the PDA (as owner) to sign — Execute requires the OWNER's signature; the owner is the PDA, which signs via Execute of the OUTER asset... wait no. The inner asset's owner is the outer asset-signer PDA. To transfer/burn the inner asset, Core requires the owner (the PDA) to sign — the PDA signs via the OUTER asset's ExecuteV1 (the PDA is the outer asset's signer and can sign arbitrary CPIs when the outer owner authorizes Execute). So during a thaw of the outer vault, the PDA can transfer the inner vault out. That's just... redemption of a nested vault. The nested-vault guard was about BURN refusing to burn a vault containing another vault. In SEAL's close, no nested check — but close doesn't destroy anything. Fine.

Now **BURN program deep dive**:

burn_vault checks:
- bank signer == cfg.bank ✓
- asset is Core AssetV1, owner == owner signer, collection == cfg.collection == passed collection ✓
- seal_config cross-check (collection, bank) ✓
- asset_signer.lamports() == 0 — hmm! The PDA must have ZERO lamports. But wait — the asset-signer PDA... when Core creates an asset, does the asset-signer PDA hold lamports? The asset-signer PDA ["mpl-core-execute", asset] — I don't think Core funds it at creation. It's a pure PDA that only exists as a signer. Actually, does the PDA account even EXIST on chain? For invoke_signed, the PDA doesn't need an account... but the Accounts struct declares `#[account(mut, seeds = [...])]` asset_signer — Anchor requires the account to exist? With `mut` and seeds but no init, Anchor just checks the PDA derivation; the account may not exist (zero lamports, no data). If it doesn't exist, lamports == 0 ✓. If someone SENDS lamports to the PDA address (anyone can transfer SOL to any address), then lamports > 0 → burn fails → griefing: anyone can make a vault unburnable by sending 1 lamport to its asset-signer PDA. Hmm — but is that a real grief? The vault presumably holds no BTC at burn time (it's empty), so being unburnable is a minor nuisance — the vault is worthless anyway. And the "1-lamport ATA griefing" was listed as already fixed (that was about token accounts). The PDA-lamports grief: burn requires lamports==0; a troll sends 1 lamport; burn permanently fails. The owner can't remove the lamports (closing the PDA account requires the PDA to sign — via Execute, which requires... Execute on the burned... the asset still exists, owner+Bank could open (thaw), Execute a close_account System instruction? During thaw, the PDA can sign arbitrary CPIs — including SystemTransfer of its lamports out or closing itself? A PDA can close itself via... the system program doesn't have close; you'd transfer all lamports out which garbage-collects the account. So owner+Bank CAN clear stray lamports during a redemption thaw. OK so it's recoverable with Bank cooperation. Minor. LOW at most. Actually wait — can they? open_for_redemption requires... yes owner+Bank. Then Execute with a system transfer of the PDA's lamports to the owner. Then close re-seals. Then burn works. So recoverable. Not a finding worth much. Maybe skip or one line.

- remaining_accounts.len() == declared ✓ (declared is u8 — max 255 accounts; reserve mints up to 8 × 2 token programs = 16 ATAs needed; fine)
- For each reserve mint × both token programs: ATA must be DECLARED (present in remaining_accounts) — note: `ok_or(ReserveNotDeclared)` — the ATA must be passed. If the ATA doesn't exist on chain, the caller still must pass SOME account at that address (a non-existent account can be passed? In Solana, you can't pass a non-existent account unless... you CAN pass an account with zero lamports? No — transactions require all accounts to exist... actually accounts with 0 lamports and no data don't exist and CAN be passed? No — Solana txs fail on non-existent accounts? Hmm, actually you CAN include non-existent accounts in a transaction? No, you cannot — the runtime errors "account not found"? Actually, Solana allows instructions to reference accounts that don't exist? Let me think... No: every account referenced in a transaction message must exist at execution... hmm, actually I believe accounts must exist (have lamports) OR be created in the tx. Wait, no — you CAN pass a non-existent account? I recall that the runtime checks... Actually, in Solana, an account that doesn't exist can be passed and appears with 0 lamports and no data — no wait. Hmm. I believe transactions fail with "Instruction references an unknown account" if... no, that's for... Hmm. Actually I'm quite sure you CAN pass non-existent accounts — e.g., CPI to a program that doesn't exist fails, but passing a non-existent account as a non-signer... Let me recall: `AccountInfo` for a non-existent account has 0 lamports, empty data, owner = system. The runtime allows instructions to include accounts not on chain? I believe YES — accounts not found are treated as... no wait. Hmm, in practice, creating an account requires passing the account BEFORE creation with... no, `create_account` takes the new account key which doesn't exist yet, and it's passed in the instruction. So YES, non-existent accounts CAN be passed (that's how account creation works — the key is passed before the account exists). The runtime treats them as empty/lamport-0/system-owned. OK so for a non-existent ATA: acc.owner == system program → `continue` (skipped). Good — that's the 1-lamport grief fix: an account at the ATA address owned by system (or anyone) is skipped. But wait — if someone sends 1 lamport to the ATA address (account doesn't exist, lamports arrive — an account with lamports but no data is owned by SYSTEM and has 0 data). Then acc.owner == system → continue ✓. If someone creates a FAKE token account at the ATA address? They can't — the address is a PDA of the ATA program; to create an account there you'd need the ATA program to do it (or fund it — funding gives system ownership). Can the ATA program create an account at that address owned by the Token program with attacker-chosen data? The ATA program creates real ATAs — get_associated_token_address derivations with the PDA as owner. An attacker could invoke ATA create for (owner=PDA, mint=X) — creating a REAL ATA owned by the PDA for mint X. That's fine — it's a real token account, checked properly. Could an attacker create an account at the ATA address with the TOKEN program as owner but fake data? Only via the Token program's initialize_account at that address — requires the address to sign (it's a PDA of the ATA program, not the Token program) — no. OK.

- The generic second loop: for each remaining account: if owned by MPL_CORE_ID → must not be a live asset (KEY_ASSET_V1 check) — nested vault guard ✓. If lamports==0 → continue. If not token-program-owned → continue. If token account owned by PDA with amount>0 → VaultNotEmpty. Note: this second loop only sees DECLARED accounts. So its "completeness" is illusory — it only double-checks accounts the caller chose to pass. The real completeness gap is known/accepted (Bank's job). But note the second loop does NOT check delegate/close-authority on non-reserve token accounts — a non-reserve token account with a delegate and nonzero amount → VaultNotEmpty fires (amount>0). With ZERO amount + delegate → passes. Delegate on an empty account is harmless. OK.

Hmm wait, actually there's something in the second loop: `if acc.owner == &MPL_CORE_ID { ... require!(d.is_empty() || d[0] != KEY_ASSET_V1 ...) }` — a Core asset account that's been burned/closed would have... closed accounts have 0 lamports and no data → d.is_empty() ✓. A LIVE nested asset → d[0]==1 → error ✓. But what about a Core COLLECTION account owned by MPL_CORE_ID? d[0] would be KEY_COLLECTION_V1 (2?) → passes the check (d[0] != 1) ✓ fine.

- Then BurnV1 CPI: accounts [asset, collection, payer, owner, MPL_CORE (twice — one is the "extra" account?)]. BurnV1 in Core: asset, collection, authority(owner), payer... The invoke passes owner as signer — owner IS a tx signer ✓. BurnV1 requires the asset's owner signature ✓. Does BurnV1 need the freeze lifted? PermanentFreezeExecute — does Core's Burn check it? Per the known-accepted note, a bare BurnV1 by the owner works even when frozen (that's the accepted risk). So the program's burn works on a frozen vault ✓ (consistent with tests passing).

Wait — actually, hold on. If bare BurnV1 by the owner always works (accepted), then the owner can burn a FULL vault directly against Core, bypassing burn_vault entirely. The BTC in the PDA's token accounts becomes stranded (PDA can still sign via Execute? NO — once the asset is burned, ExecuteV1 requires the asset to exist. Burned asset → no Execute → PDA can never sign → token accounts permanently frozen). So the accepted risk is "owner can destroy their own BTC access." Known/accepted. Moving on.

Now — **does burn_vault check the asset is not currently THAWED?** Scenario: tx = [burn_vault]. The vault is frozen (normal). BurnV1 works on frozen vaults (accepted). Fine. What about tx = [open(A), sweep BTC out, burn_vault(A)]? burn_vault requires reserves empty — after sweeping, ATAs are empty ✓, PDA lamports 0 ✓ (swept). So owner+Bank can redeem AND burn in one tx. That's... fine? It's a full redemption + burn. The Bank co-signs both. OK.

Hmm, what about burn_vault WITHOUT the Bank... no, bank signs. OK.

**BURN's asset_signer account constraint**: `#[account(mut, seeds = [EXECUTE_PREFIX, vault_asset.key()], bump, seeds::program = MPL_CORE_ID)]` — Anchor checks the PDA derivation. But does Anchor require the account to EXIST? For `seeds` constraints without init, Anchor just verifies the derivation; the account can be non-existent (passed as empty). If non-existent, lamports()==0 ✓. OK.

Wait, actually — Anchor's seeds constraint on an UncheckedAccount... Anchor checks `to_account_info()` key == PDA. Non-existent accounts can be passed. Fine.

**MINT deep dive**:

- mint_vault: config, asset (Signer — new keypair), collection (Unchecked, checked == cfg.collection), owner (Unchecked — anyone), bank (Signer == cfg.bank), payer (Signer), treasury (Unchecked == cfg.treasury), seal_config (Unchecked, validated), mint_authority (PDA seeds [MINT_SEED]), mpl_core, system.

- Payment: `invoke(system_instruction::transfer(payer, treasury, price))` — payer must have the lamports. If payer == treasury? Transfer to self — fine, no-op economically. Can the payer be the treasury itself? treasury is UncheckedAccount (not signer); payer is Signer. If treasury key == payer key... then payer signs, transfers to itself. Net zero. Doesn't matter.

- **Is the treasury required to be a system account?** treasury is `#[account(mut)]` UncheckedAccount. If treasury is, say, a PDA or a token account... system transfer to a PDA works (just credits lamports). Fine.

- **The CreateV2 CPI**: asset signs (Signer), mint_authority PDA signs via invoke_signed with [MINT_SEED, bump]. For CreateV2 to add the asset to the collection, the collection's update authority must be mint_authority. Not verified on-chain here but enforced by Core. ✓.

- **owner can be ANY account including PDAs, programs, the mint_authority itself, another vault's asset-signer...** The OwnerWouldBrick check only blocks owner == THIS asset's own asset-signer. Owner could be ANOTHER vault's asset-signer PDA (nested vault!) — that's the "nested-vault guard opt-in" thing... "nested-vault guard opt-in" was listed as fixed. Hmm, where's the guard? In MINT I don't see a check that owner isn't a Core asset-signer PDA or a Core asset. Owner could be any pubkey. If owner = another vault's asset-signer PDA, the new vault is owned by a PDA that can only act via the outer vault's Execute — that's the nested vault scenario, which is "opt-in" (the owner... well, the PDA can't consent; the payer chooses). Eh — the fix note says opt-in, meaning it's allowed deliberately? "nested-vault guard opt-in" — I read this as: the guard is opt-in, i.e., nesting is allowed if you jump through hoops. Not re-reporting.

- **minted_total never enforced** — covered above.

- **set_round while a round is active**: governance can call set_round mid-round, resetting minted_this_round to 0 — the comment says minted_total exists so a governor can't "lift any cap by simply opening a new round" — but minted_total is never CHECKED, so a governor CAN lift any cap by opening a new round (or even re-calling set_round to reset minted_this_round mid-round!). The comment claims protection that doesn't exist. This is the comment-vs-code finding. The cap is per-round and trivially resettable. Combined with no lifetime cap: unlimited supply is one governance signature away (plus Bank co-sign per mint). Severity: HIGH from the business standpoint (the ~2,100 scarcity is the product), though it requires the governance majority — which is 3 wallets with 48%... wait, 48% is not a majority. Top 3 hold 48% of charter vaults; but voting is 1-vote-per-vault over ALL vaults (~2,100 total, ~1,911 not yet minted). Hmm, charter vaults are ~190; the top-3 hold 48% of CHARTER vaults ≈ 91 votes out of ~2,100 eventual. But future minters get votes too. Anyway — governance capture is a stated known concentration. The finding is: on-chain, nothing enforces the 2,100; the code comment pretends minted_total does. Report as HIGH (economic invariant absent + misleading comment), with the note that it's governance-gated.

- **update_wiring can rotate governance**: admin can neutralize governance (or rescue from hostile governance). Also admin can rotate treasury (capture the 85%). Also admin can rotate collection (halt minting via WiringDiverged — actually wait, would it halt? mint_vault checks cfg.collection == passed collection AND seal_config's collection == cfg.collection. If admin sets cfg.collection = NewCollection, then seal_config's collection (OldCollection) != NewCollection → WiringDiverged → ALL mints fail until admin sets it back. So it's a halt toggle, not a redirect. Because the cross-check pins collection to SEAL's config. Good — the cross-check does its job for collection. But TREASURY has no cross-check — admin redirects revenue unilaterally. And BANK: admin can rotate bank in MINT's update_wiring — but seal_config cross-check pins bank to SEAL's config.bank → rotating MINT's bank alone halts minting (WiringDiverged). So bank/collection rotations are halt-only; treasury rotation is a live redirect. FINDING: treasury redirect by admin alone; the 85% is trust, not code. MEDIUM.

- **governance rotation**: admin can swap governance pubkey — silently neutralizing votes. "Can admin and governance fight, or can one silently neutralise the other?" — admin wins: update_wiring(governance = admin's key) makes set_round admin-only. That's by design presumably (admin = multisig). Note it.

- **set_round has no constraint that opens_at/closes_at are sane** (opens_at in the past is fine — allows immediate minting; closes_at = i64::MAX → round never closes). Combined with cap=0 → infinite round at fixed price. Governance-scoped, note within the supply finding.

- **price_lamports = 0 allowed** → free mints (Bank still co-signs). Note.

- **No per-wallet mint limit**: one payer can mint up to cap. Fine, cap exists... resettable. Covered.

- **round_id check `cfg.round_id > 0`** — round 0 is "no round". set_round increments first, so first ratified round has id 1 ✓.

- **Race on minted_this_round**: two mint_vault in one tx — sequential execution, config is mut, second sees updated counter ✓. Cap enforced per-instruction sequentially ✓.

- **Clock**: `now >= opens_at && now < closes_at` ✓.

- **What if treasury account doesn't exist / is a mint?** system transfer fails → mint fails. Fine.

- **seal_config read**: `try_borrow_data` — fine. Note: MINT does NOT check the seal config's discriminator, covered in (B).

- **Does mint_vault verify the collection's update authority is mint_authority?** No, but Core enforces it in CreateV2. If the collection's UA were rotated away (by whoever holds it — it's the MINT PDA, only usable via MINT program... but MINT has no instruction to rotate the collection UA; Core's UpdateCollectionV1 could be CPI'd... only the UA (the PDA) can do that, and only MINT can drive the PDA, and MINT has no such instruction. So the collection UA is stuck at the MINT PDA forever — good, "collection made non-rotatable" fix confirmed... wait, the fix note says "collection made non-rotatable" — in SEAL's update_config, collection isn't a parameter ✓. In MINT's update_wiring, collection IS rotatable (but cross-check pins it). In BURN's update_config, collection not rotatable ✓. OK.

Hmm wait, actually — one more MINT thing: **the seal PDA used for plugin authority is derived from SEAL_PROGRAM_ID at runtime** ✓ (fix confirmed). And the Attributes plugin authority = seal PDA. And PermanentFreezeExecute authority = seal PDA. ✓.

**Does mint_vault check the asset doesn't already exist?** asset is a Signer (new keypair); CreateV2 initializes it. If the asset keypair is reused... CreateV2 would fail (account already initialized). Fine.

**Charter mints**: "~190 free charter mints redeemed against a burned Proof-of-Burn token" — WHERE is that in the code?? mint_vault has NO charter path, no PoB token check, no free-mint gating beyond price_lamports==0 set by governance. The business says charter mints are redeemed against a burned PoB token — the code has no such mechanism. Either it's off-chain (Bank co-signs selectively) or unimplemented. The Bank co-signature is the only gate: price 0 + Bank picks who mints. So "charter" is purely a Bank policy. And the provenance stamp (Notice serial) is never written (Attributes created empty). So the ENTIRE charter provenance story is off-chain. That's the (C) finding amplified: not just "mark_opened wipes attributes" but "no attributes are ever written at mint." Combined HIGH.

Wait, let me double-check the CreateV2 attribute list is really zero: `data.push(PLUGIN_ATTRIBUTES); data.extend_from_slice(&0u32.to_le_bytes());` — yes, 0 attributes. Unless the intent is that provenance is added later by... whom? Only the seal PDA can UpdatePlugin(Attributes). SEAL has no instruction to write arbitrary attributes. So no one can ever write charter provenance. Confirmed.

Hmm, wait — could the collection have collection-level Attributes plugin that assets inherit? The collection was created elsewhere (not by these programs). If the collection had an Attributes plugin... asset-level plugin created at mint overrides. The asset's Attributes plugin (authority = seal PDA) with empty list is what exists. Collection-level attributes might display, but the asset-level empty list... In Core, asset attributes come from the asset's own Attributes plugin if present, else collection's. The asset HAS one (empty). So no charter data. Confirmed.

**Now the mark_opened wire format**: UpdatePluginV1 data: [IX_UPDATE_PLUGIN_V1=6, PLUGIN_ATTRIBUTES=6, then...]. UpdatePluginV1 args: { plugin: Plugin, ... }? Actually UpdatePluginV1 args: plugin: Plugin (borsh: variant u8 + fields). For Attributes: variant 6, then attribute_list: Vec<Attribute> → u32 len=1, then Attribute { key: String, value: String } → u32 len + bytes each. The code: `data = vec![6, 6]; extend(1u32); k.len() u32; k; v.len() u32; v;` ✓ matches. And the accounts for UpdatePluginV1: [asset, collection, payer(authority? no...), ...]. UpdatePluginV1 accounts: asset, collection, authority (the plugin authority = seal PDA, signer), payer... The code passes [asset, collection, payer(signer), seal(signer via PDA), system, mpl_core]. Hmm — UpdatePluginV1's account layout in Core: asset, collection, authority, payer, system_program, log_wrapper? The code's layout: asset, collection, payer, seal, system, mpl_core(as log wrapper?). If payer is passed where "authority" is expected... the tests pass 19/19 including mark_opened presumably (close_redemption calls mark_opened — if the accounts were wrong, close would fail, and the suite tests open/close). So the wire format works. Not a finding.

Hmm wait, actually — does the test suite cover close_redemption? "minting real vaults and moving real SPL tokens" — 19/19 suite. Presumably includes redemption. I'll trust it.

**Now — the (C) wipe question**: UpdatePluginV1 with Attributes REPLACES the plugin's data (the whole attribute list). So mark_opened replaces the list with [{"redemption":"opened"}]. Any existing attributes (if any were ever written) are gone. Since mint creates an empty list, the only thing ever present would be... nothing. So the wipe is moot TODAY (nothing to wipe), but the design intent (provenance stamped at mint) is unimplemented. The finding is: provenance never written + if it ever were (e.g., future SEAL upgrade adds a stamp-at-mint), mark_opened would wipe it. Report as: the anti-resale-fraud signal is the ONLY attribute and charter provenance doesn't exist on-chain.

Also: **can the stamp be forged?** Only seal PDA can update Attributes. mark_opened is called only in close_redemption, which requires a preceding open. So "opened" ⇒ genuinely opened. Can't be forged by others. ✓. Can it be removed? No instruction removes it. ✓. Monotonic ✓ (value never changes from "opened").

**Is the stamp set on every value-removal path?** Paths: redemption (stamped ✓), burn (asset destroyed — no stamp needed, but note: burn_vault does NOT require the stamp or a preceding open; a full vault can't burn anyway due to empty checks... wait — CAN a full vault burn? reserves must be empty. So no. But a vault that was opened, drained, closed (stamped) then burned — fine). Bare BurnV1 (accepted). Delegate-during-thaw (blocked at close for reserve mints). So the stamp covers the one extraction path. ✓.

Hmm — wait, one more extraction path: **TransferV1 of the asset mid-thaw?** Doesn't extract contents. **Execute during thaw by a NON-owner?** Execute requires owner signature. ✓.

**What about open's set_frozen(false) — does open check the vault is currently frozen?** No — set_frozen(false) on an already-thawed vault is idempotent. Fine.

**SEAL update_config: admin rotation** — admin can rotate itself. Standard. **No admin check that new admin != 0?** Fine.

**INIT_AUTHORITY front-run**: initialize requires the signer == INIT_AUTHORITY (hardcoded). If INIT_AUTHORITY's key is known before deploy, a front-runner can't pass (they'd need to SIGN as INIT_AUTHORITY). ✓ fixed. But note: INIT_AUTHORITY is a plain pubkey (comment says "SET TO SQUADS MULTISIG" — currently some key). If it's not actually a multisig at deploy... operational. Skip.

**SEAL initialize: no check that `collection` is a real Core collection or that its UA is the MINT PDA** — if initialized with a wrong collection, everything fails later. Admin error, fail-closed. Skip.

**BURN initialize: same.**

**Cross-program: MINT's bank vs SEAL's bank** — cross-checked ✓. BURN's bank vs SEAL's ✓. But NOTE: the cross-check reads SEAL's config — if SEAL's admin rotates SEAL's bank, MINT/BURN configs must be updated too or mint/burn halt (WiringDiverged). Fail-closed ✓.

**What about the SEAL config's `admin`?** Not cross-checked (fine, each program has its own admin).

**reserve_mints cross-check absent in BURN** — found above. Let me also check: does MINT need reserve_mints? No.

**BURN's `declared: u8`** — remaining_accounts max 255; with 8 reserve mints × 2 = 16 ATAs + extras. Fine.

**BURN: does it check the vault_asset is not the collection?** Irrelevant.

**BURN: the BurnV1 CPI passes `owner` as signer — but ALSO, does BurnV1 need the asset's UPDATE authority?** No, owner. ✓.

**BURN: after BurnV1, the asset account is closed and lamports refunded to payer.** The asset_signer PDA — BurnV1 doesn't touch it. If the PDA has lamports (grief), burn fails earlier. ✓.

**SEAL close: `lamports_left` event** — cosmetic.

**SEAL close: does it verify asset_signer PDA derivation?** Yes, seeds constraint ✓.

**SEAL open: NO asset_signer account** — open doesn't need it ✓.

**SEAL open/close: `payer` is a separate Signer from owner** — payer pays for the UpdatePlugin CPI rent/fees. Anyone can be payer. Fine.

**Introspection: what if the SAME tx has open(A) and close(A) but close comes BEFORE open?** close scans 0..current for open — if close is at index 0 and open at 1: close finds no preceding open → fails. ✓.

**What if there are TWO closes and one open?** open at 0, close at 1, close at 2. Close at 2: preceding open found ✓ → re-seals + stamps again. Fine.

**What if open(A) at 0, close(A) at 2, and at index 1 an instruction that THAWS via another path?** No other path (only seal PDA signs freeze updates, only via SEAL). ✓.

**Duplicate instructions**: covered.

**CPI edge**: could a malicious program CPI open_for_redemption and CPI close_redemption, with the top-level tx containing NEITHER? open's forward scan looks at the TOP-LEVEL instruction list (sysvar). During a CPI, load_current_index_checked returns the top-level index of the currently-executing top-level instruction. So a CPI'd open at top-level index 5 scans for close at indices >5 in the TOP-LEVEL list. If none → fails. So CPI'd open still requires a top-level close after. And a CPI'd close scans top-level indices < current for an open. So: top-level ix 0 = malicious program X: CPIs open(A) (scan finds top-level close at ix 1 ✓ — wait, current index during the CPI is 0, scan starts at 1, finds close at 1 ✓) → thaws. Then X, INSIDE the same top-level instruction, CPIs Execute to sweep! Then top-level ix 1 = close(A): scans 0..1, finds... the OPEN was a CPI inside ix 0 — NOT in the sysvar! The sysvar only lists top-level instructions. So close at ix 1 finds NO preceding open → FAILS → whole tx fails. Hmm. So that ordering fails.

Reverse: top-level ix 0 = close(A)?? No preceding open → fails.

What about: top-level ix 0 = X (CPIs open — scan needs close at >0: ix 1 = close(A) ✓ present in sysvar) → thaw happens inside ix 0. X then sweeps inside ix 0. Top-level ix 1 = close(A): scans 0..1 for open in sysvar — ix 0 is X's instruction (program X, not SEAL) → NOT found → close fails → tx fails. 

So CPI-based open always requires a top-level close, and top-level close requires a top-level open. The pairing is airtight at the top level. ✓. Good — I tried to break it and couldn't.

Hmm, wait — one more: what if X's instruction at ix 0 CPIs BOTH open and close? CPI'd open: current index = 0, scans top-level >0 for close — if ix 1 is, say, a dummy... no close → CPI'd open fails. Unless ix 1 IS a top-level close. Then CPI'd close inside ix 0: scans 0..0 — nothing → fails. So no.

What about top-level: ix 0 = open(A) [real], ix 1 = X: CPIs close(A)?? CPI'd close scans 0..1 → finds open at 0 ✓ → re-seals INSIDE ix 1. Then ix 2 = sweep → frozen → fails. Or ix 2 = nothing. Net: thawed during ix 0..1, re-sealed within ix 1. Ends frozen ✓. But WAIT — during ix 1, AFTER the CPI'd close re-seals, X could... it's frozen, Execute fails. Before the CPI'd close, within ix 1, X could CPI Execute to sweep (still thawed from ix 0's open!). So: ix 0 = open (thaw), ix 1 = X: [CPI Execute sweep, CPI close (re-seal)]. The sweep happened while thawed — but that's exactly what a normal redemption does (open, sweep, close). The Bank co-signed the whole tx (bank signs open at ix 0 — bank is a Signer on open). So Bank authorized. Fine — equivalent to the happy path.

The dangerous variant: sweep AFTER the last close. Impossible (frozen). ✓.

**Now — the thaw window and the Bank's simulation duty**: known/accepted.

**Anything that thaws without a genuine terminal close**: open requires terminal close ✓. set_frozen only called in open/close ✓. mark_opened only in close ✓.

**Non-owner moving a vault**: open/close require owner signer == asset owner ✓; burn requires owner ✓; mint's owner is chosen by payer ✓ (that's minting, fine).

**Party without the Bank moving/destroying/seizing**: open/close/burn/mint all require bank signer ✓. Bare BurnV1 (accepted). TransferV1 of the NFT — owner alone CAN transfer the vault NFT (no Bank needed)! Is that a problem? Transferring the NFT doesn't move contents. The recipient gets a sealed vault. Fine — vaults are "freely transferable" by design.

**Seizure**: Could the Bank + a rogue SEAL upgrade steal? SEAL upgrade authority could rewrite everything — trusted. Out of scope-ish (upgrade authorities are the trust root).

**MINT: `asset: Signer<'info>` with `#[account(mut)]`** — the asset keypair signs and is funded by... who pays for the asset account creation? CreateV2's payer account — the CPI passes `ctx.accounts.payer` as payer (AccountMeta::new(payer, true)) ✓. payer also pays price. Fine.

**MINT: name/uri length checks** ✓ (MAX 64/200).

**MINT: does it verify `owner` is not the mint_authority PDA or config PDA?** OwnerWouldBrick only blocks own asset-signer. Owner = MINT PDA? Then the vault is owned by a PDA of the MINT program — MINT has no instruction to transfer/act as owner... the vault would be stuck (can't open/close — owner must SIGN; MINT PDA could sign via a CPI if MINT had such an instruction — it doesn't). So owner = any PDA = bricked vault (contents sealed forever, or until a program upgrade). The payer CHOSE that owner though — self-inflicted / gift-to-PDA. The Bank co-signs and should refuse. Minor. The fix note only covered own-asset-signer. Could note as LOW: owner can be any non-signing PDA (e.g., another program's PDA), bricking the vault; only the self-PDA case is blocked. Actually — is this worth reporting? "mint refuses an owner equal to the asset-signer PDA" was the fix; the generalization (any PDA owner bricks) is adjacent. The Bank co-signs every mint, so it's gated. LOW.

**BURN: `declared` u8 vs remaining_accounts len** — if remaining_accounts > 255... tx limit anyway. Fine.

**BURN: reserve ATA "must be declared" — but what if the ATA exists and holds tokens and the caller just... doesn't pass it?** Then `ok_or(ReserveNotDeclared)` — the ATA address is DERIVED from config mints; the caller MUST pass an account at that address. If they pass nothing → error. So the ATA must be present. But the account passed could be... the actual ATA (checked). ✓. So for reserve mints, completeness IS enforced (both token programs). ✓ Good.

**BURN: what if a reserve mint is a Token-2022 mint with an ATA that has extensions?** ReserveHasExtensions → burn fails. Fail-closed ✓.

**SEAL close inspect_reserves(require_empty=false)** — checks delegate/close-authority/extensions but NOT amount ✓ (redemption may leave balance... wait, should close require empty? No — partial redemption allowed. ✓).

**SEAL close: does it check the PDA's lamports or nested assets?** No — but close doesn't destroy. ✓.

**Hmm — SEAL close: inspect_reserves checks ATAs of reserve mints for delegates. What about a delegate on the ATA approved BEFORE the open (in a previous tx)?** Delegates can be approved anytime the PDA signs — only via Execute (thawed). Previous thaw windows ended with close's inspect catching delegates. So a delegate can only exist if... approved during a thaw and the close missed it — close checks. Or approved via a path that doesn't need the PDA — Token delegate approval requires the token ACCOUNT OWNER (the PDA) to sign. Only Execute. ✓. So delegates can't survive. ✓ (for reserve mints).

**What about `close_authority` on the ATA set during thaw?** Checked (d[129..133]) ✓.

**Token-2022 transfer hooks / CPI-guard?** Edge. Skip.

**BURN: the second loop's `if acc.lamports() == 0 { continue; }`** — an account with lamports but not token-owned → continue (e.g., a 1-lamport system account at a random address — skipped ✓).

**BURN: could the caller pass the SAME account twice in remaining_accounts?** find() takes the first. Duplicate with different... same key, same data. Fine.

**MINT: `invoke` (not invoke_signed) for the payment — payer is a Signer ✓.**

**MINT: what if price transfer succeeds but CreateV2 fails?** Atomic revert ✓.

**MINT: treasury is `#[account(mut)]` UncheckedAccount — could treasury be the config PDA?** cfg.treasury == passed treasury (require). Admin sets treasury at initialize. If treasury == some program-owned account, system transfer to it just adds lamports (account data unchanged) — fine, retrievable by that program's authority... whatever, admin's choice.

**Events**: VaultMinted emitted AFTER CPI ✓.

**set_round: no event for who called... governance signer is in tx. Fine.**

**update_wiring: no events!** Admin rotations (treasury redirect!) emit NO event. Quiet treasury redirection — off-chain watchers must diff account data. LOW/MEDIUM note: silent wiring changes, no events, making the Bank/scanner's job harder. Worth a line in the treasury finding.

**SEAL update_config: no events either.** Same note.

**Now let me reconsider (A) "Is there ANY on-chain link between paying and receiving?"** — payer pays treasury, owner receives vault. The Bank co-signs. If governance sets price P, ANY payer can mint for ANY owner. No allowlist. So the "round" is open to all. Fine per design ("public rounds at a fee").

**Charter free mints**: price 0 rounds — anyone the Bank co-signs for. The Bank is the gate. So the PoB redemption is entirely Bank policy. The business says "redeemed against a burned Proof-of-Burn token" — no on-chain PoB check. If the Bank is compromised/social-engineered, charter mints go to anyone. But Bank is trusted for everything anyway. Note in the provenance finding.

**What is minted_total FOR?** — Nothing. Write-only. Dead counter. The comment claims it's the anti-cap-lifting defense. It isn't. Core finding.

**Worst thing a ratified vote can do**: (1) unlimited supply at any price (with Bank), (2) price 0, (3) infinite round. Cannot: touch plugins, existing vaults, treasury, seal. So worst = dilution. With 48% concentration... they'd need majority. Report the mechanism, note the concentration.

**Can admin silently neutralize governance?** Yes — update_wiring(governance=X). And governance can't neutralize admin. Admin > governance. Also admin can halt minting (collection rotation → WiringDiverged). Note.

**Clock manipulation**: validators; skip.

**round_id overflow**: checked ✓.

**closes_at = i64::MAX with cap 0**: infinite round — governance choice, covered.

Now let me also double-check the **SEAL config byte offsets** claim once more, since a third of prior CRITICALs were wrong. Anchor account layout: [discriminator(8)][admin(32)][collection(32)][bank(32)][reserve_mints: Vec<Pubkey> = len(4) + 32*n][bump(1)]. So collection at 8+32=40..72 ✓, bank at 72..104 ✓. The comment in MINT/BURN matches ✓. Good — the layout is RIGHT. I should say so plainly (state what I verified and couldn't break).

**What happens on a SEAL upgrade that reorders/inserts a field?** MINT/BURN read stale offsets → WiringDiverged (halt) or false-pass if the new layout coincidentally places the same values. Fail-closed mostly. The fix: check the discriminator (Anchor disc = sha256("account:Config")[..8]) and/or add a version field; better: expose a view instruction or have SEAL write a hash of its wiring that others check. MEDIUM/LOW. Also: no discriminator check means if SEAL's Config were ever REPLACED by a different account type at the same PDA (upgrade + re-init after... config can't be closed — no close instruction; but an upgraded SEAL could add one) — speculative. Keep it as fragility, LOW-MEDIUM.

**SEAL re-initialised?** initialize has `init` constraint — fails if account exists ✓. Config can't be closed (no instruction) ✓. So re-creation requires an upgrade. Fine.

**MINT holds SEAL_PROGRAM_ID compile-time**: if SEAL is redeployed at a NEW address (not an upgrade — a new program), MINT keeps deriving the OLD seal config PDA and the OLD seal PDA for plugin authorities. New vaults would carry the OLD seal PDA as freeze authority — the NEW SEAL program can't sign it → born-frozen-forever. The MINT comments themselves describe this exact failure for a stale constant; the same failure recurs if SEAL migrates addresses and MINT isn't upgraded in lockstep. LOW (operational), one line.

**Now the "already fixed — check whether real or relocated" list**: Let me verify a few:
- burn-on-lamports==0: BURN still requires lamports==0 BUT now also requires all reserve ATAs empty + declared. The lamports==0 check remains as a NECESSARY condition (PDA must be drained) — but the destroy-BTC path required reserves empty, so it's real... except the 1-lamport grief (burn blocked, recoverable via thaw). Real fix ✓.
- standalone close burning: close never burns ✓ real.
- close missing Core-owner check: close checks asset_owner == owner signer ✓ real.
- token delegate surviving re-seal: inspect_reserves at close ✓ real (for reserve mints; non-reserve mints not checked — but non-reserve tokens aren't the reserve; a delegate on a non-reserve token account owned by the PDA could drain THAT token later — harmless-ish unless reserve_mints is incomplete. Note: inspect_reserves only covers config.reserve_mints — if cbBTC is ever NOT in reserve_mints... it's admin-controlled, can't be dropped. ✓).
- three configs diverge: MINT/BURN read SEAL config for collection+bank ✓ real but reserve_mints NOT cross-checked in BURN (found above — the fix is partial).
- collection non-rotatable: SEAL ✓, BURN ✓, MINT's update_wiring CAN rotate collection but the cross-check pins it (halt-only). Partially real; note.
- close requires preceding open ✓ real.
- mint refuses owner == own asset-signer ✓ real (but any other PDA owner still bricks — LOW).
- 1-lamport ATA grief: skipped via owner!=token-program check ✓ real. But PDA-lamports grief on burn remains (recoverable) — LOW.
- initialize front-run: INIT_AUTHORITY check ✓ real.
- stale seal PDA: derived at runtime ✓ real.
- Token-2022 hidden balances: extension-length check ✓ real (base-length-only accounts; but what about a Token-2022 account with extensions where len==165? Extensions always add bytes; a Token-2022 account with NO extensions is exactly 165 — fine, no hidden balance. Confidential transfer extension adds length → caught ✓. What about the `CpiGuard` or transfer-hook extensions that don't hide balance? Caught too (over-strict, fail-closed) ✓.)

Hmm wait — one thing about Token-2022: the ATA derivation for Token-2022 uses the SAME ATA program with token_program_id = Token-2022 ✓ (both checked) ✓.

**What about an SPL ATA holding cbBTC where the mint is cbBTC but the account was created... fine.**

**BURN: `require!(ctx.accounts.asset_signer.lamports() == 0)`** — hmm, when Core creates an asset, does it fund the asset-signer PDA? I don't believe the asset-signer PDA is ever funded (it's just a signing PDA). Tests pass with burns presumably. ✓.

**One more MINT check — `require!(cfg.cap == 0 || cfg.minted_this_round < cfg.cap)`** — cap is per-round; set_round resets minted_this_round. So even the per-round cap is resettable by governance mid-round (set_round again). The comment's claim about minted_total preventing cap-lifting is false. ✓ finding.

**Does anything prevent set_round from being called by governance to RE-OPEN a closed round with a higher cap?** Nothing — that's the cap-evasion. ✓ same finding.

**Payment: is there a refund if the mint fails post-payment?** Atomic ✓.

**Over-payment**: payer sends exactly price. If payer wants to tip, no path. ✓.

**What if price_lamports > 0 but treasury == payer?** Self-transfer, net zero — the "payment" is fake but the mint still happens at price P... wait, payer pays P to treasury; if treasury IS payer, payer loses nothing. So a round's price can be evaded IF the payer controls the treasury. Treasury is admin-set; if admin set treasury to an attacker-controlled account... admin trust. Not a finding beyond the treasury-redirect one.

**MINT: bank is a Signer but is bank == cfg.bank checked BEFORE the payment?** Yes, order: bank/collection/treasury checks, then round checks, then payment, then seal-config check, then CPI. Wait — the seal-config cross-check happens AFTER the payment. If the seal check fails, payment reverts (atomic) ✓.

**Hmm — the seal-config check is AFTER payment but BEFORE CreateV2 ✓ atomic.**

**BURN: is there a check that vault_asset != collection?** If vault_asset were the collection account... it's checked to be an AssetV1 (d[0]==1); a collection account has d[0]==2 (Key::CollectionV1) → fails ✓.

**SEAL read_core_asset: data[33] == UA_DISC_COLLECTION (2)** — AssetV1 update_authority is an Option<Pubkey>-like enum: 0=None? 1=Address? 2=Collection? In Core, UpdateAuthority enum: Address(Pubkey) = 1? Collection = 2? Let me think — Core's UpdateAuthority: None? Actually AssetV1.update_authority: Option<UpdateAuthority> where UpdateAuthority = { Address, Collection }. Borsh: Option: 0/1; UpdateAuthority enum: Address=0? Collection=1? Hmm. The code reads data[33] as the Option tag?? If update_authority is Option<UpdateAuthority>: byte 33 = Option tag (0=None, 1=Some), byte 34 = enum tag... but the code reads collection at [34..66] directly, implying byte 33 is the ENUM tag with 2=Collection and the collection pubkey follows at 34. So AssetV1.update_authority is UpdateAuthority (not Option) with variants Address=1, Collection=2? Given tests pass on real Core (read_core_asset is used in open/close which are tested), the offsets work. ✓. I'll trust the 19/19.

OK — also **"anything the code claims in a comment that it does not actually do"** — I have:
1. MINT's minted_total comment ("without this a governor could lift any cap") — minted_total is never checked; cap-lifting works.
2. BURN's seal-config comment ("a trimmed reserve list — this becomes a destroy-BTC path") — reserve lists are NOT cross-checked; trimming BURN's list relative to SEAL's is possible (by omission).
3. SEAL's mark_opened comment "Requires the vault to be minted with an Attributes plugin delegated to the seal PDA — see MINT-REQUIREMENTS in SPEC" — mint DOES create the Attributes plugin ✓ (that one's real).
4. MINT header: "a hostile majority cannot express a dangerous proposal because the instruction has nowhere to put one" — but set_round(price=0, cap=0, closes_at=MAX) IS a dangerous proposal (unlimited free supply). Overstated comment.
5. The charter provenance business claim — unimplemented.

Also — **"Is the ~2,100 lifetime supply actually enforced anywhere, or only counted?"** — only counted, and the counter isn't even read. ✓ core finding.

**Severity calibration**:
- No lifetime supply cap + resettable per-round cap + price can be 0: this is governance-scoped, but the entire product is scarcity (2,100 vaults backing resale value). A ratified vote (or governance capture) can mint forever. Since governance concentration is KNOWN and accepted, is this "known and accepted"? The known list says concentration is known; it does NOT say unlimited supply is accepted. The business says "~2,100 vaults are intended to exist in total" and "Future mints ... controlled by governor vote" — so future mints ARE governance-controlled by design. The gap: nothing stops governance from exceeding 2,100, and the code comment pretends a defense exists. I'd rate HIGH (economic invariant absent + false comment), not CRITICAL (requires governance majority + Bank co-sign per mint; the Bank is a check).

Hmm, wait — actually, does the Bank co-sign per mint? Yes, bank is a Signer on mint_vault. So unlimited minting needs governance + Bank. The Bank is the backstop. Still, the code should enforce the cap the comment claims. HIGH.

- Charter provenance never stamped + mark_opened wipes any attributes: HIGH (business-critical record absent; the "only surviving record" doesn't exist on-chain). Actually — is it CRITICAL? It's not fund loss. It's a business-integrity failure: charter members' provenance (which the business says is the ONLY surviving record) never exists, and resale fraud-prevention signal is weaker than claimed. I'll say HIGH.

- Treasury redirect by admin alone, no event: MEDIUM (trust assumption; the 85% is not encoded).

- BURN reserve_mints not cross-checked with SEAL (comment claims it is): MEDIUM (needs admin misconfiguration/omission + Bank co-sign; but it's exactly the destroy-BTC path the comment claims is closed).

- Byte-offset fragility / no discriminator check on seal_config reads: LOW-MEDIUM.

- SEAL_PROGRAM_ID constant vs SEAL redeploy: LOW.

- MINT update_wiring can rotate collection (halt-only due to cross-check) and governance (neutralize votes): LOW note.

- Owner can be an arbitrary PDA (brick): LOW.

- 1-lamport to asset-signer PDA blocks burn (recoverable via thaw): LOW.

- set_round mid-round resets minted_this_round (cap evasion within a round): part of the supply finding.

Let me also think hard about whether there's a CRITICAL I'm missing. The prompt says hunt (A) economics, (B) config pattern, (C) attributes. Also "anything that thaws without a genuine terminal close or ends a tx thawed" — I couldn't break the pairing. "Any path letting a non-owner or a party without the Bank move/destroy/seize" — all gated. "Missing account validation on UncheckedAccounts" — let me sweep:

SEAL OpenForRedemption: vault_asset (validated as Core asset in-collection, owner-checked) ✓; collection (UncheckedAccount mut — validated == asset's collection AND == config.collection) ✓; owner Signer ✓; bank Signer == config.bank ✓; payer Signer mut ✓; config seeds ✓; seal seeds [SEAL_SEED] bump — hmm, `#[account(seeds = [SEAL_SEED], bump)]` on UncheckedAccount — Anchor verifies the PDA derivation ✓; mpl_core address ✓; instructions sysvar address ✓; system ✓.

Wait — the seal PDA seeds constraint: `seeds = [SEAL_SEED], bump` — bump not specified as config.bump; Anchor finds the canonical bump ✓.

CloseRedemption: vault_asset ✓; collection ✓; owner Signer ✓; bank ✓; instructions ✓; asset_signer seeds [EXECUTE_PREFIX, vault_asset] program MPL_CORE ✓; payer ✓; config ✓; seal ✓; mpl_core ✓.

MINT MintVault: config ✓; asset Signer mut ✓; collection Unchecked — checked == cfg.collection in-handler ✓ (but NOT checked to be a Core collection account — CreateV2 enforces); owner Unchecked (any) — noted; bank Signer ✓; payer ✓; treasury Unchecked == cfg.treasury ✓; seal_config validated in-handler ✓; mint_authority seeds ✓; mpl_core ✓.

BURN BurnVault: vault_asset ✓ (Core asset, owner, collection); collection ✓; owner Signer ✓; bank ✓; asset_signer seeds ✓; payer ✓; config ✓; seal_config in-handler ✓; mpl_core ✓; remaining_accounts — validated per-use ✓.

One thing: **MINT's `collection` UncheckedAccount is `mut`** — CreateV2 mutates the collection (adds asset). If cfg.collection points at a non-collection account, CreateV2 fails ✓.

**BURN's BurnV1 CPI account list**: [asset, collection, payer, owner, mpl_core, mpl_core] — 6 metas, but invoke passes 5 account infos! `invoke(&ix, &[vault_asset, collection, payer, owner, mpl_core])` — 5 infos for 6 metas. MISMATCH? invoke requires the account_infos slice to correspond... invoke checks that each AccountMeta's pubkey is in the infos slice? Actually `invoke` maps metas to infos by matching pubkeys? No — invoke requires the infos slice to contain ALL accounts referenced by the instruction; it signs and dispatches. The runtime CPI check: each account in the instruction must be present in the provided infos... Actually, `invoke` panics/errors if the number of infos doesn't cover the instruction's accounts? Let me think: `InvokeArgument`... `invoke(instruction, account_infos)` — the implementation signs the metas whose pubkeys match signer infos, then passes the instruction to the runtime with... the runtime CPI uses the ORIGINAL account keys from the instruction and checks each against the infos for signature lookup. If an account meta (the second mpl_core, used as... in BurnV1 the accounts are [asset, collection, authority, payer, system_program?, log_wrapper?]... hmm. The 6th meta is MPL_CORE again — maybe the log wrapper (mpl_core as its own log wrapper? Core's log wrapper is "mlgs..."? Metaplex Core's log wrapper program is `MLG...`? Actually Core uses a log wrapper program for CreateV2: "WrapC1...". Hmm). Whatever — if the 6th meta's pubkey (MPL_CORE_ID) IS in the infos slice (mpl_core passed once), does invoke work? invoke's implementation: it iterates instruction.accounts, and for signers, finds matching info to sign. For non-signers, it just... the runtime receives the instruction with all account keys; the infos slice is used for signature resolution — each meta key must be findable among infos IF it needs signing. A non-signer meta not present in infos: the runtime CPI verification checks that all accounts in the CPI instruction are in the caller's... hmm, actually CPI instructions can reference accounts NOT passed in infos? No — the runtime requires every account key in the CPI instruction to be present in the account_infos slice? I don't think invoke validates that; the runtime's CPI processing checks account ownership and signatures using the infos... Honestly, since the tests pass (burn tested presumably — "minting real vaults and moving real SPL tokens" — does the 19/19 include burn? Probably), and the duplicate MPL_CORE meta is a duplicate of an account that IS in the infos, this works (duplicates resolve to the same info). Not a finding.

Similarly SEAL's core_plugin_cpi: 6 metas, 6 infos ✓.

MINT's CreateV2: 8 metas, 7 infos! metas: asset, collection, mint_authority, payer, owner, MPL_CORE, system, MPL_CORE. infos: asset, collection, mint_authority, payer, owner, mpl_core, system — 7 infos, 8 metas. The 8th meta (MPL_CORE, readonly, non-signer) duplicates the 6th — present in infos ✓. Fine.

OK. Now — is there anything about **`open_for_redemption` not checking the vault is not ALREADY thawed by a previous open in the same tx**? Covered — idempotent.

**What about open(A) where the close found is for the same asset but the close's CONFIG is a different... config is seeds-constrained, single config. ✓.**

**What about the scan matching a close whose accounts[0] == asset but which is a DIFFERENT instruction with the same discriminator?** The discriminator IS the instruction identity. ✓.

**Edge: `ix.data.len() >= want.len()` and prefix match — could a different SEAL instruction share the 8-byte prefix? No (discriminators unique). ✓.**

**ALTs and the instructions sysvar**: I said resolved. Actually let me double check — there was a known subtlety: the Instructions sysvar contains instructions with RESOLVED pubkeys? I recall Solana docs: "The Instructions sysvar contains the instructions of the current transaction, with address lookup table accounts resolved"? Hmm. Actually I recall the opposite concern raised in audits: that the instructions sysvar shows the ORIGINAL (unresolved) message... No — the runtime constructs the sysvar from the resolved transaction. I'm fairly confident it's resolved (the sysvar is built after address resolution; each entry has program_id and accounts with concrete pubkeys). Yes — `load_instruction_at_checked` returns `Instruction { program_id, accounts: Vec<AccountMeta>, data }` with real pubkeys. ALT-resolved. ✓.

**Duplicate instruction detection**: not needed here.

Now let me also sanity-check the **mark_opened + UpdatePluginV1 authority**: UpdatePluginV1 requires the plugin's update authority to sign. The Attributes plugin authority = seal PDA → invoke_signed with [SEAL_SEED, bump] ✓. But ALSO — UpdatePluginV1 on an ASSET with a collection: does it need the collection account? Passed ✓.

**Does mark_opened's UpdatePlugin work if the plugin authority is the seal PDA but the asset is FROZEN (PermanentFreezeExecute)?** close calls set_frozen(true) BEFORE mark_opened — so mark_opened runs on a FROZEN asset. Does PermanentFreezeExecute block UpdatePluginV1? PermanentFreezeExecute gates EXECUTE only (that's its name and the architecture statement: "PermanentFreezeExecute plugin gates whether ExecuteV1 is allowed at all"). UpdatePlugin is gated by... the plugin authority. So updating Attributes while frozen works ✓ (and tests pass).

Hmm wait, actually — does Core's UpdatePluginV1 check PermanentFreezeDelegate or freeze-execute? FreezeExecute blocks only Execute. ✓.

**One more (C) angle: can the OWNER update attributes themselves?** Plugin authority is the seal PDA (Address authority) — only via SEAL. The owner can't. ✓. Can the COLLECTION update authority (MINT PDA) update asset attributes? In Core, if the plugin authority is an Address, only that address. ✓.

**Can mark_opened be called on a vault whose Attributes plugin authority is NOT the seal PDA?** All vaults in the collection are minted by MINT with seal-PDA authority. A foreign asset in the collection? Only MINT can add assets (collection UA = MINT PDA) ✓. So all assets have seal-PDA Attributes ✓. But — what if the collection was created with collection-level plugins... irrelevant.

**What if UpdatePluginV1 fails because the asset has NO Attributes plugin?** All MINT-minted assets have it ✓.

OK, now let me also examine **(A) "Can a hostile-but-legitimate governor majority ... re-open a round to evade a cap?"** — YES: set_round resets minted_this_round; even without a new round, re-calling set_round resets the counter. And minted_total doesn't gate anything. ✓.

**"What is the WORST thing a ratified vote can do?"** — set price 0, cap 0, window forever → unlimited free mints (each still Bank-co-signed). Also set price absurdly high → no mints (harmless). Cannot redirect treasury, cannot touch seal/plugins/existing vaults. ✓.

**"Can admin and governance fight?"** — admin can rotate governance (neutralize); governance can't touch admin. Admin can halt minting via collection rotation (WiringDiverged) or bank rotation. Admin can redirect treasury silently (no event). ✓.

Now, the **single thing to fix before real money**: I think the strongest candidate is... hmm. The candidates: (1) enforce lifetime supply + wire minted_total, (2) charter provenance stamping, (3) treasury. Which is THE one? The prompt's business: vaults hold real BTC; resale depends on "this vault still contains its reserve." The provenance stamp is the anti-fraud signal for resale — and it's the weakest link: never stamped at mint (charter record absent), and the opened-stamp replaces the entire attribute list. But actually for REAL MONEY (BTC custody), the most dangerous on-chain gap... the seal/open/close/burn paths look solid. The economics gaps are governance/admin-gated. The provenance gap is a business-integrity issue affecting charter members and secondary buyers.

Hmm — "THE SINGLE THING to fix before this holds real money": I'd argue it's the supply/cap enforcement (minted_total dead + resettable cap), because the entire value proposition of the 2,100 vaults (and the 85% revenue stream to holders) rests on scarcity that the code comments claim exists but doesn't. Alternatively the provenance. Let me pick: the comment-vs-code on minted_total is the sharpest "the code claims X and doesn't do it" — and it's cheap to fix (one require). I'll make the single thing: enforce the lifetime cap (wire minted_total into a require with a MAX_SUPPLY constant) — no wait. Hmm, actually, let me reconsider: which failure loses CUSTOMER money? Customers' BTC is guarded by the seal paths (solid). Customers BUYING vaults are guarded by scarcity + provenance. Charter members' standing is guarded by provenance (absent). The treasury 85% is guarded by admin trust.

Actually — maybe the single thing should be the provenance stamp, because the prompt emphasizes "A buyer's entire basis for paying is 'this vault still contains its reserve'" and the stamp is the only on-chain anti-fraud signal — and it's both never-populated and destructive. But the stamp being weak doesn't lose reserve BTC; a buyer can verify reserve by... reading the ATA balance! The reserve is verifiable directly (ATA address derivable, balance readable). So a buyer doesn't need the stamp to verify contents — the stamp matters for CHARTER provenance (which is otherwise unrecoverable — PoB token and Notice destroyed). So the provenance loss is permanent and unrecoverable — that's the sharpest business break: "the ONLY surviving record" never survives because it never exists.

Hmm, but for "holds real money" — I'll go with: wire the supply cap (minted_total) — no. Let me decide: THE SINGLE THING = the charter provenance / attribute stamping, because it's irreversible (once charter members redeem, the record is gone forever; once secondary sales happen on false premises, unrecoverable) — versus the supply cap which governance could also just... also irreversible dilution. 

Actually, you know, let me weigh once more. The instruction says "End with THE SINGLE THING to fix before this holds real money." Real money = customers' BTC + customers' payments for vaults. The most consequential, cheapest-to-fix, currently-invisible defect... I think I'll go with the provenance stamp system (mint-time stamping + append-not-replace in mark_opened), framed as: the on-chain record the business depends on for resale integrity does not exist, and the one write path that does exist destroys data. Hmm, but honestly the supply cap is more "money" — dilution directly devalues every holder.

Let me just pick the supply cap as the single thing? Or combine: "the code's own comments promise two protections that don't exist — minted_total and provenance — pick the supply one because dilution is irreversible and cheap to fix." I'll go with: enforce the lifetime supply cap (make minted_total a real check) — one line — because everything else is gated by the Bank co-signature, but supply dilution with Bank collusion... hmm, Bank colludes either way.

Eh. Decision: THE SINGLE THING = wire minted_total into an enforced MAX_SUPPLY require (and stop resetting the per-round counter without consuming it), because the comment already promises it, the fix is one line, and unbounded dilution is the one ratified-vote action that takes value from every holder with no on-chain brake. I'll mention provenance as the runner-up in the finding itself.

Hmm, wait — actually, let me reconsider ONE more time whether there's a true CRITICAL hiding. Let me re-examine the open/close introspection for the "ends thawed" invariant with CPI more carefully, because that's where real BTC loss would live.

The claim: any tx that thaws must contain a top-level close that executes. Proof sketch: open (top-level or CPI) requires a top-level close at index > current-top-level-index with matching asset+owner. For the tx to succeed, that close instruction must succeed. Close re-seals. Could the close succeed WITHOUT re-sealing? set_frozen(true) is unconditional in close. Could set_frozen(true) fail silently? invoke_signed error → close fails → tx fails. So any successful tx containing an open ends with the asset frozen... 

WAIT. What if the tx contains open(A) at index 0 and close(A) at index 5, and at index 3 there's ANOTHER open(A)?? Second open at 3: scans forward from 4: finds close at 5 ✓ → thaws (idempotent). Close at 5 re-seals ✓. Fine.

What if close(A) at 5 is followed by open(A) at 6? Open at 6 scans forward: nothing → fails ✓.

What if the tx has open(A) at 0, close(A) at 5, and between them at index 2, a CPI'd open(B) inside program X's instruction? CPI'd open(B): current top-level index = 2, scans top-level indices >2 for close(B) — if close(B) is at 7 ✓ thaws B. Then top-level close(B) at 7: scans 0..7 for top-level open(B) — the open was a CPI (not in sysvar) → NOT FOUND → close(B) fails → tx fails ✓. So CPI'd opens can never be legitimately closed... meaning CPI'd open always eventually fails the tx UNLESS there's also a top-level open(B) earlier. If there's a top-level open(B) at 1 and CPI'd open(B) at 2 (redundant thaw), close(B) at 7 finds top-level open at 1 ✓. Fine.

So: no thaw-without-close. I'm confident. State it in "what I could not break."

Also — **could the Bank's signature be reused across... no, signatures are per-tx.**

**Could open be called with bank = config.bank where config.bank is a PDA that signs via CPI?** bank is Signer<'info> — in a CPI, a PDA of the calling program could satisfy the signer bit IF the calling program invokes with invoke_signed for that PDA. So program X could CPI open_for_redemption with bank = X's PDA IF config.bank == X's PDA. config.bank is admin-set — if the Bank is a PDA of some program, that program can co-sign via CPI. That's fine (it's still "the Bank"). Not a finding.

**Could the OWNER be a PDA via CPI?** Same — if the asset owner is a PDA, the owning program CPIs. Fine.

**Reentrancy**: Core CPI back into SEAL? No path.

**What about `payer` in open/close being the same as owner/bank?** Fine.

**Rent/minimum balance for config accounts**: init space computed: SEAL: 8+32+32+32+4+(32*8)+1 = 8+96+4+256+1 = 365. Actual need: 8 + 96 + 4 + 32*n + 1. For n=8: 8+96+4+256+1=365 ✓. MINT: 8+32*5+4+8+8+8+4+4+8+1 = 8+160+4+8+8+8+4+4+8+1 = 213. Struct: admin32+collection32+bank32+governance32+treasury32=160; round_id u32=4; opens_at 8; closes_at 8; price 8; cap 4; minted_this_round 4; minted_total 8; bump 1 → 8+160+4+8+8+8+4+4+8+1=213 ✓. BURN: 8+96+4+256+1=365 ✓. All good.

**Anchor `has_one = governance` on SetRound** — config.governance must equal the governance signer ✓.

**update_wiring has_one = admin** ✓.

Alright — also the prompt asks: "Is the byte layout right for an Anchor account whose struct is admin/collection/bank/Vec<Pubkey>/u8?" — YES, verified above. Say so.

"What is NOT cross-checked (reserve_mints, admin, the seal PDA itself)?" — reserve_mints (found), admin (fine), seal PDA (MINT derives seal_pda from SEAL_PROGRAM_ID — consistent with SEAL's own PDA since same program ID + seed ✓... unless SEAL is at a new address, covered).

Now let me also double check the **BURN second loop nested-asset check**: `if acc.owner == &MPL_CORE_ID { require!(d.is_empty() || d[0] != KEY_ASSET_V1) }` — but this only checks DECLARED remaining accounts. A nested vault (asset-signer PDA owns another Core asset) — the nested asset's address is arbitrary (asset keypairs are random); the caller would have to DECLARE it. If not declared → invisible → burn proceeds → nested asset... wait, if the outer vault is burned, the outer asset-signer PDA can no longer sign (Execute needs the asset). The nested asset is owned by the PDA → permanently stuck. So burning a vault containing an undeclared nested vault destroys the nested vault's accessibility. The Bank co-signs and should alarm (its scanner sees the PDA's assets via... Core assets owned by the PDA — getAssetsByAuthority? The Bank can enumerate Core assets by owner). Known-ish (completeness = Bank's job, stated for token accounts; nested assets are enumerable off-chain). The "nested-vault guard" fix is opt-in via declaration. Mention briefly? It's the same completeness class. One line maybe. Actually the BURN header says "CANNOT prove: completeness... a NON-ATA account holding value and simply not declared is invisible" — they scope it to token accounts but the same applies to nested Core assets. Minor note.

Also — **burn_vault doesn't check the Attributes "opened" stamp or require a redemption** — burning a pristine (never-opened) vault: reserves must be empty, so it holds nothing. Burning an empty pristine vault is fine.

**Does burn_vault require the vault to be FROZEN?** No — but a thawed vault means an open happened without close... impossible per invariant. ✓.

Let me now also quickly reconsider: **is there any way the mint payment goes to treasury but the vault goes to owner while the Bank... ** fine.

**MINT: `owner` UncheckedAccount — could owner be the BANK? Sure, fine.**

**Could mint_vault be called with asset keypair reused across two mints in one tx?** Second CreateV2 fails ✓.

**Config account closure**: no close instructions anywhere ✓ (configs immortal).

**Are there any missing `mut`s that would fail?** Anchor would error at runtime; tests pass.

OK — I also want to double-check the claim in the MINT header: "existing vaults are untouchable regardless: permanent plugins are create-only, so no vote can ever reach backwards into a vault already minted." True for plugins. But governance CAN affect existing holders economically via dilution (new vaults at price 0 → the 85% revenue stream → treasury → holders... dilution of scarcity). The comment is about plugin/seal reach — accurate there. Fine.

One more economics check: **the 85/15 split** — on-chain, 100% of price goes to treasury. The 15% to the Bank and 85% distribution to holders is entirely off-chain. The treasury is admin-rotatable. So the "85% back to vault holders" is pure trust. MEDIUM finding (asked directly by the prompt).

**Events for set_round/update_wiring**: set_round emits RoundSet ✓; update_wiring emits NOTHING (silent treasury/governance rotation). Include in finding.

Now — word budget: under 1600 words, findings first. Let me structure:

1. HIGH — Lifetime supply unenforced; minted_total is write-only; per-round cap resettable mid-round by re-calling set_round; price 0 allowed. Comment claims protection that doesn't exist. Exploit: governance majority (or captured governance key — one signature) calls set_round(0, i64::MAX, 0, 0) → unlimited free mints, each needing only the Bank's routine co-sign; or re-call set_round mid-round to reset minted_this_round and evade any cap. Fix: `require!(minted_total < MAX_SUPPLY)` + don't reset minted_this_round on re-set / track per-round properly + minimum price if intended.

2. HIGH — Charter provenance never written on-chain; Attributes plugin created EMPTY at mint; no instruction anywhere can ever write the Notice serial/Governor standing (only the seal PDA can update Attributes, and SEAL's only write is mark_opened's single pair). And mark_opened REPLACES the whole attribute list (UpdatePluginV1 semantics), so any attributes ever added would be wiped at first redemption. The "only surviving record" of charter status does not exist; PoB token and Notice are destroyed at redemption per the business → charter status becomes permanently unprovable. Also resale signal: "opened" is set only on the redemption path ✓ but a drained-then-resealed vault is indistinguishable from opened-and-intact (buyer must still verify ATA balance — which they CAN, so signal is advisory). Fix: stamp provenance at mint (mint_vault takes/derives it), and make mark_opened append (read existing list or move the flag to a dedicated plugin/name field).

3. MEDIUM — Treasury: 100% of price flows to an admin-rotatable pubkey; the 85/15 split is not encoded; update_wiring emits no event → silent redirect. Fix: remove treasury from update_wiring or require governance+admin or emit events; document the trust.

4. MEDIUM — BURN's reserve_mints not cross-checked against SEAL's config despite the comment claiming the seal-config check guards "a trimmed reserve list." Divergence by omission (SEAL adds a mint, BURN doesn't) re-opens the destroy-token path for that mint. Fix: parse reserve_mints from the seal config bytes (offset 104..) and use THAT list, deleting BURN's copy.

5. MEDIUM/LOW — Byte-offset reads with no discriminator/version check; layout verified correct for the current struct (disc[0..8] admin[8..40] collection[40..72] bank[72..104] — matches Anchor serialization of Config); but a SEAL upgrade that reorders/inserts fields silently changes meaning; reads fail closed (WiringDiverged halt) in most cases but there's no version pin. Fix: check the Anchor discriminator + add a layout version byte, or expose a view instruction.

6. LOW — SEAL_PROGRAM_ID compile-time constant: if SEAL is ever redeployed at a new address, MINT keeps deriving the OLD seal PDA for plugin authorities → new vaults born frozen forever with no one able to unseal (the exact failure MINT's own comment warns about for stale constants). Fix: operational rule + on-chain migration check.

7. LOW — MINT update_wiring can rotate collection (halt-only, thanks to cross-check) and governance (admin silently neutralizes votes); SEAL/BURN correctly refuse collection rotation. Remove collection from update_wiring.

8. LOW — owner can be any non-signing PDA (another program's PDA, a Core asset-signer of a DIFFERENT vault) → bricked vault; only self-asset-signer blocked. Bank co-sign gates it.

9. LOW — 1 lamport to the asset-signer PDA permanently blocks burn_vault (lamports==0 check); recoverable only via owner+Bank thaw + Execute-drain. Note.

10. LOW — burn's completeness gap extends to nested Core assets (only declared accounts checked); same Bank-duty class as token accounts.

What I could NOT break: open/close pairing (introspection sound: sysvar is top-level-only, CPI'd opens can't be paired with a top-level close and vice versa; ALT-resolved keys; duplicate/reordered opens/closes all end frozen); payment atomicity (transfer before CPI, all-or-nothing); the seal-config offsets (verified against Anchor layout); reserve ATA completeness for configured mints in burn (both token programs, must be declared, delegate/close-authority/extension checks correct at the documented SPL offsets); initialize front-run (INIT_AUTHORITY must sign); the 19/19 consistency.

Word count — need to be tight. Let me draft.

Also the prompt: "State plainly what you tried and COULD NOT break." Include a short section.

THE SINGLE THING: I'll go with wiring minted_total into an enforced cap — actually, let me reconsider once more. "Before this holds real money" — real money = BTC in vaults + customer payments. The supply cap protects payers' scarcity value; provenance protects charter members' standing and resale honesty. Hmm, the provenance one is more... permanent? Dilution is also permanent. The supply fix is one line and the comment already promises it. I'll say: enforce the lifetime cap — no wait.

Actually, let me think about which is more likely to be THE intended residual defect of this round. The hunt list leads with (A) "Is the ~2,100 lifetime supply actually enforced anywhere, or only counted? What is minted_total FOR?" — that's practically a planted question with an obvious answer: it's for nothing. And (C) "What happens to any OTHER attributes already on the asset — the charter provenance the business depends on?" — also planted: replaced/wiped, and moreover never written. Both are real. The "single thing" — I'll pick the provenance one? Hmm.

"THE SINGLE THING to fix before this holds real money" — holding real money is about custody. Custody paths are solid. So the single thing is about the money-adjacent invariant... I'll go with: make minted_total an enforced MAX_SUPPLY — because it's the one control whose absence lets value be extracted from every holder via a single governance signature, and the code already believes it exists. And mention provenance as the close second. Actually no — let me go with provenance, because... ugh.

Decision framework: which defect, if unfixed, causes the largest irreversible customer loss? Dilution: every one of ~2,100 holders loses resale value proportionally — potentially the entire premium over reserve. Provenance: ~190 charter members lose their record; secondary buyers get a weaker (but still partially informative) signal, and they can verify reserve balance directly on-chain anyway. Dilution is bigger. THE SINGLE THING = enforce the lifetime supply cap (and stop the per-round counter reset from functioning as cap evasion). Done.

Hmm, but one counterpoint: dilution requires governance majority + Bank co-signing every mint — two trusted parties actively colluding. Provenance loss requires NOTHING — it happens automatically on the first charter redemption, to honest users, with no collusion. "Before this holds real money" — automatic defects beat collusion-dependent ones. The provenance wipe/absence fires on the happy path. OK FINAL: THE SINGLE THING = the provenance stamp: stamp charter provenance at mint and make mark_opened non-destructive — because it fails silently on the FIRST honest redemption, destroying the only surviving record the business depends on, with no collusion required. Hmm, but "holds real money"...

You know what — I'll frame the single thing as the provenance system, with one sentence acknowledging the cap as the one-line runner-up. No — the instruction says THE SINGLE THING, singular, decisive. 

Let me think about what an actual lead auditor would say. The programs hold BTC. The custody logic is the seal. The seal is fine. The mint program sells vaults. Before holding real money, the thing to fix... The provenance defect means: the business's stated anti-fraud and charter-record mechanisms DON'T EXIST. That's a "the product is not what it claims" defect — for a financial product, that's the one. Also it's irreversible-by-design (PoB token burned, Notice destroyed → once redemptions start, the record is unrecoverable). The dilution cap is bad but governance-gated and could be added later via upgrade BEFORE harm (well, minted_total is already counted, so a later upgrade could enforce retroactively — the DATA is there! minted_total is written, so an upgrade can later enforce the cap using accumulated data. Whereas provenance data, once lost, is lost forever — you cannot retroactively reconstruct which vaults were charter after the PoB token is burned). THAT settles it: the provenance defect is unrecoverable-later; the cap defect is recoverable-later (counter exists). THE SINGLE THING = provenance stamping (write charter provenance at mint; make mark_opened append/preserve). 

Good reasoning. Now write it. Under 1600 words. Findings first, most severe first. Be concrete with exploits (who signs what, in what order). Include "what I could not break." Keep the tone: fault-finding, no praise, assume author wrong until proven.

Let me make sure each finding has: severity, exact construct, concrete exploit, fix.

Finding 1 (HIGH): Supply cap fiction.
Construct: MINT `mint_vault` — `minted_total` incremented, never read. `set_round` resets `minted_this_round = 0` unconditionally, including mid-round re-calls. No MAX_SUPPLY anywhere. Comment at minted_total: "Never reset... so without this a governor could lift any cap by simply opening a new round" — the field does not lift anything; it is write-only.
Exploit: (i) Governance signer calls set_round(opens_at=now-1, closes_at=i64::MAX, price=0, cap=0). Every subsequent mint_vault is free and uncapped; each needs only the Bank's routine co-signature. 10,000 vaults, scarcity gone, every holder's resale premium destroyed. (ii) Even with a "strict" cap: mid-round, governance re-calls set_round with the same window — minted_this_round resets to 0 — cap evaded without even a new round. (iii) price_lamports=0 is accepted: free mints are expressible.
Also note: nothing links the ~2,100 to code; "intended" is off-chain.
Fix: `require!(c.minted_total < MAX_SUPPLY)` in mint_vault; refuse set_round while a round is open or don't reset minted_this_round when round_id/window unchanged; decide and enforce a minimum price or document that 0 is legal.

Finding 2 (HIGH): Provenance never stamped; mark_opened destroys the list.
Construct: MINT CreateV2 builds Attributes plugin with `attribute_list` length 0 (`data.extend_from_slice(&0u32.to_le_bytes())`). No instruction in any of the three programs writes the Notice serial or Governor standing: the Attributes authority is the seal PDA, and SEAL's only Attributes write is mark_opened's single pair. Core's UpdatePluginV1 REPLACES the plugin's data, so mark_opened's one-pair list overwrites whatever was there.
Exploit (no attacker needed — the happy path): charter member redeems (open → sweep → close). close_redemption → mark_opened → attribute list becomes exactly [{"redemption":"opened"}]. The PoB token was burned and the Notice destroyed at redemption (per the business), so after the FIRST charter redemption there is no record anywhere that the holder was charter. The business's "only surviving record" never survived because it was never written. Secondary effect: any future attributes (e.g., added by a later SEAL upgrade) are wiped at first redemption.
Also: "opened" is honest but weak — a fully drained re-sealed vault is indistinguishable from opened-and-intact; buyers must verify the ATA balance directly (which is possible, so this is a documentation issue, not a fraud hole).
Fix: mint_vault must accept and write the provenance attributes at creation (or a dedicated SEAL instruction to stamp at mint, owner+Bank signed); mark_opened must preserve existing attributes (read the asset's current list and append) or use a dedicated field/plugin for the opened flag.

Finding 3 (MEDIUM): Treasury — the 85% is a promise, and it's silently redirectable.
Construct: MINT update_wiring takes `treasury: Option<Pubkey>`, admin-only, no event. mint_vault sends 100% of price to cfg.treasury.
Exploit: admin (one key/multisig) calls update_wiring(treasury=attacker). Every subsequent mint pays 100% to the attacker; the 85/15 split is unenforceable and unobservable (no event; watchers must poll account data).
Fix: remove treasury from update_wiring (set at initialize, like SEAL treats collection), or require governance co-signature for rotation, and emit WiringUpdated on every change (also for governance rotation).

Finding 4 (MEDIUM): BURN's reserve list is NOT canonical despite the comment.
Construct: BURN reads seal_config bytes but compares only collection [40..72] and bank [72..104]. Its own reserve_mints (BurnConfig) drive the ATA checks. The header comment claims the cross-check prevents "a trimmed reserve list."
Exploit: SEAL admin adds cbBTC-successor mint X via update_config (allowed — only DROPPING is blocked). BURN admin never adds X (update_config on BURN is a separate, forgettable act). A vault holding X in its X-ATA burns cleanly: the X-ATA is never derived, never required, never checked. Token destroyed with the vault. The Bank's alarm is the only backstop — the same backstop the comment claims the cross-check provides.
Fix: delete BurnConfig.reserve_mints; parse the Vec from seal_config at offset 104 (4-byte len + 32-byte entries) and iterate THAT.

Finding 5 (LOW/MEDIUM): Offset reads with no discriminator/version pin.
Construct: MINT/BURN read fixed offsets, check only owner==SEAL_PROGRAM_ID and len>=104. Verified: the layout IS correct for the current struct (Anchor: 8-byte disc, admin 8..40, collection 40..72, bank 72..104, then Vec len + entries, then bump). No discriminator check, no version byte.
Consequence: a SEAL upgrade that inserts/reorders Config fields changes the meaning of [40..104] silently. Mostly fails closed (WiringDiverged halt) but there is no pin; a same-length layout change that moves a field the check doesn't read into [40..104] would pass wrongly only if values coincidentally match — unlikely but unpinned.
Fix: require the 8-byte Anchor discriminator of Config and add a layout version u8 the readers check.

Finding 6 (LOW): SEAL_PROGRAM_ID constants.
If SEAL is ever redeployed at a new address, MINT still derives the OLD ["seal"] PDA into new vaults' plugin authorities — born permanently frozen, unreachable by anyone (the exact failure MINT's own header describes for a stale constant). Also all seal_config reads target the old program's config. Fix: treat SEAL address migration as a coordinated hard event; consider a migration guard.

Finding 7 (LOW): update_wiring can rotate collection and governance.
Collection rotation in MINT is halt-only (seal-config cross-check pins it → WiringDiverged) but is a one-signature mint kill-switch; governance rotation lets admin silently neutralize votes. SEAL/BURN correctly refuse collection rotation. Fix: drop `collection` from update_wiring; emit events for governance/admin rotation.

Finding 8 (LOW): owner can be any PDA.
OwnerWouldBrick blocks only owner == the new asset's own asset-signer. owner = any other program's PDA (or another vault's asset-signer) yields a vault whose owner can never sign open/close/burn — bricked, Bank-co-signed into existence. Fix: require owner to be a signer OR explicitly document the Bank's duty to refuse PDA owners.

Finding 9 (LOW): 1-lamport PDA grief on burn.
Anyone sends 1 lamport to ["mpl-core-execute", asset] → asset_signer.lamports() != 0 → burn_vault permanently fails until owner+Bank thaw and Execute-drain the lamports. Recoverable, annoying, worth a comment.

Finding 10 (LOW): burn completeness extends to nested Core assets — only DECLARED remaining accounts are checked for KEY_ASSET_V1; an undeclared nested asset is invisible and gets stranded by the burn. Same Bank-scanner duty class as non-ATA token accounts; the header scopes the caveat to token accounts only.

Could NOT break:
- The open/close pairing. Tried: CPI'd opens/closes (the Instructions sysvar lists only top-level instructions, so a CPI'd open can never find its close and a top-level close can never find a CPI'd open — both orderings fail the tx); duplicate opens with one close (idempotent thaw, still ends frozen); open-after-close (forward scan fails); mid-tx owner transfer (close's owner check contradicts the scan's owner binding); sweeps after the close (frozen; Execute fails). Every successful tx containing an open ends frozen.
- Payment atomicity: transfer precedes CreateV2; any later failure reverts the payment. Exact-amount transfer; no over/under-payment state exists.
- The seal-config offsets: recomputed against Anchor's serialization of Config — they are correct as written.
- Burn's reserve-ATA completeness for CONFIGURED mints: both token programs, must be declared, owner/delegate/close-authority/extension checks at the documented SPL offsets are correct; non-token accounts at ATA addresses are skipped (the 1-lamport ATA grief fix is real).
- initialize front-run: INIT_AUTHORITY must SIGN, not merely be known.
- set_round auth: has_one=governance + Signer.

THE SINGLE THING: the provenance stamp. Stamp charter provenance at mint and make mark_opened preserve existing attributes. Rationale: it fails on the FIRST honest charter redemption with no collusion, and it is unrecoverable after the fact — the PoB token and Notice are destroyed at redemption, so no later upgrade can reconstruct charter status. (The supply cap is the runner-up but is retroactively fixable: minted_total is already written, so an upgrade can enforce the cap later; lost provenance cannot be restored.)

Wait — is that last claim right? minted_total is written on every mint, so yes, a later upgrade can enforce MAX_SUPPLY using the accumulated counter. Provenance: once a charter vault is opened (attributes replaced with the single pair) and the PoB token burned, the charter linkage is gone — unless off-chain records (mint tx history, VaultMinted events with round_id) survive. Hmm — VaultMinted events include round_id! Charter mints would be round 1 (or price 0 rounds). So charter status IS reconstructible from event history (round_id + price_lamports=0)... if the "charter round" is identifiable. Events are on-chain forever. Hmm, that weakens my "unrecoverable" claim. But the BUSINESS says the stamp is "the ONLY surviving record" — they intend