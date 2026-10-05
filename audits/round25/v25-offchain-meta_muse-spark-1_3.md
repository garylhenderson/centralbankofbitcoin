You are wrong until you prove you are right. This pass reads the repairs first, because that is where the last defect lives.

# R0. ROUND 24 REPAIRS — did they fix it, everywhere, without breaking the next thing

## MEDIUM — H1 repair pages a standing freeze URGENT every pass, forever

**Construct:** `bank/detectors.mjs` `ALARM_KINDS` + `applyFrozenTransitions` + `planAlarmNotices`.

`pool_frozen`, `vault_account_frozen`, `revenue_account_frozen` are classified `'once'`. `applyFrozenTransitions` downgrades the 2nd and later passes to `severity: INFO, urgent: false`. `planAlarmNotices` then computes:

```
urgent = isOneShotKind(kind) || list.some(f => f.urgent)
```

`isOneShotKind('pool_frozen')` is true, so `urgent` stays true. The head for an urgent kind carries `at pass ${stamp}`, so the text is new every 30-minute pass.

**Gain:** not theft. Alert fatigue and the exact H1 failure in reverse: a frozen pool / vault / revenue account — a routine, weeks-long Coinbase state — emails URGENT every pass. The router since 2026-10-05 lets URGENT with new text break through an open stream, so every pass QUEUES. The stream never quiets, and the noise buries a new one-shot behind it.

**Evidence if true:** drive `applyFrozenTransitions` twice with the same freeze, feed both to `planAlarmNotices` with different `stamp`. Both notices have `urgent:true` and different text. The selftest asserts the first transition is urgent and the second is INFO, but never asserts the second notice is non-urgent.

**Fix:** classify the three frozen kinds as `'level'`, or make `planAlarmNotices` honour `f.urgent===false` over the table: `urgent = list.some(f=>f.urgent) || (isOneShot && list.some(f=>f.severity!=='INFO'))`. Standing then lists at INFO, news pages once.

## LOW — L1/L3/L6/L10/L11 hold as stated

Re-measured: `NothingToSplit` benign, `judgeDistributeRefusal` benign only when `dist_epoch` or `last_distribute_at` moved and never on `PoolShort`; split planned only when revenue, pool and Squads ATAs are all `ok` and unfrozen; `judgeFeePayer` minimum-before-ceiling and `budgetPlan` keeps captures plus affordable reveals in mint order; `sendRejected` + sweepSig/amount is `rejected_row_has_sweep` / `sweep_on_rejected_row`; explicit `splitSig` held to the same total-and-order anchor as `splitByOther`; horizon follows `sweeps` the scan saw; `cycleStartMs` capped by block time; `closesCycle` shared by alarm and `revenue.mjs`. No re-report.

## LOW — L4/L5/L7/L8/L9/I1/I2/I3/I4/I5 hold, with the H1 caveat above

Tri-state posture, carried non-null baseline, per-element `judgeReserveRead`, per-mint `reserve_fell` correlation, `mintedAfter` race window, chain-clock planning, `REDEEMED_POOL_FROZEN` parsing, RULED-everything plus 24h lock margin, freeze-transition set — all measure both ways. I5's standing INFO is undone by the MEDIUM above.

# R1. THE CRANK

No CRITICAL. One LOW worth writing down:

## LOW — reveal-before-retire wastes one reveal rent on an unrevealed bare burn

**Construct:** `bank/crank.mjs` `planCrank` reveal loop vs `retireBurned`, send order in `main()`.

An unrevealed bare-burned vault (`level==0`, asset `burned`) is both `retireBurned` and, if its entropy is ready, `reveal`. `main()` sends reveals before retires. `reveal_level` on a burned asset still draws (FIFO must advance) and still charges Core attribute rent, then the retire removes it. Retiring first would advance `revealed_total` the same way with no rent.

**Gain:** ~0.0001 SOL per such vault, paid by the crank key. Not a refusal, not a stall.

**Evidence:** plan with one unrevealed burned record ready: `reveal.length==1 && retireBurned.length==1`.

**Fix:** filter retired-this-pass addresses out of `plan.reveal`, or send `retireBurned` before `reveal`. No other change: the FIFO still advances via the retire path's accounting.

Otherwise: reschedule/capture/reveal in mint order, retire at any level, join-before-distribute, expire-before/after, split only into healthy destinations, free `distribute(false)` only, claims into recorded accounts with frozen deferred, fee-payer-only key, budgeted reveals. No plan the program refuses by construction was found, no value leaves MINT.

# R2. THE ALARM

## MEDIUM — `swap_operator == guardian` (or `== DEFAULT`) is quiet

**Construct:** `bank/detectors.mjs` `detectStandingRisks`.

There is no standing check that `mint.swap_operator` is set, is not `DEFAULT_PUBKEY`, and is not the guardian. `check-launch-params.mjs` refuses it at launch, but after init a vote could arm `guardian` as operator (`arm_swap_operator` refuses only `default`), and a drift to it pages once as `config_drift` then stands silent. Operator==guardian puts the trusted hop and the brake that stops it in one key: the thief who takes it keeps the SOL and cancels the stop by keeping office.

**Evidence:** `detectStandingRisks({'mint.swap_operator': GUARDIAN})` returns no `swap_operator_*` finding; `detectConfigDrift` fires once then never again.

**Fix:** standing CRITICAL while `swap_operator` is default or equals `guardian`, like `swap_operator_armed`. Both are legal on chain, which is why they must be loud.

No routine state found that pages every pass except the R0 frozen-urgent bug. No dangerous fixed-forever value, brake, pool, rate, reveal, boost, lock-date or PoB-collection state found reading as quiet.

# R3. LAYOUTS

No finding. `parseRustStruct` throws on private/`pub(crate)`/multi-line fields, field lists equal the Rust for all five structs, every `OFF_*` any program pins is scraped and compared with none scraped-and-ignored, versions (including sibling copies), `BOOST_RING==64`, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` scraped and evaluated less padding (`1005`/`211`), seeds all 11 scraped and compared, `encode`/`decode` round-trip with every refusal named. D6 is now a real gate.

Residual risk, stated not filed: the `OFF_*` scrape regex is `^const OFF_(\w+): usize = (\d+);`. A future `pub const` or re-spaced declaration would be unscraped and therefore uncompared, and the `unchecked` arm would not name it because it only names what was scraped. Pin the regex in a comment and add a count floor.

# R4. MONEY ARITHMETIC

No divergence found. `credit`, `pendingScaled`/`pendingSats` with `boost`+`carry`, `reweigh`, `ceilSats`, `debtAtActivation`, `available`, retire-subtracts-pending, `waiting_to_join`, epoch advance and `boosts_due` ring all match `cbob-vault-mint` line for line in BigInt. Crank expires every `dist_epoch >= boost_end_epoch` before distributing and every `boost_end_epoch == dist_epoch+1` after; alarm pages `boosts_stalled`; `cbob_mint`, `max_boost_weight`, `max_boost_epochs` drift CRITICAL.

# R5. THE SWAP AND THE REVENUE CYCLE — never audited before, moves value

## HIGH — `judgeSwapInstructions` does not judge the swap

**Construct:** `bank/swap.mjs` `judgeSwapInstructions`.

It checks: programs allowed, no second signer, exactly one swap naming the pinned pool, exactly one System ix, that System ix goes to our wSOL ATA, exactly one close of wSOL back to us. It does **not** check:

* the swap's output account is our cbBTC ATA,
* `other_amount_threshold` / `min_amount_out` bytes,
* direction byte (`a_to_b==1`), amount-in bytes,
* which ComputeBudget ix (a `setComputeUnitPrice` with a huge fee is allowed),
* that the two ATA creations create the accounts they claim,
* that the System ix is a transfer of `lamportsIn` from us (any System ix counts; amount and source unchecked).

A tampered `swapInstructions` (or a bug in it) that swaps to an attacker's cbBTC account, sets floor 0, flips direction, or adds a fee-draining ComputeBudget ix passes with `[]`.

**Gain:** full cycle funds if the builder is wrong or tampered. Box-owner theft needs no judge bypass, so this is a bug-catcher that catches nothing — the last line before the operator signs is decorative.

**Evidence if true:** build honest Orca ixs, replace `ownerCbbtc` with a random key, set data bytes 16..24 to 0, or append `ComputeBudgetProgram.setComputeUnitPrice({microLamports:1_000_000})`. `judgeSwapInstructions` still returns `[]`. The selftest asserts second-signer / two-swaps / foreign-program / no-close, never output-account or floor bytes.

**Fix:** pin the full expected keys and data: amount-in, min-out, direction, price-limit, vaults, tick/bin arrays, oracle, owner in/out ATAs, ATA-creation accounts, exactly one `setComputeUnitLimit(400_000)` and no `setComputeUnitPrice`. Fail on any extra ix.

## MEDIUM — any dust in the operator wSOL ATA bricks every swap

**Construct:** `bank/swap.mjs` `swapInstructions`: wrap `lamportsIn` → sync → swap exact-input → close.

`createAtaIdempotent` does not clear a prior balance, freeze, or delegate. After the transfer+sync the token amount is `prior + lamportsIn`. The swap consumes exactly `lamportsIn`, leaving `prior`. `closeAccount` requires amount zero, so the whole transaction reverts.

**Gain:** liveness grief for the price of 1 wSOL unit. The operator ATA is deterministic (`ata(WSOL, operator)`), anyone can create it and send 1 unit. Every Orca and Meteora attempt then fails closed until a human empties it by hand. Royalty SOL accrues, `royalties_unswept` pages after a day.

**Evidence:** fund `ata(WSOL, op)` with 1 unit, run the fork `swap()`; every send fails on close with amount-nonzero, nothing moves.

**Fix:** refuse to swap while `ownerWsol` holds a balance (read it in `revenue.mjs` before building, like `opBefore` for cbBTC), or sweep the prior balance first in a prior transaction. Never `close` unconditionally in the same atomic swap.

## MEDIUM — ComputeBudget fee unchecked drains the float

Same construct as HIGH. `allowed` includes `ComputeBudgetProgram.programId` with no constraint. A tampered builder adding `setComputeUnitPrice` passes the judge and the operator pays it from its 0.02 SOL float. One cycle can empty the float and wedge the next cycle at `OPERATOR_FLOOR`.

**Evidence:** append a price ix to honest ixs; judge returns `[]`.

**Fix:** as HIGH: allow exactly the one limit ix, refuse price ix.

## HIGH — Pyth `verification_level` tag and `PriceUpdateV2` offsets are asserted, not proven

**Construct:** `bank/swap.mjs` `readPyth`, `pythAccount`.

Code assumes level byte at `8+32` is `1` for FULL, `Partial = tag+u8`. If the Receiver IDL defines `Unverified=0, Partial=1(+u8), Full=2`, then honest fully-verified feeds (tag 2) are refused and partially-verified feeds (tag 1) pass the tag check and then fail the feed-id check one byte off — i.e. every swap refuses, liveness down. If the layout is `Unverified=0, Full=1`, it holds. Offsets for `price/conf/expo/publishTime` assume the message starts immediately after one level byte; a two-byte Partial would shift everything.

`pythAccount` derives `[alloc(2), feedHex]` under `push`. Ownership is checked against `receiver`. A PDA of one program owned by another is unusual enough to need a cited doc, and the code never checks the account address equals the derivation (the caller does, but `readPyth` alone does not).

**Gain:** either permanent refusal (if tag wrong) or acceptance of a partially-verified price (if tag collides). Both decide the floor every cycle trusts.

**Evidence if true:** read a live sponsored feed account: bytes at 40, feed id at 41..73, price at 73. Compare to the Receiver IDL. The fork test passing suggests tag 1 is what mainnet carries today, but that is one sample, not a pinned IDL assertion.

**Fix:** scrape the Receiver IDL for `VerificationLevel` discriminants and `PriceUpdateV2` field offsets in `selftest.mjs` like every other cross-program pin; assert `readPyth` against them; assert `pythAccount` seeds against Pyth docs. Until then this is an assumption under the money.

## MEDIUM — oracle age uses the box clock, the crank just stopped doing that

**Construct:** `bank/revenue.mjs` `market()` → `SW.oracleFloor({nowSec: Date.now()/1000})`.

A box behind the chain accepts a stale oracle as fresh (unsafe direction); a box ahead rejects fresh as stale (loud). Crank I2 moved to `Clock` sysvar for exactly this reason. The swap decides a 150 bps floor from that age.

**Evidence:** set box clock -300s; a 400s-old feed passes `MAX_ORACLE_AGE_SECS=180`.

**Fix:** read `SYSVAR_CLOCK_PUBKEY` like the crank, fall back to box only with a loud refusal to swap.

## LOW — `Number(w.sqrtPrice)` and `pow(activeId)` precision

`orcaSpot` casts a ~58-bit `sqrtPrice` to double (53-bit mantissa): relative error ~3e-6 (~0.03 bps), squared ~0.06 bps. `meteoraSpot` uses `pow` with `activeId` ~thousands. Both feed a 100 bps gate, so the error cannot flip the gate today, but neither is bounded in code or test. Pin an integer comparison (compare squared distances without floats) or assert max error <1 bps in selftest.

## LOW — minimum-out is the same floor the gate assumed, but Meteora fees are not in it

`minSats = expected*(10000-150)/10000` covers a 100 bps deviation + 16 bps Orca fee + royalty-size impact on Orca (~1 bps) with ~34 bps spare. Meteora DLMM fee (variable, often higher) and its ~13 bps impact at 10 SOL are not separately bounded. Result is fail-closed (refusal, nothing moves), never overpay. Document the venue fee assumption or size Meteora swaps smaller.

## LOW — failure/retry is correct, ledger stays open

Orca first, Meteora only on program-error/preflight refusal, never on unconfirmed send; open-cycle guard blocks a second sweep; `cycleIsOpen` closes only on `sendRejected` or split. No double-swap, no double-count, no failed-cycle-read-as-closed found. `splitsSince` bounded to 10 pages fails loud (cycle stays open), the safe direction.

## On (i): what 100+150 bps lets an adversary take

Worst honest pool at the gate edge (-100 bps) + floor -150 bps = 50 bps under oracle guaranteed to the operator even without malice. Sandwich/impact on a 10 SOL royalty swap: Orca $10M pool ~1–2 bps (~$0.20), Meteora $0.9M pool ~15–30 bps (~$3–$6). Stale-but-accepted oracle (180s, 1% conf, pool agrees within 1%): up to ~100 bps edge (~$12 on 10 SOL). Per 6h cycle at 10 SOL (~$1,200): tens of dollars max; per month (120 cycles, ~$144k flow): low four figures even if every cycle is edge-pushed. Not material to holders, material to nobody except the operator's reputation. The bound that matters is still limit 10: cap × windows until `emergency_stop_sweep`, ~10 SOL × 4/day.

Operator worst case restated: trusts two pool programs + Pyth, not HTTP. Correct. `OPERATOR_FLOOR` still equals the float with no refill, wallet-holds-only-cycle-funds still unenforced, box-compromise detection still dies with the box. Limit 10 says all three; no worse found.

# R6. GATES

## LOW — every floor is self-referential

`DET_FLOOR==677`, `ALLOC_FLOOR`, `POSTER_FLOOR`, `MIN_ASSERTIONS==774`, `SWAP_FLOOR==10` all require equality, but equality to a constant in the same tree means deleting assertions and lowering the constant together stays green. A floor that can be moved with the work it floors is a tripwire, not a lock.

**Evidence:** delete one assertion and decrement the floor; runner exits 0.

**Fix:** record floors in `audits/FREEZE.md` or a signed tag outside the tree, or require the count to only grow without an explicit `FLOOR_BUMP` commit message a human reviews. At minimum assert the count is non-empty where it matters (the wiring gate does not).

## LOW — wiring gate passes vacuously if detectors vanish

`V6_WIRED` is derived from `Object.keys(D)`. If every `detect*` export is deleted, `V6_WIRED` is `['parseCbobLogs']` and `wiringGate` on an empty alarm still returns `[]`. The gate proves the alarm uses what exists, not that what must exist does.

**Evidence:** stub `detectors.mjs` to export only `parseCbobLogs`; the `wiringGate` assertion passes.

**Fix:** assert `V6_WIRED.length` above a floor (like the H1 `emitted.length>60` arm), and pin the must-call list for money-adjacent detectors (`detectPoolHealth`, `detectUnreconciledRevenue`, `detectSplitClaims`).

## LOW — `build-mainnet.sh` proves bytes, not the lock, for the sweep helper

It proves all four programs reject the test key, the source names Gary's key, and `cbob_vault_sweep.so` mainnet bytes == tested localnet bytes. It does not prove the helper's upgrade authority (it has one; it is a program) is removed, nor that the deployed helper is the built one beyond sha256 recorded in `MANIFEST.txt`. Item 50 requires deploy+verify+lock with the four; the script covers deploy+verify, lock is still a manual `set-upgrade-authority --final` with no gate.

**Fix:** after deploy, assert `prog.sweep.upgrade_authority==IMMUTABLE` via the alarm before charter opens, and record the five `set-upgrade-authority --final` signatures in the manifest.

`cron-install.sh`: installs exactly six jobs, no retired job, reveal every minute, money opt-in preserved only from our uncommented tagged line with L12 anchored. No finding.

# THE ACCEPTED LIMITS — four questions

1. **Worse than stated?** No limit found exploitable beyond its text, except the H1-frozen interaction above which makes limit 28's paging noisier, not quieter, and limit 10's box-compromise residue which the text already discloses. Limit 26's best-of-4 math (5.0%→18.6%, weight 3.05→4.38) is correctly stated; limit 55's 100-$GARY edge is now correctly stated in SPEC and the holder guide.
2. **Not actually a limit?** Limit 51/54 correctly discharged. No ACCEPTED item found already closed by unnoticed code.
3. **DISCHARGED not discharged?** 51 (boost built, owner-only, buyer terms, ring wrap host-tested), 54 (114,598 CU capture, 518,929 CU full crank, default-budget refusal, holder-page rule) both measure. 12/17 correctly discharged with the item-54 caveat present.
4. **OPEN treated as accepted?** Yes — **item 50.** The holder guide still tells holders to “Only open your vault on the Bank's redeem page,” offers trigger-and-join, at-execution emptying, and X/website announcement, while `judgeRedemptionCoverage` has no page, `redemption-poster.mjs` has no sender, and the sweep helper, though built and watched, has no client. The guide hedges with “(being built)” in one line and commands the page in the next. Until the page exists, items 9 and 44 have no preventive control, exactly what 50 says. Do not demote it.

# ELSEWHERE — holder guide

Round 24's four falsehoods are fixed (level-draw selection, griefing as persistent not one-attempt, custodial keys, boost-terms one-sided rule). Remaining: “A payout is due every month: our payout job runs it” is true only if the crank is armed (`--live` opt-in, installed dry-run); unarmed, it is traffic or anyone. Qualify with “when armed; otherwise anyone can, free.” The frozen-pool forfeit (“only payouts credited and not yet delivered stay behind”) is now stated. The “newly activated vault can catch about an hour of extra sales” correctly states the 100-$GARY monthly-boundary edge.

# WHAT AI AUDIT STRUCTURALLY CANNOT DO BEFORE LAUNCH

1. **Execute against a live chain with 2,100 vaults.** The suite, sim, and fork prove logic on a quiet validator. Nothing has measured crank I/O at 2,100 records (RPC paging, 100-account batches × 63 legs, minute-lane keeping up, fee-payer refill, transient failure on vault 1,900), alarm full-pass latency (DAS pages + 6,300 token reads + four signature walks inside 30 min), or revenue timing (6h cooldown vs hourly crank split refilling the ATA that `isProvablyEmpty` recovery reads). Run the dress rehearsal at throwaway ids with the rehearsal value set and `CBOB_ALARM_REHEARSAL=1`, with real delays, and keep the logs. That is item 22/53, still open.

2. **Read what is not in the bundle.** This round cannot see `/opt/scripts/alert-router.py`, the deploy keys, the crontab, the ledger, or Pyth/Orca/Meteora IDLs except by quotation. Every cross-system pin (router `stream_key`/`RECOVERY`, Pyth level tag and seeds, Orca tick-array seed form and tick order, Meteora bin-array order and `host_fee_in=None` encoding) must be re-pinned by a human against the live artifact, byte for byte, before the lock.

3. **Stop a wrong CRITICAL from becoming a wrong change.** A third of past CRITICALs were measurement errors. With immutability, a wrong finding acted on is permanent. Require every HIGH/CRITICAL to ship with a fork or mainnet transaction that reproduces it, or be marked reasoning-only and need two independent reproductions before code changes.