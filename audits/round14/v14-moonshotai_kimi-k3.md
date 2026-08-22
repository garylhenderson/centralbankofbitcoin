# ROUND 14 AUDIT — e16c5e2

Scope: the eight repairs, the five never-audited files, the verdict. I found no CRITICAL that survives scrutiny. I found four MEDIUMs, three of them in the repairs themselves, and a tail of LOWs. The two most important results are negative: `correlateBurns` cannot be laundered, and the admin exemption in `detectBankIsNotSignable` is correct. Both are argued below with the evidence.

---

## R1 — correlateBurns

### R1-a. Laundering: I could not construct one. The per-asset correlation is complete, GIVEN one on-chain fact, and that fact holds.

The downgrade requires a `burn_via_program` finding for the *same asset*, and that finding requires a **successful** `burn_vault` in a scanned transaction (`alarm.mjs` skips `s.err`). Every laundering path closes:

- **A `burn_vault` that fails** produces no finding (transaction fails → `s.err` → skipped). Solana is atomic; there is no "inner instruction failed but outer succeeded."
- **A `burn_vault` naming the bare-burned asset after the bare burn** fails on-chain: the tombstone is Core-owned with `data[0] = Key::Uninitialized` (measured 9.12), so `require!(d[0] == KEY_ASSET_V1)` throws `NotACoreAsset`. Transaction fails, skipped.
- **A `burn_vault` for a foreign asset** fails `ForeignVault` on-chain. So every asset that lands in `viaProgram` was *genuinely redeemed through the program* — owner signed, Bank signed, emptiness proof ran. The downgrade's claim is true of every asset it can ever contain.
- **A CPI-wrapped `burn_vault`** cannot succeed without a top-level `burn_vault` for the same asset+owner later in the transaction (SEAL's forward scan sees top-level only), and that top-level one then fails on the tombstone. So `burn_vault` can only succeed top-level.
- **A genuine redemption beside a bare burn in the same pass**: per-asset, asserted in the selftest (`gone(A), via(A), gone(B)` → B stays CRITICAL). Correct.

The downgrade of `burn_via_program` HIGH→INFO is also correct: a successful `burn_vault` is the normal path and carries no information the other detectors don't carry better.

### R1-b. MEDIUM — the "self-correcting" claim is false. Cross-pass lag produces a permanent false CRITICAL on a legitimate redemption — the exact noise this repair exists to eliminate.

The comment in `correlateBurns` says: *"It is also self-correcting: the next pass sees both."* That is wrong in **both** lag orderings, because the two instruments' findings never re-fire together:

- **DAS lags** (redemption lands just before a pass): pass N scans the burn transaction → `burn_via_program` INFO, but the vault still reads live → no `vault_burned`. Pass N+1: DAS shows it burnt → `vault_burned` fires — but the BURN-walk cursor advanced past the redemption in pass N, so pass N+1's `viaProgram` does **not** contain the asset → **stays CRITICAL, delivered, never reclassified.** Pass N+2: the vault-set baseline no longer contains it, so `vault_burned` never fires again.
- **Walk lags** (scan_gap): `vault_burned` CRITICAL this pass; the walk reaches the burn transaction next pass — but `vault_burned` does not re-fire (baseline already updated). The INFO correlation never happens.

The correlation only works when both instruments notice **in the same pass**. Redemptions landing in the minutes before a pass — a few percent of all redemptions, forever — each produce one permanent false CRITICAL email. That is the fail-safe direction (noise, not silence), but it is a partial defeat of the repair's stated purpose, and the comment claims a self-correction that does not exist — a wrong comment in the repair for wrong comments.

**Evidence if I'm right:** send a redemption ~30 seconds before an alarm pass against a deployment; the pass prints `burn_via_program` INFO only; the next pass prints `vault_burned` CRITICAL with the "BARE Core BurnV1" wording, and no later pass reclassifies it. The selftest cannot catch this because `correlateBurns` is stateless — the lag case is inexpressible in a pure function, which is how the comment survived.

**Fix:** persist recent `burn_via_program` assets in alarm state for one or two passes (the `deferredSweeps` pattern already exists for exactly this reason), and let `correlateBurns` consult them. Update the comment to say what the mechanism actually does.

---

## R2 — MAX_RESERVE_MINTS 8 → 3

### R2-a. MEDIUM — the harness is NOT the worst case. Three ordinary production additions exceed the measured headroom at the configured cap.

Test 9.14 measures: 2 signers (Bank is fee payer), no compute-budget instructions, reserves only. Its own comment calls this "the real WORST-CASE transaction." It is not:

1. **A fee payer distinct from the Bank**: +64 (third signature) +32 (a key not otherwise present) = **+96 bytes**. 1119 + 96 = 1215 ≤ 1232 — fits with 17 bytes to spare.
2. **Compute-budget instructions** (`setComputeUnitLimit` + `setComputeUnitPrice`) — the standard mainnet shape, and without a priority fee a redemption may not land in congestion at all: +32 (program key) + ~20 (two instructions) = **+52 bytes**. 1119 + 52 = 1171 — fits.
3. **Both together: 1119 + 96 + 52 = 1267 > 1232. A 3-mint redemption with a priority fee and a third-party fee payer does not fit the packet at the configured cap.**
4. **Rescuing an airdropped token.** The vault is sealed, so any sweep must live inside the redemption transaction; an airdrop not swept there is destroyed (9.9, asserted ALLOW). One airdrop rescue (src ATA + dst ATA + transfer + close ≈ +100 bytes) puts 1119 at ~1219 — thirteen bytes from the ceiling; two airdrops, or one airdrop plus either addition above, exceed it. At the configured cap of 3, **a vault holding two airdropped tokens its owner wants to keep cannot be fully redeemed in a legacy transaction.** Nowhere is "airdrops are forfeit at 3 reserves" stated — the harness comment instead claims it measured the worst case.

The cap of 3 is still the right *number* for a business with exactly three reserve assets. The defect is the harness's claim and the suite pin now resting on it: "THREE IS THE MAXIMUM … with 113 bytes to spare" overstates the margin, and 9.14a pins 1119 as if it were the ceiling that matters.

**Evidence if I'm right:** add the two compute-budget instructions and a distinct fee payer to `sizeFor(3)` and serialize — 1267 bytes, web3.js throws "Transaction too large." That is a one-line change to the harness; run it.

**Fix:** extend `sizeFor` to take `withPriorityFees` and `distinctFeePayer` and re-measure; either keep 3 with the real margin written down, or state in SPEC that a legacy redemption at 3 reserves admits no priority fee, no third-party payer, and no airdrop rescue — so the (currently nonexistent) redemption client's constraints are written before it is built.

### R2-b. Compute units — carried, and one note.

Still unmeasured anywhere (known-open #6). Nothing in the burn path looks CU-heavy at n=3 (the reserve loop's `iter().find()` is O(n²) over ≤6 accounts; the introspection scans are linear over ≤6 instructions), but "looks fine" is what bytes looked like before 9.14. A simulation with CU reporting is a cheap addition to 9.14 and would close it.

### R2-c. What an ALT buys: ~31 bytes per account moved out of the static keys.

At ~4 keys per mint, the per-mint marginal cost drops from 144 bytes to roughly 40; a v0+ALT redemption likely carries 8–12 mints. Nothing in this repository builds a v0 redemption transaction (revenue.mjs only *deserializes* Jupiter's). The SPEC statement is accurate. Also accurate and worth underlining: **no redemption client exists at all**, so the 9.14b requirement (destination ATAs created in a prior transaction) is an operational rule with no artifact to land in — it belongs in the co-signing tool's spec, which is also unbuilt.

---

## R3 — detectNestedVaults

- **Scope honesty:** the foreign-asset gap is now stated correctly in the detector comment (the tree already contains the correction naming the earlier "the reconcile's job" as a control that does not run) and in SPEC. Good. But see R3-b.
- **Burnt hosts included:** correct — a vault nested in a burned host is the unrecoverable case and must fire.
- **DAS false-fire on a healthy vault:** unlikely — a normal vault's `ownership.owner` is a wallet, never a vault PDA; mid-redemption states end burnt. A miss on indexing lag is stated.

### R3-a. MEDIUM — the new detectors have no `resolvedBy`. Two of the three findings they produce can never be answered, and will fire CRITICAL every 30 minutes forever.

`vault_owns_itself` is bricked forever by construction (proven impossibility 3). `nested_vault` into a **burnt** host is unrecoverable (the host's PDA can never sign again) — the selftest asserts it fires, and nothing ever clears it. `bank_is_off_curve` clears only after the 7-day rotation. This project's own rule, written after round 10 and applied to three other detectors: *"a finding with no way to be answered is one that will eventually be ignored rather than answered."* The two detectors added this round violate it. Note a nested vault in a *live* host IS resolvable — open(host) → Execute transferring the inner vault out → burn(host) with the inner undeclared works, because the burn's Core-asset check only examines *declared* accounts — so the finding is worth keeping; it needs the acknowledgement mechanism, not removal.

**Fix:** add `resolvedBy` support (state-keyed by asset) to `detectNestedVaults` and `detectBankIsNotSignable`, as `detectDistribution` already has.

### R3-b. LOW — the foreign-asset gap is closable and wasn't closed.

The daily `reconcile()` already loops per-vault over RPC. A DAS `getAssetsByOwner` per vault PDA in that same loop would cover foreign Core assets at daily cadence for zero new infrastructure. The comment says "nothing does it"; the honest addition is "and here is the one-line reason it isn't done in the reconcile that already walks every vault."

---

## R4 — detectBankIsNotSignable

### The admin exemption is CORRECT. I checked every admin instruction in all four programs.

`open_for_redemption` and `burn_vault` are the **only** instructions in the system that read the instructions sysvar. Every admin-gated instruction — SEAL `update_config`/`cancel_pending`; MINT `update_wiring`/`set_paused`/`set_collection_royalties`/`cancel_pending_*`; BURN `update_config`/`cancel_pending`; GOV `update_gov_config`/`cancel_pending_admin` — is a single top-level call whose signer checks Anchor enforces structurally; a Squads vault signs all of them by CPI. (`set_collection_royalties` is unreachable once governance is the GOV PDA, but that is the already-stated governance-PDA limitation, not an admin-PDA one.) The rejection of the admin extension is right, and firing on admin would cry wolf about the intended production shape.

The on-curve-relayer blind spot is stated honestly; no better off-chain proxy exists from config alone.

### R4-a. LOW — two holes at the edges of the check.

1. **`pending_bank` is not curve-checked.** An armed rotation to an off-curve Bank fires only the generic `rotation_armed` CRITICAL; the specific consequence ("every redemption halts when this lands") is never named. Run the curve check over `seal.pending_bank`, `burn.pending_bank`, `mint.pending_bank` too.
2. **A default-pubkey Bank is accepted by `initialize` and skipped by the detector.** `update_config` refuses rotation *to* `Pubkey::default()` (`require_keys_neq!`), but SEAL/BURN/MINT `initialize` accept `bank = 1111…` unchecked, and the detector deliberately skips the default ("QUIET on an unset bank" is *asserted*). The one misconfiguration that halts redemptions at birth is checked nowhere. One `require_keys_neq!` in each `initialize`, or stop skipping the default.

---

## R5 — Core in the drift watch

- **ProgramData derivation** `["<program>"]` under BPFLoaderUpgradeable is correct for Core.
- **`subarray(45)`** is the right slice when an upgrade authority is present (bincode: u32 variant, u64 slot, 1-byte Option tag, 32-byte authority). For an immutable program the ELF starts at 13, but the slice is deterministic per state, so drift detection is unaffected, and an authority revocation shifts the layout — which itself fires drift. Fine.
- **The sentinel** produces one self-correcting false CRITICAL when a degraded first pass is followed by a good read. Acceptable — loud, not silent.

### R5-a. LOW — the sentinel covers Core only; the four programs' ProgramData reads fail silently.

`missingWatchedKeys` exempts every `prog.*` key, so a failed ProgramData read for SEAL/MINT/BURN/GOV (RPC hiccup, provider rotation) sets `prog.X._missing`, produces no hash key, and the hash watch silently does nothing that pass — the exact class the sentinel was written to close, closed for the fifth program only. Set the sentinel for all five; "not deployed yet" is already distinguishable via `X._missing` on the config side.

---

## R6 — assertion floors

The `floor()` helper is correct for its purpose: it reads the numerator, a failing suite exits nonzero and `set -e` aborts before the floor is even consulted, and a partial pass cannot read as a pass. Substitution (delete ten hard assertions, add ten trivial ones) defeats it — a count floor is not a content check; that limitation is inherent and stated.

### R6-a. LOW — `selftest.mjs`'s own internal floor is 195 against a real count of 221.

The runner's `DET_FLOOR` is 221; the file's internal `FLOOR` is 195. The verdict claims "every floor equals its real count." This one is 26 below — the precise "floor below reality" defect round 12 fixed on-chain, left standing in the same commit that added the external floor. SPEC documents direct invocation (`node bank/selftest.mjs`), which bypasses the runner's floor. Set the internal floor to 221.

### R6-b. LOW — a failing selftest prints nothing.

`DET_OUT=$(node bank/selftest.mjs)` under `set -e`: on failure the assignment aborts the script and the captured output is never echoed. The old `| tail -3` always showed the tail. `DET_OUT=$(node … || true)` then echo, then check `$?` explicitly.

---

## R7 — account sizing after the constant change

Clean. SEAL `Initialize` allocates 542 bytes; the `Config` at n=3 serializes to 286; the 256-byte padding absorbs growth to 11 mints before a realloc is needed. BURN's `Initialize` does not use the constant (no reserve list in `BurnConfig`). All cross-program offsets (alarm 105/109+ n·32; BURN `OFF_RESERVES=105`; MINT 41/73; GOV 105/205) remain consistent with the layout. Nothing deployed, so no live account was shrunk. No finding.

---

## R8 — the comment corrections

### R8-a. MEDIUM — the correction missed three sites that claim the same nonexistent control.

The class this round exists to kill — a comment asserting a control that does not run — survives in three places:

1. **SEAL, `Config.reserve_mints` doc:** *"that gap is covered by the Bank co-signature and the off-chain scanner."* No co-signing tool exists. The program header was fixed; the struct field a reader actually lands on was not.
2. **BURN, "WHAT THIS CAN AND CANNOT PROVE":** *"That gap is covered by the Bank's co-signature — a Solana signature covers the whole transaction, so the Bank sees every instruction."* The header's ⚠️ corrects the general claim; this paragraph reasserts it.
3. **SPEC, proven impossibility #2:** *"anything else rests on the Bank co-signature and the off-chain scanner."* SPEC's own table two sections away says the co-signature is "NOTHING."

**Evidence if I'm right:** grep for "co-signature" / "co-sign" in `programs/cbob-vaults/src/lib.rs`, `programs/cbob-vault-burn/src/lib.rs`, `SPEC.md` and read each hit against "no file in this repository signs a redemption." Three hits claim coverage that does not exist. This is the sixth round in which this class has produced a finding, and it appeared in the repair for itself.

### R8-b. LOW — SPEC's "Running the tests" carries four stale assertion counts.

"178 assertions" (actual floor 267), "93 detector and 14 allocation" (actual 221 and 17), "10 allocation assertions" (17), and "bank/selftest.mjs (69 assertions)" (221) in the alarm section. These are the numbers the floors now enforce; the doc disagrees with all of them.

### R8-c. LOW — `run-tests.sh`: the comment above `MIN_ASSERTIONS=267` still reads "ROUND 13 … 227 -> 259."

The diff moved 259→264 without touching the comment; the tree moved to 267 (9.13a/9.14a/9.14b) without touching it either.

The corrected comments themselves (SPEC's table, both program headers, the alarm's all-clear) are accurate. The over-correction check: the headers now say "detected within thirty minutes, never prevented" — accurate, not over-corrected.

---

## The five never-audited files

### bank/anchor.mjs — correct, with one LOW.

Owner → length → discriminator → version, throw with cause, null only for absent. Both callers' offset maps match `MintConfig`. **LOW:** `alarm.mjs` still carries its own `acctDisc` and inline pin logic instead of importing this file — the preimage now lives in two places, which is the exact drift class this file was created to close (sigwalk already happened once). Migrate `readConfigs` to it.

### scripts/validate-core-gate.sh — the round-14 fixes are real; two LOWs remain.

`set -euo pipefail`, `must_fire`/`must_pass` dying on the wrong answer, and the shared `CACHE` default are all correct, and a stale surviving validator now fails *loud* rather than passing. **LOW 1:** the script re-implements `gate()` ("the EXACT logic from run-tests.sh") and never verifies `run-tests.sh` actually *calls* the gate — it certifies logic, not wiring, which is the same shape as the round-9 detector proven both ways while wired to nothing. A `grep -q 'cmp -s.*core-onchain' scripts/run-tests.sh` pins the wiring. **LOW 2:** no `trap … EXIT`; a `die` mid-script leaves its validator running (the next run's `kill_v` recovers, but the leak is real).

### tests/initauth.test.ts — sound.

The argument lists match the current `initialize` signatures; a stale list produces `InstructionDidNotDeserialize` → INCONCLUSIVE → the build dies. `REACHED_PAST` is correctly restricted to errors that can only occur below the authority check, and the Anchor-level errors are correctly excluded as proving nothing. The mainnet arm cannot false-pass: an absent authority check in SEAL yields `NoReserveMints`, which prints ACCEPTS, which fails the mainnet case. No finding.

### tests/probe-round5.test.ts — LOW: stale in three places, and unwired.

Its MINT `initialize` uses the pre-round-6 argument list (4 args; current is 11), its `mint_vault` uses the old 2-argument form (current is 4), and it passes `treasury` where the current account layout expects `revenue`. It cannot run green; nothing runs it (`run-tests.sh` never invokes it). Its REJECT assertions (D5.3) can pass for the wrong reason in some edit orders — the false-pass shape it exists to adjudicate. Its substance (born-frozen, bare-Execute refused) is now covered by 2.3a and 3.7. Fix it or delete it; a stale probe is a trap.

### tests/probe-round5b.test.ts — LOW: unwired but runnable.

It touches none of our programs' argument lists, so it still measures what it measures (D4: BurnV1 doesn't sweep the PDA; F4: T22 ATA is 170 bytes, T22-for-classic refused). That substance is now pinned by 9.10/9.11 and 6.13. Either wire it into `run-tests.sh` or delete it — an unrunnable-by-default proof decays into a wrong one.

---

## Verdict challenges

### "BurnV1 closes the asset account" — the REJECTION is sound.

9.12 measures the tombstone (Core-owned, 2,495,280 lamports, `Key::Uninitialized`); 9.13 measures the re-mint refusal holding the original keypair. The tombstone is reclaimable only by a Core instruction, none exists today, and a Core upgrade adding one now fires `prog.core.hash`. The conclusion generalizes as far as anything resting on Core can, and the dependency is watched. **One LOW against the measurement itself:** 9.13 has no `because()` pin — it asserts REJECT for *any* reason, while the verdict and SPEC assert a *specific* one ("the System program: account already in use"). This project's own rule — a reject for the wrong reason is a false pass, shipped three times — applies to the assertion that now carries this rejection. Add `because('9.13', 'already in use')`.

### "The dead Token-2022 derivation halves redemption capacity" — the partial rejection is sound; "unreachable" is TRUE.

Three independent reasons: the ATA program validates mint-owner == token-program (measured, F4.2); the derived address is a PDA of the ATA program and therefore off-curve, so no keypair can sign a System `createAccount` for it; and only the ATA program can `invoke_signed` for its own PDAs, and it refuses. No account can ever exist there for a classic mint. The cost is ~33 bytes per mint of the 144 — a quarter, as measured. Carrying the removal to a later session is the right call.

### The six accepted fixes.

1 (cap): right number, overstated harness — R2-a. 2 (correlate): laundering-proof, lag hole — R1-b. 3 (nested): works, unanswerable findings — R3-a. 4 (Core watch): correct, sentinel asymmetry — R5-a. 5 (bank signable): correct exemption, edge holes — R4-a. 6 (comments): incomplete — R8-a. **None of the six fixes is wrong in what it does; three are wrong in what they claim, and one is missing its resolution path.**

---

## Anything else

- **LOW — `initialize` accepts `bank = Pubkey::default()` in SEAL, BURN and MINT** (folded into R4-a.2).
- **audit13.ts:** deadline + incremental writes are correct; no finding.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Thirteen rounds of AI audit have a structural profile now, and it is nameable: the models find what is *describable*, and miss what must be *executed*, *waited for*, or *asked about in the first place*. The redemption path was inverted for twelve rounds while forty auditor-passes "covered" it, because every round audited files and none asked what the mechanic was supposed to be. That is the shape to design against. Concretely:

1. **Run a mainnet canary before real value.** Deploy, mint one vault with dust, redeem one, bare-burn one, nest one, and require the production pipeline to page on each — against real DAS lag, real RPC behavior, real email delivery. No assertion suite on a validator proves the *pipeline* works in production conditions; only production does. This is the single highest-value thing on this list, and no prompt can do it.

2. **Build the two missing artifacts, because unauditable procedures are unauditable.** The Bank co-signing tool and the redemption client are today "human procedures," which means the two most security-critical acts in the system — scanning before signing, and fitting the packet — have no artifact an audit round can read. R2-a and R1-b above are what "the procedure is the control" buys. Once they exist, they become auditable; until they exist, the honest SPEC line is the one already written: detected, never prevented.

3. **Adversarial execution, not adversarial reading.** Fuzz the pairing on the validator: random instruction orderings, duplicate opens, interleaved redemptions of multiple vaults, CPI wrappers (carried item 7), durable nonces, ALTs — thousands of generated transactions asserting no terminal state violates "thawed implies burned." AI rounds reason about constructions; a fuzzer *tries* them. The pairing survived one round of argument; it has never faced a campaign.

4. **Rehearse the one-shot ceremonies on devnet.** Deployment, initialize with the Squads INIT_AUTHORITY, the first mint, the first rotation — each is irreversible and each happens exactly once, in production, with no test able to redo it (R4-a.2 is a ceremony-time hole found only by reading). A written, rehearsed runbook with a devnet dress rehearsal is the only coverage available for these.

5. **Answer the economic questions no code audit can.** Marketplaces are under no obligation to honor the Royalties plugin — the royalty mechanic may be socially unenforced regardless of what the chain says. cbBTC has a live freeze authority; the distributor already trips over frozen ATAs. Jupiter route quality beyond a price-impact number. These are business-model risks, and thirteen rounds of code reading will never settle them.

6. **Treat the stopping condition as measuring model agreement, not correctness.** Two consecutive clean rounds with different rosters proves the rosters agree; models share training data and blind spots, and this project's own history (the inverted redemption) is a shared-blind-spot failure. The mitigations that actually add independence are already half-built: mechanic-organized rounds (round 13), coverage enforcement, and measurement over argument. The missing half is *execution-driven* adversarial work (items 1 and 3), which is the only thing on this list that does not share the models' blind spots by construction.

The process has earned its findings. What it has not earned — and structurally cannot — is the claim that agreement among readers is the same thing as a system that has survived contact with the chain.