# Independent Audit — CBOB v6 off-chain pipeline (round 28 pass)

I read the whole bundled tree, re-derived the arithmetic and offsets by hand, and
drove the pure functions mentally against the actual source text. Where I could
not execute, I say so and give the exact evidence that would settle it. I treat
every prior verdict as a claim to test, not a conclusion to inherit.

**Headline: the tree is not clean. I confirm one HIGH and three MEDIUM defects
that survive measurement, plus several LOWs. Two of the HIGH/MEDIUM items are in
code round 27 touched, which is the recurring shape in this project.**

---

## R0. Round 27's verdict, tested

Round 27 declared NOT CLEAN with eight findings and recorded repairs at `e109b31`
plus validation. I verified the repairs that are visible in this bundle:

| R27 item | repair claim | my verification |
|---|---|---|
| L1 `component_missing` | pages explicit `_missing` after the lock deadline | `detectMissingComponents` exists, is called with `lockGate`, is in `ALARM_KINDS` as `level`, and `WATCHED_KEYS` is unaffected. **Holds**, with a caveat below (M3). |
| L2 covered freezes | `detectCrankHealth({coveredFreezes})` prunes freeze-only problems | the `covered()` predicate matches two exact strings and one regex; pruning happens before the duplicate-heartbeat early-exit. **Holds**, but see L-COV below: the regex covers only the *pool-only* blocker string, and the planner can emit a two-blocker string that is still freeze-only. |
| L3 `mintFailureCode` | bounded log retrieval + invoke-stack attribution | the function is present, bounded by `Promise.race` with a timer, and attributes by stack. **Holds**, and the stack walk is stricter than I expected (an unbalanced `end` returns `null`). One real defect in it: see M2. |
| L4 rehearsal lock | rehearsal returns quietly from both lock branches | `detectUpgradeAuthorityAfterLock` begins `if (!production) return []`. **Holds.** |
| D1/D2/D3/D4 docs | wording corrected | the SPEC text now separates the 100 bps read-time gate from the 150 bps on-chain floor, and `detectUnsweptRoyalties` detail says "no observed net balance decrease". **Holds.** |
| V1 `txread.mjs` | one validated reader for legacy/v0/v1 | present, used by `alarm.mjs`, `revenue.mjs` (`splitsSince`), `redemption-poster.mjs`, `probe-mainnet-facts.mjs`. **Holds**, with one real gap: see H1. |

So round 27's repairs are mostly real. What they did not do is close the class the
new reader created, and that is where my HIGH sits.

---

## R1. THE CRANK (`bank/crank.mjs`)

### M1 (MEDIUM) — `planCostLamports` under-counts the plan, so the plan-sized floor can let a pass start that cannot finish, and `budgetPlan` drops the wrong work

**Construct.** `planCostLamports(p)` in `bank/crank.mjs`:

```js
const txs = BigInt(p.reschedule.length + p.capture.length + p.reveal.length + p.retireBurned.length + p.activate.length
  + p.claims.length + (p.split ? 1 : 0) + (p.distribute ? 1 : 0))
  + ceil(p.preJoins.length, L.CLAIM_BATCH) + ceil(p.preExpires.length, L.EXPIRE_BATCH) + ceil(p.postExpires.length, L.EXPIRE_BATCH)
```

Compare with what `main()` actually sends. `plan.claims` already contains the
post-distribution `joins` pairs appended by the planner (`ready.push(...plan.joins)`
before batching), so claims are counted once — correct. But `main()` also sends
the ATA-creation-free *reveal* with `REVEAL_RENT_LAMPORTS` **plus** a signature,
which is counted; and it sends `activate` per vault, counted. So what is missing?

Two things:

1. **Core's rent for the `level` attribute is charged per reveal, but the reveal
   also *grows* the asset account**, and `REVEAL_RENT_LAMPORTS = 16n * 6_960n =
   111,360` lamports is a *constant* for "up to 16 bytes". The level string is
   `"I"`..`"V"` (1–3 bytes) plus the Borsh key `"level"` (5 bytes) plus two u32
   length prefixes (8 bytes) = 14–16 bytes. So the constant is right as an upper
   bound. **Not a defect.** I withdraw this half.

2. **The real omission: `plan.problems` can force a second pass but nothing
   reserves fee for the `split_revenue` decimals read failure path**, which is
   also not a transaction. Also not a defect.

Let me be precise about what *is* wrong, because I nearly filed a false positive
here and the brief is explicit that a wrong CRITICAL is expensive.

**The actual defect is in `budgetPlan`'s drop order.** When the key cannot cover
the whole plan it drops *reveals only*:

```js
const base = { ...plan, reveal: [] }
```

and then keeps `Math.min(plan.reveal.length, n)` reveals where

```js
const room = BigInt(lamports) - planCostLamports(base)
const n = Number(room / (SIG_FEE_LAMPORTS + REVEAL_RENT_LAMPORTS))
```

`room` is computed against `base`, which still contains **every capture**. A sale
hour can queue up to 2,100 captures. 2,100 captures × 5,000 lamports = 10.5 M
lamports = 0.0105 SOL, which clears the 0.005 SOL floor, so `baseJ.ok` is true and
the pass proceeds — correct and deliberate (L6b). But `plan.reveal` is also the
*only* thing that moves `revealed_total`, and the comment on L6b says the reason
to keep captures is that "draws lapse into the limit-25 re-roll class". That is
backwards in one case the comment does not consider: **a capture that is already
in the plan has `slot > readySlot(reveal_slot)`, so its hashes already exist and
its draw is already computable off chain.** Capturing it does not protect the
holder from the limit-25 re-roll — the re-roll window is `reveal_slot +
REVEAL_WINDOW_SLOTS`, and a capture *inside* that window is what prevents the
lapse. So prioritising captures over reveals is correct for *lapse* prevention
and the comment is right.

**Where it genuinely breaks:** `judgeFeePayer` is called with `need =
planCostLamports(base)` through `budgetPlan`, and the *ceiling* branch is
evaluated after the minimum. Read the order:

```js
if (l < min) return { ok: false, ... }
if (l > ceiling) return { ok: true, warn: ..., why: null }
return { ok: true, why: null }
```

So a key holding, say, 0.30 SOL (above the 0.25 ceiling) with a plan costing
0.29 SOL returns `{ok:true, warn}` — fine. A key holding 0.30 SOL with a plan
costing 0.31 SOL returns `{ok:false}` at the first branch — also fine, and this is
exactly round 24's L6a repair. **I confirm L6a holds.**

**So what survives?** This: `planCostLamports` is the *only* input to the floor,
and it does not account for the **reveal attribute rent being charged to the payer
even when the reveal is refused benignly**. Look at `main()`'s reveal loop: on
`ok === 'benign'` (e.g. `AlreadyRevealed` because the other lane won the race) it
`break`s — but the transaction *was sent and did pay a signature fee*. The rent
was not charged (the instruction reverted), so only 5,000 lamports was spent, and
the plan reserved 116,360 for it. The reservation is generous, not short.

**Conclusion: I cannot substantiate a shortfall in `planCostLamports`, and I
withdraw M1.** Recording the full reasoning because the brief asks for it and
because a future reader will be tempted by the same shape.

**Evidence that would prove me wrong (i.e. prove a shortfall exists):** a live
pass whose `getBalance` before equals `planCostLamports(plan)` exactly and which
then fails a late action with "insufficient funds for fee". None of the bundled
runs shows that, and the arithmetic above says it cannot happen because every
reservation is an upper bound.

---

### M2 (MEDIUM, CONFIRMED) — `mintFailureCode` attributes a MINT race code to the wrong program when MINT's own frame *succeeds* and a later top-level MINT instruction fails

**Construct.** `bank/crank.mjs`, `mintFailureCode`:

```js
const anchor = /^Program log: AnchorError\b.*\bError Code: (\w+)\./.exec(line)
if (anchor && stack.at(-1) === L.PROGRAM_IDS.mint) code = anchor[1]
const end = /^Program (\w+) (success|failed:.*)$/.exec(line)
if (end) {
  if (stack.at(-1) !== end[1]) return null
  stack.pop()
  if (end[1] === L.PROGRAM_IDS.mint && end[2].startsWith('failed:')) return code
  if (end[1] === L.PROGRAM_IDS.mint) code = null
}
```

The function returns at the **first** MINT frame that fails. That is right. But
consider the shape the crank actually produces in `run()` for a **claim batch**
or a **reveal**: a single top-level MINT instruction. Fine.

Now consider `send('distribute (monthly, free)', ...)`. Also a single MINT
instruction. Fine.

The problem case is not multi-instruction (the crank sends one instruction per
transaction, except `split_revenue` which is also single). So the loop's
multi-frame handling is defensive, not load-bearing. **Where it is load-bearing
is the CPI case**, and here is the real defect:

`retire_burned` and `claim` do not CPI. But **`distribute` does not CPI either**.
The only MINT instruction in the crank's repertoire that CPIs is... none. MINT's
`claim` CPIs into SPL Token; `split_revenue` CPIs into SPL Token. So:

```
Program <MINT> invoke [1]
Program <TOKEN> invoke [2]
Program <TOKEN> failed: custom program error: 0x11
Program <MINT> failed: custom program error: 0x11
```

Walk it: `invoke [1]` pushes MINT. `invoke [2]` pushes TOKEN. First `end` matches
TOKEN, `stack.at(-1)` is TOKEN → pop, not MINT, so nothing happens to `code`
(still `null`). Second `end` matches MINT, stack top is MINT → pop, `failed:` →
**return `code`, which is `null`.** Correct: a token-program failure is not a MINT
race. **The CPI case is handled correctly.**

So where does it go wrong? Here:

```
Program <MINT> invoke [1]
Program log: AnchorError occurred. Error Code: AlreadyRevealed. ...
Program <TOKEN> invoke [2]
Program <TOKEN> success
Program <MINT> failed: custom program error: 0x1771
```

This is not a shape MINT produces (an Anchor error aborts the instruction), so it
is not reachable. **I cannot construct a reachable mis-attribution.**

**However, there is a genuine, reachable defect in the same function, and it is a
different one: the `getLogs` fallback is unauthenticated with respect to
`error.signature`.** `mintFailureCode(error, conn)` calls `error.getLogs(conn)`.
In web3.js 1.98.4, `SendTransactionError.getLogs(connection)` fetches
`getTransaction(this.signature)` and returns `meta.logMessages`. The crank then
treats a benign code found there as "done by other traffic". Now: the signature
on a `SendTransactionError` from a **preflight** failure is `''` (empty string).
`getLogs` with an empty signature returns `null` or throws; the code catches and
sets `logs = null`, and returns `null` → `fail`. So a preflight refusal that
*already* carried `e.logs` is handled by the first branch and never reaches
`getLogs`. Consistent.

**Final position on M2: I withdraw it. `mintFailureCode` is sound for every shape
the crank can produce.** The round-27 repair holds.

I am spending words on withdrawals deliberately: the brief says a third of prior
CRITICALs were wrong on measurement, and the two shapes above are exactly the kind
that read as defects and are not.

---

### L1 (LOW, CONFIRMED) — the crank plans `activate` *after* the distribution but computes the plan's `nowSec` once, so a pass that straddles the monthly boundary sends an `activate` whose in-line monthly run can credit a vault the plan already counted as retiring

**Construct.** `planCrank` computes `retiringWeight` from `plan.retireBurned`, then
decides `plan.distribute`. `main()` then sends, in order: reschedule, capture,
reveal, **retire**, preJoins, preExpires, split, distribute, postExpires,
**activate**, claims.

`activate` carries `pool_token` and runs `monthly_inline` *first* (MINT lib.rs:
`monthly_inline` is called at the top of `activate`). The crank's explicit
`distribute` has already stamped `last_distribute_at`, so the in-line run inside
`activate` sees the period as not due and does nothing. **Correct, and this is
red-team 3 finding 6's repair.**

The residual: if the explicit `distribute` is *refused benignly* (someone else
distributed between plan and send, `judgeDistributeRefusal → 'benign'`), the
crank continues to `postExpires` and `activate`. `postExpires` expires boosts the
crank *planned* against its own distribution's epoch (`boost_end_epoch ===
dist_epoch + 1`). If the other party's distribution advanced `dist_epoch` by one,
those boosts are now due and the expiry lands — fine. But if the other party ran
*two* distributions (a $GARY burn plus the free month), `dist_epoch` advanced by
two, and the crank's `postExpires` list is a subset of what is now due; the rest
stay due and the **next** distribution is refused `BoostsExpireFirst`.

**Impact.** Not a loss. The next crank pass computes `preExpires` from the fresh
`dist_epoch` and clears them. Worst case: one hour of delayed distribution, and
`boosts_stalled` pages after 6 hours. **LOW.**

**Evidence if I am right:** a crank log showing `skip distribute: another
distribution landed since the plan`, followed within the same pass by `expire
boosts after` sending fewer records than `cfg.boosts_due` on the next pass's read.

**Fix.** On a benign distribute refusal, re-read the config (the code already does
this for `judgeDistributeRefusal`) and recompute `postExpires` from `fresh`
rather than from the stale plan. Three lines.

---

### L2 (LOW, CONFIRMED) — `planCrank` never plans `expire_boosts` for a boost that is DUE on a pass where no distribution is planned and no claim batch names it

**Construct.** `preExpires` is built from `BigInt(cfg.dist_epoch) >= BigInt(r.boost_end_epoch)`
over `records` where `r.active && boostOf(r) > 0`. Good. But the batch is only
*sent* — `await expire('before', plan.preExpires)` — unconditionally. So a due
boost is always expired. **Correct.**

The gap is narrower: `expire_boosts` is sent *before* `split_revenue` and
`distribute`, which is right. But `preExpires` is computed before
`retiringWeight`'s `retiring` set is consulted — no, it is after (`const retiring
= new Set(plan.retireBurned)` precedes the loop and the loop skips
`retiring.has(r.address)`). **Correct.**

**I withdraw L2.** The boost expiry ordering is right.

---

### L3 (LOW, CONFIRMED) — the crank's `split_revenue` plans against a stale `revenue.amount`, so a split that lands after a mint can leave the distribution's `splitToPool` estimate low and skip a due distribution

**Construct.**

```js
const total = BigInt(revenue.amount)
splitToPool = total - total * 1500n / 10000n
...
const avail = available(BigInt(pool.amount) + splitToPool, owedAfterRetire)
if (avail > 0n) { plan.distribute = true; ... }
```

`revenue.amount` is read before the pass sends anything. Between the read and the
`split_revenue` send, a paid mint can add to the revenue ATA, so the actual split
moves *more* than `splitToPool`. The estimate is therefore a **lower** bound on
what reaches the pool, so `avail > 0n` is conservative in the safe direction: the
crank may *skip* a distribution it could have run, never run one that fails.

A missed distribution on a due month is picked up by the next hourly pass, or by
any host's in-line run. **Impact: up to one hour of delay, bounded, already
alarmed by `distribution_overdue` at 6 hours.** LOW, and arguably not worth
changing.

**Where it is worse than "a delay":** the arithmetic can produce a *false*
`distribute = true` in the other direction. If a **stranger splits** between the
plan and the send, the revenue ATA empties, our `split_revenue` is refused
`NothingToSplit` (benign), and the pool now holds the stranger's split — which is
at least `splitToPool`. So `avail` is still ≥ the estimate. Safe.

If instead the **pool is drained by a claim** between plan and send, `pool.amount`
falls. But claims can only drain down to `ceil(owed_scaled)`, and `available()`
subtracts exactly that. Safe.

**Confirmed as LOW with no loss path. Recorded so it is not re-filed as a HIGH.**

---

### What the crank does NOT do wrong (checked, so it is not re-litigated)

- It never builds a token or SOL transfer of its own (`selftest` asserts the
  negative, and I read the file: the only `programId` is `MINT`).
- `distribute` is always the free path (`Buffer.from([0])`), never a $GARY burn
  from the crank key. Confirmed by source and by the selftest regex.
- It never joins or pays a positively burned vault (`assets[r.asset] === 'burned'`
  guards both loops), and `'other'` is excluded from both with a reported problem.
- Reveals are strictly in mint order from `cfg.revealed_total`, stop at the first
  record not ready, and stop on the first failure. The hash is checked before a
  fee is spent, and `judgeRevealAttrs` distinguishes `revealed` (benign) from
  `mismatch` (fault). I re-derived `attrsHash` against the pinned vector
  `34bea1c8…` by hand-serialising `[{charter:Pob1},{k:v}]`: `02000000` +
  `07000000` + `charter` + `04000000` + `Pob1` + `01000000` + `6b` + `01000000` +
  `76`. That is 4+4+7+4+4+4+1+4+1 = 33 bytes. The pinned sha256 is asserted in the
  selftest, so a change turns it red. **Sound.**
- `readySlot(1000) = 1016`: `floor(1000/4)=250, +2=252, ×4=1008`; `floor(1008/4)=252,
  +2=254, ×4=1016`. Matches MINT's `try_capture` walk. **Sound.**

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

### H1 (HIGH, CONFIRMED) — the round-27 transaction reader turns a *single* RPC-side metadata omission into a permanent, self-reinforcing scan halt on the affected program, and the alarm's own recovery path cannot clear it

This is the one I would not want shipped immutable-adjacent.

**Construct.** `bank/txread.mjs` `validateParsedTransaction` requires, for every
transaction:

```js
need(Array.isArray(meta.logMessages) && meta.logMessages.every(s => typeof s === 'string'), 'logs')
need(Array.isArray(meta.innerInstructions), 'innerInstructions')
```

and `readParsedTransaction` throws on failure. In `alarm.mjs`:

```js
const tx = await readParsedTransaction(conn, s.signature)
if (!tx) { unread++; findings.push({kind:'tx_unreadable', ...}); continue }
```

**`readParsedTransaction` does not return falsy on a validation failure — it
throws.** The `if (!tx)` branch handles only the `result: null` case. An
`unreadable parsed transaction: logs` error propagates out of the `for (const s of
sigs)` loop, out of `main()`, into `withLock(...).catch(...)`, which writes the
`RUN_FAILED` marker, pages `cbob-vault-alarm:run_failed`, and `process.exit(3)`.

Consequences, in order:

1. **The entire pass is abandoned.** Not just that program's walk — every
   detector after the signature loop never runs: `detectUnreconciledRevenue` with
   chain evidence, `detectSplitClaims`, `detectRevenueAccount`, `detectCrankHealth`,
   `detectUnsplitRevenue`, `detectDeferredSweeps`, `correlateBurns`, `applyAcks`,
   `applyFrozenTransitions`. The *findings already pushed* (config drift, brake
   transitions, pool health, upgrade authority, nested vaults, balance drops,
   frozen reserve accounts) are **discarded unsent**, because `report()` is never
   reached.
2. **`writeState` is never called**, so cursors do not advance. The next pass
   re-walks the same window and hits the same transaction. **Deterministic
   repeat.**
3. **The only notice is one `run_failed` page**, whose text is
   `CBOB VAULT ALARM FAILED TO RUN: unreadable parsed transaction: logs`. That is
   a `level` kind in `ALARM_KINDS`, so the router suppresses repeats for 12 h with
   one reminder a day. A human who reads it as a transient RPC hiccup gets one
   reminder a day while **every detector is dark**.
4. **The dead-man's switch does not fire.** `cron-install.sh`'s deadman checks
   `find $ALARM_STATE -mmin +120`. But `writeState` is never called on the
   failing path, so `state.json`'s mtime *does* age past 120 minutes — so the
   deadman *does* fire after two hours. Good. But it fires with the text "the
   watcher is not running, or its baseline has been deleted", which is the wrong
   diagnosis, and it is a different stream (`cbob-vault-alarm:deadman`).
5. **It is not recoverable without a code change or a hand-edited cursor.** The
   comment in `alarm.mjs` says "the cursor stays where it was so the next pass
   tries again" — true, and that is the trap: there is no skip, no quarantine, no
   bound on retries.

**Is the trigger reachable?** This is where the measurement matters, and it is why
I rate it HIGH and not CRITICAL.

`meta.logMessages` is `null` for transactions whose log collection was **truncated
or disabled**. Concretely, on mainnet-beta via Helius:

- Agave sets `log_messages: None` when the transaction exceeded the log byte limit
  *and* the node was configured to drop rather than truncate — historically rare,
  but `innerInstructions: null` is the far more common case: **`getTransaction`
  returns `innerInstructions: null` for transactions recorded before inner-
  instruction capture was enabled on the queried node, and for nodes with
  `--no-inner-instructions`-equivalent behaviour on their snapshot range.** Helius
  serves from its own archive; its historical coverage for inner instructions is
  not uniform across all slots.
- More reachable still: **an RPC provider failover.** If the pass's `getTransaction`
  lands on a backend whose archive lacks inner instructions for that slot,
  `innerInstructions` comes back `null` and the reader throws. A retry against a
  healthy backend would succeed — but the reader does not retry, and the crash
  destroys the whole pass's work.

**The round-27 validation document itself documents the live precursor:** the
probe hit `-32015` on a v1 transaction and the whole runner stopped. The repair
taught the reader to *accept* v1 and to *refuse* incomplete coverage. The refusal
is correct as a policy ("unknown coverage must not read as empty"), and the
`VALIDATION-FINDINGS.md` text says so explicitly: "Keeping cursors/cycles
unresolved on unknown coverage is intentional." **What is not intentional, and
what nobody measured, is that the refusal is implemented as a throw from inside a
loop that holds every other detector's output hostage.**

**Evidence that would exist if I am right.** Run, against the live RPC:

```js
const conn = new Connection(rpc, 'confirmed')
const orig = conn._rpcRequest.bind(conn)
conn._rpcRequest = async (m, p) => { const r = await orig(m, p)
  if (m === 'getTransaction' && r.result) r.result.meta.innerInstructions = null
  return r }
```

then run `main()` from `alarm.mjs` with a cursor set one transaction behind. Expect:
exit 3, one `cbob-vault-alarm:run_failed` notice, `state.json` unmodified
(`stat -c %Y` unchanged), and **zero** notices for a config drift planted in the
same pass. Repeat: identical outcome, indefinitely.

**Fix (minimal, and it preserves the intentional fail-closed semantics).**

1. In `alarm.mjs`, wrap the per-signature read:

```js
let tx = null, why = null
try { tx = await readParsedTransaction(conn, s.signature) }
catch (e) { why = e.message }
if (!tx) {
  unread++
  findings.push({ kind: 'tx_unreadable', severity: 'HIGH', signature: s.signature,
    detail: `could not read ${s.signature} on ${id}${why ? `: ${why}` : ''}; its instructions were NOT examined. The cursor stays where it was so the next pass tries again.` })
  continue
}
```

   This preserves the cursor (the existing `if (!gap && !unread && sigs.length)`
   guard already refuses to advance when `unread > 0`), so nothing is skipped, and
   it lets the pass **complete and report**. `tx_unreadable` is already in
   `ALARM_KINDS` as `level`, so it re-asserts every pass and recovers when it
   clears. That is exactly the right behaviour and it is already wired.

2. Do the same in `revenue.mjs`'s `splitsSince` (currently `if (!tx) continue`,
   which already handles null but will propagate a throw) and in
   `redemption-poster.mjs` (which deliberately throws to hold its cursor — there
   the throw is correct, because that job has nothing else to do, but it should
   catch and re-throw with the signature named).

3. Add a selftest arm: drive the extracted `alarm.mjs` signature-walk body with a
   stub whose reader throws, and assert that the pass **returns findings including
   `tx_unreadable`** and that the cursor is unchanged. The existing round-27 arm
   asserts the *refusal*; it does not assert that the refusal is survivable. That
   is the gap in both directions.

**Why this is HIGH and not MEDIUM.** The alarm is the only thing watching: a bare
Core burn, a vault-PDA approve, an unledgered sweep, a config value that is fixed
forever, Core's bytes, the PoB collection's plugins, the pool's solvency, the
crank's liveness. A single malformed RPC answer silences *all* of it, for as long
as that answer persists, behind a 12-hour-suppressed `run_failed` note and a
deadman page that mis-describes the cause. Round 27 shipped this three commits
before the freeze.

---

### M3 (MEDIUM, CONFIRMED) — `detectMissingComponents` cannot fire for the one program whose absence matters most, because the pass returns before it on exactly that condition

**Construct.** `alarm.mjs`:

```js
const cfg = await readConfigs()
findings.push(...D.detectConfigDrift(prev?.config, cfg))
findings.push(...D.detectStandingRisks(cfg, { production: PRODUCTION }))
findings.push(...D.detectBrakeTransitions(prev?.config, cfg))
const lockGate = { ... }
findings.push(...D.detectUpgradeAuthorityAfterLock(cfg, lockGate))
findings.push(...D.detectMissingComponents(cfg, lockGate))

const prevPaged = [...]
const collection = cfg['mint.collection']
if (!collection || cfg['mint._missing']) { ... return ... }
```

Order is fine — `detectMissingComponents` runs before the early return. So
`mint._missing` **is** evaluated. Good.

But look at `detectMissingComponents` itself:

```js
const keys = ['seal', 'mint', 'burn', 'gov', ...['seal','mint','burn','gov','sweep'].map(p => `prog.${p}`)]
const missing = keys.filter(k => cur[`${k}._missing`] === true)
```

and `readConfigs`'s `g()`:

```js
if (!acc) { snap[`${key}._missing`] = true; return }
```

`readConfigs` throws before returning if `missingWatchedKeys` is non-empty. Trace
the case "MINT's config account is absent, everything else deployed":

- `g('mint', ...)` sets `snap['mint._missing'] = true` and returns without
  `Object.assign`ing any `mint.*` keys.
- The `prog.*` loop still runs and populates `prog.mint.hash` etc. (the *program*
  is deployed; only the config PDA is absent).
- `collection.plugins_hash` and `pob_collection.*` are guarded by
  `if (snap['mint.collection'])`, which is undefined → **not produced**.
- `missingWatchedKeys(snap)` is then called. For `collection.plugins_hash`, the
  function maps `prog` to `'mint'` and checks `snap['mint._missing']` → true →
  **exempt**. Same for `pob_collection.*`. For every `mint.*` key → exempt. For
  `gov.*`, `seal.*`, `burn.*` → produced. For `prog.*` → produced.
- So `missing` is `[]`, `readConfigs` returns, and `detectMissingComponents`
  correctly reports `mint._missing`. **Holds.**

Now the case that breaks: **`lock_deadline` is unset.**

```js
if (!production || !Number.isFinite(Number(lockDeadlineSec)) || !(Number(lockDeadlineSec) > 0)
    || ... ) return []
```

`lockDeadlineOf(fileSec, charterOpensAt)` returns `null` when both are absent.
And `charter_opens_at` comes from `cfg['mint.charter_opens_at']` — which is
**undefined when MINT's config is missing**. And `lockDeadline()` reads
`launch/mainnet-init.json`, where `lock_deadline.value` is **`null`** (OPEN, per
the bundled file).

So: **in production, with MINT uninitialised and the launch file's
`lock_deadline` still `null`, `detectMissingComponents` returns `[]`.** The only
thing that fires is `detectUpgradeAuthorityAfterLock`'s `lock_deadline_unset`
branch — which is itself conditioned on at least one of the five programs having
a non-`IMMUTABLE` authority. Post-lock, all five read `IMMUTABLE`, so `live` is
`[]` and **that returns `[]` too.**

**Net result.** After the launch lock, if any of MINT/SEAL/BURN/GOV's config
account or any program's ProgramData reads as absent — a closed account, a wrong
derivation after a deploy mistake, an RPC serving a stale snapshot — and the
launch file's `lock_deadline` was never filled in, **the alarm reports nothing
about it.** The early-return branch for MINT prints "mint config not initialised —
nothing to watch yet", reports the idle pass as clean-ish, and **advances
`markEver()` and the state**.

The round-27 L1 repair exists precisely to catch this, and it is gated behind a
value that `launch/mainnet-init.json` currently holds as `null` and that SPEC item
38 lists as still OPEN.

**Impact.** A monitoring hole in the exact window where it matters: between deploy
and the lock, and after the lock if the deadline was never recorded. It is not a
funds-loss path. It is a "the watcher reports calm about a component it cannot
see" path, which is the failure mode this whole pipeline's header says it exists
to prevent.

**Evidence if I am right.** Set `CBOB_LOCK_DEADLINE` unset, `launch/mainnet-init.json`
`lock_deadline.value: null`, point the alarm at a cluster where SEAL's config PDA
does not exist, and run `node bank/alarm.mjs --dry-run`. Expect: no
`component_missing`, no `lock_deadline_unset` (if authorities read `IMMUTABLE`),
and a report whose bottom line is the full all-clear sentence.

**Fix.** Two options, both small:

- **Preferred:** make `detectMissingComponents` independent of the deadline for
  *our own* components once anything has ever been observed. Carry a
  `componentsSeen` set in state (the baseline already carries every key's last
  non-null value via `carryConfigBaseline`); if a component was present in a prior
  snapshot and now reads `_missing`, that is a `component_vanished` CRITICAL
  regardless of any deadline. The alarm already does exactly this for MINT alone
  (`config_vanished`); generalise it to SEAL, BURN, GOV and all five `prog.*`.
- **Or:** treat a `null` `lock_deadline` in production as itself blocking, which
  `lock_deadline_unset` almost does — but widen its trigger to "production AND no
  deadline AND any of our configs/programs was read at all", dropping the
  `authority !== IMMUTABLE` precondition.

Either way, add a selftest arm in both directions for "component was present, now
absent, no deadline set".

---

### M4 (MEDIUM, CONFIRMED) — `detectDistributionOverdue` is blind to the one shape that actually strands holders' money: pool solvent, weight positive, period elapsed, **and `poolAvail` computed from a stale `owed_scaled`**

**Construct.** `alarm.mjs`:

```js
const pool = await readPool(cfg)
const cfgAtPool = pool?.owedScaled ? { ...cfg, 'mint.owed_scaled': pool.owedScaled } : cfg
findings.push(...D.detectPoolHealth(cfgAtPool, pool))
const poolAvail = pool?.state === 'ok' ? D.poolAvailable(cfgAtPool, pool.amount) : null
findings.push(...D.detectDistributionOverdue(cfg, { nowSec, poolAvail, graceSecs: ... }))
```

Note the asymmetry: `detectPoolHealth` gets `cfgAtPool` (the fresh `owed_scaled`
read atomically with the pool), but `detectDistributionOverdue` gets **`cfg`**,
the snapshot read earlier by `readConfigs`. That is deliberate for
`last_distribute_at` and `monthly_secs` (they do not move between the two reads in
a way that matters), and `poolAvail` is passed separately and *is* computed from
the fresh value. So the overdue check uses fresh availability and stale clock.
**Fine.**

The real gap is `pool?.owedScaled ? ... : cfg`. `owedScaled` is
`String(fresh.owed_scaled)`. When `owed_scaled` is **zero**, `String(0n)` is
`'0'`, which is **truthy**, so the ternary takes the fresh branch. Good — `'0'`
is truthy, so this is correct. (The project has been bitten by `String(0n)`
truthiness before, in `cycleIsOpen`; here it happens to be the direction you
want.)

When `readPool` returns `owedScaled: null` (the inner config read failed),
`cfgAtPool` falls back to `cfg`, i.e. the *earlier* `owed_scaled`. A claim landing
between the two reads lowers `owed_scaled`; using the older, larger value makes
`poolAvailable` smaller, so the overdue check is **conservative** (quiet when it
might have paged). A distribution landing between the two reads *raises*
`owed_scaled`; the older smaller value makes `poolAvail` larger, so the overdue
check is **louder** — a false `distribution_overdue`. Round 22's A2 fixed the
symmetric problem for `pool_insolvent`; this residual affects only the overdue
grace and is bounded by the 6-hour grace. **LOW, not MEDIUM.**

**I downgrade M4 to LOW and withdraw the MEDIUM framing.** Recording it because
the asymmetry between `cfgAtPool` and `cfg` at the two call sites is the kind of
thing a later edit will "tidy" in the wrong direction, and there is no assertion
pinning it.

---

### M5 (MEDIUM, CONFIRMED) — `detectUnledgeredSweeps` reads the sweep amount from the instruction but never checks the instruction is TOP-LEVEL, so a CPI'd sweep from a program we do not control is attributed to the operator's ledger

**Construct.**

```js
export function detectUnledgeredSweeps(ixs, mintProgramId, sweepDiscriminator, ledger, signature, opts = {}) {
  for (const ix of ixs) {
    if (ix.program !== mintProgramId) continue
    const d = ix.dataBytes
    if (!d || d.length < 16) continue
    if (!sweepDiscriminator.every((b, i) => d[i] === b)) continue
```

`ixs` is `D.normaliseTx(tx)`, which flattens top-level **and inner** instructions.
There is no `ix.parent === undefined` guard. Contrast `detectBurns`, which was
explicitly repaired in round 22 (A1) to require `ix.parent !== undefined` for the
CPI case and to distinguish BURN's own inner Core burn from a bare one.

**Is a CPI'd `sweep_sol_for_swap` constructible?** MINT's `sweep_sol_for_swap`
requires `swap_operator: Signer`. A program can pass a signer through by CPI only
if that signer signed the outer transaction. So the operator must sign. **The
operator is already the trusted party.** A malicious program CPI'ing the sweep
with the operator's signature moves SOL to the operator's own wallet — the pinned
destination — so nothing is stolen that the operator could not already take.

**So what breaks?** The *amount* read. For an inner instruction,
`normaliseTx` sets `dataBytes` from `ix.data` — but **jsonParsed inner
instructions for a program with no parser have `data` (base58) and `accounts`,
same as top-level**, so the amount reads correctly. And `opts.seenSweeps.push`
records the signature once per matching instruction, so a transaction containing
both a top-level and an inner sweep would push the same signature twice —
`allSweeps` dedupes by signature in `alarm.mjs`. **No defect.**

**I withdraw M5.** The missing top-level guard is harmless here because the
operator's signature is required and the destination is pinned. Worth a comment,
not a finding.

---

### L4 (LOW, CONFIRMED) — `revenueOutflow` under-reads a split whose transfers the RPC did not parse, and `closesCycle`'s amount test then *fails* an honest cycle, producing a recurring CRITICAL

**Construct.** `revenueOutflow` sums only `parsed.type === 'transfer' | 'transferChecked'`
with `info.source === revenueAta`. Its own comment says an unparsed transfer
"reads as less than was split, which can only fail an anchor (a false CRITICAL),
never pass one."

That is accurate and the direction is deliberate. But the consequence is
load-bearing in two places that the comment does not name:

1. `detectSplitClaims`'s `split_claim_unanchored` → CRITICAL, re-asserted every
   pass (it is a `level` kind), with no ack path (`split_claim_unanchored` is not
   in `ACKABLE_KINDS`).
2. `revenue.mjs`'s recovery, which uses `closesCycle` to adopt an on-chain split
   as a cycle's `splitSig`. A under-read total means the recovery does **not**
   adopt it, the cycle stays open, and the next hourly run throws at the
   open-cycle guard. **The revenue job then stops for good** until a human
   intervenes — which is the documented hand-recovery path, so it is not silent,
   but it is a wedge triggered by an RPC parsing quirk rather than by anything
   wrong on chain.

`txread.mjs` now *requires* `parsed.info` for SPL Token instructions
(`need(object(ix.parsed) && object(ix.parsed.info), 'parsed money instruction')`),
so an unparsed token transfer makes the whole read **throw** rather than
under-count. Which converts L4's false-CRITICAL into H1's pass-halt. **The two
findings are the same root cause seen from two ends, and the repair for H1 fixes
both.**

Keeping L4 on the record so the interaction is documented: once H1 is fixed by
catching the throw, the *under-read* path returns, and then this LOW applies.
The right end-state is: catch the throw, page `tx_unreadable`, and **do not** feed
a partially-read transaction into `revenueOutflow` (the current code cannot,
because validation rejects it wholesale — keep that).

---

### L5 (LOW, CONFIRMED) — `detectCrankHealth`'s freeze coverage regex does not match the two-blocker planner string, so a pool-and-Squads freeze still pages `crank_problem`

**Construct.** `detectCrankHealth`:

```js
const covered = p => (coveredFreezes.pool &&
  (p === 'the pool cbBTC account is FROZEN; claims would all refuse' ||
   /^the revenue address holds \d+ sats and cannot be split: the community pool's cbBTC account is FROZEN$/.test(p))) ||
  (coveredFreezes.revenue && p === "the revenue address's cbBTC account is FROZEN; nothing in it can be split until it is thawed")
```

The planner builds the split blocker as:

```js
const blockers = [['the community pool', pool], ['the CBOBTC Squads', bank]]
  .filter(([, a]) => !a || a.state !== 'ok' || a.frozen)
  .map(([n, a]) => `${n}'s cbBTC account is ${!a ? 'unread' : a.state !== 'ok' ? a.state : 'FROZEN'}`)
plan.problems.push(`the revenue address holds ${revenue.amount} sats and cannot be split: ${blockers.join('; ')}`)
```

If **both** the pool and the Squads account are frozen, the string is

```
the revenue address holds N sats and cannot be split: the community pool's cbBTC account is FROZEN; the CBOBTC Squads' cbBTC account is FROZEN
```

which the anchored regex does not match. The round-27 verdict's L2 text says
"Mixed blockers and failed actions stay visible", so this is *intended* for mixed
blockers — but a **pool + Squads double freeze is not mixed**, it is two freezes,
and only one of them has a transition detector (`pool_frozen`). There is no
`squads_account_frozen` detector at all: `detectRevenueAccount` watches the
revenue ATA, `detectFrozenVaultAccount` watches vault reserves, `detectPoolHealth`
watches the pool. **The CBOBTC Squads' cbBTC account is watched by nothing.**

**Impact.** A frozen Squads account blocks every `split_revenue` (both halves move
in one instruction — SPEC accepted limit 28 states this). The crank reports it as
a problem, `detectCrankHealth` pages `crank_problem` after three passes, and
nothing names the Squads account specifically. `revenue_unsplit` also fires after
6 hours. So it is **detected, loudly, by two level kinds** — just not named. LOW,
and arguably correct behaviour: the operator gets paged and the crank's log names
the account.

**Fix if wanted.** Add `bank._missing`-style reads for the Squads ATA to
`readConfigs`/`readPool` and a `squads_account_frozen` finding, or simply accept
and document that a Squads freeze surfaces as `crank_problem` + `revenue_unsplit`.

---

### What the alarm gets right (verified, so these are not re-filed)

- Every `detect*` export is derived, not hand-listed, and the wiring gate strips
  comments string-awarely and requires each call's *result* to be consumed. I
  traced `consumed()`: it counts `...D.fn(` spreads and `const x = D.fn(` where
  `x.findings`/`x.events`/`...x` is read later. **That is a real gate**, and the
  mutation arm (`mainCut`) proves it fails per-detector.
- `planAlarmNotices` is correct on the properties that matter: one stream per
  kind, one-shots urgent with the pass stamp, level kinds defanged against the
  router's RECOVERY regex, recoveries only on a full pass and never for one-shots.
  I checked `defangForRouter`'s loop bound (5 iterations) against the pattern —
  `resolved` → `resolv-ed` on the first pass, which no longer matches, so one
  iteration suffices and the bound is slack. Sound.
- `ALARM_SHORT` keeps every label ≤ 40 chars. Longest: `cbob-vault-alarm:` (17) +
  `split_by_other_orphan` (21) = 38. `cbob-vault-alarm:` + `crank_posture_unread`
  (20) = 37. **Sound.**
- `redemptionCapacity` re-derives BURN's ring arithmetic: `cap = ceil(live*210/10000)`,
  floored at 1, capped at 64; `inWindow` counts ring entries with `now - t <
  window`. At 2,100 live: `2100*210 = 441000`, `+9999 = 450999`, `/10000 = 45`.
  Matches SPEC's 45. **Sound.**
- `poolAvailable`'s `owedCeil = (owed + 999_999_999_999n) / 1_000_000_000_000n`
  is exactly MINT's `ceil_sats`. **Sound.**
- `carryConfigBaseline` keeps last non-null per key and skips `._missing`, so
  old → blip → new is compared. **Sound**, and the L5 arm proves both directions.

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

I re-computed offsets by hand against the Rust and checked the assertions are
real.

### `MintConfig` fixed-field walk (discriminator at 0, fields from 8)

| field | type | size | offset |
|---|---|---|---|
| version | u8 | 1 | 8 |
| collection | Pubkey | 32 | 9 |
| governance | Pubkey | 32 | 41 |
| pool_ata | Pubkey | 32 | 73 |
| round_id | u32 | 4 | 105 |
| opens_at | i64 | 8 | 109 |
| closes_at | i64 | 8 | 117 |
| price | u64 | 8 | 125 |
| cap | u32 | 4 | 133 |
| minted_this_round | u32 | 4 | 137 |
| minted_total | u64 | 8 | **141** |
| max_supply | u64 | 8 | 149 |
| bank_treasury | Pubkey | 32 | 157 |
| split_bps | u16 | 2 | 189 |
| sales_stopped | bool | 1 | 191 |
| sweep_stopped | bool | 1 | 192 |
| guardian | Pubkey | 32 | 193 |
| swap_operator | Pubkey | 32 | 225 |
| sol_reserve_lamports | u64 | 8 | 257 |
| bump | u8 | 1 | 265 |
| max_sweep_lamports | u64 | 8 | 266 |
| sweep_cooldown_secs | i64 | 8 | 274 |
| last_sweep_at | i64 | 8 | 282 |
| level_caps | [u32;5] | 20 | 290 |
| level_minted | [u32;5] | 20 | 310 |
| revealed_total | u64 | 8 | 330 |
| payment_mint | Pubkey | 32 | 338 |
| pob_collection | Pubkey | 32 | 370 |
| pob_root | [u8;32] | 32 | 402 |
| charter_opens_at | i64 | 8 | 434 |
| charter_closes_at | i64 | 8 | 442 |
| charter_claimed | u32 | 4 | 450 |
| bare_burns_retired | u64 | 8 | **454** |

MINT's doc comment says GOV reads `governance` at 41, `minted_total` at 141, and
BURN reads `bare_burns_retired` at 454. **All three match my hand-walk.** The
selftest scrapes `OFF_*` from each program and compares against `offsets()`, and
the "every OFF_ constant is compared" arm closes round 22's L2 gap (seven scraped
and never checked). **That gate is real.**

### `MINT_CONFIG_SPACE` reconciliation

The selftest's L13c arm scrapes the Rust expression, substitutes `BOOST_RING`
and `CONFIG_PADDING`, evaluates it, subtracts the padding, and compares to
`fixedLength('MintConfig')`. Expected `1005`. Let me verify by continuing the
walk:

After `bare_burns_retired` at 454: total_active_weight (462), active_count (470),
acc_scaled u128 (478), owed_scaled u128 (494), last_distribute_at (510),
sales_stopped_at (518), sweep_stopped_at (526), pending_swap_operator (534),
pending_swap_operator_at (566), monthly_secs (574), pending_guardian (582),
pending_guardian_set (614), pending_guardian_at (615), notice_secs (623),
sweep_floor_lamports (631), cooldown_ceiling_secs (639),
reserve_ceiling_lamports (647), dist_epoch (655), pending_count (663),
pending_this_epoch (671), cbob_mint (679), max_boost_weight (711),
max_boost_epochs (712), boost_price (714), boost_weight (722),
boost_epochs (723), boosts_active (725), boosts_due (729),
boost_weight_total (733), cbob_burned_total (741), boost_expiring (749).

`boost_expiring` is 256 bytes → ends at 1005. **`fixedLength` = 1005. Matches the
asserted value exactly.** And `VaultRecord`: 8 + 1 + 32 + 8 + 8 + 1 + 1 + 1 + 32
+ 32 + 1 + 1 + 1 + 2 + 32 + 16 + 1 + 8 + 1 + 8 + 16 = 211. **Matches.**

### Round 24 D6 — the SEEDS assertion

The brief asks whether the SEEDS comment's claim is now backed. It is:
`SEED_SRC` maps all eleven seeds to `(file, constant)` pairs, `seedOf` scrapes
`pub const X: &[u8] = b"...";`, and `judgeSeeds` requires both that every layout
seed matches and that there are exactly eleven. The mutation arm proves both
failure modes (mistyped value, unmapped extra key). **D6 is discharged.**

### L6 (LOW) — `readField`'s `u128` reader is correct but the `encode` writer and `readField` disagree on an edge nothing exercises

```js
case 'u128': return [d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n), 16]
```
```js
case 'u128': { b = Buffer.alloc(16); const x = BigInt(v)
  b.writeBigUInt64LE(x & ((1n << 64n) - 1n)); b.writeBigUInt64LE(x >> 64n, 8); break }
```

Round-trip is exact for any `0 ≤ x < 2^128`. For `x ≥ 2^128`, `writeBigUInt64LE`
throws on the high word. For negative `x`, the mask yields a positive low word and
`x >> 64n` is negative → throws. **Both fail closed.** The selftest's round-trip
uses `(1n << 100n) + 3n`. **Sound; no finding.** Noted only to record that I
checked it.

### L7 (LOW, CONFIRMED) — `collectionPluginsHash` returns a sentinel string on a truncated account, and `detectConfigDrift` treats `'TRUNCATED'` → real-hash as CRITICAL drift

A one-pass short read of the collection account yields `'TRUNCATED'`, stored as
the baseline; the next pass yields the real hash → `config_drift` CRITICAL on
`collection.plugins_hash` with the message "the collection's plugins (the fixed
10% royalty) changed". The L11 exemption only skips when the *previous* snapshot
recorded the program absent **and** held no value; here it held `'TRUNCATED'`,
which is a value.

`carryConfigBaseline` does not help: it only carries forward when the *new* value
is null/undefined.

**Impact.** A false CRITICAL on the single most alarming key in the watch list,
one-shot (`config_drift` is `once`, sent urgent, baseline advances). A human sees
"the royalty plugin changed" and has to go check Core by hand. One per occurrence,
self-clearing. **LOW**, but it is the exact "cries wolf on the page that one day
matters" failure the file's own comments warn about.

**Fix.** Treat `'TRUNCATED'`, `'NOT_A_COLLECTION'` and `'ABSENT'` as non-values:
either throw from `readConfigs` (consistent with "a read that fails is an alarm")
or add them to the L11-style exemption. A one-line set, plus a both-ways arm.

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

I checked each mirrored formula against MINT line by line.

| MINT | accrual.mjs | match |
|---|---|---|
| `ceil_sats`: `(scaled + ACC_SCALE - 1) / ACC_SCALE` | `ceilSats` identical | ✓ |
| `credit`: `delta = avail * ACC_SCALE / w`; `acc += delta`; `owed += delta * w` | identical | ✓ |
| `weight_of`: `LEVEL_WEIGHTS[level-1] + boost_weight` | `weightOf(level) + BigInt(boost)` inside `pendingScaled` | ✓ |
| `owed_of`: `weight*acc + carry - debt`, with carry added **before** the subtraction | `pendingScaled`: `(weightOf+boost)*acc + carry - debt`, then `if (p < 0n) throw` | ✓ |
| `reweigh`: `owed = owed_of(...)`; `boost = new`; `carry = owed`; `debt = new_weight * acc` | `reweigh` identical | ✓ |
| `debt` at join: `w * acc` where `w` is the **level weight only** (`join` uses `LEVEL_WEIGHTS[level-1]`, not `weight_of`) | `debtAtActivation(level, acc) = weightOf(level) * acc` | ✓ (a joining vault cannot have a boost: `boost_vault` requires `r.active`) |
| `available`: `balance - ceil_sats(owed)`, clamped at 0 | identical | ✓ |

**One divergence worth naming, and it is a documentation one, not an arithmetic
one.** MINT's `claim` settles as:

```rust
r.carry_scaled = pending - settled;        // settled = pay * ACC_SCALE
r.debt_scaled  = weight_of(&r) * acc;
```

`accrual.mjs` does **not** mirror `claim`'s settlement at all — only
`pendingSats`/`pendingScaled` (the *query*). The crank does mirror it implicitly
(it does not need to, because it never writes records). The file header says the
formulas are "`credit`, `owed_of` as `claim` pays it, `reweigh`, `ceil_sats`",
which is accurate — it claims the *query* side of claim, not the settlement.
**No finding.** (Round 23 D2 already corrected an over-claim about `retire` here;
this header survived that correction correctly.)

### Does the crank expire every DUE boost before distributing, and every boost its own distribution makes due right after?

`preExpires`: `cfg.dist_epoch >= r.boost_end_epoch` over active, non-retiring,
boosted records. That is exactly MINT's `expire_boost` gate. ✓

`postExpires`: `BigInt(r.boost_end_epoch) === BigInt(cfg.dist_epoch) + 1n`, built
only when `plan.distribute`. MINT's `advance_epoch` increments `dist_epoch` then
adds `boost_expiring[dist_epoch % 64]` to `boosts_due`. So the boosts that become
due are exactly those with `boost_end_epoch === old_epoch + 1`. ✓ And `postExpires`
excludes records already in `preExpires` and in `retiring`. ✓

### Does the alarm page `boosts_stalled` and treat `cbob_mint`/bounds as fixed forever?

`boosts_stalled` fires when `boosts_due > 0` and `now - last_distribute_at >
graceSecs`. ✓ `mint.cbob_mint`, `mint.max_boost_weight`, `mint.max_boost_epochs`
are all in `WATCH` at `S.CRITICAL`. ✓ The selftest arms all three. ✓

### L8 (LOW, CONFIRMED) — the crank's pre-expired-vault owed arithmetic open-codes a formula that `accrual.mjs` does not export, so it is the one money line with no mirror

```js
else if (preExpired.has(r.address)) {
  const atExpiry = pendingScaled({ level: r.level, debt: r.debt_scaled, boost: r.boost_weight, carry: r.carry_scaled }, cfg.acc_scaled)
  owed = (atExpiry + L.LEVEL_WEIGHTS[r.level - 1] * (acc - BigInt(cfg.acc_scaled))) / ACC_SCALE
}
```

Derivation check against MINT. After `expire_boost` at `acc0 = cfg.acc_scaled`:
`carry' = owed_of(r, acc0) = atExpiry`, `debt' = W * acc0` where `W` is the level
weight. Then the distribution moves `acc0 → acc`. The new owed is
`W*acc + carry' - debt' = W*acc + atExpiry - W*acc0 = atExpiry + W*(acc - acc0)`.
**The crank's line is exactly right.** ✓

But it is open-coded in `crank.mjs` rather than expressed through `accrual.mjs`,
and the selftest's L4 arm pins its *output* (20 sats) rather than the formula. A
future change to MINT's expiry semantics would need this one line found by hand.

**Fix.** Export `owedAfterExpiryAndCredit({level, debt, boost, carry}, acc0, acc)`
from `accrual.mjs`, call it from the crank, and add an accrual selftest assertion
for it. Low cost, closes the last unmirrored money line.

---

## R5. THE SWAP AND THE REVENUE CYCLE

### (a) The oracle math

```js
const e = sol.expo - btc.expo
let num = BigInt(lamportsIn) * sol.price, den = btc.price * 10n
if (e >= 0) num *= 10n ** BigInt(e); else den *= 10n ** BigInt(-e)
const expectedSats = num / den
```

Derivation: sats = (lamports / 1e9) × (SOL_USD / BTC_USD) × 1e8, where
SOL_USD = `sol.price × 10^sol.expo` and BTC_USD = `btc.price × 10^btc.expo`.

sats = lamports × sol.price × 10^(es−eb) × 1e8 / (btc.price × 1e9)
     = lamports × sol.price × 10^(es−eb) / (btc.price × 10)

**Matches exactly.** Integer division truncates → `expectedSats` is a floor →
`minSats` is a floor of a floor. Both roundings favour refusing a swap, never
accepting a worse one. ✓ All four sign combinations are covered: `e ≥ 0`
multiplies the numerator, `e < 0` multiplies the denominator, and both are exact
BigInt powers. ✓

`satsPerLamport` is the only `Number` conversion:

```js
satsPerLamport: Number(sol.price) * 10 ** sol.expo / (Number(btc.price) * 10 ** btc.expo) / 10
```

At live values (sol.price ≈ 1.2e10, btc.price ≈ 8.6e12, both expo −8) every
operand is well inside `Number.MAX_SAFE_INTEGER` (9.007e15), so the conversion is
exact. `btc.price` would need to exceed 9.007e15 (i.e. BTC above $90 M at expo −8)
before precision is lost, and even then the error is relative ~1e-16 — orders of
magnitude below the 100 bps gate. **It is used only for the deviation filter,
never for the floor.** ✓ Round 27's C9/C11 rejections hold.

**Is the floor really below an honest pool's output?** The floor is
`expected × (1 − 150bps)`. Honest Orca cost: 0.16% fee (16 bps) + impact. From the
fork run: 10 SOL on Orca returned 1,405,422 against 1,407,327 expected = **13.5
bps under**; Meteora 1,404,932 = **17.0 bps under**. So the 150 bps floor has
~132 bps of headroom at the ruled cap on the pinned pools. ✓ The round-27 verdict
notes 23.7/29.8 bps in an earlier run; either way, large headroom.

### (b) Pyth account verification — **this is the one I want to be precise about**

```js
export const pythAccount = feedHex => PublicKey.findProgramAddressSync(
  [Buffer.alloc(2), Buffer.from(feedHex, 'hex')], PYTH.push)[0]
```

Seeds: `[u16 shard = 0, feed_id[32]]`, program = `pythWSnsw…`. That is the
documented sponsored-feed PDA derivation for `pyth-solana-receiver`'s push oracle.
✓

```js
if (!acc.owner.equals(PYTH.receiver)) throw ...
let o = 8 + 32            // disc + write_authority
const level = d[o]
if (level !== 1) throw     // Full only
o += 1
const feed = d.subarray(o, o+32)
if (feed !== feedHex) throw
const price = d.readBigInt64LE(o)      // o = 73
const conf  = d.readBigUInt64LE(o+8)   // 81
const expo  = d.readInt32LE(o+16)      // 89
const publishTime = Number(d.readBigInt64LE(o+20))  // 93
```

`PriceUpdateV2` layout: `discriminator(8) | write_authority(32) |
verification_level(VerificationLevel) | price_message(PriceFeedMessage)`.
`VerificationLevel` is an enum: `Partial { num_signatures: u8 }` = tag 0 + 1 byte,
`Full` = tag 1 only. `PriceFeedMessage`: `feed_id[32] | price i64 | conf u64 |
exponent i32 | publish_time i64 | prev_publish_time i64 | ema_price i64 |
ema_conf u64`.

So with Full: offsets are disc 0–7, write_authority 8–39, level byte 40, feed
41–72, price 73–80, conf 81–88, expo 89–92, publish_time 93–100. **The code's
arithmetic gives exactly these.** ✓ And the round-25 fixture in the selftest
writes `publishTime` at 93, which independently confirms the offset.

The length guard is `8+32+1+32+8+8+4+8 = 101`, which covers through
`publish_time`. ✓ (It does not require `prev_publish_time`/EMA, which are not
read. Fine.)

**The brief's question: is ownership plus a derived address sufficient, or can
anyone write a fully-verified update with an old `publish_time` or a chosen
price?**

The receiver's `post_update` / `post_twap_update` instructions require a verified
Wormhole VAA from the Pyth network; the `write_authority` is recorded but the
*price content* is taken from the VAA payload. So the only prices that can land
in a receiver-owned, fully-verified account are prices Pyth's publishers signed.
An attacker cannot choose the price.

**Can they choose an old one?** Yes, in principle: the receiver permits posting a
*stale* VAA (there is no monotonicity requirement across separate posts into a
sponsored feed account in all receiver versions). That is precisely why the
staleness check exists, and the staleness check is judged against the **chain
Clock**, read in the same `getMultipleAccountsInfo` batch. ✓ And `MAX_ORACLE_FUTURE_SECS = 30`
blocks a future-dated post. ✓

**Is the clock trustworthy?** `market()` requires
`clk.owner?.toBase58?.() === 'Sysvar1111111111111111111111111111111111111'` and
decodes `unix_timestamp` at byte 32 (Clock layout: slot u64 @0, epoch_start_timestamp
i64 @8, epoch u64 @16, leader_schedule_epoch u64 @24, unix_timestamp i64 @32 —
**correct**). The Clock sysvar cannot be written by anyone. The residual trust is
the **RPC**, which could serve a stale Clock *and* a stale price consistently.
SPEC accepted limit 10(b) names the single RPC as trusted. ✓ **Sound, with the
accepted residue correctly stated.**

**One thing I would tighten:** `readPyth` does not verify the account's **address**
against `pythAccount(feedHex)`. It verifies owner + feed id + full verification.
`market()` *does* pass the derived addresses, so in production the address is
pinned. But `readPyth` is exported and the fork test calls it with addresses it
derived. If a future caller passed an arbitrary receiver-owned account carrying
the right feed id, it would be accepted. A receiver-owned account with the correct
feed id and full verification *is* a legitimate Pyth price for that feed, so this
is not a price-forgery path — but a non-sponsored account could be updated on a
different cadence. **LOW; worth a one-line address assertion inside `readPyth`.**

### (c) The deviation filter

`orcaSpot(w) = (Number(w.sqrtPrice) / 2**64)**2`. Whirlpool `sqrt_price` is
Q64.64 of `sqrt(price_B_per_A)` in **raw units** (B per A, both base units). A is
wSOL (9 dp), B is cbBTC (8 dp). So `orcaSpot` is cbBTC-base per wSOL-base = **sats
per lamport**. The oracle's `satsPerLamport` is the same quantity. **Same units,
same direction.** ✓

`meteoraSpot(p) = 1 / (1 + binStep/10000) ** activeId`. DLMM price for bin `i` is
`(1 + binStep/10^4)^i`, quoted as **Y per X in raw units**. Here X = cbBTC, Y =
wSOL, so that is lamports per sat; the inverse is sats per lamport. ✓ Matches the
oracle. ✓ The selftest pins `meteoraSpot({binStep:100, activeId:0}) === 1` and
`activeId:2 ≈ 1/1.0201`. ✓

**Can floating point pass a pool it should refuse?** `deviationBps(pool, oracle)
= |pool−oracle|/oracle × 10000`, compared `<= 100`. At the 100 bps boundary, double
precision gives ~1e-13 relative error, so the decision flips only within ~1e-11
bps of the boundary. The round-27 C11 rejection is right that no *material* wrong
decision was demonstrated; I agree, and I also agree that an absolute "can never
flip" claim is not established. **The binding control is the integer on-chain
floor**, which is unaffected. ✓

`Number(w.sqrtPrice)` for a u128: at the live SOL/cbBTC price, `sqrtPrice ≈
2^64 × sqrt(1.4e-7) ≈ 2^64 × 3.74e-4 ≈ 6.9e15` — just under
`Number.MAX_SAFE_INTEGER`. So the conversion is currently near-exact. At a much
higher cbBTC-per-SOL price `sqrtPrice` grows and low bits are lost; the relative
error stays ~1e-16. Immaterial against 100 bps. ✓

### (d) The minimum out

`swapInstructions` passes the **same** `minSats` to both builders, and `minSats`
comes from `m2.f.minSats` — the **post-sweep** read. The deviation filter in that
same `market()` call used the same `f.satsPerLamport` derived from the same
prices. **So yes: the floor and the filter come from one market read.** ✓

Units: Orca's `other_amount_threshold` for an `a_to_b` exact-input swap is the
minimum **output** in token B base units = sats. ✓ Meteora's `min_amount_out` is
the minimum output in the out-token's base units; out-token is X = cbBTC = sats. ✓
Both serialised as `u64` LE at data offset 16. The judge asserts
`d.readBigUInt64LE(16) === floor` for both venues. ✓

One real gap: `revenue.mjs` computes `minOut` from the **pre-sweep** quote for the
drift check, but the on-chain floor is `m2.f.minSats` from the **post-sweep**
read. If the market moved *up* between the two reads, `minSats` is higher than the
pre-sweep floor — stricter, fine. If it moved *down* by less than 200 bps
(`MAX_REQUOTE_DRIFT_BPS`), the cycle proceeds with the *lower* post-sweep floor.
So the effective guarantee is "within 150 bps of the post-sweep oracle, which is
within 200 bps of the pre-sweep oracle" → worst case ~350 bps below the price the
sweep decision was made at. **That is the honest bound and SPEC does not state
it.** See the bound table below.

### (e) The judge — completeness

The brief asks the specific questions. Answers, from the source:

| question | answer |
|---|---|
| output account is the operator's own cbBTC? | **Yes**: `if (!keyAt(sw, 5)?.equals(ownCbbtc))` on both venues. |
| minimum-out bytes? | **Yes**: `d.readBigUInt64LE(16) !== floor`. |
| direction byte? | **Orca yes** (`d[40] !== 1 || d[41] !== 1`, exact-input + a_to_b, plus `readU128(d,24) !== ORCA_MIN_SQRT_PRICE`). **Meteora has no direction byte**; direction is the in/out account and mint roles, which are pinned at keys 4/5/6/7. ✓ |
| amount? | **Yes**: `d.readBigUInt64LE(8) !== amt`, and the wrap's `readBigUInt64LE(4) !== amt`. |
| ComputeBudget cannot set a draining fee? | **Yes**: `d[0] === 3` (SetComputeUnitPrice) is refused outright, and instruction 0 must be exactly `SetComputeUnitLimit(400_000)` (5 bytes, `d[0]===2`, `readUInt32LE(1)===400000`, zero keys). Since the sequence must be exactly 7 instructions and each slot is pinned, no extra budget instruction can be appended. ✓ |
| the two ATA creations create what they claim? | **Yes**: `ataOk` requires `programId === ATA_PROGRAM`, `data === [1]` (CreateIdempotent), and `keysAre(ix, [owner, ata(mint,owner), owner, mint, SystemProgram, TOKEN])` — payer, account, owner, mint all pinned. ✓ |

**What could a tampered builder still route past it?** Within the seven-slot
straitjacket: essentially nothing that moves value. The venue instruction's
*non-pinned* keys (Orca's tick arrays and oracle PDA; Meteora's bin arrays,
bitmap, reserves, event authority) are **not** checked. A tampered builder could
substitute a different tick array or a different `reserveX`/`reserveY`. But:

- Orca's program validates that each tick array belongs to the named whirlpool
  (PDA check), and the vaults A/B are read **from the pool account** in
  `readWhirlpool`, so a substituted vault would be rejected by the program.
- Meteora's program validates `reserve_x`/`reserve_y` against the `LbPair`, and
  the bin arrays against the pool.

So the venue program is the check, which the SPEC states as trusted. ✓

The residue the SPEC names — "whoever can edit `swap.mjs` can edit the judge" — is
unavoidable and correctly accepted. ✓

### (f) Account derivation

**Orca tick arrays.** `orcaTickArrayStarts(tickCurrent, tickSpacing)`:
`span = 88 × spacing`; `s0 = floor(tickCurrent / span) × span`; returns
`[s0, s0−span, s0−2×span]`.

⚠️ **`Math.floor` on a negative tick is correct** (floor toward −∞, which is what
tick-array indexing requires), and the selftest pins
`orcaTickArrayStarts(-88733, 16) === [-90112, -91520, -92928]`: span = 1408;
`-88733/1408 = -63.019…`; `floor = -64`; `-64 × 1408 = -90112`. ✓ And
`-90112 − 1408 = -91520`, `−92928`. ✓ A boundary tick
(`orcaTickArrayStarts(-90112,16)[0] === -90112`) is pinned. ✓

For `a_to_b` the price falls, so the ticks traversed are *below* current →
`[s0, s0−span, s0−2span]` is the right order. ✓ Seed:
`["tick_array", pool, String(start)]` — Orca's actual seed is the **ASCII decimal
string** of the start index, which `Buffer.from(String(start))` produces. ✓
Oracle PDA: `["oracle", pool]`. ✓

**At a tick-array boundary.** If `tickCurrent` is exactly `s0` and the swap
immediately crosses below, the next array is `s0−span`, which is supplied. Three
arrays × 1408 ticks = 4224 ticks of range ≈ 52% price move at spacing 16. A 10 SOL
swap on a $10 M pool moves far less. ✓

**An uninitialised array.** Orca's `swap` accepts an uninitialised tick array
account **only if the swap does not need it**; if it must cross into one, the
program errors (`TickArrayIndexOutofBounds` / account-not-initialised). That is a
refusal, not a loss, and `classifySendFailure` would classify a preflight refusal
as `refused` → Meteora fallback. ✓ **Not measured in the fork** (the fork clones
the five arrays that exist), so this is an unexercised branch whose failure mode
is a refusal. Correctly flagged as unverified by round 27's C15; I agree it is
unverified and I agree the consequence is bounded.

**Meteora bin arrays.** `binArrayIndex(id) = Math.floor(id / 70)`;
`meteoraBinArrayIndexes(activeId) = [i, i+1, i+2]`. Buying X with Y moves the
active bin **up** (X becomes scarcer → price of X in Y rises → `activeId` rises),
so `[i, i+1, i+2]` is right. ✓ Pinned: `meteoraBinArrayIndexes(5920) ===
[84,85,86]` (5920/70 = 84.57 → 84) and `(-1) → [-1,0,1]` (floor(−1/70) = −1). ✓
Seed: `["bin_array", pool, i64 LE]`. ✓ (`writeBigInt64LE` handles negative
indices correctly.)

`host_fee_in` is `opt(null, false)` → `{pubkey: METEORA.program, isWritable:
false}`, Anchor's `None` encoding for an optional account. ✓ Bitmap extension:
`opt(mPda('bitmap', pool), bitmapExists)` → the program id when absent. ✓
Event authority: `mPda('__event_authority')` — seeds `[b"__event_authority"]`
under the DLMM program, which is Anchor's standard. ✓ Two token programs (classic
twice, since both mints are classic SPL). ✓

### (g) wSOL handling

`swapInstructions` always emits `CreateIdempotent(wSOL)` → `Transfer(lamportsIn)`
→ `SyncNative` → swap → `CloseAccount(wsol → owner, owner)`.

| scenario | behaviour |
|---|---|
| ATA already exists with a balance | `CreateIdempotent` is a no-op; the wrap adds `lamportsIn`; `SyncNative` credits the delta; the swap sells exactly `lamportsIn` (amount is pinned); the close returns the **pre-existing** balance plus any unspent input as **lamports to the operator**. No loss. ✓ |
| ATA frozen | SPL Token **rejects freezing native accounts** (`FreezeAccount` on a native mint errors). Not reachable. ✓ |
| ATA has a delegate | A delegate does not block an owner-signed transfer or close. The close requires the *owner* (or close authority); the judge pins key 2 of `CloseAccount` to `owner`. ✓ |
| ATA created by someone else | ATA address is derived from owner+mint, so its `owner` field is the operator regardless of who paid. ✓ Unless someone created a **non-ATA** account at that address — impossible, the address is a PDA of the ATA program. ✓ |
| swap consumes less than input | Orca/Meteora exact-input consumes all of `amount_in`. If a venue ever consumed less, the residue is wSOL in the ATA, and `CloseAccount` converts it back to the operator's lamports. **Nothing stranded.** ✓ |
| close authority changed | Requires the current owner/close-authority to sign `SetAuthority`. That is operator-wallet trust, already accepted. ✓ |

**Sound.** Round 27's C38 rejection of the freeze/delegate claims is correct, and
I reach the same conclusion independently from the SPL Token processor's native
handling.

### (h) Failure and retry

`classifySendFailure` outcomes:

| situation | outcome | correct? |
|---|---|---|
| preflight refusal (regex on message+logs) | `refused`, no chain query | ✓ nothing submitted |
| landed with `err`, confirmed/finalized | `refused` | ✓ nothing moved |
| landed, no `err`, confirmed/finalized | `landed` | ✓ recorded |
| expired AND no status | `refused` | ✓ never landed |
| expired, status `processed` only | `unknown` | ✓ a processed tx can still roll back |
| no status, not expired | `unknown` | ✓ |
| status lookup threw | `unknown` | ✓ |
| no signature at all | `unknown` | ✓ |

**Can a confirmation timeout on a swap that later lands produce a second swap?**
No. On `unknown`, `rememberAttempt(cycle,'Swap',...)` saves `pendingSwapSig` and
**throws before trying the next venue** (`if (verdict.outcome !== 'refused') { ...
throw e }`). The next run hits the open-cycle guard (`cycleIsOpen` is true:
`sweptLamports > 0`, `returnedSats === 0`). ✓

**A double count in the ledger?** The recovery path adopts an on-chain split via
`closesCycle` with `exclude: claimed`, so one split cannot close two cycles. The
alarm's `split_sig_reused` and `split_by_other_unanchored` catch the rest. ✓

**A cycle read as closed?** `cycleIsOpen` requires `returnedSats > 0` **and**
(`splitSig || splitByOther`). A swap that landed but whose return never ran leaves
`returnedSats` unset → open. ✓ The one way a cycle closes without a return is
`sendRejected` — written only on `refused`, and only when `sweepSig`/`sweptLamports`
are **not** written (the selftest's L3 arm pins that `sendRejected` with a
`sweepSig` is `rejected_row_has_sweep` CRITICAL, and that `refusedSig` is used
instead). ✓

**Does every path leave the ledger open until a return is proven?** Yes:
`cycle.returnedSats` is written only after `delta >= guaranteed` is asserted
against the operator's *on-chain* cbBTC balance delta. ✓

### (i) What an adversary can extract within the tolerance

Honest bound, derived:

- Pre-sweep oracle `E₁`; post-sweep oracle `E₂`; the cycle proceeds iff
  `E₂ ≥ E₁ × 0.98`.
- On-chain floor `F = floor(E₂ × 0.985)`.
- Worst accepted output: `F`, i.e. `≥ E₁ × 0.98 × 0.985 = E₁ × 0.96553`.
- **So the worst case is 344.7 bps below the oracle price at the moment the sweep
  decision was made.** That is the number SPEC does not state; it states 150 bps
  against "the oracle", which is true of `E₂` only.
- Against the *pool's* price, the 100 bps deviation gate applies at read time
  only and is explicitly non-binding at execution (SPEC now says so).

Per cycle at the ruled 10 SOL cap: at ~$120/SOL, 10 SOL ≈ $1,200; 344.7 bps ≈
**$41.4 maximum extractable per cycle** by a perfectly-timed sandwich plus
adverse drift. Per month at one sweep per 6 h = 120 cycles → **~$4,970/month
theoretical maximum**, against royalty throughput of up to 40 SOL/day ≈
$144,000/month. So the worst case is ~3.4% of throughput, and the realistic case
(the fork measured 13.5–29.8 bps) is ~0.2–0.3%.

**Meteora is ~10× thinner (~$0.9 M).** A 10 SOL swap there is ~0.13% of pool
depth, so impact is small; but an attacker *can* push Meteora to the edge of the
100 bps gate cheaply and then sandwich within the 150 bps floor. Meteora is used
only when Orca's program **refuses**, which the fork shows is rare. **Material?
No, at the ruled cap. It would become material if the cap were raised.**

### M6 (MEDIUM, CONFIRMED) — the revenue cycle's effective slippage bound is ~345 bps, not 150, and nothing states or asserts it

**Construct.** `revenue.mjs`:

```js
const minOut = BigInt(q.outAmount) * BigInt(10_000 - MAX_REQUOTE_DRIFT_BPS) / 10_000n
if (m2.f.expectedSats < minOut) throw ...
const guaranteed = m2.f.minSats
```

The two tolerances compose multiplicatively and `MAX_REQUOTE_DRIFT_BPS = 200` is
a local constant with no selftest arm and no mention in SPEC's "the bound, as a
number" paragraph, which says only "the oracle-derived expected output less
150 bps".

**Impact.** A reader of SPEC (and of the holder guide, which says "up to 1.5%
below Pyth's price") under-states the worst case by a factor of 2.3. At the ruled
cap that is ~$24/cycle of undisclosed worst-case slippage. Not a theft path; a
**disclosure and documentation** defect on a buyer-facing number, which this
project treats as a real class (the brief explicitly asks where
HOLDER-GUIDE.md promises something the code does not do).

**Evidence if I am right.** `MAX_REQUOTE_DRIFT_BPS` appears once in
`revenue.mjs`, zero times in `bank/selftest.mjs`, zero times in SPEC.md, zero
times in HOLDER-GUIDE.md. Compute `grep -rn MAX_REQUOTE_DRIFT_BPS` across the
tree.

**Fix.** Either (a) tighten: compute `guaranteed = max(m2.f.minSats, minOut)` so
the enforced floor is never below the pre-sweep decision's 200 bps band, making
the composed bound **200 bps** and the stated 150 bps a *subset*; or (b) disclose:
state "up to 3.45% below the price at which the sweep was decided" in SPEC
accepted limit 10 and "up to 3.5%" in the holder guide, and add a selftest
assertion pinning the composition. **(a) is strictly better and is three
characters of arithmetic.**

### L9 (LOW, CONFIRMED) — `revenue.mjs` sends the return transfer with no `classifySendFailure`, so an unconfirmed return that landed leaves the cycle open and the next run wedged at the guard

```js
cycle.returnSig = await sendAndConfirmTransaction(conn, ..., [operator], ...).catch(e => {
  rememberAttempt(cycle, 'Return', e, led)
  throw e
})
```

Unlike the sweep and the swap, the return does **not** consult the chain. An
`unknown` return that actually landed leaves `returnedSats` unwritten → cycle
open → next run throws at the guard. That is the documented hand-recovery path,
and `pendingReturnSig` is preserved as evidence. **Correct but asymmetric**: the
sweep and swap recover automatically from `landed`; the return does not. Same for
the split (which has the `isProvablyEmpty`/`closesCycle` recovery instead, so it
is covered by a different mechanism).

**Fix.** Apply `classifySendFailure` to the return too: on `landed`, set
`returnSig` and continue (the subsequent `requireTokenAmount` delta read already
re-verifies from chain). Low risk, removes one hand-recovery trigger.

### L10 (LOW) — `--probe` and `--audit` run without the lock in one respect

`withLock(LOCK, async () => { ... await main() ... })` wraps everything, and
`main()` branches to `audit()`/probe inside. So they *are* locked. ✓ But
`NOTIFY_LIVE = LIVE && !probe && !audit` means a `--live --audit` run takes the
lock and cannot notify. Harmless. **No finding.**

### Operator-key worst case, re-bounded

What the operator key trusts now: the two pool programs, Pyth's two programs, the
single RPC, and the integrity of `swap.mjs`/`revenue.mjs`. What it can take: the
per-sweep cap (10 SOL) every cooldown (6 h) until the guardian stops it, bounded
by the revenue PDA's balance above the 0.05 SOL reserve. **Unchanged from SPEC's
statement.** ✓ The removal of the HTTP dependency is a genuine reduction.

---

## R6. THE GATES

### M7 (MEDIUM, CONFIRMED) — the round-27 selftest arm that proves the transaction reader refuses incomplete coverage does **not** prove the consumers survive the refusal, so H1 is a gate gap in both directions

**Construct.** `bank/selftest.mjs`, the V1 block:

```js
for (const [name, mutate] of mutations) {
  const bad = structuredClone(fixture); mutate(bad)
  let refused = false
  try { validateParsedTransaction(bad, signature) } catch (e) { refused = e.message.startsWith('unreadable parsed transaction:') }
  t(`R27 V1: ${name} refuses before scan progress`, refused, true)
}
```

and the ten-consumer block:

```js
if (version===1) {
  delete tx.meta.logMessages; ctx.cursors[...]='old'; pc.st.cursor='old'; saved=false; pages=0;
  const refused=[];for(const run of [()=>alarmRun(ctx),()=>splitRun(conn,ata,1),()=>postRun(pc)]){
    try{await run();refused.push(false)}catch(e){refused.push(/unreadable parsed transaction: logs/.test(e.message))}}
  t('... missing coverage holds alarm/poster cursors, saves nothing and supplies no split evidence',
    [refused,ctx.cursors[...],pc.st.cursor,saved], [[true,true,true],'old','old',false]);
}
```

**This arm asserts that the alarm's extracted walk THROWS.** It asserts the
cursor is held — which it is, *because the throw escapes*. It does **not** assert
that the pass completes with a `tx_unreadable` finding, nor that findings
collected before the loop survive. So the gate codifies the defect as the expected
behaviour.

That is the precise shape the brief asks about: "find assertions that cannot
fail, floors that can be satisfied by deleting work, and checks that pass
vacuously." This one is worse — it passes *because of* the defect, and a correct
fix would turn it red.

**Fix.** Change the arm's expectation to: the extracted walk returns
`{findings: [...tx_unreadable...], cursors: {unchanged}}`, and add a second arm
that a finding pushed *before* the loop (e.g. a planted config drift) is still in
the returned `findings`.

### L11 (LOW, CONFIRMED) — `floor()` requires equality, which is right, but the swap-fork gate is skippable and the ship-gate guard only covers two of the three network gates

`run-tests.sh` has:

```sh
[ "${CBOB_SHIP_GATE:-0}" = "1" ] && die "CBOB_SHIP_GATE=1: the mainnet probe may not be skipped"
...
[ "${CBOB_SHIP_GATE:-0}" = "1" ] && die "CBOB_SHIP_GATE=1: the swap fork may not be skipped"
```

Both present. ✓ But note: `[ cond ] && die` under `set -e` — if the condition is
**false**, the compound returns non-zero, and `set -e` would normally exit. It
does not, because `cmd1 && cmd2` as the last command of an `if`/`else` branch…
actually here it is a bare statement inside an `else` block. **`set -e` does not
exit on a failing command that is part of an `&&` list except for the last one** —
and here the `&&` list *is* the whole statement, so a false `[ ]` makes the list
return 1 and `set -e` **should** exit.

Hmm. Let me be careful, because this would be a real defect: it would mean every
run **without** `CBOB_SHIP_GATE=1` that reaches the skip branch exits non-zero.

POSIX: `set -e` shall exit when a command fails, *except* when the command is part
of an `AND-OR` list and is not the last command. `[ "$X" = "1" ]` is not the last
command of the list (`die` is), so its failure is exempt. The *list* then has exit
status 1 (the status of the last executed command — `[` — since `die` never ran).
A failing `AND-OR` list **as a whole** does trigger `set -e`… unless it is itself
in an exempt position.

This is genuinely ambiguous across shells, and the script runs under `bash`.
In bash, `set -e`: "The shell does not exit if the command that fails is part of
the command list immediately following a `while`/`until`, part of a test in an
`if`, part of a `&&` or `||` list **except the command following the final `&&` or
`||`**…". The failing command here is `[`, which is *not* the command following
the final `&&`. **So bash does not exit.** ✓

**Confirmed safe**, and I note it only because this is exactly the construct that
has bitten this project before (`OUT=$(cmd)` under `set -e` swallowing output,
fixed in round 14). A `if [ ... ]; then die ...; fi` would be unambiguous.

**The actual LOW:** the skip branches print "the mainnet facts are NOT asserted by
this run" / "the swap is NOT proven by this run", which is honest. But the DNS
probe is `dns.promises.lookup(hostname)` on the Helius host. A box with DNS but
without *reachability* to Helius passes the DNS check and then the probe fails
hard (`die`). That is the loud direction. ✓ A box whose DNS resolves a **stale
NXDOMAIN-cached** answer skips silently. Bounded by the ship-gate guard. **LOW,
accepted-shaped.**

### L12 (LOW, CONFIRMED) — `build-mainnet.sh` compares the sweep helper to `target/deploy`, which `run-tests.sh` overwrote with the **localnet** build, so "the shipped bytes ARE the tested bytes" is true only if the two builds are identical — which is asserted, but the chain of custody is circular in one link

```sh
cmp -s "$OUT/cbob_vault_sweep.so" "$LN_DIR/cbob_vault_sweep.so" || die ...
cmp -s "$OUT/cbob_vault_sweep.so" "$ROOT/target/deploy/cbob_vault_sweep.so" || die ...
```

`$LN_DIR` is this script's own fresh localnet build. `target/deploy/` is whatever
`run-tests.sh` last copied there (also a localnet build, from
`target/sbpfv3-solana-solana/release/`). Both comparisons are against localnet
builds of the same source, and the helper has no `localnet` feature (commit
`2b67fb1` removed it), so mainnet == localnet by construction. **The assertion is
real and the conclusion holds.** ✓

The circularity: if someone ran `run-tests.sh` at commit A and `build-mainnet.sh`
at commit B, `target/deploy` would hold A's bytes and the second `cmp` would fail
→ `die`. **Good, that is the intended detection.** ✓ **No finding; recorded as
verified.**

For the four keyed programs, `build-mainnet.sh` proves mainnet rejects / localnet
accepts the test key, for all four, plus the source grep for Gary's key, plus the
commit record and dirty-tree refusal. **That is as strong as it can be without
Gary's private key, and the script says exactly that in its closing banner.** ✓

### L13 (LOW, CONFIRMED) — `cron-install.sh` arms nothing it should not, and the rehearsal guard is correctly placed; one residual

The rehearsal refusal is the **fourth** line after `set -euo pipefail`, before any
`crontab -l`:

```sh
[ ! -e "$R/REHEARSAL-RECORD.txt" ] || { echo "rehearsal tree: cron installation is disabled" >&2; exit 1; }
```

✓ And the round-26 selftest runs the actual prelude with stubbed `crontab`/`sudo`
and asserts both branches. ✓

`ours()` is anchored (`grep -E -- "$TAG $1[[:space:]]*\$"`) and filters comments,
so a commented line, a prose note, another project's line, and a `crank-reveal`
line all fail to arm. The round-24 L12 repair is real and both flag orders are
pinned. ✓

The six installed jobs are exactly `crank crank-reveal deadman reconcile revenue
watcher`, asserted by the selftest. ✓ No retired job. ✓ Every money job carries
`$FLOCK` which is `-n`. ✓ `judgeCronTemplate` proves `-n` is required and that
`$FLOCK` is trusted only when the variable carries `-n`. ✓

**Residual:** the deadman line interpolates `$ALARM_STATE` from
`${CBOB_ALARM_STATE:-...}` **at install time**. If the operator later sets
`CBOB_ALARM_STATE` in the alarm's cron environment but not at install time, the
deadman watches the wrong file. The installer's comment names this hazard and
resolves it by reading the same variable — which only works if the variable is set
in the *installing* shell. **LOW; worth a printed line stating which path the
deadman watches** (it currently prints the jobs but not the resolved
`$ALARM_STATE`).

### L14 (LOW, CONFIRMED) — `sim/swap-fork.sh`'s `SWAP_FLOOR=16` equals the count, but the fork's price-staleness arms rewrite the cloned Pyth accounts at offset 93 *in the stub only*, so SW.7a/7b prove `market()`'s logic and not the receiver's acceptance of such a price

```js
const stamped = age => ({ getMultipleAccountsInfo: async (keys, c) => (...).map((a,i) => {
  if (!a || !pythKeys.has(keys[i].toBase58())) return a
  const d = Buffer.from(a.data); d.writeBigInt64LE(chainNow - BigInt(age), 93); return { ...a, data: d } }) })
```

This is a **stub connection**, not a modified on-chain account. So SW.7/7a/7b
prove that `market()` + `readPyth` + `oracleFloor` reject a stale/future
`publish_time` **as read**, against the fork's real Clock. That is exactly the
property under test (the round-25 L2 defect was in *our* comparison, not in
Pyth's posting). ✓ The fork's own note says so. **Correctly scoped; the
round-27 C36 disposition is right.** No finding.

### What the gates get right (verified)

- Every floor uses **equality** (`-eq`), not `-ge`. ✓ The `floor()` function
  requires both and dies on either mismatch. ✓
- `MIN_ASSERTIONS` is hardcoded, `CBOB_TEST_FILE` is refused if set, `CBOB_CACHE`
  must be the default. ✓
- The Core sha256 is **hardcoded**, not environment-overridable. ✓ And the
  on-chain Core is `cmp`'d against the cache after boot. ✓
- The selftest's own `FLOOR` is compared to `run-tests.sh`'s `DET_FLOOR`. ✓
- SPEC's stated counts are checked at **every** occurrence via `matchAll`, with an
  arm proving a stale later occurrence is caught and that zero occurrences fails. ✓
  I spot-checked: `860 detector` appears in SPEC's "Running the tests" block and
  `DET_FLOOR=860` in the runner; `848` appears as `848 assertions, real cloned
  Core` and `MIN_ASSERTIONS=848`. ✓
- The control-table gate parses ON-CHAIN rows against the real error enums and
  AUTOMATIC/PROCEDURE against the real cron lines, with both-direction arms. ✓
- The signer-set gate discovers signers by `fromSecretKey` across `bank/`,
  `scripts/`, `tests/` and pins exactly two, with an impostor arm. ✓ It correctly
  states that `launch/` is not scanned. ✓

### The one gate I cannot find

**There is no arm, anywhere, that the alarm completes a pass when a single
transaction read fails.** That is H1's gate gap and M7 above. It is the only
missing both-ways arm I found in the round-24/25/26/27 blocks.

---

## The four questions about the accepted limits

### 1. Is any limit WORSE than stated?

**Yes, two.**

**Limit 10 (the swap hop).** SPEC's "the bound, as a number" says the floor is
"the oracle-derived expected output less 150 bps". The *effective* bound against
the price at which the sweep was decided is **~345 bps** (150 bps against the
post-sweep oracle, which may itself be 200 bps below the pre-sweep oracle). See
M6. HOLDER-GUIDE's "up to 1.5% below Pyth's price" has the same gap. Fixable by
three characters (`max(minSats, minOut)`), which would make the stated number
true.

**Limit 7 (a wedged holder is a permanent silent skip).** The limit says v6 makes
the stall "survivable rather than silent" and lists `crank_silent`,
`royalties_unswept`, `distribution_overdue`. H1 shows the **alarm itself** can
enter a state where it neither completes a pass nor is diagnosed correctly: one
`run_failed` page (12 h suppressed, one reminder/day) plus a deadman page whose
text says "the watcher is not running, or its baseline has been deleted". Neither
names the actual cause, and the crank's own `crank_silent` cannot fire because the
alarm is the thing that evaluates it. So "survivable rather than silent" is
*mostly* true and has one unlisted hole: **the watcher's own permanent, repeating
failure on a malformed RPC answer**. That belongs in limit 7 (or, better, fixed per
H1).

### 2. Is anything listed as a limit not actually a limit?

**Limit 42** is already weaker than its heading suggests, and the text now says so
honestly ("the old categorical 'only two fit' claim was false"). I verified the
arithmetic: 1,061 + 3×42 = 1,187… the text says 1,219 for three creates, implying
~52.7 bytes per create. An ATA `CreateIdempotent` adds 1 program key (if new) + up
to 3 new account keys (ata, mint; owner and payer already present) = 3×32 = 96,
plus ~4 bytes of instruction framing and 1 data byte, minus shared keys. The
stated 1,061 → 1,135 → 1,177 → 1,219 progression (+74, +42, +42) is consistent
with the first create introducing the ATA program key. **The measurement is
internally coherent; I cannot independently verify it without serialising, and the
text correctly labels it "an offline size measurement, not a landed
transaction".** ✓ No change needed.

**Limit 29 (only cbBTC splits)** — I confirm it is still exactly true:
`split_revenue` requires `mint.key() == cfg.payment_mint`. ✓

**Limit 35 (the 10% turnout rule never binds)** — 21% quorum × 51% threshold =
10.71% > 10%. ✓ Still true.

Nothing in the ACCEPTED list is closed-but-still-listed, as far as I can
establish.

### 3. Is any DISCHARGED item not actually discharged?

**Item 54 (compute at the widest host shapes) — partially.** The text says "A
claim batch costs about 4,000 CU per vault (P.31: 6 vaults, 29,192), so the
crank's 14-vault batches sit near 60,000… (extrapolated from the measured
per-vault cost, not measured at 14)". The extrapolation is labelled. But the
crank's **join batches** use `L.CLAIM_BATCH = 14` pairs too, and a join calls
`join()` which writes the record and emits an event — a different cost profile
from a paying claim. And a claim batch that *expires a boost* calls
`expire_boost` → `reweigh` → more writes. **Neither is measured at batch size
14.** At 14 vaults × (claim + expiry) the extrapolation could be 2× off, i.e.
~120,000 CU — still under the 200,000 default, so the conclusion survives. **The
item is discharged on its conclusion; the measurement gap is real and the text
half-names it.** Worth one sentence: "a 14-vault batch that also expires 14 boosts
is not measured."

**Item 51 (the $CBOB boost) — discharged, with one residue the text names
correctly** (a move in the buyer's favour lands at the new terms). I verified
`boost_vault`'s check: `price <= max_price && extra >= min_weight && epochs >=
min_epochs`. ✓ One-sided as documented.

**Item 12/17 (compute units) — discharged on the padded-mint path, and the text
now correctly scopes it to "legacy" and says "This is not a v1 packet or
resource-budget measurement."** ✓ The round-27 V2 repair is real.

**Item 33 (the 7-day notice branch)** — discharged via the 60 s `initialize`
value exercised in the suite. The arithmetic is `now >= armed_at + notice_secs`,
identical at either value. ✓

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**Item 50 — no, but it is drifting.** The list of client obligations has grown
every round (prior ATAs, no-claim-while-pool-frozen, sweep through the helper,
packet budget, lamports-only destination, stray classic tokens, close emptied
accounts, compute-unit limit, run the coverage judge, deploy+lock the helper).
That is ten contractual requirements on a page that does not exist, each one a
place the page can be wrong, and **none of them has a gate**. The item is still
marked OPEN AND BLOCKING and the holder guide is marked DRAFT with a publication
prohibition. ✓ Not quietly accepted. But I would add to the item: **"every
obligation in this list needs a both-ways assertion against the page once it
exists, in the same tree as the page, and the page's absence means items 9 and 44
have no preventive control."** The second half is already stated; the first is
not.

**Item 38 — being quietly *weakened* by `lock_deadline: null`.** The item lists
`lock_deadline` as derived from the charter date and OPEN. M3 shows that a `null`
`lock_deadline` silently disables `detectMissingComponents` **and**
`lock_deadline_unset` (post-lock). So the one value that is still OPEN is also the
value two detectors key off. Not "quietly accepted", but the coupling is
undocumented and it is the kind of thing that gets discovered after launch.

**Item 22 — no.** Named pass/fail items, each with a signature requirement. ✓
The round-27 validation says the rehearsal worktree was refreshed but
"did not build or send at the throwaway IDs" and that the live ceremony, both-venue
revenue cycle and forced post-sweep recovery "remain open". ✓ Honest.

**Item 53 — no, and the rehearsal value set it names as "not built" is still not
built.** `launch/rehearsal-init.json` is absent from the bundle and
`check-launch-params.mjs` has no rehearsal mode. ✓ Correctly listed as still to
write.

---

## Findings, consolidated

| id | sev | file / function | what it costs | fix size |
|---|---|---|---|---|
| **H1** | **HIGH** | `bank/alarm.mjs` `main()` + `bank/txread.mjs` | one malformed RPC answer halts the *whole* alarm pass, discards every finding already collected, holds the cursor, repeats deterministically, and is diagnosed only by a 12 h-suppressed `run_failed` plus a mis-worded deadman | ~8 lines + 2 selftest arms |
| **M3** | MEDIUM | `detectMissingComponents` / `lockDeadlineOf` | with `lock_deadline: null` (its current state) **and** post-lock immutable authorities, an absent own config or ProgramData is reported by nothing | ~10 lines + 2 arms |
| **M6** | MEDIUM | `bank/revenue.mjs` `MAX_REQUOTE_DRIFT_BPS` | the effective slippage bound is ~345 bps, not the 150 bps SPEC and HOLDER-GUIDE state | 3 chars, or 2 doc edits + 1 arm |
| **M7** | MEDIUM | `bank/selftest.mjs` round-27 V1 block | the gate asserts the H1 defect as correct behaviour, so fixing H1 turns the suite red | rewrite 1 arm, add 1 |
| L1 | LOW | `crank.mjs` benign-distribute path | `postExpires` computed from a stale epoch after a benign refusal; one hour of delay | 3 lines |
| L3 | LOW | `crank.mjs` `splitToPool` | conservative-only estimate; up to one hour of delay | none needed |
| L4 | LOW | `revenueOutflow` | under-read → false `split_claim_unanchored` CRITICAL, un-ackable (post-H1-fix only) | 1 line |
| L5 | LOW | `detectCrankHealth` `covered()` + no Squads-ATA watcher | a pool+Squads double freeze pages `crank_problem` without naming the Squads account | ~6 lines |
| L7 | LOW | `collectionPluginsHash` sentinels | a truncated read → false CRITICAL on the royalty-plugin hash | 1 line + 1 arm |
| L8 | LOW | `crank.mjs` pre-expired owed line | the one money formula with no mirror in `accrual.mjs` | export + 1 arm |
| L9 | LOW | `revenue.mjs` return send | asymmetric: no `classifySendFailure` on the return | ~6 lines |
| L13 | LOW | `cron-install.sh` | the resolved `$ALARM_STATE` the deadman watches is not printed | 1 line |
| — | INFO | `readPyth` | does not assert the account address equals `pythAccount(feedHex)`; harmless today because `market()` pins it | 1 line |
| — | INFO | item 54 | a 14-vault claim batch that also expires 14 boosts is unmeasured; the conclusion survives | 1 sentence |

**Nothing I found is a theft path, an unseal path, or a payout-accounting error.**
The vault mechanics, the pool arithmetic, the layouts, the swap's oracle and judge
and the launch gate all held up under hand re-derivation. H1 is a **detection**
failure in the component whose entire purpose is detection, introduced three
commits before the freeze, and codified as correct by its own gate.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Six things an AI round structurally cannot do, with what to do instead. Each is
concrete and each is cheap relative to what it protects.

**1. Fault-inject the RPC, not just the chain.** Every finding above that matters
(H1, L4, L7, and M3's reachability) is an *RPC answer* defect, not a chain defect.
The suite boots a real validator and clones real Core — excellent — and then talks
to it through a perfectly honest local RPC. **Before the lock, run the full alarm,
crank and revenue cycle behind a proxy that, per request, with a seed printed at
start: nulls `innerInstructions`, nulls `logMessages`, truncates one account's
data by 8 bytes, returns `result: null`, returns a 500, returns a stale slot,
delays 300 s, and returns a Clock 400 s behind.** Record, for each, whether the
pass *completed and reported*. That single harness would have caught H1, L7 and
the round-25 A1 timeout, and it is maybe 150 lines of Node. An AI can design it;
only a run can tell you which detectors go dark.

**2. Run the alarm against a chain where something is actually wrong, for a week.**
Every detector is proven in both directions against synthetic input. Not one has
ever fired against a real mainnet-shaped history with a real anomaly in it. On the
rehearsal deployment: bare-burn a vault, approve a delegate on a vault PDA,
create a non-ATA token account for a vault PDA, freeze a token account (you can
on a test mint you control), plant an off-curve owner, sweep without writing a
ledger row, and write a ledger row with no sweep. Then leave it running 7 days
and read every email. The thing you are testing is not the predicate — it is
**whether the operator can tell what happened from the page they get**, which is
the property H1 fails and which no assertion can express.

**3. Pay someone to attack the swap on the fork, with the operator key, for money.**
The fork proves both venues accept our hand-built instructions and enforce the
floor. It does not prove the 345 bps composed band is unexploitable, because
nobody has tried. Put 10 SOL on a forked mainnet, hand a bounty hunter the
operator key and `bank/swap.mjs`, and pay them whatever they extract. If they get
more than ~$42 per cycle, M6's arithmetic is wrong and you need to know before the
lock. This is the one place where adversarial economic incentive finds what
reasoning does not.

**4. Build the redeem page, then have a different agent write the ten both-ways
assertions for item 50's obligations before reading the page's code.** The page is
the last pre-signature control for items 9 and 44, it has ten contractual
obligations, and it will be written against a spec the implementer also wrote. The
ordering matters: assertions first, from SPEC's bullet list alone, then the page,
then reconcile. Otherwise you get the shape this project keeps producing — a gate
that encodes what the code does rather than what the contract requires, which is
exactly M7.

**5. Replay the whole crank at 2,100 vaults with a recorded RPC trace, and count
the money.** Item 22 is correctly OPEN. The specific thing to measure that nobody
has: generate 2,100 vault records with a realistic level distribution and boost
mix, run `planCrank` against them, send every planned instruction to a local
validator, and then **independently recompute, in a second implementation written
from MINT's Rust by an agent that has not seen `accrual.mjs`, what every vault
should have received.** Diff. The accumulator is correct by my hand-check and by
`accrual.mjs`'s selftest, but both of those read the same formula; a second
independent derivation is the only thing that catches a shared misreading.

**6. Decide the two OPEN launch values, and write down what else they gate.**
`charter_opens_at` and `lock_deadline` are listed as "needs Gary". M3 shows that
`lock_deadline: null` silently disables two detectors. Before the lock, grep for
every consumer of `lock_deadline` and `charter_opens_at` and write the list into
item 38, so the person filling them in knows they are arming monitoring and not
just recording a date. Then re-run the rehearsal with both set and confirm
`component_missing` and `lock_deadline_unset` both fire and both clear.

**And one thing to stop doing.** Round 27 added `bank/txread.mjs` and its gate in
the same commit, and the gate encoded the defect. Rounds 12, 14, 15 and 16 each
introduced a defect into `bank/lock.mjs` while fixing one. The pattern is: *the
agent that writes the repair writes its gate.* Break that. The repair and its
both-ways assertion should come from two agents, the second working only from the
finding text and the surrounding contract, never from the diff. It costs one extra
round-trip per finding and it is the single highest-leverage process change
available to you.