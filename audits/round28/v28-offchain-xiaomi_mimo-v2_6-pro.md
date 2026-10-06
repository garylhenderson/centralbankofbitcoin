# Independent Security Audit — Off-Chain Pipeline v6 (e109b31 tree)

I audited the whole tree independently. Below are my findings by target, the four accepted-limits questions, and the final section.

---

## R0. Round 27's verdict and repairs

Round 27 confirmed eight findings (4 LOW, 4 INFO) and repaired them at `e109b31`. I verified each:

**L1 repair (`detectMissingComponents`)** — Holds. The function fires after the production lock deadline for any explicit `_missing` flag across the nine checked keys. The selftest proves every key pages on first reading and that pre-deadline, rehearsal, and present components stay quiet.

**L2 repair (`coveredFreezes` in `detectCrankHealth`)** — Holds. The exact-match `covered` predicate suppresses only the three complete freeze-only messages when the corresponding account-freeze transition finding is present. Mixed Squads/unreadable blockers and unfamiliar strings stay visible. The selftest drives actual `planCrank` output and proves both directions, including the mixed-blocker case and the stale-heartbeat resurrection guard.

**L3 repair (`mintFailureCode`)** — Holds. Bounded log retrieval (5 s timeout) with invoke-stack attribution to MINT before accepting a named benign code. The selftest drives the installed SDK's actual `SendTransactionError` shape (no logs on a post-preflight failure) and proves retrieval works, that a foreign program's same-named code fails closed, that nested CPI errors retain their own attribution, and that unavailable logs fail closed.

**L4 repair (rehearsal lock checks)** — Holds. `detectUpgradeAuthorityAfterLock` returns `[]` immediately when `production: false`, before either the unset-deadline or elapsed-deadline branch. The selftest exercises the real alarm wiring with both a positive and null deadline under rehearsal.

No repair regressed. No new defect arises from the repairs themselves.

---

## R1. The crank (`bank/crank.mjs`)

### Finding C1 — LOW: `planCrank`'s `retiringWeight` reduce resets its accumulator on inactive vaults

**Construct:** `bank/crank.mjs`, `planCrank`, the `retiringWeight` reduce:

```javascript
const retiringWeight = plan.retireBurned.reduce((a, addr) => {
    const r = records.find(x => x.address === addr);
    return r.active ? a + wOf(r) : 0n   // BUG: returns 0n instead of a
}, 0n)
```

**What an accident gains:** When `plan.retireBurned` contains both active and inactive vaults and an inactive one appears *after* an active one in `records` order, the reduce resets the accumulator to `0n` instead of preserving `a`. The result is the weight of only the last contiguous run of active vaults at the end of the list, not the sum. This makes the denominator `w` too high.

**Concrete effect:**  
1. If the plan's `w` should be 0 (every active vault is retiring) but is positive, the plan sends a `distribute` the program refuses with `NoActiveVaults`. That code is in neither `BENIGN` nor `DISTRIBUTE_RACE`, so `judgeDistributeRefusal` returns `'fail'` — a wasted fee and a false "action failed" page.  
2. In the general case, `w` is slightly too high, so the plan's `acc` delta is slightly too small. The plan's owed amounts under-report by a fraction of a sat. The program computes its own accumulator and pays correctly, so no funds are lost or stolen; a vault near the 1-sat claim threshold may miss one pass.

**Evidence if true:** Construct two records: `A` (active, level 1, weight 2) and `B` (not active). Feed `planCrank` with `retireBurned = ['A', 'B']` and `cfg.total_active_weight = 2n`. The reduce yields `0n` instead of `2n`. The plan's `w = 2n` instead of `0n`, and `plan.distribute` is `true` where the program would refuse. Reverse the order (`['B', 'A']`) and the result is correct (`2n`), proving the order dependence.

**Fix:** Change `: 0n` to `: a` in the reduce callback.

**Not tested:** No selftest arm mixes active and inactive retiring vaults. The existing F5 and I1 arms use a single active retiring vault only.

**Rest of the crank:** I verified the send order (reschedule → capture → reveal → retire → pre-join → pre-expire → split → distribute → post-expire → activate → claim) matches the program's requirements. The reveal FIFO, attribute hash check, race handling, fee budgeting, chain-clock planning, and heartbeat all look correct. The plan never names a destination the program does not pin. The distribute refusal re-judgement (`judgeDistributeRefusal`) correctly distinguishes races from plan errors.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

I looked for a dangerous on-chain state read as quiet and a routine state paged every pass.

**No dangerous state reads as quiet.** The detectors cover: fixed-forever values (any change is CRITICAL drift), pending guardian/operator (CRITICAL standing), PoB collection plugins and update authority (CRITICAL drift), redemption window near-full (HIGH), frozen/insolvent pool (CRITICAL), distribution overdue (CRITICAL), upgrade authority past lock date for all five programs (CRITICAL), `boosts_stalled` (HIGH), and the crank heartbeat health. The documented blind spots (foreign nested assets, undeclared token accounts between passes, cross-pass correlation lag) are accurate and accepted.

**No routine state pages every pass.** The freeze transitions, brake transitions, and config drift are one-shot. Standing risks that are level-asserted (`swap_operator_armed`, `guardian_armed`, `test_value_in_production`) represent genuinely concerning conditions. `sweep_cooldown_wedged`, `sweep_cap_wedged`, `sales_stopped`, `sweep_stopped`, `guardian_retired`, and `joins_waiting` are INFO (visible but not paged). The `coveredFreezes` guard prevents frozen-pool problems from re-paging through `crank_problem`.

**Verified:** The `royalties_unswept` grace follows the on-chain cooldown. The `detectUnsweptRoyalties` net-balance masking is documented (round 27 D4). The unsplit clock restarts at the last split the scan saw. `detectUnreconciledRevenue` holds the ledger to the chain's sweeps and splits. `closesCycle` anchors on the return's block time and requires the split total to cover the return.

---

## R3. The layouts (`bank/layout.mjs`)

**Round 24 D6 (SEEDS assertion):** Now exists. The selftest scrapes all 11 seed declarations from the Rust source and requires exact match with `layout.mjs SEEDS`. A mistyped seed or an unmapped extra is caught.

**Struct comparison:** `parseRustStruct` reads each `pub struct` from the source and requires field-for-field equality (name and type) with `STRUCTS`. A private or `pub(crate)` field makes the parser throw. A changed type under the same name is caught. A field added to the Rust and not mirrored is caught.

**Cross-program offsets:** Every `OFF_*` constant in GOV, BURN, and MINT is scraped and compared against the computed layout offsets. The "scraped and ignored" gate (`L2:` arm) proves no constant is left unexamined.

**Account space:** `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE` are scraped and evaluated from the Rust, less padding, and held to the layout's fixed lengths.

**Could a struct change slip past?** No. Adding a field to the Rust makes `parseRustStruct` produce a different list, which fails the equality check. Changing a type fails. Removing a field fails. The layout version check at decode time provides a runtime backstop.

---

## R4. The money arithmetic (`bank/accrual.mjs` vs. MINT)

I compared every formula:

| Formula | Rust | JS mirror | Match |
|---|---|---|---|
| `credit` delta | `avail * ACC_SCALE / w` | `avail * ACC_SCALE / w` | ✓ |
| `owed_of` | `weight * acc + carry - debt` | `(weight + boost) * acc + carry - debt` | ✓ |
| `reweigh` | carry = owed, debt = new_weight * acc | same | ✓ |
| `ceil_sats` | `(scaled + ACC_SCALE - 1) / ACC_SCALE` | same | ✓ |
| `weight_of` | `LEVEL_WEIGHTS[level-1] + boost` | `WEIGHTS[level-1] + boost` | ✓ |

**Boost expiry:** The crank expires every DUE boost before distributing (`preExpires`, sent before `distribute`) and every boost the distribution makes due right after (`postExpires`, sent after `distribute`). Both use `expire_boosts` in batches. The `BoostsExpireFirst` gate is respected.

**Alarm:** `boosts_stalled` pages when a due boost is unexpired past the grace. `mint.cbob_mint`, `mint.max_boost_weight`, and `mint.max_boost_epochs` are watched as fixed-forever (CRITICAL on any change).

---

## R5. The swap and revenue cycle

### (a) Oracle math
`oracleFloor` computes `expectedSats = lamportsIn * sol.price * 10^e / (btc.price * 10)` where `e = sol.expo - btc.expo`, all in BigInt. This equals `lamports * SOL_USD / BTC_USD * 1e8 / 1e9`. The exponent handling is correct for all signs. Rounding is floor (conservative). `minSats = expectedSats * 9850 / 10000`, also floor. The `satsPerLamport` float is used only for the 100-bps deviation filter, not the floor; precision loss is negligible at current price magnitudes.

### (b) Pyth account verification
The account is derived (sponsored PDA, shard 0, under the push oracle), must be owned by the receiver program, must carry verification level 1 (Full), and must carry the expected feed ID. The `PriceUpdateV2` offsets are: disc(8) + write_authority(32) = 40, verification_level(1) = 41, feed(32) = 73, price(8) = 81, conf(8) = 89, expo(4) = 93, publishTime(8). These match the test fixtures and the selftest.

**Can anyone write a fully-verified update with an old publish_time or chosen price?** Not through any code path visible here. The account is a PDA of the Pyth push oracle program; only that program can write to it. The age check (180 s) and future-dated check (30 s) are judged against the chain's Clock sysvar (verified owner, verified readability). An unreadable Clock refuses the cycle. The residual trust in the Pyth programs themselves is documented (accepted limit 10, trusted items (a) and (d)).

### (c) Deviation filter
`orcaSpot` computes `(sqrt_price / 2^64)^2` in raw units (sats per lamport for wSOL/cbBTC). `meteoraSpot` computes the inverse of `(1 + bin_step/10000)^active_id` (sats per lamport for cbBTC/wSOL, reversed from Orca). Both are compared against `satsPerLamport` via `deviationBps`. The filter is at 100 bps. Float imprecision at 100 bps is negligible; the hard bound is the 150-bps on-chain floor.

### (d) Minimum out
Orca's `other_amount_threshold` and Meteora's `min_amount_out` both carry `minSats` = oracle expected output less 150 bps, in sats (the unit each program expects for these pools). The judge verifies the exact byte value. The same floor is used by the deviation filter's reference and the on-chain enforcement.

### (e) Judge (`judgeSwapInstructions`)
Requires the exact seven-instruction sequence. Checks: only allowed programs; only the owner signs; no priority fee; only SyncNative and CloseAccount token instructions; CU limit 400,000 (and no CU price); ATA creations for the operator's own wallet and mint; System transfer of exactly `lamportsIn` to the operator's own wSOL ATA; SyncNative of that ATA; the venue swap with the operator's wSOL at input and cbBTC at output, amount `lamportsIn`, threshold `minSats`, and for Orca the direction and price limit pinned; close back to the operator. The swap data length and every value-bearing byte are validated.

**What a tampered builder could still route past:** Nothing within the checked surface. The remaining trust is the box owner (who can edit the judge and the builder together — documented accepted limit 10, item (c)) and the venue programs (which validate pool-owned liquidity accounts). The post-signing delta check in `revenue.mjs` is a second line.

### (f) Account derivation
Orca: three tick arrays from `tickCurrent` (current, then two below), oracle PDA, vaults read from the pool. The selftest pins the tick-array starts against mainnet measurements. Meteora: bin arrays (active, then two above for Y→X), bitmap extension present or passed as the program ID, `host_fee_in` as None, event authority, two token programs. Seeds and order match the published IDLs. At a tick-array boundary the derivation is correct (tested). An uninitialized array causes the swap to fail (pool program rejects), which is safe.

### (g) wSOL handling
Wraps exactly `lamportsIn`, syncs, swaps, closes back. An existing wSOL ATA with a balance: the idempotent create is a no-op, the transfer adds `lamportsIn`, sync updates the amount, and the close returns everything (including pre-existing balance) to the operator. A frozen or delegated wSOL ATA: the swap or close fails atomically, nothing moves. The revenue delta check counts only the cbBTC change, not the wSOL residue.

### (h) Failure and retry
Orca first; Meteora only on a `refused` outcome (preflight refusal, landed-and-failed, or expired-and-absent). An unconfirmed send (`unknown`) throws and stops — no second venue, no double swap. `classifySendFailure` asks the chain via `getSignatureStatuses` with `searchTransactionHistory: true`. Every path leaves the ledger open until a cbBTC return is proven. The `pendingSweepSig`/`pendingSwapSig` candidates are evidence, not claims.

### (i) Adversary extraction bound
With the 100-bps deviation gate and 150-bps floor: the maximum extraction per cycle is 150 bps of the swap amount (the floor is 150 bps below the oracle's expected output). For a 10-SOL cycle (~$1,200), that is ~$18. At 4 cycles/day, ~$2,160/month. A sandwich attacker must push the price within 100 bps of the oracle to get the swap executed at all, then extract at most 150 bps. A manipulated Meteora pool (10x thinner) has more impact per unit of SOL, but the deviation gate and floor bound it identically. The stale-but-accepted oracle window is 180 s; Pyth's sponsored feeds update ~1/min and on every 0.5% move, so the practical window is 2-3 missed updates. All bounded and documented.

**Operator key worst case:** The key can keep up to `max_sweep_lamports` (10 SOL) per `sweep_cooldown_secs` (6 h) until the guardian stops the sweep. That is ~40 SOL/day, limited by the revenue PDA's balance above the reserve. The judge constrains what the swap can do with the swept SOL (output must go to the operator's own cbBTC ATA). The detection layer (unledgered sweeps, unreconciled cycles) reports misuse. The residual is the box-owner trust and the key itself.

---

## R6. The gates

**Assertions that cannot fail:** I found none. Every both-ways arm I checked has a positive and a negative case. The L1 judge arms prove the old judge passed all eight tampers. The L2 oracle arms prove the old box-clock path accepted a stale price. The L3 send-failure arms prove the old regex missed on-chain failures. The L4 cron arms prove the old line's period equaled the cooldown. The L7 program-ID arms prove mutating any of 14 copies turns the gate red. The I4 pin arms prove swapped arguments are caught.

**Floors satisfied by deleting work:** All floors use equality (`-eq`), not lower bound. `DET_FLOOR=860` matches `selftest.mjs`'s `FLOOR = 860`. `MIN_ASSERTIONS=848` matches the on-chain count. Every floor in SPEC is checked at every occurrence.

**Vacuous passes on empty input:** `detectVaultSetChange` returns early on `!prevLive`. `detectConfigDrift` returns empty on `!prev`. These are correct (first pass has no baseline). The `missingWatchedKeys` check requires a non-empty produced set. The wiring gate requires `V6_WIRED.length > 60`.

**`build-mainnet.sh`:** Builds all five programs. Proves the four initializing programs reject the test key (mainnet) and accept it (localnet). Proves the sweep helper's mainnet bytes are identical to the localnet build and to `target/deploy`. Checks the source carries Gary's key. Prints sha256 for all five. The banner honestly states what is and is not proven.

**`cron-install.sh`:** Installs exactly six tagged jobs. The `ours()` function matches only tagged, uncommented lines at end of line. The selftest proves commented-out lines, prose notes, other projects' lines, and reveal-lane lines do not arm `--live`. The posture print is computed from the crontab, not asserted.

---

## The four questions about the accepted limits

### 1. Is any limit WORSE than stated?

No. Each limit I checked is stated at least as broadly as its actual impact:

- **Limit 26 (leader grind):** "64 tries reach 96%" is accurate for best-of-4 skipping plus block-content variation. The cohort effect (same slot = same three hashes) is stated.
- **Limit 46 (PoB hot key):** The two attacks (end the project, capture governance) are stated in full, including the per-asset blind spot and the sampling gap. Buyer-facing.
- **Limit 41 (leaked custodial key):** Transfers unlimited, redemptions capped. Stated clearly.
- **Limit 10 (swap operator):** The bound is "cap × cooldown windows," not "one sweep." The detection layer's box-owner limitation is stated. The hand-recovery double-swap risk is stated.
- **Limit 32 (rate limit):** Self-redemption to spend the budget is stated with its cost.
- **Limit 55 (unsplit revenue):** The $GARY cost and crank-bound are stated.

### 2. Is anything listed as a limit not actually a limit?

**Limit 42** is narrower than its headline suggests: the round-26 D4 measurement shows the minimal owner-payer shape (1,219 bytes with all three creates) fits the legacy packet. The text acknowledges this ("That narrow variant is an offline size measurement, not a landed transaction or the page contract") and keeps the prior-transaction requirement for the fully padded shape. Appropriately stated.

Everything else I checked is a real, unrepaired condition.

### 3. Is any DISCHARGED item not actually discharged?

No. Item 51 (the boost) is fully built: `boost_vault`, `expire_boosts`, `set_boost_terms`, the carry, `BoostsExpireFirst`, owner-only, buyer's terms, the ring. Every piece is in the Rust and mirrored off chain. Item 54 (compute at widest host shapes) is measured and the figures are consistent. Items 30, 31, 33 are gone with what they were about. Items 14, 19 are closed on chain or by construction.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

No. Items 22 (live distribution), 38 (launch values), 50 (holder surfaces), 52 (pool accounts), and 53 (dress rehearsal) are all explicitly listed as road steps that have not started. The holder guide is marked DRAFT and says the redeem page is "being built." The charter date and lock deadline are OPEN in `mainnet-init.json` and refused by the checker. None is being treated as done.

---

## Summary of new findings

| ID | Severity | Finding |
|---|---|---|
| C1 | LOW | `planCrank`'s `retiringWeight` reduce resets its accumulator to `0n` instead of preserving `a` for inactive vaults, causing the plan's denominator to be too high when active and inactive retiring vaults are interleaved. Can produce a false `NoActiveVaults` failure (wasted fee, false page) or slightly under-computed owed amounts (corrected by the program). Fix: `: 0n` → `: a`. Untested by any selftest arm. |

No CRITICAL. No HIGH. No MEDIUM.

---

## Given that no human firm will ever see this and the programs will be immutable, what should this project do before launch that AI audit structurally cannot?

1. **Actually run the dress rehearsal (item 22), including the forced failure.** AI can verify the code reads correctly; it cannot observe an RPC timeout at vault 1,900 of 2,100, a rate-limit page from Helius, or a ledger row that does not match the chain at 3 AM. Every named item in item 22 must be executed with real transactions and their signatures recorded. The hand-recovery drill (item 22.4) is the single most important untested path in the system.

2. **Have a human sign the launch parameters after reading them aloud.** `check-launch-params.mjs` validates the JSON, not the signed transaction. Someone must read `mainnet-init.json` field by field against DESIGN-v6 and sign a paper saying "these are the values I am committing to immutability." The charter date and lock deadline need Gary's decision, not code.

3. **Move the $CBOB release wallet key and the PoB collection key off this box before the charter window opens.** Limit 56 and limit 46 are both hot-key custody problems on the same server that runs the alarm, the crontab, and the revenue ledger. A single box compromise takes the $CBOB supply and the ability to block or capture the charter window. This is an operational decision only Gary can make.

4. **Run the swap through a second RPC provider, or at minimum verify every price and pool read against one.** Limit 10's trusted-item (b) is one RPC endpoint for every price, pool account, and floor. A compromised or buggy endpoint can return a stale price (accepted within 180 s) or a manipulated pool state. A second provider cross-checking the reads is cheap insurance.

5. **Put the revenue ledger and alarm state in append-only, off-box storage.** Limit 10's item (3) says the detection half does not survive a box compromise. If the ledger is writable, the operator key's theft is undetectable. Shipping every ledger write to a second system (even an S3 bucket with versioning) converts this from "the box owner is trusted" to "the box owner must compromise two systems."

6. **Have 3-5 real users attempt a redemption on the Test Vault simulation before the holder guide is published.** Item 50's surfaces do not exist. The guide promises things ("the redeem page will check and warn you"). A user walking through the manual redemption path will find packet-size edges, missing ATA creation steps, and confusion the code review cannot.

7. **Write and rehearse the "alarm is down for a week" runbook.** The dead-man's switch pages if the alarm state goes stale, but there is no documented procedure for what a human does at 3 AM when the alarm is silent and the crank is wedged. Every accepted limit that says "the alarm pages" assumes a human responds. Practice the response.

8. **Freeze the code and re-run `run-tests.sh` and `sim/swap-fork.sh` at the exact commit that will be deployed, with the network probes confirmed as RAN (not skipped).** The suite passing at an earlier commit is not evidence for a later one. The ship gate requires the probe and fork to have executed.