# ROUND 24 AUDIT — FINDINGS

I read all four programs' off-chain pipeline whole, the MINT program source, the round-23 verdict, and the accepted-limits list. I attempted to reconstruct each round-23 repair against the code it claims to fix, traced the crank's send order against MINT's refusal conditions, and checked the money arithmetic line-for-line against `credit`/`owed_of`/`reweigh`/`retire`/`join`/`claim`. I did not run the suite; everything below is from reading the shipped source. Where I state "no defect found," that is a statement about what I examined, not a certification.

Two findings survived my own attempt to disprove them. Both are LOW. I found no CRITICAL and no HIGH that I could support with a mechanism the code actually contains. Given that ~1/3 of prior CRITICALs were measurement errors, I am not going to inflate a thin result; the two below are concrete and reproducible.

---

## R1 / R4c — THE CRANK

### FINDING 1 — LOW — `split_revenue` raced by any other splitter pages as a failure (`NothingToSplit` is not in `BENIGN`)

**Construct:** `bank/crank.mjs`, `BENIGN` regex (top of file) and the `send()`/`run()` path used by `if (plan.split) await run('split_revenue …')` in `main()`.

**The gap:** Every idempotent race the crank can hit is in `BENIGN` — `AlreadyRetired`, `AlreadyActive`, `AlreadyRevealed`, `MonthNotElapsed`, `ActivationPending`, etc. — so a transaction that "someone else already did" is logged as `skip`, not `fail`. The one exception is the split. `split_revenue` is permissionless and moves the whole revenue balance; if any other caller (the 6-hourly `revenue.mjs` step 4, or a stranger) empties the revenue ATA between the crank's balance read and its split send, MINT refuses with `NothingToSplit`. That string is **not** in `BENIGN`, so `send()` returns `'fail'`, the label is pushed to `failures`, the pass exits 1 and fires the SMS/email notifier.

**What is gained:** Nothing is lost and nothing is mis-paid — the money was already split correctly by the other caller, and the subsequent `distribute` still computes `avail` from the real pool balance, so the plan stays consistent. The cost is a false CRITICAL-shaped page on a benign race. The operational danger is the usual one this file names itself: an alert channel that rings on routine events is the one people scroll past, and the scroll-past is what buries a real `pool_insolvent` or `unledgered_sweep`.

**Why the trigger is narrow but real:** with the shipped schedule (crank `:37`, revenue `:41`) the two splitters are four minutes apart, so today the race mostly needs a schedule edit or a stranger. But `split_revenue` is permissionless by design and the crank is written as if it holds exclusive splitting rights; any future splitter (a holder page that "triggers a payout," item 50, is a plausible one) widens the window.

**Evidence that would exist if I am right:** run two processes against a funded revenue ATA, both calling `split_revenue`; the loser's error text contains `Error Code: NothingToSplit`, and `CR.BENIGN.test('Error Code: NothingToSplit')` is `false`. In production it would appear as a crank log line `FAIL split_revenue (85/15, pinned destinations): … NothingToSplit`.

**Fix:** add `NothingToSplit` to `BENIGN`, and add the both-ways arm to the L1 selftest block (it matches; `BoostsExpireFirst`/`JoinWaitingFirst` still do not). It is safe to treat as benign: `NothingToSplit` means the balance is already zero, which is exactly the post-split state, so there is no reading of it that hides an unsplit balance.

---

### FINDING 2 — LOW — a reveal at the queue head whose asset read returns `'other'` is sent with an empty attribute list and halts the reveal run on a non-benign `AttributesMismatch`

**Construct:** `bank/crank.mjs`, the reveal loop in `main()`:
```js
if (assets[r.asset] === 'live') { …read + hash-check… }
// burned OR 'other' both fall through with list = []
const ok = await send(`reveal …`, [… attrsBorsh(list) …])
```

**The gap:** the branch is keyed on `=== 'live'`, so both a positively **burned** asset and an **unreadable** one (`'other'`, the null-RPC answer) fall through with `list = []`. For a burned asset this is correct — MINT's `reveal_level` detects the tombstone and skips the hash check and the Core write. For an asset that is actually live but read as `'other'` because `getMultipleAccountsInfo` returned `null` for that one account (a transient RPC fault on one element of a batch is a normal failure mode), the program is not burned, so it checks `hashv(empty_vec)` against the stored `attrs_hash` and refuses `AttributesMismatch`. That code is not in `BENIGN`, so the reveal run `break`s and is pushed to `failures` — a page, and the queue head does not move this pass.

**What is gained:** nobody gains value; the vault's level is simply not drawn this pass and the operator gets a fault that looks like "reader and program disagree" — precisely the false alarm the round-23 M2 repair (`judgeRevealAttrs`) was written to remove, re-introduced through the asset-state read instead of the attribute read. It self-heals: the next pass re-reads the asset, gets `'live'`, reads the real attributes, and reveals. `reveal_queue_stalled` would only fire if the RPC fault persisted across passes.

**Evidence that would exist if I am right:** stub `getMultipleAccountsInfo` to return `null` for the queue-head asset while the record fetch succeeds; the crank sends `reveal_level` carrying a zero-length attribute list and the log shows `FAIL reveal … AttributesMismatch`. The program-side refusal is deterministic: a live asset plus an empty caller list can never hash to the stored mint hash.

**Fix:** split the non-live case: send the empty list only when `assets[r.asset] === 'burned'`; when it is `'other'`, `break` the reveal run without sending (the vault is neither provably live nor provably burned, so the correct attribute list is unknown) and let the next pass retry. Arm: `'burned'` head → reveal sent with empty list and accepted; `'other'` head → nothing sent, no failure recorded, next pass retries.

---

## R2 — THE ALARM

I traced every detector the alarm is wired to (the derived `V6_WIRED` list, which I confirmed is now generated from `Object.keys(D)` rather than hand-typed) against the state it claims to see. I did not find a dangerous on-chain state that reads as quiet beyond the blind spots the detectors already print in their own headers, nor a routine state that pages every pass once the round-23 clocks are applied. Specific things I checked and could not break:

- `detectRevenueAccount` (M1): the clock is `max(prevSince, latest seen split blockTime)`; a split restarts it, an empty account clears it, an unreadable account keeps it (L10). I tried to construct a stalled-split state that never pages and a healthy state that always pages; the `splitTime`-anchored restart closes both in the direction the code claims.
- `detectUnsweptRoyalties` (M4): the balance-fall reset is loud-direction only (a sweep smaller than the interval's accrual does not reset), and the sweep-brake suppression is gated on `sweep_stopped`. The acknowledged blind spot is stated in the detector.
- `detectCrankSilent` (M3): `max(stampSec, armedSinceSec)` means a freshly-armed crank gets one `maxAgeSecs` window before its first page, and a dry-run crank never pages. I could not make it quiet for an armed, dead crank older than the window.
- `detectSplitClaims` L16 anchoring: a `splitByOther` cycle now needs an unclaimed on-chain split at-or-after its return **and** with `total >= returnedSats`. I tried the round-23 measured bypass (a later 100-sat crank split vouching for a 5,000-sat cycle) and it is refused because `revenueOutflow` reads the transfers *out of* the revenue ATA and the anchor compares that total.
- `detectPoolHealth` insolvency uses the atomic `getMultipleAccountsInfo` pair-read of config+pool, so a claim landing between the two reads cannot manufacture a false `pool_insolvent`.

The one structural gap I will name rather than file as a finding, because the code states it: `detectApprovals`' owner-resolution fallback only resolves accounts that are in the canonical-ATA map, so an `approve` on a **non-ATA** token account owned by a vault PDA whose parse omits `owner` is not caught by this detector. The detector's own BLIND-TO line says so, and the account's *existence* is separately caught by `detectPdaTokenAccounts` (creation) and `--reconcile` (state), so the approve is a secondary signal on an already-flagged account. I record it here only so a later reader does not spend a round re-deriving it.

---

## R3 — THE LAYOUTS

I recomputed the fixed offsets for `MintConfig` by hand from the field list: `governance` lands at 41 and `minted_total` at 141, matching the values GOV pins and the doc-comment in `lib.rs`. I checked the Borsh reader has no alignment assumption (offsets accumulate with no padding, which is correct for Borsh), the `u128` read/write is little-endian low-then-high, and the `bool` reader refuses a byte that is not 0/1. The selftest parses the real `pub struct` out of each program source and requires field-and-type equality, scrapes every `OFF_*` constant the programs pin across boundaries and requires each to equal the computed offset, and (round 22 L2) asserts nothing scraped goes un-compared. I looked for a field the parser would silently drop (private / `pub(crate)` / multi-line) and the round-22 L1 change makes the parser throw on any line it cannot read as one `pub name: Type,` field, so that class now fails red instead of passing "equal."

The one thing I could not fully close by reading: the `[u32; BOOST_RING]` decoder hard-codes `[...Array(64)]` while the size lives in the `FIXED` map as 256. The selftest asserts the Rust `BOOST_RING`, `FIXED/4`, and the suite's copy all equal 64, and the on-chain suite decodes live accounts, so a ring resize would trip at least one of three arms. I note the hard-coded 64 as a magic number that a future resize must remember to touch; it is not a present defect.

No layout fault found.

---

## R4 — THE MONEY ARITHMETIC

I compared `bank/accrual.mjs` against MINT line-for-line:

- `credit`: `delta = avail*SCALE/w; acc += delta; owed += delta*w` — matches, including the deliberate choice to add `delta*w` (not `avail`) so the truncation stays in the pool.
- `owed_of` / `pendingScaled`: `(level_weight + boost)*acc + carry − debt`, with the negative case throwing off-chain where the program aborts on-chain. Matches.
- `reweigh`: carry = owed-at-current-acc computed with the **old** weight, debt = new-weight × acc. I checked the ordering — the mirror evaluates `pendingScaled` before applying the new boost, which is the same order as the Rust (`owed_of` is called before `r.boost_weight = boost`). Matches.
- `ceil_sats`, `available`, `debtAtActivation`, and the join-at-`weight*acc` debt all match.

The crank's per-vault `owed` (the round-23 L4 repair) now carries `boost` and `carry` into `pendingSats`, and the selftest asserts exact sat values (20/20 post-expiry, 29 for the live-boost case, and the 1-vs-0 threshold) rather than batch counts, so the L4 mutation (strip `boost`/`carry` from the owed line) is caught. I verified the arms actually depend on those fields by confirming the asserted numbers cannot be produced without them.

No divergence found.

---

## R4c — THE ROUND-23 REPAIRS, CHECKED ONE BY ONE

I treated each repair as the suspect. Results:

- `detectRevenueAccount` — holds (see R2).
- `judgeRevealAttrs` — holds: `send`/`revealed`/`mismatch` are collision-resistant because a list that hashes correctly after removing `level` *is* the minted list; a tampered list that also carries `level` still mismatches. The one adjacent gap is Finding 2, which is about the asset-state read, not this function.
- crank heartbeat / `detectCrankSilent` — holds (see R2).
- `detectUnsweptRoyalties` — holds (see R2).
- widened `BENIGN` — correct except for the omission in Finding 1.
- live-only joins/payments (L2) — holds: `'other'` is excluded from pre-joins, joins and claims, and an unreadable eligible vault suppresses the distribution (`joinable=false`), which is the safe reading of `JoinWaitingFirst`.
- the tick that discounts this pass's retirements (L3) — holds: `retiringThisEpoch` only subtracts records that are `pending`, unretired, being retired this pass, **and** `request_epoch == dist_epoch`, which is exactly the condition under which MINT's `retire` decrements `pending_this_epoch`.
- `plan.owed` (L4) — holds (see R4).
- alarm wiring derived from `detect*` exports (L5) — holds; the list is generated, not typed.
- launch-gate pins (swap operator, `cbob_mint`, release wallet, on-curve keys) — hold; see R4b note below.
- drift suppression for a newly-appeared program (L11) — holds: the skip requires the previous snapshot to carry the `_missing` flag, so a value going null→set while the program was *present* still drifts, and Core's `NO_PROGRAMDATA` sentinel still drifts.
- `lockDeadlineOf` (L12) — holds: `min(file, charter_opens_at)`, both must be positive-finite.
- plan-sized fee floors (L14) — `planCostLamports` counts every transaction `main()` sends plus per-reveal attribute rent; I walked each send site and the count matches.
- lock liveness-before-age (L15) — holds: a live holder is never broken at any age; a dead or recycled pid is broken at any age; a no-pid record still waits out `staleMs`.
- split anchoring by total (L16) — holds (see R2).

The two findings above are the only defects I found in or adjacent to these repairs.

---

## R4b — THE BOOST OFF CHAIN, AND `create-cbob-token.mjs`

The crank expires due boosts before a distribution (`preExpires`, matching `BoostsExpireFirst`) and the boosts a distribution makes due right after it (`postExpires`, `end_epoch == dist_epoch + 1`). I checked the ring bound off-chain against the on-chain rule: a boost earns exactly the distributions that advance `dist_epoch` from its purchase epoch up to and including the one that reaches `boost_end_epoch`, and `MAX_BOOST_EPOCHS = 24 < BOOST_RING − 1 = 63`, so two live end-epochs cannot collide modulo 64. The host unit test exercises the wrap over >192 epochs. The owed math includes `boost_weight` and `carry_scaled` exactly as `owed_of` does (verified in R4).

`launch/create-cbob-token.mjs`: the whole creation is **one transaction** — create mint account, `InitializeMint2` (mint authority = release wallet, freeze authority = `null`), create the release ATA, `MintTo` the full supply, metadata, then `SetAuthority(MintTokens, null)`. Because it is atomic, there is no on-chain state where the supply is partly minted or the mint authority is live with tokens outstanding. The mint account can only be created with the mint keypair's signature, which the script holds, so it cannot be front-run. The read-back asserts supply == 2,100,000,000, mint authority `null`, freeze authority `null`, and the whole supply in the release ATA, and writes the record before the read-back (I5) so a throwing read-back still leaves the signature on disk. I could not construct a path that leaves a live mint authority, a freeze authority, or a partial supply. The residual risk is the release-wallet secret itself, which is accepted limit 56 and is not a code defect.

---

## R5 — THE SWAP HOP

Worst case is as stated in limit 10: the operator (or a thief of the key, or a hostile Jupiter `/swap` response) can keep the swept SOL, bounded by `max_sweep_lamports` × cooldown windows until the guardian stops the sweep, and never more than the revenue PDA holds above the reserve. I confirmed `revenue.mjs` clamps to `min(balance−reserve, 50 SOL, chainCap)` so the on-chain cap binds, and the swap-transaction pre-sign checks (exactly one signer = operator; no BPF-loader or MINT program id; ≤4 address-table lookups) are a bound, not a proof — which is what the limit already says.

The ledger cannot read a failed cycle as closed: `cycleIsOpen` (the single shared predicate) keeps a cycle open while `returnedSats == 0` or while there is neither `splitSig` nor a valid `splitByOther`; `String('0')` truthiness is handled by the `BigInt` comparison; a `sendRejected` sweep is closed because nothing moved. The `splitByOther` escape requires `isProvablyEmpty` on the revenue ATA — a readable, Tokenkeg-owned, zero-balance account — and absent is explicitly *not* empty, so a never-created ATA cannot prove a split. The alarm side (`detectSplitClaims`, `detectUnledgeredSweeps`, `detectDeferredSweeps`) reads amounts off the chain/instruction rather than off the ledger's word, and carries fresh sweeps in state so the grace window is a delay, not a hole. I could not make a failed cycle reconcile as closed.

---

## R6 — THE GATES

The floors are **equality** floors, not lower bounds: `run-tests.sh`'s `floor()` and the on-chain `MIN_ASSERTIONS` both require the count to *equal* the stated number, so deleting assertions turns the build red and adding them requires moving the floor and SPEC's stated counts together (which `bank/selftest.mjs` checks at every occurrence, not just the first). I looked for a floor satisfiable by deleting work: you would have to delete the assertion *and* lower the floor *and* edit every SPEC occurrence, which is three visible, co-required edits. I looked for checks that pass vacuously on empty input: `detectIndexShortfall` throws on non-array input rather than coercing, the control-table gate requires ≥5 rows, the signer-set test expects exactly two signers (an empty scan would fail, not pass), and the DAS envelope judge refuses `{}`/`result:null` as "no answer" rather than "owns nothing."

The one gate I could not exercise by reading is the suite's own behaviour under a deliberately failing arm (mutation testing) — the verdict file claims mutations were run when the arms were written, but I cannot re-run them here. I flag that as a process observation, not a finding.

No vacuous gate found.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?** I did not find one that is. I specifically re-derived: limit 27 (dead-weight from a bare burn before retire — the crank retires first every pass, and the boosted dead-weight case is already named in the limit); limit 28 (frozen pool/revenue/Squads accounts — each variant is separately paged, and the frozen-pool redemption forfeit is by stated design); limit 32 (the 64-slot ring makes the cap *stricter* above 3,047 live vaults, never looser); limit 55 (the unsplit-revenue join edge grows during a crank stall, but `revenue_unsplit` pages, so the stall is bounded by detection); and limit 10 (the Jupiter `/swap` signing is inside the stated operator-wallet bound). None is worse than written.

**2. Is anything listed as a limit not actually a limit?** No. The discharged-by-construction items I re-checked (19 unlevelled-vault halt, 30 the 85/15 vote) really are closed: `activate` refuses `NotRevealed` so no vault is ever active without a drawn level, and no instruction writes `split_bps` after `initialize`.

**3. Is any DISCHARGED item not actually discharged?** I found none. Item 19 rests on `activate` requiring a drawn level and the payout reading the level from the record, which the code enforces; item 30 rests on `split_bps` having no writer, which I confirmed by searching MINT for any assignment outside `initialize`.

**4. Is any OPEN-AND-BLOCKING item being quietly treated as accepted?** Items 22, 38 and 50 are genuinely open and are not treated as accepted in the code (the launch gate refuses while values are OPEN, and the redeem page does not exist). One presentational concern, not a finding: **item 51** sits under OPEN AND BLOCKING but is titled "DECIDED AND BUILT" and describes a shipped mechanism. If it is blocking, the reason it is still blocking should be stated (the boost *terms* are off by default and need a vote, but the mechanism itself is built); if it is done, it belongs under DISCHARGED. As written, a reader cannot tell whether it gates launch. This is a documentation defect in the carry list, not a code defect.

---

## ANYTHING ELSE

Two observations that are not findings but belong in the record:

- **`detectApprovals` non-ATA blind spot** (named in R2) is real but already covered at the account level by two other detectors; it is a missing *secondary* signal, not a missing *primary* one.
- **The crank's fee floor uses an estimate of Core attribute rent** (`REVEAL_RENT_LAMPORTS = 16 × 6,960`). If the true per-reveal rent exceeds this, reveals fail on insufficient rent and page; they do not under-pay silently. The estimate is an upper bound I could not verify without running Core, so I leave it as an item to *measure* in the dress rehearsal rather than assert.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

AI audit has three structural weaknesses this process cannot fix from inside: **it never executes the live system under real adversarial load, it cannot be held accountable, and it cannot verify the trust boundary it is itself running on.** Concretely, before launch:

1. **Run the dress rehearsal (item 22) as an adversarial exercise, not a green-run.** Don't just watch it pass: kill the crank mid-pass, return a null for one account in a batch RPC, feed the alarm a stale state file, let a reveal window lapse on purpose, and confirm each detector fires and each lane recovers. The two LOW findings above are exactly the class that only shows up when a read partially fails; reproduce them deliberately and confirm the fixes.

2. **Break the build-trust boundary.** The machine that runs the audit also holds the keys, the crontab, and the deploy path. Have the final deployed program bytes dumped from mainnet and diffed against a build produced on a *different* machine from a fresh clone, by a person who did not run this audit. `build-mainnet.sh` proves which key shipped; it cannot prove the machine it runs on is honest.

3. **Move the $CBOB release wallet off this box before any boost terms are voted on** (limit 56). This is an owner action, not an audit action, but it is the single largest concentration of value that code cannot protect, and it becomes spendable the moment a vote switches boosts on.

4. **Hold a human-monitored canary window after deploy and before removing the upgrade authority.** Deploy, initialize with the ruled values, run real but small-value traffic for a bounded period with the upgrade authority still held, and only then finalise immutability. The programs' own design already assumes this order; make the window long enough to observe at least one full monthly distribution, one redemption, one bare-burn retirement, and one reveal reschedule on live chain.

5. **Put a named human on call for the launch window and the first distribution.** Every detector in this system ends in a page; a page with no human is a log line. The automation is good at noticing; it cannot decide. Immutability makes the *decision* latency the binding risk, not the *detection* latency.

6. **Accept that this process cannot prove absence of bugs, only presence of the ones it looked for.** The 748+560+ assertion floors prove the tested properties; they do not prove the untested ones. The ship gate's two-clean-rounds rule is the best available proxy, but it is a proxy. If any value is ever moved under these programs that the owner is not prepared to lose, the ruling against a human firm should be revisited for at least the immutable money path — because AI audit can reduce the probability of a surviving bug, but it cannot, and does not claim to, carry the liability for one.