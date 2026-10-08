I'll work through the v6 tree systematically by target, then the four questions on accepted limits. Given the scope, I'll be selective where the suite, sim, and prior verdicts already provide verified evidence, and concentrate independent effort on paths the prior rounds had less coverage of.

---

## R0. Round 39's verdict and its repairs

I'll re-verify each confirmed finding at its site and re-test the rejected claims before re-reporting.

**V39-1 (MEDIUM):** Verified at `web/src/lib/plan-redeem.mjs:236-241` — `known` is built from `helperStrays`/`transferStrays` at `:215-216` and checked by `aboutKnown` at `:246`. The repair (per round 39's VALIDATION) is to re-read `known` by address at the press. The current code at `reads.mjs:88-92` only re-reads by address the three reserve ATAs plus the first `PROMISED_MAX=100` of `promised`. With `promised` empty (the default in `freshPlan`), any stray past the 200-account full read is genuinely lost. Confirmed defect; site and not programs.

**V39-2 (LOW):** Verified at `web/src/lib/plan-redeem.mjs:213` and the optional-rescue group at `:177-180` — the optional rescue happens as one prior transaction, but only if `s.noPrior` is false; with `noPrior=true` (the press re-plan) it becomes a *noted press-info* line, and the nested CBOB vault still triggers the `refuse.push` at `:213` if it lands between the check and the press. The repair is to make this never refuse. Confirmed defect; site.

Both repairs are confined to `web/` and the offline test harness, with no program code changes. Round 39's other 19 claim groups are either re-disprovals of W1/W2/W3 (which I confirmed by reading `bank/txread.mjs:59`, `tests/3prog.test.ts:1740-1745` for delegate-Transfer, and `HOLDER-GUIDE.md:238-246`) or are documentation/measurement gaps (A1A11) I agree with.

The web pages and their pages are otherwise consistent: every transaction the page builds in `web/src/lib/ix.mjs` is byte-identical to the corresponding `tests/3prog.test.ts` builder, and the rpc-proxy allowlist in `web/deploy/rpc-proxy.mjs` is tight (only the 8 exact `getProgramAccounts` shapes, plus the 3 shapes for the pages that don't carry a CBOB program). The shape-based `gpaShape` function rejects 1-byte, empty, or base64 `dataSlice` filters that would match all Core, and the 8-MB streaming cap with an explicit abort prevents a single huge response from pinning the alarm.

---

## R1. Custody and the seal

Walking `programs/cbob-vaults/src/lib.rs` and `programs/cbob-vault-burn/src/lib.rs`:

- `open_for_redemption` (seal:78-103) walks the instructions sysvar with `load_instruction_at_checked` and refuses unless it finds `cbob_vault_burn::burn_vault` with the same `BURN_IX_ASSET_IDX=0` and `BURN_IX_OWNER_IDX=2` later in the transaction. Top-level only — `load_instruction_at_checked` returns an error for inner ixs. So a wrapper cannot satisfy the matching condition. (BURN mirrors at `burn/src/lib.rs:101-118`.)
- The Open↔Burn coupling is symmetric and binds both asset and owner; a stale or mis-located burn_vault with the right discriminator still fails the `accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(asset)` check. No instruction exists anywhere in the four programs + helper that can change the seal, empty the vault, or move the asset-signer PDA's lamports after the burn, except `rescue_nested` (move the *whole vault*, never its contents) and the sweep helper (which Core signs only for the asset's owner).
- BURN's emptiness proof reads SEAL's reserve list directly (`burn/src/lib.rs:155-180`) — there is no `reserve_mints` to drift against SEAL. The two reserve iterations `[SPL_TOKEN_ID, SPL_TOKEN_2022_ID]` are constants; the read checks `data.len() == 165` (classic only), owner == PDA, no delegate, no close authority, no Token-2022 extensions (`d.len() == TOKEN_ACCOUNT_LEN`), `amount == 0`. The "non-ATA" Token-2022 account path is correctly closed: `d.len() == TOKEN_ACCOUNT_LEN` is the same gate.
- Frozen reserve account with a balance: BURN's loop at `burn/src/lib.rs:182-200` checks `amount == 0` first; a non-zero frozen account is refused with `VaultNotEmpty`. The freeze authority (Coinbase) can refuse the burn, but cannot make a sealed account drainable by the holder. The round 38 change: a frozen `amount == 0` account is now a no-op (the early `continue`), so a vault with a frozen zero-balance account is burnable, matching the live measurement.
- The 3 reserve mints, the 1,232-byte packet (1,153 bytes measured at 9.14a), and the reserve loop's exact-165-byte check are all consistent with the ceiling in `MAX_RESERVE_MINTS = 3` (asserted at 9.15/9.16).

No drift, no path I can find.

---

## R1s. The sweep helper

`programs/cbob-vault-sweep/src/lib.rs`:

- **Token 2022 / wrong-program refusals** (R.1a: `src/lib.rs:78-82`) — the helper enforces the Token and System program ids by exact string match. SR.8 / SR.9 in the suite (arms 7, 8 in `3prog.test.ts`) measure both directions and pin the refusal to `IncorrectProgramId`.
- **Source ownership** (SR.1, SR.5, SR.5a–c) — the source must be owned by the asset signer (`src_owner == *signer.key`); a stranger-owned source is refused with `IllegalOwner` and the log line names the address.
- **Source 165-byte classic** (SR.12, SR.12a) — non-165-byte Token-2022 is refused with `InvalidAccountData`; a duplicate source (the same address twice) is refused with `IllegalOwner` on the second pass because that account is closed.
- **Destination same-mint + same-owner** (SR.12, the destination's mint and owner must match the source's). A destination whose mint differs is refused with `InvalidAccountData`; a destination whose owner differs is refused with `IllegalOwner`.
- **Destination as signer wallet** (SR.10, `src/lib.rs:79`) — `signer.key == dest.key` is refused with `InvalidArgument`.
- **Token-2022 source** is supported up to its 165-byte base layout (same `TOKEN_ACCOUNT_LEN` gate). The 8-KB Jito/CPI tip-account routing mentioned in earlier rounds is not in this helper — it is a pure SPL pass-through.
- **frozen source** (SR.14) — the SPL `Transfer` reverts, so the whole call reverts; a frozen zero-balance source is still closed (round 38 W10).
- **C5 / kept close authority** (R36.C5) — the helper always closes, and a foreign close authority makes the close revert. The redemption page replaces this with a plain SPL Transfer through Core Execute and leaves the account undeclared (item 50). SR.5d proves the wallet *can* be emptied when the authority is the asset signer; SR.5e proves the seal is preserved across the refused attempts.
- **Lamport sweep** (SR.4a) — `signer.lamports()` is read at execution and moved; the move is System `Transfer`, not SPL. The 1,061-byte redeem page shape (S8.0) accounts for it.
- **The sealed vault + Execute rule** (SR.5) — Core `ExecuteV1` checks both the asset's owner and the seal (round 28 boundary); the asset is sealed, the helper is refused with `0x1a NoApprovals` (measured, frozen binary `e72d63e`).
- **Payload parity with mainnet bytes** (`build-mainnet.sh:97-100`) — the helper's mainnet bytes equal its localnet bytes, byte-identical. Round 25 D2's stale "being built" is now `BUILT`.

I find no R1s defect in the helper.

---

## R2. The community pool's money

Reading `programs/cbob-vault-mint/src/lib.rs` for the pool state and every helper:

- `acc_scaled` and `owed_scaled` are `u128`; `ceil_sats((owed_scaled + ACC_SCALE - 1) / ACC_SCALE)` is invariant. P.32 in the suite: the pool always holds at least this. P.13: the sub-sat residue carries. P.20–P.22: redemption that takes a sub-sat residue forfeits the residue. P.22e: un-distributed revenue stays in the pool for the vaults that remain.
- The cross counters `pending_count` and `pending_this_epoch` decrement correctly in `retire_redeemed` and `retire_burned` only when the retired vault was waiting *and* requested in the current epoch (F21.1, F21.2). Same-epoch decrement is *both* `pending_count -= 1` and `pending_this_epoch -= 1`; earlier-epoch is `pending_count -= 1` only. No underflow.
- `distribute` re-checks `waiting_to_join(c)? == 0` and that the burn path has a fully-funded $GARY account (3c.A3, 3c.A6c, P.13, P.14, the "two consecutive `distribute`s fail" test).
- `monthly_inline` re-checks `waiting_to_join(c)? == 0` and `boosts_due == 0` and refuses silently if any of those hold, with a distinct log line. The 3c.A6a measurement, where the activator gets nothing of the backlog, comes from the fact that `activate` records a *request* this epoch; the next distribution refuses on `JoinWaitingFirst`; the crank joins the activator; then a distribution runs and the cohort shares.
- The boost's `reweigh` carries what was owed into `carry_scaled` and resets `debt_scaled` to `weight * acc` at the new weight, so a weight change cannot underflow.
- `BoostTermsMoved` refuses a boost when the signed terms disagree with the *current* values in the *opposite* direction; a move in the buyer's favor lands at the new terms (round 24 D1). I see the code at `lib.rs:888-893` reading the *current* values; signed price ≤ max_price AND weight ≥ min_weight AND epochs ≥ min_epochs.

The cross-counters are correct. The "in-line monthly never fails its host" is the design constraint and is observed.

---

## R2b. The $CBOB boost

`boost_vault`, `expire_boosts`, `set_boost_terms`, the carry, the ring, the `BoostsExpireFirst` gate:

- One boost per vault: `BoostActive` refuses while `r.boost_weight != 0`. `BoostNotTheOwner` checks the live owner bytes of the asset, not the historical signer — a sold vault cannot be boosted by the old owner. BO.6, BO.33, BO.33a cover both ends.
- N is exact: the schedule is `boost_end_epoch`; once that epoch is reached, `BoostsExpireFirst` refuses distribution until expired. BO.10b proves an early `expire_boosts` is skipped. BO.12, BO.34c prove a due boost blocks distribute, and `claim` / `expire_boosts` expire it in the same instruction.
- Reweighing: `reweigh` always moves the *current* owed into `carry_scaled` and resets `debt_scaled` to `new_weight * acc`. The boost schedule's ring index is `(end_epoch % BOOST_RING) as usize`; the ring is `boost_expiring[64]`. The boost loop is 64; `MAX_BOOST_EPOCHS_BOUND = 63`, so the upper index is always in range. (No ring wrap can write outside `[0, 64)`.)
- An empty N-distribution boost can be expired in the same transaction that ran the last distribution, or in any later one. The host unit test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` runs 260 epochs and asserts `boosts_due + ring == active` at every step. I read it: it uses the same `reweigh` / `expire_boost` / `credit` / `tick` / `retire` functions the program calls, and the assertions hold across four ring wraps.
- The price, weight and length bounds the vote checks at proposal creation (`BoostTermsOutOfBounds`) and the program re-checks at `boost_vault` (`BoostTermsMoved`).
- `set_boost_terms` is GOV-only (`Governed` accounts, only the `["gov"]` PDA signs); BO.27 proves the same shape signed by a holder is refused.

I find no R2b defect.

---

## R3. The level draw

- `blockhash_in_window` (MINT lib:182-204) checks the sysvar key, count ≤ 512, and full data length; an all-zero hash is refused as `BadSlotHashes`. The *smallest* produced slot in `[want, want+64]` is taken, deterministic against the same sysvar.
- `try_capture` (MINT lib:719-754) computes the A, B, C slots correctly: A is the first produced slot at or after `reveal_slot`; B is the first at or after `(A/4 + 2) * 4`; C is the first at or after `(B/4 + 2) * 4`. Leader-group stride of 2 is conservative against the measured "one validator held two adjacent rotations" case (limit 26).
- L.17d: a missed window gets rescheduled (`reschedule_reveal`) to `now + REVEAL_LEAD_SLOTS = 16` — a future slot not yet produced at the time the reschedule lands. The FIFO waits: `L.16a` proves the next vault is still waiting.
- L.10: the recorded entropy is replayable. L.23 replays every draw in mint order against the per-step census and matches the level written. L.23a: zero draws without entropy.
- L.11/L.11a: a vault burned before its draw still takes one (L.11 asserts level 1..5; L.11a asserts the asset is the 1-byte tombstone). L.18–L.22: the exhausted census is exact; a 21st mint after exhaustion is refused at `LevelCapReached`. The level attribute on the asset is exactly what the program wrote (`reveal_level` pins it to `LEVEL_NAMES[level-1]` and `LevelCapReached` if all quotas used).
- The drawer's local validator tested the missing-slot path: `[0, 1, 0, 0, 0, 1, 0]` (every 7th skipped) in `the_lookup_takes_the_smallest_produced_slot_in_the_window`. The expiration path is tested too.
- The "C's leader can choose among many" limit (26) is the only known weakness. The bounds on it are stated in the holder guide and SPEC. The honest list calls it out.

I find no R3 defect in the code; the residual is limit 26.

---

## R4. Governance

`programs/cbob-vault-gov/src/lib.rs`:

- `quorum_supply` and the tally rule are fixed at `create_proposal` time: `mint.minted_total - burn.burned_total - mint.bare_burns_retired` and the `quorum_bps` / `threshold_bps` / `index_snapshot` (`mint.minted_total`) at that moment.
- `VaultTooNew` is enforced at `cast_vote` by reading the record's `mint_index` and comparing to `index_snapshot`. Tests 7.6, 7.7, 7.8, 7.9 cover the double-vote-by-transfer case.
- Half-of-all-vaults for a guardian change or a new swap operator: `KeyChangeNeedsHalf`, `ceil(divisor * 5000 / 10000)`. 3c.K2 measures the `quorum + 10% turnout` short-of-half case; 3c.K5 lands an armed operator.
- `Brakes` halves (3c.S1) are logged, not refused: the bundle still lands; a stale restart is a no-op.
- `TightenSweep` is monotone: `if let Some(x) = sol_reserve_lamports { c.sol_reserve_lamports = c.sol_reserve_lamports.max(x) }` and analogous `.min` / `.max` for the other two. Bundling a tighter and looser value lands the more restrictive; a looser value alone is refused at creation (`Loosening`).
- `SetRound` rejects `price < 21_000` and `cap == 0` and a window > 1 year. `SetBoostTerms` rejects `weight > max_boost_weight`, `weight == 0`, `epochs > max_boost_epochs`, `epochs == 0`.
- A guardian change and a new swap operator can never share a proposal: `KeyChangesBundled` at proposal creation.
- 10% turnout rule: `TurnoutTooLow` at `ceil(divisor * 1000 / 10000)`.
- The cold-quorum case (turnout under 50% of all live vaults) is the no-replacement zone for the guardian, stated as limit 47 in the guide. It is not a code defect; it is the ruling.

I find no R4 defect in the code; the residual is limit 47.

---

## R5. The charter claim

`claim_charter_vault` (MINT lib:441-547):

- Burn: the program builds the `BurnV1` instruction with the burner's signature, exactly as Core accepts it; the burner is required to sign the instruction. The PoB is burned by CPI in the same instruction that mints the vault. The asset address of the PoB is read from `pob_proof` and the Merkle check at `merkle_root_from(merkle_leaf(&pob), &proof) == pob_root` is exact.
- The Merkle root is read out of MINT's `Config` (the round-13 `NotInPobSet` cases 1, 2, 3) and pinned by discriminator and version. The path domain-separates leaf from node: leaf is `sha256(0x00 || pubkey)`, node is `sha256(0x01 || min(a,b) || max(a,b))`. Sibling ordering is implicit in the sort; direction bits are not needed.
- The PoB must be a live Core asset in the PoB collection, owned by the signer, with no delegate that could block the burn (the read checks `info.delegate` is null). The Proof of Burn collection's `update_authority_disc` is `UA_DISC_COLLECTION = 2` and the collection address matches `pob_collection`.
- `pob_extra` is the pass-through count for the PoB burn, capped at 8. OR.1–OR.6 measure both directions: a benign Oracle lets the claim through; a rejecting Oracle refuses; `pob_extra > remaining_accounts` is refused; a bad proof is refused.
- The charter window is `charter_opens_at ≤ now < charter_closes_at`; outside the window the instruction refuses by clock alone. C.1 (early) and C.15 (late) measure both.
- The charter claim is NOT gated by the guardian's sales stop (Gary, item 48).

The 7-day window is the ruling. The PoB burn is the only way to claim. The proofs are proven by both an arms-per-direction test in the suite and the round 25 mainnet probe.

I find no R5 defect in the code; the residual is the "hot Moments key during the window" — limit 46, stated in the holder guide.

---

## R6. One-time configuration and the trusted hop

Every `initialize` in the four programs:

- `programs/cbob-vaults/src/lib.rs:initialize` — checks `INIT_AUTHORITY`; takes a `collection` and `Vec<reserve_mints>`; checks each reserve mint's account is owned by classic SPL Token. The Vec length is bounded to `MAX_RESERVE_MINTS = 3`. (8 bytes per mint, fits within the 1,232-byte limit with three reserves; adding a fourth exceeds.) Account sizes are correct (8 + 1 + 32 + 4 + 32*3 + 1 + `CONFIG_PADDING` = 256, asserted at the suite's seal and live measurements).
- `programs/cbob-vault-mint/src/lib.rs:initialize` — checks the $CBOB mint (a classic SPL mint, not cbBTC or $GARY), the 1-to-12 / 1-to-63 boost bounds, the 85/15 split, the 10% royalty install with `PluginAuthority::None`, the cleaned collection, the SEAL pre-init wiring (collection + payment_mint-as-reserve), the 7-day charter window, the bounded sweep bounds, the bounded monthly_secs and notice_secs, the payment mint's reserve status. The pool's address is derived, not passed. The CBOBTC Squads' default key (`Pubkey::default()`) is refused.
- `programs/cbob-vault-burn/src/lib.rs:initialize` — checks SEAL exists and names the same collection; refuses a window outside `[10, 86400]`. ⚠️ Mainnet must be 3600; the alarm reports `test_value_in_production` after `initialize`, and the launch checker (`check-launch-params.mjs`) refuses a value that is not ruled.
- `programs/cbob-vault-gov/src/lib.rs:initialize` — checks MINT exists and names the same collection; refuses a quorum outside `[500, 10_000]` bps; refuses a threshold outside `(5_000, 7_500]` bps; refuses a `min_voting_secs` outside `[60, 30 days]`. ⚠️ Mainnet must be 3 days, 21% quorum, 51% threshold.

The trusted hop (`sweep_sol_for_swap`): the destination is the configured `swap_operator`, the amount is `> 0` and `<= max_sweep_lamports`, the cooldown is checked on the chain clock, the operator must sign, the SOL reserve is preserved, and the `last_sweep_at` is stamped. 6.17b refuses a zero sweep. 6.15 refuses an oversize sweep. 6.17a refuses a stranger's signature. 6.20g refuses an early apply. The 2.1%-per-hour cap and 3600-s window are the only values that matter at runtime.

The 10% royalty: `MINT's `initialize` builds `RULESET_NONE` and `PLUGIN_AUTHORITY_NONE` (`lib.rs:486-503`). `PluginAuthority::None` is read by Core and is what makes the rate immutable: `state/asset.rs:325-337` (round 25 N3) approves Execute only for the owner. The 6a tests `R.6` and `R.6a` prove Core refuses both an update and a removal.

I find no R6 defect.

---

## R7. Cross-program raw reads

Every cross-program offset I can recompute, against `programs/*/src/lib.rs`:

- SEAL: `OFF_VERSION = 8`, `OFF_COLLECTION = 9`. The layout is `discriminator: 8, version: u8 (8), collection: Pubkey (9..41), reserves: Vec<Pubkey> (41..)`. Borsh-serialised: `u32 length` (4 bytes) + `length * 32` keys. Round 26 C3.
- MINT config v6: `discriminator: 8, version: u8 (8), collection: Pubkey (9..41), governance: Pubkey (41..73), pool_ata: Pubkey (73..105), round_id: u32 (105..109), opens_at/closes_at/price/cap: 8/8/8/4, minted_this_round: u32, minted_total: u64 (141..149), max_supply: u64, bank_treasury: Pubkey, split_bps: u16, sales_stopped/sweep_stopped/guardian/swap_operator/sol_reserve_lamports/bump/max_sweep_lamports/sweep_cooldown_secs/last_sweep_at: 1+1+32+32+8+1+8+8+8, level_caps[5]: 20, level_minted[5]: 20, revealed_total: 8, payment_mint: 32, pob_collection: 32, pob_root: 32, charter_opens_at/closes_at/charter_claimed/bare_burns_retired: 8+8+4+8, total_active_weight/active_count/acc_scaled/owed_scaled/last_distribute_at: 8+8+16+16+8, sales_stopped_at/sweep_stopped_at/pending_swap_operator/pending_swap_operator_at/monthly_secs/pending_guardian/pending_guardian_set/pending_guardian_at/notice_secs/sweep_floor_lamports/cooldown_ceiling_secs/reserve_ceiling_lamports/dist_epoch/pending_count/pending_this_epoch/cbob_mint/max_boost_weight/max_boost_epochs/boost_price/boost_weight/boost_epochs/boosts_active/boosts_due/boost_weight_total/cbob_burned_total/boost_expiring[64]: stage 3c follow-ups`. The recomputation matches GOV's reads at 41, 141, 191, 192, 257, 266, 274, 442, 454, 518, 526, 631, 639, 647, 711, 712.
- BURN config v4: `discriminator: 8, version: u8 (8), collection: Pubkey (9..41), bump: u8 (41), burned_total: u64 (42..50), redeem_window_secs: i64 (50..58), rate_head: u8 (58), rate_ring[64]: i64 each (59..59+512)`. The padded config is 8+1+32+1+8+8+1+512+256 = 827. The `RENT_EXEMPT_0_BYTES = 890_880` check is correct.
- GOV config v4: `discriminator: 8, version: u8 (8), collection: Pubkey (9..41), quorum_bps: u16 (41..43), threshold_bps: u16 (43..45), min_voting_secs: i64 (45..53), proposal_count: u64 (53..61), bump: u8 (61), last_round_id/last_guardian_id/last_arm_id/last_boost_id: 4*8 = 32 (61..93)`. Plus `CONFIG_PADDING` = 256. Total 357, asserted by the suite.
- VaultRecord v4: `discriminator: 8, version: u8 (8), asset: Pubkey (9..41), mint_index: u64 (41..49), reveal_slot: u64 (49..57), level: u8 (57), charter: bool (58), entropy_set: bool (59), entropy: [u8; 32] (60..92), attrs_hash: [u8; 32] (92..124), bump: u8 (124), active: bool (125), retired: bool (126), reschedules: u16 (127..129), vault_ata: Pubkey (129..161), debt_scaled: u128 (161..177), pending: bool (177), request_epoch: u64 (178..186), boost_weight: u8 (186), boost_end_epoch: u64 (187..195), carry_scaled: u128 (195..211), RECORD_PADDING: 10 (211..221)`. Total 221.
- Sweep helper reads a classic SPL token account by raw offset: 165 bytes, mint 0..32, owner 32..64, amount 64..72, state 108. The R-9 mock test of the redemption (`SR.4a`) re-derives this offset and matches.

Cross-program offsets, discriminators, and account sizes all match.

---

## R8. The suite, the simulation, and the build

The runner has two hard floors that must equal the count:

- `MIN_ASSERTIONS = 895`, asserted after the on-chain run. The 21 round-37-A5 reason pins (round 37 V1: more than 20 strays become one grouped box; R37 W6 the "exactly four" no-crank check) are present, but the `because()` pinning pattern is consistent in style. The "exact equality" is the gate; I do not see how to "succeed by a partial pass" against the current runner.
- The token-programs pin (Scripts/token-programs.sh) has each row's hash asserted after fetch and re-asserted at validator boot. Classic SPL Token matches; Token-2022 and the ATA program are pinned. The round-28 finding that "bundled Token-2022 and ATA differed" is asserted against today's mainnet.
- The `core_onchain` round-trip: validator boot, `solana program dump` against the live validator, `cmp -s` against the cached dump. Both are pinned against the cached mainnet dump.
- `scripts/build-mainnet.sh` proves which key each program carries: it deploys both `--features localnet` and the mainnet build to a real validator and asks each one whether it trusts the test key. The verdict pins to the named error (`NotTheInitAuthority`) and `REACHED PAST` is the only alternative considered acceptance, with a control arm.
- The sim's Test Vault runs the same paths against the SAME `seed-mainnet` validator, with the real cbBTC, $GARY, $GIRAFFISH mint accounts, and two real Proof of Burn assets. The floor is 71.
- The mainnet probe (`scripts/probe-mainnet-facts.mjs`) runs against live mainnet and asserts things the local validator cannot test: the signature walk against a busy program, the reserve mints being classic SPL, the PoB set recomputed from on-chain raw data. Floor 33.
- The swap fork (`sim/swap-fork.sh`) is a real mainnet fork run that proves both Orca and Meteora accept the swap instructions and that the floor is enforced on chain. Floor 16.

The audit-coverage gate (`scripts/audit-coverage.sh`) keeps a fresh build only when every tracked file was bundled by a completed round whose independent verdict records a met quorum. The gate is strict by default; `--prepared` is the preflight question only.

The "no path fails" arms I would want to add for round-40, given the new pages, are listed in the gate-5 obligations of round 39's verdict. They are not regressions in the current suite.

---

## R0 (web). The holder pages

Re-reading `web/` against round 39's verdict and what I have not seen before:

- The `web/src/lib/plan-redeem.mjs` opening covers everything the spec says it must. The two repair sites (V39-1, V39-2) are the only open items. The `proved` paths and the standing consent are read correctly.
- `web/src/lib/ceremony-reads.mjs` resolves the vault collection from configured pins first, then the on-chain candidates, with the B4 warn-and-still-offer rule for unverifiable collections. The page re-reads the chain after every step and stops on a mismatch.
- `web/deploy/rpc-proxy.mjs` allowlist is tight: only the JSON-RPC methods the pages call, only the 8 exact `getProgramAccounts` shapes, only the `sendTransaction`/`simulateTransaction` shapes that call at least one CBOB program (or the three exception shapes for setup). Rate limits per IPv6 /64, cap on the upstream response streaming, no CORS headers, same-origin only. The `gpaShape` function rejects 1-byte, empty, or base64 `dataSlice` filters that would match all Core.
- `web/src/lib/tx.mjs` compares the signed message byte-for-byte to the message built (`signExact`); a wallet that adds or reorders an instruction is rejected. The simulation runs first with the right account watchers; the post-state of those accounts is reported in sats per mint, with the holder's receiving account (one watcher per mint) so the dry-run delta is visible.
- The bundle test (`web/test/run-all.mjs`) runs 642 offline assertions, including R1-R7 pinning and the V38/V39 fixes, behind floors that must equal the count.

The pages look correct to me on this read; the open items are the two repairs.

---

## The four questions about accepted limits

1. **Is any limit WORSE than stated?** No. I re-read every accepted item against the code:

   - 6 / 7 / 8: alarm + flock + log gaps. The `crank_silent` (3 hours), `royalties_unswept` (1 day, sweepable 1 SOL+), and per-stream `cbob-vault-crank:full / :reveal / :fee_ceiling` are present. The log-coverage gap is level-triggered on the watermark; the cursor advances past every recorded gap. Matches the statements.
   - 9: the redeem page is the only pre-signature coverage check; `rescue_nested` (item 58) handles nested vaults; an undeclared token account is destroyed. SPEC states this; code matches.
   - 10 (swap operator key): every bound, ledger, hand-recovery, and oracle-floor rule is in the code. The `judgeSwapInstructions` refuses a different output account, a zero floor, a changed amount, a flipped direction, a priority fee, a Token `Approve` of cbBTC to a stranger, a changed ATA owner, and a 50 SOL wrap, in both venues. The forward and return are not by a third party; the builder is `bank/swap.mjs`, signed locally.
   - 12/17 (compute units): measured on the artifact and on the v6 build (10.1–10.6a, regressions at 400,000). The byte wall still binds more than 25x before the compute wall.
   - 13 (level immutability): the Attributes plugin's authority is MINT's `["mint"]` PDA; 11.13/11.14/11.15 prove no one can rewrite.
   - 17 (compute at host shapes): measured (10.4–10.6b); the crank sends one capture per transaction and reveals alone with its inline capture (≤ 200,000 CU). The holder-page rule is `host cost + 115,000 per capture + margin`, max 4 captures per host. Exists in the test fixtures (`plan.test.mjs`).
   - 22 (revenue cycle / crank not on live): still OPEN. No live cycle has run. The named pass/fail items are described; none has been exercised against a live chain.
   - 25 (re-roll on missed window): stated. Capture is permissionless and rides on every host + the every-minute crank; reschedule is logged. Correct.
   - 26 (C's leader): stated. Honest list names "best-of-4 alone takes P(V) from 5.0% to 18.6%".
   - 27 (claim against bare-burn): stated; crank never pays or joins a positively burned vault. The retirement returns the unclaimed share to the pool. Correct.
   - 28 (Coinbase freeze): stated. Pool-frozen path forfeits the undelivered share and logs `CBOB_REDEEMED_POOL_FROZEN`; in-line monthly never credits from a frozen pool; an explicit `distribute` still credits and is owed. Matches.
   - 29 (only cbBTC splits): stated. `split_revenue` is `TOKEN_PROGRAM_ID`-pinned.
   - 32 (rate limit): stated. The ring of 64 covers live supply up to 3,047; mainnet is 2,100. Bounded correctly.
   - 34 (per-kind ordering, skipped actions): stated. The mark moves before the over-check. Correct.
   - 35 (10% turnout rule): stated. The ruled numbers (21% quorum, 51% threshold) make it not bind.
   - 36 (monthly in-line): stated. The host instruction runs it once, with the four reasons to skip.
   - 37 (host carries pool): stated. The pool account is one key.
   - 39 (immutability): stated. Locked at launch.
   - 40 (Metaplex Core): stated. The alarm watches bytes, upgrade authority, and computes a `tx_unreadable`/`log_coverage_gap` for truncated logs.
   - 41 (transfer not rate-limited): stated. The cap is on redemptions.
   - 42 (page prepares missing ATAs in a prior transaction): stated. The redemption page does this; the holder guide says so.
   - 43 (off-curve owner): stated. The `is_on_curve` test panics on BPF; `unredeemable_owner` pages CRITICAL.
   - 44 (undeclared airdrops / Token-2022 / frozen stray / foreign close authority / nested): stated. The page is the only pre-signature control; sweep-helper moves classic strays.
   - 45 (governance at zero vaults): stated. Minted-round ratchet.
   - 46 (Moments hot key during the window): stated. Mitigation: the page refuses a Proof of Burn or its collection carrying an external plugin, and the alarm pages ANY plugin or update-authority change.
   - 47 (stolen guardian key): stated. The cure is a vote that needs YES from half of all vaults snapshotted at creation, plus a 7-day notice, never bundled with a swap-operator change.
   - 48 (charter claim cannot be stopped): stated. By ruling.
   - 49 (no record rent refund): stated.
   - 50 (holder surfaces): OPEN. Built, staged, not published. The redeem page has the V38 / V39 fixes applied.
   - 55 (newly activated vault shares unsplit revenue): stated. The crank splits every pass, bounding the window.
   - 56 (whole $CBOB supply on a hot key): stated. The release wallet is pinned in `launch/mainnet-init.json`.
   - 57 (minter's name, picture, lookalike traits): stated. They do not affect on-chain level or value.
   - 58 (rescue to the Squads): stated. The page also offers the rescue as an optional set-up step or after the opening. Correct.

   I do not find any accepted limit that is actually a worse defect than stated.

2. **Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**

   - Limit 49 (no record rent refund) is permanent by design: closing the record would cost about 43 bytes of rent per vault and would break the FIFO, the snapshot, and GOV's read of `mint_index`.
   - Limit 50 (holder surfaces): open and built. The four pages and the unlisted ceremony are present; the redeem page's V38/V39 fixes apply. The page is gated on the deploy / lock. Not "already closed", but "is a launch prerequisite", not an audit finding.
   - The rounding dust (item 4 in "Known limits") stays in the pool by design; the alternative makes `Level` and `Level+1` differ by a sat. Stated and measured.
   - The reserve ceiling in MINT's `initialize` is the `reserve_ceiling_lamports` check, and GOV's `TightenSweep` re-checks against it. Round 22 F1 had this defect; stage 3c fixed it; the limit `TightenOutOfBounds` now says it. The doc text matches the code.
   - Item 22 (revenue cycle / crank never on a live chain) is correctly OPEN. The text correctly names the pass/fail items; the rehearsal must exercise them.
   - I checked the "permanent accepted" list against the live code: every named mechanism (the BO gate, the carry, the BoostsExpireFirst gate, the ring of 64, the token-bucket-to-rolling-window change, the perpetual-no-refund on the record, the rescue delegate, the Stake the BOOST_RING is `<= 63` so the upper index is in range) is the code I read.

3. **Is any DISCHARGED item not actually discharged?**

   - 51 ($CBOB boost, built). Yes, present; suite section BO; `boost_vault`, `expire_boosts`, `set_boost_terms`, the carry, the `BoostsExpireFirst` gate, the ring of 64, the boost schedule's per-epoch measurement, the `tests/host_test.rs` `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` 260-epoch test, the price/weight/epochs bounds. Owner-only since round 23.
   - 54 (compute at host shapes): measured, regressions at 400,000; the page's rule is documented.
   - 12/17 (compute): measured on the v5 artifact and on the v6 build, byte wall binds 25x before compute wall.
   - 14 (duplicate attribute keys): `DuplicateAttribute` at mint.
   - 19 (unlevelled-vault halt): `levels.json` deleted, `activate` refuses `NotRevealed`. No state in which an activated vault is unlevelled.
   - 30 / 31 / 33: superseded; the new code is the only code (3-stage 3b governance). I see no remnant.
   - 1a / 1b / 2 / 3 / 4 / 5 / 11 / 15 / 16 / 18 / 20 / 21 / 23 / 24: gone with the Bank. No code or path I can find in the current tree.

   No DISCHARGED item I read has a residual defect.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

   - 22: still OPEN. The rehearsal is in the road map and is what this round did not exercise.
   - 38: still OPEN. Three fields are OPEN in `launch/mainnet-init.json` (`vault_collection`, `charter_opens_at`, `lock_deadline`). The launch checker (`check-launch-params.mjs`) refuses them with 49 selftest arms, all of which pass at the current HEAD.
   - 50: still OPEN. The holder surfaces are built and staged; the deploy / publish / lock step is what remains.
   - 52: still OPEN. The three cbBTC accounts are not yet created on mainnet. The ceremony creates them at road step 10; until then `split_revenue` would fail loudly.
   - 53: still OPEN. The dress rehearsal at throwaway program ids has not been run. The script exists; the named pass/fail items are still pending.

   No open item is being quietly demoted to accepted. The freeze log carries the same counter as before.

---

## What this project should do before launch that an AI audit structurally cannot

Concrete, ordered, and not "have a human audit firm":

1. **Repair V39-1 and V39-2 in `web/`** with the gate-5 arms listed in round 39's verdict, then re-run the e2e harness with the failure paths (`tests/ceremony` 105/105, `plan.test.mjs` 150/150, `bundle` round-trip, `OPEN_ATTEMPTS=2`, and the two new e2e arms: a 112-account flood with a failed listing, and a nested-CBOB-vault before the press). Without the V39-1 fix, the page can drop a promised stray at the press; without V39-2, a stranger blocks an opening. Both are on the user-facing path and must be repaired and re-tested before the holder pages are live.
2. **Run the named pass/fail items of item 22** on a real cluster: the crank's live passes against a deployment with the ruled values, the alarm's live passes in rehearsal mode, **one full live revenue cycle through BOTH pools** (Orca forced to refuse once so Meteora runs), and one forced post-sweep failure walked through the hand recovery. Item 22 is the only place the off-chain pipeline meets real chain, and it is the only acceptance test the off-chain side can do with money. The first cycle must be on a cluster that is allowed to lose the per-sweep SOL, with the operator key and the alarm as the only moving parts.
3. **Pre-deploy audit: a different model roster, different prompts, same frozen tree.** A round that agrees with itself is not a second round. The release commit, on a clean tree, with the eight models replaced by a different eight, and the headline that says "QUORUM MET". Two of those in a row, with the existing `audit-coverage.sh` strict gate green at the start of each, with all five accepted-limitation items in their listed gate passing both directions, and with the reasons that pinned the rejected claims still pinning them.
4. **Record the launch values that are still OPEN** (`charter_opens_at`, `lock_deadline`, `vault_collection`) at the moment of `launch/mainnet-init.json`'s last edit, and run `scripts/check-launch-params.mjs` against the file as it stands. Its 49-arm selftest must pass; if any of those three is still OPEN, the checker must refuse to pass. Pin the file to the launch commit.
5. **Run the dress rehearsal at throwaway ids** (`scripts/rehearsal-tree.sh` makes a worktree, applies exactly six substitutions, proves the reverse map recreates HEAD byte-for-byte). The rehearsal value set and the rehearsal mode in `check-launch-params.mjs` are not built; the ceremony at the rehearsal should be a dry run that, on every item the main ceremony walks, refuses or accepts for the same reason the main one will, on a cluster that is allowed to be discarded.
6. **Build the deploy and lock pipeline against the placeholder, on mainnet, before any other program touches the box.** Round 34's measurement: a pre-funded `ProgramData` address at an upgradeable-loader program id is unrecoverable for that id, so the only recovery is a new id, which is a program change. The five ids are claimed on mainnet with the inert placeholder (step 9 "in progress" in the audit). The deploy-then-check-bytes path is rehearsed end to end on the local validator with the real program keypairs; on mainnet it should run once, with the bytes the suite and the sim ran (`scripts/build-mainnet.sh`'s `dist/` sha256s) deployed to the same ids, verified, and the upgrade authorities reported by the alarm. Only then: road step 11, which removes the upgrade authority, and only then the launch. The redeem page must be live and exercised against a throwaway vault on the rehearsal before the lock, so the holder-facing path is not the first test of an immutable program.
7. **A printed, signed copy of the holder guide and the honest list on the box at the time of lock**, with the rules and the exceptions and the privacy of the moments key, exactly as the page shows them. The page is the holder's only pre-signature control; the printed copy is what a holder who never visits the page can read. The redemption page, the claim page, the buy page, and the launch ceremony have to be live and the rehearsal at throwaway ids has to have run a full open before the immutable step.
8. **A documented "no longer upgradeable" runbook for the box owner**, with the alarm's `program_not_locked` kind's escalation path, the date the upgrade authorities were removed, and the sha256s of the program bytes at that moment. The lock is permanent; the runbook is what makes the permanence safe to assert.

The honest summary: every one of the eight items above is something an AI round can write but cannot do. The "two clean rounds" gate is the formal one; the eight items are what makes the gate mean what it says.

The clean-round counter is still 0/2.