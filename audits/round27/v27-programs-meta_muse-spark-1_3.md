**Independent audit — v6 whole tree, round-26 repairs included.**
No program source changed since `93d04fe`; repairs `8fe3120` are off-chain/docs/fixtures only. Method: read all five programs, recomputed every cross-program offset/space/discriminator, read suite/sim/build scripts whole, checked each round-26 repair at its site.

## R0. ROUND 26 VERDICT AND REPAIRS

Round 26 programs pass was **5/8, quorum 6 not met, NOT CLEAN**. Seven topics, 3 LOW + 4 INFO. All seven repairs hold in this tree:

* **C1 RL.7 overstated cap:** fixed. `tests/3prog.test.ts:206-214` now `getMultipleAccountsInfo([MINT_CFG,BURN_CFG])`, monotonic `minted/bare/burned` bounds, records only when `capAt(lo)==capAt(hi)`, rejects regression/ambiguity/overlap. Pinned by `RL.S1-S6`. RL.7 replays with exact certified caps.
* **C2 five-level fixture:** fixed. `LEVEL_CAPS=[21,21,21,21,21]`, checked unavailable bound 20, `P.2a` asserts it. `P.11a` is a fixed five-level literal, cannot pass vacuously.
* **C3 SR.12a pin:** fixed. `SR.12b` asserts `false==includes('CBOB_SWEEP refused: source')`, i.e. refusal reached the second closed source, not the first guard. `SR.12a` itself pinned to `Provided owner is not allowed`.
* **D1 guide wording:** fixed. `HOLDER-GUIDE.md:138` now says “vaults **minted** during the vote cannot vote,” not “sold.” Transfer-then-vote still refused by existing `VoteRecord` PDA; eligible resale voting is the correct rule.
* **D2 frozen counts:** fixed. `scripts/rehearsal-tree.sh` says five IDs + root = six substitutions; `scripts/run-tests.sh:2` says four programs + helper.
* **D3 unbounded pending:** documented. SPEC MINT table: “no apply-by deadline…until a later vote supersedes it,” guardian can cancel operator not guardian. Distinguished from 7-day proposal window.
* **D4 limit-42 categorical:** corrected. SPEC 42/934-940: narrow owner-payer helper shape with three creates serializes 1,219, so “only two fit” false; padded 1,209+158=1,367 does not fit; prior preparation retained for all page shapes. Offline triage `1,061/1,135/1,177/1,219` reproduced.

No re-file: each verified at site, no surviving defect of that shape. Clean streak remains **0/2**.

## R1. CUSTODY

No theft, no surviving emptied vault found.

* Pairing: `cbob-vaults/src/lib.rs:open_for_redemption` forward-walks top-level only for `BURN_PROGRAM_ID+IX_BURN_VAULT_DISC+asset[0]+owner[2]`; `cbob-vault-burn/src/lib.rs:burn_vault` backward-walks for `SEAL_PROGRAM_ID+IX_OPEN_DISC+asset[0]+owner[2]`. CPI-hidden halves invisible both ways. Both bind asset AND owner. Atomicity: partial sweep fails `VaultNotEmpty`, thaw reverts.
  If bypass existed, `WR.1/WR.2/WR.3` (test-only `tests/cpi-wrapper`) would ALLOW; they REJECT `NotFromBurn/NoTerminalBurn/NoPrecedingOpen` and `WR.4` leaves vault live with funds. `3.9/3.10/4.10` refuse cross-asset/cross-owner. `4.5` PDA 0, `4.4` gone.
* Emptiness: PDA lamports 0, every reserve ATA under both token programs declared/PDA-owned/undelegated/extension-free/empty, no declared live Core asset. Reserve list read from SEAL, no second copy. If incomplete, `9.8/9.10/3.11/4.1` would ALLOW; they REJECT.
* Off-curve owner still bricked — accepted 43, alarm `unredeemable_owner`. `5.2` does not prove it (PDA with `isSigner:false` → `AccountNotSigner`); the property rests on `is_on_curve` panicking on BPF + two top-level signatures. Not new.

## R1s. SWEEP HELPER

`programs/cbob-vault-sweep/src/lib.rs:process`:

* **(a) Only owner moves value.** Direct call needs `signer.is_signer`; sources owned by asset-signer PDA only Core signs for. Through Core, `ExecuteV1` authority measured on pinned binary: stranger `SR.5` and owner-added transfer delegate `SR.5a` REJECT `0x1a NoApprovals`; collection abstains, control `SR.5c` refuses collection update authority, `SR.5d` owner lands. `SR.5b` pins CBOB collection authority to off-curve MINT PDA. `SR.5e` preserves balances/seal/owner. Frozen vault: helper transfer fails, whole opening reverts — cannot be reached usefully outside redemption because seal rejects bare Execute `0x9` (`3.7`).
* **(b) Pairs.** Same source twice `SR.12a` REJECTs (first close, second reread `IllegalOwner`; `SR.12b` proves second-site). Same dest twice with same mint succeeds; with different mints second fails mint-mismatch. Source==dest fails (would need `signer==dest`, refused). Native wSOL: classic 165-byte account, transfer+close succeed. Delegate: owner transfer still succeeds, close succeeds unless close-authority moved (only PDA could move it) — then fail-closed. Frozen source `SR.14` REJECTs `0x11`, opening reverts. Non-ATA classic: allowed if `to_owner==dest && to_mint==src_mint`. Dest==vault signer refused. Dest==other vault’s signer allowed by code — owner’s choice, phishing not bypass; owner signature already authorizes arbitrary SPL/System transfers. Odd count `SR.7`, bad data `SR.6`, wrong token/system `SR.8/SR.9`, foreign source `SR.11`, wrong-mint dest `SR.12` all REJECT.
* **(c) Dest unchecked vs owner.** Safe given (a). Lamport-only to non-existent below rent-exemption refuses System transfer, blocking redemption — page must use existing dest (owner payer exists). Item 50 states it.
* **(d) Lamport sweep.** `signer.lamports()` at execution, emptied to zero. No instruction between sweep and `burn_vault` deposits (page shape fixed); later deposit after burn strands attacker funds only. `BURN lamports==0` sees exactly sweep result.
* **(e) BURN interaction.** Closed accounts are System-owned → skipped for right reason. Missing reserve ATA: helper refuses non-token, BURN demands declaration → refuses. Prior creation (SPEC REDEEMING-1) makes all three exist at build; live deposits then swept. Stranger-created classic ATA with dust swept; Token-2022 ATA for classic mint cannot be created (`IncorrectProgramId` probe); non-ATA classic undeclared invisible (destroyed/stranded, accepted 44); declared with funds blocks until swept. No account stranger can create that neither helper can name nor BURN skips except T22-with-extensions/frozen-stray/nested — stated in 44.
* **(f) Fit.** `S8.0` 1,061 bytes claim+open+3-reserve helper+burn, owner payer, no compute extras. +52 compute pair +96 separate payer ≈1,209/1,232. Not an upper bound for extra rescue pairs — stated.
* **(g) Evidence.** `SR.0-SR.4a`, `S8.*` all specific; `SR.4a` exact lamports math. Helper bytes: `dist==target/deploy==.cache/ln` (`build-mainnet.sh` cmp). No arm that cannot fail found.

## R2. POOL MONEY

Invariant `bal >= ceil(owed)` holds on every path. `credit/delta`, `claim/pay`, `retire/forfeit`, `retire_burned` arithmetic checked; `P.32` + `ledger()` (`BK.*`) assert after every money op. Counters: `pending_count/pending_this_epoch/active_count/total_active_weight` agree on request/join/retire same-epoch vs earlier-epoch (`F21.1/2`, `3c.A5/A6`). Liveness: `JoinWaitingFirst` + `BoostsExpireFirst` delay bounded by supply (2,100 joins, 30-record expiries, anyone can send); no permanent block. No break.

## R2b. BOOST

Exactly N distributions: distribution making `dist_epoch==end` makes DUE, next distribution refused until expired (`BO.11/12/13`). `carry` preserves owed across `reweigh` (`BO.7c/14/37a`); debt restarts at new weight, `owed_scaled` unchanged. Totals/ring: `boosts_active==live count`, `boost_weight_total==sum`, `ring+due==active`, `owed==sum(weight*acc+carry-debt)` — host test 260 epochs/4 wraps + `BO.34/38/38a` wrapped early-retire on chain. No double/early/never expiry (`BO.10b` skips not-due, `expire_boosts` skips retired/inactive/not-due). Token-account-gone vault still expirable via records-only path.

## R3. DRAW

`blockhash_in_window` pins sysvar, bounds count/buffer, refuses zero hash. Skipped slots: smallest produced in `[want,want+64]`. B/C stride `(slot/4+2)*4`. FIFO `index==revealed_total`. Burned head still draws, skips Core write (`L.11`). Attribute hash check (`L.4`). Host slot-skip/model tests 6/6.

**INFO — A/B grind understated.** SPEC 26 centers C’s leader (knows hA,hB). A’s leader varies hA blind, B’s varies hB knowing hA. “Removes every other leader’s influence” true only for non-A/B/C leaders. C strongest, but A/B non-zero. Evidence if worse: A/B block-content variation changing final `sha256(hA||hB||hC||asset)`. Fix: state A/B retain blind/partial choice; no code change (VRF only answer).

Holder guide now says “choose among many results” — true.

## R4. GOVERNANCE

No minority carry: quorum `ceil(snapshot*qbps/1e4)`, threshold YES/cast, turnout `ceil(snapshot*10%)`, key-change `ceil(snapshot*50%)`. At ruled 21%/51% minimum YES 10.71% >10%, turnout floor only matters off-ruled (limit 35). Money reach: only `SetBoostTerms` touches payouts by design (ordinary 10.71% action, bounds fixed). No freeze: guardian stops sales/sweep only; redemption/pool never stopped. Empty electorate → no proposer until open round mints (limit 45, corrected). No bypass.

## R5. CHARTER CLAIM

Address-pinned Merkle (domain-separated, sorted, odd promoted; `pob-merkle --selftest` 14/14), CPI-burns PoB as owner same ix, window clock-only, `pob_extra<=8` never-as-signer. SPEC 46 complete: project-end/capture, benign-hook pass-through (OR.1-6), per-asset blind spot, sampling gap, positive bound (cannot take PoB), packet 4-with-payer/8-with-v0. Nothing omitted found.

## R6. CONFIG + TRUSTED HOP

`initialize` checks: SEAL owner-only + classic-SPL reserves; MINT CBOB-mint/classic/neither-payment-nor-GARY, boost bounds, treasury non-default, notice/tighten/sweep bounds, supply/caps, charter window/root/period, collection clean/ours/unminted, SEAL wiring + payment-is-reserve; BURN SEAL-agreement + window; GOV MINT-agreement + quorum/threshold/window. Wrong-but-accepted (duplicates, SPL-owned non-mint, off-curve roles) is item 38 OPEN, checker pins ruled values — not new. Swap hop bound is `cap × windows until guardian stops`, never vault/pool/sale cbBTC. Royalty 10% authority None proven both directions (`R.5/6/6a/6c`, `R.9`). Cap ring 64 covers to 3,047, stricter beyond; mainnet must be 3600.

## R7. RAW READS

Recomputed MintConfig, VaultRecord (221B), BurnConfig, GovConfig layouts from structs; every GOV/BURN offset (`41/141/191/192/257/266/274/442/454/518/526/631/639/647/711/712`, `42`, `41/49`) and space constant matches chain bytes (`X.1-6`, `3.1w/3c.M1`). Sweep token offsets `0/32/64/165` correct. No silent misread.

## R8. SUITE/SIM/BUILD

844 + 789 + 39 + 22 + 14 + 47 + 6 + 33 + 71 + 16 all behind equal-floors. No vacuous arm: `P.11a` fixed five-level literal, `ID.1` uniqueness, `SR.12b` specificity, `RL.S1-S6` boundary refusals, `X.7` honest empty-queue. Helper `dist==ln==deployed`. `build-mainnet.sh` asks all four mainnet REJECT / localnet ACCEPT. No unproven program.

## ACCEPTED LIMITS

1. **Worse than stated?** No. 25/26/28/32/40/42/44/46/47 all read as measured; A/B grind above is precision, not exploit beyond stated C-choice.
2. **Listed but closed?** None. 35/36/37/39/41/43/45/48/49/55/56 remain real.
3. **Discharged not discharged?** No. 51/54/12/14/19/30/31/33 + v5 Bank/deck items gone with thing.
4. **OPEN treated as accepted?** No. 22/38/50/52/53 stay OPEN, guide DRAFT-gated, rehearsal values/mode still to write.

## OTHER — none above LOW

## GIVEN NO HUMAN FIRM, WHAT AI CANNOT DO

* Run the live dress rehearsal (item 22 + 53): crank 2,100-vault I/O, alarm rehearsal mode, full revenue cycle through Orca then forced Meteora fallback, forced post-sweep failure + hand recovery with `--audit` clean, DAS burnt-asset read. Signatures recorded.
* Close the launch ceremony (38/52): build four `initialize` txs FROM `launch/mainnet-init.json`, set charter date + lock deadline, create pool/revenue/Squads cbBTC accounts, fund revenue above rent, verify `pob_root`, then remove upgrade authority from all five and publish `dist/SHA256SUMS` + manifest. Second-machine reproducible rebuild.
* Build/field-test holder surfaces (50): deposit-address page, `judgeRedemptionCoverage` pre-sign warning, claim-then-sweep flow with frozen-pool branch, prior-creation of missing ATAs, compute-limit handling, rescue-pair packet budgeting, real-wallet (Phantom/Ledger) landing of widest shape + v0 fallback, X/website poster sender.
* Custody reality: move $CBOB release wallet off box or accept hot-wallet risk (56), swap-operator float/top-up discipline + empty-wallet rule, guardian key cold storage + replacement drill at <50% turnout, Moments hot-key monitoring between 30-min samples.
