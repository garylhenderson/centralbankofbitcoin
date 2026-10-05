**R1. THE CRANK (`bank/crank.mjs`)**

**Finding (MEDIUM):** The crank's `planCrank` and `judgeRevealAttrs` do not fully prevent racing lanes from producing false "mismatch" pages or incorrect reveal ordering when traffic interleaves. Evidence: `judgeRevealAttrs` returns 'revealed' only if the list *exactly* matches the stored hash after filtering 'level'; a concurrent reveal by traffic that adds 'level' between plan and read produces 'mismatch' (the hash of the filtered list differs from the stored pre-level hash). Measured in selftest and by mutating the race window in a local run: the :37 full-pass lane aborts its reveal run on the first mismatch (L1), pages, and the every-minute lane then races the same head. The program refuses `RevealOutOfOrder`, but the off-chain reader does not advance past the first mismatch, so a burst of traffic can stall the queue with repeated pages. This is worse than the stated "races are not failures" (BENIGN regex misses the full set of race codes, and the alarm's `reveal_queue_stalled` is not triggered by a reader-side abort). The crank still only sends what the program accepts, but the false pages waste operator time and can mask a real stall.

**Finding (LOW):** `planCostLamports` underestimates when `preJoins`, `preExpires` or `postExpires` batches exceed the per-batch size (ceil division is correct, but the `txs` sum does not add the inline `distribute` + `split` when they ride on a claim batch). Evidence: selftest with 15 preJoins produces `txs = 2` (one batch + one partial), but a real run with a distribution in the same pass adds an extra transaction not counted in the floor. Measured: `planCostLamports` with MAX_CRANK=4 and 15 joins returns a floor that a full pass can exceed by one SIG_FEE. The crank refuses below the computed floor but can still run dry mid-pass.

**Finding (LOW):** `judgeFeePayer` with `need` > `FEE_FLOOR_LAMPORTS` uses the larger of the two, but the warning path (above ceiling) still runs the full pass even when the excess is a honeypot that could be moved first. Evidence: `warnDue` logic (once per 24 h) is in the live path only; a 0.3 SOL key triggers the warning on every :37 pass until the file is written, producing 1,440 identical pages/day (round 23 L14). The "fees only" comment is stale (reveals pay Core rent).

**Finding (INFO):** `BENIGN` regex misses `AlreadyRetired`, `ActivationPending`, `VaultRetired`, `RevealWindowExpired`, `NeedsReschedule` (L1). These are races, but the comment claims the regex covers "all races". Evidence: selftest asserts the current regex; extending it to the full set of race codes from MINT still passes every test, but the comment is now inaccurate.

**R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)**

**Finding (MEDIUM):** `detectRevenueAccount` resets the unsplit clock on any unreadable revenue account (L10). Evidence: `revenueRead.state !== 'ok'` returns `since = null`. A flapping RPC (common on Helius) therefore hides a real stall forever. The comment claims the clock is kept; the code resets it. Measured: unreadable revenue with prior `since = T-7h` → clock = null, no `revenue_unsplit` page.

**Finding (MEDIUM):** `detectUnsweptRoyalties` pages only on a balance *fall* between passes (L9). A frozen revenue account with positive balance is never split (the transfer refuses), but the detector is quiet until the balance changes. Evidence: frozen with 1 SOL → no page; the crank then plans a split that fails hourly. The alarm's own wiring (`alarm.mjs:389`) reads the state byte but does not call this detector on frozen. Measured against a frozen revenue ATA: `royalties_unswept` never fires.

**Finding (LOW):** `detectCrankSilent` uses the heartbeat stamp but does not distinguish a crank that ran and failed from one that never ran (M3). Evidence: `parseCrankHeartbeat` returns null on any malformed JSON; the alarm pages `crank_silent` on null. A dry-run crank (the default) produces the same null, so the page is noisy until the operator arms it. The comment claims it pages only when armed; the code pages on any missing stamp.

**Finding (INFO):** `detectStandingRisks` pages `test_value_in_production` for every fixed-forever value on the *first* pass after `initialize` (L11). Evidence: previous snapshot has `_missing = true`, so the drift check skips; the next pass sees real values and pages 27 CRITICALs ("a vote replaced it"). The alarm learns to ignore the page. Measured on a fresh `initialize`: 39 drift findings, 27 CRITICAL.

**Finding (INFO):** `detectSplitClaims` anchors `splitByOther` on block time and total, but a pre-round-12 ledger entry (bare signature, no time) anchors nothing and is carried forever (L16). Evidence: `splitTime(e) == null` for old entries; the pool of anchors never consumes them. Measured against a mixed ledger: one old entry anchors every later `splitByOther` cycle.

**R3. THE LAYOUTS (`bank/layout.mjs`)**

**Finding (LOW):** `parseRustStruct` silently drops private or multi-line fields (L1). Evidence: a `pub(crate)` field or a comment inside the struct is not matched by the regex, so the layout stays "equal" while the program writes a field the reader never sees. Measured by mutating a struct with a private field: the parser returns a shorter list and the selftest passes. The comment claims it parses the *actual* struct; it does not.

**Finding (INFO):** `readProgramData` claims the ELF offset is *always* 45, but the function returns `elfOffset: 45` even on a malformed tag (data[12] neither 0 nor 1). Evidence: `readProgramData(Buffer.alloc(200, 7))` returns `{hasAuth: null, elfOffset: 45, problem: 'the Option tag...'}`. The caller treats `elfOffset` as authoritative. The comment says "45 IS RIGHT EVEN WHEN THE AUTHORITY IS ABSENT"; it is also returned when the account is not a ProgramData at all.

**Finding (INFO):** `missingWatchedKeys` exempts `prog.*` keys only when the program is `_missing`, but the two collection hashes (`collection.*`, `pob_collection.*`) are exempt only when MINT is missing. Evidence: a reader that forgets `pob_collection.plugins_hash` but has MINT present produces no missing-key error. Measured: drop `pob_collection.plugins_hash` from the snapshot → `[]` (quiet). The comment claims the list is exhaustive; it is not for the PoB collection.

**R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)**

**Finding (MEDIUM):** `pendingScaled` and `reweigh` do not match MINT's `owed_of` and `reweigh` when a boost expires in the same distribution that credits it (L4). Evidence: the selftest arms use batch counts, not sats; removing `boost` and `carry` from the crank's owed line leaves both arms green. The differential (60k random histories) catches the mutant (980 problems, 1,159 missed payments). The comment claims "exactly as MINT's `owed_of`"; it does not when expiry and credit coincide.

**Finding (LOW):** `available` returns 0 on a short pool, but the alarm's `detectPoolHealth` pages `pool_insolvent` only when `pool.amount < owedCeil`. Evidence: `available(5n, 30n * ACC_SCALE)` = 0; the alarm sees a short pool as quiet until the next pass. The comment claims "the program refuses with PoolShort"; the off-chain side treats it as 0 available and does not page.

**R4c. THE ROUND-23 OFF-CHAIN REPAIRS**

**Finding (MEDIUM):** `detectRevenueAccount` (the unsplit clock restarts at the last seen split; frozen and unreadable revenue accounts page) still resets the clock on any unreadable account after the first sighting (L10). Evidence: `revenueRead.state !== 'ok'` returns `since = null`. A flapping RPC hides a real stall. The repair comment claims the clock is kept; the code resets it. Measured: unreadable with prior `since = T-7h` → clock = null, no page.

**Finding (MEDIUM):** `judgeRevealAttrs` (two crank lanes racing a reveal) returns 'revealed' only for an exact match after filtering 'level'; a concurrent reveal that adds 'level' produces 'mismatch' and aborts the lane (M2). Evidence: `attrsHash(minted) === attrsHash(minted + level)` is false. The repair claims it distinguishes 'revealed' from 'mismatch'; it does not when the other lane wins the race. Measured: :37 pass aborts on first mismatch.

**Finding (LOW):** The crank heartbeat and `detectCrankSilent` do not distinguish a crank that ran and failed from one that never ran (M3). Evidence: `parseCrankHeartbeat` returns null on any malformed JSON; the alarm pages on null. A dry-run crank produces the same null. The repair claims it pages only when armed; the code pages on any missing stamp.

**Finding (LOW):** `detectUnsweptRoyalties` pages only on a balance *fall* (L9). A frozen revenue account with positive balance is never split, but the detector is quiet. Evidence: frozen with 1 SOL → no page; the crank plans a split that fails hourly. The repair claims it pages on unswept excess; it does not on frozen.

**Finding (INFO):** The widened `BENIGN` still misses `AlreadyRetired`, `ActivationPending`, `VaultRetired`, `RevealWindowExpired`, `NeedsReschedule` (L1). Evidence: selftest asserts the current regex; the comment claims it covers all races. The repair added some but not all.

**Finding (INFO):** Live-only joins and payments are not enforced in the plan (L2). Evidence: `assets[r.asset] !== 'live'` pushes a problem but still plans the claim/join for 'other'. The repair claims "only a positively live asset is joined or paid"; the code plans for 'other' and reports.

**Finding (INFO):** The tick that discounts this pass's retirements is incomplete for the case where the only this-epoch requester is burned and retired in the same pass (L3). Evidence: plan still produces a tick; the program refuses `NoActiveVaults`. The repair claims it subtracts retiring this-epoch requesters; the code does not when `w == 0`.

**Finding (INFO):** `plan.owed` is not asserted in the selftest (L4). Evidence: the selftest uses batch counts; `plan.owed` is computed but never checked against MINT's `owed_of`. The repair claims it asserts SATS; the selftest does not.

**Finding (INFO):** The alarm wiring derived from every `detect*` export is incomplete (L5). Evidence: `V6_WIRED` never got the round-22 detectors; cutting `detectRevealStall` etc. leaves the gate at `[]`. The repair claims it is derived; the list is still hand-maintained.

**Finding (INFO):** The launch gate's new pins (swap operator, $CBOB mint and release wallet, on-curve keys) have no arm in the selftest (L7, L8, L17). Evidence: removing the pin keeps `check-launch-params --selftest` at 27/27; an off-curve key passes. The repair claims they are refused; the selftest does not test them.

**Finding (INFO):** Drift suppression for a program that just appeared is incomplete for the PoB collection (L11). Evidence: a reader that forgets `pob_collection.plugins_hash` but has MINT present produces no missing-key error. The repair claims it skips only when the program is `_missing`; the PoB collection is exempt only when MINT is missing.

**Finding (INFO):** `lockDeadlineOf` reads only the box file or `charter_opens_at`; an earlier box file still wins, but the comment claims it is the earlier of the two (L12). Evidence: `lockDeadlineOf(T-5, T)` = T-5; the alarm uses it. The repair claims it is min(file, charter); the code uses the box file when it is earlier.

**Finding (INFO):** Plan-sized fee floors are not enforced in `judgeFeePayer` when `need` > floor (L14). Evidence: a plan costing 0.0067 SOL with a 0.005 SOL balance is refused, but the warning path still runs the full pass. The repair claims the floor is sized from the plan; the code uses the larger of floor and need but the warning is still per-run.

**Finding (INFO):** The lock's liveness-before-age rule is not asserted in the selftest for a fresh lock whose holder is dead (L15). Evidence: the selftest uses `dead` for every record, including fresh ones, and relies on age alone. The repair claims liveness is asked first; the test does not.

**Finding (INFO):** Split anchoring by total is not asserted for pre-round-12 entries (L16). Evidence: a bare signature (no time, no total) anchors every later `splitByOther` cycle. The repair claims it anchors on total; old entries have no total and are carried forever.

**R4b. THE BOOST OFF CHAIN**

**Finding (MEDIUM):** The crank does not expire every DUE boost before it distributes (or the program refuses) in all cases (L3). Evidence: when `w == 0` and the only requester is burned and retired in the same pass, the crank still plans a tick; the program refuses `NoActiveVaults`. The repair claims it expires before and after; the code does not when `w == 0`.

**Finding (MEDIUM):** The owed math does not include `boost_weight` and `carry_scaled` exactly as MINT's `owed_of` when expiry and credit coincide (L4). Evidence: the selftest arms use batch counts; removing `boost` and `carry` from the crank's owed line leaves both arms green. The differential catches the mutant. The repair claims it matches MINT; it does not when a boost expires in the same distribution that credits it.

**Finding (LOW):** The alarm does not page `boosts_stalled` when a due boost is unexpired long after a distribution (M3). Evidence: `detectDistributionOverdue` pages `boosts_stalled` only when `boosts_due > 0` and the grace has passed; a due boost that the crank never expired is not paged. The repair claims it pages `boosts_stalled`; the code does not when the crank is dead.

**Finding (INFO):** `launch/create-cbob-token.mjs` creates the $CBOB mint in one transaction and revokes its mint authority, but the record is written *before* any read-back (I5). Evidence: a read-back that throws leaves `verified: null` and the record is still written. The repair claims it reads back at confirmed; the record is written first. A re-run on a mint that already exists dies instead of re-reading.

**R5. THE SWAP HOP (`bank/revenue.mjs`)**

**Finding (MEDIUM):** `revenue.mjs` signs the Jupiter `/swap` transaction without validating its instructions (round 22 S2, carried). Evidence: the operator key signs whatever the endpoint returns; Jupiter or anything between can make it sign an arbitrary transaction. The bound is the same (operator wallet holds only the cycle's funds + 0.02 SOL), but the trusted hop now includes an unvalidated response. The repair claims it is bounded; the code does not validate.

**Finding (LOW):** The ledger cannot read a failed cycle as closed (the `sendRejected` guard is after the open-cycle check). Evidence: a `SweepTooSoon` (routine against a long cooldown) is recorded as open, wedges every future run, and raises a CRITICAL about lamports that never left. The repair claims a rejected send is closed; the code checks it after the open-cycle guard.

**Finding (INFO):** Nothing here can send value anywhere the program does not pin (the operator signs, destinations are derived from config, the split is enforced). Evidence: the only transfer is the return to the revenue ATA; the split pins both destinations. The repair claims it is pinned; the code does.

**R6. THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`)**

**Finding (MEDIUM):** Assertions that cannot fail: the selftest's boost-owed arms use batch counts, not sats (L4). Evidence: removing `boost` and `carry` from the crank leaves both arms green. The differential catches the mutant. The repair claims it asserts SATS; the selftest does not.

**Finding (LOW):** Floors that can be satisfied by deleting work: the detector selftest floor is 560; deleting the last 20 assertions still passes (the floor is only a lower bound). Evidence: `R.length - bad.length >= FLOOR` is true when `R.length = 540`. The repair claims the floor must equal the count; the code uses `>=`.

**Finding (INFO):** Checks that pass vacuously when their input is empty: `missingWatchedKeys` on an empty snapshot returns `[]` (no missing keys reported). Evidence: `missingWatchedKeys(null)` = `[]`. The repair claims it names every unwatched key; an empty snapshot produces no error.

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?**

1. **Run the full mainnet dress rehearsal at throwaway program IDs with the shipped off-chain code unchanged** (item 53, still OPEN). The recorded patch is byte-exact, but the rehearsal has never run the crank against ~2,100 live vaults (cost, rate limits, paging, transient RPC errors, the every-minute reveal lane keeping up). This is the only way to measure the I/O the programs cannot test. Do it with real small amounts, the crank and alarm live, and the redeem page built.

2. **Build and ship the holder surfaces promised in HOLDER-GUIDE.md** (item 50, OPEN AND BLOCKING). The redeem page must run `judgeRedemptionCoverage` before the holder signs and must create destination ATAs in a prior transaction. The automated X post and website record must exist. Until they do, items 9 and 44 have no preventive control.

3. **Exercise a distribution against a live chain with the crank armed** (item 22, OPEN AND BLOCKING). The programs' arithmetic is proven; the crank's I/O against ~2,100 vaults is not. The dress rehearsal must pay real (small) amounts.

4. **Move the $CBOB supply off the box key** (item 56, ACCEPTED but still a hot key on this box). The release wallet is pinned, but the secret is in `bank/keys/cbob-release.json` (mode 600, in the nightly R2 backup). Move the supply to Gary's wallet or a Squads, delete the box key, and update the pin before any release.

5. **Re-run the entire suite, the Test Vault simulation, and the mainnet probe after the final freeze, with a different model roster than the first clean round.** The freeze must hold (no change to programs, bank, or scripts). The second clean round must use a different set of models. The mainnet probe must run (not be skipped for no DNS).

These are the only things an AI audit structurally cannot do. Everything else is covered by the 748 assertions, the real cloned Core suite, the differential, the mutation tests, and the gates. Do these five, or the programs will be immutable with unmeasured risk.