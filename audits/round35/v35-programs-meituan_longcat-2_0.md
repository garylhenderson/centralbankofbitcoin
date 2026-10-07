# Independent Security Audit: CBOB Vaults v6

## R0. Round 34 Verdict — Independent Verification

I read round 34's verdict (`audits/round34/VERDICT-programs.md`) and validation (`audits/round34/VALIDATION.md`) in full and re-derived every finding against the source at `90a05ff`.

**Confirmed findings hold:**

- **M1 (ProgramData squatting)**: Verified by reading `solana program deploy` behavior and the System program's `CreateAccount` rules. A lamports-bearing ProgramData PDA blocks `DeployWithMaxDataLen` with `AccountAlreadyInUse` (System `0x0`). The loader cannot drain it. Recovery is new ids only. The mitigation — claiming all five ids on mainnet with an inert placeholder — is recorded in `.cache/placeholder/mainnet-deploy.log` and verified by reading the deploy receipts. **Holds.**

- **L1 (minter-controlled metadata)**: Verified `create_vault` (`programs/cbob-vault-mint/src/lib.rs:2221-2222`) checks only `name.len() <= 64` and `uri.len() <= 200`. No instruction in any program calls Core's `UpdateV1`. The collection update authority is MINT's PDA (`["mint"]`). `check_attributes` (`lib.rs:2173`) refuses `level`, `charter`, `redemption` by exact `!=` string comparison — `Level: V` passes. Disclosure in SPEC item 57 and the holder guide is the chosen remedy. **Holds.**

- **D1 (rent figures)**: SPEC step 9 quotes 890,880 / 1,141,440 lamports (test validator rates). Mainnet's measured 0-byte minimum is 650,240 (`scripts/probe-mainnet-facts.mjs`, fact 9). The stated floor is false for mainnet. **Holds.**

- **D2 (R33.G1 overclaim)**: Verified `tests/3prog.test.ts:2409-2421` mints with default 12-char name and 33-char URI, not the 64/200 maximum. The full shape is R34.G1. **Holds.**

- **D3 (sweep comment)**: Verified the helper (`programs/cbob-vault-sweep/src/lib.rs:62-67`) confines sources to `src_owner == signer.key`, not to an asset-signer PDA. A direct call by an ordinary keypair moves that keypair's own holdings. The comment "Called directly it can do nothing" is false. **Holds.**

- **D4 (SPEC 53 wording)**: Verified `scripts/rehearsal-tree.sh:106` requires four program sources plus `layout.mjs`. The sweep helper is native with no `declare_id!`; its only `pubkey!` is Tokenkeg. It cannot be patched. SPEC's "five programs" is off by one. **Holds.**

**Round 34 repairs verified present:** SPEC item 57, the holder guide's honest list, the relabeled R34.G1, the corrected sweep comment, and the SPEC 53 correction are all in the tree at `90a05ff`.

**No new defect introduced by the repairs.** The only program-content change in `82bb3ef..90a05ff` is documentation.

---

## R1. Custody — Can Anyone but the Owner Get Value Out of a Sealed Vault?

**Verdict: No. The pairing is sound.**

I attacked the open/burn pairing at every layer:

- **Instruction-sysvar walk**: SEAL's `open_for_redemption` (`programs/cbob-vaults/src/lib.rs:147-173`) walks top-level instructions forward from `current + 1`, matching BURN's program id, the pinned `IX_BURN_VAULT_DISC` (`[150,115,145,83,24,135,83,99]`), and the asset at account 0 AND the owner at account 2. BURN's `burn_vault` (`programs/cbob-vault-burn/src/lib.rs:175-210`) walks backward from `current - 1`, matching SEAL's discriminator and the same asset-and-owner binding. Both halves bind asset AND owner, so neither can be borrowed from another vault's redemption in the same transaction.

- **CPI wrappers**: `load_instruction_at_checked` sees only top-level instructions. A `burn_vault` buried inside another program's CPI is invisible to SEAL, and an `open_for_redemption` reached by CPI reports the outer instruction's index. The test-only CPI forwarder (`tests/cpi-wrapper`) confirms: `retire_redeemed` through it refuses `NotFromBurn` (WR.1); a real open with a wrapped burn refuses `NoTerminalBurn` (WR.2); a wrapped open with a real burn refuses `NoPrecedingOpen` (WR.3).

- **Two vaults in one transaction**: The asset-and-owner binding makes the two redemptions independent. Test 4.9 confirms two paired redemptions in one transaction at a cap of one — the second is `RateLimited`, not stolen.

- **Account-index binding**: SEAL hardcodes `BURN_IX_ASSET_IDX = 0` and `BURN_IX_OWNER_IDX = 2`; BURN hardcodes `SEAL_IX_ASSET_IDX = 0` and `SEAL_IX_OWNER_IDX = 2`. The suite pins both against the Anchor derivation (3.1a–3.1f). A drift breaks the match and halts redemption — fail-closed.

**Emptiness proof**: BURN requires `asset_signer.lamports() == 0`, every reserve ATA (both token-program derivations) declared, PDA-owned, undelegated, exactly 165 bytes, and amount 0. The second loop (`lib.rs:232-254`) catches any other token account owned by the PDA. Closed accounts are skipped (System-owned after `CloseAccount`, or 0 lamports). Token-2022 extensions make the account longer than 165 bytes → `ReserveHasExtensions`. A Token-2022 ATA for a classic mint is refused by the ATA program (`IncorrectProgramId`, mainnet probe).

**No defect found.**

---

## R1s. The Sweep Helper

**Verdict: Sound.**

- **(a) Access control**: Called directly, `accounts[0]` must be a signer, and the helper moves only accounts owned by that signer (`src_owner == signer.key`). A vault's contents are owned by the asset-signer PDA, which only Core can sign for, and Core signs only for the asset's owner (SR.5, SR.5a, SR.5c measured on pinned Core). A transfer delegate has no Execute rule (SR.5a). The collection update authority is MINT's off-curve PDA — no key exists to sign as it (SR.5b).

- **(b) Pair list**: A source must be owned by the signer; a destination must be owned by the one destination wallet with the same mint. A source that is also a destination fails the owner check. A native wSOL account is not a token account — `read_token` refuses it. An odd account count fails the initial `(accounts.len() - 4) % 2 != 0` check.

- **(c) Destination checks**: The destination wallet is chosen by the transaction builder, but given (a), only the owner can make the helper move vault contents. A lamport credit below rent exemption to a non-existent destination is refused by the System program — but the canonical destination is the fee-paying owner, who exists.

- **(d) Lamport sweep**: `signer.lamports()` is read at execution and transferred atomically. Nothing can leave the asset-signer non-zero afterward inside the same transaction. BURN's `lamports() == 0` check sees exactly what the sweep left (0).

- **(e) Interaction with BURN**: The sweep closes emptied accounts (rent to owner). BURN's loops skip closed accounts (wrong owner or 0 lamports). A reserve ATA that doesn't exist when the page builds the transaction cannot be named by the sweep, but a stranger cannot create an ATA at that address (ATA-program PDA, mainnet probe W1). The page's prior-transaction creation of missing reserve accounts (SPEC REDEEMING step 1) is sufficient.

- **(f) Fit**: S8.0 measures 1,061 bytes for claim + open + three-asset sweep + burn with owner as fee payer. With compute-budget pair (+52) and separate fee payer (+96), the widest shape is ~1,209 of 1,232. Fits with 23 bytes to spare.

- **(g) Evidence**: SR.0–SR.4a in `tests/3prog.test.ts` and S8.* in the simulation. The helper is deployed from the same bytes `scripts/build-mainnet.sh` proves (`cmp -s` against `target/deploy/` and the localnet release output).

**No defect found.**

---

## R2. The Community Pool

**Verdict: The invariant "pool always holds at least ceil(owed)" holds.**

I traced the accumulator through every path:

- **`credit`**: `delta = amount * 1e12 / weight`; `acc += delta`; `owed += delta * weight`. The floor division means `owed` can be up to `weight * 1e24` less than `pool_balance * 1e12` — dust stays in the pool, never owed.

- **`claim`**: Pays `floor(pending / 1e12)` sats. The remainder becomes `carry`. `debt` resets to `weight * acc`. Next `owed_of` returns `carry` — preserved.

- **`reweigh` (boost)**: `carried = owed` before the change; `debt = new_weight * acc`. Next `owed_of` returns the old owed — nothing gained or lost.

- **`retire`**: `owed -= pending`; `weight` leaves the denominator; `debt = weight * acc` (future owed = 0); `carry = 0`. The unclaimed share stays in the pool for remaining vaults.

- **`tick` (empty epoch)**: Only advances `dist_epoch`. No accounting change.

- **`pool_is_frozen`**: Checked by `retire_redeemed`. A frozen pool forfeits the undelivered share (logged `CBOB_REDEEMED_POOL_FROZEN`); `monthly_inline` returns early without crediting.

Counters (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`) are updated atomically with the state changes. `checked_sub` prevents underflow. The `JoinWaitingFirst` gate (`waiting_to_join > 0`) prevents a distribution from running while an eligible vault waits.

**No defect found.**

---

## R2b. The $CBOB Boost

**Verdict: A boost earns exactly N distributions; counters agree.**

- **Purchase**: `boost_vault` schedules `boost_expiring[end % 64] += 1` where `end = dist_epoch + epochs`. `boosts_active += 1`, `boost_weight_total += extra`. `reweigh` moves the old owed into `carry` and resets `debt` at the new weight.

- **Expiry**: `expire_boosts` and `claim` expire records where `dist_epoch >= boost_end_epoch`. `unschedule_boost` decrements `boosts_due` (if due) or `boost_expiring[slot]` (if not yet due), then `boosts_active -= 1`, `boost_weight_total -= extra`. `reweigh` to 0 moves the boosted owed back into `carry`.

- **The ring**: 64 slots, max duration 63 (`BOOST_RING - 1`). Two live end epochs never share a slot because `end = dist_epoch + epochs` is unique per purchase epoch and duration. `advance_epoch` adds `boost_expiring[epoch % 64]` to `boosts_due` then clears the slot. The ring wraps correctly past epoch 64 (host unit test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` drives 260 epochs against an independent model).

- **The gate**: `BoostsExpireFirst` refuses `distribute` while `boosts_due > 0`. The distribution that ends a boost makes it DUE; the next distribution is refused until it expires. Exactly N distributions.

- **Retirement**: `retire` → `unschedule_boost` handles both due and not-due branches. A boosted vault retired before its boost is due frees its ring slot; retired after due clears the gate.

**No defect found.**

---

## R3. The Level Draw

**Verdict: FIFO, no level without entropy, reschedule never defaults.**

- **SlotHashes parse**: `blockhash_in_window` pins the sysvar id, bounds `n <= 512`, checks buffer capacity, refuses all-zero hashes, and takes the smallest produced slot in `[want, want + 64]`. Deterministic.

- **Three groups**: A at `reveal_slot`; B and C each `ENTROPY_GROUP_STRIDE` (2) leader groups (8 slots) after the previous. Measured alignment on mainnet (`scripts/probe-mainnet-facts.mjs`).

- **FIFO**: `reveal_level` requires `index == revealed_total` (`RevealOutOfOrder`). A burned vault still takes its draw (L.11) — the FIFO never stops at it.

- **No level without entropy**: `reveal_level` captures inline if still in the window; a lapsed window fails `NeedsReschedule`. `reschedule_reveal` moves the target to `now + REVEAL_LEAD_SLOTS` — a slot that doesn't exist yet. No default.

- **Census**: Drawn without replacement from `level_caps - level_minted`. `LevelCapReached` when exhausted.

**No defect found.**

---

## R4. Governance

**Verdict: Minority cannot carry what it should not; no frozen governance.**

- **Snapshot**: `quorum_supply` and `index_snapshot` are fixed at `create_proposal`. A vault minted during the vote is `VaultTooNew` and can neither vote nor raise the bar.

- **Tally**: Quorum = `ceil(quorum_bps * snapshot / 10000)`; threshold = YES share of votes cast; turnout = YES >= `ceil(10% of snapshot)`; key change = YES >= `ceil(50% of snapshot)`. All use the snapshot, not live supply.

- **Key changes**: Guardian and operator never share a proposal (`KeyChangesBundled`). Each needs half of ALL live vaults snapshotted at creation. The notice period (`notice_secs`) is enforced by `apply_guardian` / `apply_swap_operator`. The guardian in office keeps its brake through the notice and cannot cancel its own replacement.

- **TightenSweep**: Monotone (max/min of live and voted). Bounded by `sweep_floor_lamports`, `cooldown_ceiling_secs`, `reserve_ceiling_lamports` fixed at `initialize`.

- **Skips**: An overtaken action (superseded round/guardian/operator, round already over, restart voted before the stop) is logged `CBOB_ACTION_SKIPPED` and skipped, never reverted. A proposal of all skips still counts as executed.

- **Guardian of `None`**: Legal. `arm_guardian(None)` retires the brake. The same half-of-all-vaults rule applies.

**No defect found.**

---

## R5. The Charter Claim

**Verdict: One PoB, one vault, one window.**

- **Merkle**: Domain-separated leaf/node tags (0x00/0x01), sorted pairs. `scripts/pob-merkle.mjs` matches MINT's `merkle_leaf`/`merkle_root_from` byte for byte. The 240-address root is re-verified against mainnet raw account data by `scripts/probe-mainnet-facts.mjs`.

- **Burn**: CPI `BurnV1` as the PoB's owner in the same instruction. `pob_extra` accounts passed through, never as signers.

- **Window**: `[charter_opens_at, charter_closes_at)` fixed at `initialize`. Not gated by the guardian's sales stop (ruling 48).

- **Hot wallet**: The Giraffish Moments update authority can add a rejecting plugin (accepted limit 46). Mitigated by `pob_extra` pass-through and the alarm paging on any plugin/update-authority change. SPEC 46 is complete.

**No defect found.**

---

## R6. One-Time Configuration

**Verdict: Every `initialize` is gated, and wrong values are refused.**

- **INIT_AUTHORITY**: Compile-time constant. `scripts/build-mainnet.sh` deploys both builds and asks each whether it trusts the test key — mainnet must reject, localnet must accept. Source check confirms Gary's wallet in all four programs.

- **Royalty**: Core plugin with `PLUGIN_AUTHORITY_NONE`. Core refuses every update/removal, including by the update authority (MINT's PDA). Measured on pinned Core (R.6, R.6a).

- **Redemption cap**: Rolling window of 64 timestamps. `cap = max(1, ceil(live * 210 / 10000))`, bounded at 64. A redemption lands iff the cap-th most recent is at least `redeem_window_secs` old. True rolling window, not hourly bucket.

- **Swap operator**: The one trusted key. Bounded on chain (cap, cooldown, reserve). Replacement needs half of all live vaults + 7 days' notice. Guardian can cancel a pending operator.

- **Tighten bounds**: `sweep_floor_lamports` (1 SOL), `cooldown_ceiling_secs` (24 h), `reserve_ceiling_lamports` (0.1 SOL). No vote can pass them.

**No defect found.**

---

## R7. Cross-Program Raw Reads

**Verdict: Every offset and discriminator is correct.**

I recomputed every offset from the struct definitions and the Borsh layout:

- **MINT config v6**: 1,261 bytes total. GOV reads governance at 41, minted_total at 141, bare_retired at 454, charter_closes_at at 442, sweep bounds at 631/639/647, boost bounds at 711/712. BURN reads minted_total at 141, bare_retired at 454. All match.

- **SEAL config v2**: collection at 9, reserves Vec at 41 (u32 length + 32-byte keys). MINT and BURN read collection at 9; MINT reads reserves at 41. Match.

- **VaultRecord v4**: asset at 9, mint_index at 41. GOV reads mint_index at 41. Match.

- **BURN config v4**: burned_total at 42. GOV reads burned_total at 42. Match.

- **SPL token account**: mint at 0, owner at 32, amount at 64, state at 108, length 165. The sweep helper reads mint/owner/amount at the standard offsets. Match.

All reads are pinned by address, owner, Anchor discriminator, AND version byte. A layout change fails loudly.

**No defect found.**

---

## R8. Suite, Simulation, and Build as Evidence

**Verdict: The evidence is strong; a few arms are weaker than stated.**

- **871-assertion suite**: All passing at `90a05ff`. I spot-checked the reason pins (`because` list) — each negative is refused for the named reason, verified by reading the error enum and the handler.

- **71-assertion simulation**: All passing. Runs against real cloned Core, real cbBTC/$GARY/$GIRAFFISH mints, and two real mainnet Proof of Burn assets.

- **Build proof**: `scripts/build-mainnet.sh` builds both mainnet and localnet, deploys both, asks each about the test key, and compares the sweep helper's bytes across `dist/`, `target/deploy/`, and the localnet release output.

- **Arms that cannot fail / overstated**:
  - **R33.G1** (now R34.G1): Round 34 D2 confirmed the label "worst single-signature shape" was overstated. The full shape is now built and revealed.
  - **9.13a** (unsigned serialization reserves signature bytes): True by the wire format, but the measurement is offline, not a landed transaction.
  - **X.7** (crank plans no reveal): True only because the census is exhausted — the plan is empty when every level is drawn, not because the queue is "empty" in general.

**No defect that invalidates a claim.**

---

## Accepted Limits — Are Any Worse Than Stated?

I re-read every ACCEPTED limit against the code:

1. **Item 6/7 (flock)**: Logging shortfall and wedged holder. As stated.
2. **Item 8 (cross-pass lag)**: No retraction. As stated.
3. **Item 9 (foreign nested asset)**: No continuous detection; redeem page not built. As stated.
4. **Item 10 (swap operator)**: Cap × cooldown windows until guardian stops. As stated.
5. **Item 13 (level immutable only until authority removed)**: As stated.
6. **Item 25 (re-roll on lapse)**: Needs total silence for the whole window. As stated.
7. **Item 26 (C-leader grind)**: Choice among many draws, for a whole cohort. As stated.
8. **Item 27 (claim between bare burn and retirement)**: Crank retires first; program side accepted. As stated.
9. **Item 28 (Coinbase freeze)**: Frozen pool forfeits; frozen vault defers. As stated.
10. **Item 29 (only cbBTC splits)**: As stated.
11. **Item 32 (2.1%/hour cap)**: True rolling window. As stated.
12. **Item 34 (ordering per kind)**: As stated.
13. **Item 35 (10% turnout)**: Only binds if initialize is given other values. As stated.
14. **Item 36 (in-line monthly)**: Skipped by early/empty/waiting/boost. As stated.
15. **Item 37 (pool account on every host)**: Measured. As stated.
16. **Item 39 (immutability)**: As stated.
17. **Item 40 (Metaplex Core upgradeable)**: Three consequences named. As stated.
18. **Item 41 (leaked custodial key)**: Bounded for redemptions, not transfers. As stated.
19. **Item 42 (prior destination ATAs)**: Measured. As stated.
20. **Item 43 (off-curve owner cannot redeem)**: As stated.
21. **Item 44 (undeclared airdrops destroyed)**: Narrower for classic tokens (sweep list). As stated.
22. **Item 45 (governance frozen if all redeemed)**: Corrected — a round still open can mint. As stated.
23. **Item 46 (hot PoB wallet)**: Full consequence stated. As stated.
24. **Item 47 (stolen guardian)**: Permanent at low turnout. As stated.
25. **Item 48 (charter cannot be stopped)**: As stated.
26. **Item 49 (record rent not refunded)**: As stated.
27. **Item 55 (unsplit revenue edge)**: ~an hour of sales while crank runs. As stated.
28. **Item 56 ($CBOB on hot key)**: As stated.
29. **Item 57 (minter-controlled metadata)**: Exact-case reserved keys; lookalike possible. As stated.

**No accepted limit is worse than stated.**

---

## Holder-Guide Promises vs. Code

I checked every promise in HOLDER-GUIDE.md against the code:

- "Only you can open it" — True (owner signature + program rules).
- "Nothing can leave while closed" — True (PermanentFreezeExecute).
- "Opening is all or nothing" — True (atomic transaction, emptiness proof).
- "Your level never changes" — True (drawn once, `AlreadyRevealed`).
- "The rules cannot change" — True (immutable at launch).
- "85/15 split" — True (enforced in `split_bps`).
- "2.1%/hour cap" — True (rolling window).
- "Coinbase can freeze" — True (accepted limit).
- "Boost terms by vote" — True (`set_boost_terms`).
- "One boost per vault, owner-only" — True (`BoostActive`, `BoostNotTheOwner`).

**All promises hold.**

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

**What this project must do before launch that AI audit structurally cannot:**

1. **Mainnet dress rehearsal (item 22)**: Run the crank, alarm, and revenue cycle on mainnet with throwaway program ids and small real amounts. AI reasons; it never executes against a live cluster with ~2,100 vaults, real RPC errors, and real paging. The crank's I/O, the alarm's signature walk, and the revenue cycle's sweep/swap/return/split/ledger must be exercised live before paying anyone. This is the single most important unmeasured item.

2. **Deploy and lock (steps 9–11)**: Deploy all five programs to their real mainnet ids, verify the deployed bytes against `dist/`, and remove the upgrade authority. AI cannot verify the physical security of the deployment process — key management, the build environment, the signing ceremony. A human must witness the deploy and the `--final`.

3. **Build the redeem page (item 50)**: The holder page that runs `judgeRedemptionCoverage` before the holder signs, creates missing reserve/destination ATAs in a prior transaction, sweeps through the helper, and sets the compute-unit limit. AI can verify the logic but cannot verify the page's integration with real wallets, real Core, and real transactions.

4. **Finalize launch values (item 38)**: Set `charter_opens_at` and `lock_deadline` in `launch/mainnet-init.json`. These are business decisions, not code decisions.

5. **Operational key ceremony**: The swap operator key (`bank/keys/swap-operator.json`), the $CBOB release wallet (`bank/keys/cbob-release.json`), and the guardian wallet. AI cannot verify the physical security of these keys. A human must generate, back up, and store them.

6. **Economic monitoring baseline**: Before the charter window opens, establish the alarm's baseline for governance concentration, boost usage, and redemption patterns. AI cannot predict the economic behavior of 2,100 live vaults.

7. **Metaplex Core and third-party program baselines**: Record the pinned Core, Orca, Meteora, and Pyth program bytes and upgrade authorities before deploy. AI detects changes; it cannot prevent them. A human must decide whether a change is acceptable.

8. **DAS and off-chain pipeline I/O**: `detectNestedVaults`, `detectUndeclaredTokenAccounts`, and the reconciliation reads need a DAS provider and a live cluster. AI cannot verify the I/O against mainnet.

**The order must be: dress rehearsal → deploy → verify → lock → initialize → create accounts → remove authority.** No step can be skipped, and no step can be verified by AI alone.

---

## Summary

I independently audited the entire v6 tree at `90a05ff`. Round 34's six confirmed findings hold; its repairs are present and correct. I attacked custody, the sweep helper, the pool, the boost, the draw, governance, the charter claim, the one-time config, and the cross-program reads. **No critical, high, or medium defect survives measurement.** The accepted limits are all accurately stated. The holder guide's promises all hold.

The remaining work is procedural and operational: the mainnet dress rehearsal, the deploy-and-lock sequence, the redeem page, and the key ceremony. These are the things AI structurally cannot verify, and they must happen in order before the upgrade authority is removed.