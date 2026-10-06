# Independent Security Audit: CBOB Vaults (v6 Off-Chain Pipeline & Core Coupling)

**Audit Target:** The complete v6 off-chain pipeline (`bank/crank.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/layout.mjs`, `bank/accrual.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `bank/redemption-poster.mjs`, `bank/lock.mjs`, `bank/txread.mjs`, `bank/spl.mjs`, `bank/anchor.mjs`, `bank/sigwalk.mjs`), test/rehearsal harnesses, launch parameters, `programs/cbob-vault-sweep`, and MINT program coupling (`programs/cbob-vault-mint/src/lib.rs`).

---

## Executive Summary & Target Assessment

### R0. Round 29's Verdict and Repairs

Round 29 concluded with a **NOT CLEAN** verdict (3 confirmed findings: M1 Medium, L1 Low, D1 Info). All three repairs implemented in commit `88acce2` have been independently audited from first principles against the entire tree:

1. **Repair of M1 (`bank/txread.mjs`, `bank/alarm.mjs`, `bank/revenue.mjs`, `bank/redemption-poster.mjs`):**
   * *Analysis:* Round 29 proved on an Agave 4.2.1 validator that any stranger sending 60 memo instructions referencing MINT or BURN as unreferenced read-only keys could induce the runtime's standalone `Log truncated` marker for a 5,000 lamport fee, halting all scanners due to uncaught throws.
   * *Verification:* `validateParsedTransaction` now accepts `{ truncatedLogs: 'flag' }` while still refusing every structural defect (absent metadata, null logs, malformed CPI arrays, invalid signatures). In `bank/alarm.mjs`, walking scanners opt into flagged transactions, page `log_coverage_gap` at `HIGH`, omit event parsing (preventing corrupted event extraction), execute instruction- and token-level detectors (e.g. tracking unauthorized approvals or non-ATA accounts), and advance the cursor. `bank/revenue.mjs` extracts token outflows via instruction parsing (which remains intact despite log truncation), and `bank/redemption-poster.mjs` safely moves past truncated logs while queuing rejected placeholders only for top-level `burn_vault` calls.
   * *Status:* **Repair Confirmed and Solid.**

2. **Repair of L1 (`scripts/audit-coverage.sh`):**
   * *Analysis:* The coverage gate previously used hardcoded directory globs, missing tracked certifying files in `sim/` and `launch/` (specifically `sim/fixtures.mjs`).
   * *Verification:* `audit-coverage.sh` now dynamically queries `git ls-files` across all system trees (`programs/*`, `bank/*`, `scripts/*`, `sim/*`, `launch/*`, `tests/*`, manifests, and specifications), excludes only generated files/housekeeping, and exits 2 if git fails or enumerates no files.
   * *Status:* **Repair Confirmed.**

3. **Repair of D1 (`bank/selftest.mjs`):**
   * *Analysis:* `srcFiles` omitted `tests/*.mjs`, creating a scope overstatement regarding test suite coverage.
   * *Verification:* `srcFiles` now includes `tests/*.mjs`, bringing `tests/expiry-budget.mjs` under the secret-key constructor and retired-key detection scans.
   * *Status:* **Repair Confirmed.**

---

### R1. The Crank (`bank/crank.mjs`)

* **Execution Ordering:** The sequence (`reschedule` $\to$ `capture` $\to$ `reveal` $\to$ `retire_burned` $\to$ `preJoins` $\to$ `expire(before)` $\to$ `split_revenue` $\to$ `distribute` $\to$ `expire(after)` $\to$ `activate` $\to$ `claims`) enforces all program-side prerequisites. Specifically:
  * `preJoins` runs before `distribute` because MINT enforces `JoinWaitingFirst` (refusing any distribution if eligible waiting vaults have not joined).
  * `expire(before)` runs before `distribute` because MINT enforces `BoostsExpireFirst` (refusing any distribution if an expired boost remains in `boosts_due`).
  * `distribute` runs before `activate` to ensure that newly requested activations land in the *subsequent* distribution epoch (`dist_epoch + 1`), preventing backlog sniping.
* **Dead Vault Isolation:** Dead or bare-burned vaults are identified via Core's 1-byte tombstone (`owner == CORE_ID && data.len == 1 && data[0] == 0`) and queued for `retire_burned`. `planCrank` filters `assets[r.asset] === 'burned'` out of joins and claim payouts, preventing payments into unreachable accounts.
* **Deterministic Revelations:** Revelations are strictly ordered starting from `cfg.revealed_total`. If the head of the FIFO queue lacks entropy, the reveal sequence halts cleanly. Attribute integrity is checked via `judgeRevealAttrs` by re-hashing Borsh-serialized attributes against the on-chain `attrs_hash`.
* **Fee Payer Security:** The crank signs purely as fee payer. `budgetPlan` prevents stalls: if funds are insufficient for reveal account rent, it budgets the low-cost permissionless transactions first (captures, reschedules, retirements) and only drops reveals when funds are inadequate, logging the shortfall. Honeypot balances (>0.25 SOL) raise daily rate-limited warnings without halting execution.

---

### R2. The Alarm Pipeline (`bank/detectors.mjs`, `bank/alarm.mjs`)

* **Drift & Invariant Detection:** Config values fixed at `initialize` (the 85/15 ratio, pool ATA, treasury, supply cap, charter window, Merkle roots, level quotas, tighten bounds) are pinned to `CRITICAL` severity upon any modification.
* **Key Rotations & Stops:** Transition detectors (`detectBrakeTransitions`) catch guardian actions (`brake_pulled` / `brake_released`) with immediate urgent notifications. Pending swap operators and guardian replacements are flagged at `CRITICAL` continuously during their 7-day notice periods (`swap_operator_armed`, `guardian_armed`).
* **Liveness & Health:**
  * Detects insolvency (`pool_insolvent` if pool balance < `ceil(owed_scaled / 1e12)`).
  * Detects account freezes (`pool_frozen`, `vault_account_frozen`, `revenue_account_frozen`).
  * Detects overdue distributions (`distribution_overdue`), stalled join queues (`joins_stalled`), stalled boost expiries (`boosts_stalled`), and uncranked reveal queues (`reveal_queue_stalled`).
  * Monitors the crank's heartbeat (`crank_silent` if > 3 hours old) and tracks repeated crank failures (`crank_failing`) or persistent planner blockers (`crank_problem`).
* **Third-Party Surveillance:** Upgrade authorities and code hashes for Metaplex Core and all swap-related programs (Orca Whirlpool, Meteora DLMM, Pyth Receiver, Pyth Push Oracle) are tracked continuously.

---

### R3. Account Layouts (`bank/layout.mjs`)

* **Declarative Consistency:** All Anchor accounts (`SealConfig`, `MintConfig`, `VaultRecord`, `BurnConfig`, `GovConfig`) have explicit byte layouts asserted against Rust sources in `bank/selftest.mjs`.
* **Cross-Program Offsets:** Offsets relied upon across CPI boundaries (such as GOV reading `MINT_MINTED_TOTAL` at offset 141 or BURN reading `BARE_RETIRED` at 454) are evaluated dynamically against `layout.mjs` computed offsets.
* **PDA Seed Alignment:** Seed constants in `L.SEEDS` are validated directly against Rust `*_SEED` definitions across all four Anchor crates.

---

### R4. Money Arithmetic (`bank/accrual.mjs`)

* **Mathematical Equivalence:** The off-chain arithmetic mirrors on-chain logic:
  $$\Delta \text{acc} = \left\lfloor \frac{\text{avail} \times 10^{12}}{W} \right\rfloor$$
  $$\text{owed} = (\text{weight} + \text{boost}) \times \text{acc} + \text{carry} - \text{debt}$$
* **Dust & Sub-sat Conservation:** Sub-satoshi remainders stay unassigned in the pool and roll over to subsequent distribution cycles without leakage.
* **Boost Weight & Carry Dynamics:** `reweigh` moves accumulated entitlements into `carry_scaled` and resets `debt_scaled = (new\_weight) \times \text{acc}$, ensuring debt never exceeds entitlement and historical earnings remain preserved across boost activations and expiries.

---

### R5. The Royalty Swap & Revenue Cycle (`bank/swap.mjs`, `bank/revenue.mjs`)

* **(a) Oracle Math:** `oracleFloor` correctly handles the exponent differential $e = e_{\text{sol}} - e_{\text{btc}}$, scaling numerators and denominators safely with BigInt. The resulting output floor enforces `SWAP_TOLERANCE_BPS` (150 bps below expected oracle output).
* **(b) Pyth Verification:** `readPyth` enforces that the account is derived from Pyth Push Oracle (shard 0), owned by Pyth Receiver, has `VerificationLevel::Full` (`d[40] === 1`), matches the pinned feed ID, has age $\le 180$ seconds, future timestamp $\le 30$ seconds, and confidence interval $\le 30$ bps of price. The age is evaluated strictly against the on-chain Clock sysvar (`SYSVAR_CLOCK_PUBKEY`), eliminating local server clock skew.
* **(c) Deviation Filter:** Spot prices from Orca Whirlpool (derived from $Q64.64$ square root prices) and Meteora DLMM (derived from inverse bin step powers) are normalized to raw sats/lamport. Pools deviating $> 100$ bps from the oracle are skipped.
* **(d) Minimum Output Enforcement:** Both pool builders hardcode the Pyth-derived minimum output into on-chain parameters (`other_amount_threshold` on Orca, `min_amount_out` on Meteora).
* **(e) Pre-Signing Judge:** `judgeSwapInstructions` verifies the exact 7-instruction bundle. It confirms:
  1. No priority fees (`ComputeBudgetInstruction::SetComputeUnitPrice` is rejected).
  2. The input and output token accounts match the operator's derived ATAs.
  3. The venue instruction targets the pinned pool with exact input amounts and minimum output floors.
  4. Only `SyncNative` and `CloseAccount` token instructions are permitted.
* **(f) Account Derivation:** Orca tick arrays and Meteora bin arrays are derived from current tick/bin indices. Meteora optional accounts (`bitmap`, `host_fee_in`) conform to Anchor's `None` convention (passing program ID).
* **(g) wSOL Lifecycle:** Wraps exact lamports, syncs native, swaps, and closes the wSOL account back to the operator in instruction 6, returning rent and unconsumed lamports.
* **(h) Failure & Recovery:** Orca is attempted first; Meteora is tried only if Orca explicitly refuses at preflight, fails on-chain, or expires unlanded. Uncertain sends never fall through to secondary swaps, preventing double execution. Unfinished cycles prevent subsequent automated sweeps and require manual resolution.
* **(i) Economic Boundaries:** Maximum extraction per cycle is strictly bounded by the 150 bps on-chain floor. At the 10 SOL cap, slippage/sandwich leakage is capped at 0.15 SOL per cycle.

---

### R6. Verification Gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

* **Assertion Floors:** `scripts/run-tests.sh` enforces exact equality against all floors (855 on-chain, 891 detector, 39 allocation, 22 poster, 14 PoB, 47 launch, 6 host, 33 live-mainnet, 4 expiry, 16 swap-fork).
* **Counterfactual Integrity:** Mutation testing in `selftest.mjs` confirms that all critical assertions fail when their underlying conditions are inverted.
* **Mainnet Build & Rehearsal:** `scripts/build-mainnet.sh` verifies program binaries against test-key acceptance/rejection controls. `scripts/rehearsal-tree.sh` confirms clean bidirectional string substitutions for throwaway ID testing.

---

## Audit Findings

### Medium, High, and Critical Deficiencies

* **None.** No surviving vulnerabilities that permit fund theft, unsealed redemptions, unauthorized token minting, distribution denial-of-service, or governance subversion were found.

---

### Low-Severity Findings

#### [LOW-01] Redemption Poster Omits Lamport Balance Movements in Social Copy
* **File & Function:** `bank/redemption-poster.mjs`, `releasedFromTx()`
* **Mechanism:** `releasedFromTx()` computes released balances by matching transaction instruction transfers against `owned`, a mapping populated exclusively from token balance arrays (`preTokenBalances` / `postTokenBalances`):
  ```javascript
  for (const b of [...(tx?.meta?.preTokenBalances || []), ...(tx?.meta?.postTokenBalances || [])])
    if (b.owner === vaultPda) owned.set(keys[b.accountIndex], b.mint)
  ```
  When a vault contains native SOL (which the sweep helper moves via `system_instruction::transfer` to the redeemer), the transfer occurs via System Program, not the SPL Token Program. Consequently, native SOL is omitted from the parsed `released` summary and the generated draft copy:
  ```javascript
  const x = `Vault No. ${no} (Level ${LEVEL_NAMES[level - 1]}) has been redeemed. ${list} The vault no longer exists.`
  ```
  If a vault held only cbBTC and native SOL, the text announces the released cbBTC but omits the released SOL.
* **Impact:** Public notification inaccuracy. No fund loss or on-chain risk occurs, but `HOLDER-GUIDE.md` promises: *"Everything in it (cbBTC, $GARY, $GIRAFFISH and SOL) comes out and the vault is destroyed in the same moment."* The draft post fails to announce released SOL.
* **Evidence:** An execution of `releasedFromTx()` on a transaction containing a System Program transfer from `vaultPda` yields no entry for SOL.
* **Remediation:** Update `releasedFromTx()` to parse `SystemProgram.transfer` instructions where `source == vaultPda`, adding an entry for native SOL (9 decimals, named `"SOL"`).

---

### Informational Observations

#### [INFO-01] Redundant Duplicate Check in Alarm Initialization Check
* **File & Function:**