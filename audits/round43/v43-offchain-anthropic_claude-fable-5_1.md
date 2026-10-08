# Round 43, OFF-CHAIN pass — independent audit of the whole tree

**Method and its limit, stated first.** I read every bundled file whole and reasoned against the MINT and SWEEP source. I ran nothing: no validator, no selftest, no fork, no RPC. Every claim below therefore names the evidence a run would produce, so it can be checked. Where I could not establish a defect from source alone, I say so rather than file it.

**Bottom line.** I found **no CRITICAL, HIGH or MEDIUM defect**, nothing that moves or miscredits value, and nothing that stops or wrongly refuses a holder's crack. I found **three LOW defects in the fixable layer** (two in tooling/gates, one in the alarm) and a set of INFO items. One of the LOWs is a **regression introduced by round 42's own repairs**: the certified test runner can no longer pass inside the dress-rehearsal tree, which makes OPEN AND BLOCKING item 53's required re-run impossible as the scripts stand.

---

## R0. Round 42's verdict and repairs

**C01 (reserve baseline after a shrunk index).** The repair is in `bank/alarm.mjs`: `judged = setChange.trustCurrent ? vaults : [...new Set([...vaults, ...(prev?.vaults||[]).filter(v => !burntSet.has(v))])]`, `legs` are built from `judged`, `pdaOf` is filled for every judged vault, and `next.vaults` still keeps the stored set. Read against the extracted-block arm (R42 C01, three passes), the repair holds for `balances` and, through the same `legs` loop, for `vault_account_frozen` (so the `frozen` baseline no longer flaps either).

**Residue at a sibling site of the same shape (LOW-2 below).** The verdict asked for a drift sweep of "every other alarm baseline written next to `vaults`". The per-pass *working sets* were not swept: `pdas`, `atas` and `assets` are still built from `[...vaults, ...burnt]` and `vaults` (the short list), not from `judged`. During a shrunk pass the transaction detectors run with those sets, and the cursor advances past what they looked at.

**C06 (Pyth exponent):** bounded in both `readPyth` and `oracleFloor` (`PYTH_EXPO_MIN/MAX`), arm pins int32 extremes, ±1, and the three accepted values. Holds.
**C08 (fee labels), C09 (`OPERATOR_FLOOR`):** derived from the crank's template / revenue source. Holds.
**C10 (`RELEASE_COMMIT` diff in `run-tests.sh`), C26 (`WEB_FLOOR`, `E2E_FLOOR`):** present and correct for the production tree — and together they are the regression of LOW-1 below.
**C13:** measured 182,355 CU with inline capture, under the default budget; consistent with the crank sending reveals alone.
**Rejected claims re-tested from source:** C05 (`rememberAttempt` returns on no signature; the row stays open and the state-derived sweep check pages), C15 (System `create_account`/`allocate` need the new account's signature; dust is the only unsigned act), C19 (`JoinWaitingFirst` precedes credit), C21/C23/C24 (mechanisms accurate, loud direction) all stand as dispositioned. The round-42 recommendations C21 (the below-floor warning still says "kept the floor for later passes" when nothing is kept) and C24 (a zero-balance undeclared account's text still says "destroyed unless someone declares it") were **not** applied; INFO.

---

## R1. The crank (`bank/crank.mjs`)

I walked `planCrank` against MINT's `distribute`, `claim`, `activate`, `expire_boosts`, `retire_burned`, `reveal_level` and `split_revenue`, and the send order in `main()`.

* **Order vs the in-line monthly run.** Join batches (`claim` with pending pairs) run `monthly_inline` first; while any eligible vault is unjoined it logs `WAITS_FOR_JOINS` and does nothing, so the explicit `distribute` that follows is the first credit. Expiries before, split, distribute, expiries after, activations, claims: no host runs the month before the plan intends. Consistent.
* **Denominator and owed sats.** `w = total_active_weight + preJoinWeight − retiringWeight − expiringWeight` equals what MINT will hold after the sends land; a pre-joined vault's delivery uses `debt = W × acc_old` (matches `join`), a pre-expired vault's uses `carry = owed_at_expiry, debt = W × acc_old` (matches `reweigh`), and `retiringOwed` is subtracted before `available` (matches `retire` returning the pending share). I found no divergence from `owed_of`, `credit`, `ceil_sats`.
* **Dead vaults.** Only `assets === 'live'` is joined or paid; `'other'` is reported and withheld, which also withholds the distribution (`JoinWaitingFirst` would refuse it). A vault burned between the read and the send is limit 27.
* **Reveal order.** Reveals walk from `revealed_total` in index order and break at the first benign refusal or skip; a stale `revealed_total` can only produce `AlreadyRevealed`, never an out-of-order send. `judgeRevealAttrs` and `attrsBorsh` match MINT's `try_to_vec()` hash, including the empty-list case.
* **Refusals that would waste fees (all loud, none move value):** a planned split refused for a null decimals read still leaves `plan.distribute` true with `splitToPool` counted, so that distribute fails `NothingToDistribute` on an otherwise empty pool and is paged as a fault (not benign, since the epoch did not move). `postExpires` are sent even if the distribute was benignly skipped; MINT skips them (`continue`), one fee.
* **Compute.** The crank sets no compute-unit limit. Captures (114,756) and reveals (≤182,355 with inline capture) are measured under 200,000; a 14-vault claim batch is extrapolated (~60,000), not measured, and a batch that also carries 14 in-claim boost expiries (a stranger's distribution landing between plan and send) is unmeasured. Failure mode is a refused batch and a page, retried next pass. INFO.

**What it can move:** nothing but fees and reveal rent; every instruction pins its destination, and the selftest pins the instruction set and the absence of any transfer. Confirmed from source.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

Fixed-forever values, the pending guardian/operator, the PoB collection's plugins and update authority, the window near full, the pool frozen/insolvent/unreadable, overdue distribution, and the five programs' upgrade authority past the lock date are all watched, and Gary's production values are asserted in `detectStandingRisks` (21% / 51% / 259,200 s, 604,800 s notice, 1 SOL / 86,400 s / 0.1 SOL, 2,592,000 s, 3,600 s). `missingWatchedKeys` makes a forgotten reader a thrown pass.

**Dangerous states read as quiet — none found that are not already stated.** The one that worries me is not a defect in the code but an **unsettled dependency, item 22.5**: `listVaults` classifies an asset as burnt only when DAS returns it with `burnt: true`. If `getAssetsByGroup` omits burned assets, then after the first redemption `detectIndexShortfall` pages `index_disagrees_with_chain` CRITICAL on every pass forever, and every honest redemption pages `vault_left_index` CRITICAL, which `correlateBurns` cannot downgrade (only `vault_burned` is in `REDEMPTION_NOISE`). That is the bare-burn detector buried under routine traffic, exactly the failure the file's own comments warn about. It is measurable **today** against any mainnet Core collection holding a burned asset; it does not need our collection. It should be measured before the freeze, because a "no" edits `bank/`.

**Routine states that page every pass (all by design or suppressed by the router, INFO):** `lock_deadline_unset` pages now if the alarm runs in production mode against the mainnet placeholders (upgradeable, `lock_deadline` OPEN), and it pages in the pre-`initialize` idle branch too (the check runs before the idle return); `distribution_overdue` CRITICAL stands beside `pool_frozen` while the pool is frozen (an explicit `distribute` is legal, so it is not wrong); `index_disagrees_with_chain` on DAS lag is the stated limit.

**LOW-3 (below): a persistently unreadable transaction stalls one program's scan for good and re-pages one-shots every pass.**

---

## R3. The layouts (`bank/layout.mjs`)

Field lists equal the Rust structs (checked field by field against the bundled MINT source for `MintConfig` and `VaultRecord`), `parseRustStruct` is strict, every `OFF_` constant any program pins is scraped and compared (and a scraped-but-uncompared one is named), versions and `BOOST_RING` are scraped, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are evaluated from the Rust less padding. A struct change would turn the selftest red in several independent arms. **Round 24 D6:** the seed assertion now exists (11 of 11 scraped from the `*_SEED` constants, with a mistyped/unmapped control). One gap, INFO: the arm proves layout → Rust, not Rust → layout; MINT's `RESCUE_SEED` is not in `layout.mjs` (nothing in `bank/` derives it; `web/` has its own, tested).

---

## R4. The money arithmetic (`bank/accrual.mjs`)

`credit`, `pendingScaled` (= `owed_of`: `(W+boost)·acc + carry − debt`), `reweigh`, `ceilSats`, `available`, `debtAtActivation` equal MINT line for line; the crank's three owed branches reproduce `join`, `expire_boost` and `claim`. The crank expires due boosts before and the newly-due ones after its distribution; `boosts_stalled` pages; `cbob_mint`, `max_boost_weight`, `max_boost_epochs` drift as CRITICAL. No divergence found.

---

## R5. The swap and the revenue cycle

**(a) Oracle math.** `sats = lamports·SOL/USD / BTC/USD · 1e8/1e9 = lamports·sol·10^(es−eb)/(10·btc)`; the code's `num/den` with the exponent moved to whichever side keeps integers is exactly that; both results floor (toward a lower floor, by under a sat). Exponents bounded to −18..0 since R42; BigInt throughout; `satsPerLamport` is a float used only for the deviation filter, where 1e‑16 relative error is irrelevant against 100 bps. The 150 bps floor covers Orca's 16 bps fee plus impact; SW.8 measured the 10 SOL cap landing.

**(b) Pyth.** Offsets recomputed: `PriceUpdateV2` = disc 8, write_authority 32, verification tag at 40 (Full = 1), feed id 41..73, price 73, conf 81, expo 89, publish_time 93; minimum 101. The sponsored account is derived `[0u16 LE, feed_id]` under the push-oracle program and must be owned by the receiver. Only the push-oracle PDA can write it, and the push oracle refuses an update whose `publish_time` is not newer than the stored one, so nobody can post an *old* or *chosen* price there; a *newer* fully-verified price needs Wormhole guardian signatures. `readPyth` does not check `write_authority`, which is fine only because `market()` reads the derived address; keep it that way. The age is judged against the Clock sysvar read in the same RPC batch; that RPC is limit 10(b).

**(c) Deviation filter.** `orcaSpot = (sqrt_price/2^64)^2` is B per A in base units with A = wSOL, B = cbBTC: sats per lamport. `meteoraSpot = 1/(1+bin_step/1e4)^active_id` inverts the DLMM's Y-per-X (lamports per sat) with X = cbBTC, Y = wSOL. The selftest fixture (bin 15, id 5920) reproduces ~1.4e‑4 sats/lamport, consistent with $120/$85,929. Right quantities, right direction.

**(d) Minimum out.** `minSats` (u64 sats) rides as Orca's `other_amount_threshold` and Meteora's `min_amount_out`; both venues price out in cbBTC base units. It is the floor of the **second** market read (`m2`), the same read whose deviation filter chose the venues. Same floor, same units.

**(e) The judge.** It checks the exact seven-instruction sequence, output account (key 5), direction and price-limit bytes, amount and floor, no compute-unit price, each ATA create's payer/owner/mint, one wrap of exactly `lamportsIn`, one close back to the owner. What it does not check are accounts the venue program validates itself (tick/bin arrays, reserves, oracle, event authority) and Meteora's `host_fee_in` (key 9): a tampered builder could pass a stranger's host-fee account, which diverts a share of the *fee* the swapper pays anyway and cannot push output below `min_amount_out`. Within the stated box-owner residue; a cheap extra check is to pin key 9 to the program id.

**(f) Derivation.** Orca: `start = floor(tick/(88·spacing))·88·spacing` (negative-correct), then the two below for a_to_b; `oracle` = `["oracle", pool]`. Meteora: `floor(id/70)` and the two above for Y→X; `bin_array` = `["bin_array", pool, i64 LE]`; bitmap `["bitmap", pool]` or the program id as None; `host_fee_in` None; `__event_authority`; two Token programs. Uninitialised Orca tick arrays and a crossing past the third Meteora array are unmeasured on the fork (verdict C07); the failure is a venue refusal, which the loop handles.

**(g) wSOL.** Exact-input consumes `lamportsIn`; a pre-existing or stranger-funded wSOL ATA is synced, only `lamportsIn` is spent, and the close returns the rest; wSOL has no freeze authority; the ATA owner is the operator by construction; a System-dust ATA address is handled (R34.G2). Nothing is left wrapped (SW.1a/SW.4a).

**(h) Failure and retry.** Meteora is tried only on `refused`. A swap whose confirmation timed out is asked of the chain; `expired && no status` → refused. If the RPC's status were lagging and Orca had in fact landed, the Meteora attempt would fail at preflight for want of wSOL — **provided the operator wallet holds less than `lamportsIn` of float**, which is the stated rule D2(1) and not a code guarantee (a sweep between 0.01 and 0.02 SOL could be double-swapped from the float; the project, not holders, bears it, and the cbBTC is still returned and split). The cycle stays open until a return is proven, and until a split closes it. Limit 10's "the automatic path cannot double-swap" is true under that float rule and an honest status answer; I would add both conditions to the sentence. Orca's refusal signature is not recorded (verdict C07 recommendation, open): hand recovery after a wrong `refused` sees "every venue refused" with no pointer to the landed Orca transaction.

**(i) Extraction bound.** Per cycle, an adversary can take at most the floor's slack: 150 bps of ≤10 SOL = 0.15 SOL; at the hourly job's measured cadence (24/7, limit 10) that is ≈0.5 SOL a day and ≈15 SOL a month, and only if royalties saturate the cap (34 SOL/day). A stale-but-accepted oracle widens it by the market move inside 180 s. Pushing a $10M concentrated pool 1.2% inside one block needs capital out of proportion to 0.15 SOL; Meteora (thinner) is reached only on an Orca refusal. Immaterial beside the trusted-key bound. **Operator key worst case:** unchanged (cap × cooldown windows until the guardian stops it); what it trusts is the two pool programs' bytes and upgrade keys, the Pyth programs, and the one RPC.

**Ledger closure.** `cycleIsOpen` is the single predicate; refused rows carry `refusedSig`, never `sweepSig`; the chain scan and `sweep_unledgered_state` page a sweep no row claims. I found no path that reads a failed cycle as closed. One INFO: a **dry run** of `revenue.mjs` (the unarmed hourly cron) executes the recovery block and can `save(led)` (recording a recovered `splitSig` or `splitByOther`), so "a dry run consumes nothing" is not quite true of the ledger; the writes are chain-evidenced, and the alarm anchors them, so it is a principle breach, not a value one.

---

## R6. The gates

`floor()` demands equality; the selftest's own `FLOOR` must equal `R.length`; web floors are per file and total; SW floor 16 matches my count of `rec()` calls; no empty-input vacuity found in the stated-count, offset, wiring (`I4` pinned arguments) or kind-table arms. `build-mainnet.sh` proves the four keys by behaviour and the sweep helper's bytes by identity with the tested `target/deploy` and the control build, and refuses a dirty tree or a five-count mismatch. `cron-install.sh` arms only from its own tagged uncommented line and refuses a rehearsal tree. **One gate is now self-defeating (LOW-1).**

**Round-24 selftest section, both directions?** The detector arms are two-way. The *wiring* arms in it (`delete env.ALERT_URGENT`, `ALERT_URGENT: '1'`, `carryConfigBaseline` stored, `judgeReserveRead` per element, `applyFrozenTransitions` applied, `production: PRODUCTION` count) are presence-only regexes: they fail when the text is deleted but not when it stops doing what it says. That is the class the verdict's C27 named; I add nothing new.

---

## web/test: can each test fail when its property breaks?

Judged from the bundled sources (not run; `e2e-localnet.mjs` is not bundled, so its 132 arms are unjudged):

* **`plan.test.mjs`, `get.test.mjs`, `ceremony.test.mjs`, `proxy.test.mjs`, `ix.test.mjs`, `decode.test.mjs`, `ids.test.mjs`, `tx.test.mjs`:** the assertions are value comparisons (`diffIx`, `messageBytes`, `H.eq`) or `refuse.some(re)`/`ack.some(id)` against named ids; `opens(p)` requires empty refusals, BURN last and packet fit; controls (`diffIx` catches a flag, a byte, an account) are present. These can fail.
* **`meta.test.mjs`:** "the NFT reads fail: every vault keeps its previous file" accepts `r2.fatal || kept ≥ 3`; a fatal pass trivially leaves files unchanged, so the per-vault keep is not isolated by that arm (the property "never a wrong file" still is). Minor.
* **Presence-only page arms** (ceremony C04 secret-key regexes, V38-2/V39-1 "the page calls X", C12 "runs the check before planning"): they cannot fail when a call is present but its result is ignored. Same class as above.
* **`run-all.mjs`:** reads the harness summary off the last line and requires numerator = denominator = floor per file; a file that throws prints no summary and fails. Sound.
* **`bundle.test.mjs`:** loads esbuild from another project's tree (already stated, C02/C21).

---

## The four questions on the accepted limits

**1. Worse than stated.** *Limit 53:* worse — not only stale; see LOW-1 (the proof cannot currently be re-run at all). *Limit 10:* "the automatic path cannot double-swap" holds only under the operator-float rule and an honest status answer (R5(h)); add the conditions. *Reader coverage boundary:* the stated "the reader refuses it and scanners keep their cursors" omits the permanence (LOW-3).

**2. Not actually a limit.** None found overstated. *Limit 8* is narrower than written since round 28: instruction evidence is remembered across passes (`rememberRedemptions`), so only the DAS-before-walk order still false-pages; the text could say so.

**3. DISCHARGED but not discharged.** None. Item 54's crank claim is still true after R42 C13 (182,355 < 200,000).

**4. OPEN AND BLOCKING quietly treated as accepted.** *Item 53* is at risk of becoming unrunnable rather than merely stale (LOW-1). *Item 22.5* is being carried as a note while a "no" answer breaks two detectors structurally; it is measurable now and should be.

---

## Findings

### LOW-1 — `scripts/run-tests.sh` can no longer pass inside the dress-rehearsal tree (regression from round 42 C10 and C26)
**Construct.** `scripts/rehearsal-tree.sh` substitutes the five program ids in `programs/*/src/lib.rs` (and refuses unless all four `declare_id!` files were patched) and the root path in `scripts/`. `scripts/run-tests.sh` (round 42 C10) then runs `git -C "$ROOT" diff --quiet "$REL" -- programs Cargo.toml Cargo.lock || die "the program source differs from RELEASE_COMMIT"`, where `$ROOT` is the rehearsal worktree and `$REL` is `0b3ddb3` from `web/src/config.js`. The patched `declare_id!` lines make that diff non-empty, so the runner dies at step 6 in every rehearsal tree. Independently, round 42 C26 added `node web/test/run-all.mjs` to the same runner; `web/` is outside the rehearsal substitution list (`git ls-files -- programs bank scripts tests sim launch Anchor.toml`), so `web/src/config.js` keeps the mainnet ids, hashes and release commit, and `ids.test.mjs` ("config mainnet program ids == bank/layout.mjs PROGRAM_IDS", "programBytes == dist/", "dist/ is a CLEAN build of the release commit") fails against the patched `bank/layout.mjs` and the rehearsal's rebuilt `dist/`.
**What is lost.** Item 53 ("the FULL `scripts/run-tests.sh` passes inside the rehearsal tree … must be re-run at the release commit") is OPEN AND BLOCKING and cannot be discharged with the scripts as they stand; the rehearsal-tree proof forbids editing the runner inside the tree (the reverse map must recreate HEAD).
**Evidence if true.** `scripts/rehearsal-tree.sh ~/cbob-rehearsal && cd ~/cbob-rehearsal && ./scripts/run-tests.sh` ends `FATAL: the program source differs from RELEASE_COMMIT 0b3ddb3…`; with that line removed, `run-all.mjs` prints `XX ids.test.mjs`.
**Fix.** In `run-tests.sh`, when `$ROOT/REHEARSAL-RECORD.txt` exists, print that the release-commit check and the web offline/e2e gates are **skipped because this is a rehearsal tree** (never silently), and keep them mandatory otherwise; or extend `rehearsal-tree.sh` to patch `web/src/config.js` ids and relax its byte/commit pins under the same marker. Add an arm in the selftest/coverage script that runs the rehearsal engine on a fixture and asserts the runner's gating logic recognises the marker. This touches `scripts/`.

### LOW-2 — During a shrunk-index pass the transaction detectors still use the untrusted short list (residue of round 42 C01)
**Construct.** `bank/alarm.mjs`: `const pdas = new Set(), atas = new Set(), assets = new Set([...vaults, ...burnt])`, with the loops over `[...vaults, ...burnt]` and `vaults`, run before and independently of the C01 `judged` set. When `setChange.trustCurrent` is false, every vault the index omitted is absent from `pdas`/`atas`/`assets` for the rest of that pass, and the walk's cursor advances past the transactions it scanned.
**What is lost.** In that pass: a top-level Core `BurnV1` of an omitted vault is not named `bare_core_burn` (the next good pass still raises `vault_burned` from the set reconcile, so detection survives, the route does not); an `approve` by an omitted vault's PDA, or a non-ATA token account created for it, is a one-shot the cursor never revisits (the daily reconcile covers the latter; the former needs a thawed vault, so it is close to unreachable). No value moves. A silent hole in a backstop, the same class and size as C01.
**Evidence if true.** Extract the block from `const pdas` through the walk as the R42 C01 arm does; feed a shrunk `vaults`, a stored set containing V5, and a transaction with `[12, 0]` data to Core on V5: `detectBurns` returns `[]`; the same with the full list returns `bare_core_burn`.
**Fix.** Build `pdas`/`ataOwner`/`atas`/`assets` from `judged` (and `[...judged, ...burnt]`) instead of `vaults`; add the extract-and-run arm above, shown red at HEAD.

### LOW-3 — One persistently unreadable transaction holds a program's scan forever, hides all later traffic beyond 2,000 transactions, and re-pages one-shot findings every pass
**Construct.** `bank/alarm.mjs` walk: when `readParsedTransaction` throws or returns null, `unread++`, `tx_unreadable` HIGH, and `if (!unread)` skips every cursor **and backlog** write. The next pass re-walks from the newest signature to the old cursor (or from the old `backlog.before`), re-reads the same window, re-hits the bad transaction, and again persists nothing. Once more than `PER_PROGRAM_READS` transactions sit above the stuck point, each pass reads only the newest 2,000 (or the same 2,000 under `before`), so the transactions between are never examined, and the one-shot detectors (`approve`, `bare_core_burn`, `reveal_rescheduled`, `claim_deferred_frozen`, `unledgered_sweep`, …) in the re-read window are re-emitted with a new pass stamp, i.e. a new URGENT email every 30 minutes (`looked.eventSigs` is per pass; `deferredSweeps` are pushed again and not deduplicated on the way in).
**Reachability.** A stranger cannot easily craft a refusal in `validateParsedTransaction` (every system/token parse carries the required fields); the triggers are an RPC that persistently returns one transaction malformed or not at all, or a future transaction format. Low likelihood, high persistence, and the page says "the next pass tries again", which understates it.
**Evidence if true.** The R32 L2 extracted-walk harness with `readParsedTransaction` throwing for one fixed signature across three passes: cursor unchanged all three, `backlogs` empty, and the fixture's `non_ata_token_account` finding emitted three times.
**Fix.** Treat a signature unreadable for N consecutive passes like a log gap: record it in state (level finding, cleared by a person), persist the backlog/cursor past it so the rest drains, and dedupe `deferredSweeps` on push. Document the hand step in SPEC's reader boundary meanwhile.

### INFO (no repair required for launch; listed for the fixable layer)
* **I1. Item 22.5 must be measured now** (R2 above): a "no" makes `index_disagrees_with_chain` permanent and buries every redemption under `vault_left_index`; one DAS read of any burned Core asset settles it.
* **I2. Rehearsal value set vs `detectSweepState`:** with a short rehearsal cooldown (e.g. 60 s), `cooldownSeen/2` is 30 s and the box-vs-chain skew plus send latency can exceed it, paging false `sweep_unledgered_state` CRITICALs in the rehearsal only. Set the rehearsal cooldown ≥ 10 minutes or read `startedAt` from the sweep's block time.
* **I3. Crank compute budget:** claim batches at 14, and a batch carrying in-claim expiries, are extrapolated, not measured (item 54 says so); a refusal is loud and retried.
* **I4. `revenue.mjs` dry run writes the ledger** in its recovery branch (R5 above).
* **I5. Orca refusal unrecorded** (verdict C07, open): record `refusedSig` per venue so hand recovery can see a landed Orca swap after a wrong `expired` verdict; and pin Meteora key 9 to the program id in the judge.
* **I6. `layout.mjs SEEDS` lacks `rescue`;** the D6 arm proves one direction only.
* **I7. Message text:** `budgetPlan`'s below-floor warning ("kept the floor for later passes") and `detectUndeclaredTokenAccounts`' zero-balance detail are still misleading (R42 C21/C24 recommendations not applied).
* **I8. Production-mode alarm today** pages `lock_deadline_unset` every pass (idle branch included) against the upgradeable placeholders with `lock_deadline` OPEN; correct by round 22 A5, but expect it.
* **I9. Presence-only arms** in `selftest.mjs`'s wiring checks and several `web/test` page regexes (class already stated).
* **I10. Holder guide:** every money sentence I checked is true of the code (first payout at close + 30 days; frozen pool: anyone's `distribute` still credits; 1.5% floor; 10 SOL/6 h; 2.1%/h); the present-tense page promises remain gated by item 50's "DRAFT, not to be published".

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE: what AI audit structurally cannot do, and what to do instead

1. **Run the dress rehearsal end to end, on mainnet, with real (small) money — and first fix LOW-1 so the rehearsal tree can run the certified gate.** Items 22(1–5) and 53 as written: live crank passes at scale (2,100 records), the alarm in rehearsal mode for days, **one full revenue cycle through each pool** (Orca forced to refuse once), **one forced post-sweep failure walked through the hand recovery by the person who will do it at 3 a.m.**, and the DAS `burnt` read. No reading of code tells you how Helius behaves on vault 1,900 of 2,100 or what the alert router does on a real phone.
2. **Measure item 22.5 before the freeze**, against any burned mainnet Core asset. If DAS omits burned assets, `listVaults` must change and the counter resets; better now than after a clean round.
3. **Operate the alarm against the mainnet placeholders for a month before launch** and read every page it sends. The round-42 and round-43 defects are all in "what the alarm does on the pass after an unusual pass"; only real passes produce those.
4. **Second-machine reproduction of `dist/`:** a person who is not on this box rebuilds at the release commit with the pinned toolchain and matches `SHA256SUMS`, then compares against `solana program dump` after step 9. `build-mainnet.sh` says this is the whole claim; nobody has done it off-box.
5. **Gary reads the four `initialize` transactions' decoded arguments against `launch/mainnet-init.json` with his own eyes before signing** (item 38 A6: the checker validates the JSON, not the signed bytes). The ceremony page decodes them; have the decode printed and initialled.
6. **Key custody drills, not documents:** the swap operator key, the deploy authority (`FZjLB…`: losing it before step 11 means new ids), the $CBOB release wallet, and the Moments hot wallet through the charter window. Restore each from backup once; revoke/rotate one on purpose and watch the alarm.
7. **A real holder opening on the rehearsal with a commodity wallet** (Phantom on a phone), including a stranger's dust landing mid-flow and a C5 account, by someone who did not build the page.
8. **Decide the human runbooks AI cannot certify:** who answers a `pool_frozen` page, who pulls `emergency_stop_sweep` and how fast at night, who returns a rescued vault from the Squads, who writes the log-gap watermark. Time each once with a stopwatch.
9. **Settle the two things the holder guide promises that no code does:** the redemption announcement sender and the website surface (item 50), or remove the sentence before the guide is published.

Everything above is procedure. The code I was given to read does not, as far as reasoning from source can tell, move or miscredit a single sat anywhere the programs do not already pin; the three defects I found live in the fixable layer, and one of them stands between you and the rehearsal that would prove the rest.