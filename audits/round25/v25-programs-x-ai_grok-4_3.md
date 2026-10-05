**R0. ROUND 24'S REPAIRS**

**Finding (LOW, evidence gap):** The `BoostTermsMoved` weight and epochs legs are never exercised.  
Exact construct: `mint_vault` path in `tests/3prog.test.ts:2713-2719` (and `boost_vault` at MINT:1473) only ever refuses on price; `min_weight`/`min_epochs` are defaulted to permissive values in `ixBoost`.  
Attacker/accident gain: A change that silently drops the weight/epochs check would stay green.  
Evidence that would exist if true: A test that posts a vote lowering weight or epochs, then attempts a boost signed at the old `min_*` values and asserts `BoostTermsMoved` + unchanged supply. No such arm exists.  
Fix: Add the arm (price stays, weight/epochs move against the signer).

**Finding (LOW, evidence gap):** The boost ring wrap past 64 is driven only by host-test hand-edits, never through the program's own index paths.  
Exact construct: `tests/3prog.test.ts` (host unit tests) and `MINT:3022-3032` write `boost_expiring[end % 64]` directly; `boost_vault` (MINT:1509-1511), `unschedule_boost`, and `expire_boost` never execute with `dist_epoch > 64`.  
Attacker/accident gain: A wrap bug (double-expiry, lost count, or `BoostsExpireFirst` bypass) would be invisible.  
Evidence that would exist if true: A run that buys a boost whose `end % 64` wraps, lets it reach exactly `end`, and asserts `due == 1`, `books()` still holds, and no distribution runs while due. No such arm.  
Fix: Drive the paths on-chain with cheap burn-path distributions until wrap occurs.

**Finding (LOW, evidence gap):** The five-kind proposal is created but never executed; the GOV comment claims "six CPIs".  
Exact construct: `BO.28` uses `votes:'none'`; `GOV:196-198` still says "six CPIs".  
Attacker/accident gain: An ordering or skip bug in the five-kind execute path would be untested.  
Evidence that would exist if true: An executed five-kind proposal (all five actions land, CU recorded).  
Fix: Execute it; correct the comment to "five CPIs".

**Finding (LOW, evidence gap):** The Test Vault simulation contains no $CBOB boost and its comment is stale.  
Exact construct: `sim/test-vault.ts:127` ("$CBOB does not exist on mainnet yet") and absence of any `boost_vault`/`SetBoostTerms` call.  
Attacker/accident gain: A boost interaction that breaks the simulation would be invisible.  
Evidence that would exist if true: A boost, two distributions at boosted weight, expiry, and `books()` check inside the sim.  
Fix: Add the sequence; update the comment.

**Finding (DOC-ONLY):** Three holder-guide sentences are false and one is false in the harmless direction.  
Exact construct: HOLDER-GUIDE:38 ("nudge slightly"), :137-138 ("one attempt… trying again works"), :27 ("Not Gary Club"), and the boost-terms refusal wording.  
Attacker/accident gain: Holders act on incorrect expectations.  
Evidence that would exist if true: The sentences match the code and accepted limits. They do not.  
Fix: Correct the sentences to match SPEC 26, limit 41, and the one-sided `BoostTermsMoved` rule.

**R1. CUSTODY**

No new defects found beyond the already-accepted limits (off-curve owners, undeclared airdrops/nested assets, bare Core burns). The open↔burn pairing, emptiness proof, and `lamports == 0` check remain intact at `6e521db`.

**R1s. THE SWEEP HELPER**

No CRITICAL or HIGH defects. The helper is stateless, requires the asset-signer PDA signature (only reachable via Core `ExecuteV1` for the owner), refuses non-token sources, refuses the asset-signer as destination, and empties the PDA before BURN sees it. Evidence gaps exist for duplicate pairs, non-ATA destinations, and the exact byte/CU fit of a three-reserve redemption through the helper (measured only for the old owner-instruction shape).

**R2 / R2b. COMMUNITY POOL + $CBOB BOOST**

Pool solvency, carry on weight change, ring exclusivity (epochs ≤ 63), and `BoostsExpireFirst` all hold. The only issues are the evidence gaps already listed under R0.

**R3. LEVEL DRAW**

The three-group entropy, FIFO, reschedule-on-lapse, and positive burn check (`Key::Uninitialized`) are intact. The only issues are the evidence gaps and the holder-guide wording already listed.

**R4. GOVERNANCE**

Half-of-all-vaults, unbundled key changes, notice period, `CBOB_ACTION_SKIPPED` on overtaken actions, and `KeyChangeNeedsHalf` all hold. No new defects.

**R5. CHARTER CLAIM**

The Merkle check, CPI burn, `pob_extra` pass-through (never as signers), and clock-only refusal outside the window are intact. The hot-wallet consequence is already accepted limit 46.

**R6 / R7 / R8**

`initialize` values, cross-program raw reads, and suite evidence are covered by the evidence gaps and doc issues already listed. No new program defects.

**Accepted limits — the four questions**

1. Several are worse than stated (A1, A2, A3, A4).  
2. None listed as a limit is already closed by unnoticed code.  
3. No discharged item is quietly re-accepted.  
4. Items 50 and 38 remain OPEN AND BLOCKING and are not being treated as accepted.

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?**

Run a mainnet dress rehearsal with the exact launch values from `launch/mainnet-init.json`, real (small) cbBTC and $CBOB amounts, the real swap operator key, the real guardian key, and real holder wallets performing the four actions (claim, activate+claim, vote, redeem) while the crank and alarm run live. Capture the full transaction logs, alarm pages, and on-chain state deltas. This is the only way to exercise the live-network I/O paths, the exact launch-value interactions, and the human-in-the-loop failure modes that no simulated validator or dry-run can produce. Do it after the freeze but before the upgrade authority is removed.