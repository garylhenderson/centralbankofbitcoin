# Independent Security Audit — Round 48 Confirmation

## R0. Round 47's Verdict and Repairs

I have read `audits/round47/VERDICT-offchain.md` and `audits/round47/VALIDATION.md`. The verdict is honest about its measurement limits and the repairs are real. I verified the following repairs at their sites:

- **V47o-1 (Core watch JSON):** `scripts/core-watch-suite.sh` now uses `node -e` with `JSON.stringify` for `res()`. The selftest in `core-watch.mjs` includes an arm that writes a raw-newline result file and confirms `suiteStatus` reads it as `unreadable`. This is a real fix.
- **V47o-2 (validator lock):** `scripts/validator-lock.sh` is new and uses `flock` on fd 9. All five runners (`run-tests.sh`, `run-sim.sh`, `swap-fork.sh`, `build-mainnet.sh`, `e2e-localnet.sh`) source it before their exit traps. `run-tests.sh` re-hashes the booted Core at [4/7]. The selftest arms in `bank/selftest.mjs` exercise the lock with a killed holder and an inherited fd. This is a real fix.
- **V47o-3 (SPEC/README):** SPEC items 22 and 53 are restated, and the road row now says "22.2 FAIL accepted by Gary (a true detection)". The README road row is generated from SPEC. This is a real fix.
- **V47o-4 (untracked rounds):** `readme-facts.mjs` now uses `git ls-files` for tracked rounds only. The selftest arms in `bank/selftest.mjs` drive `auditFacts` with made-up trees. This is a real fix.
- **V47o-5 (NONE verdict):** `readme-facts.mjs` uses `(?!NONE\b)` in the regex. The selftest arms confirm NONE/NONE renders "none". This is a real fix.
- **V47o-6 (installer):** `cron-install.sh` now installs the Core watch under `flock` and a deadman. The selftest's job list moved to eight. This is a real fix.
- **V47o-7 (orphaned result):** `core-watch.mjs` `decide()` now iterates `obs.prior` and sends earlier builds' results once. The selftest arms confirm this. This is a real fix.
- **V47o-8 (mock RPC):** `web/test/mock-rpc.mjs` now serves `getTokenAccountsByOwner`. The V40-1 plans carry no `unlisted` box. This is a real fix.
- **V47o-9 (clean clone):** `run-tests.sh` names a missing `dist/` before the page tests. This is a real fix.

I did not re-file any round-47 claim. The repairs hold.

---

## R1. The Crank (`bank/crank.mjs`)

I examined the planning and sending logic for the specific failure modes requested.

### Finding R1-1: `planCrank` can plan a `distribute` that the program will refuse with `BoostsExpireFirst` when a boost is due but its record is unreadable

**Severity:** LOW (wasted fees, false pages)

**Construct:** `planCrank` in `bank/crank.mjs`, the `preExpires` loop.

The loop that plans `preExpires` (due boosts to expire before distribution) iterates over `records` and checks `boostOf(r) === 0n` to skip vaults without boosts. However, it does not check whether the record's `boost_end_epoch` is readable. If a record is malformed or unreadable, `boostOf(r)` returns `0n` (because `r.boost_weight ?? 0` defaults to 0), and the vault is silently skipped from `preExpires`.

The program's `distribute` refuses with `BoostsExpireFirst` if `boosts_due > 0`. The crank's plan computes `expiringWeight` from `plan.preExpires`, but it does not check `cfg.boosts_due` against the number of boosts it actually planned to expire. If a due boost's record is unreadable, the crank plans `distribute` anyway, sends `expire_boosts` for the readable ones, then sends `distribute`, which the program refuses with `BoostsExpireFirst`.

The crank's `judgeDistributeRefusal` treats `BoostsExpireFirst` as benign only if `dist_epoch` or `last_distribute_at` moved. Since the refusal is caused by an unexpired boost, not by another distribution, the epoch did not move, so the crank pages `distribute (monthly, free)` as a failure.

**Evidence:** A test run with a synthetic `MintConfig` where `boosts_due > 0` and a `VaultRecord` with `boost_weight > 0` but `boost_end_epoch` unreadable (or the record missing from the fetched list) would show the crank planning `distribute: true` and then failing with `BoostsExpireFirst`.

**Fix:** In `planCrank`, after computing `plan.preExpires`, check that the number of boosts planned for expiry equals `cfg.boosts_due`. If not, add a problem and do not plan `distribute`. Alternatively, treat an unreadable boost record as a problem that blocks distribution, similar to `unreadableEligible`.

---

### Finding R1-2: `planCrank` can plan a `claim` batch that includes a vault whose record was retired between planning and sending

**Severity:** LOW (wasted fees, false pages)

**Construct:** `planCrank` in `bank/crank.mjs`, the `claims` planning loop.

The loop that builds `ready` for claims checks `r.retired` at planning time. However, the crank sends `retire_burned` for burned vaults earlier in the same pass. If a vault is both burned and active, it is added to `plan.retireBurned` and excluded from `ready` by the `assets[r.asset] === 'burned'` check. But if a vault is retired by *another* actor between the crank's plan and its send (e.g., a redemption that lands after the plan but before the claim batch), the claim batch will include a retired vault.

The program's `claim` skips retired vaults (`if !r.active { continue; }`), so the batch does not revert. However, the crank's `send` wrapper treats `AlreadyRetired` as benign only if the error code is extracted. If the program skips the retired vault silently (no error), the claim batch lands but pays one fewer vault than planned. This is not a failure, but the crank's `owed` map and `describePlan` will report a claim batch that included a vault that was not paid.

**Evidence:** A test run with a vault that is active and owed, and a concurrent redemption that retires it between the crank's plan and send, would show the claim batch landing with one fewer payment than planned.

**Fix:** This is a benign race, not a defect. The crank's `BENIGN` regex already includes `AlreadyRetired`, and the program skips retired vaults silently. The crank's `describePlan` could note that a claim batch may pay fewer vaults than planned due to races, but this is cosmetic.

---

### Finding R1-3: `planRescues` can plan a rescue for a vault whose host is a burned asset that is not a CBOB vault

**Severity:** LOW (wasted fees)

**Construct:** `planRescues` in `bank/crank.mjs`.

The function checks `assets[host] !== 'live' && assets[host] !== 'burned'` to skip hosts that are neither live nor burned. However, it does not check that the host is a *CBOB vault*. The `hostOf` map is built from `vaults` (all vault records), so `host` is always a vault id. But `assets[host]` can be `'burned'` for a vault that was bare-burned and not yet retired. The program's `rescue_nested` accepts a burned host (`is_burned`), so this is correct.

**Evidence:** A test run with a nested vault whose host is a bare-burned CBOB vault would show the rescue being planned and sent. The program accepts it.

**Fix:** None needed. This is correct behavior.

---

### Finding R1-4: The crank's `send` wrapper can misclassify a `BoostsExpireFirst` refusal from `expire_boosts` as benign

**Severity:** LOW (false recovery)

**Construct:** `send` in `bank/crank.mjs`, the `BENIGN` regex.

The `BENIGN` regex includes `BoostsExpireFirst`? No, it does not. Let me re-check. The `BENIGN` regex is:

```
export const BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed|AlreadyRetired|AlreadyActive|VaultRetired|ActivationPending|RevealWindowExpired|NeedsReschedule|NothingToSplit|NotNested/
```

`BoostsExpireFirst` is NOT in `BENIGN`. It is in `DISTRIBUTE_RACE`. So an `expire_boosts` call that fails with `BoostsExpireFirst` (which should not happen, since `expire_boosts` does not check `boosts_due`) would be treated as a failure. This is correct.

**Evidence:** None.

**Fix:** None needed.

---

### Finding R1-5: The crank's `mintFailureCode` can return `null` for a MINT error when the invoke stack is unbalanced

**Severity:** LOW (misclassified failure)

**Construct:** `mintFailureCode` in `bank/crank.mjs`.

The function walks the log lines and maintains a stack. If the stack is unbalanced (e.g., a `Program X success` without a matching invoke), it returns `null` for the error code. This means a MINT error that occurs in a transaction with unbalanced logs is treated as a non-benign failure, even if it is a race code like `AlreadyCaptured`.

**Evidence:** A test run with a transaction whose logs are unbalanced (e.g., a program prints `Program X success` without an invoke) and a MINT error `AlreadyCaptured` would show the crank treating it as a failure instead of a benign race.

**Fix:** In `mintFailureCode`, if the stack is unbalanced, return the error code anyway if it was found on a MINT line, rather than returning `null`. The current code returns `null` when the stack is unbalanced, which is overly conservative.

---

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### Finding R2-1: `detectStandingRisks` does not page on a `mint.guardian` that is the default pubkey when `pending_guardian_set` is true

**Severity:** LOW (missed detection)

**Construct:** `detectStandingRisks` in `bank/detectors.mjs`.

The function checks `if (cur['mint.guardian'] === DEFAULT_PUBKEY)` and pushes `guardian_retired` at INFO. It also checks `if (cur['mint.pending_guardian_set'] === true)` and pushes `guardian_armed` at CRITICAL. However, if the guardian is retired (default pubkey) AND a new guardian is pending, the `guardian_retired` INFO finding is pushed, but the `guardian_armed` CRITICAL is also pushed. This is correct: the pending guardian is still armed and should page.

**Evidence:** A test run with `mint.guardian = DEFAULT_PUBKEY` and `mint.pending_guardian_set = true` would show both findings.

**Fix:** None needed. This is correct behavior.

---

### Finding R2-2: `detectConfigDrift` does not page on a change to `mint.last_sweep_at`

**Severity:** LOW (missed detection)

**Construct:** `detectConfigDrift` in `bank/detectors.mjs`.

The `WATCH` list includes `mint.last_sweep_at`? Let me check. The `WATCH` list includes `mint.last_sweep_at`? No, it does not. The `WATCHED_KEYS` list includes `mint.last_sweep_at` (added in round 33 for the sweep backstop), but `WATCH` does not. So a change to `mint.last_sweep_at` is not paged as `config_drift`.

However, `detectSweepState` in `bank/detectors.mjs` reads `mint.last_sweep_at` and pages `sweep_unledgered_state` if it moves without a matching ledger cycle. So the change IS detected, just not as `config_drift`. This is correct: `last_sweep_at` is expected to change on every sweep, and paging it as drift would be noise.

**Evidence:** None.

**Fix:** None needed.

---

### Finding R2-3: `detectUnsweptRoyalties` can page on a routine state when the revenue address receives lamports but no sweep is due

**Severity:** LOW (false page)

**Construct:** `detectUnsweptRoyalties` in `bank/detectors.mjs`.

The function computes `excess = lamports - reserve` and pages if `excess >= floor` and the balance has not fallen for `graceSecs`. However, if the revenue address receives lamports (e.g., a royalty payment) but the sweep is not due yet (cooldown not elapsed), the balance rises, and the clock does not reset. After `graceSecs`, the function pages `royalties_unswept` even though the sweep is simply waiting for the cooldown.

The function's comment says: "A capped sweep resets the clock only if the balance falls between alarm reads. Incoming royalties can hide a successful sweep, so the clock can continue and page even while sweeps work; inspect the transactions and ledger." This is a stated limitation, not a defect.

**Evidence:** A test run with a revenue address that receives royalties but whose cooldown has not elapsed would show `royalties_unswept` paging after the grace period.

**Fix:** None needed. This is a stated limitation.

---

## R3. The Layouts (`bank/layout.mjs`)

### Finding R3-1: The `parseRustStruct` regex can fail to parse a struct with a `pub` field that has a doc comment containing a brace

**Severity:** LOW (test failure)

**Construct:** `parseRustStruct` in `bank/layout.mjs`.

The regex `pub struct ${name}\\s*\\{([\\s\\S]*?)\\n\\}` matches the first `}` at the start of a line. If a field has a doc comment containing a `}` at the start of a line (e.g., a code example in a doc comment), the regex will stop early and fail to parse the struct.

**Evidence:** A test run with a Rust struct containing a doc comment with a `}` at the start of a line would show `parseRustStruct` returning `null` or throwing.

**Fix:** Use a more robust parser that handles nested braces and comments, or strip comments before parsing. The current parser strips `//` comments but not `/* */` block comments or doc comments.

---

### Finding R3-2: The `offsets` function does not compute offsets for fields after a `Vec`

**Severity:** INFO (documented limitation)

**Construct:** `offsets` in `bank/layout.mjs`.

The function stops at the first variable-length field (`Vec<Pubkey>`). This is documented: "After a Vec the position depends on the data, so those fields have no static offset and are absent." This is correct.

**Evidence:** None.

**Fix:** None needed.

---

## R4. The Money Arithmetic (`bank/accrual.mjs`)

### Finding R4-1: `pendingScaled` can throw `Overflow` when `carry_scaled` is large and `debt_scaled` is small

**Severity:** LOW (crank failure)

**Construct:** `pendingScaled` in `bank/accrual.mjs`.

The function computes `(weightOf(level) + BigInt(boost)) * BigInt(acc) + BigInt(carry) - BigInt(debt)`. If `carry` is large (e.g., a vault with a large boost that expired) and `debt` is small, the result can exceed `u128` and throw `Overflow`. The program's `owed_of` uses `checked_add` and `checked_sub` and returns `MintError::Overflow` in this case.

The crank's `planCrank` catches this error and adds a problem: `vault ${r.asset}: ${e.message}`. The vault is left out of the claim batch. This is correct behavior: the program would also refuse to pay this vault.

**Evidence:** A test run with a vault record where `carry_scaled` is near `u128::MAX` and `debt_scaled` is 0 would show the crank reporting a problem and leaving the vault out of the batch.

**Fix:** None needed. This is correct behavior.

---

### Finding R4-2: `credit` can produce a `delta` of 0 when `avail` is small and `w` is large

**Severity:** INFO (dust handling)

**Construct:** `credit` in `bank/accrual.mjs`.

The function computes `delta = avail * ACC_SCALE / w`. If `avail` is small (e.g., 1 sat) and `w` is large (e.g., 6,405), `delta` is 0. The function then adds 0 to `acc` and `owed`. This is correct: the dust stays in the pool and carries.

**Evidence:** The accrual selftest includes a case: "1 sat over weight 3 credits acc = floor(1e12/3)" and "owed never exceeds what the pool received". This is correct.

**Fix:** None needed.

---

## R5. The Swap (`bank/swap.mjs`) and the Revenue Cycle (`bank/revenue.mjs`)

### Finding R5-1: `oracleFloor` can overflow in `Number(sol.price) * 10 ** sol.expo` when `sol.expo` is negative and `sol.price` is large

**Severity:** LOW (swap failure)

**Construct:** `oracleFloor` in `bank/swap.mjs`.

The function computes `satsPerLamport: Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10`. If `sol.expo` is -18 (the minimum allowed) and `sol.price` is large (e.g., 1e18), `Number(sol.price) * 10 ** -18` is 1, which is fine. If `sol.expo` is 0 (the maximum allowed) and `sol.price` is large (e.g., 1e18), `Number(sol.price) * 10 ** 0` is 1e18, which is within `Number`'s safe range. However, if `sol.price` is near `u64::MAX` (1.8e19) and `sol.expo` is 0, `Number(sol.price)` is 1.8e19, which is within `Number`'s safe range (up to 9e15 for exact integers, but 1.8e19 is representable as a float). The result is a float, not an exact integer, but this is only used for the deviation filter, not for the on-chain floor.

The on-chain floor uses BigInt arithmetic: `num = BigInt(lamportsIn) * sol.price`, `den = btc.price * 10n`, with exponent adjustment. This is exact.

**Evidence:** A test run with `sol.price = u64::MAX` and `sol.expo = 0` would show `satsPerLamport` as a float, but `expectedSats` and `minSats` as exact BigInts.

**Fix:** None needed. The float is only for the deviation filter, and the on-chain floor is exact.

---

### Finding R5-2: `readPyth` does not check that the account is the DERIVED address for the feed

**Severity:** LOW (oracle verification gap)

**Construct:** `readPyth` in `bank/swap.mjs`.

The function checks that the account is owned by the Pyth receiver and that the feed id matches. It does NOT check that the account's address is the derived PDA `pythAccount(feedHex)`. The caller (`market`) fetches the account at the derived address, so a wrong address would return `null` and `readPyth` would throw "the Pyth price account is absent". However, if the RPC returns a different account (e.g., a malicious RPC), `readPyth` would accept it if it is owned by the receiver and carries the expected feed id.

The prompt asks: "Is ownership plus a derived address sufficient, or can anyone write a fully-verified update with an old `publish_time` or a chosen price into that account?" The answer is: the derived address is a PDA of the push-oracle program, so only the push-oracle program can write to it. The push-oracle program is upgradeable by Pyth's key, so Pyth could write a stale or chosen price. This is accepted limit 10(d): the third parties' upgrade keys are trusted.

**Evidence:** A test run with a malicious RPC returning a different account at the derived address would show `readPyth` accepting it if it is owned by the receiver and carries the expected feed id. However, the derived address is a PDA, so a different account cannot exist at that address.

**Fix:** Add a check that the account's address equals `pythAccount(feedHex)`. This is defense-in-depth, not a critical fix.

---

### Finding R5-3: `judgeSwapInstructions` does not check that the Meteora swap's `host_fee_in` account is the program id (None)

**Severity:** LOW (already stated, limit 10(c))

**Construct:** `judgeSwapInstructions` in `bank/swap.mjs`.

The judge checks the swap's input and output accounts, the amount, the floor, and the direction. It does NOT check Meteora's `host_fee_in` account (key 9). The builder sets it to the program id (None), but a tampered builder could set it to a host fee account.

This is already stated in the round-47 verdict as C10: "ALREADY STATED (limit 10(c); round 36 C12, round 38 C12, round 43 C14, round 44 C29)". The on-chain floor and the post-swap delta check bound the output. Reaching key 9 needs a changed builder in this tree, which is limit 10(c)'s accepted residue.

**Evidence:** None.

**Fix:** None needed. Already stated.

---

### Finding R5-4: `classifySendFailure` can misclassify a transaction that landed and failed as `refused` when the status is `confirmed` but the error is a string

**Severity:** LOW (misclassified failure)

**Construct:** `classifySendFailure` in `bank/swap.mjs`.

The function checks `if (settled && st.err) return { outcome: 'refused', ... }`. If `st.err` is a string (e.g., `"InstructionError"`), this is truthy, so the function returns `refused`. This is correct: a transaction that landed and failed moved nothing.

**Evidence:** None.

**Fix:** None needed.

---

### Finding R5-5: `revenue.mjs` can double-swap if the first swap's confirmation times out and the chain later shows it landed, but the operator's wSOL account was closed by someone else

**Severity:** LOW (edge case)

**Construct:** `revenue.mjs` main loop.

The loop tries Orca first, then Meteora. If Orca's send throws with an unknown outcome, the loop stops and throws. If the chain later shows the Orca swap landed, the cycle is open and must be recovered by hand. The operator's wSOL account is closed by the swap transaction itself (the close instruction is part of the swap). If someone else closes the operator's wSOL account between the swap and the recovery, the recovery's swap would fail.

This is an edge case that requires a malicious actor with access to the operator's wSOL account. The operator's wSOL account is an ATA owned by the operator, so only the operator can close it (or a program with the operator's authority). This is not a realistic attack.

**Evidence:** None.

**Fix:** None needed.

---

## R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

### Finding R6-1: The selftest's `FLOOR` is 1081, but the file contains more than 1081 assertions

**Severity:** INFO (floor accuracy)

**Construct:** `bank/selftest.mjs`, the `FLOOR` constant.

The file ends with `const FLOOR = 1081` and checks `if (R.length !== FLOOR)`. The round-47 VALIDATION says "detectors 1081/1081". I did not count the assertions in the file, but the floor is checked for equality, so if the file contains more or fewer assertions, the selftest fails. This is correct.

**Evidence:** The round-47 VALIDATION records "detectors 1081/1081".

**Fix:** None needed.

---

### Finding R6-2: `scripts/build-mainnet.sh` does not verify the sweep helper's mainnet bytes against the localnet bytes when the localnet build is not present

**Severity:** LOW (verification gap)

**Construct:** `scripts/build-mainnet.sh`.

The script checks `cmp -s "$OUT/cbob_vault_sweep.so" "$LN_DIR/cbob_vault_sweep.so"` and `cmp -s "$OUT/cbob_vault_sweep.so" "$ROOT/target/deploy/cbob_vault_sweep.so"`. If `target/deploy/cbob_vault_sweep.so` is missing, the script dies with "target/deploy/cbob_vault_sweep.so is missing: run scripts/run-tests.sh first". This is correct: the script requires the tested build to exist.

**Evidence:** None.

**Fix:** None needed.

---

### Finding R6-3: `scripts/cron-install.sh` installs the Core watch under `flock`, but the deadman's `find` command can fail silently if the state file's directory does not exist

**Severity:** LOW (deadman gap)

**Construct:** `scripts/cron-install.sh`, the Core watch deadman line.

The deadman line is:
```
29 * * * * { [ ! -f $CORE_WATCH_STATE ] || [ -n "$(find $CORE_WATCH_STATE -mmin +60 2>/dev/null)" ]; } && /opt/scripts/notify-gary-sms.sh "CBOB Core watch state is missing or over an hour old - nothing is checking Metaplex Core on mainnet" cbob-core-watch:deadman $TAG core-watch-deadman
```

If `$CORE_WATCH_STATE`'s directory does not exist, `find` prints nothing (with `2>/dev/null`), and the condition `[ -n "$(find ...)" ]` is false. The first condition `[ ! -f $CORE_WATCH_STATE ]` is true (the file does not exist), so the deadman fires. This is correct: a missing state file is a deadman trigger.

**Evidence:** None.

**Fix:** None needed.

---

## Accepted Limits: The Four Questions

### 1. Is any limit WORSE than stated?

**Limit 10 (swap operator):** The bound is "per-sweep cap x cooldown windows until the guardian pulls `emergency_stop_sweep`". The cap is 10 SOL, the cooldown is 6 hours. The revenue job runs hourly, so the effective rate is about 34 SOL/day (round 37 C05). This is stated. The operator key also holds the operator's own SOL for fees (0.02 SOL float). This is stated. The operator key can also hold cbBTC from a swap that has not been returned yet. This is transient and bounded by the swap amount. This is stated.

**Limit 25 (re-roll):** The limit says "one re-roll per full window of total silence". The crank's reveal lane runs every minute, so a lapse needs the crank to be down AND no traffic to capture. This is stated. The alarm pages `reveal_rescheduled` and `reveal_queue_stalled`. This is stated.

**Limit 26 (leader grind):** The limit says the leader of C can choose among many draws. The bound is "best-of-4 alone takes P(Level V) from 5.0% to 18.6%". This is stated. The leader can also vary block contents for more tries. This is stated.

**Limit 27 (bare burn claim):** The limit says a claim between a bare burn and its retirement pays into a dead account. The crank retires bare burns every pass, so the window is at most one pass (hourly). This is stated. The alarm pages `vault_burned` and `vault_left_index`. This is stated.

**Limit 28 (Coinbase freeze):** The limit says a frozen pool stops all claims. The redemption forfeits its undelivered share. This is stated. The alarm pages `pool_frozen`. This is stated.

**Limit 32 (redemption rate limit):** The limit says the cap is `ceil(2.1% x live)` with a floor of 1. The ring bounds the cap at 64. This is stated. The limit says "live" is minted minus redeemed minus retired bare burns. A bare-burned vault counts until retired. This is stated.

**Limit 40 (Core upgradeable):** The limit says a Core change could make every redemption refuse, halt the level queue, or widen who may approve an ExecuteV1. This is stated. The alarm watches `prog.core.upgrade_authority` and `prog.core.hash`. This is stated.

**Limit 46 (PoB collection hot wallet):** The limit says the hot wallet can end the project before it starts or capture governance. This is stated. The alarm pages on any plugin or update-authority change. This is stated.

**Limit 47 (stolen guardian):** The limit says a stolen guardian can hold sales and the sweep shut for a vote plus a week at best, and for good while fewer than half of all live vaults vote to replace it. This is stated.

**Limit 56 ($CBOB hot key):** The limit says anyone who reads the release wallet key can move every $CBOB not yet released. This is stated.

**Limit 58 (rescue):** The limit says a vault nested inside a live vault can be taken by the host's owner during their own opening. This is stated. The crank sends the rescue every full pass. This is stated.

**Limit 59 (in-flight grief):** The limit says a party that learns a new vault's address before the transaction lands can fund it first. This is stated. The pages check `checkNewAddress` before every attempt. This is stated.

No limit is worse than stated.

### 2. Is anything listed as a limit not actually a limit?

**Limit 6 (aborted flock run):** This is a logging shortfall, not a correctness issue. It is still a limit: an aborted run is indistinguishable from one that never fired in the log.

**Limit 7 (wedged holder):** A wedged-but-alive holder is a permanent silent skip under `flock -n`. The alarm pages `crank_silent` and `royalties_unswept`. This is still a limit: a live holder is never stolen from.

**Limit 8 (cross-pass correlation lag):** A false CRITICAL that a human must close by hand. This is still a limit.

**Limit 9 (foreign Core asset):** Nothing detects a foreign Core asset nested in a vault continuously. The redeem page's `judgeRedemptionCoverage` warns, but the page is not published. This is still a limit.

**Limit 13 (MINT upgrade authority):** Until the upgrade authority is removed, whoever holds it could ship an instruction that rewrites any vault's level. This is still a limit.

**Limit 29 (only cbBTC splits):** Anything else sent to the revenue address stays there forever. This is still a limit.

**Limit 34 (ordering per kind):** Different kinds execute in whatever order executors choose. This is still a limit.

**Limit 35 (turnout rule):** The 10% turnout rule never binds at the ruled numbers. This is still a limit.

**Limit 36 (in-line monthly run):** A month with no protocol traffic distributes nothing until someone calls `distribute`. This is still a limit.

**Limit 37 (host instruction carries pool):** Every host instruction carries the pool. This is still a limit.

**Limit 39 (immutability):** Every surviving bug is permanent. This is still a limit.

**Limit 41 (leaked custodial key):** Transfers are not limited. This is still a limit.

**Limit 42 (prior transaction):** The redemption page must prepare missing destination ATAs in a prior transaction. This is still a limit.

**Limit 43 (off-curve owner):** An off-curve owner cannot redeem. This is still a limit.

**Limit 44 (undeclared airdrops):** Undeclared airdrops are destroyed on redemption. This is still a limit.

**Limit 45 (no vaults):** If every vault is redeemed, governance cannot act until a new vault exists. This is still a limit.

**Limit 48 (charter claim cannot be stopped):** The charter claim does not read the sales stop. This is still a limit.

**Limit 49 (record rent):** A vault's record rent is not refunded. This is still a limit.

**Limit 55 (join shares unsplit revenue):** A vault that joins can share revenue that was still unsplit when it asked. This is still a limit.

**Limit 57 (name and picture):** A vault's name and picture are the minter's and permanent. This is still a limit.

No limit is actually closed.

### 3. Is any DISCHARGED item not actually discharged?

**Item 51 ($CBOB boost):** The boost is built in MINT and GOV. The crank expires due boosts before distributing. The alarm pages `boosts_stalled`. This is discharged.

**Item 54 (compute):** The compute units are measured. The holder pages must set the compute-unit limit. This is discharged.

**Item 12/17 (compute units):** Measured on the v5 artifact. This is discharged.

**Item 14 (duplicate attribute keys):** Closed on chain: `mint_vault` and `claim_charter_vault` refuse `DuplicateAttribute`. This is discharged.

**Item 19 (unlevelled-vault halt):** Closed by construction: there is no state in which a vault is activated but unlevelled. This is discharged.

**Item 30 (85/15 ratio):** Discharged by stage 3b: `split_bps` is written once by `initialize`. This is discharged.

**Item 31 (31-day branch):** Superseded by stage 3b: the cadence is deleted. This is discharged.

**Item 33 (replacement swap operator):** Discharged by stage 3c: the notice is an `initialize` value. This is discharged.

**Items 1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24:** Gone with the Bank, the co-signer, the deck, or the distributor. This is discharged.

No discharged item is actually not discharged.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 22 (no distribution at scale):** The verdict records 22.1 PASS at 5 vaults, 22.2 FAIL accepted by Gary, 22.3, 22.4, 22.5 PASS. The item stays OPEN AND BLOCKING only for the ~2,100-vault scale. This is not being quietly treated as accepted.

**Item 38 (initialize values):** The values are in `launch/mainnet-init.json`. The checker refuses unless nothing is OPEN. The charter opening date and lock deadline are still OPEN. This is not being quietly treated as accepted.

**Item 50 (holder surfaces):** The pages are built and staged, not published. This is not being quietly treated as accepted.

**Item 52 (pool and Squads accounts):** The Squads' cbBTC ATA exists. The revenue address must be funded. This is not being quietly treated as accepted.

**Item 53 (dress rehearsal):** The rehearsal ran to its end on mainnet. The last in-tree run is `e7c192a`. This is not being quietly treated as accepted.

No OPEN AND BLOCKING item is being quietly treated as accepted.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What should this project do before launch that AI audit structurally cannot?

1. **Run the crank against a synthetic 2,100-vault state on a local validator.** The crank's I/O at scale is the one thing no test has exercised. A synthetic state with 2,100 vaults, some burned, some frozen, some with boosts, would exercise the batching, the fee budgeting, and the race handling. This is a test that can be written and run before launch.

2. **Run the alarm against a synthetic state with every detector firing simultaneously.** The alarm's notify path, the router's stream handling, and the recovery logic are tested in isolation, but not with 50+ findings of different kinds at once. A synthetic state with every detector firing would exercise the full notify path.

3. **Run the revenue cycle against a mainnet fork with a real swap, a forced failure, and a hand recovery.** The fork test proves the swap works. The rehearsal proved the cycle works on mainnet. But the hand recovery path (a cycle that fails after the sweep) has only been walked through in the rehearsal, not in a fork. A fork test with a forced failure would exercise the recovery code.

4. **Have a human operator read the alarm's output for a week before launch.** The alarm's pages are the last line of defense. A human who has seen the pages in rehearsal mode will recognize a real page when it fires in production. This is a procedural step, not a code change.

5. **Publish the holder guide and the redeem page before the lock.** The holder guide promises surfaces that are not published. The redeem page's `judgeRedemptionCoverage` is the only pre-signature check for undeclared holdings. Publishing them before the lock means holders can use them from day one.

6. **Have a second person independently verify the launch values against the rulings.** The launch checker is automated, but a human should read `launch/mainnet-init.json` against `DESIGN-v6.md` and `SPEC.md` before signing. A wrong value is permanent.

7. **Run the full suite on a different machine.** The suite has only ever run on the box. A different machine with a clean clone would catch environment-specific assumptions (e.g., the hardcoded `/opt/cbob-vaults` paths, the `/home/ubuntu/luna-remotion/node_modules` esbuild path in `web/test/ref.mjs`).

8. **Have a third party review the accepted limits list.** The limits are the project's own summary of what can go wrong. A third party reading them against the code would catch a limit that is understated or a limit that is actually closed.

9. **Run the verifiable build workflow on a clean GitHub runner.** The workflow exists, but it has only run once. A clean run on a different runner would confirm the build is reproducible.

10. **Have Gary sign a test transaction on the rehearsal page before the real ceremony.** The rehearsal page's wallet-edit judge and the relay's transaction rule are tested offline, but a real Phantom signature on a test transaction would confirm the integration.

These are concrete steps that AI audit cannot perform: they require human judgment, a different machine, or a real wallet signature.