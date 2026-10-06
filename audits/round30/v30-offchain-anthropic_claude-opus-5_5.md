# Round 30 off-chain audit (v6 tree: crank, alarm, layouts, accrual, swap and revenue, gates)

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 2 |
| LOW | 7 |
| INFO | 3 |

**Method and limits.** I read every bundled file. I did not run anything; no validator, RPC or fork was used. So every finding below states:
- the evidence that would exist if it is true;
- the measurement that settles it.

Where my claim depends on behaviour outside the bundle, I say so. That covers Agave loader-v4 status, the push oracle's update rule, and the round-28 reveal CU. Files not bundled in this pass include SEAL, BURN, GOV, `tests/3prog.test.ts`, `sim/test-vault.ts`, `sim/fixtures.mjs` and `scripts/pob-set.json`. I could not verify claims about them.

---

## R0. Round 29's verdict and repairs

Round 29 was **NOT CLEAN**. It had 3 confirmed off-chain findings, M1, L1 and D1, and the counter is at 0/2. I re-checked its rejected claims C02, C04, C05 and C06 from first principles.

- **C02.** Raw cbBTC per raw wSOL is sats per lamport. The rejection holds.
- **C06.** `\b\d+\b` cannot match inside a base58 address, because there is no word boundary between a digit and a letter. The rejection holds.
- **C04.** The input slot is pinned. The rejection holds.
- **C05.** The rejection holds: `sweptAtaTotal` has no reader.

**The M1 repair holds for the measured attack, but it is narrower than the verdict prescribed.** Two problems survive: R0-1 and R0-2 below.

### R0-1 (LOW). Only one refusal reason was isolated per signature; every other refusal still halts every walk

- **Construct:**
  - `bank/txread.mjs` `validateParsedTransaction`, all `need()` sites except `logs truncated by runtime`;
  - call sites in `alarm.mjs` main loop, `revenue.mjs` `splitsSince`, and `redemption-poster.mjs` main.
- **What happens.** The verdict's repair was: "isolate refusals per signature in all three consumers." The tree instead special-cased the one measured trigger.
  - A `getTransaction` RPC error envelope still throws out of the whole pass. The selftest pins this as "cannot become empty history".
  - So does an unknown `version` or any other schema refusal.
  - The result is identical to the pre-repair M1 behaviour: no findings delivered, no state written, only `run_failed`.
- **Is it attacker-reachable today?** I found no schema refusal a stranger can manufacture today. Every parsed System, Token or ATA shape I walked carries the fields required.
- **When it becomes reachable.** The day mainnet activates a transaction version above 1, any stranger can send one that names MINT as an unused key. The RPC then answers `-32015 unsupported version`, and the alarm, poster and recovery halt again. That costs one fee, exactly the M1 economics.
- **Evidence if true:** the existing selftest arm "RPC refusal cannot become empty history" already shows the throw. Feed that envelope to the source-extracted alarm walk and it throws; it does not page.
- **Fix.**
  - In all three walks, catch per signature.
  - Record `{sig, reason}` as a `tx_unreadable`-class gap.
  - Hold the cursor *for that program only* (not by aborting `main`), and keep running the other walks and the state-based detectors.
  - For a version or RPC-unsupported refusal, page CRITICAL.

### R0-2 (LOW). "Persist the gap until it is acknowledged" was not implemented

- **What happens.**
  - `state.logGaps` is write-only: nothing ever reads it.
  - `log_coverage_gap` has no asset, so `applyAcks` cannot ack it.
  - The kind is classified `'once'`, so it pages a single time.
- **Evidence:** grep `logGaps`. It has exactly one writer and zero readers.
- **Fix.** Either page while unacknowledged gaps exist (a level kind, keyed by signature, ackable by kind:signature), or correct SPEC's description.

### L1 and D1

- **L1 (coverage gate).** Repaired as described: `git ls-files` with recursive pathspecs, plus named exclusions. There is a residual; see R6-2.
- **D1 (selftest source-scan scope).** Repaired: `tests/*.mjs` is now scanned.

---

## R1. The crank (`bank/crank.mjs`)

The plan order and race classification are correct. The new `mintFailureCode` stack attribution is sound. Specific checks:

- **Pre-joins before distribution.**
  - The pre-join `claim` batches carry no pays.
  - `monthly_inline` in those batches waits on `waiting_to_join`.
- **Boost expiry.**
  - Pre-expiry and post-expiry math match MINT's `expire_boost` → `reweigh` (carry, then the level-weight debt).
  - The `w` denominator excludes `retiringWeight` (level plus boost) and `expiringWeight`, and never subtracts twice.
- **Owed-sat prediction for the three cases equals MINT's `owed_of`.** I traced each by hand:
  - joined now;
  - expired before;
  - live boost.
- **Split share.** `splitToPool` uses a hardcoded 1500 bps rather than `split_bps`. That is acceptable only because `split_bps` is fixed at 8500.

### R1-1 (LOW, conditional on a measurement I cannot see). Crank reveals carry no compute-unit limit, so a heavy FIFO head can stall our lane

- **Construct:** `main()` reveal loop. It is a bare `new Transaction().add(reveal_level ix)`, with no `setComputeUnitLimit`.
- **The trigger.** SPEC item 40 (round 28) shows an owner can load the FIFO-head vault with a roughly 10 KB Autograph plus five plugins, and "the actual MINT reveal landed" (R28.A1).
- **The gap.** Nothing in the bundle says what CU that reveal consumed, or whether the suite raised the limit.
  - If it exceeded the legacy default of 200,000, our crank would fail that reveal every minute, the FIFO would stop for every vault behind it, and the lane would page `crank:reveal` plus `reveal_queue_stalled`.
  - Anyone else could still reveal with a raised limit; our job would not.
- **Measurement:** read `computeUnitsConsumed` and the budget instructions of the R28.A1 transaction in `.cache/r28e-full-pass-855.log`.
  - If it is above about 180,000, this is confirmed.
- **Fix (off-chain, cheap).** Always prepend `setComputeUnitLimit(400_000)` to reveals. Also update `planCostLamports` if a priority fee is ever added.

### R1-2 (INFO). The crank pays every orphaned nested vault forever

- **What happens.** An activated vault nested in another vault's PDA reads `'live'`, so every claim batch pays it, spending our fees to deliver into a vault nobody can redeem.
- **Consequence.** No loss beyond fees. The share is owed either way.
- **Option.** Skip vaults that `detectNestedVaults` names. This is cosmetic, because the denominator is unchanged.

**Nothing found that pays a positively burned vault, joins a dead one, or reveals out of order.** On the out-of-order case: `AlreadyRevealed` is checked before `RevealOutOfOrder`, and the run breaks on the first non-ok result.

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### R2-1 (MEDIUM, conditional). Core and the third-party program watches go permanently blind after a loader-v4 migration

- **Construct:** `readConfigs` reads only the BPFLoaderUpgradeable ProgramData PDA. For `NOT_OURS` programs, an absent ProgramData becomes the constant `'NO_PROGRAMDATA'` for both `upgrade_authority` and `hash`.
- **What happens if Metaplex (or Orca, Meteora, Pyth) migrates the program to loader v4.**
  - The bytes and authority move into the program account itself, and the ProgramData account is closed.
  - The alarm pages once: `config_drift prog.core.hash: <hash> -> "NO_PROGRAMDATA"`.
  - From then on it compares `NO_PROGRAMDATA` to `NO_PROGRAMDATA` forever. **No later Core upgrade is ever paged.**
  - Core is the entry SPEC calls the most important. The one page reads like a benign migration, so a human may well close it.
- **Our own programs under the same condition.** If one were migrated before lock, by a stolen deploy key:
  - `prog.<p>._missing` gives only `component_missing` HIGH, never `program_not_locked` CRITICAL;
  - the carried baseline then re-pages `config_drift` every pass, which is loud.
- **Evidence if true.**
  - Check `solana feature status` for the loader-v4 feature (`enable_loader_v4`) on mainnet.
  - On a local validator with it active, deploy a test program, run `solana program migrate`, and run `readConfigs`. The hash freezes at `NO_PROGRAMDATA`.
- **Fix (off-chain).**
  - Also read the program account itself.
  - If its owner is `LoaderV411111111111111111111111111111111111`, decode the v4 header (slot, authority-or-next-version, status) and hash the code that follows.
  - Record the program's owning loader as a watched key, so a loader change is CRITICAL drift with a meaningful value.

### R2-2 (LOW). The round-29 repair turned a halt into a repeatable urgent page for about 5,000 lamports per pass

- **Construct:** `alarm.mjs` `if (tx.logsTruncated)` → `log_coverage_gap` HIGH, `ALARM_KINDS` `'once'`, sent `ALERT_URGENT` with the pass stamp. That means new text every pass, so it breaks through an open stream.
- **What happens.** The stranger shape round 29 measured is 60 memo instructions that merely *name* MINT or BURN as unreferenced keys. A stranger can now generate an urgent email every 30 minutes, indefinitely, for about 0.00024 SOL a day.
- **Why it matters.** This is the one kind whose purpose is "a CBOB event line may have been lost". Training a human to ignore it is exactly the cover a real padded `reschedule_reveal` (also stranger-callable, and also able to lose its `CBOB_REVEAL_RESCHEDULED` line) would need.
- **A precise discriminator already exists.** A CBOB event line can only be printed while MINT or BURN is *executing*. In the measured attack neither program appears as any top-level or inner `programId`.
- **Evidence:** in the round-29 truncation fixture, no instruction in `D.normaliseTx(tx)` has `program ∈ {MINT, BURN}`. The current code still emits HIGH urgent.
- **Fix.**
  - If no top-level or inner instruction invokes MINT or BURN, record the gap at INFO, because no event can be missing.
  - Page HIGH only when one of our programs actually executed.
  - Keep the cursor advance as it is.

### R2-3 (LOW). SPEC item 53's "every report and every notice says REHEARSAL" is false for recoveries and for the crank and revenue jobs

- **Construct:** in `planAlarmNotices`, the recovery text is `CBOB vaults: ${kind} RECOVERED...`, with no rehearsal tag. `crankNotices`, `revenueNotices` and the `FAILED TO RUN` notes carry none either.
- **Why it matters.** Recoveries are the dangerous direction. If a rehearsal runs without the documented separate `ALERT_STATE_DIR`, a rehearsal RECOVERY on `cbob-vault-alarm:<kind>` closes a production stream of the same kind.
- **Fix.**
  - Thread `rehearsal` into recovery text and into the crank and revenue notices.
  - Better: in rehearsal mode, give labels a distinct prefix (for example `cbob-rehearsal:`), so a stream collision is impossible regardless of operator discipline.

**No other dangerous state read as quiet, beyond the accepted ones.** I checked: pending operator or guardian, PoB collection plugins and authority, near-cap redemptions, frozen or insolvent pool, overdue distribution, five-program lock, and the production pins (21/51/3 days, 7 days, 1 SOL / 24 h / 0.1 SOL, 30 days, 3600 s).

---

## R3. The layouts (`bank/layout.mjs`)

All assertions I traced are real and fail both ways:
- field lists, via strict `parseRustStruct`;
- every scraped `OFF_` constant;
- versions, the boost ring, and `*_SPACE` minus padding;
- seeds. D6 is genuinely asserted now: 11 of 11, plus mutation arms.

The reveal-lane `memcmp` at `offsets('VaultRecord').level` = 57 is correct. No finding.

---

## R4. The money arithmetic (`bank/accrual.mjs`, crank owed prediction)

These functions agree with MINT, including the carry-before-debt ordering in `owed_of` and ceil rounding:
- `credit`, `pendingScaled`, `reweigh`, `ceilSats`, `available`.

`retire` is not mirrored, and that is stated.
- The alarm treats `cbob_mint`, `max_boost_weight` and `max_boost_epochs` as CRITICAL fixed-forever values.
- It pages `boosts_stalled`.

No divergence found.

---

## R5. The swap and the revenue cycle

### (a) through (g): the mechanics are correct

**(a) Oracle math.** `num = L·P_sol·10^(e_s−e_b)`, `den = P_btc·10` is correct for every sign of `e_s−e_b`. The rounding direction is down, which is conservative. `satsPerLamport` uses Number on mantissas below 2^53 (C23 holds).

**(b) Pyth account.** The offsets are correct for the Full verification variant:
- feed at 41;
- price 73, conf 81, expo 89, publish_time 93.

Ownership plus a derived address does not stop a third party posting *a newer genuine* update. So the residual is "a genuine Pyth price chosen within the last 180 s". That is bounded by real price movement and was accepted in round 29 (C12). I did not measure whether the push oracle refuses older updates.

**(c) Deviation filter.**
- `orcaSpot` is B per A in raw units, which is sats per lamport.
- `meteoraSpot` is correctly inverted (Y per X raw is lamports per sat).
- Floating-point error is far below 1 bp.

**(d) Minimum out.** Both venues carry `minSats` in sats at data offset 16. That is the same floor the delta check uses.

**(e) The judge.** It is complete for value-moving roles:
- an exact 7-instruction sequence;
- no `SetComputeUnitPrice`, no extra budget instructions;
- the ATA creations pinned exactly.

It does not check Meteora `host_fee_in`, slot 9 (C16, optional). A tampered builder could route the host-fee fraction of the fee only.

**(f) Account derivation.** All three are correct:
- Orca tick-array starts use shift 0 for a_to_b;
- Meteora bin arrays use floor division for negative ids;
- Meteora's account order matches its IDL.

**(g) wSOL handling.** wSOL has no freeze authority. A delegate needs the owner. A pre-existing balance B is returned by the native close. Unconsumed input is returned the same way.

### R5-1 (MEDIUM, economic). The 150 bp oracle floor makes sandwich extraction the expected outcome, not a worst case

- **Construct:** `SWAP_TOLERANCE_BPS = 150`, and the transaction is sent through the public path. The deviation gate is read-time only, which SPEC says.
- **The numbers.**
  - Measured honest execution at the ruled 10 SOL cap is 31.6 bp (Orca) and 32.9 bp (Meteora) under the oracle (SW.8, SW.9).
  - A sandwicher can therefore take about 115 to 120 bp per cycle without violating the floor.
  - Per cycle that is about 0.12 SOL. At saturation (4 cycles a day) it is about 0.47 SOL a day, or about 14 SOL a month. That is about 1.2% of all royalty revenue.
  - The extraction needs no oracle or pool manipulation.
  - A pool pushed to the 100 bp edge, or a stale-but-accepted oracle, does not raise the cap: the floor binds.
  - Meteora is about 10 times thinner, but it is equally bounded by the floor.
- **On disclosure.** The accepted text ("do not establish a hard bound") and the holder guide ("up to 1.5% below Pyth") are true. They describe a ceiling where the realistic steady state under MEV is *at* that ceiling.
- **Evidence:** on the fork, front-run a swap with an attacker trade sized to push the execution to `minSats`, then back-run. The operator's delta equals about `minSats`, and the attacker's profit is about 1.15% of 10 SOL.
- **Fix (off-chain, mutable, no program change).**
  - Set per-venue tolerance at measured impact plus fee plus about 30 bp. For example, about 70 bp on Orca at the 10 SOL cap, scaled with size.
  - Submit swaps privately: a Jito bundle, or a staked-RPC / leader-direct send.
  - State the expected MEV cost in the honest list.

### R5-2 (LOW). A send classified "refused" on an expired transaction with no status trusts one RPC lookup

- **Construct:** `classifySendFailure`, branch `if (!st && expired) return 'refused'`. It is used before trying the next venue.
- **What happens.** Behind a load-balanced RPC, a swap that landed in the last valid block can be invisible to the node that answers `getSignatureStatuses`.
  - The loop then tries Meteora.
  - That second swap succeeds only if the operator still holds `lamportsIn`. That is true whenever the swept amount is at or below the 0.02 SOL float plus top-ups. The code has no minimum sweep, so that is reachable.
  - Value then ends up in cbBTC and is returned. It is not lost, but it is double-swapped and the float is drained.
- **Fix.** Before trying the next venue after any non-preflight "refused" verdict:
  - re-read the operator's lamports and its cbBTC balance against the values recorded before the attempt;
  - proceed only if both are unchanged.

### R5-3 (LOW). Dust above the reserve makes the revenue job fail every hour

- **Construct:** `revenue.mjs` sets `amount = balance − reserve`, and then `market()` → `oracleFloor` throws "buys no whole sat" when `minSats ≤ 0`. That happens below roughly 14,000 lamports at current prices.
- **What happens.** A stranger, or one tiny royalty, sending about 10,000 lamports to the revenue PDA right after a sweep makes every live run after the cooldown fail at stage `market`. It keeps failing until royalties grow.
  - No SOL moves, because the market stage runs before the sweep.
  - But the `cbob-revenue:market` stream stays open with a constant text. With ALERT_ON_CHANGE, a later real market failure only breaks through if its text differs.
- **Fix.** Treat `amount` below a minimum swappable size as "nothing to sweep". For example, require `minSats ≥ 1,000` or `amount ≥ 0.01 SOL`.

### (h) Failure and retry, and the ledger

Apart from R5-2, every path keeps the cycle open until a cbBTC return delta of at least the floor is observed:
- the intent row is written before the send;
- an unknown verdict throws with a `pending*Sig`;
- the open-cycle guard and `closesCycle` share one predicate.

I found no path that reads a failed cycle as closed. The worst cases:
- `sendRejected` on a sweep that actually landed is caught by `unledgered_sweep` CRITICAL;
- `splitByOther` needs a chain anchor.

### The operator key's worst case, re-bounded

- The key can keep 10 SOL every 6 h until the guardian stops the sweep.
- It can also keep the swapped cbBTC between the swap and the return. That is the same value, in a one-transaction window.
- It can spend the float.

The trust set is now:
- the Orca, Meteora, Pyth receiver and push programs, plus their upgrade keys;
- the single RPC (it supplies prices and the Clock);
- the box itself.

The RPC is the newly central item. A lying RPC can return a fake Clock and fake Pyth accounts. Those are owner-checked, but the RPC also supplies the owner field. So a malicious RPC can set any floor up to the 10 SOL cap. Limit 10 (b) states this.

---

## R6. The gates

### R6-1 (INFO). Many arms only check source text

Several arms are regex checks on source text. Examples: "sends ALERT_URGENT", "judges each element", the L4 marker/label arm, and the H1 bare-label arm. They catch deletion, not behavioural regression.

They are not vacuous. Each has a non-empty subject. But "armed in both directions" overstates them. The behavioural extractions (the walk, report and reconcile harnesses) are the real proofs.

### R6-2 (LOW). The coverage gate certifies "bundled", not "read"

- **What happens.** The gate counts a file covered once any `scripts/audit*.ts` TARGETS literal names it.
  - That includes a *prepared* round no model has run.
  - It includes rounds where models returned nothing (GLM's `FETCH FAILED` would still count).
  - Ship gate 1 is therefore satisfiable before any auditor reads the file.
- **Also excluded.** `scripts/audit*` excludes `audit-coverage.sh` itself, which is a ship-gate instrument (it is bundled here).
- **Also unverifiable here.** This off-chain bundle does not include `sim/fixtures.mjs`, which round 29 required for round 30. If the programs pass does not carry it either, L1's repair is satisfied on paper only.
- **Fix.**
  - Count coverage from a manifest of completed substantive reports (`finish: stop`, in the counted quorum).
  - Remove `audit-coverage.sh` from the exclusion.

### Gates that check out

- **`build-mainnet.sh`** proves what it claims:
  - the behavioural key arms, both ways, for four programs;
  - the sweep bytes equal both the localnet build and `target/deploy`;
  - exactly five artifacts.
  - It does not pass `--locked`. A drifted `Cargo.lock` would be rebuilt silently; the reproducibility bridge assumes a locked build.
- **`cron-install.sh`** arms nothing unintended:
  - the anchored `ours()` match;
  - the rehearsal refusal runs before any read;
  - six jobs, all under `flock -n`.
- **Floors equal counts.** I counted the mainnet probe: 1 + 4 + 15 + 8 + 5 = 33. `SWAP_FLOOR` 16 matches the 16 `rec()` calls in `sim/swap-fork.mjs`.

---

## The accepted limits: the four questions

### 1. Worse than stated

- **Limit 10.** The "no hard bound" text is true, but under public submission the floor is the *expected* fill: about 14 SOL a month at saturation (R5-1). The honest list should state that number.
- **Limit 40 and the alarm's "watches `prog.core.*`".** After a loader-v4 migration the watch is permanently blind (R2-1). "Detects, cannot prevent" then becomes "does not detect".
- **The reader coverage boundary (rounds 28-29).** The repair hands a stranger a repeatable urgent page (R2-2). The "loss" class remains reachable by a padded permissionless `reschedule_reveal` or `claim`.
- **Items 9 and 44, round 29 D2, and the holder guide.**
  - The permanent dilution of *every other* holder by an orphaned activated vault is now in SPEC.
  - It is not in HOLDER-GUIDE's honest list. The guide only says "destroyed when the vault is opened".
  - Anyone can manufacture it deliberately: nest an activated vault B into vault A, then bare-burn A. The cost is B's own contents, so it is griefing, not profit.
  - It is largest while few vaults are active: early on, one Level V can take several percent of every distribution forever.
  - Add it to the guide.

### 2. Listed as a limit but not one, or already closed

- **Limit 25.** It cites the 300.8-second `Connection` hang "at `2b67fb1`", which implies a later fix. No timeout was added: the crank and revenue still use the default `Connection`. This is a wording precision point, already disposed as C11.
- **Item 42.** It already concedes the narrow shape fits with all three creates. This is correctly framed as a client contract, not a limit.

### 3. "Discharged" items that are not fully discharged

- **Item 54.** "The bank's crank is unaffected" rests on measured reveal and capture CU. It does not cover the round-28 heavy-autograph FIFO head. Unproven until R1-1 is measured.

### 4. Open-and-blocking items quietly treated as accepted

- **Item 22** (live rehearsal, the revenue cycle through both pools, the forced recovery) and **item 53's rehearsal value set and checker mode** are still unbuilt. Nothing marks them accepted; they remain open.
- **Ship gate 1 is being met by "prepared" bundles** (VALIDATION: "passes on prepared coverage"). That is a soft demotion of the coverage requirement (R6-2).

---

## Other

### X-1 (INFO). The selftest's R29 alarm arm uses the fixture's fee payer as a stand-in "vault PDA"

That is valid as an instruction-detector proof. It does not show the detectors catch a *real* vault-PDA approval or account creation inside a truncated transaction. A second fixture with a genuine vault PDA would make the arm faithful.

---

## Given that no human firm will see this and the programs will be immutable: what to do before launch that AI audit structurally cannot

1. **Run the live dress rehearsal with item 22's named pass/fail list, and archive every signature.**
   - Include an adversarial day:
     - a stranger spamming padded, truncated-log transactions naming MINT, BURN and the revenue ATA;
     - a black-holed RPC socket for the crank;
     - a dust deposit to the revenue PDA;
     - a heavy-autograph FIFO-head vault revealed by the crank as installed.
   - Record what paged, what stalled, and how long a human took to respond.
2. **Get an independent reproducible build on a second machine and a second operator.** Rebuild from the release commit and compare all five sha256 values with `dist/SHA256SUMS`. After deploy, compare the on-chain ProgramData ELF hashes too (`solana-verify` or a manual dump). Then remove the authorities in a witnessed, recorded session, and re-read each ProgramData Option tag afterwards.
3. **Run a second, independent alarm off this box.** Use a different machine, a different RPC provider, and a minimal watch: the five upgrade authorities, Core's program owner and loader (see R2-1), the pool balance against `owed`, the PoB collection plugins and authority, and pending guardian or operator. This is the only answer to limit 10 (3), box-owner compromise. AI review of the same tree cannot provide it.
4. **Measure, on mainnet, the facts this report had to leave conditional:**
   - loader-v4 activation, and whether Metaplex intends to migrate Core;
   - whether Pyth's push oracle refuses non-increasing `publish_time`;
   - Helius `getSignaturesForAddress` indexing of unreferenced keys;
   - the CU of a heavy-autograph reveal.
5. **Run a priced MEV test.** Run the 10 SOL fork swap against a scripted sandwich, then set the per-venue tolerance and a private-submission path from the measurement. All of it is off-chain and mutable, so it can be tuned after launch.
6. **Run a paid public bug bounty and a canary period at throwaway program IDs** before the charter opens. Use small real value, the real crank and alarm, and real third parties invited to break it.
7. **Get a human legal and plain-language review of HOLDER-GUIDE against SPEC's accepted limits.** Include the dilution, MEV and hot-key items. Publishing is gated on item 50; the guide's present-tense promises must match the pages actually shipped.
8. **Hold custody ceremonies with witnesses, decided now:**
   - the PoB collection key during the 7-day window (limit 46: the single largest project-ending risk);
   - the `$CBOB` release key;
   - the swap operator key.

   Each needs a written incident runbook: who pulls `emergency_stop_sweep` or `emergency_stop_sales`, and how fast, rehearsed as a timed drill.