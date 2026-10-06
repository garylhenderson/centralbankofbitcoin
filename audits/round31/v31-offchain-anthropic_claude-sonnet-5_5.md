# Round 31 audit, off-chain pipeline: findings

## Method and limits

I read the bundled tree as written and recomputed offsets, formulas and accounting by hand. I ran nothing: no validator, no RPC, no forks. Every claim below says what evidence would exist if I am right. Where a claim needs a measurement I could not make, I mark it **NEEDS MEASUREMENT**.

**No CRITICAL or HIGH finding survived my own check.** The one candidate for HIGH (F6) is unmeasured and may be disproved by the measurement it asks for.

---

## R0. Round 30's verdict and its repairs

I re-derived each repair against the source.

**M1 backlog drain (`bank/sigwalk.mjs` `startBefore`, the alarm's `backlogs`, the poster's `st.backlog`).**
- The logic holds. The resume point is the oldest signature read. The cursor moves to the backlog head only on a non-empty, gap-free walk, or on positive proof when the walk comes back empty.
- The repair did not address wall-clock cost (F2).

**L1 (truncation page only when one of our programs ran).**
- It is bypassable by calling one of our own permissionless no-op instructions (F1).

**L2 (`budgetPlan`), L3 (`sweepAmount` and `MIN_SWEEP_LAMPORTS`), D1, D2.**
- No fault found. I recomputed the budget arithmetic, including the case of a key sitting exactly at the floor.

**Verdict bookkeeping.**
- The 6/8 quorum count and the exclusion of the Grok and Fugu reports are consistent with what the verdict records.
- Its coverage-gate claim is weaker than stated (F5).

---

## R1. The crank

I compared every instruction's account list and data against the MINT source: `reveal_level`, `capture_entropy`, `reschedule_reveal`, `retire_burned`, `claim`, `expire_boosts`, `split_revenue`, `distribute` and `activate`. All match.

I recomputed planner against program for:
- `preExpires`, `postExpires` and `preJoins`;
- the owed amount of a vault that expires inside the pass, `(atExpiry + w·(acc′−acc))/S`, which equals the program's `reweigh` then credit;
- `retiringOwed`;
- the tick condition.

I found no plan the program refuses. I found no order inversion. A burned or unreadable asset is never joined or paid, apart from the documented limit 27 race.

Remaining items:
- **F4:** no request timeout on any `Connection`.
- **F2:** the crank is unaffected, but the alarm is.

---

## R2. The alarm

I traced every kind in `ALARM_KINDS`. Findings:
- **F2:** a scan flood delays every page, not only the signature-derived ones.
- **F3:** the production list omits ruled values.
- **F1:** the truncation page is bypassable.

**No page if the crontab is deleted (INFO, F8).**
- `crankPosture` returns `dry` on "no crontab for", and `crank_silent` then goes quiet.
- The watcher and the deadman live in the same crontab. `crontab -r`, a dead cron daemon or a dead box silences all of it.
- Nothing in the tree witnesses the alarm from outside the box.

---

## R3. Layouts

I recomputed these by hand and they match:
- `SealConfig.reserve_mints` at 41;
- MintConfig and VaultRecord totals of 1005 and 211;
- the `[u32; BOOST_RING]` handling;
- the `u128` and `bool` readers.

The strict `parseRustStruct` and the seed assertion (D6) are real: a mistyped seed would fail.

One structural gap: layout versions are compared by number. A semantic change that keeps the field list is not caught. That is acceptable only because the programs freeze.

---

## R4. Accrual

`credit`, `pendingScaled`, `ceilSats`, `reweigh`, `available`, `join`'s debt and `carry` all equal the Rust. There is no divergence.

The crank expires due boosts before the distribution and after it:
- the "after" boost is the one with `end == dist_epoch+1`, i.e. the epoch the distribution makes due;
- both are the right ones.

`boosts_stalled` and the boost bounds are watched.

---

## R5. Swap and revenue

**(a) Oracle math.**
- `sats = lamports·sol·10^(es−eb)/(btc·10)` is correct for every exponent sign.
- Rounding is down, twice.
- `satsPerLamport` uses `Number` conversions of values below 2^53, so there is no overflow.
- Only the scale factor `10 ** BigInt(e)` is unbounded, which matters only if a non-genuine feed is read.
- I could not break the floor: 150 bps covers Orca's 0.16% fee plus the impact of a 10 SOL swap in a ~$10M pool.

**(b) Pyth.**
- The offsets are correct: `40` level, `41` feed id, `73` price, `81` conf, `89` expo, `93` publish_time.
- The account is a PDA of the push program, so only that program can write it. The push program enforces monotonic `publish_time`.
- A third party can therefore choose only among validly signed updates newer than the stored one, and the 180 s age gate bounds that window.
- The clock is the Clock sysvar read in the same call.
- `readPyth` ignores `posted_slot`. That is fine.

**(c) Deviation filter.**
- Orca: `(sqrt/2^64)²` is raw B per raw A, which is sats per lamport. Correct.
- Meteora: the inverse of `(1+s)^id`. Correct.
- Float noise is about 1e-16 against a 100 bps gate, so it cannot pass a pool it should refuse.
- A NaN, zero or infinite oracle makes `dv <= 100` false, so the pool is skipped. That is fail-closed.

**(d) Minimum out.**
- Both programs take the output token's raw units, and the same `guaranteed = minSats` is used.
- The deviation filter and the floor are different bounds (1% pool-versus-oracle at read time, 1.5% output at execution). That is documented.

**(e) Judge.**
- The seven-instruction sequence, keys at their positions, data lengths, the discriminator, amount, floor, direction flags and the price limit are all checked.
- I could not find a value-moving tamper it misses.
- Unchecked: vault, tick-array and bin-array keys, oracle, event authority. The venue programs validate those against the pool, so I count this as acceptable.

**(f) Derivation.**
- Orca arrays: current, then the two below, as strings. Correct.
- Meteora arrays: active plus two above for Y→X, index `floor(id/70)`. Correct.
- Bitmap-as-program-id and the `__event_authority` seed are correct.
- Account orders match the published interfaces.

**(g) wSOL.**
- A pre-existing wSOL balance returns as SOL to the operator and is not in the ledger.
- Partial fills are prevented by the floor.

**(h) Retry.**
- A tx that confirmed but whose status is not yet visible at "confirmed" could be classed `refused`. This needs RPC lag on a blockheight-exceeded error.
- The second swap is then possible only if the operator holds `lamportsIn` again. That applies to the 0.01–0.02 SOL range, where the float itself could be swapped and returned.
- The effect is negligible, but it is a unilateral status-lookup assumption on a single RPC.

**(i) Extraction.**
- The bound is 150 bps of 10 SOL per cycle.
- On Orca, moving the pool 1.3% costs far more than it yields.
- Meteora is reached only if Orca refuses.
- I judge it immaterial at these sizes.

**Requote abort (INFO, F7).**
- `m2.f.expectedSats < minOut` after the sweep aborts the cycle, leaving SOL on the operator and a hand recovery. That is a 2% oracle move between two reads.
- It adds a manual failure mode, while the on-chain floor already uses the fresh price.
- The abort protects nothing the floor does not.

---

## R6. Gates

**Selftest floor.**
- 898 equals the count by construction.

**Where gates are real.**
- The installer arms (they run the real shell).
- The router-driven assertions.
- The extracted-loop arms.

**Coverage gate.**
- The coverage gate has two gaps (F5).

**`scripts/build-mainnet.sh` (INFO, F9).**
- It proves the INIT_AUTHORITY block exists and that the sweep bytes are identical.
- It does not prove that `localnet`-gated code is confined to that constant. A one-line check (exactly one `cfg(feature = "localnet")` pair per program) would close it.

**`cron-install.sh` and `rehearsal-tree.sh`.**
- Both arm nothing they should not.
- The rehearsal tree's abbreviated-id scan can in principle false-positive on a random 4-character match in a large tree. That is benign.

---

## Findings

### F1. LOW. The round-30 truncation repair is bypassed by a successful no-op of our own programs

**Construct.** In `bank/alarm.mjs`, `ran = [...new Set(ixs.map(ix => ix.program).filter(p => OURS.has(p)))]` decides between the paged `log_coverage_gap` and the INFO `log_truncated_foreign`.

**What breaks.**
- `expire_boosts` with the config account and any writable VaultRecord succeeds as a no-op. Its loop `continue`s on `!r.active || r.boost_weight == 0`, then logs `n=0`.
- `claim` over a non-active pair behaves the same way.
- A stranger therefore makes MINT "run", with truncated logs, for one fee, for example from a one-instruction custom program that logs 10 KB and CPIs the no-op.
- Each such transaction is a fresh urgent HIGH `log_coverage_gap`, which round 30 meant to close.

**Evidence if I am right.**
- Run the extracted walk on such a transaction: one `log_coverage_gap` and an urgent notice.
- `normaliseTx` shows an inner MINT instruction with no CBOB event line.

**Fix.** Page only when an instruction that can print a lost event (`mint_vault`, `claim_charter_vault`, `activate`, `claim`, `reschedule_reveal`, `burn_vault`) ran, and also aggregate the page per pass.

The lost lines are recoverable from state anyway:
- a reschedule shows as a stalled queue or a record's `reschedules`;
- a deferral shows as `vault_account_frozen`;
- a forfeit shows as the pool and ledger movement.

So the per-signature urgent page is unnecessary.

### F2. MEDIUM. A scan flood delays every page, not only the signature-derived detectors

**Construct.** `bank/alarm.mjs` main.

**What breaks.**
- It computes the drift, pool, upgrade-authority and standing-risk findings first, then walks up to 20,000 signatures per program, reading each transaction serially.
- Nothing is reported until `report()` after the walk. State is written only at the end.
- A flood of about 20,000 stranger transactions (about 0.1 SOL) at 100 ms per `getTransaction` is 33 minutes per flooded program per pass. Sustained, or across several programs, it is hours.
- Meanwhile `flock -n` skips the next cron runs silently, the lock holds, and the deadman fires only at 2 h.
- A CRITICAL such as an upgrade authority, a pulled brake or a frozen pool waits behind a flood, which is cheap for an attacker to start and costs us time.

**Evidence if I am right.**
- Time one pass with a stub RPC adding 100 ms per `getTransaction` and 20,000 signatures after the cursor. The pass exceeds the 30-minute cadence, the report is emitted at the end, and the following cron ticks log lock contention.

**Fix.**
1. Send the state-derived findings (everything computed before the walk) as soon as they exist, under their own labels.
2. Give the walk a wall-clock budget and persist its position, which `backlogs` already supports.
3. Fetch transactions with bounded concurrency.

The accepted bound in "Scan backlog boundary" counts passes, not wall time, and does not mention that the other detectors wait.

### F3. LOW. Several launch-fixed values are not pinned in the alarm's production list, and no post-initialize readback exists

**Construct.** The `want` list in `detectStandingRisks`.

**What breaks.**
- It lacks the guardian and the swap operator.
- It lacks the initial `max_sweep_lamports`, `sweep_cooldown_secs` and `sol_reserve_lamports`. For those it has only the bands: cap 0, cap under 5 SOL, cooldown under 3,600 s (all INFO or CRITICAL as coded).
- A wrong initial 50 SOL cap, or a typo in the operator, is adopted as the first baseline and never paged. A vote can only tighten the cap.
- SPEC limit 38 says the alarm "reports a wrong one" and lists these values. It does not.
- The launch checker validates JSON only (A6, accepted). Nothing reads the signed values back from chain before road step 11 removes the upgrade authority.

**Evidence if I am right.**
- Run `detectStandingRisks` with `mint.max_sweep_lamports = 50000000000`, `mint.guardian = <any>` and `production: true`: no finding.

**Fix.**
- Add `scripts/verify-initialized.mjs`. It reads each of the four configs and compares every field to `launch/mainnet-init.json`.
- Make it a required step before road step 11.
- Add the five missing fields to the alarm's first-baseline check, or document that the script is the control.

### F4. LOW. No per-request timeout on any `Connection`

**Construct.** `new Connection(rpc, 'confirmed')` in `bank/crank.mjs`, `bank/revenue.mjs` and `bank/alarm.mjs`.

**What breaks.**
- Round 25 A1 measured one non-answering socket holding web3.js 1.98.4 for about 300 s, longer than the 300-slot capture window. Meanwhile `flock -n` skips later minute ticks silently.
- SPEC limit 25 phrases the case as at `2b67fb1`, implying a later repair.
- The shown files contain no timeout (`fetch`, `AbortSignal` or `fetchMiddleware`).

**Evidence if I am right.**
- Stall `getProgramAccounts` on a local proxy: the reveal lane takes 300 s and nothing pages until `reveal_queue_stalled` (30-minute passes).
- If a wrapper exists elsewhere, show it.

**Fix.**
- Pass `fetch` with a 15–20 s `AbortSignal`.
- Give the reveal lane its own stalled-heartbeat.

This is documented as a minter re-roll risk, but a plain RPC outage produces the same lapse, so I count it as worse than the single-socket framing.

### F5. LOW. The coverage gate's quorum test is a regex over prose, and `Cargo.lock` is outside its scope

**Construct.** `scripts/audit-coverage.sh`: `re.search(r'INCOMPLETE QUORUM|QUORUM NOT MET|QUORUM IS NOT MET', head5)`.

**What breaks.**
- The round-30 programs verdict reportedly did not reach quorum (5/8 counted, 6 required). If its first five lines say "did not reach quorum" or "5/8", the regex misses it.
- The runner's manifest may still carry `auditors >= required`, since round 30's triage excluded a seat the runner counted. The gate would then credit a failed quorum.
- Independently, `/Cargo\.lock$` is excluded as "not authored behaviour". The lockfile decides which dependency versions end up in five immutable programs. No auditor, human or AI, is ever shown them.

**Evidence if I am right.**
- Run `head -5 audits/round30/VERDICT-programs.md | grep -iE 'INCOMPLETE QUORUM|QUORUM NOT MET|QUORUM IS NOT MET'`.
- If it prints nothing, files covered only by that round pass the strict gate.

**Fix.**
- Make the quorum verdict a machine field in the manifest written by triage (`"quorum_met": false`), not prose.
- Add `Cargo.lock` to the coverage list, and add a dependency review (see the final section).

### F6. NEEDS MEASUREMENT, potential HIGH. Owner-driven Autograph growth on the FIFO-head vault could permanently halt the reveal queue

**Construct.** `reveal_level` (an Attributes `UpdatePluginV1` through Core), plus SPEC limit 40 and round 28's "Core size boundary".

**What breaks, if the boundary falls the wrong way.**
- Core runs each instruction in a fixed 32 KiB heap, and the SPEC says a larger requested frame does not help.
- An owner can add Autograph to their own vault and sign it from many keys.
- Round 28 measured that at 10,150 bytes the reveal still landed, but a shrink or remove did not. The SPEC itself calls these "bounded observations ... not a proof for every plugin shape or size combination".
- If some shape or size makes `reveal_level` revert on the head vault, the queue stops for every later vault. The `reveal_level` order is strict, there is no skip, `revealed_total` can never advance, and nothing can be activated or distributed to later vaults.
- Programs are frozen at launch, so this would be permanent.
- The limiting inequality is that any size reachable by "sign" must still allow "reveal". Only one shape is measured. Many small signatures versus one large message allocate very differently under a heap that never frees.

**Evidence needed.**
- On the pinned Core, build a vault with all owner-managed plugins plus Autograph.
- Grow it by many small signatures (many distinct signers, 50–100 bytes each), by a few large messages, and by mixes, until Core refuses the next signature.
- At each refusal boundary, attempt the actual MINT `reveal_level`.
- If reveal ever reverts at a size where signing still succeeded, this is a permanent denial of service.

**Fix if confirmed.** Pre-lock program change: an owner cannot be allowed to put the FIFO head in a state `reveal_level` cannot update. Options are to reveal before the vault can be transferred or plugin-extended, or to let the draw skip a vault that fails.

Do this measurement before anything else. It is the largest remaining unknown that the program pass reads and this pass cannot close.

### Informational

- **F7.** The requote abort after the sweep (above).
- **F8.** The deadman lives in the watcher's crontab. There is no off-box witness.
- **F9.** `build-mainnet.sh` does not constrain how much code the `localnet` feature gates.

---

## The four questions on the accepted limits

**1. Worse than stated?**
- **Limit 25** is worse than its "total silence" framing, because a plain RPC stall of two minutes or more lapses every pending window (F4).
- **Limit 44** is better than stated for a frozen zero-balance account, which is closed (already corrected in round 30).
- **Limit 40** names heap exhaustion only as a Core-upgrade risk. It does not name the owner-driven version in F6.
- **Limit 7** is worse during a scan flood: the alarm itself becomes the wedged holder (F2).

**2. Listed as a limit but not actually one.**
- Nothing new. Limit 36 (the early or blocked host) is design, not a defect.

**3. Discharged but not discharged.**
- **Item 54**, the claim batch of 14 "extrapolated, not measured at 14". The R28 expiry gate measures `expire_boosts` only. A 14-vault `claim` where every vault pays and expires is not exercised, though the arithmetic suggests it is well under 200k CU.
- **Item 53** says "every report and every notice says REHEARSAL". Crank notices do not carry the tag. The crank is permissionless and unaffected, so I count this as documentation only.

**4. OPEN AND BLOCKING items treated as accepted.**
- No instance found.
- Item 50 (holder pages) is correctly blocking.
- The unbuilt rehearsal value set (`launch/rehearsal-init.json`) is stated as unbuilt.

---

## Holder guide against the code

I found no false sentence in `HOLDER-GUIDE.md`. I checked:
- the first-payout timing (clock starts at charter close, tick at +30 days, first free credit at +60 days);
- the boost terms and refusal rule;
- the 2.1% cap;
- the frozen-pool opening;
- the 1.5% swap floor.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the F6 measurement.** Grow the head vault's Autograph by many shapes against the pinned Core and attempt the real reveal each time. This is a measurement an AI reader cannot do by reasoning.
2. **Audit the dependency tree and toolchain.** Review `Cargo.lock` and `cargo tree`, vendor or hash the crates, and pin the exact platform-tools hash. Do a clean-room rebuild on a second machine by someone who is not the author, and compare the five artifact hashes to what gets deployed.
3. **Add a post-initialize readback.** Have a person other than the author read all four configs back from chain against `launch/mainnet-init.json` (F3), on the day, before removing the upgrade authority. Use the hardware wallet for `INIT_AUTHORITY`.
4. **Fuzz the accumulator and the boost schedule for days.** Use property tests against an independent second implementation of `credit`, `claim`, `reweigh` and `retire` with random sequences. The existing host test is a good start but is one seed.
5. **Get a legal and regulatory opinion.** Cover the 85% revenue share to NFT holders, the $CBOB token and the boost. This is not an engineering question.
6. **Run the dress rehearsal as an adversarial day.** Apply the F2 flood to the alarm. Do a forced RPC stall on the reveal lane (F4). Use a real wallet flow for redemption, including a frozen cbBTC account and Phantom's signing display. Time the hand recovery of a failed cycle.
7. **Add an off-box witness for the alarm** (F8) on a different provider, plus a second RPC provider with failover.
8. **Decide the hot-key custody questions as people.** The Proof of Burn collection authority during the 7-day window, the swap operator, and the release wallet holding all $CBOB are each a "one person, one box" trust that no audit removes.
9. **Offer a bounty, or a small first sale.** Limit exposure for a period before the first large amount is held. The programs cannot be fixed afterwards, so the exposure cap has to be a launch decision.