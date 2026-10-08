Looking at this tree whole, I find no surviving CRITICAL or HIGH defect in the five programs or the off-chain pipeline. Round 38's five confirmed findings are all correctly repaired at their sites, and the repairs do not introduce regressions. The four accepted-limit questions are answered honestly: none of the stated limits is worse than stated, nothing listed as a limit is already closed, no discharged item is undischarged, and no OPEN AND BLOCKING item is quietly treated as accepted.

## R0. Round 38 verdict — independently verified

Both verdicts are bundled. I read them against the code at HEAD (`45271f9`) and re-ran the named measurements.

**Programs pass (VERDICT-programs.md):** Quorum met (6 substantive of 8). Five confirmed findings:

| ID | My grade | Repair verified at site |
|---|---|---|
| V38-1 (LOW) | LOW | `web/src/lib/plan-redeem.mjs` `drop` helper now removes only from the list that holds it (`const i = list.indexOf(a); if (i >= 0) list.splice(i, 1)`). The old `splice(-1)` is gone. |
| V38-2 (MEDIUM) | MEDIUM | `LATE_CONSENT` / `LATE_CONSENT_ID` mechanism in place; `prepareOpening` moves any ack not in `consented` to `lateInfo` when `s.consented` is true; at most two dry runs. |
| V38-3 (INFO) | INFO | `resolveCollection` lists unverifiable candidates with a "pin it instead" warning and still offers step 0. |
| V38-4 (INFO) | INFO | SPEC limit 27 "Who:" now reads "the vaults that remain … anyone can cause it". |
| V38-5 (INFO) | INFO | HOLDER-GUIDE "comes out to you" sentence now names the C5 exception. |

**Off-chain pass (VERDICT-offchain.md):** C01 (frozen-pool joins now sent), C02 (comment matches code), C03/C04 (documentation exception) — all verified.

**Round 38's disproved claims (W1-W11):** I re-read each against the code. All eleven are correctly disproved. DeepSeek's GOV offset 414 does not exist; Fugu's frozen-empty-account case is handled correctly; Opus-5's pool-unfreeze case fails closed as stated.

**No new defect in the five programs.** The 895-assertion suite, 71-assertion simulation, and `build-mainnet.sh` byte proof all pass. The sweep helper's mainnet bytes are byte-identical to the tested ones (`build-mainnet.sh` cmp's both against `dist/` and `target/deploy/`).

## R1. Custody — can anyone but the owner get value out?

**No.** The pairing binds asset AND owner in both directions, and the sweep helper's only access control is Core's `ExecuteV1` authority rule on a thawed vault.

- SEAL `open_for_redemption` walks the instructions sysvar for a top-level `burn_vault` with the same asset (account 0) and owner (account 2). CPI-hidden burns are invisible; a wrapped open would need a genuine top-level burn for this asset and owner later in the same transaction, which SEAL in turn only permits when a genuine top-level open for the same pair precedes it. Neither half can be borrowed from another vault's redemption sharing the transaction.
- BURN `burn_vault` requires PDA lamports == 0, every reserve mint's ATA under both token programs declared, PDA-owned, undelegated, extension-free, empty, and no declared account a live Core asset. The reserve list is read from SEAL's config, never kept locally, so the two cannot diverge.
- The sweep helper (`programs/cbob-vbob-vault-sweep/src/lib.rs`) moves only what the vault PDA owns (checked: `src_owner != *signer.key` refuses), to a destination owned by the one destination wallet with the same mint (`to_owner != *dest.key || to_mint != src_mint` refuses), reads the LIVE balance, closes the source, and sends every lamport of the asset-signer to the destination. Called directly it needs the asset-signer's signature, which nobody can give — Core is the only program that signs as `["mpl-core-execute", asset]`, and Core does so only for the asset's owner (SPEC accepted limit 40, measured SR.5/SR.5a). The PermanentFreezeExecute plugin blocks Execute while frozen, so the sweep can only run after a genuine thaw.

**The lamport sweep is correct.** `signer.lamports()` is read at execution, after all earlier instructions in the same transaction. The sweep's own closes send rent to the destination, not the signer, so they don't change the signer's balance. Nothing else in a redemption moves lamports to the asset-signer PDA (SEAL's thaw is a Core plugin update; Core ExecuteV1 does not sweep the PDA — proven impossibility 4). BURN's `lamports == 0` check then sees exactly what the sweep left (zero).

**Closed accounts pass BURN's emptiness proof for the right reason.** BURN skips any account not owned by either token program (`if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }`), so a closed account (System-owned, 0 bytes) is skipped, not misread. The reserve loop's `ReserveNotDeclared` only fires if the *address* is missing from the remaining accounts; the redeem page declares every reserve ATA under both programs, and the ATA program refuses to create a Token-2022 ATA for a classic mint (measured `probe-mainnet-facts.mjs`), so the Token-2022 derivation for a classic reserve is always absent and always skipped.

**Missing reserve accounts:** The redeem page creates any missing reserve ATA in a prior transaction (SPEC REDEEMING step 1). A stranger cannot create a classic ATA for the vault PDA at an ATA address (the address is a PDA of the ATA program; a System allocate for it needs its signature, which nobody has — R34.G2/R36.G2a measured). The sweep refuses a non-token account (`read_token` checks owner and length 165), so a stranger's dusted System-owned address at the ATA derivation cannot be named.

## R1s. Sweep helper — every refusal branch verified

I traced every `return Err(...)` in `process` and in `read_token`:

| Branch | Evidence |
|---|---|
| `data != [0]` | SR.6 — invalid instruction data |
| odd account count | SR.7 — insufficient account keys |
| wrong token program | SR.8 — incorrect program id |
| wrong system program | SR.9 — incorrect program id |
| signer == dest | SR.10 — invalid argument |
| source not owned by signer | SR.11 — illegal owner (alice's own account) |
| destination not wallet's mint-matching account | SR.12 / SR.12a — invalid account data |
| frozen source | SR.14 — token program refuses, opening reverts |
| zero pairs, lamports-only | SR.13 — wallet's lamports moved, no CBOB_SWEEP log needed |

**The helper is deployed from the same bytes the suite proves.** `build-mainnet.sh` cmp's `dist/cbob_vault_sweep.so` against both `$CACHE/ln/.../release/cbob_vault_sweep.so` and `target/deploy/cbob_vault_sweep.so`; all three sha256s are printed and must match. The Cargo.toml has no `localnet` feature (deliberately — round 25), so the tested build IS the shipped build.

## R2. The pool's money — invariant holds

`pool_balance >= ceil(owed_scaled / ACC_SCALE)` is maintained by construction:

- `credit` adds `floor(avail * ACC_SCALE / w)` to `acc_scaled` and `delta * w` to `owed_scaled`. Since `delta * w <= avail * ACC_SCALE`, `owed_scaled` grows by at most what was removed from the pool. The sub-sat residue stays in the pool (P.13, P.12a).
- `claim` settles whole sats (`pay = floor(pending / ACC_SCALE)`), moves `pay` out of the pool, and carries the remainder in `carry_scaled`. `owed_scaled` falls by exactly `pay * ACC_SCALE`.
- `retire` (redeemed or burned) removes the vault's full pending share from `owed_scaled` and its weight from `total_active_weight`. A forfeited share (frozen pool) is subtracted from `owed_scaled` and returned to the pool balance (3c.F3).
- `join` sets `debt_scaled = weight * acc_scaled` at the accumulator as it stands, so the joining vault is owed nothing until the next distribution. `JoinWaitingFirst` guarantees no distribution credits between eligibility and join, so the debt is exact.

`overflow-checks = true` (Cargo.toml, measured by `run-tests.sh`), so every `checked_*` aborts rather than wraps. The host unit test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` drives 260 distributions through the program's own `credit`/`join`/`reweigh`/`expire_boost`/`retire` and checks the books against an independent model at every step — it cannot pass by never reaching a branch.

## R2b. The $CBOB boost — exact by construction

A boost is bought in epoch `b`, ends in `e = b + epochs`, and is counted in `boost_expiring[e % 64]`. `MAX_BOOST_EPOCHS = BOOST_RING - 1 = 63`, so two live end epochs never share a ring slot (the only collisions are same-end-epoch, which is correct). `advance_epoch` adds `boost_expiring[epoch % 64]` to `boosts_due` and clears the slot; `BoostsExpireFirst` then refuses every distribution and `monthly_inline` until `expire_boosts` (or a `claim`) clears them. `expire_boosts` requires `dist_epoch >= boost_end_epoch`, so a boost earns exactly the distributions at `b+1 … b+epochs` and not one more. `reweigh` moves the owed share into `carry_scaled` and restarts `debt_scaled` at the new weight, so nothing earned is lost or gained at a weight change. `unschedule_boost` (early retirement) decrements the ring slot if not yet due, or `boosts_due` if due, so the global counters always agree with the records. The host unit test verifies all of this across four ring wraps, including wrapped buys, early wrapped retirements, and due retirements.

## R3. The level draw — FIFO holds, residual is accepted

`reveal_level` requires `index == revealed_total` (FIFO). `blockhash_in_window` takes the smallest produced slot in `[want, want + 64]`, deterministic because which slots the chain produced is settled before this runs. A missed window is rescheduled to `now + 16`, a slot that does not exist when the call lands, so nobody chooses among hashes they can already see. The residual — C's leader can grind its own block knowing hA and hB — is SPEC 26, stated truly in HOLDER-GUIDE ("the validator that produces the last of those blocks can choose among many results"). The "re-roll" residual (a minter declining to capture) is SPEC 25, also stated. Both are accepted limits, not new findings.

## R4. Governance — bounded, snapshot is immutable

`index_snapshot` and `quorum_supply` are fixed at `create_proposal`; a vault minted during the vote is `VaultTooNew` and neither votes nor raises the bar. Quorum is ceiling division against the snapshot, never zero (`need > 0`). Threshold is a share of votes cast. Turnout requires YES >= 10% of the snapshot. A guardian change or operator arm requires YES >= 50% of the snapshot, never bundled with the other (`KeyChangesBundled`), and lands only after `notice_secs` via a permissionless `apply_*` that the guardian in office cannot cancel (for the guardian) or that the guardian can cancel (for a pending operator). `restart` refuses a proposal created before the stop it would lift (`StopIsNewer`, mirrored by GOV's skip). An overtaken action is a logged `CBOB_ACTION_SKIPPED` no-op, never a revert, so it cannot drag its bundle down. A hostile majority is bounded by MINT: it cannot mint past `max_supply`, price below 21,000 sats, touch the split, either destination, the royalty, or any vault.

## R5. Charter claim — identity by address, window by clock

`claim_charter_vault` CPI-burns the Proof of Burn as its owner in the same instruction, verifies the asset is a live Core AssetV1 in `pob_collection` owned by the signer, and verifies a Merkle proof of its address against `pob_root` (domain-separated leaf/node tags, sorted pairs). Outside `[charter_opens_at, charter_closes_at)` it refuses by clock alone. The window is fixed at `initialize` and can never reopen. `pob_extra` accounts are passed through to Core's burn never as signers. The hot update-authority wallet (SPEC 46) can gate or brick claims during the window; this is an accepted limit, stated in HOLDER-GUIDE, and ends when the window closes.

## R6. One-time configuration — every initialize value pinned

SEAL's `initialize` is first-come by `INIT_AUTHORITY` only; the reserve list is written once and `assert_classic_spl` refuses a Token-2022 mint (which would seal every vault permanently). MINT's `initialize` checks SEAL agrees on the collection and holds the payment mint as a reserve, refuses a default treasury, refuses a payment mint that is not a reserve, and fixes the 85/15, both destinations, `max_supply`, and the royalty (plugin authority None). BURN's `initialize` checks SEAL agrees. GOV's `initialize` checks MINT agrees. The alarm reports a wrong value only after it is written, which is why `scripts/check-launch-params.mjs` (49 launch assertions, selftest) is the only gate for the exact ruled values before signing. The swap operator is the one trusted hop: bounded on chain (cap, cooldown, reserve), operator-signed, guardian-stoppable, replaceable only by half of all live vaults plus 7 days' notice. The 10% royalty is a Core plugin with authority None; Core refuses every update and removal, from anyone, including the update authority (measured R.6/R.6a). The redemption cap is a true rolling window of the last 64 timestamps in `BurnConfig.rate_ring`; a redemption lands iff the cap-th most recent is at least a full window old (RL.2-RL.7).

## R7. Cross-program raw reads — every offset recomputed

I recomputed every pinned offset from the struct definitions and the Borsh layout:

- SEAL config v2: disc[0..8] version[8] collection[9..41] reserves Vec at 41 (u32 count, then 32-byte keys). `OFF_RESERVES = 41` correct.
- MINT config v6: disc[0..8] version[8] collection[9..41] governance[41..73] pool_ata[73..105] round_id[105..109] opens_at[109..117] closes_at[117..125] price[125..133] cap[133..137] minted_this_round[137..141] minted_total[141..149] … charter_claimed[450..454] bare_burns_retired[454..462]. `OFF_GOVERNANCE = 41`, `OFF_MINTED_TOTAL = 141`, `OFF_BARE_RETIRED = 454` all correct.
- BURN config v4: disc[0..8] version[8] collection[9..41] bump[41] burned_total[42..50] redeem_window_secs[50..58] rate_head[58] rate_ring[59..59+512]. `OFF_BURNED_TOTAL = 42` correct.
- GOV config v4: disc[0..8] version[8] collection[9..41] quorum_bps[41..43] threshold_bps[43..45] min_voting_secs[45..53] … last_boost_id. `OFF_MINT_GOVERNANCE = 41` correct.
- VaultRecord v4: disc[0..8] version[8] asset[9..41] mint_index[41..49] reveal_slot[49..57] level[57] charter[58] entropy_set[59] entropy[60..92] attrs_hash[92..124] bump[124] active[125] retired[126] reschedules[127..129] vault_ata[129..161] debt_scaled[161..177] pending[177] request_epoch[178..186] boost_weight[186] boost_end_epoch[187..195] carry_scaled[195..211]. `OFF_REC_INDEX = 41` correct.

Every discriminator (`SEAL_CONFIG_DISC`, `MINT_CONFIG_DISC`, `BURN_CONFIG_DISC`, `GOV_CONFIG_DISD`, `VAULT_RECORD_DISD`, `IX_BURN_VAULT_DISC`, `IX_OPEN_FOR_REDEMPTION_DISC`, `IX_RETIRE_REDEEMED_DISC`, `IX_SET_ROUND`, `IX_RESTART`, `IX_ARM_GUARDIAN`, `IX_TIGHTEN_SWEEP`, `IX_ARM_SWAP_OPERATOR`, `IX_SET_BOOST_TERMS`) is asserted against its SHA-256 derivation in the suite (3.1a-3.1t, R.7-R.7b). A wrong offset here is a silent misread the type system cannot see; none are wrong.

## R8. The suite, the simulation, and the build as evidence

- `tests/3prog.test.ts` (895 assertions) and `sim/test-vault.ts` (71 assertions) both pass at HEAD. Every negative arm has a `because` pin; I spot-checked twenty and each refusal fires for the named reason.
- `tests/expiry-budget.mjs` executes twenty DISTINCT due boosts under the default legacy CU budget on synthetic genesis state (4 assertions, floor equals count).
- `scripts/build-mainnet.sh` builds both mainnet and localnet artifacts, asks each of the four keyed programs whether it trusts the test key (mainnet must REJECT, localnet must ACCEPT — `tests/initauth.test.ts`), and cmp's the sweep helper's mainnet bytes against both its localnet build and `target/deploy/`. The sweep helper carries no `localnet` feature, so the tested bytes ARE the shipped bytes.
- `scripts/audit-coverage.sh` (strict) exits 0: every tracked system file's current content was bundled by a completed, quorate round. The program Cargo.toml files, `sim/fixtures.mjs`, `scripts/pob-set.json`, and `tests/initauth.test.ts` — none of which had been shown before round 30 — are now covered.

## The four questions about the accepted limits

1. **Is any limit WORSE than stated?** No. SPEC 25 (re-roll), 26 (C's leader grinds), 27 (dead-weight claim), 28 (Coinbase freeze), 40 (Core upgradeable), 41 (transfers not limited), 43 (off-curve owner), 44 (airdrops destroyed), 46 (hot PoB key), 47 (stolen guardian at low turnout), 55 (unsplit revenue), 56 (hot $CBOB key), 57 (minter-chosen name/picture) — each is stated truly and none is exploitable beyond what the text admits.

2. **Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?** No. Items 1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24 were about the v5 Bank key, deck, or distributor — all gone with v6, correctly DISCHARGED. Items 12/17 (compute), 14 (duplicate attributes), 19 (unlevelled halt), 30 (85/15 permanent), 31 (31-day cadence), 33 (operator notice) were measured closed or superseded. None of the remaining ACCEPTED items is secretly closed.

3. **Is any DISCHARGED item not actually discharged?** No. Each discharged item's reason is named and verified: 12/17 measured CU at the widest shapes (10.1-10.6b), 14 closed by `DuplicateAttribute` (11.4), 19 closed by construction (`activate` refuses `NotRevealed`), 30/31/33 superseded by stage 3b/3c.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22 (dress rehearsal), 38 (launch values), 50 (holder surfaces), 52 (cbBTC accounts), 53 (rehearsal tree) remain OPEN. `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline`, and `vault_collection` OPEN, and `judgeLaunch` refuses them (selftest). The holder pages are built and staged in `web/` but not published; `judgeRedemptionCoverage` runs only inside the staged redeem page, and nothing in production calls it. Item 53's rehearsal value set and `rehearsal-init.json` are not built; the `rehearsal` profile refuses.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Three things AI audit structurally cannot do, and this project should do before launch:

1. **A mainnet dress rehearsal at throwaway program IDs with real money.** Item 22 is OPEN AND BLOCKING for exactly this reason: the crank's I/O against a live cluster with ~2,100 vaults (cost, rate limits, paging, a transient RPC error on vault 1,900 of 2,100, the every-minute reveal lane keeping up) has never been exercised. The programs' arithmetic is proven; the crank's live behavior is not. Run it. Record the signatures of the named pass/fail items, including one full live revenue cycle through BOTH pools (Orca forced to refuse once, so Meteora runs) and one forced post-sweep failure walked through by hand.

2. **A byte-exact reproducibility check by a second party.** `scripts/build-mainnet.sh` proves the artifacts reject/accept the test key and that the sweep helper's bytes match. But the bridge between "the source names Gary's key" and "the compiled constant IS that key" is reproducibility, not measurement. An independent rebuild from the release commit that produces the same five sha256s is the only thing that closes it. Do it, and compare the sha256s in `dist/SHA256SUMS`.

3. **A real wallet and a real holder on the staged pages.** The 618 offline web assertions prove the instructions are byte-identical to the suite's builders and that the planner refuses every named case. They do not prove that a Phantom wallet will not modify the signed message in a way `signExact` does not catch, that a holder understands the C5 / freeze / late-arrival boxes, or that the Squads v4 return path works. Drive the staged redeem, claim, and buy pages against a localnet validator with a real wallet and a real (throwaway) Proof of Burn. The e2e harness (`web/test/e2e-localnet.sh`) exists; run it, and read the result.

**Verdict: CLEAN. No confirmed defect in the five programs or the off-chain pipeline. The clean-round counter advances to 1 of 2.**