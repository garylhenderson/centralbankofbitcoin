# CBOB v6 off-chain audit, round 25: findings

Method and limits: I read every bundled file and recomputed what I could by hand (account offsets, PDA seeds, instruction account orders, the oracle arithmetic). I ran nothing. Each finding below states the evidence that would exist if I am right, so it can be checked quickly.

I found no CRITICAL or HIGH. The worst problems are in the revenue cycle's untested and unrecoverable parts and in the reveal lane's lack of a runtime bound.

---

## R5. The swap and the revenue cycle

### M-A (MEDIUM). `revenue.mjs`'s cycle, from "re-price after the sweep" to the split and ledger recovery, has never executed against any chain. Its gates are greps.

**Construct.** `bank/revenue.mjs` `main()` steps 2–4 and the L11 recovery block. `sim/swap-fork.mjs` proves only `swap.mjs`. The fork has no MINT deployed, so `sweep_sol_for_swap`, the delta calculation, the return transfer, `split_revenue` and the ledger writes are never run. The selftest arms for `revenue.mjs` are `/jup\.ag/.test(source)`, `/from '\.\/swap\.mjs'/.test(source)` and `/closesCycle\(c, splits/.test(source)`. Item 22 (OPEN AND BLOCKING) names only the crank, so this file's first execution would be on mainnet with the operator key.

**Gain.** A runtime error after the sweep leaves SOL on the hot key and an open cycle (see M-B).

**Evidence if I am right.** No test file imports and runs `main()`, and the revenue arms in `selftest.mjs` are all source regexes.

**Fix.**
- Add `revenue.mjs` to the dress-rehearsal gate, or to a fork run with MINT deployed. A fork test is feasible by cloning the swap-fork state and also deploying MINT.
- Make one full sweep, swap, return, split cycle a named pass/fail item.
- Add it to the OPEN AND BLOCKING list.

### M-B (MEDIUM). Every post-sweep failure strands SOL on the operator key. There is no resume path, no retry, no priority fee, and "refused" is classified by message text.

**Construct.** `revenue.mjs` after `cycle.sweptLamports = ...`.

- **Re-checks after the sweep.** `m2` re-checks the oracle age, the 2% drift and venue availability after the SOL has moved. Each failure ends in `throw ... must be swapped by hand`.
- **Open cycle blocks everything.** `cycleIsOpen` then blocks every later run, and no `--resume` exists. Only `--audit` and `--probe` do.
- **Zero priority fee.** `swapInstructions` sets only `setComputeUnitLimit`, so there is no priority fee.
- **Expiry reads as "unconfirmed".** A dropped transaction ends in a blockhash-expiry error. That error does not match the `refused` regex, so it is rethrown as "unconfirmed". It was provably not landed, but the cycle stays open.
- **Failure after a passing preflight.** A transaction that passes preflight and then fails on chain is reported by web3.js as `Transaction <sig> failed ({"err":{"InstructionError"...}})`. Please check this against the installed version. It matches neither `custom program error`, `Error Code:` nor `Transaction simulation failed`. For the sweep this leaves an open `intendedLamports` row with no `sendRejected`. The alarm then pages `unreconciled_swap` CRITICAL for lamports that never left. For the swap it blocks the Meteora fallback.

**Gain.** Availability, not theft. Up to 10 SOL sits idle on a hot key until a human hand-builds a swap. No tool exists for that, and the swap builder is not exposed as a CLI.

**Evidence.**
- `grep -n resume bank/revenue.mjs` returns nothing.
- Force `sendAndConfirmTransaction` to throw an expiry error and see the open row with no retry.
- A congested-slot test with the zero fee.

**Fix.**
- Add `--resume` that finishes an open cycle: re-price, swap or return the SOL on the operator, then record. It must be idempotent against `opBefore`.
- Add a modest priority fee, and rebuild with a fresh blockhash after confirmed expiry.
- Decide "refused" by `getSignatureStatuses` and logs, not by message regex.
- Retry `market()` for a few minutes inside the cycle before throwing.

### L-1 (LOW). The 6-hour cron equals the 6-hour on-chain cooldown, so every other run is skipped.

**Construct.** `cron-install.sh` runs revenue at `41 */6 * * *`. `launch/mainnet-init.json` has `sweep_cooldown_secs` 21,600. `revenue.mjs` returns "cooldown ... Nothing to do" when `nowSec < lastSweep + cooldown`.

**Mechanism.** `last_sweep_at` is stamped by the sweep transaction, several seconds (oracle reads, ATA creation, confirm) after the run starts. The next cron start is exactly 21,600 s after the previous start, plus about 1 s of node startup. So `now < last + cooldown` is likely true. The effective cadence is 12 hours, and throughput is at most 10 SOL per 12 hours. This is a mismatch with the ruled "6 hours between sweeps".

**Evidence.** Consecutive ledger `startedAt` values 12 hours apart, with "cooldown: the last sweep was at ..." in `revenue.log` at the intervening slots.

**Fix.** Run the cron hourly (the cooldown gate is already there), or schedule at a phase offset smaller than the sweep latency. Move the cooldown gate after the "nothing to sweep" check, or add margin.

### L-2 (LOW). `judgeSwapInstructions` is not "the last line". It checks the program set, signers, pool presence, and the single wrap and close.

It does not check any of the following:

- **Swap output account.** The user-out account (Orca `ownerCbbtc`, Meteora `user_token_out`) is unchecked. Orca and Meteora let the output go to any token account of the right mint.
- **Swap instruction data.** The threshold, direction byte, input amount and price limit are unchecked.
- **ComputeBudget data.** A `setComputeUnitPrice` with a huge price passes. The fee is taken upfront from the key, and a failed transaction still pays it.
- **Token program instruction types.** Only the single close (`data[0] === 9`) is counted. `Approve`, `SetAuthority` or `Transfer` against the operator's cbBTC or wSOL accounts pass.
- **ATA creation arguments.** The wallet and mint passed to `createAtaIdempotent` are unchecked, so any count of ATA creations for any wallet passes.
- **System transfer.** Only `keys[1]` of the single System instruction is checked, not the discriminator, the source or the amount.

**Evidence.** Swap `ownerCbbtc` for an arbitrary token account in `orcaSwapIx` and `judgeSwapInstructions` returns `[]`. The offline selftest has no arm for this. The fork's SW.1 would catch it only because it reads the operator's own balance. `revenue.mjs` has no such check.

**Caveat.** The judge and the builder are one file under one trust domain, so this guards against bugs, not tampering. The SPEC wording "the transaction is judged before signing" over-claims.

**Fix.** Have the judge decode and pin every instruction: exact data prefix and lengths, output account equal to the operator's cbBTC ATA, ComputeBudget limited to `SetComputeUnitLimit` with a bounded value, and Token instructions restricted to `{SyncNative, CloseAccount}`. Also assert the number and order of instructions.

### L-3 (LOW). The floor's freshness and truth rest on the box clock and one RPC.

**Construct.** `market()` uses `Math.floor(Date.now()/1000)`. `oracleFloor` computes `nowSec - p.publishTime > 180`.

- **Future-dated prices pass.** A `publishTime` ahead of the box clock gives a negative age and passes. A box clock that lags the chain by minutes or hours accepts a stale price. The crank already moved to the chain Clock (I2), but the swap did not.
- **Single RPC.** The oracle accounts, the pool state and the deviation check are all read from the single Helius endpoint. The pool programs enforce `minSats` on chain, but the number is derived from RPC-supplied bytes. An RPC or MITM that lies about the Pyth account sets the floor arbitrarily low. A sandwich then takes up to nearly the whole swap instead of ~1.3%. This is a wider trusted set than limit 10 states ("the two pool programs and the Pyth price").

**Fix.** Measure age against the Clock sysvar or `getBlockTime`, and reject negative ages. Read the two Pyth accounts through a second independent RPC (or Hermes) and require agreement within, say, 20 bps.

### Bounds requested in R5(i) and the operator-key worst case

- **Honest-pool bound.** Floor = oracle × 98.5%. A fair pool returns about 99.84% after the 0.16% Orca fee. So a sandwich or an edge-of-gate pool can extract at most ≈ 1.3% of the swept notional per cycle. The deviation gate (100 bps) plus the fee leaves a legitimate pool at ≈ 98.84%, above the floor, so an honest cycle should not be refused by the floor.
- **Monthly bound.** At the on-chain maximum (10 SOL per 6-hour cooldown ≈ 1,200 SOL/month) this is ≈ 16 SOL/month. At the effective 12-hour cadence (L-1) it is half. That is not material unless royalty flow is near the cap.
- **Meteora.** The thinner pool lowers the attacker's cost to reach the gate edge but not the bound. Its dynamic fee can exceed the cushion, which makes the swap refuse (loud, M-B).
- **Stolen operator key.** Worst case is still cap × cooldown windows until the guardian stops the sweep, plus whatever else sits on the wallet.

### Checked with no discrepancy found (by hand-recompute)

- **Pyth.** `PriceUpdateV2` offsets (8 disc, 32 write authority, 1 tag with Full = 1, 32 feed, price at 73, conf at 81, expo at 89, publish_time at 93). Ownership by the receiver plus the derived shard-0 PDA. The feed ids.
- **Oracle math.** `oracleFloor` for every exponent sign, floor rounding, and `satsPerLamport`.
- **Orca.** Pool offsets (41/45/49/65/81/101/133/181/213), instruction data order, account order, tick-array seed and ordering, MIN_SQRT_PRICE.
- **Meteora.** `LbPair` offsets 76/80/88/120/152/184, the 15 fixed account positions with host fee as None, and bin-array seeds with floor division.
- **Spot direction.** `orcaSpot` is raw B-per-A and `meteoraSpot` is the inverse of raw Y-per-X, both in sats per lamport.

On Pyth ownership: a stranger cannot write a chosen price. The push oracle only copies Wormhole-verified updates and is monotonic in `publish_time` (I recall an `UpdatesNotMonotonic` check in the push oracle; please verify). The residual is choosing among genuine, newer-than-current signed updates within the 180-second window.

### L-5 (LOW). Orca needs all three tick arrays initialised, and its boundary failures fall back silently to the thin pool.

**Construct.** `orcaTickArrayStarts` supplies three arrays at and below the current tick, none above.

**Mechanism.** If the second or third array is uninitialised, or the price crosses up into the neighbouring array between build and landing, Orca refuses at preflight. That reads as "refused", so the Meteora pool (~$0.9M) is tried with no log line distinguishing the cause.

**Fix.** Log Orca's refusal reason and check array existence in `market()`. Mark venue selection as degraded when Orca is skipped.

---

## R1. The crank

### M-C (MEDIUM). No wall-clock bound on either lane. A hung RPC call silently wedges the reveal lane, and the draw windows lapse.

**Construct.** `new Connection(rpc, 'confirmed')` has no fetch timeout. `getProgramAccounts` and `getMultipleAccountsInfo` can hang indefinitely on a stalled connection. The cron lines are `flock -n ... node bank/crank.mjs --reveal-only`. While the holder lives, `flock -n` exits 1 every minute with nothing logged (limit 6).

**Why this is worse than limits 7 and 25 say.** Limit 7 says a stall is survivable because of the alarm and in-line traffic. Limit 25 says traffic captures nothing unless it names the record. A hung reveal lane therefore stops all captures:

- Every vault minted in that period lapses its 2-minute window, and each minter who computed the public draw gets a re-roll when the lane recovers.
- The first page is `reveal_queue_stalled`, 30–60 minutes later.
- The lapse logs nothing until someone reschedules.

**Evidence.** Run the reveal lane against a black-holing socket and see `ps` still holding it while `crank-reveal.log` shows nothing.

**Fix.** Run `timeout 90 node ...` in the cron line, or use a `fetch` with `AbortSignal.timeout` for the Connection. Add a reveal-lane heartbeat the alarm reads. This has the same shape as `crank_silent`.

### Checked with no discrepancy

- **Account orders** match MINT's `#[derive(Accounts)]` for all ten instructions.
- **Claim batch size.** 14 pairs fit a legacy transaction: I count ~1,201 bytes.
- **Plan order and gating.** The plan sequence against the program's refusals (`JoinWaitingFirst`, `BoostsExpireFirst`, `PoolShort`, `NothingToDistribute`, then `MonthNotElapsed`). The owed arithmetic with boost, carry and pre-expiry.
- **Races.** `judgeDistributeRefusal` is sound for the races I can construct. The crank's own earlier sends cannot move `dist_epoch`, because the pre-join claim's in-line run is blocked by the waiting vaults.

---

## R2. The alarm

I found no state that is dangerous and read as quiet, apart from these:

- **Operator wallet residue.** Nothing watches the swap operator wallet (stranded SOL, cbBTC or wSOL after a failed cycle), apart from `unreconciled_swap`, which the ledger writer can influence. A balance watch on the operator address is cheap and independent of the ledger. This is the strongest answer to limit 10(3).
- **Closure slack in `closesCycle`.** The `afterMs - 60_000` slack lets a split up to 60 seconds before the return anchor a cycle, if it is at least as large as the return. This is LOW because the crank's hourly split divides the stranded cbBTC anyway.

### Notify-path questions

- **Repairs.** The per-kind streams, urgent flag, recovery path and frozen transitions read correctly. `defangForRouter` is applied only to non-urgent text, and urgent text is classified first.
- **One-shots that can reach no human.** Any one-shot that depends on the router's "urgent with new text breaks through" fix cannot be checked from the repo. The selftest does run the router, so it fails loudly if that behaviour regresses.
- **Routine pager.** I found nothing that newly pages every pass. The reveal lane's failure notice is sent every minute on the same label and relies on router suppression.

---

## R6. The gates

### L-4 (LOW). Gaps in the swap gates, plus ids and builds not tied to the keypairs.

- **Deviation filter untested.** `deviationBps`, `orcaSpot`, `meteoraSpot` and the venue-selection logic in `market()` have no offline arm. The only evidence is fork assertion SW.0, which expects `true,true`. A `deviationBps` that always returns 0, or a spot function that returns the oracle price, passes SW.0. No arm shows a pool 2% off being refused. It needs a unit test with synthetic `sqrtPrice` and `activeId` in both directions.
- **Judge arms.** The offline arms cover second signer, two swaps, foreign program and missing close. Only the fork covers the wrap destination. See L-2.
- **`readPyth` arm is circular.** It builds the buffer with the layout under test. Only the fork's real clone (and the owner/feed check) validates the layout. That is acceptable only if the fork runs. In non-ship-gate runs it is SKIPPED when DNS fails.
- **Program-id and keypair consistency.** I saw no arm comparing the program ids typed in `layout.mjs`, `detectors.mjs`, `alarm.mjs` and `revenue.mjs` to each other, to `declare_id!`, or to `target/deploy/*-keypair.json`. For the sweep helper (native, no `declare_id!`) the keypair is the only source. `build-mainnet.sh` proves the sweep bytes equal the localnet build's bytes, not that the deploy keypair is `EB2uVvs...`. Check whether it exists elsewhere.
- **Wiring gate is textual.** The `consumed()` regex test is satisfied by `...D.detectConfigDrift(cfg, prev?.config)` (arguments swapped), or by a call in dead code.
- **Tested vs shipped bytes.** The `cmp` in `build-mainnet.sh` compares two builds in two target dirs, not the `target/` build the suite actually deployed. They are expected to match, but that is not proven.

---

## The four questions on the accepted limits

1. **Is any limit worse than stated?**
   - **Limit 7 / 25.** Yes (M-C): a hung lane is the unattended cause of the re-roll class, with no adversary needed to cause the hang.
   - **Limit 10.** The trusted set includes the box clock and the single RPC (L-3). The effective cadence is 12 hours, not 6 (L-1).

2. **Is anything listed as a limit not actually a limit?** The D2 line "`OPERATOR_FLOOR` IS the 0.02 SOL float and nothing refills it" overstates. A cycle's fees are about 20,000 lamports (≈ 0.00002 SOL), and the ATA rents are refunded or one-time. 0.02 SOL funds hundreds of cycles, not "one".

3. **Is any DISCHARGED item not discharged?** None found. I checked the boost ring indexing and the retired-record skips against MINT and found nothing wrong.

4. **Is any OPEN AND BLOCKING item quietly treated as accepted?**
   - **Missing item.** Execution of the revenue cycle (M-A) is not on the list. Item 22 names only the crank. It should be blocking.
   - **Stale text in item 50.** Item 50 still says the sweep helper "is being built", but it is in the bundle.

## Sweep helper

No defect found in `programs/cbob-vault-sweep/src/lib.rs`.

- The `signer` check plus `src_owner == signer.key` means a direct call can only move the caller's own accounts.
- Closing a source twice fails, because the second read fails `IllegalOwner`.
- A transfer to zero lamports from a data-less PDA is allowed.
- Accounts the page does not name are not swept. That is already documented.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the real money path once on mainnet, small, with the real operator key.** Do a sweep, swap through Orca and through Meteora, return, split, and let the alarm judge it. Do this on the dress-rehearsal programs. Deliberately force a post-sweep failure and walk the hand-recovery runbook (M-B) with a human who has not read this code.
2. **Run a 30-day soak of the alarm and crank on the rehearsal deployment.** Include a pager with a named human on call. Measure how often the router actually delivers and breaks through. Test the guardian stop end to end with the real wallet.
3. **Fix the cadence and timeout issues empirically.** Show the ledger's `startedAt` spacing (L-1), and `kill -STOP` the reveal lane to see how long until a human is paged (M-C).
4. **Key ceremony and custody, by humans.**
   - Hardware-wallet signing for `initialize` and for `set-upgrade-authority --final`.
   - Check each program's `ProgramData` on chain afterwards.
   - Decide the fate of the box-resident keys: the $CBOB release wallet and the operator and crank keys. The box that holds them also holds the ledger and the alarm.
5. **Reproducible builds.** Have a third party rebuild the five programs from the release commit, compare hashes with `solana-verify` or an equivalent, and publish them before the lock. Re-run the rehearsal tree at the release commit (item 53 is stale).
6. **An independent re-implementation.** Have a human write the payout accumulator, the draw and the Pyth/Orca/Meteora parsers from the specs in a second language, then differential-fuzz them against these implementations. The author's oracle can never find errors that both implementations share.
7. **Economic review of the one-time values.** The sale-at-floor round, the cap at 2,100, the 21% quorum against actual PoB holdings, and the weight/boost ceilings. These are permanent after the lock, and nobody has been paid to attack them.
8. **A pre-lock decision on anything still possible.** Anything that would need a program change must be decided now, for example making `mint_vault` top-level only (limit 43) and holding the Moments collection key cold through the charter window (limit 46). After the lock these cannot change.