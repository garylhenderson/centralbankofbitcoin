

# ROUND 47 — OFF-CHAIN CONFIRMATION PASS

**Scope read whole:** `bank/` (crank, detectors, alarm, layout, accrual, swap, revenue, rehearsal-env, poster, selftest, spl, anchor, lock, sigwalk, txread), `scripts/` (rehearsal-tree, token-programs, cron-install, check-launch-params, build-mainnet, run-tests, core-watch, core-watch-suite, readme-facts, sbf-strip, rehearsal-run), `sim/swap-fork.*`, `launch/*.json`, `web/test/*`, MINT + SWEEP source, SPEC / HOLDER-GUIDE / DESIGN-v6, round-46 verdict + VALIDATION, the rehearsal RECORD, README.

**Not in this pass's bundle (claims touching these are stated as unverifiable here, not inferred):** `web/src/lib/*` (reads, decode, enc, ids, ix, my-vaults, plan-*, tx, ceremony-reads), `scripts/rehearsal-steps.mjs`, `rehearsal-recover.mjs`, `rehearsal-refresh.mjs`, `pob-merkle.mjs`, `web/deploy/rpc-proxy.mjs`, `web/gen-errors.mjs`, `web/meta/generate.mjs`, `web/src/config.js`, `tests/expiry-budget.mjs`, `scripts/audit-coverage.sh`, `.github/workflows/verifiable-build.yml`.

**Result of this independent pass: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW. Two INFO findings, both in the never-before-audited Core-watch code added after round 46.** I do not file against the swap, crank, alarm, arithmetic, layouts, or the five programs: I re-derived their load-bearing math from first principles (below) and it held. I also do not re-file the round-46 confirmed items, the carried gate-5 obligations, or any accepted limit.

---

## R0. Round 46's verdict and its repairs

I verified each round-46 repair against this tree by reading the construct, not the verdict's description.

| Repair | Present here? | What I checked |
|---|---|---|
| V46o-1 (asset-less ack arm drives the ackable kind) | **Yes** | `bank/selftest.mjs` now drives `unredeemable_owner` (the one ackable kind) with no asset and a well-formed ack keyed `unredeemable_owner:undefined`, asserting `['CRITICAL', false]`; the old `scan_gap` case is kept beside it asserting no `ackRefused`. `detectors.mjs:1118` still returns an asset-less finding untouched. Removing the `!f.asset` guard now makes the arm red. |
| V46o-2 (undelivered pass rolls back unreadable counts/skips) | **Yes** | `alarm.mjs` `!delivered` block sets `next.unreadPasses = prev?.unreadPasses ?? {}` and `next.unreadSkips = prev?.unreadSkips ?? []` alongside the cursor/backlog rollback. The selftest's `undeliveredWalk` extracts main()'s actual write + rollback lines and proves X is skipped on the third *delivered* pass, never "moved past" while the cursor is before it. |
| V46o-3 (load-time refusal pages through the literal production notifier) | **Yes** | `rehearsal-env.mjs:refuseStrayOverridesAtLoad` pages via `PRODUCTION_NOTIFIER` and writes the stage marker before `exit(3)`. `revenue.mjs` and `alarm.mjs` call it at module load, before their `rehearsalOnly('CBOB_REHEARSAL_NOTIFY')` read (so the notifier override is itself refused). Selftest R46 V46o-3 arms drive a stub exec/exit. |
| V46o-4 (placeholder is a tracked, pinned fixture) | **Yes** | `ceremony.test.mjs` reads `web/test/fixtures/placeholder/{cbob_placeholder.so,src/lib.rs,SHA256SUMS}` and pins sha256 `94f75099…`, 20,920 bytes. |
| V46o-5 (instrument computes bundle claims) | **Cannot verify here** | The repair lives in `scripts/audit47.ts`, which is the *next* round's instrument and is not in this bundle. I record it as unverified in this pass, not as confirmed. |
| V46-7 (SPEC 53 re-proof sentence) | **Partial** | The round-46 VERDICT confirms it; the full SPEC item-53 text is excerpted only. The `e7c192a` rehearsal-proof log is named in VALIDATION. I could not re-read SPEC 53 in full. |
| V46-8 (init key by network/genesis) | **Yes** | `check-launch-params.mjs:REHEARSAL_INIT_AUTHORITIES = { mainnet:[Gary], local:[seed-7] }`; `judgeRehearsal` refuses the wrong key per genesis; `rehearsal-run.mjs:initKeyFor`, `judgeInitAccount` (refuses a program-owned/data-carrying init account). Selftest R46 V46-8 arms both directions. |

**Post-46 (rehearsal-found) repairs, checked:** the REHEARSAL-OPEN collection status (`ceremony.test.mjs`), the wallet-edit judge + page compute budget (`tx.test.mjs` R47 block, `ceremony.test.mjs` R46 Phantom-wrap block), the per-token-program stray listing (`plan.test.mjs` R46 Helius block), the Core re-pin to `51d41542…` (`run-tests.sh`, `build-mainnet.sh`, `core-watch.mjs` all carry the same pin — cross-checked below), and the stripped build (`sbf-strip.sh` sourced by both `run-tests.sh` and `build-mainnet.sh`).

**Cross-check of the four Core-pin copies** (the round-43 defect class where one copy was left behind): `run-tests.sh`, `build-mainnet.sh`, and `core-watch.mjs`/`core-watch-suite.sh` all read or pin `51d41542456639a01820c747e72b9d3b4ca258930a5bbb7e78db0cda133dc209`. `selftest.mjs` R43 pins four copies (run-tests, e2e-localnet, run-sim, build-mainnet) as one value. **`core-watch.mjs:readPin()` reads the pin out of `run-tests.sh` rather than holding a fifth literal** — this is the right shape and cannot drift. I found no fifth, unpinned copy in this bundle.

---

## R1. The crank (`bank/crank.mjs`)

I re-derived the plan/send order against MINT's gates and found no plan the program will refuse for a reason the crank should have known, no pay/join of a dead vault, and no out-of-order reveal.

- **Order:** reschedule → capture → reveal (mint order) → rescue → retire → preJoin → preExpire → split → distribute → postExpire → activate → claims. This satisfies MINT's `BoostsExpireFirst` (expires before distribute), `JoinWaitingFirst` (joins before distribute), and red-team-3 finding 6 (activate after distribute). The selftest's R39 C01 block extracts main()'s actual send block and asserts this order; I re-read it and it matches.
- **Dead vaults:** joins skip `assets[r.asset] === 'burned'` and non-`'live'`; claims skip burned and non-live; activate requires `'live'`. A burned vault is retired, never joined/paid. Matches limit 27's crank-side control.
- **Reveal order:** the loop walks from `cfg.revealed_total` and `break`s at the first not-ready vault, so nothing is sent out of order; `capturedThisPass` lets a just-captured vault reveal in the same pass. `judgeRevealAttrs` distinguishes `send` / `revealed` (already has `level`) / `mismatch`.
- **Value movement:** every instruction the crank builds is a permissionless MINT call; the selftest pins the exact set and asserts no token/SOL transfer and no non-MINT programId. I confirmed `rescue_nested` pins `cfg.bank_treasury` as `new_owner` (MINT refuses `WrongRescueDestination` otherwise), so the crank cannot steer a rescued vault anywhere else.
- **Fee budgeting:** `budgetPlan` runs the base plan whenever it's covered, then buys reveals in mint order down to the `FEE_FLOOR_LAMPORTS` reserve; `planCostLamports` charges one signature per reschedule/capture/reveal/rescue/retire/activate plus batched joins/expires/claims and the per-reveal Core attribute rent. I checked the `ceil()` batching and the reveal-rent constant (16 × 6,960) against item 54's measured figures; consistent.

No finding.

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I checked the required pages against the code and looked for a dangerous state read quiet and a routine state paged every pass.

- **Fixed-forever values:** `detectStandingRisks` production list pins 21%/51%/3-day, 7-day notice, the three tighten bounds (1 SOL / 24 h / 0.1 SOL), 30-day month, 1-hour redemption window, 2,100 supply, the census, cbBTC mint, Squads treasury, reserve mints, PoB root/collection, $CBOB mint and boost ceilings. I compared each to `launch/mainnet-init.json` and to MINT's `initialize` bounds — they agree.
- **Five programs + sweep watched:** `readConfigs` reads ProgramData for seal/mint/burn/gov/sweep/core + the four third-party programs; `detectUpgradeAuthorityAfterLock` iterates all five of ours; WATCH pins `prog.sweep.{upgrade_authority,hash}`. The ELF-at-45 rule (`readProgramData`) is asserted against immutable mainnet programs.
- **Pending guardian / swap operator, PoB collection plugins + update authority, redemption window near-full, frozen/insolvent pool, distribution overdue:** all present and wired (selftest I4 pins the exact detector-call arguments in order).
- **Dangerous-state-quiet sweep:** I specifically re-checked `detectSweepState` (the account-state backstop), the `cooldownSeen = min(...)` rule (a thief can't widen the window by executing a longer cooldown), and the `landed`-only explanation of uncertain sends. These hold.
- **Routine-state-paged sweep:** the frozen-pool transition (`applyFrozenTransitions`) pages once then stands at INFO; the crank-health `coveredFreezes` pruning prevents a covered freeze from streaking. The rehearsal RECORD's `watchdog_gap` during the deliberate Core-upgrade pause is the alarm working as designed, not a false-positive class.

No finding in the alarm itself. (One gap in the *new* Core-watch beside it — see FINDINGS.)

## R3. The layouts (`bank/layout.mjs`)

- Every struct's field list is parsed out of the Rust by `parseRustStruct` and compared name-and-type; the parser throws on a private/`pub(crate)`/multi-line field (round-22 L1). I confirmed MINT's `MintConfig`/`VaultRecord` field lists in `lib.rs` match `STRUCTS` (the selftest does this mechanically; I spot-read `boost_expiring: [u32; BOOST_RING]`, `carry_scaled: u128`, the stage-3c appends).
- Every cross-program pinned offset (`OFF_*` in GOV/BURN/MINT and the suite's own `OFF_*`) is scraped and compared to `offsets()`. The round-24 D6 repair (SEEDS asserted against each program's `*_SEED`) is present and now a gate.
- `collectionPluginsHash` hashes only the plugin region (past name/uri/num_minted/current_size), so a mint doesn't page but a royalty change does. I re-checked the offset walk (33 → two length-prefixed strings → +8).

No finding.

## R4. The money arithmetic (`bank/accrual.mjs` vs MINT)

I re-derived each formula against `lib.rs` line-for-line:

- `credit`: `delta = avail·ACC_SCALE / w`; `owed += delta·w`. Matches.
- `owed_of` / `pendingScaled`: `weight·acc + carry − debt`, with `weight = LEVEL_WEIGHTS[level−1] + boost`. Matches; the negative case throws rather than paying.
- `ceil_sats`, `available`. Match.
- `reweigh` (boost start/end): moves owed to `carry`, restarts `debt` at the new weight, adjusts `total_active_weight` by the delta. The crank's `preExpired`/`joinedNow` claim-owed formulas (`atExpiry + levelWeight·Δacc`, and `levelWeight·(newAcc−oldAcc)` for a fresh join) match the program's `expire_boost`→`reweigh`→`credit` sequence. I walked the selftest's L4 boost arms and they pin exact sat values, not batch counts.

No divergence found.

## R5. The swap (`bank/swap.mjs`) and revenue cycle (`bank/revenue.mjs`)

I re-derived the pieces the prompt names, independently of the round-25/46 conclusions:

**(a) Oracle math.** `sats = lamports·sol_price·10^(es−eb) / (btc_price·10)`. For es=eb=−8 this is `lamports·sol/(btc·10)`, i.e. `(lamports/1e9)·(sol·1e−8)/(btc·1e−8)·1e8` — correct sats. The exponent is applied to numerator/denominator in BigInt before division; the division floors, and `minSats = expectedSats·9850/10000` floors again, so the on-chain floor is never *above* the honest oracle output minus 150 bps. `satsPerLamport` converts to `Number`; with the enforced exponent range −18..0 and realistic USD prices the mantissa loss is ~2⁻⁵² relative, which is ~14 orders of magnitude inside the 100 bps deviation gate — not a pass/fail flipper. The hand-pinned vector (2 SOL → 280,355 expected, 276,149 floor) is asserted literally in selftest R40 C02.

**(b) Pyth verification.** I recomputed the `PriceUpdateV2` offsets: disc(8) + write_authority(32) + verification_level tag(1, must be `1`=Full) + feed_id(32) + price(i64) + conf(u64) + expo(i32) + publish_time(i64). The code reads level@40, feed@41, price@73, conf@81, expo@89, publishTime@93 — correct. Ownership by the receiver, derived sponsored-feed PDA, full verification, exact feed id, staleness 180 s, future-stamp ≤30 s, confidence ≤30 bps, exponent −18..0 all enforced. The account is a PDA owned by the receiver program, so only the (watched, third-party) Pyth programs can write it; the age is judged against the chain Clock sysvar, not the box clock. This is within the stated trust of the Pyth programs, not an independent hole.

**(c) Deviation filter.** `orcaSpot = (sqrtPrice/2⁶⁴)²` is sats-per-lamport for the wSOL(A)/cbBTC(B) pool, a_to_b. `meteoraSpot = 1/(1+binStep/10000)^activeId` is the inverse of lamports-per-sat for the cbBTC(X)/wSOL(Y) pool — sats-per-lamport. Both compared to the oracle's `satsPerLamport` symmetrically at ±100 bps. Directions are correct (I re-derived the DLMM convention; DeepSeek's round-46 inversion claim stays disproved).

**(d) Minimum out.** Orca `other_amount_threshold` and Meteora `min_amount_out` both carry the *same* `minSats` the deviation read produced (re-priced at `m2`, floored against `m1` by the 200 bps requote drift). Units are base cbBTC sats on both venues. Correct.

**(e) The judge.** `judgeSwapInstructions` requires the exact 7-instruction sequence, checks the output account is the operator's own cbBTC ATA, the amount, the floor bytes, Orca's direction + sqrt-price-limit, no priority fee, one signer, and both ATA creations for the operator's own wallet/mint. The round-46 C08 claim (writable/signer flags ignored) stays disproved: those flags collapse into the message header, and a flag cleared on every occurrence of a key fails on chain loudly. The same-tree-tamper residue is accepted limit 10(c); the post-swap delta check (`delta < guaranteed` throws, cycle stays open) is the backstop and is present.

**(f) Account derivation.** Orca tick arrays `[s0, s0−span, s0−2span]` (a_to_b pushes price down), `span=88·tickSpacing`, seeded `"tick_array"+pool+startString`. Meteora bin arrays `[i, i+1, i+2]` (Y→X moves active bin up), `i=floor(id/70)`, seeded `"bin_array"+pool+i64`. Oracle PDA, vaults/reserves read from the pool, event authority, `host_fee_in=None` as program-id, two token programs. All match the published IDLs. At a tick/bin boundary or an uninitialized array the venue program refuses — loud, no value moves.

**(g) wSOL handling.** Wrap exactly `lamportsIn`, SyncNative, swap, CloseAccount back to owner. A pre-existing wSOL balance, freeze, delegate, or stranger-created ATA either fails the whole atomic tx loudly or is swept back to the operator on close (it is the operator's own account). Nothing is left wrapped (fork test SW.1a/SW.4a assert the wSOL account is gone).

**(h) Failure/retry.** Meteora is tried only on a *refused* Orca outcome from `classifySendFailure` (preflight refusal, landed-with-error, expired-unlanded); an `unknown` outcome throws and never falls through, so a confirmation timeout on a swap that later lands cannot double-swap. The cycle stays open until a cbBTC return is proven on chain and split (`cycleIsOpen`). I traced all four catch handlers to `rememberAttempt` and the `pending*Sig` fields.

**(i) Extraction bound.** The on-chain floor caps pool-price extraction at 150 bps of the cycle; the read-time gate caps pool selection at 100 bps from the oracle. At the ruled 10 SOL cap (~$1,200) that is ≤ ~$18 per cycle, and only against a pool the attacker must themselves move ~100 bps (a ~$10M Orca pool or ~$0.9M Meteora pool) with a privileged position (no public mempool). Per month at the 6 h cooldown ceiling this is bounded and is the accepted limit-10 trust in the two pool programs + oracle. I found no path that exceeds the stated bound.

**Revenue cycle ledger:** `--audit` counts a refused sweep as nothing swept (R37 C04), the open-cycle guard uses the single `cycleIsOpen`, and the split-recovery scan (`splitsSince`) collects a refused read and keeps scanning (V44o-2), naming the signature for hand recovery rather than closing on it. I could not make a failed cycle read as closed.

No finding in the swap or revenue cycle.

## R6. The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

- Floors are EQUALITY checks (`-eq`), not lower bounds, in `run-tests.sh` and `bank/selftest.mjs` (FLOOR=1072), and SPEC's stated counts are checked at *every* occurrence. I confirmed the detector floor (1072), on-chain (912), allocation (39), poster (24), launch (69), mainnet (35), swap-fork (16), expiry (4), web (801) are each pinned and cross-referenced.
- The round-24 "both directions" arms are real: I spot-checked that each detector has a fire and a quiet case, and that the wiring gate (`alarm.mjs USES every detector's result`) strips comments and requires the result to be consumed, with cut-each-detector mutations turning it red.
- `scripts/build-mainnet.sh` proves all five programs: mainnet build REJECTS the localnet key, localnet ACCEPTS (behavioural, both ways), sweep helper mainnet-bytes == localnet-bytes == `target/deploy` bytes, source names Gary's key in all four keyed programs, and the tree must be clean. The stripped bytes are what it ships.
- `scripts/cron-install.sh` arms revenue/crank only behind a preserved, tagged, uncommented `--live`; the selftest runs the real shell preservation logic and asserts commented/prose/foreign lines don't arm it. It refuses a rehearsal tree. **It installs exactly six jobs — see FINDINGS for the one watcher this excludes.**

## web/test (holder pages' offline tests)

I judged whether each test can fail when its named property breaks:

- `mine.test.mjs` (NEW): drives `vaultsOwnedBy` against a mock chain where the index/listing tells every possible lie (not-owned, wrong collection, burned, no record, record-for-another-asset, retired, spoofed owner program, wrong record owner) and asserts each lists NOTHING, while the two real vaults are listed and each is verified on chain. It also asserts the relay accepts the exact request shapes. Non-vacuous *as a test*; the implementation it exercises (`web/src/lib/my-vaults.mjs`, `reads.mjs:vaultsOwnedBy`) is in the other pass, so I could not independently confirm the verifier checks every property the test names — I flag this as a measurement limit, not a finding.
- `tx.test.mjs` R47 block: the Phantom-wrap judge accepts a bounded compute-budget + Lighthouse wrap and refuses a wallet budget below the page's measured need, a changed/removed/reordered/dropped instruction, an in-between guard, an over-cap priority fee, a heap-frame budget kind, a new-writable or added-signer guard, and a changed fee payer. Comprehensive and able to fail. The implementation (`judgeWalletEdits`, `signExact`) is in the other pass.
- `bundle.test.mjs`, `ceremony.test.mjs`, `plan.test.mjs`, `decode.test.mjs`, `ids.test.mjs`, `meta.test.mjs`: each compares the page/bundle output to the suite's own extracted builders or to official deserializers (mpl-core, spl-token AccountLayout), byte-for-byte. The ceremony test's collection-resolution, decoy, creator-verification, and dust cases are driven both ways. I found no arm that cannot fail.

---

## THE FOUR ACCEPTED-LIMITS QUESTIONS

**1. Is any limit WORSE than stated?** I re-derived the ones with arithmetic and found none worse:
- **Limit 10 (swap hop):** throughput ~34 SOL/day (hourly job + 6 h chain-clock cooldown landing a few seconds after the read) matches the stated figure; the operator's worst case is still cap × cooldown windows until the guardian stops it, and the Orca/Meteora/Pyth change does not enlarge it (the operator could always just keep the swept SOL; the floor protects the *honest* swap, not against a malicious operator). The stated trust list (two pool programs, oracle, one RPC, same-tree integrity, third-party upgrade keys) is accurate. Not worse.
- **Limit 26 (last-slot leader grind):** the best-of-4 + block-content residual is as stated; I found no amplification.
- **Limit 32 (redemption cap):** the 64-slot ring makes the cap *stricter* above 3,047 live, never looser; the rolling-window property holds.
- **Limit 41 (leaked custodial key):** transfers unlimited, redemptions capped — as stated.

**2. Is anything listed as a limit not actually a limit / already closed?** No. I checked that the bitmap-extension owner check (round-43 gate-5 item 5, `swap.mjs:428` `bitmapExists: !!bm`) is **still open exactly as carried** — a stranger can dust the Meteora bitmap PDA and make the *fallback* venue refuse loudly; it is a grief surface, not a value path, and it is tracked, not quietly closed.

**3. Is any DISCHARGED item not actually discharged?** I spot-checked 14 (duplicate attributes → `DuplicateAttribute` in `check_attributes`), 19 (no unlevelled-activated vault → `activate` requires level 1..=5), 30 (`split_bps` written once, no `update_wiring`), 51 (boost built, owner-only, buyer's terms), 54 (compute measured). All hold in the current source. None found falsely discharged.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still explicitly open. The rehearsal RECORD honestly marks **item 22.2 as FAIL** (the alarm's second pass caught the real 2026-10-09 Core upgrade — a true detection the driver wasn't told to expect) and states what it does and does not prove. `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline`, and `vault_collection` OPEN, and `check-launch-params.mjs` refuses while any is. Nothing is being smuggled to "accepted."

---

## FINDINGS

### INFO-1 — The Core watch is documented as a cron but nothing arms it, and nothing checks that it is armed.

**Construct:** `scripts/core-watch.mjs` (header: *"cron, every 10 minutes"*), the round-46 change note (*"scripts/core-watch.mjs (NEW, cron) now watches Core"*), and `README.md` (*"[scripts/core-watch.mjs](…) reads the deployed Core…"* described as the standing watch). But `scripts/cron-install.sh` installs exactly six jobs (watcher, crank, crank-reveal, revenue, reconcile, deadman) and has **no core-watch line**, and `bank/selftest.mjs` *pins* that exclusion:

```js
t('the template installs exactly the six v6 jobs',
  installs.map(...).sort(), ['crank','crank-reveal','deadman','reconcile','revenue','watcher'])
```

There is no other installer in the tree and no deadman for core-watch (the existing deadman watches only `bank/state.json`).

**What an accident gains:** Nothing malicious — but if Metaplex upgrades Core (which happened three times in five weeks, including once from an unpublished repo mid-rehearsal), the *alarm* still pages `prog.core.hash` drift within 30 minutes, yet the piece that is core-watch's unique value — automatically running the full suite against the new bytes — does not happen unless someone hand-added a crontab entry that no gate verifies. The "runs every 10 minutes" claim is unenforced. Detection is covered; diagnosis is not.

**Evidence that would exist if I am right:** `grep -c core-watch scripts/cron-install.sh` → `0`; `crontab -l | grep -c core-watch` on the box → `0` unless hand-added; the selftest's six-job assertion passes only because core-watch is absent.

**Fix:** add a tagged core-watch line to `cron-install.sh` (e.g. `*/10 * * * * … node scripts/core-watch.mjs >> $LOGDIR/core-watch.log 2>&1 $TAG core-watch`) and move the selftest to seven jobs, or strike "(cron)" from the notes/README/header and document it as a hand-run diagnostic. Either makes the claim and the tree agree.

### INFO-2 — `core-watch-suite.sh`'s validator lock is private to itself; it cannot see the certifying suites, and a hard kill mid-swap leaves the shared Core cache off-pin.

**Construct:** `scripts/core-watch-suite.sh` waits on `$CACHE/VALIDATOR.lock` and `pgrep -x solana-test-val`. But `scripts/run-tests.sh`, `sim/run-sim.sh`, and `web/test/e2e-localnet.sh` never create or consult `VALIDATOR.lock` (they serialize only by killing `solana-test-val` and freeing ports 8999/9900). The process-name check also misses those runners' build/deploy phases, when no validator is up.

**What an accident gains:** If Core changes and core-watch-suite.sh starts while a certifying suite is in its build phase, both fight for ports 8999/9900 and for `.cache/core-mainnet.so` (which core-watch swaps to the new bytes). The interaction is **fail-closed, not fail-open**: `run-tests.sh` re-hashes the cache against its hardcoded pin and dies loudly if core-watch has swapped it, so no false certification can result. The residual is (a) a wasted/diagnostic run colliding with a certifying run, and (b) if core-watch-suite.sh is SIGKILLed between `cp "$NEW" …` and its `restore` trap, `.cache/core-mainnet.so` stays off-pin and every certifying run refuses until the pinned bytes are restored by hand — which is the intended "re-pin is a decision" behaviour, but reached by crash rather than by choice.

**Evidence that would exist if I am right:** `grep -l VALIDATOR.lock scripts/run-tests.sh sim/run-sim.sh web/test/e2e-localnet.sh` → no matches (only `core-watch-suite.sh` uses it); killing the suite mid-run leaves `sha256sum .cache/core-mainnet.so` ≠ `CORE_SHA256_EXPECTED`, after which `run-tests.sh` dies at its pin check.

**Fix:** have the certifying runners and core-watch share one lock token (or have core-watch also `pgrep` the runner scripts, not just the validator binary), and write the Core cache swap through a temp file + rename so a kill cannot leave a half-swapped `core-mainnet.so`.

---

## MEASUREMENT LIMITS OF THIS PASS (stated, not implied)

- I ran **nothing**: no validator, no `run-tests.sh`, no fork/sim/e2e, no crank/alarm/revenue against an RPC, no router delivery, no mainnet read. All verification is by reading the bundled source and the recorded logs (912/912, 1072/1072, 801/801, 152/152, 71/71, 16/16 at `d2ae5fc` in VALIDATION).
- Files listed in the pass-split as belonging to the other pass (all of `web/src/lib/*`, the three rehearsal step/recover/refresh modules, `web/src/config.js`, `rpc-proxy.mjs`, `expiry-budget.mjs`, `audit-coverage.sh`, the verifiable-build workflow) I did **not** read; claims about them are marked unverifiable here. The web tests I reviewed are non-vacuous as tests, but the implementations several of them pin live in the other pass.
- V46o-5 (the audit instrument's bundle claims) and the full SPEC item-53 text could not be independently re-verified in this bundle.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what must be done before launch that AI audit structurally cannot

1. **Execute road steps 9–11 with real keys, in order, by a human.** AI can read and plan but cannot sign: Gary's wallet must sign the four `initialize` calls (step 10), and the deploy authority `FZjLB4…` must sign each `solana program deploy`-upgrade and each `set-upgrade-authority --final` (step 11). The dump-and-check (prefix hash matches `dist/`, trailing bytes zero) must be performed and recorded *after* each step, and the `solana-verify` remote-build parameters uploaded **before** `--final`, because an immutable program can never sign an upload again.

2. **Fill the three OPEN launch values and run `check-launch-params.mjs` to a clean gate.** `charter_opens_at` (Gary), `lock_deadline` (= charter open − ≥24 h), and `vault_collection` (created at step 10) are still null. Until they are RULED/filled and the checker passes, nothing is launchable — this is a decision, not an audit.

3. **Take custody decisions out of the code and into operations for the four hot secrets:** the swap-operator key, the $CBOB release wallet, the Giraffish Moments collection key (through the 7-day charter window, limit 46), and the deploy authority. The code bounds each, but their storage, backup, and the person who can move them are human responsibilities AI cannot hold. In particular, decide whether the Giraffish Moments key stays hot through the charter window (the ruling) or is multisig'd for those seven days (the only thing that would close limit 46).

4. **Arm the Core watch (INFO-1) and confirm the alarm's delivery channel end-to-end at 3 a.m.** The rehearsal proved the alarm *detects* a live Core upgrade; a human must be the one who, on that page, runs the diagnostic suite, judges the result, and decides whether to re-pin. Rehearse that decision loop once, deliberately, before launch — including who has authority to halt the charter window if Core breaks mid-claim.

5. **Publish the holder surfaces (item 50) before the holder guide.** The redeem page's `judgeRedemptionCoverage` is the only pre-signature control for limits 9 and 44; until it is published, those limits have no preventive control in production. This is a launch precondition, not something an audit can ship.

6. **Run a scale exercise of the crank/alarm beyond five vaults before real payouts.** Item 22's own caveat stands: the rehearsal proved live I/O at 5 vaults, not ~2,100. The cost/rate-limit/paging behaviour of a full claim fan-out is only observable at scale, and only a human can decide the acceptable dress for it.

7. **Keep a human in the loop for every `--final` and every re-pin.** Immutability is the product's promise and its permanent risk (limit 39). The irreversible acts — removing upgrade authorities, re-pinning Core after a Metaplex change, executing a guardian stop — should each be a named human's deliberate signature, with the AI audit as the check beside it, never the replacement.