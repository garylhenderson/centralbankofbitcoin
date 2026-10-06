## 0. R0 — Round 28 verdict and repairs

Round 28 was **NOT CLEAN**: 7 confirmed topics (M1 MEDIUM, L1-L4 LOW, D1-D2 INFO). HEAD here is `de3d56f`, the repair commit on top of audited `93f8c36`.

Independently re-exercised against this tree:

* **M1 — `Log truncated` accepted as complete: REPAIRED, holds.** `bank/txread.mjs` now refuses the exact standalone runtime marker `Log truncated` before any cursor advance, while `Program log: Log truncated` text still validates. `bank/selftest.mjs` R27-V1/R28-M1 arms both directions against the captured `tests/fixtures/mainnet-v1.json` fixture and the three actual consumers (alarm walk, `splitsSince`, poster loop) are asserted to hold cursors and save nothing on truncation. No consumer advances on refused coverage.
* **L1 — chain vs wall clock: REPAIRED, holds.** `bank/alarm.mjs` now keeps `wallSec` (`Date.now`) and `nowSec` (Clock sysvar) separate. Chain deadlines (`detectUpgradeAuthorityAfterLock`, `detectMissingComponents`, `detectDistributionOverdue`, `detectRedemptionRate`, `closesCycle` anchors, `cycleStartMs` with `chainNow`) use the chain clock; local durations (heartbeat age, watchdog gap, royalty observation, crank silence) use the wall clock. Legacy mixed `revenueSince` migrates with a one-time `revenue_age_unknown` notice and retry-safe domain flag. `bank/crank.mjs` refuses to plan when the Clock is unreadable; it does not fall back.
* **L2 — heartbeat truncated to 50 problems: REPAIRED, holds.** The crank now writes the full `plan.problems` array. R28 selftest rotates 150 distinct problems and reaches 150 `crank_problem` streaks at the third heartbeat.
* **L3 — rehearsal omits `launch/`: REPAIRED, holds.** `scripts/rehearsal-tree.sh` now substitutes `programs bank scripts tests sim launch Anchor.toml`, proves byte-exact reverse, refuses abbreviated-id leftovers, and the R28 arm proves `launch/create-cbob-token.mjs` path isolation with an omission counterfactual.
* **L4 — redemption evidence forgotten: REPAIRED, holds.** `rememberRedemptions` persists confirmed `burn_via_program` asset+signature evidence across passes; `correlateBurns` uses it and maps only `absent` on the redeemed asset to INFO. Generic failed/foreign/malformed reads stay loud.
* **D1/D2 INFO — stale SPEC opening / holder timing: REPAIRED, holds.** SPEC no longer claims “not yet a multi-model round” in its opening; `HOLDER-GUIDE.md` now says the draw job checks every minute and busy queues take longer.

No old claim is re-filed. No surviving defect from round 28 was found.

## R1. Crank — no plan the program refuses, no dead-vault pay, no out-of-order reveal, no value move

* `planCrank` joins only positively-live assets, never joins/pays a positively-burned vault, retires it first at any level; eligible-but-unreadable blocks distribution with a `problems` entry (`JoinWaitingFirst` would refuse it on chain).
* Reveal is strictly FIFO from `revealed_total`, stops at the first not-ready, counts a same-pass capture as ready; send loop breaks on first failure/benign. Attribute hash is checked before any fee; `revealed`-elsewhere vs `mismatch` distinguished.
* `NothingToSplit` benign; refused `distribute` re-reads config and is benign only if `dist_epoch`/`last_distribute_at` moved, never for `PoolShort`. Split planned only into live-unfrozen pool **and** Squads ATA; retiring share freed before `avail`; frozen pool plans no distribute/claims.
* `budgetPlan` sends captures + affordable reveals in mint order instead of all-or-nothing; fee floor sized from `planCostLamports` including Core attribute rent.
* Source scan: only `reschedule_reveal/capture_entropy/reveal_level/retire_burned/claim/distribute/expire_boosts/activate/split_revenue` built, no SPL/System transfer constructed, no program but MINT, free `distribute(false)` only. Key signs as fee payer only.

If a refused-plan, dead-pay or out-of-order claim were true, the 888-assertion selftest crank block or the 855-assertion on-chain suite would show a landed refusal with that shape. None does.

## R2. Alarm — nothing dangerous reads quiet, nothing routine pages every pass

* Fixed-forever drift covers collections, reserves, governance PDA, pool, treasury, 85/15, supply, payment mint, census, PoB collection/root, charter window, monthly/window/notice, all three tighten bounds, `$CBOB` mint and both boost ceilings, plus all four GOV tally fields. Pending operator/guardian, PoB plugins + update authority, five program authorities + byte hashes, Core + four third-party programs watched.
* `redemptions_near_cap` idle-window guard, `pool_frozen`/`pool_insolvent`/`pool_unreadable`, `distribution_overdue` with join/boost/launch-tick stalls, `reveal_queue_stalled`, `crank_silent`/`crank_posture_unreadable`/`crank_failing`/`crank_problem`, `royalties_unswept` with cooldown-following grace, `revenue_unsplit` with split-anchored clock, freeze-once-then-INFO transitions all present and wired (selftest L13b gate derives the call list and fails on deletion/comment/result-dropped).
* Production values assert 30d/1h/7d/1 SOL/24h/0.1 SOL/21%/51%/3d/supply/census/mints/treasury/reserves/PoB root/7d charter/boost 12/24/`$CBOB`/PoB collection. Rehearsal switch is exact-match fail-closed.

If a quiet-dangerous or noisy-routine claim were true, the both-ways arms for that detector would show the missing fire or the spurious fire. None does.

## R3. Layouts — assertions are real, a struct change cannot slip past

Field-for-field equality against every `pub struct`, strict parser that throws on private/`pub(crate)`/multi-line fields, every `OFF_*` scraped from GOV/BURN/MINT and the suite compared (including the L2 “none scraped and ignored” gate), `LEVEL_WEIGHTS`/`ACC_SCALE`/`REVEAL_WINDOW_SLOTS`/`readySlot` scraped, all 11 PDA seeds scraped, all layout versions scraped from every copy, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` scraped and evaluated less padding, round-trip + truncation/bool/version/discriminator/Vec refusals, collection plugin-hash blindness to counters proven. A drifted field, type, offset, seed, version, space or suite copy turns the build red.

## R4. Money arithmetic — mirrors the program

`credit`/`pendingScaled`/`pendingSats`/`reweigh`/`debtAtActivation`/`available`/`ceilSats` match MINT `credit`/`owed_of`/`reweigh`/`ceil_sats`/`join` line-for-line in BigInt, including boost + carry. Crank expiry-before/after, post-expiry owed math, retiring-share release and join debt verified with SATS-valued arms (L4). If a divergence existed, the 39 allocation assertions or the crank owed arms would show a sat difference. None does.

## R5. Swap and revenue cycle

(a) `oracleFloor` handles any expo sign with BigInt floor; `satsPerLamport` float is display-only for the deviation filter. Floor is oracle-minus-150bps rounded down. Fork shows Orca 1,400,902 and Meteora 1,400,725 vs 1,405,348 expected / 1,384,267 floor — ~32bps under, well inside 150bps after 16bps fee + impact.

(b) `readPyth` requires receiver ownership, Full verification, expected feed id, 180s age on the **chain** Clock, 30s future bound, 30bps confidence per feed. Production `market()` reads the two derived sponsored accounts + Clock in one batch through the single RPC. Ownership + derivation + Wormhole-verified Full is sufficient in this path; a forged fully-verified price would require forged guardian signatures. Clock is the sysvar with owner check; unreadable refuses.

(c) `orcaSpot=(sqrt/2^64)^2`, `meteoraSpot=1/(1+step/1e4)^id` proven against live accounts and the fork gate (both within 100bps to be used). Float error at the 100bps boundary is ~1e-12 relative, not decisive.

(d) Same `minSats` object flows from the post-sweep market read into `swapInstructions` and `judgeSwapInstructions`; Orca `other_amount_threshold` and Meteora `min_amount_out` both read at byte 16 as u64 sats.

(e) Judge requires the exact 7-instruction sequence with amount, floor, Orca exact-input/a-to-b/min-price, own wSOL in / own cbBTC out at pinned slots, operator authority slot, 400k CU limit with no price, both ATA creates for the operator, exact wrap, SyncNative, single close. Eight round-25 tampers refused by name on both venues. Pool-owned vault/tick/bin/oracle accounts are intentionally left to the venue program: a wrong one refuses on chain (liveness, not loss), and the post-swap delta check (`delta<guaranteed` throws, cycle stays open) catches a value-moving builder defect after signing.

(f) Tick arrays (current + two below for A→B), bin arrays (active + two above for Y→X), bitmap-or-program-id, `host_fee_in=None`, event authority, dual Token programs match published IDLs and land on the fork. Uninitialised/boundary arrays refuse safely.

(g) Wrap-exactly, sync, swap, close. Pre-existing wSOL balance is left wrapped then closed back to the operator as SOL; frozen wSOL refuses safely; delegate/creator do not change PDA ownership.

(h) Orca first, Meteora only on `refused` (preflight/on-chain-failed/expired-absent via `classifySendFailure` with history search). `unknown` stops open with `pendingSwapSig`, open-cycle guard blocks auto-retry. No path closes until return ≥ floor is recorded and split is proven.

(i) Within tolerance an adversary gets at most ~100bps pool-edge + 150bps floor ≈250bps plus ≤30bps confidence and ≤180s staleness per cycle. At the ruled 10 SOL (~$1.2k) that is ~$30/cycle, ~$120/day at 4/day, ~$3.6k/month worst-case sustained — bounded, counted, and small against the pool, but not a hard bound to true market price (correctly stated in limit 10). Operator worst case remains cap×windows until `emergency_stop_sweep`, never vault/pool/sale cbBTC; ledger uses `sendRejected`/`refusedSig` (never `sweepSig` on refusal) so a failed cycle cannot read closed, and an actually-landed sweep with no row still pages `unledgered_sweep`.

If any sub-claim were false, the 16-assertion fork, the L1/L2/L3/I1/I2/I3 selftest blocks or the revenue recovery arms would show the mispriced/accepted/misjudged shape. None does.

## R6. Gates

Floors must **equal** counts (on-chain 855, detector 888, allocation 39, poster 22, PoB 14, launch 47, mainnet 33, host 6, swap 16, expiry 4, sim 71) and are checked at every occurrence in SPEC. Deleting work lowers the numerator and fails equality; empty-input vacuity is refused by explicit non-empty requirements and throw-on-wrong-shape guards. `build-mainnet.sh` proves all five artifacts (four key-behaviour proofs + sweep byte-identity to localnet and to `target/deploy`), refuses dirty trees, records commit/toolchain. `cron-install.sh` installs exactly six tagged jobs, preserves `--live` only from tagged uncommented lines, runs revenue hourly below the ruled cooldown, refuses rehearsal trees.

## Accepted limits — the four questions

1. **Worse than stated?** No. Re-roll needs whole-window silence (with the round-22 correction that optional crank accounts make silence cheap — stated); C-leader best-of-4 + block-variation selection (stated with numbers); frozen-pool forfeit, Core heap/autograph boundary (stated as bounded observations), swap floor/confidence/pool-agreement bounds (stated as not a true-price bound), 64-slot ring cap to 3,047 then stricter (stated), unsplit-revenue hour-while-running (stated with stall growth).
2. **Listed but not a limit / already closed?** No. Narrow three-create 1,219-byte fit is noted as offline measurement, not a lifted client contract; prior-transaction preparation remains the page contract.
3. **DISCHARGED not discharged?** No. Boost, compute, deck/Bank removals, census/supply/round/notice branches all measured or gone with the thing they were about.
4. **OPEN treated as accepted?** No. Items 22/38/50/52/53 remain open with loud gates (dress-rehearsal named items, launch checker refusal, DRAFT-guide publish block, pool/revenue-account creation road step, stale-rehearsal-proof marker).

## Else — hardening INFO only, not blocking

* `readPyth` does not itself check `address==pythAccount(feed)`; production safety comes from `market()` requesting the derived accounts. Pin the address inside the reader for future callers.
* `idGate` unnamed-literal scan covers a subset of the rehearsal scope; full-scope coverage comes from the rehearsal reverse-proof + abbreviated-prefix refusal. Extend the gate file list to the rehearsal file list.

No CRITICAL, HIGH or MEDIUM survives measurement. Round 29 should be judged clean or not on its own reads; this pass finds no new blocking defect.

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS AND PROGRAMS WILL BE IMMUTABLE, what AI audit structurally cannot do before launch

1. **Run the live dress rehearsal with real keys and real money movement.** Execute item 22 verbatim at throwaway ids: crank live passes at ~2,100-record scale, alarm live passes in rehearsal mode, one full revenue cycle through Orca **and** one with Orca forced to refuse so Meteora runs, one forced post-sweep failure walked through hand recovery to `--audit` clean, plus the DAS burnt-asset read. Record every signature. AI can read the code; only landing proves fees, rate limits, RPC timeouts and hand steps.
2. **Reproduce the build on a second machine and verify deployed bytes.** Rebuild `de3d56f` elsewhere, compare all five `dist/` sha256, verify on-chain bytes, then have Gary’s key (which this box does not hold) prove acceptance. AI cannot bridge source-to-bytes-to-key.
3. **Witness the custody and lock ceremony.** Move `$CBOB` release custody off the box if ruled, fund operator float above 0.02 SOL with nothing else in it, fund revenue above rent, create pool/revenue/Squads cbBTC accounts, set both OPEN dates, remove all five upgrade authorities with independent witnesses recording each transaction.
4. **Load and chaos-test the off-chain pipeline.** 2,100 funded vaults, one RPC socket hung (the 300s stall), one frozen pool/vault/revenue account each, one truncated-log transaction, one 150-problem heartbeat — confirm paging, recovery and no cursor advance.
5. **Usability-test the unbuilt holder surfaces before publishing the guide.** Build the deposit-address page, coverage preflight with sweep-list rescue, payout-trigger-and-join offer, prior-transaction ATA preparation and packet-fit checks; test with strangers depositing dust mid-redemption. The guide must stay DRAFT until this ships.
