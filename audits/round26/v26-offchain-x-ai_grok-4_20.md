**L1. `judgeSwapInstructions` does not judge the swap (bank/swap.mjs:255-277).** It checks only programs, one signer, one venue instruction naming the pinned pool, one System instruction whose `keys[1]` is our wSOL ATA, and one Token `data[0]==9` close. Measured: output account (key 5) to stranger, min-out=0, amount changed, Orca direction flipped, priority fee appended, Token Approve of our cbBTC to stranger, cbBTC ATA created for stranger, wrap to 50 SOL — all return `[]` on both venues. **LOW.** The builder, judge and signing key live in one tree under one user, so it catches our defects only (limit 10 D2's box-owner residue). Builder defects that misroute or drop floor are caught after signing by `revenue.mjs:384-388` (`delta < guaranteed` throws, cycle open) and before shipping by fork SW.1 (balance ≥ floor). Undetected residues are priority fee and planted delegate; only a tamper emits those. **Fix:** pass `lamportsIn`/`minSats`; require EXACT seven-instruction sequence `swapInstructions` emits (CU limit=400000, no price; each ATA create=(owner, `ata(mint,owner)`, owner, mint); System transfer owner→our wSOL exactly `lamportsIn`; SyncNative; swap with our wSOL at keys[3] (Orca)/[4] (Meteora) and `ata(CBBTC,owner)` at keys[5], amount=`lamportsIn`, threshold=`minSats`, Orca direction/price-limit pinned; Token limited to {17,9}). Correct comment and limit 10 (D1). **Arm:** each of eight tampers → named problem, both venues; honest build → `[]`.

**L2. Oracle age judged on box clock; future `publishTime` passes (revenue.mjs:117).** `oracleFloor` only tests `nowSec - publishTime > 180` (`swap.mjs:103`). Round 24 I2 moved crank to Clock sysvar; swap was not moved. **LOW.** Needs drifting clock; deviation gate still bounds stale price pools disagree with. **Fix:** read Clock sysvar in `market()` with exported `clockUnixTimestamp`; refuse unreadable or age < -30 s. **Arm:** box -300 s with 400 s-old price → refused vs chain clock; future-dated price → refused. Fork judges vs prices' own `publishTime` (swap-fork.mjs:62-66); L6 adds one.

**L3. Transaction passing preflight and failing ON CHAIN filed "unconfirmed".** web3.js 1.98.4 throws `SendTransactionError` "Transaction <sig> resulted in an error. Status: ({"err":{...}})" with no logs. Neither regex matches. **(a) Sweep:** intent row stays with no `sweptLamports`/`sendRejected`; alarm pages `unreconciled_swap` CRITICAL for SOL that never moved. **(b) Swap:** floor breach between sim/landing rethrows; Meteora fallback never tried. Job wedges at open-cycle guard. **LOW.** Loud, nothing lost; (a) needs guardian stop/pause racing sweep. **Fix:** on error with signature or after expiry, ask `getSignatureStatuses([sig], {searchTransactionHistory:true})`. `err` non-null = landed-and-failed = refused (`sendRejected` for sweep, next venue for swap). `null` after expiry = not landed. Unknown status stays open. **Arm:** each of three shapes with stubbed status → right branch.

**L4. 6-hourly revenue cron races its own 6-hour cooldown (cron-install.sh:140 at `41 */6`).** Ruled `sweep_cooldown_secs=21600`. `last_sweep_at` is chain time sweep lands (seconds after run starts). Next run reads box `nowSec` ~1 s after start, before `last+21600`. Effects: prints "cooldown" and returns (12 h cadence, 20 SOL/day); or program refuses `SweepTooSoon` and LIVE job pages "REFUSED". **LOW.** **Fix:** run revenue line hourly at :41 (cooldown gate makes extra runs no-ops) or compare vs Clock sysvar +60 s. **Arm:** selftest that installed revenue line's period < ruled cooldown.

**L5. `revenue.mjs` cycle never executed by any gate; item 22/road step 8 do not name it.** Sweep/re-price/venue loop/return/split/ledger/recovery: none in suite/sim/fork (`grep -c revenue scripts/run-tests.sh`=0). Selftest arms are source regexes. Item 22/road step 8 scope rehearsal to "crank and alarm". L3 is exactly class only execution finds. **MEDIUM.** **Fix:** make one full live cycle (both venues, Orca forced to refuse once so Meteora runs) + one forced post-sweep failure walked through hand recovery named pass/fail of item 22/road step 8. Optionally fork run with MINT deployed. (glm's signer-flag sub-claim WRONG; see WRONG.)

**L6. Swap's pure gates cannot fail where it matters.** `deviationBps`/`orcaSpot`/`meteoraSpot` have no offline arm. Only evidence is fork SW.0 (swap-fork.mjs:70-72); spot function returning oracle passes. No arm shows pool past gate refused. **LOW.** **Fix:** offline arms with synthetic `sqrtPrice`/`activeId` at 99/101 bps both sides both venues. Add fork arm with stale `publishTime` (L2). Swap ruled 10 SOL cap through both venues (U2).

**L7. Program ids live in ungated copies (alarm.mjs:63-68, detectors.mjs:1712-1713, revenue.mjs:57, selftest.mjs:37/345, layout.mjs:25-32).** No assertion ties them to each other/`declare_id!`/`target/deploy/*-keypair.json`. Typo in alarm's MINT from start means alarm derives wrong config PDA and reports "nothing deployed yet" forever (alarm.mjs:390-399; `config_vanished` needs prior sighting). **LOW.** **Fix:** one selftest arm comparing every copy to `L.PROGRAM_IDS`, four `declare_id!` and each keypair's pubkey (public key only). **Arm:** mutate one character in any copy → red.

**I1. `closesCycle` admits split up to 60 s BEFORE return (detectors.mjs:652).** Mint-revenue split landing just before our return can be recorded as that cycle's split. Our cbBTC waits for next hourly split; not lost. **LOW.** **Fix:** anchor on return transaction's blockTime (fetch `returnSig`'s), not box time minus 60 s. **Arm:** split 50 s before `returnedAt` does not close; one at it does; legacy row (no block time) takes early one.

**I2. Four third-party programs swap rests on unwatched (Orca, Meteora, Pyth receiver/push).** Core in ProgramData loop (alarm.mjs:217); these not. **LOW.** **Fix:** watch hash/authority at HIGH (upgrades routine, not CRITICAL); name in limit 10 (D1).

**I3. `MAX_ORACLE_CONF_BPS=100` is 70-100x live confidence.** At bound, fill can be ~250 bps under true price while checks pass (150 bps floor + 1% oracle error). **LOW.** **Fix:** 30 bps costs nothing, cuts worst case 70 bps.

**I4. Wiring gate textual.** Sees detector result consumed (L13 holds), not that arguments right order. **LOW.** `selftest.mjs:761-788`. **Fix (optional):** each `main()` call's argument list pinned by one-line regex, or harness run of `main()` on fixtures.

## ACCEPTED-LIMIT (no change)

- **A1. RPC that stops answering stalls crank lane 300.8 s per call** (sonnet M-C; "indefinitely" wrong) → limit 25 ("crank up but slow also lapses windows in burst", SPEC:1143-1144) and limit 7. Measured: web3.js 1.98.4 default `Connection` (crank.mjs:528, revenue.mjs:131) waited 300.8 s vs black-holed listener before "fetch failed". Over 300 s, ~2 min capture windows lapse; next `flock -n` minutes skip silently (limit 6). Worse than stated only in cause: single stalled socket enough, no wedge bug. Cheap fix: 20 s `AbortSignal.timeout` fetch on reveal lane's `Connection`. Sends refused out of order, so timeout cannot double-send.
- **A2. Capped working sweep never pages, however large backlog** (qwen-2.4t F8) → limit 10's per-sweep cap. `detectUnsweptRoyalties` resets on every fall, by design (detectors.mjs:1993). Worse than stated: cap only tightened by vote, so ruled 10 SOL per cooldown permanent throughput ceiling. L4 halves it today (20 SOL/day). Say so in limit 10.
- **A3. Hand recovery of open cycle could double-swap** (opus MED-6) → limit 10. Automatic path refuses second cycle (revenue.mjs:226-229); manual path trusted operator's. One-line runbook note ("check swap signature's status before re-swapping") enough.

## DOC-ONLY

- **Limit 10 (SPEC:1079-1090) and swap.mjs:251-254 overstate judge/understate trusted set.** Judge does not judge output/floor/amount/fee (L1); cannot stop "tampered module" in same tree. "What remains trusted: two pool programs and Pyth price" omits (1) single RPC endpoint every price/pool/floor read through (sonnet L-3), (2) box clock (L2), (3) integrity of bank/swap.mjs itself, (4) third parties' upgrade keys (I2), (5) number for bound: fill guaranteed only within 150 bps of ORACLE, ~250 bps of true price at confidence bound (I3). **Operator-facing**, yes. Not false to holders: HOLDER-GUIDE:49-52 says bot trades only through fixed pools/refuses any price below Pyth-derived floor (true; live floor 138045 sats vs 140148 expected per SOL).
- **Item 50 (SPEC:1495) still says sweep helper "being built".** Built, bundled, byte-identical across dist/, target/deploy/ and localnet cache (sha256 9e21cc9c… in all three), watched by alarm (detectors.mjs:371-372). **Operator-facing**, stale in safe direction.

## WRONG

**The swap:**
- "Any dust in operator's wSOL ATA bricks every swap" (muse MED, qwen-2.4t F2). `CloseAccount` refuses non-zero balance only on NON-native account (`!is_native() && amount != 0`, Token-2022 processor.rs:1315; same rule as classic Tokenkeg). wSOL account closes with any balance; remainder to operator. glm/qwen-max read correctly.
- Pyth's verification tag/offsets "asserted, not proven" (muse HIGH). Live read: both sponsored accounts owned by rec5EK…, at PDAs pythAccount derives under pythWSn…, length 134, byte 40=1 (Full variant 1 after Partial{u8}), expected feed at 41..73, readPyth parses sane prices. Fork proves same on clones.
- Meteora's `pow` overflows or float "can flip gate" (opus MED-5, muse LOW). Live activeId=5920 with binStep=15; pow vs exp(log1p) differs by 3e-9 bps. Orca float error 0 bps at live sqrtPrice.
- Frozen/stranger-created/delegated wSOL ATA (opus MED-4). Native mint has no freeze authority; ATA owner fixed by derivation; owner signs transfer. Pre-existing balance returned on close (harmless).
- "Hard-coded decimals 8" (qwen-2.4t F3). Pinned cbBTC mint reads decimals 8 (measured); SPL mint decimals immutable; wrong value refused by TransferChecked.
- Sweep's `isSigner:false` "works only by side effect" (glm M2 sub-claim). Signer status per message account, not per instruction meta. Measured: operator account 0, signer+writable, header numRequiredSignatures=1.
- Orca "falls back silently" (sonnet L-5). Reason printed/kept in tried (revenue.mjs:366-367). All three tick/bin arrays exist today (measured).

**The alarm and crank:**
- Frozen kinds page URGENT every pass (muse MED). planAlarmNotices drops INFO before grouping (detectors.mjs:2365). Measured: pass 1 one urgent notice; pass 2 INFO with no notice.
- `swap_operator == guardian` "quiet" (muse MED). Measured: armed replacement equal to guardian pages swap_operator_armed CRITICAL every pass for 7-day notice; apply pages config_drift CRITICAL; check-launch-params.mjs:100-101 refuses at launch. Standing INFO optional.
- Reveal-before-retire "wastes Core rent" (muse LOW). Burned asset skips Core CPI (lib.rs:1342-1347); reveal advances revealed_total (1304, 1338); retire never touches.
- Claim-destination comparison "dead code" (glm I1). Tautology for active vaults (crank.mjs:568), but real canonical-vs-recorded for pre-joined ones (:487); nothing claims more of it.
- ELOCKED pages false lane failure (opus LOW-7). Lanes have separate locks (crank.mjs:766) under flock -n, so ELOCKED needs concurrent hand run; "did not run" then true.
- `fee_ceiling` has no RECOVERY (qwen-2.4t F6). Own stream, asserted distinct with router's stream_key. Mutes nothing; expires.
- Claims after raced distribute "pay zero" (qwen-2.4t F7). Racing distribution moved accumulator; claims pay on chain at it.

**The gates and docs:**
- "0.02 SOL float funds hundreds of cycles" (sonnet, against D2). At exactly 0.02 SOL any fee takes balance below OPERATOR_FLOOR (revenue.mjs:236-239), so next cycle refuses. SPEC text right.
- "Tested ≠ shipped sweep bytes" (sonnet). Measured sha256 9e21cc9c… identical in dist/, target/deploy/ and .cache/ln/.
- Wiring gate "vacuous if detectors vanish" (muse). selftest.mjs:786 pins must-call list; 677 equality floor drops.
- Floors "self-referential" (muse). By design: floor catches accidental loss; freeze reviews every diff.
- build-mainnet.sh "does not prove helper's lock" (muse). Lock road step 11, by design. Alarm pages prog.sweep.upgrade_authority past deadline (detectors.mjs:2104-2111).
- SWAP_FLOOR=10 equality (qwen-2.4t F9). Not defect.
- Item 50 "quietly treated as accepted" (muse Q4). OPEN AND BLOCKING; precondition of road step 11.
- "Our payout job runs it" false unless armed (muse). Guide describes launched system; next clause covers unarmed case.

**grok-4.3, every affirmation measurement contradicts:** R5(e) "judge complete" (L1), R5(h) "every path leaves ledger open until return proven" (true, but L3 opens false CRITICAL), R6 "assertions can fail" (L6).

## UNVERIFIED

- **A17 (carried):** whether DAS sets `burnt` on burned Core asset. **Settles it:** one DAS read of collection holding burned Core asset, named pass/fail item of dress rehearsal.
- **U2:** whether 10 SOL swap (ruled cap) through Meteora (~$0.9M) fits 150 bps floor after variable fee/impact. Fork proved 2 SOL only (swap-fork.mjs:67). Failure refusal (loud), but fallback then dead at full size. **Settles it:** fork arm swapping 10 SOL through each venue, recording executed price vs oracle.

**DOC-ONLY false claims:**
- **Holders:** none. HOLDER-GUIDE's swap sentence, 100 $GARY edge (round 24 D1, held) and frozen-pool forfeit accurate; redeem-page/announcement promises carried by item 50 (OPEN AND BLOCKING).
- **Operator:** D1 overstates judge/understates limit 10's trusted set. D2 stale.

**Verdict: NOT CLEAN.**

- **Confirmed:** 7 LOW, 4 INFO.
- **What matters most:** new swap judge checks almost nothing about swap it guards (L1); swap's oracle age rests on box clock round 24 took off crank (L2); on-chain failure after preflight raises false CRITICAL/skips Meteora fallback (L3); revenue cron races own cooldown, halves throughput (L4); rewritten revenue cycle has zero executions/outside rehearsal's named scope (L5).
- **What was not found:** no theft path. Nothing sends value anywhere programs do not pin. Every value-moving judge gap caught loudly after signing by delta check.
- **What holds:** round-24 repairs hold, apart from I2's shape not reaching swap.
- **Freeze counter:** L1-L4, L6, L7 and I1-I4 touch bank/ or scripts/, resets it. Stays at 0 of 2.