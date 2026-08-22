I audited the round-11 repairs as new code. Three findings, then what I tried and could not break.

---

## FINDINGS

### HIGH-1 — `bank/lock.mjs` `acquireLock`: the stale-lock break is still not exclusive; two breakers of one stale lock both run (double-payment)

The round-11 rewrite claims "unlink, then re-create with `wx`, so of two runners racing the same dead lock exactly one can win." The `wx` create makes one **create** win; it does nothing about the **unlink** that precedes it. There is no check that the file being unlinked is still the stale entry that was read.

Race (both A and B see the same stale, dead lock):
1. A reads `{pid: dead, token: T0}`, stale + gone → proceeds.
2. B reads the same → proceeds.
3. A: `unlinkSync`, then `writeFileSync(…, wx)` → A holds, starts `main()`.
4. B: `unlinkSync` → **deletes A's fresh lock**, then `writeFileSync(…, wx)` → B holds, starts `main()`.
5. A and B both run. On `distribute.mjs` both load the ledger, both iterate `plan.activated`, both send — every activated vault is paid twice. The lock is the *only* thing preventing this (the file header says so).
6. A's `finally` → `releaseLock(file, tokenA)` reads B's token, returns false, logs a warning — after the double-pay already happened.

The `_afterUnlink` seam tests the *other* interleaving (someone creates during **my** gap → I lose the create → `lostRace`). It never exercises "my unlink destroys the winner's lock," so the broken branch is the untested one. Trigger is a stale lock (any crashed run older than `staleMs`) plus two near-simultaneous restarts — precisely the cron-fires-while-an-operator-recovers moment.

**Fix:** immediately before the break's `unlinkSync`, re-read the lock and require `held.token` to still equal the stale token you decided to break; otherwise return `{ok:false, lostRace:true}`. This closes the large (descheduling-sized) window. A residual microsecond TOCTOU remains; for a money lock the durable fix is an atomic primitive (unique-temp + `link()`, checking `nlink`), not unlink+create.

### HIGH-2 — `bank/detectors.mjs` `detectSplitClaims` / `detectUnreconciledRevenue`: split verification is keyed on the operator-written `startedAt`; backdating past the 30-day horizon closes a cycle on the ledger's own word

The return leg of the trusted hop (cbBTC → revenue ATA) is a plain SPL transfer, not a MINT-program call, so the alarm never sees it on chain; it is attested only by `returnedSats`. The only controls that a cycle was actually **split** are (a) `splitSig ∈ seenSplits` and (b) the round-11 `splitByOther` anchoring. Both are gated by a window computed from `c.startedAt`:

```js
const age = nowMs - Date.parse(c.startedAt)
if (age < graceMs || age > horizonMs) continue        // splitSig path
…
const inWindow = byOther.filter(c => age >= graceMs && age <= horizonMs)  // splitByOther path
```

`startedAt` is written by the same process that holds the operator key. A compromised operator who swept 50 SOL and **kept it** writes:
`{startedAt: now−31d, sweptLamports: "50000000000", sweepSig: <real sweep sig>, quotedSats: X, returnedSats: X, splitByOther: true}`.

Every detector passes: `detectUnledgeredSweeps` matches the real on-chain sweep by `sweepSig`/amount; `detectUnreconciledRevenue` sees `returned≈quoted` and skips `cycle_unsplit` (`splitByOther` set); `detectSplitClaims` computes `age > horizonMs` and **never asks whether a split exists**. No split ever landed; the revenue ATA never received cbBTC. 50 SOL gone, alarm silent. The same backdate defeats the `splitSig` path with a fabricated signature.

The horizon rationale ("the scan has moved past it") does not apply: `seenSplits` is deliberately **never sliced**, and `claimed` is built over the whole ledger, so old cycles can still be anchored. The upper bound exists only to stop nagging and is the bypass.

**Fix:** for split verification, drop the `age <= horizonMs` upper bound (keep the grace lower bound), or key the window to the sweep's on-chain block time rather than `startedAt`. Deeper: verify the return leg on chain by walking the revenue ATA's inbound transfers instead of trusting `returnedSats`.

### MEDIUM-3 — Round-11's owner/discriminator/version pinning reached one of three raw-offset readers of the upgradeable MINT config

The changelog item "`readConfigs` verified neither owner nor discriminator before taking raw offsets" was applied to `alarm.mjs` `readConfigs` only. The same shape exists in:
- `bank/revenue.mjs` `main()`: `cfg.data.subarray(137,169)`, `(221,253)`, `(256,288)`, `readBigUInt64LE(288)`, `readUInt16LE(253)`, `readBigUInt64LE(297/…)` — no owner, discriminator, or version check.
- `bank/distribute.mjs` `main()`: `subarray(41,73)`, `readBigUInt64LE(205)`, `subarray(137,169)` — none.

Not currently a theft: `split_revenue` re-derives both destination ATAs from its own config read, and both scripts equality-check the operator/distributor key, so a misread fails as a rejection. But a future MINT upgrade reordering `MintConfig` misreads these two money jobs silently (wedge / wrong completeness divisor) instead of failing loudly — the exact class the round-11 pinning was written to close. Apply the same owner + `account:MintConfig` discriminator + `version==1` precondition in both.

---

## TRIED AND COULD NOT BREAK

- **`splitByOther` emptiness proof (`spl.mjs isProvablyEmpty`).** Only `split_revenue` can move tokens out of the revenue ATA (revenue PDA is signed only by MINT via `REVENUE_SEED`), and it always drains the full balance to config-pinned ATAs. Absent and poisoned accounts do not count as empty. I could not manufacture a false emptiness or redirect a front-run split.
- **`CONFIG_PADDING` and every space calc.** Recomputed all four `Initialize` space expressions against the structs: SEAL 702, MINT 745, BURN 442, GOV 398 — all exact. Padding is trailing, so no reader's offset moves; all raw-offset reads land before it.
- **SEAL reserve-Vec variable offset.** `readConfigs` computes `after = 109 + n*32` correctly; MINT/BURN read only fixed offsets that sit before the Vec.
- **`WATCHED_KEYS`/`COLLECTION_KEYS`.** All four `*.collection` keys are produced by `readConfigs`, are in `WATCHED_KEYS`, and `detectStandingRisks` reads nothing outside the list; `missingWatchedKeys` throws on a gap.
- **Governance.** Vote bound to asset PDA (transfer-then-revote hits an existing account); burned vaults fail `read_core_asset`; quorum divisor `max(snapshot, live)` with ceiling division and `MIN_QUORUM_BPS`; execution monotonic via `last_executed_id`.
- **`split_revenue` rounding** floors the Bank and sums exactly; destinations pinned; any-token is by design and harmless (griefer only moves their own worthless tokens between project addresses).
- **`releaseLock` by token** correctly prevents a broken runner deleting its replacement's lock; `_afterUnlink` is unreachable in production (never passed by any caller).
- **`writeLedger` marker ordering** (marker before rename) fails safe on crash/permissions fault.

---

## THE SINGLE THING TO FIX FIRST

**HIGH-1 — the `acquireLock` stale-break race.** It is the mutual exclusion under every money job, the file was rewritten specifically to make the break exclusive, and it still permits two concurrent runners — the irrecoverable double-payment of every activated vault. Re-read-and-compare the token immediately before the unlink (and plan an atomic link-based lock), then fix HIGH-2's horizon bypass before the operator hop holds real SOL.