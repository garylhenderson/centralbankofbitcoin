# Round 38 audit — off-chain pipeline, MINT, and the sweep helper

Scope read whole: the bundled `bank/`, `scripts/`, `sim/`, `tests/` gates, MINT, the sweep helper, and round 37's two verdicts. I verified round 37's repairs independently before looking for anything new; the repair verification is R0, findings follow by target. Three findings: one MEDIUM, two LOW.

---

## R0. Round 37's verdict and repairs — independently verified

**C01 (ack arms that could not fail) — REPAIR HOLDS.** The three arms now drive `unredeemable_owner` (the one ackable kind), and each is genuinely able to fail: `` `true` is not an ack `` fails if `judgeAck` accepts a bare value; `an empty reason is not an ack` fails if the `why` guard is removed; `acking one KIND does not ack another` fails if `applyAcks` looks up by asset alone (the planted `vault_burned:<asset>` ack is a valid `{why, until}` object, so an asset-only lookup would downgrade). The control arm (`R37 C01: ...and the same kind WITH a reason does ack`) proves the kind still acks. Correct.

**C02 (frozen-pool launch tick) — REPAIR PARTIALLY HOLDS; see Finding 2.** The tick branch dropped `!pool.frozen` (`bank/crank.mjs` `planCrank`, the `w === 0n && waitingThisEpoch` branch), and I verified against MINT that the premise is true: `distribute`'s `w == 0` path calls `read_token` (which does not read the state byte) and `tick` without a frozen check, and `monthly_inline` ticks before its pool-owner/frozen reads. The comment and the covered-freeze matcher were both updated to the new text, and the matcher string equals the crank's exactly. **But the joins the repair plans are not sent in that pass — Finding 2.**

**C03 (commented-out `flock -n`) — REPAIR HOLDS.** `judgeCronTemplate` computes `varHasN` from comment-stripped lines only; the selftest arms the real template with line 83 commented (refused), the synthetic case (refused), and the real template (passes).

**C04 (`--audit` counted a refused sweep) — REPAIR HOLDS.** `swept` now reads `c.sweptLamports || (c.sendRejected ? 0 : c.intendedLamports) || 0`; the selftest extracts the real expression and proves refused → 0, landed → full, open intent → intended.

**C05 (34 SOL/day) — REPAIR HOLDS (text).** SPEC limit 10 now states the 7-hour cadence and 24/7 × 10. The mechanism is source-true: the hourly job reads the chain Clock before the sweep lands, so the run 6 h later reads the cooldown seconds short.

**C07 (refuted, pinned) — HOLDS.** The selftest arm proves a `{sendRejected, sweepSig}` row pages `rejected_row_has_sweep` CRITICAL from `detectUnreconciledRevenue` in the same pass, so `detectSweepState`'s silence on it can hide nothing.

**Programs-pass V1–V3** are `web/` repairs, outside this bundle; nothing in this bundle reads the pages' behavior, so no off-chain regression can flow from them.

**Re-tested disproved claims, not re-filed:** C06 (SPEC's rescue text) and C07 hold as measured. Round 36's C08 premise is correctly withdrawn — MINT's `claim` `r.pending` branch joins and `continue`s with no transfer, and SPEC limit 28 says so.

---

## R1. The crank — Finding 2, and what I verified otherwise

### Finding 2 (LOW): the C02 repair's joins are planned but never sent under a frozen pool — and the R37 C02 arm cannot see it

**Construct.** `bank/crank.mjs` `planCrank`: `plan.joins` is populated in the `if (plan.distribute)` block, but joins reach the chain only through `plan.claims`, and the entire claims block — including `ready.push(...plan.joins)` and the chunking — is gated on `if (poolOk && !pool.frozen)`. With a frozen pool, `plan.claims` is `[]`, so the joins the repair plans are dropped. `main()` sends `plan.preJoins` (ungated) and `plan.claims` (gated); `plan.joins` has no other path.

**What an accident gains / loses.** Nothing is lost and the direction is loud: the tick lands (epoch advances), and the next full pass an hour later re-plans those vaults as `preJoins` (`request_epoch < dist_epoch`), which are sent and which MINT accepts under a frozen pool (the `r.pending` branch joins without touching the pool; `monthly_inline` is not due right after the tick). So the repair's stated behavior — "the crank now plans the free tick **and the joins after it** from a frozen pool" (VALIDATION) — is really "tick this pass, joins the next". During a multi-day freeze the first cohort's joins slip one hourly pass, not more. `joins_stalled` (6 h grace) stays quiet.

**Evidence if right.** A `planCrank` call with a frozen pool, `w = 0`, one this-epoch requester and the month due returns `{distribute: true, distributeKind: 'tick', joins: [[rec, ata]], claims: []}` — joins populated, claims empty. The selftest arm `R37 C02` asserts `p.joins.length === 1` and never reads `p.claims`, so it passes while the joins have no carrier. On chain: freeze the pool on a validator, run one full pass — the tick lands and no join is sent; the next pass sends it as a preJoin.

**Fix.** Send `plan.joins` as their own join-only batches (the same shape as the `preJoins` loop) whenever the pool is frozen — they do not touch the pool — or extend the R37 C02 arm to assert the joins are inside a sent batch (`p.claims.flat()`), which turns the current code red. Note a `bank/` commit resets the freeze counter; that is the process, not a reason to leave it.

**Verified otherwise (R1):** the plan order (reschedule → capture → reveal → retire → preJoin → preExpire → split → distribute → postExpire → activate → claims) matches MINT's gates (`JoinWaitingFirst`, `BoostsExpireFirst`, the tick's `NoActiveVaults`); reveal is strictly FIFO from `revealed_total` and stops at the first unready head; `judgeDistributeRefusal` re-reads the config and treats `PoolShort` as always-fault; `budgetPlan` keeps the floor in reserve on every branch; no instruction the crank builds can move value anywhere the program does not pin (fee payer only; the selftest's instruction-name and no-transfer gates confirm). One noted observation, not filed: a tick refused `NoActiveVaults` (the sole this-epoch requester redeemed between plan and send) is not in `BENIGN` or `DISTRIBUTE_RACE`, so it pages as a crank failure — a rare race, loud direction, one fee.

---

## The transaction-history path — Finding 1 (the poster)

### Finding 1 (MEDIUM): one redemption of a not-yet-revealed vault wedges the redemption poster permanently; every later redemption is never drafted

**Construct.** `bank/redemption-poster.mjs` `main()`: the walk loop has no per-event `try`. For each `REDEEMED` event it reads the vault's `VaultRecord` and calls `draftPost`, which throws on `level < 1` — and a vault redeemed before its reveal has `level === 0` forever. The throw propagates out of the event loop, out of the signature loop, out of `main()`; the cursor update (`st.cursor = s.signature`) sits *after* the event loop, and `writeLedger` is never reached. Next run re-walks from the same cursor, hits the same transaction, throws again. Permanent.

**Reachability, checked against the programs, not assumed.** A redemption needs no level: SEAL's `open_for_redemption` checks the owner and the pairing only; the sweep helper reads no record; BURN's `burn_vault` checks the pairing, the cap and emptiness; MINT's `retire_redeemed` → `retire` touches `r.active`/`r.pending` only. So a vault redeemed within its ~2-minute mint-to-reveal window produces a `CBOB_REDEEMED` event and a level-0 record. That is a cheap, deliberate action: a thief spending the hour's 2.1% budget can mint-and-immediately-redeem one vault first and the public-post pipeline never drafts the rest.

**What an attacker gains.** Suppression of the public redemption record — the "every opening is announced on X and the CBOB website" promise (item 50) and the read-aloud half of the leaked-key defense — for the price of one mint plus one redemption. The failure is silent in practice: the poster is PROCEDURE, has no cron, no deadman, and no sender yet, so "CBOB REDEMPTION POSTER FAILED: level 0 is not I..V" prints only when someone runs it by hand. The alarm's own redemption detection (`detectVaultSetChange` / `correlateBurns`) is unaffected — this is the public surface, not the pager.

**Evidence if right.** (a) The selftest itself pins the throw: `t('an undrawn level is refused, not posted as Level undefined', …)` proves `draftPost({level: 0})` throws — the refusal is deliberate, but nothing tests the *walk* surviving it. (b) Reading `main()` shows no `try` around either loop and the cursor write after the event loop. (c) On a validator: mint, redeem before reveal, run the poster — exit 3, no draft, and re-runs wedge on the same signature. A gate: drive the extracted `postRun` fragment (the selftest already extracts it for the truncated-log cases) with a synthetic BURN transaction whose `REDEEMED` names a level-0 record; today it throws and the cursor holds; after the fix it queues REJECTED and advances.

**Fix.** Wrap the per-event draft in `try`/`catch` and, on a throw, queue a `status: 'rejected'` hand-draft entry (the exact pattern the truncated-logs path already uses) and advance the cursor — or have `draftPost` render "level not yet drawn" for level 0. The deliberate refusal the selftest pins is about *posting* an undrawn level, not about *dying* on one.

**Severity note.** LOW is defensible — the poster has no sender today, so nothing is currently published to suppress. I grade MEDIUM because item 50 is OPEN AND BLOCKING (this pipeline ships before launch), the trigger is reachable and cheap, the wedge is permanent and silent until run by hand, and it is precisely the surface a mass-redemption attacker wants dark. It is off-chain, so the fix does not touch the immutable programs.

---

## R2. The alarm — Finding 3, and what I verified otherwise

### Finding 3 (LOW): the reconcile lane — the only control for undeclared PDA token accounts until item 50 ships — has no liveness watch, and its death reads as quiet

**Construct.** `bank/alarm.mjs` writes `RECONCILE_STATE` (`${STATE_FILE}.reconcile`) with an `at` timestamp in `reconcile()`; nothing in the 30-minute `main()` ever reads it. `scripts/cron-install.sh` installs the reconcile line (daily, 04:19) and a deadman that watches only the *main* watcher's `state.json`. Remove or comment the reconcile line, or let it wedge, and nothing pages — ever.

**Why I file this despite round 37's C09 disposition.** C09 recorded the mechanism and dispositioned it "not a defect" because "no text claims the lane is watched". That is true of SPEC's words and beside the project's own rule: the deadman exists because "the watcher cannot report its own death", and the reconcile *is* a watcher. More to the point, the disposition under-weights what the lane carries: until item 50's redeem page is published, `--reconcile` is the *only* control for the undeclared-token-account class whose contents are destroyed on redemption (accepted limit 44), because no signature scan can see such an account being created (the alarm's own header says so). A silent dead reconcile plus an unpublished redeem page is zero coverage for a destroy-holder-property class, not a monitoring nicety. This is a disagreement with a not-a-defect disposition on an unrepaired gap, with a reason the verdict's row did not state — not a re-file.

**Evidence if right.** `grep -n RECONCILE_STATE bank/alarm.mjs` shows writes and no read of `at`; the deadman line in `cron-install.sh` references only `$ALARM_STATE`; commenting the reconcile line changes no detector output (run the alarm; no finding).

**Fix.** C09's own recommendation: a `reconcile_stale` HIGH read from `RECONCILE_STATE.at` in the 30-minute pass (grace ~26 h), classified in `ALARM_KINDS` as a level kind.

**Verified otherwise (R2):** all five programs' upgrade authority and bytes are watched (sweep included, `prog.sweep.*`); the production value list asserts Gary's numbers exactly (21%/51%/3-day, 7-day notice, the three tighten bounds, 30-day month, 1-hour window, the census, the PoB root and collection, the $CBOB mint and boost ceilings); `detectSweepState`'s symmetric half-cooldown window with the direct-status `landed` set and the smallest-seen cooldown is sound against the key-thief ordering (a thief's sweep sits a full cooldown after the honest one, outside the window); the truncation-gap level condition can neither be evicted unreviewed nor buy new emails; the backlog drain requires positive proof before a cursor advances; `detectMissingComponents` covers `prog.sweep` past the lock. The dangerous-quiet states I went looking for are the ones already written down (foreign nested assets, per-asset PoB plugins, the $CBOB release wallet, operator-wallet hygiene) — plus Finding 3.

---

## R3. The layouts — verified

`STRUCTS` are asserted field-for-field against `parseRustStruct` of the Rust (strict: an unreadable line throws), every scraped `OFF_*` constant in all four programs is compared against the computed offsets with a none-scraped-and-ignored arm, the layout versions and `BOOST_RING` are scraped and compared, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated and held to the layout minus padding, and the suite's own `OFF_` copies are compared. Round 24's D6 hole is closed: eleven seeds are scraped from the declaring program and compared, with both-ways arms (a mistyped seed and an unmapped one are caught). The one asymmetry — `RESCUE_SEED` is not in `L.SEEDS`, so no reverse arm exists — was adjudicated in rounds 36/37 (C14/C15): no `bank/` code derives the rescue PDA, the suite's R35 tests pin the seed against the program, and the program is frozen at launch. I re-checked that no bundled file derives it; agreed, not a defect. A struct change cannot slip past these gates without turning the build red.

---

## R4. The money arithmetic — verified equal

`bank/accrual.mjs` matches MINT line for line: `credit` (`delta = avail * 1e12 / w`, `owed += delta * w`), `pendingScaled` = `owed_of` (`(weight + boost) * acc + carry - debt`, negative refused both sides), `reweigh` (carry the owed, restart debt at the new weight), `ceilSats` = `ceil_sats`, `debtAtActivation` = `join`'s `w * acc`. The one divergence is deliberate and documented: `available` floors at 0 where the program refuses `PoolShort`, and the alarm's `pool_insolvent` is what pages the shortfall. The crank's boost handling is exact: pre-expires every boost due at the current epoch before distributing, post-expires every boost its own distribution makes due (`boost_end_epoch === dist_epoch + 1`), skips retiring records both times (the retire unschedules), and its owed math for a pre-expired vault (`atExpiry + weight * (acc_new - acc_old)`) equals the program's expire-then-claim to the scaled unit — expiry is value-neutral. The alarm pages `boosts_stalled` and watches `cbob_mint`, `max_boost_weight`, `max_boost_epochs` as fixed-forever CRITICAL. No divergence found.

---

## R5. The swap and the revenue cycle — prove or break, point by point

**(a) Oracle math — holds.** `oracleFloor`: `e = sol.expo − btc.expo`; `num = lamports × sol.price`, `den = btc.price × 10`, scaled by `10^e` on the correct side for either sign; `sats = lamports × SOL/USD / BTC/USD / 10` is dimensionally right (lamports/1e9 × ratio × 1e8). Integer division floors both `expectedSats` and `minSats` (conservative direction). BigInt throughout; the only float is `satsPerLamport`, used solely by the 100 bps gate, where its ~1e-16 relative error is twelve orders of magnitude below the threshold. The selftest's within-a-sat float check confirms.

**(b) Pyth verification — holds, with the accepted residual.** The account is the derived sponsored-feed PDA (shard 0, push-oracle program), must be *owned* by the receiver program, must be Full-verified (tag 1; Partial refused), must carry the expected feed id; staleness 180 s and confidence 30 bps against the *chain* Clock (owner-checked sysvar), future-dating beyond 30 s refused. Ownership plus derivation is sufficient: only the receiver program can write the account, a Full update requires Wormhole VAA verification, and `publish_time` rides inside the signed message, so no one can write a chosen price or a chosen old time into it; a genuinely stale price is bounded by the age check. The clock it is judged against is the chain's, not the box's. Residual is Pyth's own integrity — accepted limit 10(a).

**(c) Deviation filter — holds.** `orcaSpot = (sqrt_price / 2^64)²` is sats per lamport in raw base units (wSOL 9 decimals, cbBTC 8 — the raw ratio *is* sats/lamport), correct direction. `meteoraSpot = 1 / (1 + bin_step/10⁴)^active_id` is the inverse of lamports-per-sat (X = cbBTC, Y = wSOL), correctly reversed from Orca. Float cannot pass a pool it should refuse: the gate is 100 bps, the float error ~1e-12.

**(d) Minimum out — holds.** Both venues carry the *same* floor: `minSats = expectedSats × 9850/10000`, at data offset 16 in both (`other_amount_threshold` / `min_amount_out`), in cbBTC sats — the same quantity and units the deviation filter compared against the oracle.

**(e) The judge — complete for what it can see.** It requires the exact seven-instruction sequence: CU limit 400,000 and no CU price anywhere (and `ixs.length === 7` leaves no room for a second budget instruction); both ATA creations with exact payer/account/owner/mint keys; the wrap of exactly `lamportsIn` into the operator's own wSOL ATA; SyncNative of it; the swap naming the pinned pool, with the operator's wSOL in (key 3 Orca / key 4 Meteora), the operator's cbBTC out (key 5 both), amount at offset 8, floor at offset 16, and Orca's exact-input/a_to_b/min-sqrt-price bytes; one close of the wSOL account back to the operator, last. Output account, min-out bytes, direction, amount, fee-draining budgets, and ATA identities are all checked. What a tampered builder can still route past it: only accounts the venue program itself rejects on chain (wrong tick/bin arrays, wrong vaults — pool-owned and validated), or a same-tree edit, which is the accepted box-owner residue (limit 10(c)). The post-signing backstop is real: `revenue.mjs` throws when the operator's cbBTC delta is below `guaranteed`, leaving the cycle open and loud.

**(f) Account derivation — holds.** Orca: tick arrays `[s0, s0−span, s0−2span]` for a_to_b (price moves down), `floor` matching `div_euclid` for negatives, the boundary case starting the boundary array; oracle PDA; vaults read from the pool. Meteora: bin arrays `[i, i+1, i+2]` for Y→X (active bin moves up), bitmap extension present-or-program-id, `host_fee_in` as None, event authority, both token programs. The offsets (Whirlpool 41/45/49/65/81/101/133/181/213; LbPair 76/80/82/88/120/152/184) recompute correctly against the published layouts, and the fork proves them against the real accounts. At a tick-array boundary or an uninitialized array the swap reverts on chain, is classified `refused`, and the fallback runs — loud, never a wrong-price fill.

**(g) wSOL handling — holds.** Wrap exactly `lamportsIn`, sync, exact-input swap, close back. A pre-existing balance (or a stranger's, or a delegate's) cannot be lost: exact-input consumes exactly `lamportsIn`, and the close returns everything left to the operator; a delegate cannot act inside the atomic transaction and is cleared by the close; a frozen wSOL ATA reverts the swap's transfer-out, reverting the whole transaction (refused, loud); an ATA created by someone else still has the operator as owner.

**(h) Failure and retry — holds.** Meteora runs only on a *proven* Orca refusal — preflight refusal, landed-with-`err`, or expired-never-landed, each read off the chain by `classifySendFailure`'s direct status lookup — never on an unconfirmed send (`unknown` records `pendingSwapSig` and throws). A confirmation timeout on a swap that later lands cannot produce a second swap: the cycle stays open, the open-cycle guard refuses the next run, and hand recovery is the only path. Every path leaves the ledger open until a cbBTC return is proven on chain — `cycleIsOpen` requires `returnedSats > 0` *and* a split, and the split side is anchored to chain evidence (`closesCycle`, chain-time anchored, at-least-as-large, consumed once).

**(i) What an adversary can extract — bounded, and the bound is small.** The on-chain floor caps extraction at 150 bps of the cycle per cycle; anything worse reverts and costs nothing. A pool at the 100 bps gate edge plus a 180 s-stale oracle costs at most ~250 bps of a ≤10 SOL cycle (~0.25 SOL), and only when the oracle is *also* wrong in the adversary's favor; Meteora's thinness makes reverts likelier, not losses larger. At the corrected cadence (~34 SOL/day), even an every-cycle-sandwiched-to-the-floor month is ~5 SOL, and the deviation gate plus revert-on-breach make that unprofitable to attempt. Not material at the ruled cycle size; correctly characterized as the price of an off-chain swap.

**Operator-key worst case, re-bounded (limit 10):** what the key trusts is now two pool programs and the oracle, not an HTTP reply — and because the output floor is enforced on chain, a thief cannot steal *through* the swap via price; they can only keep swept SOL outright, which `unreconciled_swap` and the state-derived `sweep_unledgered_state` page regardless of scan floods. The bound stands: cap × cooldown windows until the guardian stops it, never more than the revenue PDA holds above the reserve. The ledger still cannot read a failed cycle as closed.

---

## R6. The gates — verified, with Finding 2's arm as the exception

Every floor must EQUAL its count (detector 925, allocation 39, poster 24, PoB 14, launch 49, host 6, mainnet 33, on-chain 895, expiry 4, swap 16), and SPEC's stated counts are checked at *every* occurrence. `floor()` dies on an unreadable count, a partial pass, or a mismatch. `sub_selftest` prints captured output on failure. The mainnet probe and the swap fork skip loudly and are refused under `CBOB_SHIP_GATE=1`. The control-table gate is mechanical in all three columns; the signer-set gate pins exactly two signers and catches a third or a revived retired key; the wiring gate derives the detector list and proves each call's *result* is consumed; the L7 id gate covers all fourteen id copies plus the five deploy keypairs and the unnamed-prefix shape, with a one-character mutation in any copy turning it red. `build-mainnet.sh` proves the four keyed programs' key behavior on both builds and the sweep helper's byte-identity across `dist/`, the localnet build, and `target/deploy/` — and says honestly what it does not prove (that the compiled constant *is* Gary's key; the bridge is reproducibility). `cron-install.sh` arms `--live` only from its own tagged, uncommented lines, and the C03 repair makes the `flock -n` check comment-aware. The one arm I found that does not measure what it claims is Finding 2's: `R37 C02` asserts `plan.joins` (planned) where the sent carrier is `plan.claims`.

---

## The accepted limits — the four questions

1. **Is any limit worse than stated?** None found. Limit 10's throughput is now stated correctly (34 SOL/day, C05). Limit 28's frozen-pool text remains true after C02 (the in-line run still never *credits* from a frozen pool; the tick moves nothing). Limits 25/26 (the draw), 32 (the ring-capped window), 44, 55 and 56 read true against the current code.
2. **Anything listed as a limit that is not one, or already closed?** No. Limits 6, 7, 8 remain true as stated; 7's mitigations (`crank_silent`, `royalties_unswept`, per-lane streams) exist as described.
3. **Any DISCHARGED item not actually discharged?** No. 51 (the boost) is built, mirrored and gated; 54 and 12/17 are measured; 14, 19, 30, 31, 33 have live suite arms.
4. **Any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain marked OPEN AND BLOCKING; the road table shows step 8 not started, step 9 in progress (ids claimed, placeholder), 10/11 not started; the holder guide is still marked DRAFT; item 53's stale proof is still flagged as requiring re-run at the release commit.

---

## Given that no human firm will ever see this and the programs will be immutable — what AI audit structurally cannot do

1. **Run the dress rehearsal with real money (item 22), because it is a measurement, not a reading.** The crank's live passes at ~2,100-vault scale (RPC rate limits, a transient error on vault 1,900, the every-minute lane keeping up), one full revenue cycle through *each* pool with Orca forced to refuse once, and one forced post-sweep failure walked through the hand-recovery runbook until `--audit` is clean. Every gate here is static; none of it executes a live cluster under load or watches a human recover a wedged cycle. This is the single largest unmeasured surface, and it is already OPEN AND BLOCKING — do not let the clean-round counter substitute for it.
2. **A human reads the four `initialize` transactions against `launch/mainnet-init.json` before signing (item 38).** The checker validates the JSON, not the signed bytes; only a person can confirm the transaction about to be signed was built *from* that file. Wrong values are permanent.
3. **Key custody, verified by possession, not by reading.** The deploy authority, the guardian wallet, the swap operator key, the $CBOB release wallet, and the Giraffish Moments hot wallet: no audit of this tree can establish who holds them, whether backups exist and restore, or whether the custody matches the claims. The release-wallet and PoB-window exposures (limits 56, 46) are custody facts.
4. **An alert-delivery drill.** The alarm's CRITICALs travel a router to email/SMS. Nothing here proves a person receives one at 03:00 and acts — pull the brake in rehearsal and measure the time to a human response, because several accepted limits (10, 47) are bounded by exactly that time.
5. **The reproducible-build bridge, done by a second party on a second machine.** `build-mainnet.sh` states it cannot prove the compiled `INIT_AUTHORITY` is Gary's key; only an independent rebuild from the release commit matching the five sha256s closes it. Doing it on the same box proves less.
6. **Live third-party behavior.** Whether DAS sets `burnt` on a burned Core asset (item 22.5), and the RPC provider's behavior under adversarial load, are live reads no static pass can settle.
7. **A human adversary's judgment on the ruled economics.** The governance concentration (top-three PoB holders carrying a key change if 58 of 240 go unclaimed) and the boost game theory are checked as *rules* here; whether the ruled numbers are wise is not something this process can answer, and immutability makes the answer permanent.