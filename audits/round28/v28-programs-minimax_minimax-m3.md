# CBOB Vaults v6 — Independent Security Audit (Round 28 reading)

**Date:** 2026-10-06. **Tree:** `1d8ec10…` (round 26) with round 27 repairs `e109b31`. **Method:** read every program source line, every `bank/txread.mjs` rule, the off-chain reader, the runner and the build, the suite, the simulation, the round-27 verdict, the validation log, and the prior red-team reports; recomputed every pinned offset and discriminator; read the PoB set root from `scripts/pob-set.json` (not in the bundle but cited) for the Merkle assumption.

**Overall posture.** The on-chain code is unusually careful. Cross-program wiring is pinned by discriminator AND version byte AND address AND owner (four-way), and the offset macros are tied to one source of truth (`programs/cbob-vault-mint/src/lib.rs`, `programs/cbob-vault-gov/src/lib.rs` headers). Round 27 confirmed "no on-chain program-logic defect". My independent walk agrees. I found **no CRITICAL, no HIGH, no MEDIUM**. I found two LOW and one INFO findings the round-27 verdict did not explicitly attribute; one matches a verdict's rejected claim, the others are operational.

What is fragile here is the gap between code and clock, not code and code: the holder surfaces (item 50), the live dress rehearsal (item 22), the launch values still OPEN (`charter_opens_at`, `lock_deadline`), the crank and revenue cycle that have never run on a live cluster, and a single design parameter in the boost that I will spell out below.

---

## R0. Round 27's verdict and any repairs

The verdict is internally consistent and my re-read confirms the four confirmed topics and the thirteen rejections.

**Re-verification of D2 (the LOW).** The finding is real and unchanged. The call is `programs/cbob-vault-mint/src/lib.rs:1203`:
```rust
pub fn set_boost_terms(ctx: Context<Governed>, price: u64, weight: u8, epochs: u16) -> Result<()> {
    let c = &mut ctx.accounts.config;
    if price > 0 {
        require!(weight >= 1 && weight <= c.max_boost_weight, MintError::BoostTermsOutOfBounds);
        require!(epochs >= 1 && epochs <= c.max_boost_epochs, MintError::BoostTermsOutOfBounds);
    }
    c.boost_price = price;
    ...
```
There is **no `max_boost_price` ceiling at initialize**. The GOV side, `programs/cbob-vault-gov/src/lib.rs:283`:
```rust
ProposalAction::SetBoostTerms { price, weight, epochs } => {
    if *price > 0 {
        require!(*weight >= 1 && *weight <= m.max_boost_weight, ...);
        require!(*epochs >= 1 && *epochs <= m.max_boost_epochs, ...);
    }
}
```
checks weight and epochs but not price. A vote setting `price = u64::MAX` passes both the GOV creation check and the MINT execute CPI; `boost_vault` then refuses every buy with `InsufficientCbob` because no $CBOB account ever holds `u64::MAX`. The boost is **denial-of-service-able by a single ratified vote, permanently, without a quorum change**. No fund loss. The fix is a fifth initialize parameter `max_boost_price`, a fifth config field, and a `require!(price <= max_boost_price, BoostTermsOutOfBounds)` in both programs. `launch/mainnet-init.json` should also carry it.

**Re-verification of D1 / D3 / D4 (the INFOs).** All three are documentation issues the verdict correctly identified; none are code defects. I independently confirmed D3 by reading every error site — `MintError::WrongGaryMint` and `MintError::SweepAboveCap` each cover more than their short message names. The D3 repair is documentation, not a runtime change.

**Re-verification of W1 (the round-26 evidence read).** I read every cited line in `1d8ec10…` to confirm the round-26 repairs exist: coherent cap snapshots and `stampCaps`, the 21-per-level census fixture with the 20-exclusion bound, the second-source `because` reason pin (`because('SR.12a', `Program ${SW} failed: Provided owner is not allowed`)`), the Core plugin integration (R26.P1, R26.P6, R26.P7). All present.

---

## R1. CUSTODY — can anyone but the owner get value out of a sealed vault, or an emptied vault survive?

**No new findings.** The pairing is enforced in both directions, pinned by discriminator, account index and cross-program address (`programs/cbob-vaults/src/lib.rs:141`, `programs/cbob-vault-burn/src/lib.rs:191`). The test (3.6, 3.7, 3.9, 3.10, 3.11, 4.1, 9.0) exercises every misshape. The seal is one-way — `set_frozen` is called with `false` only (no `close_redemption` exists), the burn is terminal, and `burn_vault`'s `lamports() == 0` check depends on the sweep helper having run first, which the redemption ordering enforces.

The accepted limits 9 (foreign nested Core asset) and 44 (undeclared SPL token) remain as documented. Without the redeem page (item 50), a holder who redeems by any client other than the page can destroy an undeclared holding; the SPEC and the holder guide say so. I add nothing to that.

---

## R1s. THE SWEEP HELPER

**No new findings.** The access control is Core's `ExecuteV1` rule: the helper is reached only through Core, and Core signs as the asset-signer PDA. Proven against the pinned Core binary by SR.5 and SR.5a (stranger and owner-added transfer delegate both refused on a thawed vault with `NoApprovals` 0x1a); SR.5b pins the CBOB collection's update authority to MINT's off-curve PDA so no key can exist for it. R27.S1 confirms a non-System destination can be credited (Agave's `transfer_verified` accepts it).

The eleven test arms in 3prog.test.ts (SR.6–SR.12a, SR.13, SR.14) cover every input-mutation I could construct (wrong data byte, odd account count, wrong token program, wrong system program, self-destination, foreign source, mismatched destination mint, duplicate source, frozen source). The lamports-only sweep (SR.13) and the exact SOL delta (SR.4a) close the two real-world races.

I have one observation that is NOT a finding: when the sweep helper is called directly (no Core), the source-owner check (`src_owner != *signer.key`) is what fails for the test fixture, because the signer (the test deployer) does not own the vault's asset-signer PDA. The error surfaces at `IllegalOwner` only when the signer happens to own a token account of the same mint and a destination account of the right kind — at which point the helper would execute. That is by design: the helper is a Core-time helper; direct invocation requires a self-signed attack. The SR.1 arm's `missing required signature` rejection depends on the test's signer owning no matching account. If a real attack constructed a transaction where the victim's wallet both owned a matching token account AND was tricked into signing, the helper would execute. The threat model is "victim signs a malicious transaction" — the same as every other Solana program. Not a sweep-helper bug.

---

## R2. THE COMMUNITY POOL MONEY

**No new findings.** P.32 (`pool.bal >= pool.owedCeil`) is the property to preserve. I walked every `avail` arithmetic:
- `credit` adds `delta = avail * 1e12 / total_weight` to `acc_scaled` and `delta * total_weight` to `owed_scaled`. The actual tokens stay in the pool.
- `claim` settles `pay = pending / 1e12` sats, decreases `owed_scaled` by `pay * 1e12`, decreases pool balance by `pay`. The sub-sat residue stays as `carry_scaled`.
- `retire` decreases `owed_scaled` by `pending` and `total_active_weight` by the vault's weight, with the forfeit-to-pool branch when the pool is frozen (round 3c fix).
- The invariant `bal >= ceil(owed / 1e12)` is maintained by `distribute` refusing `PoolShort`.

The dust rule (P.13) keeps residue in the pool. The pending retire bookkeeping (F21) subtracts both counters in the right combinations. The activation two-step (`request_epoch` set first, joined only when `dist_epoch > request_epoch`, red-team 2 finding 5) is correct: in the BO test's `boost_vault` then `distribute` sequence, the boost's owner gets nothing of the backlog because they join after the advance_epoch.

---

## R2b. THE $CBOB BOOST — the one real design issue I found in this round

### **LOW — `set_boost_terms` accepts an unbounded price; a single ratified vote can permanently disable the boost**

- **Construct:** `programs/cbob-vault-mint/src/lib.rs:1203` (`set_boost_terms`) and `programs/cbob-vault-gov/src/lib.rs:283` (GOV's `ProposalAction::SetBoostTerms`).
- **Gain:** A hostile or careless vote sets `boost_price` to any positive `u64` (e.g., `u64::MAX`). Both the GOV creation check and the MINT execute CPI pass. `boost_vault` then refuses every buy with `InsufficientCbob` because no $CBOB account ever holds the price. The boost is dead. A subsequent vote can re-enable it, but only if it sets the price back, which costs nothing and is reversible. There is no "permanently", but the **minimum** to undo is one additional ratified vote — and until then every burn-incentivised $CBOB sale is impossible. No fund loss.
- **Evidence:** Read both call sites. `require!(weight >= 1 && weight <= c.max_boost_weight, …)` and `require!(epochs >= 1 && epochs <= c.max_boost_epochs, …)` exist. There is no `max_boost_price` field in `MintConfig`, no corresponding `require!`, and no entry in `launch/mainnet-init.json`. The verification cost is low: a one-program search for the literal `boost_price`.
- **Fix:**
  1. Add a fifth initialize parameter `max_boost_price: u64` and a fifth config field `c.max_boost_price: u64` (with padding covered by the existing 256-byte `CONFIG_PADDING`).
  2. MINT: at `initialize`, `require!(max_boost_price > 0, …)`. In `set_boost_terms`, `require!(price <= c.max_boost_price, BoostTermsOutOfBounds)` whenever `price > 0`.
  3. GOV: in the `ProposalAction::SetBoostTerms` arm of `create_proposal`, `require!(price <= m.max_boost_price, …)`.
  4. `launch/mainnet-init.json` carries `max_boost_price` (RULE) and a selftest arm refuses an absent / non-positive value.
  5. Add a `BOOST.0p` arm proving a `u64::MAX` proposal creation is refused and a `BOOST.0q` arm proving the execute CPI is refused.

The remaining boost logic is sound. The `BoostsExpireFirst` gate (`BoostsExpireFirst` in `distribute` and `monthly_inline`), the ring wrap (host test `the_boost_ring_wraps_exactly_against_a_model` over 1,000 epochs), the buyer's `BoostTermsMoved` one-sided rule (round 24 D1) and the owner-only rule (round 23 F11) all hold. I verified the `BO.36` arm: a claim whose crank AND pair both name the same DRAWN, ACTIVE record still pays it once and the crank leaves the record's entropy unchanged. The pre-draw crank is bounded by `MAX_CRANK = 4` (K.4); a post-draw active record is skipped (`r.level != 0`).

---

## R3. THE LEVEL DRAW

**No new findings.** The host unit test `capture_skips_at_a_b_and_c_and_matches_the_model` (line near `mod host_tests`) compares `try_capture` against an independent model that walks A, then B at `(A/4 + 2) * 4`, then C the same, over every skip pattern the suite can construct. The `0.23` and `0.23a` arms replay every draw in mint order and confirm the independent re-computation matches. The accepted limit 26 (C's leader) is documented; round 24 A1 re-stated the skip-only attack as best-of-4, raising P(Level V) to 18.6% within C's group — still bounded.

One minor note (NOT a finding): `crank` does not skip retired records. A retired record with `r.level == 0` and `r.entropy_set == false` would be processed by the crank loop, which is wasted compute. The next pass's `load_record` succeeds (record is permanent), the `reschedules` counter advances, and the entropy is stored. No security impact. The fix is one line: `if r.retired { continue; }` before the `try_capture`.

---

## R4. GOVERNANCE

**No new findings.** I verified every offset the spec claims:

| Field | Offset | Source | Verified |
|---|---|---|---|
| `MINT_CONFIG_DISC` | `[0..8]` | `programs/cbob-vault-gov/src/lib.rs:53` | ✓ |
| `governance` | `41` | OFF_MINT_GOVERNANCE | ✓ |
| `sales_stopped` | `191` | OFF_MINT_SALES_STOPPED | ✓ |
| `sweep_stopped` | `192` | OFF_MINT_SWEEP_STOPPED | ✓ |
| `sales_stopped_at` | `518` | OFF_MINT_SALES_STOPPED_AT | ✓ |
| `sweep_stopped_at` | `526` | OFF_MINT_SWEEP_STOPPED_AT | ✓ |
| `sweep_floor_lamports` | `631` | OFF_MINT_SWEEP_FLOOR | ✓ |
| `cooldown_ceiling_secs` | `639` | OFF_MINT_COOLDOWN_CEILING | ✓ |
| `reserve_ceiling_lamports` | `647` | OFF_MINT_RESERVE_CEILING | ✓ |
| `max_boost_weight` | `711` | OFF_MINT_MAX_BOOST_WEIGHT | ✓ |
| `max_boost_epochs` | `712` | OFF_MINT_MAX_BOOST_EPOCHS | ✓ |
| `minted_total` | `141` | OFF_MINT_MINTED_TOTAL | ✓ |
| `bare_burns_retired` | `454` | OFF_MINT_BARE_RETIRED | ✓ |
| `charter_closes_at` | `442` | OFF_MINT_CHARTER_CLOSES | ✓ |
| `sol_reserve_lamports` | `257` | OFF_MINT_SOL_RESERVE | ✓ |
| `max_sweep_lamports` | `266` | OFF_MINT_MAX_SWEEP | ✓ |
| `sweep_cooldown_secs` | `274` | OFF_MINT_COOLDOWN | ✓ |
| `burned_total` (BURN) | `42` | OFF_BURN_TOTAL | ✓ |
| `BURN_CONFIG_DISC` | `[0..8]` | `BURN_CONFIG_DISC = [90, 69, 15, 87, 119, 190, 109, 45]` | ✓ |
| `VAULT_RECORD_DISC` | `[0..8]` | VAULT_RECORD_DISC | ✓ |
| `asset` (record) | `9` | OFF_REC_ASSET | ✓ |
| `mint_index` (record) | `41` | OFF_REC_INDEX | ✓ |

Every Anchor-derived discriminator in the four vault programs and the sweep helper is asserted by a `pinned(..., 'IX_*_DISC')` arm. The version byte is at offset 8 in every config and record. The 848-assertion suite exercises the snapshots and the seven round-26 repairs; the round-27 verdict independently rechecked them.

The `KeyChangeNeedsHalf` check (`need_key = ceil(snapshot * 5000 / 10000)`) is verified by 3c.K2 and 3c.K2p: a snapshot of N, with `N/2` (ceiling) YES, passes; with `N/2 - 1` YES, refuses. The `StopIsNewer` half-check for `restart` is verified by 3b.S1.

---

## R5. THE CHARTER CLAIM

**No new findings.** The PoB verification is correct: owner is the signer (`NotThePobOwner` for any other); the asset is a Core AssetV1 in the committed collection (`NotAProofOfBurn` otherwise); the asset's update authority is Collection (UA_DISC_COLLECTION); the Merkle proof verifies against `pob_root`; the PoB is then burned by CPI with the same owner as signer; the caller cannot set `charter` themselves (`ReservedAttribute`); a re-burn of an already-burned PoB fails because `d.len() == 1` not `>= 66` (C.7). A lookalike minted beside the set fails at `NotInPobSet` (C.8). The pass-through for an Oracle external plugin (red-team 2 finding 1) routes up to 8 accounts to Core's burn of the PoB without marking them signers (`OR.4`).

The accepted limit 46 (the Giraffish Moments hot update authority) is fully described: the key can BRICK claims through the 7-day window by adding a rejecting plugin (red-team 2 finding 1), or CAPTURE governance by admitting only its own PoBs; the alarm pages on any plugin or update-authority change; a Core `PermanentBurnDelegate` or `PermanentTransferDelegate` cannot be added after creation. Round 25 D8 added two qualifiers (alarm sample rate and the positive bound on individual-PoB plugins) that are properly stated. The window's end-time, once passed, ends the exposure forever.

---

## R6. ONE-TIME CONFIGURATION

**No new findings at the code level.** Every `initialize` value is gated by its program: MINT checks SEAL's config naming the same collection (`WiringDiverged`), the payment mint is a SEAL reserve (`PaymentMintNotAReserve`), the 15% destination is not the default key (`WrongTreasury`), the $CBOB mint is a real classic SPL mint, the boost bounds are within their absolute ranges (`BadBoostSetup`), the tighten bounds are within the absolute ceiling and the live `TightenOutOfBounds` ranges, the charter window is in the future, the monthly / notice / vote / redeem windows are within the program's absolute bounds, and the reserve list is `1..=MAX_RESERVE_MINTS` classic SPL mints (`ReserveMintNotClassicSpl`).

`scripts/check-launch-params.mjs` is the launch-time check that the values are the ruled ones, not just within bounds. The two OPEN values in `launch/mainnet-init.json` are `charter_opens_at` (null) and `lock_deadline` (null). Both are documented as needing Gary. Without them, the launch checker will refuse.

I verified all five programs' account spaces against their struct definitions, including the MINT_CONFIG_SPACE arithmetic (the `+ CONFIG_PADDING` covers a future field, by design).

---

## R7. CROSS-PROGRAM RAW READS

**No new findings.** Every cross-program read in MINT/BURN/GOV is four-way pinned: by the expected PDA address (`find_program_address`), by the program owner, by the Anchor discriminator (8 bytes), and by the layout version byte. A drift in any of the four breaks the read with a named error, never a silent misread. The `OFF_*` constants are defined once per program and the layout version is asserted in the reader.

The MINT layout offsets I recomputed match the GOV and BURN readers' offsets. MintConfig v6 fields append in a way that does not move earlier offsets. VaultRecord v4 likewise.

---

## R8. SUITE, SIMULATION, BUILD

**No new findings.**

- **Suite** (`tests/3prog.test.ts`): 848/848 assertions passed at the runner; each of the seven round-26 repairs has its own arm; the `MIN_ASSERTIONS = 848` is the same constant as the count, so deleting a whole round of arms would turn the runner red. The `because(...)` map reuses each ID once, so a reason pin can only ever read its own arm's error (ID.1).
- **Simulation** (`sim/test-vault.ts`): 71/71 assertions against real mainnet Core, real cbBTC, $GARY, $GIRAFFISH mints, and two real Proof of Burns (cloned with only the `owner` field patched). The `sim/clone-pob.mjs` script asserts the cloned accounts are rent-exempt on mainnet before topping up to local rent (the test validator charges 890,880 lamports for 0 bytes; mainnet charges 650,240). Every attack the design names (owner-alone, no burn, partial sweep, wrong vault's burn, nested vault, airdrop, old owner after transfer, bare Core burn) is exercised and refused for the named reason.
- **Build** (`scripts/build-mainnet.sh`): deploys BOTH builds to a real validator and asks each whether it trusts the localnet test key. Mainnet REJECTS, localnet ACCEPTS, for SEAL, MINT, BURN, GOV — proves the `--features localnet` swap is real and the check is not vacuous. The sweep helper has no key to ask, so its shipped bytes are compared to the localnet build's release output AND the suite's `target/deploy/`, both. `cmp -s` enforces byte-identity. The MANIFEST records the commit and the dirty-tree refusal.
- **Runner** (`scripts/run-tests.sh`): `--arch v3`, deactivates SIMD-0500 and SIMD-0161 (both unscheduled on mainnet), uses a fresh ledger, hard-gates against the wrong validator (the `cmp -s` of on-chain Core vs the pinned mainnet dump), runs the live-mainnet probe when DNS is up and refuses to certify if it is skipped (`CBOB_SHIP_GATE=1`), enforces the swap fork at the end.

---

## ADDITIONAL FINDINGS — outside the program code

### **LOW — `validateParsedTransaction` rejects version-1 transactions that use lookup tables**

- **Construct:** `bank/txread.mjs:38`.
  ```javascript
  if (tx.version === 1) {
    need(object(m.transactionConfig), 'v1 transactionConfig')
    need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key')
  }
  ```
- **Gain:** A failed throw that stops the alarm, the revenue recovery and the redemption poster (they all share this reader) and the live-mainnet probe, on a v1 transaction whose `accountKeys` include any with `source: 'lookupTable'`. The check fires for what the comment says it forbids; the comment is wrong — v1 transactions WITH lookup tables are a normal Solana transaction format and the jsonParsed decoder returns them as keys with `source: 'lookupTable'`. The fixture `tests/fixtures/mainnet-v1.json` is a v1 transaction WITHOUT a lookup table (all sources are `'transaction'`), so the bug is invisible to the test suite.
- **Evidence:** Read the check; read the fixture; both are correct, and the check rejects what the fixture deliberately avoids. The probe walks recent successful transactions; if the most recent N are v1 with LUTs, the probe cannot find a simulation fee payer. The alarm walks every program the user has been called from; the same shape stops it. Each failure surfaces as a loud `*` event in the alarm router, so the operational consequence is "an extra CRITICAL every time the network is mostly v1", not a silent pass.
- **Fix:** Remove the `source !== 'lookupTable'` check, or replace it with a check that LUT keys are properly resolved. The general `accountKeys` validation already enforces `key(k.pubkey) && key(s.wallet)` for all keys, which is what matters operationally:
  ```javascript
  if (tx.version === 1) {
    need(object(m.transactionConfig), 'v1 transactionConfig')
    // LUT keys are allowed; the accountKeys check above verifies they resolved.
  }
  ```
  Add a selftest arm that parses a v1-with-LUT response and asserts no throw. (The fixture can be extended with a second v1 fixture built with `AddressLookupTableProgram`.) The MEDIUM bug round-27's `VALIDATION-FINDINGS.md` called out (V1) — the same reader — was the `maxSupportedTransactionVersion` setting, not this check. The two are different.

### **INFO — `bank/lock.mjs` does not appear in the runner's fingerprint check**

- **Construct:** `scripts/run-tests.sh` runs `bank/selftest.mjs`, `bank/accrual.mjs`, `bank/redemption-poster.mjs`, `scripts/pob-merkle.mjs`, `scripts/check-launch-params.mjs` and the cargo host tests, but the runner never directly verifies `bank/lock.mjs`. It runs `bank/crank.mjs` and `bank/revenue.mjs` in live mode only on the dress rehearsal.
- **Gain:** A future change to `bank/lock.mjs` would not be exercised by the on-chain suite. The file is small (and the file is mentioned in the accepted limits 6 and 7 as the reason a wedged-but-alive holder is an accepted limit), but its behaviour is part of the operational guarantee.
- **Evidence:** Grep `scripts/run-tests.sh` for `bank/lock.mjs`. Not present. Grep `bank/selftest.mjs` for `lock.mjs`. Not present. The file is loaded by both `bank/crank.mjs` and `bank/revenue.mjs` at runtime, so a regression would surface on a live run.
- **Fix:** Add a `bank/lock.mjs --selftest` that exercises the `flock -n` skip and the dead-pid reclaim in both directions, with a floor in `scripts/run-tests.sh`.

---

## THE FOUR QUESTIONS

### 1. Is any limit WORSE than stated?

**Yes, one.** The boost's price is unbounded (LOW finding above). The accepted-limit table does not list this as a known limit — it should either be added as an accepted limit ("a hostile vote can set the boost price to any positive u64, including u64::MAX, rendering the boost unsellable until a corrective vote; no fund loss, and the corrective vote is itself one ratified action") or, better, fixed by adding a `max_boost_price` ceiling at initialize (the only path that is consistent with the existing `max_boost_weight` and `max_boost_epochs` ceilings). I recommend the fix, not the disclosure.

I did not find any other limit that is worse than stated.

### 2. Is anything listed as a limit not actually a limit?

I checked each entry. I find no entry that is no longer a real limit. The 56-line item 56 (whole $CBOB supply on a hot key) is correctly bounded by `release wallet ≠ operator`, the alarm, and the one-time pinning in `launch/mainnet-init.json`.

### 3. Is any DISCHARGED item not actually discharged?

I checked the DISCHARGED section. The items I cross-referenced are correctly closed:
- 12/17 (compute units): measured on the artifact, byte-wall binds 25× more than compute-wall on the measured legacy shape; 10.1–10.4 pin it on the v6 build, including a 400,000 CU regression ceiling.
- 14 (duplicate attribute keys): closed on chain by `mint_vault` and `claim_charter_vault` refusing `DuplicateAttribute`. 11.4 proves it.
- 19 (unlevelled-vault halt): `levels.json` deleted; `activate` requires `NotRevealed`.
- 30 (85/15 ratio a vote): `update_wiring` is gone, P.0e / P.0f prove the struct has no destination or supply field.
- 31 (31-day branch): cadence deleted; the period is an `initialize` value, exercised.
- 33 (operator replacement branch): the notice is an `initialize` value, exercised in 3c.K5 and 3c.G2.

I did not find a DISCHARGED item that is still open.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

I checked each OPEN item:
- 22 (live distribution cycle): OPEN; no `distribute` or `revenue` has run on a live cluster. The runner's `swap-fork.sh` exercises the swap but not the crank's I/O against a real RPC at scale. **Not quietly accepted.** The hold should remain.
- 38 (launch values): OPEN; `charter_opens_at` and `lock_deadline` are `null` in `launch/mainnet-init.json`. The checker refuses them. **Not quietly accepted.**
- 50 (holder surfaces): OPEN; the redeem page and the deposit-address page do not exist; `judgeRedemptionCoverage` is a pure function with no page; the public poster has no sender. **Not quietly accepted.**
- 52 (pool / Squads / revenue ATAs): OPEN; the runner's road step 10 is the only place that creates them. **Not quietly accepted.**
- 53 (dress rehearsal): OPEN; the rehearsal tree was refreshed at `e109b31` and the patch reverses exactly, but the live ceremony, the revenue cycle through both pools, and the forced post-sweep recovery have not run. **Not quietly accepted.**

No OPEN item is being quietly treated as accepted.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what should this project do before launch that AI audit structurally cannot?

The AI process can read, recompute, simulate, mutate and reject. It cannot sign Gary's key, hold his phone, talk to a real RPC at scale, watch a real cluster for days, drive a UI through every browser, write a paper letter, or tell a holder in plain language that the redeem page does not exist. Concrete things only the project can do:

1. **Sign the four `initialize` transactions with Gary's wallet (`Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb`) on the day of launch, in the order SEAL → MINT → BURN → GOV. Each value must be the one in `launch/mainnet-init.json` and not a value the AI can substitute. The AI's checker is on the file; the on-chain check is on the bytes. Both must be true.

2. **Create the three cbBTC accounts on mainnet before the first paid mint** (item 52): the pool (`MINT_CFG`'s ATA for cbBTC), the revenue address's own ATA, and the CBOBTC Squads' ATA (verified 2026-10-03 to exist, must be re-verified on the day). Road step 10. The AI cannot create a real token account; the on-chain code will refuse every paid mint and every split until these exist.

3. **Build the redeem page and the deposit-address page** (item 50) and run it through a real browser, a real wallet (Phantom, Solflare, Ledger), a real network, and at least one dusty / nested / frozen / foreign / non-Mainnet edge case per the control table. The page is the entire reason the holder guide can speak of these surfaces in the present tense. A human must approve the UI and the support flow; the AI cannot.

4. **Run the mainnet dress rehearsal** (item 22) with throwaway program IDs, small real amounts, one full live revenue cycle through BOTH Orca and Meteora (with Orca forced to refuse so Meteora runs), one forced post-sweep failure walked through the hand recovery, and the live alarm running with `CBOB_ALARM_REHEARSAL=1`. Record every signature. The AI ran a swap on a mainnet fork (SW.7-SW.7b). It has not run a live revenue cycle.

5. **Resolve `charter_opens_at` and `lock_deadline`** (item 38). Both are `null` in `launch/mainnet-init.json`. The lock deadline must be earlier than the charter open. Neither can be set by the AI; both are Gary's call. The hold should remain OPEN until they are.

6. **Decide and disclose the boost's `max_boost_price`** (LOW finding above) or accept the unbounded price as a limit and add it to the holder guide's honest list and to the `ACCEPTED LIMITS` section. The AI can implement either path; only the project can decide which.

7. **Remove the upgrade authority on all five programs** (item 39). The build (`scripts/build-mainnet.sh`) deploys upgradeable, the alarm reports `program_not_locked` at CRITICAL past the lock date, and the lock should be removed at the end of the launch ceremony by `solana program set-upgrade-authority <id> --final`. The AI cannot sign that command; the project's operator with the deploy key must.

8. **Run the alarm in a real browser for 72 hours before launch** with the production program IDs, so the operator learns which kinds page, which are noisy, and which are silent. The alarm's many kinds (`program_not_locked`, `pool_frozen`, `revenue_unsplit`, `crank_silent`, `crank_failing`, `crank_problem`, `revenue_account_frozen`, `vault_account_frozen`, `swap_operator_armed`, `guardian_armed`, `distribution_overdue`, `reveal_queue_stalled`, etc.) each have a known baseline. The AI cannot sit in front of the dashboard.

9. **Communicate to the holders in the language of the holder guide** (which is DRAFT and must not be published before item 50 ships). Every sentence is a contract with the holder; the guide is the surface that tells them the truth. A human must answer the inevitable edge-case question in plain language when the first holder asks.

10. **If the round 28 (this) audit adds the boost-price fix above, decide to apply it and re-run the program-pass of the suite. The full 848/848 does not currently include an arm for a u64::MAX price refusal; one new arm is needed. The AI can write the test; the project must decide to ship the fix before immutability.**

Things the AI process can still do, and which should be done in the open alongside:
- Re-run the 848-assertion suite against any change to `programs/`, `bank/` or `scripts/`.
- Re-run the 71-assertion Test Vault simulation against any change to those.
- Add a `MAX_BOOST_PRICE_BOUND` field to `MintConfig` and a new error code (`BoostPriceOutOfBounds`) if the project adopts the LOW fix.
- Add the v1-LUT selftest arm to `bank/selftest.mjs` for the LOW reader finding.
- Add the `bank/lock.mjs` selftest for the INFO finding.

The freeze counter is 0/2. The two clean rounds must use different model rosters (the rule that prevents the AI from agreeing with itself). The 0/2 is honest. The 848-assertion suite is the only thing the AI can leave behind that is not a one-time read. Make sure the launch docs say so: when something breaks after launch, the suite, the sim, the fork, the probe, the build, the dress rehearsal evidence and the rehearsal record are what you have.

---

## Concluding one-sentence verdict

The on-chain code is sound enough to launch once the four `initialize` values the human must sign are set, the three cbBTC accounts exist, the redeem page exists, the dress rehearsal has run, the upgrade authorities are removed, and either the boost price is bounded or its unboundedness is added to the honest list — and of those six, only the first is about reading code.