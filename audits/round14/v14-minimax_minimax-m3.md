# ROUND 14 AUDIT — FINDINGS

I read the diff, the four programs, the off-chain pipeline, the five never-audited files, and the verdict. I measured what I could against the code. I am not confirming the work; I am looking for what survives scrutiny.

---

## R1. `correlateBurns` — the "fails safe" claim is half-true

**MEDIUM — `viaProgram` is not carried forward across passes.**

The author claims: *"If the signature walk has not yet reached the burn transaction that the DAS diff has already noticed, the two do not correlate and the finding stays CRITICAL. … It is also self-correcting: the next pass sees both."*

The second sentence is wrong. The signature walk advances its cursor over every transaction it successfully reads. If a `burn_vault` lands between pass N and pass N+1:

- Pass N+1: signature walk reads the burn transaction, cursor advances past it. `viaProgram` contains the asset. `vault_burned` becomes INFO. Correct.
- Pass N+2: DAS diff still shows the vault as gone (it was already gone). Signature walk cursor is already past the burn transaction. `viaProgram` does NOT contain the asset. `vault_burned` stays CRITICAL. **False positive on a legitimate redemption, permanent.**

The author says this "fails safe" — true in direction (CRITICAL beats INFO) — but it is NOT self-correcting. A legitimate redemption will be reported as CRITICAL on every subsequent pass until the vault is re-minted (which it cannot be — measured, 9.13).

**Evidence if I am right:** Run the suite, do a legitimate redemption, wait two passes, observe `vault_burned` reported as CRITICAL with the "BARE Core BurnV1" detail on the second pass after the burn.

**Fix:** Carry `viaProgram` forward in alarm state (like `seenSplits` and `deferredSweeps`), or delay the DAS diff for one pass after a burn is first observed.

**INFO — the downgrade from HIGH to INFO is correct.**

Under v5, `burn_vault` IS the redemption. Every honest exit runs it. A HIGH here fires on the normal path and carries no information. The real signal is whether `vault_burned` correlates with `burn_via_program`. Keeping it HIGH would bury `vault_left_index` under noise.

**INFO — a bare burn cannot be laundered by a failing `burn_vault`.**

The author asks: *"Can an attacker cause a `burn_via_program` finding for an asset they are bare-burning?"*

To call `burn_vault`, the attacker needs the owner's signature (the program requires it). If the attacker has the owner's signature, they can already call Core's `BurnV1` directly. A failing `burn_vault` costs a transaction fee and proves nothing. The correlation logic does not fail OPEN in any practical scenario.

---

## R2. `MAX_RESERVE_MINTS` lowered 8 → 3 — the harness is right, but CU is unmeasured

**INFO — the harness measures the worst case correctly.**

The harness (test 9.14) builds the real transaction: every reserve present, every one swept AND closed, both ATA derivations declared, the real signer set (2 signers × 64 bytes = 128 bytes, which `requireAllSignatures:false` still includes as zero-filled slots of the same size), and a real blockhash (32 bytes). The measurements (802, 946, 1090, cannot-serialize) are sound.

**MEDIUM — compute units are not measured.**

The author acknowledges this: *"COMPUTE UNITS ARE NOT MEASURED ANYWHERE."* A 3-mint redemption at 1090 bytes fits the packet, but Solana's default compute budget is 200,000 CU. A redemption with 3 reserve mints does:
- 1 `open_for_redemption` (CPI into Core for `UpdatePluginV1`)
- 3 × 2 = 6 inner instructions (transfer + close per mint), wrapped in 1 `ExecuteV1`
- 1 `burn_vault` (loops over 3 mints × 2 token programs = 6 ATA checks, each with multiple `try_borrow_data` calls)

This could easily exceed 200,000 CU. The author says this is "carried" to round 14, but it is a real risk that should be measured before any value is held.

**Evidence if I am right:** Run the suite with `--compute-unit-limit 200000` and observe a 3-mint redemption failing with `ComputeBudgetExceeded`.

**Fix:** Measure CU for N=1,2,3 and assert the cap against the measurement, the same way the byte cap is asserted.

**INFO — the cap of 3 is correct based on the measurement.**

3 mints fit (1090 bytes of 1232), 4 do not. The cap matches the measurement.

---

## R3. `detectNestedVaults` — gap is honest, burnt hosts are correct

**INFO — the foreign Core asset gap is stated honestly.**

The detector sees CBOB vaults only. A foreign Core asset nested in a vault needs a per-vault DAS owner search and is not covered. The code comment states this explicitly.

**INFO — burnt hosts are correctly included.**

A vault nested inside an already-burned vault is the worst case: the PDA can never sign again, so the inner vault is permanently unreachable. Including burnt hosts is correct.

**LOW — DAS lag could cause missed detections.**

If DAS has not indexed a vault yet, it is not in the `vaults` list. A nested vault whose host has not been indexed would be missed. The code comment acknowledges this.

---

## R4. `detectBankIsNotSignable` — admin rejection is correct, off-curve is a proxy

**INFO — the rejection of the admin extension is correct.**

Admin instructions (`update_config`, `set_paused`, `update_wiring`, `cancel_pending`, `apply_pending`) are single top-level calls with no instruction introspection. A Squads vault signs them by CPI perfectly well. Admin as a PDA is the intended production shape (`INIT_AUTHORITY` is the CBOBTC Squads, off-curve). Firing on admin would make the detector cry wolf about the correct configuration.

**MEDIUM — off-curve is a proxy, not a proof.**

An ON-curve key operated through a relayer (smart wallet, multisig wrapper) breaks the pairing identically and looks like an ordinary keypair from here. The code comment acknowledges this. The detector catches the obvious case (Squads vault as Bank) but misses the wrapped case.

**Fix:** Check the transaction's signer set for the Bank instruction, not just the pubkey's curve. This requires looking at the actual transaction, not just the config.

---

## R5. Metaplex Core drift watch — derivation is right, hash slice has a latent bug

**INFO — the ProgramData derivation is correct.**

`[prog.toBuffer()]` under `BPF_LOADER_UPGRADEABLE` is the standard derivation for BPF upgradeable programs. Core is deployed with this loader.

**INFO — the `NO_PROGRAMDATA` sentinel is correct.**

An absent ProgramData account produces `NO_PROGRAMDATA` for Core. This is a fact about OUR read, not about Core. The sentinel ensures the drift watch does not silently do nothing. If the sentinel changes to a real value on a later pass, that is a drift detection — which is the correct behavior.

**LOW — the hash slice is inconsistent when the upgrade authority is absent.**

The code always uses `acc.data.subarray(45)`. When the upgrade authority is present, the ELF starts at offset 45 (after the 4-byte enum, 8-byte slot, 1-byte Option, and 32-byte authority). When the authority is absent, the ELF starts at offset 13 (after the enum, slot, and Option=0). `subarray(45)` would then be 32 bytes into the ELF, producing a different hash than if the authority were present.

For Core specifically, the upgrade authority IS present (Metaplex controls it). So this is fine for Core. But it is a latent bug for the other four programs if any of them ever becomes immutable.

**Fix:** Use `subarray(hasAuth ? 45 : 13)` for the hash slice.

---

## R6. Assertion floors — correct, but defeatable by intent

**INFO — the floor helper is correct.**

```bash
floor(){ # floor <label> <output> <regex> <minimum>
  local n; n=$(grep -oE "$3" <<<"$2" | grep -oE '^[0-9]+' | tail -1)
  [ -n "$n" ] || die "$1: could not read an assertion count out of the output"
  [ "$n" -ge "$4" ] || die "$1: $n assertions, floor is $4 — assertions went missing"
}
```

The regex extracts the assertion count from the test output. The floor prevents accidental deletion of assertions. `set -o pipefail` already makes a crash fail the build; the floor closes the deletion gap.

**INFO — the floor can be defeated by modifying the test to print a fake count.**

But this is not the threat model. The floor is a defense against accidental deletion, not intentional manipulation.

---

## R7. Account sizing — correct

**INFO — the account sizing is correct.**

With `MAX_RESERVE_MINTS = 3`, SEAL's config account has space for 3 reserve mints (96 bytes for the Vec). BURN's config account does not store reserve mints (it reads them from SEAL), so it is unaffected. If `MAX_RESERVE_MINTS` is raised in the future, the account would need to be reallocated — the author acknowledges this.

---

## R8. Comments — redemption corrected, mint still implies a control that does not run

**INFO — the redemption comments are corrected.**

Both SEAL and BURN headers now state: *"NO CO-SIGNING TOOL EXISTS IN THIS REPOSITORY."* The SPEC says the same. This is honest.

**LOW — the MINT program comment still implies the Bank checks.**

In `programs/cbob-vault-mint/src/lib.rs`:
```
/// THE BANK CO-SIGNS EVERY MINT, and rotated on one admin signature with
/// no notice at all — while `governance` and `admin` beside it are both
/// timelocked. The Bank's refusal is what stops a mint that plants a
/// delegate or an undeclared token account, so replacing it quietly is
/// replacing the only party who says no.
```

"The Bank's refusal is what stops a mint that plants a delegate" implies the Bank actually checks. But the Bank is a keypair — it does not check anything automatically. The "refusal" is a human procedure, exactly like redemption. The redemption comments were corrected to say so; the mint comments were not.

**Fix:** Add the same caveat to the mint comment: *"The Bank's refusal is a human procedure, not an on-chain check — no co-signing tool exists in this repository."*

---

## Five never-audited files

### `bank/anchor.mjs` — correct

**INFO.** The pinning logic checks owner, discriminator, and version before any offset read. Absent is the caller's to interpret. Unknown layout version throws rather than misreads. This is the fix for the class of defect it was written to close, and it is correct.

### `scripts/validate-core-gate.sh` — two real issues

**MEDIUM — uses `/tmp` (world-writable).**

```bash
CACHE=/tmp/cbob-vault-test
```

`run-tests.sh` explicitly says: *"NOT /tmp: it is world-writable."* But `validate-core-gate.sh` uses `/tmp`. Any local user can pre-create files at that path, and a tmp cleaner can delete the record of what the gate saw.

**Fix:** Use `/opt/cbob-vaults/.cache` or another non-world-writable path.

**MEDIUM — does not check the Core hash against the pinned mainnet hash.**

`run-tests.sh` checks `CORE_SHA256_EXPECTED` against the cached Core. `validate-core-gate.sh` only checks that the on-chain Core matches the expected file. A mock Core planted at the expected path would pass the gate.

**Fix:** Add the same `CORE_SHA256_EXPECTED` check that `run-tests.sh` has.

### `tests/initauth.test.ts` — correct

**INFO.** The test checks if a build trusts the test key as `INIT_AUTHORITY`. It prints ACCEPTS, REJECTS, or INCONCLUSIVE. INCONCLUSIVE is reported when the rejection is for a reason other than `NotTheInitAuthority` (e.g., `InstructionDidNotDeserialize` from stale arguments). The `REACHED_PAST` map for SEAL is correct — reaching `NoReserveMints` proves the key was accepted.

### `tests/probe-round5.test.ts` — latent issue

**LOW — the D5 mint may not reach the program.**

```javascript
keys:[...,{pubkey:alice.publicKey,isSigner:false,isWritable:false},...]
```

The owner (`alice.publicKey`) is passed with `isSigner:false`. The MINT program requires the owner to sign. The signers are `[bank, asset]`. If the program rejects the mint for a missing signature, the test fails at the mint step, not at the frozen check.

This is a test file, not production code. But it is in the suite that `run-tests.sh` runs.

**Fix:** Add `alice` to the signers array, or change `isSigner` to `true`.

### `tests/probe-round5b.test.ts` — correct

**INFO.** The D4 test (Core BurnV1 does not sweep the PDA) and F4 test (Token-2022 ATA length, T22 ATA for classic mint rejected) are both correct and measured.

---

## Verdict challenges

### REJECTED: "Core's BurnV1 closes the asset account so a burned address is re-mintable"

**INFO — the rejection is correct.**

Measured (9.12/9.13): the account survives, still Core-owned, 2,495,280 lamports, one byte at `Key::Uninitialized`. A re-mint holding the original keypair is refused by the System program with "account already in use". The measurement is sound.

The conclusion generalizes: the account is Core-owned with lamports, which is not reclaimable by the System program. The System program only reclaims accounts that are System-owned with zero lamports.

The author notes this rests on Core behavior we do not control — which is why `prog.core.hash` is now watched.

### REJECTED (partially): "the dead Token-2022 derivation halves redemption capacity"

**INFO — the rejection is correct.**

Measured at ~32 of 144 bytes per mint, about a quarter. The T22 derivation is unreachable for value:
1. The ATA program validates that the mint's owner equals the token program. A T22 ATA for a classic mint is rejected.
2. The T22 ATA address is a PDA (off-curve), so no one can sign for it. But a raw account CAN be created at a PDA address via `SystemProgram.createAccount`. The BURN code handles this by checking `acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID` and continuing if the owner is System.

So the T22 derivation costs 32 bytes per mint in the transaction but cannot hold value. The rejection is correct.

---

## Other issues

### MEDIUM — `correlateBurns` does not carry `viaProgram` forward

As described in R1, `viaProgram` is built fresh each pass from the current findings. If the signature walk advances past a `burn_vault` before the DAS diff catches the burn, the legitimate redemption is permanently reported as CRITICAL.

**Fix:** Carry `viaProgram` forward in alarm state, or delay the DAS diff for one pass.

### LOW — program hash slice is inconsistent when authority is absent

As described in R5, `acc.data.subarray(45)` is correct only when the upgrade authority is present. For Core this is fine; for the other four programs it is a latent bug.

### LOW — mint comment implies a control that does not run

As described in R8, the MINT program comment says "The Bank's refusal is what stops a mint that plants a delegate" without acknowledging that the Bank is a human procedure, not an on-chain check.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS

Thirteen rounds of AI audit have found real defects. The stopping condition (two consecutive rounds with no surviving finding) has never been met. The pattern is clear: repairs are where the next defect lives. This will not change.

What this project should do that AI audit structurally cannot:

1. **Formal verification.** AI audits find bugs; they cannot prove correctness. Tools like Certora, Kani, or Solana's own verifier can prove that the code meets its specification for the properties that matter most (the redemption pairing, the emptiness proof, the 85/15 split). This is the only way to get from "thirteen rounds found something" to "the code is correct."

2. **A bug bounty program.** AI audits are limited by training data and model capabilities. External researchers, incentivized by a bounty, will find different bugs. The bounty should be large enough to be worth the time of a skilled auditor.

3. **Gradual rollout.** Start with a small amount of value (e.g., $10,000 total) and gradually increase over months. Every bug found at $10,000 is a bug that would have been catastrophic at $10,000,000. The alarm pipeline will surface issues that the audit missed.

4. **Continuous monitoring with human review.** The alarm pipeline is the only thing watching what the programs structurally cannot. But it is a script. A human must review its output regularly, especially the new detectors (`detectNestedVaults`, `detectBankIsNotSignable`, `correlateBurns`).

5. **An emergency pause mechanism.** `set_paused` exists for the sale. There is no equivalent for redemptions. If a bug is found in the redemption path, there is no way to halt it without a program upgrade. This should be designed and implemented before mainnet.

6. **Multiple independent AI audits with different prompts.** Even within AI audits, different prompts find different bugs. The round-13 verdict organized by mechanic rather than file found things the file-organized rounds missed. Future rounds should vary the prompt structure further.

7. **Accept that the audit will never converge.** The stopping condition is a fiction. The real question is not "have we found all the bugs?" but "have we found enough bugs that the remaining ones are unlikely to be catastrophic?" Thirteen rounds have found real defects in the repairs of previous rounds. This will continue. The project should budget for ongoing audit, not a one-time certification.

---

## Summary

| Severity | Count | Findings |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 4 | R1 (viaProgram not carried forward), R2 (CU unmeasured), R4 (off-curve is a proxy), validate-core-gate.sh (uses /tmp, no hash check) |
| LOW | 5 | R3 (DAS lag), R5 (hash slice when authority absent), R8 (mint comment), probe-round5.test.ts (owner not signer), program hash slice |
| INFO | 12 | R1 (downgrade correct, no laundering), R2 (harness correct, cap correct), R3 (gap honest, burnt hosts correct), R4 (admin rejection correct), R5 (derivation correct, sentinel correct), R6 (floor correct), R7 (sizing correct), R8 (redemption comments corrected), anchor.mjs, initauth.test.ts, probe-round5b.test.ts, verdict rejections |

The repairs are sound. The correlation logic is correct in direction but not self-correcting. The byte ceiling is measured; the CU ceiling is not. The off-curve proxy catches the obvious case but misses wrapped keys. The five never-audited files are mostly correct, with two real issues in `validate-core-gate.sh`.

Nothing here is a CRITICAL. Nothing here would destroy customer funds today. But the MEDIUMs are the kind of thing that becomes a CRITICAL under load, under attack, or under a Core upgrade.