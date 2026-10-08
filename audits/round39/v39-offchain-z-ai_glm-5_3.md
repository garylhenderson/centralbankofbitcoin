# Round 39, OFF-CHAIN pass (carrying web/test/): audit report

Audited: the whole bundled tree (crank, alarm, detectors, layouts, accrual, swap, revenue, sigwalk, txread, lock, spl, anchor, poster, selftest, the ops/build/rehearsal/coverage scripts, the launch checker and values, the sweep helper, MINT, the five web test files plus their harness and runner, round 38's two verdicts, SPEC, HOLDER-GUIDE, DESIGN-v6, RT3).

Method note, per the standing rule: every claim below is checked against the source in the bundle, and where a claim rests on runtime behaviour I name the suite/sim/fork arm that measures it. Where I could not resolve something from the bundle I say so rather than guessing.

---

## R0. Round 38's verdict and its repairs

**C01 (LOW, the frozen-pool joins). The repair holds, at both sites of its shape, with no regression.**

- Planner site: `bank/crank.mjs` `planCrank` now has the `else if (poolOk && pool.frozen && plan.joins.length)` branch that batches the post-tick joins into `plan.claims` as join-only batches. I traced the on-chain path this produces: a `claim` whose only pairs are pending vaults runs `monthly_inline` first, which with a frozen pool returns `Ok` without crediting (MINT `monthly_inline`, the `TOKEN_STATE_FROZEN` early return), then joins each pending vault in the `r.pending` branch, which touches no token account. So the join-only claim cannot be refused by the frozen pool. The tick that precedes it is also safe from a frozen pool (`read_token` returns the balance and state without refusing on state 2; the `w == 0` tick branch never moves tokens).
- Sender site: `main()` sends exactly `plan.claims`, so the joins are sent. The unfrozen path is unchanged (joins appended to `ready`, batched with paying claims, sent after the distribute) — I re-checked the ordering against MINT's `claim` (monthly_inline runs before the pairs loop; after the crank's distribute the month is not due, so it is a no-op) and against the join arithmetic (`join` sets `debt = level_weight × acc`; the crank's `joinedNow` owed computation matches exactly).
- The arm: `bank/selftest.mjs` "R38 C01" asserts `p.claims.length === 1`, the batch carries the vault, and `Object.keys(p.owed).length === 0` — it asserts what is SENT, which is what the verdict's gate-5 obligation demanded. I re-derived the arm's input by hand (frozen pool, `w = 0`, a this-epoch requester, month due) and it reaches the new branch.
- No regression: the frozen path adds no paying claims (owed stays empty), the split is still not planned into a frozen pool (the round-24 L3 blocker check names the pool), and `planCostLamports` counts the new batches through `p.claims.length` so the fee floor still covers them.

**C02 (INFO, the `detectSweepState` JSDoc).** The comment now says "within half a cooldown" and "a missing `judgedThrough` is 0 (review 32), so the first pass judges too", which is what the code does (`Math.abs(t - st) <= Math.floor(cooldownSecs / 2)`, `from = Number(judgedThrough ?? 0)`). Matches.

**C03, C04 (INFO, documentation exception).** SPEC limit 10 now reads "at the read the swap is built from; the earlier read only decides whether to sweep at all (round 38 C03)" — verified against `revenue.mjs`, whose venue loop iterates `m2.venues` only. SPEC limit 7 now names the daily `--reconcile` and its silent stall. Both are text-only and match the code.

**Round 38's disproved claims, re-tested from source:**

- **C06 (poster permanence):** confirmed disproved. MINT's `reveal_level` assigns the level and advances `revealed_total` for a burned asset too (the `if !burned` guard skips only the Core write and the attributes check), and the crank's `revealAttrSource` returns `'empty'` for a positively burned asset, so the FIFO advances past a pre-reveal redemption within minutes. The poster's uncaught throw is transient and loud (exit 3, cursor held).
- **C07 (pre-created wSOL ATA brick):** confirmed disproved. The canonical ATA address is a PDA of the Associated Token program; only that program can create an account there, and it initializes owner = wallet with no close authority. Setting a close authority requires the owner's signature, and the owner is the operator key.
- **C10 (double swap on a lying status node):** confirmed disproved as an automatic-path defect. `classifySendFailure` returns `unknown` for an unresolvable status and `revenue.mjs` throws on anything but `refused`/`landed`, so the cycle stays open and the next run refuses at the open-cycle guard. The residue is the one-RPC trust of accepted limit 10(b).
- **C14 (post-expiry batches after a failed distribute):** confirmed. `expire_boosts` skips records not yet due, so the batch costs one fee in a pass that already pages.
- **C16 (v1 lookup-table cursor):** confirmed. v1 has no address lookup tables; the reader refuses unknown coverage and the scanners hold their cursors.

**Round 38's programs findings (V38-1 through V38-5)** are all page/SPEC/guide. V38-1 (the re-plan's item removal) is driven by `plan.test.mjs`'s V38-1 arms A1-A5, which feed `planRedemption` the re-plan shape (`noPrior: true`) with a helper stray and a late C5 stray and assert which is swept and which is left — the arm fails if the wrong item is dropped. V38-2 (the standing consent) is driven both offline (five presses with every kind of late arrival) and on the e2e validator (three presses with a stranger landing a freezable stray and a kept-close-authority account before each). V38-3 (the ceremony collection rule) is driven by the V2/B4/M2 arms in `ceremony.test.mjs`. V38-4 and V38-5 are text and read correctly in SPEC and HOLDER-GUIDE.

**Verdict on R0: every repair holds; no regression found.**

---

## R1. The crank

I looked for the four named failure classes and could not construct one that survives measurement:

- **A plan the program refuses.** Every refusal the planner can race into is either in `BENIGN` (with `mintFailureCode` attributing the code to MINT by invoke stack, so a foreign program printing the same text cannot launder it — armed in the round-27 selftest block), or is re-judged (`judgeDistributeRefusal` re-reads the config; `PoolShort` is never a race), or is a genuine fault that pages. I traced the tick path end to end: the `waitingThisEpoch` computation subtracts exactly the this-epoch requesters the pass retires (matching `retire`'s conditional decrement of `pending_this_epoch`), so `NoActiveVaults` cannot fire; `JoinWaitingFirst` cannot fire because every eligible vault is preJoined before the distribute and an unreadable eligible vault suppresses the distribute entirely. The one residual false-page I found is an `activate` refused `NotALiveVault` because a redemption landed between plan and send — one page, self-explaining, loud direction; not worth a change.
- **A plan that pays or joins a dead vault.** The claims loop skips `assets === 'burned'` and reports `'other'`; the join loops skip burned; retires are sent first. The only window is a bare burn landing between plan and send, which is accepted limit 27 verbatim.
- **A reveal out of order.** Reveals are planned strictly from `revealed_total` in mint order, the send loop breaks on the first failure and on every benign "done elsewhere" code, and the attribute hash is checked before the fee is spent (`judgeRevealAttrs`, with the pinned test vector).
- **Value moved anywhere unpinned.** The selftest's source arms pin that `crank.mjs` sends only MINT instructions and builds no transfer; I re-read `main()` and confirmed every instruction's accounts are config-derived or record addresses.

The fee budgeting (`budgetPlan`/`planCostLamports`) correctly counts the new frozen-pool join batches, keeps the floor in reserve on every branch, and truncates reveals in mint order.

---

## R2. The alarm

I looked for a dangerous quiet and a routine page and found neither beyond what is stated:

- The production value list, the WATCH drift list, `WATCHED_KEYS` and `missingWatchedKeys` are mutually consistent (the selftest drives the reader-missing case in both directions). The guardian/operator exact-value gap is limit 38's stated one, covered pre-signing by the launch checker.
- `detectSweepState`'s half-cooldown window, the smallest-ever-seen cooldown, and the direct-lookup rule for uncertain sends are as round 33 left them and as the corrected comment now states.
- The frozen-pool behaviour pages coherently: `pool_frozen` on transition (urgent) then INFO, `distribution_overdue` while a frozen pool holds undistributed sats (correct — payouts are genuinely late and the accompanying finding says why), and the crank's frozen-pool problem strings are exactly the ones `detectCrankHealth`'s `coveredFreezes` matches (the selftest drives the real planner's text). A frozen CBOBTC Squads account — the one blocker string not covered by a transition detector — correctly falls through to `crank_problem`, which is the loud and right direction since nothing else watches that account.
- `boosts_stalled`, `joins_stalled`, `launch_tick_overdue` and `reveal_queue_stalled` all require the grace to have passed and all have quiet-direction arms.

---

## R3. The layouts

I re-derived every offset by hand from the field lists and compared them against the Rust structs in the bundle: `MintConfig` (65 fields, order and types identical), `VaultRecord` (20 fields), `BurnConfig`, `GovConfig`, `SealConfig` — all match name-for-name and type-for-type. The cross-program `OFF_*` scrape-and-compare in the selftest covers every pinned constant with an explicit "none scraped and ignored" arm (round 22 L2), the seed assertion round 24 D6 demanded now exists and is driven both ways (11 of 11, plus the mistyped-seed and unmapped-seed arms), the struct parser throws on anything it cannot read as one `pub name: Type,` field (round 22 L1), and the space constants are scraped and evaluated rather than trusted (round 24 L13c). A struct edit that is not mirrored here turns the build red; I could not construct one that slips past.

---

## R4. The money arithmetic

`accrual.mjs` was compared line-for-line against MINT's `credit`, `owed_of`, `ceil_sats`, `reweigh` and `join`: identical, including the boost/carry ordering (`carry` added before the debt is taken) and `join`'s use of the level weight only (correct, since a pending vault can never carry a boost — `boost_vault` refuses `r.pending`). The crank's three owed cases (plain, preExpired, joinedNow) each reproduce the program's post-distribution state exactly, including the expiry-at-the-old-accumulator identity and the retirement freeing (`owedAfterRetire`). The crank expires due boosts before distributing and the distribution's own newly-due boosts right after; the alarm pages `boosts_stalled` and watches `cbob_mint` and both boost bounds as fixed forever. No divergence found.

---

## R5. The swap and the revenue cycle

- **(a) Oracle math:** the exponent handling is sign-correct in BigInt for both directions, the divisions floor (conservative), `satsPerLamport`'s BigInt-to-Number conversions are exact at Pyth's magnitudes (i64 prices, -8 exponents), and the selftest pins the 2-SOL expectation within a sat of the float. The floor is genuinely below an honest pool's return: the deviation gate admits a pool at most 100 bps from the oracle, the floor is 150 bps under it, leaving ≥50 bps for the fee (16 bps Orca) and impact, which the fork's SW.8/SW.9 measured at the ruled 10 SOL cap.
- **(b) Pyth:** the `PriceUpdateV2` offsets (disc 8, authority 32, level at 40, feed at 41, price 73, conf 81, expo 89, publish 93) are internally consistent across `readPyth`, the selftest fixtures, the fork's timestamp-rewriting arms and the mock. Ownership-by-the-receiver plus a derived address plus full verification plus the feed-id check plus the 180 s / 30 bps / ±30 s bounds is the strongest check available without a CPI, and the residual (a compromised Pyth guardian set) is accepted limit 10(a) as stated. The age is judged on the chain Clock; I chased the Clock-owner question and satisfied it from the fork gate, which runs the real `market()` against a real validator's Clock sysvar and passes.
- **(c) Deviation filter:** `orcaSpot` is (sqrt/2^64)² in raw cbBTC-per-lamport, `meteoraSpot` is the inverse bin power with X/Y correctly reversed, both compared against `satsPerLamport` in the same units; the selftest arms 99/101 bps on both sides of both venues through the real `market()`. Floating-point error at the boundary is orders of magnitude below the 50 bps of slack the floor leaves.
- **(d) Minimum out:** the same `m2.f.minSats` rides in Orca's `other_amount_threshold` and Meteora's `min_amount_out`, in each program's expected units, and the judge verifies the bytes.
- **(e) The judge:** it requires the exact seven-instruction sequence with the amount, floor, direction, price limit, accounts, ATA-creation keys, wrap amount, SyncNative/CloseAccount-only Token instructions and no priority fee. Its unchecked surfaces (tick arrays, bin arrays, Meteora's `host_fee_in`, the token-program keys) are all either validated by the venue program or concern only fee routing, and the on-chain floor binds the output in every case — the round 25 D1 analysis holds, and round 38's C12 (pin `host_fee_in`) remains a recommendation I echo but do not re-file.
- **(f) Derivations:** the Orca tick-array starts (current, then the two below for a_to_b) and the Meteora bin-array indexes (active, then the two above for Y→X) match the published interfaces, with boundary and negative-id arms. An uninitialised array fails the swap and the floor binds.
- **(g) wSOL:** wrap-exactly-`lamportsIn`, sync, swap, close. A pre-existing wSOL balance is preserved through sync-and-close (nothing is stranded); a frozen or delegated account can only be arranged by the operator key itself (box-owner trust).
- **(h) Failure/retry:** Orca-then-Meteora only on a refusal; an unknown outcome throws and the cycle stays open; every path leaves the ledger open until a return is recorded, and the post-swap delta check refuses to record a below-floor return. I re-traced the sweep-timeout case (intent row, `pendingSweepSig`, `cycleIsOpen` true via `intendedLamports`) and the return-timeout case (no `returnedSats`, open) — neither can be read as closed.
- **(i) Extraction within tolerance:** bounded at ~150 bps per cycle against the oracle (a sandwich must land between the read and execution and is capped by the on-chain floor), plus oracle staleness within 180 s, both disclosed in the guide's "up to 1.5% below Pyth's price, and further if Pyth's own price is off". At the ruled 10 SOL cap this is tens of dollars per cycle of royalty revenue only. The operator key's worst case is unchanged from limit 10 (cap × windows until the guardian stops it), and the ledger cannot read a failed cycle as closed (verified above and by the round 25 L3 arms).

---

## R6. The gates

- The selftest's `FLOOR = 926` equals the runner's `DET_FLOOR` and SPEC's stated count; the runner's equality-not-bound floors (`-eq`) are in place for every suite; the web floors in `run-all.mjs` sum to 618 and match VALIDATION's count (I re-counted `bundle.test.mjs`'s assertions by hand and reconciled 77).
- `scripts/build-mainnet.sh` proves all five programs (the four keyed ones behaviourally in both directions, the sweep helper by byte-identity with the tested localnet build and with `target/deploy`), refuses a dirty tree, and prints what it did and did not prove.
- `scripts/cron-install.sh` arms nothing it should not: the preserve reads only our tagged, uncommented lines with the job name anchored to end-of-line (the round 24 L12 fix, armed both ways), the rehearsal marker refuses installation, and the posture print is computed from the written crontab.
- The round-24 selftest section's both-direction arms: I re-verified the round-25 L1 judge tampers (all eight refused on both venues, with the round-24 judge shown passing them so the arms can fail), the L2 clock arms, the L3 send-classification arms, and the R38 C01 arm. I found no arm that cannot fail — with the two exceptions filed as findings below, both in `web/test/`.

---

## web/test/ — can each test fail when its named property is broken?

Gone through file by file. `decode`, `ids`, `ix`, `get`, `plan`, `ceremony`, `meta`, `tx`, `proxy` (modulo finding 2), `e2e-localnet` and `run-all` all drive real behaviour with both-direction arms and controls (`diffIx`'s control arm, the L4 fake-dist control, the README fresh-build comparison, the mock's adversary mode). Two gaps:

### Finding 1 — LOW
**`web/test/bundle.test.mjs` claims a property no assertion checks: the bundled `planRedemption` is imported and never called.**

- **Construct:** the test entry exports `planRedemption` from `../../src/lib/plan-redeem.mjs`; the docblock's property list names it ("...and the redemption plan is byte-identical"); after `const B = await import(...)`, the assertions reference `B.judgeLaunch` (three), `B.decode`/`B.encode` and `B.judgeRedemptionCoverage` — `B.planRedemption` is never referenced again.
- **What an accident gains:** if a browser shim (the injected `Buffer`/`process`, the crypto/fs/url aliases) broke `planRedemption`'s behaviour in the bundle, this test stays green. No other automated test executes the BUILT page's JavaScript anywhere: `e2e-localnet.mjs` drives the pages' library under node, and `mock-rpc.mjs` is an instrument for driving the built pages in a real browser that no automated test in this tree drives. So the docblock's claim is the only "coverage" of the bundled redeem logic, and it is vacuous — exactly the round-37 class (an arm that cannot fail).
- **Evidence:** the entry file's export list versus the assertion list in the same file; `run-all.mjs`'s FLOORS containing no browser-driving test.
- **Fix:** add one assertion comparing `B.planRedemption(ids, snap)` with node's `planRedemption(ids, snap)` on a synthetic snapshot (the `plan.test.mjs` fixtures already build one), or, better, one automated run of the built redeem page against `mock-rpc.mjs` checking its `/report` endpoint — the instrument already exists and already computes "the redemption the page SENT is byte-identical to the one planRedemption builds". Failing that, delete the claim from the docblock so the counter is not fed by a vacuous property.

### Finding 2 — LOW
**`web/test/proxy.test.mjs`'s allowlist-equality check derives "what web/src calls" from a name-based regex, so a call spelled anything but `conn.<method>(` is invisible to it in the permissive direction.**

- **Construct:** `const called = new Set([...src.matchAll(/\bconn\.(\w+)\(/g)]...)` plus the `das(profile, '...')` pattern. The headline property is "the proxy allows EXACTLY the RPC methods web/src calls".
- **What an accident gains:** today every call is spelled `conn.x(` and the equality is exact, so the test is sound. But a refactor that binds the connection to another name (`const c = conn; c.getBlockTime(...)`), or calls through `this.conn`, removes the call from `called` while leaving it out of `ALLOWED` too — the equality holds, the test stays green, and the proxy refuses the call at runtime, breaking a holder page. (The loud direction is safe: an allowed method called only through an alias makes `ALLOWED` a superset and the test fails.) The `getMultipleAccountsInfoAndContext` mapping is also absent from `WEB3_TO_RPC`, so that spelling would fail the equality as a false positive rather than silently — loud, but a trap for the next reader.
- **Evidence:** the regex in the file; the test's own refusal arms showing `getBlockTime` is deliberately not in `ALLOWED`.
- **Fix:** derive `called` from the built bundle's references where feasible, or at minimum add the `...AndContext` mapping and a second pattern for common alias spellings, and state the derivation's limit in the file.

---

## The four questions on the accepted limits

1. **Is any limit worse than stated?** No. I attacked the swap tolerance (bounded at 150 bps plus oracle staleness, both disclosed), the frozen-pool behaviours (all stated, and the C01 repair closed the last gap between limit 28's text and the crank), limit 27's dead-weight window (unchanged, and the crank's filters match the stated mitigation), and limit 10's throughput arithmetic (the hourly-cron/chain-clock cadence and the ~34 SOL/day figure are consistent with the code).
2. **Is anything listed as a limit not actually a limit?** No. Limit 7 now names the reconcile lane (the C04 repair), so the "three jobs" undercount is closed.
3. **Is any discharged item not actually discharged?** No. Item 54's compute measurements are backed by the expiry-budget gate (real MINT execution of twenty due boosts under the default budget) and the suite arms; item 51's boost is built, mirrored and armed in both directions.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52 and 53 are all still open and behaving as open: `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline` and `vault_collection` OPEN and the launch selftest refuses while any is; the pages are staged, not published; the rehearsal value set and the launch checker's rehearsal mode named by item 53 are still not written (the ceremony page's `judgeRehearsal` is a page-side bound for the localnet e2e, not that obligation).

---

## Anything else

- The `holder guide`'s promises were re-read against the code: the sweep-at-execution promise, the standing consent's exact wording ("anything that arrives after the page's last check is lost"), the frozen-pool forfeit, the boost rules, the honest list's swap-bot and $CBOB custody entries, and the charter-window hot-key entry all match the code and SPEC. I found no sentence that misstates holder money, rights or program behaviour.
- `bank/txread.mjs`'s v1 handling, the truncation-gap opt-in, and the backlog-drain proof were re-checked against the consumer harnesses in the selftest; I could not construct a path that loses a CBOB event silently or advances past something it should not beyond the stated boundaries.
- One measurement limit of my own: I did not execute anything. Every conclusion above is from source plus the recorded runs (895/895 on-chain, 926/926 detectors, 16/16 fork, 618/618 web offline, 113/113 web e2e) whose arms I read. Where a claim of mine rests on source alone I have said so.

**Result: NOT CLEAN (0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW, both in `web/test/).** Round 38's repairs all hold; the two findings are test-layer gaps, one of them the exact cannot-fail class this round was asked to hunt.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the dress rehearsal with real money and read it yourself (item 22).** No AI round can observe the crank against a live cluster's rate limits, a transient RPC error at vault 1,900, the reveal lane keeping up, or a real revenue cycle through both pools with real depth and real Pyth sponsors. The fork clones state, not contention. Items 22.1-22.5 are already named; the person who runs them must personally read the ledger rows, the signatures and the `--audit` output, not just check exit codes.
2. **Verify the deployed bytes on mainnet with your own hands and a second machine.** The prefix-hash-and-zero-tail checks at steps 9, 10 and 11 are procedures. Rebuild from the release commit on a machine that is not this box and confirm the sha256s independently — every verification in this tree runs on the same host that holds the keys, and a compromised box makes local proof worthless.
3. **Make the key custody decisions physically.** The $CBOB release wallet, the swap operator key, the deploy authority and the PoB hot wallet are operational facts no audit can verify: move the $CBOB supply off the box (limit 56 names this as Gary's call), confirm the swap operator wallet holds nothing but its float, and decide deliberately whether the PoB key stays hot through the charter window knowing exactly what limit 46 says it can do.
4. **Have a human read the four `initialize` transactions against `launch/mainnet-init.json` before signing (limit 38's A6).** The checker validates the JSON, not the transaction. Whoever builds them must build them from the file, and a second pair of eyes should diff the transaction arguments against the ruled values.
5. **Drill the alert path end to end.** Fire a test CRITICAL through the router to the phone that will receive it, and confirm a human notices and can act within the windows the accepted limits assume (the guardian stop for a swap-key theft, the charter-window response for a PoB hook). An alarm whose pages nobody reads is a green report.
6. **Settle the DAS burnt-flag question (item 22.5) and the charter dates.** Both are one-off human acts; the first is a single read, the second is Gary's decision that everything else (lock deadline, first-payout timing, the guide's opening section) is waiting on.
7. **Decide who the second roster is and keep the freeze honest.** The clean-round gate requires two consecutive clean rounds from different model rosters; that is a process discipline no audit round can impose on itself. Until then the counter is 0 of 2 and nothing should mint.
8. **Accept that the residual is yours.** The swap tolerance, the oracle trust, the Core upgrade risk, the custodial-key exposure and the immutability of any surviving bug are all written down precisely so that the person launching consents to them knowingly. Read the honest list in HOLDER-GUIDE once more as the person who will own it, not as the person who wrote it.