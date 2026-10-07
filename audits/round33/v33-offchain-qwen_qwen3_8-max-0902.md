# Round 33 Independent Security Audit — Off-Chain Pipeline and Sweep Helper

## R0: Round 32 Verdict Verification

I independently verified round 32's four LOW repairs against the current tree:

**L1 (`detectSweepState`)**: Present and structurally sound. The one-sided matching window (`st - 120` to `st + min(3600, cooldown/2)`) correctly prevents a thief's next legal sweep from being explained by a prior honest cycle at the ruled 6-hour cooldown. The missing-baseline-is-zero behavior is correct. However, see Finding F1 below regarding clock domain mixing.

**L2 (`tx_unreadable`)**: Present. Per-transaction read errors and listing errors are caught, reported, and the cursor is held. The pass finishes and delivers pre-walk findings. See Finding F2 regarding the indefinite-retry scenario.

**L3 (`detectLogGaps` never-drop)**: Present. Unreviewed gaps are never evicted; only the reviewed prefix is trimmed. The Set-based dedup eliminates the O(n²) issue. Escalation to CRITICAL at >2000 unreviewed is present. See Finding F3 regarding unbounded growth.

**L4 (coverage gate focus-specific headlines)**: Present. `first_line_quorate` requires the label to match the credited focus. The `bundles` function fails closed on unrecognized FOCUS splits. Verified the 14 self-test cases exist.

Round 32's verdict of NOT CLEAN with 0 CRITICAL / 0 HIGH / 0 MEDIUM / 4 LOW / 2 INFO is consistent with my independent review. The repairs hold.

---

## R1: The Crank (`bank/crank.mjs`)

I verified all instruction constructions against the program's account structs: `reschedule_reveal`, `capture_entropy`, `reveal_level`, `retire_burned`, `activate`, `distribute`, `claim`, `split_revenue`, `expire_boosts`. Account orders match. The `BENIGN` and `DISTRIBUTE_RACE` error classification is correct. The `judgeDistributeRefusal` epoch-movement check is sound. The `budgetPlan` floor-preservation logic correctly prioritizes time-critical captures over reveals. The `judgeRevealAttrs` three-way classification (send/revealed/mismatch) handles the level-key addition correctly.

No new defects found in the crank.

---

## R2: The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I verified the detector suite: config drift, standing risks, brake transitions, upgrade authority, pool health, distribution overdue, redemption rate, nested vaults, undeclared tokens, unledgered sweeps, split claims, unreconciled revenue, crank health, revenue account, unswept royalties, log gaps, sweep state. The `WATCHED_KEYS` completeness check, the `COLLECTION_KEYS` shared array, the `missingWatchedKeys` exemption logic, and the `carryConfigBaseline` stale-read handling are all correct.

Findings F1–F3 below originate from this component.

---

## R3: The Layouts (`bank/layout.mjs`)

I verified the struct definitions against the Rust source (via the selftest's `parseRustStruct` assertions), the cross-program offset assertions (all 32+ `OFF_*` constants), the SEED assertions (11 seeds against program constants), the discriminator and version checks, the `u128` encode/decode round-trip, the `Vec<Pubkey>` credibility bound, and the `collectionPluginsHash` base-field skipping. The `fixedLength` and `offsets` functions correctly handle variable-length fields.

No defects found.

---

## R4: The Money Arithmetic (`bank/accrual.mjs`)

I compared each function against the program's Rust:

- `credit` matches MINT's `credit` (delta = avail × ACC_SCALE / w; owed += delta × w).
- `pendingScaled` matches `owed_of` (weight × acc + carry − debt).
- `ceilSats` matches `ceil_sats`.
- `reweigh` matches MINT's `reweigh` (carry = owed, debt = new_weight × acc).
- The crank's `joinedNow` debt computation (`weight × cfg.acc_scaled`) matches `join`'s `debt = w × acc`.
- The crank's `retiringOwed` computation matches `retire`'s `owed_scaled -= pending`.

No divergence found.

---

## R5: The Swap and Revenue Cycle

**(a) Oracle math**: The `oracleFloor` formula is correct: `sats = lamports × sol_price × 10^(sol_expo − btc_expo) / (btc_price × 10)`. The exponent handling for both signs is correct. Integer division floors both `expectedSats` and `minSats`, which is the conservative direction. The `satsPerLamport` float conversion is within Number's safe range for realistic Pyth prices; the resulting relative error (~10⁻¹⁶) is negligible against the 100 bps deviation gate.

**(b) Pyth verification**: `readPyth` correctly checks ownership by the receiver program, verification level == 1 (Full), feed ID match, and minimum account length. The offsets (discriminator 8, write_authority 32, level 1, feed_id 32, price i64, conf u64, expo i32, publish_time i64) are correct. Ownership by the receiver program is sufficient: only the receiver can write to the account, and the receiver only accepts authorized publisher updates. A stale or future `publish_time` is caught by the 180s/30s bounds. The receiver's upgradeability is disclosed in limit 10.

**(c) Deviation filter**: `orcaSpot` correctly computes `(sqrtPrice / 2⁶⁴)²`. The Q64.64-to-Number conversion loses precision for large sqrt prices, but the relative error (~10⁻¹⁶) is negligible against the 100 bps gate. `meteoraSpot` correctly computes `1 / (1 + binStep/10000)^activeId`. The deviation check is symmetric and correctly skips venues >100 bps from the oracle.

**(d) Minimum out**: The same `minSats` from `oracleFloor` is used as `other_amount_threshold` (Orca, offset 16 in swap data) and `min_amount_out` (Meteora, offset 16). Both are u64 little-endian. Correct.

**(e) The judge**: `judgeSwapInstructions` verifies all seven instructions in exact order: compute budget (400k, no priority fee), both ATA creations (owner's own accounts), System transfer (exact amount to own wSOL ATA), SyncNative, venue swap (correct amount, floor, direction, accounts at pinned indices, signer at correct slot), and CloseAccount (own wSOL back to owner). It rejects foreign programs, extra signers, non-SyncNative/CloseAccount Token instructions, and wrong instruction counts. The output account check (`keyAt(sw, 5)` for both venues) is correct. The judge is complete for the builder's output; the box-owner tamper residue is disclosed in limit 10.

**(f) Account derivation**: Orca tick arrays use `floor(tickCurrent / span) * span` with negative-tick floor semantics, then two arrays below (correct for a_to_b price-decreasing swaps). Meteora bin arrays use `floor(activeId / 70)` then two above (correct for Y→X price-increasing swaps). The bitmap extension uses Anchor's None convention (program ID as placeholder). `host_fee_in` is None. Event authority and two token programs are present.

**(g) wSOL handling**: Wrap exactly `lamportsIn`, SyncNative, swap, CloseAccount. An existing wSOL ATA balance is returned to the owner via the close. A frozen wSOL ATA causes the swap to fail (transaction reverts atomically). A delegate cannot prevent the close (requires owner signature). Correct.

**(h) Failure and retry**: `classifySendFailure` correctly distinguishes refused (preflight, on-chain failure, expired-unlanded), landed, and unknown. Meteora is only tried on refused. Unknown outcomes throw without trying the next venue. The open-cycle guard prevents double-sweeps. Correct.

**(i) Adversary extraction**: At the ruled 10 SOL cap and 150 bps floor, maximum extraction per cycle is ~0.15 SOL equivalent. At 4 cycles/day, ~0.6 SOL/day. The 100 bps deviation gate limits pool manipulation. The Meteora pool (~$0.9M) is thinner but subject to the same gate. These bounds are consistent with limit 10's disclosure.

---

## R6: The Gates

All assertion floors use equality checks (`-eq`), not lower bounds. The `floor()` function in `run-tests.sh` enforces both `>=` and `==`. The `MIN_ASSERTIONS`, `DET_FLOOR`, `ALLOC_FLOOR`, `POSTER_FLOOR`, `MAINNET_FLOOR`, `LAUNCH_FLOOR`, `POB_FLOOR`, `SWAP_FLOOR`, `EXPIRY_FLOOR`, and `selftest.mjs`'s `FLOOR` all require exact counts. Deleting assertions fails the build.

The `wiringGate` in `selftest.mjs` correctly detects deleted detector calls, comment-only calls, and discarded results. The `idGate` detects mutated program IDs across all 14 copies. The `audit-coverage.sh` gate requires current content to match a completed quorate round's bundle.

`build-mainnet.sh` builds all five programs, behaviorally verifies the four initializing programs against the test key, and byte-compares the sweep helper against both the localnet build and `target/deploy`. Correct.

`cron-install.sh` preserves `--live` only from tagged, uncommented lines. The `ours()` function anchors to the end of the tag. Commented-out lines, prose notes, and other projects' lines do not arm `--live`. Correct.

---

## Accepted Limits: Four Questions

### 1. Is any limit WORSE than stated?

**Limit 40 (Core upgrade)**: The limit lists three consequences (tombstone change, UpdatePluginV1 break, ExecuteV1 authority change). A fourth exists: a Core change to `CreateV2`'s account layout or behavior would halt all new mints (MINT's `create_vault` CPI would fail). This is a liveness issue for new vaults, not a funds issue for existing vaults, so the limit's focus on existing vaults is not contradicted, but the omission is worth noting. See Finding F4.

**Limit 32 (redemption rate limit)**: The ring holds 64 entries and the cap is bounded at 64. For live supply >3,047, the cap is 64, which is stricter than 2.1%. The limit correctly states "stricter, never looser." No issue.

**Limit 10 (swap operator)**: The stated bound (cap × cooldown windows) is correct. The `detectSweepState` repair adds a flood-immune backstop. No worsening found.

### 2. Is anything listed as a limit not actually a limit?

**Limit 19 (unlevelled-vault halt)**: Correctly marked CLOSED BY CONSTRUCTION. `activate` refuses `NotRevealed`, so no vault can be activated without a level. Verified in MINT source.

**Limit 30 (85/15 is a vote)**: Correctly marked DISCHARGED. `split_bps` is written once at `initialize`; no instruction modifies it. Verified.

**Limit 33 (swap operator replacement)**: Correctly marked DISCHARGED. `notice_secs` is an initialize value; the apply path is exercised in the suite. Verified.

No incorrectly discharged items found.

### 3. Is any DISCHARGED item not actually discharged?

All discharged items (51, 54, 12/17, 14, 19, 30, 31, 33, and the v5 Bank-related items) are correctly discharged. The v5 items (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24) are correctly removed with the Bank/co-signer/deck/distributor.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

Items 22, 38, 50, 52, 53 remain correctly in OPEN AND BLOCKING. None are treated as accepted. The charter opening date and lock deadline remain unset in `launch/mainnet-init.json`. The redeem page remains unbuilt. The dress rehearsal remains unexecuted.

---

## Findings

### F1 — LOW: `detectSweepState` mixes clock domains in its matching window

**File/function**: `bank/detectors.mjs`, `detectSweepState`

**Construct**: The matching window compares `t` (chain clock, from `last_sweep_at`) against `st` (box wall clock, from `Date.parse(c.startedAt) / 1000`). The `startedAt` field is written by `revenue.mjs` using `new Date().toISOString()`, which is the box's wall clock, not the chain's Clock sysvar.

**What an accident gains**: If the box clock drifts more than 120 seconds ahead of the chain clock, a legitimate sweep will fail the `t >= st - 120` check and page `sweep_unledgered_state` CRITICAL. If the box clock drifts more than `min(3600, cooldown/2)` seconds behind, the `t <= st + after` check fails, also producing a false CRITICAL. Both are loud (false positive), not silent. However, repeated false positives under clock skew could train the operator to ignore this CRITICAL, reducing its effectiveness when a real unauthorized sweep occurs.

**Evidence that would exist if true**: Run `detectSweepState` with a `startedAt` that is 200 seconds ahead of `last_sweepAt` (simulating a box clock 200s ahead). The function should return a CRITICAL finding despite the sweep being legitimate. The selftest arms at `bank/selftest.mjs` (R32 L1 block) test boundary conditions but use aligned clocks.

**Fix**: Record the chain clock alongside `startedAt` in the revenue ledger (e.g., `startedAtChain` from the Clock sysvar read that `revenue.mjs` already performs for the cooldown check). Use the chain timestamp in `detectSweepState`'s matching window. Alternatively, widen the 120-second pre-window tolerance and document the clock-skew sensitivity in the limit 10 runbook.

---

### F2 — LOW: Permanently unavailable transaction holds the alarm cursor indefinitely without a resolution runbook

**File/function**: `bank/alarm.mjs`, main transaction walk loop; `bank/txread.mjs`, `readParsedTransaction`

**Construct**: When `readParsedTransaction` throws or returns null for a signature, the alarm increments `unread`, reports `tx_unreadable` HIGH, and holds the cursor. The next pass re-reads the same signature window. If the transaction is permanently unavailable (e.g., pruned from RPC history, or a persistent RPC error for that specific signature), the cursor is held every pass indefinitely. Newer transactions are still processed (they're newer than the held cursor), but the alarm re-reads the same window and re-reports `tx_unreadable` every pass.

**What an accident gains**: No direct value loss. The operational cost is a permanent `tx_unreadable` HIGH finding every 30 minutes, and the cursor never advances past the unavailable transaction. If the unavailable transaction is old and the signature window grows large, the per-pass read cost increases. The `scan_backlog_unproven` CRITICAL does not apply here (that's for backlog drains), so there is no escalation path beyond the repeating HIGH.

**Evidence that would exist if true**: Deploy the alarm against a cluster where a specific historical transaction returns an RPC error (e.g., `-32015` or a timeout). Observe that `tx_unreadable` is reported every pass and the cursor for that program never advances. The SPEC's "Reader coverage boundary" states "the reader refuses it and scanners keep their cursors" but does not describe how to resolve a permanently unavailable transaction.

**Fix**: Add a runbook entry to the SPEC's "Reader coverage boundary" describing manual cursor advancement for permanently unavailable transactions (e.g., "if `tx_unreadable` persists for >24 hours for the same signature, verify the signature is permanently unavailable via `getSignatureStatuses` with `searchTransactionHistory: true`, then advance the cursor past it and record the gap"). Optionally, add a counter that escalates to CRITICAL after N consecutive passes with the same unreadable signature.

---

### F3 — LOW: `detectLogGaps` unreviewed gap list has no upper bound

**File/function**: `bank/detectors.mjs`, `detectLogGaps`

**Construct**: The `unreviewed` array (`all.slice(at + 1)` or `all`) is never trimmed. Only the `reviewed` prefix is capped. The SPEC discloses "the list therefore grows by at most 8,000 entries a pass" and the escalation to CRITICAL at >2,000 unreviewed. However, there is no upper bound on the total `keep` array size. A sustained attack creating padded transactions over many passes (at ~0.000005 SOL per gap) could grow the alarm's state file without bound.

**What an attacker gains**: At 8,000 entries per pass and ~90 bytes per signature, the state file grows by ~720 KB per pass. Over 1,000 passes (~21 days at 30-minute intervals), that's ~720 MB. This could cause memory pressure when the alarm loads and writes the state file, or disk exhaustion on a constrained host. The CRITICAL escalation at >2,000 unreviewed prompts human action, but if the human does not act, growth continues.

**Evidence that would exist if true**: Run `detectLogGaps` with 10,000 unreviewed gaps and observe that `keep.length` is 10,000. The selftest arm (R32 L3 block) tests 600 gaps and the 2,000 escalation but does not test an upper bound.

**Fix**: Add a hard upper bound on the `keep` array (e.g., 50,000 entries). When the bound is reached, drop the oldest reviewed entries first; if no reviewed entries remain, log a CRITICAL finding indicating that unreviewed gaps are being dropped due to capacity, and drop the oldest unreviewed entries. This preserves the never-drop-unreviewed property under normal operation while preventing unbounded growth under sustained attack.

---

### F4 — INFO: Limit 40 omits the CreateV2 consequence of a Core upgrade

**File/function**: SPEC.md, accepted limit 40

**Construct**: Limit 40 lists three concrete consequences of a Core upgrade: (1) tombstone change breaks redemptions, (2) UpdatePluginV1 break halts the level queue, (3) ExecuteV1 authority change widens vault access. A fourth consequence exists: MINT's `create_vault` calls Core's `CreateV2` via CPI. A Core change to `CreateV2`'s account layout, instruction discriminator, or plugin serialization would cause all new mints to fail. This is a liveness issue for new vaults (existing vaults are unaffected), so it does not contradict the limit's focus on existing vaults, but the omission means the limit understates the surface area of Core-upgrade risk.

**Evidence**: MINT `create_vault` function, lines constructing the `IX_CREATE_V2` instruction and invoking Core. The instruction index `IX_CREATE_V2 = 20` and the hardcoded plugin serialization are coupled to Core's current format.

**Fix**: Add a fourth bullet to limit 40: "a Core change to `CreateV2`'s instruction format or plugin serialization halts all new mints (MINT's `create_vault` CPI would fail); existing vaults are unaffected."

---

### F5 — INFO: Crank reveal transactions do not set a compute-unit limit; worst-case attribute-budget cost is not separately measured

**File/function**: `bank/crank.mjs`, reveal send loop; `tests/3prog.test.ts`, arm 10.4

**Construct**: The crank sends each reveal as a standalone transaction without a `ComputeBudgetProgram.setComputeUnitLimit` instruction. The measured reveal cost is 150,344 CU (arm 10.4), under the default 200,000 CU budget. The attribute budget is 640 Borsh bytes (enforced at mint by `AttributesTooLarge`). Arm L.12 proves a full-budget vault can be revealed in a legacy transaction (packet size), but the compute cost at the full 640-byte attribute budget is not separately measured. The attribute hashing cost scales linearly with attribute size; at 640 bytes the additional cost over a typical list is small (likely <1,000 CU), so the 150,344 measurement is likely representative. However, the absence of an explicit worst-case compute measurement means a regression in Core's attribute handling could push the reveal over 200,000 CU without detection until the reveal lane fails.

**Evidence**: Arm 10.4 measures a reveal with inline capture at 150,344 CU. The attribute list size for that measurement is not stated. Arm L.12 measures packet size at the full 640-byte budget but not compute.

**Fix**: Add a suite arm that measures the reveal compute cost at the full 640-byte attribute budget, and assert it is under 200,000 CU. Alternatively, have the crank set a compute-unit limit on reveal transactions (e.g., 250,000 CU) as a defensive measure, consistent with item 54's guidance for holder pages.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, WHAT SHOULD THIS PROJECT DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT?

1. **Execute the full dress rehearsal on a live cluster with real (small) amounts.** The AI audit can verify code logic, but it cannot exercise the crank against 2,100 live vaults, observe RPC rate limiting under load, confirm the reveal lane keeps up under burst minting, or validate that the alarm's DAS reads work against the live Helius endpoint. Item 22's five named pass/fail items (crank passes, alarm passes, one full revenue cycle through each pool, one forced post-sweep failure with hand recovery, one DAS read of a burned Core asset) must be executed by a human at a terminal. No AI output substitutes for this.

2. **Perform the `initialize` ceremony with human verification of the signed transaction bytes.** The `check-launch-params.mjs` gate validates the JSON, but the four `initialize` transactions must be built from that JSON and their signed bytes verified by a human before broadcast. A human must confirm that the transaction they are signing matches the output of the checker. The AI can verify the checker's logic but cannot witness the signing ceremony.

3. **Remove the upgrade authority in a witnessed, irreversible step.** The `solana program set-upgrade-authority --final` command for all five programs must be executed by a human who has verified the deployed bytes match `build-mainnet.sh`'s sha256 output. This step is irreversible. A human must confirm the hash comparison before executing. The AI can verify the build script's logic but cannot perform the irreversible key ceremony.

4. **Build and deploy the redeem page (item 50) before any holder can redeem.** The AI can verify `judgeRedemptionCoverage`'s logic, but the page itself (deposit address display, pre-signature coverage check, trigger/join offer, sweep-at-execution integration) must be built, tested with real wallets, and deployed. Until it exists, items 9 and 44 have no preventive control. A human holder interacting with a wallet's native burn button will destroy undeclared holdings, and no AI audit can prevent that.

5. **Establish an out-of-band human response channel for alarm findings.** The alarm pages via `/opt/scripts/notify-gary-sms.sh`, but a human must be available to respond to CRITICAL findings within the relevant time windows (e.g., a frozen pool, an unauthorized sweep, a Core upgrade). The AI can verify the alarm's detection logic, but it cannot respond to a 3 AM page. The guardian wallet (Gary's) must be accessible to pull `emergency_stop_sales` or `emergency_stop_sweep` within minutes of a CRITICAL. A documented response playbook with named individuals and escalation paths is needed.

6. **Conduct a timed recovery drill for the revenue cycle hand-recovery runbook.** Limit 10's hand-recovery procedure (look up candidate signatures, read operator balances, manually swap, record in ledger, re-run `--audit`) must be practiced under time pressure by the person who would perform it during an actual incident. The AI can verify the runbook's logical consistency, but it cannot simulate the stress and time pressure of a real incident where SOL is sitting on a compromised key.

7. **Obtain a human legal/compliance review of the holder guide's promises.** The HOLDER-GUIDE.md makes specific claims ("Only you can open it," "Nothing can leave it while it is closed," "The rules cannot change"). A human lawyer should verify these claims against the actual program behavior and the accepted limits, particularly the custodial wallet exception (Gary Club holds the key for custodial vaults), the Coinbase freeze risk, and the Metaplex Core upgrade risk. The AI can check internal consistency but cannot provide legal assurance.

8. **Establish a dependency monitoring process for `@solana/web3.js`, `@metaplex-foundation/mpl-core`, and the SPL token SDK.** These are pinned in `node_modules`, but a supply-chain attack on the npm registry or a compromised maintainer account could inject malicious code. The AI can verify the current dependency tree, but ongoing monitoring requires a human process (e.g., `npm audit`, Dependabot, or manual review of upstream changes before any update). Since the off-chain code holds the swap operator key and the crank key, a compromised dependency is a key-compromise vector.

9. **Physically secure the box hosting the swap operator key, the crank key, and the $CBOB release wallet.** The AI can verify file permissions (600) and the absence of retired key paths, but it cannot prevent physical access to the machine, a malicious insider with sudo, or a backup exfiltration. The $CBOB release wallet (limit 56) and the swap operator key (limit 10) are both on this box. A hardware security module or air-gapped signing process for the guardian wallet would reduce the blast radius of a box compromise.

10. **Decide and document the charter opening date and lock deadline.** These are the two remaining OPEN values in `launch/mainnet-init.json`. The charter date determines when the 7-day window opens; the lock deadline must be at least 24 hours before it (road step 6). This is a business decision that only Gary can make, and it gates the entire launch sequence. No AI can make this decision.