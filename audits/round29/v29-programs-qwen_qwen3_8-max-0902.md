# Independent audit — current tree, post-round-28 repairs

I do not confirm the tree as clean. I also do not treat round 28’s verdict as authority. Where I could not execute code, I state the measurement that would prove or disprove the claim.

Round 28’s own verdict is **NOT CLEAN** and **INCOMPLETE QUORUM**. That cannot be repaired retroactively. The visible repairs in this bundle are present:

- `bank/txread.mjs` now refuses the standalone runtime `Log truncated` marker.
- `scripts/token-programs.sh` now pins actual mainnet Classic Token / Token-2022 / ATA bytes and verifies them on the local validator.
- `tests/expiry-budget.mjs` exists and exercises twenty synthetic due boosts under the default legacy budget.
- The suite includes the R28.A1–A4 and R28.F1/F2 arms.

But I found surviving and new defects below. None of the findings below are accepted limits re-reported; where an accepted limit is relevant, I say whether it is worse than stated.

---

## R0. Round 28 verdict and repairs

### R0-1. Round 28 remains NOT CLEAN and under quorum — do not count this tree as converging

**Construct:** `audits/round28/VERDICT-programs.md`, `audits/round28/VALIDATION.md`.

**What is true:** Round 28 explicitly says five substantive completed program auditors were counted and six are required. It also confirms five substantive findings. The counter is 0/2. The later validation run can show repairs landed; it cannot make round 28 complete or clean.

**Evidence that would exist if I am right:** The verdict file itself. It says “INCOMPLETE QUORUM” and “NOT CLEAN.”

**Fix:** Keep the freeze counter at 0/2. Run fresh frozen rounds with the required quorum. Do not cite the 855/855 post-repair run as cleaning round 28.

---

## R1. Custody / sealed-vault escape

No defect found that lets a non-owner extract value from a sealed vault under the pinned Core binary and the current program rules. The pairing checks asset and owner in both directions, uses top-level instruction introspection, and fails closed on drift.

The custody problem I do have is not theft; it is liveness. See F-1 under “Anything else” because it crosses R1/R3/R8.

---

## R1s. Sweep helper

### R1s-1. LOW — helper lamport destination is unconstrained; non-system destinations are allowed by design but not fully covered by tests

**Construct:** `programs/cbob-vault-sweep/src/lib.rs::process`, lamport sweep branch.

**What attacker or accident gains:** No stranger gain: only the owner can drive the helper through Core Execute. But a redemption client can choose a destination that is not a plain system wallet. The suite proves a lamport-only credit to a token account can succeed (`R27.S1`). It does not prove that every combination of token-pair closes plus lamport sweep succeeds when the destination wallet is a non-system account. SPL `CloseAccount` rent credit to a non-system destination is not the same operation as a System transfer.

**Evidence that would exist if I am right:** A test with one token pair and the destination wallet set to a token account: if SPL `CloseAccount` rejects a non-system rent destination, the redemption fails only at close, after the token transfer. That would be a client-shape refusal not currently pinned.

**Fix:** Add a suite arm for “one token pair + non-system destination wallet.” Either pin success or pin the exact refusal. Item 50 client rules should continue to require a normal system wallet as the sweep destination.

---

## R2. Community pool accounting

I recomputed the accumulator flow: `credit`, `claim`, `join`, `retire`, `reweigh`, `expire_boost`, `monthly_inline`. I did not find a violation of `pool balance >= ceil(owed_scaled / ACC_SCALE)` in the program logic.

One operational/accounting edge is worth pinning:

### R2-1. LOW — `activate` does not refuse a frozen vault cbBTC account

**Construct:** `programs/cbob-vault-mint/src/lib.rs::activate`, first call.

**What attacker or accident gains:** A vault whose cbBTC ATA is frozen can still request activation and later join. Claims to it defer, and redemption is blocked while the account is frozen. This is consistent with accepted limit 28, but the activation path does not surface the freeze early.

**Evidence that would exist if I am right:** Freeze a vault ATA, call `activate`; it succeeds. Later `claim` logs `CBOB_CLAIM_DEFERRED_FROZEN`, and redemption fails at sweep.

**Fix:** Optional. If not fixed, document in the redeem/claim client that activation of a frozen account is allowed but creates a deferred payout state.

---

## R2b. $CBOB boost

I did not find a boost accounting defect in the bundled MINT source. The ring, `boosts_due`, `boosts_active`, `boost_weight_total`, `carry_scaled`, and `reweigh` logic are internally consistent, and the host tests cover wrap cases.

One launch-configuration weakness:

### R2b-1. LOW — `initialize` does not prove the pinned `cbob_mint` has no mint/freeze authority

**Construct:** `programs/cbob-vault-mint/src/lib.rs::initialize`, `cbob_mint` checks.

**What attacker or accident gains:** If the one-time initialize is given a wrong classic SPL mint that still has a live mint authority, that authority can later inflate the boost token supply and buy boosts. The program checks only owner, length, initialization, and that the mint is not cbBTC/$GARY.

**Evidence that would exist if I am right:** Initialize with a local mint whose mint authority is a keypair; mint tokens from that authority; use them to `boost_vault`.

**Fix:** This cannot be fully fixed after lock. Before launch, `scripts/check-launch-params.mjs` or the launch ceremony must read the actual mainnet `cbob_mint` account and assert both mint authority and freeze authority COptions are `None`. Do not rely only on the JSON record.

---

## R3. Level draw

### R3-1. HIGH — owner-added Core bloat before reveal can halt the FIFO reveal queue

**Construct:** `programs/cbob-vault-mint/src/lib.rs::reveal_level`, specifically the live-asset branch that CPIs Core `UpdatePluginV1`; FIFO enforced by `RevealOutOfOrder`.

**What attacker or accident gains:** A vault owner can add owner-managed Core plugins before the vault is revealed. The suite itself does this with Autograph, FreezeDelegate, BurnDelegate, TransferDelegate, and FreezeExecute. Round 28 measured a 10,150-byte Autograph message where reveal still landed, and also measured that Core cannot shrink such an asset afterward. The missing question is: what is the largest owner-writable asset state for which Core `UpdatePluginV1` still succeeds? If there is any state an owner can legally write that makes the later `UpdatePluginV1` fail with heap exhaustion, the FIFO head becomes unrevealable. Because `reveal_level` must run strictly in mint order, every later vault’s level draw, activation, and payout path stalls until the owner burns the blocking asset or Core changes.

This is not the same as accepted limit 40. Limit 40 covers Metaplex changing Core. This is a current owner action against the pinned Core binary.

**Evidence that would exist if I am right:** On a local validator with pinned Core:

1. Mint a vault.
2. Add an Autograph message or other owner-managed plugin data at the largest size for which Core accepts the write.
3. Attempt `reveal_level` for that vault.
4. If the reveal fails with a Core memory allocation error while `revealed_total` remains unchanged, then every later vault refuses `RevealOutOfOrder`.

The suite’s current R28.A1–A4 prove one size works and that shrinking fails; they do not prove there is no writable-but-unrevealable size.

**Fix before lock:** This must be resolved before upgrade authority removal, because the FIFO has no skip path.

Minimum required:

- Measure the exact maximum owner-plugin/Autograph size that can be written and still revealed.
- Measure the first size where reveal fails.
- If those two boundaries overlap or cross, treat it as launch-blocking.

Possible pre-lock program responses, depending on measurement:

- Add a bounded reveal fallback for assets whose Core update fails for size reasons, with an explicit event and holder-guide disclosure.
- Or add a permissionless path to treat a live-but-unrevealable head vault as burned for FIFO purposes only, while preserving its record. This is invasive and should only be considered if the measurement proves the hazard.
- If measurement proves no writable state can make reveal fail, pin that proof as a suite arm with the exact boundary sizes.

---

## R4. Governance

No minority-carry or money-reach defect found beyond the disclosed concentration and guardian-stop limits.

### R4-1. LOW — proposals can be created for rounds that are already open or partially in the past

**Construct:** `programs/cbob-vault-gov/src/lib.rs::create_proposal`, `ProposalAction::SetRound` checks.

**What attacker or accident gains:** A proposal can set `opens_at` in the past as long as `closes_at > opens_at` and duration bounds hold. If executed while `closes_at` is still future, the round becomes immediately open. This is not theft; it is a vote surprising users with an instant round.

**Evidence that would exist if I am right:** Create and execute a proposal with `opens_at = now - 60`, `closes_at = now + 3600`; MINT `set_round` accepts and `mint_vault` is immediately possible.

**Fix:** Optional. If not fixed, the holder guide/off-chain tooling should state that a ratified round can open immediately on execution.

---

## R5. Charter claim

No new defect found in the Merkle verification, PoB ownership check, burn CPI, or window logic. The domain separation and sorted-pair construction are correct.

### R5-1. LOW — charter claim can mint to off-curve owners through CPI

**Construct:** `programs/cbob-vault-mint/src/lib.rs::claim_charter_vault`, owner signer model; suite `R27.C1`.

**What attacker or accident gains:** A program-owned PoB can claim a vault, producing an off-curve vault owner that cannot redeem. This is the same accepted impossibility as item 43, but the charter path makes it easy to encounter because the PoB can be held by a program/multisig-like construct.

**Evidence:** Suite `R27.C1` already demonstrates a program-owned PoB claim.

**Fix:** Do not change the program unless item 43 is reopened. The claim page and holder guide should explicitly warn that claiming from a program-owned or multisig-owned PoB can create a vault that can never be opened.

---

## R6. One-time configuration and trusted hop

### R6-1. LOW — several one-time values are accepted without the checks a launch mistake needs

**Constructs:**

- `programs/cbob-vault-mint/src/lib.rs::initialize`
- `programs/cbob-vaults/src/lib.rs::initialize`
- `programs/cbob-vault-burn/src/lib.rs::initialize`
- `programs/cbob-vault-gov/src/lib.rs::initialize`

**What accident gains:** Permanent misconfiguration. The programs already check many bounds, but they cannot check everything safely on BPF.

Specific weak accepts:

1. `guardian` and `swap_operator` may be off-curve. An off-curve guardian makes the brake unusable forever. An off-curve swap operator makes the sweep unusable forever.
2. SEAL reserve mints are checked only as accounts owned by classic SPL Token. They are not checked as 82-byte initialized mints, and duplicates are not refused.
3. MINT collection clean check verifies `num_minted == 0` and exact trailing length, but does not explicitly verify `current_size == 0`.

**Evidence that would exist if I am right:**

- Initialize with an off-curve guardian; later `emergency_stop_sales` fails for missing signature.
- Initialize SEAL with a token account as a “reserve mint”; later redemption derivation/checks become meaningless or bricking.
- If Core can produce a collection with `num_minted=0` and `current_size!=0`, MINT initialize accepts it.

**Fix:** These are launch-check obligations because the programs are immutable.

- `scripts/check-launch-params.mjs` or a separate pre-sign checker must assert on-curve status for guardian and swap operator.
- The launch checker must assert each reserve mint account is an 82-byte initialized classic SPL mint, no duplicates, and exactly the ruled three.
- Either add the `current_size == 0` check before lock, or record a measured Core invariant that `num_minted == 0` implies `current_size == 0`.

### R6-2. LOW — redemption window can be initialized to a value that changes the product

**Construct:** `programs/cbob-vault-burn/src/lib.rs::initialize`, `redeem_window_secs` bounds 10 seconds to 24 hours.

**What accident gains:** If mainnet is initialized with 10 seconds instead of 3600 seconds, the “2.1% per hour” cap becomes “2.1% per 10 seconds.” The alarm can detect after the fact, but the value is permanent.

**Evidence:** The program accepts any value in range.

**Fix:** Already covered by item 38, but the signed transaction builder should refuse to sign unless `redeem_window_secs == 3600`. Do not rely only on post-initialize alarm detection.

---

## R7. Cross-program raw reads

I recomputed the major offsets against the struct definitions.

### MintConfig v6

Offsets used by GOV/BURN match the struct order:

- version: 8
- collection: 9
- governance: 41
- pool_ata: 73
- round_id: 105
- price: 125
- minted_total: 141
- max_supply: 149
- bank_treasury: 157
- split_bps: 189
- sales_stopped: 191
- sweep_stopped: 192
- guardian: 193
- swap_operator: 225
- sol_reserve_lamports: 257
- max_sweep_lamports: 266
- sweep_cooldown_secs: 274
- charter_closes_at: 442
- charter_claimed: 450
- bare_burns_retired: 454
- total_active_weight: 462
- active_count: 470
- acc_scaled: 478
- owed_scaled: 494
- last_distribute_at: 510
- sales_stopped_at: 518
- sweep_stopped_at: 526
- monthly_secs: 574
- notice_secs: 623
- sweep_floor_lamports: 631
- cooldown_ceiling_secs: 639
- reserve_ceiling_lamports: 647
- dist_epoch: 655
- pending_count: 663
- pending_this_epoch: 671
- cbob_mint: 679
- max_boost_weight: 711
- max_boost_epochs: 712
- boost_price: 714
- boosts_active: 725
- boosts_due: 729
- boost_weight_total: 733
- cbob_burned_total: 741
- boost_expiring: 749

I did not find a mismatch in the bundled GOV/BURN constants.

### VaultRecord v4

- version: 8
- asset: 9
- mint_index: 41
- reveal_slot: 49
- level: 57
- charter: 58
- entropy_set: 59
- entropy: 60
- attrs_hash: 92
- bump: 124
- active: 125
- retired: 126
- reschedules: 127
- vault_ata: 129
- debt_scaled: 161
- pending: 177
- request_epoch: 178
- boost_weight: 186
- boost_end_epoch: 187
- carry_scaled: 195

GOV’s record read offsets match.

### BurnConfig v4

- version: 8
- collection: 9
- bump: 41
- burned_total: 42
- redeem_window_secs: 50
- rate_head: 58
- rate_ring: 59

GOV’s `OFF_BURN_TOTAL = 42` is correct.

### SealConfig v2

- version: 8
- collection: 9
- reserve_mints Vec length: 41

MINT/BURN `OFF_RESERVES = 41` is correct.

### Sweep helper token account read

- mint: 0..32
- owner: 32..64
- amount: 64..72
- length: 165

Correct for classic SPL.

No offset finding.

---

## R8. Suite, simulation, build, and evidence

### R8-1. HIGH — `scripts/audit-coverage.sh` omits load-bearing paths

**Construct:** `scripts/audit-coverage.sh`, `have=...` line.

**What attacker or accident gains:** The gate is supposed to ensure every system file has been in at least one audit prompt. The current `have` list includes:

```text
programs/*/src/lib.rs
bank/*.mjs
scripts/*.sh
scripts/*.mjs
tests/*.ts
tests/*.mjs
SPEC.md
Cargo.toml
Anchor.toml
```

It does **not** include:

- `sim/*.ts`
- `sim/*.mjs`
- `launch/*.json`
- `DESIGN-v6.md`
- `HOLDER-GUIDE.md`
- `tests/cpi-wrapper/src/lib.rs`
- `tests/fixtures/*.json`
- audit verdict/validation files, if those are meant to be auditable evidence

These are not optional. `sim/test-vault.ts` is the redemption simulation. `launch/mainnet-init.json` is the one-time value file. `HOLDER-GUIDE.md` is the promise surface. `tests/cpi-wrapper/src/lib.rs` is deployed to the test validator and shapes the WR arms. `tests/fixtures/mainnet-v1.json` is reader evidence.

**Evidence that would exist if I am right:** Run the `ls` command used by the script. The omitted paths are absent. The script can exit 0 while those files have never been bundled.

**Fix:** Expand `have` to include at least:

```bash
programs/*/src/lib.rs
programs/cbob-vault-sweep/Cargo.toml
bank/*.mjs
scripts/*.sh
scripts/*.mjs
tests/*.ts
tests/*.mjs
tests/cpi-wrapper/src/lib.rs
tests/fixtures/*.json
sim/*.ts
sim/*.mjs
launch/*.json
SPEC.md
DESIGN-v6.md
HOLDER-GUIDE.md
Cargo.toml
Anchor.toml
```

Then re-run coverage and bundle anything newly listed.

### R8-2. MEDIUM — accepted limit 32 understates redemption-cap inflation by unretired bare burns

**Construct:** `programs/cbob-vault-burn/src/lib.rs::burn_vault` rate limit; `read_mint_supply`; `programs/cbob-vault-mint/src/lib.rs::retire_burned`.

**What attacker or accident gains:** BURN computes live supply as:

```text
minted_total - burned_total - bare_burns_retired
```

A bare Core burn does not increment `bare_burns_retired` until someone calls `retire_burned`. Therefore every unretired bare-burned vault remains in the computed live supply. Accepted limit 32 says the cap can read “one higher” while the crank retires it. That is too narrow: if N bare burns are unretired, the computed live supply can be N higher than the true live supply.

An attacker who controls many vaults can bare-burn some of them and leave them unretired to raise the redemption cap for the remaining vaults. The cost is destroying their own vaults, but the stated limit should not say “one higher.”

**Evidence that would exist if I am right:** Bare-burn several vaults without calling `retire_burned`; read MINT `minted_total`, BURN `burned_total`, and MINT `bare_burns_retired`; compute the cap. It will reflect the unretired bare-burned vaults.

**Fix:** Correct SPEC item 32 and any holder-facing copy. Operationally, keep the crank’s retire-bare-burns step early and loud. Optionally add an alarm for “unretired bare burns count” rather than assuming one.

### R8-3. LOW — token-program pins are snapshots with no continuous upgrade watch

**Construct:** `scripts/token-programs.sh`.

**What accident gains:** The runner pins mainnet Token/Token2022/ATA bytes by sha256. This is good for reproducibility, but if mainnet’s token programs change, the local validator will keep testing against stale pinned bytes until a human re-pins. The alarm list described in SPEC watches Core, Orca, Meteora, Pyth, and our programs; I do not see a continuous watch for the three token-program pins.

**Evidence:** The expected hashes are hardcoded in `TOKEN_PROGRAM_PINS`.

**Fix:** Add a periodic mainnet re-hash check or an alarm detector that compares the pinned hashes to current mainnet programdata. If re-pinning is deliberate, require a commit.

### R8-4. LOW — `bank/txread.mjs` depends on a private SDK transport

**Construct:** `bank/txread.mjs::readParsedTransaction`, use of `conn._rpcRequest`.

**What accident gains:** The reader bypasses the installed SDK’s version-limited decoder by calling a private field. A future web3.js change can remove or alter `_rpcRequest`, breaking every consumer that imports this reader. The code checks `typeof conn?._rpcRequest !== 'function'`, but that only turns a silent API change into a thrown error.

**Evidence:** The source uses `conn._rpcRequest('getTransaction', ...)`.

**Fix:** Pin the web3.js version used by the pipeline and add a selftest arm that fails if `_rpcRequest` is absent. Longer term, use a maintained RPC client that supports v1 parsed responses or vendor the transport explicitly.

### R8-5. LOW — v1 `transactionConfig` is under-validated

**Construct:** `bank/txread.mjs::validateParsedTransaction`, v1 branch.

**What accident gains:** For version 1, the reader only requires `object(m.transactionConfig)`. It does not validate that `computeUnitLimit`, `loadedAccountsDataSizeLimit`, or `heapSize` are present and sane. If consumers later rely on those fields, malformed fixtures or RPC responses could pass.

**Evidence:** The code checks only `need(object(m.transactionConfig), 'v1 transactionConfig')`.

**Fix:** Validate the specific fields the reader’s consumers require, at least as non-negative safe integers, or document that `transactionConfig` is opaque.

### R8-6. LOW — documentation drift still exists in DESIGN-v6

**Construct:** `DESIGN-v6.md`, section 3 community pool bullet for `activate`.

**What accident gains:** The early bullet still says `activate` “adds the level weight … to total_active_weight and creates the vault's stake record with debt = weight * acc.” That was pre-stage-3c behavior. The code and later DESIGN text require a request, then join after a distribution. A reader using the first bullet can misunderstand payout eligibility and join timing.

**Evidence:** Compare DESIGN-v6 section 3’s first `activate` bullet with `programs/cbob-vault-mint/src/lib.rs::activate` and the later “Why activation joins at the NEXT distribution” section.

**Fix:** Rewrite the bullet to say: first call requests activation; join occurs only after `dist_epoch` has advanced past the request, via `activate` again or `claim`.

### R8-7. INFO — no landed redemption at the Core heap boundary

**Construct:** Suite arms `R28.A3` and `R28.A4`.

**What is missing:** R28.A4 simulates transfer and full redemption for the large-autograph vault. It does not land the redemption. Simulation is strong evidence, but for an immutable launch, a landed boundary redemption on a disposable vault would be stronger.

**Evidence:** The arm uses `simulateTransaction` and then asserts the asset is unchanged.

**Fix:** If a disposable vault can be put in the same boundary shape without breaking later suite dependencies, land the redemption once and pin the result.

---

## Accepted limits — the four required attacks

### 1. Is any accepted limit worse than stated?

Yes.

- **Item 32** is worse than stated. The cap can be inflated by more than one while bare burns remain unretired. See R8-2.
- **Item 40** is incomplete rather than wrong. It covers Core upgrade risk but does not cover an owner-written Core bloat state that can make the FIFO reveal queue halt. See R3-1.

### 2. Is anything listed as a limit not actually a limit, already closed, or closed unnoticed?

I did not find an accepted limit that is fully closed but still listed, except where the authors already mark it as accepted residue. The narrow owner-payer packet variant in item 42 is a measurement, not a closed page contract; it should remain listed.

### 3. Is any discharged item not actually discharged?

I did not prove a discharged item false. However:

- **Item 54** is discharged for legacy/v0 default-budget shapes. It should not be read as covering v1 or arbitrary wallet-injected compute-budget behavior. The SPEC transaction-format boundary already says this, but any future client must not inherit item 54’s conclusion.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

Not in the bundled text, but the risk is high:

- **Item 50** is still open. The holder guide is marked DRAFT, but it speaks in present tense about pages that do not exist. It must not be published.
- **Item 22** is still open. The 855/855 local validator run is not a live-chain dress rehearsal.
- **Item 38** is still open: `charter_opens_at` and `lock_deadline` are null in `launch/mainnet-init.json`.
- **Item 52** is still open: pool/Squads/revenue token accounts must be created and funded before first split/mint.
- **Item 53** is still open: rehearsal proof must be re-run at the final release commit, not only at a repair commit.

---

## Anything else

### F-1. HIGH — Core heap boundary plus FIFO creates a possible permanent liveness brick

This is the same as R3-1, restated here because it is the most important program-side issue I see.

**Construct:** `reveal_level` FIFO and Core `UpdatePluginV1` heap behavior.

**Why it matters:** The design refuses to assign a level without entropy and refuses to reveal out of order. Both are good fairness properties. Together with Core’s fixed 32 KiB heap and owner-writable asset bloat, they create a possible state where the head of the queue cannot be revealed, and no later vault can be revealed.

**What to do before launch:** Measure the exact writable/updatable boundary. If any owner-writable state can make reveal fail, fix before lock or explicitly accept with a named control. Do not leave it as an unmeasured corner of item 40.

### F-2. MEDIUM — coverage gate is weaker than the process requires

See R8-1. For a project whose entire certification is AI audit, the coverage gate is structural. Omitting `sim/`, `launch/`, holder docs, fixtures, and the CPI wrapper is not a minor script issue.

### F-3. LOW — several negative arms depend on local fixture mints with authorities

The suite creates local cbBTC/$CBOB-like mints with mint authorities so it can fund tests. That is necessary. But some launch properties (no mint authority, no freeze authority) are therefore not exercised by the suite against the real mints. The mainnet probe covers some of this, but the ceremony must still verify the actual initialize transaction uses the real ruled mints.

---

# Given no human firm and immutable programs: what must be done before launch that AI audit structurally cannot do?

AI audit can read, simulate, and compare. It cannot own keys, witness physical custody, operate live money safely, or take responsibility. Before lock, the project should do at least the following concrete non-AI-only steps:

1. **Two independent human reproducible-build ceremonies.**
   - Two separate humans, on separate machines, rebuild all five programs from the exact release commit.
   - Each produces sha256 manifests.
   - Compare against `scripts/build-mainnet.sh` output and against the on-chain programdata hashes after deploy.
   - Sign the manifest with a hardware key. AI can compare hashes, but it cannot attest that the build environment was not compromised.

2. **Hardware-key ceremony for INIT_AUTHORITY, guardian, and swap operator.**
   - Generate or verify these keys offline.
   - Use hardware wallets or equivalent for the one-time initialize signatures and for the guardian brake.
   - Record the public keys in a signed manifest.
   - AI cannot prove private-key custody or prevent physical key exfiltration.

3. **Live dress rehearsal with real small amounts, not just local validators.**
   - Run the crank, alarm, and revenue cycle against the rehearsal deployment.
   - Complete one full Orca cycle and one forced Meteora fallback cycle.
   - Force a post-sweep failure and recover by hand.
   - A human must observe paging, acknowledge alerts, and sign off. AI cannot safely operate live funds or judge real-world alert delivery.

4. **Human-controlled charter-window monitoring for the hot PoB collection authority.**
   - The ruling keeps the key hot. AI cannot custody it.
   - Assign named humans with on-call rotation for the entire 7-day charter window.
   - Require two humans to acknowledge any plugin/authority change alarm before the window closes.
   - Pre-authorize the response: pause claims operationally, notify holders, and preserve evidence. The program cannot pause the charter claim, so human response is the only control.

5. **Manual review and sign-off of holder-facing copy.**
   - The holder guide must be reviewed by a human owner who can accept product risk.
   - Every present-tense promise about pages must either be implemented or rewritten.
   - AI can check consistency, but cannot decide whether a promised surface is acceptable to publish.

6. **Manual verification of the signed initialize transactions.**
   - The checker validates JSON, but a human must verify the actual signed transactions match `launch/mainnet-init.json`.
   - Verify each initialize transaction’s accounts and arguments before signing.
   - Verify `charter_opens_at`, `lock_deadline`, `redeem_window_secs = 3600`, `monthly_secs = 2592000`, `notice_secs = 604800`, `min_voting_secs = 259200`, quorum 2100, threshold 5100, and the exact reserve/payment/PoB keys.

7. **Upgrade-authority removal with multi-person control.**
   - Do not remove upgrade authority from a single shell session.
   - Use at least two humans, one command each, with a written checklist.
   - Verify all five programs, including the sweep helper, are immutable afterward.
   - Record the verification output in the launch manifest.

8. **External dependency watch with human escalation.**
   - Metaplex Core, cbBTC, Orca, Meteora, Pyth, and the token programs are outside the project’s control.
   - AI can detect changes only if run. A human must be paged and empowered to act.
   - Define explicit escalation thresholds: Core upgrade, cbBTC freeze authority use, oracle staleness/confidence breach, pool program upgrade, token-program pin mismatch.

9. **Physical/operational security review of the box holding the swap operator and $CBOB release key.**
   - AI cannot inspect host compromise, backup access, cron tampering, or SSH exposure.
   - A human should review access logs, backup custody, file permissions, and key rotation procedure.
   - The $CBOB release wallet and swap operator key are single-box risks; only operational controls can reduce them.

10. **A final “no-launch” rehearsal.**
   - Run a rehearsal where the launch is deliberately aborted after initialize but before authority removal.
   - Verify the team can stop, diagnose, and restart without losing the one-time configuration.
   - AI cannot prove operational discipline under abort conditions.

End of report.