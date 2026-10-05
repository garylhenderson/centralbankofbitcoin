# Round 24, OFF-CHAIN pass: NOT CLEAN

The round audited commit `6e521db`, which is HEAD. The tree is clean apart from `audits/round24/`, and nothing was edited, committed or run against a validator.

**Counted auditors (7):** claude-opus-5.5, gpt-6.1-sol-pro, gpt-6-astra-pro, grok-4.20, qwen3.8-max-prime, glm-5.3-prime, mimo-v2.6-pro.

**Not counted:** deepseek-v4-pro-0813. I skimmed it. It is a reasoning trace that loops ("ROUND 19 … block, good" repeated). Its one concrete point, a reveal sent with an empty attribute list for an asset read as `'other'`, is covered by L2.

**grok-4.20 received only 252,460 input tokens of a 920k-character prompt** (MANIFEST-offchain.json). Its findings restate round 23's verdict items as if they were unfixed, and every one fails measurement (see WRONG).

## Method

The triage was read-only. I read every counted report in full and checked each finding against the code at HEAD.

- **Pure modules.** I measured with the real ones: `planCrank`, `judgeFeePayer`, `planCostLamports`, `BENIGN`, `judgeRevealAttrs`, `detect*`, `correlateBurns`, `missingWatchedKeys`, `layout.fixedLength` and `accrual.reweigh`. Scripts are in the scratchpad.
- **Program refusal order.** I read MINT's `distribute`, `claim`, `monthly_inline`, `split_revenue`, `reveal_level`, `retire` and `expire_boosts` to establish which refusal a racing host produces.
- **Alert router (outside the repo).** I ran `/opt/scripts/alert-router.py --emit` against a throwaway `ALERT_STATE_DIR` and `ALERT_LOG` in the scratchpad. Nothing was flushed or sent. I also read the live router state, read-only.
- **cron-install.** I extracted its `ours()` preservation logic and ran it against crontab text in the scratchpad.
- **Host unit-test count.** I ran `--list` on the existing compiled test binary. It was built after lib.rs's last edit.
- **Network reads.** DNS and HTTP checks on Jupiter's hosts (two public resolvers, plus a GET quote).

No crank differential was rebuilt. Since round 23's 60k-history differential, the crank's money paths changed only through L2, L3 and L4. I re-read those against the Rust and hand-traced the one new scenario (I1).

**About 52 distinct findings: 20 CONFIRMED (0 CRITICAL, 1 HIGH, 1 MEDIUM, 13 LOW, 5 INFO), 6 ACCEPTED-LIMIT, 8 DOC-ONLY, 16 WRONG, 2 UNVERIFIED.**

**Round-23 repair scorecard:**

- **Held as stated:**
  - `detectRevenueAccount`: the clock is kept on an unreadable read (measured), and a frozen account pages.
  - `judgeRevealAttrs`: a list plus `level` returns `revealed` (measured).
  - `detectUnsweptRoyalties`.
  - The L3 tick discount.
  - The `plan.owed` arms.
  - The launch pins and their arms (check-launch-params:194-199).
  - `lockDeadlineOf`.
  - L15 liveness before age (selftest:199-208).
- **Incomplete or broken:**
  - The crank heartbeat (L4).
  - `BENIGN` (L1).
  - Live-only payment (L2: the reveal site was missed).
  - The frozen-account repair (L3: the destinations were missed).
  - L11 drift suppression (L5).
  - The plan-sized fee floor (L6).
  - L16 split anchoring (L10: the sibling branch was not covered).
  - The derived wiring gate (L13: it is textual only).

---

## CONFIRMED, HIGH

### H1. Every CBOB alarm finding shares one alert stream, so one-shot CRITICALs are dropped while the alarm records them as delivered

**Raised by:** astra R2-3 (MEDIUM, partly: drift has no one-shot flag, only the first detail is sent, "router not supplied so I cannot establish its buffering"). glm mentions it in its closing list ("nothing tests notify / ALERT_URGENT"). The rest is triage measurement.

**The mechanism:**

- `report()` sends **one** notify per pass with label `cbob-vault-alarm` and only `crit[0]`/`high[0]` as detail (`alarm.mjs` report).
- It treats exit 0 as delivered, and `main()` then advances every baseline: config, balances, cursors, vault set.
- The router keys streams by label (`stream_key`). Once a stream has emailed, it is OPEN until a RECOVERY message, which the alarm never sends.
- Every later emit on that label hits `if stream in opened` → **SUPPRESSED**, exit 0, text discarded. That holds for 12 h, then one reminder per 24 h carries only the latest text.
- A one-shot open stream auto-closes only after 48 h (`expire_stale`). **`ALERT_URGENT=1` does not bypass the open-stream suppression**; it only shortens the grace on a NEW stream.
- So `alarm.mjs`'s claim that ALERT_URGENT bypasses "the alert router's recovery buffer" is untrue for any open stream (also `detectors.mjs` `detectProgramEvents`).

**What gets lost.** Every baseline-consuming finding fired while the stream is open is never emailed:

- config and program-byte drift (including fixed-forever values and the Core hash);
- brake pull and release;
- `unledgered_sweep`;
- `reserve_fell`;
- the vault-set change (bare burn);
- reschedules and frozen-claim events.

The same holds on the crank's `cbob-vault-crank` stream. Its failures page once, then go quiet. That also weakens limit 7's "its failures page from the crank itself" and `detectCrankSilent`'s "BLIND TO" sentence.

**Measured:**

- Scratch `ALERT_STATE_DIR` with the `cbob-vault-alarm` stream open: `ALERT_URGENT=1 alert-router.py --emit "CBOB VAULTS: 2 critical … mint.split_bps: 8500 -> 9900" cbob-vault-alarm` printed `SUPPRESSED cbob-vault-alarm (open 1.0h, asserted 3x)` and exited 0. `open.json` kept the old text.
- `notify-gary-sms.sh` exits 0 whenever `--emit` does.
- **Live router state (read-only):** `cbob-vault-alarm` has been OPEN since 2026-10-03 15:53 UTC with n=1, from a "FAILED TO RUN" note. Any finding the alarm raised before it auto-closes (48 h) would have been swallowed.
- **Real precedent:** `/opt/gary-alerts.log` shows 2026-09-03 `prog.core.hash: f03e… -> 96fa…`. That is exactly such a one-shot CRITICAL.

**Why HIGH.** No value moves. But this silences the detection half that limits 10, 28 and 40, the drift watch and the bare-burn watch all rely on. It does so for days after any page, routine ones included: a DAS-lag `reserve_fell` (L8), an index race (L9), a crank failure. And the finding is never retried, because the baseline has advanced.

**Smallest fix (in-tree):**

- `report()` emits one notify per finding kind, labelled `cbob-vault-alarm:<kind>`.
- Set `ALERT_URGENT` on every kind whose baseline advances.
- Send the full detail list, not `[0]`.
- On the first clean pass after findings, send `CBOB vault alarm RECOVERED` per kind that cleared.
- Alternatively, or as well, make the router (outside the freeze) let URGENT bypass open-stream suppression.

**Arm, both ways** (router in a scratch state dir):

- open `cbob-vault-alarm:pool_frozen` stream + new `cbob-vault-alarm:config_drift` → QUEUED;
- the same standing `pool_frozen` re-asserted → SUPPRESSED;
- a selftest that every baseline-consuming kind carries `urgent` and its own label.

## CONFIRMED, MEDIUM

### M1. The swap hop's Jupiter host no longer exists

**Raised by:** claude-opus INFO-3 (unverified there). Measured here.

- `revenue.mjs` hard-codes `https://quote-api.jup.ag/v6/quote` and `/v6/swap`.
- `getent` finds no host. `dig @1.1.1.1` returns NOERROR with no A record, only the jup.ag SOA. `dig @8.8.8.8` is empty. curl: "Could not resolve host".
- `lite-api.jup.ag/swap/v1/quote` answered **200** for the same SOL→cbBTC quote today.

**Effect.** Every live cycle throws at the first quote, before any SOL moves (safe and loud). So no royalty is ever swapped and `royalties_unswept` pages after a day. Fixing it touches `bank/`, which resets the counter.

**Fix:**

- Move to Jupiter's current API with one base-URL constant.
- Re-validate the `/swap` v1 response against the pre-sign checks.
- Add a certifying-run probe that quotes SOL→cbBTC.

**Arm:** live host → quote ok; a bogus host → the probe fails the run.

## CONFIRMED, LOW / INFO

| id | finding | auditors (their sev) | evidence · smallest fix · arm |
|---|---|---|---|
| L1 | **`BENIGN` misses the money-instruction races.** (a) `NothingToSplit`: `revenue.mjs` splits at :41 every 6 h, and **any stranger can split before :37 for a fee, hourly**. (b) A host's in-line monthly run or a burn distribution landing between plan and send. MINT checks `boosts_due` (lib.rs:1591), then `PoolShort`/`NothingToDistribute` (1604-1605), **before** `MonthNotElapsed` (1636-1640). So the race yields `NothingToDistribute` (or `BoostsExpireFirst` with a boost ending; `JoinWaitingFirst` on the w=0 tick, 1596), not the benign code. Each pages "action failed", and under H1 a griefer also keeps the crank stream open. | claude LOW-2, qwen F1 (LOW), mimo M1 (MED), glm R1-1/R4c-2 (LOW) | Measured: `BENIGN.test` is false for NothingToSplit, NothingToDistribute, BoostsExpireFirst, JoinWaitingFirst and PoolShort. **Fix:** NothingToSplit benign. On a refused `distribute`, re-read config: if `dist_epoch` or `last_distribute_at` moved since the plan, treat it as benign. PoolShort stays a failure. **Arm:** each race code with the epoch moved → benign; same code with the epoch unmoved → fail; PoolShort → fail. |
| L2 | **A reveal head whose asset reads `'other'` (a null RPC answer) is sent with `[]`.** MINT refuses `AttributesMismatch` on a live asset (lib.rs:1346-1353), which is non-benign, so it breaks the lane and pages. This is the third site round 23 L2's live-only rule missed. Adjacent: `payDecimals` from a null mint read becomes `Buffer.from([undefined])` = `00`, so the split goes out with decimals 0. | claude LOW-3, qwen F2, mimo L1 (+L2 decimals), deepseek | Code: crank.mjs reveal loop (`list = []` unless `=== 'live'`). Measured `Buffer.from([undefined])` → `00`. **Fix:** send `[]` only when `'burned'`; on `'other'`, log and break. Refuse the split when decimals is not a byte. **Arm:** 'burned' → sent with []; 'other' → nothing sent, no failure. |
| L3 | **The split is planned into a frozen or absent pool and a never-read Squads ATA**, and `splitToPool` counts toward the distribution. Result: an hourly refused split, plus `NothingToDistribute` at the month boundary when the pool held nothing else. Round 23 L9 covered only the source. | claude LOW-1, sol R1-3, astra R1-3 (all LOW) | Measured: frozen pool → `split:true`; absent pool → `split:true`. The crank never reads `bankAta`. **Fix:** read the Squads ATA; plan a split only when all three accounts are ok and unfrozen; report which one blocks it. **Arm:** frozen pool, frozen Squads and absent Squads each → no split plus one problem; all healthy → split. |
| L4 | **Round 23 M3 (crank heartbeat) blind spots.** (a) A failed `crontab -l` gives `crankLive=false` and resets `crankArmedSince`. That is fail-open, against the file's own "a read that fails is an ALARM". (b) The heartbeat's `failures` count is discarded by `parseCrankHeartbeat`. (c) `plan.problems`, an owed vault left out of every batch, never page. | claude MED-2, sol R1-1/R2-3 (MED), astra R2-1/R2-2 (MED), mimo H1 (**HIGH**), glm R2-1 (MED, partly) | Measured: `detectCrankSilent({live:false})` → `[]`; heartbeat `{failures:150}` parses to a fresh stamp. **LOW, not HIGH:** it needs `crontab -l` to fail while cron still runs the crank, or a persistent RPC fault on one asset. **Fix:** tri-state posture (`crank_posture_unreadable` HIGH, armed-since kept). The heartbeat carries `problems`, and the alarm pages one that repeats K passes. **Arm:** a throwing crontab → HIGH and since unchanged; a dry crontab → quiet. |
| L5 | **Round 23 L11 drift suppression hides a change across a one-pass null read.** old→null pages (read as an RPC blip); null(`_missing`)→**new** is skipped. This covers SEAL, BURN and GOV configs and the four `prog.*` ProgramData. `config_vanished` guards only MINT. | claude MED-1 (MED) | Measured: `burn.redeem_window_secs` 3600→null = CRITICAL, then null→60 = `[]`; `{'prog.mint._missing':true}`→hash = `[]`. LOW because it needs a coincident read failure. **Fix:** skip only keys that never held a value (persist the last non-null) and compare against it; mirror `config_vanished`. **Arm:** old→missing→new = CRITICAL; never-present→present = `[]`. |
| L6 | **The plan-sized fee floor (L14) is wrong in two ways.** (a) The over-ceiling branch returns ok before checking `need`; this needs a plan above 0.25 SOL, i.e. about 2,100 captures plus reveals. (b) All-or-nothing: a key short of reveal rent refuses the whole pass, cheap captures included, so draws lapse into the limit-25 re-roll class until it is topped up (loud). | astra R1-1 (MED) + adjacent, sol R1-2 (LOW) | Measured: `judgeFeePayer(251M,{need:260M}).ok` = true; `planCost(2100 cap + 2100 rev)` = 254,856,000; `judgeFeePayer(6M,{need:7.28M})` refused. **Fix:** check min before ceiling; budget and send captures first; refuse only the unaffordable reveals. **Arm:** all four combinations of funded/short × above/below ceiling, and a short-for-reveals key still sends its captures. |
| L7 | **A null, foreign or malformed element in a successful batched reserve read is stored as `0`.** That gives a false HIGH `reserve_fell` and a zeroed baseline, against the code's own claim that the last known value is carried forward. | sol R2-1 (MED), astra R2-5 (LOW) | `alarm.mjs` `balances[l.key] = String(r.amount)` regardless of `r.state`. **Fix:** on non-ok with a prior ok value, carry it forward and raise `balance_unreadable`. **Arm:** null element → carried plus HIGH unreadable; absent never-funded → 0 quietly. |
| L8 | **$GARY and $GIRAFFISH `reserve_fell` (key `vault:mint`) never correlate with the vault's own burn**, so an honest redemption under DAS lag stays HIGH. | sol R2-2 (MED), astra R2-4 (LOW) | Measured: `correlateBurns` → `V:INFO`, `V:GARY:HIGH`. **Fix:** emit `asset: vault, mint` separately. **Arm:** three-reserve redemption → all INFO; an unredeemed drop → HIGH. |
| L9 | **`index_disagrees_with_chain` CRITICAL on routine sales.** `minted_total` is read before the DAS walk, so a mint in between gives N+1 vs N. | claude LOW-5, sol R2-4 (LOW) | Measured: `detectIndexShortfall(3n,[4 ids],[])` → CRITICAL. **Fix:** re-read `minted_total` after the walk; page only if the index disagrees with both reads. **Arm:** N→N+1 race → quiet; persistent mismatch → CRITICAL. |
| L10 | **The ledger's writer defeats the reconciliation.** (a) `sendRejected:true` on a real `sweepSig`/amount quiets all three detectors. (b) An explicit `splitSig` is not held to L16's total/order rule: a 1-sat split before the return is accepted, while the same data via `splitByOther` → CRITICAL. That means **L16 is bypassed by its sibling branch.** (c) 200 empty rows push a fabricated `splitSig` past `verifyLastN`. (d) A far-future `startedAt` suppresses the grace check. | astra R5-1/R5-2 (MED), sol R5-1 (MED), glm R4c-1 (MED) | All four measured as stated. **LOW:** whoever can write `revenue-ledger.json` is the same user who owns the crontab and the alarm, so detection here can only ever cover an off-box key thief and mistakes. **Fix:** an on-chain sweep matched to a `sendRejected` row → CRITICAL; explicit `splitSig` gets the same total and time rule; the horizon follows the chain (every cycle whose `sweepSig` the scan saw); `startedAt` is clamped by the sweep's blockTime. **Arm:** each forgery → CRITICAL; an honest cycle → quiet. Limit 10 must say this (D2). |
| L11 | **A returned-but-unrecorded split** (a crash between split and save, or a front-run while mints refill the ATA). `cycle_unsplit` pages HIGH falsely. `revenue.mjs`'s recovery needs a provably empty ATA at :41, which a busy sale may never show after the :37 crank split, so the job wedges with "never recorded a cbBTC return". This is the zero-sampling assumption round 23 M1 removed from the alarm. | glm R2-3 (LOW), astra R5-4 (LOW) | Measured: a ledger with `returnedSats`, no split, 3 h old → `cycle_unsplit:HIGH`. **Fix:** close the cycle on chain evidence, i.e. a split with blockTime ≥ `returnedAt` and total ≥ `returnedSats` (the L16 anchor), in both the alarm and the recovery. **Arm:** such a split → closed and quiet; none → HIGH. |
| L12 | **cron-install `ours crank` substring-matches the `crank-reveal` line.** A reveal line hand-armed as `--live --reveal-only` arms the full hourly pass on reinstall, while the alarm's `crankArmed` says false. The selftest covers only the installer's own order. | sol R6-1 (LOW), astra R4c-1 (MED) | Measured: `CRANK_LIVE=[ --live]` vs `crankArmed: false`. LOW: the key is fee-payer only and the instructions are permissionless. **Fix:** anchor `"$TAG crank$"`. **Arm:** both flag orders. |
| L13 | **Gates that cannot fail.** (a) The L5 mutation arm's second element is always `[]`. (b) The wiring gate stays green when main()'s `detectIndexShortfall` is removed (reconcile still calls it), when a call sits only in a comment, or when its result is discarded. (c) "the length the program allocates" compares JS to JS; `MINT_CONFIG_SPACE` is never scraped (equal today: 1005/1005, 211/211). (d) The `attrsHash` and `readySlot` arms recompute the same expression. | mimo L3, sol R6-2, astra R6-1/R6-2, claude LOW-7/LOW-10 | All measured. **Fix:** an AST- or harness-level wiring check (`findings.push(...D.x(`, once per call site); scrape and evaluate both SPACE constants; drop the tautologies. **Arm:** each mutation above → red. |
| I1 | A retirement frees owed shares the planner does not subtract. The claim batch's `monthly_inline` then distributes unplanned (lib.rs:1676), and a boost ending at that epoch stays due for ≤1 h (the next pass pre-expires it). | astra R1-2 (LOW) | Hand trace of astra's state matches. **Fix:** subtract the retiring vaults' `pendingScaled` from the projected `owed_scaled`. |
| I2 | `due` uses the box clock. A box ahead of the chain wastes post-distribution fees (`MonthNotElapsed` is benign). | claude INFO-1 | Plan against the Clock sysvar. |
| I3 | `CBOB_REDEEMED_POOL_FROZEN` (a holder's forfeit) is not parsed, so it leaves no record off chain. | claude LOW-6 | Add it to `parseCbobLogs` and page it. |
| I4 | The launch gate exempts `charter_opens_at` and `lock_deadline` from RULED status, and does not enforce the "24 h before" in road step 6. | sol (Q4), claude | Require RULED; require `opens − deadline ≥ 86400`. |
| I5 | The standing frozen-account findings (`pool_frozen` urgent, `vault_account_frozen`, `revenue_account_frozen`) can never be acked. Harmless alone; under H1 they keep the stream open. | claude LOW-4, glm R2-2 | Page on transition, standing at INFO. Mostly cured by H1's fix. |

## ACCEPTED-LIMIT

- **The `/swap` transaction is signed unvalidated** (grok, claude INFO-2) → limit 10 (round 23 D3). Not worse, provided the operator condition holds (see D2). The return checks are all against the same untrusted party, which the limit should say.
- **The $CBOB release wallet is not watched on chain** (claude MED-3) → limit 56. It is not worse than stated, because the limit claims a file pin, not detection. A balance watch would be cheap.
- **$CBOB metadata is mutable** (mimo) → ruled (round 23). mimo's claim that "the release key can repoint it" is wrong: the update authority is `UPDATE_AUTHORITY` (`create-cbob-token.mjs:152`).
- **Capture lapses under load** → limit 25. L6(b) adds a cause that is loud and fixable.
- **`detectApprovals` is blind to non-ATA approvals** (qwen) → the blind spot is stated in the detector and covered by reconcile.
- **Limit 13 is a pre-lock condition** (mimo) → true as written.

## DOC-ONLY

| # | item | false claim? |
|---|---|---|
| D1 | Limit 55, SPEC:590 and **HOLDER-GUIDE:134** ("two $GARY burns", "200 $GARY"). At the monthly boundary the first distribution can be the free `distribute(false)` (lib.rs:1636-1640) or a host's in-line run, so the edge costs **100 $GARY** (claude, astra). | **Yes, holder-facing**, minor: it overstates the attacker's cost. |
| D2 | Limit 10's "the operator wallet holds only the cycle's funds and a 0.02 SOL float" is an unenforced operating condition. `FORBIDDEN` omits System and Token. `OPERATOR_FLOOR` equals the float and nothing refills it, so a float of exactly 0.02 SOL stops after one cycle (astra R5-3, mimo, glm, sol). The "detection half" does not survive a box compromise (L10). | **Yes, operator-facing.** Limit 10 is worse than stated for a box-level compromise. |
| D3 | Limit 45 "governance can never act again". `mint_vault` needs no live vault (lib.rs:1082-1087), so an open round can create one (astra). | Overstates harm (safe direction). Not a dangerous false claim. |
| D4 | OPEN AND BLOCKING carries finished items: 51 (including "boost timing (accepted, disclosed)"), 53 ("proven at `d57ee3a`", now stale) and 54 (an instruction to item 50) (claude, qwen, glm, mimo). | No. Classification only. |
| D5 | Items 22 and 53 have no rehearsal value set. The alarm runs `production:true` with pinned `pob_root` etc. unconditionally, so a rehearsal at throwaway values pages `test_value_in_production` every pass (and, under H1, mutes itself). At ruled values it cannot mint for about 10 days (7-day charter + 3-day vote) without burning a real Proof of Burn (claude MED-4). | Operator-facing. "The ids are the whole patch" is true of addresses, not of values. |
| D6 | `layout.mjs:31` "SEEDS … (asserted against the Rust)". No such assertion exists. All 11 seeds match today (measured) (astra). | Yes, a code comment claiming a control that does not run. |
| D7 | Selftest label "exactly TWO signers exist in v6". `launch/create-cbob-token.mjs` signs and sits outside the scanned tree (mimo). | Label only. |
| D8 | Limit 32's "live" counts unretired bare burns until the crank retires them (≤1 h), so the cap can read one higher (mimo). | No. Wording. |

## WRONG

- **`HOST_FLOOR=5` vs four `#[test]`** (claude LOW-9, glm R6-1, mimo). The fifth is `declare_id!`'s `test_id`. `--list` on the current binary (built after lib.rs's last edit) prints 5 tests.
- **mimo M2, `reweigh` field names.** No caller passes a decoded record. A raw record would throw on `debt` (`BigInt(undefined)`), not drift silently.
- **mimo M3, one split anchoring two cycles.** The detector does page on that input, but the input is unreachable: `revenue.mjs`'s open-cycle guard allows one open cycle, and a `splitByOther` close needs a provably empty ATA.
- **glm R1-2, a frozen pool stops joins.** `preJoins` are planned with no pool condition (crank.mjs "JOIN FIRST").
- **claude LOW-2's sub-claim "a racing distribution yields `MonthNotElapsed`."** PoolShort, NothingToDistribute and BoostsExpireFirst are checked first (L1).
- **glm R2-2, "pool_frozen pages every 30 min."** The router suppresses repeats; what it really does is worse (H1).
- **glm R2-1, a deliberately disarmed crank pages nothing.** By design: arming is a launch decision and a dry-run crank is documented quiet. The real defect is the failed read (L4).
- **mimo, `redemptions_near_cap` on every redemption at ≤47 live vaults.** Intended and asserted (round 22 A3).
- **mimo and glm R2-4, watch our collection's update authority / a census check.** Suggestions, not defects. The authority is MINT's PDA, which nothing can rotate.
- **claude MED-5 and others, "SEAL/BURN/GOV not bundled."** The off-chain pass is that by design; the programs pass bundles them (`v24-programs-*`). The harness's "every line of the four programs" sentence (`audit24.ts:215`) is a prompt-wording issue outside the freeze.
- **claude and mimo, item 12/17 contradicts 54.** The caveat is present at SPEC:1458-1459 (round 23 O7), and the 1.4M-wall sentence remains true.
- **grok, all R1–R6 items. Each one measured false:**
  - BENIGN contains the codes;
  - list + level → `revealed`;
  - the revenue clock is kept on an unreadable read (returned 123);
  - royalties are lamports, which cannot be frozen;
  - `crank_silent` is quiet when not live;
  - null(`_missing`)→value drift → `[]`;
  - `missingWatchedKeys` names `pob_collection.plugins_hash`;
  - the floors are `-eq` (run-tests.sh:235);
  - the L4, L7, L8 and L15 arms exist;
  - `planCostLamports` counts split and distribute (15 joins + split + dist = 4 tx);
  - bare-string split entries anchor nothing;
  - `pool_insolvent` is independent of `available`;
  - `cycleIsOpen` checks `sendRejected` first;
  - `lockDeadlineOf` is `min` by design;
  - I5's record-first order is by design;
  - `boosts_stalled` does not depend on the crank.
- **grok, "the `parseRustStruct` regex drops `pub(crate)`" and "`readProgramData`'s elfOffset is used despite a problem".** The parser throws, and alarm.mjs:219 throws on `problem`.
- **mimo H1 severity HIGH.** Downgraded to LOW in L4: it needs an environmental `crontab -l` failure.

## UNVERIFIED

- **A17 (carried):** whether DAS sets `burnt` on a burned Core asset. **Settles it:** one DAS read of a collection holding a burned Core asset, made a named pass/fail item of the dress rehearsal.
- **M1 remainder:** whether Jupiter's current `/swap` response passes `revenue.mjs`'s pre-sign checks (one signer, forbidden programs, ≤4 lookup tables). **Settles it:** a quote-and-build, without signing, against `lite-api.jup.ag/swap/v1` in the rehearsal.

**DOC-ONLY false claims:** D1 is a false claim to holders (HOLDER-GUIDE:134 says two $GARY burns when one can suffice). D2, D5 and D6 are false or incomplete claims to the operator. D3, D4, D7 and D8 are wording only.

**Verdict: NOT CLEAN.** 1 HIGH (H1: the alarm's one-label notify path lets the router silently drop one-shot CRITICALs while baselines advance, measured against the router), 1 MEDIUM (M1: the swap hop's host is gone) and 13 LOW are confirmed. No theft path was found, and nothing sends value anywhere the programs do not pin. Every CONFIRMED item needs its fix and both-ways arm before round 25. H1 and M1 touch `bank/`, which resets the counter; it stays at 0 of 2.
