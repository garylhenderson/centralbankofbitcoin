# Round 26 Audit — Findings

## R0. Round 26 Verdict and Repairs

### C1. RL.7's per-redemption cap can be overstated
**Severity: LOW (evidence)**

**Construct:** `tests/3prog.test.ts:206–214` reads MINT and BURN configs separately, then `RL.7 at 3180–3199` uses the maximum minted and minimum bare-burn count across the before/after interval to compute the redemption's cap.

**What an attacker gains:** Nothing directly — the program's actual rate limit is correct. But the test's evidence for RL.7 can overstate the cap, because the separate account reads can form a torn snapshot. Counterexample: before `(minted=47,burned=0,bare=0)`, redemption at live 47/cap 1, concurrent mint, after `(48,1,0)`: the recorded live 48 gives cap 2, but the redemption actually occurred at live 47/cap 1.

**Evidence if true:** The retained run's 18 redemptions all have cap 1; no actual program violation or false green is alleged. The weakness is in the evidence, not the program.

**Fix:** Use coherent `getMultipleAccountsInfo([MINT_CFG,BURN_CFG])` snapshots. For each burned ordinal `k`, monotonic counters bound live by `a.minted-k-b.bare` and `b.minted-k-a.bare`. Record only when both endpoint caps agree; reject counter regressions, ambiguity and overlapping-stamp disagreement. Pin same-bucket acceptance and both mint/retirement boundary refusals.

---

### C2. P.11a's five-level fixture can fail on a valid random draw
**Severity: LOW (fixture reliability)**

**Construct:** `tests/3prog.test.ts:2290–2304` requires all five levels present in the payout assertion, but local quotas `[26,12,6,4,2]` total 50, and selection requires Alice ownership, a live unactivated/unretired vault, and an empty cbBTC account.

**What an attacker gains:** Nothing — this is a test fixture reliability issue. If the two level-V slots are assigned to C5 (already burned) and C6 (Carol-owned), the census is valid but P.11a correctly goes red for missing V.

**Evidence if true:** An offline quota assignment reproduces this; the real suite did not fail this way. At this stage 20 fixtures can be unavailable: 13 burned (`C5,V,H,RLV[0],RLV[1],P,RD,OUTER,Z,AIR,G,RR,T2`) plus `C1,C4,C6,Q1,N,CEIL,INNER`.

**Fix:** Deterministic local quotas of 21 per level, total 105, with a checked unavailable bound of 20 and minimum quota above it. Keep the fixed five-level assertion and ownership/empty filters.

---

### C3. SR.12a's duplicate-source refusal could pass for the first pair's wrong-owner failure
**Severity: INFO (pin specificity)**

**Construct:** `tests/3prog.test.ts:2689` and final pin at 3377 accept the helper's `Provided owner is not allowed`. That text can come from the intended second read of the now-closed account, or from the first pair's foreign-owner guard (`sweep:57`).

**What an attacker gains:** Nothing — the current setup and observed execution are correct.

**Evidence if true:** The assertion does not distinguish the two refusal paths.

**Fix:** Add absence of `CBOB_SWEEP refused: source`, or a positive first-close witness.

---

### D1. Guide says vaults "sold during the vote cannot vote on it"
**Severity: LOW (holder-facing wording)**

**Construct:** `HOLDER-GUIDE.md:138` naturally includes secondary sales. GOV `cast_vote` at 416–429 checks the current owner and whether the asset's mint index predates `index_snapshot`; its vote PDA is asset-scoped.

**What an attacker gains:** Nothing — the code is correct. An eligible, previously unvoted vault can be resold during a vote and its new owner can vote. Only newly minted vaults are excluded; a previously voted vault cannot vote twice.

**Evidence if true:** The wording is misleading.

**Fix:** Say **minted/created after the vote opens**. Add an unvoted resale positive control to pin this.

---

### D2. Frozen-script comments state obsolete program/substitution counts
**Severity: INFO (comments only)**

**Construct:** `scripts/rehearsal-tree.sh` describes four program IDs/keypairs and five substitutions, while its mapping is five IDs plus root = six substitutions. `scripts/run-tests.sh:2` says three programs, while five deploy.

**What an attacker gains:** Nothing — the actual mapping and 48-file reverse proof are sound.

**Evidence if true:** The comments are wrong.

**Fix:** Correct those counts.

---

### D3. Pending guardian/operator application has no expiration after notice
**Severity: INFO (documentation precision)**

**Construct:** MINT `apply_swap_operator:830` and `apply_guardian:937` require the notice to have elapsed but set no latest application time. This differs from the seven-day proposal-execution window.

**What an attacker gains:** Nothing new — only the latest pending arm can apply; another approved arm supersedes it; the current guardian can cancel a pending operator but not a guardian replacement.

**Evidence if true:** SPEC says "after notice" but limits 34/47 do not make the unbounded pending period explicit.

**Fix:** State this distinction and cancellation/supersession rules. No program change required.

---

### D4. Limit 42's categorical "only two destination ATA creates fit" is stale
**Severity: INFO (documentation/evidence)**

**Construct:** SPEC 934–940 and 1423–1427 assert three creates cannot fit and any client folding them in fails, citing the old explicit-transfer 9.14 shape.

**What an attacker gains:** Nothing — offline reconstruction of the actual current S8 helper shape measures **1,219 bytes with all three idempotent destination creates**, owner as fee payer and no compute-budget additions; baseline matches 1,061.

**Evidence if true:** The narrow shape has not been landed as a separate test.

**Fix:** Qualify the byte assertion and retain the chosen page preparation requirement. v0/LUT is demonstrated by S9b, but a production client using it remains item 50.

---

## R1. Custody

### W1. An owner can add plugins that make the Attributes update fail, permanently halting the reveal FIFO
**Severity: CRITICAL if true — REFUTED**

**Construct:** The claim is that an owner can add owner-managed plugins (FreezeDelegate, BurnDelegate, TransferDelegate, Autograph, FreezeExecute) that cause Core's `UpdatePluginV1` for the Attributes plugin to fail, permanently halting the reveal FIFO.

**What an attacker gains:** If true, permanent halt of the level draw for any vault whose owner adds such plugins.

**Evidence if true:** On the pinned Core binary, a separate owner added all five owner-managed plugins. Both owner freeze plugins were frozen; the control asset also retained its frozen PermanentFreezeExecute with separate update authority. That authority successfully changed Attributes from sealed to level V while all five remained. Cleanup unfreezes/removes the five and preserves the permanent seal/attributes.

**Independent refutation:** Source matches: `processor/update_plugin.rs:58–78` runs the update-plugin lifecycle; four plugins inherit abstention (`plugins/lifecycle.rs:614`), and Autograph's override at `internal/owner_managed/autograph.rs:122–140` abstains for Attributes. **Bound:** this is the exact Core interaction on a control asset, not a CBOB `reveal_level` transaction.

**Fix:** Add a C1 real-reveal regression arm with all five plugins attached before section L; C1's first successful reveal is **L.5 at 924–925**, not L.4 (the deliberate tampered-attributes rejection). Read the result after L.6–L.8, assert the drawn level and all frozen plugins survived, then unfreeze and remove the five owner plugins before C1's later lifecycle.

---

## R1s. The Sweep Helper

### W6. Unbound helper destination is a new drain capability
**Severity: CRITICAL if true — REFUTED**

**Construct:** The claim is that the sweep helper's destination being caller-chosen introduces a new capability to drain value.

**What an attacker gains:** If true, arbitrary draining of vault contents.

**Independent refutation:** Owner-authorized Core Execute could already issue ordinary SPL and System transfers to arbitrary destinations. The helper does not supply the owner's signature. Redirecting a transaction the owner signs is the existing malicious-builder problem, not an authorization bypass introduced by this helper.

**Fix:** None needed — this is not a new capability.

---

## R2. The Community Pool

No new confirmed findings. The pool's accumulator, two-step activation, join gate, in-line monthly run, and rolling redemption window are all verified by the suite and host tests.

---

## R2b. The $CBOB Boost

No new confirmed findings. The boost schedule through the program's own functions across four wraps (BO.38) and the ring wrap (BO.34) are verified.

---

## R3. The Level Draw

No new confirmed findings. The three-slot-hash entropy, FIFO ordering, reschedule logic, and independent re-derivation (L.3c) are all verified.

---

## R4. Governance

No new confirmed findings. The one-vault-one-vote binding, snapshot electorate, supermajority for key changes, and logged skips are all verified.

---

## R5. The Charter Claim

No new confirmed findings. The Merkle proof verification, CPI burn, and Oracle pass-through (OR.*) are all verified.

---

## R6. The One-Time Configuration and the Trusted Hop

### L2. Initialize permits wrong launch values
**Severity: ACCEPTED LIMITATION (item 38, OPEN)**

**Construct:** SEAL checks only each account's OWNER, not distinctness or mint layout. The launch checker pins the ruled distinct reserves and exact CBOB mint.

**What an attacker gains:** If `initialize` is called with wrong values, they are permanent.

**Evidence if true:** This is the existing trusted initialization hop, not evidence that a checked ruled launch permits them.

**Fix:** The launch checker (`scripts/check-launch-params.mjs`) refuses wrong values before signing. This remains OPEN AND BLOCKING.

---

## R7. Cross-Program Raw Reads

No new confirmed findings. All cross-program offsets and discriminators are verified correct by RT3 and the suite.

---

## R8. The Suite, Simulation and Build as Evidence

### W12. Round-25 N1–N6 and D repairs are all still absent
**Severity: STALE REPORT — REFUTED**

**Construct:** The claim is that round-25 findings N1–N6 and D repairs are absent from the current tree.

**What an attacker gains:** Nothing — this is stale output.

**Independent refutation:**
- N1: host production-function ring tests and BO.38
- N2: RL stamps (remaining weakness C1), fixed P literal (remaining fixture C2), tightened error/math arms, K.7/BO.36/BO.37/S9b/8.14b/BK and the five R24 pins
- N3: SR.5/5a/5c/5d/5e
- N4: SR.6–14 with exact helper errors and exact lamports (specific residue C3)
- N5: S8.0 byte margin and S8.1a CU
- N6: helper comparison to suite deployment
- D1–D9 have their current holder/spec repairs; the actual residuals are D1–D4 above.

**Fix:** None — the repairs are present and verified.

---

## Accepted Limits — Four Questions

1. **Is any limit WORSE than stated?** No new confirmed cases. The existing limits (25, 26, 28, 40, 41, 44, 46, 47) are accurately stated.

2. **Is anything listed as a limit not actually a limit?** No. All listed limits remain real.

3. **Is any DISCHARGED item not actually discharged?** No. All discharged items (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24, 30, 31, 33, 51, 54, 12/17, 14, 19) are measured closed or removed with the thing they were about.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain OPEN AND BLOCKING as stated.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the full mainnet dress rehearsal (road step 8) at the release commit.** This is the only way to exercise the crank and revenue cycle against a live cluster with ~2,100 vaults, including one full live revenue cycle through both pools (Orca forced to refuse once, so Meteora runs) and one forced post-sweep failure walked through the hand recovery. The suite and simulation run on a local validator and cannot show this.

2. **Build and deploy the holder-facing redeem page (item 50).** The sweep helper is built and byte-identical, but nothing calls it yet. The redeem page must: create destination ATAs in a prior transaction, run `judgeRedemptionCoverage` before the holder signs, sweep through the helper via Core ExecuteV1, and handle the frozen-pool case (no claim, forfeit undelivered share). Without this page, items 9 and 44 have no preventive control.

3. **Execute the key ceremony and remove all upgrade authorities.** Deploy all five programs, verify the deployed bytes against `scripts/build-mainnet.sh`'s sha256, and then remove the upgrade authority from all five. This is the point of no return — after this, no bug can be fixed. The ceremony must be witnessed and recorded.

4. **Run the alarm live in rehearsal mode against the dress rehearsal deployment.** The alarm's production-value checks must be disabled (`CBOB_ALARM_REHEARSAL=1`), but every other detector must run unchanged. This proves the alarm works against real state, not just synthetic fixtures.

5. **Conduct an independent multi-model audit round.** Round 26 had only 5/8 quorum (6 required). A clean round needs 6 independent auditors with different model rosters. This is the only way to achieve the two consecutive clean rounds required by the FREEZE gate.

6. **Verify the $CBOB release wallet custody.** The entire 2,100,000,000 $CBOB supply sits in one hot wallet on this box. Before launch, either move it to Gary's own wallet or a Squads, and delete the box key, as Gary's ruling permits. This closes accepted limit 56.

7. **Set the charter opening date and lock deadline.** These are the only two OPEN values in `launch/mainnet-init.json`. The charter opening date must be set by Gary, and the lock deadline must be set before `charter_opens_at` so nothing holds value under an upgradeable program.