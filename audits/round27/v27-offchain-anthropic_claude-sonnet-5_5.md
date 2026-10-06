# Independent audit, v6 off-chain pipeline (round 27 reading)

Everything below comes from reading the bundled files. I executed nothing, so each finding says what evidence would exist if it is right. I found no CRITICAL or HIGH defect. One MEDIUM and five LOW findings survive; several INFO items follow.

---

## R0. Round 26's verdict and repairs

I checked the round-26 repairs against the current source and found them present:

| Repair | What the source shows |
|---|---|
| L1 | `rememberAttempt` is called in all four value-hop catch handlers (sweep, swap with venue, return, split). |
| L2 | `detectSplitClaims` now runs both the anonymous and the explicit branch through `closesCycle`. |
| L3 | `revenueNotices` gives per-stage streams, and a stage cannot recover itself in the same pass in which it fails. |
| L4 | `reconcile()` keeps its own `prevPaged` state, labels and failure marker. |
| L5 | The launch gate now feeds the imported `detectStandingRisks` and rejects fields with no validation rule. |
| L6 | The `cron-install.sh` prelude refuses a tree containing `REHEARSAL-RECORD.txt`. |

I did not rerun them. I found no regression in the notice lifecycle.

I did not take the verdict's "unverified" items as disproved. Two deserve action: the sparse swap-account scenario (finding 3 below) and the unproven DAS `burnt` behaviour (item 22.5). If DAS omits burned Core assets instead of flagging them, every routine redemption raises `index_disagrees_with_chain` CRITICAL at every alarm pass.

---

## R1. The crank (`bank/crank.mjs`)

**What I verified.**
- Every instruction's account order matches MINT's `#[derive(Accounts)]`: reveal, capture, reschedule, retire, claim, split, distribute, activate and expire.
- The accumulator mirror in `planCrank` matches MINT's `credit`, `owed_of` and `reweigh` across the pre-join, pre-expire and retire interactions. The denominator is `total + preJoin − retiring − expiring`, as the program computes it.
- The order of sends is accepted by the program. A join or expire the crank skips can only produce a benign skip, not a refused distribute.
- The crank signs only as fee payer, and the only programs it names are MINT.

**No refused plan, wasted-fee path or dead-vault payment found.**

**Minor.**
- The `BENIGN` regex is matched against `e.message + e.logs`. In web3.js 1.98 an on-chain failure after a passed preflight carries no program logs. A race refusal that lands after preflight (`RevealTooEarly`, `AlreadyRetired`) is therefore not recognised as benign and is paged as a failure. This is rare, because most races are caught at preflight.

---

## R2. The alarm

### Finding 1 (MEDIUM): a missing sibling config or program reads as "not deployed yet", for ever

**Construct.** `alarm.mjs` `readConfigs` marks any absent config as `<prog>._missing`. `missingWatchedKeys`, `detectConfigDrift`, `detectRedemptionRate` and `detectUpgradeAuthorityAfterLock` all treat that as quiet. `config_vanished` fires only if a previous pass had read MINT.

**What goes wrong.** Take production, with MINT initialized and the charter open. If any of these is true, nothing pages:
- BURN's config was never initialized, so no vault can ever be redeemed.
- GOV's config was never initialized, so no proposal or sale round can ever exist.
- SEAL's config is absent.
- The sweep helper (or any of the four) was never deployed, so the redeem page's `ExecuteV1` target does not exist.

**Why it is dangerous.** `initialize` stays callable by `INIT_AUTHORITY` after the lock. A stolen or lost Gary key could then initialize BURN or GOV with attacker-chosen in-bounds values, which are permanent. An uninitialized sibling is also a launch-order mistake the dress rehearsal might not repeat on mainnet.

**Evidence if I am right.** Feed `detectStandingRisks`, `detectConfigDrift` and `missingWatchedKeys` a snapshot with a full `mint.*` and `{'burn._missing': true}` (or `'gov._missing'`, or no `prog.sweep.*` keys). All return `[]`.

**Fix.** Add a production-only detector. Once `mint.collection` is present and `charter_opens_at` has passed (or the deploy has happened), `seal`, `burn` or `gov` being `_missing`, or any of the five `prog.*._missing`, is CRITICAL (`sibling_uninitialized`). Add selftest arms in both directions.

### Finding 2 (LOW): `crank_problem` re-pages standing freezes, defeating the I5 transition logic

**Construct.** `planCrank` pushes stable problem strings for a frozen pool ("the pool cbBTC account is FROZEN; claims would all refuse") and a frozen revenue account. The heartbeat carries them. `detectCrankHealth` keys them by `problemKey` (digits normalised), so after 3 passes it emits a level `crank_problem` HIGH on every alarm pass for as long as the freeze stands.

**What this does.** `applyFrozenTransitions` exists so a freeze is news once and then INFO. This path re-pages it, with the router's daily reminder, for a state that limit 28 accepts and the alarm already reported.

**Evidence.** Three consecutive beats with `problems:["the pool cbBTC account is FROZEN; claims would all refuse"]` yield `crank_problem` HIGH from the third.

**Fix.** Exclude freeze problems from `detectCrankHealth`. Alternatively, have `planCrank` return structured problems with a `standing:true` flag for conditions already reported elsewhere.

### Finding 3 (LOW): the revenue ledger's absence is a CRITICAL on every alarm pass until someone creates the file

**Construct.** `detectUnreconciledRevenue(null)` pages `revenue_ledger_unreadable`. Nothing in `cron-install.sh` or `revenue.mjs` creates the file in dry-run, because `load()` falls back without saving.

**What this does.** On a fresh launch the first alarm pass pages CRITICAL at every pass, which teaches the reader to scroll past it.

**Fix.** The installer creates `{"cycles":[]}` plus the `.has-run` marker. Alternatively, `revenue.mjs` saves it on first read.

### Other R2 points

- All fixed-forever values I checked are watched or production-pinned: init-only config, boost bounds, `cbob_mint`, the PoB collection.
- `boosts_stalled` is present.
- The five-program upgrade-authority page is present, but see finding 1: a program that is not deployed is silent there too.
- `readPyth` and the third-party program watch behave as designed.

---

## R3. The layouts

I compared the `MintConfig` and `VaultRecord` field lists to the Rust and found no difference. Fixed sizes are 1005 and 211 once padding is excluded, matching `MINT_CONFIG_SPACE` and `VAULT_RECORD_SPACE`. The SEEDS assertion now exists (D6). `parseRustStruct` is strict. A reorder or retype is caught.

A struct change that preserves names and types but changes meaning (a unit, say) is inherently not caught. The only protection against that is the on-chain suite.

---

## R4. The money arithmetic

`accrual.mjs` equals MINT's `credit`, `claim`, `owed_of` and `reweigh`, including carry and debt after a weight change. `ceilSats` matches `ceil_sats`. The crank's expire-before and expire-after logic is consistent with `BoostsExpireFirst` and `advance_epoch`. No divergence found.

---

## R5. The swap and the revenue cycle

### Verified correct

- **(a) Oracle math.**
  - `sats = lamports·sol·10^(es−eb)/(btc·10)` is correct for any exponent signs and rounds down.
  - `satsPerLamport` in `Number` is safe: the prices are about 1e13 and the exponents small.
- **(b) Pyth offsets.**
  - The offsets are correct: tag at 40, feed at 41–73, price at 73, conf at 81, expo at 89, publish_time at 93.
  - The derived address uses seeds `[shard u16 LE 0, feed_id]` under the push program.
  - Ownership by the receiver is sound, because only the push-oracle flow creates that PDA.
  - Residual: the 8-byte account discriminator is not checked (INFO). An attacker with a valid, fully verified update newer than the stored one could set any price from the last 180 s. That is bounded by 3 minutes of market movement.
- **(c) Deviation filter.**
  - `orcaSpot` is (√P/2⁶⁴)² in raw B per A, which is sats per lamport.
  - `meteoraSpot` is the inverse of (1+s)^id.
  - Float cannot pass a pool it should refuse: `NaN` and `Infinity` compare false, and the venue is admitted only on `<=`.
- **(d) Minimum out.**
  - Both programs get `minSats` in sats, from the same `oracleFloor`.
  - The floor is 150 bps and the deviation gate is 100 bps. An honest pool at the gate edge (99 bps adverse + 16 bps fee + small impact) still clears the floor.
- **(e) Judge.**
  - Exact sequence, key positions (Orca key 5 and Meteora key 5 for output, key 3 and key 4 for input), amount, floor, direction, price limit, and no priority fee.
  - Residuals: the judge does not bound `keys.length` on the swap instruction, and does not check the pool-owned accounts. Each program validates those itself, so I found no value-moving gap.
- **(g) wSOL.**
  - A pre-existing wSOL balance returns on the close.
  - Only the owner can create or delegate that ATA.
  - A partial fill is protected by the on-chain threshold.
- **(h) Failure and retry.**
  - Venue fallback happens only on `refused`.
  - The ledger stays open unless a return is proven.
  - One residual: `classifySendFailure` calls "expired and no status" a refusal and relies on `refusedSig` plus the chain scan if the node was lagging. That is the loud direction.

### Finding 4 (LOW): the pre-sweep gate never checks that the swap's accounts exist

**Construct.** `market()` reads only the two pools, the two Pyth accounts, the bitmap and the Clock.

**What goes wrong.** Orca's `swap` declares `tick_array_0/1/2` as `AccountLoader<TickArray>`, and DLMM requires its passed bin arrays to load. If the current-below tick array is uninitialised (Orca, as the price moves), the swap is refused even for a royalty-sized order that would never cross it. The SOL is already on the operator by then. Both venues failing leaves up to 10 SOL on the operator and a hand recovery, with the oracle price, the pool price and the gate all passing.

**Evidence.** On the fork, omit one of the `plan()`-cloned tick arrays (Orca) or the third bin array (Meteora) and run `swap`. Expect `AccountNotInitialized` (3012) or an equivalent refusal. I did not run this.

**Fix.**
- Add the accounts (`orcaTickArray(...)` ×3 and `meteoraBinArray(...)` ×3) to `market()`'s `getMultipleAccountsInfo` call.
- Drop a venue whose accounts are missing.
- Add a selftest arm and a fork arm with an absent array.

### Finding 5 (LOW, an answer to Q1 below): the 150-bps floor is only as honest as the one RPC

The floor, the clock, the pool spot, and the account bytes that `judgeSwapInstructions` is told all come from `HELIUS_RPC_URL`. The judge checks that the floor equals the one it was handed, not that it is right. A compromised or wrong RPC can lower the floor to an arbitrary value, because it also supplies the oracle and the clock. The swap then needs no pool manipulation at all to lose the whole sweep to a sandwich. It is accepted under limit 10(b), but the "150 bps" figure, quoted as a bound, does not apply to this case.

**Cheap mitigation.** Read the two Pyth accounts and the Clock through a second, independently hosted RPC. Refuse if the prices differ by more than the confidence interval or the clocks by more than 10 s.

### Revenue cycle detail

The cooldown short-circuit precedes the open-cycle guard (`return` at "Nothing to do"). For up to 6 hours a post-sweep failure is silent from the job; only the alarm's `unreconciled_swap` after 60 minutes covers it. This is acceptable and was already designed that way. I list it only because the job's own page does not repeat.

---

## R6. The gates

- The signer scan covers `bank/`, `scripts/` and `tests/`, but not `launch/` or `sim/`. This is D7 and is acknowledged.
- Offline runs of `scripts/run-tests.sh` skip the mainnet probe and the swap fork unless `CBOB_SHIP_GATE=1`. This is opt-in strictness, so a green run can be produced offline. **LOW:** invert the default so the run fails unless `CBOB_ALLOW_OFFLINE=1` is set.
- `build-mainnet.sh` proves the key behaviour for four programs and byte identity for the sweep helper, as claimed. It cannot prove that the four mainnet `.so` files differ from the localnet ones only in `INIT_AUTHORITY` (see the last section).
- I found no assertion that is vacuous by construction in the arms I read. I did not read all 789.

---

## Accepted limits: the four questions

**1. Worse than stated?**
- **Limit 10.** The "oracle −150 bps" bound is stated as a number, but it holds only for an honest RPC (finding 5).
- **Limit 46** is as stated.
- **Limit 41** is as stated. The alarm has no mass-transfer notice. That is not a defect, but a detector for one pass changing owners of many vaults would give lead time before the redemption cap is touched.

**2. Listed but not a limit?** None.

**3. DISCHARGED but not actually discharged?**
- **Limit 54.** The crank's 14-vault claim batch is extrapolated, not measured, for batches that also expire boosts or join. Plausibly within the default 200,000 CU, but this is not a measured discharge. Measure one 14-vault batch with boost expiries.

**4. OPEN AND BLOCKING quietly treated as accepted?**
- **Item 22.5** (DAS `burnt`) is carried but governs the alarm's first-redemption behaviour. Settle it before the rehearsal, not during it.
- Finding 4 sits next to item 22.3, which tests only the success paths of both pools.

---

## Anything else (INFO)

- **`bank/redemption-poster.mjs`.** `draftPost` throws for a redeemed vault whose level is still 0 (redeemed before its draw). That blocks the whole poster, with the cursor unsaved, until the burned vault's draw lands. This is transient, and the poster has no sender anyway.
- **`readPyth`.** It does not check the account's 8-byte discriminator (covered above).
- **Dry-run revenue.** A dry-run `revenue.mjs` can still write the ledger (its recovery block calls `save`), and it reads the key file. It exits 3 hourly on an open cycle.

---

## What this project should do before launch that AI audit structurally cannot

1. **A reproducible, third-party-verifiable build.**
   - Build in a pinned Docker image (`solana-verify`) from a clean checkout, on a machine and path different from this box.
   - Have someone who is not you rebuild and compare the sha256 to the deployed bytes and to `dist/SHA256SUMS`.
   - Compiled panic strings embed source paths, so a build from a different path will not match.
2. **Differential check of the mainnet and localnet `.so` files.** Disassemble both and confirm the only delta is the 32-byte `INIT_AUTHORITY`. `build-mainnet.sh` cannot prove this.
3. **Run the dress rehearsal exactly as item 22 lists it.**
   - Include a forced Orca refusal that falls through to Meteora.
   - Include a forced post-sweep failure and a hand recovery using the runbook.
   - Run at the full scale of 2,100 vaults, or a synthetic equivalent, with the crank at its real RPC rate.
   - Record `captures/min`, reschedule counts and reveal lag.
4. **Property-test the program accumulator against `accrual.mjs`.** Use random sequences of join, boost, expire, claim, retire and distribute through the Rust free functions. The host tests cover only the boost ring.
5. **Move monitoring off the box that holds the keys.**
   - The alarm, the crontab, the ledger and the operator key belong to one user.
   - Run a second read-only watcher on a different host and account, with its own alert path, covering at least: upgrade authorities, config drift, pool solvency and sweeps.
6. **Key custody.**
   - Put the guardian and `INIT_AUTHORITY` on a hardware wallet.
   - Decide whether the $CBOB release wallet really stays on the box (limit 56).
   - Write down who else can act if Gary is unavailable.
7. **Alert delivery drill.** Test that every urgent stream, including the router's recovery behaviour, reaches a human's phone; and rehearse a guardian stop and a sweep stop at 3 a.m.
8. **Initialize ceremony from the checker file.** Build the four `initialize` transactions from `launch/mainnet-init.json`. Verify every written value on chain against the file before the upgrade authority is removed. Remove authority and read back `IMMUTABLE` for all five programs, the sweep helper included.
9. **A human second pair of eyes on the Core CPI byte layouts and on Pyth/Orca/DLMM IDL use.** AI audit read them from source, but a person who has shipped against those programs would catch interface drift quickly. If no firm is acceptable, a time-boxed public bounty on the rehearsal deployment with real funds is the next best substitute.