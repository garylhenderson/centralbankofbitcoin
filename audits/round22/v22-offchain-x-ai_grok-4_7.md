The programs’ payout formulas match the JS copies as written. The holes are in what the crank sends, what the alarm treats as quiet, and gates that never see the Rust constants they claim to pin.

## R1. Crank (`bank/crank.mjs`)

**HIGH — Reveal lane and full pass are not one lock, so a normal pending reveal is a refused transaction and an SMS.** `main` (lock path) and the send loop for `capture_entropy` / `reveal_level` / `reschedule_reveal`.

The every-minute lane uses `.crank-reveal.lock`. The hourly pass uses `.crank.lock`. Both plan from `revealed_total` and both send `reveal_level` / `capture_entropy` / `reschedule_reveal`. Whichever lands second gets `AlreadyRevealed`, `AlreadyCaptured`, or `RescheduleTooEarly`. Reveal is the only step that `break`s on failure, so that pass also drops the rest of the queue. `run` then texts `CBOB crank: N action(s) failed`. This happens whenever the hourly pass overlaps the lane and any vault is still unrevealed — the steady state during a sale, not an attack.

Evidence: two processes, two lock files, one `AlreadyRevealed` in the second tx’s logs, one SMS, `revealed_total` unchanged by the loser. Not an out-of-order reveal: each process waits for its own confirm before the next index, so the loser stops rather than skipping ahead.

Fix: one lock for anything that touches the FIFO, or treat `AlreadyRevealed` / `AlreadyCaptured` / `RescheduleTooEarly` as done and continue. Do not `break` the FIFO on a duplicate.

**MEDIUM — A frozen pool is still an explicit `distribute`.** `planCrank` sets `distribute` from `pool.state === 'ok'` only. `pool.frozen` blocks claims, not the distribute flag. `distribute` in MINT does not look at the freeze byte. `monthly_inline` does, and returns without crediting.

So the path the program itself refuses on ordinary traffic, the crank sends every hour. That credits `owed_scaled` while no `claim` can pay. A redemption in that window forfeits the new credit (`CBOB_REDEEMED_POOL_FROZEN`). Limit 28’s “in-line never credits from a frozen pool” is true of the program and false of layer one.

Evidence: freeze the pool ATA, `planCrank` with `due`, weight, and `avail > 0` yields `distribute: true`. A landed crank tx increases `owed_scaled`. A redemption then logs `CBOB_REDEEMED_POOL_FROZEN` for sats that were not owed before that crank pass.

Fix: if `pool.frozen`, do not set `distribute`. Same for an unreadable pool (already skipped).

**LOW — `readySlot` assumes no skipped slots, then the program refuses.** `readySlot` vs MINT `try_capture` / `blockhash_in_window`.

The JS walks two leader-group strides from `reveal_slot` itself. The program’s A is the first produced slot in `[reveal_slot, reveal_slot + 64]`, and B/C stride from that. After skips, the crank’s capture slot is early. It still queues `capture_entropy` and, for the FIFO head, `reveal_level`. Both return `RevealTooEarly` / `NotYet`. The reveal `break` then refuses to touch later vaults that are actually ready. Fees every minute until the 300-slot window dies, then a reschedule. The comment that “a NotYet answer is harmless” is wrong for the head of the queue: it also suppresses later reveals in that pass.

Evidence: a vault whose `reveal_slot` was skipped, crank log `FAIL capture` / `FAIL reveal` with `RevealTooEarly`, later index not sent.

Fix: on `NotYet`, do not send `reveal_level` for that vault, and do not treat a planned capture as `capturedThisPass` until the capture tx has confirmed.

**LOW — This pass does not pay the vaults it just pre-joined.** `planCrank` claim assembly.

`preJoins` are sent first, then `distribute` credits them (they are in `preJoinWeight`). The claim list is only snapshot-`active` vaults plus `plan.joins` (same-epoch requests). Pre-joined vaults are still `pending` in the snapshot, so they are owed after this pass and not in any claim batch until the next hourly run. Not a loss. The comment “so this pass also delivers it” is false for them.

No out-of-order reveal in the planner: it walks `revealed_total` upward and stops. No instruction in the send list except the seven permissionless MINT names, so the crank key cannot retarget a payout. The hole is refused and duplicate work, not a second destination.

## R2. Alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**HIGH — The stuck month the crank exists for is quiet.** `detectDistributionOverdue`.

It returns `[]` when `total_active_weight` is 0. Launch, and the “nobody joined yet” case, are exactly that: requests sit in `pending_this_epoch`, the only legal action is the free epoch tick, and until it lands nobody can join. `joins_waiting` is `pending_count - pending_this_epoch`, which is 0 in that state, so it is quiet too. Limit 36 says this page is the backstop when the crank and in-line traffic both miss the month. The backstop does not arm.

Evidence: config with `total_active_weight = 0`, `pending_this_epoch = pending_count > 0`, `last_distribute_at + monthly_secs` older than the grace, pool balance above owed. `detectDistributionOverdue` is empty and `detectStandingRisks` has no `joins_waiting`. The selftest pins this as `QUIET with no activated vault`.

Fix: if the month is due and (`pending_count > 0` or weight > 0) and the tick/credit has not landed, page. Weight 0 is not “nobody to pay” once anyone has requested.

**HIGH — Credited sats that nobody claims never page.** Same detector, and `parseCbobLogs`.

`distribution_overdue` only watches `last_distribute_at`. Any `mint_vault` / `activate` / `claim` / redemption runs `monthly_inline` and stamps that clock. None of those fan out claims. Claim delivery is the crank alone. A dead crank plus ordinary mints keeps the clock fresh, `owed_scaled` rising, holders unpaid, SMS silent. Successful claims are not even a `CBOB_` line the parser keeps (`CLAIM_DEFERRED_FROZEN` only).

Evidence: after a landed `CBOB_DISTRIBUTED`, stop the crank, wait out the grace, alarm report has no CRITICAL while `owed_scaled` is unchanged and the pool still holds the sats.

Fix: snapshot `owed_scaled`. If the ceil stays above 0 for longer than the claim cadence, page `claims_not_delivered`. Parse a claim-paid log or read the drop in `owed_scaled`.

**HIGH — A live vault’s $GARY or $GIRAFFISH reserve can fall and the pass stays green.** `alarm.mjs` balance loop, `detectBalanceDrops`.

Only `mint.payment_mint` is read. The other two reserve ATAs are canonical, so `--reconcile` will not call them undeclared, and it does not diff amounts. `detectBalanceDrops` was written so a drain that leaves the asset alive is visible. That drain of the non-cbBTC reserves is invisible on every pass. The report line “no reserve fell” is false.

Evidence: drop the $GARY ATA of a live vault between two passes. Findings include no `reserve_fell`. cbBTC drop of 1 sat does fire.

Fix: same prev/current map for every `seal.reserve_mints` entry, not only the payment mint.

**MEDIUM — A legal sweep bound pages forever.** `detectStandingRisks` defaults `maxSweepCooldownSecs = 12h`, `minSweepCapLamports = 5 SOL`. `alarm.mjs` does not override them.

Gary’s initialize bounds, which the same function checks as production values, are a 24h cooldown ceiling and a 1 SOL sweep floor. A cooldown of 86400, or a voted cap of 1 SOL, is what `tighten_sweep` is allowed to reach. Both are standing HIGH (`sweep_cooldown_wedged`, `sweep_cap_wedged`) every 30 minutes, and the text says a vote cannot undo it. That is the wolf people will scroll past. The selftest only proves 1h is quiet and 7 days is loud; 24h is in the gap.

Evidence: `detectStandingRisks({ 'mint.sweep_cooldown_secs': 86400, 'mint.max_sweep_lamports': '1000000000' })` includes both wedge kinds. Those numbers are legal at `initialize`.

Fix: the working band’s floor must be `sweep_floor_lamports` (1 SOL) and its ceiling `cooldown_ceiling_secs` (24h), or page only outside the initialize bounds.

**MEDIUM — Program-byte watches are exempt from the “unwired key” check, and a missing ProgramData is calm after the lock date.** `missingWatchedKeys` (`if (prog === 'prog') return false`), `readConfigs`, `detectUpgradeAuthorityAfterLock`.

Core is filled in with `NO_PROGRAMDATA` when the account is absent. seal/mint/burn/gov are not. `detectUpgradeAuthorityAfterLock` skips `undefined`. After `CBOB_LOCK_DEADLINE`, a failed or missing ProgramData read does not page `program_not_locked` and does not fail `missingWatchedKeys`. Drift cannot fire either: both sides are missing.

Evidence: `getAccountInfo` null for the mint ProgramData, `CBOB_LOCK_DEADLINE` in the past. No `program_not_locked`, no throw from `missingWatchedKeys`.

Fix: produce an explicit `UNREADABLE` for every `prog.*` key and treat anything other than `IMMUTABLE` after the deadline as CRITICAL. Drop the `prog` exemption or special-case these keys the way core already is.

**Not a false close, but a blind event:** `parseCbobLogs` drops `CBOB_REDEEMED_POOL_FROZEN`, `CBOB_EPOCH_TICK`, and `CBOB_MONTHLY_WAITS_FOR_JOINS` (`type in owner` fails). Pool freeze itself is paged via `detectPoolHealth`. The forfeiture and the tick are not.

Pending guardian / swap operator are CRITICAL every pass on purpose. That part matches the brief. Do not “fix” it into silence.

## R3. Layouts (`bank/layout.mjs`, assertions in `bank/selftest.mjs`)

**MEDIUM — A Rust constant the money uses can change and the layout gate stays green.** `parseRustStruct` only sees `pub` fields. `LEVEL_WEIGHTS` and `ACC_SCALE` are not fields.

`selftest` checks `layout.LEVEL_WEIGHTS` against `accrual.WEIGHTS` against the literals `2,3,4,5,6` and `1e12`. It never reads `programs/cbob-vault-mint/src/lib.rs` for those consts. Cross-program `OFF_*` scraping only matches `const OFF_NAME: usize = N`. A new raw offset literal is invisible, and the “every pinned offset” assertion still passes.

Evidence: change the Rust weight table or `ACC_SCALE`, do not touch `layout.mjs`. The struct-equality tests still pass. Crank `pendingSats` then disagrees with `claim` (skip or extra zero-pay), and `detectPoolHealth`’s ceil disagrees with `ceil_sats`.

Fix: parse those two consts (and fail if any `data[OFF` / bare numeric offset appears in GOV/BURN/MINT without an `OFF_` name in the scrape).

**LOW — `encode` has no `[i64; 64]` writer.** BurnConfig cannot round-trip. `decode` can read the ring, which is what the alarm uses. A struct-field rename is caught. A padding-only size change is not, and is not an offset bug if padding stays at the end.

`parseRustStruct` stops at the first `\n}`. These structs are flat, so that is not a live miss. It will miss a macro field or a `pub(crate)` field later.

## R4. Accrual (`bank/accrual.mjs` vs MINT `credit` / `claim` / `retire` / `ceil_sats` / `join`)

No formula split in the functions that exist.

- `delta = avail * 1e12 / w`, `owed += delta * w` matches `credit`.
- `ceil` matches `ceil_sats` for any owed that fits in u64 sats (all of cbBTC does). The Rust `as u64` truncates if it ever did not; that is not reachable.
- `pending / ACC_SCALE` matches `claim`’s whole-sat pay. Sub-sat remainder stays in `debt_scaled` on chain; the JS does not move debt, and the crank does not need to.
- `join` debt is `weight * acc` at join time. `debtAtActivation` matches. The crank never applies it; the program does.

The crank’s local `acc += avail * SCALE / w` uses the same division, with `w` including pre-join weight. That matches the chain only if those joins land before `distribute`. If they do not, `distribute` reverts `JoinWaitingFirst` and the crank’s higher `acc` is not what `claim` pays. Extra pairs pay 0. They do not overpay. That is not an arithmetic fork.

What is not proven: the JS is not checked against the Rust constants (R3). Agreement of two JS files is not agreement with the program.

## R5. Swap hop (`bank/revenue.mjs`)

**HIGH — After the sweep, the signed transaction is not pinned to anything the program pins.** The block after `quote-api.jup.ag/v6/swap`, `vtx.sign([operator])`.

On chain, `sweep_sol_for_swap` can only pay `swap_operator`, at most `max_sweep_lamports`, above `sol_reserve_lamports`. The next signature is whatever bytes Jupiter returned. The check is: one signer, not the BPF loader, not the MINT program id, at most four address tables. A transfer of the operator’s entire SOL and cbBTC to any other address passes that check. No key theft required. Guardian `emergency_stop_sweep` does not claw back a sweep that already landed. The open-cycle guard stops a second sweep; it does not stop this signature.

Worst case, one poisoned response: the in-flight sweep (min of balance-above-reserve, 50 SOL script cap, on-chain cap) plus any other lamports or cbBTC sitting on that key. Not the pool, not a vault, not the 85/15 split. Limit 10 describes a thief of the key taking cap times cooldown windows until the guardian stops the sweep. This is a different actor (the quote server, or anyone who can answer that HTTPS call) and one shot at the whole operator balance, which the cap does not bind.

Evidence: a `swapTransaction` whose message transfers the operator’s SOL to a third key, one signer, no MINT program, no loader. `revenue.mjs --live` signs and sends it. Ledger then shows an open cycle; alarm pages only after the grace (default 60 minutes), which is detection, not a bound.

Fix: before sign, require the message’s SOL decrease and cbBTC increase to be the operator’s own accounts, reject any system transfer or token transfer whose destination is not the operator or the revenue ATA, and cap SOL spent at `amount`. Or drop the pretense of the check and state in the holder-facing limit that Jupiter’s response is a second trusted key.

**Ledger close:** `cycleIsOpen` does not treat a failed cycle as closed. `sendRejected` closes only the regex path where simulation failed and nothing moved. A confirm timeout leaves the row open. `returnedSats == 0` stays open even if `splitSig` is set. `splitByOther` is set only after `isProvablyEmpty` on the revenue ATA, which does not treat absent as empty. I did not find a path that writes `splitSig` / `splitByOther` for a cycle whose cbBTC never reached that ATA and then treats it as closed.

Wedge, not a false close: a return delta of 0 with `minOut == 0` can still transfer leftover operator cbBTC and record `returnedSats = 0`, which stays open forever. That stops the next sweep; it does not hide a loss.

## R6. Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`)

**MEDIUM — The weight/scale “proof” cannot fail when the program changes** (see R3). The literals live in the test.

**MEDIUM — `missingWatchedKeys` cannot fail for the program watches.** The exemption is unconditional. A test that builds a full snap and deletes `mint.pool_ata` does not prove the prog keys.

**LOW — Mainnet floor is skipped with a green run when DNS fails.** `run-tests.sh` prints `SKIPPED` and does not apply `MAINNET_FLOOR`. An empty network is a pass. The comment admits it. A ship run can still quote “green” without the 24 live checks.

**LOW — `judgeCronTemplate` on a file with no crontab lines returns `[]`.** The “every money job is flock’d” assertion would pass on an empty template. The separate “exactly the six jobs” assertion would not, as long as that one stays.

Floors that require equality cannot be satisfied by deleting assertions unless the floor constant moves in the same commit. That is the residual, and it is inherent. I did not find a `<` floor left in `run-tests.sh`.

The control-table gate checks that a backticked error name exists in the enum, not that the instruction still returns it. An empty table fails `block.length >= 5`. A renamed refusal that keeps the old name in the enum still passes.

## Accepted limits

**1. Worse than stated**

- **36 and 7.** The stated backstop is `distribution_overdue` and `reveal_rescheduled`. Overdue does not fire when weight is 0 and the missing action is the epoch tick. `reveal_rescheduled` fires only if someone lands `reschedule_reveal`. A wedged crank sends neither, so the “stall is loud” sentence is false for the two events that define the stall. Claims not running at all is the same shape and is not in the limit text.
- **28.** In-line skip on a frozen pool is real. The crank’s explicit `distribute` undoes it every hour, which increases what a redeemer forfeits. The limit does not say layer one will keep crediting.
- **10.** The cap binds `sweep_sol_for_swap` only. The Jupiter signature is a second unbounded exit for whatever is already on the operator key, without stealing the key. The written cost (cap times windows, key thief, guardian stop) is the wrong bound for that path.
- **27.** “The crank never pays or joins a positively burned vault” is true of the snapshot, not of the chain at send time. A burn landing after `getMultipleAccountsInfo` is still paid. `assets === 'other'` (null account, or a tombstone that is not 1 byte of `0`) is not retired and not excluded.

**2. Not actually a limit, or already closed**

- **35** is already not a constraint at 21% / 51%. Nothing to reopen.
- **34** matches the code that was in the bundle (MINT `StopIsNewer`, monotone tighten). I did not have GOV’s executor, so I am not calling the skip path discharged from this read.
- **12/17** is discharged for the padded mint path it measured. It is not evidence about redemption CU (`claim` + open + sweeps + `burn_vault` + `retire_redeemed` + `monthly_inline`). Do not treat that discharge as covering the redemption packet.

**3. Discharged items that are not clearly open**

I am not reopening 14, 19, 30, 31, or 33 from this bundle. 33’s “same arithmetic” for 7 days vs 60s is still an argument, not a 7-day run. That was accepted as discharged. I did not see a counterexample in MINT’s `checked_add`.

**4. Open items being treated as accepted**

- **22** is still open in the code: crank defaults to dry-run, and nothing here is a live 2,100-vault run. Not quietly marked accepted.
- **50** is still open: `judgeRedemptionCoverage` has no caller in `alarm.mjs` or the crank. The poster has no sender. Not quietly marked accepted.
- **38** is still open in the sense the alarm’s production list is only nine fields. `max_supply`, `level_caps`, treasury, payment mint, and `pob_root` are not standing checks. The pre-sign script is the real gate, and it is not in this run. A bypassed checker plus a wrong `max_supply` stays quiet forever because that field is not in `test_value_in_production`. That is a hole beside 38, not 38 marked accepted.

## Else

MINT `join` via `claim` still does not require the asset to be live. That is limit 27, not a new program bug. `waiting_to_join` is a counter, not a list, and it does what the comments say: a distribute cannot credit past eligible requests unless the counter is wrong. I did not find a way to desync that counter on the paths in this file.

`runDistribute` treating any log containing `MonthNotElapsed` as success is safe only while that string cannot appear beside `JoinWaitingFirst`. Today the time check is after the join check, and the tx is one instruction. If those are ever reordered, a refused distribute will be logged as done and claims will go out against the old accumulator.

## What to do before launch that this process cannot

I did not execute the suite, the simulator, or a cluster. BURN, SEAL, and GOV were not in the bundle. A green reading of MINT does not certify them. Do these on a throwaway deployment with the real binaries, before `set-upgrade-authority --final`:

1. Run the crank `--live` against a cluster with ~2,100 vault records, including a killed RPC mid-page and a reveal lane overlapping the hourly pass. Count refused transactions. Item 22 is this run, not another model round.
2. Freeze the pool ATA, run one crank pass, redeem one vault, and read whether `owed_scaled` rose and `CBOB_REDEEMED_POOL_FROZEN` fired. If it did, the crank is wrong, not the limit text.
3. Sign one real Jupiter swap built from a fixture transaction that pays a third party, and confirm the process refuses it. If it signs, do not launch the hop on that code.
4. Land one redemption and one 14-vault claim on that deployment and record `computeUnitsConsumed`. The discharged CU note is the mint-pad path.
5. Have a person who is not the model diff the signed `initialize` transactions against `launch/mainnet-init.json` field by field, including `max_supply` and `level_caps`, which the alarm will not catch afterward.
6. Pull the crank process over with `kill -STOP` for longer than a month-stub and confirm an SMS fires for the epoch tick and for undistributed claims. If it does not, the liveness story in limits 7 and 36 is not true on this code.
7. Only then remove upgrade authorities. There is no second chance, and no later round will have run the binary either unless someone runs it.