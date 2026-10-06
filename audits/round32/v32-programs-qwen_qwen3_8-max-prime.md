# ROUND 32 — INDEPENDENT AUDIT OF THE v6 TREE AT `dee953e`

I read the whole tree, recomputed every cross-program offset and account space from the struct definitions, traced the redemption, pool, boost, draw, governance and charter paths instruction-by-instruction, and checked the suite/simulation/build as evidence. My posture was adversarial. What follows is what survived measurement and what did not.

**Headline: I found no new CRITICAL, HIGH, or MEDIUM defect in any of the five programs.** I independently confirmed round 31's repairs hold. I have three LOW/INFO observations, none of which moves value or unseals a vault. I also have two places where an ACCEPTED limit is slightly *under*-stated (not worse in a way that changes the ruling, but the text should be tightened before it is printed on an immutable surface).

---

## R0. ROUND 31'S VERDICT AND REPAIRS

Round 31 (`audits/round31/VERDICT-programs.md`) reported NOT CLEAN, QUORUM MET: one LOW (L1, the coverage gate), two INFO (D1 wrong prior-round label, D2 stale usage line). `VALIDATION.md` records repairs committed at `4ae79d6`. I verified each against the current tree.

**L1 repair — HOLDS.** `scripts/audit-coverage.sh` now uses `first_line_quorate`, an anchored full-match:

```python
return re.fullmatch(rf'# Round {num}, {label} pass: (?:NOT )?CLEAN; QUORUM MET\s*', line) is not None
```

I traced the eight selftest cases. The three that previously over-credited ("QUORUM FAILED", plain prose, marker on line 6) now correctly return `False`, and the two legitimate headlines return `True`. The `combined` branch (a single `VERDICT.md`) accepts either focus label, which matches how a merged verdict is written. The residual round-31 concern — that after a rerun the manifest's `auditors >= required` holds automatically and the verdict text is the only quorum guard — is now answered by making that verdict-text check strict rather than permissive. The gate fails closed on any ambiguity (missing verdict, missing manifest, `required` absent → `1 << 30`).

**What I could not verify by execution, and why it matters:** I cannot run the gate, so I cannot produce the five-variant demo log round 31 produced. The evidence that the repair is real is the code itself plus the eight embedded selftest cases, which `run-tests.sh` runs behind a floor. If this claim is true, `scripts/audit-coverage.sh --selftest` exits 0 and reports `8/8`; a mutation that re-accepts "QUORUM FAILED" must turn that red. That is the checkable prediction.

**One residual, stated plainly (process, not code):** the gate verifies *internal consistency* — that a manifest and a verdict agree a quorum was met. It cannot verify the triage was honest. Both artifacts are written by the same process that is being gated. This is inherent to AI-only certification and cannot be fixed in `audit-coverage.sh`; it belongs in the final section, not as a program finding.

**D1 repair — HOLDS.** This prompt is labelled ROUND 32 and names round 31 as the prior verdict. The stale "ROUND 29 READ THIS TREE" text is gone.

**D2 repair — HOLDS.** `scripts/probe-mainnet-facts.mjs` line 28 now names itself (`node scripts/probe-mainnet-facts.mjs`), not the deleted `probe-signature-paging.mjs`.

**Round-31 W1/W2 refutations — I re-derived them independently and agree.** I could not run the heap or squat measurements, but the reasoning is checkable from constants: the autograph ceiling follows from Core's `MAX_CPI_INSTRUCTION_DATA_LEN` (10,240) minus the Attributes/UpdatePlugin framing, and Anchor 0.31.1's `init` does top-up-then-allocate for a pre-funded PDA. If either is true, the on-chain evidence is exactly what round 31 recorded: a 10,198-byte autograph write succeeds and a 10,199-byte one is refused; a dusted config PDA still initializes. I treat both as correctly refuted, not as articles of faith.

---

## R1. CUSTODY — CAN ANYONE BUT THE OWNER GET VALUE OUT, OR AN EMPTIED VAULT SURVIVE?

I attacked the pairing, the emptiness proof, and the atomicity. **I found no break.**

**The pairing is sound against CPI wrappers, two-vault transactions, and index binding.** Both halves read only top-level instructions via `load_instruction_at_checked`, and both bind asset *and* owner:
- SEAL walks forward from `current+1` requiring `BURN_PROGRAM_ID` + `IX_BURN_VAULT_DISC` + asset at index 0 + owner at index 2.
- BURN walks backward over `0..current` requiring `SEAL_PROGRAM_ID` + `IX_OPEN_FOR_REDEMPTION_DISC` + asset at index 0 + owner at index 2.

A CPI'd instruction is never top-level, so a wrapped burn is invisible to SEAL (refuses `NoTerminalBurn`) and a wrapped open is invisible to BURN (refuses `NoPrecedingOpen`). This is exactly what WR.1–WR.4 measure. Because each half binds asset+owner, you cannot borrow vault A's open for vault B's burn (4.10, 4.10a). The discriminator is derived from the instruction *name*, so a future account reordering in BURN keeps the discriminator but breaks the positional match — and that fails *closed* (thaw refused, vault stays sealed). The coupling direction is correct.

**Atomicity closes "a thawed vault leaves the transaction unburned."** This is not enforced by the programs; it is a Solana runtime property. If `burn_vault` fails for any reason (emptiness proof, rate limit, Core burn), the entire transaction reverts, including SEAL's `set_frozen(false)`. There is no partial application. I checked for any path where the thaw could commit without the burn: there is none, because both are in one transaction and the burn is required to exist before the thaw executes. The only way to thaw is `open_for_redemption`, and it refuses without a matching burn later in the same transaction.

**The emptiness proof is correct for what it claims, and its completeness gap is accurately scoped.** I recomputed every token-account offset used: owner `d[32..64]`, delegate COption tag `d[72..76]`, amount `d[64..72]`, delegated_amount `d[121..129]`, close_authority tag `d[129..133]`, state `d[108]`, length 165. All match the classic SPL layout. The reserve loop requires every reserve mint × {classic, Token-2022} ATA to be declared; a non-token-owned or short account is skipped (correct, it cannot hold tokens); a Token-2022 *extension* account is refused (`ReserveHasExtensions`) because a confidential balance reads zero in the base amount field. The second loop catches declared Core assets (nested vaults) and declared PDA-owned token accounts. The part it *cannot* prove — undeclared non-ATA accounts and undeclared nested assets — is enumerated impossibility 2 and accepted limits 9/44, and the text correctly says the consequence changed from "stranded" to "destroyed" when every redemption became a burn.

**One INFO observation (defense-in-depth, not a vulnerability):** SEAL's `initialize` → `assert_classic_spl` checks each reserve mint's account *owner* but does not reject a **duplicate** in `reserve_mints`, nor verify the account is actually a mint (vs. a token account owned by the Token program). `reserve_mints = [A, A, B]` would pass. This is caught by `scripts/check-launch-params.mjs` (item 38 pins the ruled three distinct mints) and `initialize` runs once by `INIT_AUTHORITY`, so it is a launch-time concern, not a runtime vector. But the program accepting it means the *only* guard against a degenerate reserve list is the off-chain checker. Evidence if this is true: an `initialize` with a duplicated mint succeeds on a test validator; the fix is a two-line distinctness + mint-shape check in `assert_classic_spl`.

---

## R1s. THE SWEEP HELPER

I read `programs/cbob-vault-sweep/src/lib.rs` line by line. **It does what its contract claims.**

**(a) Access control.** The helper requires `signer.is_signer` where `signer` is the asset-signer PDA. Nobody holds that PDA's key; only Core signs for it via `ExecuteV1`, and Core (pinned binary) approves `ExecuteV1` only for `authority == owner`. So the whole gate is Core's owner-only Execute rule on a thawed vault. While the vault is frozen, Core refuses Execute entirely, so the helper is unreachable outside a redemption. I confirmed there is no instruction in any of the four programs that CPIs the helper or calls Execute on a vault except through the owner's own transaction. This rests on Core not being upgraded (accepted limit 40, consequence 3), which is correctly stated.

**(b) Pair list.** I traced each degenerate case:
- *Same source twice:* the first pair closes it (owner → system program), the second `read_token` fails `IllegalOwner`. SR.12a/SR.12b measure this and confirm the refusal is at the *second, closed* source, not the first owner guard.
- *Destination twice:* permitted and harmless (both sources same mint, both credit the same dest account).
- *Source is also a destination:* impossible — source owner must equal `signer`, dest owner must equal `dest`, and `signer != dest` is checked up front.
- *Native wSOL source:* it is a 165-byte classic account, so it is swept like any other token. Fine.
- *Source with a delegate or close authority:* the helper does **not** check delegate/close-authority bytes, and this is *correct* here — the transfer and close are both signed by the owner (the PDA), and closing removes any delegate. BURN's `ReserveDelegated` check is about *leaving* a delegated account open; the sweep closes it. Test 3.3a confirms a delegated-but-closed account passes.
- *Frozen source:* the token program refuses the transfer, reverting the redemption (SR.14). Accepted limit 28/44.
- *Destination not an ATA:* allowed; the helper only requires a classic SPL account owned by `dest` with the matching mint. Fine.
- *Destination wallet is the vault's own PDA:* refused (`signer == dest`).
- *Destination wallet is another vault's PDA:* allowed, but only the owner can trigger it, so it is the owner choosing to move their own funds into another (sealed) vault. Not theft; a self-inflicted brick at worst.
- *Zero or odd pair count:* `accounts.len() < 4 || (len-4) % 2 != 0` refused. Zero pairs is the lamports-only path (SR.13).

**(c) Destination checks.** The helper does not compare `dest` to the asset's owner, and given (a) that is safe: only the owner can invoke it, so the owner chooses `dest`. A lamport transfer to a below-rent-exemption account that does not exist fails in the System program, which would revert the redemption. The canonical destination is the fee-paying owner (exists). This is correctly recorded as a client obligation (SPEC item 50, "a lamports-only sweep needs a destination that exists"). I note R27.S1 shows the helper *can* credit lamports to a non-system-owned destination (System transfer adds lamports to any existing account without touching its data); that is benign.

**(d) Lamport sweep.** It reads `signer.lamports()` at execution and transfers all of it. Within the atomic transaction, nothing can deposit lamports into the PDA between the sweep and the burn except an instruction *in the same transaction*, which the owner builds. Core's Execute does not move lamports. BURN's `lamports() == 0` check runs after the sweep and sees exactly what the sweep left (zero). A griefer cannot inject an external deposit mid-transaction. Correct.

**(e) Interaction with BURN's proof.** After the sweep closes a reserve ATA, the account is system-owned and zero-data, so BURN's reserve loop hits `acc.owner != SPL && acc.owner != SPL2022 → continue` — it passes *because it is no longer a token account*, which is the right reason. On the missing-ATA race: the page must create missing reserve accounts in a prior transaction (SPEC REDEEMING step 1). If it does, the ATA exists when the redemption is built and the sweep can name it. A stranger cannot create a Token-2022 ATA for a classic mint (probe F4.2 refuses `IncorrectProgramId`), can create a non-ATA classic account (which the sweep *can* name, and BURN treats as undeclared/destroyed per limit 44), and can nest a Core asset (which the sweep cannot move). All of this is within the stated limits; I found no account class that is both unnameable by the sweep *and* silently skipped by BURN into survival.

**(f) Does it fit?** S8.0 measures claim + open + helper(3 pairs) + burn at 1,061 bytes, with room for a compute-budget pair (+52) and separate payer (+96) → ~1,209 of 1,232. There is no fourth reserve (MAX_RESERVE_MINTS = 3), and the in-line monthly run is a CPI inside `retire_redeemed` (the pool account is already passed to BURN), so it adds no top-level accounts. The measurement is consistent with the claim.

**(g) Evidence and byte-identity.** SR.0–SR.4a and S8.* exist and are pinned to specific error strings. `build-mainnet.sh` `cmp`s the sweep helper's mainnet bytes against both the localnet build and `target/deploy`, so the shipped helper is byte-identical to the tested one. Confirmed in the script.

---

## R2. THE COMMUNITY POOL

I re-derived the accumulator invariant and every counter transition. **The invariant "pool holds at least ceil(owed)" holds, and the counters conserve.**

- `credit`: `delta = floor(avail·ACC_SCALE / w)`; `owed += delta·w`. Since `delta·w ≤ avail·ACC_SCALE`, the new owed (in sats) rises by at most `avail`, and `avail` was the amount the pool held above the old owed. Invariant maintained.
- `claim`: pays whole sats, reduces `owed_scaled` by `pay·ACC_SCALE`, carries the sub-sat remainder in `carry_scaled`. Invariant maintained; dust stays owed (P.13).
- `join`: sets `debt = w·acc`, `carry = 0`, so `owed_of = 0` at join. A joining vault takes nothing from past distributions. Correct.
- `reweigh` (boost/expiry): moves the current owed into `carry`, resets `debt = after·acc`, adjusts `total_active_weight` by the delta. `owed_of` is unchanged, `owed_scaled` is untouched. Nothing gained or lost. Correct.
- `retire`: subtracts the vault's `pending` from `owed_scaled`, removes its weight, returns the share to the pool. For a redemption (non-forfeit) it requires `pending < ACC_SCALE` (claimed). For a frozen-pool forfeit it allows the pending to be forfeited back. Correct.

**Two-step activation and `JoinWaitingFirst` are consistent.** `pending_this_epoch` is incremented on request, reset to 0 in `advance_epoch`, and decremented in `retire` only when `request_epoch == dist_epoch`. I checked all retire/ordering paths for underflow: a vault requested in epoch E and retired in epoch E decrements both counters; retired after an epoch advance decrements only `pending_count` (because `pending_this_epoch` was already reset and the vault is no longer in it). No underflow. `waiting_to_join = pending_count − pending_this_epoch` correctly counts only vaults eligible (requested in an earlier epoch), and distributions are refused while it is nonzero — but joining is permissionless, so this is a liveness dependency on the crank, not a grief vector.

**Liveness:** no one can permanently block distributions or redemptions. `JoinWaitingFirst` and `BoostsExpireFirst` both gate on states that any caller can clear (join, expire), and the crank does both every pass. A due boost on a vault whose token account is frozen or gone is still expirable via `expire_boosts` (needs only the record, not the token account), so it cannot wedge distributions. I found no DoS.

**Round 24 W11 (the weaker rule about pre-join revenue):** I confirm the code implements the weaker, correct rule — a vault is never credited by a distribution that ran before it joined, but revenue *already in the pool* when it joins is shared at the next distribution by everyone joined then. The unsplit-revenue edge (limit 55) is real and accurately scoped.

---

## R2b. THE $CBOB BOOST

I traced the ring, the carry, and every ordering. **A boost earns exactly N distributions; the ring, `boosts_active`, `boosts_due`, and `boost_weight_total` conserve.**

- A boost bought at epoch E ends at `E + epochs`. Distributions advance the epoch; the boost becomes due when `dist_epoch == end`. `BoostsExpireFirst` blocks the *next* distribution until it is expired, so it earns exactly the distributions that moved the epoch from E to end — N of them, not N+1. BO.21/BO.35 measure both `[boost, distribute]` and `[distribute, boost]` orderings and confirm the off-by-one is correct in each direction.
- The ring has 64 slots; max boost duration is 63 (`MAX_BOOST_EPOCHS_BOUND = BOOST_RING − 1`), so live end-epochs occupy at most 63 consecutive slots and never collide modulo 64. `unschedule_boost` handles the due branch (`boosts_due -= 1`) and the not-yet-due branch (`boost_expiring[slot] -= 1`) correctly. BO.34/BO.38 exercise the wrapped index on-chain.
- A record cannot be expired twice (`boost_weight` is zeroed), early (`dist_epoch >= end` required), or never (the gate forces expiry before the next distribution, and expiry is permissionless).
- `BoostTermsMoved` is one-sided by ruling: refuses price↑/weight↓/epochs↓, allows a move in the buyer's favor. This matches DESIGN and the holder guide.
- I found no way to make distributions impossible by boosting or by a vault whose token account is gone (expiry does not need the token account).

---

## R3. THE LEVEL DRAW

I verified the SlotHashes parse, skipped-slot handling, FIFO, and burned-head case. **No defect; the residual is accurately stated.**

- `blockhash_in_window` pins the sysvar id, bounds the count at 512, validates the buffer length, and refuses an all-zero hash. It selects the smallest produced slot in `[want, want+64]`, which is deterministic once the fork is settled.
- A burned vault at the head of the FIFO still draws (advances `revealed_total` and `level_minted`) but skips the Core write, so the queue never stalls (L.11).
- The attribute re-supply is hash-checked against `attrs_hash`, so the caller cannot alter provenance during reveal.
- **Is it worse than SPEC 26?** No. Only C's leader knows both hA and hB and can grind; A's and B's leaders each lack knowledge of a later hash. The minter can time the mint to place C in a chosen rotation, and can let a draw lapse for a re-roll — both are stated in limits 25/26. The cohort effect (all vaults minted in the same slot share the same three hashes) is stated. I found no additional influence channel. HOLDER-GUIDE's honest-list wording ("the validator producing the last of those blocks can pick among several results… one choice affects every vault created in that moment at once") is true to SPEC 26.

---

## R4. GOVERNANCE

I checked the supermajority, the snapshot, and the skip logic. **No minority carry, no money reach, no new freeze.**

- Key changes require `YES >= ceil(50% × quorum_supply)` where `quorum_supply` is live supply *at creation*. Redemption between creation and execution only lowers live supply, leaving the bar at the larger snapshot — strictly harder. Minting mid-vote adds neither voters nor bar (`VaultTooNew`, snapshot divisor). No minority carries a key change.
- The action set cannot reach the split, destinations, `max_supply`, royalty, or any vault. Verified by the `ProposalAction` enum and by MINT's re-checks.
- The overtaken-action skip is correct: `SetRound` advances `last_round_id` *before* the `closes_at <= now` check (the round-31 RT3 fix), so an already-over newer round still supersedes older ones. The restart skip uses `stopped_at >= created_at`, matching MINT's `StopIsNewer` (`<`) on the tie. Consistent.
- **Is the stolen-guardian stop worse than SPEC 47?** No. The guardian can stop sales/sweep, re-stop after each restart, and cancel any pending operator — all stated in 47. Replacement needs 50% of all live vaults + notice, and at turnout below that the stop is permanent, which 47 states explicitly. I found no escalation beyond the text.

---

## R5. THE CHARTER CLAIM

The Merkle scheme is domain-separated (0x00 leaf / 0x01 node), sorted, and `pob-merkle.mjs` matches the Rust byte-for-byte (the suite proves the program accepts a JS-built proof, which is the one check that fails if they drift). The claim burns the PoB by CPI as owner, in-window only, not gated by the guardian. `pob_extra` accounts are passed to Core's burn with `is_signer = false` forced, so no pass-through account smuggles authority.

**Is SPEC 46 complete?** Substantially yes. The hot Moments update-authority key can end the project (reject all claims) or capture governance (admit only its own PoBs) during the window; both stated. The alarm blind spots (collection-only watch, per-asset hooks, sampling between passes) are stated. Two additions I can identify, both minor:
- A **PoB holder** can add an owner-managed plugin (e.g. a large Autograph) that makes their *own* PoB un-burnable via Core heap exhaustion, bricking their own claim. This is self-harm, not an attack on others, and is not worth adding to 46.
- I found **no third-party** capability beyond what 46 lists: a non-owner cannot modify a PoB, and Core refuses post-creation PermanentBurnDelegate/PermanentTransferDelegate.

I found nothing material that 46 omits.

---

## R6. ONE-TIME CONFIGURATION AND THE TRUSTED HOP

I walked all four `initialize` handlers. The value space is well-guarded: `INIT_AUTHORITY` is checked first in each; the sweep bounds, notice, monthly period, boost ceilings, charter window, level caps, and PoB root all have range checks; the collection must arrive clean/ours/unminted; SEAL/MINT/BURN/GOV cross-check the collection. `check-launch-params.mjs` is strictly stronger than the on-chain checks (which is fine, since it is the pre-signing gate per item 38).

The **swap operator's** worst case is correctly bounded: royalty SOL up to `max_sweep_lamports` per `sweep_cooldown_secs` until the guardian stops it, never the pool, a vault, or sale cbBTC. Stated in limit 10.

The **10% royalty** is installed with `PLUGIN_AUTHORITY_NONE`; Core refuses update/removal for authority-None plugins (R.5/R.6/R.6a measure both directions on a control collection). No instruction in any program touches it. Immutable modulo a Core upgrade (limit 40). Confirmed.

The **redemption cap** is a true rolling window over a 64-slot timestamp ring. I re-derived the indexing: `kth = ring[(head + 64 − k) % 64]` is the k-th most recent; the check `now − kth >= window` is correct; `rate_head` is a u8 in [0,63]. The cap is clamped to the ring size (stricter, never looser, above 3,047 live). RL.7 replays the ring against per-redemption certified caps. Correct.

---

## R7. CROSS-PROGRAM RAW READS

I recomputed every offset from the struct definitions. **All match.** I'll record the load-bearing ones so the next reader can check my arithmetic:

- MintConfig: governance 41, minted_total 141, bare_burns_retired 454, charter_closes_at 442, sol_reserve 257, max_sweep 266, cooldown 274, sales_stopped 191, sweep_stopped 192, sales_stopped_at 518, sweep_stopped_at 526, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712. All GOV/BURN reads land correctly.
- `MINT_CONFIG_SPACE` sums to **1,261** (1,005 bytes of fields+discriminator, +256 padding). The round-31 "1,253" figure (997+256, omitting the discriminator) was wrong; 1,261 is correct.
- VaultRecord: version 8, asset 9, mint_index 41; `VAULT_RECORD_SPACE` = 221. GOV's reads match.
- BurnConfig: burned_total 42; SEAL Config: version 8, collection 9, reserves Vec at 41. All match.
- Sweep helper token reads (mint 0, owner 32, amount 64, len 165) and MINT/BURN mint reads (decimals 44, initialized 45, len 82) match the classic SPL layouts.

No silent misread.

---

## R8. THE SUITE, SIMULATION, AND BUILD AS EVIDENCE

I looked for arms that cannot fail and wrong-reason rejections. The suite's `because()` pins are extensive and the IDs are unique (ID.1 asserts this). A few observations:

- The negative arms are pinned to specific error strings, and the round-25 `attP` addition captures the failing program id, which closes most wrong-reason paths. I did not find an arm whose negative fires for a different reason than named.
- **One structural caveat, stated rather than charged:** the on-chain suite, simulation, and expiry-budget gate all run on a *local validator with cloned mainnet accounts*. The programs' arithmetic is proven there, but item 22 (crank I/O against a live cluster) and the revenue cycle remain unexercised. This is already OPEN AND BLOCKING; I confirm it is genuinely open, not quietly accepted.
- The build proves which key shipped behaviorally (`build-mainnet.sh` deploys both builds and asks each whether it trusts the test key) and proves the sweep helper byte-identical. The one thing it explicitly does *not* prove is that the compiled constant is the Squads/Gary key (a third wrong key would reject the test key identically); the bridge is reproducibility from the pinned commit. This is honestly stated in the script's closing banner.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?** I found none that changes a ruling. Two are slightly *under*-stated and should be tightened before printing on an immutable surface:
- **Limit 45** (all vaults redeemed → governance frozen) should also state that the **pool's undistributed residue is permanently stranded** in the same scenario: with zero active vaults, `monthly_inline` cannot credit and no claim can deliver, so leftover pool sats sit forever. Same root cause as 45, but 45 currently only mentions governance.
- **Limit 47** correctly names the guardian's cancel power, but the reader should understand the stolen guardian can also *indefinitely delay operator replacement* (cancel → re-arm → cancel), not just sales/sweep restarts. It is implied, not explicit.

**2. Is anything listed as a limit not actually a limit?** Limit 35 (10% turnout never binds at ruled numbers) is accurate — min passing YES is 10.71% > 10% — and it is correctly retained as a floor for non-ruled initialize values. I found no limit that is already closed or non-existent.

**3. Is any DISCHARGED item not actually discharged?** I spot-checked 51 (boost), 54/12/17 (compute), 33 (operator notice), 19 (unlevelled halt), 14 (duplicate attributes). Each is genuinely closed by code or measurement. I found no falsely discharged item.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still open and none has been demoted. Item 50 (holder surfaces) is the critical one: until `judgeRedemptionCoverage` runs in a real page, accepted limits 9 and 44 have **no preventive control** — the programs cannot enumerate a PDA's holdings, and v6 deleted the only pre-signature check (the Bank). This is the largest live gap and it is correctly marked blocking.

---

## FINDINGS SUMMARY

| # | Sev | Construct | What it is | Evidence if true | Fix |
|---|---|---|---|---|---|
| 1 | LOW | `programs/cbob-vaults/src/lib.rs::assert_classic_spl` | SEAL `initialize` accepts duplicate reserve mints and does not verify each is a mint (only checks account owner). Degenerate reserve list is caught only by the off-chain checker. | An `initialize` with `[A,A,B]` succeeds on a test validator. | Add distinctness + mint-shape check in `assert_classic_spl`. |
| 2 | INFO | Accepted limit 45 | Does not state that the pool's undistributed residue is also permanently stranded when all vaults are redeemed. | Reading `monthly_inline` with `total_active_weight == 0` shows no credit path. | Add one sentence to limit 45. |
| 3 | INFO | Accepted limit 47 | The stolen guardian's ability to indefinitely delay operator replacement (cancel→re-arm loop) is implied, not explicit. | `cancel_swap_operator` clears a pending operator; nothing rate-limits re-cancel. | Add one clause to limit 47. |

No CRITICAL, HIGH, or MEDIUM. I did not re-file any accepted limit as a new finding.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — WHAT AI AUDIT STRUCTURALLY CANNOT DO

AI rounds can read, recompute, and even run bounded measurements, but they cannot do the following, and each should be done before the upgrade authority is removed:

1. **Be trusted as a quorum.** The gate verifies that a manifest and a verdict *agree*, but both are written by the same process being gated. There is no cryptographic or human attestation that a "clean" round was honestly reached. **Do this:** publish each round's raw model outputs, manifests, and verdicts with content hashes, and have a named human sign the final freeze declaration, accepting personal accountability for the gate. AI provides the evidence; a person must own the decision.

2. **Run the live dress rehearsal.** Items 22/53 require the crank, alarm, and revenue cycle against a live cluster with real RPC behavior, rate limits, and transient errors. No AI round can substitute for a rehearsal that actually moves small real amounts through both pools and recovers a forced post-sweep failure by hand. **Do this before anything mints.**

3. **Hold keys.** The swap operator, the $CBOB release wallet, the guardian, and the PoB/Moments hot key are all custodial facts, not code. AI cannot secure a keyfile, enforce a hardware wallet, or detect a box compromise. **Do this:** move the highest-value hot keys (release wallet, Moments authority through the charter window) to hardware or multisig, and test the guardian-stop and operator-replacement runbooks with the real keys, not test keys.

4. **Build the promised holder surfaces.** Item 50 is the only preventive control for undeclared-aidrop/nested-asset destruction (limits 9/44). Until `judgeRedemptionCoverage` runs in a real redeem page, holders can destroy their own holdings with no warning. AI can verify the function; only shipping the page closes the gap. **Do this and do not publish the holder guide before it ships.**

5. **Verify the launch values out-of-band.** Item 38's checker validates a JSON file, not the signed transaction. Whoever builds the four `initialize` transactions must build them from `launch/mainnet-init.json`, and a second person should independently re-derive the PoB root, the Squads address, and the cbBTC/$CBOB mints from primary sources before signing. AI cannot confirm that the human signing the transaction looked at the right screen.

6. **Decide the charter opening date and lock deadline.** These are still OPEN in `mainnet-init.json`. They are governance/operational decisions only Gary can make, and the lock deadline must precede `charter_opens_at` so nothing ever holds value under an upgradeable program.

The programs are in strong shape; the residual risk is concentrated in the off-chain pipeline, the custodial keys, and the unbuilt holder surfaces — exactly the things an AI audit cannot certify.