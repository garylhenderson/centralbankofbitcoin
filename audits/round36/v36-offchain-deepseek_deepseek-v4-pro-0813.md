## Order by target

### R0. Round 35 verdict + repairs

**No new CRITICAL or HIGH found in `rescue_nested` itself.** The rescue PDA is used in exactly one `invoke_signed`, the destination is pinned to `bank_treasury`, and the host cases are what item 58 says. The remaining issue below is a repaired-to-documentation case whose actual code/helper did not change accordingly.

**Finding A — MEDIUM — the C5 “foreign close authority” remediation is not implementable with the shipped sweep helper, so the accepted limit is worse than it is written**

- Construct: `programs/cbob-vault-sweep/src/lib.rs`, `process()`. For every token pair it does `Transfer` (if amount > 0) and then unconditionally invokes `CloseAccount` with the vault PDA as signer.
- Gap: A classic SPL token account can have a close authority that is not its owner. If a stranger sets close authority to themselves and then sets the account owner to the vault PDA, the helper can transfer the balance out, but `CloseAccount` requires the close authority’s signature. The PDA is owner, not close authority, so the close reverts and the whole redemption attempt reverts.
- Why this survives round 35 C5: the triage/SPEC text says the page “sweeps its balance and leaves the empty account undeclared.” `process()` has no path that transfers and then skips close. To “leave undeclared after sweep” would require either a modified helper or a completely different top-level instruction; neither exists. `judgeRedemptionCoverage` still treats a funded classic account as something that must be handled.
- Impact: Anyone who can create a token account for a vault PDA and set a foreign close authority can create a redemption-blocking account. It does not steal funds, but it is exactly the griefing surface the C5 text claims is handled.
- Evidence if right: On a local validator, create a classic token account owned by a vault’s asset-signer PDA, set its close authority to `A`, put 1 unit in it, and run the redemption through the helper. The transaction reverts at the close with a Token program close-authority error; the transfer did not land. The SPEC page contract cannot be executed by `cbob-vault-sweep` as built.
- Fix:
  - Either alter the helper to skip `CloseAccount` when the account has a non-default close authority that is not the signer, after transferring the balance to the destination;
  - Or change `judgeRedemptionCoverage` and the page client to omit such an account from the sweep and from the burn declaration, with an explicit human warning, and correct SPEC/HOLDER-GUIDE to match.
- This should not be “accepted” as documentation: item 50 is still OPEN AND BLOCKING, and the page contract is currently wrong.

---

### R1. The crank

**Finding B — LOW — `planCrank` suppresses the free launch tick while the pool is frozen, although MINT accepts that tick**

- Construct: `bank/crank.mjs`, `planCrank()`:
  ```js
  } else if (joinable && poolOk && !pool.frozen && due && w === 0n && waitingThisEpoch) {
    plan.distribute = true; plan.distributeKind = 'tick'
  }
  ```
- Gap: MINT’s `distribute` does not check whether the pool is frozen in the `w == 0` tick branch. `monthly_inline` also ticks without checking frozen because a tick moves no pool funds. The crank, however, refuses to plan that tick while `pool.frozen` is true.
- Impact: If the pool is frozen at the point where the free monthly tick is due and there are pending activation requests but no activated vaults, the vaults cannot join. The crank won’t run the tick, and if no ordinary traffic lands a host instruction that calls `monthly_inline`, the epoch never advances. The alarm’s `launch_tick_overdue` then pages even though the program would have accepted the permissionless tick.
- Evidence if right: With `mint.total_active_weight == 0`, `mint.pending_this_epoch > 0`, `mint.pool_ata` a frozen cbBTC token account, and `now >= last_distribute_at + monthly_secs`, `distribute(false)` succeeds on chain and advances `dist_epoch`. A crank dry-run in the same state plans no `distribute`.
- Fix: Treat the `w === 0n` free tick separately from crediting distributions. Plan the tick when it is otherwise valid even if the pool is frozen; keep the frozen-pool suppression for `w > 0n` and for claims.

No further crank finding survived this pass.

---

### R2. The alarm and detectors

**Finding C — LOW — `unredeemable_owner` still says “sealed for good” for a vault inside a burned foreign asset, even though `rescue_nested` can extract it**

- Construct: `bank/detectors.mjs`, `detectNestedVaults()` off-curve branch.
- Gap: If a vault’s owner is the asset-signer PDA of a foreign Core asset and that foreign asset has been burned, `rescue_nested` accepts the burned host and moves the vault to the CBOBTC Squads. The detector does not resolve the foreign host, so it falls through to `unredeemable_owner` and prints:
  > “Either this vault is listed on a marketplace that escrows it (recoverable: delist and it returns) or its contents are sealed for good.”
  That second alternative is now false for a burned host.
- Impact: A false CRITICAL/page for a state that can be recovered, and an alarm text that tells the operator the wrong remedy. This is noisy rather than a silence bug.
- Evidence if right: A vault inside a foreign Core asset that is then burned is reported as `unredeemable_owner` CRITICAL; `rescue_nested(vault, burned_foreign_host, bank_treasury)` succeeds on chain; the vault then appears held by `D.CBOBTC_SQUADS` and pages `vault_awaiting_return`.
- Fix: In the off-curve branch, detect when the owner is a Core asset-signer PDA (`PDA(["mpl-core-execute", host])`) and at least mention that if the host is burned, the rescue can extract it. Ideally add a separate `nested_foreign_host` finding or a runbook line instead of reusing the marketplace-escrow text.

No detector quiet-state defect was found in the fixed-forever watchers, POB collection watchers, redemption-window near-cap logic, or the freeze/pending guardian paths.

---

### R3. The layouts

No surviving defect found. The field-list, cross-program offset, seed, version and `BOOST_RING` assertions exist and fail on the shapes they claim to catch. Round 24 D6’s missing SEED assertion is now present in `bank/selftest.mjs`.

---

### R4. The money arithmetic

No divergence found between `bank/accrual.mjs` and MINT’s `credit`, `claimed owed_of`, boost/carry `reweigh`, `ceil_sats`, and join debt. The crank expires due boosts before distribution and schedules post-expiry correctly.

---

### R5. The swap and revenue cycle

**Finding D — LOW — a dry run of `bank/revenue.mjs` can still mutate the revenue ledger during the recovery block before the `--live` check**

- Construct: `bank/revenue.mjs`, `main()`.
- Gap: The recovery block fills `returnBlockTime`, searches `splitsSince`, assigns `cycle.splitSig`, and calls `save(led)` before the function reaches:
  ```js
  if (!LIVE) { console.log('\nDRY RUN. Re-run with --live to move funds.'); return }
  ```
  So running without `--live` is not side-effect free on the ledger.
- Impact: A dry run, which an operator reasonably expects to be read-only, can close or alter open-cycle bookkeeping. It does not sign a transaction, but it changes the record the alarm and `--audit` rely on.
- Evidence if right: Run `node bank/revenue.mjs` with a ledger containing an open cycle that returned cbBTC and has a discoverable on-chain split. The recovery code writes `splitSig`/`splitFailure` to the ledger and saves it even though no `--live` was passed.
- Fix: If `!LIVE`, either return before the recovery mutation block and label recovery as `--live`-only, or add an explicit `--recover` mode. Dry/probe/audit must not write cycles.

No defect found in the core swap judge or the Pyth/Orca/Meteora account checks in this pass.

---

### R6. The gates

No new gate failure found. The floors are equality floors; the repeated “litter check looks somewhere real” and “searched tree actually contains what it claims” arms are load-bearing. The main residual is that the C5 page contract is armed only in prose, not in a landed redemption client.

---

## The four accepted-limit questions

1. **Is any limit WORSE than stated?**
   - Yes: C5. The accepted text says the page can sweep the balance and leave the account undeclared. The shipped helper cannot do that; it always closes. So the page contract must be written differently or the helper must change. Until then, the accepted limit understates the remaining griefing surface.

2. **Is anything listed as a limit not actually a limit / already closed?**
   - The round 35 “orhpans/bricked forever” text in SPEC and the holder guide was corrected. The rescue mechanism does close the old permanent orphan state. No item in the accepted list appears to be an already-closed defect still carried incorrectly.

3. **Is any DISCHARGED item not actually discharged?**
   - C5 is the closest one, but it is not in the DISCHARGED list; it was triaged and then handled only in documentation. The actual execution path is still missing/misdescribed.

4. **Is any OPEN AND BLOCKING item quietly treated as accepted?**
   - Yes: item 50’s redemption-client requirement is treated as “the page will do C5 later,” but the description is technically impossible with the current helper. The fix must be a real helper change or an explicit page rule to ignore/deal with these accounts. The holder guide and SPEC should not record the false “sweeps its balance” behavior as solved.

---

## Other off-chain finding

**Finding E — MEDIUM — `bank/redemption-poster.mjs` crashes on a redemption whose `VaultRecord.level` is still 0, stalling the poster until a human intervenes**

- Construct: `bank/redemption-poster.mjs`, `main()`:
  ```js
  const p = draftPost({ mintIndex: Number(rec.mint_index), level: rec.level,
    released: releasedFromTx(tx, vaultPda), blockTime: s.blockTime, signature: s.signature })
  ```
  `draftPost()` explicitly throws when `level` is not 1..5.
- Gap: A vault can be redeemed before its level has been drawn. Neither the redemption path nor `retire_redeemed` requires `VaultRecord.level != 0`. When BURN emits `CBOB_REDEEMED`, the poster reads the still-unrevealed record, throws, and exits with process status 3.
- Impact: The cursor is not advanced, so the same redemption is re-read next run and throws again. Every later draft for newer redemptions can also be blocked behind this transaction until the record is revealed or the queue is cleared by hand. The public-post guarantee is lost exactly when the poster should keep running.
- Evidence if right: Redeem an unrevealed vault on the local validator; run `bank/redemption-poster.mjs` scanning that signature. The process emits `CBOB REDEMPTION POSTER FAILED` and does not write an advanced cursor.
- Fix: In `main()`, handle `rec.level === 0` as a `REJECTED` queued post rather than calling `draftPost`. The queue entry should record the signature and say the level was not yet drawn and a human must draft or re-run after reveal. The cursor must still advance past the scanned transaction.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch?

- **Build a real, landed redemption client first.** Do not launch on a promise that the page will later do C5 correctly. The page must be exercised against every hostile PDA-owned account shape: foreign close authority, frozen zero-balance, delegate, Token-2022, and nested foreign asset. The current “sweeps and leaves undeclared” text is not a substitute for a landed transaction proving the path.
- **Add a local validator test for the unrevealed-redemption poster path.** This is a small, real gap in the automation and it is not covered by the current 23 poster copy assertions, because those test `draftPost` and not `main()`’s record-read path.
- **Make the revenue dry-run side-effect-free and enforce it with a test.** A dry-run that edits the ledger is the kind of off-chain state mutation that no immutable program can catch; the ledger is the whole evidence base for the trusted hop.
- **Decide the helper-vs-page fix for C5 before item 50 is called done.** If the design is to leave the account undeclared and burn it, then SPEC, the holder guide, and `judgeRedemptionCoverage` must all say so, and the page must not try to sweep it. If the design is to sweep it, the helper must learn to skip close when close authority is foreign. Do not leave both interpretations in the same codebase.
- **Re-run the rehearsal at the final commit with the current `run-tests.sh`, including the swap fork and mainnet probe, after any helper or page change.** The floors are only meaningful if the tested bytes are the shipped bytes.