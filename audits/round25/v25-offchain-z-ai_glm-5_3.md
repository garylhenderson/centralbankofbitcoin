# ROUND 25, OFF-CHAIN PASS — VERDICT: NOT CLEAN

**Commit read:** the bundle as given (HEAD after `2b67fb1`). Read-only; nothing executed against a cluster, nothing sent.

**Method and its limits, stated first.** I reasoned over the whole tree and re-derived the arithmetic (accrual identities, the boost carry algebra, the oracle exponent handling, the split/owed accounting, the rate-ring arithmetic). I could not open the Orca/Meteora/Pyth IDLs or the router; for the third-party account layouts I therefore relied on the fork run's behavioural proof (a wrong offset fails the real program) and checked internal consistency only — where my memory of a layout disagreed with the code, the fork run wins and I say so rather than file. Every finding below names the run that would confirm or refute it.

**Count: 0 CRITICAL, 0 HIGH, 2 MEDIUM, 4 LOW, 1 INFO, 2 doc-only.** No theft path, no unbounded loss, no plan that moves value anywhere the programs do not pin. The two MEDIUMs are both in the round-24 M1 repair's own footprint: the judge checks less than its stated purpose requires, and the rewritten revenue cycle has never been executed by anything.

---

## R0 — Round 24's off-chain repairs

I checked each repair at every site of its shape:

- **H1** (notify path): `planAlarmNotices` groups by kind, one-shots carry the pass stamp and `ALERT_URGENT`, level kinds get a RECOVERY on the first clean full pass, `report()` deletes `ALERT_URGENT` from the inherited env, `delivered` gates every baseline, and the undelivered path reverts config/balances/cursors/vaults/frozen/paged. I traced the non-reverted fields on an undelivered pass (`revenueSince`, `royaltySince`, `crankArmedSince`, `crankHealth`, `seenSplits/seenSweeps`) and none can consume a finding: the clocks only advance on real chain events, the streak continues, and the evidence sets are accumulators. I found no one-shot kind whose text can repeat identically (the stamp is per-pass) and no level kind that pages on a routine state at the ruled launch values (I evaluated `detectStandingRisks` against `mainnet-init.json`: cooldown 21600 sits inside [3600, 43200], cap 10 SOL ≥ the 5 SOL wedge line, charter 604800 — all quiet). **The repair holds.**
- **L1** (`BENIGN` + `judgeDistributeRefusal`): correct, including the refusal order in MINT (`BoostsExpireFirst`/`JoinWaitingFirst`/`PoolShort` before `MonthNotElapsed`) and `PoolShort` never benign. Holds.
- **L2** (`revealAttrSource`, `splitDecimalsByte`): holds; `'other'`/`undefined` skip and break the run, `[]` only for a positively burned asset, the split refuses a non-byte decimals.
- **L3** (the split's three accounts): holds — pool, Squads and revenue are each read, each blocker named, a blocked split does not count toward the distribution.
- **L4** (posture tri-state, heartbeat problems): holds.
- **L5** (`carryConfigBaseline`): holds — old→null pages once as a blip, null→new is compared against the carried value. The one false CRITICAL per blip is the stated price.
- **L6** (`judgeFeePayer` minimum-first, `budgetPlan`): holds; the kept reveals are a prefix, so mint order survives.
- **L7** (`judgeReserveRead`): holds.
- **L8** (per-mint burn correlation): holds.
- **L9** (`mintedAfter`): holds at both call sites.
- **L10** (ledger forgeries): I re-attacked all four routes (a `sendRejected` row carrying a sweep, an explicit `splitSig` held to the anchor, padding rows, future `startedAt`) and each is closed; the remaining forgery freedom (writing a low `quotedSats` alongside a small honest return) requires ledger write access, which is exactly limit 10 D2's accepted box-owner residue, not a new hole.
- **L11** (`closesCycle`): holds, and `revenue.mjs`'s recovery uses the same predicate before the emptiness proof.
- **L12** (anchored `ours()`): holds for both flag orders.
- **L13** (wiring gate, SPACE constants): holds; the mutation arms fire.
- **I1** (retiring owed freed before distributing): holds — I re-derived `owedAfterRetire` against `retire`'s accounting.
- **I2** (chain clock): holds in the crank — **and its shape was not carried to the swap, which is my L1 below.**
- **I3, I5**: hold.

Two findings live inside or beside these repairs:

### M2. The round-24 M1 repair's own orchestration has never been executed, and its step-1 instruction carries a signer flag that works only by side effect

**Construct:** `bank/revenue.mjs` `main()` — the whole rewritten cycle — and specifically the `sweep_sol_for_swap` instruction, whose third account meta is `{ pubkey: operator.publicKey, isSigner: false, isWritable: true }` against MINT's `swap_operator: Signer<'info>`.

**What an accident gains:** nothing moves incorrectly — if the signer flag mattered the sweep would refuse loudly (`sendRejected`, throw, notify). What it costs is certainty and liveness: the instruction is accepted (as I read web3.js) only because the operator is the fee payer and the fee payer is always `accountKeys[0]` and a required signer, so Anchor's `Signer` check sees `is_signer=true` through position. That is a side effect of transaction construction, not a property anyone chose, and nothing pins it. More broadly: `run-tests.sh` executes the suite, five selftests, the probe and the fork — **no gate anywhere executes `bank/revenue.mjs`**. The fork proof covers `bank/swap.mjs` directly; the rewritten cycle logic (the open-cycle guard, the ledger writes, the refusal/timeout classification, the recovery paths, this instruction) has zero executions. The first live cycle is its first run. If it fails, the revenue cycle is dead until a `bank/` fix, which resets the freeze counter.

**Evidence if I am right:** `grep -n "operator.publicKey, isSigner: false" bank/revenue.mjs` (the sweep's third meta); `grep -c revenue.mjs scripts/run-tests.sh` → 0. Settling measurement: deploy and initialize MINT on the rehearsal tree, fund the revenue PDA, run `node bank/revenue.mjs --live` once — the sweep either lands (fee-payer propagation, my reading) or refuses `ConstraintSigner` (my reading wrong). Either way, execution settles it; nothing today does.

**Fix:** set `isSigner: true` on the operator meta; make item 22's dress-rehearsal scope explicitly include one complete `revenue.mjs --live` cycle (sweep→swap→return→split) with the real ledger and key flow. Item 22 currently names only the crank.

### I1. The crank's claim-destination check is vacuous — dead code that reads like a control

**Construct:** `bank/crank.mjs` `planCrank`, claim loop: `if (!t || t.state !== 'ok' || t.address !== r.vault_ata)`. `tokens[r.asset].address` is set by `tokenAddr(r)`, which returns `r.vault_ata` for every vault the loop reaches (active vaults by definition; `joinedNow` vaults because `vault_ata` is the canonical ATA recorded at request). The comparison can never fire.

**What an attacker gains:** nothing — the real control is `t.state !== 'ok'`, which does verify the recorded account exists and is a token account. The defect is that a check which looks load-bearing is not, which is this project's own named failure shape (a claimed control that does not run).

**Evidence:** code reading; a selftest arm that plants a record and asserts the comparison never fires would document it.

**Fix:** delete the comparison or replace it with what it meant (re-derive the expected ATA and compare it to the record, which would catch a corrupted `vault_ata`).

---

## R1 — The crank

The four questions:

- **A plan the program will refuse:** none found beyond the benign-judged races. I traced each send against the program's refusal order: reschedule (window strictly passed at plan, later at send), capture (`slot > readySlot`, later at send), reveal (hash-checked first, FIFO, break on any anomaly), retire (positive burn classification matches `is_burned`), activate (balance can only rise in a sealed vault; `AlreadyActive` benign), preJoins (join-only claims succeed even with a frozen pool — the program's join path touches no pool transfer, matching round 24 D4's correction), split (three destinations checked), distribute (judged), expire (skips non-due), claims (destination existence and freeze checked at plan). The one interesting interleaving — a due month firing inside the join batch's own `monthly_inline`, before the joins — still joins the vaults at the post-distribution accumulator, which is exactly what the plan's owed math assumes, and the crank's own distribute then fails benignly (epoch moved).
- **A dead vault paid or joined:** no. `'other'` is excluded and reported, `'burned'` is retired first at any level, and the selftest arms both.
- **An out-of-order reveal:** no — the plan starts at `revealed_total`, breaks at the first not-ready index, and the send loop breaks on skip/mismatch/benign/fail.
- **Value moved anywhere unpinned:** no — only MINT instructions, no token or SOL transfer of its own, asserted in the selftest and re-verified by reading.

Plus **I1** above.

---

## R2 — The alarm

The required coverage is present and I found no dangerous on-chain state read as quiet: pending guardian/operator (CRITICAL standing), the PoB collection's plugins and update authority, the redemption window, pool frozen/short/unreadable, distribution overdue (including the three stalls), upgrade authority past the lock for all five, and Gary's production values (I checked every entry of the `want` list against the ruled numbers). No routine state pages every pass at the ruled values. Two findings:

### L3. The program ids exist in three ungated copies; a drift in any one reads as quiet

**Construct:** `bank/alarm.mjs` defines `SEAL/MINT/BURN/GOV/SWEEP` as independent literals; `bank/detectors.mjs` defines `MINT_PROGRAM_ID`/`BURN_PROGRAM_ID` as its own; `bank/layout.mjs` has `PROGRAM_IDS`. No selftest arm compares them. `missingWatchedKeys` exempts a program marked `_missing`, and a typo'd MINT id in `alarm.mjs` makes `readConfigs` derive the config PDA under the wrong program → `mint._missing` → main() takes the "not initialised" idle branch → the alarm reports "nothing deployed yet" forever and advances state.

**What an accident gains:** the entire alarm (or the event attribution, for the detectors' copies) silently watches nothing. This is the wired-to-nothing class this file exists to catch, reproduced in its own id constants.

**Evidence:** change one character of `alarm.mjs`'s `SWEEP` (or `MINT`) to another valid key and run the full `scripts/run-tests.sh` — nothing goes red. The rehearsal would catch it only if the rehearsal's success criteria require the alarm to *report* the deployed programs, which item 53's text does not state.

**Fix:** one assertion tying all of alarm.mjs's five constants and detectors' two to `L.PROGRAM_IDS`; add "the alarm reports every deployed program" to the rehearsal's checklist.

### L4. The alarm watches Core's bytes but not Orca's, Meteora's or Pyth's, though the swap's on-chain floor now rests on all three

**Construct:** `bank/alarm.mjs` `readConfigs` — the ProgramData loop is `[['seal',…],['mint',…],['burn',…],['gov',…],['sweep',…],['core',…]]`. Limit 10's own round-24 text names "the two pool programs and the Pyth price" as what is now trusted, and the same argument round 13 used to put Core in the list applies unchanged to them.

**What an accident gains:** an Orca/Meteora/Pyth upgrade lands unannounced. Most breakages are loud (a layout change makes `readWhirlpool`/`readPyth` throw → the cycle refuses; the next fork gate re-validates), but a semantic change that weakens `other_amount_threshold` enforcement would leave the swap executing with no on-chain floor, bounded only by the deviation gate and pool depth. The watch is four extra ProgramData reads a pass.

**Evidence:** the loop list above; `WATCH` contains no `prog.orca.*`/`prog.meteora.*`/`prog.pyth.*` keys.

**Fix:** add the three programs (Orca, Meteora, Pyth push and receiver) to the ProgramData loop and `WATCH` at CRITICAL, exactly as Core; note them in limit 10.

---

## R3 — The layouts

The assertions are real: `parseRustStruct` is strict (throws on any line it cannot read, armed both ways for private and `pub(crate)` fields), the field lists are compared name-for-name and type-for-type with both the added-field and retyped-field arms, the cross-program `OFF_*` constants are scraped and compared with a "nothing scraped goes uncomared" arm, the SPACE constants are scraped and evaluated, and **D6's seed assertion now exists** (11 of 11, with a mistyped-seed arm). A struct edit cannot slip past: name, type, order and count all move the gate. No finding.

---

## R4 — The money arithmetic

No divergence found. I verified: `credit` (`delta = avail·ACC_SCALE/w`, `owed += delta·w`), `ceilSats`, `owed_of` including the carry-before-debt order, `pendingSats` floor, `reweigh` (carry = owed, debt = new weight × acc), join debt (`w·acc`), `available`, and — the part most worth stating — the crank's owed formulas for the boost edge cases. A vault whose boost expires between the plan and the claim is computed by the crank as if the boost were still live (`(level+boost)·acc + carry − debt`), and that is *algebraically identical* to the program's post-expiry state (carry = owed-at-expiry, debt = level·acc), because the carry preserves the owed across the reweigh. The pre-expiry and post-expiry batch placements match `BoostsExpireFirst` and the ring's due accounting. The split's 85% (`total − floor(total·1500/10000)`) matches the program's floored bank cut exactly.

---

## R5 — The swap and the revenue cycle (never audited; moves value)

**(a) The oracle math.** Correct. The exponent handling is right for every sign (`e = sol.expo − btc.expo`; `e≥0` scales the numerator, `e<0` the denominator); all division is BigInt floor, so both `expectedSats` and `minSats` round down — the conservative direction; there is no overflow (BigInt throughout, and `satsPerLamport`'s Number conversions carry ~1e-13 relative error against a 1e-2 deviation bound). The floor does sit below what an honest pool returns: Orca fee 16 bps + ~0.6 bps impact, Meteora fee + ~13 bps impact at 2 SOL, both inside 150 bps — **but see L2: proven at 2 SOL, not the ruled 10 SOL cycle size.**

**(b) Pyth verification.** The `PriceUpdateV2` offsets are consistent with the Full-verification shape (tag 1 at byte 40, feed id at 41, price/conf/expo/publish_time at 73/81/89/93) and the fork run validates them behaviourally. Ownership + derived address + Full + feed id is as strong as the push oracle permits: a price write requires a Wormhole-guardian-signed VAA, so neither a chosen price nor a forged update is available; a *replayed* old VAA writes an old `publish_time`, which is exactly what the 180 s staleness check exists to refuse — **and that check runs against the box wall clock, which is L1 below.**

**(c) The deviation filter.** `orcaSpot` ((sqrtPrice/2⁶⁴)², raw cbBTC per lamport) and `meteoraSpot` ((1+bs)⁻activeId, the inverse of X-in-Y) are the right quantities in the right direction, both in sats-per-lamport, matching `satsPerLamport`. Floating point cannot pass a pool it should refuse: the error is ~11 orders below the bound.

**(d) The minimum out.** Same floor as the gate assumed, correct units for both programs (Orca `other_amount_threshold` = token-B base units; Meteora `min_amount_out` = X base units; cbBTC base units are sats). The gate admits a pool 100 bps off the oracle mid; fee+impact worst case is ~129 bps (Meteora, max conf), inside the 150 bps floor — barely, and see L2.

**(e) The judge — this is M1.**

### M1. `judgeSwapInstructions` does not check what its own purpose requires: the output account, the minimum-out bytes, the direction, the amount, the compute-unit price, or any Token instruction besides the close

**Construct:** `bank/swap.mjs` `judgeSwapInstructions`. It verifies: allowed programs, one signer, exactly one swap naming the pinned pool, exactly one SOL transfer into the operator's own wSOL ATA, exactly one close of that wSOL back to the operator. It does **not** verify: that the swap's output account (Orca keys[5] / Meteora keys[5], `user_token_out`) is the operator's own cbBTC ATA; the swap data's `minSats`, direction flags, or `amount`; that ComputeBudget instructions are limited to `setComputeUnitLimit` (a `setComputeUnitPrice` with a large `microLamports` passes — a priority fee that drains the operator key); or any Token instruction other than a close (an `Approve`, data[0]=4, on the operator's cbBTC ATA passes — a delegate that can later spend it).

**What an attacker gains:** the judge's comment claims it is the last line before the operator key signs, "even though we built it", against "a defect here, or a tampered module". Against a tampered builder, every one of these routes value out: the cbBTC output to any account, the wrap amount inflated, the key drained as priority fees, or a persistent delegate planted on the operator's cbBTC ATA. Against a mere *defect*, the fork test's `cbBal()` check does pin the output behaviourally — so the realistic exposure is the tampered-module case, which is the case the judge was built for. It is defence-in-depth on a single-user box (a tampered `revenue.mjs` could equally skip the judge call), which is why this is MEDIUM and not HIGH — but the round-24 verdict's own framing ("the transaction is judged before signing") reads as far stronger than what is checked.

**Evidence if I am right:** one run with planted mutations — redirect the swap's keys[5] to any other ATA; insert `ComputeBudgetProgram.setComputeUnitPrice({microLamports: 10n**12n})`; append a Token `Approve` on the operator's cbBTC ATA. `judgeSwapInstructions` returns `[]` for all three today, and the selftest's M1 arms cover none of them (they cover only the second signer, the duplicate swap, the foreign program and the missing close).

**Fix:** make the judge a strict shape check: the exact instruction sequence (CU limit; idempotent wSOL ATA; system transfer of exactly `lamportsIn` to the operator's wSOL ATA; sync; idempotent cbBTC ATA; the swap with pool/vaults/owner-ATAs/derived arrays pinned and its data's amount and threshold equal to the cycle's; close of the wSOL to the operator), ComputeBudget restricted to `setComputeUnitLimit`, and Token instructions enumerated (transfer/sync/close only). Arm each omission in the selftest.

**(f) Account derivation.** The Orca tick arrays (current, then the two below, for a_to_b) and the Meteora bin arrays (active, then the two above, for Y→X) match the programs' published interfaces as the fork run proved them; the boundary case is armed in the selftest (a tick exactly on an array start begins that array), and an uninitialised or stale-derived array makes the real program refuse — loud, next venue. One nit: `readLbPair` reads `status` and never checks it; a `DisableSwap` pool simply refuses (loud).

**(g) wSOL handling.** Clean. A pre-existing wSOL balance round-trips (sync makes it spendable, the swap spends only `lamportsIn`, the close returns the rest to the operator); frozen is impossible on the native mint; a delegate is irrelevant to an owner-authority transfer; exact-input means nothing is partially consumed; nothing is left wrapped. A frozen *operator cbBTC ATA* makes the swap refuse — loud, cycle open.

**(h) Failure and retry.** Correct. A confirmation timeout throws (the refusal regex does not match timeout text) and the cycle stays open; a landed-but-failed swap moved nothing, so treating it as refused and trying the next venue is safe; no path writes a second swap; every path leaves the ledger open until a return is proven (the return is a chain-read delta, held to the second read's floor, and the split is anchored on chain by `closesCycle`/`splitSig` verification). The one forgery freedom left (a low `quotedSats` written beside a small honest return) requires ledger write access — limit 10 D2's accepted box-owner residue, not new.

**(i) The tolerance bound — this is L2.**

### L2. The honest worst case is ~2.5–3% below fair value per cycle, not 1.5%, and the floor is proven at 2 SOL, not the ruled 10 SOL

**Construct:** `bank/swap.mjs` constants: `MAX_POOL_DEVIATION_BPS = 100`, `SWAP_TOLERANCE_BPS = 150`, `MAX_ORACLE_CONF_BPS = 100`.

**What an accident gains:** the floor is 150 bps below the *oracle's* expected output, the gate admits a pool 100 bps from the *oracle*, and the oracle itself may be up to 100 bps (its confidence bound) from truth. These add: a cycle can execute ~250–300 bps below fair value with every check passing. At the ruled cycle size (10 SOL per 6 h) that is a theoretical leak of ~0.25–0.3 SOL per cycle, ~1 SOL/day if every cycle is maximally adverse — and capturing it requires holding a $10M pool at the gate edge, which costs more than it extracts (moving that pool 1% costs ~$1–2k round trip to take ~$18 from a $1,200 swap). So it is a leakage bound, not an extraction path; but limit 10's "what remains trusted" should state it so nobody reads 150 bps as the bound. Separately, the fork test proves the floor at **2 SOL**; the ruled cycle size is 10 SOL and the Meteora fallback is ~10× thinner, so fee+impact headroom at the real size through Meteora is unmeasured (if it exceeded 150 bps the swap would refuse — loud, but the fallback would be dead).

**Evidence:** the three constants; a fork measurement swapping 10 SOL through each pool recording the executed price against the oracle.

**Fix:** state the composite bound in limit 10; measure a 10 SOL swap through both pools on the fork; consider tightening `MAX_ORACLE_CONF_BPS` to ~30 (live Pyth conf is ~0.01–0.05%, so this costs nothing and cuts the worst case materially).

### L1. The oracle staleness check runs against the box wall clock — the exact defect round 24's I2 fixed in the crank, in the unsafe direction

**Construct:** `bank/revenue.mjs` `market()`: `nowSec: Math.floor(Date.now() / 1000)` feeding `SW.oracleFloor`'s `nowSec - p.publishTime > 180` check. The crank was fixed (I2) to plan against the Clock sysvar because the box clock can diverge from the chain; the swap's only freshness bound was left on the box clock. A box clock running behind accepts Pyth prices older than 180 s.

**What an accident gains:** extended effective staleness. The deviation gate bounds the damage (a stale oracle with a moved market refuses the pool), so the residual is a stale-but-pool-consistent price — the same scenario L2 quantifies, with a longer staleness window.

**Evidence:** `node -e` calling `SW.oracleFloor` with a `publishTime` 400 s in the past and `nowSec` 600 s behind the true time — no throw; with the true `nowSec` — throw. Plus `grep -n "Date.now" bank/revenue.mjs` against `crank.mjs`'s `clockUnixTimestamp`.

**Fix:** read the Clock sysvar in `market()` exactly as `crank.mjs` does (the helper already exists and is exported).

**The operator key re-bound (limit 10):** unchanged on chain — 10 SOL × four 6-hour windows a day until the guardian pulls `emergency_stop_sweep`, never more than the revenue PDA holds above the reserve. What changed is the *silent* surface: an HTTP reply is no longer trusted, but the judge (M1) is now the only pre-signature check on a builder that no test executes through `revenue.mjs` (M2), and the three third-party programs the floor rests on are unwatched (L4).

**The sweep helper (`programs/cbob-vault-sweep`), audited here for the first time:** sound. The sources must be owned by the signer (the asset-signer PDA, which only Core signs, and only for the owner); the destinations must be owned by the single named wallet and match each source's mint; the close sends rent to that wallet; the final transfer moves the PDA's whole lamport balance (which is what BURN's `lamports == 0` requires, per measured fact 4); a direct call can move nothing the caller cannot already sign for; duplicate or missing destination accounts fail the whole atomic transaction. It requires the owner's destination ATAs to pre-exist (`read_token(to)` refuses a non-account), which is item 42/50's stated prior-transaction obligation. No finding.

---

## R6 — The gates

- **Assertions that cannot fail:** none found; the floors are equality-bound throughout (`-eq`, not `-ge`), and the wiring gate's stripped-bodies mutation arms fire.
- **Floors satisfied by deleting work:** none — deleting an assertion moves the count off the floor.
- **Vacuous checks:** the wiring gate on an emptied `main()` flags every detector (not vacuous); `planAlarmNotices([])` returning nothing is asserted as intended. **I1** (the vacuous claim-destination comparison) is the one vacuous check found, in the crank rather than a gate.
- **The both-ways gap in the round-24 section:** it is the judge's arms. The M1 section arms the judge for four tamper shapes (second signer, duplicate swap, foreign program, missing close) and none of the six the judge's purpose requires — output account, minimum-out bytes, direction, amount, compute-unit price, the ATA creations. The arms exist only for what the judge checks; the missing arms are M1's evidence. Secondarily, I2's arm is a source-regex (`nowSec: chainSec ?? nowSec`) with no behavioural arm that a divergent clock produces a different plan.
- **`build-mainnet.sh` for all five:** it proves what it says — the four key-carrying programs behaviourally (mainnet rejects the test key, localnet accepts), the sweep helper by byte identity to the suite-exercised build, exactly five artifacts, dirty tree refused, and its "NOT PROVEN" paragraph is honest about the compiled-constant gap.
- **`cron-install.sh`:** arms nothing it should not — the anchored `ours()`, the L12 both-order arms, the six-job count and the posture print all hold.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** Yes — **limit 10**, in three ways: (a) the staleness bound rests on the box clock (L1), so "bounded by the age" is only as good as an unwatched clock; (b) the honest worst case per cycle is ~2.5–3% below fair value, not the 1.5% a reader infers from "150 bps floor" (L2); (c) "the transaction is judged before signing" is narrower than it reads — the judge does not check the output account, the minimum-out, the amount or the fee (M1). And the limit's "what remains trusted" list should name that **nothing watches** the two pool programs or Pyth (L4) — Core is watched; they are not. No other limit is worse than its text.

**2. Is anything listed as a limit not actually a limit?** No. I re-checked 6, 7, 25–29, 32, 41–44, 46–49, 55, 56 against the code; each still holds as written.

**3. Is any DISCHARGED item not actually discharged?** No. Item 54's 14-vault CU figure is an extrapolation, but its own text says so. Items 51, 12/17, 30, 31, 33 stand.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No — 22, 38, 50, 52 and 53 all remain open and undemoted. Two doc-only notes: item 50 still says the sweep helper "is being built" when it is built, bundled and byte-proven (stale in the safe direction); and item 22's scope names only the crank — the revenue cycle's never-executed state (M2) is the same shape and belongs inside it.

---

## Anything else

- `sim/swap-fork.mjs` SW.0 asserts both pools are within the deviation bound of the cloned oracle — a live-market assertion that will fail the whole gate on a volatile day. Flakiness, not a hole; worth a retry or a widened band.
- The alarm's `seenSweeps` grows without bound (every sweep ever seen, with block times). Operational; the state file will need pruning eventually.
- `readLbPair` reads `status` and never uses it (noted under R5f).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Execute the never-executed money path with value.** No round, no gate, no test has ever run `bank/revenue.mjs --live` — its sweep instruction, its ledger writes, its refusal classification and its recovery paths have zero executions (M2). The dress rehearsal must run one complete cycle (sweep→swap→return→split) with the real operator key flow and a real ledger, and that success criterion must be written into item 22, which currently names only the crank. This is the single highest-value action available, because it is the one class of defect no amount of reading can exclude.
2. **Independently rebuild the artifacts.** `build-mainnet.sh`'s own "NOT PROVEN" paragraph names it: rebuild from the release commit on a different machine with a freshly installed toolchain and compare `SHA256SUMS`. Every AI round reads the same source through the same toolchain assumptions; only an independent build catches a compromised local one.
3. **Physically verify the operational facts the code asserts but cannot enforce.** The operator wallet holds nothing but cycle funds and its float (limit 10 D2); the crank key's mode and balance; the release wallet's backup custody (56); the Giraffish Moments hot key's actual custody through the charter window (46); the guardian key's storage. Each is a statement about the world, checkable only by a person standing there.
4. **Test the human paging chain end to end, at 3 a.m.** Fire a real URGENT page through the router and confirm a human wakes and understands it. The alarm's entire detection half ends at a phone; no audit of `planAlarmNotices` can test whether the phone is answered.
5. **Rehearse the incidents with a clock running.** A guardian-key theft (how many minutes from page to `emergency_stop_sweep`?); an operator-key theft (`unledgered_sweep` → human → stop); a Coinbase freeze (the holder-notification runbook); a wedged crank. Limit 10's bound is "cap × windows until the guardian pulls the stop" — the windows are counted from a human noticing, and that latency has never been measured.
6. **Soak time.** Run the deployed system in rehearsal shape for weeks before the lock: the alarm's state growth, the router's stream behaviour under real finding volume, the every-minute reveal lane's cost against a real RPC budget, the lock under real contention. Time cannot be compressed by reading code.
7. **An independent re-implementation of the payout arithmetic.** `bank/accrual.mjs` is the author's mirror of the Rust, and every selftest proves the mirror agrees with itself. Have someone outside the project recompute a live distribution's owed shares from chain state and reconcile against actual claims. The 3x Level-V promise deserves one reader who was not written by the same hand.
8. **Verify the third-party pins at deploy and watch them after.** Re-derive the Orca/Meteora/Pyth layouts from the published IDLs at deploy time (my round rested them on the fork run's behavioural proof — one reader), and add the three programs to the alarm's watch (L4), pinned the way Core is.
9. **Legal and disclosure review.** Custodial Bitcoin, the holder guide's promises (every sentence must stay true of code that can never be patched), the X/website surfaces. Outside any code audit's competence, and permanently binding once the authorities are removed.

**Verdict: NOT CLEAN.** 2 MEDIUM (M1: the swap judge checks less than its purpose requires; M2: the rewritten revenue cycle has never been executed and its sweep instruction works only by fee-payer side effect), 4 LOW, 1 INFO. Both MEDIUMs and L1–L2 touch `bank/`, which resets the freeze counter. The round-24 repairs otherwise hold at every site I checked, and the swap's core construction — the oracle math, the account derivations, the failure and retry discipline, and the stateless sweep helper — survived a hostile read.