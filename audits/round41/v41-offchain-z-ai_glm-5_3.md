# Round 41, off-chain pass — independent audit of the whole tree

**Verdict up front: NOT CLEAN. 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW (F1, F2 below).** Round 40's repairs (C01, C02, C10, W2, U1) all hold at their sites and I found no regression from them; the two LOWs are new, both in the "gate that cannot catch the defect it exists for" class that this project rates LOW. My measurement limit: nothing here was executed. Every claim below is source-reading plus hand-recomputed arithmetic; where I say "measured" I mean recomputed by me, and I state what a run would show if I am wrong.

---

## R0 — Round 40's verdict and its repairs

**C01 (ceremony M2 arm).** The repair is in `web/test/ceremony.test.mjs`: `(at => at >= 0 && at < pageSrc.indexOf("const signed = await signExact(wallet, tx, s.id === 'collection'"))(pageSrc.indexOf("remember(ctx.newCollection.publicKey.toBase58())"))`. Deleting the `remember(...)` call now makes `at === -1` and fails the arm; deleting the `signExact` line makes the second index `-1` and `at < -1` fails. Repaired at its site.

**Sites of the same shape, checked.** The `indexOf`-ordering pattern where absence of the *first* string is vacuously true:
- `plan.test.mjs` V38-2 consent arm: presence-guarded (`> 0`), and an absent `steps.append(action(` makes the comparison fail loud. Sound.
- `selftest.mjs` M3 heartbeat arm (`cs.indexOf("if (!LIVE) {") < cs.indexOf(beat)`): vacuous if the dry-run return is deleted — **but** the separate arm `crank.mjs is DRY-RUN unless --live is passed` requires that literal text, so the property is guarded elsewhere. Not the C01 defect.
- `selftest.mjs` L2 and I1 arms: presence-guarded (`> 0`). Sound.

**C02 (swap floor pinned).** The arm asserts `[f.expectedSats, f.minSats, SW.SWAP_TOLERANCE_BPS] === [280_355n, 276_149n, 150]`. I recomputed the vector by hand: 2e9 × 12,045,355,552 / (8,592,910,904,675 × 10) = 280,355.65 → 280,355; × 9,850/10,000 = 276,149.68 → 276,149. Correct, and the constant is now held against SPEC's 150. **One sibling of this shape survives — that is F1 below.**

**C10 (attribute reader on unusual shapes).** The arm feeds hand-built Core accounts (richest real shape with a 20-signature autograph; plugin types 77 and 40) through `mintedAttributes`' actual `deserializeAssetV1` call and asserts the Attributes list reads. Present and non-vacuous (a parse failure fails it).

**Rejected claims I re-checked from source.** Qwen's ComputeBudget premise is wrong the way the verdict said: `setComputeUnitLimit` is byte 2 and `setComputeUnitPrice` byte 3 in the installed web3.js, and the judge checks exactly that. GLM's `detectRevealStall` reading is correct in source (`r0 < m0 && r1 < m1 && r1 === r0` — it fires whenever vaults wait and the queue is still, minting or not). The floors are consistent across the tree: `run-tests.sh` DET_FLOOR=933 = selftest FLOOR=933; `run-all.mjs` floors sum to 657 = VALIDATION's "web offline 657/657"; ceremony 108→113 and selftest 930→933 match the added arms.

**Counter status.** The repairs touched `bank/` and `web/test/`, so the counter stayed 0/2 as the verdict required. If F1 and F2 are confirmed, this round is not clean either; both fixes touch `bank/`/`scripts/`, which would reset it again.

---

## R1 — The crank (`bank/crank.mjs`)

I traced `planCrank` and the send block against MINT instruction by instruction.

- **A plan the program will refuse:** I could not construct one. Reschedule/capture windows match MINT's `reschedule_reveal`/`try_capture` bounds; reveals run strictly from `revealed_total` and the send loop breaks on the first failure or benign; preJoins match `dist_epoch > request_epoch`; preExpires match `dist_epoch >= boost_end_epoch`; the split is gated on all three destination accounts being live and unfrozen; the tick path matches `waiting_to_join == 0 && pending_this_epoch > 0 && !burn`; the send order (retire, join, expire, split, distribute, expire, activate, claim) is the red-team-3 order and is pinned by the R39 C01 extracted-send arm. A failed distribute degrades correctly: the claims that follow pay what the program computes at the un-advanced accumulator, so nothing overpays.
- **Dead vaults:** every pay/join path requires `assets[r.asset] === 'live'` (positively Core-owned AssetV1); burned ones are retired first. A record can only exist for an asset MINT minted into our collection, so the 'live' classification cannot be spoofed by a foreign-collection asset.
- **Weight arithmetic at distribution time:** `w = total_active_weight + preJoinWeight − retiringWeight − expiringWeight` exactly matches the on-chain sequence (retire subtracts level+boost; join adds level; expiry subtracts boost), with no double-counting of a vault that is both retiring and boost-carrying.
- **Value movement:** the selftest pins that crank.mjs calls no program but MINT and builds no token/SOL transfer; the key signs as fee payer only; `budgetPlan` never spends below the floor on any branch and still sends captures when under it.
- Minor, not a defect: with the pool *unreadable*, `plan.problems` says "nothing can be distributed or claimed" while join-only claim batches are still planned and sent — those land (a join never reads the pool), which is correct behaviour with a stale message.

## R2 — The alarm

- **Dangerous state read as quiet:** I hunted specifically and found none beyond the stated blind spots. A stolen operator key sweeping without the ledger → `sweep_unledgered_state` (state-derived, unfloodable); with honest-looking rows → the return/quote/anchor checks; skimming inside the 2% tolerance is the accepted bound. A thief's sweep cannot sit inside an honest cycle's half-cooldown window (the job writes a row only past the cooldown, so the gap always exceeds cooldown/2 — I re-derived this and it holds). The masked case (thief then honest sweep while the alarm is down a whole cooldown) is stated. `crank_silent`, `royalties_unswept`, `reveal_queue_stalled`, `boosts_stalled`, `joins_stalled` cover the liveness stalls; the `cooldownSeen = min(ever, 21600)` correctly defeats the vote-to-lengthen widening.
- **Routine state that pages every pass:** none found. `joins_waiting`/`sales_stopped`/brakes-on are INFO; freezes page once and stand at INFO; the index-lag page is the documented round-36-L5 behaviour; `minted_total`/`burned_total`/`rate_ring`/`boost_expiring` are deliberately produced-but-not-drift-watched (they move routinely).
- The `WATCH`/`WATCHED_KEYS`/wiring gate closes the wired-to-nothing class; `missingWatchedKeys` is armed both ways; `carryConfigBaseline` survives the one-pass-blip; the undelivered rollback keeps every baseline.

## R3 — The layouts

I recomputed `fixedLength('MintConfig') = 1005` and `VaultRecord = 211` field by field from the declared lists — both match the pinned values, and `minted_total` at 141 / `bare_burns_retired` at 454 confirm the header's example offsets. The struct-vs-Rust parse is strict (throws on any line it cannot read as one `pub name: Type`), the cross-program `OFF_*` table is scraped and fully enumerated (nothing scraped goes uncompared), the suite's own `OFF_*` constants are compared, versions and `BOOST_RING` are scraped, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are evaluated and held to the layout, and the D6 seed assertion now exists (11 of 11, with a both-ways arm). A struct change cannot slip past these without a deliberate edit to the gate itself.

## R4 — The money arithmetic

`credit`, `pendingScaled` (=`owed_of` with carry-before-debt), `ceil_sats`, `reweigh`, `debtAtActivation` are line-for-line the Rust. The crank's three owed cases are each correct: joinedNow earns `w × (acc_new − acc_old)` (join at old acc, credit at new); preExpired earns `old_owed + w × Δacc` (expiry reweighs at the old acc, then the distribution credits at level weight); the claim settlement leaves the sub-sat remainder as carry exactly as MINT does. The alarm's `poolAvailable`/`owedCeil` match. The expiry-before-and-after-every-distribution logic matches `BoostsExpireFirst` and `advance_epoch`. No divergence found.

## R5 — The swap and the revenue cycle

- **(a) Oracle math.** Exponent handling is correct for every sign (`e = sol.expo − btc.expo`; ≥0 scales num, <0 scales den); both divisions floor, so the floor is below the oracle's expectation. `satsPerLamport`'s float is used only for the deviation gate, where its ~1e-16 relative error is twelve orders below the 100 bps threshold — it cannot pass a pool it should refuse.
- **(b) Pyth verification.** I recomputed the `PriceUpdateV2` offsets (disc 8, write_authority 8–40, verification level at 40, feed 41–73, price 73, conf 81, expo 89, publishTime 93) — they match, and the fork proves them against real cloned mainnet Pyth accounts. Ownership + derived address + full verification + 180 s age + 30 bps confidence + 100 bps pool agreement is the design; the residual (Pyth itself, the push program's upgrade key, the one RPC) is limit 10's stated trust. The clock is the Clock sysvar with an owner check; a fake clock requires the trusted RPC, which is limit 10(b).
- **(c) Deviation filter.** `orcaSpot` = (sqrt/2^64)² in raw B-per-A units = sats per lamport; `meteoraSpot` = 1/(1+bs)^id with X=cbBTC, Y=wSOL = sats per lamport. Both are the right quantities in the right direction, and the L6 arms pin the 99/101 bps boundary with literal pool placements, independent of the constant.
- **(d) Minimum out.** The floor is the same oracle-derived `minSats` in both venues' expected units (sats), and it is the *only* floor — the deviation gate decides whether to trade, the floor bounds the execution, so the victim's bound vs the true market is 150 bps + Pyth's own error, exactly as the holder guide states.
- **(e) The judge.** Complete against round 25's list: exact seven-instruction sequence, CU limit 400k with no price instruction anywhere (no room for a disguised heap-frame or fee), both ATA creations checked key-for-key, the wrap's amount, the swap's amount/threshold/direction/price-limit/signer-slot/output account, the close last and once. What it cannot catch (same-tree tampering) is limit 10(c), stated.
- **(f) Derivations.** Orca tick arrays (current, then two below for a_to_b; boundary case pinned) and Meteora bin arrays (active, then two above for Y→X; negative-id flooring pinned) match the published interfaces; the bitmap-as-program-id and `host_fee_in: None` follow Anchor's Option convention. An uninitialised array makes the venue refuse → the fallback, which is the designed path.
- **(g) wSOL.** Exact-input swap consumes exactly `lamportsIn`; a pre-existing balance survives the swap and the native close returns it with the rent (nothing lost); a frozen or mis-configured operator ATA fails the whole transaction loudly.
- **(h) Failure/retry.** Orca first; Meteora only on a *refusal* (preflight, landed-failed, or expired-unlanded — all moved nothing); an unconfirmed send throws and never tries the second venue; every hop's uncertain send is preserved as a `pending*Sig`; the cycle stays open until a cbBTC return is proven and split. I found no path that reads a failed cycle as closed.
- **(i) Adversarial bound.** Per cycle the extraction is bounded by the 150 bps floor vs the oracle (the deviation gate does not widen the victim's bound, only the trade decision); at the ruled 10 SOL × ~4 windows/day that is ~1.5% of royalty SOL, proportional, disclosed. The operator key's worst case remains cap × windows until the guardian stops it, as limit 10 states.

## R6 — The gates

Floors are equality-bound everywhere I checked (run-tests.sh, selftest, run-all.mjs, swap-fork.sh); the audit-coverage selftest is 14/14 with both-ways cases; `build-mainnet.sh` proves all five programs (four behaviourally both ways, the sweep helper by three-way byte identity); `cron-install.sh` arms nothing it should not (the R26 arms execute the real preservation logic, and the L12 end-of-line anchoring holds). The round-24 both-ways claim: I walked the repair arms (H1, L1–L11, I1–I5, D5, M1) and each has a firing and a quiet direction; I could not find one that is not armed both ways. **The gap I did find is not inside a gate but around them — F2 below.**

## web/test — can each test fail?

I checked the named properties against vacuousness, the round-37 question. The C01 repair is sound (above). Beyond it I specifically checked: the `indexOf` ordering arms (all presence-guarded or backed by presence arms), the README hash table (a missing row fails), the L4 release-commit gate (control + three refusals), the proxy allowlist (bidirectional equality, so both a widened and a narrowed allowlist fail), the bundle C03 byte-comparison (six snapshots including strays, nesting, frozen pool, press-time cases), the meta generator's never-backwards arms (with controls), the ids/ix/decode comparisons (with diffIx controls that catch one flag, one byte, one account). **I found no arm in web/test that cannot fail when its named property breaks.** The `RELEASE_COMMIT` check correctly pins the *program* artifacts' provenance (0b3ddb3, the last program commit) while `run-all.mjs` rebuilds the pages fresh — not a staleness bug.

---

## Findings

### F1 — LOW — `MAX_ORACLE_AGE_SECS` is unpinned: the round-40 C02 defect class survives at the sibling constant

**Construct.** `bank/swap.mjs`: `export const MAX_ORACLE_AGE_SECS = 180`. SPEC (limit 10) states the bound as a number: "at most 180 s old". The only arms that exercise the age bound derive it from the constant itself: `bank/selftest.mjs` "M1: a price older than the bound is REFUSED" uses `publishTime: NOW - SW.MAX_ORACLE_AGE_SECS - 1` (and `NOW - SW.MAX_ORACLE_AGE_SECS` for the boundary); `sim/swap-fork.mjs` SW.7a uses `stamped(S.MAX_ORACLE_AGE_SECS + 1)`. No gate anywhere compares the constant to 180.

**What an accident gains.** A silent edit or bad merge that moves the bound to, say, 86,400 lets the cycle trade against a day-stale Pyth price with every gate green, contradicting SPEC's stated number. The *loss* bound is mostly still covered (a stale oracle >100 bps from the live pool is filtered by the deviation gate, and a stale-high floor makes the swap refuse on chain rather than execute low), so the materiality is below C02's: the harm is mainly that swaps and the revenue job stop landing in volatile hours and page hourly, and that a SPEC-stated number guarding the swap is unenforced. That is why this is LOW.

**Evidence if I am right.** `grep -n "MAX_ORACLE_AGE_SECS" bank/selftest.mjs sim/swap-fork.mjs` shows only `SW.`/`S.`-qualified uses; no literal 180 appears in any gate. Mutation: in a copy, set `MAX_ORACLE_AGE_SECS = 3600`; `node bank/selftest.mjs` and `sim/swap-fork.sh` both stay green because the arms move with the constant.

**Why this is the C02 shape, exhaustively.** Of the five SPEC-stated swap numbers: `SWAP_TOLERANCE_BPS` is now pinned (R40 C02); `MAX_ORACLE_CONF_BPS` is pinned (the I3 arm's expected value is the literal 30); `MAX_ORACLE_FUTURE_SECS` is pinned by the `T + 31`/`T + 30` boundary literals in the L2 arm; `MAX_POOL_DEVIATION_BPS` is pinned by the L6 arms' literal 1.0099/1.0101 pool placements. The age bound is the one constant in the family with no literal anywhere.

**Fix.** Extend the R40 C02 pinned arm (or add one): assert `SW.MAX_ORACLE_AGE_SECS === 180` against SPEC's stated bound, shown red with the constant moved. While editing, `MIN_SWEEP_LAMPORTS === 10_000_000n` (SPEC: "0.01 SOL") is the same shape at still lower materiality (a wrong value self-announces: too low fails the market step hourly; too high is bounded by `royalties_unswept`).

### F2 — LOW — the pages' tests are outside every automated gate, and `web/src` is outside the freeze

**Construct.** `scripts/run-tests.sh` — the ship gate's certifying run — invokes the detector, allocation, poster, PoB, launch, host-unit, mainnet-probe, on-chain, expiry-budget and swap-fork suites. It never invokes `web/test/run-all.mjs` (657 offline assertions behind per-file equality floors) or `web/test/e2e-localnet.sh` (127 assertions). Gate 2's freeze scope is `programs/`, `bank/`, `scripts/`; `web/` is exempt, so page changes during the freeze neither reset the clean-round counter nor trigger any test run — and the pre-round drift sweep can itself produce `web/src` fixes.

**What an accident gains.** A regression in the redeem page — the pre-signature coverage check, the sweep-helper call, the standing consent, the press-time by-address re-reads, which are the *only preventive controls* for accepted limits 9 and 44 — lands between the last recorded manual validation and the lock, certified by nothing that runs automatically. Item 50 makes those pages a precondition of road step 11 (the lock).

**Evidence if I am right.** `grep -n "web" scripts/run-tests.sh` returns nothing; no file in the tree invokes `run-all.mjs`; round 40's VALIDATION.md records the web runs as separate manual steps ("web offline 657/657", "Pages end to end 127/127") rather than as runner gates.

**Fix.** Wire `node web/test/run-all.mjs` into `scripts/run-tests.sh` (it needs only `web/dist` from a prior `scripts/build-mainnet.sh` run, an ordering the runner already tolerates for its deploy step), and either add the e2e beside the expiry-budget gate or record in the ship gate that the pages' certification is the validation run at the release commit. Alternatively or additionally, add `web/src` to gate 2's freeze scope, since item 50 makes it launch-blocking.

---

## The four questions on the accepted limits

1. **Worse than stated?** I could not make any limit worse than its text. The swap's adversarial bound composes to exactly what is stated (the victim's output ≥ oracle × 0.985, and the deviation gate only decides *whether* to trade, not the bound); the Meteora fallback is thinner but identically floored; the sweep-state window cannot be widened by a voted cooldown; the frozen-pool, charter-window, and custody limits all match the code I read.
2. **A limit that is not a limit?** None found. The reconcile lane's silent stall (limit 7) is still real — the deadman watches only `ALARM_STATE`, not `RECONCILE_STATE` — and limit 6's unlogged aborted `flock` run is still real.
3. **A discharged item not discharged?** Item 54's "the crank's 14-vault batches sit near 60,000 CU" is an extrapolation from the 6-vault measurement, not a measurement at 14 — but the discharge text says so itself, and the margin is ~3× under the default budget, so I do not count it. Everything else I checked (12/17, 14, 19, 30, 31, 33, the v5 family) is genuinely closed or gone.
4. **OPEN quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain open; `launch/mainnet-init.json` still holds `charter_opens_at`, `lock_deadline` and `vault_collection` OPEN; the rehearsal value set is still named-as-not-built, not assumed.

## Anything else (observations, not findings)

- **The vault collection's update authority is not in the alarm's watch list** (only `collection.plugins_hash` is). I traced whether this is a gap: Core's `UpdateCollectionV1` needs the current authority to sign, the current authority is MINT's PDA, and no MINT instruction signs it — so the value is structurally unchangeable without a MINT compromise, which `prog.mint.hash` pages at CRITICAL, and the *consequences* of a hypothetical change (foreign mints, plugin edits) are caught by `detectIndexShortfall` and the plugins hash. Defensible as-is; one line to add if you want the belt.
- The crank's `MonthNotElapsed` → benign classification is the safe direction (a no-op refusal retried next pass), and the race codes that could mask a wrong plan all go through the epoch-move check.
- The V40-1 `absentIfDust` repair is sound end to end: raw lamports at an address do not block System-level account creation (only a data-carrying account would), which is why the page's planned create lands and why the crank's transient 'foreign' read of a dusted, not-yet-created vault ATA self-resolves when the ATA is created.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the dress rehearsal (item 22) and treat it as the certification it is.** No audit round — this one included — has ever executed the crank against a live cluster with ~2,100 records, run one full revenue cycle through each pool, or walked a forced post-swap failure through the hand recovery. Reasoning cannot substitute for a rate-limited RPC at vault 1,900 of 2,100 or a confirmation timeout on a swap that landed. The named pass/fail items in item 22 are exactly the residue of forty rounds of reasoning.
2. **A human reads the four signed `initialize` transactions before broadcasting.** The checker validates the JSON; the programs check less than the checker; the gap between them is a pair of human eyes on the bytes about to become permanent (item 38's own residue).
3. **Key-custody acts that are rulings waiting to be made:** move the $CBOB release wallet off this box (limit 56 names the closure), decide whether the PoB collection key goes cold through the 7-day window (limit 46 names that closure too), and settle the operator wallet's "nothing but the cycle's funds" discipline.
4. **An alert drill with a person on the other end.** Fire each CRITICAL/HIGH once in rehearsal and confirm a human receives it, reads it, and knows what to do — the router's streams, recoveries and one-shot urgencies have never been exercised with a recipient in the loop, and a page nobody understands is a page that does not exist.
5. **One DAS read of a collection holding a burned Core asset** (item 22.5) — a single live query that settles whether `burnt` is set, and that the freeze log notes would force a `bank/` commit if answered "no".
6. **Reproduce the build on a second machine** and confirm the sha256s — `build-mainnet.sh`'s own closing note says reproducibility is the whole bridge for the INIT_AUTHORITY claim, and one box proving its own output is not a bridge.
7. **Measure under congestion** (round 40 C11's carry): capture latency and swap inclusion in a high-fee period, since limit 25's cost is priced in calm conditions.
8. **Gary personally walks HOLDER-GUIDE.md against the published pages** before item 50 closes — the guide's every-sentence-true rule is a human judgement call, and it is the one document holders will actually read.