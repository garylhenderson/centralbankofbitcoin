# Round 45 — Independent Confirmation Audit

## R0. Round 44 Verdict and Repairs

I independently verified all five V44o repairs at `c9a811d` against the code as bundled.

**V44o-1 (poster per-signature unreadable counts).** In `bank/redemption-poster.mjs`, the unreadable handler now keys counts by `s.signature` (`st.unread?.[s.signature]`), deletes only that signature's count on a successful read, and persists via `writeLedger` before throwing. The old whole-object delete (`if (st.unread) delete st.unread`) is gone. The backlog/gap wedge (a readable signature older than X resetting X's count) is structurally impossible because only `s.signature`'s entry is touched. **Repair holds.**

**V44o-2 (revenue split-recovery scan).** In `bank/revenue.mjs` `splitsSince`, the `readParsedTransaction` call is wrapped in try/catch; a refused read pushes to `refused` and continues. The `if (!tx) continue` path handles null returns. The recovery block checks `refusedSplits.length` and throws naming the unreadable signatures if a returned cycle remains open. **Repair holds.**

**V44o-3 (SEAL-null balance baselines).** In `bank/alarm.mjs`, `reserves` falls back through `D.carryConfigBaseline(prev?.config, cfg)['seal.reserve_mints']` before the payment-mint-only default. The `unbuilt` loop carries forward every previous balance key whose leg was not built this pass, and raises `balance_unreadable` HIGH. **Repair holds.**

**V44o-4 (runner exit status).** In `scripts/run-tests.sh`, both skip branches (mainnet probe and swap fork) use `if [ "${CBOB_SHIP_GATE:-0}" = "1" ]; then die …; fi` — an `if` statement, not `&&`. As the last statement in the script, a no-network run exits 0. **Repair holds.**

**V44o-5 (rehearsal notices for crank and revenue).** In `bank/crank.mjs`, `REHEARSAL = fs.existsSync(REHEARSAL_MARKER)` gates `rehearsalNotice` on every notify call (3 sites). In `bank/revenue.mjs`, the same pattern applies. `rehearsalNotice` in `bank/detectors.mjs` rewrites the label to `<stream>-rehearsal` and prepends `(REHEARSAL)` to the text. **Repair holds.**

**Round 44's confirmed findings re-checked.** I re-derived the three LOWs:
- V44o-1's wedge: confirmed structurally closed by per-signature keying.
- V44o-2's throw: confirmed replaced by collect-and-continue.
- V44o-3's baseline drop: confirmed replaced by carry-forward with `balance_unreadable`.

No regressions found in any repair site.

## R1. The Crank (`bank/crank.mjs`)

I traced every path in `planCrank` and the send loop.

**Reveal FIFO and `capturedThisPass`.** The reveal loop starts at `cfg.revealed_total` and walks up by mint index. It includes a vault if `r.entropy_set` or `capturedThisPass.has(r.address)`. The capture loop populates `capturedThisPass` for vaults whose slot hash is available. Since captures are planned but not yet executed when reveals are planned, a failed capture would cause the corresponding reveal to fail, and the reveal loop breaks on failure (`if (ok === 'fail') { failures.push(…); break }`). No out-of-order reveal is possible.

**Burned vaults in the FIFO.** A bare-burned, unrevealed vault blocks the FIFO until it is captured and revealed (the MINT program's `reveal_level` handles burned assets by skipping the Core write). The crank plans captures for burned vaults (the capture loop does not filter by burn status), and the MINT program's `capture_entropy` does not refuse burned vaults. So the FIFO proceeds correctly. The retire loop runs first in the plan but the retirement is not executed before the reveal loop plans; this is harmless because the reveal still succeeds for a burned vault.

**Rescue planning.** `planRescues` correctly filters to `nested_vault` and `vault_owns_itself` kinds, checks that the nested vault is live, and checks that the host is live, burned, or the vault itself. The `isOnCurve` parameter is `() => true`, which suppresses the `unredeemable_owner` check — intentional, since the crank only rescues.

**Fee budgeting.** `budgetPlan` correctly separates the base plan (everything except reveals) from reveals, checks the base with floor 0, then adds reveals one by one keeping `FEE_FLOOR_LAMPORTS` in reserve. `planCostLamports` correctly counts rescue transactions individually and batches joins/expires.

**No value movement.** The crank sends only permissionless MINT instructions (`activate`, `capture_entropy`, `claim`, `distribute`, `expire_boosts`, `reschedule_reveal`, `rescue_nested`, `retire_burned`, `reveal_level`, `split_revenue`). Every instruction's destination is pinned by the program. The crank's key signs only as fee payer. No token or SOL transfer is constructed by the crank.

**No defect found.**

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I traced every detector and the alarm's main loop.

**`detectSweepState`.** Correctly advances the baseline (`judged: t`) regardless of whether the sweep is explained, since `sweep_unledgered_state` is a one-shot kind. The half-cooldown window and the `landed` set for uncertain sends are correctly implemented.

**`detectLogGaps` and `detectUnreadSkips`.** The watermark-based review system correctly keeps all unreviewed entries, trims the reviewed prefix to stay under 500, and escalates to CRITICAL above 2000 unreviewed. A watermark not in the list causes all entries to be treated as unreviewed (loud direction).

**`detectCrankHealth`.** The covered-freeze filter uses exact string matching against the crank's problem messages. If the crank's message format changes, the filter would not match and the problem would be reported redundantly — this is a noise issue, not a correctness issue. The `problemKey` function strips numbers to group problems across passes.

**Balance baselines (V44o-3 repair).** The `reserves` fallback chain and the `unbuilt` carry-forward are correct. A SEAL config returning an empty `reserve_mints` array (which the program prevents) would cause all previous balances to be carried forward as `unbuilt`, which is the correct fail-safe.

**`detectUnsweptRoyalties`.** The grace period adjustment (`max(86400, cooldown + 3600 + 3600)`) correctly accounts for the hourly revenue job and the on-chain cooldown. The balance-fall reset (`prevLamports > lamports → since = nowSec`) correctly handles sweeps.

**No defect found.**

## R3. The Layouts (`bank/layout.mjs`)

I verified the field lists against the Rust structs by manual comparison.

**MintConfig (64 fields).** The JS field list matches the Rust struct field-for-field, including the stage 3c and boost fields. The `[u32; BOOST_RING]` type is correctly handled.

**VaultRecord (20 fields).** Matches the Rust struct.

**BurnConfig (7 fields) and GovConfig (11 fields).** Match.

**Cross-program offsets.** I manually verified `minted_total` at offset 141 (8 + 1 + 32 + 32 + 32 + 4 + 8 + 8 + 8 + 4 + 4 = 141) and confirmed the selftest checks all 14+ pinned offsets against the Rust source.

**SEEDS.** The 12 seeds in `bank/layout.mjs` are checked by the selftest's D6 arm against the Rust `pub const` declarations.

**No defect found.**

## R4. The Money Arithmetic (`bank/accrual.mjs`)

I compared every function against the MINT program.

**`credit`.** JS: `delta = avail * ACC_SCALE / w`; Rust: `delta = (avail as u128) * ACC_SCALE / (w as u128)`. Both truncate. Match.

**`pendingScaled`.** JS: `(weightOf(level) + boost) * acc + carry - debt`; Rust: `weight_of(r) * acc + carry - debt` where `weight_of` includes `boost_weight`. Equivalent. Match.

**`reweigh`.** JS: `carry = owed, debt = (level_weight + new_boost) * acc`; Rust: same. Match.

**`ceilSats`.** JS: `(scaled + ACC_SCALE - 1n) / ACC_SCALE`; Rust: same ceiling division. Match.

**`available`.** JS: `poolBalance - ceilSats(owedScaled)`, floored at 0; Rust: same. Match.

**No defect found.**

## R5. The Swap and Revenue Cycle

**(a) Oracle math.** The formula `sats = lamports * sol.price / (btc.price * 10) * 10^(sol.expo - btc.expo)` is correct. With both expos at -8, the exponent adjustment is 0. The BigInt division truncates, which is the correct rounding direction (floor). The `satsPerLamport` floating-point value is used only for the deviation check, not the floor. No overflow: `lamportsIn` (≤ 50 SOL = 5×10¹⁰) × `sol.price` (≈ 1.2×10¹⁰) ≈ 6×10²⁰, well within BigInt range.

**(b) Pyth verification.** `readPyth` checks owner (Pyth receiver), verification level (must be 1 = Full), feed ID, and minimum length (101 bytes). The offsets (40 for verification level, 41 for feed ID, 73 for price, 81 for conf, 89 for expo, 93 for publishTime) are correct for the PriceUpdateV2 layout. The exponent range check (-18 to 0) is a reasonable bound. Ownership by the receiver program plus the derived PDA address is sufficient: only the Pyth push oracle can write to the receiver, and the feed ID check prevents substitution.

**(c) Deviation filter.** `orcaSpot` computes `(sqrtPrice / 2^64)^2` in raw units. `meteoraSpot` computes `1 / (1 + binStep/10000)^activeId`. Both are correct for their respective pool formats. The deviation check `|pool - oracle| / oracle * 10000` is symmetric. Floating-point precision is adequate for a 100 bps threshold.

**(d) Minimum out.** Both Orca's `other_amount_threshold` and Meteora's `min_amount_out` receive `minSats` from `oracleFloor`. The floor is `expectedSats * (10000 - 150) / 10000`, which is 150 bps below the oracle expectation. This is the same floor used in the deviation check's denominator. Units are correct: Orca expects token B amounts (cbBTC, 8 decimals = sats), Meteora expects token X amounts (cbBTC = sats).

**(e) The judge.** `judgeSwapInstructions` checks all 7 instructions in order: compute budget (exact limit, no priority fee), two ATA creations (correct mint, owner, payer), System transfer (exact amount, correct destination), SyncNative, the swap (pool, input, output, amount, floor, direction for Orca), and CloseAccount. The output account check (`keyAt(sw, 5)?.equals(ownCbbtc)`) is present for both venues. The judge does not check tick arrays or bin arrays — this is a known limitation (round 44 verdict, C01), and the on-chain swap will fail if the arrays are missing, which is caught by `classifySendFailure`.

**(f) Account derivation.** Orca tick arrays: `orcaTickArrayStarts` computes the current array and two below (for a_to_b swaps). Meteora bin arrays: `meteoraBinArrayIndexes` computes the current array and two above (for Y-to-X swaps). Both are correct for their respective swap directions. The bitmap is passed as the program ID when absent (Anchor's None convention).

**(g) wSOL handling.** The swap wraps exactly `lamportsIn`, syncs, swaps, and closes. If the operator's wSOL ATA already exists with a balance, the System transfer adds to it, SyncNative updates the balance, the swap consumes `lamportsIn`, and the close returns the remainder. A pre-existing balance would be returned to the operator. A frozen wSOL ATA would cause the SyncNative or swap to fail, which is caught.

**(h) Failure and retry.** Orca is tried first; Meteora only if Orca's outcome is `refused`. An `unknown` outcome throws, keeping the cycle open. A `landed` outcome records the signature. `classifySendFailure` correctly distinguishes preflight refusals, on-chain failures, expired blockhashes, and unknown outcomes. A confirmation timeout on a swap that later lands is handled by the `landed` outcome. The ledger is not marked closed until the split is confirmed.

**(i) Extraction bounds.** With a 100 bps deviation gate and 150 bps floor, a sandwich attack can extract at most the deviation between the oracle price and the pool's execution price, bounded by the 150 bps floor. At the ruled 10 SOL per 6-hour cooldown, the maximum extractable value per cycle is approximately 10 SOL × 1.5% ≈ 0.15 SOL. Per month (≈ 34 SOL swept), the maximum is ≈ 0.51 SOL. This is within the accepted limit 10's stated bounds.

**No defect found.**

## R6. The Gates

**`bank/selftest.mjs`.** I checked the assertion floors: DET_FLOOR = 1004, ALLOC_FLOOR = 39, POSTER_FLOOR = 24, LAUNCH_FLOOR = 68, MAINNET_FLOOR = 35, WEB_FLOOR = 695, SWAP_FLOOR = 16, EXPIRY_FLOOR = 4, POB_FLOOR = 14, HOST_FLOOR = 6. All match the stated counts in SPEC and the runner.

**`scripts/run-tests.sh`.** The MIN_ASSERTIONS = 912 matches the suite. The floor equality check (`[ "$TOTAL" -eq "$MIN_ASSERTIONS" ]`) prevents slack accumulation. The Core hash is hardcoded and not overridable. The `release_gate` correctly handles both the audited tree (direct comparison) and the rehearsal tree (recorded substitution proof).

**`scripts/build-mainnet.sh`.** The Core hash pin is hardcoded. The sweep helper byte-identity check (`cmp -s`) is correct. The INIT_AUTHORITY behavioral proof (deploy both builds, ask each for the test key) is sound.

**`scripts/cron-install.sh`.** All 6 cron jobs use `flock -n`. The `--live` flag preservation is correct. The rehearsal tree refusal (`[ ! -e "$R/REHEARSAL-RECORD.txt" ]`) is present.

**`scripts/audit-coverage.sh`.** The quorum check (`first_line_quorate`) correctly matches LAUNCH-CLEAN and NOT LAUNCH-CLEAN verdicts. The blob-hash comparison ensures current content was bundled. The `--prepared` mode correctly credits the next round's bundle.

**No vacuous assertions found.** Every detector arm has both a fire and a quiet case. Every repair arm is shown red when reverted.

## Accepted Limits — Four Questions

**1. Is any limit WORSE than stated?**

I re-derived the bounds for each accepted limit:

- **Limit 10 (swap operator):** The on-chain cap and cooldown are enforced in `sweep_sol_for_swap`. The reserve check prevents sweeping below `sol_reserve_lamports`. The guardian's stop is instant. The stated bound (cap × windows until guardian stops) is correct. **Not worse.**

- **Limit 28 (Coinbase freeze):** The pool freeze check in `retire_redeemed` correctly forfeits the undelivered share. The `claim` function does not check the pool for a freeze, so a paying claim reverts whole. The in-line monthly run does not credit from a frozen pool. **Not worse.**

- **Limit 40 (Core upgradeable):** The three consequences (tombstone change, UpdatePluginV1 change, Execute authority change) are correctly identified. The alarm watches `prog.core.upgrade_authority` and `prog.core.hash`. **Not worse.**

- **Limit 59 (pre-funded address grief):** The `checkNewAddress` function in the pages correctly handles funded addresses. The cost to the griefer (rent floor per attempt) exceeds the cost to the victim (transaction fee). **Not worse.**

- **Limit 25 (re-roll):** The reschedule mechanism correctly moves to a future slot. The `CBOB_REVEAL_RESCHEDULED` log line is emitted. The alarm pages on reschedules. **Not worse.**

- **Limit 26 (last-slot grinding):** The three-group entropy correctly removes other leaders' influence. The C-leader residual is correctly stated (best-of-4 from skipping, plus block content variation). **Not worse.**

**2. Is anything listed as a limit not actually a limit?**

- **Limit 19 (unlevelled-vault halt):** Correctly discharged by construction. `activate` refuses `NotRevealed`, so no activated vault can be unlevelled. **Correctly discharged.**

- **Limit 30 (85/15 vote):** Correctly discharged by stage 3b. `split_bps` is written once at `initialize`. **Correctly discharged.**

- **Limit 31 (31-day branch):** Correctly superseded by stage 3b. The cadence is deleted. **Correctly superseded.**

**3. Is any DISCHARGED item not actually discharged?**

I checked all discharged items:
- Item 51 (CBOB boost): Built, tested (suite section BO), mirrored off-chain, alarm watches bounds. **Discharged.**
- Item 54 (compute): Measured (10.1-10.4, 10.5, 10.6, 10.6a). **Discharged.**
- Items 12/17 (compute units): Measured. **Discharged.**
- Item 14 (duplicate attributes): `DuplicateAttribute` refused. **Discharged.**
- Item 33 (swap operator notice): Exercised in suite (3c.K5, 6.20g, 3c.G1). **Discharged.**

**All discharged items are correctly discharged.**

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

- **Item 22 (live chain distribution):** Still open. The dress rehearsal has not happened. The rehearsal value set (`launch/rehearsal-init.json`) is built but not executed. **Not quietly accepted.**

- **Item 38 (initialize values):** Still open. `charter_opens_at`, `lock_deadline`, and `vault_collection` are OPEN. The checker refuses until complete. **Not quietly accepted.**

- **Item 50 (holder surfaces):** Still open. Pages are built but not published. The holder guide is marked DRAFT. **Not quietly accepted.**

- **Item 52 (pool and Squads accounts):** Still open. Road step 10 creates them. **Not quietly accepted.**

- **Item 53 (dress rehearsal):** Still open. The rehearsal tree script is built but not executed. **Not quietly accepted.**

**No OPEN AND BLOCKING item is being quietly treated as accepted.**

## Findings

**No CRITICAL findings.**

**No HIGH findings.**

**No MEDIUM findings.**

**No new LOW findings.** All LOW-severity observations I identified during the review are either already stated in the accepted limits, already fixed by round 44 repairs, or are noise-level issues (e.g., the `detectCrankHealth` covered-freeze string matching could produce redundant reports if the crank's message format changes, but this is a noise issue, not a correctness issue).

**INFO observations (not findings):**

1. The `detectCrankHealth` covered-freeze filter uses exact string matching. If the crank's problem messages change format, the filter would not match and problems would be reported redundantly alongside the freeze findings. This is noise, not a correctness issue, and the selftest pins the current strings.

2. The `judgeSwapInstructions` does not verify tick array or bin array existence. This is a known limitation (round 44 C01) and is mitigated by the on-chain swap failing if arrays are missing, caught by `classifySendFailure`.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

**1. Execute the dress rehearsal before anything else.** Item 22 is the single largest remaining risk. The rehearsal must include all five named items: crank live passes, alarm in rehearsal mode, one full revenue cycle through each pool (Orca forced to refuse once), one forced post-sweep failure walked through hand recovery, and one DAS read of a burned Core asset. The rehearsal driver (`scripts/rehearsal-run.mjs`) is built but has never been executed. Until this runs, the off-chain pipeline's behavior under real network conditions (latency, RPC errors, confirmation timeouts) is untested.

**2. Verify alert delivery end-to-end with a real test.** The alarm's entire value depends on alerts reaching Gary. Run a deliberate test: trigger a known finding (e.g., pull the guardian stop on a rehearsal deployment), confirm the alert arrives via the actual notification path (email/SMS), and confirm Gary can act on it. AI cannot verify that the notification script, the email/SMS provider, and Gary's phone all work together.

**3. Establish a key compromise response drill.** The swap operator key, guardian key, and $CBOB release wallet key are all on one server. Run a timed drill: simulate a key compromise, measure how long it takes to (a) detect it via the alarm, (b) pull the emergency stop, (c) move the $CBOB release wallet. If any step takes more than a few minutes, the exposure exceeds the stated bounds.

**4. Verify the RPC endpoint's reliability independently.** The alarm, crank, and revenue job all depend on one RPC endpoint. If it goes down or returns stale data, all three fail simultaneously. Establish a secondary RPC endpoint and verify that the system can switch to it. AI cannot verify that the RPC provider will remain reliable.

**5. Confirm the CBOBTC Squads return process with a real test.** The rescue mechanism depends on the Squads returning rescued vaults to their senders. This is a human process. Execute a test rescue on the rehearsal deployment and verify that the Squads can and will return the vault. AI cannot verify human reliability.

**6. After the upgrade authority is removed, dump and hash all five programs one final time.** Compare the hashes against `dist/SHA256SUMS`. This is the last opportunity to verify that the deployed bytes match the audited bytes. After the authority is removed, no correction is possible.

**7. Accept that the AI audit process has structural limits it cannot overcome.** AI cannot execute code against a live chain, verify human processes, verify physical key security, verify RPC trust, verify alert delivery, or prevent third-party program upgrades. The dress rehearsal, alert delivery test, key compromise drill, and Squads return test are the minimum human actions needed to close the gaps that AI structurally cannot.