# Round 42 Independent Audit — Full Tree

## R0. Round 41 Verdict Verification

**V41-1 repair (dust-safe config reads): VERIFIED at all sites.**

I traced `absentIfDust` through every reader of a derived address:

| Site | File:Function | `absentIfDust` applied? |
|---|---|---|
| Config reads (SEAL/MINT/BURN/GOV) | `reads.mjs:anchorAccount` | Yes — returns `null` for System-owned 0-byte |
| Ceremony collection check | `ceremony-reads.mjs:readStep('collection')` | Yes |
| Ceremony SEAL conflict check | `ceremony-reads.mjs:resolveCollection` | Yes |
| Vault record | `reads.mjs:readVault` → `anchorAccount` | Yes |
| Pool account in redemption snapshot | `reads.mjs:readRedemptionSnapshot` | Yes |
| Buy page token accounts | `reads.mjs:readBuySnapshot` | Yes |
| Reserve ATAs in wallet listing | `reads.mjs:vaultWalletAccounts` | Yes |

The e2e test (`web/test/e2e-localnet.mjs`) dusts all four config addresses before step 0 and verifies every ceremony step still initializes and re-reads "done, verified on chain". The control (System-owned WITH data, or wrong-program owner) still refuses.

**Round 41's disproved claims:** I re-checked C2 (dusted revenue ATA blocking sales), C3 (stranger initializing wrong-program token at ATA address), C8 (rent rule), C12 (leader influence), C15 (ID.1 uniqueness), C16 (U1 instruction count). All remain correctly disproved. The `because()` pin count for the seven A9 arms is still 0 each, matching round 40's "recommended" classification.

**No regression found.** The programs diff between round 39's audited tree and HEAD is empty (`git diff 21f36e1 5741f0e -- programs` produces no output).

## R1. Custody

**No defect found.** I independently verified:

- The SEAL↔BURN pairing binds asset AND owner in both directions. Each walks the instructions sysvar (top-level only) and matches discriminator + account positions 0 (asset) and 2 (owner). A CPI wrapper cannot satisfy either check because `load_current_index_checked` / `load_instruction_at_checked` see only top-level instructions.
- The sweep helper is reachable only through Core `ExecuteV1`, which requires the asset owner's signature. Core's authority rule (asset approves Execute only for `authority == owner`) is the access control.
- BURN's emptiness proof checks: PDA lamports == 0, every reserve mint's ATA under both token programs declared and empty, no delegate, no close authority, no Token-2022 extensions, no live Core asset among declared accounts.
- A thawed vault cannot leave the transaction unburned: BURN requires the open to have preceded it, and the burn is in the same atomic transaction.

**Evidence if I were wrong:** A transaction that thaws a vault without burning it would leave the vault in a `frozen: false` state with contents intact. The suite arms 3.6, 3.7, 3.8, WR.1-WR.4 all test this and pass.

## R1s. Sweep Helper

**(a) Access control:** Verified. The helper requires `signer.is_signer`. Through Core ExecuteV1, Core signs as the asset-signer PDA only for the asset owner. Suite arms SR.5, SR.5a, SR.5c confirm strangers, transfer delegates, and collection update authorities are refused with `NoApprovals` (0x1a). The helper cannot be reached while the vault is frozen because Core's `PermanentFreezeExecute` plugin rejects Execute when frozen.

**(b) Pair list:** I traced each edge case:
- **Duplicate source:** First iteration transfers and closes. Second iteration's `read_token` fails with `IllegalOwner` (account is now System-owned, data zeroed). Safe.
- **Duplicate destination:** Each pair independently checks `to_owner == dest.key`. Two pairs with the same destination just transfer to the same account twice. Safe.
- **Source is also destination:** Prevented by `signer.key != dest.key` (the vault PDA can't be the destination wallet). A source is owned by `signer.key`, a destination by `dest.key`, and these differ. Safe.
- **Native wSOL source:** wSOL is a classic SPL token account (165 bytes). The helper would sweep and close it like any other. Safe.
- **Source with delegate:** The helper doesn't check for delegates. But the transfer CPI uses `signer` as authority, and SPL Token checks the authority. If a delegate is set, the owner can still transfer. Safe.
- **Frozen source:** SPL transfer fails, whole transaction reverts. Documented (SR.14).
- **Destination not an ATA:** The helper checks `to_owner == dest.key` and `to_mint == src_mint`. It doesn't require ATA derivation. Any token account owned by `dest` for the right mint works. Safe.
- **Destination is another vault's asset-signer:** The helper doesn't prevent this. But the caller (vault owner) would be sending their funds to another vault's PDA. This is their choice. The destination token account must be owned by that PDA, which the owner can create. Not a security issue.
- **Zero pairs:** Only the lamport sweep runs. Tested (SR.13).

**(c) Destination checks:** The helper doesn't verify `dest == vault owner`. This is by design — the owner chooses the destination. Core's ExecuteV1 is the access control. A lamport transfer to a nonexistent account below rent exemption fails at the runtime level (verified by R41.C8a-c).

**(d) Lamport sweep:** `signer.lamports()` is read at execution. BURN checks `asset_signer.lamports() == 0` after the sweep. No instruction between sweep and burn can add lamports (they're sequential in the same transaction). Safe.

**(e) BURN interaction:** The sweep closes accounts it empties. BURN's reserve loop checks `amount == 0` and account existence. A closed account has `owner == System` and `data.len() == 0`, so BURN's `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }` skips it. Safe.

For a missing reserve ATA: the page creates it in the prior transaction (item 42). If a stranger creates it with dust between the page's check and the redemption, the sweep reads the live balance (0 or dust) and sweeps it. BURN checks `amount == 0` after the sweep. Safe.

**(f) Packet fit:** S8.0 measures 1,061 bytes for the three-asset redemption through the helper. The widest page shape (compute budget + separate payer) is about 1,209 bytes. Fits within 1,232.

**(g) Evidence:** SR.0-SR.4a, SR.5-SR.14, SR.13 all test the helper. The helper's bytes are proven identical between mainnet and localnet builds by `scripts/build-mainnet.sh`.

## R2. Community Pool

**Invariant "pool always holds at least ceil(owed)": VERIFIED.**

I traced the arithmetic:
- `distribute`: `avail = balance - ceil(owed_scaled/ACC_SCALE)`. `credit` adds `delta*w` to `owed_scaled` where `delta = avail*ACC_SCALE/w`. Since `delta*w <= avail*ACC_SCALE`, new `owed <= old_owed + avail = balance`. Invariant holds.
- `claim`: Pays `pay = pending/ACC_SCALE` whole sats. Decreases `owed_scaled` by `pay*ACC_SCALE`. Pool balance decreases by `pay`. Ratio maintained.
- `retire`: Decreases `owed_scaled` by `pending` (what the vault was owed). Pool balance unchanged. Pool has more than it owes.
- `monthly_inline`: Same as `distribute`. Invariant holds.

**Counter checks:**
- `pending_count` / `pending_this_epoch`: Incremented on activate request, decremented on join or retire. `waiting_to_join = pending_count - pending_this_epoch`. No underflow path found.
- `active_count` / `total_active_weight`: Incremented on join, decremented on retire. Boost changes adjust weight via `reweigh`. No drift path found.
- `dist_epoch`: Incremented by `advance_epoch` (called from `credit` and `tick`). Monotonically increasing.

**Liveness:** `JoinWaitingFirst` prevents distributing while vaults wait to join. `BoostsExpireFirst` prevents distributing while boosts are due. Both are clearable by permissionless instructions (`claim` joins, `expire_boosts` expires). No permanent block path found.

## R2b. $CBOB Boost

**"A boost earns EXACTLY its N distributions": VERIFIED.**

- Boost bought at epoch `e` with `n` epochs ends at `e+n`. Ring slot `(e+n) % 64`.
- `advance_epoch` at epoch `e+n` moves `boost_expiring[(e+n)%64]` to `boosts_due`.
- `distribute` requires `boosts_due == 0`.
- `expire_boost` requires `dist_epoch >= boost_end_epoch`.
- Since max epochs is 63 and ring is 64, a boost's end slot is reached before the slot is reused.

**"Nothing earned is lost or gained on weight change": VERIFIED.**

`reweigh` preserves `owed_of(r, acc)` in `carry_scaled` and resets `debt_scaled` to `new_weight * acc`. The total `owed_scaled` is unchanged.

**Ring consistency:** `boosts_active = ring_sum + boosts_due`. `boost_weight_total` tracks the sum of all live boost weights. `unschedule_boost` correctly decrements either `boosts_due` (if due) or the ring slot (if not yet due).

**No double-expiry:** `expire_boost` requires `boost_weight > 0`. After expiry, `boost_weight = 0`. A second call would fail the require.

**No boost on a vault whose token account is gone:** Boost requires `r.active`. A retired vault has `active = false`. A vault's token account being gone doesn't affect boost mechanics (boosts don't interact with token accounts).

## R3. Level Draw

**SlotHashes parse:** `blockhash_in_window` validates the sysvar key, checks `n <= 512`, checks data length, rejects all-zero hashes. Correct.

**Skipped-slot handling:** Finds the smallest produced slot in `[want, want+64]`. Deterministic. Correct.

**FIFO:** `reveal_level` requires `index == revealed_total`. Enforced. Correct.

**Burned vault at head of queue:** `reveal_level` checks if the asset is burned (Core-owned, 1 byte, key 0). If burned, it still draws the level (increments `level_minted` and `revealed_total`) but skips the Core `UpdatePluginV1`. The FIFO doesn't stop. Correct.

**Attribute re-supply hash:** `reveal_level` checks `hashv(&[&attributes.try_to_vec()?]).to_bytes() == hash`. The hash was stored at mint. Correct.

**Influence:** The last-contributor residual (C's leader can choose among draws) is correctly documented as accepted limit 26. I verified the arithmetic: skipping alone gives best-of-4, which takes P(Level V) from 5.0% to ~18.6%.

## R4. Governance

**Minority carry:** Quorum is 21% of snapshotted live supply. Threshold is 51% of votes cast. Turnout floor is 10% YES of snapshot. Key changes require 50% of snapshot. At the ruled numbers, the smallest passing ordinary vote is 10.71% YES, above the 10% floor. Correct.

**Vote reaches money:** Governance can only call `set_round`, `restart`, `tighten_sweep`, `arm_swap_operator`, `arm_guardian`, `set_boost_terms`. None of these touch the 85/15 split, destinations, max_supply, or any vault. Correct.

**Governance frozen forever:** If fewer than 50% of live vaults vote YES to replace a stolen guardian, the stop is permanent (accepted limit 47). This is correctly documented. The guardian can only stop sales and sweep, not redemption, activation, distribution, or claims.

**Overtaken action:** Skipped and logged, not reverted. Correct per RT2 finding 6.

## R5. Charter Claim

**Merkle proof:** Domain-separated (0x00 leaf, 0x01 node), sorted pairs. Prevents second-preimage. Correct.

**PoB identified by address:** The 240 addresses are committed as a Merkle root. A lookalike minted by the hot wallet is not in the tree. Correct.

**CPI burn:** The PoB is burned by CPI in the same instruction. It can't be reused. Correct.

**Window:** `charter_opens_at` and `charter_closes_at` are set at initialize. No instruction changes them. The claim refuses outside the window by clock comparison. Correct.

**Not gated by guardian stop:** `claim_charter_vault` doesn't check `sales_stopped`. Correct per ruling.

**pob_extra pass-through:** Up to 8 extra accounts passed to Core's burn. Never as signers. Correct.

**SPEC 46 completeness:** The hot wallet can block claims (end the project) or admit only its own PoBs (capture governance) during the 7-day window. After the window closes, the exposure ends. This is correctly and completely documented.

## R6. One-Time Configuration

I verified every `initialize` check:

- **MINT:** INIT_AUTHORITY, bank_treasury != default, notice_secs in range, sweep bounds consistent, level caps non-zero and sum <= max_supply, charter window valid, pob_root non-zero, monthly_secs in range, cbob_mint valid and distinct, collection clean and ours, SEAL wiring matches, payment_mint is a SEAL reserve.
- **SEAL:** INIT_AUTHORITY, 1-3 reserve mints, all classic SPL.
- **BURN:** INIT_AUTHORITY, SEAL wiring matches, redeem_window_secs in range.
- **GOV:** INIT_AUTHORITY, MINT collection matches, quorum/threshold/voting period in range.

**Swap operator worst case:** Bounded by `max_sweep_lamports` per sweep, `sweep_cooldown_secs` between sweeps, `sol_reserve_lamports` kept. Guardian can stop. Vote can only tighten. Correct.

**10% royalty:** Installed as Core plugin with `PluginAuthority::None`. Core refuses update/removal. Verified by suite arms R.1-R.6c.

**Redemption cap:** Rolling window over 64-slot ring. `cap = max(1, ceil(live * 210 / 10000))`. K-th most recent must be >= window old. Correct.

## R7. Cross-Program Raw Reads

I recomputed every offset from the struct definitions:

| Reader | Target | Field | Offset | Verified |
|---|---|---|---|---|
| GOV | MintConfig | governance | 41 | ✓ |
| GOV | MintConfig | minted_total | 141 | ✓ |
| GOV | MintConfig | bare_burns_retired | 454 | ✓ |
| GOV | MintConfig | charter_closes_at | 442 | ✓ |
| GOV | MintConfig | sales_stopped | 191 | ✓ |
| GOV | MintConfig | sweep_stopped | 192 | ✓ |
| GOV | MintConfig | sales_stopped_at | 518 | ✓ |
| GOV | MintConfig | sweep_stopped_at | 526 | ✓ |
| GOV | MintConfig | sol_reserve_lamports | 257 | ✓ |
| GOV | MintConfig | max_sweep_lamports | 266 | ✓ |
| GOV | MintConfig | sweep_cooldown_secs | 274 | ✓ |
| GOV | MintConfig | sweep_floor_lamports | 631 | ✓ |
| GOV | MintConfig | cooldown_ceiling_secs | 639 | ✓ |
| GOV | MintConfig | reserve_ceiling_lamports | 647 | ✓ |
| GOV | MintConfig | max_boost_weight | 711 | ✓ |
| GOV | MintConfig | max_boost_epochs | 712 | ✓ |
| GOV | VaultRecord | version | 8 | ✓ |
| GOV | VaultRecord | asset | 9 | ✓ |
| GOV | VaultRecord | mint_index | 41 | ✓ |
| GOV | BurnConfig | version | 8 | ✓ |
| GOV | BurnConfig | burned_total | 42 | ✓ |
| BURN | MintConfig | minted_total | 141 | ✓ |
| BURN | MintConfig | bare_burns_retired | 454 | ✓ |
| MINT | SealConfig | version | 8 | ✓ |
| MINT | SealConfig | collection | 9 | ✓ |
| MINT | SealConfig | reserves | 41 | ✓ |
| BURN | SealConfig | (same as MINT) | | ✓ |

All offsets match. All discriminators and version bytes are pinned.

**Sweep helper raw reads:** `read_token` checks `owner == SPL_TOKEN_ID`, `data.len() == 165`, reads mint at 0, owner at 32, amount at 64. Correct for classic SPL.

## R8. Suite, Simulation, and Build

**Arms that cannot fail:** I checked the `because()` pins. Each negative arm has a reason pin that verifies the rejection is for the expected error. The `ID.1` arm verifies all assertion IDs are unique (excluding `!` suffixed pins). The floor assertions require exact counts, not minimums.

**Arms testing wrong reasons:** The `because()` function checks that the error message contains the expected code. Suite arms like SR.12b verify the duplicate-source refusal reached the second source, not the first. This is good practice.

**Claims not exercised by any arm:** I checked Fable F5's list (helper destination named twice, wSOL source, another vault's signer as destination, claim to un-retired bare-burned vault, distribute from frozen pool, rescuing with owner-frozen FreezeDelegate). These are coverage recommendations, not defects. The existing arms cover the security-critical paths.

**Build provenance:** `scripts/build-mainnet.sh` deploys both mainnet and localnet builds, asks each whether it trusts the test key, and verifies the sweep helper's bytes are identical. The source check verifies all four programs name the correct INIT_AUTHORITY.

## Accepted Limits Assessment

**1. Is any limit WORSE than stated?**

I checked each accepted limit against the code:

- **Limit 26 (leader grinding):** The statement "removes every other leader's influence" is mechanically true for non-C leaders. A/B leaders who skip entire groups cause blind re-rolls, not informed choices. The C-leader residual is correctly stated. **Not worse.**
- **Limit 27 (bare burn claim):** `claim` doesn't check if the asset is alive. A claim to a bare-burned vault pays into a dead account. The crank retires burned vaults first. **Not worse than stated.**
- **Limit 28 (Coinbase freeze):** Correctly stated. A frozen vault account blocks redemption. A frozen pool blocks claims but not redemption (forfeit path). **Not worse.**
- **Limit 32 (rate limit):** The cost statement "about 2.1% of live supply in vaults" is accurate — those vaults are burned. The redeemer gets the contents back. **Not worse.**
- **Limit 40 (Core upgradeable):** Correctly stated. Three concrete consequences named. **Not worse.**
- **Limit 41 (leaked custodial key):** Correctly stated. Transfers are not limited. **Not worse.**
- **Limit 46 (hot wallet):** Completely stated. Both attack vectors (end project, capture governance) documented. Post-window exposure ends. **Not worse.**
- **Limit 47 (stolen guardian):** Correctly stated. Permanent at low turnout. **Not worse.**

**2. Is anything listed as a limit not actually a limit?**

- **Limit 42 (prior transaction for ATAs):** The narrow owner-payer shape fits all three creates (1,219 bytes). But the fully padded page shape doesn't (1,367 bytes). The limit correctly states the page contract requires prior preparation. **Still a real limit for the page.**
- **Limit 49 (record rent not refunded):** Correct. The record is never closed. **Still a real limit.**

**3. Is any DISCHARGED item not actually discharged?**

- **Item 51 ($CBOB boost):** Built and measured. Suite section BO covers it. **Discharged.**
- **Item 54 (compute at widest shapes):** Measured. **Discharged.**
- **Items 12/17 (compute units):** Measured. **Discharged.**
- **Item 14 (duplicate attributes):** Closed on chain. **Discharged.**
- **Item 19 (unlevelled vault halt):** Closed by construction. **Discharged.**
- **Items 30, 31, 33:** Superseded or discharged. **Discharged.**

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

- **Item 22 (nothing run against live chain):** Still OPEN. The dress rehearsal hasn't happened.
- **Item 38 (initialize values):** Still OPEN. `charter_opens_at`, `lock_deadline`, `vault_collection` are OPEN in `launch/mainnet-init.json`.
- **Item 50 (holder surfaces):** Still OPEN. Pages built but not published.
- **Item 52 (pool/Squads accounts):** Still OPEN. Road step 10 creates them.
- **Item 53 (dress rehearsal):** Still OPEN.

None are being quietly treated as accepted.

## Findings

**No CRITICAL, HIGH, or MEDIUM findings.**

After independently tracing every program instruction, every cross-program read, every web page transaction builder, and every accepted limit, I found no new defect that survives measurement. The V41-1 repair is correctly applied. All round 41 disproved claims remain correctly disproved.

**LOW-1 (documentation, eligible for documentation exception): SPEC item 50 says "a credit below rent exemption to an account that does not exist yet is refused" but doesn't explicitly state this is a runtime rule, not a program rule.**

File: SPEC.md, item 50, "A lamports-only sweep needs a destination that exists" bullet.

The statement is mechanically true (the runtime refuses transactions that leave a newly created account rent-paying). But a reader might think the sweep helper or BURN enforces this. They don't — it's the Solana runtime's rent check. The suite arms R41.C8a-c measure this.

This misstates nothing about holder money, rights, or program behaviour. The runtime rule is what protects the holder. **Eligible for documentation exception.**

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the dress rehearsal (item 22/53) at the terminal, with Gary watching.** The crank, alarm, and revenue cycle have never run against a live cluster. The programs are proven; the off-chain pipeline is not. One full live revenue cycle through both pools, one forced post-sweep failure recovered by hand, and the crank's live passes are the minimum.

2. **Complete the three OPEN initialize values before the ceremony.** `charter_opens_at`, `lock_deadline`, and `vault_collection` must be set. The ceremony page refuses while any is OPEN.

3. **Publish the holder pages (item 50) before the holder guide.** The guide speaks of these surfaces in the present tense. Without the pages, items 9 and 44 have no preventive control in production.

4. **Remove the upgrade authority from all five programs in one sitting, immediately after road step 10.** The window between deploy and lock is when INIT_AUTHORITY (a Phantom wallet) is the only gate on the one-time initializes. Steps 9 and 10 should happen in one session.

5. **Fund the revenue address above rent exemption before the first royalty.** The address starts at 0 lamports. A first royalty smaller than rent exemption would fail.

6. **Verify the pool's and Squads' cbBTC accounts exist before the first split.** Road step 10 creates them idempotently. Verify they exist after.

7. **Set up the RPC proxy and metadata generator before the pages go live.** The pages refuse without the RPC endpoint. The metadata generator writes the vault JSON files that the NFT metadata links to.

8. **Keep the `launch/mainnet-init.json` file immutable after the ceremony.** It records the ruled values. Any change should be a new ruling recorded in DESIGN-v6.md.

9. **The cron installer must be run after the pages are live.** The current crontab still has the v5 block. It needs the crank, reconcile, and revenue lines.

10. **Accept that AI audit has structural limits.** No AI can: (a) verify that the deployed bytes match the audited source after the upgrade authority is removed; (b) verify that the Phantom wallet holding INIT_AUTHORITY is not compromised; (c) verify that the operator's box is not compromised; (d) verify that Gary's decisions are informed. The build script's behavioural probe (mainnet rejects test key, localnet accepts) is the strongest available bridge between source and deployed bytes, but it is not a byte-for-byte proof. Reproducibility (rebuild from the commit, compare hashes) is the complement.