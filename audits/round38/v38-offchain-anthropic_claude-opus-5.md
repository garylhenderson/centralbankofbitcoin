# INDEPENDENT AUDIT — ROUND 38, OFF-CHAIN PIPELINE (+ MINT, SWEEP HELPER)

Audited tree as bundled at `45271f9`. I re-derived every claim below from the bundled source; where I could not execute something I say so and name the evidence that would settle it.

**Headline:** I found **no CRITICAL and no HIGH.** I confirm four of round 37's five repairs as correct and complete, and I find **one surviving defect in the repair of C02** (the frozen-pool tick). I also report one monitoring lane with no liveness signal at all, and I supply the quantified adversary bound R5(i) asked for, which has not previously been written as a number. Everything else I attacked held.

I am explicitly *not* re-filing round 37's C01/C03/C04/C05/C07 — I verified each repair and each arm's ability to fail, and report those verifications as verifications, not findings.

---

## R0. ROUND 37'S VERDICT AND THE REPAIRS

### Verified repaired, with the arm proven able to fail

| ID | Repair site | What I checked |
|---|---|---|
| **C01** | `bank/selftest.mjs` ack block | The three arms now drive `unredeemable_owner` (the only member of `ACKABLE_KINDS`), plus a positive control `R37 C01` that returns `INFO`. I traced each of round 37's three mutations: (m1) dropping the empty-`why` guard, (m2) accepting `true`, (m3) keying the ack lookup by asset alone — each now flips exactly one arm, because `applyAcks` reaches `ACKABLE_KINDS.has('unredeemable_owner') === true` instead of being short-circuited by `nested_vault`. **Repaired.** |
| **C03** | `detectors.mjs` `judgeCronTemplate` | `const live = src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')`, and `varHasN` is now **line-anchored** (`/^\s*FLOCK=…/m`). I checked the anchor, not just the comment strip: a trailing comment (`ls # FLOCK="$FLOCK -n"`) is a live line but does not start with `FLOCK`, so it cannot satisfy the definition either. The real template still passes; commenting line 83 refuses 5 lines. **Repaired, and slightly stronger than the verdict claimed.** |
| **C04** | `revenue.mjs` `audit()` | `c.sweptLamports \|\| (c.sendRejected ? 0 : c.intendedLamports) \|\| 0`. A refused row contributes `0n`; a landed row contributes `sweptLamports`; an open intent contributes `intendedLamports`. Note the `'0'`-is-truthy trap is not reintroduced (a `sweptLamports: '0'` row contributes `0n` through the first branch, not the second). The `R37 C04` arm extracts the real expression. **Repaired.** |
| **C05** | `SPEC.md` limit 10 | Now reads "about 34 SOL a day" with the mechanism. I re-derived it independently: `41 * * * *`, the chain clock is read at `~:41:02` while `last_sweep_at` is stamped when the sweep **lands** (`~:41:05`), so the run exactly six hours later reads the cooldown a few seconds short and the seventh-hour run sweeps. 24/7 × 10 SOL = 34.3. The cadence is stable, not drifting. **Correct.** |
| **C07** | `selftest.mjs` | The pin exists and is real: a `{sendRejected, sweepSig}` row yields `rejected_row_has_sweep` CRITICAL from `detectUnreconciledRevenue` in the same pass that `detectSweepState` is quiet for it, so the silence round 37 hypothesised is structurally impossible. **Correctly pinned.** |

### F1 (LOW) — the C02 repair plans joins the crank cannot send

**Construct:** `bank/crank.mjs` `planCrank`. The tick branch now runs with a frozen pool (correct — I confirmed on chain that MINT's `distribute` calls `read_token`, which never inspects the state byte, and reaches `tick()` before any frozen check; and `claim`'s `r.pending` branch joins and `continue`s with no transfer). The repair then fills `plan.joins`:

```js
if (plan.distribute) { for (const r of records) { … plan.joins.push([r.address, dest]) } }
```

but `plan.joins` is consumed **only** inside the block guarded by the pool state:

```js
if (poolOk && !pool.frozen) {
  …
  ready.push(...plan.joins)
  for (let i = 0; i < ready.length; i += batch) plan.claims.push(ready.slice(i, i + batch))
}
```

`main()` sends joins only through `plan.claims`. So with a frozen pool the tick lands, `plan.joins` is populated, and **nothing is sent for it**. The identical `plan.preJoins` *are* sent unconditionally, as a join-only `claim` — which is exactly what SPEC limit 28 says is legal ("a join goes through only in a claim that pays nothing (the crank sends join-only batches)").

**What this costs.** One hourly pass. On the next pass those vaults satisfy `request_epoch < dist_epoch` and arrive in `preJoins`, which is sent regardless of the pool. Nothing is lost.

**Why it is still a finding.** (a) `describePlan` prints `join after N` for transactions that are never built, so the operator's log and dry run over-report. (b) The new arm is named *"a FROZEN pool still ticks **and joins**"* and asserts `p.joins.length === 1` — it certifies a planner field that the sender drops, so the arm would stay green if the send path were broken further. (c) `audits/round37/VALIDATION.md` records "the crank ticks and joins during a frozen pool"; that is true of `preJoins` on a later pass, not of this pass's plan.

**Evidence if I am right:** drive `planCrank` with `pool.frozen = true`, `w = 0`, one `pending` vault at `request_epoch === dist_epoch`, month due → `{distribute: true, distributeKind: 'tick', joins: [[…]], claims: []}`. Then in a live/dry pass the log line reads `join after 1, claim batches 0` and no `claim` instruction is emitted.

**Fix:** build join-only batches when the pool is frozen, e.g. hoist the batching so `plan.joins` (and only `plan.joins`, never a paying claim) is batched when `poolOk && pool.frozen`; keep the credit and paying-claim guards exactly as they are. Then rename/extend the arm to assert `plan.claims` contains the join. If Gary prefers the one-pass delay, clear `plan.joins` in that branch so the log and the arm tell the truth.

### Round 37 claims I re-tested and agree were correctly rejected

* **C06** (SPEC's rescue destination). `grep` over the bundled SPEC: the destination is uniformly "always to the CBOBTC Squads (whether the host lives, is burned, or is the vault itself; review 35 M1)", and `rescue_nested` enforces `require_keys_eq!(a.new_owner.key(), a.config.bank_treasury, WrongRescueDestination)`. Correctly rejected.
* **C09** (reconcile liveness). The mechanism is real and I escalate it below under the accepted-limit questions, because **accepted limit 7's own enumeration is what is wrong**, not the absence of a detector in isolation.
* **C11** (`poolAvail` redefinition passes I4). Confirmed: I4 pins *call arguments*, not variable definitions. That is a stated scope, not a defect, and the same reasoning as round 36 C15.

---

## R1. THE CRANK

I checked every instruction the crank builds against MINT's `#[derive(Accounts)]` ordering, mutability and data layout. **All nine match**: `reschedule_reveal`, `capture_entropy`, `reveal_level` (9 accounts in MINT's exact order), `retire_burned`, `claim` (config, pool, token program, then pairs, with `crank_n = 0` so `k = 0`), `expire_boosts` (config + ≤20 records, inside MINT's `MAX_EXPIRE_BATCH = 30`), `split_revenue` (7 accounts, `config` read-only as the program declares), `distribute` (`pool_token` read-only, no remaining accounts — MINT requires `rem.is_empty()` on both the burn-false branches), `activate`.

**A plan the program will refuse:** I could not construct one that is not already classified. Specifically:

* Every race I could find is in `BENIGN` or is correctly *not*: `BoostsExpireFirst`/`JoinWaitingFirst` reach `judgeDistributeRefusal`, which only forgives them when `dist_epoch` or `last_distribute_at` actually moved; `PoolShort` is never forgiven. A planned `claim` naming a pending vault that is not yet eligible is *skipped* by MINT (`continue`), not refused, so no false failure.
* `plan.preExpires` exactly equals MINT's DUE predicate (`dist_epoch >= boost_end_epoch`, active, not retired, not retiring), so the crank's expiry batches really do clear `boosts_due` and the distribution cannot hit `BoostsExpireFirst` for a reason of the crank's own making.
* The plan runs against the chain Clock with no wall-clock fallback (`if (chainSec === null) throw`), so a box ahead of the chain cannot buy a `MonthNotElapsed`.

**A plan that pays or joins a dead vault:** none. `assets[]` is set by *positive* identification (Core-owned + `data[0] === 0` → burned; Core-owned + `data[0] === 1` → live; everything else `'other'`), burned vaults are retired and excluded from joins and claims, and `'other'` is reported and excluded. The one residual (`claim` between a bare burn and its retirement) is accepted limit 27 and the crank retires first, every pass.

**A reveal out of order:** no. The loop starts at `cfg.revealed_total`, walks `byIndex`, and breaks on a missing or already-levelled record or on un-captured entropy; the `--reveal-only` `memcmp` filter at `offsets('VaultRecord').level` (= 57) keeps only level-0 records, so the head of the queue is always present if it exists. `judgeRevealAttrs` distinguishes *send / revealed-elsewhere / mismatch* against the stored `attrs_hash`, and `revealAttrSource` sends `[]` only for a positively burned asset.

**Value anywhere the program does not pin:** no. The crank's key signs as fee payer and as `payer` for the reveal's Core attribute rent; the selftest pins the instruction-name set, that `programId` is always MINT, and that no SPL/System transfer is constructed. The fee floor is sized from the plan, the reveals keep the floor in reserve, and the over-ceiling path runs-and-warns once a day on its own stream.

Two notes, neither a finding: `REVEAL_RENT_LAMPORTS` uses the **test validator's** 6,960 lamports/byte rather than mainnet's 5,080, so the floor is ~37% stricter than mainnet needs (the safe direction, consistent with measured fact 9). And `MAX_PER_CYCLE_LAMPORTS = 50 SOL` in `revenue.mjs` is dead code — the on-chain 10 SOL cap always binds.

---

## R2. THE ALARM

I enumerated every fixed-at-`initialize` field of all four configs against `WATCH`. **Coverage is complete** for everything that can never change (the 85/15, both destinations, `max_supply`, `payment_mint`, `level_caps`, both PoB fields, both charter bounds, `monthly_secs`, `notice_secs`, all three tighten bounds, `cbob_mint`, both boost ceilings, `redeem_window_secs`, the three GOV tally fields), plus the five pending/armed fields, the five programs' authorities and hashes, Core, the four third-party programs, both collection plugin hashes, and the PoB collection's update authority. The production-value list asserts Gary's 21% / 51% / 3 days, the 7-day notice, the three tighten bounds, the 30-day month and the one-hour window.

**A dangerous state read as quiet:** I attacked `detectSweepState` hardest, since it is the one backstop a scan flood cannot delay. I could not defeat it. A thief's sweep must sit at least one full cooldown from any landed honest sweep, and `revenue.mjs` writes a row only once the cooldown has elapsed, so the `|t − startedAt| ≤ cooldown/2` window cannot contain both; a refused honest run writes `sendRejected`/`refusedSig` and never `sweepSig`, so it cannot explain anything; an uncertain send explains only via a direct `getSignatureStatuses` lookup, and a throwing lookup confirms nothing (the loud direction). The cooldown used is the smallest ever seen, bounded by 21600, which closes the "sweep then vote a longer cooldown" widening.

**A routine state paged every pass:** the only candidate I found is `index_disagrees_with_chain` under DAS lag, which is already stated (round 36 L5) with the correct reading — the 30-minute interval exceeds the router's 25-minute grace, so any observed lag pages once and then recovers.

### F2 (LOW) — the reconcile lane has no liveness signal, and accepted limit 7 does not say so

**Construct:** `bank/alarm.mjs`. `reconcile()` writes `{ at, paged }` to `RECONCILE_STATE` (`state.json.reconcile`). **Nothing ever reads `at`.** The dead-man's cron in `scripts/cron-install.sh` watches only `$ALARM_STATE` (`state.json`), written by the 30-minute pass. The reconcile has its own `flock` (`.reconcile`) and its own in-process lock, so a wedged-but-alive holder (accepted limit 7's exact shape) or a hand-edited crontab silently stops it.

**What is lost when it stops:** `detectUndeclaredTokenAccounts` is the *only* post-hoc control over the undeclared-holding class (accepted limits 9 and 44), and the redeem page — the only pre-signature control — is item 50, staged and unpublished. So the one running control over that class can stop with zero signal. The 30-minute report is honest about *scope* ("that is what `--reconcile` is for, and it runs DAILY") but makes no claim about whether it ran.

**Why this is an accepted-limit problem and not just a missing feature:** limit 7 enumerates the jobs a wedged holder stops — *"(the crank, the reveal lane, revenue)"* — and then asserts "v6 makes the stall survivable rather than silent", naming `crank_silent` and `royalties_unswept` as the repairs. The reconcile lane is a fourth lane with its own lock and is omitted from both halves. Limit 7 is therefore **narrower than the system it describes**.

**Evidence if I am right:** `grep -rn 'RECONCILE_STATE' bank/` shows writes only (`readLedger` in `reconcile()` for `paged`, `writeLedger` at the end) and no consumer of `.at`; `crontab -l | grep reconcile` removed, then 30 days of alarm passes with no finding of any kind about it.

**Fix (cheap):** in `main()`, read `RECONCILE_STATE.at` and page `reconcile_stale` HIGH past ~36 h, gated on the reconcile line being present in the crontab (the same `crankPosture` three-answer shape, so an unreadable crontab does not fail open). Add the kind to `ALARM_KINDS` as `level`, add both-ways arms, and amend limit 7's enumeration.

---

## R3. THE LAYOUTS

Round 24 D6 is genuinely closed: the `D6` block maps all eleven `SEEDS` entries to the `*_SEED` constant in the program that declares them, asserts `Object.keys(L.SEEDS).length === 11`, and fails on both a mistyped seed and a seed no program declares.

The assertions are real and I could not find a struct change that slips past:

* The field list is compared to `parseRustStruct` output **name and type**, and the parser now *throws* on any line it cannot read as one `pub name: Type` (so a private, `pub(crate)` or multi-line field cannot be silently dropped).
* Every `OFF_*` constant scraped from MINT, BURN and GOV is compared to the computed offset, **and** a second arm proves nothing scraped goes uncompared, **and** a third proves none of the scraped values is `undefined` (which is what makes a broken scrape fail instead of passing vacuously).
* The suite's own `OFF_*` copies are compared.
* Every `*_VERSION` constant in every program (including each program's copy of a sibling's) is mapped and compared; a bumped copy is caught.
* `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` are scraped from the Rust, evaluated, and held to `fixedLength(…) + padding` — so a field added at the end without a space change is red.
* `BOOST_RING`, `ACC_SCALE`, `LEVEL_WEIGHTS`, `REVEAL_WINDOW_SLOTS` and the leader-group constants are scraped from MINT, not typed here.

I independently recomputed `offsets('MintConfig')` through `last_sweep_at`, `level_caps`, `dist_epoch` and `cbob_mint` and `offsets('VaultRecord')` through `level` (57) and `carry_scaled`, and the `u128` / `[i64;64]` / `[u32;BOOST_RING]` sizes. All consistent. `collectionPluginsHash` correctly skips `key | update_authority | name | uri | num_minted | current_size` and is truncation-safe at every read.

One observation, not a finding: `collectionPluginsHash` hashes only the plugin region, so the **vault** collection's `update_authority` (bytes 1..33) is neither hashed nor recorded, while the PoB collection's *is* (`pob_collection.update_authority`). That asymmetry is defensible — the vault collection's authority is MINT's `["mint"]` PDA, verified at `initialize`, and no instruction in any of the five programs issues `UpdateCollectionV1` — but it means a Core-level change to who may take that authority would be invisible except through `prog.core.hash`. Two lines (`snap['collection.update_authority']` + a CRITICAL `WATCH` row) would close it.

---

## R4. THE MONEY ARITHMETIC

I compared line by line and found **no divergence**:

| program | `bank/accrual.mjs` |
|---|---|
| `credit`: `delta = avail*ACC_SCALE/w; acc += delta; owed += delta*w` | identical |
| `owed_of`: `weight*acc + carry − debt`, carry added **before** the subtraction | `pendingScaled`, same order (this ordering is load-bearing: after `reweigh`, `debt == weight*acc` exactly, and a claim's settlement can leave `carry` above that) |
| `weight_of`: `LEVEL_WEIGHTS[level−1] + boost_weight` | `weightOf(level) + boost` |
| `ceil_sats` | `ceilSats` |
| `reweigh` (owed → carry, debt restarts at the new weight, denominator moves by the difference) | `reweigh`, identical |
| `join`: `debt = LEVEL_WEIGHTS[level−1] * acc`, `carry = 0` (a pending vault cannot carry a boost — `boost_vault` requires `active`) | `debtAtActivation` |

The crank's three owed branches each reproduce the chain exactly:

* `joinedNow`: `pendingSats({debt: w*acc_old}, acc_new)` = `w*(acc_new − acc_old)` — what MINT computes after `join` then `credit`.
* `preExpired`: `atExpiry + levelWeight*(acc_new − acc_old)` — what MINT computes after `expire_boost` (carry = owed at the old acc, debt = levelWeight × acc_old) then `credit`.
* otherwise: the stored debt/boost/carry at the post-distribution accumulator.

`retiringOwed` matches `retire`'s `owed_of(r, c.acc_scaled)`, and the planner's `w` subtracts exactly what the chain will subtract (retires at `level + boost`, expiries at `boost`, joins add `level` only). A vault that is both retiring and boost-due is counted once (`preExpires` excludes `retiring`).

`ALLOC_FLOOR = 39` equals the 39 assertions I counted in `accrual.mjs`. The crank expires due boosts before the distribution and the ones its own distribution makes due immediately after (`boost_end_epoch === dist_epoch + 1`), and the alarm pages `boosts_stalled` and watches `cbob_mint`, `max_boost_weight` and `max_boost_epochs` as CRITICAL-on-change. All four R4 requirements hold.

---

## R5. THE SWAP AND THE REVENUE CYCLE

### (a) The oracle math — correct in every sign, direction and rounding

`sats = lamports × sol.price × 10^(es−eb) / (btc.price × 10)` is the right reduction of `lamports·1e−9 · (SOL/USD)/(BTC/USD) · 1e8` (the `1e−9 · 1e8 = 1/10` is where the lone `10n` comes from). The sign split (`e ≥ 0` multiplies the numerator, else the denominator) is correct for both signs, and all arithmetic is BigInt so there is no exponent-driven float path. Truncation floors `expectedSats` and then `minSats`, i.e. marginally *more* permissive by at most one sat — the harmless direction.

`satsPerLamport` is algebraically `expectedSats / lamportsIn`, so **the deviation filter and the on-chain floor are the same oracle quantity** (this is R5(d)'s question, and the answer is yes). `Number(sol.price)` and `Number(btc.price)` at realistic magnitudes (1.2e10, 8.6e12) are far inside 2^53, so no precision is lost; even at absurd magnitudes the only consumer is the 100 bps gate, whose relative error stays ~1e-16.

Satisfiability check: a pool admitted at the worst allowed point (99 bps *worse* than oracle) must still deliver oracle − 150 bps, leaving 51 bps for fee plus impact. Orca's fee is 16 bps and a 10 SOL swap on ~$10 M is negligible impact, so the floor is reachable. I verified the measured Meteora numbers independently: `(1.0015)^5920 = 7146` lamports per sat → 1.3995e-4 sats/lamport, against 1.4017e-4 from the quoted SOL $120.45 / BTC $85,929 — a 16 bps agreement, consistent with SW.0 passing.

### (b) Pyth account verification — recomputed, and adequate

I recomputed `PriceUpdateV2`: disc 0..8, `write_authority` 8..40, `verification_level` at 40 (`Full` = tag 1, one byte; `Partial` = tag 0 + `u8`), `feed_id` 41..73, `price` 73..81, `conf` 81..89, `exponent` 89..93, `publish_time` 93..101. `readPyth` reads exactly those, and the fork's rewriter and the selftest's synthetic account both stamp `publishTime` at 93. **Offsets correct.**

Is owner + derived address + `Full` + feed id sufficient? Yes, given the write-authority model: the account is a PDA of the pinned push-oracle program, so no stranger can initialise it with their own write authority, and the receiver's update path accepts only Wormhole-verified Pyth messages for the matching feed id. The code does not check `write_authority` — I looked for a way that matters and could not find one, because the address itself is the authority constraint. A chosen price or a replayed old `publish_time` therefore requires the push program's key, which is in `THIRD_PARTY_PROGRAMS` and watched. An old genuine message is caught by the 180 s staleness check.

The clock is trustworthy to the extent limit 10(b) already states: the address is `SYSVAR_CLOCK_PUBKEY`, the owner is checked against `Sysvar1111…`, and the Clock is read **in the same `getMultipleAccountsInfo` batch as the prices**, so staleness is judged against a consistent snapshot. The only trust is the single RPC endpoint, already an accepted limit. An unreadable or foreign-owned Clock refuses the cycle; `oracleFloor` with no clock refuses; a `publishTime` more than 30 s ahead refuses.

### (c) The deviation filter — right quantities, right directions

`orcaSpot = (sqrt_price/2^64)^2` is B-per-A in raw units with A = wSOL (9 dp) and B = cbBTC (8 dp), i.e. sats per lamport — the same unit as `satsPerLamport`. `Number(sqrtPrice)` loses ~1.1e-16 relative, doubled to ~2.2e-16 by squaring: fourteen orders of magnitude below the 100 bps gate, so **floating point cannot pass a pool it should refuse**. `meteoraSpot` correctly inverts `(1+binStep/1e4)^activeId` because the pair prices X (cbBTC) in Y (wSOL) — reversed from Orca, as the comment says — and I confirmed the inversion against the quoted mainnet state above.

### (e) The judge — complete for every value-moving role

The judge requires the **exact seven-instruction sequence**, each slot fully pinned: the CU limit (`data.length === 5`, `data[0] === 2`, `readUInt32LE(1) === 400000`, zero keys); both ATA creations with all six keys recomputed from the mint and owner; the System transfer (`readUInt32LE(0) === 2`, 12 bytes, keys `[owner, ata(wSOL,owner)]`, amount `== lamportsIn`); `SyncNative` of that account; the venue swap (program, `swap` discriminator, exact data length, amount, threshold, and for Orca the `a_to_b`/exact-input bytes and the pinned `MIN_SQRT_PRICE`, plus pool/input/output/signer at their pinned indices); and exactly one `CloseAccount` back to the owner, last. Globally it refuses any other program, any second signer, `SetComputeUnitPrice` anywhere, and any Token instruction but 17 and 9.

I verified the account orders against both published interfaces: Orca `swap` v1's eleven accounts (`token_program, authority, whirlpool, owner_a, vault_a, owner_b, vault_b, tick_0..2, oracle`) and Meteora's fifteen plus bin arrays as remaining accounts, with `host_fee_in` and the bitmap passed as the program id for Anchor's `None`.

**What a tampered builder could still route past it, exhaustively:** only Meteora's `host_fee_in`. The judge does not pin it, so a tamper could name a stranger's cbBTC account there. I traced the consequence and it is **not a loss**: the host fee is a share of the *protocol* fee, taken from the fee rather than from the user's output, so `min_amount_out` still binds on our side, and the amount we currently forgo by passing `None` is a few basis points of the fee (cents on a 10 SOL swap). Every other unpinned key on either swap (vaults, reserves, mints, oracle, tick/bin arrays, token programs, event authority) is constrained by the venue program's own `has_one`/seeds/`Program<…>` checks. Pinning `host_fee_in` is a one-line hardening, not a defect.

Unpinned writability cannot leak value — it can only cause the venue to refuse. The transaction's fee payer and signature count are chosen by `revenue.mjs`, not the builder.

### (f) Account derivation — recomputed

* Orca tick arrays for `a_to_b`: `span = 88 × tickSpacing`, `s0 = floor(tick/span)×span`, then `s0 − span`, `s0 − 2·span`. **Floor, not truncation** — essential for negative ticks, and I confirmed `floor(−88733/1408)×1408 = −90112` matches the recorded mainnet measurement. Selling A pushes `sqrt_price` and the tick **down**, so arrays below are the correct direction. Oracle PDA `["oracle", pool]`, vaults read from the pool. ✓
* Meteora bins for Y→X: buying X makes X dearer in Y, so `active_id` rises; `[i, i+1, i+2]` with `i = floor(active_id/70)` (floor handles negatives, armed at `−1 → [−1,0,1]`). `bin_array` seeds `["bin_array", pool, i64 LE]`, bitmap `["bitmap", pool]`, oracle `["oracle", pool]`, event authority `["__event_authority"]`, two token programs, `host_fee_in` as `None`. ✓

**At a tick-array / bin-array boundary or an uninitialised array:** both programs require the arrays they are handed to exist and belong to the pair, and neither builder can fall back to repeating `tick_array_0`. So if the pinned pool's lower tick arrays (or upper bin arrays) are ever uninitialised, that venue refuses *every* swap, Meteora is tried, and if both refuse the SOL sits on the operator with a loud open cycle and hand recovery. That is a liveness risk, not a loss, and today it cannot be latent: `sim/swap-fork.mjs plan` clones only accounts that exist, so a missing array would make the fork gate fail rather than pass. Worth knowing, not worth a finding.

### (g) wSOL handling — traced every stated case

Pre-existing balance: `createIdempotent` succeeds, `SyncNative` adds the raw lamports, the swap sells only `lamportsIn`, and the final `CloseAccount` is legal with a non-zero balance **because the account is native** — so any leftover is unwrapped to the operator. Our money either way; no loss. Frozen: wSOL's native mint has no freeze authority, so unreachable. Delegate: irrelevant, our own authority signs. Created by a stranger: the ATA address is derived, so the owner is still the operator (and round 33 already arms a stranger's pre-filled account).

**What is left behind if the venue consumes less than the input (INFO, probably unreachable):** the close unwraps the unspent wSOL to the operator, `returnedSats` records only the cbBTC delta, and **nothing reads the operator's SOL balance** — so a residue would be silent. I could not construct the case: Orca's exact-input swap with `sqrt_price_limit = MIN` errors (it needs a fourth tick array) rather than partially filling, and Meteora likewise errors when its remaining bin arrays are exhausted. And the 100 bps gate plus the 150 bps floor bound any hypothetical residue to ≈2.5% of the cycle (≈0.25 SOL at the cap), because a fill fraction below 97.5% cannot clear the floor from a pool within the gate. **Evidence that would settle it:** a fork run with the lower arrays deliberately thinned, checking whether the venue reverts or returns a partial fill. Cheap insurance either way: after the return, assert the operator's lamports are within a few thousand of the pre-cycle value less fees.

### (h) Failure and retry — the ledger cannot read a failed cycle as closed

Meteora is tried only on `outcome === 'refused'`; `'unknown'` records a candidate signature and rethrows, never trying a second venue; `'landed'` records the signature and proceeds. A confirmation timeout on a swap that later lands therefore cannot *silently* double-swap: the second venue's wrap would need `lamportsIn` the operator no longer holds, so it refuses and the cycle stays open and CRITICAL (that is the hand-recovery path limit 10 documents, with the explicit instruction to look up every candidate signature and read both balances first). A genuine double swap requires the operator to hold `2 × lamportsIn` of its own funds, which limit 10 D2(1) already forbids and nothing on chain enforces.

I confirmed `cycleIsOpen` cannot close a failed cycle: a landed sweep with no return is open; an uncertain sweep (intent only) is open; a `sendRejected` row that nevertheless carries a sweep is CRITICAL twice over (`rejected_row_has_sweep` from the ledger and `sweep_on_rejected_row` from the walk); a fabricated `splitSig` is `split_not_on_chain`; an early or too-small named split is `split_claim_unanchored`; `splitByOther` requires a real unclaimed split at-or-after the return and at least as large. The `closesCycle` rewrite (sort once, binary search) is sound — `atOrAfter` is monotone in the sorted order, so the search is correct — and the `WeakMap` cache keyed by array identity and length is safe because no caller mutates a split list in place.

One note on the recovery anchor: `splitsSince` starts at the return's **chain** time when it is known, which is round 34 L3's repair, and the stated residual (a pre-`returnBlockTime` row with a fast box clock) is accurately described.

### F3 (LOW) — the extractable value per cycle has never been written as a number, and the 150 bps floor is ~9× the fee it exists to cover

**Construct:** `bank/swap.mjs` `SWAP_TOLERANCE_BPS = 150` against `MAX_POOL_DEVIATION_BPS = 100` and the ruled 10 SOL cap. This is **not** one of the owner's rulings (the rulings fix Orca-then-Meteora and the sweep cap/cooldown/reserve, not the tolerance), so it is in scope.

**The bound, as R5(i) asks:**

* Per cycle, the on-chain floor guarantees `oracle − 150 bps`. An honest Orca execution costs ~16 bps of fee plus negligible impact, so a searcher who sandwiches our swap can extract the **difference**, ≈130 bps of the swap value ≈ **0.13 SOL ≈ $16** at the 10 SOL cap.
* The schedule is highly predictable: the cron fires at `:41`, the `sweep_sol_for_swap` transaction is public, and the swap follows seconds later from a **known, long-lived** operator key. A searcher needs no information advantage.
* Per month at the throughput ceiling (one cycle every 7 h ⇒ ~103 cycles): ≈ **13 SOL ≈ $1,600**, of which 85% (~11 SOL) is holders'. Against ~1,000 SOL/month of royalty at the 34 SOL/day ceiling that is **~1.3% of royalty revenue** — not catastrophic, and not nothing.
* A pool pushed to the edge of the gate adds nothing beyond this: the gate is read-time only, the floor is execution-time, and the floor is what binds.
* A stale-but-accepted oracle (up to 180 s old, 30 s future) mostly causes *skips*, because the pool tracks the true market and drifts out of the 100 bps gate against a stale oracle. The compound worst case is the floor computed from a ~1% stale price, i.e. ~2.5% below true market on one cycle (~0.25 SOL).
* Meteora at ~10× thinner changes nothing about the bound: the floor still binds at 150 bps. It only makes the sandwich cheaper to execute.
* Below ~1 SOL per cycle the fixed cost of sandwiching likely exceeds the gain, so small cycles are effectively safe; the exposure is concentrated at the cap.

**Is it material?** At 1.3% of royalty revenue, borderline — but it is permanent (immutable programs, and only a vote can lower the cap), it is the *only* place in v6 where value leaks to strangers by design, and it is cheap to halve.

**Fix (two independent options, neither touching a ruling):**
1. **Tighten `SWAP_TOLERANCE_BPS`.** 60–75 bps still covers Orca's 16 bps fee plus a comfortable impact margin on a $10 M pool and halves the extractable amount. The cost is more refusals in fast markets, each of which is a *hand-recovery* event — so pair it with (2).
2. **Put the sweep and the swap in ONE transaction.** `sweep_sol_for_swap` needs the operator's signature and four accounts; the swap is seven instructions. One v0 transaction removes (a) the sandwich window between a visible sweep and a predictable follow-up swap, (b) the entire open-cycle class between sweep and swap, (c) the need for the 2% requote guard, and therefore (d) the hand-recovery path that limit 10 names as the only path that can double-swap. This is the single largest structural improvement available to the revenue cycle and it is an off-chain change only.

**Evidence if I am right about the number:** on the dress rehearsal (item 22 §3), record the executed sats against `expectedSats` for each cycle; without an adversary present the gap should be ~20–30 bps (fee + impact). The 150 bps floor is the permission slip for the remaining ~120 bps, and a searcher-run cycle would land at or just above `minSats`. The fork's SW.8/SW.9 arms already print this figure ("N bps under the oracle") for the ruled 10 SOL cap — compare those recorded numbers with 150.

### Also on the revenue cycle

* The operator-key worst case under the new trust set is: the two pool programs and Pyth (bounded by age, confidence, pool agreement and the on-chain floor, not removed), the one RPC endpoint, the integrity of `swap.mjs`/`revenue.mjs`, and the four third-party upgrade keys — all four of which are now watched at HIGH with values produced even when ProgramData is absent (`NO_PROGRAMDATA`), and I confirmed the four watched ids equal `swap.mjs`'s pins.
* The 2% requote guard (`MAX_REQUOTE_DRIFT_BPS`) is **one-sided**: it aborts only when the oracle moves *against* us between the two reads, after the SOL has moved, converting a fast market move into the hand-recovery path. That is a deliberate trade and it is stated; option (2) above removes it entirely.
* Stage markers: `revenueNotices` only sends a recovery for a stage this pass actually passed, and `enterStage` adds the previous stage. A cooldown no-op leaves `revenuePassed = {lock, config}`, so it cannot clear a `swap` or `recovery` marker — which is what the round-26 arm asserts and what I re-derived.

---

## R6. THE GATES

**Floors.** I counted them rather than trusting them. `POSTER_FLOOR = 24` matches the 24 `t(…)` calls in the poster selftest; `ALLOC_FLOOR = 39` matches `accrual.mjs`; `LAUNCH_FLOOR = 49` matches `check-launch-params.mjs` (including the 11 `L5` per-key arms); `HOST_FLOOR = 6` matches five `#[test]` functions plus `declare_id!`'s generated `test_id` (measured fact 11); `EXPIRY_FLOOR = 4` matches `assert.equal(count, 4)` inside the test itself; `DET_FLOOR = 925` equals `selftest.mjs`'s own `FLOOR`, and the selftest asserts that equality in both directions. `floor()` demands **equality**, and SPEC's stated counts are checked at *every* occurrence. No floor can be satisfied by deleting work without going red.

**Arms that cannot fail.** I went looking specifically, including the round-24 section the prompt flags. I traced the failure mode of every round-24 arm (L1 `judgeDistributeRefusal` with moved/unmoved config; L2 `revealAttrSource` + `Buffer.from([undefined]) === 00`; L3 driven through the real planner for all three blockers; L4a/b/c `crankPosture` three-answer and the streak reducers; L5 `carryConfigBaseline` across a blip in both directions; L6a all four funded/short × above/below-ceiling quadrants, L6b with the real 1,100-capture plan; L7 all four reserve-read outcomes; L8 the three-reserve correlation keyed on the vault not the composite key; L9 the index race in three directions; L10a–d and L11 against the ledger detectors; I1 `returnBlockTime` before/after; I3 the forfeit line's invoke-stack attribution; I5 the frozen transition set; H1 against the **real** `alert-router.py` in a throwaway state dir). **Every one can fail.** The round-24 `L13d` recomputation defect is genuinely gone — `ATTRS_VECTOR` is a pinned hex constant and `readySlot` is pinned to three hand-worked values.

The one arm I would change is the **new** `R37 C02` arm (finding F1): it asserts a planner field that the sender drops, so it would stay green if the send path regressed further. That is the defect, not a vacuous assertion in the round-24 block.

**Vacuous-on-empty.** The structural guards are present where they matter: the offset gate has a companion `a === undefined` arm, the seed gate pins the count at 11, the version gate pins the set of five struct names, the `everywhere()` reader requires `found.length > 0`, the control-table gate requires `block.length >= 5` and that *every* row carries a classification, the signer scan asserts its own file list is non-empty and includes `selftest.mjs`, the DAS-reader discovery asserts it still finds `alarm.mjs`, the ID gate pins 14 mutable copies, and the router arms fail loudly (`ROUTER UNAVAILABLE`) if `alert-router.py` is missing rather than passing.

**`scripts/build-mainnet.sh`** proves what it says for five programs: it refuses a dirty tree, greps each of the four keyed programs' non-localnet `INIT_AUTHORITY` block for Gary's key, deploys **both** builds to a validator with byte-verified mainnet Core and requires mainnet to REJECT / localnet to ACCEPT the test key for all four, asserts `dist/` holds exactly five `.so`, and proves the sweep helper's mainnet bytes equal both the localnet rebuild **and** `target/deploy/` (the file the suite and sim actually deployed). The closing banner's NOT-PROVEN paragraph is honest. Adding a key to the sweep helper later would break the byte-identity comparison, so the "no key to ask about" claim is self-enforcing.

**`scripts/cron-install.sh`** arms nothing it should not: both money lanes are opt-in, preservation runs only on *our* tagged, uncommented line anchored to end-of-line (so `crank-reveal` cannot arm `crank` in either flag order), the posture print is **computed from the crontab just written** rather than asserted, the installer refuses outright in a rehearsal tree before touching crontab or logrotate, `$FLOCK` existence is a hard gate, and the lock directory is deliberately not `/var/lock` (tmpfs), `$LOGDIR` (rotated) or `/tmp` (world-writable). The selftest executes the real preservation shell for all nine cases.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

### 1. Is any limit WORSE than stated?

* **Limit 7 is narrower than the system it describes** — see **F2**. It enumerates "(the crank, the reveal lane, revenue)" and claims the stalls are "survivable rather than silent", naming the two detectors that make that true. The **reconcile lane** has its own lock, its own `flock`, and **no liveness signal of any kind**; the field that would provide one (`RECONCILE_STATE.at`) is written and never read. Since the reconcile is the only *running* control over accepted limits 9 and 44, this is the gap that matters most in limit 7.
* **Limit 28's parenthetical "(the crank sends join-only batches)"** is true of `preJoins` and false of the post-tick `joins` — see **F1**.
* **Limit 36's skip list for the in-line monthly run** omits two real skip conditions: a pool account that is not (yet) a token account of ours, and a **frozen** pool. Both are in `monthly_inline` and the frozen case is covered in limit 28, so this is incompleteness of one list, not a misstatement of behaviour.
* **Limit 10's "bound, as a number"** gives the floor (150 bps) but not what that floor *permits an adversary to take*. **F3** supplies it: ≈0.13 SOL of excess per cycle, ≈13 SOL/month at the ceiling, ~1.3% of royalty revenue, on a predictable schedule from a known key. Nothing in the limit is false; it under-specifies the one number a holder would want.

### 2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?

I checked the ones most likely to have drifted and found **none closed**:

* Limit 9 (foreign nested Core assets) — still open; `detectNestedVaults` walks our own collection only, and the only pre-signature check is the unpublished redeem page. Item 58 closed the *CBOB-vault-inside-a-vault* case only, which the limit now says correctly.
* Limit 27 (claim between a bare burn and its retirement) — `claim` still does not take the asset account, so still accepted; the crank's mitigation is real and present.
* Limit 29 (only cbBTC splits) — `split_revenue` still refuses any other mint, and no instruction moves a non-cbBTC token out of the revenue PDA.
* Limit 32, 41, 43, 44, 45, 49, 55, 56, 57 — each re-read against the code and each still live. Limit 44's claim that the helper "moves any classic token account the vault PDA owns, of any mint, ATA or not" is exactly what `programs/cbob-vault-sweep` does (`read_token` constrains owner and mint, never the derivation).

### 3. Is any DISCHARGED item not actually discharged?

* **Item 51 ($CBOB boost)** — genuinely discharged. `boost_vault` (owner-only via the asset's current owner bytes, `BoostTermsMoved` one-sided, `BoostActive`, `BoostsOff`), `expire_boosts`, `set_boost_terms` with the init ceilings, the `carry` so a weight drop never needs a negative debt, the `BoostsExpireFirst` gate, the ring with `MAX_BOOST_EPOCHS_BOUND = BOOST_RING − 1`; mirrored in `accrual.mjs` (`reweigh`, `pendingScaled`), in the crank (both expiry phases) and in the alarm (`boosts_stalled`, three CRITICAL fixed-forever rows).
* **Item 54 (compute)** — discharged, and I re-derived its load-bearing claim that "the bank's crank is unaffected". The crank sends every capture and every reveal as its own transaction with no piggybacked crank, passes `crank_n = 0` on every `claim`, and passes no remaining accounts to `activate`. I walked each crank instruction against the quoted figures and none approaches the 200,000 legacy default: a reveal that still has to capture inline is ~150 k; a 14-vault claim batch is ~60 k; the twenty-due-boost `expire_boosts` is gated at <200,000 by `tests/expiry-budget.mjs`. So the crank genuinely needs no compute-budget instruction.
* **Item 12/17, 14, 19, 30, 31, 33** and the fourteen v5 Bank/deck/distributor items — discharged, and the selftest enforces the removals (retired files deleted, no file *reads* a retired key path, exactly two signers in `bank/`+`scripts/`+`tests/`, each on its own key).

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** All five are still open in substance, and the tree reflects it:

* **22** — road step 8 "not started"; `run-tests.sh` never invokes `revenue.mjs`, and its selftest arms read source. The five named rehearsal items are intact.
* **38** — `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline` and `vault_collection` as `OPEN`, and `check-launch-params.mjs` refuses the committed file for exactly that (its own arm asserts the refusal). I independently re-checked every ruled value against every `initialize` bound and against the alarm's production list: all consistent.
* **50** — built and staged, not published; `redemption-poster.mjs` still has no sender and its own selftest proves it cannot acquire one. The holder guide is still marked DRAFT and still speaks of those surfaces in the present tense, which is precisely what item 50 forbids publishing.
* **52, 53** — open. In particular item 53's named prerequisite, `launch/rehearsal-init.json` plus a rehearsal mode in `check-launch-params.mjs`, is **still absent**: `judgeLaunch` has no rehearsal flag and would refuse a rehearsal value set for not being the ruled mainnet values. The item says so; it is not being treated as accepted.

---

## ANYTHING ELSE

* **INFO — an unreadable transaction amplifies, not just blinds.** In `alarm.mjs`, one failed `readParsedTransaction` sets `unread`, so neither the cursor nor the backlog advances. Stated. What is *not* stated is the second-order effect: with no backlog recorded, the next pass re-walks the **same** window from the same cursor and re-emits every finding in it — and walk-derived one-shot kinds (`approve`, `bare_core_burn`, `non_ata_token_account`, `unledgered_sweep`) are sent `ALERT_URGENT` with the pass time in the text, so each becomes a **new email every 30 minutes, indefinitely**. `tx_unreadable` is a level kind, so a human is told daily; the amplification is on the streams that matter most. I could not construct a cheap way to produce an unreadable transaction — the strictest checks are unreachable for a landed transaction (duplicate account keys are refused by the runtime as `AccountLoadedTwice`; truncated logs are handled by `'flag'`; raw data is always valid base58; the money-instruction `info` shapes are what jsonParsed emits) — so I report the consequence and my inability to trigger it rather than claiming an exploit. **Evidence if reachable:** two consecutive passes with one unreadable signature in the window and one `approve` finding in it would show two identical-but-restamped urgent emails on `cbob-vault-alarm:approve`. Cheap mitigation: after N consecutive passes with the same `unread` signature set, record a one-signature backlog so the cursor can step over it under the existing human-review watermark discipline.
* **INFO — `judgeSwapInstructions` does not pin Meteora's `host_fee_in`.** Harmless (analysed in R5(e)); one line to close.
* **INFO — the vault collection's `update_authority` is neither hashed nor watched** (analysed in R3). Two lines to close.
* **Sweep helper (`programs/cbob-vault-sweep`) re-read in full.** Instruction data must be exactly `[0]`; the pair count must be even; the signer must sign; both program ids are pinned; `signer != dest`; each source must be a 165-byte classic account **owned by the signer**, each destination the same mint owned by the single destination wallet. A duplicate source is refused because the first iteration's `CloseAccount` reassigns the account away from the Token program. The lamports sweep is a System transfer from a 0-data system-owned PDA, which measured fact 4 and round 25 D9 already cover, and nobody can allocate data at a Core asset-signer PDA. I found nothing new.
* **`HOLDER-GUIDE.md`** — I checked every promise against the code. I found no statement that the programs do not do. Two I verified in detail because they are easy to get wrong: a frozen vault cbBTC account really does block the *whole* redemption (BURN requires every reserve account empty), and the swap-bot bound "up to 10 SOL every 6 hours" is correctly stated against the **on-chain cooldown** (a thief's rate) rather than the honest job's 7-hour cadence. The outstanding item-50 promises ("every opening is announced on X and the Bank's website", "the Bank's pages show it") remain the tracked reason the guide may not be published.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concretely, before launch, do these — each is something no amount of AI reading can substitute for.

1. **Run the revenue cycle for real, twice, and keep the signatures** (item 22 §3–4). Nothing in any gate has ever executed `revenue.mjs`. The rehearsal must include one cycle through Orca, one with Orca forced to refuse so Meteora actually runs, and one **deliberately broken after the sweep**, walked through the hand recovery end to end with `--audit` clean at the finish. Record the executed sats against `expectedSats` for each cycle: that number is the empirical version of F3, and it is the only way to choose `SWAP_TOLERANCE_BPS` on evidence instead of margin.
2. **Decide the sweep-and-swap atomicity question with a human** (F3, option 2). Merging them into one v0 transaction deletes the sandwich window, the stranded-SOL class, the requote guard and the hand-recovery path that limit 10 names as the only way to double-swap. It is an off-chain change, so it does not touch the immutable programs — but it resets the freeze counter, so somebody has to decide whether that trade is worth it *before* the two clean rounds, not after.
3. **Two people, two machines, one `dist/`.** `build-mainnet.sh`'s own banner says the compiled-key claim rests on reproducibility, and nobody has ever independently reproduced it. Have a second operator clone the release commit on a different host, run `build-mainnet.sh`, and sign the five sha256 values. Without that, "the deployed bytes are the audited bytes" is a single-machine claim.
4. **Make someone independently decode the signed `initialize` transactions.** Limit 38 A6 is exact: the checker validates the JSON, not the transaction. Build the four transactions *from* `launch/mainnet-init.json` with a tool, then have a second person decode the serialised, unsigned transactions and diff every field against the file — particularly the **order** of `reserve_mints`, which the alarm can only catch after it is permanent.
5. **Time the guardian.** The swap-key bound is "cap × cooldown windows **until the guardian pulls the stop**". Nobody has measured that interval. Run a drill with a stopwatch: a simulated `unledgered_sweep` CRITICAL at 03:00, through the real router, to Gary's actual phone, to a signed `emergency_stop_sweep` on mainnet. Write the measured number into limit 10 in place of the open-ended phrase.
6. **Deliver a real alert to a real human under load and watch what they do.** Every router assertion runs against a throwaway state directory. No test shows that a CRITICAL reaches an inbox, is read, and is acted on correctly — and the single highest-impact failure in this design is a human scrolling past the one page that mattered.
7. **Get the 150 bps and the two pool pins reviewed by someone who trades them.** Fee tiers, tick/bin-array initialisation and liquidity depth on `CeaZcx…` and `H2USRS…` are facts about other people's markets that will change after the lock, and the programs cannot adapt. A trader's read of "is 150 bps nine times too generous, and will these arrays still exist in a year" is not something a code audit can produce.
8. **Walk the five Core/cbBTC consequences with the owner, out loud.** Limits 28, 39 and 40 are each one sentence and each one is permanent: a Coinbase freeze of the pool, a Metaplex change to `BurnV1`'s tombstone (every redemption refuses `NotBurned`), a change to `UpdatePluginV1` (the level queue halts for every unrevealed vault), a change to `ExecuteV1`'s authority rule (who may empty a vault mid-redemption), and the 32 KiB heap boundary. AI can enumerate them. Only the owner can accept them.