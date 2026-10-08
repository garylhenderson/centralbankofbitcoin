# Round 38 off-chain audit (independent pass)

**Verdict: NOT CLEAN.** I found one LOW defect that touches `bank/` (F1, an incomplete round-37 repair), two further LOW defects in code (F2, F3), and four INFO items. F4 and F5 are documentation-only and may qualify for the gate-3 exception. I found no CRITICAL, HIGH or MEDIUM. No live command was run here: every claim is from reading the source, and each finding names the measurement that would confirm or refute it.

---

## R0. Round 37's verdict and repairs

| Repair | My result |
|---|---|
| **C01** (ack arms) | **Holds.** The three arms now drive `unredeemable_owner`, which is in `ACKABLE_KINDS`. m1 (empty `why` accepted) and m2 (`true` accepted) each turn an arm red. m3 (key ignores kind) turns the cross-kind arm red: the finding is `unredeemable_owner` and the ack is keyed `vault_burned:`, so under m3 it would downgrade. The R37 control arm proves the kind itself acks. |
| **C02** (free tick from a frozen pool) | **Planner half holds. The repair is incomplete. See F1.** |
| **C03** (`judgeCronTemplate` ignores commented lines) | **Holds for commenting out. Same blind spot remains for a later redefinition. See F2.** |
| **C04** (`--audit` total) | **Holds.** The extracted-expression arm pins it. |
| **C05** (34 SOL a day) | **Holds.** It is text only. The arithmetic is 24/7 × 10 ≈ 34.3: the hourly `:41` run reads the chain clock before its own sweep lands. |
| **C07** (refuted claim, now pinned) | **Holds.** `rejected_row_has_sweep` comes from `detectUnreconciledRevenue` in the same pass, so the claimed silence cannot occur. |

**Disproved claims re-tested:**
- **C06:** the stale "host's owner" text is absent from the tree.
- **C08 / C12:** both rest on limit 10(b) and are loud.
- **C11:** I4 pins calls, not definitions. That scope is stated, so not a defect.

---

### F1. LOW. C02 repair: the joins after a frozen-pool tick are planned and never sent

**Construct.** In `bank/crank.mjs` `planCrank`, the after-distribution joins go into `plan.joins`. They reach a transaction only through this line, inside the delivery block:

```js
if (poolOk && !pool.frozen) { const ready = [] ... ready.push(...plan.joins) ... plan.claims.push(...) }
```

`main()` sends only `plan.preJoins` and `plan.claims`. So with a frozen pool:
- the tick is sent;
- `plan.joins` is non-empty, but nothing ever sends it;
- `describePlan` prints "join after 1".

**Why the gate missed it.** The arm "R37 C02 … ticks and joins" asserts `p.joins.length === 1`. It does not check that the join appears in `p.claims`. So the arm passes on a plan whose joins are dropped. VALIDATION.md's sentence "plans the free tick (and the joins after it)" overclaims for the same reason.

**Effect.**
- The newly eligible vaults wait about an hour, until the next pass's `preJoins` picks them up.
- Every distribution in between is blocked by `JoinWaitingFirst`.
- `joins_stalled` has a 6 h grace, so nothing pages. Nothing is lost.

**Evidence.** Run the arm's own input through `planCrank` and print `p.claims`. It will be `[]`.

**Fix.**
1. When the pool is frozen, emit `plan.joins` as their own join-only claim batches. A claim with only pending pairs moves nothing from the pool; SPEC 28 already relies on this.
2. Change the arm to assert `p.claims.flat()` contains `['Rec0','Ata0']`.

---

## R1. The crank

What I checked and found correct:
- Reveals stop at the first skip, the first mismatch or the first failure, so they cannot go out of order.
- Only positively live assets are joined or paid. Burned vaults are retired first.
- Due boosts are expired before the distribution, and boosts made due by it are expired after.
- `retiringOwed` mirrors `retire`.
- `splitToPool` equals `total − ⌊total·1500/10000⌋`, matching `split_revenue` at the fixed 8500 bps.
- `avail` and `acc` mirror `distribute` and `credit`.
- The only programs called are MINT's permissionless instructions.

Besides F1, one observation, filed as F5 below: the hung-socket stall from round 25 A1 is still present at HEAD.

## R2. The alarm

I found no dangerous state that reads as quiet beyond the accepted limits. The routine states that page are by design: `redemptions_near_cap` at small live supply, and the third-party program upgrades at HIGH.

## R3. Layouts

- All 11 PDA seeds are asserted against the Rust (D6). `RESCUE_SEED` is absent from the list, which is already stated (C14).
- The type-change and field-addition mutations are both caught by the selftest.
- `MINT_CONFIG_SPACE` is scraped from the Rust and evaluated. Correct.

## R4. Money arithmetic

`pendingScaled` equals `owed_of`, `credit` equals `credit`, and `ceilSats` equals `ceil_sats`. The crank's weight for a pre-joined vault, `w·acc_old`, equals `join`'s debt. I found no divergence.

---

## R5. The swap and the revenue cycle

**(a) Oracle math.** The exponent handling is correct for both signs, and rounding is down. `satsPerLamport` is a float used only for the deviation gate, which tolerates its precision.

**(b) Pyth account.**
- The `PriceUpdateV2` offsets are right: level at 40, feed at 41, price at 73, confidence at 81, exponent at 89, `publish_time` at 93.
- Being owned by the receiver at the derived address limits writes to the push-oracle program. That program accepts any newer, fully verified Pyth message from anyone.
- So an adversary can pick, from real signed prices inside the 180 s window, whichever is most favourable. That falls within the stated bound.
- The clock comes from the Clock sysvar, with its owner checked. Good.

**(c) Deviation filter.** `orcaSpot` and `meteoraSpot` measure the right quantity in the right direction (sats per lamport). Meteora's negative-id bin-array index agrees with the program's truncation rule.

**(d) Minimum out.** It is the same `minSats` on both venues, in output base units.

**(e) The judge.** It is complete for the value-moving roles. It does not pin Meteora's `host_fee_in` (key 9), the token-program slots, or Orca's vault and tick-array keys. Those are pool-validated, and a host fee comes out of the protocol fee, not the user's output. See F6.

**(g) wSOL handling.**
- A pre-funded wSOL ATA is harmless: `sync` counts the extra and `close` returns it.
- The native mint has no freeze authority.
- Only the operator can set a delegate.

**(h) Failure and retry.** See F3.

**(i) What an adversary can extract.**
- A sandwich or a pool pushed to the edge of the gate can take up to about (150 bps − 16 bps fee − impact) per cycle.
- That is roughly 0.12 SOL on a 10 SOL cycle, or about 0.4 SOL a day at the 34 SOL/day ceiling: around 12 SOL a month at full throughput.
- Oracle jitter of up to 30 bps confidence and 180 s staleness adds to it in volatile markets.
- This is material, about 1.2–1.5% of royalty throughput, and it matches the guide's "up to 1.5%".
- Hardening: send through a private or Jito path, and set the floor to max(oracle floor, simulated output − small slippage).

**Operator key worst case.** Unchanged: cap × cooldown windows until the guardian stops the sweep. Dependence has moved to Orca, Meteora, Pyth and the RPC, as limit 10(a)–(d) says.

**Can a failed cycle read as closed?** Only a `refused` sweep sets `sendRejected`. If that verdict were wrong, both `unledgered_sweep` and `sweep_unledgered_state` page CRITICAL.

---

### F3. LOW. A refused swap attempt's signature is not kept

**Construct.** In the venue loop of `bank/revenue.mjs`, a `refused` verdict records only free text in `tried`. `verdict.sig` is never stored. The sweep path, by contrast, stores `refusedSig`.

**How it goes wrong.**
1. The Orca swap's confirmation fails with "block height exceeded".
2. A lagging, load-balanced status node returns `null` for that signature.
3. `classifySendFailure` therefore returns `refused`, although the swap landed.
4. Meteora is tried next.
   - If the operator holds more than `lamportsIn` (the float is 0.02 SOL and `MIN_SWEEP_LAMPORTS` is 0.01 SOL, so this is possible for small sweeps), that second swap can land too. The result is a double swap.
   - Otherwise it is refused for insufficient funds, and the cycle is left open.
5. Either way, the landed Orca signature appears nowhere in the ledger, so the hand-recovery runbook's "check every recorded candidate" misses it.

**Evidence.** Feed the loop a stub where `statusOf` returns `null` for the expired Orca signature. The ledger row will carry no Orca signature.

**Fix.**
- Persist `refusedSwapSigs[]` and list them in `--audit`.
- On an expired attempt with a `null` status, re-query after a few seconds before trying the next venue.

### F4. INFO (documentation only). SPEC limit 10 overstates the deviation gate

**What SPEC says.** "A pool … more than 1% from the oracle at either market read is skipped."

**What the code does.** The venues used come from the second read (`m2`) only. The first read (`m1`) only checks that at least one venue is usable. So a pool skipped at the first read is still used if it passes the second.

**Fix.** Either correct the text, or require the venue to be in both `m1.venues` and `m2.venues`.

### F5. INFO. The A1 hang is still present, and SPEC implies it was fixed

**What SPEC says.** Limit 25 attributes the 300.8 s default-`Connection` stall to the crank and revenue "at `2b67fb1`", which reads as history.

**What HEAD does.** `crank.mjs`, `revenue.mjs` and `alarm.mjs` all still construct `new Connection(rpc,'confirmed')` with no fetch timeout. One RPC socket that accepts and never answers still stalls the reveal lane past the roughly 2-minute capture window, which lapses draws into limit 25's re-roll class.

**Fix.** Pass a custom `fetch` with `AbortSignal.timeout(~10 s)`. Otherwise correct the text so it does not suggest a repair.

### F6. INFO. "EXACT seven-instruction sequence" is narrower than stated

The judge does not pin every account of the swap instruction (see R5(e)). Either pin the remaining account keys of the swap instruction, or narrow the SPEC claim to "value-moving roles".

### F7. INFO. A rehearsal's crank and revenue streams share production labels

SPEC 53 isolates the alarm's router state for the dress rehearsal (`ALERT_STATE_DIR`, `ALERT_LOG`). It says nothing about the crank's (`cbob-vault-crank:*`) or revenue's (`cbob-revenue:*`) labels. A rehearsal's open streams can persist in the router and mute the first production failure.

**Fix.** Apply the same isolation to the rehearsal's crank and revenue runs, or prefix their labels in rehearsal mode.

---

## R6. Gates

- **F1** is an arm that cannot fail on the property its name claims.
- **F2** is a gate blind to its own subject (details below).

The other floors equal their counts. Every arm I mutated mentally turned red.

### F2. LOW. `judgeCronTemplate` trusts any live `-n` definition, even one later overridden

**Construct.** In `bank/detectors.mjs`, `varHasN` is true if any live line defines `FLOCK` with `-n`. Definition order is not considered.

**How it goes wrong.** Add `FLOCK=/usr/bin/flock` (or `FLOCK="$FLOCK"`) after line 83 of `scripts/cron-install.sh`. The gate still passes, but every installed money cron now waits for the lock instead of skipping. This is the same lost safety layer as C03.

**Evidence.** Run the C03 arm with that line appended after line 83. Expected: 0 lines refused.

**Fix.** Judge only the last live assignment to `FLOCK` before the heredoc. Add both-ways arms.

---

## The accepted limits: the four questions

1. **Is any limit worse than stated?**
   - Limit 25: yes in practice. The slow-RPC lapse is still reachable (F5).
   - Limit 10: per-cycle leakage up to the floor is realistic under a sandwich (R5(i)). The "1.5%" disclosure covers it.
2. **Is anything listed as a limit not actually a limit?** No.
3. **Is any discharged item not actually discharged?** No. 51, 54, 12/17 and 30/31/33 hold against the code.
4. **Is any open-and-blocking item being quietly treated as accepted?** No. Items 22, 38, 50, 52 and 53 remain open.
   - Item 22's rehearsal list should add a lagging-status-node case for F3.
   - Item 53's rehearsal procedure should add F7's stream isolation.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the dress rehearsal (item 22) adversarially.**
   - Sandwich your own swap from a second wallet.
   - Point the crank at an RPC that accepts sockets and never answers.
   - Freeze a test-mint pool and confirm the tick-then-join timing.
   - Record every signature.
2. **Have a human read the four signed `initialize` transactions byte by byte** against `launch/mainnet-init.json`, on a second machine that has never touched this box. The checker validates the JSON, not the transaction.
3. **Rebuild `dist/` on an independent machine from the release commit** and compare sha256 values before steps 9 and 11.
4. **Run an alert-delivery drill.** Trip one finding of each class (once and level) and confirm that a person receives and acts on each.
5. **Settle key custody before the charter window.**
   - Take the Moments collection update authority and the $CBOB release wallet cold. Both are Gary's call, and both are listed as hot.
   - Run a fire drill: pull `emergency_stop_sweep` from the guardian wallet within N minutes of a page.