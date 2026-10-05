# Independent Security Audit — v6 Tree at `93d04fe`

## R0. ROUND 25'S REPAIRS

### N1 — Boost ring wrap: host test + on-chain arm
**VERDICT: Repair holds.** The host test (`the_boost_schedule_through_the_programs_own_functions_across_four_wraps`) calls `join`, `reweigh`, `retire`, `expire_boost`, `credit`/`tick` over 260 epochs (four ring wraps). The purchase scheduling is copied inline from `boost_vault` (MINT:1509-1511); this is a practical limitation—the test cannot invoke the handler directly from a host context—but the on-chain BO section exercises the real handler extensively. Every ring slot is checked against records after each step. The on-chain arm BO.38/BO.38a buys a boost whose end wraps (end 65 → slot 1 at epoch 55), bare-burns and retires it three distributions later before it is due, asserts `boost_expiring[slot]` fell by exactly one, and `books()` holds including the ring.

**Evidence if wrong:** A mutation of `unschedule_boost`'s not-due branch ring index would cause the host test's per-slot assertion or BO.38's `s1 === s0 - 1` to fail.

### N2 — Round 24's C7/C8/C9 coverage and five ship-gate pins
**VERDICT: Repairs hold.** Verified each item:

| Item | Evidence |
|---|---|
| RL.7 stamps live supply at each write | `sendNow` records `STAMPS` keyed by ordinal; RL.7 replays against each redemption's own cap |
| Exactly five picks (E.7) | All five action kinds voted and executed; asserted `live-1`, pending operator, boost price |
| Narrow payout bound (P.11a) | Fixed expected string `'I:1x II:1x.5 III:2x IV:2x.5 V:3x'`; passes only when all five levels present |
| Refusal reasons | `because()` list pins each negative to its named error; `attP` keeps `Program <id> failed:` lines for SR.5-5e and SR.6-14 |
| Crank overlap (K.7) | A queued level-0 record in both crank and pair lists: crank's write survives, pair path skips it |
| Frozen expiry (BO.37) | Due boost expired inside a claim whose destination is frozen: boost gone, whole boosted share stays owed, logged deferred |
| Two redemptions at cap two (S9b.1) | v0 transaction through a lookup table: both land, burned_total rises by 2, both assets burned |
| Overtaken TightenSweep (8.14b) | Older looser tighten after newer: max/min leaves it unchanged |
| Books outside BO (BK.IN, BK.3c, BK.P) | `ledger()` recomputes weights, boost totals, ring, pool ≥ owed, owed == sum of shares after each money operation |
| Ship-gate-5 pins | R24.1 (owner Oracle `NoApprovals`), R24.1a (AgentIdentity refused even to owner), R24.1b-1c (controls), R24.2 (`Some(default)` ≡ `None`), R24.5 (activate with own record → `NotRevealed`), S9b (v0+LUT), BO.35 (`[distribute, boost]`) |

### N3 — Non-owner Execute attacks on a thawed vault
**VERDICT: Repair holds.** SR.5 (stranger), SR.5a (owner-added transfer delegate), SR.5c (collection authority on a control asset) each refuse with Core's `0x1a NoApprovals`, confirmed by `attP` capturing `Program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d failed: custom program error: 0x1a`. SR.5b pins the CBOB collection's authority to MINT's off-curve PDA. SR.5d (control: owner sweeps wallet to zero) proves the call shape is well-formed. SR.5e asserts balances, owner and seal preserved after every refusal.

### N4 — Sweep helper refusal branches
**VERDICT: Repair holds.** SR.6-14 cover every named branch, each pinned to the exact error the helper produced: `invalid instruction data` (bad data byte), `insufficient account keys` (odd count), `incorrect program id` (wrong token/system), `invalid program argument` (dest == signer), `Provided owner is not allowed` (foreign source, duplicate source), `invalid account data` (mint mismatch), frozen source (`0x11`). SR.13 proves the zero-pair lamports-only sweep. The `attP` helper distinguishes the helper's own refusal from an earlier gate by naming the failing program.

### N5 — Packet headroom and compute
**VERDICT: Repair holds.** S8.0 asserts `B ≤ 1232 − 52 − 96` (the compute-budget pair and separate-payer headroom). S8.1a records `meta.computeUnitsConsumed` for the four-instruction redemption: **168,343 CU**, well within the 800,000 default combined budget.

### N6 — Certified byte comparison
**VERDICT: Repair holds.** `build-mainnet.sh` now compares the helper's mainnet bytes against `target/deploy/cbob_vault_sweep.so` (the file the suite deployed) in addition to the `$CACHE/ln` rebuild, and logs all five artifact SHA-256 hashes. The VALIDATION.md records identical hashes across `dist/`, `target/deploy`, `.cache/ln` and `.cache/mn` at `ba67127`.

### D1-D9 — Documentation repairs
**VERDICT: Repairs hold.** Every sentence named in the round-25 verdict carries corrected text. D1 (snapshot electorate), D2 (first payout timing), D3 (missed-capture rerolls), D4 (declared vs destroyed), D5 (immutable bugs, Core consequences, hot keys), D6 (stale text), D7 (classic token rescue), D8 (alarm sampling, positive bound), D9 (deposit-address surface, packet numbers, zero-pair destination). No deployed program logic changed: MINT's host tests were appended; GOV comments preserve line counts.

---

## R1. CUSTODY

The open↔burn pairing holds under every attack named. Both halves bind asset AND owner at fixed account positions. The instruction-sysvar walk is fail-closed (an early `Err` leaves `found` false). The stack-height check on `retire_redeemed` rejects CPI-wrapped calls at height > 1. The emptiness proof covers lamports, both token-program ATA derivations per reserve mint, delegates, close authorities, extensions, and declared nested Core assets.

**No custody defect found.**

---

## R1s. THE SWEEP HELPER

### (a) Access control
Core's `ExecuteV1` approves only the asset's owner (asset.rs:325-337 at `e72d63e`); the collection abstains. SR.5/5a/5c prove this on a genuinely thawed vault against the pinned binary. AgentIdentity (the one external Execute-approving route) requires the collection's update authority (MINT's off-curve PDA) and an ExecutionDelegateRecord; our programs have no CPI that adds it. R24.1a proves an owner cannot add it.

### (b) Pair list
Every named edge is refused or handled correctly: duplicate source (closed on first iteration, second hits `IllegalOwner`), source == destination (`InvalidArgument`), source not the vault's (`IllegalOwner`), mint mismatch (`InvalidAccountData`), odd account count (`NotEnoughAccountKeys`), frozen source (token program refuses, reverts), wrong program ids (`IncorrectProgramId`). SR.12a proves the duplicate-source case explicitly.

### (c) Destination checks
The destination wallet is not compared with the asset's owner. This is safe: Core demands the owner's signature on `ExecuteV1`, so only the owner can name any destination. A hostile page with the owner's signature can carry plain SPL transfers without the helper (W2 refuted by construction). A lamport transfer to a non-existent destination below rent exemption is refused by the System program (D9 documents this as a page obligation).

### (d) Lamport sweep
`signer.lamports()` is read at execution. After the token-account closes (which move the source's rent to `dest`), the signer holds whatever lamports remain (stranger deposits). The sweep moves all of them to `dest`. BURN then checks `asset_signer.lamports() == 0`. Within one atomic transaction nothing can deposit between the sweep and BURN. SR.4a measures the exact SOL delta.

### (e) Interaction with BURN's emptiness proof
The sweep closes what it empties (CloseAccount → zero-lamport System account). BURN's reserve loop skips non-token-program owners, so the closed account passes for the right reason. A missing reserve ATA cannot be named by the helper (it refuses non-token accounts); the SPEC requires the page to create all three in a prior transaction. A Token-2022 ATA for a classic mint is refused `IncorrectProgramId` at creation (measured on mainnet, round 25 W1). A non-ATA token account is only caught if declared; undeclared, it is destroyed (accepted limit 44).

### (f) Packet fit
S8.0 measures 1,061 bytes for claim + open + 3-pair sweep + burn. With compute-budget pair (+52) and separate payer (+96): ~1,209 of 1,232. A fourth reserve does not exist (MAX_RESERVE_MINTS = 3). The in-line monthly run's accounts are already carried by `retire_redeemed` (pool token).

### (g) Evidence
SR.0-SR.4a and SR.5-SR.14 cover every named branch with named refusal reasons. S8.0-S8.3 and S8.1a cover the full three-asset redemption. `build-mainnet.sh` proves the deployed bytes match the tested bytes.

**No sweep-helper defect found.**

---

## R2. THE COMMUNITY POOL'S MONEY

The invariant "pool always holds at least ceil(owed)" holds:

- `credit` adds `delta * ACC_SCALE` to `owed_scaled` only after `avail = balance - ceil(owed) > 0`.
- `claim` reduces `owed_scaled` by exactly `(pay * ACC_SCALE)` where `pay = pending / ACC_SCALE` (floor), so the sub-sat residue stays owed.
- `retire` subtracts `pending` from `owed_scaled` (returned to pool or forfeited).
- `join` sets `debt = weight * acc`, so the new vault is owed exactly zero.

The `ledger()` check in the suite (BK.IN, BK.3c, BK.P) recomputes owed from every record after each money operation and asserts it equals `owed_scaled`. The pool balance check `bal >= owedCeil` is asserted throughout.

**Counters:** `pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight` are incremented/decremented in matched pairs across `activate`/`join`/`retire`. The `JoinWaitingFirst` gate prevents a distribution from running while eligible vaults wait. The `BoostsExpireFirst` gate prevents distributions past a due boost.

**Liveness:** The burn path (`distribute(true)`) cannot open the door alone (refuses `NoActiveVaults` when nobody is joined). The free monthly path ticks the epoch so waiting vaults can join. `monthly_inline` runs on every host instruction.

**No pool accounting defect found.**

---

## R2b. THE $CBOB BOOST

- **Exactly N distributions:** The boost is scheduled at `dist_epoch + epochs` at purchase. `advance_epoch` moves it to `boosts_due` when `dist_epoch` reaches the end. `BoostsExpireFirst` prevents any distribution past a due boost. BO.21/BO.21a prove N, not N+1, for `[boost, distribute]`; BO.35/BO.35a prove the same for `[distribute, boost]`.
- **Nothing lost or gained on weight change:** `reweigh` moves owed to `carry` and resets debt to `after * acc`. BO.7c asserts this. `expire_boost` calls `reweigh(c, r, 0)`.
- **Totals always agree:** `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due`, and `boost_expiring` are updated in matched pairs in `boost_vault`, `unschedule_boost`, and `expire_boost`. The host test checks every ring slot against records across 260 epochs. `books()` is asserted after every BO operation.
- **No double-expire, early expire, or never-expire:** `expire_boost` requires `boost_weight > 0 && dist_epoch >= boost_end_epoch`; after expiry `boost_weight = 0`. `unschedule_boost` in `retire` handles both due and not-due branches. BO.10b proves an early `expire_boosts` is a no-op.
- **No distribution impossibility:** `expire_boosts` is permissionless and needs only records (no token account). The crank expires every due boost after every distribution.

**No boost defect found.**

---

## R3. THE LEVEL DRAW

- **SlotHashes parse:** Defensive (key check, bounded count, buffer length, all-zero hash refused). Host tests cover the full 512-entry buffer, truncated data, forged accounts.
- **Skipped-slot handling:** `blockhash_in_window` takes the smallest produced slot in `[want, want+64]`. Host tests cover skips at each target.
- **FIFO:** `reveal_level` requires `index == revealed_total`. L.2 proves out-of-order is refused.
- **Burned vault at head:** L.11 proves a burned vault still takes its draw; the Core write is skipped.
- **Attribute re-supply hash:** L.4 proves one altered attribute is refused.
- **What a minter/crank/leader can influence:** SPEC 26 and HOLDER-GUIDE state the leader-of-C residual honestly (best-of-4 from skipping, more from varying contents, cohort-wide). The re-roll limit (25) is in the guide.

**No draw defect found.**

---

## R4. GOVERNANCE

- **Minority carrying what it should not:** Quorum 21% + threshold 51% + 10% turnout + key-change-half-of-snapshot all enforced at execute. 3c.K2 proves a quorum-and-turnout pass without half-of-all is refused for `KeyChangeNeedsHalf`.
- **Vote reaching money it should not:** `tighten_sweep` is monotone and bounded. `split_bps`, destinations, `max_supply` are permanent. `set_boost_terms` is bounded.
- **Governance frozen forever:** If all vaults are redeemed, no proposal can be created (limit 45). A stolen guardian key's stop is permanent at low turnout (limit 47, stated). These are accepted limits, not defects.

**No governance defect found.**

---

## R5. THE CHARTER CLAIM

Merkle proof verified (domain-separated, sorted pairs, odd-node promotion). Identity by ADDRESS against a 240-leaf root. CPI burn in the same instruction. Window fixed at initialize, clock-only gate. `pob_extra` passed through never as signers.

SPEC 46 states the hot key's full consequence (end project / capture governance during the window). The positive bound (cannot transfer/burn individual PoBs) is documented.

**No charter-claim defect found.**

---

## R6. ONE-TIME CONFIGURATION

Every `initialize` value is checked by `scripts/check-launch-params.mjs` before signing. The programs' own checks are narrower (SEAL reads only owners; off-curve keys accepted), but the checker fills the gap. The redemption cap is exactly a rolling window over a 64-slot ring (BURN: `rate_ring`, `rate_head`).

**No configuration defect found.**

---

## R7. CROSS-PROGRAM RAW READS

Red-team 3 independently recomputed every offset and found them correct. Four auditors in round 25 agreed. The version-first discipline (each config declares `version: u8` first) means a layout change fails loudly. The suite pins every discriminator against its derivation.

**No offset defect found.**

---

## R8. THE SUITE

The `because()` list pins every negative to its named error. `attP` preserves `Program <id> failed:` lines so SR.5-5e can distinguish Core refusals. The unique-ID check (ID.1) prevents a reused ID from reading another arm's error. Every round-25 repair has an arm that can fail.

**No suite defect found.**

---

## THE FOUR QUESTIONS ABOUT ACCEPTED LIMITS

**1. Is any limit WORSE than stated?** No. Each limit's stated cost matches the code. Item 32's ring-bound-at-64 note is accurate (mainnet cap is 45 < 64). Item 46's hot-key exposure is stated in full. Item 10's swap-operator bound (cap × cooldown windows) is the honest rate, not a total.

**2. Is any listed limit not actually a limit?** No. Each is real and unfixed.

**3. Is any DISCHARGED item not actually discharged?** No. Items 51 and 54 are measured. The v5 items went with deleted code.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all explicitly open and gate the launch.

---

## FINDINGS

After thorough examination of all five programs, the sweep helper, the cross-program reads, the boost ring arithmetic, the pool accounting, the governance execution, the level draw, and the entire test suite:

**No CRITICAL, HIGH, or MEDIUM program defect found.**

The code is sound. The open↔burn pairing cannot be broken. The pool invariant holds. The boost earns exactly N distributions. The sweep helper's access control is Core's own. Every cross-program offset is correct. The round-25 repairs hold where they were made.

### LOW — Documentation precision (not a code defect)

**The holder guide's phrase "Everything in it (cbBTC, $GARY, $GIRAFFISH and SOL) comes out"** (HOLDER-GUIDE:34) is in the "always true" section but contradicts the guide's own later warning that undeclared tokens and NFTs are destroyed. The D4 repair changed "Everything" to "Everything in it (cbBTC, $GARY, $GIRAFFISH and SOL)" which names the three reserves and SOL, but a reader of the "always true" section alone could still miss the destruction rule stated 70 lines later. This is cosmetic given item 50's rule that the guide may not be published before the redeem page ships.

**Evidence if wrong:** Read HOLDER-GUIDE:34 against :102-103.

**Fix:** Move the destruction warning into the same bullet, or add "(anything else is destroyed; see below)".

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, WHAT SHOULD THIS PROJECT DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT?

1. **Run the mainnet dress rehearsal (item 22) with real signatures recorded.** AI cannot execute the crank against 2,100 vaults on a live cluster, cannot observe RPC rate limits under load, and cannot walk the hand-recovery runbook when a swap fails post-sweep. The five named items must each produce a transaction signature in a log a human reads.

2. **Have a human read the four `initialize` transactions byte-for-byte against `launch/mainnet-init.json` before Gary signs them.** The checker validates the JSON; it does not validate the signed transaction. A human with the JSON in one window and the serialized transaction in the other is the only check that catches a builder who typed a wrong key. This is the single highest-consequence irreversible act in the entire system.

3. **Test the redeem page against a real vault holding a real nested Core asset and a real stray token, with a human watching the warning fire.** AI can verify `judgeRedemptionCoverage` is a pure function; it cannot verify that a page actually calls it before the holder signs, that the warning is legible, or that a non-technical holder understands "this NFT will be destroyed."

4. **Send one real redemption through the sweep helper on mainnet with a human confirming the destination received everything.** The suite proves the mechanics; only a human on mainnet confirms that the page's transaction construction, the wallet's signing flow, and the RPC's confirmation path work together for a real holder with real money.

5. **Move the $CBOB release wallet key off the box and into Gary's own custody before the first boost terms vote.** AI can document the risk (limit 56); only Gary can decide to close it. The moment boost terms are live, that key is a lever on every vault holder's payout share.

6. **Have Gary personally verify the charter window dates and the lock deadline in `launch/mainnet-init.json` against his own calendar and the Chairman's film.** These are the two remaining OPEN values. A wrong charter date is permanent; a wrong lock deadline means programs stay upgradeable past the point of no return. No AI check substitutes for the business owner reading the number and saying "yes, that is the date."