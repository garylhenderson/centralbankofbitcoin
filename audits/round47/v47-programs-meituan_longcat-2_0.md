# Round 47, PROGRAMS pass: LAUNCH-CLEAN; QUORUM MET

**Audited head:** `487a8b4` (the tree round 46 prepared). **Programs equal `RELEASE_COMMIT` `0b3ddb3`** (`git diff --quiet 0b3ddb3 487a8b4 -- programs Cargo.toml Cargo.lock` exits 0). The five programs are unchanged since round 27 and byte-identical to the stripped release build `d2ae5fc`.

**Verdict: LAUNCH-CLEAN.** 0 CRITICAL, 0 HIGH, 0 MEDIUM. Nothing in the five programs, no value path, no refused crack. Under SPEC ship gate 3's launch gate (RULING, Gary 2026-10-08) the pass is LAUNCH-CLEAN.

**Quorum: 1 of 1 (this seat).** The programs pass needs two consecutive clean rounds on different rosters; this is the first.

---

## R0. Round 46's verdict and its repairs

I read `audits/round46/VERDICT-programs.md` and `audits/round46/VALIDATION.md` in full and checked every confirmed repair against the code at `487a8b4`.

**V46-1 (multi-send resumability).** Repaired. `rehearsal-steps.mjs` now marks every step whose run is idempotent on read-back as `resumable` (`rescue`, `revenue-forced-failure`, `sale-round`, `deposit-activate`, `revenue-cycle-n`, `ceremony-collection`, `crack`, `sweep-back`). `nextAction` returns `run` under `--resume` for those. The two non-resumable steps (`ceremony-values` and `verify-configs`) send nothing or are rechecks. **Holds.**

**V46-2 (values re-filled before road step 10).** Repaired. `ceremony-values` re-fills `charter_opens_at` and `init_authority` right before the ceremony, and `rehearsal-run.mjs` judges freshness with `judgeValuesFresh`. The charter clock no longer starts before the deploys. **Holds.**

**V46-3 (rescue records the nest).** Repaired. `rescue` sets `st.nestedSent` whenever vault-3's owner is the nest PDA or the treasury, not only on the sending branch. A lost confirmation no longer re-nests. **Holds.**

**V46-4 (hand recovery after a landed swap).** Repaired. `handRecover` reads the operator's cbBTC against `operatorSatsBefore` and continues with the return and split when `pendingSwapSig` landed. An already hand-closed cycle reads done. **Holds.**

**V46-5 (overrides refused on mainnet-local).** Repaired. `web/build.mjs` and `web/src/config.js` now refuse overrides on every profile with `launchJudge === 'mainnet'` (both `mainnet` and `mainnet-local`). **Holds.**

**V46-6 (NOT READY wording).** Repaired. `preflight` returns `null` after the value checks, so a null mint shows NOT READY, not a read error. **Holds.**

**V46-7 (SPEC 53 text).** Repaired. The stale-proof sentence is removed; the `e7c192a` re-proof is recorded. **Holds.**

**V46-8 (mainnet rehearsal init key).** Repaired by Gary's option 1 (2026-10-09). The mainnet rehearsal now deploys the SHIPPING build (`build-shipping`, `upgrade-1..5`), whose `INIT_AUTHORITY` is Gary's wallet, and Gary signs road step 10 on the hosted page (`ceremony-local.mjs`, `--ceremony page`). The driver never signs a ceremony step on mainnet. The local proof (`sim/rehearsal-ceremony-helper.mjs`) stands in for Gary on a local cluster. **Holds.** The mainnet rehearsal record (`audits/rehearsal-2026-10-09/RECORD.md`) shows every step done and the programs closed; item 22.2's FAIL was a true detection of the real Metaplex Core upgrade, not a defect.

---

## R1. Custody

**The seal.** `open_for_redemption` walks the instructions sysvar forward from its own index and refuses unless a `burn_vault` for the same asset and owner follows. `burn_vault` walks backward and refuses unless an `open_for_redemption` for the same asset and owner preceded. Both halves bind asset and owner; neither can be borrowed from another vault's redemption in the same transaction. The walk is top-level only (`load_instruction_at_checked` sees top-level instructions), so a CPI-hidden burn cannot satisfy the requirement. **Sound.**

**The emptiness proof.** BURN requires `asset_signer.lamports() == 0`, every reserve mint's ATA under both token programs declared, PDA-owned, undelegated, extension-free and empty, and no declared account a live Core asset. The reserve list is read from the SEAL config, never kept locally. Token-2022 reserve mints are refused at `initialize` (`assert_classic_spl`), and the emptiness proof demands exactly 165 bytes, so a Token-2022 ATA (170 bytes) or a confidential-balance account is refused. The second loop catches any other token account the PDA owns. **Sound**, with the accepted limitation that undeclared non-token, non-Core accounts are not enumerated (proven impossibility 2).

**No Bank co-signature.** The owner's signature plus the programs' rules are the whole gate. Everything the Bank's signature enforced (the open/burn pairing, the emptiness proof, the reserve-list check) is now enforced by the programs. **Sound.**

---

## R1s. The sweep helper

`programs/cbob-vault-sweep/src/lib.rs` is a native, stateless program with no key and no config. Called directly it needs the asset-signer's signature, which nobody can give. Through Core `ExecuteV1`, Core signs as the asset-signer PDA and only for the asset's owner (measured, SR.5).

**(a) Access control.** The only signer is the asset-signer PDA. Core approves `ExecuteV1` only for the owner; the collection abstains; the one plugin route that approves anyone else (AgentIdentity) cannot be added by an owner (R24.1a, R24.1c). **Nobody but the owner can make it move value.**

**(b) The pair list.** Each pair is checked: source owned by the signer, destination owned by the one destination wallet, same mint. A source owned by someone else is refused (`IllegalOwner`). A destination not owned by the named wallet or naming a different mint is refused. A frozen source's transfer reverts the whole call (SR.14). A source with a kept close authority cannot be swept at all — the close reverts — and the redeem page moves such a balance with a plain SPL `Transfer` through Core instead (round 35 C5). **Sound.**

**(c) Destination checks.** The destination wallet is chosen by whoever builds the transaction; the program does not compare it with the asset's owner. Given (a), that is safe: only the owner can make the vault wallet sign. A lamport credit below rent exemption to a non-existent account is refused by the runtime (R41.C8a-c); at the floor it lands. **Sound.**

**(d) The lamport sweep.** It moves `signer.lamports()` read at execution, emptying the vault wallet to zero. Inside one atomic redemption nothing can land between this and the burn, so the exact-amount race is closed. BURN's `lamports == 0` check sees exactly what the sweep left. **Sound.**

**(e) Interaction with BURN.** BURN requires every reserve ATA declared and skips an account no token program owns. The sweep closes what it empties; a closed classic ATA is a 0-byte System account, which BURN skips. A reserve ATA that does not exist when the page builds is created in a prior transaction (SPEC item 42). A stranger can create a classic ATA permissionlessly and deposit before the redemption lands, but the sweep moves the live balance at execution, so the deposit is swept out. A Token-2022 ATA for a classic mint is refused at `initialize`; a non-ATA token account is not enumerable (proven impossibility 2). **Sound.**

**(f) Fit.** S8.0 measures the three-asset redemption through the helper, claim included, at 1,061 bytes with the owner as fee payer; with a compute-budget pair (+52) and a separate fee payer (+96) it is about 1,209 of 1,232. **Fits.**

**(g) Evidence.** SR.0-SR.4a and S8.* pin every refusal. The helper is deployed from the same bytes `scripts/build-mainnet.sh` proves (`cmp -s` against `target/deploy/` and the localnet build). **Sound.**

---

## R2. The community pool

The accumulator is `acc_scaled` (u128, units of 1e-12 sat/weight). A distribution adds `floor(avail * 1e12 / total_active_weight)` to it and `delta * weight` to `owed_scaled`. A claim pays `floor((weight * acc + carry - debt) / 1e12)` sats, settles the paid portion into `debt`, and leaves the sub-sat remainder in `carry`. A weight change moves the owed share into `carry` and restarts `debt` at the new weight, so nothing earned is lost or gained.

**The invariant.** `owed_scaled` is exactly the sum of every live vault's `weight * acc + carry - debt` after every money operation. The suite asserts this (`ledger()`, called after every operation in sections IN, 3c, P) and the pool balance never falls below `ceil(owed_scaled / 1e12)` (P.32). **Holds.**

**Counters.** `pending_count` increments on request and decrements on join or retire. `pending_this_epoch` increments on request and resets on `advance_epoch`. `waiting_to_join = pending_count - pending_this_epoch` is the gate on `distribute`. A vault requested in epoch `e` joins once `dist_epoch > e`, so it is excluded from the distribution that followed its request and earns from the next one (stage 3c, red-team 2 finding 5). **Sound.**

**Liveness.** `JoinWaitingFirst` is checked before any `$GARY` is burned, so a distribution is never refused after a burn. The monthly path runs in-line in every host instruction and is time-gated, so a month with no protocol traffic distributes nothing until someone calls it free. Nobody can make distributions impossible for others. **Sound.**

---

## R2b. The $CBOB boost

A boost is bought by burning `boost_price` of the pinned `$CBOB` mint (classic SPL, checked by address and owner) for an activated vault the signer owns (Core owner bytes read at execution). It schedules `boost_weight` extra weight for `boost_epochs` distributions, recorded in `boost_expiring[epoch % 64]`.

**Exact N distributions.** The distribution that ends a boost makes it DUE; the next distribution is refused (`BoostsExpireFirst`) until every due boost is expired. `expire_boosts` is free and anyone's; the crank does it every pass. A boost bought in epoch `e` ends at `e + N` and is due at exactly that epoch, so it earns exactly N distributions. **Holds.**

**No loss or gain on weight change.** `reweigh` moves the owed share into `carry` and restarts `debt` at the new weight. A claim's settlement can leave `debt` above `weight * acc`, which `carry` absorbs. **Holds.**

**Ring agreement.** `boosts_active` counts live boosts; `boosts_due` counts due ones; `boost_expiring[i]` counts live boosts ending at `i`. `ring + due = active` is asserted every distribution and every expiry. The ring wraps past 64 (host unit test N1, 260 epochs). **Holds.**

**No double expiry.** `expire_boosts` skips a record whose `boost_end_epoch > dist_epoch`; `unschedule_boost` decrements the ring or `due` exactly once. A retired or inactive record is skipped. **Holds.**

**No distribution block.** `BoostsExpireFirst` is checked before any burn; `expire_boosts` is free and anyone's; the crank expires every pass. A vault whose token account is gone cannot be boosted (`BoostNeedsActiveVault` requires `require_live_vault`, which reads the asset, not the token account). **Sound.**

---

## R3. The level draw

`capture_entropy` copies the smallest produced slot in `[reveal_slot, reveal_slot + 64]` for A, then B and C each two 4-slot leader groups later. `reveal_level` draws strictly in mint order (`revealed_total`), computes `r = u64le(entropy[0..8]) % sum(remaining)`, and walks the census without replacement. A missed window is rescheduled to `now + 16`, never defaulted.

**SlotHashes parse.** `blockhash_in_window` pins the sysvar id, bounds the count at 512, checks the buffer length, and refuses an all-zero hash. **Sound.**

**FIFO.** `RevealOutOfOrder` is enforced; a burned vault at the head still takes its draw (L.11) so the queue never stops. **Sound.**

**Influence.** C's leader can skip its first slot(s) to move C within its 4-slot group and vary its block's contents, choosing among many draws for every vault minted in the same slot (SPEC 26). This is an accepted limit; a VRF is the only full answer. **Stated.**

---

## R4. Governance

One vault, one vote, bound to the asset (`["vote", proposal, ASSET]`). The electorate is snapshotted at creation (`index_snapshot`); a vault minted during the vote is refused (`VaultTooNew`). Quorum is against the snapshotted live supply, threshold is a share of votes cast, and YES must reach 10% of the snapshot. A guardian change or new swap operator needs YES from half of all live vaults (snapshotted), never bundled with the other.

**Minority carry.** With the ruled 21% quorum and 51% threshold, the smallest passing vote is 10.71% YES, above the 10% turnout floor. A hostile majority can open rounds, set prices, tighten the sweep, and restart stops. It cannot touch the 85/15, the royalty, the 2,100 cap, or any vault. **Bounded by design.**

**Money reach.** A ratified proposal CPIs MINT signed by the GOV PDA. MINT re-checks every value (`PriceBelowFloor`, `TightenOutOfBounds`, etc.), so a proposal MINT would refuse cannot land. **Sound.**

**Frozen governance.** A stolen guardian key can stop sales and the sweep, and re-stop after every restart vote, but a vote that replaces it (half of all live vaults + 7 days' notice) lands and the old guardian cannot cancel it (only a pending operator is cancellable). At turnout below half, the stop is permanent (SPEC 47). **Stated.**

---

## R5. The charter claim

`claim_charter_vault` CPI-burns one Proof of Burn the signer owns, in the window `[charter_opens_at, charter_closes_at)`, against the Merkle root of 240 addresses. The window is fixed at `initialize` and can never reopen. It is not gated by the guardian. `pob_extra` accounts are passed through to Core's burn, never as riders.

**The hot collection key.** The Giraffish Moments update authority can add an external plugin that Core consults on every burn. `claim_charter_vault` passes up to 8 accounts through, so a benign hook cannot brick the claim at the program level (OR.4). A hook that *rejects* still refuses it (OR.5) — that case is the alarm's, by ruling. The alarm pages on any plugin or update-authority change to the collection. **Stated.**

---

## R6. The one-time configuration

Every `initialize` is signed by `INIT_AUTHORITY` (Gary's wallet on mainnet, the seed-7 test key under `--features localnet`) and writes its config once. I re-read every bound:

- SEAL: 1-3 reserve mints, each passed and owned by classic SPL (`assert_classic_spl`).
- MINT: `max_supply > 0`; level caps non-zero and summing to ≤ `max_supply`; charter window 1 s to 90 days and closing in the future; monthly 60 s to 30 days; notice 60 s to 30 days; sweep cap 1-50 SOL; cooldown 1 s to 24 h; reserve ≥ rent; tighten bounds inside their absolute ranges; payment mint a SEAL reserve; `$CBOB` mint classic SPL and not cbBTC or `$GARY`; boost weight 1-12, epochs 1-63.
- BURN: collection matches SEAL's; redeem window 10 s to 24 h.
- GOV: collection matches MINT's; quorum 500-10,000 bps; threshold > 5,000 and ≤ 7,500; voting period 60 s to 30 days.

**The swap operator** is the one trusted hop: destination pinned, cap and cooldown on chain, operator signs, guardian can stop, a vote can only tighten inside the `initialize` bounds, replacement needs half of all live vaults + 7 days' notice. **Bounded.**

**The 10% royalty** is a Core plugin with authority `None`; Core refuses every update and removal, including from the update authority (R.6, R.6a). **Immutable in Core.**

**The redemption cap** is a rolling window over a 64-slot ring of timestamps: a redemption lands iff the cap-th most recent one is at least a full window old. The ring bounds the cap at 64; past it the limit is stricter, never looser. **Exactly a rolling window.**

---

## R7. Cross-program raw reads

I recomputed every offset from the struct definitions and verified it against the constants in the four programs and the test file.

- **MintConfig v6.** `minted_total` at 141, `bare_burns_retired` at 454, `charter_closes_at` at 442, `governance` at 41, `collection` at 9, `pool_ata` at 73, `total_active_weight` at 462, `active_count` at 470, `acc_scaled` at 478, `owed_scaled` at 494, `last_distribute_at` at 510, `sales_stopped` at 191, `sweep_stopped` at 192, `sales_stopped_at` at 518, `sweep_stopped_at` at 526, `pending_swap_operator` at 534, `monthly_secs` at 582, `pending_guardian` at 614, `notice_secs` at 631, `sweep_floor_lamports` at 639, `cooldown_ceiling_secs` at 647, `reserve_ceiling_lamports` at 655, `dist_epoch` at 663, `pending_count` at 671, `pending_this_epoch` at 679, `cbob_mint` at 711, `max_boost_weight` at 712, `max_boost_epochs` at 714, `boost_price` at 722, `boosts_active` at 729, `boosts_due` at 733, `boost_weight_total` at 741, `boost_expiring` at 749. **All correct.**
- **BurnConfig v4.** `burned_total` at 42, `redeem_window_secs` at 50, `rate_head` at 58, `rate_ring` at 59. **Correct.**
- **GovConfig v4.** `quorum_bps` at 41, `threshold_bps` at 43, `min_voting_secs` at 45, `last_round_id` at 53, `last_guardian_id` at 61, `last_arm_id` at 69, `last_boost_id` at 77. **Correct.**
- **VaultRecord v4.** `mint_index` at 41, `level` at 57, `charter` at 58, `entropy_set` at 59, `entropy` at 60, `attrs_hash` at 92, `active` at 125, `retired` at 126, `reschedules` at 127, `vault_ata` at 129, `debt_scaled` at 161, `pending` at 177, `request_epoch` at 178, `boost_weight` at 186, `boost_end_epoch` at 187, `carry_scaled` at 195. **Correct.**
- **SEAL Config v2.** `collection` at 9, `reserve_mints` at 41. **Correct.**
- **Sweep helper token account.** mint at 0, owner at 32, amount at 64, state at 108, length 165. **Correct.**

Every cross-program read is pinned by address, owner, discriminator, and version byte. A wrong offset is a silent misread the type system cannot see; I found none.

---

## R8. The suite, the simulation and the build as evidence

`tests/3prog.test.ts` (912 assertions), `sim/test-vault.ts` (71), and `scripts/build-mainnet.sh` are what the claims rest on.

**Arms that cannot fail.** I looked for assertions whose `want` is always equal to `got` by construction. None found: every negative is pinned to a specific program error code (the `because` list), and every positive reads a value back from the chain or recomputes it independently (e.g. L.3c re-derives the entropy from the raw SlotHashes, L.10 recomputes the draw, P.32 asserts the pool invariant from every record).

**Claims this prompt makes that no arm exercises.** The prompt claims the suite runs against "REAL Metaplex Core cloned from mainnet." The gate in `run-tests.sh` compares the on-chain Core against a hardcoded sha256 pin; it does not prove the pin was ever mainnet's. That is a measurement limit, not a defect, and it is stated (the pin is re-pinned deliberately on every Core move). The prompt also claims "1072 off-chain detector assertions proven in both directions"; I read `bank/selftest.mjs` and confirmed the floor mechanism (`DET_FLOOR=1072`, must equal the count). **No claim contradicts a measured run.**

**Mainnet bytes.** `scripts/build-mainnet.sh` builds both the localnet and mainnet artifacts, deploys each to a validator, and asks each whether it trusts the test key (mainnet must refuse, localnet accept). It then compares the sweep helper's mainnet bytes against the localnet bytes the suite ran. The release build is stripped (`scripts/sbf-strip.sh`) and the verifiable-build workflow (`.github/workflows/verifiable-build.yml`) fails unless the container build, `solana-verify`'s per-program rebuild, and the audited hashes in `web/src/config.js` are one set of bytes. **The deployed bytes are proven to be the bytes the suite ran.**

---

## The accepted limits — the four questions

1. **Is any limit WORSE than stated?** No. I re-read every accepted limit against the code and the measurements. Each is exactly as severe as stated, and the buyer-facing ones are in `HOLDER-GUIDE.md`.

2. **Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?** No.

3. **Is any DISCHARGED item not actually discharged?** No. The discharged items (1a, 1b, 2, 3, 4, 5, 11, 15, 16, 18, 20, 21, 23, 24) are about the Bank key, the co-signer, the deck or the distributor — none of which exist in v6. Item 12/17 (compute) is measured at 10.1-10.6b. Item 14 (duplicate attributes) is closed on chain (`DuplicateAttribute`, 11.4). Item 19 (unlevelled-vault halt) is closed by construction (`activate` refuses `NotRevealed`). Item 30 (85/15 as a vote) is gone with `update_wiring`. Item 31 (31-day branch) is superseded by the monthly `initialize` value. Item 33 (operator notice) is exercised (3c.K5). Item 51 (level-ups) is built as the `$CBOB` boost. Item 54 (compute at widest host shapes) is measured (10.5, 10.6, 10.6a, simulated). All are genuinely discharged.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22 (live crank/revenue/alarm I/O), 38 (launch values), 50 (holder surfaces), 52 (cbBTC accounts must exist before first split), and 53 (dress rehearsal at throwaway ids) are still open and correctly block launch. Item 53's in-tree proof was re-run at `e7c192a` (RC 0) and the mainnet rehearsal ran on round 46's repairs and finished.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Three things this project should do before launch that AI audit structurally cannot:

1. **A live-client redemption on mainnet, with real cbBTC, before the authority is removed.** The suite proves the programs; the simulation proves the life; the rehearsal proves the jobs. None of them proves that the *staged* redeem page (`web/dist/`) builds a transaction that lands on the real programs with real assets. The e2e test (`web/test/e2e-localnet.mjs`) does this on a local validator with the localnet build; a parallel run on mainnet genesis with the shipping build and real cbBTC, signed by a real wallet, is the one thing that would close the gap between "the programs accept the shape" and "a holder can crack a vault open." It is not a program change and would not reset the freeze.

2. **A formal verification of the payout accumulator's invariant.** The suite asserts `pool_balance >= ceil(owed_scaled / 1e12)` and that `owed_scaled` equals the sum of every vault's `weight * acc + carry - debt` after each operation. That is a snapshot check, not a proof that the invariant holds for *all* possible orderings of `credit`, `claim`, `join`, `retire`, `reweigh`, and `expire_boosts`. A mechanized proof (or at least an exhaustive model check of the state machine) is the kind of thing a human firm would commission for a system that becomes immutable, and it is outside what a prompt-bound AI round can deliver.

3. **A key-ceremony dry run that includes the moment of locking.** The rehearsal deploys, initializes, and closes the throwaway programs. It does not perform the one action that makes the real programs permanent: `solana program set-upgrade-authority <id> --final`. A full dress run of road step 11 — dump, check prefix hash and zero tail, confirm verified, set `--final`, dump and check again — on a throwaway program that was just verified, with the real upgrade key, is the only way to be sure the locking step does not fail at the RPC or the CLI after real assets are inside. The programs are already frozen; this is operational, not a code change.

---

## Result

**LAUNCH-CLEAN.** Quorum met (1/1; the programs pass needs two consecutive clean rounds on different rosters). No confirmed finding in (a)-(d). No changes to the five programs are required.