# Round 33 audit, programs focus: findings by target

I read the tree in full and recomputed the cross-program offsets, account spaces and the pool invariants. I ran nothing: no validator, no test, no build.

## R0. Round 32's verdict and repairs

- **Offsets and spaces.** MintConfig (749-byte ring start, 1,005 bytes of fields, 1,261 with padding), VaultRecord (211 + 10 = 221), BurnConfig (827) and the GOV and BURN reads of MINT all recompute exactly. Round 32's tables are right.
- **W1 (stockpiled restart proposals) is correctly refuted.** The re-stop is a false→true transition and re-stamps `*_stopped_at`. Every older proposal is then refused or skipped (`lib.rs:900-914, 887`; GOV 554-555).
- **A22 (the Moments authority cannot transfer or burn a PoB)** is consistent with SPEC 46.
- **Gate-5 pins.** Round 32 pinned the max Autograph, the dusted PDA and the update-authority bound. It did not pin the combination that matters in F1 below.

## R1 and R1s. Custody and the sweep helper

I found no theft path, unseal path or emptied-vault-survives path.

- **Pairing.** SEAL's forward walk fails closed on the first `Err`. BURN's backward walk is top-level only. Both bind asset index 0 and owner index 2, and `retire_redeemed` adds a stack-height check plus a top-level `burn_vault` check.
- **Duplicate source.** The second read refuses via `IllegalOwner` on the closed account (SR.12a, pinned).
- **Source that is also a destination.** This is impossible: the source owner is the signer, the destination owner is the wallet.
- **Stranger-created accounts.** A stranger cannot set a delegate or close authority on a PDA-owned account. A Token-2022 ATA for a classic mint is uncreatable (F4.2). Stray accounts are never declared, so they cannot block a burn.
- **Lamports.** The sweep reads the PDA's lamports at execution, and BURN reads the same account afterwards.
- **Fit.** The in-line monthly run adds no accounts: the pool is already in `claim` and in BURN's CPI.

**Untested helper arms.** No arm exists for a wSOL source, a non-ATA destination, one destination named twice, or a source with a close authority. I believe all behave correctly, and I could not construct a harmful case.

## R2 and R2b. Pool and boost

I proved the invariants by reading:

- `credit` adds `Σwᵢ·δ` to `owed_scaled`.
- `claim` removes exactly `pay·S` and leaves `carry < S`.
- `join`, `reweigh` and `retire` each preserve `owed_scaled = Σ(wᵢ·acc + carryᵢ − debtᵢ)`.
- `ceil(owed) ≤ balance` holds after every operation.
- Ring slots cannot collide, because live ends fall in `(e, e+63]`.
- No epoch advance happens while `boosts_due > 0`.
- Joins and expiries never need a vault's token account, so no one can block distribution with a missing account.

I found no defect.

## R3. Level draw

- The SlotHashes parse and skipped-slot handling are deterministic and fail closed.
- C's leader is not worse than SPEC 26 states. The B-leader skipping a whole group also shifts `want_C`, and one validator holding A, B and C compounds the grind. I count that as inside "chooses among many draws".
- HOLDER-GUIDE states the draw risk truthfully.

### F1 (HIGH if measured as exploitable; currently UNMEASURED): an owner can shape their vault so `reveal_level` OOMs in Core, which halts the FIFO permanently

- **Construct.** `reveal_level` does a Core `UpdatePluginV1` CPI. Core runs in a fixed 32 KiB bump heap with no free. Round 28 measured that, with a 10,198-byte Autograph, clearing the signatures and `RemovePlugin` both exhaust that heap.
- **What is untested.** The only reveal measured at the Autograph maximum (R28.A1) used a vault with a 59-byte attribute list and a short name and URI. The attacker's best shape combines these:
  - a 640-byte attribute budget (L.12 tests this only without an Autograph),
  - a 64-byte name and a 200-byte URI,
  - all five owner plugins,
  - the maximum Autograph, or many small signatures from distinct PDA signers, which allocate more per byte.
- **Gain.** An owner can mint with that shape, which costs one price plus a deployed forwarder program, and then add the Autograph through a forwarder program, as the test wrapper does. If the reveal exceeds the heap, the transaction aborts. A CPI failure cannot be caught, and no instruction skips a vault. `revealed_total` then stops at that vault, and every later vault stays at level 0 and cannot activate. Only the owner can unblock it, by bare-burning the vault. That is a permanent ransom after the lock.
- **SPEC contradiction.** SPEC item 19 is "closed by construction: there is no state in which a vault is activated but unlevelled". The queue now has a customer-triggerable stall of the same class.
- **Evidence if I am right.** Mint with exactly that shape. The `reveal_level` run for the head vault reverts with "memory allocation failed", and the next index returns `RevealOutOfOrder` forever. To size the margin, bisect the Autograph size at 640-byte attributes. Repeat with 250+ small signatures.
- **Fix, before the lock only.** Add a permissionless record-only path: `reveal_level(write_attr=false)` allowed only after the head has been `entropy_set` for a long delay (about 216,000 slots, one day). It draws and updates the census and the record, flags `attr_unwritten`, and skips the Core CPI. Payouts read the record, so the level attribute is cosmetic. An attacker then buys one day of stall per vault at one mint price each. If you decline the change, run the measurement above at minimum.

## R4. Governance

- I found no way for a minority to carry a key change or reach money outside MINT's bounds.
- Restart ordering, skips and the overtaken-action no-ops behave as documented.

**F2 (MEDIUM, design and documentation gap): loss of the swap-operator key is unrecoverable.**
- Replacing the operator or the guardian needs YES from at least half of all live vaults at creation. "Live" includes lost-key, orphaned and custodial vaults.
- A stolen or lost operator key leaves only the guardian's stop. Restarting the sweep while the old operator is installed hands the SOL back to the thief. The safe path is to arm a replacement (50%), wait seven days, apply, then restart.
- A stolen guardian can cancel any armed replacement. SPEC 47 states this for the guardian, but nothing states it for the operator.
- After the 2,100 primary sales, royalty SOL is the only recurring income, and it flows only through this key.
- **Evidence.** The SPEC 10 and 47 text, GOV `KeyChangeNeedsHalf`, and no other SOL exit from the revenue PDA.
- **Fix.** Name it in SPEC and the holder guide. Before the lock, consider making the operator a multisig, or adding a liveness-triggered replacement path.

**F2b (LOW, doc).** The HOLDER-GUIDE honest list omits the permanent-stop-at-low-turnout consequence of a stolen guardian. It also omits the orphan-dilution cost that SPEC states.

## R5. Charter claim and SPEC 46

I found nothing omitted that changes the exposure. The same key can also run a paid-gate (extortion) variant. That is a subset of "gate claims".

## R6. One-time configuration and the trusted hop

- **Swap operator's worst case.** It is the cap per cooldown until the stop, as stated. A wrong accepted `swap_operator` or `bank_treasury` value is permanent, and F2 makes the operator one worse.
- **Royalty plugin.** I found no instruction anywhere that can alter it (authority None; MINT has no `UpdateCollectionV1` or Execute CPI).
- **Redemption ring.** It is exactly a 64-slot rolling window, with `kth = ring[(head+64−k)%64]`.

**F3 (LOW, ops): program IDs are public and a pre-funded address may block the CLI deploy.**
- The five ids are `declare_id!` constants and appear in SPEC.
- I believe `solana program deploy` refuses a system-owned address that already holds lamports ("not an upgradeable program or already in use"). I have not verified this. If true, a stranger can dust each id before deploy.
- The recovery is a hand-built transfer, allocate and assign signed by the program keypair, which also makes custody of `target/deploy/*-keypair.json` critical until deploy.
- **Test.** Dust a throwaway id and try the deploy in the rehearsal.

## R7. Raw reads

All offsets are correct. The sweep helper's classic-token reads are exact (mint 0, owner 32, amount 64, length 165).

## R8. Suite and build

**F4 (MEDIUM, process): the shipped bytes of the four keyed programs are never executed by any test.**
- The sweep helper had to drop its `localnet` feature so the tested bytes would be the shipped bytes. That shows a declared feature renames symbols and reorders `.text`, so the localnet and mainnet builds of the four keyed programs differ throughout, not only in the key.
- `build-mainnet.sh` compares only the helper. For the other four it admits "NOT PROVEN" and relies on source equality.
- **Fix.** Make `INIT_AUTHORITY` a contiguous 32-byte `#[used]` static read with `read_volatile`. Build once. The suite then runs a copy of the shipped `.so` with those 32 bytes patched to the test key. Verify with `cmp` that exactly 32 bytes differ.

**F5 (MEDIUM, process): the redeem page is the custody-critical code and is steered outside the audited set.**
- Road step 11 says to build it "OUTSIDE programs/, bank/ and scripts/" to avoid resetting the freeze. `audit-coverage.sh` lists only those directories, so the page would be excluded from the coverage gate.
- With no Bank, that page is the only control for items 9 and 44, and it chooses the sweep destination, which the helper does not bind.
- A compromised or phished page produces an opaque Core Execute that wallets cannot render.
- **Fix.** Put the page inside the coverage set, or build it before the freeze. Publish a reproducible client hash. Consider a helper variant that requires `dest == asset.owner`.

**F6 (LOW): missing arms and the verifiable build.**
- Missing arms: the F1 combination, a wSOL source, a non-ATA destination, `pob_extra = 8`, a 30-record `expire_boosts`.
- No `solana-verify` Docker build exists. Absolute paths in the artifact make third-party reproduction of the hash unlikely.

## The four questions on the accepted limits

1. **Worse than stated.** Limit 40 (heap and Autograph) is worse than stated, per F1. Limit 47 also applies to the swap operator (F2).
2. **Not actually a limit.** None found. Limit 36 is partly wrong: expiry never depends on a token account.
3. **Not actually discharged.** Item 19 is not fully discharged (F1).
4. **Blocking item treated as accepted.** The redeem page (item 50) is the blocking item most at risk, because the road plan routes it around the gates (F5).

## Before launch, what AI cannot do for you

- **Run the F1 measurement.** It is a 30-minute test on the pinned Core. Do this before anything else.
- **Reproducible build.** Build in a `solana-verify` Docker image and have an unaffiliated person reproduce all five hashes. Test the deploy against dusted ids, and keep the program keypairs offline.
- **Stage the lock.** Run the real lifecycle on mainnet under a Squads timelock multisig as upgrade authority, with real small deposits, a real Coinbase-like freeze drill on a test mint, and a live revenue cycle through both pools. Hold it for weeks. Fund a paid bounty before the authority is removed.
- **Real signers.** Redeem and claim with Ledger, Phantom and Backpack. Check blind-signing, message-size limits (the 1,209-byte shape is near the legacy cap), wallet simulation warnings, and a malicious-destination drill on the redeem page.
- **One human Solana reviewer, if you can bend the ruling.** Reading the Core-interaction cells and the F1 heap path is small, bounded work.
- **Differential fuzzing** of the accumulator against an independent model, with a live Core, using LiteSVM or Trident.
- **Key and operations.** Key ceremony for the guardian and operator, custody of `bank/keys`, and a written recovery runbook for F2.