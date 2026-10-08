# Independent audit — v6 off‑chain pipeline at `4a67d00`

**Scope note on evidence.** Everything below was read against the bundled text. I ran nothing: no validator, no RPC, no cron, no suite. Where a claim is derivable from the source alone I say so; where it needs a run, I state the run. **`web/src/` is not in this bundle**, so my judgement of `web/test/` is limited to each test's own text plus the mutation/control arms it carries — I cannot confirm that a named property in `web/src` is actually what the test exercises.

---

## R0. Round 41's verdict and its repairs

I verified all five repairs and re‑tested the claims round 41 disproved.

| item | repair | verdict |
|---|---|---|
| **C01** poster drops the 2nd redemption | `draftKey(w) = ${signature}:${w.vault ?? '*'}`; `queued` rebuilt from the same key; rejected whole‑transaction entries use `sig:*` | **HOLDS.** `w.vault` is the zero‑padded `mint_index+1`, unique per vault, so two events in one transaction give two keys. The R41 C01 arm asserts `[2, ['0011','0012'], 0]` — it goes red under a signature‑only key. Armed. |
| **C02** oracle age unpinned | `R41 C02` asserts 181 s refused / 180 s accepted **in literals** plus `SW.MAX_ORACLE_AGE_SECS === 180` | **HOLDS.** No longer derived from the constant it tests. |
| **C03** SPEC crank sentence | "refused only below what the pass's plan costs WITHOUT its reveals; it then runs that base plan and as many reveals as keep the key at or above 0.005 SOL" | **ACCURATE.** `budgetPlan` → `judgeFeePayer(..., {floor: 0n, need: planCostLamports(base)})`, then `keep = floor((lamports − baseCost − FLOOR)/perReveal)`, so the residue is `≥ FEE_FLOOR_LAMPORTS` on every branch. Both SPEC crank rows carry the corrected wording. |
| **C04** level‑0 redemption | pinned as "refuses loudly" | **HOLDS, and the self‑heal argument holds**: `reveal_level` still draws a burned asset (`burned` branch skips only the Core write) and advances `revealed_total`, so the FIFO cannot stall at it permanently. |
| **C06** `MIN_SWEEP_LAMPORTS` | pinned at `10_000_000n` with 1,009,999,999 → `0n` and 1,010,000,000 → `10_000_000n` | **HOLDS.** |

**Round 41 rejections I re‑tested and agree with:** C05 (a prior wSOL balance closes fine — wSOL is native, and the mint has no freeze authority, so `CloseAccount`'s non‑zero rule does not apply; R33.G4 is the measurement). C08 (`rescue` is not in `layout.mjs` SEEDS because no `bank/` code derives it, and the `Object.keys(L.SEEDS).length === 11` arm would go red if it were added carelessly). C12 (item 53 scopes itself to `bank/`, the programs, tests and sim).

**Regression check on the repair sites.** `draftKey` is used at all three sites that need it (the queue rebuild at line 238, the rejected path, the draft path). The C02/C06 arms are inside the counted 940. No other `MAX_ORACLE_*` / `MIN_SWEEP_*` consumer was left deriving its expectation from the constant.

---

## R1. The crank — `bank/crank.mjs`

I reconstructed the full send order against MINT's refusal order and the in‑line monthly run. **No confirmed defect.** The two things worth recording as *verified*, because they are the hard part:

1. **`monthly_inline` cannot fire inside the crank's own plan.** Every `claim` batch calls `monthly_inline`, which returns early while `waiting_to_join(c) > 0`. The crank's pre‑join batches are the only claims sent before its explicit `distribute`, and `waiting_to_join` reaches 0 only *after* the last batch's pairs are processed — never at the *start* of any batch. So the crank's `avail` estimate (which includes `splitToPool`) is never pre‑empted by an in‑line credit that saw a smaller pool. This is load‑bearing and nothing asserts it; see the gate suggestion in R6.

2. **`NoActiveVaults` is unreachable as a false page.** It is the one tick‑path refusal not in `BENIGN` or `DISTRIBUTE_RACE`. If a third party (or ordinary traffic's `monthly_inline`) ticks between plan and send, MINT checks `JoinWaitingFirst` *first* (`waiting_to_join = pending_count − 0 > 0` after a tick), which **is** in `DISTRIBUTE_RACE`, and `dist_epoch` moved → `benign`. Reaching `NoActiveVaults` additionally requires every this‑epoch requester to be retired by a third party inside the gap.

Pay/join of a dead vault, reveal ordering, and the "no value anywhere the program does not pin" property all check out (`plan.retireBurned` precedes every join/claim; `plan.joins`/`preJoins` require `assets[asset] === 'live'`; the discriminator list is exactly the nine permissionless MINT instructions; `distribute` is always sent with `burn = 0`).

One small, non‑benign race: **`activate` refuses `NotALiveVault`** if the owner bare‑burns between the crank's asset read and the send; it is not in `BENIGN`, so one pass pages a failed action. One page, no money. Not filed.

---

## R2. The alarm — `bank/detectors.mjs`, `bank/alarm.mjs`

I walked every production value against SPEC item 38 and `launch/mainnet-init.json` (all twenty match), re‑derived `redemptionCapacity` against BURN's rolling ring (cap `ceil(live×210/10000)` clamped to [1,64]; `inWindow` counts in‑window entries; remaining is correct even when live supply has fallen below past activity), and traced the recovery/baseline bookkeeping.

**No dangerous state read as quiet was confirmed.** Two things I checked and cleared:

* The **`config_vanished`** branch returns without writing state and without passing `prevPaged`, so `prev.paged` survives and no false RECOVERY is emitted. The **idle** branch does pass `fullPass: true`, but every detector that could have paged in the pre‑init period (`detectConfigDrift`, `detectStandingRisks`, `detectUpgradeAuthorityAfterLock`, `detectMissingComponents`, `detectUnreconciledRevenue`) is evaluated *before* the branch, so a recovery cannot be sent for a condition the pass did not look at.
* **`detectSweepState`**'s symmetric ±cooldown/2 window: a thief's sweep cannot sit inside an honest cycle's window, because a legal sweep is a full cooldown after the previous one and `revenue.mjs` writes a row only once `sweepCooldownOver` is true on the chain clock. A refused honest row (`sendRejected`, no `sweepSig`, no `pendingSweepSig`) does **not** explain it. Correct.

**One routine state that pages:** at `live ≤ 47` the cap is 1 and `near = max(1, floor(cap×0.2)) = 1`, so *any single redemption* in the last hour emits `redemptions_near_cap` HIGH for an hour. At 100 live vaults, two redemptions in an hour does it. The kind is level‑triggered so the router opens once and recovers — I judge this correct information at the tail, not noise, and am not filing it.

---

## R3. The layouts — `bank/layout.mjs`

Field‑for‑field reconciliation of all five structs against the bundled Rust: **exact**, including MintConfig v6's three appended blocks. `offsets()` stops at the first `Vec`, so `SealConfig.bump` correctly has no static offset. `u128` read/write is LE‑consistent. `collectionPluginsHash` cannot throw on a hostile length prefix (`o += 4 + n` then `o + 4 > d.length → 'TRUNCATED'`).

**The round‑24 D6 seed assertion is real and strict:** `judgeSeeds` scrapes each `*_SEED` from the program that declares it and `Object.keys(L.SEEDS).length === 11` closes the "add a key, map nothing" hole. A struct change cannot slip past, because the L2 gate is *derived* (`Object.keys(gov|burn|mintp)`), not a hand list.

Two constants in `layout.mjs` are **not** asserted against the Rust: `ACTIVATION_SATS` (MINT `21_000`) and `TOKEN_STATE_OFF/FROZEN/INITIALIZED`. Both are unchangeable in practice (one is immutable program text, the other is SPL's layout) and a divergence would produce loud failed actions rather than silence. Recorded, not filed.

---

## R4. The money arithmetic — `bank/accrual.mjs`

Line‑for‑line against MINT: `ceil_sats`, `credit` (`delta = avail·S/w`, `owed += delta·w`), `owed_of` (`(level+boost)·acc + carry − debt`, with `carry` added **before** the debt subtraction so a weight drop can never need a negative debt), `reweigh`, `join`'s `debt = w·acc`. **No divergence.**

The crank's three owed branches are each correct, which is the part most likely to be wrong:

* `joinedNow`: `debt = level·acc_old`, so `owed = level·Δ`. ✓
* `preExpired`: `atExpiry + level·(acc − acc_old)` reproduces exactly what `expire_boost`→`reweigh` then `credit` leaves. ✓
* `postExpires`: computed **with** the boost at the post‑distribution accumulator. This is right precisely because `expire_boost` is owed‑preserving (`carry := owed`, `debt := level·acc`), so the value the crank predicted equals what `claim` pays after the post‑distribution expiry it sends first. ✓

Due boosts before (`preExpires`) and newly‑due after (`postExpires`) are both planned and both sent in the right place; `retire` is deliberately not mirrored (the crank only plans `retire_burned`) and `pendingScaled` is used to account for the freed share (`owedAfterRetire`). `boosts_stalled` exists; `cbob_mint`, `max_boost_weight`, `max_boost_epochs` are all CRITICAL‑on‑drift and on the production list.

---

## R5. The swap and the revenue cycle

### Verified correct (so these are not findings)

* **(a) Exponent arithmetic.** `sats = lam·sol.price·10^(es−eb)/(btc.price·10)` is the right identity for 9‑decimal SOL / 8‑decimal cbBTC; both the expected output and the floor round **down**, which is conservative. `Number(price)` is exact at realistic magnitudes and the relative error of `satsPerLamport` is ~1e‑16 against a 1e‑2 gate.
* **(b) Pyth offsets, recomputed.** disc 0–8, write_authority 8–40, `verification_level` byte 40 (`Full = 1`, `Partial = {0, u8}` → the `o += 1` is right only for Full, which is enforced), feed_id 41–73, price 73, conf 81, expo 89, publish_time 93, minimum length 101 = exactly the fields read. The address is the sponsored shard‑0 PDA (`[u16 0, feed_id]` under the push oracle) and the owner is pinned to the receiver, so no third party can create or write that account; not checking `write_authority` is therefore sufficient. The clock is the Clock sysvar, owner‑pinned, `unix_timestamp` at byte 32, and **read in the same `getMultipleAccountsInfo` batch as the prices and pools**, so the whole judgement is one consistent slot.
* **(c) Both spot directions.** Orca `(sqrt_price/2^64)^2` is sats per lamport in raw units (A = wSOL, B = cbBTC, verified by `readWhirlpool`'s mint check). Meteora is the inverse of `(1+bs/1e4)^activeId` because X = cbBTC and Y = wSOL — the reverse of Orca, as the comment says. A worked magnitude check (SOL $120 / BTC $86k → 1.40e‑4 sats/lamport → activeId ≈ 5,922 at binStep 15) matches the test fixture. Float error cannot pass a pool it should refuse at any meaningful margin.
* **(d) Same floor, right units.** `guaranteed = m2.f.minSats` is from the *same* read whose deviation gate produced `m2.venues`; Orca's `other_amount_threshold` and Meteora's `min_amount_out` are both in cbBTC base units because cbBTC is the output on both. Orca's data is 42 bytes with exact‑input, `a_to_b`, and `sqrt_price_limit = MIN_SQRT_PRICE_X64` (4295048016), so the threshold is the only binding constraint.
* **(e) The judge is complete for the seven‑instruction sequence.** It pins the output account (swap key 5 = `ata(cbBTC, owner)`), the floor bytes (offset 16), the direction byte (Orca `[1,1]`) and price limit, the amount (offset 8 **and** the System transfer's lamports), refuses `SetComputeUnitPrice` anywhere and any Token instruction but `SyncNative`/`CloseAccount`, and verifies both ATA creations by their full six‑key list against independently derived addresses. Any extra ComputeBudget instruction (heap frame, data‑size limit) breaks the `length === 7` check. The venue programs constrain their own vaults/arrays/oracles (`address = whirlpool.token_vault_a`, `has_one = whirlpool`, `has_one = reserve_x/y`), and a misroute that still slipped through is caught after signing by `delta < guaranteed`.
* **(f) Derivations.** `[b"tick_array", pool, String(start)]` with floor‑division start indices (`−88733/1408 → −90112`, matching the fixture) and offsets 0/−1/−2 for `a_to_b`; `[b"oracle", pool]`; Meteora `[b"bin_array", pool, i64 LE]` with `MAX_BIN_PER_ARRAY = 70`, floor division, and `[i, i+1, i+2]` for Y→X (buying X pushes the active id up); `[b"bitmap", pool]` passed as the program id when absent; `host_fee_in` = program id (Anchor `None`); `[b"__event_authority"]`; two classic token programs. Account **order** matches lb_clmm's `Swap` context slot for slot.
* **(g) wSOL.** A pre‑existing balance is returned by the final close (R33.G4), wSOL cannot be frozen (no freeze authority), a delegate cannot act inside the atomic transaction, and a pre‑funded System account at the ATA address is handled by `CreateIdempotent` (R34.G2). Exact‑input means nothing is left wrapped; a partial fill could not meet a 150 bps floor, so the floor refuses before that state exists.
* **(h) Retry.** Only `outcome === 'refused'` advances to Meteora; `'unknown'` throws with a candidate signature and leaves the cycle open. A blockhash‑expiry classification cannot wrongly free a second swap, because an expired blockhash can never land afterwards. The RPC's preflight errors are all prefixed `Transaction simulation failed:` and so classify as refusals (including the transient `Blockhash not found`).
* **(i) The extraction bound.** Per cycle: 10 SOL × 150 bps = **0.15 SOL (~$18)**, and because the deviation gate holds the pool within 100 bps of the oracle at the read, a stale‑but‑accepted oracle widens it to at most ~250 bps (**~0.25 SOL, ~$30**) rather than being unbounded. At the real ~7 h cadence (round 37 C05) that is ~3.4 cycles/day. Sandwiching the thin Meteora pool is not profitable at this flow size: moving a ~$0.9 M DLMM 150 bps costs more in round‑trip fees than the ~$18 available. Limit 10's numbers are not understated.

### Findings

---

### **F1 (LOW) — `oracleFloor` does not bound the Pyth exponent, so one field can hang the revenue job**

**Construct.** `bank/swap.mjs`, `readPyth` reads `expo = d.readInt32LE(o + 16)` with no range check, and `oracleFloor` then evaluates `10n ** BigInt(e)` (or `10n ** BigInt(-e)`) with `e = sol.expo − btc.expo`.

**What it gains.** Any exponent pair whose difference is large (e.g. `es = 0`, `eb = −10⁶`) makes BigInt exponentiation attempt a number with a million‑plus digits. The revenue job does not refuse — it **hangs or exhausts memory** inside the `market` stage. Because it holds `/opt/cbob-vaults/bank/locks/revenue.flock`, every later hourly run is skipped **silently** (accepted limit 7), and the only backstop is `royalties_unswept` after a 24 h grace. This is a reachability gap in a file that otherwise bounds price, confidence, age and future skew.

**Evidence if I am right.** `node -e "import('./bank/swap.mjs').then(S => S.oracleFloor({lamportsIn: 1_000_000_000n, sol: {price: 12045355552n, conf: 1n, expo: 0, publishTime: 1e9}, btc: {price: 8592910904675n, conf: 1n, expo: -1000000, publishTime: 1e9}, nowSec: 1e9}))"` does not return. The same inputs with a bound would throw a named error. On a live box: the `41 * * * *` revenue line producing no log output while the process stays resident, and `flock` silently skipping subsequent runs.

**Fix.** In `readPyth`, `if (expo < -24 || expo > 0) throw new Error(...)` (Pyth's SOL/USD and BTC/USD are both `-8`), and assert it both ways in the selftest beside the existing price/conf/age arms.

---

### **F2 (LOW) — the cycle commits the sweep before it knows the swap can proceed, so ordinary volatility parks up to 10 SOL on the hot operator key**

**Construct.** `bank/revenue.mjs`: the sweep lands (stage `sweep`), then stage `swap` re‑reads the market (`m2`) and throws on either of two conditions:

```js
const minOut = BigInt(q.outAmount) * BigInt(10_000 - MAX_REQUOTE_DRIFT_BPS) / 10_000n   // 200 bps
if (m2.f.expectedSats < minOut) throw ...   // "must be returned or swapped by hand"
```
and, earlier, `market()` itself throws if Pyth has gone stale (>180 s), future‑dated, or wide between the two reads.

**What it gains / costs.** Neither condition is a safety requirement. `m2.f.minSats` is 150 bps below the **current** oracle, and `m2.venues` already requires a pool within 100 bps of that same current oracle — so swapping on `m2` is exactly as protected as the design intends. The requote guard adds nothing beyond the deviation gate (a 5 % oracle manipulation that the pools did not follow is already caught by `!m2.venues.length`), and what it catches instead is a *genuine* SOL/BTC move of >2 % between the two reads, or a brief Pyth publishing gap. In exchange it leaves up to the full `max_sweep_lamports` (10 SOL ruled) sitting on the long‑lived hot operator key, with the cycle open, until a human completes the limit‑10 hand‑recovery runbook. That is a direct increase in the exposure limit 10 exists to bound: the per‑cycle cap becomes unbounded in *time*.

**Evidence if I am right.** A ledger row with `sweptLamports` set, no `swapSig`, and `error` beginning "the post-sweep oracle expects"; `cbob-revenue:swap` paged; `unreconciled_swap` CRITICAL one hour later; `revenue.mjs --audit` showing an open cycle; and `solana balance <swap-operator>` showing the swept SOL. Reproducible on the fork by stubbing `market` to return an `expectedSats` 3 % below `m1`'s after the sweep stage has stamped `sweptLamports`.

**Fix (pick one).** (a) Delete the requote guard and swap at `m2.f.minSats`, keeping the refusal only for `!m2.venues.length`; the on‑chain floor and the deviation gate are the protection and both already apply. (b) If the guard is kept as a deliberate stop, make the stop **return** the swept lamports to the `["revenue"]` PDA with a System transfer the operator can sign, record `returnedLamports` and a new closed state in the ledger, and extend `cycleIsOpen` to recognise it — so the hot‑key exposure is seconds rather than hours. Either way, add a fork/offline arm that drives the post‑sweep‑failure path end to end, which item 22 L5(4) currently leaves entirely to the dress rehearsal.

---

### **F3 (LOW) — an uncertain send with no signature leaves no candidate, so an honest network blip pages "the operator key is being used by someone else"**

**Construct.** Every hop calls `sendAndConfirmTransaction` with the `Transaction` constructed **inline**, so no reference survives the throw:

```js
cycle.sweepSig = await sendAndConfirmTransaction(conn, new Transaction().add(new TransactionInstruction({...})), [operator], {...})
```
`rememberAttempt` → `SW.sendFailureSignature(e)`; a transport‑layer failure (`fetch failed`, socket reset) carries neither `e.signature` nor a signature in its message, so `if (!sig) return` records nothing.

**What it gains.** The row then holds only `intendedLamports`. If the sweep in fact landed, `mint.last_sweep_at` moves, and `detectSweepState`'s `explained` predicate — which needs `sweepSig` **or** a `pendingSweepSig` confirmed landed — finds neither. The alarm emits `sweep_unledgered_state` CRITICAL, whose text ends "otherwise the swap operator key is being used by someone else, and the guardian can stop the sweep (`emergency_stop_sweep`)". `emergency_stop_sweep` is **one‑way**: undoing it needs a 3‑day vote (plus the `StopIsNewer` rule). So a transport blip at one instant can push an operator toward an irreversible action, and the hand‑recovery runbook ("look up every recorded confirmed or candidate signature") has nothing to look up. Note the signature *is* available at throw time — `sendAndConfirmTransaction` signs the passed `Transaction` in place before sending — it is simply discarded.

**Evidence if I am right.** Point `HELIUS_RPC_URL` at a socket that accepts the `sendTransaction` body and then resets; the resulting ledger row has `intendedLamports` and no `pending*Sig` (`--audit` prints "candidate signatures" for none), and the next alarm pass emits both `unreconciled_swap` and `sweep_unledgered_state`. The selftest already pins the classification half ("a send error without a signature cannot invent an attempt record"), which is the mirror of this gap.

**Fix.** Hoist each hop's `Transaction` to a local and, in the catch, use `tx.signature ? bs58.encode(tx.signature) : SW.sendFailureSignature(e)` as the candidate; reorder `sweep_unledgered_state`'s text to tell the reader to check the ledger for an open cycle in the same window **before** naming key misuse; add an arm driving `rememberAttempt` with a signature‑less error against a signed transaction.

---

### **F4 (LOW) — the Orca builder requires three *initialised* tick arrays, with no check and no page when one is missing, silently demoting every cycle to the ten‑times‑thinner pool**

**Construct.** `orcaTickArrayStarts` always returns `[s0, s0−span, s0−2·span]`, and Orca's `Swap` context types all three as `AccountLoader<'info, TickArray>` — a non‑existent account fails deserialization. `sim/swap-fork.mjs plan` clones only arrays that already exist (`want.filter((_, i) => infos[i])`), so the fork proves the three *present* today; nothing reads or reports their existence at run time.

**What it costs.** Whenever the price sits in a region where the array one or two spans below is uninitialised, every Orca attempt fails at preflight, `classifySendFailure` correctly returns `'refused'`, and **every** cycle runs on Meteora (~$0.9 M, ~10× thinner) for as long as that holds — which is exactly the condition under which R5(i)'s extraction bound is least comfortable. If Meteora is simultaneously outside the 100 bps gate, the whole cycle refuses to sweep and royalties stall until `royalties_unswept` fires. Neither state is distinguishable from the ordinary one in any log or page.

**Evidence if I am right.** `solana account $(derive tick_array at s0−span)` returning "account not found" on mainnet at a moment when the fork's SW.1 would fail; in production, a run of cycles whose `swapVenue` is `meteora` with `swapFailure` naming an Orca `AccountLoader` error, and no alarm about it.

**Fix.** Read the three tick‑array accounts in `market()`'s existing batch; substitute the last initialised array for any missing neighbour (which keeps a swap that stays inside the current array on Orca), surface `orcaArraysMissing` in the cycle row, and page when a cycle is demoted to Meteora for reasons other than price. Add a fork arm that deletes the `s0−span` account and asserts Orca still lands within the current array.

---

### **F5 (INFO) — a router label the gate does not check**

`bank/crank.mjs` emits `cbob-vault-crank:fee_floor` (round 30 L2's separate once‑a‑day marker), but `bank/selftest.mjs`'s router‑label list carries only `:full`, `:reveal` and `:fee_ceiling`. The label is 26 characters, so it does **not** fold into the router's shared `alert` stream and there is no live consequence — but it is the one emitted label whose distinctness and 40‑character bound are unproven. Add it to the `labels` array.

---

## R6. The gates

**Floors.** Every one is an *equality* check, both in `floor()` and for `MIN_ASSERTIONS`, and `bank/selftest.mjs`'s `everywhere()` requires `found.length > 0` so a floor SPEC stopped stating goes red. I recounted two independently and they match: `probe-mainnet-facts.mjs` → 33 (5 walk + 3 mints × 5 + 2 programs × 4 + 5 PoB) and the poster → 24. `sim/swap-fork.mjs` → 16 (1 + 2 venues × 3 + 4 judge + 3 clock + 2 cap). `VAULT_RECORD_SPACE` sums to 221, matching limit 49's byte count and its 1,772,920‑lamport mainnet rent at the 2,540/byte‑year rate road step 9 records.

**Round‑24 arms armed in both directions.** The strongest gate in the file is the I4 pinned‑argument list — 33 exact call strings in order, with two mutations shown red (a positional swap and a wrong value inside an options object). `wiringGate` is derived from `Object.keys(D).filter(/^detect/)` and L13b now requires the call's *result* to be consumed, with three mutations proven red (deleted call, commented call, discarded result). The control‑table gate parses the real error enums and is shown red for a non‑existent refusal and for an AUTOMATIC/PROCEDURE mismatch. The cron‑preserve block runs the **real shell**, including round 24 L12's both flag orders. **I did not find an arm in the round‑24 section that cannot fail.**

**One property nothing asserts, and it is load‑bearing.** R1's observation 1 — that `waiting_to_join` cannot reach 0 at the *start* of any pre‑join claim batch, which is the only reason the crank's `avail` estimate is not pre‑empted by an in‑line credit from a smaller pool — is derivable but untested. A cheap arm: drive `planCrank` with 15 eligible waiting vaults, a due month, `total_active_weight > 0`, a positive `splitToPool`, and assert `plan.preJoins.length === 15` and that `pending_count − pending_this_epoch > 0` after 14 joins. Recommended, not filed.

**`scripts/build-mainnet.sh`** proves what it says for all five: it refuses a dirty tree (recording `dirty` in MANIFEST, which `web/build.mjs` then refuses — L4 arm, both ways), requires exactly five `.so` files, deploys **both** builds and requires mainnet to REJECT and localnet to ACCEPT for seal/mint/burn/gov, and for the keyless sweep helper proves byte identity against *both* the localnet rebuild **and** `target/deploy` (round 25 N6). Its closing banner correctly separates PROVEN from NOT PROVEN.

**`scripts/cron-install.sh`** arms nothing it should not: six tagged jobs, `--live` preserved only from our own tagged, uncommented, end‑anchored line, and the posture print computed from the crontab actually written. The rehearsal marker refuses before anything is read. `flock -n` on all six, lock dir under `$R/bank/locks` (not the tmpfs `/var/lock`).

---

## The four questions on the accepted limits

**1. Is any limit WORSE than stated?**

* **Limit 10 — yes, in one place.** "Round 26 preserves known uncertain-send candidates as `pendingSweepSig`… these are evidence to investigate." **F3** shows the class where there is no candidate at all, and where the resulting page names key misuse. The hand‑recovery runbook degrades to reading `last_sweep_at` and balances.
* **Limit 10 — a second, in degree.** The hand‑recovery path is framed around a confirmation timeout. **F2** shows it is also reached by an ordinary >2 % SOL/BTC move in ~60 s or a brief Pyth publishing gap, and that the consequence is up to 10 SOL resting on the hot key for the duration.
* **Limit 7, in composition with F1.** "Survivable rather than silent" rests on `royalties_unswept` for the revenue lane. A hang inside `oracleFloor` makes that the *only* signal, at a 24 h grace, and `flock -n` makes every intervening run silent.
* **Limit 28** is accurate but does not say what detects a frozen CBOBTC Squads cbBTC account. The alarm reads the pool, the revenue ATA and every vault reserve, but **not** the Squads ATA; the signals are `revenue_unsplit` (6 h) and `crank_problem` (3 passes), and `detectCrankHealth`'s covered‑freeze matcher deliberately does not cover the Squads‑only or pool+Squads messages, so they stay visible. Correct behaviour, worth one sentence in the limit.
* Limit 10's throughput, limit 32's 45/hour, limit 42's byte figures and limit 49's rent all reconcile exactly against the code and the recorded rent rate. Not understated.

**2. Is anything listed as a limit not actually a limit, or already closed?**
I found nothing closed and still listed. Items 9 and 44 have already been narrowed in place for item 58 (`rescue_nested`) and for the classic‑stray sweep. Item 2's DISCHARGED claim ("nothing a stranger can do makes a redemption refuse off chain") holds for the three reserve mints specifically: a stranger cannot set a close authority on an ATA (the ATA program sets it `None`), cannot freeze $GARY or $GIRAFFISH (no freeze authority, per the probe), and cannot create anything at a reserve ATA address other than through the ATA program.

**3. Is any DISCHARGED item not actually discharged?**
No. Item 54's "the crank is unaffected" is true of the code as written (one capture and one reveal per transaction; claim batches extrapolate to ~63–80 k CU against the 200 k single‑instruction default, and the extrapolation caveat is already stated). Items 30/31/33 are confirmed gone or parameterised. Item 51's off‑chain mirror is present and correct.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?**
No. Items 22, 38, 50, 52 and 53 are all genuinely open, and two deserve emphasis because nothing in this tree tests them:

* **Item 22 L5(3).** `sim/swap-fork.mjs` exercises each venue and each refusal *independently*; **nothing anywhere runs `revenue.mjs`'s Orca→Meteora venue loop**, so the fallback sequencing exists only as source. F4 makes that sequence more likely to be the *normal* path than anyone expects.
* **Item 53.** `scripts/check-launch-params.mjs` has no rehearsal mode (it pins every mainnet value by address and number), and `launch/rehearsal-init.json` does not exist — exactly as the item says. The `d57ee3a` full‑suite proof remains stale.

---

## What this project should do before launch that AI audit structurally cannot

Six concrete things, in the order they should happen.

1. **Run the dress rehearsal, and treat item 22 L5(3) and L5(4) as the two that matter most.** Every finding I filed lives on a path no gate executes: the venue fallback, the post‑sweep failure, the uncertain send, a missing tick array. Reading cannot distinguish "this code is correct" from "this code has never run". Specifically: force Orca to refuse with a floor above its price and confirm Meteora lands **inside the same cycle** (not as a separate test), and force a post‑sweep failure and walk the limit‑10 runbook with a stopwatch — record how long the SOL actually sat on the hot key, and whether the person could find it without a candidate signature.

2. **Put the sweep operator on a hardware signer, or cap the key by funding.** Limit 10's bound is "cap × cooldown windows until the guardian stops it", and F2/F3 show how that becomes hours or days in practice. No audit can reduce a hot key's exposure; moving the signature off the box, or keeping the operator funded only for the fee float and funding the sweep amount per cycle, can.

3. **Drill the alarm to a human, twice, with the phone on silent.** Every finding here ends in "and the alarm pages". That claim has no evidence in this tree: `planAlarmNotices` is proven against the router, but *nobody has ever been woken by it and acted correctly*. Fire a synthetic `sweep_unledgered_state` and a synthetic `pool_frozen` at 03:00 and measure the time to the right action — and in particular confirm nobody pulls `emergency_stop_sweep` (one‑way, a 3‑day vote to reverse) on the strength of F3's text.

4. **Have a second person, on a second machine, from a clean checkout, reproduce `dist/SHA256SUMS` and read the four signed `initialize` transactions byte by byte against `launch/mainnet-init.json`.** Item 38 is the only permanent, uncorrectable class left, and round 24 A6 already noted that the checker validates the JSON and not the transaction. An AI pass can confirm the checker is right; it cannot confirm that the human who clicks "sign" built those bytes from that file.

5. **Settle item 22.5 before the freeze, knowing a "no" edits `bank/`.** If DAS drops burned Core assets instead of flagging them, `detectIndexShortfall` becomes a permanent CRITICAL from the first redemption onward, and the daily reconcile reports "incomplete" forever. That is one API call and an afternoon, and it is the kind of third‑party behaviour no amount of reading settles.

6. **Decide, explicitly and on the record, who will be awake for the first 30 days, and make `bank/log-gaps-reviewed` and the revenue runbook someone's named job.** Several controls here are level‑triggered conditions that only a person clears (`log_coverage_gap`, `vault_awaiting_return`, every revenue stage marker, the open‑cycle guard). They are correct as designed and worthless unsupervised. An AI round can verify the mechanism; only an owner can assign the human.