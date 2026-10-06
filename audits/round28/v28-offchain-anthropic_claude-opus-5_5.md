# Round 28 off-chain audit — independent verdict

**Result: NOT CLEAN.** I found one MEDIUM that depends on a single measurement, five LOW and nine INFO. None of them moves value away from a pinned destination. Two of them (F1 and F2) are cases where an accepted limit is worse than SPEC states, or where a discharged item may not be discharged. Those are the findings that matter most, because the programs become immutable.

I executed nothing. For every claim I name the run or read that would confirm or refute it. Where the suite or a fork may already contain that evidence, I say so, so the finding can be killed cheaply.

---

## R0. Round 27's verdict and repairs

| R27 item | Holds? | Evidence |
|---|---|---|
| L1 `detectMissingComponents` | Holds | It runs before the idle branch's early return, so a never-initialized MINT still reports. A deadline is required, and an unset deadline is covered by `lock_deadline_unset`. |
| L2 covered freezes | Holds | The exact planner strings match. Pruning happens on a duplicate beat. Mixed blockers (Squads absent or frozen) stay visible. |
| L3 MINT log retrieval | Holds | `mintFailureCode` attributes the error by the invoke stack. The distribute race judge now receives the code name, and `PoolShort` stays a failure. |
| L4 rehearsal lock checks | Holds | `!production` returns before both deadline branches. |
| D1 read-time gate wording | Holds | SPEC limit 10 now separates the read-time gate from the execution floor. |
| **D2 "no multi-model round"** | **Repair incomplete. See I1.** | SPEC's opening still says: *"v6 … has had three independent red-team passes …, not yet a multi-model round."* Only "Where this stands" was edited, and it now says "Rounds 22-26 completed". Round 27 has also completed and was not clean. This is the project's signature one-of-N-sites defect. |
| D3 four → five | Holds at every site I checked | The "four programs" text in the `detectBurns` header is correct: the signature walk scans four programs, and the helper is reached only inside SEAL/BURN transactions. |
| D4 net-balance qualification | Holds | |
| V1 `txread.mjs` | Holds | Checks: version allowlist; signature identity; unique keys; payer signer and writable; no lookup-table keys under v1; programs must be resolved keys; money-instruction `info` is required; logs, inner instructions and token balances must be arrays, never null or undefined. I could not construct a successful real-RPC shape from a third party that would make it throw and wedge the cursor. Every parsed System, Token and ATA variant the detectors read carries the fields demanded. |
| V2 format boundary | Holds as documentation | |

---

## Findings by target

### R1 / R4 — the crank

#### F1 · MEDIUM (measurement-gated) — `expire_boosts` batches of 20 probably exceed the default 200,000 CU, and the crank sets no CU limit

**Construct.** `bank/crank.mjs` `expire()` sends up to `L.EXPIRE_BATCH = 20` records with no ComputeBudget instruction.

For each DUE record, MINT `expire_boost` executes `msg!("CBOB_BOOST_EXPIRED asset={} weight={}", r.asset, …)`. Formatting a `Pubkey` through `Display` is software base58 on BPF. The published CU benchmarks put that at roughly 12k CU per pubkey, against ~0.3k for `pubkey.log()`. This repo's own figure is consistent: the S8 helper redemption logs three pubkeys and measured 168k CU in total.

Each record also pays for an Anchor deserialize, the `emit!`, u128 arithmetic and `store_record`. That puts a due record at roughly 15–17k CU, so 20 records come to about 300–340k CU. MINT's own `MAX_EXPIRE_BATCH = 30` would be about 450k.

**Why it matters.**
- `layout.mjs` says only that 20 "fit a legacy transaction". That is a packet-size measurement.
- SPEC item 54 (DISCHARGED) says "the bank's crank is unaffected". Its reasoning covers captures, reveals and claims only.
- If a batch of due records fails, `distribute` refuses `BoostsExpireFirst` on every pass. `boosts_stalled` then pages after 6 h, and `crank_failing` pages after three passes.
- The in-line monthly run also waits (`CBOB_MONTHLY_WAITS_FOR_BOOSTS`).
- `claim`'s inline expiry has the same per-record cost, so traffic is no fallback. The crank's 14-vault claim batch carrying 14 due boosts would cost about 14 × 16k plus the transfers.
- No funds are lost. Payouts stall until somebody sends smaller or CU-limited expiries.
- The trigger is many boosts ending in the same epoch, which is the normal shape after a vote turns boosts on.

**Evidence that settles it.**
- Simulate `expire_boosts` with 20 records that are all due and no compute-budget instruction, then read `unitsConsumed`.
- Alternatively, read the BO suite arm's log. If it landed 20 due records at the default budget, this finding is refuted.
- If its records were not all due, the arm measured skips (cheap) and proves nothing.

**Fix (off-chain only).**
- Prepend `setComputeUnitLimit(20 × measured + margin)` to expire batches, and to claim batches whenever any vault in them has a due boost.
- Or size `EXPIRE_BATCH` from the measurement.
- Add a selftest arm that pins the measured per-record CU against the batch size.
- Re-open item 54 until the measurement is recorded.

#### F2 · INFO — a crank that cannot read the Clock silently plans on the box clock

When the Clock read fails, `nowSec: chainSec ?? nowSec` falls back to the box with only a console line. The round-24 I2 intent was the chain clock. The worst outcome is a benign wasted `MonthNotElapsed`, so this is INFO. Revenue refuses in the same situation, so the two jobs disagree.

#### F3 · INFO — `crank_problem` streaks can never form when there are more than 50 problems

The heartbeat keeps `plan.problems.slice(0, 50)`, in `getProgramAccounts` order, which no RPC guarantees to be stable. If a systematic fault produces more than 50 problems (for example, many assets reading `other`), the kept subset changes between passes. Then `crank_problem` (k = 3) never fires for any of them, and no failure count rises.

**Fix:** sort before slicing, or aggregate by `problemKey` category.

**Checked and correct.**
- Every instruction's account metas and data match the bundled MINT contexts.
- Plan order matches the program gates: retire → join → expire → split → distribute → expire after → activate → claim.
- Owed arithmetic for joined, pre-expired and boosted vaults matches `owed_of` and `reweigh`.
- `retiringThisEpoch` and `retiringOwed` are correct.
- Tick conditions match the program.
- The FIFO reveal never skips the head.
- `[]` attributes are sent only for positively burned assets.
- No crank-built instruction moves value except the program-pinned destinations and the reveal's Core rent.

### R2 — the alarm

#### F4 · LOW — the reverse ordering of accepted limit 8 is unstated and more frequent: a routine redemption produces a false "bare burn" CRITICAL

**Construct.** `alarm.mjs` `main()` runs `listVaults` (the DAS diff) and the balance reads before the signature walk. Suppose a redemption lands between a pass's DAS read and its walk, or within DAS indexing lag before the pass.

- **Pass N.** The walk records `burn_via_program A` and the cursor advances. DAS still lists A as live. The balance read finds A's reserve accounts absent, because the sweep helper closes them. `judgeReserveRead(prior>0, absent)` then emits `balance_unreadable` HIGH. That finding has no `asset`, so `correlateBurns` cannot downgrade it.
- **Pass N+1.** DAS shows A as burnt, so `vault_burned` is CRITICAL. No `burn_via_program` exists in this pass, so the CRITICAL carries the text "what a BARE Core BurnV1 looks like".

Limit 8 describes only the opposite ordering (walk later than DAS). This ordering is structural: about 15–20 s per pass for 6,300 reserve reads, plus DAS lag. In a 45-per-hour rush that is a recurring false CRITICAL on the one detector meant to see a bare burn.

**Evidence.** These are pure functions:
1. `correlateBurns([{kind:'burn_via_program',asset:A}])` in pass N.
2. Then `correlateBurns(detectVaultSetChange([A],{live:[],burnt:[A]}).findings)`, which yields CRITICAL with the bare-burn text.
3. `judgeReserveRead('21000',{state:'absent'})` yields a finding.

**Fix.**
- Persist redeemed assets (from `burn_via_program` or the attributed `CBOB_REDEEMED` events) in state for about 24 h, and correlate against that set as well. This uses prior evidence; it is not a retraction, so limit 8's objection does not apply.
- Put the vault id on reserve-read findings and add an "absent after prior, redeemed" path to `REDEMPTION_NOISE`.
- `REDEMPTION_NOISE` still lists `vault_vanished` and `deactivated`, which no detector emits (INFO).

#### F5 · LOW — a pending vote's content is invisible for its whole 3-day window

`layout.mjs` declares no `Proposal` struct, and the alarm reads no proposal account. A hostile ordinary proposal produces one HIGH, `gov.proposal_count` changed, and nothing more until it executes. Examples: a round at the 21,000-sat floor with a cap of 2,100, or boost terms switched on at +12 for 24 distributions. Ordinary proposals execute immediately after the vote. Only key changes get the extra 7-day notice.

Holders who could vote NO are never told what they are voting on. This is not a broken promise: SPEC promises paging on *armed* keys, not open votes. But it is the dangerous state R2 asks about.

**Fix:** decode `Proposal` and page per action kind while the vote is open. `ArmSwapOperator` and guardian changes should be CRITICAL; a round with price < 2× floor or a large cap should be HIGH.

#### F6 · INFO — a landed-but-unconfirmed sweep is paged as the operator key "used outside revenue.mjs"

`byS` matches only `sweepSig`. A `pendingSweepSig` candidate that actually landed becomes `unledgered_sweep` CRITICAL with a misleading attribution. **Fix:** match `pendingSweepSig` and report "candidate landed, ledger unconfirmed".

**Checked and correct.**
- Gary's values are asserted in production: 21% / 51% / 3 days, 7-day notice, 1 SOL / 24 h / 0.1 SOL, 30-day month, 1-hour window.
- `prog.sweep.*` is watched at CRITICAL.
- `cbob_mint` and the boost bounds are fixed-forever keys.
- `boosts_stalled`, the third-party programs at HIGH, the brakes, armed keys, freezes paged once, and the redemption-rate band (idle windows quiet) all behave as described.

### R3 — layouts

**No defect found.**
- The D6 SEEDS assertion now exists and maps all 11 seeds.
- I recomputed MintConfig offsets: `minted_total` at 141 and `bare_burns_retired` at 454 match the GOV/BURN pins.
- The VaultRecord `level` offset of 57 matches the fast-lane memcmp.
- `parseRustStruct` is strict.
- Spaces, versions and the boost ring are scraped and compared against the Rust.

### R5 — swap and revenue

**(a)–(d) No defect found.**
- **Exponent handling is correct for both signs.** sats = L·s·10^(eₛ−e_b) / (b·10).
- Rounding is down.
- `expectedSats` and `minSats` stay BigInt; only the spot comparison uses Number.
- Orca's spot is sats per lamport (B per A).
- Meteora's spot is 1/(1+bs)^id, the inverse of lamports per sat. That is the right direction, with X = cbBTC.
- **The same `minSats` (in sats, u64) goes to both venues.** For Orca it is `other_amount_threshold` with exact-input and a_to_b. For Meteora it is `min_amount_out`.

**(b) Pyth.**
- Offsets: feed at 41, price at 73, conf at 81, expo at 89, `publish_time` at 93. These match `PriceUpdateV2` with `Full` as a one-byte enum tag.
- **Derived PDA plus receiver ownership means only the push oracle's CPI can write the account.** Anyone may post, but only Wormhole-verified Pyth messages.
- Whether the push oracle refuses an older `publish_time` is worth confirming in `pyth_push_oracle::update_price_feed`. Either way the 180 s age check bounds any replay.
- The Clock is a stake-weighted chain time read through the trusted RPC. A chain clock lagging wall time by more than 30 s would refuse every swap through the future-stamp rule. That fails safe (a liveness issue only; INFO).

**(e) Judge.** It is complete for our own build:
- the output account at key 5;
- the floor and amount bytes;
- the direction and price limit;
- no priority fee;
- both ATA creations' exact keys.

What it cannot cover is Meteora's unchecked keys 1, 2, 3, 6, 7 and 9, which the venue validates. That is C14, already accepted.

**(f) Derivations.** Correct.
- Orca arrays 1 and 2 are loaded optionally (`.ok()`).
- For Meteora, all three remaining-account bin arrays must load. C15 already holds the sparse-array risk.
- **Cheap hardening:** pass only the bin arrays that exist, since `market()` already reads accounts.

**(g) wSOL.** No defect found.
- Native accounts cannot be frozen.
- Only the owner can reassign close authority.
- Pre-existing residue is returned by the close.
- Unspent input is impossible under exact-input; an over-traversal reverts.

**(h) Failure handling.** Every uncertain path leaves the cycle open. No second venue is tried after an `unknown` result. A sweep that really landed but was misclassified "refused" is still caught by `unledgered_sweep`.

**(i) Extraction bound.**
- The fork measured Orca 23.7 bps and Meteora 29.8 bps under the oracle at 10 SOL (about $1.2k). A sandwich could take the remaining ~120–126 bps: about $15 per cycle, $60 per day, and about $1.8k per month at full cap.
- A lagging oracle (sponsored push on a 0.5% move or about a 60 s heartbeat; the age limit is 180 s) can add up to ~50 bps in the attacker's favour when SOL rises, which pushes the theoretical maximum toward about $3k per month.
- **That extraction is not profitable.** Moving a ~$10M concentrated Orca pool by 1.26% costs round-trip fees on six-figure notional, far more than $15. Meteora (~$0.9M) is cheaper to push but still costs more than the take. Steering Orca into refusal to force the Meteora route costs the same push.
- At this cycle size the material risk is liveness, not theft. A refusal on both venues leaves SOL on the operator key and an open cycle that needs hand recovery (documented).
- **Operator key plus a malicious venue upgrade.** The swap instruction lists the operator as a non-writable signer, so a hostile venue cannot escalate to drain the fee-payer wallet. Exposure is that cycle's `lamportsIn` plus any cbBTC sitting in the operator's ATA. Limit 10's bound otherwise stands.

#### F7 · INFO — no minimum sweep

`amount = balance − reserve` with no floor. Any excess above about 700 lamports starts a full four-transaction cycle and consumes the 6 h cooldown. A large royalty arriving just after a dust sweep then waits up to 6 h. Strangers can trigger this by donating lamports.

**Fix:** sweep only when the excess is at least 0.1 SOL.

### R6 — gates

#### F8 · LOW — the rehearsal tree's isolation claim is false for `launch/`

`rehearsal-tree.sh` patches only `programs bank scripts tests sim Anchor.toml`. `launch/create-cbob-token.mjs` hard-codes `/opt/cbob-vaults/bank/keys` and `/opt/cbob-vaults/launch/cbob-token.<cluster>.json`. Run from the rehearsal tree, `--readback` rewrites the production record, and the mainnet mode loads the production release and mint keys.

SPEC item 53 says the root substitution means "the rehearsal's keys, locks and caches never touch production's".

**Fix:** include `launch/` in the patched set, or make launch scripts refuse a tree carrying `REHEARSAL-RECORD.txt`, as the cron installer already does.

#### F9 · LOW (process) — two items still to be done will reset the freeze if done when the road says

- Item 53 still requires a rehearsal mode in `scripts/check-launch-params.mjs`, which is in the frozen set.
- Item 22.5 (whether DAS sets `burnt`) is scheduled for the dress rehearsal (step 8), which comes after the freeze (step 7). If DAS omits burnt assets, then after the first redemption `index_disagrees_with_chain` pages CRITICAL on every pass forever, and every redemption is an uncorrelated `vault_left_index`. The fix would land in `bank/`.

Either way, gates 2–3 reset after the clean rounds are spent.

**Fix:** build the rehearsal checker now. Measure the DAS behaviour now with any burned Core asset already on mainnet (one `getAssetsByGroup` call); it does not need the rehearsal.

#### F10 · INFO — three selftest arms cannot fail

- "discriminators are COMPUTED" recomputes the same sha256.
- "accrual credit equals the Rust formula" compares JS with JS.
- Several crank arms are source-order regexes only (I2, L3 wiring).

These are not floors, but they count toward the 860.

**Checked.**
- Floors are equality-based, and `SWAP_FLOOR = 16` matches SW.0 through SW.9.
- `MAINNET_FLOOR = 33` matches 5 + 15 + 8 + 5.
- `build-mainnet.sh` proves all five artifacts as described.
- `cron-install.sh` arms only from our tagged, uncommented, end-anchored lines, and refuses a rehearsal tree.

#### F11 · LOW — RPC timeouts are still the 300 s default; limit 25's wording implies they were fixed

Limit 25 says the default `Connection` waited 300.8 s "at `2b67fb1`". But `crank.mjs`, `revenue.mjs` and `alarm.mjs` still call `new Connection(rpc, 'confirmed')` without a fetch timeout, and the DAS `fetch` has no `AbortSignal`. One hung socket can still stall the reveal lane past the 300-slot window. The "at 2b67fb1" phrasing reads as a past state.

**Fix:**
- Pass a `fetch` that wraps `AbortSignal.timeout(10_000)` into every Connection, and add the same timeout to the DAS fetch.
- Or reword limit 25 to say the condition is current.

### Holder guide versus code

#### F12 · INFO — the reveal timing is overstated

The guide says the level is drawn "a few seconds after you get your vault". In practice the reveal lane runs once a minute, reveals strictly in FIFO order, and host traffic captures only records it names. Expect about a minute normally and longer in a burst.

Every other sentence I checked matches the code. That includes:
- activation joining at the next distribution;
- the first payout coming no earlier than close + 30 days and the first free one at close + 60 days;
- redemption still working during a pool freeze (with the forfeit);
- boost terms and their one-sided refusal;
- the guardian's powers and the "half of vaults at creation" rule.

#### I1 · INFO — the D2 sibling and stale counts

SPEC's opening still says "not yet a multi-model round". "Where this stands" says "Rounds 22-26" and cites the "round-26 run-tests", but round 27 has run and the counts have moved.

---

## The four questions about the accepted limits

1. **Worse than stated.**
   - **Limit 8:** the reverse ordering (F4) is unstated and more frequent than the stated one.
   - **Limit 25 / item 7:** the 300 s stall it describes still exists (F11).
   - **Item 54 (DISCHARGED):** "the crank is unaffected" is unproven for expiry batches (F1).
   - **Limit 10's revenue liveness:** a refusal on both venues needs a human every time. It can be induced by natural oracle lag, but extraction through it is unprofitable at this cycle size.
2. **Listed as a limit but actually closed.** Item 37's "fits only without a crank" and item 46's four-account bound are legacy-only, and v0 or v1 relax them. Both texts already say so. I found nothing silently closed.
3. **Discharged but not discharged.** Item 54, pending F1's measurement.
4. **OPEN items quietly treated as accepted.** None by wording. But items 53 and 22.5 are scheduled so that their likely code consequences fall after the freeze (F9), which in practice defers them past the clean rounds.

---

## Given that no human firm will see this and the programs will be immutable: what to do before launch that AI audit cannot

1. **Execute the claims that are currently reasoned.**
   - Simulate `expire_boosts` and `claim` at 20, 14 and 30 due boosts and record the CU (F1).
   - Run one DAS `getAssetsByGroup` over a collection holding a burned Core asset, today (F9).
   - Fork-test Meteora with the `i+2` bin array deleted (C15).
   - Run a reveal-lane soak with a deliberately hung RPC socket.
2. **Run the dress rehearsal as an adversarial exercise, not only a functional one.**
   - A second operator, with no access to the repo's reasoning, tries to make the crank pay a dead vault, stall the queue, and force both swap venues to refuse.
   - Throughout, a human checks that every resulting page is accurate.
3. **Run an independent second watcher off this box.** It should have its own RPC provider and its own alert channel, and run the alarm read-only. Item 10(3) concedes that one box-owner compromise silences everything. That needs no code freeze; it is an operational fact.
4. **Key ceremonies, done and witnessed.**
   - Hold the Moments update authority cold for the 7-day window (limit 46). This is the single largest pre-launch risk, and Gary can close it by custody alone.
   - Move the `$CBOB` release key off the box (limit 56).
   - Rehearse the guardian's stop from the actual wallet, with a timer.
5. **Build reproducibly on a second, clean machine.** Rebuild from the release commit there and compare the five sha256 values. Then read the deployed ProgramData from two RPC providers before removing authority.
6. **Hold a time-boxed public bug bounty with funded escrow on the rehearsal deployment** before the lock. AI review cannot replace someone with money at stake trying to break it.
7. **Have a human, not a model, review `HOLDER-GUIDE.md` against the rehearsal's real transactions**, sentence by sentence, before it is published.