# Round 40 — independent audit of the v6 tree at `21f36e1`

**Scope and method.** I read all five programs, the sweep helper, `web/src`, `web/meta`, `web/deploy`, the tests, the scripts, SPEC, DESIGN and the holder guide as bundled. I did **not** run a validator, the 895-assertion suite, the Test Vault simulation, or the page e2e; those rest on the recorded runs (`run-tests.sh` floors, `sim/run-sim.sh`, `.cache/r39-web-e2e.log`). My contribution below is code-level re-derivation: I recomputed the cross-program byte offsets, re-proved the pool invariant and the boost-ring argument, re-walked the open/burn pairing and the sweep helper's refusal branches, and re-read the round-39 repairs in place. Where I say "measured" I mean a recorded run I inspected; where I say "verified by reading" I mean my own static derivation.

---

## R0. Round 39's verdict and repairs

Round 39 confirmed two findings, both in `web/`, neither in the five programs: **V39-1 (MEDIUM)** and **V39-2 (LOW)**. I verified both repairs in the current source.

### V39-1 repair — promised stray silently dropped at the press — HOLDS

The defect was that at the press a stray the page had promised to deliver could vanish (unlabeled) if the press-time listing failed or the stray sat beyond the 200 full-read cap. The repair has three legs and I confirmed each in code:

- `web/src/lib/reads.mjs` `vaultWalletAccounts(conn, owner, reserveMints, promised=[])` now reads **by address** the union of the three reserve ATAs and `promised.slice(0, PROMISED_MAX)` (`byAddress = [...new Set([...reserveAtas, ...promised.slice(0,100)])]`), independent of the `getProgramAccounts` listing. So a failed or flooded listing can no longer hide a promised account.
- `web/src/pages/redeem.mjs` `freshPlan(...)` passes `final.known` as the `promised` list at the press (`readRedemptionSnapshot(..., final ? [...final.known] : [])`), so every account the holder was told would come to them is re-read by address.
- `web/src/lib/plan-redeem.mjs` adds, for each `k` in `s.known` that is **not** present in the press-time `s.pdaTokens`, a `cannot` box ("This page was going to take the account … out to you, but it is no longer there or could not be read just now"). Because that box's id is `lost:<address>` and `aboutKnown(a)` tests `s.known.has(address)`, it is **not** demoted to `lateInfo` by the standing-consent branch; it remains in `plan.ack`, so `prepareOpening` returns `stop:'ack'` and the holder must tick it. A failed by-address re-read throws `ReadError` before any dry run.

I checked the `PROMISED_MAX=100` cap specifically: even if a known stray is beyond the 100 read by address, the `for (const k of s.known)` completeness loop still emits the `cannot` box when it is absent from `pdaTokens`, so the cap does not reopen the hole. The "arrived after your check" heading is gated on `!s.seen.has(address)`, so an item present at the check is never mislabeled as late.

Evidence the repair is real: the recorded page e2e (`.cache/r39-web-e2e.log`, 120/120) includes "every promised balance still moved through a 112-account flood and a failed listing." I did not re-run it; the code path above is what that arm exercises.

### V39-2 repair — a stranger-placed CBOB vault refused an opening — HOLDS

The defect: anyone holding a CBOB vault could transfer it into a victim's deposit address and force `planRedemption` to refuse the opening. The repair changes the nested-CBOB case from a refusal to an **optional** set-up step:

- `web/src/lib/plan-redeem.mjs`: for `n.ourVault`, the code now pushes `priorIxs.push({ optional:true, ix: IX.rescueNested(...), why:... })` (or `pressInfo` when `noPrior`), and there is **no** `refuse.push` for `ourVault`. Foreign NFTs and unreadable NFTs remain `ack` boxes (tick, not refusal), and >20 such boxes are grouped (`STRAY_GROUP_OVER=20`), so a stranger cannot force unbounded ticks.
- If the optional rescue cannot be made, the opening proceeds and the inner vault is rescued afterwards (item 58: host burned → orphan → `rescue_nested` to the Squads). No value is lost because the inner vault is sealed and recoverable.

I confirmed the holder-facing text was reconciled (VALIDATION drift sweep): the bundled SPEC ("a nested CBOB vault is rescued … in an optional set-up step or after the opening, never refusing it (round 39 V39-2)") and `web/README.md` ("a CBOB vault someone sent inside never refuses it") no longer claim a refusal. I found no remaining site that says a nested CBOB vault blocks an opening.

Regression check: making the rescue optional does not strand the inner vault, because a burned host is exactly the `orphan` case `rescue_nested` accepts. I found no path where skipping the optional rescue destroys a CBOB vault.

### Round 39's disproved claims — I independently agree they are disproved

- **W1** (T22 `transferCheckedWithFee` rejected by `txread.mjs`): the amount requirement applies only to the literal list `['transfer','transferChecked','approve','approveChecked']` (`txread.mjs`), not to every `transfer*` type. A `transferCheckedWithFee` carrying only `tokenAmount`/`feeAmount` is accepted. Not a program defect; CBOB money is classic SPL, so T22 fee-transfers are not CBOB value.
- **W2** (delegated stray immovable): SPL Token permits the **owner** to transfer and close even while a delegate is set; the helper signs as the owner (the PDA). Suite arms 3.3/3.3a already measure an owner draining a delegated account. Disproved.
- **W3** (guide overpromises the C5 late deposit): the guide now promises only "the vault's own three accounts and its wallet" and states that anything arriving after the last check into any other account is lost. Matches `plan-redeem.mjs`.
- **W4** (`INIT_AUTHORITY` first-come between road steps 9 and 10): this is inherent to a one-time `initialize` gated by a compile-time key; no vault or holder value exists before the charter window, and the ceremony re-reads every config and stops on any wrong value. Not a defect. Optional hardening: run steps 9–10 in one sitting.
- **W5** (SBPFv3 may not be active on mainnet): the placeholder deploy log shows all five ids deployed `rc=0`; the loader verifies the ELF at deploy. Execution on mainnet is still untested and remains under item 22. Not a blocking defect.
- **W6/W7/W8**: agreed as stated (native transfer moves lamports; the Moments transfer-hook concern is outside CBOB holder value; the seven missing `because` pins are a coverage note, not a defect).

---

## R1. Custody / R1s. Sweep helper — no surviving defect found

I re-derived the open↔burn pairing and the emptiness proof rather than trusting prior rounds.

**Pairing.** SEAL walks the instructions sysvar **forward** from `current+1` requiring a top-level `burn_vault` with account 0 = asset and account 2 = owner; BURN walks **backward** from `0..current` requiring a top-level `open_for_redemption` with the same binding. Both bind asset **and** owner positionally, and each program re-validates on execution that account 0 is owned by account 2, so a matched pair cannot be confused across two vaults in one transaction. `retire_redeemed` enforces `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` and re-reads the top-level instruction to confirm it is BURN's `burn_vault` for this asset, which transitively forces both `open` and `burn` to be top-level (a CPI'd burn would put `retire_redeemed` at stack height 3 and revert). This is exactly what suite arms WR.1–WR.4 measure. I found no CPI-wrapper, two-vault, or account-index confusion that survives.

**Emptiness proof.** For each reserve mint, BURN derives the ATA under both Token and Token-2022 and requires both **declared**; a closed/system-owned account is skipped (`owner != SPL && != T22 → continue`), which is why the sweep closing the reserve accounts passes "for the right reason." Declared token accounts owned by the PDA must have amount 0, no delegate (`d[72..76]`), no delegated amount (`d[121..129]`), no close authority (`d[129..133]`), and exactly 165 bytes (no T22 extensions). The second loop refuses any declared live Core asset (nested vault) and any PDA-owned token account holding a balance. `asset_signer.lamports()==0` is enforced. I confirmed the sweep helper empties lamports **before** burn reads them and that nothing between the Core `ExecuteV1` and `burn_vault` can re-fund the PDA inside the atomic transaction.

**Stranger-created accounts.** I re-checked the "account a stranger can create that neither the sweep can name nor BURN will skip" question:
- T22 ATA for a classic mint: cannot be created (probe F4.2 measured REJECT).
- Non-ATA classic account owned by the PDA: the sweep **can** name it (any 165-byte classic account); the page names all it finds.
- T22 non-ATA account: the helper refuses it (`read_token` requires owner=SPL, len=165); if undeclared it is destroyed (the stranger's loss), if declared it fails `ReserveHasExtensions` — but it is not a *required* declaration, so it cannot block the burn.
- Reserve ATAs are fixed addresses the page always declares and creates in the prior transaction, so a stranger cannot introduce a new *required* declaration. A late deposit into an existing reserve ATA is swept at live balance.

Net: a stranger cannot block an opening and cannot cause the holder's value to be lost; the only destruction is of undeclared stranger-placed value, which is the accepted design (items 9/44/58) and is what the redeem page warns about.

**Sweep helper sub-questions.** (a) Only the owner can drive it (Core `ExecuteV1` authority = asset owner; a frozen vault rejects Execute; direct call fails `is_signer`). (b) Duplicate source fails on the second occurrence because the first close makes it non-token-owned; a source cannot also be a destination (owner mismatch, plus `signer.key==dest.key` guard); wSOL is handled as a classic account; a delegated source is movable by the owner; a kept-close-authority source reverts the close (the C5 case, handled by the page via plain transfer); a frozen source reverts the transfer (page does not name frozen strays). (c) The destination is chosen by the owner who signs; the page always uses the owner. Crediting a non-system or sub-rent destination does not block the canonical (owner) redemption. (d) `signer.lamports()` is read at execution and moved wholesale; nothing re-funds before burn. (e) Closed accounts pass the reserve loop because they are no longer token-owned. (f) The three-asset redemption through the helper fits a legacy packet with room for compute-budget + separate payer (S8.0). I found no surviving defect.

---

## R2 / R2b. Pool and boost — invariant re-proved, no defect found

**Pool invariant.** I re-proved `balance ≥ ceil(owed_scaled/ACC_SCALE)` is preserved by both operations:
- `distribute`/`credit`: `delta = floor(avail·S/w)`, `owed += delta·w ≤ avail·S`, so `ceil(owed'/S) ≤ ceil(owed/S)+avail = balance`.
- `claim`: pays `p = floor(pending/S)`, `owed' = owed − p·S`, `balance' = balance − p`, so `ceil(owed'/S) = ceil(owed/S) − p ≤ balance'`.

The two-step activation (`request_epoch`, join only when `dist_epoch > request_epoch`), `JoinWaitingFirst` (`waiting_to_join = pending_count − pending_this_epoch`), and the `pending_count`/`pending_this_epoch` decrement logic in `retire` (decrement `pending_this_epoch` only when `request_epoch == dist_epoch`) are internally consistent; I traced same-epoch and earlier-epoch retirement and found no counter drift. `monthly_inline` never refuses its host (only `WrongPool`), never credits from a frozen pool, and returns early on due boosts or waiting joins, so it cannot brick a host instruction.

**Boost.** I re-derived that a boost bought at epoch `e` with length `N` ends at `end=e+N` and earns exactly the `N` distributions that advance `dist_epoch` from `e` to `e+N` (credit runs before `advance_epoch`, and `BoostsExpireFirst` blocks the `(N+1)`-th). Because `N ≤ 63 = BOOST_RING−1`, all live boosts' `end` values lie in an interval of length < 64, so no two live boosts share a ring slot — the ring cannot collide. `unschedule_boost` correctly distinguishes due (`boosts_due--`) from early (`boost_expiring[end%RING]--`). `reweigh` preserves the owed amount (`carry = owed_old`, `debt = weight_after·acc`, so `owed_new = owed_old`), so nothing is gained or lost on boost/expiry/claim-normalization/retire. An empty `tick` cannot consume a boost's distributions because a boost requires an active vault, which implies `total_active_weight > 0`, so the `w==0` tick branch is unreachable while any boost is live. I found no defect. (The boost-timing disclosure remains an accepted residue, not a defect.)

---

## R3. Level draw — no defect found; SPEC 26 is not understated

`blockhash_in_window` pins the sysvar id, bounds the count to 512, validates the buffer length, refuses an all-zero hash, and selects the smallest produced slot in `[want, want+64]`. `try_capture` derives A, then B and C each two 4-slot leader groups later, and hashes `hA‖hB‖hC‖asset`. The FIFO (`index == revealed_total`) holds; a burned head-of-queue vault still draws (so the queue never stalls); a lapsed window is rescheduled to a future slot, never defaulted. The attribute re-supply is checked against the stored `attrs_hash`. The last-contributor grinding (C's leader choosing among many draws, best-of-4 via self-skip, cohort-wide for same-slot mints) is exactly as SPEC 26 states; I found nothing worse than that disclosure.

## R4. Governance — no minority path found

Quorum (`ceil(snapshot·quorum_bps/10000)`, never zero), threshold (YES share of cast), 10% YES turnout, and the 50%-of-snapshot key-change rule are all enforced against the snapshot fixed at creation, so mid-vote minting cannot move the bar. `create_proposal` refuses a bundled guardian+operator change; `execute_proposal` applies per-kind ordering with logged skips and moves the round mark before the already-over check (red-team 3 fix). The guardian can only stop; replacement needs the supermajority plus notice. I found no way a minority carries what it should not, no way a vote reaches money, and no new governance-freeze beyond the accepted limits 45/47.

## R5. Charter claim — SPEC 46 is complete as stated

The Merkle scheme is domain-separated (0x00 leaf / 0x01 node), sorted, with odd-node promotion; the Rust `merkle_leaf`/`merkle_root_from` match `scripts/pob-merkle.mjs` byte-for-byte. Identity is by address against `pob_root`; a lookalike minted by the hot wallet is not in the tree. The claim is window-gated by clock, not gated by the guardian stop, and passes `pob_extra` accounts never as signers. SPEC 46 already includes the positive bound (the hot key cannot transfer/burn an individual PoB) and the alarm-sampling caveat; I found nothing it omits that touches holder value.

## R6. One-time configuration — bounds hold

I re-read every `initialize` guard. MINT enforces the sweep-bound relationships (`sweep_floor ≤ max_sweep`, `cooldown ≤ cooldown_ceiling ≤ 7d`, `reserve ≤ reserve_ceiling ≤ 10 SOL`, `sol_reserve == 0 or ≥ rent`), non-default treasury/operator/payment mint, level caps positive and summing ≤ supply, charter window sane and in the future, non-zero PoB root, and the $CBOB mint distinct from payment and $GARY. The swap operator's worst case is bounded by cap × cooldown windows until the guardian stops it (accepted limit 10). The royalty plugin is installed with `PluginAuthority::None`, which Core refuses to change. The redemption cap is a true rolling window over the 64-slot timestamp ring. I found no wrong-but-accepted value that the on-chain guards miss; the remaining protection for the exact ruled values is `check-launch-params.mjs` plus item 38 (still OPEN).

## R7. Cross-program raw reads — recomputed, all correct

I recomputed the MintConfig byte map from the struct: `governance@41`, `minted_total@141`, `sales_stopped@191`, `sweep_stopped@192`, `guardian@193`, `swap_operator@225`, `sol_reserve@257`, `max_sweep@266`, `cooldown@274`, `charter_closes_at@442`, `bare_burns_retired@454`, `sales_stopped_at@518`, `sweep_stopped_at@526`, `sweep_floor@631`, `cooldown_ceiling@639`, `reserve_ceiling@647`, `max_boost_weight@711`, `max_boost_epochs@712`, ending at 1005 (+256 padding = 1261). These match every offset pinned in GOV, BURN, the suite, and `web/src/lib` (including the web's 125..195 VaultRecord slice, where `d[0]=active@125`, `d[1]=retired@126`, `d[61]=boost_weight@186`, `readBigUInt64LE(62)=boost_end_epoch@187`). VaultRecord is 221 bytes; BurnConfig's ring is 64×i64. I found no offset drift.

## R8. Suite / simulation / build as evidence

I read the suite structure and the `because`-pin mechanism but did not run it. Two known coverage notes remain open and are **not** re-filed as findings: seven negative arms (R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8) assert their refusal inline rather than via a `because` pin (carried from rounds 37–39), and the gate-5 obligation to add a `bank/selftest.mjs` arm for the T22 `transferCheckedWithFee` acceptance (round-39 W1) is not something I could confirm from this bundle. The detector selftest floor moved 926→930 between rounds 38 and 39, consistent with new arms having been added, but I cannot name them without `bank/selftest.mjs`.

---

## The four questions on the accepted limits

1. **Is any limit worse than stated?** I found none worse. I re-examined the highest-risk ones: limit 27 (cost falls on other holders, crank retires first — bounded as stated), 32 (ring covers supply ≤ 3047 > 2100 — stricter beyond, as stated), 40/46 (Core and Moments-key exposures as stated), 41 (transfers unlimited — as stated). The round-39 W7 observation (a Moments transfer hook affects the Moments market, not CBOB value) does not worsen limit 46.
2. **Is anything listed as a limit not actually a limit?** I found none already closed. Limits 42, 43, 49 remain real client/protocol obligations.
3. **Is any DISCHARGED item not actually discharged?** I found none. Items 12/17, 33, 51, 54 rest on measurements recorded in the tree; the boost (51) is built and its accepted residue (timing) is disclosed.
4. **Is any OPEN-AND-BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 all remain OPEN in SPEC, and `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline`, and `vault_collection` as OPEN, which `judgeLaunch` refuses (49/49 selftest). Nothing has been demoted.

---

## Findings

**None new at CRITICAL, HIGH, MEDIUM, or LOW.** Both round-39 confirmed findings are repaired in place (verified above at all sites of their shape, with regression checks), and I independently re-confirmed the claims round 39 disproved. The carried items (limit 27's `retire_burned`-before-claim hardening, the seven un-`because`'d negative arms, the W1 selftest arm) remain open obligations, not new findings.

**Measurement limits of this pass:** I did not run a validator, the suite, the simulation, or the page e2e; behaviors rest on recorded runs. I could not inspect `web/test/*`, `bank/crank.mjs`, `bank/detectors.mjs`, or `bank/selftest.mjs` (not in this bundle), so the round-39 off-chain repairs C01–C04 are taken from VALIDATION's red-under-mutation description, not re-derived. The SBPFv3-on-mainnet question (W5) is inferred from the deploy log, not executed.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what must be done before launch that AI audit structurally cannot

1. **Execute the mainnet dress rehearsal (item 22) with real value, by a human.** AI can specify it but cannot run a live crank against ~2,100 real vaults, perform one full revenue cycle through **both** Orca and Meteora, and walk one forced post-sweep failure through hand recovery. A person must hold the keys, watch the live alarm, and judge real-money behavior. This is the single most important thing no amount of AI reading replaces.
2. **Make the three OPEN launch values human decisions and record them:** `charter_opens_at`, `lock_deadline`, and `vault_collection`. These are Gary's, not auditable. Until they are RULED, `judgeLaunch` correctly refuses to pass.
3. **Human custody of every hot key, with a written ceremony:** `INIT_AUTHORITY`/guardian (Gary's wallet), the swap operator key, the $CBOB release wallet (`bank/keys/cbob-release.json`), the upgrade authority that will be removed, and the Giraffish Moments collection key held through the 7-day charter window. AI can state the exposure (limits 46, 56, 47); only humans can decide cold/multisig handling, backup integrity, and who physically signs.
4. **Independently verify the deployed bytes against the audited commit with the real keypair,** then remove the upgrade authority (road step 11) and re-dump to confirm finality. The AI-verified bridge is reproducibility; a second party should confirm the on-chain program hashes equal `dist/SHA256SUMS` at `RELEASE_COMMIT` before and after authority removal.
5. **Staff the post-launch human response loop:** the guardian stop, the CBOBTC Squads returning rescued vaults, the redemption poster (currently no sender), and review of `log_coverage_gap`/`scan_backlog_unproven` watermarks. These are person-in-the-loop controls the alarm deliberately defers to a human.
6. **A comprehension review of holder-facing copy by a person who is not the author.** AI can check that every sentence is *true* of the code (I found the guide consistent); it cannot confirm that a typical holder actually understands that opening is irreversible, that non-reserve tokens are destroyed, or that a leaked key is bounded only for redemptions.
7. **Physical and infrastructure security of the box** holding the swap-operator and $CBOB keys and the revenue ledger: the detection half cannot survive compromise of that box (limit 10(3)). That is an operational/human guarantee no code in this tree can provide.