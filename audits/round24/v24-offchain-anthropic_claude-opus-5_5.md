# Round 24 independent audit of v6 (off-chain pipeline, MINT, launch tooling)

**What this audit could read.** The bundle contains MINT's source only. SEAL, BURN, GOV, `tests/3prog.test.ts`, `HOLDER-GUIDE.md`, `DESIGN-v6.md`, `scripts/probe-mainnet-facts.mjs` and `sim/` are not included. Nothing below certifies those files.

**Method.** No code was run. Every finding names the run or arm that would confirm or refute it.

**Result.** No CRITICAL and no HIGH. Five MEDIUM. Most findings are in round-23 repairs, or in a site next to one that a repair fixed while missing its sibling.

---

## R1. The crank (`bank/crank.mjs`)

### LOW-1. The frozen-account check reached one of three split sites. The pool and the Squads account still cause an hourly refused split.

**Construct.** `planCrank`, split block. Round 23 L9 added `revenue.frozen` handling. The other two destinations of the same `split_revenue` call are never read or checked:
- A frozen pool. `pool.frozen` gates only the distribute and claims blocks, not the split.
- A frozen or missing CBOBTC Squads cbBTC ATA. The crank never reads `bankAta`.

Limit 28 itself says a frozen Squads account halts `split_revenue`.

**Effect.** While either condition holds, every hourly pass sends a split the program refuses. That costs a fee and causes a non-benign `FAIL`, which notifies. The planner has also already added `splitToPool` into `avail`. If the pool held nothing else, the planned `distribute` then fails with `NothingToDistribute`, a second non-benign page every hour. The same happens before road step 10 creates the pool and Squads ATAs (item 52).

**Evidence.**
- `planCrank({..., pool:{state:'ok',amount:0n,frozen:true}, revenue:{state:'ok',amount:1000n,frozen:false}})` returns `split: true`.
- On chain the Token `Transfer` into a frozen account fails, so the transaction is refused.

**Fix.**
- Read the Squads ATA's state.
- Plan the split only if all three accounts are `ok` and unfrozen.
- Report the reason as a problem.
- Add arms for a frozen pool and a frozen or absent Squads ATA, each giving no split and one problem.

### LOW-2. `BENIGN` is missing `NothingToSplit`.

**Construct.** `split_revenue` is permissionless:
- `revenue.mjs` splits at :41 every 6 hours.
- The crank pass at :37 can still be running then.
- Any third party may split at any time.

A split landing between the crank's plan and its send makes the crank's split fail `NothingToSplit`, which is not in the regex. The result is a false "crank: 1 action(s) failed" page, which is exactly the class L1 claimed to close.

**Evidence.** `CR.BENIGN.test('Error Code: NothingToSplit')` returns `false`. The L1 selftest arm's list omits it.

**Fix.** Add `NothingToSplit` to `BENIGN` and to the arm. Leave `NothingToDistribute` non-benign: it can only follow from a planner error, since a racing distribution yields `MonthNotElapsed`.

### LOW-3. A reveal whose asset reads as `'other'` is sent with an empty attribute list.

**Construct.** In `main()`'s reveal loop, `list = []` unless `assets[r.asset] === 'live'`. A transient null RPC answer (`'other'`) for a live asset therefore sends `reveal_level([])`. The program then:
- finds the asset not burned,
- requires an AssetV1,
- refuses with `AttributesMismatch`.

That error is non-benign, so it pages and breaks the lane. L2 fixed `'other'` for joins and payments. This is the same shape at a third site.

**Fix.** Send an empty list only when the asset reads `'burned'`. For `'other'`, skip with a log and `break`.

### INFO-1. The crank's clock is the box clock, not the chain clock.

`due` uses `Date.now()`. If the chain's `unix_timestamp` trails the box, the crank's distribute gets `MonthNotElapsed` (benign). Every post-distribution plan (joins, post-expiries, claims at the new accumulator) is then sent against a distribution that did not happen. Nothing breaks, because each is skipped on chain, but those fees are wasted.

Fix: read the `Clock` sysvar's `unix_timestamp` and plan against it.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### MEDIUM-1. The round-23 L11 suppression turns a one-pass null read into a silent re-baseline of fixed-forever values and program bytes.

**Construct.** `detectConfigDrift` skips key `k` whenever `prev[k]` is null and `prev[missingFlagOf(k)] === true`. The `_missing` flag is set by `readConfigs` whenever `getAccountInfo` returns null. As `alarm.mjs` itself notes, "not initialised" and "the RPC did not answer" are the same null.

**Sequence.**
1. Pass N: BURN's config, or `prog.mint`'s ProgramData, reads null. Drift pages `X -> null`, which a human reads as an RPC blip. `missingWatchedKeys` exempts the program. The report is delivered and the state advances with `burn._missing: true` and no `burn.*` values.
2. Pass N+1: the account reads with a different value (`burn.redeem_window_secs`, `gov.quorum_bps`, or `prog.mint.hash` after an upgrade). L11 suppresses it as "a program appearing". The actual change is never reported as a change.

`config_vanished`, the guard against "a config cannot un-exist", exists only for MINT. SEAL, BURN, GOV and the four `prog.*` ProgramData reads have no equivalent. Core is protected only because it writes `NO_PROGRAMDATA` as a value.

**Evidence.**
- `detectConfigDrift({'prog.mint._missing': true}, {'prog.mint.hash': 'new'})` returns `[]`, regardless of a prior `'old'`.
- This is the round-23 L11 arm, which was proven only for a snapshot that had never held a value.

**Fix.**
- Suppress only for keys that have never held a non-null value. Keep an `everSeen` set or a `lastNonNull` map in state.
- Compare against the last non-null value.
- Mirror `config_vanished` for SEAL, BURN, GOV and each `prog.*`: "previously read, now absent", with the state not advanced.
- Add the arm: old, then a missing pass, then new, must produce CRITICAL.

### MEDIUM-2. The crank heartbeat (round-23 M3) measures liveness, not delivery. The armed-since clock also resets on a failed read.

**First construct.** The crank stamps `.crank-heartbeat` after every LIVE full pass "whatever its individual failures". `parseCrankHeartbeat` keeps only `atSec` and discards `failures`. A crank that runs every hour while every claim batch fails therefore keeps a fresh heartbeat. Causes include a planner/program disagreement that is not benign, or every send failing on an empty key mid-pass. `crank_silent` never fires.

The only signal left is the crank's own `NOTIFY`, which is the "actor as sole watcher of its own failure" shape this codebase removed elsewhere. M3's stated purpose, "owed shares growing with nobody delivering them", is still unseen by the alarm.

**Second construct.** `crankLive` is `false` if `execFileSync('crontab', ['-l'])` throws (fail-open). When it is false, `crankArmedSince` becomes `null`. On the next successful read it restarts at `nowSec`. Because `detectCrankSilent` uses `max(stamp, armedSince)`, one failed `crontab -l` every three hours hides a crank whose last stamp is 50 hours old. This is the same "a failed read resets the clock" defect that L10 fixed for revenue.

**Evidence.**
- `detectCrankSilent({stampSec: now - 50*H, live: true, armedSinceSec: now - 60, nowSec: now})` returns `[]`.
- A heartbeat of `{"atSec": now, "failures": 150}` parses to a fresh stamp.

**Fix.**
- Page HIGH when the heartbeat shows `failures > 0` on K consecutive passes. This needs the alarm to remember the last few stamps.
- Independently, page when `owed_scaled` has not fallen across 6 hours while `total_active_weight > 0` and the pool can pay a whole sat to someone. That is a delivery detector that does not trust the crank's testimony.
- Treat a failed `crontab -l` as unreadable, which pages, and keep the previous `crankArmedSince`.

### MEDIUM-3. Custody of the whole $CBOB supply (limit 56) is "pinned" in a JSON file, and nothing watches the wallet on chain.

**Construct.** Limit 56 lists its control as `cbob_release_wallet` in `mainnet-init.json`, refused by `check-launch-params` if it changes. That checks a file before launch. No detector reads the release wallet's $CBOB balance, and `CBOB_BOOSTED` is not parsed by `parseCbobLogs`.

**Effect.** A theft of `bank/keys/cbob-release.json`, from the box or from the R2 backup, followed by a transfer of the 2.1B supply, is silent. So is later boost-burning once a vote turns boosts on.

**Evidence.** `grep -n AT2qf412 bank/alarm.mjs bank/detectors.mjs` finds the constant only in the launch gate.

**Fix.** Each pass, read the release wallet's $CBOB ATA. Page CRITICAL on any decrease not matched by a ledgered release. Parse `CBOB_BOOSTED` and page on boosts whose burner is the release wallet.

### LOW-4. Several standing conditions page every pass for ever, and none can be acked.

`vault_account_frozen` (HIGH), `pool_frozen` (CRITICAL, `urgent` every pass) and `revenue_account_frozen` (HIGH) each describe a state "nothing on Solana can undo". None is in `ACKABLE_KINDS`, which contradicts the file's own rule that a finding with no way to be answered is one that gets ignored.

Fix: page on the transition, and keep the standing state at INFO, as `detectBrakeTransitions` already does for the brakes.

### LOW-5. `index_disagrees_with_chain` can fire on routine sale traffic.

`readConfigs` reads `minted_total` first. `listVaults` hits DAS several RPC round-trips later. A mint landing in between, or DAS indexing lag after a mint just before, produces "more assets than mints, not ours" or "index incomplete" at CRITICAL. The likelihood rises during the charter window rush.

Fix: re-read `minted_total` after the DAS walk. Page only if the count disagrees with both reads, or on two consecutive passes.

### LOW-6. A forfeit of a holder's credited share is never paged individually.

`retire` logs `CBOB_REDEEMED_POOL_FROZEN asset=… forfeited_sats=…`. `parseCbobLogs` only knows REDEEMED, DISTRIBUTED, REVEAL_RESCHEDULED and CLAIM_DEFERRED_FROZEN, so the line is dropped. `pool_frozen` pages, but the per-holder loss that limit 28 tells holders about has no record off chain.

---

## R3. The layouts (`bank/layout.mjs`, selftest)

The parity check against `pub struct` is real and strict. I recomputed two values:
- The VaultRecord space is 221, matching SPEC.
- The `bare_burns_retired` offset is 454, matching GOV's pin.

### LOW-7. The arm "its fixed part is the length the program allocates before padding" cannot fail.

It compares `L.encode(...).length` with `L.fixedLength(...)`, and both are derived from the same JS field list. Neither `MINT_CONFIG_SPACE` nor `VAULT_RECORD_SPACE` is scraped. An undersized space constant would surface only as an `initialize` or `mint_vault` failure in the suite.

Fix: scrape both constants, evaluate them, and assert `== fixedLength + padding`.

---

## R4. Money arithmetic (`bank/accrual.mjs` vs MINT)

I found no divergence:
- `pendingScaled` matches `owed_of`, with carry added before debt.
- `credit`, `available` and `ceilSats` match.
- The crank's three owed branches are algebraically equal to MINT's `join`, `expire_boost` followed by `credit`, and plain `credit`:
  - `joinedNow`: debt equals weight times the old accumulator.
  - `preExpired`: carry at expiry plus level weight times Δacc.
  - Live boost: `(w+b)·acc + carry − debt`.
- `retiringWeight` uses `wOf`, including the boost, which matches `retire`, `unschedule_boost` and `weight_of`.

---

## R4c. Round-23 repairs, one by one

| Repair | Verdict |
|---|---|
| M1 `detectRevenueAccount` | Correct for the stated case: a split moves the whole balance. |
| L10, unreadable revenue account keeps the clock | Correct. The same defect survives in `crankArmedSince` (MEDIUM-2). |
| L9, frozen revenue account | Fixed for the revenue account only. The pool and Squads sites are not (LOW-1, LOW-12). |
| M2 `judgeRevealAttrs` | Correct. The "tampered list plus `level`" arm is a real arm. |
| M3 heartbeat / `detectCrankSilent` | Incomplete (MEDIUM-2). |
| M4 `detectUnsweptRoyalties` | Correct. When the brake is released, a stale `since` pages immediately. That is the loud direction, so acceptable. |
| L1 `BENIGN` | Misses `NothingToSplit` (LOW-2). |
| L2 live-only joins and payments | Correct for joins and payments. Missed for reveals (LOW-3). |
| L3 tick minus this pass's retirements | Correct. |
| L4 `plan.owed` | Now asserts sats. |
| L5, wiring derived from `detect*` exports | A regex hit on `D.name(`. It proves the name is called somewhere, not that it is called with the right inputs. Acceptable. |
| L7, L8, L13, L17, launch pins | Correct. `lock_deadline` must be before `charter_opens_at`, but the "24 h before it" stated in road step 6 is not enforced. Add `opens − deadline ≥ 86400`. |
| L11 drift suppression | Introduces MEDIUM-1. |
| L12 `lockDeadlineOf` | Correct. |
| L14 plan-sized fee floor, daily warn | Correct. |
| L15 liveness before age | Correct as read. A live pid with an unrecorded start still waits, then refuses (`aliveHolder`). That is the safe direction. |
| L16 split anchoring by total | Correct. It depends on `returnedAt` being within 60 s of the landing, which holds because it is stamped right after confirm. |

---

## R4b. Boost off chain, and the $CBOB creation

- **Post-distribution expiry.** It is planned only for `boost_end_epoch == dist_epoch+1`. That is correct when the crank's own distribution lands.
- **Distribution run by someone else.** If another host's in-line monthly run is what advances the epoch (INFO-1, or an `activate` landing first), the crank still sends its planned post-expiries.
  - Those boosts become due. Of them, a vault owed less than 1 sat is not in any claim batch.
  - Such a boost stays due, blocking the in-line monthly run until the next pass's pre-expiry.
  - Self-healing within an hour. INFO.
- **`create-cbob-token.mjs`.** Creation is atomic, the metadata is written before the mint-authority revoke, the freeze authority is null, and the full mint happens before the revoke in the same transaction. The mainnet read-back reports both authorities None. I see no path to a live mint authority, a freeze authority or a partial supply.

---

## R5. The swap hop (`bank/revenue.mjs`)

### LOW-8. The sweep starts without checking that the cbBTC side can land.

`revenue.mjs` checks the brake, the cooldown, open cycles and the operator float. It never checks:
- whether the revenue cbBTC ATA is frozen, which makes the return fail;
- whether the pool or Squads ATA is frozen or absent, which makes the split fail.

Either way it sweeps, swaps, and then strands cbBTC on the operator, or leaves an open cycle that wedges every later run. That is the correct (open) direction in the ledger, but it is avoidable.

Fix: read the three accounts before the sweep, and refuse while any is not `ok`/unfrozen.

### INFO-2. The output checks are all against the same untrusted source.

`priceImpactPct`, the drift between the two quotes, `otherAmountThreshold` and `short_swap_return` all come from Jupiter. A party controlling Jupiter's responses (limit 10) controls every one of those numbers, so `short_swap_return` cannot detect it. The loss bound in limit 10 still holds (one cycle's funds), but the limit should say the return checks give no protection against that party.

An independent oracle read, such as a Pyth SOL/BTC price, would close the detection half.

### INFO-3. The Jupiter endpoint is unverified.

`quote-api.jup.ag/v6` is hard-coded. I believe Jupiter has migrated its public API hosts, but I cannot verify that from here. A dead endpoint fails before the sweep (safe). The dress rehearsal must exercise the live endpoint.

---

## R6. The gates

### LOW-9. The host unit-test floor does not match the visible tests, and it is not covered by the stated-count gate.

- `HOST_FLOOR=5` with an equality check.
- The bundled `mod host_tests` contains four `#[test]` functions:
  1. `the_lookup_takes_the_smallest_produced_slot_in_the_window`
  2. `a_full_buffer_reads_and_malformed_ones_are_refused`
  3. `capture_skips_at_a_b_and_c_and_matches_the_model`
  4. `the_boost_ring_wraps_exactly_against_a_model`

If the bundle is the whole file, `run-tests.sh` dies at "host unit tests: 4 assertions, floor is 5". If the runner is green, there is a fifth test no auditor was shown, which is a coverage gap. Settle it with `cargo test -p cbob-vault-mint --features localnet --lib`: the output will read either `4 passed` or `5 passed`.

Separately, the selftest's `RX` table has no `host` entry, and SPEC's "Running the tests" never states the host count. This is the round-22 G3 class: a new floor added without joining the every-occurrence gate.

### LOW-10. Two crank-related arms are tautologies.

- `attrsHash is sha256 of exactly those bytes` recomputes the same expression.
- The `readySlot` arm re-implements the same formula with scraped constants. That catches a constant drift but not a formula error.

The Borsh hex arm above them is the real one.

---

## The four questions about the accepted limits

### 1. Worse than stated

- **Limit 55.** The quoted cost of 200 $GARY is an upper bound. When the free month is due, the first of the two distributions can be the free in-line run, so the edge costs 100 $GARY plus a funded vault.
- **Limit 7.** "Survivable rather than silent" is still untrue for a crank that runs and fails (MEDIUM-2).
- **Limit 56.** The custody risk is not merely accepted but undetected (MEDIUM-3).
- **Limit 10.** The stated bound holds, but the detection half (`short_swap_return`) is void against the same trusted party (INFO-2).

### 2. Listed as a limit, not actually one

None found.

### 3. Discharged, not discharged

- **Item 12/17.** It now carries its own exception ("not in general", item 54). It is discharged only for the padded-mint path, and should be retitled as such.
- **Item 33 and the notice.** Discharged by a 60 s value, while the 7-day path is "the same arithmetic". That is acceptable, but it is the same reasoning-not-measurement pattern SPEC rejected for item 31.

### 4. OPEN AND BLOCKING items quietly treated as accepted

- **Item 51.** It sits under OPEN AND BLOCKING, but its text says "DECIDED AND BUILT" and includes "Boost timing (accepted, disclosed)". Accepted content inside a blocking item breaks the "exactly one of three states" rule.
- **Item 53.** It is marked "ADDRESSED" while still listed as blocking.
- **Item 54.** It is an instruction to holder pages, not a blocking defect.

Reclassify each. Leave items 22, 38, 50 and 52 as the blocking list.

### MEDIUM-4. Item 53's claim that "the ids are the whole patch" does not hold for a dress rehearsal that exercises item 22.

**Construct.** `alarm.mjs` calls `detectStandingRisks(cfg, { production: true })` unconditionally. Several ruled values make a rehearsal at those values untestable in reasonable time, or destructive:
- `monthly_secs` is 30 days, so the free monthly distribution cannot be exercised in a rehearsal of days.
- `charter_secs` is 7 days, and GOV refuses all proposals until the charter closes.
- The real `pob_root` means a rehearsal charter claim **burns a real Proof of Burn**. Its address can never be re-minted (measured fact 7), so that holder permanently loses their real charter claim.

The alternatives each break a stated property:
- Using a rehearsal root makes the alarm page `test_value_in_production` CRITICAL every pass, and `check-launch-params` refuses.
- Shortening values makes the rehearsal run code paths differently from launch.

Either way the rehearsal cannot run the shipped off-chain code unchanged at a fidelity that exercises item 22's claims.

**Fix.**
- Write a rehearsal value set before the rehearsal: which values, which paths each can and cannot exercise, and an explicit "never use the real `pob_root`".
- Pass `production` from configuration that the rehearsal patch changes, and add it to `rehearsal-tree.sh`'s recorded substitutions.

### MEDIUM-5. SEAL, BURN, GOV, the suite and the holder guide are outside this round.

**Construct.** The brief says "every line of the four programs is new to you". Only MINT is bundled. Round 23's verdict says GOV, the tests and `HOLDER-GUIDE.md` changed during that triage.

**Effect.** The redemption pairing, the emptiness proof, the rate ring and GOV's execute-with-skips are all permanent at launch and unread here. So is the holder-guide-versus-code comparison the brief asks for.

**Evidence.** `scripts/audit-coverage.sh` over this round's prompt should report those files as undelivered. If it does not, the coverage script is not measuring delivery.

---

## Before launch: what AI audit structurally cannot do

1. **Run everything on independent infrastructure.** A different person on a fresh machine checks out the tagged commit and runs `run-tests.sh` with `CBOB_SHIP_GATE=1`, plus `sim/run-sim.sh`. Publish the raw logs and every floor line. Every number in this audit was taken on trust.
2. **Reproduce the build verifiably.** Use `solana-verify` or an equivalent from a clean container. Two independent people obtain the same sha256 as `build-mainnet.sh`, and the on-chain ProgramData hash is compared after deploy.
3. **Fuzz MINT against a model in Rust, on the host.** Use proptest across `activate`, `join`, `distribute`, `claim`, `boost`, `expire`, `retire` and `tick` sequences. Invariants:
   - the pool covers what is owed;
   - the sum of payouts never exceeds what was distributed;
   - `boosts_due` plus the ring equals `boosts_active`;
   - `pending_count` arithmetic is consistent.

   Run it for hours, not 60k cases. Round 23's JS differential was a transcription by the same hands.
4. **Rehearse at scale with fault injection.** Use 2,100 synthetic vaults at throwaway ids. Inject RPC null answers, 429s and a mid-run kill of the crank and the alarm. Confirm that `crank_silent`, the drift watch (MEDIUM-1) and `reveal_queue_stalled` fire, and that nothing double-sends. Run the alarm against two RPC providers and diff their snapshots.
5. **Measure the open facts on mainnet.**
   - A17: DAS's `burnt` flag on a burned Core asset.
   - The Jupiter endpoint's liveness.
   - That a Core asset burned on mainnet leaves the 1-byte tombstone the program's `is_burned` expects. Test this on a throwaway collection, never on real Proof of Burns.
6. **Run a key ceremony.**
   - Move the $CBOB supply off the box to a hardware-held wallet or Squads.
   - Delete the box key and the R2 backup copy.
   - Fund the swap operator with only the float.
   - Record each step with on-chain evidence.
7. **Do a human read of the holder-facing copy against the code**, and build and test the redeem page before step 11, as SPEC already requires.
8. **Run a public bounty window between the rehearsal and step 11,** while the upgrade authority still exists. Make the rehearsal deployment and source public with a stated payout. This is the one adversarial review that executes code, and it is the last moment a fix is possible.