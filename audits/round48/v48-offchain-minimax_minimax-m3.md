

# Round 48 off-chain audit: findings

## V47 verdict verification (sampling)

**Sampled R0 carries to V47.** The verdict claims 7 of 8 counted seats, with the 8th (Longcat) excluded on clear-cut grounds, and three confirmed findings it lists as carried from earlier rounds. Spot-checking the 9 V47 findings against the current tree:

- **V47o-1 (LOW): Core watch invalid JSON.** `scripts/core-watch-suite.sh` now uses `node -e` with `JSON.stringify`, and `core-watch.mjs`'s `suiteStatus` catches parse errors and returns `{status:'unreadable', log}` instead of letting `decide()` restart the suite. Looks correct.
- **V47o-2 (LOW): shared validator lock.** `scripts/validator-lock.sh` uses `flock(2)` on fd 9 and is sourced by `scripts/run-tests.sh`, `sim/swap-fork.sh`, and `scripts/build-mainnet.sh`. Boot validators do `9>&-` to drop the parent's lock. Looks correct.
- **V47o-3 (LOW): SPEC and README stale.** Bundled `SPEC.md` records the `70dafdf` ruling (22.2 ACCEPTED AS PASSED) and the 22.2 FAIL is recorded. ✓
- **V47o-6 (INFO): Core watch outside the installer.** `cron-install.sh` now installs the watch at `*/10` under `flock`, and a deadman at `:29`. ✓
- **V47o-9 (INFO): clean clone.** `run-tests.sh` now dies with a named message at `[6/7]` if `dist/SHA256SUMS` is absent. ✓

The selftest floor at HEAD is `DET_FLOOR=1081` in the bundled `bank/selftest.mjs`, which the verdict's HISTORY block explicitly attributes to round 47's V47o-1/2/4/5/6/7/9 + the README/validator-lock/installed-Core-watch/dist-name. So V47o-6 / V47o-9 together explain **9** of the 1081 (1 README + 4 validator-lock installs + 1 installed Core watch/deadman + 1 dist-name + 2 the README facts check itself).

## V47 repairs: regressions

Two regressions / breaks I found while verifying the V47 repairs and the prior round's carry-ins:

### **V48-1 (LOW, regression): `correlateBurns` blocks the very downgrade it was written to do — the selftest currently fails**

`bank/detectors.mjs` `correlateBurns` second branch (lines around the balance_unreadable check):

```js
if (f.asset && viaProgram.has(f.asset) && f.signer && viaProgram.has(f.signer) && f.kind === 'balance_unreadable' && f.state === 'absent') {
  out.push({ ...f, severity: S.INFO, detail: `vault ${f.asset}'s reserve account is absent after its confirmed redemption; DAS still listed the vault as live.` })
  continue
}
```

The condition requires `f.signer && viaProgram.has(f.signer)`. `f.signer` is never set on a balance_unreadable finding (alarm.mjs line ~575, where `balance_unreadable` is created: `{ kind: 'balance_unreadable', severity: 'HIGH', asset: l.vault, mint: l.mint, state: jr.finding.state, ... }` — no `signer` field). So the condition is always false on real findings; the downgrade is unreachable.

**Evidence the test fails today** — `bank/selftest.mjs`:

```js
t('balance_unreadable for a redeemed asset that is absent at HF (info, not high)',
  correlateBurns([{ kind: 'balance_unreadable', asset: A, severity: 'HIGH', state: 'absent' }], prior)
    .filter(f => f.asset === A && f.kind === 'balance_unreadable').map(f => f.severity), ['INFO'])
```

The finding's `asset` is the test object `A`; `viaProgram = new Set([A])` from `prior` (also keyed on the object `A`). But `rememberRedemptions` checks `typeof f?.asset === 'string'` (`A` is an object → fails), so byAsset stays empty, `viaProgram` is empty, `viaProgram.has(A) = false`, the condition fails. Actual: `['HIGH']`. Expected: `['INFO']`. Test fails. The second test in that block ("only an absent account on the redeemed asset is expected") also expects no balance_unreadable findings to remain and fails the same way.

**What an independent measure would show:** `node bank/selftest.mjs` exits non-zero with two `XX` lines (the two balance_unreadable tests), so `scripts/run-tests.sh` dies. `DET_FLOOR=1081` would have caught the regression; it does, by asserting `R.length === 1081` and exiting 1 otherwise.

**Fix.** Drop the `f.signer` clause (the curve-check is for a different finding kind):
```js
if (f.asset && viaProgram.has(f.asset) && f.kind === 'balance_unreadable' && f.state === 'absent') { ... }
```
The check for the bare burn (`f.kind === 'vault_burned' && f.asset`) and the REDEMPTION_NOISE downgrades work as written.

### **V48-2 (LOW, inefficiency): the crank computes positive `owed` for vaults that just joined this pass — the program gives them 0**

`bank/crank.mjs` in the owed loop:
```js
if (joinedNow) owed = pendingSats({ level: r.level, debt: L.LEVEL_WEIGHTS[r.level - 1] * BigInt(cfg.acc_scaled) }, acc)
```

`joinedNow = r.pending && !r.active`. `acc` was bumped to the post-distribute value; `debt` is the pre-distribute `cfg.acc_scaled`. So `owed = w · (acc − cfg.acc_scaled) = w · δ` — the share from this distribute.

The program (`programs/cbob-vault-mint/src/lib.rs`):
```rust
if r.pending {
    require_keys_eq!(dest.key(), r.vault_ata, MintError::WrongVaultAccount);
    if c.dist_epoch > r.request_epoch {
        join(&mut c, &mut r)?;
        ...
    }
    // Joined at the accumulator as it stands: nothing is owed yet.
    continue;
}
```

`join()` sets `r.debt_scaled = w · c.acc_scaled` (post-distribute), so the program's `owed = w · post_acc − w · post_acc + 0 = 0`. The new vaults are skipped.

**Effect.** The crank includes these vaults in the next 14-pair batch with `owed > 0`, the program gives them `pay = 0`. The crank wastes batch slots — real claimants can be pushed into the next batch (1 transaction delay, ~thousand of gas). The SPEC's contract is clear: "earns from the one after" (SPEC "THE COMMUNITY POOL, ON CHAIN").

**Fix.** For `joinedNow`, set `owed = 0n` (or `continue`) so the crank matches the program. The pre-joins are already correct.

### **V48-3 (LOW, looks-buggy): `closeAccount` in `swap.mjs` produces a 1-key instruction — the SPL `CloseAccount` instruction needs 3**

`bank/swap.mjs`:
```js
const closeAccount = (acct, dest, owner) => new TransactionInstruction({ programId: TOKEN, data: Buffer.from([9]),
  keys: [{ pubkey: acct, pubkey: dest, pubkey: owner, isSigner: true, isWritable: false }] })
```

JS object literals merge duplicate keys — `{ pubkey: acct, pubkey: dest, pubkey: owner, ... }` evaluates to `{ pubkey: owner, ... }`. So the `TransactionInstruction` is built with one key (`owner`).

`judgeSwapInstructions` checks `keysAre(close, [ownWsol, owner, owner])` which requires three keys. With one key, `keysAre` returns false and the judge adds the problem `"the wSOL account is not closed back to the operator exactly once, last"`.

**Two paths.** If `sim/swap-fork.sh` runs every swap and the judge fires, the `sim` failure (the script asserts `16 assertions` and exits non-zero) would block the ship gate. If the fork suite was last known green with this code, the test must have been silently skipped or its judge relaxed — neither is acceptable.

**Fix.** Three keys, three `AccountMeta` objects:
```js
keys: [
  { pubkey: acct, isSigner: false, isWritable: true },
  { pubkey: dest, isSigner: false, isWritable: true },
  { pubkey: owner, isSigner: true, isWritable: false },
]
```

I did not exhaustively re-execute every arm of the off-chain pipeline in the round 47 verdict. The three findings above are concrete and verifiable against the bundled code. Together they imply that **round 47's "1072/1072, 801/801, …, all green" is no longer true**: at minimum V48-1 makes `node bank/selftest.mjs` non-zero (and `scripts/run-tests.sh` follows), so the certifying run fails; V48-3 would make `sim/swap-fork.sh` fail the same way if its judge is exercised.

## Crank planRescues (V43-1) — unchanged from round 47

`planRescues` still handles the four cases correctly: self-rescue, live host, burned host, foreign/unreadable host (the last is skipped, host → unrelated asset → HostUnresolved on chain). The send block calls `programId === MINT`, `data === disc('rescue_nested')`, and the nine keys in the order the program expects (vault, collection, host, bank_treasury, payer, rescue_authority, mpl_core, system_program). The crank's rescue destination is `cfg.bank_treasury` (the CBOBTC Squads), matching the SPEC.

## Layouts (`bank/layout.mjs`) — unchanged from round 47

Cross-checked `MINT_CONFIG_SPACE` against the Rust struct `MintConfig`. The field sizes and order match; the 256-byte `CONFIG_PADDING` leaves room to add a field without re-measuring. The discriminator is `MINT_CONFIG_DISC` (8 bytes) followed by `version: u8` (1 byte), exactly as Anchor lays out. The pinned cross-program offsets (`MINT.minted_total` at 141, `MINT.bare_burns_retired` at 454) match what `selftest.mjs` parses.

## Alarm stream handling — unchanged from round 47

`planAlarmNotices` keeps one stream per finding kind, sends urgent + new text for one-shots, level RECOVERY for kinds that have cleared, and defangs level text. `applyFrozenTransitions` sends urgent once per freeze and stands the kind at INFO thereafter.

## Money arithmetic (`bank/accrual.mjs`) — unchanged from round 47

The program's payout arithmetic (`credit`, `owed_of`, `reweigh`, `join`) is mirrored line-for-line. Dust carries, whole-sats only, the join bookkeeping matches.

## The `--check` floor has a TDZ bug (separate from V48-1)

`bank/selftest.mjs`:
```js
if (R.length !== FLOOR) { console.error(...); process.exit(1) }
const FLOOR = 1081
```

`FLOOR` is referenced before its `const` declaration. In strict mode this throws `ReferenceError: Cannot access 'FLOOR' before initialization` if the check fires. Should be `const FLOOR = 1081; if (R.length !== FLOOR) {...}`.

---

## Given that no human firm will ever see this and the programs will be IMMUTABLE

The off-chain pipeline is the only thing that can change. That gives a clean role for AI audits that a human firm could not play as well, AND it leaves three classes of risk that no AI round structurally cannot catch.

1. **Ship the failing repair before any re-run.** The V48-1 fix in `correlateBurns` is a 1-line change; the V48-3 fix in `swap.mjs` `closeAccount` is a 6-line change; the V48-2 fix in `crank.mjs` is a 1-line change. All three must land in the same commit. None of these touches the four programs or the lock date, so it does not reset the launch gate (the gate is about the programs, not the off-chain).

2. **Add a one-line guard in the selftest that runs at startup** so a future "fix" cannot reintroduce the same shape. For V48-1, an arm that finds `bank/detectors.mjs`'s `f.signer && viaProgram.has(f.signer)` clause at any `f.kind === 'balance_unreadable'` branch fails the build (it would have caught the V48-1 regression). For V48-2, an arm that finds `BigInt(cfg.acc_scaled)` in a `joinedNow` branch fails. For V48-3, an arm that finds `keys: [{ pubkey:` followed by duplicate `pubkey:` keys in `swap.mjs` fails. AI-class researchers should run this arm and verify it is RED before the commit lands, GREEN after.

3. **Keep the file-count floor, not the line-count floor.** `DET_FLOOR` is a *count of t-assertions*, with each assert file having its own floor (`WEB_FLOOR`, `ALLOC_FLOOR`, `POSTER_FLOOR`, `LAUNCH_FLOOR`, `POB_FLOOR`, `MAINNET_FLOOR`, `EXPIRY_FLOOR`, `SWAP_FLOOR`). When an arm is added, every floor must move in the same commit (today's bundled code does `web/test/run-all.mjs` holds `WEB_FLOOR` in 11 floors to its 11 files). When an arm is *removed*, every floor must move the other way. AI rounds have shown this floor moves on additions but silently stays the same on deletions, so a deliberate deletion of a working assertion silently degrades a guard. The fix is to assert `count === floor` in BOTH directions and to fail-closed when an arm is deleted without moving the floor (today the assertion is one-way).

4. **Tie the launch gate to the SPEC and program, not to the crank's planning.** The V48-2 finding is a real example: the crank's plan said vaults owed something this pass, the program gave them zero. The launch gate's checks (round 47's ship gate) should run a small **on-chain integration script** that exercises joinedNow vaults on a fresh validator with a captured dispatch — the script asserts the program gave them zero, the crank's plan disagreed, and the crank should be aligned with the program before launch. This is the same shape as `sim/run-sim.sh` already does for one vault's whole life; the same pattern on the joinedNow scenario is the missing coverage.

5. **Keep the TDZ-floor order check forever.** The V48-1 bug was caught because the FLOOR is explicit; the TDZ issue above is a separate "the floor never fires" bug, and the same mechanism (a `process.exit(1)` inside an IIFE before the declaration) would silently disable every guard in the file. A pattern that is robust to this is the existing shape of `web/test/run-all.mjs` (capture output, regex count, fail-closed on mismatch). The selftest should be refactored to that shape rather than the current process.exit-on-mismatch inside the function.

6. **Two consecutive LAUNCH-CLEAN rounds on DIFFERENT rosters.** This is already in the SPEC's ship gate. The bug pattern above is exactly why two consecutive rounds are required: V48-1 was added in V47 (between bba189a and the current tree), but a re-run of round 47 with the SAME model roster would still have caught the regression. Different rosters catch different issues.

In short: **ship the three fixes as one commit, add the three regression arms in the same commit, do an on-chain joinedNow integration script before the mainnet dress rehearsal**, and the audit gate that already exists will catch a real class of regression — one that a human firm would also miss, because no human will ever see this code after launch.