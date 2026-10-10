# Independent audit of the v6 off-chain pipeline — final tree

I read the whole bundle. I checked every round-46 repair at its construct, re-derived the oracle and accrual arithmetic by hand, traced the crank's plan/send order against MINT's gates, walked the alarm's detectors against their blind spots, and probed the selftest for arms that cannot fail. What follows is what survived measurement.

---

## R0 — Round 46's verdict and its repairs

**Every round-46 repair holds at every site I checked. No new defect survived measurement in the fixable layer.**

| Repair | Construct verified | Result |
|---|---|---|
| V46-1 resumable multi-send steps | `rehearsal-steps.mjs`: every step whose `run` has >1 send site is `resumable: true` and off `SINGLE_SEND_STEPS`; `nextAction` gates `--resume` | holds |
| V46-2 values re-filled before step 10 | `ceremony-values` is a `recheck` step, sits after every upgrade and before `ceremony-collection`; `recheckAction` re-runs when the read-back breaks | holds |
| V46-3 rescue records the nest | `rehearsal-steps.mjs` rescue step: `st.nestedSent = true` before the branch that would nest again | holds |
| V46-4 hand recovery after a landed swap | `rehearsal-recover.mjs` `handRecover`: a landed swap is never repeated; the return and split complete; an already-hand-closed cycle reads `alreadyRecovered` | holds |
| V46-5 mainnet-local refuses overrides | `bundle.test.mjs` V46-5 arms: `takesOverrides` false for `launchJudge === 'mainnet'`; build-time `--rpc`/`--collection`/`--launch-json` refused | holds |
| V46-6 refused values end preflight | `ceremony.mjs` preflight: `if (fails.length) return null` before the program reads | holds |
| V46-7 SPEC 53 records the re-proof | SPEC now names the `e7c192a` re-proof and what keeps the item open | holds |
| V46-8 init key by genesis | `initKeyFor('mainnet')` = Gary's wallet; `judgeInitAccount` refuses a program-owned account; the seed-7 key is refused on mainnet genesis | holds |
| V46o-1 asset-less ack arm | `selftest.mjs` now drives `unredeemable_owner` with no asset and a well-formed ack; the arm is red under the guard-deleted mutant | holds |
| V46o-2 undelivered-pass rollback | `alarm.mjs` `!delivered` block restores `unreadPasses` and `unreadSkips` with cursors; the extracted-walk harness proves it | holds |
| V46o-3 load-time refusal pages | `refuseStrayOverridesAtLoad` reaches the literal production notifier exactly once, writes the marker, exits 3 | holds |
| V46o-4 tracked placeholder | `web/test/fixtures/placeholder/` is tracked with its sha256 pinned in `SHA256SUMS` and the ceremony test reads it from there | holds |
| V46o-5 instrument computes bundle claims | `scripts/audit47.ts` (referenced in VALIDATION) computes what each pass carries | holds (file not in this bundle; the VALIDATION record is the evidence) |

**One LOW finding is confirmed, and one claim that would have mattered is disproved by measurement:**

---

### LOW-1 (new) — `bank/crank.mjs` `planCrank`, the reveal run: a record whose asset is `'other'` ends the reveal run for every vault behind it

**Construct.** `bank/crank.mjs`, the reveal loop (`for (const a of plan.reveal) { … }`): `revealAttrSource(assets[r.asset])` returns `'skip'` when the asset is anything other than `'live'` or `'burned'` — including `'other'`, the catch-all for a missing account, a foreign owner, or a data shape the classifier does not know. The loop then does `break`, stopping every subsequent reveal in the queue.

**What an attacker or an accident gains.** If a single vault's asset account reads as `'other'` at the moment the crank fetches it (an RPC returning null for one key in `getMultipleAccountsInfo`, a Core account whose first byte is neither 0 nor 1), the ENTIRE reveal queue behind that vault stalls until the read succeeds. The FIFO is strict, so every vault behind it cannot take its level. At 2,100 vaults and a busy sale hour this is the entire remaining supply waiting on one unreadable account.

**Evidence if true.** The selftest arm `V43o-3: an asset that reads as neither live nor burned ENDS the reveal run` proves the mechanism: `revealCtx({ AssetOne: 'other', AssetTwo: 'live' })` sends NOTHING, not even for AssetTwo. The alarm's `reveal_queue_stalled` would fire after two passes of no movement, which is the correct detection — but the stall itself is real.

**Severity.** LOW. The alarm detects it. `getMultipleAccountsInfo` is atomic (it returns a full array or throws), so the `'other'` classification requires the account to genuinely be in an unexpected state on chain — which for a live CBOB vault means a Core change (item 40) or a never-before-seen plugin shape. The `R40 C10` arm proves the reader handles unknown plugin types (77, 40) correctly, so the realistic trigger is narrow. But the consequence — every vault behind one unreadable asset cannot reveal — is worse than the "next pass" language in the code comment suggests.

**Fix.** Instead of `break`, `continue` past an `'other'` record and report it as a problem (the plan already has `plan.problems`). The FIFO is enforced on chain (`RevealOutOfOrder`), so skipping one record and revealing the next would be refused anyway — but the crank should say "record N is unreadable, the queue is held" rather than silently ending the run for records N+1 … 2,100.

---

## R1 — The crank (`bank/crank.mjs`)

I traced every plan path against MINT's gates. The order is correct: reschedule → capture → reveal (strict mint order) → rescue → retire → pre-join → expire-before → split → distribute → expire-after → activate → claims. Every instruction the crank sends is permissionless and pins its own destination. The fee budget keeps the floor in reserve. The join-before-distribute rule matches `JoinWaitingFirst`.

**No plan the program will refuse was found** beyond the known benign races (`BENIGN` covers `AlreadyRetired`, `AlreadyActive`, `NothingToSplit`, `NotNested`, etc.), all of which are correctly classified. `judgeDistributeRefusal` re-reads the config and classifies a refused distribute as benign only if `dist_epoch` or `last_distribute_at` moved — `PoolShort` is always a fault.

**No plan pays or joins a dead vault:** `assets[r.asset] !== 'live'` is checked before every join and every claim.

**No reveal is sent out of order:** the loop starts at `cfg.revealed_total` and breaks at the first record that is not ready.

**The crank moves value nowhere the program does not already pin.** The selftest's `crank.mjs sends only permissionless MINT instructions` arm and the `no token or SOL transfer of its own` arm both hold.

---

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

The alarm is the most heavily tested file in the tree. Every detector is proven both ways. The wiring gate proves every detector's result is consumed. The detector list is derived, not typed.

**No dangerous on-chain state reads as quiet** that I could find beyond the accepted blind spots (items 9, 44, 46 — foreign Core assets, undeclared airdrops, per-asset PoB changes).

**No routine state pages on every pass** that I could find. `sales_stopped`, `sweep_stopped`, `joins_waiting` are INFO. A freeze pages once (`applyFrozenTransitions`). A level kind gets a RECOVERY on the first clean pass.

**One observation (INFO):** `detectUnsweptRoyalties` measures the age of an unswept balance on `wallSec` (the box clock), while `detectDistributionOverdue` and `detectSweepState` use the chain clock. The balance itself is read from chain, so the detection is accurate; only the "has it been 24 hours" question uses the box clock. If the box clock drifts, the grace window drifts with it. This is a detection heuristic, not a money decision, and the alarm already has `sweep_unledgered_state` (chain-derived) as a backstop. Not worth a finding, but worth noting for consistency.

---

## R3 — The layouts (`bank/layout.mjs`)

Every struct is parsed from the Rust source and compared field-for-field. Every cross-program offset is computed from the layout and compared to the Rust constant. The seeds are scraped from the `*_SEED` constants. The mutation arms (add a field, retype a field, bump a version, change the ring size) all turn the gate red.

**The round-24 D6 claim (SEEDS "asserted against the Rust") is now true:** `judgeSeeds` scrapes all twelve seeds and compares. The selftest's `D6: every PDA seed in layout.mjs equals the one its program declares` arm holds.

**No struct change could slip past the assertions.** `parseRustStruct` throws on any line it cannot read as `pub name: Type,`.

---

## R4 — The money arithmetic (`bank/accrual.mjs`)

I re-derived the accrual by hand against MINT's `credit`, `owed_of`, `reweigh`, `ceil_sats`, `join`, `retire`. The formulae match exactly. The selftest's 39 assertions verify the 1:1.5:2:2.5:3 ratio, the dust-carry property, the frozen-payout property, the retired-share-return property, and the boost carry/restart property. The crank's `pendingScaled` calls for pre-joined and pre-expired vaults use the same formulae as the program.

**The crank expires every DUE boost before it distributes** (`preExpires`, `dist_epoch >= boost_end_epoch`) **and every boost its own distribution makes due right after** (`postExpires`, `boost_end_epoch === dist_epoch + 1`). The alarm pages `boosts_stalled` and treats `cbob_mint` and the boost bounds as fixed forever.

**No divergence found.**

---

## R5 — The swap (`bank/swap.mjs`, `bank/revenue.mjs`)

I checked every part of (a) through (i).

**(a) Oracle math.** `oracleFloor` computes `sats = lamports × sol × 10^(es−eb) / (btc × 10)` in BigInt. The exponent handling is correct for every sign (positive `e` multiplies the numerator, negative multiplies the denominator). The rounding is floor for `expectedSats` and floor for `minSats`, which is the safe direction. The BigInt-to-Number conversion in `satsPerLamport` is only used for the deviation check (100 bps threshold), where float precision (~2×10⁻¹⁶) is negligible. The floor is genuinely below what an honest pool returns after its fee (Orca 16 bps) and impact (round 25 measured 18.1 and 20.1 bps under the oracle at the 10-SOL cap).

**(b) Pyth verification.** `readPyth` checks ownership (the receiver program), the derived PDA, full verification (`level === 1`), the feed id, and the exponent range. The `PriceUpdateV2` offsets are correct: disc(8) + write_authority(32) + level(1) + feed(32) + price(8) + conf(8) + expo(4) + publish_time(8). The clock is the chain's Clock sysvar. A stale-but-accepted oracle is bounded by the 180-second age and the 30-bps confidence check; a chosen price would require the push-oracle program to accept it, which is outside our control (item 40).

**(c) Deviation filter.** `orcaSpot` is `(sqrt_price / 2^64)²` in raw units (sats per lamport). `meteoraSpot` is `1 / (1 + binStep/10000)^activeId`, correctly inverting DLMM's lamports-per-sat convention. Both are in the same units. The 100-bps threshold is checked with `deviationBps`, which is symmetric. Float imprecision cannot pass a pool it should refuse (the threshold is 100 bps = 0.01, and float error is ~10⁻¹⁶).

**(d) Minimum out.** The floor is `expectedSats × (10000 − 150) / 10000`, computed in BigInt. It is the SAME floor the deviation filter uses (both derive from `oracleFloor`). Orca's `other_amount_threshold` and Meteora's `min_amount_out` carry it in the correct positions (offset 16 in the swap data for both).

**(e) The judge.** `judgeSwapInstructions` requires the exact seven-instruction sequence, checks every account, amount, floor, direction, and the ATA derivations. It refuses `setComputeUnitPrice`, any Token instruction but SyncNative and CloseAccount, a second signer, two swaps, a foreign program, and a changed compute limit. The round-46 flag-clearing finding is disproved (measured: every cleared-flag mutation compiles to a byte-identical message).

**(f) Account derivation.** Orca: the three tick arrays (current, then two below) are derived from `tickCurrent / (88 × tickSpacing)`. The oracle PDA is `["oracle", pool]`. Meteora: the bin arrays (active, then two above) are derived from `activeId / 70`. The bitmap extension is passed as the program ID when absent. `host_fee_in` is None. The event authority and both token programs are correct. At a tick-array boundary the arrays shift correctly (selftest: `orcaTickArrayStarts(-90112, 16)[0] === -90112`).

**(g) wSOL handling.** The wrap transfers exactly `lamportsIn`, SyncNative runs, the swap executes, and the close sends everything back to the operator. If the wSOL ATA already exists with a balance, the close returns that balance too (it belongs to the operator). If the swap consumes less than the input, the remainder is returned by the close.

**(h) Failure and retry.** Orca first; Meteora only on a REFUSED outcome (`classifySendFailure` reads the chain: landed-and-errored or expired-and-absent is refused, landed-and-succeeded is recorded). A confirmation timeout that later lands is classified as `landed` and recorded, never retried. An `unknown` outcome throws and keeps the cycle open. The open-cycle guard refuses a new cycle while one is open.

**(i) Adversary extraction within tolerance.** The 100-bps deviation gate plus the 150-bps floor bounds the adversary to at most ~84 bps per cycle on Meteora (100 bps deviation minus 16 bps fee) before manipulation costs. At the 10-SOL cap and 6-hour cooldown, that is ~0.084 SOL per cycle. The SPEC already states "these checks do not establish a hard bound on deviation from the true SOL/cbBTC market price." This is accepted limit 10's residue.

**The operator key's worst case** is unchanged from limit 10: 10 SOL per 6-hour cooldown until the guardian stops it. The ledger cannot read a failed cycle as closed (`cycleIsOpen` returns false only when `returnedSats > 0` and a split exists).

---

## R6 — The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

I probed for assertions that cannot fail:

- **Floors must EQUAL counts** (`floor()` in `run-tests.sh`, `R.length !== FLOOR` in `selftest.mjs`). Deleting assertions turns the build red. ✓
- **The wiring gate** (`consumed`) strips comments, reads each function body, and requires the result to be spread or pushed. Deleting a call, leaving it in a comment, or throwing away the result all turn it red. The selftest's `L13b` arms prove all three. ✓
- **The ack arm** now drives `unredeemable_owner` (the one ackable kind) with a well-formed ack keyed `unredeemable_owner:undefined`. Under the guard-deleted mutant, the arm is red. ✓
- **The cron template gate** (`judgeCronTemplate`) requires `flock -n` on every `node bank/*.mjs` line. A waiting flock, a commented-out `-n`, or a bare `flock` all turn it red. ✓
- **The control table gate** parses SPEC's rows and checks the fourth column against the error enums and the cron installer. ✓

**One arm I checked for vacuousness and found sound:** the round-24 "every repair above is armed in BOTH directions" claim. The selftest's `L5` arm cuts each detector's uses and requires the wiring gate to name exactly that detector. All eight detectors tested turn it red.

**No assertion that cannot fail was found** beyond the round-46 V46o-1 repair (now fixed).

---

## The four questions about the accepted limits

### 1. Is any limit WORSE than stated?

**No.** I re-read every accepted limit against the code. The closest call is limit 10's swap-operator exposure: the SPEC says "cap × cooldown windows until the guardian pulls `emergency_stop_sweep`." That is accurate. The throughput ceiling (34 SOL/day at the 6-hour cooldown) is correctly derived. The `detectUnsweptRoyalties` grace follows the cooldown (tested: 25 hours quiet at a 24-hour cooldown), which is the correct reading.

Limit 32's redemption cap: "blocking one hour costs about 2.1% of live supply in vaults" is accurate (45 vaults at 2,100 live, each burned).

Limit 46's charter-window exposure: the SPEC and holder guide both state the full consequence (block every claim, or capture governance). Neither understates it.

### 2. Is anything listed as a limit not actually a limit?

**No.** Every item in "Known limits" and "ACCEPTED LIMITS" describes a real cost of a real decision. Item 51 (boost timing) is disclosed as accepted. Item 54 (compute at widest shapes) is discharged but its note ("binds the holder pages") correctly points at item 50, which is still open.

### 3. Is any DISCHARGED item not actually discharged?

**No.** Items 12/17 (compute units), 14 (duplicate attributes), 19 (unlevelled-vault halt), 30 (85/15 vote), 31 (cadence), 33 (replacement notice) are all genuinely closed by measurement or by deletion.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

**No.** Items 22, 38, 50 and 53 are all correctly marked OPEN AND BLOCKING. The rehearsal record shows item 22.2 recorded FAIL (a true detection), which the SPEC requires to be resolved before launch. `launch/mainnet-init.json` still has `charter_opens_at`, `lock_deadline` and `vault_collection` OPEN. Item 50's pages are built and staged, not published.

---

## What no AI audit structurally cannot do — and what this project should do before launch

The programs will be immutable. Every surviving bug is permanent. Here is what AI audit cannot do, concretely:

1. **Exercise the crank and revenue job at 2,100 vaults on a live chain.** Item 22's residue. The rehearsal proved 5 vaults. The crank's `getProgramAccounts` fetch, the 150-transaction claim batch stream, the every-minute reveal lane under load, and the revenue job's sweep/swap/return/split cycle against a real 6-hour cooldown have never run at production scale. **Before the lock: run the full pipeline for one week against the real deployment with real vaults, before any holder money is in them.** The 2,100-vault claim batch alone is ~150 transactions per distribution; nobody has measured the RPC cost, the rate limits, or the behaviour when vault 1,900 of 2,100 hits a transient error.

2. **Test the operational response at 3 AM.** The alarm pages `crank_silent`, `distribution_overdue`, `unreconciled_swap`, `program_not_locked`. Does anyone respond? How fast? The guardian's `emergency_stop_sweep` is the answer to a stolen operator key — but only if a human reaches the wallet. **Before the lock: drill the incident response.** Have someone steal (a copy of) the operator key on a rehearsal deployment, start sweeping, and measure how long until the guardian stops it.

3. **Test the holder pages with real, non-technical users.** The redeem page's standing consent, the grouped tick-boxes, the "show my vaults" pick list, the claim page's Proof of Burn flow — these are the surfaces holders will use to move real Bitcoin. AI audit can verify the instructions are correct; it cannot verify a 65-year-old holder can open their vault without calling support. **Before the lock: have five people who have never seen the system open a vault on the rehearsal deployment.** Watch where they hesitate.

4. **Verify the deployed bytes on a machine that is not the Bank's.** The `verifiable-build.yml` workflow runs on GitHub's runners, which is good. But the actual road-step-9 deploy is done from the Bank's box. **Before the lock: have someone who is not on the Bank's box run `solana program dump` on each of the five programs and compare to `dist/SHA256SUMS`.** The README's "Verifying what is deployed" section is the right instruction; it needs to be executed by a stranger.

5. **Back up the keys and test the restore.** The deploy authority (`bank/keys/deploy-authority.json`), the swap operator key, and the $CBOB release wallet key are on the box and in the nightly R2 backup. If the box dies before road step 11, the five program IDs are stuck at the placeholder forever (SPEC: "a closed loader-v3 program id can never be reused"). **Before the lock: restore the backup to a fresh machine and verify every key works.** The cost of getting this wrong is five new program IDs and a program change.

6. **Have a named human read every alarm page for one week before the lock.** The alarm's design assumes a human reads `vault_burned`, `bare_core_burn`, `sweep_unledgered_state`, `config_drift` and acts. The rehearsal caught a real Core upgrade this way — but only because Gary was watching. **Before the lock: assign a named on-call person for the alarm's streams, and verify they respond to every page within the grace window.**

7. **Test the disaster recovery for the revenue cycle.** Limit 10's hand recovery runbook is the answer to a failed swap. It has been rehearsed once (item 22.4 PASS). But the runbook says "look up every recorded confirmed or candidate signature with `getSignatureStatuses`" — which is a human procedure on a live chain with real SOL. **Before the lock: walk the runbook again with a second person who has never seen it, on the rehearsal deployment, with the ledger deliberately corrupted.**

None of these can be done by reading code. They require time, people, and a live chain. The programs will be immutable in weeks. The cost of getting any of these wrong is permanent.