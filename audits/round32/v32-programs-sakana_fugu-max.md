# ROUND 32 — INDEPENDENT AUDIT OF THE v6 TREE

**Method and limits, stated first.** I read the five programs and every bundled file whole. I recomputed every cross-program raw offset and every account space from the Rust structs (results below). I traced every money path, every counter, every gate and every refusal. I found **no theft, no unseal, no pool-invariant break, no governance bypass, and no arithmetic or offset error in the five programs.** I am not filing a CRITICAL, because I could not construct one and the prompt is explicit that an unmeasured CRITICAL is worse than silence.

I also could not audit several of the targets I was asked to audit, because **they are not in the bundle**. That is the single largest limitation on this pass and it is reported below as a process finding, not as a code defect.

---

## R0. Round 31's verdict and its repairs — independently checked

Round 31 is bundled as **NOT CLEAN, QUORUM MET, 1 LOW (in `scripts/audit-coverage.sh`), 2 INFO**, counter 0/2. I re-derived its load-bearing measurements rather than accepting them:

* **W1 (reveal heap)** — I re-read `reveal_level` and `write_record`: the reveal's Core `UpdatePluginV1` re-sends the whole attribute list, `MAX_ATTR_BYTES = 640` bounds what `write_record` stores, and `L.12` measures a reveal at exactly the budget. The round's conclusion (no reachable owner shape blocks the FIFO) is consistent with the code I can see; the autograph ceiling (10,198 bytes = Core data of 10,240 = the runtime CPI data cap) is a Core fact I cannot re-measure here.
* **W2 (address squat)** — I re-read every `init` site (`config` PDAs, `vault_record`) and every ATA derivation. Nothing in the programs or the suite depends on a PDA being unfunded. The repair stands.
* **L1 (coverage gate)** — I read the repaired `first_line_quorate` and ran its eight cases by hand against `re.fullmatch(rf'# Round {num}, {label} pass: (?:NOT )?CLEAN; QUORUM MET\s*', line)`. All eight agree with the table. **But see finding P3 below: the rule now exists in two places.**
* **D1/D2 (prompt label, probe usage line)** — cosmetic; the bundled prompt indeed names the correct prior verdict.

No round-31 finding was re-filed. I found no surviving defect from it in the programs.

---

## R1. Custody — can anyone but the owner get value out of a sealed vault?

**No.** I could not break the pairing, the emptiness proof, or the "a thawed vault must end burned" rule.

* **Pairing.** `SEAL::open_for_redemption` walks only top-level instructions (`load_instruction_at_checked`) and binds `accounts[0] == asset` **and** `accounts[2] == owner`. `BURN::burn_vault` walks only `0..current` and binds the same two positions. `MINT::retire_redeemed` requires `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` **and** re-reads the instruction sysvar at the current index. Every combination I traced fails closed: a wrapped burn is invisible to SEAL; a wrapped open is invisible to BURN; a wrapped `retire_redeemed` reports the wrapper's index and is refused `NotFromBurn`; a CPI from a third program gives stack height 3 and is refused. `open A / burn B`, `open A / burn A / open A`, and two interleaved pairs all resolve correctly or revert.
* **Emptiness.** `burn_vault` requires `asset_signer.lamports() == 0`, requires all six expected reserve ATAs (3 mints × 2 token programs) to be **declared**, and for each declared account that a token program owns: `owner == pda`, delegate tag `[72..76] == 0`, `delegated_amount [121..129] == 0`, close-authority tag `[129..133] == 0`, `len == 165`, `amount == 0`. Every offset is right (SPL Token account: mint 0, owner 32, amount 64, delegate COption 72, state 108, is_native 109, delegated_amount 121, close_authority 129 — the COption tag is 4 bytes, which the round-5b probe measured and which the `[0,0,0,0]` comparison depends on). A Core-owned declared account that is a live `AssetV1` is refused. Non-token-program-owned declared accounts are skipped.
* **What I checked and cleared that looks like a hole and is not:** a stranger **cannot** put a Core asset at a forced-declared reserve address, because those addresses are PDAs of the ATA program and Core's `CreateV2` requires the asset to **sign** — a PDA no one but the ATA program can sign for, and the ATA program only ever writes token accounts there. A stranger **can** dust such an address with rent-exempt lamports, but a system-owned account is skipped by both of BURN's loops, so it neither blocks nor is destroyed.
* **The sweep helper.** Direct call needs `signer.is_signer`, which only Core's `ExecuteV1` can grant; Core grants it only for the asset's owner on a **thawed** vault, and a vault is only thawed inside a transaction that also carries its terminal burn. So (a) is sound: an update authority, a delegate, a plugin authority or a collection authority cannot drive it (SR.5/SR.5a/SR.5c measure two of those; SR.5b pins the collection authority to MINT's off-curve PDA). (c) is safe for the same reason: the destination wallet is chosen by the only party who can sign. (b)'s oddities are handled: an odd list → `NotEnoughAccountKeys`; zero pairs → a lamports-only sweep (SR.13); a duplicate source → the second `read_token` sees a closed, re-assigned, zero-length account and refuses `IllegalOwner`; `dest == signer` → `InvalidArgument`; a delegate or close authority on a source is removed with the account by the helper's `CloseAccount`, which is why arm 3.3a lands where 3.3 refuses. (d) holds: `SR.4a` measures the exact lamport delta including gifts, released rent and the fee, and the helper's own log names the balance it moved.
* **(e)** is answered above and by the "the page creates missing reserve ATAs first" rule; a non-ATA classic account is nameable by the helper (it checks owner, mint, length only), and a Token-2022 account for a classic mint cannot be created (probe F4.2).
* **(f) — see finding P1.** A fourth reserve is **impossible** (SEAL and BURN both cap `MAX_RESERVE_MINTS` at 3, and 9.14/9.15 pin the measurement), so that part of the prompt's hypothesis is wrong.
* **(g)** — the helper's tested bytes are the shipped bytes: `run-tests.sh` copies `target/sbpfv3-solana-solana/release/*.so` into `target/deploy/` and deploys those; `build-mainnet.sh` `cmp`s `dist/cbob_vault_sweep.so` against both `$CACHE/ln/...` and `target/deploy/cbob_vault_sweep.so`. Nothing else in the suite is deployed from a different path. **SR.0–SR.14 and S8.*** all read as able to fail; I found no arm that cannot fail and none refused for a reason other than the one pinned (I re-derived the `SR.12a` "Provided owner is not allowed" pin: it comes from `read_token`'s `*a.owner != SPL_TOKEN_ID`, because SPL `CloseAccount` re-assigns the account to the system program and reallocs it to zero — which is also why `SR.12b`'s "not the first source-owner guard" holds).

## R1s. The sweep helper — specific answers

* **(b) destination wallet is another vault's asset-signer:** allowed, and correctly so — it is a transfer *into* another vault chosen by the signing owner. Nothing is stolen; the helper refuses only `dest == signer`.
* **(c) a destination below rent exemption / a non-system account:** a System transfer to a non-existent destination that leaves it under rent exemption is refused by the runtime and reverts the redemption; R27.S1 measures that a non-System-owned destination (a token account) is credited fine. This matches SPEC item 50's "a lamports-only sweep needs a destination that exists".
* **(d)** nothing can leave the asset-signer non-zero after the helper inside the same transaction except an instruction the *page itself* added, and that only makes BURN refuse. Measured (SR.4a).

## R2. The community pool's money — "the pool always holds at least ceil(owed)"

**I could not break it, and the invariant is exact by construction.** `credit` adds `delta = floor(avail·1e12/w)` to `acc_scaled` and `delta·w` to `owed_scaled`; every active record's `owed_of` rises by exactly `weight_i·delta`; so `owed_scaled` is *exactly* `Σ owed_of`. `distribute` refuses unless `balance − ceil(owed_scaled) > 0` and credits only that difference, so `balance ≥ ceil(owed_scaled)` after. `claim` removes `pay·1e12` from `owed_scaled` while paying `pay` out of the balance. `join` enters at `debt = w·acc` (owed 0). `reweigh` moves the owed share into `carry` and resets `debt`, preserving `owed_of`. `retire` subtracts exactly `owed_of` from `owed_scaled` and zeroes the record's contribution.

Counters: `pending_count`/`pending_this_epoch` are consistent under every ordering I traced (a joiner can never be in `pending_this_epoch`, because `join` requires `dist_epoch > request_epoch`); `advance_epoch` resets `pending_this_epoch`; `retire` decrements `pending_this_epoch` only when `request_epoch == dist_epoch`; `active_count`/`total_active_weight` move only in `join`, `retire` and `reweigh`, and each is guarded by a `checked_sub`. I found no ordering that underflows.

**Liveness:** the three gates that can stop distributions (`JoinWaitingFirst`, `BoostsExpireFirst`, `MonthNotElapsed`) are each clearable by a permissionless instruction that needs only accounts that always exist — `claim`/`activate` for joins, `expire_boosts` for boosts (which never touches the pool, so it works even with a frozen pool). I could not construct a state in which a distribution is permanently impossible. Redemptions are likewise gated only by the rolling window and by a frozen reserve account, both disclosed.

`retire_redeemed` is reachable only from BURN (stack height + sysvar), requires `is_burned`, refuses `ClaimBeforeBurn` unless the pool is frozen, and its `monthly_inline` runs *after* the retire, so the leaving vault is never credited.

## R2b. The $CBOB boost — "exactly N distributions, nothing lost or gained"

**Verified by construction, and the ring bound is exactly right.** `BOOST_RING = 64`, `max_boost_epochs ≤ 63`, `end = dist_epoch + epochs`, slot `end % 64`. A live boost has `end ∈ (dist_epoch, dist_epoch+63]` — 63 distinct values in 64 slots — so two live ends can never share a slot, and the next drain of slot `E%64` after purchase is exactly `dist_epoch = E`. `advance_epoch` moves the slot into `boosts_due`; `unschedule_boost` takes the `dist_epoch >= end` branch when due and the ring branch otherwise, matching wherever the count currently lives. A boost earns distributions at `dist_epoch ∈ [e, e+N)`: exactly N. The gate (`boosts_due == 0`) is checked in `distribute` *before* any $GARY burn and in `monthly_inline` before any credit, so the accumulator is exactly where the boost's last distribution left it when it expires — which is what makes `expire_boost`'s `reweigh` exact. `reweigh` preserves `owed_of` identically; `claim`'s normalisation preserves it; `retire` unschedules the boost from wherever it is and subtracts the record's full weight. The host unit test drives the program's own functions over 260 epochs (four wraps) against a model rebuilt from the records alone, with coverage floors on wrapped and same-epoch-63 purchases and early wrapped retires.

`boost_vault`'s owner check reads Core's `AssetV1` owner bytes *after* `require_live_vault` has already guaranteed the length, so no slice panic. One boost per vault, `BoostsOff` when price is 0, and `BoostTermsMoved` refuses only moves against the buyer (the ruled one-sided rule).

## R3. The level draw

The draw matches the documentation exactly: `A` = smallest produced slot in `[reveal_slot, reveal_slot+64]`, `B` and `C` each the smallest produced slot in the next two-4-slot-group-aligned window; `r = sha256(hA‖hB‖hC‖asset)`; `u64le(r[0..8]) % remaining` walked over I..V. `blockhash_in_window` pins the sysvar id, bounds the declared count at 512, bounds the buffer, refuses an all-zero hash, and takes the smallest qualifying slot — deterministic. FIFO is enforced (`index == revealed_total`), a burned vault at the head still takes its draw, a lapsed window is `NeedsReschedule` and `reschedule_reveal`/`crank` move it to `now + 16` (a slot that does not exist yet). The attribute re-supply is hash-checked against what `write_record` stored, and the byte budget (640) is bounded at mint so a reveal can always re-send it.

**SPEC 26 is not worse than stated.** Only the *last* contributor can select: A's leader does not know hB/hC and B's does not know hC, so neither can evaluate a draw; C's leader knows hA and hB, and skipping within its own 4-slot group is best-of-4 while varying its block is unbounded — "CHOOSE AMONG MANY DRAWS" is the correct description, and HOLDER-GUIDE says it truly ("the validator producing the last of those blocks can pick among several results, by skipping a block or changing what goes into it ... one choice affects every vault created in that moment at once").

## R4. Governance

I could not make a minority carry anything it should not. Quorum is `ceil(snapshot·quorum_bps/1e4)` against the snapshot; threshold is YES/cast; turnout is YES ≥ `ceil(snapshot·1000/1e4)`; a key change is YES ≥ `ceil(snapshot·5000/1e4)`. At the ruled numbers (21%/51%/10%) the binding constraint is 21% of the snapshot for an ordinary proposal and 50% for a key change — both are the ruled business facts, not code defects. `VoteRecord` at `["vote", proposal, asset]` stops double voting across transfers; `VaultTooNew` against `index_snapshot` stops a mid-vote mint; `read_vault_index` pins the PDA derivation, the owner, the discriminator, the version **and** the asset inside the record, so a foreign record cannot be smuggled in. Every action is re-checked at creation against what MINT will accept (I compared each `create_proposal` bound to MINT's own bound and they agree), so a ratified bundle cannot be reverted by MINT for a value GOV should have refused. Ordering is per kind, the mark moves before the "round already over" skip (round 3c.R1), and an overtaken action is a logged no-op.

Freezing governance forever: only the two documented routes (no live vault; a stolen guardian at low turnout). Both are in the accepted list with the right scope.

## R5. The charter claim

`claim_charter_vault` is outside the sales stop, refuses by clock alone outside the window, verifies the PoB by address (owner bytes, collection discriminant + key, Merkle leaf with domain-separated sorted-pair hashing), burns it by CPI **as its owner** in the same instruction, and passes `pob_extra` accounts through never as signers. A caller cannot write `charter`, `level` or `redemption`; duplicates are refused; the census is checked before the burn so a full census does not cost a PoB. **See finding P2 for the one thing SPEC 46 asserts about this path that nothing measures.**

## R6. The one-time configuration and the trusted hop

Every `initialize` I can see is gated on a compile-time `INIT_AUTHORITY`, runs once (`init`), and is the only writer of its config's permanent fields. I verified that **no instruction other than `initialize` writes** `collection`, `governance`, `pool_ata`, `split_bps`, `max_supply`, `bank_treasury`, `payment_mint`, `pob_collection`, `pob_root`, `charter_opens_at`, `charter_closes_at`, `level_caps`, `notice_secs`, `sweep_floor_lamports`, `cooldown_ceiling_secs`, `reserve_ceiling_lamports`, `cbob_mint`, `max_boost_weight`, `max_boost_epochs`, `monthly_secs`. The only vote-reachable struct is `SweepTighten`, which has three numeric fields and no destination, ratio or supply (P.0e/P.0f).

`launch/mainnet-init.json` is internally consistent with every bound each `initialize` enforces (I checked all 20 MINT arguments, the 2 BURN arguments, the 4 GOV arguments and the SEAL reserve list against the program checks; `monthly_secs` sits exactly on its inclusive ceiling, `charter_secs` 7 days ≤ 90 days, the three tighten bounds satisfy `floor ≤ cap`, `ceiling ≥ cooldown`, `reserve_ceiling ≥ reserve ≥ rent exemption`).

The 10% royalty: `initialize` installs `PLUGIN_AUTHORITY_NONE`, and no instruction in any program writes a Royalties plugin afterwards. R.5/R.6/R.6a/R.6c prove Core's own behaviour in both directions on a control collection.

**The redemption cap is exactly a rolling window:** a ring of 64 `i64` timestamps, head `rate_head`, `k = min(max(1, ceil(live·210/1e4)), 64)`, and a redemption lands iff the k-th most recent is a full `redeem_window_secs` old. `RL.7` replays the ring against the cap certified for each ordinal. Live supply is `minted − burned − bare_retired`, all three read from the pinned MINT config, and cannot underflow (a vault is redeemed *or* bare-burned, never both, and `retire` requires `!retired`).

## R7. Cross-program raw reads — recomputed, all correct

From the struct definitions (data offsets include the 8-byte Anchor discriminator):

* **MintConfig** (space **1261** = 8 disc + 997 fields + 256 padding; the round-31 "1253" was wrong, the round's "1261" is right): governance 41, pool_ata 73, round_id 105, minted_total 141, max_supply 149, bank_treasury 157, split_bps 189, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, bump 265, max_sweep 266, sweep_cooldown 274, last_sweep_at 282, level_caps 290, level_minted 310, revealed_total 330, payment_mint 338, pob_collection 370, pob_root 402, charter_opens_at 434, **charter_closes_at 442**, charter_claimed 450, **bare_burns_retired 454**, total_active_weight 462, active_count 470, acc_scaled 478, owed_scaled 494, last_distribute_at 510, sales_stopped_at 518, sweep_stopped_at 526, pending_swap_operator 534, pending_swap_operator_at 566, monthly_secs 574, pending_guardian 582, pending_guardian_set 614, pending_guardian_at 615, notice_secs 623, **sweep_floor 631**, **cooldown_ceiling 639**, **reserve_ceiling 647**, dist_epoch 655, pending_count 663, pending_this_epoch 671, cbob_mint 679, **max_boost_weight 711**, **max_boost_epochs 712**, boost_price 714, boost_weight 722, boost_epochs 723, boosts_active 725, boosts_due 729, boost_weight_total 733, cbob_burned_total 741, boost_expiring 749.
* **VaultRecord** 221 bytes: version 8, asset 9, mint_index 41, reveal_slot 49, level 57, charter 58, entropy_set 59, entropy 60, attrs_hash 92, bump 124, active 125, retired 126, reschedules 127, vault_ata 129, debt_scaled 161, pending 177, request_epoch 178, boost_weight 186, boost_end_epoch 187, carry_scaled 195.
* **BurnConfig** 827 bytes: burned_total 42, redeem_window 50, rate_head 58, rate_ring 59.
* **GovConfig** 350 bytes: collection 9, quorum_bps 41, threshold_bps 43, min_voting_secs 45, proposal_count 53, bump 61, last_round_id 62, last_guardian_id 70, last_arm_id 78, last_boost_id 86.
* **SEAL Config** 398 bytes: collection 9, reserve `Vec` length 41, keys from 45.

Every constant in GOV, BURN and MINT that reads a sibling (`OFF_MINT_*`, `OFF_BURN_*`, `OFF_REC_*`, `SEAL_CONFIG_DISC`, `SEAL_CONFIG_VERSION`, `MINT_CONFIG_DISC/VERSION`, `VAULT_RECORD_DISC/VERSION`, `BURN_CONFIG_DISC/VERSION`, all 12 instruction discriminators) matches what I derived. **`bank/layout.mjs` — which the SPEC says asserts the same thing off chain — is not in this bundle** (see P3).

## R8. The suite, the simulation and the build

I read `tests/3prog.test.ts` (855 assertions, floor EQUAL), `sim/test-vault.ts` + `sim/run-sim.sh` (71, floor EQUAL), `tests/expiry-budget.mjs` (4, floor EQUAL), `tests/initauth.test.ts`, `scripts/build-mainnet.sh` and `scripts/run-tests.sh` whole.

* The MINT `initialize` argument list in `tests/initauth.test.ts` matches the 20 arguments in order, and the account list matches the struct. The `REACHED_PAST` reasons are all reachable after the authority check, and `InstructionDidNotDeserialize` is correctly excluded.
* The `because()` pins are consistent with the code paths they name (I re-derived the ones I could: `NoTerminalBurn`, `NoPrecedingOpen`, `NotFromBurn`, `RateLimited`, `JoinWaitingFirst`, `BoostsExpireFirst`, `BoostTermsMoved`, `VaultStillHoldsAVault`, `ReserveNotDeclared`, `ReserveDelegated`, `0x1a`, `0x9`, `0x11`, `0xb`, the system `0x0`).
* The `books()` ledger helper is a genuine both-ways check: it recomputes the denominator, the boost totals, the ring+due identity, `pool ≥ ceil(owed)` and `owed == Σ owed_of` from every record, and `BK.*` arms assert the exact set of labels, so a deleted or failing check shows as a missing label.
* `ID.1` enforces unique assertion ids (excluding the derived `X!` pins).
* `build-mainnet.sh` proves the four keyed artifacts reject the localnet key and the localnet artifacts accept it, proves the sweep helper's mainnet bytes equal the localnet bytes **and** `target/deploy`, refuses a dirty tree, and states its own residual limit ("NOT PROVEN that the compiled constant IS that key") in the banner. The four keyed programs' tested and shipped bytes differ by design — a stated boundary, not a new finding.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?**

* **Item 44 / item 50's stray-token rescue** is worse than stated — see **P1**.
* **Item 46's "positive bound"** is stated as a protection that nothing measures — see **P2**. If it is false, the limit is worse than stated in a way that matters (the hot key could *take* Proofs of Burn rather than merely gate them).
* Everything else I could reach is **as stated or better**: the frozen-pool forfeit lands (3c.F0–F3); the rolling window is a true window and the ring bound is exact (RL.2/RL.3/RL.4/RL.7); `transfers are not limited` is true; the three Core-upgrade consequences in item 40 are all real in the code (the `NotBurned` tombstone check, `revealed_total` behind `UpdatePluginV1`, and the helper's whole access control being Core's `ExecuteV1` rule); the draw residuals (25/26) match the code exactly; item 27's dead-weight join is real (`claim` does not check liveness); item 32's "live supply can read one higher" is real; item 39/41/45/47/49/55/56 all read correctly against the code.

**2. Is anything listed as a limit not actually a limit, or closed by something the author did not notice?**

* **Item 9's "nothing refuses the redemption"** is **narrower than the code**: `burn_vault`'s second loop refuses *any* declared live `AssetV1`, whether or not the vault's PDA owns it. For the six forced-declared reserve addresses this is unreachable (they are ATA-program PDAs, and Core's `CreateV2` needs a signature), so it is not a hole — but the refusal is by **declaration**, not by ownership, and the SPEC's phrasing ("a FOREIGN Core asset **nested in a vault**") under-describes it. Worth one sentence, not a finding.
* **Item 44's classic-token branch is genuinely closed for balance-bearing strays** *if* the pair fits — which is exactly P1.
* No DISCHARGED item that I could reach is still open. I re-verified 14, 15, 19, 30, 31, 33, 12/17, 51, 54 and the whole v5 family (1a–24) against the code: no Bank key, no deck, no distributor wallet, no `update_config`/`update_wiring`/`set_paused`/`set_collection_royalties`/`handover_governance`/`update_gov_config` anywhere, and the suite's 0.4 arms pin their absence to `InstructionFallbackNotFound` rather than to a constraint error.

**3. Is any DISCHARGED item not actually discharged?**

None that I can reach. Item 51 (the boost) is discharged with its one residue disclosed; item 54's holder-page requirement is correctly still owned by item 50.

**4. Is any item in OPEN AND BLOCKING quietly treated as accepted?**

No. **22** (nothing has run a distribution against a live chain) is still open and the round-31 validation says so explicitly ("Live launch dates, holder surfaces, the Phantom ceremony, the both-venue revenue cycle and forced post-sweep recovery remain open launch obligations"). **38** is open (`charter_opens_at` and `lock_deadline` are `null`/OPEN in `launch/mainnet-init.json`, which the checker refuses). **50** is open (the guide is DRAFT). **53** is open and correctly described as stale: the round-31 work refreshed the rehearsal *tree* and re-proved the reverse map at `4ae79d6`, but explicitly did **not** build, deploy or run `run-tests.sh` at the throwaway ids — so the "FULL `run-tests.sh` passes inside the rehearsal tree" proof is still that of `d57ee3a`.

---

## FINDINGS

### P1 — MEDIUM. The redeem page's promised stray-token rescue cannot fit the page's required shape, and nothing measures it.

**Construct.** `programs/cbob-vault-sweep/src/lib.rs` (the pair checks) + `SPEC.md` item 44's "can be a SWEEP LIST rather than only a warning" and item 50's "**Offer to rescue stray CLASSIC tokens**" + `SPEC.md` item 42's "the fully padded legacy shape, including compute-budget instructions and a separate fee payer" + `sim/test-vault.ts` S8.0.

**What is gained/lost.** A holder whose vault has received an airdropped *classic* token — the one case where the helper is the documented remedy — cannot use the page's required shape to rescue it. The stray is destroyed by the burn, which is item 44's accepted default, so no value leaves the system that the accepted limits do not already cover; the loss is that a promised mitigation is inert.

**Evidence that would exist if I am right.** S8.0 measures `claim + open + helper(three reserves) + burn` at **1,061 bytes**; the page's shape adds 148 (52 for the compute-budget pair, 96 for a separate fee payer) = **1,209 of 1,232**, i.e. **23 bytes of headroom** (SPEC states this itself). One rescue pair costs at least **64 bytes** of new account keys (two accounts that are otherwise not in the transaction) plus at least two index bytes in Core's `ExecuteV1` data, i.e. **≥ 66**. So a padded redemption carrying one stray pair serializes to **≥ 1,275 > 1,232**. The checkable prediction: build `sizeFor`-style transactions with three reserves **plus one extra same-mint pair** and both paddings; they should fail to serialize. **No arm does this today** — round 31's own A5 lists "a non-ATA stray classic account through the helper" as an evidence gap, and S8.0's note says only that it "is the measured shape, not an upper bound for arbitrary extra token pairs".

**Disclosure check.** The SPEC half-warns ("mind the packet above, since each pair costs bytes"; "not an upper bound for arbitrary extra token pairs"). It never gives the number, and 23 < 66 makes the rescue impossible in that shape, not merely tight.

**Fix.** (a) Measure the padded shape with one stray pair and record the number. (b) Then either state in SPEC 44/50 and the holder guide that a stray classic token can only be rescued in the **narrow owner-payer shape without compute-budget instructions** (which S8's arithmetic puts at ~1,128 with one pair — it fits), or have the page drop the separate fee payer whenever it carries a rescue pair (freeing 96 bytes, still leaving 1,180 + 66 = 1,246 — so dropping the payer alone is *not* enough; the compute-budget pair must also go, or the rescue must be a separate design). (c) Whichever is chosen, add the arm.

### P2 — MEDIUM. SPEC 46's "positive bound" (the Moments update authority cannot transfer or burn an individual Proof of Burn) is a source read of Core, with no arm, and the suite already holds everything needed to test it.

**Construct.** `SPEC.md` item 46, "(b) THE POSITIVE BOUND: that key cannot transfer or burn an individual Proof of Burn. Core's asset approves a transfer or burn only for its owner and the collection abstains (`state/asset.rs` 271-296, `state/collection.rs` 240-258)", plus "so what the key can do is gate or brick claims, as below, **never take a Proof of Burn**". The code side is `claim_charter_vault`, which only cares about the PoB's owner bytes, its collection discriminant and key, and its Merkle leaf.

**What is gained if the bound is false.** SPEC 46 already discloses two consequences of that key: end the project before it starts, or capture governance by admitting only its own PoBs. Both presuppose the key holder **already holds** PoBs. If it can *transfer* PoBs to itself, the capture route becomes available to a key holder with **no** PoBs, needs no plugin (so no `detectNestedVaults`-style alarm), and — as SPEC 46 itself notes — "a captured electorate, once formed, does not" end when the window closes. That is strictly more than "gate or brick".

**Evidence that would exist if I am right.** The suite already has `momentsAuth` as a keypair it controls and the real Moments collection cloned byte-for-byte (`sim/clone-pob.mjs`), and it already drives `addCollectionPlugin`/`removeCollectionPlugin` with that key (OR.1/OR.6). An arm that calls Core `TransferV1` on `POB[0]` with `newOwner = momentsAuth` and `authority = momentsAuth`, and one that calls `BurnV1` the same way, and asserts the result, would settle it in one run. **No such arm exists** — the suite tests the *plugin* routes and the *lookalike* route, never the direct transfer/burn route.

**Fix.** Add the two arms. If both are refused, cite the measurement in SPEC 46 instead of the source read (the SPEC's own caveat for the Execute rule is "the source is not proven identical to the pinned binary"). If either lands, correct SPEC 46 and HOLDER-GUIDE's honest list: the hot key can then hand itself the whole charter cohort directly, and the alarm should watch PoB **ownership**, not only the collection's plugins and authority.

### P3 — LOW. The coverage gate's quorum rule now exists in two places, and the gate's own both-ways selftest is invoked by nothing I can see.

**Construct.** `scripts/audit-coverage.sh` — `first_line_quorate()` in the embedded python, plus the `GATE_SELFTEST=1` mode that runs eight cases and prints `N/N quorum-line assertions as predicted`; and (per the round-31 validation, "eight both-ways cases run by the detector selftest") a second copy inside `bank/selftest.mjs`, which is not in this bundle.

**What is gained.** The freeze gate is ship-gate condition 1. If the two copies drift, the gate can be wrong about which rounds count as quorate while the copy that is under test stays green — this project's most repeated defect, committed inside the instrument that exists to catch it (the file's own comments describe exactly this failure twice).

**Evidence that would exist if I am right.** `grep -rn 'audit-coverage' scripts/ sim/ bank/` should show no caller of `scripts/audit-coverage.sh --selftest`; the runners I was given (`scripts/run-tests.sh`, `scripts/build-mainnet.sh`, `scripts/validate-core-gate.sh`, `sim/run-sim.sh`) do not invoke it. I cannot rule out that `bank/selftest.mjs` shells out to it — but if it does not, the headline regex now has two implementations and only one has a failing test.

**Fix.** Keep one implementation. Either have `bank/selftest.mjs` shell out to `scripts/audit-coverage.sh --selftest` and assert the printed count, or add `sub_selftest audit-coverage node … ` / `bash scripts/audit-coverage.sh --selftest` to `scripts/run-tests.sh` behind a floor that must EQUAL its count, like every other suite.

### P4 — PROCESS, HIGH (not a defect in the system). This round's bundle omits the files R7 and R8 name, and most of the off-chain pipeline.

**What is missing from the bundle, yet named as a target or as the authority for a claim:**

| file | named by |
|---|---|
| `bank/layout.mjs` | R7 ("every layout and every pinned cross-program offset is written once in `bank/layout.mjs` and asserted there against the Rust structs"), R8's X.1–X.6 |
| `bank/crank.mjs` | R2 (the crank joins/expires), R8, SPEC's control table |
| `bank/detectors.mjs`, `bank/alarm.mjs` | R8, SPEC's control table, items 9/25/28/38/40/46 |
| `bank/selftest.mjs` | the both-ways proof of every detector, the floor `DET_FLOOR=901` |
| `bank/accrual.mjs` | R2b (the off-chain mirror of `reweigh`/`pendingScaled`), `ALLOC_FLOOR=39` |
| `bank/revenue.mjs`, `bank/swap.mjs` | R6's trusted hop, item 10, the swap-fork gate |
| `bank/lock.mjs`, `bank/spl.mjs`, `bank/anchor.mjs`, `bank/redemption-poster.mjs` | item 6/7, `POSTER_FLOOR=23`, the poster rules |
| `scripts/check-launch-params.mjs` | item 38 ("refuses it BEFORE anything is signed"), `LAUNCH_FLOOR=47` |
| `scripts/cron-install.sh` | the AUTOMATIC column of the control table |
| `launch