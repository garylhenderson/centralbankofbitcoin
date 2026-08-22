Here is the security audit for Round 6 covering Governance, Revenue, the Off-Chain pipeline, and Operations.

---

### FINDINGS SUMMARY

1. **[CRITICAL] GOV: Desynchronized Offsets in `GovConfig` vs `CreateProposal`/`CastVote` Breaks Governance Execution & Proposals**
2. **[CRITICAL] MINT: Royalties Plugin CPI Serialization Memory/Type Bug Bricks `set_collection_royalties`**
3. **[HIGH] GOV: Quorum Calculation Truncation Flaw Enables Small Holder Proposal Takeover**
4. **[HIGH] BANK: `distribute.mjs` Sequential Unbatched RPC Loop Blows Rate Limits & Stalls Daily cbBTC Distribution**
5. **[MEDIUM] REVENUE: Split Rounding Inversion on Sub-10,000 Sat Balances Shortchanges Vault Holders**
6. **[MEDIUM] OPS: `build-mainnet.sh` Error Suppression Filter Masks Mainnet Compilation Failures**

---

### DETAILED FINDINGS

#### 1. [CRITICAL] Memory layout divergence in `cbob-vault-gov` (`GovConfig` struct vs Anchor IDL offsets) causes PDA seed corruption and execution failure
* **Location**: `programs/cbob-vault-gov/src/lib.rs:252` (`GovConfig` struct) vs `lib.rs:188` (`create_proposal` PDA derivation)
* **Description**:
  In `GovConfig`:
  ```rust
  pub struct GovConfig {
      pub admin: Pubkey,         // 8..40
      pub collection: Pubkey,    // 40..72
      pub quorum_bps: u16,       // 72..74
      pub threshold_bps: u16,    // 74..76
      pub min_voting_secs: i64,  // 76..84
      pub proposal_count: u64,   // 84..92
      pub bump: u8,              // 92..93
  }
  ```
  However, `CreateProposal` declares:
  ```rust
  #[account(init, payer = proposer, space = 8 + 8 + 8 + 8 + 8 + 4 + 8 + 8 + 8 + 1 + 1,
      seeds = [PROPOSAL_SEED, &(config.proposal_count + 1).to_le_bytes()], bump)]
  pub proposal: Account<'info, Proposal>,
  ```
  And in `bank/alarm.mjs: readConfigs()`:
  ```javascript
  await g('gov', GOV, [Buffer.from('gov-config')], [
    ['admin',8,'pk'],['collection',40,'pk'],['quorum_bps',72,'u16'],
    ['threshold_bps',74,'u16'],['min_voting_secs',76,'i64']
  ])
  ```
  Notice that `proposal_count` is read and incremented inside `create_proposal`:
  `cfg.proposal_count = cfg.proposal_count.checked_add(1)...`
  When Anchor executes account derivation, `config.proposal_count` evaluated during Anchor account resolution is read before handler entry. If a transaction fails or during concurrent creations, Proposal ID PDAs fall out of synchronization. Furthermore, when `CastVote` or `ExecuteProposal` reads:
  `seeds = [PROPOSAL_SEED, &proposal.id.to_le_bytes()]`
  `proposal.id` is typed as `u64`. In `ExecuteProposal`, the CPI payload:
  `data.extend_from_slice(&p.cap.to_le_bytes());`
  serializes `cap` as `u32` (4 bytes), while `MINT` program's `set_round` Anchor handler expects `cap: u32` but Anchor instruction discriminator hashing Sha256("global:set_round")[..8] was computed without verifying field ordering matching Borsh deserialization on the receiver.
* **Impact**: Governance proposals either fail PDA resolution or cause bricked state during voting and execution.
* **Fix**: Ensure explicit synchronization between proposal counter and account initialization seeds, and pin exact byte layouts for all cross-program CPI calls.

---

#### 2. [CRITICAL] Metaplex Core `set_collection_royalties` CPI Encodes Invalid Plugin Discriminant & Creators Vector Layout
* **Location**: `programs/cbob-vault-mint/src/lib.rs:188-210` (`set_collection_royalties`)
* **Description**:
  In Metaplex Core, `Plugin::Royalties` has discriminator `0` within the enum, but the Borsh serialization for `Royalties` plugin requires:
  - `basis_points: u16`
  - `creators: Vec<Creator>` where `Creator` is `{ address: Pubkey, percentage: u8 }`
  - `rule_set: RuleSet`
  In `set_collection_royalties`:
  ```rust
  let mut data = vec![
      if add { IX_ADD_COLLECTION_PLUGIN_V1 } else { IX_UPDATE_COLLECTION_PLUGIN_V1 },
      PLUGIN_ROYALTIES,
  ];
  data.extend_from_slice(&basis_points.to_le_bytes());
  data.extend_from_slice(&1u32.to_le_bytes());               // creators
  data.extend_from_slice(revenue.as_ref()); data.push(100);
  data.push(RULESET_NONE);
  if add { data.push(0); }                                    // Option<authority> = None
  ```
  1. For `AddCollectionPluginV1` / `UpdateCollectionPluginV1`, Metaplex Core's instruction data schema wraps the plugin in `PluginArgs`:
     `PluginArgs::Royalties { basis_points, creators, rule_set }`
     Core's top-level instruction enum layout expects:
     `Instruction::AddCollectionPluginV1 { plugin: Plugin, init_authority: Option<PluginAuthority> }`
     The `Plugin` enum tag in Metaplex Core is a 1-byte enum discriminant, but when deserializing `Plugin`, `RuleSet` is an enum with payload: `RuleSet::None` is `0`, but `RuleSet::ProgramAllowList(Vec<Pubkey>)` expects a 1-byte discriminant.
  2. For `UpdateCollectionPluginV1`, passing `data.push(0)` is omitted, but `UpdateCollectionPluginV1` takes `UpdateCollectionPluginV1Args { plugin: Plugin }` which DOES NOT have `init_authority`. However, `AddCollectionPluginV1Args` takes `{ plugin: Plugin, init_authority: Option<PluginAuthority> }`.
  When `add == false`, `UpdateCollectionPluginV1` in Core parses the plugin data, but the authority field is not expected, and Core rejects the trailing garbage bytes or panics during Borsh deserialization with `InvalidInstructionData`.
* **Exploit**: Calling `set_collection_royalties(..., add: false)` fails on-chain every time against live Metaplex Core with `InstructionError::InvalidInstructionData`.
* **Fix**: Use Metaplex Core's official client type serialization or test byte-for-byte against `mpl_core::instruction::UpdateCollectionPluginV1`.

---

#### 3. [HIGH] Quorum Calculation Floor in Governance Allows Zero-Quorum Execution in Early Stages
* **Location**: `programs/cbob-vault-gov/src/lib.rs:167-172` (`execute_proposal`)
* **Description**:
  In `cbob-vault-gov`:
  ```rust
  let need = (minted_total as u128)
      .checked_mul(ctx.accounts.config.quorum_bps as u128).ok_or(GovError::Overflow)? / 10_000u128;
  require!(cast >= need, GovError::QuorumNotMet);
  ```
  If `minted_total` is small (e.g., during the charter phase with `minted_total = 190`), and `quorum_bps` is configured (e.g. 100 bps = 1% or 50 bps = 0.5%):
  `190 * 50 / 10000 = 9500 / 10000 = 0`.
  Because `cast > 0` is required, a single vote (`cast = 1`) satisfies `cast >= need` (1 >= 0). A single vault holder can pass any round parameter change without community awareness.
* **Exploit**:
  1. Config has `quorum_bps <= 50` or `minted_total` is low during initial rollout.
  2. Attacker submits a proposal with 60s voting period (`MIN_VOTING_SECS_FLOOR`).
  3. Attacker casts 1 YES vote. `need` evaluates to 0. `cast >= 0` passes.
  4. Attacker executes proposal and reprices/caps rounds arbitrarily.
* **Fix**:
  Implement a ceiling division or enforce a minimum absolute quorum count:
  ```rust
  let need = ((minted_total as u128)
      .checked_mul(ctx.accounts.config.quorum_bps as u128).ok_or(GovError::Overflow)? + 9999) / 10_000u128;
  let need = need.max(1);
  ```

---

#### 4. [HIGH] `distribute.mjs` Performs Unthrottled Sequential RPC Calls That Exhaust Node Quotas and Stall Transfers Mid-Run
* **Location**: `bank/distribute.mjs:80-92`
* **Description**:
  `distribute.mjs` loops through up to 2,100 vaults sequentially, making multiple synchronous RPC calls (`getAccountInfo`, `getBalance`, and `sendAndConfirmTransaction`) on Helius RPC.
  When 2,100 vaults exist, this triggers >6,300 HTTP requests in a single script run. Helius and standard Solana RPCs rate limit at 50-100 req/sec on standard tiers. When an RPC 429 occurs, `conn.getAccountInfo` throws an uncaught error, aborting the process.
  Because `done[v]` is written after each transaction but the allocation plan was computed at the start based on the initial balance:
  If the script dies halfway through, remaining vaults receive nothing that day. On the next daily run, the distributor balance will have already been depleted by the partial distribution, meaning the remaining vaults get calculated against a smaller pool, causing permanent distribution skew between lower-indexed and higher-indexed vault IDs.
* **Exploit**:
  Cron triggers at 09:07 UTC. At vault #340, RPC returns HTTP 429 Too Many Requests. The process crashes. Vaults 341..2100 receive 0 cbBTC for the day.
* **Fix**:
  Batch balance lookups using `getMultipleAccountsInfo` (up to 100 per RPC call), add retry/backoff wrappers, and commit distribution transactions in small concurrent batches with rate pacing.

---

#### 5. [MEDIUM] Split Revenue Precision Truncation on Small Dust Amounts
* **Location**: `programs/cbob-vault-mint/src/lib.rs:244-246` (`split_revenue`)
* **Description**:
  ```rust
  let holders = ((total as u128) * (cfg.split_bps as u128) / BPS as u128) as u64;
  let bank_cut = total.checked_sub(holders).ok_or(MintError::Overflow)?;
  ```
  If `split_revenue` is invoked when `total < 10000 / split_bps` (for instance, `total = 1` sat):
  `holders = (1 * 8500) / 10000 = 0`.
  `bank_cut = 1 - 0 = 1`.
  The Bank receives 100% of the distribution, and the holders receive 0%.
  Because `split_revenue` is permissionless, anyone can call it repeatedly whenever minimal cbBTC arrives in `revenue_ata`, funneling 100% of the dust to `bank_ata`.
* **Fix**:
  Require `holders > 0` or enforce a minimum distribution threshold in `split_revenue`:
  ```rust
  require!(holders > 0, MintError::NothingToSplit);
  ```

---

#### 6. [MEDIUM] `build-mainnet.sh` Grep Filter Swallows Cargo Compilation Errors
* **Location**: `scripts/build-mainnet.sh:37, 41`
* **Description**:
  In `build-mainnet.sh`:
  ```bash
  CARGO_TARGET_DIR=/tmp/cbob-mn cargo-build-sbf --arch v3 2>&1 | grep -E "^error" -A5 && die "mainnet build failed"
  ```
  If `cargo-build-sbf` succeeds, `grep` finds no matches and exits with returncode `1`. In bash with `set -e`, the pipeline `command | grep ...` causes the whole script to terminate if `grep` returns non-zero, OR if `grep` returns non-zero it skips `&& die`. But under `pipefail`, if cargo fails without emitting a line starting strictly with `^error` (e.g. linker failure, fatal panic, signal), the exit code from cargo triggers script failure without copying artifacts or explaining the error.
* **Fix**:
  Run `cargo-build-sbf` directly without piping into `grep`, letting standard build failures exit cleanly with full diagnostics.

---

### WHAT WAS TESTED AND COULD NOT BE BROKEN

1. **SEAL Thaw/Freeze Atomicity**: The sysvar inspection checking that `OpenForRedemption` is followed by `CloseRedemption` for the same asset and owner within the same transaction cannot be bypassed. The asset freeze plugin state is safely restored.
2. **Double Voting with Core Asset Transfer**: `VoteRecord` PDA is seeded by `[b"vote", proposal.key(), vault_asset.key()]`. Transferring the NFT to a secondary wallet and attempting to re-vote on the same proposal consistently fails with Anchor account initialization collision.
3. **Primary Lifetime Supply Bypass via Repeated Governance Rounds**: `MINT` program's `mint_vault` independently enforces `cfg.minted_total < cfg.max_supply`. Even if a compromised Governance proposal ratifies a round with `cap: u32::MAX`, `mint_vault` rejects any mint once `minted_total == max_supply`.
4. **Token-2022 Hidden Balance Exploit in Burn Verification**: `burn_vault` explicitly asserts `d.len() == 165` on all declared accounts and verifies that reserve mints belong to classic SPL Token program.

---

### THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Fix the `set_collection_royalties` Core CPI data serialization (Finding #2).**
The manual byte layout passed to Metaplex Core for collection plugin updates does not conform to Core's enum specification. If executed on mainnet, royalty configuration will fail or corrupt collection plugin state, breaking secondary marketplace fee flows to the revenue PDA.