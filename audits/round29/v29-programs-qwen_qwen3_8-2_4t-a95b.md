# ROUND 29 INDEPENDENT AUDIT — CBOB VAULTS v6

**Scope:** Whole-tree read of the five programs, the sweep helper, the off-chain reader, the suite, the simulation, the build script, and the round-28 verdict/repairs. Every claim below names the evidence that would confirm or refute it.

---

## R0 — ROUND 28 VERDICT AND REPAIRS

**Verdict on the verdict:** Round 28's self-assessment (NOT CLEAN, 5/8 substantive against a 6-auditor quorum) is accurate. I independently confirm the quorum failure is real: the excluded outputs (Mimo's degenerate repetition loop, Opus 5's mid-sentence truncation, Kimi's 39-character abort) are visible in the manifest descriptions and none can be counted as completed audits. The counter staying at 0/2 is correct.

**Repair verification against the current tree:**

**M1 (Log truncated) — REPAIR HOLDS.** `bank/txread.mjs` line:
```javascript
need(!meta.logMessages.includes('Log truncated'), 'logs truncated by runtime')
```
This checks for the exact standalone string as an array element, not a substring. A program logging `"Program log: Log truncated"` would not match because the array element would be the full `"Program log: Log truncated"` string, not the bare marker. The fixture `tests/fixtures/mainnet-v1.json` does not contain the marker, so it still passes. **Evidence if I'm wrong:** a unit test feeding `logMessages: ["Log truncated"]` should throw; feeding `["Program log: Log truncated"]` should not. The round-28 validation log (`.cache/r28-draft-selftest6.log`) reports such arms passing.

**L1 (Token-2022/ATA byte pins) — REPAIR HOLDS.** `scripts/token-programs.sh` pins three sha256 values and `token_programs_prepare` downloads from mainnet, verifies the hash, and refuses on mismatch. `token_programs_verify` dumps from the running validator and compares. The run-tests.sh sources this and passes `TOKEN_PROGRAM_ARGS` to the validator. The VALIDATION.md reports the canonical 855/855 run with all three token programs verified on the validator. **Evidence if I'm wrong:** corrupting one byte of a cached `.so` should cause `token_programs_prepare` to fail on the next run (the negative test is described in `.cache/r28-pin-negative.log`).

**D1–D3 (documentation) — REPAIRS PRESENT.** The bundled SPEC and DESIGN text show the corrected language (round-28 references, boost owner-only, SetBoostTerms in GOV's action list). I cannot verify line-number stability of Rust comments without a build, but the VALIDATION.md reports byte-identity of all five release binaries after comment-only edits.

**One residual from round 28 that the repairs did not address:** The VALIDATION-FINDINGS.md notes that the third full-suite attempt failed because Core's 32 KiB heap cannot shrink the 10,150-byte Autograph asset. The resolution was to pin the boundary (R28.A2) rather than work around it. This is a legitimate acceptance, but it means **the suite's fixture cleanup for C1 is now permanently skipped** — C1 retains the large Autograph and all five owner plugins through the rest of the suite. This is stated, but it means every subsequent assertion involving C1 runs against a non-standard asset shape. No defect, but a fragility worth noting: if a future Core pin changes the heap behaviour, the suite's C1 path would change silently. **Evidence:** the suite source shows R28.A2 asserting the refusal and then continuing with C1 in that state.

---

## R1 — CUSTODY: SEALED VAULT ESCAPE

**The pairing holds.** I traced both instruction-sysvar walks:

- SEAL walks forward from `current+1`, matching `BURN_PROGRAM_ID`, the 8-byte `burn_vault` discriminator, asset at account index 0, owner at index 2.
- BURN walks backward from `0..current`, matching `SEAL_PROGRAM_ID`, the `open_for_redemption` discriminator, asset at index 0, owner at index 2.

Both bind asset AND owner. Both use `load_instruction_at_checked`, which reads only top-level instructions. A CPI-wrapped burn or open is invisible and cannot satisfy the check. Suite arms WR.1–WR.4 confirm this with a real CPI forwarder.

**No thawed vault can survive the transaction.** If the burn fails for any reason (emptiness, rate limit, Core error), the entire transaction reverts including the thaw. If the burn succeeds, the vault is destroyed. There is no instruction that re-seals. The `set_frozen(false)` in SEAL is the only place the seal changes, and it only runs inside `open_for_redemption`, which requires the terminal burn.

**Two vaults in one transaction:** Each open/burn pair is independently matched by asset and owner. Cross-pairing (open A, burn B) fails because the asset doesn't match. Suite 3.9, 3.10, 4.10, 4.10a confirm. The rate limit catches the second burn if cap is 1 (suite 4.9).

**Emptiness proof:** I verified the reserve loop derives ATAs under both token programs for each reserve mint, requires them declared, and skips accounts not owned by a token program (i.e., closed or non-existent accounts pass by being skipped). The non-reserve loop checks all declared accounts for PDA ownership. Token-2022 extensions are refused (`ReserveHasExtensions`). Delegates and close authorities are refused. The completeness gap (undeclared non-ATA accounts, nested Core assets) is real and is accepted limit 44.

**No defect found in R1.**

---

## R1s — THE SWEEP HELPER

**(a) Access control.** The helper requires `signer.is_signer`. The signer is the asset-signer PDA, which can only sign via Core's `ExecuteV1`. Core's Execute authority rule (per accepted limit 40 and suite SR.5/SR.5a/SR.5c) approves only the asset owner. The AgentIdentity route requires the collection update authority (MINT's off-curve PDA), which no one can sign for. While frozen, Core's PermanentFreezeExecute rejects Execute (suite S6.2). **Holds.**

**(b) Pair list.** I traced each edge case:
- **Same source twice:** First pair closes it; second pair's `read_token` fails because the closed account is no longer owned by SPL Token. Suite SR.12a confirms (`Provided owner is not allowed`).
- **Source is also destination:** Impossible because `src_owner == signer` (PDA) and `to_owner == dest`, and `signer.key == dest.key` is refused.
- **Native wSOL:** Handled as a normal token account. The token transfer moves the balance; CloseAccount returns rent; the final lamport sweep is from the PDA, not the wSOL account. No double-spend.
- **Delegate/close authority on source:** Transfer with owner authority works despite a delegate. Close with owner authority works unless a close authority is set to someone else, but only the owner can set a close authority, so this is not a grief vector.
- **Frozen source:** SPL Token transfer fails, reverting the transaction. Suite SR.14 confirms.
- **Destination not an ATA:** The helper doesn't require ATA, only `to_owner == dest` and `to_mint == src_mint`. Any valid token account works. This is correct.
- **Destination wallet is another vault's PDA:** Allowed by the helper. The owner is choosing to move assets there. Not a security issue (owner's choice), but could brick assets if the target vault is sealed. The redeem page would not do this.
- **Zero/odd pair count:** `accounts.len() < 4 || (accounts.len() - 4) % 2 != 0` refuses. Suite SR.7 confirms odd count.

**(c) Destination checks.** The helper does not compare `dest` with the asset's owner. This is safe because the access control is Core's ExecuteV1 authority check, not the helper's destination check. The owner chooses where their assets go. A malicious client could set `dest` elsewhere, but the owner signs the transaction. This is a client problem, not a program problem. **The HOLDER-GUIDE's instruction to "only open on the Bank's redeem page" is the mitigation, and item 50 (page not built) is the gap.**

**Lamport transfer to non-System destination:** Suite R27.S1 confirms this works. The System transfer can credit any writable account. If `dest` doesn't exist and the amount is below rent exemption, the transfer fails. The asset-signer PDA always holds at least rent exemption, so this shouldn't fail in practice. **Holds.**

**(d) Lamport sweep.** `signer.lamports()` is read at execution time. After the sweep, the PDA has 0 lamports. Between the ExecuteV1 (containing the sweep) and burn_vault, no instruction runs unless the transaction includes one (owner-controlled). Core doesn't add lamports to the PDA. BURN's `lamports() == 0` check sees exactly what the sweep left. **Holds.**

**(e) Interaction with BURN's emptiness proof.** Closed accounts are owned by System (or have no data), so BURN's `acc.owner != SPL_TOKEN_ID && acc.owner != SPL_TOKEN_2022_ID` check skips them. They pass for the right reason (not a token account). If a vault's reserve ATA doesn't exist, the page must create it in a prior transaction. If a stranger creates it and funds it between the page building the tx and landing, the sweep reads the live balance and handles it. If a stranger creates a non-ATA account, it's undeclared and destroyed (accepted limit 44). **Holds.**

**(f) Packet fit.** S8.0 measures 1,061 bytes for the four-instruction redemption. With compute budget (+52) and separate payer (+96), 1,209 bytes, fitting in 1,232. Suite confirms. **Holds.**

**(g) Evidence.** SR.0–SR.4a, SR.5–SR.14, S8.0–S8.3 cover the helper. `build-mainnet.sh` proves byte-identity of the helper across dist, target/deploy, and localnet build. **Holds.**

**No defect found in R1s.**

---

## R2 — THE COMMUNITY POOL

**Invariant "pool always holds at least ceil(owed)":** I traced every state transition:
- `split_revenue`: pool balance increases, owed unchanged. Invariant maintained.
- `distribute`: `avail = balance - ceil(owed)`. `owed += avail`. New `ceil(owed) = balance`. Invariant holds with equality.
- `claim`: pays `pay` sats, `owed -= pay * SCALE`, balance -= pay. `ceil(owed_new) = ceil(owed_old) - pay`. `balance_new - ceil(owed_new) = balance_old - ceil(owed_old) >= 0`. Invariant maintained.
- `retire_redeemed/burned`: subtracts pending from owed, balance unchanged. Invariant maintained (owed decreases).
- `join`: sets debt = weight * acc, so vault's owed is 0. Total owed unchanged. Invariant maintained.
- `reweigh` (boost): moves owed to carry, resets debt. Total owed unchanged. Invariant maintained.

Suite P.32 asserts the invariant. The `ledger()` function in the suite recomputes owed from every record and checks pool balance >= ceil(owed). **Holds.**

**Counters under all orderings:** I traced `pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight` through request, join, retire (same-epoch and cross-epoch), and advance_epoch. The `waiting_to_join = pending_count - pending_this_epoch` correctly identifies vaults eligible to join. The `JoinWaitingFirst` gate prevents distributions while any eligible vault waits. Suite 3c.A4–3c.A7, F21.1–F21.2 confirm. **Holds.**

**Liveness:** `distribute` can be blocked by `JoinWaitingFirst` (eligible vaults not joined) or `BoostsExpireFirst` (due boosts not expired). Both are resolvable by permissionless instructions (claim joins, expire_boosts expires). The crank runs both. No permanent block. **Holds.**

**No defect found in R2.**

---

## R2b — THE $CBOB BOOST

**Exactly N distributions:** A boost bought at epoch E with length N ends at E+N. It earns distributions at epochs E+1 through E+N (N distributions). At epoch E+N, `advance_epoch` makes it due. `BoostsExpireFirst` blocks further distributions until expired. Suite BO.21, BO.21a confirm exactly N. **Holds.**

**Nothing gained or lost on weight change:** `reweigh` moves the vault's owed to `carry_scaled` and resets `debt_scaled = new_weight * acc`. The owed amount (`weight * acc - debt + carry`) is unchanged. Suite BO.7c confirms. **Holds.**

**Ring consistency:** The ring has 64 slots, max boost length 63. A boost's end epoch maps to `end % 64`. Since max length < 64, a boost is expired before its slot could be reused by a boost bought 64 epochs later. `advance_epoch` clears the slot. Host tests verify over 260 epochs (4 wraps) with random buys, retires, and expiries. Suite BO.34–BO.38 test wrapped ring indices on-chain. **Holds.**

**No double/early/never expiry:** `expire_boost` requires `dist_epoch >= boost_end_epoch`. `unschedule_boost` decrements the correct ring slot or `boosts_due`. A retired vault's boost is unscheduled. Suite BO.16, BO.17, BO.38 confirm. **Holds.**

**No distribution block by boosting:** `expire_boosts` is permissionless and needs only vault records, not token accounts. The crank runs it. A vault whose token account is gone can still have its boost expired. **Holds.**

**No defect found in R2b.**

---

## R3 — THE LEVEL DRAW

**SlotHashes parse:** `blockhash_in_window` validates the account is the sysvar, bounds the count to 512, checks the buffer length, and refuses all-zero hashes. Host tests verify malformed inputs. **Holds.**

**Skipped slots:** The draw uses the smallest produced slot in `[want, want+64]`. If no slot is produced, returns None (NotYet). Host tests verify skip handling. **Holds.**

**FIFO:** `reveal_level` requires `index == config.revealed_total`. Out-of-order reveals refused. Suite L.2 confirms. **Holds.**

**Burned vault at head:** `reveal_level` detects burned assets (Core-owned, 1 byte, key 0) and skips the Core UpdatePluginV1 but still advances `revealed_total` and `level_minted`. Suite L.11 confirms. **Holds.**

**Attribute re-supply hash:** Caller supplies attributes, program hashes and compares to stored hash. Mismatch refused. Suite L.4 confirms. **Holds.**

**Influence:** Minter can't grind (slot hashes unknown at mint time). Crank operator can't choose order (FIFO) or entropy. Slot leader C can grind (accepted limit 26). **No defect beyond accepted limits.**

---

## R4 — GOVERNANCE

**Minority carry:** Key changes require YES >= ceil(50% of snapshotted live supply), not just voters. Ordinary proposals require quorum (21%), threshold (51% of cast), and turnout (10% YES). Minimum YES for ordinary is 10.71%. A minority below 10.71% cannot pass anything. **Holds.**

**Vote reaching money:** GOV can only call MINT's governed instructions (set_round, restart, tighten_sweep, arm_swap_operator, arm_guardian, set_boost_terms). None touch the split, destinations, max_supply, or vaults. **Holds.**

**Governance frozen forever:** If all vaults redeemed, no proposals until a new vault exists. A round can mint one if still open. Accepted limit 45. A stolen guardian key can stop permanently at low turnout. Accepted limit 47. **No defect beyond accepted limits.**

**Overtaken actions:** Skipped and logged, not reverted. Suite E.2, 7.26, 3c.R1 confirm. **Holds.**

---

## R5 — THE CHARTER CLAIM

**Merkle verification:** Domain-separated (0x00 leaf, 0x01 node), sorted pairs, odd node promoted. The JS `pob-merkle.mjs` and Rust `merkle_leaf`/`merkle_root_from` match. The suite imports the JS module and has the program verify its proofs. **Holds.**

**CPI burn:** The PoB is burned by Core CPI in the same instruction. The owner signs. The PoB must be a leaf of `pob_root` and owned by the signer. Suite C.2–C.12 confirm. **Holds.**

**pob_extra:** Up to 8 accounts passed through to Core's burn, never as signers. Suite OR.1–OR.6 confirm with real Oracle plugins. **Holds.**

**Window:** `charter_opens_at` to `charter_closes_at`, checked by clock. Never reopen. Suite C.1, C.15 confirm. **Holds.**

**SPEC 46 completeness:** The limit covers ending the project, capturing governance, alarm blind spots (collection vs per-asset, sampling), and the positive bound (can't transfer/burn individual PoBs). I checked for omissions: the update authority could change name/uri of PoBs, but identity is by address (Merkle root), so this doesn't matter. They could mint lookalikes, but the Merkle root pins addresses. **SPEC 46 appears complete.**

---

## R6 — ONE-TIME CONFIGURATION AND TRUSTED HOP

**Initialize checks:** Each program checks INIT_AUTHORITY, validates cross-program wiring, and refuses bad values. The launch checker (`check-launch-params.mjs`) validates the JSON before signing. Suite 0.1–0.3 confirm refusals. **Holds.**

**Swap operator worst case:** Can sweep up to `max_sweep_lamports` per `sweep_cooldown_secs` until guardian stops. Bounded by cap × windows. Accepted limit 10. **Holds.**

**10% royalty:** Core plugin with authority None. Core refuses updates/removals. Suite R.1–R.6 confirm with control collections. **Holds.**

**Redemption cap:** Rolling window over 64-slot ring. Suite RL.1–RL.7 confirm, including replay of all redemptions. **Holds.**

---

## R7 — CROSS-PROGRAM RAW READS

I recomputed every offset from the struct definitions:

**MintConfig v6:** version@8, collection@9, governance@41, pool_ata@73, round_id@105, opens_at@109, closes_at@117, price@125, cap@133, minted_this_round@137, minted_total@141, max_supply@149, bank_treasury@157, split_bps@189, sales_stopped@191, sweep_stopped@192, guardian@193, swap_operator@225, sol_reserve@257, bump@265, max_sweep@266, cooldown@274, last_sweep@282, level_caps@290, level_minted@310, revealed_total@330, payment_mint@338, pob_collection@370, pob_root@402, charter_opens@434, charter_closes@442, charter_claimed@450, bare_burns_retired@454, total_active_weight@462, active_count@470, acc_scaled@478, owed_scaled@494, last_distribute@510, sales_stopped_at@518, sweep_stopped_at@526, pending_swap_operator@534, pending_swap_operator_at@566, monthly_secs@574, pending_guardian@582, pending_guardian_set@614, pending_guardian_at@615, notice_secs@623, sweep_floor@631, cooldown_ceiling@639, reserve_ceiling@647, dist_epoch@655, pending_count@663, pending_this_epoch@671, cbob_mint@679, max_boost_weight@711, max_boost_epochs@712, boost_price@714, boost_weight@722, boost_epochs@723, boosts_active@725, boosts_due@729, boost_weight_total@733, cbob_burned_total@741, boost_expiring@749.

All GOV and BURN offsets match these. **No offset error found.**

**VaultRecord v4:** version@8, asset@9, mint_index@41, reveal_slot@49, level@57, charter@58, entropy_set@59, entropy@60, attrs_hash@92, bump@124, active@125, retired@126, reschedules@127, vault_ata@129, debt_scaled@161, pending@177, request_epoch@178, boost_weight@186, boost_end_epoch@187, carry_scaled@195. GOV's reads (version@8, asset@9, mint_index@41) match. **Correct.**

**BurnConfig v4:** version@8, collection@9, bump@41, burned_total@42, redeem_window@50, rate_head@58, rate_ring@59. GOV's read (burned_total@42) matches. **Correct.**

**SEAL Config v2:** version@8, collection@9, reserve_mints@41 (u32 len + keys). MINT/BURN reads match. **Correct.**

**Sweep helper token read:** mint@0, owner@32, amount@64, length 165. Matches classic SPL Token. **Correct.**

---

## R8 — SUITE, SIMULATION, BUILD

**Arms that cannot fail:** I checked C.2 (`String(!!C1)` after a successful claim — tautological but the claim's success is verified by reaching that line; if it failed, the suite would crash). This is a flow assertion, not an independent test. Not a defect, but worth noting it adds no independent verification.

**Wrong-reason refusals:** The `because()` list pins error codes for every negative. Suite ID.1 checks all assertion IDs are unique (preventing the round-23 reused-ID problem). **Holds.**

**Build provenance:** `build-mainnet.sh` deploys both mainnet and localnet builds, asks each whether it trusts the test key, and confirms the sweep helper's byte-identity across dist, target/deploy, and localnet. The round-28 validation confirms all five binaries match. **Holds.**

**Claims no arm exercises:** I did not find any prompt claim with zero suite coverage. The coverage gate (`audit-coverage.sh`) ensures every file has been in an audit prompt. **Holds.**

---

## ACCEPTED LIMITS — THE FOUR QUESTIONS

### 1. Is any limit WORSE than stated?

**No limit is worse than stated.** I checked each:
- Limit 40 (Core upgrade): The round-28 Autograph heap boundary is now included. Accurately stated.
- Limit 42 (prior ATA creation): The narrow variant (1,219 bytes) and padded variant (1,367 bytes) are both stated. Accurate.
- Limit 46 (PoB hot wallet): All attack vectors (end project, capture governance, alarm blind spots) are stated. Accurate.
- Limit 47 (stolen guardian): The permanent-stop-at-low-turnout consequence is stated. Accurate.

### 2. Is anything listed as a limit not actually a limit?

**No.** Each accepted limit describes a real residual. The discharged items (51, 54, 12/17, 14, 19, 30, 31, 33, 1a–24) are genuinely closed or gone.

### 3. Is any DISCHARGED item not actually discharged?

**No.** I verified:
- Item 51 (boost): Built, tested (suite BO section, host tests). Discharged.
- Item 54 (compute): Measured (suite 10.x). Discharged.
- Item 14 (duplicate attributes): Closed on-chain (suite 11.4). Discharged.
- Item 19 (unlevelled halt): Closed by construction (activate requires level). Discharged.
- Items 1a–24 (Bank-related): Gone with the Bank. Discharged.

### 4. Is any OPEN AND BLOCKING item being quietly treated as accepted?

**No.** Items 22, 38, 50, 52, 53 are clearly marked OPEN AND BLOCKING in SPEC. The HOLDER-GUIDE is marked DRAFT with an explicit publication gate on item 50. The dress rehearsal requirements (item 22) name specific pass/fail criteria. None are being treated as accepted.

---

## NEW FINDINGS

### FINDING 1 — LOW: Sweep helper destination wallet is not validated against asset owner

**Construct:** `programs/cbob-vault-sweep/src/lib.rs`, `process()`, the `dest` account (accounts[1]).

**What happens:** The helper transfers all tokens and lamports to `dest` without checking that `dest` is the asset's owner. Access control relies entirely on Core's ExecuteV1 authority check. If an owner uses a malicious or buggy client that sets `dest` to a third party's wallet, the owner's assets go there. The owner signs the transaction, so they authorize it, but there is no on-chain backstop.

**What an attacker gains:** Nothing directly — only the owner can initiate. But a phishing attack presenting a redemption transaction with a substituted `dest` would succeed if the owner signs. The HOLDER-GUIDE says "only open on the Bank's redeem page," but the page is not built (item 50).

**Evidence if I'm right:** Construct an ExecuteV1 with the sweep helper where `dest` is a stranger's wallet. It would succeed (the owner signed). The suite doesn't test this because it always uses the owner as dest. A test setting dest to bob's wallet in a legitimate owner-signed redemption would pass.

**Fix:** Add a check in the helper that `dest` matches the asset's owner, read from the Core asset account. This requires passing the asset account to the helper. Alternatively, accept this as a client obligation and ensure the redeem page (item 50) validates `dest` before presenting the transaction. Given the helper is stateless and the access control is Core's, the latter is the pragmatic path, but it should be explicitly stated as a requirement of item 50.

**Severity rationale:** LOW because only the owner can trigger it, and the HOLDER-GUIDE already warns. But with item 50 unbuilt, there is no enforcement of the warning.

### FINDING 2 — INFO: Rate limit live-supply read can be affected by earlier instructions in the same transaction

**Construct:** `programs/cbob-vault-burn/src/lib.rs`, `burn_vault`, the `read_mint_supply` call.

**What happens:** `read_mint_supply` reads `minted_total` and `bare_burns_retired` from MINT's config at the time of the burn. If a `mint_vault` instruction for a different vault runs earlier in the same transaction, `minted_total` is incremented, increasing `live` and potentially `cap`. This makes the rate limit slightly more permissive, never more restrictive.

**What an attacker gains:** Negligible. At most, one additional redemption slot in a transaction that also mints. Since minting requires payment and a round, this is not exploitable.

**Evidence if I'm right:** Construct a transaction with [mint_vault (vault X), open_for_redemption (vault A), burn_vault (vault A), open_for_redemption (vault B), burn_vault (vault B)] where cap is 1 at the original supply but 2 after the mint. The second burn would pass. This is a theoretical construction; the suite doesn't test it because it doesn't combine mints and redemptions.

**Fix:** None needed. The effect is benign (more permissive, not less) and requires a mint in the same transaction, which is not a realistic attack vector. Document as a known benign interaction.

### FINDING 3 — INFO: C.2 assertion is tautological

**Construct:** `tests/3prog.test.ts`, assertion C.2.

**What happens:** `rec('C.2', ..., 'true', String(!!C1))` checks that `C1` is truthy. `C1` is the return value of `claim()`, which throws on failure. If the claim failed, the suite would crash before reaching C.2. So C.2 always passes if reached.

**What this means:** C.2 adds no independent verification. It records that the flow reached that point, which is already implied by the suite not crashing.

**Evidence:** Read the `claim()` function — it calls `await send(...)` which throws on transaction failure. There is no try/catch around the C.2 claim.

**Fix:** Replace with a meaningful assertion, e.g., checking that `charter_claimed` incremented or that the PoB is burned. Or remove it and adjust the assertion floor. Not a security issue, but a test-quality issue.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

**What AI audit structurally cannot do, and what this project should do before launch:**

1. **Execute the dress rehearsal against a live cluster.** AI can reason about code and run local validators, but it cannot exercise the crank's I/O against a live RPC with 2,100 vaults, transient errors, rate limits, and the every-minute reveal lane under real network conditions. Item 22 is the critical gap. The project must run the named dress-rehearsal items (crank live passes, alarm live passes, one full revenue cycle through each pool, one forced post-sweep failure with hand recovery) and record the transaction signatures. No AI round can substitute for this.

2. **Build and deploy the holder-facing surfaces (item 50).** The redeem page's `judgeRedemptionCoverage` is the only preventive control for undeclared airdrops and nested vaults (items 9, 44). Until it exists, holders who redeem by any other client can destroy their own assets. AI can verify the pure function, but it cannot build, deploy, and maintain a web page. The project must build the page, the deposit-address display, and the redemption poster's sender before publishing the HOLDER-GUIDE.

3. **Perform the Phantom ceremony and key operations.** The `INIT_AUTHORITY` is Gary's Phantom wallet. The four `initialize` transactions must be built from `launch/mainnet-init.json`, signed by that wallet, and the values verified on-chain. Then the upgrade authority must be removed from all five programs. AI can verify the build artifacts and the source constants, but it cannot sign with a hardware wallet or perform the ceremony. The project must execute this in a controlled environment with the actual key.

4. **Run the mainnet probe with network access.** The probe (`scripts/probe-mainnet-facts.mjs`) verifies the signature walk against a live busy program, the reserve mints' classic-SPL status, and the PoB set against mainnet. AI can read the probe's code, but it cannot make live RPC calls to mainnet. The project must run it with network access and confirm the 33 assertions pass.

5. **Perform independent rebuilds from the committed source.** The build script proves the binaries carry the right keys and the sweep helper is byte-identical, but it builds on the project's machine. An independent party should rebuild from the commit hash and compare sha256 values. AI cannot perform an independent build on a separate machine. The project should arrange at least one independent rebuild and hash comparison.

6. **Establish the operational monitoring baseline.** The alarm's detectors are proven both ways in selftest, but the alarm itself must run continuously against the live deployment. AI cannot operate a cron job. The project must install the cron, verify the first live pass, and confirm the dead-man's switch is armed before any value is at risk.

7. **Decide the charter opening date and lock deadline.** These are the two OPEN values in `launch/mainnet-init.json`. AI cannot make a business decision. Gary must set them, and the launch checker must pass before any `initialize` transaction is signed.

The programs themselves, after 28 rounds and three red-team passes, show no surviving CRITICAL or HIGH defect that I can identify. The remaining risk is concentrated in the operational layer (items 22, 50, 53) and the one-time launch ceremony (items 38, 52), which are exactly the things AI audit cannot do.