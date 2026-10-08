# ROUND 40 — OFF-CHAIN PASS (crank, alarm, layouts, arithmetic, swap/revenue, gates, `web/test/`)

I read the whole tree. Where a claim of mine is measurable I say what would be on chain or in a run, and I name the exact mutation, because this project's own record says ~1/3 of CRITICALs die on measurement. I ran nothing; every measurement below is a prediction with the command that would settle it.

**Verdict: NOT CLEAN. 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW (both gates/tests that cannot fail when the property they name breaks — the round-37/round-39 class), plus 3 INFO.** Round 39's repairs hold for C02–C05; **C01's repair is real but partial, and a second instance of the same class survives in `web/test/` that round 39's own analysis walked past.**

---

## R0. Round 39's verdict and its repairs

I re-derived each confirmed finding from the code, then looked for the same shape elsewhere.

| R39 item | Repair status | Evidence |
|---|---|---|
| **C01** — nothing gates what `main()` sends | **PARTIAL — see F1** | `bank/selftest.mjs` "ROUND 39 (C01)" block. |
| **C02** — the alarm's baseline writes | **HOLDS** | `bank/alarm.mjs` 559–561 (`judgeReserveRead`, `if (jr.value !== null) balances[l.key] = jr.value`) and 784 (`vaults: setChange.trustCurrent ? vaults : (prev?.vaults \|\| vaults)`); the R39 C02 arm executes both fragments with stubs and asserts a carried `'500'` and a not-adopted list. The extraction fails **closed**: a changed line makes the `vline` regex miss, `pick` returns `'MISSING'`, and the assertion compares `['MISSING','MISSING']` to `[['A','B'],['A']]`. |
| **C03** — the bundled `planRedemption` is now run | **HOLDS** | `web/test/bundle.test.mjs` runs `B.planRedemption(bIds, sn)` against node's on six snapshots and compares canonicalised output including the instruction bytes (`redemption`, `prior`), with `n.v.length > 200` guarding a trivial result. One INFO (below) on what the canonical form omits. |
| **C04** — the step-0 key | **HOLDS for the key; the companion arm is vacuous (F2)** | The fresh-key arm is real (three builds, three distinct public **and** secret keys) and the "only 2 `localStorage.` occurrences, no `secretKey`" arm is real. |
| **C05** — HOLDER-GUIDE "being built" | **FIXED** | Now "The redeem page (built, and published before launch) will take out…". |
| Disproved claims C06–C30 | **RE-TESTED, all hold** | I re-derived C08 (`rememberAttempt` returns early without a signature → `cycleIsOpen` true → `unreconciled_swap`), C13 (the four instruction detectors run once per walk, only events are keyed by signature), C14 (`conn.<m>` derivation), C17 (`reveal_level` is FIFO, `continue` would be refused), C18 (`claim` pays the on-chain `owed_of`), C20 (`mint.collection` absent from the production `want` list), C22 (RESCUE only in `web/src/lib/ids.mjs`, scraped by `ids.test.mjs`), C25 (`cycle.quotedSats` overwritten by the re-price), C27 (esbuild `alias` covers every import form), C29/C30. |

---

## R1. THE CRANK (`bank/crank.mjs`)

**F1 (LOW) — the round-39 C01 repair gates only the middle of `main()`'s send path, and its fixture never exercises the split.**

*Construct:* `bank/selftest.mjs`, the `// ROUND 39 (C01)` block:

```js
const sendBlock = between(crank, '  for (const a of plan.retireBurned) {', '\n  // THE HEARTBEAT')
...
const all = { retireBurned: ['RetA'], preJoins: [['J1','JA1']], preExpires: ['E1'], split: false, distribute: true, ... }
```

*What an accident gains:* the extraction starts **at the retire loop**, so `main()`'s three reveal-lane sends (`plan.reschedule`, `plan.capture`, `plan.reveal`) — including the strict mint-order `break` that is the whole reason `plan.reveal` is built from `revealed_total` — are not executed by any arm. And the fixture sets `split: false`, so `else if (plan.split) await run('split_revenue (85/15, pinned destinations)', …)` is not executed either. Deleting either site leaves the detector suite at its floor. This is the same defect shape round 39 confirmed (a gate that cannot fail), inside the commit that closed it — the project's own "fix applied to one of N identical sites".

*Evidence if I am right:* take `git archive` of HEAD, and in the copy delete (a) `for (const a of plan.capture) await run(\`capture ${a}\`, …)` from `bank/crank.mjs`, and separately (b) the `else if (plan.split) await run('split_revenue …')` line. Run `node bank/selftest.mjs`. I predict **930/930, exit 0** in both cases. Control: the round-39 verdict's own mF (delete the round-38 frozen-pool branch) is 925/926, failing exactly "R38 C01". I checked there is no other arm that reads those lines: the planner arms test `planCrank`'s output, and the only source regexes on the send path are `/plan\.split && payDecimals === null/` and the `d('…')` name list — neither fails when a send is deleted.

*Fix:* start the extraction at `for (const a of plan.reschedule) {` (or move the whole send section into a named `sendPlan(ctx)` and call that), stub `mintedAttributes`/`revealAttrSource`/`judgeRevealAttrs` into the ctx, and add a second fixture with `split: true, payDecimals: 8` and one reveal. Assert the full label sequence including `split_revenue` and `reveal #n`.

**Everything else I checked in R1 is clean, and here is what I actually checked:**

* **A plan the program will refuse.** `preJoins` requires `request_epoch < dist_epoch`, a live asset and `!retired`; `joins` requires `request_epoch === dist_epoch` and a live asset; the tick requires `w === 0n` and `waitingThisEpoch` computed **minus this pass's retirements** (`retiringThisEpoch`), which is exactly what MINT needs because `main()` sends retires before the distribute. The `preJoinWeight`/`retiringWeight`/`expiringWeight` arithmetic reproduces `credit`'s denominator after the retires, joins and expiries that precede it. I could not construct a plan MINT refuses.
* **A plan that pays or joins a dead vault.** `assets[r.asset] === 'burned'` is skipped in the preJoin loop, the join-after loop and the claim loop; `'other'` (a null RPC answer) is skipped in all three and reported. The only residue is a burn landing *between* the plan and the send — accepted limit 27, and the crank retires bare burns every pass.
* **A reveal out of order.** `plan.reveal` is built strictly from `cfg.revealed_total` upward and stops at the first non-ready record; `main()` breaks on `'fail'` and on `'benign'`. I could not make it send out of order.
* **Value moved somewhere the program does not pin.** Every instruction the crank builds is to MINT; destinations are `cfg.pool_ata`, `cfg.bank_treasury`'s ATA, `r.vault_ata` and the operator-independent `claim` pairs, all re-derived on chain. `split_revenue` sends nothing itself (the program moves the money), and the crank's `split` is refused when the payment mint's decimals cannot be read as one byte. One benign INFO: if the decimals read fails, `plan.distribute` was still planned against `pool.amount + splitToPool`, so MINT can refuse `NothingToDistribute` and page a failure for a distribute that had nothing to do — a false page on a path that is itself already reported (`split_revenue NOT sent`).

---

## R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

I found **no dangerous state read as quiet** and **no routine state that pages every pass** that is not already a stated cost.

* Pages on fixed-forever change: `WATCH` covers the four collection keys (shared array with `COLLECTION_KEYS`, so they cannot drift), the pool, both split destinations, `split_bps`, `max_supply`, `payment_mint`, `level_caps`, `pob_collection`, `pob_root`, both charter bounds, `monthly_secs`, `redeem_window_secs`, `notice_secs`, the three tighten bounds, `cbob_mint`, `max_boost_weight`, `max_boost_epochs`, the GOV numbers, and all five programs' `upgrade_authority` **and** `hash` (the sweep helper included). `missingWatchedKeys` refuses a reader that stops producing any of them.
* Pending guardian/operator: `swap_operator_armed` and `guardian_armed` at CRITICAL every pass; the Proof of Burn collection's plugins **and** update authority at CRITICAL; redemption window nearly full via `redemptionCapacity` (recomputed from the raw ring, head-independent because the ring stores absolute unix times); frozen/insolvent pool via `detectPoolHealth`; overdue distribution via `detectDistributionOverdue` including `launch_tick_overdue`, `joins_stalled`, `boosts_stalled`; upgrade authority past `lockDeadlineOf(file, charter_opens_at)` for all five.
* Gary's production values: the `want` list is the same constants `check-launch-params.mjs` imports, and `charter_secs` is derived from the two on-chain bounds.
* Clocks: every chain-deadline comparison uses the Clock sysvar (`nowSec`) or `wallSec` deliberately and consistently — `last_distribute_at`, the rate ring, `last_sweep_at` and the ledger's `chainNow` on the chain's; the heartbeat, `royaltySince` and the ledger's `now` on the box's. I found no site where the two are mixed.

**INFO (minor, pre-existing, worth one line):** a frozen **CBOBTC Squads** cbBTC account is not covered by `detectCrankHealth`'s `coveredFreezes` (only `pool` and `revenue` are), so it pages `crank_problem` HIGH after three passes *and* `revenue_unsplit`. That is loud, not silent, and a Squads freeze is genuinely not one of the two transition-detected freezes — but it is the same Coinbase event as the other two and there is no `bank_account_frozen` detector. Recommended, not a defect.

---

## R3. THE LAYOUTS (`bank/layout.mjs`)

Clean. I re-derived independently: `MintConfig` fixed length **1005** (749 bytes of fields + 256 padding) and `MINT_CONFIG_SPACE − CONFIG_PADDING = 1005`; `VaultRecord` fixed length **211** (matching the "221 bytes / 1,772,920 lamports" figure once `RECORD_PADDING` is added); `GOV OFF_MINT_MINTED_TOTAL = 141`, `BURN OFF_MINT_BARE_RETIRED = 454`, `GOV OFF_REC_MINT_INDEX = 41` — all equal the computed offsets. `parseRustStruct` is strict (a private or `pub(crate)` line throws rather than being dropped), so a struct change cannot slip past. Round 24 D6's SEEDS claim now has a real gate: 11 of 11 seeds scraped from the four programs, plus a both-ways arm for a mistyped seed and an unmapped one. `rescue` is absent from `L.SEEDS` and is covered by `web/test/ids.test.mjs` scraping `RESCUE_SEED` from MINT's Rust — correctly dispositioned in round 39's C22.

One residual, not a finding: reducing `CONFIG_PADDING` and `MINT_CONFIG_SPACE` by the same amount leaves `space − padding` unchanged, so the space gate would not see it. The padding is slack, not a layout the off-chain code reads, so nothing can misread.

---

## R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)

Clean, field for field. `credit` (`delta = avail·1e12/w`, `acc += delta`, `owed += delta·w`), `pendingScaled` (`(w+boost)·acc + carry − debt`, refusing underflow), `reweigh` (`carry = owed`, `debt = (w+boost)·acc`), `debtAtActivation` (`w·acc`), `ceilSats`, `available`, `pendingSats` — each equals the Rust line. The crank's `joinedNow` branch computes `w·acc − w·cfg.acc_scaled`, which is exactly what a vault joining at `debt = w·acc_old` is owed after this pass's credit, and `acc += avail·ACC_SCALE/w` mirrors `credit` so the same pass's delivery is planned. Boost expiry before and after the distribution is planned (`preExpires`/`postExpires`) and `retiring` vaults are excluded from both, which is what `BoostsExpireFirst` and `unschedule_boost` require. `boosts_stalled` fires, and `mint.cbob_mint`/`max_boost_weight`/`max_boost_epochs` are watched at CRITICAL.

---

## R5. THE SWAP AND THE REVENUE CYCLE

### (a) Oracle math — correct in every sign and direction I could construct
`sats = lamports · sol.price · 10^(es−eb−1) / btc.price`; the code's `e = sol.expo − btc.expo` branch multiplies the numerator when `e ≥ 0` and the denominator when `e < 0`, and `num / den` is BigInt floor division for positive values, so both `expectedSats` and `minSats` round **down** (the conservative direction for a floor). `satsPerLamport = Number(sol.price)·10^es / (Number(btc.price)·10^eb) / 10` is algebraically the same quantity. With both exponents −8 the doubles are far inside 2^53. `meteoraSpot = 1/(1+bin_step/10⁴)^active_id` and `orcaSpot = (sqrt_price/2⁶⁴)²` are the right quantities in the right direction for `sats per lamport` (Orca A=wSOL, B=cbBTC; Meteora X=cbBTC, Y=wSOL), and the fork test's measured 7132 lamports/sat at active_id 5920 / bin_step 15 reproduces SOL/BTC ≈ 713.

### (b) Pyth account verification — the mechanism holds
The account is a PDA of the **push** program at shard 0 with the feed id, owned by the **receiver**; only the push program can sign for that address, and only the receiver can write it, so a stranger cannot post a chosen price into it. Full verification is required (`d[40] === 1`; `Partial` is 2 bytes and is refused), the feed id is compared, the age is judged against the **Clock sysvar** (never the box clock), a `publishTime` more than 30 s ahead is refused, and an unreadable Clock refuses the cycle. `sim/swap-fork.sh` re-derives the same addresses against mainnet and clones them, which is why a wrong derivation could not survive.

### (c)/(d) Deviation gate and minimum-out — the same floor, the right units
Both venues' spot prices are compared to `f.satsPerLamport` in the same units, `MAX_POOL_DEVIATION_BPS = 100` gates *which pool is used at all* (read-time only), and the on-chain floor is `expectedSats × (10,000 − 150)/10,000`, carried as Orca's `other_amount_threshold` and Meteora's `min_amount_out` — both in cbBTC base units, both compared to the floor the judge was told. The judge requires the exact 7-instruction sequence, the direction bytes, the price limit, the wrap amount and the threshold. I re-read `orcaTickArrayStarts` (current, then the two below — correct for a_to_b) and `meteoraBinArrayIndexes` (active, then the two above — correct for Y→X), and `binArrayIndex = floor(id/70)` floors negative ids correctly.

### (e) The judge — complete for what it claims; two residues, both already stated
It refuses: any program outside the five; any signer but the operator; a `setComputeUnitPrice`; any Token instruction but `SyncNative` and the one `CloseAccount`; a wrong instruction count (which covers a `requestHeapFrame` or any other ComputeBudget instruction); a changed compute limit; the two ATA creations by full key list; the wrap destination and amount; the swap's pool, input and output accounts, amount, threshold and Orca direction/price limit; and the close. What it does **not** compare is the **flags** on those keys (`keysAre` compares pubkeys only) or `sw.keys.length` — round 39's C15, correctly dispositioned as a recommendation, and the venue programs refuse the resulting tampering on chain. I could not route anything past it that moves value.

### (f)/(g) Account derivation and wSOL — no defect
`meteoraBitmap()` is passed as the program id (Anchor's `None`) when absent; `host_fee_in` is `None`; the event authority and the two token programs are present. A pre-existing wSOL balance, a delegate, or an ATA created by someone else does not lose value: `createAtaIdempotent` is a no-op, `SyncNative` recomputes `amount = lamports − rent_exempt`, the swap consumes exactly `lamportsIn`, and the `CloseAccount` returns **everything** (including any pre-existing wrapped balance) to the operator. A frozen wSOL ATA cannot be created by anyone but the native mint's freeze authority (none).

### (h) Failure and retry — the ledger stays open on every uncertain path
Orca first; Meteora only on `refused`; `landed` is recorded and the loop breaks; `unknown` throws with the cycle open and `pendingSwapSig` saved. `cycleIsOpen` is false only with `sendRejected`, `sweptLamports === 0`, or a recorded/chain-proven split — so a confirmation timeout on a swap that later lands leaves the row open and the alarm pages. A refused sweep keeps `refusedSig`, never `sweepSig`, so the chain scan still pages `unledgered_sweep` if the judgement were ever wrong.

### (i) What an adversary can extract
The on-chain floor is the oracle's expected output less **150 bps**, so a sandwich that pushes execution to the floor takes at most ~1.5% of the swapped amount, and the oracle's own reported confidence (bounded at 30 bps; live 1.5/1.0 bps) sits inside it. At the ruled 10 SOL cap and the hourly job's real cadence (four sweeps a day), the worst case is roughly **0.15 SOL per cycle, ~0.6 SOL/day, ~18 SOL/month** of royalty SOL — bounded by `max_sweep_lamports × cooldown windows` until the guardian stops the sweep, never a vault, the pool or sale cbBTC. The Meteora pool being ~10× thinner makes the sandwich cheaper to build but does not raise the bound, because the floor, not the pool, binds. That is the accepted design (limit 10) and I found nothing that widens it.

### (R5) The operator key's worst case, re-bounded
What it now trusts is two pool programs and the Pyth oracle plus the one RPC endpoint — not an HTTP reply. The judge constrains the transaction; the post-swap delta check (`delta < guaranteed` throws, cycle open and loud) catches a builder defect after signing; and the whole detection half still does not survive a compromise of the box (limit 10(3)), which is stated.

---

## R6. THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

I found the floor machinery honest: `floor()` demands **equality** (`-eq`), `bank/selftest.mjs`'s own `FLOOR = 930` demands equality, `MIN_ASSERTIONS = 895` demands equality, `CBOB_TEST_FILE` is refused, `CBOB_CACHE` is refused off the default, the Core hash is hard-coded and non-overridable, and the SPEC stated-count gate now reads **every** occurrence of every floor listed in its map (and refuses zero occurrences, so a floor SPEC stops mentioning fails rather than passes vacuously). `judgeCronTemplate` refuses a waiting `flock` and a commented-out `FLOCK=…-n`; `cron-install.sh`'s preserve block only arms our own tagged, uncommented line, and the six installed jobs are pinned by an arm.

Two gate observations:

* **F1 above** is the one gate that cannot fail (the reveal lane and the split send).
* **INFO:** `web/test/bundle.test.mjs`'s C03 canonical form omits `claim`, `owedSats`, `helperStrays`, `transferStrays`, `left` and `coverage`. Each of those is *encoded* in the compared instruction bytes or the compared acknowledgement list, so I could not build a divergence that the canon misses — but the arm's name ("byte for byte") is slightly stronger than what it compares. Adding `claim` and the two stray lists costs nothing.

---

## R0/R6 addendum — `web/test/`, judged the way round 37 judged the ack arms

**F2 (LOW) — `web/test/ceremony.test.mjs`: the M2 arm cannot fail when the property it names breaks by deletion.**

*Construct:*

```js
H.t('M2: the page remembers the new address BEFORE step 0 is signed, and refuses step 0 when it cannot scan the chain',
  pageSrc.indexOf("remember(ctx.newCollection.publicKey.toBase58())") < pageSrc.indexOf("const signed = await signExact(wallet, tx, s.id === 'collection'") &&
  /if \(!collection && discoverErr\)/.test(pageSrc))
```

*What an accident gains:* `String.prototype.indexOf` returns **−1** for an absent substring, so deleting the `remember(...)` call makes the first conjunct `−1 < k` = **true**. The arm therefore catches only the call being *moved* after the signing — not the call being *removed*. And the companion arm in the same file does not cover it either: `remembers` is `[...page.matchAll(/remember\(([^)]*\)?)\)/g)]` and still contains `'collection'` from `remember(collection)`, so `remembers.length > 0 && remembers.every(a => a === 'ctx.newCollection.publicKey.toBase58()' || a === 'collection')` still passes. Round 39's C04 analysis explicitly inspected this regex and concluded only that "it says nothing about the secret key" — it did not notice that its ordering half is vacuous.

*Evidence if I am right:* delete the single line `remember(ctx.newCollection.publicKey.toBase58())` from `web/src/pages/ceremony.mjs` and run `node web/test/ceremony.test.mjs`. I predict **108/108**, and `node web/test/run-all.mjs` unchanged. The property under test — that a reload between step 0 and SEAL still finds the collection (the round-37 "M2" measurement) — is exactly what would then be untested.

*Fix:* bind the index once and require presence, e.g. `const at = pageSrc.indexOf('remember(ctx.newCollection.publicKey.toBase58())'); at > 0 && at < pageSrc.indexOf("const signed = await signExact(wallet, tx, s.id === 'collection'")`, or match the call with a regex that cannot match the empty string.

**What I checked and found genuinely non-vacuous in `web/test/`:** `ids.test.mjs`'s `dist/` pin table with a both-ways control; `ix.test.mjs`'s byte-for-byte comparison against builders *extracted from the suite and the sim's own source* (`ref.mjs`), with a CONTROL arm proving `diffIx` catches a cleared signer flag, a changed data byte and a different account; `decode.test.mjs` against mpl-core's and spl-token's official deserializers; `plan.test.mjs`'s whole-message comparison to the sim's S8 shape plus the measured `1,061` bytes; `proxy.test.mjs`'s streaming response cap, per-`/64` limits, and the 20,000-account flood through the real proxy; `meta.test.mjs`'s fail-closed per-vault and never-backwards arms; `bundle.test.mjs`'s README hash table and the L4 "built from another commit / dirty tree / wrong sum" refusals; `run-all.mjs`'s per-file floor equality. `e2e-localnet.mjs` is outside every gate (round 39's C23), and its `main()` has no early return, so its `ok === total` cannot be met by stopping early — but it has no floor and is not run by `run-all.mjs`, which is the residue round 39 recorded.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit worse than stated?** I checked every ACCEPTED entry against the code and found none that understates its cost. Two are stated *more narrowly* than a reader might take them, both already in the text:
 * **Limit 10** now carries the round-37 C05 correction (24/7 × 10 SOL, ~34 SOL/day for the honest path), and the swap's own bound (1.5% per cycle) is inside it. Consistent.
 * **Limit 26** carries the round-24 numbers (best-of-4 skipping takes P(Level V) from 5.0% to 18.6%) and the cohort consequence. Consistent with `blockhash_in_window`'s `[want, want+64]` window and `try_capture`'s two strides.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?** Nothing. Limit 35 is correctly labelled a floor that never binds at the ruled numbers. Limits 12/17, 14, 19, 30, 31 and 33 are correctly in DISCHARGED, and I re-verified 14 (`check_attributes` refuses `DuplicateAttribute` on both mint paths), 30 (`split_bps`, both destinations and `max_supply` are written only by `initialize`; no `update_wiring`) and 33 (`apply_swap_operator`/`apply_guardian` land after `notice_secs`).

**3. Is any DISCHARGED item not actually discharged?** No. 54's measured figures (`114,756` capture CU, `168,343` redemption CU) are consistent with the code I can see, and its one remaining requirement (the holder pages' compute-unit limit) is correctly folded into item 50, which stays OPEN.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** All five are named open and `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline` and `vault_collection` OPEN, with the checker refusing. **One consequence of 22.5 deserves to be written down where the freeze can see it**, because the repair is a `bank/` commit, not a doc line: `bank/selftest.mjs` **pins** that a seen `burn_vault` must **not** quiet `vault_left_index` (`for (const k of ['approve_by_vault_pda','nested_vault','undeclared_token_account','vault_left_index']) t(\`a burn does NOT quiet ${k}…\`, …, 'CRITICAL')`). So if the one DAS read of 22.5 answers "no, DAS does not set `burnt`", then every honest redemption produces a CRITICAL `vault_left_index` — the exact "alarm nobody reads" failure `correlateBurns` exists to prevent — and the fix touches both `bank/alarm.mjs` and that pinned arm, which resets the clean-round counter. Round 39's C07 said the answer needs one read; it did not say the fix is pinned by an assertion in the selftest. Settle it before the freeze, not during the rehearsal.

---

## ANYTHING ELSE

* **The redemption poster's `REDEEMED` handling can throw on a transient null.** `bank/redemption-poster.mjs` does `L.decode('VaultRecord', (await conn.getAccountInfo(recAddr,'confirmed')).data)` with no null check. The record is never closed, so this only fires on an RPC blip, and it throws before the cursor is saved, so the pass retries — loud, self-correcting. INFO.
* **HOLDER-GUIDE still states two things that depend on item 50** ("It is announced on X and on the Bank's website", "Activation is picked up automatically" — the crank is installed dry-run). Both are named in item 50/22 and the guide is DRAFT and gated on item 50; round 39's C11 dispositioned them. Not re-filed; noted so the launch runbook arms the crank `--live` explicitly and records who did it.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Eight things AI audit structurally cannot do, in the order they should happen:

1. **Run the mutations this report names and confirm they go red.** For F1: delete the capture loop, then the split send, and confirm `bank/selftest.mjs` goes below 930. For F2: delete the ceremony `remember(...)` and confirm `ceremony.test.mjs` goes below 108. If either stays green, the arm must be rewritten before the freeze — a gate is only a gate once it has been seen to fail.
2. **Settle item 22.5 with one real DAS read**, and if the answer is "no `burnt`", fix `bank/alarm.mjs` and the `vault_left_index` arm in `bank/selftest.mjs` **now**, before the freeze is declared. It is the last item whose repair resets the counter.
3. **Run the dress rehearsal's five named items with recorded signatures** — especially (4) the forced post-sweep failure walked through the hand recovery, and (3) the Meteora fallback with Orca forced to refuse. Nothing in this tree has ever run `bank/revenue.mjs` against a live cluster; that is item 22's own warning.
4. **Build `dist/` a second time, on a different machine, from the release commit, and compare sha256.** This is the only bridge from "the source names Gary's key" to "the compiled constant is that key" — `scripts/build-mainnet.sh` says so itself, and no AI pass can close it.
5. **Run the alarm against the rehearsal deployment with `CBOB_ALARM_REHEARSAL=1` and `ALERT_STATE_DIR`/`ALERT_LOG` outside the repo, then do a deliberate alert-delivery drill** (break the router on purpose and confirm the alarm's `delivered=false` path holds every baseline and pages `run_failed`).
6. **Have one person read the four signed `initialize` transactions** byte by byte against `launch/mainnet-init.json`. The checker validates the JSON, not the bytes; item 38 says this itself, and after the lock there is no second chance.
7. **Arm the crank `--live` as an explicit, recorded launch step**, with a named owner and a time, and confirm the heartbeat lands. "Installed dry-run" plus "activation is picked up automatically" is the gap between the guide and the cron.
8. **A tabletop on the guardian**: who holds `Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb`, what the operator does in the first five minutes after `emergency_stop_sweep`, and who executes `apply_guardian` if the key is lost. Immutability makes the brake the only lever; a brake nobody can reach in time is not one.