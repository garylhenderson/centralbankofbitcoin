# Security Audit Report — CBOB Vaults v6 (Round 37)

## R0: ROUND 36'S VERDICT AND REPAIRS

### Repair verification

Round 36's confirmed findings and their repairs were independently checked at every site of their shape:

**H1 (HIGH) — Stranger blocking the redeem page by freezing the holder's destination for a junk mint.** The repair in `plan-redeem.mjs` (`undeliverable()`) is correct and complete: a stray whose mint has a freeze authority (non-reserve), whose receiving account is frozen, or whose mint cannot be read is never delivered — it is left in the vault and named for the holder to tick. Reserve mints are exempted from the freeze-authority check (they must be delivered to empty the vault), and the reserve delivery path has its own separate refusal (`ownerAtaFrozen` check). The `helperStrays` and `transferStrays` lists are filtered before the helper pairs are built, so the attack vector (freeze → transfer to frozen destination → `AccountFrozen` 0x11 → dry run fails → page cannot open) is closed. Plan test vectors cover each arm both ways.

**L1 — RPC proxy relay.** `txRefusal` now requires at least one CBOB program or one of three exact page shapes (ATA creates, ceremony collection create, System transfers to the revenue address). A plain SOL or token transfer is refused. Verified against the test arms.

**L2 — "Run a payout" and due boosts.** `planPayout` reads `boosts_due` and `dueRecords`, builds `expire_boosts` before `distribute`, and refuses before burning anything if the counts do not match. Verified byte-identical to the suite's `ixExpire`.

**L3, I2, L4, L5, I1** — SPEC text corrections, release-commit binding (`build.mjs` refuses a `dist/` that is not a clean build of `RELEASE_COMMIT`), ceremony hash reference corrected to the README table (which `bundle.test.mjs` proves equals a fresh build of both profiles). All verified.

### New observations

1. **LOW — Eight negative suite arms lack a `because()` reason pin** (`R32.A22a`, `R34.G2`, `R33.G3`, `OR.5`, `R31.W1a`, `R31.W1b`, `R28.A2`, `R35.N8`). Each is labelled correctly and its outcome fields are right, but a wrong-reason rejection in one of those arms would not be caught by the pin mechanism. Evidence if true: `grep` of `tests/3prog.test.ts` for `because(` lines vs `rec(` lines for those ids. Fix: add `because()` lines for each. This does not misstate holder money, rights, or program behaviour; it is a test-strengthening gap.

2. **INFO — The `as predicted` mechanism (`ID.1`) correctly catches reused ids**, and the `because()` mechanism catches wrong-reason rejections for the ~184 arms that have pins. The remaining eight are named in the round 36 verdict as Gate-5 item 8 (A12). This is already tracked.

No repair introduced a regression at any site of its shape.

---

## R1: CUSTODY

### SEAL `open_for_redemption` ↔ BURN `burn_vault` pairing

The forward walk (SEAL → BURN) and backward walk (BURN → SEAL) both bind asset AND owner at fixed account indices (0 and 2). The discriminators are pinned and asserted in the suite (3.1a–3.1f). The coupling fails closed. `load_instruction_at_checked` errors at end-of-list, leaving `found = false` and refusing the thaw. The walk is top-level only, so a CPI-wrapped burn cannot satisfy it. Two redemptions in one transaction are correctly handled (each pairs independently). Verified.

### Emptiness proof

BURN checks: PDA lamports == 0; every reserve mint's ATA (both token programs) declared, PDA-owned, undelegated, extension-free, empty; no declared account a live Core asset. The reserve list is read from SEAL's config (one copy). The non-reserve loop applies the same three checks as the reserve loop. The `DeclarationMismatch` count check prevents unlisted accounts from slipping through. Token-2022 accounts are refused at config time (`ReserveMintNotClassicSpl`). Verified.

### `rescue_nested`

The vault must be live, nested (owner == host's asset-signer PDA), and the host must be the vault itself, a positively burned asset, or a live CBOB vault. The destination is always `bank_treasury`. The rescue delegate (`["rescue"]` PDA) signs only here. Verified against R35.N1–N9, N2a, N8a.

---

## R1s: THE SWEEP HELPER

**(a) Only the asset's owner can move value.** Core's `ExecuteV1` requires the owner's signature; a sealed vault refuses Execute (Core 0x9 from the PermanentFreezeExecute plugin). SR.5, SR.5a, SR.5c, SR.5d, SR.5e verify this. The collection's update authority is MINT's off-curve PDA (SR.5b).

**(b) Pair list.** Duplicate source: the first closes it, the second's `read_token` fails `IllegalOwner` (SR.12a). Destination is also a source: impossible (source must be signer-owned, destination must be dest-owned, and signer ≠ dest). Frozen source: transfer refuses `AccountFrozen` 0x11 (SR.14). wSOL source: the helper transfers and closes it like any classic account. Odd count: refused `NotEnoughAccountKeys` (SR.7). Zero pairs: lamports-only sweep works (SR.13). Verified.

**(c) Destination checks.** The destination is the named wallet, not compared with the asset's owner — safe because only the owner can sign Core ExecuteV1 (a). The lamport transfer to a non-System destination works (R27.S1). A below-rent-exemption credit to a non-existent account would fail, but the plan ensures the destination is the owner (fee payer, so exists). Verified.

**(d) Lamport sweep.** Reads `signer.lamports()` at execution, sends all to the destination. Nothing in the same transaction can add lamports to the signer PDA after the sweep (Core adds none; the burn follows). BURN's `lamports == 0` check sees exactly what the sweep left. SR.4a verifies the exact SOL delta.

**(e) Interaction with BURN's emptiness proof.** The sweep closes what it empties. A closed account has 0 bytes and owner = System, so BURN's `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue }` skips it. The declared count includes it (BURN requires all reserve ATAs declared). Verified.

A stranger can create a reserve ATA with dust before the redemption lands — but the sweep moves live balances at execution, so the dust is swept and the account closed. A Token-2022 ATA for a classic mint is refused by the ATA program (F4.2). A non-ATA token account is handled as a stray.

**(f) Fit.** S8.0 measures the three-asset redemption through the helper at 1,061 bytes (page order: claim, open, sweep, burn), with room for compute-budget instructions and a separate fee payer. S8.1a: 168,343 CU. A fourth reserve does not fit (measured, MAX_RESERVE_MINTS = 3).

**(g) Evidence.** SR.0–SR.4a and S8.* cover the arms. SR.12b verifies the duplicate-source refusal reached the right branch. The helper is byte-identical in `dist/`, `target/deploy/`, and the localnet build (`build-mainnet.sh` proves this). Verified.

---

## R2: THE COMMUNITY POOL'S MONEY

### Invariant: pool always holds at least ceil(owed)

`credit` adds `avail * ACC_SCALE / weight` to `acc_scaled` and `avail` (rounded down) to `owed_scaled`. `claim` subtracts `pay * ACC_SCALE` from `owed_scaled` (pay = `pending / ACC_SCALE`, floored). `retire` subtracts `pending` from `owed_scaled`. Each operation conserves: the pool balance only decreases by exactly what `owed_scaled` decreases. The sub-sat dust stays in the pool, owed. P.32 asserts `bal >= owedCeil`. The `ledger()` check recomputes the sum of every live record's share and asserts it equals `owed_scaled` after every money operation. Verified.

### Counters

`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight` are updated consistently across `activate` (request + join), `claim` (join + pay), `retire` (both pending and active branches), `reweigh`, `unschedule_boost`. The F21 test retires waiting vaults and checks both counters decrement. The N1 host test drives 260 epochs through the program's own functions and checks every counter against a model. Verified.

### Liveness

`JoinWaitingFirst` prevents a distribution while any eligible vault waits. `BoostsExpireFirst` prevents one while any boost is due. `waiting_to_join` computes `pending_count - pending_this_epoch`. The monthly in-line run logs and skips rather than refusing its host. Verified.

---

## R2b: THE $CBOB BOOST

### Exactly N distributions

The boost is scheduled at `end = dist_epoch + epochs`. `advance_epoch` reads `boost_expiring[end % BOOST_RING]` when `dist_epoch` reaches `end`, marks it due. The `BoostsExpireFirst` gate prevents a distribution past a due boost. `MAX_BOOST_EPOCHS_BOUND = 63 = BOOST_RING - 1`, so no two live boosts share a ring slot. BO.21/BO.21a (boost + distribute in one tx) and BO.35/BO.35a (reverse order) verify exactly N. The ring-wrap case (BO.34) and the N=63 boundary (BO.38) are tested on chain. The N1 host test drives 260 epochs (4 wraps) through the program's own functions. Verified.

### Nothing gained or lost on weight change

`reweigh` moves `owed` to `carry_scaled`, sets `debt = new_weight * acc`. `owed_of = weight * acc + carry - debt` is continuous across the change. Verified by BO.7c, BO.14, and the N1 host test (`owed_scaled == sum of every record's share` at every epoch).

### Counters and ring

`total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due`, `boost_expiring` are updated consistently in `boost_vault`, `expire_boost`, `unschedule_boost`, `retire`, `reweigh`. The `books()` check and the `ledger()` check assert the invariant after every money operation. The ring-wrap case is tested. Verified.

### No record expired twice, early, or never

`expire_boost` requires `boost_weight > 0 && dist_epoch >= boost_end_epoch`. After expiry, `boost_weight = 0`, so a second call skips. `expire_boosts` skips non-due and retired records. BO.10b (early expiry is a no-op) and BO.13a (batch expiry) verify. A retired vault's boost is unscheduled by `retire`, so `boost_expiring` is already 0 for it when `advance_epoch` reaches its slot. Verified.

### Nobody can make distributions impossible

`BoostsExpireFirst` is cleared by free, permissionless `expire_boosts`. `JoinWaitingFirst` is cleared by free, permissionless `claim`. The monthly in-line run skips (logs) rather than refusing its host. Verified.

---

## R3: THE LEVEL DRAW

### SlotHashes parse

`blockhash_in_window` pins the sysvar id, bounds the count (≤ 512), checks the buffer length, and refuses an all-zero hash. Verified by the host tests.

### Skipped-slot handling

`MAX_SKIPPED_SLOTS = 64`. The draw uses the smallest produced slot in `[want, want+64]`. The host test `the_lookup_takes_the_smallest_produced_slot_in_the_window` covers every skip pattern. Verified.

### FIFO

`reveal_level` requires `index == config.revealed_total`. L.2, L.16a verify. A burned vault at the head still takes its draw (L.11). Verified.

### Attribute re-supply hash

The stored `attrs_hash` is checked against the re-supplied list. L.4 (one altered attribute is refused) verifies. Verified.

### Leader influence

SPEC 26 correctly states C's leader chooses among many draws. The leader schedule is public, so a validator can time a mint. Accepted limit 26. The HOLDER-GUIDE honest list states this. Verified.

---

## R4: GOVERNANCE

### Minority carry

Quorum (21%), threshold (51% of votes cast), 10% turnout, and the key-change supermajority (50% of ALL live vaults) are all enforced at execute. D.1 (turnout rule binds at low quorum), 3c.K2 (key change needs half), F18.1/F18.2 (threshold at the boundary) verify. Verified.

### Vote reaching money

A vote can set rounds (price ≥ 21,000 sats), restart stops, tighten the sweep (bounded), arm a guardian/operator (supermajority + notice), set boost terms (bounded). It cannot touch the 85/15, destinations, max_supply, the royalty, a vault, or the reserve list. P.0e, P.0f verify no wiring struct survives. Verified.

### Frozen governance

If every vault is redeemed, no proposal can be created (accepted limit 45). A stolen guardian key can hold stops permanently at low turnout (accepted limit 47). Both are stated. Verified.

---

## R5: THE CHARTER CLAIM

The PoB is identified by address against a Merkle root of 240 addresses (domain-separated, sorted pairs). The PoB is CPI-burned in the same instruction. The window is fixed at initialize and can never reopen. Not gated by the guardian. `pob_extra` accounts pass through to Core's burn, never as signers. C.2–C.12 verify. The Moments collection's update authority is a hot wallet (accepted limit 46). SPEC 46 is complete: it names both the "end the project" and "capture governance" attacks, the alarm blind spots, and the positive bound (that key cannot transfer or burn an individual PoB). Verified.

---

## R6: ONE-TIME CONFIGURATION

Every `initialize` refuses wrong values: the collection must be clean, ours, unminted; the payment mint must be a SEAL reserve; the treasury must not be the default key; the charter window must be in the future; the PoB root must be non-zero; the boost mint must be classic SPL and neither cbBTC nor $GARY; the boost bounds must be in range. `check-launch-params.mjs` refuses any OPEN value and validates every bound before signing. The sweep operator's worst case is bounded by cap × cooldown windows until the guardian stops it (accepted limit 10). The royalty is installed with `PluginAuthority::None` (R.6, R.6a verify Core refuses update and removal). The redemption cap is a rolling window over a 64-slot ring of timestamps (RL.2, RL.3, RL.4, RL.7 verify). Verified.

---

## R7: CROSS-PROGRAM RAW READS

All offsets recomputed from the struct definitions and confirmed:

| Read | Offset | Field | Correct |
|------|--------|-------|---------|
| GOV: governance | 41 | `governance` | ✓ |
| GOV: minted_total | 141 | `minted_total` | ✓ |
| GOV: charter_closes | 442 | `charter_closes_at` | ✓ |
| GOV: bare_retired | 454 | `bare_burns_retired` | ✓ |
| GOV: sales_stopped | 191 | `sales_stopped` | ✓ |
| GOV: sweep_stopped | 192 | `sweep_stopped` | ✓ |
| GOV: sales_stopped_at | 518 | `sales_stopped_at` | ✓ |
| GOV: sweep_stopped_at | 526 | `sweep_stopped_at` | ✓ |
| GOV: sol_reserve | 257 | `sol_reserve_lamports` | ✓ |
| GOV: max_sweep | 266 | `max_sweep_lamports` | ✓ |
| GOV: cooldown | 274 | `sweep_cooldown_secs` | ✓ |
| GOV: sweep_floor | 631 | `sweep_floor_lamports` | ✓ |
| GOV: cooldown_ceiling | 639 | `cooldown_ceiling_secs` | ✓ |
| GOV: reserve_ceiling | 647 | `reserve_ceiling_lamports` | ✓ |
| GOV: max_boost_weight | 711 | `max_boost_weight` | ✓ |
| GOV: max_boost_epochs | 712 | `max_boost_epochs` | ✓ |
| BURN: minted_total | 141 | `minted_total` | ✓ |
| BURN: bare_retired | 454 | `bare_burns_retired` | ✓ |
| BURN: burned_total | 42 | `burned_total` | ✓ |
| SEAL: version | 8 | `version` | ✓ |
| SEAL: collection | 9 | `collection` | ✓ |
| SEAL: reserves | 41 | `reserve_mints` (Vec) | ✓ |
| Sweep: mint | 0 | token account mint | ✓ |
| Sweep: owner | 32 | token account owner | ✓ |
| Sweep: amount | 64 | token account amount | ✓ |

Account spaces: `MINT_CONFIG_SPACE` = 1,261 (1,005 + 256 padding), `VAULT_RECORD_SPACE` = 231 (221 + 10 padding), `BurnConfig` init space = 1,042 (786 serialized + 256 padding), `GovConfig` init space = 344 (88 + 256 padding). All structs fit within their allocated space. The Borsh `[i64; 64]` serialization includes a 4-byte length prefix (516 bytes), which the space constant accounts for via its 256-byte padding. Verified.

---

## R8: THE SUITE, THE SIMULATION, AND THE BUILD

The 895-assertion suite has an exact floor that must equal the count. Negative arms are pinned by `because()` (except the eight named above). The Test Vault simulation (71 assertions) exercises the full lifecycle against real Core and real mints. `build-mainnet.sh` proves the mainnet bytes carry Gary's key and the sweep helper is byte-identical to the tested build. The mainnet probe (33 assertions) verifies the signature walk, reserve mints, and PoB set. The swap fork (16 assertions) proves both venues against real pool state. Verified.

---

## THE FOUR QUESTIONS ABOUT ACCEPTED LIMITS

### 1. Is any limit WORSE than stated?

No. Every accepted limit I checked is stated at least as broadly as the code enforces. Specifically:

- **Limit 32** (rate limit): the ring bounds the cap at 64, making it stricter (not looser) for live supply above 3,047. Correctly stated.
- **Limit 40** (Core upgradeable): the three named consequences (burn proof, level queue, Execute authority) are accurate. The autograph heap boundary is measured and stated as bounded observations.
- **Limit 46** (Moments hot wallet): both attacks (end project, capture governance) are named with the full consequence. The alarm's sampling gap (hook added and removed between passes) is stated.
- **Limit 55** (unsplit revenue): the cost is correctly stated as 100–200 $GARY plus a funded vault, bounded by the crank's split cadence.
- **Limit 58** (rescue): the return is a person's act, the Squads could vote (custody rule, not program rule), and the foreign-host limitation is stated.

### 2. Is any limit not actually a limit?

No. Each limit I checked corresponds to a real, reachable condition in the code.

### 3. Is any DISCHARGED item not actually discharged?

No. Items 30 (85/15 fixed at init), 31 (cadence deleted, period is an init value), 33 (notice is an init value), 51 (boost built and tested), 54 (compute measured) are all genuinely discharged.

### 4. Is any OPEN AND BLOCKING item quietly treated as accepted?

No. Items 22 (dress rehearsal), 38 (launch values), 50 (holder surfaces), 52 (pool accounts), 53 (rehearsal tree) are all explicitly OPEN AND BLOCKING and referenced as such throughout.

---

## GIVENTHAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, WHAT SHOULD THIS PROJECT DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT?

1. **Run the dress rehearsal end to end (item 22) and record every transaction signature.** AI audit can read the code and the test suite; it cannot observe a live RPC under load, a transient failure on vault 1,900 of 2,100, or a revenue cycle that actually swaps through Orca and Meteora against real pool state. The five named items (crank passes, alarm passes, full revenue cycle through each pool, forced post-sweep failure with hand recovery, DAS read of a burned asset) must each produce a signature that a human can look up.

2. **Sign real transactions with the real Phantom wallet (desktop and phone) on every page.** The `signExact` guard refuses any wallet that modifies a message, but whether Phantom ever does cannot be measured offline. One real signature per page per device class is the only way to know the holder experience works.

3. **Walk the ceremony once on a local validator with Gary's actual wallet, reading every screen aloud.** The ceremony writes values that can never be corrected. An AI can verify the bytes match the ruling; it cannot judge whether Gary, reading the screen at 2am, understands what he is signing.

4. **Have a human who was NOT involved in building this read HOLDER-GUIDE.md line by line and say, for each sentence, whether they believe it.** The guide is the contract with holders. AI can check it against the code; it cannot check it against a holder's understanding.

5. **Verify the deployed bytes on mainnet after road step 9, from a machine that is not this box.** `build-mainnet.sh` proves the bytes are correct at build time. Someone must `solana program dump` each of the five programs from a different machine and compare the sha256 against `dist/SHA256SUMS` after the upgrade lands. The build script itself says "NOT PROVEN that the compiled constant IS that key" — a second machine's dump is the bridge.

6. **After removing the upgrade authority (road step 11), dump each program one final time and confirm `upgradeAuthority: null`.** Then send one test transaction through each program path (a mint, a claim, a redemption, a vote, a rescue) and confirm it lands. This is the moment of no return, and it deserves a human's eyes on the chain explorer.

7. **Keep the alarm's PagerDuty (or equivalent) routing tested with a real page after launch.** The alarm is the only continuous detection. An AI can verify the detector logic fires both ways; it cannot verify that a 3am page reaches a human who acts on it.