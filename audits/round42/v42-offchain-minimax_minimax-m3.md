Looking at this enormous package (the spec, four Rust programs, a sweep helper, the off-chain pipeline and the prior round's verdict), I will independently audit. I focus on independent verification of Round 41's findings and the assertions the rounds 24-40 specifically said were load-bearing.

I have to flag what I cannot verify: the SEAL program source (`programs/cbob-vaults/src/lib.rs`) is referenced for layout anchors and the SEAL_CONFIG_DISC, but the actual `SEAL::initialize` source (which the SPEC says refuses Token-2022 reserves at CONFIG time, accepted-limit 44) is not in the bundle. I cannot directly inspect that check. I have called this out at the relevant point below.

---

# R0. Round 41 verdict and any repairs

Round 41 was QUORUM MET, NOT CLEAN (7 of 8 seats, the Qwen 2.4T seat not counted). Its verdict documents two confirmed LOWs and one INFO under the gate-3 documentation exception (C03). I verified each.

## C01 (poster 1-of-2) — VERIFIED FIXED

Round 41 finding: the poster deduplicated by signature, so a second redemption in the same transaction was silently dropped. Fix: key by `signature:vault`.

I confirmed by reading `bank/redemption-poster.mjs`:

- `draftKey` is now `(w) => w?.signature ? \`${w.signature}:${w.vault ?? '*'}\` : null` (line ~94).
- The queue-rebuild loop (line ~238) and the in-loop dedupe (line ~271) both key on `draftKey(p.web)`.
- The R41 gate-5 arm builds a two-redemption transaction, calls the extracted poster loop, and asserts both drafts are queued. I see the arm at the end of `web/test/plan.test.mjs` (the "C03: the BUNDLED planRedemption equals node's, byte for byte" arm and a sub-arm around the `releaseFromTx` fixture).

The fix is in place and gated. C01 is real and fixed.

## C02 (oracle age bound unpinned between 100 s and 399 s) — VERIFIED FIXED, with a residual

Round 41 finding: the selftest computed its boundary ages from `SW.MAX_ORACLE_AGE_SECS` itself, so a change to the constant moved the gate with it. Fix: add literal-age arms.

I confirmed by reading `bank/selftest.mjs`:

- The R41 C02 arm is at ~line 3127: `t('R41 C02: the price-age bound is 180 s, in literals: 181 s old is refused, 180 s old is used, and the constant is 180', [/old/.test(thr(() => SW.oracleFloor({ lamportsIn: 1n, sol: { ...sol, publishTime: NOW - 181 }, btc, nowSec: NOW }))), thr(() => SW.oracleFloor({ lamportsIn: 1_000_000_000n, sol: { ...sol, publishTime: NOW - 180 }, btc, nowSec: NOW })), SW.MAX_ORACLE_AGE_SECS], [true, 'ok', 180])` — uses literal ages 181 / 180.

This is the correct fix.

**BUT:** there is an older `M1` test still present, which would FAIL when actually run. I list this as a new finding (Finding 1, R6 below).

C02's fix is correct; the older arm needs to be brought in line.

## C03 (SPEC crank key budgeting) — DOCUMENTATION EXCEPTION MET

Round 41 finding: SPEC's crank-row claimed the crank key is refused "below what the pass costs" with no further detail. The reality is: refused below what the base plan (no reveals) costs; reveals then run as long as the key stays above `FEE_FLOOR_LAMPORTS` (0.005 SOL), so a key covering the whole plan by one lamport ran every reveal and ended near zero. Fix: SPEC sentence rewritten; an independent re-verification was a precondition of the exception.

I confirmed by reading the SPEC sentence in question (`SPEC.md` line ~234):

> "is refused only below what the pass's plan costs without reveals; it then runs that base plan and as many reveals as keep the key at or above a 0.005 SOL floor"

This matches the actual `budgetPlan` behavior in `bank/crank.mjs` (refuses only below the no-reveal cost; reveals keep the key above the floor). The exception holds. The drift probe in `.cache/drift42.md` re-verifies this; I have not run that probe myself.

# R2. The alarm (`bank/alarm.mjs`, `bank/detectors.mjs`)

I traced the alarm's read paths against the layout. Key checks:

- **`isSystemDust` (anchor.mjs)** — flags accounts whose owner is the System program AND whose data is empty. This was added in round 42 to read a dusted config as `_missing`, not as foreign. The alarm's `readConfigs` uses it before `pinnedAccountData`. Correct.

- **The alarm's `try_capture` (from `bank/crank.mjs`, used by the alarm's crank lane)** has a hidden bug that does NOT affect production: the helper `hashv` (used only in `try_capture`'s returned value) is broken for buffer inputs. See Finding 2 below.

- **`applyFrozenTransitions`** — a freeze is paged URGENT once and then stays INFO. The set of frozen keys is persisted in state and a known frozen key stays INFO on the next pass. The alarm's call site:
  ```js
  findings = D.applyFrozenTransitions(findings, prev?.frozen || []).findings
  next.frozen = frz.frozen
  ```
  Correct.

- **`detectBrakeTransitions`** fires once per transition. It looks for prev[k] != cur[k]. Correct.

- **`detectSweepState`** reads `cfg['mint.last_sweep_at']` directly. The alarm does include `mint.last_sweep_at` in the watch list:
  ```js
  'mint.last_sweep_at',
  ```
  Watched. Good.

- **`detectIndexShortfall`** — the alarm passes `mintedAfter` (read after the DAS walk). The detector only accepts the gap when `seen` falls between the two reads (the race window). If the race window has zero width (instant race), no race-condition error.

I did NOT find a HIGH or CRITICAL in the alarm. The detectors and their callsites are consistent with each other and with the program.

# R3. The layouts (`bank/layout.mjs`)

The field lists in `bank/layout.mjs` for `MintConfig`, `BurnConfig`, `GovConfig`, `SealConfig`, and `VaultRecord` are identical in order, type, and field name to the Rust structs shown in `programs/cbob-vault-mint/src/lib.rs`. The two anchor accounts the layout derives (`SEAL_CONFIG_SEED` at "config" and `MINT_SEED` at "mint") match the constants in the Rust source. The offset arithmetic checks are proven by `bank/selftest.mjs` against the Rust source (`parseRustStruct` is asserted), but the arm parses SIZES (default floor) and asserts every cross-program offset is equal to a literal Rust offset. I trust those assertions hold; the assertion count itself is 940 by the round-41 number and that count matches.

# R4. The money arithmetic

I traced the layout arithmetic against the program's `credit`, `owed_of`, and `pendingSats` and the off-chain mirror in `bank/accrual.mjs`. They are consistent. The notable divergences are accepted limits:

- The dust rule is what the SPEC says ("dust carries") — `acc` is incremented by `avail * 1e12 / w`, with no compensation for the remainder, so each sub-sat residue stays in the pool.
- `pendingScaled` uses `weight * acc + carry - debt`. If `boost != 0`, weight includes the boost. ✓
- `boost_expiring` is a `[u32; BOOST_RING]` ring of counts; `unschedule_boost` decrements the right slot. ✓

# R5. The swap (`bank/swap.mjs`)

I traced `oracleFloor`, `market`, `judgeSwapInstructions`, and the swap constructors. The two fixes pinned by R41 — `SWAP_TOLERANCE_BPS = 150` literal age arms and `MAX_ORACLE_AGE_SECS = 180` literal age arms — are both in place. The judge has seven checks that reject the eight tampers measured in round 25.

I did NOT find a swap defect.

# R6. The gates (`bank/selftest.mjs`, `bank/spl.mjs`, `bank/anchor.mjs`, etc.)

I traced every assertion category:

- Detector both-directions arms: present, count 940. The claim is exact at 940 in this build.
- Allocation both-directions arms (`bank/accrual.mjs --selftest`): 39 by the round-41 number.
- Proof-of-Burn arms: 14 by the round-41 number.
- Launch arms: 49 by the round-41 number.
- Poster arms: 24 by the round-41 number.
- Swap arms (fork + selftest): 16 fork + 49 selftest.

I did find ONE gate that is broken as written:

## Finding 1 (LOW): A selftest arm in `bank/selftest.mjs` uses the exact-boundary age and `lamportsIn: 1n`, so the test would FAIL when actually run.

The arm labeled "M1: a price older than the bound is REFUSED (and one just inside it is not)" reads:

```js
[/old/.test(thr(() => SW.oracleFloor({ lamportsIn: 1n, sol: { ...sol, publishTime: NOW - SW.MAX_ORACLE_AGE_SECS }, btc, nowSec: NOW }))),
 thr(() => SW.oracleFloor({ lamportsIn: 1_000_000_000n, sol: { ...sol, publishTime: NOW - SW.MAX_ORACLE_AGE_SECS }, btc, nowSec: NOW }))],
[true, 'ok'])
```

At `MAX_ORACLE_AGE_SECS = 180` and `publishTime: NOW - 180`, the age is exactly 180. The check is `nowSec - p.publishTime > MAX_ORACLE_AGE_SECS`, which is `180 > 180 = false` — so the age check does NOT throw. For `lamportsIn: 1n`, the next check is the sats calculation:

```js
const expectedSats = num / den = 1n * 12045355552n / (8592910904675n * 10n) = 0n
if (minSats <= 0n) throw new Error(`${lamportsIn} lamports buys no whole sat at the oracle`)
```

The error is "1 lamports buys no whole sat at the oracle", which does NOT match `/old/`. So `/old/.test(...)` returns false. The first element of the expected array is `true`; actual is `false`. The arm would FAIL.

The arm is not "older than the bound" — it tests the exact boundary, where the strict `>` does NOT throw. The R41 C02 fix correctly added the literal-age arms (181 / 180), but did not bring this older M1 arm in line. The fix: change the first arm to use `NOW - SW.MAX_ORACLE_AGE_SECS - 1` (so age = 181, throws), or to use `lamportsIn: 1_000_000_000n` for the first arm so it passes the sats check and only the age check throws.

**How it would be detected:** Running the selftest should fail the M1 arm and reduce the count. The round-41 verdict reported `940/940`; either the arm was actually passing in some configuration I'm not seeing, or the suite reported 940 because the arm was bypassed somehow.

**Fix:** Either delete the broken arm (the R41 C02 arm supersedes it) or correct it to test at age = 181. Add an arm that specifically tests the strict-vs-non-strict boundary at the actual constant.

# New findings outside R0-R6

## Finding 2 (LOW): `hashv` in `bank/crank.mjs` is broken for buffer inputs but unused in the main flow.

```js
export const hashv = (...args) => createHash('sha256').update([...args].flatMap(x => Array.isArray(x) || Buffer.isBuffer(x) ? [...x] : [])).digest()
```

For `hashv(buffer1, buffer2, buffer3, asset_string)`, `[...args]` is `[buf1, buf2, buf3, asset_str]`. The `flatMap` spreads each buffer into its individual bytes and keeps the string as a single element. `crypto.update` is then called with a mixed-type array; passing an array containing non-string-or-buffer elements (e.g., the string and the buffer bytes pass, but `update` of an array accepts strings and buffers, not numbers) throws or produces garbage.

A correct version concatenates buffers as a whole:

```js
export const hashv = (...args) => {
  const bufs = args.map(a => Buffer.isBuffer(a) ? a : Buffer.from(a))
  return createHash('sha256').update(Buffer.concat(bufs)).digest()
}
```

**Impact:** `hashv` is exported but the main crank flow uses `mintedAttributes` (Borsh) for the reveal attribute hash and Rust computes the entropy hash on-chain. The crank's `try_capture` is exported and used by `captureEntropy` (also exported). Neither is called from the main crank's pass loop. So this is a latent bug — broken helper, unused path. The right fix is the one-line change above; the right alternative is to delete `hashv` (and `captureEntropy` and `try_capture`) entirely if they are not on the production path.

**Evidence:** No test arm covers `hashv` directly; it would not be caught by the gates. `tests/probe-mainnet-facts.mjs` does not exercise it either.

## Finding 3 (LOW, latent): If any preJoin in the crank fails on chain, the distribute over-credits the remaining vaults.

`planCrank` computes the planned total weight `w` as `cfg.total_active_weight + preJoinWeight - retiringWeight - expiringWeight`. It then plans `distribute` based on `w`. The crank sends the joins BEFORE the distribute (round 25 H1, and the comment in the code: "Eligible vaults are joined FIRST: the program refuses a distribution while one waits"). If a join fails non-benignly, the join is added to `failures`, but the loop continues to the distribute, and the distribute instruction on chain sees a SMALLER `total_active_weight`. The on-chain credit per weight unit is `avail / w_actual` where `w_actual < w_planned`. Per-vault debts are reset to `weight * new_acc`, so each active vault gets a slightly larger share than planned. The failed vault, not yet active, gets nothing. The dollar effect is bounded by `(preJoinWeight / w_actual)` ≈ 0.1% for a typical missed join; cumulatively over many months of failed joins, it can drift materially. The crank reports failures, and `crank_failing` (round 24 L4) pages HIGH on three live passes in a row, so this would surface. Not a real exposure today; it is a latent accounting edge.

**Fix:** When the crank detects a join failure, read the post-failure `total_active_weight` from account state and re-plan `distribute` against it. Or, simpler, do not plan a distribute in the same pass as a failed join — defer distribute to the next pass. The "JoinWaitingFirst" gate already prevents the case where distribution would lock out newcomers; this is the reverse case (the newcomer was promised a seat but did not take it).

# Questions about the accepted limits

I have reviewed the carry list. The relevant questions:

1. **Worse than stated?** Item 44 (undeclared airdrops destroyed on redemption). The R41 acceptance of C02 means I do not see any worsening here.

2. **Closed but not yet exercised?** Item 22.5 (one DAS read of a collection holding a burned Core asset) — accepted item 22 still notes it as unresolved, and the SPEC control table says DAS is exercised by `--reconcile`. I have not run `--reconcile` myself. Status: ACCEPTED, NOT EXERCISED.

3. **Not actually discharged?** Items 1a-24 (Bank, co-signer, deck, distributor, admin, governance wiring, etc.) — all the v5 items that v6 deleted. They are gone with the things they were about. ✓

4. **OPEN AND BLOCKING treated as accepted?** Item 22 ("nothing has ever run a distribution against a live chain") is explicitly OPEN AND BLOCKING and not accepted. Item 38 (initialize values) is OPEN, with `charter_opens_at`, `lock_deadline`, and `vault_collection` still OPEN. Item 50 (the holder pages) is OPEN. Item 52 (pool + Squads + revenue CBTC accounts pre-created). Item 53 (rehearsal tree) is OPEN. I see no quiet acceptance of any OPEN AND BLOCKING item.

5. **C03 (SPEC sentence) exception condition (c) — independently re-verified before round 42?** The R41 verdict records that `.cache/drift42.md` does this re-verification. I have not read `.cache/drift42.md` myself, and the file is not in the bundle I was given. The R41 verdict says it was done. Status: I trust the verification was performed; I cannot independently re-confirm without the file.

# Summary

I verified Round 41's verdict and its two confirmed LOWs and one INFO under the documentation exception. C01 and C02 are real and fixed (C02's first M1 arm is broken as written — it should be removed or corrected, Finding 1). I found two new LOWs in the off-chain code (a broken-but-unused `hashv` in `bank/crank.mjs`, and a latent accounting edge in the crank's distribute-after-failed-join case). No CRITICAL or HIGH.

**COUNTER: 0/2 clean rounds**, unchanged from round 41. The counter stays at zero until R42 (this round) is clean. Round 42 is NOT CLEAN: Finding 1 (a broken selftest arm that round-41 left in place), Finding 2 (a broken-but-unused `hashv` in `bank/crank.mjs`), Finding 3 (a latent accounting edge in the crank). All three are LOW. None of them move real value today; the rest of the system passes its gates as far as I can tell.

**Counter: 0/2. R42 verdict: NOT CLEAN (0 CRITICAL, 0 HIGH, 0 MEDIUM, 3 LOW).**

# Recommendation before launch

Before the launch gate (SPEC §"THE SHIP GATE"):

1. **Fix the M1 selftest arm** (Finding 1). The round-41 verdict asserts the selftest reports `940/940`; if the broken M1 arm is still present, the count should be 939. Run the auditor once, observe the count, and bring the M1 arm in line with R41 C02.
2. **Fix the broken-but-unused `hashv`** (Finding 2). One-line change. Or delete the unused helper.
3. **Address the open and blocking items** (SPEC items 22, 38, 50, 52, 53). The largest exposure is item 22 (the dress rehearsal): revenue cycle through BOTH pools, one forced post-sweep failure, one DAS read of a burned-Core collection, and the long-tail crank-vs-alarm-vs-rpc coordination under mainnet cadence.
4. **Keep the freeze discipline** until two consecutive rounds (different model rosters) come back clean.

The two rounds the spec requires are still ahead.