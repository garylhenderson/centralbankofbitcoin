# Round 30 independent audit — CBOB Vaults v6

**Verdict: no new CRITICAL or HIGH finding survives measurement in the five programs or the off-chain reader as presented.** I independently recomputed the cross-program offsets and account spaces, re-read the pairing, emptiness, pool, draw, boost, governance and rate-limit code, and checked the round-29 repairs. The two round-29 findings (M1 reader truncation, L1 coverage gate) are repaired in the tree as described; I found no surviving defect of that shape and no regression introduced by the repair.

What follows is ordered by the targets you named, then the four questions about the accepted limits, then the structural gap.

---

## R0. Round 29's verdict and repairs

Round 29 was NOT CLEAN: one MEDIUM (a stranger could halt every alarm pass with one ordinary transaction whose logs the runtime truncated) and one LOW (the coverage gate did not cover the files SPEC said it covered). Both are repaired in the tree you handed me:

* `bank/txread.mjs` still refuses the runtime `Log truncated` marker by default; the walking scanners pass `{ truncatedLogs: 'flag' }`, receive the transaction otherwise fully validated, page it as `log_coverage_gap`, keep their cursors, and still run every instruction- and token-movement detector. The revenue scan reads outflow from instructions, not logs. The poster queues a rejected hand-draft entry when BURN was invoked at the top level. The SPEC reader-coverage boundary states the remaining gap.
* `scripts/audit-coverage.sh` now enumerates every tracked file under `programs/`, `bank/`, `scripts/`, `sim/`, `launch/` and `tests/` plus the four documents and the workspace manifests, with named exclusions, and refuses an empty listing.

I re-read the repair and the selftest arms described in `VALIDATION.md`. I found no way for a CBOB event to be lost silently on the repaired path that is not already stated in the SPEC boundary, and no way for the cursor to advance past something it should not. The selftest mutation evidence (11 of 12 applicable mutations caught) is the right shape.

I did **not** re-run the 855-assertion suite, the simulation, the mainnet probe or the swap fork. Nothing in this report rests on a claim that those runs did not measure what they say; where I disagree with a prior conclusion I say so and name the measurement that would settle it.

---

## R1. Custody: can anyone but the owner get value out of a sealed vault, or an emptied vault survive?

**Pairing.** `open_for_redemption` walks top-level instructions only, requires a later `burn_vault` whose account 0 is this asset and account 2 is this owner. `burn_vault` requires an earlier `open_for_redemption` whose account 0 is this asset and account 2 is this owner. Both bind asset **and** owner. A wrapper CPI cannot satisfy either half because `load_instruction_at_checked` sees top-level instructions and `load_current_index_checked` reports the outer instruction index. The suite's WR.1–WR.4 measure the four wrapper shapes and the vault stays live with everything it held. I re-derived the account positions (`BURN_IX_ASSET_IDX = 0`, `BURN_IX_OWNER_IDX = 2` in SEAL; `SEAL_IX_ASSET_IDX = 0`, `SEAL_IX_OWNER_IDX = 2` in BURN) and they match the `BurnVault` and `OpenForRedemption` structs. No new defect.

**Emptiness proof.** The reserve loop derives both the classic and Token-2022 ATA for every reserve mint from the SEAL config, requires each to be present, and if present and token-owned checks PDA ownership, delegate, close authority, length exactly 165, and amount zero. The second loop catches any other declared token account the PDA owns, including non-reserve mints, and applies the same three delegate checks plus the 165-byte rule. A declared live Core asset is refused. Undeclared accounts are destroyed, which is accepted limit 44 and stated. I recomputed the offsets used (mint 0, owner 32, amount 64, state 108, delegate 72..76, close authority 121..129, length 165) and they are right. No new defect.

**A thawed vault cannot leave unburned.** The transaction is atomic. If the burn reverts, the thaw reverts. If the burn succeeds, the asset is destroyed. There is no instruction anywhere that empties a vault and leaves it alive. No new defect.

**R1s. The sweep helper.** I read it line by line.

* (a) Called directly it needs the asset-signer's signature, which only Core can give, and Core gives it only for the owner (measured SR.5–SR.5e; the one plugin route that can approve another party, AgentIdentity, cannot be added by an owner, measured R24.1a). A thawed vault outside a redemption is impossible: the only thaw is `open_for_redemption`, which refuses without a later paired burn. No new defect.
* (b) The pair list: duplicate source closes the first and the second read fails; a source that is also a destination is refused by `signer.key == dest.key` or by the destination-owner check; a wSOL source is just a token account of that mint; a delegate or close authority on the source does not stop the token program's transfer or close if the PDA is the owner; a frozen source reverts the whole redemption (SR.14); the destination must be owned by the one destination wallet and have the same mint; a non-ATA destination is allowed if it satisfies those two checks; the destination wallet cannot be the vault's asset-signer (refused) and cannot be another vault's asset-signer unless that other PDA is the named destination wallet and owns a same-mint account (it would have to be a token account of the other vault, which is possible only if the other vault already holds that mint — then the helper would move value into the other vault's wallet, but the caller chose that destination and the other vault's contents are not the caller's to move; this is the same trust as naming any destination). An odd account count or zero pairs is refused by the length check; zero pairs is a lamports-only sweep (SR.13). No new defect.
* (c) The destination wallet is chosen by the transaction builder; the helper does not compare it with the asset owner. Given (a), only the owner can drive the helper through Core, so the owner chooses their own destination. A lamport-only transfer to a destination below rent exemption that does not exist is refused by the System program, which the client must avoid (SPEC item 50 states the canonical destination is the owner). No new defect.
* (d) The lamport sweep reads `signer.lamports()` at execution and transfers all of it. Nothing else in the same transaction can deposit after it and before BURN because the helper is the only instruction between the open and the burn that the client builds; a client could insert another instruction, but the owner signs the whole transaction and can already do anything. BURN's `lamports == 0` check sees exactly what the sweep left. No new defect.
* (e) The reserve loop requires every reserve ATA to be declared. The sweep helper cannot name an account that does not exist. SPEC's REDEEMING step 1 requires the page to create missing reserve accounts in a prior transaction. A stranger can create a classic ATA for any owner permissionlessly and deposit into it before the redemption lands; the page's prior transaction creates the vault's own reserve ATAs, so the stranger's deposit lands in an existing account and the helper sweeps it. A Token-2022 ATA for a classic mint cannot exist (the ATA program refuses it, measured in the mainnet probe). A non-ATA token account owned by the vault PDA can exist; if declared, the second loop checks it; if not declared, it is destroyed (accepted limit 44). A nested Core asset is not a token account and is destroyed if undeclared (accepted limit 9/44). No new defect.
* (f) S8.0 measures 1,061 bytes with the owner paying and no compute-budget instructions; the widest page shape with both compute-budget instructions and a separate payer is about 1,209 of 1,232. A fourth reserve does not fit (9.14/9.15), and `MAX_RESERVE_MINTS = 3` is correct. A redemption carries no crank. No new defect.
* (g) SR.0–SR.4a and S8.* exercise the helper from the suite and the simulation. I found no arm that cannot fail and no arm refused for a reason other than the one named. The helper's mainnet bytes are proven identical to the tested bytes by `scripts/build-mainnet.sh` (it has no key to swap). No new defect.

---

## R2. The community pool's money

I re-derived the invariant `pool balance >= ceil(owed_scaled / ACC_SCALE)`.

* `credit` adds `delta * w` to `owed_scaled` where `delta = floor(avail * ACC_SCALE / w)`. The increase in `ceil(owed)` is at most `avail`, and `avail = balance - ceil(owed_old)`, so the invariant holds.
* `claim` subtracts `settled = pay * ACC_SCALE` from `owed_scaled` and pays `pay` from the pool. `ceil(owed_new) = ceil(owed_old) - pay`, and `balance_new = balance - pay`, so the invariant holds.
* `retire` subtracts the vault's `owed_of` from `owed_scaled` and moves no tokens, so the invariant holds.
* `reweigh` preserves `owed_of` exactly (carry is set to the old owed, debt to the new weight times acc).
* `join` leaves `owed_of` at zero.
* `distribute` refuses `PoolShort` if `balance < ceil(owed)` before crediting.

I checked every counter (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`, `boosts_active`, `boosts_due`, `boost_weight_total`, `boost_expiring`) under every ordering the host instructions allow: request then distribute, request then claim, claim before/after distribute, retire a waiting vault, retire a due-boosted vault, expire inside a claim, expire via `expire_boosts`, boost and distribute in one transaction in both orders. The host unit test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` drives 260 epochs against a model rebuilt from the records and checks every counter per epoch. I found no counter that can underflow, double-count, or drift. The `JoinWaitingFirst` gate and the `BoostsExpireFirst` gate are checked before any burn and before any credit. Liveness: anyone can join a waiting vault (`claim` names it) and anyone can expire a due boost (`expire_boosts` or `claim`), so neither gate can be held shut by one party. No new defect.

The true rule about revenue that arrived before a vault joined is SPEC's weaker one (a vault never earns from a distribution that ran before it joined; it does share revenue already in the pool when it joins, at the next distribution). That is stated. No new defect.

**R2b. The $CBOB boost.** I re-derived the ring arithmetic. `max_boost_epochs = 63` and `BOOST_RING = 64`, so a boost bought at epoch `e` ends at `e + N` with `1 <= N <= 63`. For two live boosts to share a ring slot, their end epochs must differ by a multiple of 64. If boost A ends at E and boost B ends at E+64, B must be bought at epoch `E+64 - N_B >= E+1`, so B cannot be live when A becomes due at E. Therefore no live boost is marked due early. `advance_epoch` moves the slot's count to `boosts_due` exactly when `dist_epoch` reaches the end epoch. `unschedule_boost` decrements the correct counter (`boosts_due` if already due, else the ring slot). `expire_boost` requires `dist_epoch >= boost_end_epoch`. The ring wrap is safe. The host unit test and the suite's BO.* arms (including BO.34–BO.38 on chain) exercise the wrap and the not-yet-due retirement. No new defect.

A boost earns exactly N distributions: the distribution that makes it due is refused until it is expired, and expiry happens at the accumulator its last distribution left. A boost bought in a host that also runs an inline monthly distribution earns from the next one, because `monthly_inline` runs before the boost is recorded. The reverse order (`[distribute, boost]`) is measured (BO.35) and earns from the one after the new epoch. No new defect.

---

## R3. The level draw

`blockhash_in_window` parses the SlotHashes sysvar defensively: pins the sysvar id, bounds the count at 512, checks the buffer holds the declared entries, refuses an all-zero hash, and takes the smallest produced slot in `[want, want + 64]`. `try_capture` takes A at or after `reveal_slot`, then B and C each two leader groups (8 slots) after the previous produced slot, and hashes `sha256(hA || hB || hC || asset)`. A missed window is rescheduled to `now + 16`, a future slot. The FIFO is enforced by `index == revealed_total`. A burned vault at the head still takes its draw and the Core write is skipped. The attribute re-supply hash is checked against the mint's stored hash.

SPEC 26 states that C's leader chooses among many draws. The holder guide states it truly ("the validator producing the last of those blocks can pick among several results ... one choice affects every vault created in that moment at once"). I found no additional influence for a minter, a crank operator or a slot leader beyond what 26 states. No new defect.

---

## R4. Governance

One vault one vote bound to the asset via `VoteRecord` PDA at `["vote", proposal, asset]`. Electorate fixed at creation by `index_snapshot`; a vault with a higher mint index is refused `VaultTooNew`. Live supply divisor is `minted_total - burned_total - bare_retired` snapshotted at creation. Quorum 21%, threshold 51%, turnout 10% YES, key changes need 50% of the snapshot, never bundled, land after a 7-day notice. Overtaken actions are logged no-ops. I re-derived every offset GOV reads from MINT, BURN and the VaultRecord and they are correct. I checked the ordering marks (`last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`) and the skip conditions: a newer decision always supersedes an older one of the same kind; an older one cannot execute later; a stale restart half is skipped by stop time; `tighten_sweep` is monotone. No minority can carry an ordinary proposal below the quorum and turnout; no vote can reach the split, the destinations, `max_supply`, the royalty, the reserve list or a vault. No governance freeze beyond the accepted limits 45 and 47 (a stolen guardian key can hold stops shut while fewer than half of all live vaults vote to replace it; with no vaults, no proposal can be created until a round mints one). No new defect.

---

## R5. The charter claim

The Proof of Burn is identified by address against a Merkle root of 240 addresses, domain-separated and sorted. It is CPI-burned as its owner in the same instruction. The window is fixed at `initialize`, closes forever by clock alone, and is not gated by the guardian's sales stop. `pob_extra` accounts are passed through to Core's burn never as signers, up to 8. SPEC 46 states the full consequence of the hot Giraffish Moments update authority: through the 7-day window it can end the project or capture governance, and it cannot transfer or burn an individual Proof of Burn. The per-asset alarm blind spot is stated. No new defect.

---

## R6. One-time configuration and the trusted hop

I re-read every `initialize` across the four programs and checked what each accepts and refuses. The values that can never be corrected are listed in `launch/mainnet-init.json` and checked by `scripts/check-launch-params.mjs`. The program-side checks are a subset of the checker (SEAL reads only owners; off-curve keys are accepted; `redeem_window_secs` may be anything from 10 s to 24 h), which is stated in accepted limit 38. The 10% royalty is a Core plugin with authority `None`; the suite's R.1–R.6c prove even the update authority cannot change or remove it. The redemption cap is a rolling window over a 64-slot ring of timestamps: `k = min(max(ceil(live*210/10000),1),64)`; the k-th most recent redemption must be at least `redeem_window_secs` old. That is exactly a rolling window, not a bucket. The suite's RL.1a–RL.7 and S10.* exercise it. No new defect.

The swap operator is the one trusted key. Its worst case is the per-sweep cap times the number of cooldown windows before the guardian stops it, never more than the revenue PDA holds above the reserve. That is stated in accepted limit 10. The operator must sign, a vote can only tighten inside the `initialize` bounds, a replacement needs half of all live vaults plus 7 days' notice, and the guardian can stop the sweep and cancel a pending replacement. No new defect.

---

## R7. Cross-program raw reads

I recomputed every offset and account space from the struct definitions.

**MintConfig** (space 1005 + 256 padding = 1261): version 8, collection 9..41, governance 41..73, pool_ata 73..105, round_id 105..109, opens_at 109..117, closes_at 117..125, price 125..133, cap 133..137, minted_this_round 137..141, minted_total 141..149, max_supply 149..157, bank_treasury 157..189, split_bps 189..191, sales_stopped 191, sweep_stopped 192, guardian 193..225, swap_operator 225..257, sol_reserve_lamports 257..265, bump 265, max_sweep_lamports 266..274, sweep_cooldown_secs 274..282, last_sweep_at 282..290, level_caps 290..310, level_minted 310..330, revealed_total 330..338, payment_mint 338..370, pob_collection 370..402, pob_root 402..434, charter_opens_at 434..442, charter_closes_at 442..450, charter_claimed 450..454, bare_burns_retired 454..462, total_active_weight 462..470, active_count 470..478, acc_scaled 478..494, owed_scaled 494..510, last_distribute_at 510..518, sales_stopped_at 518..526, sweep_stopped_at 526..534, pending_swap_operator 534..566, pending_swap_operator_at 566..574, monthly_secs 574..582, pending_guardian 582..614, pending_guardian_set 614, pending_guardian_at 615..623, notice_secs 623..631, sweep_floor_lamports 631..639, cooldown_ceiling_secs 639..647, reserve_ceiling_lamports 647..655, dist_epoch 655..663, pending_count 663..671, pending_this_epoch 671..679, cbob_mint 679..711, max_boost_weight 711, max_boost_epochs 712..714, boost_price 714..722, boost_weight 722, boost_epochs 723..725, boosts_active 725..729, boosts_due 729..733, boost_weight_total 733..741, cbob_burned_total 741..749, boost_expiring 749..1005, padding 1005..1261.

Every offset read by BURN (`141`, `454`), GOV (`41`, `141`, `454`, `442`, `257`, `266`, `274`, `191`, `192`, `518`, `526`, `631`, `639`, `647`, `711`, `712`) and the tests matches.

**VaultRecord** (space 221): disc 0..8, version 8, asset 9..41, mint_index 41..49, reveal_slot 49..57, level 57, charter 58, entropy_set 59, entropy 60..92, attrs_hash 92..124, bump 124, active 125, retired 126, reschedules 127..129, vault_ata 129..161, debt_scaled 161..177, pending 177, request_epoch 178..186, boost_weight 186, boost_end_epoch 187..195, carry_scaled 195..211, padding 211..221. GOV reads 8, 9, 41 correctly.

**BurnConfig** (space 8+1+32+1+8+8+1+512+256 = 827): disc 0..8, version 8, collection 9..41, bump 41, burned_total 42..50, redeem_window_secs 50..58, rate_head 58, rate_ring 59..571. GOV reads 42 correctly. The suite reads 42, 50, 58, 59 correctly.

**SEAL Config** (space 8+1+32+4+96+1+256 = 398): disc 0..8, version 8, collection 9..41, reserve_mints 41.., bump. MINT and BURN read 8, 9, 41 correctly.

The sweep helper reads classic SPL token accounts by raw offset: mint 0, owner 32, amount 64, length 165. Correct.

No wrong offset.

---

## R8. The suite, the simulation and the build as evidence

I looked for arms that cannot fail, arms whose negative fires for a different reason than the one named, and claims in the prompt that no arm exercises.

* The suite's `because()` list pins the reason for every negative. I spot-checked several and they match the error enums. The uniqueness check (`ID.1`) ensures a reason pin reads its own arm.
* Arms that could not fail in earlier rounds were repaired (e.g. `RL.1` was dropped as a tautology, `X.7` is honest about the empty census, `P.11a` now has a fixed expected line for all five levels).
* Claims in the prompt that no arm exercises: the 7-day proposal execution deadline is a constant and is not exercised (stated); the 30-day monthly period is exercised at 150 s in the suite and 120 s in the sim (stated); the 3600 s redemption window is exercised at 10 s in the suite and 20 s in the sim (stated). The mainnet probe and the swap fork are network-dependent and are skipped loudly without network; a certifying run must show them run (`CBOB_SHIP_GATE=1` refuses a skip).
* The build: `scripts/build-mainnet.sh` proves the four initializing programs reject the localnet test key and accept it in the localnet build, and proves the sweep helper's mainnet bytes are identical to the tested bytes. It does not prove the compiled constant is Gary's key (a third wrong key would reject the test key identically); the bridge is reproducibility from the commit and the source check. That is stated.

No new defect.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?**

I found none. The limits I re-measured or re-read against the code match their statements:

* Limit 26 (leader of C chooses among many draws) is stated with the measured best-of-4 effect and the cohort effect.
* Limit 32 (redemption cap queues honest holders and can be spent by redeeming one's own vaults) is stated with the cost.
* Limit 41 (a leaked custodial key can transfer vaults at once, the cap only bounds redemptions) is stated.
* Limit 44 (undeclared airdrops and nested vaults are destroyed; the sweep helper can rescue classic stray tokens; Token-2022, frozen strays and nested Core assets are not covered) is stated.
* Limit 46 (the hot PoB collection key can end the project or capture governance through the 7-day window) is stated in full.
* Limit 47 (a stolen guardian key can hold stops shut for good below half turnout) is stated.
* Limit 56 (the whole $CBOB supply is on a hot box key) is stated.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**

The items moved to DISCHARGED in v6 (Bank key, co-signer, deck, distributor) are gone with the things they were about. The ones I checked are correctly discharged: duplicate attribute keys are refused (`DuplicateAttribute`); the unlevelled-vault halt cannot arise (`activate` refuses `NotRevealed`); the 85/15 is not a vote; the free path's period is an `initialize` value and is exercised. I found no item in ACCEPTED that is actually already closed by code the author did not notice.

**3. Is any DISCHARGED item not actually discharged?**

The compute-unit item (12/17) is discharged by measurement on the v5 artifact and re-measured on v6 (10.1–10.6b), with the byte wall binding before the compute wall. The duplicate-attribute item (14) is closed on chain. The unlevelled-vault item (19) is closed by construction. Items 30, 31 and 33 are discharged by stage 3b/3c and exercised. I found no discharged item that is not actually discharged.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No. The three open items are named and gated:

* 22 (no distribution or revenue cycle has ever run against a live chain) — the dress rehearsal is a named pass/fail with five items including one full revenue cycle through both pools and one forced post-sweep failure recovered by hand.
* 38 (every `initialize` value is permanent) — the values live in one file, `check-launch-params.mjs` refuses it before signing, and the alarm reports a wrong one after. The checker validates the JSON, not the signed transaction; the build must be from that file. Stated.
* 50 (the holder surfaces are not built) — the holder guide is marked DRAFT and may not be published before the surfaces ship; the sweep helper is built and byte-identical; the redeem page must run `judgeRedemptionCoverage` and sweep through the helper. Stated.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The structural things an AI audit cannot do, and what this project should do before launch:

1. **Run the mainnet dress rehearsal at throwaway program ids with the shipped off-chain code and the shipped alarm, and record the transaction signatures for every named pass/fail item.** The AI can read the rehearsal script and the alarm's rehearsal mode; it cannot execute a live cluster with 2,100 vaults, a transient RPC error on vault 1,900, a wedged lock, a slow RPC socket, a truncated log, a forced post-sweep failure and a hand recovery. The rehearsal is the only thing that exercises the crank's I/O, the revenue cycle's I/O, the alarm's live passes and the recovery runbook. It must include one full revenue cycle through Orca and one with Orca forced to refuse so Meteora really runs, and one forced post-sweep failure walked through the hand recovery, each with its signatures. `CBOB_SHIP_GATE=1` must be set so the mainnet probe and the swap fork cannot be skipped.

2. **Build the holder surfaces before the lock, and run `judgeRedemptionCoverage` before every holder signs.** The chain cannot enumerate what a PDA owns. The only preventive control against a holder destroying an airdrop or a nested asset is the redeem page. The page must also create missing destination accounts and missing vault reserve accounts in a prior transaction, offer to trigger and join a payout first, sweep through the helper, close every reserve account it empties, set the compute-unit limit on any transaction carrying a crank, and send no crank when `pob_extra > 0`. The deposit-address page must show the asset-signer PDA. The redemption poster needs a sender and a website surface.

3. **Do the launch-value ceremony from `launch/mainnet-init.json`, then verify the deployed bytes against `scripts/build-mainnet.sh`'s sha256, then remove the upgrade authority from all five programs.** The AI can check the JSON and the source; it cannot hold Gary's key, sign the four `initialize` transactions, verify the deployed bytes on mainnet, or remove the upgrade authority. This is the last moment any of the permanent values can be corrected. The checker validates the JSON, not the signed transaction; whoever builds the transactions must build them from that file.

4. **Have a human read the holder guide against the code one last time, and publish it only after the surfaces exist.** The guide speaks of the deposit-address page and the redeem page in the present tense. It is marked DRAFT. A human must confirm every sentence is true of the deployed programs and the built surfaces, including the honest list. The AI can compare sentences to code; it cannot decide whether the copy is acceptable to holders or whether the honest list is complete enough for the product.

5. **Re-run the full certification on the release commit with the frozen tree, with two different model rosters, and record the build and rehearsal proofs.** The AI process is the certification. The freeze gate requires no change to `programs/`, `bank/` or `scripts/` since the first clean round began; the coverage gate must exit 0; every accepted finding must have a gate that fails the build proven both ways; every rejected finding that can be measured must be an assertion. The two clean rounds must be against the same frozen tree with different rosters. Nothing in this report substitutes for that.

6. **Fund and monitor the operational keys and accounts.** The revenue address needs rent and its cbBTC account; the pool's cbBTC account and the Squads' cbBTC account must exist before the first split; the operator wallet must hold only the cycle's funds and its fee float; the swap operator key and the $CBOB release key are hot on the box and in backups. The AI can read the code that requires these; it cannot create the accounts, fund them, or watch the box. The alarm watches the program upgrade authorities and the third-party programs; a human must watch the box's keys, the crontab, the ledger and the alert router.

7. **Decide whether to accept the permanent dilution from an activated orphaned vault (round 29 D2) or to add a program instruction to retire such a vault before the lock.** A vault nested in its own asset-signer PDA or in a burned host's PDA, if activated, keeps its weight in `total_active_weight` forever and can never be redeemed or retired. Every other vault pays for it at every distribution. The AI can state the cost; the owner must decide whether to change the program before the lock or accept it and document it.

8. **Decide the open launch values (the charter opening date and the lock deadline) and the remaining open items.** The charter opening date is Gary's; the lock deadline follows from it. The launch checker refuses the file while any value is OPEN. Nothing can mint until they are set.

---

**Summary of new findings:** none at CRITICAL or HIGH. The round-29 repairs hold. The accepted limits are stated correctly and I found none that is worse than stated, none that is not actually a limit, no discharged item that is not discharged, and no OPEN AND BLOCKING item being treated as accepted. The structural gap is the dress rehearsal, the holder surfaces, the launch ceremony and the human decision on the orphaned-vault dilution.