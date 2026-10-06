# ROUND 28 — OFF-CHAIN PASS (crank, alarm, layouts, money arithmetic, swap/revenue, gates)

**Scope read whole:** `bank/crank.mjs`, `bank/detectors.mjs`, `bank/alarm.mjs`, `bank/layout.mjs`, `bank/accrual.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `bank/txread.mjs`, `bank/spl.mjs`, `bank/anchor.mjs`, `bank/lock.mjs`, `bank/sigwalk.mjs`, `bank/redemption-poster.mjs`, `bank/selftest.mjs`, `sim/swap-fork.{mjs,sh}`, `scripts/{run-tests.sh,cron-install.sh,build-mainnet.sh,check-launch-params.mjs,probe-mainnet-facts.mjs,rehearsal-tree.sh}`, `launch/*`, `programs/cbob-vault-mint/src/lib.rs`, `programs/cbob-vault-sweep/src/lib.rs`, `SPEC.md`, `DESIGN-v6.md`, `HOLDER-GUIDE.md`, `audits/round27/*`, `audits/v6-redteam/RT3-stage3c.md`.

**Result: NOT CLEAN. One MEDIUM, two LOW, one INFO.** Nothing here is re-filed from round 27; every finding below is a construct that survives in this tree and that round 27's dispositions did not cover.

---

## R0 — ROUND 27'S VERDICT AND ITS REPAIRS

Round 27 was **not** clean (8 confirmed findings). Its repairs landed in `e109b31`. I re-derived each repair from the code rather than from the verdict, and re-checked the surrounding sites of the same shape:

| round-27 finding | repair | independently verified here |
|---|---|---|
| L1 missing own components silent | `detectMissingComponents` + wiring in `alarm.mjs` **before** the `mint._missing` early return | ✅ `keys = ['seal','mint','burn','gov', 'prog.seal'…'prog.sweep']`; `lockGate` passed to it; `if (!production \|\| !finite(deadline) \|\| deadline<=0 \|\| now<deadline) return []`. Runs before the early return, so a missing BURN/GOV/sweep pages with MINT initialized. |
| L2 freeze re-pages via `crank_problem` | `coveredFreezes` in `detectCrankHealth`, exact-text match, prune-on-duplicate | ✅ the planner's two messages match the two literals character for character (`'the pool cbBTC account is FROZEN; claims would all refuse'`, `"the revenue address's cbBTC account is FROZEN; nothing in it can be split until it is thawed"`, and the pool-only split-blocker regex). Pruning happens **before** the `beat.atSec !== next.lastAt` guard, so a repeated heartbeat cannot resurrect a thawed streak. Mixed Squads/unreadable blockers do **not** match and stay HIGH. |
| L3 benign race lost to a numeric error | `mintFailureCode` (bounded `getLogs`, invoke-stack attribution to MINT only) | ✅ the stack machine returns a code only when MINT is on top when the AnchorError line is printed and MINT is the frame that failed; a foreign program's same-named code returns `null`; an unbalanced stack returns `null`. `judgeDistributeRefusal` still gets a code only from MINT. |
| L4 rehearsal still ran the lock checks | `if (!production) return []` first line of `detectUpgradeAuthorityAfterLock`; the same guard in `detectMissingComponents` | ✅ both branches (elapsed and unset) are behind the guard; `alarmProduction` fails closed on any value but `'1'`. |
| D1–D4 (INFO/doc) | text qualifications | ✅ SPEC now says "the alarm observes net balance changes … a capped sweep resets that clock only if the balance falls between alarm reads"; the `royalties_unswept` detail text says the same. D2/D3 are documentation and are counted once. |

**Where the prior verdict's measurement boundary is wrong, and it matters for what I file below.** VALIDATION-FINDINGS.md writes: *"Missing log coverage refuses all three consumers, holds alarm/poster cursors, saves no poster state, and supplies no split evidence."* That is stated as a property of **unknown coverage**. It is not scoped to that: the validator refuses several inputs that are *fully readable*, and every refusal is treated by the alarm as fatal and cursor-blocking. That gap is finding 1.

I did **not** re-file any of round 27's rejected claims, and I re-checked the two I could re-derive cheaply: the split rounding (`total - floor(total*1500/10000)` matches `split_revenue`'s `bank_cut`/`holders`) and the empty-scrape case (`undefined !== expectedOffset` fails, it does not pass).

---

## FINDING 1 — MEDIUM (HIGH impact, conditional precondition): the shared history reader refuses a *valid* v1 transaction, and any refusal permanently stops the alarm's walk

**Construct.** `bank/txread.mjs`, `validateParsedTransaction`:

```js
if (tx.version === 1) {
    need(object(m.transactionConfig), 'v1 transactionConfig')
    need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key')
}
```

`bank/alarm.mjs`, `main()`:

```js
const tx = await readParsedTransaction(conn, s.signature)   // throws, no try/catch
if (!tx) { unread++; findings.push({ kind: 'tx_unreadable', … }); continue }
…
if (!gap && !unread && sigs.length) cursors[id] = sigs[0].signature
```

`readParsedTransaction` distinguishes **unknown** (`result === null` → returns `null`, the cursor is held and a HIGH `tx_unreadable` is raised) from **malformed** (validation failure → `throw`). The throw is not caught anywhere in `main()`, so it propagates to `withLock(...).catch` → `CBOB VAULT ALARM FAILED TO RUN` → `process.exit(3)` with **no state written**. The cursor therefore never advances past that signature, so the same transaction is re-fetched and re-thrown on **every** subsequent pass.

**What an accident or attacker gains.** One successful transaction that (a) is a v1 transaction whose `accountKeys` include an address-lookup-table-sourced key, and (b) touches SEAL, MINT, BURN or GOV, disables the entire watcher permanently. After launch that is trivially cheap: `claim` with one pair naming a **revealed-but-not-activated** `VaultRecord` is a permissionless no-op that lands (`if !r.active { continue }`), touches MINT, and is not a failed transaction (so `if (s.err) continue` does not skip it). The watcher is the *only* control for nested vaults (item 9), bare burns, approvals on non-canonical accounts, undeclared token accounts, config/program drift, frozen pools and vault accounts, the distribution clock, unswept royalties and the launch-lock check. It pages `run_failed` (loud), so this is not a silent failure — but it is total, persistent, re-triggerable after any manual cursor reset, and it is exactly the class of "one cheap transaction kills the alarm" the design has spent rounds closing.

The fixture in the tree cannot show it: **all 36 `accountKeys` in `tests/fixtures/mainnet-v1.json` carry `"source": "transaction"`.** The reader's v1 support is therefore certified only for the no-ALT shape, while the format's own `loadedAccountsDataSizeLimit: 6774784` in that same fixture implies loaded (lookup-table) accounts are part of v1.

**Evidence that would exist if I am right.**
1. Build a v1 transaction with an ALT and call `getTransaction(sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 })`: at least one `accountKeys[i]` reports `"source": "lookupTable"` with `signer`/`writable` present and `pubkey` fully resolved.
2. `readParsedTransaction(conn, sig)` throws `unreadable parsed transaction: v1 lookup-table key`.
3. Land such a transaction against a MINT instruction on a rehearsal deployment, then run `node bank/alarm.mjs --dry-run` twice: both passes exit non-zero with the same message and `bank/state.json`'s `cursors['Gsb7…']` is unchanged between them.

If (1) is false — i.e. v1 genuinely cannot load an account from a lookup table and `source` is always `'transaction'` — then the check is dead code and the finding reduces to INFO (a refusal that cannot fire). It cannot be both: as written, either the check fires on valid input or it can never fire.

**Fix.** Delete the `v1 lookup-table key` refusal — the consumers (`normaliseTx`, `revenueOutflow`, `releasedFromTx`, `parseCbobLogs`) read resolved base58 strings and the `signer`/`writable` flags, which the RPC supplies for loaded keys. If some *specific* field really is unvalidatable for a loaded key, return `null` (unknown) for that transaction instead of throwing, so the walk advances and raises `tx_unreadable` HIGH — the treatment a null result already gets. Whichever way, add a v1-with-ALT fixture to `tests/fixtures/`; the current fixture cannot exercise the branch it is cited for.

---

## FINDING 2 — LOW: the alarm judges chain timestamps against the box clock (the third site of a defect fixed twice already)

**Construct.** `bank/alarm.mjs`, `main()`:

```js
const nowSec = Math.floor(Date.now() / 1000)
…
findings.push(...D.detectDistributionOverdue(cfg, { nowSec, poolAvail, … }))
findings.push(...D.detectRedemptionRate(cfg, nowSec))
const royalty = D.detectUnsweptRoyalties({ …, nowSec, … })
const rev = D.detectRevenueAccount({ …, nowSec })
const lockGate = { lockDeadlineSec: …, nowSec, production: PRODUCTION }
findings.push(...D.detectUpgradeAuthorityAfterLock(cfg, lockGate))
```

Every value these compare against is a **chain** timestamp: `mint.last_distribute_at`, `burn.rate_ring[]`, `mint.charter_opens_at`, `mint.last_sweep_at`, and the block times of sweeps and splits. Round 24 (I2) took the box clock off the crank's distribution decision; round 25 (L2) took it off the oracle's age, with the comment *"a price 400 s old was accepted with the box 300 s behind"*. The alarm is the third site and still uses `Date.now()`.

**What an accident gains.** Nothing is moved. The gain is silence or noise: a box clock **behind** delays `program_not_locked` past the launch-lock deadline (the one standing CRITICAL that says the programs are still replaceable) and delays `distribution_overdue`; a box clock **ahead** pages `distribution_overdue`, `redemptions_near_cap` and `royalties_unswept` early. The lock-deadline case is the serious one: item 39's whole answer is that the authority is removed before anything holds value, and the detector that confirms it is compared against a clock the alarm does not control.

**Evidence.** With `faketime '+7 hours' node bank/alarm.mjs --dry-run`, `distribution_overdue` fires ~7 h before the chain's due time; with `-7 hours` it stays quiet ~7 h past it. Or directly: `D.detectUpgradeAuthorityAfterLock(progs, { lockDeadlineSec: T, nowSec: T - 1, production: true })` is `[]` while the chain's clock is already past `T`.

**Fix.** Read the Clock sysvar once per pass — `clockUnixTimestamp((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed'))?.data)` — and use it for every chain-timestamp comparison, exactly as `bank/swap.mjs` `market()` and `bank/crank.mjs` do. If it is unreadable, page (a `scan_gap`-shaped HIGH) rather than falling back to the box: a pass whose clock is unknown is a pass that cannot judge a deadline. The box clock stays correct for `crank_silent`/`crank_posture` (both ends of that comparison are box-stamped) and for the honeypot-warning throttle.

---

## FINDING 3 — LOW: a claim-destination guard that cannot fail in production, and a selftest arm that proves it only by hand-building a state `main()` cannot produce

**Construct.** `bank/crank.mjs`, `main()`:

```js
const tokenAddr = r => r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset)).toBase58()
const tokens = {}
records.forEach((r, i) => { … tokens[r.asset] = { ...t, address: tokenAddr(r), … } })
```

`planCrank`, the claim loop:

```js
if (!t || t.state !== 'ok' || t.address !== r.vault_ata) {
    plan.problems.push(`vault ${r.asset} is owed ${owed} sats but its recorded cbBTC account ${r.vault_ata} is ${t ? t.state : 'unread'}; …`)
    continue
}
```

The records reaching this branch are `r.active || joinedNow`. For any active record, `tokenAddr(r)` **is** `r.vault_ata` by definition, so `t.address !== r.vault_ata` is always false in production. The real guard is `t.state !== 'ok'`.

`bank/selftest.mjs` arms the dead clause as if it were live:

```js
t('...and a destination that is not the RECORDED account is refused the same way',
  plan({ … records: [act(0,1)], tokens: { [A(0)]: tok(0n, { address: 'NotAta0' }) }, … }).claims, [])
```

It passes because the test hand-builds the `tokens` map with an address the production caller never writes. The arm therefore certifies a guard that production cannot exercise, which is the shape this project's own R6 question asks about ("checks that pass vacuously when their input is empty" — here, when their input is impossible).

**What an accident gains.** Nothing today: `t.state !== 'ok'` is the correct and sufficient guard, and the on-chain `claim` re-checks the destination (`WrongVaultAccount`) and reverts the whole batch. The cost is diagnostic and structural: a reader change that made `tokens[r.asset].address` differ from `r.vault_ata` would be silently tolerated by the planner, and the selftest would still be green.

**Evidence.** Instrument `planCrank` with a record whose `vault_ata` is `Ata0` and a `tokens` map built by `main()`'s own `tokenAddr` helper: `t.address === r.vault_ata` holds for every active record, so the clause never contributes a problem. Then delete the clause and re-run `bank/selftest.mjs` — the arm above still passes (it is the `address` field alone that trips it), proving the arm does not depend on the code path it names.

**Fix.** Either delete the clause (and the arm with it), or turn it into a **reader invariant** that fails loudly: after building `tokens`, assert `tokens[r.asset].address === tokenAddr(r)` and throw if a future edit breaks it. Keep the selftest arm honest by constructing `tokens` through the same helper `main()` uses, so the arm exercises the production path.

---

## FINDING 4 — INFO: the fork gate's status check is unreachable under `set -euo pipefail`

**Construct.** `scripts/run-tests.sh`:

```bash
CBOB_FORK_FROM_RUNNER=1 bash "$ROOT/sim/swap-fork.sh" 2>&1 | grep -vE "Waiting for first slot|No wallet available" | tail -16
[ "${PIPESTATUS[0]}" -eq 0 ] || die "the swap fork failed"
```

The script is `set -euo pipefail`. A failing fork makes the pipeline's status non-zero (pipefail), so the shell exits **at the pipeline** and the `PIPESTATUS` line never runs. The run still fails (correct outcome, exit 1), but the diagnostic the line exists to print — and the distinction between "the fork failed" and "the fork was skipped" — is lost.

**Evidence.** `bash -c 'set -euo pipefail; false | tail -1; echo unreachable'` prints nothing and exits 1. The detector, allocation, poster and mainnet blocks in the same file already use the correct shape (`RC=0; OUT=$(cmd) || RC=$?`).

**Fix.** `RC=0; OUT=$(CBOB_FORK_FROM_RUNNER=1 bash "$ROOT/sim/swap-fork.sh" 2>&1) || RC=$?; echo "$OUT" | grep -vE … | tail -16; [ "$RC" -eq 0 ] || die …`.

---

## THE TARGETS I CHECKED AND FOUND SOUND (so the next reader does not re-do it)

**R1 — the crank.** I walked every plan the program can refuse and could not construct one the program refuses with a non-benign error, nor one that pays or joins a dead vault, nor one that moves value anywhere the program does not already pin:
- *Join gate / tick:* the planner's `w` (`total_active_weight + preJoinWeight − retiringWeight − expiringWeight`) and its `joinable` flag reproduce the program's `waiting_to_join == 0` precondition for both the credit and the tick branch; the tick's `waitingThisEpoch = pending_this_epoch − retiringThisEpoch > 0` matches `!burn && c.pending_this_epoch > 0` after the retires, and the burn path is never used (`distribute(false)` only).
- *Ordering:* preJoins are sent before the split/distribute, `expire before` before the distribute, `expire after` after it — and an `expire_boosts` batch sent after a **failed** distribute is a harmless no-op, because the program's `expire_boosts` skips any record whose `boost_end_epoch` has not been reached.
- *Reveals:* strictly from `cfg.revealed_total` in index order, hash-checked against `attrs_hash` before a fee is spent, `[]` only for a positively burned asset, `break` on skip/benign so the FIFO is never violated.
- *Claims:* every pair is `(record, r.vault_ata)`; the owed figures for the three cases (`joinedNow`, `preExpired`, general) match `join`/`expire_boost`/`owed_of` exactly, including the carry.
- *Fee budgeting:* `planCostLamports` counts exactly the transactions `main()` sends (`preJoins`/`preExpires`/`postExpires` by batch size, `claims` by batch count, plus per-reveal attribute rent), and `budgetPlan`'s floor/ceiling split has the four-way arm (`funded/short × above/below ceiling`) in the selftest.

**R2 — the alarm.** No dangerous on-chain state in the enumerated set reads as quiet, and no routine state pages on every pass, beyond what the detectors deliberately do (`joins_waiting`, `sales_stopped`, `guardian_retired`, `sweep_*_wedged` are INFO; `redemptions_near_cap` is a real rush signal at 20% room). The freeze transition set (`applyFrozenTransitions` keys `<kind>:<asset>:<mint>`) distinguishes a pool, a revenue-account and each vault-account freeze, thaws on disappearance and re-pages on refreeze. Recovery bookkeeping (`prevPaged` ∪ `run_failed` marker → recovery only for level kinds, marker deleted only on a delivered full pass) is correct in both directions.

**R3 — the layouts.** I recomputed the offsets by hand: `MintConfig.governance` = 41, `minted_total` = 141, `bare_burns_retired` = 454 (matching GOV's and BURN's pinned `OFF_*`), `VaultRecord` fixed length 211 (`VAULT_RECORD_SPACE − RECORD_PADDING`), `MintConfig` fixed length 1005. `SEEDS` has 11 entries, all mapped to a scraped Rust constant, with the unmapped case caught. The round-24 D6 assertion now exists and is real (it checks `Object.keys(L.SEEDS).length === 11` as well as each value, so an empty or partial map cannot pass). `parseRustStruct` throws on a line it cannot read, so a private/`pub(crate)`/multi-line field cannot be silently dropped. No defect.

**R4 — the money arithmetic.** `credit`, `pendingScaled`, `reweigh`, `ceilSats`, `available`, `debtAtActivation` are line-for-line the Rust (`credit`, `owed_of`, `reweigh`, `ceil_sats`, `join`). The two expiry branches in the planner reproduce `expire_boost`'s `carry = owed` / `debt = level_weight × acc` split. No divergence found.

**R5 — the swap and the revenue cycle.** (a) `oracleFloor`'s exponent handling is right for either sign (`e = es − eb`; numerator × 10^e or denominator × 10^−e), the expected output and the floor are BigInt end to end, and the rounding is floor. (b) `readPyth`'s offsets recompute correctly (`o = 40`, level, feed at 41..73, price 73, conf 81, expo 89, publishTime 93 — the fork's `stamped()` writes 93 and the selftest's fixture writer writes 73/81/89/93, consistent). Owner + derived PDA is sufficient: only the push-oracle program can sign for that PDA, so only it can write the account, and the age is judged against the chain's Clock with a 30 s future bound. (c) `orcaSpot` = (sqrt_price/2^64)² and `meteoraSpot` = 1/(1+bin_step/1e4)^active_id both land at ≈1.4e-4 sats/lamport against the same oracle, i.e. the right quantity in the right direction (Meteora is the reverse of Orca and the reader refuses the wrong token order). (d) the floor in the instruction is the same number the judge is told and the return is held to. (e) the judge now pins the exact seven-instruction sequence, the output account, the amount, the threshold, Orca's direction and price limit, the absence of a priority fee, and both ATA creations' payer/account/owner/mint; I could not construct a tamper that passes it and moves value outside the accepted box-owner residue. (f) the tick-array and bin-array derivations and orders match the published interfaces; an uninitialised array is refused by the venue program, which routes to the fallback rather than to a silent loss. (g) wSOL: exact input, close back to the operator, old operator-owned residue returned to the operator and not counted as this cycle's output. (h) only a **refused** Orca send falls through to Meteora (`classifySendFailure` asks the chain); `unknown` stops the cycle open and loud.
(i) **The bound, as numbers.** The read-time gate (100 bps) does not bind execution; the binding constraint is the on-chain floor, 150 bps below the *fresh* oracle read. So the worst honest execution per cycle is ~150 bps of the expected output — at the ruled 10 SOL cap and SOL≈$120 that is ≈0.15 SOL ≈ $18 per cycle, ≈$72/day, ≈$2,160/month at four cycles a day, and it is further bounded by what the revenue PDA holds above the 0.05 SOL reserve (the sweep itself is capped at 10 SOL per 6 h). A sandwich, or a pool pushed to just inside the 100 bps gate at read time, cannot do better than that floor; a Meteora pool at ~10× thinner liquidity changes the *impact* term, not the floor. The operator key's worst case is unchanged in shape — `max_sweep_lamports` × cooldown windows until the guardian pulls `emergency_stop_sweep`, never more than the revenue PDA holds above the reserve — and its trust list is now two pool programs plus the oracle rather than an HTTP reply.

**R6 — the gates.** All floors are equalities (`floor()` and the selftest's `FLOOR = 860` both check `-eq`), and each is derived from the real count: 848/860/39/22/14/47/33/6/71/16. I checked the three gates that could be vacuous and they are not: the control-table gate fails when the block is empty (`block.length >= 5` is a separate assertion), the watched-key gate fails on an empty map, and the DAS-reader discovery asserts `dasFiles.includes('alarm.mjs')` so an empty discovery cannot pass. `judgeCronTemplate` accepts `$FLOCK` only when the variable is defined with `-n` in the same file, and the `ours <job>` preserves are anchored to end-of-line, so `crank-reveal` cannot arm the full pass. `build-mainnet.sh` builds and compares all five programs, proves the helper's mainnet bytes equal both the localnet build and the artifact the suite deployed, and refuses a dirty tree.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?** I found none, and I re-read the ones with the most room to be understated. Item 10's bound ("cap × cooldown windows until the guardian pulls `emergency_stop_sweep`, never more than the revenue PDA holds above the reserve") is exactly what `sweep_sol_for_swap` enforces. Item 41 (transfers unlimited) is true — nothing rate-limits a Core transfer. Item 28's forfeit, item 44's "Token-2022 strays and frozen strays are not covered" and item 46's positive bound all match the code (`read_token` demands a 165-byte classic account; a frozen source reverts the transfer). Item 26's "best-of-4 alone takes P(Level V) from 5.0% to 18.6%" matches `blockhash_in_window`'s inclusive `[want, want + 64]` search. Item 32's "the cap can read one higher" matches `redemptionCapacity`'s `minted − burned − bare_burns_retired`. The only place I would sharpen the wording is item 22/25: nothing states that the **alarm** is the thing whose stall makes all the detection-only limits (9, 44) unmonitored — which is why finding 1 is a MEDIUM rather than a curiosity.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?** No. I specifically checked the three that looked closest to being closed by something unnamed: item 9 (a foreign nested asset) is *not* closed by the sweep helper — the helper only moves classic SPL token accounts, so a nested Core asset still dies; item 44's Token-2022 exclusion is real in `programs/cbob-vault-sweep/src/lib.rs`; and item 29 ("only cbBTC splits") is real because `split_revenue` requires `mint == cfg.payment_mint`.

**3. Is any DISCHARGED item not actually discharged?** No. Item 19 holds by construction (`activate` requires `1..=5` before a record can become `pending`, and `join` is reachable only for a `pending` record, so no activated vault can be unlevelled). Item 14 holds (`check_attributes` refuses `DuplicateAttribute`). Item 12/17 and 54 are measured, with the legacy/v0 scope now stated. Items 30/31/33 are gone with the fields they were about. The v5 Bank/deck/distributor items are gone with the files (`cosign.mjs`, `deck.mjs`, `distribute.mjs`, `bank-sign.sh` — and the selftest asserts none is imported).

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Items 22, 38, 50, 52 and 53 are all still open in the documents, and the round-27 validation record says so explicitly ("The live Phantom ceremony, both-venue revenue cycle and forced post-sweep recovery remain open"). Item 38's two dates are still `null` with status `OPEN`, and `check-launch-params.mjs` refuses the file on that alone. I would add one sentence to item 22's list: the rehearsal must also demonstrate that a **v1** transaction touching a CBOB program does not stall the alarm (finding 1) — otherwise the rehearsal can pass while the watcher is one transaction away from dead.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The programs are the part AI audit can actually close: they are small, they have 848 assertions against real cloned Core, and the remaining risk in them is enumerated. The off-chain pipeline is where the structural gap is, because it is *not* frozen by the lock and it is the only control for several permanent on-chain consequences. Concretely, before launch:

1. **Run the dress rehearsal (item 22) as written, and add one item to it: a v1-with-lookup-table transaction against a MINT instruction, then two alarm passes, proving the cursor still advances.** That is finding 1's evidence, and it is the only way to settle it without guessing about the RPC's v1 shape. Same run should force one RPC fault (a socket that accepts and never answers, a 429, a `result: null`) through the crank, the alarm and the revenue recovery — the suites never do this, and every one of those paths is a throw away from a stalled cursor or an open cycle.
2. **Reproducible-build verification on a second machine and toolchain, from the release commit, against `dist/SHA256SUMS`.** `build-mainnet.sh` says outright that it cannot prove the compiled `INIT_AUTHORITY` constant is Gary's key — a third wrong key would reject the test key identically. The entire "who can initialize" claim rests on reproducibility plus the source grep, and that bridge has to be walked once by a human who is not on this box.
3. **The Phantom ceremony, with the four `initialize` transactions built FROM `launch/mainnet-init.json` and each landed value read back and diffed against that file.** Item 38's own note says the checker validates the JSON, not the transaction, and the programs check less than the checker does. A wrong `redeem_window_secs` or a wrong census is permanent.
4. **An off-box witness.** Limit 10 (3) says the detection half does not survive a compromise of this box: the ledger, the crontab and the alarm belong to one user. A cron on a *different* host, with an independent RPC, that reads only the chain and pages on (a) any of the five programs still having an upgrade authority past the deadline, (b) the PoB collection's plugins or update authority changing, (c) `mint.split_bps != 8500`, and (d) the pool's or revenue account's state byte going to frozen — closes the class the box cannot see about itself, and it costs one script.
5. **Delete the keys, on chain, and record it.** After the lock: verify `solana program show` reports no upgrade authority for all five programs, and that the alarm is *not* running with `CBOB_ALARM_REHEARSAL=1` in production (the switch that turns off `test_value_in_production` and every lock check is an environment variable, and nothing but the report header proves it is off). Then destroy the deploy keypairs, and confirm the alarm pages nothing for a full pass.
6. **Custody review for the four hot keys the code cannot fix** — the swap operator, the $CBOB release wallet, the crank fee payer, and the PoB collection's update authority through the charter window. The first two are ruled and documented; the fourth is the one that can end the project before it starts, and the only mitigation in the tree is a detector that samples state every 30 minutes.
7. **The DAS read of a collection holding a burned Core asset (item 22.5)** — whether DAS sets `burnt` decides whether `detectVaultSetChange`'s burn correlation works at all, and no local test can answer it.
8. **A live revenue cycle through each pool and one forced post-sweep failure walked through the hand recovery**, as item 22 names them. `bank/revenue.mjs` runs in no suite, sim or fork; its selftest arms read its source. It is the one file that holds a key and moves money, and nothing has ever executed it.