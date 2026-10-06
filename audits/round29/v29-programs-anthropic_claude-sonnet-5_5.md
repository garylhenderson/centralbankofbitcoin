# Round 29 audit: independent read of the whole v6 tree (programs, sweep helper, harness)

**Result: no CRITICAL and no HIGH confirmed.** I found two MEDIUM issues and several LOW/INFO items. One MEDIUM is a measurement gap that becomes HIGH if the measurement goes the wrong way. I ran nothing. Everything below is from reading the bundle, so each finding says what evidence would exist if I am right.

**Not audited:** the bundle holds only `bank/txread.mjs` from the off-chain tree. `crank.mjs`, `alarm.mjs`, `detectors.mjs`, `swap.mjs`, `revenue.mjs` and `accrual.mjs` were not delivered, so I make no off-chain claims beyond the reader.

## R0. Round 28's verdict and repairs

- **Repairs present in this tree:** the `Log truncated` refusal in `txread.mjs`, the token-program pins, the expiry-budget test, the R28.A1–A4 arms, and the doc siblings D1–D3 (DESIGN 204, the MINT comments, GOV's action summary).
- **Residual from the verdict itself:** Round 28 was incomplete-quorum, so its repairs cannot clean it. The counter stays 0/2.
- **Regression introduced by a repair:** see F2.
- **Gap left in the Autograph work:** see F1.

## Findings

### F1. MEDIUM, would be HIGH if reachable: the level queue is coupled to Core's 32 KiB heap, and the combined worst case was never measured

- **Construct:**
  - `reveal_level` makes a Core `UpdatePluginV1` CPI that re-serializes the vault. The FIFO has no skip, and the program is immutable.
  - Core's allocator never frees.
  - R28.A2 shows Core already OOMs on a *shrink* of the 11,011-byte vault.
  - A reveal on that asset succeeded (R28.A1), but with a margin nobody measured.
- **What is unmeasured:**
  - R28.A1 reveals vault C1, which carries only the ~50-byte `charter` attribute. L.12 separately proves the 640-byte attribute budget, but only on a plain vault with no Autograph.
  - Nobody grew the Autograph by repeated signer additions to the largest state Core still accepts, then ran the reveal at that state.
  - The 56-signature probe used empty messages, and the message-size probe used one message.
- **Attacker and gain:**
  - The attacker mints a vault for the floor price (≥21,000 sats) and is its owner.
  - Before the reveal, the attacker adds Autograph and grows it, then adds the five owner plugins.
  - If the reveal then OOMs, every later vault is permanently unlevelled and unactivatable.
  - That is the analogue of discharged item 19, a customer-triggerable halt of the level queue. Item 19's "closed by construction" only covers activated-but-unlevelled vaults.
  - SPEC 40 records the Autograph boundary only as an owner-side inconvenience and does not mention this consequence.
- **Evidence if true:**
  1. On the pinned Core, create a vault with a 640-byte attribute list.
  2. Add all five owner plugins.
  3. Grow the Autograph with sequential adds, using a CPI payload-padding program, until Core refuses the next add.
  4. Simulate `reveal_level` at the last accepted state. An OOM there confirms the finding.
  5. Also bisect the reveal heap high-water mark from 10,150 bytes upward.
- **Fix (programs are still mutable pre-lock):**
  - Split the draw from the cosmetic write.
  - `reveal_level` records `level` in `VaultRecord` and advances `revealed_total` with no Core CPI.
  - A separate permissionless `write_level_attribute` does the Core write. It is best-effort and not on the FIFO path.
  - Payouts and `activate` already read the record, not the attribute.
  - This also removes the attribute re-supply hash and the 640-byte budget constraint.

### F2. MEDIUM: round 28's truncation repair lets a stranger blind the scanners with one cheap transaction

- **Construct:** `txread.mjs` `validateParsedTransaction` throws on the runtime `Log truncated` marker. Per SPEC's boundary note, scanners then keep their cursors and there is no automatic advance.
- **Attack:**
  - A stranger sends a transaction that references one of our program IDs, so it appears in `getSignaturesForAddress`.
  - The transaction also runs their own program that logs more than 10,000 bytes.
  - The transaction can be failed; it is still walked.
  - Cost is about 5,000 lamports.
- **Result:** every later pass fails at that signature, and nothing behind it, such as bare burns, sweeps or reschedules, is ever evaluated. The detection half of the control table goes dark until a human intervenes. The attacker can repeat the attack after each manual intervention.
- **Evidence if true:** feed the existing v1 fixture with an appended `"Log truncated"` entry and a later real burn signature behind it. The walker never reaches the burn.
- **Fix:**
  - Quarantine the unknown-coverage signature in a ledger: page once, then advance the cursor.
  - Evaluate the logs-independent detectors, which use instruction, inner-instruction and balance-diff evidence, on that transaction.
  - Mark only the event-only detectors unknown for it.
  - Add an operator `--skip <sig>` that records the skip.

### F3. LOW: SEAL's reserve list can lock a wrong custody list in forever, and nothing reads the signed result back

- **Construct:**
  - `assert_classic_spl` checks only that each passed account is owned by the Token program. It does not check the 82-byte length or `initialized`, so any token account passes as a "mint".
  - It does not refuse duplicates.
  - It allows 1 to 3 entries.
- **Consequence:** BURN's emptiness proof covers only the listed mints, and an unlisted token is destroyed on redemption. A two-mint list therefore silently destroys $GIRAFFISH forever.
- **Existing gate and its limit:** `check-launch-params.mjs` validates the JSON, not the signed transaction (item 38, A6).
- **Evidence:** a `solana-test-validator` run of SEAL `initialize` with a token account as `reserve_mints[0]`. It lands.
- **Fix:**
  - On chain, before the lock: require 82 bytes, `initialized`, and distinct keys. The suite's single-mint init would need adjusting.
  - Independently, add a post-`initialize` read-back verifier that decodes all four configs on chain and diffs them against `mainnet-init.json`. Run it before the lock; it does not exist in the tree.

### F4. LOW: `audit-coverage.sh` cannot see whole classes of evidence

- **Construct:** `have=` enumerates `programs/*/src/lib.rs`, `bank/*.mjs`, `scripts/*`, `tests/*.ts|mjs`, `SPEC.md`, and the root `Cargo.toml`/`Anchor.toml`.
- **Omitted:** `sim/*` (the 71-assertion simulation and its fixtures), `launch/*`, `HOLDER-GUIDE.md`, `DESIGN-v6.md`, `tests/cpi-wrapper/`, `tests/fixtures/`, and `programs/*/Cargo.toml`.
- **Why it matters:** the sweep helper's byte-identity argument rests on its `Cargo.toml` (no `localnet` feature). The freeze gate "every file has been in a prompt" cannot fail for any of these.
- **Fix:** `git ls-files`, minus an explicit exclude list.

### F5. LOW: the pinned dependency binaries are not archived

- **Construct:** `token-programs.sh` fetches Token-2022 and ATA from public mainnet RPC when the cache file is absent, then compares the hash to a pin.
- **Consequence:** Token-2022 upgrades often. After the next upgrade, a fresh checkout hard-fails every runner (`run-tests`, `build-mainnet`, `expiry-budget`, the sim) with "differs from its source pin". The certifying run cannot be reproduced without a source edit.
- **Fix:** commit or archive the three `.so` files, with hashes and Core's source commit and hash, so the ship gate is reproducible years later.

### F6. LOW: coverage gaps the suite cannot reveal (pinned by reading, not by running)

- **BURN rate ring:** nothing exercises `k > 2` or a head wrap past index 63 on chain. RL.7 asserts `total ≤ 64`. The arithmetic `(head + 64 − k) % 64` reads correct, but a host test at k=45 with wrap would cost nothing.
- **Sweep helper arms missing:**
  - a frozen destination;
  - a native wSOL source;
  - a delegated source;
  - a non-ATA destination;
  - two sources into one destination.
  - Only SR.14 (frozen source) and SR.12a (duplicate) exist.
- **No randomized stateful invariant test of the pool:**
  - `ledger()` runs at hand-picked points.
  - The one host test that drives the program's own functions (260 epochs) covers boosts, `join`, `retire` and `credit`, but not `claim` settlement, `monthly_inline` gating, or `retire_burned`.
  - A model fuzz over all host instructions would check bal ≥ ceil(owed), Σ per-vault owed == owed_scaled, Σ weights == total_active_weight, and the counters.

### F7. LOW (doc): HOLDER-GUIDE leaves out three accepted consequences

- Item 47: a stolen guardian key can keep sales and the sweep stopped permanently at under-half turnout.
- Item 45: governance is frozen once every vault is redeemed.
- The PoB holder concentration: if ≥15% of PoBs go unclaimed, the largest holder alone passes ordinary proposals (SPEC "Where this stands" 4).
- Items 40 and 46 are in the guide; these three are not.

## What I checked and could not break

- **Pairing:** top-level-only introspection, asset and owner binding at index 0 and 2 on both sides, and CPI wrappers all hold.
- **Emptiness proof:** BURN's byte offsets are correct, including 72..76, 121..129 and 129..133, and the Token-2022 ATA path is refused at creation.
- **Sweep helper (a)–(e):** the access control reduces to Core's `ExecuteV1`, and the destination is not compared to the owner. That is safe because Core only approves the owner on a thawed vault and the owner builds the transaction. A duplicate source dies on the second read (owner is System after the close). Nothing can re-fund the signer after the sweep inside one transaction. A stranger-created reserve ATA is neutralised by the prior-transaction create plus live sweep. A Token-2022 ATA for a classic mint is impossible.
- **Offsets and sizes:** I recomputed every offset and size from the struct definitions — `MintConfig` (679 → 1,005 plus padding), `VaultRecord` (211 + 10 padding = 221), `BurnConfig`, `Proposal` and the GOV action sizes. All match the tests' constants.
- **Pool arithmetic:** I traced credit, claim, join, retire, reweigh and expire.
  - `owed_scaled` equals the sum of per-vault `weight*acc + carry − debt` at every step.
  - The pool never falls below ceil(owed).
  - Boosts earn exactly N distributions. An empty tick cannot expire a boost, because ticks only occur at w=0.
  - The ring cannot alias, since end epochs are 1–63 ahead.
  - Records cannot be expired twice.
  - `expire_boosts` needs only records, so no token account can block the gate.
  - The pending counters cannot underflow.
- **Charter and governance:**
  - The Merkle domain separation and sorted-pair hashing are sound.
  - `pob_extra` is never forwarded as a signer.
  - Overtaken actions are skipped rather than reverted.
- **Rate limit:** it is an exact k-th-most-recent rolling window. The `>=` boundary is negligible.

## The four accepted-limit questions

1. **Is any limit worse than stated?**
   - **Limit 40 (Autograph boundary):** yes, F1. It is stated as an owner-side inconvenience but is a possible queue-halt vector.
   - **Limit 47:** compounded operationally, because the guardian is Gary's daily-use main wallet and also `INIT_AUTHORITY`. A dedicated hardware key would shrink it. This is a ruling, not for argument, but the exposure is worse than the document's tone.
2. **Anything listed as a limit that is not one?** No.
3. **Any DISCHARGED item not actually discharged?** Item 19 (see F1). Item 12/17's 58,956-CU figures are v5 and are not re-measured for v6 (the verdict's D1, already acknowledged).
4. **Is OPEN AND BLOCKING quietly treated as accepted?** No. Items 22, 38, 50 and 53 stay open. Item 53's rehearsal value set is still unbuilt, so road step 8 cannot start yet.

## R5, SPEC 46

SPEC 46 is essentially complete. One omission: the hot key can censor *individual* holders selectively, not just block everyone or admit only itself. With 30-minute alarm sampling that is hard to detect and shifts vote share without halting anything.

## What to do before launch that AI audit structurally cannot

1. **Dress rehearsal on mainnet at throwaway IDs.**
   - Run it under the shortened-period value set, which must be built first (item 53).
   - Cover one full cycle through each pool plus the forced post-sweep failure (item 22).
   - Run the crank live for the full tick-to-first-credit sequence.
2. **Measure F1 now.** Bisect the Autograph add limit against reveal on the pinned Core, then decide the decoupling fix. Ask Metaplex directly about Core's allocator behaviour and planned upgrades.
3. **Stateful property fuzz or model checking** of MINT's accounting (Trident, honggfuzz, or a Rust host harness). Run it for hours on all host instructions and check the invariants in F6.
4. **Reproducible builds.**
   - Do verifiable builds on two independent machines.
   - Dump the deployed program data from mainnet and compare it to `dist/SHA256SUMS` before removing the upgrade authority.
   - Archive the pinned Core and token binaries (F5).
5. **Ceremony tooling:**
   - Build the four `initialize` transactions from `mainnet-init.json`.
   - Have an independent decoder, run by a second person, confirm every argument before signing.
   - Run the read-back verifier (F3) immediately after.
6. **Key custody:**
   - Move the guardian to a dedicated hardware key.
   - Put the Moments update authority in cold storage or a multisig through the charter window.
   - Rehearse a restore of the box keys, including the $CBOB release wallet and the swap operator.
7. **Wallet testing of the redeem page.** The fully padded legacy shape has 23 bytes of margin. Test it with every wallet you intend to support (Phantom, Backpack, Ledger flows), since wallets can inject instructions or alter the transaction.
8. **A bug bounty before the lock**, with real money, scoped at the redemption, pool, level-queue and governance paths.
9. **Operational drills:**
   - Pool freeze.
   - A Core upgrade notice.
   - Stolen guardian key.
   - Stolen swap operator.
   - Runbooks that assume nobody can patch anything.
   - Alert-router delivery tested end to end.
10. **Non-technical review:** legal review of the revenue share and the charter window, and an economic review of the cohort and boost incentives.