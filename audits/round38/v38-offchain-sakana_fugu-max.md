# Round 38, OFF‑CHAIN pass — independent audit

**What I did.** I read the whole bundled tree against the target list R0–R6. **I executed nothing.** No validator, no `run-tests.sh`, no `bank/selftest.mjs`, no crank, alarm, revenue job, poster, router or fork; no mainnet read. Every claim below is from source reading, and each one names the measurement that would settle it. Where I could not settle something from the bundle I say so and grade it as a verification item, not a proven defect. My floors are therefore: nothing here is a measured run, and no finding of mine should be treated as one.

---

## R0 — Round 37's verdict and its repairs

I re-derived each confirmed finding from the tree rather than from the verdict.

| Round‑37 item | Where it lives now | Verdict |
|---|---|---|
| **C01** ack arms | `bank/selftest.mjs` lines driving `unredeemable_owner` (the one ackable kind), the cross‑kind arm keyed `vault_burned:<asset>`, the cross‑asset arm, the `true` arm, the empty‑`why` arm, plus the positive control arm | **Repair holds.** Each of the three arms goes red under the mutation it was written for: m1 (empty‑`why` guard removed) turns the `'   '` arm to INFO; m2 (`true` accepted) turns the `true` arm to INFO; m3 (key looked up by asset alone) turns the cross‑kind arm to INFO. All three now sit on `unredeemable_owner`, so `ACKABLE_KINDS` no longer masks them. |
| **C02** frozen‑pool tick | `bank/crank.mjs` tick branch (`else if (joinable && poolOk && due && w === 0n && waitingThisEpoch)`, no `!pool.frozen`) and the alarm's `covered` matcher | **Partially repaired — see F1 below.** The tick is planned, and the matcher matches the crank's exact string. The *joins* the repair claims to have added are planned but never sent. |
| **C03** commented `-n` | `judgeCronTemplate`'s `live` filter feeding `varHasN`; both‑ways arms including the real template with line 83 commented | **Repair holds.** `live` strips `^\s*#` lines before the `varHasN` test, and the real template still passes. |
| **C04** `--audit` total | `bank/revenue.mjs`'s `swept` reduce with `c.sendRejected ? 0 : …` | **Repair holds**, and the selftest extracts the actual expression rather than re‑typing it. |
| **C05** 34 SOL/day | `SPEC.md` limit 10 | **Repair present** (text only; the cron is unchanged, as the exception required). |
| **C07** refused row + sweep | `detectUnreconciledRevenue`'s `rejected_row_has_sweep` plus the pinned arm | **Repair holds.** |
| **C06 / C08–C19** | — | I found no surviving defect among them; C09 (reconcile lane liveness) and C14 (`RESCUE_SEED` absent from `L.SEEDS`) are still true and still already‑stated. |

---

## R1 — the crank

### F1 (MEDIUM) — the round‑37 C02 repair is one site short: from a frozen pool the crank plans the joins and then never sends them

**Construct.** `bank/crank.mjs`, `planCrank`: the joins this pass's distribution makes eligible are planned into `plan.joins` whenever `plan.distribute` is true, including the `distributeKind === 'tick'` branch that round 37 deliberately opened to a frozen pool. But the only place `plan.joins` is ever sent is inside the claims block in `main()`:

```js
if (poolOk && !pool.frozen) {
  const ready = [] … ready.push(...plan.joins)
  for (let i = 0; i < ready.length; i += batch) plan.claims.push(ready.slice(i, i + batch))
}
```

With the pool frozen, that block is skipped, so `plan.joins` is dropped — while `describePlan` still prints `join after 1`. `main()` has no other sender for `plan.joins`.

**What it gains.** Nothing is lost and nothing is mis-paid: the joins are join‑only claims (MINT's `r.pending` branch joins and `continue`s without a transfer), so they are *safe* under a freeze — which is exactly the argument round 37 used to justify the tick. The cost is that the tick advances `dist_epoch` while the cohort it was supposed to admit is not admitted, so they are joined on the **next** full‑lane pass (they become `plan.preJoins`, which *is* sent unconditionally), i.e. up to an hour later during a freeze. The plan log also states work that was not sent, which is the "false page" shape R1 asks about.

**Evidence if I am right.** A `planCrank` call with `pool: {state:'ok', frozen:true}`, `w === 0`, one live requester of the current epoch and the month due returns `distribute: true, kind: 'tick', joins: [[rec, ata]]` **and** `claims: []`. (The existing round‑37 arm asserts only `p.joins.length === 1`, which is why it passes.) On chain: one frozen‑pool pass sends `distribute(false)` and no `claim`; the requesters are still `pending` afterwards; the next pass sends them as `preJoins`.

**Fix.** Build a join‑only batch when the pool is frozen (they cannot revert: no transfer), and keep the paying claims behind `!pool.frozen`. Then make the arm assert the send path, not just `plan.joins` — the arm as written certifies the plan the way C01's arms certified a kind that could not be acked.

### F2 (LOW) — a failed distribute still spends fees on the post‑expiry batch

**Construct.** `main()`: `if (plan.distribute) await expire('after', plan.postExpires)` keys off the *plan*, not the send's result, so a distribute that failed (or was refused as benign with no epoch movement) is followed by `expire_boosts` batches that MINT skips record by record (`dist_epoch < boost_end_epoch`) and that therefore pay a fee for nothing. `planCostLamports` counts them, so the fee floor stays honest; the money is ~5,000 lamports per batch.

**Evidence.** A pass where the distribute fails and `postExpires` is non‑empty shows the expiry batches in the log after the failed distribute, with `CBOB_BOOSTS_EXPIRED n=0`.

**Fix.** Gate the `after` batch on `ok !== 'fail'`.

I found no plan the program refuses beyond the benign races already enumerated, no reveal sent out of order (`revealed_total`-anchored, first‑not‑ready stops the run), no join or payment of a dead vault (burned assets are skipped and retired first, `'other'` assets are reported and left out), and no value movement the program does not pin — the crank's only non‑fee outflow is Core's attribute rent into the record's own asset, which the reveal's `WrongAsset` check pins.

---

## R2 — the alarm

### F3 (MEDIUM, unverified — one account read settles it) — both collection‑plugin watches rest on an unproven Core layout; the crank's reveal lane rests on the same one

**Construct.** `bank/layout.mjs` `collectionPluginsHash` assumes `CollectionV1` is `key|update_authority|name|uri|num_minted|current_size` **followed by the plugin region in the same account**, skips the two strings and 8 bytes, and hashes `d.subarray(o)`. `bank/alarm.mjs` `readConfigs` stores that as `collection.plugins_hash` and `pob_collection.plugins_hash` (both CRITICAL in `WATCH`). `bank/crank.mjs` `mintedAttributes` reads the Attributes plugin through `deserializeAssetV1` on the **asset account alone** and hashes it before every reveal.

**What it would gain (if the assumption is wrong).** If Core keeps the plugin registry in its own account (a `PluginHeaderV1`/registry PDA — the shape that would also explain why `AddCollectionPluginV1` carries the payer and the System program), then:
* the collection account is exactly the base fields, `d.subarray(o)` is empty, and `plugins_hash` is `sha256('')` for **every** collection — so the CBOB collection's 10 % royalty and the PoB collection's plugins are never re‑checked. That is the only watch behind accepted limit 46's hot Moments update authority ("the alarm pages on ANY plugin or update-authority change on that collection"); only the *update authority* half would survive.
* `mintedAttributes` returns `[]` for every asset, `judgeRevealAttrs([], hash)` returns `'mismatch'`, and the crank's reveal lane breaks on the first vault of every pass and pages "attributes read off the asset do not hash to the stored attrs_hash" — with `break`, so the FIFO never advances.

**Evidence if I am right.** One mainnet read settles both: take the LIVE Giraffish Moments collection `F9TDm35J…` (which carries a royalties plugin) and print `account.data.length` against `33 + (4+len(name)) + (4+len(uri)) + 8`. Equal ⇒ the tail is empty and the hash is a constant ⇒ F3 stands. Longer ⇒ the inline layout holds and F3 is **void**, and so is any concern about `mintedAttributes`. A second, independent check: run `bank/crank.mjs`'s `mintedAttributes` (or the SDK directly) against a real vault that has just been revealed and see whether the `level` attribute comes back.

**Why I cannot settle it from the bundle.** The only test of the hash is `bank/selftest.mjs`'s synthetic `coll()` builder, which encodes the author's assumption rather than Core's bytes; the probe reads reserve mints, ProgramData and the PoB set but never a collection's plugin region; and both layouts are consistent with the account list `AddCollectionPluginV1` is given. I am not claiming the layout is wrong — I am claiming that **nothing in the tree measures it**, while two CRITICAL controls and the whole reveal lane depend on it.

**Fix.** Add the read to `scripts/probe-mainnet-facts.mjs` (it already reads mainnet facts a local validator cannot produce): assert that the LIVE Moments collection's account is longer than its base fields and that the hash changes if a byte in the plugin region is mutated — or, if it is not longer, hash the registry account instead.

### F4 (MEDIUM) — a transaction the parsed reader structurally refuses holds that program's scan cursor forever

**Construct.** `bank/txread.mjs` `validateParsedTransaction` refuses, among others, `tx.version === 1` with any `source === 'lookupTable'` account key, a v1 transaction whose `message.transactionConfig` is absent, and any version other than `legacy|0|1`. `bank/alarm.mjs`'s scan counts those as `unread` and **only advances the cursor when `unread === 0`** — and the backlog record is written inside the same `if (!unread)`, so a backlog is never even recorded for that program. `bank/redemption-poster.mjs` throws on the same refusal (`if (!tx) throw …not advancing past it`), and `bank/revenue.mjs` `splitsSince` propagates the throw into the split‑recovery path.

**What it gains.** For a *transient* failure this is the right direction. For a *structural* refusal it is permanent: the refused transaction never becomes readable, so the cursor never moves, every pass re‑reads the same window and re‑pages `tx_unreadable` (HIGH, level) forever, and once more than `PER_PROGRAM_READS` transactions exist after the cursor, the transactions between the cursor and the newest 2,000 are never examined at all — the resumable‑backlog machinery of rounds 30–31 is defeated by exactly the case it exists for. `SPEC.md`'s "Scan backlog boundary" ("any backlog drains") and its "Reader coverage boundary" ("the cursor stays where it was so the next pass tries again") are both false in this case, and no remedy is documented.

The cheapest trigger is the v1‑with‑lookup‑table refusal: v1 permits lookup tables, `jsonParsed` resolves the keys anyway (the consumers only use the resolved strings), so the refusal is not needed for correctness — but if it is kept it must not hold a cursor. A v1 transaction that merely *names* MINT as a loaded account is listed by `getSignaturesForAddress(MINT)` and is refused, for one fee.

**Evidence if I am right.** Send a v1 transaction using a lookup table that names MINT (or mock the RPC to omit `transactionConfig` on a v1 transaction): the alarm's next pass pages `tx_unreadable` HIGH for it and `cursors[mint]` is unchanged on the pass after that and the one after that. On the poster, the run exits 3 without saving its cursor.

**Fix.** Distinguish "unreadable now" from "unreadable by construction". A transaction whose refusal comes from the *reader's own* validation (not an RPC error) should be recorded exactly like a runtime‑truncated log — one level finding with stable, signature‑free text, the signature kept in state until a person reviews it — and the cursor should advance past it. Transient RPC failures keep today's hold‑the‑cursor behaviour.

### F5 (LOW) — `detectSweepState`'s doc block contradicts its code and its own selftest

**Construct.** `bank/detectors.mjs` `detectSweepState`'s JSDoc says "The first pass only takes the baseline" and "within an hour of it". The code treats a missing `judgedThrough` as MINT's initial `0` and *judges* the latest sweep on the first pass (`const from = Number(judgedThrough ?? 0)`), and the window is `Math.abs(t − start) <= cooldown/2` (3 h at the ruled 6 h). The selftest asserts the code's behaviour ("a missing baseline judges from 0", `cooldownSecs`-scaled windows), so the comment is the only thing wrong — and it is wrong in the direction that makes a reader check the wrong window.

**Evidence.** `grep -n "only takes the baseline" bank/detectors.mjs` and read the two lines below it; then read the selftest arms `first(null) === 1` and the `T±10800/10801` cases.

**Fix.** Rewrite the block to say what the code does. (The drift sweep covers SPEC/HOLDER‑GUIDE/DESIGN/web‑README; `bank/` comments are outside it, which is why this survived.)

### F6 (LOW) — the redemption‑cap mirror is copied three times and none of the copies is asserted against the others

**Construct.** `bank/detectors.mjs` `redemptionCapacity` hardcodes `210n`; `bank/layout.mjs` declares `REDEEM_RATE_BPS = 210n` and `REDEEM_WINDOW_SECS_MAINNET = 3600n`, which nothing consumes; `bank/selftest.mjs` scrapes `LEVEL_WEIGHTS`, `ACC_SCALE`, `REVEAL_WINDOW_SLOTS`, `LEADER_GROUP_SLOTS` and `ENTROPY_GROUP_STRIDE` out of the Rust but not this rate. Separately, `bank/revenue.mjs`'s `MAX_PER_CYCLE_LAMPORTS` is 50 SOL under a comment that says "Set this at or below the on‑chain cap", and the cap is 10 SOL — harmless (the chain cap governs through `sweepAmount`'s `Math.min`), but a reader can mistake the dead bound for the live one.

**Evidence.** `grep -rn "210" bank/detectors.mjs bank/layout.mjs` and `grep -rn REDEEM_RATE_BPS bank/` (no consumer); `grep -n MAX_PER_CYCLE_LAMPORTS bank/revenue.mjs` against `launch/mainnet-init.json`'s `max_sweep_lamports`.

**Fix.** Scrape BURN's rate constant and ring size in the same block as the other L3 mirrors, and delete or assert the unused layout copies; set `MAX_PER_CYCLE_LAMPORTS` to the ruled 10 SOL or say in the comment that the chain cap is the effective one.

**What I could not make the alarm page on.** I looked for a dangerous state read as quiet and found none beyond F3: a pending guardian/operator (`guardian_armed`, `swap_operator_armed`, CRITICAL level), the lock date (`program_not_locked`, plus `lock_deadline_unset` when no date is on record), the production values, frozen/insolvent/unreadable pool and revenue account, unsplit revenue, unswept royalties, a stalled reveal queue, an armed-but-silent crank, a repeating crank failure, an off‑curve owner, a nested vault, a kept‑close‑authority stray (via the page's contract) and every fixed‑forever value are all covered, and the freeze transitions are correctly one‑page‑then‑INFO. The routine states that *do* re‑page every pass (a pending key change nobody applies, an unreviewed log gap, `scan_gap` during a burst, `index_disagrees_with_chain` under DAS lag, `royalties_unswept` masked by incoming royalties) are each disclosed in SPEC; F4's `tx_unreadable` is not.

---

## R3 — the layouts

The D6 seed assertion now exists and is real: all eleven `L.SEEDS` entries are scraped from the program that declares each seed, a mistyped seed and an undeclared extra are both caught, and the arm requires exactly 11 keys. The cross‑program offset list is complete against the `OFF_` constants scraped from MINT/BURN/GOV and the suite's own copies; the parser throws on a line it cannot read as one `pub name: Type` field; the allocation sizes are evaluated from the Rust and held to the layout. The one residual is the one‑directional gap already recorded (a seed a program declares and `layout.mjs` does not name, e.g. `RESCUE_SEED`, is not caught) — round 36 C15 / round 37 C14, no new defect. F3 is a layout claim, but about Core's account, not about our structs.

## R4 — the money arithmetic

I traced `credit`, `owed_of`/`pendingSats`/`pendingScaled`, `reweigh`/`carry`, the join (`debt = weight × acc`), the expiry (`carry = owed at the old acc`, `debt = level weight × old acc`, then level weight × the delta), the retire (`owed_scaled -= pending`, weight off the denominator) and `available`/`ceilSats` against MINT line by line and found no divergence. The crank's `w` is the post‑join/post‑retire/post‑expire denominator, its `avail` uses the same `ceil`, and the pre‑join vault's owed is `weight × (acc − old_acc)` — all matching. The `boosts_stalled` check sits inside the `pending_count/pending_this_epoch` guard, but both keys are on `WATCHED_KEYS`, so a reader that dropped them fails the pass rather than silencing the detector.

## R5 — the swap and the revenue cycle

The oracle math checks out for both exponent signs (`sats = lamports·sol·10^(es−eb) / (btc·10)`, floor division, floor applied again for the 150 bps), `readPyth`'s offsets (40 = level, 41 = feed, 73/81/89/93 = price/conf/expo/publish_time) match the `PriceUpdateV2` layout the fork test exercises against the real accounts, the direction of `orcaSpot` and `meteoraSpot` is right (both land within a bps of `satsPerLamport` for the pinned pools), the judge refuses each of the eight tampers on both venues while the round‑24 judge passed all eight, `classifySendFailure` puts landed‑and‑failed and expired‑unlanded on the refusal side and leaves anything the chain cannot settle open, and the ledger/`closesCycle` anchors are chain‑derived. The residual bounds are the disclosed ones: ≤150 bps of the oracle's expected output per cycle (the gate is a read‑time filter, not an execution bound), the one RPC endpoint, and the box owner. Nothing new.

## R6 — the gates

Floors equal counts everywhere (`DET_FLOOR`/`FLOOR` 925, `ALLOC_FLOOR` 39, `POSTER_FLOOR` 24, `HOST_FLOOR` 6, `LAUNCH_FLOOR` 49, `POB_FLOOR` 14, `MAINNET_FLOOR` 33, `SWAP_FLOOR` 16, `EXPIRY_FLOOR` 4, `MIN_ASSERTIONS` 895), the on‑chain and probe floors are equality, the probe and the fork are fatal under `CBOB_SHIP_GATE=1` when skipped, `build-mainnet.sh` builds and compares all five programs including the sweep helper's byte identity against both the localnet build and `target/deploy`, and `cron-install.sh` arms only our tagged, uncommented lines (the real shell is executed by the selftest). The one gap I found in the gates is part of F1: the C02 arm asserts the plan's joins and not that they are ever sent.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?** No. Limit 7's stall is now paged from outside the stalled job (`crank_silent`, `royalties_unswept`), limit 25's re‑roll is still one per silent window, limit 26's C‑leader advantage is stated at its measured size, limit 28's forfeit is stated with its log line, limit 32's ring bound and limit 41's transfer hole are as written. F4 is not a limit — it is an undisclosed permanent blind spot in the *watcher*, which is the opposite direction from "worse than stated" and belongs on the list only if it is not fixed.
2. **Is anything listed as a limit not actually a limit?** Limit 36's "the in‑line monthly run is skipped by … a DUE $CBOB boost" is real, but the crank half of it is now narrower than the text: since round 37 the crank plans the tick from a frozen pool, and F1 shows the joins it plans there are not sent. Nothing is closed that the text claims is open.
3. **Is any DISCHARGED item not discharged?** No. I re‑checked 14 (`DuplicateAttribute` is refused in `check_attributes`), 19 (`activate` refuses `NotRevealed`, so no activated‑but‑unlevelled state exists), 30 (`split_bps` and both destinations are written once; `update_wiring` is gone), 31, 33, 51, 54, and the v5 Bank/deck/distributor family — all closed for the reason given.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** Not in the documents — 22, 38, 50, 52 and 53 are still listed as OPEN, the road table still shows steps 8, 10 and 11 as not started, and `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline` and `vault_collection` as `OPEN`, which `check-launch-params.mjs` refuses. The quiet risk is operational, not documentary: item 22's named rehearsal items are the only thing that will ever exercise the crank's and revenue job's I/O, and they include `mintedAttributes` and the frozen‑pool tick — both of which F1 and F3 say are unexercised today.

---

## Given that no human firm will ever see this, and the programs will be immutable

Concretely, before the lock:

1. **Do the item‑22 rehearsal, and add three cases to it that no AI round can produce:** a frozen pool with a requester this epoch (F1 — does the join land on the next pass, and does the log say so?); a v1 transaction with a lookup table naming MINT (F4 — does the cursor move?); and one `bank/crank.mjs` reveal against a real vault with real attributes (F3's second half — does `mintedAttributes` return the minted list?). Each has a pass/fail signature.
2. **Read the two accounts nobody has read:** the LIVE Moments collection's account length against its base fields, and a real vault's plugin region (F3). One minute, and it decides whether two CRITICAL controls exist.
3. **Rebuild the artifacts twice, by two people, from the same commit, on different machines**, and compare the five `sha256` values by hand. `build-mainnet.sh` proves the localnet feature is real; it explicitly does not prove the compiled constant is Gary's key, and reproducibility is the only bridge it names.
4. **Prove the alarm can reach a human.** Send one URGENT and one level notice through the real router to a real phone and email, from a rehearsal state directory, and confirm the recovery closes the stream. Every detector in this tree is worth nothing if the last hop is a silent no‑op, and that hop is the one thing no auditor in this tree can test.
5. **Have a person read `launch/mainnet-init.json` against the SPEC's ruled list, value by value, out loud**, before the four `initialize` transactions are built from it. `check-launch-params.mjs` validates the file; the file is not the transaction.
6. **Fix F4's class before the lock, not after.** A monitoring blind spot is the one thing immutability makes permanent that a bug‑fix release cannot reach: the programs can be stopped by the guardian, but the watcher has no guardian.