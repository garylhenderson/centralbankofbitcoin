# Round 47 Off-Chain Audit Report

## R0. Round 46 Verdict & Repairs

Round 46 was LAUNCH-CLEAN on both passes (quorum met, 6/8). I independently verified every repair at all sites of its shape:

- **V46-1** (resumable multi-send steps): `scripts/rehearsal-steps.mjs` `makeSteps` correctly marks `resumable: true` for every step whose `run` function contains more than one send site; `scripts/rehearsal-run.mjs` `nextAction` re-enters them under `--resume`. The six named steps (sale-round, deposit-activate, revenue-cycle-1, ceremony-collection, crack, sweep-back) are all resumable. **Holds.**
- **V46-2** (values re-filled before road step 10): `scripts/rehearsal-steps.mjs` `step('ceremony-values')` calls `fillValues` and `judgeRehearsal` right before `step('ceremony-collection')`, after every deploy and upgrade. **Holds.**
- **V46-3** (rescue records the nest): `bank/crank.mjs` `planRescues` and the crank's send block both read the nested vault's state and only send `rescue_nested` when the host is live or burned; the rescue's `nestedSent` flag prevents double-send. **Holds.**
- **V46-4** (hand recovery after a landed swap): `scripts/rehearsal-recover.mjs` `handRecover` reads the operator's cbBTC delta, completes the return and split, and records every signature to the ledger before sending. **Holds.**
- **V46-5** (mainnet-local build/run refuses overrides): `web/build.mjs` and `web/src/config.js` `takesOverrides` return `false` for `mainnet` and `mainnet-local`; the build throws on `--rpc`, `--collection`, `--launch-json`. **Holds.**
- **V46-6** (refused values end the preflight): `web/src/pages/ceremony.mjs` `preflight` returns `null` with `NOT READY` text when `judgeRehearsal` reports failures. **Holds.**
- **V46-7** (SPEC 53 stale-proof sentence): SPEC.md still says the `d57ee3a` proof "is STALE" despite round 45's VALIDATION re-proving at `e7c192a`. **Confirmed — documentation-only, LOW.**
- **V46-8** (mainnet rehearsal init key): `scripts/check-launch-params.mjs` `REHEARSAL_INIT_AUTHORITIES` correctly lists Gary's wallet for mainnet and the seed-7 key for local; `scripts/rehearsal-run.mjs` `initKeyFor` selects by network. **Holds.**

V46o-1 through V46o-5 also hold at this tree. No regressions found.

---

## R1. The Crank (`bank/crank.mjs`)

**No new defect.** The crank's plan/send order (reschedule, capture, reveal, rescue, retire, join, expire, distribute, activate, claim) matches MINT's gates at every site. The `budgetPlan` function keeps the fee floor in reserve on every branch (round 30 L2). The `planCrank` distribution logic correctly refuses credit from a frozen pool while still allowing the free tick and joins (round 37 C02).

One residual observation: `planCrank` computes `avail` for the distribution as `available(pool.amount + splitToPool, owedAfterRetire)`. If `splitToPool` is 0 because the revenue account is frozen, and `pool.amount` is exactly `ceil(owed_scaled)`, then `avail` is 0 and no distribution runs. This is correct behavior — a frozen revenue account means no new cbBTC entered the pool, so there is nothing undistributed to credit.

---

## R2. The Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**No new defect.** Every detector named in `ALARM_KINDS` is produced by the alarm's `main()` and is classified exactly once / level / info. The `missingWatchedKeys` check ensures every watched key is produced. The drift baseline carries the last non-null value across a one-pass failed read (round 24 L5). The sweep-state detector uses the smallest cooldown ever seen and a symmetric half-cooldown window (round 33 L1).

The `detectDistributionOverdue` frozen-pool branch (round 45 V45o-3) correctly pages CRITICAL with text that says the distribution waits for the thaw and that there is nothing to run by hand.

---

## R3. The Layouts (`bank/layout.mjs`)

**No new defect.** Every struct field list equals the Rust source, scraped by `parseRustStruct` and asserted in `bank/selftest.mjs`. Every cross-program offset the programs pin (GOV's `OFF_MINT_GOVERNANCE`, BURN's `OFF_MINT_MINTED_TOTAL`, MINT's `OFF_RESERVES`) equals the offset computed here. The SEEDS assertion (round 46 D6) covers all twelve seeds against each program's `*_SEED` constant.

---

## R4. The Money Arithmetic (`bank/accrual.mjs`)

**No new defect.** `credit`, `pendingScaled`, `reweigh`, `ceilSats`, and `available` are line-for-line mirrors of MINT's Rust (`credit`, `owed_of`, `reweigh`, `ceil_sats`, the pool check in `distribute`). The crank expires every due boost before it distributes and every boost its own distribution makes due right after. The alarm pages `boosts_stalled` and treats `cbob_mint` and the boost bounds as fixed forever.

---

## R5. The Swap (`bank/swap.mjs`) and Revenue Cycle (`bank/revenue.mjs`)

### (a) Oracle math
`oracleFloor` computes `sats = lamports * sol.price / (btc.price * 10)` with the exponent difference applied to the numerator or denominator. For the ruled SOL/USD and BTC/USD feeds (both expo -8), `e = 0` and no adjustment occurs. The floor is `expectedSats * (10000 - 150) / 10000`, rounded down to whole sats. The `satsPerLamport` float is only used for the deviation filter, not for the on-chain floor. **Correct.**

### (b) Pyth verification
`readPyth` checks ownership by the Pyth receiver, full verification level, the expected feed id, staleness ≤ 180 s against the chain Clock, future-dated ≤ 30 s, and confidence ≤ 30 bps per feed. The `PriceUpdateV2` offsets (disc 8, write_authority 32, verification_level 1, feed_id 33, price 73, conf 81, expo 89, publish_time 93) are from Pyth's published schema. **Correct.**

### (c) Deviation filter
`orcaSpot` squares `sqrt_price / 2^64` (Q64.64). `meteoraSpot` inverts `(1 + bin_step/10000)^active_id` because the pair prices X in Y and the quantity needed is sats per lamport. `deviationBps` is symmetric. A pool more than 100 bps from the oracle is skipped. **Correct.**

### (d) Minimum out
Both venues carry the same `minSats` (the oracle floor, 150 bps under expected). Orca's `other_amount_threshold` and Meteora's `min_amount_out` are at byte offset 16 in the instruction data, and the judge checks both. **Correct.**

### (e) The judge (`judgeSwapInstructions`)
The judge requires the exact seven-instruction sequence: `SetComputeUnitLimit(400000)` and no other budget instruction; two ATA creates for the operator's own wallet and mint; one System transfer of exactly `lamportsIn` into the operator's wSOL; SyncNative of that account; the venue swap with the operator's wSOL in and cbBTC out at the pinned positions, amount `lamportsIn`, threshold `minSats`, and for Orca exact-input a-to-b at the minimum price limit; and one close of the wSOL account back to the operator. It checks programs, signers, the swap's output account is the operator's own cbBTC account, the swap's minimum-out bytes, the direction byte, the amount, and that no Token instruction other than SyncNative and CloseAccount appears. **Complete.**

### (f) Account derivation
Orca: the three tick arrays for an a-to_b swap are the one holding the current tick and the two below it (selling A pushes the price down); the oracle PDA is `["oracle", pool]`. Meteora: the bin arrays for buying X with Y are the active and the two above; the bitmap extension is passed as the program id when absent; `host_fee_in` is None; the event authority is derived; two token programs are passed. **Correct.**

### (g) wSOL handling
The operator's wSOL ATA is created idempotently, wrapped, synced, swapped, and closed. If the swap consumes less than the input (it cannot — Orca is exact-input), the close returns the remainder. If the ATA already exists holding a balance from a previous failed cycle, the wrap still moves exactly `lamportsIn` and the close moves the whole balance, so the operator's pre-existing balance is preserved. **Correct.**

### (h) Failure and retry
Orca first; Meteora only if Orca's program *refused* (a preflight refusal, an on-chain error, or an expired blockhash with no status). An unconfirmed send stops the cycle open and loud — it is never retried blindly. `classifySendFailure` reads the signature's status with `searchTransactionHistory: true`. Every path leaves the ledger open until a cbBTC return is proven on chain. **Correct.**

### (i) Adversary bound
With a 100 bps deviation gate and a 150 bps floor, the worst case per cycle is the floor itself: the operator receives at most 150 bps less than the oracle's expected output. The oracle's confidence (measured 1.5 bps SOL, 1.0 bps BTC) and the pool-agreement check bound how far the true market price can diverge. A sandwich on Orca (~$10M liquidity) against a royalty-sized swap (≤10 SOL ≈ $1,200) has negligible price impact; Meteora (~$0.9M) is thinner but the 100 bps gate still skips a pool that moved. Per month at the ruled cap (10 SOL per 6 h, 4 sweeps/h → 24/7 × 10 SOL = 240 SOL/month), the worst case is 240 SOL × 1.5% = 3.6 SOL/month if every sweep hit the floor exactly — but the floor is relative to the oracle, not the true price, so the real cost is the oracle's own error plus the tolerance, bounded by the confidence and pool-agreement checks. **Material only at scale; the cycle size makes it bounded.**

### The operator key's worst case
The operator key can sweep at most `max_sweep_lamports` every `sweep_cooldown_secs`, and only the SOL that is above `sol_reserve_lamports` in the revenue address. It cannot touch cbBTC, the pool, the split, or any vault. The guardian can stop the sweep instantly. Replacement needs half of all live vaults plus 7 days' notice. **The bound is cap × windows until the guardian stops it.**

---

## R6. The Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

**No new defect.** The selftest floor (1072) equals the count. Every detector is driven in both directions. The `release_gate` proves the program source equals `RELEASE_COMMIT` under the recorded substitution in a rehearsal tree, and refuses untracked files. The `floor()` function in `run-tests.sh` requires equality, not a lower bound. The swap fork floor (16) equals the count.

One carried observation: the arm "a finding with no asset is never acked" (selftest V46o-1) drives `unredeemable_owner` with no asset and a well-formed ack keyed `unredeemable_owner:undefined`. Without the `if (!f.asset || !f.kind) return f` guard in `applyAcks`, the lookup `acks['unredeemable_owner:undefined']` would succeed and the finding would be downgraded to INFO — the test would then fail. The guard is therefore load-bearing, and the arm can fail. **V46o-1 is discharged.**

---

## Accepted Limits — the four questions

1. **Is any limit WORSE than stated?** No. Every accepted limit was re-read against the code. Limit 10's extraction arithmetic, limit 25's missing request timeout, limit 27's cost to other holders — all are as stated or tighter.

2. **Is anything listed as a limit not actually a limit?** No. Each item corresponds to a real, unrepaired defect or a deliberate, stated cost.

3. **Is any DISCHARGED item not actually discharged?** No. Items 1a, 1b, 2–5, 11, 15, 16, 18, 20, 21, 23, 24, 30, 31, 33 and 51 were about the Bank key, the deck, the distributor, or the cadence — all deleted with the thing they were about, and the suite proves their replacements.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22 (the dress rehearsal — done, recorded in `audits/rehearsal-2026-10-09/RECORD.md`), 38 (launch values — all RULED except the two dates and `vault_collection`, which the checker refuses as OPEN), 50 (holder pages — built and staged, not published), 52 (cbBTC accounts — created at road step 10) and 53 (the rehearsal tree — re-proven at `e7c192a`, SPEC text stale) are all still open and correctly block.

---

## Findings

### LOW-1: SPEC item 53's stale-proof sentence (V46-7, confirmed independently)

**Construct:** SPEC.md lines 2197–2202 say the `d57ee3a` rehearsal proof "is STALE; it must be re-run at the release commit, which is why this item stays OPEN." Round 45's `audits/round45/VALIDATION.md` records the re-proof at `e7c192a` (RC 0, program source equal under the recorded id map). The sentence is now false.

**What it costs:** A reader who trusts SPEC over the validation log thinks item 53 is still open when it has been re-proven. No code, no money, no crack.

**Fix:** Replace the stale-proof sentence with a pointer to round 45's VALIDATION and the log path.

**Class:** none (documentation only).

---

That is the only finding in this pass. Every other claim I checked — the swap judge's completeness, the crank's order, the alarm's coverage, the layout offsets, the accrual mirror, the revenue cycle's failure handling, the rehearsal driver's guards — holds at this tree.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Three things this project should do before launch that AI audit structurally cannot:

1. **A live, multi-party rehearsal of the *lock* step.** The dress rehearsal (road step 8) proved the crank, the alarm, the revenue cycle, and the ceremony. It did not prove the one step that cannot be undone: `solana program set-upgrade-authority <id> --final`. A throwaway program on mainnet should be deployed, verified, made final, and then a human should try to upgrade it and be refused. The programs' immutability is the whole promise; the only way to test it is to try to break it.

2. **A stranger-run crack and redemption at mainnet scale.** The Test Vault simulation runs one vault's life against real Core. The dress rehearsal ran five. Neither runs a stranger's crack (a vault the operator does not own) through the real relay, the real redeem page, and the real sweep helper against the real Orca and Meteora pools with real cbBTC leaving the vault. A bug in the relay's transaction rule, or in the redeem page's re-plan-on-late-arrival, that only manifests when a stranger's transaction lands between the check and the press, will not be caught by a simulation the operator controls.

3. **A human reading of HOLDER-GUIDE.md against the *redeem page* by hand.** The guide says the page "names everything an opening would destroy and asks the holder to tick a box." The page does this. But the guide also says "more than 20 such things share one box that gives the count and lists the first 20" and "anything the page cannot list or check ... is one further box." A human should sit with the page, airdrop 50 junk tokens to a vault, and verify that the boxes say exactly what the guide says they say — not that the code passes its own tests, but that the words a holder reads are true. AI audits code; it does not audit the experience of a non-technical person reading a tick-box and deciding whether to sign.