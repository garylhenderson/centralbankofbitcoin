# SECURITY AUDIT — CBOB Vaults v6, Round 24

## Scope and method

I have read the four programs whole, the suite, the simulation, the design documents, the accepted limits, and the round-23 verdict. I have recomputed every cross-program offset, every account space constant, every discriminator, and traced the money paths. I have not run the code; where a claim depends on measurement, I say what measurement would confirm or refute it.

I find **no CRITICAL and no HIGH** in the programs. I find **two MEDIUM** findings, both in the boost mechanism (R2b), and several LOW findings. The accepted limits are, with two exceptions, accurately stated; the exceptions are items 25 and 26, which are **worse than stated** in ways that matter.

---

## R1. CUSTODY: CAN ANYONE BUT THE OWNER GET VALUE OUT OF A SEALED VAULT?

### The pairing

`open_for_redemption` (SEAL) walks the instructions sysvar forward from its own index, looking for a top-level `burn_vault` with the same asset at account 0 and the same owner at account 2. `burn_vault` (BURN) walks backward from its own index, looking for a top-level `open_for_redemption` with the same asset at account 0 and the same owner at account 2.

Both walks use `load_instruction_at_checked`, which reads **top-level instructions only**. A CPI wrapper cannot satisfy either half, because the wrapper's CPI is not a top-level instruction. The round-23 wrapper tests (WR.1, WR.2, WR.3) confirm this.

The discriminator constants are pinned against `sha256("global:...")` in the suite (3.1a, 3.1b). The account indices are pinned (3.1c through 3.1f). A drift fails closed: the thaw is refused, the vault stays sealed.

**I find no flaw in the pairing.**

### The emptiness proof

`burn_vault` requires:
- `asset_signer.lamports() == 0`
- `remaining_accounts.len() == declared`
- For each reserve mint, both ATA derivations (classic and Token-2022) are declared, PDA-owned, undelegated, extension-free, and empty
- No declared account is a live Core asset

The reserve list is read from the SEAL config, not kept locally. The Token-2022 refusal at config time (SEAL's `assert_classic_spl`) prevents the permanent-seal landmine.

The known gap — undeclared airdrops and nested assets are destroyed — is accepted limit 44 and proven impossibility 2. It is not a new finding.

**One observation, not a finding:** the non-reserve loop checks `d.len() >= TOKEN_ACCOUNT_LEN` before reading the owner at `d[32..64]`. A Token-2022 account with extensions has length 170, which is `>= 165`, so the owner is read correctly and the extension check (`d.len() == TOKEN_ACCOUNT_LEN`) then refuses it. This is correct.

### The rate limit

The rolling window is a ring of 64 timestamps. The cap is `ceil(live * 210 / 10_000)`, floored at 1, bounded by the ring size. The k-th most recent redemption must be at least a full window old.

The ring arithmetic: `head` is a `u8`, incremented modulo 64. The k-th most recent is at `(head + RATE_RING - k) % RATE_RING`. This is correct for `k <= RATE_RING`.

**One subtlety:** when `cap > RATE_RING` (live supply above 3,047), `k = RATE_RING`, and the check reads the oldest entry in the ring. This makes the limit **stricter**, never looser, as stated. Correct.

**I find no flaw in the rate limit.**

---

## R2. THE COMMUNITY POOL

### The invariant: pool always holds at least ceil(owed)

`credit` adds `delta * w` to `owed_scaled` where `delta = avail * ACC_SCALE / w` (integer division). So `owed_scaled` increases by at most `avail * ACC_SCALE`, and the pool balance decreases by exactly `avail`. The invariant holds.

`claim` pays whole sats, subtracts `pay * ACC_SCALE` from `owed_scaled`, and the pool balance decreases by `pay`. The invariant holds.

`retire` (redeemed or burned) subtracts `pending` from `owed_scaled` without moving pool balance. The invariant holds (it becomes stronger).

`monthly_inline` uses `balance.saturating_sub(ceil_sats(owed_scaled))` as `avail`, so it never credits more than the pool holds above what it owes. The invariant holds.

**I find no flaw in the solvency invariant.**

### The two-step activation

`activate` first call: requires level drawn, asset live, vault's cbBTC ATA holds >= 21,000 sats. Records `pending = true`, `request_epoch = dist_epoch`, increments `pending_count` and `pending_this_epoch`.

Second call (or `claim`): requires `dist_epoch > request_epoch`, then `join` sets `active = true`, `debt_scaled = weight * acc_scaled`, decrements `pending_count`.

`waiting_to_join` = `pending_count - pending_this_epoch`. This is the count of vaults that requested in an earlier epoch and are still waiting.

**One edge:** `retire` of a pending vault decrements `pending_count`, and decrements `pending_this_epoch` only if `request_epoch == dist_epoch`. If a vault requested in an earlier epoch and is retired before joining, `pending_count` decrements but `pending_this_epoch` does not. This is correct: `waiting_to_join` decreases by 1, which is right because the vault is no longer waiting.

**I find no flaw in the activation counters.**

### The JoinWaitingFirst gate

`distribute` checks `waiting_to_join(c) == 0` before crediting, on both the burn and free paths. `monthly_inline` checks it too. The gate is checked **before** any $GARY is burned on the burn path.

**One observation:** `distribute` with `w == 0` (no active vaults) takes a special path: it requires `!burn && pending_this_epoch > 0`, then ticks. This means the burn path cannot open the door when nobody has joined, which is the intended anti-first-activator-attack. Correct.

### Liveness

Can anyone make distributions impossible? The `JoinWaitingFirst` gate can be triggered by a vault that requested activation and is never joined. But joining is permissionless (`claim` or `activate` second call), so anyone can clear the gate. The crank does it automatically.

Can anyone make redemptions impossible? The rate limit queues honest holders, but that is accepted limit 32. A frozen pool forfeits the share rather than blocking (3c.F0-F3).

**I find no liveness flaw beyond the accepted limits.**

---

## R2b. THE $CBOB BOOST

### Finding B1 (MEDIUM): A boost can be bought in the same transaction as a distribution, and that distribution counts as the first of its N

The suite arm BO.21 tests exactly this: `[boost_vault, distribute]` in one transaction. The boost is bought at `dist_epoch = e`, with `end = e + N`. The distribution in the same transaction runs `advance_epoch`, so `dist_epoch` becomes `e + 1`. The boost earns from the distribution that just ran (it was active when `credit` ran, because `boost_vault` executed first).

This is **correct behavior** — the boost earns from the next distribution, and the distribution in the same transaction is the next distribution. The suite confirms it earns exactly N, not N+1.

**However, there is an asymmetry:** if the transaction is `[distribute, boost_vault]` instead, the distribution runs first (at the old weight), then the boost is bought at `dist_epoch = e + 1`, with `end = e + 1 + N`. The boost earns from the **next** distribution, not the one that just ran. This is also correct.

The asymmetry is inherent to the design and is not a flaw. The buyer can choose which order to send, and the outcome differs by one distribution. This is disclosed in the design ("a boost earns from the next distribution").

**Verdict: not a finding. The behavior is correct and tested.**

### Finding B2 (MEDIUM): The burn path has no interval, so anyone can run out every live boost for about N × 100 $GARY

This is round-23 finding F2, confirmed as MEDIUM and **accepted by Gary** ("that's part of the game theory on boosts"). It is documented in SPEC item 51 and the holder guide. It is an accepted limit, not a new finding.

**However, I note one thing the accepted limit does not state:** the attacker does not need to own any vault. They need:
1. 100 $GARY per distribution (about $8.83 each at ruling time)
2. 1 sat of cbBTC per distribution to make `avail > 0`
3. Transaction fees

The attack ends **every** live boost at once, not just the attacker's. A holder who paid for a 24-distribution boost can have it reduced to 1 distribution by a third party for about $212. This is a **griefing vector against boost buyers**, not just a game-theory consequence.

The accepted limit says "anyone can run a distribution by burning 100 $GARY whenever the pool holds something new." It does not say "anyone can shorten every other holder's boost." The holder guide says "a boost can run out sooner than you expect. That is part of the game." This is accurate but understated: it is not just "sooner than you expect," it is "at the whim of any third party with $212."

**Verdict: accepted limit, but the holder-facing copy should state the griefing vector explicitly.**

### Finding B3 (LOW): `expire_boosts` does not check that the record's asset is alive

`expire_boosts` loads records and expires due boosts without checking whether the asset is burned. A bare-burned vault with a live boost can be expired, which is correct (the boost should not block distributions). But the record's `boost_weight` is set to 0 and `boost_end_epoch` to 0, while the record is not retired. This is harmless: the record is inert for claims (it is not active), and `retire_burned` will later unschedule the boost (which is already gone).

**Wait — there is a subtle issue.** `unschedule_boost` in `expire_boost` decrements `boosts_due` or `boost_expiring[i]`. If the vault is later retired by `retire_burned`, `retire` calls `unschedule_boost` again if `r.boost_weight > 0`. But `expire_boost` already set `r.boost_weight = 0`, so `retire` does not call `unschedule_boost` again. This is correct.

**Verdict: not a finding.**

### Finding B4 (LOW): `reweigh` does not update `boost_weight_total` when called from `expire_boost`

`expire_boost` calls `unschedule_boost` (which decrements `boost_weight_total`) and then `reweigh` (which changes `r.boost_weight` and `total_active_weight` but not `boost_weight_total`). This is correct: `unschedule_boost` already removed the boost weight from `boost_weight_total`.

`boost_vault` calls `reweigh` after incrementing `boost_weight_total`. Correct.

**Verdict: not a finding.**

### Finding B5 (LOW): The boost ring's `advance_epoch` moves `boosts_due` from the ring slot, but `tick` also calls `advance_epoch`

`tick` (the empty distribution with no active vaults) calls `advance_epoch`, which moves `boost_expiring[dist_epoch % 64]` to `boosts_due`. If a boost was scheduled to end at this epoch, it becomes due even though no distribution credited anything.

Is this correct? A boost earns from distributions. An empty tick is a distribution (it advances the epoch). The boost's N distributions include empty ticks. This is consistent with the design: "a boost is N distributions, not N months."

**Verdict: not a finding, but worth noting that empty ticks count toward boost expiry.**

---

## R3. THE LEVEL DRAW

### The entropy reader

`blockhash_in_window` parses the SlotHashes sysvar defensively: checks the key, bounds the count, checks the buffer length, refuses all-zero hashes. The host unit tests cover skipped slots and malformed buffers.

`try_capture` finds A, B, C as the smallest produced slots in their windows. The window for A is `[reveal_slot, reveal_slot + MAX_SKIPPED_SLOTS]`. B and C are each `ENTROPY_GROUP_STRIDE` leader groups after the previous.

**One observation:** the comment says "A is at most `reveal_slot + MAX_SKIPPED_SLOTS`, and the window closes at `reveal_slot + REVEAL_WINDOW_SLOTS`, so A is always still there." This is true: `MAX_SKIPPED_SLOTS = 64` and `REVEAL_WINDOW_SLOTS = 300`, so A is at most 64 slots past `reveal_slot`, well within the 300-slot window. C is at most `reveal_slot + 64 + 2*4 + 64 + 2*4 + 64 = reveal_slot + 152`, also within 300. Correct.

### The FIFO

`reveal_level` requires `index == config.revealed_total`. A burned vault at the head of the queue still takes its draw (L.11), so the FIFO never stops.

### The reschedule

`reschedule_reveal` requires `now > reveal_slot + REVEAL_WINDOW_SLOTS` and `!entropy_set`. It sets `reveal_slot = now + REVEAL_LEAD_SLOTS`. The new slot does not exist yet, so nobody can choose among hashes they can already see.

**One observation:** the reschedule does not reset `entropy` to zero. But `entropy_set` is false, so the old entropy is never used. Correct.

### Accepted limit 25 is worse than stated

The accepted limit says a minter who dislikes their draw can let it lapse for a re-roll "PROVIDED no one else captures in the ~300-slot (~2 min) window." The round-22 correction notes that "traffic captures nothing unless it NAMES the record."

**What the limit does not state:** the minter can **actively prevent** capture by others. The capture instructions (`capture_entropy`, the crank on host instructions) are permissionless, but they require the SlotHashes sysvar and the vault record. The minter cannot prevent a third party from sending a capture transaction. However, the minter **can** front-run: they can compute their draw the moment the three hashes exist, and if they dislike it, they can send a `reschedule_reveal` transaction the moment the window passes. The window is 300 slots (~2 minutes), and the reschedule is permissionless. A minter who watches the chain can reschedule their own vault the instant the window lapses, before the crank or any third party captures it.

This is **not** a new finding — it is the accepted limit itself. But the limit says "a lapse needs only that nobody who names this record sends a capture." In practice, the minter can **guarantee** the lapse by rescheduling immediately when the window passes, because `reschedule_reveal` is permissionless and the minter knows exactly when the window ends. The only way to prevent this is for a third party to capture **before** the window passes, which requires them to name the record.

**The limit is accurate but understates the minter's control:** a minter who dislikes their draw can reschedule it themselves the moment the window lapses, with no need to hope for silence. The re-roll is nearly guaranteed if the minter is watching.

### Accepted limit 26 is worse than stated

The accepted limit says C's leader can grind its own block, and "every vault minted in the same slot shares the same `reveal_slot`, so the same three hashes, so C's leader biases that whole cohort at once."

**What the limit does not state:** the leader schedule is public **in advance**. A validator knows when it will be the leader for a given slot. It can therefore **time its own mints** to land in a slot where it will be C's leader. This is not a passive bias — it is an active strategy. A validator with a stake share of, say, 5% can mint vaults (or have an accomplice mint vaults) in slots where it is C's leader, and grind C's block to bias the draw for those vaults.

The limit says "a validator can time a mint (or a reschedule) to put C inside its own rotation." This is accurate. But the consequence is worse than "bias the draw within one slot's time": the validator can **choose the level** for its own vaults, within the constraints of the census. It cannot exceed the level caps, but it can ensure its vaults draw Level V (or any other level) as long as the cap for that level is not exhausted.

This is a **systematic level-selection attack**, not just a bias. The cost is the validator's stake share (it must be C's leader), and the benefit is choosing the level for every vault it mints in that slot. At a 5% stake share, a validator can expect to be C's leader for about 5% of slots, which is about 5% of mints. Over the 2,100-vault supply, that is about 105 vaults with chosen levels.

**This is worse than stated.** The accepted limit frames it as "bias the draw within one slot's time." The reality is "a validator can choose the level for its own vaults, subject to census availability, by timing mints to slots where it is C's leader."

---

## R4. GOVERNANCE

### The electorate snapshot

`create_proposal` snapshots `minted_total` and `quorum_supply = minted_total - burned_total - bare_burns_retired`. `cast_vote` requires the vault's mint index to be below `index_snapshot`. This is correct.

### The supermajority

A guardian change or swap operator arm requires YES >= 50% of the snapshotted live supply. The two can never share a proposal. Correct.

### The notice period

`arm_guardian` and `arm_swap_operator` stamp the current time. `apply_guardian` and `apply_swap_operator` require the notice to have elapsed. The guardian can cancel a pending swap operator but not a pending guardian. Correct.

### The skipped actions

`execute_proposal` skips overtaken actions and logs `CBOB_ACTION_SKIPPED`. The per-kind ordering marks (`last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`) are updated before the skip check for rounds (so an over round still supersedes older ones). Correct.

**One observation:** `last_guardian_id` and `last_arm_id` are updated **inside** the skip check, but `last_round_id` is updated **before** the over check. This asymmetry is intentional (round-23 finding F4 fix): a newer round that is already over still supersedes older ones. For guardian and arm, there is no "already over" state — a guardian change or operator arm is never time-limited. So the asymmetry is correct.

### Can governance be frozen forever?

If every vault is redeemed, no proposal can be created (accepted limit 45). If a proposal is created but never executed, it expires after 7 days. If a guardian is stolen, it can stop sales and the sweep repeatedly, but a vote can replace it (accepted limit 47).

**I find no way to freeze governance beyond the accepted limits.**

---

## R5. THE CHARTER CLAIM

### The Merkle proof

The leaf and node are domain-separated (0x00 / 0x01). Pairs are sorted. The proof is bounded at 16. The root is pinned at initialize. Correct.

### The Proof of Burn burn

The PoB is CPI-burned as its owner in the same instruction. The `pob_extra` accounts are passed through to Core's burn, never as signers. Correct.

### The hot wallet risk

The Giraffish Moments collection's update authority is a hot wallet (accepted limit 46). It can add a rejecting hook that blocks every charter claim. The alarm pages on plugin changes to the collection, but not on individual PoB assets (round-22 note).

**One observation:** the hot wallet can also **transfer** a Proof of Burn out of the collection before the window opens. The claim checks `d[33] == UA_DISC_COLLECTION` and `d[34..66] == pob_collection`. If the PoB is moved out of the collection, the claim refuses. This is the same brick class as a rejecting hook, and it is not in the accepted limit's text (round-23 F15 noted this).

**Verdict: accepted limit 46 should be widened to include moving a PoB out of the collection.**

---

## R6. THE ONE-TIME CONFIGURATION

### Initialize checks

Each `initialize` is gated on `INIT_AUTHORITY` (Gary's wallet). The cross-program checks (SEAL first, MINT checks SEAL, BURN checks SEAL, GOV checks MINT) prevent wiring divergence. The collection must be clean and unminted. The payment mint must be a SEAL reserve. The boost bounds are checked.

**One observation:** `initialize` in MINT does not check that `cbob_mint` has no mint authority and no freeze authority. The $CBOB mint was created with both None (verified on mainnet), but the `initialize` only checks that it is a classic SPL mint and not the payment mint or $GARY mint. If a future $CBOB mint were created with a mint authority, the holder of that authority could print $CBOB and boost vaults for free.

This is **not a finding** because the mint is pinned in `launch/mainnet-init.json` and verified on mainnet. But the `initialize` check is weaker than it could be. The alarm watches the mint's authorities (round-23 F6).

### The royalty

The Royalties plugin is installed with authority None. Core refuses every update and removal. The suite proves this on a control collection (R.5, R.6, R.6a). Correct.

### The redemption cap

The rolling window is a ring of 64 timestamps. The window is an `initialize` value, must be 3600 on mainnet. Correct.

---

## R7. CROSS-PROGRAM RAW READS

I recomputed every offset:

**MINT config (version 6):**
- Discriminator: 0..8
- version: 8
- collection: 9..41
- governance: 41..73
- pool_ata: 73..105
- round_id: 105..109
- opens_at: 109..117
- closes_at: 117..125
- price: 125..133
- cap: 133..137
- minted_this_round: 137..141
- minted_total: 141..149
- max_supply: 149..157
- bank_treasury: 157..189
- split_bps: 189..191
- sales_stopped: 191
- sweep_stopped: 192
- guardian: 193..225
- swap_operator: 225..257
- sol_reserve_lamports: 257..265
- bump: 265
- max_sweep_lamports: 266..274
- sweep_cooldown_secs: 274..282
- last_sweep_at: 282..290
- level_caps: 290..310
- level_minted: 310..330
- revealed_total: 330..338
- payment_mint: 338..370
- pob_collection: 370..402
- pob_root: 402..434
- charter_opens_at: 434..442
- charter_closes_at: 442..450
- charter_claimed: 450..454
- bare_burns_retired: 454..462
- total_active_weight: 462..470
- active_count: 470..478
- acc_scaled: 478..494
- owed_scaled: 494..510
- last_distribute_at: 510..518
- sales_stopped_at: 518..526
- sweep_stopped_at: 526..534
- pending_swap_operator: 534..566
- pending_swap_operator_at: 566..574
- monthly_secs: 574..582
- pending_guardian: 582..614
- pending_guardian_set: 614
- pending_guardian_at: 615..623
- notice_secs: 623..631
- sweep_floor_lamports: 631..639
- cooldown_ceiling_secs: 639..647
- reserve_ceiling_lamports: 647..655
- dist_epoch: 655..663
- pending_count: 663..671
- pending_this_epoch: 671..679
- cbob_mint: 679..711
- max_boost_weight: 711
- max_boost_epochs: 712..714
- boost_price: 714..722
- boost_weight: 722
- boost_epochs: 723..725
- boosts_active: 725..729
- boosts_due: 729..733
- boost_weight_total: 733..741
- cbob_burned_total: 741..749
- boost_expiring: 749..1005 (64 × u32)

**VaultRecord (version 4):**
- Discriminator: 0..8
- version: 8
- asset: 9..41
- mint_index: 41..49
- reveal_slot: 49..57
- level: 57
- charter: 58
- entropy_set: 59
- entropy: 60..92
- attrs_hash: 92..124
- bump: 124
- active: 125
- retired: 126
- reschedules: 127..129
- vault_ata: 129..161
- debt_scaled: 161..177
- pending: 177
- request_epoch: 178..186
- boost_weight: 186
- boost_end_epoch: 187..195
- carry_scaled: 195..211

**BurnConfig (version 4):**
- Discriminator: 0..8
- version: 8
- collection: 9..41
- bump: 41
- burned_total: 42..50
- redeem_window_secs: 50..58
- rate_head: 58
- rate_ring: 59..571 (64 × i64)

**SEAL config (version 2):**
- Discriminator: 0..8
- version: 8
- collection: 9..41
- reserve_mints: 41.. (u32 length, then keys)

**GOV config (version 4):**
- Discriminator: 0..8
- version: 8
- collection: 9..41
- quorum_bps: 41..43
- threshold_bps: 43..45
- min_voting_secs: 45..53
- proposal_count: 53..61
- bump: 61
- last_round_id: 62..70
- last_guardian_id: 70..78
- last_arm_id: 78..86
- last_boost_id: 86..94

All offsets match the constants in the programs. The GOV comment says `last_round_id` is at offset 62, but the struct has `bump` at 61 (1 byte), so `last_round_id` starts at 62. Correct.

**One observation:** the GOV comment block says "sales_stopped_at[518..526] sweep_stopped_at[526..534]" and "sweep_floor_lamports[631..639] cooldown_ceiling_secs[639..647] reserve_ceiling_lamports[647..655]". These match my computation. Correct.

**I find no offset errors.**

---

## R8. THE SUITE AND SIMULATION AS EVIDENCE

### Arms that cannot fail

I looked for arms whose negative fires for a different reason than the one named. The `because()` list pins many. I found no arm that cannot fail.

**One observation:** the suite's `ID.1` arm checks that every assertion id is unique. This is a meta-assertion that guards against the round-23 bug where a reused id made a reason pin read another arm's error. Good.

### Claims in the prompt that no arm exercises

The prompt claims "a boost earns EXACTLY its N distributions and not one more." The suite tests this in BO.10 through BO.15 and BO.21. The host unit test tests the ring wrap. I find no unexercised claim in the boost section.

The prompt claims "no record can be expired twice, early, or never." The suite tests early expiry (BO.10b) and normal expiry (BO.13a, BO.14). Expiring twice is covered by the fact that a second expiry would find `boost_weight == 0` and skip. Never expiring is covered by the `BoostsExpireFirst` gate (BO.12, BO.13).

---

## The four questions about the accepted limits

### 1. Is any limit WORSE than stated?

**Item 25 (the re-roll) is worse than stated.** The limit says a minter who dislikes their draw can let it lapse "PROVIDED no one else captures in the ~300-slot window." In practice, the minter can **guarantee** the lapse by sending `reschedule_reveal` themselves the moment the window passes. The reschedule is permissionless and the minter knows exactly when the window ends. The only way to prevent this is for a third party to capture **before** the window passes, which requires them to name the record. A minter who is watching the chain can re-roll nearly at will.

**Item 26 (the C leader grind) is worse than stated.** The limit frames it as "bias the draw within one slot's time." The reality is that a validator can **choose the level** for its own vaults by timing mints to slots where it is C's leader. The leader schedule is public in advance, so this is an active strategy, not a passive bias. At a 5% stake share, a validator can expect to choose levels for about 5% of mints, subject to census availability.

**Item 27 (dead weight) is marginally worse than stated.** The round-23 verdict noted that a boosted vault's dead weight is larger by its boost, up to +12. The accepted limit text now includes this. Correct.

**Item 55 (unsplit revenue) is worse than stated.** The round-23 verdict (F13) noted that the "about an hour" bound holds only while the splitting crank runs. During a crank stall, the unsplit balance grows without limit. The accepted limit text now includes this. Correct.

### 2. Is anything listed as a limit not actually a limit?

**Item 35 (the 10% turnout rule never binds).** At quorum 21% and threshold 51%, the smallest passing vote is 10.71% YES, which is above the 10% turnout floor. The turnout rule only matters if `initialize` is given other values. This is accurately stated.

**Item 12/17 (compute units, discharged).** The discharge says "a transaction that fits cannot run out of compute ON THE PADDED-MINT PATH." The round-23 note adds that a mint carrying the full crank of four captures is refused under the default 200,000 budget (item 54). This is accurately stated.

### 3. Is any DISCHARGED item not actually discharged?

**Item 14 (duplicate attribute keys).** The code refuses `DuplicateAttribute` in `check_attributes`. The suite tests it (11.4). Discharged.

**Item 19 (unlevelled-vault halt).** The level is drawn on chain, and `activate` refuses a vault whose level is not drawn (`NotRevealed`). There is no state in which a vault is activated but unlevelled. Discharged.

**Item 30 (85/15 ratio is a vote).** `split_bps` is written once by `initialize` and no instruction writes it again. `update_wiring` does not exist. Discharged.

**Item 31 (31-day branch).** The cadence is deleted. The free path's period is an `initialize` value, exercised in the suite. Discharged.

**Item 33 (7-day notice).** The notice is an `initialize` value, exercised in the suite. Discharged.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**Item 22 (live-chain distribution).** Still open. The dress rehearsal is step 8 in the road map. Not treated as accepted.

**Item 38 (initialize values).** Still open for the charter opening date and lock deadline. Everything else is ruled. Not treated as accepted.

**Item 50 (holder surfaces).** Still open. The redeem page is not built. Not treated as accepted.

**Item 51 ($CBOB boost).** Built and measured. The round-23 verdict confirmed the boost is built. Not treated as accepted — it is discharged by being built.

**Item 52 (pool and Squads accounts).** Still open. Road step 10 creates them. Not treated as accepted.

**Item 53 (dress rehearsal at throwaway IDs).** Addressed by the rehearsal tree script. Proven at `d57ee3a`. Not treated as accepted — it is discharged.

**Item 54 (compute at widest host shapes).** Measured. Not treated as accepted — it is discharged.

---

## Other findings

### Finding O1 (LOW): `split_revenue` is coupled to the Squads cbBTC ATA

If Coinbase freezes the CBOBTC Squads' cbBTC account, `split_revenue` fails because both transfers are in one instruction. The holders' 85% waits in the revenue address until the freeze is lifted. This is accepted limit 28 (round-23 F14), and the text now includes it. Not a new finding.

### Finding O2 (LOW): The charter claim's `pob_extra` pass-through is bounded at 8, but only 4 fit a legacy transaction in the widest shape

The round-23 verdict (F17) measured this: 4 distinct extra accounts fit a legacy transaction with a separate payer and compute-budget instructions. Eight need no separate payer and no compute-budget instructions, or a v0 transaction. The accepted limit 46 text now includes this. Not a new finding.

### Finding O3 (INFO): The GOV error message says "at most four actions" but `MAX_ACTIONS` is 5

Round-23 finding F18. The error message in `GovError::TooManyActions` says "a proposal carries at most five actions" in the code I read. Wait — let me check. The code says:

```rust
#[msg("a proposal carries at most five actions")] TooManyActions,
```

This is correct. The round-23 verdict said the message was "at most four actions" at GOV lib.rs:910. The code I read says "five." This was fixed.

### Finding O4 (LOW): The `initialize` does not check that the $CBOB mint has no mint authority

As noted in R6, the `initialize` checks that `cbob_mint` is a classic SPL mint and not the payment mint or $GARY mint, but does not check that it has no mint authority. The mint was created with mint authority None on mainnet, and the alarm watches it. But the `initialize` check is weaker than it could be. If a future $CBOB mint were created with a mint authority, the holder could print $CBOB and boost vaults for free.

**Evidence if true:** a test that initializes with a $CBOB mint that has a mint authority would be accepted by `initialize`, and the mint authority holder could mint $CBOB and boost vaults.

**Fix:** add a check in `initialize` that the $CBOB mint's mint authority is None (bytes 4..36 of the mint account are all zero).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

### What this project should do before launch that AI audit structurally cannot

1. **Run the mainnet dress rehearsal with real money, small amounts, and a human watching.** The dress rehearsal (item 22) is the only way to exercise the crank's I/O against a live cluster. AI audit cannot do this. The rehearsal must include:
   - A distribution against a live chain with at least 100 vaults
   - A redemption of a vault holding all three reserve assets
   - A charter claim with a real Proof of Burn
   - A boost purchase and expiry
   - A governance proposal from creation to execution
   - A guardian stop and a vote restart

2. **Build the redeem page before removing the upgrade authority.** Item 50 is open and blocking. The redeem page is the only preventive control for undeclared airdrops and nested vaults (items 9 and 44). Without it, a holder who redeems by any other client destroys their own property. AI audit cannot build this page.

3. **Verify the deployed bytes against the audited source.** The suite tests a binary built with `--features localnet`, which swaps in a test key for `INIT_AUTHORITY`. The shipped binary has Gary's key. `scripts/build-mainnet.sh` proves which binary carries which key by behavior, but the deployed bytes must be verified against the sha256 printed by that script. AI audit cannot do this.

4. **Have a human read the holder guide against the code.** The holder guide makes promises to holders. AI audit can check that the promises are true of the code, but a human should read it for tone, clarity, and completeness. The guide says "the Bank" in several places, which is the brand name, not the v5 key. A human should confirm this is not confusing.

5. **Prepare an incident response plan for the accepted limits.** The accepted limits are real risks. A human should decide, before launch:
   - What happens if the guardian key is stolen (item 47)
   - What happens if the swap operator key is stolen (item 10)
   - What happens if Coinbase freezes the pool (item 28)
   - What happens if the Giraffish Moments hot wallet is compromised (item 46)
   - What happens if a validator systematically chooses levels for its own vaults (item 26, worse than stated)
   - What happens if a third party runs out every live boost (item 51, the griefing vector)

6. **Consider whether the level-selection attack (item 26, worse than stated) is acceptable.** A validator with a 5% stake share can choose levels for about 5% of mints. Over 2,100 vaults, that is about 105 vaults with chosen levels. If the validator chooses Level V for all of them, it captures 105 of the 105 Level V slots, leaving none for honest minters. This is a **systematic capture of the highest tier** by a single validator. The accepted limit frames it as a bias; it is actually a capture. Gary should decide whether this is acceptable before launch.

7. **Consider whether the boost griefing vector (item 51) is acceptable.** A third party with about $212 can end every live boost at once. A holder who paid for a 24-distribution boost can have it reduced to 1 distribution. The holder guide says "a boost can run out sooner than you expect. That is part of the game." This is accurate but understated. Gary should decide whether the burn path needs a minimum interval.

---

## Summary of findings

| # | Severity | Finding |
|---|---|---|
| B2 | MEDIUM | The burn path has no interval, so anyone can run out every live boost for about N × 100 $GARY. This is accepted (item 51), but the griefing vector against boost buyers is understated in the holder copy. |
| O4 | LOW | `initialize` does not check that the $CBOB mint has no mint authority. The mint is verified on mainnet, but the check is weaker than it could be. |
| — | — | Accepted limit 25 is worse than stated: a minter can guarantee a re-roll by rescheduling their own vault the moment the window passes. |
| — | — | Accepted limit 26 is worse than stated: a validator can systematically choose levels for its own vaults by timing mints to slots where it is C's leader, capturing up to its stake share of the highest tier. |
| — | — | Accepted limit 46 should be widened to include moving a Proof of Burn out of the collection. |

**No CRITICAL or HIGH findings. The programs' core mechanics — the seal, the pairing, the emptiness proof, the pool solvency, the activation counters, the governance snapshot, the Merkle proof, the cross-program offsets — all hold.**