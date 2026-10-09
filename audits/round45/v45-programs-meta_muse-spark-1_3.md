# Confirmation audit — final tree + rehearsal driver + web/

**Verdict: LAUNCH-CLEAN; QUORUM of one (this pass) — no confirmed finding in (a)-(d).**
0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW, 2 INFO. Nothing in the five programs. No value path. No stopped crack.

This pass re-read the five programs whole, recomputed every cross-program offset/space/discriminator, re-checked every Round-44 repair at its shape, and drove the new rehearsal driver by reading (no mainnet send). The 912/1004/39/68/6/35/4/695/71/132/16 floors are taken as the measurement baseline; a claim contradicting a green run is marked as a reasoning claim.

## R0. Round 44 verdict, its repairs, the rehearsal driver, web/

### V45-1 — LOW — rehearsal `sendWithInit` funds ~0.1 SOL per ceremony step but estimates 0.005 SOL: `--max-sol` does not bind
**Construct:** `scripts/rehearsal-steps.mjs` `sendWithInit` + `makeSteps` `ceremony-*` estimates.
**What it does:** `sendWithInit` simulates with a 0.1 SOL probe (`probeLamports = 0.1*SOL`), reads `sim.value.accounts?.[0]?.lamports`, funds `used-pre`. The call is `conn.simulateTransaction(probe, undefined, [INIT.publicKey])` — signers/opts shape does not request account data in web3 1.x, so `accounts` is empty, `post=0`, `used=pre+probe`, `fund=probe` every time: each of the 5 init/collection steps moves 0.1 SOL to the publicly-known INIT key (seed 0x07, in source) inside the same transaction that spends it.
The step estimates say `5_000_000` (0.005) for each init and `3_500_000` for the collection. Actual drawdown per step is ~20× the estimate.
**Gain:** none to an attacker; to the operator: the plan-only print understates peak drawdown by ~0.6 SOL, and the `--max-sol` gate (`capAllows` in `rehearsal-run.mjs`) adds `estimate` to `spent`, so a `--max-sol 12` mainnet run can draw ~12.6 SOL before it refuses. Leftover INIT dust sits in a known key between steps for a sweeper to take (pennies).
**Evidence if right:** on the local proof (`.rehearsal-run/local-state.json` costs) each `ceremony-*` cost is ~100M+ lamports above its estimate; `sim.value.accounts` is `undefined` in the crank log; `INIT` balance is non-zero between steps.
**Fix:** request the account explicitly (`simulateTransaction` with `accounts:{addresses:[INIT]}`), or set each ceremony estimate to `110_000_000` + rent and assert `costs[step] <= estimate` in the record writer. Outside (a)-(d): tooling, fails toward overspend, never toward re-send.

### V45-2 — LOW — `judgeSigs` + `nextAction` can re-run a step whose signature was preflight-refused for the wrong reason
**Construct:** `scripts/rehearsal-run.mjs` `send` marks `preflightRefused` only on `/simulation failed/i`; `judgeSigs` skips any record with that flag.
A refusal at preflight for insufficient funds, blockhash expiry, or rate limit is **not** marked, stays `pending` until `lastValidBlockHeight` passes (up to 3 min of waiting per step), then `none-landed` → `run`. That is the safe direction (never double-send), but a step that will always preflight-refuse (e.g. funding wallet short of a top-up) burns 36×5 s waits per resume instead of failing fast with the RPC's message.
**Evidence if right:** a `revenue-cycle-*` resume with a short funding wallet logs "may still land; waiting" for 3 min then re-runs and fails identically.
**Fix:** mark any `sendRawTransaction` throw before broadcast as `preflightRefused` with the message, not only simulation failures. Outside (a)-(d).

### V45-3 — INFO — rehearsal failure knobs' production gating is not in this bundle
`rehearsal-steps.mjs` passes `CBOB_REHEARSAL_FAIL_AFTER_SWEEP` and `CBOB_REHEARSAL_FORCE_ORCA_REFUSAL` to `bank/revenue.mjs` / `bank/swap.mjs`; `bank/rehearsal-env.mjs` (bundled) refuses a *set* override outside a recorded tree. The revenue/swap side that must honour `rehearsalOnly` is **not bundled** (`bank/` is the off-chain pass). If either file reads `process.env` directly, the knob works in production.
**Evidence if right:** `grep -rn CBOB_REHEARSAL_FAIL_AFTER_SWEEP bank/` outside `rehearsal-env.mjs` without `rehearsalOnly`/`rehearsalFlag`.
**Fix:** route both knobs through `rehearsalFlag` and add the two selftest arms (set-outside-tree throws; unset behaves exactly as before). Outside (a)-(d).

### V45-4 — INFO — `sim/das-shim.mjs` `seen` grows without bound
Asset→collection map for every live asset ever grouped, never evicted. Local-only, hourly crank groups of ≤5 vaults: hundreds of entries. Not a defect on mainnet (real DAS).
**Fix:** evict entries whose tombstone check has passed, or bound to the rehearsal census. Outside (a)-(d).

**Round-44 repairs hold** at every site checked: `release_gate` reads the five ids from `web/src/config.js` `MAINNET_PROGRAMS` (no literals) and refuses untracked `programs/` files; `audit-coverage.sh:107` accepts `(?:LAUNCH-)?CLEAN`; `ceremony-reads.mjs:25,35` returns `{absent}` distinct from `broken`; `plan-ceremony.mjs` rehearsal judge is the checker's own `--rehearsal` judge; rehearsal profile init key/treasury come from the value file. The `a3cfd79` "refused every real rehearsal tree" failure is gone by construction (ids/root assembled, not literal).
**Driver guards hold:** recorded-tree check, mainnet-id and mainnet-key refusals (`judgeProgramIds`, `judgeNoMainnetKeys` + `REHEARSAL_OWN_KEYS`), Core pin check, `--max-sol`, never-resend (`nextAction`: `done→skip`, chain-done→`mark`, unknown→re-read, `sending/unknown` with landed/maybe-landed→`stop`), init-then-read-back (`verify-configs` before any token moves; every ceremony step `readStep` → send → `readStep==[]`), close-at-end (5 closes, never `--final`). `rehearsal-env.mjs` is fail-closed: unset → identical behaviour; set outside a recorded tree → throw, never silent fallback. No path lets `rehearsal-env` change production behaviour.

**web/ (second independent audit):** every transaction builder matches the suite/sim byte-for-byte by construction (`ix.test.mjs` extracts the suite's own builder source); `planRedemption` implements SPEC 50 (prior creates, claim-except-frozen-pool, helper sweep of all three reserves + closable strays, C5 plain-transfer left undeclared, both-program ATA declarations, 1,232 fit, no crank, `judgeRedemptionCoverage` cross-check that can only find what the page did not name); `planClaim`/`planBuy`/`planDraw`/ceremony/metadata/proxy match their SPEC clauses including the C5 rule, dust-as-absent (R40/R41), bounded reads (V1), standing consent (V38-2), and re-read-by-address at the press (V39-1). No path was found where a holder loses value the page said was safe. The proxy relays only CBOB-calling ≤1,232-byte transactions (plus the three exact CBOB-less shapes), with the stated W6 exception.

## R1. Custody
No finding. Pairing binds asset+owner both directions by top-level sysvar walk (`SEAL BURN_IX_ASSET_IDX/OWNER_IDX=0/2`, `BURN SEAL_IX_ASSET_IDX/OWNER_IDX=0/2`, discriminators asserted 3.1a–3.1f); CPI wrappers invisible to the walk (WR.1–WR.4); two-vault sharing requires both pairs (4.10a rate-limits the second, proving the pairing accepted it); emptiness proof covers PDA lamports, both-program reserve ATAs, delegates/close/extensions, declared nested vaults; thaw without burn reverts. Stranger SOL/token dust is swept at execution (9.10/9.11, SR.3/SR.4).

## R1s. Sweep helper
No finding. (a) Direct call needs asset-signer signature; via Core only the owner passes (`SR.5/5a` 0x1a, `5b` collection authority is off-curve MINT PDA, `5c/5d` control). (b) Pair list: odd/zero refused correctly; duplicate source fails on the closed second account (`SR.12a/12b`); source==destination impossible (`signer!=dest` + owner checks); wSOL is a plain 165-byte account the helper reads; delegate/close/frozen handled by Token's own refusal (helper always closes: `R36.C5` reverts, page uses plain transfer); frozen destination never delivered (H1). (c) Destination chosen by the builder is safe given (a); sub-rent credit to a missing account refuses (R41.C8a–c), owner-payer exists. (d) `signer.lamports()` emptied to zero; a later deposit in the same tx can only fail the burn (self-grief). (e) Closed accounts skip for the right reason (non-Token owner → `continue`); prior-create contract (item 42) + idempotent ATA + live-balance sweep closes the create-then-dust race; T22 ATA for a classic mint refuses (`IncorrectProgramId`, probe); non-ATA/classic strays are sweepable when named, otherwise stated loss (item 44). (f) S8.0 1,061 +52+96=1,209 fits; S8.1a 168,343 CU < 800k; no crank, pool already carried. (g) No arm found that cannot fail; `because()` reasons match measured errors.

## R2. Pool money
No finding. `pool >= ceil(owed)` preserved by `credit` (avail over ceil), `claim` (pay whole sats, debt restarts), `retire`/`retire_burned` (owed down, balance unchanged), `reweigh`/`expire` (owed unchanged, carry moves). `pending_count`/`pending_this_epoch`/`active_count`/`total_active_weight` correct under all orderings including waiting-vault retire (F21.1/21.2: same-epoch check matches the per-epoch reset). Liveness: `BoostsExpireFirst` expirable via record-only `expire_boosts` (no token account needed); `JoinWaitingFirst` joinable via `claim` without a token read on the pending path; monthly tick path for the empty pool.

## R2b. Boost
No finding. Exactly N distributions (`end=epoch+N`, due at `dist>=end`, gate blocks the N+1th); `carry` preserves earned share across boost/expiry/claim-normalise/retire (`reweigh`: `carry=owed`, `debt=new_w*acc`); ring/totals agree past epoch 64 (host test N1: 260 epochs, 4 wraps, per-slot model, early/due retire both branches, wrapped N=63 buys/retires covered); no double/early/never expiry (`BoostNotDue`, gate, permissionless expiry); token-account-gone vault expirable.

## R3. Draw
No finding. Sysvar pinned, count/bounds/zero-hash fail closed; skipped slots take smallest produced in `[want,want+64]`; FIFO by `revealed_total`; burned head still draws (L.11) without Core write; attribute hash re-supplied; crank bounded/skipping. Not worse than SPEC 26; holder guide states the choice-among-many and re-roll honestly.

## R4. Governance
No finding. No minority path (quorum+threshold+10% turnout+half-of-live for key changes, unbundled, noticed, guardian cannot cancel its replacement); no money reach (5 kinds, MINT re-checks, split/destinations/supply/royalty/vaults unreachable); no permanent freeze beyond stated limit 47 (replacement by half-of-live + week; `None` retires the brake).

## R5. Charter claim
No finding. Address-pinned Merkle (domain-separated, sorted, depth ≤16), CPI burn as owner same instruction, window by clock only, guardian-independent, `pob_extra≤8` never signers. SPEC 46 complete on this tree (end/capture, per-asset blind spot, sampling, positive bound, packet, page refusal).

## R6. One-time config + trusted hop
No finding, save the standing OPEN-item note: SEAL accepts duplicate reserve mints and any collection key (owner-check only); MINT/BURN `WiringDiverged` + `check-launch-params.mjs` (item 38) is the only gate before the permanent write. Royalty authority None proven both ways (R.5/R.6/R.6a–c, re-delegation 0x1b); cap is exactly the 64-slot rolling window (`cap=max(1,ceil(live*210/10000))`, kth-oldest ≥ window).

## R7. Raw reads
No finding. Every offset/space recomputed from the structs: MintConfig 1,005+256, VaultRecord 211/221, BurnConfig, SEAL, GovConfig, all `OFF_*` (GOV 191/192/518/526/631/639/647/711/712/41/141/454/442/257/266/274; BURN 141/454/42/50/58/59; record 41/49/57–59/60/125–129/161/177/178/186/187/195) and all discriminators agree.

## R8. Suite/sim/build as evidence
No finding. No arm found that cannot fail (`X.7` honestly relabelled per F20; `SR.12b` fails if the message moves; `ID.1` enforces uniqueness); negatives pinned to the right reason; packet/CU figures are legacy/v0 measurements as labelled; sweep helper bytes proven identical (`dist/` == `target/deploy/` == localnet release); four programs' key proof is behavioural with the third-key gap explicitly stated as NOT PROVEN.

## The four accepted-limits questions
1. **Worse than stated?** No. The two cost figures checked (limit 59: 650,240 mainnet vs 890,880 test-validator; limit 10 throughput ~34 SOL/day at the hourly cadence) match the code and measurements. V44-5's correction is applied.
2. **Listed but not a limit / already closed?** Limit 35 (turnout never binds at ruled numbers) is a floor, not a cost — correctly retained as a floor for non-ruled values. No other ACCEPTED item was found closed by an unnoticed mechanism.
3. **DISCHARGED not discharged?** No. Items 1a–24 went with the Bank/deck/distributor (gone); 12/17, 14, 19, 30/31/33, 51, 54 are measured or superseded as stated.
4. **OPEN treated as accepted?** No. Items 22 (live rehearsal incl. revenue/DAS), 38 (charter/lock/collection dates), 50 (publish pages), 52 (pool/Squads/revenue funding), 53 (re-run proof at release) remain OPEN and are enforced by the checker, gates, and road steps; the driver reports 22.3–22.5 as `NOT-RUN-HERE` on local rather than passing them.

## What AI audit structurally cannot do before launch
1. **Run the live rehearsal (item 22) with real SOL/cbBTC through both pools + forced failure + DAS read.** No suite, sim, fork, or read proves the crank at 2,100 vaults, the alarm in rehearsal mode, or the revenue cycle's sweep/swap/return/split/ledger/audit against real pools and Pyth. Do road step 8 on mainnet at throwaway ids with the driver, record every signature in `<state>.record.json/md`, and require PASS on 22.1–22.5 before step 9.
2. **Watch a real Phantom holder complete claim/buy/activate/open on the published site behind the proxy.** Offline byte-equality + mock + e2e do not prove a phone wallet keeps the ComputeBudget instruction, respects `signExact`, or understands any sentence. Publish to a staging origin, complete each flow with a funded vault, and have a non-engineer tick every loss box.
3. **Close the box-owner residue (limit 10(3), limit 56).** No check in the tree vouches for `bank/swap.mjs`/`revenue.mjs` integrity, the provider key, or the $CBOB release wallet on this box. Move the release wallet off the box (Gary's call), re-key the provider, verify third-party upgrade authorities out-of-band, and rehearse the hand recovery with the operator key offline.
