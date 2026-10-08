# Round 38 Independent Audit — CBOB Vaults v6

**Auditor:** Qwen3.8 (independent, AI-only certification per Gary ruling 2026-08-22)
**Audited HEAD:** `0ae07d2` (round 36 validated repairs, scope-frozen) with round 37 repairs applied
**Method:** Full source read of all five programs, sweep helper, web/ pages, launch config, test suite, simulation, build scripts. No validator run performed (read-only pass). All claims below cite file/function and the evidence that would confirm or refute them.

---

## R0 — Round 37 Verdict Verification

I independently re-derived every confirmed finding from round 37 and checked the repairs in the bundled source.

**V1 (LOW, redeem page flood):** Repair present. `web/src/lib/reads.mjs` `vaultWalletAccounts` now reads the three reserve ATAs by address via `getMultipleAccounts`, then lists strays with bounded `dataSlice` reads (8-byte balance for classic/165-byte T22, 0-byte address-only for all T22). On listing failure it returns `incomplete.unlisted` and the planner produces one grouped box, never a refusal. `planRedemption` groups >20 acks via `groupAcks`. **Repair holds.** Evidence: the bounded-read code path is present and the proxy's 8 MB cap can no longer block the page because the page degrades to a box instead of throwing.

**V2 (LOW, ceremony decoy collection):** Repair present. `web/src/lib/ceremony-reads.mjs` `resolveCollection` checks recorded pins (config.js, SEAL, launch file, browser memory, session) first and returns the pinned collection with decoys listed as `ignored`. Only when no pin exists does it fall through to chain-scan with creator verification. A decoy can no longer cause a hard STOP when a pin exists. **Repair holds.**

**V3 (INFO, frozen-account activation misstatement):** Repair present. `web/src/lib/plan-vault.mjs` `planActivate` now builds the activate instruction even when the cbBTC account is frozen and attaches a `frozenNote` explaining that payouts wait for the unfreeze. This matches MINT's actual behaviour (`read_token` discards the state byte: `let (amount, _) = read_token(...)` at `lib.rs:1439`). **Repair holds.**

**C05 (documentation exception, SPEC limit 10 ceiling):** Independently re-verified. The hourly revenue job reads the chain clock slightly before the sweep lands; MINT stamps `last_sweep_at` at landing. The next run 6 hours later finds the cooldown a few seconds short and skips; the run 7 hours after the previous sweep succeeds. Effective cadence is 24/7 × 10 SOL ≈ 34.3 SOL/day, not 40. The corrected figure in SPEC limit 10 is accurate. **Confirmed correct.**

No round-37 repair regressed. No new defect was introduced by the repairs.

---

## R1 — Custody: sealed-vault extraction

I attacked the open↔burn pairing, the emptiness proof, and every path that could leave a thawed vault alive.

**Pairing (SEAL `open_for_redemption` ↔ BURN `burn_vault`):**
- Both walks use `load_current_index_checked` / `load_instruction_at_checked` on the instructions sysvar, which exposes only **top-level** instructions. A CPI-wrapped open or burn is invisible to the counterpart's walk. Confirmed by suite arms WR.1–WR.3.
- Both directions bind **asset AND owner** (SEAL checks BURN_IX_ASSET_IDX=0 and BURN_IX_OWNER_IDX=2; BURN checks SEAL_IX_ASSET_IDX=0 and SEAL_IX_OWNER_IDX=2). Cross-vault borrowing within one transaction is rejected (suite 3.9, 3.10, 9.0).
- SEAL walks forward from `current+1`; BURN walks backward from `0..current`. Two interleaved redemptions (open A, open B, burn B, burn A) pair correctly (suite 4.10a).
- A thaw without a matching burn fails `NoTerminalBurn`; a burn without a matching open fails `NoPrecedingOpen`. If the burn fails for any reason (vault not empty, rate-limited, etc.), the entire transaction reverts including the thaw. **No path leaves a thawed vault unburned.**

**Emptiness proof (BURN `burn_vault`):**
- `asset_signer.lamports() == 0` is checked. Core's `BurnV1` does NOT sweep the PDA's lamports (measured fact 4), so this check is load-bearing.
- Every reserve mint's ATA under **both** classic SPL and Token-2022 derivations must be declared. Undeclared → `ReserveNotDeclared`.
- Declared token accounts are checked: owner must be the PDA, no delegate (`d[72..76]`, `d[121..129]`, `d[129..133]` all zero), no Token-2022 extensions (`d.len() == 165`), amount == 0.
- Declared Core-owned accounts must not be live AssetV1 (`d[0] != KEY_ASSET_V1`).
- The second loop re-checks all declared token accounts owned by the PDA with the same delegate/extension/amount constraints.
- Accounts not owned by either token program are skipped (treated as non-existent/closed), which is correct because a closed ATA reverts to system ownership.
- **Completeness gap acknowledged:** undeclared non-reserve token accounts and nested Core assets are invisible (proven impossibility 2). This is covered by the redeem page's `judgeRedemptionCoverage` (staged, not published — item 50) and post-hoc alarm detection. Not a new finding.

**Sweep-at-execution:** The sweep helper moves live balances, so a stranger's deposit landing between plan-read and execution cannot block the opening (suite SR.3 vs SR.4). **Confirmed.**

**Verdict: No extraction path found. The seal holds.**

---

## R1s — Sweep Helper

I attacked every branch of `programs/cbob-vault-sweep/src/lib.rs`.

**(a) Access control.** Called directly, `signer.is_signer` is required. The signer is the asset-signer PDA, which only Core can sign for via `ExecuteV1`. Core's `ExecuteV1` approves only `authority == owner` (measured against pinned Core binary, suite SR.5/SR.5a/SR.5c). The PermanentFreezeExecute plugin blocks ExecuteV1 while frozen. Collection update authority, transfer delegates, and other plugin authorities cannot invoke Execute (suite SR.5b, SR.5c, R24.1, R24.1a). **No unauthorised access path found.**

**(b) Pair list edge cases.**
- **Duplicate source:** First iteration transfers and closes. Second iteration's `read_token(src)` fails because the closed account is now system-owned (`IllegalOwner`). Safe.
- **Duplicate destination:** Each pair is independent; the same destination can receive from multiple sources. No issue.
- **Source == destination:** Would require `src_owner == to_owner`, i.e. `signer.key == dest.key`, rejected by the explicit check. Safe.
- **Source == dest account:** `src_owner` would need to equal `signer.key`, but `dest` is a different wallet. Rejected. Safe.
- **Native wSOL:** Handled as a normal token account; transfer and close work. Rent from close goes to `dest`. Safe.
- **Delegate on source:** Transfer uses `signer` (owner) as authority, not the delegate. Owner can always transfer. Safe.
- **Close authority held by stranger:** The close CPI uses `signer` as authority. If `close_authority` is set to a different key, the close fails, reverting the entire call. This is the C5 case (suite R36.C5). The redeem page handles it via a separate `ExecuteV1` plain transfer. Safe.
- **Frozen source account:** Token program rejects the transfer. Entire call reverts. Safe.
- **Destination not an ATA:** The code only checks `to_owner == dest.key` and `to_mint == src_mint`. Non-ATA token accounts are accepted. This is by design (the page creates ATAs, but the helper doesn't enforce ATA-ness). No security issue.
- **Destination wallet == asset-signer:** Rejected by `signer.key == dest.key`. Safe.
- **Destination == another vault's asset-signer:** Allowed. The owner is choosing to send funds into another vault. This is the owner's choice; the BURN emptiness proof still passes because the source accounts are emptied. No security issue.
- **Zero pairs:** Loop doesn't execute; only lamport sweep runs. This is the lamports-only case (suite SR.13). Safe.
- **Odd account count:** `(accounts.len() - 4) % 2 != 0` → `NotEnoughAccountKeys`. Safe.

**(c) Destination checks.** The destination wallet is chosen by the transaction builder. Since only the owner can initiate (via Core ExecuteV1), the owner chooses where their own funds go. The lamport sweep to a non-existent or below-rent-exemption destination would fail, reverting the call. Acknowledged in SPEC ("A lamports-only sweep needs a destination that exists"). Safe.

**(d) Lamport sweep.** `signer.lamports()` is read after all token operations. Token closes send rent to `dest`, not `signer`, so the signer's balance is unchanged by token ops. The sweep transfers the full balance to `dest`, leaving signer at 0. A later instruction in the same transaction could add lamports back, but BURN's `lamports() == 0` check would then fail, reverting the transaction. Safe.

**(e) Interaction with BURN.** The sweep closes emptied accounts. BURN's reserve loop skips accounts not owned by a token program (closed → system-owned). The page creates missing reserve ATAs in a prior transaction. A stranger can permissionlessly create a classic ATA for the vault, but the sweep would empty and close it. Token-2022 ATAs for classic mints cannot be created (probe F4.2). **No gap found beyond the acknowledged completeness limitation.**

**(f) Packet fit.** S8.0 measures 1,061 bytes for the plain shape; with compute-budget pair (+52) and separate fee payer (+96), ~1,209 of 1,232. Fits. S8.1a measures 168,343 CU. **Confirmed.**

**(g) Evidence.** Suite SR.0–SR.4a, SR.5–SR.14, S8.0–S8.3 cover the helper. The helper's mainnet bytes are proven identical to the tested localnet bytes by `scripts/build-mainnet.sh` (cmp of `dist/cbob_vault_sweep.so` against `target/deploy/cbob_vault_sweep.so`). **Confirmed.**

**Verdict: No defect found in the sweep helper.**

---

## R2 — Community Pool

I re-derived the accumulator arithmetic and checked every counter.

**Accumulator invariant (`pool_balance >= ceil(owed_scaled / ACC_SCALE)`):**
- `credit`: `delta = floor(avail * ACC_SCALE / w)`. `owed += delta * w`. Since `delta * w <= avail * ACC_SCALE`, the pool retains at least `owed` after credit. ✓
- `claim`: pays `pay = floor(pending / ACC_SCALE)` from pool; `owed -= pay * ACC_SCALE`. Since `pay * ACC_SCALE <= pending`, the pool decreases by at most what `owed` decreases. ✓
- `reweigh` (boost): moves owed to `carry`, resets `debt` at new weight. `owed_of` before == `owed_of` after. Total `owed_scaled` unchanged. ✓
- `retire`: subtracts the vault's `pending` from `owed_scaled`. For redeemed vaults, `pending < ACC_SCALE` is required (unless pool frozen). For bare burns, the share returns to the pool. ✓
- Suite P.32 asserts the invariant after every money operation. **Confirmed.**

**Two-step activation (`activate` → join after next distribution):**
- First call sets `pending = true`, `request_epoch = dist_epoch`.
- Join requires `dist_epoch > request_epoch`. This ensures the vault misses the distribution that follows its request.
- `JoinWaitingFirst` gate: `waiting_to_join = pending_count - pending_this_epoch`. If > 0, distributions are refused. This prevents a first-activator from capturing a backlog.
- Counters: `pending_count` incremented on request, decremented on join or retire. `pending_this_epoch` incremented on request, reset to 0 by `advance_epoch`, decremented on same-epoch retire. `pending_this_epoch <= pending_count` always holds. No underflow path found. ✓
- Suite 3c.A1–A7, P.17–P.17b, F21.1–F21.2 cover this. **Confirmed.**

**`retire_redeemed` / `retire_burned`:**
- `retire_redeemed` is CPI-only, verified by stack height (`TRANSACTION_LEVEL_STACK_HEIGHT + 1`) and instructions-sysvar introspection (must be BURN's `burn_vault` for the same asset). Suite WR.1, P.23 confirm the guard.
- `retire_burned` requires the asset to be positively burned (Core-owned, 1 byte, key 0). Suite P.24–P.28 confirm.
- **Confirmed.**

**`monthly_inline`:**
- Called at the start of `mint_vault`, `claim_charter_vault`, `activate`, `boost_vault`, and at the end of `retire_redeemed`.
- Checks: pool is correct, not frozen, has balance above owed, no boosts due, no waiting joins, weight > 0.
- Sets `last_distribute_at = now` to prevent re-execution in the same transaction.
- In `retire_redeemed`, called AFTER retire so the leaving vault isn't credited. ✓
- Suite IN.0–IN.5, 3c.A4, BO.13, BO.22 cover this. **Confirmed.**

**Verdict: No defect found in the pool arithmetic or counters.**

---

## R2b — $CBOB Boost

I traced the boost lifecycle: purchase → N distributions → due → expiry.

**Ring buffer (`BOOST_RING = 64`):**
- `max_boost_epochs <= 63` (BOOST_RING - 1), enforced at `initialize` and by `set_boost_terms`.
- A boost bought at epoch `t` ends at `t + epochs` (at most `t + 63`). Ring slot is `end % 64`.
- `advance_epoch` adds `boost_expiring[epoch % 64]` to `boosts_due` and zeros the slot.
- `BoostsExpireFirst` prevents any distribution while `boosts_due > 0`, ensuring boosts are expired before the ring slot is reused.
- Suite BO.34–BO.34c, BO.38 test the ring wrap. Host unit test `the_boost_ring_wraps_exactly_against_a_model` runs 260 epochs (4 wraps). **Confirmed.**

**`reweigh` correctness:**
- Moves owed to `carry`, resets `debt` at new weight. `owed_of` is preserved. `total_active_weight` adjusted by the delta. No value created or destroyed. ✓
- Suite BO.7c, BO.10, BO.14 verify. **Confirmed.**

**`unschedule_boost` (early retire or expiry):**
- If `dist_epoch >= boost_end_epoch`, decrements `boosts_due`. Otherwise decrements `boost_expiring[end % 64]`.
- Suite BO.16 (early retire), BO.17 (due retire), BO.38 (wrapped early retire) cover both branches. **Confirmed.**

**Owner-only boost (`BoostNotTheOwner`):**
- `boost_vault` reads the asset's current owner from Core AssetV1 bytes and requires it to match the signer. Suite BO.6, BO.33 confirm. **Confirmed.**

**Buyer's terms (`BoostTermsMoved`):**
- `max_price`, `min_weight`, `min_epochs` are checked against current config. A vote moving terms against the buyer (price up, weight down, epochs down) causes refusal. A favourable move lands at new terms (ruled one-sided). Suite BO.26, BO.30, BO.31 confirm. **Confirmed.**

**Verdict: No defect found in the boost mechanism.**

---

## R3 — Level Draw

I verified the entropy capture, FIFO reveal, reschedule, and census.

**Entropy (`try_capture`):**
- Three slot hashes from three different leader groups (A at/after `reveal_slot`, B and C each ≥ 2 groups later).
- `blockhash_in_window` validates the SlotHashes sysvar: key matches, count ≤ 512, buffer large enough, no all-zero hashes.
- Skipped slots handled: finds the smallest produced slot in `[want, want + 64]`.
- Suite L.3c re-derives entropy from raw SlotHashes. Host unit tests cover skipped-slot paths. **Confirmed.**

**FIFO (`reveal_level`):**
- `require!(index == ctx.accounts.config.revealed_total, RevealOutOfOrder)`. Strict mint order.
- Attributes re-supplied and hash-checked (`AttributesMismatch`). Suite L.4 confirms tamper rejection.
- Burned vaults still take a draw (L.11) so the FIFO doesn't stall. **Confirmed.**

**Reschedule (`reschedule_reveal`):**
- Only after window passes (`now > reveal_slot + 300`). New target is `now + 16` (future slot, unknown at call time).
- Logged `CBOB_REVEAL_RESCHEDULED` for alarm. Suite L.17–L.17e confirm. **Confirmed.**

**Census:**
- Draw without replacement from `level_caps - level_minted`. `check_supply` prevents minting beyond census.
- Suite L.18–L.23 exhaust the census and verify every draw. **Confirmed.**

**Residual (accepted limit 26):** C's leader can grind. Acknowledged, not a new finding.

**Verdict: No defect found in the level draw.**

---

## R4 — Governance

I checked quorum, threshold, turnout, supermajority, snapshots, and skip logic.

**Quorum/threshold/turnout:**
- Quorum: `ceil(snapshot * quorum_bps / 10000)`, never zero. ✓
- Threshold: `floor(yes * 10000 / cast) >= threshold_bps`. ✓
- Turnout: `yes >= ceil(snapshot * 1000 / 10000)`. ✓
- Key change supermajority: `yes >= ceil(snapshot * 5000 / 10000)`. Triggered by ANY `Brakes{set_guardian:true}` or `ArmSwapOperator` action, even if the action is later skipped. Fail-safe. ✓
- Suite D.1, 3c.K2, G.8–G.10 confirm. **Confirmed.**

**Snapshot:**
- `index_snapshot = minted_total` at creation. Vaults minted after can't vote (`VaultTooNew`). ✓
- `quorum_supply = minted_total - burned_total - bare_burns_retired` at creation. Divisor is the snapshot, not `max(snapshot, live)`. ✓
- Suite G.6, G.7, P.29 confirm. **Confirmed.**

**Key change unbundling:**
- `KeyChangesBundled` prevents `Brakes{set_guardian:true}` + `ArmSwapOperator` in one proposal. Suite 3c.K1 confirms. **Confirmed.**

**Skip logic:**
- Overtaken actions are skipped and logged `CBOB_ACTION_SKIPPED`, not reverted. The rest of the bundle lands. Suite 7.26, E.2, 3c.R1, 3b.S1 confirm. **Confirmed.**

**Guardian replacement:**
- Armed, not set. Lands after `notice_secs` via permissionless `apply_guardian`. Guardian in office can't cancel its own replacement. Suite 3c.G1, 3c.G2, 6c.15a confirm. **Confirmed.**

**Verdict: No defect found in governance.**

---

## R5 — Charter Claim

I checked the Merkle proof, PoB burn, window, and pass-through accounts.

**Merkle proof:**
- Leaf: `sha256(0x00 || pubkey)`. Node: `sha256(0x01 || min(a,b) || max(a,b))`. Domain-separated, sorted. No second-preimage. ✓
- JS (`scripts/pob-merkle.mjs`) and Rust implementations match. Suite verifies proofs against the committed root. Probe re-derives root from mainnet. **Confirmed.**

**PoB burn:**
- CPI burn of the PoB as its owner, in the same instruction. PoB must be owned by the signer, in the correct collection, and a leaf of `pob_root`. Suite C.2–C.12 confirm. **Confirmed.**

**Window:**
- `charter_opens_at` and `charter_closes_at` fixed at `initialize`. Outside window → `CharterNotOpen` / `CharterClosed`. Not gated by guardian's sales stop (ruling). Suite C.1, C.15 confirm. **Confirmed.**

**Pass-through accounts (`pob_extra`):**
- Up to 8 extra accounts passed to Core's burn, never as signers. For external plugin hooks (Oracles). Suite OR.1–OR.6 confirm. **Confirmed.**

**Hot wallet risk (accepted limit 46):** The Giraffish Moments update authority can brick claims during the window. Acknowledged, not a new finding.

**Verdict: No defect found in the charter claim.**

---

## R6 — One-Time Configuration and Trusted Hop

I checked every `initialize` parameter and the sweep bounds.

**MINT `initialize`:**
- Requires `INIT_AUTHORITY` (compile-time constant, Gary's wallet on mainnet).
- Collection must be clean (no plugins, never minted), owned by MINT's PDA.
- Royalty plugin installed with authority `None` (immutable). Suite R.1–R.6c confirm nothing can change it.
- SEAL config checked for matching collection and payment mint as reserve.
- Boost bounds checked (`1..=12` weight, `1..=63` epochs).
- Charter window validated (closes > opens, ≤ 90 days, not already over).
- `last_distribute_at = max(now, charter_closes_at)` prevents early free distribution.
- **All checks present. No bypass found.**

**BURN `initialize`:**
- Requires `INIT_AUTHORITY`. SEAL config checked for matching collection. `redeem_window_secs` in `[10, 86400]`. **Confirmed.**

**GOV `initialize`:**
- Requires `INIT_AUTHORITY`. MINT config checked for matching collection. Quorum `[500, 10000]`, threshold `(5000, 7500]`, voting period `[60, 2592000]`. **Confirmed.**

**SEAL `initialize`:**
- Requires `INIT_AUTHORITY`. Reserve mints 1–3, each passed as account and checked for classic SPL ownership. **Confirmed.**

**Trusted hop (`sweep_sol_for_swap`):**
- Destination pinned to `swap_operator`. Amount ≤ `max_sweep_lamports`. Cooldown enforced. Reserve maintained. Operator must sign. Guardian can stop. Vote can only tighten within `initialize` bounds. Suite 6.15–6.19b, 8.7–8.10 confirm. **Confirmed.**

**Verdict: No defect found in configuration or trusted hop.**

---

## R7 — Cross-Program Raw Reads

I recomputed every offset from the struct definitions.

**MintConfig (version 6):** All 14 offsets read by GOV and BURN match the struct layout. I verified: `minted_total` (141), `bare_burns_retired` (454), `governance` (41), `collection` (9), `sales_stopped` (191), `sweep_stopped` (192), `sales_stopped_at` (518), `sweep_stopped_at` (526), `sweep_floor_lamports` (631), `cooldown_ceiling_secs` (639), `reserve_ceiling_lamports` (647), `max_boost_weight` (711), `max_boost_epochs` (712), `charter_closes_at` (442), `sol_reserve_lamports` (257), `max_sweep_lamports` (266), `sweep_cooldown_secs` (274). **All correct.**

**BurnConfig (version 4):** `burned_total` at offset 42. **Correct.**

**VaultRecord (version 4):** `mint_index` at offset 41, `asset` at offset 9. **Correct.**

**SEAL Config (version 2):** `collection` at offset 9, `reserve_mints` Vec at offset 41. **Correct.**

**Discriminators:** All 12 pinned discriminators (4 account discriminators, 8 instruction discriminators) are asserted against `sha256("global:<name>")` / `sha256("account:<Struct>")` in the suite. Suite 3.1a–3.1y, BO.29 confirm. **Correct.**

**Verdict: No offset or discriminator error found.**

---

## R8 — Suite, Simulation, and Build as Evidence

I checked for arms that cannot fail, wrong-reason rejections, and build provenance.

**Assertion floors:** `run-tests.sh` enforces `MIN_ASSERTIONS=895` with equality (not just ≥). Detector selftest floor 925, allocation 39, poster 24, launch 49, pob-merkle 14, host unit tests 6, expiry-budget 4, sim floor 71. All floors require exact match. **No slack.**

**Wrong-reason rejections:** The `because()` helper pins specific error codes/names for negative arms. Suite arms use `att()` / `attP()` which extract error logs. Round 36 added reason pins for R36.G2a/b and R36.C5. **Reasonable coverage.** Seven arms (R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8) still lack `because` pins (noted in round 37 A5). This is a strengthening opportunity, not a defect.

**Build provenance:** `scripts/build-mainnet.sh` builds both mainnet and localnet, deploys both to a validator, and asks each whether it trusts the test key. Mainnet must REJECT, localnet must ACCEPT. The sweep helper's mainnet bytes are cmp'd against the tested localnet bytes and `target/deploy`. **Confirmed.**

**Unexercised refusals:** Round 37 A4 lists several unexercised branches (delegated helper source, native wSOL source, duplicate destination, `BadClaimList` > 30, `WrongAsset` on reveal/boost, `ReserveHasExtensions` in BURN's second loop, rescue host branches). These are coverage gaps, not defects. The code for each branch reads correctly.

**Verdict: The suite is well-constructed. No false-pass arms found.**

---

## Accepted Limits Review

I checked each accepted limit against the code.

1. **Is any limit worse than stated?** No. Each limit's code path matches its description. The completeness gap (limits 9, 44) is genuinely unenumerable on-chain. The rate limit (32) ring-bound at 64 is correctly stricter for large supplies. The Core upgrade risk (40) is accurately described.

2. **Is anything listed as a limit not actually a limit?** No. All listed limits correspond to real code paths or acknowledged design decisions.

3. **Is any DISCHARGED item not actually discharged?** No. The Bank-related items (1a–5, 11, 15, 16, 18, 20, 21, 23, 24) are genuinely gone with the Bank. The boost (51), compute (12/17, 54), and other discharged items have corresponding test coverage.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are explicitly OPEN. The three OPEN values in `launch/mainnet-init.json` (`vault_collection`, `charter_opens_at`, `lock_deadline`) would cause `check-launch-params.mjs` to refuse. The holder guide is marked DRAFT and cannot be published before item 50 closes.

**Verdict: The accepted-limits list is accurate.**

---

## New Findings

**None at CRITICAL, HIGH, or MEDIUM severity.**

After independent review of all five programs, the sweep helper, the web pages (post-repair), the launch configuration, and the test suite, I found no new defect that moves value, breaks the seal, mis-accounts the pool, bypasses governance, or corrupts the level draw.

**LOW / INFO observations (not defects, noted for completeness):**

- **INFO-1:** Seven negative suite arms lack `because` reason pins (R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8). Adding pins would strengthen the wrong-reason defence. Not a security issue.
- **INFO-2:** Several refusal branches listed in round 37 A4 remain unexercised by the suite. The code reads correctly for each. Adding arms would improve coverage. Not a security issue.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The AI audit process has been thorough across 38 rounds, three red-team passes, and extensive measurement. The programs appear sound. However, AI audit structurally cannot do the following, and these should be completed before launch:

1. **Run the mainnet dress rehearsal (item 22).** The crank, alarm, and revenue cycle have never run against a live cluster with ~2,100 vaults. The rehearsal must include one full live revenue cycle through both pools (Orca and Meteora) and one forced post-sweep failure walked through hand recovery. This is the single largest remaining gap.

2. **Fill the three OPEN launch values (item 38).** `charter_opens_at`, `lock_deadline`, and `vault_collection` must be set and verified by `check-launch-params.mjs` before any `initialize` is signed. A wrong value is permanent.

3. **Publish the holder pages (item 50).** The redeem page's `judgeRedemptionCoverage` is the only pre-signature check for undeclared holdings. Until it is published, limits 9 and 44 have no preventive control in production. The holder guide (DRAFT) must not be published before the pages are live.

4. **Create the pool and Squads cbBTC accounts and fund the revenue address (item 52).** Until these exist, `split_revenue` and `distribute` will fail. Road step 10 must create them idempotently before the first paid mint.

5. **Re-run `scripts/rehearsal-tree.sh` at the release commit (item 53).** The existing proof is at `d57ee3a` and is stale. The full `run-tests.sh` must pass inside the rehearsal tree at throwaway ids before the dress rehearsal.

6. **Remove the upgrade authority from all five programs (road step 11) only after all of the above pass.** This is the point of no return. The order of operations in DESIGN-v6 must be followed exactly.

7. **Establish a human-run operational runbook for the swap operator key compromise, guardian key compromise, and Core upgrade scenarios.** The alarm detects but cannot prevent. A human must be able to reach the guardian wallet and pull `emergency_stop_sweep` / `emergency_stop_sales` within minutes. This is a process, not a code, requirement.

The programs are ready for the dress rehearsal. The remaining work is operational, not programmatic.