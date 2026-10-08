# Round 40 Off-Chain Audit: CBOB v6 Vaults (crank, alarm, layouts, accrual, swap and revenue, gates, `web/test/`)

**Scope and method.** I read every file in the bundle. I ran nothing, so every claim below is a claim about source, with the measurement that would confirm or refute it. The `web/src/` page sources are **not** in this bundle, only `web/test/`. So I can judge whether each web test can fail. I cannot independently verify the page behaviour the tests describe, such as V39-1's re-read by address. That is a measurement limit, not a finding.

**Result: one confirmed gate defect in round 39's own repair (LOW, R0), two LOW findings, and several INFO notes.** I found no CRITICAL, HIGH or MEDIUM defect that survives my own measurement test. Several plausible candidates were checked and set aside; they are listed at the end so they are not re-filed.

---

## R0. Round 39's verdict and repairs

### R0-1 (LOW, CONFIRMED). The C04 repair is partly vacuous: one conjunct can never fail

**Where.** `web/test/ceremony.test.mjs`, the arm *"C04: the page uses the step-0 key ONLY to sign (signExact extra) and for its public address; it never reads its secret"*:

```js
const uses = [...page.matchAll(/newCollection[\w.\]()]*/g)].map(m => m[0])
uses.every(u => /^newCollection(\.publicKey\.toBase58\(\)\)*|\])$/.test(u))
```

**The problem.** In JavaScript, alternation (`|`) has the lowest precedence. So this regex is really two separate patterns:

- `^newCollection(\.publicKey\.toBase58\(\)\)*`, which is anchored at the start only, **not** at the end;
- `\])$`.

The first pattern matches the bare prefix `newCollection` with zero repetitions of the group. Every captured use begins with `newCollection`, so every use passes: `newCollection._keypair`, `newCollection)` and `newCollection.secretKey` all match. The "only to sign and for its address" conjunct is therefore dead.

What remains of the arm is three textual checks:

- `!/secretKey/.test(page)`;
- the `remember(...)` argument check;
- a literal count of `localStorage.`.

**A mutation that should turn the arm red but leaves it green.** Add this line to `web/src/pages/ceremony.mjs`:

```js
fetch('/x', { method: 'POST', body: JSON.stringify(ctx.newCollection) })
```

- The captured use is `newCollection)`, which passes the dead regex.
- The literal text `secretKey` does not appear in the source.
- No browser store is touched.

Yet `Keypair` serializes its internal `_keypair.secretKey`, so the key leaves the page. The arm stays green while the property it names ("never reads its secret"; "never kept") is broken. This is the same class round 37 and round 39's C01-C04 were about: an arm that cannot fail when its property breaks.

**Evidence if I am right.** Apply that mutation to a scratch copy and run `node web/test/ceremony.test.mjs`. The result should be **108/108**, unchanged. Round 39 reports "Red under each of three mutations". Those mutations presumably spelled `secretKey` or touched a store, so they were caught by the other conjuncts, not by this one.

**Impact.** Today's code is correct, per round 39 C04's source reading. The address key of a Core collection holds no authority after creation, so the property is hygiene. LOW under the round 37 rule.

**Fix.** Anchor the whole pattern:

```js
/^newCollection(?:\.publicKey\.toBase58\(\)\)*|\])$/
```

Wrap the alternation in a group so the `^…$` anchors bind both branches. Then show the arm red under the `JSON.stringify(ctx.newCollection)` mutation. Better still, add an arm that serializes the page's `ctx` after a build and asserts no 64-byte secret appears.

### R0-2. The other repairs (C01, C02, C03, C05, V39-1, V39-2), read as tests

- **C01 (`R39 C01`, `bank/selftest.mjs`).** The arm extracts `main()`'s real send block, from `for (const a of plan.retireBurned)` up to `// THE HEARTBEAT`, and records labels and keys.
  - mA (claims never sent) shortens the recorded sequence: red.
  - mD (activate before distribute) reorders it: red.
  - mR is caught by `a2`, where `Rec0` must appear in a claim batch.
  - **The arm is real.** Two residues: the reveal loop and the split call are outside the extracted block. A reveal sent out of order is refused by MINT (`RevealOutOfOrder`, which is benign), so the cost is fees, not value. Not a finding.
- **C02 (`R39 C02`).** The balance write runs as written (carried value, null element, page). The `vaults:` carry line is extracted by an exact anchored regex. If the line is changed, the regex fails to match and the picker returns `'MISSING'`, which fails the arm.
  - Under mH, mB and mC, both arms go red, as claimed. **The arm is real.**
- **C03 (`bundle.test.mjs`).** The arm runs `B.planRedemption` on six snapshots and requires byte equality with node's result and `n.v.length > 200`, so two identical throws fail it. **Not vacuous.** By construction it can only catch build-setting divergence (shims, aliases), which is its stated purpose.
- **C05 (HOLDER-GUIDE 121).** The guide now reads "(built, and published before launch)". That is consistent with SPEC item 50. **Holds.**
- **V39-1 and V39-2.** The test arms exist and their assertions would fail on the stated breakages (for example `prepareOpening` returning `ok` without the promised stray). The page source is not bundled, so I cannot confirm that the page's own `freshPlan` call matches what the regex arm pins. **Not verifiable in this pass.**

---

## R1. The crank (`bank/crank.mjs`)

I traced the following and found **no plan the program will refuse for a reason of our own making**:

- **Pass order and joins.** retire, preJoins, expire (before), split, distribute, expire (after), activate, claim. `monthly_inline` inside a preJoin claim always sees `waiting_to_join > 0` before its own joins, so it never credits ahead of them.
- **Weight and owed figures.**
  - The weight used for the credit is: on-chain weight + preJoin weight − weight of active vaults being retired − expiring boost weight.
  - A retiring vault's owed share is removed before its weight would be counted twice.
  - The owed figure for a preExpired vault equals MINT's carry-then-reweigh arithmetic.
  - The owed figure for a preJoined vault is `w × (acc′ − acc)`, which matches `join` at the old accumulator.
- **The frozen-pool tick.** The tick still runs, and the joins go out in join-only batches. MINT's `distribute` reads `(balance, _)`, ignoring the freeze state, and the `r.pending` branch of `claim` makes no transfer.

### R1-1 (LOW). The crank's attribute reader is a single fragile parser on the FIFO head

**Where.** `mintedAttributes()` uses `@metaplex-foundation/mpl-core`'s `deserializeAssetV1`. Any throw causes:

```js
skip reveal … next pass; break
```

Reveals are strictly FIFO from `revealed_total`. So if this SDK ever fails to parse the head vault, every later vault's reveal stalls on every pass, for as long as the condition lasts. No vault behind it can activate or earn.

**Why it matters.** The page's own reader (`parseCoreAsset`) is deliberately tolerant. `decode.test.mjs` shows it reading assets that carry plugin types 18 and 77 by number. The crank uses a different, stricter reader for the same job. An owner may add owner-managed plugins to their vault, and Core is upgradeable (limit 40). So a plugin layout the pinned JS SDK does not know, or does not round-trip, turns one holder's vault into a stop for everyone's reveal through our crank.

- The alarm would page `reveal_queue_stalled`.
- The only recovery is another client revealing the head vault.
- This is the same "one reader the protocol depends on" shape that round 36 fixed for the page.

**Evidence that would confirm it.** Call `mintedAttributes()` on an asset carrying:

- the round-28 maximum Autograph, beside all five owner-managed plugins;
- a registry entry of a type the installed `mpl-core` version does not enumerate.

If either throws while `parseCoreAsset` reads the Attributes body, the finding stands. If both parse, downgrade it to INFO.

**Fix.** Have the crank read the Attributes plugin through `web/src/lib/decode.mjs`'s `parseCoreAsset`, or through a bank-side equivalent that walks the registry by offset. Add a selftest arm feeding it an asset with an unknown plugin type.

### R1-2 (INFO). Confirmed-but-landed sends are counted as failures

`send()` treats any confirmation exception without a MINT Anchor code as `'fail'`. For a distribute that landed but timed out, `lastFailure` is `''`, so `judgeDistributeRefusal` returns `'fail'` even though `dist_epoch` moved. This produces a false crank page, and three in a row produce `crank_failing`. Nothing is mis-sent, because every follow-up is idempotent on chain.

Suggested fix: check for an epoch move before judging the code, since a moved epoch is benign whatever the message.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**Checked and holding:**

- every value fixed forever drifts as CRITICAL;
- a pending guardian or operator is a standing CRITICAL;
- the Proof of Burn collection's plugins and update authority are hashed and watched;
- all five program ids are covered by `program_not_locked` and `lock_deadline_unset`;
- the production list carries 21% / 51% / 3 days, 7-day notice, 1 SOL / 24 h / 0.1 SOL, 30 days and 3600;
- the frozen-pool covered-text strings match the crank's text exactly;
- an undelivered pass rolls back every one-shot baseline.

### R2-1 (INFO). `CBOBTC_SQUADS` is hard-coded in `detectNestedVaults`

The check uses the constant rather than `cfg['mint.bank_treasury']`. In a dress rehearsal with a throwaway `bank_treasury`, a rescued vault pages `unredeemable_owner` CRITICAL instead of `vault_awaiting_return`. This affects the rehearsal only. In production the value is pinned.

Suggested fix: pass the treasury in from config.

---

## R3. The layouts (`bank/layout.mjs`) and R4, the arithmetic (`bank/accrual.mjs`)

- **Struct parsing and offsets.** The struct parser is strict. Every `OFF_*` constant any program pins is compared. Seeds are scraped (D6 is now real). `BOOST_RING`, every `*_VERSION` and `*_SPACE` are evaluated from the Rust. I found no way for a struct edit to slip past.
- **Arithmetic.** `credit`, `pendingScaled` (carry added before debt, as `owed_of` does), `reweigh`, `ceilSats` and `available` are line-for-line MINT.
- **Boost handling.** The crank expires every due boost before distributing and every boost its own distribution makes due right after it. `boosts_stalled` exists. `cbob_mint` and both boost bounds are watched as fixed forever.
- **No divergence found.**

---

## R5. The swap and the revenue cycle

### (a) The oracle math

- `sats = lamports × p_sol × 10^(e_sol − e_btc) / (p_btc × 10)`, derived as 1e8 / 1e9 = 1/10. This is correct for either exponent sign.
- The integer division floors, and the floor is then floored again. Both round toward the vaults' loss, not their gain, which is the conservative direction for a minimum.
- `satsPerLamport` uses `Number()` on prices around 1e10 to 1e13, well inside 2^53. It is used only for the 100 bps filter, never for the on-chain floor.

### (b) Pyth account verification

The offsets 40, 41, 73, 81, 89 and 93 recompute correctly for `PriceUpdateV2` with `Full` = tag only.

**Is "owned by the receiver, at the derived address" sufficient?** Yes.

- The sponsored PDA `[shard u16 LE, feed_id]` under the push oracle can be created only by the push oracle.
- Its updates require Wormhole-verified messages.
- The push oracle refuses an update older than the stored one.

So nobody can write a chosen price or an older `publish_time` there. `write_authority` is not checked, and need not be, given the derived address.

The clock is the Clock sysvar read in the same `getMultipleAccounts` call, trusted exactly as far as the RPC is (limit 10(b)).

### (c) The deviation filter

- `orcaSpot = (sqrtPrice / 2^64)²` gives B per A in raw units, which is sats per lamport.
- `meteoraSpot = 1 / (1 + bin_step/10⁴)^active_id` inverts lamports-per-sat into sats per lamport.
- Both directions are correct.
- Double precision error is about 1e-12 relative, far below one basis point.

### (d) The minimum out

Both venues receive the same `minSats` in sats, which is the output units: Orca's `other_amount_threshold` with `a_to_b` and exact input, and Meteora's `min_amount_out` with X = cbBTC. **Same floor, correct units.**

### (e) The judge

It checks the output account, the floor bytes, the direction, the amount, rejects any compute-unit price, and checks both ATA creations. What remains for a tampered builder is already stated (round 38 C12): signer and writable flags, `host_fee_in`, and pool-owned keys. **No new gap.**

### (f) Account derivation

- **Orca.** Tick arrays use seeds `["tick_array", pool, start.to_string()]`, current then the two below. The oracle uses `["oracle", pool]`.
- **Meteora.** Bin arrays use `["bin_array", pool, i64 LE]`. For Y→X the active id rises, so the order is the active array then the two above. The bitmap is passed or the program id stands in for "None".
- **Missing arrays.** If the lower tick array is uninitialized, Orca refuses. That is classified `'refused'`, which falls back to Meteora, the safe direction. The fork run clones only arrays that exist, so if the second or third array is absent on mainnet, SW.1 would show it.
- **No defect.**

### (g) wSOL handling

`CloseAccount` returns any pre-existing balance to the operator. A delegate can only be set by the owner. The native mint has no freeze authority. A stranger can pre-create the ATA, but its owner is still the operator.

### (h) Failure and retry

I traced every uncertain send:

- An uncertain send records a `pending*Sig` and leaves the cycle open.
- A landed sweep or swap is recorded and the cycle continues.
- A refused sweep keeps `refusedSig` and never sets `sweepSig`.

**No path closes a cycle without a chain split ≥ the return, or a provably empty revenue ATA.**

### (i) What an adversary can extract within the tolerance

- **Per cycle.** At most the 150 bps floor, plus oracle error inside the gates. The confidence gates allow up to 30 bps per feed, about 60 bps combined. Up to 180 s of staleness allows whatever SOL/BTC moved in that time, typically under 50 bps.
- **A pushed pool.** A pool pushed to the 100 bps edge does not widen this: the floor binds execution, and the filter is read-time only.
- **In money.** At the ruled cap of 10 SOL a sweep (about $1,200 at about $120/SOL), the worst case is roughly 2.5% ≈ **$30 per cycle**. At about 3.4 cycles a day, that is about **$100 a day, about $3,000 a month**, and only if every cycle is sandwiched to the floor.
- **Meteora.** Its 10× thinner liquidity (about $0.9M) changes the cost of pushing the pool, not the floor.
- **Materiality.** This is small against 85/15 revenue at royalty scale, but it is real and unbounded in count.
- **Recommendation.** Have the alarm record the executed shortfall against the oracle per cycle. That turns systematic sandwiching into a visible trend; today `short_swap_return` fires only below 98%, which the floor already guarantees.

### R5-1 (LOW). "No priority fee anywhere" weakens two stated controls under congestion

**Where.** `judgeSwapInstructions` refuses any `SetComputeUnitPrice`. The crank sends every capture, reveal and claim with no compute-budget instruction at all.

**Effects that are not stated anywhere:**

- **(a) Limit 25 is worse than written.** Limit 25 credits "the crank's reveal lane runs every minute" as the control against lapse re-rolls. Under mainnet congestion, base-fee captures can miss the 300-slot (about 2 minute) window wholesale. That is exactly the "slow crank" lapse burst limit 25 describes, but caused by our own fee policy rather than an outage. Each lapse is a re-roll the minter may have wanted.
- **(b) Revenue cycles fail open under congestion.** A sweep that lands followed by base-fee swaps that expire on both venues becomes `refused`, then "every pinned venue refused", then an open cycle and hand recovery every time. That is the most dangerous procedure in limit 10 ("the hand path can" double-swap), now run routinely.

**Evidence.** In the dress rehearsal (item 22), measure the capture landing latency, in slots after `readySlot`, and the swap inclusion rate during a high-fee period. Record how often the window lapsed or a cycle opened.

**Fix.** Two options:

- Allow a bounded, judged priority fee in the swap: cap the fee lamports, pin the value in the judge.
- Give the crank's capture and reveal lane a small fixed priority fee and count it in `planCostLamports`.

Or state both effects under limits 25 and 10.

---

## R6. The gates

- `run-tests.sh` floors require equality.
- The web `run-all.mjs` floors sum to 642, which matches the validation record.
- SPEC's stated counts (895 / 930 / 39 / 24 / 4 / 14 / 49 / 33 / 71 / 16) agree with the floors.
- `cron-install.sh` arms `--live` only from our own uncommented, end-anchored tagged line, and refuses inside a rehearsal tree.
- `build-mainnet.sh` proves what its banner claims, including the sweep helper's byte identity against both the localnet rebuild and `target/deploy/`. It also states plainly what it does not prove.

**Finding:** the only vacuous arm I found is R0-1.

---

## The four questions on the accepted limits

1. **Is any limit worse than stated?**
   - **Limit 25**, under congestion (R5-1a): the reveal lane's protection depends on base-fee landing, which is not stated.
   - **Limit 10 / hand recovery** (R5-1b): hand recovery becomes routine under congestion rather than exceptional.
   - **Limit 40**: also reaches our crank's reveal liveness through the JS SDK reader (R1-1), not only Core's on-chain rules.
2. **Is anything listed as a limit not actually a limit?** No. The item 58 rescue already removed "orphaned forever".
3. **Is any DISCHARGED item not discharged?** Item 54's claim that "the crank is unaffected" holds for compute. Its liveness under fee pressure is not covered (R5-1). That is not a compute claim, so item 54 stands as discharged.
4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22 (including 22.5, the DAS `burnt` read), 38, 50, 52 and 53 are all still listed open, and `launch/mainnet-init.json` keeps three values OPEN.

---

## Checked and not filed

- The crank double-counting weight on burned and boosted vaults.
- Joins lost when a credit batch reverts. They are re-joined next pass, and `JoinWaitingFirst` blocks distributions meanwhile; the cost is liveness only.
- A stranger-written Pyth update.
- Orca and Meteora direction errors.
- Sweeping wSOL dust.
- The alarm's undelivered-pass baselines.
- `detectSweepState`'s symmetric window.
- Bypassing the C03 bundle equality.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the item 22 dress rehearsal under a deliberately congested period, and record numbers, not pass/fail.** Record:
   - capture latency;
   - swap inclusion rate;
   - executed swap shortfall against the oracle;
   - the crank's wall-clock time for a full pass at about 2,100 records.
2. **Settle item 22.5 with one real DAS read** of a collection containing a burned Core asset, now. A "no" answer forces a `bank/` change, and that resets the freeze.
3. **Do a human key-custody review in person, with Gary**, covering:
   - the guardian wallet;
   - the swap operator key;
   - the deploy authority, whose loss before step 11 forces new program ids;
   - the hot $CBOB release wallet;
   - the Moments collection's hot update authority for the 7-day window.

   Decide, in writing, whether the Moments authority moves to a multisig for those 7 days. It is the single largest stated exposure (limit 46).
4. **Run an alert drill.** Fire one alert of each one-shot kind into the live router and confirm a human sees each on a phone within the paging window. Confirm someone can reach the guardian wallet within one sweep cooldown.
5. **Reproduce the build on a second, independent machine.** Rebuild `dist/` from the release commit there and compare the sha256 of every program. This is the only bridge from "source names Gary's key" to "the deployed bytes carry it".
6. **Have a human read the four `initialize` transactions byte by byte, as signed, before signing them.** The checker validates the JSON, not the transaction (limit 38, A6).
7. **Test the published redeem page in a real browser against the real wallet extensions** (Phantom, Ledger through Phantom). Confirm the wallet does not rewrite the message: `signExact` refuses a rewrite, but a refusal would block launch, so measure it before the lock.