[reasoning only]
# Round 38 Off-Chain Audit Report

## Target R0: Round 37's Verdict and Repairs

I independently verified each of round 37's confirmed findings against the current tree.

**C01 (ack arms unable to fail):** The three arms at `bank/selftest.mjs` now drive `unredeemable_owner`, the one kind in `ACKABLE_KINDS`. The R37 C01 control arm exists. I verified the mutations would now fail: m1 (empty-`why` guard removed) would turn the empty-reason ack into INFO on `unredeemable_owner`, which the arm asserts stays CRITICAL. The repair holds.

**C02 (frozen-pool tick):** `planCrank`'s tick branch now reads `joinable && poolOk && due && w === 0n && waitingThisEpoch` — the `!pool.frozen` condition is dropped from the tick branch while the credit branch keeps it. The R37 C02 arm exists ("R37 C02: a FROZEN pool still ticks and joins"). The problem text now says "the free tick and joins still go through". The alarm's `coveredFreezes` matcher in `detectCrankHealth` was updated to match the new crank text. The repair holds.

**C03 (commented-out `-n`):** `judgeCronTemplate` now computes `varHasN` from `live` (comment-stripped) lines only. The R37 C03 arm exists. The repair holds.

**C04 (`--audit` counting refused sweeps):** `audit()` now reads `c.sweptLamports || (c.sendRejected ? 0 : c.intendedLamports) || 0`. The R37 C04 arm exists (extracts the expression and drives it). The repair holds.

**C05 (34 SOL/day):** SPEC limit 10 now reads "about 34 SOL a day (round 37 C05: ...)". The documentation exception was applied correctly — text only, no code change.

**C07 (pinned):** The R37 C07 arm exists — a `{sendRejected, sweepSig}` row pages `rejected_row_has_sweep` CRITICAL.

**Round 37's rejected claims:** I re-tested C06 (SPEC text "to the host's owner while the host lives" — confirmed absent), C09 (reconcile lane liveness — confirmed no detector reads `RECONCILE_STATE.at`, mechanism accurate, no promise violated), C11 (`poolAvail` redefinition — confirmed the I4 pins only cover call arguments). I do not re-file these.

**One regression check on the C02 repair:** the crank's `distribute` send is still gated on `plan.distribute`, and the tick from a frozen pool will be sent. MINT's `distribute` w==0 path reads the pool with `read_token` which does not check the state byte, and ticks at 1611. This matches. But note: the crank's *claims* are still gated on `!pool.frozen` (correct — a paying claim reverts at a frozen pool), and the *split* is still gated on pool health (correct — `split_revenue` moves both halves in one instruction). No regression found.

**Verdict on R0:** All five repairs hold. No regressions found.

## Target R1: The Crank

I examined `planCrank` for plans the program would refuse, plans that pay or join dead vaults, out-of-order reveals, and value movement outside program pins.

**Finding R1-1 (LOW): `planCostLamports` counts a split that a null `payDecimals` then skips — already dispositioned by round 37 as C16. Not re-filed.**

**Finding R1-2 (MEDIUM): The crank's `activate` sends can race the distribution it just sent, and the plan's `activate` list is computed against pre-distribution state.**

Wait — let me check this more carefully. The order in `main()` is: retire, preJoins, preExpires, split, distribute, postExpires, activate, claims. The plan's `activate` list is computed in `planCrank` against `cfg.dist_epoch` as read at plan time. Each `activate` instruction runs `monthly_inline` first (which may tick or credit), then processes the activation request. The request records `request_epoch = c.dist_epoch` at execution time, not plan time. So a request sent after the distribution lands in the NEW epoch and joins on a later pass — this is correct and tested ("a request sent THIS pass joins on a LATER pass").

But there's a subtler issue: `activate`'s second call (the join) requires `ctx.accounts.config.dist_epoch > r.request_epoch`. The crank's `activate` list only includes vaults where `!r.pending` — so it only sends first calls. The joins are in `preJoins`/`joins` (via `claim`). This is correct.

**Finding R1-3 (LOW): The reveal lane's `break` on 'skip'/'revealed'/'mismatch' stops the whole reveal run, not just that vault.**

Looking at the code: `if (how === 'skip') { ... break }` — this breaks the reveal loop. For 'skip' (unreadable asset), the next pass will re-read. For 'revealed' (done by other lane), breaking is correct because reveals are strictly in mint order — if vault N is revealed, the next unrevealed is N+1, and the loop should continue to N+1. But `break` stops the entire run, leaving N+1... unrevealed this pass.

Wait — actually this is deliberate: `judgeRevealAttrs` returning 'revealed' means someone else revealed it between plan and read. The loop should CONTINUE to the next vault, not break. Let me re-read:

```js
if (j === 'revealed') { console.log(`  skip reveal #${r.mint_index} ${r.asset}: already revealed (done by the other lane or by traffic)`); break }
```

This BREAKS. But the comment says "done elsewhere, not a fault". If vault #5 was revealed by traffic, the crank should proceed to reveal #6. Breaking means #6 waits for the next pass (one minute on the reveal lane). This is a liveness delay, not a correctness issue — the next pass re-plans from `revealed_total` which has advanced. Minor. The selftest asserts this behaviour exists. Not a defect worth filing — it's a one-minute delay in a lane that runs every minute.

Actually wait — there IS a correctness concern. `revealed_total` was read at plan time. If traffic revealed vault #5 between plan and send, then `revealed_total` on chain is now 6, but the crank's plan still thinks it's 5. The crank tries to reveal #5, gets `AlreadyRevealed` (benign), and breaks. Next pass re-reads. Fine.

But what if traffic revealed #5 AND #6? The crank breaks at #5, next pass reveals #7. Fine.

What if traffic revealed #5 but the crank's plan has #5 and #6 both ready? The crank breaks at #5, never tries #6 this pass. Next pass tries #6. One minute delay. Fine.

**Finding R1-4: A plan that pays or joins a dead vault.** The planner checks `assets[r.asset] !== 'live'` for joins and claims, and `assets[r.asset] === 'burned'` triggers retirement. An 'other' (unreadable) asset is never joined or paid. This is correct.

**Finding R1-5: A reveal sent out of order.** The reveal loop iterates from `cfg.revealed_total` and stops at the first not-ready vault. The program refuses `RevealOutOfOrder`. The hash check happens before sending. Correct.

**Finding R1-6: Value movement.** The selftest asserts crank.mjs sends only MINT instructions and builds no token or SOL transfer. Verified by reading the source — every `TransactionInstruction` targets `MINT` with permissionless instruction discriminators. Correct.

## Target R2: The Alarm

**Finding R2-1 (LOW): `detectDistributionOverdue`'s `boosts_stalled` check reads `mint.boosts_due` but the alarm's `readConfigs` produces it from the MintConfig layout — verified it's in `WATCHED_KEYS`. Correct.**

**Finding R2-2 (MEDIUM): The alarm's `detectSweepState` uses `cooldownSeen` computed as `Math.min(...[prev?.sweepCooldownSeen, cfg['mint.sweep_cooldown_secs']].map(Number).filter(...), 21600)`.**

If `prev?.sweepCooldownSeen` is undefined and `cfg['mint.sweep_cooldown_secs']` is a string like "21600", this works. But if BOTH are absent/NaN, `Math.min()` with an empty array plus 21600 gives 21600. The `.filter(n => Number.isFinite(n) && n > 0)` on `[undefined, "21600"]` gives `[21600]`, then `Math.min(21600, 21600)` = 21600. Correct.

But wait: `Math.min(...[undefined, "21600"].map(Number).filter(...), 21600)` — `[undefined, "21600"].map(Number)` gives `[NaN, 21600]`, filter gives `[21600]`, then `Math.min(21600, 21600)` = 21600. Correct.

**Finding R2-3: A dangerous on-chain state read as quiet.** I checked:
- Pool frozen: `pool_frozen` CRITICAL, urgent. ✓
- Pool insolvent: `pool_insolvent` CRITICAL. ✓
- Program upgradeable past lock: `program_not_locked` CRITICAL. ✓
- Config drift on fixed-forever values: CRITICAL. ✓
- Sweep operator armed: CRITICAL. ✓
- Redemption window nearly full: `redemptions_near_cap` HIGH. ✓

**Finding R2-4: A routine state paged every pass.** The `joins_waiting` INFO finding fires whenever `pending_count > pending_this_epoch` — this is routine between a distribution and the crank's next pass. It's INFO, never pages. Correct.

The `revenue_age_unknown` HIGH fires once on migration from legacy clock. Correct.

**Finding R2-5 (LOW): `detectCrankHealth`'s `covered` matcher for the frozen-pool problem text.**

The matcher checks:
```js
p === 'the pool cbBTC account is FROZEN; nothing can be paid until it is thawed (the free tick and joins still go through)'
```

This must exactly equal the crank's problem text. Let me verify: in `planCrank`, when the pool is frozen:
```js
else if (pool.frozen) plan.problems.push('the pool cbBTC account is FROZEN; nothing can be paid until it is thawed (the free tick and joins still go through)')
```

Wait — I need to check the actual current text. Looking at the R37 C02 repair, the problem text was updated. Let me find it in `planCrank`:

```js
if (!poolOk) plan.problems.push(`the pool account is ${pool ? pool.state : 'unread'}; nothing can be distributed or claimed`)
else if (pool.frozen) plan.problems.push('the pool cbBTC account is FROZEN; nothing can be paid until it is thawed (the free tick and joins still go through)')
```

And the matcher in `detectCrankHealth`:
```js
(p === 'the pool cbBTC account is FROZEN; nothing can be paid until it is thawed (the free tick and joins still go through)' || ...
```

These match. The selftest R27 L2 arm drives the real planner. Correct.

## Target R3: The Layouts

**Finding R3-1: The SEEDS assertion.** Round 24 D6 added the assertion — `selftest.mjs` has the `D6:` arms scraping each seed from its program's source. Verified: 11 seeds, all matched. The assertion exists and is real.

**Finding R3-2: Cross-program offsets.** The selftest scrapes every `OFF_` constant from GOV, BURN, and MINT and compares against `L.offsets()`. The L2 arm ensures nothing scraped goes uncomared. Verified.

**Finding R3-3: A struct change slipping past.** The `parseRustStruct` comparison is name-and-type, asserted field-for-field. A field added to the Rust and not here is caught (tested). A type change is caught (tested). A field REORDERED in the Rust would also be caught (the field list would differ in order). Correct.

## Target R4: The Money Arithmetic

**Finding R4-1: `accrual.mjs` vs MINT's `credit`.**

MINT: `delta = (avail as u128).checked_mul(ACC_SCALE)? / (w as u128)` — integer division, truncating.
accrual.mjs: `delta = avail * ACC_SCALE / w` — BigInt division, truncating.
Same. ✓

MINT: `owed += delta * w`.
accrual.mjs: `owed += delta * w`. Same. ✓

**Finding R4-2: `pendingScaled` vs `owed_of`.**

MINT: `weight_of(r)? * acc + carry - debt` (checked).
accrual.mjs: `(weightOf(level) + boost) * acc + carry - debt`.
Same. ✓

**Finding R4-3: `reweigh`.**

MINT: moves owed to carry, restarts debt at new weight.
accrual.mjs: same. ✓

**Finding R4-4: The crank expiring due boosts before and after distribution.** `preExpires` (before) and `postExpires` (after) are both planned. The selftest arms cover both. ✓

**Finding R4-5: The alarm paging `boosts_stalled` and treating `cbob_mint` and boost bounds as fixed forever.** `mint.cbob_mint`, `mint.max_boost_weight`, `mint.max_boost_epochs` are all in the WATCH list at CRITICAL. ✓

## Target R5: The Swap and Revenue Cycle

**(a) Oracle math.**

`oracleFloor`: `sats = lamports * sol_price * 10^(es-eb) / (btc_price * 10)`.

With es = eb = -8: `e = 0`, so `num = lamports * sol.price`, `den = btc.price * 10`. `expectedSats = num / den` (BigInt floor).

Check: 2 SOL = 2e9 lamports. sol.price = 12045355552 (expo -8, so $120.45). btc.price = 8592910904675 (expo -8, so $85929.11).

num = 2e9 * 12045355552 = 2.4090711104e19
den = 8592910904675 * 10 = 8.592910904675e13
expectedSats = 2.4090711104e19 / 8.592910904675e13 = 280364... let me compute: 2.4090711104e19 / 8.592910904675e13 ≈ 280364.4...

Actually: 2 * 120.45355552 / 85929.10904675 * 1e8 = 240.90711104 / 85929.10904675 * 1e8 = 0.00280364... * 1e8 = 280364.x sats. The selftest asserts this within a sat of the float. ✓

Exponent handling for every sign: `e = sol.expo - btc.expo`. If e >= 0, `num *= 10^e`; else `den *= 10^(-e)`. Both feeds are expo -8 on mainnet, so e = 0. If Pyth changed exponents, the math still holds. ✓

Integer rounding: `expectedSats = num / den` floors (BigInt division truncates toward zero for positive). `minSats = expectedSats * (10000-150) / 10000` also floors. The floor is BELOW what an honest pool returns (after fees and impact, up to 150 bps). ✓

`satsPerLamport`: `Number(sol.price) * 10^sol.expo / (Number(btc.price) * 10^btc.expo) / 10`. This is a float used only for the deviation filter. With prices ~1.2e10 and 8.6e12, `Number(sol.price)` is exact (under 2^53), `10^-8` introduces float error but the deviation filter has 100 bps tolerance, so float error of ~1e-15 relative is irrelevant. ✓

Overflow in BigInt-to-Number: `satsPerLamport` uses `Number(sol.price)` — sol.price is ~1.2e10, well within Number precision. ✓

**(b) Pyth account verification.**

`readPyth`: checks owner is PYTH.receiver, verification level is Full (tag 1), feed id matches. The account is DERIVED: `pythAccount(feedHex)` = PDA([2-byte shard 0, feed id], PYTH.push).

Can anyone write a fully-verified update with an old publish_time or chosen price into that account? The account is owned by PYTH.receiver. Only the receiver program can write to it. The receiver program verifies Wormhole signatures from Pyth's publisher. So no — a stranger cannot write arbitrary data into a program-owned account.

BUT: the account ownership check is `acc.owner.equals(PYTH.receiver)`. If Pyth's receiver program were upgraded (by `6oXTdojyfDS8m5VtTaYB9xRCxpKGSvKJFndLUPV3V3wT`), the new version could write anything. This is accepted limit 10(d), watched by the alarm at HIGH.

The clock: `nowSec` comes from the Clock sysvar, read in the same `getMultipleAccountsInfo` batch. The Clock sysvar is written by the cluster, not by any single party. Trustworthy. ✓

`PriceUpdateV2` offsets: disc(8) + write_authority(32) = 40, then verification_level tag(1) at 40, then feed_id(32) at 41, then price(8) at 73, conf(8) at 81, expo(4) at 89, publish_time(8) at 93. The selftest's `pythAcc` fixture writes exactly these offsets and `readPyth` reads them. The fork test's `stamped` function writes `publishTime` at offset 93 (`d.writeBigInt64LE(chainNow - BigInt(age), 93)`). Consistent. ✓

**(c) Deviation filter.**

`orcaSpot`: `(sqrtPrice / 2^64)^2` in raw units. For a wSOL/cbBTC pool where token A is wSOL and token B is cbBTC, sqrt_price is sqrt(price of B in A) in raw units. So `(sqrtPrice/2^64)^2` = price of B (cbBTC) in A (wSOL) = cbBTC per wSOL. But we want sats per lamport = cbBTC base units per wSOL base unit. cbBTC has 8 decimals, wSOL has 9. So raw price * 10^8 / 10^9 = raw price / 10. The `satsPerLamport` in `oracleFloor` is `sol_usd / btc_usd / 10` — also dividing by 10. So both are in the same units (sats per lamport). ✓

Wait, let me be more careful. `orcaSpot` returns `(sqrtPrice / 2^64)^2` — this is the raw pool price, meaning token B amount per token A amount in BASE UNITS. Token A = wSOL (9 decimals), token B = cbBTC (8 decimals). So orcaSpot = cbBTC base units per wSOL base unit = sats per lamport. ✓

And `satsPerLamport` from the oracle: `sol_usd / btc_usd / 10`. sol_usd/btc_usd = BTC per SOL. Divided by 10: hmm. 1 SOL = $120.45, 1 BTC = $85929.11. $120.45/$85929.11 = 0.001402 BTC per SOL. In sats: 0.001402 * 1e8 = 140,200 sats per SOL. In lamports: 140,200 / 1e9 = 0.0001402 sats per lamport. So sats per lamport = (sol_usd / btc_usd) * 1e8 / 1e9 = (sol_usd / btc_usd) / 10. ✓

`meteoraSpot`: `1 / (1 + binStep/10000)^activeId`. The pair prices X in Y: (1+binStep/10000)^activeId = Y per X = lamports per sat. So the inverse is sats per lamport. ✓ (X = cbBTC, Y = wSOL, reversed from Orca — as stated.)

Floating point passing a pool it should refuse: the deviation is `Math.abs(pool - oracle) / oracle * 10000`. With 100 bps tolerance and float precision of ~1e-15, a pool at exactly 100.0000001 bps would pass due to float error. This is a boundary case of no practical significance — the pool at exactly the boundary is neither dangerous nor safe. ✓

**(d) Minimum out.**

Orca's `other_amount_threshold` at data offset 16 (u64). Meteora's `min_amount_out` at data offset 16 (u64). Both carry `minSats` from `oracleFloor`. The deviation filter uses `satsPerLamport` (a float), the floor uses `expectedSats` (BigInt). Both derive from the same oracle prices. The floor is 150 bps below expected; the filter is 100 bps from spot. These are DIFFERENT quantities (filter: pool vs oracle; floor: output vs oracle), as stated in SPEC. ✓

Units: Orca's threshold is in token B (cbBTC) base units = sats. Meteora's min_amount_out is in token X (cbBTC) base units = sats. Both are sats. ✓

**(e) The judge.**

`judgeSwapInstructions` requires the exact 7-instruction sequence. It checks:
- Programs allowed: ComputeBudget, System, TOKEN, ATA, venue. ✓
- Signers: only the operator. ✓
- No priority fee (setComputeUnitPrice refused). ✓
- Token instructions: only SyncNative (17) and CloseAccount (9). ✓
- Exact sequence: CU limit 400k, ATA create for own wSOL, System transfer of exactly lamportsIn to own wSOL, SyncNative, ATA create for own cbBTC, venue swap, close. ✓
- Swap data: amount = lamportsIn, threshold = minSats, Orca direction/price limit pinned. ✓
- Swap accounts: pool pinned, input = own wSOL, output = own cbBTC, signer = operator. ✓
- Close: own wSOL back to operator, once, last. ✓

What could a tampered builder still route past it? The judge lives in the same tree as the builder — whoever can edit one can edit both. This is accepted limit 10(c)/(3). The post-signing delta check in revenue.mjs catches misrouting after signing. ✓

ComputeBudget instructions: the judge checks `d[0] === 3` (setComputeUnitPrice) is refused, and instruction 0 must be setComputeUnitLimit(400000) with exactly 5 bytes of data. A `setLoadedAccountsDataSizeLimit` (d[0] === 2? no, that's the setComputeUnitLimit discriminator... let me check). ComputeBudgetProgram instructions: setComputeUnitLimit has discriminator 2, setComputeUnitPrice has 3, setLoadedAccountsDataSizeLimit has 1. The judge checks `data(cu)[0] !== 2` for instruction 0. For other ComputeBudget instructions, it checks `d[0] === 3` (priority fee). A `setLoadedAccountsDataSizeLimit` (d[0] === 1) appended would... let me check: the judge requires `ixs.length === 7`, so any appended instruction fails the count. ✓

**(f) Account derivation.**

Orca tick arrays: `orcaTickArrayStarts(tickCurrent, tickSpacing)` returns [s0, s0-span, s0-2*span] where span = 88 * tickSpacing. For a_to_b (selling A = wSOL), the price moves DOWN, so the tick moves down. The current array, then two below. ✓ (Matches Orca's published interface.)

At a tick-array boundary: `s0 = Math.floor(tickCurrent / span) * span`. If tickCurrent is exactly on a boundary, s0 = tickCurrent. The next array below is s0 - span. ✓

Uninitialised array: Orca's swap program will refuse if it needs to cross into an uninitialised tick array. The swap fails, nothing moves. ✓

Meteora bin arrays: `meteoraBinArrayIndexes(activeId)` returns [i, i+1, i+2] where i = floor(activeId / 70). For Y->X (buying X with Y), the active bin moves UP. The current array, then two above. ✓

Bitmap extension: `opt(mPda('bitmap', pool), bitmapExists)` — passed as the program id when absent (Anchor's "None"). ✓

`host_fee_in` as None: `opt(null, false)` — pubkey is METEORA.program (Anchor's None convention). ✓

Event authority: `mPda('__event_authority')`. ✓

Two token programs: both TOKEN (classic SPL). ✓

**(g) wSOL handling.**

Wrap exactly `lamportsIn`, sync, swap, close back. If the operator's wSOL ATA already exists holding a balance: `createAtaIdempotent` is a no-op, `SystemProgram.transfer` adds `lamportsIn` to the existing lamports, `syncNative` sets the token amount to the total lamports, the swap consumes `lamportsIn` (the amount in the instruction data), and `closeAccount` closes the whole account back to the operator — including any pre-existing balance. So a pre-existing balance is returned to the operator with the close. Nothing is lost. ✓

Frozen wSOL ATA: the swap would fail (Token program refuses transfers from frozen accounts). The cycle stays open. ✓

Delegate: the swap is a Transfer from the operator's own account signed by the operator as authority — a delegate doesn't interfere. The close requires the owner (operator) as signer. ✓

Created by someone else: the ATA is derived from (owner, TOKEN, mint) — it's the canonical ATA, same address whoever created it. ✓

Swap consumes less than input: the swap is exact-input (`lamportsIn` in, `minSats` out). Orca's swap consumes the full input. Meteora's swap with `amount_in` consumes the full input. The close returns any remaining wSOL (there shouldn't be any, but if the swap somehow left some, the close returns it). ✓

**(h) Failure and retry.**

Orca first; Meteora only if Orca was REFUSED. `classifySendFailure` distinguishes:
- `refused`: preflight refusal, landed-and-failed, expired-unlanded. Nothing moved. Next venue safe. ✓
- `landed`: confirmation failed but chain says it succeeded. Recorded, cycle continues. ✓
- `unknown`: anything else. Cycle stays open, no second swap. ✓

A confirmation timeout on a swap that later lands: `classifySendFailure` returns 'unknown' (no status yet), the cycle throws, `rememberAttempt` records `pendingSwapSig`. The next run refuses at the open-cycle guard. Hand recovery checks the signature. No double swap. ✓

Double count in the ledger: the cycle row is written once (intent before send), updated with `swapSig` on success. A refused venue doesn't write `swapSig`. ✓

Cycle read as closed: `cycleIsOpen` requires `returnedSats > 0 && (splitSig || splitByOther)`. A cycle with no return is open. ✓

Every path leaves the ledger open until a cbBTC return is proven: the return is recorded only after `requireTokenAmount` reads the operator's ATA and the delta check passes. ✓

**(i) Adversary extraction within tolerance.**

With a 100 bps deviation gate and a 150 bps floor:

A sandwich: the attacker pushes the pool price to exactly 100 bps from the oracle (the gate's edge), the swap executes at that price, and the output is 100 bps below the oracle's expected. The floor is 150 bps below expected, so the swap passes. The attacker extracts ~100 bps of the swap value. Per cycle (10 SOL cap), that's ~0.1 SOL ≈ $12 at $120/SOL. Per month (34 SOL/day * 30 = 1020 SOL), that's ~10.2 SOL ≈ $1,224. But a sandwich requires the attacker to hold inventory in the pool and take on inventory risk, and the 100 bps gate means the pool must be pushed to exactly the edge — a real sandwich on a $10M pool moving 10 SOL has impact far below 100 bps. The material extraction is bounded by the 150 bps floor: the WORST case is the output being 150 bps below the oracle's expected output, which is ~1.5% of the swap value. Per cycle: 0.15 SOL. Per month: ~15 SOL. This is the accepted tolerance.

A stale-but-accepted oracle (up to 180 s old): BTC moves ~0.5% in 3 minutes on a volatile day. The pool-agreement check (100 bps) would refuse a pool 100 bps from the STALE oracle, but if the true price moved 1.5% and the stale oracle hasn't caught up, the pool could be within 100 bps of the stale oracle while being 150+ bps from the true price. The floor is relative to the stale oracle, so the swap could execute 150 bps below the true price. This is bounded by the 180 s age + 100 bps gate + 150 bps floor ≈ 300 bps worst case vs the true price. Per cycle: 0.3 SOL. Per month: ~30 SOL. This is the accepted bound stated in SPEC ("These checks do not establish a hard bound on deviation from the true SOL/cbBTC market price").

A manipulated Meteora pool (~10x thinner): pushing a $0.9M pool 100 bps costs ~$900 of inventory. The swap is 10 SOL ≈ $1,200. The extraction is ~100 bps = $12. The cost is $900. Not profitable. ✓

**Operator key worst case:** the key is trusted with the SOL between sweep and return. The on-chain cap is 10 SOL per cooldown. The alarm's `sweep_unledgered_state` pages within one pass (30 min) of a sweep with no ledger row. The guardian can stop the sweep. The worst case is 10 SOL per 6-hour cooldown until the guardian acts — the same as before round 24, now bounded by the program's on-chain cap rather than an HTTP reply. ✓

**Ledger reading a failed cycle as closed:** `cycleIsOpen` with `sendRejected` returns false. A refused sweep moved nothing. A cycle whose sweep landed but swap failed: `sweptLamports > 0`, `returnedSats = 0` → open. ✓

## Target R6: The Gates

**Finding R6-1 (LOW): The round-24 section of the selftest claims every repair is armed in BOTH directions. I checked the C02 repair's arm:**

The R37 C02 arm ("R37 C02: a FROZEN pool still ticks and joins") drives `planCrank` with a frozen pool and asserts `distribute: true, kind: 'tick'`. The reverse direction (an unfrozen pool also ticks) is covered by the existing "nobody joined, vaults asked this epoch, the month due" arm. Both directions armed. ✓

**Finding R6-2: Assertions that cannot fail.** I checked several:
- The `HOST_FLOOR` count: the selftest runs `cargo test -p cbob-vault-mint --features localnet --lib` and floors at 6. The host tests in MINT's lib.rs include Anchor's generated `test_id` plus 5 written tests. If a test were deleted, the count would drop below 6 and fail. ✓
- The `FLOOR = 925` equality check: if the file throws after 2 assertions, `R.length` would be 2 ≠ 925, exit 1. ✓

**Finding R6-3: Floors satisfied by deleting work.** The equality floors (`===`) prevent this: deleting an assertion makes the count drop below the floor. ✓

**Finding R6-4: Checks that pass vacuously when input is empty.** The `every DAS reader in bank/ uses the shared judgement` check: `dasFiles` is discovered by grep, and the assertion `dasFiles.includes('alarm.mjs')` ensures the list is not empty. ✓

**Finding R6-5: `scripts/build-mainnet.sh` proves what it says for all five programs.** It builds all five, checks the sweep helper's byte identity three ways (dist vs localnet build vs target/deploy), and behaviourally asks the four keyed programs about the test key. The sweep helper has no key to ask about — its proof is the byte identity. ✓

**Finding R6-6: `scripts/cron-install.sh` arms nothing it should not.** The installer preserves `--live` only from tagged, uncommented lines matching the specific job. The selftest runs the actual preservation logic. ✓

## The Four Questions on Accepted Limits

**1. Is any limit WORSE than stated?**

I examined the accepted limits for exploitable gaps:

- **Limit 10 (swap operator):** The bound is now "10 SOL per 6-hour cooldown until the guardian stops it." With the hourly cron and the 7-hour effective cadence (round 37 C05), the actual rate is ~34 SOL/day. The holder guide says "up to 10 SOL of royalty money every 6 hours" — this is the on-chain bound, correct. The SPEC now says 34/day. Not worse than stated.

- **Limit 25 (re-roll):** The window is ~300 slots (~2 min). The crank's reveal lane runs every minute. A minter who wants a re-roll needs TOTAL silence for 2 minutes — no crank, no traffic with captures. The alarm pages `reveal_queue_stalled` if the queue doesn't move. Not worse than stated.

- **Limit 27 (claim between bare burn and retirement):** The crank retires burned vaults every pass (hourly). The window is at most one hour. Not worse than stated.

- **Limit 32 (rate limit):** The ring bounds the cap at 64, covering live supply up to 3,047. Above that the limit is stricter. Not worse.

- **Limit 46 (PoB hot key):** The full consequence is stated (end the project, capture governance). Not worse.

- **Limit 55 (unsplit revenue):** The crank splits every pass (hourly). The balance at stake is about an hour of sales. Not worse.

**2. Is anything listed as a limit not actually a limit?**

- **Limit 8 (cross-pass correlation lag):** The DAS diff and the signature walk both run every 30 minutes. The lag is at most one pass. The CRITICAL is a false alarm on a legitimate redemption, closed by hand. Still a limit (the false alarm exists).

- **Limit 9 (foreign nested asset):** The redeem page (item 50, built, staged) names foreign NFTs it can list. But it's not published, so the limit stands. Still a limit.

**3. Is any DISCHARGED item not actually discharged?**

- **Item 51 ($CBOB boost):** Built, measured, mirrored off chain. Discharged. ✓
- **Item 54 (compute):** Measured. Discharged. ✓
- **Item 14 (duplicate attributes):** Closed on chain. ✓
- **Item 19 (unlevelled-vault halt):** Closed by construction. ✓

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

- **Item 22 (live chain distribution):** Not started. Still OPEN. ✓
- **Item 38 (launch values):** `charter_opens_at`, `lock_deadline`, `vault_collection` still OPEN in mainnet-init.json. Still OPEN. ✓
- **Item 50 (holder surfaces):** Built and staged, not published. Still OPEN. ✓
- **Item 52 (pool/Squads accounts):** Not started. Still OPEN. ✓
- **Item 53 (dress rehearsal):** Not started. Still OPEN. ✓

## Additional Findings

**Finding A-1 (LOW): `revenue.mjs`'s `splitsSince` reads at most 10 pages of 1000 signatures.**

`splitsSince` pages through `getSignaturesForAddress(revAta, ...)` with `limit: 1000` and at most 10 pages. If more than 10,000 transactions touched the revenue ATA since `sinceSec`, older splits are missed. The comment says "an unread older split only leaves a cycle open, the loud direction." Correct — the cycle stays open and alarmed. Not a defect, just a bound. Already stated in the code comment.

**Finding A-2 (LOW): The alarm's `readConfigs` throws if `mint.pob_collection` is absent but `mint._missing` is not set.**

Looking at `readConfigs`: if MINT's config exists but `pob_collection` is the default pubkey (all zeros), then `new PublicKey(snap['mint.pob_collection'])` would create the default key, `getAccountInfo` returns null, and `snap['pob_collection.plugins_hash'] = 'ABSENT'`. This is a value, not a throw. The drift watch would page on a change from 'ABSENT'. Correct.

**Finding A-3 (INFO): `detectUnsweptRoyalties` uses `wallSec` (box clock) not `nowSec` (chain clock).**

In `alarm.mjs`: `nowSec: wallSec` is passed to `detectUnsweptRoyalties`. The box clock could drift from the chain clock. But the grace is 24 hours (or cooldown + 1 hour + 1 hour), so drift of seconds or minutes is irrelevant. Not a defect.

**Finding A-4 (LOW): The crank's `send` function catches errors and checks `BENIGN`, but `mintFailureCode` only extracts MINT's own Anchor errors. A CPI error from Core (e.g., during a reveal's UpdatePluginV1) would not match BENIGN and would be filed as a failure.**

This is correct behaviour — a Core CPI failure during a reveal IS a failure worth paging. The crank breaks the reveal loop on failure. ✓

**Finding A-5 (MEDIUM): The alarm's transaction scan walks FOUR programs (SEAL, MINT, BURN, GOV) but NOT the sweep helper.**

The sweep helper (`SWEEP`) is in `OURS` (for log-gap detection) but is NOT in the walk list: `for (const prog of [SEAL, MINT, BURN, GOV])`. The sweep helper is called through Core's ExecuteV1, so its transactions appear in CORE's signature history, not in a walk of the sweep helper's own address... wait, actually, transactions that invoke the sweep helper DO list the sweep helper's program id in their account keys, and `getSignaturesForAddress(SWEEP)` would return them.

But does anything need to scan the sweep helper's transactions? The sweep helper moves tokens from a vault to a redeemer. The alarm's detectors (approvals, PDA token accounts, burns) run on transactions from the four programs' walks. A redemption transaction touches SEAL, BURN, MINT (via CPI), and the sweep helper (via Core ExecuteV1). It would appear in SEAL's, BURN's, and MINT's walks. The sweep helper's own walk would add nothing new — the same transaction is already scanned.

Actually, wait: `getSignaturesForAddress` returns transactions where the address appears as a program id (invoked) OR as an account. A transaction that calls the sweep helper through Core's ExecuteV1 has the sweep helper as an invoked program (inner instruction). Would `getSignaturesForAddress(SWEEP)` return it? Yes — the RPC indexes transactions by all program ids that were invoked, including inner instructions.

But the redemption transaction already appears in SEAL's and BURN's walks (they're top-level programs in it). So scanning SWEEP's address would return a subset of what SEAL/BURN already return. No coverage gap. ✓

**Finding A-6 (LOW): `detectUnledgeredSweeps` reads the amount from instruction data at bytes 8-16 (u64 LE), but the sweep instruction's data is `disc(8) + u64(amount)`. The amount is at bytes 8-16. Correct.**

Wait, let me check: `d = ix.dataBytes`, `if (!sweepDiscriminator.every((b, i) => d[i] === b)) continue`. Then `for (let i = 7; i >= 0; i--) onchain = (onchain << 8n) | BigInt(d[8 + i])`. This reads bytes 8-15 as a u64 LE. The instruction data is `disc(8 bytes) + amount(u64 LE)` = 16 bytes. So `d.length >= 16` is checked. The amount is at bytes 8-15. ✓

**Finding A-7 (INFO): The `swap-fork.mjs` test's `stamped` function creates a stub connection that rewrites `publishTime` at offset 93. This matches `readPyth`'s offset. ✓**

## Summary of Findings

| ID | Severity | Finding |
|---|---|---|
| (none) | — | No CRITICAL, HIGH, or MEDIUM findings that survive measurement. |

All round-37 repairs verified. No new defects found that break correctness, move value incorrectly, or silence a dangerous state.

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What this project should do before launch that AI audit structurally cannot:

1. **Run the mainnet dress rehearsal (item 22) with a human watching.** The AI can read code and reason about it, but it cannot observe a live crank pass against 2,100 vaults and notice that it takes 40 minutes instead of 5, or that an RPC error on vault 1,900 of 2,100 leaves the pass in an unexpected state. A human watching the rehearsal output in real time catches operational issues (rate limits, error recovery, timing) that no static analysis can.

2. **Have Gary personally verify the four `initialize` transactions against `launch/mainnet-init.json` before signing.** The checker validates the JSON, not the signed transaction. A human must confirm the transaction arguments match the ruled values byte for byte. This is a one-time, 10-minute check that closes the gap between "the file is right" and "the chain is right."

3. **Exercise the hand recovery of an open revenue cycle with real money.** Item 22's named item 4: force a post-swap failure, walk through the hand recovery, confirm `--audit` is clean. The AI can read the runbook; only a human following it with real SOL on the line proves it works.

4. **Have a second person (not the box owner) review the alert router's behaviour during a rehearsal.** The alarm's delivery path (notify-gary-sms.sh, the router, the email/SMS) is the only channel through which a CRITICAL reaches a human. If the router is misconfigured, every detector is silent. A rehearsal with a deliberately-triggered CRITICAL, verified to arrive by SMS/email, closes this.

5. **Verify the deployed bytes on mainnet against `dist/SHA256SUMS` from a DIFFERENT machine.** The build script proves the bytes it built; only an independent read of the deployed program from the chain, hashed, and compared from a second machine closes the loop between "the build is right" and "the chain has the build."

6. **Have a holder (not the developer) walk through one full redemption on the rehearsal deployment.** The redeem page's UX — does the holder understand the tick-boxes, do they read the warning about destroyed tokens, does the transaction actually land — is a human-factors question no AI can answer.

7. **Confirm the $CBOB release wallet's key is in the backup AND that the backup is restorable.** The key is mode 600 on the box and "in the nightly R2 backup." Only an actual restore test proves the backup works.