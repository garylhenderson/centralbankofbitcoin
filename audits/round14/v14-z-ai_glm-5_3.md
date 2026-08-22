# ROUND 14 — INDEPENDENT AUDIT

**Calibration note first.** Every finding below states what evidence would exist on-chain or in a test run if I am right, and what would kill the finding. Two of the three headline findings are settleable by scripts of under 25 lines against the validator this project already runs. I invite you to run them before believing me.

---

## HEADLINE

**C1 (CRITICAL):** `burn_vault`'s `ReserveNotOurs` check makes every derived reserve-ATA address a permanent brick. A stranger can seal any vault's Bitcoin forever for ~0.002 SOL, and for classic-SPL reserve mints the Token-2022 derivation — which the round-13 verdict called "unreachable" — is *always* free to occupy. The verdict's rejection of the T22 finding rests on a false mechanics claim. (Full treatment under VERDICT CHALLENGES; cross-referenced from R2.)

**H1 (HIGH):** The 9.14 harness that justified `MAX_RESERVE_MINTS = 3` measures a narrower transaction than any real customer's redemption. It omits owner-side ATA creation and the griefable PDA-lamports sweep. At 3 mints, an owner without pre-existing ATAs for every held reserve is at or past the 1232-byte ceiling. The cap is certified by 9.15/9.16 against a best-case measurement.

**H2 (HIGH):** `normalise()` in `bank/alarm.mjs` crashes on any versioned transaction in our programs' history. `split_revenue` is permissionless; one v0 transaction from a stranger permanently crash-loops the entire watcher.

---

## R1 — `correlateBurns`

### R1-a (MEDIUM): The correlation window is one pass wide in both directions. The "self-correcting" claim is false, and a legitimate redemption can arrive as a CRITICAL accusing it of being "what a BARE Core BurnV1 looks like."

**Construct.** `correlateBurns` sees only the current pass's findings. State carries `vaults` (live set) and `cursors` — neither preserves `burn_via_program` observations. The two instruments run at different points of the pass with different lag: `listVaults` (DAS) at the top, the signature walk later.

**Failure.** Take a redemption landing in the minutes before `listVaults` runs, with DAS lag exceeding the gap to the walk (DAS indexing routinely lags signature history by seconds-to-minutes):

- Pass N: DAS has not indexed the burn → vault still live → no `vault_burned`. The walk sees the transaction → `burn_via_program` INFO.
- Pass N+1: DAS catches up → `vault_burned` CRITICAL. But the walk's cursor advanced past the redemption transaction in pass N (cursors only move forward) → no `burn_via_program` → **the finding stays CRITICAL**, with the appended text "NO burn_vault was seen for it in any transaction this pass scanned, which is what a BARE Core BurnV1 looks like."

The walk-lags-DAS ordering produces the same one-shot false CRITICAL one pass earlier. In *neither* ordering is it self-correcting: after the CRITICAL pass, the vault is out of `prevLive`, so `detectVaultSetChange` can never emit for it again. "The next pass sees both" is impossible by construction — the next pass sees only the INFO. The false CRITICAL is never retracted, and it is the maximally alarming text in the file, fired at an honest customer exit.

**Gain.** Not attacker gain — alarm fatigue, in the fail-safe direction, but with the specific accusation this whole repair was built to stop firing on the normal path at a nonzero rate per redemption. This is a smaller dose of exactly the disease round 13 set out to cure.

**Evidence.** Proof by construction (no run needed): the correlation inputs are `(this pass's DAS diff, this pass's walk findings)`; state preserves neither instrument's prior-pass observations except the live set, which drops the asset precisely when the CRITICAL fires. To see it live: redeem a vault 60 seconds before a pass on a cluster where DAS lags — expect the CRITICAL on the following pass.

**Fix.** Persist the prior pass's `burn_via_program` asset set in state (a handful of pubkeys) and let `correlateBurns` accept it as a second correlation source. Also correct the "self-correcting" comment — it is an R8-class false claim today.

### R1-b (verified negative): I could not construct a laundering of a bare burn into INFO, and I state the reasoning so it can be checked.

The downgrade of `vault_burned(B)` requires a `burn_via_program(B)` finding in the same pass, which requires a **scanned, successful** transaction containing an instruction to the BURN program with the `burn_vault` discriminator and B at account 0. Failed transactions are skipped (`if (s.err) continue`). A successful `burn_vault(B)` *is* a program redemption of B — Bank co-signed, emptiness proven — and B is then a tombstone, so no later bare burn or second burn of B can succeed. The specific vectors asked about: a failed `burn_vault` → transaction skipped; naming B in a burn of something else → account 0 *is* the asset burned, the handler validates and burns account 0; a CPI'd `burn_vault` in a wrapper → `normalise` includes inner instructions, but a successful CPI'd `burn_vault` requires a top-level `open_for_redemption` earlier (its own backward scan), and SEAL's open requires a top-level `burn_vault` later — so a CPI'd burn can only succeed inside a transaction that also contains a genuine top-level burn of the same asset. Per-asset correlation is sound. **No fail-open ordering exists.**

### R1-c (LOW): `burn_via_program` HIGH→INFO was correct in direction, with one cost worth naming.

The pairing is chain-guaranteed, so HIGH carried no information — the downgrade is right. The cost: INFO findings appear in no email, so redemptions now leave no urgent-channel trace; the operator's record is the log file, which logrotate compresses away after 14 days. The chain is the canonical record, so this is minor — but if anyone ever relies on the alarm log as a redemption register, 14 days is not it.

---

## R2 — `MAX_RESERVE_MINTS = 3` and the 9.14 harness

### R2-a / H1: The harness is narrower than a production redemption. It silently assumes the owner already holds a destination ATA for every reserve mint, and assumes nobody has ever sent lamports to the PDA.

**What 9.14 builds.** `ixOpen` + one `ExecuteV1` wrapping (transfer + close) per mint + `ixBurn` with both ATA derivations declared per mint. Real signer set, real blockhash, real vault holding all N reserves. That part is honest.

**What it omits — and production cannot:**

1. **Owner-side ATA creation.** The sweep destination `getAssociatedTokenAddressSync(m, alice.publicKey, true)` must *exist* at execution. The harness never creates alice's ATAs for the extra mints (only the vault-side ones), and never includes `createAssociatedTokenAccountIdempotentInstruction` — it serializes a transaction that would fail at runtime. A real customer redeeming 3 reserves who holds only a cbBTC ATA (the common case — activation requires only cbBTC) must create 2 destination ATAs in the redemption, or in a prior transaction nothing in this repository performs or requires. Marginal cost: first create ≈ 74 bytes (ATA program key 32 + mint key 32 + ~10 instruction), subsequent ≈ 42 (mint key + instruction). Two creates ≈ +116.
2. **The PDA lamports sweep.** Anyone can send lamports to the derivable asset-signer PDA at any time (the SPEC's own known grief). When they do, the redemption must include an `ExecuteV1`-wrapped `SystemProgram.transfer` (~35–60 bytes) or the burn refuses on `lamports() != 0`. This component is *attacker-forced*, not customer-chosen.
3. **The transaction is never landed.** Serialization proves bytes, not execution. CU is unmeasured (already carried) — but the harness builds the real transaction and never calls `simulateTransaction`, which would have measured CU for free.

**Arithmetic (estimate, ±20 — the point is the shape, and 9.14 must be re-run to settle it):** base 1090 + ~116 (two creates) + ~37 (lamports) ≈ **1243 > 1232** for the cbBTC-only owner; ≈ **1285** for an owner holding no ATAs at all (the marketplace buyer — exactly the customer the redemption exists for). Best case (all ATAs pre-held, no lamports): 1090, fits.

**Gain.** The same strand-class defect round 13 fixed, resurrected at the number it settled on — conditional on a client behavior (pre-creating ATAs) that no code performs and no document states, plus an attacker-controllable component. 9.15/9.16 then tie the on-chain constant to this narrow measurement, so the certification inherits the harness's assumptions.

**Evidence.** Re-run `sizeFor` with `createAssociatedTokenAccountIdempotentInstruction` for each owner-side ATA that does not pre-exist, plus one lamports sweep. Expected: N=3 lands ≈1240–1290 for those owner shapes. If it lands ≤1232 for the zero-ATA owner, this finding dies.

**Fix.** Re-measure with the omitted instructions; then either (a) drop the T22 declarations (−~96 bytes at N=3, already carried — note this makes 3 safe for all owner shapes: ~994 base, ~1189 worst case), or (b) build the redemption client with an explicit two-step precondition (pre-create ATAs, then redeem) and state it in SPEC, or (c) lower to 2. As shipped, **3 is only proven safe for the best-case owner.**

### R2-b: ALT question answered.

A v0 transaction with an ALT replaces 32-byte keys with 1-byte indices against a table listed once (~32 bytes/address + per-tx index). With ~25–30 accounts in a 3-mint redemption, an ALT buys back several hundred bytes — more than doubling headroom. **Nothing in this repository builds one.** `revenue.mjs` *deserializes* a Jupiter versioned transaction; no file constructs a versioned redemption. The SEAL comment's claim that a fourth mint "requires a versioned transaction, a redemption client that builds one, and a measurement proving it lands — none of which exist" is accurate.

---

## R3 — `detectNestedVaults`

### R3-a (MEDIUM): The docstring assigns foreign-asset coverage to the reconcile, and the reconcile does not do it.

**Construct.** detectors.mjs: "BLIND TO: a FOREIGN Core asset (one outside our collection) nested inside a vault — that needs a per-vault DAS owner search and **is the reconcile's job, not this one's**." `reconcile()` runs `detectIndexShortfall`, `detectNestedVaults`, and `getTokenAccountsByOwner` loops. It performs **no per-vault DAS owner search**. SPEC says the opposite and honestly: "a foreign Core asset nested in a vault needs a per-vault DAS owner search and **nothing does it**."

**Gain.** A foreign Core asset nested in a vault is destroyed by an undeclared burn with **zero detection anywhere** — the exact round-6 shape ("BURN's header promised a reconcile no shipped file called"), recreated in the comment of the very detector built to close that class. The gap itself is stated in SPEC; the docstring misattributes it to a control that does not run.

**Evidence.** Read `reconcile()`. No `getAssetsByOwner` or equivalent call exists in the file tree.

**Fix.** Either add the per-vault DAS owner search to `--reconcile` (one `getAssetsByOwner(pda)` per vault, daily, expensive but bounded) or correct the docstring to match SPEC.

### R3-b: Burnt hosts included — correct.

A burnt host's asset-signer PDA is permanently unsignable; anything nested there is already lost, and the only route to that state is the 9.5 ALLOW (undeclared nested burn) — which is precisely the catastrophe worth a permanent alarm. One cost to note (LOW): after a 9.5 event the finding fires CRITICAL every 30 minutes forever with no resolution path — the distribution detector grew `resolvedBy` for exactly this; this one needs the same or it trains the operator to scroll.

### R3-c: DAS false positives/misses.

No false-positive path found: vault asset-signer PDAs are off-curve by construction (`find_program_address` skips on-curve bumps), wallet owners are on-curve, so a healthy vault's owner can never equal a vault PDA. Misses: DAS indexing lag (stated) and the foreign-asset scope (R3-a). No finding.

---

## R4 — `detectBankIsNotSignable`

### R4-a (verified): The rejection of the admin extension is CORRECT. No admin instruction breaks under a PDA admin.

Enumerated: SEAL `update_config`/`apply_pending`/`cancel_pending`; MINT `update_wiring`/`set_paused`/`set_collection_royalties`/