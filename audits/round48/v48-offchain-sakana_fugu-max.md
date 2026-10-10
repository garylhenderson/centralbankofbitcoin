# Round 48 — off-chain pass (crank, alarm, layouts, arithmetic, swap/revenue, gates, `web/test`, round-47 repairs)

**What I could and could not do.** I was given files, not a box. I ran nothing: no validator, no suite, no fork, no crank/alarm/revenue pass, no RPC. Every claim below is either (a) a read of the code in this bundle, or (b) explicitly marked as "evidence that would exist if this is true", so it can be checked in one command. Where a claim would turn on a file this pass does not carry (`web/src/config.js`, `web/src/lib/*`, `scripts/rehearsal-steps.mjs`, `README.md`, `tests/3prog.test.ts`, `bank/txread` consumers, `web/deploy/rpc-proxy.mjs`), I say so and do not infer its contents. I did not open `audits/round47/VERDICT-programs.md`; round 47's programs findings are not re-filed here.

**Round 47's off-chain verdict is not a no-change round and is not clean by the owner's own test** ("a clean round where we make NO changes"). Nine LOW/INFO findings, none in (a)-(d). I verified each repair at its construct in the files I hold (§R0) and found **one repair that no gate runs** (F1) and **one narrow silent-wedge in the same new code** (F3). Nothing else in round 47's list survives measurement against this tree, and I agree with its three contested calls (Muse's `host_fee_in` MEDIUM is limit 10(c); MiMo's reveal-run LOW is the design; Fable's `NoActiveVaults` race cannot take the code path it names).

---

## R0. Round 47's verdict and its repairs

Verified present and coherent, at the construct each verdict names:

| V47o | repair, as it stands in this tree | verdict |
|---|---|---|
| 1 | `core-watch-suite.sh`'s `res()` builds its JSON with `node -e … JSON.stringify`; `core-watch.mjs`'s `suiteStatus()` returns `{status:'unreadable'}` for an unparseable file and `decide()` reports it once, URGENT, and does **not** start another suite (`finished()` includes `'unreadable'`; the only other branch is the level re-assertion). `FAILS=$(grep -c … \|\| true)` cannot emit `"0\n0"`. | holds — **but nothing runs its selftest** (F1) |
| 2 | `scripts/validator-lock.sh` (NEW); all five runners source it and call `validator_lock … \|\| exit 1` **before** installing the `trap … EXIT` that kills validators, and boot the validator with `9>&-`; `run-tests.sh` re-hashes `core-mainnet.so` at `[4/7]`; `core-watch-suite.sh` waits on the same flock and restores a crashed diagnostic's cache. | holds in the files I hold |
| 3 | SPEC item 22/53 restated; road row 8 now reads "done on mainnet 2026-10-09 to 10-10; 22.2 FAIL accepted by Gary (a true detection); scale not exercised"; item 53's keep-open reason is the in-tree run, last `e7c192a`. | holds; the residue is F2 |
| 4/5 | `readme-facts.mjs` counts `git ls-files audits/` only, and `changes()` uses `/^REQUIRES CHANGES: (?!NONE\b)\S/m`. | holds |
| 6 | `cron-install.sh` installs the Core watch under `flock` off the `4-59/10` tick plus its own deadman on a **missing or >60 min** `$CORE_WATCH_STATE`; the selftest's job list moved to eight. | holds |
| 7 | `decide()` emails an earlier build's unsent result once, marked "EARLIER Core build". | holds |
| 8 | `mock-rpc.mjs` answers `getTokenAccountsByOwner` per token program with `dataSlice` + `space`, and the `MOCK_ADVERSARY` hook moved there. | holds |
| 9 | `run-tests.sh` dies with a named reason when `dist/SHA256SUMS` is absent, before the page tests and after `[3/7]`. | holds |
| V47-4/5 (pages) | `minUnits` from the step's own dry run; a demoted writable refused by name. | holds (arms present in `ceremony.test.mjs`/`tx.test.mjs`) |
| V47-6 | the generated table no longer says SEAL holds / BURN pays the reserves; SWEEP does, "through Core". | holds |

**Measurement limits of this verification:** I confirmed text and structure, not behaviour. `web/deploy/rpc-proxy.mjs`, `web/src/config.js`, `web/build.mjs`, `scripts/rehearsal-steps.mjs`, `scripts/rehearsal-run.mjs`'s step bodies (only the pure judges are here), `bank/txread.mjs`'s consumers, and `README.md` are in the other pass or not carried; I make no claim about them.

---

## R1. The crank (`bank/crank.mjs`) — no confirmed finding

Proved by reading (each is a place the prompt asked for a defect and I could not find one):

- **Order and refusal-avoidance.** `planCrank` plans against the state the pass will have made: `retiringWeight` (retires run first), `expiringWeight` (pre-expiry runs before the split/distribute), `preJoinWeight` (joins are batched *before* the distribution), `owedAfterRetire` (a retiring vault frees its share). The send order in `main()` is retire → join → expire → split → distribute → expire-after → activate → claims, which is exactly what the plan assumes. Every branch that MINT refuses is either avoided or in `BENIGN`/`DISTRIBUTE_RACE` with the epoch-moved test.
- **No dead vault is paid or joined.** Only `assets[r.asset] === 'live'` is joined or paid; `'burned'` is retired first (at any level) and `'other'` is reported and left owed. `retiringThisEpoch` subtracts the tick's own retirements (round 23 L3), and the join-after set excludes anything already in `preExpires`/`retiring`.
- **No reveal out of order.** The reveal list is built strictly from `cfg.revealed_total` in mint order and the send loop `break`s on the first failure *and* on the first benign (already-revealed) — so nothing behind a stall is ever sent.
- **Nothing moves value where MINT does not pin it.** The instruction set is exactly the ten permissionless MINT instructions (selftest arm), the distribute is the free path (`burn = 0`), claims pay `r.vault_ata` (recorded at activation), the split's three destinations are derived from config, and the rescue's `new_owner` is `cfg.bank_treasury`, which MINT re-checks (`WrongRescueDestination`).
- **Fee accounting.** `planCostLamports` counts every transaction `main()` sends (including `ceil(preJoins/batch)` and each rescue) plus one attribute rent per reveal; `budgetPlan` never lets reveals spend the key below the floor and still sends the base plan (round 30 L2), with a floor-kind warning on its own stream.

**Two accepted-limit dependencies I re-checked rather than filed** (both stated): a bare Core burn landing between the crank's asset read and its claim sends can pay one pass of that vault's share into a dead account (limit 27; the crank retires it next pass), and a vault whose recorded cbBTC account was closed by its own owner via Execute is reported as a `problem` forever until redeemed (`crank_problem` pages after three passes — the intended loud behaviour).

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`) — no confirmed finding

- Every watched key is produced (`missingWatchedKeys`, with `prog.*` no longer exempt wholesale) and every `kind:` literal in both sources is classified exactly once (`ALARM_KINDS`), with a both-ways arm for a planted new kind and for a stale entry.
- One stream per kind, one-shots URGENT with the pass time, level kinds recovered on the first full pass that no longer finds them, `ALARM_URGENT` stripped for level notices, and the router itself is executed in a scratch state dir to prove each of those.
- All five programs' upgrade authority **and** bytes are watched (`prog.sweep.*` included), the lock date is the earlier of the file and MINT's immutable `charter_opens_at`, and the production list pins 21% / 51% / 3 days / 7-day notice / the three tighten bounds / 30-day month / 3600 s window (and, correctly, *not* the guardian, swap operator, cap, cooldown or reserve — the checker pins those, exactly as item 38 says).

**The dangerous state I chased and could not reach.** `collectionPluginsHash` hashes only the plugin region, so the vault collection's **update authority and name/URI are outside every drift key**. That is a real hole in the *watch*, and it is unreachable: `initialize` refuses a collection not owned by MINT's `["mint"]` PDA (`CollectionNotOurs`), and no MINT instruction CPIs `UpdateCollectionV1`, so the only signer that could change those bytes never does. (The Proof-of-Burn collection's authority *is* watched, because that one is a hot wallet — the asymmetry is deliberate and correct.) I file nothing here; the evidence that would prove a defect is a Core `UpdateCollectionV1` reachable from one of our programs, and there is none.

**The routine pages are the stated ones:** `royalties_unswept` can keep re-asserting while incoming royalties mask successful sweeps (limit 10, round 27 D4, stated), and `distribution_overdue` is a level CRITICAL while the pool is frozen (stated, and its text now says the distribution waits for the thaw).

---

## R3. Layouts (`bank/layout.mjs`) — no confirmed finding

The D6 SEEDS assertion now exists and is real: all twelve seeds are scraped from the program that declares them, a mistyped seed and an unmapped seed are both caught, and the field lists are compared to `parseRustStruct` output (name **and** type), with `parseRustStruct` throwing on a private or `pub(crate)` field rather than dropping it. Every cross-program `OFF_` constant any program pins is compared against `offsets()` — including the seven that were scraped and never compared before L2 — plus the versions, `BOOST_RING`, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` less padding (evaluated from the Rust), `LEVEL_WEIGHTS`, `ACC_SCALE`, `REVEAL_WINDOW_SLOTS`, and `readySlot`'s two constants against hand-worked values. A struct edit that changed order, type, size or version turns the build red at four independent gates.

---

## R4. The money arithmetic (`bank/accrual.mjs`) — no confirmed finding

Line-for-line against `programs/cbob-vault-mint/src/lib.rs`: `credit` (`delta = avail × 1e12 / w`, `owed += delta × w`), `owed_of` (`(weight+boost)×acc + carry − debt`, refusing a negative), `ceil_sats`, `join` (`debt = w × acc`, `carry = 0`), `reweigh` (owed → carry, debt → new weight × acc), `expire_boost`'s due test (`dist_epoch >= boost_end_epoch`) and `unschedule_boost`'s two branches. The crank's three derived cases match the program's own sequencing: a vault joined this pass is owed `levelWeight × (acc_new − acc_old)`; a vault expired before the distribution is owed `owed_at_old_acc + levelWeight × Δacc`; one expired after it is owed at its boosted weight. `advance_epoch`'s `end_epoch === dist_epoch + 1` post-expiry set is the same condition the program uses to make a boost due. No divergence.

---

## R5. The swap and the revenue cycle

**(a)-(d), (f), (h), (i): no confirmed finding.** The oracle arithmetic is the documented formula with both exponent signs handled and floors in the safe direction; `readPyth`'s offsets (level at 40, feed at 41, price 73, conf 81, expo 89, publish 93) are right, ownership plus a derived address is the whole access control Pyth gives (only the receiver program can write there), the age is judged on the Clock sysvar and never the box clock, and `MAX_ORACLE_CONF_BPS`/`PYTH_EXPO_*` bound what a nonsense feed can do to the floor. `orcaSpot`/`meteoraSpot` are the right quantities in the right direction (the Meteora pair is X=cbBTC/Y=wSOL, so the inverse bin power *is* sats per lamport), the deviation gate and the on-chain floor come from the **same** `market()` read, and both thresholds are in sats. `classifySendFailure` asks the chain, `refused` and `landed` are distinguished, and every failure path leaves the ledger open until a cbBTC return is proven (`cycleIsOpen` + `closesCycle`).

**(g) wSOL, answered rather than filed.** The wSOL ATA cannot be "created by someone else" (its address is a PDA of the ATA program keyed on owner+mint, and only that program can sign for it) and cannot be frozen (`So11111111111111111111111111111111111111112` has no freeze authority). If it already holds a wrapped balance, `syncNative` adds `lamportsIn` and the swap's exact-input consumes exactly that, so the close returns the leftover **as SOL** — nothing stays wrapped. A delegate is irrelevant (the owner signs the close).

---

### F1 (LOW) — `scripts/core-watch.mjs --selftest`: a both-ways proof with no runner and no floor

**Construct.** `scripts/core-watch.mjs` `selftest()` (the 25-arm decision table that is the *only* gate for V47o-1's unreadable-result handling, V47o-7's earlier-build result, the osec/tag transitions and `readPin`'s refusal), and `scripts/run-tests.sh`'s `[6/7]` block, which runs `sub_selftest` for poster, pob-merkle, launch-params, host-unit-tests, web-offline, readme-facts, detector, allocation, the mainnet probe, expiry-budget and the swap fork — and for nothing else.

**What it costs.** `decide()` is the code that decides whether a Metaplex Core upgrade is *diagnosed* and *reported*. Its two round-47 repairs (a PASS written as invalid JSON must not re-run the suite every tick; an earlier build's result must still be sent) are pinned only here. A regression — including the original V47o-1 behaviour, verbatim — is caught by no build, no suite and no cron: the arms could be deleted outright and every floor stays green.

**Evidence if I am right.**
`grep -rn 'core-watch.mjs --selftest' /opt/cbob-vaults` → no matches (the only references to the file are the cron line, the header comments, and `bank/selftest.mjs`'s `cws` block, which *reads* `core-watch-suite.sh`'s source rather than executing the watch). `run-tests.sh`'s sub-selftest list, above. And the selftest's own last two lines carry no count check:
```js
console.log(`\n${ok}/${ok + bad} core-watch assertions as predicted`)
process.exit(bad ? 1 : 0)
```
so even run by hand, deleting arms is silent — the same defect round 14 fixed for the detector and allocation suites, and round 12 for the on-chain floor. **Second, narrower consequence:** `decide()` writes `{status:'queued'}` *before* `spawn('setsid', …)`, and nothing ever ages that state out. If the spawn fails (or the script cannot start), the record stays `queued` for ever; the URGENT "Core changed" mail has already been sent, the suite's result never follows, the level re-assertion merely prints `Suite: queued`, and the watch's own deadman never fires because the state file is rewritten every tick. (If `spawn`'s ENOENT surfaces as an unhandled `'error'` before the state write, the process dies and the deadman does fire — the silent case is the one where the state write wins the race, which is the likely ordering.)

**Fix.** `CORE_WATCH_FLOOR=25` + `sub_selftest core-watch node scripts/core-watch.mjs --selftest` + `floor … "$CORE_WATCH_FLOOR"` in `run-tests.sh`'s `[6/7]` block; replace the selftest's exit with an equality against a `FLOOR` constant. Show both directions red: delete one arm (count mismatch), and revert the V47o-1 branch (the `unreadable` arm fails). Separately, treat a `queued`/`waiting` record older than ~15 minutes as "did not start": re-spawn once, and page if it happens twice.

---

### F2 (INFO) — the revenue job never reads the state of the accounts the swap must write

**Construct.** `bank/revenue.mjs` `main()`, the `prepare` stage:
```js
const opBefore = readTokenAccount(opInfo).state === 'absent' ? 0n : requireTokenAmount(opInfo, …)
```
`bank/spl.mjs`'s `readTokenAccount` returns `{state, amount}` only — nothing in `revenue.mjs` reads byte 108 of the operator's cbBTC ATA (or of its wSOL ATA) before the sweep, and `grep -n 'frozen' bank/revenue.mjs` finds nothing. (The *crank* does exactly this check for its split's destinations — round 24 L3 — and the alarm pages a frozen pool/revenue account; the operator's own accounts are the one pair nobody reads.)

**What it costs.** If Coinbase freezes the operator's cbBTC ATA (the only reachable variant: wSOL has no freeze authority, and a delegate does not block a transfer), then after the sweep has landed — up to `min(balance − reserve, max_sweep_lamports)` of royalty SOL now on the operator key — every venue refuses, because a token transfer into a frozen account is refused by the Token program. The cycle stops open with `swapFailure` recorded, `--audit` lists it, `unreconciled_swap` pages CRITICAL after the grace, and a human must finish it by hand (limit 10's runbook, item 22.4's rehearsed path). Nothing is lost that the runbook cannot recover, which is why this is INFO and not (b): no new value moves, and the failure is loud.

**Evidence if I am right.** `grep -n 'TOKEN_STATE_OFF\|frozen' bank/revenue.mjs` → nothing; `bank/spl.mjs`'s reader never surfaces the state byte; a unit drive of the `prepare` stage against a synthetic `getAccountInfo` whose byte 108 is 2 proceeds to the sweep (the write path is unchanged), while the same fixture with a check would refuse.

**Fix.** In `prepare`, read byte 108 of `opAtaAddr` (and of the operator's wSOL ATA if it exists) and refuse the cycle **before** the sweep with a named reason — the same shape as the crank's frozen-destination refusal. Both-ways arm: a frozen operator ATA refuses with no ledger row; an unfrozen one proceeds.

---

### F3 (INFO) — item 53 is OPEN AND BLOCKING and is not in the (a)-(d) launch gate

**Construct.** SPEC item 53's own keep-open sentence: *"every repair commit needs the same in-tree run again (round 46's and round 47's included); the last in-tree run is `e7c192a`"*, and the round-47 VALIDATION, which repeats that the last in-tree run is `e7c192a`. Round 47's repairs changed `scripts/` (`core-watch.mjs`, `core-watch-suite.sh`, `validator-lock.sh`, `cron-install.sh`, `readme-facts.mjs`, `run-tests.sh`) and `bank/selftest.mjs` — exactly the tree item 53 exists to re-prove. Meanwhile the launch gate (SPEC gate 3, ruling of 2026-10-08) is defined by (a)-(d) alone.

**Why it matters.** Item 53's own text says it "must be done before anything mints"; the gate that decides launch does not name it. A launch decision taken on (a)-(d) therefore ships past an OPEN AND BLOCKING item, and the thing it protects is not decorative: the in-tree run is the only proof that the *shipped* runner, with its new `validator-lock.sh`, its new `dist/` guard, its new readme-facts check and the rehearsal tree's id substitution, still passes end to end at throwaway ids.

**Evidence if I am right.** `git diff --name-only e7c192a HEAD -- bank scripts` is non-empty; SPEC item 53 and `audits/round47/VALIDATION.md` both name `e7c192a` as the last in-tree run.

**Fix.** Run `./scripts/run-tests.sh` inside a tree made by `scripts/rehearsal-tree.sh` at the final commit and record the log with the release (the round-46 flow at `e7c192a` is the template), **or** record an explicit owner ruling that the in-tree run is not required at the final commit, with the reason. Do not let the (a)-(d) gate silently absorb it.

---

## R6. The gates — assertions that cannot fail, floors satisfied by deleting work, vacuous empties

- **Floors are equalities everywhere except F1.** On-chain `913`, detectors `1081`, web `805` (per-file floors in `run-all.mjs` summing to exactly 805, enforced again by `WEB_FLOOR`), allocation `39`, poster `24`, launch `69`, PoB `14`, host `6`, mainnet `35`, expiry `4`, swap `16`, sim `71`; `floor()` uses `-eq`, `bank/selftest.mjs` compares `R.length !== FLOOR`, `sim/swap-fork.sh` compares `"$T" -eq "$SWAP_FLOOR"`, `tests/expiry-budget.mjs` asserts its own count. The only test with a both-ways table and no count check at all is the Core watch's.
- **Vacuous-when-empty:** I walked every `.filter(…).length === 0`-shaped arm in `bank/selftest.mjs`. Each one I found that could pass on an empty input has a companion non-empty arm in the same block: the control-table reader (`block.length >= 5`), the DAS-reader discovery (`dasFiles.includes('alarm.mjs')`), the wiring gate (`V6_WIRED` must contain eight named detectors, and cutting any one call names exactly it), the label gate (`emitted.length > 60`), the signer set (a planted third signer and a revived retired key), the seed gate (`Object.keys(L.SEEDS).length === 12`), the SPEC-count gate (`found.length > 0` and an every-occurrence reader), the FLOOR pair (`selftest.mjs` vs `run-tests.sh`), and the four Core-pin copies.
- **`scripts/build-mainnet.sh`** proves what it says for the four keyed programs (behaviourally, both directions, with the source check that each names `INIT_KEY`) and for the sweep helper by three-way byte identity (`dist/` == its own localnet rebuild == `target/deploy/`, the bytes the suite deployed), and its closing banner claims nothing more.
- **`scripts/cron-install.sh`** arms nothing by itself: the preserve reads our own tagged, uncommented line with the job name anchored to end-of-line; a commented line, a prose note, another project's line, a reveal lane, or a watcher line quoting the flags all arm nothing (the selftest runs the real shell). It refuses a tree carrying `REHEARSAL-RECORD.txt` before touching anything.
- **`web/test` non-vacuity.** The eleven bundled files name a property and drive it in both directions (or compare against the *extracted* suite/sim builders, so a suite change re-runs the comparison), and `run-all.mjs` + `WEB_FLOOR` make deletion loud. The three weakest arms I found all still fail when the property breaks, and are worth noting only as maintenance debt: `bundle.test.mjs`'s "ceremony is not linked from any holder page" matches the bare substring `ceremony` (false-positive-prone, not vacuous); `mine.test.mjs` pins a false negative as correct ("chain listing down + DAS empty → found-none, not a failure" — it can fail if the code reported `unlisted:true`); and `ceremony.test.mjs`'s V44-1 arm name still says "the box signs" for a key that is now Gary's. I could not read `ix.test.mjs`, `get.test.mjs` or `proxy.test.mjs` (they ride in the programs pass) — the 805 total is consistent with the eleven floors I could see, which is not the same as having read the other three.

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?** No, for every limit I could check against this tree. The ones I probed hardest and found honest: 10 (the operator's bound is cap × cooldown windows, the docs' ~34 SOL/day is the *conservative* reading of the hourly job's clock skew, and the tighten bounds are correctly described as bounds on a vote, not on the launch values); 25 (a lapse needs *nobody* to capture for the whole window, and the docs say so); 26 (the last contributor grinds, quantified as best-of-4 and "more"); 27 (a claim between a bare burn and its retirement pays a dead vault, and the crank retires first — the cost is stated); 28 (a redemption during a freeze forfeits the undelivered share, and an *explicit* `distribute` is not refused for a frozen pool, which the pool section states); 32 (the 64-slot ring makes the cap stricter above 3,047 live); 41 (transfer is unlimited); 46 (the alarm samples the collection once per pass, so an add-and-remove is invisible); 55 (the unsplit edge, with the crank bounding it hourly); 59 (a prefunded address fails one attempt, and `checkNewAddress` is the page-side answer). The one place a stated *number* is loose in the safe direction is the crank's `REVEAL_RENT_LAMPORTS` (16 × 6,960 = the test validator's rate, not mainnet's 5,080/byte) — it over-reserves, never under.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?** I found none, and two candidates worth recording as *narrower* than the prose around them:
- **Limit 8** ("a false CRITICAL that a human must close by hand"): `rememberRedemptions` now persists a confirmed burn's evidence across passes, so the *later* pass does not re-raise it — the cost really is one CRITICAL per mis-ordered redemption, exactly as the limit says, and nothing retracts it.
- **Limit 6** (an aborted `flock` run is indistinguishable from one that never fired, *in the log*): the jobs' own in-process locks page on `ELOCKED`, but under `flock -n` the job is never started, so the flock-level abort is still silent at that layer — the limit stands, and limit 7's `crank_silent`/deadman is what eventually catches it.

**3. Is any DISCHARGED item not actually discharged?** No. I checked each against the code I hold: 12/17 and 54 (the crank sends each capture/reveal as its own transaction; a claim batch is ~4,000 CU per vault against the per-instruction default; the pages must set their own limit, which they now do — V47-4), 14 (`DuplicateAttribute` in both mint paths), 19 (`activate` refuses `NotRevealed`, so no activated vault is unlevelled), 30 (`split_bps`, both destinations and `max_supply` written once; no `update_wiring` exists), 31 and 33 (the period and the notice are `initialize` values, exercised at short values), 51 (owner-only boosts, `reweigh`/carry, `expire_boosts`, the crank's pre/post expiry, the alarm's `boosts_stalled` and fixed ceilings — and its two residues, N-distributions-not-months and the timing disclosure, are stated), and the whole v5-with-the-Bank family (the files are gone and nothing imports them).

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** One, and only one: **item 53** (F3) — it is stated as open, but the gate that decides launch does not name it, so a decision taken on (a)-(d) alone would ship past it. Items 22, 38, 50 and 52 are genuinely open and honestly described: `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline` and `vault_collection` null and `scripts/check-launch-params.mjs` refuses them; item 22's FAIL is recorded as a true detection and accepted by ruling, with only the 2,100-vault scale left; item 50's pages are built and staged, and the holder guide is marked DRAFT so it cannot be published first; item 52's accounts are created idempotently at road step 10 and both absences page.

---

## Anything else

- **A gate-5 recommendation, not a finding:** `judgeSwapInstructions` pins the venue program, the pool, the operator's in/out accounts, the wrap, the sync, the close, the amount, the floor and (for Orca) the direction and price limit — but not Orca's `token_vault_a`/`token_vault_b`/tick arrays nor Meteora's reserves/mints/oracle/token programs/bin arrays. Its docblock justifies that with "the venue program validates its pool-owned liquidity accounts", which I cannot verify from this tree (no IDL is bundled). The cheap, decisive test is one fork arm that swaps the two vault keys in the built instructions and asserts the real program refuses; if it does not, pin them. Two things make this a recommendation rather than a finding: reaching it needs a changed builder (limit 10(c)), and a *layout* misread of the vault offsets produces a refusal (the accounts would hold the wrong mint), not a misroute.
- **`web/test/mock-rpc.mjs`** now models the page's listing and the adversary hook on the right call, and its `simulateTransaction` credits the vault's reserves the way the sweep would; I found no way for it to make a page test pass that the real page would fail.
- **The `queued`-forever wedge in F1** is the only silent stall I found in the new Core-watch code; everything else in it either pages, restores, or refuses.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

Concrete, in the order I would do them:

1. **Close or rule on the five OPEN AND BLOCKING items in writing, each with its holder-facing cost, and make the launch decision name them.** An AI round can prove a rule holds; it cannot decide that a 2.1%-per-hour queue, an unpublished redeem page, or an unproven 2,100-vault crank is acceptable. Write the sentence for each: "we launch with X because Y", signed and dated, and put the same sentence in the holder guide's honest list. Then fix the gate text so (a)-(d) plus those rulings is the whole gate — right now item 53 sits outside it (F3).
2. **Run the shipped runner inside a recorded rehearsal tree at the final commit, and archive the log with the release.** This is the only proof that the tree that ships (validator lock, `dist/` guard, readme-facts check, id substitution) still passes end to end. It costs one command and it is the item that has been open longest for the least money.
3. **Do one real, small, end-to-end redemption on mainnet with the published page, before any sale opens** — a real charter vault, real cbBTC/$GARY/$GIRAFFISH, the page, the sweep helper, the burn, and the transaction published. Nothing else proves the *client* contract (item 50's prior-transaction rule, the standing consent, the compute budget under a real wallet) against the real chain, and after step 11 it cannot be changed.
4. **Restore the backups on a machine that is not this box, and hand the runbook to a second person.** The deploy authority, the swap operator and the $CBOB release wallet are single hot keys on one host, and limit 10's hand recovery is a written procedure nobody has executed from the text alone. A restore drill and a read-aloud runbook walkthrough (item 22.4's forced failure) are exactly what an AI audit cannot do.
5. **Add one monitor that does not live on this box.** The alarm, the crank, the revenue job, the ledger and the router share a user and a host; a third-party uptime check on the alarm's heartbeat (or a daily "watched and green" digest sent from a different provider) is the only way a human learns the watcher died while it is still dead. Nothing in this tree can prove that, and immutability makes silence expensive.
6. **Re-run `sim/swap-fork.sh` on launch day and archive it.** The swap's only proof against the real programs is a fork of a specific moment; Orca's tick arrays and Meteora's bitmap are live-market state. It costs 16 assertions and it is the difference between "proven on 2026-10-05" and "proven at launch".