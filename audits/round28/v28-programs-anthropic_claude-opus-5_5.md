# Round 28 Independent Audit: CBOB v6, full tree

**Verdict: NOT CLEAN.**

- **One MEDIUM finding (off-chain detection):** truncated logs blind every log-keyed detector, including the reschedule page that is accepted limit 25's only control.
- **Four LOW findings:**
  - L1: evidence the four programs ran on the certified bytes.
  - L2: the explicit launch-tick path has never been run.
  - L3: the SPL Token / ATA bytes the suite ran are not mainnet's.
  - L4: reveal FIFO fragility when an asset account is absent.
- **Ten INFO findings.**
- **No CRITICAL or HIGH. No custody, pool-accounting or governance-bypass defect survived my reading.**
- **Freeze:** every LOW and INFO counts. A fix to L4, or to the MINT comments in I5–I6, touches `programs/` and resets the counter.

I did not execute anything. Each finding below therefore states the observation that would exist on chain or in a run if I am right, so it can be checked.

---

## R0. Round 27's verdict and repairs

**Quorum and dispositions.**
- Laguna's exclusion as stale is justified: its report reproduces round 26 line sites the tree no longer has.
- Fugu's exclusion is justified: the call aborted and returned no report.
- Six of eight is a plausible count.
- I agree with W1–W13 as rejections.
- W5–W7 are now measured, not just argued: R27.S1, R27.C1/C2 and R27.V1 exercise the right shapes.

**D1 (stale status text): the repair is incomplete. INFO.** SPEC still says, in the present tense, near the top: *"v6 is a redesign and has had three independent red-team passes (`audits/v6-redteam/`), not yet a multi-model round."* That is the exact sentence class D1 named. In "Where this stands", three more sites are stale:
- "Rounds 22-26 completed; none was clean" omits round 27.
- The suite is credited as "the expanded round-26 run-tests passed … Evidence is in `audits/round26/VALIDATION.md`". The counts that section points to are round 27's (848 / 860), whose evidence is in `audits/round27/VALIDATION.md`.
- "v6 as of 2026-10-05" is stale.

*Evidence:* grep SPEC for "not yet a multi-model round" and for "round26/VALIDATION". *Fix:* correct the sites. The text is descriptive only.

**D2, D3, D4: hold.**
- D2: price "has no launch ceiling" now appears in HOLDER-GUIDE, DESIGN §3 and the MINT comment.
- D3: the error-mapping section exists.
- D4: SPEC 46 now names owner-managed plugins.

**The W5–W7 regression arms cost two existing arms. INFO, evidence quality.**
- **C.13** ("a CHARTER claim while the guardian has stopped sales") now records `String(!!C2)`. `C2` is always an object returned by `mkV`, so this arm cannot fail. If the PDA claim failed, `fetchAsset` in R27.C2 would throw first and the run would end FATAL. The behaviour is therefore evidenced only by R27.C1, and only for a PDA owner. No EOA charter claim under a stopped-sales flag remains.
- **7.6** ("the owner votes") records `v1.ok`, which is the R27.V1 PDA vote. 7.6 is now an alias of R27.V1.

Two of the 848 assertions are therefore not independent. *Fix:* restore an EOA claim under stop and an EOA vote as separate arms, or delete the aliases and lower the floor.

**Simulation 71/71 reused under byte identity.** I accept this for the program bytes. See L1 for the gap on the suite side.

---

## R1. Custody

I found no path that lets anyone but the owner move value out of a sealed vault. I found no path that leaves a thawed or emptied vault alive at the end of a transaction.

**The pairing.**
- SEAL scans forward for a top-level BURN instruction with asset at index 0 and owner at index 2.
- BURN scans backward for the matching open.
- MINT's `retire_redeemed` requires stack height 2 and the current top-level instruction to be BURN's `burn_vault` for the same asset.
- BURN's only CPI into MINT is the fixed retire, so the stack-height proof is sound.
- Any thaw requires a later top-level `burn_vault` that must succeed, because Solana has no partial-success transactions. So a thaw cannot outlive the transaction.

**Shapes I checked:**
- Transferring the asset between open and burn: burn then refuses `NotTheOwner` and the thaw reverts.
- A double open of the same vault: harmless.
- Cross-vault borrowing: refused, because both halves bind asset and owner.
- CPI wrappers: covered by WR.1–WR.3.

**The emptiness proof.** For an ATA *address* in the declared set, these are skipped by design and none can carry a token balance:
- A system-owned account with lamports. A stranger can create one at a Token-2022 derivation of a classic mint by a plain SOL transfer.
- A token-program account shorter than 165 bytes.
- An account closed earlier in the transaction.

The Token-2022-ATA-for-a-classic-mint creation path is refused on mainnet (probe). The classic ATA cannot be created by a stranger with a close authority, delegate or freeze, except a Coinbase freeze on cbBTC (accepted 28). $GARY and $GIRAFFISH have no freeze authority (probe).

## R1s. The sweep helper

**(a) Who can make it move value.** The source accounts must be owned by the asset-signer PDA. Only Core signs as that PDA, and only through `ExecuteV1`.
- On a frozen vault, the PermanentFreezeExecute plugin rejects the Execute (3.7, S6.2).
- On a thawed vault, a thaw exists only inside the owner's own transaction.
- Within that transaction, SR.5/5a/5c pin that a stranger, a transfer delegate and a collection update authority are refused.
- The AgentIdentity route (R24.1a) is refused at "missing required signature", before any authority check. That refusal does not by itself prove an owner lacks authority to add it. I still find no exploit: any delegated Execute must appear inside the owner-built thawed transaction, and the freeze rejection overrides approvals while the vault is sealed.

**(b) The pair list.**
- Source == destination is impossible: the destination's owner must equal `dest`, and `dest != signer`.
- A duplicate source fails on its second appearance (SR.12a/12b).
- A duplicate destination accumulates correctly. This is not measured, but it is plain Token Transfer semantics.
- A native wSOL source: Transfer moves `amount`, Close returns the rent. Correct.
- A frozen source reverts the redemption (SR.14).
- A non-ATA destination is fine.
- Odd or zero account counts are pinned (SR.7, SR.13).
- `dest` set to another vault's asset-signer is legal and self-harming. That is a page-side guard, not a stranger attack.

**(c) Destination checks, INFO, newly worth stating.** Coinbase can freeze the *owner's* cbBTC destination account. The helper then reverts the transfer, and with it the whole redemption, even though the vault itself is unfrozen. The fix is client-side: let the page pick a fresh destination wallet with fresh accounts. HOLDER-GUIDE says only that a frozen *vault* account blocks opening.

**(d) The lamport sweep.** The PDA reaches zero at the sweep. Nothing between the sweep and BURN's `lamports == 0` check credits it except instructions the owner chose to insert. Core `BurnV1` and `retire_redeemed` do not credit it.

**(e) Interaction with BURN.** A closed reserve account passes because, after Close, it is no longer token-owned (or has 0 lamports). That holds with the *validator's bundled* SPL Token. See L3: the mainnet Token bytes are not what the suite ran.

On missing reserve accounts: prior creation of all three classic ATAs is sufficient. The only stranger-creatable accounts are:
- non-ATA token accounts, which BURN skips and which die undeclared (accepted 44);
- nested Core assets (accepted 9);
- system-owned lamport accounts at ATA addresses, which BURN skips.

I find no account that a stranger can create, that the helper cannot name, and that BURN refuses on.

**(f) Does it fit? INFO.** S8.0 is 1,061 bytes. The widest page shape is about 1,209, leaving **23 bytes**. The item 44 / item 50 "rescue stray classic tokens" sweep list therefore has **zero** room in that shape: each extra pair costs about 66 bytes (two new keys plus indices). One or two pairs fit only in the narrow owner-pays, no-compute-budget shape (171 spare). Item 50 says "mind the packet" but does not say the widest shape fits none. Stating it would prevent a page that silently drops strays.

**(g) Evidence.** Byte identity of the helper is proven against `target/deploy`.

---

## R2. The pool: invariant holds

I traced every mutation of `owed_scaled` against the pool balance and found no break:

| Operation | Effect on `ceil(owed)` vs pool balance |
|---|---|
| credit | `owed` grows by at most `avail × S`, so `ceil(owed') ≤ balance` |
| claim | `ceil` falls by exactly the sats paid |
| retire / forfeit | only lowers `owed` |
| reweigh | changes neither |

Wrong pool accounts are pinned by address in every reader. Counters:
- `waiting = pending_count − pending_this_epoch` stays exact across request, retire-while-waiting, retire-this-epoch, join and `advance_epoch`.
- Every `JoinWaitingFirst` blocker can be cleared free: a claim-path join needs no live asset and no existing account.
- The worst case is a dead-weight join, which is accepted 27.

**L2 (LOW, evidence): the explicit `distribute(false)` launch tick has never been executed.**

The suite's only launch tick is 3c.A4, run in-line by a mint. After C1 joins, `total_active_weight` stays positive, so the `w == 0 → tick(c, now)` branch of `distribute` is never reached. The simulation's S7.3 calls `distribute()` only if an earlier host has not already ticked, and the arm passes either way.

That untested branch is the crank's own launch-month call: the code that opens the payout door for the whole charter cohort if no host traffic lands. It becomes immutable.

*Evidence if I am right:* `.cache/suite.log` contains no transaction whose top-level instruction is `distribute` and whose logs include `CBOB_EPOCH_TICK`.

*Fix:* add an arm on a fresh epoch where a vault is waiting and nothing is joined. Call explicit `distribute(false)` and assert:
- it ticks, credits nothing, and `pending_this_epoch` becomes 0;
- burn = true is refused `NoActiveVaults`;
- a non-empty remaining-accounts list is refused `BadBurnAccounts`.

**INFO: redemption of a *boosted* vault through BURN is not exercised.** Boosted retirements in BO.16, BO.17 and BO.38 all go through `retire_burned`. The host test calls `retire(…, false, …)`. The `redeemed = true` path with `unschedule_boost` (and the `ClaimBeforeBurn` check with a boost live) shares code but has no on-chain arm. Add one: claim, open, helper, burn on a boosted, not-yet-due vault, then check the ledger.

## R2b. The boost

The boost invariants hold:
- End epochs live in `(e, e+63]`, which are distinct mod 64.
- Both `tick` and credit sit behind the `boosts_due` check (both `distribute` branches and `monthly_inline`). So `dist_epoch` equals `end` exactly while a boost is due, and `unschedule_boost`'s branch choice is exact.
- A boost cannot be expired twice: weight is set to 0.
- A boost cannot be expired early: the due check is enforced.
- A boost cannot go unexpired: the gate blocks the next distribution.
- A vault whose account is gone is cleared by `expire_boosts`, which needs only records.

## R3. The draw

- The SlotHashes parse is bounded and fails closed.
- The capture deadline arithmetic holds: C ≤ `rs + 208` < 300 < 512.
- The FIFO and burned-head handling are correct.
- **Not worse than SPEC 26 states.** Block-content variation makes C's leader's choice effectively unbounded, and "choose among many" already concedes that.
- HOLDER-GUIDE's wording is true.

On the control for accepted limit 25 (the reschedule page), see M1.

## R4. Governance

There is no minority bypass:
- The key-change bar, turnout, snapshot and per-kind ordering are enforced as described.
- GOV's creation-time checks mirror every MINT re-check (restart, tighten, round, boost), so no bundle reverts at execute on a value check.

**INFO, SPEC 47 is worse than stated in one respect.** "Permanent while fewer than half of live vaults vote" is framed as a turnout problem. Live supply also permanently includes vaults that can never vote:
- lost keys;
- nested vaults;
- vaults sitting in marketplace escrows (if escrow programs do not vote);
- abandoned custodial wallets.

Once those reach half of live supply, guardian and swap-operator replacement is unreachable for good, whatever the turnout. The ordinary quorum becomes unreachable once they reach 79%. Only a bare burn plus `retire_burned` removes a vault from the denominator. Say so in 47.

## R5. Charter

SPEC 46 is now complete as far as I can find. A lookalike #241 is excluded by the root. Pushing a claim above 8 pass-through accounts or the packet limit is the stated brick class. A third party has nothing further.

## R6. Initialization and the trusted hop

The worst case for the swap operator is as stated. The royalty plugin is immutable through authority None. The rolling window is exact; at equal-second boundaries the arithmetic is the stated "at least a full window old".

## R7. Raw reads: all verified

I recomputed MintConfig field by field (`governance 41`, `minted_total 141`, `stop flags 191/192`, `sales_stopped_at 518`, `bounds 631/639/647`, `boost 711/712`, `ring 749..1005`, space 1005+256), VaultRecord (221), BurnConfig (`burned_total 42`, `ring 59..571`), the SEAL reserves Vec at 41, GovConfig's `proposal_count` at 53, the Proposal space, and the sweep helper's (0, 32, 64, 165). All match their readers.

---

## M1 (MEDIUM, off-chain): truncated logs blind the alarm

**Construct:** `bank/txread.mjs` `validateParsedTransaction`, and every consumer that keys on log lines. The alarm, poster and crank match:
- `CBOB_REVEAL_RESCHEDULED`;
- `CBOB_REDEEMED`;
- `CBOB_REDEEMED_POOL_FROZEN`;
- `CBOB_CLAIM_DEFERRED_FROZEN`;
- `CBOB_ACTION_SKIPPED`;
- the invoke-stack attribution.

MINT's own comment states that the reschedule line exists "so the alarm can page on it without decoding events".

**The gap:** the runtime's log collector caps each transaction's logs at 10,000 bytes and then emits `Log truncated`. Every later log line and `sol_log_data` event is lost from `meta.logMessages`. The reader accepts a truncated array as complete monitoring coverage.

**Attack:** anyone builds `[own_program_that_logs_10KB, reschedule_reveal(V)]` for about 1 SOL of program rent. Every instruction involved is permissionless. The reschedule then happens silently. That reschedule page is the alarm's main control for accepted limit 25 (re-roll by lapse). The same prefix hides a thief's redemption from the poster, or a forfeit from its page.

**Evidence if I am right:** on a local validator, deploy a program that logs about 10 KB, send that two-instruction transaction, and observe:
- `logMessages` ends in `Log truncated` and contains no `CBOB_REVEAL_RESCHEDULED`;
- `validateParsedTransaction` returns the transaction without complaint;
- the record's `reschedules` field still incremented.

**Fix:**
- Treat any `Log truncated` entry as incomplete coverage for log-keyed detectors, holding the cursor and paging.
- Make account state the primary source and logs only the attribution:
  - `VaultRecord.reschedules` deltas, already partly covered by `reveal_queue_stalled`;
  - BURN `burned_total` and the rate ring;
  - `owed_scaled` deltas.

---

## L1 (LOW, evidence): `build-mainnet.sh` ties only the helper to the bytes the suite ran

- The script compares `dist/cbob_vault_sweep.so` with `target/deploy/`.
- For the other four programs it only *prints* the `target/deploy` hashes.
- It already builds `$CACHE/ln` (the current commit's localnet build) but never compares those four against `target/deploy`.
- `run-tests.sh` neither refuses a dirty tree nor records the commit.

So a stale `target/deploy` from an earlier commit (for example, if run-tests ran before a later MINT edit) passes every check, and "the suite ran these bytes" is unproven for the four.

*Evidence:* edit a MINT comment, commit, run `build-mainnet.sh` without re-running the suite. It still passes.

*Fix:*
- `cmp` all five `$LN_DIR/*.so` against `target/deploy/*.so`.
- Have `run-tests.sh` write the commit, the dirty flag and the five deployed hashes into `suite.log`.

## L3 (LOW, evidence): SPL Token, Token-2022 and ATA are the validator's bundled programs, not mainnet's

Core is pinned by hash. Tokenkeg, TokenzQd and ATokenGP are not. The suite and simulation therefore run on whatever the installed Agave release bundles. Mainnet's Tokenkeg may differ, for example if it is replaced by p-token through the SIMD-0266 feature-gate path.

Results that depend on these bytes:
- **Correctness:** BURN's post-Close skip depends on the closed account no longer reading as a token account it owns. An implementation that zeroes the data but leaves Token as owner at length 165 would fail `ReserveNotOurs`.
- **Measured costs:** S8.1a (168,343 CU) and P.31.
- **Pinned refusal codes:** `0xb` and `0x11` in the `because` list.

*Evidence:* compare the sha256 of `solana program dump Tokenkeg…` (and ATA) from mainnet and from the local validator.

*Fix:*
- Boot the suite and simulation with `--bpf-program` set to the mainnet dumps, pinned by hash as Core is.
- Add SPL Token and ATA (replaceable by feature gate) to SPEC's "what we still do not control".

## L4 (LOW, defence in depth, immutable)

**Construct:** `reveal_level` treats a vault as burned only if the account is Core-owned, 1 byte, key 0. Otherwise it requires a live `AssetV1`, or fails `WrongAsset`. `retire_burned` has the same positive test.

**Risk:** if a Core change ever closes burned assets fully (0 lamports), two things follow:
- Every vault bare-burned *before its draw* becomes a permanent FIFO stopper. No later vault could be revealed or activated.
- Every bare burn becomes unretirable: dead weight stays in the denominator and in live supply.

Accepted limit 40 names the `NotBurned` failures and a broken `UpdatePluginV1`, but not this FIFO halt. An absent account at the recorded address can never be a live vault, because the asset is created in the same instruction as the record. So for the draw, treating "absent" as burned is safe.

*Fix (Gary's call; it touches `programs/` and resets the freeze):*
- In `reveal_level`, treat `lamports == 0` as burned.
- Otherwise, add this consequence to limit 40.

---

## INFO

- **I1.** D1 incomplete (see R0).
- **I2.** C.13 and 7.6 are aliases of the R27 arms (see R0).
- **I3.** The helper cannot deliver if the owner's own cbBTC account is frozen; the page needs an alternate destination (R1s c).
- **I4.** Zero rescue pairs fit the widest legacy redemption (R1s f).
- **I5.** Stale "anyone boosts" text:
  - DESIGN §3, "Anyone burns `boost_price`…", contradicts the next sentence.
  - The MINT `BOOST_RING` comment says "anyone burns".
  - The BO.7 title says "ANYONE with $CBOB boosts".
  - The code is owner-only (`BoostNotTheOwner`).
- **I6.** MINT comment drift:
  - The `arm_swap_operator` doc block sits above `set_boost_terms`.
  - The "provided it gives at least 1 sat per weight" cadence comment survives the deleted cadence.
  - The GOV header's action list omits `SetBoostTerms`.
- **I7.** SPEC 12/17 cites v5 figures (58,956 CU / 890 B) as "measured on the artifact". The v6 plain mint is 75,898 (item 54).
- **I8.** SPEC 47 denominator permanence (see R4).
- **I9.** A boosted-vault redemption through BURN has no arm (see R2).
- **I10.** A governance point not stated as such: SPEC 51 allows "any price above zero". A 10.71%-YES ordinary vote can set the boost price to one base unit (0.000001 $CBOB) at +12 weight for 24 distributions. A coalition holding released $CBOB can then flatten the 1:3 level schedule in its own favour for 24 distributions, and renew it by re-vote. This is within the ruling, but it should be stated plainly in DESIGN §3 and SPEC 51.

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?**
- **25:** its reschedule-page control can be blinded by log truncation (M1).
- **40:** add the burned-before-reveal FIFO halt (L4).
- **47:** the denominator includes vaults that can never vote (I8).
- **51/56:** a near-free boost price plus concentrated $CBOB lets a coalition capture payout share (I10).

**2. Is anything listed as a limit not actually a limit?** No. Limit 35 holds after rounding: YES ≥ 0.51 × 0.21 N > 0.1 N.

**3. Is any DISCHARGED item not actually discharged?** No item is falsely discharged. 12/17 cites stale numbers (I7), but its conclusion stands.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No.
- 22, 38, 50, 52 and 53 remain open.
- Round 27 refreshed the rehearsal tree but did not run the suite inside it, so 53's proof is still stale. That is correctly left OPEN.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run on mainnet's actual dependency bytes.**
   - Boot the validator with mainnet dumps of SPL Token, Token-2022 and ATA, pinned by hash as Core is (L3).
   - Run the suite and simulation there.
   - Re-run whenever a token-program feature gate activates.
2. **Run on a cluster that skips slots.** Run the reveal and crank lanes for at least a week on devnet or testnet at throwaway IDs. That exercises the skipped-slot, leader-rotation and lapse paths live; host tests only model them.
3. **Mutation testing.**
   - Run `cargo-mutants` on the four programs and the helper against the 848-assertion suite.
   - Every surviving mutant is either an arm that cannot fail (like C.13) or an untested branch (like L2).
   - Publish the survivor list.
4. **Differential fuzzing.**
   - Drive random sequences of activate / request / join / boost / expire / claim / distribute / tick / retire / redeem against the localnet programs.
   - Drive the same sequences through `bank/accrual.mjs` as an independent model.
   - After every step, compare `owed`, the weights, the ring and every record.
5. **Two-machine reproducible build.**
   - Rebuild from the release commit on a second machine with a different OS image.
   - Match all five sha256 values.
   - Verify the deployed bytes on chain against them (e.g. `solana-verify`) **before** `--final`.
6. **Key ceremony done by humans.**
   - Generate program keypairs and the upgrade authority offline, on a fresh machine.
   - Deploy, run the four `initialize` calls from `launch/mainnet-init.json` byte for byte, read back every config field, and run `--final` in one supervised session, with no gap in which a leaked INIT or upgrade key matters.
   - Put the guardian/INIT wallet on a hardware wallet.
7. **A funded bounty before the lock.**
   - Deploy at the real IDs and publish source and hashes for a fixed public window before the charter opens.
   - Seed a real vault with real cbBTC as a standing bounty.
   - Humans with money at stake reason differently from AI auditors.
8. **Real wallets against the real redeem page.**
   - Phantom, Ledger and Gary Club custodial wallets: compute-budget handling, separate payer, prior ATA creation.
   - Wallets that silently rewrite transactions are a failure mode no AI review sees.
9. **Detection off the box.**
   - Run a second, minimal account-state watcher (pool vs owed, burned_total, reschedule counters, program authorities) on separate infrastructure, under separate credentials.
   - Then a box compromise (limit 10's residue 3) or log truncation (M1) cannot silence everything.