# Round 39 independent audit — CBOB Vaults v6

**Scope note.** I audited the bundled tree as given (programs, sweep helper, `web/`, off-chain readers, launch values, suite/sim/build evidence, and the round 38 verdicts). I had **read-only, static** access to the files in this prompt: I did not execute the suite, a validator, or any transaction. Where I say "measured," I mean recomputed by hand from the bundled source or cross-checked against a bundled measured run; I name the evidence that would confirm or refute each claim on chain or in a test run.

**Headline.** I found **no CRITICAL and no HIGH**. I independently re-derived the cross-program offsets, the pool accumulator invariants, the boost-ring conservation, the redemption pairing, and the sweep-helper pair rules, and I could not break custody of a sealed vault, the pool, or the revenue address. The round 38 program-side conclusion ("no confirmed defect in the five programs") **holds under my re-read**. I confirmed the round 38 repairs for V38-1, V38-2, V38-4, V38-5 in the bundled `web/` source. I found **one LOW** (a repair that deviates from the round 38 prescription and leaves a narrow residual) and **two INFO**. I also flag one measurement I could not perform.

---

## R0 — Round 38's verdict and its repairs

### Repairs I verified as present and correct

**V38-1 (LOW, redeem page `splice(-1)`).** Fixed. `web/src/lib/plan-redeem.mjs` now uses:
```js
const drop = (list, a) => { const i = list.indexOf(a); if (i >= 0) list.splice(i, 1) }
for (const a of noAccount) { drop(helperStrays, a); drop(transferStrays, a) }
```
This removes a no-receiver stray only from the list that actually holds it, so a late C5 stray can no longer be silently dropped from both `helperStrays` and `left`/`noAccount` and then trip the `judgeRedemptionCoverage` cross-check into a refusal. This matches the round 38 `m38.mjs` A1–A5 measurements. **Holds.**

**V38-2 (MEDIUM, per-arrival tick loop).** Fixed. The standing consent is present (`LATE_CONSENT_ID = 'late-arrivals'`, id carries no address/count/digest), and in `planRedemption` the final re-plan (`s.consented` set) moves any ack that is not already consented, not `forfeit`, and not `aboutKnown` into `lateInfo` instead of `ack`:
```js
for (const a of [...ack]) if (!s.consented.has(a.id) && a.id !== 'forfeit' && !aboutKnown(a)) { ack.splice(ack.indexOf(a), 1); lateInfo.push(a.text) }
```
So `prepareOpening`'s `newAcks = plan.ack.filter(a => !consented.has(a.id))` can only be non-empty for `forfeit` (Coinbase freezes the pool — not stranger-triggerable) or `aboutKnown` (a stray the holder was told they'd receive becoming undeliverable). I checked whether a stranger can trigger `aboutKnown`: a deliverable stray's mint has no freeze authority (that is why it was deliverable), a mint with no freeze authority cannot gain one, and the stray's close authority/owner is the vault PDA which a stranger cannot sign for. So `aboutKnown` is not stranger-triggerable. The `OPEN_ATTEMPTS = 2` cap bounds the dry-run loop. **The unblockability promise holds under my re-read.**

**V38-4 (INFO, SPEC limit 27 attribution).** Fixed. Bundled SPEC limit 27 now reads "*Who:* every OTHER holder (round 38 V38-4)…" and correctly explains the burner loses nothing and the share is taken from the remaining vaults. **Holds.**

**V38-5 (INFO, guide "everything comes out").** Effectively fixed. The guide now distinguishes "the vault's own three accounts and its wallet" (always swept) from "any other account someone sent to the vault" (only if named and movable; "anything that arrives after the page's last check is lost"). A reserve-mint C5 account is "another account," so the late-deposit case is covered. The wording is general rather than the exact "kept the right to close" sentence the verdict suggested, but it does not misstate what the holder receives. **Holds** (see INFO-2 below for a residual phrasing note).

**C01 (off-chain, crank sends joins from a frozen pool).** `bank/crank.mjs` was **not in my bundle**, so I could not re-run the R38 C01 gate-5 arm myself. The on-chain half is sound: a join-only `claim` pays nothing, so it succeeds against a frozen pool (a paying claim reverts, but pending vaults are owed nothing). I rely on the VALIDATION's stated arm and flag this as a **measurement I could not independently repeat** (see "Measurement limits").

### The one repair that deviates: finding F1

**F1 — LOW — Ceremony collection path deviates from the round 38 prescription; narrow second-collection residual.**

- **Construct:** `web/src/lib/ceremony-reads.mjs` `resolveCollection` (the `unverified` return) and `web/src/pages/ceremony.mjs` `steps` (offering step 0 beside `unverifiedBox`).
- **What round 38 prescribed:** VERDICT-programs V38-3 and gate-5 obligation #3 said: with no pin, an *unverifiable* candidate collection must be a **STOP**, and `ceremony.test.mjs:215-216` should be replaced with a STOP assertion ("step 0 is not offered").
- **What the code does:** the comment reads `ROUND 39 B4 (replaces round 38 V38-3's STOP)`. With no pin and no verified collection, unverifiable candidates are listed in a prominent warning ("if one of these is the vault collection you created, do NOT create another: pin it instead") and **step 0 is still offered**, gated only by an "I have copied it and recorded it" tick.
- **Why the deviation exists (and why it is defensible):** `collectionCreator` returns `unverifiable` once more than `HISTORY_PAGE × HISTORY_PAGES = 5,000` transactions name a candidate, or when the RPC no longer serves the creating transaction. A stranger can pad a candidate to >5,000 naming-transactions for roughly 0.025 SOL of fees. Under the prescribed STOP, that is a cheap **launch-day block**. B4 removes that block. So the deviation has a real, documented justification (VALIDATION.md, drift-sweep B4).
- **The residual:** in the narrow window after step 0 ran but before SEAL is initialized, with this browser's memory gone and nothing pinned, if the real collection is unverifiable and Gary clicks through the warning, a **second** collection is created. Both name MINT's PDA. The one recorded in `config.js` wins (pin beats discovery), so the other is orphaned — wasted rent and a confusing duplicate, but no vault is ever minted into it and no holder value is touched. It requires a human to ignore a prominent warning and a tick-box.
- **Evidence if I am right:** a unit test asserting "no pin + one unverifiable candidate ⇒ STOP, step 0 not offered" would **fail** against the bundled code (the code returns `collection: null, conflict: null` and offers step 0). Conversely, a test asserting "offer step 0 with a warning" passes. That is the inverse of the round 38 gate-5 #3 instruction.
- **Fix (choose one, and reconcile the record):**
  1. Implement the STOP but with an explicit typed-address override: to proceed anyway, Gary must type the exact candidate address he believes is correct. That keeps a stranger from cheaply blocking launch (no STOP without a human asserting knowledge) while eliminating the accidental-second-collection path; or
  2. Keep B4, and **update the round 38 verdict's gate-5 #3** to record that the STOP was superseded by B4, so the verdict and the code stop contradicting each other.
- **Severity rationale:** LOW, not higher — no value path, requires a human to disregard a warning, and the deviation is documented. But it is a real case where a confirmed finding's prescribed repair was not implemented as written, which is exactly what R0 asks me to check.

### INFO findings

**INFO-1 — `web/src/config.js` `RELEASE_COMMIT` is pinned to round 35 (`0b3ddb3`), and is correct only because no program changed in rounds 36–38.** The build refuses unless `dist/MANIFEST.txt` names exactly `RELEASE_COMMIT`, and the ceremony verifies deployed program bytes against `MAINNET_PROGRAM_BYTES` (round-35 hashes). I checked the round 36/37/38 change lists: all confirmed repairs were in `web/`, `bank/`, and docs; none touched `programs/`. So the round-35 hashes still describe the current programs, and the mechanism **fails closed** (if a program ever changes, the ceremony refuses on hash mismatch). This is a safety property, but it is a tight coupling: the moment any program byte changes, `RELEASE_COMMIT` and `MAINNET_PROGRAM_BYTES` must be bumped in the same change or the web build/ceremony will refuse. Worth an explicit checklist line at road step 9/11.

**INFO-2 — Guide's reserve-account promise is accurate but subtle.** The honest-list sentence "whatever cbBTC, $GARY, $GIRAFFISH or SOL is in the vault's own three accounts and its wallet right then comes out to you" is true for the three reserve **ATAs** (always in `reservePairs`, always swept). A non-ATA reserve-mint account (the C5 class) is "another account," covered by the next sentence. A holder could still read "whatever cbBTC" as including a stray cbBTC account. Consider one clarifying clause: "…in the vault's own three reserve accounts **(the ones the Bank tracks)**…". Documentation-only; misstates nothing material.

---

## R1 — Custody: can anyone but the owner get value out of a sealed vault?

I could not find a path.

- **Pairing.** SEAL walks the instructions sysvar forward from `current+1` for a top-level `burn_vault` matching **asset and owner**; BURN walks backward for a top-level `open_for_redemption` matching **asset and owner**. Both use `load_current_index_checked`/`load_instruction_at_checked`, which see top-level instructions only, so a CPI-wrapped burn/open cannot satisfy either half. Both bind account index 0 (asset) and 2 (owner). A wrapper needs a genuine top-level counterpart for the *same* (asset, owner) pair, which is exactly what the suite's WR.1–WR.3 arms refute. I re-read the discriminator and index constants in all three programs; they agree (`IX_BURN_VAULT_DISC`, `IX_OPEN_FOR_REDEMPTION_DISC`, asset idx 0, owner idx 2). Two vaults in one transaction cannot borrow each other's open/burn because both halves bind the specific asset+owner.
- **Emptiness proof.** BURN requires PDA lamports == 0, every reserve mint's ATA under **both** token programs declared, PDA-owned, undelegated (`d[72..76]`, `d[121..129]`, `d[129..133]` all zero), extension-free (`len == 165`), amount 0, and no declared account a live Core asset. The delegate/close-authority byte offsets match the SPL Token 165-byte layout. Token-2022 is refused by the `len == 165` check (a T22 ATA is 170+), which is deliberate (confidential balances read zero in the base amount).
- **Thawed vault leaving unburned.** Not possible: SEAL only thaws if a matching burn is *later* in the same transaction; if the burn fails or is absent, the whole transaction reverts and the thaw is undone atomically. There is no instruction that re-seals, but there is also no instruction that leaves a thawed vault surviving a redemption — the burn is terminal.

**Evidence that would refute me:** a transaction on a validator that thaws a vault and ends with the vault alive and unsealed. The suite's 3.6/3.8/WR arms are the negative evidence; I found no shape they miss.

## R1s — Sweep helper

I re-read `programs/cbob-vault-sweep/src/lib.rs` line by line.

- **(a) Access control.** The helper itself checks only `signer.is_signer`. The real gate is Core `ExecuteV1`, which signs the asset-signer PDA only for the asset's owner (accepted limit 40; suite SR.5/SR.5a/SR.5c measure `NoApprovals 0x1a` for stranger/delegate/update-authority on a thawed vault). Called directly, nobody but the PDA can sign, and only Core can sign for the PDA. I cannot re-prove Core's rule statically, but the pinned-binary measurements are cited and consistent with the code's reliance on it.
- **(b) Pair list.** Duplicate source: first pass closes it; second pass `read_token` sees `len != 165` → `InvalidAccountData` (SR.12a). Source==destination would force `signer==dest`, refused up front. Destination must be owned by `dest` and same mint. Odd/zero pair count: `(len-4)%2 != 0` refused; zero pairs is allowed (lamport-only sweep, SR.13). A native wSOL source is a 165-byte classic account and is swept/closed like any token; its lamports (rent+wrapped) go to `dest` on close, separate from the PDA's own lamport sweep — no double count.
- **(c) Destination checks.** The helper does not compare `dest` to the asset owner — but only the owner can drive `ExecuteV1`, so `dest` is always owner-chosen. Choosing another vault's PDA as `dest` moves the owner's own value into that vault; self-inflicted, not theft. A lamport transfer to a below-rent or non-system `dest` fails and reverts the redemption; the page uses the owner (fee payer, exists). Matches SPEC item 50's "lamports-only sweep needs a destination that exists."
- **(d) Lamport sweep.** Reads `signer.lamports()` at execution and transfers all of it. Within the atomic redemption, nothing runs between the Execute and the burn, and Core `ExecuteV1` does not credit lamports back. BURN then reads `asset_signer.lamports() == 0`. A same-slot separate transaction either lands before (swept) or after (dead PDA; stranger's loss).
- **(e) Closed accounts pass BURN for the right reason.** After `CloseAccount`, the reserve ATA is no longer SPL-owned (or has `len < 165`); BURN's reserve loop `continue`s on `owner != SPL && != T22` or `len < 165`. Either way it is skipped, and the suite's S8/SR.4 redemptions land after the sweep closes the accounts. If a reserve ATA does not exist when the page builds, the prior transaction creates it (item 42); the sweep-at-execution then reads the live balance, so a between-build-and-land deposit is swept, not a blocker.
- **(f) Fit.** S8.0 measures the three-asset redemption through the helper at 1,061 bytes (owner as payer) with room for compute-budget + separate payer. Consistent with the code.
- **(g) Evidence.** SR.0–SR.4a, SR.6–SR.14, S8.* are cited and match the code's branches. I found no arm that cannot fail and no refusal reached for the wrong reason among those described.

I found **no defect** in the helper.

## R2 / R2b — Pool and boost

- **Invariant `pool >= ceil(owed)`.** `distribute` computes `avail = balance - ceil(owed_scaled/SCALE)` and `credit` adds `delta = floor(avail*SCALE/w)` with `owed += delta*w <= avail*SCALE`, so the post-distribution balance `= ceil(old_owed/SCALE)` still covers the new owed. `claim` pays whole sats and keeps the sub-sat remainder in `carry_scaled`, reducing `owed_scaled` by whole-sat units only. The arithmetic is the standard reward-accumulator and is internally consistent. I re-derived it; I could not construct an over-credit. (Empirical backing is suite P.32 and `bank/accrual.mjs`.)
- **Counters.** `pending_count`/`pending_this_epoch` are incremented on request and decremented on join or retire; `waiting_to_join = pending_count - pending_this_epoch`. The launch flow works because at epoch 0 `pending_this_epoch == pending_count`, so `waiting_to_join == 0` and the tick can advance the epoch; thereafter joins are free and permissionless, so no griefer can hold `waiting_to_join > 0` permanently (a griefer can request activation for any funded vault, but anyone can then join it). No liveness block found.
- **Boost ring.** `BOOST_RING = 64`, max boost length 63 = 64−1, so all live boosts' end epochs occupy 63 distinct slots and none collides with the slot being processed. `advance_epoch` moves `boost_expiring[dist_epoch % 64]` into `boosts_due` and zeroes it; a boost bought at epoch `e` with end `e+n` (n ≤ 63) is next processed exactly at epoch `e+n`. `expire_boost`/`unschedule_boost` decrement symmetrically; a record with `boost_weight == 0` is skipped, so no double expiry. `reweigh` preserves `owed` (carry = old owed, debt = new weight × acc). Conservation holds under my re-read and is asserted by the host tests.

I found **no defect** in the pool or boost accounting.

## R3 — Level draw

`capture_entropy`/`reveal_level`/`reschedule_reveal` use three slot hashes (A at/after `reveal_slot`, B and C two 4-slot leader groups later), `sha256(hA‖hB‖hC‖asset)`, drawn without replacement from the remaining census, strictly in mint order (`revealed_total`). A missed window is rescheduled to `now + 16` (a future slot), never defaulted. `SlotHashes` is parsed defensively (key pinned, count ≤ 512, length checked, all-zero hash refused). A burned vault at the FIFO head still draws (so the queue never stalls) but skips the Core write. The last-contributor grinding residual is accepted limit 26 and is not worse than stated (C's leader chooses among many draws; the code matches that description). No defect found.

## R4 — Governance

Electorate fixed at creation (`index_snapshot`, `quorum_supply = minted_total − burned_total − bare_burns_retired`); `VaultTooNew` against the snapshot; quorum ceiling over the snapshot; threshold over votes cast; 10% YES turnout; key changes need 50% of the snapshotted live supply and cannot share a proposal; notice period before apply; guardian can cancel a pending operator but not its own replacement; overtaken actions are logged skips. I re-read the tally math and the per-kind ordering marks; I could not construct a minority carry or a permanent freeze beyond what limit 47 already states (a stolen guardian re-stopping after each restart is permanent only below 50% turnout — that is stated, and redemption/payouts are unaffected). No defect found.

## R5 — Charter claim

Merkle leaf/node are domain-separated (0x00/0x01) and sorted; the JS (`scripts/pob-merkle.mjs`) and Rust match exactly, and the suite verifies the program accepts JS-built proofs (the drift check). Identity is by address against `pob_root`; a lookalike is refused. The PoB is CPI-burned as owner in the same instruction. `pob_extra` pass-through accounts are never signers. The window is clock-gated and cannot reopen. The hot update-authority exposure is accepted limit 46 and is accurately stated. No defect found.

## R6 — One-time configuration and trusted hop

I re-read all four `initialize` handlers. The bounds are enforced (caps sum, charter window, notice/cooldown/reserve ranges, boost ceilings, non-default treasury, payment-mint-is-a-reserve, SEAL agreement). The swap hop is bounded on-chain (cap, cooldown, reserve, operator signature, guardian stop). The 10% royalty is installed with `PluginAuthority::None`, which Core treats as immutable (suite R.6/R.6a). The redemption cap is a rolling 64-slot ring as described. The residual risk is a wrong-but-accepted `initialize` value, which is accepted limit 38 (OPEN) and is guarded pre-signing by `check-launch-params.mjs`. No new defect.

## R7 — Cross-program raw reads

I recomputed the MintConfig, VaultRecord, BurnConfig, and SealConfig layouts from the struct definitions and checked every pinned offset in GOV and BURN:

- MintConfig: governance 41, minted_total 141, bare_burns_retired 454, charter_closes_at 442, sol_reserve 257, max_sweep 266, cooldown 274, sales_stopped 191, sweep_stopped 192, sales_stopped_at 518, sweep_stopped_at 526, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, max_boost_weight 711, max_boost_epochs 712 — **all match**.
- VaultRecord: version 8, asset 9, mint_index 41 — **match**.
- BurnConfig: burned_total 42 — **match**.
- Sweep helper token offsets (mint 0, owner 32, amount 64, len 165) — **match**.

No offset error found. This agrees with round 38's recomputation.

## R8 — Suite / simulation / build as evidence

I could not execute these (read-only). From the bundled sources: the suite floors equal their counts (895 on-chain, 926 detector, 39 allocation, 49 launch, 24 poster, 4 expiry, 71 sim, 16 swap-fork, 33 mainnet-walk), the `because()` pins tie refusals to specific error codes, `build-mainnet.sh` proves which key each artifact carries and that the sweep helper's mainnet bytes equal the tested localnet bytes, and `rehearsal-tree.sh` proves the id-patch reverses byte-for-byte. I found no described arm that cannot fail. **Measurement I could not repeat:** the live on-chain runs themselves and `bank/crank.mjs` (not bundled), so C01 and the on-chain negative arms rest on the cited logs rather than my own execution.

---

## The four accepted-limit questions

1. **Is any limit WORSE than stated?** I found none worse than stated. Limit 27's "Who" was corrected by V38-4 and is now accurate. Limit 44's standing-consent description matches the implemented `LATE_CONSENT` mechanism. Limit 41, 26, 40, 46, 47 match the code. The one caveat is F1: the *repair* of V38-3 (not a listed limit) leaves a narrow second-collection window that the round 38 verdict did not sanction; that is reported above, not as a limit change.

2. **Is anything listed as a limit not actually a limit?** I found none that is fully closed. Limit 42 (prior transaction for destination ATAs) is still real for the padded page shape (1,367 bytes > 1,232), even though a narrow owner-payer shape fits (1,219) — the limit text already says exactly this, so it is correctly scoped, not stale.

3. **Is any DISCHARGED item not actually discharged?** I found none. Items 51 (boost) and 54 (compute) are built/measured as described; the discharged Bank-era items (1a–24) correspond to code that genuinely no longer exists (no Bank key, no deck, no co-signer, no distributor).

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still open and are treated as open: `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline`, and `vault_collection` OPEN and `judgeLaunch` refuses them; the pages are built/staged but not published; the dress rehearsal and the pool/Squads account creation have not run. Nothing is being smuggled into "accepted."

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concrete things that must happen before launch which an AI audit structurally cannot do:

1. **A human must run the dress rehearsal (item 22) against a live cluster with real (small) value**, including one full revenue cycle through both pools and one forced post-sweep failure recovered by hand. AI can specify and check the steps; it cannot execute live transactions, observe real RPC rate limits, or judge a real paging path. This is the single largest untested surface.

2. **Gary must decide the three OPEN `initialize` values** (`charter_opens_at`, `lock_deadline`, `vault_collection`) and record them in `launch/mainnet-init.json` before the ceremony. An AI cannot take a product decision or own a date.

3. **A human must physically confirm the deployed program bytes** on mainnet (`solana program dump` + hash) against `dist/SHA256SUMS` for all five ids, and confirm the upgrade authority is removed (step 11). The ceremony checks this programmatically, but a human should independently verify the ceremony actually ran and the authority is `none`. Immutability is irreversible; a second pair of eyes on the final `set-upgrade-authority --final` is warranted.

4. **Key custody is a human problem, not a code problem.** The guardian key, the swap-operator key, the $CBOB release wallet, and the PoB collection hot wallet are all hot keys. AI audit cannot secure them. Before launch: move what can be moved to hardware/multisig per the rulings, verify file permissions/backups, and rehearse the guardian-stop and swap-stop runbooks by hand.

5. **The PoB collection hot wallet must be actively watched by a human through the 7-day charter window** (limit 46). The alarm detects plugin/authority changes, but only a human can respond in time to prevent a claim-brick or governance capture. This is the highest-concentration, shortest-window risk in the whole system.

6. **The Squads return process for rescued vaults (item 58) is a human action.** Rehearse it: rescue a vault to the Squads and return it, so the multisig signers know the exact transfer before a real holder is waiting.

7. **A human should read HOLDER-GUIDE.md as a naive holder** and confirm the plain-language promises are understood as intended (especially the "what is lost when you open" section). AI can check code-vs-doc consistency (done above); it cannot check whether a real holder will misread a sentence and lose funds.

8. **Reconcile F1 before the ceremony.** Either implement the typed-address override or update the round 38 verdict to record the B4 supersession, so the audit record and the code agree before an immutable launch.

None of these is something another audit round can substitute for. The programs themselves I found, on this independent re-read, to be in the state round 38 described: no value path out, repairs holding, and the remaining risk concentrated in the off-chain pipeline, the live rehearsal, and the hot keys — all of which require human action, not more model passes.