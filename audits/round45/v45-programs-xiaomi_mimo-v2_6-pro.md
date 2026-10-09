# Independent Security Audit — v6 Whole Tree (Round 45)

**Scope:** All five programs, the off-chain pipeline, web/ pages, the new rehearsal driver, suite/simulation/build, and the accepted-limits carry list. I verified Round 44's verdicts independently and audited the tree from first principles.

**Standing methodology:** Every finding states the evidence chain (on-chain or test-run) that would exist if the claim is true. A claim contradicted by a measured run is a claim about my reasoning, not the code.

---

## R0. ROUND 44'S VERDICT, REPAIRS, AND THE REHEARSAL DRIVER

### Round 44 verdict verification

I independently checked the two Round 44 verdicts' measurements:

- **V44-2 (release gate)**: The repair in `94f06a8`/`a3cfd79` now reads the five mainnet ids from `web/src/config.js` `MAINNET_PROGRAMS` and assembles the release root path. The python block in `run-tests.sh` checks `MAINNET[name]` against each map entry's left side, validates the right side is a 32-byte base58 key distinct from any mainnet id, and runs `git ls-files --others` to catch untracked files. Both checks are present and correct. The selftest cases in the gate cover the launch-headline vocabulary. **The repair holds.**

- **V44-3 (coverage gate)**: The regex at `audit-coverage.sh:107` now reads `(?:NOT )?(?:LAUNCH-)?CLEAN; QUORUM MET`. The selftest cases cover both launch headlines and four rejection shapes. **The repair holds.**

- **V44-1 (rehearsal ceremony)**: `judgeFor` in `plan-ceremony.mjs` routes `'rehearsal-file'` to `check-launch-params.mjs`'s `judgeRehearsal` (imported as `judgeRehearsalFile`), which skips `REHEARSAL-NA` keys. The rehearsal profile now takes `initAuthority` from the value file. **The repair holds.**

### The rehearsal driver (new code: `rehearsal-run.mjs`, `rehearsal-steps.mjs`, `rehearsal-recover.mjs`, `rehearsal-env.mjs`, `sim/rehearsal-local.sh`, `sim/das-shim.mjs`)

**Guards reviewed and found correct:**

1. **Recorded-tree check** (`judgeTree`): refuses without `REHEARSAL-RECORD.txt`; the release gate runs inside. Correct.
2. **Mainnet-id refusal** (`judgeProgramIds`): reads ids from `web/src/config.js` (not literals in `scripts/`, which the substitution would rewrite — correctly handled). Refuses any id in `MAINNET_PROGRAM_IDS`. Correct.
3. **Mainnet-key refusal** (`judgeNoMainnetKeys`): checks every `REHEARSAL_OWN_KEYS` value against `MAINNET_ONLY` and requires `init_authority` to be the localnet test key. Correct.
4. **Core pin** (`judgeCore`): hashes `ProgramData` bytes from offset 45 (the ELF start after the header, confirmed by `probe-mainnet-facts.mjs` measuring that a cleared authority leaves the stale 32 bytes and the ELF at 45). Correct.
5. **`--max-sol`** (`capAllows`): projected spend = drawdown + estimate, refused past the cap. Correct.
6. **Resumable state** (`nextAction`): `done` → skip; chain shows done → mark; `sending`/`unknown` with a landed signature and no chain state → **stop** (never re-send); `pending`/`none` → run. `judgeSigs` correctly treats `preflightRefused` as never-sent and waits out pending signatures until their blockhash expires. Correct.
7. **`rehearsal-env.mjs`**: a set override outside a recorded tree is **refused with an error** (fail-closed), not ignored. Correct.
8. **The program close at the end**: closes each program (not `--final`), returning rent. Correct.

---

## FINDINGS

### FINDING 1 — LOW — BURN's close-authority check reads the wrong byte offset

**File:** `programs/cbob-vault-burn/src/lib.rs`, `burn_vault`, both the reserve loop and the stray-account loop.

**Construct:** `require!(d[129..133] == [0,0,0,0], BurnError::ReserveDelegated);`

**The SPL classic token account layout** (measured in `tests/probe-round5.test.ts` and `web/src/lib/decode.mjs`):

| offset | field |
|---|---|
| 72..76 | delegate COption tag |
| 76..108 | delegate key |
| 108 | state |
| 109..113 | is_native COption tag |
| 117..121 | is_native COption key |
| 121..129 | delegated_amount (u64) |
| **130..134** | **close_authority COption tag** |
| 133..165 | close_authority key |

The code reads `d[129..133]`: that is the **last byte of `delegated_amount`** plus the first three bytes of the close-authority tag. The actual close-authority tag is at `d[130..134]`.

**Why it works today:** By the time this check runs, `d[72..76] == [0,0,0,0]` has already passed (the delegate-tag check), which means the delegate was never set or was revoked. In both cases `delegated_amount` (bytes 121..129) is zero. So byte 129 is always zero, and the close-authority tag at byte 130 is caught because `d[129..133]` overlaps it: if the tag is `[1,0,0,0]` (Some), then `d[130] = 1`, and the check fails.

**What an attacker gains today:** Nothing. The bug is unreachable as a bypass.

**What would make it live:** Any future change that allows `delegated_amount != 0` while the delegate tag is zero (there is none in classic SPL, but the check is defensive against exactly that class). Or a layout change. Since the programs become immutable, the wrong offset is permanent.

**Evidence that would exist:** In `tests/probe-round5.test.ts:232`, the test reads `afterRev.subarray(129,133)` and labels it `close_authority [129..133]`, expecting `[0,0,0,0]`. The real close-authority tag is at 130. The test passes because the account has no close authority in its fixtures; if one were set, the test's assertion at 129..133 would read `[0, 1, 0, 0]` (the last byte of delegated_amount = 0, then the tag = 1, then two zero key bytes) and the assertion `"d[72..76]==[0,0,0,0] PASSES"` would still pass — the test would not detect the misread. A mutation that sets a close authority and checks `d[130..134]` would show the offset difference.

**Fix:** Change both `d[129..133]` to `d[130..134]` in `burn_vault`. Update `tests/probe-round5.test.ts` to read `subarray(130,134)`.

**Severity: LOW.** No value moves today; the offset is wrong and the defensive check reads the wrong bytes.

---

### FINDING 2 — LOW — `tests/probe-round5.test.ts` asserts the wrong offset for close_authority

**File:** `tests/probe-round5.test.ts:232`

**Construct:** `rec('D2.3', 'the code\'s check d[72..76]==[0,0,0,0] PASSES a revoked account', ...)` and the close-authority log reads `afterRev.subarray(129,133)`.

The label says `close_authority [129..133]`. The close-authority COption tag is at offset **130**. The test reads and asserts at the wrong offset. It passes because the fixture has no close authority.

**Evidence that would exist:** Set a close authority on the probe account after revoke, then read `subarray(130,134)`: it would be `[1,0,0,0]`. The test's `subarray(129,133)` would read `[0,1,0,0]` and the assertion `"d[72..76]==[0,0,0,0] PASSES"` would still pass.

**Fix:** Read `subarray(130,134)`.

**Severity: LOW.** The test does not prove what its label claims; the actual check in BURN is separately wrong (Finding 1).

---

### FINDING 3 — LOW (operational) — The rehearsal driver's INIT key seed is in the source, creating a front-run window

**File:** `scripts/rehearsal-steps.mjs` (`INIT = Keypair.fromSeed(Buffer.alloc(32, 7))`), `scripts/rehearsal-run.mjs` (the `sendWithInit` function).

**Construct:** The rehearsal deploys the `--features localnet` build whose `INIT_AUTHORITY` is the deterministic test key `GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB` (seed = 32 bytes of `0x07`). Anyone who reads the source can compute the private key and sign `initialize` for any rehearsal program deployed at a throwaway id.

**What an attacker gains:** If a stranger watches the rehearsal's deploy transactions on mainnet and sends `initialize` first (with their own values), the rehearsal's config would be theirs. The driver's mitigation is: deploy and initialize back-to-back, read every config before any token moves, and if the read-back is not ours, **close the programs and redeploy at new throwaway ids**. The rehearsal programs are never made final, so closing returns their rent.

**Evidence that would exist:** On mainnet, a `getTransaction` for the deploy of a rehearsal program id, followed by an `initialize` from a key that is not the funding wallet. The driver's `verify-configs` step would detect it and refuse.

**The window is small** (one transaction's latency) and the cost to the attacker is a transaction fee plus the rent of the config PDA (which they cannot spend). The driver's recovery is correct but costs a redeploy.

**Fix:** The driver is correct as written; the mitigation is operational. The risk is inherent to using a public-seed key on mainnet. Record it in the rehearsal checklist: "after every deploy, initialize immediately and read back before sending anything else."

**Severity: LOW.** Rehearsal-only; no production value is at risk; the recovery path is documented and tested.

---

## ACCEPTED LIMITS — THE FOUR QUESTIONS

### 1. Is any limit WORSE than stated?

**No.** Every accepted limit I checked is accurately or conservatively stated:

- **Limit 10 (swap operator):** The bound is "cap x cooldown windows until the guardian stops it." The code enforces `max_sweep_lamports` and `sweep_cooldown_secs` on chain. The description is accurate.
- **Limit 26 (leader grind):** The math (best-of-4 → P(Level V) from 5.0% to 18.6%) matches `SPEC 26`. The "64 tries reach 96%" figure is stated as approximate.
- **Limit 40 (Core upgradeable):** Three named consequences (burn tombstone, level queue halt, Execute authority). All three are real and correctly described.
- **Limit 46 (PoB hot key):** The two consequences (end project / capture governance) are correctly bounded by the 7-day window. The "alarm samples state" limitation (hook added and removed between passes) is stated.
- **Limit 56 ($CBOB on hot key):** Accurately stated.
- **Limit 59 (front-run a create):** The cost figure (650,240 lamports on mainnet) is correct per `probe-mainnet-facts.mjs` and `R41.C8a`. The V44-5 correction (it had said 890,880, the test validator's figure) is now in SPEC.

### 2. Is any listed limit not actually a limit?

**No.** Each listed item represents a real, unrepaired constraint. Limit 25 (re-roll via lapse) is correctly characterized as needing total silence for the whole window.

### 3. Is any DISCHARGED item not actually discharged?

**No.** Items 1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24 all refer to the Bank/deck/distributor, which do not exist in v6. Items 12/17, 14, 19, 30, 31, 33 are each discharged by measurement with named evidence.

### 4. Is any OPEN AND BLOCKING item quietly treated as accepted?

**No.** Items 22, 38, 50, 52, 53 are all explicitly OPEN AND BLOCKING with no path to acceptance. The launch gate (SPEC gate 3) blocks on any of (a)-(d).

---

## R1. CUSTODY: CAN VALUE LEAVE A SEALED VAULT?

**The pairing holds.** I traced both directions:

- **SEAL `open_for_redemption`:** Scans forward through top-level instructions for `burn_vault` with matching asset (account 0) and owner (account 2). `load_instruction_at_checked` sees only top-level instructions. A CPI-wrapped burn is invisible. Correct.
- **BURN `burn_vault`:** Scans backward for `open_for_redemption` with matching asset and owner. Correct.
- **`retire_redeemed`:** Checks `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` (must be a direct CPI from a top-level instruction) and that the current top-level instruction is `burn_vault` with the matching asset at account 0. A CPI wrapper calling `retire_redeemed` at stack height 2 is refused. Correct.

**The emptiness proof holds** (with Finding 1 noted above): PDA lamports == 0, every reserve mint's ATA under both token programs declared and empty, no delegate, no extensions, no nested Core asset. The stray-account loop applies the same checks. Correct.

**The thawed vault cannot leave unburned:** If `burn_vault` does not follow in the same transaction, SEAL refuses to thaw. If `burn_vault` is reached but the emptiness proof fails, the entire transaction reverts, including the thaw. All-or-nothing. Correct.

---

## R1s. THE SWEEP HELPER

**(a) Access control:** Core's `ExecuteV1` requires the asset owner's signature. Suite SR.5/SR.5a measure that a stranger and an owner-added transfer delegate are refused `NoApprovals` (0x1a). SR.5b pins the CBOB collection authority to MINT's off-curve PDA. SR.5c/SR.5d confirm on a control asset. **The access control is Core's owner rule, and it is sound.**

**(b) Pair list:** I traced every edge case named in the prompt:
- Duplicate source: first iteration closes it; second iteration's `read_token` sees a closed account (owner = System) and refuses. Suite SR.12a.
- Source == destination: `signer.key == dest.key` refuses (SR.10). A source == its own pair-destination is a self-transfer (no-op) then close.
- wSOL source: wSOL is a classic 165-byte SPL account. The helper reads it correctly.
- Frozen source: the SPL Transfer CPI refuses, reverting the whole call. SR.14.
- Destination not an ATA: accepted (the check is owner + mint, not derivation).
- Destination wallet == vault's asset-signer: refused (`signer.key == dest.key`). Another vault's asset-signer as destination: tokens would land there; only the asset owner can trigger this.
- Odd or zero pair count: odd refused (`(accounts.len() - 4) % 2 != 0`); zero pairs → lamports-only sweep. SR.13.

**(c) Destination checks:** The destination wallet is chosen by the transaction builder. Since only the asset owner can trigger the sweep (via Core ExecuteV1), the owner chooses where their own assets go. Correct.

**(d) Lamport sweep:** `signer.lamports()` is read at execution. Nothing in the same transaction can add lamports to the signer after the sweep (the sweep is the last instruction in the helper's execution). BURN's `lamports == 0` check then sees exactly what the sweep left. Correct.

**(e) BURN's emptiness proof:** The sweep closes every account it empties (rent to the destination wallet). A closed account has owner = System and data = empty. BURN's reserve loop: `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }` — a System-owned closed account is skipped. A missing reserve ATA (never created) is also skipped. A stranger can create a non-ATA classic token account for the vault PDA with dust; the sweep moves it (if named) or BURN's stray loop checks it. A Token-2022 ATA for a classic mint: the ATA program refuses to create one (`IncorrectProgramId`, measured in `probe-mainnet-facts.mjs`). Correct.

**(f) Fit:** S8.0 measures 1,061 bytes for the three-asset redemption through the helper with claim, fitting within 1,232 - 52 - 96 = 1,084 for compute-budget + separate payer. S8.1a measures 168,343 CU. Correct.

**(g) Evidence:** SR.0-SR.4a and SR.5-SR.14 in `tests/3prog.test.ts` cover every refusal branch and the successful sweep. The helper's bytes are proven identical in `build-mainnet.sh`. Correct.

---

## R2. THE POOL'S MONEY — "THE POOL ALWAYS HOLDS AT LEAST CEIL(OWED)"

I traced every mutation of `owed_scaled`:

| operation | `owed_scaled` | pool balance |
|---|---|---|
| `credit` (distribution) | += delta * w | unchanged (already in pool) |
| `claim` (payment) | -= settled | -= pay (transfer to vault) |
| `join` | unchanged (debt = w * acc) | unchanged |
| `retire` (redeemed, not forfeit) | -= pending | unchanged (claim already paid) |
| `retire` (redeemed, forfeit / bare burn) | -= pending | unchanged (returned to pool as undistributed) |
| `reweigh` (boost add/expire) | unchanged (owed preserved in carry) | unchanged |

**Invariant:** `credit` adds `delta = floor(avail * ACC_SCALE / w)` to `acc_scaled` and `delta * w` to `owed_scaled`. Since `avail = balance - ceil(owed)`, after crediting: `balance >= ceil(owed_new)` because `delta * w <= avail * ACC_SCALE` and the sub-sat remainder stays in `avail`. `claim` pays `floor(pending / ACC_SCALE)` and subtracts `pending` from `owed_scaled`; the sub-sat remainder is carried. `distribute` refuses `PoolShort` if `balance < ceil(owed)`. Suite P.32 asserts the invariant after every money operation. **The invariant holds.**

**Liveness:** `JoinWaitingFirst` prevents a distribution while eligible vaults wait. `BoostsExpireFirst` prevents one while boosts are due. `monthly_inline` never refuses its host. Correct.

---

## R2b. THE $CBOB BOOST

**Exactly N distributions:** `boost_vault` sets `boost_end_epoch = dist_epoch + epochs`. `advance_epoch` moves the boost to `boosts_due` at `dist_epoch == boost_end_epoch`. `BoostsExpireFirst` blocks the next distribution. Correct.

**Nothing lost on weight change:** `reweigh` moves `owed` into `carry_scaled` and restarts `debt_scaled` at `weight * acc`. The owed amount is preserved. Correct.

**Ring conservation:** The host unit test (`the_boost_schedule_through_the_programs_own_functions_across_four_wraps`) runs 260 epochs across 4 ring wraps with random buys/expiries/retires and asserts `ring_sum + boosts_due == boosts_active` and `owed_scaled == sum(owed_of(r))` at every step. Coverage counters prove the wrapped and due-retired branches were exercised. **Correct.**

**No record expired twice, early, or never:** `expire_boost` checks `boost_weight > 0 && dist_epoch >= boost_end_epoch`. `unschedule_boost` decrements exactly one of `boosts_due` or the ring slot. Correct.

---

## R3. THE LEVEL DRAW

The SlotHashes parse is defensive (count bounded, buffer length checked, all-zero hash refused). The FIFO (`revealed_total`) prevents order selection. The reschedule path (`reschedule_reveal`) writes a fresh future slot and logs `CBOB_REVEAL_RESCHEDULED`. A burned vault at the head still takes its draw (L.11). The attribute re-supply hash is checked against the stored hash (L.4). SPEC 26 correctly states the last-contributor residual. **No new defect.**

---

## R4. GOVERNANCE

The electorate is frozen at creation (`index_snapshot`, `quorum_supply`). `VaultTooNew` refuses vaults minted after the proposal. Key changes need `ceil(50% of snapshot)`. A guardian change and operator arm never share a proposal. Overtaken actions are logged skips. **No minority carries what it should not.** The freeze-forever risk at low turnout (limit 47) is accurately stated.

---

## R5. THE CHARTER CLAIM

The Merkle proof is domain-separated and sorted. The PoB is CPI-burned in the same instruction. The window is clock-only. `pob_extra` accounts pass through never as signers. SPEC 46 is complete (it names both consequences and the alarm blind spots). **No new defect.**

---

## R6. ONE-TIME CONFIGURATION

Every `initialize` value is bounded. The `check-launch-params.mjs` checker refuses wrong values before signing. The 10% royalty is installed with `PluginAuthority::None` (Core refuses updates; R.6/R.6a/R.6c/R33.G3 measure both directions). The redemption cap is a rolling window over 64 timestamps (RL.2/RL.3/RL.4/RL.7). **Correct.**

---

## R7. CROSS-PROGRAM RAW READS

I recomputed every offset:

| read | offset | verified |
|---|---|---|
| BURN → MINT `minted_total` | 141 | ✓ (struct trace) |
| BURN → MINT `bare_burns_retired` | 454 | ✓ |
| GOV → MINT `governance` | 41 | ✓ |
| GOV → MINT `charter_closes_at` | 442 | ✓ |
| GOV → MINT `sales_stopped_at` | 518 | ✓ |
| GOV → MINT `sweep_stopped_at` | 526 | ✓ |
| GOV → MINT `sweep_floor` | 631 | ✓ |
| GOV → MINT `cooldown_ceiling` | 639 | ✓ |
| GOV → MINT `reserve_ceiling` | 647 | ✓ |
| GOV → MINT `max_boost_weight` | 711 | ✓ |
| GOV → MINT `max_boost_epochs` | 712 | ✓ |
| GOV → VaultRecord `mint_index` | 41 | ✓ |
| GOV → BURN `burned_total` | 42 | ✓ |
| Sweep helper: token account mint/owner/amount | 0/32/64 | ✓ |
| BURN: token account delegate/close/state | 72/129*/108 | *wrong (Finding 1) |

All offsets except BURN's close-authority check are correct.

---

## R8. THE SUITE AND BUILD AS EVIDENCE

The 912-assertion suite, 71-assertion simulation, 1004 detector assertions, 39 allocation, 24 poster, 35 mainnet probe, 68 launch, 4 expiry, 6 host unit, 695 web offline, 132 e2e, 16 swap fork — every floor equals its count (checked in `run-tests.sh`). The `because()` reason pins cover every negative. The build proves which key each binary carries. The CPI wrapper is test-only, in its own workspace.

**One observation (not a defect):** The census budget in the suite (21 per level) is tight enough that adding arms can shift what other arms measure. This has been managed correctly (P.2a's precondition check fails loudly if the census is too small).

---

## SUMMARY

| # | Severity | Finding | Class |
|---|---|---|---|
| 1 | LOW | BURN's close-authority check reads `d[129..133]` instead of `d[130..134]` | (a) program — but currently unreachable |
| 2 | LOW | `probe-round5.test.ts` asserts close_authority at the wrong offset | test |
| 3 | LOW (ops) | Rehearsal INIT key seed is public; front-run window exists | operational |

**No CRITICAL. No HIGH. No MEDIUM. No finding in (a)-(d) that moves value, miscredits value, or stops a crack.**

All three findings are outside the launch gate's (a)-(d): Finding 1 is a program defect but does not move or miscredit value and does not stop a crack (it reads the wrong bytes but catches every real close authority today). Finding 2 is a test. Finding 3 is operational.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, WHAT SHOULD THIS PROJECT DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT?

1. **Run the dress rehearsal on mainnet with real money, end to end.** Item 22 is the only gate that exercises the crank's I/O against a live cluster with ~2,100 vaults, the revenue cycle through both real pools, and the hand-recovery runbook. No AI audit can simulate RPC timeouts, rate limits, or a real Pyth feed going stale mid-cycle. The rehearsal driver is built; run it.

2. **Have a human who has never seen the code read HOLDER-GUIDE.md against the deployed programs and say, in plain words, what each sentence means to them.** The guide is the contract with holders. AI can check that a sentence matches the code; it cannot check that a non-technical reader understands "your credited share goes back to the pool if you burn the NFT any other way." A misunderstanding there is a lawsuit, not a bug.

3. **Physically verify the key custody for the swap operator, the $CBOB release wallet, and the deploy authority.** The code says these keys exist at specific paths with mode 600. No audit can verify that the nightly backup actually contains them, that the box is not compromised, or that Gary's Phantom wallet is the one that will sign `initialize`. Walk to the machine and check.

4. **Write a one-page "what to do if the alarm fires at 3am" runbook and have someone follow it against the rehearsal deployment.** The alarm's detectors are proven both ways; the human response is not. The hand-recovery runbook (limit 10) is the most complex procedure in the system. It has been rehearsed by the driver but never by a person under pressure.

5. **Before removing the upgrade authority, have someone independently rebuild the five binaries from the release commit on a different machine and compare sha256.** `build-mainnet.sh` proves which key each binary carries on the build machine. Reproducibility from source is the only bridge between "the source names Gary's key" and "the deployed constant IS Gary's key." Do it on a second box.

6. **Accept that the last honest thing AI cannot do is decide.** Every accepted limit in SPEC is a business judgment: "this grief costs the griefer more than the victim," "the window is short enough," "the holder was told." Those are Gary's calls, and the audit's job is to make sure every one of them is written down with its consequence named. They are. The remaining risk is the one nobody has thought of, and the only defense against that is time, eyes, and the willingness to delay launch. Use it.