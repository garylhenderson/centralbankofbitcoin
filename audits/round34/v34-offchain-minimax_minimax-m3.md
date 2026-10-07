# Round 34, Off-chain Pass: Audit of the Current Tree at HEAD

I'll work through your specific targets in order, starting with the prior verdict and proceeding through each numbered section. My job is to find surviving defects, not validate what already passed.

## R0. Round 33's Verdict and the Repairs That Follow

Round 33 found four confirmed findings (L1 LOW, D1-D3 INFO) and issued repairs in `82bb3ef`. I need to verify each repair actually fixes the original defect, and check whether the repair introduced new ones.

**Verifying L1 (the `detectSweepState` clock-mixing):**

Before repair, the detector compared MINT's `last_sweep_at` (chain clock) directly against `Date.parse(c.startedAt)` (box wall clock) — two different clock domains in one numeric comparison. The repair introduced a one-sided window `|t - start| <= cooldown/2` in the new logic.

The original problem: if a box clock is 3,700 seconds ahead of the chain, an honest sweep at chain time T+1 lands in a `detectSweepState` evaluation at box time T+1+3,700. The old code would see `t - st = 1 - 3,700 = -3,699`, which is far below any reasonable window, and page `sweep_unledgered_state` CRITICAL — a false alarm on a perfectly honest sweep.

The fix attempts to handle box-clock skew by allowing a window of `|t - start| <= cooldown/2` — for a 21,600-second cooldown, that is ±10,800 seconds, about 3 hours. But this is only one-sided for honest sweeps. For a thief's sweep, a thief's first legal sweep must wait a full cooldown after the honest one, so if the honest sweep landed at chain time T, the earliest the thief can sweep is T + cooldown. The window allows box-clock skew up to `cooldown/2 = 10,800` seconds. If the box clock is ahead by 10,801 seconds, a thief's sweep at chain time T + cooldown reads as `(T + cooldown) - (T + cooldown - 10,801) = 10,801 > 10,800` — paged correctly. If the box clock is ahead by exactly 10,800 seconds, the thief's sweep reads as exactly at the boundary — ambiguous.

More importantly: a CRITICAL page on an honest sweep is an urgent alert. A one-off `URGENT` finding with the pass time breaks through open router streams. If the box clock drifts by 3 hours (say, the box hasn't synced NTP in a week), every sweep for the entire duration is false-positive CRITICAL. The fix is a detection-side tolerance, not a page-suppression mechanism. The page text "if the revenue job crashed..." would fire continuously under a stale box clock, which is a different failure mode (sustained false CRITICAL) for the same root cause (clock skew).

A cleaner approach: the box clock should never be trusted. Convert the box `Date.parse(c.startedAt)` to a chain time using the same chain-clock-now value the walk uses, or remove the box clock entirely from the detector and use only chain-anchored values. The current repair says "tolerate box skew up to `cooldown/2`" but doesn't address the root cause: the box clock is not the chain clock.

**Verifying D2 (`mint.last_sweep_at` in `WATCHED_KEYS`):**

The original defect: `WATCHED_KEYS` is supposed to list every key the drift list and standing checks depend on, but `mint.last_sweep_at` was missing. A reader that drops this key would see "never swept" and be quiet. The repair adds it.

Looking at the actual list in `bank/detectors.mjs` lines 407-421, I can verify `mint.last_sweep_at` is now there. This is a correct fix. The new arm should also verify it's produced by the reader, which I can see it is via the `mint` struct decoded in `readPinned('MintConfig', ...)` in `bank/layout.mjs`.

**Verifying D3 (launch count reader pattern):**

The original pattern was `/(\d+) launch assertions\b/g` — requiring "launch assertions" as a phrase. SPEC's "Running the tests" block says "47 launch and 33 live-mainnet" — no "launch assertions" phrase, so the reader matched zero occurrences. The repair must have widened the pattern.

Looking at the selftest, I need to see what the actual pattern is now. From the selftest text I can see the pattern is checked in the "Running the tests" block. But without seeing the commit diff, I can't confirm the fix. The reviewer in round 33 noted a planted-stale arm passes both ways, which is what the self-test relies on. I need to verify this.

**My independent findings from the current tree, below.**

---

## R1. The Crank (`bank/crank.mjs`)

I need to read this carefully. The crank plans and sends permissionless calls. Every instruction is permissionless on-chain, but the crank's key pays fees and each reveal's Core attribute rent (~0.0001 SOL). Let me examine the planner for defects.

### R1.1: `budgetPlan` budget — a key "above the ceiling" can still be drawn down below the floor

Looking at `budgetPlan(plan, lamports, { ceiling, floor })`:

The function is supposed to:
1. Run the base plan (non-reveal actions) only when the balance covers it
2. Run reveals only as many as the balance allows, keeping the floor in reserve
3. Never spend the key below the floor

Let me trace through. The code does:
- Compute `base` cost (all non-reveal actions + fee for reveals' signatures, but NOT reveal attribute rent)
- Judge base with floor=0
- Compute `room = lamports - base - floor`
- Compute how many reveals fit in `room` at `(SIG_FEE + REVEAL_RENT)` each
- Return `{ plan, revealed: min(plan.reveal.length, n), dropped: ... }`

The base cost in `planCostLamports` includes `SIG_FEE_LAMPORTS` per reveal, so the base includes the signature fees for ALL reveals. The room calculation then subtracts the base AND the floor, and adds reveal attribute rent. So reveals are drawn down to `floor`.

But wait: the base already paid for the reveals' signature fees. If the key has exactly `floor + base + k*each` for some `k` reveals, the code says `n = k`, and it runs k reveals. The final balance is `floor - REVEAL_RENT_LAMPORTS`... no wait, let me re-read.

Actually the code computes `room = lamports - base - floor`, then `n = room / each`, where `each = SIG_FEE + REVEAL_RENT`. So `n * each <= room`, meaning `lamports - n*each >= base + floor`. And `base` includes `SIG_FEE * plan.reveal.length` (not REVEAL_RENT). So the actual cost is:

`actual = base + n * REVEAL_RENT = (total_txs + plan.reveal.length * SIG_FEE) + n * REVEAL_RENT`

Wait no, looking more carefully: `planCostLamports(base)` where `base.reveal = []` — so `base` excludes reveal attribute rent. The cost of `base` is `total_non_reveal_txs * SIG_FEE`. Then the room is computed as `lamports - base_cost - floor`, and each reveal costs `SIG_FEE + REVEAL_RENT`. But the `SIG_FEE` for the reveal was already counted in `base` (because `base_cost` was computed from `total_txs` which includes reveal txs). So there's a double-count?

Let me re-read `planCostLamports`:
```javascript
const txs = BigInt(p.reschedule.length + p.capture.length + p.reveal.length + ...)
  + ceil(p.preJoins.length, L.CLAIM_BATCH) + ceil(p.preExpires.length, L.EXPIRE_BATCH) + ceil(p.postExpires.length, L.EXPIRE_BATCH)
return txs * SIG_FEE_LAMPORTS + BigInt(p.reveal.length) * REVEAL_RENT_LAMPORTS
```

So `planCostLamports(p)` = `txs * SIG_FEE + reveals * REVEAL_RENT`.

And in `budgetPlan`, `base = { ...plan, reveal: [] }`. So `planCostLamports(base)` = `txs * SIG_FEE` (where txs still includes the reveal txs, since `base.reveal.length = 0` but the txs count uses `p.reveal.length` which is `0` for base). Wait, no — `base` is `{ ...plan, reveal: [] }`, so `p.reveal.length = 0` for base. So `planCostLamports(base)` = `total_non_reveal_txs * SIG_FEE` + `0`.

Now `room = lamports - base_cost - floor`, and each reveal costs `SIG_FEE + REVEAL_RENT`. So if I run `n` reveals, total cost = `base_cost + n * (SIG_FEE + REVEAL_RENT)`. 

The final balance = `lamports - base_cost - n * (SIG_FEE + REVEAL_RENT)`. Is this >= `floor`?

We need `lamports - base_cost - n * each >= floor`, i.e. `n * each <= lamports - base_cost - floor = room`. Since `n = floor(room / each)`, we have `n * each <= room`, so the final balance is >= floor. Correct.

But wait — is this what the code actually does? Let me re-read:

```javascript
const room = BigInt(lamports) - planCostLamports(base) - BigInt(floor)
const n = room > 0n ? Number(room / (SIG_FEE_LAMPORTS + REVEAL_RENT_LAMPORTS)) : 0
const keep = Math.max(0, Math.min(plan.reveal.length, n))
```

OK, so `n = floor(room / each)`, and `keep = min(plan.reveal.length, n)`. So the returned plan has at most `n` reveals. The cost is `planCostLamports(returned_plan)` = `base_cost + keep * REVEAL_RENT` (because `SIG_FEE` is in the txs count, and `keep` is the reveal count). 

Wait — but the base plan's txs count already includes `plan.reveal.length` transactions! No, let me re-check. In `budgetPlan`, the base plan is `{ ...plan, reveal: [] }`. The `planCostLamports` function counts `p.reveal.length` in `txs`. For the base plan, `p.reveal.length = 0`. So `txs` for base = all non-reveal txs only. So the base cost excludes the signature fees for reveals AND the reveal attribute rent.

So the room correctly allows `n` reveals at `SIG_FEE + REVEAL_RENT` each, and the final balance is >= `floor`. This is correct.

**BUT:** The `SIG_FEE_LAMPORTS = 5_000n`. For a large number of reveals (e.g., 100), the base plan's `txs` doesn't include these reveal signature fees at all. If the key has `floor + just_enough_for_base_without_reveals` lamports, the code refuses because `room = 0`. If it has `floor + base + one_each` lamports, the code allows one reveal. This is correct.

Hmm wait, let me re-check. In the `base` plan, `p.reveal = []`. So `p.reveal.length = 0`. So the txs count in `planCostLamports(base)` is:
```
reschedule + capture + 0 + retire + activate + claims + splits + preJoins + preExpires + postExpires
```
That's all non-reveal txs. So base_cost = `(non-reveal_txs) * SIG_FEE`. No reveal signature fees, no reveal attribute rent. Good.

Now: the original plan has `p.reveal.length` reveals. If we budget for `n` reveals, the actual cost is:
```
base_cost + n * (SIG_FEE + REVEAL_RENT)   (reveal txs: n * SIG_FEE for sig, n * REVEAL_RENT for rent)
```

And the room allows `n` reveals when `room >= n * each`. So the check is correct.

**This is correct.** No defect here.

### R1.2: `judgeFeePayer` — the `need` check uses base, not full plan

In the actual execution path (not the budgeting), `judgeFeePayer(lamports, { need })` is called with `need = planCostLamports(plan)`. This is the FULL plan cost, including all reveals' signature fees AND attribute rent. So the full plan must be affordable.

If the balance covers the full plan cost, great. If not, `judgeFeePayer` returns `ok: false` and the crank throws. The `budgetPlan` function is an *alternative* path: it runs the pass even when the full plan is unaffordable, dropping reveals. In the execution path, `budgetPlan` is called instead of `judgeFeePayer`:

```javascript
const fee = budgetPlan(plan, BigInt(await conn.getBalance(payer.publicKey, 'confirmed')))
if (!fee.ok) throw new Error(fee.why)
plan = fee.plan
```

So the crank always uses `budgetPlan`. If the balance is very low, the plan drops reveals (and possibly activates, distributes, etc.) and pages the dropped ones. This is the round 24 L6b fix.

But what about `need`? In `budgetPlan`, the `floor` check is against `planCostLamports(base)` with `floor=0`. So the `judgeFeePayer` check at the base level says: "key covers everything except reveals?" If yes, run with reduced reveals. If no, refuse entirely. The `why` returned is:

```javascript
if (!baseJ.ok) return { ok: false, plan, dropped: plan.reveal.length, warn: null,
  why: judgeFeePayer(lamports, { ceiling, floor, need: planCostLamports(plan) }).why };
```

This computes the full plan cost for the error message, which is correct.

**No defect in the budgeting logic itself.** The behavior is: either the key covers everything, or it covers everything-except-reveals and we drop some reveals, or it doesn't even cover non-reveals and we refuse.

### R1.3: The crank's fee-payer check uses a stale `plan` after budgeting

Wait — actually, looking at the execution more carefully:

```javascript
let plan = planCrank({...})
...
const fee = budgetPlan(plan, BigInt(await conn.getBalance(payer.publicKey, 'confirmed')))
if (!fee.ok) throw new Error(fee.why)
plan = fee.plan
```

So after budgeting, `plan` is the budgeted plan (with fewer reveals, or the full plan if affordable). Good.

But then, the execution sends transactions based on `plan`. Let me check the `send` function: it calls `sendAndConfirmTransaction`. If a transaction fails (e.g., a reveal's entropy is already captured by someone else, so `RevealAlreadySet` or similar), the catch handler checks if the error code is in `BENIGN`. If so, the send returns `'benign'`. If not, it returns `'fail'` and the failure is collected.

Now here's a subtle question: when the crank budgets down its reveals, what if one of the *non-reveal* actions fails? For example, a `claim` that fails because the pool is frozen. The crank's `BENIGN` regex includes `MonthNotElapsed`, `AlreadyRetired`, `AlreadyActive`, `VaultRetired`, `ActivationPending`, `RevealWindowExpired`, `NeedsReschedule`, `AlreadyRevealed`, `RevealTooEarly`, `RescheduleTooEarly`, `AlreadyCaptured`, `RevealOutOfOrder`, `NothingToSplit`.

But what about a `claim` that fails because the pool is frozen? The on-chain error would be... let me think. If the pool is frozen, a `claim` that pays would try to transfer from the pool to a vault, and the SPL Token transfer would fail because the pool is frozen. This would manifest as an SPL Token program error, not an Anchor error. So the crank's `mintFailureCode` would return null (no Anchor error found), and the send would return `'fail'`.

But the crank's code also has the `judgeDistributeRefusal` logic for `distribute` failures: if the distribution failed and `fresh` was re-read, and `fresh` shows `dist_epoch` or `last_distribute_at` moved, it's a benign race. Good.

For `claim` failures though, there's no such re-read logic. A claim that fails on chain because the pool is frozen would be counted as a 'fail', added to the `failures` array, and the heartbeat would carry the failure. The alarm's `detectCrankHealth` would then page `crank_failing` after 3 consecutive failures. This is *correct* behavior  a frozen pool is a real fault that should be alarmed.

But wait: the pool frozen detector already pages `pool_frozen` (from `detectPoolHealth` in `bank/detectors.mjs`). So the crank reporting a failure is redundant, not wrong. The crank is also doing the right thing: refusing to send claims while the pool is frozen, so the failures are *expected* (the crank shouldn't be sending them in the first place). Actually, re-reading the planner: the crank *does* check `pool.frozen` in `planCrank` and reports it as a problem, but it still plans the claims (it just notes the pool is frozen). Then in execution, these claims will fail.

**This is a real efficiency concern:** the crank plans claims it knows will fail, sends them, they fail, and the failure is paged. A better design would be to not plan claims when the pool is frozen. But is this a correctness defect? The crank does *eventually* realize the pool is frozen (via the failure), so the alarm pages `pool_frozen` and the crank pages `crank_failing`. The next pass, the planner again plans claims that will fail. This is a feedback loop of wasted fees (paying for transactions that will revert).

This is not a *correctness* defect — it doesn't lose value or mis-account. It's an *efficiency* defect: wasted fees on doomed transactions. A correct fix would have `planCrank` skip the claims batch when `pool.frozen`, and let the pool-frozen detector handle the alarm. But the crank's current behavior is: attempt, fail, alarm, try again, attempt, fail, alarm... — wasting fees every pass.

**I'll flag this as LOW efficiency, not a correctness defect.**

### R1.4: `mintedAttributes` failure ends the reveal run but not the whole pass

```javascript
try { list = await mintedAttributes(conn, P(r.asset)) }
catch (e) { console.log(`  skip reveal #${r.mint_index} ${r.asset}: could not read its attributes (${e.message}); next pass`); break }
```

If `mintedAttributes` throws (e.g., RPC timeout, network error), the reveal run breaks (via `break`), and the crank continues to the next instruction. The remaining reveals in the queue are not attempted this pass, but will be retried next pass. The comments say "ends this reveal run" — correct.

But what about the failure case? The `break` exits the for loop over `plan.reveal`. After that, the crank proceeds to `for (const a of plan.retireBurned)`, `for (let i = 0; i < plan.preJoins.length; ...)`, etc. These are not affected by the reveal failure. Good.

However, the comment says "One RPC blip used to abort the WHOLE pass from here, outside any try (round 23, L1): it ends this reveal run instead, and the next pass, a minute away, reads again." This is the documented behavior and it's correct.

**No defect.**

### R1.5: The crank's distribute `judgeDistributeRefusal` re-read — when `fresh` is null

```javascript
let fresh = null
try { fresh = L.readPinned('MintConfig', await conn.getAccountInfo(MINT_CFG, 'confirmed'), PublicKey) } catch { fresh = null }
if (judgeDistributeRefusal(lastFailure, cfg, fresh) === 'benign') ...
```

If the re-read throws (e.g., the RPC is down), `fresh` is `null`. Then `judgeDistributeRefusal` is called with `fresh = null`. Looking at the function:

```javascript
if (!DISTRIBUTE_RACE.test(m) || !planned || !fresh) return 'fail'
```

If `fresh` is null, the function returns `'fail'`. So a transient RPC error during the re-read results in a `'fail'` (not `'benign'`), and the distribute failure is added to the failures list. This is the safe direction (treat unknown as failed, not as benign). Good.

**No defect.**

### R1.6: `BENIGN` regex — does it miss any race codes?

```javascript
export const BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed|AlreadyRetired|AlreadyActive|VaultRetired|ActivationPending|RevealWindowExpired|NeedsReschedule|NothingToSplit/
```

Let me check against the program's error codes. From the MINT source, the errors include:
- `NotTheInitAuthority`
- `StopIsNewer`
- `NoPendingOperator`
- `OperatorNoticeNotElapsed`
- `WrongCollection`
- `WrongTreasury`
- `NoRound`
- `RoundClosed`
- `RoundCapReached`
- `BadWindow`
- `NameTooLong`
- `UriTooLong`
- `Overflow`
- `BadSealConfig`
- `WiringDiverged`
- `BadSupplyCap`
- `SupplyCapReached`
- `BadCap`
- `TooManyAttributes`
- `ReservedAttribute`
- `DuplicateAttribute`
- `BadSlotHashes`
- `LevelCapReached`
- `BadLevelCaps`
- `SealConfigVersion`
- `PriceAboveMax`
- `PriceBelowFloor`
- `SalesStopped`
- `SweepStopped`
- `NotTheGuardian`
- `NothingToDo`
- `NothingToSplit` ← in BENIGN
- `SweepAboveCap`
- `SweepTooSoon`
- `ReserveWouldBreach`
- `WrongPaymentMint`
- `CollectionNotOurs`
- `CollectionNotClean`
- `BadCharterWindow`
- `CharterNotOpen`
- `CharterClosed`
- `NotAProofOfBurn`
- `NotThePobOwner`
- `NotInPobSet`
- `PobProofTooLong`
- `AlreadyCaptured` ← in BENIGN
- `RevealTooEarly` ← in BENIGN
- `RevealWindowExpired` ← in BENIGN
- `AlreadyRevealed` ← in BENIGN
- `RevealOutOfOrder` ← in BENIGN
- `WrongAsset`
- `AttributesMismatch`
- `NeedsReschedule` ← in BENIGN
- `RescheduleTooEarly` ← in BENIGN
- `TooManyCranked`
- `VaultRetired` ← in BENIGN
- `AlreadyActive` ← in BENIGN
- `NotRevealed`
- `BelowActivation`
- `WrongVaultAccount`
- `VaultAccountMissing`
- `WrongPool`
- `NoActiveVaults`
- `MonthNotElapsed` ← in BENIGN
- `BadBurnAccounts`
- `WrongGaryMint`
- `InsufficientGary`
- `BadMonthlyPeriod`
- `PoolShort`
- `BadClaimList`
- `ClaimBeforeBurn`
- `NotFromBurn`
- `NotBurned`
- `AlreadyRetired` ← in BENIGN
- `BadVaultRecord`
- `NotALiveVault`
- `AttributesTooLarge`
- `BadNotice`
- `PaymentMintNotAReserve`
- `TightenOutOfBounds`
- `NoPendingGuardian`
- `GuardianNoticeNotElapsed`
- `ActivationPending` ← in BENIGN
- `BadPobExtra`
- `JoinWaitingFirst`
- `BoostsOff`
- `BoostNeedsActiveVault`
- `BoostActive`
- `WrongCbobMint`
- `InsufficientCbob`
- `BoostTermsOutOfBounds`
- `BoostNotDue`
- `BoostsExpireFirst`
- `BadBoostSetup`
- `BoostNotTheOwner`
- `BoostTermsMoved`

The BENIGN regex covers: `RevealTooEarly`, `AlreadyCaptured`, `AlreadyRevealed`, `RevealOutOfOrder`, `RescheduleTooEarly`, `MonthNotElapsed`, `AlreadyRetired`, `AlreadyActive`, `VaultRetired`, `ActivationPending`, `RevealWindowExpired`, `NeedsReschedule`, `NothingToSplit`.

Now the `claim` instruction in the crank handles these cases differently via `DISTRIBUTE_RACE` and `judgeDistributeRefusal`. But what about a `claim` that fails because of `PoolShort`? This would happen if the pool holds less than it owes (by the program's accounting). The crank's `claim` would fail, and this is NOT in `BENIGN`. The crank would count it as a 'fail' and add to the failures list. But `PoolShort` is a real fault (the pool is insolvent), so this is correct — it should be paged.

What about a `claim` that fails because of `BadClaimList`? This means the claim's remaining accounts are malformed. This is a real fault (the crank passed a bad list), so it should be paged. Correct.

**I don't see any missing benign codes. No defect.**

### R1.7: `mintedAttributes` — the selector for the instruction discriminator

The reveal instruction's discriminator is computed from `global:reveal_level`. The `attrsBorsh` function produces the Borsh serialization of `Vec<VaultAttribute>`. The `attrsHash` is `sha256` of those bytes.

The `judgeRevealAttrs` function:
1. If the hash matches → 'send'
2. If removing the 'level' attribute makes it match → 'revealed' (done elsewhere)
3. Otherwise → 'mismatch' (fault)

The `RevealLevel` struct in MINT checks `hashv(&[&attributes.try_to_vec()?])` against the stored hash. So the crank's `attrsBorsh` must produce the same bytes as `VaultAttribute.to_vec()`. The `VaultAttribute` struct in MINT is:

```rust
pub struct VaultAttribute { pub key: String, pub value: String }
```

And `to_vec()` for an `AnchorSerialize` type serializes the struct with Borsh. The `attrsBorsh` function on the JavaScript side constructs:

```
u32 LE count
  for each attribute:
    u32 LE key.length
    key bytes
    u32 LE value.length
    value bytes
```

This is the standard Borsh `Vec<Struct>` serialization where `Struct` has two `String` fields. The Rust `String` in Borsh is `u32 LE length + bytes`. So the serialization is:

```
u32 LE count (4 bytes)
  u32 LE key.len (4 bytes)
  key (key.len bytes)
  u32 LE value.len (4 bytes)
  value (value.len bytes)
```

This matches `attrsBorsh` in the crank. Good.

But wait — `AnchorSerialize` for `String` might use a different encoding. Let me check. In Borsh, `String` is `u32 LE len + bytes`. This is the same as `Vec<u8>`. Anchor's `AnchorSerialize` derives use Borsh by default. So `String` in a Borsh-serialized struct is `u32 LE len + bytes`. This matches.

**No defect in the serialization.**

But there's a subtle issue: `try_to_vec()` includes a Borsh `length prefix` for the top-level `Vec`. The `Vec<VaultAttribute>::to_vec()` returns `Vec<u8>` containing the serialized bytes, which includes the `u32 LE count` of the vector. The `attrsBorsh` function also starts with `u32 LE count`. So both sides produce the same prefix.

The `hashv` in MINT hashes the full `attributes.try_to_vec()?`, which includes the count prefix. The `attrsHash` in the crank hashes the `attrsBorsh(list)` output, which also includes the count prefix. So both hashes cover the same bytes. Good.

**No defect.**

### R1.8: `planCostLamports` — the `preJoins` batch ceiling

```javascript
const txs = BigInt(p.reschedule.length + p.capture.length + p.reveal.length + p.retireBurned.length + p.activate.length
  + p.claims.length + (p.split ? 1 : 0) + (p.distribute ? 1 : 0))
  + ceil(p.preJoins.length, L.CLAIM_BATCH) + ceil(p.preExpires.length, L.EXPIRE_BATCH) + ceil(p.postExpires.length, L.EXPIRE_BATCH)
```

`CLAIM_BATCH = 14`, `EXPIRE_BATCH = 20`. So `preJoins` are batched at 14 per transaction, and `preExpires` at 20 per transaction. This is the per-transaction cost.

But wait — `preJoins` are joined via `claim` instruction (with `crank_n > 0`): "The crank joins every eligible vault in the claims it sends right after each distribution." Looking at the execution:

```javascript
for (let i = 0; i < plan.preJoins.length; i += L.CLAIM_BATCH) { const pairs = plan.preJoins.slice(i, i + L.CLAIM_BATCH)
  await run(`join batch ${i / L.CLAIM_BATCH + 1} (${pairs.length})`, [new TransactionInstruction({
    programId: MINT, data: Buffer.concat([d('claim'), Buffer.from([0])]),
    keys: [W(MINT_CFG.toBase58()), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...pairs.flatMap(([rec, ata]) => [W(rec), W(ata)])] })]) }
```

So `preJoins` are sent as `claim` instructions with `crank_n > 0`, which means the first `crank_n + 1` remaining accounts are the SlotHashes + `crank_n` records. The remaining accounts are `(rec, ata)` pairs.

In the MINT `claim` instruction handler, it checks `crank_n`, then calls `crank(rem[..k], slot)`, then processes `pairs = rem[k..]` as claim pairs. The pairs are exactly `(rec, ata)` pairs. So a `join` is just a `claim` with `0` amount per pair (no payout), and the crank's pre-joins are the pre-pair records.

Now, the `preJoins` are sent as `claim` instructions in batches of 14. But the `crank` inside the instruction takes the first `crank_n + 1` accounts. If `crank_n = 4` and the batch has 14 pairs, the crank gets 4 records and 14 pairs. The pairs are processed as 14 `(rec, ata)` join attempts.

Wait, let me re-read the crank function. In the claim handler:
```rust
let rem = ctx.remaining_accounts;
let k = if crank_n == 0 { 0 } else { crank_n as usize + 1 };
require!(rem.len() >= k, MintError::BadClaimList);
crank(&rem[..k], Clock::get()?.slot)?;
let pairs = &rem[k..];
```

So `crank` takes accounts `rem[0..k]` (SlotHashes + `crank_n` records), and `pairs` is `rem[k..]`. The `pairs.len()` must be even (pairs of `(rec, ata)`). Each pair is a join or claim.

So when the crank sends a batch of 14 preJoins, it passes `SlotHashes + 4 crank records + 14 pairs = 19 accounts`. The `crank` inside the instruction processes 4 records, then the `pairs` loop processes 14 pairs. Each pair is a join (amount = 0, just sets the vault's `active = true` and updates the accumulator).

But the `planCostLamports` computes `ceil(preJoins.length, 14)` transactions. So for 14 preJoins, it's 1 transaction. For 15, it's 2. The transaction fee is 5,000 lamports. This is the fee for sending the transaction, which is correct.

But what about the *accounts*? A transaction with 19 accounts and 1 instruction fits within Solana's transaction size limit (1232 bytes for legacy, larger for v0/v1). Let me estimate: 19 accounts * 32 bytes (pubkey) = 608 bytes, plus instruction data (~10 bytes), plus signatures (1 * 64 bytes = 64 bytes). Total: ~682 bytes. Well under 1232.

But what if the crank has 14 preJoins AND 4 crank records? That's 1 + 4 + 14 = 19 accounts. 1 transaction, fits.

What if preJoins is 28? 2 transactions, each with 19 accounts. 2 * 5000 = 10000 lamports in fees.

But wait — `preJoins` can be up to `pending_count` (all waiting vaults). In a launch scenario, this could be 240. 240 / 14 = 18 transactions. 18 * 19 = 342 accounts across 18 transactions. This is fine.

**No defect in the batching.**

### R1.9: `planCrank` — `boosts_due` check for the monthly run

Looking at `monthly_inline`:
```rust
if c.boosts_due > 0 {
    msg!("CBOB_MONTHLY_WAITS_FOR_BOOSTS due={}", c.boosts_due);
    return Ok(());
}
```

If there are due boosts, the monthly run waits. The crank is supposed to expire them before distributing:

```javascript
await expire('before', plan.preExpires)
...
if (plan.distribute) await expire('after', plan.postExpires)
```

But what if `expire_boosts` is rate-limited or fails? The pre-expires are in `plan.preExpires`, batched at `EXPIRE_BATCH = 20` per transaction. If there are 60 due boosts, that's 3 transactions. If one fails (e.g., a record was already retired by someone else), the `expire_boosts` handler skips retired/inactive/no-boost/not-due records. So it should succeed.

But what if the crank's `expire_boosts` call fails for a different reason (e.g., the instruction itself fails because of `BadClaimList`)? Looking at the expire instruction:

```rust
require!(!rem.is_empty() && rem.len() <= MAX_EXPIRE_BATCH, MintError::BadClaimList);
```

`MAX_EXPIRE_BATCH = 30`. The crank batches at 20, so 20 < 30. Good.

What if the RPC call to send the expire transaction times out? The send retries (web3.js default behavior). If it ultimately fails, the `expire_boosts` instruction is not executed, and `boosts_due` remains > 0. The next attempt to distribute (either by the crank or by traffic) will also hit `BoostsExpireFirst`.

This is a stall scenario: if expire_boosts consistently fails, the monthly distribution is permanently blocked. The crank's failures list would include the expire_boosts failures, and the alarm's `crank_failing` would page after 3 consecutive failures. But the page is HIGH, not URGENT. The fix would be to have `monthly_inline` expire boosts inline (it doesn't — it just waits). Or to have the crank's expire batch be smaller so individual failures don't block the whole batch.

Actually, looking more carefully: each batch of `expire_boosts` processes up to `MAX_EXPIRE_BATCH = 30` records. The crank sends 20 per batch. If one record in the batch causes the instruction to fail (e.g., the record was already mutated by someone else), the *entire* batch fails. The `expire_boosts` handler in MINT:

```rust
for ri in rem.iter() {
    ...
    if r.retired || !r.active || r.boost_weight == 0 || ctx.accounts.config.dist_epoch < r.boost_end_epoch {
        continue;
    }
    expire_boost(&mut ctx.accounts.config, &mut r)?;
    store_record(ri, &r)?;
    n += 1;
}
```

The handler *skips* records that are retired, inactive, no-boost, or not-due. It only fails if `expire_boost` itself returns an error, which would be from the program logic (e.g., `BoostNotDue`). But the check `c.dist_epoch >= r.boost_end_epoch` is before `expire_boost`, so `BoostNotDue` can't be triggered. The `unschedule_boost` function:

```rust
if c.dist_epoch >= r.boost_end_epoch {
    c.boosts_due = c.boosts_due.checked_sub(1).ok_or(MintError::Overflow)?;
} else {
    ...
}
```

This could underflow if `boosts_due` is 0 and the boost is somehow due. But the check `c.dist_epoch < r.boost_end_epoch` should prevent this. If a boost is already expired (boosts_due was already decremented), then `c.dist_epoch >= r.boost_end_epoch` and we try to subtract 1 from 0 → overflow. But the outer check should have already filtered this: `if r.retired || !r.active || r.boost_weight == 0 || ctx.accounts.config.dist_epoch < r.boost_end_epoch { continue; }` — this only skips if `dist_epoch < r.boost_end_epoch`, not if `dist_epoch >= r.boost_end_epoch AND boosts_due == 0`.

Wait, this is a potential issue. If a boost was already expired (say, by another crank run that succeeded first), then `r.boost_end_epoch <= c.dist_epoch` but `r.boost_weight == 0` (because expire_boost sets it to 0). So the `r.boost_weight == 0` check would skip it. Good.

But what if the boost was partially expired (e.g., `r.boost_weight > 0` but `c.boosts_due == 0` because it was already decremented by a previous run)? In that case, `unschedule_boost` would try to subtract 1 from 0 and overflow. This is a possible issue, but it requires a specific race condition (two runs processing the same boost simultaneously). Solana's transaction ordering should prevent this — only one transaction can modify a given account at a time.

OK, this is getting into deep program details. Let me focus on what the off-chain code does.

**The crank's expire_boosts call could fail if the RPC is down, but the next pass would retry. No permanent stall from the crank's logic itself.**

**No defect in the crank's expiration handling.**

### R1.10: `planCrank` — `boosts_active` decrement on early retirement

When a bare-burned vault with a boost is retired:

```rust
if r.boost_weight > 0 { unschedule_boost(c, r)?; }
```

And `unschedule_boost`:
```rust
if c.dist_epoch >= r.boost_end_epoch {
    c.boosts_due = c.boosts_due.checked_sub(1).ok_or(...)?;
} else {
    let i = (r.boost_end_epoch % BOOST_RING as u64) as usize;
    c.boost_expiring[i] = c.boost_expiring[i].checked_sub(1).ok_or(...)?;
}
c.boosts_active = c.boosts_active.checked_sub(1).ok_or(...)?;
c.boost_weight_total = c.boost_weight_total.checked_sub(r.boost_weight as u64).ok_or(...)?;
```

If a boost was already due (`c.dist_epoch >= r.boost_end_epoch`) and `c.boosts_due` is already 0, this would underflow. But the outer condition `r.boost_weight > 0` should prevent this — a boost with `boost_weight > 0` is still live, meaning `c.boosts_due` hasn't been decremented yet (or the boost was due and `c.boosts_due > 0`).

But what if the boost was partially processed? E.g., `boosts_due` was decremented to 0, but `r.boost_weight` is still > 0 because the record was loaded before the `boosts_due` decrement? This would require the expire_boosts instruction to have failed mid-execution. Solana transactions are atomic, so this can't happen. The record is only written after `unschedule_boost` succeeds.

**No defect.**

### R1.11: The `activate` planner — missing records for already-active vaults

Looking at the crank's `activate` planner:

```javascript
for (const r of records) {
    if (r.level === 0 || r.active || r.pending || r.retired || assets[r.asset] !== 'live') continue
    const t = tokens[r.asset]
    if (!t || t.state !== 'ok') continue
    if (BigInt(t.amount) >= L.ACTIVATION_SATS) plan.activate.push(r.address)
}
```

This skips already-active vaults (`r.active`), already-pending vaults (`r.pending`), retired vaults, burned vaults, and non-live assets. It also checks the token balance >= 21,000 sats.

But what about a vault that was activated in a previous pass but the crank's read of `r.active` is stale? The crank reads all records and then plans based on the current state. Since the crank reads the records right before planning, the state should be current. But there could be a race: between the crank's record read and the activation instruction, someone else could activate the vault. The on-chain `activate` handler would then refuse with `AlreadyActive`, which is in `BENIGN`. Good.

**No defect.**

### R1.12: The `claim` planner — frozen accounts

```javascript
if (t.frozen) { plan.deferredFrozen.push({ asset: r.asset, owed }); continue }
```

The crank defers frozen accounts and continues with the rest. The deferred ones are reported via `plan.deferredFrozen` and logged. The on-chain `claim` handler:

```rust
if d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN {
    msg!("CBOB_CLAIM_DEFERRED_FROZEN asset={} owed_sats={}", r.asset, pay);
    emit!(ClaimDeferred { asset: r.asset, owed: pay });
    n_deferred += 1;
    ...
    continue;
}
```

So the on-chain side also defers. Good.

But what about the crank's `tokens` object — how is it read? In the main function:

```javascript
const tok = (amount, o = {}) => ({ state: 'ok', amount, frozen: false, address: 'x', ...o })
```

This is the mock for the selftest. In the real main function:

```javascript
const tokens = {}
records.forEach((r, i) => {
    const info = tokInfos[i], t = readTokenAccount(info)
    tokens[r.asset] = { ...t, address: tokenAddr(r), frozen: t.state === 'ok' && info.data.length > L.TOKEN_STATE_OFF && info.data[L.TOKEN_STATE_OFF] === L.TOKEN_STATE_FROZEN }
})
```

So the crank reads the token account's state byte (offset 108) to determine if it's frozen. The `TOKEN_STATE_FROZEN = 2`. If the state byte is 2, the account is frozen. This is correct.

**No defect.**

### R1.13: The `claim` planner — checking that the recorded ATA matches the token account

```javascript
if (!t || t.state !== 'ok' || t.address !== r.vault_ata) {
    plan.problems.push(`vault ${r.asset} is owed ${owed} sats but its recorded cbBTC account ${r.vault_ata} is ${t ? t.state : 'unread'}; a claim never creates one, so it was left out of every batch`)
    continue
}
```

The crank checks that the token account it's reading matches the recorded `vault_ata` in the vault record. If the addresses differ, the vault is left out of the batch and a problem is reported. This is the round 23 fix.

But what if the recorded `vault_ata` is correct but the token account has a different mint? The `readTokenAccount` function only checks the owner (SPL Token), not the mint. If the recorded ATA is for a different mint, the crank would happily include it in a claim batch, and the on-chain `claim` handler would try to transfer from the pool. The pool is for cbBTC, so a transfer of a different token would fail.

Looking at the on-chain side:

```rust
require_keys_eq!(ctx.accounts.pool_token.key(), ctx.accounts.config.pool_ata, MintError::WrongPool);
```

The pool is checked, but not the destination's mint. The `claim` handler transfers from the pool to the destination:

```rust
invoke_signed(&Instruction {
    program_id: SPL_TOKEN_ID,
    accounts: vec![
        AccountMeta::new(ctx.accounts.pool_token.key(), false),
        AccountMeta::new(dest.key(), false),
        AccountMeta::new_readonly(ctx.accounts.config.key(), true),
    ],
    data,
}, ...)
```

The SPL Token `Transfer` instruction just moves tokens from source to destination. It doesn't check the mint — the mint is determined by the token account. The pool's token account is for cbBTC. The destination is the vault's recorded ATA. If the vault's ATA is for a different mint, the transfer would move cbBTC to that ATA. But the ATA is for a different mint, so the cbBTC would just sit there (or the transfer would fail if the ATA doesn't exist or isn't owned by the right program).

Actually, an ATA for a different mint than the pool's token would be a different account. The `claim` handler doesn't check the mint of the destination. It just transfers from the pool (cbBTC) to the destination. If the destination is a token account for, say, USDC, the transfer would add cbBTC to a USDC account. The USDC account's balance for cbBTC would increase, but the ATA would be for the wrong mint. The transfer would succeed (SPL Token doesn't check the mint), but the cbBTC would be effectively stuck (no instruction moves cbBTC from a USDC ATA).

This is a very unlikely scenario (a vault's recorded ATA would be for cbBTC, since `activate` records `vault_ata` as the ATA for the payment mint), but the crank doesn't verify this. The on-chain side also doesn't verify it. If a vault somehow had its `vault_ata` set to a non-cbBTC ATA, the crank would include it in a claim batch, and the on-chain claim would send cbBTC to the wrong ATA.

**This is not really a defect** because `activate` always sets `vault_ata` to the ATA for the payment mint (cbBTC). The crank trusts this invariant. The on-chain `claim` doesn't verify the mint, but the invariant is maintained by `activate`.

**No defect in practice, but a minor invariant violation: the on-chain `claim` doesn't verify the destination is for the correct mint. The crank doesn't either. This is a trust-the-activate invariant.**

### R1.14: The crank's ledger and the revenue cycle

The crank's only interaction with the revenue cycle is through `monthly_inline` and the pool's frozen/unreadable checks. The crank itself doesn't send revenue transactions — that's `bank/revenue.mjs`'s job.

But the crank *does* read the pool account (`pool.frozen`, `pool.unreadable`). If the pool is unreadable (e.g., not yet created), the crank would report it and skip claims. This is correct.

**No defect in the crank's interaction with the revenue cycle.**

### R1.15: Summary of the crank

I found no correctness defects in the crank's logic. The main issues are:
1. The L1 sweep state clock-mixing is partially addressed but the root cause (box clock vs chain clock) isn't fully fixed.
2. The crank plans claims when the pool is frozen, wasting fees on doomed transactions. This is an efficiency issue, not a correctness defect.
3. The `claim` doesn't verify the destination mint, relying on the `activate` invariant. This is a trust assumption, not a defect.

---

## R2. The Alarm (`bank/alarm.mjs`, `bank/detectors.mjs`)

### R2.1: `crankPosture` — the crontab read failure handling

```javascript
export function crankPosture(read) {
  if (!read) return 'unreadable'
  if (read.error) return /no crontab for/i.test(String(read.error.stderr ?? '')) ? 'dry' : 'unreadable'
  return crankArmed(read.text) ? 'armed' : 'dry'
}
```

If `read` is null/undefined, returns 'unreadable'. If `read.error` exists, checks for "no crontab for" → 'dry', else 'unreadable'. If `read.text` exists, checks if the crontab is armed.

But what if `read` has both `error` and `text`? The code returns based on `error` first. This is correct.

What if `read.text` is an empty string? `crankArmed('')` returns false → 'dry'. This is correct (no armed line).

What if `read.text` is undefined but no `error`? `crankArmed(undefined)` — let me check `crankArmed`:

```javascript
export function crankArmed(crontab) {
  return String(crontab || '').split('\n').some(l => 
    !/^\s*#/.test(l) && 
    /#cbob-vault-cron crank\s*$/.test(l) && 
    !/--reveal-only/.test(l) && 
    /\bbank\/crank\.mjs --live\b/.test(l)
  )
}
```

`String(undefined || '')` = `String('')` = `''`. `.split('\n')` = `['']`. The test: `!/^\s*#/.test('')` is true (empty string is not a comment). `/...crank\s*$/.test('')` is false (no match). So it returns false. Correct.

**No defect.**

### R2.2: `detectCrankPosture` — the `unreadable` state

```javascript
export function detectCrankPosture({ posture, prevArmedSince = null, nowSec }) {
  if (posture === 'armed') return { live: true, armedSince: prevArmedSince ?? nowSec, findings: [] }
  if (posture === 'dry') return { live: false, armedSince: null, findings: [] }
  return { live: prevArmedSince !== null && prevArmedSince !== undefined, armedSince: prevArmedSince ?? null,
    findings: [{ kind: 'crank_posture_unreadable', severity: S.HIGH, ... }] }
}
```

If posture is 'unreadable' and there was a previous armed-since, `live` is true and a HIGH finding is emitted. The `live: true` means the silence check still runs against the old armed-since. This is the round 24 L4a fix.

But what if posture is 'unreadable' and there was NO previous armed-since (first pass)? `live` is false, `armedSince` is null. The findings include a HIGH page for unreadable crontab. On the next pass, if the crontab is still unreadable, it pages again. If the crontab becomes readable and is 'dry', the live state is false, so the silence check doesn't run. This is correct.

**No defect.**

### R2.3: `detectCrankSilent` — heartbeat staleness

```javascript
export function detectCrankSilent({ stampSec = null, live, armedSinceSec = null, nowSec, maxAgeSecs = 3 * 3600 }) {
  if (!live) return []
  const last = [stampSec, armedSinceSec].filter(v => v !== null && v !== undefined)
    .reduce((a, b) => (b > a ? b : a), null)
  const ref = last ?? nowSec
  if (BigInt(nowSec) - BigInt(ref) <= BigInt(maxAgeSecs)) return []
  return [{ kind: 'crank_silent', severity: S.HIGH, ... }]
}
```

Uses `maxAgeSecs = 10800` (3 hours). If the heartbeat is older than 3 hours AND the crank is armed, page HIGH.

But the round 33 L1 fix says the heartbeat carries the pass's failures and problems, and `crank_failing` / `crank_problem` are separate detectors. The `crank_silent` check is for the heartbeat being stale, not for the crank having failures. A crank that runs but always fails (e.g., pool is frozen) would have a fresh heartbeat, so `crank_silent` wouldn't fire, but `crank_failing` would.

The 3-hour threshold is for the every-hour full pass. If the hourly pass takes >3 hours, this would fire even on a healthy crank. But a healthy hourly pass should complete in minutes, not hours. So 3 hours is a reasonable threshold.

**No defect.**

### R2.4: `detectSweepState` — the new window and the cooldown seen

The round 33 fix: `|t - start| <= cooldown/2`, and the cooldown used is the smallest ever seen (`cooldownSeen`), capped at 21600 (6 hours).

But what if a vote extends the cooldown to 86400 (24 hours, the maximum)? The alarm stores `cooldownSeen: min(prev, 86400)`. On the first pass after the vote, `cooldownSeen` = 86400. The window becomes `|t - start| <= 43200` (12 hours). A thief's sweep at chain time T + 86400 (the new cooldown) reads as `86400 - start_time`. If the start time is within the 12-hour window, it would be considered "explained" and not paged.

Wait, let me think more carefully. The `cycleStartMs` function:

```javascript
const at = Number(hit.blockTime) * 1000
return Number.isFinite(at) && at > 0 && at <= chainNowMs ? nowMs - (chainNowMs - at) : -Infinity
```

So the cycle's start is `nowMs - (chainNowMs - sweepBlockTime)`, which converts the sweep's block time to wall-clock time. If the chain clock is ahead of the wall clock, this is negative, and `cycleStartMs` returns `-Infinity`.

Then the `detectSweepState` check: `|t - st| <= half`, where `t` is `lastSweepAt` (chain time) and `st` is `cycleStartMs` (wall time). If `st` is `-Infinity` (chain ahead of wall), the check becomes `|t - (-Infinity)| <= half` which is always false. So a honest sweep with a chain-ahead-of-wall box would be paged as unledgered.

Wait, but the half is `floor(cooldownSecs / 2)`. If `cooldownSecs` is 21600 (the smallest seen), half is 10800. If `t` is 0 (just swept) and `st` is `-Infinity`, then `|0 - (-Infinity)| = Infinity > 10800`, so it's paged. But if the chain is only 1 second ahead of the wall, `st` would be about `-1000` (in ms), and `|t - (-1000)| = t + 1000`, which for a sweep at chain time 0 is 1000 ms, well within 10800. So it would be considered explained.

But the box clock being 1 second ahead of the chain means the wall time is about chain time + 1 second. The sweep's block time is chain time T. The wall time is about T + 1. The cycle's start is recorded as `new Date()` (wall time), so the start is about T + 1 + 1 = T + 2 (approximately). The check `|t - st| <= half` becomes `|T - (T+2)| = 2 <= 10800`. So it works for small skew.

For a 12-hour box-clock-ahead (cooldown = 86400, half = 43200), a sweep at chain time T would be explained if the cycle start (wall time T + 12 hours) is within 12 hours of T. Since the start is exactly T + 12 hours, the check is `|T - (T + 12*3600)| = 43200 = half`, which passes. Good.

For a 12-hour box-clock-behind (chain is 12 hours ahead of wall), the cycle's start (wall time T - 12 hours) would be negative in chain time. The check becomes `|T - (T - 12*3600)| = 43200 = half`, which also passes. Good.

So the window handles box-clock skew up to `cooldown/2`. For a 6-hour cooldown, this is 3 hours. For a 24-hour cooldown, this is 12 hours.

But what if the box clock is wrong by more than `cooldown/2`? E.g., the cooldown is 6 hours and the box clock is 4 hours ahead. A sweep at chain time T with the cycle started at wall time T + 4 hours would have `st = T + 4*3600`. The check: `|T - (T + 14400)| = 14400 > 10800 (half of 6h cooldown)`. So the honest sweep would be paged as unledgered. This is a false CRITICAL.

The round 33 L1 fix says "box clock skew of minutes (or an hour) cannot page an honest sweep". For a 6-hour cooldown, 3 hours of skew is tolerated. For larger skew, a false CRITICAL fires. The root cause (box clock vs chain clock) is not fully fixed; the tolerance is `cooldown/2`.

**This is the L1 finding from round 33, confirmed.** The repair is partial — it adds tolerance, but the root cause remains.

### R2.5: `detectFrozenVaultAccount` and `FROZEN_KINDS`

```javascript
export const FROZEN_KINDS = new Set(['pool_frozen', 'vault_account_frozen', 'revenue_account_frozen'])
export function applyFrozenTransitions(findings, prevFrozen = []) {
  const before = new Set(prevFrozen || [])
  const frozen = []
  const out = (findings || []).map(f => {
    if (!FROZEN_KINDS.has(f.kind)) return f
    const key = `${f.kind}:${f.asset ?? ''}:${f.mint ?? ''}`
    frozen.push(key)
    if (before.has(key)) return { ...f, severity: S.INFO, urgent: false, ... }
    return { ...f, urgent: true }
  })
  return { findings: out, frozen }
}
```

A freeze is `urgent: true` on the first pass it appears, and `severity: INFO` on subsequent passes. The `frozen` list is the set of frozen keys (kind:asset:mint) at this pass. The caller stores this as the baseline for the next pass.

But what about a freeze that ends? If a freeze was in `prevFrozen` but is not in the current pass's `frozen` set, it's simply not in the output findings (the `before.has(key)` check only fires if the current finding is in `FROZEN_KINDS`). So a thawed freeze doesn't appear in the output, and the `prevFrozen` for the next pass won't include it. Good.

But the text of a thawed freeze is never emitted. If a freeze was active for 3 passes and then thaws, the alarm sends 1 URGENT page (first pass) and 2 INFO pages (subsequent passes), and then the thaw is silent. The text of the INFO pages says "STILL frozen". When it thaws, there's no page saying "thawed". This might be fine (no action needed on thaw), or it might be a gap (no confirmation that the freeze ended).

The round 24 I5 finding is that a freeze is "news once" — it pages when it happens, stands at INFO while it lasts, and silently ends. The current code implements this.

**No defect, but a minor gap: a thawed freeze is not confirmed. This is by design (I5) but could be worth noting.**

### R2.6: `detectSplitClaims` — the `closesCycle` anchor

`closesCycle(c, splits, { exclude, upTo })` finds a split that:
1. Is not in the `exclude` set
2. Has a block time >= the return's block time (or 60s before `returnedAt` if no block time)
3. Has a block time <= `upTo` (if provided)
4. Has a total >= the return's amount

This is the round 25 I1 fix: the split must be as large as the return.

But what if the split is larger than the return but a *partial* return? The crank returns the full ATA balance (`got`) but only records the delta (`delta`). If a stranger deposits cbBTC between the swap and the return, the delta is smaller than the actual return, and the split moves a larger amount. The anchor would fail (split total > return amount, but return is the delta, not the full amount).

Wait, the anchor requires `split total >= return amount`. If the return amount is `delta` (what the cycle produced) and the split is `got` (the full ATA balance), then `got > delta` if someone deposited. The anchor passes. The cycle is closed. But the split actually moved `got`, not `delta`, so the cycle should be responsible for `got`, not `delta`. This is correct: the cycle's `returnedSats` is `delta`, and the split anchor requires `split total >= delta`. If `got > delta`, the anchor passes and `delta` is the amount the cycle produced. The remaining `got - delta` came from a stranger's deposit and is not the cycle's responsibility.

Actually, looking at the code: `cycle.returnedSats = delta`, and the anchor is `split total >= returnedSats`. So the anchor checks if the split is at least as large as the return. If the return is `delta` and the split is `got`, and `got > delta`, the anchor passes. The cycle is closed with `returnedSats = delta`. This is correct.

**No defect.**

### R2.7: `revenueOutflow` — reading from the revenue ATA

```javascript
export function revenueOutflow(ixs, revenueAta) {
  let total = 0n
  for (const ix of ixs || []) {
    if (ix.program !== D.TOKEN_ID && ix.program !== D.TOKEN22_ID) continue
    const t = ix.parsed?.type
    if (t !== 'transfer' && t !== 'transferChecked') continue
    const info = ix.parsed?.info || {}
    if (info.source !== revenueAta) continue
    const amt = info.amount ?? info.tokenAmount?.amount
    try { total += BigInt(amt) } catch { /* unparsed amount: under-reads, see above */ }
  }
  return total
}
```

This sums up all transfers where the source is the revenue ATA. If someone deposits cbBTC into the revenue ATA, the deposit is a transfer TO the revenue ATA (not FROM it), so it's not counted. If someone transfers FROM the revenue ATA, it's counted. Good.

But what about a `transferChecked` where `info.source` is the revenue ATA but the `amount` is in `info.tokenAmount.amount`? The code checks both: `info.amount ?? info.tokenAmount?.amount`. Good.

What about a transfer where the amount is a very large number? `BigInt(amt)` would handle it. If `amt` is undefined (not a number), `BigInt(undefined)` would throw, but the try/catch handles it. The comment says "unparsed amount: under-reads, see above". So a transaction with an unparseable amount is treated as 0, which under-reads the total. This is a false negative (the actual outflow was larger), not a false positive. The safe direction is correct.

**No defect.**

### R2.8: `parseCbobLogs` — the attribution by invoke stack

The function attributes `CBOB_REDEEMED` to BURN and all others to MINT, by checking the invoke stack. If a program other than MINT or BURN prints `CBOB_REDEEMED`, it's ignored. If MINT prints `CBOB_REDEEMED` (which it shouldn't — only BURN should), it's ignored.

The `REDEEMED_POOL_FROZEN` event is attributed to MINT (it comes from `retire_redeemed` which is a MINT instruction, reached by CPI from BURN's `burn_vault`). This is the round 24 I3 fix.

But what if the invoke stack is unbalanced? The function checks for this:

```javascript
const m = /^Program (\w+) (success|failed.*)$/.exec(line)
if (stack[stack.length - 1] !== m[1]) {
    problem = problem || `unbalanced invoke stack at "${line.slice(0, 80)}"`
} else {
    stack.pop()
}
```

If the stack is unbalanced, `problem` is set and the events are still parsed (but the caller can check `problem`). The round 24 I3 fix says "an unbalanced stack is a PROBLEM, never a silent guess about who printed what."

But what if the program IDs in the invoke lines are in a different case? The `m[1]` captures the program ID as a string. The `stack` array holds program IDs from `invoke` lines. The comparison is `stack[stack.length - 1] !== m[1]`, which is a string comparison. If one is uppercase and the other is lowercase, they won't match.

Looking at the program IDs: `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` (MPL Core), `Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo` (MINT), `8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8` (BURN). These are base58-encoded public keys, which are case-sensitive. Solana log lines typically use the base58 representation. So the case should match.

**No defect, assuming consistent case in log lines.**

### R2.9: `detectLogGaps` — the gap management

The round 32 L3 fix: unreviewed gaps are never evicted, reviewed prefixes are trimmed (keeping the watermark), and > 2000 unreviewed gaps escalate to CRITICAL.

But what about a gap that was in the reviewed prefix but the watermark was later than all kept gaps? The code:

```javascript
const at = reviewedThrough ? all.indexOf(reviewedThrough) : -1
const unreviewed = at >= 0 ? all.slice(at + 1) : all
```

If `reviewedThrough` is not in `all` (e.g., it was evicted from the log), `at` is -1, and `unreviewed` is all entries. This is a fail-safe: if the watermark is lost, all gaps are unreviewed. The escalation at > 2000 ensures this doesn't go unnoticed.

**No defect.**

### R2.10: `detectUnsweptRoyalties` — the cooldown grace

Round 25 L4: the grace is `max(default, cooldownSecs + cronPeriodSecs + 3600)`. For a 6-hour cooldown, this is 6 + 1 + 1 = 8 hours. For a 24-hour cooldown (ceiling), this is 24 + 1 + 1 = 26 hours.

But the grace is in seconds (`graceSecs = cooldownSecs + REVENUE_CRON_PERIOD_SECS + 3600`), and the function takes it as a parameter. The call site:

```javascript
detectUnsweptRoyalties({ ..., cooldownSecs: cfg['mint.sweep_cooldown_secs'] ?? null })
```

If `cooldownSecs` is null, the function uses the default grace (24 hours). This is the round 25 L4 fallback: if the on-chain cooldown is unreadable, the default grace is used.

**No defect.**

### R2.11: `detectVaultSetChange` — the trustCurrent flag

```javascript
export function detectVaultSetChange(prevLive, current, opts = {}) {
  const out = []
  if (!prevLive || !prevLive.length) return { findings: out, trustCurrent: true }
  ...
  if (gone.length > allowed) {
    out.push({ kind: 'vault_index_shrank', severity: S.CRITICAL, ... })
    return { findings: out, trustCurrent: false }
  }
  ...
  return { findings: out, trustCurrent: true }
}
```

If a large number of vaults disappeared, the caller is told `trustCurrent: false` — don't trust the current list as the baseline. This prevents a corrupted DAS response from being adopted as truth.

But what if `prevLive` is empty (first pass)? `trustCurrent: true`. The first pass adopts the current list as truth. If DAS is wrong on the first pass, the corrupted list is adopted. This is unavoidable — there's no prior state to compare against.

**No defect, by design.**

### R2.12: `detectIndexShortfall` — the live + burnt count agreement

```javascript
const seen = BigInt(live.size + burnt.size)
const total = BigInt(mintedTotal)
if (after !== null && after >= total && seen >= total && seen <= after) return []
if (seen !== total) {
  out.push({ kind: 'index_disagrees_with_chain', severity: S.CRITICAL, ... })
}
```

The `seen` is the count of unique vault IDs (live + burnt). If the DAS response has duplicates, `seen` is the count of unique IDs. The `total` is `mintedTotal` from the chain.

If `seen === total`, the check passes (no finding). If `seen !== total`, a CRITICAL is raised.

The `after` parameter is `mintedAfter`, which is `mintedTotal` re-read after the DAS walk. The race window is between the first read and the DAS walk. If a sale lands during the DAS walk, `mintedTotal` increases by 1. The first read sees N, the DAS walk sees N+1 vaults, and the re-read sees N+1. If `seen === N+1` and `total === N+1`, they agree. If `seen === N+1` and `total === N`, they disagree.

But the code checks `if (after !== null && after >= total && seen >= total && seen <= after) return []`. This means: if the re-read total is >= the initial total, and the seen count is between them, the race is accepted (no finding). This is the round 24 L9 fix.

If `seen > after`, the index returned more vaults than the chain knows about. This is a problem (index is returning something the chain didn't mint). The code only returns `[]` (no finding) if `seen <= after`, so `seen > after` would still raise a CRITICAL. Good.

**No defect.**

### R2.13: `detectBalanceDrops` — the asset:mint key format

```javascript
const [vault, mint = null] = String(asset).split(':')
```

This splits on `:`. If `asset` is a vault address (no `:`), `vault` is the address and `mint` is null. If `asset` is `vault:cbbtc`, `vault` is the address and `mint` is `cbbtc`.

The finding's asset is set to `vault` (the address part), and the mint is a separate field. This allows the alarm to track balance drops for specific mints per vault.

But what if the vault address itself contains a `:`? Vault addresses are 32-byte public keys, base58-encoded. Base58 doesn't use `:`. So the split is safe.

**No defect.**

### R2.14: `detectUndeclaredTokenAccounts` — the completeness check

The daily `--reconcile` mode uses `getTokenAccountsByOwner` on each vault's PDA for both Token and Token2022 programs. It checks each owned account against the expected reserve ATAs. Any non-canonical account is a CRITICAL.

But what about a Token-2022 account with extensions? The round 25 D7 fix: the sweep helper moves any classic SPL account the vault PDA owns when the page names it. But `detectUndeclaredTokenAccounts` would still page for a Token-2022 account (since it's non-canonical). The account exists but can't be swept by the helper (which only reads 165-byte classic accounts). This is a known limit (item 44, "Not covered: Token-2022 accounts").

The alarm's behavior is: page CRITICAL for any non-canonical account, including Token-2022. The redeem page would then warn the holder that they have a Token-2022 account that would be destroyed. This is the correct conservative behavior.

**No defect, by design.**

### R2.15: `detectNestedVaults` — the off-curve check

```javascript
try { ok = isOnCurve(owner) } catch { ok = null }
if (ok === null || ok) continue
```

If `isOnCurve` throws (e.g., invalid key), `ok` is null, and the vault is skipped. If the owner is on-curve, `ok` is true, and the vault is skipped (not a finding). If the owner is off-curve, `ok` is false, and a `unredeemable_owner` finding is emitted.

But what if the owner is a PDA? PDAs are off-curve. The finding names both readings: "Either this vault is listed on a marketplace that escrows it (recoverable: delist and it returns) or its contents are sealed for good." The holder guide states this: "A vault held by a multisig or a DAO cannot be opened. Keep it in a normal wallet."

**No defect.**

### R2.16: `detectNestedVaults` — the nested vault detection

```javascript
for (const { id, owner } of vaults) {
    if (!owner) continue
    const host = owners.get(owner)
    if (host === undefined) continue
    if (host === id) {
        out.push({ kind: 'vault_owns_itself', ... })
        continue
    }
    out.push({ kind: 'nested_vault', ... })
}
```

`owners` is a map from asset-signer PDA to vault ID. If a vault's owner is in `owners`, it's nested in that host vault (or owns itself). The code checks both cases.

But `owners` is built from ALL vaults (including burnt ones): "Every vault's PDA, INCLUDING BURNT ONES: a vault nested inside an already burned vault is the worst case, not an excluded one." So a burnt host vault can still be detected as a host. Good.

**No defect.**

### R2.17: The alarm's drift detection — carried config baseline

The round 24 L5 fix: `carryConfigBaseline(prev, cur)` keeps the last non-null value of every key, so a change across a one-pass failed read is compared, not skipped. The `detectConfigDrift` function uses this baseline.

But what if a key was present in `prev` but NOT in `cur`? The `detectConfigDrift` function iterates over `WATCH`, not over `prev`. So a key that's in `prev` but not in `cur` (e.g., a program that was deployed but is now absent) is not checked for drift. This is a potential gap: if a program was present and then disappeared, the drift wouldn't be detected.

Looking at `detectConfigDrift`:
```javascript
for (const [k, severity, why] of watch) {
    if ((prev[k] === undefined || prev[k] === null) && prev[missingFlagOf(k)] === true) continue
    ...
    const a = JSON.stringify(prev[k] ?? null), b = JSON.stringify(cur[k] ?? null)
    if (a !== b) out.push({ kind: 'config_drift', severity, detail: ... })
}
```

It iterates over `WATCH`, so it only checks keys in the watch list. A key that was in `prev` but not in `cur` and not in `WATCH` is not checked. But `WATCH` is supposed to be comprehensive (the comment says "every key the drift list and the standing checks depend on"). If a key was in `prev` but not in `WATCH`, it was never watched anyway.

But what if a key IS in `WATCH`, was in `prev` (with a value), and is not in `cur` (e.g., null)? The `JSON.stringify(null)` for both `a` and `b` would be `'null' === 'null'`, so no drift. If the key was in `prev` with a value and in `cur` as `null`, that's a change (value → null), and a drift would be detected.

But the `carryConfigBaseline` keeps the last non-null value. If the key was `null` in `cur` but had a value in `prev`, the baseline keeps the value. Then `detectConfigDrift` uses the baseline: `prev[k]` is the value (from the baseline), `cur[k]` is `null`. The comparison `value !== null` is true, so a drift is detected. Good.

**No defect.**

### R2.18: `detectUnsweptRoyalties` — the sweep was masked by deposits

Round 27 D4: a sweep that was masked by new deposits is still detected. The check is:

```javascript
if (prevLamports !== null && prevLamports !== undefined && BigInt(lamports) < BigInt(prevLamports)) since = nowSec
```

If the current lamports is LESS than the previous, a sweep happened (balance fell), and the clock resets. If the current lamports is >= the previous, the clock doesn't reset (the sweep was masked by deposits). This is the correct direction: a visible fall resets the clock, a masked sweep doesn't.

**No defect.**

### R2.19: `detectPoolHealth` — the frozen pool

The alarm reads the pool's token account and checks if it's frozen (state byte 2). A frozen pool pages `pool_frozen` at CRITICAL. The round 24 D4 fix: the crank no longer pages a false positive on a frozen pool (the distribute instruction is re-judged, and a frozen pool's failure is expected).

But the `detectPoolHealth` check doesn't re-read the pool. It reads the pool once. If the pool is frozen at the time of the alarm's read, it pages. If the pool thaws between the alarm's read and the crank's attempt, the alarm's page is already sent, and the crank's attempt succeeds. This is fine — the alarm pages when the freeze happens, the crank succeeds when it thaws.

**No defect.**

### R2.20: The alarm's notification plan

The round 24 H1 fix: each finding KIND has its own alert stream (`cbob-vault-alarm:<kind>`), one-shots are ALERT_URGENT, level kinds get RECOVERY, and the full detail list is sent (not just the first line).

I need to verify that all finding kinds in `ALARM_KINDS` are actually emitted by the alarm. The round 24 selftest checks that the emitted kinds are all in `ALARM_KINDS` and vice versa. This is the round 32 D1 gate: "every kind the alarm can emit is classified once / level / info (none unlisted)."

**No defect, assuming the selftest passes.**

### R2.21: `judgeCopy` — the redemption post's copy rules

The post must be <= 280 characters, no em/en dashes, no links, no exclamation, no emoji. The function checks all of these. The draft is built from the released assets, which are read from the transaction's token balances.

But what about a released asset with a mint that's not in `ASSETS`? The code names it by its mint: `${r.amount} units of ${r.mint}`. This is correct (don't guess at the name).

**No defect.**

### R2.22: The alarm's daily reconcile

The `--reconcile` mode calls `reconcile()`, which:
1. Reads the MintConfig
2. Lists vaults via DAS
3. Checks the index against the chain
4. Checks each vault for nested vaults
5. For each live vault, lists all token accounts owned by its PDA (for both Token and Token2022)
6. Checks each owned account against the expected reserve ATAs
7. Reports any non-canonical account

This is the round 30 L1 fix: a flood of transactions naming a program no longer blinds the walk (per-program budget of 2000), and a backlog is drained over multiple passes.

But the `reconcile` function doesn't drain a backlog — it reads all vaults and all token accounts in one pass. If there are 240 vaults and each has 2 token accounts, that's 480 reads. This is fine for 240 vaults, but could be slow for 2100 vaults. The function doesn't use a per-program read budget for the reconcile.

Wait, let me re-read:

```javascript
const reserve = (cfg['seal.reserve_mints'] || []).map(m => new PublicKey(m))
let scanned = 0, accounts = 0
for (const v of live) {
    const p = pda([Buffer.from('mpl-core-execute'), new PublicKey(v).toBuffer()], CORE)
    const expected = new Set(reserve.map(m => ata(m, p).toBase58()))
    for (const prog of [TOK, new PublicKey(D.TOKEN22_ID)]) {
        const r = await conn.getTokenAccountsByOwner(p, { programId: prog }, 'confirmed')
        ...
    }
    scanned++
}
```

So for each live vault, it calls `getTokenAccountsByOwner` twice (once for each token program). This is a batched RPC call. The `accounts` count is the total number of token accounts found. This is fine for 240 vaults but could be slow for 2100 vaults (4200 RPC calls). However, Solana RPC nodes typically support `getProgramAccounts` with filters, which is faster. The code uses `getTokenAccountsByOwner`, which is a specific RPC method that should be efficient.

**No defect for the current vault count, but could be slow for 2100 vaults. Not a correctness defect.**

### R2.23: The alarm's complete kind list

The `ALARM_KINDS` table has entries for every finding kind the alarm can emit. The round 24 selftest checks that every `kind:` literal in the source is in `ALARM_KINDS` and every `ALARM_KINDS` entry is emitted. I need to verify this is still true at HEAD.

I can't run the selftest, but I can read the `ALARM_KINDS` table and the source. The table has entries for:
- one-shot: approve, non_ata_token_account, bare_core_burn, vault_burned, vault_left_index, config_drift, brake_pulled, brake_released, unledgered_sweep, sweep_amount_mismatch, sweep_on_rejected_row, reserve_fell, reveal_rescheduled, claim_deferred_frozen, pool_frozen_forfeit, pool_frozen, vault_account_frozen, revenue_account_frozen, watchdog_gap, log_unparseable, sweep_unledgered_state
- level: vault_index_shrank, split_not_85_15, swap_operator_armed, guardian_armed, sweep_bound_ineffective, sweep_cooldown_too_short, test_value_in_production, collections_disagree, revenue_ledger_unreadable, unreconciled_swap, cycle_unsplit, short_swap_return, rejected_row_has_sweep, undeclared_token_account, vault_owns_itself, nested_vault, unredeemable_owner, split_sig_reused, split_not_on_chain, split_by_other_unanchored, split_claim_unanchored, index_self_contradictory, index_disagrees_with_chain, joins_stalled, boosts_stalled, launch_tick_overdue, distribution_overdue, pool_unreadable, pool_insolvent, redemptions_near_cap, revenue_unsplit, revenue_account_unreadable, royalties_unswept, crank_silent, crank_posture_unreadable, crank_failing, crank_problem, reveal_queue_stalled, lock_deadline_unset, program_not_locked, component_missing, config_vanished, balance_unreadable, scan_gap, scan_cursor_unresolvable, scan_backlog_unproven, log_coverage_gap, tx_unreadable, run_failed, reconcile_failed
- info: reserve_ata_created, burn_via_program, sales_stopped, sweep_stopped, guardian_retired, log_truncated_foreign, joins_waiting, sweep_cooldown_wedged, sweep_cap_wedged, distributed, redeemed

That's a lot of kinds. I need to verify that the source only emits kinds in this table. The selftest does this check, so if the selftest passes, this is correct. I can't run the selftest, but I can spot-check a few.

Looking at `detectSweepState`: it emits `sweep_unledgered_state`. This is in `ALARM_KINDS` as 'once'. Good.

Looking at `detectSweepState` (the review 33 case): the kind is 'sweep_unledgered_state', which is in `ALARM_KINDS`. Good.

I don't see any kinds in the source that are NOT in `ALARM_KINDS`. The selftest enforces this.

**No defect, assuming the selftest passes.**

### R2.24: `parseCbobLogs` — `REDEEMED_POOL_FROZEN` attribution

The `REDEEMED_POOL_FROZEN` event is attributed to MINT (it comes from `retire_redeemed`, which is a MINT instruction reached by CPI from BURN's `burn_vault`). The owner map in the function:

```javascript
const owner = { REDEEMED: ids.burn, DISTRIBUTED: ids.mint, REVEAL_RESCHEDULED: ids.mint, CLAIM_DEFERRED_FROZEN: ids.mint,
    REDEEMED_POOL_FROZEN: ids.mint }
```

So `REDEEMED_POOL_FROZEN` is attributed to MINT. If the top of the invoke stack is MINT (i.e., the line was printed by MINT), the event is captured. If it was printed by any other program, it's ignored.

In the program, `retire_redeemed` is a MINT instruction. When it prints `CBOB_REDEEMED_POOL_FROZEN`, the invoke stack is `[BURN, MINT]` (BURN called MINT via CPI). The top of the stack is MINT, so the event is captured. Good.

**No defect.**

---

## R3. The Layouts (`bank/layout.mjs`)

### R3.1: Offset assertions for cross-program raw reads

The selftest checks that the pinned cross-program offsets equal the layout's computed offsets. For example:

```javascript
const pinned = (file, re) => Object.fromEntries([...rs(file).matchAll(re)].map(m => [m[1], Number(m[2])]))
const gov = pinned('programs/cbob-vault-gov/src/lib.rs', /^const OFF_(\w+): usize = (\d+);/gm)
```

This scrapes the `OFF_*` constants from the program source and compares them to the layout's `offsets()`. The selftest has an array `want` that lists every expected OFF constant and its value. I need to verify this is still true at HEAD.

Looking at the `want` array in the selftest, I can see entries for:
- GOV OFF_MINT_GOVERNANCE, OFF_MINT_MINTED_TOTAL, OFF_MINT_BARE_RETIRED, OFF_MINT_CHARTER_CLOSES, OFF_MINT_SOL_RESERVE, OFF_MINT_MAX_SWEEP, OFF_MINT_COOLDOWN
- GOV OFF_BURN_TOTAL
- GOV OFF_REC_ASSET, OFF_REC_INDEX
- BURN OFF_MINT_MINTED_TOTAL, OFF_MINT_BARE_RETIRED
- BURN OFF_COLLECTION (SEAL), OFF_RESERVES (SEAL)
- Stage 3c additions: GOV OFF_MINT_COLLECTION, OFF_MINT_SALES_STOPPED, OFF_MINT_SWEEP_STOPPED, OFF_MINT_SALES_STOPPED_AT, OFF_MINT_SWEEP_STOPPED_AT, OFF_MINT_SWEEP_FLOOR, OFF_MINT_COOLDOWN_CEILING, OFF_MINT_RESERVE_CEILING, OFF_MINT_MAX_BOOST_WEIGHT, OFF_MINT_MAX_BOOST_EPOCHS
- MINT OFF_RESERVES (SEAL), OFF_VERSION (SEAL), OFF_COLLECTION (SEAL)
- BURN OFF_VERSION (SEAL), OFF_MINT_VERSION
- GOV OFF_MINT_VERSION, OFF_BURN_VERSION, OFF_REC_VERSION

This looks comprehensive. The round 22 L2 fix: "nothing scraped goes uncompered" — the `unchecked` list at the end checks that every `OFF_*` constant is in the `want` array.

I can't run the selftest, but the code structure is correct.

**No defect, assuming the selftest passes.**

### R3.2: `parseRustStruct` — strict field parsing

The round 22 L1 fix: `parseRustStruct` throws on a line it cannot read as `pub name: Type,`. This catches private fields, `pub(crate)` fields, and multi-line fields that were silently dropped in the past.

But what about a field with a complex type like `Vec<Pubkey>`? The regex `^pub (\w+):\s*(.+?),?$` should match `pub reserve_mints: Vec<Pubkey>,`. The type would be `Vec<Pubkey>`. The layout expects `Vec<Pubkey>`. This should work.

What about a field with a type annotation? `pub field: u8,` is fine. What about `pub field: u8` (no comma at the end)? The regex allows the comma to be optional (`,?`), so this should work.

What about a field with a comment after it? The code strips comments:
```javascript
const line = raw.replace(/\/\/.*$/, '').trim()
```

So `pub field: u8, // comment` becomes `pub field: u8,` after comment stripping. This should work.

What about a field with a multi-line type? `pub field: SomeType<\n    Inner,\n>,` — the regex expects the type on one line, so this would fail to match. The function would throw. This is correct (the function is strict and refuses what it cannot read).

**No defect.**

### R3.3: `boost_expiring` ring size

The `BOOST_RING = 64` constant. The `boost_expiring` field is `[u32; BOOST_RING]`. The program uses `BOOST_RING as u64` for modulo arithmetic:

```rust
let i = (c.dist_epoch % BOOST_RING as u64) as usize;
```

The ring holds 63 boosts (not 64), because a boost can last at most `BOOST_RING - 1 = 63` distributions. This is enforced in the program:

```rust
const MAX_BOOST_EPOCHS_BOUND: u16 = (BOOST_RING - 1) as u16;
```

And in `initialize`:
```rust
require!((1..=MAX_BOOST_EPOCHS_BOUND).contains(&max_boost_epochs), MintError::BadBoostSetup);
```

So a boost can last at most 63 distributions, and the ring has 64 slots. Two live boosts ending at the same epoch would share a slot. But since the maximum is 63, the ring can hold 64 distinct end epochs. The ring is indexed by `epoch % 64`, so end epochs 1, 65, 129, ... all share slot 1. This is correct: `BOOST_RING - 1` different end epochs can be alive without collision.

Wait, the round 51 description says: "The schedule of WHEN boosts end is a ring of counts indexed by epoch; a boost may last at most `BOOST_RING - 1` distributions, so two live end epochs never share a slot." This means the ring can hold 63 distinct end epochs, and the current epoch is excluded (it's `dist_epoch + epochs`, so the current epoch itself can't be an end epoch). The modulo of `dist_epoch + epochs` where `epochs <= 63` gives 63 distinct possible end epochs relative to the current epoch. These are all different from the current epoch (since `epochs >= 1`), so the ring slot for the current epoch is not used. This is correct.

**No defect.**

### R3.4: `STRUCTS.MintConfig` field list matches the Rust struct

The selftest checks that `parseRustStruct(rustSource, 'MintConfig')` equals `STRUCTS.MintConfig.fields`. This is the round 22 A6 gate: the layout equals the Rust struct, field for field, type for type.

I can't run the selftest, but the code structure is correct.

**No defect, assuming the selftest passes.**

### R3.5: `collectionPluginsHash` — the collection's plugin region

The `collectionPluginsHash` function hashes the plugin region of a Core collection, after the base fields (key, update_authority, name, uri, num_minted, current_size). The hash is used to detect changes to the collection's plugins (the 10% royalty).

But the function uses `d[o]` where `o` is the offset after the base fields. If a Core upgrade changes the layout of a collection (e.g., adds a new base field), the plugin offset would change, and the hash would include different bytes. The alarm would page a drift, but the actual plugins might be unchanged.

This is a known limitation: the hash is relative to the current Core layout. A Core upgrade would cause a false positive (the alarm thinks the plugins changed when they didn't). But this is the safe direction: better to page a false positive than miss a real change.

**No defect, by design.**

### R3.6: `pinnedAccountData` — the version check

```javascript
if (acc.data[8] !== version) {
    throw new Error(`${what} is layout version ${acc.data[8]}; this code reads version ${version}. ...`)
}
```

The version byte is at offset 8 (the first byte after the 8-byte discriminator). The `STRUCTS` table has `version` fields for each struct. The alarm passes the expected version, and the function throws if the actual version doesn't match.

But what if the version is 0? The check `acc.data[8] !== version` would be `0 !== 1` (if expecting 1), which is true, and the function throws. A version 0 account is not expected (the program's structs start at version 1 or higher). Good.

**No defect.**

### R3.7: `encode`/`decode` round-trip

The selftest checks that encoding a config and decoding it back gives the same values. The `encode` function constructs the Borsh serialization, and the `decode` function parses it back. The selftest uses `acc.acc_scaled = (1n << 100n) + 3n` to test u128 round-trip, and `acc.last_distribute_at = -5n` to test negative i64.

The round-trip is correct because `encode` writes the bytes in the same order as `decode` reads them, using the same types.

**No defect, assuming the selftest passes.**

---

## R4. The Money Arithmetic (`bank/accrual.mjs`)

### R4.1: `pendingScaled` — the owed formula

```javascript
export function pendingScaled({ level, debt, boost = 0, carry = 0n }, acc) {
  const p = (weightOf(level) + BigInt(boost)) * BigInt(acc) + BigInt(carry) - BigInt(debt)
  if (p < 0n) throw new Error('debt above entitlement: the record and the accumulator disagree')
  return p
}
```

The formula is: `(weight + boost) * acc + carry - debt`. This matches the Rust:

```rust
(weight_of(r)? as u128).checked_mul(acc).ok_or(MintError::Overflow)?
    .checked_add(r.carry_scaled).ok_or(MintError::Overflow)?
    .checked_sub(r.debt_scaled).ok_or(error!(MintError::Overflow))
```

Both compute the same value. The JS throws on negative (which would be an overflow in Rust, since `u128` can't be negative). The Rust uses `checked_sub` which would return an error on underflow. The error message is different ("debt above entitlement" vs "overflow"), but the behavior is the same (refuse, don't crash).

But wait — the Rust `checked_sub` returns `Result`, and the `?` operator propagates the error. The error variant is `MintError::Overflow`, not a custom error for "debt above entitlement". So the Rust would page an `overflow` error, while the JS throws a more descriptive error. These are different error messages but same behavior.

The selftest checks: "a debt above entitlement is refused, not paid negative" — it calls `pendingSats` with a debt of `10n * ACC_SCALE` and an accumulator of `ACC_SCALE`, expecting a throw. The JS throws "debt above entitlement", the Rust would throw "overflow". Both refuse. The selftest is testing the JS behavior.

**No defect in the arithmetic.**

### R4.2: `reweigh` — the weight change

```javascript
export function reweigh(v, acc, boost) {
  const owed = pendingScaled(v, acc)
  return { ...v, boost, carry: owed, debt: (weightOf(v.level) + BigInt(boost)) * BigInt(acc) }
}
```

This computes what the vault is owed at the current accumulator, then sets `carry` to the owed amount and `debt` to the new weight's debt. The Rust:

```rust
fn reweigh(c: &mut MintConfig, r: &mut VaultRecord, boost: u8) -> Result<()> {
    require!(r.active, MintError::BoostNeedsActiveVault);
    let before = weight_of(r)?;
    let owed = owed_of(r, c.acc_scaled)?;
    r.boost_weight = boost;
    let after = weight_of(r)?;
    r.carry_scaled = owed;
    r.debt_scaled = (after as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
    c.total_active_weight = c.total_active_weight.checked_sub(before).ok_or(MintError::Overflow)?
        .checked_add(after).ok_or(MintError::Overflow)?;
    Ok(())
}
```

The Rust also updates `total_active_weight` (subtracts the old weight, adds the new). The JS `reweigh` does NOT update `total_active_weight` — it just returns the new record. The caller is responsible for updating the config.

Looking at the call sites of `reweigh` in the JS: `bank/accrual.mjs --selftest` uses it in tests. The main callers would be the alarm or the crank, but I don't see `reweigh` called from `bank/crank.mjs` or `bank/alarm.mjs`. The `reweigh` function is used internally for the boost schedule test in the selftest.

The Rust `reweigh` is called from `boost_vault` and `expire_boost`, both of which are MINT instructions. The JS mirror is for testing the boost schedule model. The function is correct for its purpose.

**No defect.**

### R4.3: `pendingSats` — the floor rounding

```javascript
export function pendingSats(v, acc) { return pendingScaled(v, acc) / ACC_SCALE }
```

This divides by `ACC_SCALE = 1_000_000_000_000n`, flooring (BigInt division floors towards zero for positive values). The Rust:

```rust
let pending = owed_of(r, c.acc_scaled)?;
let pay = (pending / ACC_SCALE) as u64;
```

Both compute `pending / ACC_SCALE`, which is the same flooring. Good.

**No defect.**

### R4.4: `credit` — the distribution arithmetic

```javascript
export function credit({ acc, owed }, avail, w) {
  avail = BigInt(avail); w = BigInt(w)
  if (w <= 0n) throw new Error('no activated weight')
  const delta = avail * ACC_SCALE / w
  return { acc: BigInt(acc) + delta, owed: BigInt(owed) + delta * w }
}
```

This computes `delta = avail * ACC_SCALE / w`, then `acc += delta` and `owed += delta * w`. The Rust:

```rust
let delta = (avail as u128).checked_mul(ACC_SCALE).ok_or(MintError::Overflow)? / (w as u128);
c.acc_scaled = c.acc_scaled.checked_add(delta).ok_or(MintError::Overflow)?;
c.owed_scaled = c.owed_scaled.checked_add(delta.checked_mul(w as u128).ok_or(MintError::Overflow)?)
    .ok_or(MintError::Overflow)?;
```

The JS throws on `w <= 0` ("no activated weight"). The Rust would have a division by zero in `avail * ACC_SCALE / w`, which would be a runtime panic. The JS catches this earlier. The JS behavior is safer.

The `delta * w` could overflow in the JS. BigInt has no overflow (it grows as needed), so `delta * w` is always valid. The Rust uses `checked_mul` which returns `Result`. The JS doesn't need the check.

**No defect.**

### R4.5: `available` — the pool's distributable balance

```javascript
export function available(poolBalance, owedScaled) {
  const a = BigInt(poolBalance) - ceilSats(owedScaled)
  return a > 0n ? a : 0n
}
```

This computes `poolBalance - ceil(owedScaled / ACC_SCALE)`, clamped to >= 0. The Rust:

```rust
let owed = ceil_sats(c.owed_scaled);
let avail = balance.checked_sub(owed).ok_or(MintError::PoolShort)?;
```

The Rust uses `checked_sub` which returns an error on underflow. The JS clamps to 0. These are different behaviors: the Rust refuses (`PoolShort`), the JS returns 0. The JS is used by the alarm to compute the pool's undistributed balance, and the Rust is used by the program to compute the distribution amount.

The selftest checks: "a SHORT pool reads as 0 available here (the alarm reports the shortfall)". So the JS behavior is correct: 0 available, and the alarm separately reports `pool_insolvent` (a CRITICAL).

**No defect, by design.**

### R4.6: `ceilSats` — the ceiling rounding

```javascript
export const ceilSats = scaled => (BigInt(scaled) + ACC_SCALE - 1n) / ACC_SCALE
```

This computes `ceil(scaled / ACC_SCALE)`. The Rust:

```rust
fn ceil_sats(scaled: u128) -> u64 {
    ((scaled + ACC_SCALE - 1) / ACC_SCALE) as u64
}
```

Both compute the same value. Good.

**No defect.**

### R4.7: `weightOf` — the level weight

```javascript
export const weightOf = level => {
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error(`level ${level} has no weight`)
  return WEIGHTS[level - 1]
}
```

This throws on invalid level. The Rust:

```rust
fn weight_of(r: &VaultRecord) -> Result<u64> {
    require!((1..=5).contains(&r.level), MintError::NotRevealed);
    Ok(LEVEL_WEIGHTS[(r.level - 1) as usize] + r.boost_weight as u64)
}
```

The Rust includes `r.boost_weight` in the weight. The JS `weightOf` does NOT include boost. The JS `pendingScaled` adds boost separately:

```javascript
const p = (weightOf(level) + BigInt(boost)) * BigInt(acc) + BigInt(carry) - BigInt(debt)
```

So the JS correctly adds boost to the weight. The Rust combines them in `weight_of`. The behavior is the same.

**No defect.**

### R4.8: `debtAtActivation` — the initial debt

```javascript
export const debtAtActivation = (level, acc) => weightOf(level) * BigInt(acc)
```

This computes `weight * acc`, which is the initial debt when a vault activates. The Rust:

```rust
r.debt_scaled = (w as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
```

In the `join` function:
```rust
let w = LEVEL_WEIGHTS[(r.level - 1) as usize];
...
r.debt_scaled = (w as u128).checked_mul(c.acc_scaled).ok_or(MintError::Overflow)?;
```

So the Rust uses the level weight (not including boost, since the boost is separate). The JS `debtAtActivation` uses the level weight. But at activation time, the boost is 0 (the vault hasn't been boosted yet). So `weight * acc` is correct for the initial debt.

**No defect.**

### R4.9: The boost schedule test (round 51, N1)

The selftest drives the boost schedule through 260 epochs (4 wraps of the ring) against a model rebuilt from the records alone. The test checks:
- `c.boosts_due == due` (model)
- `c.boosts_active == boosted.length` (model)
- `c.boost_weight_total == sum(boost_weight)` (model)
- Each ring slot matches the model
- `c.total_active_weight == sum(weight_of(r))` (model)
- `c.owed_scaled == sum(owed_of(r, c.acc_scaled))` (model)

The model is rebuilt from the records, and the program's state should match. The test passes (or fails) based on whether the program's state is consistent with the records.

I can't run this test, but the code structure is correct. The round 33 validation (`.cache/r33-full-pass.log`) shows the host unit tests passing (6/6 including this one).

**No defect, assuming the test passes.**

### R4.10: The `WEIGHTS` array

```javascript
export const WEIGHTS = [2n, 3n, 4n, 5n, 6n]          // Levels I..V
```

The Rust:
```rust
const LEVEL_WEIGHTS: [u64; 5] = [2, 3, 4, 5, 6];
```

Both have the same values. The layout has the same:
```javascript
export const LEVEL_WEIGHTS = [2n, 3n, 4n, 5n, 6n]
```

All three are in agreement. Good.

**No defect.**

---

## R5. The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`)

### R5.1: `judgeSwapInstructions` — the pre-signing judge

The round 25 D1 fix: the judge requires the EXACT seven-instruction sequence that `swapInstructions` builds, with each element checked independently.

The eight tampers from round 25 D1 are tested in the selftest:
1. Output account changed to a stranger → refused
2. Min-out of 0 → refused
3. Amount changed → refused
4. Direction flipped (Orca a_to_b = 0; Meteora in/out swapped) → refused
5. Priority fee appended → refused
6. Token Approve of cbBTC to a stranger → refused
7. cbBTC ATA created for another owner → refused
8. Wrap inflated to 50 SOL → refused

Each of these is tested in the selftest, and the judge refuses them. I can verify this by reading the selftest code.

But wait — I need to check whether the judge correctly handles the case where the instructions are built by `swapInstructions` with valid parameters, and then tampered with. The selftest:

```javascript
const TAMPERS = {
  'the output account (swap key 5) handed to a stranger': [(x, v) => { x[5].keys[5].pubkey = ataOf(SW.CBBTC, stranger) }, /output account is not the operator's own cbBTC/],
  ...
}
```

The tamper is applied to the built instructions, then the judge is called. If the judge correctly refuses, the test passes. I need to verify the judge's logic for each tamper.

**1. Output account changed:**
```javascript
if (!keyAt(sw, 5)?.equals(ownCbbtc)) problems.push("the swap's output account is not the operator's own cbBTC account")
```

Key 5 is the output account for both Orca and Meteora. If changed, this fires. Good.

**2. Min-out of 0:**
```javascript
if (d.readBigUInt64LE(16) !== floor) problems.push(`the swap's on-chain floor is ${d.readBigUInt64LE(16)} sats, not the oracle floor ${floor}`)
```

If the floor is 0, this fires. Good.

**3. Amount changed:**
```javascript
if (d.readBigUInt64LE(8) !== amt) problems.push(`the swap sells ${d.readBigUInt64LE(8)} lamports, not ${amt}`)
```

If the amount is changed, this fires. Good.

**4. Direction flipped (Orca):**
```javascript
if (orca && (readU128(d, 24) !== ORCA_MIN_SQRT_PRICE || d[40] !== 1 || d[41] !== 1))
  problems.push('the Orca swap is not exact-input, a_to_b (selling wSOL), at the minimum price limit')
```

If a_to_b is flipped to 0 or the sqrt price is changed, this fires. Good.

**4. Direction flipped (Meteora):**
```javascript
// Meteora: in and out swapped
const k4 = x[5].keys[4]; x[5].keys[4] = x[5].keys[5]; x[5].keys[5] = k4
```

If keys 4 and 5 are swapped, the input becomes the output. The judge checks:
```javascript
if (!keyAt(sw, orca ? 3 : 4)?.equals(ownWsol)) problems.push("the swap's input account is not the operator's own wSOL account")
```

Key 4 (Meteora's input) would now be the cbBTC account, not the wSOL account. This fires. Good.

**5. Priority fee appended:**
```javascript
if (ix.programId.equals(CB.programId) && d[0] === 3) problems.push('a priority fee (setComputeUnitPrice): the swap pays the base fee only')
```

If a `setComputeUnitPrice` instruction is added, this fires. Good.

**6. Token Approve of cbBTC to a stranger:**
```javascript
if (ix.programId.equals(TOKEN) && d[0] !== 17 && d[0] !== 9)
  problems.push(`a Token ${TOKEN_IX_NAMES[d[0]] ?? `instruction ${d[0]}`}: a swap uses only SyncNative and CloseAccount`)
```

If a Token Approve (instruction 4 or 13) is added, this fires. Good.

**7. cbBTC ATA created for another owner:**
```javascript
if (!ataOk(cc, CBBTC)) problems.push('instruction 4 does not create the operator\'s own cbBTC account (payer, account, owner, mint)')
```

If the cbBTC ATA creation is for a different owner, this fires. Good.

**8. Wrap inflated to 50 SOL:**
```javascript
if (data(wrap).readBigUInt64LE(4) !== amt)
  problems.push(`the wrap moves ${data(wrap).readBigUInt64LE(4)} lamports, not the ${amt} this swap sells`)
```

If the wrap amount is changed, this fires. Good.

**All eight tampers are correctly detected. No defect.**

### R5.2: `readPyth` — the Pyth price account verification

```javascript
export function readPyth(acc, feedHex) {
  if (!acc) throw new Error('the Pyth price account is absent')
  if (!acc.owner.equals(PYTH.receiver)) throw new Error(`the Pyth price account is owned by ${acc.owner.toBase58()}, not the Pyth receiver`)
  const d = acc.data
  if (d.length < 8 + 32 + 1 + 32 + 8 + 8 + 4 + 8) throw new Error('the Pyth price account is truncated')
  let o = 8 + 32
  const level = d[o]
  if (level !== 1) throw new Error('the Pyth price is only PARTIALLY verified; refusing it')
  o += 1
  const feed = d.subarray(o, o + 32).toString('hex'); o += 32
  if (feed !== feedHex) throw new Error(`the Pyth account carries feed ${feed.slice(0, 12)}…, not ${feedHex.slice(0, 12)}…`)
  ...
}
```

The function checks:
1. Account exists
2. Owned by the Pyth receiver
3. Not truncated
4. Verification level is FULL (1), not PARTIAL (0)
5. Feed ID matches

These are the round 25 I1 checks. The selftest verifies each of them.

But what about the price, confidence, and publish time offsets? The function reads:
- `price` at offset `o` (after 8+32+1+32 = 73): `d.readBigInt64LE(o)`
- `conf` at offset `o+8` (81)
- `expo` at offset `o+16` (89)
- `publishTime` at offset `o+20` (93)

Let me verify these offsets against the `PriceUpdateV2` layout. The layout should be:
- `disc` (8 bytes): `sha256("account:PriceUpdateV2")[..8]`
- `write_authority` (32 bytes)
- `verification_level` (1 byte)
- `feed_id` (32 bytes)
- `price` (8 bytes, i64)
- `conf` (8 bytes, u64)
- `expo` (4 bytes, i32)
- `publishTime` (8 bytes, i64)

Total: 8 + 32 + 1 + 32 + 8 + 8 + 4 + 8 = 101 bytes.

The function's check: `d.length < 8 + 32 + 1 + 32 + 8 + 8 + 4 + 8` = `d.length < 101`. So the account must be at least 101 bytes. Good.

The offsets:
- `o = 8 + 32 = 40` (after disc + write_authority)
- `level = d[40]`
- `o += 1` → `o = 41`
- `feed = d[41..73]`
- `o += 32` → `o = 73`
- `price = d.readBigInt64LE(73)`
- `conf = d.readBigUInt64LE(81)`
- `expo = d.readInt32LE(89)`
- `publishTime = d.readBigInt64LE(93)`

These match the layout. Good.

**No defect.**

### R5.3: `oracleFloor` — the price math

```javascript
const e = sol.expo - btc.expo
let num = BigInt(lamportsIn) * sol.price, den = btc.price * 10n
if (e >= 0) num *= 10n ** BigInt(e); else den *= 10n ** BigInt(-e)
const expectedSats = num / den
const minSats = expectedSats * BigInt(10_000 - SWAP_TOLERANCE_BPS) / 10_000n
```

The formula: `sats = lamports * sol_price / btc_price * 10^(sol.expo - btc.expo) / 10`.

Let me verify. `lamports` is in lamports (10^9 SOL per SOL). `sol.price` is in SOL/USD with expo `sol.expo` (e.g., -8 means `sol.price * 10^(-8)` is the price in USD/SOL). So `lamports * sol.price * 10^(sol.expo)` is `lamports * price_in_USD_per_lamports = lamports * price_in_USD / 10^9`. Dividing by `btc.price * 10^(btc.expo)` gives `price_in_USD / btc_price_in_USD = BTC/SOL ratio`. But we want sats, not BTC. So we divide by `10` (since `sats = BTC * 10^8`).

So: `sats = lamports * sol.price * 10^(sol.expo) / (btc.price * 10^(btc.expo) * 10) = lamports * sol.price / (btc.price * 10) * 10^(sol.expo - btc.expo)`.

The code: `num = lamports * sol.price`, `den = btc.price * 10`. If `e = sol.expo - btc.expo >= 0`, `num *= 10^e`. So `num = lamports * sol.price * 10^e`. `den = btc.price * 10`. So `expectedSats = lamports * sol.price * 10^e / (btc.price * 10) = lamports * sol.price * 10^(e-1) / btc.price`.

Wait, the `* 10` in `den` is not part of the exponent. Let me redo:

`sats = lamports * sol.price * 10^(sol.expo) / (btc.price * 10^(btc.expo) * 10)`
`     = lamports * sol.price / btc.price * 10^(sol.expo - btc.expo - 1)`

The code:
```javascript
let num = BigInt(lamportsIn) * sol.price, den = btc.price * 10n
if (e >= 0) num *= 10n ** BigInt(e); else den *= 10n ** BigInt(-e)
const expectedSats = num / den
```

`num = lamports * sol.price * 10^e` (if e >= 0)
`den = btc.price * 10`
`expectedSats = lamports * sol.price * 10^e / (btc.price * 10) = lamports * sol.price * 10^(e-1) / btc.price`

This matches the formula above. Good.

But wait, the comment in the code says:
```
// sats = lamports / 1e9 * SOL_USD / BTC_USD * 1e8 = lamports * sol * 10^(es - eb) / (btc * 10)
```

Let me verify: `lamports / 1e9 = SOL`. `SOL * SOL_USD / BTC_USD = BTC`. `BTC * 1e8 = sats`. So `sats = lamports * SOL_USD / 1e9 / BTC_USD * 1e8 = lamports * SOL_USD * 1e8 / (1e9 * BTC_USD) = lamports * SOL_USD * 10^(-1) / BTC_USD = lamports * SOL_USD / (BTC_USD * 10)`.

Now `sol.price` is the raw price (e.g., `12045355552n` for $120.45 with expo -8). So `sol.price * 10^(-8) = 120.45355552`. Similarly for BTC. So `sol.price * 10^(sol.expo) = sol_price_in_USD * 10^8` (to make it an integer with 8 decimal places). Hmm, actually the Pyth price is an integer with the expo as a separate field. So `sol.price * 10^(sol.expo)` gives the price in USD with implicit decimal places.

For `lamports * sol.price * 10^(sol.expo) / (btc.price * 10^(btc.expo) * 10)`:
- `sol.price * 10^(sol.expo)` = SOL price in USD (with implicit decimals)
- `btc.price * 10^(btc.expo)` = BTC price in USD (with implicit decimals)
- The ratio is SOL/BTC
- Times `lamports` gives the amount in BTC (in lamports, since `lamports` is in 10^9 units)
- Divide by 10 to convert from BTC to sats (10^8 sats per BTC, and lamports is 10^9, so 10^9 / 10^8 = 10)

So: `sats = lamports * SOL_USD / (BTC_USD * 10)`.

The code: `num = lamports * sol.price`, `den = btc.price * 10`. If `e >= 0`, `num *= 10^e`. So `num = lamports * sol.price * 10^e`. `den = btc.price * 10`. So `num / den = lamports * sol.price * 10^e / (btc.price * 10) = lamports * sol.price * 10^(e-1) / btc.price`.

And `sol.price * 10^(sol.expo) = SOL_USD` (with implicit decimals), `btc.price * 10^(btc.expo) = BTC_USD`. So `sol.price * 10^e = SOL_USD * 10^(-btc.expo)`. And `btc.price = BTC_USD * 10^(-btc.expo)`. So `num / den = lamports * SOL_USD * 10^(-btc.expo) * 10^(-1) / (BTC_USD * 10^(-btc.expo)) = lamports * SOL_USD * 10^(-1) / BTC_USD = lamports * SOL_USD / (BTC_USD * 10) = sats`.

This matches. Good.

**No defect in the oracle math.**

### R5.4: `market` — the deviation check

```javascript
try { w = readWhirlpool(wo); const dv = deviationBps(orcaSpot(w), f.satsPerLamport)
  log(`  orca pool ${dv.toFixed(1)} bps from the oracle`); if (dv <= MAX_POOL_DEVIATION_BPS) venues.push('orca') }
catch (e) { log(`  orca pool unusable: ${e.message}`) }
```

If the pool is unusable (e.g., wrong token order, wrong owner), the venue is not added. If the pool's spot price is within `MAX_POOL_DEVIATION_BPS = 100` (1%) of the oracle, the venue is added.

`orcaSpot` computes `(sqrtPrice / 2^64)^2` in raw units (sats per lamport). `deviationBps` computes the absolute difference in basis points. If <= 100, the venue is usable.

The selftest checks both directions: 99 bps → usable, 101 bps → not usable, on both sides of the oracle.

**No defect.**

### R5.5: `sweepAmount` — the dust threshold

```javascript
export function sweepAmount({ balance, reserve, maxPerCycle, chainCap }) {
  let amount = BigInt(balance) > BigInt(reserve) ? BigInt(balance) - BigInt(reserve) : 0n
  if (amount > BigInt(maxPerCycle)) amount = BigInt(maxPerCycle)
  if (amount > BigInt(chainCap)) amount = BigInt(chainCap)
  return amount < MIN_SWEEP_LAMPORTS ? 0n : amount
}
```

Round 30 L3: dust below `MIN_SWEEP_LAMPORTS = 10_000_000n` (0.01 SOL) is not swept. If the sweepable amount is less than 0.01 SOL, return 0n (nothing to sweep). This prevents the market step from failing on dust.

The selftest checks: dust above the reserve is nothing to sweep, the minimum sweeps and prices, the caps bind, and revenue.mjs uses this function. All verified.

**No defect.**

### R5.6: `revenue.mjs` — the sweep handler

The revenue cycle:
1. `sweepCooldownOver` — checks if the cooldown has elapsed (using the chain clock)
2. `enterStage('key')` — records progress
3. Checks the operator key matches config
4. `enterStage('recovery')` — processes open cycles
5. Checks the open cycle guard (refuses to start a new cycle if one is open)
6. `enterStage('funding')` — checks the operator's SOL balance
7. `enterStage('market')` — reads the oracle and pinned pool prices
8. `enterStage('prepare')` — checks the operator's cbBTC ATA
9. `sweep_sol_for_swap` — sends the sweep transaction
10. `enterStage('swap')` — builds and sends the swap transaction
11. `enterStage('return')` — returns cbBTC to the revenue address
12. `enterStage('split')` — splits the cbBTC 85/15

Each stage has a notice stream (`cbob-revenue:<stage>`), and failures are tracked. The round 26 fix: one stage failure does not suppress a later stage failure (different streams).

But I need to check a specific behavior: what happens if the sweep succeeds but the swap fails? The code:

```javascript
cycle.sweepSig = verdict.sig; ...
console.log(`  the sweep's confirmation failed but the chain says it LANDED: ${verdict.sig}`)
break
```

If the sweep lands, the cycle continues to the swap. If the swap is refused (e.g., no venue), the code:

```javascript
if (!cycle.swapSig) {
  cycle.swapFailure = tried.join(' | ').slice(0, 400); save(led)
  throw new Error(`every pinned venue refused the swap (${tried.join(' | ')}) — SOL is on the operator key and must be swapped by hand`)
}
```

So a failed swap leaves the cycle with `swapSig = null`, `swapFailure = "..."`, and the open-cycle guard will refuse future cycles until this one is resolved by hand.

But what if the sweep landed but the return failed? The return transfers cbBTC from the operator's ATA to the revenue ATA. If the transfer fails (e.g., the operator's cbBTC ATA is frozen), the code:

```javascript
cycle.returnSig = await sendAndConfirmTransaction(conn, new Transaction().add(...), [operator], { commitment: 'confirmed' }).catch(e => {
  rememberAttempt(cycle, 'Return', e, led)
  throw e
})
```

So a return failure is caught, the attempt is remembered, and the error is re-thrown. The open cycle would have `sweepSig` and `swapSig` set, but `returnSig` null. The return is the critical step — without it, the cbBTC is on the operator key, not in the revenue address. The cycle is open and needs hand recovery.

The hand recovery path (round 26 fix): look up every recorded confirmed or candidate signature with `getSignatureStatuses(..., { searchTransactionHistory: true })`, read the operator's wSOL and cbBTC balances, and determine whether the return landed.

**This is correct behavior for a failure scenario. No defect.**

### R5.7: `revenue.mjs` — the split handler

```javascript
for (const amount, dest) in [(holders, &ctx.accounts.holders_ata), (bank_cut, &ctx.accounts.bank_ata)] {
  if (amount == 0) { continue }
  ...
}
```

Wait, this is a Python-style loop, but the code is JavaScript. Let me re-read:

```javascript
for (const [amount, dest] of [(holders, &ctx.accounts.holders_ata), (bank_cut, &ctx.accounts.bank_ata)]) {
  if (amount == 0) { continue }
  let mut data = vec![IX_TRANSFER_CHECKED];
  ...
}
```

Hmm, this is Rust syntax (`let mut`, `vec!`), not JavaScript. Let me re-read the actual code in `revenue.mjs`:

The split is done by MINT's `split_revenue` instruction, not by revenue.mjs. revenue.mjs calls `split_revenue` via the MINT program. The code:

```javascript
cycle.splitSig = await sendAndConfirmTransaction(conn, new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, ataOf(bankWallet), bankWallet, CBBTC),
  new TransactionInstruction({ programId: MINT_PROG,
    data: Buffer.concat([d('split_revenue'), Buffer.from([8])]),
    keys: [{ pubkey: MINT_CFG.toBase58(), isSigner: false, isWritable: false },
      { pubkey: REVENUE.toBase58(), isSigner: false, isWritable: true },
      { pubkey: CBBTC.toBase58(), isSigner: false, isWritable: false },
      { pubkey: revAta.toBase58(), isSigner: false, isWritable: true },
      { pubkey: pool.toBase58(), isSigner: false, isWritable: true },
      { pubkey: ataOf(bankWallet).toBase58(), isSigner: false, isWritable: true },
      { pubkey: TOKEN.toBase58(), isSigner: false, isWritable: false }] })),
  [operator], { commitment: 'confirmed' }).catch(async e => {
  ...
})
```

So revenue.mjs calls `split_revenue` on MINT, which performs the 85/15 split. The MINT program checks that the revenue ATA, pool ATA, and bank treasury ATA are correct. If the split fails (e.g., the bank treasury ATA doesn't exist), the `.catch` handler checks if the revenue ATA is provably empty (zero balance). If empty, the split was done by a stranger, and the cycle is marked `splitByOther`. Otherwise, the error is re-thrown.

This is the round 24 L11 fix: "revenue.mjs's recovery closes on the SAME predicate, read off the chain, before the provably-empty proof." The code first checks `closesCycle(c, splits, { exclude: claimed })`, which looks for a split on chain that matches the cycle's return. If found, the cycle is closed. If not, then the provably-empty proof is checked.

**No defect.**

### R5.8: The judge vs. the builder — the box-owner trust residue

The round 25 D1 finding: the judge lives in the same file tree as the builder and the signing key, so it catches OUR defects but not a tampered module. The judge and the builder are both in `bank/swap.mjs`, and the signing key is in `bank/keys/swap-operator.json`. Whoever can edit `bank/swap.mjs` can edit the judge.

This is an accepted limit (item 10): "What a judge in this tree can and cannot catch: it lives in the same file tree, under the same user, as the builder and the signing key, so it catches OUR defects, never a tampered module."

The round 24 C10 fix: a post-signing check in revenue.mjs throws when the operator's cbBTC delta is below the floor, and the cycle stays open and loud. So even if the judge is tampered with and signs a bad swap, the post-signing check catches it.

But what if the builder is tampered with to produce a swap that the judge passes (because the judge is also tampered) AND the post-signing check doesn't catch it (e.g., the swap is at the floor but the floor is 0)? The `oracleFloor` function throws if the expected output is 0. The `judgeSwapInstructions` function checks the floor. If both are tampered with, the bad swap goes through.

This is the box-owner trust residue: whoever can edit the box can bypass the controls. This is an accepted limit, not a defect.

**No defect (by design).**

### R5.9: `classifySendFailure` — the send classification

The round 25 L3 fix: `classifySendFailure` asks the chain about a send that failed. It returns:
- `refused`: preflight refusal, on-chain failure, or expired without landing
- `landed`: confirmed or finalized with no error
- `unknown`: anything else (processed-only, no status, throwing lookup, no signature)

The function uses `getSignatureStatuses([sig], { searchTransactionHistory: true })` to look up the status. If the status is `confirmed` or `finalized` with no error, the send landed. If the status has an error, the send was refused (landed and failed). If the status is null, the send never landed (expired).

This is correct behavior for distinguishing "refused" from "timed out but maybe landed". The round 33 L1 fix adds a direct status lookup for uncertain sends.

**No defect.**

### R5.10: `blockTimeOf` — the return's chain time

```javascript
async function blockTimeOf(conn, sig) {
  try {
    const st = await statusOf(conn)(sig)
    if (!st || st.slot === null || st.slot === undefined) return null
    const bt = await conn.getBlockTime(st.slot)
    return Number.isFinite(bt) && bt > 0 ? bt : null
  } catch { return null }
}
```

This gets the block time of a confirmed transaction's slot. If the status is unavailable or the slot is null, returns null.

The round 25 I1 fix: the return's block time anchors the split check. `closesCycle(c, splits, { exclude, upTo })` uses the return's block time to determine which split is the cycle's. If the return's block time is null (e.g., the status is unavailable), the recovery path in revenue.mjs fills it:

```javascript
for (const c of returnedUnsplit) if (c.returnSig && !(Number(c.returnBlockTime) > 0)) {
  const bt = await blockTimeOf(conn, c.returnSig)
  if (bt) c.returnBlockTime = bt
}
```

So the return's block time is filled from the chain before the `closesCycle` call. If the lookup fails, `c.returnBlockTime` remains null/undefined, and `closesCycle` falls back to the legacy `60s` slack.

**No defect.**

---

## R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

### R6.1: The assertion floors

The selftest exits with a floor check:

```javascript
if (R.length !== FLOOR) {
  console.error(`\n${R.length} assertions ran; the floor says ${FLOOR}. They must be EQUAL — the file stopped early, or the floor was not moved with the suite.`)
  process.exit(1)
}
```

The floor is 909. If the number of assertions doesn't match, the selftest fails. The round 33 repair added the round 33 gate 5 arms (R33.G1-G4, etc.), which should have increased the assertion count.

But the floor is 909. The round 33 validation says "Selftest after the fixes: 909/909." So the floor was moved to match the count. Good.

But what if a future round adds assertions without moving the floor? The selftest would fail. The round 19 gate: "the floors are stored twice and only one copy was checked" — this is now fixed by the `floor()` function in `run-tests.sh` which checks `>=` and `==`. The selftest itself checks `===`. Good.

**No defect, assuming the floor is current.**

### R6.2: The audit coverage gate

`scripts/audit-coverage.sh` checks that every tracked file's current content was bundled by a completed, quorate round. The round 30 L1 fix: a path bundled once used to count forever, so the check now requires the current content to be in the bundle of a completed round.

The gate also checks the prompt re-render: "the gate sees a new one: a planted `kind: \'brand_new_thing\'` is named." This means the gate discovers new finding kinds in the source and checks they are in `ALARM_KINDS`.

I can't run the gate, but the code structure is correct.

**No defect, assuming the gate passes.**

### R6.3: The swap fork gate

`sim/swap-fork.sh` runs the swap against a mainnet fork. It clones the Orca and Meteora programs, the pools, the vaults, the tick/bin arrays, the mints, and the Pyth price accounts. Then it runs the swap and checks the results.

The floor is `SWAP_FLOOR=16`. The round 33 validation says "16/16 swap-fork assertions." The gate checks that the floor equals the count.

But what if the Orca or Meteora programs on mainnet are upgraded? The gate clones the current mainnet bytes, so it always tests against the latest. The pinned sha256 of Core is hardcoded, but the Orca and Meteora programs are cloned at runtime. So a mainnet upgrade would cause the fork test to use the new bytes, and the suite would test against them.

**No defect, assuming the fork test passes.**

### R6.4: The run-tests.sh suite floor

```bash
MIN_ASSERTIONS=866
```

The round 33 validation says "866/866 assertions, floor 866." The suite runs the on-chain test (`tests/3prog.test.ts`), the off-chain selftests, the allocation test, the poster test, the probe (if network is available), the fork test, and the expiry-budget test. Each has its own floor, and the suite-level floor is 866.

But the suite-level floor is for the on-chain test only (the `tests/3prog.test.ts` output). The off-chain selftests have their own floors (`DET_FLOOR=909`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=23`, etc.). The run-tests.sh checks each of these floors.

The round 33 repairs added new on-chain arms (R33.G1-G4), which should have increased the suite's assertion count. The round 33 validation says 866/866, so the floor was moved to match. Good.

**No defect, assuming the floor is current.**

### R6.5: The expiry-budget gate

`tests/expiry-budget.mjs` creates synthetic genesis accounts and runs `expire_boosts` with 20 distinct due boosts under the default legacy CU budget. The floor is 4 assertions.

The round 33 validation says "4/4 expiry-budget assertions." The gate checks that the floor equals the count.

**No defect, assuming the test passes.**

### R6.6: The probe gate

`scripts/probe-mainnet-facts.mjs` measures:
1. The signature walk against a live busy program
2. The reserve mints being classic SPL
3. The ELF offset in ProgramData

The floor is `MAINNET_FLOOR=33`. The gate skips the probe if the network is unavailable.

The round 33 validation says "33/33 live mainnet probe." The gate checks the floor.

But the probe has been running against the same mainnet accounts (the ATA program for the signature walk, the three reserve mints, the Core ProgramData). If any of these changes (e.g., the ATA program is upgraded), the probe would need to be updated. The probe is not pinned to specific sha256 values (unlike Core, which is hardcoded). So a mainnet change would be detected by the probe and might cause a failure.

**No defect, assuming the probe passes.**

### R6.7: The launch check gate

`scripts/check-launch-params.mjs` refuses a launch value file unless every ruled value is correct, every bound is met, and the Proof of Burn root matches. The floor is `LAUNCH_FLOOR=47`.

The round 33 validation says "47/47 launch assertions." The gate checks the floor.

**No defect, assuming the gate passes.**

### R6.8: The swap fork as a certifying run

The ship gate (round 24 C10): the mainnet probe may not be skipped in a certifying run. The runner checks `CBOB_SHIP_GATE=1` and dies if the probe was skipped.

The swap fork is also a certifying run: `sim/swap-fork.sh` may not be skipped. The runner checks `CBOB_SHIP_GATE=1` and dies if the fork was skipped.

**No defect, by design.**

---

## The Four Questions About Accepted Limits

### 1. Is any limit WORSE than stated?

**L1 (box-clock skew):** The round 33 fix tolerates `cooldown/2` seconds of skew. For a 6-hour cooldown, this is 3 hours. For a 24-hour cooldown, this is 12 hours. If the box clock drifts by more than this, a false CRITICAL is paged. The limit should state: "Box-clock skew up to `cooldown/2` is tolerated; beyond that, honest sweeps page as unledgered."

**Item 10 (swap operator key):** The key can keep up to 10 SOL every 6 hours (the launch settings). The alarm watches `last_sweep_at` and `royalties_unswept` with a grace of `cooldown + cronPeriod + 3600`. For a 24-hour cooldown, the grace is 26 hours. The limit should state: "Per sweep: up to `max_sweep_lamports` (10 SOL at launch). Per cycle: one per `sweep_cooldown_secs` (6 hours at launch, up to 24 hours by vote). Total exposure: cap × windows until the guardian stops the sweep."

**Item 28 (frozen pool):** A frozen pool stops all paying claims. The round 24 D4 fix: a claim that pays reverts the whole transaction. A redemption sends no `claim` and forfeits its undelivered share. The limit should state: "A frozen pool: stops all payouts, all paying claims revert, redemptions forfeit undelivered share back to pool (logged `CBOB_REDEEMED_POOL_FROZEN`)."

**Item 46 (Giraffish Moments hot key):** The limit states the key can block every charter claim or admit only its own. The alarm pages on any plugin or update-authority change, but only once per pass. A rapid add-and-remove would not be detected. The limit should state: "The alarm samples the collection's plugins and update authority once per pass (every 30 minutes). A change added and removed between two passes is not detected."

### 2. Is anything listed as a limit not actually a limit?

**Item 6 (`flock` abort indistinguishable from never firing):** The abort case is now logged by the lock itself: "WARNING: did NOT release ... — it no longer carries this run's token." This IS a log, so the "indistinguishable" claim is no longer fully true. The limit should be updated: "An aborted `flock` run now leaves a WARNING in the log when the lock no longer carries this run's token (a break happened)."

**Item 7 (wedged-but-alive holder):** The `crank_silent` detector (round 23 M3) pages when an armed crank's heartbeat is over 3 hours old. This detects a wedged crank, but only if the wedged process can't write the heartbeat. If the process is alive but hung, it might still write the heartbeat (if the heartbeat is written before the hang). The limit should state: "A wedged crank that still writes the heartbeat is detected by `crank_failing` (3 consecutive failed actions) or `crank_problem` (1 problem in 3 consecutive passes)."

**Item 8 (cross-pass correlation lag):** This item was about the alarm not retracting a CRITICAL when a later pass correlates the burn with a `burn_vault`. The round 24 H1 fix: the alarm now sends recoveries for level kinds, and one-shots are sent ALERT_URGENT with the pass time. A false CRITICAL is still not retracted, but the recovery system means a corrected condition is quickly recovered. The limit should state: "Cross-pass correlation lag: a CRITICAL that was wrong is not retracted but recovers on the next full pass that finds it resolved."

**Item 9 (no detection of foreign Core asset nested in a vault):** The v6 version says "Nothing detects a FOREIGN Core asset nested in a vault continuously, and since v6 nothing refuses the redemption either." The round 29 D2 finding: an orphaned vault (nested in a burned host) that was ACTIVATED keeps its level weight forever. The `detectNestedVaults` detector pages `nested_vault`, but only for our own collection. A foreign Core asset in our collection would be detected (it's a CBOB vault, not foreign), but a CBOB vault nested in a foreign Core asset would not be detected. The limit should state: "`detectNestedVaults` walks our own collection and detects CBOB vaults owned by CBOB asset-signer PDAs. A CBOB vault owned by a FOREIGN Core asset is not detected."

**Item 10 (swap operator key):** The limit states the key can take royalty SOL. The round 24 C10 fix: a post-signing check in revenue.mjs throws when the operator's cbBTC delta is below the floor. So the key can take SOL but not cbBTC. The limit should state: "The swap operator key can take royalty SOL (up to `max_sweep_lamports` per `sweep_cooldown_secs`), but cannot take cbBTC (a post-signing delta check throws if the cbBTC return is below the oracle floor)."

**Item 19 (Pyth replay):** The limit states Pyth could be manipulated. The round 25 I3 fix: the confidence is checked (max 30 bps per USD feed). The limit should state: "Pyth is trusted for price and confidence. The age check (180s max, 30s future) bounds stale prices. The confidence check (30 bps max) bounds wide feeds. The pool-agreement check (100 bps max) bounds pool manipulation. A stale-but-confident or wide-but-confident Pyth is not bounded."

### 3. Is any DISCHARGED item not actually discharged?

**Item 1a/1b/2/3/4/5/11/15/16/18/20/21/23/24:** All these were about the Bank key, co-signer, deck, or distributor, which v6 deleted. They are truly gone.

**Item 14 (duplicate attribute keys):** `mint_vault` and `claim_charter_vault` refuse `DuplicateAttribute`. This is enforced on-chain. The selftest asserts it (assertion 11.4). Discharged.

**Item 12/17 (compute units):** Measured on the v6 build (assertions 10.1-10.4). The byte wall binds more than 25 times before the compute wall. Discharged.

**Item 19 (unlevelled-vault halt):** v6 has no state where a vault is activated but unlevelled. `activate` refuses a vault whose level is not drawn (`NotRevealed`). The payout reads the level from the vault's own record. Discharged.

**Item 30 (85/15 ratio as a vote):** `split_bps` is written once by `initialize` and no instruction can change it. Discharged.

**Item 31 (31-day branch):** The cadence is deleted; the free path's period is an `initialize` value. The suite exercises it (PG.8, PG.9, IN.*). Discharged.

**Item 33 (replacement swap operator 7-day notice):** The notice is an `initialize` value, exercised for both keys (3c.K5, 3c.G2). Discharged.

**Item 51 ($CBOB boost):** Built and tested. Discharged.

**Item 54 (compute at widest host shapes):** Measured (assertions 10.5, 10.6, 10.6a). The suite pins the limit. Discharged.

All DISCHARGED items are truly discharged. No defect.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 22 (mainnet dress rehearsal):** Not started. The round 33 validation says "Live launch dates, holder surfaces, the Phantom ceremony, the both-venue revenue cycle, forced post-sweep recovery and the deploy-dust recovery rehearsal remain open launch obligations." Not quietly accepted.

**Item 38 (launch values):** `launch/mainnet-init.json` has `charter_opens_at` and `lock_deadline` as OPEN. Not quietly accepted.

**Item 50 (holder surfaces):** The redeem page, deposit-address page, and public posting are not built. The round 33 validation confirms: "Round 33 stays NOT CLEAN; rounds 34 and 35 must each be clean." Not quietly accepted.

**Item 52 (pool and revenue accounts):** Not done. Road step 10 creates them. Not started.

**Item 53 (dress rehearsal at throwaway IDs):** Not started. Not quietly accepted.

All OPEN AND BLOCKING items are still open. No defect.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

This is a v6 system. The programs become immutable at launch. Every bug found after launch is permanent. The current state:

1. **Off-chain pipeline has never run against a live deployment** (item 22). The crank, alarm, and revenue cycle have been tested on a local validator with real cloned Core, but the mainnet dress rehearsal with small real amounts has not been done. The first live run could surface issues that the local validator cannot reproduce (RPC differences, mainnet rent rate, token-2022 edge cases).

2. **The one trusted hop (swap operator) is an operational risk.** The key is online, on the box. A compromised key can drain royalty SOL up to `max_sweep_lamports` per `sweep_cooldown_secs` (10 SOL every 6 hours at launch). The swap is bounded by the oracle floor (150 bps below the oracle's expected output), but a sandwich attack or pool manipulation could still extract value within the 150 bps tolerance. The holder guide states this honestly.

3. **The $CBOB supply sits in a hot wallet on the box** (item 56). A compromised key can sell it or burn it to boost vaults the thief owns, at whatever boost terms a vote has set. The mint is safe (no mint or freeze authority), but the release wallet is not.

4. **The governance concentration is a business fact.** At quorum 21% and threshold 51%, the largest holder alone reaches quorum if 15% of Proofs of Burn go unclaimed. The top three (91) carry a key change (guardian or swap operator) on their own if 24.2% go unclaimed. This is not a code defect; it's the voting math.

5. **The charter window is a 7-day single point of failure.** Whoever holds the Giraffish Moments update authority (a hot wallet, by ruling) can block every charter claim or admit only their own. After the window closes, this exposure ends. But during the window, the entire project can be captured or killed by one hot key.

6. **The redeem page is not built.** Without it, a holder who redeems via a non-Bank client (e.g., a wallet's "burn" button) destroys everything in their vault forever. The sweep helper (`programs/cbob-vault-sweep`) is built and locked, but nothing calls it yet. The round 33 validation confirms this is still OPEN.

7. **The $CBOB boost is new and young.** It was built in stage 3c (2026-10-04) and is the youngest code here. The payout math, boost expiry, and weight changes are all new. Three independent test suites cover it, but it has not been tested against a live deployment.

8. **The alarm's sweep state detector (round 33 L1) still tolerates box-clock skew up to `cooldown/2` seconds.** For a 6-hour cooldown, this is 3 hours. A box with a stale clock could page false CRITICALs on every sweep for the duration of the skew. The root cause (box clock vs chain clock) is not fully fixed.

Concrete recommendations before launch:

- **Complete the mainnet dress rehearsal** (item 22). Small real amounts, all five programs deployed at throwaway IDs, the crank and alarm live, one full revenue cycle through both pools (Orca forced to refuse once, so Meteora runs), one forced post-sweep failure recovered by hand. This is the only way to surface issues that the local validator cannot reproduce.

- **Build the redeem page** (item 50). The sweep helper is ready. The page must: create destination ATAs in a prior transaction, run `judgeRedemptionCoverage` before the holder signs, sweep through the helper, claim (unless pool frozen), open, burn. Without the page, holders who redeem via other clients lose everything.

- **Publish the holder guide only after the page exists.** The guide says "Only open your vault on the Bank's redeem page" — but the page doesn't exist yet. Publishing the guide now would mislead holders.

- **Move the $CBOB release wallet to cold storage before launch.** The holder guide states this honestly. A box compromise or a backup compromise could move the entire $CBOB supply. The supply is currently in one hot wallet on the box.

- **Run a second audit round with a different model roster.** The freeze counter is at 0/2. The ship gate requires two consecutive clean rounds with different rosters. Round 33 was not clean (L1 LOW, D1-D3 INFO). Round 34 must be clean.

- **Fix the sweep state clock-mixing at the root.** The tolerance-based fix is a band-aid. The box clock should not be used in `detectSweepState` at all. Convert box `Date.parse(c.startedAt)` to chain time, or use only chain-anchored values. A clean fix would be: the cycle's start is the sweep's block time + the box-to-chain skew, measured at the time of the read.

These are the things that, if I were the one signing the deploy transaction, I would want done first.