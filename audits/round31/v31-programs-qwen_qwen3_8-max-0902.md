# Round 31 independent audit — CBOB Vaults v6 (five programs + off-chain)

Scope: frozen tree at the round-30 repair commit (`0d13b03` lineage), whole-file read of all five programs, the sweep helper, the bundled off-chain readers, the suite/sim/build evidence, and the round-30 verdict. I re-derived every cross-program offset, re-checked the pool/boost/rate-limit algebra from the source, and attacked the pairing, emptiness proof, sweep, charter Merkle, and governance tally. Where a claim below is checkable, I state what would be observed on chain or in a test run.

**Bottom line up front:** I found **no CRITICAL and no HIGH** in the on-chain programs. This independently corroborates red-team 3's central result. The round-30 repairs (sigwalk backlog drain, truncated-log flag mode, content-aware coverage gate) are present and, where the bundled code lets me verify, correct. I file **two LOW** and **three INFO** items below, none of which moves value or breaks custody. The custody invariant (R1) held against every construction I tried.

---

## R0 — Round-30 verdict and repairs

**Verdict accuracy.** The round-30 programs verdict (NOT CLEAN, QUORUM NOT MET, 5/8 counted, six required) is internally consistent. The exclusion of the Grok seat is defensible from the description (a ~5.7 KB restatement of the round-29 verdict that asserts the M1/L1 repairs "must be done" although both are visible in its own bundle). I cannot see that seat's raw output — it is not bundled — so I treat the quorum arithmetic as *reported*, not independently replayed. That is a process caveat, not a finding.

**M1 repair (sigwalk backlog) — present.** `bank/sigwalk.mjs` now takes `startBefore` and pages backward with `before`, returning `gap:false` when a page comes back short (i.e., the walk reached `until`). The drain/proof logic lives in the alarm, which is **not** in this bundle, so I verified the helper's contract, not the caller. Residual caller burden is noted under INFO-3.

**Truncated-log flag mode (round-29 M1) — present and correct.** `bank/txread.mjs` refuses the exact runtime marker `Log truncated` by default and only returns `logsTruncated:true` in validated `flag` mode; a program's own `Program log: Log truncated` text is not the marker. I imported this module read-only against mainnet and confirmed v0/v1/legacy responses with `innerInstructions: []` (no CPI) validate cleanly, matching round-30's W3 measurement.

**L1 repair (content-aware coverage gate) — present, with one residual (Finding L-1).** `scripts/audit-coverage.sh` now requires each tracked file's *current git blob* to equal its blob at the frozen HEAD of a completed, quorate round that bundled it; `--prepared` credits only the next prepared bundle. It correctly disqualifies a round whose verdict header records a quorum failure. The fragility I found is in *how* it detects that header (see L-1).

**Doc repairs D1/D2/T1.** Record rent (mainnet 1,772,920 lamports for the 221-byte record) and the ~209 h drain figure are stated in VALIDATION; the build banner's "reaching a later check" parenthetical now attaches to the **localnet-accept** clause in the bundled `build-mainnet.sh`, which is the correct attachment. I confirm these as repaired, not re-filed.

---

## R1 — Custody: can anyone but the owner get value out, or an emptied vault survive?

I could not break it. Constructions tried and why they fail:

- **CPI-wrapper pairing.** `retire_redeemed` requires `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` *and* re-reads the top-level instruction at the current index, requiring `program_id == BURN` and the burn discriminator with the same asset at account 0. A wrapper calling `burn_vault` makes the current top-level instruction the wrapper, so the program-id check fails (`NotFromBurn`). This is the measured WR.1–WR.4 result; I re-read the code and it is load-bearing in both directions.
- **Two vaults / cross-borrow in one tx.** Both SEAL and BURN bind asset **and** owner at fixed account indices (0 and 2). `open A … burn B` fails `NoTerminalBurn`/`NoPrecedingOpen` because neither walk finds a same-asset+same-owner match. Ordering open-then-burn is mandatory; reversed, whichever runs first refuses. Atomicity means a thaw can never outlive a failed burn — there is no instruction set that leaves a thawed-but-unburned vault, because any failure reverts the whole transaction including the Core `UpdatePluginV1` thaw.
- **Instruction-sysvar parsing.** `load_instruction_at_checked` sees top-level only, which is exactly what makes the CPI attack fail. Compute-budget instructions in the walk are skipped by program-id. Versioned (v0) transactions resolve keys into the sysvar (measured S9b), so pairing holds through a lookup table.
- **Emptiness proof.** Reserve ATAs must be declared for *both* token programs per mint; a nonexistent ATA passes only because it is not token-program-owned (skipped), and a live one must be PDA-owned, undelegated, extension-free (len==165), and zero. The second loop re-checks any *declared* PDA-owned token account and any declared Core asset. The completeness gap (undeclared non-ATA accounts, undeclared nested assets) is real but is proven-impossibility 2 and accepted limits 9/44; I confirmed a stranger **cannot** create a non-ATA classic token account owned by the PDA (needs the PDA's signature on `InitializeAccount`), and probe F4.2 already measured that a Token-2022 ATA for a classic mint is refused `IncorrectProgramId`. So the only stranger-createable accounts are ATAs (covered by declaration) and nested Core assets (the accepted gap).

**Emptied vault survival:** none. Burn is terminal and atomic; the asset becomes the 1-byte Core tombstone, the PDA is 0, and the address is not re-mintable (measured 9.12/9.13, S9.1/S9.2).

---

## R1s — Sweep helper

I answered each sub-question against the source:

- **(a) Who can move value.** Direct call requires `signer.is_signer`; the signer is the asset-signer PDA, which only Core signs, and Core's `ExecuteV1` approves only the asset owner on a thawed vault (measured SR.5/SR.5a/SR.5c). The helper itself has no authority logic and needs none. I found no route for an update authority, delegate, the SEAL freeze PDA, or the collection authority.
- **(b) Pair list.** Duplicate source: first iteration closes it, second `read_token` fails `IllegalOwner` (measured SR.12a). Source==destination: fails because `signer != dest` is checked and `to_owner` must equal `dest`. Duplicate destination with distinct sources is benign. Native wSOL source: works — I re-checked round-30's W2 measurement logic (a 165-byte classic account whose amount equals wrapped lamports; transfer+close unwrap correctly). A source with a delegate/close-authority still closes because the PDA is the *owner*, and SPL close-by-owner is unaffected by a close authority; BURN would have refused it open, but the sweep closes it first, which is the intended rescue.
- **(c) Destination checks.** `dest` is not compared to the asset owner, but (a) means only the owner can trigger, so `dest` is the owner's choice. Crediting a non-system-owned `dest` works (measured R27.S1). Crediting a nonexistent below-rent `dest` fails and blocks the redemption — this is a *client* obligation (SPEC item 50 names it), not a program defect.
- **(d) Lamport sweep.** `signer.lamports()` is read at execution and drained to exactly zero via System transfer (zero is a legal post-transfer balance). Within the atomic redemption there is no instruction between the Execute and the burn that could re-credit the PDA unless the owner inserts one (self-grief). Core does not move lamports in `ExecuteV1`. BURN then reads 0. Confirmed by SR.4/SR.13/S8.
- **(e) BURN interaction.** A swept-and-closed reserve ATA passes the reserve loop *because it is no longer token-program-owned* (the `continue`), which is the right reason. Prior-transaction creation of missing reserve ATAs (SPEC REDEEMING step 1) is sufficient; I found no account class a stranger can create that is neither sweep-nameable nor burn-skipped (see R1).
- **(f) Fit.** S8.0's 1,061-byte measurement leaves room for the compute-budget pair and a separate payer; the narrow three-create variant (1,219 B) is an offline measurement, correctly labeled as such.
- **(g) Evidence / same bytes.** `build-mainnet.sh` compares `dist` == localnet build == `target/deploy` for the helper, and `run-tests.sh` deploys `target/deploy`; VALIDATION records matching hashes against the suite log. I consider the tested-bytes == shipped-bytes claim for the helper established. I found no arm that cannot fail; the `because` pins use program-specific error text and the SR arms pin the helper's exact `ProgramError`s.

---

## R2 / R2b — Pool and boost invariants

I re-derived the accumulator algebra:

- `credit` adds `delta = floor(avail·S/w)` to `acc_scaled` and `delta·w` to `owed_scaled`; since `delta·w ≤ avail·S`, `ceil(owed/S)` never exceeds the pool balance. `claim` pays `floor(pending/S)` and reduces `owed_scaled` by `pay·S`, preserving the invariant. Only `claim` (config-PDA-signed Transfer) moves tokens out, and it is bounded by owed, so the invariant `pool ≥ ceil(owed)` cannot be violated from inside. **P.32 holds by construction, not just by test.**
- `join` sets `debt = w·acc`, `carry = 0` → owed 0 (earns from the *next* distribution). `reweigh` moves owed into `carry` and resets `debt = new_w·acc`, preserving owed exactly. `retire` subtracts `pending` from `owed_scaled` and returns it to the pool. I checked the `pending_this_epoch` decrement branch for underflow in same-epoch vs earlier-epoch retirement and found it balanced (each increment pairs with exactly one decrement or a reset). F21.1 covers it.
- **Liveness:** `JoinWaitingFirst` and `BoostsExpireFirst` are both clearable permissionlessly (join via claim/activate; expiry via `expire_boosts` needing only records). I found no way to make distributions or redemptions permanently impossible for others. A frozen pool reverts paying claims but redemption forfeits (3c.F), and explicit `distribute` crediting from a frozen pool only makes vaults owed (acknowledged in SPEC).
- **Boost ring:** max duration 63 < ring 64; `advance_epoch` consumes a slot into `boosts_due` and zeroes it, and `unschedule_boost` handles due vs not-due. A same-slot alias between two live boosts would require end epochs differing by exactly 64 while both are pending, which `BoostsExpireFirst` prevents (the earlier one must be expired before the later distribution). Host test N1 (260 epochs, four wraps) and on-chain BO.34/BO.38 exercise the wrap and early-retire branches. I found no double-expiry, early-expiry, or never-expiry path.

---

## R3 — Level draw

`blockhash_in_window` is defensively bounded (count ≤ 512, length check, all-zero hash refused) and selects the smallest produced slot in `[want, want+64]`. The three-hash stride, FIFO by `revealed_total`, burned-head handling (draw still counted, Core write skipped), and the attribute re-supply hash all check out. I found no new influence beyond accepted limits 25/26: the C-leader grinding and the lapse-for-reroll are real and correctly stated, including the cohort effect (same `reveal_slot` shares hashes). SPEC 26's "choose among many draws" is accurate, not understated.

## R4 — Governance

Tally uses the snapshot divisor for quorum, threshold, 10% turnout, and the 50% key-change bar; all four recomputed correctly. `create_proposal` pre-checks every action against MINT's acceptance, refuses the guardian+operator bundle, and enforces one-action-per-kind. Per-kind ordering with logged skips cannot deadlock: the `last_*_id` marks only increase, so a *newer* proposal is never skipped. I found no minority carry, no path from a vote to `split_bps`/destinations/`max_supply`/the pool (no action encodes them), and no permanent governance freeze (limit 47's stuck-guardian is a stop, not a governance freeze, and is stated).

## R5 — Charter claim

Merkle: leaf tag 0x00, node tag 0x01, sorted pairs, odd-promotion; Rust `merkle_root_from` matches `scripts/pob-merkle.mjs` byte-for-byte, and the second-preimage separation is real. The PoB is CPI-burned as owner in-instruction, `pob_extra` accounts pass through never as signers, and the window is clock-only. **SPEC 46 completeness:** I could not find an omitted capability. The hot collection key can gate/brick claims (collection or per-asset plugins, oracle flipping) and can mint lookalikes (refused by address-set membership), but cannot transfer/burn an individual PoB (positive bound, round 25 D8). The one residual is alarm *sampling* (per-asset plugins, add-and-remove-between-passes), which SPEC 46 already states.

## R6 — One-time configuration

The programs accept some values the *checker* rejects (off-curve guardian/treasury/operator, `redeem_window_secs` down to 10 s) — this is item 38, still OPEN, and the checker is the real gate. The royalty plugin authority `None` is immutable in Core (R.5/R.6 arms, both directions on a control collection). The redemption cap is a true rolling window: `kth = ring[(head+64−k)%64]`, allow iff `now−kth ≥ window`; I verified the ring index arithmetic and the initial-zero behavior.

## R7 — Cross-program raw reads (recomputed)

I recomputed every offset from the struct definitions (Borsh, packed, 8-byte discriminator). All pinned constants agree:

- MintConfig: version 8, collection 9, governance 41, pool_ata 73, minted_total 141, split/flags 189/191/192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, level_caps 290, revealed 330, charter_closes 442, charter_claimed 450, bare_retired 454, total_weight 462, active_count 470, acc 478, owed 494, last_dist 510, stops_at 518/526, pending_op 534/566, monthly 574, pending_guardian 582/614/615, notice 623, sweep bounds 631/639/647, dist_epoch 655, pending 663/671, cbob_mint 679, boost bounds 711/712, boost terms 714/722/723, boosts 725/729, weight_total 733, burned_total 741, ring 749. **All GOV/BURN/suite constants match.**
- VaultRecord: version 8, asset 9, mint_index 41, reveal_slot 49, level 57, charter 58, entropy_set 59, entropy 60, attrs_hash 92, bump 124, active 125, retired 126, reschedules 127, vault_ata 129, debt 161, pending 177, request_epoch 178, boost_weight 186, boost_end 187, carry 195; space 221. **Match.**
- BurnConfig: version 8, collection 9, bump 41, burned_total 42, window 50, rate_head 58, ring 59. **Match.** SEAL Config: version 8, collection 9, reserves 41. **Match.** Sweep helper token layout (mint 0, owner 32, amount 64, len 165). **Match.**

This independently confirms RT3's offset recomputation.

## R8 — Suite / sim / build evidence

I looked for arms that cannot fail or reject for the wrong reason. The `because` pins are program- and error-specific (including Core `0x9`/`0x1a` and the helper's exact `ProgramError`s), and the ID.1 arm asserts unique assertion ids so a pin can't read another arm's error. The floors equal their counts in `run-tests.sh`. I found no cannot-fail arm in the bundled code. One evidence note: the 20-due-boost CU gate (`tests/expiry-budget.mjs`) uses synthetic genesis records encoded via `bank/layout.mjs`; it is correctly labeled as a CU gate, not full lifecycle evidence, and its 4-assertion floor is enforced.

---

## Findings

### L-1 — Coverage gate reads only the first five verdict lines for quorum failure (LOW)
- **Construct:** `scripts/audit-coverage.sh`, the Python block `head5 = ''.join(open(vf).readlines()[:5])` followed by `re.search(r'INCOMPLETE QUORUM|QUORUM NOT MET|QUORUM IS NOT MET', head5, ...)`.
- **Gain:** A future round whose MANIFEST overcounts auditors (the round-30 shape: manifest 6, substantive 5) *and* whose verdict records the quorum failure after line 5 would be treated as quorate and would credit file coverage. That is precisely the failure the content-aware gate exists to prevent: a file whose current content no quorum of auditors saw could be marked certified.
- **Evidence if true:** create a scratch `audits/roundN/` with a MANIFEST reporting `auditors ≥ required`, a VERDICT whose first five lines omit the phrase but whose sixth line contains "QUORUM NOT MET", and a TARGETS bundle; run the gate's Python — the bundled file is credited despite the non-quorate round.
- **Fix:** scan the entire verdict (or a mandated machine-readable quorum field) rather than five lines; alternatively require the manifest to carry a `quorum_met` boolean that the verdict's header must agree with.

### L-2 — `sigwalk.signaturesSince` cannot distinguish "drained" from "resume point forgotten" (LOW)
- **Construct:** `bank/sigwalk.mjs`; when `startBefore` is older than `until` (or the RPC no longer knows the resume point), the call returns `{sigs:[], gap:false}`.
- **Gain:** at the helper level, an empty result is ambiguous. If any caller treats `gap:false`+empty as "drained, advance cursor" without the positive proof, a resume point that fell out of cluster history silently skips the intervening window. VALIDATION states the alarm and poster implement the positive proof (cursor must be the next signature; otherwise `scan_backlog_unproven` CRITICAL), but the alarm source is not in this bundle, so the guarantee currently rests on documentation.
- **Evidence if true:** a caller that advances on `gap:false`+empty against a stale `startBefore` skips signatures; the bundled helper offers no signal to tell the two cases apart.
- **Fix:** have `signaturesSince` return a distinct marker when `startBefore` was supplied and the first page is empty (e.g. `resumedEmpty:true`), forcing every caller to make the drained-vs-forgotten decision explicitly; keep the alarm's positive-proof requirement.

### INFO items (no action strictly required)
- **INFO-1:** the quorum/coverage decision depends on the Grok seat's exclusion, whose raw output is not bundled; future rounds should bundle each seat's raw output (or a hash of it) so the count is replayable.
- **INFO-2:** the orphaned-*activated*-vault permanent dilution (round-29 D2, SPEC "What got worse") is the one on-chain cost that is fixable **only before the lock** (a `retire` path for a vault owned by a burned/foreign PDA). It is correctly flagged as an owner decision, but it should be decided explicitly before the upgrade authority is removed, because after that it is permanent.
- **INFO-3:** v1 transaction format is not certified for the redemption pairing (instructions-sysvar behavior under v1's explicit-limit message is untested); the transaction-format boundary states this, and no v1 writer is shipped, so it is a stated limitation, not a defect.

---

## The four accepted-limit questions

1. **Any limit worse than stated?** I found none worse. Limit 32's drain is actually *slower* than the old 47 h figure (≈209 h as the cap falls with live supply), which is safer for the stated defense purpose; the doc correction is in VALIDATION. Limit 40's Core-upgrade consequences and the round-28 autograph heap boundary are stated accurately and bounded by measurement.
2. **Any listed limit not actually a limit?** No. The ones I re-tested (8 cross-pass lag, 27 dead-weight, 28 freeze, 41 transfer-vs-cap, 44 undeclared destruction) are all genuinely open as described.
3. **Any DISCHARGED item not actually discharged?** I checked 33 (notice apply, exercised in 3c.K5/3c.G2), 51 (boost, built and measured with a disclosed timing residue), 54/12-17 (compute, measured), 14, 19, 30, 31. All hold. The v5 Bank/deck/distributor family is genuinely gone with the code that created it.
4. **Any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still described as open and gating. Item 50 correctly gates publication of the holder guide. The one risk is *schedule pressure* on these, not mislabeling.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concrete pre-launch actions AI audit structurally cannot perform:

1. **Run the live dress rehearsal (item 22) and archive the signatures.** AI can read `bank/crank.mjs`/`bank/revenue.mjs` but cannot exercise them against a live cluster: RPC rate limits, paging at vault 1,900/2,100, the every-minute reveal lane, one full revenue cycle through *both* pools, and one forced post-sweep failure walked through hand recovery. This is the single largest unverified surface and it is off-chain, where all the round-29/30 defects lived.
2. **Move the watcher off the watched box.** The alarm, ledger, and crontab live on the same machine as the swap-operator and $CBOB release keys (accepted limits 10(3), 56). Stand up at least one *independent* monitor on separate infrastructure/key that reads chain state directly and pages through a different channel. AI audit cannot fix same-box trust; only topology can.
3. **Decide the orphaned-activated-vault retirement (INFO-2 above) before the lock.** It is the only permanent on-chain cost that is still changeable. If you do not add a retirement path now, dilution from a nested/orphaned activated vault is forever.
4. **Make the `initialize` ceremony multi-party and recorded.** Values are permanent and the checker validates JSON, not the signed transaction (round 24 A6). Have two people independently rebuild `launch/mainnet-init.json`, run `check-launch-params.mjs`, and sign a transcript binding the file hash to the four initialize transactions before anything is sent.
5. **Add an independent, reproducible proof of the pool invariant.** The accumulator is well tested, but a machine-checked invariant (even a lightweight property harness run in CI against `bank/accrual.mjs` and the program's `credit`/`claim`/`retire`) would catch a future refactor that the 855-assertion suite happens not to cover. AI reasoning about the math is not a proof.
6. **Harden the custody the code cannot reach:** guardian, swap operator, PoB collection hot key (through the 7-day window it can end the project or capture governance — SPEC 46), and the $CBOB release wallet. Where the rulings allow, use multisig/hardware for the charter window at least; the PoB hot key is the highest-value single key during those seven days.
7. **Create an economic incentive for outside humans** (bounty keyed to on-chain invariants) even without a firm. AI rounds converge poorly on *novel* attacks; a standing bounty recruits the one thing this process lacks — adversarial humans with skin in the game.

The on-chain programs are, to the limit of this read, fit to lock. The residual risk is concentrated off-chain (the pipeline, the keys, and the not-yet-run rehearsal), which is exactly the part no audit round — AI or otherwise — can certify from source alone.