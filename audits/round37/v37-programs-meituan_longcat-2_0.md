# Independent Security Audit: v6 Programs, Sweep Helper, and Pipeline

## R0. Round 36 Verdict and Repairs

I read both round 36 verdicts (`audits/round36/VERDICT-programs.md`, `audits/round36/VERDICT-offchain.md`) and the validation record. I independently re-examined every confirmed finding's repair at its site in the current tree.

**Programs pass (NOT CLEAN, quorum met):** Eight confirmed findings, none in the five programs. All were in `web/` or documentation. I verified each repair:

- **H1 (frozen destination blocks opening):** `web/src/lib/plan-redeem.mjs` now reads each owner destination's state via `readRedemptionSnapshot` (`ownerAtaFrozen`) and each mint's freeze authority (`mintFreeze`). `undeliverable()` refuses delivery when the destination is frozen, the mint has a non-reserve freeze authority, or the mint is unreadable. Strays are named in acknowledgement boxes. **Repair holds.** I re-ran the offline `plan.test.mjs` H1 vectors (VECTORS in the test) — all pass.
- **L1 (proxy relays non-CBOB transactions):** `txRefusal` in `web/deploy/rpc-proxy.mjs` now requires at least one CBOB program unless the transaction is one of three exact shapes (ATA creates, collection create, revenue funding). **Repair holds.** `proxy.test.mjs` A1–A3 and the L1 arms confirm.
- **L2 (payout doesn't expire due boosts):** `planPayout` now reads `boosts_due`, fetches due records via `dueBoostRecords`, and prepends `expire_boosts` groups before join/distribute. **Repair holds.** The e2e gate-5 item 3 and `plan.test.mjs` L2 arms confirm.
- **L3 (SPEC C5 text):** `SPEC.md` updated to say the page names each unmovable stray in a box the holder ticks. **Repair holds.**
- **L4 (stale MINT pin):** `web/src/config.js` now pins `0d91662a…` (707,664 bytes, commit `0b3ddb3`). `build.mjs` refuses unless `dist/MANIFEST.txt` names the release commit clean. **Repair holds.** `bundle.test.mjs` L4 arms confirm.
- **L5 (ceremony hash reference):** Footer now points to `web/README.md` hash table; `bundle.test.mjs` compares both profiles' built `app.js` against the committed table. **Repair holds.**
- **I1 (ceremony step-9 wording):** Now says step 11 makes programs final. **Repair holds.**
- **I2 (SPEC item 38 missing `vault_collection`):** Item 38 now lists `vault_collection` as OPEN. **Repair holds.**

**Off-chain pass:** Repairs to `bank/detectors.mjs` (`ACKABLE_KINDS` narrowed to `unredeemable_owner`), `bank/alarm.mjs` (interval vs. router grace), and SPEC text. I verified the detector selftest passes 920/920 and the alarm's interval exceeds the router grace. **Repairs hold.**

**Drift sweep (post-round-36):** 16 holder-facing and 29 internal stale statements were fixed. I spot-checked several; they are correct.

**Conclusion on R0:** Every round 36 repair is real, measured, and survives re-reading. No program was changed. The clean-round counter remains 0/2.

---

## R1. Custody: Can Anyone But the Owner Get Value Out of a Sealed Vault, or an Emptied Vault Survive?

I attacked the pairing, the emptiness proof, and the sweep helper. **No new defect found.**

### The pairing (SEAL ↔ BURN)

Both halves bind asset AND owner, in both directions, using top-level-only instruction-sysvar walks:

- SEAL `open_for_redemption` walks **forward** from its own index, requiring a later `burn_vault` with matching asset (account 0) and owner (account 2).
- BURN `burn_vault` walks **backward** from its own index, requiring an earlier `open_for_redemption` with matching asset (account 0) and owner (account 2).

`load_instruction_at_checked` sees only top-level instructions. A CPI-wrapped open or burn is invisible to the other half, so neither can be borrowed from a sibling redemption in the same transaction. The account-position constants agree across all four programs (SEAL, MINT, BURN, GOV) and are pinned by `BURN_IX_ASSET_IDX = 0`, `BURN_IX_OWNER_IDX = 2`, `SEAL_IX_ASSET_IDX = 0`, `SEAL_IX_OWNER_IDX = 2`. I verified these against the `OpenForRedemption` and `BurnVault` account structs — they match exactly.

**Evidence if wrong:** A transaction with two redemptions sharing a thaw or a burn would land. Suite tests 3.9, 3.10, 4.9, 4.10 refuse exactly these shapes. The suite's 895 assertions include WR.1–WR.4, which drive every redemption shape through a test-only CPI forwarder and confirm the vault stays live.

### The emptiness proof (BURN)

BURN requires:
- `asset_signer.lamports() == 0`
- Every reserve mint's ATA under **both** token programs declared, PDA-owned, undelegated, extension-free (`d.len() == 165`), `amount == 0`
- Every other remaining account that is a PDA-owned token account also `amount == 0`
- No declared account is a live Core asset (`VaultStillHoldsAVault`)

The reserve list is read from SEAL's config at burn time (one source of bounds). Token-2022 ATAs are refused at config time (`assert_classv_spl` in SEAL `initialize`), so a reserve ATA is always 165 bytes. The sweep helper closes what it empties; BURN checks `amount == 0`, not closure, so an unclosed empty account is not a leak (it strands rent — the redeemer's own loss, item 50).

**Evidence if wrong:** A vault with an undeclared token holding value burns cleanly. Suite 9.5/9.9 measure the gap: an undeclared airdrop is destroyed, a nested vault is refused (9.4). The sweep helper's live-balance read closes the exact-amount race (SR.3 vs. SR.4).

### The sweep helper (`programs/cbob-vault-sweep/src/lib.rs`)

Called only through Core `ExecuteV1`, which signs as the asset-signer PDA and requires the owner. The helper requires `signer.is_signer` (the PDA), reads live balances, transfers all, closes source (rent to destination), then sweeps every lamport of the PDA. Pair checks: source owned by PDA, destination owned by same wallet, same mint. No pair can be the vault itself (`signer.key == dest.key` refused).

**Evidence if wrong:** A stranger sweeps a vault they don't own. SR.1 (direct call, no Core) is refused for want of the PDA's signature. SR.5 (stranger drives Execute on a thawed vault) is refused by Core with `NoApprovals` (0x1a). SR.5a (owner-added transfer delegate) is also refused by Core. The pinned Core binary is measured: SR.5b pins the collection authority to MINT's off-curve PDA.

**No new defect.** The all-or-nothing thaw/sweep/burn is the whole design, and every half is fail-closed.

---

## R1s. The Sweep Helper

I re-audited the stateless helper against the round 25 findings and the current tree.

**(a) Access control:** Only the owner can make it move value. Direct calls need the PDA's signature (impossible). Through Core, Core's `ExecuteV1` authority rule on a thawed vault approves only the owner (measured: SR.5, SR.5a, SR.5c). **Sound.**

**(b) Pair list:** Any source owned by the PDA and destination owned by the one destination wallet, same mint. Duplicate sources: the first closes the account; the second reads a closed account (owner now System) and refuses `IllegalOwner`, reverting the whole call. This blocks redemption but cannot steal — it's a self-grief. Duplicate destinations: the second transfer goes to the same account; harmless. A source that is also a destination: refused (`signer.key == dest.key`). A native wSOL source: swept as a token account if it's a token account, or as lamports if it's a system account; the helper handles both. A frozen source: SPL Token refuses the transfer (0x11), reverting the call — the redeem page now detects frozen destinations and leaves them behind (H1 repair). **No defect.**

**(c) Destination wallet:** Not compared with the asset's owner. Given (a), safe — only the owner triggers the call, and they choose the destination.

**(d) Lamport sweep:** Reads `signer.lamports()` after closes (closes send rent to `dest`, not `signer`). Nothing can land between the sweep and the burn within the same transaction. BURN's `lamports == 0` check sees exactly what the sweep left. **Sound.**

**(e) Interaction with BURN's emptiness proof:** BURN requires every reserve ATA declared. The sweep closes what it empties; a closed account has 0 lamports and is owned by System, so BURN's `amount == 0` check passes. If a reserve ATA does NOT exist when the page builds the transaction, the page creates it in a prior transaction (item 42). A stranger CAN create a classic ATA permissionlessly, but the sweep then empties it. A Token-2022 ATA for a classic mint cannot exist (ATA program refuses, measured `probe-round5b.test.ts` F4.2). A non-ATA token account is invisible to BURN's proof — the redeem page's `judgeRedemptionCoverage` names it (item 44). **No defect.**

**(f) Fit:** S8.0 measures 1,061 bytes for claim + open + three-reserve sweep + burn with the owner as fee payer. With compute-budget pair (+52) and separate fee payer (+96) the widest shape is ~1,209 of 1,232. **Fits.**

**(g) Evidence:** SR.0–SR.4a in `tests/3prog.test.ts` and S8.* in `sim/test-vault.ts`. The helper is deployed from the same bytes `scripts/build-mainnet.sh` proves (`cmp -s` against `target/deploy/cbob_vault_sweep.so`). **Sound.**

---

## R2. The Community Pool's Money

I attacked the invariant "the pool always holds at least `ceil(owed)`" and the two-step activation.

### The invariant

`distribute` computes `avail = balance - ceil_sats(owed_scaled)`, then `delta = avail * ACC_SCALE / w_total`, then `acc_scaled += delta`, `owed_scaled += delta * w_total`. After: `ceil_sats(owed_scaled_new) = ceil_sats(owed_scaled_old) + avail = balance`. The invariant holds exactly. `claim` reduces `owed_scaled` by the settled amount and the pool balance by the same transfer. `retire` (redeemed or bare) subtracts the vault's pending share from `owed_scaled`; if forfeit (pool frozen), the money stays in the pool and the invariant still holds. `overflow-checks = true` aborts on any overflow. **Invariant holds.**

### Two-step activation

`activate` first REQUESTS (records `request_epoch = dist_epoch`, increments `pending_count`/`pending_this_epoch`). The vault JOINS only when `dist_epoch > request_epoch` (on the second `activate` or any `claim` that names it). At join, `debt_scaled = weight * acc_scaled` at the accumulator as it then stands; the vault earns from the NEXT distribution. `JoinWaitingFirst` refuses any distribution while an eligible-but-unjoined vault waits, so the first activator cannot tick the epoch and take the backlog alone. **No defect.**

### Counters

`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight` are updated atomically with the state transitions under the lock of a single transaction. `advance_epoch` resets `pending_this_epoch` and moves `boost_expiring[slot]` to `boosts_due`. I traced every path that touches each counter; none underflows or desynchronizes. **No defect.**

### Liveness

A frozen pool stops paid claims (the SPL `Transfer` reverts the whole `call`), but the crank sends join-only batches during a freeze, and `retire_redeemed` forfeits the undelivered share rather than locking the vault (3c.F2). A frozen vault account is deferred and stays owed (P.18). A wedged crank is survivable: every crank instruction is permissionless, the monthly distribution also runs in-line in ordinary traffic, and the alarm pages `distribution_overdue`. **No defect.**

---

## R2b. The $CBOB Boost

I attacked the invariant "a boost earns EXACTLY its N distributions and not one more" and the ring schedule.

### Exact N distributions

`boost_vault` sets `boost_end_epoch = dist_epoch + epochs`. The boost earns from the next distribution. After the Nth distribution, `dist_epoch == boost_end_epoch`, so the boost is DUE. `BoostsExpireFirst` refuses any further distribution until `expire_boosts` runs. `expire_boosts` calls `unschedule_boost` (decrements `boosts_due`) then `reweigh(c, r, 0)` (sets weight to 0). The boost earns exactly N. **No off-by-one.**

### Weight changes preserve earnings

`reweigh` moves the vault's current owed share into `carry_scaled` and resets `debt_scaled = new_weight * acc_scaled`. The owed amount is unchanged: `new_owed = new_weight * acc_scaled + carry - new_debt = new_weight * acc_scaled + old_owed - new_weight * acc_scaled = old_owed`. Boost, expiry, claim normalisation, and retire all go through `reweigh` or the equivalent. **Nothing earned is lost or gained.**

### Ring consistency

`boost_expiring[epoch % 64]` counts live boosts ending at that epoch. `advance_epoch` moves the current slot's count to `boosts_due` and clears the slot. `unschedule_boost` decrements either `boosts_due` (if due) or the future slot's count. `boosts_active` is incremented on buy and decremented on unschedule. The invariant `ring_sum + boosts_due == boosts_active` holds at every epoch. Past epoch 64 the ring wraps; the count is preserved because `advance_epoch` clears each slot exactly once. **No record expires twice, early, or never.**

### Nobody can make distributions impossible by boosting

A vault whose token account is gone cannot be boosted (`BoostNeedsActiveVault` requires `r.active`, and `activate` requires the account to exist). A due boost blocks distributions, but `expire_boosts` is free and anyone's; the crank expires due boosts every pass. **No defect.**

---

## R3. The Level Draw

I attacked the entropy parse, skipped-slot handling, FIFO, and the census.

### SlotHashes parse

`blockhash_in_window` pins the sysvar id, bounds the declared count to 512, checks the buffer holds what the count claims, scans for the smallest produced slot in `[want, want + 64]`, and refuses an all-zero hash. **Defensive and correct.**

### Skipped-slot handling

`try_capture` chains three hashes: A at `reveal_slot`, B at `(A_group + 2) * 4`, C at `(B_group + 2) * 4`. Each step uses `blockhash_in_window`, which takes the first PRODUCED slot in the window. A skipped slot is simply absent from the sysvar and the next produced slot is used. **Deterministic.**

### FIFO

`reveal_level` requires `index == revealed_total`. A missed window is rescheduled to `now + 16` (a slot that doesn't exist yet), and the FIFO waits for it. A burned vault at the head still takes its draw (L.11) so the queue never stops. **No defect.**

### What a leader can influence

C's leader produces its block knowing hA and hB and may skip its own first slot(s) to move C within its 4-slot group or vary its block's contents. This is the accepted residual (SPEC 26). It is selection among the levels still left, not a nudge, and it affects every vault minted in the same slot (same `reveal_slot`) jointly. **No worse than stated.**

### Census

`level_caps` must sum to ≤ `max_supply` and each cap > 0. `check_supply` refuses minting past the census total or `max_supply`. `reveal_level` draws without replacement from `level_caps - level_minted`. The quotas hold exactly (L.18, L.19). **No defect.**

---

## R4. Governance

I attacked the supermajority for key changes, the vote binding, and freezeability.

### One vault, one vote, bound to asset

`VoteRecord` is a PDA at `["vote", proposal, asset]`. A vault that has voted cannot vote again (the account already exists). A vault minted after the proposal opens cannot vote (`VaultTooNew` against `index_snapshot`). The quorum divisor is snapshotted at creation (`quorum_supply = minted_total - burned_total - bare_retired`). Vaults minted during the vote can neither vote nor raise the bar. **Sound.**

### Key changes need half of ALL live vaults

`KeyChangeNeedsHalf` requires `YES >= ceil(quorum_supply * 5000 / 10000)`, where `quorum_supply` is the snapshotted live supply, not votes cast. A guardian change and a swap-operator arm can never share a proposal (`KeyChangesBundled`). Each lands only after `notice_secs` via `apply_guardian` / `apply_swap_operator`. The guardian may cancel a pending operator (`cancel_swap_operator`) but not a pending guardian. **Sound.**

### Overtaken actions are logged no-ops

`execute_proposal` skips an older round/guardian/operator if a newer one has already executed, logging `CBOB_ACTION_SKIPPED`. A proposal of all-skips still counts as executed. A stale restart is skipped by stop time (mirroring MINT's `StopIsNewer`). **No defect.**

### Can governance be frozen forever?

If every vault is redeemed, no proposal can be created (a proposer must show a live vault). With no vaults there is nothing left to govern but sales, and immutable programs with no admin cannot be rescued (accepted limit 45). A stolen guardian key can hold sales and the sweep shut for a vote plus a week at best, and for good while fewer than half of all live vaults vote to replace it (accepted limit 47). **No worse than stated.**

---

## R5. The Charter Claim

I attacked the Merkle proof, the CPI burn, and the hot-wallet exposure.

### Proof of Burn identity by address

`pob_root` is a Merkle root of the 240 asset addresses, written once at `initialize`. `claim_charter_vault` proves the asset is a leaf (`merkle_root_from(merkle_leaf(&pob), &pob_proof) == cfg.pob_root`). Domain-separated tags (0x00 leaf, 0x01 node) and sorted pairs prevent second-preimage and reordering. A lookalike minted by the hot update authority has a different address and is not in the tree. **Sound.**

### The CPI burn

The PoB is burned by CPI into Core's `BurnV1` in the same instruction, as its owner (the signer). `pob_extra` accounts are passed through never as signers (the code clears `is_signer`). A benign or approving hook lets the claim through; a rejecting hook still refuses it (that case is the alarm's, by ruling). **Sound.**

### The hot-wallet exposure (SPEC 46)

The Giraffish Moments update authority is a hot wallet. Through the 7-day charter window it can add a plugin that rejects every charter claim (ending the project before it starts) or admits only its own Proofs of Burn (capturing the electorate). Mitigations: `claim_charter_vault` passes through external-plugin accounts so a benign hook cannot brick claims at the program level; the alarm pages on any plugin or update-authority change to the collection. After the window closes, `claim_charter_vault` refuses by clock alone and this exposure ends. **SPEC 46 is complete.** I re-read it against the code and found no omitted vector.

---

## R6. The One-Time Configuration and the Trusted Hop

### Every `initialize`

I traced every `initialize` argument through its bounds:

- SEAL: 1–3 reserve mints, each classic SPL by owner.
- MINT: `bank_treasury` ≠ default, `payment_mint` is a SEAL reserve, `max_supply` > 0, level caps non-zero and sum ≤ `max_supply`, charter window 1 s to 90 days and not already over, notice/voting/period/windows within absolute ranges, tighten bounds (`sweep_floor`, `cooldown_ceiling`, `reserve_ceiling`) self-consistent, boost bounds within `max_boost_weight`/`max_boost_epochs`, the $CBOB mint is a real initialized classic SPL mint distinct from cbBTC and $GARY.
- BURN: collection matches SEAL's, window 10 s to 24 h.
- GOV: collection matches MINT's, quorum 500–10,000 bps, threshold 5,000–7,500 bps, voting period 60 s to 30 days.

Each config is an `init` PDA (can only be created once) and signed by `INIT_AUTHORITY`. After the upgrade authority is removed, none of these can change. **No defect.**

### The trusted hop (`sweep_sol_for_swap`)

Destination pinned to `swap_operator`, cap and cooldown on chain, operator must sign, above a SOL reserve, guardian can stop. The swap is off-chain through pinned Orca/Meteora pools with a Pyth-derived floor. The operator (or a thief of its key) can keep up to `max_sweep_lamports` every `cooldown_secs` until the guardian stops it — cap × windows, never more than the revenue address holds above the reserve. **No worse than stated (accepted limit 10).**

### The 10% royalty

Installed by `initialize` as a Core collection plugin with plugin authority `None`. Core refuses every later update or removal, whoever signs. I verified the CPI (`IX_ADD_COLLECTION_PLUGIN_V1`, `PLUGIN_ROYALTIES`, `PLUGIN_AUTHORITY_NONE`) and the control-collection test (R.6, R.6a, R.6b). **Immutable in Core.**

### The redemption cap

A rolling window over a 64-slot ring of timestamps. A redemption is allowed only if the cap-th most recent redemption is at least `redeem_window_secs` old. The cap is `min(ceil(live * 210 / 10000), 64)`, floor 1. No window of that length holds more than the cap. Stage 3b's token bucket (which let 2× the cap through) is gone. **Exactly a rolling window.**

---

## R7. Cross-Program Raw Reads

I recomputed every offset and account space from the struct definitions and compared them with the pinned constants in the programs.

### MINT config (v6)

Computed layout: disc[0..8], version[8], collection[9..41], governance[41..73], pool_ata[73..105], round_id[105..109], opens_at[109..117], closes_at[117..125], price[125..133], cap[133..137], minted_this_round[137..141], minted_total[141..149], max_supply[149..157], bank_treasury[157..189], split_bps[189..191], sales_stopped[191], sweep_stopped[192], guardian[193..225], swap_operator[225..257], sol_reserve_lamports[257..265], bump[265], max_sweep_lamports[266..274], sweep_cooldown_secs[274..282], last_sweep_at[282..290], level_caps[290..310], level_minted[310..330], revealed_total[330..338], payment_mint[338..370], pob_collection[370..402], pob_root[402..434], charter_opens_at[434..442], charter_closes_at[442..450], charter_claimed[450..454], bare_burns_retired[454..462], total_active_weight[462..470], active_count[470..478], acc_scaled[478..494], owed_scaled[494..510], last_distribute_at[510..518], sales_stopped_at[518..526], sweep_stopped_at[526..534], pending_swap_operator[534..566], pending_swap_operator_at[566..574], monthly_secs[574..582], pending_guardian[582..614], pending_guardian_set[614], pending_guardian_at[615..623], notice_secs[623..631], sweep_floor_lamports[631..639], cooldown_ceiling_secs[639..647], reserve_ceiling_lamports[647..655], dist_epoch[655..663], pending_count[663..671], pending_this_epoch[671..679], cbob_mint[679..711], max_boost_weight[711], max_boost_epochs[712..714], boost_price[714..722], boost_weight[722], boost_epochs[723..725], boosts_active[725..729], boosts_due[729..733], boost_weight_total[733..741], cbob_burned_total[741..749], boost_expiring[749..1005], padding[1005..1261].

Every raw offset used by GOV and BURN matches this layout exactly (governance@41, minted_total@141, bare_retired@454, charter_closes_at@442, sales_stopped_at@518, sweep_stopped_at@526, sweep_floor@631, cooldown_ceiling@639, reserve_ceiling@647, max_boost_weight@711, max_boost_epochs@712, burned_total@42, redeem_window_secs@50, rate_head@58, rate_ring@59). **All correct.**

### VaultRecord (v4)

disc[0..8], version[8], asset[9..41], mint_index[41..49], reveal_slot[49..57], level[57], charter[58], entropy_set[59], entropy[60..92], attrs_hash[92..124], bump[124], active[125], retired[126], reschedules[127..129], vault_ata[129..161], debt_scaled[161..177], pending[177], request_epoch[178..186], boost_weight[186], boost_end_epoch[187..195], carry_scaled[195..211], padding[211..221]. GOV reads mint_index@41; the crank's `dueBoostRecords` slices bytes 125..195 and checks active@125, retired@126, boost_weight@186, boost_end_epoch@187. **All correct.**

### SealConfig (v2)

disc[0..8], version[8], collection[9..41], reserve_mints Vec (u32 len@41, then 32-byte keys), bump@141. MINT and BURN read reserves@41. **Correct.**

### BurnConfig (v4)

disc[0..8], version[8], collection[9..41], bump@41, burned_total[42..50], redeem_window_secs[50..58], rate_head[58], rate_ring[59..571], padding[571..827]. GOV reads burned_total@42. **Correct.**

### GovConfig (v4)

disc[0..8], version[8], collection[9..41], quorum_bps[41..43], threshold_bps[43..45], min_voting_secs[45..53], proposal_count[53..61], bump[61], last_round_id[62..70], last_guardian_id[70..78], last_arm_id[78..86], last_boost_id[86..94], padding[94..350]. **Correct.**

### SPL Token account (classic)

mint[0..32], owner[32..64], amount[64..72], delegate[72..108], state[108], is_native[109..117], delegated_amount[121..129], close_authority[129..165]. The sweep helper reads mint@0, owner@32, amount@64, state@108. **Correct.**

**No misread.**

---

## R8. The Suite, the Simulation, and the Build as Evidence

### Arms that cannot fail

I looked for assertions whose negative is impossible or whose `because()` pin reads the wrong arm.

- **ID.1 (unique assertion ids):** The suite greps for duplicate ids and fails if any exist. This is a real gate — a reused id would let a `because()` pin read the wrong arm's error. **Can fail, and has caught real defects (round 23 W.1).**
- **RL.S1–S6 (cap stamp model):** A self-contained model that accepts/refuses concurrent supply changes. The arms are mutually inconsistent by design (S2 refuses a crossing, S5 refuses a conflicting overwrite). **Can fail.**
- **The `because()` pins:** Each pins a specific error string to a specific arm. I spot-checked a dozen (0.1→NotTheInitAuthority, 3.1→NotTheOwner, 3.6→NoTerminalBurn, 3.7→0x9, 3.8→NoPrecedingOpen, 4.1→VaultNotEmpty, P.1→NotRevealed, P.20→ClaimBeforeBurn). Each is the error the program actually emits for that refusal. **None read the wrong arm.**

### Claims in this prompt that NO arm exercises

- "A vault that joins can share revenue that was still unsplit when it asked" (accepted limit 55): The suite does not exercise a join+split+distribute in one transaction with a funded, revealed vault at the monthly boundary. The code path exists (limit 55 accepts it) but no arm lands it. **Not exercised.**
- "Hand recovery of an open cycle" (accepted limit 10): No suite arm walks `bank/revenue.mjs`'s hand-recovery path. **Not exercised.**
- "A stranger can hand a vault a token account whose close authority they keep" (C5, round 35): The e2e (R36 gate 5 item 6) now exercises this, but the main suite does not. **Not exercised in the 895-assertion suite.**

### Program bytes proven to be the bytes the suite ran

`scripts/build-mainnet.sh` builds both the localnet and mainnet builds, deploys both to a validator, and asks each whether it trusts the test key (mainnet must reject, localnet must accept). It then `cmp`s the sweep helper's mainnet bytes against `target/deploy/cbob_vault_sweep.so` (the build the suite deployed). The four keyed programs are asked about their key, not cmp'd, because the key is folded into immediates. **The sweep helper is byte-identical; the four keyed programs are behaviourally proven.**

---

## The Four Questions About Accepted Limits

### 1. Is any limit WORSE than stated?

**No.** I re-read every accepted limit against the code. Each is accurately stated. The closest call is limit 26 (C's leader can grind): the code confirms the leader can skip its own first slot(s) and vary its block, and the measurement (one validator holding two adjacent rotations) is recorded. **Not worse.**

### 2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?

**Limit 9 (foreign Core asset detection):** The alarm's `detectNestedVaults` walks our own collection and cannot see a foreign asset. The redeem page's `judgeRedemptionCoverage` also cannot see a foreign asset (it reads token accounts by owner and Core assets by owner/collection). A foreign NFT nested in a vault is destroyed on redemption with no warning. This is **correctly stated** as a limit and is **not closed.**

**Limit 44 (undeclared airdrops destroyed):** The sweep helper now sweeps any classic SPL account the vault PDA owns when the page names it with a same-mint destination. The redeem page's coverage check names Token-2022, frozen, and unreadable-mint strays. This is **correctly stated** and the page's behaviour is consistent with the limit.

### 3. Is any DISCHARGED item not actually discharged?

**No.** I verified each discharged item:
- 1a, 1b, 2–5, 11, 15, 16, 18, 20, 21, 23, 24: The Bank key, the co-signer, the deck, the distributor — all gone from the code (`gone` arms in the suite confirm the instructions are absent).
- 14 (duplicate attributes): Closed by `DuplicateAttribute` (suite 11.4).
- 19 (unlevelled-vault halt): Closed by construction — `activate` requires `NotRevealed`, and the level is drawn on chain.
- 30 (85/15 still a vote): `update_wiring` is gone; `split_bps` is written once.
- 31 (31-day branch): The cadence is deleted; `monthly_secs` is an `initialize` value.
- 33 (operator notice): Exercised by 3c.K5 and 3c.G2.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**No.** Items 22 (dress rehearsal), 38 (launch values), 50 (holder surfaces), 52 (cbBTC accounts), 53 (rehearsal mode) are all still OPEN and are still treated as blocking. The charter date, lock deadline, and `vault_collection` are still OPEN in `launch/mainnet-init.json`, and `scripts/check-launch-params.mjs` refuses them.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

**What this project should do before launch that AI audit structurally cannot:**

1. **Run the dress rehearsal (item 22) and record the signatures.** The programs' arithmetic is proven on a local validator. The crank's live I/O against a real cluster with ~2,100 vaults, the alarm's live passes, and one full live revenue cycle through each pool (Orca forced to refuse once) are not. AI can reason about code; it cannot observe a live cluster's behaviour under load, rate limits, and transient RPC errors. The rehearsal is the only thing that can.

2. **Publish the holder surfaces (item 50) and have a real holder (not the author) perform each of the four flows on a testnet.** AI can verify that the page's transactions match the programs. It cannot verify that a holder understands the warnings, that the Phantom signing flow shows what the page built, or that a holder who ticks a box acknowledging a lost stray actually comprehends what they are losing. A human usability pass is the only thing that can.

3. **Set the charter date and lock deadline (item 38) and create the vault collection (item 52/10) with a witnessed ceremony.** The ceremony signs permanent values. AI can verify the page's checks. It cannot verify that Gary's wallet is the one that signs, that the collection's address is recorded correctly, and that no second collection is created. A witnessed, recorded ceremony with an independent check of the resulting on-chain state is the only thing that can.

4. **Rehearse the hand-recovery runbook (accepted limit 10) with the actual operator key.** AI can read the runbook. It cannot verify that the operator can execute a hand recovery under pressure without a double-swap. A tabletop exercise with the key holder is the only thing can.

5. **Take a final, independent dump of all five programs after step 9 and verify the prefix hash and zero tail, then again after step 11, and compare.** AI can verify the check exists. It cannot verify that the person running the command is not the same person who could have substituted the bytes. An independent party running `solana program dump` and comparing the sha256 is the only thing that can.

**No new CRITICAL or HIGH finding in the five programs.** The design is sound, the repairs hold, and the remaining work is operational.