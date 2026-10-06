# INDEPENDENT AUDIT — v6 tree at `c5aab17` (round-30 repair code `88acce2` → `425111d`)

**Headline.** After an independent, first-principles recomputation of every cross-program offset, the pool accumulator, the boost ring, the open↔burn pairing, and the emptiness proof, I found **no new CRITICAL, HIGH, or MEDIUM defect in the five programs**. This is a 30-round-audited codebase and the core money invariants hold under my own arithmetic, not just the prior verdicts. I do report a small number of LOW/INFO observations and — more importantly — a **verification boundary**: the off-chain consumers of the round-29/30 reader repairs are not in this bundle, so I could only verify the primitives, not the consumer logic. Details below.

I did **not** re-run the 855-assertion suite or the simulation (no execution environment here). Where I rely on a measured run I cite the recorded log (`.cache/r30-full-pass.log`, `.cache/r30-onchain-855.log`, `.cache/r28-sim.log`) and say so. Everything else is my own read of the source at the frozen HEAD.

---

## R0 — Round 30 verdict and repairs

I treated `audits/round30/VERDICT-programs.md` as evidence to verify, not authority.

**Quorum/counting.** The verdict's self-description is internally consistent: 8 requests, 6 required, 5 counted, Grok excluded as a restatement of the round-29 verdict. Reading the Grok description in the verdict, that exclusion is justified — a report whose heading is "Round 29 verdict: NOT CLEAN" and which re-states round-29 tallies while asserting that already-shipped repairs "must be done" is not a current-tree audit. I agree with the disposition. **Quorum was not met; the counter correctly stays 0/2.**

**Repairs present in this tree — verified where the code is in the bundle:**

| Repair | Present? | My check |
|---|---|---|
| M1 (sigwalk resume) | `bank/sigwalk.mjs` has `startBefore` and pages backward correctly | The resume primitive is correct: `before` advances to the oldest sig of each full page, `before` is exclusive (no duplicates), `batch.length < limit` reliably means "reached `until`/end" for this RPC. **But the consumer (alarm/poster cursor advance + drain proof) is `bank/alarm.mjs` / `bank/redemption-poster.mjs`, which are NOT in this bundle.** See finding F1. |
| L1 (coverage gate content-aware) | `scripts/audit-coverage.sh` now compares git blob ids, not just paths | Present and logically sound (see R8). One fragility noted (F2). |
| txread truncation flag/refuse | `bank/txread.mjs` `validateParsedTransaction(..., {truncatedLogs})` | Present. Default `'refuse'` throws on the exact `'Log truncated'` element; `'flag'` returns `{...tx, logsTruncated:true}`. Exact-element match means a program logging `"Program log: Log truncated"` does **not** false-trigger. Correct. |
| Doc fixes D1/D2/T1 | record rent, drain time, build banner | See F4/F5; two of these still read as described by round 30 (i.e., the corrected values are what I independently computed, confirming the repair direction). |

**Round-29 repairs** (`txread` flag mode, `audit-coverage.sh` `git ls-files` enumeration) are present and consistent with the verdict's description.

I therefore confirm the round-30 verdict's *program-side* conclusions to the extent the code is bundled, and I confirm the counter must remain 0/2.

---

## R1 — Custody / pairing

I attacked the pairing, the emptiness proof, and the "thawed vault leaves the transaction unburned" path.

- **Atomicity is the whole guarantee and it holds.** `open_for_redemption` walks *forward* from `current+1` for a top-level `burn_vault` matching **asset (idx 0) AND owner (idx 2)**; `burn_vault` walks *backward* `0..current` for a top-level `open_for_redemption` matching the same pair. Both bind asset+owner, so neither half can be borrowed from another vault's redemption in the same transaction. Order is enforced in both directions (open-before-burn). A CPI-wrapped open or burn is invisible to `load_instruction_at_checked` (top-level only), which fails closed (`NoTerminalBurn`/`NoPrecedingOpen`); `retire_redeemed` additionally pins stack height to `TRANSACTION_LEVEL_STACK_HEIGHT+1` and re-reads the top-level instruction. This matches suite WR.1–WR.4 and 4.9/4.10/4.10a. I found no bypass.
- **A thawed vault cannot survive the transaction.** Solana transactions are atomic: if `burn_vault` (or any later instruction) fails, the Core plugin state change from the thaw reverts. There is no instruction that empties a vault and leaves it alive. Confirmed.
- **Emptiness proof offsets re-derived.** SPL token account layout: mint 0..32, owner 32..64, amount 64..72, delegate COption tag 72..76, state 108, delegated_amount 121..129, close_authority COption tag 129..133, total 165. BURN's checks (`d[72..76]==0`, `d[121..129]==0`, `d[129..133]==0`, `len==165`, `amount==0`) are correct. The revoke-resets-tag behavior is measured by `probe-round5.test.ts` D2. The second declared-account loop now mirrors the reserve loop's delegate/extension checks (RT3 hardening), removing the asymmetry.
- **Closed-account-passes-for-the-right-reason (R1s(e)).** The sweep always closes each source (the `CloseAccount` is outside the `amount>0` branch), so after a sweep every named reserve ATA is system-owned/0-lamport/empty-data. BURN's reserve loop hits `acc.owner != SPL_TOKEN_ID && != SPL_TOKEN_2022_ID → continue` and skips it — correct, because a closed account holds nothing. Either owner-reset or `len<165` leads to skip; both are safe.
- **Missing-reserve-ATA race (R1s(e)).** If a reserve ATA does not exist when the page builds, SPEC step 1 (create in a prior transaction) is sufficient: once it exists the sweep reads the *live* balance, so a stranger's deposit between the prior tx and the redemption is swept to the owner, not left behind. If the page *fails* to declare a derived reserve ATA, BURN refuses `ReserveNotDeclared` (fails closed, vault stays sealed). A stranger cannot set a delegate/close-authority on a PDA-owned ATA they create (owner signature required, PDA can't sign while sealed), so they cannot block redemption via `ReserveDelegated`; they can only add balance, which the owner receives. No account exists that the sweep can't name *and* BURN won't skip, other than the already-accepted completeness gap (non-ATA classic tokens and nested Core assets — items 9/44; T22-ATA-for-classic-mint is uncreatable per `probe-round5b` F4.2).

**No new finding.** Custody holds.

---

## R1s — Sweep helper

I checked every sub-question (a)–(g):

- **(a) Access control** rests entirely on Core `ExecuteV1` approving only the asset owner on a thawed vault (accepted limit 40 names the Core-upgrade residual). While frozen, Execute is refused by the seal, so the helper is unreachable outside a redemption. Consistent with SR.5/5a/5c and limit 40.
- **(b) Pair list.** Odd count → `NotEnoughAccountKeys`; `signer==dest` → `InvalidArgument`; duplicate source → second `read_token` sees a closed (system-owned) account → `IllegalOwner` (SR.12a); source-also-destination is impossible because `src_owner==signer` and `to_owner==dest` with `signer!=dest`; frozen source → token-program transfer refusal reverts the whole redemption (SR.14); wSOL source handled correctly (round-30 W2 measurement, which I accept — I could not re-run it).
- **(c) Destination not compared to asset owner.** Safe *given (a)*: only the owner can invoke, so choosing an arbitrary `dest` is the owner moving their own value. This is the discharged-limit-5 property. A lamports-only sweep to a nonexistent/below-rent destination fails (client obligation, item 50); crediting a non-system-owned `dest` is fine (R27.S1).
- **(d) Lamport sweep.** Reads `signer.lamports()` after the token closes (which send rent to `dest`, not the PDA), transfers the whole balance. No instruction runs between the Execute and `burn_vault` in the atomic redemption, and Core does not re-credit the PDA, so BURN's `lamports()==0` sees exactly what the sweep left.
- **(f)/(g) Fit & evidence.** S8.0 (1,061 B owner-payer; ~1,209 B with compute-budget pair + separate payer) and S8.1a (168,343 CU) are recorded measurements; `build-mainnet.sh` `cmp`s the helper's mainnet bytes against both the localnet rebuild and `target/deploy` (round-30 A10 confirmed all five equal at the repair commit).

**Finding F3 (INFO)** is the only helper observation worth recording (no writable assertion); see findings.

---

## R2 / R2b — Pool and boost

I re-derived the accumulator conservation law and the boost ring from scratch.

**Pool invariant `balance ≥ ceil(owed_scaled/ACC_SCALE)`:**
- `credit`: `delta = floor(avail·S/w)`, `owed += delta·w ≤ avail·S`, so `ceil(owed_new) ≤ ceil(owed_old)+avail = balance`. Holds.
- `claim`: pays `pay = floor(pending/S)`, sets `carry = pending − pay·S`, `debt = w·acc`; vault owed drops by exactly `pay·S`, `owed_scaled` drops by `pay·S`, balance drops by `pay`. Invariant preserved; sub-sat dust stays owed and covered.
- `reweigh` (boost/expiry): moves the vault's entire owed into `carry`, restarts `debt = new_w·acc`; per-vault owed and therefore global `owed_scaled` are conserved. `retire` subtracts exactly `pending` from `owed_scaled` and removes the weight. I could not construct a path where `owed_scaled` exceeds what the pool holds. This agrees with suite P.32 and the `ledger()`/`books()` recomputation arms, and with RT3's independent offset recompute.
- **Counters** (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`) stay consistent under every request/join/retire ordering I tried: `waiting_to_join = pending_count − pending_this_epoch` never underflows; `advance_epoch` resets `pending_this_epoch`; retiring a this-epoch pending vault decrements both counters (F21.1). No permanent distribution block exists: `JoinWaitingFirst` and `BoostsExpireFirst` are both cleared by permissionless, free actions (join / expire) that the crank performs.

**Boost — "exactly N distributions":** the ring is collision-free because max boost length is `BOOST_RING−1 = 63`, so live end-epochs span at most 63 consecutive values (< 64) and no two share a slot; `advance_epoch` moves only `dist_epoch % 64` into `boosts_due`; `BoostsExpireFirst` blocks any distribution while one is due; `expire_boost` requires `dist_epoch ≥ boost_end_epoch` (no early expiry); expiry/retire both unschedule via the correct due/not-due branch. I traced both in-transaction orders ([boost,distribute] and [distribute,boost]) and they match BO.21/BO.35. Host test N1 (260 epochs, 4 wraps) and BO.34/38 cover the wrap. **No defect found.**

---

## R3 — Level draw

`blockhash_in_window` is defensively parsed (key pinned, count ≤ 512, length checked, all-zero hash refused). `try_capture` picks A then B/C two leader-groups apart; a missed window is rescheduled to a *future* slot, never defaulted; reveal is strictly FIFO; a burned head-of-queue vault still draws (L.11) so the FIFO can't stall. The minter cannot grind (asset is mixed with three future, unknown hashes after payment is irreversible). The residual is exactly accepted limits 25/26; I did not find it worse than stated (cohort-sharing of C is already documented).

---

## R4 — Governance

Key-change threshold is `ceil(50% × quorum_supply)` where `quorum_supply` is live supply **at creation** (round-25 D1 correction is reflected). The guardian/operator bundle is refused (`KeyChangesBundled`), overtaken actions are logged skips, `StopIsNewer` uses strict `<` with the tie going to the stop. I found no minority-carry path beyond Gary's ruled numbers, no money reach beyond the five action kinds (MINT re-checks each), and no governance freeze beyond accepted limits 45/47. The "already-over round still supersedes" behavior (RT3 fix) is intentional and cannot be abused without passing a vote.

---

## R5 — Charter claim

Merkle: domain-separated leaf/node tags, sorted pairing, odd-node promotion; JS↔Rust agreement is enforced by the suite verifying program acceptance of JS-built proofs and by `probe-mainnet-facts` rebuilding the 240-address root. Double-spend prevented by the positive burn tombstone. `pob_extra` pass-through (≤8, never signers) matches OR.* and limit 46. The hot-wallet concentration is a ruling, documented; I found nothing the code does that SPEC 46 omits.

---

## R6 — One-time configuration & trusted hop

`initialize` validation is thorough (bounds, non-default keys, SEAL wiring, payment-mint-is-reserve, clean collection, royalty plugin authority None). The royalty is immutable via Core (`authority None`, suite R.6/R.6a). The redemption cap is a true rolling window over a 64-slot timestamp ring: I verified the "k-th most recent ≥ window old" check enforces ≤ cap per rolling window, and that with max supply 2,100 the cap (≤45) never exceeds the ring (64), so the ring never loosens the limit. The swap operator's worst case is cap×cooldown-window of royalty SOL only, bounded and stoppable — accepted limit 10.

---

## R7 — Cross-program raw reads (independently recomputed)

I recomputed the full MintConfig v6, VaultRecord v4, BurnConfig v4 and SEAL Config v2 layouts byte-by-byte (Borsh, no alignment). **Every pinned offset in GOV, BURN, MINT and the suite matches my computation.** Spot results (account offsets, discriminator +8):

- MintConfig: version 8, collection 9, governance 41, pool_ata 73, round_id 105, price 125, minted_total 141, max_supply 149, split_bps 189, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, revealed_total 330, charter_closes 442, charter_claimed 450, bare_retired 454, total_weight 462, active_count 470, acc 478, owed 494, last_dist 510, sales_stopped_at 518, sweep_stopped_at 526, pending_op 534, monthly 574, pending_guardian 582, pending_guardian_set 614, pending_guardian_at 615, notice 623, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, dist_epoch 655, pending_count 663, pending_this_epoch 671, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712, boost_price 714, boost_weight 722, boost_epochs 723, boosts_active 725, boosts_due 729, boost_weight_total 733, cbob_burned 741, boost_expiring 749. Struct ends at 997; `MINT_CONFIG_SPACE` sums to 1253 (997 + 256 padding). ✓
- VaultRecord: version 8, asset 9, mint_index 41, reveal_slot 49, level 57, charter 58, entropy_set 59, entropy 60, attrs_hash 92, bump 124, active 125, retired 126, reschedules 127, vault_ata 129, debt 161, pending 177, request_epoch 178, boost_weight 186, boost_end 187, carry 195; ends 211, space 221. ✓
- BurnConfig: version 8, collection 9, bump 41, burned_total 42, redeem_window 50, rate_head 58, rate_ring 59. ✓
- SEAL Config: version 8, collection 9, reserve Vec len 41. ✓

All GOV/BURN/suite constants agree. The sweep helper's token read (mint 0, owner 32, amount 64, len 165) matches SPL. **No offset defect.** Discriminators are asserted against their `sha256("global:…")`/`sha256("account:…")` derivations in-suite (3.1a–3.1u, BO.29); I rely on those passing in the recorded run.

---

## R8 — Suite / simulation / build as evidence

- The suite uses `because()` reason-pinning on negatives and unique assertion ids (ID.1), which substantially reduces wrong-reason false passes. The floor-equals-count rule is enforced in `run-tests.sh` for every sub-suite.
- `scripts/audit-coverage.sh` (round-30 L1 repair) is logically sound: a file is covered only if its **current git blob** equals its blob at the frozen HEAD of a completed, quorate round that bundled it. Reverting a file to an already-audited version correctly passes; new content correctly fails. One fragility: see finding F2.
- `tests/expiry-budget.mjs` is correctly scoped (synthetic genesis, 20 due boosts, CU/packet gate; it does not claim full lifecycle). Its arithmetic (`280 − 240 = 40`) is right.
- `build-mainnet.sh` proves mainnet artifacts reject the test key and localnet accept it, and `cmp`s the helper against both rebuild and `target/deploy`. See finding F5 about the banner wording.

---

## FINDINGS

### F1 — INFO (verification boundary, not a code defect)
**Construct:** round-29/30 reader repairs; consumers `bank/alarm.mjs`, `bank/redemption-poster.mjs`, revenue scanner.
**What it means:** The M1 repair's *consumer side* (backlog `{head, before}` persistence, cursor advance only on reaching the old cursor, the "drain proof" and `scan_backlog_unproven` CRITICAL) and the truncation-gap consumer behavior live in files **not present in this bundle**. I verified `bank/sigwalk.mjs` (resume primitive) and `bank/txread.mjs` (flag/refuse) only. I therefore cannot independently confirm that a sustained flood delays rather than permanently skips, or that an unresolvable resume point pages instead of advancing.
**Evidence if I'm right:** the bundle file list omits `bank/alarm.mjs`/`bank/redemption-poster.mjs`; round-30 W4 confirms they are in the *off-chain* TARGETS, not this programs bundle.
**Fix:** none in code; bundle the consumers in the next pass (or defer to the off-chain verdict) before citing M1 as fully discharged. Until then treat M1 as "primitive verified, consumer unverified here."

### F2 — INFO (coverage-gate fragility)
**Construct:** `scripts/audit-coverage.sh`, Python block, `head5 = ''.join(open(vf).readlines()[:5])` + `re.search(r'INCOMPLETE QUORUM|QUORUM NOT MET|QUORUM IS NOT MET', head5)`.
**What it means:** the gate decides a completed round met quorum by trusting `MANIFEST.auditors >= required` **and** regex-matching a quorum-failure phrase in only the first five verdict lines. Round 30 is caught because its title carries "QUORUM NOT MET". A future verdict that states a failed quorum after line 5, combined with a manifest that over-counts, would be treated as covering and could let a stale file pass as audited.
**Evidence if I'm right:** read the cited lines; construct a synthetic verdict whose quorum statement is on line 6 and observe the gate would not skip it.
**Fix:** emit a machine-readable quorum field in the manifest/verdict and check that, or scan the entire verdict for the quorum markers.

### F3 — INFO (sweep helper, not security-relevant)
**Construct:** `programs/cbob-vault-sweep/src/lib.rs` `process()`.
**What it means:** the helper does not assert `dest` or the per-pair `to` accounts are writable. A builder that omits writable marks fails at runtime *inside the atomic redemption* (system/token error), which is safe (all-or-nothing revert) but surfaces as a generic error rather than a named helper refusal.
**Evidence if I'm right:** build a sweep with a non-writable `to`; the transaction reverts in the token/system program, not in the helper.
**Fix (optional):** check `is_writable` and return a distinct `ProgramError`; no on-chain safety change required.

### F4 — INFO (doc, confirms round-30 D1 direction)
**Construct:** SPEC item 49 / line ~672, DESIGN §3 record rent.
**What it means:** I independently note the correct mainnet figure is ~1,772,920 lamports for the 221-byte record (mainnet 0-byte rent 650,240), not the test-validator 2,429,040. This matches round-30 D1's correction; flagging only so the two docs are checked for the corrected number.
**Evidence:** `getMinimumBalanceForRentExemption(221)` on mainnet (round-30 `mainnet-rent.log`); Anchor `init` charges the Rent sysvar figure.

### F5 — INFO (doc/banner wording, confirms round-30 T1)
**Construct:** `scripts/build-mainnet.sh` closing banner.
**What it means:** the "PROVEN" text should attach "reaching a later check" to the **localnet acceptance** clause, not the mainnet rejection (in `tests/initauth.test.ts`, a REJECTS verdict requires `NotTheInitAuthority` for *all four* programs including SEAL; `REACHED_PAST` is evidence of *acceptance*, admissible for the localnet controls of all four). Round-30 T1 already identified this; flagging for the doc fix.
**Evidence:** `tests/initauth.test.ts` verdict logic.

I deliberately did **not** re-file accepted limits (9, 25, 26, 27, 28, 32, 40, 41, 42, 43, 44, 45, 46, 47, 55, 56) or the off-chain items I cannot see (F1). I found no basis to elevate any of them.

---

## The four accepted-limit questions

1. **Any limit worse than stated?** I did not find one. I re-checked the highest-consequence ones (40 Core-upgrade consequences, 26 C-leader grinding, 32 rolling-window cap, 47 guardian-at-low-turnout, and the round-29 orphan-dilution note) and each reads accurately and is bounded as described. The orphan-dilution cost is real and permanent but is now stated in SPEC beside impossibility 3 and items 9/44.
2. **Any listed limit not actually a limit?** No. Limit 44 is correctly *narrower* than "destroyed" for classic tokens (the helper can rescue named non-ATA accounts), and the text already says so (round-25 D7). Nothing listed as open is silently closed.
3. **Any DISCHARGED item not actually discharged?** I checked 12/17, 14, 19, 30, 31, 33, 51, 54 and the Bank-family discharges. Each is either enforced on-chain (I read the enforcing code) or backed by a recorded measurement. None appears falsely discharged.
4. **Any OPEN-AND-BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain explicitly open; `launch/mainnet-init.json` still has `charter_opens_at` and `lock_deadline` as `OPEN`, and VALIDATION confirms the live rehearsal, both-venue revenue cycle, forced-recovery walk and holder surfaces are not done.

---

## GIVEN NO HUMAN FIRM WILL SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — do these before launch (things AI audit structurally cannot do)

1. **Run the mainnet dress rehearsal with real (small) amounts, driven by a human** — item 22, including ONE full live revenue cycle through *both* pools and ONE forced post-sweep failure walked through hand recovery. AI can specify and check these but cannot safely operate a live money cycle or judge an ambiguous open-cycle; a human must be at the terminal and sign off on each named sub-item with its signature.
2. **Ship item 50 (the redeem page with `judgeRedemptionCoverage`) before any redemption is possible.** It is the *only* pre-signature defense against undeclared-asset destruction (items 9/44). Until it exists, those limits have no preventive control. This is a build+UX task AI cannot complete or own.
3. **Do the upgrade-authority-removal ceremony as a deliberate, witnessed human act, after the rehearsal passes.** Irreversibility should be a human decision, not an automated step. Verify all FIVE program hashes (four + helper) against `build-mainnet.sh`'s `SHA256SUMS` on chain immediately before removing authority.
4. **Independently reproduce the build from the committed source on a clean machine** and compare hashes. The build script itself states the bridge is reproducibility ("a third, wrong key would reject the test key identically"). AI cannot guarantee the build environment is uncompromised; a human rebuild from `c5aab17` (or the final release commit) on separate hardware is the only check on the toolchain/box.
5. **Re-run `scripts/rehearsal-tree.sh` proof and `scripts/audit-coverage.sh` (strict) at the final release commit** (item 53's stale-proof requirement). The current rehearsal proof is at `0d13b03`; it must be re-proven at whatever commit actually ships.
6. **Custody decisions only a human can make and enforce:** move/protect the guardian+init-authority key, the swap-operator key, the $CBOB release wallet, and decide the PoB collection authority handling through the charter window (limit 46). These are the trusted hops; no amount of AI auditing secures a hot key on a box. At minimum, ensure the guardian key is backed up and recoverable (losing it removes the brake) and that the release wallet/PoB authority are cold or multisig through the 7-day window if Gary wills it.
7. **Resolve the two `OPEN` launch values** (`charter_opens_at`, `lock_deadline`) and run `scripts/check-launch-params.mjs` to a clean pass before signing the four `initialize` transactions. A wrong immutable value is permanent (item 38).
8. **Accept the residual risk explicitly.** The accepted limits (immutability, Core upgradeability, cbBTC freeze, swap trust, concentration of PoB holders, level-draw grinding) are product/business risks. A human (Gary/Squads) must sign off on them as stated in HOLDER-GUIDE's honest list; AI can enumerate them but cannot bear or decide them.
9. **Ensure genuine model diversity for the two clean rounds.** If both "rosters" are the same underlying models, that is one round run twice. The process must field materially different model families for rounds 31 and 32, and must reject any seat that merely restates a prior verdict (as round 30 correctly did with Grok).

**Net:** programs are in strong shape; no new CRITICAL/HIGH/MEDIUM. Clear the verification boundary (F1), harden the coverage gate's quorum detection (F2), apply the two doc fixes (F4/F5), and complete the human-only launch steps above before removing the upgrade authority.