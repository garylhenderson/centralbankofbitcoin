# Independent security audit — off-chain pass, v6 final tree

## R0. Round 44's verdict and its repairs

Round 44 confirmed five findings (3 LOW, 2 INFO). VALIDATION.md (`94f06a8`) says each was repaired. I verified every repair at its site:

- **V44o-1** (poster unreadable count survives a draining backlog): Repaired. `redemption-poster.mjs` now deletes only `st.unread[s.signature]` on a readable signature (line 276 area), keeping per-signature counts. The selftest `twoSig` arms show a two-signature drain and gap both reach `rejected:X` on run 3.
- **V44o-2** (revenue split-recovery scan collects a refused read): Repaired. `splitsSince` catches per-signature read failures into `refused`, continues scanning, and the recovery block names refused signatures for a hand read while a readable split beside them still closes the cycle.
- **V44o-3** (null SEAL config drops reserve baselines): Repaired. `alarm.mjs` takes `reserves` from `D.carryConfigBaseline(prev?.config, cfg)` and carries unbuilt legs forward with `balance_unreadable` HIGH. The `run3` selftest arms show 6→6 keys and a later $GARY fall paged.
- **V44o-4** (no-network runner exit): Repaired. Both skip branches now use `if [ "${CBOB_SHIP_GATE:-0}" = "1" ]; then die …; fi`.
- **V44o-5** (rehearsal swap-operator key and REHEARSAL labels): Repaired. `rehearsalNotice` wraps every notify site in crank and revenue (3 and 1 respectively, per the selftest count).

Round 44's dispositions (C01 tick/binary arrays, C07 rollback, C08 `paged`, C09 wSOL close, C10 empty logs) were checked against the tree and hold as stated. The programs equal `RELEASE_COMMIT 0b3ddb3`; HEAD differs only in `audits/`.

**NEW finding (same class as V44o-1, different site):**

### R0-N1 — LOW — the alarm's per-signature unreadable retry count does not survive a pass that does not reach the signature

**Construct.** `bank/alarm.mjs`, the walk loop and the state write. Each pass reads at most `PER_PROGRAM_READS` (2,000) signatures per program (`sigs = walked.sigs.slice(0, PER_PROGRAM_READS)`). When a signature is unreadable, `looked.unreadNow[s.signature] = (unreadPasses[s.signature] ?? 0) + 1`. The state write sets `unreadPasses: looked.unreadNow || {}` — which contains **only the signatures read and found unreadable this pass**. A signature counted in a previous pass that is not in this pass's `sigs` loses its count.

When does a counted signature leave `sigs`? When `walked.sigs.length > PER_PROGRAM_READS` (a flood or burst pushes it past position 2,000). In that case `gap = true` and, if `unread = 0` (the unreadable signature was not reached), a backlog is recorded and the cursor holds — but the count is already gone. When the backlog drains and the signature is reached again, its count restarts at 0, so the `UNREADABLE_SKIP_PASSES` (3) skip takes up to three additional delivered passes.

**What it contradicts.** SPEC `:2113-2114`: "a signature that stays unreadable delays the drain by at most three passes, then is skipped on the record." V43o-2's repair, and its selftest arm, exercise only a chain of four signatures with `PER_PROGRAM_READS: 2` where the unreadable signature is reached via the backlog in the immediately following pass — a shape in which the count survives because the signature is in `sigs` every pass it is counted. The flood shape is not exercised.

**Evidence that would exist on chain or in a test run.** A test with `PER_PROGRAM_READS: 2`, a chain of four signatures where X is unreadable at position 2, and 2,000 new signatures injected between pass 1 and pass 2. Pass 1 counts X at 1. Pass 2 reads only the 2,000 new ones (X not in `sigs`), `unreadPasses` becomes `{}`, X's count is lost. Passes 3–5 (after backlog drain) count X from 0 to 3 and skip. Total 5 passes where 3 suffice. Measured on the selftest's own `wedge` harness shape.

**Severity and class.** LOW. (a) No — `bank/alarm.mjs`. (b) No — detection only; nothing moves. (c) No. (d) No. The skip still fires; `tx_unreadable` HIGH pages each pass the signature IS read; `scan_gap` HIGH pages while the backlog exists. The cost is up to three extra passes of a level page and three extra passes of cursor hold.

**Fix.** Merge forward: `unreadPasses: { ...(prev?.unreadPasses ?? {}), ...(looked.unreadNow ?? {}) }` and delete the entry when a signature is read successfully (`delete` after `looked.txs++`) or skipped (after `looked.unreadSkips.push`). Gate-5 arm: the flood shape above, shown red at the current tree.

---

## R1. The crank (`bank/crank.mjs`)

No new defect found that moves value or misplans a send the program would refuse.

Verified:
- `planCostLamports` matches the actual send count: `reschedule + capture + reveal + rescue + retireBurned + activate + claims.length + split + distribute + ceil(preJoins, batch) + ceil(preExpires, batch) + ceil(postExpires, batch)`, plus reveal attribute rent. `plan.joins` entries flow into `plan.claims` via `ready.push(...plan.joins)`, so they are counted once.
- `budgetPlan` keeps `FEE_FLOOR_LAMPORTS` in reserve for reveals (`room = lamports − base − floor`), runs the base plan whenever it is covered, and trims reveals in mint order. A key below even the base is refused.
- `judgeDistributeRefusal` correctly distinguishes a race (epoch moved) from a planning fault (`PoolShort` never benign).
- `revealAttrSource` sends `[]` only for a positively burned asset and breaks the run on `'skip'`.
- The reveal loop sends strictly in mint order and stops at the first failure or benign refusal.
- `planRescues` matches `detectNestedVaults`'s output and only plans rescues MINT would accept (host is self, live vault, or burned asset; nested vault live).
- The heartbeat carries `failures` and `problems`; `detectCrankHealth`'s `problemKey` normalises numbers so a streak survives changing owed amounts.

**Minor (INFO):** `budgetPlan`'s `low` warning text says "kept the floor for later passes" when `lamports < floor`. The base plan runs and spends from the balance without reserving the floor; only reveals respect it. The text overstates what happened. No behavioural consequence.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

Besides R0-N1 above, no new dangerous-on-chain-state-read-as-quiet was found.

Verified:
- `detectSweepState` judges `|t − start| ≤ cooldown/2` against the smallest cooldown ever seen, and an uncertain send explains a sweep only when a direct `getSignatureStatuses` lookup confirms it landed.
- `detectLogGaps` / `detectUnreadSkips` never evict an unreviewed entry; more than 2,000 unreviewed escalates to CRITICAL.
- `detectUnreconciledRevenue` holds `claimedSigs` as `closesCycle`'s exclude set, so one split cannot close two cycles.
- `detectSplitClaims` anchors `splitByOther` cycles on chain-time splits at or after the return, at least as large, claimed by nobody, each consumed once.
- `applyFrozenTransitions` pages a freeze once (urgent) and lists it at INFO while it stands; `ALARM_KINDS` classifies `pool_frozen` etc. as `'once'`, so no misleading recovery is sent on the downgrade.
- `carryConfigBaseline` preserves the last non-null value of every key across a one-pass read failure.
- `detectConfigDrift` skips a key whose program was absent in the previous snapshot and third-party keys never recorded.
- `detectCrankHealth`'s `covered` predicate prunes only freeze-related problems already paged by the transition detector.
- `detectUnsweptRoyalties` grace is `max(24 h, cooldown + cron period + 1 h)`, and the clock restarts on any net balance fall.
- Every `kind:` literal in the detectors and alarm is in `ALARM_KINDS`, and every `ALARM_KINDS` key is emitted somewhere (both directions tested).

**Minor (INFO):** `judgeCronTemplate`'s regex `node\s+bank\/\S+\.mjs` could match a cron line's echo string or trailing comment that mentions a bank job. The real template has no such lines and the check is in the loud direction.

---

## R3. The layouts (`bank/layout.mjs`)

The assertions are real and can fail:
- `parseRustStruct` throws on any line it cannot read as `pub name: Type,` (private, `pub(crate)`, multi-line). Tested both ways.
- Every `OFF_*` constant pinned in GOV, BURN and MINT is compared to `L.offsets(...)` and the L2 arm requires that none scraped is left unchecked.
- The SEEDS comment claim (round 24 D6) now has a real assertion: all 12 seeds are scraped from the Rust `*_SEED` constants and compared (D6 arm).
- `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` are scraped and evaluated, less padding, against `L.fixedLength` (L13c arm). A one-byte change in the Rust allocation is caught.
- Layout versions and `BOOST_RING` are scraped from the Rust and compared (L6 arm).
- The program-id gate (L7) checks every copy in alarm, detectors, revenue, selftest, the four `declare_id!`s, and each `target/deploy` keypair's public key against `PROGRAM_IDS`; one character mutated in any of 14 copies turns it red.

---

## R4. The money arithmetic (`bank/accrual.mjs`)

The mirror equals the program:
- `pendingScaled` = `weight × acc + carry − debt`, matching `owed_of`.
- `credit` = `delta = avail × ACC_SCALE / w`, matching `credit`.
- `ceilSats` = `(scaled + ACC_SCALE − 1) / ACC_SCALE`, matching `ceil_sats`.
- `reweigh` moves owed to `carry` and restarts debt at the new weight.
- The selftest asserts Level V is exactly 3× Level I, dust carries, a deferred payout stays owed, and a retired vault's share returns to the pool.

The crank expires every DUE boost before distributing (`preExpires`) and every boost its own distribution makes due right after (`postExpires`). `detectCrankHealth` pages `boosts_stalled`; `cbob_mint` and the boost bounds are in `WATCH` as CRITICAL.

---

## R5. The swap and revenue cycle

### (a) Oracle math
`oracleFloor` computes `sats = lamports × sol.price × 10^(es−eb) / (btc.price × 10)`, with `e ≥ 0` multiplying the numerator and `e < 0` the denominator. Integer division floors `expectedSats`; `minSats = expectedSats × 9850 / 10000` also floors. Both roundings are in the conservative direction (the floor is never above the exact 150-bps-below value). Exponent range is pinned −18..0. The hand-pinned vector (280,355 expected / 276,149 minimum at the 2026-10-05 prices) matches. `satsPerLamport` uses `Number()` on prices well inside double-precision exactness; it feeds only the 100-bps deviation filter, never the floor.

### (b) Pyth verification
`readPyth` pins owner (receiver program), verification level (FULL = 1), feed id, exponent range. The account is derived (shard-0 PDA of the push-oracle program with the feed id), so only the push-oracle program can write it, and it verifies Wormhole signatures first. Staleness (180 s) and confidence (30 bps) are judged in `oracleFloor` against the **Clock sysvar** (`SYSVAR_CLOCK_PUBKEY`, owner-checked, `readBigInt64LE(32)`), never the box clock. A `publishTime` more than 30 s ahead of the chain clock is refused. The offsets (40/41/73/81/89/93) match Pyth's `PriceUpdateV2` layout. An absent, foreign-owned, truncated, partially-verified, wrong-feed or out-of-range-exponent account is refused.

### (c) Deviation filter
`orcaSpot = (sqrtPrice / 2^64)^2` is sats per lamport (raw-unit price of wSOL in cbBTC). `meteoraSpot = 1 / (1 + binStep/10000)^activeId` is the inverse of the pair's Y-per-X price, also sats per lamport. Both directions are correct. Floating-point precision at these magnitudes is far inside the 100-bps bound; a zero or NaN oracle refuses every pool.

### (d) Minimum out
`minSats = expectedSats × (10000 − 150) / 10000`, floor-rounded. It is the same oracle-derived value the deviation filter reads, expressed in raw cbBTC sats — which is exactly what Orca's `other_amount_threshold` (offset 16 in the 42-byte swap data) and Meteora's `min_amount_out` (offset 16 in the 24-byte data) expect. The judge pins both bytes to `minSats`.

### (e) The judge
`judgeSwapInstructions` now requires the exact seven-instruction sequence and independently checks: allowed programs only; only the owner signs; CU limit 400,000 and **no** `setComputeUnitPrice`; each ATA creation for the operator's own wallet and mint (payer, account, owner, mint all pinned); the wrap amount equals `lamportsIn`; SyncNative on the operator's wSOL; the swap's amount, floor, and for Orca the direction (a_to_b), exact-input and `ORCA_MIN_SQRT_PRICE`; the output at key 5 is the operator's own cbBTC ATA; the close is the wSOL ATA back to the operator; Token instructions limited to SyncNative and CloseAccount. The selftest refuses all eight round-24 tampers plus three more (changed CU limit, exact-output Orca, moved price limit) on both venues, and shows the old judge passing every one.

**What it cannot catch** (stated in limit 10): the judge lives in the same tree as the builder and key. A tampered module can edit both. A builder defect is also caught after signing by `revenue.mjs`'s delta check. Orca's `vaultA`/`vaultB` (keys 4, 6) are not checked by the judge — the Whirlpool program validates them against the pool, so a wrong vault causes the swap to fail, not misroute.

### (f) Account derivation
Orca: three tick arrays (`s0`, `s0 − span`, `s0 − 2·span` where `span = 88 × tickSpacing`) for a_to_b, seeded `['tick_array', pool, String(start)]`. Meteora: three bin arrays (`i0`, `i0+1`, `i0+2` where `i0 = floor(activeId/70)`) for Y→X, seeded `['bin_array', pool, BigInt(i)]`. Boundary cases (tick exactly on an array start, negative active id) match the selftest vectors. An uninitialised Orca tick array is accepted by the current Whirlpool program (its SDK interpolates zeroed arrays); the Meteora half is unmeasured (round 44 C01, LOW at most — the fork's clone list showed all arrays existing on 2026-10-08).

### (g) wSOL handling
Wrap exactly `lamportsIn` → SyncNative → swap → close. The close sends any residue back to the operator. A pre-existing wSOL balance is returned by the close. A frozen wSOL ATA fails the whole transaction (nothing lost). A delegate cannot interfere (the owner signs). `CreateIdempotent` means a pre-existing ATA is reused. The fork test SW.1a/SW.4a proves nothing stays wrapped.

### (h) Failure and retry
Orca first; Meteora only on `classifySendFailure` returning `'refused'` (preflight error, landed-and-failed, or expired-and-never-landed — all checked against `getSignatureStatuses` with `searchTransactionHistory: true`). An `'unknown'` outcome throws: the cycle stays open and the next run refuses to start a new one. `rememberAttempt` records `pendingSweepSig`/`pendingSwapSig`/`pendingReturnSig`/`pendingSplitSig` as evidence. The open-cycle guard prevents automatic double-swap; the hand path can (limit 10).

### (i) Adversary extraction
With a 100-bps deviation gate and a 150-bps output floor: worst case is oracle at maximum staleness (180 s) plus pool at the gate edge = ~250 bps, plus 30 bps oracle confidence = ~280 bps. At the ruled throughput (~34 SOL/day ≈ $4,080/day at $120/SOL), 280 bps is ~$11/day, ~$343/month. Not material against royalty revenue. Meteora's ~$900K liquidity against a ≤10 SOL cycle makes price impact negligible inside the gate. The operator key's worst case remains limit 10: `max_sweep_lamports` × cooldown windows until the guardian stops it, bounded by the revenue PDA's balance above reserve.

---

## R6. The gates

- `bank/selftest.mjs` FLOOR = 1004 = `DET_FLOOR` in `run-tests.sh`. Equality is enforced (`R.length !== FLOOR` fails).
- `MIN_ASSERTIONS=912`, `ALLOC_FLOOR=39`, `POSTER_FLOOR=24`, `LAUNCH_FLOOR=68`, `MAINNET_FLOOR=35`, `EXPIRY_FLOOR=4`, `POB_FLOOR=14`, `HOST_FLOOR=6`, `WEB_FLOOR=695` — each checked with `floor()`, which requires equality.
- The round-24 selftest section arms repairs in BOTH directions: the kind-classification gate sees a planted `brand_new_thing`; the wiring gate catches a deleted call, a call in a comment, and a call whose result is thrown away; the router pattern is read from the live `/opt/scripts/alert-router.py` and compared; the eight judge tampers each show the old judge passing.
- `scripts/build-mainnet.sh` covers all five programs: four asked behaviourally (mainnet rejects the test key, localnet accepts), the sweep helper proven byte-identical across three locations, and the source checked for `INIT_AUTHORITY`.
- `scripts/cron-install.sh` arms nothing beyond the six tagged jobs; commented lines, prose notes and other projects' lines never arm `--live` (tested by executing the real preservation block).

---

## Accepted limits — the four questions

1. **Worse than stated?** No. Limit 10 (cap × windows, not one sweep), limit 46 (hot PoB key through the charter window), limit 56 (whole $CBOB on a hot key), limit 41 (transfers unlimited), limit 32 (redemption queue) are each stated at their true severity. Limit 10's "the hand path can double-swap" is the sharpest edge and is stated.

2. **Not actually a limit?** No. Limits 6 and 7 (lock/flock diagnostics) are real operational costs. Limit 8 (cross-pass correlation lag) is real.

3. **Discharged items not discharged?** No. Item 51 ($CBOB boost) is built with suite arms BO.* and init arms 0.1o–0.1v. Item 54 (compute) is measured at 114,756 CU per capture and 524,588 for a mint + 4 captures.

4. **OPEN treated as accepted?** No. Items 22, 38, 50, 52, 53 all remain OPEN AND BLOCKING. `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json`. The rehearsal proof at `2e8c979` is stale and item 53 requires a re-run at the release commit.

---

## web/test/ — can each test fail?

I checked the named property of each file:

- `ids.test.mjs`: program-id, seed, PDA-derivation, dist-hash and release-commit pins all compare against independent sources (Rust, mpl-core, spl-token, `dist/SHA256SUMS`). A changed hash or length fails.
- `decode.test.mjs`: compares `parseCoreAsset`/`parseCoreCollection`/`parseTokenAccount` against `deserializeAssetV1`/`deserializeCollectionV1`/`AccountLayout`. A wrong offset makes the official reader disagree.
- `plan.test.mjs`: the plain case is compared as a whole legacy message against the sim S8 builders (extracted source, not copied). The flood arms (300 strays → one grouped box), the press arms (`prepareOpening` with a new item every kind per press), and the V39-1 promised-account re-read arms all fail if the named behaviour breaks.
- `get.test.mjs`: the claim's proof verifies against `pob-merkle.mjs`'s `verify`/`rootOf`; the buy page's `readBuySnapshot` is driven through the mock RPC with dusted addresses.
- `ceremony.test.mjs`: each initialize instruction is diffed against the suite's builder; the collection-identity, program-bytes and probe checks compare against `dist/` and the placeholder source.
- `meta.test.mjs`: fail-closed arms (picture down, reads fail, wrong collection) keep the previous file byte-for-byte.
- `bundle.test.mjs`: the bundled `judgeLaunch` and `planRedemption` are compared byte-for-byte against node's; the esbuild options are checked against `web/build.mjs`.
- `tx.test.mjs`: `signExact` refuses an added instruction and a forged signature; `errors.json` is compared against a fresh `generate()`.

One gap (already noted in round 44 C12): `bundle.test.mjs` re-states the esbuild options rather than importing them from `web/build.mjs`. Today they match; a drift would not be caught. Recommendation: export the options.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the dress rehearsal (item 22) with a human watching every signature.** AI can verify that the code paths exist and that the selftest arms pass. It cannot observe a live RPC's latency distribution, a provider's rate-limit behaviour under a 2,100-vault `getProgramAccounts`, or what a real 10-SOL swap through Orca does to the pool's price at 03:00 UTC. Item 22's five named items need a person at the terminal recording signatures and reading the ledger after each.

2. **Have a human read the actual signed `initialize` transactions byte-for-byte against `launch/mainnet-init.json` before broadcasting.** The checker validates the JSON, not the signed transaction (round 24 A6). A builder that reads the file and mistypes one argument passes every test in this repository. This is the single highest-consequence manual step: a wrong value is permanent.

3. **Move the $CBOB release key and the swap-operator key off this box before the charter window opens.** Limit 56 says the whole $CBOB supply sits on a hot key on the same machine as the alarm, the ledger and the crontab. Limit 10 says the swap operator is one trusted hop. AI cannot move keys; a person with a hardware wallet can. This is Gary's call (the ruling keeps it hot) but the residual is the box's entire compromise surface.

4. **Get at least one person who has never seen this codebase to attempt the redemption flow end-to-end on the rehearsal deployment using only HOLDER-GUIDE.md.** The guide is the buyer-facing promise. AI reads it against the code; only a naive human tests whether it is *comprehensible*. A misunderstanding of "deposit address" vs "NFT address" is the difference between a vault filled and a vault destroyed.

5. **Before removing the upgrade authority, dump all five deployed programs from mainnet and diff them against `dist/` yourself, on a machine that is not this box.** `build-mainnet.sh` proves which key the bytes carry; it does not prove the bytes you deploy are the bytes you audited. The step-9/step-11 dump-and-check protocol in SPEC is the right one; a second pair of eyes on the hashes is the entire bridge between "the suite passed" and "these exact bytes are permanent."