# Independent Security Audit — Round 44 (v6 Final Tree)

**Verdict: LAUNCH-CLEAN; QUORUM MET (programs pass).** I confirm Round 43's verdicts and repairs. I found **no new confirmed defects** in the five programs, the sweep helper, or the off-chain pipeline that would block launch under the 2026-10-08 gate. I did identify **one new LOW-severity finding** in the fixable layer (web/), and I re-verified the two Round 43 repairs at all sites. The Core re-pin is validated.

---

## R0. Round 43 Verdict and Repairs — Verified

### V43-1 (Host Owner Takes Nested Vault) — Repair Holds
- **Program behavior:** Confirmed. `open_for_redemption` (SEAL) thaws the host and only requires a later `burn_vault` for the same asset/owner. It does not restrict instructions in between. Core `ExecuteV1` can invoke Core `TransferV1` on a nested vault. The pinned Core binary's embedded source references match `e72d63e`.
- **Measurement:** Suite arm `R43.V1` (in `tests/3prog.test.ts`) executes this exact attack on the burned fixture Z with an empty nested vault. It lands; the nested vault's owner becomes the host's owner; the host is burned. `R43.V1a` confirms the subsequent rescue is refused `NotNested`. This is a real, measured arm.
- **Crank repair:** `planRescues` in `bank/crank.mjs` now plans `rescue_nested` for every nested vault found by `detectNestedVaults` on every full pass. The selftest arms (R43 V43-1) verify the planner, the send block, and the benign `NotNested` race. I read the code and the selftest; the repair is present and tested.
- **Docs:** HOLDER-GUIDE.md, SPEC.md (section 9 table, impossibility 3, limit 58) now state the race and the sender's loss. Gary's ruling is recorded.
- **Verdict:** Repair holds. The finding remains LOW, outside (a)-(d), as ruled.

### V43-2 (E2E Header Comment) — Repair Holds
- The header of `web/test/e2e-localnet.mjs` now correctly describes the current rescue rule (plan does not refuse; optional set-up rescues to `bank_treasury`; post-opening rescue). Comment-only, INFO. Verified.

### V43o-1 (Rehearsal Release Gate) — Repair Holds
- `scripts/run-tests.sh`'s `release_gate` function now handles the rehearsal tree. Outside the rehearsal tree, it requires program source to equal `RELEASE_COMMIT`. Inside it (marker `REHEARSAL-RECORD.txt`), it verifies the program difference is exactly the recorded id substitution, byte-for-byte, and skips web offline tests. Seven selftest arms run the gate on a fixture. I read the code; the logic is sound.

### V43o-2 (Unreadable Signature Skip) — Repair Holds
- `bank/alarm.mjs` and `bank/redemption-poster.mjs` now retry an unreadable signature for `UNREADABLE_SKIP_PASSES` (3) passes, then skip it on the record as `tx_skipped_unreadable` (HIGH, level condition) until a human reviews it. The cursor and backlog move on. Four selftest arms run the real extracted walk. I read the code; the repair is present and tested.

### V43o-3 (Reveal-Skip Arm) — Repair Holds
- The reveal loop in `bank/crank.mjs` is extracted and tested with unreadable, unread, and burned assets. The arm can fail (shown red by deleting the `break`). Verified.

### Core Re-Pin — Validated
- The mainnet probe (`scripts/probe-mainnet-facts.mjs`) now asserts the deployed Core's hash equals the pin in `run-tests.sh` (`30dce56b...`). The selftest asserts all four copies of the pin are one value. The certifying run at `c1e6ee8` passed 912/912 on-chain, 968/968 detectors, 35/35 mainnet probe, 16/16 swap fork, 132/132 e2e, 71/71 sim. I read the probe code and the validation record; the re-pin is real and measured.

---

## R1. Custody: Seal, Burn, and the Sweep Helper

### R1 (Seal/Burn Pairing)
- **Pairing:** SEAL's `open_for_redemption` walks top-level instructions for a matching `burn_vault` (same asset, same owner). BURN's `burn_vault` walks for a preceding `open_for_redemption`. Both bind asset AND owner. CPI wrappers are refused (WR.1-WR.3). Two vaults in one transaction are handled (4.9, 4.10a). Account-index binding is pinned (3.1c-3.1f). Instruction-sysvar parsing is defensive.
- **Emptiness proof:** BURN requires every reserve mint's ATA under both token programs to be declared, PDA-owned, undelegated, extension-free, and empty. The second loop checks all declared accounts for live Core assets and non-empty token accounts. Token-2022 extensions are refused. Delegates and close authorities are checked. Lamports must be zero.
- **No thawed vault leaves unburned:** The burn is the terminal instruction. If any check fails, the whole transaction reverts, including the thaw. There is no instruction to re-seal. A partial sweep reverts.
- **Verdict:** No new defect found. The pairing and emptiness proof are sound.

### R1s (Sweep Helper)
- **(a) Access control:** The helper requires the asset-signer's signature. Direct calls fail. Through Core `ExecuteV1`, only the asset's owner is approved (SR.5, SR.5a). The collection authority is MINT's off-curve PDA (SR.5b). The AgentIdentity route cannot be added by an owner (R24.1a). The helper cannot be reached while frozen (SR.5, SR.5a).
- **(b) Pair list:** The helper checks each source is owned by the signer and each destination is owned by the destination wallet with the same mint. Duplicate sources fail on the second close (SR.12a). A source as destination is refused (SR.10). Native wSOL accounts are not handled (the helper reads only 165-byte token accounts; a wSOL account is 165 bytes but its mint is the native mint, and the transfer would fail). A source with a delegate or close authority is refused by the token program or the close. Frozen sources fail the transfer. Non-ATA destinations are accepted if they are token accounts of the right mint and owner. The destination wallet being another vault's asset-signer is not explicitly refused, but the destination wallet is chosen by the transaction builder (the owner), so this is not an attack vector.
- **(c) Destination checks:** The destination wallet is chosen by the builder. Given (a), only the owner can build the transaction, so the destination is the owner's choice. The lamport transfer to a non-system account or below rent exemption fails the whole call, which would block redemption. The redeem page uses the owner as destination, which exists.
- **(d) Lamport sweep:** The helper reads `signer.lamports()` at execution and transfers all of it. BURN's `lamports == 0` check sees exactly what the sweep left. No later instruction can deposit into the asset-signer because the burn is the last instruction and the asset is destroyed.
- **(e) Interaction with BURN:** The helper closes what it empties. BURN's reserve loop skips accounts no token program owns. A missing reserve ATA is created in a prior transaction by the redeem page. A stranger can create a classic ATA for the vault and deposit dust; the helper sweeps it at execution. A Token-2022 ATA for a classic mint cannot be created (F4.2). A non-ATA token account can be created by a stranger, but the helper can sweep it if named, and BURN's second loop refuses it if declared and non-empty.
- **(f) Fit:** S8.0 measures the three-asset redemption through the helper at 1,061 bytes. The page adds compute-budget instructions and a separate fee payer (1,209 bytes). A fourth reserve would exceed the legacy packet. The in-line monthly run's accounts are already included in the burn.
- **(g) Evidence:** SR.0-SR.4a and S8.* are real, landed transactions. The helper is deployed in the suite from the same bytes `scripts/build-mainnet.sh` proves (byte-identical between localnet and mainnet builds).

**Verdict:** No new defect found in the sweep helper.

---

## R2. Community Pool and $CBOB Boost

### R2 (Pool Invariant)
- **Invariant "pool holds at least ceil(owed)":** The accumulator (`acc_scaled`, `owed_scaled`) is updated in `credit` and `claim`. `distribute` refuses `PoolShort`. `claim` pays only whole sats and normalizes debt. The suite's `ledger()` function recomputes the invariant after every money operation (BK.IN, BK.3c, BK.P). The boost host test (N1) drives 260 epochs and checks the invariant. I re-read the code; the arithmetic is sound.
- **Counters:** `pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight` are updated in `activate`, `join`, `retire`, `reweigh`, `unschedule_boost`. The host test covers retirements while pending (F21.1). No underflow or drift found.
- **Liveness:** `JoinWaitingFirst` and `BoostsExpireFirst` gates are checked before any burn. `expire_boosts` and `claim` are permissionless. The crank joins and expires. No permanent block found.

### R2b ($CBOB Boost)
- **Exact N distributions:** The boost ends at `dist_epoch + N`. `advance_epoch` marks it due. `BoostsExpireFirst` refuses any distribution while due. `expire_boost` unschedules and reweighs. The host test (N1) drives 260 epochs with buys, early retirements, due retirements, and expiries, checking the ring, totals, and owed sum. The suite's BO section covers the same on-chain. No record can be expired twice (idempotent skip), early (`BoostNotDue`), or never (due at the exact epoch).
- **Weight changes:** `reweigh` moves owed share to `carry_scaled` and resets debt. Nothing is lost or gained. The host test checks `owed_scaled` equals the sum of every vault's share after every operation.
- **Ring agreement:** `boost_expiring`, `boosts_due`, `boosts_active`, `boost_weight_total` are checked against a model in the host test and the suite's `books()`.
- **Liveness:** `expire_boosts` needs only records, not token accounts. A vault whose token account is gone can still be expired. No distribution block found.

**Verdict:** No new defect found in the pool or boost.

---

## R3. Level Draw

- **SlotHashes parse:** `blockhash_in_window` checks the sysvar id, bounds the count, checks the buffer length, and refuses all-zero hashes. The host test covers malformed inputs.
- **Skipped slots:** `try_capture` uses the smallest produced slot in `[want, want + MAX_SKIPPED_SLOTS]`. The host test covers skips at A, B, and C.
- **FIFO:** `reveal_level` requires `index == revealed_total`. A burned vault at the head still takes a draw (L.11).
- **Attribute re-supply hash:** `attrs_hash` is checked against the re-supplied list. A mismatch refuses.
- **Influence:** A minter cannot choose the level (reserved attribute, draw from future slots). A crank operator can withhold captures (accepted limit 25). A slot leader can grind C (accepted limit 26). The holder guide states this.
- **Worse than SPEC 26?** No. The code matches the stated limit. The leader of C can choose among many draws, not merely bias one.

**Verdict:** No new defect found.

---

## R4. Governance

- **One vault one vote:** `VoteRecord` is seeded by asset. Transfer-then-vote-again fails (7.9).
- **Electorate fixed:** `index_snapshot` and `quorum_supply` are set at creation. `VaultTooNew` refuses new vaults.
- **No proposal before charter close:** `CharterNotClosed`.
- **Quorum, threshold, turnout:** Checked at execute. The 10% turnout rule is a floor.
- **Key changes:** `KeyChangeNeedsHalf` requires YES from half of the snapshotted live supply. Guardian and swap operator cannot share a proposal (`KeyChangesBundled`). Notice period enforced by MINT.
- **Guardian cancel:** `cancel_swap_operator` clears a pending operator. The guardian cannot cancel its own replacement.
- **TightenSweep:** Only tighter, inside bounds fixed at initialize. Monotone.
- **Overtaken action:** `CBOB_ACTION_SKIPPED` logged, not a revert.
- **Frozen forever?** A stolen guardian key can stop sales and sweep permanently if turnout is low (accepted limit 47). The code matches the stated limit. No new freeze found.

**Verdict:** No new defect found.

---

## R5. Charter Claim

- **Proof of Burn by address:** Merkle root of 240 addresses, domain-separated, sorted pairs. The proof is checked against `pob_root`.
- **CPI burn as owner:** The program burns the PoB as its owner in the same instruction. `pob_extra` accounts are passed through, never as signers.
- **Window fixed:** `charter_opens_at` and `charter_closes_at` are set at initialize. No setter. Refuses by clock alone.
- **Not gated by guardian:** The claim does not read `sales_stopped`.
- **SPEC 46 completeness:** The hot wallet can end the project or capture governance during the window. The alarm watches the collection but not individual assets. The page refuses external plugins. The positive bound (cannot transfer or burn a PoB) is stated. I find SPEC 46 complete.
- **Anything omitted?** The hot wallet could also add a plugin to an individual PoB that the alarm does not watch, but this is stated in SPEC 46. No new omission found.

**Verdict:** No new defect found.

---

## R6. One-Time Configuration and Trusted Hop

- **Initialize values:** Each program's `initialize` checks its inputs. The launch checker (`scripts/check-launch-params.mjs`) validates the JSON before signing. The rehearsal checker validates the rehearsal set. The programs themselves check less than the checker (SEAL reads only owners; off-curve keys accepted; `redeem_window_secs` range). This is stated in item 38.
- **Swap operator worst case:** The operator can sweep up to `max_sweep_lamports` per `sweep_cooldown_secs`, bounded by the revenue balance above the reserve. The guardian can stop it. A vote can only tighten. The worst case is stated in limit 10.
- **Royalty plugin:** Authority None. Core refuses updates and removals. The suite proves this (R.5, R.6, R.6a, R.6b, R.6c, R33.G3).
- **Redemption cap:** Rolling window over a 64-slot ring. The suite's RL section and the sim's S10 prove the window. The ring bounds the cap at 64.

**Verdict:** No new defect found.

---

## R7. Cross-Program Raw Reads

- **Offsets:** I recomputed every offset in MINT's `MintConfig` (version 6), `VaultRecord` (version 4), SEAL's `Config` (version 2), BURN's `BurnConfig` (version 4), and GOV's `GovConfig` (version 4). All offsets match the constants in the programs and `bank/layout.mjs`. The suite's X.1-X.6 arms decode live accounts and compare against raw offsets. The host test and the selftest evaluate the space constants.
- **Sweep helper raw reads:** The helper reads classic SPL token accounts at offsets 0 (mint), 32 (owner), 64 (amount), 108 (state), length 165. These are correct.

**Verdict:** No new defect found.

---

## R8. Suite, Simulation, and Build as Evidence

- **Arms that cannot fail:** I reviewed the suite's `because()` pins and the `ID.1` uniqueness check. The floors are exact (912 on-chain, 968 detectors, 39 allocation, 24 poster, 14 PoB, 68 launch, 35 mainnet, 4 expiry, 16 fork, 71 sim, 132 e2e, 682 web). The runner refuses a partial pass or a floor mismatch.
- **Arms whose negative fires for a different reason:** The `because()` list pins the exact error for each refusal. I spot-checked several (e.g., `SR.12a` duplicate source, `R36.C5` close authority, `R42.C12a` pre-funded address). The pins are correct.
- **Claims with no arm:** The 3,600-second redemption window is not separately exercised (stated as the same arithmetic). The 7-day notice and 30-day month are not exercised at their mainnet values (stated). The combined heap shape at the FIFO head is recommended but not required (carried).
- **Mainnet bytes:** `scripts/build-mainnet.sh` proves the sweep helper's bytes are identical between localnet and mainnet builds, and that the four keyed programs reject the test key in the mainnet build. The release gate binds the program source to `RELEASE_COMMIT`.

**Verdict:** The evidence is sound.

---

## Accepted Limits — Four Questions

1. **Is any limit worse than stated?** No. I re-read each accepted limit against the code. The limits are accurate.
2. **Is anything listed as a limit not actually a limit?** No. Each limit describes a real, present behavior.
3. **Is any DISCHARGED item not actually discharged?** No. The discharged items are either measured closed or removed with the thing they were about.
4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, and 53 remain OPEN AND BLOCKING. The rehearsal value set (item 53) is built and tested. The launch checker refuses the mainnet file if any value is OPEN.

---

## New Finding

### F44-1 (LOW, fixable layer): The redeem page's "Run a payout" does not re-check the pool's frozen state after the user clicks the button.

**Construct:** `web/src/pages/redeem.mjs`, `payoutBlock` function. The function reads the pool's state once when the page is rendered (`s.pool`). If the pool is frozen after that read but before the user clicks "Run a payout", the function proceeds to build and send the payout transactions. The `distribute` instruction will fail on-chain because the pool is frozen (the token transfer from the pool reverts). The user pays transaction fees for a failed payout.

**Evidence if true:** A test that mocks the pool as unfrozen at render time, then frozen at click time, would show the payout transactions being built and sent, and the on-chain simulation failing with a frozen-pool error.

**Fix:** In `payoutBlock`, re-read the pool's state (or the full MINT config) immediately before building the payout transactions, and refuse with a clear message if the pool is frozen.

**Severity:** LOW. The user loses only transaction fees. The payout is not a redemption, so no vault is locked. The page's main redemption flow already handles the frozen pool correctly (it omits the claim and forfeits the share).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

**What should this project do before launch that AI audit structurally cannot?**

1. **Run the mainnet dress rehearsal (item 22) exactly as specified, and record every transaction signature.** The rehearsal is the only test of the crank, alarm, revenue cycle, and hand recovery against a live cluster. AI audit cannot execute this. The rehearsal value set is built; Gary must approve the PROPOSED values and the REHEARSAL-OPEN keys must be generated at rehearsal time.

2. **Have Gary personally verify the launch ceremony's values on the ceremony page, in local mode, before signing.** The ceremony page shows every value in plain words and re-reads the chain after each step. AI audit cannot verify that the human at the keyboard is Gary, or that he understands what he is signing. The local mode (SSH tunnel) is the recommended path.

3. **After step 11 (removing upgrade authorities), have a second, independent human (not the deployer) dump each program and verify the bytes against `dist/SHA256SUMS` and the zero tail.** AI audit cannot perform this physical verification. The ceremony page does it, but a second pair of eyes on the command line is cheap insurance.

4. **Publish the holder guide and the pages only after the dress rehearsal passes and the programs are locked.** The guide promises surfaces that do not exist yet (item 50). Publishing it early would be a false promise. AI audit cannot enforce publication order.

5. **Keep the Proof of Burn collection's hot wallet key offline during the charter window, or accept the stated risk in writing.** The risk is stated in SPEC 46 and the holder guide. AI audit cannot hold the key. Gary's ruling is to keep it hot; if that ruling stands, the risk is accepted and disclosed.

6. **Fund the revenue address above rent exemption before the first paid mint, and verify the pool and Squads cbBTC accounts exist.** Item 52. The ceremony does this, but a human should confirm the balances on an explorer before the first sale.

7. **After launch, monitor the alarm's first few passes and the first revenue cycle by hand.** AI audit cannot watch the live system. The alarm's first CRITICAL or HIGH should be triaged by a human who understands the system, not just the operator.

These are concrete, human steps that the AI process cannot perform. They are the last line of defense before immutability.