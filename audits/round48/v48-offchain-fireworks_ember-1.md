# Round 48 — Off-chain pass: independent audit of the final tree

I read the whole bundled tree against MINT and the sweep helper, re-derived the arithmetic, and re-tested round 47's repairs at their constructs. I found **one LOW**, in the alarm, outside (a)–(d). Everything else I attacked held; I say what I measured and what I could not.

I did not run the suite, the fork, the sim, or any live pass; where a claim rests on a measured run I say what on-chain evidence would exist if my reading were wrong.

---

## R0 — Round 47's verdict and its repairs

Round 47 was LAUNCH-CLEAN with nine LOW/INFO, all outside the five programs, all repaired at `bba189a`. I verified each repair in this tree:

- **V47-1 / V47o-4 (untracked rounds stopped the suite):** `readme-facts.mjs` `audits()` now reads `git ls-files -- audits/` (tracked only) and `auditFacts` is pure. The selftest arm builds a worktree with an untracked `audits/round999/VERDICT-programs.md` and asserts `generate(wt)` is unchanged and no "rounds … to 999" appears. Holds.
- **V47-2 / V47o-5 (NONE published as owing repairs):** the regex is now `/^REQUIRES CHANGES: (?!NONE\b)\S/m`; the arm drives NONE/NONE → "none", a named change → "not yet validated", a VALIDATION.md → "validated". Both ways. Holds.
- **V47-3 (suite R.4 reads the raw plugin registry, R.4b AppData control):** programs-pass territory; the on-chain floor in `run-tests.sh` is 913 and the floor must EQUAL the count. Noted, not re-judged here.
- **V47-4 (ceremony hands the judge its measured compute floor):** `ceremony.test.mjs` asserts the page source calls `signExact(..., { minUnits: sim.unitsConsumed || null })` and that a wallet limit of 1 is refused by name while Phantom's 200,000 passes a 150,000-unit step. Both ways. Holds (the page source itself is the other pass's; the arm's subject here is the judge, which is tested).
- **V47-5 (judge refuses a demoted writable / removed signer):** `tx.test.mjs` drives a wallet that demotes a writable to read-only and expects refusal by name. Holds.
- **V47-6 (README SEAL/BURN wording):** `readme-facts.mjs` `programs()` rows now say the sweep helper pays the reserves out through Core; the arm asserts no "SEAL … holds" / "BURN … pays". Holds.
- **V47-7, V47-8, V47o-3 (SPEC 22/53 restated; Gary's 2026-10-10 ruling on 22.2; the road row):** SPEC item 22 now carries "Recorded on mainnet (round 47, V47o-3): … 22.2 FAIL, a true detection … RULING, Gary 2026-10-10: 22.2 is accepted as passed", and road row 8 carries the FAIL. `readme-facts.mjs` `short()` cuts row 8's state at the first `:`, which falls after "…scale not exercised", so the generated row keeps "22.2 FAIL accepted by Gary". Holds.
- **V47-9 (proxy comment):** `web/deploy/rpc-proxy.mjs` is not in this pass's bundle; not judged here.
- **V47o-1 (PASS written as invalid JSON, re-ran forever):** `core-watch-suite.sh` `res()` now builds the result with `node -e` `JSON.stringify` to a tmp then `mv`; `core-watch.mjs` `suiteStatus` returns `{status:'unreadable'}` on a parse failure and `decide()` treats it as finished — one URGENT "unknown, treat as failed", never a restart. The selftest extracts the real `res(){` line and drives `decide()` both ways. Holds.
- **V47o-2 (private validator lock):** `scripts/validator-lock.sh` is new; all five runners take `flock -n` on fd 9 **before** installing their EXIT trap and boot the validator with `9>&-`; the diagnostic waits on the same lease with `flock -w 43200 9`; `run-tests.sh` re-hashes the booted Core against the pin after the build. The selftest arms prove a killed holder frees the lock, an inherited fd 9 is admitted, and every runner's lock precedes its trap. Holds.
- **V47o-6 (Core watch in the installer):** `cron-install.sh` installs eight jobs including `core-watch` (flocked, off the */10 tick) and `core-watch-deadman` (fires on a missing state file as well as a stale one); the selftest's job-list arm moved with it. Holds.
- **V47o-7 (a second Core change orphans the first result):** `decide()`'s `prior` loop emails an earlier build's unsent finished result once, marked as earlier. Armed both ways. Holds.
- **V47o-8 (mock lacked `getTokenAccountsByOwner`):** `mock-rpc.mjs` now serves it per token program with the 8-byte slice and full `space`, and the MOCK_ADVERSARY hook lives there; `plan.test.mjs`'s V47o-8 arm asserts neither plan carries an `unlisted` box. Holds.
- **V47o-9 (clean clone):** `run-tests.sh` dies naming a missing `dist/` before the page tests, after the [3/7] build; the arm pins the guard's position. Holds.

No regression found in the bundled tree. The V46o-2 rollback (`alarm.mjs` restores `unreadPasses`/`unreadSkips` with the cursors on an undelivered pass) and V46o-3 (load-time refusal pages through the literal production notifier, before any `rehearsalOnly` read, in both `revenue.mjs` and `alarm.mjs`) are present and armed.

---

## R1 — The crank (`bank/crank.mjs`)

I looked for a plan the program refuses, a plan that pays or joins a dead vault, an out-of-order reveal, and any value movement the program does not pin. None found.

- **Order:** main() sends reschedule → capture → reveal (in mint order, breaking at the first skip/failure) → rescue → retire → pre-joins → pre-expires → split → distribute → post-expires → activate → claims. That satisfies `JoinWaitingFirst` and `BoostsExpireFirst` before any distribution, and the activate-after-distribute order red-team 3 finding 6 required.
- **Dead vaults:** `planCrank` retires any positively burned vault (`retireBurned`) and never joins or pays one; an asset reading `other` (null RPC) is not joined, not paid, and suppresses the distribution (`unreadableEligible` → `joinable = false`), with a problem recorded. A retired vault's freed share is subtracted from `owed_scaled` before the distribution is planned (round 24 I1), and its weight leaves the denominator.
- **The crank cannot mis-pay:** the amount of every claim is computed on chain from the record; the crank only chooses *which* vaults to include. An over-estimate sends a claim the program skips (`pay == 0 → continue`); an under-estimate delivers next pass. A stranger's claim between plan and send changes neither `avail` (balance and owed fall together) nor causes a double-pay (the record's debt moved).
- **The `w` the crank plans with** (`total_active_weight + preJoinWeight − retiringWeight − expiringWeight`) matches the program's denominator at execution, given the send order. The joined-now vault's owed (`w × (acc_new − acc_old)`) and the expired-boost vault's owed (carry at the old accumulator plus level weight on the delta) match `join`/`reweigh`/`owed_of` line for line.
- **Reveals:** planned strictly from `revealed_total`; a vault whose asset reads neither live nor burned ends the run before any send (the V43o-3 arm runs the real loop); `[]` is sent only for a positively burned asset; the attribute hash is checked against the stored `attrs_hash` before a fee is spent, and a list already carrying `level` is the benign race.
- **Fee payer:** `budgetPlan` runs the base plan whenever the key covers it, keeps the 0.005 SOL floor in reserve before any reveal, drops reveals in mint order and pages the drops; above 0.25 SOL it runs and warns once a day. The key signs only as fee payer; the selftest pins the instruction set to the ten permissionless MINT calls and no transfer construction.
- **Refusal classification:** `mintFailureCode` attributes an AnchorError to MINT by the invoke stack and returns null on a CPI failure or unavailable logs (fail-closed); `judgeDistributeRefusal` treats the race codes as benign only when the epoch or `last_distribute_at` moved, and `PoolShort` never. `NoActiveVaults` is not benign — the one round-trip race (someone else retires the last waiting vault between plan and send) pages once, one fee, no value effect; settled in rounds 23/31 and re-confirmed by round 47 (C14), so not re-filed.

---

## R2 — The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

### LOW — `detectPdaTokenAccounts` pages CRITICAL on token accounts for BURNT vaults' PDAs

**Construct.** `bank/alarm.mjs` builds the sets asymmetrically:

```js
for (const v of [...vaults, ...burnt]) { const p = pda(...); pdas.add(p.toBase58()); ... }   // live + burnt
for (const v of vaults) { ...; for (const m of ataMints) atas.add(ata(...)) }               // live only
...
...D.detectPdaTokenAccounts(ixs, pdas, atas)...
```

`detectPdaTokenAccounts` (detectors.mjs) fires `non_ata_token_account` CRITICAL whenever a token account is created for a wallet in `pdaSet` whose address is not in `expectedAtas`. A burnt vault's PDA is in `pdas`; its canonical reserve ATAs are not in `atas` (it is not live). So **any** token-account creation for a burnt vault's PDA, seen inside a transaction the alarm scans, pages CRITICAL.

**Why it is vacuous.** The finding's own text is "burn_vault checks only DECLARED accounts, so this balance is destroyed with the vault unless someone declares it. The holder must declare it in their redemption." A burnt vault has no redemption left: the asset is a 1-byte tombstone, `burn_vault` can never run on it, its PDA can never sign again, and anything sent there is already stranded (a bare burn strands the reserve contents; `retire_burned` returns only the unclaimed *share*, never the reserve accounts). There is nothing left for the finding to protect.

**What an attacker gains.** Alarm fatigue on the CRITICAL stream, at real but bounded cost. The creation must ride in a *succeeding* transaction touching one of the four programs (the alarm skips `s.err` and only walks our programs' signatures), so a griefer bundles the create with any succeeding permissionless MINT call. Each false finding carries a fresh account address, hence new text, so each one breaks through the router's open-stream suppression as URGENT. Cost per page: one fee plus ~0.002 SOL of rent stranded forever (the burnt PDA can never close the account). Roughly 0.1 SOL pages the CRITICAL stream every pass for a day.

**Evidence if I am right.** Redeem any vault (the sweep closes its reserve ATAs), then send one transaction that (i) calls a succeeding permissionless MINT instruction and (ii) re-creates that vault's cbBTC ATA. The transaction appears in MINT's walk; the next alarm pass emits `non_ata_token_account` CRITICAL naming the burnt vault's PDA. A selftest arm proves it both ways: today `detectPdaTokenAccounts` with the burnt PDA in `pdas` and its ATA absent from `atas` fires CRITICAL; after the fix it is quiet, and a live vault's non-canonical account still fires.

**Fix.** Build the PDA set for this detector from live vaults only (a token account for a burnt vault's PDA is not at risk of being "destroyed by the burn" — the burn already happened). Keep the live+burnt set for `detectApprovals` (an approve needs the PDA's signature via Core Execute, unreachable on a tombstone) and `assets` for `detectBurns`.

**Class:** outside (a)–(d) — alarm only, no value path, no crack, LOW. Fixable layer; fix and arm both ways, does not block launch.

**Everything else I attacked in the alarm held:** the per-kind streams and one-shot/level classification (every kind emitted is classified, and the table names no kind nothing emits — both directions); the freeze transition (pages once, stands at INFO); the sweep-from-state check (skew-proof half-cooldown window, smallest-seen cooldown, direct status lookup for uncertain sends); the split anchoring (chain-time, amount-covered, consumed once); the backlog drain with positive proof; the unreadable-signature skip after three passes with the level page; the carried baselines across a one-pass null read (config, reserves, SEAL-null ATA maps and reconcile); the production value pins (21%/51%/3-day, 7-day notice, tighten bounds, 30-day month, one-hour window, census, mints, PoB root and collection, $CBOB mint and boost ceilings); the five programs' upgrade authority past the earlier of `lock_deadline` and `charter_opens_at`; and the third-party program watch at HIGH.

---

## R3 — The layouts (`bank/layout.mjs`)

The assertions are real. The selftest parses each `pub struct` out of the Rust and requires field-for-field equality (a private or `pub(crate)` field makes the parser throw, not silently drop); every cross-program `OFF_` constant in GOV, BURN and MINT is scraped and compared to the computed offset, with an explicit arm that nothing scraped goes uncompared; the layout versions and `BOOST_RING` are scraped; `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are scraped, evaluated and held to the layout's fixed lengths; the suite's own `OFF_` constants are compared. **Round 24 D6 is closed:** `SEEDS` is now asserted against each program's `*_SEED` constant (`judgeSeeds`, 12 of 12), with arms that a mistyped seed and an undeclared one are both caught. A struct edit that is not mirrored here turns the build red.

---

## R4 — The money arithmetic (`bank/accrual.mjs`)

`credit`, `ceilSats`, `available`, `pendingScaled` (`owed_of` with boost and carry), `reweigh` and `debtAtActivation` are the Rust formulas line for line; I re-derived each against MINT's `credit`, `owed_of`, `reweigh`, `ceil_sats` and `join`. The crank's per-vault owed (plain, joined-now, expired-this-pass) matches the program's computation at the post-distribution accumulator, and the crank expires every due boost before the distribution and every boost its own distribution makes due right after; the alarm pages `boosts_stalled` and watches `cbob_mint` and the boost bounds as fixed-forever CRITICAL. No divergence.

---

## R5 — The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

**(a) Oracle math.** `sats = lamports × sol.price × 10^(sol.expo−btc.expo) / (btc.price × 10)`; the exponent split (multiply the numerator for e ≥ 0, the denominator for e < 0) is exact for every sign in the bounded [−18, 0] range; both divisions floor (conservative); `minSats = expectedSats × 9850 / 10000` floors again. BigInt cannot overflow here (worst case ~4.5e47). `satsPerLamport`'s Number conversions are of ~1e10–1e13 integers, exact in doubles. The hand-pinned arm (280,355 expected / 276,149 minimum at 150 bps) holds.

**(b) Pyth verification.** The account is derived (shard 0 under the push-oracle program) and must be owned by the receiver program; Solana ownership means only the receiver program can write its data, and it writes only Wormhole-verified prices. A *chosen* price is impossible without forging guardians; an *old but valid* price is possible to post and is refused by the 180 s age check (and the 30 s future check), both judged against the chain's Clock sysvar read in the same batch, never the box clock. The `PriceUpdateV2` offsets (level at 40, feed 41..73, price 73, conf 81, expo 89, publish 93) are correct for `Full` and are exercised against the real cloned accounts in the fork. Ownership plus derivation is sufficient given the age and confidence checks.

**(c) Deviation filter.** `orcaSpot` = (sqrt_price/2⁶⁴)² in raw units = sats per lamport; `meteoraSpot` = 1/(1+bin_step/10⁴)^active_id = sats per lamport (X is cbBTC, Y is wSOL — the inverse of Orca's orientation, correctly). The selftest drives 99 bps (used) and 101 bps (skipped) on both sides of both venues through the real `market()`; floating-point error is ~1e-11 bps, immaterial against the 1 bps margin.

**(d) Minimum out.** Orca's `other_amount_threshold` and Meteora's `min_amount_out` both carry the same `minSats` (oracle less 150 bps, floored), in cbBTC sats, at offset 16 in both instruction layouts — the same floor the deviation filter assumed, in the units each program expects. The fork proves a floor 5% above the oracle is refused by each program with nothing moved.

**(e) The judge.** It requires the exact seven-instruction sequence and independently checks: the single bounded compute-unit limit and no price anywhere; both ATA creations for the operator's own wallet and mint at the derived addresses; the one System transfer of exactly `lamportsIn` into the operator's own wSOL account; SyncNative of it; the swap naming the pinned pool with the operator's wSOL in and the operator's own cbBTC ATA out, amount `lamportsIn`, threshold `minSats`, and for Orca exact-input, a_to_b, at the minimum price limit; and exactly one close back to the operator, last. No second signer anywhere; no Token instruction but SyncNative and CloseAccount. The unchecked keys (Orca's token program, vaults, tick arrays, oracle; Meteora's bitmap, reserves, mints, oracle, bin arrays) are validated by the venue program against the pinned pool on chain. Meteora's `host_fee_in` (key 9) is the one unpinned value-moving slot — settled as ALREADY STATED (limit 10(c): it needs a changed builder in this tree; the on-chain floor and the post-swap delta check bound the output; rounds 36–47). Not re-filed.

**(f) Derivations.** Orca's three tick arrays (current, two below, floor division, boundary-inclusive) and Meteora's three bin arrays (active, two above for Y→X) match the published interfaces; the selftest pins the boundary cases and the fork proves the real programs accept them against real state. An uninitialized array is an on-chain refusal → classified refused → the other venue or an open, loud cycle.

**(g) wSOL.** Wrap exactly `lamportsIn`, sync, swap exact-input, close back to the operator. A pre-existing balance or an unswapped remainder returns to the operator at the close; a frozen account fails the SyncNative and reverts the whole transaction (refused, safe); a delegate cannot act inside the atomic transaction; the ATA is the operator's regardless of who paid for it.

**(h) Failure and retry.** Meteora is tried only on a *refused* Orca attempt (preflight refusal, on-chain failure, or expired-never-landed, all read off the chain by `classifySendFailure`); an unconfirmed send stops the cycle open and loud, never a second swap. A landed-but-unconfirmed send is recorded and continued. Every path leaves the ledger open until a cbBTC return at or above the floor is proven and a split is anchored on chain; a wrong "refused" is caught by `sweep_on_rejected_row` and the state-derived sweep check, a wrong "landed" requires the chain to say success. The ledger cannot read a failed cycle as closed.

**(i) Extraction within tolerance.** The on-chain floor caps any sandwich, pool-push or thin-Meteora manipulation at the 150 bps tolerance less fee and impact — about 0.15 SOL per 10 SOL cycle, ~0.6 SOL/day at the ruled cadence, of royalty SOL only. A stale-but-accepted oracle (≤180 s, ≤30 bps confidence) plus a pool at the 100 bps edge is bounded by the same floor relative to the oracle; a manipulated oracle either skips the pool (deviation) or refuses the swap (floor). This is the accepted limit-10 residual, accurately stated. The operator key's worst case is unchanged: cap × cooldown windows until the guardian stops it, never more than the revenue PDA holds above the reserve, with the alarm's chain-anchored reconciliation behind it.

---

## R6 — The gates (`bank/selftest.mjs`, `scripts/run-tests.sh`, `sim/swap-fork.sh`)

- **Floors cannot be satisfied by deleting work:** every floor must EQUAL its count (not merely reach), the detector floor is stored twice and the copies are compared, SPEC's stated counts are checked at every occurrence, and the README's generated numbers come from the same sources. Lowering one silently requires a consistent edit across four files, visible in the diff the next round reads.
- **No vacuous-when-empty check found:** the kind-classification arms guard `emitted.length > 60`; the SPEC-count reader requires at least one occurrence; the id-mutation arm requires all 14 copies; the wiring gate is backed by the detectors being driven directly (a deleted detector crashes its own arms); the web floors sum to 805 and `run-all.mjs` requires each file's count to equal its floor, with "did not finish" failing.
- **Both directions:** the round-24-and-later sections drive each repair red under its mutation (the V46o-1 ack arm on the ackable kind, the V46o-2 undelivered-pass rollback, the V45o-4 flood-proof retry count, the V43o-2 unreadable skip, the R34 closesCycle equivalence over 400 random cases plus a deterministic `upTo` arm, the R32/R33 sweep-state window edges at ±half-cooldown). I did not find an arm that cannot fail.
- **`build-mainnet.sh`** proves all four keyed programs reject the test key in the mainnet build and accept it in the localnet one (behavioral, both directions), and proves the sweep helper's mainnet bytes identical to the localnet build *and* to the `target/deploy` bytes the suite deployed — the strongest proof available for a keyless helper.
- **`cron-install.sh`** arms `--live` only from our own tagged, uncommented lines (the selftest runs the real extracted shell against commented, prose, foreign, reveal-lane and flag-order variants), installs exactly the eight jobs, and wraps every node job in `flock -n`.
- **The swap fork** requires 16/16 with `SWAP_FLOOR=16` equal, and the ship gate refuses a skipped probe or fork.

---

## web/test/ — can each test fail when its property breaks?

Yes, on what is bundled. Each file's count must equal its floor in `run-all.mjs` (a file that stops early fails), and the arms are both-ways: the bundled `planRedemption` is compared to node's byte-for-byte on six snapshots with a non-trivial-length guard; the ceremony steps are compared to the suite's own extracted builders field-by-field; the Phantom-wrap arms have explicit controls (the additions alone refused; a stranger's transfer riding refused; a demoted writable refused by name); the build-refusal arms have an exact-copy control; the README hash table is rebuilt fresh and compared; the mock is driven over real HTTP. Two test files import `web/deploy/rpc-proxy.mjs` (`txRefusal`, `refusal`, `gpaShape`), which this pass does not carry — the arms that assert the relay accepts the pages' shapes and refuses the wallet's additions alone are both-ways with respect to the proxy, but the proxy's own logic is the other pass's subject, and I make no claim about it.

---

## The accepted limits, attacked

1. **None is worse than stated.** I checked the ones with moving parts against the code: limit 7's stall detectors (`crank_silent`, `royalties_unswept`, `distribution_overdue`, `reveal_rescheduled`) exist and are wired; limit 10's bound (cap × cooldown, ~34 SOL/day at the ruled cadence, hourly job on the chain clock) matches `sweepAmount`, `sweepCooldownOver` and the cron period; limit 27's "the crank never pays or joins a positively burned vault and retires it first" is true of `planCrank`; limit 28's freeze handling (defer, forfeit-on-redemption, frozen-pool tick and joins) is in the planner and the detectors; limit 32's ring arithmetic is mirrored exactly in `redemptionCapacity`; limit 40's Core watch exists and is now installed and deadmanned; limit 55's unsplit-revenue edge is bounded by the crank splitting every pass; limit 58's rescue is planned and sent every full pass with the destination pinned on chain.
2. **Nothing listed as a limit is already closed** that I could find; the stated blind spots (foreign nested assets, the box-owner residue, the one RPC) are real.
3. **No DISCHARGED item is actually open:** 51 (boost: `preExpires`/`postExpires`/`boosts_stalled` verified), 54 and 12/17 (compute measured; the crank sends captures and reveals singly), 14, 19, 30 (`split_bps` written once, no `update_wiring` in MINT), 31, 33 all hold against this tree.
4. **No OPEN AND BLOCKING item is quietly treated as accepted.** Items 22 (scale), 38, 50, 52, 53 remain open; `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline` and `vault_collection` as OPEN (verified in the bundled file). Note, stated not filed: item 53's last in-tree run is `e7c192a`; the current tree (round 47's repairs) has not had it, and SPEC item 53 says exactly that.

---

## Anything else

- The carried gate-5 obligations round 47 lists as still open (the `bitmapExists: !!bm` pin among them) are obligations, not defects: the bitmap address is a PDA of the Meteora program seeded with the pool, so only Meteora can create it and existence implies authenticity; the swap is proven against the real state in the fork regardless.
- `core-watch-suite.sh`'s 12-hour validator wait ends in an URGENT "FAILED" email whose summary says "nothing ran" — loud in the safe direction, self-limiting, not a defect.

---

## Verdict

**One finding: LOW, outside (a)–(d)** — the alarm's `non_ata_token_account` detector pages CRITICAL on token accounts for burnt vaults' PDAs (R2). No CRITICAL, HIGH or MEDIUM anywhere; nothing in the five programs; no path that moves or miscredits value; nothing that stops or wrongly refuses a crack. Under the launch gate this pass is **LAUNCH-CLEAN, REQUIRES CHANGES: one LOW** (fix and arm both ways; does not block).

---

## Given that no human firm will ever see this and the programs will be immutable

What AI audit structurally cannot give this project, concretely:

1. **Scale.** Item 22's open residue is the crank's I/O at ~2,100 vaults — cost, RPC rate limits, paging, a transient error on vault 1,900, the every-minute reveal lane keeping up. No assertion measures it. Before the lock: a shadow full pass against the real deployment with 2,100 synthetic records on a rate-limited provider connection, timed, with the failure injection item 22 names. AI reads code; it cannot measure operations under load.
2. **The box-owner residue.** Limit 10(c) is honest that no check in the same tree can vouch for the tree. The only answer is out-of-tree: a second, independently administered, read-only watcher on different hardware and a different provider account, holding no keys, comparing the deployed bytes and the ledger to the chain. An AI auditing the tree cannot detect a tampered tree.
3. **The human acts.** The hand recovery (limit 10), the Squads returning a rescued vault (item 58), the guardian pulling the brake — each is a person with a runbook and a clock. Drill them with a timer before the charter opens: a forced post-sweep failure recovered by hand (22.4 covers the mechanics, not the stopwatch), a rescue returned, a brake pulled at 3 am.
4. **Real wallets on the real network.** Phantom's wrapping is proven against a local chain with a pinned Lighthouse; the real extension's behavior across versions, on mainnet, with locked wallets, is an end-to-end fact no offline test establishes. One real-device, real-mainnet $1 mint-and-crack before the window opens.
5. **Stress, not mechanics.** The fork proves the swap's floor against cloned state; it does not reproduce a live 180-second Pyth stall during a market break with the pools thin. Item 22.3's live cycles prove the mechanics; run one small cycle during real volatility before relying on the cadence.
6. **The process itself.** This audit's weakest link is that I read the suite's source and trust its reported counts. A human spot-check — watch the 913 actually execute once, pick ten assertions at random and confirm by hand that each fails when its subject is broken — catches the class "the gate reports green without running" that no amount of reading the gate's own code can.