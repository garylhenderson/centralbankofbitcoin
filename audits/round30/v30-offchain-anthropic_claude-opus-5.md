# INDEPENDENT AUDIT — ROUND 30, OFF-CHAIN PIPELINE

Scope read whole: `bank/crank.mjs`, `bank/detectors.mjs`, `bank/alarm.mjs`, `bank/layout.mjs`, `bank/accrual.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `bank/txread.mjs`, `bank/selftest.mjs`, `bank/spl.mjs`, `bank/anchor.mjs`, `bank/lock.mjs`, `bank/sigwalk.mjs`, `bank/redemption-poster.mjs`, `sim/swap-fork.{mjs,sh}`, `scripts/{run-tests,cron-install,build-mainnet,audit-coverage,token-programs,rehearsal-tree}.sh`, `scripts/{check-launch-params,probe-mainnet-facts}.mjs`, `tests/expiry-budget.mjs`, `tests/fixtures/mainnet-v1.json`, `launch/*`, MINT and SWEEP source, SPEC/DESIGN/HOLDER-GUIDE, and the round-29 verdict and validation.

Nothing below rests on a sysvar mechanic, a Borsh claim or a ledger shape I did not read in the delivered files. Where I am uncertain about third-party program behaviour I say so and I do not escalate.

---

## R0. ROUND 29'S VERDICT AND ITS REPAIRS

### What I confirm

**M1's repair holds for the attack class it was filed about, and I re-derived its mechanism independently.** `bank/txread.mjs` `validateParsedTransaction` refuses the runtime's standalone `Log truncated` marker by default (`need(!logsTruncated || truncatedLogs === 'flag', …)`), accepts `{truncatedLogs:'flag'}` only from the three walking scanners, and still refuses every other defect in flag mode. I walked the whole validator looking for a *second* attacker-reachable refusal and could not find one:

* duplicate message account keys cannot land (`TransactionError::AccountLoadedTwice`), so `keys.size === accountKeys.length` is not reachable by a stranger;
* the solana parsers fall back to the *compiled* (raw) instruction form when they cannot decode, so `need(object(ix.parsed.info))` for System/Token/Token-2022/ATA cannot be tripped by a malformed-but-landed instruction;
* `transfer`/`transferChecked`/`approve*`/`initializeAccount*`/ATA `create*` all emit exactly the fields the validator requires, including the multisig-authority variants;
* `preBalances.length === accountKeys.length` and the `uiTokenAmount` shape are RPC-side invariants, not attacker inputs.

The three consumers isolate correctly: the alarm pages `log_coverage_gap`, keeps the signature in `logGaps`, feeds `parseCbobLogs([])`, still runs every instruction detector, and advances its cursor only after delivery (`if (!delivered) next.cursors = prev?.cursors ?? {}`). `splitsSince` reads outflow from instructions/inner instructions, not logs. The poster queues a REJECTED hand-draft only when BURN is **top-level** — which is the correct discriminator, since `open_for_redemption` walks the instructions sysvar and therefore forces `burn_vault` to be top-level.

**INFO repairs hold.** `srcFiles` now includes `tests/*.mjs` (line 679) and the two selftest labels are satisfied: no retired key path and no secret-key constructor appears in `tests/*.mjs`. DESIGN's `activate` bullet is request-then-join. SPEC's dilution note for an activated orphan is present under "What got worse" and in items 9/44, and it is measured against `total_active_weight` rather than the full census, as the reviewer required.

### What I do not confirm

**L1's repair is green on a promise, not on delivery, and the one file round 29 named is still not in front of an auditor.** `scripts/audit-coverage.sh` now enumerates every tracked file under `programs/ bank/ scripts/ sim/ launch/ tests/` plus the four documents, with named exclusions and an `exit 2` when git cannot answer — that part is a real improvement. But its subject is still a *path literal inside a `scripts/audit*.ts` TARGETS array*, and SPEC's ship gate concedes this ("it counts bundling, which a prepared round earns before it runs"). Round 29's VALIDATION says all eight never-bundled files "are in round 30's bundle". `sim/fixtures.mjs` — the single concrete instance round 29 used to justify the finding, and a file the certifying 71-assertion simulation executes — **is not in this bundle.** Neither are `sim/test-vault.ts`, `sim/run-sim.sh`, `scripts/pob-merkle.mjs`, `scripts/pob-set.json` or `tests/3prog.test.ts`, which the prior round's own verdict leans on as evidence. I cannot verify the "runner refuses to name a file it did not deliver" claim because the runner is not bundled either.

This is recorded below as **L2 (LOW)**: it is not a code defect, it is the ship gate's condition 1 reporting satisfied for a file no model has read.

**Round 29's dispositions I checked and agree with:** C02 (Orca/Meteora spot units are raw-per-raw, which *is* sats per lamport — I recomputed both: Meteora `1/(1.0015)^5920 = 1.398e-4` against `satsPerLamport = 1.402e-4`, 25 bps apart, consistent with SW.0 passing), C04 (the input slot is pinned, and the operator's wSOL ATA is address-deterministic), C05 (`sweptAtaTotal` is written once and read nowhere; `closesCycle` uses `>=`), C06 (`problemKey` replaces standalone digit runs only; base58 is not a standalone digit run), C08, C20, C23.

**Round 29's C13 and C17 I am re-opening narrowly, with new mechanism, not re-filing:** C13 becomes **L1** below (the pre-sweep gate cannot see what C13 describes, so it misstates its own guarantee); C17 becomes **F1 (HIGH)** below, because the disposition "EXISTING paged bound … loud" is true of the page and false of the bound — the window is permanent and irrecoverable without manual cursor surgery, and the finding's own text asserts the opposite.

---

## R2. THE ALARM

### F1 — HIGH. `scan_gap` creates a PERMANENT, attacker-inducible blind spot in every signature-derived detector, and its own message claims the opposite.

**Construct.** `bank/sigwalk.mjs` `signaturesSince(conn, address, until, maxPages = 20, limit = 1000)`; `bank/alarm.mjs` main, the per-program walk:

```js
const { sigs, gap } = await walkSigs(conn, prog, cursors[id])
if (gap) findings.push({ kind: 'scan_gap', severity: 'HIGH',
  detail: `…Older ones were NOT examined this pass; the cursor was left where it was so they are not skipped.` })
…
if (!gap && !unread && sigs.length) cursors[id] = sigs[0].signature
```

**The defect.** `signaturesSince` pages **newest-first** with `until = cursor`. If more than 20,000 signatures exist newer than the cursor, every batch is full, the loop runs 20 times, `gap = true`, and the cursor is **not** advanced. The examined set is always the newest 20,000. Everything between the stuck cursor and that window is therefore **never examined again**, and because signature count only grows, `gap` stays true forever. The state is not self-healing and it is not recoverable by clearing the cursor: with `until` undefined the walk still pages 20 times and still returns `gap = true` as soon as the program's *total* history exceeds 20,000 signatures, which MINT will exceed within weeks of launch (2,100 mints + hourly splits + hourly distributes + 2,100-vault claim batches + per-minute captures/reveals). The only exit is a human writing a recent signature into `state.json` by hand, and the finding's text neither says so nor is true ("so they are not skipped" — they are skipped, permanently).

**What this costs, and the composition that makes it HIGH.** Everything downstream of the walk goes silent for the buried window: `detectApprovals`, `detectPdaTokenAccounts`, `detectBurns` (the route-naming half), `detectUnledgeredSweeps`, `detectSplitClaims`'s `seenSplits` growth, and `parseCbobLogs`/`detectProgramEvents` (reschedules, frozen-claim deferrals, pool-frozen forfeits). The one that matters is `unledgered_sweep`. SPEC accepted limit 10 states the detection half "catches an off-box key thief and honest mistakes, never the box's owner". An off-box thief with the operator key can defeat it for about **0.1 SOL**: sweep, then land ~20,000 cheap transactions that merely *name* MINT as an unreferenced read-only key (round 29 measured this exact shape succeeding for 5,000 lamports a transaction). From the next pass onward the sweep sits below the newest 20,000, is never scanned, no row claims it, and no detector fires:

* `detectUnledgeredSweeps` / `detectDeferredSweeps` only ever see scanned transactions;
* `detectUnreconciledRevenue` reads the ledger, which has no row;
* `detectUnsweptRoyalties` **resets its clock on every fall of the revenue balance** (`if (lamports < prevLamports) since = nowSec`), so a successful theft looks exactly like a successful sweep.

So limit 10's bound "per-sweep cap × cooldown windows **until the guardian pulls `emergency_stop_sweep`**" becomes unbounded in duration: 10 SOL every 6 hours with nothing paging the theft, under cover of one HIGH that the attacker can also manufacture at will (see F2). The poster has the same permanent stall on BURN (`if (!gap) st.cursor = s.signature`), so buried redemptions are never drafted — which also silently voids the "every redemption is public" promise in HOLDER-GUIDE for that window.

**Evidence that would exist if I am right.** On any cluster: set `state.json`'s cursor for one program, land 20,001 signatures mentioning that program, then run two alarm passes. Both report `scan_gap` HIGH; `state.json`'s cursor for that program is byte-identical before and after both passes; and a transaction placed immediately *before* the 20,001 (containing, say, a non-canonical PDA token-account creation) appears in no pass's findings, on that pass or any later one. A third pass after the spam stops still reports `scan_gap` and still does not advance. Reading the two functions is sufficient for the logic; the 20,001 is only needed to show it is reachable.

**Fix (three parts, all cheap, none in the programs).**
1. Make the sweep reconciliation independent of the signature walk, which is the only part that protects money. The alarm already reads and persists `royaltyLamports` every pass: add a detector that pages CRITICAL when the revenue PDA's lamports **fell** between two passes by at least the sweep floor and no ledger cycle records a sweep whose `blockTime` (or `startedAt`) falls in that interval. That closes the composition above regardless of the walk, and it is the same "chain is the fact, the ledger is the audited key's own testimony" rule already applied elsewhere.
2. Make the gap recoverable: on `gap`, persist the oldest signature examined this pass as an explicit `unexaminedBefore[prog]` marker, continue advancing the cursor to `sigs[0]`, and keep paging a distinct `scan_window_abandoned` CRITICAL naming the window until a human clears the marker. A recorded, named, permanently-paged hole is strictly better than an unrecorded one that the message claims does not exist.
3. Correct the `scan_gap` detail text, which is currently false, and add a both-ways selftest arm for `gap === true` (the selftest exercises `signaturesSince` only through the live mainnet probe's four assertions, none of which covers the gap branch's effect on the cursor).

---

### F2 — MEDIUM. `log_coverage_gap` is an unbounded URGENT paging channel any stranger can drive for about $0.03 a day, and the alarm does not apply the discriminator the poster already applies.

**Construct.** `bank/alarm.mjs` main:

```js
if (tx.logsTruncated) {
  looked.logGaps.push(s.signature)
  findings.push({ kind: 'log_coverage_gap', severity: 'HIGH', signature: s.signature, detail: … })
}
```
and `bank/detectors.mjs` `ALARM_KINDS`: `log_coverage_gap: 'once'`.

**The defect.** `'once'` makes it urgent in `planAlarmNotices`, and the text carries `at pass ${stamp}`, so it is new on every pass and — by round 29's own measurement against the real router — **breaks through an already-open stream every time** (`QUEUED`). The trigger is the one thing in this whole pipeline a stranger controls for a flat 5,000-lamport fee: round 29 measured that a 922-byte legacy transaction of stock memo instructions, naming MINT and BURN only as unreferenced read-only keys, succeeds and ends in the runtime's `Log truncated` marker, and that `sigwalk.mjs` returns it for both programs. One such transaction per pass is ~48 urgent notices a day for ~0.00024 SOL.

The alarm has no way to tell that spam from a real lost event — but the information needed is already in hand, and the poster already uses it. **A CBOB event line can only be lost if one of our programs was INVOKED**, because our programs print those lines. Truncated *logs* do not truncate `meta.innerInstructions`, so `D.normaliseTx(tx)` still shows, completely, whether any instruction (top-level or inner) belongs to one of our five program ids. The alarm pages urgently without asking.

**What it costs.** No value. It is an attention attack: the operator is trained to ignore `cbob-vault-alarm:log_coverage_gap`, and then the one genuine lost `CBOB_REDEEMED_POOL_FROZEN` (a holder losing sats) or `CBOB_REVEAL_RESCHEDULED` (the limit-25 re-roll class) arrives in the same stream. It also interacts badly with F1: if sustained flooding ever makes the notifier exit non-zero, `delivered = false` freezes every baseline including the cursors, and the walk then re-reads a growing window until it reaches `gap` permanently.

**Evidence that would exist if I am right.** Land one successful transaction that names MINT as an unreferenced read-only account and is padded to runtime log truncation. The next alarm pass prints `notice cbob-vault-alarm:log_coverage_gap URGENT`, the router classifies it `URGENT`/`QUEUED` (not `SUPPRESSED`), and `D.normaliseTx` of that transaction contains **no** instruction whose `program` is one of `L.PROGRAM_IDS`. Repeat with a new transaction next pass: it queues again rather than being suppressed.

**Fix.** Split the kind by invocation:
```js
const ours = new Set(Object.values(L.PROGRAM_IDS))
const invoked = ixs.some(ix => ours.has(ix.program))
```
If `invoked`, keep today's urgent `log_coverage_gap` (a real event may be lost — and this shape is far more expensive for an attacker, since it needs a *successful* permissionless call to one of our programs). If not, record it in `logGaps` and emit it at INFO (or a `'level'` kind) so the router's 12-hour suppression and recovery apply. Add both-ways arms: the invoked shape pages urgently; the stranger shape (the exact round-29 memo shape) does not page, is still recorded in `logGaps`, still produces its instruction findings, and still advances the cursor.

---

### F3 — MEDIUM. Nothing checks the on-chain payout denominator against the per-vault records, so a drift in `total_active_weight`, `owed_scaled`, the pending counters or the boost ring would mis-split every future payout in silence.

**Construct.** `bank/detectors.mjs`: `total_active_weight`, `active_count`, `acc_scaled`, `owed_scaled`, `dist_epoch`, `pending_count`, `pending_this_epoch`, `boosts_active`, `boosts_due` are all in `WATCHED_KEYS` and all are only *printed* (`report()`'s config line) or used as inputs (`detectDistributionOverdue`'s `w === 0n` branches). `detectPoolHealth` checks only `pool.amount >= ceil(owed_scaled)`.

**The defect.** The invariants the project's own host test asserts off chain (`programs/cbob-vault-mint/src/lib.rs` `host_tests::the_boost_schedule_through_the_programs_own_functions_across_four_wraps`: `total_active_weight == Σ weight_of(r)`, `owed_scaled == Σ owed_of(r)`, `boosts_active == |boosted|`, `boost_weight_total == Σ boost_weight`, and per-slot `boost_expiring[i]`) are asserted **nowhere against the live chain**. `pool_insolvent` does not cover them: a weight drift leaves the pool solvent and simply hands the wrong fraction to every vault at every future distribution, forever, with the programs immutable.

This is the one monitoring hole where immutability bites hardest: a program defect in the newest money code (the two-step join, the carry, the boost ring, the retire paths — SPEC itself names this as risk 1) cannot be fixed after the lock, so detecting it *early* is the entire remaining control, and the pipeline does not look.

The pieces are already in hand once a pass: `bank/crank.mjs`'s full pass fetches `cfg` and **every** `VaultRecord` via `getProgramAccounts`, and `bank/accrual.mjs` already mirrors `weight_of` and `owed_of` exactly (I checked both against MINT line by line and they agree, including `owed_of`'s `+ carry` before `- debt`).

A second, smaller instance of the same shape: `detectors.mjs` `redemptionCapacity` does
```js
const live = minted - burned - bare
if (live < 0n) return null
```
so an impossible cross-program state (`BURN.burned_total + MINT.bare_burns_retired > MINT.minted_total`) makes the redemption-rate detector go **quiet** instead of paging. That is the exact "dangerous on-chain state read as quiet" the brief asks for, and it is one line.

**Evidence that would exist if I am right.** Grep `bank/{detectors,alarm,crank}.mjs` for any comparison of `mint.total_active_weight` or `mint.owed_scaled` against a sum over records: there is none. Drive it synthetically: hand the selftest a `cfg` whose `total_active_weight` is one higher than `Σ weight_of(records)` and no current detector produces a finding. Drive `redemptionCapacity` with `minted_total: 1, burned_total: 2` and it returns `null`, and `detectRedemptionRate` returns `[]`.

**Fix.** In `bank/crank.mjs` `planCrank` (pure, already has `cfg` and `records`), compute the five sums and push a `plan.problems` entry naming each mismatch with both numbers. The alarm then escalates automatically: one problem present in three consecutive heartbeats is already `crank_problem` HIGH (`detectCrankHealth`), and `problemKey` preserves distinct vault/reason identity. Add both-ways selftest arms per invariant (the existing planner arms make this a dozen lines each). Separately, make `live < 0n` a CRITICAL `supply_counters_impossible` instead of `null`.

---

## R1. THE CRANK

I could not find a plan the programs will refuse, a plan that pays or joins a dead vault, a reveal out of order, or any instruction that moves value off the paths the programs pin. Specifically verified, construct by construct:

* **Account lists and orders** of all nine instructions the crank sends match MINT's `#[derive(Accounts)]` exactly (`reveal_level`, `capture_entropy`, `reschedule_reveal`, `retire_burned`, `claim`, `expire_boosts`, `split_revenue`, `distribute`, `activate`). `distribute` is sent with `burn = 0` (the free path) only.
* **No value path.** The only `programId` in `crank.mjs` is `MINT`; there is no SPL or System transfer; `ixDisc` is computed from `sha256("global:<name>")`. The key signs as fee payer only.
* **Ordering against the program's gates.** `preJoins` → `expire('before')` → `split` → `distribute` → `expire('after')` → `activate` → `claims` is correct against `JoinWaitingFirst` and `BoostsExpireFirst`, and the in-line `monthly_inline` inside a join-only `claim` cannot pre-empt the explicit `distribute`, because `monthly_inline` returns early while `waiting_to_join > 0` and the joins happen *after* it inside the same instruction.
* **The arithmetic is MINT's.** `preExpired`'s owed (`atExpiry + level_weight × Δacc`) reproduces MINT's `expire_boost` → `reweigh` → `credit` sequence exactly; the `joinedNow` owed reproduces `join`'s `debt = w × acc_old`; `splitToPool = total − total×1500/10000` reproduces MINT's floored `bank_cut` with the remainder to holders; `retiringOwed` correctly frees a retiring vault's share *before* planning the distribution (round 24 I1 holds).
* **Races.** `judgeDistributeRefusal` is correct: `PoolShort` is never benign; the three race codes are benign only when `dist_epoch` or `last_distribute_at` moved. `mintFailureCode`'s invoke-stack walk correctly attributes a nested CPI error to the inner program and returns `null` (a failure), and an unretrievable log is a failure.
* **`revealAttrSource` / `judgeRevealAttrs` / `splitDecimalsByte` / `clockUnixTimestamp`** are each correct and each has both-ways arms.

One finding.

### F4 — LOW. `budgetPlan` can spend the crank key below its own floor, after which the *next* pass is refused entirely — including captures — which is the lapse class L6b was written to avoid.

**Construct.** `bank/crank.mjs`:

```js
const room = BigInt(lamports) - planCostLamports(base)
const n = Number(room / (SIG_FEE_LAMPORTS + REVEAL_RENT_LAMPORTS))
const keep = Math.max(0, Math.min(plan.reveal.length, n))
```
against `judgeFeePayer`'s `const min = BigInt(need) > BigInt(floor) ? BigInt(need) : BigInt(floor)`.

**The defect.** `room` is measured from zero, not from the floor. With a 0.005 SOL balance and a 100,000-lamport base plan, `budgetPlan` keeps 42 reveals and spends to ~12,880 lamports. Every subsequent pass — **including the every-minute `--reveal-only` lane, which also runs `budgetPlan`** — then fails `baseJ` (balance < `FEE_FLOOR_LAMPORTS`), `main()` throws `fee.why`, and the crank sends **nothing**: no captures, no reschedules, no reveals. Capture windows are ~300 slots, so draws begin lapsing into accepted limit 25's re-roll class until a human tops the key up. L6b's own comment states the intended property ("the pass runs everything but the reveals… only a key that cannot cover even the rest is refused"); the implementation guarantees the opposite on the following pass.

It is loud (the lane's own stream pages, `reveal_queue_stalled` and `crank_silent` follow), which is why this is LOW and not higher.

**Evidence that would exist if I am right.** Unit-level: `budgetPlan(plan, 5_000_000n)` on a plan with 200 reveals and a 100,000-lamport base returns `ok: true` with `keep ≈ 42`, and `judgeFeePayer(5_000_000n − 42×116_360n − 100_000n, { need: anything })` returns `ok: false`. Operationally: one `crank:full` page naming dropped reveals, followed by `crank:reveal` pages every minute saying the key holds less than the 5,000,000 the pass needs, with `reveal_queue_stalled` 30 minutes later.

**Fix.** `const room = BigInt(lamports) - planCostLamports(base) - FEE_FLOOR_LAMPORTS` (clamped at 0), so a budgeted pass always leaves enough to start another. Add a both-ways arm: a balance that funds `k` reveals today must leave `judgeFeePayer(remaining, {need: floor}).ok === true`.

---

## R3. THE LAYOUTS

**No findings.** The assertions are real and a struct change cannot slip past them, with one scope note.

Verified by hand against MINT's source: every `offsets()` value the selftest compares (`MintConfig` through `boost_expiring`, `VaultRecord` through `carry_scaled`) is computed from the field list, `FIXED` covers every type used, and the `Vec<Pubkey>` break is correct. `decode` refuses the wrong discriminator, the wrong version byte, a truncated account, a non-0/1 `bool` and an incredible `Vec` length; `readPinned` additionally pins the owner through `bank/anchor.mjs`. `collectionPluginsHash` correctly skips `key | update_authority | name | uri | num_minted | current_size` and hashes only the plugin region.

**Round 24 D6 is genuinely closed.** `bank/selftest.mjs` now scrapes each `pub const *_SEED: &[u8] = b"…"` from the program that declares it and compares all eleven, with a counterfactual for a mistyped seed and for a seed no program declares (`SEED_SRC` / `judgeSeeds`). The SEEDS comment is now true.

The cross-program offset gate is closed in both directions: every `OFF_*` constant any program pins is compared (`unchecked` must be empty), the suite's own `OFF_*` constants are compared, every `*_VERSION` constant in every program is mapped to a struct, `BOOST_RING` is scraped, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped and *evaluated* (round 24 L13c), and `parseRustStruct` now throws on any line it cannot read as one `pub name: Type` field.

Scope note (not a finding): the layout gate covers MINT, SEAL, BURN, GOV. `programs/cbob-vault-sweep` declares no account, so there is nothing to pin — correct — but it also means the sweep helper's only off-chain coupling is the program id, which `idGate` covers.

---

## R4. THE MONEY ARITHMETIC

**No divergence found.** I compared line by line:

| `bank/accrual.mjs` | MINT |
|---|---|
| `credit` | `credit` — `delta = avail×1e12/w`, `owed += delta×w` ✔ |
| `pendingScaled` | `owed_of` — `(w+boost)×acc + carry − debt`, carry added before the debt is subtracted ✔ |
| `reweigh` | `reweigh` — carry takes the owed share, debt restarts at the new weight ✔ |
| `ceilSats` | `ceil_sats` ✔ |
| `available` | `distribute`'s `avail` (floored at 0 here, `PoolShort` there — the alarm reports the shortfall) ✔ |
| `debtAtActivation` | `join`'s `debt = w × acc`, `carry = 0` ✔ |
| `WEIGHTS` / `ACC_SCALE` | `LEVEL_WEIGHTS` / `ACC_SCALE`, both scraped from the Rust by the selftest ✔ |

The crank expires every DUE boost before it distributes (`preExpires`, filtered on `active && !retired && !retiring && dist_epoch >= boost_end_epoch`) and every boost its own distribution makes due immediately after (`postExpires`, `boost_end_epoch === dist_epoch + 1`), and both are sent in the right place in `main()`. The alarm pages `boosts_stalled` (`detectDistributionOverdue`) and treats `mint.cbob_mint`, `mint.max_boost_weight` and `mint.max_boost_epochs` as fixed-forever CRITICAL (`WATCH`), with the ruled 12/24/`GMm2yY2z…` pinned in `detectStandingRisks`'s production list and in `check-launch-params.mjs`.

`tests/expiry-budget.mjs` is a real gate: the synthetic `MintConfig` it builds is internally consistent (`owed_scaled = 2800×SCALE = 20 × 14 × 10×SCALE`), the default-budget simulation requires 20 distinct `CBOB_BOOST_EXPIRED` lines and `< 200000` CU, a transaction actually lands, and the post-state asserts `total_active_weight === 40n` with every record's boost cleared. Its header is honest about synthetic genesis scope.

---

## R5. THE SWAP AND THE REVENUE CYCLE

I could not break (a) through (g). Stated positively, because "prove or break" was the instruction:

**(a) The oracle math is correct for every exponent sign.** `sats = lamports × sol / (btc × 10) × 10^(es−eb)` is the right identity (the `/10` is `1e8/1e9`), and the `e >= 0 ? num *= : den *=` branch is right both ways. Rounding is floor on `expectedSats` and on `minSats`, which lowers the floor by at most 1 sat — the lenient direction, and immaterial. `satsPerLamport`'s `Number()` conversions are exact today (BTC at $1M is `1e14`, well inside 2^53) and are used **only** by the deviation filter, never by the on-chain floor, which stays in BigInt end to end. I re-derived the honest-pool margin: oracle-to-pool ≤ 100 bps (gate) + Orca fee 16 bps + impact on 10 SOL in a ~$10M pool (bps-scale) ≈ 118 bps < 150 bps, consistent with the fork's measured 31.6/32.9 bps.

**(b) The `PriceUpdateV2` offsets are right.** disc 8 + `write_authority` 32 → `verification_level` at 40 (Borsh enum: `Partial{u8}` = variant 0 + 1 byte, `Full` = variant 1, so `d[40] !== 1` ⇒ refuse is correct) → `feed_id` 41..73, `price` 73, `conf` 81, `expo` 89, `publish_time` 93. The 101-byte minimum is exactly what the last read needs. Ownership by the receiver plus the derived shard-0 PDA under the push oracle is, as far as I can establish, sufficient against a *chosen* price: the receiver sets `verification_level` from real Wormhole signature verification, the push-oracle PDA seed binds the feed id, and the push oracle rejects a non-advancing `publish_time`. **I did not verify the push oracle's monotonicity rule against its source**, which is not in the bundle, so I flag it as the one thing worth a direct read rather than asserting it. The residual — anyone may post a valid update up to 180 s old — is what the age/confidence/pool-agreement checks bound, as SPEC says. The clock is the Clock sysvar, read in the *same* `getMultipleAccountsInfo` as the prices (so one consistent slot) and owner-pinned to `Sysvar111…`; `clockUnixTimestamp` reads `unix_timestamp` at byte 32, correct.

**(c) The deviation filter uses the right quantities in the right direction.** `orcaSpot = (sqrt_price/2^64)^2` is raw-B-per-raw-A = sats per lamport for a wSOL/cbBTC pool (and `readWhirlpool` refuses the reverse order). `meteoraSpot = 1/(1+bin_step/1e4)^active_id` inverts the pair's Y-per-X to sats per lamport (and `readLbPair` refuses the reverse). Double precision contributes ~1e-14 bps of error against a 100 bps gate; it cannot pass a pool it should refuse.

**(d) It is the same floor.** `guaranteed = m2.f.minSats` and the deviation filter that produced `m2.venues` used `m2.f.satsPerLamport` from the same read; the judge is then told `{lamportsIn: amount, minSats: guaranteed}` and the fork passes `told` at every call site. Units: Orca's `other_amount_threshold` with `amount_specified_is_input = true` is output-token units (sats); Meteora's `min_amount_out` likewise.

**(e) The judge is complete for value.** It pins an exact seven-instruction sequence: CU limit 400,000 with no keys and no `setComputeUnitPrice` (and the length check alone defeats an appended fee instruction — note that ComputeBudget variant 0, `RequestUnitsDeprecated`, which carried `additional_fee`, is no longer accepted by the runtime); both ATA creations keyed `[owner, ata(mint,owner), owner, mint, System, Token]`; the wrap's exact `lamportsIn` into the operator's own wSOL ATA; SyncNative of that account; the venue swap's pool, **input, output**, amount, threshold, Orca's direction/exact-input/price-limit, and the operator in the authority slot with `isSigner`; exactly one Token `CloseAccount` back to the operator, last; and no Token instruction but SyncNative and that close. What it leaves unpinned on the swap instruction is exactly the set the venue program validates itself — Orca constrains `token_program` by address, `token_vault_a/b` against the whirlpool, the tick arrays by `has_one = whirlpool`, and the oracle by seeds; Meteora constrains `reserve_x/y` against the pair and the bin arrays by owner and pair — plus `host_fee_in`, which can only redirect a share of the *protocol's* fee and cannot reduce our bounded output. I could construct no tamper that passes the judge and moves value.

**(f) Every seed and order checks out.** Orca tick arrays `["tick_array", pool, String(start)]` with `start = floor(tick/(88×spacing))×span` and the two below for `a_to_b` (and `String(-90112)` matches Rust's `i32::to_string()`); the oracle PDA; the whirlpool field offsets (tick_spacing 41, fee_rate 45, liquidity 49, sqrt_price 65, tick_current 81, mint_a 101, vault_a 133, mint_b 181, vault_b 213, with a 245-byte minimum). Meteora `["bin_array", pool, i64 LE]` with `Math.floor(id/70)` matching Rust's `div_euclid` for negatives, `[i, i+1, i+2]` for Y→X (buying X raises the active id), `["bitmap", pool]`, `["oracle", pool]`, `["__event_authority"]`, `host_fee_in` as the program id for Anchor's `None`, two token programs, and the full 15-account order matching `lb_clmm::Swap`; the `LbPair` offsets (active_id 76, bin_step 80, mint_x 88, mint_y 120, reserve_x 152, reserve_y 184, 216-byte minimum) after 32-byte `StaticParameters` and 32-byte `VariableParameters`, which I recomputed field by field.

**(g) wSOL handling is safe.** The ATA address is a PDA of (operator, wSOL), so nobody else can create a different account there, and the ATA program handles a pre-funded system account. wSOL's native mint has no freeze authority, so the frozen case does not arise; a delegate is irrelevant because the swap and close both use the owner as authority. A pre-existing balance is unwrapped to the operator by the close — not a loss, and it is the documented operator-hygiene requirement.

**(i) The adversary's envelope is immaterial.** With a 100 bps read-time gate and a 150 bps on-chain floor, a sandwich can extract at most (150 bps − honest fee/impact) ≈ 130 bps of the cycle, i.e. ~0.13 SOL on a 10 SOL cycle. To move a ~$10M Orca pool 1.3% and back costs the attacker roughly two 0.16% fees on a far larger trade — on the order of $400 to capture $16. On Meteora (~10× thinner, and only reached when Orca's program refuses) it is roughly break-even. A stale-but-accepted oracle costs liveness, not value, unless combined with a pushed pool; the combined worst case is (150 bps + the oracle's own error), which SPEC already declines to bound and says so. Per month at four cycles a day the sandwich ceiling is ~16 SOL **of attacker spend for less than that in capture**, so the cycle size does not make it material. The operator key's worst case now trusts the two pool programs and Pyth (all four upgrade authorities watched at HIGH) rather than an HTTP reply, which is a real improvement.

**The ledger cannot read a failed cycle as closed** on the automatic path: `cycleIsOpen` requires `returnedSats > 0` **and** a split; `sendRejected` is written only on a positive refusal verdict and never beside `sweepSig`/`sweptLamports` (and the contradiction is itself CRITICAL); every `unknown` verdict records a `pendingXSig` and rethrows without advancing. (h) is right: Meteora is tried only on `refused`, never on `unknown`.

Two findings.

### L1 — LOW. The pre-sweep "refusing to sweep into a market we would not trade in" gate cannot see the most likely reason a venue will refuse, so it sweeps into cycles it cannot complete.

**Construct.** `bank/revenue.mjs`:
```js
if (!m1.venues.length) throw new Error('neither pinned pool prices within the oracle bound — refusing to sweep into a market we would not trade in')
```
and `bank/swap.mjs` `market()`, which reads only the two pool accounts, the two Pyth accounts, the bitmap and the Clock.

**The defect.** `venues` is a *price* judgement. It does not read the three Orca tick arrays or the three Meteora bin arrays the builder will unconditionally derive, and both programs deserialize those as initialized accounts (`Account<TickArray>` / the pair-bound bin arrays). Two arrays below the current Orca tick is roughly a 30% price band; whether those PDAs exist depends on where liquidity has ever been placed, which is not a property we control and which the fork test cannot certify (it clones whatever exists today). So the gate can say "usable", sweep up to 10 SOL to the operator, and only then discover that neither venue will execute — leaving SOL on the one trusted key, an open cycle, a CRITICAL, and the **hand** recovery, which is the only path that can double-swap (limit 10, A3). Round 29 disposed of the array-existence point as optional hardening on the grounds that it is "loud, not lossy"; what it did not note is that the pre-sweep gate advertises a guarantee it does not provide, and that the frequency of hand recovery is therefore higher than limit 10's runbook implies.

**Evidence that would exist if I am right.** `getMultipleAccountsInfo` on `orcaTickArrayStarts(w.tickCurrent, w.tickSpacing).map(orcaTickArray)` and `meteoraBinArrayIndexes(p.activeId).map(meteoraBinArray)` against mainnet, repeatedly over a week: any `null` in either triple while `market()` reports that venue usable is the defect. The counterfactual is a `--probe` run that reports a venue usable while the swap it would build cannot be simulated.

**Fix.** `market()` already does one batched read; add the six derived arrays to it and drop a venue from `venues` when any of its three is absent (and say which, as it already does for a price refusal). That turns a post-sweep hand recovery into a pre-sweep skip, costs nothing, and makes the quoted guarantee true. Keep the Orca-then-Meteora order.

### L2 — LOW (shared with R0). The ship gate's coverage condition reports satisfied for a file no auditor has been shown.

Stated in R0. `scripts/audit-coverage.sh` is a genuine improvement on round 29's hand-picked globs — it enumerates git's tracked set, names each exclusion, and exits 2 rather than 0 when git cannot answer. But its notion of "seen" is a path literal in an array, and `sim/fixtures.mjs` — executed by `sim/run-sim.sh` step 2 of the certifying 71-assertion simulation, where it patches the real cbBTC/$GARY/$GIRAFFISH mint authorities — is absent from this round's bundle, together with `sim/test-vault.ts`, `sim/run-sim.sh`, `tests/3prog.test.ts` and `scripts/pob-set.json`. **Fix:** bundle them in round 31 (not merely list them in a prepared script), and make the gate read the *rendered* prompt artifacts rather than, or in addition to, the TARGETS arrays.

---

## R6. THE GATES

**No new finding.** What I checked, and what it is worth:

* **Floors are equalities, not lower bounds**, everywhere: `floor()` dies on `-ne`, `MIN_ASSERTIONS` dies on `-ne`, `SWAP_FLOOR` dies on `-ne`, `const FLOOR = 891` in the selftest dies on `!==`, and the selftest cross-checks `FLOOR` against `DET_FLOOR` and checks **every** occurrence of every stated count in SPEC through its anchored `RX` map (with a nonempty requirement, so deleting a count from SPEC is also red). I counted `sim/swap-fork.mjs`'s `rec()` calls: SW.0, 1, 1a, 1b, 4, 4a, 4b, 6, 6a, 6b, 6c, 7, 7a, 7b, 8, 9 = 16 = `SWAP_FLOOR`. ✔
* **The round-24/25 arms are armed in both directions**, including the ones easiest to fake: the eight round-25 L1 tampers are each applied to the *real* built instructions on *both* venues, and each is then shown to pass the reproduced round-24 judge (`judge24`), so the arm provably could fail. The L13b wiring gate strips comments string-aware, reads `main()` and `reconcile()` separately, requires each detector's *result* to be consumed, and proves by mutation that cutting any one call names exactly that detector. The L10/L11/I1/I4/I5/H1 arms drive the real router in a scratch state directory and compare the mirrored `ROUTER_RECOVERY_SRC` to the router's own pattern. The R26 revenue arms execute source-extracted handlers with stubbed I/O rather than asserting on source text. I found no arm that cannot fail and no floor satisfiable by deleting work.
* **`scripts/build-mainnet.sh`** proves, for all five programs: a clean tree at a recorded commit; five `.so` in `dist/` and exactly five; the sweep helper's mainnet bytes identical to both the localnet rebuild **and** `target/deploy/` (the file the suite and sim actually deployed, round 25 N6); and, for the four initializing programs, a behavioural mainnet-REJECTS / localnet-ACCEPTS test against real cloned Core on a validator whose Core is pinned by a hardcoded sha256. Its closing banner states the one thing it cannot prove (that the compiled constant *is* Gary's key) rather than claiming it. One cosmetic weakness: the source check `grep -A1 '#[cfg(not(feature = "localnet"))]' | grep -q "$INIT_KEY"` greps the union of all such blocks' next lines, so with multiple `cfg(not(localnet))` blocks the key need only appear under one of them. MINT has exactly one; worth tightening to a per-block check if another is ever added.
* **`scripts/cron-install.sh` arms nothing it should not.** It refuses to run as root; it refuses any tree carrying `REHEARSAL-RECORD.txt` (and `rehearsal-tree.sh` substitutes `$ROOT`, so the rehearsal copy checks the rehearsal path — exercised by the R26 L6 arm against a synthetic root); `ours()` is anchored to `$TAG <job>[[:space:]]*$`, so `crank-reveal` can no longer arm `crank` in either flag order; `$FLOCK` is `-n` and asserted executable; `$LOCKDIR` is under `$R`, not the `/run/lock` tmpfs; `judgeCronTemplate` holds every `node bank/*.mjs` line to a non-blocking lock, verified against the real file; the installed set is exactly the six tagged jobs; and the money posture is **computed** from the crontab it just wrote rather than asserted.
* **`scripts/token-programs.sh`** pins by source constant with a download-time and a post-boot byte comparison, and `token_programs_verify` refuses any RPC but the local validator. `tests/expiry-budget.mjs` refuses to start if either port is held.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?**

* **Limit 10 is worse than stated, and F1 is why.** It says the detection half "catches an off-box key thief and honest mistakes, never the box's owner", and it bounds the loss at "per-sweep cap × cooldown windows **until the guardian pulls `emergency_stop_sweep`**". An off-box thief can bury each sweep below the alarm's permanent 20,000-signature window for ~0.1 SOL, after which `unledgered_sweep` can never fire for it, `detectUnsweptRoyalties` reads each theft as a successful sweep (its clock resets on every balance fall), and the ledger has no row to contradict. The "until the guardian pulls" term is then unbounded in duration. The limit should either name this or, better, the fix in F1(1) should be taken, since the chain-derived balance fall is already read and persisted every pass.
* **Limit 7's "survivable rather than silent" is worse for the crank than stated, by F4.** A budgeted pass can leave the key below `FEE_FLOOR_LAMPORTS`, after which the every-minute reveal lane sends nothing at all — the stall is loud but total, and it is self-inflicted rather than requiring an outage.
* **SPEC's "Reader coverage boundary" understates the consequence of its own repair.** It says "the gap is real … which is why each one is paged for a human to inspect" and "anyone can cause this for one fee". It does not say that the page is URGENT, carries a fresh pass stamp, and therefore breaks through the router's suppression on every pass — i.e. that an attacker owns an unbounded urgent channel for cents (F2).
* **Limit 10's `short_swap_return` is weaker than it reads.** The detector's tolerance is 2% below `quotedSats`, but `quotedSats` is overwritten with the *post-sweep* expectation and the on-chain floor is 1.5% below that same number, and `revenue.mjs` throws on `delta < guaranteed` before recording. So for any automatic cycle `returnedSats ≥ expected × 0.985 > expected × 0.98`: the detector cannot fire. It still guards hand-entered rows, which is worth saying explicitly in the limit.

**2. Is anything listed as a limit not actually a limit, or closed by something the author did not notice?**

* **Limit 44's "frozen stray account (its transfer reverts the redemption)"** is narrower than written for the *lamports* part: `programs/cbob-vault-sweep` reads `amount` and skips the transfer when it is zero, so a frozen stray account holding **zero** is closed (CloseAccount succeeds on a frozen account with zero balance) rather than reverting. Only a frozen account with a positive balance reverts. Minor correction, in the holder-facing direction.
* **Round 24 D6 (the SEEDS comment claiming a non-existent assertion) is closed** and can be struck from any carry list: eleven seeds are now scraped from the declaring programs with both-ways counterfactuals.
* Nothing else in the ACCEPTED list reads as closed-but-listed.

**3. Is any DISCHARGED item not actually discharged?**

No. I spot-checked the ones most likely to have rotted:

* **51 (the $CBOB boost)** — built, bounded at `initialize`, owner-only, with `BoostTermsMoved`, mirrored exactly in `accrual.mjs`, expired before and after a distribution by the crank, watched as fixed-forever by the alarm, and the ring's wrap now covered by both a host unit test and a default-budget on-chain gate. Discharged.
* **54 (compute at the widest host shapes)** — discharged with the crank unaffected; its residue is an item-50 client obligation and is written as one.
* **33 (the notice branch)**, **30**, **31**, **12/17**, **14**, **19** — each discharged for the stated reason, and the v5 Bank/deck/distributor family is genuinely gone (the selftest's signer-set gate, retired-key-path gate and import gate each prove it with counterfactuals).

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No, and I looked specifically for drift:

* **22** — road step 8 is still "not started", and the five named pass/fail items (crank live, alarm in rehearsal mode, one full cycle through **each** pool, one forced post-sweep failure walked through hand recovery, the DAS burnt read) are intact. `run-tests.sh` still never invokes `revenue.mjs`, exactly as the item says.
* **38** — `launch/mainnet-init.json` still has `charter_opens_at: null` and `lock_deadline: null`, `check-launch-params.mjs` still refuses on either, and the alarm still pages `lock_deadline_unset` CRITICAL in production.
* **50** — no deposit-address page, no redeem page, `judgeRedemptionCoverage` still has no caller, the poster still has no sender (and asserts its own absence). The helper's "BUILT" status is correctly narrowed and `build-mainnet.sh` really does compare the three copies.
* **52** — still open; the in-line monthly degradation is as described.
* **53** — still open and still correctly so: **`launch/rehearsal-init.json` does not exist and `check-launch-params.mjs` has no rehearsal mode** (I read the whole file; `judgeLaunch` has no branch for it). Round 29's refreshed worktree does not change that.

One drift worth naming: **the Reader coverage boundary paragraph was added to OPEN AND BLOCKING without a numbered item, a severity, or an owner.** It is a real, permanent, attacker-reachable property of the monitoring layer (F1 and F2 both live in it) and it is currently sitting as prose between items 50 and 52. Give it a number so a future round cannot re-file it and so its two open consequences are tracked.

---

## WHAT THIS PROJECT SHOULD DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT

I reason over bytes; I do not execute, I do not hold a key, and I cannot see a file that is not in the bundle. These five are the gaps that follow from that, in the order I would spend the time:

1. **Run the dress rehearsal, and make the throughput of the monitoring layer part of it, not just its logic.** Item 22's five named items are necessary but they do not touch F1. Add two more: (a) during the rehearsal, land 25,000 cheap signatures naming the rehearsal MINT and prove the alarm's cursor behaviour and whether a sweep placed before the spam is ever reported; (b) land one runtime-truncated transaction per pass for a day and count the urgent notices that reach the inbox. Both are a few dollars at rehearsal scale and both answer questions no amount of reading settles. I measured neither; I only read the code paths.

2. **Build an off-box, second-opinion witness for exactly three facts, and nothing else.** Limit 10(3) correctly says detection does not survive a compromise of this box. The cheapest honest answer is a tiny job on different hardware, with a different RPC provider and a different notification path, that watches only: the revenue PDA's lamport balance over time, the MINT config's `total_active_weight`/`owed_scaled`/`minted_total`, and the five programs' ProgramData hashes and upgrade authorities. It needs no ledger, no keys, no cron on this host, and it is the only structure that makes the box's owner auditable. Nothing in this tree can be that witness, by construction.

3. **Rehearse the hand recovery of an open revenue cycle with a human who has never read `bank/revenue.mjs`.** It is the only path that can double-swap, the runbook lives in a 400-line SPEC item, and the signatures it tells you to check are spread across four `pendingXSig` fields. A dry run by the author proves the author can read their own notes. Do it with the person who will be awake at 3 a.m., and time it.

4. **Get a second, independent reproducible build.** `build-mainnet.sh` is explicit that it proves "the source at this commit names this key" and not "the compiled constant is that key", and that the bridge is reproducibility. Nobody has yet rebuilt from the release commit on different hardware and matched the five sha256 values. One other machine, one other person, one `diff` — and record it next to `MANIFEST.txt`. Until that exists, the mainnet/localnet behavioural test is a proof about *a* binary, not about the one on the chain.

5. **Witness the custody decisions, and decide them rather than documenting them.** Three hot keys on one box (the swap operator, the whole $CBOB supply, the crank), one hot key off it (the Giraffish Moments update authority) that can end the project during the 7-day charter window, and an `initialize` ceremony whose four transactions must be built *from* `launch/mainnet-init.json` by hand. I can check the JSON against the ruled values — `check-launch-params.mjs` does that well, and it is a genuinely good gate. I cannot check that the transaction someone signs in Phantom was built from that file, and I cannot move `bank/keys/cbob-release.json` off the box. Have a second person read the four `initialize` transactions' decoded instruction data against the JSON, field by field, before any of them is signed, and record who did it.

And one process note, offered because the brief asks for it: of the four rounds of evidence I was handed, the single most useful artifact was round 29's **measured** truncation-grief run — because it turned an argument into a number, and because that number is what let me see, in one pass, that the repair built on it had traded a halt for a paging channel. Keep making the measurement a file. The reports age; `.cache/triage29o/truncation-grief.json` does not.