# Independent Security Audit — CBOB Vaults v6, Final Tree

I read the whole tree. I recomputed every cross-program offset, every account-space constant, the boost ring's wrap arithmetic, the pool invariant across credit/claim/join/reweigh/retire, the redemption pairing in both directions, the rate-limit ring, the sweep helper's pair logic and the pages' instruction builders against the programs. I verified round 42's two confirmed findings and their repairs at the code level. Below is what I found.

---

## R0 — Round 42's verdict and repairs

**V42-1 (local ceremony server crash):** The repair holds. `staticFile` in `web/deploy/ceremony-local.mjs` now wraps `decodeURIComponent` in `try/catch { return null }`, and the listener is exported as `localListener` with a catch-all. The malformed-path arm (`/%E0` → 404, server survives) is wired into `proxy.test.mjs`.

**V42-2 (collectionCreator misreads a front-run):** The repair holds. `collectionCreator` now iterates the history oldest-first, skips every transaction with `s.err` or `tx.meta?.err`, and looks for the oldest **successful** `CreateCollectionV2` of the exact address. If none is found in a complete history, it returns `unverifiable` (prominent "pin it" warning, step 0 still offered), never `other`. The two older arms that expected `other` were updated.

**C12 gate-5 measurement** reopened a finding (limit 59) and the `checkNewAddress` page repair is wired into buy, claim and ceremony step 0. The arms R42.C12a–d pin the System `0x0` refusal and the fresh-address control. These hold.

I found no regression from either repair.

---

## Findings

### LOW — `MINT_CONFIG_SPACE` is 97 bytes short; `CONFIG_PADDING` is 159, not 256

**Construct.** `programs/cbob-vault-mint/src/lib.rs`, the `MINT_CONFIG_SPACE` constant.

The constant's fifth line (covering stage 3c fields through `boost_expiring` + `CONFIG_PADDING`) is:

```
+ 32 + 1 + 2 + 8 + 1 + 2 + 4 + 4 + 8 + 8 + 4 * BOOST_RING + CONFIG_PADDING
```

This computes **326 + 256 = 582** for a section that needs **423 + 256 = 679** bytes. The 97-byte deficit is the **entire stage-3c field block** (pending_guardian 32, pending_guardian_set 1, pending_guardian_at 8, notice_secs 8, sweep_floor_lamports 8, cooldown_ceiling_secs 8, reserve_ceiling_lamports 8, dist_epoch 8, pending_count 8, pending_this_epoch 8 = 97), which appears nowhere in the expression. The line maps directly to the boost-section fields (cbob_mint 32, max_boost_weight 1, max_boost_epochs 2, boost_price 8, boost_weight 1, boost_epochs 2, boosts_active 4, boosts_due 4, boost_weight_total 8, cbob_burned_total 8, boost_expiring 256) plus padding.

**What the number is.** The constant evaluates to **1164**. The Borsh serialization of `MintConfig` (8-byte disc + 997 field bytes) is **1005** bytes. The account is therefore 1164 bytes with **159 bytes of padding**, not the stated 256. The program's own offsets confirm the struct's end: `OFF_BOOST_RING = 749`, `boost_expiring` is 256 bytes ending at **1005**.

**Consequence.** The programs work correctly today: 1005 < 1164, so every `initialize` write and every subsequent serialize/deserialize fits. But the comment *"ROOM TO ADD A FIELD WITHOUT BRICKING THE PROGRAM"* with `CONFIG_PADDING = 256` overstates the room by 97 bytes. Since the programs become immutable at step 11, no field will ever be added — so the practical cost is zero. The miscount is nonetheless a fact about the source that will persist forever.

**Evidence if true.** Recompute `MINT_CONFIG_SPACE` by summing every field of `MintConfig` (disc 8 + 997 fields = 1005 needed, plus 256 padding = 1261 intended). The constant yields 1164. A `cargo test` that allocates `MINT_CONFIG_SPACE` bytes and deserializes would pass (1156 > 997 from byte 8), which is why no existing arm catches it. The three other configs (SEAL 398/142, BURN 827/571, GOV 350/94) are each correct with exactly 256 bytes of padding.

**Severity: LOW.** No functional impact; the fix is one number.

**Fix.** Change the fifth line to include the missing 97 bytes (or recompute the constant from the struct). Alternatively, note the actual padding is 159 in the comment and leave the constant alone — but a constant that miscounts by 97 is the kind of thing the next reader will trust.

---

## Coverage gap (not filed as a defect; needs measurement)

**BURN's `VaultStillHoldsAVault` catches only `Key::AssetV1` (byte value 1), not `Key::HashedAssetV1` (2) or `Key::CollectionV1` (5).**

In `programs/cbob-vault-burn/src/lib.rs`, the declared-account loop does:

```rust
if acc.owner == &MPL_CORE_ID {
    let d = acc.try_borrow_data()?;
    require!(d.is_empty() || d[0] != KEY_ASSET_V1, BurnError::VaultStillHoldsAVault);
    continue;
}
```

A Core account whose first byte is 2 (`HashedAssetV1`, a real Core key per `web/src/lib/decode.mjs`'s `CORE_KEY` map) or 5 (`CollectionV1`) passes the check. If a builder **declares** such an account in `remaining_accounts`, BURN does not refuse; the burn succeeds and the asset is destroyed.

**Why I am not filing it:** The page never declares non-`AssetV1` Core accounts (its `declared` list is reserve ATAs only). An undeclared nested asset is the accepted completeness gap (proven impossibility 2, limit 44). And I cannot confirm from this tree alone that `HashedAssetV1` is instantiable on the pinned Core binary. If it is, the gap is real for custom builders; if not, it is moot.

**Evidence that would settle it:** On the pinned Core binary, create a `HashedAssetV1`, transfer it to a vault's PDA, declare it in a `burn_vault`'s remaining accounts, and observe whether BURN refuses (`VaultStillHoldsAVault`) or the burn lands. If it lands, the fix is to reject any key other than `Uninitialized` (0) in that branch.

---

## Accepted limits review (the four questions)

**1. Is any limit WORSE than stated?**

No. I tested the ones that could plausibly be understated:

- **Limit 32 (rate limit reads one higher during an unretired bare burn):** accurate. `live = minted_total − burned_total − bare_retired` is overstated only by the count of bare-burned-but-unretired vaults. This loosens the cap briefly (making it *less* strict), which the text says.
- **Limit 40 (Core upgradeability):** the three named consequences (burn proof, level queue, Execute authority) match the code's dependencies. The sweep helper's access control is Core's `ExecuteV1` rule; SR.5/SR.5a/SR.5c/SR.5d pin the measured behaviour. No fourth consequence I can see.
- **Limit 55 (unsplit revenue shared by a joining vault):** the attack costs 100–200 $GARY and requires a funded vault; the text is accurate.
- **Limit 46 (PoB hot wallet through the charter window):** the text says "end the project or capture governance" and names both paths. It does not understate what the key can do.

**2. Is any limit not actually a limit?**

**Limit 51 (boost timing)** is listed under DISCHARGED with its residue disclosed. The residue ("a boost earns from the next distribution") is real and tested (BO.21/BO.22). It is a limit.

**Limit 35 (10% turnout never binds at ruled numbers):** confirmed by arithmetic. With quorum 21% and threshold 51%, minimum YES is 10.71% of the snapshot, which exceeds the 10% turnout floor. The floor only binds at other `initialize` values. It is a real floor, correctly described as such.

**3. Is any DISCHARGED item not actually discharged?**

All checked discharged items are discharged. Item 14 (duplicate attributes) is closed on chain at both entry points (`check_attributes` is shared; suite R42.C8 pins the claim path). Item 19 (unlevelled-vault halt) is gone with `levels.json` and the two-step activation. Items 30, 31, 33 match their replacements.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?**

No. Items 22, 38, 50, 52 and 53 all carry explicit "not started" or "OPEN" markers in the road table and the launch file. `charter_opens_at`, `lock_deadline` and `vault_collection` are `null / OPEN` in `launch/mainnet-init.json`, and `judgeLaunch` refuses them. Item 50's holder-guide publication gate is stated.

---

## What I checked and found sound (no finding)

For the record, so the next reader does not re-litigate:

- **Redemption pairing:** SEAL's forward walk and BURN's backward walk both bind asset (index 0) and owner (index 2), both are top-level-only (the instruction sysvar sees only top-level), and `retire_redeemed`'s stack-height check (height exactly 2) refuses wrappers. WR.1–WR.4 and R27 measure all four wrapper shapes.
- **Sweep helper:** Direct calls need the signer's signature and every source must be owned by the signer. Through Core, only the asset owner can Execute (SR.5/SR.5a). Duplicate sources, foreign sources, mismatched destinations, wrong programs, odd account counts, frozen sources, and kept-close-authority accounts are each refused (SR.6–SR.14, R36.C5). The zero-pair lamports-only sweep works (SR.13). The lamport sweep empties the wallet to exactly 0, which BURN's `lamports == 0` check sees.
- **Boost ring:** I traced the collision case (two boosts mapping to the same slot with different end epochs) and proved it cannot happen for **overlapping** boosts: the modular arithmetic forces equal end epochs, which the ring handles correctly. Non-overlapping boosts reuse slots safely. The 63-distribution bound (BOOST_RING − 1) is the invariant that makes this hold. Both host unit tests (260 epochs, four wraps) and the on-chain suite (BO.34, BO.38) exercise wrap and early-retire.
- **Pool invariant:** `owed_scaled` is exactly the sum of every active vault's `weight × acc + carry − debt` at all times across `credit`, `claim`, `join`, `reweigh`, `expire_boost` and `retire`. Suite `ledger()`/`ck()` re-derives this from every record after each money operation (BK.IN, BK.3c, BK.P).
- **Cross-program offsets:** I recomputed all 26 pinned offsets (MINT 141/442/454/518/526/574/582/614/615/623/631/639/647/711/712, SEAL 9/41, BURN 42, GOV 53/86, VaultRecord 41/125/127/129/161/177/186/187/195) against the struct field sizes. Every one is correct. The test's offset map matches the structs exactly.
- **Rate limit ring:** The k-th-most-recent check bounds any rolling window to exactly `cap` redemptions. With `cap > 64`, the ring is stricter, never looser. RL.2–RL.7 and the replay check confirm.
- **Page instruction builders:** `web/src/lib/ix.mjs` byte-matches the suite's builders (enforced by `web/test/ix.test.mjs`). The redemption shape (claim → open → Execute(sweep) → Execute(transfer)×N → burn) is exactly what the programs expect. `signExact` refuses a wallet-modified message.
- **GOV execution:** Quorum/threshold/turnout/key-change arithmetic, the per-kind ordering marks, the skip-not-revert rule, the `VaultTooNew` snapshot and the `StopIsNewer` tie-break all match SPEC. F18.1/F18.2/D.1/3c.K2 measure the boundaries.

---

## Given that no human firm will ever see this and the programs will be immutable, what should this project do before launch that AI audit structurally cannot?

1. **Run the mainnet dress rehearsal (item 22) with a human watching the terminal.** The revenue cycle's hand recovery (a forced post-sweep failure walked through the runbook) is the one operational path no suite exercises. A human must confirm the alarm's CRITICAL fires, the open-cycle guard refuses the next run, and the recovery leaves `--audit` clean. An AI can read the runbook; it cannot sit at the keyboard when the swap fails at 3 AM and decide whether the ledger row is trustworthy.

2. **Have a person who was not involved in building this system hold the launch wallet and run the ceremony from the SSH-tunnel local mode.** The ceremony writes values that can never be changed. The page's own checks are thorough, but the person pressing "Sign" must independently verify each value against the ruling — not against the page's rendering of it. Print `launch/mainnet-init.json` on paper and read it aloud at each step.

3. **Before removing the upgrade authority, have someone who has never read this code attempt to build a transaction that moves value out of a sealed vault.** Give them the five program ids, the Core id, and a funded wallet. If they cannot, that is meaningful evidence. If they can, stop. AI audit reasons about what the code forbids; a determined human finds what it permits.

4. **Test the HashedAssetV1 question above on the pinned Core binary** (create one, send it to a vault PDA, declare it, observe BURN's response). This is one measurement that would either close a gap in the emptiness proof or confirm the proof is complete.

5. **Move the $CBOB release key and the swap operator key off this box** (limit 56, limit 10). No amount of program audit covers a secret in a file that a backup restores. Move them to hardware or a multisig, delete the box copies, and confirm the backups no longer carry them.

6. **Accept that this system's deepest risk is not in the five programs — it is in what happens when Metaplex upgrades Core.** Buy a monitoring subscription that alerts on any Core bytecode change within one slot, not one 30-minute alarm pass. The alarm detects; only speed of human response matters.

7. **Publish the holder guide only after the pages are live and someone who is not on the team has read it and said what they think it promises.** Then check every sentence against the code one final time. The guide is the contract with holders, and no AI round has tested comprehension — only accuracy.