# AUDIT REPORT — v6 off-chain pipeline (round 26)

**Scope read whole:** `bank/crank.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`, `bank/accrual.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `bank/spl.mjs`, `bank/anchor.mjs`, `bank/lock.mjs`, `bank/sigwalk.mjs`, `bank/selftest.mjs`, `bank/redemption-poster.mjs`, `scripts/*`, `sim/swap-fork.*`, `programs/cbob-vault-mint`, `programs/cbob-vault-sweep`, SPEC/DESIGN/HOLDER-GUIDE, the round-25 verdict.

**Headline:** Round 25's repairs hold under re-measurement of the pure functions and re-reading of the I/O. I found **no new CRITICAL, HIGH, or MEDIUM**, and no theft path. Two LOW and one INFO survive, all in the swap's verification surface. The accepted limits are not worse than stated. This is a measurement result, not a confirmation: every "holds" below names what I checked it against.

---

## R0 — ROUND 25'S REPAIRS, CHECKED AGAINST THE CURRENT CODE

**L1 (judge exact-shape).** Holds. `judgeSwapInstructions` now takes `{lamportsIn, minSats}` and refuses unless the array is exactly the seven instructions `swapInstructions` emits, position by position: CU limit 400,000 with no keys and no `setComputeUnitPrice` anywhere; both ATA creations keyed `[owner, ata(mint,owner), owner, mint, System, Token]` with data `[1]`; one System transfer (disc 2, `owner → ata(wSOL,owner)`, exactly `lamportsIn`); SyncNative of that account; the swap with the pinned pool (key 2 Orca / key 0 Meteora), `ownWsol` in (key 3 / key 4), `ownCbbtc` out (key 5 both), amount at data[8..16], floor at data[16..24], Orca exact-input/a_to_b/MIN_SQRT_PRICE pinned; exactly one close back to owner. I traced all eight verdict tampers against the current code — each hits a named check on both venues. The honest build passes (verified instruction by instruction). The selftest's L1 arms include the proof that the *old* judge passed all eight, so the new arms can fail. **No regression:** the length check (`ixs.length !== 7`) fires independently of the positional checks, so an appended 8th instruction fails on length alone even when it is individually benign.

**L2 (chain Clock).** Holds. `market()` reads `SYSVAR_CLOCK_PUBKEY` in the same `getMultipleAccountsInfo` as the prices, requires the Sysvar owner, decodes with the crank's `clockUnixTimestamp` (i64 at byte 32 — correct Clock layout), and throws when unreadable. `oracleFloor` refuses age > 180 s and future > 30 s. Fork arms SW.7/7a/7b drive the real `market()` against the fork's Clock with fresh/stale/future stamps at the correct publishTime offset (93). **One caveat, not a defect:** the fork's *swap* path (SW.1/4/8/9) calls `oracleFloor` with `nowSec = max(publishTimes)`, not the fork's Clock, because a local validator's Clock is wall-clock and the cloned prices would read stale. Stated in the file; the chain-clock path is separately exercised by SW.7. Acceptable.

**L3 (classifySendFailure).** Holds. Preflight refusal → refused without a chain call; signature extracted from the error or the message; `getSignatureStatuses(..., searchTransactionHistory: true)`; landed+err → refused; landed+ok → landed; expired+no-status → refused; anything else (processed-only, failed lookup, no sig) → unknown, cycle stays open. Both call sites in `revenue.mjs` (sweep and swap) route through it. A refused sweep records `refusedSig`, never `sweepSig`, and the alarm's `rejected_row_has_sweep` / `unledgered_sweep` cover the case where that judgement is ever wrong. Holds.

**L4 (hourly cron, chain-clock cooldown).** Holds. `cron-install.sh` installs `41 * * * *`; the selftest's `cronPeriod` reads 3600 < the ruled 21600. `sweepCooldownOver` judges the Clock sysvar and returns false on an unreadable clock; `revenue.mjs` throws on an unreadable Clock before that. The alarm's `royalties_unswept` grace is `max(24h, cooldown + 3600 + 3600)`. Holds.

**L5 (rehearsal obligations).** Holds as text: item 22 now names the two live revenue cycles (Orca, and Orca-forced-to-refuse so Meteora runs) and the forced post-sweep failure walked through hand recovery. Not executed anywhere — correctly, since it is a rehearsal obligation, not a gate.

**L6 (offline arms + 10 SOL fork).** Holds. Selftest arms `orcaSpot`/`meteoraSpot`/`deviationBps` with synthetic values and drives 99/101 bps both sides through `market()` on both venues. Fork SW.8/SW.9 swap the ruled 10 SOL through both venues with the floor enforced on chain and the executed price recorded.

**L7 (program-ID copies).** Holds. `idGate` compares every copy (alarm, detectors, revenue, selftest, the four `declare_id!`), each `target/deploy` keypair's *derived* public key (ed25519 from the seed via node crypto, checked against the stored public half — a real derivation, not a read), and any unnamed base58 literal sharing a 4-char prefix. Fourteen mutation arms, each naming its file.

**I1 (returnBlockTime anchor).** Holds. `revenue.mjs` records `returnBlockTime` from `returnSig`'s block time; the recovery back-fills it before `closesCycle`; `closesCycle` anchors on it when present, falls back to the 60 s slack for legacy rows. Selftest arms both.

**I2 (third-party programs watched).** Holds. `THIRD_PARTY_PROGRAMS` (Orca, Meteora, Pyth receiver, Pyth push) are in the alarm's ProgramData loop, produce `NO_PROGRAMDATA` when absent, drift at HIGH, and are exempt from the pre-round-25-baseline drift and from `program_not_locked`.

**I3 (confidence 30 bps).** Holds. `MAX_ORACLE_CONF_BPS = 30`; arms refuse 31 and 99, pass 30 and the live 1.5.

**I4 (detector call arguments pinned).** Holds. `callsIn` extracts every `main()` detector call with a balanced-paren walk and compares to `PINNED`; two mutation arms (positional swap, wrong option value) each name the detector.

**D1/D2 (docs).** Hold. Limit 10's text now states the judge "catches OUR defects, never a tampered module" and lists the full trusted set (pool programs, Pyth, the one RPC, box integrity, the four third-party upgrade keys). Item 50 and the Known-Limits entry both say the helper is BUILT. HOLDER-GUIDE's swap sentence (fixed pools, Pyth floor, "up to 1.5% below Pyth's price") matches `SWAP_TOLERANCE_BPS = 150`.

---

## R1 — THE CRANK

I checked every planned action against the program's actual requires, in send order (reschedule, capture, reveal, retire, preJoin, preExpire, split, distribute, postExpire, activate, claim):

- **No plan the program refuses (beyond benign races).** Reschedule/capture/reveal match `reschedule_reveal`/`capture_entropy`/`reveal_level` including the FIFO (`revealed_total`, in-order, break at first not-ready). Retire matches `retire_burned` at any level. preJoins use `r.vault_ata` and the program's join path does not read the token account, so a missing ATA cannot fail a join batch. The distribute plan accounts for this pass's retirements (`retiringOwed`, `retiringWeight`), pre-joins (`preJoinWeight`), pre-expiries (`expiringWeight`), and the split (`splitToPool = total − total·1500/10000`, matching the program's floor-then-remainder). I verified a claim landing between plan and send does **not** change `avail` (pool and `ceil(owed)` drop by the same sats), so it cannot produce a false `NothingToDistribute` failure. A stranger's split is `NothingToSplit` (benign); a raced distribution moves `dist_epoch`/`last_distribute_at` and is judged benign only then (`judgeDistributeRefusal`), with `PoolShort` always a fault.
- **No dead-vault pay or join.** Burned assets are retired, never joined or paid; `'other'` (null RPC) is skipped with a problem and blocks the distribution (`JoinWaitingFirst` honoured off-chain).
- **No out-of-order reveal.** Strictly `revealed_total` upward; the attribute list is hash-checked (`judgeRevealAttrs`) before a fee is spent, `[]` only for a positively burned asset.
- **No unpinned value movement.** The selftest pins the instruction-name set and the absence of any token/system transfer; the key signs only as fee payer. `budgetPlan` trims reveals in mint order when the key is short and pages the dropped ones; the floor is the plan's cost (round-24 L6a ordering verified: `l < min` is checked before the ceiling branch).

**Null-safety check (a candidate I tried to break):** every `frozen` derivation (`pool`, `revenue`, `bank`, per-vault `tokens`) short-circuits on `state === 'ok'`, so a null account read never dereferences `.data`. Safe.

---

## R2 — THE ALARM

- **No dangerous state read as quiet that I could construct.** Fixed-forever values drift CRITICAL; pending guardian/operator page CRITICAL every pass of the notice; PoB collection plugins and update authority are watched; the redemption window near-full pages; pool frozen/insolvent/unreadable page; distribution overdue, joins/boosts stalled, launch tick overdue page; all five programs' upgrade authority past the lock page (sweep included); a scan cursor the cluster cannot resolve pages CRITICAL (this is the blind-scanner case, and it is caught because an unresolvable `until` returns empty, which the `sigs.length === 0` branch then probes). The ledger is held to the chain's sweeps and splits (amount in the instruction, block-time anchors, total-and-order anchor for both `splitSig` and `splitByOther`).
- **No routine state paged every pass.** The re-asserting kinds (`swap_operator_armed`, `guardian_armed`, `test_value_in_production`, `tx_unreadable`) are `level` in `ALARM_KINDS`, so the router suppresses repeats on the open stream and a recovery closes it; freezes page on transition and stand at INFO (`applyFrozenTransitions`); brakes page on transition. `detectRedemptionRate` is quiet on an idle window (round-22 A3 arm holds).
- **`missingWatchedKeys` is real:** every `WATCHED_KEYS` entry is produced by `readConfigs`' flatten of the four structs plus the ProgramData and collection reads, with the `_missing` exemptions scoped correctly.

---

## R3 — THE LAYOUTS

The assertions are real, not decorative. `parseRustStruct` is strict (throws on a private/`pub(crate)`/unreadable line) and the struct comparison is field-for-field including types. Cross-program `OFF_*` constants are scraped from all four programs and compared to computed offsets, with an explicit "nothing scraped goes uncompared" arm. **Round-24 D6 is fixed:** the seed assertion exists (`judgeSeeds`, 11 seeds scraped from the declaring programs, with mistyped/unmapped mutations caught). Layout versions and `BOOST_RING` are scraped; `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are evaluated from the Rust expression and held to `fixedLength` minus padding. Encode/decode round-trips and every refusal (discriminator, version, truncation, bad bool, incredible Vec length) is armed. A struct change cannot slip past: any of field, type, offset, seed, version, or space turns a different arm red.

---

## R4 — THE MONEY ARITHMETIC

`bank/accrual.mjs` matches the Rust line for line: `credit` (`delta = avail·SCALE/w; owed += delta·w`), `pendingScaled` = `owed_of` (`(weight+boost)·acc + carry − debt`, carry before debt), `reweigh`, `ceilSats` = `ceil_sats`, `available` = the `avail` computation, `debtAtActivation` = join's `weight·acc`. The crank expires every due boost before distributing (`preExpires`, `dist_epoch >= boost_end_epoch`) and every boost its own distribution makes due (`postExpires`, `boost_end_epoch === dist_epoch + 1`, run for both credit and tick since `advance_epoch` runs in both). The owed math for a pre-joined vault (`debt = weight·acc_old`, earns `weight·(acc_new − acc_old)`) and for a pre-expired vault (`atExpiry + weight·(acc_new − acc_old)`) matches the program's join/reweigh/claim sequence exactly. The alarm pages `boosts_stalled` and watches `cbob_mint`/`max_boost_weight`/`max_boost_epochs` as fixed-forever CRITICAL. No divergence found.

---

## R5 — THE SWAP AND THE REVENUE CYCLE

**(a) Oracle math — correct.** `sats = lamports·sol.price·10^(es−eb) / (btc.price·10)`; the `/10` is `1e8/1e9`. Exponent sign handled symmetrically (`num` or `den` scaled). Both divisions floor, which for a minimum-out floor is the non-refusing direction. Verified numerically: 2 SOL at the selftest's prices → 280,442 sats expected, 238,375 floor, `satsPerLamport` ≈ 1.4022e-4, self-consistent. `satsPerLamport`'s `Number` conversions are safe at Pyth magnitudes (~1e10, well under 2^53).

**(b) Pyth verification — sufficient, with one LOW below.** Ownership by the receiver plus derivation under the push program means only the receiver's Wormhole-gated write path can set the data; a *stale* price is submittable by anyone and is bounded by the 180 s age check; a *chosen* price requires forging the guardian set (the stated Pyth trust). The Clock sysvar is the same clock the on-chain programs use; its skew tolerance is seconds, far inside the 180 s/30 s bounds. Offsets (level @40, feed @41, price @73, conf @81, expo @89, publishTime @93) match the measured 134-byte account.

**(c) Deviation filter — correct direction both venues.** `orcaSpot` = `(sqrtPrice/2⁶⁴)²` = sats/lamport (A=wSOL, B=cbBTC); `meteoraSpot` = `1/(1+binStep/10⁴)^activeId` = sats/lamport (X=cbBTC, Y=wSOL, inverted). Float error at the live values is ~1e-9 bps against a 100 bps gate — cannot pass a pool it should refuse in any material sense.

**(d) Minimum out — same floor, right units.** `guaranteed = m2.f.minSats` rides as Orca's `other_amount_threshold` (data[16..24], sats of cbBTC out, exact-input) and Meteora's `min_amount_out` (data[16..24]). Same value, correct units both.

**(e) The judge — complete for the seven-instruction shape** (see R0-L1). Output account, min-out bytes, direction, amount, no fee drain, both ATA creations: all checked. What a tampered builder can still route past it: only (i) the unchecked swap keys that fail on chain anyway (vaults, tick/bin arrays, oracle, token program — the programs pin them to the pool), and (ii) Meteora's `host_fee_in` — see LOW-2. Anything further requires editing the judge, which is the accepted box-owner residue.

**(f) Derivations — correct.** Orca tick arrays `["tick_array", pool, String(start)]` with `[s0, s0−span, s0−2span]` for a_to_b (current and two below; `Math.floor` handles negative ticks correctly, verified at the −90112 boundary); oracle `["oracle", pool]`; vaults read from the pool. Meteora bin arrays `["bin_array", pool, i64LE(index)]` with `[i, i+1, i+2]` for Y→X; bitmap `["bitmap", pool]` or the program id as Anchor-None; `host_fee_in` None; event authority `["__event_authority"]`; two classic token programs. An uninitialized or boundary array fails on chain (loud, triggers the fallback), never a misroute.

**(g) wSOL — safe.** A pre-existing balance is returned on close (native accounts close with any balance, Token-2022 same rule); the wSOL mint has no freeze authority; a delegate cannot block the owner's close; exact-input consumes exactly `lamportsIn`; the close returns the remainder. Nothing left wrapped (fork SW.1a/SW.4a).

**(h) Failure and retry — sound.** Meteora is tried only on a proven Orca refusal (preflight, on-chain failure, or expired-unlanded), never on an unconfirmed send. A confirmation timeout on a swap that later lands is read off the chain (`landed`) and recorded, not double-sent. Every path leaves the ledger open until a return is proven and split (`cycleIsOpen` requires `returnedSats > 0` AND `splitSig`/`splitByOther`); the open-cycle guard blocks a new cycle; the recovery closes on chain evidence (`closesCycle`) before the `isProvablyEmpty` fallback. A failed cycle cannot read as closed.

**(i) Adversary bound.** Worst case per cycle is the floor: 150 bps of ≤10 SOL ≈ 0.15 SOL; at 4 cycles/day ≈ 18 SOL/month if *every* swap is maximally sandwiched — which costs the attacker their own impact both ways in a $10M pool, so the practical figure is far lower. A stale-but-accepted oracle only helps if the pool also sits near the stale price (else the deviation gate skips it). Meteora's thinner depth changes the cost of pushing it, not the 100 bps gate or the 150 bps floor. The operator key's worst case is unchanged and correctly stated: cap × cooldown windows until the guardian stops, never more than the revenue PDA holds above the reserve. The ledger cannot read a failed cycle as closed.

### LOW-1 — `readPyth` never checks the account discriminator
**Construct:** `bank/swap.mjs` `readPyth` reads bytes 0..8 never; the only content pin is the feed id at offset 41.
**Gain:** None today. The account is derived under the push program and owned by the receiver, whose only write path produces a `PriceUpdateV2`; a wrong account would need the exact feed id at offset 41, verification byte 1 at offset 40, receiver ownership, and the derived address — i.e., be the real account. This is defense-in-depth only: if the receiver were upgraded to shift the layout, the read would be silently wrong (the upgrade itself is watched at HIGH).
**Evidence if wrong:** a synthetic account owned by the receiver, length ≥ 101, byte 40 = 1, the expected feed id at 41, and a *wrong* discriminator parses without error. That is constructible in the selftest's style.
**Fix:** one line — compare `d.subarray(0, 8)` to the `PriceUpdateV2` discriminator and throw on mismatch.

### LOW-2 — the judge does not pin Meteora's `host_fee_in` to None
**Construct:** `judgeSwapInstructions` checks Meteora keys 0/4/5/10 and the data, but not key 9 (`host_fee_in`).
**Gain:** Bounded and conditional. The honest builder (`meteoraSwapIx`) always passes the program id (Anchor None), so this is not an "our defect" the judge misses; it needs a tampered builder, which is the accepted box-owner residue (such a tamperer can edit the judge). *If* Meteora's host fee is taken from the user's output, a tampered builder could route up to (expected − floor) to a chosen account, silent because `revenue.mjs`'s delta check only throws below the floor; if the host fee comes out of the pool's fee share (my reading of the DLMM interface), the operator's output is unchanged and there is no gain at all.
**Evidence if it matters:** a fork swap with a real token account as `host_fee_in`, measuring whether the operator's cbBTC delta falls below the no-host-fee case. The fork harness already builds Meteora swaps; this is one arm.
**Fix:** pin key 9 to the program id in the judge (`keyAt(sw, 9)?.equals(METEORA.program)`), and settle the fee mechanics with the fork arm above rather than from memory.

### INFO — the judge's comment overstates its independence
`judgeSwapInstructions`' header says the shape is "re-derived here from first principles … never by calling the builder's own helpers", but it shares the module-level `ata`, `disc`, and `readU128` with the builder. Functionally fine (the judge independently pins positions, programs, amounts, and the floor; the shared primitives are pure derivations, and a wrong `ata` fails on chain), but the sentence is false as written and this project has been burned by comments that out-claim the code. Reword it.

---

## R6 — THE GATES

- **Floors cannot be satisfied by deleting work:** all are equality (`-eq`), and the selftest's own `FLOOR` is held equal to `run-tests.sh`'s `DET_FLOOR`. Deleting assertions drops the count below the floor; lowering both floors is a two-file edit the freeze reviews.
- **No vacuous-when-empty check found with evidence.** The stated-counts gate fails on zero occurrences (`found.length > 0 &&`); the control-table gate requires `block.length >= 5`; the signer-set gate compares to a non-empty expected list; the wiring gate derives from `Object.keys(D)` and arms that specific detectors are in it.
- **Both-directions claim (round-24/25 sections):** I re-read every arm in both sections. Each repair has a fires-when-it-should and a quiet-when-it-should arm; L1 additionally proves the *old* judge passed all eight tampers (so the new arms can fail); L7 has 14 mutation arms; I4 has two. **I did not find a one-directional arm, and I will not fabricate one.** If one exists it is subtler than a read of the arm text reveals.
- **`build-mainnet.sh`** proves the four programs' INIT_AUTHORITY behaviourally (mainnet rejects / localnet accepts the test key, each) and the sweep helper by byte-identity across `dist/`, the localnet rebuild, and `target/deploy` — the strongest proof available for a keyless program. **`cron-install.sh`** arms nothing it should not: the preserve reads only our tagged, uncommented, end-anchored lines, and the selftest executes the real shell against commented-out, prose, foreign, reveal-lane, and both flag orders.

---

## THE FOUR QUESTIONS

1. **Is any limit worse than stated?** No. Limit 10's trusted set is now fully enumerated and the judge bounds the swap; the throughput ceiling (40 SOL/day) and the capped-sweep silence are stated. Limits 25, 26, 32, 46, 55, 56 read as measured. Limit 44 was *narrowed* by the helper (classic SPL rescuable) and the limit text says so.
2. **Is anything listed as a limit not actually a limit / secretly closed?** No. Limit 9 (foreign nested asset) stands — the helper moves classic tokens, not nested Core assets, and nothing detects those continuously. Limit 44 stands for Token-2022, frozen strays, and nested assets. None is closed by something the author missed.
3. **Is any DISCHARGED item not actually discharged?** No. 51 (boost) and 54 (compute) are measured; 12/17, 14, 19, 30, 31, 33 carry valid reasons; the v5 family went with the Bank.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain OPEN AND BLOCKING in SPEC; item 50's helper is built but the page is not, and the text says so; item 53's proof is explicitly marked stale.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What AI audit structurally cannot do is *execute, witness, and decide*. Concretely, before launch:

1. **Run the dress rehearsal with every named item, recorded with signatures** (item 22/53): the crank's live passes at ~2,100 vaults (RPC cost, rate limits, a transient error on vault 1,900, the every-minute lane in a sale burst), the alarm live in rehearsal mode, **one full revenue cycle through each pool** (Orca forced to refuse once so Meteora really runs), **one forced post-sweep failure walked through hand recovery**, and the DAS `burnt`-flag read (A17). No assertion suite substitutes for this; it is the only evidence for the entire I/O half of this pipeline.
2. **Two humans run the initialize ceremony:** one builds the four transactions *from* `launch/mainnet-init.json` after `check-launch-params` passes, the other reads the *built transactions* against the file before signing — the checker validates the JSON, not the signed bytes (round-24 A6), and no AI holds the key or witnesses the signing.
3. **A human verifies the deployed bytes on chain** against `dist/SHA256SUMS` for all five programs, then — only after the ship gate is green — removes all five upgrade authorities and verifies all five read IMMUTABLE on chain. The irreversible call must be a human's.
4. **Close the box-owner residue operationally** (limit 10 D2): a second machine, different uid and host, reading the chain directly and reconciling the revenue ledger and crank heartbeat. No in-tree check survives a compromise of the box that holds the ledger, the crontab, the alarm, and both keys — and AI auditing this tree cannot vouch for that box.
5. **Decide the $CBOB custody (limit 56):** moving the release wallet to Gary's own key or a Squads and deleting the box copy closes the single largest hot-key exposure; it is Gary's call and no audit can make it.
6. **Write and rehearse the third-party upgrade runbook:** when `prog.orca.hash` / `prog.meteora.hash` / a Pyth program / Core pages, a human halts the swap (guardian stops the sweep), re-runs `sim/swap-fork.sh` against the new bytes, and resumes only on human approval. Detection is built; the judgement is not.
7. **Have a human holder redeem a rehearsal vault through the redeem page** (item 50), including the prior-transaction ATA creation and the coverage warning — the failure mode "a holder redeems by another client and destroys a nested asset" is a UX one that no code read reaches.
8. **Re-check the 10 SOL cap against live pool depth periodically.** The fork proves the cap fits the 150 bps floor *today* against Meteora's ~$0.9M; markets move, and the designed failure (a loud refusal) is only safe if someone is watching for it.

The structural truth: this process has driven the *code* to a state where 25 rounds of measurement support it, but the remaining risk is entirely in execution, ceremony, custody, and operations — the four things an AI pass cannot perform.