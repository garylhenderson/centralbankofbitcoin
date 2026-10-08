# Round 37 Independent Audit — CBOB Vaults v6

## R0: Round 36 Verdict Verification

I independently re-verified every confirmed finding from round 36's programs and off-chain verdicts against the current tree.

**H1 (redeem page freeze-vector blocking):** The repair is present and correct. `planRedemption` in `web/src/lib/plan-redeem.mjs` now checks `s.ownerAtaFrozen` for reserve mints (refusing with a named reason) and checks `s.mintFreeze` for strays (leaving freezable-mint strays behind with an acknowledgement box rather than delivering them into a destination a stranger could freeze). The `undeliverable` helper correctly treats unreadable mints as undeliverable (fail-safe). The `dropStrays` re-plan path after a failed dry run is present. Verified at all sites: `plan-redeem.mjs` lines handling `helperStrays`, `transferStrays`, and the `cannot` list; `reads.mjs` populating `ownerAtaFrozen` and `mintFreeze`; `redeem.mjs` wiring the flow. **Repair holds.**

**L1 (proxy relaying non-CBOB transactions):** The repair is present. `txRefusal` in `web/deploy/rpc-proxy.mjs` now requires at least one CBOB program id, with three narrow exceptions (ATA-creates-only, the ceremony's collection create, System transfers to the revenue address). **Repair holds.**

**L2 (payout cannot clear due boosts):** The repair is present. `planPayout` in `plan-redeem.mjs` prepends `expireBoosts` instructions for due records before the distribute. `redeem.mjs` reads `boosts_due` and passes due records. **Repair holds.**

**L3, L4, L5, I1, I2:** All SPEC/config/ceremony text corrections verified present. **Repairs hold.**

**Round 36 refuted claims:** I independently re-checked the refutations. W1 (helper destination to another vault's PDA) is correctly refuted: the helper is only reachable through Core Execute by the owner, and the page always passes the connected owner. W2 (claim-first order never landed) is correctly refuted as a code defect: SEAL scans forward, BURN scans backward, and `retire_redeemed` checks the current top-level instruction, so a `claim` before `open` doesn't break either walk. W3 (placeholder upgrade authority) is correctly refuted: it's not an initialize value. **Refutations confirmed.**

## R1: Custody — Sealed Vault Extraction

I attacked the open/burn pairing, the emptiness proof, and the thaw-to-burn atomicity.

**Pairing integrity.** SEAL's `open_for_redemption` walks forward from `current+1` looking for a matching `burn_vault` (same asset at index 0, same owner at index 2). BURN's `burn_vault` walks backward from `0..current` looking for a matching `open_for_redemption`. Both use `load_instruction_at_checked` which reads only top-level instructions. A CPI-wrapped burn or open is invisible to the walk and cannot satisfy the pairing. Verified: the discriminator constants match the Anchor derivation (`sha256("global:burn_vault")[..8]` and `sha256("global:open_for_redemption")[..8]`), and the account index bindings (0 for asset, 2 for owner) match both programs' account structs. The coupling fails closed: a discriminator drift would refuse the thaw, leaving the vault sealed.

**Two vaults in one transaction.** Each half binds asset AND owner. Vault A's open cannot pair with vault B's burn because the asset key at index 0 would differ. Two complete redemptions (open A, sweep A, burn A, open B, sweep B, burn B) work correctly; the rate limit handles the cap.

**Emptiness proof.** BURN checks: PDA lamports == 0; every reserve mint's ATA under both token programs is declared; each declared account is PDA-owned, undelegated, extension-free, and zero-balance; no declared account is a live Core asset. The second loop over all declared accounts catches non-reserve token accounts owned by the PDA. The `lamports() == 0` skip for closed accounts is correct. The `d.len() < TOKEN_ACCOUNT_LEN` skip for short accounts is correct. The Token-2022 extension refusal (`d.len() == TOKEN_ACCOUNT_LEN`) prevents confidential-balance bypass.

**Thawed vault leaving the transaction unburned.** If the burn fails (any emptiness check), the entire transaction reverts, including the thaw. There is no instruction that re-seals, but the thaw is reverted with the failed burn. The vault remains sealed. No path leaves a thawed vault surviving a transaction.

**No finding.**

## R1s: Sweep Helper

**(a) Access control.** The helper requires `signer.is_signer`. Called directly, the signer must be the asset-signer PDA, which only Core can sign for via `ExecuteV1`. Core's `ExecuteV1` authority rule (verified against the pinned binary via suite arms SR.5-SR.5e) approves only the asset's owner. The collection abstains. No plugin route in the CBOB collection can approve Execute (no AgentIdentity adapter is installed; adding one requires the collection update authority, which is MINT's PDA). **Confirmed: only the owner can invoke the helper on a vault.**

**(b) Pair list.** Duplicate source: the first iteration closes the account; the second reads a closed account (owner = system program), `read_token` returns `IllegalOwner`, transaction reverts. Source as destination for another pair: the destination must be owned by the `dest` wallet, but a vault-owned source is owned by the PDA, so `src_owner != *signer.key` fails. Native wSOL: handled as a regular SPL token account (165 bytes, SPL-owned). Frozen source: the SPL Transfer CPI fails, reverting the transaction. Non-ATA destination: accepted if owned by `dest` wallet with matching mint (by design). Destination = asset-signer: refused by `signer.key == dest.key` check. Zero pairs: only the lamport sweep runs. Odd account count: refused by `(accounts.len() - 4) % 2 != 0`. **All edge cases handled correctly.**

**(c) Destination checks.** The helper does not verify `dest` is the vault owner. This is safe because the helper is only reachable through Core Execute by the owner, and the page builds the transaction with the owner as dest. A lamport transfer to a below-rent-exemption or non-system account would fail at the System program level, reverting the transaction. This is a client obligation, not a program vulnerability.

**(d) Lamport sweep.** `signer.lamports()` is read at execution time. The transfer empties the PDA to zero. BURN then checks `lamports() == 0`. No instruction between the sweep and the burn can add lamports to the PDA (they're in the same atomic transaction). Core's `BurnV1` does not sweep the PDA (measured fact 4). **Confirmed correct.**

**(e) BURN interaction.** The sweep closes emptied accounts. BURN's reserve loop finds the closed account (owner = system program, not SPL Token), hits `acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID`, and `continue`s (skips). The closed account passes the emptiness proof for the right reason. If a reserve ATA doesn't exist, the page creates it in the prior transaction. A stranger creating a missing ATA with dust between the page's read and the transaction is handled: the sweep reads the live balance and transfers it. **Confirmed correct.**

**(f) Packet fit.** Suite arm S8.0 measures 1,061 bytes for the three-asset redemption through the helper with claim. The widest page shape (compute-budget pair + separate fee payer) is ~1,209 bytes, within 1,232. **Confirmed.**

**(g) Evidence.** Suite arms SR.0-SR.4a, SR.5-SR.5e, SR.6-SR.14 cover the helper's refusal branches, access control, and the race scenario. The helper is deployed from the same bytes `scripts/build-mainnet.sh` proves (byte-identical between `dist/`, `target/deploy/`, and the localnet build). **Confirmed.**

**No finding.**

## R2: Community Pool

**Invariant: pool holds >= ceil(owed).** `distribute` enforces this via `PoolShort`. `credit` computes `delta = avail * ACC_SCALE / w` (floor), then `owed += delta * w`. Since `delta * w <= avail`, the pool retains the dust. `claim` pays whole sats and preserves sub-sat dust in `carry_scaled`. `retire` subtracts the pending share from `owed_scaled`. `monthly_inline` uses `saturating_sub` to avoid distributing more than available. The invariant is maintained across all operations. Suite arm P.32 asserts it. **Confirmed.**

**Two-step activation.** `activate` first call sets `pending = true`, `request_epoch = dist_epoch`. Second call (or `claim`) joins when `dist_epoch > request_epoch`. `join` sets `debt = weight * acc`, `carry = 0`. The vault earns from the next distribution. `JoinWaitingFirst` prevents distribution while eligible vaults wait. `pending_this_epoch` is reset in `advance_epoch`. The counters are consistent across all orderings. **Confirmed.**

**Counters under all orderings.** I traced `pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight` through: activate, join, claim, retire (redeemed and bare), boost, expire, distribute, monthly_inline, tick. All checked arithmetic uses `checked_add`/`checked_sub` with overflow errors. The `pending_this_epoch` decrement in `retire` correctly checks `request_epoch == dist_epoch`. **No inconsistency found.**

**Liveness.** `JoinWaitingFirst` can block distributions if a vault is eligible but nobody joins it. But joining is free and permissionless (`claim` or `activate` second call). The crank joins every eligible vault. A griefer cannot prevent joining. `BoostsExpireFirst` can block distributions if boosts are due. Expiring is free and permissionless (`expire_boosts` or `claim`). **No permanent block possible.**

**No finding.**

## R2b: $CBOB Boost

**Boost earns exactly N distributions.** `boost_end_epoch = dist_epoch + epochs`. `advance_epoch` moves boosts to `boosts_due` when `dist_epoch` reaches `boost_end_epoch`. `BoostsExpireFirst` blocks distribution while `boosts_due > 0`. `expire_boost` calls `reweigh(c, r, 0)` which preserves the owed amount. The ring buffer (`BOOST_RING = 64`) with max boost length 63 prevents slot collisions. Suite arms BO.* and the host unit test verify the ring across 260 epochs (4 wraps). **Confirmed.**

**Nothing gained or lost on weight change.** `reweigh` sets `carry = owed_before`, `debt = new_weight * acc`. So `owed_after = new_weight * acc + owed_before - new_weight * acc = owed_before`. The owed amount is preserved. **Confirmed.**

**Counter consistency.** `boosts_active`, `boosts_due`, `boost_weight_total`, `boost_expiring` ring, and `total_active_weight` are all updated consistently in `boost_vault`, `expire_boost`, `unschedule_boost`, `reweigh`, and `retire`. The host unit test verifies all counters against a model across 260 epochs with random boosts, expiries, and retires. **Confirmed.**

**No double-expiry.** `expire_boost` requires `r.boost_weight > 0`. After expiry, `boost_weight = 0`. A second expiry attempt skips. **Confirmed.**

**No finding.**

## R3: Level Draw

**SlotHashes parsing.** `blockhash_in_window` validates the sysvar key, checks the count <= 512, verifies the buffer length, rejects all-zero hashes, and finds the smallest produced slot in `[want, want+64]`. **Confirmed correct.**

**Skipped-slot handling.** The draw uses the smallest produced slot in the window, not the target slot. If the target is skipped, the next produced slot is used. This is deterministic. **Confirmed.**

**FIFO.** `reveal_level` requires `index == config.revealed_total`. Out-of-order reveals are refused. A burned vault at the head still gets its draw (census updated) but the Core write is skipped. **Confirmed.**

**Attribute re-supply.** `reveal_level` requires the caller to re-supply the minted attributes, checked against `attrs_hash`. A mismatch is refused. **Confirmed.**

**Influence.** The draw uses three slot hashes from different leader groups, mixed with the asset address. The last contributor (C's leader) can grind, which is accepted limit 26. **Confirmed as stated.**

**No finding.**

## R4: Governance

**Minority carry.** Quorum is 21% of snapshotted live supply. Threshold is 51% of votes cast. YES turnout is 10% of snapshotted supply. Key changes need 50% of snapshotted supply. At the ruled numbers, the smallest passing vote is 10.71% YES, above the 10% floor. **Confirmed.**

**Vote reach.** GOV can only call MINT's `set_round`, `restart`, `tighten_sweep`, `arm_swap_operator`, `arm_guardian`, and `set_boost_terms`. The 85/15 split, destinations, `max_supply`, and royalty are not reachable. **Confirmed.**

**Governance freeze.** If every vault is redeemed, no proposal can be created (accepted limit 45). A stolen guardian can stop sales/sweep permanently at low turnout (accepted limit 47). **Confirmed as stated.**

**No finding.**

## R5: Charter Claim

**Merkle proof.** Domain-separated leaves (0x00) and nodes (0x01), sorted pairs. The proof is verified against `pob_root`. The PoB is burned by CPI in the same instruction. The window is checked by clock. **Confirmed.**

**Hot wallet exposure.** Accepted limit 46 covers the full exposure. The claim page refuses external plugins. The alarm watches the collection. **Confirmed as stated.**

**No finding.**

## R6: One-Time Configuration

**Initialize checks.** All four programs check `INIT_AUTHORITY`. MINT validates the collection (clean, ours, unminted), SEAL wiring, payment mint as reserve, PoB root, charter window, boost bounds, and tighten bounds. BURN validates SEAL wiring and redeem window. GOV validates MINT collection and quorum/threshold bounds. SEAL validates reserve mints as classic SPL. **Confirmed.**

**Royalty immutability.** The Royalties plugin is installed with `PluginAuthority::None`. Core refuses updates and removals for `None` authority (suite arms R.5-R.6c). **Confirmed.**

**Redemption cap.** The rolling window uses a 64-slot ring of timestamps. The k-th most recent redemption must be at least `redeem_window_secs` old. Suite arms RL.* verify the cap. **Confirmed.**

**No finding.**

## R7: Cross-Program Raw Reads

I recomputed every offset from the struct definitions:

**SEAL Config (v2):** disc[0..8], version[8], collection[9..41], reserve_mints (u32 len at 41, then keys). MINT reads `OFF_COLLECTION = 9`, `OFF_RESERVES = 41`. BURN reads the same. **Correct.**

**MINT Config (v6):** disc[0..8], version[8], collection[9..41], governance[41..73], pool_ata[73..105], round_id[105..109], opens_at[109..117], closes_at[117..125], price[125..133], cap[133..137], minted_this_round[137..141], minted_total[141..149], max_supply[149..157], bank_treasury[157..189], split_bps[189..191], sales_stopped[191], sweep_stopped[192], guardian[193..225], swap_operator[225..257], sol_reserve_lamports[257..265], bump[265], max_sweep_lamports[266..274], sweep_cooldown_secs[274..282], last_sweep_at[282..290], level_caps[290..310], level_minted[310..330], revealed_total[330..338], payment_mint[338..370], pob_collection[370..402], pob_root[402..434], charter_opens_at[434..442], charter_closes_at[442..450], charter_claimed[450..454], bare_burns_retired[454..462], total_active_weight[462..470], active_count[470..478], acc_scaled[478..494], owed_scaled[494..510], last_distribute_at[510..518], sales_stopped_at[518..526], sweep_stopped_at[526..534], pending_swap_operator[534..566], pending_swap_operator_at[566..574], monthly_secs[574..582], pending_guardian[582..614], pending_guardian_set[614], pending_guardian_at[615..623], notice_secs[623..631], sweep_floor_lamports[631..639], cooldown_ceiling_secs[639..647], reserve_ceiling_lamports[647..655], dist_epoch[655..663], pending_count[663..671], pending_this_epoch[671..679], cbob_mint[679..711], max_boost_weight[711], max_boost_epochs[712..714], boost_price[714..722], boost_weight[722], boost_epochs[723..725], boosts_active[725..729], boosts_due[729..733], boost_weight_total[733..741], cbob_burned_total[741..749], boost_expiring[749..749+256]. GOV reads `OFF_MINT_GOVERNANCE = 41`, `OFF_MINT_MINTED_TOTAL = 141`, `OFF_MINT_BARE_RETIRED = 454`, `OFF_MINT_CHARTER_CLOSES = 442`, `OFF_MINT_SALES_STOPPED = 191`, `OFF_MINT_SWEEP_STOPPED = 192`, `OFF_MINT_SALES_STOPPED_AT = 518`, `OFF_MINT_SWEEP_STOPPED_AT = 526`, `OFF_MINT_SWEEP_FLOOR = 631`, `OFF_MINT_COOLDOWN_CEILING = 639`, `OFF_MINT_RESERVE_CEILING = 647`, `OFF_MINT_MAX_BOOST_WEIGHT = 711`, `OFF_MINT_MAX_BOOST_EPOCHS = 712`. BURN reads `OFF_MINT_MINTED_TOTAL = 141`, `OFF_MINT_BARE_RETIRED = 454`. **All offsets verified correct.**

**VaultRecord (v4):** disc[0..8], version[8], asset[9..41], mint_index[41..49]. GOV reads `OFF_REC_INDEX = 41`. **Correct.**

**BurnConfig (v4):** disc[0..8], version[8], collection[9..41], bump[41], burned_total[42..50]. GOV reads `OFF_BURN_TOTAL = 42`. **Correct.**

**Sweep helper token reads:** mint[0..32], owner[32..64], amount[64..72], length 165. **Correct.**

**No finding.**

## R8: Suite, Simulation, and Build

**Suite arms.** The 895-assertion suite covers all five programs with both-direction tests. The `because()` pins verify refusal reasons. The floor equals the count (895). **Confirmed.**

**Simulation.** The 71-assertion Test Vault simulation runs against real Core, real mints, and real PoB assets. **Confirmed.**

**Build.** `scripts/build-mainnet.sh` builds both mainnet and localnet, asks each whether it trusts the test key, and proves the sweep helper's bytes are identical. **Confirmed.**

**No finding.**

## Accepted Limits Verification

I checked all four questions:

**1. Is any limit worse than stated?** No. I verified limits 9, 25, 26, 27, 28, 32, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 55, 56, 57, 58 against the code. Each is accurately stated.

**2. Is anything listed as a limit not actually a limit?** No. All accepted limits correspond to real code behavior.

**3. Is any DISCHARGED item not actually discharged?** No. The discharged items (1a-5, 11, 12/17, 14, 15, 16, 18, 19, 20, 21, 23, 24, 30, 31, 33, 51, 54) are correctly discharged.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are genuinely open. `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline`, and `vault_collection` as OPEN. The holder guide is still DRAFT. The dress rehearsal has not been run.

## Findings

**None at CRITICAL, HIGH, or MEDIUM severity.**

### LOW-1: `expire_boosts` reverts the entire batch on a non-record account

**Construct:** `programs/cbob-vault-mint/src/lib.rs`, `expire_boosts`, the `load_record(ri)?` call.

**What happens:** If any account in the remaining accounts is not a valid vault record (wrong owner, wrong discriminator, wrong version), `load_record` returns an error and the entire `expire_boosts` instruction reverts. A griefer could include a non-record account to make a batch fail.

**Impact:** Minimal. The caller can retry with valid records. No state is corrupted. No funds are at risk. This is a liveness annoyance, not a security issue. The crank controls which records it passes.

**Evidence:** Reading the code: `let mut r = load_record(ri)?;` propagates the error. A test passing a system account as a record would revert.

**Fix:** Change `load_record(ri)?` to a match that skips invalid records (like the `crank` function does with `match load_record(a) { Ok(r) => r, Err(_) => continue }`). However, this is a program change before the lock, and the current behavior is safe (fail-closed). I note it for completeness but do not recommend changing it at this stage.

### INFO-1: HOLDER-GUIDE "Run a payout" description omits boost expiry

**Construct:** `HOLDER-GUIDE.md`, "How you get paid" section, line about the redeem page offering to trigger a payout.

**What it says:** "The redeem page offers this and does the steps for you (a payout can only run once every boost that has run its course is ended and every newly activated vault has joined, which the page also does, free)."

**Observation:** This is accurate after the round 36 L2 repair. The page now expires due boosts before distributing. The description correctly names both prerequisites. No correction needed.

### INFO-2: SPEC item 38 `vault_collection` OPEN status

**Construct:** `SPEC.md` item 38, `launch/mainnet-init.json`.

**Observation:** Item 38's "Still OPEN" sentence now correctly lists `vault_collection` alongside the charter date and lock deadline (round 36 I2 repair). The checker refuses while it's OPEN. Road step 10 creates the collection. **Accurately stated.**

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the mainnet dress rehearsal (item 22) with full fidelity.** The crank, alarm, and revenue cycle have never run against a live cluster. The rehearsal must include: the crank's live passes at scale, one full revenue cycle through both pools, one forced post-sweep failure walked through hand recovery, and the alarm in rehearsal mode. This is the single largest remaining gap.

2. **Complete item 50 (holder surfaces) before any vault is minted.** The redeem page is the only pre-signature check for undeclared holdings. Until it's published, items 9 and 44 have no preventive control. The claim and buy pages are the only way to get a vault. The ceremony page is the only way to initialize.

3. **Verify the deployed bytes against `dist/SHA256SUMS` after deployment, before removing upgrade authority.** The ceremony's `judgeProgramBytes` uses the config pins. Ensure the pins match the actual release build (round 36 L4 showed they can drift). After deployment, dump each program and hash-compare before `set-upgrade-authority --final`.

4. **Test the holder pages with a real Phantom wallet (desktop and mobile) before publication.** The `signExact` guard refuses any message modification. Whether Phantom modifies messages in `signTransaction` cannot be tested offline. One real signature per page type would confirm.

5. **Fund the revenue address above rent exemption and create the three cbBTC accounts (item 52) before the first paid mint or royalty.** The ceremony handles this, but verify it happened before any value flows.

6. **Record the vault collection address in `launch/mainnet-init.json` and `web/src/config.js` immediately after step 10 creates it.** The holder pages refuse until the collection is set. The checker refuses while `vault_collection` is OPEN.

7. **Set `charter_opens_at` and `lock_deadline` before the ceremony.** These are the last two OPEN values. The checker refuses while they're null. `lock_deadline` must be before `charter_opens_at` so nothing holds value under an upgradeable program.