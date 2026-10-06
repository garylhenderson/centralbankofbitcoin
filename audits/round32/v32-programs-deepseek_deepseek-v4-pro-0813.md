# Independent Security Audit — CBOB Vaults v6, Round 32

## R0. Round 31's Verdict and Repairs

Round 31's verdict is NOT CLEAN with one LOW (coverage gate quorum check) and two INFO findings. The repairs in `4ae79d6` are present in this tree:

- **L1 (programs):** `scripts/audit-coverage.sh` now requires the exact headline `# Round N, FOCUS pass: [NOT ]CLEAN; QUORUM MET` on line 1 of the verdict. The selftest has 8 both-ways cases. **Verified present** at lines 136-143 of the script.
- **D1:** The round-32 prompt names round 31. **Verified** in the prompt text.
- **D2:** The probe's usage line now names itself. **Verified** at `scripts/probe-mainnet-facts.mjs:28`.

The round-31 validation claims 901/901 detector, 855/855 on-chain, and all other floors passing. I cannot independently re-run the full suite in this environment, but the repair code is present and the logic is sound.

**No surviving defect from round 31 found.**

---

## R1. Custody: Can Anyone But the Owner Get Value Out of a Sealed Vault?

### R1.1 The Open/Burn Pairing

SEAL's `open_for_redemption` walks the instructions sysvar looking for a matching `burn_vault` **after** the current instruction. BURN's `burn_vault` walks looking for a matching `open_for_redemption` **before** the current instruction. Both bind asset (account 0) and owner (account 2).

**Attack surface: CPI wrappers.** The suite's WR.1-WR.4 arms test a generic CPI forwarder. The key insight is that `load_instruction_at_checked` sees **top-level instructions only**. A wrapped `open_for_redemption` reports the wrapper's instruction index, so SEAL's walk starts from the wrapper's index and looks for a top-level burn after it. A wrapped `burn_vault` reports the wrapper's index, so BURN's walk looks for a top-level open before the wrapper.

**Finding: None.** The pairing is sound. The stack-height check in `retire_redeemed` (`get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1`) correctly refuses a CPI from a wrapper.

### R1.2 The Emptiness Proof

BURN's `burn_vault` requires:
1. `asset_signer.lamports() == 0`
2. Every reserve mint's ATA (both token programs) declared, PDA-owned, undelegated, extension-free, empty
3. No declared account is a live Core asset
4. `declared` count matches `remaining_accounts.len()`

**Finding: None.** The proof is as complete as the chain allows. The known gap (undeclared accounts) is accepted limit 44.

### R1.3 The Sweep Helper (R1s)

The sweep helper is a native program with no key. Its access control is entirely Core's `ExecuteV1` authority rule.

**(a) Access control.** The helper requires `signer.is_signer`. Called directly, nobody can sign for the asset-signer PDA. Through Core, only the asset's owner can approve Execute (measured SR.5, SR.5a, SR.5c). The collection update authority is MINT's off-curve PDA (SR.5b), which cannot sign. The AgentIdentity route is refused even to a keypair update authority (R24.1c).

**Finding: None.**

**(b) Pair list.** The helper checks:
- Source is owned by the signer (the asset-signer PDA)
- Destination is owned by the ONE destination wallet
- Destination mint matches source mint

**Duplicate source:** SR.12a tests this. The first pair closes the source, the second pair's `read_token` on the closed account fails with `IllegalOwner` (the account no longer exists or is system-owned). The suite's `because('SR.12a', 'Provided owner is not allowed')` pins this.

**Source as destination:** SR.10 tests `signer.key == dest.key` refusal.

**Native wSOL account:** The helper reads only 165-byte classic SPL accounts. A wSOL account is 165 bytes and owned by Tokenkeg, so it would be swept like any other classic token account. This is correct behavior.

**Delegate or close authority on source:** The helper does not check for delegates. The SPL Token program's `Transfer` instruction checks the authority (the signer, which is the PDA), not delegates. A delegate on the source does not block the transfer. The `CloseAccount` instruction also checks the authority. **This is not a vulnerability** — the PDA is the owner and can transfer regardless of delegates.

**Frozen source:** SR.14 tests this. The transfer fails, the whole redemption reverts.

**Destination not an ATA:** The helper checks only owner and mint, not ATA-ness. A non-ATA token account owned by the destination wallet with the same mint would be accepted. **This is not a vulnerability** — the destination is chosen by the owner, and the helper's job is to move value to the owner's chosen account.

**Destination wallet is another vault's asset-signer:** The helper refuses only `signer.key == dest.key`. A destination that is another vault's asset-signer PDA would be accepted if the transaction builder names it. **This is not a vulnerability** — the owner chooses the destination, and sending their own funds to another vault's PDA is their choice (though it would brick those funds).

**Odd or zero-pair account list:** SR.7 tests odd count refusal. SR.13 tests zero pairs (lamports-only sweep).

**Finding: None.**

**(c) Destination checks.** The destination wallet is chosen by the transaction builder. Given (a), only the owner can drive the helper through Core, so the destination is the owner's choice. The lamport transfer to a below-rent destination that doesn't exist would fail (W10 in round 31 confirmed this). The canonical destination is the owner, who pays the fee and exists.

**Finding: None.**

**(d) Lamport sweep.** The helper reads `signer.lamports()` at execution and transfers all of it. BURN's `lamports == 0` check runs after the sweep in the same transaction. Nothing can deposit between the sweep and the burn within one transaction.

**Finding: None.**

**(e) Interaction with BURN's emptiness proof.** The helper closes what it empties. BURN's reserve loop skips accounts no token program owns (`if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }`). A closed account is system-owned, so it's skipped. **This is correct.**

**Missing reserve ATA:** SPEC's REDEEMING step 1 says the page creates missing reserve accounts in a prior transaction. A stranger can create a classic ATA for any owner permissionlessly. If the page creates the account in a prior transaction, the stranger's deposit lands in that account, and the sweep moves it. **This is sufficient.**

**Token-2022 ATA for a classic mint:** The probe (F4.2) measured that this is refused by the ATA program. **Not a vulnerability.**

**Non-ATA token account:** A stranger can create a non-ATA token account owned by the vault's PDA. The sweep helper can name it (it checks owner, mint, length — not ATA-ness). BURN's second loop would also check it if declared. **This is covered by the sweep helper's ability to sweep any classic token account.**

**Nested Core asset:** The sweep helper cannot move Core assets. BURN refuses declared nested assets. Undeclared nested assets are destroyed (accepted limit 44).

**Finding: None.**

**(f) Does it fit?** S8.0 measures 1,061 bytes for the three-asset redemption through the helper, claim included. With compute-budget instructions (+52) and a separate fee payer (+96), it's about 1,209 bytes, under the 1,232 limit. A fourth reserve would not fit (accepted limit 42).

**Finding: None.**

**(g) Evidence.** SR.0-SR.4a and S8.* are present. The helper is deployed from the same bytes `scripts/build-mainnet.sh` proves (the sweep helper has no localnet feature, so its bytes are identical between builds).

**Finding: None.**

---

## R2. The Community Pool's Money

### R2.1 The Invariant "pool always holds at least ceil(owed)"

The invariant is enforced by:
- `distribute` refuses `PoolShort` when `balance < owed`
- `monthly_inline` computes `avail = balance.saturating_sub(ceil_sats(owed_scaled))` and credits only `avail`
- `claim` pays from the pool, reducing `owed_scaled` by exactly what was paid

**Attack: Can `owed_scaled` exceed the pool balance?**

`credit()` adds `delta * w` to `owed_scaled` where `delta = avail * ACC_SCALE / w`. So `owed_scaled` increases by `floor(avail * ACC_SCALE / w) * w`, which is at most `avail * ACC_SCALE`. The pool balance decreases by `avail` (the amount credited). So the pool always holds at least what it owes, minus the dust that was already there.

**Attack: Can a claim pay more than the pool holds?**

`claim` pays `pay = pending / ACC_SCALE` per vault. The sum of all `pending` values is `owed_scaled` (proven by the ledger check in the suite). The pool holds at least `ceil(owed_scaled / ACC_SCALE)`. So the sum of all `pay` values is at most `ceil(owed_scaled / ACC_SCALE)`, which the pool holds.

**Finding: None.** The invariant holds.

### R2.2 Counters Under Every Ordering

The counters are:
- `pending_count`: vaults that requested activation and haven't joined
- `pending_this_epoch`: of those, requested in the current epoch
- `active_count`: joined vaults
- `total_active_weight`: sum of weights of joined vaults

**Attack: Can `pending_count` underflow?**

`retire()` decrements `pending_count` only if `r.pending` is true. A vault can be pending only once (the `activate` first call sets it, the second call joins it or refuses `ActivationPending`). So `pending_count` is decremented at most once per vault.

**Attack: Can `pending_this_epoch` underflow?**

`retire()` decrements `pending_this_epoch` only if `r.request_epoch == c.dist_epoch`. A vault's `request_epoch` is set once when it requests. If the epoch has advanced, the vault is no longer in `pending_this_epoch`. So the decrement is correct.

**Attack: Can `active_count` underflow?**

`retire()` decrements `active_count` only if `r.active` is true. A vault can be active only once (join sets it, retire clears it). So the decrement is correct.

**Finding: None.**

### R2.3 Liveness

**Can anyone make distributions impossible?**

The `JoinWaitingFirst` gate refuses distributions while eligible vaults wait. Joining is permissionless and free (`claim` with the vault's record). So anyone can unblock the gate.

The `BoostsExpireFirst` gate refuses distributions while boosts are due. Expiring is permissionless and free (`expire_boosts` or `claim`). So anyone can unblock the gate.

**Can anyone make redemptions impossible?**

A frozen pool forfeits the share (3c.F2). A frozen vault account blocks that vault's redemption (accepted limit 28). The rate limit queues but doesn't block permanently.

**Finding: None.**

---

## R2b. The $CBOB Boost

### R2b.1 Exact N Distributions

A boost bought at epoch `e` ends at `e + N`. The `advance_epoch` function moves `boost_expiring[end % 64]` to `boosts_due` when `dist_epoch` reaches `end`. The `BoostsExpireFirst` gate refuses any distribution while `boosts_due > 0`.

**Attack: Can a boost earn N+1 distributions?**

The boost earns during distributions at epochs `e+1` through `e+N` (N distributions). At epoch `e+N`, the boost becomes due. The next distribution (epoch `e+N+1`) is refused until the boost is expired. Expiry calls `reweigh(c, r, 0)`, which removes the boost weight. So the boost cannot earn at epoch `e+N+1`.

**Attack: Can a boost earn fewer than N distributions?**

If the vault is retired before the boost ends, `unschedule_boost` removes it from the ring. The boost earned fewer than N distributions, but the vault is gone, so this is correct.

**Finding: None.**

### R2b.2 Nothing Lost or Gained on Weight Change

`reweigh()`:
1. Computes `owed = owed_of(r, acc)` (what the vault is owed now)
2. Sets `r.boost_weight = boost`
3. Sets `r.carry_scaled = owed`
4. Sets `r.debt_scaled = weight_of(r) * acc` (new weight)
5. Adjusts `total_active_weight` by the difference

After reweigh, `owed_of(r, acc) = weight_of(r) * acc + carry_scaled - debt_scaled = new_weight * acc + owed - new_weight * acc = owed`. So the owed amount is preserved exactly.

**Finding: None.**

### R2b.3 Ring Agreement

The host test `the_boost_ring_wraps_exactly_against_a_model` drives 1000 epochs with random buys and expiries, checking `ring + due == active` at every step. The N1 test drives 260 epochs through the program's own functions. Both pass.

**Finding: None.**

### R2b.4 No Record Expired Twice, Early, or Never

- **Twice:** `expire_boost` requires `boost_weight > 0`. After expiry, `boost_weight` is 0, so a second expiry is refused (`BoostNotDue`).
- **Early:** `expire_boost` requires `dist_epoch >= boost_end_epoch`. The `BoostsExpireFirst` gate ensures no distribution runs past a due boost, so the accumulator is exactly where the boost's last distribution left it.
- **Never:** The `BoostsExpireFirst` gate refuses distributions while boosts are due. `expire_boosts` is permissionless and needs only the vault records. The crank expires due boosts every pass.

**Finding: None.**

### R2b.5 Nobody Can Make Distributions Impossible by Boosting

A boost makes distributions impossible only while it's due. Expiry is permissionless. A vault whose token account is gone can still be expired via `expire_boosts` (which needs only the record, not the token account).

**Finding: None.**

---

## R3. The Level Draw

### R3.1 SlotHashes Parse

`blockhash_in_window`:
- Checks the account key is the SlotHashes sysvar
- Checks `data.len() >= 8`
- Reads count, checks `count <= 512`
- Checks `data.len() >= 8 + count * 40`
- Iterates entries, finds the smallest slot in `[want, want + 64]`
- Refuses all-zero hashes

**Finding: None.** The parse is defensive.

### R3.2 Skipped-Slot Handling

The host test `the_lookup_takes_the_smallest_produced_slot_in_the_window` covers skipped slots. The `try_capture` function uses the smallest produced slot in the window, which is deterministic.

**Finding: None.**

### R3.3 FIFO

`reveal_level` requires `index == config.revealed_total`. This enforces strict mint order.

**Finding: None.**

### R3.4 Burned Vault at Head of Queue

`reveal_level` checks if the asset is burned (Core-owned, 1 byte, key 0). If burned, it skips the Core `UpdatePluginV1` but still advances `revealed_total` and assigns a level. L.11 tests this.

**Finding: None.**

### R3.5 Attribute Re-supply Hash

`reveal_level` hashes the re-supplied attributes and compares to `attrs_hash` stored at mint. A mismatch refuses (`AttributesMismatch`).

**Finding: None.**

### R3.6 What a Minter, Crank Operator, or Slot Leader Can Influence

- **Minter:** Can choose the asset keypair (mixes into the hash) but cannot see the slot hashes at signing time. Can decline to capture for a re-roll (accepted limit 25).
- **Crank operator:** Can withhold captures (accepted limit 25). Cannot choose the order of reveals (FIFO).
- **Slot leader:** C's leader can grind its block (accepted limit 26). This is the known residual.

**Finding: None beyond accepted limits.**

---

## R4. Governance

### R4.1 Minority Carrying What It Should Not

The key-change rule requires YES from half of ALL live vaults (snapshotted at creation). The `KeyChangeNeedsHalf` check is in `execute_proposal`. The `KeyChangesBundled` check refuses a guardian change and operator arm in the same proposal.

**Attack: Can a minority pass a key change?**

The check is `p.yes >= ceil(quorum_supply * 5000 / 10000)`. This is half of the snapshotted live supply. A minority cannot reach this.

**Attack: Can vaults minted during the vote raise the bar?**

No — the divisor is the snapshot, not live supply at execution. Vaults minted during the vote cannot vote (`VaultTooNew`) and don't raise the bar.

**Finding: None.**

### R4.2 Vote Reaching Money It Should Not

The `ProposalAction` enum has exactly five variants: `SetRound`, `Brakes`, `TightenSweep`, `ArmSwapOperator`, `SetBoostTerms`. None of these can touch the split, destinations, max_supply, or royalty.

**Finding: None.**

### R4.3 Governance Frozen Forever

SPEC 47 states the stolen guardian key scenario. The cure is a vote with half of all live vaults. If turnout is below that, the stop is permanent. This is accepted.

**Is it worse?** The guardian can also cancel a pending swap operator. A stolen guardian key can:
1. Stop sales and sweep
2. Cancel any pending swap operator
3. Re-stop after every restart vote

But it cannot:
- Touch vaults, payouts, or rules
- Block its own replacement (the guardian has no instruction to cancel a pending guardian)

**Finding: None beyond accepted limit 47.**

---

## R5. The Charter Claim

### R5.1 Proof of Burn Verification

`claim_charter_vault`:
- Checks the PoB is a Core asset in the PoB collection
- Checks the owner matches the signer
- Checks the Merkle proof against `pob_root`
- CPI-burns the PoB as its owner

**Attack: Can the hot wallet capture governance?**

Accepted limit 46 covers this. The hot wallet can add a rejecting plugin to block claims or an approving plugin to admit only its own PoBs. This is accepted.

**Is SPEC 46 complete?** It states:
1. The hot wallet can end the project before it starts
2. The hot wallet can capture governance
3. The alarm watches the collection but not individual assets
4. The alarm samples state (30-minute blind spot)
5. The hot wallet cannot transfer or burn individual PoBs

**Finding: None.** SPEC 46 is complete.

---

## R6. One-Time Configuration and the Trusted Hop

### R6.1 Initialize Values

Each `initialize` checks its inputs:
- SEAL: reserve mints are classic SPL, 1-3 mints
- MINT: collection clean, SEAL wiring, payment mint is a reserve, boost bounds, charter window, notice, tighten bounds
- BURN: SEAL wiring, redeem window
- GOV: MINT wiring, quorum/threshold/voting period

**Finding: None.** The checks are comprehensive. The launch checker (`scripts/check-launch-params.mjs`) validates the JSON before signing.

### R6.2 Swap Operator Worst Case

The swap operator can sweep at most `max_sweep_lamports` per `sweep_cooldown_secs`. At launch: 10 SOL per 6 hours. The guardian can stop the sweep instantly. A vote can only tighten the bounds.

**Finding: None.**

### R6.3 Royalty Immutability

The Royalties plugin is installed with authority `None`. Core refuses any update or removal. R.5-R.6c test this both ways.

**Finding: None.**

### R6.4 Redemption Cap

The rolling window is a 64-slot ring of timestamps. The cap is `ceil(live * 210 / 10000)`, floored at 1. The k-th most recent redemption must be at least a full window old.

**Attack: Can the ring be manipulated?**

The ring is written only by `burn_vault`, which is rate-limited. The head advances by 1 per redemption. The k-th most recent is computed as `ring[(head + RATE_RING - k) % RATE_RING]`.

**Finding: None.** The ring is correct.

---

## R7. Cross-Program Raw Reads

I recomputed every offset:

**SEAL Config (version 2):**
- Discriminator: 8 bytes
- version: offset 8
- collection: offset 9 (32 bytes)
- reserve_mints: offset 41 (u32 length, then keys)

**MINT Config (version 6):**
- Discriminator: 8 bytes
- version: offset 8
- collection: offset 9
- governance: offset 41
- pool_ata: offset 73
- round_id: offset 105
- opens_at: offset 109
- closes_at: offset 117
- price: offset 125
- cap: offset 133
- minted_this_round: offset 137
- minted_total: offset 141
- max_supply: offset 149
- bank_treasury: offset 157
- split_bps: offset 189
- sales_stopped: offset 191
- sweep_stopped: offset 192
- guardian: offset 193
- swap_operator: offset 225
- sol_reserve_lamports: offset 257
- bump: offset 265
- max_sweep_lamports: offset 266
- sweep_cooldown_secs: offset 274
- last_sweep_at: offset 282
- level_caps: offset 290 (5 × u32 = 20 bytes)
- level_minted: offset 310 (5 × u32 = 20 bytes)
- revealed_total: offset 330
- payment_mint: offset 338
- pob_collection: offset 370
- pob_root: offset 402
- charter_opens_at: offset 434
- charter_closes_at: offset 442
- charter_claimed: offset 450
- bare_burns_retired: offset 454
- total_active_weight: offset 462
- active_count: offset 470
- acc_scaled: offset 478 (u128 = 16 bytes)
- owed_scaled: offset 494 (u128 = 16 bytes)
- last_distribute_at: offset 510
- sales_stopped_at: offset 518
- sweep_stopped_at: offset 526
- pending_swap_operator: offset 534
- pending_swap_operator_at: offset 566
- monthly_secs: offset 574
- pending_guardian: offset 582
- pending_guardian_set: offset 614
- pending_guardian_at: offset 615
- notice_secs: offset 623
- sweep_floor_lamports: offset 631
- cooldown_ceiling_secs: offset 639
- reserve_ceiling_lamports: offset 647
- dist_epoch: offset 655
- pending_count: offset 663
- pending_this_epoch: offset 671
- cbob_mint: offset 679
- max_boost_weight: offset 711
- max_boost_epochs: offset 712
- boost_price: offset 714
- boost_weight: offset 722
- boost_epochs: offset 723
- boosts_active: offset 725
- boosts_due: offset 729
- boost_weight_total: offset 733
- cbob_burned_total: offset 741
- boost_expiring: offset 749 (64 × u32 = 256 bytes)

**VaultRecord (version 4):**
- Discriminator: 8 bytes
- version: offset 8
- asset: offset 9
- mint_index: offset 41
- reveal_slot: offset 49
- level: offset 57
- charter: offset 58
- entropy_set: offset 59
- entropy: offset 60 (32 bytes)
- attrs_hash: offset 92 (32 bytes)
- bump: offset 124
- active: offset 125
- retired: offset 126
- reschedules: offset 127 (u16)
- vault_ata: offset 129
- debt_scaled: offset 161 (u128 = 16 bytes)
- pending: offset 177
- request_epoch: offset 178
- boost_weight: offset 186
- boost_end_epoch: offset 187
- carry_scaled: offset 195 (u128 = 16 bytes)

**BURN Config (version 4):**
- Discriminator: 8 bytes
- version: offset 8
- collection: offset 9
- bump: offset 41
- burned_total: offset 42
- redeem_window_secs: offset 50
- rate_head: offset 58
- rate_ring: offset 59 (64 × i64 = 512 bytes)

**GOV Config (version 4):**
- Discriminator: 8 bytes
- version: offset 8
- collection: offset 9
- quorum_bps: offset 41
- threshold_bps: offset 43
- min_voting_secs: offset 45
- proposal_count: offset 53
- bump: offset 61
- last_round_id: offset 62
- last_guardian_id: offset 70
- last_arm_id: offset 78
- last_boost_id: offset 86

**Finding: None.** All offsets match the struct definitions and the constants in the programs.

---

## R8. The Suite, Simulation, and Build as Evidence

### R8.1 Arms That Cannot Fail

I looked for arms where the negative fires for a different reason than named:

- **C.2** (`claim` succeeds): If the claim fails, the helper throws and the suite exits non-zero. The floor check catches this. Not vacuous.
- **2.1** (`mkVault` succeeds): Same — if the mint fails, the helper throws.
- **X.7** (crank plans no reveal): The suite explicitly says "with every level drawn, the crank plans NO reveal" and checks `ord.length === 0`. This is a true statement about the state, not a vacuous pass.

**Finding: None.**

### R8.2 Claims in the Prompt No Arm Exercises

The prompt claims "901 off-chain detector assertions" and "39 allocation" and "47 launch-value" and "6 host unit tests" and "33 against live mainnet" and "4 expiry-budget". The floors in `run-tests.sh` enforce these counts. I cannot verify the actual counts without running the suite, but the floors are present.

**Finding: None.**

### R8.3 Program Bytes Proven

`scripts/build-mainnet.sh` proves:
- The sweep helper's mainnet bytes are identical to the tested localnet bytes
- The four keyed programs' mainnet builds reject the test key, localnet builds accept it
- The source names Gary's wallet as INIT_AUTHORITY

**Finding: None.**

---

## Accepted Limits: The Four Questions

### 1. Is any limit WORSE than stated?

**Limit 28 (Coinbase freeze):** The limit says a frozen vault account blocks that vault's WHOLE redemption. This is true — BURN requires every reserve account empty, and a frozen account cannot be emptied. The limit also says a frozen pool stops every claim that pays. This is true. The limit says a redemption with the pool frozen forfeits the share. This is true (3c.F2).

**Limit 47 (stolen guardian):** The limit says the stop can be permanent at low turnout. This is true. Is it worse? The guardian can also cancel a pending swap operator, which means a stolen guardian key can prevent a replacement operator from ever landing. But the guardian cannot cancel its own replacement. So the permanent stop is limited to sales and sweep, not to governance itself.

**Finding: None worse than stated.**

### 2. Is anything listed as a limit not actually a limit?

**Limit 35 (10% turnout never binds):** At quorum 21% and threshold 51%, the minimum YES is 10.71%, which exceeds the 10% turnout floor. The turnout rule only matters if `initialize` is given other values. This is correctly stated as a limit that doesn't bind at the ruled numbers.

**Finding: None.**

### 3. Is any DISCHARGED item not actually discharged?

**Item 14 (duplicate attribute keys):** The code refuses `DuplicateAttribute` in `check_attributes`. Discharged correctly.

**Item 19 (unlevelled vault halt):** `activate` refuses `NotRevealed`. There is no state where a vault is activated but unlevelled. Discharged correctly.

**Item 51 ($CBOB boost):** Built and measured. Discharged correctly.

**Item 54 (compute units):** Measured. Discharged correctly.

**Finding: None.**

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**Item 22 (live distribution):** Still OPEN. The dress rehearsal is not started. Not being treated as accepted.

**Item 38 (initialize values):** Still OPEN (charter opening date and lock deadline). Not being treated as accepted.

**Item 50 (holder surfaces):** Still OPEN. The redeem page is not built. Not being treated as accepted.

**Item 52 (cbBTC accounts):** Still OPEN. Road step 10 creates them. Not being treated as accepted.

**Item 53 (rehearsal tree):** Still OPEN. The re-proof at the release commit is pending. Not being treated as accepted.

**Finding: None.**

---

## New Findings

### Finding 1: LOW — `expire_boosts` Does Not Check the Asset Is Alive

**File:** `programs/cbob-vault-mint/src/lib.rs`, `expire_boosts`

**Construct:** The `expire_boosts` instruction loads vault records from remaining accounts and expires due boosts. It does not check that the asset is alive (not burned).

**What an attacker gains:** Nothing directly. A bare-burned vault with a due boost can be expired, which is correct behavior (the boost should be removed from the schedule). The `retire_burned` instruction also handles this. The only difference is that `expire_boosts` removes the boost weight but leaves the vault active, while `retire_burned` removes both. A bare-burned vault with an expired boost still has its level weight in `total_active_weight` until someone calls `retire_burned`. This is the same as accepted limit 27 (dead weight between bare burn and retirement).

**Evidence:** The crank retires bare burns before expiring boosts (red-team 3 finding 6). The alarm detects bare burns. The window is small.

**Fix:** None needed. This is covered by accepted limit 27.

### Finding 2: INFO — `claim` Does Not Check the Asset Is Alive for Active Vaults

**File:** `programs/cbob-vault-mint/src/lib.rs`, `claim`

**Construct:** The `claim` instruction pays active vaults without checking that the asset is alive. A bare-burned vault that hasn't been retired yet can be paid into its cbBTC account, where nothing can sign for it.

**What an attacker gains:** Nothing. The owner who bare-burned their vault loses their share. The share is destroyed (sent to an unreachable account). This is accepted limit 27.

**Evidence:** The crank retires bare burns before claiming. The window is small.

**Fix:** None needed. This is covered by accepted limit 27.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

### What should this project do before launch that AI audit structurally cannot?

1. **Run the dress rehearsal with real money.** The AI audit cannot exercise the crank, alarm, and revenue cycle against a live cluster. Item 22's named pass/fail items must be executed, including one full revenue cycle through both pools and one forced post-sweep failure recovered by hand.

2. **Build the holder surfaces before the lock.** The redeem page, deposit-address page, and redemption poster are promised to holders. The AI audit cannot build them. Item 50 is OPEN AND BLOCKING.

3. **Have a human read the holder guide against the code.** The AI audit can check specific claims, but a human reading the guide end-to-end against the deployed programs would catch promises that don't match reality. The guide is the source for the website, claim page, and redeem page.

4. **Verify the deployed bytes independently.** The AI audit can check that `build-mainnet.sh` proves the right key, but it cannot verify that the bytes deployed to mainnet are the bytes the script produced. A human should deploy, verify the sha256, and remove the upgrade authority.

5. **Run the charter window with a human watching.** The 7-day charter window is the only time the hot wallet can end the project or capture governance. A human should watch the alarm during this window and be ready to respond.

6. **Consider a bug bounty before the lock.** The AI audit has found no CRITICAL or HIGH in this round, but the programs will be immutable. A public bug bounty before the lock would attract human auditors who might find something the AI missed.

7. **Document the operational runbook.** The AI audit can check that the code matches the docs, but it cannot write the runbook for a stolen guardian key, a frozen pool, a Core upgrade, or a swap operator compromise. A human should write and test these procedures.

8. **Re-run the rehearsal tree at the release commit.** Item 53 requires the full `run-tests.sh` to pass inside the rehearsal tree at throwaway IDs. This is a mechanical step that must be done at the release commit.

9. **Verify the Proof of Burn set on mainnet immediately before the charter window opens.** The PoB set is pinned by address, but the hot wallet could add a plugin to individual assets (which the alarm doesn't watch). A human should verify the collection state before the window opens.

10. **Have a human sign the initialize transactions.** The launch checker validates the JSON, not the signed transaction. A human should build the transactions from the JSON and verify each field before signing.