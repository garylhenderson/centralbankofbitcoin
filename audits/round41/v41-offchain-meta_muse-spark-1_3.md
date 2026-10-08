# Off-chain pass — independent audit of the current tree

Scope-frozen tree as bundled. `bank/`, `scripts/`, `sim/`, `launch/`, `tests/`, `web/test/`, `SPEC.md`, `HOLDER-GUIDE.md`, `DESIGN-v6.md`, MINT (`programs/cbob-vault-mint/src/lib.rs`) and the sweep helper (`programs/cbob-vault-sweep/src/lib.rs`) read whole. No program was executed live here; every claim below names the on-chain or run evidence that would decide it.

## R0. Round 40's verdict and its two repairs

Round 40 off-chain was `NOT CLEAN; QUORUM MET`, 0 CRITICAL / 0 HIGH / 0 MEDIUM / 2 LOW. Both LOWs were test-gates that could not fail. Both repairs are present in this tree and both are red-capable.

**C01 — ceremony `remember` check — REPAIRED, verified.**
`web/test/ceremony.test.mjs` M2 arm now binds the index:

```js
(at => at >= 0 && at < pageSrc.indexOf("const signed = await signExact…"))
  (pageSrc.indexOf("remember(ctx.newCollection.publicKey.toBase58())"))
```

The `at >= 0` conjunct is what round 40's `mRem` (delete `ceremony.mjs:214` `remember(…)`) needed. The old `indexOf < indexOf` passed with `-1`. The new form fails when the call is absent. The companion `uses` / `remembers` arms at 186-192 are unchanged, and the page still remembers at `ceremony.mjs:214` before `signExact` at 215. No regression: the arm names the same call the page makes.

**C02 — swap tolerance pinned by hand — REPAIRED, verified.**
`bank/selftest.mjs` M1 block now contains:

```js
t('R40 C02: the floor is PINNED by hand at 150 bps (280,355 expected, 276,149 minimum)…',
  [f.expectedSats, f.minSats, SW.SWAP_TOLERANCE_BPS], [280_355n, 276_149n, 150])
```

with the 2026-10-05 fixture prices (`sol 12045355552`, `btc 8592910904675`, expo -8, 2 SOL) already in the block. This does not recompute `swap.mjs:126`. Setting `SWAP_TOLERANCE_BPS = 9000` changes `minSats` and turns this arm red; setting it to `0` breaks R30 L3 as well. `SPEC.md` 1258-1260 states "less 150 bps (`SWAP_TOLERANCE_BPS`)", so the constant is now held to the stated number. `sim/swap-fork.mjs` SW.1/SW.4/SW.8/SW.9 (`got >= minSats`) still pass looser floors — that half remains source-read, not measured — but the selftest half is now a real pin.

**Round-39 C01/C02/C03/C04, round-40 C10/W2 — present.**
The R39 C01 send-block extraction (`retire, join, expire:before, distribute, expire:after, activate, claim`), the C02 `'MISSING'` picker, the C03 six-snapshot bundled-`planRedemption` equality (`bundle.test.mjs`), and the R40 C10 rich-autograph / unknown-plugin reader arm (`selftest.mjs` `R40 C10`) are all in the bundled sources. I did not re-file them.

## R1. The crank (`bank/crank.mjs`)

No value-moving defect found. Every `d('…')` sent is `activate, capture_entropy, claim, distribute, expire_boosts, reschedule_reveal, retire_burned, reveal_level, split_revenue` — permissionless MINT only, no SPL/System transfer built, `distribute` always `Buffer.from([0])` (free path). Reveal order, reschedule-vs-capture split, retire-before-pay/join, join-before-distribute, expire-before/after, frozen-pool tick-and-join, and the budgeted fee floor all match the program's refusals.

One waste-fee shape survives, unreachable today, worth closing because `bank/` is being touched anyway:

**R1-1 LOW — the launch tick is planned without checking `boosts_due`.**
`planCrank` plans `distributeKind='tick'` when `w===0 && waitingThisEpoch && due && joinable`, with no `boosts_due` test. MINT `distribute` checks `BoostsExpireFirst` before the `w==0` branch, so a tick with `boosts_due>0` is refused and the fee is wasted.
Today `w==0` implies no active vault, hence no active boost, hence `boosts_due==0` — the program unschedules a retiring vault's boost in `retire` — so the branch cannot fire. There is no invariant in the tree that says so; a corrupt `boosts_due` or a future program edit makes it a monthly false page.
*Evidence if true:* a `distribute` send with `MonthNotElapsed`-style `BoostsExpireFirst` logs on a tick pass with `w==0`.
*Fix:* add `boostsDue==0` to the tick condition and assert both ways (tick planned with `boosts_due:0`, refused-planned with `boosts_due:1`).

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

No quiet-dangerous or always-paging state found. `test_value_in_production`, lock-deadline, `sweep_unledgered_state` (half-cooldown, smallest-seen cooldown, direct-lookup `landed`), `closesCycle` anchoring, frozen-transition downgrade, per-kind streams with urgent one-shots and level recoveries, and the `carryConfigBaseline` repair all read as written. The `w==0` tick discussion above has no alarm counterpart that mis-pages: `launch_tick_overdue` requires `pt>0` and the month+grace past, `boosts_stalled` requires `bd>0`, both from chain reads.

No new finding here. The two recommendations from round 40 (record-count vs `minted_total` for a degraded RPC; per-transaction catch in `splitsSince`) remain open recommendations, not defects: both fail loud today (open cycle held, `tx_unreadable` reported, cursor held).

## R3. The layouts (`bank/layout.mjs`)

Assertions are real: `STRUCTS` equals each `pub struct` field-for-field and type-for-type, every `OFF_*` pinned across programs equals `offsets()`, versions equal every copy, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` less padding equal `fixedLength()`, seeds equal the eleven `*_SEED` constants, `LEVEL_WEIGHTS`/`ACC_SCALE`/`REVEAL_WINDOW_SLOTS` scraped from MINT, `BOOST_RING` held to 64 in three places.

**R3-1 LOW — the rescue seed is not in `bank/layout.mjs` and therefore not in the seed gate.**
MINT declares `RESCUE_SEED = b"rescue"` and every vault's `PermanentTransferDelegate` authority is the `["rescue"]` PDA. `bank/layout.mjs` `SEEDS` lists eleven seeds and the D6 gate checks eleven of eleven — `rescue` is not among them. Nothing in `bank/` derives the rescue PDA today, so nothing misreads; the gap is that a mistyped `RESCUE_SEED` in MINT has no off-chain gate, exactly the class D6 was built to close.
*Evidence if true:* change `RESCUE_SEED` to `b"rescuq"`; `selftest.mjs` stays green.
*Fix:* add `rescue: 'rescue'` to `SEEDS`, map it to `[MINT_RS,'RESCUE_SEED']` in the D6 table, expect 12 of 12.

## R4. The money arithmetic (`bank/accrual.mjs`)

Equal to the program line for line: `credit` (`delta = avail*SCALE/w`, `owed += delta*w`), `owed_of` (`weight*acc+carry-debt` with `weight_of` including a live boost), `reweigh` (owed to carry, debt restarted at the new weight, denominator moved by the difference), `ceil_sats`, `available`, `debtAtActivation`. The crank expires due boosts before a distribution and every boost its distribution makes due right after; the alarm pages `boosts_stalled` and watches `cbob_mint`/`max_boost_weight`/`max_boost_epochs` as fixed-forever. No divergence found.

## R5. The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

**(a) Oracle math — correct.** `sats = lamports*sol*10^(es-eb)/(btc*10)`, floor `*9850/10000`, `minSats>0` refused. `satsPerLamport` float is deviation-filter only; both prices fit in 53 bits at the fixture magnitudes and the filter tolerance (100 bps) dwarfs float error.

**(b) Pyth verification — sufficient as used.** `readPyth` demands receiver ownership, `level==1` (Full), expected feed id, positive price, age ≤180 s on the chain Clock, future ≤30 s, confidence ≤30 bps each feed. `market()` reads the two sponsored PDA accounts and the Clock sysvar in one `getMultipleAccountsInfo` and refuses an unreadable/foreign/truncated Clock. Ownership-plus-Full cannot be forged without the Wormhole guardians the receiver checks; the missing PDA-address equality is not exploitable because `market()` never accepts a caller-supplied address.

**(c) Deviation filter — correct direction and units.** `orcaSpot = (sqrt/2^64)^2` is cbBTC sats per wSOL lamport (A=wSOL, B=cbBTC). `meteoraSpot = 1/(1+bin_step/1e4)^active_id` is the inverse of the X-in-Y price (X=cbBTC, Y=wSOL), i.e. the same quantity. Both compared to `satsPerLamport` in bps. Boundary arms (99 used / 101 refused, both sides, through `market()`) exist.

**(d) Minimum out — same floor, right units.** Both venues' instruction byte 16 carries `minSats` (Orca `other_amount_threshold`, Meteora `min_amount_out`), both in cbBTC sats, both equal to the oracle floor the judge was told.

**(e) The judge — complete for our defects.** Seven instructions, one venue swap, one System wrap of exactly `lamportsIn` into our wSOL ATA, SyncNative, our cbBTC ATA created for us, swap amount/floor/direction/price-limit, input/output accounts at the pinned positions, operator in the authority slot, one close back to us, CU limit 400,000 and no CU price, no other Token instruction. Vault/tick/bin-array accounts are intentionally unchecked: the venue programs refuse a wrong one (safe refusal, not theft), and checking them would duplicate the programs' own validation.

**(f) Derivation — correct.** Orca current-then-two-below tick arrays, oracle PDA, vaults from the pool; Meteora active-then-two-above bin arrays, bitmap-or-program-id, `host_fee_in=None`, event authority, two Token programs. Boundary and negative-id arms exist. An uninitialised array refuses on chain and falls to the other venue — the stated fallback.

**(g) wSOL handling — DEFECT.**

**R5-1 HIGH — a prior wSOL balance breaks the close and halts every cycle until a hand clean.**
`swapInstructions` wraps exactly `lamportsIn`, swaps exactly `lamportsIn`, then `CloseAccount(our wSOL -> owner)`. SPL Token `CloseAccount` refuses a non-zero balance. If the operator's wSOL ATA already holds wSOL (anyone can create that ATA and send it wSOL — the operator address is public), the swap leaves `prior` behind and the close refuses, so the whole seven-instruction transaction reverts. The sweep has already moved SOL to the operator; the cycle stays open and every retry fails the same way until a person empties the ATA by hand.
*What the attacker gains:* no theft — a liveness grief on royalty swaps at the cost of dust plus rent. Each blocked cycle pages (`royalties_unswept`, open-cycle guard) — loud, not silent — but the automatic path cannot recover.
*Evidence if true:* dust the operator's wSOL ATA with 1 unit of wSOL on a fork, run the built instructions; the swap simulates/sends to `CloseAccount` failure with the cbBTC floor otherwise satisfied. Code evidence: `swap.mjs` `swapInstructions` (amount `lamportsIn`, unconditional close) plus SPL Token's zero-balance close rule.
*Fix:* before building, read the operator's wSOL ATA; if it holds `p`, either sell `lamportsIn+p` (floor scaled to the total) or refuse to start the cycle with a named page (`operator_wsol_not_empty`) and do not sweep. At minimum, `market()`/revenue `prepare` must treat a non-zero prior wSOL balance as a stop, not as free rent. Add a fork arm: dusted wSOL ATA refuses to start or sells the total.

**(h) Failure and retry — correct.** Orca first, Meteora only on `refused` (preflight/on-chain failure/expired-absent via `classifySendFailure` status lookup). Unconfirmed stays open with `pendingSwapSig`/`pendingSwapVenue`; the open-cycle guard stops a second swap; the ledger closes only on proven cbBTC return and split (`closesCycle` + `splitSig`/`splitByOther`). No double-count path found.

**(i) Tolerance extraction — bounded and small.** 100 bps deviation gate + 150 bps floor = at most ~250 bps under the oracle per cycle before confidence/age, plus Pyth's own error (not bounded by these checks, as SPEC now states). At the ruled 10 SOL cap (~280k sats at the fixture ratio) that is <7,100 sats (~$6 at $85k BTC) per cycle, ~$3k/month at the ~34 SOL/day throughput ceiling. Material only as a drip, and every execution is held on chain to its floor with the delta checked after signing. The operator-key worst case is unchanged: cap × windows until `emergency_stop_sweep`, never vaults/pool/sale cbBTC.

## R6. The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

Floors are equalities, counts are read from every occurrence in SPEC, the rehearsal proof reverses byte-for-byte, `build-mainnet.sh` compares the sweep helper in three places, `cron-install.sh` installs six jobs and preserves `--live` only from our tagged uncommented lines. The round-24 section arms were spot-checked both ways (distribute-race moved/unmoved, `PoolShort` always fail, reveal `skip` break, decimals-byte refusal, split destinations, fee-floor reserve).

**`web/test/` — non-vacuous with one residue carried.**
The C03 bundled-`planRedemption` equality runs six snapshots byte-for-byte with a length guard; the C04 freshness/no-store/`uses` arms are red under their mutations (mJson measured in round 40); the M2 arm is now presence-bound by this round's C01 repair; the V39-1/V39-2 press arms, V38-2 consent arms, proxy allowlist-equals-callsites, and README hash-table arms all fail when their property breaks. The one constructible blind spot round 40 measured (C03 residue: key leaked inside an array literal passes the `]` branch) remains: it is the round-38 C09 class (a send with a narrow arm), not an arm that cannot fail, and no holder value depends on it. Recommended in the same `web/test` edit as C01: bind the `]` branch to the `signExact` call.

## The four questions on the accepted limits

1. **Is any ACCEPTED limit worse than stated?** No. The sandwich bound (limit 10) is now exactly what SPEC numbers say (150 bps floor, 100 bps gate, 30 bps confidence each feed) and the C02 pin holds the 150. Limit 27's stranger-claim cost correctly falls on other holders. Limit 28's frozen-pool forfeit, limit 32's cap arithmetic, and limit 40's three Core consequences all match the code.
2. **Is anything listed as a limit not actually a limit, already closed, or closed by something unnoticed?** No. The DISCHARGED family (Bank/deck/distributor items) stays gone; item 51's boost timing and item 55's unsplit edge remain real and disclosed.
3. **Is any DISCHARGED item not actually discharged?** No. Items 12/17 (compute), 14 (duplicate keys), 19 (unlevelled halt), 30/31/33 (split/cadence/notice) and the v5 Bank items each cite the on-chain refusal or deletion that closed them, and the suite arms exist.
4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22 (live rehearsal incl. both pools + forced failure), 38 (three OPEN launch values), 50 (unpublished pages + helper lock), 52 (pool/Squads/revenue funding), 53 (throwaway-id rehearsal + rehearsal value set) are all open in SPEC and in `launch/mainnet-init.json`. The holder guide stays DRAFT gated on item 50.

## Other findings

None beyond R1-1, R3-1, R5-1 and the R6 residue above. No CRITICAL. The tree is not clean while R5-1 stands.

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what AI audit structurally cannot do before launch

AI rounds reason; they do not operate. Before the upgrade authority is removed, do these with hands and keys, not prompts:

1. **Run the rehearsal with real value and real failure.** Item 22's five named items with signatures: crank live at ~2,100 vaults, alarm in rehearsal mode, one full revenue cycle through Orca, one with Orca forced to refuse so Meteora runs, one forced post-sweep failure walked through the hand runbook to `--audit` clean, plus the DAS `burnt` read. Include a high-fee period: capture latency, swap inclusion without a priority fee, and reschedule paging.
2. **Rebuild all five programs on a second machine from the release commit** and compare `dist/SHA256SUMS`. Then build the four `initialize` transactions FROM `launch/mainnet-init.json` and read every field back off chain before signing — the checker judges JSON, not the signed bytes, and SEAL checks owners only.
3. **Drill the alerts to a person.** Fire each CRITICAL once (unledgered sweep, bare burn, pool short, `program_not_locked`, `sweep_unledgered_state`, `scan_backlog_unproven`) and require the human to close it, including writing `bank/log-gaps-reviewed` and clearing `scan_backlog_unproven` by hand rescan.
4. **Take custody off this box.** The swap operator float, the $CBOB release wallet (all 2.1B), the deploy authority for the claimed ids, and the PoB collection hot wallet are each one file or one key theft from a permanent loss. Fund the operator above `OPERATOR_FLOOR` with nothing else in it, move the $CBOB supply to Gary's wallet or a Squads and delete the box key if that is the ruling, and hold the Moments key cold through the 7-day window or accept in writing that it can end or capture the project.
5. **Publish the pages before value, not after.** Item 50's redeem/vault/claim/buy pages, the `/rpc` proxy, and the metadata generator are the only pre-signature controls for items 9/44. Test them with a real wallet on the rehearsal deployment, including the dusted-ATA (V40-1/2/3), frozen-pool, and C5 shapes, and keep the guide DRAFT until they are live.