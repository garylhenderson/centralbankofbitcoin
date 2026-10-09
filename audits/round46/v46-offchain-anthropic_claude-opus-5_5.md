# Round 46 off-chain audit: crank, alarm, layouts, accrual, swap and revenue, gates, web tests

## Verdict

I find **no CRITICAL, HIGH or MEDIUM finding**. I find **no defect in classes (a) to (d)**:
- (a) nothing in the five programs;
- (b) no path that moves or miscredits value;
- (c) nothing that stops or wrongly refuses a crack;
- (d) no HIGH or MEDIUM anywhere.

Round 45's six off-chain repairs hold at every site of their shape I could find. I file **five INFO items**, none launch-blocking, plus three non-findings recorded so they can be checked. Two of the INFO items concern how the V45o-2 and V45o-4 repairs interact with code paths their arms do not drive. The rest are operational, test-reproducibility and documentation items.

**Measurement limit.** Nothing here was executed. Every claim below is from reading the bundled source. For each one I say what a run would show if I am right.

---

## R0. Round 45's verdict and its repairs

### V45o-1 (null SEAL reserve read): holds at all three sites

All three readers of `seal.reserve_mints` in `alarm.mjs` now carry the list forward:
- the per-pass ATA maps: `ataMints = cfg[...] || carryConfigBaseline(prev?.config, cfg)[...] || D.RESERVE_MINTS`;
- the balance block, with a `[payment]` fallback;
- `reconcile()`, which throws to `reconcile_failed` when nothing can be carried.

`detectStandingRisks` reads the same key only when it is defined. A missing SEAL therefore produces no false `test_value_in_production`.

I found no fourth reader. `grep -n "seal.reserve_mints"` over `bank/` should show only these sites plus the WATCH entry and the production pin.

One minor inconsistency. On a first-ever pass with SEAL null, `ataMints` falls back to the ruled three mints, but `reserves` falls back to cbBTC only. This is harmless: there is no prior balance to drop, and the next readable pass builds all the legs.

### V45o-2 (rehearsal switches refused at load): holds, with one side effect (INFO-3 below)

Both switches are read at module load:
- `FAIL_AFTER_SWEEP` and `FORCE_ORCA_REFUSAL` are top-level `const`s in `revenue.mjs`;
- `refuseStrayOverrides()` runs at load in `revenue.mjs` and `alarm.mjs`, and before `jobRpc()` inside the crank's `main()`.

The selftest arm locates these lines by source order and indentation, not by text alone. Re-indenting the `const` inside `main()` would turn it red, so it can fail.

### V45o-3 (frozen-pool overdue text): holds

`detectDistributionOverdue` receives `poolFrozen: !!pool?.frozen`, a value the I4 pin fixes. With the pool frozen it emits non-blaming text, and the arm checks both directions.

### V45o-4 (unreadable count survives a flood): holds on delivered passes only (INFO-1 below)

`carryUnreadPasses` is evaluated from the alarm's real state-write line. The flood arm drives the real extracted walk. The undelivered-pass branch of `main()` is outside both.

### V45o-5 and V45o-6: hold

- **V45o-5:** `--selftest` is now parsed before the NEVER-SENT exit. The fixture arm checks both the selftest's 19/19 and the freeze check's exit 1.
- **V45o-6:** the text change is in `budgetPlan`. `detectCrankHealth`'s covered-freeze strings do not depend on it.

### V45o-7 (audit instrument): repaired in this prompt

This prompt's R0 describes round 45, not round 44. `rehearsal-env.mjs` is now bundled with `revenue.mjs`.

### Re-tested disproved claims

- **C01, Longcat's units claim: disproved again from first principles.**
  - `sqrt_price` is a Q64.64 square root of (token B raw per token A raw). Squared, that is cbBTC base units per lamport, which is sats per lamport.
  - DLMM prices X in Y as (1 + bs/10⁴)^id lamports per sat, so the inverse is sats per lamport.
  - `oracleFloor` is lamports × p_sol × 10^(e_s − e_b) / (p_btc × 10). That is lamports/1e9 × USD/SOL ÷ USD/BTC × 1e8 sats/BTC.
  - All three quantities are in the same unit. The fork's SW.7 to SW.9 agree.
- **C02, the bitmap-dust claim: I agree it is disproved as filed,** on the evidence that the extension exists. Item 5 stays open, as round 45 said.

---

## R1. The crank (`bank/crank.mjs`): no defect found

| What the brief asked for | What I found |
|---|---|
| **A plan the program refuses** | None. |
| **Rescue keys** | They match `RescueNested` in order and writability. |
| **Self-nested vault** | When the vault sits in its own deposit address, vault and host are the same key (writable plus readonly). The compiler merges them as writable, which MINT accepts. |
| **Burned host** | The host passes `is_burned`. |
| **Live host** | The host is a record of ours, and `assets === 'live'` means AssetV1 owned by Core. Its collection is ours by construction, because only MINT creates records. |
| **Join batches** | They pass `r.vault_ata`, which is what the pending branch of `claim` checks. |
| **Reveal of a burned asset** | It is sent with `[]`, and MINT skips the attribute hash for a burned asset. |
| **Paying or joining a dead vault** | Never. `assets === 'burned'` is excluded from activation, joins and claims. `'other'` is never joined or paid. |
| **Out-of-order reveal** | Impossible. The run starts at `revealed_total`, and every skip, failure, benign refusal or attribute problem `break`s. The V43o-3 arm drives the real loop. |
| **Value moved anywhere unpinned** | No. The program-id and transfer arms are real source checks over the instructions the crank builds. |
| **Fee budget** | `planCostLamports` includes `rescue`. `plan.rescue` is assigned before `budgetPlan` runs, which an arm pins. |

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

**Production values.** The values the brief lists are asserted in `detectStandingRisks(production)`: 21%, 51%, 3 days, 7-day notice, the three tighten bounds, the 30-day month and the one-hour window.

**Upgrade authority.** All five of our programs are covered by `detectUpgradeAuthorityAfterLock` and the WATCH list, including `prog.sweep.*`.

**Dangerous states read as quiet.** None beyond the stated blind spots:
- per-PoB-asset plugins;
- the 30-minute sampling of the PoB collection;
- foreign nested assets.

**Routine states that page every pass.** Each is intentional and stated:
- `vault_awaiting_return`;
- a DAS lag on `index_disagrees_with_chain`, once then a recovery;
- `royalties_unswept` masked by incoming royalties.

### INFO-1: an undelivered pass consumes the unreadable retry count while rolling back the cursor

**The construct.** `alarm.mjs` `main()`, the `if (!delivered)` block.
- It restores `config`, `balances`, `cursors`, `backlogs`, the sweep baseline, the revenue clock, `vaults`, `deferredSweeps`, `frozen` and `paged`.
- It does **not** restore `unreadPasses` or `unreadSkips`. Both were set from this pass's walk.

**Effect.** While notification delivery fails:
- A permanently unreadable signature X advances 1 → 2 → 3.
- On the third pass X is "skipped" and recorded in `unreadSkips`, but the cursor rolls back to before X.
- On the first delivered pass X is attempted again. Its count is gone, because `carryUnreadPasses` drops an attempted signature that is not in `unreadNow`, so it restarts at 1.
- X therefore holds the walk for up to two more delivered passes. `tx_skipped_unreadable` meanwhile stands for a skip that did not take effect.

Nothing is lost. Both pages are loud, and it only happens when delivery is already failing. But SPEC's "at most three passes" bound is stated without that condition.

**Evidence if I am right.** Use the round-45 flood harness with `delivered = false` on passes 1 to 3, mimicking the rollback. X is reported `tx_unreadable` again on pass 4 with "pass 1 of 3", while `unreadSkips` already holds it.

**Fix.** Restore both fields in the undelivered branch:

```
next.unreadPasses = prev?.unreadPasses ?? {}
next.unreadSkips  = prev?.unreadSkips  ?? []
```

Alternatively, qualify the SPEC sentence with "on delivered passes".

### INFO-2: `unreadPasses` is never pruned

An entry is removed only when its signature is attempted again. Entries can be stranded:
- a hand-cleared cursor;
- a signature the listing later stops returning, since `s.err` signatures are skipped before `attempted.add`.

Such an entry is carried forever. This is not attacker-driven, because unreadability is an RPC or format fault. Cap the map or prune entries older than N passes. Not blocking.

### Non-finding: `CBOB_ALARM_REHEARSAL`

`CBOB_ALARM_REHEARSAL` still bypasses `rehearsalOnly`. This is already recorded as a round-45 recommendation, and I do not re-file it.

---

## R3. Layouts (`bank/layout.mjs`): sound

Every check is a real both-ways gate:
- **Struct parse.** `parseRustStruct` throws on any line that is not a single `pub` field.
- **Cross-program offsets.** These are scraped. A completeness arm makes sure no scraped `OFF_` constant goes uncompared.
- **Versions, `BOOST_RING` and space constants.** These are scraped and evaluated, with mutation controls.

**Round 24 D6 is closed.** The SEEDS arm scrapes all twelve `*_SEED` constants, and a mistyped seed or an unmapped key turns it red.

A struct change cannot slip past. A new field, a retyped field or an extra byte of allocation each has an arm shown red.

---

## R4. Money arithmetic (`bank/accrual.mjs`): matches the program

| JS function | Rust counterpart |
|---|---|
| `pendingScaled` | `owed_of`: (w + boost)·acc + carry − debt, failing on underflow |
| `credit` | `credit` |
| `available` | `distribute`'s `avail`, with `ceilSats` |
| `reweigh` | `reweigh` |

The crank's two special owed cases also match:
- **Pre-joined vault:** debt is w·acc_old. That is what `join` writes when it runs before the distribution.
- **Pre-expired vault:** owed = atExpiry + w_level·(acc_new − acc_old). That is what `expire_boost` → `reweigh` produces: carry = owed at acc_old, debt = w·acc_old.

**Boost expiry.** It runs before the distribution (`preExpires`) and right after it (`postExpires`, where end = epoch + 1).

**Alarm.** It pages `boosts_stalled`, and treats `cbob_mint`, `max_boost_weight` and `max_boost_epochs` as CRITICAL fixed-forever values.

---

## R5. The swap and the revenue cycle

### (a) Oracle math: correct

- Exponents are bounded to −18..0, checked in both `readPyth` and `oracleFloor`. `10n ** BigInt(±e)` cannot overflow.
- The sign handling covers both cases of `e`.
- `expectedSats` and `minSats` both floor, toward a lower floor. That is the conservative direction for an on-chain minimum.
- The float `satsPerLamport` feeds only the 100 bps read-time filter. At exponent −8 and real prices, Number precision (~1e-16 relative) is far below 1 bps.

### (b) Pyth account: sound

- The checks are a derived PDA, the receiver as owner, the Full tag, and the feed id at 41 → price 73 / conf 81 / expo 89 / publish 93. All are correct for the PriceUpdateV2 `Full` layout.
- `write_authority` and `posted_slot` are not checked.
- Anyone can push a Guardian-signed update for that feed, but no one can choose its price. The worst case is an older signed price, still inside the 180 s age bound measured on the chain Clock.
- The Clock is trusted exactly as far as the one RPC is (limit 10(b)).

**No finding.** A recommended extra arm: assert the write authority is the push-oracle PDA.

### (c) and (d) Deviation filter and minimum out: correct

- The direction and units are correct, as in R0.
- Both venues carry `minSats` at data offset 16. Orca's is `other_amount_threshold` with exact-input; Meteora's is `min_amount_out`.
- `minSats` is in sats, which is cbBTC base units, the output token. It is the same `guaranteed` that `revenue.mjs` holds the delta to.
- **Note:** the deviation filter's reference (oracle spot) and the floor's reference (oracle expected output) are the same oracle read, `m2`.

### (e) The judge: complete for what a builder defect could do

It checks:
- the output account at key 5;
- the minimum-out, amount and direction bytes;
- the CU limit, and that there is no `setComputeUnitPrice`;
- the exact keys of both ATA creations;
- that no Token instruction other than SyncNative and Close is present.

Venue-owned accounts (vaults, arrays, oracles, bitmap) are validated by the venue program. A tampered module is limit 10(c).

### (f) Account derivation: correct

- **Orca:** a_to_b uses the current tick array then the two below. `Math.floor` handles negative ticks, and a boundary tick starts its own array (arm).
- **Meteora:** Y→X uses the active bin array then the two above. Optional accounts are the program id, which is Anchor's None.
- **Uninitialised arrays:** the venue refuses, which is a refusal, so Meteora is tried or the cycle stays open and loud. This is round 44 C01, still open.

### (g) wSOL handling: no loss

Wrap exactly `amount`. A pre-existing balance or residue is returned to the operator by `CloseAccount`. The native mint has no freeze authority, and only the owner can set a delegate.

### (h) Failure and retry: no new path to a double swap

There is no new path to a double swap or a falsely closed cycle. The only false-"refused" case is an RPC that returns a null status for a landed transaction. That is C10, under limit 10(b).

### (i) What an adversary can extract within the tolerance

Assume full throughput: about 34 SOL/day at 10 SOL per roughly 7 hours.

- **Sandwich, or a pool pushed to the gate.** At most (expected − floor), about 150 bps less the honest fee and impact. That is about 0.15 SOL per 10 SOL cycle, about 0.5 SOL/day, about 15 SOL/month as an upper bound.
- **Oracle confidence.** A stale-but-accepted oracle widens this by at most the price drift over 180 s plus confidence, which is ≤30 bps per feed.
- **Meteora manipulation.** It matters only after Orca refuses, and Meteora's on-chain floor binds the same way.

Material only at full throughput. Stated in the guide ("up to 1.5% below Pyth").

**Operator key worst case.** It is unchanged: cap × windows until the guardian stops the sweep. `sweep_unledgered_state` detects within the grace plus one pass, about 15 to 45 minutes.

**The ledger cannot read a failed cycle as closed.** `cycleIsOpen` requires a split, and splits are held to the chain anchor.

---

## R6. Gates

- **Floors.** Every floor is equality-checked, and SPEC's stated counts are gated at every occurrence.
- **`build-mainnet.sh`.** It proves the sweep helper is byte-identical to both the localnet rebuild and `target/deploy`, plus behavioural key proofs for the four programs.
- **`cron-install.sh`.** It refuses in a rehearsal tree, arms only uncommented, tagged, anchored lines, and installs exactly six jobs (an arm checks this).

### INFO-3: the load-time refusal sends no notice from revenue.mjs or alarm.mjs

`refuseStrayOverrides()` and the `rehearsalOnly('CBOB_REHEARSAL_NOTIFY', …)` call are top-level throws that run before `withLock(...).catch`. So:
- `publishRevenueNotices` never runs;
- the alarm's `RUN_FAILED` notice never runs.

The crank is different: its refusal is inside `main()`, so it pages "FAILED TO RUN".

Detection still exists:
- the deadman fires at ≤2 h if the alarm dies too, which it does if the stray variable is in the shared cron environment;
- `royalties_unswept` fires at ≥24 h.

**Evidence if I am right.** With `CBOB_REHEARSAL_RPC=x` exported and no record file, run `node bank/revenue.mjs --live`. It exits with an uncaught error and the notifier is never invoked.

**Fix.** Catch the load-time refusal and call the literal production notifier once, with a `cbob-revenue:config` or `run_failed` label, before exiting.

### INFO-4: the offline web suite depends on untracked cache files

`web/test/ceremony.test.mjs` reads `.cache/placeholder/out/cbob_placeholder.so` and `.cache/placeholder/src/lib.rs`. `.cache` is untracked, and a symlink on this box. A clean checkout fails `run-all.mjs`. It fails closed, but the 695 count is not reproducible from the repository alone.

**Fix.** Commit the placeholder source and its sha256, or move the fixture under `web/test/fixtures`.

### Web test vacuity

I found no arm that cannot fail when the property it names is broken. One arm is redundant: `tx.test` "error counts per program" is implied by the deep-equality arm just above it. That is harmless.

---

## The accepted-limits questions

1. **Worse than stated?** None found.
   - Limit 10's extraction bound is consistent with the per-month figure computed in R5(i). Consider stating that figure in SPEC.
   - The SPEC statement of limit 25 ("one silent socket") still holds; there is no request timeout.
2. **Already closed but still listed?** Limit 8 is narrower since round 28. `rememberRedemptions` persists confirmed `burn_via_program` evidence, so only the order where DAS sees the burn first still produces the false CRITICAL. The text is not wrong, just broader than reality.
3. **Discharged items not actually discharged?** None. Items 51 and 54 hold; the crank still sends each capture alone.
4. **OPEN items treated as accepted? One documentation drift.**
   - **INFO-5:** SPEC item 53 still says the in-tree proof "is STALE; it must be re-run at the release commit, which is why this item stays OPEN".
   - Round 45's VALIDATION records that re-proof at `e7c192a`.
   - Either update item 53 to cite it, or say why it stays open (for example, that the mainnet rehearsal itself has not run). Leaving it as is invites a future reader to treat it as done without reading the record.
   - Items 22, 38, 50, 52 and 53 are otherwise correctly OPEN.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run item 22 on mainnet with real money, not a reading of it.**
   - 22.3 through both pools;
   - 22.4's forced failure walked through by Gary or his delegate, not by the box;
   - 22.5's DAS `burnt` read.

   Keep the signatures in the record.
2. **Have an independent party rebuild `dist/` from `RELEASE_COMMIT`.** Use a verified-build tool such as solana-verify, on a different machine. Compare against the sha256s before step 9 and again before step 11's `--final`. AI cannot attest bytes it never built.
3. **Test the alert path end to end.** On the production box, deliberately trigger one CRITICAL, one level HIGH with its recovery, and the deadman. Confirm each reaches Gary's phone within the expected time. Every alarm guarantee in the brief assumes the router delivers.
4. **Practise the custody acts that are human by design.**
   - Have the CBOBTC Squads sign a return of a rescued test vault.
   - Have the guardian wallet sign `emergency_stop_sweep` on the rehearsal deployment.
   - Restore `deploy-authority.json` from the encrypted offsite backup on a different machine before step 9.
5. **Have a second person read the four `initialize` transactions as signed in Phantom**, field by field against `launch/mainnet-init.json`. The checker validates the JSON, not the bytes Gary signs (item 38, A6).
6. **Run a scale rehearsal of the crank and alarm at about 2,100 records.** Use a local validator with synthetic genesis state, as the expiry-budget test does, plus a throttled or flaky RPC proxy. Five vaults leave item 22's scale question open.
7. **Decide the PoB collection key's custody for the 7-day window** (limit 46). Moving it cold or to a multisig for that week is the one cheap act that removes a project-ending exposure no audit can close.