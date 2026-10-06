# Independent Security Audit — CBOB Vaults v6 (Round 27, Programs)

## R0. ROUND 26 VERDICT VERIFICATION

I independently verified the round 26 repairs against the current tree.

**C1 (RL.7 cap certification):** The repair at `tests/3prog.test.ts:206-214` now uses `getMultipleAccountsInfo([MINT_CFG, BURN_CFG])` for coherent snapshots and interval-based cap certification with monotonicity checks. The `stampCaps` function correctly rejects ambiguous intervals and backward counters. **Repair holds.**

**C2 (P.11a fixture):** `LEVEL_CAPS` is now `[21,21,21,21,21]` (total 105), with `CAP_TOTAL - cands.length <= 20` checked against `Math.min(...LEVEL_CAPS) > CAP_TOTAL - cands.length`. The pigeonhole argument holds: with at most 20 excluded fixtures and 21 per level, every level has an eligible vault. **Repair holds.**

**C3 (SR.12a reason pin):** The suite now includes `SR.12b` checking that the duplicate-source refusal did NOT produce the first-pair `CBOB_SWEEP refused: source` message. **Repair holds.**

**D1-D4 (documentation):** Guide wording, comment counts, pending-state documentation, and limit 42 qualification are corrected. **Repairs hold.**

**Quorum note:** Round 26 was 5/8 (not clean). The repairs do not retroactively clear it. The consecutive clean-round counter correctly remains 0/2.

---

## R1. CUSTODY

**No CRITICAL or HIGH defect found.**

I verified the open/burn pairing in both directions:

- SEAL walks forward from `current + 1`, requiring a top-level `burn_vault` for the same asset AND owner. The walk fails closed (any error leaves `found = false`).
- BURN walks backward from `0..current`, requiring a top-level `open_for_redemption` for the same asset AND owner.
- Both bind asset at index 0 and owner at index 2.
- The CPI wrapper attack is prevented by `retire_redeemed`'s stack-height check (`TRANSACTION_LEVEL_STACK_HEIGHT + 1`).

I verified the emptiness proof:
- PDA lamports must be 0.
- Every reserve mint's ATA (both token programs) must be declared.
- Token accounts are checked for PDA ownership, no delegate, no close authority, no extensions, zero balance.
- Core assets are refused.
- The second loop catches non-reserve token accounts owned by the PDA.

I verified that a thawed vault cannot leave the transaction unburned: if the burn fails, the entire transaction reverts, including the thaw.

**Evidence that would exist if I were wrong:** A transaction that thaws a vault without burning it would leave the asset with `frozen: false` and its contents intact. The suite arms 3.6, 3.8, 3.9, 3.10, WR.1-WR.4 all test this.

---

## R1s. SWEEP HELPER

**(a) Access control:** The helper requires `signer.is_signer`. The signer is the asset-signer PDA, which only Core can sign for (through ExecuteV1). Core's ExecuteV1 approves only the asset's owner (measured in SR.5, SR.5a, SR.5c). The collection update authority is refused (SR.5c). **Sound.**

**(b) Pair list:** I verified:
- Same source twice: first iteration closes it, second iteration fails `read_token` (system-owned after close). Tested in SR.12a.
- Same destination twice: both transfers succeed, destination receives both amounts. Benign.
- Source is also destination: impossible because `src_owner == signer.key` and `to_owner == dest.key`, and `signer.key != dest.key` is checked.
- Native wSOL: read as classic SPL, handled correctly.
- Delegate/close authority: not checked by helper, but BURN checks for reserves. Non-reserve accounts with delegates are swept (owner's choice).
- Frozen account: transfer fails, whole transaction reverts. Tested in SR.14.
- Destination not ATA: helper doesn't require ATA, just same-mint and correct owner. This is by design (allows non-ATA destinations).
- Destination wallet is asset-signer: refused by `signer.key == dest.key` check.
- Destination wallet is another vault's asset-signer: allowed. Lamports would go there. This is the owner's choice; the recipient vault can still redeem (sweep helper sweeps all lamports).
- Zero pairs: lamports-only sweep. Tested in SR.13.

**(c) Destination checks:** The destination wallet is not compared to the asset's owner. This is safe because only the owner can trigger the sweep (per (a)). The owner can send their own funds anywhere.

**(d) Lamport sweep:** `signer.lamports()` is read at execution time. The transfer empties the PDA to zero. No later instruction in the same transaction can re-fund it (the transaction is atomic; if the burn fails, the thaw reverts). BURN's `lamports == 0` check sees exactly what the sweep left.

**(e) Interaction with BURN:** The sweep closes accounts it empties. BURN's reserve check skips closed accounts (system-owned). A reserve ATA that doesn't exist when the page builds the transaction: the page must create it in a prior transaction (item 42). If a stranger creates it between the page build and the redemption, the sweep can't name it (it wasn't in the pair list), and BURN would see it with a non-zero balance and refuse. The page's prior-transaction creation prevents this.

**(f) Packet:** S8.0 measures 1,061 bytes for the three-asset redemption through the helper. With compute-budget (+52) and separate payer (+96), the widest shape is ~1,209 bytes, fitting in 1,232. **Fits.**

**(g) Evidence:** SR.0-SR.4a, SR.5-SR.14, S8.0-S8.3 all exercise the helper. The helper is deployed from the same bytes `scripts/build-mainnet.sh` proves (cmp against `target/deploy` and localnet rebuild).

---

## R2. COMMUNITY POOL

**I verified the invariant "the pool always holds at least ceil(owed)".**

- `credit`: `delta = floor(avail * ACC_SCALE / w)`, `owed += delta * w`. Since `delta * w <= avail * ACC_SCALE`, the invariant holds.
- `claim`: pool balance decreases by `pay`, `owed` decreases by `pay * ACC_SCALE`. Invariant preserved.
- `retire`: `owed` decreases by `pending`, pool balance unchanged. Invariant preserved.
- `split_revenue`: pool balance increases, `owed` unchanged. Invariant preserved.

**Counters under all orderings:**

- `pending_count`: incremented on request, decremented on join or retire. No underflow path found.
- `pending_this_epoch`: incremented on request, reset to 0 on epoch advance, decremented on retire if request was in current epoch. No underflow path found.
- `active_count`: incremented on join, decremented on retire. Symmetric.
- `total_active_weight`: incremented by weight on join, decremented by weight on retire. Symmetric.

**Liveness:** I checked whether anyone can make distributions or redemptions impossible for others:
- `JoinWaitingFirst` prevents distribution while eligible vaults wait. Joining is free and permissionless. No permanent block.
- `BoostsExpireFirst` prevents distribution while boosts are due. Expiring is free and permissionless. No permanent block.
- A frozen pool blocks claims but not redemptions (forfeit path). No permanent lock.

**Round 24 W11 (revenue before join):** The SPEC's weaker rule is correct: a vault that joins can share revenue that was still UNSPLIT when it asked. This is accepted limit 55. The code matches the SPEC.

---

## R2b. $CBOB BOOST

**I verified: a boost earns EXACTLY its N distributions.**

A boost bought at epoch B with length L ends at epoch B+L. It earns distributions at epochs B+1 through B+L (L distributions). At epoch B+L, it becomes due. The next distribution is refused until it's expired. **Exactly N.**

**Nothing earned is lost or gained on weight change:** `reweigh` moves the owed amount to `carry` and resets `debt` at the new weight. `owed_of` after reweigh equals `owed_of` before. **Preserved.**

**Ring consistency:** The ring has 64 slots, max boost length is 63. I proved no two live boosts can map to the same ring slot with different end epochs (the difference would need to be a multiple of 64, but the range is bounded to (-64, 64), so only 0 is possible, meaning same end epoch). **Consistent.**

**No double-expiry:** After `expire_boost`, `boost_weight` is 0. `retire` checks `boost_weight > 0` before calling `unschedule_boost`. `expire_boosts` and `claim` check `boost_weight == 0` and skip. **No double-expiry.**

**No permanent distribution block from boosts:** Expiring is free and permissionless. `expire_boosts` needs only records. No token account required. **No block.**

---

## R3. LEVEL DRAW

**SlotHashes parse:** `blockhash_in_window` checks the sysvar key, bounds the count, verifies data length, and refuses all-zero hashes. **Correct.**

**Skipped-slot handling:** Finds the smallest produced slot in `[want, want + 64]`. Deterministic. **Correct.**

**FIFO:** `reveal_level` requires `index == revealed_total`. **Enforced.**

**Burned vault at head of queue:** The reveal still draws (level is assigned, census updated) but skips the Core write. **FIFO doesn't stop.**

**Attribute re-supply hash:** `attrs_hash` is checked against the Borsh-serialized list. **Correct.**

**Influence:** The minter can't choose (future slot hashes). The crank operator can't choose (permissionless capture). A slot leader (C's leader) can choose among many draws (accepted limit 26). **Matches SPEC.**

**HOLDER-GUIDE:** The guide states "the validator producing the last of those blocks can pick among several results." This matches SPEC 26. **Accurate.**

---

## R4. GOVERNANCE

**Minority carry:** I verified quorum (21% of snapshot), threshold (51% of votes cast), turnout (10% YES of snapshot), and key-change (50% YES of snapshot). At the ruled numbers, the minimum passing vote is 10.71% YES, above the 10% turnout floor. **No minority bypass.**

**Money reach:** Governance can only call `set_round`, `restart`, `tighten_sweep`, `arm_swap_operator`, `arm_guardian`, `set_boost_terms`. None of these touch the 85/15 split, the destinations, `max_supply`, the 10% royalty, or any vault. **Bounded.**

**Governance freeze:** A stolen guardian can stop sales and sweep permanently at low turnout (accepted limit 47). This is correctly documented. I checked whether it's worse than stated: the guardian can also cancel pending swap operators, but this doesn't add to the freeze capability. **Not worse.**

---

## R5. CHARTER CLAIM

**Merkle verification:** Domain-separated (0x00 leaf, 0x01 node), sorted pairs, odd-node promotion. The JS and Rust implementations match. **Correct.**

**CPI burn:** The PoB is burned as its owner in the same instruction. The owner must sign. **Correct.**

**Window:** Checked by clock comparison. No flag to flip. **Permanent.**

**pob_extra:** Up to 8 accounts passed through to Core's burn, never as signers. **Correct.**

**SPEC 46 completeness:** The SPEC states the hot wallet can (1) end the project by rejecting all claims, and (2) capture governance by admitting only its own PoBs. I checked whether there's anything else: the hot wallet cannot transfer or burn individual PoBs (Core's asset approves only the owner for transfer/burn). It can add plugins to the collection or individual assets. The alarm watches the collection but not individual assets. **SPEC 46 is complete for what the key can do.** The alarm gap (individual assets) is documented.

---

## R6. ONE-TIME CONFIGURATION

I verified all `initialize` checks:

- MINT: INIT_AUTHORITY, cbob_mint validity, boost bounds, supply, treasury, notice, sweep bounds, level caps, charter window, pob_root, monthly period, collection cleanliness, SEAL wiring.
- SEAL: INIT_AUTHORITY, reserve mints (classic SPL, 1-3), collection.
- BURN: INIT_AUTHORITY, SEAL wiring, redeem window.
- GOV: INIT_AUTHORITY, MINT wiring, quorum/threshold bounds, voting period.

**Wrong-but-accepted values:** The programs check less than the launch checker (SEAL reads only owners, not mint validity; off-curve keys are accepted). This is documented in item 38. The launch checker (`scripts/check-launch-params.mjs`) pins the ruled values. **Residual risk is the signed transaction not matching the JSON.** This is an operational concern, not a code defect.

**10% royalty:** Plugin authority is `None`. Core refuses updates and removals. Tested in R.3, R.6, R.6a. **Immutable.**

**Redemption cap:** Rolling window over 64-slot ring of timestamps. I verified the k-th most recent calculation and the window check. **Correct.**

---

## R7. CROSS-PROGRAM RAW READS

I recomputed every offset from the struct definitions:

**MintConfig (version 6):** All offsets used by GOV and BURN match my calculation (governance@41, minted_total@141, bare_retired@454, charter_closes@442, sales_stopped@191, sweep_stopped@192, sales_stopped_at@518, sweep_stopped_at@526, sweep_floor@631, cooldown_ceiling@639, reserve_ceiling@647, max_boost_weight@711, max_boost_epochs@712, sol_reserve@257, max_sweep@266, cooldown@274). **All correct.**

**SealConfig (version 2):** version@8, collection@9, reserves@41. **Correct.**

**VaultRecord (version 4):** version@8, asset@9, mint_index@41. **Correct.**

**BurnConfig (version 4):** version@8, collection@9, bump@41, burned_total@42. **Correct.**

**Sweep helper token reads:** mint@0, owner@32, amount@64, length 165. **Correct.**

---

## R8. SUITE, SIMULATION, BUILD

**Arms that cannot fail:** I checked the `because()` pins. Each negative arm has a reason pin that checks the error message. The `ID.1` arm verifies all assertion IDs are unique. **No vacuous arms found.**

**Arms refused for wrong reason:** The `because()` list pins specific error codes. I checked SR.12a (C3 repair) and the RL arms. **Pins are specific.**

**Claims not exercised:** The prompt's claim about Token-2022 ATA refusal is exercised by the mainnet probe. The claim about Core ExecuteV1 authority is exercised by SR.5-SR.5d. **All major claims have arms.**

**Build provenance:** `scripts/build-mainnet.sh` deploys both mainnet and localnet builds, asks each whether it trusts the test key, and compares the sweep helper's bytes. **Proven.**

---

## ACCEPTED LIMITS REVIEW

**1. Is any limit WORSE than stated?**

No. I checked each accepted limit against the code:
- Limit 28 (frozen pool): The forfeit path works as stated. Not worse.
- Limit 32 (rate limit): The rolling window is correct. Not worse.
- Limit 40 (Core upgrade): The three consequences are correctly stated. Not worse.
- Limit 46 (Moments hot wallet): The positive bound (can't transfer/burn individual PoBs) is correct. Not worse.
- Limit 47 (stolen guardian): The permanent stop at low turnout is correct. Not worse.

**2. Is anything listed as a limit not actually a limit?**

No. All listed limits are real.

**3. Is any DISCHARGED item not actually discharged?**

No. I checked item 51 ($CBOB boost), 54 (compute), 12/17 (compute units), 14 (duplicate attributes), 19 (unlevelled halt), 30 (85/15), 31 (31-day), 33 (replacement operator). All are correctly discharged.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No. Items 22, 38, 50, 52, 53 are all correctly marked as open and blocking. None are treated as accepted.

---

## FINDINGS

### LOW-1: Misleading error variant in `sweep_sol_for_swap`

**File:** `programs/cbob-vault-mint/src/lib.rs`, `sweep_sol_for_swap`

**Construct:** `require!(amount > 0, MintError::SweepAboveCap);`

**Issue:** The `SweepAboveCap` error variant has the message "this sweep is larger than the per-sweep cap in config", but it's used for both the zero-amount check and the above-cap check. A zero sweep is not "above the cap". This is a naming issue, not a correctness issue.

**Gain:** None. This is a diagnostic clarity issue.

**Evidence:** The error enum at the bottom of the file shows `#[msg("this sweep is larger than the per-sweep cap in config")] SweepAboveCap`. The suite arm 6.17b tests the zero sweep and expects `SweepAboveCap`.

**Fix:** Add a separate error variant (e.g., `SweepZeroAmount`) or rename the message to cover both cases. Since the programs are about to be immutable, this is cosmetic and not worth a code change unless other changes are being made.

### LOW-2: Sweep helper destination wallet unrestricted by design

**File:** `programs/cbob-vault-sweep/src/lib.rs`

**Construct:** The `dest` account (accounts[1]) is not checked against the asset's owner.

**Issue:** The destination wallet can be any address, including another vault's asset-signer PDA. If lamports are sent to another vault's PDA, that vault's burn would be blocked until the lamports are swept out (by that vault's own redemption). This is the owner's choice and doesn't create a security issue, but it's a grief vector.

**Gain:** An owner could grief another vault by sending lamports to its PDA. The grief is temporary (the recipient vault can still redeem).

**Evidence:** The helper code doesn't check `dest` against the asset owner. The suite doesn't test this specific case.

**Fix:** None needed. This is the owner's choice. The redeem page should warn if the destination is a vault PDA (item 50 obligation).

### INFO-1: `distribute` does not check pool freeze

**File:** `programs/cbob-vault-mint/src/lib.rs`, `distribute`

**Construct:** The explicit `distribute` reads the pool balance via `read_token` but doesn't check the freeze state.

**Issue:** With a frozen pool, `distribute` would proceed, increasing `owed_scaled`. Vaults would be owed more, but `claim` can't pay. This is by design (SPEC: "An explicit distribute is not refused for a frozen pool"). The `monthly_inline` correctly refuses to credit from a frozen pool.

**Gain:** None. This is documented behavior.

**Evidence:** The `read_token` function doesn't check freeze state. The `monthly_inline` function does check (`if d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN { return Ok(()); }`).

**Fix:** None needed. This is by design.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

The following are things AI audit structurally cannot do, and that must be done before launch:

### 1. Run the full dress rehearsal with real value (item 22)

AI can verify code logic but cannot verify that the crank, alarm, and revenue cycle work against a live cluster with real RPC latency, rate limits, and transient errors. The dress rehearsal must include:
- The crank's live passes against the rehearsal deployment
- One full live revenue cycle through BOTH pools (Orca and Meteora)
- One forced post-sweep failure walked through the hand recovery
- The alarm's live passes in rehearsal mode

### 2. Verify the physical security of all hot keys

AI cannot verify:
- The swap operator key (`bank/keys/swap-operator.json`)
- The $CBOB release wallet key (`bank/keys/cbob-release.json`)
- The guardian wallet (Gary's Phantom)
- The Moments collection update authority

These keys must be secured with hardware isolation, access controls, and monitoring. The $CBOB release wallet holding 2.1B tokens on a single box is the largest single-key risk.

### 3. Establish and test incident response procedures

AI cannot verify that humans will respond correctly under pressure. Before launch:
- Document who can pull the guardian stop and how
- Document the swap operator key compromise procedure
- Document the Core upgrade response procedure
- Run a tabletop exercise for each scenario

### 4. Verify external dependencies continuously

AI cannot verify that Metaplex Core, cbBTC, Orca, Meteora, and Pyth will behave as expected. The alarm watches these, but:
- Core upgrade detection must be tested against a real upgrade
- cbBTC freeze detection must be tested
- Pool program upgrade detection must be tested

### 5. Build the holder surfaces (item 50)

The redeem page, deposit address page, and redemption poster are not built. These are the only pre-signature checks for undeclared holdings. Until they exist, items 9 and 44 have no preventive control. The holder guide must not be published until these ship.

### 6. Verify the launch values against the signed transactions (item 38)

The launch checker validates the JSON, not the signed transactions. Whoever builds the four `initialize` transactions must build them FROM `launch/mainnet-init.json` and verify the on-chain values match after initialization. The charter opening date and lock deadline are still OPEN.

### 7. Remove upgrade authorities only after all gates pass

The upgrade authority must be removed from all five programs (four vault programs + sweep helper) only after:
- The dress rehearsal passes
- The holder surfaces are built
- The launch values are verified
- The pool and Squads accounts exist
- The revenue address is funded above rent

This is the point of no return. After this, every surviving bug is permanent.

### 8. Consider a bug bounty program

Even without a human audit firm, a bug bounty program would provide ongoing incentive for external researchers to find issues. The immutability of the programs makes post-launch fixes impossible, so pre-launch discovery is critical. A bounty program extends the discovery window.