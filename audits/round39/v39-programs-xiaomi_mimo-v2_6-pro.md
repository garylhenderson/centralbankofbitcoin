# Independent Security Audit — CBOB Vaults v6 (round 39)

**Audited tree:** `21f36e1` (v6 round 39 audit: page tests ride in the off-chain bundle)  
**Scope:** All five programs, `web/` (holder pages, ceremony, metadata generator, RPC proxy), `bank/` shared modules, `scripts/`, `tests/`, `sim/`, `launch/`, DESIGN-v6, HOLDER-GUIDE, SPEC, round 38 verdicts and validation.

---

## R0. ROUND 38'S VERDICT AND REPAIRS

### R0a. Independent verification of round 38's confirmed findings

**V38-1 (LOW — `splice(-1)` removes wrong stray):** VERIFIED REPAIRED. `plan-redeem.mjs` now uses the `drop` helper (`const i = list.indexOf(a); if (i >= 0) list.splice(i, 1)`) called on both `helperStrays` and `transferStrays`. The old `helperStrays.splice(helperStrays.indexOf(a), 1)` pattern is gone.

**V38-2 (MEDIUM — stranger-gated acknowledgement loop):** VERIFIED REPAIRED in shape. `LATE_CONSENT_ID = 'late-arrivals'` is a fixed id with no address, count, or digest. The `prepareOpening` pure loop replaces the old per-press gate: after the holder consents, re-plan never delivers late arrivals (the `s.known` check removes them from the deliver lists), never demands a new tick-box for them, and shows them as `lateInfo`. At most `OPEN_ATTEMPTS = 2` dry runs per press.

**V38-3 (INFO — ceremony offers step 0 with unverifiable collection):** REPAIRED, but with a deliberate divergence from round 38's recommended fix. The verdict recommended "a STOP … never a fall-through to step 0." The current code (documented as the drift-sweep review's B4 change) instead shows a prominent warning and still offers step 0, on the reasoning that a stranger's padded decoy must not stop launch. The behavior is self-consistent and documented in README and `ceremony-reads.mjs` comments, but it is NOT what round 38's verdict required. Whether the divergence is acceptable is a product judgment; it is accurately recorded.

**V38-4 (INFO — SPEC limit 27 wrong attribution):** VERIFIED REPAIRED. SPEC limit 27 now reads "Who: every OTHER holder (round 38 V38-4)."

**V38-5 (INFO — HOLDER-GUIDE late-deposit overpromise for C5 reserve-mint case):** SEE FINDING F39-1 BELOW. The code repair holds (the page's own note says "Anything sent to that account after this check stays in it"), but the HOLDER-GUIDE text repair claimed in `VALIDATION.md` is not present in the current HOLDER-GUIDE.

### R0b. Regression check

Every round 38 repair site was re-read. No regression found. The `drop` helper is used at all splice sites in `plan-redeem.mjs`. The `LATE_CONSENT` mechanism is used in `redeem.mjs`. The ceremony's collection logic matches the documented final form. The SPEC 27 text is corrected.

### R0c. Re-test of round 38's disproved claims

Round 38 disproved 11 claims (W1–W11). Each was spot-checked against this tree. None is now true. No re-filing.

---

## R1. CUSTODY

The SEAL↔BURN pairing is sound. Both halves walk only top-level instructions via `load_instruction_at_checked`, both bind asset (account 0) and owner (account 2), and both pin the other's instruction discriminator. A CPI wrapper cannot satisfy either direction (tested: WR.1–WR.4). Two vaults in one transaction pair correctly (tested: 4.10a). Account-index binding is positional and pinned by constants asserted against the Anchor derivations.

The emptiness proof covers: PDA lamports == 0; every reserve mint's ATA under both token programs declared, PDA-owned, undelegated, extension-free and empty; and no declared account a live Core asset. Token-2022 extensions are refused. Delegates and close authorities are refused. The declared count matches the accounts passed.

**No defect found in R1.**

---

## R1s. THE SWEEP HELPER

**(a) Access control.** Called directly, the helper requires `signer.is_signer`, which only Core's `ExecuteV1` can provide for a vault's asset-signer PDA. Core approves Execute only for `authority == owner` (measured: SR.5, SR.5a refuse a stranger and a delegate with `NoApprovals` 0x1a; SR.5c refuses the collection update authority). The collection abstains. The AgentIdentity route requires the collection update authority (MINT's PDA, off-curve, no key). SEAL's PermanentFreezeExecute plugin gates Execute at all: a frozen vault's Execute is refused (tested: 3.7). **Sound.**

**(b) Pair list.** Duplicate source: the first iteration closes it; the second fails `read_token` (the closed account is no longer Token-owned) → `IllegalOwner`. Source == destination: impossible (source must be signer-owned, destination must be dest-wallet-owned, and `signer.key == dest.key` is refused). wSOL source: it is a classic 165-byte account, so it would be transferred and closed like any other. An account with a delegate or kept close authority: the transfer moves the balance but the close may fail (R36.C5: a kept close authority reverts the whole call; the redeem page handles it with a plain Transfer instead). Odd or zero-pair lists: `(accounts.len() - 4) % 2 != 0` refuses odd; zero pairs is the lamports-only sweep (tested: SR.13). **Sound, with the C5 limitation as documented.**

**(c) Destination checks.** The destination is chosen by the transaction builder, which is the owner (through Core). The owner can direct their own funds anywhere; that is their right. A non-System destination (e.g. a token account) would make the System transfer fail, reverting the redemption. The redeem page always uses the owner wallet as destination. **Sound for the page; a custom client could pick a bad destination and fail its own redemption.**

**(d) Lamport sweep.** `signer.lamports()` is read at execution. The System transfer empties the signer to zero. Nothing in the same transaction can add lamports to the signer after the helper runs (no later instruction targets the signer PDA). BURN's `lamports == 0` check sees exactly what the sweep left. **Sound.**

**(e) Interaction with BURN's emptiness proof.** The sweep closes what it empties. A closed account is System-owned with 0 lamports, so BURN's `if acc.lamports() == 0 { continue }` skips it. The reserve loop's `find` by address still finds the AccountInfo (the address is deterministic). A non-existent reserve ATA (System-owned, 0 lamports) is also skipped. A stranger-created Token-2022 ATA for a classic mint: BURN derives both token-program ATAs and requires both declared; the T22 one would be found and checked (owner == T22, skip if not 165 bytes). A non-ATA token account is not a reserve ATA and is handled by the declared-accounts loop. A nested Core asset is refused if declared. **Sound.**

**(f) Fit.** S8.0 measures the three-asset redemption through the helper at 1,061 bytes with owner as fee payer, leaving room for compute-budget instructions (+52) and a separate fee payer (+96) = 1,209 of 1,232. A fourth reserve would exceed `MAX_RESERVE_MINTS = 3`. The in-line monthly run's accounts are already carried (the pool token account is in BURN's account list). **Sound.**

**(g) Evidence.** SR.0–SR.4a cover the happy path, the race, and the exact SOL delta. SR.5–SR.5e cover Core's access control. SR.6–SR.14 cover every refusal branch. SR.13 covers zero pairs. S8.0–S8.3 cover the three-asset redemption in the simulation. The helper is deployed from `target/deploy/cbob_vault_sweep.so`, byte-identical to `dist/` and the localnet build (proven by `build-mainnet.sh`). **All arms can fail and are pinned to their named reasons.**

**No defect found in R1s.**

---

## R2. THE COMMUNITY POOL'S MONEY

**Pool invariant "the pool always holds at least ceil(owed)":**

- `credit` adds `avail * ACC_SCALE / w` per weight unit to `acc_scaled` and `delta * w` to `owed_scaled`. The total added to `owed_scaled` is `delta * w ≤ avail * ACC_SCALE`. So `owed_scaled` grows by at most `avail * ACC_SCALE`, and the pool balance grows by `avail` (via `split_revenue`).
- `claim` pays `pending / ACC_SCALE` (floored) and subtracts `settled = pay * ACC_SCALE` from `owed_scaled`. The sub-sat remainder stays in `carry_scaled`. The pool balance decreases by `pay`. So `owed_scaled` decreases by exactly what the pool paid (in scaled units).
- `retire` (both flavors) subtracts `pending` from `owed_scaled` and either pays it out (redeemed) or returns it to the pool (bare burn or forfeit). The pool balance is unchanged (bare burn) or decreases by the vault's held balance (redeemed). The invariant holds.
- `PoolShort` refuses a distribution when `balance < ceil(owed)`.

**Counter invariants (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`):**

- `pending_count` is incremented in `activate` (first call) and decremented in `join` and `retire` (pending branch). `pending_this_epoch` is incremented in `activate` and decremented in `retire` (only when `request_epoch == dist_epoch`). `advance_epoch` sets `pending_this_epoch = 0`.
- `waiting_to_join = pending_count - pending_this_epoch` is always ≥ 0: `pending_this_epoch ≤ pending_count` because both are incremented together and `pending_this_epoch` is only decremented when `pending_count` is.
- `active_count` and `total_active_weight` are incremented in `join` and decremented in `retire`. `reweigh` adjusts `total_active_weight` by the weight delta.

**Liveness:** `JoinWaitingFirst` and `BoostsExpireFirst` gate distributions. Both are clearable by permissionless instructions (`claim` and `expire_boosts`). The crank runs them every pass. The monthly in-line run is skipped but never blocks its host.

**No defect found in R2.**

---

## R2b. THE $CBOB BOOST

**"A boost earns EXACTLY its N distributions and not one more":**

A boost bought at `dist_epoch = e` with `epochs = n` has `end = e + n`. The ring slot is `(end % BOOST_RING)`. `advance_epoch` at epoch `end` moves it to `boosts_due`. `BoostsExpireFirst` refuses the next distribution until it is expired. So the boost earns distributions at epochs `e+1, e+2, ..., e+n` (the distribution at `e+n` is the one that makes it due). That is exactly `n` distributions. Tested: BO.21, BO.21a, BO.34a, BO.34b.

**"Nothing a vault earned is lost or gained when its weight changes":**

`reweigh` moves `owed_of(r)` into `carry_scaled` and resets `debt_scaled = new_weight * acc`. So `owed_of` is preserved: `new_weight * acc - new_weight * acc + carry = carry = old owed`. `owed_scaled` is unchanged (only `debt_scaled` and `carry_scaled` change). Tested: BO.7c, BO.14, BO.15.

**"total_active_weight, boost_weight_total, boosts_active, boosts_due and the ring always agree":**

The host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` drives 260 epochs through `join`, `reweigh`, `retire`, `expire_boost`, `credit`, and `tick`, checking every invariant after every step against a model rebuilt from the records alone. Coverage assertions require >500 buys, >200 N=63 buys, >100 wrapped buys, >50 early retires, >20 wrapped early retires, >3 N=63 same-epoch wraps, >15 due retires, and >50 expiries. The expiry-budget gate (4 assertions) executes 20 distinct due boosts under the default CU budget and checks the global counters.

**"No record can be expired twice, early, or never":**

`expire_boost` requires `boost_weight > 0 && dist_epoch >= boost_end_epoch`. After expiry, `boost_weight = 0`, so a second call is skipped. `expire_boosts` skips records that are not due. The `BoostsExpireFirst` gate ensures no distribution runs past a due boost.

**"Nobody can make distributions impossible by boosting or by a vault whose token account is gone":**

`expire_boosts` needs only the vault records (no token accounts). `BoostsExpireFirst` is clearable by `expire_boosts` alone. A vault whose token account is gone is handled by `claim` (which skips it) and `retire_burned` (which removes its weight). **Sound.**

**No defect found in R2b.**

---

## R3. THE LEVEL DRAW

The SlotHashes parse is defensive: key checked, count bounded at 512, buffer length checked, all-zero hash refused. Skipped-slot handling uses `blockhash_in_window` which takes the smallest produced slot in `[want, want + 64]`. FIFO is enforced by `RevealOutOfOrder`. A burned vault at the head still draws (L.11). The attribute re-supply hash is checked (`AttributesMismatch`).

SPEC 26 correctly states that C's leader chooses among many draws. HOLDER-GUIDE says "the validator producing the last of those blocks can pick among several results, by skipping a block or changing what goes into it. That can be enough to choose the level of a vault created in the same moment (from the levels still left), and one choice affects every vault created in that moment at once." This is accurate.

**No defect found in R3.**

---

## R4. GOVERNANCE

The electorate is fixed at creation (`index_snapshot`, `quorum_supply`). No proposal before the charter window closes. Quorum, threshold, and 10% YES turnout are enforced. A guardian change or new swap operator needs YES from half of the live vaults snapshotted at creation (`KeyChangeNeedsHalf`), never bundled with the other (`KeyChangesBundled`), and lands only after notice (`GuardianNoticeNotElapsed`, `OperatorNoticeNotElapsed`). The guardian may cancel a pending swap operator. `TightenSweep` is monotone and bounded. An overtaken action is a logged no-op (`CBOB_ACTION_SKIPPED`), not a revert.

**Minor observation (not a defect):** The `last_boost_id` mark is only advanced when the boost action is NOT skipped, unlike `last_round_id` which advances even when the round is skipped as "already over." This asymmetry is correct: a skipped round has been superseded (the mark should move), while a skipped boost has been superseded by a higher-id boost (the mark already reflects that). No bug.

**No defect found in R4.**

---

## R5. THE CHARTER CLAIM

The Proof of Burn is identified by ADDRESS against a Merkle root (domain-separated 0x00/0x01, sorted pairs). The CPI burn is in the same instruction. The window is fixed at initialize and can never reopen. Not gated by the guardian. `pob_extra` accounts are passed through to Core's burn, never as signers.

SPEC 46 is complete for the hot wallet's documented powers: it can add external plugins (collection-level or per-asset), flip an oracle, or move a PoB out of the collection. It cannot transfer or burn an individual PoB (Core's asset approval rules). The alarm watches the collection but not individual assets (documented). The claim page refuses PoBs with external plugins (documented).

**No new omission found in SPEC 46.**

---

## R6. THE ONE-TIME CONFIGURATION AND THE TRUSTED HOP

Every `initialize` was read against its `check-launch-params.mjs` counterpart. The programs check less than the checker (documented in limit 38). The swap operator's worst case is cap × cooldown windows until the guardian stops it (documented). The 10% royalty is a Core plugin with authority None (tested: R.3, R.5, R.6, R.6a, R.6c, R33.G3). The redemption cap is a 64-slot ring of timestamps (tested: RL.1–RL.7, S10.0–S10.3).

**No defect found in R6.**

---

## R7. CROSS-PROGRAM RAW READS

I recomputed every offset from the struct definitions:

**MintConfig v6** (after 8-byte discriminator): version[8], collection[9..41], governance[41..73], pool_ata[73..105], round_id[105..109], opens_at[109..117], closes_at[117..125], price[125..133], cap[133..137], minted_this_round[137..141], minted_total[141..149], max_supply[149..157], bank_treasury[157..189], split_bps[189..191], sales_stopped[191], sweep_stopped[192], guardian[193..225], swap_operator[225..257], sol_reserve_lamports[257..265], bump[265], max_sweep_lamports[266..274], sweep_cooldown_secs[274..282], last_sweep_at[282..290], level_caps[290..310], level_minted[310..330], revealed_total[330..338], payment_mint[338..370], pob_collection[370..402], pob_root[402..434], charter_opens_at[434..442], charter_closes_at[442..450], charter_claimed[450..454], bare_burns_retired[454..462], total_active_weight[462..470], active_count[470..478], acc_scaled[478..494], owed_scaled[494..510], last_distribute_at[510..518], sales_stopped_at[518..526], sweep_stopped_at[526..534], pending_swap_operator[534..566], pending_swap_operator_at[566..574], monthly_secs[574..582], pending_guardian[582..614], pending_guardian_set[614], pending_guardian_at[615..623], notice_secs[623..631], sweep_floor_lamports[631..639], cooldown_ceiling_secs[639..647], reserve_ceiling_lamports[647..655], dist_epoch[655..663], pending_count[663..671], pending_this_epoch[671..679], cbob_mint[679..711], max_boost_weight[711], max_boost_epochs[712..714], boost_price[714..722], boost_weight[722], boost_epochs[723..725], boosts_active[725..729], boosts_due[729..733], boost_weight_total[733..741], cbob_burned_total[741..749], boost_expiring[749..1005].

GOV reads: minted_total[141], bare_burns_retired[454], charter_closes_at[442], sol_reserve[257], max_sweep[266], cooldown[274], sales_stopped[191], sweep_stopped[192], sales_stopped_at[518], sweep_stopped_at[526], sweep_floor[631], cooldown_ceiling[639], reserve_ceiling[647], max_boost_weight[711], max_boost_epochs[712]. **All correct.**

BURN reads: minted_total[141], bare_burns_retired[454]. **Correct.**

SEAL Config: version[8], collection[9..41], reserve_mints Vec (u32 len at 41, then 32-byte keys). MINT reads at OFF_COLLECTION=9, OFF_RESERVES=41. BURN reads at the same offsets. **Correct.**

VaultRecord v4: version[8], asset[9..41], mint_index[41..49], reveal_slot[49..57], level[57], charter[58], entropy_set[59], entropy[60..92], attrs_hash[92..124], bump[124], active[125], retired[126], reschedules[127..129], vault_ata[129..161], debt_scaled[161..177], pending[177], request_epoch[178..186], boost_weight[186], boost_end_epoch[187..195], carry_scaled[195..211], RECORD_PADDING[211..221]. GOV reads mint_index at 41. **Correct.**

Sweep helper reads: mint[0..32], owner[32..64], amount[64..72] from a 165-byte classic SPL account. **Correct.**

**No offset defect found.**

---

## R8. THE SUITE, THE SIMULATION AND THE BUILD AS EVIDENCE

### F39-2 (LOW) — Test coverage gaps that leave named program paths unexercised

**Construct:** `tests/3prog.test.ts`, `sim/test-vault.ts`, `web/test/e2e-localnet.sh`.

Round 38's verdict documented these as A4/A6 (coverage gaps with no claimed defect). I confirm they remain. The specific untested paths:

1. **A lamport deposit between the sweep helper's `ExecuteV1` and `burn_vault`'s emptiness check.** In a single atomic transaction this is impossible (no instruction between them targets the asset-signer PDA). But no arm proves it. The griefer scenario is a deposit landing between the transaction being built and it executing — which the helper's at-execution sweep handles. The residual (a deposit in the same slot after the helper runs) is physically impossible within one transaction. **Risk: none in practice. Fix: one arm showing `VaultNotEmpty` when lamports are added between the two instructions in a simulated transaction.**

2. **A declared reserve ATA that does not exist.** BURN's reserve loop `find`s the expected address in `remaining_accounts`. If the account does not exist (System-owned, 0 lamports), it is skipped by `if acc.lamports() == 0 { continue }`. But no arm proves this skip fires for a non-existent account. **Risk: low (the skip is straightforward). Fix: one arm.**

3. **`activate` on a frozen cbBTC account.** Round 37 V3 claims MINT reads the balance, not the state, so a frozen account can activate. But no arm tests it. The code in `activate` uses `read_token` which returns `(amount, state)` but only checks `amount >= ACTIVATION_SATS`. The state is not checked. **Risk: the claim is almost certainly true (the code reads correctly), but it is untested. Fix: one arm.**

4. **The compressed-NFT path in the redeem page.** `coreAssetsOwnedBy` has a DAS branch for compressed NFTs. No arm exercises it. **Risk: low (the path is a fallback). Fix: one arm in the web tests.**

**Evidence that would exist if the gaps were real defects:** A failing test run showing the program accepting or refusing something it should not. Since no defect is claimed, the evidence is the absence of a test arm.

**Fix:** Add the four arms above to the appropriate suites.

**Severity: LOW.** These are coverage gaps in paths that read correctly, not defects.

---

## FINDINGS

### F39-1 (LOW) — HOLDER-GUIDE's late-deposit promise does not match the code for a stranger-kept (C5) reserve-mint account

**Construct:** `HOLDER-GUIDE.md`, "Someone could send a tiny amount into your vault while you are opening it" paragraph. The code is `web/src/lib/plan-redeem.mjs` (the `transferStrays` path and its note).

**What the guide says:** "whatever cbBTC, $GARY, $GIRAFFISH or SOL is in the vault's own three accounts and its wallet right then comes out to you."

**What the code does:** For a C5 account (a stranger handed a token account to the vault wallet and kept the close authority) holding a reserve mint (cbBTC, $GARY, or $GIRAFFISH), the page moves the balance with a plain `Transfer` of the amount read at plan time. Anything sent to that account AFTER the plan stays in it. The page's own note says: "Anything sent to that account after this check stays in it."

**The gap:** The guide says "whatever cbBTC … is in the vault's own three accounts … comes out to you." A C5 account of cbBTC is NOT one of the vault's own three accounts (the canonical reserve ATAs). But a reader could reasonably take "whatever cbBTC is in the vault's own three accounts" to mean "all cbBTC anywhere in the vault," especially in the context of "someone could send a tiny amount into your vault." The guide's next sentence says "Tokens in any other account someone sent to the vault come out only if the page named them and could move them; anything that arrives after the page's last check is lost," which partially covers this — but the "arrives after the page's last check" qualifier is about timing, not about account identity. A deposit into a C5 account BEFORE the check is named and moved; a deposit AFTER the check is lost. The guide's first sentence overpromises for the after-check case.

**Who can cause it:** Only the stranger who controls the C5 account would deposit into it. The holder is not at risk of losing their own funds.

**Evidence if true:** The HOLDER-GUIDE text does not contain the exception "except anything sent, after the check, into an account someone else handed to your vault and kept the right to close." Round 38's `VALIDATION.md` claims this was fixed ("the guide no longer promises 'everything'"), but the current HOLDER-GUIDE does not contain that exception.

**Fix:** Add to the late-deposit paragraph: "except anything sent, after the check, into an account someone else handed to your vault and kept the right to close (the page names it)."

**Severity: LOW.** Documentation only. Does not misstate program behaviour. The harm is a reader overestimating what they receive in a narrow case involving a stranger-controlled account. This does NOT qualify for the documentation exception (SPEC gate 3) because it misstates what money reaches the holder.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

### 1. Is any limit WORSE than stated?

**Limit 10 (the swap operator):** The text says "per-sweep cap x cooldown windows until the guardian pulls `emergency_stop_sweep`, never more than the revenue PDA holds above the reserve." This is accurate. The ruled values (10 SOL per 6-hour cooldown) give a worst case of about 40 SOL/day. The text correctly notes this.

**Limit 26 (C's leader grinding):** The text says "best-of-4 alone takes P(Level V) from 5.0% to 18.6% and the expected weight from 3.05 to 4.38." This is measured and accurate.

**Limit 46 (the hot PoB wallet):** The text correctly states both the "end the project" and "capture governance" attacks. It is complete.

**Limit 47 (a stolen guardian key):** The text correctly states the stop is permanent below 50% turnout. It is complete.

**No limit is worse than stated.**

### 2. Is anything listed as a limit not actually a limit?

**Limit 35 (the 10% turnout rule never binds):** At the ruled numbers (21% quorum, 51% threshold), the smallest passing vote is 10.71% YES. The 10% turnout floor is indeed never the binding constraint. It is correctly listed as a limit that only matters for other parameter values.

**Limit 55 (a vault can share unsplit revenue):** The text says it costs "as little as 100 $GARY." This is correct at the monthly boundary. The limit is real.

**No limit is incorrectly listed.**

### 3. Is any DISCHARGED item not actually discharged?

**Item 51 ($CBOB boost):** Built and tested (section BO, init arms 0.1o–0.1v). The ring, the carry, the gate, and the buyer's terms are all exercised. **Discharged correctly.**

**Item 54 (compute at widest host shapes):** Measured (arms 10.5, 10.6, 10.6a, 10.6b). The page rule (set the compute-unit limit on any transaction carrying a crank) is a requirement of item 50, which is still open. **Discharged correctly for the programs; the page obligation remains under item 50.**

**Item 12/17 (compute units):** Measured on the v5 artifact and re-measured on v6 (arms 10.1–10.4). **Discharged correctly.**

**All DISCHARGED items are correctly discharged.**

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 22 (nothing has run against a live chain):** Still OPEN. The dress rehearsal is "not started" in the road table. Not demoted.

**Item 38 (every initialize value):** Still OPEN. `charter_opens_at`, `lock_deadline`, and `vault_collection` are OPEN in `launch/mainnet-init.json`. `judgeLaunch` refuses them. Not demoted.

**Item 50 (holder surfaces):** Still OPEN. The pages are "built and staged" but "not published." The holder guide is marked DRAFT and "may not be published before this item ships." Not demoted.

**Item 52 (pool and Squads cbBTC accounts):** Still OPEN. Road step 10 creates them. Not demoted.

**Item 53 (dress rehearsal at throwaway ids):** Still OPEN. The rehearsal value set is "not built." Not demoted.

**No OPEN item is being quietly treated as accepted.**

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, WHAT SHOULD THIS PROJECT DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT?

1. **Run the dress rehearsal (item 22) with real money on a throwaway deployment.** AI audit cannot execute. The rehearsal must include: the crank's live passes with ~2,100 vaults; the alarm's live passes; one full revenue cycle through BOTH pools (Orca forced to refuse once); one forced post-sweep failure walked through hand recovery; and one DAS read of a burned Core asset. Record every transaction signature. This is the only way to prove the off-chain pipeline works against a real cluster.

2. **Have a human read the HOLDER-GUIDE end to end and say whether they understand it.** AI audit can check every sentence against the code, but cannot judge whether a real holder understands "opening is all or nothing" or "anything that arrives after the page's last check is lost." The guide is the product's contract with its buyers. A human who is not the author must read it cold and say what they think it promises.

3. **Run the redeem page against a real Phantom wallet on a real phone.** The mock test signs through `window.cbobTestWallet`. A real Phantom on iOS or Android may modify the transaction, reorder instructions, or add guard instructions. `signExact` refuses if the message changes, but the error message must be understandable to a holder who just wanted to open their vault. Test the failure path with a real wallet.

4. **Execute the ceremony (road step 10) on mainnet with the real INIT_AUTHORITY key, in local mode (review M4), with a human watching every step.** The ceremony writes values that can never be changed. AI audit can verify the code builds the right transaction, but cannot verify that Gary's browser, Phantom, and the network produce the right result. Run it once, with a human reading every dry-run output before signing.

5. **Have someone who is not on this project try to break the redeem page.** Give them a vault with airdropped tokens, nested NFTs, C5 accounts, Token-2022 accounts, and compressed NFTs. Tell them to try to make the page lose value or block the opening. AI audit finds defects in code; a motivated human finds defects in assumptions.

6. **Verify the deployed bytes on mainnet against `dist/SHA256SUMS` after road step 9, and again after road step 11.** AI audit can verify the build produces the right hash. Only a human can verify the hash matches what is actually on chain after deployment. `solana program dump` each of the five programs and compare.

7. **Write the runbook for "a holder says they lost money."** AI audit can enumerate every path where value moves. It cannot write the operational procedure for investigating a holder complaint: which transactions to look at, which accounts to read, who to call at Coinbase if a freeze is involved, and what to say to the holder. Write it before launch, not after the first complaint.