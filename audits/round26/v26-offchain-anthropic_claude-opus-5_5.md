# Round 26 — Off-chain audit (MINT and the sweep helper as reference)

**Scope:** the current tree as bundled. Severity is mine.

**Summary:** no CRITICAL, HIGH or MEDIUM findings. There are three LOW findings and six INFO findings. Three of them are failures of round-25 repairs:

- the L3 timeout case leaves nothing for the hand-recovery runbook to look up;
- the I1 anchor fix reached one of its two sites;
- the H1 stream discipline was never carried to `bank/revenue.mjs`, and L4's hourly cron makes that worse.

Each finding names the evidence that would exist if it is true.

---

## R0 — Round 25's off-chain repairs

### R0-1 (LOW) — L3 repair: an "unknown" send outcome is never written to the ledger, so limit 10's hand-recovery runbook has nothing to look up in exactly the case it exists for

**Construct.** `bank/revenue.mjs` has two failure paths:

- **Sweep:** `catch (e) { const verdict = await SW.classifySendFailure(...); if (verdict.outcome === 'refused') {...} if (verdict.outcome !== 'landed') throw e ... }`
- **Swap loop:** the same shape, ending in `if (verdict.outcome !== 'refused') throw e`.

In both, when the outcome is `unknown`, `verdict.sig` is known to the process. It is not saved, and then the process throws.

**What happens in each path.**

- **Sweep unknown.** The intent row holds only `intendedLamports`, and `sweepSig` is absent. If the sweep actually landed, the alarm raises two CRITICALs:
  - `unreconciled_swap` on the intent row;
  - `unledgered_sweep` on the on-chain signature, which no row claims.

  Nothing links the two, so a human must work out that they are the same event.
- **Swap unknown.** The row has `sweptLamports` and no `swapSig`. Limit 10's runbook says: *"look up the recorded `swapSig` (if any) with `getSignatureStatuses`… a swap whose confirmation timed out may have landed."* The timeout case is precisely the one where no `swapSig` is ever recorded. The operator is left to infer the swap from balance deltas. That is the setting in which the documented double-swap risk lives, and it is item 22.4's rehearsal walk-through.

**What it costs.** Nothing is stolen. It is diagnosis time, plus the double-swap risk limit 10 already names, made more likely because the one datum the runbook relies on is missing.

**Evidence if true.**
1. On a fork, stub the RPC so `sendAndConfirmTransaction` throws `TransactionExpiredBlockheightExceededError` after the swap lands, and make `getSignatureStatuses` return `null` for the first lookup.
2. The ledger row afterwards has no signature field at all.
3. No selftest arm asserts that an unknown verdict persists its signature. The round-25 L3 arms only test the classifier.

**Fix.**
- Sign the transaction first, take `bs58.encode(tx.signature)`, and write `pendingSweepSig` or `pendingSwapSig` (with the venue and `lastValidBlockHeight`) to the ledger **before** sending.
- On any outcome other than `refused`, promote the pending field.
- Have the recovery path and the alarm treat a pending signature as the candidate.
- Make `detectUnreconciledRevenue` name the pending signature in its detail text.

### R0-2 (LOW/INFO) — I1 was applied to one of two sites; the `splitByOther` anchor still uses box time minus 60 s

**Construct.**
- **Fixed site:** `closesCycle` anchors on `returnBlockTime`.
- **Unfixed site:** in `detectSplitClaims`, the `byOther` loop still computes `const afterMs = Date.parse(c.returnedAt || c.startedAt)` and `splitTime(e) * 1000 >= afterMs - 60_000`.

**What it costs.** A `splitByOther` row is still vouched for by a split that landed up to 60 s **before** the return. That is exactly the I1 condition, on the sibling branch. It weakens the holding of the ledger writer to the chain, and only that.

**Evidence if true.** Feed `detectSplitClaims` a `splitByOther` cycle with `returnBlockTime: R` and an unclaimed split at `R-50` whose total covers the return. It comes back quiet, while the same data under `splitSig` returns `split_claim_unanchored`.

**Fix.** Route the `byOther` matcher through `closesCycle(c, pool, { exclude: used ∪ claimed })`. Add a both-ways arm.

### R0-3 (LOW) — The revenue job's own failure notices have one shared label and no recovery; L4's hourly cadence makes the H1 class worse

**Construct.** `bank/revenue.mjs` notifies every failure with `execFileSync(NOTIFY, [msg, 'cbob-revenue'])`:
- there is no per-condition stream;
- there is no RECOVERY;
- ALERT_URGENT is never set.

**What happens.** The crank's H1 repair (separate lane streams and a recovery) and the alarm's (per-kind streams) were not carried here. Under the router behaviour this repo measured:
1. The first revenue failure opens `cbob-revenue`.
2. Every later failure is suppressed for 12 hours, then reminded once a day. That includes a different failure, such as a real refused sweep after an earlier open-cycle wedge.
3. Nothing ever closes the stream.

With L4, the job runs 24 times a day, so a wedged open-cycle guard emits 24 suppressed pages a day into a stream that stays open indefinitely.

**What it costs.** A second, unrelated revenue fault goes un-emailed. The alarm's `unreconciled_swap` and `cycle_unsplit` cover part of this, but not, for example, the `SW.market` refusals ("neither pinned pool prices within the oracle bound") that stop every sweep.

**Evidence if true.** Run `alert-router.py --emit` in a scratch state directory:
1. `CBOB REVENUE CYCLE FAILED: 1 revenue cycle(s) swept…` gives QUEUED.
2. `CBOB REVENUE CYCLE FAILED: neither pinned pool…` gives SUPPRESSED.

**Fix.** Mirror `crankNotices`:
- give each failure class its own label (`cbob-revenue:open_cycle`, `:refused`, `:market`, `:failed`);
- keep a failing marker, and send a RECOVERY on the next clean run;
- defang the text;
- add a selftest arm, against the router, that a second class is QUEUED while the first is open.

### R0-4 (INFO) — L1: the judge's unchecked account positions, stated so nobody reads "complete" into it

**What is unchecked.** `judgeSwapInstructions` pins the input account, the output account, the authority, the pool, the amount, the floor and (for Orca) the direction and price limit. It does not pin:
- **Orca:** vault A/B (keys 4, 6), the tick arrays (7–9), the oracle (10);
- **Meteora:** the bitmap (1), the reserves (2, 3), the mints (6, 7), the oracle (8), **`host_fee_in` (9)**, the token programs (11, 12) and the event authority (13).

**Why this is INFO.** Each of these is either validated by the pool program, which refuses a mismatch, or is `host_fee_in`. In DLMM the host fee is carved out of the protocol share of the fee, so a tampered `host_fee_in` diverts protocol revenue, not our output.

**Evidence that would settle it.** Run the fork with Meteora key 9 set to a stranger's cbBTC account:
- If our cbBTC delta is unchanged and the stranger receives a sliver, this stays INFO.
- If our delta falls, it is a judge gap and the judge must pin key 9 to `METEORA.program`.

Pinning key 9 anyway costs one line.

### R0-5 (INFO) — L2: two clock residues

1. **The cooldown clock read is less strict than the market clock read.** `revenue.mjs` reads the Clock sysvar for the cooldown with `clockUnixTimestamp((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY))?.data)` and does not check the owner. `market()` does check it.
2. **The fork's main arms do not judge age against the chain clock.** SW.1, SW.4, SW.8 and SW.9 compute the floor with `nowSec = max(publishTime)`, so staleness is untested there. SW.7–7b cover it through `market()`.

**Fix.** Use the same owner-checked read in both places.

### R0-6 (INFO) — L7: the program-id gate does not reach the Rust cross-program pins or `tests/` and `sim/`

**What is uncovered.**
- **Rust cross-program pins:** MINT's `SEAL_PROGRAM_ID`, `BURN_PROGRAM_ID` and `GOV_PROGRAM_ID`, BURN's and GOV's equivalents, and SEAL's BURN id are covered only by the 4-character-prefix scan. A typo in the first four characters escapes it.
- **The suite and the sim:** neither is scanned, although the suite would refuse at runtime.

**Fix.** Add every `pubkey!("…")` naming one of our programs to `ID_SITES`.

### Repairs held on re-read

No defect was found in these:
- **L4:** the hourly line, `sweepCooldownOver`, and the cooldown-aware `royalties_unswept` grace.
- **L6:** the deviation arms, both sides and both venues, through `market()`.
- **I2, I3, I4.**
- **D1/D2 copies:** SPEC limit 10 and item 50, DESIGN, and the HOLDER-GUIDE swap text.
- **Round-24 D6:** the SEEDS assertion now exists and is both-ways.

---

## R1 — The crank

### R1-1 (INFO) — Planner and program agree except for one benign divergence

On re-read the plan matches the program in these places:
- the arithmetic against `credit` / `owed_of` / `join` / `expire_boost`;
- pre-join debt `w·acc_old`;
- post-expiry owed `carry + w_level·Δacc`;
- `retiringOwed` against `retire`;
- split `total − floor(total·1500/1e4)` against MINT `bank_cut`.

**The divergence.** The crank refuses a launch tick on a **frozen** pool. The program's tick path never checks the freeze. So during a pool freeze the crank never runs the epoch tick, and only an in-line host does. It costs nothing, because nothing can be credited anyway, but it is a plan the program would accept and the crank withholds.

**Fix.** Optional. Drop `!pool.frozen` from the tick branch only.

### R1-2 (INFO, accepted limit 25)

The cheap A1 fix (a 20 s `AbortSignal.timeout` fetch on the reveal lane's `Connection`) was not applied. `new Connection(rpc,'confirmed')` still waits about 300 s on a socket that accepts and never answers. See Q1.

---

## R2 — The alarm

### R2-1 (INFO) — Unbounded state

The alarm keeps every split and sweep it has ever seen, and every pass sorts and scans them:
- `seenSplits` (one entry per hourly crank split, about 8,760 a year, plus revenue splits);
- `seenSweeps`.

Both feed `closesCycle` and `detectSplitClaims`. The state file grows without limit, so the pass gets slower and the atomic rewrite gets larger.

**Fix.** Prune entries older than the oldest open cycle's start minus a margin. Never prune anything newer than a cycle inside the verification horizon.

No dangerous on-chain state that reads as quiet was found beyond limits 9 and 46, which are already accepted.

---

## R3 — Layouts

The field lists, offsets, seeds, versions, `BOOST_RING` and the allocated space are each asserted both ways against scraped Rust. The struct list I read matches field-for-field.

---

## R4 — Money arithmetic

`accrual.mjs` matches `credit`, `ceil_sats`, `owed_of`, `reweigh` and `join`.

---

## R5 — The swap and the revenue cycle

### R5-1 (INFO, quantifying limit 10) — What can be extracted inside the tolerance, and the sweep announces the swap

**How the swap is exposed.**
- The swap is sent through a public RPC, seconds after a `sweep_sol_for_swap` that anyone can watch on chain.
- The swap runs at a predictable minute.
- An Orca fill of the 10 SOL cap costs about 16 bps in fee plus 1–2 bps of impact. The on-chain floor is 150 bps under the oracle.

**What an attacker can take.** A searcher running a sandwich or back-run can take up to about **130 bps per cycle**:
- ≈0.13 SOL per cycle at the cap;
- at most 4 cycles a day, so ≈0.5 SOL a day;
- about **15 SOL a month** if royalties fill the cap.

**Conditions.**
- The deviation gate (100 bps on spot at read time) does not bound this. The floor is the only bound.
- On Meteora (about 10x thinner) the same 150 bps floor binds.
- A stale but accepted oracle (≤180 s, ≤30 bps conf per feed) shifts the floor by up to about 60 bps combined in either direction.

**Fix.** Set the floor to `max(oracleFloor, simulatedOut × (1 − 30 bps))` from a `simulateTransaction` of the built swap. The oracle floor stays the hard backstop. Also send through a private or bundled path, or jitter the minute.

**Evidence.** The fork's SW.8/SW.9 notes already record bps-under-oracle for an honest fill. The gap between that figure and 150 bps is the extractable margin.

### R5-2 (INFO) — The recovery's split scan does one parsed-transaction read per mint

`revenue.mjs` recovery calls `getParsedTransaction` for every signature on the revenue ATA (`splitsSince`). Every paid mint pays into that ATA, so during a busy sale that is up to 10,000 parsed reads per hourly run.

**Effect.** A rate-limited RPC throws, and the job wedges at the open-cycle guard.

**Fix.** Filter by `memo`, or by the MINT program plus the split discriminator via `getSignaturesForAddress(MINT)`, or by cursor.

### R5-3 — The wSOL path, Pyth offsets and exponent math

**wSOL path.** A pre-existing balance is returned on close, the native mint has no freeze authority, and the operator signs any delegate.

**Pyth offsets.** Level @40, feed 41..73, price @73, conf @81, expo @89, publish_time @93.

**Exponent math.** `lamports·sol·10^(es−eb)/(btc·10)`, rounded down twice.

No defect was found in any of these.

---

## R6 — Gates

### R6-1 (INFO) — The ship gate depends on an environment variable

`CBOB_SHIP_GATE=1` is what turns a DNS-failure skip of the mainnet probe and of the swap fork into a failure. A certifying run where the variable is not set passes green with "SKIPPED". Road step 7 leaves that to a human reading the log.

**Fix.** Make `build-mainnet.sh` refuse unless the last `run-tests.sh` log at HEAD shows both floor lines printed.

### Other gates

- `cron-install.sh` arms nothing beyond its stated jobs.
- `build-mainnet.sh` fails closed on a stale `target/deploy` sweep build.

---

## The four questions about the accepted limits

### 1. Is any limit worse than stated?

- **Limit 10.** Its hand-recovery runbook cannot be executed as written in the timeout case (R0-1). The extractable margin is about 130 bps of royalty SOL per cycle, signalled by the sweep (R5-1). The text says only "up to 1.5%".
- **Limit 7.** It says each job's failures page from its own stream with a recovery. That is true for the crank and the alarm, and false for revenue (R0-3).
- **Limit 25.** Unchanged in cause. The cheap fix offered by A1 is still unapplied (R1-2).

### 2. Is anything listed as a limit already closed?

No item was found to be closed beyond what the list already records as discharged.

### 3. Is any DISCHARGED item not actually discharged?

None was found.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

- **Item 22.4** (the forced post-sweep failure walked through hand recovery) is still blocking, and R0-1 means the walk-through will find the runbook's lookup empty.
- **Item 53's** `launch/rehearsal-init.json` and rehearsal mode are still unbuilt, as the item states.

---

## What this project should do before launch that AI audit structurally cannot

1. **Execute the dress rehearsal (item 22) as a signed, recorded run.**
   - A human must walk the forced post-sweep failure through recovery with a timed-out-but-landed swap, injected by an RPC proxy. This tests R0-1 for real.
   - Record every transaction signature.
2. **Reproduce the five artifacts on a second, independent machine,** for example `solana-verify` in Docker from the tagged commit.
   - Compare sha256 values before the lock.
   - Do the same for **Metaplex Core**: build it from Metaplex source at the pinned commit and match it to `core-mainnet.so`. Limit 40 admits that equivalence is unproven.
3. **Publish a public bug bounty with a real escrowed reward,** against the rehearsal deployment at throwaway ids, for at least two weeks before removing the upgrade authority. Adversaries with real money at stake find what readers do not.
4. **Run a key ceremony done by people, not code.** This means:
   - signing `initialize` from transactions decoded and checked against `launch/mainnet-init.json` by a second person;
   - holding the PoB collection authority and the $CBOB release wallet cold through the charter window (limits 46 and 56; this is Gary's call);
   - doing an `--final` authority removal confirmed by a third-party read.
5. **Run chaos soak tests.** Run the crank, the alarm and revenue for at least 72 hours against the rehearsal with:
   - kill -9 mid-cycle;
   - black-holed RPC sockets;
   - clock skew;
   - full disk.

   Confirm every stall pages on its own stream and recovers.
6. **Monitor the monitor from somewhere else.** Put an external heartbeat check on a different host and provider, so a dead box pages someone.
7. **Run property fuzzing on the host tests.** Run randomized sequences of `join` / `credit` / `claim` / `retire` / `reweigh` (cargo-fuzz or proptest) for millions of iterations. The invariant to check is that pool ≥ ceil(owed) and every share is owed exactly once. Reading cannot reach that state space.