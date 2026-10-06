## R0. Round 28 verdict and repairs — independently re-checked

Round 28 programs verdict was **NOT CLEAN, INCOMPLETE QUORUM (5/8)**, 0/2 clean. Five confirmed topics: M1 MEDIUM log-truncation, L1 LOW token bytes, D1-D3 INFO docs. Repairs in `de3d56f` claimed.

**R0.1 — M1 repaired, holds. No finding.**
`bank/txread.mjs:validateParsedTransaction` now has `need(!meta.logMessages.includes('Log truncated'),'logs truncated by runtime')` and distinguishes ordinary `Program log: Log truncated`. Scanners must keep cursors on throw. Evidence if broken would be: fixture `tests/fixtures/mainnet-v1.json` with logs replaced by `['Log truncated']` passes validation and a cursor advances. It now throws `unreadable parsed transaction: logs truncated by runtime`. No re-file.

**R0.2 — L1 repaired, holds. No finding.**
`scripts/token-programs.sh` pins all three: Token `8190d3f7…`, Token-2022 `0999dbf7…`, ATA `6804554e…`, matching round-28 Table slot 453760776. `run-tests.sh` + `build-mainnet.sh` `prepare` + `verify` after boot, `expiry-budget.mjs` same. Evidence if broken would be: validator boots with bundled 506,896-byte Token-2022 / differing ATA and `verify` passes. It now `cmp`s dumps and dies. The pins are version snapshots, not upgrade protection — as now stated.

**R0.3 — INFO: D2 test-quality survival, not a money bug.**
Round-28 D2 asked to replace `C.13` truthiness-after-unconditional-`mkV` and `7.6` repeat of `R27.V1`.
Current `tests/3prog.test.ts` still does:

```
// R27.C1 att(cpiClaim) … then unconditionally:
const C2=mkV(cpiKp,alice,…)
rec('C.13','the claim increments …')
…
rec('R27.V1',…); … rec('7.6','the owner vote adds exactly one YES…')
```

If `cpiClaim`/`ownerVote` failed, `mkV`/tally arm adds no independent state evidence; the run still fails only via `R27.C1`/`R27.V1`. No vault money moves on this path. Evidence if this mattered: delete `R27.C1` expectation and `C.13` still passes. Fix: make `C.13` assert `stoppedCharterAfter[OFF_SALES_STOPPED]==1` with count delta from chain, and `7.6` assert from `readProp` deltas without relying on the prior arm, preserving count/floor 855.

**R0.4 — D1/D3 repaired. No finding.**
SPEC now references `audits/FREEZE.md` for counts, labels v5 58,956 CU/890 B as v5, `MINT:monthly_inline` says “No per-weight minimum applies”, boost docs require owner, operator block sits over `arm_swap_operator`.

## R1. Custody — no theft, no surviving emptied vault

Pairing binds asset **and** owner both ways, top-level only:
`programs/cbob-vaults/src/lib.rs:open_for_redemption` walks `load_instruction_at_checked` from `current+1`, matches `BURN_PROGRAM_ID` + `IX_BURN_VAULT_DISC=[150,115,145,83,24,135,83,99]` + `BURN_IX_ASSET_IDX=0` + `BURN_IX_OWNER_IDX=2`. `programs/cbob-vault-burn/src/lib.rs:burn_vault` scans `0..current`, matches `SEAL_PROGRAM_ID` + `IX_OPEN_FOR_REDEMPTION_DISC=[244,178,130,11,158,107,45,95]` + `0` + `2`. CPI-hidden halves are invisible by construction. Suite `WR.1/WR.2/WR.3` lands all three wrapper shapes with `NotFromBurn`/`NoTerminalBurn`/`NoPrecedingOpen` and `WR.4` shows live + funded. Discriminators asserted vs `sha256("global:…")` in `3.1a/3.1b/3.1q/3.1r`, indices in `3.1c-f/3.1s`.

Emptiness is complete for what is shown: `asset_signer.lamports()==0`, `declared==remaining.len()`, every reserve ATA under both token programs declared, PDA-owned, `d[72..76]==0` + `d[121..129]==0` + `d[129..133]==0`, `len==165`, `amount==0`, no declared `KEY_ASSET_V1`. Second loop repeats all six on any declared PDA-owned token account.

**R1.1 — LOW: SOL parked at an expected ATA address is skipped regardless of lamports, stranded not stolen.**
`burn_vault` reserve loop:
```
if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }
```
A non-existent ATA is System-owned, 0 lamports — correctly skipped. But anyone can `SystemProgram.transfer` to that PDA address before the ATA exists, creating a System-owned account with lamports at exactly the address BURN will look up. It is still skipped, burn lands, sweep helper never touches ATA lamports (only signer lamports + token amounts), so those lamports are stranded behind a burned PDA. Attacker spends own SOL to strand own SOL; victim redemption is not blocked, no theft. Evidence if worse: land `open+sweep+burn` with 1,000,000 lamports pre-sent to `declare(pda)[0]` and show burn refused or signer-side theft — suite `9.10/9.11` shows the opposite for signer lamports. Fix (pre-lock, optional): in reserve loop, if `acc.owner` is System require `acc.lamports()==0`, else `ReserveNotDeclared`-style refusal so page creates ATA first.

No other R1 break: Token-2022 reserves refused at `SEAL:initialize:assert_classic_spl` (`ReserveMintNotClassicSpl`, `6.13`), delegates/close refused (`3.3`), partial refused (`3.11`), cross-vault refused (`3.9/3.10/4.10/9.0`).

## R1s. Sweep helper — sound on all six questions

`programs/cbob-vault-sweep/src/lib.rs:process` requires `data==[0]`, `len>=4 && (len-4)%2==0`, `signer.is_signer`, `token==Tokenkeg`, `system==System`, `signer!=dest`, per-pair `src_owner==signer && to_owner==dest && to_mint==src_mint` via 165-byte reads (`mint 0, owner 32, amount 64`), transfers live `amount`, always `CloseAccount` rent-to-dest, then `transfer(signer.lamports())`.

(a) Only owner via Core Execute on thawed vault. `SR.5/SR.5a` refuse stranger + owner-added transfer delegate with Core `0x1a NoApprovals` inside genuine open, seal untouched; `SR.5b` pins CBOB collection authority to off-curve MINT PDA; `SR.5c` refuses collection UA on control, `SR.5d` lets control owner empty wallet. Cannot be reached frozen: `3.7` bare Execute refused Core `0x9` with owner==owner and seal frozen. AgentIdentity route needs registry PDA + collection UA (MINT PDA, no key, no Execute CPI) — measured `R24.1a/1c`.

(b) Pairs: same-source-twice refused second-close (`SR.12a` `Provided owner is not allowed`, `SR.12b` pins it is not first-guard); foreign source refused (`SR.11`); wrong-mint dest refused (`SR.12`); dest==signer refused (`SR.10`); odd refused (`SR.7`); zero-pair lamports-only lands (`SR.13`); wSOL is ordinary classic pair; delegate/close on source fails close and reverts whole opening (owner-only settable); frozen source reverts (`SR.14` Token `0x11`); non-ATA classic rescued if named; Token-2022 (170 B) refused `InvalidAccountData`; dest-is-other-vault-PDA allowed but is owner’s explicit choice, moves to that PDA.

(c) Dest wallet unchecked vs asset owner is safe given (a): only owner can invoke via Core, dest choice is owner’s spend. Lamport credit to non-System dest succeeds adding lamports (`R27.S1`); to missing dest creates it (owner-payer exists); below-rent still creates, no block.

(d) `signer.lamports()` read at execution, emptied to zero. Nothing later in same tx deposits to signer before BURN’s `lamports==0` check (burn is next, no deposit). Post-burn deposit would strand attacker’s own lamports only.

(e) Closed accounts pass for right reason: after `CloseAccount` owner is System, BURN’s `continue` skips — or zero-amount token pass. Missing reserve ATA: page must pre-create (SPEC REDEEMING step 1). Stranger-created classic ATA after build but before land is covered because sweep moves live balance; stranger-created ATA where page named none causes `ReserveNotDeclared` block — closed by pre-create in prior tx. Token-2022 ATA for classic mint cannot be created (`IncorrectProgramId`, probe). Non-ATA PDA-owned account created by stranger is invisible and destroyed, not blocking — accepted 44. Frozen stray reverts — accepted 44.

(f) Fits: `S8.0` three-asset + claim via helper `B<=1232-52-96`, `S8.1a` 168,343 CU < 800k default. Not a guarantee for arbitrary extra pairs — as stated.

(g) Evidence stands: `SR.0` deployed, `SR.1` direct without signer refused, `SR.2` wrong-owner dest refused, `SR.3` pre-read fails dust, `SR.4/4a` exact SOL delta with gifts/rent/fee, `SR.6-14` exact errors, `build-mainnet.sh` `cmp`s `dist/target/deploy/ln` sweep bytes.

No R1s finding above INFO. `SR.12b` is weak-negative (`'false'` vs absence) but cannot hide a money move.

## R2. Pool money — `pool >= ceil(owed)` holds, no liveness block

`credit`: `delta=avail*SCALE/w`, `owed+=delta*w`, `avail=balance-ceil(owed_old)`, so `ceil(owed_new)<=balance`. `distribute` refuses `PoolShort` before credit. `claim` settles `pay=floor(pending/SCALE)`, `carry=pending-pay*SCALE`, `debt=w*acc`, `owed-=pay*SCALE`. `retire(redeemed,!forfeit)` requires `pending<SCALE`; `retire(...,forfeit)` (pool frozen) just drops `owed-=pending` and logs `CBOB_REDEEMED_POOL_FROZEN`. `retire_burned` returns share to pool. `P.32` asserts balance>=owedCeil, `BK.*` ledger asserts `owed==Σ(w*acc+carry-debt)` after every money op.

Counters: `pending_count/pending_this_epoch/active_count/total_active_weight` move once per request/join/retire; same-epoch retire decrements both, earlier-epoch retire decrements only `pending_count`, so `waiting=pending-pending_this_epoch` never drifts (`F21.1/2`). `JoinWaitingFirst` + free join via `claim` + `expire_boosts` records-only means no one can wedge distributions: crank joins eligible before distributing, anyone can `expire_boosts` without token account.

No R2 finding.

## R2b. $CBOB boost — exactly N, carry exact, ring agrees past 64

`boost_vault` owner-only (`BoostNotTheOwner` vs live Core owner bytes), active/live/pinned-mint/balance checks, `monthly_inline` first, buyer terms `BoostTermsMoved` one-sided per ruling. Schedules `end=epoch+N`, `ring[end%64]++`, `active++`, `wt+=extra`, `reweigh` (owed→carry, debt→new `w*acc`, denominator Δ). `advance_epoch`: `epoch++`, `due+=ring[epoch%64]`, clear slot. Gate `BoostsExpireFirst` + `JoinWaitingFirst` on both paths. `expire_boost` requires due, `unschedule` picks due vs future slot, `reweigh(0)`, clears end. `retire` unschedules either branch, keeps history inert (`claim`/`expire` skip retired).

Ring wrap safe: max 63 < 64, slot reuse only after epoch passes and slot cleared; due blocks advance until expired. Sharing a slot (e.g. epoch 0+63 and 1+62 both end 63) sums counts correctly — comment “never share” overstates but code handles sharing. Host `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` (260 epochs) + `BO.34/38/38a` on-chain wrap + early-due retire at wrapped slot + `BO.*` books (`w,wt,active,ring+due==active,pool>=owed`) all green. No double/early/never: weight-zero guard, epoch guard, permissionless expiry.

No R2b finding.

## R3. Level draw — FIFO, skips, burned-head, re-supply all measured

`blockhash_in_window` pins sysvar id, `n<=512`, `len>=8+n*40`, rejects zero hash, picks smallest produced in `[want,want+64]`. `try_capture`: `now<=reveal→NotYet`, `now>reveal+300→Expired`, else A then B/C each `(slot/4+2)*4`, `hash(hA||hB||hC||asset)`. Worst C ≈ reveal+208 < 300. `reveal_level` requires `index==revealed_total`, live-or-positively-burned (`Core,1,0x00`), burned still draws and skips Core write (`L.11`), attributes hash-checked and re-sent within 640 B/8 (`L.12/12a/12b/13/14`). Independent re-derivation `L.3c/L.10/L.23` green. Leader-C choice and lapse re-roll are accepted 25/26 and holder-guide states “can pick among several results” + “drawn again”.

No R3 finding.

## R4. Governance — no minority carry, no money reach, no new freeze

Quorum vs snapshot, threshold vs cast, 10% turnout vs snapshot, key-change 50% of snapshot (`KeyChangeNeedsHalf`), `KeyChangesBundled`, `VaultTooNew`, `CharterNotClosed`, per-kind skip-not-revert with `CBOB_ACTION_SKIPPED` (`7.26/E.2/3c.R1/BO.25`), `StopIsNewer` tie `>=`, tighten one-way + bounds (`Loosening`/`TightenOutOfBounds`), boost bounds, 7-day execute window. At ruled 21%/51% smallest pass 10.71% YES so turnout never binds — as stated (35). Key-change needs half snapshot; mid-vote mints neither vote nor raise bar (round-25 D1, SPEC). Bare-burn-unretired only raises bar; anyone can `retire_burned`. Empty-world stall is accepted 45. Stolen-guardian permanence below half is accepted 47.

No R4 finding.

## R5. Charter claim — address-pinned, window-clocked, pass-through untrusted

Live `AssetV1` + owner==signer + `collection==pob_collection` + `root==merkle(leaf=sha256(0x00||asset), node=sha256(0x01||min||max))` + `len<=16`, CPI `BurnV1` with first `pob_extra` remaining accounts forced non-signer, crank remainder, `charter` attribute program-written, counts to supply/census, no guardian gate per ruling. `OR.2-6` prove benign Oracle needs pass-through, rejecting Oracle still rejects (ruled), collection restored. SPEC 46 states end-before-start + capture-governance + per-asset blind spot + sampling + positive bound (cannot take PoB).

No R5 finding.

## R6. One-time config, trusted hop, royalty, cap

SEAL checks only token-owner for reserves (`A6`); front-run closed by `INIT_AUTHORITY`-first + `check-launch-params` pinning ruled three + `WiringDiverged` across MINT/BURN/GOV. Royalty 10% `authority:None` proven both directions (`R.5/R.6/6a-c/9`). Rate ring `cap=max(1,ceil(live*210/10000))` capped at 64 (covers 3,047 > 2,100, stricter beyond), `kth` rule gives true rolling window (`RL.2/3/4/7`, `S10`). `redeem_window 10..86400`, mainnet must 3600 — open item 38.

No R6 finding.

## R7. Raw reads — recomputed, agree

SEAL `collection 9..41, reserves Vec@41`; MINT `governance 41, minted_total 141, bare 454, pool 73, charter_close 442, reserve/cap/cooldown 257/266/274, floor/ceilings 631/639/647, cbob 679, maxW/E 711/712, ring 749`; BURN `burned_total 42`; VaultRecord `asset 9..41, index 41..49`; sweep token `mint 0, owner 32, amount 64, len 165`. Versions SEAL 2/MINT 6/BURN 4/GOV 4/Record 4 match chain (`3.1v`). Spaces: Record 221, Burn 827, Gov 350, Proposal 259 — all sufficient (inits land).

No R7 finding.

## R8. Suite/sim/build as evidence — floors equal counts, bytes proven

855 on-chain + 888 detector + 39 allocation + 22 poster + 14 PoB + 47 launch + 6 host + 33 mainnet + 4 expiry + 71 sim + 16 fork, each floor `==` count. `because()` pins reasons; `ID.1` uniqueness green; `X.1-7` decode live bytes. `build-mainnet.sh` asks all four (reject mainnet/accept localnet) + `cmp` sweep `dist==deploy==ln`. No arm found that cannot fail; `SR.12b`/`P.2a` weak but not vacuous.

## Accepted limits — four questions

1. **Worse than stated? No.** Spot-checked 10/28/40/41/44/46/47/55 against code/suite; bounds as written. R1.1 stranding is attacker-funded, non-blocking, narrower than 44.
2. **Not actually a limit / already closed? No.** 42’s narrow 1,219-byte three-create fit is offline, not landed page contract; prior-prep remains required legacy shape.
3. **Discharged not discharged? No.** 51/54/12-17/14/19/30/31/33 + v5 family removals verified (e.g. `update_wiring` absent `0.4i`, deck absent `0.4f/g`, `VaultTooNew` `G.6`).
4. **Open treated as accepted? No.** 22/38/50/52/53 stay OPEN and gating; guide still DRAFT.

## Other — nothing above INFO beyond R1.1/R0.3

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS AND PROGRAMS WILL BE IMMUTABLE — what AI audit structurally cannot do before launch

1. **Run the live dress rehearsal at throwaway IDs with real value movement** (SPEC 22 + 53): crank live passes at ~2,100 vaults, alarm in `CBOB_ALARM_REHEARSAL=1` with isolated router state, one full revenue cycle through Orca then forced-Meteora fallback with `--audit` clean, one forced post-sweep failure with hand recovery per limit-10 runbook, DAS-burnt read. No suite/sim/fork executes `bank/revenue.mjs` live path or paging at scale.
2. **Build the holder surfaces that are the only pre-signature control** (SPEC 50): deposit-address page, `judgeRedemptionCoverage` page blocking sign on strays/nested/T22/frozen, claim-then-join offer, helper sweep with prior ATA creation, packet/CU budgeting, poster sender. Until built, 9/44 have no preventive control.
3. **Ceremonialize initialization** (SPEC 38 + road 9-11): build four `initialize` txs FROM `launch/mainnet-init.json` (charter dates + lock deadline still OPEN), verify ruled values, create pool/revenue/Squads cbBTC ATAs + revenue rent (SPEC 52), deploy five bytes vs `build-mainnet.sh` SHA256, reproduce build from commit on second machine, Gary-signed INIT_AUTHORITY acceptance, then remove upgrade authority on all five. AI cannot sign, hold keys, or prove the compiled constant is Gary’s key — only reject-test-key + source grep + reproducibility.
4. **Close custody/ops outside code**: move $CBOB release wallet off box or to Squads + delete box key (56), fund/isolate swap-operator wallet + fee float (10 D2), decide hot Moments authority cold/multisig through window or accept capture risk (46), fund crank/revenue, install cron non-dry-run, set alert routing with rehearsal isolation.
5. **Do not publish HOLDER-GUIDE.md** (DRAFT) until 2 exists; it currently promises pages in present tense.