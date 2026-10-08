# Round 37, OFF-CHAIN pass — Independent Audit

**Audited tree:** commit `0ae07d2` (the current HEAD). Every file in the off-chain bundle was read whole. No file was skipped.

---

## R0. ROUND 36'S VERDICT AND REPAIRS

I independently verified each of round 36's five confirmed LOW findings against the code in this tree.

### L1 (SPEC C5 text): REPAIRED

The SPEC's C5 entry now reads: "The sweep helper cannot handle it at all, because it always closes what it sweeps and the close reverts the whole call (round 36 L1)." I verified this against `programs/cbob-vault-sweep/src/lib.rs` lines 62–70: the helper unconditionally invokes `CloseAccount` after every transfer, with the vault PDA as authority. SPL Token's close requires the close authority when one is set, so a stranger-held close authority reverts the close, which reverts the transfer, which reverts the whole `ExecuteV1`. The helper cannot be used for such an account. The repair text is accurate.

### L2 (SPEC rescue text): REPAIRED

The round-29 D2 passage now reads: "✅ Round 35 (item 58): `rescue_nested` now extracts it, always to the CBOBTC Squads (whether the host lives, is burned, or is the vault itself; review 35 M1)." I verified against MINT's `rescue_nested`: `let dest = a.config.bank_treasury; require_keys_eq!(a.new_owner.key(), dest, MintError::WrongRescueDestination);`. Every rescue goes to `bank_treasury`. The old "to the host's owner while the host lives" text is gone. Limit 44's heading now reads "Undeclared airdrops are DESTROYED on redemption; a nested vault is not (round 36 L2: it is rescued, item 58)." Both repairs are accurate.

### L3 (`unredeemable_owner` text): REPAIRED

The `detectNestedVaults` off-curve branch in `bank/detectors.mjs` now reads: "or it sits in a foreign Core asset's wallet (that asset's owner can move it out by executing through it; if that asset is burned, anyone can rescue_nested it to the CBOBTC Squads), or it is held by another program, which alone decides whether it can come back." The phrase "sealed for good" does not appear. The selftest arm at the R36 L3 block verifies `f[0]?.detail.includes('rescue_nested')` is true, `f[0]?.detail.includes('executing through it')` is true, and `f[0]?.detail.includes('sealed for good')` is false. Repair landed.

### L4 (`ACKABLE_KINDS`): REPAIRED

`bank/detectors.mjs` now has `export const ACKABLE_KINDS = new Set(['unredeemable_owner'])` with the comment "ROUND 36 (L4): nested_vault and vault_owns_itself are no longer ackable." The selftest arms verify both directions: `nested_vault` and `vault_owns_itself` acks are refused (severity stays CRITICAL), and `unredeemable_owner` acks still downgrade to INFO. The old arm that tested `nested_vault` acking has been replaced. Repair landed.

### L5 (index lag text): REPAIRED

The SPEC's index lag entry now reads: "The kind is level-triggered, but the alarm runs every 30 minutes and only its NEXT pass can report the recovery, which is after the alert router's 25-minute grace (round 36 L5). So any lag seen by a pass pages once, however short, and is followed by an ALL CLEAR when the next pass reads a complete index." I verified the cron runs at `23,53` (30-minute interval) in `scripts/cron-install.sh`, and `index_disagrees_with_chain` is classified as `level` in `ALARM_KINDS`. The repair text accurately describes the behavior.

### Round 36 rejected claims

I re-checked the claims round 36 disproved:
- **C06** (sweep `isSigner: false`): The selftest's R36 C06 arm compiles `revenue.mjs`'s own sweep transaction and asserts the operator is fee payer AND signer. The arm exists and tests the actual builder. The claim remains disproved.
- **C07** (HOST_FLOOR=6 vs 5 tests): The `HOST_FLOOR=6` comment now reads "Round 36 (C07): the 6 includes Anchor's generated `test_id`." The claim remains disproved.

### Gate 5 arms

The VALIDATION records R36.C5 and R36.G2a/b as on-chain gate arms. The suite floor moved from 889 to 895 (6 new arms). `MIN_ASSERTIONS=895` matches. The detector floor is 920, matching `DET_FLOOR=920` and the selftest's `FLOOR = 920`. All floors are equality-checked, not lower-bounded.

---

## R1. THE CRANK (`bank/crank.mjs`)

I examined the planner, the budget, the fee floor, the reveal ordering, the attribute hash check, the race handling, and the distribute refusal judge.

**No new defect found.** Specific checks:

- `planCostLamports` correctly counts batches (not individual vaults) for claims, pre-joins, and expires. Each batch is one transaction, one signature fee.
- `budgetPlan` correctly keeps the floor in reserve and budgets reveals after the base plan. The round-30 L2 repair (base plan runs whenever covered, reveals never spend below floor) is present and correct.
- `judgeDistributeRefusal` correctly re-reads the config and treats `NothingToDistribute`, `BoostsExpireFirst`, `JoinWaitingFirst` as benign only when `dist_epoch` or `last_distribute_at` moved. `PoolShort` is never benign. Correct.
- `mintFailureCode` correctly tracks the invoke stack and only accepts error codes from MINT. Foreign programs printing the same error name are rejected. Correct.
- The reveal loop correctly stops at the first not-ready record, maintaining FIFO order. A capture planned this pass counts as ready. Correct.
- `judgeRevealAttrs` correctly distinguishes `send`, `revealed` (level key appended by another lane), and `mismatch`. Correct.
- The `BENIGN` regex includes all race codes and excludes `BoostsExpireFirst`, `JoinWaitingFirst`, and `PoolShort`. Correct.
- The crank sends only permissionless MINT instructions. No transfer, no system move of value, no program other than MINT. Verified by the selftest arm that greps for `d('...')` calls and checks the set.

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

I examined every detector, the drift watch, the standing risks, the sweep state check, the log gap handling, the crank health tracking, and the notification planning.

**No new defect found.** Specific checks:

- `detectSweepState` uses `|t - st| <= cooldownSecs/2` as the explanation window, capped at 21600/2 = 10800 seconds by the alarm's `cooldownSeen` cap. The window is symmetric and bounded. Correct.
- `detectLogGaps` never drops unreviewed gaps. The reviewed prefix is trimmed but keeps the watermark. More than 2000 unreviewed escalates to CRITICAL. Correct.
- `detectCrankHealth` prunes freeze-covered problems even on duplicate heartbeats, preventing stale heartbeats from resurrecting old streaks. Correct.
- `detectDistributionOverdue` correctly handles the launch case (no active weight, vaults waiting), the joins-stalled case, and the boosts-stalled case. The `launch_tick_overdue` check requires `nowSec > last + period + graceSecs`, which is correct for the first tick after charter close. Correct.
- `redemptionCapacity` correctly computes `ceil(live * 210 / 10000)` with floor 1 and ceiling 64. The formula `(live * 210n + 9_999n) / 10_000n` is standard ceiling division. Correct.
- `detectRevenueAccount` keeps the previous `since` on unreadable accounts (clock doesn't reset) and resets to null on empty accounts. Correct.
- `planAlarmNotices` sends one notice per kind, with full detail list, URGENT for one-shot kinds, and RECOVERY for level kinds that cleared. Correct.
- The `ALARM_KINDS` table classifies every kind. The selftest arm verifies every `kind:` literal in the alarm's sources is listed. Correct.

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

I examined the struct definitions, the offset computation, the encode/decode round-trip, and the cross-program offset assertions.

**No new defect found.** Specific checks:

- The D6 seed gate asserts every seed in `L.SEEDS` against the Rust. The arm tests both directions (mistyped seed caught, unmapped seed caught). The gate is one-directional (does not check Rust seeds against `L.SEEDS`), so `RESCUE_SEED` being absent from `L.SEEDS` is not caught. This was already noted in round 36 (C15) as "Optional reverse arm" and dismissed because no off-chain code derives the rescue PDA. I confirm no `bank/` code derives the rescue PDA. The gap is real but has no current consequence.
- The struct field lists are asserted against the Rust by the selftest's layout arms, which parse `pub struct` from the source and compare field-for-field. Both directions are tested (added field caught, changed type caught). Correct.
- The cross-program offset assertions scrape every `OFF_` constant from the four programs and compare against `L.offsets()`. The selftest arm verifies none are undefined and all match. Correct.
- The `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` assertions scrape the Rust, evaluate the expressions, and compare against `L.fixedLength()`. Correct.

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

I compared every function against the MINT program's Rust.

**No divergence found.** Specific checks:

- `pendingScaled`: `(weight + boost) * acc + carry - debt`. Matches MINT's `owed_of`. The carry is added before the debt is subtracted, matching the Rust. Correct.
- `credit`: `delta = avail * ACC_SCALE / w; acc += delta; owed += delta * w`. Matches MINT's `credit`. Correct.
- `ceilSats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE`. Matches MINT's `ceil_sats`. Correct.
- `available`: `poolBalance - ceilSats(owedScaled)`, floored at 0. Matches MINT's distribute logic (which errors on shortfall instead of returning 0). Correct for planning purposes.
- `reweigh`: moves owed to carry, restarts debt at new weight. Matches MINT's `reweigh`. Correct.
- `debtAtActivation`: `weight * acc`. Matches MINT's join logic. Correct.
- The selftest asserts Level V is exactly 3x Level I, dust carries, a vault activated after a distribution gets nothing, a deferred payout stays owed, and a retired vault's share returns to the pool. All properties hold.

The crank's `planCrank` correctly uses these functions for claim planning, including the pre-joined vault case (debt at old accumulator) and the pre-expired boost case (owed at old accumulator plus level-weight earnings at new accumulator). Correct.

---

## R5. THE SWAP (`bank/swap.mjs`, `bank/revenue.mjs`)

I examined the oracle floor, the Pyth reader, the deviation filter, the minimum out, the judge, the account derivations, the wSOL handling, and the failure/retry logic.

### (a) Oracle math

`oracleFloor` computes `sats = lamports * sol.price * 10^e / (btc.price * 10)` where `e = sol.expo - btc.expo`. For both exponents at -8, `e = 0`, and the formula reduces to `lamports * sol.price / (btc.price * 10)`. Integer division rounds down (conservative). The `satsPerLamport` uses floating point for the deviation check only. The exponent handling is correct for all sign combinations. No overflow risk: `BigInt(lamportsIn) * sol.price` is at most ~10^19 * 10^10 = 10^29, well within BigInt range.

### (b) Pyth account verification

`readPyth` checks: account present, owned by `PYTH.receiver`, verification level is Full (1), feed_id matches. The offsets are correct for the PriceUpdateV2 layout (8 disc + 32 write_authority + 1 level + 32 feed_id + 8 price + 8 conf + 4 expo + 8 publish_time = 101 bytes minimum). The account is a PDA of the push oracle program, so only the push oracle can write to it. The receiver program verifies updates against push oracle signatures. An attacker cannot write arbitrary data without compromising the push oracle's upgrade key (stated in limit 10(d)). Staleness (180s) and future-dating (30s) are checked against the chain's Clock sysvar. Correct.

### (c) Deviation filter

`orcaSpot` computes `(sqrt_price / 2^64)^2`, which is sats per lamport for the wSOL/cbBTC pool. `meteoraSpot` computes `1 / (1 + bin_step/10000)^active_id`, which is sats per lamport for the cbBTC/wSOL pool (inverse of lamports per sat). Both are the correct quantities in the correct direction. `deviationBps` computes `|pool - oracle| / oracle * 10000`. The filter uses `<=` (100 bps inclusive). Floating point precision is adequate for a 100 bps threshold. Correct.

### (d) Minimum out

The minimum out is `expectedSats * (10000 - 150) / 10000`, which is the oracle's expected output less 150 bps, rounded down. This is the same floor the deviation filter assumed (both derive from `oracleFloor`). For Orca, it rides in `other_amount_threshold` (data offset 16). For Meteora, it rides in `min_amount_out` (data offset 16). Both are u64 little-endian. Correct.

### (e) The judge

`judgeSwapInstructions` requires the exact seven-instruction sequence. It checks:
- Instruction 0: SetComputeUnitLimit(400,000), no keys, no priority fee.
- Instruction 1: ATA CreateIdempotent for wSOL, correct payer/account/owner/mint.
- Instruction 2: System transfer of exactly `lamportsIn` to the operator's own wSOL ATA.
- Instruction 3: SyncNative of the wSOL ATA.
- Instruction 4: ATA CreateIdempotent for cbBTC, correct payer/account/owner/mint.
- Instruction 5: The venue's swap with correct amount, floor, direction (Orca: exact-input, a_to_b, min sqrt price), input account (key 3 for Orca, key 4 for Meteora), output account (key 5 for both), and signer.
- Instruction 6: CloseAccount of wSOL back to the operator.
- No foreign programs, no second signers, no Token instructions other than SyncNative and CloseAccount.

The judge checks the swap's output account is the operator's own cbBTC account. It checks the minimum-out bytes. It checks the direction byte for Orca. It checks the amount. It refuses a priority fee. It checks the ATA creations create the accounts they claim. Correct.

What a tampered builder could still route past it: nothing within the same file tree, because the judge and builder share the same code. A tampered module (limit 10(c)) can edit both. This is stated and accepted.

### (f) Account derivation

Orca tick arrays: `orcaTickArrayStarts` computes the current array and the two below (a_to_b pushes price down). The seed is `["tick_array", pool, start]`. Correct.

Meteora bin arrays: `meteoraBinArrayIndexes` computes the current array and the two above (Y→X pushes active bin up). The seed is `["bin_array", pool, index_le64]`. The bitmap extension is passed as the program id when absent (Anchor's "None"). `host_fee_in` is passed as the program id (None). The event authority is `["__event_authority"]`. Two token programs are passed. Correct.

### (g) wSOL handling

The swap wraps exactly `lamportsIn` via System transfer + SyncNative, swaps, and closes the wSOL ATA back to the operator. If the wSOL ATA already exists with a balance, the System transfer adds to it, SyncNative syncs the total, and the swap consumes `lamportsIn`. The close returns the remainder (if any) to the operator. If the ATA is frozen or has a delegate, the close would fail, reverting the whole transaction. This is acceptable: the operator controls their own ATA.

### (h) Failure and retry

Orca is tried first. Meteora is tried only if Orca's program refused (preflight refusal or on-chain failure). An unconfirmed send is never retried: it's classified as `unknown` and the cycle stays open. `classifySendFailure` asks the chain for the signature's status. A confirmation timeout on a transaction that later lands is classified as `landed` (if the status lookup succeeds) or `unknown` (if it doesn't). The cycle stays open until a cbBTC return is proven on chain. Correct.

### (i) Adversary extraction bound

With a 100 bps deviation gate and a 150 bps floor, the maximum extraction per cycle is bounded by the floor: the swap cannot return less than 150 bps below the oracle's expected output. A sandwich attack could push the pool price to the edge of the 100 bps gate, but the on-chain floor still limits the output. A stale-but-accepted oracle (up to 180s old) could be off by the oracle's confidence (measured ~1.5 bps for SOL, ~1.0 bps for BTC). A manipulated Meteora pool (~$0.9M liquidity) could be pushed more easily than Orca (~$10M), but the deviation gate and the on-chain floor still bound the output. The cycle size (up to 10 SOL per sweep, 6-hour cooldown) limits the total extraction per day to about 40 SOL worth of slippage. This is stated in limit 10 and the holder guide.

---

## R6. THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

I examined every floor, every equality check, and every arm that could be vacuous.

**No new defect found.** Specific checks:

- The selftest's `FLOOR = 920` is equality-checked: `if (R.length !== FLOOR) { ... process.exit(1) }`. Not a lower bound. Correct.
- The `floor()` function in `run-tests.sh` checks both `>=` and `==`. Not a lower bound. Correct.
- `MIN_ASSERTIONS=895` is equality-checked: `[ "$TOTAL" -eq "$MIN_ASSERTIONS" ] || die`. Correct.
- `SWAP_FLOOR=16` is equality-checked in `sim/swap-fork.sh`. Correct.
- `EXPIRY_FLOOR=4` is equality-checked via the `floor()` function. Correct.
- The SPEC stated-count gate reads every occurrence of every floor listed in its check map, not just the first. The selftest arm verifies this by poisoning a later occurrence and checking the gate catches it. Correct.
- The D6 seed gate is one-directional (noted above under R3). The reverse arm is optional and was not added. No current consequence.
- The `HOST_FLOOR=6` includes Anchor's generated `test_id`. The comment documents this. Correct.
- The `audit-coverage.sh` gate checks every tracked file's current content against completed quorate rounds. The `--prepared` flag credits the next round's bundle. The gate refuses to report coverage if git fails. Correct.
- The `cron-install.sh` installer refuses a rehearsal tree, preserves tagged `--live` lines, and wraps every money job in `flock -n`. The selftest arms verify the preservation logic by running the actual shell. Correct.

---

## ACCEPTED LIMITS — THE FOUR QUESTIONS

### 1. Is any limit WORSE than stated?

I checked each accepted limit against the code. No limit is worse than stated. Specific checks:

- **Limit 10** (swap operator): The swap is now built by the code against pinned pools with a Pyth floor. The operator still signs, but the transaction is constrained by the judge. The trust is narrower than the limit states (the operator can't route to a different pool or change the floor), but the limit already documents this ("THE SWAP NO LONGER SIGNS WHAT A THIRD PARTY BUILT"). Not worse.
- **Limit 25** (re-roll): The reschedule mechanism is correctly implemented. The alarm pages on reschedules. The capture window is ~300 slots. Not worse.
- **Limit 26** (leader grinding): The three-group entropy is correctly implemented. The residual is accurately stated. Not worse.
- **Limit 28** (Coinbase freeze): The frozen-pool redemption forfeit is correctly implemented. The alarm pages on freezes. Not worse.
- **Limit 32** (rate limit): The rolling window is correctly implemented with a 64-slot ring. The cap is `ceil(live * 210 / 10000)` with floor 1. Not worse.
- **Limit 40** (Core upgradeable): The alarm watches Core's upgrade authority and bytes. The three concrete consequences are stated. Not worse.
- **Limit 46** (PoB hot wallet): The alarm watches the collection's plugins and update authority. The pass-through mitigation is implemented. The consequences are stated. Not worse.
- **Limit 58** (rescue): The rescue is correctly implemented. The destination is always `bank_treasury`. The alarm pages on rescues and awaiting-return. Not worse.

### 2. Is anything listed as a limit not actually a limit?

No. Every accepted limit describes a real constraint that exists in the code. I checked each one against the implementation.

### 3. Is any DISCHARGED item not actually discharged?

I checked every discharged item:

- **Item 51** ($CBOB boost): Built in MINT (`boost_vault`, `expire_boosts`, `set_boost_terms`), GOV (`SetBoostTerms`), the alarm (`boosts_stalled`), the crank (boost expiry), and the accrual (`reweigh`, `pendingScaled`). Discharged.
- **Item 54** (compute at widest shapes): Suite arms 10.5, 10.6, 10.6a exist. Discharged.
- **Item 12/17** (compute units): Measured on the v5 artifact. Discharged.
- **Item 14** (duplicate attributes): `DuplicateAttribute` refusal exists. Discharged.
- **Item 19** (unlevelled halt): `activate` refuses `NotRevealed`. Discharged.
- **Item 30** (85/15 vote): `split_bps` fixed at initialize. Discharged.
- **Item 31** (31-day branch): Cadence deleted. Discharged.
- **Item 33** (operator replacement): `notice_secs` is an initialize value, exercised in the suite. Discharged.
- **v5 items** (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24): All went with the Bank, the co-signer, the deck, or the distributor. The files are deleted. The selftest arm verifies the retired files are gone and no file imports them. Discharged.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

I checked every OPEN AND BLOCKING item:

- **Item 22** (live distribution): Still open. The dress rehearsal has not happened. The named pass/fail items are listed. Not quietly accepted.
- **Item 38** (initialize values): Still open. `charter_opens_at`, `lock_deadline`, and `vault_collection` are OPEN in `launch/mainnet-init.json`. The checker refuses while any is OPEN. Not quietly accepted.
- **Item 50** (holder surfaces): Still open. The pages are built in `web/` but not published. The holder guide is marked DRAFT. Not quietly accepted.
- **Item 52** (pool and Squads accounts): Still open. Road step 10 creates them. Not quietly accepted.
- **Item 53** (dress rehearsal): Still open. The rehearsal script exists but hasn't been run at the release commit. The stale proof is noted. Not quietly accepted.

---

## NEW FINDINGS

### LOW-1: The D6 seed gate remains one-directional; `RESCUE_SEED` is not in `L.SEEDS`

**File and function:** `bank/layout.mjs` `SEEDS`, `bank/selftest.mjs` D6 arm.

**What:** The D6 arm checks that every seed in `L.SEEDS` matches the Rust, but does not check the reverse. MINT declares `pub const RESCUE_SEED: &[u8] = b"rescue";` which is not in `L.SEEDS`. The gate does not catch this omission.

**What an attacker or accident gains:** Nothing today. No `bank/` code derives the rescue PDA. If someone later adds code that derives the rescue PDA using a hardcoded seed, the gate would not catch a mismatch. The risk is hypothetical.

**Evidence:** `grep -r 'rescue' bank/` finds no PDA derivation using the rescue seed. The D6 arm's `SEED_SRC` map has no entry for `rescue`. The selftest passes at 920/920.

**Fix:** Add `rescue: 'rescue'` to `L.SEEDS` and add `[MINT_RS, 'RESCUE_SEED']` to the D6 arm's `SEED_SRC` map. Alternatively, add a reverse arm that checks every `pub const *_SEED` in the Rust is in `L.SEEDS` or is explicitly named as off-chain-irrelevant.

**Severity:** LOW. No current consequence. Documentation-only in the sense that it affects a gate's coverage, not holder money, rights, or program behavior.

### INFO-1: `planCostLamports` includes the split transaction cost even when the split might not be sent

**File and function:** `bank/crank.mjs` `planCostLamports`.

**What:** If `payDecimals` is null (the payment mint's decimals couldn't be read), the split is not sent, but its cost was already included in the plan's cost estimate. This means the budget is slightly over-estimated by one transaction fee (5,000 lamports).

**Consequence:** The crank might refuse a pass it could have done, or budget one fewer reveal than it could afford. This is conservative (the safe direction). No value is at risk.

**Evidence:** `planCostLamports` includes `(p.split ? 1 : 0)` in the transaction count. The main function checks `payDecimals === null` after budgeting and skips the split if null.

**Fix:** None needed. The over-estimate is conservative.

### INFO-2: The `readPyth` error message for an unknown verification level is misleading

**File and function:** `bank/swap.mjs` `readPyth`.

**What:** If the verification level byte is neither 0 nor 1, the code throws "the Pyth price is only PARTIALLY verified; refusing it." The message says "partially verified" but the actual issue is an unknown level. Since the account is owned by the receiver program and is a PDA of the push oracle, an unknown level would indicate corruption, not partial verification.

**Consequence:** None. The behavior is correct (refuse). The message is slightly misleading but the refusal is correct.

**Evidence:** `readPyth` checks `if (level !== 1) throw new Error('the Pyth price is only PARTIALLY verified; refusing it')`. Level 0 is Partial, level 1 is Full. Any other value hits the same error.

**Fix:** Change the message to "the Pyth price verification level is ${level}, not Full (1); refusing it." Optional.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, WHAT SHOULD THIS PROJECT DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT?

1. **Run the mainnet dress rehearsal (item 22) at the release commit, with a human at the terminal.** The rehearsal must include: the crank's live passes against the rehearsal deployment; the alarm's live passes in rehearsal mode; one full live revenue cycle through EACH pool (Orca forced to refuse once so Meteora runs); one forced post-sweep failure walked through the hand recovery; and one DAS read of a collection holding a burned Core asset. Each item must be recorded with its transaction signature. AI can verify the code is correct; it cannot verify that the RPC endpoint, the cron scheduler, the alert router, and the operator key all work together on a live cluster under real load.

2. **Have a human read the four `initialize` transactions byte-by-byte against `launch/mainnet-init.json` before signing.** The checker validates the JSON, not the signed transaction (round 24 A6). A human must confirm that the transaction builder reads from the checked file and that the bytes being signed match. AI can verify the checker is correct; it cannot verify that the person building the transaction is using the right file.

3. **Have a human verify the deployed bytes against `scripts/build-mainnet.sh`'s sha256 for all five programs, then remove the upgrade authority, then verify again.** The dump-and-check must happen three times: after deploy, before authority removal, and after authority removal. AI can verify the script is correct; it cannot verify that the person running `solana program set-upgrade-authority --final` is running it on the right program IDs.

4. **Have a human test the redeem page end-to-end on a testnet vault before publishing it.** The page is built but not published (item 50). A human must create a vault, fund it with all three reserve assets plus a stray token, and walk through the redeem page's flow: the prior transaction creating destination accounts, the coverage check naming the stray, the tick-box acknowledgement, the sweep through the helper, and the burn. AI can verify the page code is correct; it cannot verify that the page renders correctly in a browser, that the wallet extension signs the right transaction, and that the user experience matches the holder guide's promises.

5. **Have a human verify the alert router delivers every finding kind to a reachable endpoint.** The alarm sends notifications via `/opt/scripts/notify-gary-sms.sh`. A human must confirm that the router's state directory is writable, that the email/SMS endpoint is reachable, and that the URGENT flag breaks through an open stream. AI can verify the alarm code is correct; it cannot verify that the notification infrastructure works.

6. **Have a human hold the guardian key and the swap operator key in separate security contexts.** The guardian key is Gary's wallet. The swap operator key is on the box. The `$CBOB` release key is on the box. A human must ensure these keys are not all accessible from the same compromise. AI can verify the code checks key permissions (mode 600); it cannot verify the operational security of the key storage.

7. **Have a human review the `web/` pages for correctness against the holder guide.** The pages are built in `web/` but were not in this off-chain bundle. The programs pass bundled them, but a human should read the page code alongside the holder guide and confirm every promise is implemented. AI can verify the code is internally consistent; it cannot verify that the user-facing text matches the code's behavior in every edge case.

8. **Do not remove the upgrade authority until every item in OPEN AND BLOCKING is closed.** Items 22, 38, 50, 52, and 53 must all be complete. The authority removal is irreversible. AI can verify the code is correct; it cannot verify that the operational prerequisites are met.