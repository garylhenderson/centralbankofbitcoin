# Round 27 independent audit — off-chain pipeline, sweep helper, and the round-26 repair tree

Scope note on what I could and could not execute. I read the whole bundled tree and re-derived the load-bearing arithmetic, account derivations, and control flow by hand. I did **not** re-run the frozen validator suite (844), the detector selftest (789), the Test Vault sim (71), the swap fork (16), or any live revenue/crank/alarm pass; where I cite those counts I attribute them to `audits/round26/VALIDATION.md` and say so. Nothing below that depends on a live run is represented as one. I made no change to the audited code.

---

## R0 — Round 26's verdict and its repairs

I re-verified each of the nine confirmed round-26 findings against the current source. All nine repairs are present and, on re-derivation, hold. I did not re-file any of them; I looked for a surviving or newly introduced defect at each site.

**L1 (candidate signature loss) — repaired, holds.** `rememberAttempt` (`bank/revenue.mjs`) extracts `SW.sendFailureSignature(error)` and writes `pending{Sweep,Swap,Return,Split}Sig` + `pendingSwapVenue` before rethrowing. I traced all four catch sites:
- sweep: `if (verdict.outcome !== 'landed') { rememberAttempt(cycle,'Sweep',e,led); throw e }` — the `unknown` branch.
- swap: `if (verdict.outcome !== 'refused') { rememberAttempt(cycle,'Swap',e,led,venue); throw e }` — the `unknown` branch, and it correctly does **not** fall through to the next venue.
- return and split: `.catch(e => { rememberAttempt(...); throw e })` unconditionally.
The `refused` branch keeps the signature as `refusedSig`, never `sweepSig`, so `rejected_row_has_sweep` still has teeth. A signature-less error saves nothing (correct — there is nothing to save). The extracted-function arms in `bank/selftest.mjs` (`R26 Sweep/Swap/Return/Split`) exercise exactly this. No surviving loss.

**L2 (`splitByOther` anchor) — repaired, holds.** Both the anonymous and explicit claim branches in `detectSplitClaims` now route through `closesCycle`, which anchors on `returnBlockTime` (chain time) when present and falls back to the documented 60 s box-clock slack only for legacy rows. I re-derived `closesCycle`: it requires `splitTime >= anchor`, `splitTotal >= returnedSats`, respects `exclude` and `upTo`, and sorts by time so the first covering split wins. The `R26` arms (early split refused, at-time split accepted, one split cannot anchor two rows, an already-claimed split cannot anchor an anonymous one, too-small split refused, legacy slack retained) match the code.

**L3 (revenue notice streams) — repaired, holds.** `REVENUE_STAGES` + `revenueNotices` (`bank/detectors.mjs`) emit one label per stage (`cbob-revenue:<stage>`), recover only a stage that (a) has a marker, (b) is in this run's `passed`, and (c) is not the currently failing stage. `publishRevenueNotices` writes the failure marker before notifying and removes a recovery marker only after successful delivery, so an undelivered recovery retries. I traced `enterStage` and confirmed the success path adds every stage including the terminal one, and that a cooldown no-op (`passed = {lock, config}`) cannot clear a `swap`/`recovery`/`open-cycle` marker. The `R26` router arms and the stage-recovery arms are consistent with the code.

**L4 (reconciliation memory) — repaired, holds.** `reconcile()` now reads `RECONCILE_STATE`, passes `prevPaged`, sets `fullPass = complete` (where `complete` requires a readable `minted_total` and zero index findings), and on an incomplete census merges `prevPaged` with `sent.paged` so prior conditions survive and no recovery is sent. It uses `RECONCILE_LABEL` and `RECONCILE_FAILED`, distinct from the main watch's `RUN_FAILED`, so a reconcile failure cannot clear (or be cleared by) the main-watch marker and vice versa. The harness arms in the selftest match this.

**L5 (launch gate not using the imported alarm) — repaired, holds.** `judgeLaunch` now builds `cur` with every production-valued field (`max_supply`, `level_caps`, `payment_mint`, `bank_treasury`, `reserve_mints`, `pob_root`, `pob_collection`, `cbob_mint`, `max_boost_weight`, `max_boost_epochs`, and charter via `charter_opens_at`/`charter_closes_at`) and runs `D.detectStandingRisks(cur, { production: true })`. I cross-referenced the alarm's production `want` list against `cur` and against `PINS`: all twenty production keys are covered by both. Unknown non-underscore fields are rejected (`has no launch validation rule`), and any field not marked `RULED` is rejected. The `L5` arms (each changed field produces a `test_value_in_production` string containing that field's name) are satisfiable from the code.

**L6 (rehearsal cron installer) — repaired, holds.** `scripts/cron-install.sh` refuses before any crontab/logrotate write when `$R/REHEARSAL-RECORD.txt` exists. The prelude-harness arms confirm refusal and a production-root control.

**D3 (swap-fork floor in the SPEC-count gate) — repaired, holds.** `bank/selftest.mjs` `RX` now includes `'swap': /(\d+) swap-fork assertions\b/g`, and the floor map reads `SWAP_FLOOR` from `sim/swap-fork.sh`. SPEC states "16 swap-fork assertions" in the Running-the-tests block, which the regex matches.

**D1 (rehearsal header counts) — repaired.** The header now reads "five fresh program keypairs" and "exactly six substitutions … the five mainnet ids, and the repo root path," matching the executable `PROGS` (five entries incl. sweep) and the map (+root = six).

**D2 (judge helper-independence comment) — repaired.** The judge's doc no longer claims it shares no primitives with the builder; it states the shared ATA/discriminator/byte derivations and that pool-owned liquidity accounts are validated by the venue. Accurate.

I also re-checked a sample of the round-26 **rejected** claims and found the rejections still sound (e.g. Deepseek C1's CPI-signer-spoofing is impossible because `invoke_signed` derives signers under the *invoking* program's id; Deepseek M1's budget miscount is refuted by `budgetPlan` counting fee + rent and keeping the FIFO prefix). I did not re-run those measurements.

**R0 conclusion:** the round-26 repair set is real, not relocated. I found no surviving instance of any of the nine, and no regression introduced by the repairs.

---

## R1 — The crank (`bank/crank.mjs`)

I re-derived `planCrank` and the send order. What I verified:

- **Order is join-before-distribute and expire-before-distribute.** Send order is reschedule → capture → reveal → retire → preJoin claim batches → `expire_boosts` (before) → split → distribute → `expire_boosts` (after) → activate → claim batches. The planned denominator `w = total_active_weight + preJoinWeight − retiringWeight − expiringWeight` matches the on-chain weight at distribution time given that exact order. Retiring vaults are excluded from `preExpires` (so no double subtraction of boost weight). I could not construct a plan where `w` goes negative except the legitimate all-retired → 0 case, which routes to the tick branch.
- **Reveal FIFO is real.** Reveals start at `revealed_total` and stop at the first vault that is neither `entropy_set` nor being captured this pass; `capturedThisPass` is valid because captures are sent before reveals in the same pass. A benign or failed reveal breaks the loop (correct, since order is mandatory). The attribute list is read off the live asset and hash-checked (`judgeRevealAttrs`) before any fee is spent; a list already carrying `level` is classified `revealed` (done elsewhere), a tamper is `mismatch`.
- **No dead vault is paid or joined.** Burned assets are retired, never joined/paid; `'other'` (unreadable) assets are excluded from joins and claims and reported, and an unreadable eligible vault suppresses the distribution (`joinable=false`), matching `JoinWaitingFirst`.
- **Fee budgeting prioritizes non-reveal work.** `budgetPlan` drops reveals last, keeps the mint-order prefix, and refuses only when even the non-reveal plan is unaffordable. `planCostLamports` counts claim *batches* and `ceil(preJoins/CLAIM_BATCH)`, `ceil(expires/EXPIRE_BATCH)` correctly.
- **Value confinement.** Every instruction built is a permissionless MINT instruction (`activate, capture_entropy, claim, distribute, expire_boosts, reschedule_reveal, retire_burned, reveal_level, split_revenue`); there is no token or SOL transfer authored by the crank and no program but MINT. The key signs only as fee payer.

I looked for a plan the program would refuse, a reveal sent out of order, and a plan that pays/joins a dead vault, and did not find one. The known races (a stranger splitting → `NothingToSplit` benign; a host distributing between plan and send → `judgeDistributeRefusal` re-reads and calls it benign only if `dist_epoch`/`last_distribute_at` moved; `PoolShort` always a fault) are handled.

No finding.

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

- **Fixed-forever watch is complete.** I enumerated every `initialize`-permanent field and confirmed each is in `WATCH` at CRITICAL (all four collections, `reserve_mints`, `governance`, `pool_ata`, `bank_treasury`, `split_bps`, `max_supply`, `payment_mint`, `level_caps`, `pob_collection`, `pob_root`, both charter bounds, `monthly_secs`, `redeem_window_secs`, `notice_secs`, the three tighten bounds, `cbob_mint`, both boost ceilings, the three GOV tally values). `WATCHED_KEYS` + `missingWatchedKeys` force `readConfigs` to produce all of them; a reader that drops one is named.
- **Five programs + Core + third parties watched.** `detectUpgradeAuthorityAfterLock` covers seal/mint/burn/gov/**sweep** past the lock deadline (earlier of `lock_deadline` and `charter_opens_at`), and the four third-party programs (Orca, Meteora, Pyth receiver, Pyth push) are watched at HIGH with `NO_PROGRAMDATA` as a value, never "not deployed."
- **Pending guardian / swap operator, PoB collection plugins + update authority, redemption window near-full, frozen/insolvent pool, overdue distribution, unswept royalties, crank silence/health** all have detectors whose trigger and quiet conditions I re-derived. The pool insolvency check reads `owed_scaled` and the pool atomically (`getMultipleAccountsInfo`), so a claim landing between the two reads cannot fake insolvency.
- **`detectUnsweptRoyalties` grace follows the on-chain cooldown** (`max(24h, cooldown + revenue-cron-period + 1h)`), and the clock restarts on any balance fall (a sweep). A capped-but-working sweep never pages; a dead one does. I could not construct a routine state that pages every pass, nor a dangerous state that reads quiet, within the stated detector set.

No finding.

## R3 — The layouts (`bank/layout.mjs`)

- Each struct's field list is asserted field-for-field against the Rust via `parseRustStruct`, and the parser throws on any line it cannot read (private/`pub(crate)`/multi-line fields no longer drop silently). The pinned cross-program offsets (GOV/BURN/MINT `OFF_*` constants and the suite's own copies) are compared to computed offsets. I spot-checked `OFF_RESERVES=41` against the SealConfig layout (disc 8 + version 1 + collection 32 = 41) and it is correct.
- **Round-24 D6 (the SEEDS assertion that did not exist) now exists.** `SEED_SRC` maps all eleven `L.SEEDS` entries to their `pub const *_SEED` declarations and the arm asserts `[count, judgeSeeds] == [11, []]` and proves a mistyped or unmapped seed is caught. I counted eleven seeds in `L.SEEDS` and eleven mappings. This repair is real.
- `decode`/`encode` round-trip, refuse wrong discriminator/version/truncation/non-bool bytes, and `readPinned` pins owner + discriminator + version before any offset.

No finding.

## R4 — The money arithmetic (`bank/accrual.mjs`)

I compared each function to MINT line-for-line:
- `credit`: `delta = avail*ACC_SCALE / w` (floor), `acc += delta`, `owed += delta*w` — matches MINT `credit`. Dust stays in the pool; `owed` never exceeds what was credited.
- `pendingScaled`: `(levelweight + boost)*acc + carry − debt`, throws on negative — matches `owed_of` (carry added before debt subtracted, so a weight decrease never needs negative debt).
- `reweigh`: moves owed to `carry`, restarts debt at the new weight, adjusts the denominator by the difference — matches MINT `reweigh`.
- `ceilSats`, `available`, `debtAtActivation` match `ceil_sats`, `distribute`'s avail, and `join`'s debt.
The crank's per-case owed computation (plain, joined-now at old-acc debt, pre-expired at level weight after expiry) is consistent with these. The crank expires every DUE boost before distributing (`preExpires`) and every boost its own distribution makes due right after (`postExpires`), and the alarm pages `boosts_stalled` and treats `cbob_mint` and the boost bounds as fixed-forever. I found no divergence.

No finding.

## R5 — The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

**(a) Oracle math.** `oracleFloor` computes `sats = lamports * sol.price * 10^(sol.expo−btc.expo) / (btc.price * 10)`. I re-derived this from `lamports/1e9 * SOL_USD/BTC_USD * 1e8` and it is correct for both exponent signs (`e>=0` multiplies the numerator, `e<0` the denominator). `expectedSats` and `minSats` are floored; flooring the *minimum out* is <1 sat less protective, negligible. Confidence/age/future checks run per feed before any arithmetic.

One observation, filed as INFO because (a) explicitly asks about BigInt→Number overflow:
- **INFO-1 — `orcaSpot` converts a u128 `sqrtPrice` to `Number`, which is lossy above `Number.MAX_SAFE_INTEGER`.** Construct: `bank/swap.mjs` `orcaSpot`. For the pinned SOL/cbBTC pool the Q64.64 sqrt-price is ≈2.2×10^17 (> 9×10^15), so `Number(w.sqrtPrice)` drops low bits. The relative error is ≈10^-16, fourteen orders of magnitude below the 100 bps (10^-2) deviation threshold, so no venue-eligibility decision can flip, and the on-chain floor (not this float) bounds the actual output. Evidence if I am right: recompute the deviation with the exact BigInt squared price vs the float; the delta is < 10^-12 bps. No fix required; if exactness is ever wanted, compare `sqrtPrice^2` against the oracle in BigInt. This is a correctness-of-representation note, not a value-moving defect.

**(b) Pyth verification.** `readPyth` requires the account be owned by the receiver, be FULLY verified (`level==1`; Partial refused), and carry the expected feed id, then reads price/conf/expo/publishTime at offsets 73/81/89/93 (disc 8 + write_authority 32 + level 1 + feed 32). I re-derived the `PriceUpdateV2` offsets and they match. Ownership + derivation is sufficient to exclude an external writer (only the receiver program can write its owned account); a stale `publish_time` is caught by the 180 s age bound and a future one by the 30 s bound, both judged against the **Clock sysvar** (owner-checked in `market()`), not the box clock. The residual — a compromised/upgraded Pyth receiver writing a chosen price into the derived account — is exactly the third-party trust in accepted limit 10(d), not a new hole.

**(c) Deviation filter.** `orcaSpot` is `(sqrt_price/2^64)^2` = sats per lamport (A=wSOL, B=cbBTC, a_to_b sells SOL); `meteoraSpot` is `1/(1+bin_step/10000)^active_id` = sats per lamport (X=cbBTC, Y=wSOL, selling SOL is Y→X). Both are the same unit as the oracle's `satsPerLamport`, and the direction is right for both venues (I sanity-checked against the fork fixture `activeId=5920` ≈ the ~7160 lamports/sat implied by the pinned prices). Float rounding near the 100 bps edge can only change whether a venue is *used*, never defeat the on-chain floor.

**(d) Minimum out.** The same `minSats` (oracle expected − 150 bps) is used for the deviation decision's reference and as `other_amount_threshold` (Orca) / `min_amount_out` (Meteora), in sats, which is the output unit for both (Orca a_to_b outputs token B=cbBTC; Meteora Y→X outputs X=cbBTC). One floor, correct units.

**(e) The judge.** `judgeSwapInstructions` requires the exact seven-instruction sequence and checks: exactly one compute-unit-limit (400,000) and **no** compute-unit-price (priority fee refused); both ATA creations are for the operator's own wallet and the correct mint (wSOL at index 1, cbBTC at index 4); exactly one System transfer of exactly `lamportsIn` into the operator's own wSOL ATA; SyncNative of that account; the venue swap with amount=`lamportsIn`, threshold=`minSats`, output account = operator's own cbBTC ATA (key 5 both venues), input = operator's own wSOL ATA (Orca key 3 / Meteora key 4), signer in the venue's authority slot, and for Orca exact-input a_to_b + the pinned sqrt-price limit; and exactly one CloseAccount of the wSOL ATA back to the owner. Token instructions are limited to SyncNative/CloseAccount. I confirmed it does check the output account, the min-out bytes, the direction byte, the amount, the priority fee, and the ATA creations' owner/mint. What it does **not** do is validate pool-owned liquidity accounts (tick arrays, bin arrays, vaults/reserves, the Meteora host-fee slot) — those are left to the venue program, and a builder defect there is caught after the fact by the post-swap delta check (`delta < guaranteed` throws, cycle stays open). That scoping is stated in the judge's own comment and is within the box-owner trust model; I do not file it as a new defect.

**(f) Account derivation.** Orca tick arrays for a_to_b are `[s0, s0−span, s0−2span]` (price/tick falls when selling A), with correct negative-tick flooring (I re-checked `orcaTickArrayStarts(-88733,16) = [-90112,-91520,-92928]`). Meteora bin arrays for Y→X are `[i, i+1, i+2]` (active bin rises when buying X), with correct negative-id flooring. The bitmap is passed as the program id when absent (Anchor "None"), and `host_fee_in` is always None in the honest builder. At a tick/bin boundary or an uninitialized array the venue refuses, which is treated as a refusal and falls through to the next venue or opens the cycle loudly — a liveness outcome, not a loss.

**(g) wSOL handling.** Wrap exactly `lamportsIn`, SyncNative, swap, close back to the operator. Pre-existing wrapped SOL belongs to the operator and is returned by the close (the swap is exact-input, so only `lamportsIn` is consumed). wSOL cannot be frozen (native mint has no freeze authority) and only the owner can delegate it. Nothing is left wrapped.

**(h) Failure and retry.** Orca first; Meteora only on a genuine refusal (preflight refusal, or landed-with-error, or expired-unlanded — all resolved via `classifySendFailure` asking the chain). An `unknown` outcome (confirmation timeout with no settled status) **never** tries the next venue and never confirms; it records a candidate signature and rethrows, leaving the cycle open. A confirmation timeout on a swap that later lands cannot produce a second swap automatically, because the open-cycle guard blocks a new cycle while `cycleIsOpen`. I re-derived `cycleIsOpen`: a cycle is closed only when `returnedSats > 0` AND (`splitSig` OR `splitByOther`). Therefore a failed sweep/swap/return (returnedSats=0) or a returned-but-unsplit cycle is always open; **the ledger cannot read a failed cycle as closed.** The `sendRejected` flag closes only a true refusal (nothing moved), and a refused row carrying a sweep signature/amount is itself `rejected_row_has_sweep` CRITICAL.

**(i) Extraction within tolerance / operator worst case.** The on-chain floor bounds any swap to no worse than 150 bps below the oracle; the deviation gate refuses a pool >100 bps away. For a 10 SOL swap against the ~$10M Orca pool the price impact is far below the tolerance, so a sandwich is not economically meaningful there; the ~$0.9M Meteora pool is thinner but still large relative to 10 SOL, and the floor caps the downside regardless. Worst case per cycle is bounded by the tolerance, not by pool depth. Per month, at the ruled 10 SOL / 6 h cap (≈40 SOL/day), the absolute ceiling is a small multiple of the tolerance applied to royalty SOL only. The operator key's worst case is unchanged in kind and is now bounded by the program cap/cooldown plus detection rather than by an HTTP allowlist: a thief of the key can keep swept SOL up to the cap per cooldown until the guardian stops it, and can decline to return swapped cbBTC, but both are detected (`unreconciled_swap`) and neither can reach a vault, the pool, or sale cbBTC. This matches accepted limit 10 as restated; I did not find it worse.

No CRITICAL/HIGH/MEDIUM in the swap or revenue cycle.

## R6 — The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`, `scripts/build-mainnet.sh`, `scripts/cron-install.sh`)

- Floors are **equality**, not lower bounds, in the detector selftest (`FLOOR=789`, `R.length !== FLOOR` fails), the on-chain suite (`MIN_ASSERTIONS=844` with an explicit `-eq` check), and the `floor()` helper. SPEC's stated counts are checked at **every** occurrence for all nine floors including the swap fork. I found no floor satisfiable by deleting work.
- The wiring gate (`wiringGate`) strips comments string-aware, reads each function body, and counts a detector call only where its result is consumed; the round-24 L13 arms prove deleting/commenting/discarding a call turns it red. The ID gate checks every program-id copy and each deploy keypair's derived public key, and an empty/missing file fails (not vacuous). The control-table gate mechanically verifies ON-CHAIN rows name a real error variant and AUTOMATIC rows name a cron-installed file.
- `scripts/build-mainnet.sh` builds and verifies **all five** programs: mint/burn/gov/seal are behaviorally asked whether they trust the test key (mainnet must REJECT, localnet ACCEPT), and the sweep helper is proven byte-identical across `dist/`, the fresh localnet rebuild, and `target/deploy/` (the bytes the suite deployed). It refuses a dirty tree and records the commit. This covers the helper, which has no key to ask about.
- `scripts/cron-install.sh` arms money only from an uncommented, tagged, job-anchored `--live` line (revenue and crank), preserves nothing else, refuses a rehearsal tree, and installs exactly the six tagged jobs. The reveal lane cannot arm the full pass (both flag orders checked). I found nothing armed that should not be.

No finding.

---

## The accepted limits — the four questions

**1. Is any limit WORSE than stated?** I did not find one. I re-checked the ones that immutability locks in:
- Limit 10 (swap operator): the exposure is cap × elapsed cooldowns until the guardian stops it, bounded also by what the revenue PDA holds above the reserve; detection fires within the unreconciled grace (~60 min), which is inside one 6 h cooldown, so realistically ~one cap. Not worse.
- Limit 28 (frozen pool): since stage 3c a frozen pool forfeits the undelivered share rather than locking the vault, and the in-line monthly run never credits from a frozen pool; stated accurately.
- Limit 32 (rate limit): the 64-slot ring makes the cap stricter above 3,047 live, never looser; accurate.
- Limit 41 (transfers not limited): still true and correctly not claimed to stop a thief.

**2. Is anything listed as a limit not actually a limit / already closed?** Limit 42's old categorical "only two fit" was already corrected in the round-26 text (the narrow 1,219-byte owner-payer variant fits three creates offline); the limit now accurately describes the prior-transaction requirement for the padded page shape. I found no limit that is silently already closed.

**3. Is any DISCHARGED item not actually discharged?** I re-checked items 51, 54, 12/17, 14, 19, 30, 31, 33 and the v5 family that went with the Bank/co-signer/deck/distributor. Each is either built and gated (51 boost, 54/12/17 compute), closed on chain (14, 19, 30, 31, 33), or removed with the component it described (1a–24 family). None appears to be falsely discharged.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22 (dress rehearsal incl. both-venue revenue cycle and forced post-sweep failure), 38 (charter date + lock deadline still OPEN in `launch/mainnet-init.json` and refused by the checker), 50 (holder surfaces; guide marked DRAFT and explicitly unpublishable), 52 (pool/Squads/revenue ATAs), and 53 (rehearsal re-run at release commit) are all still represented as open, and the code does not assume them done. The holder guide's present-tense surfaces remain behind the item-50 block.

---

## Findings summary

| ID | Severity | Construct | What it is / is not |
|---|---|---|---|
| INFO-1 | INFO | `bank/swap.mjs` `orcaSpot` | u128→Number conversion is lossy (~10^-16 relative), far below the 100 bps gate; no decision can flip; on-chain floor bounds output. Not value-moving; recorded only because R5(a) asks. |

I found **no CRITICAL, HIGH, or MEDIUM** defect that survived independent re-derivation. I am stating that rather than manufacturing a finding: the nine round-26 repairs hold, and the areas most likely to hide a survivor (the swap judge/floor, the crank's weight/denominator planning, the revenue open-cycle predicate, the layout/seed assertions, the gate floors) are the ones I re-derived by hand. The absence of a finding here is a statement about this tree under static and arithmetic review, **not** a certification of the live behaviors I could not run.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what must happen before launch that AI audit structurally cannot

1. **Execute the mainnet dress rehearsal (item 22) on a real rehearsal deployment and record signatures.** AI can specify and check it; only an operator can actually run the live crank against ~2,100 records, the live alarm in rehearsal mode, **one full live revenue cycle through Orca and one with Orca forced to refuse (so Meteora really runs)**, and **one forced post-sweep failure walked through the hand-recovery runbook to `--audit` clean**. This is the single largest thing no static or fork test substitutes for.
2. **Perform the launch-value signing ceremony from `launch/mainnet-init.json` (item 38).** A human must fill the two OPEN values (charter opening date, lock deadline ≥24 h before it), re-run `check-launch-params.mjs`, and build the four `initialize` transactions *from that file* — the checker validates the JSON, not the signed bytes.
3. **Create the three cbBTC accounts and fund the revenue address above rent (item 52)** before the first paid mint/split, then verify on chain.
4. **Remove the upgrade authority from all five programs only after 1–3 pass and the redeem page ships (item 50/road step 11).** This is irreversible and must be a deliberate human act, with the deployed bytes re-verified against `build-mainnet.sh`'s sha256s immediately before. The redeem page (deposit addresses, `judgeRedemptionCoverage` pre-signature warning, sweep-through-helper, prior-ATA creation) must exist before the lock, because items 9 and 44 have no preventive control until it does.
5. **Make the custody decisions that are rulings, not code:** the Giraffish Moments hot key through the 7-day charter window (item 46 — cold/multisig during the window would close a project-ending exposure), the swap-operator key float, the guardian key, and the whole-$CBOB release wallet (item 56). These are human custody choices the code cannot enforce.
6. **Reproduce the build on a second independent machine.** Since there is no human firm, the closest substitute for a second set of eyes on the *bytes* is an independent rebuild from the release commit confirming the five sha256s and the sweep-helper byte identity, done by someone who did not run this audit.
7. **Run the live mainnet probe and swap fork as part of the ship gate (not skipped):** `run-tests.sh` permits a no-network skip; the certifying run must show both actually ran (their floor lines printed), per the ship-gate condition.

The through-line: everything above the line in items 1–7 is an *action on a live cluster or a custody decision*, which is precisely the part an AI audit cannot perform and cannot certify by reading. The immutable programs make the ordering non-negotiable — all of it before the authority is removed.