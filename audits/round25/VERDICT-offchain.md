# Round 25, OFF-CHAIN pass: NOT CLEAN

The round audited commit `2b67fb1`, which is HEAD. The tree is clean apart from `audits/round25/`. Nothing was edited, committed or run against a validator.

**Counted auditors (6):** claude-opus-4.8, claude-sonnet-5.5, muse-spark-1.3, qwen3.8-2.4t-a95b, qwen3.8-max-0902, glm-5.3. That is exactly the 6-of-8 quorum.

**Not counted:**

- **sakana/fugu-ultra-v2.** Its request failed (`FETCH FAILED terminated`, 23 bytes).
- **grok-4.3.** It received the whole prompt: 322k input tokens, in line with muse's 326k and glm's 327k on other tokenizers. It wrote 3,838 output tokens (7.7k chars) and made no finding. Every section says "All measured clean", including things it could not have run: a live alarm pass, `sim/swap-fork.sh`, and `run-tests.sh` in the rehearsal tree. The one checkable claim at the centre of the new code is false. Its R5(e) says `judgeSwapInstructions` checks the output account, the min-out bytes, the direction byte, the amount, ComputeBudget and the ATA creations. Measured, it checks none of these (L1). So this is an affirmation template, not an audit, and it is excluded on the round-24 standard (a report whose content fails measurement wholesale does not count).

## Method

The triage was read-only. I read every counted report in full and the grok report, and checked each distinct claim against the code at HEAD. Scripts are in the scratchpad (`triage25o/`).

**Pure modules, measured with the real functions:**

- `judgeSwapInstructions` against eight tampers per venue (`judge.mjs`);
- `oracleFloor` against a lagging box clock and a future `publishTime`;
- `applyFrozenTransitions` → `planAlarmNotices` across two passes;
- `detectStandingRisks` and `detectConfigDrift` with the guardian as operator;
- `detectUnreconciledRevenue` on an intent-only row;
- the `closesCycle` slack;
- `carryConfigBaseline` old→missing→new;
- `judgeFeePayer`, `judgeDistributeRefusal`, `revealAttrSource`, `splitDecimalsByte`, `judgeReserveRead`, `crankArmed`, `crankPosture` and `clockUnixTimestamp`.

**Error shapes.** I built web3.js 1.98.4's own `SendTransactionError` (send and simulate) and `TransactionExpiredBlockheightExceededError`, then ran each through `revenue.mjs`'s refusal regex.

**Transaction compile.** I built the `sweep_sol_for_swap` transaction as `revenue.mjs` does and read its message header.

**Black-hole RPC.** I ran a local TCP listener that accepts and never answers, and pointed a `Connection` at it. Measured: **300.8 s** to the first error.

**Offline gates:**

- `node bank/selftest.mjs`: **677/677**.
- `node scripts/check-launch-params.mjs --selftest`: **35/35**, and the real file is still NOT LAUNCHABLE on the two OPEN dates.
- `/opt/scripts/alert-router.py --self-test` and `--emit`, against a throwaway `ALERT_STATE_DIR` and `ALERT_LOG`. ALL PASS. Delivery is stubbed by the self-test, and nothing was flushed or sent.

**Read-only mainnet:**

- `node bank/revenue.mjs --probe`, with `CBOB_REVENUE_LOCK` and `CBOB_REVENUE_LEDGER` pointed at the scratchpad. I read the code first: `--probe` returns after one `getMultipleAccountsInfo`. Result: Orca 4.8 bps and Meteora 5.4 bps from the oracle, both venues usable.
- A direct read of both Pyth accounts, both pools, their tick and bin arrays, the cbBTC mint, the four third-party programs' upgrade authorities, and the chain clock (box − chain = 1 s).

**Source reads:**

- MINT `reveal_level` (lib.rs:1304-1376), `retire` (1810-1830) and `SweepSolForSwap` (2553-2561).
- Token-2022's `CloseAccount` (`processor.rs:1315`). It carries the same native-account exemption as classic Tokenkeg.
- The deploy keypairs' public keys only, and the three sweep-helper artifacts' sha256.

**About 40 distinct findings: 11 CONFIRMED (0 CRITICAL, 0 HIGH, 0 MEDIUM, 7 LOW, 4 INFO), 3 ACCEPTED-LIMIT, 2 DOC-ONLY, 22 WRONG, 2 UNVERIFIED.**

Severity here is mine, not the auditors'. The judge (L1) was raised by all six counted auditors at CRITICAL, HIGH, HIGH, MEDIUM, MEDIUM and LOW. It is LOW for the reason round 24 gave L10: the builder, the judge and the signing key live in one file tree under one user. So the judge can only catch our own defects, and every value-moving defect it misses is caught loudly by `revenue.mjs`'s post-swap delta check (L1 below).

**Round-24 repair scorecard:**

- **Held, re-measured with fresh inputs here:**
  - **H1.** Per-kind labels. Urgent one-shots carry the pass stamp. The router QUEUES a new one-shot through an open stream and SUPPRESSES a standing level kind (router self-test plus `--emit` in scratch). Baselines are gated on `delivered`.
  - **I5** (measured: the second pass of a freeze is INFO, so `planAlarmNotices` emits nothing).
  - **L1** (NothingToSplit benign; a distribute race is benign only with the epoch moved; PoolShort fails).
  - **L2** (`'other'` → skip; a null decimals → null).
  - **L4** (an unreadable crontab → `unreadable`).
  - **L5** (old→missing→new = CRITICAL against the carried value; never-present→present = `[]`).
  - **L6a** (251M against a need of 260M → refused).
  - **L7** (carried with a finding).
  - **L12** (a `--live --reveal-only` reveal line is not armed).
  - **I2** in the crank.
  - **I4** (launch arms).
  - **D6** (seeds asserted).
  - **M1:** the Jupiter host is gone from the code. The venue probe works live, so round 24's M1 remainder is moot.
- **Held per their both-ways selftest arms and a re-read, not independently re-measured:** L3, L8, L9, L10a-d, L11, L13, I1, I3, D1-D5, D7, D8.
- **Incomplete or broken:**
  - **I2's shape was not carried to the swap.** The oracle age is judged on the box clock (L2).
  - **The M1 rewrite introduced the new surface this round found:** the judge (L1), the refusal classification (L3), no executed gate for `revenue.mjs` (L5), and pure swap arms that cannot fail (L6). Its limit-10 text overstates the judge (D1).

---

## CONFIRMED, LOW / INFO

| id | finding | auditors (their sev) | evidence · smallest fix · arm |
|---|---|---|---|
| L1 | **`judgeSwapInstructions` does not judge the swap.** `swap.mjs:255-277` checks only these: the allowed programs, one signer, one venue instruction naming the pool, one System instruction whose `keys[1]` is our wSOL ATA, and one Token `data[0]==9` close of it to us. Its own comment (251-254) says "a defect here, or a tampered module, must fail loudly rather than sign". | opus CRIT-1 + HIGH-2, muse HIGH + MED, qwen-max HIGH, qwen-2.4t F1/F5 (MED/LOW), glm M1 (MED), sonnet L-2 (LOW) | **Measured.** Each of these returns `[]` for both venues: output account (key 5) → a stranger; min-out (data 16..24) = 0; amount-in changed; Orca `a_to_b` flipped; `setComputeUnitPrice(25e9 µlamports)` appended; a Token `Approve` of the operator's cbBTC ATA to a stranger; the cbBTC ATA-create owner changed; the wrap amount inflated to 50 SOL. **LOW, not higher:** a tamper able to edit the builder can edit the judge, or `revenue.mjs`, which holds the key (limit 10 D2's box-owner residue). A builder defect that misroutes output or drops the floor is caught after signing by `revenue.mjs:384-388` (`delta < guaranteed` throws: loud, cycle open), and before shipping by fork SW.1 (balance ≥ floor). The undetected residues are a priority fee and a planted delegate, and only a tamper emits those. **Fix:** pass `lamportsIn` and `minSats` into the judge and require the EXACT seven-instruction sequence `swapInstructions` emits: CU limit = 400,000 and no `setComputeUnitPrice`; each ATA create = (owner, `ata(mint, owner)`, owner, mint); a System transfer, discriminator 2, owner → our wSOL, amount `lamportsIn`; SyncNative; the swap with our wSOL at keys[3] (Orca) or keys[4] (Meteora), and `ata(CBBTC, owner)` at keys[5] (both), data amount = `lamportsIn`, threshold = `minSats` and, for Orca, bytes 40/41 = 1,1 and the price limit = MIN_SQRT_PRICE; Token instructions limited to {17, 9}. Correct the comment and limit 10 (D1). **Arm:** each of the eight tampers above → a named problem, both venues; the honest build → `[]`. |
| L2 | **The oracle's age is judged on the box clock, and a future `publishTime` passes.** `revenue.mjs:117` passes `Date.now()` to `oracleFloor`, whose only freshness test is `nowSec - publishTime > 180` (`swap.mjs:103`). Round 24 I2 moved the crank to the Clock sysvar for this reason; the swap was not moved. | opus H3, sonnet L-3, muse MED, glm L1 (LOW), qwen-2.4t F4 (INFO, direction stated backwards) | **Measured:** a price 400 s old is refused at the true clock and ACCEPTED with the box 300 s behind. A `publishTime` an hour ahead of `nowSec` is accepted. Box − chain was 1 s today, so this is LOW: it needs a drifting clock, and the deviation gate still bounds a stale price that the pools disagree with. **Fix:** read the Clock sysvar in `market()` with the exported `clockUnixTimestamp`, refuse when it is unreadable, and refuse an age below −30 s. **Arm:** box −300 s with a 400 s-old price → refused against the chain clock; a future-dated price → refused. Separately, the fork judges age against the prices' own `publishTime` (`swap-fork.mjs:62-66`, stated there), so no fork arm exercises staleness. L6 adds one. |
| L3 | **A transaction that passes preflight and fails ON CHAIN is filed as "unconfirmed".** web3.js 1.98.4 throws `SendTransactionError` "Transaction <sig> resulted in an error. Status: ({"err":{"InstructionError":[i,{"Custom":n}]}})" with no logs (`index.cjs.js:2300-2306`). Neither regex (`revenue.mjs:319`, `:364`) matches it. Two effects. **(a) Sweep:** the intent row stays with no `sweptLamports` and no `sendRejected`, and 60 min later the alarm pages `unreconciled_swap` CRITICAL "lamports left the revenue address" for SOL that never moved. **(b) Swap:** a floor breach between simulation and landing (a price move, or a front-run) rethrows, so the Meteora fallback is never tried. Either way the job wedges at the open-cycle guard until a human acts. | sonnet M-B (MED) | **Measured:** the on-chain-failure and blockhash-expiry shapes both classify as UNCONFIRMED and the preflight shape as REFUSED. `detectUnreconciledRevenue` on an intent-only row 2 h old → `unreconciled_swap` CRITICAL. LOW: loud, nothing lost, and (a) needs a guardian stop or pause racing the sweep. **Fix:** on an error carrying a signature, or after an expiry, ask `getSignatureStatuses([sig], {searchTransactionHistory:true})`. `err` non-null means landed-and-failed, which is refused (nothing moved): `sendRejected` for the sweep, the next venue for the swap. `null` after expiry also means not landed. Only an unknown status stays open. **Arm:** each of the three shapes, with a stubbed status → the right branch. |
| L4 | **The 6-hourly revenue cron races its own 6-hour cooldown.** `cron-install.sh:140` runs at `41 */6`. The ruled `sweep_cooldown_secs` is 21,600 (`launch/mainnet-init.json`). `last_sweep_at` is the chain time the sweep lands, several RPC round trips after the run started. The next run reads its box `nowSec` about 1 s after starting (`revenue.mjs:167`), which is before `last + 21600`. Effects: the run prints "cooldown" and returns, so the cadence is 12 h and throughput 10 SOL per 12 h. Or, at the margin, the program refuses `SweepTooSoon` (lib.rs:1053-1054) and the LIVE job pages "REFUSED". | sonnet L-1 (LOW) | Code and ruled values read. The margin is a few RPC latencies (about 1-3 s) against a 1 s clock skew measured today, so the skip is the expected case. The vote-only-tightens cap makes the halved ceiling permanent (A2). **Fix:** run the revenue line hourly at :41; the cooldown gate makes extra runs no-ops. Or compare against the Clock sysvar plus 60 s. **Arm:** a selftest that the installed revenue line's period is shorter than the ruled cooldown. |
| L5 | **`revenue.mjs`'s cycle has never been executed by any gate, and item 22 and road step 8 do not name it.** Sweep, re-price, venue loop, return, split, ledger writes, recovery: none of it runs in the suite, the sim or the fork (`grep -c revenue scripts/run-tests.sh` = 0). Its selftest arms are source regexes (`selftest.mjs:2273-2275`, `2381-2383`). Item 22 (SPEC:1454-1461) and road step 8 (SPEC:1907) scope the rehearsal to "the crank and alarm". L3 is exactly the class of defect only execution finds. | sonnet M-A (MED), glm M2 (MED) | **Fix:** make one full live cycle a named pass/fail item of item 22 and road step 8, through BOTH venues (force Orca to refuse with a floor above its price), plus one forced post-sweep failure walked through the hand recovery. Optionally, a fork run with MINT deployed. glm's sub-claim about the signer flag is WRONG (see WRONG). |
| L6 | **The swap's pure gates cannot fail where it matters.** `deviationBps`, `orcaSpot` and `meteoraSpot` have no offline arm. The only evidence is fork SW.0 (`swap-fork.mjs:70-72`), which a spot function returning the oracle passes. So no arm shows a pool past the gate refused. | sonnet L-4, opus MED-8 | Measured: no selftest line names the three functions. **Fix:** offline arms with synthetic `sqrtPrice`/`activeId` at 99 and 101 bps, both sides, both venues. Add a fork arm with a stale `publishTime` (L2). Swap the ruled 10 SOL cap through both venues (U2). |
| L7 | **The program ids live in ungated copies.** They appear in `alarm.mjs:63-68`, `detectors.mjs:1712-1713`, `revenue.mjs:57`, `selftest.mjs:37/345` and `layout.mjs:25-32`. No assertion ties them to each other, to `declare_id!` or to `target/deploy/*-keypair.json`. A typo in `alarm.mjs`'s MINT from the start means the alarm derives the wrong config PDA and reports "nothing deployed yet" forever (`alarm.mjs:390-399`; `config_vanished` needs a prior sighting). | glm L3, sonnet L-4 | Measured: all copies and all five keypair pubkeys agree today. `rehearsal-tree.sh:101-105` catches a copy that keeps a 4-char prefix, but only when it runs. **Fix:** one selftest arm comparing every copy to `L.PROGRAM_IDS`, the four `declare_id!` and each keypair's pubkey (public key only). **Arm:** mutate one character in any copy → red. |
| I1 | `closesCycle` admits a split up to 60 s BEFORE the return (`detectors.mjs:652`). So a mint-revenue split landing just before our return can be recorded as that cycle's split. Our cbBTC then waits for the next hourly split; it is not lost. | sonnet | Measured: a split 50 s before `returnedAt` closes the cycle. **Fix:** anchor on the return transaction's blockTime (fetch `returnSig`'s), not on box time minus 60 s. |
| I2 | The four third-party programs the swap now rests on are unwatched: Orca, Meteora, and Pyth's receiver and push. Core is in the ProgramData loop (`alarm.mjs:217`); these are not. | glm L4 | Measured: all four are upgradeable, by `GwH3…`, `JADa…` and `6oXT…` (both Pyth). **Fix:** watch their hash and authority at HIGH (their upgrades are routine, so not CRITICAL), and name them in limit 10 (D1). |
| I3 | `MAX_ORACLE_CONF_BPS = 100` is 70-100x the live confidence. At the bound, a fill can be ~250 bps under the true price while every check passes: the 150 bps floor plus a 1% oracle error. | glm L2 | Measured live: SOL conf 1.5 bps, BTC 1.0 bps. **Fix:** 30 bps costs nothing and cuts the worst case by 70 bps. |
| I4 | The wiring gate is textual. It sees that a detector's result is consumed (L13 holds), not that its arguments are the right ones in the right order. | sonnet L-4 | `selftest.mjs:761-788`. **Fix:** optional. Each `main()` call's argument list pinned by a one-line regex, or a harness run of `main()` on fixtures. |

## ACCEPTED-LIMIT

- **A1. An RPC that stops answering stalls a crank lane 300.8 s per call** (sonnet M-C, "indefinitely" is wrong) → **limit 25** ("a crank that is up but slow ... also lapses windows in a burst", SPEC:1143-1144) and limit 7.
  - **Measured:** web3.js 1.98.4's default `Connection` (`crank.mjs:528`, `revenue.mjs:131`) waited 300.8 s against a black-holed listener before "fetch failed". Over 300 s the ~2-minute capture windows lapse, and the next `flock -n` minutes skip silently (limit 6).
  - **Worse than stated only in its cause:** a single stalled socket is enough, with no wedge bug.
  - **Cheap fix:** a 20 s `AbortSignal.timeout` fetch on the reveal lane's `Connection`. Its sends are refused out of order, so a timeout cannot double-send.
- **A2. A capped working sweep never pages, however large the backlog** (qwen-2.4t F8) → limit 10's per-sweep cap.
  - `detectUnsweptRoyalties` resets on every fall, by design (`detectors.mjs:1993`).
  - **Worse than stated:** the cap can only be tightened by a vote, so the ruled 10 SOL per cooldown is a permanent throughput ceiling. L4 halves it today (20 SOL/day). Say so in limit 10.
- **A3. The hand recovery of an open cycle could double-swap** (opus MED-6) → limit 10. The automatic path refuses a second cycle (`revenue.mjs:226-229`); the manual path is the trusted operator's. A one-line runbook note ("check the swap signature's status before re-swapping") is enough.

## DOC-ONLY

| # | item | false claim? |
|---|---|---|
| D1 | **Limit 10 (SPEC:1079-1090) and `swap.mjs:251-254` overstate the judge and understate the trusted set.** The judge does not judge the swap's output, floor, amount or fee (L1), and it cannot stop a "tampered module" in the same tree. "What remains trusted: the two pool programs and the Pyth price" omits several things. **(1)** The single RPC endpoint every price, pool and floor is read through (sonnet L-3). **(2)** The box clock (L2). **(3)** The integrity of `bank/swap.mjs` itself. **(4)** The third parties' upgrade keys (I2). **(5)** A number for the bound: the fill is guaranteed only to within 150 bps of the ORACLE, and ~250 bps of the true price at the confidence bound (I3). | **Operator-facing**, yes. Not false to holders: HOLDER-GUIDE:49-52 says the bot trades only through fixed pools and refuses any price below a Pyth-derived floor, which is true (live floor 138,045 sats against 140,148 expected per SOL). |
| D2 | Item 50 (SPEC:1495) still says the sweep helper "is being built". It is built, bundled, byte-identical across `dist/`, `target/deploy/` and the localnet cache (sha256 `9e21cc9c…` in all three), and watched by the alarm (`detectors.mjs:371-372`). | Operator-facing, stale in the safe direction. |

## WRONG

**The swap:**

- **"Any dust in the operator's wSOL ATA bricks every swap"** (muse MED, qwen-2.4t F2). `CloseAccount` refuses a non-zero balance only on a NON-native account (`!is_native() && amount != 0`, Token-2022 `processor.rs:1315`, the same rule as classic Tokenkeg). A wSOL account closes with any balance, and the remainder goes to the operator. glm and qwen-max read this correctly.
- **Pyth's verification tag and offsets are "asserted, not proven"** (muse HIGH). Live read: both sponsored accounts are owned by `rec5EK…`, at the PDAs `pythAccount` derives under `pythWSn…`, length 134, byte 40 = 1 (Full is variant 1 after `Partial{u8}`), the expected feed at 41..73, and `readPyth` parses sane prices. The fork proves the same on clones.
- **Meteora's `pow` overflows or the float "can flip the gate"** (opus MED-5, muse LOW). Live `activeId` is 5,920 with `binStep` 15; `pow` against `exp(log1p)` differs by 3e-9 bps. Orca's float error is 0 bps at the live `sqrtPrice`.
- **A frozen, stranger-created or delegated wSOL ATA** (opus MED-4). The native mint has no freeze authority, an ATA's owner is fixed by derivation, and the owner signs the transfer. A pre-existing balance is returned on close (harmless).
- **"Hard-coded decimals 8"** (qwen-2.4t F3). The pinned cbBTC mint reads decimals 8 (measured), and SPL mint decimals are immutable; a wrong value would be refused by `TransferChecked`.
- **The sweep's `isSigner:false` "works only by side effect"** (glm M2 sub-claim). Signer status is per message account, not per instruction meta. Measured: the operator is account 0, signer and writable, header `numRequiredSignatures` = 1.
- **Orca "falls back silently"** (sonnet L-5). The reason is printed and kept in `tried` (`revenue.mjs:366-367`). All three tick arrays and all three bin arrays exist today (measured).

**The alarm and the crank:**

- **The frozen kinds page URGENT every pass** (muse MED). `planAlarmNotices` drops INFO before grouping (`detectors.mjs:2365`). Measured: pass 1 is one urgent notice; pass 2 is INFO with no notice.
- **`swap_operator == guardian` "is quiet"** (muse MED). Measured: an armed replacement equal to the guardian pages `swap_operator_armed` CRITICAL every pass for the 7-day notice, the apply pages `config_drift` CRITICAL, and `check-launch-params.mjs:100-101` refuses it at launch. A standing INFO is optional.
- **Reveal-before-retire "wastes Core rent"** (muse LOW). A burned asset skips the Core CPI (lib.rs:1342-1347), and the reveal is what advances `revealed_total` (1304, 1338), which `retire` never touches.
- **The claim-destination comparison is "dead code"** (glm I1). It is a tautology for active vaults (`crank.mjs:568`), but a real canonical-against-recorded comparison for pre-joined ones (`:487`), and nothing claims more of it.
- **ELOCKED pages a false lane failure** (opus LOW-7). The lanes have separate locks (`crank.mjs:766`) under `flock -n`, so ELOCKED needs a concurrent hand run, and "did not run" is then true.
- **`fee_ceiling` has no RECOVERY** (qwen-2.4t F6). It is its own stream, asserted distinct with the router's `stream_key`. It mutes nothing and expires.
- **Claims after a raced distribute "pay zero"** (qwen-2.4t F7). The racing distribution moved the accumulator; claims pay on chain at it.

**The gates and the docs:**

- **"The 0.02 SOL float funds hundreds of cycles"** (sonnet, against D2). At exactly 0.02 SOL, any fee takes the balance below `OPERATOR_FLOOR` (`revenue.mjs:236-239`), so the next cycle refuses. The SPEC text is right.
- **"Tested ≠ shipped sweep bytes"** (sonnet). Measured sha256 `9e21cc9c…` is identical in `dist/`, `target/deploy/` and `.cache/ln/`.
- **The wiring gate is "vacuous if detectors vanish"** (muse). `selftest.mjs:786` pins the must-call list, and the 677 equality floor drops.
- **Floors are "self-referential"** (muse). That is by design: a floor catches an accidental loss, and the freeze reviews every diff.
- **`build-mainnet.sh` "does not prove the helper's lock"** (muse). The lock is road step 11, by design. The alarm pages `prog.sweep.upgrade_authority` past the deadline (`detectors.mjs:2104-2111`).
- **`SWAP_FLOOR=10` equality** (qwen-2.4t F9). Not a defect.
- **Item 50 "quietly treated as accepted"** (muse Q4). It is OPEN AND BLOCKING and the precondition of road step 11.
- **"Our payout job runs it" is false unless armed** (muse). The guide describes the launched system, and its next clause covers the unarmed case.

**grok-4.3, every affirmation that measurement contradicts:** R5(e) "the judge is complete" (L1), R5(h) "every path leaves the ledger open until a return is proven" (true, but L3 opens a false CRITICAL), and R6 "assertions can fail" (L6).

## UNVERIFIED

- **A17 (carried):** whether DAS sets `burnt` on a burned Core asset. **Settles it:** one DAS read of a collection holding a burned Core asset, as a named pass/fail item of the dress rehearsal.
- **U2:** whether a 10 SOL swap (the ruled cap) through Meteora (~$0.9M) fits the 150 bps floor after its variable fee and impact. The fork proved 2 SOL only (`swap-fork.mjs:67`). A failure is a refusal (loud), but the fallback would then be dead at full size. **Settles it:** a fork arm swapping 10 SOL through each venue, recording the executed price against the oracle.

**DOC-ONLY false claims:**

- **Holders:** none. HOLDER-GUIDE's swap sentence, its 100 $GARY edge (round 24 D1, held) and its frozen-pool forfeit are accurate, and its redeem-page and announcement promises are carried by item 50, which is OPEN AND BLOCKING.
- **The operator:** D1 overstates the judge and understates limit 10's trusted set. D2 is stale.

**Verdict: NOT CLEAN.**

- **What is confirmed:** 7 LOW and 4 INFO.
- **What matters most:**
  - the new swap judge checks almost nothing about the swap it guards (L1);
  - the swap's oracle age rests on the box clock that round 24 took off the crank (L2);
  - an on-chain failure after preflight raises a false CRITICAL or skips the Meteora fallback (L3);
  - the revenue cron races its own cooldown, which halves throughput (L4);
  - the rewritten revenue cycle has zero executions and is outside the rehearsal's named scope (L5).
- **What was not found:** no theft path. Nothing sends value anywhere the programs do not pin. Every value-moving judge gap is caught loudly after signing by the delta check.
- **What hold:** the round-24 repairs hold, apart from I2's shape not reaching the swap.
- **The freeze counter:** L1-L4, L6, L7 and I1-I4 touch `bank/` or `scripts/`, which resets it. It stays at 0 of 2.
