# v6 whole-tree audit — R0 first, then R1–R8

No upgrade authority will exist after launch. I assume every comment is false until source or a landed transaction proves it.

## R0. Round 32 verdict and its repairs

Round 32 PROGRAMS was `NOT CLEAN; QUORUM MET`, 6/8 seats, 0 CRITICAL / 0 HIGH / 0 MEDIUM, 1 LOW (L1) + 1 INFO (D1). Four shared topics counted off-chain.

**L1 — coverage-gate bundle parser fails open. REPAIRED, verified present.**
`scripts/audit-coverage.sh:99-103` now has `first_line_quorate` anchored to `# Round <n>, <FOCUS> pass: (?:NOT )?CLEAN; QUORUM MET`, and `bundles():122-135` finds a `FOCUS === 'programs' ? [` split by shape and `exit`s closed if a `FOCUS`-dependent header is unrecognised instead of crediting both foci. Its `--selftest` has the both-ways headline and split cases. If I am wrong that it fails closed, a script with `TARGETS` in double quotes or a formatter-broken `] : [` would credit programs paths to the off-chain focus in a re-render. The current tree parses every manifest head 19–32 correctly.

**D1 — three DESIGN false sentences. REPAIRED.**
`DESIGN-v6.md` now says mint index is in MINT `VaultRecord`, `burn_vault` requires `<1 sat owed` not “a claim in the same transaction” with forfeit and `retire` removing weight, and `sales_stopped`/`sweep_stopped` not `*_paused`. `programs/cbob-vault-mint/src/lib.rs:2267,2410,1817,1821-1822,876-888` agree.

**A1 / gate-5 — REQUIRED, now present.** `tests/3prog.test.ts` has R31.W1a (10,199 refused by the runtime `too large (10241 > 10240)`), R28.A1 at the 10,198 maximum, R31.W1b (0x28), R31.W2a/W2b (pre-funded config/record/ATA still initialize), R32.A22a/b (Moments-shaped update authority refused 0x1a, owner controls land). Floor 861 equals count. If any were missing the suite floor would be 855.

No surviving round-32 program defect. I do not re-file L1/D1.

## R1. Custody — no theft path found

`programs/cbob-vaults/src/lib.rs:open_for_redemption` walks forward from `current+1` for `BURN_PROGRAM_ID + IX_BURN_VAULT_DISC + asset[0] + owner[2]`; `programs/cbob-vault-burn/src/lib.rs:burn_vault` walks `0..current` for `SEAL_PROGRAM_ID + IX_OPEN_FOR_REDEMPTION_DISC + asset[0] + owner[2]`. Both use `load_instruction_at_checked`, top-level only, both bind asset AND owner, both check `NotTheOwner` from live Core bytes.

What would exist if broken: a landed `open` with no later `burn` for same asset/owner, or a `burn` with no earlier `open`, or a wrapper CPI satisfying either. Suite 3.6/3.8/3.9/3.10/9.0/WR.2/WR.3 refuse each for the named reason and WR.4 shows the vault live with funds intact. Two redemptions interleaved (`open A, open B, burn A, burn B`) pair correctly by construction.

Emptiness proof: `lamports()==0`, `declared==remaining.len()`, per-reserve both-derivation ATAs PDA-owned/undelegated/165-byte/empty, second loop same three delegate checks plus extension check on any PDA-owned token account, Core-owner accounts refused if `d[0]==1`. If Token-2022 confidential value were readable the `ReserveHasExtensions` refusal would be wrong; `tests/probe-round5b.test.ts:F4.1` measures 170 vs 165 and the T22-ATA-for-classic-mint refusal, so the 165 rule is load-bearing and correct.

INFO — nested **collection** not refused: second loop only refuses `KEY_ASSET_V1==1`. A Core CollectionV1 (key 5) owned by the PDA would pass. Consequence is identical to a nested vault (destroyed, accepted 44), not a bypass. No fix required; note it so the “no live Core asset” comment is not over-read.

## R1s. Sweep helper

`programs/cbob-vault-sweep/src/lib.rs:process`.

(a) Only the owner moves value. Direct call needs `signer.is_signer` on the asset-signer PDA, which only Core signs for. Through Core, `ExecuteV1` on a thawed vault is owner-only on the pinned binary: SR.5 stranger refused 0x1a, SR.5a owner-added transfer delegate refused 0x1a, SR.5b collection authority is MINT PDA off-curve, SR.5c control update authority refused 0x1a, SR.5d control owner lands. While frozen Execute is 0x9 (3.7). A thawed vault exists only inside a genuine `open` (thaw reverts without later `burn`), so the helper cannot run outside a redemption on a real vault. If this were false a `CBOB_SWEEP` log with a non-owner `authority` would exist.

(b) Pair list. Same source twice: first `CloseAccount` reassigns owner, second `read_token` fails `IllegalOwner` without the custom msg — SR.12a pins it, SR.12b pins it was the closed source. Source==destination implies `signer==dest`, refused up front. wSOL/frozen/delegate/close-authority behave as SPL behaves: frozen with balance reverts whole opening (SR.14), frozen empty closes (round-30 measurement), close-authority-to-stranger reverts only if that pair is named (unnamed it is destroyed, attacker’s loss). Zero pairs allowed (lamports-only, SR.13), odd refused. If duplicate-source double-spent, SR.4a’s exact lamport accounting would not balance.

(c) Destination is builder-chosen, not compared to owner. Safe given (a): signer is the vault owner, signing transfers of their own incoming accounts. Lamport credit to a non-system or sub-rent account does not refuse a System transfer; R27.S1 lands to an ATA and leaves its data identical. The “lamports-only needs an existing destination” page rule is conservative, not a chain refusal.

(d) Lamport sweep reads `signer.lamports()` at execution and empties to zero. Nothing between sweep and `burn` in the page shape deposits (owner-built tx), Core `BurnV1` does not sweep (probe D4.2/4.3), closes pay rent to dest not PDA. `BURN:lamports==0` sees exactly what the sweep left. If Core added lamports at burn, RL/4.x redemptions would refuse `VaultNotEmpty` spuriously.

(e) Closed reserve passes via non-token-owner skip, for the right reason (SR.12b). Prior-creation closes the stranger-creates-missing-ATA race: missing ATA declared but system-owned is skipped; created empty in prior tx then named, live-balance sweep absorbs later dust. No stranger-creatable account is both un-nameable and un-skippable: T22 ATA for classic mint cannot be created (`IncorrectProgramId`, probe), non-ATA classic 165-byte is nameable, nested Core asset undeclared is destroyed (attacker’s loss) and declared is refused. If a T22 ATA for cbBTC existed, `ReserveHasExtensions` would brick — mainnet probe says all three reserves are 82-byte classic with no extensions.

(f) Fits. S8.0 1,061 bytes owner-payer no extras; +52 compute pair +96 separate payer ≈1,209 of 1,232. No fourth reserve exists (`MAX_RESERVE_MINTS==3` both programs, 9.15/9.16). In-line monthly uses the pool account the burn already carries. If a fourth pair were added the legacy serialization in 9.14 would exceed 1,232.

(g) No arm that cannot fail found; SR.12b passes when SR.12a allows but SR.12a itself would then fail, so the suite still reds. `build-mainnet.sh` `cmp`s sweep `dist/` vs fresh localnet vs `target/deploy` — the helper that ships is the helper tested.

LOW — untested destination shape: **dest = another vault’s asset-signer PDA.** Code allows it (`signer != dest`), suite never names it. Only self-harm (owner traps own funds in a sealed PDA), but the page should warn. Evidence if exploitable: a landed redemption crediting a PDA wallet. Fix: page refuses PDA destinations or warns; optional on-chain refuse is owner decision pre-lock.

## R2. Pool money — invariant holds

`credit`, `claim` normalisation, `retire`/`retire_burned`, `monthly_inline` preserve `bal >= ceil(owed_scaled/ACC_SCALE)`: credit adds `floor(avail*SCALE/w)*w <= avail*SCALE`; claim subtracts `pay*SCALE` owed and `pay` balance; retire subtracts pending owed with no balance move. P.32 asserts it live; BK.IN/BK.3c/BK.P recompute `owed == Σ(weight*acc+carry-debt)` after every money op.

Counters: `pending_count`/`pending_this_epoch`/`active_count`/`total_active_weight` agree under all orderings. `join` only decrements `pending_count` (joiner is prior-epoch, never in `pending_this_epoch`); `retire` of a same-epoch waiter decrements both, of an eligible waiter only `pending_count` (F21.1/21.2). If underflowed, `checked_sub` would revert with `Overflow`, not silent drift.

Liveness: `JoinWaitingFirst` and `BoostsExpireFirst` are both clearable permissionlessly (`claim` joins, `expire_boosts` needs records only, no ATA). A due boost on a vault whose ATA is gone cannot expire via `claim` (whole claim reverts `VaultAccountMissing`) but can via `expire_boosts`. No one can block distributions or redemptions for others; frozen pool forfeits instead of locking (3c.F2).

## R2b. $CBOB boost — exact

N distributions not N months: `end = dist_epoch + epochs`, `advance_epoch` moves due counts, `distribute`/`monthly_inline` refuse while `boosts_due>0`. `reweigh` moves `owed` to `carry`, restarts `debt = new_weight*acc`, `owed_scaled` untouched. `unschedule_boost` takes due vs future branch by `dist_epoch >= end`; `expire_boost` requires due; double/early/never expire impossible (`boost_weight==0` skips, not-due skips, retired skipped). Ring 64 with max 63 never aliases two live ends ambiguously; host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` (260 epochs) and BO.34/BO.38 on-chain wrap/early-retire at wrapped slot prove it. `total_active_weight`/`boost_weight_total`/`boosts_active`/`boosts_due`/ring recomputed from records every BO arm (`BOOKS`). If a boost earned N+1, BO.21a/BO.35a due counts would be off by one.

## R3. Level draw

`blockhash_in_window` pins sysvar id, `n<=512`, buffer length, zero-hash refuse. `try_capture` A then B/C each `+2 groups` aligned to 4, smallest produced in `[want,want+64]`, deterministic. FIFO `index==revealed_total`. Burned head still draws, skips Core write on positive tombstone (L.11). Attributes hash-checked, 640-byte/8-attr budget proven revealable (L.12–L.14). Not worse than SPEC 26: C-leader best-of-4 + block-content grinding for the whole same-slot cohort is stated with the 5.0%→18.6% and 96%-in-64 numbers; HOLDER-GUIDE says “can pick among several results” and “drawn again” truthfully.

## R4. Governance

Quorum snapshot live supply, `VaultTooNew`, 10% turnout, half-of-live key changes unbundled with notice, guardian cancel of pending operator only, monotone tighten inside init bounds, overtaken actions `CBOB_ACTION_SKIPPED` not revert. No minority path to money (no split/destination/supply/royalty/vault reach), no freeze: burns shrink the divisor, bare burns counted on retire, zero-live refuses `QuorumNotMet` rather than passing. Stockpiled-restart “one window each” is false by source: `restart` keeps `*_stopped_at`, next stop re-stamps, older proposals `StopIsNewer`/skip. If a minority could carry, an executed proposal with `yes < need` would exist.

## R5. Charter claim

Address Merkle (domain-separated, sorted, max 16, 240→depth 8), live-asset/owner/collection checks, CPI burn same instruction, window clock-only, no guardian gate, `pob_extra<=8` never-signer pass-through. SPEC 46 is complete on: hot-wallet brick/capture, per-asset blind spot, sampling gap, positive bound (R32.A22a/b measured 0x1a + owner controls), lookalike refusal, move-out-of-collection brick class, Oracle pass-through fit.

INFO — state the >8-account hook bound: a hook needing 9+ accounts cannot be passed (`MAX_POB_EXTRA==8`, legacy 4 with full page shape). Consequence is the same brick already disclosed, but the numeric ceiling should be explicit. Fix: one sentence in SPEC 46.

## R6. One-time config, trusted hop, royalty, cap

SEAL checks owners only; MINT/BURN/GOV cross-check collections, payment-mint-in-reserves, default-treasury/operator, charter/pob/monthly/notice/bounds, $CBOB mint classic and not cbBTC/$GARY, boost ceilings. Wrong-but-accepted values lock forever — that is item 38, and `launch/mainnet-init.json` + `check-launch-params` is the only gate (validates JSON, not signed txs; programs check less). Swap worst case is cap×windows until `emergency_stop_sweep`, never pool/sale cbBTC. Royalty 10% authority None proven both ways (R.5/R.6/R.6a–c, control). Rate limit is exactly `k=min(max(1,ceil(live*210/10000)),64)`, allow iff k-th most recent ≥ window old; ring covers to 3,047 live, stricter above. If window were bucket, RL.3 at 60% would land; it refuses.

## R7. Raw reads — recomputed, match

MintConfig governance 41, minted_total 141, bare_retired 454, sweep floor 631, max-boost-weight 711/712; VaultRecord index 41/reveal 49/level 57/pending 177/boost 186-195/carry 195; BurnConfig burned_total 42; SEAL collection 9/reserves 41; sweep token mint 0/owner 32/amount 64/len 165. Spaces 1261/221/827/398/350 agree. A wrong offset would show as `3.1w`/X.1/X.2 mismatch.

## R8. Suite/sim/build as evidence

861 + 907 + 39 + 23 + 14 + 47 + 6 + 33 + 4 + 16 + 71 floors each equal count. No arm found that cannot fail; negatives pinned via `because()` to measured codes (0x1a vs 0x9 distinguished, runtime vs wrapper distinguished in R31.W1a). Untested shapes (wSOL source, non-ATA dest, another-vault-signer dest, `pob_extra==8`, 30-record expire) are optional arms, not false passes. Four keyed programs’ mainnet bytes are NOT proven identical to tested bytes — only test-key reject/accept + source-key grep + reproducibility bridge, which the script itself states as NOT PROVEN. That is disclosed, not a defect.

# Accepted limits — four questions

1. **Worse than stated?** No. 25/26/28/32/40/41/44/46/47/55 sampled against source still read as written; 26’s “chooses among many” and 25’s re-roll condition match code.
2. **Not actually a limit / already closed?** No. 35 still never binds at 2100/5100; 45 terminal state still holds; 43 off-curve still unredeemable.
3. **DISCHARGED not discharged?** No. 51 boost timing, 54 compute, 12/17, 14, 19, 30/31/33 sampled still closed.
4. **OPEN treated as accepted?** No. 22/38/50/52/53 remain open in SPEC and road; guide still marked DRAFT and unshipped per 50.

# Other

No CRITICAL / HIGH / MEDIUM program defect confirmed. Two LOW/INFO: sweep-to-another-vault-PDA untested (page must warn); SPEC 46 should name the 8-account pass-through ceiling.

# What AI audit structurally cannot do before launch

1. **Run the live dress rehearsal (item 22) with real signatures:** crank full passes at ~2,100 vaults, alarm in rehearsal mode, one full revenue cycle through Orca then forced-Meteora, one forced post-sweep failure with hand recovery and `--audit` clean, DAS read of a burned asset. No suite, fork, or selftest executes `bank/revenue.mjs` live.
2. **Read back the signed `initialize` transactions against `launch/mainnet-init.json` on a ceremony machine:** the checker validates JSON, programs check less, and mainnet key identity is reproducibility + source grep, not acceptance by Gary’s key. Human eyes on derived pool/revenue/Squads ATAs, rent funding, and `set-upgrade-authority --final` for all five programs.
3. **Clear the human-review queues the design creates:** `bank/log-gaps-reviewed` watermark, `scan_backlog_unproven` hand re-scan window, `unredeemable_owner`/`nested` triage, and holder-page build (deposit PDA display, `judgeRedemptionCoverage` pre-sign, helper sweep, prior-tx ATA creation, no-crank-when-`pob_extra`, compute limits). Until the page ships, 9/44 have no preventive control.
4. **Set the two OPEN dates and keep the box honest:** `charter_opens_at`, `lock_deadline`, swap-operator float/top-up, $CBOB release custody move off the box, and third-party upgrade-key watching. No in-tree judge vouches for `bank/swap.mjs`/`revenue.mjs` integrity or the single RPC endpoint.