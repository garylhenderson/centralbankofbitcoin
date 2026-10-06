# Round 31 — Independent audit of the whole tree

**Verdict up front: I could not break custody, the pool's arithmetic, the pairing, the helper's access control, or governance's reach. Every cross-program offset, account space and discriminator I recomputed from the struct definitions agrees with the code. Round 30's repairs are present and match their descriptions where I can read them. My surviving findings are one LOW (a certification-gate robustness gap of the project's own most-repeated defect class) and two INFO-level items. I state my measurement limits explicitly rather than padding the count.**

---

## R0. Round 30's verdict and its repairs

Round 30's programs pass was **NOT CLEAN and QUORUM NOT MET (5/8 counted)** — I read the verdict, not the summary of it. Its findings and the state of each repair in this tree:

| Round-30 finding | Repair claimed in VALIDATION.md | Independently verified here |
|---|---|---|
| **M1** (MEDIUM): a >20,000-signature flood after the cursor blinded the signature walk permanently; the page text lied | `bank/sigwalk.mjs` takes `startBefore`; alarm keeps `backlogs[program] = {head, before}`; drain needs positive proof; SPEC "Scan backlog boundary" | **The bundled half is real.** `signaturesSince` now accepts `startBefore` and pages downward from it without re-fetching the examined window; the empty-return hazard the round-30 repair introduced (a pruned resume point reads as "done") is answered by the alarm-side drain proof, which **is not in this bundle** — see Limitations below. The SPEC boundary statement is accurate as far as it goes, including the cost arithmetic (20,000 × 5,000 lamports ≈ 0.1 SOL per pass of sustained delay; 20,000 `getTransaction` reads per flooded program per pass). |
| **L1** (LOW): the coverage gate counted a path, not content; `tests/initauth.test.ts` had drifted through six commits since its last bundling | content-aware gate: current git blob must equal the blob at the frozen HEAD of a completed, quorate round | **Present and correct in shape.** `scripts/audit-coverage.sh` now reads each round's bundle from the audit script *at the manifest's head commit*, requires `auditors >= required`, and skips rounds whose verdict records a failed quorum. `tests/initauth.test.ts` is in this round's bundle. One residual hole — see **Finding 1**. |
| **D1/D2/T1** (INFO): record rent at the wrong rate; drain time wrong; build-mainnet banner attached the wrong evidence | doc fixes | **All three fixed**: SPEC 49 and line 672 now say 1,772,920 lamports on mainnet (2,429,040 test-validator); DESIGN §8 now says ~209 h / 8.7 days; the banner's parenthetical now sits on the localnet acceptance clause. |
| Off-chain L1/L2/L3 (log_coverage_gap only when our program ran; crank fee floor; MIN_SWEEP_LAMPORTS) | alarm/crank/swap changes | **Not verifiable here** — those files are not in this bundle. The SPEC statements are consistent with the described repairs, and the "pages only when one of our programs ran" rule is airtight *as stated* (a program that ran must appear in the complete top-level or inner instruction lists, which log truncation does not touch). |

The clean-round counter remains 0/2 and round 30 cannot be retroactively cleared; that is correctly recorded.

**Limitations of this pass, stated rather than hidden:** `bank/alarm.mjs`, `bank/crank.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `bank/accrual.mjs`, `bank/layout.mjs` and `scripts/check-launch-params.mjs` are not in this bundle. The round-30 M1/L2/L3 repair halves that live there — the backlog state machine, the `scan_backlog_unproven` drain proof, the fee floor, the dust floor — I have verified only through `sigwalk.mjs` (bundled), the SPEC text, and VALIDATION.md's recorded 898/898 selftest. The off-chain pass of this round must read them; I flag one specific interaction to check there: **a pruned *cursor*** (not resume point) makes `getSignaturesForAddress(until: cursor)` return an empty list, which `signaturesSince` reports as `{sigs: [], gap: false}` — indistinguishable from "nothing new". SPEC says a cursor the cluster cannot resolve is a CRITICAL; that check lives in the alarm and I could not read it.

---

## R1. Custody

I attacked the pairing, the emptiness proof and the thaw-survival question from first principles:

- **The pairing.** SEAL walks *forward* from its own index for a top-level `burn_vault` matching asset (account 0) **and** owner (account 2); BURN walks *backward* for a top-level `open_for_redemption` matching the same pair. `load_instruction_at_checked` sees top-level instructions only, so a CPI'd burn/open is invisible to the other half (measured WR.2/WR.3). A wrapper hosting a burn *after* a genuine top-level open still requires the owner's signature on the whole transaction and destroys the asset, so it grants nothing the owner could not do directly. Two redemptions in one transaction pair correctly (4.9, 4.10a, S9b). A thawed vault cannot survive its transaction: any later failure reverts the thaw with it.
- **The emptiness proof.** PDA lamports == 0; both ATA derivations of every reserve mint must be *declared*; declared token accounts must be PDA-owned, undelegated (delegate COption tag, delegated amount, close authority all checked at the measured offsets 72/121/129), exactly 165 bytes (refusing Token-2022 extensions, whose confidential balance reads zero), and empty; no declared Core-owned account may be a live asset. The second loop applies the same three delegate checks to non-reserve PDA-owned accounts — the asymmetry round 24 closed stays closed. A Token-2022 ATA for a classic mint cannot exist (measured F4.2: `IncorrectProgramId`), so the second derivation is always either the real classic ATA or a non-account, and BURN's owner-check `continue` is the right reason to skip it.
- **The rate limit.** I re-derived the rolling-window claim: if k+1 redemptions landed in any window of length `redeem_window_secs`, the last one would see the k-th most recent inside the window and be refused — so no window holds more than the cap, wherever it starts. The ring index arithmetic (`(head + 64 - k) % 64` = k-th most recent) is correct; `rate_head` (u8) cannot exceed 63; the clamp to 64 is stricter-never-looser; `checked_sub` on a future timestamp fails closed.

**No finding.** This matches 30 rounds of attack and I found nothing new.

## R1s. The sweep helper

- **(a) Access control.** Direct calls need the asset-signer PDA's signature (impossible). Through Core, Execute is owner-only on this pinned binary (SR.5/SR.5a/SR.5b/SR.5c/SR.5d, and the AgentIdentity route is refused to owners, R24.1a). While frozen, Core refuses Execute (0x9), so the helper is unreachable outside a redemption. The helper is generic — any program *may* CPI it with its own PDA — but that moves only that program's own funds, which it could move anyway.
- **(b) Pair list.** Duplicate source: the first pair closes it, the second fails `read_token` on the system-owned closed account — the whole transaction reverts (client error, SR.12a/SR.12b pin that the *second* read is what fails). A source cannot also be a destination (`signer != dest` plus the owner checks make the same account unable to satisfy both). wSOL works (round-30 W2 measurement). A frozen source reverts the redemption (SR.14) — documented. A non-ATA destination is allowed but harmless (the owner chose it).
- **(c) Destination checks.** The destination wallet is chosen by whoever builds the transaction, and only the owner can get Core to sign the Execute — so the choice is the owner's. Lamports to a non-System destination land (R27.S1); to a non-existent below-rent destination the System transfer refuses (documented, item 50; the canonical destination is the fee-paying owner).
- **(d) Lamport sweep.** `signer.lamports()` is read after the pair loop (whose closes credit `dest`, not the signer). A later instruction in the same transaction depositing into the PDA would make BURN's `lamports == 0` fail and revert everything; nothing between the Execute and the burn can deposit. Core's BurnV1 refunds the *asset's* rent to the payer, not the PDA.
- **(e) Interaction with BURN.** A closed account is system-owned/absent; BURN finds it by key and `continue`s on the non-token owner — it passes for the right reason (nothing is there). The prior-transaction preparation rule is sufficient *with the helper*: a stranger's deposit into a reserve ATA is swept at execution (SR.4); a deposit into an account the page did not name makes BURN refuse `VaultNotEmpty` once, and the retried page names it. No account a stranger can create is both un-nameable by the sweep and un-skippable by BURN: T22 ATAs for classic mints are impossible; non-ATA classic accounts are nameable; nested Core assets are the accepted limit 44.
- **(f) Fit.** S8.0's 1,061 bytes includes claim + open + helper(3 pairs) + burn with the pool account the in-line monthly run needs; the +52/+96 reservation covers the compute pair and separate payer. A fourth reserve cannot exist (`MAX_RESERVE_MINTS = 3`, written once).
- **(g) Evidence.** The SR arms are falsifiable (SR.12b in particular pins *which* read failed). The helper's crate has no `localnet` feature, and `build-mainnet.sh` cmp's `dist/` against both the fresh localnet build and `target/deploy/` — the bytes the suite deployed. I found no arm that cannot fail.

**No finding.**

## R2 / R2b. The pool and the boost

I re-derived the invariant chain independently:

- **`owed_scaled` == the sum of every live record's `weight·acc + carry − debt`** holds across `join` (debt = w·acc), `credit` (owed += δ·w = Σ wᵢ·δ), `claim` (owed -= pay·SCALE ≤ pendingᵢ), `reweigh` (moves pending to carry; owed unchanged), and `retire` (owed -= pending; the record's pending becomes 0 via debt = w·acc, carry = 0). The host test N1 checks exactly this over 260 epochs.
- **Pool ≥ ceil(owed)** holds: `distribute` computes `avail = balance − ceil(owed)` and adds `δ·w ≤ avail·SCALE` to owed; claims subtract exact multiples of SCALE; retires only decrease owed. `monthly_inline` uses `saturating_sub` and credits nothing when short.
- **Counters.** `pending_this_epoch` resets only in `advance_epoch`; `retire` decrements it only when `request_epoch == dist_epoch` (F21.1 both ways). `waiting_to_join = pending_count − pending_this_epoch` is therefore exactly "eligible but unjoined", and both gates (`JoinWaitingFirst`, `BoostsExpireFirst`) are clearable by anyone for anyone — I could not construct a liveness deadlock: joining needs only a record and its derivable ATA; expiring needs only records; a bare-burned pending vault is retired by anyone.
- **The boost ring.** Two live (not-due) end epochs never share a slot: a live boost at epoch c has end ∈ (c, c+63], so two ends differ by ≤ 62 < 64. `unschedule_boost`'s two branches are correct because `dist_epoch` can never exceed a live boost's end (the distribution that reaches `end` makes it due and `BoostsExpireFirst` blocks the next). No double-expiry (weight is zeroed and every path guards on it), no early expiry (`expire_boost` requires `dist_epoch >= end`; `expire_boosts` skips not-due), no never-expiry (the gate blocks distributions until cleared). A boost earns exactly N: BO.21/BO.21a/BO.35/BO.35a pin both in-transaction orders and the exact due epoch.
- **SPEC's weaker wording (round 24 W11)** is what the code does: revenue already in the pool when a vault joins is shared at the next distribution by everyone joined then, including the new vault. I could not make the stronger reading true or find a third reading the code permits.

**No finding.**

## R3. The level draw

The SlotHashes parse is fail-closed (key pinned, count ≤ 512, buffer bounds checked, all-zero hash refused). The capture deadline is sound: A ≤ reveal_slot+64 and C ≤ ~reveal_slot+208, both inside the 300-slot window and inside the 512-slot buffer at the latest legal `now`. The FIFO is enforced by `index == revealed_total`; a burned head still draws (L.11) so the queue cannot stop at it; a lapsed head must be rescheduled (permissionless, alarmed) — the documented stall. The attribute re-supply hash is checked against the mint-time hash of the full list (charter mark included).

On "is SPEC 26 worse than stated": the grinding power quantified there (best-of-4 by skipping, 64 content tries, cohort-wide) is, as far as I can construct, the whole of it — skipping past one's own 4-slot group hands C to the *next* leader. One dimension is slightly wider than the text: see **Finding 3**.

## R4. Governance

The electorate is fixed at creation (`index_snapshot`, `quorum_supply`); the divisor at execute is the snapshot; a mid-vote mint neither votes nor raises the bar. Key changes need YES ≥ ceil(50% of the snapshot), never share a proposal with each other, and land only after notice; the guardian can cancel a pending operator but not its own replacement. I checked the skip conditions against MINT's refusals: GOV skips a restart exactly when MINT would refuse it (`stop_at >= created_at` both sides), so a ratified bundle cannot die at execution on a `StopIsNewer`; `TightenSweep` is monotone and its creation-time bounds are read from values fixed at initialize, so they cannot drift. A whole-skip proposal still counts as executed. Freezing forever requires the documented preconditions (all vaults gone, limit 45; guardian replacement failing at turnout, limit 47).

**No finding.**

## R5. The charter claim

The Merkle scheme is domain-separated (0x00/0x01), sorted-pair, odd-node-promoted; the JS and Rust are one implementation each and the program verifying a JS-built proof is the drift check. Identity is by address against the pinned root; the lookalike is refused (C.8). The PoB must be live, Core-owned, in the pinned collection, owned by the signer, and is CPI-burned in the same instruction. `pob_extra` accounts are passed through never as signers (the AccountMetas carry `false` unconditionally). The window is clock-only and ungated by the guardian, per ruling. SPEC 46's enumeration of the hot wallet's powers (block-all, admit-only-own, per-asset plugins, the sampling gap, the cannot-transfer bound) is, as far as I can construct, complete for the charter window; the one power it does not name is the reschedule-adjacent one that does not exist here (the hot wallet has no influence on the draw).

**No finding.**

## R6. Configuration, the trusted hop, the royalty, the cap

- `initialize` cross-checks are as documented; the residual gaps (SEAL checks only owners; off-curve keys accepted; `redeem_window_secs` 10 s–24 h) are item 38's documented checker-vs-program gap, and `launch/mainnet-init.json` still correctly refuses to pass with `charter_opens_at` and `lock_deadline` OPEN.
- The swap operator's worst case is cap × cooldown windows until the guardian stops, bounded by the revenue balance above the reserve — stated as a rate, not a total, in both SPEC and the holder guide. Correct.
- The royalty: plugin authority None; MINT's only Core CPIs are CreateV2, AddCollectionPluginV1 (once, at init), UpdatePluginV1 (asset attributes), and burns. No instruction reaches the collection's Royalties after init, and Core refuses authority-None updates from anyone (R.3/R.5/R.6/R.6a/R.6c, both directions).
- The redemption cap is exactly a rolling window over a 64-entry ring of *timestamps* with the k-th-most-recent test — see R1.

**No finding.**

## R7. Cross-program raw reads

I recomputed every offset from the struct definitions. MintConfig: version 8, collection 9, governance 41, pool_ata 73, round_id 105, price 125, minted_total 141, sales/sweep_stopped 191/192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, level_caps 290, level_minted 310, revealed_total 330, charter_closes_at 442, charter_claimed 450, bare_burns_retired 454, total_active_weight 462, active_count 470, acc 478, owed 494, last_distribute_at 510, stop times 518/526, pending operator 534/566, monthly 574, pending guardian 582/614/615, notice 623, tighten bounds 631/639/647, dist_epoch 655, pending counts 663/671, cbob_mint 679, boost bounds 711/712, boost terms 714/722/723, boost counters 725/729/733/741, ring 749..1005. VaultRecord: 221 bytes total, all suite offsets match (pending 177, request_epoch 178, boost_weight 186, boost_end 187, carry 195). BurnConfig: burned_total 42, window 50, head 58, ring 59. SEAL config: collection 9, reserves 41. Account spaces: MintConfig 1261 (data 1005 + 256 padding), VaultRecord 221, BurnConfig 827, SEAL 398, GOV 359, Proposal 259, VoteRecord 74 — all consistent with the `init` space expressions field-for-field. All twelve pinned discriminators match their derivations (the suite pins these too, 3.1a–3.1t, BO.29). The helper's token-account offsets (mint 0, owner 32, amount 64, state 108, length 165) are correct.

**No misread found.**

## R8. The suite, the simulation, the build

- I looked for arms that cannot fail and for wrong-reason negatives. The `because()` pins are unique per id (ID.1 enforces it). The RL.S1–S6 stamp probes genuinely detect ambiguity and backward counters. SR.12b pins which read failed. The concurrent-host arms (IN.1, RL.2) do not create a false-fail hazard: only burn-carrying transactions snapshot supply, and concurrent *burns* do not move `minted`/`bare`, so the ambiguity check cannot fire spuriously in the shapes the suite runs. X.7 is honest about the empty plan.
- The CAP_STAMPS mechanism is self-enforcing: RL.7 requires zero unstamped burns, so a burn escaping the stamping wrapper fails the run.
- The build: `build-mainnet.sh` refuses a dirty tree, proves the key swap behaviorally in both directions for all four keyed programs, and proves the helper's mainnet bytes identical to both the fresh localnet build and `target/deploy/` (what the suite and sim deployed). Its "NOT PROVEN" paragraph is accurate.
- The expiry-budget gate does what it says (synthetic genesis, real MINT execution, default-CU landing) and says what it does not (no full lifecycles).

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?** One, marginally, in one dimension — Finding 3 (the reschedule vector's actor set). Everything else I re-derived matches or is *safer* than stated (the drain time, the cap arithmetic, the frozen-account consequences, the helper's coverage of classic strays, the swap rate bound).

**2. Is anything listed as a limit not actually a limit?** No. Limit 42 is correctly re-stated as a client contract rather than an impossibility (the 1,219-byte narrow variant); limit 35's arithmetic is right (10.71% > 10%); limit 32's ring bound (live ≤ 3,047) is right.

**3. Is any DISCHARGED item not discharged?** No. Item 54's two stated extrapolations (14-vault claim batch, 20-of-30 expiry batch) are named as such rather than hidden. Item 19 is closed by construction (`NotRevealed` at activate). Item 51 is built and measured both ways.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still open, still described as blocking, and the holder guide is still DRAFT with the publication ban intact. `launch/mainnet-init.json` still refuses to pass with the two OPEN values.

---

## Findings

### Finding 1 — LOW: the coverage gate's quorum check reads only the verdict's first five lines

- **Construct:** `scripts/audit-coverage.sh`, the content-check python: `head5 = ''.join(open(vf).readlines()[:5]); if re.search(r'INCOMPLETE QUORUM|QUORUM NOT MET|QUORUM IS NOT MET', head5, re.I): continue`.
- **What an accident gains:** a round whose verdict records a failed quorum anywhere below line 6 is counted as a completed, quorate round, and its bundle credits coverage for every file it carried — the exact defect class (a gate whose input changed shape underneath it) that this script's own header documents happening twice before (the `f()` → `TARGETS` drift that blinded it for two rounds, and the hand-picked-globs miss of round 29 L1). This gate is ship-gate condition 1; a silent credit here is a silent credit on the certification.
- **Evidence if I am right:** move the string "QUORUM NOT MET" to line 6 of any recorded verdict and run the gate in strict mode; it will credit that round's bundle. No run is needed to see the bound: the slice is `[:5]` and nothing else constrains the verdict's format.
- **Fix:** scan the whole verdict file, or (better, since the gate already parses the MANIFEST) record `quorum_met: true/false` as a structured field in `MANIFEST-*.json` and read that; free-text verdicts are the least stable format in this repository and the gate should not depend on where in them a sentence sits.

### Finding 2 — INFO (verification boundary, not a defect claim): the round-30 repair halves that live in `bank/alarm.mjs`, `bank/crank.mjs` and `bank/swap.mjs` are outside this bundle

- **Construct:** this pass's file list.
- **What is at stake:** the M1 drain-proof state machine (`scan_backlog_unproven`, the cursor-advance rule), the crank's fee floor, and `MIN_SWEEP_LAMPORTS` — the parts of the round-30 repairs I could only verify through `sigwalk.mjs`, the SPEC text and VALIDATION.md's recorded 898/898.
- **Evidence / what to check in the off-chain pass:** specifically the *pruned-cursor* case (a cursor the RPC no longer knows makes `signaturesSince` return `{sigs: [], gap: false}`, indistinguishable from "nothing new" at the sigwalk layer) and its interaction with the new backlog logic; and that the both-ways selftest arms for the drain proof are the ones VALIDATION describes.
- **Fix:** none in code; ensure the off-chain seat of this round reads those files (the coverage gate already requires it).

### Finding 3 — INFO: limit 25/26's reschedule vector is slightly wider in *who* than stated

- **Construct:** `programs/cbob-vault-mint/src/lib.rs`, `reschedule_reveal` — permissionless, with no owner check (correctly: it is the crank's own path).
- **What an attacker gains:** SPEC 26 names "a validator can time a mint (or a reschedule) to put C inside its own rotation", framing the beneficiary as the vault's owner or cohort. Because reschedule is permissionless for *any* lapsed vault, a validator holding later-minted vaults can also reschedule **strangers'** lapsed vaults into its own rotations and grind C to give *them* low draws — under without-replacement drawing, every low draw assigned to an earlier vault raises the probability that the validator's own later vaults draw high. The precondition is unchanged and alarmed: a full ~2-minute capture window of total silence (`reveal_rescheduled` pages per event; `reveal_queue_stalled` pages on a non-moving queue), which the every-minute crank normally prevents.
- **Evidence if I am right:** read `reschedule_reveal`'s constraints — there is no owner or minter check, and the new `reveal_slot = now + 16` is chosen entirely by the caller's timing.
- **Fix:** none on chain (the window requirement is the control, and any owner check would break the crank). Add one sentence to SPEC 26: the reschedule vector can be aimed at any lapsed vault, not only the rescheduler's own, so its beneficiary can be a holder of later-minted vaults harvesting census bias.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what should this project do before launch that AI audit structurally cannot?

1. **Run the rehearsal with real money and real scale, and treat its failures as the audit.** No local validator produces mainnet conditions: RPC pagination under load, transient errors at vault 1,900 of 2,100, the every-minute reveal lane against real leader timing, real skipped slots (the suite's validator skips none — the skipped-slot paths exist only in host unit tests), signature-history retention, fee markets. Item 22's named pass/fail list is the right list; the both-venue revenue cycle and the forced post-sweep failure walked through by hand are the two items most likely to find something thirty rounds of reading could not.
2. **Rebuild the artifacts on a second, independent machine and compare sha256s.** `build-mainnet.sh`'s own banner says it: the compiled INIT_AUTHORITY constant is proven only by reproducibility. That, plus the toolchain itself (cargo-build-sbf, platform-tools v1.54, the solana crates, the pinned Core dump) — a supply chain no AI round reads — is the bridge between "the source names Gary's key" and "the bytes carry it".
3. **Put the launch ceremony in writing and execute it with two people.** Deploy → verify bytes → initialize *from* `launch/mainnet-init.json` (the checker validates the JSON, not the signed transaction — round 24 A6) → create the three cbBTC accounts (item 52) → remove five upgrade authorities. Every step is permanent and none is automated. A read-aloud checklist with a second person confirming each signature is the only control class that fits.
4. **Move the hot keys before the window, or accept them in writing with a name attached.** The $CBOB release wallet (limit 56) and the Giraffish Moments collection key through the charter window (limit 46) are the two places where a single box compromise is project-ending. Gary has ruled both hot; the ruling should be re-confirmed *after* he reads the two limits in full, with a date, because immutability converts "accepted" into "forever".
5. **Write the incident-response plan before launch, not during the first incident.** Who holds the guardian phone at 3 AM when Core upgrades; what the guardian does and does not stop; what is said to holders if the pool is frozen by Coinbase; who may run the hand recovery of an open revenue cycle (limit 10's runbook exists — rehearse it, which item 22.4 does). The alarm detects; only people respond.
6. **Have a human read the holder guide against the code one more time before it is published**, sentence by sentence, after the pages ship (item 50). It is the only document holders will act on, and its draft is currently accurate — but "currently accurate" is a property of a moment, and the publication ban is the only thing enforcing it.
7. **Decide, with names and dates, who owns each accepted limit.** AI rounds can state limits 41, 44, 46, 47, 55 and 56; they cannot *own* them. A one-page register — limit, owner, date re-confirmed — is what turns a carry list into a decision, and it is the cheapest thing on this list.