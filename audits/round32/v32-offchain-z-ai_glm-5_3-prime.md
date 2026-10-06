# Round 32, OFF-CHAIN pass: NOT CLEAN

Round 31 was NOT CLEAN and its repairs are present at their sites. I verified each repair independently, then audited the whole tree. I found **one MEDIUM and one LOW that survive measurement**, both in the round‑30/31 scan‑backlog machinery — the exact area the last two rounds repaired. Everything else I checked held; I list what I verified so the next reader knows it was measured, not assumed.

---

## R0 — Round 31's verdict and repairs

**All four repairs hold at their sites.**

- **L1 (log‑gap grief):** `detectLogGaps` (`bank/detectors.mjs`) is a level condition keyed to a human‑written watermark (`bank/log-gaps-reviewed`, read by `readGapsReviewed` in `alarm.mjs`), signature‑free text, standing every pass. The selftest arms (g1/g2/g3/done/again/lost) can all fail. Repair real. **One residue survives — see LOW‑1.**
- **L2 (read budget):** `PER_PROGRAM_READS` (alarm.mjs) bounds the walk to `min(20, ceil(2000/1000))` = 2 pages of 1,000 per program; the trim and over‑budget gap are armed at a 1,500 budget (I recomputed the `b15`/`b17` expectations against the stub cluster — the `seen.size = 1500` figure is correct because the Set dedupes the overlapping re‑read). Repair real. **One residue survives — see MEDIUM‑1.** Note the repair bounds the walk but does not reorder reporting; pre‑walk CRITICALs still wait for the pass to end. That residue is disclosed in SPEC ("delays the pass's report, the account‑state findings included, by roughly 16 to 52 minutes"), so it is not a new finding.
- **D1 (SPEC 38 wording):** the five values (guardian, operator, cap, cooldown, reserve) are all in `WATCH` as drift keys; the two CRITICAL bound checks exist. Text now matches code.
- **D2 (poster SOL):** `releasedFromTx` counts System transfers with `source === vaultPda`, `ASSETS` names SOL, the R31 D2 selftest arm exists and can fail.

Round 31's dispositions I re‑checked: C01 (wSOL dust — `CloseAccount` on a native account returns lamports; the sweep‑at‑execution shape leaves nothing wrapped), C02 (v1 has no ALTs), C03 (negative Meteora bin id unreachable at any non‑inverted price) — I agree with all three.

**Verdict on the verdict:** accurate. The clean‑round counter stays 0/2; this round is also not clean.

---

## R1 — The crank (`bank/crank.mjs`)

I hunted specifically for the four asked shapes and did not find them:

- **A plan the program refuses:** the reveal loop breaks at the first not‑ready record; `revealAttrSource` sends `[]` only for a positively burned asset; the split is planned only with all three destination accounts live and unfrozen (L3 arms); `judgeDistributeRefusal` re‑reads config and treats an unmoved epoch as a fault; `MonthNotElapsed`/`NothingToSplit` races are benign. The activation keys match MINT's `Activate` account order. I could not construct a wasted‑fee plan that is not either benign‑classified or a genuine fault.
- **Paying or joining a dead vault:** burned → retired first, never joined or paid; `'other'` (null RPC) → skipped and reported, and no distribution is planned while an eligible vault is unreadable (matches `JoinWaitingFirst`).
- **Out‑of‑order reveal:** reveals run from `revealed_total` in mint order and stop at the first failure, benign, or skip.
- **Value routing:** the instruction set is MINT‑only, destinations are program‑pinned; the selftest's signer‑set and no‑transfer arms hold.

`budgetPlan`'s floor reserve, `planCostLamports` vs the send loops, the heartbeat contents, and the per‑lane notice streams all match their selftest arms. No new finding.

---

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### MEDIUM‑1 — A backlog drain is declared complete on a partial page with NO proof, on both walking scanners

**Construct:** `bank/alarm.mjs`, the per‑program walk's cursor‑advance branch:

```js
if (!unread) {
  if (gap) backlogs[id] = { head: ..., before: sigs[sigs.length - 1].signature }
  else if (sigs.length) { cursors[id] = backlog?.head ?? sigs[0].signature; delete backlogs[id] }   // ← no proof
  else if (backlog) { ...positive proof: the sig below `before` must be the cursor... }
```

and the identical shape in `bank/redemption-poster.mjs`:

```js
else if (!gap && draining && sigs.length) { st.cursor = draining.head; delete st.backlog }
```

**The defect:** `signaturesSince` returns `gap: false` whenever its last page came back partial. A partial page means *either* the walk reached `until` (the cursor) *or* the RPC's signature history ran out above the cursor. The empty‑resume case demands positive proof (`scan_backlog_unproven`, CRITICAL); the non‑empty case advances the cursor to the backlog's head on the partial page alone. If history exhausted first, every transaction between the history floor and the old cursor — part of the backlog, never fetched — is silently and permanently skipped. SPEC's scan‑backlog boundary states "A backlog is declared drained only on positive proof"; that sentence is false on one of the two drain‑completion paths.

**What an attacker or accident gains:** the skipped window loses every walk‑only detector for that program and window — `unledgered_sweep` (CRITICAL, the operator‑misuse catch), `approve` (CRITICAL), `reveal_rescheduled` / `claim_deferred_frozen` / `pool_frozen_forfeit` (HIGH, urgent), and the split/sweep chain evidence the ledger checks anchor on. Bare burns are *not* lost (they are caught by the DAS diff), which is why this is not HIGH.

**Reachability, honestly:** the drain reads the backlog newest‑first, so the oldest part — the part closest to the history floor — is read last. Triggering needs the drain to outlast the RPC's `getSignaturesForAddress` history: an attacker flooding enough signatures (at 5,000 lamports each, millions of signatures = tens of SOL), or an accidental path — a long alarm outage plus heavy genuine traffic on a short‑history endpoint. On an archive‑class RPC this may be practically unreachable; the proof obligation is nonetheless violated, and the alarm reads exactly one endpoint with no fallback.

**Evidence a test would show:** a stub cluster whose `getSignaturesForAddress` returns a partial page that stops *above* the cursor (history floor). The extracted walk (as `selftest.mjs` extracts it) advances the cursor to `head`, deletes the backlog, emits no `scan_backlog_unproven`, and the signatures between the floor and the cursor are never passed to `readParsedTransaction` — assertable directly on the `seen` set. The existing flood arms cannot catch this because their stub cluster has unbounded history.

**Fix:** on a completed non‑empty drain, apply the same adjacency proof the empty case uses — one call, `getSignaturesForAddress(prog, { before: sigs[sigs.length-1].signature, limit: 1 })` must return the cursor itself; otherwise keep the backlog and page `scan_backlog_unproven`. One extra RPC per completed drain (rare). Apply at both sites. Related doc note: SPEC says "the walk itself pages at most 20 of 1,000 signatures" — the alarm's call passes 2; only the poster uses 20.

### LOW‑1 — 500 stranger gaps evict a genuine gap from the reviewable set, silently

**Construct:** `detectLogGaps` (`bank/detectors.mjs`): `keep = [...].filter(dedupe).slice(-500)`.

**The defect:** the only record of *which* transactions to inspect is `logGaps` (the finding text is deliberately signature‑free). A stranger who buys ~500 gaps after a genuine one evicts the genuine signature from `keep`. The human then reviews what is listed, writes the watermark, and the finding clears — the genuine gap was never inspectable. SPEC's round‑31 text says a second genuine gap "is seen when the open gaps are reviewed"; eviction makes that false.

**Evidence a test would show:** `detectLogGaps(['genuine'], Array.from({length:500},(_,i)=>`s${i}`), null)` → `keep` excludes `'genuine'`; then `detectLogGaps(keep, [], <newest>)` returns no findings — the genuine gap cleared without review.

**Cost:** the CBOB event lines were already lost to truncation; what is lost is the ability to identify the transaction by hand. Detection‑evidence only. **Fix:** never evict entries newer than the reviewed watermark (cap only the reviewed prefix), or page when eviction drops an unreviewed entry.

**Routine state paged every pass:** I looked for one and found none beyond the *intended* level conditions (`swap_operator_armed`, `guardian_armed` during their notice weeks, `lock_deadline_unset` pre‑launch — all by design, each on its own suppressed stream). Quiet‑on‑dangerous: the drain hole above is the only one I found.

---

## R3 — The layouts (`bank/layout.mjs`)

Field‑for‑field comparison of all five structs against the Rust in the bundle: match. The selftest's gates are real and a struct change cannot slip: the Rust parser throws on any line it cannot read (L1), ordered field lists catch reorders, type changes are caught, every scraped `OFF_` constant is compared (L2), versions and `BOOST_RING` are scraped (L6), and `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are evaluated and held to the layout (L13c). **Round 24 D6: the SEEDS assertion now exists** — 11 of 11 seeds scraped from the declaring programs, with a mistyped‑seed arm that fails. No finding.

---

## R4 — The money arithmetic (`bank/accrual.mjs` vs MINT)

`credit`, `pendingScaled`/`owed_of`, `ceilSats`, `reweigh`, `debtAtActivation` are line‑for‑line equal to the Rust (same floor divisions, same carry‑before‑debt ordering, same `weight_of` including boost). `available` returns 0 where the program refuses `PoolShort` — documented. The crank expires every due boost before distributing (`preExpires`: `dist_epoch >= boost_end_epoch`, matching MINT's skip condition) and every boost the distribution makes due right after (`postExpires`: `boost_end_epoch === dist_epoch + 1`, only when distributing). The alarm pages `boosts_stalled` and watches `mint.cbob_mint`, `max_boost_weight`, `max_boost_epochs` as CRITICAL drift. No divergence found.

---

## R5 — The swap and the revenue cycle

**(a) Oracle math.** Exponent handling is correct for both signs (`num`/`den` scaling); `expectedSats` and `minSats` are both BigInt floors (conservative); `satsPerLamport`'s Number conversion is safe at Pyth magnitudes (prices ~1e10–1e13, far inside the safe‑integer range) and feeds only the float deviation filter, never the floor. The floor is below an honest pool's post‑fee output by construction (150 bps vs Orca's 16 bps fee plus sub‑13 bps impact for a 10 SOL swap — measured shape SW.8/SW.9).

**(b) Pyth verification.** I recomputed the `PriceUpdateV2` offsets: disc 8, authority 32, verification tag at 40 (Full = 1), feed id 41–73, price 73, conf 81, expo 89, publish_time 93 — matches `readPyth` and the fork's re‑stamping probe. Ownership (receiver program) + derived address (shard 0 under the push oracle — proven against mainnet by the fork, which clones the accounts at those derived addresses and reads real prices through them) + full verification + feed id means writing a chosen price requires the Wormhole guardian set or the receiver's upgrade key — the stated limit 10(d) trust. The age is judged against the Clock sysvar; the residual is that the Clock and the price accounts arrive through the same RPC (limit 10(b)) — but a lying RPC cannot beat the on‑chain floor, only cause failed cycles.

**(c) Deviation filter.** `orcaSpot` = (sqrt_price/2^64)² in raw B‑per‑A units = sats per lamport (A = wSOL, B = cbBTC) — correct. `meteoraSpot` = 1/(1+binStep/10⁴)^activeId — the inverse of the pair's X‑in‑Y price — correct for X = cbBTC, Y = wSOL. Float boundary error is ~1e‑16 relative; it cannot pass a pool meaningfully outside the gate.

**(d) Minimum out.** Both venues carry `guaranteed = m2.f.minSats` from the *same* m2 oracle read the deviation filter used, in each program's expected units (Orca `other_amount_threshold` = token‑B base units; Meteora `min_amount_out` = X base units). Same floor, same read.

**(e) The judge.** It is complete for its stated job. What it deliberately does not check — Orca vault/tick‑array/oracle accounts, Meteora reserves/bin‑arrays/bitmap/mints — is validated by the venue programs themselves (a tampered account fails the swap, nothing moves, the cycle stays open). ComputeBudget is confined to the single 400k CU limit with any price instruction refused; both ATA creations are pinned payer/account/owner/mint; the wrap amount, swap amount, threshold, Orca direction and price limit, output account and signer slots are all byte‑checked; Token instructions are confined to SyncNative and the one close. A tampered builder with write access to the tree bypasses it by editing the judge — that is the accepted box‑owner residue, and the post‑signing delta check (`delta < guaranteed` throws, cycle open) still catches value misrouting after signing.

**(f) Account derivation.** Orca a_to_b (selling A) pushes the tick down: `[s0, s0−span, s0−2span]` — correct, with the boundary case armed (a tick exactly on an array boundary starts that array). Meteora Y→X (buying X) moves the active bin up: `[i, i+1, i+2]` — correct. Bitmap passed as the program id when absent (Anchor None); `host_fee_in` None; event authority present. An uninitialised or wrong array is refused by the venue → next venue or a loud open cycle.

**(g) wSOL.** Wrap exactly `lamportsIn`, sync, swap, close. A pre‑existing balance or stranger dust is returned whole by the close (round 31's C01 probe measured this on pinned mainnet Token bytes); a frozen ATA fails the cycle loudly; a delegate is irrelevant (the owner signs as authority); nothing stays wrapped.

**(h) Failure and retry.** Orca first; Meteora only on a *refusal* — preflight, landed‑with‑err, or expired‑unlanded, all distinguished by `classifySendFailure` against the chain with `searchTransactionHistory`. An unconfirmed send is `unknown`: candidate signature recorded, cycle open, no second swap, no double count (the open‑cycle guard refuses the next run). Every path leaves the ledger open until a cbBTC return is on chain; the return and split use `rememberAttempt` + throw (loud, hand path) rather than auto‑retry — correct direction.

**(i) The tolerance bound.** Per cycle, the worst extraction by a sandwich or a pool pushed to the gate edge is ~150 bps of the cycle (the on‑chain floor), minus pool fees — and it is *lost to MEV, not taken by the operator*, because the return step transfers the operator ATA's entire balance. At the ruled ceiling (10 SOL per 6 h = 1,200 SOL/month of royalty flow) that is ~18 SOL‑equivalent per month at full utilization; at realistic royalty volume it is far smaller, and it is the disclosed tolerance. A stale‑but‑accepted oracle (≤180 s) can add market drift on top — SPEC states this is not a hard bound against the true market, and the holder guide repeats it. The Meteora pool (~10× thinner) at a 10 SOL swap has ~13 bps impact, inside the floor; a pool pushed ≥100 bps off the oracle is skipped at read time.

**Operator key worst case:** unchanged from limit 10's restatement — cap × cooldown windows until the guardian stops, plus detection latency (one alarm pass + the 15‑minute sweep grace) for an off‑box thief sweeping directly (`unledgered_sweep`, CRITICAL). The ledger cannot read a failed cycle as closed: `cycleIsOpen` treats a zero‑return string as open, refused rows are closed only when nothing moved, and a refused row carrying a sweep signature is itself a CRITICAL.

No new defect in the swap or revenue cycle beyond the two alarm findings above.

---

## R6 — The gates

- **Floors:** every floor is equality‑based (`-eq`, and `R.length !== FLOOR` in the selftest), so deleting assertions fails the count; deleting work *and* moving the floor in the same commit passes — inherent to self‑authored gates, noted in the final section. SPEC's stated counts (855/901/39/23/4/14/47/33) equal the runner's floors, and the selftest checks every occurrence.
- **Vacuous‑on‑empty:** the SPEC‑count gate requires >0 occurrences; the coverage gate's `--selftest` runs 8 both‑ways quorum‑headline cases and the strict mode fails until round 32 runs.
- **Weakest arm found (not vacuous):** the reveal‑skip check is a source‑order regex (`cs.indexOf("if (how === 'skip')") < cs.indexOf("const ok = await send(...")`) rather than a behavioral stub — it can fail, but only to a reorder, not to the skip logic itself being wrong.
- **`build-mainnet.sh`:** proves what it says for all five — behavioral key proof for the four initializing programs (both directions), byte‑identity of the sweep helper against its own rebuild *and* against `target/deploy` (the bytes the suite and sim deployed), exactly‑five artifact count, dirty‑tree refusal, sha256 record. Its own banner honestly states what it cannot prove (the compiled constant being Gary's key).
- **`cron-install.sh`:** arms nothing it shouldn't — the preserve reads only tagged, uncommented, job‑anchored lines (the L12 `crank` vs `crank-reveal` anchoring holds), the rehearsal marker is refused before any read, the deadman is plain shell watching the state file the alarm actually writes.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** Yes, two:
- The **scan‑backlog boundary** (rounds 30–31) states a flood *delays* detection and that a drain completes "only on positive proof." MEDIUM‑1 shows one drain path completes with no proof and can silently and permanently skip a window — delay‑with‑proof is the stated limit; silent loss without proof is what one path does.
- The **round‑31 L1 gap text** says a second genuine gap "is seen when the open gaps are reviewed." LOW‑1 shows 500 stranger gaps evict it from the reviewable set first.

**2. Is anything listed as a limit not actually a limit?** Nothing found. I specifically re‑tested the discharge claims I could measure from the bundle (item 14's `DuplicateAttribute`, item 19's construction, item 51's build, item 54's disclosed extrapolation) — all hold.

**3. Is any DISCHARGED item not actually discharged?** No. Item 54's 14‑vault CU figure remains extrapolated, but it says so.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52 and 53 are all still open and still described as blocking; `charter_opens_at` and `lock_deadline` are still OPEN in `launch/mainnet-init.json`. One status note, not a demotion: item 53's rehearsal value set and rehearsal mode in the launch checker are still unwritten, so the dress rehearsal (road step 8) cannot currently run the alarm the way item 53 requires — the blocker is live, not stale.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the dress rehearsal (item 22's five named items) and record the signatures.** No AI round executes the crank, revenue job or alarm against a live cluster at ~2,100‑vault scale; every measurement in these rounds is a local validator, a fork, or a source‑extracted stub by design. The rehearsal is the only instrument for RPC latency, rate limits, and a transient error on vault 1,900 of 2,100.
2. **Reproduce the build independently.** `build-mainnet.sh`'s own banner says it: the behavioral test proves mainnet≠test key, not that the compiled constant is Gary's wallet. Rebuild from the release commit on a second machine and toolchain and compare sha256s; have a human verify the wallet address at the `initialize` ceremony against a source that is not this repo.
3. **Put an independent eye off this box.** The alarm, the revenue ledger, the crontab, the swap‑operator key, the $CBOB release key and the audit prompts all live under one uid on one host — no in‑tree check can vouch for the tree (limit 10(3), limit 56). A read‑only watcher on a second provider and a second uid, checking the revenue PDA balance, the pool, `minted_total` and the five programs' upgrade authorities, closes the box‑owner blind spot structurally. Copy the repo and verdicts off‑box (hashed) so the certification itself is tamper‑evident.
4. **Review the dependency and toolchain supply chain.** `Cargo.lock`, `node_modules` and the pinned solana/platform‑tools versions are excluded from audit coverage by name; no round has read them. That is a human/CI task and it is unmeasured.
5. **Human‑acceptance‑test the redeem page against the client contract** (item 50): prior transaction, claim‑before‑sweep‑except‑frozen‑pool, helper sweep, packet shape, `judgeRedemptionCoverage` warning — with a real wallet, real dust, and a real stranger‑deposit race. The guide speaks of these in the present tense; only a human clicking it proves them.
6. **Run the timed hand‑recovery drill and the both‑venue live revenue cycle** (items 22(3) and 22(4)), with the signatures recorded.
7. **Staff the charter window.** Limit 46's hot key can end the project or capture governance for seven days and the alarm samples state every 30 minutes. A human watching the alarm continuously through that window is the only control that improves on the stated limit.
8. **Decide the custody rulings that are not code:** the $CBOB release wallet (limit 56 — Gary's call, stated), the operator wallet's contents (limit 10 D2), and a post‑lock incident plan (guardian stop + vote runbook, a canary or bounty) for the bug no round finds.

---

**Bottom line:** round 31's repairs are real, but the scan‑backlog proof obligation they claim is not met on one path (MEDIUM‑1), and the gap‑review list can be evicted (LOW‑1). Both are one‑call fixes with writable failing tests. Round 32 is NOT CLEAN; the counter remains 0/2.