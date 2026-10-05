# Audit report: v6 programs and sweep helper, round 25

**Bottom line.** I found no CRITICAL or HIGH defect in any of the five programs. `bank/*.mjs`, `scripts/cron-install.sh`, `launch/*` and the checker were not in the bundle, so every claim about the alarm, rehearsal tooling and page is stated as "evidence that must exist", not as a finding.

**Method.** I recomputed from source the MintConfig layout (every offset 8 to 1005, space 1261), VaultRecord (221 bytes), BurnConfig (571), GovConfig (94), Proposal and VoteRecord space, SEAL's config offsets, and the sweep helper's token offsets. All agree with the pinned constants in GOV, BURN and the suite. I also traced the pool invariant, the boost ring and the join and retire counters by hand.

## R0. Round 24's repairs

- **C1, C2, C4, C9 (boost evidence).**
  - BO.30 and BO.31 isolate the weight leg and the epochs leg respectively. BO.30a lands a favourable move at the new price. BO.33 and BO.33a cover the post-transfer owner. BO.32 covers the duplicate pair. These close the gaps.
  - BO.34 drives a wrap through the program's own `boost_vault` index. One residue remains: `unschedule_boost`'s not-due branch at a wrapped slot (retire before due, after the wrap) has no arm. The host ring test still writes the index by hand.
- **C3 (five-kind proposal).**
  - E.7 and E.7a now execute it.
  - GOV's comment still reads "Measured in the suite: an every-kind execute is six CPIs". It is false: a guardian change and an operator arm cannot coexist, so the maximum is five calls. INFO. Comment only, so it costs only line numbers.
- **A1 and A6 (MINT's added line).** `line!()` shifts every error site below it.
  - Suite pins use error names, not lines, so they are unaffected.
  - SPEC and the verdicts cite MINT line numbers (for example "1082-1087" and "1636-1640" in limits 45 and 55). They are off by one or more. LOW.
  - **Evidence that must exist:** the alarm's `prog.*.hash` baselines for MINT were captured after the A1 edit. Any baseline recorded earlier is stale and would page every pass. I cannot see that file.
- **Holder guide (A1).** Not fully repaired. See finding D-1 below.

## R1 and R1s. Custody and the sweep helper

I could not break custody.

- **(a) Who can move value.**
  - Called directly, the helper needs the asset-signer's signature, and only Core can give it. Through Core, Execute is approved only for the owner.
  - SEAL's `["seal"]` PDA never CPIs Execute. MINT's PDA and the collection authority are PDAs with no Execute path.
  - The thaw exists only between a top-level `open` and its paired burn, so the helper cannot be reached while the vault is frozen.
  - A malicious program holding a user signer could already do everything the helper does.
- **(b) Pair list.**
  - A duplicate source is refused. After the first close, the account is system-owned with length 0, so `read_token` returns `IllegalOwner` and the transaction reverts.
  - A source cannot be a destination, because `signer != dest` and the owners differ.
  - Native wSOL works. Delegates are harmless to an owner-signed transfer. A stranger cannot set a close authority.
  - A Token-2022 account or an odd list is refused.
- **(c) Destination.**
  - The destination is the owner's choice, which is what the owner signs anyway.
  - A sub-rent lamport transfer fails only if the destination wallet holds 0 lamports and zero pairs are named. With at least one pair, the close rent arrives first.
- **(d) Lamport sweep.**
  - The helper reads `signer.lamports()` after the closes. Closes pay `dest`, not the signer.
  - A stranger cannot add data to a system account. BURN's `lamports == 0` therefore sees exactly what the sweep left.
- **(e) BURN's emptiness proof.**
  - Closed accounts pass because Tokenkeg's CloseAccount assigns the account to System and reallocates it to 0. BURN then skips it on owner, or on `len < 165`.
  - **Dependency:** this works only because Tokenkeg does that. If it zeroed in place, BURN would hit `ReserveNotOurs` on every closing redemption. Arms 3.3a and 4.2 pin the current behaviour.
  - A missing ATA created by a stranger after the page builds the transaction would make BURN refuse. The attack is self-limiting: three mints give at most three failures, and the stranger's rent goes to the redeemer on the retry.
  - A Token-2022 ATA cannot be created for a classic mint, because the ATA program's initialise fails.
  - A non-ATA token account is undeclared, so it is destroyed. It never blocks the redemption.
  - **The only remaining block** is a Coinbase freeze (limit 28).
- **(f) Fit.**
  - S8.0 asserts only `B <= 1232`, measured without compute-budget or price instructions.
  - My count is about 27 keys and roughly 1,070 bytes, so there is likely about 150 bytes of room, but no arm pins that.
  - **Predicted evidence:** an arm asserting at least 90 bytes of headroom, with a limit and a price instruction and a separate fee payer (+96 bytes).
- **(g) Evidence is thin.**
  - SR.0 to SR.4a exercise only these refusals: direct call, wrong destination wallet, the race, and the lamport sweep.
  - **Untested branches:** data byte not 0, odd account count, a wrong token or system program, mint mismatch, a source not owned by the signer, `dest == signer`, a duplicate source, a non-classic account, zero pairs, wSOL, and a frozen source.
  - SR.3 actually fails at Token `CloseAccount` (0xb), not at BURN's `VaultNotEmpty`. It proves "the old sweep fails", not the BURN refusal.
  - Add one arm per branch, each pinned to the `CBOB_SWEEP refused` message or the program error.
  - **Missing arm:** an Execute by a non-owner signer while the vault is thawed, which Core should refuse.
- **MEDIUM (ops and doc): the helper's upgrade authority is a total-loss vector.**
  - An upgraded helper receives the asset-signer's signature in every honest redemption and can route everything elsewhere. BURN would then see an empty vault.
  - SPEC still says the alarm reports "any of the four" programs upgradeable. The rehearsal patch substitutes "the four ids". `launch/mainnet-init.json` has no entry for the helper.
  - **Evidence that must exist:**
    - `detectors.mjs` includes `EB2uVv…` in its upgrade-authority and hash checks, with a selftest arm that fires both ways.
    - `scripts/audit-coverage.sh` lists the helper.
    - A rehearsal map handles the helper's id (the suite hard-codes `EB2uVv…`).
    - A road-step 11 verification reads all five authorities as `None`.
- **LOW: byte identity.**
  - `build-mainnet.sh` compares the helper's mainnet bytes against its own `$CACHE/ln` rebuild, not against the `target/deploy` file that `run-tests.sh` deployed.
  - Add a sha256 comparison to the deployed file, or state that the build is deterministic.

## R2 and R2b. Pool and boost

- **The invariant holds.** Pool ≥ ceil(owed) survives `credit`, `claim`, `retire` (including forfeit and return) and `join`. This follows from `ceil(a+b) ≤ ceil(a)+ceil(b)`, with `delta*w ≤ avail*S`.
- **Owed accounting.** Σ per-vault pending equals `owed_scaled` exactly, through `reweigh`, `expire` and `join`.
- **Counters.** `pending_this_epoch ≤ pending_count` in every ordering. `waiting_to_join` cannot underflow.
- **Ring exclusivity.** Epochs ≤ 63, so the live end epochs in `(dist, dist+63]` occupy distinct residues.
- **Boost count.** An empty tick cannot consume a boost, because a boost needs an active vault and a tick needs weight 0. A boost therefore earns exactly N credited distributions.
- **Liveness.** `JoinWaitingFirst` clears with a free `claim`, which needs no existence check on a pending vault's destination. `BoostsExpireFirst` clears with `expire_boosts`, which needs only records. No one can wedge either.
- **Not a finding.** `boost_vault` after a monthly run that makes boosts due is safe.
- **Accepted, restated.** Boost burn-through by 100 $GARY distributions, and rentable votes.

## R3. Level draw

- **Parse.** `n ≤ 512`, a buffer-length check, and a zero-hash refusal. C ≤ reveal+208 < the window of 300, so a capture inside the window always finds C.
- **FIFO.** I could find no owner action that makes Core's attributes update fail at the head of the queue. Burned vaults are handled. Owner-added extension adapters are refused (fact 12).
- **Hidden mechanics not stated.** The sysvar holds bank hashes, so any user transaction landing in slot B or C perturbs them. This is unknowable in advance, so it is not an exploit.
- **Worse than stated (limit 26)?** No. SPEC 26 is accurate. The holder guide is not (D-1).

## R4 to R7

- **R4.** No minority path or governance freeze beyond what limits 45 and 47 describe.
  - A passed round proposal can be silently voided by executing a later-id passed round first. Both were passed by the community, so I treat it as stated behaviour (limit 34).
  - A key-change majority (at least half of all live vaults) can, over two weeks, retire the guardian and then arm an operator. It must wait for the first change to apply before arming, because the guardian can still cancel during the first notice. That is the "captured vote" case.
- **R5.** SPEC 46 is complete for the window. Individual-asset adapters and per-claimant censorship are the same class.
- **R6.**
  - `sweep_sol_for_swap` is bounded at cap × cooldown windows, so 40 SOL/day at the ruled values.
  - Royalties are authority-`None`, and no instruction adds an asset-level Royalties plugin (R.8).
  - The redemption cap is exactly a rolling window over a 64-entry ring: `kth = ring[(head+64−k)%64]`, with `k` clamped to 64.
  - **Launch-value hazard:** programs accept `redeem_window_secs` from 10 s to 24 h, and an `initialize` transaction is not the JSON. Build the four initialize transactions from `mainnet-init.json` and read the config back on-chain against it before locking.
- **R7.** All offsets verified, as above. Nothing misreads.

## R8. Suite and build

- **ID.1** (unique ids) is a good guard.
- **Weak arms,** all low (C8 was already filed in round 24):
  - 10.2 and X.7 are measurements, not refusals.
  - S7.4 accepts any `0 < paid ≤ avail`.
  - S7.2's reason pin accepts either of two errors.
- **Unproven claim.** `build-mainnet.sh` says it plainly: "NOT PROVEN that the compiled constant IS that key". Nothing else closes it (see the last section).
- **The suite runs the localnet bytes** of MINT, SEAL, BURN and GOV. Only the sweep helper is byte-identical between the two builds (modulo the point above).

## Documents (every sentence versus the code)

- **D-1 (MEDIUM, holder-facing, A1 only partly repaired).**
  - HOLDER-GUIDE's honest list says the last-block validator "can pick among several results… Nobody else can."
  - "Several" understates SPEC 26: best-of-4 by skipping alone is 18.6% for Level V, and about 96% with block-content tries. It gives no magnitude.
  - "Nobody else can" is false. Limit 25 lets a minter, or anyone able to withhold a capture, re-roll a lapsed window.
  - Fix: name both, with the magnitude.
- **D-2 (LOW).**
  - "Every opening is public. It is announced on X and on the Bank's website" is stated as a fact. The poster has no sender (item 50).
  - The line should say "will be", or the on-chain `CBOB_REDEEMED` log should be named as the public record.
- **D-3 (LOW to MEDIUM, boost buyers).**
  - The guide says "the Bank holds all 2.1B $CBOB and releases it". It is a single hot key on a server (limit 56, not marked BUYER-FACING).
  - "It trades only through fixed pools… refuses any price below a floor" describes the software, not the key. The key can move the SOL anywhere (limit 10, also not marked BUYER-FACING).
  - Neither is in the honest list.
  - "The Bank" now names off-chain services and also the program-owned pool. The v6 design has no Bank key, so the word misleads.
- **D-4 (LOW, stale SPEC).**
  - Item 50 and "Known limits" still say the helper is "being built" and "Not yet measured: its arms". SR and S8 now exist.
  - The control table says "any of the four".
  - 9.14a, 9.14b, 9.14d and limit 42 measure the pre-helper shape. With the helper's smaller inner payload, creating the destination ATAs in the same transaction may fit three mints. That would change limit 42. Nothing measures it.
- **D-5 (INFO).**
  - "Anything credited stays yours" omits the sub-sat residue that `retire` returns to the pool (under one sat).
  - The `BadSweepBound` message says "cooldown 1 s to 7 days" but `initialize` caps it at 24 h.

## The four questions about the accepted limits

1. **Worse than stated?**
   - Limit 26's math is right; the guide lags (D-1).
   - Limit 47 is complete. One addition: the guardian is also the single Phantom key that signs `initialize`. A thief holding it can cancel every operator replacement forever. Combined with a stolen operator key, that means no rotation without destroying the guardian first.
2. **Not actually a limit?**
   - Limit 42 may be partly closed by the helper (D-4).
   - Limit 44 and item 9 are unchanged by the helper.
   - No other limit is closed.
3. **Not actually discharged?**
   - Item 54's "discharged" half is true.
   - Items 51 and 53 are fine.
   - Item 38 does not list `cbob_mint`, `max_boost_weight` or `max_boost_epochs` among values to verify, although the JSON has them.
4. **Open and blocking, quietly treated as accepted?** No demotion found. Item 50 is still open, and it is more open than it reads: the helper is built, but the page, the poster and the `judgeRedemptionCoverage` call are not.

## Before launch, what AI audit cannot do

1. **Differential fuzzing of the accumulator.**
   - `credit`, `join`, `retire`, `reweigh`, `expire_boost` and `advance_epoch` are pure functions over structs.
   - Run `proptest` on the host with millions of random operation sequences, checking `Σ pending = owed`, `pool ≥ ceil(owed)`, and weight, ring and due agreement against `accrual.mjs`.
   - The current host tests cover only the ring.
2. **Reproducible builds.**
   - Use `solana-verify` or a pinned Docker build, so any third party can map a deployed hash to a commit.
   - Separately, have Gary sign a throwaway `initialize` from his real wallet against the mainnet-feature bytes on a local validator. That closes "NOT PROVEN that the compiled constant IS that key".
3. **A real-value rehearsal.**
   - The charter window cannot be mimicked; item 22 and the swap-fork gate say the same.
   - Run the actual crank live for a month against a live cluster at throwaway ids, with small real cbBTC, real Orca and Meteora swaps, and a real Squads receiving the 15%.
   - Include a deliberate Coinbase-freeze drill if one can be arranged on a test mint, to observe the unfreeze path.
4. **Key custody the code cannot enforce.**
   - Guardian and `INIT_AUTHORITY` should be a hardware wallet, not a Phantom hot wallet.
   - The Moments update authority should be cold or in a multisig through the 7-day window (a ruling; I report only that it is the largest unmitigated exposure).
   - The $CBOB release wallet should leave the box.
   - The alarm and its ledger should run off-box. Today the same user who can write the ledger can stop the alarm.
5. **Human review of the small trusted surface.** Two or three independent people should read the sweep helper (60 lines), SEAL (about 150) and BURN's emptiness proof, and sign a statement. A human can read this much; no model can be held to account.
6. **Staged exposure within the rulings.**
   - Keep the upgrade authority until after the first round's price is set, if the lock deadline allows.
   - Cap the first sale round small.
   - Publish a bug-bounty address with real funds in a vault.
   - All five authorities must read `None` before any holder deposits, with an independent party running that check.