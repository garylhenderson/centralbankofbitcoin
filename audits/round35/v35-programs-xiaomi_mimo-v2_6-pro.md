# Security Audit Report — CBOB Vaults v6 (whole tree)

## R0. Round 34's verdict and repairs

I independently verified round 34's six confirmed findings against the current tree:

- **M1 (ProgramData pre-funding)** — mitigated by claiming all five IDs on mainnet with an inert placeholder (recorded in `VALIDATION.md` and SPEC step 9). The placeholder's upgrade authority key `FZjLB4e9mVMZTWA6YR1KbXVbByTqWsHpHy5sK83yJYUY` is on the box. **Residual risk: if that key is lost before step 11, the five IDs hold inert code forever and every `declare_id!` must change** — a program change that resets the freeze. This is not stated in any accepted limit.

- **L1 (minter-chosen metadata)** — disclosed in SPEC item 57 and holder guide. Repaired as disclosure only.

- **D1, D3, D4** — rent figures, sweep-helper comment, and rehearsal-script wording all corrected in the current tree. Verified.

- **D2 (R33.G1 relabel)** — R33.G1 now says "the 640-byte-attribute shape with the largest autograph"; R34.G1a/b carry the full worst shape. Verified in `tests/3prog.test.ts`.

- **Gate 5 pins (R34.G1a/b, R34.G2, R34.G3, R34.G4)** — all present in the suite at the 871 floor. Verified.

Round 34's repairs hold. The clean-round counter correctly remains 0/2.

---

## R1. Custody

I attacked the open↔burn pairing from every angle in the target list.

**Pairing (CPI wrappers, two vaults, account-index binding, instruction-sysvar parsing):** Both halves use `load_instruction_at_checked` (top-level only), bind asset at index 0 and owner at index 2, and hard-code each other's discriminator. A CPI-wrapped open or burn is invisible to the walk. Two redemptions in one transaction pair correctly because each half matches on both asset AND owner. Measured by WR.1–WR.4 and 3.9/3.10/4.10. **No defect found.**

**Emptiness proof (Token-2022, delegates, close authorities, lamports, nested Core, declared-but-foreign):** The proof checks the reserve ATAs (both token-program derivations) for PDA ownership, no delegate, no extensions, and zero balance; checks `asset_signer.lamports() == 0`; and refuses any declared account that is a live Core asset. The second loop (non-reserve declared accounts) now mirrors the reserve loop's delegate and extension checks. **No defect found** beyond accepted limits 9 and 44 (undeclared holdings destroyed).

**Anything that lets a thawed vault leave unburned:** The open requires a matching burn LATER in the transaction; the burn requires a matching open EARLIER. The thaw reverts with a failed burn (tested 3.6, 3.8). **No path found.**

---

## R1s. The sweep helper

### (a) Access control
Core's `ExecuteV1` is the sole gate: only the asset owner can sign. Measured against the pinned Core binary (SR.5–SR.5d): a stranger, a transfer delegate, and a collection update authority are all refused `NoApprovals` (0x1a) on a genuinely thawed vault. The CBOB collection's update authority is MINT's off-curve PDA — no key exists. **Cannot be reached while frozen** (Core 0x9). Sound today; the residual is accepted limit 40 (Core upgrade).

### (b) Pair list
- **Same source twice:** refused after the first pair closes it (SR.12a: the zeroed owner ≠ signer).
- **Source is also destination / signer == dest:** refused at the top (SR.10).
- **Cross-pair aliasing** (source in one pair = destination in another): requires signer == dest, refused.
- **Native wSOL source:** works correctly (transfer + close unwraps to the destination).
- **Destination not an ATA:** allowed by design; the helper checks mint and owner only.
- **Destination wallet = another vault's PDA:** allowed. The helper sends tokens and lamports to whatever `accounts[1]` is. Since only the owner can trigger the sweep, this is the owner's choice (or a malicious page's — a client-trust issue, not a program vulnerability).
- **Odd/zero pair list:** odd refused (`NotEnoughAccountKeys`); zero pairs is the lamports-only sweep (SR.13).

### (c)–(d) Destination and lamport sweep
The destination is the transaction builder's choice; given (a), only the owner can trigger it. The lamport sweep empties the PDA to zero at execution time. Nothing in the same transaction can deposit afterwards (the burn follows immediately). BURN's `lamports == 0` sees exactly what the sweep left. **No defect.**

### (e) Interaction with BURN / missing reserve ATAs
A closed account (zeroed data, zero lamports) passes the reserve loop (owner field is zeros ≠ PDA) and the second loop (`lamports == 0` → skip). SPEC's prior-transaction step is sufficient: a stranger depositing between the prior tx and the redemption is swept by the helper (live balances). **Token-2022 ATA for a classic mint is refused** (measured F4.2). Non-ATA token accounts and nested Core assets are accepted limit 44.

**FINDING — LOW: Close-authority grief on a named sweep source.**
*Construct:* `programs/cbob-vault-sweep/src/lib.rs`, `process()`, the unconditional `IX_CLOSE_ACCOUNT` invoke (line ~55).
*Attack:* A griefer creates a classic SPL token account via `initialize_account3` (owner=self), calls `set_authority(AuthorityType::CloseAccount, self)` then `set_authority(AuthorityType::Account, vault_PDA)`, and funds it. The account now has owner=VaultPDA but closeAuthority=griefer. If the redemption page names this account in the sweep pair list (e.g., as a "stray classic token to rescue"), the helper transfers the tokens successfully but the close fails — `signer` (the PDA) is not the close authority — reverting the entire redemption.
*Gain:* One wasted transaction fee per attempt; the griefer's deposited tokens are permanently stranded. The vault remains sealed and can be redeemed by omitting the account from the pair list.
*Evidence:* A test creating such an account and sending a redemption naming it would show `Program Tokenkeg... failed: custom program error` at the close step; the same redemption without the pair lands.
*Fix:* The page (item 50) must read each named source's close-authority field (token-account bytes 129..133) and skip any account whose close authority is set and ≠ the vault PDA. The helper is immutable and cannot be fixed post-lock.

### (f) Packet fit
S8.0 measures claim+open+sweep(3 reserves)+burn at 1,061 bytes (owner as fee payer, no compute-budget ixs). Adding both compute-budget instructions (+52) and a separate fee payer (+96) gives ~1,209 of 1,232. **One extra sweep pair adds ≥64 bytes and does not fit** in the widest shape. The page must not add stray-token pairs in the widest variant, or must use a narrower shape. SPEC says "mind the packet" but does not quantify the headroom (23 bytes) — this is worth stating explicitly in the client contract.

### (g) Evidence
SR.0–SR.4a, SR.5–SR.5e, SR.6–SR.14 cover every refusal branch, Core access control, and the live-balance race. S8.0/S8.1a cover the three-asset redemption. The helper's mainnet bytes are proven identical to the deployed ones (`build-mainnet.sh`). **No arm that cannot fail found.**

---

## R2. The community pool

**Invariant "pool always holds ≥ ceil(owed)":** I traced every mutation of `owed_scaled` and the pool balance:
- `credit` adds `delta·w ≤ avail·ACC_SCALE` to `owed_scaled` where `avail = balance − ceil(owed)`, so `ceil(owed_new) ≤ balance`.
- `claim` reduces `owed_scaled` by `pay·ACC_SCALE ≤ pending` per vault (the remainder stays in `carry_scaled`).
- `retire` reduces `owed_scaled` by `pending` (pool balance unchanged — invariant more likely to hold).
- `reweigh`/`expire_boost` preserve each vault's owed (moved to `carry_scaled`) without touching `owed_scaled`.
- `join` sets owed to 0 (no change to `owed_scaled`).

All arithmetic uses `checked_*` with `overflow-checks = true`. `acc_scaled` is monotonically non-decreasing, so `owed_of`'s `checked_sub` cannot underflow. **The invariant holds.**

**Counters (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`):** Traced every increment/decrement site. `retire` correctly decrements `pending_this_epoch` only when `request_epoch == dist_epoch`. `advance_epoch` resets `pending_this_epoch` to 0 after incrementing `dist_epoch`. The host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` and suite `books()` verify consistency over 260 epochs. **No drift found.**

**Liveness:** `JoinWaitingFirst` and `BoostsExpireFirst` can block distributions, but both are clearable by anyone (free `claim` and `expire_boosts`). A vault with a missing/frozen token account does not block `expire_boosts` (records only). **No permanent block found.**

---

## R2b. The $CBOB boost

**Exactly N distributions:** The boost is bought at `dist_epoch` (after `monthly_inline` potentially advances it). `end = dist_epoch + N`. The boost earns distributions at epochs `dist_epoch` through `end−1`. At `end` it becomes DUE; `BoostsExpireFirst` refuses the next distribution until expired. Both orderings (`[boost, distribute]` and `[distribute, boost]`) give exactly N (BO.21, BO.35). **Exact.**

**Nothing lost/gained on weight change:** `reweigh` moves owed to `carry_scaled` and resets debt at the new weight. New owed = old owed. `owed_scaled` unchanged (correct — no vault's owed changed). **Preserved.**

**Ring/counters agree:** Host tests verify `ring + due == active` and per-slot counts over 260 epochs (4 wraps). Suite `books()` checks after every money operation. **No drift past epoch 64.**

**No double/early/never expiry:** `expire_boost` requires `boost_weight > 0 && dist_epoch >= boost_end_epoch`. After expiry, `boost_weight = 0`. Early expiry is refused. "Never" is prevented by the gate + `expire_boosts` (records only, no token account needed). **Sound.**

**Nobody can block distributions:** Boosting requires an activated vault the signer owns. A vault with a gone token account can still be expired via `expire_boosts`. **No block.**

---

## R3. The level draw

**SlotHashes parse:** Defensive (key pinned, count bounded, buffer checked, all-zero hash refused). Host tests cover malformed inputs.

**FIFO:** `reveal_level` requires `index == revealed_total`. A burned vault at the head still takes its draw (L.11). **Sound.**

**Attribute re-supply hash:** Both mint and reveal hash `hashv(&[Borsh(Vec<VaultAttribute>)])`. The Borsh encoding is identical. Charter claims hash `full` (including `charter`); the reveal caller must pass `full`. `check_attributes` is not called on reveal (correct — `charter` is a reserved key but present in the stored list). **Sound.**

**Is it worse than SPEC 26?** SPEC states best-of-4 (P(Level V) 5%→18.6%) and "64 tries reach 96%." This is accurate. HOLDER-GUIDE says "pick among several results" which understates the 96% figure. **Recommendation: the guide should say "with enough tries a validator can almost certainly choose the level" rather than "several."**

---

## R4. Governance

**Minority carrying:** At ruled numbers, smallest passing vote = 10.71% YES. Key changes need 50% of all live vaults. Concentration (largest holder 17.1% of PoBs) is a business fact, accurately stated in SPEC.

**Vote reaching money:** The five action types cannot touch the split, destinations, `max_supply`, or any vault. `TightenSweep` is monotone and bounded. `SetRound` has a price floor. **No path found.**

**Governance frozen forever:** SPEC 47 accurately states that a stolen guardian key's stop is permanent at low turnout. It is not worse than stated. However, the guardian is also `INIT_AUTHORITY` — if stolen BEFORE `initialize`, the thief could initialize with wrong values (mitigated by the launch checker, but the checker validates JSON, not the signed transaction).

**Skip logic:** Overtaken actions are logged no-ops, not reverts. `last_round_id`/`last_guardian_id`/`last_arm_id`/`last_boost_id` are per-kind. A stale restart is caught by stop time. **Sound.**

---

## R5. The charter claim

**Merkle proof:** Domain-separated (0x00/0x01), sorted pairs, `MAX_POB_PROOF = 16`. JS and Rust use the same scheme (the suite proves the program accepts `pob-merkle.mjs`'s proofs). **Sound.**

**pob_extra:** Passed as non-signers to Core's burn. Writable flag is passed through but signer is always false. A hostile plugin is accepted limit 46. **Sound.**

**SPEC 46 completeness:** The hot wallet can add plugins (gating/bricking claims), change the update authority (alarmed), or mint lookalikes (refused by Merkle root). It cannot transfer or burn PoBs (measured R32.A22a). It cannot set close authorities on PoB-owned token accounts (PoBs are Core assets, not token accounts). **SPEC 46 is complete for what the key can do.**

---

## R6. One-time configuration

Every `initialize` value is write-once. The launch checker (`scripts/check-launch-params.mjs`) validates the JSON before signing, but **validates the JSON, not the signed transaction** (SPEC acknowledges this). The programs themselves check less than the checker (SEAL reads only owners; `redeem_window_secs` may be 10s–24h).

**What a wrong value locks in forever:**
- `bank_treasury` = wrong key → 15% goes to a dead address.
- `swap_operator` = wrong key → royalty SOL stuck.
- `guardian` = `None` accidentally → no brake exists.
- `pob_root` = wrong → no charter claim succeeds.
- Periods (`monthly_secs`, `notice_secs`, `redeem_window_secs`, `min_voting_secs`) set to test values → wrong operational behavior.

**The upgrade-authority key for the five claimed IDs (`FZjLB4e9mVMZTWA6YR1KbXVbByTqWsHpHy5sK83yJYUY`) is a single point of failure before step 11.** If lost, the IDs hold inert code forever. This is NOT in any accepted limit.

**Redemption cap (rolling window):** Verified as exactly a 64-slot ring of timestamps. `k = min(max(1, ceil(live·210/10000)), 64)`. The k-th most recent must be ≥ window old. RL.2/RL.3/RL.4/RL.7 confirm. **Exactly as stated.**

---

## R7. Cross-program raw reads

I recomputed every offset from the struct definitions:

| Constant | Declared | Recomputed | Status |
|---|---|---|---|
| `MINT_CONFIG_DISC` | `[168,252,88,182,219,205,39,53]` | sha256("account:MintConfig")[..8] | ✓ |
| `OFF_MINT_VERSION` | 8 | disc(8) | ✓ |
| `OFF_MINT_COLLECTION` | 9 | 8+1 | ✓ |
| `OFF_MINT_GOVERNANCE` | 41 | 9+32 | ✓ |
| `OFF_MINT_MINTED_TOTAL` | 141 | 41+32+32+4+8+8+8+4+4 | ✓ |
| `OFF_MINT_SALES_STOPPED` | 191 | 141+8+8+32+2 | ✓ |
| `OFF_MINT_SOL_RESERVE` | 257 | 193+32+32 | ✓ |
| `OFF_MINT_MAX_SWEEP` | 266 | 257+8+1 | ✓ |
| `OFF_MINT_COOLDOWN` | 274 | 266+8 | ✓ |
| `OFF_MINT_CHARTER_CLOSES` | 442 | 434+8 | ✓ |
| `OFF_MINT_BARE_RETIRED` | 454 | 450+4 | ✓ |
| `OFF_MINT_SALES_STOPPED_AT` | 518 | 510+8 | ✓ |
| `OFF_MINT_SWEEP_STOPPED_AT` | 526 | 518+8 | ✓ |
| `OFF_MINT_PENDING_OP` | 534 | 526+8 | ✓ |
| `OFF_MINT_MONTHLY` | 574 | 566+8 | ✓ |
| `OFF_MINT_PENDING_GUARDIAN` | 582 | 574+8 | ✓ |
| `OFF_MINT_NOTICE` | 623 | 615+8 | ✓ |
| `OFF_MINT_SWEEP_FLOOR` | 631 | 623+8 | ✓ |
| `OFF_MINT_COOLDOWN_CEILING` | 639 | 631+8 | ✓ |
| `OFF_MINT_RESERVE_CEILING` | 647 | 639+8 | ✓ |
| `OFF_MINT_DIST_EPOCH` | 655 | 647+8 | ✓ |
| `OFF_MINT_MAX_BOOST_WEIGHT` | 711 | 679+32 | ✓ |
| `OFF_MINT_MAX_BOOST_EPOCHS` | 712 | 711+1 | ✓ |
| `OFF_BURN_TOTAL` (GOV) | 42 | disc(8)+version(1)+collection(32)+bump(1) | ✓ |
| `OFF_REC_INDEX` (GOV) | 41 | disc(8)+version(1)+asset(32) | ✓ |

`MINT_CONFIG_SPACE` = 1,261 (1,005 serialized + 256 padding). `VAULT_RECORD_SPACE` = 221. `BurnConfig` space includes the 512-byte ring. **All offsets and spaces are correct.**

The sweep helper reads classic SPL at mint(0), owner(32), amount(64), length 165. **Correct.**

---

## R8. The suite as evidence

I checked for arms that cannot fail and wrong-reason negatives:

- The `because()` list pins 200+ refusal reasons. Every negative arm I spot-checked fires for the named reason (verified via the `because` assertions).
- ID.1 asserts every assertion id is unique (prevents a `because` pin reading the wrong arm).
- RL.S1–RL.S6 (cap-stamp coherence) can fail (S2, S3, S5, S6 all demand specific failure modes).
- The floor mechanism (`MIN_ASSERTIONS = 871`, equality check) prevents silent assertion deletion.
- R34.G1a's fit loop now trims across all values (fixed after the first run failed).

**One gap I note:** No arm tests the close-authority grief described under R1s. This should become a gate-5 pin.

---

## The four questions about accepted limits

**1. Is any limit WORSE than stated?**

- **Limit 47 (stolen guardian):** Accurately stated as "permanent at low turnout." Not worse.
- **Limit 46 (hot PoB key):** Accurately stated. Not worse.
- **Limit 26 (C-leader grind):** SPEC states 96% at 64 tries. HOLDER-GUIDE understates this ("several results"). The limit itself is accurate; the guide should be strengthened.
- **Limit 9/44 (undeclared holdings destroyed):** The close-authority grief (my LOW finding) is a new sub-case not named in these limits. It makes the "rescue stray classic tokens" promise in item 50's client contract fragile: a stray account with a foreign close authority cannot be rescued and will revert the redemption if named.

**2. Is any listed limit not actually a limit?**

- **Limit 35 (10% turnout never binds):** True at the ruled numbers (10.71% > 10%). It is a real limit only for non-ruled `initialize` values. Accurately stated.
- **Limit 34 (ordering per kind):** A design property, not a defect. Accurately stated.

**3. Is any DISCHARGED item not actually discharged?**

- **Item 54 (compute):** Discharged on the program side, but it "binds the holder pages" which don't exist (item 50). The requirement transfers to item 50. Correctly stated.
- **Item 51 (boost):** Discharged. The "boost timing" residue is accepted and disclosed. Correct.
- All other discharged items verified closed or gone with their subject.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?**

No. Items 22, 38, 50, 52, and 53 are all clearly marked OPEN AND BLOCKING and are not referenced as accepted anywhere.

**One gap: the upgrade-authority key for the five claimed IDs is a single point of failure not in any limit.** If `FZjLB4e9mVMZTWA6YR1KbXVbByTqWsHpHy5sK83yJYUY` is lost before step 11, the five IDs are permanently stuck at the inert placeholder. This should be a new accepted limit or an operational note.

---

## Summary of findings

| ID | Severity | Finding |
|---|---|---|
| F1 | **LOW** | Sweep helper's unconditional close can be griefed by a token account with a foreign close authority (owner changed after setting close authority). Reverts the redemption if named in the pair list. Page must check close-authority bytes before naming sources. |
| F2 | **LOW** | The upgrade-authority key for the five claimed mainnet IDs is an undocumented single point of failure before step 11. Loss = permanent placeholder at all five IDs. |
| F3 | **INFO** | HOLDER-GUIDE understates the C-leader's draw-choosing power ("several results" vs SPEC's "96% at 64 tries"). |
| F4 | **INFO** | The widest redemption shape has only 23 bytes of headroom; one extra sweep pair (≥64 bytes) does not fit. Item 50's client contract should state this number. |

**No CRITICAL, HIGH, or MEDIUM findings.** No value path out of a vault, the pool, or the revenue address was found. The pool invariant holds. Every cross-program offset is correct. Round 34's repairs hold.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what this project should do before launch that AI audit structurally cannot

1. **Run the mainnet dress rehearsal (item 22) end to end before anything mints.** Nothing has ever run a distribution, a revenue cycle, or the crank against a live chain. This is the single largest gap. Every named pass/fail item in item 22 must be executed and recorded with transaction signatures.

2. **Have a second human independently build and diff the four `initialize` transactions against `launch/mainnet-init.json` byte for byte before Gary signs them.** The launch checker validates JSON, not transactions. A single wrong byte in a Pubkey or period is permanent.

3. **Test the alert delivery path physically.** Trigger a test CRITICAL from the alarm and verify it reaches a human's phone. An alarm that detects everything but whose SMS goes to a voicemail is worse than no alarm, because the team believes they are covered.

4. **Conduct a key ceremony and verify backups.** Five keys matter before step 11: the upgrade-authority key for the claimed IDs, the guardian/INIT_AUTHORITY key, the swap-operator key, and the $CBOB release-wallet key. For each: is it backed up? Encrypted? Can the right person restore it? Has the backup been tested by restoring on a clean machine? The $CBOB key is in the nightly R2 backup — has anyone ever restored from that backup?

5. **Penetration-test the box.** Who has SSH access? What else is running? Is the kernel patched? The revenue ledger, crontab, alarm, and all private keys live on one machine under one user (accepted limit 10's box-owner residue). A compromise of that box compromises everything off-chain.

6. **Load-test the off-chain pipeline against a rehearsal deployment with ~2,100 vault records.** The suite uses dozens of vaults. The crank's claim batches, the alarm's scan budget, and the reveal lane's throughput have never been exercised at production scale.

7. **Execute the hand-recovery runbook (limit 10) as a drill.** Force a post-sweep failure, walk through the recovery steps exactly as written, and time how long it takes a human to complete. If the runbook is wrong or ambiguous, discover it now.

8. **Have a non-technical person read HOLDER-GUIDE.md and explain each section back.** The guide is written from the spec by engineers. If a real holder misunderstands "opening is all or nothing" or "your level never changes," the guide has failed regardless of its factual accuracy.

9. **Build and test the redeem page (item 50) against real edge cases before removing the upgrade authority.** The page is the ONLY pre-signature check for undeclared holdings (items 9 and 44). Test it against: a frozen reserve account, a stray token with a close authority (my F1), a nested vault, a Token-2022 account, and a vault with all three reserves plus SOL. The page must handle every one gracefully.

10. **Verify that a Metaplex Core upgrade would be detected within 30 minutes.** Simulate one (or read the alarm code against the upgrade instruction's on-chain effect) and confirm the alarm fires. This is the one dependency that can break every vault simultaneously and that no amount of auditing our code can prevent.