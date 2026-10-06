# Round 29 Independent Audit Report

## R0. Round 28 Verdict Verification

Round 28 was **NOT CLEAN** with **incomplete quorum** (5/8 auditors counted; 6 required). I independently verified its confirmed findings against the frozen tree:

**M1 (MEDIUM) — Runtime log truncation in `txread.mjs`**: I read the code at `bank/txread.mjs:78`:
```javascript
need(!meta.logMessages.includes('Log truncated'), 'logs truncated by runtime')
```
This **refuses** truncated logs, not accepts them. The finding's premise appears contradicted by the code. The valid v1 fixture at `tests/fixtures/mainnet-v1.json` does not contain the marker, so the refusal path is exercised by the reader regression tests. I treat this as a **false positive** unless the off-chain pass identified a different code path. The shared off-chain M1 may refer to a different aspect of the same file, but the programs-side claim as stated is unsupported.

**L1 (LOW) — Bundled Token-2022/ATA byte differences**: Confirmed. The pinned mainnet binaries differ from the locally bundled ones. This is a dependency-evidence gap, not a CBOB behavior failure. The program IDs and executable presence are correct; only the byte-level provenance is unverified for these two programs.

**D1-D3 (INFO) — Documentation drift**: Confirmed. SPEC's opening paragraph, "Where this stands" section, and several doc siblings contain stale references. These are real but non-behavioral.

**Round 28 programs pass quorum**: 5 of 8 auditors completed; 6 required. The pass cannot count toward convergence. The clean-round counter remains **0/2**.

---

## R1. Custody: Can Anyone but the Owner Get Value Out?

### SEAL ↔ BURN Pairing

I verified the bidirectional binding at both programs:

**SEAL** (`open_for_redemption`, lines 167-196): walks `load_instruction_at_checked(i, ...)` for `i ∈ (current, end)`, requires `ix.program_id == BURN_PROGRAM_ID`, discriminator match, `ix.accounts[0].pubkey == asset`, `ix.accounts[2].pubkey == owner`.

**BURN** (`burn_vault`, lines 188-210): walks `i ∈ [0, current)`, requires `ix.program_id == SEAL_PROGRAM_ID`, discriminator match, `ix.accounts[0].pubkey == asset`, `ix.accounts[2].pubkey == owner`.

Both use `load_instruction_at_checked`, which sees **top-level instructions only** (CPI-buried instructions are invisible). Both bind **asset AND owner**. Neither can be borrowed from another vault's redemption sharing the transaction. **Sound.**

### Emptiness Proof

BURN's emptiness proof (`burn_vault`, lines 212-260) checks:
- `asset_signer.lamports() == 0`
- For each reserve mint × both token programs: derived ATA must be declared, PDA-owned, undelegated (`d[72..76]`, `d[121..129]`, `d[129..133]`), extension-free (`d.len() == 165`), amount == 0
- No declared account is a live Core asset (`d[0] == KEY_ASSET_V1`)
- Any remaining PDA-owned token account of length ≥ 165 is also checked for emptiness

The delegate/close-authority offsets (72, 121, 129) are correct for the classic SPL `Account` layout. The `TOKEN_STATE_OFF = 108` offset is correct.

**No defect found.**

---

## R1s. Sweep Helper

### (a) Access Control

The sweep helper's only signer check is `signer.is_signer`. When called through Core's `ExecuteV1`, Core signs as the asset-signer PDA. Core's authority rule (SPEC item 40, measured at Core `e72d63e`) approves Execute only for `authority == owner`; the collection abstains; the only plugin route that approves anyone else (AgentIdentity) cannot be added by an owner (requires collection update authority). **Sound today**, but depends on Core behavior we don't control (accepted limit 40).

### (b) Pair List

- Same source twice: first iteration closes it; second iteration's `read_token` fails (owner is no longer SPL Token). Transaction reverts. **Safe.**
- Source == destination: transfer is a no-op, then close. **Harmless.**
- Source is native wSOL: `read_token` accepts it (classic SPL, 165 bytes). Transfer moves it. **Correct.**
- Source has delegate/close authority: `read_token` doesn't check these; the token program's transfer uses the owner's authority (the PDA signs through Core). **Correct.**
- Account is frozen: token program refuses transfer; whole redemption reverts. **Correct.**
- Destination is not an ATA: `read_token` only checks owner and mint, not derivation. Any account owned by the destination wallet with the same mint is accepted. **Correct.**
- Destination is the vault wallet: refused by `signer.key == dest.key` check. **Correct.**
- Destination is another vault's asset-signer: `read_token` would accept it if it's a token account. But the lamport sweep sends lamports to `dest`, which must be a system account. A PDA destination would fail the system transfer. **Correct.**
- Odd/zero pair count: refused by `(accounts.len() - 4) % 2 != 0` and `accounts.len() < 4` checks. **Correct.**

### (c) Destination Checks

The destination wallet is chosen by whoever builds the transaction. Given (a), only the owner can trigger the sweep, so the owner controls the destination. The program does not compare the destination with the asset's owner. **Safe by (a).**

### (d) Lamport Sweep

`signer.lamports()` is read at execution, after all token CPIs. The PDA's lamports are whatever remains after token transfers/closes. Nothing in the same transaction can add lamports to the PDA between the sweep and BURN's `lamports() == 0` check (BURN runs after the sweep). **Correct.**

### (e) Interaction with BURN's Emptiness Proof

BURN requires every reserve mint's ATA under **both** token programs to be declared. The sweep closes what it empties. A closed account passes BURN's check because:
- The first loop finds the derived ATA; if its owner is no longer SPL Token (closed), `acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID` is true, so it `continue`s (skips the emptiness check for that derivation).
- The second loop skips accounts with `lamports() == 0`.

A closed account has 0 lamports and is owned by the system program, so it's skipped by both loops. **Correct.**

If a reserve ATA doesn't exist when the page builds the transaction, the sweep can't name it, and BURN refuses `ReserveNotDeclared`. The page must create missing reserve ATAs in a prior transaction (item 42). A stranger can create a classic ATA for any owner permissionlessly, but the canonical ATA derivation is deterministic, so the stranger would have to create the exact canonical ATA. If they do, the sweep sweeps it (including any dust). **No vulnerability.**

A Token-2022 ATA for a classic mint: the ATA program refuses to create it (verified by mainnet probe). A non-ATA token account: the sweep only moves accounts the vault PDA owns; a non-ATA account owned by the PDA would be caught by BURN's second loop. A nested Core asset: undeclared nested assets are the documented gap (item 44).

### (f) Fit

S8.0 measures the three-asset redemption through the helper at 1,061 bytes (owner payer, no compute-budget instructions). With compute-budget pair (+52) and separate fee payer (+96), it's ~1,209 of 1,232. **Fits.** The measurement includes claim, open, sweep, burn. A real page adds crank accounts only if `pob_extra == 0` (item 37).

### (g) Evidence

SR.0-SR.4a in `tests/3prog.test.ts` and S8.* in the simulation exercise the helper. The `because` pins (SR.6-SR.14) are correct. The helper is deployed in the suite from the same bytes `scripts/build-mainnet.sh` proves (sha256 comparison in `build-mainnet.sh` lines 71-78).

**No defect found.**

---

## R2. Community Pool's Money

### Invariant: Pool Always Holds ≥ ceil(owed)

I verified the accounting in `distribute` (lines 1637-1679) and `credit` (lines 1784-1794):

- `avail = balance - ceil(owed_scaled / ACC_SCALE)`; distribution refuses if `avail <= 0`
- `delta = avail * ACC_SCALE / w`; `acc_scaled += delta`; `owed_scaled += delta * w`
- Since `delta * w <= avail * ACC_SCALE`, the new `ceil(owed / ACC_SCALE) <= balance`. **Invariant holds.**

Claims decrease both `owed_scaled` and pool balance by the same amount. **Invariant holds.**

### Counter Integrity

`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight` are updated atomically in `join`, `retire`, `activate`, `distribute`, `tick`, `advance_epoch`. I traced every path:

- `activate` (first call): `pending_count += 1`, `pending_this_epoch += 1`
- `activate` (second call) or `claim` (join): `pending_count -= 1`, `active_count += 1`, `total_active_weight += w`
- `retire` (active): `active_count -= 1`, `total_active_weight -= w`, `owed_scaled -= pending`
- `retire` (pending): `pending_count -= 1`, `pending_this_epoch -= 1` if same epoch
- `advance_epoch`: `pending_this_epoch = 0`, `boosts_due += boost_expiring[epoch % 64]`, `boost_expiring[epoch % 64] = 0`

All use `checked_arithmetic` (overflow aborts, fact 6). **No underflow/overflow found.**

### Liveness

`JoinWaitingFirst` prevents distribution while eligible vaults wait. The crank joins every eligible vault right after each distribution. `monthly_inline` waits for joins (`CBOB_MONTHLY_WAITS_FOR_JOINS`). **No permanent distribution block.**

**No defect found.**

---

## R2b. The $CBOB Boost

### Exact N Distributions

A boost bought in epoch `e` has `boost_end_epoch = e + epochs`. It earns from the next distribution (the one after purchase) until `dist_epoch >= boost_end_epoch`. The distribution that reaches `boost_end_epoch` makes it DUE; the next distribution is refused until it expires. It earns exactly `epochs` distributions. **Verified.**

### Weight Change Preservation

`reweigh` (lines 1806-1817) moves the owed share to `carry_scaled` and resets `debt_scaled = new_weight * acc`. Nothing is lost or gained. **Verified.**

### Ring Consistency

`boost_expiring[epoch % 64]` counts live boosts ending at that epoch. `boosts_due` counts due boosts. `boosts_active = sum(boost_expiring) + boosts_due`. I traced `unschedule_boost` (lines 1819-1830): if due, decrements `boosts_due`; else decrements `boost_expiring[end_epoch % 64]`. Always decrements `boosts_active` and `boost_weight_total`. **Consistent.**

### No Double Expiry

`expire_boost` requires `dist_epoch >= boost_end_epoch` and `boost_weight > 0`. After expiry, `boost_weight = 0` and `boost_end_epoch = 0`. A second expiry attempt is skipped by the `boost_weight > 0` check. **No double expiry.**

### No Early Expiry

`expire_boost` requires `dist_epoch >= boost_end_epoch`. **Cannot expire early.**

### No Distribution Impossibility

`BoostsExpireFirst` is checked in `distribute` and `monthly_inline`. The crank expires due boosts every pass. A vault whose token account is gone is skipped by `claim` (logged `CBOB_CLAIM_DEFERRED_FROZEN`), and `expire_boosts` doesn't need the token account. **No impossibility.**

**No defect found.**

---

## R3. The Level Draw

### SlotHashes Parsing

`blockhash_in_window` (lines 113-140) validates the sysvar key, bounds count ≤ 512, checks data length, rejects all-zero hashes, and finds the smallest produced slot in `[want, want + MAX_SKIPPED_SLOTS]`. **Correct.**

### Skipped-Slot Handling

`try_capture` (lines 227-259) calls `blockhash_in_window` three times, each starting at `slot/4 + ENTROPY_GROUP_STRIDE` leader groups after the previous found slot. If any hash is not found yet, returns `NotYet`. **Correct.**

### FIFO

`reveal_level` requires `index == revealed_total`. **Strict mint order.**

### Burned Vault at Head

A burned vault still takes its draw (L.11). The `burned` check in `reveal_level` skips the Core `UpdatePluginV1` CPI but still advances `revealed_total` and `level_minted`. **Correct.**

### Attribute Re-Supply Hash

`reveal_level` hashes the supplied attributes and compares against `attrs_hash` stored at mint. **Correct.**

### Minter/Crank/Slot Leader Influence

Slot hashes are public once produced. A minter who dislikes a draw can let it lapse for a re-roll, but only if nobody captures it for the whole window (accepted limit 25). C's leader can grind its own block (accepted limit 26). HOLDER-GUIDE.md states both honestly. **No defect.**

---

## R4. Governance

### Minority Carry

- Quorum: `cast >= ceil(snapshot * quorum_bps / 10000)` (ceiling, never zero)
- Threshold: `yes * 10000 / cast >= threshold_bps`
- Turnout: `yes >= ceil(snapshot * 1000 / 10000)`
- Key change: `yes >= ceil(snapshot * 5000 / 10000)`

All use ceiling division. At ruled numbers (quorum 21%, threshold 51%), the smallest passing vote is 10.71% YES, above the 10% turnout floor. **Sound.**

### Vote Reaching Money

GOV's only CPIs are into MINT, signed by the `["gov"]` PDA. MINT's governance-only instructions are: `set_round`, `restart`, `tighten_sweep`, `arm_swap_operator`, `apply_swap_operator`, `arm_guardian`, `apply_guardian`, `set_boost_terms`, `cancel_swap_operator`. None touch the 85/15 split, destinations, `max_supply`, or royalty (all fixed at `initialize`). **Sound.**

### Governance Freeze

A stolen guardian can stop sales and the sweep, and re-stop after each restart vote. Replacement needs YES from half of ALL live vaults (snapshotted at creation) plus 7 days' notice. At turnout below half, the stop is permanent (accepted limit 47). HOLDER-GUIDE.md states this. **No worse than documented.**

**No defect found.**

---

## R5. Charter Claim

### Merkle Verification

`merkle_leaf` = `sha256(0x00 || pubkey)`, `merkle_root_from` = sorted `sha256(0x01 || min || max)`. The JS `pob-merkle.mjs` uses identical scheme. Domain-separated tags prevent leaf/node replay. **Correct.**

### Window

`claim_charter_vault` checks `now >= charter_opens_at && now < charter_closes_at`. Not gated by guardian (ruling 48). **Correct.**

### PoB Burn Pass-Through

`pob_extra` accounts are passed to Core's burn, never as signers. Tested against a real Core Oracle plugin (OR.4-OR.6). **Correct.**

### Hot Wallet (SPEC 46)

The Giraffish Moments update authority can add an external plugin that Core consults on every burn. Mitigations: pass-through accounts (so a benign hook can't brick claims) and alarm on any plugin/authority change. The alarm samples once per pass (30 min), so a hook added and removed between passes is not paged (accepted limit 46). **No worse than documented.**

**No defect found.**

---

## R6. One-Time Configuration

### Initialize Checks

I verified every `initialize` check in MINT (lines 133-252):
- INIT_AUTHORITY signature
- $CBOB mint: classic SPL, initialized, not payment_mint or GARY_MINT
- Boost bounds within absolute limits
- max_supply > 0, bank_treasury ≠ default, notice_secs in bounds
- Sweep bounds within absolute limits and consistent with installed values
- level_caps non-zero, sum ≤ max_supply
- Charter window valid, not already closed, ≤ 90 days
- pob_root ≠ zero, pob_collection ≠ default
- monthly_secs in bounds
- Collection: clean, unminted, update authority = MINT's PDA
- SEAL config: matches collection, holds payment_mint as reserve

**All correct.**

### Swap Operator Bound

`sweep_sol_for_swap`: amount > 0, ≤ max_sweep_lamports, cooldown elapsed, doesn't breach sol_reserve_lamports, operator must sign, guardian can stop. **Worst case: cap × cooldown windows until guardian stops (accepted limit 10).**

### Royalty Plugin

ROYALTY_BPS = 1000 (10%), plugin authority PLUGIN_AUTHORITY_NONE (0). Core refuses all updates/removals. Verified by control (R.6/R.6a). **Immutable in Core.**

### Redemption Cap

Ring of 64 timestamps, `rate_head` monotonic. Cap = `min(ceil(live × 210 / 10000), 64)`. Check: `now - ring[(head - k) % 64] >= redeem_window_secs`. **Exactly a rolling window.**

**No defect found.**

---

## R7. Cross-Program Raw Reads

I recomputed every offset from the struct definitions:

| Reader | Account | Field | Offset | Verified |
|--------|---------|-------|--------|----------|
| GOV | MintConfig | governance | 41 | ✓ |
| GOV | MintConfig | minted_total | 141 | ✓ |
| GOV | MintConfig | bare_retired | 454 | ✓ |
| GOV | MintConfig | charter_closes_at | 442 | ✓ |
| GOV | MintConfig | sol_reserve | 257 | ✓ |
| GOV | MintConfig | max_sweep | 266 | ✓ |
| GOV | MintConfig | cooldown | 274 | ✓ |
| GOV | MintConfig | sales_stopped_at | 518 | ✓ |
| GOV | MintConfig | sweep_stopped_at | 526 | ✓ |
| GOV | MintConfig | sweep_floor | 631 | ✓ |
| GOV | MintConfig | cooldown_ceiling | 639 | ✓ |
| GOV | MintConfig | reserve_ceiling | 647 | ✓ |
| GOV | MintConfig | max_boost_weight | 711 | ✓ |
| GOV | MintConfig | max_boost_epochs | 712 | ✓ |
| GOV | VaultRecord | mint_index | 41 | ✓ |
| GOV | BurnConfig | burned_total | 42 | ✓ |
| BURN | MintConfig | minted_total | 141 | ✓ |
| BURN | MintConfig | bare_retired | 454 | ✓ |
| BURN | SEAL Config | collection | 9 | ✓ |
| BURN | SEAL Config | reserves | 41 | ✓ |
| MINT | SEAL Config | collection | 9 | ✓ |
| MINT | SEAL Config | reserves | 41 | ✓ |
| Sweep | Token account | mint/owner/amount | 0/32/64 | ✓ |

All discriminators pinned and asserted. **No misreads found.**

---

## R8. Suite, Simulation, and Build as Evidence

### Arms That Cannot Fail

I examined the `because` pins. Each pins a specific error variant that the program actually emits. The error enum variants exist and are reachable. **All pins are valid.**

### Claims No Arm Exercises

- The M1 runtime-log truncation finding: the refusal code exists and is tested by the reader regression suite. The finding's premise (that truncated logs are accepted) is contradicted by the code.
- The L1 dependency-byte finding: the suite's `token_programs_verify` checks the validator's loaded bytes against pins after startup, but the pins themselves may differ from mainnet. This is a real gap, not a false positive.

### Mainnet Bytes Proven

`scripts/build-mainnet.sh` compares `dist/` vs `target/deploy/` for all five programs, including the sweep helper. The sweep helper has no `localnet` feature, so its mainnet and localnet builds are byte-identical (verified by `cmp`). **Sound.**

---

## Accepted Limits: Four Questions

### 1. Any Limit Worse Than Stated?

**No.** I re-read every accepted limit against the code. The stated bounds hold. The only residual risk is the Core size boundary (round 28, R28.A2): an owner-managed Autograph plugin with ~10 KB of signatures creates a vault Core cannot shrink. This is now pinned in SPEC item 40 and HOLDER-GUIDE. It is **not worse than stated**; it is a measured boundary.

### 2. Anything Listed as a Limit Not Actually a Limit?

**No.** All accepted limits are real and exploitable within their stated bounds.

### 3. Any Discharged Item Not Actually Discharged?

**No.** I verified the discharged items:
- Items 1a, 1b, 2-5, 11, 15, 16, 18, 20-21, 23-24: the Bank key, co-signer, deck, and distributor are deleted from v6. **Gone.**
- Item 14 (duplicate attributes): closed by `DuplicateAttribute` refusal. **Discharged.**
- Item 19 (unlevelled vault halt): closed by construction (`activate` requires `NotRevealed`). **Discharged.**
- Item 30 (85/15 vote): `update_wiring` deleted. **Discharged.**
- Item 31 (31-day branch): cadence deleted. **Discharged.**
- Item 33 (operator notice): `notice_secs` is an `initialize` value; `apply_swap_operator` is exercised. **Discharged.**
- Item 51 ($CBOB boost): built and measured. **Discharged.**
- Item 54 (compute): measured. **Discharged.**

### 4. Any OPEN AND BLOCKING Item Quietly Treated as Accepted?

**No.** Items 22 (live distribution/revenue rehearsal), 38 (launch values), 50 (holder surfaces), 52 (account creation), 53 (dress rehearsal) remain OPEN. Item 38's charter opening date and lock deadline are still OPEN in `launch/mainnet-init.json`. **Correctly tracked.**

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

### What This Project Must Do Before Launch That AI Audit Structurally Cannot

1. **Byte-exact reproducibility verification.** AI can read code; it cannot prove that the compiled artifact deployed to mainnet is the artifact the suite ran. `scripts/build-mainnet.sh` proves this for the current commit, but a human must independently rebuild from the release commit and confirm the sha256 values match. **This is a ceremony, not a test.**

2. **The dress rehearsal (item 22) must be run by a human at the terminal against a throwaway deployment, with real transactions signed by real keys, and the transaction signatures recorded.** AI can reason about the crank's I/O; it cannot observe a live cluster with ~2,100 vaults and confirm the crank keeps up, the alarm pages correctly, and the hand recovery path works.

3. **The launch values (item 38) must be read aloud from `launch-mainnet-init.json` to a second human who independently confirms each value against Gary's rulings before the `initialize` transactions are signed.** AI can check the JSON; it cannot be the second pair of eyes in a ceremony.

4. **The holder surfaces (item 50) must be built and tested by a human clicking through the actual flow: claim, deposit, activate, vote, redeem.** AI can read `judgeRedemptionCoverage`; it cannot confirm the page renders the warning before the holder signs.

5. **The upgrade authority removal (road step 11) must be witnessed by a human who confirms `solana program show` reports no upgrade authority for all five programs.** AI can describe the command; it cannot be the one who runs it and takes responsibility.

6. **A manual key ceremony for the swap operator, guardian, and $CBOB release wallet keys, with air-gapped generation and multisig custody where ruled, recorded on video.** AI cannot generate or witness key generation.

7. **A final read of HOLDER-GUIDE.md against the deployed programs by a human who is not the author, confirming every plain-English promise is true of the on-chain bytes.** AI can compare text to code; it cannot be the independent reader the holders deserve.

---

## Summary of Findings

| ID | Severity | Target | Description |
|----|----------|--------|-------------|
| — | — | — | **No CRITICAL or HIGH findings.** |
| R28-M1 | MEDIUM (disputed) | Off-chain | Runtime log truncation finding appears contradicted by code; likely false positive. |
| R28-L1 | LOW | Off-chain | Bundled Token-2022/ATA byte differences; pin actual mainnet binaries. |
| R28-D1 | INFO | Docs | Stale SPEC references to multi-model rounds and v5 figures. |
| R28-D2 | INFO | Suite | C.13 and 7.6 add no distinct state evidence; replace with stopped-sales charter count and exact YES/NO delta. |
| R28-D3 | INFO | Docs | DESIGN/MINT/BOOST doc siblings have stale permission and deleted-cadence text. |

**The program logic is sound.** The four vault programs and sweep helper implement the design as specified. The accepted limits are complete and honestly stated. The remaining work is ceremony, live rehearsal, and holder surfaces—none of which AI can perform.