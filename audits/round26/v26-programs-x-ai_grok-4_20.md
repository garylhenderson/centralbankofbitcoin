**Verdict: NOT CLEAN.** No program defect survived measurement, no finding is CRITICAL or HIGH, and the one CRITICAL and three HIGHs raised were refuted (W1 on mainnet, W2 by construction). It is not clean because:

- **Four holder-guide sentences are false** (D1–D4).
- **BUYER-FACING limits 25, 39 and 40 are absent from or stripped in the guide**, and the two hot keys are undescribed (D5).
- **Round 24's evidence repairs are incomplete** while the freeze log records them as done (N1, N2).
- **The sweep helper's one trust dependency, and most of its branches, have no arm** (N3, N4).

The two-round counter stays at 0 of 2.

### Confirmed findings (6)

**N1 (LOW, evidence).** Round 24's C2 repair is half-done. The host ring test still writes `boost_expiring[end % 64]` by hand. `unschedule_boost`'s not-due branch (an early retirement of a boosted vault) is never driven past a wrap.  
*Evidence that would exist:* host test calls the program's own `join`/`reweigh`/`retire`/`expire`/`credit`/`tick` across 260 epochs (four wraps), copying the handler's inline purchase scheduling and checking every ring slot against records; on-chain wrapped early retirement checks the ring and books. (Suite arms BO.34–38 and host test in MINT:3028–3042 at `2b67fb1` do not do this.)

**N2 (LOW, evidence + record accuracy).** Round 24's evidence repairs are partial, and the record says they are complete.  
*Evidence that would exist:*  
- P.11a fails unless `picks.length === 5`.  
- S7.4 asserts `paid ∈ {avail−1, avail}` with only the Test Vault joined.  
- 3.7 pins the frozen-plugin rejection (or adds the decoded-state read).  
- Titles and pins: 5.2/10.2 reworded; S7.2! pinned to one reason.  
- RL.7 stamps live supply at each write.  
- Five of six C9 orderings (crank/pair overlap, expiry + frozen destination, two redemptions landing at cap ≥ 2, older `TightenSweep` after newer, `books()` outside BO).  
- Round 24's five pins: owner `AddExternalPluginAdapterV1` refused `NoApprovals` (including AgentIdentity), `Brakes{Some(default)}` ≡ `None`, v0+LUT redemption lands, `[distribute, boost]` ends at e+1+N, `activate` with its own record refused `NotRevealed`.  
- Comment fixes: test-vault:127, GOV:196-198.  
(FREEZE:514 still says "C1-C10"; suite and sim at `2b67fb1` miss these.)

**N3 (LOW, evidence).** The helper's whole access control is Core's `ExecuteV1` authority rule on a **thawed** vault. No arm attacks it in that state.  
*Evidence that would exist:* inside a genuine `open_for_redemption` for alice's vault, Core `ExecuteV1` into the helper with `authority = bob`, then with the collection's update authority, then with a Core transfer delegate the owner added. Each refused by **Core** (`0x1a` NoApprovals), and the vault still holds everything (balances, owner, seal). (SR.5–5e at `2b67fb1` test only frozen or non-thawed cases; Core `e72d63e` asset.rs:334-337 and collection.rs:294-301 confirm the rule.)

**N4 (LOW, evidence).** The value-moving helper has five arms, and many branches are never exercised.  
*Evidence that would exist:* one arm per branch, each pinned to the exact `CBOB_SWEEP refused` text or program error: data ≠ [0]; odd count; wrong token/system program; `dest == signer`; source not owned by signer; mint mismatch; duplicate source; zero pairs (lamports-only lands); frozen source (reverts). SR.4a cannot fail (asserts >500k but measured 4.67M; SR.4's `getBalance(T.pda)==0` pins the leg). SR.2's title overstates (refusal is pair consistency, not owner binding). (SR.0–SR.4a and S8.0–S8.3 at `2b67fb1` miss these.)

**N5 (INFO, evidence).** The redemption's byte headroom and compute are not asserted.  
*Evidence that would exist:* S8.0 asserts `B ≤ 1232 − 52 − 96` and prints it; S8.1 records `meta.computeUnitsConsumed` (measured 168,343 CU at `2b67fb1`). SPEC moves both numbers into item 50. (S8.0–S8.1a at `2b67fb1` assert only `B ≤ 1232` and leave CU unrecorded.)

**N6 (INFO).** `build-mainnet.sh` compares the helper's mainnet bytes against its own `$CACHE/ln` rebuild, not against the `target/deploy` file the suite deployed.  
*Evidence that would exist:* `build-mainnet.sh` also runs `cmp "$OUT/cbob_vault_sweep.so" "$ROOT/target/deploy/cbob_vault_sweep.so"`. Suite log records the sha256 of each deployed `.so`. (At `2b67fb1` the bytes are identical, but no gate records it.)

### Accepted limits (none materially worse than stated)

- **Limit 9/44 (undeclared airdrops/nested vaults destroyed):** narrower than stated for classic SPL (helper sweeps any classic account when named with same-mint destination). SPEC and item 50 updated (D7).
- **Limit 10 (swap operator):** the one trusted hop. The judge now requires the exact seven-instruction sequence built by `swapInstructions` (round 25 L1 selftest). Output floor from Pyth (≤180 s old, ≤0.3% confidence, `MAX_ORACLE_CONF_BPS=30`). Throughput ceiling and capped-sweep non-paging unchanged. Hand recovery of open cycle documented. Operator wallet must hold only cycle funds (no on-chain enforcement). Detection half does not survive box compromise.
- **Limit 13 (level immutable only until upgrade authority removed):** still true; alarm pages `program_not_locked`.
- **Limit 25 (minter can let draw lapse for re-roll):** still true; alarm pages on reschedule and stalled queue.
- **Limit 26 (C's leader can grind):** still true; no VRF.
- **Limit 27 (claim between bare burn and retirement pays dead account, join adds dead weight):** crank now skips positively burned vaults.
- **Limit 28 (Coinbase can freeze cbBTC accounts):** frozen pool no longer locks vaults (forfeit to pool, logged `CBOB_REDEEMED_POOL_FROZEN`).
- **Limit 29 (only cbBTC splits):** still true.
- **Limit 32 (redemption rate limit queues honest holders):** still true; true rolling window.
- **Limit 34 (ordering per kind):** still true; overtaken action logged `CBOB_ACTION_SKIPPED`.
- **Limit 35 (10% turnout never binds at ruled numbers):** still true.
- **Limit 36 (in-line monthly skipped by early/empty/waiting/DUE boost):** still true; alarm pages `distribution_overdue`.
- **Limit 37 (every host carries the pool):** still true; charter claim with `pob_extra > 0` sends no crank.
- **Limit 39 (immutability makes every surviving bug permanent):** still true.
- **Limit 40 (Metaplex Core upgradeable):** still true; N3 adds Execute authority on thawed vault.
- **Limit 41 (leaked custodial key bounded only by redemption cap):** still true; transfers unlimited.
- **Limit 42 (destination ATAs in prior transaction):** still true.
- **Limit 43 (off-curve owner cannot redeem):** still true; alarm pages `unredeemable_owner`.
- **Limit 44 (undeclared airdrops/nested vaults destroyed):** narrower for classic SPL (helper sweeps when named); updated in SPEC and item 50.
- **Limit 45 (no governance with no vaults):** still true; `mint_vault` needs no live vault.
- **Limit 46 (Moments update authority hot, can end project or capture governance):** two bounds added (alarm samples state; key cannot transfer/burn individual PoB). Still BUYER-FACING.
- **Limit 47 (stolen guardian permanent at low turnout):** still true.
- **Limit 48 (charter claim cannot be stopped):** still true.
- **Limit 49 (record rent not refunded):** still true.
- **Limit 55 (vault that joins can share unsplit revenue):** still true.
- **Limit 56 ($CBOB on hot key on this box):** still true; BUYER-FACING.

No limit is worse than stated. All DISCHARGED items remain discharged. No OPEN-AND-BLOCKING item is quietly treated as accepted.

### What this project should do before launch that AI audit structurally cannot

1. **Run the dress rehearsal at throwaway IDs with the shipped off-chain code unchanged** (item 53, road step 8). The rehearsal tree must pass the full `run-tests.sh` (including the live revenue cycle through both pools, one forced post-sweep failure walked through hand recovery, and the alarm in rehearsal mode). Record the signatures. This is the only way to prove the crank, alarm, and revenue pipeline work against a live cluster with ~2,100 vaults.

2. **Build, deploy, and lock the redeem page and deposit-address page** (item 50). The page must run `judgeRedemptionCoverage` before the holder signs, create missing reserve accounts in a prior transaction, offer to trigger/join a payout first (except while pool frozen), sweep through the helper (naming every reserve), set compute-unit limit on any crank-carrying tx (or send none), close emptied reserves, and warn on anything the burn would destroy. It must announce every opening on X and the CBOB website. The holder guide may not be published before this ships. This is the only preventive control on undeclared airdrops and nested vaults (limits 9/44).

3. **Exercise every named item in the dress-rehearsal checklist** (item 22, updated round 25 L5): crank live passes, alarm in rehearsal mode, one full live revenue cycle through each pool (Orca forced to refuse once), one forced post-sweep failure walked through hand recovery, and one DAS read of a collection holding a burned Core asset. Record the transaction signatures. This is the only way to prove the off-chain pipeline against real mainnet state.

4. **Re-run the mainnet probe after the final commit** (item 53, round 24 D5). The rehearsal-tree proof must be re-run at the release commit; the probe must pass its 33/33 assertions (including Token-2022 ATA refusal and classic control for each reserve, and exact recorded freeze authorities).

5. **Finalize and pin the charter opening date and lock deadline** (item 38). Both are still OPEN. The alarm must page CRITICAL past the lock deadline, and in production if it is unset. The holder guide and SPEC must be updated before publication.

6. **Remove the upgrade authority from all five programs** (road step 11) only after steps 1–5 pass. After this, every surviving bug is permanent (limit 39).

These steps close the structural gaps AI audit cannot address: live I/O, the surfaces promised to holders, the final launch values, and the immutable lock. Until they are done, the system is not ready to hold real Bitcoin.