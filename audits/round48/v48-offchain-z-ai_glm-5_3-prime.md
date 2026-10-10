# Round 48, OFF-CHAIN pass — independent audit of the whole tree

**Verdict: LAUNCH-CLEAN; REQUIRES CHANGES.** Five new findings: 4 LOW, 1 INFO, all in the fixable layer (tooling, tests, the shared reader, docs generation). None in the five programs, none on a value path, none that stops or wrongly refuses a crack, none HIGH or MEDIUM. Round 47's nine off-chain repairs were re-verified at their constructs; seven hold completely, two hold with a residue filed below. This is not a no-change round.

**What I ran: nothing.** Read-only. Every finding below is source-level, names the file and function, and states what a test run would show. Scope limits are stated where they bind: `README.md`, `tests/3prog.test.ts`, `tests/expiry-budget.mjs`, `tests/initauth.test.ts`, `web/src/lib/*`, `web/deploy/rpc-proxy.mjs`, `scripts/rehearsal-steps.mjs`, `scripts/rehearsal-recover.mjs` and `scripts/rehearsal-refresh.mjs` are not in this bundle (the selftest reads several of them from disk; claims that turn on them are claims about files I was not given).

---

## R0. Round 47's verdict and its repairs

**The repairs, re-verified at their constructs:**

- **V47o-1 (result writer):** `core-watch-suite.sh` `res()` now builds JSON with `node -e`/`JSON.stringify`; `core-watch.mjs` `suiteStatus()` returns `{status:'unreadable'}` for an unparseable file and `decide()`'s `finished()` includes it, so an unreadable result is one URGENT email and never a restart. The selftest arms (raw-newline file → unreadable; `res()` with a newline → valid JSON) are behavioral and can fail. **Holds.**
- **V47o-2 (validator lock):** `scripts/validator-lock.sh` takes a kernel `flock` on fd 9; the inherited-fd check (`readlink /proc/self/fd/9`) correctly distinguishes an inherited open-file description (lock re-entrant) from a fresh open; all five runners source it before their exit trap and boot the validator with `9>&-`; `run-tests.sh` re-hashes the booted Core against the pin at [4/7]; the diagnostic waits on the same lease and restores a crashed swap. The selftest arms (refused beside a holder; killed holder frees at once; child admitted) are behavioral. **Holds.**
- **V47o-3 (SPEC/README):** SPEC items 22 and 53 are restated, Gary's 2026-10-10 ruling on 22.2 is recorded, item 22 stays OPEN only for scale. **Holds in SPEC — the README half does not, see F1.**
- **V47o-4/V47-1/V47-2 (readme-facts):** `auditFacts()` takes tracked paths only (`git ls-files`), the owed regex is `/^REQUIRES CHANGES: (?!NONE\b)\S/m`, SEAL/BURN/SWEEP are described as they are. The three selftest arms are behavioral (worktree + untracked round; NONE/NONE row; wording). **Holds.**
- **V47o-6 (installer):** eight jobs, the Core watch under `flock` off the `4-59/10` tick, its own deadman on a missing or stale state file. **Holds.**
- **V47o-7 (orphaned result):** `decide()` iterates `obs.prior` and sends an earlier build's unsent result once, marked EARLIER. **Holds.**
- **V47o-8 (mock):** `mock-rpc.mjs` serves `getTokenAccountsByOwner` for both token programs with the dataSlice, and the adversary hook moved there; `plan.test.mjs`'s V47o-8 arm asserts no `unlisted` box. **Holds.**
- **V47o-9 (clean clone):** `run-tests.sh` names a missing `dist/` before the web tests. **Holds** (README's bootstrap half is in the other pass's file).
- **V47-4/V47-5 (pages):** the ceremony's compute floor from the step's dry run and the demoted-writable refusal are behavioral arms in `ceremony.test.mjs` / `tx.test.mjs`. **Hold.**

**Round 47's rejected claims re-tested:** C10 (Meteora `host_fee_in`) is limit 10(c), settled since round 36 — the judge pins the value-moving roles it documents, the on-chain floor binds the output, and reaching key 9 needs a changed builder in this tree. C12 (reveal run ends at `'other'`) is the pinned design (V43o-3; `RevealOutOfOrder` makes `continue` a fee burn). C14 (`NoActiveVaults`) cannot be produced on its stated path. C16 is moot (the watch is now flocked by the installer). C22's "run-tests re-hashes the cache" is now TRUE (the [4/7] re-hash landed). I agree with all of round 47's dispositions I could check.

**Floors:** MIN_ASSERTIONS 913, DET_FLOOR 1081, ALLOC 39, POSTER 24, POB 14, LAUNCH 69, HOST 6, WEB 805 (sums exactly across run-all's eleven files), MAINNET 35, EXPIRY 4, SWAP 16 — all consistent with the VALIDATION and with SPEC's stated counts, which the selftest's every-occurrence gate checks.

---

## Findings

### F1. LOW — the README's generated road row 8 is a garbled fragment, and the V47o-3 repair's public half did not land

**Construct:** `short()` in `scripts/readme-facts.mjs` (the `road()` generator), against SPEC.md's road row 8.

`short()` cuts the state cell at `t.search(/:|\./)` — the first colon **or period**. SPEC's row 8 state cell (after `**`/backtick stripping) begins:

> `done on mainnet 2026-10-09 to 10-10; 22.2 recorded FAIL because pass 2 caught the real Metaplex Core upgrade …`

There is no colon in that cell; the first period is **inside "22.2"**. `t.slice(0, cut)` therefore yields:

> `done on mainnet 2026-10-09 to 10-10; 22`

That is the README's public road row 8. Round 47's V47o-3 said the public page dropped "22.2 recorded FAIL"; the repair restated SPEC and recorded the ruling (both real), but the regenerated public row still drops the 22.2 outcome *and* now ends mid-number. The commit that rewrote the SPEC row (`6dfca99`, colon → semicolon) moved the truncation point from a clean cut into the middle of "22.2".

**What is gained:** nothing monetary. A garbled sentence on the public front page, and the one launch-gate fact V47o-3 was about remains absent from the public row.

**Evidence if I am right:** run `node scripts/readme-facts.mjs --write` and read the road row 8 in README.md (README itself is not bundled here; the generator and its input SPEC.md are, and the output is deterministic). A selftest arm feeding `short()` the current row-8 cell and asserting the output contains `22.2` fails today.

**Fix:** cut at a sentence boundary (`t.search(/:\s|\.\s/)` or the first `;`), or lead the SPEC state cell with the one-line summary so the truncation is clean. Add the arm.

**Class: none** (docs/tooling).

### F2. LOW — the Core watch's selftest (the V47o-1, V47o-7 and C19 repair arms) is run by nothing

**Construct:** `scripts/core-watch.mjs --selftest` (25 assertions) versus `scripts/run-tests.sh`, `scripts/cron-install.sh`, `web/test/run-all.mjs`.

The V47o-1 and V47o-7 repairs' both-ways arms — the result-writer JSON test, the unreadable-result decision, the earlier-build result, the `MAINNET_FLOOR`-derived probe literal — live in `core-watch.mjs`'s own selftest. Nothing invokes it: the runner's `[6/7]` block gates the detector, poster, pob-merkle, launch, host-unit and web selftests, and `[+]` gates expiry-budget and the swap fork; the cron runs a tick, not `--selftest`. The round-47 VALIDATION ran it once by hand ("Offline, at bba189a: … Core watch 25/25") and the certifying log (`.cache/bba189a-suite.log`) lists no core-watch line. This is the exact class round 16 filed as a finding ("the mainnet probe had no floor at all … one of three identical sites, in the file that enforces the other two"): a regression gate that exists but is wired into nothing protects nothing after the hand run.

**What is gained:** a future regression in the watch's decision logic or the suite's result writer (the exact defect V47o-1 was) would not fail any build.

**Evidence if I am right:** `grep -n "core-watch" scripts/run-tests.sh` finds no `--selftest` invocation; the certifying log's floor list omits it. The selftest is pure (no network, no email, no validator), so nothing prevents gating it.

**Fix:** `sub_selftest core-watch node scripts/core-watch.mjs --selftest` with a floor of 25 in `run-tests.sh`, and move the floor with the arms.

**Class: none** (tooling/tests).

### F3. LOW — `validateParsedTransaction` validates System transfers by shape only: `source`, `destination` and `lamports` are never checked

**Construct:** the money-instruction block in `bank/txread.mjs` `validateParsedTransaction`'s inner `instruction()`.

The block requires, for the System program (and the token programs and the ATA program), only `object(ix.parsed) && object(ix.parsed.info)`. The token block beside it then validates accounts (`key(info.source)`, `key(info.destination)`) and amounts (`/^\d+$/`) for `transfer`/`transferChecked`/`approve`/`approveChecked` — round 27's mutation arms pinned those. The System program gets no second block: a `transfer` whose `info` is `{source, destination}` with **no `lamports`**, or with a garbage `lamports`, passes the reader as complete coverage.

**What is gained:** the only consumer of System transfer lamports is `releasedFromTx` in `bank/redemption-poster.mjs` (`BigInt(p.info.lamports ?? 0)`). A missing field drafts **0 SOL** into the public redemption post (the SOL leg silently omitted — the poster's own canon is "never a number that is not real"); a non-numeric field throws and kills the poster run (loud). The alarm's `revenueOutflow` is token-only, so no money decision is affected. The reader's own header states the standard this misses: "System/token payloads feed the money-path detectors and must carry their structured info rather than vanish."

**Evidence if I am right:** a unit case feeding `validateParsedTransaction` a System `transfer` with `parsed.info = {source, destination}` (no `lamports`) returns the transaction instead of throwing, while the token equivalent throws `unreadable parsed transaction: token movement amount`. Round 27's mutation list armed only token shapes.

**Fix:** for System `transfer`/`transferChecked`, require `key(info.source)`, `key(info.destination)` and a digit-string `lamports`, mirroring the token block; add both mutation arms.

**Class: none** (the shared reader; a draft-post figure, not a credit).

### F4. LOW — the alarm is the one job whose notices never take a `-rehearsal` label family inside a rehearsal tree

**Construct:** `report()` and the failure paths in `bank/alarm.mjs`, versus `rehearsalNotice` in `bank/detectors.mjs`.

Round 44's V44o-5 gave the crank and the revenue job automatic rehearsal labels inside a recorded rehearsal tree (`rehearsalNotice` moves the label to `<stream>-rehearsal`), because "a rehearsal run used the production `cbob-vault-crank:*` and `cbob-revenue:*` streams unless the operator remembered." The alarm never got the same treatment: `report()` and both failure paths (`ALARM FAILED TO RUN`, `RECONCILE FAILED`) notify on production `cbob-vault-alarm:<kind>` / `cbob-vault-alarm:run_failed` labels, with only the *text* saying REHEARSAL. The router keys streams by label, so rehearsal text on a production label is folded into the production stream (suppression, recovery classification) — the exact defect V44o-5 fixed for the sibling jobs.

**What is gained:** the *driven* path is covered (the driver sets `CBOB_REHEARSAL_NOTIFY`, round 45 V45-9, so no notice reaches the router). The exposure is a hand-run inside a rehearsal tree with `CBOB_ALARM_REHEARSAL=1` (and optionally `CBOB_REHEARSAL_RPC`) but without the notify override — rehearsal-chain findings, or a run failure, opening or muting production streams. The documented mitigation is `--dry-run`, which is the same documentation the crank and revenue had before they were given the automatic fix.

**Evidence if I am right:** `grep -c rehearsalNotice bank/alarm.mjs` is 0, while `bank/crank.mjs` has 3 call sites and `bank/revenue.mjs` 1; the selftest's V44o-5 arm counts notify sites for crank and revenue only.

**Fix:** apply `rehearsalNotice(n, fs.existsSync(REHEARSAL_MARKER))` in `report()`'s send loop and both failure paths, and extend the V44o-5 site-count arm to the alarm.

**Class: none** (monitoring isolation).

### F5. INFO — the ProgramData reads never got the round-42 dust treatment

**Construct:** the `prog.*` loop in `readConfigs()` in `bank/alarm.mjs`, versus the `g()` config reader beside it.

Round 42's drift A1–A3 taught `g()` that a System-owned, 0-byte account at an address a program creates later is NOT CREATED YET (`isSystemDust` → `_missing`), because reading it as foreign made every pass throw. The ProgramData loop kept the old shape: `if (!acc) { _missing }` — a dusted ProgramData address (System-owned, 0 data, one 650,240-lamport deposit anyone can make) falls through to `D.readProgramData(acc.data)`, which returns `problem: 'too short'`, and `readConfigs` **throws**, killing the pass (`run_failed`).

**Reachability today: none.** Every watched program — our five (ids claimed 2026-10-07 with placeholders, so their ProgramData accounts exist), Core, Orca, Meteora, both Pyth programs — is deployed, and a transfer into an existing BPFLoaderUpgradeable-owned account only adds lamports. The exposure would arise only for a *not-yet-deployed* watched id (a future rehearsal's throwaway ids before their deploy, or an abandoned id). It is the round-42 class at one unfixed site, latent.

**Evidence if I am right:** a unit case feeding `readProgramData` a 0-byte buffer returns `problem` (the selftest already asserts this for short buffers); the contrast is that `g()` handles the same input as `_missing`.

**Fix:** `if (!acc || isSystemDust(acc))` in the ProgramData loop, with the `NO_PROGRAMDATA` values for the not-ours programs unchanged.

**Class: none** (latent consistency).

---

## R1. The crank — no new defect found

Verified: the send order (retire → join → expire → split → distribute → expire → activate → claim) matches the program's gates (`JoinWaitingFirst`, `BoostsExpireFirst`, `monthly_inline`'s wait-for-joins/boosts inside the join batches); the distribution weight `total_active_weight + preJoinWeight − retiringWeight − expiringWeight` matches what the sent sequence produces; the pre-joined vault's owed is `level_weight × Δacc` exactly as `join()` + `credit()` compute; the pre-expired vault's owed matches `expire_boost`'s carry arithmetic; `planCostLamports` charges the rescues; every instruction's account shape (writability, signers) matches the Anchor structs, including `rescue_nested`'s nine keys; `budgetPlan` keeps the floor in reserve on every branch; the reveal run stops at `'skip'`/`'mismatch'`/first failure; `planRescues` matches MINT's host rules (live nested vault, host = self/live/burned, foreign hosts excluded); the split's 85% is the program's integer arithmetic; the heartbeat carries failures and problems. The instruction-name gate and the "no token or SOL transfer of its own" gate hold in the selftest.

## R2. The alarm — findings F4 and F5 above; otherwise no new defect

Verified: the per-program walk, backlog drain and empty-walk proof; the unreadable-skip counts surviving both floods and undelivered passes (the rollback covers `unreadPasses`/`unreadSkips`); `sweep_unledgered_state`'s symmetric window and smallest-cooldown bound; the split anchoring (chain-time, amount, exclusions, `upTo`); the frozen transitions; the log-gap watermark (unreviewed never evicted, escalation above 2,000); `missingWatchedKeys` covering the third-party keys; the DAS envelope judgement shared by both callers; the config baseline carry across one-pass blips; the reserve-baseline carry across shrunk and null-SEAL passes; the notify plan (one stream per kind, one-shots urgent, recoveries only for level kinds, never for one-shots). The rollback correctly keeps chain facts (`seenSplits`, `seenSweeps`, `logGaps`, `crankHealth`, `seenRedemptions`) and rolls back baselines. No routine state pages (checked every INFO-level kind and the deliberate level CRITICALs). No dangerous state read as quiet that I could construct: a revenue-PDA lamport fall is only a sweep (only MINT signs for it), the pool's insolvency and freezes page, every fixed-forever value and all ten watched program hashes/authorities drift at CRITICAL, and the vault collection's update authority cannot move without an upgrade MINT never signs (the PoB collection's authority *is* watched, correctly, because it is a wallet).

## R3. The layouts — hold

The field lists equal the Rust structs under the strict parser (private/multi-line fields throw); every cross-program `OFF_` constant any program pins is scraped and compared, with none scraped-and-ignored; the twelve PDA seeds are scraped and asserted (round 24 D6's missing assertion now exists); the layout versions and `BOOST_RING` are scraped; `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated and held to the layout minus padding; the suite's own offset copies agree. A struct change cannot slip past these without also defeating the strict parser.

## R4. The money arithmetic — holds

`credit`, `pendingScaled`, `pendingSats`, `ceilSats`, `available`, `reweigh` and `debtAtActivation` are the Rust formulas line for line in BigInt, including the carry-before-debt ordering and the boost-inclusive weight. The crank expires every due boost before it distributes and every boost the distribution makes due right after (`preExpires`/`postExpires`, with the retiring set excluded from both); the alarm pages `boosts_stalled` and watches `cbob_mint` and both boost ceilings as fixed forever.

## R5. The swap and the revenue cycle — hold; the stated bounds re-derived

(a) The oracle math is exact for every exponent sign (the `e ≥ 0` / `e < 0` branches are algebraically identical; integer division floors on the conservative side); `satsPerLamport`'s float is precision-irrelevant at the 100 bps gate. (b) The `PriceUpdateV2` offsets (40 tag, 41 feed, 73 price, 81 conf, 89 expo, 93 publish time, length ≥ 101) match the Anchor layout, Full-only, feed-id-pinned, receiver-owned, derived under the push oracle — and the fork run is the proof the derivation and the units are right, since it clones those exact addresses from mainnet and swaps through them. (c) `orcaSpot` and `meteoraSpot` are the right quantities in the right direction (the fork's SW.0 binds them to the oracle within 100 bps on both venues). (d) The minimum out is the same oracle read's expectation less 150 bps, in cbBTC base units, in each program's field. (e) The judge pins every value-moving role (programs, signers, the exact seven-instruction sequence, the wrap amount, the floor bytes, the direction byte, the price limit, input/output accounts, both ATA creations, the close); the residue (tick/bin arrays, bitmap, `host_fee_in`, token programs, event authority) is either on-chain-validated-by-the-venue or already stated as limit 10(c). (f) The tick-array and bin-array derivations match the measured mainnet values pinned in the selftest; a boundary or uninitialised array fails on chain, loudly, and the venue loop moves on. (g) An existing wSOL balance is returned by the close; a frozen or delegated wSOL account fails loudly; nothing stays wrapped. (h) Orca-first, Meteora only on a refusal (preflight, landed-and-failed, or expired); an unconfirmed send stops the cycle open with the candidate signature recorded; every path leaves the ledger open until a split is proven (`cycleIsOpen` requires `splitSig`/`splitByOther`). (i) The extraction bound within the tolerance is the 150 bps floor per cycle (~1.5% of ≤10 SOL), bounded per month by cap × windows — all inside stated limit 10. The operator key's worst case is unchanged (cap × cooldown windows until the guardian stops it; ~34–40 SOL/day at the ruled values per round 37 C05); the ledger cannot read a failed cycle as closed.

## R6. The gates — finding F2 above; otherwise they hold

The selftest's round-47 arms are behavioral and can fail (the validator-lock arms spawn real holders and children; the readme-facts arms drive the real generator on a real worktree; the result-writer arm runs the extracted `res()` in bash). The floors are equality, not lower bounds, everywhere. `build-mainnet.sh` proves what it claims for all five programs (both builds behaviourally asked about the test key; the sweep helper's three-way byte identity; the pinned Core; the provenance and dirty-tree refusal; the validator lock before the trap). `cron-install.sh` arms nothing it should not: eight jobs, the two money jobs opt-in with the strict preserve, the rehearsal refusal, LOCKDIR under the repo. The one gate that only ever ran once is F2.

## web/test/ — the tests are non-vacuous

Every newest arm I checked (R46/R47 in `ceremony`, `tx`, `plan`, `bundle`, `mine`, `meta`, `decode`, `ids`) is behavioral or a fixture-sanity check that can fail: the plan is compared byte-for-byte against the sim's S8 builders through the real reference extractor; the decode tests compare against mpl-core's and spl-token's official deserializers; the ids tests compare against the suite, mpl-core and spl-token derivations; the bundle test runs the real browser-settings esbuild build and compares node vs bundle outputs; the tx tests drive the real wallet-edit judge with tampered transactions in both directions; the mine tests drive the real listing with every DAS lie. The three files this pass does not carry (`ix.test.mjs`, `get.test.mjs`, `proxy.test.mjs`) are counted in run-all's floors and sum to the WEB_FLOOR, but their contents are claims about files I was not given.

---

## The four questions on the accepted limits

**1. Is any limit WORSE than stated?** No. I re-derived the operator-key bound (cap × windows, the alarm's cadence plus a human, `sweep_unledgered_state` closing the direct-sweep hole within a pass), the swap-tolerance bound (150 bps per cycle, the deviation gate at read time, the oracle's age/confidence bounds), the rate limit's arithmetic, and the freeze consequences. Nothing exceeds its stated cost. The one place the *public record* is slightly worse than SPEC's is F1, which is filed, not a limit.

**2. Is anything listed as a limit not actually a limit?** No. Limits 9 and 44's preventive control (the redeem page) is built and staged exactly as stated; item 50 is OPEN and nothing quietly treats it as shipped. The holder guide's "published before launch" phrasing is a future promise consistent with item 50's precondition, and the guide is marked DRAFT with the may-not-publish-before-item-50 rule.

**3. Is any DISCHARGED item not actually discharged?** No. Items 51, 54, 12/17, 14, 19, 30, 31, 33 and the v5 family are discharged by construction, measurement, or deletion, as recorded.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Item 22 is open for the ~2,100-vault scale (the rehearsal's "PASS at 5 vaults (scale not exercised)" is recorded, and the road row's "done" describes the rehearsal step, not item 22). Item 38's three OPEN values (`charter_opens_at`, `lock_deadline`, `vault_collection`) are still null/OPEN in `launch/mainnet-init.json`. Item 50 is open. Item 52 is a road-step-10 obligation. Item 53 is open for the in-tree rehearsal run — the last is `e7c192a`, and rounds 46 and 47 changed `bank/` and `scripts/`, so the re-run is genuinely owed; the VALIDATION's certifying run at `bba189a` was in the main tree, not the rehearsal tree, and does not discharge it. One observation, not a finding: the current head's README currency is unverified from this bundle (the VALIDATION's README check ran at `bba189a`, before the round-47 verdicts and the SPEC road-row change were committed); the `--check` gate exists precisely to catch this on the next certifying run.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the crank at 2,100 vaults.** Item 22's open half is the one launch-blocking fact no reasoning pass can close: real I/O at full supply — cost per pass, RPC rate limits against the box's provider, the every-minute reveal lane keeping up, and a transient RPC error injected at vault 1,900 of 2,100. Build the synthetic 2,100-record fixture on a validator and run the crank live against it. Every round, including this one, restates that it is open; only a run closes it.
2. **Have Gary personally walk the three emergency procedures on the rehearsal before the lock:** pull `emergency_stop_sweep` with a real open revenue cycle beside it, walk the hand recovery of that cycle exactly as limit 10's runbook says, and make one re-pin decision against a deliberately-changed Core. The runbook's clarity under stress, and whether the guardian wallet is reachable in minutes at 3 a.m., are human facts no assertion measures.
3. **Receive the pages for 72 continuous hours.** The alarm's stream model (one-shot vs level, 12-hour suppression, recovery cancellation, the router's grace) is asserted against the router's code, but whether a tired human can triage the actual page load — which stream is open, which recovery closed what — is an alarm-fatigue question only a live multi-day run answers. Run the rehearsal deployment with the real router for three days and have a human log every page they receive.
4. **A second person reads HOLDER-GUIDE.md cold.** The guide's sentences are true of the code (this pass checked the ones it could); whether a non-technical holder *understands* "a draw nobody records in time is drawn again" or "only open your vault on the Bank's redeem page" is a comprehension test only a human reader who did not write it can fail usefully.
5. **Verify key custody by hand, once, against the recorded pins:** the $CBOB release wallet file's mode and its presence in the nightly backup's include list, the swap operator key, the deploy authority, and the guardian wallet's ability to sign today. Limit 56 and limit 10's operational rules are recorded facts; a human confirming them on the box the day of the lock is the only enforcement they will ever have.
6. **Confirm the on-chain verification from outside the box.** The verifiable-build workflow is the machine proof; before step 11, a human should open an explorer and see all five programs marked verified from the uploaded parameters — because after `--final` no upload is possible again, and a workflow that was never green on the actual tags would be discovered exactly one step too late.
7. **Decide the Metaplex relationship.** Core is the fifth program, upgraded three times in five weeks, once from unpublished source, and the watch detects but cannot prevent. A human watching Metaplex's channel (or holding a contact) converts the watch's detection lead time into reaction time; that is a control no immutable program and no AI pass can substitute for.