

# Round 41 independent audit — five programs + sweep helper + off-chain + web

Scope note up front: I audited the bundled tree (programs at the round-40 repair commit, web at the post-repair state). In this session I could **read code and the recorded measurements, but not boot the validator or re-run the suites**. Every "verified" below is verified by reading the construct and matching it against a named suite/sim/e2e arm; for each I state what a run would show if I am wrong. I did not re-file any claim that rounds 22–40 already disproved unless I could show a surviving defect, and I did not re-report the ACCEPTED list.

---

## R0 — Round 40's verdict and its repairs

Round 40 was NOT CLEAN (1 MEDIUM, 3 LOW, 1 INFO), all in `web/`, none in the five programs. I independently re-derived each repair from source.

**V40-1 (MEDIUM) — dusted token-account address read as absent.** Repair is `absentIfDust` in `web/src/lib/decode.mjs` (returns `null` for an account whose owner is the System program and whose data length is 0). I enumerated every site that reads an ATA by address and confirmed the wrapper is applied:
- `reads.mjs` `vaultWalletAccounts` — reserve + promised accounts `.map(absentIfDust)` before classification.
- `reads.mjs` `readRedemptionSnapshot` — owner ATAs `.map(absentIfDust)`; `ownerAtaExists` requires Token/Token-2022 ownership; `ownerAtaFrozen` returns `false` for a non-token account, so a dusted receiving address is no longer classed "frozen".
- `buy.mjs` `read()` — payer and revenue ATAs mapped.
- `redeem.mjs` `payoutBlock` — the $GARY account mapped.
- `ceremony-reads.mjs` `readStep('atas')` — all three cbBTC ATAs mapped (this is V40-2).
- `meta/generate.mjs` — the vault cbBTC read mapped (V40-3).

The repair leans on a fact the suite already measures: an ATA `createIdempotent` still lands on a System-owned, 0-byte, lamport-funded address (`tests/3prog.test.ts` R34.G2 / R36.G2a-b). A System account **with data** at an ATA address is unreachable (allocate/createAccount need the PDA's signature — R36.G2a), so `absentIfDust` cannot hide a real state. **Repair holds at all sites I could enumerate.** Evidence I am wrong would be: a page reading an ATA by address without `absentIfDust`, or an e2e dust arm failing. The e2e (`web/test/e2e-localnet.mjs`, V40-1/V40-2 blocks) dusts both a vault reserve address and a holder receiving address and asserts the set-up lands and the opening proceeds; VALIDATION records 127/127.

**V40-2 (LOW) — ceremony step 5.** `readStep('atas')` now `continue`s on an absent (dusted) ATA, so it is not added to `existing`, the step reads "not done", and the builder creates it. A genuinely wrong Token-owned account still yields `bad` and stops. Holds.

**V40-3 (LOW) — metadata generator.** `generate()` treats a dusted cbBTC address as 0 sats and writes the file; the "missing after a balance / active / pending" guard still throws only for a real disappearance, which a sealed active vault's ATA cannot suffer. Holds.

**V40-4 (LOW) — SPEC discharged item 2.** Reworded to name the page's by-design refusals and to state none is stranger-triggered. After the V40-1 repair that statement is true. Discharged.

**V40-5 (INFO) — nested-vault note.** `plan-redeem.mjs` no longer asserts who sent the inner vault. Discharged.

**Regressions / re-tested disprovals.** I checked the seven arms round 40 flagged as lacking `because()` reason pins (R32.A22a, R33.G3, OR.5, R31.W1a/b, R28.A2, R35.N8): they still carry no `because()` pin in the bundled suite. That is carried finding A9 (rounds 37–40), not new; I confirm it persists and note the arms do still assert ALLOW/REJECT and post-state, just not the error code. Round 40's disproved claims (W1 frozen-zero-balance unreachable; W9 "System account at ATA impossible"; MiniMax's "V39 repairs absent") remain disproved by the code I read: `plan-redeem.mjs` has the `ourVault` no-refusal branch, `redeem.mjs` passes `[...final.known]` as `promised`, and `owed>0` still requires `active`, which requires a ≥21,000-sat balance in the same account that a freeze would target.

**R0 verdict:** all five round-40 repairs are present and correct at every site I could reach by reading. No program byte changed (VALIDATION records `git diff … -- programs` empty). I found no surviving round-40 defect.

---

## R1 — Custody: sealed vault, emptied vault

I attacked the pairing, the emptiness proof, and "thawed vault leaves the transaction unburned."

- **Pairing.** SEAL walks forward from `current+1` for a top-level `burn_vault` matching asset **and** owner at BURN's account positions 0/2; BURN walks backward for a top-level `open_for_redemption` matching asset and owner at SEAL's positions 0/2. Both use `load_*_checked` (top-level only). A CPI-wrapped open or burn cannot satisfy either half (suite WR.1–WR.4). Two redemptions in one transaction cannot cross-pair because both asset and owner are bound (3.9, 3.10, 9.0; two-redemption v0 in sim S9b). Discriminator drift fails closed (thaw refused → halt, never leak). I found no bypass.
- **Emptiness proof.** Reserve loop derives each reserve ATA under both token programs, requires declaration, PDA ownership, no delegate (`72..76`), no delegated amount (`121..129`), no close authority (`129..133`), exactly 165 bytes (no T22 extensions), and amount 0. The second loop re-applies the same three delegate/close checks plus the extension and amount checks to any *declared* PDA-owned token account, and refuses any declared live Core asset. A closed (swept) account passes because its owner is now System → skipped, which is the right reason.
- **Thawed vault surviving.** Impossible: if the burn fails for any reason the whole transaction reverts, re-freezing the asset. There is no instruction that re-freezes independently, and no path empties without burning.

**R1 verdict: no defect found.** If I were wrong, a suite arm (3.x, 9.x, WR.x) or sim S6 would be red; they are recorded green at 896/71.

## R1s — Sweep helper

(a) **Only the owner.** Direct call needs `signer.is_signer` for the asset-signer PDA (nobody holds its key) — SR.1. Through Core, `ExecuteV1` approves only `authority == owner` on a thawed vault; stranger, owner-added transfer delegate, and collection update authority are all refused `NoApprovals` (SR.5, SR.5a, SR.5c) against the pinned Core binary. While frozen, Core refuses Execute entirely (3.7, S6.2), so the helper is unreachable outside a redemption. Holds.

(b) **Pair list.** Duplicate source: first pass closes it, second `read_token` sees a zeroed account whose owner is not the signer → `IllegalOwner` (SR.12a, and SR.12b pins it hit the second source, not the first guard). Duplicate destination: harmless (credited twice). Source-as-destination impossible (source owner = signer, destination owner = dest wallet, and `signer.key == dest.key` is refused — SR.10). wSOL source: read as a normal classic token account, transferred and closed (unwrap) — no issue. Delegate on source: owner may still transfer and close. Close authority kept by another: close reverts the whole call (R36.C5) — the page routes such accounts through a plain `Transfer` Execute instead. Frozen source: transfer reverts (SR.14). Non-ATA destination: accepted as long as owner==dest and mint matches (correct — dest may receive anywhere). Destination = another vault's PDA: permitted, but only that vault's owner can invoke, so it is the owner moving their own value. Odd pair count → `NotEnoughAccountKeys` (SR.7); zero pairs → lamports-only sweep (SR.13). Holds.

(c) **Destination not compared to owner.** Safe *because* only the owner can reach the helper; the owner choosing a stranger's destination is a gift, not a theft. Lamport credit to a below-rent-exemption, not-yet-existing account would fail System transfer; the page uses the fee-paying owner as canonical destination and documents the constraint (item 50). Holds.

(d) **Lamport sweep.** Reads `signer.lamports()` after the token loop (closes send rent to `dest`, not `signer`, so the read is undisturbed) and transfers the full amount to zero. Within the page's transaction nothing sits between the helper and `burn_vault`, so BURN's `lamports()==0` sees exactly the post-sweep state. A self-inflicted re-funding instruction between them would fail the burn, not steal. Holds.

(e) **Interaction with BURN / permissionless creation.** A closed account passes because it is System-owned (skipped), which is correct. If a vault's reserve ATA does not exist when the page builds, the prior transaction creates it (item 42); a stranger cannot pre-empt an ATA address with a token account (R34.G2), and a T22 ATA for a classic mint is refused by the ATA program (probe F4.2). A stranger's classic non-ATA account can be swept if named; a T22 or frozen stray is boxed as lost; a nested CBOB vault is rescued (item 58). Consistent with limits 42/44/58.

(f) **Fit.** Sim S8.0 measures claim+open+helper(3 reserves)+burn at 1,061 bytes, leaving room for a compute-budget pair (+52) and separate payer (+96) ≈ 1,209 of 1,232. Suite 9.14/9.15/9.16 pin the 3-reserve ceiling and tie `MAX_RESERVE_MINTS=3` in SEAL and BURN to that measurement. A fourth reserve cannot fit and cannot be added. Holds.

(g) **Evidence / bytes.** SR.0–SR.14 and S8.* exercise every branch; `build-mainnet.sh` `cmp`s `dist/cbob_vault_sweep.so` against both the localnet release build and `target/deploy` (the bytes the suite deployed). The helper has no `localnet` feature, so tested == shipped byte-for-byte. Holds.

**R1s verdict: no defect found.**

## R2 — Community pool

I re-derived the accumulator invariant and every counter.

- **Invariant pool ≥ ceil(owed).** `distribute` credits `delta = floor(avail·S/w)`; `owed_scaled += delta·w ≤ avail·S`, so ceil(owed) never exceeds the unchanged balance. `claim` pays `p = floor(pending/S)` and subtracts `p·S` from `owed_scaled` while the balance falls by `p`; since `ceil((O−pS)/S)=ceil(O/S)−p`, the invariant is preserved. Forfeit (`retire_redeemed` with frozen pool) subtracts `pending` from `owed_scaled` without moving tokens, so the pool only gains. Only `claim` moves tokens out, and only from the config-PDA-owned pool. Suite P.32 plus the `ledger()`/`books()` recomputation after every money operation assert this. I could not break it.
- **Counters.** `pending_count`/`pending_this_epoch` increment together on request; `advance_epoch` zeroes `pending_this_epoch`; `join` decrements only `pending_count` (a joiner is from an earlier epoch); `retire` decrements both only when `request_epoch==dist_epoch`. All decrements are `checked_sub`, so an inconsistency aborts rather than corrupts. `waiting_to_join = pending_count − pending_this_epoch` cannot go negative by construction. F21.1 exercises a waiting vault retired in both ways.
- **Liveness.** `JoinWaitingFirst` and `BoostsExpireFirst` block a distribution only until a free, permissionless join/expiry runs; the crank and any `claim` do it. No actor can permanently block distributions or another's redemption (redemption is gated only by the rate limit and a Coinbase freeze of a reserve account — both accepted).

**R2 verdict: no defect found.** The SPEC "weaker rule" (limit 55, unsplit revenue shareable by a joiner) is accepted and I found it not worse than stated: the crank splits every pass, bounding the at-stake balance, and the cost to trigger is ≥100 $GARY plus a funded vault.

## R2b — $CBOB boost

- **Exactly N distributions.** A boost bought at epoch `e` ends at `e+N`; `advance_epoch` makes it due when `dist_epoch` reaches `e+N`, having credited distributions `e+1..e+N` (N of them). `BoostsExpireFirst` prevents an N+1-th. BO.21/BO.35 pin both orderings ([boost,distribute] counts the riding distribution; [distribute,boost] does not).
- **No gain/loss on reweigh.** `reweigh` moves `owed` into `carry_scaled` and resets `debt_scaled = after·acc`, so `owed_of` is unchanged; `total_active_weight` moves by `after−before`. Verified algebraically and by the 260-epoch host test.
- **Ring/counters agree.** `boost_expiring[end%64]`, `boosts_active`, `boosts_due`, `boost_weight_total` are maintained by `boost_vault`, `unschedule_boost` (due vs not-due branch), `expire_boost`, and `retire`. Max N=63 < ring 64, so two distinct live end-epochs cannot alias a slot across a processing boundary. Host tests wrap the ring four times; BO.34/BO.38 exercise wrapped buys and a wrapped early retire.
- **No double/early/never expiry.** `expire_boost` requires `boost_weight>0` and `dist_epoch>=boost_end_epoch`; after expiry weight=0 and end=0. `expire_boosts` and `claim` skip non-due/retired. A due boost cannot be skipped by a distribution (gate). 
- **No DoS via boosting.** Expiry is permissionless and needs only records; a vault whose token account is gone can still be expired via `expire_boosts` (records-only path).

**R2b verdict: no defect found.**

## R3 — Level draw

`blockhash_in_window` pins the sysvar key, bounds count ≤512, bounds the buffer, refuses an all-zero hash, and takes the smallest produced slot in `[want, want+64]`. `try_capture` builds A, then B and C two 4-slot leader groups on, deterministic against produced slots; host tests cover skipped slots at A/B/C and match an independent model. FIFO by `revealed_total`; a burned head-of-queue vault still draws (write skipped) so the queue never stalls (L.11). Reschedule moves to `now+16` (a future slot) and logs distinctly. The attribute re-supply is hash-checked. Minter re-roll on total silence (limit 25) and C-leader grinding (limit 26) are accepted and stated; I found nothing worse — noting the docs already concede "three different leaders is likely, not guaranteed," which subsumes the single-validator-holds-all-three case.

**R3 verdict: no defect found.**

## R4 — Governance

Vote bound to asset via `VoteRecord` PDA; electorate frozen at creation (`index_snapshot`, `quorum_supply`); quorum/threshold/10%-turnout/50%-key-change all ceiling-divided against the snapshot; `VaultTooNew` blocks mid-vote mints; execution window 7 days; per-kind ordering marks with overtaken actions skipped-and-logged rather than reverted. A minority cannot carry: the 10% YES floor and 50%-of-all-live-vaults key-change floor bind above quorum×threshold. A vote cannot reach money: only the five action kinds exist, none writes split/destinations/max_supply/royalty, and MINT re-validates every value at CPI. Governance freeze cases (all vaults redeemed; stolen guardian at low turnout) are accepted limits 45/47 and I found them accurately bounded.

**R4 verdict: no defect found.**

## R5 — Charter claim

Merkle leaf/node are domain-separated (0x00/0x01) and pairs sorted, so no second-preimage or reorder; the JS `pob-merkle.mjs` and Rust agree (the suite verifies a JS-built proof on-chain). Identity is by address against `pob_root`; a lookalike minted by the hot wallet is not a leaf (C.8). The PoB is CPI-burned as its owner in the same instruction; the window is clock-only and cannot reopen; not gated by the guardian. `pob_extra` pass-through accounts are never signers. The hot-wallet exposure during the 7-day window (end-the-project / capture-governance) is accepted limit 46 and fully stated, including the alarm's per-asset blind spot and sampling; I found nothing it omits that the code could otherwise prevent.

**R5 verdict: no defect found.**

## R6 — One-time configuration & trusted hop

Each `initialize` is gated by compile-time `INIT_AUTHORITY`, runs once, and cross-checks siblings (SEAL→collection/reserves; MINT→SEAL wiring + payment-mint-is-reserve + clean collection + royalty install; BURN→SEAL collection; GOV→MINT collection). Wrong-but-accepted values are the known reliance on `scripts/check-launch-params.mjs` (item 38, OPEN): the programs accept off-curve guardian/operator and any in-range window, the checker does not. That is correctly still OPEN AND BLOCKING, not quietly accepted. The royalty is installed with `PluginAuthority::None`; suite R.3–R.6c and R33.G3 measure that even the update authority cannot update/remove/re-delegate it. The redemption cap is a true rolling window over a 64-slot timestamp ring (I re-traced the indexing, including wrap and the `min(cap,64)` strictness past 3,047 live). The swap operator's worst case is cap×cooldown until the guardian stops it (limit 10), bounded by the init floors/ceilings.

**R6 verdict: no defect found beyond the already-OPEN item 38.**

## R7 — Cross-program raw reads

I recomputed every pinned offset against the struct definitions:
- `MintConfig` v6: governance 41, minted_total 141, split_bps 189, sales/sweep_stopped 191/192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, charter_closes 442, bare_retired 454, total_weight 462, active_count 470, acc 478, owed 494, last_dist 510, stopped_at 518/526, pending_op 534/566, monthly 574, pending_guardian 582/614/615, notice 623, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, dist_epoch 655, pending_count 663, pending_this_epoch 671, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712, boost_price 714, boost_weight 722, boost_epochs 723, boosts_active 725, boosts_due 729, boost_weight_total 733, cbob_burned 741, boost_expiring 749. These match GOV's, BURN's and the suite's constants.
- `VaultRecord` v4: asset 9, mint_index 41, reveal_slot 49, level 57, charter 58, entropy_set 59, entropy 60, attrs_hash 92, bump 124, active 125, retired 126, reschedules 127, vault_ata 129, debt 161, pending 177, request_epoch 178, boost_weight 186, boost_end 187, carry 195. Matches GOV and the suite; the web `dueBoostRecords` slice (offset 125, len 70 → active d[0], retired d[1], boost_weight d[61], boost_end d[62..70]) is correct.
- `BurnConfig` v4: burned_total 42, redeem_window 50, rate_head 58, rate_ring 59. `SealConfig` v2: version 8, collection 9, reserves 41. `GovConfig`: proposal_count 53.
- Sweep helper token offsets (mint 0, owner 32, amount 64, len 165) and MINT/BURN delegate/close offsets (72, 121, 129) match the classic SPL layout.

**R7 verdict: no misaligned offset found.** Red-team 3 and round 40 reached the same conclusion; my recomputation is independent and agrees.

## R8 — Suite, simulation, build as evidence

- Floors equal current counts in `run-tests.sh` (MIN_ASSERTIONS=896, DET=933, ALLOC=39, POSTER=24, MAINNET=33, HOST=6, POB=14, LAUNCH=49, EXPIRY=4) and `run-sim.sh` (SIM_FLOOR=71); each uses `-eq`, not `-ge`, so a deleted arm fails. HOST_FLOOR=6 correctly includes Anchor's generated `test_id` (5 written host tests + 1).
- Negatives are reason-pinned via `because()` for the large majority; the seven unpinned arms are the carried A9 item (I confirmed they remain unpinned — not a new finding).
- The `expiry-budget.mjs` gate is honestly labelled synthetic-genesis (20 due boosts under default CU), not full lifecycle; it asserts exactly 4 and lands the transaction.
- Build provenance: `build-mainnet.sh` behaviorally proves the four keyed artifacts reject the test key (mainnet) / accept it (localnet) and that source names the mainnet `INIT_AUTHORITY`; the sweep helper is `cmp`-proven identical across `dist/`, `target/deploy/`, and the localnet release. Residual (stated by the script itself): the four keyed mainnet binaries are not byte-diffed against the tested localnet binaries; the bridge is deterministic rebuild from the recorded commit. I treat this as adequately disclosed, not a defect.
- Arms that "cannot fail": I did not find one whose assertion is tautological; `rec` compares want vs got and the runner exits non-zero on any mismatch or count drift.

**R8 verdict: the evidence machinery is sound as described; my limitation is that I could not execute it in this session.**

---

## The four questions about the ACCEPTED LIMITS

1. **Is any limit worse than stated?** I found none. I specifically re-checked 26 (leader grinding — the "three different leaders likely, not guaranteed" wording already subsumes one validator holding A, B and C), 27 (dead-account claim — correctly attributed to other holders; `retire_burned` returns only the *unclaimed* share, a claimed-then-locked share is gone, as stated), 32 (ring makes the cap stricter, never looser, past 3,047), 40 (all three Core-upgrade consequences named), and 41 (transfers unlimited — stated, and the guide no longer over-claims the cap stops a thief).

2. **Is anything listed as a limit not actually a limit?** No accepted limit is secretly closed. Limit 58 (`rescue_nested`) correctly *replaced* the "orphaned forever" wording in the Known-limits section and is cross-referenced; the two lists are consistent.

3. **Is any DISCHARGED item not actually discharged?** I verified the discharged items that rest on code: 14 (duplicate attributes refused at mint), 19 (no unlevelled-activated state; `activate` requires `level∈1..5`), 30 (`update_wiring` absent; suite 0.4i gets `InstructionFallbackNotFound`), 33 (notice is an init value exercised at 60s in 3c.K5/3c.G2), 51/54 (boost built; CU measured). All hold. The Bank/co-signer/deck family (1a–24) is gone with those components.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain marked OPEN; `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline`, and `vault_collection` as OPEN and `judgeLaunch` refuses OPEN values; the holder guide is DRAFT and gated behind item 50; the web pages are staged, not published. One nuance worth recording, already flagged as web/README open-decision 6 and **not** a new finding: the ceremony funds the revenue address to *exactly* rent exemption, while SPEC item 52 says "above rent." Functionally adequate (a rent-exempt account can receive further lamports, and `sweep_sol_for_swap` keeps ≥ the 0.05 SOL reserve thereafter), but the wording should be reconciled before the ceremony runs.

---

## Findings

I file **no CRITICAL, HIGH, or MEDIUM**. After an adversarial pass over all eight targets I did not find a defect that survives the recorded measurements or that I can substantiate with on-chain/test evidence. Per the round's own rule, I decline to invent a finding to look useful. The two items below are the only new, checkable observations, and both are informational.

**INFO-1 — revenue funding wording (doc reconciliation).** `web/src/lib/plan-ceremony.mjs` `fund` step tops the revenue address to exactly `getMinimumBalanceForRentExemption(0)`; SPEC item 52 says "fund it above rent." Evidence if I am right: the two texts differ; web/README open-decision 6 already records it. Fix: pick one wording (at-rent is sufficient) and align SPEC/README before road step 10. No code change required if "at rent" is ratified.

**INFO-2 — seven negative arms remain reason-unpinned (carried, confirmed).** R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8 assert ALLOW/REJECT and post-state but have no `because()` pin, so a future change that flips the *reason* (not the outcome) would pass. This is round-40 A9 / rounds 37–39 A-series, already stated; I record only that it is still true in this tree and was not fixed by the round-40 repairs. Fix when convenient: add `because()` pins naming the measured Core/heap error strings.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — do these before launch; AI audit structurally cannot

1. **Independent reproducible-build attestation by a human with the deploy key.** Rebuild all five artifacts from the recorded release commit on a clean machine, confirm the `dist/SHA256SUMS`, then `solana program dump` each deployed program and byte-compare (prefix hash + zero tail). AI rounds can read the script but cannot perform the privileged deploy/dump against mainnet or hold the key. This closes the one gap `build-mainnet.sh` itself names (the four keyed binaries are proven behaviorally, not byte-diffed).
2. **Run the mainnet dress rehearsal (item 22) live, with real small amounts, and record signatures.** The crank, alarm, and a full revenue cycle through *both* pools plus one forced post-sweep failure walked through hand recovery have never touched a live cluster. No AI round in this process can send live transactions or observe a real RPC under real rate limits.
3. **Finalize the three OPEN launch values and sign the four `initialize` transactions from `launch/mainnet-init.json` under human custody** (`charter_opens_at`, `lock_deadline`, `vault_collection`). A human must own the calendar decision and the one-time signing; the checker only refuses, it does not choose.
4. **Verify human custody of every hot key at the moment of launch:** Gary's guardian/INIT_AUTHORITY wallet, the swap-operator key, the $CBOB release wallet, and especially the Giraffish Moments collection authority through the 7-day charter window (limit 46). AI can state the risk; only a human can attest the key is cold/multisig/monitored for that window. Consider moving the Moments authority cold for the window — it is the single cheapest large risk reduction left.
5. **Publish and smoke-test the holder pages and the RPC proxy on the real domain under realistic load, then run the two-clean-rounds gate with genuinely different model rosters.** The independence requirement (two consecutive clean rounds, different rosters) is a process property no single AI round can self-certify; and the pages' real-browser/wallet behavior (Phantom message mutation, proxy rate limits under crowd) needs a live environment.
6. **Stand up the redemption-poster sender and the Squads return procedure for rescued vaults** before the first opening, since `rescue_nested`'s return leg is a human act from the multisig (limit 58). AI can verify the on-chain move; only a person returns the vault.

If all six are completed and two consecutive clean rounds with different rosters are recorded against the frozen tree, the five programs are, to the limit of this process, ready to be made immutable. I found nothing in this round that should delay that, but I certify only what the bundled measurements show, and I could not re-run them here.