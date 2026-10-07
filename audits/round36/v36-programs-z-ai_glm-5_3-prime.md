# Round 36 Audit Report

## R0. Round 35's verdict and repairs

**Verdict: the repairs hold.** I independently verified each round 35 change against the current tree:

**`rescue_nested` (item 58):** The M1 fix is in place — every rescue goes to `bank_treasury` (`let dest = a.config.bank_treasury;` at MINT:1860, `WrongRescueDestination` otherwise). The live-host branch requires `require_live_vault(&a.host, &a.config.collection).is_ok()` — a foreign live asset is refused `HostUnresolved`. The `RESCUE_SEED` PDA signs in exactly one `invoke_signed` (MINT:1867); no other signing path uses it. The transfer CPI's accounts match the suite's `ixRescue` byte-for-byte (verified in `web/test/plan.test.mjs` and `ix.test.mjs`). The suite arms R35.N1-N9, N2a, N8a all pass against real Core. The `RescueNoProgress` error is gone from the enum (single destination makes it unreachable). **No defect found.**

**Web pages (item 50):** The H1 fix is real — `plan-redeem.mjs` now refuses only reserve-account problems and nested CBOB vaults; everything else a stranger can deposit (Token-2022, frozen strays, unreadable accounts, foreign NFTs, compressed NFTs) is named in a ticked acknowledgement box. The `judgeRedemptionCoverage` cross-check's `named` set correctly filters falsy empty strings (the `forfeit` ack's split produces `''`, which the `a &&` guard excludes). The M2 fix (ceremony reload) uses localStorage + a chain scan of Core collections whose update authority is MINT's PDA; any two sources disagreeing is a STOP. The M3 fix strips `source`/`_comment` from the embedded launch values. The M4 fix (local ceremony mode, SRI, BUILD.txt) is in place. The proxy M1 fix requires Origin, checks `Sec-Fetch-Site`, pins `getProgramAccounts` shapes byte-for-byte, and caps responses while streaming.

**One gap in the web tests I verified:** `web/test/plan.test.mjs:183` asserts "a stranger cannot block an opening with junk" — this is now true for the H1 vectors, and the blocking cases at `:152`/`:156` are for the vault's OWN reserve accounts (Coinbase freeze, foreign close authority), which are genuine refusals the programs would make too. The test's claim and the code now agree.

## R1. Custody

**The pairing holds.** SEAL's forward walk and BURN's backward walk both bind asset AND owner, both read only top-level instructions from the sysvar, and both fail closed. The wrapper attacks (WR.1-WR.4) are refused by the stack-height check in `retire_redeemed` and the top-level walks in both programs. Two redemptions in one transaction are rate-limited (4.9, 4.10a). The emptiness proof checks PDA lamports, both ATA derivations for every reserve mint, delegates, close authorities, extensions, and nested Core assets.

**No path leaves a thawed vault unburned.** The thaw is a Core plugin update inside the same transaction as the burn; if the burn fails, the transaction reverts and the vault stays sealed.

## R1s. The sweep helper

**(a)** Access control is Core's `ExecuteV1` rule: only the asset's owner. The vault is born `PermanentFreezeExecute` frozen; only SEAL's `open_for_redemption` (which requires a terminal burn) can thaw it. SR.5/SR.5a/SR.5b/SR.5c/SR.5d/SR.5e pin this against the real Core binary. The rescue delegate (`PermanentTransferDelegate`) has no Execute hook and cannot widen Execute access.

**(b)** The pair checks are correct: source owned by the signer, destination owned by the one destination wallet with the same mint. Duplicate sources fail on the second close (SR.12a). A source that is also a destination is refused (`signer.key == dest.key`). A wSOL source is handled (it's a classic token account; the transfer and close work). A frozen source's transfer reverts the whole redemption (SR.14). Zero pairs work (SR.13).

**(c)** The destination wallet is chosen by the transaction builder, but only the owner can sign the Execute. A destination below rent exemption fails the System transfer — the canonical destination is the owner (who pays the fee and exists). R27.S1 confirms non-System destinations work.

**(d)** The lamport sweep reads `signer.lamports()` at execution. BURN's `lamports == 0` check sees exactly what the sweep left (zero), because nothing can deposit into the PDA between the Execute and the burn inside the same atomic transaction.

**(e)** The closed account passes BURN's check for the right reason: the account no longer exists, so it's not in `remaining_accounts` (the page doesn't declare it), and BURN's loops skip non-existent accounts. A stranger-created classic ATA with dust is swept by the helper (live balance) and closed. A Token-2022 ATA is refused by the helper's `read_token` (owner is Token-2022, not classic SPL) — but the page never names it (it's in the `cannot` box). SPEC's REDEEMING step 1 (prior transaction creates missing reserve accounts) is implemented in the page.

**(f)** S8.0 measures 1,061 bytes for the plain shape; the page's `build` adds C5 transfers only when they exist, and the packet fitting drops strays that don't fit (named in boxes). The compute is measured (S8.1a: 168,343 CU, within the 4-instruction default of 800,000).

**(g)** SR.0-SR.4a, SR.5-SR.14, S8.* are all non-vacuous (each `because()` pin names the exact error). The helper is deployed from the same bytes `build-mainnet.sh` proves (byte-identical localnet/mainnet, `cmp`'d against `target/deploy`).

## R2. The community pool

**The invariant "the pool always holds at least ceil(owed)" holds.** `credit` adds `delta * w` to both `acc_scaled` and `owed_scaled`. `claim` subtracts exactly what it pays. `retire` subtracts the pending share. `distribute` refuses `PoolShort` if `balance < owed`. P.32 and the `ledger()`/`books()` checks verify this after every money operation.

**Counter consistency:** `pending_count` and `pending_this_epoch` are maintained under every ordering I could construct:
- `activate` (request): both increment.
- `join`: `pending_count` decrements; `pending_this_epoch` was already reset by `advance_epoch`.
- `retire` (waiting vault): both decrement (if same epoch for `pending_this_epoch`).
- `advance_epoch`: `pending_this_epoch = 0`.
- F21.1/F21.2 test the waiting-vault retire for both same-epoch and earlier-epoch cases.

**Liveness:** `distribute` and `monthly_inline` are permissionless. The `JoinWaitingFirst` gate prevents a first-caller from ticking and joining only themselves. The `BoostsExpireFirst` gate prevents distributions past due boosts. Both gates are bypassable by anyone performing the prerequisite action (joining, expiring), which is free. **No permanent distribution block found.**

**Round 24 W11 (revenue before joining):** SPEC's weaker rule is what the code does. A vault that requests, becomes eligible, and then splits+distributes in one transaction shares the unsplit revenue. This is accepted (limit 55).

## R2b. The $CBOB boost

**A boost earns exactly N distributions:** `boost_end_epoch = dist_epoch + epochs` at purchase. The distribution that makes `dist_epoch == boost_end_epoch` is the Nth. `advance_epoch` adds `boost_expiring[end % 64]` to `boosts_due` when `dist_epoch` reaches `end`. No distribution runs while `boosts_due > 0`. `expire_boost` requires `dist_epoch >= boost_end_epoch`. The host unit tests (`the_boost_ring_wraps_exactly_against_a_model`, `the_boost_schedule_through_the_programs_own_functions_across_four_wraps`) drive 260 epochs with random buys, retires and expiries, and verify every counter against a model rebuilt from the records alone.

**Nothing earned is lost or gained on a weight change:** `reweigh` moves the owed share to `carry_scaled` and restarts `debt_scaled` at the new weight. `owed_of = weight * acc + carry - debt`. After a reweigh: `new_weight * acc + old_owed - new_weight * acc = old_owed`. Correct.

**Ring consistency past epoch 64:** the slot is zeroed when read (`advance_epoch`), so wraps are correct. BO.34/BO.38 test wrapped buys and wrapped early retires on chain.

**Nobody can make distributions impossible by boosting:** `boost_vault` requires an activated, live, unboosted vault. A vault whose token account is gone can't be boosted (it must be active, which required the account). `expire_boosts` needs only records, not token accounts. The `BoostsExpireFirst` gate is always clearable by `expire_boosts` (permissionless, records only).

## R3. The level draw

The SlotHashes parse is defensive (key pinned, count bounded at 512, buffer checked, zero hash refused). The skipped-slot handling takes the smallest produced slot in `[want, want+64]`. The FIFO is strict (`RevealOutOfOrder`). A burned vault at the head still takes its draw (L.11). The attribute re-supply hash is checked (`AttributesMismatch`). The reschedule targets a future slot.

**What a minter/leader can influence:** SPEC 26 states C's leader chooses among many draws. HOLDER-GUIDE says "can choose among many results" and "pick among several results... can be enough to choose the level." Both are true. **Not worse than stated.**

## R4. Governance

One vault one vote, bound to the asset (VoteRecord PDA). Electorate fixed at creation (`index_snapshot`, `quorum_supply`). No proposal before charter close. Quorum, threshold, 10% turnout, and half-of-all-live-vaults for key changes — all verified in the suite (D.1, 3c.K2, G.8-G.10, F18.*). The guardian change and operator arm never share a proposal. Overtaken actions are logged skips. `TightenSweep` is monotone and bounded.

**Can a minority carry what it should not?** The 10% turnout floor and the half-of-all-live-vaults rule for key changes bound this. At the ruled numbers (21% quorum, 51% threshold), the smallest passing vote is 10.71% YES — above the turnout floor. For key changes, 50% of ALL live vaults is required. No bypass found.

**Can a vote reach money it should not?** The action list is closed: SetRound, Brakes, TightenSweep, ArmSwapOperator, SetBoostTerms. The 85/15, destinations, max_supply, royalty, and reserve list are unreachable. MINT re-checks every bound at execution.

**Can governance be frozen forever?** Limit 45 (every vault redeemed) and limit 47 (stolen guardian key at low turnout) cover this. SPEC 47 is complete: the stop is permanent while fewer than half vote to replace. **Not worse than stated.**

## R5. The charter claim

The PoB is identified by address against the Merkle root (domain-separated, sorted pairs). The burn is a CPI as the owner. The window is fixed at initialize and never reopens. `pob_extra` accounts are passed through never as signers. The PoB collection's hot update authority is an accepted limit (46), fully stated including the end-the-project and capture-governance scenarios.

**Is SPEC 46 complete?** It states: end the project, capture governance, the alarm's sampling blind spot, the positive bound (cannot transfer/burn a PoB), and the per-asset plugin blind spot. I cannot find anything it omits. The web claim page adds a client-side refusal when the PoB or collection carries an external plugin (it sends `pob_extra = 0` and refuses rather than guess), which is a reasonable additional control.

## R6. One-time configuration and the trusted hop

Every `initialize` value is checked by `scripts/check-launch-params.mjs` before signing (49 assertions). The programs check less than the checker (SEAL reads only owners; `redeem_window_secs` may be 10s-24h). The ceremony page runs `judgeLaunch` at both clocks and checks program bytes and probes. The swap operator is bounded: cap × cooldown windows until the guardian stops it, never more than the revenue PDA holds above the reserve. The 10% royalty is a Core plugin with authority None — R.3/R.5/R.6/R.6a/R.6c/R33.G3 prove nobody can change it. The redemption cap is exactly a rolling window over a 64-slot ring of timestamps (RL.2-RL.7).

## R7. Cross-program raw reads

I recomputed every offset (see my working above). All correct:
- MintConfig: version 8, collection 9, governance 41, pool_ata 73, minted_total 141, bare_burns_retired 454, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, charter_closes 442, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, max_boost_weight 711, max_boost_epochs 712.
- VaultRecord: version 8, asset 9, mint_index 41, pending 177.
- BurnConfig: version 8, burned_total 42.
- SealConfig: version 8, collection 9, reserves 41.
- Sweep helper: mint 0, owner 32, amount 64, length 165.

All discriminators are asserted against their sha256 derivations in the suite (3.1a-3.1y).

## R8. The suite, simulation, and build as evidence

The suite's 889 assertions are non-vacuous (each negative is pinned by `because()` to the exact error). The simulation (71 assertions) runs against real Core, real mints, and real PoBs. `build-mainnet.sh` proves the sweep helper's bytes are identical between localnet and mainnet builds, and that all four keyed programs reject the test key. The floors equal the counts.

**One observation on the suite:** the `because()` function finds the FIRST arm with its id. The ID.1 check verifies every id is unique. Good.

---

## The four questions about accepted limits

### 1. Is any limit WORSE than stated?

**No.** I attacked each accepted limit that guards money:

- **Limit 58 (rescue):** the Squads destination is fixed; the rescue PDA signs in one place; the delegate cannot Execute, Burn, or Update. A nested vault keeps its weight and payouts; no other vault is diluted by the rescue itself. The "Squads could vote" residual is stated. **Not worse.**
- **Limit 10 (swap operator):** the bound is cap × windows until the guardian stops it. The judge, the Pyth floor, and the pool-agreement filter are all in place. The operator wallet's contents are an operational instruction, stated as one. **Not worse.**
- **Limit 28 (Coinbase freeze):** the frozen-pool redemption forfeits the undelivered share (3c.F0-F3); the in-line monthly run never credits from a frozen pool; a frozen vault account blocks that vault's whole redemption (stated); a frozen Squads account halts the split (stated). **Not worse.**
- **Limit 41 (transfers not limited):** stated. The holder guide says "The hourly limit slows how fast vaults can be opened, not how fast they can be moved." **Not worse.**
- **Limit 44 (undeclared airdrops destroyed):** the sweep helper rescues classic strays; the page names everything else in boxes. **Not worse.**
- **Limit 46 (hot PoB collection key):** the full consequence (end the project, capture governance) is stated. The web claim page adds a client-side refusal for external plugins. **Not worse.**

### 2. Is anything listed as a limit not actually a limit?

**Limit 42 (prior transaction for destination ATAs):** the web pages now implement this. The limit describes the client contract, which is now built. It could be moved toward DISCHARGED once the pages are published, but the underlying constraint (the padded legacy shape doesn't fit with in-line creates) is still true. **Not closed, but implemented.**

### 3. Is any DISCHARGED item not actually discharged?

**No.** I checked:
- Item 51 (boost): built, measured, owner-only, buyer's terms. Discharged correctly.
- Item 54 (compute): measured; the pages send no crank. Discharged correctly.
- Items 12/17 (compute units): measured on the artifact. Discharged correctly.
- Item 14 (duplicate attributes): refused on chain (11.4). Discharged correctly.
- Item 19 (unlevelled-vault halt): closed by construction. Discharged correctly.
- Items 30/31/33: superseded by the current design. Discharged correctly.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** Items 22, 38, 50, 52, and 53 are all still open and none has been demoted. The web pages (item 50) are built but not published — the item correctly remains open. The dress rehearsal (item 22) has not run. The launch values (item 38) still have two OPEN fields (charter date, lock deadline).

---

## Findings

### MEDIUM

**M1. The redeem page's "Run a payout" does not check for due boosts, and the holder cannot clear the gate from the page.**
`web/src/pages/redeem.mjs` `payoutBlock`. The page joins waiting vaults (handling `JoinWaitingFirst`) but never reads `boosts_due` from the MINT config. If boosts are due (the crank is down or slow), the `distribute` instruction fails with `BoostsExpireFirst`. The dry run catches it and the error is shown, but the page offers no way to expire the boosts — the holder must wait for the crank or use another client. *Costs:* a delayed payout (not lost; the pool holds it). *Who:* a holder trying to collect before opening. *Evidence:* the page's `payoutBlock` reads `pending_count`/`pending_this_epoch` but not `boosts_due`; MINT's `distribute` refuses at `require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst)`. *Fix:* read `boosts_due` in the snapshot; if > 0, either send `expire_boosts` for the due records first (the page already reads vault records via `waitingVaults`'s pattern) or say plainly that a payout cannot run right now and why.

### LOW

**L1. The C5 transfer moves the amount read at re-plan time, not at execution.**
`web/src/lib/plan-redeem.mjs` `transferStrays` → `IX.tokenTransfer(a.address, ..., a.parsed.amount)`. Anything landing in the account between the re-plan and the execution stays in it and is destroyed with the vault. The note discloses this ("Anything sent to that account after this check stays in it"), and the account is a stranger's (they kept the close authority), so the loss is the stranger's dust. *Not a security issue; already disclosed. Recorded for completeness.*

**L2. The metadata generator has no image for an undrawn vault.**
`web/meta/generate.mjs` `UNDRAWN_IMAGE = null`. An undrawn vault's JSON carries no `image` field. This is a known gap (README "Open decisions" #1). Marketplaces may render such vaults poorly. *Fix:* create and pin an `undrawn.png` and set `UNDRAWN_IMAGE`.

**L3. The vault page's "Draw my level" does not set a compute-unit limit.**
`web/src/pages/draw.mjs` sends `reveal_level` (or `capture_entropy`/`reschedule_reveal`) alone. SPEC 54 measures a reveal with its inline capture at 150,344 CU, within the 200,000 default for one instruction. But a reveal on a vault with a large attribute list plus a large autograph could exceed 200,000 (R33.G1 measured the worst shapes at the default budget and they passed, but with no margin stated). The dry run would catch a failure. *Fix:* set the compute-unit limit on the reveal transaction (host cost + 115,000 for the inline capture + margin), or accept the dry-run refusal as sufficient.

### INFO

**I1. The reserve-account-with-foreign-close-authority refusal in `plan-redeem.mjs` is unreachable in practice.**
A stranger cannot set the close authority on the canonical ATA (the ATA program creates it with none, and only the owner can set it — the PDA cannot sign while sealed). The refusal is defensive dead code. Harmless.

**I2. The ceremony's `judgeProgramBytes` correctly handles the ProgramData ELF offset at 45.**
The probe (`scripts/probe-mainnet-facts.mjs`) measured that `set_authority` leaves stale bytes, so the ELF always starts at 45 regardless of the authority's presence. The ceremony's parser uses 45 unconditionally. Correct.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the dress rehearsal (item 22) with every named pass/fail item.** This is the only thing that exercises the crank, the alarm, and the revenue cycle against a live cluster with real state. AI audit cannot simulate RPC failures at vault 1,900 of 2,100, or the every-minute reveal lane keeping up, or a forced post-swap failure walked through hand recovery. These are I/O behaviors, not logic, and no amount of reading can certify them.

2. **Have Gary personally verify the ceremony's values before signing, using local mode.** The ceremony signs immutable values. The local mode (SSH tunnel, BUILD.txt hash comparison) is the right shape, but only Gary can confirm that the values he sees match his rulings. An AI auditor cannot know what Gary ruled in a Linq message. Print the values, read them aloud to Gary, and have him check each one against DESIGN-v6 before connecting Phantom.

3. **Have a human read HOLDER-GUIDE.md aloud against the code's behavior for the top ten holder scenarios.** The guide makes plain-English promises ("Nothing can leave it while it is closed", "Opening is all or nothing", "you can still open your vault" during a pool freeze). Each is true, but the edge cases (a frozen vault account blocks the whole redemption; a pool freeze forfeits the undelivered share) are stated in the honest list. A human should confirm that a non-technical reader would understand the consequences. AI can verify the code matches the sentences; it cannot judge whether the sentences communicate.

4. **Verify the box's operational security by hand.** The $CBOB release key, the swap operator key, the deploy authority key, and the guardian key all live on this box. AI audit can read the file permissions; it cannot verify the box's physical security, the backup chain, or who has SSH access. Item 56 and limit 10's residue (3) state this. Before launch: rotate any keys that were on the box during development, verify the R2 backup actually contains `bank/keys/`, and confirm the box's access list.

5. **Consider a post-launch monitoring fund and a published disclosure channel.** If a bug survives, the programs cannot be fixed. The guardian can stop sales and the sweep, but redemption, the pool, governance, and the charter claim have no stop. A fund (even small) for a fast public disclosure, and a pre-committed incident-response runbook, are things AI audit cannot create but can recommend. The holder guide's honest list already tells holders that a bug cannot be fixed; a channel for reporting one is the operational complement.

6. **Do not skip the second clean round with a different roster.** The ship gate requires two consecutive clean rounds with different model rosters. Round 35 produced no verdict (no quorum). Round 36 (this report) found no CRITICAL or HIGH, but it is one round. The stopping condition exists because twenty-one v5 rounds each found something real. Run round 37 with a different roster against this frozen tree before removing the upgrade authority.