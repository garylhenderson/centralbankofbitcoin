# Off-chain pass — confirmation of round 44 + whole-tree audit

**Head audited:** `c9a811d` tree as bundled (programs `0b3ddb3`, off-chain as listed).
**Verdict: LAUNCH-CLEAN; QUORUM-equivalent single-auditor confirmation.**
0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW, 1 INFO.
Both in the fixable layer (`bank/swap.mjs` judge, docs/poster wiring).
Nothing in the five programs, no value path, no refused crack.

Round 44 off-chain (`VERDICT-offchain.md`) was LAUNCH-CLEAN with V44o-1..V44o-5.
I re-ran every repair at its site and at all sites of its shape, from source,
with extraction harnesses where the selftest does. All five hold.
Round 44 programs verdict V44-1..V44-7 read only for dedup; no conflict.

## R0. Round 44 verdict and its repairs

**V44o-1 poster per-signature counts — HOLDS.**
`bank/redemption-poster.mjs:256-279` keeps `st.unread` keyed by signature,
deletes only `st.unread[s.signature]` on a readable signature, saves and throws
on `n<3`, queues `signature:*` REJECTED on the third and continues.
Backlog/gap interaction verified: on a gapped or draining walk the throw skips
the `st.backlog` write at `:316`, so the next run re-walks the same window;
after the third run the loop completes and `:316-322` advances `before` past
the skipped signature. The R43 single-signature arm plus the new two-signature
drain/gap arms (`selftest.mjs` R44 V44o-1 block) fail if reverted to a global
counter. No surviving defect.

**V44o-2 revenue split scan — HOLDS.**
`bank/revenue.mjs:542-562` (`splitsSince`) now `try/catch`es
`readParsedTransaction`, pushes `refused`, `continue`s; a refused signature
never closes a cycle. Recovery block `:239-262` closes on `closesCycle` first,
then provably-empty, then throws naming the refused signatures for hand read
(SPEC limit 10). Extract-and-run arms V44o-2 pass both ways; reverted code
throws on the unknown-version fixture.

**V44o-3 SEAL-null baselines — HOLDS.**
`bank/alarm.mjs:547` takes `reserves` from `cfg` or the carried baseline
`D.carryConfigBaseline(prev?.config,cfg)`, `:560-568` carries every stored leg
not built this pass with `balance_unreadable` HIGH. Three-pass extract-and-run
arms (6→6 keys, $GARY fall paged; without carried config 6→6 with 1 unread)
fail on the old `[payment]` fallback.

**V44o-4 runner exit — HOLDS.**
`scripts/run-tests.sh:460-465` is now `if [ CBOB_SHIP_GATE=1 ]; then die; fi`
as the last statement; `if false; then; fi` exits 0. Selftest V44o-4 arm runs
the tail as written.

**V44o-5 rehearsal notices + operator key — HOLDS.**
`bank/keys/swap-operator.json` path root-mapped in rehearsal tree,
`rehearsal-tree.sh` generates program keys, `launch/rehearsal-init.json:117`
documents placement; `crank.mjs:612,886`, `revenue.mjs:56, publishRevenueNotices`,
`alarm.mjs` all pass through `rehearsalNotice`/`rehearsal:` labels
`*-rehearsal:*` with REHEARSAL text. Selftest V44o-5 arms (3 notify sites in
crank, 1 in revenue, label families) fail if a site bypasses the wrapper.
`bank/rehearsal-env.mjs` refuses rehearsal-only overrides outside a recorded
tree.

Gate-5 items 1-4 from round 44 exist in `bank/selftest.mjs` and are non-vacuous
(each shown red at the audited head in VALIDATION). Item 5 (text/runbook) needs
no arm. Round 43 gate-5 items 4-5 (C20: `pdas/atas/assets` from shrunk set;
Meteora bitmap premise) remain open obligations, correctly carried, not new
defects.

## R1. The crank

Plan/send order, writability, permissionless-only instruction set, fee floor/
ceiling, budget-then-drop-reveals, chain-clock planning, distribute-race
re-judgement, frozen-pool tick + join-only batches, boost expiry before/after,
retirement-frees-owed, rescue planning — all verified against `planCrank`,
`budgetPlan`, `judgeDistributeRefusal`, `revealAttrSource`, `splitDecimalsByte`,
`clockUnixTimestamp`, and the extracted send block (R39 C01, R43 V43-1 arms).

No plan the program refuses is sent in the normal case:
`NothingToSplit` benign, distribute re-reads config, split requires live
unfrozen pool + Squads ATA, reveal `[]` only for positively burned asset,
join/pay only positively live asset, burned waiting vault retired not joined.
Rescue destinations pinned to `bank_treasury` by MINT; crank cannot choose
elsewhere. Fee payer signs only as payer.

No finding above LOW. One residual is filed under R5 (judge, shared with the
revenue path).

## R2. The alarm

Drift, standing risks, brakes, pool, distribution clock, rate window, reveal
stall, lock date (5 programs incl. sweep), missing components, baseline carry,
reserve reads, frozen transitions, rehearsal seam, per-kind streams with urgent
one-shots and level recoveries, log-gap/unreadable-skip level conditions,
sweep-state backstop, split anchors, crank posture/health — all driven both
ways in `bank/selftest.mjs` (1004 arms) and spot-checked against `bank/alarm.mjs`
call sites (I4 pinned-arguments arm).

No dangerous quiet found; no routine page found. `crank_silent`,
`royalties_unswept`, `distribution_overdue`, `pool_frozen/insolvent`,
`redemptions_near_cap`, `test_value_in_production`, `program_not_locked`,
`sweep_unledgered_state`, `tx_skipped_unreadable`, `log_coverage_gap` all fire
and clear as documented. `missingWatchedKeys`, wiring gate, router-behaviour
arms (QUEUED/PENDING/SUPPRESSED, recovery classification, defanging) hold.

## R3. Layouts

`bank/layout.mjs` field lists equal the Rust structs (all five accounts),
cross-program `OFF_*` offsets equal computed offsets with no scraped-but-
uncompared constant (L2 arm), seeds equal `*_SEED` constants (12/12, D6),
versions equal every declared copy, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE`
scraped and evaluated less padding equal fixed lengths, `BOOST_RING` 64 pinned
in three places, encode/decode round-trips with every refusal (bool, version,
discriminator, truncation, Vec length) named. SEEDS assertion now exists —
round 24 D6 closed.

## R4. Money arithmetic

`bank/accrual.mjs` `credit`, `pendingScaled`/`pendingSats`, `reweigh`,
`ceilSats`, `available`, `debtAtActivation` are line-for-line the MINT formulas
(`weight*acc+carry-debt`, `delta=avail*SCALE/w`, `owed+=delta*w`).
Crank expires every DUE boost before distributing and every boost its
distribution makes due after; alarm pages `boosts_stalled`; `cbob_mint` and
boost bounds are fixed-forever drift. No divergence.

## R5. Swap + revenue cycle

**(a) Oracle math — HOLDS.** `oracleFloor` is
`lamports*sol*10^(es-eb)/(btc*10)`, floored, minus 150 bps floored. Hand-pinned
vector 280,355/276,149 holds. Expo range -18..0 enforced at read and floor.
`Number()` conversions are ~1e10/`~8e12`, far inside 2^53; `satsPerLamport`
is display-only, never a consensus input.

**(b) Pyth verification — HOLDS.** Owner==receiver, `level==1` Full only,
feed id equality, length 101, offsets 40/41/73/81/89/93 verified against
`PriceUpdateV2`. Derived PDA `[0,0]+feed` under push, shard 0. Age 180 s +
future 30 s judged against Clock sysvar; unreadable Clock refuses. Only the
receiver program can write a receiver-owned account; push path needs Wormhole
verification. Clock is chain truth.

**(c) Deviation filter — HOLDS.** `orcaSpot=(sqrt/2^64)^2` raw sats/lamport,
`meteoraSpot=1/(1+step/1e4)^id` inverse of X-in-Y, correct directions
(Orca A=wSOL/B=cbBTC a_to_b; Meteora X=cbBTC/Y=wSOL Y→X). Float error ~1e-12
against 100 bps band; borderline 1 bps either way is fail-safe (refused venue
= no sweep, loud).

**(d) Minimum out — HOLDS.** Same `minSats` in Orca `other_amount_threshold`
and Meteora `min_amount_out`, u64 sats, enforced on chain. Fork refuses +5%
floor on both venues with nothing moved.

**(e) Judge — LOW, see finding V45o-1.** Value-moving roles, amounts, floor,
direction, price limit, budget, ATA identities, close-back are all pinned and
armed both ways (8 tampers × 2 venues + limit/CU/exact-output arms). What
remains is venue-owned liquidity accounts, deliberately left to the venue
program.

**(f) Derivation — HOLDS, with stated Meteora residue.** Orca
`[tick_array,pool,String(start)]` current + two below; oracle
`[oracle,pool]`; vaults from pool read. Meteora `[bin_array,pool,i64LE]`
active + two above; bitmap or program id; `host_fee_in` None; event authority;
two Token programs. Proven by fork landing 2 SOL + 10 SOL on both venues.
Uninitialised Orca arrays accepted by current program (SDK + IDL 6055/6056,
all arrays existed at fork snapshot); Meteora absent `i+1/i+2` behaviour
unmeasured — availability only, loud open cycle, inside 150 bps floor. Gate-5
fork arm still owed (round 44 C01/6).

**(g) wSOL — HOLDS.** Exact `lamportsIn` wrap/sync/swap/close atomic. Pre-funded
ATA adds to balance but swap sells exactly `lamportsIn`; close unwraps
remainder (native close with balance succeeds — pinned Token bytes carry only
the non-native zero-balance rule). Frozen/delegate/foreign-creator cases
inapplicable: wSOL has no freeze authority, ATA owner is the operator PDA,
delegate needs operator signature. Swap consuming less cannot happen on
exact-input; whole tx reverts on failure.

**(h) Failure/retry — HOLDS.** Orca first, Meteora only on `refused`
(preflight/on-chain-err/expired-absent via `classifySendFailure` status
lookup). `unknown` (processed-only, missing status, failed lookup, no sig)
never tries another venue; candidate saved as `pending*Sig`. Ledger stays open
until `returnedSats` + split; open-cycle guard blocks stacking. Double-swap
needs a hand retry against runbook limit 10.

**(i) Tolerance + operator bound — within stated limits.** 100 bps gate +
150 bps floor compose to ~250 bps worst fill, ~118 bps sandwich net per
Opus 5 numbers; at 10 SOL (~$1,200) ≈ $18/cycle, ~$72/day at 40 SOL/day max.
Against 4.41 BTC pool at full census (~$379k) immaterial; against one vault's
21k sats payout noise. Operator worst case remains cap×windows until
`emergency_stop_sweep` (10 SOL × 6 h windows, ~34 SOL/day at hourly cadence),
never vault/pool/sale cbBTC. Ledger cannot read failed as closed
(`sendRejected`→`refusedSig` never `sweepSig`; `rejected_row_has_sweep`
CRITICAL if both).

## R6. Gates + web/test

`bank/selftest.mjs` 1004, `run-tests.sh` floors (912/1004/39/24/14/68/35/4),
`swap-fork.sh` 16, `expiry-budget` 4, `audit-coverage.sh` headline/shape arms,
`build-mainnet.sh` 4-key behavioural proof + sweep byte-identity (3 copies),
`cron-install.sh` 6 jobs with anchored `--live` preservation and `-n` lease —
all non-vacuous (each mutation arm shown red).

`web/test/` (11 files, 695 offline assertions via `run-all.mjs`): each file
fails when its property breaks — bundled `planRedemption` byte-equality (C03),
ceremony builders vs suite builders, decode vs official deserializers,
claim/buy/draw refusals both ways, dusted-address reads (C2/V40-1/V41-1),
two-redemptions-two-drafts (C01), level-0 refusal (C04), grouped-box scaling
(V1), standing-consent press (V38-2/V39-1), rehearsal judge (V44-1), hash-table
fresh-build equality. Static bundle checks (single script, CSP, SRI, no em
dash, no box leak) name the file on failure. No ack arm found that cannot fail;
R37-style grouped/late/consent IDs are asserted with rotated IDs and count
changes.

## Findings

### V45o-1 — LOW — the swap judge does not pin venue-owned liquidity accounts

**Construct:** `bank/swap.mjs:judgeSwapInstructions` verifies pool, operator
wSOL in (Orca key 3 / Meteora key 4), operator cbBTC out (key 5), amount,
floor, Orca direction/price-limit, signer slot, 7-instruction shape, budget,
ATAs, wrap destination, close-back. It never looks at Orca vaultA/B (keys
4/6), tick arrays (7/8/9), oracle (10), or Meteora bitmap/reserves/oracle/
host-fee/event/token-programs/bin arrays.

**Gain:** no theft — venue programs refuse foreign vaults/arrays — but a
builder defect (wrong vault, stale array list, wrong oracle) passes the last
pre-sign line and fails on chain: wasted fees, open cycle, hourly
`cbob-revenue:swap` page, hand recovery. Evidence if true: mutate
`swapInstructions` to name a stranger vault; `judgeSwapInstructions` returns
`[]`; `sendAndConfirmTransaction` refuses on chain. The existing L1 arms prove
the judge *can* fail; none mutates these keys.

**Fix:** pin the market-read values the builder was given: require Orca keys
4/6 == `w.vaultA/B`, keys 7-9 == derived tick arrays, key 10 == derived oracle;
Meteora keys 2/3 == `p.reserveX/Y`, key 1 == bitmap-or-program-id per
`bitmapExists`, key 8 == derived oracle, trailing keys == derived bin arrays.
Gate-5 arm both ways. Outside (a)-(d): fixable-layer swap tooling, no value
moves without the on-chain floor + post-swap delta check.

### V45o-2 — INFO — holder guide promises live announcement the poster cannot send

**Construct:** `HOLDER-GUIDE.md` (“Every opening is public. It is announced on
X and on the Bank’s website.”) vs `bank/redemption-poster.mjs` (drafts only,
no sender by design, item 50) + SPEC item 50 (X new-post authorization + website
surface not chosen, pages staged not published).

**Gain:** none to an attacker; holder expectation vs staged surface. Evidence:
`poster --selftest` asserts no posting client; guide speaks in present tense
(round 25 L1). Already covered by OPEN item 50 and the guide’s DRAFT banner
(“may not be published before this item ships”).

**Fix:** keep DRAFT banner until item 50 ships; no code change. Outside (a)-(d).

## The four accepted-limits questions

1. **Worse than stated? No.** Re-checked 6-10,13,25-29,32,34-49,55-59 against
code: re-roll needs full-window silence; C-leader grind best-of-4 + block
variance as stated; bare-burn claim/join cost falls on others as stated (crank
retires first); freeze forfeit as stated; rate cap 45/h with 64-ring as stated;
unsplit edge ~hour of sales as stated; $CBOB hot wallet, hot PoB authority,
hot operator, Core upgradeability, off-curve irredeemability all as stated.
2. **Listed but not a limit / already closed? No new closure.** All ACCEPTED
items still reproduce or remain structurally true. `SEEDS` comment now has its
assertion (D6); that was a docs fix, not a limit closure.
3. **DISCHARGED not discharged? No.** 1a/1b/2-5/11/15/16/18/20/21/23/24/30/31/
33/51/54/12/17/14/19 remain gone with the Bank/deck/distributor or measured
closed; spot-checked `DuplicateAttribute`, `VaultTooNew`, packet/CU figures.
4. **OPEN treated as accepted? No.** Items 22 (dress rehearsal incl. 22.3-22.5),
38 (three OPEN values), 50 (staged pages + helper lock + poster sender), 52
(pool/Squads/revenue funding), 53 (throwaway-id rehearsal + values) are all
carried as blocking in SPEC, VALIDATION, and the rehearsal driver. No quiet
demotion found.

## Anything else

None above INFO. Rounds 41-43 confirmed findings re-checked at their sites;
all remain outside (a)-(d), repairs hold.

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS AND PROGRAMS WILL BE IMMUTABLE, what AI audit structurally cannot do before launch

1. **Run the dress rehearsal for real (item 22.1-22.5, item 53).** No suite,
sim, fork, or prompt executes crank I/O at 2,100 vaults, alarm live passes in
rehearsal mode, a full revenue cycle through *both* pools with Orca forced to
refuse, a forced post-sweep failure through hand recovery with `--audit` clean,
or the DAS `burnt` read. The rehearsal driver (`scripts/rehearsal-run.mjs`,
box-signed, `--max-sol`, never-resend-completed-step) exists — use it on
mainnet at throwaway ids with throwaway keys, record every signature, then
close the programs. Do not lock without it.
2. **Publish the holder surfaces before the guide (item 50).** The redeem page
(`judgeRedemptionCoverage` + helper sweep + prior creates + frozen-pool
no-claim + C5 transfer + grouped boxes + standing consent + `prepareOpening`),
buy/claim/vault pages, ceremony step 10, metadata generator, `/rpc` proxy,
and poster sender (or explicit manual procedure) must be live. The guide is
DRAFT until then.
3. **Close the launch values by ceremony (item 38).** `charter_opens_at`,
`lock_deadline` (≥24 h before open), `vault_collection` (created at step 10,
recorded), built *from* `launch/mainnet-init.json` through
`check-launch-params.mjs`, configs read back before value moves. Then lock all
five programs (`--final`) and re-dump prefix-hash + zero-tail.
4. **Fund and arm operations.** Create pool/Squads/revenue cbBTC accounts,
fund revenue above rent, fund operator float above 0.02 SOL (nothing refills
it), install crons `--live` deliberately, point router state/logs, file
`acks.json`/`log-gaps-reviewed`/`unreadable-reviewed` watermarks, rehearse
`emergency_stop_sweep` + guardian replacement path with custodial holders.
5. **Keep the pins alive.** Re-pin Core, Token/Token2022/ATA, Orca/Meteora/Pyth
bytes and upgrade authorities on every alarm page; re-run probe + fork on a
schedule, not once. An AI round cannot watch mainnet between rounds.