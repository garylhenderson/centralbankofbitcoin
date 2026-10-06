# Round 30 Audit — v6 tree at `c5aab17` (round-29 repairs `88acce2` included)

**Verdict: no CRITICAL, HIGH, MEDIUM or LOW code defect found that survives the bundled evidence. One INFO documentation defect. Round 29's repairs verify as far as this bundle reaches.** The negative result is stated target by target below, with what I recomputed and what evidence would exist if I were wrong. Two evidence boundaries are called out explicitly rather than papered over: the M1 repair's consumer halves (`bank/alarm.mjs`, `bank/revenue.mjs`, `bank/redemption-poster.mjs`) and the selftest are not in this round's bundle, and no mainnet read is possible from here; where a claim rests on those, I say so.

---

## R0. Round 29's verdict and repairs

Round 29 was NOT CLEAN (0/0/1/1/2). I checked each confirmed finding and its repair against this tree.

**M1 (MEDIUM, stranger-halts-scanners via runtime log truncation).** The reader half is bundled and correct. `bank/txread.mjs` `validateParsedTransaction` keeps `truncatedLogs: 'refuse'` as default; `'flag'` is validated as an option (`need(['refuse','flag'].includes(...))`), skips only the marker check, and returns `{...tx, logsTruncated: true}` with every other field still validated (schema, keys, instructions, inner instructions, token balances, balances, fee, v1 `transactionConfig`, no v1 lookup-table keys). The marker match is exact-element (`meta.logMessages.includes('Log truncated')`), so a program's own `Program log: Log truncated` text does not trip it, and `logMessages: null` is still refused outright. `scripts/probe-mainnet-facts.mjs` uses the flag only for fee-payer sampling, which is the right scope. **Evidence boundary:** the three walking consumers (alarm cursor advance, revenue outflow read, poster REJECTED-queue) are not bundled this round; their behavior rests on the 891/891 selftest log quoted in `audits/round29/VALIDATION.md`, which I cannot re-run from this bundle. What I can verify does not contradict it. If the repair were wrong, a truncated-log transaction naming MINT would still throw out of the alarm's walk — that is exactly the round-29 Part B measurement, and the bundled reader no longer throws in flag mode, so the repair's premise holds at the layer I can see.

**L1 (LOW, coverage gate scope).** `scripts/audit-coverage.sh` now enumerates `git ls-files` over `programs/ bank/ scripts/ sim/ launch/ tests/` plus the four documents and two manifests, with three named exclusions, exits 2 when git cannot answer or the list is empty, and reads both prompt shapes (`f('...')` and the anchored `['...'` TARGETS rows). The files round 29 named as never-sent (`sim/fixtures.mjs`, the four program `Cargo.toml`s, `scripts/pob-set.json`, `tests/cpi-wrapper/Cargo.toml`) are in this round's bundle, so the gate passes on prepared coverage. Repaired as written.

**D1/D2 (INFO).** DESIGN-v6.md section 3 now reads "it REQUESTS activation... enters `total_active_weight` only when the vault JOINS, after the next distribution" — matches `activate`/`join` in MINT. SPEC's "What got worse" now carries the permanent-dilution note for an orphaned activated vault, and items 9/44 point at it. Repaired.

**Round 29's rejected claims I re-checked independently:** W1 (helper destination not bound to owner) — the refutation is correct; binding `dest` to the owner would add nothing because the same owner-authorized `ExecuteV1` can call SPL Token directly, and the helper's `to_owner == dest.key` check is consistent with that threat model. W16 (`MINT_CONFIG_SPACE`) — I recomputed the struct from the field list: fields end at byte 1005, +256 padding = 1261, matching the constant; the GOV/BURN offsets (41/141/454/679/711/712/749) all agree with my recomputation below. No repair regression found in anything I can execute-read.

---

## R1. Custody: the seal/burn pairing and the emptiness proof

I re-attacked the pairing on the bundled source:

- **CPI wrappers.** SEAL's forward walk and BURN's backward walk both use `load_instruction_at_checked`, which sees top-level instructions only; a wrapped open is a top-level instruction to the *wrapper*, not to SEAL, so BURN finds no open (`NoPrecedingOpen`, WR.3); a wrapped burn is invisible to SEAL (`NoTerminalBurn`, WR.2). `retire_redeemed`'s stack-height check (`== TRANSACTION_LEVEL_STACK_HEIGHT + 1`) passes for a wrapper CPI (height 2), but the second check — the current top-level instruction must be `burn_vault` with the asset at account 0 — refuses it (`NotFromBurn`, WR.1). All three measured on the test-only wrapper.
- **Two vaults, one transaction.** Both halves bind asset AND owner at fixed account indices (0 and 2 in both programs), so neither half can be borrowed cross-vault (3.9, 3.10, 4.10, 9.0). `[open A, open B, burn B, burn A]` pairs correctly and the rate limit refuses the second at cap 1 (4.10a); at cap 2 both land in v0 with a lookup table (S9b, measured).
- **Emptiness proof.** I re-derived the classic SPL account layout against the checks: delegate COption tag at 72..76, `delegated_amount` at 121..129, close-authority COption tag at 129..133, state at 108, length exactly 165. A Token-2022 ATA is 170 (ImmutableOwner) and is refused (`ReserveHasExtensions`); a raw 165-byte Token-2022 account cannot carry a confidential balance (that extension makes the account larger), so the base `amount` at 64..72 is authoritative for every account that can pass. A token-program-owned account with crafted non-zero data cannot exist (only the token program writes its own accounts), so the `d.len() < 165` skip cannot hide value. The reserve ATA address is an ATA-program PDA, so only ATA-created accounts can exist there.
- **A thawed vault cannot leave a transaction unburned.** SEAL thaws only with a later matching top-level burn; if the burn fails, the transaction reverts and the thaw with it. Atomicity does the rest.

No surviving defect. If one existed, the evidence would be a landed transaction with a thawed, non-empty, unburned vault — the suite's WR/SR/3.x/4.x/9.x arms are exactly the runs that would have to produce it and do not.

---

## R1s. The sweep helper

(a) **Access.** The helper requires `accounts[0].is_signer`; only Core can make the asset-signer PDA a signer, and Core's `ExecuteV1` approves only the asset's owner on a thawed vault (SR.5/5a/5c refuse a stranger, an owner-added transfer delegate and a collection update authority with Core `0x1a`; SR.5d is the positive control). A frozen vault refuses Execute at the plugin (3.7, S6.2), and SEAL is the only thaw path, so the helper is unreachable outside a redemption. Called directly with a real signer it can only move that signer's own tokens — a self-sweep, no worse than a plain transfer.

(b) **Pair list.** I walked each shape: duplicate source → the first pair closes it, the second's `read_token` fails on the system-owned husk (`IllegalOwner`; SR.12a pins the error and SR.12b pins that it came from the second pair, not the first guard); source==destination is impossible because `src_owner == signer` and `to_owner == dest` would force `signer == dest`, refused up front (SR.10); a wSOL source behaves like any classic account; a delegated or close-authority source is transferred and closed by the owner's signature regardless, and BURN never sees it because it is closed (3.3a); a frozen source reverts the whole redemption (SR.14, accepted item 28); a non-ATA classic destination owned by the destination wallet passes, which is the item-44 rescue path; a destination of another vault's asset-signer is the owner's own choice to fund it, not a theft (only the owner can drive Execute). Odd account count → `NotEnoughAccountKeys` (SR.7); zero pairs → lamports-only sweep (SR.13, measured landing).

(c) **Destination checks.** The destination wallet is the caller's choice; given (a), the caller is the owner, so this is safe at the program layer (round 29 W1, correct). A lamport credit to a non-existent destination below rent fails the System transfer and reverts the redemption — the item-50 rule (destination = the fee-paying owner) covers it; a credit to an existing non-system account lands (R27.S1, measured).

(d) **Lamport sweep.** `signer.lamports()` is read at execution, after the pair loop; the closes send rent to the destination, not back to the PDA, so nothing refills it; BURN's `lamports == 0` check runs in the same atomic transaction and sees exactly what the sweep left. A later instruction depositing would have to be in the owner's own transaction.

(e) **BURN interaction.** A closed reserve ATA is system-owned with zero lamports, so BURN's reserve loop skips it for the right reason (`acc.owner` not a token program). A reserve ATA that never existed reads the same way. The stranger's race — create the vault's classic reserve ATA and dust it between page-build and execution — is closed because the helper reads the live balance at execution (SR.3/SR.4 stage and measure exactly this). The accounts a stranger can still create (Token-2022 accounts, nested Core assets) are destroyed, not blocking; that is accepted limit 44, stated.

(f) **Fit.** S8.0 measures claim + open + helper(three pairs) + burn at 1,061 bytes owner-payer and asserts ≤ 1,084 (leaving room for both compute-budget instructions and a separate fee payer at ~1,209 of 1,232); S8.1a measures 168,343 CU against the 800,000 default for four instructions. A fourth reserve is impossible (`MAX_RESERVE_MINTS = 3` in both SEAL and BURN, 9.15/9.16). The in-line monthly run adds no account (the pool is already carried).

(g) **Evidence.** SR.0–SR.14 and S8.* are real arms with reason pins; `build-mainnet.sh` proves the suite's deployed helper bytes (`target/deploy`) are byte-identical to the mainnet `dist/` bytes via the localnet-release comparison, and the helper has no `localnet` feature to swap anything (its `Cargo.toml` is bundled and matches that claim).

No defect. If (a) were wrong, the evidence would be a landed Execute by a non-owner on a thawed vault — SR.5/5a/5c are the runs that would show it and show the opposite.

---

## R2. The community pool

I re-proved the invariant `pool ≥ ceil(owed_scaled / 1e12)` from the bundled code:

- `credit` adds `floor(avail·S/w)·w ≤ avail·S` to `owed_scaled` and nothing to the pool; `avail = balance − ceil(owed)` is computed first, so after crediting, `ceil(owed′) ≤ balance`.
- `claim` pays `pay = floor(pending/S)` and subtracts exactly `pay·S` from `owed_scaled`; pool and ceil(owed) fall by the same `pay`.
- `retire` subtracts the vault's full pending (including sub-sat) from `owed_scaled` and touches no pool balance, so the pool only ever exceeds owed afterwards.
- `join` enters at `debt = w·acc` with `carry = 0`, and `JoinWaitingFirst` (checked in `distribute` before any burn, and in `monthly_inline` as a skip) guarantees no `credit` runs between eligibility and join, so the join is exact.
- Counters: `pending_count`/`pending_this_epoch` are incremented at request, decremented at join (count only, since join requires a later epoch) and at retire (both, same-epoch only); `advance_epoch` zeroes `pending_this_epoch`. Suite F21 measures both retire orderings; the BK arms recompute `owed == Σ(weight·acc + carry − debt)` over every record after every money operation.

**Liveness:** no holder can make distributions impossible — eligible waiters can be joined by anyone free, due boosts expired by anyone free (`expire_boosts` is records-only), `PoolShort` cannot arise while the invariant holds, and the frozen-pool case is accepted item 28 with the forfeit path (3c.F0–F3). No defect.

---

## R2b. The $CBOB boost

- **Exactly N distributions.** Bought at epoch `e` with `end = e + epochs`; the boost is live while `dist_epoch < end` and becomes due exactly when `advance_epoch` moves `dist_epoch` to `end`; `BoostsExpireFirst` (in `distribute`) and the wait in `monthly_inline` prevent any further distribution until expiry. The same-transaction orderings are measured both ways (BO.21 `[boost, distribute]` counts the ride as the first of N; BO.35 `[distribute, boost]` does not).
- **Value conservation across weight changes.** `reweigh` sets `carry = owed_of(before)` and `debt = after·acc`, so `owed_of` is unchanged; `expire_boost` = unschedule + `reweigh(0)`; `retire` unschedules from whichever side of due the boost is on. The host test N1 drives 260 epochs (four ring wraps) through the program's own functions against a model rebuilt from the records, with coverage floors that cannot pass vacuously; BO.34/BO.38 measure the wrap and the wrapped early-retire on chain.
- **Counters.** `boosts_active`, `boosts_due`, `boost_weight_total` and the ring are reconciled by the suite's `ledger()` after every money operation (BK arms) and by N1 per epoch. Two live boosts can share an end epoch (the slot counts, correctly); two live boosts cannot share a ring slot with distinct end epochs because `epochs ≤ 63 < 64` and the gate stops the epoch advancing past a due boost — the host test asserts the ring invariant per index.
- **Terms.** `BoostTermsMoved` refuses a move against the buyer and burns nothing (BO.26/BO.30/BO.31); a favourable move lands at the new terms (BO.30a) — the ruled one-sided rule, stated in item 51. Owner-only is enforced by reading the asset's current owner bytes (BO.6, BO.33/33a).

No defect. If a boost could earn N+1, BO.21a/BO.35a (`due == 1` at exactly `end`) would fail; they pass.

---

## R3. The level draw

- `blockhash_in_window` pins the sysvar by key, bounds the count at 512, checks the buffer length against the count, refuses an all-zero hash, and takes the smallest produced slot in `[want, want + 64]`; the host tests exercise skipped slots at A, B and C against an independent model (a local validator skips none).
- The capture deadline arithmetic holds: A ≤ `reveal_slot + 64` and capture closes at `reveal_slot + 300`, so A is always inside the 512-slot buffer when capture is legal; C ≤ ~`reveal_slot + 216`.
- FIFO is `mint_index == revealed_total`; a burned head-of-queue vault still draws (L.11) so the queue cannot stop at it; the attribute re-supply is hash-checked (`AttributesMismatch`, L.4); the 640-byte budget is enforced at mint and a full-budget reveal is measured to fit legacy (L.12).
- **Is SPEC 26 worse than stated?** I checked the two strengthenings: a validator holding adjacent B and C rotations grinds jointly (round 29 A9 already placed this inside item 26's "three different leaders is likely, not guaranteed"), and the cohort effect (same-slot mints share hA/hB/hC) is stated. The lapse re-roll (item 25) composes with nothing new: each re-roll needs a fresh full window of silence, and the alarm pages on reschedules and a stalled queue. HOLDER-GUIDE's honest list now says "can pick among several results... one choice affects every vault created in that moment at once" — consistent with SPEC 26 as corrected. Not worse than stated.

---

## R4. Governance

- The tally chain is: `cast ≥ ceil(quorum·supply)` (never zero), `yes/cast ≥ threshold`, `yes ≥ ceil(10%·supply)`, and for a guardian change or operator arm `yes ≥ ceil(50%·supply)` with the two never bundled (`KeyChangesBundled`). The electorate is frozen at creation (`index_snapshot`, `quorum_supply`); a vault minted mid-vote can neither vote nor raise the bar (`VaultTooNew`, G.6/G.7); the vote is bound to the asset (`VoteRecord` PDA), so transfer-then-vote-again fails (7.8/7.9).
- Ordering is per-kind with logged skips; I verified GOV's restart skip (`stops.*_stopped_at >= created_at`) is the exact complement of MINT's `StopIsNewer` (`< proposal_created_at`), including the same-second tie (round 22). A stop landing between GOV's read and the CPI is impossible — one instruction, one atomic transaction.
- **Frozen forever?** The two permanent-freeze paths are the accepted ones: all vaults redeemed (item 45, corrected by round 24 — a still-open round can mint) and a stolen guardian at <50% turnout (item 47, stated as permanent in that case). I found no third path: proposals need one live vault, execution is permissionless, and `apply_guardian`/`apply_swap_operator` are permissionless after notice with the guardian unable to cancel its own replacement.
- **Minority carries nothing it should not:** the smallest passing ordinary vote at the ruled numbers is 10.71% YES (item 35, stated); key changes need 50% of the snapshot. The proposal-space arithmetic is exact (see R7); a proposal that cannot land is refused at creation against MINT's live values and fixed bounds.

No defect.

---

## R5. The charter claim

- The Merkle scheme in MINT (`merkle_leaf` = sha256(0x00‖key), `merkle_root_from` = sha256(0x01‖min‖max)) is byte-for-byte the bundled `scripts/pob-merkle.mjs` (sorted pairs via the same comparison; odd nodes promoted; the suite has the program verify proofs this module builds, including both ends of the 240-tree in the sim, S2.1/S2.2). Depth-8 proofs against `MAX_POB_PROOF = 16`.
- The PoB checks are: Core-owned AssetV1, owner == signer, update-authority-discriminant == Collection, collection == `pob_collection`, leaf in `pob_root`; the burn is a CPI as the owner in the same instruction; `pob_extra` accounts are passed through never as signers (the metas preserve only writability), bounded at 8, and the crank rides after them.
- **Is SPEC 46 complete?** I re-enumerated the hot wallet's moves: reject-all hook (ends the project), admit-only-mine hook (captures the electorate), per-asset plugins (alarm blind spot, stated), add/remove between alarm passes (stated), move a PoB out of the collection (stated, same brick class), mint a lookalike (refused by the root, C.8), rewrite name/uri (irrelevant — identity is by address), transfer or burn a PoB (refused by Core, round 25 D8 bound). The list in SPEC 46 matches what the key can actually do; I found no omission. The window closes the exposure by clock alone.

No defect.

---

## R6. One-time configuration and the trusted hop

- Every `initialize` is gated on `INIT_AUTHORITY` and runs once (init PDAs; 0.1i/0.2a/0.3a/7.1 and the second-init refusals). I re-checked every bound against the ruled values in `launch/mainnet-init.json`: `max_supply` 2,100 with `level_caps` summing to exactly 2,100; `monthly_secs` 2,592,000 (= `MONTHLY_SECS` cap); `notice_secs` 604,800 (within 60..30d); `redeem_window_secs` 3,600 (within 10s..24h); `min_voting_secs` 259,200; quorum 2,100 / threshold 5,100 (within 500..10,000 / 5,001..7,500); sweep floor 1 SOL / cooldown ceiling 24 h / reserve ceiling 0.1 SOL (within the absolute bounds); sweep 10 SOL / 6 h / 0.05 SOL reserve (within init bounds); boost ceilings 12 / 24 (within 12 / 63). The two OPEN values (charter date, lock deadline) are refused by the checker until set — item 38 stands, including its round-24 A6 caveat that the programs check less than the checker (SEAL reads only owners; off-curve keys accepted). That caveat is accurate; the failure direction is a failed deployment or a dead sweep, not a leak.
- **The trusted hop's worst case** is as stated: operator-signed, `amount ≤ max_sweep_lamports`, one per `sweep_cooldown_secs`, reserve preserved, guardian-stoppable, replacement behind 50%-of-snapshot plus notice with a guardian cancel. Cap × cooldown windows until stopped; never the pool, a vault, or sale cbBTC (mint prices never touch it).
- **The 10% royalty** is installed once with `PluginAuthority::None`; R.5/R.6/R.6a/R.6c prove on control collections that Core refuses update and removal even to the update authority, and R.4 that it is the collection's only plugin. Nothing in our programs carries a second write (0.4h: the instruction is gone).
- **The redemption cap** is exactly a rolling window over a 64-slot ring of timestamps: `k = min(max(cap,1), 64)`, the k-th most recent at `(head + 64 − k) % 64` must be a full window old, and the write happens before the proof but reverts atomically with any later failure, so a failed redemption spends no budget. RL.2/RL.3/RL.4/RL.7 measure it; the 3,047-supply ring bound arithmetic (3,047 × 0.021 → 64) checks out.

No defect.

---

## R7. Cross-program raw reads

I recomputed every offset from the struct definitions:

- **MintConfig (v6):** version 8; collection 9; governance 41; pool_ata 73; minted_total 141; max_supply 149; bank_treasury 157; split_bps 189; sales_stopped 191; sweep_stopped 192; guardian 193; swap_operator 225; sol_reserve 257; bump 265; max_sweep 266; sweep_cooldown 274; last_sweep 282; level_caps 290; level_minted 310; revealed_total 330; payment_mint 338; pob_collection 370; pob_root 402; charter_opens 434; charter_closes 442; charter_claimed 450; bare_burns_retired 454; total_active_weight 462; active_count 470; acc_scaled 478; owed_scaled 494; last_distribute_at 510; sales_stopped_at 518; sweep_stopped_at 526; pending_swap_operator 534; pending_swap_operator_at 566; monthly_secs 574; pending_guardian 582; pending_guardian_set 614; pending_guardian_at 615; notice_secs 623; sweep_floor 631; cooldown_ceiling 639; reserve_ceiling 647; dist_epoch 655; pending_count 663; pending_this_epoch 679... cbob_mint 679; max_boost_weight 711; max_boost_epochs 712; boost_price 714; boost_weight 722; boost_epochs 723; boosts_active 725; boosts_due 729; boost_weight_total 733; cbob_burned_total 741; boost_expiring 749..1005; padding to 1261. Every GOV read (9/41/141/191/192/257/266/274/442/454/518/526/631/639/647/711/712) and every BURN read (141/454) matches, as do the suite's offsets.
- **VaultRecord (v4):** version 8; asset 9; mint_index 41 (GOV's read); level 57; active 125; retired 126; reschedules 127; vault_ata 129; debt_scaled 161; pending 177; request_epoch 178; boost_weight 186; boost_end_epoch 187; carry_scaled 195; 211 bytes + 10 padding = 221 = `VAULT_RECORD_SPACE`.
- **BurnConfig (v4):** version 8; collection 9; bump 41; burned_total 42 (GOV's read); window 50; head 58; ring 59; space 827.
- **SEAL Config (v2):** version 8; collection 9; reserves u32 at 41 — MINT's and BURN's reads match.
- **GovConfig (v4):** proposal_count at 53 (the suite's read) matches.
- **Sweep helper:** mint 0, owner 32, amount 64, length 165 — the classic layout, correct.
- Account spaces: MINT 1,261; VaultRecord 221; BurnConfig 827; GovConfig 350; SEAL Config 398; Proposal 259 (4 + 5×37 actions); VoteRecord 74. All match their constants.

All readers pin address + owner + discriminator + version, so a layout drift refuses loudly rather than misreading. No misread found.

---

## R8. The suite, the simulation and the build as evidence

- **Floors equal counts** (`run-tests.sh` `floor()` uses `-eq`; `MIN_ASSERTIONS = 855`; the sim and fork have their own floors; `assert.equal(count, 4)` in `tests/expiry-budget.mjs`). A deleted assertion or a deleted `ck()` call shows up as a count/label mismatch (BK.* arms require exact label lists).
- **Reason pins** (`because()`) are backed by `attP` keeping `Program <id> failed:` lines, and ID.1 pins id uniqueness so a pin cannot read another arm's error. The arms I would call vacuous were checked and are not: preconditions are pinned (3c.K2p, D.0, F18.0, P.8a, RL.6, S7b.0, S9b.0, S10.0, BO.pre, P.2a), the draw is re-derived independently twice (L.3c from the raw sysvar, L.10/L.23 by re-implementation), and the books are recomputed from records, not from the program's own counters.
- **Claims in the prompt with no arm:** I did not find one. The prompt's R1s(f) question about S8.0's scope is answered by the arm itself (it asserts the 1,084 bound, i.e. 1,232 − 52 − 96, and S8.1a measures CU).
- **Bytes:** `build-mainnet.sh` proves the four keyed programs' behaviour both ways and the helper's byte-identity across `dist/`, the localnet release output and `target/deploy`; `run-tests.sh` deploys from `target/deploy`. The chain "the suite ran the bytes that ship" holds for the helper exactly and for the four programs modulo the documented `INIT_AUTHORITY` swap, which is behaviourally probed both directions.
- **Evidence boundary (stated, not a finding):** the M1 consumer repairs and the 891-assertion selftest are not in this bundle; `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/revenue.mjs`, `bank/crank.mjs`, `bank/layout.mjs`, `bank/accrual.mjs`, `bank/selftest.mjs`, `bank/redemption-poster.mjs` are covered by earlier rounds per the coverage gate but were not re-readable this round. The mainnet probe's 33 assertions and the fork's 16 are logs to me here, not re-runs.

---

## The four questions on the accepted limits

**1. Is any limit worse than stated?** None found. Specifically checked: item 25 (a re-roll still needs a full window of silence per roll; the minter cannot force silence short of the operational stalls already named); item 26 (the adjacent-rotation strengthening is already inside it); item 28 (the frozen-vault, frozen-pool, frozen-revenue and frozen-Squads cases are all stated with their current consequences); item 32 (N unretired bare burns raise the cap by at most `ceil(0.021N)`, round 29 W6's bound, and each costs a destroyed vault); item 40 (the round-28 heap boundary keeps its bounded-observation caveat, and round 29's grid is consistent with it); item 46 (complete, per R5); item 47 (the permanence at <50% turnout is stated); item 55 (bounded by the crank while it runs, alarmed when it does not).

**2. Is anything listed as a limit not actually a limit?** Nothing found. The discharged items I could check against this tree are genuinely closed: 14 (DuplicateAttribute refused, 11.4), 19 (no activated-but-unlevelled state exists), 30/31/33 (the code shapes they describe are gone or exercised), 51 (the boost is built and measured), 54 (measured), 12/17 (measured). The v5 Bank/deck/distributor family is absent from the bundled code.

**3. Is any DISCHARGED item not actually discharged?** None found in the bundled evidence.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52 and 53 are still named OPEN in SPEC and re-listed as open launch obligations in round 29's VALIDATION.md ("Live launch dates, holder surfaces, the Phantom ceremony, the both-venue revenue cycle and forced post-sweep recovery remain open launch obligations"). Item 50's "the holder guide may not be published before this item ships" is consistent with the guide's DRAFT mark and its "(being built)" wording for the redeem page.

---

## Finding

### INFO — GOV's `ACTION_MAX_BYTES` comment misstates three of the five action sizes

**Construct:** `programs/cbob-vault-gov/src/lib.rs`, the comment above `ACTION_MAX_BYTES`: "`SetRound` 1+28, `TightenSweep` 1+27, `ArmSwapOperator` 1+32, `SetBoostTerms` 1+11."

**What it is:** the Borsh sizes are `SetRound` = 1+8+8+8+4 = **29**, `TightenSweep` = 1+9+9+9 = **28**, `ArmSwapOperator` = 1+32 = **33**, `SetBoostTerms` = 1+8+1+2 = **12**. Only the maximum matters and it is correct (`Brakes` = 1+3+33 = 37), so `ACTIONS_SPACE = 4 + 5·37 = 189` and the 259-byte proposal account are right; the suite measures real four- and five-action transactions (E.3a, E.7). **What an accident gains:** nothing today; the risk is a future reader trusting the per-action figures in a space or packet calculation — this project's history includes exactly that class of misread. **Evidence if right:** serialize each action; the byte lengths are 29/28/33/12, not 28/27/32/11. **Fix:** correct the comment. Note the tradeoff: any edit under `programs/` resets the freeze (ship gate 2), so if the tree is otherwise frozen this should be recorded and fixed only if the tree is reopened for a substantive defect — a comment cannot change the compiled bytes.

---

## Anything else

- `scripts/rehearsal-tree.sh`, `scripts/token-programs.sh`, `tests/expiry-budget.mjs`, `sim/fixtures.mjs`, `sim/clone-pob.mjs`, `scripts/pob-merkle.mjs`, `scripts/probe-mainnet-facts.mjs`, `tests/cpi-wrapper/` were read whole (several for the first time this round, per the L1 repair). No defect found in any of them. The fixture patches are asserted byte-range-bounded; the rehearsal reverse-map proof and abbreviated-id refusal are sound; the expiry-budget gate's synthetic genesis is honestly labelled as not-full-lifecycle evidence.
- The oracle fixtures in `run-tests.sh` are validated by behaviour (OR.2/OR.4/OR.5 both directions against the real Core binary), so their byte layout is measured rather than assumed.
- `tests/fixtures/mainnet-v1.json` is consistent with the reader's v1 schema (transactionConfig present, all keys transaction-sourced).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what AI audit structurally cannot do, and what to do before launch

1. **A second-party reproducible build, on a different machine, by a different person.** `build-mainnet.sh` itself states the residue: "NOT PROVEN that the compiled constant IS that key... The bridge is reproducibility." No AI round can attest the build host, the SBF toolchain or the linker weren't tampered with. Rebuild from the frozen commit on a clean machine and require the five sha256 values to match `dist/SHA256SUMS` before deploy. This is the single highest-value remaining act; it closes the one gap the suite structurally cannot.
2. **Run the dress rehearsal (item 22) for real, including the two named failure drills.** No local validator exercises real RPC rate limits, real DAS, real Pyth, real pool state, or a 2,100-vault crank pass. The forced post-sweep failure walked through hand recovery, and the both-venue live revenue cycle, are operational facts no test suite produces. Do not let the rehearsal be judged by whether the scripts exit 0 alone; a human should read the ledger and the alarm output for sense.
3. **A human reads the four `initialize` transactions' decoded arguments against `launch/mainnet-init.json` on an independent screen before signing, and reads the five configs back on chain afterwards.** The checker validates the JSON, not the signed transaction (round 24 A6). The same human verifies on chain that all five upgrade authorities are `None` after the lock ceremony. These are two-person ceremonies; write the checklist now.
4. **The redeem page (item 50) tested with real wallets — Phantom and Ledger — including the simulation preview a holder actually reads.** The suite uses raw keypairs. The realistic loss vector left in this system is not a program bug; it is a holder signing what they did not understand. That is a UX fact no program test covers, and item 50 is OPEN AND BLOCKING.
5. **A public, time-boxed review window with a bounty after the freeze.** The freeze gate measures AI rounds; it cannot measure "no adversarial human in the world found anything." Two to four weeks with the tree published and a meaningful bounty is the only mechanism that buys human adversarial attention, which is the one thing this process has never had.
6. **A chaos drill on the operations box.** Kill the crank mid-pass, hang an RPC socket (round 25 A1 measured one hung socket at 300.8 s — longer than the reveal window), fill the disk, expire the alert-router credentials, and watch whether the alarm pages and the lanes recover. Items 6/7/25 show the operational layer is where the remaining risk concentrates; AI audit reads it but cannot operate it.
7. **Key-custody verification by a human, physically.** The $CBOB release wallet (item 56), the swap operator key, the guardian key and the PoB collection hot wallet (item 46): a person must confirm where these keys actually are, who has logged into the box, and that the backups are what the documents say. AI audit reads "mode 600"; it cannot know who else has the file.
8. **An incident runbook for the third-party upgrade keys, rehearsed.** Core, Orca, Meteora and Pyth are all upgradeable by keys you do not hold (item 40, item 10(d)). The alarm detects; it cannot decide. When Core upgrades, someone must already know who decides whether to keep operating, and what "stop" means when the guardian's brake does not reach redemption or the pool. Rehearse that decision once before launch, not during it.
9. **The DAS behaviour check (item 22.5).** Whether DAS sets `burnt` on a burned Core asset determines what the nested-vault detection can see. One read against a real collection settles it; no local test can.
10. **A non-author human read of HOLDER-GUIDE.md against the code, as a contract.** AI rounds check whether sentences are true of the code; a lawyer/product reader must judge what plain-English sentences like "Only you can open it" promise a holder. That is a different question, and no one has asked it.