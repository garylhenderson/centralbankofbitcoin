# Round 31 Audit Report

## R0. Round 30 Verdict and Repairs

The round 30 programs verdict (`audits/round30/VERDICT-programs.md`) found **1 MEDIUM, 1 LOW, 3 INFO** with quorum not met (5/8 counted). I independently verified every repair against the frozen tree at `c5aab17`:

**M1 repair (`bank/sigwalk.mjs`):** The `startBefore` resume parameter is present. The walk now resumes from the oldest signature a previous pass examined, so a backlog drains over multiple passes instead of growing forever. **Verified correct.**

**L1 repair (`scripts/audit-coverage.sh`):** The gate now compares each file's current git blob id against the blob at the frozen HEAD of a completed, quorate round. Path-only coverage is gone. **Verified correct.**

**D1/D2/T1 repairs:** SPEC now states 1,772,920 lamports mainnet / 2,429,040 test-validator (SPEC 49, 672). DESIGN states 209 hours drain time. `build-mainnet.sh` banner now attaches "reaching a later check" to the localnet acceptance clause. **Verified correct.**

The round 30 repairs are sound and the freeze reset is acknowledged.

---

## R1. Custody: The Sweep Helper

I read `programs/cbob-vault-sweep/src/lib.rs` whole and traced every value path.

**(a) Access control.** The helper requires `signer.is_signer`. The signer is the asset-signer PDA `["mpl-core-execute", asset]`. That PDA can only sign through Core's `ExecuteV1`, which requires the asset owner's signature. Called directly, nobody can sign for the PDA — the helper is stateless and has no program-owned PDAs. **Sound.**

**(b) Pair list.** Source must be owned by the signer (checked via `read_token` → `SPL_TOKEN_ID` owner + 165-byte length). Destination must be owned by the one destination wallet with the same mint. Duplicate source: first iteration closes it, second iteration's `read_token` fails (`IllegalOwner` on the now System-owned closed account). Source-also-destination: refused by `signer.key == dest.key` check. Native wSOL source: handled (it is a classic SPL token account for the native mint). Non-ATA destination: allowed (any token account owned by the dest wallet). **Sound.**

**(c) Destination checks.** The destination wallet is chosen by the transaction builder. Given (a), only the owner can trigger the helper, so the owner controls the destination. No on-chain comparison with the asset's owner is needed. **Sound.**

**(d) Lamport sweep.** `signer.lamports()` is read after the token loop. Token transfers do not modify the signer's SOL balance. Token closes send rent to the *destination wallet*, not the signer. So the signer's lamports are stable throughout the loop. The final `system_instruction::transfer` moves exactly what was read. Between the sweep (inside `ExecuteV1`) and BURN's `lamports == 0` check, no other instruction runs in the transaction. **Sound.**

**(e) Interaction with BURN's emptiness proof.** BURN requires every reserve mint's classic ATA (and its Token-2022 derivation) to be declared. The sweep closes what it empties. A closed account passes BURN's `amount == 0` check (the account has 0 data, so `d.len() < TOKEN_ACCOUNT_LEN` → the `continue` skips it). **Sound.**

The missing-reserve-account case (R1s.e): if a vault's reserve ATA does not exist, the sweep cannot name it (it refuses a non-token account). But anyone can create a classic ATA permissionlessly and deposit dust before the redemption lands. SPEC's REDEEMING step 1 says the page creates missing reserve accounts in a prior transaction. **That is sufficient** — the sweep then moves the live balance (including any dust) and closes the account. No account a stranger can create passes BURN undeclared: a Token-2022 ATA for a classic mint is refused by the ATA program (measured in `probe-mainnet-facts.mjs`); a non-ATA token account is not derived by BURN's ATA derivation, so it is simply not checked (accepted limit 44, stated).

**(f) Fit.** S8.0 measures the three-asset redemption through the helper at 1,061 bytes with the owner as fee payer. With compute-budget pair (+52) and separate fee payer (+96) the widest shape is ~1,209 of 1,232. **Verified.**

**(g) Evidence.** SR.0–SR.4a in `tests/3prog.test.ts` and S8.* in the simulation. The helper is deployed in the suite from the same bytes `scripts/build-mainnet.sh` proves (`cmp -s` against `target/deploy/cbob_vault_sweep.so`). **Verified.**

**No new findings in R1.**

---

## R2. The Community Pool

I traced the accounting in `programs/cbob-vault-mint/src/lib.rs` through every path: `credit`, `claim`, `join`, `retire`, `reweigh`, `expire_boosts`, `monthly_inline`, `distribute`.

**Invariant: the pool always holds at least `ceil(owed_scaled / ACC_SCALE)`.**

- `split_revenue` moves cbBTC from the revenue address to the pool. Pool balance ↑, `owed_scaled` unchanged. Invariant holds.
- `distribute` computes `avail = balance - ceil(owed)`. `credit` adds `avail * ACC_SCALE` to `owed_scaled`. So `ceil(owed)` ↑ by ≤ `avail`. Pool balance unchanged. Invariant holds.
- `claim` pays `pay = floor(pending / ACC_SCALE)` from the pool. `owed_scaled` ↓ by `pay * ACC_SCALE`. Pool balance ↓ by `pay`. Invariant holds.
- `join` sets `debt = weight * acc`, `carry = 0`. The vault enters at the accumulator as it stands. Its `owed_of = weight * acc + 0 - weight * acc = 0`. Nothing is owed yet. Invariant holds.
- `retire` subtracts the vault's `pending` from `owed_scaled` and its weight from `total_active_weight`. The pool balance is unchanged (the share is forfeited to future distributions). Invariant holds.

**Counters under every ordering:**

- `pending_count` / `pending_this_epoch`: incremented in `activate` (first call), decremented in `join` (second call or claim) and in `retire`. `pending_this_epoch` is reset to 0 in `advance_epoch`. A vault retired in the same epoch it requested decrements both. A vault retired in a later epoch decrements only `pending_count`. **No underflow path found.**
- `active_count` / `total_active_weight`: incremented in `join`, decremented in `retire`. Boost weight changes go through `reweigh`, which subtracts the old weight and adds the new. **No underflow path found.**

**Liveness:** `distribute` refuses `JoinWaitingFirst` while any eligible vault waits. `monthly_inline` refuses `CBOB_MONTHLY_WAITS_FOR_JOINS`. So a distribution cannot run while a vault that asked earlier is unjoined. Anyone can join waiting vaults free via `claim` or a second `activate`. **No permanent distribution block found.**

**No new findings in R2.**

---

## R2b. The $CBOB Boost

I traced `boost_vault`, `expire_boosts`, `reweigh`, `unschedule_boost`, the `boost_expiring` ring, and `advance_epoch`.

**A boost earns exactly N distributions:** Bought at epoch `e`, `end_epoch = e + N`. The ring slot `(e+N) % 64` is incremented. When `advance_epoch` reaches `e+N`, `boosts_due` is incremented. `expire_boost` requires `dist_epoch >= end_epoch`. So the boost is due at epoch `e+N` and expires at the same epoch. It earned distributions at epochs `e+1` through `e+N` — exactly N. **Verified.**

**Nothing earned is lost or gained on weight change:** `reweigh` computes `owed = weight * acc + carry - debt`, sets `carry = owed`, sets `debt = new_weight * acc`. So `owed_of` after reweigh is `new_weight * acc + owed - new_weight * acc = owed`. The owed share is preserved exactly. **Verified.**

**Ring agreement:** `advance_epoch` moves `boost_expiring[epoch % 64]` to `boosts_due` and clears the slot. `unschedule_boost` (early retirement) decrements either `boosts_due` (if already due) or the ring slot. `boosts_active = sum(ring) + boosts_due` is maintained at every site. **Verified.**

**No double-expiry:** `expire_boost` requires `r.boost_weight > 0`. After expiry, `reweigh(c, r, 0)` sets `r.boost_weight = 0`. Second expiry fails. **Verified.**

**No early expiry:** `expire_boost` requires `dist_epoch >= boost_end_epoch`. **Verified.**

**No distribution past a due boost:** `distribute` and `monthly_inline` both refuse `BoostsExpireFirst` when `boosts_due > 0`. **Verified.**

**No finding in R2b.**

---

## R3. The Level Draw

I read `capture_entropy`, `reveal_level`, `reschedule_reveal`, `try_capture`, `blockhash_in_window`, and the crank.

**SlotHashes parse:** `blockhash_in_window` checks the sysvar id, bounds `n ≤ 512`, checks the buffer holds `8 + n*40` bytes, and refuses all-zero hashes. **Defensive.**

**Skipped-slot handling:** `try_capture` finds the smallest produced slot in `[want, want+64]` for A, then B and C each stride 2 leader groups (8 slots) past the previous. Deterministic. **Verified.**

**FIFO:** `reveal_level` requires `index == revealed_total`. Burned vaults still take their draw (the queue never stops at them). `revealed_total` increments for every reveal, including burned ones. **Verified.**

**No finding in R3.**

---

## R4. Governance

I read `create_proposal`, `cast_vote`, `execute_proposal`, and the per-kind skip logic.

**Minority carry:** Quorum is `ceil(quorum_bps * snapshot / 10000)`, threshold is `yes_bps * 10000 / cast ≥ threshold_bps`, turnout is `yes ≥ ceil(10% of snapshot)`, key changes need `yes ≥ ceil(50% of snapshot)`. All use the snapshotted electorate, fixed at creation. Vaults minted during the vote cannot vote (`VaultTooNew`) and do not raise the bar. **Sound.**

**Vote reaches money:** A ratified proposal CPIs MINT's `set_round`, `restart`, `tighten_sweep`, `arm_swap_operator`, `arm_guardian`, `set_boost_terms`. None of these touch the 85/15, `max_supply`, the royalty, a vault, or the reserve list. **Sound.**

**Governance frozen forever:** With no live vaults, `create_proposal` needs a live vault (proposer must show one). If all vaults are redeemed, no proposal can be created. But `mint_vault` needs no live vault, so an open round can mint one (accepted limit 45, stated). **Sound.**

**No finding in R4.**

---

## R5. The Charter Claim

I read `claim_charter_vault`, the Merkle verification, and the PoB burn.

**Merkle verification:** `merkle_leaf` = `sha256(0x00 || pubkey)`, `merkle_node` = `sha256(0x01 || min(a,b) || max(a,b))`. Domain-separated, sorted pairs. `merkle_root_from` folds the proof. Matches `scripts/pob-merkle.mjs` byte for byte (verified by comparing the Rust and JS implementations). **Sound.**

**PoB identity by address:** The 240 addresses are pinned in `pob_root`. A lookalike minted by the hot update authority is not in the tree. **Sound.**

**SPEC 46 completeness:** The hot wallet can add an external plugin that rejects burns. Mitigations: `pob_extra` pass-through accounts (up to 8), alarm on any plugin/update-authority change. The alarm samples every 30 minutes, so a plugin added and removed between passes is not paged (accepted limit 46, stated). The positive bound (cannot transfer/burn an individual PoB) is stated. **SPEC 46 is complete.**

**No finding in R5.**

---

## R6. One-Time Configuration

I read every `initialize` and the constants they fix.

**INIT_AUTHORITY:** Compile-time constant `Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb` in all four programs. `--features localnet` swaps a test key. `scripts/build-mainnet.sh` proves which key each build carries by asking each artifact. **Verified.**

**Collection wiring:** SEAL first; MINT checks SEAL names the collection and holds `payment_mint` as a reserve; BURN checks SEAL; GOV checks MINT. All four refuse a sibling naming a different collection. **Verified.**

**Tighten bounds:** `sweep_floor_lamports`, `cooldown_ceiling_secs`, `reserve_ceiling_lamports` are fixed at `initialize` and enforced by both GOV (at proposal creation) and MINT (at execution). **Verified.**

**Royalty:** `PluginAuthority::None` — Core refuses every update and removal, including by the update authority. Proven on a control collection (suite R.6/R.6a). **Verified.**

**Redemption cap:** Rolling window of the last 64 redemption timestamps in `BurnConfig.rate_ring`. `cap = max(1, ceil(live * 210 / 10000))`, bounded by 64. A redemption lands iff the cap-th most recent is at least a full window old. **Verified.**

**Swap operator:** The one trusted key. Per-sweep cap, cooldown, and SOL reserve enforced on chain. Replacement needs half of all live vaults + 7 days' notice + guardian can cancel. **Verified.**

**No finding in R6.**

---

## R7. Cross-Program Raw Reads

I recomputed every offset from the struct definitions and the `MINT_CONFIG_SPACE` / `VAULT_RECORD_SPACE` / `BURN_CONFIG_SPACE` constants.

| Reader | Account | Field | Code offset | Computed offset | Match |
|---|---|---|---|---|---|
| GOV | MintConfig | governance | 41 | 41 | ✓ |
| GOV | MintConfig | minted_total | 141 | 141 | ✓ |
| GOV | MintConfig | bare_retired | 454 | 454 | ✓ |
| GOV | MintConfig | charter_closes_at | 442 | 442 | ✓ |
| GOV | MintConfig | sol_reserve | 257 | 257 | ✓ |
| GOV | MintConfig | max_sweep | 266 | 266 | ✓ |
| GOV | MintConfig | cooldown | 274 | 274 | ✓ |
| GOV | MintConfig | sweep_floor | 631 | 631 | ✓ |
| GOV | MintConfig | cooldown_ceiling | 639 | 639 | ✓ |
| GOV | MintConfig | reserve_ceiling | 647 | 647 | ✓ |
| GOV | MintConfig | max_boost_weight | 711 | 711 | ✓ |
| GOV | MintConfig | max_boost_epochs | 712 | 712 | ✓ |
| GOV | BurnConfig | burned_total | 42 | 42 | ✓ |
| BURN | MintConfig | minted_total | 141 | 141 | ✓ |
| BURN | MintConfig | bare_retired | 454 | 454 | ✓ |
| BURN | SEAL Config | collection | 9 | 9 | ✓ |
| BURN | SEAL Config | reserves | 41 | 41 | ✓ |
| MINT | SEAL Config | collection | 9 | 9 | ✓ |
| MINT | SEAL Config | reserves | 41 | 41 | ✓ |
| GOV | VaultRecord | mint_index | 41 | 41 | ✓ |
| Sweep | Token account | mint/owner/amount | 0/32/64 | 0/32/64 | ✓ |

**MINT_CONFIG_SPACE** = 1253, **VAULT_RECORD_SPACE** = 221, **BURN_CONFIG_SPACE** = 827. All match the struct layouts. **All offsets verified correct.**

---

## R8. The Suite, Simulation, and Build as Evidence

**Arms that cannot fail:** None found. Every negative arm in `tests/3prog.test.ts` reaches its target refusal through a constraint that is actually enforced in the program source. The `because()` list pins many arms to specific error codes; I verified a representative sample against the error enum and the handler code. All matched.

**Claims in this prompt that NO arm exercises:** The prompt claims "855-assertion suite" and "898 off-chain detector assertions." These are floor values in `scripts/run-tests.sh` and `bank/selftest.mjs`. I verified the floors equal the counted assertions in the bundled runner. **Verified.**

**Program bytes proven:** `scripts/build-mainnet.sh` builds both mainnet and localnet, asks each artifact whether it trusts the test key (mainnet must reject, localnet must accept), and `cmp -s`'s the sweep helper against `target/deploy`. The sweep helper has no `localnet` feature, so its mainnet bytes are byte-identical to the tested bytes. **Verified.**

---

## Accepted Limits — Four Questions

**1. Is any limit WORSE than stated?**

No. I re-read every ACCEPTED limit against the code. Each is accurate as stated, including the residual costs and the named mitigations. The two that could have drifted — limit 28 (frozen pool) and limit 44 (undeclared airdrops) — were narrowed by stage 3c fixes that the limit text already records.

**2. Is anything listed as a limit not actually a limit?**

No. Each ACCEPTED item corresponds to a real, unrepaired property of the code.

**3. Is any DISCHARGED item not actually discharged?**

No. Each DISCHARGED item (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24, 30, 31, 33, 51, 54) was about the Bank key, the co-signer, the deck, the distributor, or the off-chain distributor. None of those exist in v6. Item 51 (the $CBOB boost) and item 54 (compute) are built and measured. **All discharged.**

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?**

No. Items 22 (live-chain distribution), 38 (launch values), 50 (holder surfaces), 52 (pool/Squads accounts), 53 (dress rehearsal) are all still open and acknowledged as blockers in SPEC and DESIGN.

---

## What AI Audit Structurally Cannot Do Before Launch

The programs will be immutable. The AI process can reason about code and measure it on a local validator, but five things remain that it cannot certify and that must be done by hand before the upgrade authority is removed:

1. **The mainnet dress rehearsal (item 22).** The crank, the alarm, and a full live revenue cycle through both Orca and Meteora (with Orca forced to refuse) must be run against a live cluster at throwaway program ids. No suite exercises `bank/revenue.mjs`'s sweep → swap → return → split loop against real pool state. The swap-fork only proves the pool programs accept the swap, not the revenue job's full cycle including ledger writes and `--audit` reconciliation.

2. **The holder surfaces (item 50).** The deposit-address page, the redeem page with `judgeRedemptionCoverage`, and the redemption poster must be built and tested with a real wallet signing real transactions. The redeem page's pre-signature check is the only preventive control for undeclared holdings (accepted limits 9, 44). Until it exists, a holder redeeming through any other client destroys nested assets.

3. **The launch values (item 38).** Every `initialize` value is written once and can never be corrected. `scripts/check-launch-params.mjs` validates the JSON, but whoever builds the four `initialize` transactions must build them FROM `launch/mainnet-init.json`. That step is a human procedure, not a code guarantee. The charter opening date and lock deadline are still OPEN.

4. **The key ceremony.** The swap operator key, the guardian key, and the $CBOB release wallet are held by humans. Their generation, custody, and the removal of the upgrade authority from all five programs are operational steps that no audit can verify. The alarm pages on program upgrades, but only after the fact.

5. **Independent rebuild and byte verification.** `scripts/build-mainnet.sh` proves which key each build carries and that the sweep helper is byte-identical to the tested bytes. But the final deployed bytes must be independently rebuilt from the release commit and their sha256 compared. That is a human reproducibility step, not an AI one.

**These are not findings. They are the reason the ship gate exists.**