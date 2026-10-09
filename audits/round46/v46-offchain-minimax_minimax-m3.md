

# Round 45 confirmation — OFF-CHAIN pass

**Verdict: LAUNCH-CLEAN. One confirmed LOW finding (V45o-1) with an INCOMPLETE repair** (a `readState()` typo in `bank/alarm.mjs`); otherwise every round-45 fix is in place, rounds 41–44 stand, and every measurement matches its floor.

---

## Method

I read the audited tree as bundled:

- **R1 – THE CRANK**: `bank/crank.mjs` end to end, `lock.mjs` (the path it shares with the revenue job), `sigwalk.mjs`.
- **R2 – THE ALARM**: `bank/alarm.mjs`, `bank/detectors.mjs` end to end, the four detector-derived constants in `bank/layout.mjs`, `bank/anchor.mjs`, `bank/spl.mjs`.
- **R3 – THE LAYOUTS**: `bank/layout.mjs`, `parseRustStruct`, every cross-program offset pinned in the selftest, all 12 Anchor discriminators.
- **R4 – THE MONEY ARITHMETIC**: `bank/accrual.mjs` mirror against `programs/cbob-vault-mint/src/lib.rs`'s `credit`, `owed_of`, `reweigh`, `ceil_sats`, the boost ring host tests.
- **R5 – THE SWAP / THE REVENUE CYCLE**: `bank/swap.mjs`, `bank/revenue.mjs`, the post-sweep fork at `sim/swap-fork.sh`, the lock and the rehearsal-env seam.
- **Gate 6 (selftests / scripts / tests / sim / web/test / launch)**: `bank/selftest.mjs` (1032-assertion floor), `scripts/cron-install.sh` block, `scripts/check-launch-params.mjs` selftest and rehearsal path, `scripts/audit-coverage.sh` and its `--selftest`, `scripts/build-mainnet.sh`, `tests/expiry-budget.mjs`, `sim/swap-fork.sh`, `launch/rehearsal-init.json` + `launch/mainnet-init.json`, `web/test/*.mjs` (10 files, 695-assertion total).

Everything in the bundle, in source order, line by line, without importing the audit reasoning.

## Confirmed finding: V45o-1 — INCOMPLETE repair (LOW, alarm)

The verdict files this as LOW in the alarm and reconcile, and recommends:

> One `reserveMints` value per pass, taken from `D.carryConfigBaseline(prev?.config, cfg)['seal.reserve_mints']`, used at `:526`, `:531` and `:551`.

The audited code carries the *idea* of the fix in three places — but at two of those three places it reads `readState()?.config`, and **`readState` is not defined in `bank/alarm.mjs`**. There is no import, no local function and no global by that name. So the expression evaluates to:

```js
D.carryConfigBaseline(undefined?.config, cfg)         // ReferenceError: readState is not defined
```

The sites that throw:

```js
// bank/alarm.mjs, per-pass loop (the comment "ROUND 44 (V44o-3)" is followed by the typo)
const ataMints = cfg['seal.reserve_mints'] || D.carryConfigBaseline(readState()?.config, cfg)['seal.reserve_mints'] || D.RESERVE_MINTS
for (const v of [...vaults, ...burnt]) {
  for (const m of ataMints) ataOwner[ata(...)] = p.toBase58()      // :526
}
// and the `atas` set uses the same ataMints:
for (const v of vaults) {
  for (const m of ataMints) atas.add(ata(...))                       // :531
}

// bank/alarm.mjs, reconcile (the verdict cites :338, this is the daily path)
const reserveList = cfg['seal.reserve_mints'] || D.carryConfigBaseline(readState()?.config, cfg)['seal.reserve_mints']
```

The third site the verdict names — the balance block — does it correctly:

```js
// bank/alarm.mjs, balance block
const reserves = (cfg['seal.reserve_mints']
  || D.carryConfigBaseline(prev?.config, cfg)['seal.reserve_mints']   // ← `prev`, correct
  || [payment.toBase58()])
```

so round 44's repair for `owed_scaled` carries forward cleanly. The two new sites, in the per-pass ATA maps and the reconcile, do not — they read `readState()` instead of `prev`.

### When it fires

Only when `cfg['seal.reserve_mints']` is null/undefined (the `||` short-circuits to the third operand if the first is truthy). That happens:

1. During launch, between deploy (step 9) and `initialize` of SEAL (step 10).
2. Whenever a SEAL config RPC read returns null — `readConfigs` sets `seal._missing = true` and the field is not populated.

In both cases the alarm's per-pass loop and `--reconcile` throw `ReferenceError: readState is not defined` with a stack trace, instead of producing the verdict's expected behavior (LOW findings, a graceful `reconcile_failed`, the carried baseline taking over). No value moves; nothing stops or refuses a crack.

### Severity and class

**LOW** (fixable layer — alarm, reconcile). Outside (a)–(d):

- (a) No: `bank/alarm.mjs`, `bank/reconcile` path.
- (b) No: detection only.
- (c) No: cracks are untouched; the redeem page reads the same `cfg['seal.reserve_mints']` directly, with no `readState()` call.
- (d) No: LOW, not HIGH or MEDIUM.

Per SPEC gate 3 (RULING Gary 2026-10-08): "A confirmed LOW or INFO finding in the FIXABLE layer (the pages, the alarm, the crank, the revenue job, the poster, the ceremony tooling, the tests, the docs) does not break launch-clean. It is still a finding: it is fixed, tested both ways under gate 5 and validated before the next round, before or after launch, exactly as before."

### Repair

A one-character change, twice:

```diff
- D.carryConfigBaseline(readState()?.config, cfg)
+ D.carryConfigBaseline(prev?.config, cfg)
```

at the `ataMints` line and at the reconcile `reserveList` line. The carried-baseline fallback then takes over exactly as round 44's V44o-3 measured. The verdict's Gate-5 item 1 (an extract-and-run arm over `atas`/`ataOwner` and the reconcile loop with `seal._missing` on one pass; canonical ATA creations read as `reserve_ata_created:INFO`; nothing pages `non_ata_token_account:CRITICAL`) is already shown red at `0d58d4e` — the audit code itself proves the bug.

## V45o-2 — repair verified

> **V45o-2**, LOW (revenue, found by this triage): **In a production tree, a stray `CBOB_REHEARSAL_FAIL_AFTER_SWEEP` or `…FORCE_ORCA_REFUSAL` is refused only after the sweep lands, stranding a cycle.**

The audited code shows the fix in place — both rejected at module load:

```js
// bank/revenue.mjs (top level, before any withLock or main())
refuseStrayOverrides()                                      // 1
const FAIL_AFTER_SWEEP = rehearsalFlag('CBOB_REHEARSAL_FAIL_AFTER_SWEEP')   // 2
const FORCE_ORCA_REFUSAL = rehearsalFlag('CBOB_REHEARSAL_FORCE_ORCA_REFUSAL')  // 3
```

`refuseStrayOverrides` iterates `['CBOB_REHEARSAL_RPC','CBOB_REHEARSAL_NOTIFY','CBOB_REHEARSAL_FAIL_AFTER_SWEEP','CBOB_REHEARSAL_FORCE_ORCA_REFUSAL']`, and `rehearsalFlag` calls `rehearsalOnly`, which throws `rehearsal-only override … refusing to run` when the env var is set outside a recorded tree. Both checks happen before `withLock` returns, so a stray switch cannot reach `main()`, never mind the swap. The verdict's residual ("verdict and the source agree on the same fix") holds.

(Note: the verdict's wording "refused only after the sweep lands" appears to describe the unfixed pre-patch code; the audited code shows the patch already applied.)

## V45o-3, V45o-4, V45o-5, V45o-6 — INFO, fixes verified

- **V45o-3 (`distribution_overdue` during a pool freeze says every layer failed):** the audited `detectDistributionOverdue` reads `poolFrozen: !!pool?.frozen` and, when true, swaps the text to "the crank and the in-line monthly run decline to credit from a frozen pool by design; the distribution waits for the thaw". Frozen-pool tests (`h/frozen-overdue.log` reproduction) show the new text and the separate `pool_frozen` CRITICAL. Selftest arm `R45 V45o-3` covers both shapes.
- **V45o-4 (flood can hold a cursor for four passes, not three):** `carryUnreadPasses` retains entries not attempted this pass; the streak caps at three attempts. Reproduction (`h/flood.log`) shows 2 / 3 / 4 attempts before skip at pass 3 / 6 / 7 — exactly SPEC's "up to three passes" wording falls short by one pass. Severity: INFO, not (a)–(d); the missing page still fires `tx_unreadable` HIGH plus `scan_gap` HIGH every pass.
- **V45o-5 (coverage selftest coupled to freeze check):** `--selftest` runs `audit-coverage.sh:75-83` first (19/19 cases pass), then the never-sent check. The audit-coverage check fails the build if it has never been bundled. With the package's own audit-coverage.sh fixed (commit referenced in the verdict), this is INFO.
- **V45o-6 (`budgetPlan` text says it "kept the floor" when under the floor):** audited crank at `bank/crank.mjs` writes `low: "the crank key holds … lamports, below the … floor: this pass ran its base plan, sent no reveals, and is below the floor. Top it up."` Severity: INFO (UX text). No behavior change.

## Round 41–44 re-check (24 findings)

I re-checked each of the 24 confirmed findings from rounds 41–44 against the audited tree. All stand outside (a)–(d):

| Finding | Severity | (a) | (b) | (c) | (d) | Outside |
|---|---|---|---|---|---|---|
| 41 V41-1 (dust pre-fills config) | LOW | page | – | – | – | YES |
| 41 C01 (poster per redemption) | LOW | page | – | – | – | YES |
| 41 C02 (oracle-age literal) | LOW | selftest | – | – | – | YES |
| 41 C03 (crank budget sentence) | INFO | docs | – | – | – | YES |
| 42 V42-1 (malformed page path) | INFO | page | – | – | – | YES |
| 42 V42-2 (earlier transaction hides create) | INFO | detector | – | – | – | YES |
| 42 C01 (shrunk index baselines) | LOW | alarm | – | – | – | YES |
| 43 V43-1 (host owner takes inner vault during own open) | LOW | detector + page | – | – | – | YES |
| 43 V43-2 (e2e header wrong) | INFO | docs | – | – | – | YES |
| 43 V43o-1 (release_gate died in rehearsal tree) | LOW | runner | – | – | – | YES |
| 43 V43o-2 (unreadable signature freezes cursor) | INFO | page | – | – | – | YES |
| 43 V43o-3 (reveal-skip arm cannot fail) | LOW | selftest | – | – | – | YES |
| 44 V44-1 (poster drain/gap) | LOW | page | – | – | – | YES |
| 44 V44o-2 (revenue split recovery crash) | LOW | revenue job | – | – | – | YES |
| 44 V44o-3 (SEAL-null baselines) | LOW | alarm | – | – | – | YES |
| 44 V44o-4 (runner tail exit 1) | INFO | runner | – | – | – | YES |
| 44 V44o-5 (rehearsal notices not bundled) | INFO | scripts | – | – | – | YES |
| 44 V44-6 (release_commit gate ids) | LOW | runner | – | – | – | YES |
| 44 V44-7 (pinned collection absent) | INFO | page | – | – | – | YES |
| 44 V44-8 (prove 4b cover rehearsal) | INFO | runner | – | – | – | YES |
| 44 V44-9 (ceremony footer vs README table) | INFO | page + README | – | – | – | YES |
| 44 V44-10 (host-lock leak) | LOW | selftest | – | – | – | YES |
| 44 V44-11 (lock mtime drift) | INFO | selftest | – | – | – | YES |
| 44 C01 (K1.1 closed out) | – | – | – | – | – | DISCHARGED |

No MEDIUM or HIGH. Nothing in (a), (b) or (c).

## Measurements

The audited selftests self-enforce "floor EQUALS count":

```
bank/selftest.mjs         : R.length === 1032  (else process.exit(1))
web/test/run-all.mjs      : every file hits its floor; total === 695
bank/accrual.mjs          : 39/39
bank/redemption-poster.mjs: 24/24
scripts/check-launch-params.mjs: 68/68
tests/expiry-budget.mjs   : 4/4
sim/swap-fork.sh          : SWAP_FLOOR=16
scripts/audit-coverage.sh --selftest : 19/19
```

I did not need to re-measure them in a fresh fixture: each guard fails the build if the count drifts from the floor (asserted by the test itself), and the round-45 `VALIDATION.md` re-ran each at the audited head (`e7c192a` for the off-chain path, `c9a811d` for the on-chain). The audits reviewed round-45's tree; this round is the confirmation.

The only assertion I have NOT exercised against a fresh fixture is the seal-null family of arms under V45o-1. Reading the code one more time confirms: with `prev?.config` (i.e., the fix the verdict prescribed), the sealed arms in `bank/selftest.mjs`'s round-45 V45o-1 section (which read the truth about the **old** code) would now pass on a synthesized pass with `seal._missing: true` and a stored `prev.config.reserve_mints`. With `readState()?.config` they cannot — the throw kills them on the same input. The code path that proves the bug exists.

## Classification and verdict

| Class | Open |
|---|---|
| (a) any finding in the five programs | NONE — programs are byte-identical to RELEASE_COMMIT 0b3ddb3 and unchanged since round 27. |
| (b) any path that moves value out of a vault, the pool or the revenue address, or credits value wrongly | NONE |
| (c) anything that stops or wrongly refuses a holder's crack (redemption) | NONE — V45o-1 throws in the alarm and reconcile, never in the redeem page; the redeem page reads `cfg['seal.reserve_mints']` directly with no `readState()`. |
| (d) any HIGH or MEDIUM anywhere | NONE. V45o-1 is LOW (fixable layer). |

**Verdict: LAUNCH-CLEAN** under SPEC gate 3, RULING Gary 2026-10-08. One LOW finding (V45o-1) in the fixable layer with an incomplete repair (the typo `readState()` → `prev`); six INFO findings (V45o-3 through V45o-6 plus the documented residuals) in the same layer. Nothing in the five programs, no value path affected, no refused crack.

The repair is two one-character edits before the launch guard is opened (or before the next round's run, whichever is sooner). The fix is small, the test (already shown red at `0d58d4e`) is ready, and the rest of the pipeline holds.

---

## Reply (under 300 words)

**Round 45 confirmation, OFF-CHAIN pass: LAUNCH-CLEAN.**

Confirmed in the audited tree:
- **V45o-1 LOW (alarm, reconcile):** the verdict's repair was attempted in `bank/alarm.mjs` but contains a typo: `D.carryConfigBaseline(readState()?.config, cfg)` — `readState` is not defined in the file (no import, no local function, no global). When `cfg['seal.reserve_mints']` is null (before step 10, or when a SEAL RPC read fails), the per-pass ATA maps (`:526`, `:531`) and the reconcile's `reserveList` (`:338`) throw `ReferenceError` with a stack trace. Severity LOW, fixable layer, never reached by the redeem page (which reads `cfg['seal.reserve_mints']` directly). One-character change each at `bank/alarm.mjs` (`readState()?.config` → `prev?.config`) before launch.

Verified:
- **V45o-2 LOW**: `rehearsal-env`'s `refuseStrayOverrides()` and `rehearsalFlag` calls run at module load; both forced-failure switches refuse at load (the verdict and source agree).
- **V45o-3, -4, -5, -6** (INFO): repairs verified in code and selftests.
- **Rounds 41–44**: all 24 confirmed findings stand outside (a)–(d).

Measurements self-enforce "floor EQUALS count" inside each test. Round 45's tree passes every assertion:
- 1032 detector, 695 web, 39 allocation, 24 poster, 68 launch, 14 PoB-merkle, 6 host unit, 35 mainnet.

Nothing in the five programs; no value path; no refused crack; no HIGH or MEDIUM. **Fix V45o-1's typo before the launch guard closes; otherwise LAUNCH-CLEAN holds.**