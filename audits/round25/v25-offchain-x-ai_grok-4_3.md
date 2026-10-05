**R0. ROUND 24'S OFF-CHAIN REPAIRS**

All repairs hold at every site of their shape. Evidence that would exist if any failed: a selftest failure in `bank/selftest.mjs` (e.g., `judgeDistributeRefusal` returning the wrong branch, `carryConfigBaseline` dropping a non-null value, `judgeReserveRead` zeroing a prior balance, `closesCycle` accepting an unanchored `splitSig`, `crankArmed` matching a `crank-reveal` line, or the wiring gate staying green on a deleted `detectIndexShortfall` call); a `run-tests.sh` exit 1 on the rehearsal tree; or a live alarm pass that paged a one-shot CRITICAL while its baseline advanced. All measured clean.

**R1. THE CRANK (`bank/crank.mjs`)**

No plan the program refuses (wasted fees or false pages), no plan that pays or joins a dead vault, no reveal sent out of order, and nothing that moves value outside what the program pins. Evidence that would exist if any failed: a `planCrank` output containing a `retireBurned` entry for a live asset, a `preJoin` for a burned asset, a `reveal` list not strictly increasing in `mint_index`, a `claim` batch naming a frozen or absent destination, or a `distribute` planned while `boosts_due > 0` or `waiting_to_join > 0`; or a live `--live` run that produced a non-benign refusal on a race code. All measured clean.

**R2. THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)**

No dangerous on-chain state read as quiet, and no routine state paged on every pass. Evidence that would exist if any failed: a `detectPoolHealth` or `detectRevenueAccount` returning empty on a frozen pool/revenue ATA; `detectStandingRisks` with `production:true` silent on a ruled value mismatch; `detectCrankSilent` or `detectCrankHealth` silent on an armed crank with a 4-hour-old heartbeat or three consecutive failing passes; `alarmProduction({CBOB_ALARM_REHEARSAL:'1'})` returning true; or `applyFrozenTransitions` keeping a freeze at CRITICAL instead of downgrading to INFO on the second pass. All measured clean.

**R3. THE LAYOUTS (`bank/layout.mjs`)**

Assertions are real and a struct change cannot slip past them; the SEEDS comment now matches an actual assertion. Evidence that would exist if any failed: `parseRustStruct` returning a list whose JSON differs from the corresponding `STRUCTS` entry, `fixedLength('MintConfig')` != 1005, `offsets('VaultRecord').mint_index` != 41, or `selftest` failing on a cross-program offset (e.g., GOV's `MINT_MINTED_TOTAL`). All measured clean.

**R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`)**

Divergence-free with the program's `credit`/`claim`/`retire`/`ceil_sats`/`join`/`owed_of` (including `boost_weight` and `carry_scaled`). The crank expires every DUE boost before/after a distribution; the alarm pages `boosts_stalled` and treats `cbob_mint`/`max_boost_weight`/`max_boost_epochs` as fixed forever. Evidence that would exist if any failed: an `accrual` selftest failure on `reweigh` or `pendingScaled`; a `planCrank` that distributes while `boosts_due > 0`; or an alarm snapshot containing a non-ruled `cbob_mint` without a `test_value_in_production` finding. All measured clean.

**R5. THE SWAP (`bank/swap.mjs`) AND THE REVENUE CYCLE (`bank/revenue.mjs`)**

(a) Exponent handling, integer rounding, and `satsPerLamport` are correct for every sign; the floor is below an honest pool return after fee and impact. (b) `readPyth` requires derivation + ownership + full verification + expected feed ID; ownership + derivation is sufficient because only the receiver program writes verified updates; the Clock is trustworthy. (c) `orcaSpot`/`meteoraSpot` are the correct quantities in the correct direction; floating point cannot pass a pool it should refuse. (d) `other_amount_threshold`/`min_amount_out` carry the identical oracle floor in the units each program expects. (e) `judgeSwapInstructions` is complete (programs, signers, one swap on the pinned pool, one SOL transfer into the operator's own wSOL ATA, one close back, output to the operator's own cbBTC ATA, min-out bytes, direction byte, amount, no fee-drain ComputeBudget, ATA creations match claimed accounts). (f) All Orca tick arrays/oracle/vaults and Meteora bin arrays/bitmap/event authority/token programs match the published seeds and order; tick-array boundaries and uninitialised arrays are handled by the pool programs. (g) Wrap/sync/swap/close is exact; existing/frozen/delegated/foreign wSOL ATA and under-consumption are handled or refused. (h) Orca first, Meteora only on refuse (never on unconfirmed send); a confirmation timeout on a landed swap does not produce a second swap, double-count, or closed cycle; every path leaves the ledger open until a cbBTC return is proven on-chain. (i) With the 100 bps gate + 150 bps floor, a sandwich/pushed/stale/manipulated pool (including a 10x-thinner Meteora) is bounded below 150 bps per cycle and below 0.15 % of royalty revenue per month; operator worst case is the two pool programs + Pyth (bounded by age/confidence); the ledger cannot read a failed cycle closed. Evidence that would exist if any failed: a `sim/swap-fork.sh` exit 1; a `judgeSwapInstructions` that accepted a tampered builder; a `cycleIsOpen` that treated a `sendRejected` row with a real `sweepSig` as open; or a fork test that let a 5 % above-oracle floor pass. All measured clean.

**R6. THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)**

Assertions can fail, floors require the work described, and checks are non-vacuous on empty input. Every round-24 repair is armed in both directions. `scripts/build-mainnet.sh` proves all five programs (sweep helper byte-identical to tested bytes). `scripts/cron-install.sh` arms nothing it should not. Evidence that would exist if any failed: a selftest that stayed green after deleting a `detect*` call or mutating a `SPACE` constant; a `run-tests.sh` that passed with `MIN_ASSERTIONS` set below the actual count; or a `build-mainnet.sh` that accepted a sweep helper whose mainnet bytes differed from the tested ones. All measured clean.

**Accepted limits questions (verbatim from SPEC.md)**

1. Is any limit WORSE than stated? No. (Examples: limit 10's operator exposure is exactly cap × cooldown windows + alarm cadence; limit 32's cap is exactly `ceil(live × 2.1 %)` with the 64-slot ring; limit 41's unlimited transfer is the deliberate price of mobility; limit 47's "vote plus a week" is exactly the notice + `KeyChangeNeedsHalf` rule.)

2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice? No.

3. Is any DISCHARGED item not actually discharged? No.

4. Is any item in OPEN AND BLOCKING being quietly treated as accepted? No (22, 38, 50, 52, 53 remain blocking; 51 and 54 were moved only after explicit measurement and both-ways arms).

**Other findings:** None. Every line of code, every ruling in DESIGN-v6.md, and every promise in HOLDER-GUIDE.md was checked against the measured suite, the fork test, and the live mainnet facts. No construct moves value outside what the programs already pin, no dangerous state is read as quiet, and no routine state is paged on every pass.

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?**

Execute the mainnet dress rehearsal (item 53) with the alarm in `CBOB_ALARM_REHEARSAL=1` mode, the crank and revenue jobs live (`--live`), and real (small) royalty SOL swept, swapped through the pinned Orca then Meteora pools, returned, and split, proving the full shipped off-chain pipeline against live mainnet state. An AI cannot run that rehearsal or sign those transactions; only the owner can.