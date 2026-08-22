# ROUND 12 — FINDINGS

## F1. CRITICAL — The split verification is defeated by junk-token splits; the return side of the trusted hop has no surviving chain anchor

**Where:** `bank/alarm.mjs` (seenSplits construction), `bank/detectors.mjs` (`detectSplitClaims`).

`seenSplits` is built from any MINT-program transaction containing the `split_revenue` discriminator — with no check of *which mint* was split:

```js
if (ixs.some(ix => ix.program === MINT.toBase58() && ix.dataBytes
    && IX_SPLIT.every((b, i) => ix.dataBytes[i] === b))) seenSplits.push(s.signature)
```

`split_revenue` deliberately works for **any** token (round-8 design decision). So any stranger can manufacture one on-chain "split" for ~0.02 SOL: create the revenue PDA's ATA for a junk mint (permissionless, payer = stranger), create the treasury and bank-treasury ATAs for it, send it dust, call `split_revenue(junkMint)`. That transaction is a real MINT tx with the split discriminator; it lands in `seenSplits`, claimed by no cycle.

Both closure paths then fall:

- **`splitSig` path:** a lying ledger pastes the junk split's signature as `splitSig`. `detectSplitClaims` checks only `seen.has(c.splitSig)` — it has. Verified.
- **`splitByOther` path:** round 11's anchor requires `unclaimed >= inWindow.length`; junk splits are unclaimed and count. The guarantee "N cycles require N splits on chain that no cycle claims" is true and **vacuous** — the adversary manufactures the N splits itself.

**Concrete exploit (the adversary the alarm names — a compromised operator box, the exact threat `detectUnledgeredSweeps` was built for):** sweep 50 SOL (ledger it truthfully — the sweep side is solid), never swap, write `returnedSats = quotedSats` and `splitSig = <junk split sig>`. Every detector passes: `unledgered_sweep` matches amount and signature; `cycleIsOpen` is false; `short_swap_return` compares two ledger-written numbers; `split_not_on_chain` finds the sig. Repeat every cooldown. **Zero findings while the treasury drains at 50 SOL per window.** The distribution's only symptom is "no cbBTC to distribute," which is a legitimate quiet day. Round 8's own comment admits the return side rests on `returnedSats` "written by the process that holds the operator key" and offers the split anchor as the answer — the anchor is purchasable for pocket change, including by the box itself.

**Fix (one line):** when pushing to `seenSplits`, require the split instruction's mint account (`ix.accounts[2]`, per `SplitRevenue`'s account order: config, revenue, **mint**, …) to equal cbBTC; apply the same filter to the `unclaimed` count. The alarm already holds the parsed transaction.

## F2. HIGH — The first revenue cycle wedges after the sweep: an absent operator cbBTC ATA throws with the SOL already on the operator key

**Where:** `bank/revenue.mjs`, the `opBefore` read between step 1 and step 2.

```js
const opBefore = requireTokenAmount(await conn.getAccountInfo(opAtaAddr, 'confirmed'), ...)
```

The comment above it claims "It is checked here, before anything moves." **False:** the sweep (step 1) has already moved up to 50 SOL. On a fresh operator key — the first live revenue cycle, a *when* and not an *if* — the operator's cbBTC ATA does not exist (nothing in the repo creates it; step 3 creates the *revenue's* ATA, step 4 the holders' and bank's, never the operator's own). `requireTokenAmount` throws "does not exist," the SOL sits on the operator key, the cycle is open, and every future run is blocked at the open-cycle guard until a human completes the swap by hand. The round-11 repair moved this read from after the swap to before it — protecting the swap while stranding the sweep. It also converted a normal first-run condition into a fault, the exact class the round was told to prove absent. (An attacker holding the operator key can also close the ATA to re-arm the wedge.)

**Fix:** absent is provably zero for a *delta baseline* — the file's own absent≠empty rule governs proofs, not balance reads. `opBefore = readTokenAccount(info).state === 'absent' ? 0n : requireTokenAmount(...)`, or create the operator ATA idempotently before the sweep.

## F3. MEDIUM — `lock.mjs`: the break is not atomic in two interleavings, and an unreadable lock is broken regardless of age

**Where:** `bank/lock.mjs`, `acquireLock`.

1. **Unreadable ⇒ broken.** `held = null` on a parse failure ⇒ `age = now - Date.parse(0) = NaN` ⇒ the freshness refusal (`Number.isFinite(age) && age < staleMs`) is skipped ⇒ the alive check (`held?.pid`) is skipped ⇒ unlink and take. The comment says "unreadable lock: treat by age" — there is no age to treat by; the fall-through breaks it. The reachable live-holder case is the µs window between `open(O_EXCL)` and `write` in `writeFileSync(..., {flag:'wx'})`, where the file exists with 0 bytes; a second runner starting in that instant steals a live holder's lock. Narrow, but the consequence is the double payment the file exists to prevent.
2. **The racer's unlink can delete the winner's fresh lock.** A: reads stale lock. B: reads stale lock. A: unlink, `wx` create — A holds. B: unlink — **removes A's new lock** — B: `wx` create — B holds. Two runners. The `_afterUnlink` seam tests only the loser-creates-first order; the winner-creates-then-loser-unlinks order is the untested branch, and the header's claim "exactly one racer wins" is false for it. (A's `releaseLock` at least warns at exit — after the damage.)
3. **Pid recycling.** A crashed run's lock holds a bare pid. On a box with `pid_max` 32768 (common in containers), the pid is reused within the 20-hour window; `pidAlive` returns true and the lock is **never** breakable — the daily distribution refuses until a human kills an unrelated process. Loud (ELOCKED notifies), but it is a standing availability fault on the payout. Fix: store `/proc/<pid>/stat` field 22 (starttime) and compare.

**Fix for 1–2:** write the lock via temp file + `rename` (the file then never exists in a 0-byte state; a crash leaves no lock at all, which is correctly takeable), and treat an unreadable lock as a *refusal*, not a break.

## F4. MEDIUM — The wedge bounds bind only on `update_wiring`, not on `initialize`

**Where:** `programs/cbob-vault-mint/src/lib.rs`, `initialize`.

Round 11 added `MIN_ADMIN_SWEEP_LAMPORTS` (1 SOL) and `MAX_ADMIN_SWEEP_COOLDOWN_SECS` (24h) to `update_wiring`'s governance gate, and bound the *ceiling* at init ("Bounding only the update path leaves the one value that is never updated — the launch value — unbounded"). The floor and the cooldown ceiling were **not** applied at init: `initialize` accepts `max_sweep_lamports = 1` and `sweep_cooldown_secs = 7 days`. A launch typo wedges the pipeline exactly as round 11 described, and recovery requires arming a governance rotation to a signable key (the GOV PDA cannot sign `update_wiring`), waiting the timelock, fixing, rotating back. `sweep_cap_wedged`/`sweep_cooldown_wedged` fire HIGH every pass — loud, but the fix's own rationale applied to its sibling path. Apply the same bounds in `initialize`.

## F5. LOW — The suite: three negatives still pass on any rejection; the floor is 26% below reality

`because()` now covers the load-bearing negatives, but **1.1** (non-governor sets round), **2.5** (rogue direct mint), and **5.2** (mint to a PDA owner) have no reason check — each "passes" on a miswired account list exactly as 6.8/6.9/6.10 once did. Separately, `MIN_ASSERTIONS=160` against ~217 actual: a suite that silently stops after section 7 is green. Raise the floor to the current count and add the three `because()` calls.

## F6. LOW — `sigwalk` first-pass gap never converges above 20k signatures

If a program's *first* walk exceeds 20 pages, the cursor is never set and every pass re-walks the newest 20k forever, re-raising the same findings every 30 minutes. Measured against charter scale: max realistic burst is ~2,100 transactions per pass (one per vault), so this is unreachable at stated supply — filed for the record, not as a live risk.

---

# WHAT I TRIED AND COULD NOT BREAK

- **The `splitByOther` emptiness proof.** Attacked as instructed: the revenue ATA address is an ATA-program PDA (no keypair can pre-create or replace it); only `split_revenue` can sign it out; partial splits revert atomically; absent and malformed both fail `isProvablyEmpty` and rethrow. Held.
- **Every config offset, byte by byte.** Recomputed all four layouts against the structs and the space expressions (SEAL 702, MINT 745, BURN 442, GOV 398 — all include the 256-byte padding correctly); verified every alarm read offset including SEAL's variable-length pending fields and GOV's `last_executed_id` at 94. All agree.
- **`WATCHED_KEYS` completeness.** Enumerated every key `detectStandingRisks` and `detectConfigDrift` read; all are produced by `readConfigs` (the pending-rotation keys are covered by the standing every-pass check even where not in the drift list). The mechanical check holds.
- **The round-11 repairs that held:** `resolvedBy` ordering in `paymentState` (resolved-above-rejected is correct; the loop and all three detector branches agree); the fee-floor predicate now matches the send set exactly; the deferred-sweep carry on delivery failure restores reported-and-dropped entries; the idle branch reports before writing and honours `--dry-run`; the 20-hour lock plus the alive-check means a slow run is never stolen from; `detectDistribution`'s refused/unresolved/resolved tri-state is exhaustive at every caller.
- **The vault mechanics, again.** The 2-of-2, the introspection pairing (open binds asset+owner; close's lookback binds asset only, but both halves require the Bank and the current owner's signature, so no exploit), the burn emptiness proof, the split arithmetic (floor to Bank, sum exact, u64::MAX safe), the royalty CPI encoding (both opcodes, decoded back by real Core in 6.26–6.30).

---

# THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Bind the split verification to cbBTC.** One line in `alarm.mjs` — when building `seenSplits`, require the split instruction's mint account to be cbBTC — closes the only hole through which the one trusted hop's reconciliation, the alarm's entire reason for existing, is currently purchasable by anyone for four transactions. Fix F2's one-liner in the same commit; the first live cycle depends on it.