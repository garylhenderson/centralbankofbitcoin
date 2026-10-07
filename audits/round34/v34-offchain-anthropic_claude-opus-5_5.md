# Round 34 audit: off-chain pipeline, MINT and the sweep helper as the reference

**Verdict: NOT CLEAN.** I found no CRITICAL, HIGH or MEDIUM finding. Two LOW findings and two INFO findings survive my reading. Each one names the measurement that would confirm or refute it.

**What this round is.** It is a source reading of the bundled tree. I did not execute anything: no suite, fork, validator, live mainnet or live crank or alarm. Every claim below is stated as "here is what would exist if I am right", so it can be checked rather than believed.

---

## R0. Round 33's verdict and repairs

I re-derived each repair from the current source rather than from the verdict text.

**L1 (box clock mixed with chain clock) and D1 (an uncertain send explained a sweep): HOLD.**
- `detectSweepState` now matches `|t − startedAt| ≤ ⌊cooldown/2⌋`.
- A row counts as an explanation only if it has a `sweepSig`, or a `pendingSweepSig` that is in `landed`.
- `landed` is built in `alarm.mjs` from a direct `getSignatureStatuses(…, {searchTransactionHistory:true})`. It requires `confirmed` or `finalized` with no error, and a throwing lookup leaves it empty, which is the loud direction.

I re-checked the thief argument from the MINT source:
- `sweep_sol_for_swap` refuses `SweepTooSoon` until `last_sweep_at + cooldown`.
- `revenue.mjs` writes a row only after `sweepCooldownOver` on the chain Clock.
- So a thief's sweep is at least one full cooldown from any honest landed sweep. An honest run started inside the cooldown writes no row.
- The window therefore cannot explain a thief at any skew below half a cooldown.

The review-33 fix judges with the smallest cooldown ever seen, capped at 21,600. That is persisted in `sweepCooldownSeen` and rolled back on an undelivered pass. It closes the "execute a lengthened cooldown afterwards" widening. The selftest's extracted-fragment arm exercises the real lookup body.

**D2: HOLDS.** `mint.last_sweep_at` is in `WATCHED_KEYS`.

**D3: HOLDS.**
- `RX.launch` is now `/(\d+) launch\b/g`.
- The planted-stale arm `statedIn('48 launch and', …)` fails as it should.

**Gate-5 wSOL obligation: DISCHARGED.** It is discharged by suite arm R33.G4, according to VALIDATION.md. I cannot see `tests/3prog.test.ts`, so I rest this on the recorded 866/866 run.

**Counts are consistent across files.**
- `DET_FLOOR = 909` equals selftest `FLOOR = 909`.
- `MIN_ASSERTIONS = 866`.
- SPEC states 866, 909, 39, 23, 4, 14, 47 and 33.
- `SWAP_FLOOR = 16`.

**Muse and Longcat** were counted in round 33 with recorded defects. Quorum held at 6/8 without them, so I see no reason to revisit it.

**Repairs that introduced nothing new.** I looked for collateral damage from the round-33 change at every site of the same shape. The only other place that compares a ledger stamp with chain time is `cycleStartMs`, which already translates domains. The `explained` predicate is the only consumer of `landed`. No regression found.

---

## R1. The crank (`bank/crank.mjs`)

**Account order.** Every instruction's key order matches its MINT `#[derive(Accounts)]` struct:
- `RevealLevel`, `Activate`, `RetireBurned`, `Claim`, `Distribute`, `SplitRevenue` (config read-only is correct, since it is not `mut` in MINT), `ExpireBoosts`, `CaptureEntropy` and `RescheduleReveal`.
- Discriminators are computed, not typed.

**Planning against what the program will accept.** I walked the send order against MINT's gates:
- *Joins first.* Join-only `claim` batches run `monthly_inline` before their loop, while `waiting_to_join > 0`. So no in-line credit fires mid-join, even across several 14-pair batches. This matches `JoinWaitingFirst`.
- *Boost expiry before distribution.* `preExpires` equals MINT's `boosts_due` population at `cfg.dist_epoch`. Retiring vaults are excluded because `retire → unschedule_boost` takes the due branch.
- *Planned weight.* `w = total_active_weight + preJoin − retiring(incl. boost) − expiring(boost)` equals the denominator MINT will see.
- *Planned amount.* `avail` uses `owed_scaled − retiringOwed`, which equals `retire`'s `owed_scaled −= pending`.
- *Split arithmetic.* The split figure equals MINT's `holders = total − ⌊total·1500/10⁴⌋`.
- *Owed amounts.* Owed for pre-expired, pre-joined and boosted vaults matches `owed_of` after `reweigh`, which moves owed into carry.

**Paying or joining a dead vault.** Only a positively live asset is joined or paid. The remaining window between the asset read and the send is limit 27.

**Order of reveals.**
- The FIFO starts at `revealed_total`.
- A missing or `other` asset breaks the run, as does a `level`-bearing list ("revealed").
- I found no out-of-order send.

**Moving value.** No path moves value outside a program-pinned destination. The source assertions in the selftest stand.

**Wasted fees and false pages.** I traced every race code:
- `AlreadyActive`, `ActivationPending`, `AlreadyRetired`, `NothingToSplit` and `MonthNotElapsed`.
- The distribute re-judgement.
- `expire_boosts` skipping non-due records.
- `claim` skipping retired, pending-not-yet-eligible and zero-pay pairs.

The only false-refusal routes left are a pool frozen between plan and send (a real event, paged) and a split that failed for its own reason followed by its distribution (round 32 C13 / 33 C08).

**R1: no new finding.**

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### LOW-A: the alarm's split state grows without bound, and its per-pass cost grows as (cycles × splits). A stranger can accelerate both for about one sat plus one fee per entry.

**Construct.**
- `alarm.mjs` sets `next.seenSplits = D.dedupeSeenSplits([...seenSplits, ...(prev?.seenSplits || [])])`, which is never pruned. It is rewritten and fsynced every pass.
- In `detectSplitClaims`, the verified set is `recent = cycles.filter(counts).slice(-200) ∪ cycles.filter(c => sweptOnChain.has(c.sweepSig))`. Since `opts.sweeps = allSweeps` is every sweep ever seen, this is every chain-swept cycle ever, not 200.
- For each such cycle with a `splitSig` and a return, the code calls `closesCycle(c, entries, {upTo})`.
- `closesCycle` rebuilds `dedupeSeenSplits(splits)` (a Map over all S entries). It then filters all S, calling `splitTotal → BigInt(v)` per entry, before sorting the small surviving window.

So each pass costs about C × S, where C is every cycle ever recorded (about 1,460 a year) and S is every split ever seen.

**How a stranger adds an entry.** `split_revenue` is permissionless and needs only `total > 0`.
- One transaction does it: a 1-sat transfer to the revenue ATA, then `split_revenue`.
- It names MINT, so the walk records it as a seen split (with `accounts[2] == payment`).
- Cost: 5,000 lamports plus 1 sat, which goes to holders and the Squads.
- The per-program read budget caps intake at about 2,000 entries per pass, or about 96,000 a day.

**What the attacker gains.**
- Only delay. I found no false close: `closesCycle` still requires `total ≥ returnedSats` and an ordering anchor.
- Organic growth alone (hourly crank splits during sales) reaches about 10⁸ BigInt and Map operations per pass in year three.
- A stranger spending roughly $1,500 can add about 1,000,000 entries over about ten days. That makes each pass do about 1.5×10⁹ `BigInt` parses plus Map inserts, plus a state file of about 150 MB stringified and fsynced every 30 minutes.
- Once a pass exceeds 30 minutes, `flock -n` silently skips the next pass. Every detector is delayed, including the round-32 state-derived sweep check, which exists precisely because floods must not delay it.

**Evidence that would exist.** A pure benchmark: `detectSplitClaims` with 1,500 cycles whose `sweepSig` is in `opts.sweeps`, against 10⁵ and 10⁶ synthetic `{sig, blockTime, total}` entries. Wall time should scale linearly in S × C. The state-file size can be measured from `JSON.stringify(next)`.

**Fix.**
1. Sort and dedupe `seenSplits` once per pass, and pass the sorted array to `closesCycle` (binary-search the window).
2. Record "verified at pass N" per cycle in alarm state and stop re-verifying closed cycles.
3. Prune `seenSplits` older than the oldest unresolved cycle's return minus a margin.
4. Add a both-ways arm: a large synthetic S completes under a time bound, and a pruned entry still anchors no cycle it should not.

### R2: no further finding

The pending guardian and operator, PoB plugins and authority, near-full redemption window, frozen and insolvent pool, overdue distribution, upgrade authority for all five programs past the lock, and Gary's production values all page as described. I found no routine state that pages every pass that is not already a disclosed level kind.

---

## R3. Layouts (`bank/layout.mjs`)

- `VaultRecord` fixed length is 211 plus 10 padding, which is 221. That matches `VAULT_RECORD_SPACE`. MintConfig 1,005 plus padding is asserted by scraping the Rust.
- The cross-program `OFF_*` comparison is complete. A scraped-but-uncompared offset fails the build.
- Seeds are asserted (round 24 D6 now holds). Versions and `BOOST_RING` are asserted.
- `parseRustStruct` throws on an unreadable field line, so a private or `pub(crate)` field cannot slip past.

**R3: no finding.**

---

## R4. Money arithmetic (`bank/accrual.mjs`)

- `credit`, `ceilSats`, `available` and `pendingScaled` reproduce `owed_of`: weight × acc, plus carry, then minus debt, with the subtraction order the Rust uses.
- `reweigh` reproduces MINT exactly.
- The crank expires every due boost before distributing and every boost its own distribution makes due right after (`end == dist_epoch + 1`).
- `boosts_stalled` is wired, and `cbob_mint` and the boost bounds are CRITICAL drift.

**R4: no finding.**

---

## R5. The swap and the revenue cycle

### (a) Oracle math: correct

- sats = lamports × P_sol × 10^(e_sol − e_btc) / (P_btc × 10). The /10 is 10⁸/10⁹.
- Both exponent signs are handled.
- Rounding is floor on both the expected output and the floor itself, which is in the vault's disfavour, and correctly so.
- `satsPerLamport` uses doubles. Relative error is about 1e-16 against a 100 bps gate.

### (b) `readPyth`: offsets recomputed, correct

For a FULL update the offsets are: tag at 40, feed 41..73, price 73, conf 81, exponent 89, publish_time 93.

**Ownership plus derivation is not exclusivity of content.**
- The push-oracle accepts any Wormhole-verified Pyth message newer than the stored one, from anyone.
- So a party can choose which genuinely signed price lands, from among all prices published since the last sponsored update (up to about 60 s, more if the sponsor stalls). It cannot post a price older than the stored one.
- This is bounded by the 180 s age, the 30 bps confidence and the 100 bps pool agreement, and it sits inside limit 10(a).
- The clock it is judged against is the RPC's Clock sysvar: limit 10(b).

### (c) Deviation filter: correct

- `orcaSpot` is token-B raw per token-A raw, which is sats per lamport.
- `meteoraSpot` is the inverse of Meteora's Y-per-X, which is also sats per lamport.
- Both directions are right. Floating point is irrelevant at 100 bps.

### (d) Minimum out

The minimum is the same `minSats` that came from `m2`, in raw sats. It sits at offset 16 in both Orca and Meteora data, which the judge pins.

### (e) The judge

It is complete for value-moving roles. Venue-internal accounts other than the pool, in, out and signer are unpinned. Meteora `host_fee_in` is round-32/33 C14.

### (f) Derivations: checked against the IDLs

- Orca tick arrays are `["tick_array", pool, start-as-string]`, current then two below, plus `["oracle", pool]`.
- Meteora bin arrays are `["bin_array", pair, i64 LE]`, active then two above. The others are `["bitmap", pair]` and `__event_authority`.
- An uninitialised next array makes the venue refuse. That is a liveness cost only, and it falls through to the other venue.

### (g) wSOL handling

The pre-filled and stranger-created cases are measured (R31, R33.G4). The mint has no freeze authority, and the account's delegate and close authority need the operator's signature. With exact-in, any leftover input is closed back to the operator.

### (h) Failure and retry

No automatic double swap is possible, and the ledger stays open until the delta is proven. There is one liveness defect:

### LOW-B: a congestion expiry on BOTH venues strands the swept SOL and wedges the revenue job until a hand recovery

**Construct.**
- `revenue.mjs` venue loop, together with `SW.classifySendFailure`.
- A swap whose blockhash expired and which has no status is classed "refused", correctly as a safety matter. The loop then moves straight to the next venue, without retrying the same venue with a fresh blockhash.
- The judge forbids any compute-unit price (round 25 L1).

**Consequence.**
- During ordinary mainnet congestion, a swap with no priority fee can fail to land twice in a row: once on Orca, then on Meteora, using the same `m2` read.
- After both, the code throws "every pinned venue refused". The SOL sits on the operator key.
- `unreconciled_swap` goes CRITICAL after 60 minutes, and every later hourly run dies at the open-cycle guard until a person performs limit 10's hand recovery, which is the path that *can* double-swap.
- A congestion expiry on Orca alone also diverts the trade to the ten-times-thinner Meteora pool for no price reason.

This is not the round-31/32 C16 class. That class covers volatility refusals and stale balance reads, not the absence of any same-venue retry.

**Evidence that would exist.**
- Rehearsal logs showing `tried: orca: its blockhash expired …` followed by a `meteora` entry under load.
- On a fork, the same outcome reproduced by dropping or delaying the swap transaction past `lastValidBlockHeight`, for example with a validator restart.

**Fix.**
- On `refused` caused by expiry-without-landing, rebuild and resend on the same venue up to N times. Re-read `market()` each time and keep the floor.
- Optionally let the judge accept exactly one `SetComputeUnitPrice` at or below a pinned cap (for example ≤ 0.00002 SOL at the 400k limit). This bounds fee drain to a known constant.
- Add an arm: the expired-then-landed retry is recorded once, never twice.

### (i) What an adversary can take within the tolerance

- **Per cycle:** at most about 150 bps against the oracle, plus the oracle's own error (two feeds, each confidence ≤ 30 bps, staleness ≤ 180 s, cherry-pick as in (b)).
- **At the ruled cap** of 40 SOL a day: about 0.6–0.9 SOL a day, or roughly $2–3k a month at full cap. That is material against royalty revenue only.
- **Meteora manipulation** needs Orca to be excluded first. That means pushing a $10M pool more than 100 bps at read time, which costs far more than the prize.
- **Operator-key worst case:** unchanged. It is cap × cooldown windows until `emergency_stop_sweep`, plus the third-party upgrade keys (limit 10(d)).
- **Ledger:** cannot read a failed cycle as closed. `cycleIsOpen` requires a split or `splitByOther`, and both are chain-anchored.

---

## R6. Gates

**Floors.** All floors are equalities, and deleting an assertion turns the build red. Empty-input checks require a non-empty match:
- the spec counts;
- the control table (at least 5 rows);
- the DAS-reader discovery;
- `ID_SITES`, where an unreadable file yields mismatched roles.

**`build-mainnet.sh`.**
- It proves key behaviour for the four programs, and byte identity of the sweep helper against both its own localnet build and `target/deploy`.
- The `target/deploy` comparison indirectly pins the toolchain, because `run-tests.sh` enforces platform-tools v1.54.

**`cron-install.sh`.**
- It arms only our tagged, uncommented, anchored lines.
- It refuses a rehearsal tree. The marker path is rewritten with `R`, so the check happens in DEST.

### INFO-C: SPEC item 53 overstates what the rehearsal patch proves

The statement is: "all five programs plus `bank/layout.mjs` were patched".
- `programs/cbob-vault-sweep/src/lib.rs` contains no program id: there is no `declare_id!`, and it uses `_program_id`.
- So nothing in it is substituted, and `rehearsal-tree.sh`'s `need` list checks only four programs plus the layout.
- Behaviour is fine: the sweep id lives in `layout.mjs` and `alarm.mjs`, and its keypair is installed. But the document claims a check that does not exist, which is the round-24 D6 class.

**Fix.** Say "four programs (the sweep helper carries no id)" in SPEC 53 and in the script header.

---

## The accepted limits: the four questions

**1. Is any limit worse than stated?** No. Limit 10's flood text and the sweep-window text are accurate after round 33. LOW-A is a new mechanism for delaying the alarm through state growth rather than through the transaction scan, and the "Scan backlog boundary" paragraph's bound does not cover it.

**2. Is anything listed that is not actually a limit?** No.

**3. Is any DISCHARGED item not actually discharged?**
- Item 54's 14-pair claim cost is still extrapolated, as it says.
- Item 51 holds.
- Nothing is mis-discharged.

**4. Is any OPEN item being treated as accepted?**
- Items 22, 38, 50, 52 and 53 remain open in substance.
- The rehearsal value set (`launch/rehearsal-init.json`) and the checker's rehearsal mode are still unbuilt.
- `charter_opens_at` and `lock_deadline` are still null.
- The holder guide is still marked DRAFT.
- I found none quietly demoted.

---

## Other observations (not findings)

- `releasedFromTx` does not count the reserve-account rent returned to the owner by the sweep helper's `CloseAccount`. The post therefore understates the SOL that left the vault. It never overstates it, so the "only real numbers" rule is not broken.
- `allSweeps` deduplicates with `findIndex`, which is O(n²). The set is small, because sweeps are cooldown-bound.

---

## Given that no human firm will see this and the programs will be immutable: what to do before launch that AI audit cannot

1. **Run the dress rehearsal (item 22) under adversarial load.** Do it on a second operator. During it:
   - spam 1-sat splits and padded transactions naming MINT;
   - force a blockhash expiry on both swap venues;
   - freeze a test cbBTC-like mint's pool account;
   - kill the crank mid-batch.

   Record every page received and the time to the human response. Only execution reveals liveness defects like LOW-A and LOW-B.
2. **Do a second-machine, second-person reproducible build.** Pin the platform-tools tarball by hash and pin `Cargo.lock`. Compare all five `dist/*.so` hashes with this box before deploy.
3. **Witness the `initialize` ceremony with a read-back.** Build the four transactions from `launch/mainnet-init.json` on an air-gapped machine. Decode each one before signing. After landing, diff every on-chain config field against the JSON before removing any upgrade authority.
4. **Hold a capped canary period while still upgradeable.** Real holders, real wallets (Phantom, Ledger, mobile), a deliberately low round cap and a short bug bounty, then lock. Immutability makes a canary the only cheap place to learn.
5. **Run an off-box watcher on a different RPC provider.** Even a minimal one (config drift, `last_sweep_at`, upgrade authorities, pool balance against `owed_scaled`) under a different Unix user and host. This addresses limit 10(3): box owner equals ledger writer equals alarm.
6. **Run long fuzzing campaigns.** Accrual, join gate, boost ring and rate ring under Trident or honggfuzz for days of CPU time. AI can write the harness but cannot supply the hours or watch for the crash.
7. **Drill the guardian on the clock.** Time from page to `emergency_stop_sweep` landing from Gary's Phantom, measured end to end. Cap × cooldown is only as good as that number.
8. **Make the open custody decisions.** The Giraffish Moments update authority through the charter window, and the $CBOB release wallet (limits 46 and 56). Both close with a single change of custody, and no audit can close them.