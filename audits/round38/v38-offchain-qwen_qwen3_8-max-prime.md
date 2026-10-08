# Round 38 Independent Audit — Off-Chain Pipeline + MINT + Sweep Helper

I verified the round 37 repairs against the current tree and re-derived the load-bearing mechanics from source. Below are my findings, then the accepted-limit review.

---

## R0. Verification of Round 37's verdict and repairs

I independently re-checked each confirmed round-37 finding against the code as it stands.

**C01 (ack arms) — repaired correctly.** The three arms at `bank/selftest.mjs` now drive `unredeemable_owner` (the one ackable kind), plus a control arm `R37 C01` that acks with a real reason and expects `INFO`. I traced the three mutations round 37 named:
- removing the empty-`why` guard in `judgeAck` → the "empty reason is not an ack" arm goes red (returns INFO, wants CRITICAL);
- making `judgeAck` accept `true` → the "`true` is not an ack" arm goes red;
- making `applyAcks` key by asset alone → the control arm goes red (lookup `acks[A2]` misses `unredeemable_owner:A2`, returns CRITICAL, wants INFO).
All three mutations are caught. Repair holds.

**C03 (`judgeCronTemplate` commented `-n`) — repaired correctly.** `bank/detectors.mjs` now computes `varHasN` from `live` (comment lines stripped) while the crontab-line loop still skips `#`-prefixed lines via the `^[0-9*]` test. A commented-out `FLOCK="$FLOCK -n"` no longer satisfies the indirect check.

**C04 (`--audit` counts refused sweep) — repaired correctly.** `bank/revenue.mjs` `audit()` uses `c.sweptLamports || (c.sendRejected ? 0 : c.intendedLamports) || 0`, and the refused path throws before `sweptLamports` is set, so a refused row contributes 0.

**C05 (SPEC throughput figure) — repaired as text.** SPEC limit 10 now reads "about 34 SOL a day" with the 7-hour-cadence explanation. Documentation-only; consistent with the hourly cron + on-chain cooldown mechanism.

**C02 (frozen-pool tick) — repaired, but incompletely. See finding F1 below.**

---

## Findings

### F1 — LOW — Frozen-pool tick is planned, but the joins it unlocks are deferred a full pass

**Construct:** `bank/crank.mjs`, `planCrank()` — the tick branch (the C02 repair) and the claims section.

The C02 repair added a tick branch that correctly does **not** require `!pool.frozen`:

```js
} else if (joinable && poolOk && due && w === 0n && waitingThisEpoch) {
    // ROUND 37 (off-chain C02): EVEN FROM A FROZEN POOL ...
    plan.distribute = true; plan.distributeKind = 'tick'
}
```

I confirmed against `programs/cbob-vault-mint/src/lib.rs` that MINT accepts this: with `total_active_weight == 0`, `distribute` reads the pool via `read_token` (which does not inspect the freeze byte), never checks the freeze on the `w == 0` path, and `tick()` runs. A waiting vault's `claim` joins through the `r.pending` branch with no pool transfer. So the tick and the subsequent joins are both legal against a frozen pool. The repair's premise is accurate.

However, the joins it unlocks are **not sent in the same pass**. `plan.joins` is populated whenever `plan.distribute` is true, but it is only folded into sendable batches inside the claims block, which is guarded:

```js
if (poolOk && !pool.frozen) {
    ...
    ready.push(...plan.joins)
    for (...) plan.claims.push(...)
}
```

During a frozen pool that whole block is skipped, so `plan.joins` is computed and then discarded. The vaults only join on the **next** pass, via `preJoins` (which is sent unguarded and does not touch the pool). Net effect: with a frozen pool, a vault that requests activation waits one extra full crank cycle (up to ~1 hour on the hourly full pass) to join, even though a join-only `claim` would succeed immediately.

Round 37's VALIDATION states the crank "plans the tick **(and the joins after it)** from a frozen pool." The joins are *planned* but not *sent* in that pass, so the repair delivers the tick but not the same-pass joins the finding was really about (letting waiting vaults in while the pool is frozen).

**What an attacker or an accident gains:** nothing directly — no funds move incorrectly and no payout is miscalculated. This is a liveness delay. It matters because the whole point of C02 was that a frozen pool should not stall the launch/first-join path; the stall is reduced from "indefinite" to "one extra pass," not to zero. Because `JoinWaitingFirst` blocks any crediting distribution while a vault waits, the delay also cannot cause a vault to miss a distribution (the distribution simply waits), so there is no secondary payout skew.

**Evidence if I am right:** run `planCrank` with `pool.frozen = true`, `total_active_weight = 0`, one pending vault with `request_epoch == dist_epoch`, and the month due. The returned plan has `distribute: true, distributeKind: 'tick'`, a non-empty `joins` array, but an **empty** `claims` array. On the next pass (with `dist_epoch` advanced) the same vault appears in `preJoins`, not `joins`. A frozen-pool integration run would show the vault joining one crank cycle later than it does with an unfrozen pool.

**Fix:** send join-only claims during a frozen pool. Join-only `claim` batches (all pairs in `r.pending` state) perform no pool transfer, so they succeed against a frozen pool. Either lift `ready.push(...plan.joins)` out of the `!pool.frozen` guard and send those batches unconditionally (they contain only pending vaults, which `claim` joins and `continue`s), or add a dedicated "join after tick" send step mirroring `preJoins`. Keep paying claims inside the `!pool.frozen` guard.

---

## Accepted-limit review (the four required questions)

**1. Is any limit worse than stated?** I found none that is exploitable beyond its statement. I specifically re-examined:
- *Limit 10 (swap operator):* the on-chain cap × cooldown genuinely bounds a compromised operator; the cooldown is enforced in MINT and cannot be bypassed by re-entrancy or multiple sweeps in one transaction (the `last_sweep_at` stamp is per-instruction and the operator must sign). The stated "cap × windows until the guardian stops it" is accurate.
- *Limit 28 (frozen pool/vault):* the forfeit path (`retire_redeemed` with a frozen pool) is correctly implemented; I traced that a frozen pool cannot lock a vault. Not worse than stated.
- *Limit 32 (redemption cap):* the rolling ring logic in BURN is stricter above 3,047 live vaults, never looser, matching the statement.

**2. Is anything listed as a limit not actually a limit / already closed?** I did not find a stated limit that is silently already closed. Limits 25 and 26 (draw re-roll, last-slot leader grinding) remain real and are not mitigated by anything the author missed. The crank's every-minute capture narrows limit 25's window in practice but does not close it, which the limit already concedes.

**3. Is any DISCHARGED item not actually discharged?** I checked item 51 ($CBOB boost) end to end: `boost_vault`/`expire_boosts`/`set_boost_terms` in MINT, `SetBoostTerms` in GOV, the crank's pre/post expiry, the alarm's `boosts_stalled`, and the boost-bound drift watches are all present and mutually consistent. I specifically tried to break the `boost_expiring` ring (two boosts sharing a slot 64 epochs apart) and confirmed it cannot happen: a boost lasts at most `max_boost_epochs ≤ BOOST_RING − 1 = 63` distributions, so two simultaneously-live end epochs can never be congruent mod 64, and a boost bought after a slot is cleared cannot collide. Item 51 is genuinely discharged. Item 54 (compute) and the other discharged items also check out.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still described as open and none is depended-on as if done. `launch/mainnet-init.json` still carries OPEN entries (`charter_opens_at`, `lock_deadline`, `vault_collection`), consistent with item 38 remaining open.

---

## Measurement limits of this pass

- I audited the bundled off-chain files plus `programs/cbob-vault-mint` and `programs/cbob-vault-sweep` only. SEAL, BURN, GOV, and everything under `web/` were **not** in this bundle, so I could not independently re-verify the round-37 V1/V2/V3 web repairs or the non-MINT programs. My confidence in the MINT↔off-chain agreement is high because both sides were present; cross-program claims about SEAL/BURN/GOV I took from the stated offsets and discriminators, which I spot-checked against `bank/layout.mjs` and found consistent.
- I did not execute the suite or a validator; findings are from source reasoning. F1 includes the concrete reproduction so it can be confirmed by running `planCrank` or a frozen-pool integration pass.
- I did not re-render the audit prompt, so I did not independently reproduce the coverage-gate count.

## Given that no human firm will ever see this and the programs will be immutable, what should this project do before launch that AI audit structurally cannot?

1. **Run the actual mainnet dress rehearsal (item 22) end to end, including the two named revenue-cycle paths, with humans watching the live alert router.** AI rounds reason about code; they cannot observe that a real Orca/Meteora swap, a real forced post-sweep failure, and a real hand-recovery actually behave under live RPC latency, real priority-fee pressure, and real confirmation timeouts. The open-cycle guard and the `classifySendFailure` "unknown" path only get genuinely exercised by a live failure. This must be a human-attended run, not another simulated pass.

2. **Have a human independently confirm the three still-OPEN `initialize` values and every RULED value against the signed transactions, not just against `mainnet-init.json`.** The checker validates the JSON, not the bytes that get signed (round 24 A6 already concedes this). A human should witness the four `initialize` transactions being built from the checked file and confirm the on-chain accounts afterward. AI cannot be the one to decide "this is the value Gary meant" — that is an authority the process deliberately places outside the code.

3. **Physically secure and separately custody the hot keys the design admits (swap operator, guardian/INIT_AUTHORITY, $CBOB release wallet, PoB collection authority, deploy authority).** Several accepted limits (10, 46, 47, 56) are ultimately "a hot key on this box." AI audit can verify the blast radius is bounded on-chain; it cannot verify the key isn't copied, backed up insecurely, or held by a single person with no recovery path. A human custody review (ideally moving the PoB and deploy authorities to cold/multisig through the charter window, as limit 46 itself suggests) is the only thing that closes those.

4. **Publish the holder surfaces (item 50) and have real users attempt a redemption against a rehearsal deployment before the lock.** The redeem page's coverage judgment, the prior-transaction ATA creation, and the "acknowledge lost stray" flow are the only thing standing between a holder and destroying an undeclared holding. That is a human-factors surface; an AI can check the logic but cannot tell whether a real holder will understand the tick-boxes. Run at least one unassisted human redemption.

5. **Decide and document the lock-deadline ordering, then verify the upgrade-authority removal as a deliberate, witnessed act.** The programs being immutable means the removal is irreversible; a human should confirm all five programs (including the sweep helper) match the audited hashes, then remove the authority, then re-dump and re-hash, exactly as road step 11 describes, rather than letting it be an automated step.

These are the items where the absence of a human is itself the risk, rather than a defect in the code.