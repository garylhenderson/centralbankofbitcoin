# Audit of the CBOB v6 tree

I found two surviving defects and several evidence and documentation gaps, summarised in the table. Nothing here claims theft or an unseal. Both main findings are program-side and become permanent at the lock. Neither was measured in the provided runs, so I give the test that would confirm or refute each.

**Scope limit.** `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/crank.mjs`, `bank/revenue.mjs` and `bank/swap.mjs` were not in this bundle. Of the off-chain repairs, only `txread.mjs` and `sigwalk.mjs` could be read. I cannot confirm or refute the round-30 alarm, poster, crank or revenue repairs, and I did not try.

| # | Severity | Finding |
|---|---|---|
| F1 | HIGH (pending one measurement) | An owner can bloat an unrevealed vault with Core's Autograph plugin and permanently halt the level FIFO for every later vault. |
| F2 | MEDIUM | Accepted limit D2 (orphaned activated vaults) is worse than stated: the leverage is unbounded and the fix is still possible before the lock. |
| F3 | LOW | Several claims, including claims in the prompt, have no suite arm that could fail. |
| F4 | LOW | HOLDER-GUIDE and SPEC understate the autograph hazard and contradict each other. |
| F5 | INFO | Four of the five tested binaries are not the shipped bytes. |

## R0. Prior verdict

The round-30 verdict is NOT CLEAN and quorum was not met (5 of 8 counted, 6 required). I re-derived or spot-checked several of its claims and found no error in them.

- **Rent.** Mainnet rent for 221 bytes is 349 × 5,080 = 1,772,920 lamports. The test-validator figure of 2,429,040 matches (221 + 128) × 6,960. The corrected sentence is right.
- **Offsets.** I recomputed every `MintConfig` offset GOV and BURN read, from `charter_closes_at` 442 through `boost_expiring` at 749, plus the VaultRecord, BurnConfig and SEAL layouts and the space constants. All are consistent. VaultRecord is 211 bytes plus 10 of padding, which is the stated 221.
- **Drain time.** With the cap falling as supply falls, a 209-hour drain is plausible.
- **Prompt inconsistency.** The prompt says round 29 read this tree, but the bundled verdict is round 30's. Nothing in this report depends on that.

Both main findings below have no round-30 counterpart.

## R1. Custody

**Pairing.** I found no break.

- SEAL's open requires a later top-level burn for the same asset and owner. BURN requires an earlier top-level open for the same pair.
- Both reject CPI shapes: the `load_instruction_at_checked` calls see only top-level instructions, and the wrappers fail WR.1 to WR.4.
- A thawed vault cannot leave a transaction unburned, because a failing burn reverts the thaw.

**Emptiness proof.** I found no break.

- The reserve loop requires every reserve ATA under both token programs to be declared.
- The Token-2022 ATA for a classic mint cannot exist (probe F4.2).
- A stranger can create an account that neither the sweep can name nor BURN skip only as an undeclared token account or a nested asset. Those are invisible to BURN and are destroyed rather than blocking, so they are not a denial of service.

### R1s. Sweep helper

- **(a) Access control.** Reachable only through Core's `ExecuteV1`, whose authority rule approves the owner alone on this binary (SR.5, SR.5a, SR.5c). While frozen, Core refuses with 0x9 (3.7).
- **(b) Pair list.**
  - A duplicate source fails on the second pass, because the closed account is no longer token-owned.
  - A source reused as a destination fails the destination-owner check.
  - A native wSOL source is handled, and round 30 measured it.
  - A close-authority or delegate on a source cannot be placed by a stranger, because `SetAuthority` needs the vault PDA's signature.
- **(c) Destination.** The page chooses the destination wallet, so a malicious page or wallet could redirect funds. That is a signing-surface risk, not a program defect.
- **(d) Lamport sweep.** The sweep reads `signer.lamports()` at execution. Nothing between it and BURN's `lamports == 0` check can add lamports, except an instruction in the owner's own transaction.
- **(e) Missing ATAs.** Creating the vault's missing reserve ATAs in a prior transaction is sufficient. After that the sweep names the live account, and later deposits are swept.
- **(f) Fit.** S8.0's 1,061 bytes is the measured shape. The real page adds 52 bytes for the compute-budget pair and 96 for a separate payer. Round 30 states that each extra rescue pair costs at least 66 bytes more.
- **(g) Arm coverage.** See F3. The stray-classic-token rescue promised in item 44 is never run through the helper.

## R2 and R2b. Pool and boost

I found no violation of "the pool holds at least ceil(owed)".

- Per-vault `owed` sums exactly to `owed_scaled`. The `ledger()` arm checks this after every money operation.
- The `pending_count` and `pending_this_epoch` bookkeeping is consistent for retire-while-waiting.
- A boost with N epochs ends at `dist_epoch + N ≤ +63` and cannot collide in the 64-slot ring. `advance_epoch` clears a slot into `boosts_due` before a boost could reuse it.
- `expire_boosts` and `retire` can always drain `boosts_due` without touching a token account.

The one liveness hole is in the level queue, not the pool (F1).

## R3. Level draw

The SlotHashes parse, skip handling and window arithmetic (A at most `rs+64`, B at most `A+72`, C at most `rs+208`, inside the 300-slot window) are consistent. FIFO and burned-head handling are correct. See F1 for a defect in the reveal's dependence on Core.

SPEC 26 is not worse than stated. HOLDER-GUIDE says the draw can be chosen by the validator "by skipping a block or changing what goes into it", which is accurate.

## R4. Governance

I found no minority path and no money reach beyond what the notice and bounds allow.

- Discriminators and Borsh encodings match MINT's signatures: `restart`, `arm_guardian`, `set_boost_terms`, `set_round` and `tighten_sweep`.
- The skip and stop-timestamp comparison is consistent (GOV `>=` against MINT `<`).
- SPEC 47 is not worse than stated.

## R5. Charter claim

The Merkle verification matches the JS module, including sorted pairs, domain tags and promotion of the odd node.

SPEC 46 is complete on the points I can see. Per-asset plugins added to individual PoBs share the alarm's blind spot, and the SPEC already says so.

## R6 and R7

- The rolling ring is correct: the k-th most recent entry is `ring[(head-k) mod 64]`, and the cap is bounded at 64.
- Every cross-program raw offset recomputed correctly (see R0).

## R8. Evidence

See F3 and F5.

## Findings

### F1. HIGH, pending one measurement: an unrevealed vault can be bloated so Core's reveal write runs out of heap, halting the FIFO for everyone

**Construct.** `reveal_level` always does a Core `UpdatePluginV1` on the asset unless it is burned. `revealed_total` advances only after that CPI succeeds. There is no skip, no admin and no timeout.

Reveal is strictly in mint order (`RevealOutOfOrder`). `activate` needs a drawn level (`NotRevealed`).

**What the repo already shows.**

- Round 28 pins the pinned Core's fixed 32 KiB heap.
- With a 10,150-byte autograph, the reveal landed (R28.A1).
- Shrinking that same asset ran out of memory (R28.A2).
- So the margin between "grow lands" and "shrink fails" is already thin at 10 KB.

**Attack.** Autograph is owner-managed, and any signer may add a signature (SPEC item 40). One CPI instruction is limited to about 10 KB of realloc, but nothing bounds the number of instructions, transactions or signer keys.

The attacker mints a vault (21,000 sats, or free with a PoB) and adds roughly 20–30 KB of signatures from three or more keypairs. A custom CPI program like the test's `PADTAIL!` wrapper does this in one transaction, or about 20 ordinary transactions. The window before the crank reveals is at least 32 slots (about 13 s).

If Core's attribute update then fails with "memory allocation failed", the queue stops at that vault permanently. No later vault can be revealed or activated, and so none can be paid.

Cost is a few tenths of a SOL, paid once. Immutability makes it permanent.

**Why this is DISCHARGED item 19 in a new shape.** That item was closed "by construction" because no activated-but-unlevelled state exists. But a customer-triggerable stop of the whole queue exists again.

**Evidence that would exist if I am right.** Extend R28.A1 with k signers, each adding 10,150 bytes, for total sizes of 12, 14, 16, 20 and 30 KB. Then run MINT's reveal. At some size the reveal reverts with `memory allocation failed`. A later vault's reveal then returns `RevealOutOfOrder` forever, and capture and reschedule cannot help.

If the reveal still lands at 30 KB, withdraw this finding. Core's heap makes that unlikely: bump allocation, a 30 KB string, and a re-serialised copy exceed 32 KiB.

**Fix, before the lock.** Remove the dependency of the FIFO on Core's write.

- Draw and store the level in the VaultRecord, count it in the census and advance `revealed_total`. Payouts and GOV already read the record.
- Make the attribute write a separate, permissionless, best-effort `write_level_attribute`. It may fail harmlessly for a bloated vault.
- A cheaper variant: in `reveal_level`, skip the Core CPI when `asset.data_len()` exceeds a safe threshold (for example 8 KiB). This also removes the Core-upgrade halt of item 40.

### F2. MEDIUM: accepted limit D2 is worse than stated, and a pre-lock fix is checkable on chain

SPEC bounds the harm of an orphaned, activated vault as "its weight w out of `total_active_weight`".

Fact 3 says Core lets a vault be transferred into another vault's asset-signer PDA. A sealed host's Execute is frozen, so an owner cannot move a nested vault out except during the host's own open window. The nested vault stays activated because nothing can retire it.

**Leverage.** Every distribution then pays w/W of the pool into an account nobody can sign for. Attacker cost is one vault price plus 21,000 seed sats per orphan.

An illustrative case: a 240-vault charter cohort with W ≈ 730, and 20 orphans at average weight 4. That diverts about 10% of all future distributions, forever, for roughly $700. The attacker needs no profit, only a grudge or a short position.

It scales with each extra orphan. It also scales with boosts (up to +12 each, 24 epochs) bought with the attacker's own $CBOB.

**Fix, before the lock.** `retire_orphaned(vault_record, host_asset)`, permissionless.

- It requires the vault asset's owner to equal `find_program_address([EXECUTE_PREFIX, host_asset], CORE)`, which is computable on chain without `is_on_curve`.
- It then retires the vault, removes its weight and returns its owed share to the pool.
- Nested vaults are already unredeemable (9.3), so the only cost is a rescued vault losing its payout eligibility. That is an owner decision, as SPEC says.

**Evidence that would exist if I am right.** Run section 9's nest, then activate and distribute. The inner vault's weight stays in `total_active_weight` after the host's redemption, and the pool pays into an account no one can sign for.

### F3. LOW: claims with no arm that can fail

- **Stray tokens through the helper.** Item 44 says the helper moves any classic token account the vault PDA owns, of any mint, ATA or not. Every SR.* arm names only the cbBTC ATA. The suite never sweeps a non-ATA or non-reserve account through the helper.
- **Frozen zero-balance source.** SPEC says a frozen stray holding zero is "only closed, measured round 30". SR.14 covers only a frozen source with a balance. No bundled arm covers the zero-balance case.
- **Large autograph (R28.A1).** It only exercises one 10 KB signature. It does not search for where the reveal fails, which is F1's test.
- **`expire_boosts` batch.** MINT bounds a batch at 30 records, but the expiry-budget gate measures only 20 distinct records.
- **Charter pass-through.** SPEC states that eight pass-through accounts are supported. No arm exercises `pob_extra = 8`.

### F4. LOW: HOLDER-GUIDE and SPEC understate the autograph hazard and contradict each other

The guide warns that a roughly 10 KB autograph means "Core can no longer empty it", and then reports that a full opening passed a simulation. It does not say that a bloated unrevealed vault can stop the draw for everyone (F1).

### F5. INFO: tested binaries are not the shipped bytes for the four keyed programs

`build-mainnet.sh` compares only the sweep helper's bytes. For SEAL, MINT, BURN and GOV, the suite runs the `localnet` build and only the init-key probe runs against the mainnet build.

The `localnet` feature changes only a constant. But a feature flag changes the crate metadata hash and the whole link, which is the reason the sweep helper dropped its empty feature in round 25. The same argument says the four keyed programs' tested and shipped binaries differ in ways nobody compared (inlining, layout, compute).

## Accepted limits

1. **Worse than stated.** D2 (F2). Everything else I examined is at most as stated.
2. **Not actually limits, or already closed.**
   - SPEC limit 9 (nested foreign Core assets) is more closed than it reads for self-owned and burned-host cases. F2's fix would close it.
   - Limit 44's Token-2022 gap is real, but it is harmless: BURN skips undeclared accounts and does not revert.
3. **Discharged but not.** Item 19 (F1).
4. **Open and blocking, treated as accepted.** None quietly demoted. Items 22, 38, 50, 52 and 53 remain open, and the guide may not be published until item 50 ships.

## Before the lock: what an AI audit structurally cannot supply

1. **Run the suite against the shipped bytes.**
   - Gary signs the four `initialize` calls on a throwaway local validator using his real key, with the exact `dist/*.so`.
   - That removes the tested-versus-shipped gap (F5).
   - It adds no custody risk, because the key never leaves a local test validator.
2. **Run F1 and F2 as the first two arms** on real mainnet Core: the 12–30 KB autograph sweep, and nest-then-distribute. Fix whichever reproduces, then rerun the whole suite.
3. **Stage the lock.**
   - Keep the upgrade authority in the Squads, behind a time lock, through one full month cycle on mainnet with real Core.
   - That cycle should cover one full distribution, one reveal queue of 50 or more vaults, one redemption, one vote and one guardian change.
   - Then remove it.
4. **Offer a funded bug bounty** against the dress-rehearsal deployment before any real value is held, aimed at the Core-plugin and heap surface in particular.
5. **Fuzz the accumulator.** Rust model-based property tests over random sequences of mint, activate, join, boost, claim, retire and distribute, checking the `ledger()` identity. The existing host test covers only boost scheduling.
6. **Reproducible build by an independent builder.** A second machine rebuilds `dist/`, and the hashes are compared before the lock.
7. **Ask Metaplex for written confirmation** of the Execute authority rule, the burn tombstone encoding and the autograph size and heap behaviour on the deployed binary, since the lock makes them permanent dependencies.
8. **Hold the guide and the redeem page** until item 50 ships. Real wallets and RPC will mangle transactions and pages in ways no local validator shows.