# ROUND 34 AUDIT — v6 whole tree, five programs + off-chain pipeline

**Verdict up front: no surviving defect found.** Round 33's verdict is accurate and its repairs are present, correct, and regression-free at every site. I traced every target below from the source in this bundle, not from the prior verdicts. Where I claim something holds, I name the construct and the arm or trace that would show otherwise. Two INFO-level notes, neither a program defect. I am not confirming the author's work; I am reporting that I could not break it, with the evidence a skeptic needs to check me.

---

## R0. ROUND 33'S VERDICT AND ITS REPAIRS — VERIFIED, ALL SITES

Round 33 confirmed 1 LOW + 3 INFO and left three gate-5 obligations. Against this tree:

**L1 (pre-funded program id blocks `solana program deploy`)** — repaired as a runbook change, no program change, which is the right shape. SPEC road step 9 now carries the pre-deploy read of all five ids, the measured recovery (program keypair signs System `Allocate(36)` + `Assign(BPFLoaderUpgradeable)`, then `write-buffer` + hand-built `DeployWithMaxDataLen`), the 890,880-lamport dust floor, the top-up to the 36-byte rent minimum (1,141,440), and the honest marker that the top-up case is "reasoned, not yet measured" and must be rehearsed at a throwaway id. Present as written.

**D1 (SPEC REDEEMING step 1's categorical "does not fit")** — repaired. Step 1 now reads "separate by contract (limit 42): the fully padded page shape with all three creates does not fit a legacy packet (1,367 bytes), although a narrow owner-payer shape does (1,219 bytes, round 26 D4; an offline size measurement, not a landed transaction)". This matches limit 42's wording exactly. I checked for other sites of the same sentence: the "Known limits" reserve-ceiling passage and item 42 both already carry the narrow-shape caveat. No surviving site.

**D2 (DESIGN-v6 "`MIN_ROUND_PRICE_SATS`, fixed at `initialize`")** — repaired. DESIGN-v6 §6a now reads "a constant compiled into the program (no `initialize` argument sets it)". Verified against `programs/cbob-vault-mint/src/lib.rs`: `pub const MIN_ROUND_PRICE_SATS: u64 = 21_000`, checked in `set_round` (`PriceBelowFloor`); no initialize parameter touches it. SPEC was already correct.

**D3 (suite arm 2.1 could not fail)** — repaired. `tests/3prog.test.ts` now records `rec('2.1','a vault minted in a voted round','ALLOW',vMint.ok?'ALLOW':'REJECT',vMint.err)`. The arm now measures the mint's own outcome. R31.W2b independently records `vMint.ok`, and 2.2/2.2a would fail on a missed mint, so detection was never lost — but the arm now means what its label says.

**Gate-5 obligations — discharged:**
- **W1(a) → R33.G1**: the vault carrying the full 640-byte attribute budget (`exact()`) plus the 10,198-byte owner autograph (written via the wrapper's `PADTAIL!` mode) must be revealed by MINT in FIFO order at the default compute budget. Fail-closed: `worstShape ? … : 'no vault'` fails if the shape was never built, and `worstShape` is set only `if(at.ok)` (L.12b's budget mint must have landed).
- **W1(b) → R33.G2a/G2b**: strangers grow an autograph one PDA-signature at a time via the wrapper's new `SIGSPDA!` mode until Core's heap refuses; G2a requires `kept>=20`, a heap-shaped refusal naming Core's program, and `now===kept`; G2b requires MINT to have revealed that vault with every kept signature. The wrapper's `SIGSPDA!` arm is present in `tests/cpi-wrapper/src/lib.rs` and builds the n-signature update with the n-th PDA signing via `invoke_signed`.
- **W2 → R33.G3**: re-delegation of the None-authority royalty refused with Core 0x1b (`CannotRedelegate`), control (UpdateAuthority-held royalty re-delegated) lands. Both directions.
- **R33.G4** (the round-33 wSOL repair's evidence): a stranger's pre-created, pre-filled wSOL account closes under the swap's own `swapInstructions` list (loaded through a node child to avoid the crank's top-level await — the failure mode VALIDATION records for the first attempt), returning the stranger's 0.5 SOL to the operator. Checks the full list is 7 instructions, the account ends closed, and the operator's gain covers the stranger's lamports.

**Floor accounting**: 861 + 5 (G1, G2a, G2b, G3, G4) = 866 = `MIN_ASSERTIONS`, with the comment chain updated ("ROUND 33 … 861 -> 866"). Arm 2.1 was modified, not added. Consistent. Detector floor 909 matches the prompt's stated count and VALIDATION's post-fix 909/909.

**Round 33's refutations, spot-checked for correctness**: W3 (DESIGN:107 does read "recorded in its MINT `VaultRecord`") — true of this tree. W6 (SR.12a's reason is pinned separately via `because('SR.12a', 'Program <helper> failed: Provided owner is not allowed')`, and SR.12b asserts the refusal did NOT come from the first source-owner guard) — true. A15 (GLM F2, the multi-vault redemption ordering) — I re-derived it: the failing shape requires the second vault's redemption to omit its `claim` after the first burn's trailing `monthly_inline` credited it; with the claim present (the client contract's shape) it lands. "Reverted, retryable self-grief in a shape the client contract does not use" is the correct disposition.

**No regressions from the repairs found.** The new suite code sits inside section 11's L.12 block; the shapes it builds are revealed by the subsequent `revealAll()` before G1/G2b read them; ordering is sound.

---

## R1. CUSTODY — THE PAIRING HOLDS

I attacked the pairing on every axis named:

- **CPI wrappers**: `load_instruction_at_checked` sees top-level instructions only, in both directions. SEAL's forward walk fails closed (`found` stays false on any `Err`). BURN's backward walk skips unloadable indices, also fail-closed. `retire_redeemed` demands stack height exactly `TRANSACTION_LEVEL_STACK_HEIGHT + 1` AND the top-level instruction at the current index being BURN's `burn_vault` with this asset at account 0. WR.1–WR.4 measure all four wrapper shapes refused with the vault intact.
- **Two vaults, one transaction**: both halves bind asset (account 0) AND owner (account 2); 3.9, 3.10, 4.10, 9.0 measure cross-borrowing refused. Account indices pinned by 3.1c–3.1f against the source constants.
- **A thawed vault leaving unburned**: impossible by construction — the thaw and the burn are one atomic transaction; a failed burn reverts the thaw. There is no re-seal and no close.
- **Emptiness proof**: reserve loop requires every reserve mint's ATA under BOTH token programs declared (`ReserveNotDeclared`); skips non-token-owned accounts (a stranger's pre-funded system account at the ATA address cannot block); refuses non-165 length (`ReserveHasExtensions` — a Token-2022 ATA is 170, measured F4.1), delegate/close-authority bytes (D2 probe: the 4-byte COption tag reads None after revoke), and any balance. Second loop refuses a declared live Core asset (`VaultStillHoldsAVault`) and applies the same three checks to any declared PDA-owned token account. A burned tombstone (1 byte, key 0) and a collection (key 5) pass the second loop for the right reason.
- **Rate limit**: recomputed. `cap = max(1, ceil(live × 210/10000))`, `k = min(cap, 64)`, kth-most-recent at `ring[(head + 64 − k) % 64]` — correct indexing; `now − kth ≥ window` with `checked_sub` failing closed on a future timestamp; ring init `[0;64]` admits the first cap; `burned_total` increments after the check so the redeeming vault counts in its own `live`. RL.2/RL.3/RL.4/S10.* measure the boundaries; RL.7 replays the ring.

No path lets anyone but the owner get value out of a sealed vault, and no emptied vault survives.

---

## R1s. THE SWEEP HELPER — HOLDS ON EVERY ARM NAMED

**(a) Access control.** Direct call: `accounts[0].is_signer` required; the asset-signer PDA can sign only via Core `ExecuteV1`, which (pinned Core, measured SR.5/SR.5a/SR.5c) approves only the asset's owner — a stranger and an owner-added transfer delegate get 0x1a, the collection update authority gets 0x1a on the control asset, the owner succeeds (SR.5d). While frozen, Core's PermanentFreezeExecute rejects Execute (3.7, D5.3, S6.2, all pinned to Core's own error). The thaw exists only inside a transaction ending in this vault's burn, so the helper is reachable only inside a genuine redemption. SR.5e verifies the refused attempts left balances, owner and seal intact.

**(b) Pair list.** Same source twice: the first pair closes it; the second pair's `read_token` fails on the closed account — SR.12a refused with `Provided owner is not allowed`, and SR.12b proves the refusal came from the second (closed) source, not the first guard. Source-is-destination is impossible (`src_owner == signer`, `to_owner == dest`, and `signer != dest` is enforced). A wSOL source is an ordinary 165-byte classic account — same path (untested as a shape; round 33 A10 lists it as optional, which is the right call). Frozen source: transfer reverts 0x11, whole redemption reverts (SR.14, both program errors pinned); a frozen ZERO-balance source is only closed (measured round 30, limit 44). Destination not an ATA: allowed — any same-mint classic account owned by the destination wallet; the owner's signed choice. Destination = the vault's own asset-signer: refused (`signer.key == dest.key` → InvalidArgument, SR.10). Destination = another vault's asset-signer: allowed by the helper, the owner's signed choice, item 50's client contract says the page must check. Odd account count: `(len−4) % 2 != 0` → NotEnoughAccountKeys (SR.7). Zero pairs: lamports-only sweep lands (SR.13, with the `CBOB_SWEEP lamports=` log line checked against the wallet's measured balance).

**(c) Destination checks.** The destination wallet is the signer's choice; given (a), that is safe — Core admits only the owner, so the signer IS the owner. Lamports to a nonexistent destination below rent exemption fail the transaction (item 50: "a lamports-only sweep needs a destination that exists; the canonical destination is the owner, who pays the fee and so exists"). Lamports to a non-system account land fine, token data untouched (R27.S1, measured).

**(d) Lamport sweep.** `signer.lamports()` is read at execution, after the pairs; closes send rent to `dest`, not the signer, so nothing inflates the figure between read and transfer. Core adds nothing to the PDA after the inner instruction. BURN's `lamports() == 0` sees exactly what the sweep left — measured end-to-end by SR.4/SR.4a (exact lamport delta: stranger's 1,000,000 + prior wallet balance + closed-account rent + asset rent returned by the burn − fee) and S8.1. A later depositing instruction exists only if the owner's own transaction carries one — self-inflicted, outside the page's shape.

**(e) Interaction with BURN's proof.** A closed account is skipped by both loops for the right reason (modern spl-token's `CloseAccount` reallocs to 0 and assigns to the system program; the suite's redemptions with closed declared accounts land — SR.4, 3.3a, S8.1 — so this is measured, not argued). A missing reserve ATA: the page creates it in the prior transaction (item 42/50); a stranger creating it first with dust makes the burn refuse `VaultNotEmpty`, which is the designed failure, and the helper then sweeps it next attempt. The stranger-creatable account inventory: a Token-2022 ATA for a classic mint cannot exist (F4.2, and the mainnet probe asserts `IncorrectProgramId` per reserve mint); a Token-2022 ATA for a T22 mint is 170 bytes — declared, it's refused; undeclared, it's destroyed (limit 44); a non-ATA classic account owned by the PDA is sweepable by the helper when named with a same-mint destination (limit 25 D7) and destroyed if undeclared; a nested Core asset blocks when declared and is destroyed when not (limits 9/44, the accepted blind spot). **No stranger-creatable account both blocks redemption and is unsweepable/unskippable, except the nested Core asset, which is the accepted limit.**

**(f) Fit.** S8.0 measures 1,061 bytes for claim + open + three-reserve helper sweep + burn with the owner paying; +52 (compute pair) +96 (separate fee payer) = ~1,209 of 1,232, 23 spare. S8.1a measures 168,343 CU against the 800,000 default for four instructions. A fourth reserve is impossible (`MAX_RESERVE_MINTS = 3`, fixed at init, 9.14/9.15/9.16 pin it to the measurement). The in-line monthly run's account (the pool, through BURN into `retire_redeemed`) is inside the measured shape.

**(g) Evidence.** SR.0–SR.14 each pin a distinct refusal to its measured error text; none is vacuous (SR.12b exists precisely to catch a wrong-reason pass on SR.12a). Byte provenance: the sweep crate has no `localnet` feature (its Cargo.toml explains why — a declared feature would change the metadata hash), so the workspace `--features localnet` build compiles it identically to mainnet; `build-mainnet.sh` `cmp`s dist vs `.cache/ln` release vs `target/deploy` (the file the suite and sim deployed). Three-way proven.

---

## R2. THE COMMUNITY POOL — THE INVARIANT HOLDS

**"The pool always holds at least ceil(owed)"**, traced through every mutation:

- `credit`: `owed += (avail × SCALE / w) × w ≤ avail × SCALE`, and `avail = balance − ceil(owed)`, so `owed_new ≤ balance × SCALE`. Holds.
- `claim`: pays `floor(pending/SCALE)`, subtracts exactly `pay × SCALE` from `owed_scaled`; pool balance and `ceil(owed)` fall by the same `pay`. Holds. Frozen destination: skipped, fully owed, logged (P.18/P.18a/P.18b; BO.37 for the frozen-with-due-boost case).
- `join`: `debt = w × acc` at the current accumulator, `carry = 0` — owed zero, exact because `JoinWaitingFirst` guarantees nothing was credited between eligibility and join.
- `retire` (redeemed, not forfeit): refuses `ClaimBeforeBurn` while `pending ≥ SCALE`; subtracts `pending` from owed. Forfeit (pool frozen): subtracts the whole pending, logs `CBOB_REDEEMED_POOL_FROZEN` (3c.F0–F3). `retire_burned`: same subtraction, no claim requirement.
- `reweigh`: `carry = owed_of(old)`, `debt = new_w × acc`; `owed_of` after = `carry` = old owed; `owed_scaled` untouched. Nothing gained or lost across a weight change.

**Counters**: `pending_count`/`pending_this_epoch` incremented at request, decremented at join and at retire (same-epoch vs earlier-epoch branches both handled; F21.1/F21.2 measure a waiting vault redeemed and another bare-burned leaving both counters). `active_count`/`total_active_weight` move only in `join`/`retire`/`reweigh`. The suite's `ledger()`/`books()` recompute every leg from every on-chain record after every money operation (BK.IN/BK.3c/BK.P assert the labels were all pushed, so a deleted check shows as a missing label).

**Liveness**: `JoinWaitingFirst` is clearable by anyone (a free `claim` joins; a bare-burned waiter is cleared by `retire_burned`). `BoostsExpireFirst` is clearable by anyone (`expire_boosts` needs records only — no token account — and can expire a bare-burned vault's boost since its record is still active). A missing vault token account can only exist post-redemption, where the record is retired and skipped before the destination check. A frozen pool stops paying claims but never a redemption (forfeit path) and never a join (join-only claims pay nothing). No one can make distributions or redemptions impossible for others.

---

## R2b. THE $CBOB BOOST — EXACTLY N, NOTHING LOST

- **Exactly N distributions**: bought at epoch e → `end = e + N`; `credit` runs at the old weight, then `advance_epoch` moves the ring count into `boosts_due` when `dist_epoch` reaches `end`; `BoostsExpireFirst` then blocks the next distribution until expiry. So the boost earns the distributions that advance epochs e+1…e+N inclusive — exactly N, the last one included. BO.21/BO.21a ([boost, distribute] in one transaction) and BO.35/BO.35a ([distribute, boost]) measure both orderings on chain.
- **Ring consistency past epoch 64**: `max_boost_epochs ≤ 63 = BOOST_RING − 1` (init-bound, 0.1u refuses 64), so all live end-epochs lie in `(dist_epoch, dist_epoch+63]`; a slot's count is moved to `boosts_due` exactly when `dist_epoch` reaches it, and the gate forbids advancing past a nonzero `boosts_due`, so no stale count can survive to be reused. `unschedule_boost` picks the due branch vs ring branch by `dist_epoch >= end`; both decrement `boosts_active` and `boost_weight_total`. The two host tests drive 1,000 synthetic epochs and 260 epochs through the program's own free functions with per-slot ring checks against a record-derived model, with coverage floors (buys > 500, N=63 buys > 200, wrapped early retires > 20) so the branches cannot pass unexercised. BO.34/BO.34a–c and BO.38/BO.38a measure the wrap on chain, including a wrapped boost bare-burned before due.
- **No double/early/never expiry**: `expire_boost` requires `boost_weight > 0 && dist_epoch >= end` and zeroes the weight; a second expiry is a skip. `expire_boosts` skips non-due silently (BO.10b). Retire unschedules from whichever side of due the boost is on. Retired records keep `boost_weight`/`boost_end_epoch` as inert history, exactly as item 51 states — `retire` unschedules, and every reader skips retired records.
- **Owner-only, buyer's terms**: current owner read from the live asset bytes (BO.33/BO.33a: sold vault boosts for the new owner only); `BoostTermsMoved` refuses a move against the buyer and burns nothing (BO.26, BO.30, BO.31), a favourable move lands at the new terms (BO.30a) — the ruled one-sided rule.
- **Liveness**: nobody can make distributions impossible by boosting; a vault whose token account is gone is retired, and retired records are skipped.

---

## R3. THE LEVEL DRAW — AS STATED, NO WORSE

- **SlotHashes parse**: key pinned to the sysvar id, count ≤ 512, buffer length checked against the count, all-zero hash refused, smallest produced slot in `[want, want+64]` taken. Host tests cover skipped slots at A, B and C against an independent model, the inclusive window edge, a 513-count refusal, truncation, a forged key, and a zeroed hash.
- **FIFO**: `index == revealed_total` (L.2, L.16a). A burned vault at the head still draws, Core write skipped (L.11/L.11a) — the queue never stops at it.
- **Reschedule**: only after the window passed, only to `now + 16` (a slot that does not exist yet), logged `CBOB_REVEAL_RESCHEDULED`, counted on the record (L.17/L.17a/L.17b; the crank reschedules too, L.17c). Never defaulted (L.16 refused `NeedsReschedule`).
- **Attribute re-supply**: `hashv(borsh(attributes)) == attrs_hash` (L.4 tamper refused); the 640-byte budget is enforced at mint (`AttributesTooLarge`, L.12a) and a full-budget reveal fits legacy (L.12).
- **Influence**: the minter cannot grind (hashes postdate the signature); the re-roll-on-lapse residual is limit 25, stated with the round-22/25 corrections; C's leader choosing among many draws is limit 26, stated with the measured numbers (best-of-4 → 18.6% Level V; 64 tries → 96%; cohort-wide per shared `reveal_slot`; expected weight 3.05 = 6405/2100 checks out). SPEC 26's statement matches the code's mechanics; HOLDER-GUIDE's honest list says "the validator producing the last of those blocks can pick among several results… one choice affects every vault created in that moment at once" — true. **Not worse than stated.**

---

## R4. GOVERNANCE — NO MINORITY CARRY, NO NEW FREEZE

- **Electorate**: `index_snapshot` and `quorum_supply` fixed at creation; `VaultTooNew` (G.6/G.7); live supply = minted − redeemed − retired-bare (P.29); unretired bare burns only ever raise the bar, never lower it.
- **Tally**: quorum = ceil(snapshot × bps/10⁴), never zero; threshold floor-divided (50.99% fails, exactly 51% passes — F18.1/F18.2 measure the 60% suite analogue both ways); 10% YES turnout (D.1); key changes need ceil(half the snapshot) YES (3c.K2 refused, 3c.K2p proves the precondition), never bundled (3c.K1).
- **Execution**: per-kind ordering marks; overtaken actions logged `CBOB_ACTION_SKIPPED`, never a revert (7.26, E.2/E.2a, 3b.S1, 3c.R1, BO.25); `executed = true` rolls back if any CPI fails (atomicity); 7-day execution window (constant, stated as unexercised in SPEC's known limits — honest).
- **Reach**: only the five kinds; MINT re-checks every value at the CPI; the split, destinations, `max_supply`, royalty and reserve list have no instruction. P.0e/P.0f prove no vote-carried struct has a field for them.
- **Frozen forever?** Only the stated ways: SPEC 47 (stolen guardian, permanent at sub-half turnout — no funds lost, redemption/payouts unaffected) and limit 45 (all vaults redeemed; correctable while a round can still mint). Nothing worse found. A vote arming an off-curve guardian retires the brake in practice — that is a voted outcome inside the ruled supermajority, not a minority carry.

---

## R5. THE CHARTER CLAIM — SPEC 46 IS COMPLETE

- Address-pinned against the 240-leaf root (domain-separated tags, sorted pairs, odd promotion; the JS module and the Rust agree because the program accepts proofs the module builds — the only check that can fail on drift); depth ≤ 16 bound with 240 leaves needing 8; the lookalike (C.8), another's PoB (C.9), a CBOB vault as PoB (C.10), a wrong proof (C.12) each refused for the named reason.
- Burned as its owner in the same instruction (C.3 tombstone; C.7 reuse refused); `pob_extra` ≤ 8, passed through never as signers (OR.3 `BadPobExtra`; OR.4 lands through a real approving Oracle; OR.5 a rejecting Oracle still refuses, pinned to Core's error; OR.6 cleanup).
- Window by clock alone (C.1/C.15), never reopenable, not gated by the guardian (C.13), counts toward supply and census.
- **SPEC 46 completeness**: the hot wallet can gate or brick claims (end the project) or admit only its own PoBs (capture governance) — stated; it cannot transfer or burn an individual PoB (R32.A22a measured 0x1a on a Moments-shaped collection; R32.A22b control); per-asset plugins and the 30-minute sampling gap are stated blind spots; owner-added owner-managed plugins (a freeze delegate blocking their own burn) are self-grief, stated. Nothing the wallet, a PoB holder or a third party can do is omitted that I can construct.

---

## R6. ONE-TIME CONFIGURATION AND THE TRUSTED HOP

- **SEAL**: authority first (0.2 refused for the right reason); 1–3 reserves, each declared and classic-SPL-owned (6.13 refuses a T22 mint). It checks owner only, not mint-ness — **documented** (SPEC: "SEAL checks only each account's OWNER… the ruled three are pinned by `check-launch-params.mjs`"; item 38: "the programs themselves check less than the checker does"). A non-mint reserve would brick redemptions forever, and the only gate is the launch checker — accepted, and I verified it is written down in both places rather than silently present.
- **MINT**: every bound re-verified against the code (boost mint classic/initialized/≠cbBTC/≠$GARY; weight 1–12; epochs 1–63; treasury/operator/payment/pob_collection non-default; notice 60s–30d; sweep bounds internally consistent and inside absolute limits; caps all nonzero, sum ≤ max_supply; charter window ordered, ≤90d, not already over; root nonzero; monthly 60s–30d; collection clean/ours/unminted; SEAL agrees on the collection and holds the payment mint as a reserve). 0.1e–0.1v refuse each wrong class for the named reason.
- **BURN/GOV**: sibling cross-checks at init (0.3b `WiringDiverged`, 7.0a `ForeignVault`); window 10s–24h; quorum 500–10,000, threshold 5,001–7,500, voting 60s–30d.
- **The trusted hop**: cap/cooldown/reserve/operator-signs/not-stopped all on chain; two sweeps in one transaction share a timestamp and the second refuses (6.17); zero sweep refused (6.17b); stranger's sweep refused (6.17a); a vote can only tighten, inside the init bounds (3c.B1–B3); replacement needs half of live vaults + notice + guardian can cancel (3c.K2–K5). Worst case is the stated cap × windows until the guardian stops — limit 10, accurate.
- **Royalty**: installed once with `PluginAuthority::None`; update refused (R.6), removal refused (R.6a), re-delegation refused 0x1b (R33.G3), controls land (R.5, R.6c, G3 control). MINT's only Core CPIs are CreateV2, the one AddCollectionPluginV1 at init, UpdatePluginV1 (attributes), BurnV1 — no instruction can reach the collection plugin. Confirmed immutable under the pinned Core.
- **Redemption cap**: exactly a 64-slot ring of timestamps over a rolling window — verified in R1 above; not a bucket, not an hourly counter.

---

## R7. CROSS-PROGRAM RAW READS — EVERY OFFSET RECOMPUTED, ALL MATCH

I rebuilt every layout from the struct definitions:

- **MintConfig v6** (1,261 bytes with the 256 pad): version@8, collection@9, governance@41, pool_ata@73, minted_total@141, sol_reserve@257, max_sweep@266, cooldown@274, charter_closes@442, bare_retired@454, total_weight@462, acc@478, owed@494, last_dist@510, stops_at@518/526, monthly@574, pending_guardian@582, notice@623, sweep_floor@631, cooldown_ceil@639, reserve_ceil@647, dist_epoch@655, pending_count@663, pending_this@671, cbob_mint@679, max_boost_weight@711, max_boost_epochs@712, ring@749. Every GOV and BURN offset constant matches; the suite's own offset constants (OFF_* in 3prog.test.ts) match too, and 3.1v/3.1w/X.1/X.2 prove the readers against live bytes.
- **VaultRecord v4** (221 bytes): version@8, asset@9, mint_index@41, level@57, active@125, retired@126, vault_ata@129, debt@161, pending@177, request_epoch@178, boost_weight@186, boost_end@187, carry@195. GOV's reads (8/9/41) match.
- **BurnConfig v4** (827 bytes): version@8, collection@9, burned_total@42, window@50, head@58, ring@59. GOV's read (42) matches.
- **SEAL Config v2** (398 bytes): version@8, collection@9, reserves Vec@41. MINT's and BURN's reads match.
- **Sweep helper's classic token account**: mint@0, owner@32, amount@64, len 165 — matches spl-token's layout (and the D2 probe's measured COption behaviour at 72/121/129).
- **Discriminators**: all twelve pinned in the suite against sha256 derivations (3.1a–3.1u, R.7/R.7a/R.7b, BO.29), including the account discriminators. Version bytes pinned on every read; a layout that moved fails loudly.

No silent misread found.

---

## R8. THE SUITE, THE SIMULATION AND THE BUILD AS EVIDENCE

- **Vacuity sweep**: round 33's D3 was the one vacuous arm; repaired. I re-checked the usual suspects: C.2-style `String(!!x)` arms sit behind awaited throws (a crash is FATAL exit 2, red — not a false pass); R33.G1/G2b fail on `'no vault'` if their shapes were never built; G2a requires `kept>=20`; BK.* fail on a missing label; ID.1 enforces unique ids so a `because()` pin can only read its own arm; the `because()` list pins the named negatives to measured error text, including Core's own codes where the refusal is Core's (0x9, 0x1a, 0x1b, 0x11, 0xb).
- **Floors**: 866 on-chain / 909 detector / 39 allocation / 23 poster / 14 PoB / 47 launch / 6 host (including Anchor's `test_id`, per fact 11) / 33 mainnet / 4 expiry / 71 sim / 16 fork — every one must EQUAL its count; the runner refuses `CBOB_TEST_FILE` and a moved `CBOB_CACHE`; the ship gate refuses a skipped probe or fork.
- **Bytes**: the four keyed programs ship a different `INIT_AUTHORITY` than the suite ran — the acknowledged gap (fact 8), closed as far as possible: both builds deployed and probed behaviourally in both directions, source grepped for Gary's key in all four, dirty tree refused, and the banner honestly says NOT PROVEN for the compiled constant (reproducibility is the bridge). The sweep helper is byte-identical three ways.
- **Claims in the prompt with no arm**: I found none new. The shapes round 33 listed as optional (wSOL source, non-ATA destination, `pob_extra = 8`, 30-record `expire_boosts`) remain untested and remain optional — each is the same code path as a measured arm, and A10 records them as open obligations rather than silently absent.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?** One marginal wording gap, no exploit behind it:

- **INFO — limit 29 is narrower than the truth by one account set.** It says "anything else sent to the revenue address stays there for ever (no instruction moves a non-cbBTC token out of it)". The same is true of the POOL's PDA and is not said: the config PDA signs only cbBTC movements (`claim`'s Transfer from the pinned `pool_ata`; `split_revenue`'s two TransferChecked with the mint pinned to `payment_mint`), so a non-cbBTC token account anyone creates for the config PDA and funds is stuck exactly as limit 29 describes for revenue. Cost: the sender's own tokens; no holder impact; no instruction could move them. Evidence if I'm right: no instruction in MINT references a non-`payment_mint` token account for the config PDA — verifiable by grepping every `invoke_signed` seed use (`[CONFIG_SEED]`, `[REVENUE_SEED]`) against their account metas. Fix: one sentence extending limit 29 to the pool. Not a defect; a completeness edit to an accepted limit.

Everything else I checked read accurate or conservative: 25 (re-roll), 26 (leader choice, with numbers that recompute), 27 (dead-weight join/pay), 28 (freeze consequences, including the whole-redemption block and the forfeit), 32 (cap arithmetic: 45/hr at 2,100; ring covers 3,047; `ceil(3048×0.021)=65>64` so stricter above, as stated), 35 (10.71% > 10%, true), 40 (three named Core consequences plus the bounded heap caveat), 41 (transfers unlimited; the guide's "slows how fast vaults can be opened, not how fast they can be moved" is the correct claim), 43/44 (measured shapes), 46 (complete, per R5), 47 (permanent-at-low-turnout stated), 55 (100-$GARY-at-the-boundary correction present), 56 (hot $CBOB key stated).

**2. Is anything listed as a limit not actually a limit?** None found. 35 is true arithmetic kept as a floor; 37 and 49 are true and measured.

**3. Is any DISCHARGED item not actually discharged?** No. 51 (boost: BO.*, host tests, init arms), 54 (compute: 10.5/10.6/10.6a/10.6b measured at the stated numbers), 12/17 (measured), 14 (11.4), 19 (closed by construction — `activate` requires a drawn level), 30 (P.0e/P.0f), 31 and 33 (init-valued periods exercised at suite values), and the v5 Bank/deck family (gone with the code, and the suite proves the deleted discriminators answer `InstructionFallbackNotFound`, 0.4–0.4i) all hold.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. 22 (rehearsal, with its five named pass/fail items), 38 (launch values; `charter_opens_at` and `lock_deadline` still OPEN in `launch/mainnet-init.json` and the checker refuses until set), 50 (holder surfaces; the guide is marked DRAFT and barred from publishing before it ships), 52 (accounts before first split; road step 10), 53 (rehearsal proof stale, must re-run at the release commit) are each still labelled OPEN AND BLOCKING in SPEC and still gated.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — WHAT AI AUDIT STRUCTURALLY CANNOT DO

Thirty-four rounds have squeezed the read-and-reason channel dry; the remaining risk lives almost entirely in channels this process cannot occupy. Concretely, before launch:

1. **Run the dress rehearsal (item 22) and treat its five named items as pass/fail, with signatures recorded.** It is the only gate that exercises the crank's and revenue cycle's I/O against a live cluster: real RPC latency, a transient error on vault 1,900 of 2,100, the every-minute reveal lane under load, one full revenue cycle through EACH pool with Orca forced to refuse once, and one forced post-sweep failure walked through the hand recovery to a clean `--audit`. No suite, sim or fork touches `bank/revenue.mjs`'s live path; this is the single largest unexercised surface that moves value.
2. **An independent reproducible build on a different machine, by a different person, from the release commit.** `build-mainnet.sh` itself says the compiled `INIT_AUTHORITY` constant is NOT PROVEN — the bridge is rebuilding and matching the five sha256s. That act also proves the toolchain is reconstructable outside this box. One person, one laptop, one afternoon; without it the key proof rests on a grep and a behavioural probe of a binary built by the machine being audited.
3. **A human reads HOLDER-GUIDE.md against the code, sentence by sentence, and Gary signs off on the honest list specifically.** AI can check consistency; it cannot check that the product Gary thinks he is selling is the one described. The honest list is the disclosure document; its accuracy is a business and legal fact, not just a technical one.
4. **The initialize ceremony needs a second reader who is not the builder.** The checker validates the JSON, not the signed transaction (item 38's own caveat). Have a second person independently derive every value from `launch/mainnet-init.json`, watch the four `initialize` transactions being built FROM that file, and read back every written config on chain (all four programs, all offsets) before the lock. Then rehearse the deploy-dust recovery (round 33 L1) at a throwaway id, including the 890,880-lamport top-up case that is currently "reasoned, not yet measured".
5. **Live-fire the alarm's delivery path, not just its detectors.** Every detector is proven both directions; nothing proves the SMS/email reaches a human at 3am, that the human knows the runbook, or that the guardian wallet is reachable in an emergency. Send a real CRITICAL through the real router in rehearsal mode and time the response. The guardian stop is the only fast brake that exists; its MTTR is an operational fact no code review establishes.
6. **Settle key custody as an explicit act, not a default.** The $CBOB release wallet (limit 56: the whole supply on one hot key, in backups), the swap operator key, the guardian wallet, and the PoB collection's hot wallet (limit 46) are custody decisions the code cannot make. Moving the $CBOB supply to Gary's own wallet or a Squads and deleting the box key is recorded as Gary's call — it should be made as one, in writing, before the lock, not inherited by inaction.
7. **Build item 50's pages and exercise them with real wallets against the rehearsal deployment.** The redeem page is the only pre-signature protection holders have (items 9/44 have no other preventive control), and no suite covers a Phantom signing flow, a Ledger, or a user reading a warning. The page's obligations are fully specified in item 50; what AI cannot do is discover that a real wallet mangles the transaction shape or that a real user clicks past the warning.
8. **Get one independent set of human eyes on the five programs anyway, even informally — a public read-through, a bounty, a posted challenge with the suite attached.** The process's own evidence says why: across rounds, a third of CRITICAL claims were wrong on measurement, and the suite is what killed them — but the suite's author is the system being audited. The cheapest remaining independent evidence is a stranger trying to make the 866 assertions lie. If the design truly cannot afford a firm, it can still afford to be wrong in public for a few weeks before it is permanent.

The strongest single statement I can leave: every channel by which this system has ever actually lost ground — a fix applied to one of two identical sites, a floor that drifted from its count, a gate whose subject changed shape underneath it, a measurement nobody ran — is a process failure, not a code subtlety, and the items above are the process failures still open. The code, as of this tree, I could not break.