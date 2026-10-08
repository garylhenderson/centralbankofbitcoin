# Round 41 Independent Audit — CBOB Vaults v6

## Method and scope

I read all five programs (`SEAL`, `MINT`, `BURN`, `GOV`, `SWEEP`), the off-chain pipeline modules referenced (`bank/txread.mjs`, `bank/sigwalk.mjs`, `bank/layout.mjs`), the web page sources (`web/src/lib/*`, `web/src/pages/*`, `web/meta/generate.mjs`, `web/deploy/*`), the suite (`tests/3prog.test.ts`), the simulation (`sim/test-vault.ts`), the build scripts, SPEC, DESIGN, HOLDER-GUIDE, the round-40 verdicts and validation, and the launch parameters. I recomputed cross-program offsets, account sizes, and the pool/boost/rate-limit arithmetic from the struct definitions. I did **not** run a validator, the suite, the simulation, the e2e harness, the alarm, the crank, or any live job. My conclusions about runtime behaviour are therefore reads of the source and of the recorded measurements, not fresh executions. Where I cite a measured result, I name the arm or log it came from so it can be re-run.

I did not independently re-derive every one of the 896 suite assertions; I spot-checked the ones load-bearing for the claims I attack below.

---

## R0 — Round 40's verdict

I treated both round-40 verdicts as claims to verify, not authority.

**Programs pass.** Round 40 found no defect in the five programs and I did not overturn that. I re-read the pairing, emptiness proof, pool accumulator, boost ring, draw, governance and charter-claim paths and did not find a program-level defect the round-40 auditors missed. I state this as a negative result ("I did not find"), not as a certification of absence.

**Repairs.** The three page-level repairs from round 40 (`V40-1` MEDIUM, `V40-2`/`V40-3` LOW) are present in the source. `absentIfDust` (`web/src/lib/decode.mjs`) classifies a System-owned, zero-byte account at an expected token address as absent, and is applied in `vaultWalletAccounts`, `readRedemptionSnapshot`, the ceremony `atas` step, the buy page revenue check, and the metadata generator. I traced each call site. The logic is sound **given** the measured fact (suite R34.G2, R36.G2b) that the ATA program's create still lands on a lamport-dusted ATA address. I did not re-run that measurement; if it is wrong, the repair is wrong. Evidence that would falsify the repair: a local-validator run where `createAssociatedTokenAccountIdempotentInstruction` to a dusted ATA address fails. That is exactly what R34.G2 asserts succeeds, so the repair stands or falls with that arm.

**One residual I could not clear.** Round 40's `U1` (the large-autograph vault's redemption under the *default* compute budget) is recorded as measured by `R40.U1` (158,377 CU over 4 instructions). I did not re-run it. If that number is wrong and the redemption exceeds `4 × 200,000`, the redeem page (which sends no compute-budget instruction for this shape) would fail for exactly the worst-case vault. This is checkable by re-running the simulation arm. I flag it because it is a holder-facing failure mode resting on a single recorded number I could not reproduce here.

---

## R1 — Custody: can anyone but the owner get value out, or can an emptied vault survive?

I attacked the pairing, the emptiness proof, and the thaw-escape. I did not find a break. Details of what I checked and why each line of attack fails:

**Pairing.** `open_for_redemption` walks *forward* from `current+1` over top-level instructions only (`load_instruction_at_checked` does not see CPI), matching `BURN_PROGRAM_ID` + `burn_vault` discriminator + asset at index 0 + owner at index 2. `burn_vault` walks *backward* over top-level instructions matching `SEAL_PROGRAM_ID` + `open_for_redemption` discriminator + asset at index 0 + owner at index 2. Both bind asset **and** owner, so a redemption of vault A cannot borrow the open/burn of vault B in the same transaction. A CPI-wrapped open or burn is invisible to the opposite check (the wrapped instruction is not top-level), which is the intended fail-closed behaviour and is measured by WR.1–WR.4. I checked the discriminator constants against the Anchor derivation names (`global:burn_vault`, `global:open_for_redemption`) and the account-index constants (asset=0, owner=2) against the `BurnVault`/`OpenForRedemption` account structs; they agree.

**Two vaults in one transaction.** Each open finds its own burn and each burn finds its own open; the rate limit is the only cross-vault coupling and it is checked per burn. I did not find a way to make one open satisfy two burns or vice versa, because both checks match on the specific asset pubkey.

**Thawed vault leaving the transaction unburned.** The thaw and the burn are in the same atomic transaction. If the burn fails for any reason (non-empty, rate-limited, bad declaration), the whole transaction reverts including the thaw. There is no instruction that re-seals, but none is needed: a reverted thaw never happened. I looked for an instruction sequence where the thaw commits but the burn does not and did not find one, because Solana transactions are all-or-nothing.

**Emptiness proof.** `burn_vault` requires `asset_signer.lamports() == 0`, every reserve mint's ATA under *both* token programs to be declared, PDA-owned, delegate-free, close-authority-free, extension-free (exactly 165 bytes), and zero-balance. It also refuses any declared account that is a live Core asset. The `continue` branches (account not owned by a token program, or data < 165 bytes) are only reachable for an ATA address that was never created as a token account; since only the ATA program can create at that PDA and it creates token accounts, a value-holding account cannot hide in those branches. I could not construct a declared-but-foreign account that passes the owner-PDA check while holding value.

**What I could not fully eliminate** is the documented enumeration gap: non-ATA token accounts and undeclared nested assets owned by the PDA are invisible to the burn and are destroyed. This is accepted limit 44 / proven impossibility 2 and I am not re-reporting it. I confirm it is real: the burn derives only the canonical ATAs and cannot enumerate.

---

## R1s — The sweep helper

I addressed each sub-question.

**(a) Who can move value.** Called directly, the helper requires `signer.is_signer` where `signer` is the asset-signer PDA; no one holds that key, so direct invocation by a non-PDA signer fails the source-owner check (`src_owner != signer.key`). Through Core `ExecuteV1`, Core signs as the asset-signer only when the authority is the asset owner (measured SR.5/SR.5a/SR.5c). The helper can only be reached on a **thawed** vault, because Core refuses `ExecuteV1` on a frozen `PermanentFreezeExecute` asset (measured 3.7, S6.2), and thawing only happens inside `open_for_redemption` which requires the paired burn. I did not find a path where a non-owner, an update authority, a delegate, the SEAL PDA, or the collection authority triggers the helper on a sealed vault.

**(b) Pair list.** Duplicate source: first occurrence closes it, second fails `read_token` (owner no longer Token program) → whole transaction reverts (measured SR.12a). Source also destination: impossible unless `signer == dest`, which is refused. Native wSOL source: treated as a token account; balance moved by token transfer, rent by close — consistent. Source with a delegate: transfer still succeeds (owner authority), but a *close authority held by a third party* makes the close fail → revert (this is the documented round-35 C5 case). Frozen source: token transfer fails → revert. Non-ATA destination: accepted as long as it is a token account owned by `dest` with matching mint; that is by design. `dest == signer` refused. Odd pair count refused; zero pairs allowed and does only the lamport sweep (measured SR.13). I did not find a pair configuration that moves value to a non-`dest` wallet.

**(c) Destination not checked against owner.** This is safe *only because* the trigger is owner-gated (part a). The owner is sweeping their own soon-to-be-burned vault to a wallet they choose. I note this is a load-bearing dependency on Core's `ExecuteV1` authority rule; if a Core upgrade widened who may `ExecuteV1` (accepted limit 40), the helper has no independent owner check and would move value to whatever `dest` the caller names. The helper *cannot* check the owner because it is not passed the asset account. I record this as a structural dependency, not a new defect, because it is exactly the residual limit 40 already names.

**(d) Lamport sweep.** The helper reads `signer.lamports()` at execution and transfers all via `system_instruction::transfer` with the asset-signer as signer (signer status propagates through the Core CPI). Because open/sweep/burn are one atomic transaction, no instruction can land between the sweep and the burn to re-fund the PDA. `burn_vault` then reads `lamports() == 0` on the same account in the same transaction. I did not find a way to leave the PDA non-zero after the sweep within the transaction. A stranger pre-funding the PDA in an *earlier* transaction is swept out at execution (the helper reads live balance), so it is a gift to the owner, not a grief.

**(e) Interaction with BURN's proof.** The helper closes each account it empties (rent to `dest`), so a closed reserve ATA is absent at burn time. BURN's reserve loop `continue`s past a non-token-owned or short account, which is the correct treatment of a closed/absent ATA. Missing reserve ATAs are created in the prior transaction per SPEC REDEEMING step 1; once created, a stranger cannot re-create them, so the "stranger creates the ATA between build and land" race is closed by the prior-create. I confirm this is sufficient **provided the client actually performs the prior create**; a client that skips it would hit `ReserveNotDeclared` at burn (fail-closed, not a loss).

**(f) Fit.** I did not re-measure. The recorded S8.0 (1,061 bytes owner-payer, ~1,209 worst page shape, under 1,232) and S8.1a (168,343 CU) are the evidence. Adding a fourth reserve or the inline monthly-run accounts changes these numbers; the production reserve count is 3, matching `MAX_RESERVE_MINTS`.

**(g) Evidence / build identity.** `build-mainnet.sh` cmps the sweep helper's mainnet bytes against the localnet bytes the suite deployed and against `target/deploy`. I read that logic; it is a real byte comparison. I did not run it.

---

## R2 — Community pool

I recomputed the accumulator invariant `pool_balance ≥ ceil(owed_scaled / ACC_SCALE)`:
- `distribute` adds `delta*weight` to `owed_scaled` where `delta = floor(avail*ACC_SCALE/weight)` and `avail = balance − ceil(owed)`, so the new `ceil(owed)` cannot exceed `balance`.
- `claim` pays `floor(pending/ACC_SCALE)` and subtracts exactly that many scaled units from `owed_scaled`, preserving the invariant.
- `retire_*` subtracts the vault's `pending` from `owed_scaled` without moving tokens, which only relaxes the invariant.

I checked the two-step activation (`pending` → `join` only when `dist_epoch > request_epoch`), the `waiting_to_join = pending_count − pending_this_epoch` gate, and the counter increments/decrements on request, join, and retire (including the same-epoch vs earlier-epoch retire branch). I did not find a counter drift. The `JoinWaitingFirst` and `BoostsExpireFirst` gates prevent the first-activator and due-boost reorderings. I did not find a liveness attack where one actor can permanently block distributions for others: joining and expiring are permissionless and free, and the monthly path runs inline.

I did not independently re-run the 260-epoch boost model (host test N1) or the 1,000-epoch ring model; I read them and they match the free functions they exercise.

## R2b — $CBOB boost

I traced `boost_vault` → `reweigh` (moves owed to `carry_scaled`, resets `debt_scaled` to `new_weight*acc`, adjusts `total_active_weight` by the delta), the ring scheduling at `end % 64`, `advance_epoch` moving the slot into `boosts_due`, and `expire_boost`/`unschedule_boost` (due vs not-yet-due branches). The invariant "a boost earns exactly its N distributions" rests on `BoostsExpireFirst` (no distribution runs while one is due) plus `expire_boost` requiring `dist_epoch >= boost_end_epoch`. I did not find a path to expire early, expire twice, or earn past `end`. The `max_boost_epochs ≤ 63 < 64` ring size prevents a live boost from colliding with itself modulo the ring. I could not break the accounting.

## R3 — Level draw

I verified `try_capture` selects the smallest produced slot in `[want, want+64]` for A, then advances two 4-slot leader groups for B and C; the entropy is `sha256(hA‖hB‖hC‖asset)`. Reveal is strictly FIFO (`index == revealed_total`), draws without replacement from `level_caps − level_minted`, and a burned vault still draws (so the FIFO never stalls). The reschedule path moves to `now + 16`, a future slot. I confirm the last-contributor (C-leader) grinding residual is real and is accepted limit 26; I am not re-reporting it. I did not find a way for a minter or crank to bias the draw beyond that stated residual.

## R4 — Governance

I checked the snapshot (`index_snapshot`, `quorum_supply = minted − burned − bare_retired` at creation), the `VaultTooNew` index gate, quorum/threshold/turnout/key-change math, the per-kind ordering marks, and the skip-don't-revert behaviour. The `tighten_sweep` monotone max/min cannot loosen. Guardian/operator changes require the half-of-live-supply YES and the notice period. I did not find a minority path to carry a vote it should not, nor a way to freeze governance permanently beyond the stated low-turnout guardian-stop case (accepted limit 47).

## R5 — Charter claim

I verified the Merkle leaf/node domain separation (0x00/0x01), sorted pairs, odd-node promotion, the address-based identification against `pob_root`, the ownership check read from the PoB account bytes, the CPI burn with `pob_extra` passed never as signers, and the clock-only window gate. I did not find a second-preimage or a way to claim with a lookalike asset. The hot update-authority exposure is accepted limit 46; I confirm it is real and not re-reporting it.

## R6 — One-time configuration

I re-read each `initialize`. The bounds (sweep floor/ceiling/reserve, notice, monthly, redeem window, boost ceilings, quorum/threshold floors) are enforced. I note that the programs enforce *ranges*, while the exact ruled values are enforced only by `scripts/check-launch-params.mjs` pre-signing (item 38). That is stated, not a new finding, but it means a wrong-but-in-range value passes the program and is caught only by the external checker.

## R7 — Cross-program raw reads

I recomputed every pinned offset against the struct layouts:
- MintConfig: governance@41, minted_total@141, bare_burns_retired@454, charter_closes_at@442, sol_reserve@257, max_sweep@266, cooldown@274, sales_stopped@191, sweep_stopped@192, stopped_at@518/526, sweep_floor@631, cooldown_ceiling@639, reserve_ceiling@647, max_boost_weight@711, max_boost_epochs@712. All match.
- VaultRecord: mint_index@41. Matches.
- BurnConfig: burned_total@42. Matches.
- SEAL Config: collection@9, reserve_mints@41. Matches.
- Sweep helper token read: mint@0, owner@32, amount@64, len 165. Matches classic SPL layout.

I did not find a misaligned offset. This is a re-derivation, not a runtime check; a layout change would still be caught by the version pins.

## R8 — Suite, simulation, build

I did not re-run these, so I cannot attest to arms that "cannot fail." From reading: the negative arms use `because(...)` reason pins for most refusals, but round 40 already recorded seven arms (R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8) with **zero** `because` pins. That means those refusals would pass even if they fired for the wrong reason. I confirm this gap is real and still open; it is a test-rigour gap, not a program defect. Evidence that would close it: adding `because` pins to those seven arms and re-running.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?** I did not find one that is exploitable beyond its statement. Limit 40 (Core upgradeable) is the one with the largest unbounded downside, and the sweep helper's lack of an independent owner check (R1s-c) means limit 40's "who may act through a vault's wallet" consequence is slightly broader than the limit text implies: it is not just that Core *could* widen it, it is that the helper offers no fallback if it does. This is within the spirit of limit 40 but worth stating plainly.

2. **Is anything listed as a limit not actually a limit?** I did not find a listed limit that is already closed. Limit 44's "undeclared airdrops destroyed" is still real (enumeration impossible). Limit 41's transfer-not-rate-limited is real.

3. **Is any DISCHARGED item not actually discharged?** I checked the discharged items relevant to code (14 duplicate attributes, 19 unlevelled halt, 30/31/33, 51 boost, 54 compute). They correspond to code that exists. I did not find a discharged item whose fix is absent. The one caveat: SPEC discharged item 2's wording ("nothing refuses a redemption off chain") was flagged by round 40 as V40-4 and re-worded; I confirm the re-wording is needed and the underlying page refusals are by-design, not a stranger-triggerable block *after* the V40-1 fix.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?** Items 22, 38, 50, 52, 53 are still marked OPEN and `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline`, and `vault_collection` as OPEN with `judgeLaunch` refusing them. I did not find evidence any of these is being silently accepted.

---

## Findings

I have **no CRITICAL, HIGH, or MEDIUM** findings against the five programs. I have the following LOW/INFO items.

**LOW-1 (test rigour): seven negative-style arms have no reason pin.** Construct: `tests/3prog.test.ts` arms R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8. If any of these refusals changed to a wrong-reason failure, the suite would still pass. Evidence that would confirm the risk: mutate one of those arms' expected error and observe the suite stays green. Fix: add `because(...)` pins to each. This is carried from round 40 A9 and is still open.

**LOW-2 (single recorded number for a holder-facing path): the worst-case vault's default-budget redemption.** Construct: `R40.U1` / `tests/3prog.test.ts` large-autograph redemption without a compute-budget instruction. The redeem page sends no compute-budget instruction for this shape; if the real CU exceeds `200,000 × instruction_count`, that vault cannot be opened via the page. I could not re-run it. Evidence that would confirm a problem: re-run the arm and observe `unitsConsumed > 800,000`. Fix if it fails: have the page set a compute-unit limit for this shape.

**INFO-1 (structural dependency): the sweep helper has no owner check independent of Core.** If a Core upgrade changed `ExecuteV1` authority (limit 40), the helper would honour whatever `dest` the new caller supplies. This is not a defect today; it is the concrete shape of limit 40's third consequence. No fix is possible without changing the helper's interface, which is immutable at launch; the mitigation is the Core-upgrade alarm already in place.

**INFO-2 (operational): the swap operator and guardian are single hot keys.** This is within accepted limits 10/47, but the guardian is a single Phantom wallet that is also `INIT_AUTHORITY`. I note it because the blast radius of that one key (stop sales, stop sweep, cancel pending operator, and the one-time initialize) is concentrated in one custody arrangement.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Physically verify key custody, which no AI can inspect.** The guardian/`INIT_AUTHORITY` key, the swap-operator key, and the $CBOB release-wallet key are file-backed hot keys referenced by the code. An AI audit reads the *references*, never the *storage*. Before removing upgrade authority, confirm in person (or via a trusted human) that these keys are on the intended machines, that the release wallet secret is actually in the encrypted backup, and that no additional copy exists. Consider moving the guardian to a multisig/hardware device; the code tolerates any on-curve pubkey.

2. **Re-run the full gate on the exact release commit and compare deployed bytes to `dist/SHA256SUMS` from the chain, not from the build machine.** AI here cannot query mainnet. A human (or a script run on a machine with chain access) must `solana program dump` each of the five deployed programs and hash-compare against the audited artifacts *after* deployment and *again* after the upgrade authority is removed. The placeholder→upgrade→finalize sequence is the only chance to get this wrong silently.

3. **Execute the dress rehearsal (item 22) with real value, including the forced-failure paths.** The rehearsal is OPEN AND BLOCKING precisely because no AI round can simulate a live cluster's rate limits, RPC flakiness, and revenue-cycle recovery. The named pass/fail items (one full revenue cycle through both pools, one forced post-sweep failure walked through hand recovery) must actually be run and their signatures recorded.

4. **Test the guardian stop/restart and the swap-operator replacement end-to-end on mainnet before launch, with the real guardian key.** The programs are measured, but the *human procedure* (who signs, how fast, whether the alarm routes to a person who can act) is not something an audit exercises. Run a live fire drill.

5. **Confirm Metaplex Core and the third-party programs (Orca, Meteora, Pyth, Token) have not changed between the pinned hashes and launch.** The pins are recorded, but only a live check at launch time can confirm the environment still matches what was audited. The alarm detects changes after the fact; a pre-launch re-pin check catches the window between last audit and deploy.

6. **Have a human read HOLDER-GUIDE against the live pages once they are published.** An AI can check the page logic against the programs; it cannot judge whether a real holder will misread a sentence and lose value. The guide's promises (late-deposit, rescue, frozen-pool forfeit, boost-as-distributions) are the most likely source of holder confusion, and only a human can assess comprehension.

7. **Decide and record the response plan for a Core upgrade and for a Coinbase pool freeze.** Both are accepted limits with real operational consequences (redemptions refuse / forfeit, level queue halts). The *decision* about what the team does in the first hour of each is a human governance act, not something an audit can produce.