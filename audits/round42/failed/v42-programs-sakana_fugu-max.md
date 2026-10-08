# Independent audit — v6 tree (programs + `web/`), against `4a67d00`

**What I did and did not do.** I read the five programs whole, `web/` whole, the bundled tests, the round‑41 verdict and its VALIDATION, and I recomputed every cross‑program offset, account space and discriminator from the Rust structs. **I executed nothing**: no validator, no `run-tests.sh`, no `web/test/run-all.mjs`, no fork. So every claim below is a claim about the code as written. Where a claim of mine could be wrong for want of a run, I say so and name the arm that would settle it. Files named in the round‑41 off‑chain repairs (`bank/swap.mjs`, `bank/redemption-poster.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/crank.mjs`, `sim/swap-fork.sh`, `scripts/check-launch-params.mjs`) are **not in this bundle**, so C01, C02, C03, C04, C06 and the `SWAP_FLOOR` cannot be verified here — that is a limit of this pass, not a finding against them.

---

## R0. Round 41's verdict and its repairs

**Programs: I found no surviving defect and no regression, and I confirm the verdict's central measurement.** The program diff between round 40 and round 41 is empty (`git diff` is the verdict's own evidence), and I found nothing in the five programs that round 41 missed on the paths I can check.

**V41‑1's repair — verified at every site where it changes a decision, and one site where it does not matter.**

| site | dust (System-owned, 0 bytes) handled? | evidence |
|---|---|---|
| `anchorAccount` (`reads.mjs`) | yes — `absentIfDust` → `null` ("not created yet") | the code |
| `resolveCollection`'s SEAL read (`ceremony-reads.mjs`) | yes | the code |
| `readStep('collection'/'atas'/'fund')` | yes | the code |
| `readBuySnapshot` (holder + revenue cbBTC) | yes | the code |
| `readRedemptionSnapshot`'s pool, `vaultWalletAccounts`' by-address reads | yes | the code |
| `readVault`'s **asset** read | **no** — a dusted address throws `That address is not a Metaplex Core NFT.` | `reads.mjs`, `readVault` |

That last row is **not a defect**, and I am recording it so it is not filed later as one: the message it produces is *true* of a System-owned, 0-byte account, and it changes no decision (the only reachable inputs are an address that never held an NFT, where `/vault/` would otherwise say "there is no NFT at that address"; a real vault's address always holds a Core account). It is a wording difference, not a wrong verdict. If the author wants the rule to be uniform, `absentIfDust` belongs there too; nothing turns on it.

**Gate‑5 obligations for V41‑1.** The arms the verdict asks for are present and correctly shaped: the e2e dusts all four config PDAs with `SystemProgram.transfer` before step 0 and asserts `resolveCollection` returns no conflict and step 0 is still next (`web/test/e2e-localnet.mjs`, the `V41-1 e2e` block), and `ceremony.test.mjs` carries the control (another program's owner, or System-owned *with data*, still refuses). The `R41.C8a–c` arms in `tests/3prog.test.ts` measure the rent rule SPEC item 50 relies on, including the control that the floor itself lands.

**Off‑chain repairs (C01, C02, C04, C06): not verifiable in this pass.** Their files are not in this bundle.

**Documentation exception: correctly not applied.** V41‑1's repair is page code, so it could not qualify. I checked the candidates the verdict lists as non‑qualifying (C5, C12, C13, C18, C19, C21, C22, C29) and agree none is a defect.

---

## R1. Custody — can anyone but the owner get value out of a sealed vault?

**No path found, and the reasoning is mechanical rather than trusting.**

*Pairing.* SEAL's walk is forward-only and fails **closed** (`while let Ok(ix) = load_instruction_at_checked(i, …)` — an early stop leaves `found == false` and refuses the thaw). BURN's walk skips unparsable entries and fails **closed** the same way (`found` stays false). Both bind **asset at index 0 and owner at index 2**; both structs carry the matching "MUST stay account N" comments and the suite asserts the indices (`3.1c`–`3.1f`, `3.1s`). A CPI wrapper sees the *outer* instruction index, so WR.2/WR.3 are the correct measurements, and I re-derived why they must fail: a wrapped open needs a genuine top-level burn, and a wrapped burn needs a genuine top-level open, and neither half can borrow the other's binding.

*Nothing lets a thawed vault leave a transaction unburned.* SEAL requires the burn **later in the same transaction**; if the burn reverts the thaw reverts with it. There is no re-seal instruction anywhere, so a partial sweep cannot be re-frozen and resold. I checked the reverse ordering attack explicitly: a sweep placed *after* the burn makes BURN see a non-empty vault and refuse, so it cannot be used to empty-then-keep.

*Emptiness proof.* The reserve loop requires every mint's ATA under **both** token programs to be declared, and for a declared token account: PDA-owned, no delegate, no delegated amount, no close authority, exactly 165 bytes, amount 0. The second loop re-checks the same six facts for any *other* declared token account the PDA owns, and refuses a declared live `AssetV1`. `asset_signer.lamports() == 0` is required (proven impossibility 4), and the helper now moves those lamports first.

*What I attacked and could not break:*

- **Declared-but-foreign accounts.** `find(|a| a.key() == expected)` matches by key, and the same key in one transaction is one `AccountInfo`, so a duplicate declaration cannot shadow a funded account. A declared account not owned by a token program is skipped — but only the ATA program can create an account at an ATA address (measured R34.G2, R36.G2a/b), and a Token‑2022 ATA for a classic mint cannot be created at all (probe F4.2). So "skip" never hides a balance.
- **Token‑2022.** A declared T22 account owned by the PDA is refused `ReserveHasExtensions` (revert, safe). Undeclared, it is destroyed — accepted limit 44, and the page names it.
- **Lamports.** A stranger can only fund the vault wallet to ≥ rent‑exemption or 0 (R41.C8a/c), so the helper's `System` credit is never sub‑rent, and the destination (the owner, who pays the fee) always exists.
- **The seat.** `PermanentFreezeExecute`'s authority is SEAL's PDA; the owner cannot remove it (0x9), re‑delegate it (0x1b), revoke it (0x1a) or thaw it (0x1a) — R34.G4, R35.N8/N8a, all measured against the pinned Core.
- **The rescue delegate.** `PermanentTransferDelegate` → MINT's `["rescue"]` PDA, and the only instruction that signs with it sends a vault to `bank_treasury` and nowhere else.

---

## R1s. The sweep helper

**(a) Who can make it move value.** Its whole access control is Core's `ExecuteV1` authority rule on a **thawed** vault, and the helper additionally requires `signer.is_signer`. Read at Core `e72d63e` and measured on the pinned binary: SR.5 (stranger, 0x1a), SR.5a (owner-added transfer delegate, 0x1a), SR.5c (a control asset's *collection update authority*, 0x1a), SR.5d (the control's owner, ALLOW). SR.5b pins the CBOB collection's update authority to MINT's off-curve PDA, and R24.1a measures that the one plugin route that could approve an Execute (AgentIdentity) cannot be added. Outside a redemption the vault is frozen and Core refuses before the helper is reached (3.7).

**(b) The pair list.** Every branch is a named refusal and the suite pins the reason for each: odd/zero list (`NotEnoughAccountKeys`), non-`[0]` data (`InvalidInstructionData`), wrong Token/System program id (`IncorrectProgramId`), `signer == dest` (`InvalidArgument`), source not the signer's (`IllegalOwner`), destination not the wallet's same‑mint account (`InvalidAccountData`), duplicate source (second pass hits the closed account), frozen source (Token 0x11). A native wSOL account is only reachable if the destination wallet owns a 165‑byte account of that mint — the source‑owner check is on the *mint*, so a wSOL account is treated as any other classic account and closed; nothing special is needed and nothing is gained.

**(c) Destination.** Safe *because of (a)*: only the owner can drive it. The page names the owner. The one real constraint — a lamports‑only credit must be ≥ rent‑exemption when the destination does not exist — is measured (R41.C8a–c) and documented in SPEC item 50.

**(d) The lamport sweep.** `signer.lamports()` is read at execution, and BURN's `lamports == 0` is checked after. Nothing can land between the sweep and the burn inside the owner's own transaction, and SR.4a asserts the exact lamport delta (gift + pre‑existing wallet lamports + closed‑account rent + the asset's rent refund − fee) with the wallet at 0 afterwards. Core does not re-credit the PDA (proven impossibility 4).

**(e) The missing reserve ATA.** SPEC step 1 is **sufficient**, and I can say precisely why: the page creates `ata(pda, m)` (classic) for each reserve in the prior transaction, and BURN *declares* both derivations regardless of whether they exist (a non‑existent account passed as a meta has `owner == System` and is skipped by the `continue`). What a stranger can put at the vault wallet that neither the helper can name nor BURN will skip:

- a **classic** token account of any mint, ATA or not → the helper **can** name it if the page lists it; undeclared it is destroyed (accepted 44);
- a **Token‑2022** account → not nameable (the helper reads only 165‑byte classic accounts); declared, BURN reverts `ReserveHasExtensions`; undeclared, destroyed (accepted 44, page names it);
- a **nested Core asset** → declared, BURN reverts `VaultStillHoldsAVault`; undeclared, destroyed but **rescued** afterwards (item 58);
- **dust** at either reserve ATA address → skipped, harmless (R41.C8c, V40‑1/V41‑1);
- a **Token‑2022 ATA for a classic reserve mint** → cannot be created (probe F4.2), so it is never more than dust.

**(f) Does it fit.** Three reserves is a hard ceiling (`MAX_RESERVE_MINTS = 3` in both SEAL and BURN, so a "fourth reserve" is not a thing that exists). The page's additions are the compute‑budget pair and the separate fee payer, which S8.0 reserves (52 + 96 bytes) and which the e2e lands at 1,152 bytes. The in‑line monthly run adds **no accounts**: the pool is already carried by BURN into `retire_redeemed`.

**(g) Evidence.** SR.0–SR.4a, SR.5–SR.14, R36.C5, R41.C8a–c, S8.0–S8.3, S9b.0–S9b.2. I looked for an arm that cannot fail and found none: every `rec` compares a computed value against a fixed `want`, every `because` pin reads the arm's own base id, and `ID.1` (uniqueness) can fail. The helper **is** deployed from the bytes `build-mainnet.sh` proves: it has no `localnet` feature, `run-tests.sh` copies the `sbpfv3` release output into `target/deploy`, and `build-mainnet.sh` `cmp`s `dist/cbob_vault_sweep.so` against both `$CACHE/ln/…` and `target/deploy/cbob_vault_sweep.so`. Round 25 N6 closed the gap where only the first was compared.

---

## R2. The pool's money — the invariant, the counters, liveness

**The invariant "the pool always holds at least `ceil(owed)`" holds under every operation, and I can show it in three lines.** Let `B` be the pool balance and `O = owed_scaled`:

- `credit(avail, w)`: `O += floor(avail·S/w)·w ≤ avail·S`, and `B` is unchanged, so `B ≥ ceil(O/S) + avail ≥ ceil(O'/S)`.
- `claim`: `O -= pay·S` and `B -= pay`, so `B' - ceil(O'/S) = B - pay - (ceil(O/S) - pay) ≥ 0`.
- `retire` (redeemed, bare, or forfeit), `join`, `reweigh`, `tick`, `advance_epoch`: `O` never rises and `B` never falls.

`ceil_sats` cannot overflow u64 for any reachable `O` (bounded by 2.1e15 sats × 1e12 ≈ 2.1e27, divided back to ≈ 2.1e15).

**Counters.** I walked every ordering of the hosts:

- `pending_this_epoch ≤ pending_count` is an invariant, and it is what keeps `waiting_to_join`'s `checked_sub` from ever erroring. `join` cannot fire while `pte == pc` (it requires `dist_epoch > request_epoch`, and `pte == pc` means every unjoined request is from the current epoch). Every host runs `monthly_inline` **before** the request it carries, so a request is always stamped with the post‑tick epoch and `pte` is incremented after the tick that zeroed it.
- `retire`'s conditional `pte -= 1` is exactly right: it fires only when `request_epoch == dist_epoch`, which is the only case in which that vault contributed to `pte`.
- `total_active_weight`, `active_count`, `boost_weight_total`, `boosts_active`, `boosts_due` and the ring agree at every site: `reweigh` moves the denominator, `unschedule_boost` moves the boost totals and the schedule, and `retire`/`expire_boost` call them in the only order that is consistent (unschedule first, reweigh second).
- The double‑naming cases are covered: the same vault twice in one `claim` pays once (`carry < ACC_SCALE` after the first pass), the same record in both the crank slice and the pair list is skipped by one and paid by the other (K.7, BO.36).

**Liveness.** Neither gate can be used to starve anyone: `JoinWaitingFirst` is cleared by `claim`/`activate` on the *waiting vault itself* (free, permissionless, and the destination only has to be the recorded `vault_ata`, which need not exist for a join), and `BoostsExpireFirst` is cleared by `expire_boosts`, which needs **only the records** — that is precisely why `expire_boosts` exists as a separate instruction.

**Round 24 W11's weaker rule is what the code implements.** `credit` is only called with the joined set, and `join` enters at the accumulator as it stands, so a vault never earns from a distribution that ran before it joined — and it *does* share revenue that arrived earlier and is still undistributed (limit 55). SPEC's weaker wording matches.

---

## R2b. The $CBOB boost

**A boost earns exactly its N distributions.** The accumulator only moves in `credit`, which is only reached from `distribute`/`monthly_inline`; a boost bought at epoch `e` with `end = e+N` is credited by the distributions that run while `dist_epoch ∈ [e, e+N−1]` (the one it rides in on counts), and `advance_epoch` to `e+N` makes it **due**, at which point `BoostsExpireFirst` refuses every later distribution until it is expired. So the last distribution it earns leaves the accumulator exactly where `reweigh(…, 0)` will carry from.

**The ring is sound and I can say why 63 is the right bound.** A boost is scheduled at `end % 64`; `advance_epoch` zeroes slot `E % 64` when the epoch reaches `E`. For a slot to be reused wrongly we would need two live boosts with ends differing by a multiple of 64 — impossible while `epochs ≤ 63`, because a boost bought at `e'` ends at `e'+N' ≤ e'+63`, and the next boost bought at `e ≥ e'+1` ends at `e+N ≤ e'+1+63 < e'+63+64`. `initialize` fixes `max_boost_epochs ≤ 63` and `set_boost_terms` cannot exceed it.

**Nothing earned is lost or gained on a weight change.** `reweigh` computes `owed_of` *before* changing the weight, stores it in `carry_scaled`, and restarts `debt_scaled = new_weight · acc`; `owed_of` adds `carry` before subtracting `debt`, so a lower weight can never need a negative debt. `expire_boost` uses the same path, so a boost that expires inside a **claim whose destination is frozen** keeps its whole *boosted* share owed (BO.37/BO.37a). A **retired** boost is unscheduled from whichever side of the due boundary it sits on (BO.16, BO.17, BO.38 — the last of which is the wrapped‑ring, not‑yet‑due branch driven on chain).

**Agreement of the counters** is asserted directly (`books()` returns `true,true,true,true,true` — denominator, boost total, `boosts_active`, `ring + due == active`, `pool ≥ owed`) and, more strongly, by the host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps`, which drives 260 epochs through the program's own free functions against a model rebuilt from the records, with coverage counters (`buys63 > 200`, `wrapped_buys > 100`, `early_wrapped63 > 3`) so it cannot pass by never reaching the branch it exists for. **That is the strongest single piece of evidence in the tree** for this subsystem, and it is the right shape: it tests the arithmetic, not a story about it.

**Nobody can make distributions impossible by boosting**, because the gate that a boost creates is cleared by a permissionless instruction that needs no token account.

---

## R3. The level draw

- **SlotHashes parse.** Key pinned to the sysvar id; `n ≤ 512`; buffer length checked against `n`; entries outside `[want, want+64]` skipped; an all-zero hash refused rather than fed into a draw. Every malformed case is a `require!` (fail closed), and the host test drives all of them.
- **Skipped slots.** `blockhash_in_window` takes the **smallest produced slot** in `[want, want+64]`, which is final the moment it appears — deterministic, not order‑dependent. A/B/C are each at least two 4‑slot groups after the previous hash's group.
- **FIFO.** `require!(index == revealed_total)` and the draw is from `level_caps − level_minted`, so order is not a choice and the quotas hold exactly (L.18–L.22, and L.23 replays every draw in mint order).
- **A burned head still takes its draw** (L.11), with the Core write skipped, so the queue never stops on it.
- **The attribute re‑supply.** `attrs_hash` is `sha256(borsh(list))` at mint; `reveal_level` re‑hashes what the caller supplies and appends `level`. The page and the crank both derive the list from the NFT, filtering `level`. The 640‑byte budget is enforced at mint (`AttributesTooLarge`), and L.12 proves a full‑budget vault is still revealable in a legacy transaction.
- **Influence.** SPEC 26's "C's leader can CHOOSE AMONG MANY DRAWS" is correct and, on the code, **not worse**: C is the smallest produced slot in a 64‑slot window, so skipping moves it within the leader's own 4‑slot group (best‑of‑4), and varying the block contents adds more. It is per‑**cohort**, not per vault, because the three hashes are shared and only the asset is mixed in. HOLDER‑GUIDE now says this truly ("the validator producing the last of those blocks can pick among several results… one choice affects every vault created in that moment at once").

---

## R4. Governance

**No minority path found.** I checked the places a minority could carry something:

- `need = ceil(snapshot · quorum_bps / 10000)` on **votes cast**, `yes·10000/cast ≥ threshold` with floor division, `yes ≥ ceil(snapshot·1000/10000)`, and for a key change `yes ≥ ceil(snapshot·5000/10000)` — all four are recomputed independently by `readProp` in the suite, and `3c.K2p` asserts the *precondition* (all the ordinary rules met, fewer than half) so `3c.K2` cannot pass for the wrong reason.
- The electorate is frozen at creation by `index_snapshot` (G.6), and `read_vault_index` pins the record by PDA, owner, discriminator, version and the asset inside it, so a lower index cannot be smuggled in (G.3).
- A burned vault cannot vote: `read_core_asset` requires a live `AssetV1`, and a burned asset is a 1‑byte tombstone.
- **Ordering** is per kind, an overtaken action is a logged no‑op, and the two orderings that matter (a round whose window already closed still moves `last_round_id`; a restart half whose stop is newer is dropped) are the ones red‑team 3 found. `3c.R1`, `E.2`, `3b.S1` cover them.
- **Freezing governance forever:** limit 45 and limit 47 already state the two permanent cases.

**One mechanism worth naming (not a defect, not documented):** the divisor is the **snapshot**, so redemptions that land *during* the vote shrink the set of vaults that can vote without lowering the bar. A key change that was reachable at creation can become unreachable. This is the accepted direction of limit 47 ("for good while fewer than half of all live vaults vote YES"), and it is recoverable — mint a new vault, propose again, and the new proposal's snapshot is the new (smaller) supply. I am recording it because the *mechanism* (burns during the vote) is not what limit 47 describes (turnout), and a reader could believe the bar is unreachable only through apathy.

---

## R5. The charter claim

- **Merkle.** `leaf = sha256(0x00 ‖ key)`, `node = sha256(0x01 ‖ min ‖ max)`, odd node promoted. I compared `scripts/pob-merkle.mjs` against `merkle_leaf`/`merkle_root_from` operation by operation: same tags, same sort, same fold order, same promotion. The suite has the **program** verify a proof the JS built, which is the only check that can fail if they drift. `pob_proof.len() ≤ 16`.
- **Window.** Fixed at `initialize`, refused by clock alone, no flag; `charter_closes_at > charter_opens_at`, ≤ 90 days, and `> now` at initialize.
- **Not gated by the guardian** (`claim_charter_vault` never reads `sales_stopped`) — asserted while the stop is set (C.13).
- **`pob_extra`.** `n_extra ≤ 8` and `≤ remaining_accounts.len()`; MINT builds every pass‑through meta as `is_signer: false` regardless of what the caller sent, and Core is what accepts or refuses.
- **SPEC 46's remaining omissions** (checking against the code, not the prose): the item already states the alarm samples the collection once a pass, that individual assets are not watched, that a hook added and removed between passes leaves no diff, and the positive bound (the key cannot transfer or burn a PoB). What is still not written down is the *ordering* consequence: because `create_proposal` needs a live vault and `mint_vault` needs a round, the window's two attacks are strictly sequential — a hook that admits only the holder's own Proofs of Burn produces an electorate in which half of all live vaults is a fixed, known set, and the 7‑day notice cannot be used to break it because `apply_guardian` needs the same half. The item says "their vaults would then be the whole electorate"; it does not say that the capture is *irreversible within the window*. Worth one sentence.

---

## R6. The one‑time configuration and the trusted hop

I recomputed every bound each `initialize` enforces and checked each ruled value against it. All consistent: `max_supply > 0`; `level_caps` five non‑zero summing ≤ supply; `charter_closes > opens`, ≤ 90 d, `> now`; `pob_root ≠ 0`; `pob_collection ≠ default`; `monthly ∈ [60, 2 592 000]`; `notice ∈ [60, 30 d]`; `sweep_floor ∈ [0.1 SOL, max_sweep]`; `cooldown_ceiling ∈ [cooldown, 7 d]`; `reserve_ceiling ≥ sol_reserve`, `≥ 890 880`, `≤ 10 SOL`; `max_sweep ∈ [1, 50] SOL`; `cooldown ∈ [1 s, 24 h]`; `sol_reserve == 0 || ≥ 890 880`; `payment_mint ∈ SEAL reserves`; `cbob_mint` classic, initialized, 82 bytes, ≠ payment mint, ≠ `$GARY`; `max_boost_weight ∈ [1,12]`, `max_boost_epochs ∈ [1,63]`; `redeem_window ∈ [10 s, 24 h]`; `quorum ∈ [500, 10000]`, `threshold ∈ (5000, 7500]`, `min_voting ∈ [60, 30 d]`. `launch/mainnet-init.json` satisfies every one of them at the ruled values.

**The royalty is Core‑immutable and nothing in our programs can reach it.** `initialize` installs `AddCollectionPluginV1` with `PLUGIN_AUTHORITY_NONE`; R.3/R.5/R.6/R.6a/R.6b/R.6c and R33.G3 measure update, remove and re‑delegate against a control collection with a keypair update authority. There is no instruction in any program that writes a collection plugin after `initialize`.

**The cap is exactly a 64‑entry rolling window.** `head` points at the next write; the k‑th most recent is `(head + 64 − k) % 64`; the check is `now − kth ≥ window`; then `ring[head] = now; head = (head+1) % 64`. With `k = min(max(cap,1), 64)` this admits at most `k` redemptions in **any** window of that length, and the initial all‑zero ring admits the first `k`. RL.1a–RL.7 and S10.0–S10.3 exercise it at a short window, and RL.7 replays every remembered redemption against the exact cap certified for its snapshot interval.

**`sweep_sol_for_swap`'s worst case** is `max_sweep_lamports` per `sweep_cooldown_secs`, never more than the revenue PDA holds above `sol_reserve_lamports`, operator‑signed, guardian‑stoppable, and only lamports move — the operator can never touch cbBTC, the pool, or a vault. That is the honest bound and SPEC states it as `cap × windows`.

**One gap the documents do not name (INFO, and the code cannot close it):** `arm_swap_operator` refuses only the default key. An off‑curve key can be armed by a vote (half of all live vaults + 7 days' notice), and `sweep_sol_for_swap` requires the operator to **sign**, which an off‑curve key can never do — so the one trusted hop is dead until a further supermajority vote arms a working key. Nothing is lost (royalty SOL accumulates in the revenue PDA and `royalties_unswept` pages), the guardian can cancel inside the notice, and the launch checker's on‑curve test has no on‑chain counterpart because `Pubkey::is_on_curve` panics on BPF (proven impossibility 5). So the fix is a sentence in limit 10, not code: *a vote that arms an unreachable operator key stops the sweep as effectively as the guardian's stop, and needs the same supermajority to undo.*

---

## R7. Cross‑program raw reads — recomputed from the structs

I derived every offset field by field and got the same numbers the programs and the suite use. `MintConfig` (disc 8): version 8, collection 9, governance **41**, pool_ata **73**, round_id 105, opens 109, closes 117, price **125**, cap 133, minted_this_round 137, minted_total **141**, max_supply 149, bank_treasury **157**, split_bps **189**, sales_stopped **191**, sweep_stopped **192**, guardian **193**, swap_operator **225**, sol_reserve **257**, bump **265**, max_sweep **266**, cooldown **274**, last_sweep 282, level_caps **290**, level_minted **310**, revealed_total **330**, payment_mint 338, pob_collection 370, pob_root 402, charter_opens 434, charter_closes **442**, charter_claimed **450**, bare_burns_retired **454**, total_active_weight **462**, active_count **470**, acc_scaled **478**, owed_scaled **494**, last_distribute_at **510**, sales_stopped_at **518**, sweep_stopped_at **526**, pending_swap_operator **534**, pending_swap_operator_at **566**, monthly_secs **574**, pending_guardian **582**, pending_guardian_set **614**, pending_guardian_at **615**, notice_secs **623**, sweep_floor **631**, cooldown_ceiling **639**, reserve_ceiling **647**, dist_epoch **655**, pending_count **663**, pending_this_epoch **671**, cbob_mint **679**, max_boost_weight **711**, max_boost_epochs **712**, boost_price **714**, boost_weight **722**, boost_epochs **723**, boosts_active **725**, boosts_due **729**, boost_weight_total **733**, cbob_burned_total **741**, boost_expiring **749**. Space = **1 261** including the 8‑byte discriminator and 256 of padding (the round‑41 verdict's "1 261, not 1161" is right).

`VaultRecord` (disc 8): version 8, asset 9, mint_index **41**, reveal_slot **49**, level **57**, charter **58**, entropy_set **59**, entropy **60**, attrs_hash 92, bump 124, active **125**, retired **126**, reschedules **127**, vault_ata **129**, debt_scaled **161**, pending **177**, request_epoch **178**, boost_weight **186**, boost_end_epoch **187**, carry_scaled **195**. Space = **221** exactly.

`BurnConfig` (disc 8): version 8, collection 9, bump 41, burned_total **42**, redeem_window **50**, rate_head **58**, rate_ring **59** (512 bytes). Space 827. `SealConfig`: version 8, collection **9**, reserves **41**, bump 45. `GovConfig`: version 8, collection 9, quorum 41, threshold 43, min_voting 45, proposal_count **53**, bump 61, last_round/guardian/arm/boost 62/70/78/86. `Proposal` = 259 max, and the 37‑byte `ACTION_MAX_BYTES` bound is exact for `Brakes`. `SweepTighten` is field‑for‑field identical in both programs and the suite executes one end to end (8.14). The sweep helper's classic account reads are mint 0, owner 32, amount 64, length 165.

**No misread found.** Every offset either side reads is the offset the struct puts the field at.

---

## R8. The suite, the simulation and the build as evidence

- **Arms that cannot fail:** I read all 899 and found none whose `want`/`got` are structurally equal. The two I was most suspicious of are sound: `ID.1` compares against a duplicate list it computes, and `RL.1a`/`SR.12b` compare against values that can move.
- **Wrong‑reason refusals:** the `because` list is thorough, and the pins that matter name the *program* that refused (`CoREENx… failed`, `Tokenkeg… failed`, `EB2uVv… failed`, `11111111… failed`). `attP` exists precisely so a bare `ProgramError` can still be attributed. The two places a pin is a bare code (`3c.F1`, `R28.F1` → `0x11`) are unambiguous within their unique arm ids.
- **Mainnet bytes vs tested bytes:** the four keyed programs' shipped binaries are **not** byte‑identical to the tested ones — only the `INIT_AUTHORITY` constant differs — and the tree says so plainly in `build-mainnet.sh`'s banner and SPEC. The proof is behavioural (each mainnet artifact REJECTS the test key for `NotTheInitAuthority`, each localnet artifact ACCEPTS it) plus source plus reproducibility. That is the honest bound, and it is the reason the dress rehearsal exists.
- **FINDING 1 (LOW) — the swap‑fork gate is the only certification gate in the runner with no assertion floor.**

  *Exact construct:* `scripts/run-tests.sh`, the `[+] === THE SWAP, ON A MAINNET FORK ===` block. The fork's output is consumed as
  ```bash
  CBOB_FORK_FROM_RUNNER=1 bash "$ROOT/sim/swap-fork.sh" 2>&1 | grep -vE "…" | tail -16
  [ "${PIPESTATUS[0]}" -eq 0 ] || die "the swap fork failed"
  ```
  — no `floor` call, and `tail -16` discards the count line before anything could read it. Every sibling gate in the same file (`detector`, `allocation`, `poster`, `pob‑merkle`, `launch-params`, `host unit tests`, `expiry-budget`, the on-chain suite) reads its count and requires it to **equal** the floor.

  *What it gains:* deleting assertions from the swap‑fork test until only the easy ones remain keeps the build green, provided the script still exits 0. That suite is the **only** gate for the Orca/Meteora swap against real pool state and the Pyth floor — i.e. for the one trusted hop and for limit 10's on‑chain output floor.

  *Evidence that would exist if I am right:* `grep -c 'floor' scripts/run-tests.sh` finds a `floor` for every other suite and none in the fork block; SPEC's "Running the tests" names `floor SWAP_FLOOR` for the same command, so one of the two is wrong. **Caveat, stated:** `sim/swap-fork.sh` is not in this bundle, so I cannot exclude that it checks its own count internally and exits non‑zero — in which case the defect is only that the runner discards the count and SPEC's "floor SWAP_FLOOR" names a constant that does not exist in the runner.

  *Fix:* read the count out of the script's own output before `tail`, and `floor "swap-fork" "$SWAP_OUT" '[0-9]+/[0-9]+ swap-fork assertions as predicted' 16`.

- **Claims in the prompt no arm exercises** (coverage recommendations, not defects): a helper destination named twice; a native wSOL source; another vault's asset‑signer as destination; `distribute` from a **frozen** pool (SPEC says it is not refused and only makes vaults owed again — nothing measures that); `rescue_nested` on a vault whose `FreezeDelegate` its owner set to frozen. Each is a one‑line addition to an existing section.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?**
I did not find one. The two candidates that look worse on first read are both correctly bounded:
- **Limit 28** says a frozen vault account "also blocks that vault's WHOLE redemption… a frozen account cannot be emptied". For an **activated** vault the mechanism is actually `ClaimBeforeBurn` (the claim defers, leaving ≥ 1 sat owed), not emptiness — but an activated vault's cbBTC account can never be empty (activation requires 21,000 sats and the seal prevents any outflow), so both statements describe the same reachable set and the outcome is identical. Not worse.
- **Limit 41** says transfers are unlimited. The cap also rises with live supply, so a funded attacker can mint toward 2,100 to widen it — but that is exactly the ruled 2.1%‑of‑live design, it is bounded by `max_supply` and the round price, and it buys no access to *other people's* vaults.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**
Two, both in the "stated more restrictively than reality" direction:
- **Limit 44's** parenthetical, "a frozen stray account holding a balance (its transfer reverts the redemption)". The redeem page **never names** a stray it cannot deliver (its mint has a freeze authority, its receiving account is frozen, its mint is unreadable), so the transfer is never attempted and the redemption is **not** blocked by one. Round 36 H1 is the control that closed this; the limit still reads as though the redemption reverts.
- **Limit 43's** "a marketplace escrow can look the same and is recoverable". `rescue_nested` refuses a host that is not the vault itself, a burned asset or a live CBOB vault (`HostUnresolved`), so a vault owned by an escrow that is *not* some vault's deposit address has no on‑chain recovery at all — the only path is the escrow returning it. The word "recoverable" is doing work the code does not.

**3. Is any DISCHARGED item not actually discharged?**
I verified the ones that are checkable from this bundle and found all of them genuinely closed: **14** (`DuplicateAttribute` in `check_attributes`), **19** (there is no state in which a vault is active but unlevelled — `activate` requires `1..=5` and `join` indexes `LEVEL_WEIGHTS[level-1]`), **30** (no instruction writes `split_bps`, either destination, or `max_supply`; the only vote‑carried struct is `SweepTighten`, which has no field for any of them), **31** and **33** (the period and the notice are `initialize` values, exercised at short values), **51** (the boost is built, in MINT and GOV, with the carry and the gate), **54** (measured, with the extrapolation labelled as such). **12/17** is a measurement with its own scope stated ("this is not a v1 packet or resource‑budget measurement").

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**
No — all five are still named open, and the two that could have drifted are explicitly re‑opened in the round‑41 VALIDATION (item 53's proof is of `d57ee3a` and must be re‑run at the release commit; the live crontab is still the v5 one, so re‑run `scripts/cron-install.sh` before go‑live). The one thing I would tighten: **item 50's** status sentence says the pages are "BUILT AND STAGED", and the e2e passes 129/129 — that is a lot of green for a component that is still the only pre‑signature control for items 9 and 44. It is not being treated as accepted, but the distance between "staged and green" and "published" is now the whole of the preventive control for two accepted limits, and nothing in the tree enforces that it closes before road step 11.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The AI process has proven, repeatedly and honestly, what it can prove: the programs' arithmetic, the pairing, the emptiness proof, the offsets, the Core semantics — all of that is measured, and the measurement is why the wrong CRITICALs died. What it structurally **cannot** do is anything that requires a second machine, a second person, or a real key. Before the upgrade authority is removed, do these, in this order, and record each with its signatures:

1. **Reproduce the artifacts from the commit on a different machine.** The shipped binaries differ from the tested ones by one constant. Nothing in this repository can prove the shipped bytes are the audited source; a rebuild at `4a67d00` on a box that has never seen this one, hashing to `dist/SHA256SUMS`, can.
2. **Prove the compiled `INIT_AUTHORITY` is Gary's key, with Gary's key.** Have him sign one message; compare the recovered pubkey to `Hc6WGt2k…`. The behavioural probe proves only that the constant is *not the test key*; a third, wrong key answers identically.
3. **The dress rehearsal (item 22), exactly as scoped** — the crank's live passes at ~2,100 vaults, the alarm in `CBOB_ALARM_REHEARSAL=1`, **one full revenue cycle through each pool including a forced Orca refusal so Meteora really runs**, and **one forced post‑sweep failure walked through the hand recovery** with `--audit` clean at the end. These are the only paths in the tree with no gate at all.
4. **One real redemption, by a human, on a fork, through the real page**, of a vault holding all three reserves plus a C5 account plus a nested vault plus 300 parked strays. The e2e does this with keypairs standing in for Phantom; only a real wallet on a real device