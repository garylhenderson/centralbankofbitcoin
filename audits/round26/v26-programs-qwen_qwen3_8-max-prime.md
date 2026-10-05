# Round 26 — Independent Security Audit

**Scope:** All five programs (SEAL, MINT, BURN, GOV, SWEEP), the off-chain pipeline surface described in the prompt, the suite/simulation/build evidence, and the round-25 repairs. Read whole at the bundled tree. I re-derived every cross-program offset, every account-space constant, the rate-limit ring, the boost ring, the pool accumulator, the sweep helper's account checks, and the Core Execute authority dependency from source. I did not run the validator; where I cite a measured run I cite the bundled logs and state what would have to be true of them.

**Posture:** I attempted to break each target. I did not find a confirmed CRITICAL or HIGH. I am not writing "no findings" and moving on: below are the specific things I tried, why each failed to produce a theft or a brick, the residual concerns that remain real but below the bar of a confirmed exploit, and the places where the evidence is thinner than the claim.

---

## R0 — Round 25's repairs

**N1 (host test + on-chain wrapped early retire). Holds.**
`the_boost_schedule_through_the_programs_own_functions_across_four_wraps` (MINT `#[cfg(test)] mod host_tests`) drives 260 epochs through `join`, `reweigh`, `retire` (both `unschedule_boost` branches), `expire_boost`, `credit` and `tick`, and re-checks all 64 ring slots against the records every epoch. One residue remains by construction: the purchase's three scheduling lines are copied from the handler because no free function wraps them. That copy could mask a handler-side scheduling bug that changed in the same way. The on-chain arm BO.38 covers exactly that gap: it buys a wrapped boost through the real handler, bare-burns and retires it before due, and asserts the ring slot fell by one. Between the two, the branch is exercised. Evidence if I were wrong about the copy being benign: a mutation to the handler's `boost_expiring[i] += 1` line that the host test still passes while BO.38 goes red. I could not construct one that passes both.

**N2 (C7/C8/C9 + five ship-gate pins). Holds, with one caveat.**
- RL.7 now stamps live supply per landed redemption (`sendNow`/`STAMPS`) and replays each redemption against its own cap. Correct.
- P.11a's expected string is now fixed to all five levels, so an empty `picks` produces `''` vs the fixed string and fails. Correct.
- SR.4a is now an exact lamport equation, not a floor. Correct.
- The five ship-gate pins (R24.1, R24.1a/1c, R24.2, R24.5, S9b, BO.35/35a, 8.14b, BO.36/37) exist and are pinned to named errors.

Caveat: P.11a's five-level requirement is enforced *implicitly* by the fixed expected string, not by an explicit `picks.length === 5` assert. If a future edit changed the expected string to be built from `picks` again, the vacuous pass would return silently. This is a test-maintenance observation, not a program defect. Evidence: the line at `rec('P.11a', ...)` in `tests/3prog.test.ts`.

**N3 (non-owner Execute on a thawed vault). Holds.**
SR.5 (stranger), SR.5a (owner-added TransferDelegate), SR.5c (collection update authority on a control asset), with SR.5d as the owner control and SR.5e asserting balances/owner/seal preserved after every refusal. Each is pinned to Core `0x1a` (NoApprovals) via `because()`, which is the correct layer: a refusal from SEAL or from our helper would read differently and would not satisfy the pin. SR.5b establishes the CBOB collection authority is MINT's off-curve PDA, so no key exists to sign as it. The AgentIdentity route named in the round-25 verdict cannot be added by any of our Core CPIs (I enumerated them: CreateV2, AddCollectionPluginV1(Royalties), UpdatePluginV1(Attributes), BurnV1, UpdatePluginV1(PermanentFreezeExecute) — none adds an external adapter). Residual: this entire property is Core's rule, not ours, and the pinned Core *source* (`e72d63e`) is still not proven identical to the pinned Core *binary* (`f03e75…`). The binary is what the suite runs; the source is only the explanation. That gap is accepted limit 40 and I am not re-filing it, but it is the single load-bearing trust the sweep helper rests on.

**N4 (helper refusal branches). Holds.**
SR.6–SR.12a and SR.14 each pin the helper's own error or the token program's, and `attP` keeps the "Program <id> failed" line so the refusing program is named. SR.13 proves the zero-pair lamports-only sweep lands. SR.2's title ("a destination account the named destination wallet does NOT own") matches the actual check (`to_owner != dest.key`), which is pair-consistency, not a binding to the asset owner — the round-25 retitle was applied in spirit; the arm tests what it says.

**N5 (packet + compute). Holds.**
S8.0 asserts `B ≤ 1232 − 52 − 96` (measured 1,061), reserving room for both compute-budget instructions and a separate fee payer. S8.1a measures `computeUnitsConsumed` (168,343) against the 4×200,000 default. Both can fail. What S8.0 does *not* cover: a fourth reserve mint (impossible — the list is fixed at 3), a stray-classic-token rescue pair (item 50's obligation, each pair costs bytes), or a crank on the redemption (a redemption carries no crank — correct, BURN has no crank accounts). I verified the 1,061-byte shape includes claim + open + helper(3 pairs) + burn with owner as fee payer.

**N6 (byte identity). Holds.**
`build-mainnet.sh` now `cmp`s `dist/cbob_vault_sweep.so` against both the fresh localnet rebuild and `target/deploy/cbob_vault_sweep.so` (the file the suite deployed), and the runner logs all five deployed hashes. VALIDATION.md records a byte-for-byte comparison of a fresh mainnet build against the certified `dist`. The helper has no `localnet` feature and no key, so tested == shipped is provable by `cmp`, and it was proven.

**D1–D9 (documentation). Holder-facing four are fixed.**
- D1: HOLDER-GUIDE now reads "half of all vaults **that exist when the vote opens**; vaults sold during the vote cannot vote on it" — matches GOV's `quorum_supply` snapshot semantics.
- D2: the first-payout paragraph states nothing can be credited until charter-close + 30 days and the first free crediting payout is a month after that — matches `last_distribute_at = max(now, charter_closes_at)` and the `NoActiveVaults` burn-path refusal.
- D3: "Nobody else can" is gone; the reroll limit is stated — matches limit 25.
- D4: "Everything in it (cbBTC, $GARY, $GIRAFFISH and SOL) comes out" — no longer overclaims for undeclared holdings.
I read each against the code path it describes. I did not line-verify D5–D9's non-holder-facing SPEC edits beyond spot checks (the "five programs" alarm wording, the rehearsal substitution count); those are documentation accuracy, not program behaviour.

**Byte-neutrality of the repair commit.** VALIDATION.md records a fresh mainnet-feature build compared byte-for-byte with the certified `dist/*.so`: all five identical. MINT's addition is `#[cfg(test)]`-only; GOV's is comments. I confirm comments and `cfg(test)` code cannot alter the deployed `.so`. The claim "no deployed program logic changed" is backed by the `cmp`, not assumed.

---

## R1 — Custody: sealed vaults and emptied vaults

I attacked the open↔burn pairing and the emptiness proof.

**Pairing.** Both directions bind asset AND owner, walk only top-level instructions, and fail closed. The CPI-wrapper attacks (WR.1–WR.4) are measured with a real forwarder program: a wrapped `retire_redeemed` refuses `NotFromBurn` (stack height), a wrapped burn refuses `NoTerminalBurn`, a wrapped open refuses `NoPrecedingOpen`. Two vaults in one transaction cannot borrow each other's open/burn because both asset and owner are matched per instruction. The instruction-sysvar parse uses `load_current_index_checked`/`load_instruction_at_checked`, which are the checked forms. I found no shape where a thaw lands without a matching burn later in the same top-level transaction, and the all-or-nothing property means a partial sweep reverts the thaw (3.11).

**Emptiness proof.** I recomputed the token-account field offsets BURN reads (owner 32, delegate tag 72, amount 64, close-authority 129, state 108, len 165) against the SPL layout: all correct. The reserve loop derives both classic and Token-2022 ATAs per reserve mint and requires both declared; a non-token-owned account is skipped; a token-owned account must be PDA-owned, undelegated, extension-free (len == 165), and zero. The second loop applies the same three delegate/close checks to any *declared* non-reserve token account owned by the PDA — the round-25 note that this loop once lacked them is resolved in the bundled source.

**The Token-2022-ATA brick claim (round-25 W1).** I verified the refutation holds: the ATA program derives Token-2022 ATAs but the Token-2022 program's `InitializeAccount` path checks the *mint's* owner is Token-2022, so creating a Token-2022 ATA for a classic mint fails `IncorrectProgramId`. The bundled mainnet probe measures this for all three reserve mints with a classic control. Since no other program can create an account at the ATA PDA, a stranger cannot arm a Token-2022 reserve account. The BURN Token-2022 derivation remains defence-in-depth. Not a finding.

**Thawed vault leaving the transaction unburned.** I could not construct one. The burn is not required to be last, but any post-burn instruction operates on a destroyed asset; any pre-burn instruction that leaves value makes the burn refuse and reverts the thaw. There is no re-seal instruction, so a thawed vault cannot end a transaction alive and thawed.

**Residual (not a defect):** the emptiness proof is completeness-bounded by design — it can only refuse what it is shown. Undeclared non-ATA token accounts and nested Core assets are destroyed, not refused. This is accepted limits 9/44 and item 50's pre-signature check is the only control, and it is not built. I am not re-filing it, but it is the largest real value-destruction surface left, and it is gated only by an unbuilt page.

---

## R1s — The sweep helper

I went through (a)–(g).

**(a) Authority.** Direct calls require `signer.is_signer`; the asset-signer PDA cannot sign outside Core Execute, and a caller substituting their own wallet as `signer` can only sweep accounts they already own (no capability added). Through Core, Execute is owner-only on the pinned binary (SR.5/5a/5c measured). A frozen (sealed) vault refuses Execute at Core before the helper is reached (3.7, S6.2). Sound.

**(b) Pair list.** Duplicate source: first pair closes it, second reads a zeroed owner and refuses `IllegalOwner` (SR.12a, pinned). Duplicate destination: benign (two sources crediting one account). Source-as-destination: impossible (one owner per account; `signer==dest` refused). Odd/zero account counts: odd refused at the length check; zero pairs is the lamports-only sweep and lands (SR.13). Frozen source: the token Transfer fails and reverts the whole redemption (SR.14) — this is the accepted freeze limit, not a helper bug. Delegate/close-authority on a source: the helper transfers and closes as owner regardless; BURN never sees the account (it is closed), and a delegate on a closed account is inert.

**(c) Destination not compared to owner.** Safe given (a): only the owner can trigger the sweep, and the owner is choosing where their own value goes. A hostile page with the owner's Execute signature could already carry plain transfers to any address (round-25 W2); the helper adds no drainer capability. The lamport leg to a below-rent or nonexistent destination can fail, but the canonical destination is the fee-paying owner; the zero-pair destination-exists obligation is documented (D9). Not a program defect.

**(d) Lamport sweep.** `signer.lamports()` is read after the token closes (which pay rent to `dest`, not `signer`), and the System transfer empties the PDA to zero inside the same instruction. Nothing runs between the helper and `burn_vault` except what the page itself placed there; a page depositing into the PDA mid-transaction would only fail its own burn. BURN's `lamports()==0` sees exactly what the sweep left. Sound.

**(e) Interaction with the emptiness proof.** A closed-but-declared reserve ATA still carries its data within the transaction, so BURN reads owner=PDA and amount=0 and passes for the right reason; the suite's successful helper redemptions (SR.4, S8.1) are the measurement that this is true. Missing reserve ATAs must be created in the prior transaction (item 42); a stranger creating a *classic* ATA with dust between build and send is swept live by the helper, so it cannot block. A stranger cannot create a Token-2022 ATA for a classic mint (W1 measurement). A non-ATA token account a stranger creates is neither swept nor checked and is destroyed — accepted limit 44.

**(f) Fit.** Covered under N5.

**(g) Evidence.** SR.0–SR.4a, SR.5–SR.14, S8.* all can fail and are pinned. The helper deployed in the suite is byte-identical to the shipped bytes (N6). I found no arm that cannot fail.

---

## R2 — The community pool

I traced `credit`, `claim`, `join`, `retire`, `reweigh`, `monthly_inline` for the invariant `pool ≥ ceil(owed)`.

- `credit` adds `floor(avail·ACC_SCALE/w)·w` to `owed_scaled`, which is ≤ `avail·ACC_SCALE`, so `ceil(owed)` rises by ≤ `avail` while the balance is unchanged. Invariant preserved.
- `claim` transfers `pay` sats and subtracts `pay·ACC_SCALE` from `owed_scaled`; the sub-sat remainder stays in `carry_scaled`. Balance and owed fall together. Invariant preserved.
- `join` sets `debt = w·acc` at the current accumulator, so a joiner is owed nothing at join. The two-step request/join and `JoinWaitingFirst` prevent the launch first-activator backlog capture. I checked the `pending_count`/`pending_this_epoch` arithmetic under same-epoch and later-epoch retire (F21.1 covers both leaving both counters); I could not produce an underflow because both are decremented only when the corresponding state is present.
- `retire` (redeemed, non-forfeit) requires `pending < ACC_SCALE` (claimed first), so at most a sub-sat is returned. Forfeit (frozen pool) returns the whole pending share to owed-reduction with the balance unchanged — pool ends up holding *more* than owed, which satisfies the invariant.
- `monthly_inline` uses `saturating_sub` for `avail`, never credits from a frozen pool, never credits past due boosts or waiting joins, and never refuses its host except for a wrong pool account.

P.32 asserts the invariant throughout section P; the `ledger()`/`ck()` book-balance checks recompute `owed` as the sum of every live record's `w·acc + carry − debt` after each money operation. I found no ordering of the host instructions that breaks the invariant or permanently blocks distribution: due boosts are cleared by permissionless `expire_boosts`, waiting joins by permissionless `claim`, and the rate window always rolls.

**Liveness.** I could not find a way for one party to make distributions or redemptions impossible for others beyond the accepted limits (frozen pool/account, rate cap, `JoinWaitingFirst` which is itself a fairness gate with a permissionless release).

---

## R2b — The $CBOB boost

- **Exactly N distributions.** A boost bought at epoch `e` ends at `e+N`; it earns the distributions advancing `e→e+1 … e+N−1→e+N`, i.e. N. `BoostsExpireFirst` stops the N+1-th until expiry. BO.21/BO.35 measure both `[boost, distribute]` and `[distribute, boost]` orderings and confirm the end-epoch arithmetic. Correct.
- **No loss/gain on weight change.** `reweigh` moves the entire owed share into `carry_scaled` and resets `debt = w_new·acc`, so `owed_of` is unchanged across the change. Claim normalisation preserves the sub-sat carry. Correct.
- **Counter agreement.** `boosts_active`, `boost_weight_total`, `boosts_due`, and the ring are checked against the records by `books()`/`ledger()` and by the 260-epoch host test. Two live boosts cannot share a ring slot because two concurrently-live end epochs differ by ≤ 62 < 64 (each lasts ≤ 63 and they must overlap). The N=63 bound is enforced at `initialize` (`max_boost_epochs ≤ 63`) and cannot be raised by vote. Correct.
- **No double/early/never expiry.** `expire_boost` requires `boost_weight>0` and `dist_epoch ≥ end`; after `reweigh(…,0)` the weight is 0, so a second expiry fails. Not-due boosts are skipped by `expire_boosts` and refused by `expire_boost`. A due boost cannot be skipped forever because `distribute` and `monthly_inline` both refuse while `boosts_due>0`, forcing someone to expire. Correct.
- **Owner-only, buyer's terms.** `BoostNotTheOwner` reads the live Core owner bytes; `BoostTermsMoved` refuses an adverse move and burns nothing; a favourable move lands at new terms (the ruled one-sided behaviour). BO.33/33a confirm a sold vault boosts only for the new owner.

No defect found.

---

## R3 — The level draw

- `blockhash_in_window` validates the sysvar key, bounds the declared count at 512, checks the buffer length against the count, refuses an all-zero hash, and picks the smallest produced slot in `[want, want+64]`. The host tests cover skips, truncation, over-count, forged key, and zero-hash. Correct.
- `try_capture` builds A, then B and C each two leader-groups later; returns `NotYet` if any is absent, `Expired` past the window. The FIFO (`revealed_total`) is enforced; a burned vault at the head still draws (L.11) so the queue never stops. Attribute re-supply is hash-checked (`AttributesMismatch`).
- The reschedule path moves to a future slot (`now + 16`), logs distinctly, and counts reschedules.

**Is it worse than SPEC 26?** I recomputed the grinding bound. C is the smallest produced slot in a 64-slot window the C-leader controls by skipping within its 4-slot group (best-of-4) plus content variation. SPEC 26's figures (P(V) 5%→18.6% from skipping alone; ~96% with 64 tries) match `1−0.95^4` and `1−0.95^64`. The cohort effect (same-slot mints share hA/hB but mix their own asset address) is stated. I did not find a manipulation beyond what SPEC 26 already concedes. The HOLDER-GUIDE now states the last-validator choice and the reroll truthfully (D3). Not worse than stated.

---

## R4 — Governance

I looked for minority carry, money reach, and permanent freeze.

- **Minority carry.** At the ruled numbers the floor is 10.71% YES (quorum 21% × threshold 51%), above the 10% turnout rule, which therefore never binds at ruled values (limit 35, correct). Key changes need ceil(50% of the snapshotted live supply), not of votes cast. I could not find a path where a minority below these bars carries anything.
- **Money reach.** The reachable MINT actions are `set_round`, `restart`, `arm_guardian`, `tighten_sweep`, `arm_swap_operator`, `set_boost_terms`. None touches `split_bps`, the destinations, `max_supply`, the pool, or a vault. `tighten_sweep` is monotone and bounded by the `initialize` bounds; a loosening is refused at creation and at execution. The deleted `UpdateWiring` shape does not deserialize (W.1 pinned `InstructionDidNotDeserialize`). No money reach.
- **Permanent freeze.** A stolen guardian can re-stop after every restart and cancel operator arms; replacement needs half of all snapshotted live vaults plus a week, so at low turnout the stop is permanent. This is SPEC 47, stated, and I did not find it worse. The guardian cannot cancel its own replacement; `cancel_swap_operator` installs nobody. An overtaken action is a logged skip, not a revert, so a stale action cannot brick its bundle. No new freeze vector found.

---

## R5 — The charter claim

The Merkle scheme is domain-separated (0x00 leaf / 0x01 node), sorted-pair, depth-bounded at 16, and the root is fixed at `initialize`. The PoB is identified by address, ownership-checked against the signer, and CPI-burned in the same instruction. `pob_extra` accounts pass through to Core's burn never as signers. The window is clock-gated and cannot reopen; the guardian's stop does not apply (ruling).

**SPEC 46 completeness.** The hot collection authority can, during the window, add a rejecting oracle (brick all claims → project never starts) or an admitting oracle (capture the electorate). It cannot transfer or burn an individual PoB (Core owner/collection rules; permanent delegates refused post-creation). The alarm watches the collection account but samples state (a hook added and removed between passes is unseen) and does not watch per-asset plugins. All of this is in SPEC 46 as amended. I did not find an additional capability for that wallet, a PoB holder, or a third party that SPEC 46 omits. The residual is accepted by ruling.

---

## R6 — One-time configuration and the trusted hop

I re-derived the `MintConfig`, `VaultRecord`, `BurnConfig`, `GovConfig`, and SEAL `Config` layouts field by field (see R7). The `initialize` refusals (default treasury, non-reserve payment mint, wrong collection, out-of-bounds sweep bounds, bad charter window, zero PoB root, bad boost mint/bounds) are present. A wrong-but-accepted value that locks in forever is the subject of OPEN item 38 and the launch checker; I confirm the programs check *less* than the checker (SEAL reads only mint owners; off-curve keys are accepted), which item 38 already concedes.

**Swap operator worst case.** `sweep_sol_for_swap` is operator-signed, capped per sweep, cooldown-gated, reserve-floored, guardian-stoppable, and destination-pinned to the configured operator. Worst case is cap × cooldown windows of royalty SOL until the guardian stops it — the stated bound. It cannot touch cbBTC, the pool, or a vault.

**Royalty immutability.** Installed with `Some(PluginAuthority::None)`; R.3/R.6/R.6a measure that even the update authority cannot rewrite or remove it on a control collection. No instruction in any of our programs touches it. Confirmed immutable within Core's current rules.

**Redemption cap.** `RATE_RING = 64`, a 64-slot `i64` ring, rolling check that the k-th most recent redemption is a full window old, k = min(max(cap,1),64). With max supply 2,100 the cap is 45 < 64, so the ring always suffices; the "stricter above 3,047" language describes a case the 2,100 supply makes unreachable. Exactly a rolling window. Correct.

---

## R7 — Cross-program raw reads

I recomputed every pinned offset from the struct definitions. All match:

- MINT config: governance 41, collection 9, minted_total 141, bare_burns_retired 454, charter_closes_at 442, sol_reserve 257, max_sweep 266, cooldown 274, sales_stopped 191, sweep_stopped 192, sales_stopped_at 518, sweep_stopped_at 526, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, max_boost_weight 711, max_boost_epochs 712. (GOV and BURN read these.)
- VaultRecord: version 8, asset 9, mint_index 41. (GOV reads these.)
- BurnConfig: version 8, burned_total 42. (GOV reads these.)
- SEAL Config: version 8, collection 9, reserve Vec length 41, elements 45. (MINT and BURN read these.)
- Sweep helper token account: mint 0, owner 32, amount 64, state 108, len 165. Correct against the SPL layout.

All reads are pinned by address, owner, discriminator, and version byte, so a layout move fails loudly. I found no silent-misread offset.

---

## R8 — Suite, simulation, build as evidence

- The 829-assertion floor must EQUAL the count, not merely clear it; the runner enforces equality and the same discipline applies to the detector/allocation/poster/PoB/launch/mainnet floors. This closes the "delete assertions until green" class.
- Negatives are pinned to their refusal reason via `because()`, and the suite asserts every assertion id is unique (ID.1) so a pin cannot read another arm's error. I scanned the `because()` list for arms whose pin could be satisfied by an earlier gate; the round-25 additions (SR.*, R24.*, BO.30–38) are pinned to the specific program and error. I did not find an arm that cannot fail, with the P.11a implicit-five caveat noted under R0.
- The mainnet bytes for the four keyed programs are proven by the behavioural reject/accept test-key gate plus a source check; the helper is proven by byte `cmp`. The one thing not proven on this box is that the compiled mainnet constant equals Gary's key (acceptance requires Gary's private key); the bridge is reproducibility from the recorded commit, and the script says exactly this. Not overstated.
- The Test Vault simulation (71) and swap fork (16) are separate gates; VALIDATION.md records 71/71 and 16/16 with measured byte/CU figures.

**What no arm exercises:** I did not find a prompt claim with zero coverage among the bundled arms, but the mainnet *dress rehearsal* (item 22) and the *rehearsal-tree re-run at the release commit* (item 53) remain unexecuted by definition at this stage — those are process steps, not suite gaps.

---

## The four accepted-limit questions

1. **Any limit WORSE than stated?** I did not find one. I specifically re-checked 26 (grinding math matches), 28 (frozen account blocks the whole redemption but the frozen-*pool* forfeit path holds), 32 (rolling window is genuinely rolling, not a bucket), 40 (the Execute-authority consequence is real and now measured on the binary), 41 (cap bounds redemptions, not transfers — stated), and 47 (permanent stop at low turnout — stated). None is worse than written.

2. **Any listed limit not actually a limit / already closed?** The "ring stricter above 3,047" clause in limit 32 describes a case the 2,100 supply makes unreachable — it is a true statement but not a live limit. I did not find a listed limit that is secretly closed by an unnoticed mechanism.

3. **Any DISCHARGED item not actually discharged?** I re-verified item 51 (boost) end-to-end and it holds; items 12/17, 14, 19, 30, 31, 33, 54 are discharged by measurement or by deletion of the thing they covered. I did not find a discharged item that is still open.

4. **Any OPEN AND BLOCKING item quietly treated as accepted?** Items 22, 38, 50, 52, 53 are all still described as open with named pass/fail criteria, and none has been executed in the bundled evidence. I found no quiet demotion. Item 50 (the redeem page) is the one the holder guide depends on; the guide is marked DRAFT and the rule "do not publish before item 50 ships" is stated. That rule must hold.

---

## Findings

I have no CRITICAL or HIGH. The following are the real residues, ordered.

### MEDIUM

**M-1. The redeem page (item 50) is the only control on the largest value-destruction surface, and it does not exist.**
- Construct: the gap between BURN's completeness-bounded emptiness proof (`programs/cbob-vault-burn/src/lib.rs`, `burn_vault`) and the unbuilt `judgeRedemptionCoverage` page (SPEC control table, item 50).
- What is gained: an owner who redeems by any path other than the intended page destroys undeclared classic tokens, Token-2022 accounts, and nested Core assets with no warning. Nothing on chain refuses it.
- Evidence if I am right: suite arms 9.5/9.9 already demonstrate undeclared holdings burning cleanly; the page is listed as not built in item 50.
- Fix: none available on chain (enumeration is impossible). The only fix is to actually build and ship item 50 before any holder redeems, and to keep the holder guide unpublished until then. This is already OPEN AND BLOCKING; I record it because the program-side surface is permanent and the only mitigation is off-chain and absent.

### LOW

**L-1. The sweep helper's whole access control is one Core rule, and the pinned Core source is not proven to be the pinned Core binary.**
- Construct: `programs/cbob-vault-sweep/src/lib.rs` `process` (no authority check of its own) relying on Core `ExecuteV1` owner-only; Core binary `f03e75…` vs source `e72d63e`.
- What is gained: nothing today (SR.5/5a/5c measure the binary refusing non-owners). But a Core upgrade widening Execute authority would let a non-owner empty a thawed vault, and our immutable programs cannot adapt.
- Evidence if I were right about a problem: a non-owner Execute on a thawed vault landing. The current arms prove the opposite on the pinned binary, so this is a dependency statement, not a live bug.
- Fix: none in our code. Keep the alarm on Core's upgrade authority and hash, and re-pin the binary deliberately if Core changes. Already accepted limit 40; I surface it because the sweep helper makes this dependency load-bearing for custody.

**L-2. P.11a's five-level requirement is enforced only by a fixed expected string, not an explicit count assert.**
- Construct: `tests/3prog.test.ts`, `rec('P.11a', …)`.
- What is gained: nothing now; but a future edit that rebuilds the expected string from `picks` would silently restore the vacuous `''==''` pass the round-25 repair removed.
- Evidence if I am right: the arm has no `picks.length === 5` assert; correctness rides on the literal.
- Fix: add an explicit `picks.length === 5` precondition to the arm. Test-only.

**L-3. The host boost test copies the handler's three inline scheduling lines rather than calling them.**
- Construct: `programs/cbob-vault-mint/src/lib.rs`, host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps`, the copied `boost_expiring[i] += 1` block.
- What is gained: nothing today — the on-chain BO.38 arm exercises the real handler's scheduling at a wrapped index. But the host test alone would not catch a handler-side scheduling change that matched its own copy.
- Evidence if I am right: the three lines in the test are a verbatim copy of `boost_vault`'s scheduling, and no free function wraps them.
- Fix: either extract a `schedule_boost` free function the handler and the test both call, or accept the current split (host test for ring mechanics + BO.38 for the handler). Test-only.

### INFO

**I-1. The helper trusts the transaction builder to set the destination to the owner.** Safe because only the owner can trigger it and the owner signs the builder's transaction, and it adds no capability beyond a plain transfer (round-25 W2). But a compromised or malicious page could set `dest` elsewhere with the owner's signature. This is a phishing surface common to all of Solana, mitigated by "only redeem on the Bank's page" — which again requires item 50 to exist.

**I-2. Limit 32's "stricter above 3,047" clause is unreachable** under the 2,100 `max_supply`. Accurate but describes an impossible case; consider saying so.

**I-3. GOV's stale "six CPIs" comment** (max is five, since a guardian change excludes an operator arm) is a comment-only inaccuracy already flagged in round 25; it does not affect the binary.

---

## Given that no human firm will ever see this and the programs will be immutable, what should this project do before launch that AI audit structurally cannot?

1. **Build and ship item 50 before any redemption is possible, and hold the holder guide at DRAFT until it ships.** The redeem page is the only control on undeclared-holding destruction (M-1) and the only thing that makes the helper's destination trustworthy in practice (I-1). An AI audit can prove the programs do what they say; it cannot build the human-facing surface that decides whether holders do the safe thing. This is the single most important gap.

2. **Run the mainnet dress rehearsal (item 22) end to end, including the full revenue cycle through BOTH pools and the forced post-sweep failure with hand recovery.** Every program-level claim here rests on a local validator with cloned state. The crank, alarm, and revenue cycle have never run against a live cluster with ~2,100 vaults, real RPC behaviour, rate limits, and real slot timing. AI audit cannot substitute for a live rehearsal; the named pass/fail items in item 22 are the right checklist and must be executed with recorded signatures.

3. **Re-run the rehearsal-tree proof at the release commit (item 53).** The bundled proof is at `d57ee3a` and is stale by the project's own statement. The byte-exact reverse-map proof is exactly the kind of thing that must be re-executed at the final commit, not argued.

4. **Execute the four `initialize` calls from `launch/mainnet-init.json` through a path that is itself verified against that file, then verify the deployed bytes against `build-mainnet.sh`'s sha256, then remove all five upgrade authorities.** The checker validates the JSON, not the signed transaction (item 38/A6); a human must ensure the transactions are actually built from the checked file. The programs check less than the checker. This one-time sequence is irreversible and no AI can perform the key-custody judgement it requires.

5. **Decide the two OPEN values — charter opening date and lock deadline — before anything else.** Both are gating and both are owner decisions. The lock deadline must precede `charter_opens_at` so nothing holds value under an upgradeable program.

6. **Establish a concrete Core-upgrade response runbook before launch.** The sweep helper, the seal, every burn, and every level write are Core CPIs. The alarm detects a Core change but cannot prevent one. Someone must own the decision of what a hostile or accidental Core upgrade means for live vaults, and that is an operational judgement, not an audit deliverable.

7. **Fund the revenue address above rent and create the three cbBTC accounts (pool, revenue, Squads) idempotently before the first paid mint or split (item 52).** A first royalty below rent or a missing pool account fails loudly but at the worst possible moment; doing it once, verified, before launch is a human action.

None of these is something another audit round can close. They are build, run, and decide steps, and they are the difference between a correct set of immutable programs and a safe launch.