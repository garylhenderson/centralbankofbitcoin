# Round 31 — independent audit of the whole v6 tree (programs, helper, suite, sim, build, docs)

Reviewer stance: everything below was derived from the bundled sources by hand (every offset, space constant and discriminator position recomputed; every pairing path and counter transition walked). Where I claim a defect I state the on-chain or test-run evidence that would exist if I am right. Where I could not measure, I say so and give the exact arm to run.

---

## R0. Round 30's verdict and its repairs

**Repairs present in this tree:**
- M1 (sigwalk backlog): `bank/sigwalk.mjs` takes `startBefore`; the consumer side (`bank/alarm.mjs`) is not in this bundle, so the drain-proof behaviour described in SPEC "Scan backlog boundary" is **unverified from this bundle**. The walk itself is as described.
- L1 (coverage gate): `scripts/audit-coverage.sh` now requires the current blob to equal the blob at a completed, quorate round's HEAD, reads each round's TARGETS from the script *at that commit*, and refuses a verdict whose first five lines say QUORUM NOT MET. Correct fail-closed shape; one observation below (R8).
- D1 (rent 1,772,920 mainnet) is in SPEC 49 and item 49's text; D2 (209 h drain) is in DESIGN §8; T1 (banner) is corrected in `build-mainnet.sh`.
- Off-chain L1/L2/L3 are in files not bundled here; not re-verified.

**Round 30's refutations, re-checked:** W1 (Ember's `ACTION_MAX_BYTES` comment) — I recomputed: SetRound 1+28, TightenSweep 1+27 (three `Option<u64>`), ArmSwapOperator 1+32, SetBoostTerms 1+11; the comment is right, Ember was wrong. W2 (wSOL source) — code-reading agrees with the measurement: a native account's `Transfer(amount)` then `CloseAccount` by owner is legal. W4 — correct that the split is deliberate.

**Round 30's accepted-limit dispositions:** I agree with A1–A16 except that A6/A7 (unexercised `pob_extra = 8`, `expire_boosts` at 30) remain real evidence gaps (R8 below).

Round 30 found nothing on chain and I find nothing that contradicts that in the money paths. My one potentially serious item (F1) is in a place round 30 marked as "bounded observations" (limit 40, round 28 note) and treated as the holder's own problem; I think it is a systemic liveness point and needs one more measurement before the lock.

---

## R1. Custody: the seal, the pairing, the emptiness proof

Walked every path. Result: **no way found for anyone but the owner to get value out, and no way for a thawed vault to leave a transaction alive.**

- Pairing: SEAL walks `current+1..` for a top-level BURN `burn_vault` with asset at 0 and owner at 2; BURN walks `0..current` for a top-level SEAL `open_for_redemption` with asset at 0 and owner at 2. Positions recomputed against both `#[derive(Accounts)]` structs: correct. A wrapped half on either side has the wrapper's program id at the top level, so the other side's walk cannot find it (WR.2/WR.3 measure exactly this). Two vaults in one transaction pair independently and both halves bind owner, so cross-owner borrowing (open A/alice, burn A/bob) fails `NotTheOwner` at BURN and `NoTerminalBurn` at SEAL.
- A thawed vault cannot be transferred away mid-transaction and survive: `burn_vault` re-reads the asset's owner and requires it to equal the signer, so `Execute{TransferV1(A→X)}` between open and burn reverts the whole transaction.
- `retire_redeemed`: stack height exactly 2 **and** the top-level instruction is BURN `burn_vault` for this asset. `Execute{burn_vault}` (height 2, MINT at 3) fails `NotFromBurn`; SEAL would also fail `NoTerminalBurn`.
- Emptiness proof offsets: delegate COption tag 72..76, state 108, is_native 109..121, delegated_amount 121..129, close_authority tag 129..133, length 165 — all correct for a classic SPL account. Both derivations required to be declared; a non-token-owned declared account is skipped, which is the correct disposition for a closed account (after `CloseAccount` SPL Token assigns the account to System and reallocs to 0; even on an older token build the `len < 165` guard skips it). A stranger can pre-fund the ATA address with lamports (System-owned, 0 data); it is skipped, and those lamports belong to nobody.
- A stranger cannot create a Token-2022 account for a classic mint (F4.2 measured), cannot set a delegate or close authority on a PDA-owned account, cannot inject instructions between the owner's sweep and burn. Nested Core assets and non-ATA token accounts are undeclared → destroyed (limits 9/44), not blocking.
- SEAL's `set_frozen` CPI and MINT's Core opcodes match the SDK serializers (R.7/R.7a/R.7b).

No finding in R1 beyond what the accepted limits state.

---

## R1s. The sweep helper

(a) Access control is Core's `ExecuteV1` owner rule on a thawed asset; measured SR.5/5a/5c/5d against the pinned binary. Direct call needs the PDA's signature (SR.1). While frozen, Core refuses Execute (3.7, Core 0x9). No gap found.

(b) Pair list: source owner must be the signer, destination owner must be the single `dest` wallet with the same mint, `dest != signer`. Consequences I checked: a source cannot also be a destination (owners differ by construction); a duplicate source fails on the second pair because the first closed it (SR.12a); a source with a delegate is movable and closable by the owner; a source with a **close authority** set by a stranger (only possible on a non-ATA account the stranger created) makes the helper's close fail — the page must then not name it and the stray dies (within limit 44); a native wSOL source works (round 30 W2); odd count refused (SR.7); zero pairs is the lamports-only sweep (SR.13); destination = another vault's asset-signer is permitted and is the owner's own choice, since only the owner can drive the Execute.

(c) Not comparing `dest` to the asset owner is safe for exactly the reason in (a): Core will only let the owner invoke it. A non-System destination is credited fine (R27.S1); a below-rent credit to a non-existent destination fails, which the page contract covers by using the fee-paying owner.

(d) The helper reads `signer.lamports()` after all closes (closes credit `dest`, not the signer) and transfers all of it. Core's `ExecuteV1` neither charges nor credits the asset-signer. A later deposit in the same transaction would have to be the owner's own instruction. BURN's `lamports() == 0` therefore sees exactly 0 (SR.4/SR.4a/SR.13 measure the exact lamport ledger).

(e) See R1. The one unexercised client step: a redemption through the helper where a reserve ATA was **created empty by the prior transaction** (amount 0 → skip transfer, close). SR.13 has no ATA and S8 has three funded ATAs; the "pre-created empty reserve ATA" path is trivially correct by reading but has no arm. Recorded in R8.

(f) S8.0 measures claim + open + Execute(helper, 3 pairs) + burn with the owner paying and no compute-budget instructions. A real page adds 52 (two compute-budget) + 96 (separate payer) → ~1,209 of 1,232; a fourth pair does not fit that padded shape (round 30 A2). The in-line monthly run adds nothing: the pool is already an account of `claim` and `burn_vault`.

(g) Helper bytes: `build-mainnet.sh` `cmp`s `dist/` against its own localnet rebuild **and** against `target/deploy/cbob_vault_sweep.so`, which `run-tests.sh` and `run-sim.sh` both rebuild and deploy. Proven for the helper; the four keyed programs are proven behaviourally (localnet accept / mainnet reject) as stated.

---

## R2. The pool

Invariant "pool ≥ ceil(owed)": `credit` adds `delta*w ≤ avail*SCALE` to owed where `avail = balance − ceil(owed)`, so `ceil(owed') ≤ balance`; `claim` pays whole sats and subtracts exactly `pay*SCALE`; `retire` subtracts the vault's full pending (returns it); `reweigh` leaves owed unchanged (carry = pending, debt = after×acc). Sum-of-pending equals `owed_scaled` under join/credit/claim/reweigh/retire. The host test N1 and the suite's `ledger()` check this after every money operation. **Holds.**

Counters: `pending_this_epoch` = #{pending with request_epoch == dist_epoch}, reset at every `advance_epoch`; `retire` decrements it only when epochs match; `join` decrements `pending_count` only. `waiting_to_join = pending_count − pending_this_epoch` is therefore exactly the eligible-unjoined set. `boosts_due`/`boost_expiring`/`boosts_active`/`boost_weight_total`: ring index `(e+N) % 64` with `N ≤ 63` cannot collide with any live end epoch in `(e, e+63]`; `advance_epoch` moves slot `(e+1)%64` into `due`; `unschedule_boost` takes the due or ring branch by `dist_epoch ≥ end`. Consistent in every ordering I tried, including activate-as-host performing the launch tick before recording its own request (the request is stamped in the new epoch — see F4).

SPEC's weaker W11 rule ("never credited by a distribution that ran before it joined") holds: `join` sets `debt = w×acc`, pending 0, and the only epoch advance with `w == 0` is the free tick, which credits nothing.

Liveness: `JoinWaitingFirst` can always be cleared by anyone via `claim` (the pending branch needs only the record and the recorded ATA *key*, which need not even exist as an account); `BoostsExpireFirst` can always be cleared by anyone via `expire_boosts` (records only). A griefer cannot keep either gate shut. Redemptions: only the rate limit and the vault's own frozen ATA (limit 28) can hold one.

No finding beyond the accepted limits.

---

## R2b. The $CBOB boost

- Exactly N distributions: bought in epoch e (after the host's monthly run), ends at e+N; due when `dist_epoch` reaches e+N; no distribution or tick advances past a due boost (`distribute` checks `boosts_due == 0` before the `w == 0` tick; `monthly_inline` returns before `tick`). Expiry is a `reweigh` at the accumulator its last distribution left. BO.21/BO.35 pin both in-transaction orders.
- Nothing earned is lost or gained on any weight change: `reweigh` moves pending into `carry` and restarts debt; `retire` removes exactly pending.
- The four counters and the ring agree (N1 host test over 260 epochs, four wraps; suite `books()`).
- No record expires twice (`boost_weight` is zeroed), early (`BoostNotDue`), or never (any due record is processable by `expire_boosts`, which needs no token account).
- Owner-only, buyer's terms one-sided as ruled.

No finding.

---

## R3. The level draw

SlotHashes parse (u64 count, 40-byte entries, bounded at 512, buffer-length check, all-zero hash refused) is correct. A/B/C selection matches the independent model (host tests), and the suite re-derives entropy from the raw sysvar (L.3c). Capture deadline arithmetic (A ≤ reveal+64, window 300 < 512) holds. FIFO strict; burned head skipped by positive tombstone (L.11). Attribute hash is Borsh of the same `Vec<VaultAttribute>` on both sides.

Influence: a minter can only abstain (limit 25); a crank operator can only abstain or time a reschedule (25/26); C's leader chooses among skips × contents (26). **Is it worse than SPEC 26?** Two small additions, not a severity change (F5): (i) C's leader can also skip all four of its slots and hand C to the *next* rotation (choose among many *or pass*); (ii) B's leader can do the same to move C's rotation two groups later without knowing hC, i.e., it can pick *which* validator gets the last word. HOLDER-GUIDE's "can pick among several results, by skipping a block or changing what goes into it" is truthful.

**But see F1: the FIFO's strictness plus "the level is written onto the asset by Core" is a liveness single point that a hostile holder's asset shape may be able to jam permanently.**

---

## R4. Governance

Snapshot of electorate and live supply at creation; quorum/threshold/10% YES/50%-of-live for key changes; guardian and operator never share a proposal; notice before apply; per-kind supersession with logged skips; `restart` tie goes to the stop on both sides (`>=` in GOV, `<` in MINT). Raw reads of MINT (offsets 8/9/41/141/191/192/257/266/274/442/454/518/526/631/639/647/711/712), BURN (42) and VaultRecord (9/41) recomputed: correct. Minority carrying: 10.71% YES at the ruled numbers is stated (DESIGN §10). Vote rental is stated. Money reach: only rounds (price ≥ 21,000, cap, year window), boosts terms (no price floor — a vote can make boosts nearly free; the 18:14 consequence is stated), tightening, armed keys. Freezing forever: limit 47's "permanent at low turnout" is the worst case I can construct; no new path.

No finding beyond F2 (a doc interaction).

---

## R5. The charter claim

Merkle (domain-separated, sorted, promoted odd node) matches `scripts/pob-merkle.mjs`; `pob_proof ≤ 16`; identity by address; owner must own the PoB; burned by CPI with the owner as signer and `pob_extra` passed as non-signers; window by clock only; not gated by the stop. Is SPEC 46 complete? Nearly. Omissions, all minor and all inside the "gate or brick" class already stated: a collection-level Oracle on **transfer** (not burn) would pin every PoB in whatever wallet holds it for the window (an escrowed PoB could not be moved to a signing wallet); a hook that needs more pass-through accounts than the packet carries bricks like a rejecting one (round 30 A7); a separate `payer` on `claim_charter_vault` receives the burned PoB's rent refund, not the owner (Core refunds to the burn's payer) — a page-contract note (F6).

---

## R6. One-time configuration and the trusted hop

Every `initialize` read. What each accepts that the checker must catch is as item 38 states; nothing new. Two notes: SEAL's `initialize` is the only one with no sibling check, so a wrong SEAL collection is caught at MINT's `initialize` (`WiringDiverged`) and is recoverable only by redeploying SEAL at a new id — a launch-ordering risk, not a permanent one, since nothing has minted. Swap operator worst case = cap × cooldown windows above the reserve until the guardian stops it (limit 10) — **but see F2 for the combination with a stolen guardian**. Royalty: plugin authority None; MINT has no Core CPI that could add an asset- or collection-level Royalties afterwards; measured both ways on a control collection. Rate limit: `kth = ring[(head+64−k)%64]`, `now − kth ≥ window`, write at head — exactly a rolling window over the last min(cap,64) redemptions, cap recomputed from live supply at each burn.

---

## R7. Cross-program raw reads — recomputed

MintConfig (version 6): version 8, collection 9, governance 41, pool_ata 73, round_id 105, opens 109, closes 117, price 125, cap 133, minted_this_round 137, **minted_total 141**, max_supply 149, bank_treasury 157, split_bps 189, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, bump 265, max_sweep 266, cooldown 274, last_sweep 282, level_caps 290, level_minted 310, revealed 330, payment_mint 338, pob_collection 370, pob_root 402, charter_opens 434, **charter_closes 442**, charter_claimed 450, **bare_retired 454**, total_weight 462, active_count 470, acc 478, owed 494, last_dist 510, **sales_stopped_at 518, sweep_stopped_at 526**, pending_op 534, pending_op_at 566, monthly 574, pending_guardian 582, set 614, at 615, notice 623, **floor 631, cooldown_ceiling 639, reserve_ceiling 647**, dist_epoch 655, pending_count 663, pending_this 671, cbob_mint 679, **max_boost_weight 711, max_boost_epochs 712**, boost_price 714, boost_weight 722, boost_epochs 723, boosts_active 725, boosts_due 729, boost_weight_total 733, cbob_burned 741, ring 749..1005; space 1005+256 = 1261 ✓. VaultRecord: asset 9, mint_index 41, reveal 49, level 57, charter 58, set 59, entropy 60, hash 92, bump 124, active 125, retired 126, reschedules 127, ata 129, debt 161, pending 177, request_epoch 178, boost_w 186, boost_end 187, carry 195..211; space 211+10 = 221 ✓. BurnConfig: collection 9, bump 41, burned_total 42, window 50, head 58, ring 59..571; space 827 ✓. SEAL Config: collection 9, reserve Vec len at 41 ✓. GovConfig: proposal_count 53 ✓. Proposal space 259 ✓, ACTION_MAX_BYTES 37 ✓. Helper: mint 0, owner 32, amount 64, len 165 ✓. Every suite and sim literal offset agrees. **No misread anywhere.**

---

## Findings

### F1 — HIGH *if measured true* (expected to downgrade on measurement; the measurement is cheap and must be run before the lock): a hostile owner may be able to halt the level FIFO permanently by shaping their own unrevealed vault

**Construct.** `programs/cbob-vault-mint/src/lib.rs`, `reveal_level`: for a non-burned asset the instruction *must* complete Core `UpdatePluginV1(Attributes)`; there is no bypass, and `revealed_total` advances only on success. `reveal_level` is strictly FIFO (`RevealOutOfOrder`). The only way past a vault whose Core write fails is for *its owner* to bare-burn it.

**Attack shape.** An owner mints (or charter-claims) a vault with the full 640-byte / 8-attribute budget and, in the same transaction through a tiny helper program of their own (the suite's `PADTAIL!` wrapper is exactly this), adds the owner-managed Autograph plugin padded to the largest message Core will accept, plus FreezeDelegate, BurnDelegate, TransferDelegate and FreezeExecute. The crank cannot race it (same transaction). When that vault reaches the head, if Core's 32 KiB per-instruction heap is exhausted by the Attributes rewrite (which must deserialize and re-serialize the plugin registry and move every byte after the Attributes plugin, i.e., the whole autograph), `reveal_level` fails for everyone, forever: no later vault is ever revealed, so no later vault can ever activate; the pool stops admitting new vaults for the life of the protocol. Cost: one vault plus ~0.07 SOL of rent.

**Why this is not already settled.** Round 28 measured exactly one shape: a charter vault with ONE attribute and a 10,150-byte autograph plus all five owner plugins; MINT's reveal landed, and Core itself then refused further growth for heap. That is evidence the ceiling may be unreachable. It is not evidence for the shape with 640 bytes of attributes (the Attributes plugin is what the reveal rewrites, and it is ~13× larger there), nor for Autograph sizes between what the probe tried, nor for a vault where Attributes sits *before* a large plugin in the account. SPEC 40 itself says "bounded observations at the pinned binary, not a proof for every plugin shape". It frames the consequence as the holder's own vault; the consequence I am naming is systemic.

**Evidence if true.** `conn.simulateTransaction(reveal_level)` on such a vault returns `memory allocation failed, out of memory` from Core, and `revealed_total` can never pass that vault's index. Evidence if false: the reveal lands for every Autograph size Core accepts, at the full attribute budget. **The arm:** mint at `exact()` (640 bytes, 7 caller attrs) → in the same tx add Autograph with the largest message that lands (binary-search 8 KB..11 KB) and the four other owner plugins → wait for entropy → simulate and land the reveal. Run it on both a paid and a charter vault (the charter one carries 8 attributes).

**Repair options (before the lock; owner decision):** make the Core attribute write survivable: `reveal_level` always records the level on the record and advances the FIFO, and the Core write becomes a separate permissionless `write_level_attribute(asset)` that may be retried or skipped; or bound the asset account size the reveal will attempt and skip the write above it (recording `level_written = false`). Either keeps "no level without entropy" and "FIFO" intact while removing the one place a holder's Core-side shape can stop everyone else. If the measurement lands for every reachable shape, record it under limit 40 as a pinned arm and state the systemic consequence explicitly (today 40 states it only for a Core *upgrade*).

### F2 — LOW (documentation; limits 10 and 47 interact worse than either states)

SPEC 10 bounds the swap operator's worst case by "until the guardian pulls `emergency_stop_sweep`", and 47 says a stolen guardian can "cancel any swap operator a vote arms". Together: if the operator key is stolen and the guardian key is stolen or simply refuses to act, royalty SOL drains at cap × cooldown **until a half-of-live vote replaces the guardian, then a second half-of-live vote plus 7 days replaces the operator** — unbounded at turnout below 50% (a hostile guardian cancels every armed operator at any moment before `apply`, including one slot before). No code change is needed (the design chose this); SPEC 10 should state that its bound presumes an honest, responsive guardian, and 47 should name the royalty-drain consequence. Evidence: `cancel_swap_operator` has no time bound while `pending_swap_operator != default`.

### F3 — LOW: evidence gaps the prompt's claims rest on and no arm exercises

- The redemption page contract's step 1 through the helper (a reserve ATA pre-created *empty* in a prior transaction, then named by the helper: amount 0 → close) has no arm; SR.13 has no ATA and S8 has three funded ones.
- `pob_extra = 8` (the bound) and `expire_boosts` at `MAX_EXPIRE_BATCH = 30` have no arm (round 30 A6/A7, still open).
- The F1 shape (full attribute budget + maximal owner plugins) has no arm; R28.A1 used a one-attribute vault.
- Arms that cannot record a REJECT: `C.2` and `2.1` (`String(!!x)` after a helper that throws); a failure crashes the run (exit 2) rather than failing the arm, so they are run-structure guards, not assertions, and inflate the floor by two.
- `tests/probe-mainnet-facts.mjs` header still names `scripts/probe-signature-paging.mjs`.

### F4 — INFO: the first-month join is one instruction more fragile than HOLDER-GUIDE says

In `activate`, `monthly_inline` runs **before** the request is recorded. A vault whose very first activation request is the instruction that performs the launch tick is stamped `request_epoch = new epoch` and joins only after the *next* distribution, while vaults requested a slot earlier join immediately after the tick. The guide's "At that one-month mark, the vaults activated by then join" is true for vaults *requested* before the tick landed, not for one whose request lands in the tick. Operationally the crank requests hourly so the set is small; the guide should say "requested" and the crank should request before its explicit `distribute` (it already orders join-eligible before distribute; the first-request step runs after).

### F5 — INFO: two sentences for SPEC 26

C's leader can also skip its whole rotation and *pass* the last word to the next leader; B's leader can skip its whole rotation and thereby choose which rotation holds C, without knowing hC. Neither changes the stated bound ("choose among many"), both belong in the stated model.

### F6 — INFO: rent refunds follow Core's `payer`, not the owner

`claim_charter_vault` and `burn_vault` pass the instruction's `payer` as Core's burn payer, so a separate fee payer (the page shape S8.0 reserves bytes for) receives the burned PoB's / vault's rent refund. A page-contract line (pass the owner as `payer`, or state who gets the refund).

---

## The accepted limits — the four questions

**1. Worse than stated?**
- **40** (Core size boundary): the round-28 note presents a holder's own-vault cost; the unmeasured shape in F1 would make it everyone's cost, permanently. Worse than stated until measured.
- **10 + 47**: the combination is unbounded at low turnout (F2).
- **26**: marginally under-described (F5), not worse in severity.
- **25**: a minter who lets a window lapse can also *time the reschedule* (anyone may reschedule, including the minter) to aim C at a chosen rotation; SPEC 26 says "a mint (or a reschedule)", so stated.
- **27, 28, 32, 36, 41–46, 55, 56**: as stated. For 32, the attacker's cost is only the resale value of the vaults (their contents return to them); "each of which is burned" is accurate but a reader may overestimate the cost.

**2. Not actually a limit / already closed?** 35 is a true "never binds at ruled numbers" note, not a limit — fine where it is. 29 is a design cost listed as a finding; harmless. Nothing listed is actually closed.

**3. DISCHARGED not discharged?** 12/17, 14, 19, 30, 31, 33, 51, 54: each is backed by an arm present in the bundled suite (L.12/L.13/L.14, 11.4, P.1, P.0e/P.0f, PG.8/PG.9/IN.*, 3c.K5/3c.G2, BO.*, 10.5/10.6/10.6a/10.6b). Discharged.

**4. OPEN AND BLOCKING quietly accepted?** No. 22, 38, 50, 52, 53 are still written as open; HOLDER-GUIDE still says DRAFT and "(being built)"; VALIDATION records that nothing was deployed or sent in the rehearsal tree. One place to watch: SPEC 50 now spends most of its text on *client contract* for a page that does not exist — that reads like the obligation is drifting from "build it" to "document what it must do". It is still marked OPEN AND BLOCKING; keep it so.

---

## R8. The suite, simulation and build as evidence

- Every `because()` pin I checked names the error the first guard on that path produces; none pins a later guard or a different program than it claims. SR.12b correctly checks that SR.12a's refusal came from the *second* pair.
- Reasons of the sim's refusals (S6.*, S7.2!, S7b.3, S9.*, S10.2) are the first guard each path hits.
- `because('3.7','custom program error: 0x9')` plus the decoded owner/frozen state is the right discipline for a code Core shares with R.6.
- IN.1/IN.2 (three concurrent hosts, exactly one distribution) is deterministic because the first stamping host makes the others not-due within the same block.
- Build: helper proven byte-identical via `dist` vs `$CACHE/ln` vs `target/deploy`; keyed programs proven behaviourally; `initauth.test.ts` argument lists match the current `initialize` signatures (I re-encoded MINT's: 2 keys, Option, 7 numerics, caps, 2 keys, root, 2 times, monthly, notice, floor, ceiling, reserve ceiling, u8, u16 — correct), and `REACHED_PAST` for MINT correctly stops at `BadBoostSetup` on a random `cbob_mint`.
- Coverage gate: a round credits a file's blob if the file was in the bundle of a quorate completed round, regardless of whether any auditor engaged with it; that is the gate's intrinsic limit. Round 30's programs pass is correctly *not* credited (its verdict head says QUORUM NOT MET). The `--prepared` escape is correctly a preflight-only mode.
- Floors equal counts everywhere; no overridable floor found.
- Gaps: F3.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what to do before launch that AI audit structurally cannot

1. **Run F1's measurement on the pinned Core, both vault kinds, before anything else.** It is the one place I can see where a single holder's Core-side action could end the pool's admission forever, and no reading can settle it; only Core's heap can. If it lands at every reachable size, pin it as an arm and move on. If it does not, the program change is small and must precede the lock.

2. **Adversarial, live, with real money the team does not control:** run the dress rehearsal (item 22) and then **pay outsiders to break it** for a fixed window at the throwaway ids, with real small balances in real vaults. AI reads code; it does not sit on a wallet for two weeks trying shapes. Pre-commit the bounty terms so the window cannot be shortened after a finding.

3. **Reproduce the five binaries on a second machine from the release commit** and compare the sha256s in `dist/SHA256SUMS`, then compare them against the deployed on-chain bytes **after** deploy and **immediately before** `set-upgrade-authority --final`. Record the three hashes in the lock ceremony log. A reproducible build is the only bridge from "source names Gary's key" to "the chain holds that key".

4. **Re-pin Core at lock time.** The suite certifies against a Core dump from 2026-08-22. Dump mainnet Core on lock day; if it differs, rerun the whole suite and the sim before locking, because every seal, thaw, sweep and attribute write is a CPI into whatever Core is then.

5. **Rehearse the three irreversible-but-stoppable incidents with the actual humans and the actual phones:** a cbBTC pool freeze (what gets posted, who redeems how), a Core upgrade alarm (who decides whether to lock or hold), a guardian-wallet loss (who proposes the half-of-live vote and how turnout is gathered from 42 holders). Measure the time from alarm to a signed `emergency_stop_sweep` on a weekend night; that number, not the cap, is the real bound in limit 10.

6. **Move the two hot keys the design leaves on one box** (swap operator, $CBOB release wallet) into separate custody *before* the first royalty SOL exists, or write down in the holder guide that one box compromise takes both. The audit can only state it; only the owner can change it.

7. **Do not publish HOLDER-GUIDE until item 50 ships**, and when it ships, have someone who has never read SPEC redeem a funded test vault through the page on the rehearsal deployment, with a stranger's dust arriving mid-flight, and record it.