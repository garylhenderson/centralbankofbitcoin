# Independent audit — off-chain pipeline, sweep helper and holder-page tests (v6, tree at `21f36e1`)

I read the tree whole and tested round 38's verdict, its repairs, and every claim I could reach by measurement or by source. **No CRITICAL and no HIGH.** Below are the defects I can defend, then the four accepted-limits questions, then the web tests, then the closing section. Every finding names what would exist on chain or in a test run if I am right, so it can be checked rather than believed.

---

## R0. Round 38's verdict and its repairs

**Independently verified, and the repairs hold at their primary sites.**

- **C01 (frozen-pool joins were planned but never sent).** The repair is present at *both* ends. `bank/crank.mjs` `planCrank` now has the `else if (poolOk && pool.frozen && plan.joins.length)` branch that batches `plan.joins` into `plan.claims`, and `main()` sends `plan.claims`. Selftest arm `R38 C01` asserts `p.claims.length === 1`, `p.claims[0]` carries the record, and `Object.keys(p.owed).length === 0` (no paying pair). Round 37's arm (`R37 C02`, `p.joins.length === 1`) is now redundant but not wrong. The MINT side is consistent: `claim`'s `r.pending` branch calls `join()` and `continue`s with no transfer, and `monthly_inline` returns early on a frozen pool, so a join-only batch is not refused by the freeze.
- **C02 (`detectSweepState` JSDoc contradicted its code).** Fixed. The comment now states "within half a cooldown" and "a missing `judgedThrough` is 0 … the first pass judges too", which is what `?? 0` and `|t − startedAt| <= cooldown/2` do. SPEC 1320-1322 and the selftest both follow the code.
- **C03 / C04 (documentation exception).** SPEC 1238 now reads "at the read the swap is built from; the earlier read only decides whether to sweep at all", and limit 7 names the daily `--reconcile` and its silent stall. Text only; `grep` shows no other holder surface carries either sentence.

**One gate-5 obligation from that verdict was not implemented (LOW-1 below).**

---

## R1. The crank (`bank/crank.mjs`)

I looked for a plan the program refuses, a plan that pays or joins a dead vault, an out-of-order reveal, and any value movement the program does not pin.

- **Ordering.** `main()` sends reschedule → capture → reveal → retire → pre-joins → `expire(before)` → split → distribute → `expire(after)` → activate → claims. That is the order MINT requires: `retire_burned` before `distribute` (a retired vault's share returns to the pool first, `owedAfterRetire` accounts for it in `planCrank`), `expire_boosts` before `distribute` (`BoostsExpireFirst`), joins before `distribute` (`JoinWaitingFirst`), split before distribute (so `splitToPool` is really in the pool).
- **Dead vaults.** `retireBurned` takes `!r.retired && assets === 'burned'`; the pre-join loop and the join-after loop both `continue` on `assets !== 'live'`; the claim loop `continue`s on `assets === 'burned'`, `r.retired`, and reports `assets !== 'live'` instead of paying. `planCrank` never plans a payment or a join for a positively burned asset.
- **Reveals.** Strictly FIFO from `cfg.revealed_total`, stopping at the first record that is not `entropy_set`/captured-this-pass. `revealAttrSource` sends `[]` only for a positively burned asset (which MINT accepts because it skips the attribute comparison), `'read'` for live, `'skip'` for an unresolvable read (and `main()` `break`s the reveal run before sending).
- **Value.** `main()` builds only MINT instructions. The selftest's two source arms (`d('…')` name set; no `createTransfer|SystemProgram.transfer|transferChecked` and no `programId:` other than `MINT`) are non-vacuous: each can fail on a mutation.
- **Fee floor.** `budgetPlan` now runs the base plan whenever the key covers it and reserves `FEE_FLOOR_LAMPORTS` for the reveals; the round-30 arm (`at.ok`, `at.plan.capture.length === 10`, `FEE_FLOOR_LAMPORTS - spent(at) >= 0n && reveal.length === 0`, `under.warnKind === 'floor'`, `whole.dropped > 0`) exercises every branch and would go red if the reserve were removed.

**What I could not break:** I tried to construct a `planCrank` input the program refuses and could not. The `w`, `owedAfterRetire`, `preJoinWeight`, `retiringWeight` and `expiringWeight` arithmetic matches MINT's `credit`/`retire`/`expire_boost`/`join` exactly (verified against `programs/cbob-vault-mint/src/lib.rs`), including the subtle case where `main()`'s `expire('after')` runs before the claims: `expire_boost` at accumulator `A'` sets `carry = owed_of(r, A')`, which is numerically identical to the crank's `pendingSats({…, boost, carry}, A')`, so the planned `owed` is right either way.

### F1 — LOW — gate-5 obligation from round 38 is only half armed

**Construct:** `bank/selftest.mjs`, the `R38 C01` arm; `audits/round38/VERDICT-offchain.md` gate-5 obligation 1.

**Claim:** the verdict's obligation reads *"Add a source arm that `main()` consumes whichever field carries the joins, so the planner and the sender cannot drift apart again."* The arm that exists asserts only that `planCrank` **populates** `plan.claims`. Nothing asserts that `main()` **sends** `plan.claims`. The exact failure the obligation names — planner and sender drifting, which is how C01 happened in the first place (round 37's arm checked `p.joins` while `main()` sent `p.claims`) — is still unarmed.

**Evidence if true:** `grep -n "plan.claims" bank/selftest.mjs` returns only planner-level reads (`p.claims.length`, `p.claims.flat()`, …). No arm extracts or asserts `main()`'s `for (const [i, pairs] of plan.claims.entries())` consumption, and the nearest source arms (`crank.mjs sends only permissionless MINT instructions`, `budgetPlan …`) do not touch it. Mutating `bank/crank.mjs` so that `main()` sends `plan.preJoins` twice instead of `plan.claims` leaves all 926 detector assertions green.

**Fix:** add a source arm that `main()`'s body consumes `plan.claims` (mirroring `I4`'s `pinDiff` for `alarm.mjs`), or extract-and-run `main()`'s sending loop against a frozen-pool plan and assert the join batch is the instruction that goes out.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

The production-value list matches Gary's rulings (21% / 51% / 3 days, 7-day notice, the three tighten bounds, 30-day month, 1-hour window, plus the 2,100 / 945-525-315-210-105 / cbBTC / Squads / PoB root / PoB collection / $CBOB mint / 12 / 24 pins). `check-launch-params.mjs` imports the same list, so the two cannot drift. `missingWatchedKeys` is real (it fails when any watched key is dropped, and the `_missing` exemption is program-scoped, not wholesale). The `detectSweepState` symmetric window, the `carryConfigBaseline` repair, `judgeReserveRead`, `applyFrozenTransitions`, `detectCrankHealth`'s freeze coverage and `detectLogGaps` all hold under the both-ways arms.

**Dangerous state read as quiet:** I could not find one. `detectUnsweptRoyalties` is quiet below 1 SOL by design (dust), `detectRedemptionRate` is quiet on an idle window by design (round 22 A3), `detectUnreconciledRevenue`'s grace windows are all time-bounded and time themselves are anchored on chain (`cycleStartMs` uses the sweep's block time when `chainNowMs` is supplied).

**Routine state paged every pass:** also could not find one. `detectConfigDrift` skips a program that just appeared (L11) while `carryConfigBaseline` keeps the last non-null value (L5); `distribution_overdue` is gated on `poolAvail > 0` and the grace; `crank_silent` is gated on `live`.

### F2 — LOW — one transaction scanned in N program walks produces N copies of four detectors' findings

**Construct:** `bank/alarm.mjs` `main()`, the `for (const prog of [SEAL, MINT, BURN, GOV])` walk and the per-signature detector call; `bank/detectors.mjs` `correlateBurns`.

**Claim:** `looked.eventSigs` dedupes the **event** parsing across the four walks, but `detectApprovals`, `detectPdaTokenAccounts`, `detectBurns` and `detectUnledgeredSweeps` run once per walk with no equivalent guard. A redemption that names SEAL + MINT + BURN is listed by three of the walks, so one bare Core `BurnV1`, one `approve`, one non-canonical token account and one unledgered sweep each produce three identical findings. `correlateBurns` dedupes only `burn_via_program` ("a burn_via_program seen in two program walks is reported ONCE"). Separately, `next.deferredSweeps = dsw.keep` in the delivered branch has no dedupe (the `!delivered` branch does: `.filter((d, i, a) => a.findIndex(x => x.sig === d.sig) === i)`), so one fresh unledgered sweep can be carried twice and page twice when it goes stale.

**Evidence if true:** `bank/alarm.mjs` — `if (!looked.eventSigs) looked.eventSigs = new Set()` guards only the `parseCbobLogs` / `detectProgramEvents` block; the four detectors below it are called unconditionally inside `for (const s of sigs)`. `bank/detectors.mjs` `rememberRedemptions` / `correlateBurns` collapse only `kind === 'burn_via_program'`. On a local validator, one transaction bundling `open_for_redemption` + a top-level Core `BurnV1` + `burn_vault` would be listed by SEAL's and BURN's walks and produce two `bare_core_burn` CRITICALs.

**Cost:** noise, not silence — the router groups by kind and sends one notice listing N copies, so no real finding is buried; and one extra `unledgered_sweep` CRITICAL for the same signature. **Fix:** reuse `looked.eventSigs` (or a `(kind, asset, sig)` set) for the four instruction detectors, and dedupe `deferredSweeps` in the delivered branch the same way the `!delivered` branch already does.

---

## R3. The layouts (`bank/layout.mjs`)

The round-24 D6 repair **is** present: `SEED_SRC` scrapes all eleven `*_SEED` constants out of the four programs' sources and `judgeSeeds(L.SEEDS)` must return `[]`, with both a mistyped seed and an unmapped seed shown to fail. Cross-program `OFF_*` constants are scraped and every one compared, and the L2 arm ("every OFF_ constant any program pins is compared") rejects a scraped-and-ignored constant. `parseRustStruct` throws on a private / `pub(crate)` / multi-line field. The `MINT_CONFIG_SPACE` / `VAULT_RECORD_SPACE` check (L13c) evaluates the Rust expression against `layout.mjs`'s fixed lengths less padding (1005 / 211), and a single extra byte is shown to fail. `collectionPluginsHash` is blind to `num_minted` / `current_size` and not to the plugin region. I found no struct change that slips past: reordering, retyping, adding and removing each turn the JSON comparison red.

---

## R4. The money arithmetic (`bank/accrual.mjs`)

`credit`, `pendingSats`, `pendingScaled`, `reweigh`, `ceilSats`, `available`, `debtAtActivation` are line-for-line the Rust (verified against `owed_of`, `credit`, `reweigh`, `ceil_sats`, `join`). `boost_weight` and `carry_scaled` are carried through every path; the `L4` arm asserts exact **sats** (20/20, 29, 20) not batch counts, which is what round 24 L4 was about. `planCrank` expires DUE boosts before it distributes (`preExpires`, `expiringWeight` leaves the denominator first) and the ones its own distribution makes due right after (`postExpires`, `boost_end_epoch === dist_epoch + 1`), which is exactly `advance_epoch`'s rule. The alarm's `boosts_stalled` is a level HIGH and `mint.cbob_mint` / `mint.max_boost_weight` / `mint.max_boost_epochs` drift as CRITICAL. No divergence found.

---

## R5. The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

**(a) Oracle math.** `oracleFloor` is exact: `sats = lamports · sol · 10^(es−eb) / (btc · 10)`, with `num`/`den` scaled by the sign of `e`, floored by BigInt division, and `minSats = expected · 9850 / 10000` also floored. `satsPerLamport` is a float and is used only for the deviation filter; an `Infinity`/`NaN` there makes `deviationBps` NaN/∞, which fails `<= 100` and **skips** the pool (loud, not silent). No overflow: BigInt throughout the floor.

**(b) Pyth verification.** The offsets are right for `PriceUpdateV2` under Anchor: disc(8) + `write_authority`(32) + `VerificationLevel`(1 byte for `Full`, 2 for `Partial`) + `PriceFeedMessage` (feed_id 32, price i64, conf u64, expo i32, publish_time i64). `readPyth` requires the **receiver** owner, `level === 1` (Full), and the exact feed id. An attacker cannot write a *chosen* price: the account is a shard-0 PDA of the push-oracle program and only the receiver's `postMultiUpdate` writes it, which needs the Wormhole guardian quorum. A **replayed** fully-verified update within `MAX_ORACLE_AGE_SECS` (180 s) would be accepted — that is the residual the SPEC already states ("a stale or manipulated oracle is bounded by the age, confidence and pool-agreement checks, not removed"). The clock is the `Clock` sysvar, owner-checked, and the future-dating bound (30 s) is separate from the age bound. Both are armed (`SW.7a`, `SW.7b`, `L2` selftest arms).

**(c) Deviation filter.** `orcaSpot = (sqrt_price/2^64)^2` is cbBTC sats per wSOL lamport, the same unit as `satsPerLamport`; `meteoraSpot = (1 + binStep/10000)^(−activeId)` is its inverse because Meteora prices X (cbBTC) in Y (wSOL). Both directions are tested at 99/101 bps above and below (`L6`, both venues), so a pool on the wrong side of the gate is refused. Float cannot sneak a pool through: anything that perturbs the spot by more than 1 bps is already outside the 100 bps band.

**(d) Minimum out.** The same `guaranteed = m2.f.minSats` object feeds `other_amount_threshold` (Orca) and `min_amount_out` (Meteora) and the post-swap `delta < guaranteed` throw. Units: sats of cbBTC, matching both programs' raw `u64` amount fields. The `M1` arm reads the threshold back out of the built instruction at offset 16 on both venues.

**(e) `judgeSwapInstructions`.** The eight tampers of the round-25 verdict are refused **by name** on both venues, and the round-24 judge is reproduced in the selftest to prove each arm can fail. Order is enforced by the destructuring plus the per-slot program/identity checks (swapping `swap` and `close` fails `sw.programId.equals(venueProg)`). A priority fee is refused (`d[0] === 3`), a second `SetComputeUnitLimit` cannot be smuggled in (`ixs.length !== 7`), the output account is `ownCbbtc` at key 5 on both venues, and both ATA creations are checked against the **derived** addresses. See F3 for the two things it does not check.

**(f) Account derivation.** `orcaTickArrayStarts` takes the array holding `tickCurrent` then the two below (a_to_b pushes the tick down); `meteoraBinArrayIndexes` takes the array holding `activeId` then the two above (Y→X pushes the bin up). `Math.floor` handles negative ticks correctly (pinned: `-88733/16 → [-90112, -91520, -92928]`, and an exact boundary starts its own array). Meteora's `host_fee_in` is Anchor `None` (program id), the bitmap extension is passed only when present, and `__event_authority` + program close the list. **Both derivations are proven by the fork**, not by reasoning: `sim/swap-fork.mjs` swaps 2 SOL and the full 10 SOL through each real program against cloned mainnet pool state (`SW.1`, `SW.4`, `SW.8`, `SW.9`). An **uninitialised** tick/bin array is a writable account Orca/Meteora cannot deserialize, so the transaction lands and the venue program refuses → `classifySendFailure` reads `st.err` → `refused` → Meteora is tried. Fail-closed, with a fallback.

**(g) wSOL.** The canonical wSOL ATA is a PDA of the ATA program; only that program can create it and it initialises owner = wallet with no delegate and no close authority, so "created by someone else" or "with a delegate kept" is not reachable at that address. A pre-funded balance is harmless: the wrap adds `lamportsIn`, the swap sells `lamportsIn`, and `closeAccount` returns **everything** left (pre-existing balance plus any unsold wSOL) to the operator as SOL. If the swap consumes less than the input, `delta < guaranteed` throws and the cycle stays open — the SOL is back in the operator's wallet, not lost, and the ledger is loud.

**(h) Failure and retry.** Meteora is reached only on `outcome === 'refused'` (preflight refusal, landed-and-failed, or expired-and-absent). `unknown` throws and records `pendingSwapSig`, so a confirmation timeout cannot produce a second swap on an honest RPC. Every path leaves the ledger open until a cbBTC return is proven: the intent row is written **before** the sweep, `sweptLamports` only after `classifySendFailure` says it landed, `returnedSats` only after the return lands, and `cycleIsOpen` (one predicate, imported) is false only when `returnedSats > 0` **and** `splitSig || splitByOther`. The `!delivered` branch rolls every baseline back including `sweepJudgedThrough`, `cursors` and `backlogs`. The untruthful-RPC double-swap is the one-RPC trust of limit 10(b) and is already stated (round 38 C10 disposition).

**(i) Extraction within the tolerance.** Per cycle the adversary can take at most the 150 bps floor: the pool is skipped at read time beyond 100 bps, so the residual is the 50 bps between the read-time gate and the on-chain floor, plus whatever a 179-second-stale oracle misprices. At the ruled 10 SOL cap that is ≈0.15 SOL per cycle; at the observed ≈3.4 cycles/day (round 37 C05) that is ≈0.5 SOL/day, ≈15 SOL/month, against ~34 SOL/day of throughput. The Meteora pool is ~10× thinner, but it is only reached when Orca's **program** refuses, so a pushed Meteora pool cannot be selected by an attacker who also controls the fallback decision. The operator key's worst case is unchanged in shape and slightly better in fact: the program bounds it at `max_sweep_lamports × ⌊t / sweep_cooldown_secs⌋` until the guardian's instant stop, and the hourly job plus the chain-clock cooldown test give 24/7 sweeps/day, i.e. ~34 SOL/day, not 40. The ledger still cannot read a failed cycle as closed (see (h)).

### F3 — INFO — `judgeSwapInstructions` compares pubkeys only, and never counts the venue swap's keys

**Construct:** `bank/swap.mjs` `judgeSwapInstructions`; `keysAre`, `ataOk`.

**Claim:** `keysAre(ix, want)` compares only `ix.keys[i].pubkey`. It does not compare `isSigner` / `isWritable`. So a builder that produced the right accounts with the wrong flags (e.g. ATA `payer` not a signer, the wrap's `from` not a signer, the close's authority not a signer) passes the judge and only fails on chain. And the venue swap's own key count is never checked: Orca must carry 11 keys and Meteora 15 + the bin arrays, but `sw.keys.length` is not asserted, and for Meteora neither are `host_fee_in` (key 9), the token programs (11, 12) or the bin-array count/order. The round-38 verdict already dispositioned `host_fee_in` (C12: "mechanism accurate", recommended to pin it) and that recommendation is still not taken.

**Evidence if true:** `keysAre = (ix, want) => !!ix && ix.keys.length === want.length && want.every((w, i) => ix.keys[i].pubkey.equals(w))` — no flag comparison anywhere in the function. The selftest's eight tampers each change a *pubkey* or a *data byte*; none changes a flag or appends an account to `sw`. `SW.6a`/`SW.6b`/`SW.6c` and the L1 block all mutate addresses, bytes or program ids.

**Cost:** none to holder funds — the venue programs validate their own vaults, tick/bin arrays, token programs and signer flags, and a wrong flag is an on-chain refusal that `classifySendFailure` turns into a fallback or an open cycle. This is a coverage over-claim in the judge's stated contract ("the EXACT seven-instruction sequence … each ATA creation for the operator's own wallet and mint"), not a routing hole. **Fix:** compare `isSigner`/`isWritable` in `keysAre`, assert `sw.keys.length`, and pin `host_fee_in` to `METEORA.program` as C12 recommended.

### F4 — INFO — the ledger overwrites the pre-sweep quote

**Construct:** `bank/revenue.mjs`, `cycle.quotedSats`.

**Claim:** `cycle.quotedSats` is first set to `q.outAmount` (the `m1` oracle read that decided whether to sweep) and then **overwritten** with `m2.f.expectedSats` before the swap. `MAX_REQUOTE_DRIFT_BPS = 200` therefore exists only as an in-code throw; nothing in the ledger records the m1→m2 move. `--audit` and `short_swap_return` both compare against the post-sweep quote only.

**Evidence if true:** `const cycle = { …, quotedSats: q.outAmount, … }` then `cycle.quotedSats = String(m2.f.expectedSats); cycle.floorSats = String(guaranteed); save(led)`. `detectUnreconciledRevenue`'s `short_swap_return` reads `c.quotedSats`, which is the m2 value.

**Cost:** no money is at risk — the 2% abort guard still fires before anything is swapped, and the 150 bps floor is correctly stated against the post-sweep oracle. What is lost is evidence for hand recovery and for auditing whether a given cycle was entered at a bad moment. **Fix:** keep `quotedSats` as the m1 quote and add `requotedSats`, or record both.

---

## R6. The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

- **Floors.** Every floor is equality-checked (`floor()`'s `[ "$n" -eq "$4" ]`, `MIN_ASSERTIONS`'s `[ "$TOTAL" -eq "$MIN_ASSERTIONS" ]`, `run-all.mjs`'s `m[1] === m[2] && Number(m[2]) === floor`). `DET_FLOOR=926` equals `selftest.mjs`'s `FLOOR = 926`. No floor can be satisfied by deleting work: deleting assertions makes the count **drop** below the floor and the run fails.
- **Vacuous-on-empty.** `audit-coverage.sh` refuses an empty `have`, an empty `sent`, and a Python `files` list; `everywhere(what, …)` requires `found.length > 0`; `emitted.length > 60` is required of the `ALARM_KINDS` gate; the `idGate` mutation arms require 14 copies each to go red. I found no `.every()` on an empty array that passes for the wrong reason.
- **Round-24 both-ways.** I checked each round-24 repair arm for the "ack arm that could not" defect. `judgeCronTemplate` (commented `FLOCK=` → 5 refused, real template → 0), `judgeFeePayer` L6a (all four funded/short × above/below-ceiling cells), `budgetPlan` L6b + R30 L2, `judgeDistributeRefusal` L1 (moved/unmoved/`PoolShort`), `revealAttrSource`/`splitDecimalsByte` L2, the split blockers L3, `clockUnixTimestamp` I2, `crankNotices`/`readCrankBeat`/`detectCrankHealth` L4, `carryConfigBaseline` L5, `judgeReserveRead` L7, the three-reserve correlation L8, the index race L9, `detectSweepState` R32/R33 (including the extracted alarm fragment), `applyFrozenTransitions` I5, `alarmProduction` D5 — each has a control that the selftest itself demonstrates can fail. The one that cannot fail is **F1** above.
- **`scripts/build-mainnet.sh`** does prove what it says for all five: four keyed programs are deployed to a validator and asked whether they trust the test key (mainnet must REJECT, localnet must ACCEPT, by name), the source's non-localnet `INIT_AUTHORITY` is grepped for Gary's key in all four, the tree must be clean, and the sweep helper is byte-compared against **both** the localnet rebuild and `target/deploy/cbob_vault_sweep.so`. It explicitly labels what is NOT proven (that the compiled constant is that key), which is the honest reading.
- **`scripts/cron-install.sh`** arms exactly six tagged jobs and nothing else; `judgeCronTemplate` and the `ours()` preservation block (extracted and executed as real shell) both run in the selftest. The deadman is plain `test`/`find` and needs no node.

### F5 — INFO — a third, un-armed copy of "the initialize bounds" exists

**Construct:** `web/src/lib/plan-ceremony.mjs` `judgeRehearsal`; `scripts/check-launch-params.mjs` `judgeLaunch`; SPEC item 53.

**Claim:** SPEC 53 lists the rehearsal value set and *"a rehearsal mode in `scripts/check-launch-params.mjs`"* as **not built**. That is accurate — `check-launch-params.mjs` has no rehearsal mode and `launch/rehearsal-init.json` is not in the tree. But `web/src/lib/plan-ceremony.mjs` **does** implement a `judgeRehearsal` that enforces rehearsal bounds (min quorum, no OPEN values), and `web/test/ceremony.test.mjs` drives it. So the "bounds each `initialize` enforces" now live in two places (`judgeLaunch`'s `need(...)` block and `judgeRehearsal`) with no arm asserting they agree.

**Evidence if true:** `grep -n "judgeRehearsal" web/src/lib/plan-ceremony.mjs web/test/ceremony.test.mjs` finds the function and its two arms; `grep -n "rehearsal" scripts/check-launch-params.mjs` finds nothing. The ceremony test asserts `judgeRehearsal(q, NOW)` refuses a quorum of 400, and `check-launch-params.mjs` separately asserts `quorum_bps >= 500` — two statements of one bound, never compared.

**Cost:** a drift between the two would let the ceremony page accept an `initialize` the pre-signing checker refuses (or block one it accepts), and nothing turns red. **Fix:** export one `INITIALIZE_BOUNDS` used by both, and add an arm that `judgeRehearsal`'s per-field checks are a subset of `judgeLaunch`'s.

---

## The four questions on the accepted limits

**1. Is any limit worse than stated?** No. I re-derived the two most likely to be understated:
- **Limit 10 (the swap hop).** The stated bound ("cap × cooldown windows until the guardian stops it") is *conservative*, not optimistic: the hourly job plus the chain-clock cooldown test yields 24/7 sweeps/day (~34 SOL/day), not 24/6, so the exposure is ~15% lower than "10 SOL every 6 hours" in the holder guide implies. The holder guide's "up to 1.5% below Pyth's price" is correct against the post-sweep oracle read (which is what the 150 bps floor is computed from); the separate 2% re-quote window is an *abort* guard, not a loss, so it does not widen the bound. The untruthful-RPC double-swap (round 38 C10) is already stated as the one-RPC trust of 10(b).
- **Limit 25 (re-roll) and 26 (C's leader).** Both are stated at their measured strength (best-of-4 alone → P(V) 5.0%→18.6%; 64 tries → 96%), and both are marked BUYER-FACING in the guide. No understatement found.

**2. Is anything listed as a limit not actually a limit?** No. Limit 6/7 (the flock/log shortfall and the wedged-holder skip) are genuine and their mitigations (`crank_silent`, `royalties_unswept`, `crank_failing`, `crank_problem`, `crank_posture_unreadable`) are all wired and both-ways armed. Limit 8 (cross-pass correlation lag) is real and self-correcting. Limit 9 is *wider* than v5, exactly as stated.

**3. Is any DISCHARGED item not actually discharged?** No. Items 14, 19, 30, 31, 33, 12/17, 51, 54 are each closed by a named on-chain refusal, a named measurement, or deletion with the thing they were about, and each has a surviving arm. Item 54's one residue (the compute-unit limit on the holder pages) is correctly left as an obligation of the still-open item 50.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. 22, 38, 50, 52, 53 all read as blocking in both SPEC and the road table, `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline` and `vault_collection` as OPEN, and the launch selftest (49/49) includes the refusal for each. Item 53's rehearsal value set is explicitly labelled "not built, named so it is not assumed". The only drift is F5 above, which is a duplication risk rather than a demotion.

---

## `web/test/` — can each test fail when the property it names is broken?

`run-all.mjs` requires each file's count to **equal** its floor *and* `m[1] === m[2]`, so "stopped early and passed what it reached" cannot pass. I checked each file for the round-37 ack-arm defect (an assertion that cannot fail):

| file | verdict |
|---|---|
| `ids.test.mjs` | non-vacuous; `pinDiff` arms mutate a hash/length and name the key; the `declare_id!` / `INIT_AUTHORITY` / seed scrapes compare against the Rust |
| `ix.test.mjs` | non-vacuous; the end block clears a signer flag, flips a data byte and changes an account, and `diffIx` must catch all three |
| `decode.test.mjs` | non-vacuous; compared against mpl-core's and spl-token's own deserializers, including a truncated plugin region and two unknown plugin type ids |
| `plan.test.mjs` | non-vacuous; whole-message comparison against the Test Vault S8 builders, and every refusal carries a specific regex. **One gap:** the `L2` payout block arms the *boost* shortage ("found fewer due boosts than MINT counts: refused before anything is burned") but has no equivalent arm for a `waiting` list shorter than `pending_count - pending_this_epoch`, which is the same failure mode on the join gate |
| `get.test.mjs` | non-vacuous; refusals are named, the proof is verified against the committed root, and `diffIx` compares against the suite builders |
| `ceremony.test.mjs` | non-vacuous; `judgeProgramBytes` catches a flipped byte, non-zero padding and the 20,920-byte placeholder; the collection-creator arms drive real compiled messages including a decoy and a failed create |
| `tx.test.mjs` | non-vacuous; the "guard" wallet and the forger both must be refused, and `errors.json` must equal a fresh `generate()` |
| `proxy.test.mjs` | non-vacuous; the allowlist is compared to what `web/src` actually calls in **both** directions, and every refusal arm feeds a specific malformed shape. The 20,000-account measurement proves the old one-call listing really is over the 8 MB cap |
| `meta.test.mjs` | non-vacuous; each fail-closed arm proves the previous file survives byte-for-byte |
| `bundle.test.mjs` | non-vacuous; the bundled `judgeLaunch` is compared to node's on three inputs, and the SRI/leak/noindex arms read the built artifacts |

The one test-shaped weakness across the set is `bundle.test.mjs`'s *"does not import node's crypto, fs or url"* regex, which would not catch a **dynamic** `import("crypto")`. Low; esbuild's `alias` already prevents the static case.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

Concrete, in the order I would do them:

1. **Run the dress rehearsal for real, and record the transaction signatures.** Item 22 is the single largest un-measured surface, and it is the one thing a model cannot do: a live crank against ~2,100 vaults, a live alarm pass, **one full revenue cycle through each pool with Orca forced to refuse once**, and **one forced post-sweep failure walked through hand recovery to a clean `--audit`**. If any of that is skipped, nothing in this report substitutes for it.
2. **Have Gary personally sign the four `initialize` transactions from `launch/mainnet-init.json`, then have a second person on a second machine re-read the deployed configs field-by-field against that JSON.** The checker validates the file, not the signed bytes (round 24 A6). This is a human-eye-and-hand step by construction.
3. **Reproduce the build from the release commit on a clean machine and compare `dist/SHA256SUMS`.** `build-mainnet.sh` explicitly does *not* prove the compiled constant is Gary's key — only that the source names it. An independent rebuild closes that.
4. **Move every hot key off this box and prove the restore.** The swap operator key, the $CBOB release wallet (`AT2qf412…`), the deploy authority, and the Giraffish Moments update authority all live here or in a wallet whose seed is here. Put them in hardware or a multisig, delete the box copies, and restore from backup into a clean machine as a drill.
5. **Pre-sign and hold the two guardian stops.** `emergency_stop_sales` and `emergency_stop_sweep` are the only things that work in the minutes after a compromise, and limit 47 says the window is "a vote plus a week at best". A signed, ready transaction beats a runbook.
6. **Run an alert-delivery drill on every stream, on purpose.** Break something small on each of `cbob-vault-alarm:<kind>`, `cbob-vault-crank:full`, `cbob-revenue:<stage>` and `cbob-reconcile:<kind>`, and confirm a human receives it and acts inside the grace. The round-24 H1 repair is measured against the router in a throwaway state dir; nobody has measured *the person*.
7. **Have a non-engineer use the redeem page with a Phantom wallet against a real vault holding a real stray and a real nested asset.** Item 50 is the only pre-signature control left after the Bank was deleted, and its whole value is that an ordinary holder can follow it.
8. **Decide, in writing, what each third-party upgrade triggers.** Metaplex Core, Orca, Meteora and Pyth each have a live upgrade key. The alarm detects; only a pre-agreed response (re-run `sim/swap-fork.sh`? halt the revenue job? publish a notice?) turns detection into anything.
9. **Read the four `initialize` values out loud, once, against DESIGN-v6.** `monthly_secs` 2,592,000, `notice_secs` 604,800, `redeem_window_secs` 3,600, `min_voting_secs` 259,200, `quorum_bps` 2,100, `threshold_bps` 5,100. Item 38 says a wrong one is permanent; that is a reading, not an audit.