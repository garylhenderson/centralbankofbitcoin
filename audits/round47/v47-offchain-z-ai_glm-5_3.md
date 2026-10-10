# Round 47, OFF-CHAIN PASS — independent audit of the whole tree

**Verdict up front: LAUNCH-CLEAN under SPEC gate 3's launch gate (nothing confirmed in (a)–(d)), REQUIRES CHANGES: R47o-1 (LOW, stale OPEN-item text in SPEC), R47o-2 (LOW, the Core-watch diagnostic suite's one-way validator lock), R47o-3 (INFO, orphaned suite result on a second Core change), R47o-4 (INFO, bundle gaps this pass must name).** Not a no-change round.

I read the tree whole, re-derived the arithmetic I could reach, and re-tested every round-46 repair at its site in the bundled source. I ran nothing live (no validator, no RPC, no notifier); every claim below is source-derivation against the bundled files, and I say where that limit binds.

---

## R0 — Round 46's verdict and its repairs, independently verified

The verdict (`audits/round46/VERDICT-offchain.md`) is bundled whole. I did not adopt its conclusions; I re-checked each confirmed finding's repair at its construct in this tree.

| Round 46 finding | Repair site, verified | Result |
|---|---|---|
| **V46o-1** (ack arm drove an unackable kind) | `bank/selftest.mjs`, R46 V46o-1 block: drives `unredeemable_owner` asset-less with a well-formed ack keyed `unredeemable_owner:undefined`, asserts `['CRITICAL', false]`; the `scan_gap` case beside it asserts `ackRefused` false. Guard `if (!f.asset \|\| !f.kind) return f` present in `applyAcks` (`detectors.mjs`). | **Holds.** The arm now fails if the guard is removed. |
| **V46o-2** (undelivered pass kept its unreadable counts) | `bank/alarm.mjs`, `if (!delivered)` block now carries `next.unreadPasses = prev?.unreadPasses ?? {}` and `next.unreadSkips = prev?.unreadSkips ?? []` beside cursors/backlogs. Selftest arm `undeliveredWalk` expects X paged "pass 1, 2 of 3" then skipped on the third delivered pass. | **Holds.** The rollback list is complete for the fields that record pass-local progress. |
| **V46o-3** (load-time refusal was silent) | `bank/revenue.mjs` top level: `refuseStrayOverridesAtLoad({ job: 'CBOB REVENUE CYCLE', label: 'cbob-revenue:config', notify: NOTIFY_LIVE, marker: \`${FAILURES}/config\` })` before any `rehearsalOnly` read. `bank/alarm.mjs`: same at load with `D.alarmLabel('run_failed')`, `notify: !DRY`, `marker: RUN_FAILED`. `bank/rehearsal-env.mjs` implements the page through `PRODUCTION_NOTIFIER` (the literal `/opt/scripts/notify-gary-sms.sh`), marker write, exit 3. | **Holds.** Both jobs now page once on a stray override; the crank refuses inside `main()` where its own failure path exists. |
| **V46o-4** (untracked placeholder fixture) | `web/test/ceremony.test.mjs` reads `${ROOT}/web/test/fixtures/placeholder/{out/cbob_placeholder.so,src/lib.rs}` and pins sha256 `94f75099…` against the fixture's own `SHA256SUMS`. Tracked path, no `.cache`. | **Holds.** |
| **V46o-5** (prompt bundle claims) | This round's prompt computes its carry list and names the 22 unbundled modules, and instructs that a claim turning on them "is a claim about a file you were not given: say so." | **Holds as far as an instrument can; see R47o-4 for what this pass still cannot see.** |
| **V46-7** (SPEC 53 stale proof sentence) | SPEC item 53 now records the `e7c192a` re-proof and names what keeps it open. | **Half holds — see R47o-1: one of the two named keep-open reasons is now false.** |
| **V46-8** (init key by genesis) | `scripts/check-launch-params.mjs`: `REHEARSAL_INIT_AUTHORITIES = { mainnet: [GUARDIAN_AT_LAUNCH], local: ['GmaDrpp…'] }`, judged by genesis in `judgeRehearsal`; `scripts/rehearsal-run.mjs`: `initKeyFor(network)`, `judgeInitAccount` (absent or System-owned-empty passes; program-owned-with-data refuses), called before `makeSteps`. Selftest R46 V46-8 arms drive both geneses. | **Holds.** |

**What I cannot re-verify and do not adopt:** the seat-by-seat quorum table (six of eight, DeepSeek counted narrowly). Those are judgments about other models' reports; I read the verdict's reasoning and it is internally consistent, but nothing in this bundle lets me re-run the seats. I also note the verdict's own measurement limits ("nothing live was run") — they apply to me identically.

**The rehearsal record** (`audits/rehearsal-2026-10-09/RECORD.md`) is bundled: item 22.2 recorded FAIL from a true `config_drift` on the real Metaplex Core upgrade that landed between the passes, and the record says plainly what that does and does not prove. That is honest reporting, and it is the seed of R47o-1 below.

---

## R1 — The crank (`bank/crank.mjs`)

I re-derived the planner against MINT and found no divergence:

- **Arithmetic.** `pendingScaled` = `(weight + boost) × acc + carry − debt` matches MINT `owed_of` exactly; `pendingSats` floors as `claim` does; `available` = `balance − ceil(owed)` floored at 0 matches `distribute`'s `PoolShort` refusal; `credit`'s `delta = avail × 1e12 / w` (floor) matches. The pre-join/pre-expire/retire weight adjustments to the denominator match the program's execution order (join before distribute, expire before and after).
- **Order.** main() sends reschedule → capture → reveal → rescue → retire → preJoins → expire(before) → split → distribute → expire(after) → activate → claims. Activations after the distribution (red-team 3 finding 6), joins before it (`JoinWaitingFirst`), expiry straddling it (`BoostsExpireFirst`). The frozen-pool tick and join-only claim batches are planned and sent (rounds 37/38 C01/C02 hold).
- **Races.** Both lanes share `planCrank` and can send concurrently; every cross-lane refusal is in `BENIGN` (`AlreadyCaptured`, `AlreadyRevealed`, `AlreadyRetired`, `AlreadyActive`, `NotNested`, `NothingToSplit`), and the money-carrying refusals (`PoolShort`, `BoostsExpireFirst`, `JoinWaitingFirst` unmoved) are re-judged against a fresh config read. I could not construct a plan the program refuses that the crank pages as a failure, nor a plan that pays or joins a dead vault.
- **Value routing.** The crank builds no token or SOL transfer of its own and calls no program but MINT (asserted by the selftest's name-list and source scans, which I re-read).

No finding.

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

- The sweep amount is read out of the instruction bytes (little-endian u64 at offset 8) and held against the ledger row; refused rows carrying sweeps page `rejected_row_has_sweep`; the state-derived `sweep_unledgered_state` closes the flood-delay hole. All hold.
- `cycleIsOpen` is the one predicate, imported everywhere; `closesCycle` anchors on the return's chain time; the split-claim attribution consumes anchors; the sorted-split binary search is pinned identical to the old form by the selftest's 400-case differential. All hold.
- The frozen-transition, log-gap and unreadable-skip machinery matches SPEC's "Reader coverage boundary" and "Scan backlog boundary" sections as written. I re-read `detectLogGaps`'s reviewed-prefix trim and the never-evict rule; they match.
- The alarm walks SEAL/MINT/BURN/GOV signatures but not SWEEP's. I convinced myself this is not a gap: the sweep helper is reachable only through Core `ExecuteV1`, which a sealed vault permits only inside a redemption, and every redemption touches SEAL and BURN, so the transaction is scanned in two walks already; the helper emits no `CBOB_` event line the parser would misattribute. Not a finding.

No finding.

## R3 — Layouts (`bank/layout.mjs`)

The field lists are asserted against the Rust structs by parsing (`parseRustStrust`/`parseRustStruct`), which throws on any line it cannot read as one `pub name: Type,` field; offsets are computed from the field list; every cross-program `OFF_*` constant any program pins is scraped and compared, with an arm that fails if any scraped constant goes uncompared. The seeds are scraped from each program's `*_SEED` constants (round 24 D6's missing assertion now exists). I re-derived `offsets('VaultRecord').level = 57` and the MintConfig offsets against the Rust field order in the bundled MINT source; they agree. The `BOOST_RING` fixed size (256 = 64×4) matches. No finding.

## R4 — Accrual (`bank/accrual.mjs`)

Re-derived line for line against MINT's `credit`, `owed_of`, `reweigh`, `ceil_sats`, `join`: identical, including the carry-before-debt ordering in `owed_of` and the debt restart at `weight × acc` on reweigh. The crank expires due boosts before distributing and expires the boosts its own distribution makes due right after; the alarm pages `boosts_stalled` and watches `cbob_mint` and both boost ceilings as fixed-forever CRITICAL drift. No finding.

## R5 — The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

- **(a) Oracle math.** Dimensional check: sats = lamports × SOL_USD × 10^(es−eb) / (BTC_USD × 10), which is what `oracleFloor` computes; exponent range pinned at [−18, 0] at both the read and the floor; `expectedSats` and `minSats` both floor (conservative); the float `satsPerLamport` is used only for the deviation filter, where its ~1e-16 relative error is far inside the 100 bps gate.
- **(b) Pyth.** Owner pinned to the receiver, address derived under the push oracle, full verification only, feed id checked, staleness 180 s and future 30 s judged against the Clock sysvar (an unreadable clock refuses the cycle). Recomputed the `PriceUpdateV2` offsets (40/41/73/81/89/93) against the reader and the selftest fixtures; the fork test cloned the real accounts and SW.7–SW.7b drive the age both ways. Ownership plus derivation plus feed-id is sufficient here because the account is a PDA under the push oracle — nobody but that program can write it.
- **(c)/(d)** `orcaSpot` = (sqrt_price/2^64)² in raw B-per-A units (sats per lamport for wSOL→cbBTC); `meteoraSpot` = the inverse bin power (X=cbBTC, Y=wSOL, reversed from Orca) — both the right quantity in the right direction, and the selftest drives 99/101 bps acceptance and refusal through the real `market()` on both venues. The on-chain floor (`other_amount_threshold` / `min_amount_out`) carries `m2.f.minSats` — the same 150 bps derivation the filter's 100 bps gate complements, in each program's own units.
- **(e) The judge.** I tried to route something past `judgeSwapInstructions` and could not: the seven positions are pinned individually (budget bytes, both ATA creations' full key lists, the wrap's exact amount and destination, SyncNative, the swap's discriminator/length/amount/floor/direction/price-limit/pool/input/output/signer-slot, the single close last), Token instructions are whitelisted to SyncNative and CloseAccount, priority fees are refused, and a second signer anywhere is refused. What it cannot catch is the accepted residue: write access to its own tree (limit 10(c)) and the swap's remaining accounts (tick/bin arrays, Orca oracle PDA), which the venue programs validate and which a tampered builder is out of scope for anyway.
- **(f)** Tick arrays: current, then two below (a_to_b pushes the tick down); bin arrays: active, then two above (Y→X pushes the bin up); bitmap passed as the program id when absent; `host_fee_in` as None. Matches the published interfaces as pinned.
- **(g)** Wrap exactly `lamportsIn`, sync, swap, close back. A pre-existing wSOL balance is topped up by the wrap and swept by the close; a delegate/frozen wSOL account would refuse the SyncNative/close at the pool program — loud, nothing lost. Leftover wrapped dust returns with the close.
- **(h)** Orca first; Meteora only on a refusal (preflight, on-chain failure, or expiry), never on an unconfirmed send; `classifySendFailure` reads the chain, and only an unsettled status leaves the cycle open. Every path leaves the ledger open until a cbBTC return is proven; the post-swap delta check (`delta < guaranteed` throws) is the after-signing backstop.
- **(i)** Within tolerance: a sandwich is bounded by the 150 bps floor plus fee plus impact (measured 18–20 bps under oracle at the ruled cap on the fork); a pool pushed to the 100 bps gate edge is skipped; a stale-but-accepted oracle is bounded by 180 s of drift plus 30 bps confidence; the Meteora pool is ~10× thinner but the same floor binds on chain. Per cycle at the ruled 10 SOL cap this is single-digit bps of royalty SOL; per month it is not material against the cap×windows bound of limit 10.
- **Operator key worst case:** unchanged from limit 10's statement — cap × cooldown windows until the guardian stops it, never more than the revenue PDA holds above the reserve; the ledger cannot read a failed cycle as closed (`cycleIsOpen` requires a split, refused rows cannot carry sweeps, `sweep_unledgered_state` is flood-proof).

No finding.

## R6 — The gates

I checked the floors against SPEC's stated counts: MIN_ASSERTIONS 912, DET_FLOOR 1072, ALLOC 39, POSTER 24, EXPIRY 4, POB 14, LAUNCH 69, MAINNET 35 — all equal in SPEC and `run-tests.sh`, and `selftest.mjs`'s own FLOOR equals DET_FLOOR. The web `run-all.mjs` floors sum to 801 (41+47+16+171+57+159+36+129+25+89+31), matching WEB_FLOOR. The floors demand equality, not lower bounds. `build-mainnet.sh` builds and behaviourally asks all four keyed programs plus proves the sweep helper's byte identity three ways. `cron-install.sh` arms nothing that is not tagged, preserves only its own tagged uncommented `--live` lines with anchored job names, and wraps every line in `flock -n`. I looked for an assertion that cannot fail and for a vacuous check and did not find one I could show; the round-24 both-directions discipline is visible throughout the selftest.

---

# Findings

## R47o-1 — LOW (documentation, fixable layer) — SPEC's OPEN items 53 and 22 still state as unrun a rehearsal that SPEC's own road step 8 records as done

**Construct.** SPEC item 53 ("What keeps it OPEN") says: *"every repair commit needs the same in-tree run again (round 46's included), and the dress rehearsal itself (road step 8, item 22) has not yet run to its end on mainnet."* SPEC's own road step 8 row says: *"**done on mainnet 2026-10-09 to 10-10**: items 22.1, 22.3, 22.4, 22.5 PASS; 22.2 recorded FAIL…"* — and `audits/rehearsal-2026-10-09/RECORD.md` is in this tree with the full step table, the item-22 verdicts, and the closing note ("All five rehearsal programs are closed…"). Item 22 likewise still reads *"This must be exercised (the mainnet dress rehearsal) before it pays anyone"* in the present-forcing tense, with no record of what ran and what residual remains (22.2's quiet alarm pass, and the "PASS at 5 vaults (scale not exercised)" residual the record itself names).

**What an attacker or an accident gains.** Nothing moves. The cost is the one this project's own history names: a stale OPEN reason resets the freeze counter every time a fresh reader notices it, and a reader trusting item 53's text over the record would believe the launch-critical rehearsal has not happened — or, worse, would re-run it and destroy throwaway keys the record says are already closed.

**Evidence if I am right.** The contradiction is internal to SPEC.md: read item 53's keep-open sentence, then the road step 8 row, then the bundled RECORD.md. All three are in this tree.

**Class.** Outside (a)–(d): documentation only; changes no code, test, page or build; misstates the process record, not a holder's money, rights, or what the programs do.

**Fix.** Rewrite item 53's keep-open list to what actually keeps it open (the post-round-46 in-tree re-proof at the current release commit, if it has not been recorded; drop the rehearsal clause) and move item 22 to discharged-with-residual, naming 22.2's unproven quiet pass and the 5-vault scale residual. Then re-run the drift sweep. Gate-5 arm: the readme-facts/stale-count machinery already demonstrates the pattern; a SPEC-internal consistency check (road step 8 "done" vs item 22/53 "not yet run") is the cheap permanent form.

## R47o-2 — LOW (operational tooling, fixable layer) — the Core-watch diagnostic suite's validator lock is one-way and has no liveness, so a concurrent canonical run kills it and pages a false URGENT, and a killed suite wedges every later one

**Construct.** `scripts/core-watch-suite.sh` takes `$C/.cache/VALIDATOR.lock` with `( set -o noclobber; echo "core-watch $H $(date…)" > "$L" )`, polls for a free validator for up to 12 hours, swaps `.cache/core-mainnet.so` to the new Core bytes while holding it, and restores on EXIT. Two defects:

1. **No other runner reads or respects `VALIDATOR.lock`.** `scripts/run-tests.sh`, `sim/run-sim.sh`, `sim/swap-fork.sh` and the e2e runner all kill whatever holds ports 8999/9900 (`pkill -x solana-test-val`, `fuser -k -TERM`) without consulting the lock. A canonical run started while the diagnostic suite holds the lock kills its validator mid-suite; the generated runner then completes with failures, `res done <rc≠0>` is written, and `scripts/core-watch.mjs`'s `decide()` emails **URGENT** *"The full CBOB on-chain suite FAILED against the new Metaplex Core… Do not move any CBOB program toward lock until this is understood"* — a false urgent page whose true cause is "a human ran the canonical suite." (The reverse is fail-closed and fine: a canonical run during the swap dies at the pin check.)
2. **The lock records no pid.** `bank/lock.mjs` breaks dead or recycled holders; this lock cannot. A SIGKILL'd suite (or a reboot) leaves `$L` in place forever, and every later diagnostic run polls for 12 hours, writes `res done 4 "the test validator stayed busy for 12 hours; nothing ran"`, which the next watch tick emails as the same URGENT FAILED.

**What an attacker or an accident gains.** No value moves; the diagnostic suite is deliberately non-certifying. The cost is a false URGENT page during exactly the window (a live Core change) when a real URGENT must be believed, plus 12-hour wedges of the diagnostic path.

**Evidence if I am right.** Grep the bundle for `VALIDATOR.lock`: only `core-watch-suite.sh` names it. Read `run-tests.sh`'s `cleanup()` and its port-wait loop: neither consults it. Read the lock's payload: a label and a date, no pid.

**Class.** Outside (a)–(d): tooling, no value path, no crack refused, not HIGH/MEDIUM.

**Fix.** Write the pid into the lock and break it when the holder is dead (the `bank/lock.mjs` rule), and have the four validator runners refuse (or warn loudly and name the holder) while a live foreign pid holds it; at minimum, `core-watch.mjs`'s FAILED result email must name "a concurrent canonical run killed the diagnostic validator" as a known cause before "do not move toward lock." Gate-5 arm: a both-ways test that a dead-pid lock is broken and a live one is waited for, and that `run-tests.sh` refuses while a live foreign lock stands.

## R47o-3 — INFO — a second Core change before the first diagnostic suite finishes orphans the first suite's result

**Construct.** `scripts/core-watch.mjs` `decide()` keys the suite start and the result email on the *live* hash (`suiteStatus(live.hash)`). If Core changes twice in one window (it changed three times in five weeks), the first suite's `suite-<N1>.json` result is never read by any later tick (live is N2), so N1's result email never sends. The newer suite covers the newer bytes, which is what matters, so this is a completeness gap in the record, not a detection gap.

**Fix.** On a tick, also check `suite-<prev.lastHash>.json` for an unsent result, or have `core-watch-suite.sh` email its own result directly. INFO; outside (a)–(d).

## R47o-4 — INFO — bundle gaps this pass must name rather than infer

Per the prompt's own rule, the following round-46 repairs are pinned in `bank/selftest.mjs` by arms against files this pass does not carry, and I did not verify them: **V46-1..V46-4** (the driver's resumable steps, values re-fill, rescue nest record, hand recovery) live in `scripts/rehearsal-steps.mjs` and `scripts/rehearsal-recover.mjs` (other pass); the key-preserving refresh is `scripts/rehearsal-refresh.mjs` (other pass); the page-mode ceremony and wallet-edit judges are `web/src/lib/plan-ceremony.mjs`, `web/src/lib/tx.mjs`, `web/deploy/rpc-proxy.mjs` (other pass); `web/src/config.js` pins (RELEASE_COMMIT, program hashes) are read by tests here but the file is not bundled. The selftest arms that reference them are well-formed and their expected values are consistent with everything I could check (e.g. `run-all` floors sum to WEB_FLOOR; the rehearsal map shape matches `rehearsal-tree.sh`'s engine), but "consistent with" is not "verified against." No finding; recorded so the next round's coverage gate does not read these as seen.

---

# The four questions on the accepted limits

1. **Is any limit WORSE than stated?** I attacked limits 10, 25, 26, 28, 32, 41, 44 and 46 against this tree and found none worse than SPEC states. The swap's trusted surface is now two pool programs plus Pyth plus one RPC endpoint plus tree integrity, exactly as limit 10(d) says; the redemption cap does not bind transfers (41); the re-roll (25) and leader grinding (26) residuals are as written; the frozen-pool forfeit (28) and the sweep helper's classic-stray coverage (44) match the code.
2. **Is anything listed as a limit not actually a limit?** No. I specifically checked whether limit 6/7's lock weaknesses were closed by the generation scheme (they are mitigated, and the limits are about logging and stall-detection, which remain real), and whether limit 9's blind spot (foreign nested assets) had grown a detector (it has not; the redeem page is still the only pre-signature control and is still unpublished — item 50, correctly OPEN).
3. **Is any DISCHARGED item not actually discharged?** No. Items 12/17 (compute), 14 (duplicate attributes), 19 (unlevelled halt) and the v5 retirements all check out against the bundled source.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** Items 22, 38, 50, 52 and 53 are all still OPEN. Items 22 and 53 are not being quietly demoted — but their text is stale in the direction of *under*-claiming what has run (R47o-1), which is the safe direction and still a defect of the record. Item 50 (pages unpublished) is correctly reflected everywhere including the holder guide's "built, and published before launch" phrasing. Nothing blocking is being treated as accepted.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Physically exercise the custody claims.** The record says the $CBOB release wallet's key is in a nightly encrypted offsite backup and that the deploy-authority key's loss before step 11 is survivable per a stated plan. No AI round has restored that backup onto a fresh machine and signed with it, or held the deploy-authority key. Do both, once, and write down that it worked. The same for the crank and swap-operator key files' modes and the backup include-lists — read the disk, not the docs.
2. **Make a phone buzz at 3 a.m. and act on it.** The router's stream behavior, grace windows and urgent break-through are measured against the router itself. "Gary receives the page and pulls the guardian brake within minutes" is a property of a human and a phone, not of this repository. Rehearse it once against the live rehearsal deployment: page, wake, stop, vote, restart, timed.
3. **Write the third-party upgrade runbooks and rehearse them.** The Core watch automates *detection* for Core. Orca, Meteora, Pyth's receiver and Pyth's push oracle are all upgradeable by keys that are not ours, and a layout-incompatible Pyth upgrade makes every revenue cycle refuse at the oracle read while royalty SOL accumulates. Who notices (the alarm emails `prog.pyth_*.hash` at HIGH), who decides, what the fallback is (hand swap? guardian stop?), and what holders are told — that is a human decision process that has never been written down, let alone walked.
4. **Run the scale the record admits it never ran.** Item 22's own record says "PASS at 5 vaults (scale not exercised)." Before launch, populate a local validator with ~2,100 synthetic vault records plus a throttling/flaky RPC stub and run the crank (paging, batch fees, the fee budget, the reveal lane keeping up), the alarm (the 2,000-read budget, the reconcile's ~4,200 `getTokenAccountsByOwner` calls), and a claim backlog drain end to end. No AI round and no 5-vault rehearsal has exercised this, and it is the layer that pays holders.
5. **Put a human behind the permanent mute buttons.** `bank/acks.json`, `log-gaps-reviewed` and `unreadable-reviewed` are standing downgrades on CRITICAL conditions with mandatory expiry — but the *reasons* need a person's periodic re-review, and the charter-window hot-key exposure (limit 46) is a custody decision, not a code one. Schedule the review; name the reviewer.
6. **Take the legal and regulatory questions to a human.** cbBTC's freeze authority, royalty non-enforcement on non-compliant marketplaces, and whatever the charter window is in the jurisdictions of the 240 Proof-of-Burn holders are entirely outside this repository, and no number of assertions in it can answer them.

**Result: LAUNCH-CLEAN under the launch gate — 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW (R47o-1 stale SPEC OPEN-item text after the rehearsal ran; R47o-2 the Core-watch diagnostic suite's one-way, pid-less validator lock), 2 INFO (R47o-3 orphaned suite result; R47o-4 bundle gaps named). Nothing in the five programs; no path that moves or miscredits value; nothing that stops or wrongly refuses a crack. REQUIRES CHANGES: not a no-change round.**