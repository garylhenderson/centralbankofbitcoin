## R0. Round 36 verdict and repairs

Round 36 was NOT CLEAN on both passes, quorum met, nothing confirmed in the five programs. Both verdicts bundled.

Independently verified at this tree:

* **H1 HIGH repaired.** `web/src/lib/reads.mjs:190` now records `ownerAtaFrozen` and `mintFreeze`; `web/src/lib/plan-redeem.mjs:150-168` treats a stray whose mint anyone can freeze, whose destination is frozen, or whose mint is unreadable as `cannot`, names it in an `ack` box and never sends it. Reserves are exempted. `plan.test.mjs` R36-H1 arms drive it both ways.
* **L1 repaired.** `web/deploy/rpc-proxy.mjs:91-100 txRefusal` returns `null` only with a CBOB program present, otherwise only ATA-create-only, ceremony collection-create with `MINT_AUTH`, or System-to-`REVENUE`. `proxy.test.mjs` L1 arms refuse a bare System transfer and bare SPL Transfer.
* **L2 repaired.** `web/src/pages/redeem.mjs:170-189 payoutBlock` reads `waitingVaults` and `dueBoostRecords` and builds `planPayout` which expires first. `plan-redeem.mjs:200 planPayout` order is expire, join, distribute.
* **L4 repaired.** `web/build.mjs:47-52` refuses unless `dist/MANIFEST.txt` is clean build of `RELEASE_COMMIT=0b3ddb3` and sums equal pins. `bundle.test.mjs` L4 arms refuse another commit, dirty tree, wrong MINT sum.
* **L5/I1/I2 repaired.** README hash table covers `mainnet` and `mainnet-local`, ceremony footer points at it, ceremony text says step 11 makes final, SPEC C5 and item 38 list `vault_collection` OPEN.

No re-file: no surviving H1/L1/L2 bypass found in `plan-redeem.mjs`, `reads.mjs`, `rpc-proxy.mjs`, `redeem.mjs`.

## R1. Custody pairing and emptiness

`programs/cbob-vaults/src/lib.rs:open_for_redemption` scans forward from `current+1` for `BURN_PROGRAM_ID` + `IX_BURN_VAULT_DISC` + asset 0 + owner 2. `programs/cbob-vault-burn/src/lib.rs:burn_vault` scans `0..current` for `SEAL_PROGRAM_ID` + `IX_OPEN_FOR_REDEMPTION_DISC` + asset 0 + owner 2. Both use `load_instruction_at_checked`, top-level only. Both bind asset AND owner.

No surviving theft path found:

* CPI wrapper shapes still refuse `NotFromBurn` / `NoTerminalBurn` / `NoPrecedingOpen` by stack height and top-level program id. A wrapped open reports the outer index; a wrapped burn is invisible to SEAL.
* Two vaults in one transaction pair independently. Re-using one open for a second burn fails at the second `BurnV1` because the asset is already a 1-byte tombstone.
* `declared` mismatch, bogus `seal_config`, wrong collection, non-owner all refuse before value moves.

Emptiness: PDA lamports `==0`, every reserve ATA under both token programs declared, PDA-owned, `d[72..76]==0`, `d[121..129]==0`, `d[129..133]==0`, `len==165`, `amount==0`; declared Core accounts refused if `d[0]==1`; declared token accounts owned by the PDA refused unless `len==165` and empty with no delegate/close. Token-2022 `170` refuses `ReserveHasExtensions`. A closed source is System-owned and skipped for the right reason.

## R1s. Sweep helper

`programs/cbob-vault-sweep/src/lib.rs:process`:

* (a) Direct call needs `signer.is_signer`. Vault PDA signer exists only via Core `ExecuteV1`, which the suite pins to owner-only `0x1a` on a thawed vault, stranger and transfer-delegate refused, collection PDA off-curve. No update-authority, delegate, freeze PDA or collection authority path reaches it.
* (b) Odd/zero pairs, wrong Token/System id, `signer==dest`, foreign source, wrong-mint destination, duplicate source all refuse with the measured errors. Duplicate closes the first, second reads System-owned and refuses `IllegalOwner`. Frozen source with balance refuses `0x11` in Token and reverts whole opening. Kept close-authority refuses `0x4` on close. wSOL/native, non-ATA classic all handled as classic accounts.
* (c) Destination is the caller's choice. Given (a) only the owner reaches it through Core, this is no new capability. Lamport credit to a non-System account succeeds as lamports; token data untouched.
* (d) `signer.lamports()` read at execution, System transfer to zero. A later instruction in the same transaction depositing to the PDA after `burn_vault` passed its check would strand the attacker's own lamports behind a burned asset. No theft. `BURN lamports==0` sees exactly the sweep result because sweep precedes burn.
* (e) Missing reserve ATA: page creates in prior transaction. Stranger-created classic ATA/non-ATA is nameable and swept live. T22 ATA for a classic mint refuses `IncorrectProgramId` at creation, probed. Non-ATA T22 owned by PDA cannot be swept (`InvalidAccountData`) and reverts if named; left undeclared it is destroyed, accepted limit 44. No account exists that is both unnameable and unskippable for classic reserves.
* (f)(g) See R8 finding below on packet vs compute. SR.0-SR.4a, SR.6-SR.14, SR.13, R36.C5/G2a/G2b all pin the named reason. `scripts/build-mainnet.sh` `cmp`s `dist/cbob_vault_sweep.so` to localnet build and to `target/deploy` build.

No value-movement defect found.

## R2. Pool invariant

`credit`, `claim`, `retire`, `tick`, `monthly_inline` preserve `pool >= ceil(owed_scaled/ACC_SCALE)`:

* claim pays `floor(pending/SCALE)`, `owed` falls by `pay*SCALE`, balance falls by `pay`.
* distribute adds `floor(avail*SCALE/w)`, `owed+delta*w <= bal*SCALE`.
* retire forfeit or bare return subtracts `pending` from `owed` with balance unchanged.
* frozen pool forfeit logs `CBOB_REDEEMED_POOL_FROZEN`, monthly never credits from frozen pool.

Counters `pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight` checked on every path. Join-only claims bypass frozen-pool block. `expire_boosts` needs records only, so a missing `vault_ata` never blocks expiry. No permanent distribution block found.

## R2b. Boost

`boost_vault` end `= dist_epoch+epochs`, ring `end%64`, `reweigh` moves `owed` to `carry` and restarts `debt=w*acc`, `owed_scaled` unchanged. `advance_epoch` makes due at exactly `end`. `BoostsExpireFirst` + `monthly_inline` wait + `claim` expiry enforce exactly N distributions. `unschedule_boost` branches on `dist_epoch>=end`. Ring max `63` prevents two live not-due ends sharing a slot; due vs ring accounting `ring+due==active` holds. No double/early/never expiry: `expire_boost` requires due, zeroes weight, `retire` unschedules. Host unit test drives 260 epochs through the program's own `join/reweigh/retire/expire_boost/credit/tick` against a record model.

No loss/gain on weight change found.

## R3. Draw

`blockhash_in_window` pins sysvar id, `n<=512`, buffer length, refuses zero hash, takes smallest produced in `[want,want+64]`. `try_capture` chains A then B/C each `(slot/4+2)*4`, deterministic, `NotYet` if any missing, `Expired` past 300. FIFO `index==revealed_total`. Burned head still draws and advances, Core write skipped on positive `Key::Uninitialized` tombstone. Attributes hash-checked. Reschedule only past window to `now+16`, logged. Leader-grind, re-roll-by-silence, cohort sharing remain as stated in limits 25/26, not worse.

## R4. Governance

Snapshot `quorum_supply=minted-burned-bare`, `index_snapshot=minted_total`, rule copied. `VaultTooNew`, `CharterNotClosed`, `TurnoutTooLow`, `KeyChangeNeedsHalf`, `KeyChangesBundled`, `Loosening`, `TightenOutOfBounds` at creation; `QuorumNotMet`, `ThresholdNotMet`, `ProposalExpired`, per-kind skip with `CBOB_ACTION_SKIPPED`, `StopIsNewer` mirroring MINT. No minority key-change path, no money reach beyond rounds/restarts/tighten/operator/boost-terms, no permanent freeze beyond accepted limit 45/47.

## R5. Charter claim

Leaf `sha256(0x00||asset)`, sorted `sha256(0x01||min||max)`, odd promoted, `MAX_POB_PROOF 16`, root equality, live AssetV1 owned by signer in `pob_collection`, CPI `BurnV1` with `pob_extra<=8` passed never as signer. Window by clock only, no guardian gate. Lookalike #241, wrong proof, theft, vault-as-PoB, self `charter` all refuse. SPEC 46 blind spots, sampling, positive bound, end-or-capture consequence all stated. Claim page sends `pob_extra=0`, no crank, refuses external plugin rather than guessing.

## R6. Init and trusted hop

SEAL/MINT/BURN/GOV `initialize` first checks `INIT_AUTHORITY`, then collection-clean-ours-unminted, wiring agreement, payment-is-reserve, tighten bounds, sweep cap/cooldown/reserve, charter window/root, monthly/notice, boost mint/bounds, supply/census. Royalty `AddCollectionPluginV1` 1000bps revenue-100% `None` measured on chain, owner/delegate controls pinned `0x9/0x1b/0x1a`. `sweep_sol_for_swap` pins operator signer, `>0`, `<=cap`, cooldown, reserve, stamps time. Bound is cap x windows until `emergency_stop_sweep`. Rate ring `cap=ceil(live*210/10000)`, `k=min(cap,64)`, `now-kth>=window`, 64 slots cover 3047 live, stricter past it. `redeem_window_secs` floor 10, mainnet must be 3600.

## R7. Raw reads

Recomputed from structs: MINT `governance 41`, `minted_total 141`, `bare 454`, `charter_closes 442`, `sol_reserve 257`, `max_sweep 266`, `cooldown 274`, `sales_stopped 191/518`, `sweep_stopped 192/526`, `floor 631`, `ceil 639/647`, `max_boost 711/712`; BURN `minted 141/bare 454`, `burned_total 42`, `window 50/head 58/ring 59`; SEAL `collection 9/reserves 41`; VaultRecord `index 41/reveal 49/level 57/charter 58/set 59/entropy 60/active 125/retired 126/resched 127/ata 129/debt 161/pending 177/req 178/boost_w 186/end 187/carry 195`; sweep `mint 0/owner 32/amount 64/len 165`. All match pinned constants and `bank/layout.mjs`. Spaces 398/221/827 correct.

## R8 + web/. Findings

**F1 LOW — Default compute budget overstated as 800,000, fit loop checks packet only.**

Construct: `SPEC.md` item 50 “below its legacy default combined budget of 800,000 CU”, `sim/test-vault.ts:S8.1a` and `tests/3prog.test.ts` checks `cu < 4*200_000`, `web/src/lib/plan-redeem.mjs:build/legacySize` drops strays only while `size>1232`.

What gains: no theft. Accident: a redemption that fits 1232 bytes but costs 200k–800k CU would pass the page/suite gate and fail on chain without a compute-budget instruction. The page sends no compute-budget instruction on redemption. Solana default is 200,000 CU per transaction, not per instruction.

Evidence if true: Solana docs/default; simulate a 500k-CU redemption without CU limit, it fails; with the suite's `cu<800k` gate it would be marked pass. S8.1a 168,343 CU and W5 180,852 CU both still fit the true 200k, so current shapes land, which is why this is LOW not blocking.

Fix: correct SPEC to 200,000; tighten S8.1a/W5 gates to `cu<200_000`; add a CU estimate to `planRedemption` fit loop or set a compute-unit limit on redemption when strays/C5 transfers raise cost, or prove the max packet-fitting shape stays under 200k and pin it.

**F2 LOW documentation-only — Holder guide announces what the poster cannot send.**

Construct: `HOLDER-GUIDE.md:Things to know before you open / Every opening is public. It is announced on X and on the Bank's website.` vs `bank/redemption-poster.mjs` drafts only, no sender, item 50 OPEN, pages staged not published.

Gain: holder confusion, no money movement. Evidence if true: run poster, it queues drafts and states needs Gary go-ahead + website surface not chosen; no transaction posts.

Fix: qualify guide as future (“will be announced once…”) until sender + surface ship; do not publish DRAFT guide before item 50 closes, as SPEC already requires.

## Accepted limits — four questions

1. **Worse than stated?** No. 25/26/28/32/40/41/43/44/46/47/55 re-checked against code and suite arms; grind, freeze, cap, Core-upgrade, transfer-unlimited, off-curve, destroy-vs-rescue wordings hold.
2. **Listed but not a limit / already closed?** No. Each ACCEPTED item still needs its stated control; DISCHARGED 51/54/12/14/19/30/31/33 and v5 Bank/deck items are gone with the thing they were about.
3. **DISCHARGED not discharged?** No.
4. **OPEN treated as accepted?** No. 22/38/50/52/53 remain OPEN in SPEC and block mint; guide stays DRAFT until 50 ships.

## Else

No program value path confirmed. Web offline 518/518, detectors 920/920, launch 49/49 behind equal floors; e2e drives pages' own builders byte-identical to suite/sim builders.

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS AND PROGRAMS WILL BE IMMUTABLE, what AI audit structurally cannot do before launch

* Sign each page with real Phantom desktop + mobile and confirm `signExact` never refuses an honest wallet (U1). One signature per page on dry run.
* Run the dress rehearsal at throwaway ids: crank live passes with ~2,100 vaults, alarm in `CBOB_ALARM_REHEARSAL=1` with separate router state, one full revenue cycle through Orca and one with Orca forced to refuse so Meteora runs, one forced post-sweep failure walked through hand recovery to `--audit` clean, plus DAS burnt-asset read. Record signatures. Items 22/53.
* Drive a real Squads v4 return of a rescued vault that CPI-signs Core `TransferV1` (U2), and a guardian/operator key-change week with cancel covered.
* Build `dist/` from the release commit on two machines, compare `SHA256SUMS`, dump placeholder ProgramData, extend/upgrade, check prefix-hash + zero-tail, then ceremony road step 10 on local validator with every field re-read, resume, and second-initialize refusal.
* Load the RPC proxy with stranger transactions and confirm provider credit/attribution stays bounded, rate limits key IPv6 /64, and no plain transfer relays.
* Run metadata cron for a week against lagging RPC and confirm never-backwards, fail-closed, slot-state outside public dir.
* Have a human read every holder sentence against the shipped page and confirm understanding, not just truth.