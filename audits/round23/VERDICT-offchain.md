# Round 23, OFF-CHAIN pass: NOT CLEAN

The round audited commit `9048cd0`. I judged everything against the current working tree: HEAD `77e7870` plus uncommitted edits. Six auditors were counted: claude-sonnet-5.5, gpt-6-luna-pro, gpt-6-sol-pro, qwen3.8-max-0902, grok-4.6, glm-5.3. Two were skimmed and not counted: deepseek-v4.1-flash and minimax-m3. Both are reasoning traces that loop and never write findings, and they contain nothing that is not covered below.

**Method.** The triage was read-only. It read all six counted reports in full and checked every distinct finding against the code. Claims were measured with the real pure modules: `planCrank`, `attrsHash`, `judgeFeePayer`, `detect*`, `judgeLaunch` and the layout parser.

- **Crank differential.** I transcribed MINT's `credit`, `advance_epoch`, `owed_of`, `reweigh`, `unschedule_boost`, `expire_boost`, `retire`, `join`, `claim`, `distribute` and `monthly_inline` from `lib.rs` into a simulator. I generated 60,000 random histories (3 seeds × 20k) and ran the crank's whole pass against the simulator in send order.
- **Mutation tests.** I copied files to scratch and changed them there: boost and carry removed from the crank, the `cbob_mint` launch pin removed, and detector calls cut from `alarm.mjs`.
- **One read-only RPC.** I read the pinned $CBOB mint from public mainnet.
- **Not run:** no validator, no `alarm.mjs`, nothing written in the repo.

⚠️ **The working tree changed while I was working.** Another session edited GOV, MINT, the tests, `SPEC.md`, `HOLDER-GUIDE.md` and `mainnet-init.json`. `bank/` is unchanged since `9048cd0` apart from the `detectors.mjs` pin. I re-ran the layout parity check after those edits and all five structs are still equal.

**About 44 distinct findings: 26 CONFIRMED (0 CRITICAL, 0 HIGH, 4 MEDIUM, 17 LOW, 5 INFO), 4 ACCEPTED-LIMIT, 7 DOC-ONLY, 8 OVERTAKEN, 4 WRONG, 1 UNVERIFIED.**

- No theft path, and nothing sends value anywhere the programs do not already pin.
- The one claimed HIGH (gpt-luna: the Jupiter `/swap` signing) is accepted limit 10, and its practical exposure is not worse than stated.

**Question (a), the crank's owed math and expiry planning: they match MINT.** The differential covered boosts not due, due, due and retired, joined this pass, and frozen destinations, with 444 pre-expiries and 622 post-expiries planned. Across the 60k states:

- The crank never put a vault in a claim batch that MINT pays 0 on.
- It never left a boost due after its own distribution (`BoostsExpireFirst` never refused the next one).
- Every expire, join and claim the crank planned was accepted by the simulated program.
- A planned post-distribution expiry cannot fail: `expire_boosts` skips records that are not due.
- The only refusal was T1 below.
- The only missed deliveries happen when a retirement in the same pass frees owed shares. That is a conservative miss, delivered on the next pass.

## CONFIRMED, MEDIUM

| id | finding | evidence | smallest fix · arm proving both ways |
|---|---|---|---|
| M1 | **`revenue_unsplit` pages HIGH every pass during any active sale** (Claude R2-2, Qwen F1). `revenueSince` resets only when the alarm sees a zero balance. The crank splits at :37 and the alarm samples at :23 and :53, so with a mint at least every ~16 min the clock never resets. Six hours later it pages "unsplit since T" every 30 min although the crank has split every hour. | `alarm.mjs:386-393` (`revenueSince = prev?.revenueSince ?? nowSec`), `cron-install.sh:131-132`. Measured: `detectUnsplitRevenue({amount:5000n, sinceSec:0, nowSec:7h})` → `[revenue_unsplit, HIGH]`. Nothing feeds the hourly splits into it. | Pure `revenueClock({prevSince, read, lastSplitSec, nowSec})`: the clock is `max(prevSince, last seen cbBTC split blockTime)`, from `prev.seenSplits` and this pass's splits. **Arm:** first sighting 7 h ago with a split 1 h ago → quiet; first sighting 7 h ago with no split → HIGH. |
| M2 | **Our own two crank lanes race on reveals and page a false "reader and program disagree" fault** (grok). Both the full pass and the every-minute lane plan the same queue head, with separate locks. If one reveals first, the other reads attributes that now carry `level`. The hash check then fails, the crank breaks the lane and pages, and it never reaches the `AlreadyRevealed` benign path. | `crank.mjs:404-413`; `planCrank` without `revealOnly` returns `reveal: ['R0']`. `attrsHash(list) === attrsHash([...list, {key:'level',...}])` → **false**. MINT appends `level` (`lib.rs` push_attr ATTR_LEVEL). Two locks: `crank.mjs:472`, `cron-install.sh:132-133`. This fires on any :37 pass that has a reveal queue, i.e. every sale hour. | Export `judgeRevealAttrs(list, hash)` → `send` / `revealed` (contains the program-owned `level` key) / `mismatch`. `revealed` is a benign break. **Arm:** minted list → send; list plus level → revealed; tampered list → mismatch. |
| M3 | **Round 22 A4 repair is incomplete: credited-but-undelivered shares still page nothing** (Claude R2-1, gpt-sol R2). If the crank's full pass dies while traffic keeps running monthly distributions in-line, `owed_scaled` grows, nobody is paid, and every detector stays quiet. | `owed_scaled` is used only in `pool_insolvent` and `poolAvailable`. Measured: `detectDistributionOverdue({... owed 1e18, nothing waiting or due}, {nowSec:+20d, poolAvail:0n})` → `[]`. | Crank stamps a heartbeat after each LIVE full pass. Pure `detectCrankSilent({stampSec, nowSec, live})` pages HIGH beyond 3 h. **Arm:** stale + live → HIGH; fresh, or dry-run → quiet. |
| M4 | **Royalty SOL waiting in the revenue address is watched by nothing** (glm R2-2). If `revenue.mjs` is never armed, is wedged, or dies before sweeping, no ledger row exists. `distribution_overdue` needs pool funds available, so it stays quiet too. Limit 7's claim that every job's stall is "survivable rather than silent" (it names revenue) is therefore untrue for this job. | `alarm.mjs` never reads the revenue address's lamports (no `getBalance`). `detectors.mjs:1625` returns without paging when nothing is available. | Read the revenue address's lamports each pass. Pure `detectUnsweptRoyalties({lamports, reserve, floor, since, now, grace: 24h})` pages HIGH while `lamports - reserve ≥ sweep_floor` past the grace period. Correct limit 7. **Arm:** 2 SOL for 25 h → HIGH; 2 SOL for 5 h, or 0.04 SOL → quiet. |

## CONFIRMED, LOW / INFO

| id | finding | evidence · fix · arm |
|---|---|---|
| L1 | `BENIGN` misses race codes (Claude R1-3, grok, glm R1-1): `AlreadyRetired`, `AlreadyActive` / `VaultRetired` / `ActivationPending` (holder activates first), `RevealWindowExpired`, `NeedsReschedule`. Also, `mintedAttributes` outside any try aborts the whole pass on one RPC blip. | `crank.mjs:387,408`. Fix: extend the regex and wrap the read in try/catch with a break. **Arm:** export `BENIGN`; each race code matches, and `BoostsExpireFirst` / `JoinWaitingFirst` / insufficient funds do not. |
| L2 | Pay and join skips fail open: an asset read as `'other'` (a null RPC answer) is claimed and pre-joined, and never retired (gpt-sol, grok MEDIUM; glm LOW). LOW because a burned Core asset persists as a 1-byte account, so a null needs an RPC fault. | Measured: `assets 'other'` → claims `[R0]`, preJoins `[R1]`, retire `[]`. `crank.mjs:162,232,252`. Fix: require `=== 'live'`. An unreadable eligible pending vault means no distribution this pass, and a problem is reported. **Arm:** 'other' → no claim and a problem; 'live' → claim. |
| L3 | (triage, T1) The round 22 F5 repair is incomplete for ticks. With `w=0`, when the only vault that requested this epoch is burned and retired in the same pass, the crank still plans a tick. The program then refuses it with `NoActiveVaults` and pages once. | Measured: plan → `[[R0], true, 'tick']`. Differential: 358/20k distributions refused, all this case. `crank.mjs:205,214`. Fix: subtract retiring this-epoch requesters from `pending_this_epoch`. **Arm:** that case → no tick; plus a live co-requester → tick. |
| L4 | The selftest boost-owed arms cannot fail (Claude R4b-1 MEDIUM, gpt-sol). They assert batch counts, not sats. | Mutation: removing `boost` and `carry` from `crank.mjs:261` leaves both arms green. The differential catches the same mutant (980 problems, 1,159 missed payments). Fix: the plan carries per-vault `owed`; assert 20/20 and 29 exactly, plus a 1-vs-0 threshold arm. Or adopt the differential as an arm. |
| L5 | `V6_WIRED` never got the round 22 detectors (Claude R6-1, grok, glm R6-1 MEDIUM). | Measured: cutting `detectRevealStall`, `detectUnsplitRevenue` and `detectFrozenVaultAccount` from `alarm.mjs` leaves the gate at `[]`. Every `detect*` export is called today (measured `[]` missing). Fix: derive the list from `Object.keys(D)` matching `/^detect/`. **Arm:** delete any one call → red. |
| L6 | `BOOST_RING` (64), the five `*_VERSION` constants, and the suite's `OFF_BOOSTS_*` / `OFF_BOOST_RING` are not asserted against the Rust (Claude R3-1, gpt-luna, gpt-sol). There is no present mismatch: parse equal; ring 64 = 64; `boosts_due` 729 and `boost_expiring` 749 match the suite. Nothing off chain reads the ring. Claude's "a version bump is caught only at runtime" is partly wrong: X.1 and X.3 decode live accounts. | `layout.mjs:103,149,206`; `selftest.mjs:1516` list. Fix: scrape and assert, and add the 5 offsets to the list. **Arm:** ring 128 in a fake source → red. |
| L7 | (triage, T2) The new `cbob_mint` pins have no arm. | Mutation: removing the PIN line keeps `check-launch-params --selftest` at 27/27, and USDC as `cbob_mint` → `judgeLaunch` `[]`. `selftest.mjs` has no arm for the `detectors.mjs:532` production pin either. **Arm:** `with_('cbob_mint', <USDC>)` refused naming the ruled mint; `detectStandingRisks({'mint.cbob_mint': other}, prod)` → CRITICAL. |
| L8 | `judgeLaunch` passes a bad swap operator (glm, plus triage): the key is exempt from the RULED check (a leftover from when it was OPEN), it is not pinned, and off-curve keys pass. | Measured: status PROPOSED → `[]`; an off-curve PDA → `[]` (ruled value `bipP7…` is on curve). `check-launch-params.mjs:63,71`. Fix: pin it, drop the exemption, and require `isOnCurve` for guardian / init / operator. **Arm:** each refused; the committed file filled → `[]`. |
| L9 | A frozen revenue cbBTC account is unwatched (gpt-luna, two MEDIUMs). Frozen with a zero balance means every paid mint and swap return fails while the alarm stays quiet. Frozen with a balance means the crank plans a split, then a distribution, each refused hourly. | `alarm.mjs:389-391` (no state byte), `crank.mjs:188`. Fix: page HIGH `revenue_account_frozen` on the state byte at any balance; the crank skips the split and reports it; limit 28 names it. **Arm:** frozen with 0 → HIGH; healthy → quiet. |
| L10 | A failed revenue-account read silently resets the unsplit clock (gpt-sol). | `alarm.mjs:388-393`. Fix: inside M1's helper, unreadable after init → HIGH, keeping the previous `since`. **Arm** in M1's set. |
| L11 | The first pass after each `initialize` reports every fixed-forever value as CRITICAL drift from null (glm R2-3). | Measured with a full MintConfig: 39 drift findings, 27 CRITICAL, "a vote replaced it". `detectors.mjs:417-427`. Fix: skip keys whose program (or `prog.x`) was `_missing` in the previous snapshot. **Arm:** missing → present gives `[]`; value → value' gives CRITICAL. |
| L12 | The lock-date check reads only a box file (Claude R2-3). On-chain `charter_opens_at` is immutable and is the ruled bound. | `alarm.mjs:92-97,355`. Fix: `lockDeadlineSec = min(file, mint.charter_opens_at)`. **Arm:** file unset or far, now ≥ opening, upgradeable → CRITICAL. |
| L13 | The production list omits `mint.pob_collection`, which the launch gate pins (Claude). | `detectors.mjs:510-533`. Fix: add one line. **Arm:** a wrong collection → `test_value_in_production`. |
| L14 | Fee-payer sizing (Claude R1-4, glm R1-3). | Details below the table. |
| L15 | A dead holder's fresh lock still blocks the lane: 10 min for reveals, 2 h for the full pass (Claude R1-2; the residue of round 22 F3). | `lock.mjs:243` checks age before liveness. Fix: break when the pid is dead or recycled, at any age. **Arm:** `{pid: dead, at: now}` → ok; `{pid: self, at: now}` → refused. Mind this file's history before changing it. |
| L16 | `splitByOther` anchoring is nearly vacuous now that the crank splits every hour (Claude R5-1). Any later unclaimed crank split anchors a false claim. Money is still divided by the pinned rule. | `detectors.mjs:1300-1306`. Fix: record each split's total and anchor only on an unclaimed split with total ≥ `returnedSats` after `returnedAt`. **Arm:** a 5,000-sat cycle with only a later 100-sat split → CRITICAL; a 5,000-sat split → quiet. |
| L17 | The entire $CBOB supply sits on a box-generated hot key, and nothing records its custody (glm R4b-1). | `create-cbob-token.mjs:64,71`; `bank/keys/cbob-release.json` exists. This is an owner decision. Fix: move the supply to Gary's wallet or a Squads before any release, delete the box key, and record custody in `mainnet-init.json`. **Arm:** the launch gate refuses while that key file exists, and passes once it is gone (temp directory). |
| I1–I5 | **INFO** | See below. |

**L14 in full.** The crank key pays Core's attribute rent on every reveal: 14–16 bytes × 6,960 lamports ≈ 0.0001 SOL each. The 0.005 SOL floor therefore covers only about 45 reveals per pass. The over-ceiling warning sends a notice on every run, including the every-minute lane. The "fees only" text is wrong. Fix: size the floor from the plan, and warn once per day. **Arm:** `judgeFeePayer` with a plan costing more than the balance → refused.

**INFO items:**
- **I1** Unrevealed bare burns are not retired until they are revealed (`crank.mjs:140`; gpt-sol).
- **I2** The control-table gate passes a row on a single real error variant. No current row names a false one (measured).
- **I3** `mint.revealed_total` and `active_count` are not in `WATCHED_KEYS` (glm).
- **I4** The poster has no check for an unresolvable cursor (glm; drafts only).
- **I5** `create-cbob-token.mjs` writes no record if a read-back throws, and a re-run dies on "already exists". This matters only for a re-run on another cluster; the mainnet record exists with `verified: true`.

## ACCEPTED-LIMIT
- **Claude R1-1: crank throughput lapses capture windows in a burst** → limit 25. It already says "a crank that is up but slow… also lapses windows in a burst". Not worse than stated. The duplicate crank page is covered by L1.
- **gpt-luna R5 (HIGH), Qwen, Claude R5: the `/swap` transaction is signed unvalidated** → limit 10 (round 22 S2). Not worse: the operator holds only the cycle's funds plus a 0.02 SOL float (`revenue.mjs:182`), within the per-sweep cap. The doc gap is D3.
- **Claude R4b-2: strangers burn through boosts with 100 $GARY distributions** → Gary's 2026-10-04 game-theory ruling. The docs now state it truthfully (O5).
- **Qwen INFO: $CBOB metadata stays mutable under Gary's wallet** → ruled (`create-cbob-token.mjs:12`).

## DOC-ONLY
- **D1** The crank is "refused above 0.25 SOL", but round 22 F8 made it run and warn. Stale at `SPEC.md:208`, `SPEC.md:1517`, `crank.mjs:34-35,56-57,368` and `cron-install.sh:173` (Qwen, grok, glm, gpt-sol).
- **D2** The `accrual.mjs:13-14` header still claims a `retire` mirror. Round 22 G5 was not applied (glm).
- **D3** Limit 10 never names Jupiter's `/swap` response as part of the trusted hop. Round 22 S2 was not applied.
- **D4** The mainnet probe skipping on no DNS is still not a ship-gate condition (round 22 G2; gpt-luna MEDIUM, Claude, glm). Also the DNS check targets `api.mainnet-beta.solana.com` while the probe uses `HELIUS_RPC_URL` (`run-tests.sh:282` vs `probe-mainnet-facts.mjs:33`).
- **D5** Limit 7's "survivable rather than silent" is untrue for the revenue job. Fix it together with M4.
- **D6** Item 50: the redeem page is not an explicit precondition of road step 11, and building it inside `bank/` resets the freeze (Claude, Qwen).
- **D7** Road step 10's table row (`SPEC.md:1636`) does not list the three cbBTC accounts and the rent that item 52 says step 10 creates.

## OVERTAKEN (fixed since `9048cd0`)
- **O1** The launch gate does not read or pin `cbob_mint` and its authorities (Claude R2-5, gpt-luna R4b MEDIUM, grok R4b MEDIUM). Commit `0d7f03a` pins the exact address (`check-launch-params.mjs:60`; USDC is refused, measured). I re-read the mint on mainnet, read-only:
  - owner Tokenkeg, 82 bytes
  - mint authority None, freeze authority None (None is irreversible)
  - supply 2,100,000,000,000,000 base units, decimals 6
- **O2** A wrong $CBOB mint becomes a quiet baseline in the alarm (grok R2 MEDIUM). Now the production list at `detectors.mjs:532` pages `test_value_in_production` CRITICAL (measured).
- **O3** SPEC items 38 and 51 were stale (gpt-luna, grok, glm, Claude). Updated at `SPEC.md:1290-1293`; "OPEN for launch" is gone.
- **O4** SPEC said "59/59" for the simulation (Claude R6-4, glm). Now 60/60.
- **O5** The doc side of Claude R4b-2. `mainnet-init.json` now says "DISTRIBUTIONS (not months…)" and the holder guide says "payouts, not months".
- **O6** The revenue address's own cbBTC account was missing from item 52 (Claude). Added to item 52.
- **O7** The 12/17 "cannot run out of compute" contradicted item 54 (Claude). Amended at `SPEC.md:1414-1415`.
- **O8** MINT does not refuse $GIRAFFISH as `cbob_mint` (glm R4b-2, off-chain side). The gate refuses every reserve, and the exact pin now makes it moot.

## WRONG
- **glm R2-1, `revenue_ledger_unreadable` every pass before revenue starts.** `bank/revenue-ledger.json` exists on this box (`{"cycles":[]}`, since 2026-08-22). The CRITICAL is deliberate and its text gives the remedy (`detectors.mjs:599-602`).
- **glm R6-2, the poster's no-sender gate has a blind spot.** The poster's own selftest (`redemption-poster.mjs:183-186`, behind the 22-assertion floor) scans every non-comment line with no `SENDER` exclusion, and also catches `fetch(`.
- **gpt-luna, limit 10 is worse because the hop "can drain the operator's other balances".** The operator wallet holds only the cycle's funds and a 0.02 SOL float, so the exposure stays within the stated bound.
- **Claude R3-1, sub-claim "a version bump fails only at runtime".** `layout.decode` refuses a version mismatch, and `tests/3prog.test.ts` X.1 and X.3 decode the live accounts, so `run-tests.sh` goes red.

## UNVERIFIED
- **A17** (Claude R2-4, glm; carried from round 22): whether Helius `getAssetsByGroup` returns burnt Core assets with the `burnt` flag set. **Settles it:** one DAS query against a collection that holds a burned Core asset, made a named pass/fail item of the dress rehearsal.

**Verdict: NOT CLEAN.** 4 MEDIUM and 17 LOW findings are confirmed. None moves value, and the crank's money arithmetic matches MINT under measurement. Every CONFIRMED finding needs its fix and both-ways arm before round 24; the counter stays at 0 of 2.
