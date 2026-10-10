# Round 47, OFF-CHAIN pass: independent audit of the final tree

**Verdict: LAUNCH-CLEAN under SPEC gate 3 (RULING 2026-10-08), with changes still owed in the fixable layer.** No confirmed finding in the five programs (I read MINT and SWEEP whole; the crank's, alarm's and revenue job's instruction shapes agree with MINT's account structs line for line), no path that moves or miscredits value, nothing that stops or wrongly refuses a crack, no HIGH or MEDIUM. I confirm **1 LOW and 5 INFO**, all in tooling and documentation written after round 46 read the tree. By Gary's "no changes" test this is therefore **not a no-change round**: the LOW and three of the INFOs need a file edit and a test.

Measurement limits first: I ran nothing. Every statement below is from reading the bundled files and recomputing; where a claim needs a run I say what would be observed.

---

## R0. Round 46's verdict, its repairs, and the post-46 code

**Round 46's confirmed findings, re-verified at their sites:**

- **V46o-1 (ack arm).** `bank/selftest.mjs` now drives `unredeemable_owner` with no asset and a well-formed, unexpired ack keyed `unredeemable_owner:undefined`, asserting `['CRITICAL', false]`. With `applyAcks`'s guard reduced to `if (!f.kind) return f`, the key `${f.kind}:${f.asset}` becomes exactly `unredeemable_owner:undefined`, `judgeAck` passes, the kind is ackable, and the finding would come back INFO/acked. The arm can fail. Confirmed repaired.
- **V46o-2 (undelivered pass).** `alarm.mjs` `!delivered` block now restores `next.unreadPasses = prev?.unreadPasses ?? {}` and `next.unreadSkips = prev?.unreadSkips ?? []` beside cursors and backlogs. The selftest extracts those lines by regex from the real block and refuses to run the walk if either is missing. Confirmed. Residual (not a defect): `logGaps`, `seenSplits`, `seenSweeps` are still written from an undelivered pass; since the cursor rolls back, the re-walk re-observes the same facts and the Set/dedupe makes it idempotent.
- **V46o-3 (load-time refusal pages).** `bank/rehearsal-env.mjs` `refuseStrayOverridesAtLoad` writes the job's own marker and calls the literal `/opt/scripts/notify-gary-sms.sh` once before `exit(3)`. `revenue.mjs` calls it before `rehearsalOnly('CBOB_REHEARSAL_NOTIFY')` (so the notifier override cannot be the route), with `notify: NOTIFY_LIVE`; `alarm.mjs` the same with `notify: !DRY`, label `cbob-vault-alarm:run_failed`, marker `RUN_FAILED`. Confirmed, and the stub-driven arm proves the exec happens exactly once.
- **V46o-4** placeholder tracked under `web/test/fixtures/placeholder`, sha256-pinned in `ceremony.test.mjs`. Confirmed.
- **V46o-5** the prompt's "WHAT THIS PASS CARRIES" is computed. Confirmed.
- **V46-7 / V46-8** SPEC 53 records the `e7c192a` re-proof; `check-launch-params.mjs` `REHEARSAL_INIT_AUTHORITIES` is by genesis (mainnet: Gary's wallet only; local: seed-7 only), with both-ways arms. Confirmed.

**Round 46's disproofs, re-tested by reasoning:** Fugu's writable/signer-flag claim: `Transaction.compileMessage()` folds per-instruction flags into the message header by account (a key is a signer/writable if any instruction says so), so every flag-cleared variant of the honest build compiles to the same message; nothing for the judge to catch. Agree. The `ls-files --others` claim: without `--exclude-standard`, ignored files are listed. Agree. DeepSeek's `meteoraSpot` inversion: DLMM's `(1 + bin_step/10,000)^active_id` is Y raw per X raw; with X = cbBTC and Y = wSOL that is lamports per sat, and the code inverts it to sats per lamport, the same unit as Orca's `(sqrt_price/2^64)^2` (B per A raw = sats per lamport). SW.0/SW.7-9 on the fork are the measurement. Agree.

**Post-46 code, audited as new:**

- **The stripped release (`scripts/sbf-strip.sh`, `d2ae5fc`).** `llvm-objcopy --strip-all` removes symbol/section data that the loader never maps; every executable byte is unchanged, so the 912/912 re-run and the CU figures in SPEC 54 stand. `run-tests.sh` [3/7] strips the release output into `target/deploy`; `build-mainnet.sh` strips both builds and compares the sweep helper against the stripped `target/deploy` copy, so the byte-identity claim is like-for-like. The strip helper refuses a non-ELF input and output. Fine.
- **Core re-pin `51d41542…`** appears in `run-tests.sh` and `build-mainnet.sh`; the selftest R43 arm requires `sim/run-sim.sh` and `web/test/e2e-localnet.sh` (not bundled) to carry the same value, and the rehearsal's pass-2 `config_drift` line shows the alarm's 32-hex `prog.core.hash` is this pin's prefix, as the ProgramData-after-45 hashing predicts. Consistent.
- **`scripts/core-watch.mjs` / `core-watch-suite.sh`**: see finding F1 and F3 below. The `decide()` logic is correct and its selftest is both-ways; the ProgramData parsing (variant 2 at 0, ProgramData key at 4..36; variant 3, slot at 4..12, ELF at 45) is right. The problems are in what the suite script shares with every other runner.
- **`scripts/readme-facts.mjs` / `README.md`**: see F4.
- **`web/test/mine.test.mjs`**: non-vacuous (each DAS lie alone lists nothing; `badRecordOwner` and `spoof` cover the record-owner and asset-owner checks; the relay shape and the 100-account batching are asserted).
- **`web/test/tx.test.mjs` R47 block**: the wallet-edit judge tests are the real thing (reordered, dropped, changed, in-between guard, over-budget price, heap-frame kind, added signer, added writable) and each uses a distinct refusal text, so they are not one test eleven times.

**R0 result:** every round-46 repair holds at every site I could reach in this pass. What round 46 asked of the other pass (the driver) I did not re-judge.

---

## R1. The crank (`bank/crank.mjs`)

I walked `planCrank` against MINT's gates for every send, in the order `main()` sends them (reschedule, capture, reveal, rescue, retire, join, expire-before, split, distribute, expire-after, activate, claims):

- **Reschedule/capture** match `reschedule_reveal`'s `now > reveal_slot + 300` and `try_capture`'s C-group arithmetic (`readySlot` = two strides of 4 from the reveal slot). A skipped slot only yields `RevealTooEarly`, which is `BENIGN`.
- **Reveal** strictly from `revealed_total` while the next is ready; a captured-this-pass head is revealed in the same pass; the hash is judged before a fee is spent (`judgeRevealAttrs`: send / revealed-elsewhere / mismatch); `[]` only for a positively burned asset; `other` ends the run. Account order equals `RevealLevel`.
- **Retire** only `!retired && burned`; a redeemed vault is already retired by `retire_redeemed`, so no double retire.
- **Join-first** only `pending && request_epoch < dist_epoch && live`; the pre-join claim sends `[record, vault_ata]` with `crank_n = 0` (`data [disc, 0]`), which `claim` accepts, and `monthly_inline` inside it cannot refuse. A vault redeemed between plan and send is `retired` and `continue`d, never refused.
- **Expire-before/after** match `BoostsExpireFirst` and `dist_epoch >= boost_end_epoch`; `expire_boosts` skips non-due records, so a failed distribute makes the after-batch a no-op fee, not a page.
- **Split** needs revenue, pool and Squads ATAs all `ok` and unfrozen; the planned 85% uses `total - total*1500/10000`, identical to the program's floor-the-15 rule.
- **Distribute** plans a credit only with `!pool.frozen && due && w > 0 && avail > 0`, where `w` is corrected for pre-joins, retirements and pre-expiries exactly as MINT's `credit` denominator will be, and `avail` uses `owed_scaled` less the retiring vault's `owed_of` (program `retire` subtracts the same `pending`). The tick branch mirrors MINT's `w == 0` path (needs `pending_this_epoch > 0` after this pass's retirements, pool a token account).
- **Claims**: owed per vault is MINT's `owed_of` with boost and carry; the pre-joined vault at `debt = W × acc_old`; the pre-expired vault as `carry + W × Δacc` (equals `reweigh`-then-`owed_of`); whole sats only; recorded ATA only; frozen deferred. Batches of 14, pairs writable.

**Nothing moves value anywhere MINT does not already pin**: the only program called is MINT; the instruction set is `activate, capture_entropy, claim, distribute(false), expire_boosts, reschedule_reveal, rescue_nested, retire_burned, reveal_level, split_revenue`, each with pinned destinations on chain (the selftest derives that list from the source).

**One narrow false page (INFO, F6 below):** the crank plans an epoch tick; between plan and send a host's in-line run ticks AND a stranger's claims join every waiting vault; the crank's `distribute(false)` then refuses `NoActiveVaults`, which is in neither `BENIGN` nor `DISTRIBUTE_RACE`, so `judgeDistributeRefusal` says `fail` and the full lane pages once. Needs two strangers' acts inside one RPC round trip, at most once a month at launch. Not a value path.

**Otherwise R1 finds no plan the program refuses for a reason the crank does not already treat as a race, no payment or join of a dead vault, and no out-of-order reveal.**

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

Checked that every fixed-forever field is in `WATCH` at CRITICAL (split, destinations, pool, supply, census, PoB root/collection, charter window, month, redeem window, notice, three tighten bounds, $CBOB mint and both boost ceilings, GOV's three numbers, the four collections, SEAL's reserves), that the production list asserts 21%/51%/3 days, 7-day notice, 1 SOL/24 h/0.1 SOL, 30-day month, one-hour window, and that the five programs' `upgrade_authority` and `hash` (sweep included), Core, and the four third-party programs are produced (`missingWatchedKeys` is asserted both ways). `pending_swap_operator` and `pending_guardian_set` page at CRITICAL every pass (level), the brakes once as transitions, the PoB collection's plugins and update authority at CRITICAL drift. `detectPoolHealth` pages frozen (urgent once) and insolvent; `detectDistributionOverdue` pages the three stalls and the overdue month; `detectRedemptionRate` mirrors BURN's ring.

Dangerous states I tried to read as quiet, and could not: an operator replacement landing (drift CRITICAL), a guardian retired (drift CRITICAL + INFO), a thief's sweep (walk-derived `unledgered_sweep` plus the flood-proof `sweep_unledgered_state` on `last_sweep_at`, judged against the smallest cooldown ever seen), a short return (`short_swap_return` at 2%), a Core upgrade (confirmed live on 2026-10-09 by the rehearsal's pass 2), a vault held by the Squads (HIGH each pass).

Routine states that page every pass: only the already-accepted `index_disagrees_with_chain` under DAS lag and `vault_awaiting_return` while the Squads holds a rescue, both level kinds the router collapses. In production today, with the placeholder deployed and `lock_deadline` unset, `lock_deadline_unset` CRITICAL stands every pass: correct by design.

One carried recommendation stands: `CBOB_ALARM_REHEARSAL` is read from `process.env` and not gated through `rehearsalOnly`, so a stray `=1` in the production environment silences the production-value checks with only the word REHEARSAL in each report (round 45's recommendation, not re-filed).

---

## R3. The layouts (`bank/layout.mjs`)

`STRUCTS.MintConfig` and `VaultRecord` equal the Rust structs field for field and type for type (I compared every line). The cross-program offsets recompute: `minted_total` at 141 (8+1+32+32+32+4+8+8+8+4+4), `bare_burns_retired` at 454, `governance` at 41, `collection` at 9. `parseRustStruct` throws on any line it cannot read as one `pub name: Type,`, so a private, multi-line or `pub(crate)` field cannot hide. **Round 24 D6:** the SEEDS assertion now exists (selftest scrapes every `pub const *_SEED: &[u8] = b"…"` from the four programs for all 12 entries, and shows a mistyped seed and an unmapped seed red). The layout versions, `BOOST_RING`, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` less padding, and the suite's own `OFF_` constants are all scraped and compared, not typed. A struct change could not slip past.

---

## R4. The money arithmetic (`bank/accrual.mjs`)

`credit` (`delta = avail×1e12/w; owed += delta×w`), `pendingScaled` (`(W+boost)×acc + carry − debt`), `available` (`pool − ceil(owed)`), `ceilSats`, `reweigh` (carry ← owed, debt ← W'×acc) equal MINT's `credit`, `owed_of`, `ceil_sats`, `reweigh` exactly; `join` is `debt = W×acc, carry 0`. The crank expires every DUE boost before its distribution (`preExpires`) and every boost its distribution makes due right after (`postExpires`, `boost_end_epoch == dist_epoch + 1`), and `boosts_stalled` pages HIGH after the grace; `cbob_mint`, `max_boost_weight`, `max_boost_epochs` are CRITICAL drift. No divergence.

---

## R5. The swap and the revenue cycle

**(a) Oracle math.** `sats = lamports × sol × 10^(es−eb) / (btc × 10)` is the correct closed form of `lamports/1e9 × SOL/BTC × 1e8` for any sign of the exponents (the negative case multiplies the denominator); integer floor on `expectedSats` and on the 150 bps floor, both in the holders' disfavour. Exponents are bounded to −18..0 at the read and the floor, so `10n ** BigInt(…)` is bounded. `satsPerLamport` as a float uses prices < 2^53 (SOL ≈ 1.2e10, BTC ≈ 8.6e12), relative error ≈ 1e−16, irrelevant to a 100 bps gate. Honest pool after fee and impact: with the read-time gate at ≤100 bps and Orca's 16 bps fee plus a few bps of impact at 10 SOL in ~$10M, the worst honest execution is ≈120 bps under the oracle, inside 150; the fork measured 18 and 20 bps under at the 10 SOL cap.

**(b) Pyth.** Offsets recomputed from `PriceUpdateV2`: level tag at 40 (Full = 1, Partial = 0 + u8), feed 41..73, price 73, conf 81, expo 89, publish_time 93. Correct, and the fork rewrites publish_time at 93, so the age arms test the right byte. The account is the shard-0 sponsored PDA under the push oracle, owner-checked against the receiver. Only the push oracle's write authority can post, and it refuses a `publish_time` not newer than the stored one, so nobody can write an old or chosen price; anyone can post a NEWER verified one, which is the desired direction. The clock is the Clock sysvar from the same RPC, which is limit 10(b)'s trusted endpoint; an unreadable or foreign-owned Clock refuses.

**(c)/(d)** Units as above; the same `minSats` is both the filter's assumption and the on-chain `other_amount_threshold` / `min_amount_out` in sats. Floating point cannot pass a pool it should refuse: the gate is `≤ 100` on a quantity with ≈1e−16 error, and the on-chain floor binds regardless.

**(e) Judge.** The exact seven-instruction sequence; the output account at key 5 on both venues is the operator's own cbBTC ATA; both ATA creations' payer/account/owner/mint are pinned; the wrap's amount and destination; `SyncNative`; the swap's amount, threshold, Orca's direction/exact-input/price limit; exactly one close back to the operator; no priority fee; no Token instruction but 17 and 9; no foreign program; no second signer. Residue: pool-owned accounts (vaults, tick/bin arrays, oracle, bitmap) are left to the venue program, which constrains them to the pinned pool. A tampered builder cannot route value past it; a tampered tree can rewrite the judge (limit 10(c)).

**(f) Derivation.** Orca tick arrays `[s0, s0−span, s0−2·span]` for a_to_b with `span = 88 × tick_spacing` and the `oracle` PDA; Meteora `[i, i+1, i+2]` for Y→X, `__event_authority`, the pair's `oracle`, both token programs, `host_fee_in` None, bitmap present or program id. An uninitialised array or a boundary a 10 SOL swap cannot reach makes the venue refuse, which falls through to the next venue. The `!!bm` without an owner check (round 43 gate-5 item 5) is still open: System dust at the bitmap PDA passes a non-DLMM account and makes Meteora refuse, a grief on the fallback only.

**(g) wSOL.** Wrap exactly `lamportsIn`; a pre-existing or pre-funded operator wSOL ATA is harmless (close returns everything to the operator; the delta check is on cbBTC); wSOL cannot be frozen; a delegate needs the operator's signature.

**(h) Failure/retry.** `classifySendFailure` tries the next venue only on `refused` (preflight, landed-with-err, or expired with no status) and stops on `unknown` with the candidate signature recorded; the ledger stays open until a cbBTC return is proven (`cycleIsOpen`). The one residual is stated (limit 10, round 45 C10): `!st && expired` from a lagging status node reads a landed transaction as refused.

**(i) Extraction bound.** Per cycle at most 150 bps of the amount (sandwich to the floor) plus any oracle error inside 180 s and 30 bps confidence: at the 10 SOL cap, 0.15 SOL in the normal case, perhaps 0.35 SOL in a volatile three minutes; per month, bounded by cycles (≤ 4/day) × cap: ≤ 18 SOL at full volume, in practice a tiny fraction of royalty flow. A manipulated Meteora pool cannot do better than the floor. Not material.

**Operator key worst case:** cap × cooldown windows until `emergency_stop_sweep`, plus one cycle's cbBTC held rather than returned (the ledger pages). Unchanged from limit 10. **The ledger cannot read a failed cycle as closed:** `cycleIsOpen` is open for any moved amount with no return or no split, and a `sendRejected` row carrying a sweep is itself CRITICAL.

---

## R6. The gates

`floor()` demands equality; every selftest count is printed before it is judged; `run-all.mjs` holds each web file to its floor and the runner holds the total (41+47+16+171+57+159+36+129+25+89+31 = 801, matching `WEB_FLOOR`); `swap-fork.sh` holds 16 (I counted SW.0, SW.1/1a/1b, SW.4/4a/4b, SW.6/6a/6b/6c, SW.7/7a/7b, SW.8, SW.9). `everywhere()` fails on zero occurrences. The round-24 arms I re-read (H1 router sequence, L4, L5, L7, L8, L9, L10a-d, L11, I3, I5, D5) each drive a case that must fire and one that must not; the L13b wiring gate is content-based, not textual. `build-mainnet.sh` asks all four keyed programs behaviourally and proves the sweep helper's bytes against both the control build and `target/deploy`. `cron-install.sh` arms only a preserved, tagged, uncommented, full-pass `--live`; the posture print and `crankArmed` share one anchored regex.

The web tests: each file I read can fail when its property breaks. The only shape worth naming is `ids.test.mjs`'s literal `'d2ae5fc'` beside `RELEASE_COMMIT`, which is a deliberate second pin, not a tautology.

---

## Findings

### F1 — LOW — `scripts/core-watch-suite.sh` takes a validator lock nothing else honours, and swaps the shared pinned Core file in place

**Construct.** `core-watch-suite.sh` waits for `$CACHE/VALIDATOR.lock` to be absent and `pgrep -x solana-test-val` empty, creates the lock, copies the pinned `core-mainnet.so` to `pinned-core.so`, writes the NEW Core bytes over `.cache/core-mainnet.so`, and runs a generated copy of `run-tests.sh`. `scripts/run-tests.sh` and `sim/swap-fork.sh` (the two runners bundled) never read or create `VALIDATOR.lock`; both begin with `pkill -x solana-test-val; fuser -k 8999 9900`.

**What goes wrong.** (i) A human or cron run of `run-tests.sh`, `build-mainnet.sh` or `swap-fork.sh` started while the diagnostic runs kills its validator mid-suite; the diagnostic ends `rc ≠ 0` and the next watch tick emails **URGENT "The full CBOB on-chain suite FAILED against the new Metaplex Core"** for a Core that may be fine. (ii) The human's run dies at the pin check with a message about a corrupt cache, because the file under it is the new Core; deleting the cache to re-dump fetches the same new Core and dies again, until the diagnostic's `restore` runs. (iii) A SIGKILL/OOM/reboot during the diagnostic skips the EXIT trap: `.cache/core-mainnet.so` stays off-pin (every runner then refuses, fail-closed, but with no notice naming why), and `suite-<hash>.json` stays at `status: running`, which `decide()` only re-asserts quietly, forever. (iv) The generated runner replaces the probe line with a literal `'35/35 as predicted …'`; a future move of `MAINNET_FLOOR` makes every diagnostic report FAILED.

**Evidence if true.** `grep -n VALIDATOR.lock scripts/run-tests.sh sim/swap-fork.sh` returns nothing; `grep -n 'pkill -x solana-test-val' scripts/run-tests.sh sim/swap-fork.sh` returns the unconditional kills; starting `run-tests.sh` during a diagnostic produces `FATAL: cached Core sha256 <new> does not match the pinned`.

**Class.** None of (a)-(d): tooling on the box; no money, no crack, no program. **Fix.** Make every runner take the same `flock` on `.cache/VALIDATOR.lock` (one `flock -n` line at each runner's top), and have the diagnostic pass the new Core's path through a third sed line rather than overwrite `core-mainnet.so`; give `decide()` a bound on `running` (e.g. 6 h) after which it pages `stuck`; derive the bypass probe line's count from `MAINNET_FLOOR`.

### F2 — INFO — SPEC items 22 and 53 are stale against road step 8, and item 22.2's recorded FAIL is discharged by narrative, not by the rule

**Construct.** Item 22's lede still reads "NOTHING HAS EVER RUN A DISTRIBUTION AGAINST A LIVE CHAIN"; item 53 still says "the dress rehearsal itself (road step 8, item 22) has not yet run to its end on mainnet"; both sit under OPEN AND BLOCKING. Road step 8 says "done on mainnet 2026-10-09 to 10-10" and `audits/rehearsal-2026-10-09/RECORD.md` shows `crank-full`, two revenue cycles, the forced failure and the hand recovery done, with 22.1/22.3/22.4/22.5 PASS and **22.2 FAIL**. Item 22 says the rehearsal "passes or fails on these NAMED items". Nothing in SPEC says what a FAIL on one item means for the gate; the road row re-reads it as a true detection. Item 53 also says "every repair commit needs the same in-tree run again (round 46's included)"; `audits/round46/VALIDATION.md` records certifying runs at `1650336` and `d2ae5fc` but no run of `run-tests.sh` inside the recorded rehearsal tree at `d2ae5fc`.

**Evidence.** The quoted sentences; `grep -n "rehearsal-proof" audits/round46/VALIDATION.md` finds no `d2ae5fc` proof log.

**Class.** None. **Fix.** Restate item 22 as what remains (scale, and the 22.2 pass that re-baselining would give), record a ruling on 22.2 or re-run alarm pass 2 against a re-taken baseline, and either record the in-tree run at `d2ae5fc` or drop item 53's clause. Documentation only; this one item would qualify under the 2026-10-07 documentation exception.

### F3 — INFO — the Core watch is a control no gate shows armed

**Construct.** `scripts/core-watch.mjs` is run "cron, every 10 minutes" (its header), but `scripts/cron-install.sh` installs exactly six jobs (asserted by the selftest), the SPEC control table has no row for it (and its AUTOMATIC rule can only credit a `bank/*.mjs` the installer names), and no detector or deadman notices if its crontab line is missing or its state file is stale. `HOLDER-GUIDE.md` ("We watch Core and are alerted to any change") and `README.md` describe it as running.

**Class.** None. **Fix.** Add the watch to the installer (tagged) and a deadman on `.cache/core-watch/state.json`'s `lastReadAt`, or a PROCEDURE row saying it is hand-installed; extend the selftest's six-job list.

### F4 — INFO — `scripts/readme-facts.mjs` renders a verdict without its quorum clause; two README sentences compress holder rules

**Construct.** `audits()` reads the verdict from the first line with `/pass: ([A-Z-]+(?: [A-Z-]+)*)/`, which stops at `;`. A future "LAUNCH-CLEAN; QUORUM NOT MET" would render as LAUNCH-CLEAN in the public table. README prose: "At 21,000 sats of cbBTC the vault is activated and joins the monthly payouts" (it requests, and joins at the next distribution, up to a month later); "run the rescue that returns a vault sent into another vault" (the rescue moves it to the multisig; a person returns it).

**Class.** None. **Fix.** Capture through the quorum clause (or refuse a verdict line without one); align the two sentences with HOLDER-GUIDE.

### F5 — INFO, for the other pass to settle — `web/test/mock-rpc.mjs` answers no `getTokenAccountsByOwner`

**Construct.** Round 46 moved the stray listing to "one `getTokenAccountsByOwner` per token program" (`708af02`); the mock's `handle()` serves token listings only through `getProgramAccounts` with a memcmp on the owner and throws `not implemented` for any other method. If `web/src/lib/reads.mjs` (not bundled here) now calls `getTokenAccountsByOwner` without a GPA fallback, the offline V40-1 arms and the e2e exercise the "could not list" box rather than the listing, and "the dusted plan equals the plain plan" stays green either way. I cannot read reads.mjs, so this is a question with its evidence, not a confirmed defect: `grep -n getTokenAccountsByOwner web/test/mock-rpc.mjs web/src/lib/reads.mjs`.

### F6 — INFO — one unhandled distribute race code

**Construct.** `crank.mjs` `DISTRIBUTE_RACE` omits `NoActiveVaults`; the tick planned by the crank can be refused with it only if a host ticks AND strangers join every waiting vault between plan and send. One false "distribute (monthly, free)" page, at most once a month, never a value effect. **Fix.** Add `NoActiveVaults` to `DISTRIBUTE_RACE` (it is already judged against a moved epoch).

---

## The accepted limits: the four questions

1. **Worse than stated?** None found. Limit 10's figures (150 bps floor, 180 s, 30 bps, cap × windows) are what the code enforces; the `!st && expired` residual is stated. Limit 25's "one hung socket lapses a window" is still exactly true: `crank.mjs` builds `new Connection(rpc, 'confirmed')` with no request timeout, so the measured 300 s stall still exceeds the 2-minute window; the limit states it, and no repair claims otherwise. Limit 27's cost on other holders is stated. Limit 7's reconcile-lane silence is stated.
2. **Not actually a limit / closed unnoticed?** Item 22 is mostly exercised (F2). Round 44 C09's "ignored file" worry is closed by `ls-files --others` as written. Nothing else.
3. **DISCHARGED not discharged?** Item 54's CU figures were measured on unstripped bytes; stripping changes no executable byte and the suite re-ran 912/912 on the stripped ones (VALIDATION `d2ae5fc`), so 54 stands. 12/17, 14, 19, 30, 31, 33, 51 stand.
4. **OPEN AND BLOCKING quietly treated as accepted?** Item 22.2's FAIL (F2). Items 38, 50, 52 are correctly still open (`charter_opens_at`, `lock_deadline`, `vault_collection` null; pages built, not published).

---

## Anything else

- **Gate-5 items still open:** round 43 item 5 (`bitmapExists: !!bm` without an owner check), round 46 C08/C09 recommended arms, the C10 release-wallet outflow watch (limit 56), `CBOB_ALARM_REHEARSAL` through `rehearsalOnly`.
- **HOLDER-GUIDE vs code:** every promise I could trace holds except the standing one item 50 already names ("Every opening is public… announced on X") while the poster has no sender; the guide is DRAFT and item 50 forbids publishing it before that ships.
- **The rehearsal signing page (option 1):** Gary's real wallet signed rehearsal transactions on a hosted page. Not re-litigated; I note only that `walletRefusal` and the strict wallet-edit judge are the whole protection against a page serving a wrong transaction, and the real programs cannot yet be reached (placeholder).

---

## What this project should do before launch that AI audit structurally cannot

1. **A soak on the real deployment between step 10 and step 11.** Run the alarm, the crank (dry, then `--live`) and the revenue job against the REAL programs at the ruled values for several days before removing the upgrade authority, with at least one real 10 SOL cycle through each venue and one hand recovery at that size. The rehearsal proved the I/O at 0.1 SOL and throwaway values; nothing has run this code at 10 SOL against real liquidity.
2. **A guardian drill in the real wallet.** Gary pulls `emergency_stop_sales` and `emergency_stop_sweep` and `cancel_swap_operator` on the rehearsal-class deployment from Phantom, at an hour he did not choose, and the alarm's page is seen to arrive and be acted on. The rehearsal record lists no brake step.
3. **Delivery at 3 a.m.** Force one CRITICAL through the production router to Gary's phone and measure time-to-human. Every detector in this tree ends in `notify-gary-sms.sh`; no test here can prove a person wakes.
4. **The 2,100-record crank.** Item 22's scale residual: run the live crank against a local validator holding 2,100 real records with an RPC that rate-limits and drops one call in a thousand, and read the fee spend, pass duration and page count. AI can review the loop; only a run shows the fourteen-batch cadence against a live-shaped RPC.
5. **An outside reproduction of the deployed bytes.** After step 9 and before step 11, have someone who has never touched the box run `git checkout d2ae5fc && ./scripts/build-mainnet.sh` on their own machine and compare `dist/SHA256SUMS` with `solana program dump` of each id, and confirm the remote `solana-verify` status reads verified. The GitHub workflow is a start; one more pair of hands is the point.
6. **Fix F1 before the first diagnostic runs unattended on the production box**, and decide F2's 22.2 question in writing; both are an afternoon.