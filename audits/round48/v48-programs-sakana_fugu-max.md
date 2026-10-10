# INDEPENDENT SECURITY AUDIT REPORT (v6 Confirmation Round 48)

**Target Scope:**
- Programs: `cbob-vaults` (SEAL), `cbob-vault-mint` (MINT), `cbob-vault-burn` (BURN), `cbob-vault-gov` (GOV), and `cbob-vault-sweep` (SWEEP).
- Off-chain pipelines & tooling: `bank/`, `sim/`, `scripts/`, `launch/`, `tests/`, `web/`.
- Documentation & Specifications: `SPEC.md`, `DESIGN-v6.md`, `HOLDER-GUIDE.md`, `README.md`.

---

## EXECUTIVE SUMMARY & GATE VERDICT

Under the rules governing the launch gate (SPEC Ship Gate 3, RULING Gary 2026-10-08):
- **Criterion (a) [Programs]:** No vulnerabilities, memory safety flaws, or logic errors found in the five programs. All on-chain program source remains identical to `RELEASE_COMMIT` `d2ae5fc` (source commit `0b3ddb3`).
- **Criterion (b) [Value Flow]:** No path was found that diverts, leaks, locks, or miscredits value from a vault, the community pool, or the revenue PDA.
- **Criterion (c) [Redemption / Crack]:** No path was found that allows an opened vault to survive unburned, allows an unauthorized party to sweep value, or blocks an honest owner from redeeming (outside acknowledged live freeze constraints on cbBTC).
- **Criterion (d) [Severity]:** 0 CRITICAL, 0 HIGH, 0 MEDIUM.

**VERDICT: LAUNCH-CLEAN.**

However, under Gary's 2026-10-09 operational mandate ("a clean round where we make NO changes"), this round is **NOT a zero-change round**. Two low-severity defects in peripheral tooling/client scripts have been identified and require fixes:
1. `scripts/validator-lock.sh`: Failure to ensure `.cache` directory existence breaks cold-start runs of `sim/run-sim.sh`, `scripts/build-mainnet.sh`, and `web/test/e2e-localnet.sh` on fresh clones (**LOW**).
2. `web/src/lib/plan-get.mjs`: Unsafe property access on a null plugin body in `planClaim` can crash the client UI with a `TypeError` if malformed plugin data exists (**INFO / LOW**).

---

## TARGET AUDIT ASSESSMENTS (R0 – R8)

### R0. Round 47's Verdict and Repair Verification

Every confirmed finding from Round 47 was independently traced and verified:

1. **V47-1 & V47o-4 (`scripts/readme-facts.mjs`):** Tracked directory enumeration via `git ls-files` replaced raw filesystem directory scanning. Untracked working directories no longer cause false assertion halts in `run-tests.sh`. Verified.
2. **V47-2 & V47o-5 (`scripts/readme-facts.mjs`):** Negative lookahead `(?!NONE\b)` was added to the `REQUIRES CHANGES:` regex. A verdict reading `REQUIRES CHANGES: NONE` no longer renders as "yes, repairs not yet validated". Verified.
3. **V47-3 (`tests/3prog.test.ts`):** R.4 now reads the raw Metaplex Core plugin registry via `deserializePluginRegistryV1`. Control arm R.4b verifies that an extraneous plugin adapter (such as `AppData`) causes the check to fail. Verified on-chain (913 assertions floor).
4. **V47-4 (`web/src/pages/ceremony.mjs`):** `signExact` now receives `minUnits: sim.unitsConsumed || null` from the dry run. The wallet-edit judge no longer permits arbitrary CU limit under-allocations on the launch ceremony page. Verified.
5. **V47-5 (`web/src/lib/tx.mjs`):** `judgeWalletEdits` now inspects role sets bi-directionally. A wallet attempting to downgrade an account from writable to read-only or strip a signer is rejected. Verified.
6. **V47-6 (`README.md` & `scripts/readme-facts.mjs`):** Descriptions of SEAL and BURN were corrected. SEAL is properly described as enforcing the freeze lock; SWEEP (via Core `ExecuteV1`) is credited with moving reserves. Verified.
7. **V47-7, V47-8 & V47o-3 (`SPEC.md` & `README.md`):** Road row 8 and Item 22/53 text were reconciled with `RECORD.md`. Gary's 2026-10-10 ruling accepting 22.2's Core hash drift detection as a true positive is documented. Verified.
8. **V47-9 (`web/deploy/rpc-proxy.mjs`):** Header documentation corrected to reflect the five permitted GPA shapes. Verified.
9. **V47o-1, V47o-2, V47o-6, V47o-7, V47o-8, V47o-9:**
   - Core watch diagnostic JSON serialization and alert routing verified.
   - `scripts/validator-lock.sh` introduces kernel-level `flock(2)` on FD 9.
   - Cron installer properly configures Core watch and its deadman monitor.
   - Offline mock RPC handles `getTokenAccountsByOwner`.
   - `dist/` dependency check cleanly halts and instructs on fresh clones.

---

### R1. Custody & Redemption Mechanics

**The Gate Pairing:**
- `cbob-vaults::open_for_redemption` parses the instructions sysvar for `cbob_vault_burn::burn_vault`. It validates the discriminator (`IX_BURN_VAULT_DISC`), requires `BURN_IX_ASSET_IDX` to match the asset, and `BURN_IX_OWNER_IDX` to match the owner.
- `cbob-vault-burn::burn_vault` inspects earlier instructions in the sysvar for `cbob_vaults::open_for_redemption`, enforcing the same discriminator, asset, and owner constraints.
- **CPI Isolation:** Both programs use `load_instruction_at_checked` which operates strictly on transaction-level (top-level) instructions. A wrapper program invoking either instruction via CPI returns the index/program ID of the outer instruction, causing immediate rejection (`NoTerminalBurn` / `NoPrecedingOpen`).
- **Atomicity:** Because Solana transactions are atomic, thawing cannot persist if burning fails, nor can an asset burn without a preceding thaw.

**The Emptiness Proof:**
- Prior to burning, `burn_vault` verifies:
  1. `asset_signer.lamports() == 0`: Prevents destruction of customer SOL.
  2. Reserve mint ATAs (both SPL Token and Token-2022) must be declared in `remaining_accounts`. Undeclared reserve ATAs trigger `ReserveNotDeclared`.
  3. Every declared account with data is checked: `amount == 0`, no delegate (`[0; 4]` at offsets 72..76 and 129..133; `[0; 8]` at 121..129), and length strictly equal to 165 (`ReserveHasExtensions` triggered on extensions).
  4. Core assets inside `remaining_accounts` cannot be active (`Key::AssetV1` triggers `VaultStillHoldsAVault`).
- **Tombstone Proof:** `burn_vault` CPIs `retire_redeemed` into MINT. MINT verifies that Core marked the asset as `Key::Uninitialized` with length 1. No vault can retire as redeemed without confirmation that Core executed the burn.

---

### R1s. The Sweep Helper (`programs/cbob-vault-sweep/src/lib.rs`)

1. **Access Control:**
   - When invoked directly, the helper checks `signer.is_signer`. The vault's asset-signer PDA (`["mpl-core-execute", asset]`) cannot sign directly outside of Metaplex Core.
   - Inside Core `ExecuteV1`, Core enforces that only the genuine asset owner can authorize an execution. If the asset has an active `PermanentFreezeExecute` plugin, Core checks whether the plugin is frozen. When frozen, Core rejects the instruction with error `0x9` (InvalidAuthority). Execution can only proceed while thawed inside the atomic redemption window.
2. **Pair Validation:**
   - Every token pair `(src, to)` must satisfy:
     - `src.owner == SPL_TOKEN_ID` and `to.owner == SPL_TOKEN_ID`.
     - `src_owner == signer.key` (source must belong to the vault PDA).
     - `to_owner == dest.key` (destination must belong to the specified destination wallet).
     - `src_mint == to_mint`.
   - `signer.key == dest.key` is rejected (`InvalidArgument`).
   - Duplicate sources: If the same source is passed twice, the first iteration closes the account, zeroing its lamports and reassigning its owner to the System Program. The second iteration fails in `read_token` with `IllegalOwner`.
3. **Lamport Sweep:**
   - Draining `signer.lamports()` moves all remaining lamports to `dest` via `system_instruction::transfer`. Because `signer` is a data-less System account, the runtime allows it to be drained to 0. `burn_vault` then verifies `asset_signer.lamports() == 0`.

---

### R2. The Community Pool (`programs/cbob-vault-mint/src/lib.rs`)

**The Pool Invariant (`balance >= ceil(owed_scaled / ACC_SCALE)`):**
- In `credit()`, delta is calculated as:
  $$\Delta = \frac{\text{avail} \times \text{ACC\_SCALE}}{W}$$
  Because integer division truncates:
  $$\Delta \times W \le \text{avail} \times \text{ACC\_SCALE}$$
  The added scaled owed satisfies:
  $$\Delta \times W \le \text{avail} \times \text{ACC\_SCALE}$$
  Thus:
  $$\left\lceil \frac{\text{owed\_scaled}_{\text{new}}}{\text{ACC\_SCALE}} \right\rceil \le \text{balance}$$
  Unassigned dust remains in the pool and accumulates into future distributions.
- **Two-Step Activation & Join Gate:**
  - `activate` records `request_epoch = dist_epoch` and sets `pending = true`. The vault receives no weight and zero debt in the current epoch.
  - A vault joins only when `dist_epoch > request_epoch`.
  - `distribute()` explicitly requires `waiting_to_join() == 0` (`JoinWaitingFirst`), preventing any distribution from diluting or bypassing unjoined eligible vaults.
- **Liveness & Griefing:**
  - If a vault's ATA is frozen, `claim()` skips it, emits `CBOB_CLAIM_DEFERRED_FROZEN`, and keeps its owed balance intact. It does not revert the entire batch.
  - If the pool itself is frozen by Coinbase, `claim()` will revert, but `retire_redeemed()` catches this via `pool_is_frozen()` and permits redemption by forfeiting owed shares back to the pool (`CBOB_REDEEMED_POOL_FROZEN`), guaranteeing redemption liveness.

---

### R2b. The $CBOB Boost

- **Weight Accounting & Expiry:**
  - A boost burns `boost_price` of the pinned `$CBOB` mint and increments `total_active_weight` by `boost_weight`.
  - To preserve accrued earnings upon reweighing, `reweigh()` shifts accrued uncollected sats into `r.carry_scaled` and resets `r.debt_scaled = weight_new * acc`.
  - The boost schedule is maintained in a 64-slot ring buffer (`boost_expiring[end_epoch % 64]`). Because `boost_epochs <= 63`, collisions between the current epoch and future expirations are mathematically impossible.
  - `distribute()` mandates `boosts_due == 0` (`BoostsExpireFirst`). If a boost expires at epoch $E$, distributions at $E$ are blocked until `expire_boosts` (or `claim`) executes `reweigh(..., 0)`.
  - If a boosted vault's token account is closed or frozen, `expire_boosts` can still be invoked permissionlessly because it operates solely on `VaultRecord` and requires no token accounts.

---

### R3. The Level Draw

- **Entropy & Leader Grinding:**
  - Entropy captures hashes from three distinct leader rotations ($A$, $B$, $C$).
  - Slots $B$ and $C$ are separated by at least `ENTROPY_GROUP_STRIDE` (2 groups = 8 slots), guaranteeing they fall across separate leader groups.
  - As acknowledged in SPEC Accepted Limit 26, the leader of slot $C$ knows $hA$ and $hB$ and can grind within its 4-slot rotation or vary block contents.
- **Queue Determinism & Rescheduling:**
  - Reveals must execute strictly in mint order via `revealed_total` (`RevealOutOfOrder`).
  - If entropy is not captured within `REVEAL_WINDOW_SLOTS` (300 slots), anyone may call `reschedule_reveal`, resetting `reveal_slot = now + 16` (`REVEAL_LEAD_SLOTS`).
  - Burned vaults at the queue head are marked `burned` during `reveal_level`, incrementing `revealed_total` and updating the census without invoking Core CPI.

---

### R4. Governance (`programs/cbob-vault-gov/src/lib.rs`)

- **Electorate Binding:**
  - Proposals snapshot `index_snapshot = minted_total` and `quorum_supply = live_supply`. Vaults minted after creation cannot vote (`VaultTooNew`).
  - Votes are bound to the asset PDA `["vote", proposal, asset]`. Selling or transferring an NFT does not reset its vote.
- **Supermajorities & Safety Controls:**
  - Key changes (`arm_guardian`, `arm_swap_operator`) require $\lceil 50\% \text{ of all live vaults at proposal creation} \rceil$ voting YES (`KeyChangeNeedsHalf`).
  - Bundling a guardian change with a swap operator change is rejected at creation (`KeyChangesBundled`).
  - Monotonic tightening (`TightenSweep`) enforces that proposals can only increase cooldown/reserve and decrease sweep cap within immutable bounds fixed at `initialize`.

---

### R5. The Charter Claim

- **Address-Pinned Merkle Proof:**
  - The Proof of Burn set consists of 240 assets inside Giraffish Moments. Identity is proved against `pob_root` via SHA-256 with domain-separated leaves (`0x00`) and sorted internal nodes (`0x01`).
  - The claim burns the PoB asset via Core CPI. Because Core leaves a tombstone at `Key::Uninitialized`, an asset cannot be re-burned or re-claimed.
- **External Plugin Pass-Through:**
  - Up to 8 external plugin accounts (`pob_extra`) are passed through to Core's burn instruction without signer privileges. A collection hook cannot brick claims by demanding unrecognized signer rights.

---

### R6. One-Time Configuration & The Trusted Hop

- **Initialization Constraints:**
  - All four programs enforce strict validation in `initialize` gated on compile-time `INIT_AUTHORITY` (Gary's wallet).
  - Cross-checks prevent deployment mismatch: MINT and BURN require SEAL config to be present and match their collection; MINT verifies `payment_mint` is an authorized reserve in SEAL; GOV verifies MINT collection.
- **Swap Operator Security:**
  - `sweep_sol_for_swap` enforces `amount <= max_sweep_lamports`, `cooldown`, and preserves `sol_reserve_lamports`.
  - The guardian can immediately stop sweeps via `emergency_stop_sweep`.
  - Replacing the operator requires governance approval, half of all live vaults voting YES, and a 7-day timelock.

---

### R7. Cross-Program Raw Reads

The struct offsets across program boundaries were independently recomputed:

| Target Struct | Offset (Bytes) | Field Name | Validation |
|---|---|---|---|
| **`SealConfig`** | 8 | `version` | Matches `SEAL_CONFIG_VERSION` (2) |
| | 9 | `collection` | Matches 32-byte Pubkey |
| | 41 | `reserve_mints` | Matches `Vec<Pubkey>` (4-byte length prefix) |
| **`MintConfig`** | 8 | `version` | Matches `MINT_CONFIG_VERSION` (6) |
| | 9 | `collection` | Matches 32-byte Pubkey |
| | 41 | `governance` | Matches 32-byte Pubkey |
| | 141 | `minted_total` | Matches `u64` |
| | 191 | `sales_stopped` | Matches `bool` |
| | 192 | `sweep_stopped` | Matches `bool` |
| | 257 | `sol_reserve_lamports` | Matches `u64` |
| | 266 | `max_sweep_lamports` | Matches `u64` |
| | 274 | `sweep_cooldown_secs` | Matches `i64` |
| | 442 | `charter_closes_at` | Matches `i64` |
| | 454 | `bare_burns_retired` | Matches `u64` |
| | 518 | `sales_stopped_at` | Matches `i64` |
| | 526 | `sweep_stopped_at` | Matches `i64` |
| | 631 | `sweep_floor_lamports` | Matches `u64` |
| | 639 | `cooldown_ceiling_secs` | Matches `i64` |
| | 647 | `reserve_ceiling_lamports` | Matches `u64` |
| | 711 | `max_boost_weight` | Matches `u8` |
| | 712 | `max_boost_epochs` | Matches `u16` |
| **`BurnConfig`** | 8 | `version` | Matches `BURN_CONFIG_VERSION` (4) |
| | 42 | `burned_total` | Matches `u64` |
| **`VaultRecord`** | 8 | `version` | Matches `VAULT_RECORD_VERSION` (4) |
| | 9 | `asset` | Matches 32-byte Pubkey |
| | 41 | `mint_index` | Matches `u64` |

All raw offsets match across `programs/cbob-vault-gov`, `programs/cbob-vault-burn`, and `programs/cbob-vault-mint`.

---

### R8. Suite, Simulation, & Build Certification

- All tests deploy the **stripped SBPFv3 binaries**, mirroring the exact output generated by `solana-verify` and verified in GitHub Actions workflow `.github/workflows/verifiable-build.yml` (commit `d2ae5fc`).
- `sim/test-vault.ts` confirms the full lifecycle across 71 assertions using cloned mainnet accounts and real mints.
- `sim/swap-fork.sh` confirms swap execution across 16 assertions against cloned Orca and Meteora liquidity pools.

---

## DETAILED FINDINGS

### Finding V48-1 (LOW) — Missing Directory Creation in `scripts/validator-lock.sh` Blocks Cold Test Runs

- **Construct:** `scripts/validator-lock.sh`, line 21:
  ```bash
  VALIDATOR_FLOCK=/opt/cbob-vaults/.cache/VALIDATOR.flock
  validator_lock() { # <label>
    [ "$(readlink -f /proc/self/fd/9 2>/dev/null)" = "$(readlink -f "$VALIDATOR_FLOCK")" ] || exec 9>>"$VALIDATOR_FLOCK" || return 1
  ```
- **Vulnerability / Fault:**
  The `VALIDATOR_FLOCK` lockfile path is located inside `/opt/cbob-vaults/.cache`. When the repository is cloned cleanly on a new machine or when `.cache` has been cleared, the `.cache` directory does not exist. `exec 9>>"$VALIDATOR_FLOCK"` fails immediately with `No such file or directory`.
  While `scripts/run-tests.sh` explicitly calls `mkdir -p "$CACHE"` before sourcing the lock script, `sim/run-sim.sh`, `scripts/build-mainnet.sh`, and `web/test/e2e-localnet.sh` invoke `validator_lock` before preparing `.cache`.
- **Impact:**
  Running `./sim/run-sim.sh`, `./scripts/build-mainnet.sh`, or `./web/test/e2e-localnet.sh` on a clean checkout fails immediately at line 1 of the lock acquisition.
- **Evidence:**
  In a clean clone or after executing `rm -rf .cache`:
  ```bash
  ./sim/run-sim.sh
  ```
  Fails with:
  ```
  scripts/validator-lock.sh: line 23: /opt/cbob-vaults/.cache/VALIDATOR.flock: No such file or directory
  ```
- **Remediation:**
  Ensure the parent directory exists inside `validator_lock()` prior to redirecting FD 9:
  ```bash
  validator_lock() {
    mkdir -p "$(dirname "$VALIDATOR_FLOCK")" || return 1
    [ "$(readlink -f /proc/self/fd/9 2>/dev/null)" = "$(readlink -f "$VALIDATOR_FLOCK")" ] || exec 9>>"$VALIDATOR_FLOCK" || return 1
  ```

---

### Finding V48-2 (INFO / LOW) — Missing Optional Chaining on Plugin Body in `planClaim`

- **Construct:** `web/src/lib/plan-get.mjs`, line 66:
  ```javascript
  const frozen = ['FreezeDelegate', 'PermanentFreezeDelegate'].some(t => pick.info.plugin(t)?.body.frozen)
  ```
- **Vulnerability / Fault:**
  `pick.info.plugin(t)` retrieves the plugin from the parsed Core asset. If a plugin of type `FreezeDelegate` or `PermanentFreezeDelegate` is present but has a null `body` (which occurs in `web/src/lib/decode.mjs` line 59 if `pluginBody()` parsing catches an error on malformed or unexpected data), `pick.info.plugin(t)?.body` evaluates to `null`. Attempting to read `.frozen` on `null` triggers an unhandled `TypeError: Cannot read properties of null (reading 'frozen')`.
  This mirrors the exact defect identified and patched for `planDraw` in Round 42 (C7).
- **Impact:**
  If an asset in the Proof of Burn collection has malformed delegate data, the claim UI crashes with an unhandled exception rather than producing a clean user-facing rejection message.
- **Evidence:**
  Evaluating `planClaim` with `pick.info.plugin('FreezeDelegate')` returning `{ type: 'FreezeDelegate', body: null }` throws `TypeError`.
- **Remediation:**
  Add optional chaining:
  ```javascript
  const frozen = ['FreezeDelegate', 'PermanentFreezeDelegate'].some(t => pick.info.plugin(t)?.body?.frozen)
  ```

---

## THE FOUR QUESTIONS ON ACCEPTED LIMITS

### 1. Is any limit WORSE than stated?
**No.** Every accepted limit matches its on-chain and off-chain reality:
- **Limit 26 (Leader Grinding):** Verified that slot $C$ grinding is bounded to best-of-4 skips within a leader rotation plus block-packing variations.
- **Limit 28 (cbBTC Freeze Authority):** Verified that a frozen vault cbBTC account blocks full redemption, and a frozen pool triggers forfeiture of undelivered sats while allowing the underlying vault contents to be redeemed cleanly.
- **Limit 41 (Redemption Rate Limit):** The rate limit ring buffer bounds redemptions to 2.1%/hour without restricting raw token or asset transfers.

### 2. Is anything listed as a limit not actually a limit?
**No.** All items listed under ACCEPTED represent genuine technical boundaries:
- Limit 43 (off-curve owners cannot redeem) remains an absolute limitation of the two-step top-level signature requirement on `open_for_redemption` and `burn_vault`.
- Limit 44 (destruction of undeclared stray tokens) is an unavoidable consequence of Solana's inability to enumerate PDA-owned accounts on-chain.

### 3. Is any DISCHARGED item not actually discharged?
**No.** All discharged items remain thoroughly discharged:
- Item 14 (duplicate attributes at mint) remains strictly enforced via `check_attributes` and error `DuplicateAttribute`.
- Item 19 (unlevelled-vault payout halt) remains structurally impossible because `activate` refuses unrevealed vaults (`NotRevealed`).
- Item 51 ($CBOB boost) remains bounded by `max_boost_weight` (12) and `max_boost_epochs` (24) fixed at initialization.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?
**No.** The remaining OPEN AND BLOCKING items are tracked and enforced:
- **Item 22:** Documented as open specifically for scale (~2,100 vaults). Rehearsal result 22.2 was properly addressed via Gary's formal ruling on 2026-10-10.
- **Item 38:** Launch values remain checked by `scripts/check-launch-params.mjs`.
- **Item 50:** Staged in `web/` and awaiting publication.
- **Item 53:** Remains open pending the in-tree rehearsal execution on the final commit.

---

## STRUCTURAL LIMITS OF AI AUDITING & PRE-LAUNCH MANDATES

Because no human security firm will review these immutable programs prior to deployment, the system must address the fundamental structural blind spots of AI audit models:

1. **Simulated State vs. Production RPC Asynchrony:**
   - *Limitation:* AI audits analyze static code paths or sequential local test runs. They cannot observe high-concurrency RPC socket stalls, node load-balancing lag, or transaction propagation dropped across geographically distributed validators.
   - *Mandate:* Conduct multiple consecutive live transactions against production Solana RPC nodes under load, verifying that `prepareOpening` in `web/src/lib/plan-redeem.mjs` cleanly handles late arrivals, dropped blockhashes, and re-read retries without throwing uncaught exceptions.
2. **True Hardware Wallet Integration (Ledger / Mobile Phantom):**
   - *Limitation:* Models inspect deserialized transaction structures and mock signers. They cannot physically verify that versioned transactions, complex Core `ExecuteV1` wrappers, and multi-instruction packets display human-readable details on hardware device screens (e.g. Ledger Nano S/X) without encountering "blind signing" rejections or packet parsing timeouts.
   - *Mandate:* Execute real testnet/mainnet signings using physical Ledger hardware connected via Phantom to ensure that the 1,232-byte legacy packets and v0 message layouts do not trigger memory exhaustion or decoding failures on hardware display firmware.
3. **Third-Party Upgrades (Metaplex Core & Pyth Oracles):**
   - *Limitation:* An AI auditor can verify the correctness of CPI calls against current interfaces, but cannot foresee breaking ABI changes in upgradeable dependencies.
   - *Mandate:* Maintain continuous monitoring via `scripts/core-watch.mjs`. Because Metaplex Core upgraded three times in the five weeks prior to launch, establish strict automated alerting on `prog.core.hash` and do not deploy until Core has maintained hash stability across a multi-week observation window.