# Round 32, OFF-CHAIN pass: audit report

Scope: the whole current tree as bundled, with round 31's verdict treated as evidence to verify, not authority. I could not execute the suite in this seat; everything below is recomputation and source reading, and each finding states the evidence that would exist if it is true.

---

## R0. Round 31's verdict and its repairs

**The verdict's four confirmed findings are real, and the repairs are present and correct at their sites.**

**L1 (stranger-bought urgent `log_coverage_gap`) — repair holds.** `detectLogGaps` (detectors.mjs) is now a level condition: one signature-free, count-free finding that stands while any kept gap is newer than the reviewed-through watermark in `bank/log-gaps-reviewed`, clears only when a person writes that watermark, and reopens on a newer gap. `ALARM_KINDS.log_coverage_gap = 'level'`, so the router holds the unchanged text instead of emailing per fee. The watermark-not-found case fails loud (`at = -1` → all kept gaps unreviewed). The 500-entry cap rolling past the watermark also fails loud (everything becomes unreviewed again). The selftest arm (R31 L1) covers stand/clear/reopen/lost-watermark both ways. The residual cost — a second genuine gap while the stream is open adds to `logGaps` without a new email — is stated verbatim in SPEC's reader coverage boundary. One integration detail I verified specifically: in the not-delivered branch of `alarm.mjs main()`, `next.logGaps` is deliberately *not* reset to `prev`, which is correct for a level condition (it re-asserts from persisted state next pass), while cursors *are* held, so re-scanned truncated transactions re-enter `looked.logGaps` and are deduped by signature. Consistent.

**L2 (flood delays every page) — repair holds, with one disclosed partiality.** `PER_PROGRAM_READS = 2000` per program per pass, the over-budget remainder becomes the same resumable backlog as a gap, and the drain requires positive proof (the cursor as the very next signature, or a resolvable resume point with nothing below it) before it is declared drained, else `scan_backlog_unproven` CRITICAL. The selftest's R30 M1/R31 L2 arms drive a 25,000-transaction flood through the real `signaturesSince` and the extracted walk at budgets 20,000/2,000/1,500, including the walk that ends naturally between the budget and two pages. **What the repair did not do:** the verdict's first suggested repair ("report the pre-walk findings before walking") was not taken; state-derived CRITICALs still wait for the walk. The repair instead bounds the walk (≤8,000 reads/pass) and SPEC's scan backlog boundary now states the residual delay (16–52 minutes) explicitly, including that account-state findings are delayed. That is a disclosed bound, not a silent gap — but it is a *smaller* repair than the verdict recommended, and I am recording that the recommendation's first half was declined in favour of the bound.

**D1 (SPEC item 38 overstated the alarm's value coverage) — repair holds.** SPEC now says the guardian, swap operator, sweep cap, cooldown and SOL reserve are not on the production list, that the pre-signing checker is the only gate for their exact values, and that later changes page as `config_drift`. All five are in `WATCH` (verified). `check-launch-params.mjs` pins all five.

**D2 (poster said "Nothing was held" for a SOL-only redemption) — repair holds.** `releasedFromTx` counts System transfers whose source is the vault PDA (the sweep helper's lamport move), `ASSETS` names SOL at 9 decimals, and the selftest arm proves SOL-out counted and SOL-in not. The R27 reader-integration arm's pinned amounts were correctly moved by the 1,000-lamport fixture transfer.

**The verdict's dispositions I spot-checked hold:** C01 (wSOL dust survives `CloseAccount` — native accounts close with balance; the judge's close is on the wSOL account and the fork proves the shape), C02 (v1 has no lookup tables; the reader's refusal is the disclosed malformed-response boundary), C04 (`minted_total` at 141 and `bare_burns_retired` at 454 — I recomputed both from the field list and they match the Rust constants the selftest scrapes).

**Round 30/29 repairs re-verified at their sites:** the backlog drain with positive proof, the crank's floor-reserving `budgetPlan` (`room = lamports − planCost(base) − floor`, base runs whenever covered), `MIN_SWEEP_LAMPORTS` dust skip wired through `SW.sweepAmount` in revenue.mjs, the flagged-truncation path with the `OURS`-ran gate, and the coverage gate's exact-headline quorum check (its 8 both-ways cases run inside the detector selftest, which is itself floored).

---

## R1. The crank

I recomputed the planner against MINT's handlers gate by gate: join-before-distribute (`JoinWaitingFirst`), expire-before-distribute (`BoostsExpireFirst`) and expire-after for boosts the pass's own distribution makes due (`boost_end_epoch === dist_epoch + 1`, ticks included), the post-state weight (`total_active_weight + preJoinWeight − retiringWeight − expiringWeight`), the retirement freeing `owed_scaled` before the distribution, the tick condition net of this-pass retirements of this-epoch requesters, and the owed arithmetic for plain / pre-joined / pre-expired / boosted vaults. All match the Rust (`credit`, `join`, `retire`, `expire_boost`, `reweigh`, `owed_of`, `monthly_inline`, `tick`). The instruction account orders and writability match the `#[derive(Accounts)]` structs (I checked each: reveal, claim, expire_boosts, split_revenue, distribute, activate, retire_burned, capture, reschedule). The key signs only as fee payer; the selftest pins the instruction set and the no-transfer rule.

**No plan that pays or joins a dead vault** (burned → retired, never joined/paid; unreadable → skipped with a problem, and an unreadable eligible vault suppresses the distribution, matching `JoinWaitingFirst`). **No out-of-order reveal** (strict from `revealed_total`, break at first not-ready; the attribute hash is checked before a fee is spent, with the three-way read/empty/skip source rule).

Two observations, neither filed as findings above LOW:

- **`NotALiveVault` on `activate` is not benign.** A vault redeemed (or bare-burned) in the seconds between the crank's read and its activate send fails `require_live_vault` and pages "action failed"; the next pass retires it. This is a genuine race, not a plan bug, and it is the same class rounds 22–24 made benign elsewhere. Rare (redemption inside a seconds-wide window) and loud-by-choice is defensible — but see LOW-2.
- The reveal lane's `break` on an unreadable (`'other'`) asset stops the reveal run with only a console log; `reveal_queue_stalled` is the page that catches a persistent case. Covered, 30–60 minutes late by design.

---

## R2. The alarm

I checked the detectors for a dangerous state read as quiet and a routine state paged every pass. The fixed-forever watch list, the production value list (reconciled against `launch/mainnet-init.json` entry by entry — all 20 match), the five-program upgrade-authority watch past the earlier of `lock_deadline` and `charter_opens_at`, the PoB collection plugin/authority watch, the pool solvency/freeze reads, the redemption-window capacity mirror of BURN's ring arithmetic, the ledger-vs-chain sweep/split anchoring (`closesCycle` with the return's block time, amount and exclusion rules), the crank posture/health/silence chain, and the per-kind notify plan with the router measured in both directions — all read as intended, and the stated blind spots (foreign nested assets, per-asset PoB plugins, 30-minute sampling) are the accepted ones.

### LOW-1: a window of exactly N×1000 new signatures pages a false `scan_gap` and starts a pointless backlog

**Construct:** `bank/sigwalk.mjs signaturesSince` returns `gap: true` whenever all `maxPages` pages come back full; `bank/alarm.mjs` computes `gap = walked.gap || walked.sigs.length > PER_PROGRAM_READS`. With the default budget (2,000, so `maxPages = 2`), a window of **exactly 2,000** new transactions returns two full pages and `gap: true` — yet every transaction was read.

**What it gains an accident:** one spurious HIGH `scan_gap` ("more transactions than one pass reads") plus a backlog entry. The next pass's resumed walk comes back empty, the positive proof (`below[0] === cursor`) succeeds, the cursor jumps to the backlog head and the backlog clears. Self-healing, nothing skipped, one false page.

**Evidence if true:** stub `getSignaturesForAddress` to return exactly 2,000 signatures newer than the cursor; the pass emits `scan_gap` and writes `backlogs[id]` despite complete coverage; the next pass drains it without reading anything new. The same boundary exists in the poster at exactly 20,000 (`maxPages = 20`). The fix is one extra confirming fetch when the last page is exactly full (or treating `sigs.length < maxPages * limit` as no-gap), plus a both-ways arm at exactly the multiple.

**Why only LOW:** the condition requires an exact multiple of 1,000 inside one 30-minute window on one program; the backlog machinery recovers cleanly and provably; nothing is ever skipped or misread.

### LOW-2: `activate` on a just-redeemed vault pages a false failure

**Construct:** `bank/crank.mjs` `BENIGN` does not include `NotALiveVault`. The crank activates only vaults that read live at plan time, and retires known burns first, so the only way `activate` raises `NotALiveVault` is a redemption or bare burn landing between the plan read and the send.

**What an accident gains:** one paged "action failed" on the lane's stream per occurrence; the vault is retired next pass and nothing else is affected. **Evidence if true:** plan with `assets[asset] = 'live'`, burn the asset, send the activate; `mintFailureCode` returns `NotALiveVault`, `BENIGN.test` fails, `failures.push('activate …')` fires. **Fix:** add `NotALiveVault` to `BENIGN` for the activate send only (it remains a real fault everywhere else), or leave it and accept the rare false page — but choose deliberately, because this project's stated rule is that a detector that cries wolf gets scrolled past.

---

## R3. The layouts

The assertions are real, not decorative. `parseRustStruct` is strict (an unreadable line throws), the field lists are compared name-and-type against the four Rust sources, every scraped `OFF_*` constant from GOV/BURN/MINT is compared against the computed offsets with a nothing-scraped-ignored check, the suite's own `OFF_` copies in `tests/3prog.test.ts` are compared, the layout versions and `BOOST_RING` are scraped from the Rust, and `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated and held to the layout's fixed lengths. **Round 24 D6 is closed:** the `judgeSeeds` arm scrapes all eleven `*_SEED` constants from the four programs and compares them to `SEEDS`, with both-ways arms (a mistyped seed and an unmapped one are each caught). A struct edit that is not mirrored here turns the build red in at least three independent arms.

---

## R4. The money arithmetic

`bank/accrual.mjs` equals the program, line for line: `credit` (`delta = avail × 1e12 / w`, `owed += delta × w`), `pendingScaled` (`(weight + boost) × acc + carry − debt`, refusing negative), `reweigh` (owed → carry, debt restarts at new weight), `ceilSats`, `available` (floor-0 mirror of the program's `PoolShort` refusal, with the divergence — mirror floors, program refuses — correctly handled by the alarm reporting insolvency separately). The crank expires every due boost before distributing and every boost its own distribution makes due right after; the alarm pages `boosts_stalled` and watches `cbob_mint`, `max_boost_weight` and `max_boost_epochs` as fixed-forever CRITICAL drift. The host unit test drives the boost ring through 260 epochs against a model rebuilt from the records. No divergence found.

---

## R5. The swap and the revenue cycle

**(a) Oracle math.** `oracleFloor`: sats = lamports × sol.price × 10^(es−eb) / (btc.price × 10), with the exponent folded into numerator or denominator by sign — correct for every sign combination, and the units check out (lamports/1e9 SOL × SOL/USD ÷ BTC/USD × 1e8 sats/BTC). Both divisions floor (conservative). BigInt throughout for the floor; `satsPerLamport` is float but feeds only the 100 bps deviation gate, where double precision is noise. Prices ~1e10–1e13 are exact integers in doubles.

**(b) Pyth verification.** The account is a derived sponsored-feed PDA (shard 0, push-oracle program), must be owned by the receiver, fully verified, and carry the expected feed id; the fork test clones the real accounts so the derivation is measured, not reasoned. Ownership plus derivation is sufficient against a forged account (only the receiver can write it); a fully-verified update with an old `publish_time` is refused by the 180 s age check, and a future-dated one by the 30 s future check, both against the **chain** Clock (owner-checked sysvar), never the box. A chosen price requires forging a Wormhole attestation — that is Pyth's trust model and is accepted limit 10(a), stated.

**(c) Deviation filter.** `orcaSpot` = (sqrt_price/2⁶⁴)² in raw units = sats per lamport for wSOL→cbBTC (A→B); `meteoraSpot` = 1/(1+bin_step/10⁴)^activeId, the inverse of lamports-per-sat for the reversed pair. Directions verified against the decimal structure (9 vs 8). The fork proves both pools inside the gate and a floor 5% above the oracle refused by each real program.

**(d) Minimum out.** Same `minSats` (oracle − 150 bps, floored) rides Orca's `other_amount_threshold` (offset 16, exact-input a_to_b, min sqrt-price limit) and Meteora's `min_amount_out` (offset 16). Units match (cbBTC sats). The judge pins the bytes.

**(e) The judge.** It requires the exact seven-instruction sequence and independently checks every value-moving role: CU limit 400,000 and no CU price anywhere; both ATA creates for the operator's own wallet and mint; one System transfer of exactly `lamportsIn` to the operator's own wSOL ATA; SyncNative on it; the swap naming the pinned pool with the operator's wSOL in (key 3 / key 4), the operator's cbBTC out (key 5 both), amount, floor, and Orca's direction/limit bytes; one close back to the operator; no other Token instruction; no second signer; no foreign program. What a tampered builder can still route past it: wrong tick/bin arrays, vaults, oracle or event authority — all of which the **pool programs** validate against the pool's stored accounts, so they fail on chain (loud, cycle open), never misroute. The output account and floor — the two things that would steal — are pinned by the judge. The box-owner residue (a tampered judge) is accepted limit 10, stated.

**(f) Derivations.** Orca tick arrays (current then two below for a_to_b), the oracle PDA, vaults read from the pool; Meteora bin arrays (active then two above for Y→X), bitmap present-or-program-id, `host_fee_in` as None, event authority, two token programs — all proven against the real programs on the fork, which is the only way hand-built CPIs get proven. A tick-array boundary or uninitialised array fails on chain (loud).

**(g) wSOL.** Wrap exactly `lamportsIn`, sync, exact-input swap, close. A pre-existing wSOL balance survives the swap (exact input) and returns at close; round 31's C01 measured the dust case landing. A frozen cbBTC destination fails the swap on chain → refused → fallback → open loud cycle (limit 28 class).

**(h) Failure and retry.** `classifySendFailure` asks the chain: preflight refusal, landed-and-failed, and expired-and-never-landed are all `refused` (Meteora may be tried / the sweep row closes as `sendRejected` with `refusedSig`, never `sweepSig`); landed-and-succeeded is recorded; anything unsettled stays open and no second venue or sweep is attempted. A confirmation timeout on a swap that later lands is recorded as landed, not retried. The ledger cannot read a failed cycle as closed (`cycleIsOpen` requires a proven return *and* split; a refused row carrying a sweep is itself CRITICAL).

**(i) Adversary bound.** The on-chain floor caps execution loss at 150 bps of the oracle-expected output regardless of pool manipulation (worse → revert, nothing moves). Per cycle at the 10 SOL cap that is ≈0.15 SOL; at the ruled 6 h cooldown, ≈0.6 SOL/day theoretical maximum for a perfect sandwicher — against royalty throughput only, and the stale-oracle direction that would matter (oracle low) is bounded by the 180 s age plus 30 bps confidence, both stated as not a hard bound. The operator key's worst case is unchanged and correctly stated: cap × cooldown windows until the guardian stops, never a vault, the pool or sale cbBTC; what it trusts is now the two pool programs, the oracle, the one RPC endpoint and the box — all four listed in limit 10. Nothing here is worse than stated.

---

## R6. The gates

Every floor I checked must **equal** its count (suite 855, detector 901, allocation 39, poster 23, PoB 14, launch 47, host 6, mainnet 33, expiry 4, swap-fork 16), the selftest's own `FLOOR = 901` is asserted equal to `DET_FLOOR`, and SPEC's stated counts are checked at every occurrence with a non-empty requirement. The detector-wiring gate is derived from the detector exports and proven to catch a deleted call, a commented call and a discarded result. The router arms run the real router. The coverage gate's quorum check is the exact anchored headline with its 8 both-ways cases. `build-mainnet.sh` proves the four programs' key behaviour and the sweep helper's byte identity across `dist/`, the localnet release output and `target/deploy/`. `cron-install.sh` arms `--live` only from our own tagged, uncommented, end-anchored lines, with the reveal-lane flag-order arms. I found no assertion that cannot fail, no floor satisfiable by deleting work, and no vacuously passing check. The round-31 arms are armed in both directions.

---

## The accepted limits, four questions

1. **Is any limit worse than stated?** None found. I specifically re-bounded limit 10 (the floor really is enforced on chain; the trust list is complete), limit 25/26 (the re-roll and leader-grinding costs match their measurements), limit 28 (the freeze consequences match the code paths), and limit 32 (the alarm's capacity mirror matches BURN's ring arithmetic as described).
2. **Is anything listed as a limit not actually one, or already closed?** No. Limit 27's program-side gap (claim does not check liveness) is real and only crank-mitigated, as stated.
3. **Is any discharged item not discharged?** No. Item 51's boost machinery mirrors the Rust exactly (checked `reweigh`/`expire_boost`/`join`/`advance_epoch` against the crank's pre/post expiry and the alarm's stall detector); 54, 12/17, 14, 19, 30, 31, 33 remain measured or gone.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52 and 53 are all still named open, with 53's stale-proof caveat intact and 50 still gating the holder guide's publication.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

Concrete, in order of what immutability makes permanent first:

1. **Run the dress rehearsal (item 22) with its five named items, especially the two that no gate has ever exercised:** one full live revenue cycle through *each* pool with signatures recorded, and one forced post-sweep failure walked through the hand recovery to a clean `--audit`. `bank/revenue.mjs`'s sweep/re-price/venue-loop/return/split/recovery has never run against a live chain by any gate; the fork proves the swap instructions, not the cycle.
2. **An independent reproducible build.** `build-mainnet.sh` states in its own output that it cannot prove the compiled constant is Gary's key — "the bridge is reproducibility". A second machine (ideally a second person) must rebuild from the release commit and confirm the five sha256 in `dist/SHA256SUMS` before deploy.
3. **A witnessed initialize with read-back.** The launch checker judges the JSON, not the signed transaction (A6). After the four `initialize` calls, read every config value back from chain and diff it against `launch/mainnet-init.json`, *then* remove the five upgrade authorities in the same ceremony, with a second person watching the values.
4. **A second RPC provider cross-checked in the rehearsal.** Every price, pool account, floor and alarm read goes through one endpoint; a rehearsal pass diffing two providers' answers is the only measurement of that trust short of an incident.
5. **The holder surfaces (item 50) exercised by people who did not build them, with real wallets** — a full redemption through the sweep helper on the rehearsal deployment, including the prior-transaction ATA preparation and the coverage warning, on Phantom and a Ledger.
6. **An adversarial day during the rehearsal:** pay someone to grief the live pipeline — dust the revenue PDA, flood the four programs past the read budget, pad transactions to truncate logs, split as a stranger, redeem in a burst — while the crank, alarm and revenue run live, and grade the pages.
7. **Key custody decided in writing by a human, not defaulted by the tree:** the $CBOB release wallet (limit 56), the swap operator key (limit 10), and the PoB collection hot wallet through the charter window (limit 46). Each is a ruling; each should be re-signed after reading the current honest list, or moved.
8. **A timed drill of the limit-10 bound:** alarm page → human reaches the guardian wallet → `emergency_stop_sweep` lands, measured end to end. The stated bound is "the alarm's cadence plus a human reaching the guardian wallet"; only a drill measures the second term.
9. **A human read of HOLDER-GUIDE.md against the code, sentence by sentence.** It is marked DRAFT and may not be published before item 50; every promise in it is a claim about immutable code.
10. **A dependency and toolchain review.** The coverage gate excludes `Cargo.lock` and `node_modules` by design; nobody in this process has ever read the dependency tree the programs and the money jobs are built from.

**Summary of findings:** 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW (a false `scan_gap` at an exact 1,000-multiple window boundary; a false crank failure page when a vault is redeemed between plan and activate). Round 31's repairs hold at their sites; its L2 repair is bounded and disclosed rather than fully implemented as recommended. The consecutive-clean counter question is for the triage, but by the round's own rule this pass is not clean (two LOWs), and I found no defect that immutability would lock in as exploitable.