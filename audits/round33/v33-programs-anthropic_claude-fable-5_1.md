# Round 33 — programs pass, independent audit of the whole tree

Scope read: all five programs, the suite, the simulation, the runners, the build script, the reader, DESIGN-v6, HOLDER-GUIDE, SPEC, RT3, round 32's verdict and validation. Offsets, spaces and discriminators were recomputed by hand (R7). No CRITICAL or HIGH program defect was found. What follows is what survived: one MEDIUM evidence gap with a permanent-liveness consequence, several LOWs (suite integrity, holder promises, pre-lock options), and INFO corrections. Each states the evidence that would exist if I am right.

---

## R0. Round 32's verdict and repairs

**Verdict re-read.** Its two confirmed findings (L1 gate parser fail-open; D1 three DESIGN sentences) are genuine and both repairs are present at HEAD:

- `scripts/audit-coverage.sh` `bundles()` now recognises the FOCUS ternary by shape, `SystemExit`s when the `] : [` split cannot be found, and `SystemExit`s on any other FOCUS-dependent header, so the fall-through to a both-foci union is gone. The selftest has 9 headline cases + 3 split variants + 2 fail-closed cases = 14, `total = len(cases) + 5` matches.
- DESIGN-v6 now says the mint index lives in MINT's `VaultRecord`, describes `ClaimBeforeBurn` as "owed a share of one sat or more" with `retire_redeemed` removing the weight, and names `sales_stopped`/`sweep_stopped`.

**Refutations checked.** W1 (stockpiled restarts): `restart` leaves `sweep_stopped_at` in place; `emergency_stop_sweep` stamps only on the false→true transition (`if !c.sweep_stopped { ... }`), so after a restart the next stop is a fresh transition and every proposal created before it is refused `StopIsNewer` / skipped `stop_is_newer`. Correct. W2 (closed account owner): the pinned Token's `CloseAccount` deletes the account (assigns System, realloc 0) in-transaction; SR.12a/SR.12b measure the helper's `IllegalOwner` on exactly that. Correct. A22 is now suite arms R32.A22a/b.

**Gate-5 arms added (R31.W1a, R28.A1, R31.W1b, R31.W2a, R31.W2b, R32.A22a/b)** are present with the right pins; W1a requires the runtime's own `too large (10241 > 10240)` text. One regression introduced by the W2b rewrite is filed below (S1).

**Round 32's limits.** It reused the round-28 simulation; this tree changes no program or sim code since, so reuse holds. It never ran `bank/alarm.mjs` live; that remains true of everything here too.

---

## R1. Custody

Walked every pairing shape: CPI wrapper on either half (WR.1–WR.4), two vaults in one transaction (4.10a, S9b with resolved lookup-table keys), asset/owner index binding on both sides (`BURN_IX_ASSET_IDX`/`OWNER_IDX` 0 and 2 match both `#[derive(Accounts)]` orders), SEAL's fail-closed single-job walk, BURN's `0..current` scan, a transfer of the asset mid-thaw (NotTheOwner on the burn, revert), a bare `BurnV1` before `burn_vault` (NotACoreAsset, revert). A thawed vault cannot leave a transaction unburned because the burn SEAL found must itself succeed or the whole transaction reverts.

Emptiness proof: the Token-2022 ATA derivation for a classic mint cannot exist (probe F4.2 on mainnet: `IncorrectProgramId`), so its declared address is always System-owned and skipped; a sub-165-byte Token-owned account at an ATA address cannot be created (the address is the ATA program's PDA; `InitializeAccount` needs exactly 165); delegate/close-authority checks are redundant on a sealed vault but harmless; lamports ≠ 0 refuses; a declared Core asset refuses. Undeclared non-ATA token accounts and nested assets are destroyed (impossibility 2, limit 44). No defect.

**No finding.**

---

## R1s. The sweep helper

(a) Access is Core's `ExecuteV1` rule on a thawed vault; thawed only inside a redemption that must end in a burn. SR.5–SR.5e measure stranger, transfer delegate, collection update authority (control) all refused `0x1a`. Post-burn the PDA is unreachable forever (impossibility 4). Direct call needs the PDA signature (SR.1).

(b) Pair list: duplicate source → second `read_token` sees a System-owned closed account → `IllegalOwner` (SR.12a). Duplicate destination: two transfers, harmless. Source == destination impossible (`to_owner` must equal `dest` ≠ `signer`). Native wSOL source: `Transfer` then `CloseAccount` returns wrapped lamports to `dest`; harmless (untested, see R8). Frozen source with balance reverts (SR.14); frozen with zero is closed (round 30, not in the suite). Destination owned by another vault's asset-signer: allowed, owner's choice.

(c) Destination not compared to the owner: safe because only the owner can sign the Execute; a malicious page is a phishing risk for any signed transaction. Lamports to a non-System account are allowed (R27.S1); to a non-existent account below rent-exemption refused (SPEC 50 states it).

(d) Closes send rent to `dest`, not the signer, so `signer.lamports()` read after the loop is exact; nothing in Core credits the signer afterwards; BURN reads the live value.

(e) Closed reserve account → System-owned, 0 lamports → BURN's reserve loop `continue`s on owner, second loop `continue`s on lamports. Correct reason. Missing reserve ATA at build time: a stranger's ATA-create-plus-deposit blocks (`VaultNotEmpty`); the prior-transaction create is sufficient because an existing ATA cannot be removed from a sealed vault. No further account class blocks (T22 derivation impossible; non-ATA accounts and nested assets are ignored, not blocking).

(f) S8.0: 1,061 bytes; +52 +96 = 1,209 of 1,232. A fourth reserve cannot exist. The in-line monthly run adds no accounts. **But** every stray-classic-token pair costs ≥66 bytes, so zero pairs fit the widest page shape (SPEC 50 says "mind the packet"); see L4 for a pre-lock option.

(g) Helper deployed in the suite is `target/deploy/cbob_vault_sweep.so`; `build-mainnet.sh` `cmp`s dist against both a fresh localnet build and that file. Proven.

**No program finding.**

---

## R2. The pool

Invariant `pool ≥ ceil(owed)`: `credit` adds `delta·w ≤ avail·1e12` to `owed`, so `ceil(owed')/1e12 ≤ ceil(owed)/1e12 + avail = balance`; `claim` subtracts `pay·1e12 ≤ pending`; `retire`/forfeit subtract `pending`; join/reweigh/expire leave `owed` unchanged. Sum invariant `owed_scaled = Σ_active owed_of(r)` holds through each operation (checked each transition). Nothing but MINT can debit the pool. Holds.

SPEC's weaker rule ("never credited by a distribution that ran before it joined"): `join` sets `debt = w·acc`; `JoinWaitingFirst` in both `distribute` paths and the `waiting_to_join > 0 → return` in `monthly_inline` are the only three sites that call `credit`/`tick`, so `acc` cannot move between eligibility and join. Holds.

Counters: `pending_this_epoch` reset only in `advance_epoch`; `retire` of a pending record decrements `pending_count` and, iff `request_epoch == dist_epoch`, `pending_this_epoch`; `waiting_to_join` stays consistent (F21.1). Liveness: joining needs only `(record, vault_ata)` and never the account itself; expiring needs only the record; `PoolShort` is unreachable; the w==0/pending==0/balance>0 state is limit 45's terminal state.

**No finding** (one refinement to limit 28, I3).

---

## R2b. The boost

Exactly N: bought at epoch e, `end = e+N`, ring slot `end % 64`; distribution N moves epoch to e+N and `advance_epoch` adds that slot to `boosts_due`; `BoostsExpireFirst` and `monthly_inline`'s early return block distribution N+1 until expired. Ring collision impossible because every live end lies in (e, e+63] (N ≤ 63). `reweigh` moves owed to `carry`, debt to `after·acc`, `owed_scaled` untouched; `expire_boost` unschedules with the old `boost_weight` before `reweigh(…, 0)`. `retire` handles due (−`boosts_due`) and not-due (−ring slot) branches. Host test N1 drives 260 epochs through the real functions; BO.34/38 measure wraps on chain. A due boost on a bare-burned, un-retired vault expires via `expire_boosts` (records only). No way to make distributions impossible.

**No finding.**

---

## R3. The level draw

SlotHashes parse: `u64 count` then `(slot, hash)` entries, bounded to 512, length-checked, zero-hash refused, key pinned. Skipped-slot rule "smallest produced in `[want, want+64]`" is deterministic because past production is final; the 300-slot window keeps A inside the 512 buffer. FIFO strict; a burned head still draws (L.11). Reschedule to `now+16`. Attack surface matches limits 25/26; HOLDER-GUIDE's draw sentence is true.

**Worse than SPEC 26?** No in kind: B's leader can skip its whole group to move C to a different leader but cannot pick hC; a validator holding B's and C's groups has more choice but still "selection within the levels left". One consequence SPEC 26 states ("or a reschedule") I confirm: the rescheduler chooses `now`, hence which rotations A/B/C land in.

**One MEDIUM evidence gap at the FIFO head — M1 below.**

---

## R4. Governance

Snapshot divisor at creation, index snapshot, YES ≥ 10%, half-of-all for key changes, `KeyChangesBundled`, per-kind supersession with the mark moved before the `round_already_over` skip (3c.R1), GOV's `>=` skip matching MINT's `<` refusal. No way for a minority to pass; no action reaches money beyond the ruled surface. Freeze-forever states: all vaults redeemed/orphaned (limit 45, "What got worse"), hot-wallet capture in the charter window (limit 46), a guardian stop at <50% turnout (limit 47). I found nothing worse than SPEC 47 (I5 is an INFO about the same key before launch).

**No finding.**

---

## R5. Charter claim

Address-pinned Merkle with domain tags and sorted pairs (matches `scripts/pob-merkle.mjs`); owner-signed CPI burn in the same instruction; `pob_extra` never signers; clock-only window; not guardian-gated. SPEC 46 as written is complete for what I can derive: the positive bound (no transfer/burn by the update authority) is now measured (R32.A22); moving a PoB out of the collection or changing its update-authority discriminator is the stated brick class; `BurnCollectionV1` cannot destroy a non-empty collection. A PoB holder who transfers to a program and claims by CPI (R27.C1) gets an unredeemable but voting vault — their own loss.

**No finding.**

---

## R6. One-time configuration and the trusted hop

Every `initialize` recomputed against its bounds. Wrong-but-accepted-forever values beyond item 38's list: a `charter_opens_at` far in the future (only the span and `closes > now` are bounded) — see L5. Swap operator worst case = cap × cooldown windows until the stop, bounded by balance above the reserve; mint cbBTC never touches it. Royalties: `UpdateCollectionPluginV1` and `RemoveCollectionPluginV1` with authority None are measured refused on a control (R.6/R.6a); `ApproveCollectionPluginAuthorityV1` (changing the plugin authority away from None) is not measured — L6. Rolling window: `kth = ring[(head+64−k)%64]`, `now − kth ≥ window`, head written after; exactly "fewer than cap in the trailing window". Correct.

---

## R7. Cross-program raw reads

Recomputed every offset from the struct definitions: MintConfig `governance` 41, `pool_ata` 73, `round_id` 105, `price` 125, `minted_total` 141, `sales_stopped` 191, `sweep_stopped` 192, `guardian` 193, `swap_operator` 225, `sol_reserve` 257, `max_sweep` 266, `cooldown` 274, `last_sweep` 282, `charter_closes_at` 442, `bare_burns_retired` 454, `last_distribute_at` 510, `sales_stopped_at` 518, `sweep_stopped_at` 526, `monthly_secs` 574, `sweep_floor` 631, `cooldown_ceiling` 639, `reserve_ceiling` 647, `dist_epoch` 655, `cbob_mint` 679, `max_boost_weight` 711, `max_boost_epochs` 712, `boost_expiring` 749..1005; space 1,005 + 256 = 1,261. VaultRecord `mint_index` 41, `carry_scaled` 195..211; space 211 + 10 = 221. SEAL config reserves at 41. BurnConfig `burned_total` 42, ring 59..571, space 827. GovConfig `proposal_count` 53. Helper offsets 0/32/64, length 165. Core opcodes 20/3/6/12 and plugin discriminants 17/6 match the Core enums. All correct.

---

## R8. The suite, the simulation and the build as evidence

### S1 — LOW — Arm 2.1 cannot fail (regression from the round-32 W2b rewrite)

`tests/3prog.test.ts`: `const vKp=Keypair.generate(), V=mkV(vKp,alice,[])` precedes the mint, then `rec('2.1','a vault minted in a voted round','true',String(!!V.asset))`. `V.asset` is `vKp.publicKey`, set before any transaction; the arm records `true` whether or not `vMint` landed. The mint's success is checked by R31.W2b, 2.2 and 2.2a, so the property is still covered, but 2.1 is a dead arm counted toward `MIN_ASSERTIONS=861`. **Evidence:** comment out `ixMint` in that block; 2.1 still prints `ok`. **Repair:** `rec('2.1', …, 'ALLOW', vMint.ok ? 'ALLOW' : 'REJECT', vMint.err)` and leave the floor at 861.

### Arms the prompt names that nothing exercises

A wSOL source through the helper; a destination named twice; a destination wallet that is another vault's asset-signer; a frozen zero-balance source being closed (claimed "measured round 30", absent from the suite); `pob_extra = 8`; a 30-record `expire_boosts`; `NoPendingGuardian` on `apply_guardian`; the 7-day execution deadline (constant, stated untested); the worst-case vault shape at the FIFO head (M1); `ApproveCollectionPluginAuthorityV1` on the None-authority Royalties plugin (L6). Round 32's A13 marked most of these optional; under its own gate 5 reasoning the two with permanent consequences (M1, L6) are not optional.

### Arms that throw rather than record

`C.2` (`String(!!C1)`), `S2.*` chaining on `TV` — a failure crashes the run (`FATAL`, exit 2) instead of recording a mismatch. The runner treats a crash as red, so no false pass, but the floor-equals-count discipline does not see them as arms.

### Build

The sweep helper is proven byte-identical across dist / fresh localnet / `target/deploy`. The four keyed programs are not and cannot be byte-identical to the tested binaries; the banner says so. The residual (a third wrong key would also reject) is correctly labelled NOT PROVEN.

---

## Findings

### M1 — MEDIUM — The FIFO's dependence on Core's `UpdatePluginV1` is measured only on a near-maximum shape; a failing reveal at the head halts every later level, activation and payout forever

**Construct.** `programs/cbob-vault-mint/src/lib.rs` `reveal_level`: `c.revealed_total += 1` and `r.level` are written in the same instruction as the Core `UpdatePluginV1` (Attributes) CPI; a CPI failure reverts both. `activate` requires `r.level ∈ 1..5` (`NotRevealed`). So one vault whose Core write fails blocks `revealed_total` at its index: no later vault can be revealed, activated, or paid, permanently (nothing can skip it; no admin; immutable).

**What an owner controls.** Only owner-managed plugins can be added without MINT's PDA: FreezeDelegate, BurnDelegate, TransferDelegate, FreezeExecute (fixed size) and Autograph (variable, ≤ ~10,198 bytes per round 32's runtime measurement, reachable on mainnet through any user-deployed padding program, as the suite's wrapper shows). MINT bounds name (64), uri (200) and attributes (640 Borsh bytes). Round 28 measured the reveal landing on C1: one `charter` attribute, all five plugins, a 10,198-byte autograph — and in the same run Core could NOT perform smaller writes on that asset (clearing signatures, `RemovePlugin` of FreezeDelegate: heap exhausted). SPEC 40 records this as "bounded observations ... not a proof for every plugin shape or size combination". The true owner-reachable maximum (640-byte attributes + 64-byte name + 200-byte uri + the five plugins + the 10,198-byte autograph, roughly 700–900 bytes more than C1) has not been measured, and the observed non-monotonicity (a bigger write succeeding where smaller ones failed) means the result cannot be inferred from C1.

**Gain.** A hostile minter spends one vault to end the level queue for every vault minted after theirs. Cheap relative to the harm.

**Evidence if I am right.** Mint a paid vault with exactly `MAX_ATTR_BYTES` of attributes (the L.12 `exact()` list), a 64-byte name and 200-byte uri; add the five owner plugins and a 10,198-byte autograph through the wrapper (R28.A1's path); bring it to the FIFO head; `reveal_level` fails with Core's `memory allocation failed` and `revealed_total` does not advance. If it lands, this finding reduces to a pinned arm.

**Repair (before the lock, owner decision).** Either (a) measure and pin the arm as above; or (b) decouple the FIFO from Core's write: have `reveal_level` draw the level and advance `revealed_total` without the Core CPI, and add a permissionless `write_level_attribute` that performs the Core `UpdatePluginV1` for a drawn vault once (the payout side already reads `VaultRecord.level`, so no money depends on the asset attribute; the holder-facing "written onto the vault" would become best-effort for a pathological asset). (a) costs nothing on chain; (b) changes `programs/` and resets the freeze.

### L1 — LOW — HOLDER-GUIDE and SPEC omit that a signed owner-managed freeze with a foreign authority makes a vault permanently unopenable (an extortion vector)

**Construct.** Core's owner-managed `FreezeDelegate` and `FreezeExecute` take an `authority` chosen at add time. A `FreezeDelegate { frozen: true, authority: X }` rejects transfer and burn (so BURN's `BurnV1` CPI, a bare burn, and a sale all fail) and Core refuses `RemovePlugin` while frozen and `UpdatePlugin` by anyone but X; `FreezeExecute { frozen: true, authority: X }` rejects Execute (the sweep), so BURN refuses `VaultNotEmpty`. Either way the owner cannot redeem until X thaws. A dApp can bundle the `AddPluginV1` into any transaction the holder signs.

**What the documents say.** HOLDER-GUIDE "Leave add-ons off your vault NFT" names only the autograph heap boundary. SPEC 46 states the freeze-delegate case for Proofs of Burn, nowhere for vaults. Payouts would continue to be credited and claimed into the frozen vault, so the extortion target holds its own growing balance.

**Evidence.** Add `FreezeDelegate{frozen:true, authority: stranger}` to a funded vault the owner holds; the owner's `updatePlugin frozen:false` and `removePlugin` are refused by Core; a full redemption transaction is refused at `BurnV1`; the stranger's thaw lands. None of this is in the suite (R26.P1–P7 use the owner as authority).

**Repair.** One sentence in the guide's "Things to know" and in SPEC's vault limits; an arm measuring the four refusals. No program change.

### L2 — LOW — `ApproveCollectionPluginAuthorityV1` on the None-authority Royalties plugin is not measured

**Construct.** "10% forever" rests on Core refusing every change to a plugin whose authority is `None`. R.5/R.6/R.6a measure update and removal on a keypair-authority control. The third mutation Core offers, changing the plugin's authority (`ApproveCollectionPluginAuthorityV1`) by the collection update authority, is not measured. Core's documented semantics say None is terminal; the suite's own standard is measurement.

**Evidence.** On `ctrlNone`, `approveCollectionPluginAuthority({plugin: Royalties, newAuthority: UpdateAuthority})` signed by `ctrlUA` must be refused by Core; on `ctrlUa` the same call lands (control). If the None case landed, a subsequent update at 50% would land too and "forever" would be false — on the CBOB collection only MINT's PDA could sign it and MINT has no such CPI, so the exposure is a Core-rule dependence, not a present hole.

### L3 — LOW — `charter_opens_at` has no on-chain bound relative to the clock

**Construct.** MINT `initialize` requires `closes > opens`, `closes − opens ≤ 90 d`, `closes > now`. An `opens_at` one year ahead (a date typo) passes; the window, the monthly clock and every mint then wait a year, with no instruction able to correct it. Item 38 states the general permanence; the checker is the only gate and `charter_opens_at` is the one value still OPEN in `launch/mainnet-init.json` (not bundled here, so whether the checker bounds it against the box clock is unverified).

**Repair.** Checker: refuse `charter_opens_at` outside `[now, now + N days]`. Optional before the lock: `require!(charter_opens_at <= now + MAX_CHARTER_SECS)` in MINT.

### L4 — LOW (pre-lock option) — BURN requires declaring a Token-2022 ATA that can never exist, spending 96 bytes of a packet with 23 to spare

**Construct.** `burn_vault` demands both derivations for each of three reserve mints; the Token-2022 derivation of a classic mint is refused by the ATA program (probe F4.2, mainnet-simulated) and by Token-2022's `InitializeAccount` (mint owner mismatch), so it is always absent and always skipped. Those three keys cost 96 bytes; SPEC 50's widest page shape has 23 bytes left, so no stray-classic-token rescue pair (≥66 bytes) fits it, and item 44's "sweep list rather than a warning" is only true of narrower shapes.

**Repair (owner decision; changes `programs/` and resets the freeze).** Require only the classic derivation; keep the second loop's Token-2022 handling for declared strays. Measured consequence: 1,209 → 1,113 bytes, one rescue pair fits the widest shape. If not taken, SPEC 44 should say the rescue fits only the owner-pays, no-compute-budget shape.

### I1 — INFO — SPEC REDEEMING step 1 contradicts item 42

Step 1 says a 3-asset redemption that also creates destination ATAs "does not fit one legacy transaction (stage 3 measured 2 mints only)"; item 42 (round 26 D4) says the owner-pays helper shape with all three creates is 1,219 bytes and the categorical claim "was false". Pick one wording.

### I2 — INFO — DESIGN-v6 inaccuracies beyond round 32's D1

- 6a: "`set_round` refuses any price below `MIN_ROUND_PRICE_SATS`, fixed at `initialize`" — it is a compile-time constant (`pub const MIN_ROUND_PRICE_SATS: u64 = 21_000`), not an `initialize` value.
- 4: `cancel_swap_operator` "clears a voted swap operator that is still inside its notice" — the code cancels any pending operator, including one whose notice has elapsed but which nobody has applied (there is no apply-by deadline; SPEC states this, DESIGN does not).
- 6: "the same one-time call fixes everything" — four calls across four programs.
- 3: `claim` pays `weight * acc - debt` — plus `carry`.

### I3 — INFO — Limit 28 refinement: an explicit `distribute` during a pool freeze enlarges every redeemer's forfeit, for 100 $GARY

SPEC says "An explicit `distribute` is not refused for a frozen pool; it can only make vaults owed again". Consequence unstated: a third party can, during a Coinbase freeze, convert the pool's undistributed balance into credited-and-undeliverable shares; every vault that redeems during the freeze then forfeits that credit back to the pool, where it is redistributed to the vaults that stay, the burner's included. Economically marginal; a one-sentence addition to limit 28 and the guide's "only payouts credited and not yet delivered stay behind".

### I4 — INFO — HOLDER-GUIDE does not state the orphan dilution SPEC 9/44 mark BUYER-FACING

SPEC 44: "*Who:* … for a nested vault left activated, every other vault's payouts forever (round 29 D2)". The guide says a nested vault "is destroyed when the vault is opened" and nothing about an activated orphan (or a vault sent to its own deposit address) taxing every other holder's payouts permanently. A griefer can also *activate someone else's* bricked vault by funding its ATA with 21,000 sats (`activate` is permissionless and reads only the balance), so the dilution is not only self-inflicted.

### I5 — INFO — The guardian key is also `INIT_AUTHORITY`; a theft before `initialize` lets the thief write every permanent value first

Recoverable before the lock only by redeploying at new program ids. Limit 47's "operational note" does not say this; the deploy runbook (road step 10) should order: deploy → Gary's `initialize` × 4 in one sitting → verify on chain → lock, and treat any delay as a risk window.

---

## The four questions about the accepted limits

**1. Worse than stated?**
- Limit 40 (Core size boundary): the consequence of a reveal that cannot land is stated for a *Core upgrade*; for an *owner-crafted* asset at the FIFO head it is the same permanent halt of every later vault, and the owner-reachable maximum is unmeasured (M1).
- Limit 28: see I3 (a third party can enlarge forfeits for 100 $GARY).
- Limit 44: "sweep list rather than a warning" holds only in the narrow page shape (L4).
- Limit 26: not worse in kind; the rescheduler's choice of rotations is already stated.
- Limit 47: not worse; the same key's pre-launch exposure is I5.

**2. Listed as a limit but not one / already closed?**
- Limit 42's first sentence ("must prepare … in a PRIOR transaction") is correct for the padded shape; its own text already records the narrow exception — fine. SPEC's REDEEMING step 1 still carries the old categorical claim (I1).
- Nothing else listed is closed by something unnoticed.

**3. DISCHARGED not discharged?** 51, 54, 12/17, 14, 19, 30, 31, 33 and the Bank-era family hold against the code. One caveat on 54: "a claim batch … 14-vault batches sit near 60,000 … extrapolated" is honestly labelled.

**4. OPEN AND BLOCKING quietly accepted?** No. 22, 38, 50, 52, 53 remain listed OPEN and the road table says "not started"/"open" for each. Round 32's A1 (gate 5 unmet) was repaired with six arms; two further measurable refutations (M1's boundary, L2's None-authority approve) are not yet arms, so gate 5 is still not fully met.

---

## Other observations (no finding)

- HOLDER-GUIDE promises checked sentence by sentence against the code: the activation description ("joins the payouts at the next distribution and earns from every one after that") compresses request → eligibility → join → earn but is not false; the first-payout timing is correct (`last_distribute_at = max(now, charter_closes_at)`, burn path `NoActiveVaults` at w=0); the frozen-vault, frozen-pool, cap, boost and key statements are true of the code.
- `bank/txread.mjs`'s `Log truncated` exact-string check cannot be forged by `msg!` (prefixed `Program log:`); v1 lookup-table refusal is fail-closed as SPEC states.
- The expiry-budget gate is synthetic genesis and says so.
- `audit-coverage.sh`'s "never sent" grep deliberately counts either focus; the per-focus discipline lives in the content check. Consistent.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what to do before launch that AI audit structurally cannot

1. **Measure M1 at the true maximum shape before the lock**, on the pinned Core, and decide (a) pin or (b) decouple. An AI can name the boundary; only a run on the binary answers it, and after the lock the answer is final.
2. **Independent reproducible builds.** Have at least two people on different machines rebuild the five programs from the release commit with the pinned toolchain (`cargo-build-sbf 4.1.0 / platform-tools v1.54`) and match `dist/SHA256SUMS`; then compare the on-chain `ProgramData` ELF (offset 45) to those bytes before removing the authority. The build script's own banner says the key constant is NOT PROVEN by behaviour; reproducibility is the bridge.
3. **Read back every `initialize` result from chain** (decode all four configs with `bank/layout.mjs` plus SEAL's reserve list) and sign off each value against `launch/mainnet-init.json` *before* `set-upgrade-authority --final`. The checker validates JSON, not what landed.
4. **Run the dress rehearsal exactly as item 22 lists it**, including the forced post-sweep failure and the Meteora fallback, with the hand-recovery runbook followed by someone other than its author.
5. **Key custody ceremony for the three keys that decide the first week**: Gary's wallet (`INIT_AUTHORITY`/guardian) signs four initializes and then is used only to stop; the Moments hot wallet is monitored by a second person during the 7-day window with the Oracle-removal procedure rehearsed; the swap operator wallet holds only its float.
6. **A public bug bounty on the frozen tree before the lock**, with the suite and simulation as the reproduction harness. Adversarial humans with capital find economic attacks (orphan funding, griefing economics) that reading does not.
7. **Build the redeem page and run it against the rehearsal deployment** (item 50): `judgeRedemptionCoverage` before signing, the helper sweep, prior-transaction account creation, the frozen-pool branch without `claim`. The programs are only as safe for holders as the client that drives them, and nothing on chain forces that client.
8. **Lock in the right order, in one sitting**: deploy → initialize (SEAL, MINT, BURN, GOV) → create the three cbBTC accounts and fund the revenue PDA → read back → lock all five → *then* let `charter_opens_at` arrive. Any gap between initialize and lock is the window I5 and limit 13 describe.