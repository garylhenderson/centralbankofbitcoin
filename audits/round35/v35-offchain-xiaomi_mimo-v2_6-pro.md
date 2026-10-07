# Independent Security Audit — CBOB Vaults v6 Off-Chain Pipeline

## R0. ROUND 34'S VERDICT AND REPAIRS

Round 34's off-chain verdict was **NOT CLEAN** (4 findings: 3 LOW, 1 INFO). I independently verify each repair against the current tree.

**L1 (seenSplits growth):** `sortedSplits` in `detectors.mjs` builds a WeakMap-cached deduped, sorted view and `closesCycle` binary-searches it. `detectSplitHistoryGrowth` pages at 50,000 entries. The selftest proves equivalence on 400 random cases with branch coverage. **Repair holds.** The WeakMap keyed on the array reference is correct for the call pattern (each pass builds a fresh `allSplits` array).

**L2 (Token-2022 reconcile amounts):** `reconcileAmount` reads the owning program and returns the base-field amount labelled for Token-2022, "unreadable" otherwise. The selftest arm checks both directions. **Repair holds.**

**L3 (split recovery box-clock):** `revenue.mjs` now uses `Math.min(...returnedUnsplit.map(c => Number(c.returnBlockTime) > 0 ? Number(c.returnBlockTime) : Date.parse(...)))`. When `returnBlockTime` is present the scan starts at chain time. **Repair holds.** The residual (a row without `returnBlockTime` uses the box clock) is stated in SPEC limit 10.

**D1 (rehearsal script "five programs"):** SPEC 53 and the script header now say "four keyed programs" (the sweep helper carries no id). **Repair holds.**

**Gate-5 additions (871 assertions):** R34.G1a/b (full worst shape), R34.G2 (ATA address), R34.G3 (no-CPI read), R34.G4 (seal against owner). The validation record shows the fit-loop defect was caught and fixed before the final run. **Consistent with the tree.**

---

## R1. THE CRANK (`bank/crank.mjs`)

### Finding C1 — MEDIUM: `budgetPlan` can plan reveals the fee payer cannot afford if `preExpires`/`postExpires` are non-empty and the reveal budget is computed against a stale plan

**Construct:** `budgetPlan` (line ~280) computes `base = { ...plan, reveal: [] }`, then `room = lamports - planCostLamports(base) - floor`. The `n` calculation divides `room` by `SIG_FEE_LAMPORTS + REVEAL_RENT_LAMPORTS`. However, `planCostLamports(base)` includes `ceil(preExpires.length / EXPIRE_BATCH) + ceil(postExpires.length / EXPIRE_BATCH)` transactions. If the plan has 20 preExpires (1 batch) and 20 postExpires (1 batch), that is 2 extra transactions (10,000 lamports) counted in the base. The reveal budget is then `room / 116,360`. This is correct in isolation.

**But:** the caller in `main()` does `plan = fee.plan` after `budgetPlan`, and then sends `plan.preExpires` and `plan.postExpires` via `expire()`. If `budgetPlan` dropped reveals to fit the budget, the expiry transactions are still sent. The cost model is consistent. **No defect here on closer inspection** — the base cost includes the expiry transactions, and the reveal budget is the remainder.

**Withdrawn.** The arithmetic is correct.

### Finding C2 — LOW: `judgeDistributeRefusal` treats an unreadable fresh config as a failure, but the caller does not distinguish "config read failed" from "config read succeeded and epoch moved"

**Construct:** `crank.mjs` `main()`, the distribute refusal handler:
```js
let fresh = null
try { fresh = L.readPinned('MintConfig', await conn.getAccountInfo(MINT_CFG, 'confirmed'), PublicKey) } catch { fresh = null }
if (judgeDistributeRefusal(lastFailure, cfg, fresh) === 'benign') ...
else failures.push('distribute (monthly, free)')
```

If `getAccountInfo` returns `null` (config absent — impossible after initialize, but an RPC blip could return null), `readPinned` returns `null`, and `judgeDistributeRefusal` receives `fresh = null`. The function checks `!planned || !fresh` and returns `'fail'`. This is the **loud direction** — a failure is reported. Correct behaviour.

**Withdrawn.** The fail-closed path is right.

### Finding C3 — LOW: The reveal loop's `break` on `revealAttrSource === 'skip'` stops the entire reveal run, but the comment says "next pass" — if the asset is permanently unreadable (e.g., an RPC endpoint that consistently fails for one account), reveals stall forever

**Construct:** `crank.mjs` `main()`, the reveal loop:
```js
const how = revealAttrSource(assets[r.asset])
if (how === 'skip') { console.log(`  skip reveal #...`); break }
```

`revealAttrSource` returns `'skip'` when `assets[r.asset]` is `'other'` (null RPC answer). The `break` stops the reveal run because reveals are strictly in mint order. If the asset read consistently returns null (e.g., a corrupted account, or an RPC that cannot read it), every pass will skip at the same point, and `reveal_queue_stalled` will page after two passes. The alarm catches this.

**But:** the `break` also stops reveals for vaults AFTER the unreadable one in mint order. Those vaults are ready and could be revealed if the unreadable one were skipped. The program refuses out-of-order reveals (`RevealOutOfOrder`), so this is correct — the FIFO must proceed in order.

**Withdrawn.** The design is correct; the alarm catches the stall.

### Finding C4 — LOW: `planCostLamports` does not account for the `split` transaction's cost when `payDecimals === null`

**Construct:** `crank.mjs` `main()`:
```js
if (plan.split && payDecimals === null) failures.push('split_revenue NOT sent: ...')
else if (plan.split) await run('split_revenue ...')
```

When `payDecimals === null`, the split is not sent, but `planCostLamports` already counted it (`(p.split ? 1 : 0)`). This means the fee budget overestimates by 5,000 lamports. This is the **safe direction** — the key holds slightly more than needed. No defect.

**Withdrawn.**

### Finding C5 — LOW: `warnDue` uses `nowSec` from the chain clock, but the warning marker file stores `nowSec` — if the chain clock jumps backward (e.g., a validator restart on a test cluster), the warning could fire repeatedly

**Construct:** `crank.mjs` `main()`:
```js
if (warnDue(last, nowSec)) { ... fs.writeFileSync(WARNED, String(nowSec)) }
```

`nowSec` is `chainSec` (the chain's Clock sysvar). On mainnet the clock is monotonic. On a test validator it could theoretically jump. The consequence is a repeated warning email, not a correctness issue. **Accepted operational noise, not a defect.**

**Withdrawn.**

### Finding C6 — LOW: `mintFailureCode` returns `null` when the invoke stack is unbalanced, which means a race code in a malformed log is treated as a failure

**Construct:** `crank.mjs` `mintFailureCode`:
```js
const end = /^Program (\w+) (success|failed:.*)$/.exec(line)
if (end) {
  if (stack.at(-1) !== end[1]) return null
  ...
}
```

If the stack is empty (`stack.at(-1)` is `undefined`) and a `success`/`failed` line appears, the function returns `null`. The caller then treats it as a failure (`lastFailure = code || ''` and `failures.push`). This is the **loud direction** — a malformed log causes a failure report, not a silent skip. Correct.

**Withdrawn.**

### Finding C7 — LOW: The `BENIGN` regex matches `NothingToSplit`, which is listed in `DISTRIBUTE_RACE` but NOT in `BENIGN` — wait, it IS in `BENIGN`

Re-reading: `BENIGN` includes `NothingToSplit`. `DISTRIBUTE_RACE` includes `NothingToDistribute|BoostsExpireFirst|JoinWaitingFirst`. `judgeDistributeRefusal` checks `BENIGN.test(m)` first (which catches `NothingToSplit`), then `DISTRIBUTE_RACE`. `PoolShort` is in neither, so it returns `'fail'`. **Correct.**

**Withdrawn.**

### Finding C8 — LOW: `crankNotices` sends `urgent: false` for failures, but the comment says "a lane failing is a LEVEL condition" — the router classifies non-urgent text as ALERT, which is correct for a level condition

**Verified.** The classification is correct.

**Withdrawn.**

### Crank verdict: No surviving defects found in `bank/crank.mjs`. The plan logic, fee budgeting, race handling, reveal ordering, and notification routing are all correct.

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

### Finding A1 — LOW: `detectSweepState` uses `cooldownSecs` capped at 21,600 (6 hours), but the on-chain cooldown could be voted UP to 24 hours — the window `|t - start| <= half` uses `half = floor(cooldownSecs / 2)`, so at 6 hours the window is 3 hours

**Construct:** `detectors.mjs` `detectSweepState`:
```js
const half = Math.floor(Number(cooldownSecs) / 2)
```

The caller passes `cooldownSeen = Math.min(..., 21600)`. If the on-chain cooldown is voted to 24 hours, `cooldownSeen` stays at 21,600 (the smallest ever seen, capped at 6h). The window is `|t - start| <= 10,800` (3 hours). A thief's sweep must wait a full cooldown (24h) after the honest one, so the gap is 24h > 3h. The window correctly rejects it. An honest sweep's cycle start is within minutes of the sweep time, so `|t - start| <= 10,800` holds. **Correct.**

**Withdrawn.**

### Finding A2 — LOW: `detectUnsweptRoyalties` computes `graceSecs = max(24h, cooldown + REVENUE_CRON_PERIOD + 1h)` — at the ruled 6h cooldown this is 28h, but the comment says "a day" — the actual grace is 28h, not 24h

**Construct:** `detectors.mjs` `detectUnsweptRoyalties`:
```js
if (cooldownSecs !== null && ...) graceSecs = Math.max(Number(graceSecs), Number(cooldownSecs) + REVENUE_CRON_PERIOD_SECS + 3600)
```

At 6h cooldown: `max(86400, 21600 + 3600 + 3600) = max(86400, 28800) = 86400` (24h). Wait — `REVENUE_CRON_PERIOD_SECS` is 3600 (1 hour), so `21600 + 3600 + 3600 = 28800` (8 hours). `max(86400, 28800) = 86400` (24 hours). The grace is 24h at the ruled cooldown. At a voted 24h cooldown: `max(86400, 86400 + 3600 + 3600) = 93600` (26h). The comment says "a day, OR the voted cooldown plus one revenue cron period plus an hour, whichever is longer" — this matches. **Correct.**

**Withdrawn.**

### Finding A3 — LOW: `detectRedemptionRate` uses `nearFraction = 0.2`, so it pages when `remaining <= floor(cap * 0.2)` — at cap 45 this is `remaining <= 9`, which is "near full" at 80% usage. The comment says "under 20% room" which is correct.

**Verified.** **Withdrawn.**

### Finding A4 — LOW: `detectDistributionOverdue` checks `poolAvail <= 0` and returns `stalls` only — but `stalls` could be empty if `pc`/`pt` are undefined, meaning a distribution overdue with no pool availability is silent

**Construct:** `detectors.mjs` `detectDistributionOverdue`:
```js
if (w === 0n) return stalls
if (poolAvail === null || poolAvail === undefined || BigInt(poolAvail) <= 0n) return stalls
```

If `w > 0` and `poolAvail <= 0`, the function returns `stalls` (which could be empty). The comment says "no activated vault, or nothing undistributed in the pool, is not late." This is correct — if the pool has nothing to distribute, the distribution is not overdue. **Correct.**

**Withdrawn.**

### Finding A5 — LOW: `detectPoolHealth` checks `tok.amount < owedCeil` for insolvency, but `owedCeil` is computed from `owed_scaled` which is read from the config — if the config read is stale (from `carryConfigBaseline`), the insolvency check could use an old `owed_scaled`

**Construct:** `alarm.mjs` `main()`:
```js
const cfgAtPool = pool?.owedScaled ? { ...cfg, 'mint.owed_scaled': pool.owedScaled } : cfg
findings.push(...D.detectPoolHealth(cfgAtPool, pool))
```

The pool read includes `owedScaled` from a fresh config read (`readPool` reads the config in the same `getMultipleAccountsInfo` call). So `cfgAtPool` uses the fresh `owed_scaled`, not the stale baseline. **Correct.**

**Withdrawn.**

### Finding A6 — LOW: `detectCrankHealth`'s `covered` function matches exact problem strings — if the planner's message format changes slightly (e.g., a different number format), the covered check fails and the freeze problem is reported as a `crank_problem`

**Construct:** `detectors.mjs` `detectCrankHealth`:
```js
const covered = p => (coveredFreezes.pool &&
  (p === 'the pool cbBTC account is FROZEN; claims would all refuse' ||
   /^the revenue address holds \d+ sats and cannot be split: the community pool's cbBTC account is FROZEN$/.test(p))) || ...
```

The first check is an exact string match. The second is a regex. If the planner's message changes (e.g., "the pool cbBTC account is FROZEN; claims would all refuse" becomes "the pool cbBTC account is FROZEN; all claims would refuse"), the covered check fails. The consequence is a `crank_problem` finding for a freeze already reported by `applyFrozenTransitions`. This is a **false positive** (noise), not a silent failure. The alarm still reports the freeze via the transition detector. **LOW: a maintenance hazard, not a security defect.**

**Filed as LOW.**

### Finding A7 — LOW: `detectLogGaps`'s `reviewed` trimming uses `Math.max(1, 500 - unreviewed.length)` — if `unreviewed.length` is 500, `reviewed` keeps 1 entry (the watermark). If `unreviewed.length` is 501, `reviewed` keeps 0 entries, and the watermark is lost from `keep`. But `unreviewed` still contains all 501 entries, so the finding stands. The watermark is only used to determine `at = all.indexOf(reviewedThrough)` — if the watermark is not in `keep`, the next pass's `all` will not contain it, and `at` will be -1, meaning all entries are unreviewed. This is the **loud direction** (the gap stays open). **Correct.**

**Withdrawn.**

### Finding A8 — LOW: `alarm.mjs`'s `readConfigs` throws if `missingWatchedKeys` finds a missing key — but `missingWatchedKeys` exempts keys whose program is `._missing`. If a program is deployed but its config is absent (e.g., not yet initialized), the `._missing` flag is set, and the keys are exempted. But `prog.*` keys are exempted only when `prog.<p>._missing` is true. If the program is deployed but its ProgramData is unreadable, `readConfigs` throws. This is the **loud direction**. **Correct.**

**Withdrawn.**

### Finding A9 — MEDIUM: `detectUnledgeredSweeps` reads the sweep amount from the instruction data at `d[8+i]` for `i` in `7..0` — this is a little-endian u64 read. But the instruction data layout is `disc(8) + amount(8)`. The read is `for (let i = 7; i >= 0; i--) onchain = (onchain << 8n) | BigInt(d[8 + i])`. This reads bytes 15, 14, 13, 12, 11, 10, 9, 8 in that order, shifting left and OR-ing. This is correct little-endian to BigInt. **Verified.**

**Withdrawn.**

### Finding A10 — LOW: `detectSplitClaims`'s `recent` set includes cycles whose `sweepSig` is in `sweptOnChain` — but `sweptOnChain` is built from `opts.sweeps` which is `allSweeps` (the alarm's accumulated sweep list). If a sweep is seen but its cycle row is written later (after the alarm pass), the cycle is not in `recent` and is not verified. The next pass will include it. **Correct (eventual consistency).**

**Withdrawn.**

### Alarm verdict: One LOW finding (A6, covered-freeze string matching). No CRITICAL or HIGH.

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

### Finding L1 — LOW: `parseRustStruct` uses a regex `pub struct NAME\s*\{([\s\S]*?)\n\}` — if a struct contains a nested `}` in a comment or attribute, the regex could match prematurely

**Construct:** `layout.mjs` `parseRustStruct`:
```js
const m = new RegExp(`pub struct ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src)
```

The non-greedy `[\s\S]*?` matches until the first `\n}`. If a comment inside the struct contains `\n}` (e.g., a doc comment with a code block), the regex would match prematurely and miss fields. The parser then throws on any line it cannot read as a field (the `if (!f) throw` guard). So a premature match would cause a **loud failure**, not a silent misread. **Correct (fail-closed).**

**Withdrawn.**

### Finding L2 — LOW: `offsets` computes fixed offsets up to the first variable-length field. For `SealConfig`, the `Vec<Pubkey>` field is variable-length, so `offsets('SealConfig')` returns offsets only up to `reserve_mints`. The `bump` field after it has no static offset. The selftest checks `L.offsets('SealConfig').collection` (which is before the Vec) — correct. But `L.offsets('SealConfig').bump` would be `undefined`. The cross-program offset checks use `S0.collection` and `S0.reserve_mints` (the Vec's start offset), both of which are before the variable-length field. **Correct.**

**Withdrawn.**

### Finding L3 — LOW: `fixedLength('MintConfig')` returns `null` if any field is variable-length. `MintConfig` has no variable-length fields (all fixed-size), so it returns a number. The selftest checks `enc.length === L.fixedLength('MintConfig')`. **Correct.**

**Withdrawn.**

### Layout verdict: No defects. The parser is fail-closed, offsets are correct, and the cross-program checks are comprehensive.

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

### Finding M1 — LOW: `pendingScaled` throws on negative result ("debt above entitlement"), but the Rust `owed_of` uses `checked_sub` which returns `Overflow` error. The JS throw and the Rust error are equivalent (both refuse). **Correct.**

**Withdrawn.**

### Finding M2 — LOW: `reweigh` computes `owed = pendingScaled(v, acc)` then sets `carry = owed` and `debt = (weight + boost) * acc`. The Rust `reweigh` does the same. But `pendingScaled` uses `weightOf(level) + BigInt(boost)` while the Rust uses `weight_of(r)` which is `LEVEL_WEIGHTS[level-1] + r.boost_weight`. These are identical. **Correct.**

**Withdrawn.**

### Finding M3 — LOW: `credit` computes `delta = avail * ACC_SCALE / w` (floor division) and `owed += delta * w`. The Rust does the same. The dust (`avail * ACC_SCALE % w`) stays in the pool. The selftest asserts this. **Correct.**

**Withdrawn.**

### Arithmetic verdict: No defects. The JS mirror matches the Rust exactly.

---

## R5. THE SWAP (`bank/swap.mjs`) AND THE REVENUE CYCLE (`bank/revenue.mjs`)

### (a) Oracle math

**Finding S1 — LOW: `satsPerLamport` uses `Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10` — the `Number()` conversion could lose precision for very large prices, but the result is only used for the deviation filter (100 bps threshold), where double precision is sufficient. The floor calculation uses BigInt throughout. **Correct.**

**Withdrawn.**

**Finding S2 — LOW: `oracleFloor` computes `expectedSats = num / den` (floor division) and `minSats = expectedSats * (10000 - 150) / 10000` (floor division). Both round down, which is conservative (the floor is lower than the true value). **Correct.**

**Withdrawn.**

### (b) Pyth account verification

**Finding S3 — LOW: `readPyth` checks `acc.owner.equals(PYTH.receiver)` but the account is derived under `PYTH.push`. The Pyth push-oracle program creates sponsored price accounts as PDAs under itself, but the receiver program owns them. This is the correct Pyth architecture. The test fixture confirms `owner: SW.PYTH.receiver`. **Correct.**

**Withdrawn.**

**Finding S4 — LOW: `readPyth` does not check `write_authority` (bytes 8-40). The comment in the round-34 verdict says "write_authority needs no check at a push-oracle PDA." This is correct — the push-oracle program controls writes, and only Wormhole-verified messages from Pyth's guardians can update the account. An attacker cannot write arbitrary data. **Correct.**

**Withdrawn.**

### (c) Deviation filter

**Finding S5 — LOW: `orcaSpot` computes `(Number(w.sqrtPrice) / 2 ** 64) ** 2` — the `Number()` conversion of a u128 could lose precision, but the result is only used for the deviation filter. `meteoraSpot` computes `1 / (1 + p.binStep / 10000) ** p.activeId` — floating point, but again only for the filter. Both are compared against `satsPerLamport` (also floating point) with a 100 bps threshold. **Correct.**

**Withdrawn.**

### (d) Minimum out

**Finding S6 — LOW: The floor is `minSats = expectedSats * (10000 - 150) / 10000`, which is the oracle's expected output less 150 bps. The deviation filter uses `MAX_POOL_DEVIATION_BPS = 100`. So a pool could be 100 bps from the oracle and the floor is 150 bps below the oracle — the floor is 50 bps below the pool's price at the edge of the gate. This means a swap at the edge of the gate could execute up to 50 bps below the pool's price. But the pool's price IS the execution price, so the swap executes at the pool's price (which is within 100 bps of the oracle), and the floor is 150 bps below the oracle. The floor is 50 bps below the pool's price at the edge. This is the **intended tolerance** — the 150 bps covers the pool fee (0.16% for Orca) plus price impact. **Correct.**

**Withdrawn.**

### (e) The judge

**Finding S7 — LOW: `judgeSwapInstructions` does not verify the tick arrays (Orca) or bin arrays (Meteora) in the swap instruction. A tampered builder could pass wrong tick arrays. However, the venue program validates the arrays against the pool's state, and the `other_amount_threshold` / `min_amount_out` floor protects against a worse price. If the arrays are wrong, the swap reverts. **Correct (the floor is the protection).**

**Withdrawn.**

**Finding S8 — LOW: `judgeSwapInstructions` does not verify the oracle PDA (Orca key 10) or the bitmap (Meteora key 1). The venue programs validate these. **Correct.**

**Withdrawn.**

**Finding S9 — LOW: `judgeSwapInstructions` checks `d.length !== (orca ? 42 : 24)` for the swap data. For Orca: 8 (disc) + 8 (amount) + 8 (floor) + 16 (sqrt_price_limit) + 1 (direction) + 1 (amount_specified_is_input) = 42. For Meteora: 8 + 8 + 8 = 24. **Correct.**

**Withdrawn.**

### (f) Account derivation

**Finding S10 — LOW: `orcaTickArrayStarts` computes `s0 = Math.floor(tickCurrent / span) * span` where `span = 88 * tickSpacing`. The three arrays are `[s0, s0 - span, s0 - 2 * span]`. For an a_to_b swap (selling A for B), the price moves down, so the tick moves down. The arrays below the current tick are correct. **Verified against the Orca IDL.**

**Withdrawn.**

**Finding S11 — LOW: `meteoraBinArrayIndexes` computes `i = Math.floor(activeId / 70)` and returns `[i, i + 1, i + 2]`. For a Y to X swap (selling wSOL for cbBTC), the active bin moves up. The arrays above the current bin are correct. **Verified against the Meteora IDL.**

**Withdrawn.**

### (g) wSOL handling

**Finding S12 — LOW: If the operator's wSOL ATA already exists with a balance, the `createAtaIdempotent` is a no-op, the transfer adds `lamportsIn`, SyncNative updates the amount, and after the swap the close sends everything back. If the swap consumes less than `lamportsIn`, the remainder is closed back. **Correct.**

**Withdrawn.**

**Finding S13 — LOW: If the wSOL ATA is frozen, the transfer or sync fails and the transaction reverts. If it has a delegate, the close requires the owner's signature (which the owner provides). **Correct.**

**Withdrawn.**

### (h) Failure and retry

**Finding S14 — LOW: `classifySendFailure` returns `'unknown'` for a confirmation timeout, and the caller throws (does not try the next venue). This prevents a double swap. The cycle stays open. **Correct.**

**Withdrawn.**

**Finding S15 — LOW: If Orca's swap lands but the confirmation times out, `classifySendFailure` returns `'landed'` (the chain says it succeeded), and the caller records it and breaks. **Correct.**

**Withdrawn.**

### (i) Adversary extraction

**Finding S16 — LOW: With a 100 bps deviation gate and a 150 bps floor, a sandwich attacker could push the pool to 100 bps from the oracle, and the swap executes at the pool's price (within 100 bps of the oracle). The floor is 150 bps below the oracle, so the swap could execute up to 50 bps below the oracle at the edge of the gate. For a 10 SOL swap (~$1,400 at $140/SOL), 50 bps is ~$0.70. Per month (40 SOL/day × 30 days = 1,200 SOL), 50 bps is ~$840. This is within the stated tolerance. **Not material.**

**Withdrawn.**

### Revenue cycle

**Finding S17 — LOW: `revenue.mjs`'s `splitsSince` scans up to 10 pages of 1,000 signatures. If there are more than 10,000 splits since the return, the scan stops and the cycle stays open. The alarm's `cycle_unsplit` will page. **Correct (loud direction).**

**Withdrawn.**

**Finding S18 — LOW: `revenue.mjs`'s open-cycle guard throws if any cycle is open. This prevents a new cycle from starting while one is unresolved. **Correct.**

**Withdrawn.**

### Swap/revenue verdict: No defects. The oracle math, Pyth verification, deviation filter, minimum out, judge, account derivation, wSOL handling, failure/retry, and adversary bounds are all correct.

---

## R6. THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

### Finding G1 — LOW: `bank/selftest.mjs`'s `FLOOR = 912` must equal the assertion count. The runner's `DET_FLOOR = 912` must also equal it. The selftest checks `R.length !== FLOOR` and fails if they differ. The runner checks `floor "detector selftest" "$DET_OUT" '[0-9]+/[0-9]+ detector assertions as predicted' "$DET_FLOOR"` which enforces equality. **Correct.**

**Withdrawn.**

### Finding G2 — LOW: `scripts/run-tests.sh`'s `MIN_ASSERTIONS = 871` must equal the suite's assertion count. The runner checks `[ "$TOTAL" -eq "$MIN_ASSERTIONS" ]`. **Correct.**

**Withdrawn.**

### Finding G3 — LOW: `sim/swap-fork.sh`'s `SWAP_FLOOR = 16` must equal the fork's assertion count. The script checks `[ "$T" -eq "$SWAP_FLOOR" ]`. **Correct.**

**Withdrawn.**

### Finding G4 — LOW: The selftest's round-24 section claims "each both ways" but some arms are regex-only (e.g., checking that a string is present in source code). The round-30/33/34 additions add mutation arms. The coverage is adequate. **Not a defect.**

**Withdrawn.**

### Finding G5 — LOW: `scripts/build-mainnet.sh` proves the sweep helper's byte identity between mainnet and localnet builds, and between `dist/` and `target/deploy/`. It does NOT prove the four keyed programs' byte identity (they differ by the `localnet` feature). The behavioural test (mainnet rejects test key, localnet accepts) is the proof. **Correct.**

**Withdrawn.**

### Finding G6 — LOW: `scripts/cron-install.sh` arms nothing it should not. The `ours()` function matches only tagged, uncommented lines. The selftest proves both directions. **Correct.**

**Withdrawn.**

### Gates verdict: No defects. All floors enforce equality, all gates can fail, and the build/cron scripts are correct.

---

## THE ACCEPTED LIMITS — FOUR QUESTIONS

### 1. Is any limit WORSE than stated?

**No.** I checked each accepted limit against the code:

- **Limit 10 (swap operator):** The bound is "per-sweep cap × cooldown windows until the guardian stops it." The on-chain cap is 10 SOL per 6h cooldown = 40 SOL/day. The alarm pages `unreconciled_swap` after 60 minutes. The guardian can stop instantly. **As stated.**

- **Limit 41 (leaked custodial key):** Transfers are not limited. The 2.1%/hour cap only bounds redemptions. **As stated.**

- **Limit 46 (PoB collection hot key):** Through the 7-day charter window, the key can block all claims or capture governance. After the window, the exposure ends. **As stated.**

- **Limit 56 ($CBOB hot key):** The entire supply is on a hot key. Anyone who reads the file can move it. **As stated.**

- **Limit 26 (entropy grinding):** The leader of C's slot can choose among many draws. The selftest and SPEC state the exact probabilities. **As stated.**

### 2. Is anything listed as a limit not actually a limit?

**No.** Each limit describes a real, unrepaired condition.

### 3. Is any DISCHARGED item not actually discharged?

**No.** Each discharged item names what replaced it and why it no longer applies.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** Items 22, 38, 50, 52, and 53 are all clearly marked OPEN AND BLOCKING with explicit "must be done before anything mints" language.

---

## FINDINGS SUMMARY

| ID | Severity | Location | Description |
|---|---|---|---|
| A6 | LOW | `detectors.mjs` `detectCrankHealth` | The `covered` function matches exact problem strings; a planner message format change causes a false `crank_problem` for an already-reported freeze. Maintenance hazard, not a security defect. |

**That is one LOW finding across the entire off-chain pipeline.** No CRITICAL, no HIGH, no MEDIUM.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, WHAT SHOULD THIS PROJECT DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT?

1. **Run the mainnet dress rehearsal (item 22) with a real human watching every transaction.** AI can verify the code is correct; it cannot verify that the RPC endpoint behaves as expected under load, that the cron fires at the right time, that the alert router delivers, or that the hand-recovery runbook works when a real person is stressed. The rehearsal must include: one full revenue cycle through each pool, one forced post-sweep failure walked through hand recovery, and the crank running against ~2,100 vaults. Record every transaction signature.

2. **Have a human verify the launch values against Gary's rulings BY HAND, not through the checker.** The checker validates the JSON against the alarm's production list, but the alarm's list is code. A human should read `launch/mainnet-init.json` line by line against DESIGN-v6.md and confirm each value. The charter opening date and lock deadline are still OPEN — Gary must set them.

3. **Test the redemption page with a REAL wallet holding a REAL vault with stray tokens.** The page does not exist yet (item 50). When it is built, test it with a vault that has an airdropped token, a nested vault, and a Token-2022 account. Verify the warnings appear and the sweep helper moves what it should. This is the only pre-signature control for items 9 and 44.

4. **Verify the alert delivery path end-to-end with a real CRITICAL.** The selftest proves the router classifies correctly, but it does not prove that Gary's phone receives the email. Send a test CRITICAL through the real router and confirm delivery.

5. **Have a second person independently verify the program bytes deployed on mainnet match `dist/`.** The build script proves the local build, but the deploy step (step 9) involves an upgrade from the placeholder. A human should dump the deployed bytes and compare the hash.

6. **Write the rehearsal value set (`launch/rehearsal-init.json`) and the rehearsal mode in `check-launch-params.mjs`** (item 53). Without these, the dress rehearsal cannot run the alarm in rehearsal mode without paging `test_value_in_production` on every pass.

7. **Decide the custody of the $CBOB release wallet and the swap operator key BEFORE launch.** Both are hot keys on this box. Moving them to a hardware wallet or multisig is Gary's call, but the decision must be made before the programs are locked, because after that the custody is permanent.

8. **Run the full suite on a SECOND machine from a clean checkout.** The suite passes on this box, but a different Node.js version, a different OS, or a different network path could reveal a hidden dependency. This is the "reproducibility" claim in `build-mainnet.sh` — it should be tested, not just asserted.