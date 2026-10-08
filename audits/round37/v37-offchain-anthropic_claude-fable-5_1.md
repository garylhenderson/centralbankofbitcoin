# Round 37, OFF-CHAIN pass — independent audit of `0ae07d2`

**Headline:** no CRITICAL, no HIGH, no MEDIUM. Three LOW and four INFO survive measurement-by-reading; every one names the evidence that would exist if it is right. One of the LOWs is a correction to round 36's own verdict (its C08 refutation rests on a false premise and would, if its recommended gate were written, pin the wrong behaviour). Nothing I found moves value anywhere the program does not already pin, and nothing I found makes the alarm quiet on a money-losing state.

Severity calibration, stated up front so it can be checked: I did not run a validator or any job. Where a claim rests on source alone I say so. Every finding below is the kind that can be refuted by one measured run; I give the run.

---

## R0. Round 36's verdict and repairs

**Repairs present in this tree, verified against the files:**
- L4: `ACKABLE_KINDS = new Set(['unredeemable_owner'])`; selftest arm "R36: nested_vault can NO LONGER be acked" refuses both kinds and still accepts `unredeemable_owner`. ✓
- L3: `unredeemable_owner` text names the host-owner execute and `rescue_nested`, no "sealed for good"; arm "R36 L3" pins it. ✓
- L1/L2/L5: SPEC's C5 bullet ("The sweep helper cannot handle it at all, because it always closes what it sweeps"), limit 44's heading, item 58's destination and the index-lag text ("pages once … followed by an ALL CLEAR") are all as the verdict required. ✓
- C06: selftest arm compiles `revenue.mjs`'s own sweep statement; the operator is fee payer and sole signer. Correct reasoning: web3.js sets `feePayer` to the first signer and `compileMessage` marks it a signer in the header; an instruction's `isSigner:false` on that key is irrelevant. ✓
- C07: Anchor 0.31's `declare_id!` emits `#[test] fn test_id()`, so six is the right floor; `run-tests.sh` now carries the comment. ✓

**Re-tested rejections:** C09 (a dry run writes chain-proven recoveries — accurate, not a defect), C12 (Meteora `host_fee_in` comes out of the protocol-fee share, not the user's output; the floor is pinned anyway), C17 (payouts travel with a rescued vault), C25 (the vault collection's update authority can move only through MINT bytes, which are watched) all hold.

### R0-1 — LOW: the verdict's C08 refutation rests on a false statement about `claim`, and the crank withholds a tick the program accepts

**Construct.** `audits/round36/VERDICT-offchain.md` C08: *"Joining is a `claim`, and 'a frozen pool refuses every `claim`' (MINT 1787), so a tick would only create eligible vaults that cannot join."* That is false. `claim` with join-only pairs performs no token `Transfer` and never reads the pool's state byte: `monthly_inline` returns before the frozen check when `waiting_to_join > 0` or declines quietly, and the pair loop for a `pending` record is `join(...)` then `continue`. SPEC limit 28 says exactly this ("a join goes through only in a claim that pays nothing (the crank sends join-only batches)"), and the crank's own `preJoins` are sent during a freeze. The program's `distribute` w==0 tick path reads the pool with `read_token` and never checks `TOKEN_STATE_FROZEN`; `monthly_inline` ticks before it looks at the freeze. So the program accepts the launch tick during a freeze; only `bank/crank.mjs planCrank` refuses it (`joinable && poolOk && !pool.frozen && due && w === 0n && waitingThisEpoch`).

**What is lost.** During a pool freeze in the w==0 phase with no traffic, the crank joins nothing new (none eligible), ticks nothing, and `launch_tick_overdue` pages CRITICAL (true). Because `tick` stamps `last_distribute_at`, a withheld tick shifts the first free crediting distribution by the length of the freeze (tick at day 2 → first credit due day 32; tick at thaw day 10 → day 40). A 100 $GARY burn after the join can credit earlier, so this is a delay, not a loss.

**Evidence if I am right.** `planCrank({ cfg: { ...cfg0, monthly_secs: 100n, pending_count: 1n, pending_this_epoch: 1n }, records: [rec(0, { level: 1, pending: true, request_epoch: 0n })], pool: { state: 'ok', amount: 0n, frozen: true }, nowSec: 100 }).distribute === false`, while on a validator `distribute(false)` with `total_active_weight == 0`, `pending_this_epoch > 0`, a due month and the pool's cbBTC account FROZEN lands and logs `CBOB_EPOCH_TICK`.

**Fix.** Drop `!pool.frozen` from the tick branch only (keep it on the credit branch, where the in-line run also declines), or document the choice in SPEC 28 and the crank header. Either way, do NOT write the gate the verdict recommended ("no tick, and the problem named"): it would pin the inconsistency. Write the arm for whichever behaviour is chosen.

---

## R1. The crank

Checked against MINT: every instruction's account list and discriminator (reschedule, capture, reveal, retire_burned, claim/join with crank_n=0, expire_boosts, split_revenue, distribute(false), activate) matches the `#[derive(Accounts)]` order; `attrsBorsh` is the Borsh `Vec<VaultAttribute>` the program hashes (u32 count, u32-prefixed key and value); `readySlot` is two `LEADER_GROUP_SLOTS × ENTROPY_GROUP_STRIDE` strides; the denominator `w = total_active_weight + preJoinWeight − retiringWeight − expiringWeight` is what the program will hold after retire, pre-join and pre-expire land in that order; `owedAfterRetire` frees the retiring vault's pending share as `retire` does; the post-join `owed` is `w·Δacc`; the pre-expired `owed` is `carry' + w_level·Δacc`, identical to `expire_boost`→`reweigh` then `owed_of`. Reveals run strictly from `revealed_total` and stop at the first not-ready, skipped, mismatched or refused record. A positively burned vault is never joined, paid or activated and is retired first. The fee payer signs only as payer. I found no plan the program refuses except the race cases already classified benign, and the one withheld-but-accepted tick in R0-1.

Two residues, both already stated: a distribution planned on `pool.amount + splitToPool` where the split is then blocked between plan and send pages one false "action failed" (`NothingToDistribute`, epoch unmoved → `fail`); and `REVEAL_RENT_LAMPORTS` budgets 6,960 lamports/byte (the test validator's) against mainnet's 5,080, which is conservative.

No new finding.

---

## R2. The alarm

Fixed-forever values (collections, reserve set, GOV PDA, pool, treasury, split, supply, census, PoB root/collection, charter window, periods, notice, the three tighten bounds, `cbob_mint` and both boost bounds, GOV's three numbers) drift CRITICAL; pending guardian/operator and their timestamps drift CRITICAL and re-assert as `swap_operator_armed`/`guardian_armed`; the PoB collection's plugin region and update authority are watched; `redemptions_near_cap`, `pool_frozen`, `pool_insolvent`, `distribution_overdue`, `boosts_stalled`, `joins_stalled`, `launch_tick_overdue`; and all FIVE programs' upgrade authority and bytes (`prog.sweep.*` included) are watched and judged past the lock date. The production list asserts 2,100 / 5,100 / 259,200, 604,800, 1 SOL / 86,400 / 0.1 SOL, 2,592,000 and 3,600.

**Dangerous state read as quiet:** none found that is not already an accepted limit (the operator key's own balances, a thief's sweep masked by a later honest one while the alarm is down, per-asset PoB plugins, a foreign nested asset). **Routine state paged every pass:** none beyond the level kinds SPEC already names (`vault_awaiting_return`, `lock_deadline_unset` while the placeholder stands, `log_coverage_gap`), each on its own stream.

### R2-1 — INFO: two detectors disagree about an honest sweep whose status lookup failed

`detectUnledgeredSweeps` matches rows by `sweepSig` only. A cycle whose sweep landed but whose `classifySendFailure` returned `unknown` (status lookup threw) carries `pendingSweepSig` and no `sweepSig`; the walk pages `unledgered_sweep` CRITICAL after 15 minutes, while `detectSweepState` accepts the same row via `landed`. The row is open and already needs a human, so the direction is loud, not silent. Evidence: a ledger row `{intendedLamports, pendingSweepSig}` with no `sweepSig`, and an `unledgered_sweep` for that signature in the same pass's report. Fix (optional): let `byS` also index `pendingSweepSig` when the caller's direct lookup confirms it landed, as `detectSweepState` does.

---

## R3. The layouts

`STRUCTS` match the five Rust structs field for field (I recomputed MintConfig: `governance` 41, `minted_total` 141, `bare_burns_retired` 454; VaultRecord `level` at 57, which is what the fast lane's memcmp uses). The selftest parses the real `pub struct` text with a strict parser that throws on any non-`pub name: Type,` line, compares every `OFF_*` constant any program pins, every `*_VERSION`, `BOOST_RING`, `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` less padding, and (round 24 D6) every seed in `SEEDS` against its program's `*_SEED` constant, with a mistyped and an unmapped seed shown to fail. A struct change not mirrored here is red; a mirrored change without a version bump is red through the version arms. `RESCUE_SEED` is not in `SEEDS` and nothing off chain derives it (verdict C15 holds).

No finding.

---

## R4. The money arithmetic

`credit`, `pendingScaled` (= `owed_of`: `(w+boost)·acc + carry − debt`), `ceilSats`, `available`, `reweigh` and `debtAtActivation` are the Rust line for line; the crank expires every DUE boost before its distribute and every boost its own distribute makes due right after (`postExpires`: `boost_end_epoch === dist_epoch + 1`); a burned boosted vault is retired, never expired, which is what `retire`→`unschedule_boost` does. The alarm pages `boosts_stalled` and treats `cbob_mint`, `max_boost_weight`, `max_boost_epochs` as CRITICAL drift.

No divergence found.

---

## R5. The swap and the revenue cycle

**(a)** `sats = lamports·sol·10^(es−eb) / (10·btc)` is the right identity (I derived it independently); both exponent signs handled; integer floor division then `×9850/10000` floor, so the floor rounds against us, never for us. `satsPerLamport` converts prices ≤ ~1e13 to Number, far inside 2^53. **(b)** `PriceUpdateV2` offsets recomputed: level at 40, feed 41..73, price 73, conf 81, expo 89, publish_time 93 — correct; Partial is tag 0 + u8 and is refused. A stranger cannot write into the sponsored account: the receiver requires its `write_authority` (the push oracle's PDA), and the push oracle refuses a `publish_time` not strictly newer and a VAA not guardian-signed. The clock is the Clock sysvar from the same RPC read (trust (b) in limit 10). **(c)** `orcaSpot` is `(sqrt_price/2^64)^2` = B-raw per A-raw = sats per lamport; `meteoraSpot` is `1/(1+bs/1e4)^id` with X=cbBTC, Y=wSOL, the inverse of Y-raw per X-raw; the fork's SW.0 confirms both are within the gate against the same oracle, so the units are right. Floating point can mis-sort a pool within ~1e-12 of the 100 bps edge, which is not a security property. **(d)** `other_amount_threshold` (exact-input, token B raw) and `min_amount_out` (token-out raw) both carry `minSats` from the same `oracleFloor`. **(e)** The judge pins the exact seven-instruction sequence, both ATA creations for `(owner, ata(mint,owner), owner, mint)`, the wrap's destination and amount, the swap's amount, floor, Orca direction and limit, the input and output slots, the signer slot, and the single close; refuses any priority fee, a second signer, any Token instruction but SyncNative/Close. What it cannot catch is a tamper of the file tree itself (limit 10(c)). **(f)** Tick arrays `floor(tick/span)·span, −span, −2·span` with `floor` for negative ticks, seeds `["tick_array", pool, String(start)]`, oracle `["oracle", pool]`; bin arrays `[i, i+1, i+2]` with floor for negative ids, seeds `["bin_array", pool, i64 LE]`, bitmap and oracle and `__event_authority` PDAs, account order equal to the IDL. An uninitialised tick array or an exhausted sequence is a program refusal → Meteora. **(g)** A pre-existing wSOL balance is closed back to the operator; exact input leaves no wrapped residue on success; a partial fill is impossible under Whirlpool exact-input (it errors). **(h)** Preflight refusal, landed-and-failed, and expired-and-absent are the only paths that try the next venue; `unknown` records a `pending*Sig` and throws; the ledger closes only on a confirmed return plus a chain-anchored split. **(i)** Bound: output floor 150 bps below oracle, oracle confidence ≤ 30 bps per feed, age ≤ 180 s; worst extractable per cycle ≈ 1.5–2.1 % of the swept SOL (0.15–0.21 SOL at the 10 SOL cap), ≈ 0.6–0.85 SOL/day at saturation, ≈ 18–25 SOL/month only if royalties reach ~40 SOL/day; at realistic volumes it is that percentage of royalty revenue, which the guide already states as "up to 1.5 % … further if Pyth's own price is off". The Meteora pool being thinner changes impact, not the floor.

### R5-1 — LOW: one stale account read after a landed swap parks the cycle for hand recovery

**Construct.** `bank/revenue.mjs`, stage `return`: `after = requireTokenAmount(await conn.getAccountInfo(opAta, 'confirmed'))` once, immediately after `sendAndConfirmTransaction` returns; `if (delta < guaranteed) throw`. A load-balanced RPC answering from a node a slot behind reads the pre-swap balance, `delta = 0`, and the cycle is left with `swapSig` set and no `returnedSats`: open, refused at the guard forever, `unreconciled_swap` CRITICAL after an hour, hand recovery per the runbook. No money is lost (the cbBTC is on the operator key), but an honest cycle becomes a human event. **Evidence:** a ledger row with `swapSig` and no `returnedSats`, the log line "the swap credited 0 sats to the operator (balance X -> X)", and the explorer showing the swap landed with the cbBTC credited. **Fix:** re-read the operator ATA up to N times with a short delay (or at `finalized` after a `confirmed` success) before judging the delta; a post-swap balance can only rise.

### R5-2 — INFO: the honest sweep cadence is 7 hours, not 6, so limit 10's "about 40 SOL a day" is about 34

`last_sweep_at` is the chain time the sweep lands (seconds after the :41 run starts); the next five hourly runs skip and the sixth, at :41:0x six hours later, reads `chainNow` a second or two before `last + 21600` and skips too; the seventh sweeps. The alarm's grace (24 h) tolerates it. Evidence: consecutive ledger `startedAt` values 7 h apart under a saturated backlog. Fix: none needed; correct the number in limit 10, or run the revenue cron at `41,46 * * * *`.

**Accepted-limit check on the cycle:** the ledger cannot read a failed cycle as closed (`cycleIsOpen` needs `returnedSats > 0` and a `splitSig`/`splitByOther`; a refused row is closed only with no sweep, and a refused row carrying one is itself CRITICAL). The operator key's worst case is limit 10's cap × windows until `emergency_stop_sweep`, unchanged; what it now trusts is the two pool programs, Pyth, the one RPC and the integrity of two files on the box.

---

## R6. The gates

Every floor is an equality; a failing sub-suite exits non-zero before its floor is read, so a numerator-only read cannot pass a partial run; `CBOB_TEST_FILE` and `CBOB_CACHE` overrides are refused; the Core hash is hard-coded; the ship-gate run may not skip the mainnet probe or the fork. `build-mainnet.sh` asks all four keyed artifacts (mainnet REJECTS, localnet ACCEPTS), refuses a dirty tree, and proves the sweep helper's mainnet bytes equal both the localnet rebuild and `target/deploy`, the file the suite deployed — which is all that can be proven of a program with no key. `cron-install.sh` arms nothing new: `--live` survives only on our tagged, uncommented, job-specific line, the rehearsal marker refuses installation, and the deadman uses `test(1)`/`find(1)` only. The selftest's round-24 arms are armed both ways for every pure detector; what follows is the one class that is not.

### R6-1 — INFO: the wiring gate covers `detect*` exports only; the post-passes and the readers that feed pinned calls are covered by presence-only text arms or not at all

`V6_WIRED` is derived from `/^detect/` plus `parseCbobLogs`. `correlateBurns`, `applyAcks`, `applyFrozenTransitions`, `rememberRedemptions`, `poolAvailable`, `judgeReserveRead`, `readCrankBeat`, `crankPosture`, `carryConfigBaseline` are checked, where at all, by regexes that confirm a call string is present (e.g. `/D\.judgeReserveRead\(prev\?\.balances\?\.\[l\.key\], r\)/`), not that its result is consumed; and the I4 arm pins each detector's argument list but not the definitions of the variables in it (`const poolAvail = …`). Every omission I traced fails in the loud direction (every redemption pages CRITICAL, every freeze pages every pass) except `poolAvail`: redefining it to `null` silences `distribution_overdue` and passes every gate. This is a regression-net gap, not an exploit (whoever edits the alarm's source is the box owner, limit 10(3)). Evidence: `sed -i 's/const poolAvail = pool?.state === .*/const poolAvail = null/' bank/alarm.mjs && node bank/selftest.mjs` exits 0. Fix: extend `consumed()` to the named post-passes and readers, and add `poolAvail` to the I4 pins.

---

## The four questions about the accepted limits

**1. Worse than stated?**
- Limit 10, throughput: ~34 SOL/day in practice, not "about 40" (R5-2). Worse by one sweep in seven; not exploitable.
- Limit 28: the sentence "a join goes through only in a claim that pays nothing" is TRUE, and it is round 36's verdict, not SPEC, that contradicts it (R0-1). SPEC should add that the crank withholds the free launch tick during a freeze though the program accepts it (or the crank should stop withholding it).
- Limit 7's "its failures page from the crank itself" and limit 25's `reveal_queue_stalled` hold as written.

**2. Not actually a limit / already closed?** None found. Limit 8 (walk later than the DAS diff) is unchanged; `rememberRedemptions` closes only the mirror case (walk earlier), which SPEC does not claim as a limit.

**3. DISCHARGED not discharged?** None. Item 51's off-chain mirrors are real (R4). Item 54's "about 60,000 CU per 14-vault batch" remains an extrapolation, which it says.

**4. OPEN AND BLOCKING quietly accepted?** None. Items 22, 38, 50, 52, 53 are still described as open in the control table, item 50's row says "Nothing runs it in production today", and item 53's rehearsal value set is still named as not built.

---

## Anything else

- **HOLDER-GUIDE vs code:** every money and rights sentence I checked is true of the code except those that depend on item 50 (the redeem page, the public post), which the guide's DRAFT banner and SPEC already fence. The guide's "could keep up to 10 SOL of royalty money every 6 hours" is the thief's bound (the program's), not the honest cadence (R5-2), and is correct as a worst case.
- **The MAX_REQUOTE_DRIFT_BPS 2 % between two reads seconds apart** parks SOL on the operator key in a flash crash. Loud, documented in spirit by the hand-recovery runbook; no change needed.
- **Verdict C08's recommended gate-5 arm must not be written as proposed** (R0-1).

---

## What this project should do before launch that AI audit structurally cannot

1. **Run item 22 for real, and make R0-1 part of it.** Nothing has sent a crank pass, an alarm pass or a revenue cycle against a live cluster. The named rehearsal items (one cycle through each pool, one forced post-sweep failure through the runbook, the crank at ~2,100 records) are the only way to learn the failure modes of the RPC, the fee market and the confirmation path. Add: a cycle whose return read is deliberately forced stale (R5-1), and a pool freeze on the rehearsal deployment during the w==0 phase to see which layer ticks.
2. **A second, independent RPC provider for the alarm's account-state reads and status lookups**, so that the swap floor, the sweep judgement and `crank_silent` do not all rest on one endpoint (limit 10(b)). An AI can note the single point; only operations can remove it.
3. **A human signing ceremony for `initialize` that diffs the four transactions' decoded arguments against `launch/mainnet-init.json` on a second machine** before Gary signs. The checker validates the JSON, not the bytes (item 38); the gap between the two is exactly where a one-off, permanent mistake lives, and no test can run the mainnet `initialize`.
4. **Time.** 30-day, 7-day and 3-day values cannot be exercised by any suite; the rehearsal's shortened value set (item 53, still unwritten) and at least one real 30-day period on the rehearsal deployment before lock are the only evidence that the clock arithmetic survives contact with real slots and a real month.
5. **Key custody drills:** the swap operator key, the deploy authority (whose loss before step 11 strands the five claimed ids), the $CBOB release wallet and the Giraffish Moments hot wallet through the 7-day window. Measure restore-from-backup and the guardian's stop latency with a stopwatch; write the numbers into the runbook.
6. **Settle item 22.5 (DAS `burnt` on a burned Core asset) and the DAS owner view on a nested asset on mainnet**, since `detectVaultSetChange` and `detectNestedVaults` rest on an indexer's fields that no local validator has.
7. **Independent recomputation of the five deployed hashes from the release commit on a machine that has never held the repo**, at step 9 and again before step 11 — reproducibility is the only bridge from "the source names Gary's key" to "the bytes do".