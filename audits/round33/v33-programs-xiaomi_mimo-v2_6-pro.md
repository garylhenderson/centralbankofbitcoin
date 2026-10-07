Looking at this enormous codebase systematically. Let me work through each target.

---

# SECURITY AUDIT REPORT — CBOB Vaults v6 (current tree at `18dbff6`)

## R0. ROUND 32'S VERDICT AND REPAIRS

Round 32 was **NOT CLEAN** (1 LOW, 1 INFO). Both repairs are present and correct in this tree:

- **L1** (coverage gate's `bundles()` failing open on unrecognized `TARGETS` formatting): The shape-based split detection is at `scripts/audit-coverage.sh:122-135`, with `SystemExit` on unparseable splits and 13 both-ways selftest cases. Verified present.
- **D1** (three DESIGN-v6.md sentences): All three corrected — mint index in `VaultRecord`, `ClaimBeforeBurn` + `retire` semantics, `*_stopped` field names. Verified.
- **Ship-gate 5 arms** (R31.W1a/b, R28.A1 at 10,198, R31.W2a/b, R32.A22a/b): All six present in `tests/3prog.test.ts`. Floor `MIN_ASSERTIONS=861`. Verified.

No regression from the repairs found.

---

## R1. CUSTODY

The SEAL↔BURN pairing is sound. Both walks see top-level instructions only; both bind asset (index 0) AND owner (index 2); the stack-height check in `retire_redeemed` (`== TRANSACTION_LEVEL_STACK_HEIGHT + 1`) refuses CPI wrappers. WR.1–WR.4 measure all three wrapper shapes. The emptiness proof correctly handles closed accounts (System-owned → skipped), Token-2022 extensions (length ≠ 165 → refused), delegates, and close authorities. The completeness gap (undeclared accounts) is accepted limit 44.

**No new custody defect found.**

---

## R1s. THE SWEEP HELPER

Access control is Core's `ExecuteV1` rule (owner only), measured by SR.5–SR.5e. The pair checks (source owned by signer, destination owned by `dest` wallet with matching mint) are correct. Duplicate sources fail at the second `read_token` (SR.12a/12b). The lamport sweep empties the PDA to zero; BURN's `lamports == 0` sees exactly that. Closed reserve accounts pass BURN because their owner is no longer a token program.

**No new sweep-helper defect found.**

---

## R2. THE COMMUNITY POOL

The invariant `pool_balance ≥ ceil(owed_scaled / ACC_SCALE)` holds through `credit` (rounding leaves dust in the pool), `claim` (reduces both owed and balance by the same `settled`), `join` (sets `debt = weight × acc`), and `retire` (subtracts `pending` from owed, leaves balance unchanged). The counters are consistent: `pending_count ≥ pending_this_epoch` always (verified through request/join/retire/advance_epoch orderings). `JoinWaitingFirst` blocks distributions while eligible-but-unjoined vaults wait.

**No pool accounting defect found.**

---

## R2b. THE $CBOB BOOST

The ring is correct: since `MAX_BOOST_EPOCHS_BOUND = 63 < BOOST_RING = 64`, two boosts that are simultaneously live share a ring slot **only** if they end at the same epoch (verified by modular arithmetic over all `p₁ + n₁ ≡ p₂ + n₂ (mod 64)` cases). `unschedule_boost` correctly branches on due vs. not-due. `carry_scaled` preserves earnings across weight changes. `BoostsExpireFirst` ensures exactly N distributions.

**No boost defect found.**

---

## R3. THE LEVEL DRAW

Entropy is `sha256(hA ‖ hB ‖ hC ‖ asset)` from three slot hashes after the mint. FIFO enforced by `revealed_total`. Reschedule goes to `now + 16` (future slot). Burned vaults at the queue head still draw (L.11). The SlotHashes parse is defensive (key check, count bound, buffer length, all-zero refusal).

**No draw defect found.**

---

## R4. GOVERNANCE

Electorate frozen at creation (`index_snapshot`, `quorum_supply`). Key changes need `⌈50% × snapshot⌉` YES. `KeyChangesBundled` prevents guardian+operator in one proposal. Overtaken actions are logged skips, not reverts. `StopIsNewer` prevents stale restarts.

**No governance defect found.**

---

## R5. THE CHARTER CLAIM

PoB identified by ADDRESS against a Merkle root (domain-separated, sorted pairs). CPI-burn in the same instruction. Window fixed at initialize. `pob_extra` passed through never as signers.

SPEC 46 is complete for what the hot wallet can do. One nuance worth noting:

**LOW — SPEC 46 omits that the hot wallet can add an Oracle plugin that APPROVES burns only during specific time windows, flipping between transactions.** The text mentions "flipping the oracle between transactions" under capture-governance but does not explicitly state the hot wallet could approve ALL claims during the window and then reject any late claim in the final seconds — effectively choosing which charter members get vaults even without owning their PoBs. The existing text ("admit only Proofs of Burn they hold") covers the ownership filter but not a pure time-based filter. *Evidence if true:* a Core Oracle plugin with `lifecycleChecks: { burn: [CheckResult.CAN_REJECT] }` whose account data changes between transactions. *Fix:* one sentence in SPEC 46 and HOLDER-GUIDE noting the hot wallet can approve/reject individual burns at will during the window, regardless of PoB ownership.

---

## R6. ONE-TIME CONFIGURATION

All four `initialize` functions check what they should. The swap operator's worst case is `max_sweep_lamports × ⌈duration / cooldown⌉` until the guardian stops it — bounded and documented. The 10% royalty is `PLUGIN_AUTHORITY_NONE` (Core refuses all changes, measured R.5–R.6c). The redemption cap is a true rolling window over 64 timestamps.

**No configuration defect found.**

---

## R7. CROSS-PROGRAM RAW READS

All offsets recomputed and correct:
- MintConfig v6: `governance[41]`, `minted_total[141]`, `bare_burns_retired[454]`, `charter_closes_at[442]`, `sales_stopped[191]`, `sweep_stopped[192]`, `sales_stopped_at[518]`, `sweep_stopped_at[526]`, `sweep_floor[631]`, `cooldown_ceiling[639]`, `reserve_ceiling[647]`, `max_boost_weight[711]`, `max_boost_epochs[712]` — all match.
- VaultRecord v4: `mint_index[41]`, `asset[9]`, `version[8]` — match.
- BurnConfig v4: `burned_total[42]`, `version[8]` — match.
- SEAL Config v2: `version[8]`, `collection[9]`, `reserves[41]` — match.
- Sweep helper: `mint[0..32]`, `owner[32..64]`, `amount[64..72]`, length 165 — match.
- `MINT_CONFIG_SPACE = 1261`, `VAULT_RECORD_SPACE = 221` — recomputed and match.

**No offset defect found.**

---

## R8. THE SUITE AS EVIDENCE

The `because()` pins are comprehensive. The `ID.1` uniqueness check prevents reused-id false passes. The floors equal the counts. The `attP` variant captures bare `ProgramError` lines.

**INFO — Suite arm `SR.12b` asserts `false` for "duplicate-source refusal reached the second, closed source, not the first source-owner guard."** This is correct (the first source passes the owner check, the second fails at `read_token` because it's closed), but the assertion `want: 'false'` with `got: String(...includes('CBOB_SWEEP refused: source'))` is checking that the error is NOT a source-owner refusal. If the implementation changed so the second source failed at the owner check instead (e.g., if close didn't reassign owner in-transaction), this arm would pass for the wrong reason. *Evidence:* the arm's `want` is `'false'` — it passes when the string is absent, which is also what a completely different failure would produce. *Fix:* assert the error IS `IllegalOwner` (the closed-account refusal) rather than merely NOT a source-owner message.

---

## THE FOUR QUESTIONS ABOUT ACCEPTED LIMITS

### 1. Is any limit WORSE than stated?

**Limit 46 (PoB hot wallet) is slightly worse than stated** — see R5 above. The hot wallet can approve/reject individual charter burns at will during the window, not merely "admit only Proofs of Burn they hold." This is a subset of the stated capture-governance power but the mechanism is broader than the text implies.

**Limit 25 (re-roll) is accurately stated.** The cost ("one re-roll per full window of total silence") is correct.

**Limit 26 (leader grind) is accurately stated**, including the cohort effect and the 96% figure.

**Limit 44 (undeclared holdings) is accurately stated**, including the Token-2022 and nested-Core gaps.

### 2. Is anything listed as a limit not actually a limit?

No. All accepted limits describe real, unrepaired conditions.

### 3. Is any DISCHARGED item not actually discharged?

No. Items 51 and 54 are correctly discharged with their residues disclosed.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

No. Items 22, 38, 50, 52, and 53 are all correctly classified and their obligations are stated as prerequisites.

---

## FINDINGS SUMMARY

| ID | Severity | Location | Description |
|---|---|---|---|
| F1 | LOW | SPEC 46 / HOLDER-GUIDE | The PoB hot wallet's power is described as "admit only Proofs of Burn they hold" but it can approve/reject ANY individual burn at will during the charter window, including time-based filters. One sentence should state this. |
| F2 | INFO | `tests/3prog.test.ts` SR.12b | The duplicate-source arm asserts `want: 'false'` for a substring absence, which passes for any non-source-owner failure. Should assert the specific `IllegalOwner` error. |
| F3 | INFO | `programs/cbob-vault-mint/src/lib.rs` `expire_boosts` | Uses `MintError::BadClaimList` whose message describes `claim`'s account format, not `expire_boosts`'s record-only list. Diagnostic only. |

No CRITICAL, HIGH, or MEDIUM defects found. The program logic, cross-program wiring, pool accounting, boost ring, level draw, governance rules, and sweep helper all hold under the attacks named in the targets.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, WHAT SHOULD THIS PROJECT DO BEFORE LAUNCH THAT AI AUDIT STRUCTURALLY CANNOT?

1. **Run the mainnet dress rehearsal (item 22) with real money at stake, including the forced post-sweep failure and hand recovery.** AI audit can verify the code reads correctly; only a live run against a real cluster with ~2,100 vaults, real RPC rate limits, and a real failed swap can prove the operational runbook works. The revenue cycle has NEVER run end-to-end outside a selftest that reads its own source.

2. **Have a human who was not involved in building this sign the four `initialize` transactions after independently reading `launch/mainnet-init.json` against DESIGN-v6.md.** The checker validates the JSON, not the signed transactions. A human reading the actual Solana transaction bytes against the ruled values is the only check that catches "the builder typed the wrong number into the transaction."

3. **Physically move the $CBOB release wallet key and the swap operator key off this box before the lock.** SPEC 56 says the entire $CBOB supply sits in `bank/keys/cbob-release.json` on the same box as the alarm, the crontab, and the revenue ledger. AI audit cannot move a file to a hardware wallet. This is an operational act that closes accepted limit 56.

4. **Publish the holder guide only after item 50 ships, and have a non-technical person read it aloud and say what they think it promises.** AI can check sentences against code; only a human reader reveals whether the *impression* matches the *mechanism*. The guide currently speaks of unbuilt surfaces in the present tense.

5. **Run the rehearsal tree's full `run-tests.sh` at the release commit (item 53), not at `d57ee3a`.** The proof is stale. AI can verify the script exists; only executing it at the final commit proves the throwaway-ID patch is still exactly six substitutions.

6. **After deploying and before removing the upgrade authority, have someone who is not on this project attempt to redeem a vault using only HOLDER-GUIDE.md and the public website.** If they cannot, the guide is wrong in a way no amount of code audit will find.