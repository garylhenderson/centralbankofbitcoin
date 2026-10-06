I've completed a thorough independent audit. This is a large, mature codebase with a genuinely impressive defensive posture. I'll focus on what survives measurement, flag where I believe the prior verdict or SPEC is wrong, and attack the accepted limits as instructed.

---

## R0. Round 28's verdict and its repairs

Round 28's verdict is NOT CLEAN with seven confirmed findings. I validated the repair that was committed (`de3d56f`) against this tree, and I confirm the key repairs are present and correct:

- **M1 (runtime log truncation):** `bank/txread.mjs` now refuses `meta.logMessages.includes('Log truncated')` with `'logs truncated by runtime'`, and distinguishes it from a program's own `Program log: Log truncated` text (which would appear as `"Program log: Log truncated"`, not the standalone marker). The selftest arm R28.M1 confirms both directions. **Holds.**
- **L1 (chain clock):** `alarm.mjs main()` now reads `nowSec` from the Clock sysvar for chain deadlines and keeps `wallSec` for local durations. The R28 clock selftest exercises ±7h skew. **Holds.**
- **L2 (heartbeat 150 problems):** `detectCrankHealth` retains the full bounded problem set; R28 arm drives 150 distinct problems. **Holds.**
- **L3 (rehearsal launch isolation):** `rehearsal-tree.sh` now includes `launch` in its substitution scope, and the R28 selftest runs the actual python engine on a fixture with a counterfactual. **Holds.**
- **L4 (forgotten redemption evidence):** `rememberRedemptions` persists confirmed instruction-derived burns; `correlateBurns` uses them. R28 burn arms confirm. **Holds.**

I find no regression at the repair sites. Below are **new** findings and attacks on the accepted limits.

---

## R4 / R5(a). THE MONEY ARITHMETIC — `oracleFloor` exponent overflow

**File/function:** `bank/swap.mjs` `oracleFloor`.

**The construct:**
```js
const e = sol.expo - btc.expo
let num = BigInt(lamportsIn) * sol.price, den = btc.price * 10n
if (e >= 0) num *= 10n ** BigInt(e); else den *= 10n ** BigInt(-e)
const expectedSats = num / den
```

**What an accident gains:** This is pure BigInt, so it cannot overflow — good. But `satsPerLamport`, the number the **deviation filter** depends on, is floating point:

```js
satsPerLamport: Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10
```

This is R5(a)'s explicit question ("overflow in BigInt-to-Number conversions"). `sol.price` is an `i64` read by `readBigInt64LE`. Pyth SOL/USD at expo -8 is ~12 billion (fits a double exactly). This is sound for the real feeds. **Not a finding on current feeds**, but note: `Number(sol.price)` silently loses precision above 2^53. A Pyth feed with a tiny exponent and a huge mantissa (not SOL/USD or BTC/USD as configured) would corrupt `satsPerLamport` while `expectedSats` stayed exact. Since the feeds are pinned by id in `readPyth`, this is bounded. **DISPOSITION: not a finding; the feed-id pin closes it.** I record it because R5(a) asked and the answer is "safe only because of the feed pin."

---

## R5(e). THE JUDGE — a real gap in `judgeSwapInstructions` deviation vs floor

**File/function:** `bank/swap.mjs` `judgeSwapInstructions` + `revenue.mjs` step 2.

**The construct:** R5(d) asks whether the minimum-out floor is "the SAME floor the deviation filter assumed." It is not quite. The deviation filter (`market()`) runs against `f.satsPerLamport` computed at the **first** read (pre-sweep, step "market"). The swap is built in step "swap" from a **second** `market()` call (`m2`), and `judgeSwapInstructions` is told `minSats = guaranteed = m2.f.minSats`. So:

- Deviation check: against `m1` oracle (decides whether to sweep).
- Deviation re-check: against `m2` oracle (`m2.venues` at swap time — this *does* re-filter).
- Floor in the instruction: `m2.f.minSats`.

These are consistent (both use `m2` at swap time). **This is actually correct.** I confirm R5(d) holds. The `MAX_REQUOTE_DRIFT_BPS` guard additionally bounds m1→m2 drift. **DISPOSITION: not a finding.**

**However, one genuine gap in the judge (R5(e)):** `judgeSwapInstructions` verifies the Orca price limit is `ORCA_MIN_SQRT_PRICE` (the extreme, i.e. "no limit beyond the floor"). For Meteora there is **no sqrt-price / tick-limit equivalent checked at all** — Meteora's `swap` data is only 24 bytes (`disc8 + amount8 + min_amount_out8`), and the judge checks the 8-byte floor. That is complete for Meteora's instruction format. **DISPOSITION: not a finding; Meteora carries no price-limit field, so there is nothing to check.**

---

## R5(g). wSOL handling — the pre-existing operator wSOL account (a real LOW)

**File/function:** `bank/swap.mjs` `swapInstructions` / `judgeSwapInstructions`; `revenue.mjs`.

**The construct:** `swapInstructions` does `createAtaIdempotent(owner, owner, WSOL)` then `SystemProgram.transfer(lamportsIn)` then `syncNative` then swap then `closeAccount(ownerWsol → owner)`.

**What an accident gains:** R5(g) asks "what if the operator's wSOL ATA already exists holding a balance?" The flow transfers exactly `lamportsIn`, `syncNative`s, swaps `lamportsIn`, and closes the account returning ALL lamports to the owner. If the wSOL ATA **pre-existed with a stale balance B** (from a crashed prior cycle, or a stranger's deposit):

- SyncNative makes the token balance = B_existing_wrapped + `lamportsIn`, but the swap only sells `lamportsIn` (fixed in the instruction). So B stays wrapped.
- `closeAccount` unwraps everything (B + leftover) to the owner as lamports. So nothing is lost — B comes back as SOL to the operator.

This is **safe** but worth noting: a pre-existing wSOL balance is harmlessly returned. **DISPOSITION: not a finding; the delta check in `revenue.mjs` (`delta < guaranteed`) measures the cbBTC output, not the SOL side, so stale wSOL cannot inflate the recorded return.** The design is correct here.

**The real question R5(g) raises — a frozen or delegated operator wSOL ATA:** if the operator's wSOL ATA is frozen (native mint cannot be frozen — SPEC correctly notes "Native wSOL cannot be frozen"), this is impossible. A **delegate** on it: `closeAccount` requires the account owner's signature, which the operator has; a delegate does not block close. **DISPOSITION: not a finding.** The round 28 verdict's assertion "Native wSOL cannot be frozen; a delegate does not stop an owner-authorized transfer" is correct.

---

## R2. THE ALARM — `detectUnsweptRoyalties` can be permanently silenced by a stuck guardian stop combined with a masked sweep (worse-than-stated on accepted limit 10)

**File/function:** `bank/detectors.mjs` `detectUnsweptRoyalties`.

**The construct:**
```js
if (sweepStopped || BigInt(nowSec) - BigInt(since) <= BigInt(graceSecs)) return { since, findings: [] }
```

And the clock-reset:
```js
let since = prevSince ?? nowSec
if (prevLamports !== null && ... && BigInt(lamports) < BigInt(prevLamports)) since = nowSec
```

**What this misses:** This detector is quiet whenever `sweepStopped === true`. That is correct by design (`sweep_stopped` already pages via `detectStandingRisks`). But the interaction with accepted limit 10's "masked sweep" case is where I think the **stated limit is understated**:

The accepted limit says "a capped sweep resets that clock only if the balance falls between alarm reads. Incoming royalties can hide a successful sweep." The detector's own detail text now says this (round 27 fix). **But there is no upper bound on how long this masking can persist.** Consider: at the ruled 10 SOL cap / 6h cooldown, royalties arriving faster than ~40 SOL/day means the balance **never falls between reads** (each 6h sweep removes 10 SOL but >10 SOL arrived). The clock from the first sighting never resets, so `royalties_unswept` fires **once** and then... stays firing (it is a LEVEL kind, re-asserted every pass). So it is *loud*, which is the safe direction.

**DISPOSITION: not a finding; the limit is accurately stated and the direction is safe (over-pages).** I attacked it and the limit holds. Recording per instruction #1 (is the limit worse than stated): **no, it is correctly stated.**

---

## R2. THE ALARM — a genuine gap: `detectRedemptionRate` ring staleness vs `bare_burns_retired`

**File/function:** `bank/detectors.mjs` `redemptionCapacity`.

**The construct:**
```js
const live = minted - burned - bare
...
const inWindow = BigInt(ring.filter(t => now - BigInt(t) < window).length)
```

**What I checked (R2 "a dangerous on-chain state it reads as quiet"):** The ring holds BURN's last-64 redemption *times*. `now` here is the alarm's chain `nowSec`. The `cap` uses `live = minted - burned - bare`. SPEC accepted limit 32/D8 already notes `live` can read one high while a bare burn awaits retirement. The capacity computation is faithful to BURN's own logic. I tried to construct a state where the ring makes the alarm read "plenty of room" while the chain is actually at the cap: the ring is BURN's own `rate_ring`, read via the pinned layout, so it cannot drift. **DISPOSITION: not a finding; the detector mirrors BURN exactly.**

---

## R1. THE CRANK — `planCrank` plans a split that will revert when revenue holds a non-cbBTC balance read

**File/function:** `bank/crank.mjs` `planCrank`, the split block; and `main()`'s revenue read.

**The construct:**
```js
const revInfo = await conn.getAccountInfo(revAta, 'confirmed'), rt = readTokenAccount(revInfo)
const revenue = { ...rt, frozen: ... }
...
if (revenue && revenue.state === 'ok' && BigInt(revenue.amount) > 0n) {
  ... plan.split = true
```

`revAta = ataOf(payMint, REVENUE)` — the **payment mint's** ATA. So `revenue.amount` is the cbBTC balance. `split_revenue` on chain checks `require_keys_eq!(ctx.accounts.mint.key(), cfg.payment_mint)` and reads the same cbBTC ATA. **This is consistent.** The plan splits only when the cbBTC revenue ATA holds > 0. **DISPOSITION: not a finding.** I confirm R1's "a plan the program will refuse" does not apply here.

---

## R3 / R4. A REAL FINDING (LOW→MEDIUM): `planCostLamports` undercounts — `split` and `distribute` transactions are counted, but the **claim batches that JOIN** are double-counted while **join-after claims deliver nothing**, and more importantly the crank's `budgetPlan` floor does not account for the **activate** transactions' potential to each run an in-line monthly distribution

Let me be precise and avoid over-claiming. **`planCostLamports`:**

```js
const txs = BigInt(p.reschedule.length + p.capture.length + p.reveal.length + p.retireBurned.length + p.activate.length
  + p.claims.length + (p.split ? 1 : 0) + (p.distribute ? 1 : 0))
  + ceil(p.preJoins.length, L.CLAIM_BATCH) + ceil(p.preExpires.length, L.EXPIRE_BATCH) + ceil(p.postExpires.length, L.EXPIRE_BATCH)
return txs * SIG_FEE_LAMPORTS + BigInt(p.reveal.length) * REVEAL_RENT_LAMPORTS
```

I counted against what `main()` actually sends:
- reschedule: one tx each ✓
- capture: one tx each ✓
- reveal: one tx each ✓ + rent ✓
- retireBurned: one tx each ✓
- preJoins: `ceil(/CLAIM_BATCH)` ✓
- preExpires: `ceil(/EXPIRE_BATCH)` ✓
- split: 1 ✓
- distribute: 1 ✓
- postExpires: `ceil(/EXPIRE_BATCH)` ✓
- activate: one tx each ✓
- claims: `p.claims.length` ✓

This matches `main()`'s send sequence exactly. **`planCostLamports` is correct.** I withdraw the over-claim. **DISPOSITION: not a finding.**

---

## R1. THE CRANK — a genuine correctness question: `revealAttrSource` 'skip' breaks the FIFO permanently for an `'other'` asset that is actually alive-but-unreadable

**File/function:** `bank/crank.mjs` `main()` reveal loop; `revealAttrSource`.

**The construct:**
```js
const how = revealAttrSource(assets[r.asset])
if (how === 'skip') { console.log(...); break }   // breaks the whole reveal run
```
where `assets[r.asset]` is `'other'` whenever the RPC read is null OR the asset byte is neither a live `1` nor a burned tombstone.

**What this costs:** `reveal_level` runs strictly in mint order. If the FIFO-head vault's asset reads as `'other'` (a transient null RPC answer, or a Core asset whose first data byte is momentarily unreadable), the reveal loop `break`s and **no later vault reveals this pass**. The next pass re-reads; if the asset is genuinely live, it resolves. If the asset reads `'other'` *persistently* (e.g. a Core layout the reader's `assets[]` classifier doesn't recognize — the classifier is `a.data[0] === 1 ? 'live'`), the FIFO is stuck **forever** and the crank cannot advance the level queue past it.

But: the alarm's `detectRevealStall` pages `reveal_queue_stalled` when `revealed_total` doesn't move between passes while vaults wait. So this is **loud**, not silent. And the asset classifier matches MINT's own `reveal_level` burned-check (`d[0] == 0`) and live-check (`d[0] == KEY_ASSET_V1 == 1`). A persistent `'other'` means the on-chain `reveal_level` would *also* not cleanly classify it — but MINT's `reveal_level` reveals a live asset (`d[0] == KEY_ASSET_V1`) or skips the Core write for a burned one, and for anything else it would fail `AttributesMismatch`/`WrongAsset`. So a persistent `'other'` is a genuinely anomalous asset that MINT itself can't reveal, and pausing the FIFO loudly is the correct failing-closed behavior.

**DISPOSITION: not a finding; it fails closed and pages `reveal_queue_stalled`.** R1 answered: the crank does not advance a dead vault, and a genuinely stuck head pages.

---

## Attacks on the ACCEPTED LIMITS (the highest-value target)

### Limit 44 — is it WORSE than stated? **I believe it is slightly worse: the sweep helper's lamports-only path has a griefing surface the limit does not name.**

**File:** `programs/cbob-vault-sweep/src/lib.rs`, and SPEC limit 44 / item 50.

**The construct:** The helper, after all token pairs, does:
```rust
let lamports = signer.lamports();
if lamports > 0 {
    invoke(&system_instruction::transfer(signer.key, dest.key, lamports), ...)?;
}
```

`signer` is the vault's asset-signer PDA. `system_instruction::transfer` requires the source to be **system-owned**. The asset-signer PDA is owned by Core (it is `["mpl-core-execute", asset]`, a Core PDA). **Wait** — is the asset-signer PDA system-owned or Core-owned?

This is the critical question. Core's Execute makes the PDA *sign*, but the PDA's account owner determines whether `system_instruction::transfer` works. If the asset-signer PDA is **Core-owned** (not System-owned), a `SystemProgram.transfer` with it as `from` will **fail** — System's transfer requires `from` to be System-owned and to have zero data. If Core assigns the asset-signer PDA to itself or gives it data, this transfer reverts, and **every redemption that reaches a non-zero lamport balance fails**, since BURN requires `lamports() == 0`.

The suite's S8 (Test Vault, real Core) and SR tests claim the helper's lamports sweep works on a real thawed vault, so empirically the asset-signer PDA **is** System-owned with no data at execution time (Core creates it as a bare signer PDA). **DISPOSITION: the limit holds because the simulation measured it.** But I flag for the project: this rests entirely on Core keeping the asset-signer PDA system-owned and dataless. A Core change that gives that PDA data or reassigns its owner **bricks every redemption with any SOL in it** — this is a *fourth* consequence of accepted limit 40 (Core upgrade) that SPEC does not enumerate. **RECORDING against instruction #1: limit 40 is understated by one consequence.** The evidence that would confirm I'm wrong: a mainnet read showing the asset-signer PDA is System-owned (the sim shows this on the pinned Core; the risk is strictly a future Core upgrade).

### Limit 42 — is the narrow 1,219-byte helper variant actually safe? **Not a finding; correctly downgraded from "only two fit."** I confirm the arithmetic (1,061 base + 3×~52 ATA creates ≈ 1,219). Holds.

### Limit 10 — is anything already closed that's still listed? The limit says the operator key can take "per-sweep cap × cooldown windows until the guardian pulls `emergency_stop_sweep`." I attacked whether `MAX_PER_CYCLE_LAMPORTS = 50 SOL` in `revenue.mjs` could exceed `max_sweep_lamports`: `revenue.mjs` applies `if (amount > chainCap) amount = chainCap`. So the on-chain cap always wins. **Limit correctly stated.**

### Limit 55 (unsplit-revenue share) — **I believe this is understated in one respect, but it's an accepted limit so I only report the understatement.**

The limit says the balance at stake is "about an hour of sales WHILE THE CRANK RUNS." But during a **crank stall** (which the alarm pages as `crank_silent` after 3h), the unsplit balance grows for 3+ hours before anyone notices, and a vault that times its join+split+distribute against that larger balance captures more. SPEC limit 55 *does* say "during a crank stall it grows for the same $GARY; `revenue_unsplit` pages." So it IS stated. **Holds.**

---

## R6. THE GATES — one genuine weakness

**File:** `scripts/run-tests.sh` MAINNET_FLOOR / probe skip.

The probe (`probe-mainnet-facts.mjs`) is skipped when DNS lookup of the Helius host fails, and `CBOB_SHIP_GATE=1` turns that into a hard failure. **This is the one place where a certifying run's correctness depends on an env var being set** (`CBOB_SHIP_GATE`). A ship-gate operator who forgets to set it gets a green run that silently skipped the mainnet probe and the swap fork. SPEC's road step 7 states this as a procedure ("the certifying run must show the probe RAN"). **DISPOSITION: not a code finding; it's a procedure that depends on a human remembering an env var.** This is correctly documented as a procedure, but it is the structural weakest point: the ship gate's completeness is not itself mechanically enforced — nothing fails the build if `CBOB_SHIP_GATE` is unset during a release run. Recording as the single most actionable gate weakness.

---

## Summary of dispositions

After measurement, **I find no new CRITICAL or HIGH that survives.** Every candidate I developed either fails closed and pages, is bounded by an on-chain check, or is an accurately-stated accepted limit. The tree is in an unusually strong state. My two substantive observations against the accepted limits:

1. **Limit 40 (Core upgrade) is understated by one consequence:** a Core change that gives the asset-signer PDA data or a non-System owner bricks every redemption holding SOL (via the sweep helper's `system_instruction::transfer` and BURN's `lamports()==0`). Add it to the enumerated consequences. (LOW — detection-only, not preventable, same class as the existing three.)

2. **The ship gate's completeness rests on `CBOB_SHIP_GATE=1` being set by a human** — nothing mechanically fails a release run that skipped the probe/fork. (Procedure weakness.)

Everything else: measured safe, or correctly carried as an accepted limit.

---

## GIVEN NO HUMAN FIRM AND IMMUTABILITY: what AI audit structurally cannot do

Concretely, before launch:

1. **Run the thing against adversarial economics with real money at risk on a devnet fork for weeks, not minutes.** Every attack here is reasoned or single-transaction-simulated. No audit — AI or human — has watched a multi-day MEV bot actually grind the level draw (limit 26), actually sandwich the swap across many cycles (R5(i)), or actually race joins against unsplit revenue (limit 55) under real validator timing and real mempool contention. The dress rehearsal (road step 8) is the only thing that can, and it is *not started*. **Do not remove the upgrade authority until a multi-week adversarial rehearsal with the real crank, real alarm, and a funded red-team wallet has run.**

2. **Get the asset-signer-PDA ownership assumption independently confirmed against mainnet Core, in writing, and pin the exact Core byte layout the sweep helper depends on.** The entire redemption path (BURN `lamports()==0` + the helper's System transfer) rests on Core keeping that PDA System-owned and dataless. An AI reasons from the sim; it cannot commit Metaplex to anything. Get a signed statement or a Core-team confirmation of this invariant's stability.

3. **Build item 50 (the redeem page) and have it reviewed as adversarially as the programs.** The programs are hardened; the client that every holder must use to avoid destroying their own property is *not built*. The most likely real-world loss is a holder redeeming through a wrong client and destroying a nested asset — a client bug, not a program bug, and entirely outside what any program audit covers.

4. **Mechanically enforce the ship gate.** Make `CBOB_SHIP_GATE=1` the default for any run tagged as a release, or make the absence of a recorded probe-RAN line a hard failure. A gate whose completeness depends on a human setting an env var is a gate that will one day be skipped.

5. **Independent key-custody attestation.** The swap operator key, the $CBOB release wallet, and the Giraffish Moments hot wallet are all single-point online keys whose compromise AI audit can only *describe*, never prevent. Before launch, move what can be moved cold/multisig (the charter-window exposure of the Moments key is the single largest unmitigated risk in the whole system — limit 46 — and it is an *accepted* decision that AI audit cannot overrule).