# INDEPENDENT SECURITY AUDIT — CBOB v6, round 24 (off-chain + MINT)

Method: read-only. I read every line of the bundle and measured the pure modules by hand-tracing them against `programs/cbob-vault-mint/src/lib.rs`. Where I could not run something I say so and name the run that would settle it. Every finding states the evidence that would exist if I am right.

I found no CRITICAL. I found two HIGH, three MEDIUM, and a set of LOW/INFO. Two of the HIGH/MEDIUM are in the round-23 repairs themselves, which is where the brief told me to look.

---

## R1 — THE CRANK (`bank/crank.mjs`)

### H1. HIGH — `crank_silent` is disabled by a failing `crontab -l`, and the failure is swallowed. This re-opens the exact hole round 23 M3 closed.

**Construct.** `bank/alarm.mjs`, the heartbeat block:

```js
let crankLive = false
try { crankLive = D.crankArmed(execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] })) } catch { crankLive = false }
...
findings.push(...D.detectCrankSilent({ stampSec: ..., live: crankLive, armedSinceSec: crankArmedSince, nowSec }))
```

and `bank/detectors.mjs`:

```js
export function detectCrankSilent({ ... } = {}) {
  if (!live) return []
  ...
}
```

**What is gained.** `crankLive` is `false` in exactly two situations: the crank is genuinely disarmed, and *the read failed*. Nothing distinguishes them, and no finding records the failed read. If `crontab` is absent, not on `PATH`, runs under a uid with no crontab, or the crontab is corrupt, `catch` sets `crankLive = false` and `detectCrankSilent` returns `[]` unconditionally. The result is the exact scenario limit 7's round-23 amendment was written to close: a wedged full-pass crank while ordinary traffic keeps running the monthly distribution in-line — `owed_scaled` grows, no `claim` is delivered, `last_distribute_at` stays fresh (so `distribution_overdue` is quiet), `poolAvail` reads ~0 after each in-line credit (so `distribution_overdue`'s `poolAvail > 0` gate is quiet), the pool is solvent, and the report prints the all-clear list.

This is a direct violation of the file's own governing rule, stated in its header: *"A read that fails is an ALARM, never a pass."*

**Evidence if I am right.**
1. On a box where `crontab -l` exits non-zero (e.g. `PATH=/usr/bin` with `cron` not installed, or a user with no crontab), run `node bank/alarm.mjs --dry-run` against a live config whose full-pass crank line is `--live` and whose `.crank-heartbeat` is 10 hours old. The report contains **no** `crank_silent` entry and prints the all-clear list.
2. `node -e "const D=require('./bank/detectors.mjs'); console.log(D.detectCrankSilent({stampSec:null, live:false, armedSinceSec:null, nowSec:1}))"` prints `[]`.
3. Mutation arm: replace `catch { crankLive = false }` with `catch { crankLive = null }` and have `detectCrankSilent` treat `live === null` as a finding — the run above then pages.

**Fix.** Make `crankArmed` return a tri-state (`true` / `false` / `unreadable`) and raise `crank_posture_unreadable` at HIGH on the third. Never let a failed read of the crank's posture be indistinguishable from a disarmed crank.

---

### M1. MEDIUM — `NothingToSplit`, `NothingToDistribute` and `PoolShort` are not in `BENIGN`, so any stranger can make the crank page a failure and SMS the operator once an hour for the price of a transaction fee.

**Construct.** `bank/crank.mjs`:

```js
export const BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed|AlreadyRetired|AlreadyActive|VaultRetired|ActivationPending|RevealWindowExpired|NeedsReschedule/
```

`planCrank` sets `plan.split = true` whenever `revenue.amount > 0`, and `plan.distribute = true` whenever `due && w > 0 && avail > 0`, where `avail` is computed from the pool balance read **at plan time plus `splitToPool`**. `split_revenue` and `distribute` are both **permissionless** (SPEC: "anyone may split"; "`distribute` is permissionless"). MINT's `split_revenue` refuses `NothingToSplit` and `distribute` refuses `NothingToDistribute` / `PoolShort`, and none of those three is in `BENIGN`, so `send()` returns `'fail'`, `run()` pushes to `failures`, `main()` sets `process.exitCode = 1` and calls `notify-gary-sms.sh`.

**What is gained.** A griefing channel on the operator's alert path that costs one transaction fee per shot and needs no key. Because the crank splits **every hourly pass** and `split_revenue` is free to call, anyone who sends `split_revenue` in the seconds before :37 makes the crank report `FAIL split_revenue` and text Gary — 24 times a day, indefinitely. The same shape works against `distribute` at each month boundary via the free `distribute(false)` path. The project's own rule is written into `detectors.mjs`: *"a detector that cries wolf at that volume is one nobody reads."* A real crank failure arriving inside that noise is the loss.

Secondary cost: one wasted signature fee per grief.

**Evidence if I am right.**
1. Against the suite's validator: plan a pass with `revenue: {state:'ok', amount:1000n}`, send `split_revenue` from a second key first, then run the crank's `send('split_revenue …')`. The error log contains `NothingToSplit`, `failures` has length 1, and the notify stub is invoked.
2. `CR.BENIGN.test('Error Code: NothingToSplit')` → `false`; same for `NothingToDistribute` and `PoolShort`.
3. Counter-check: `CR.BENIGN.test('Error Code: MonthNotElapsed')` → `true`, showing the asymmetry is a gap and not a policy.

**Fix.** Add `NothingToSplit|NothingToDistribute|PoolShort` to `BENIGN` **and** name them in the log as "done by other traffic". `PoolShort` deserves its own line in `plan.problems`, because it is also the symptom of a real insolvency and must not be flattened into "someone beat us to it" — split it: `PoolShort` reported, the other two benign.

---

### M2. MEDIUM — `bank/accrual.mjs`'s `reweigh` (and `pendingScaled` fed a real record) reads field names the `VaultRecord` does not have, and the selftest's fixture hides it.

**Construct.** `bank/accrual.mjs`:

```js
export function pendingScaled({ level, debt, boost = 0, carry = 0n }, acc) {
  const p = (weightOf(level) + BigInt(boost)) * BigInt(acc) + BigInt(carry) - BigInt(debt)
  ...
}
export function reweigh(v, acc, boost) {
  const owed = pendingScaled(v, acc)          // <-- v is expected to be a record
  return { ...v, boost, carry: owed, debt: (weightOf(v.level) + BigInt(boost)) * BigInt(acc) }
}
```

The on-chain `VaultRecord` (and `bank/layout.mjs`'s decode of it) names these fields **`boost_weight`** and **`carry_scaled`**, not `boost` and `carry`. The file header claims these are *"the Rust formulas, line for line (programs/cbob-vault-mint `credit`, `owed_of` as `claim` pays it, `reweigh`, `ceil_sats`)"*.

**What is gained.** `reweigh` is documented as the mirror of MINT's `reweigh` and is exported. Fed a decoded `VaultRecord` it destructure-misses both fields, defaults `boost` to 0 and `carry` to 0n, and computes `owed = level_weight*acc - debt` — silently dropping the live boost **and** every sat already carried across a previous weight change. In the other direction it writes back `boost` / `carry`, so the record it returns would be un-decodable by `layout.mjs`. The `crank.mjs` live path survives only because it renames explicitly at each call site (`boost: r.boost_weight ?? 0, carry: r.carry_scaled ?? 0n`). `accrual.mjs --selftest` passes because every fixture it feeds `reweigh` / `pendingScaled` is `{ level, debt }` or `{ level, debt, boost, carry }` — never a record shape. So the suite certifies a mirror that is wrong for its stated input, which is the "gate that proves the wrong thing" class.

Nothing in the shipped path calls `reweigh` today, which is why this is MEDIUM and not HIGH. It is a landmine directly under the "must equal the program's" requirement.

**Evidence if I am right.**
1. `node -e "import('./bank/accrual.mjs').then(A=>{const r={level:1,debt:0n,boost_weight:2,carry_scaled:5n*A.ACC_SCALE};console.log(String(A.reweigh(r, 10n*A.ACC_SCALE, 0).carry))})"` prints `0` instead of `70n * ACC_SCALE`.
2. The same record through MINT's `owed_of` (`weight_of=2`, `boost_weight=2`, `carry_scaled=5e12*ACC_SCALE`, `debt=0`) is `4*10*ACC + 5*ACC = 45*ACC`.
3. Mutation arm: add `t('reweigh on a REAL record shape', ...)` feeding `{level, debt, boost_weight, carry_scaled}` and asserting the carried share survives — red today, green after the fix.

**Fix.** Either rename the parameters to `boost_weight` / `carry_scaled` throughout `accrual.mjs` and have `reweigh` accept a record, or delete `reweigh` (it is dead code in the live path) and drop the header claim. Then add a selftest arm that feeds a `layout.decode('VaultRecord', …)` object.

---

### L1. LOW — a reveal of an asset the bulk read classified `'other'` sends an empty attribute list and fails `AttributesMismatch`, which is not benign: the whole reveal run halts and the operator is paged for what is a read anomaly.

**Construct.** `bank/crank.mjs` reveal loop:

```js
let list = []
if (assets[r.asset] === 'live') { try { list = await mintedAttributes(...) } catch { … break } … }
const ok = await send(`reveal …`, … Buffer.concat([d('reveal_level'), attrsBorsh(list)]) …)
```

`assets[r.asset] === 'other'` means `getMultipleAccountsInfo` returned `null` or an unexpected `data[0]`. `list` stays `[]`, `attrsBorsh([])` hashes to something that cannot equal `attrs_hash`, and MINT returns `AttributesMismatch` — absent from `BENIGN`.

**Evidence.** `CR.BENIGN.test('Error Code: AttributesMismatch')` → `false`. Replay: a record with `assets{asset:'other'}` and a non-empty `attrs_hash` produces `failures: ['reveal …']` and `break`s the lane.

**Fix.** Treat `'other'` on a reveal head like the L1 `mintedAttributes` throw: log, `break`, let the next pass re-read. Do not spend a fee on a list you cannot verify.

---

### L2. LOW — `payDecimals` is read with `?.data?.[44]` and falls through to `undefined`, which `Buffer.from([undefined])` turns into `0`; `TransferChecked` then refuses the split for a wrong-decimals argument.

**Construct.** `bank/crank.mjs`:
```js
const payDecimals = (await conn.getAccountInfo(payMint, 'confirmed'))?.data?.[44]
…
data: Buffer.concat([d('split_revenue'), Buffer.from([payDecimals])])
```

**Evidence.** `Buffer.from([undefined]).toString('hex')` → `'00'`. A split built with decimals 0 against cbBTC (8) is refused by the Token program inside `split_revenue`, producing `FAIL split_revenue` for a transient mint-account read.

**Fix.** Fail the split arm loudly when `payDecimals` is not `0..255`, or pin it to `cfg.payment_mint`'s decimals read once at plan time.

---

## R2 — THE ALARM (`bank/detectors.mjs`, `bank/alarm.mjs`)

H1 above is the alarm's headline. Additional:

### M3. MEDIUM — `detectSplitClaims`'s L16 anchor consumes one on-chain split per `splitByOther` cycle, but one `split_revenue` legitimately covers every unsplit cycle at once. The crash-recovery path creates exactly that shape.

**Construct.** `bank/revenue.mjs` recovery:
```js
const returnedUnsplit = (led.cycles||[]).filter(c => cycleIsOpen(c) && BigInt(c?.returnedSats ?? 0) > 0n)
if (returnedUnsplit.length) { if (isProvablyEmpty(…)) { for (const c of returnedUnsplit) { c.splitByOther = true; … } } }
```
This marks **every** returned-but-unsplit cycle closed in one go. `bank/detectors.mjs` `detectSplitClaims` then builds a pool of unclaimed splits and does `pool.find(e => !used.has(splitSig(e)) && …); if (hit) used.add(...)` — one anchor consumed per cycle.

`split_revenue` moves the **entire** revenue ATA balance in one call. So N cycles that returned into the ATA and were divided by a single split are correctly closed by one signature, but the anchoring demands N signatures.

**What is gained.** A false `split_by_other_unanchored` CRITICAL on the trusted-hop reconciliation — the detector whose whole job is to not cry wolf on this path. The money is correct (the split really happened, to pinned destinations); only the page is wrong.

**Evidence if I am right.**
1. Drive `detectSplitClaims` with one unclaimed split `{sig:'S', blockTime:T, total:'8000'}` and two cycles `{returnedAt:T-60, returnedSats:'5000', splitByOther:true}` and `{returnedAt:T-30, returnedSats:'3000', splitByOther:true}`. It returns `split_by_other_unanchored` for the second.
2. The same input with two splits of 5000 and 3000 returns `[]`.
3. Real-world trigger: a crash between step 3 and step 4 of two consecutive cycles, then one crank split.

**Fix.** Let one anchor cover a **contiguous run** of `splitByOther` cycles whose combined `returnedSats` is ≤ the split total and whose return times all precede the split. That preserves L16's "big enough" property while matching how `split_revenue` actually works.

---

**Routine state paged / dangerous state quiet — the rest of R2.** The fixed-forever watch list, the PoB collection plugins + update authority, the redemption window, pool frozen/insolvent, distribution overdue, and the lock date are all covered and I could not construct a dangerous on-chain state that reads quiet other than H1. On the other side, `detectRedemptionRate` pages HIGH `redemptions_near_cap` on **every single redemption** once live supply is ≤ 47 (cap 1, `near = max(1, floor(1*0.2)) = 1`, so `remaining = 0` fires). Round 22 A3 fixed only the *idle* case and the selftest asserts the used case fires, so this is intended — but at low supply it is a routine state paging every pass, and I would set `nearFraction` to 0 when `cap === 1`.

---

## R3 — THE LAYOUTS (`bank/layout.mjs`)

I hand-verified `MintConfig`, `VaultRecord`, `BurnConfig`, `SealConfig` and `GovConfig` field-for-field against the Rust, and recomputed every pinned offset. **All match**, including `governance` @ 41, `minted_total` @ 141, `bare_burns_retired` @ 454, `pool_ata` @ 73, and `fixedLength('MintConfig') = 1005` against `MINT_CONFIG_SPACE = 1005 + CONFIG_PADDING`.

`parseRustStruct` is strict (throws on a line it cannot read as one `pub name: Type,`), so a private / `pub(crate)` / retyped field breaks the build. A struct change cannot slip past these assertions. `collectionPluginsHash` correctly blinds to `num_minted` / `current_size` while covering the plugin registry.

**No finding.** One observation for the record: our own collection's **update authority** is not watched (only the PoB collection's is). It is MINT's `["mint"]` PDA and no instruction can rotate it, so this is sound — but it rests on "MINT has no such instruction", which is a claim about the source, not an assertion. Cheap to add as a watched key.

---

## R4 / R4c — MONEY ARITHMETIC AND THE ROUND-23 REPAIRS

M2 above is the arithmetic finding. Repair-by-repair:

| repair | verdict |
|---|---|
| `detectRevenueAccount` clock (M1) | correct. `since = max(prevSince, last split blockTime)`, both in seconds, walk runs first. |
| `detectRevenueAccount` unreadable keeps the clock (L10) | correct. |
| `detectRevenueAccount` frozen at any balance (L9) | correct. |
| `judgeRevealAttrs` (M2) | correct, including the tampered-plus-`level` case. |
| crank heartbeat + `detectCrankSilent` (M3) | **defective**: see H1. |
| `detectUnsweptRoyalties` (M4) | correct. Blind to a sweep smaller than the same-window inflow, and that is named. |
| widened `BENIGN` (L1) | correct for the listed codes; **incomplete** for the permissionless money instructions, see M1. |
| live-only joins and payments (L2) | correct at every site (activate, preJoin, join, claim). |
| tick discounted by this pass's retirements (L3) | correct. |
| `plan.owed` (L4) | correct; matches `owed_of` through expiry and reweigh. |
| alarm wiring derived from `detect*` (L5) | **the property holds** (proved by the adjacent `V6_WIRED.filter(n => !calls(alarmSrc, n)) === []` arm), **but the L5 arm's own second element is a tautology**: see L3 below. |
| launch gate pins (L7, L8, L17) | correct and armed both ways. |
| drift suppression on program appearance (L11) | correct; `NO_PROGRAMDATA` still drifts because it is a value, not `undefined`. |
| `lockDeadlineOf` (L12) | correct. |
| plan-sized fee floors (L14) | correct and conservative (over-counts reveal rent on burned vaults, safe direction). |
| lock liveness-before-age (L15) | correct; a live or non-recycled holder is never broken, an unreadable record is a refusal. |
| split anchoring by total (L16) | **correct in kind, over-strict in cardinality**, see M3. |

### L3. LOW — the L5 wiring arm's second element cannot fail, and its label claims a property it does not prove.

```js
t('L5: … and deleting ANY ONE call from alarm.mjs turns this red',
  [[…].every(n => V6_WIRED.includes(n)),
   V6_WIRED.filter(n => calls(alarmSrc.replace(new RegExp(`D\\.${n}\\(`,'g'), 'D.cut('), n))], [true, []])
```

For every `n`, the replacement removes exactly `D.<n>(`, so `calls(src', n)` is `false` whether `n` was called once, twice, or never. The filter is therefore **always `[]`**. Deleting one call — or all calls — leaves it green.

**Evidence.** `alarmSrc.replace(/D\.detectPoolHealth\(/g,'D.cut(')` then `new RegExp('D\\.detectPoolHealth\\(').test(...)` → `false` for a source with two calls, one call, or zero calls.

**Why it is only LOW:** the adjacent arm `V6_WIRED.filter(n => !calls(alarmSrc, n)) === []` genuinely turns red on an unwired detector, so the gate works. But the label is false and the arm is decoration — and the brief told me the worst defect is usually in the previous round's repair. Delete the second element or make it do what the label says (assert the filter is non-empty before the substitution and empty after).

---

## R4b — THE BOOST OFF CHAIN

- `preExpires` / `postExpires` are planned correctly, and `expire_boosts` skips rather than reverting a stale post-expiry, so a failed distribute cannot produce a false failure there. Confirmed against MINT.
- The owed math carries `boost_weight` and `carry_scaled` correctly **only via the crank's explicit rename** (see M2).
- `boosts_stalled`, `mint.cbob_mint`, `mint.max_boost_weight`, `mint.max_boost_epochs` are all watched as ruled.
- `launch/create-cbob-token.mjs`: I checked the one-transaction shape. `createInitializeMint2Instruction(mint, 6, release, null)` sets **no freeze authority, ever**; `createSetAuthorityInstruction(mint, release, AuthorityType.MintTokens, null)` revokes the mint authority in the **same** transaction, so there is no state in which supply is partial and the mint authority is live. `readBackFacts` asserts supply, decimals, both authorities `null`, and the release balance. **No finding.**

  One gap worth naming (not a defect in this script): the **metadata update authority is retained and the metadata is mutable** on `$CBOB`. That is ruled, but it is not in accepted limit 56's cost list, and a thief of the release key *or* of Gary's wallet can repoint the `$CBOB` icon/URI at a phishing page. See the accepted-limits answer below.

---

## R5 — THE SWAP HOP (`bank/revenue.mjs`)

- Worst case: `min(balance − reserve, MAX_PER_CYCLE, chainCap)` = **10 SOL per sweep** at the ruled cap, × one per 6 h cooldown, until the guardian pulls `emergency_stop_sweep`, and never more than the revenue PDA holds above `sol_reserve_lamports`. Matches the stated bound.
- `cycleIsOpen` is the single imported predicate; `sendRejected` closes a refused send; a confirmation timeout stays open. The ledger cannot read a failed cycle as closed.
- Nothing here can send value anywhere the program does not pin: `sweep_sol_for_swap` requires `swap_operator == cfg.swap_operator` and the destination is that key; `split_revenue`'s two destinations are derived from config inside MINT.
- The empty-ATA proof for `splitByOther` correctly requires `isProvablyEmpty` (absent is **not** empty).

**No new finding** beyond M3 above and the accepted limit 10 wording.

---

## R6 — THE GATES (`bank/selftest.mjs`, `scripts/run-tests.sh`)

- Floors are equality-checked (`R.length !== FLOOR`, and `floor()`'s `-eq`). Good; slack cannot accumulate.
- `MIN_ASSERTIONS` is hardcoded and `CBOB_TEST_FILE` is refused. Good.
- The `alarm.mjs` `if (s.err) continue` guard is asserted against the running source, in both directions. Good.
- The signer-set gate is scoped to `bank/`, `scripts/`, `tests/` and correctly flags an unpinned third signer **inside that tree**. It does not see `launch/create-cbob-token.mjs`, which signs with two keys; the label "exactly TWO signers exist in v6" overstates the scope. LOW.
- **Verification item, not a finding:** `HOST_FLOOR=5` in `run-tests.sh`, but I count **four** `#[test]` functions in `lib.rs`'s `host_tests` module. If the real count is four, `floor "host unit tests"` would `die` and the suite would be red — which contradicts the reported green run, so either I miscounted or there is a fifth test elsewhere in the crate. Re-count before the next freeze; a floor that does not equal its count is the exact defect this project keeps finding in its own gates.

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

**1. Is any limit WORSE than stated?**

- **Limit 32, slightly.** The cap is `ceil(2.1% × (minted_total − burned_total − bare_burns_retired))`. A **bare Core burn** subtracts nothing until someone calls `retire_burned`, so in the window between the burn and the crank's next pass the denominator is stale and the cap is fractionally **looser** than "2.1% of live". At 2,100 the `ceil` usually does not move (44.1 → 45 vs 44.31 → 45), but at smaller supply it can add a redemption per hour. Bounded by the crank's hourly retire; not a new class, but the buyer-facing sentence should read "2.1% of live vaults **as last retired**".
- **Limit 56, incomplete rather than worse.** Its cost list does not include the `$CBOB` **metadata**: the update authority is Gary's wallet and `isMutable: true`, so the icon and URI can be repointed at a phishing page by anyone holding either that wallet or the release key. That is ruled, but it belongs in the same paragraph as the release-key custody, because the two are the same attack surface for a buyer deciding whether to trust a `$CBOB` balance.
- **Limit 10, wording.** "the operator wallet holds only the cycle's funds and a 0.02 SOL float" reads as a guarantee. The code only refuses **below** 0.02 SOL and never caps above; the FORBIDDEN list in the swap validation excludes the upgradeable loader and MINT but **not** `SystemProgram` or `Tokenkeg`, so a substituted `/swap` response can move the operator's SOL and cbBTC anywhere. SPEC elsewhere calls this "an operational instruction, not a code guarantee" — limit 10 should say the same, and the bound should be stated as "whatever the operator wallet holds at the moment of signing".

**2. Is anything listed as a limit not actually a limit / already closed?**

- **Limit 13** is closed the moment the upgrade authority is removed, and the ship gate removes it before anything holds value. It is a *pre-lock condition*, not a post-launch limit. As written it is honest, but a buyer reading "ACCEPTED — will not fix" will read it as permanent. Move it next to limit 39 with a "closed by the lock" note.

**3. Is any DISCHARGED item not actually discharged?**

- **12/17** is discharged only for the padded-mint path. Its headline — *"a transaction that fits cannot run out of compute … The byte wall binds more than twenty-five times before the compute wall"* — is contradicted by item 54 (a mint carrying four captures is refused under the default 200,000 CU budget). The correction currently lives 300 lines away in item 54. A reader who stops at 12/17 takes away a false guarantee. Put the caveat inside 12/17.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

Not accepted — but the blocking list carries **two finished items**, which is the same failure mode as a floor with slack: it trains readers to skip the section.
- **51** says "DECIDED AND BUILT", names suite sections BO and 0.1o–0.1v, and says the `$CBOB` mint exists on mainnet. It is done.
- **53** says "**Proven 2026-10-04 at `d57ee3a`:** the FULL `scripts/run-tests.sh` passes inside the rehearsal tree". It is done.

Both should move to DISCHARGED with their evidence, so that what remains in OPEN AND BLOCKING — **22, 38, 50, 52** — is exactly the live set. Those four are genuinely blocking and are not being treated as accepted: 38 is enforced by `check-launch-params.mjs` refusing while anything is OPEN, 50 is named as a precondition of road step 11, 22 and 52 are numbered launch steps.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what this project should do before launch that AI audit structurally cannot

1. **Execute the failure, not the happy path, against a live cluster.** The 748-assertion suite proves the programs' rules; it has never proved the **operators'** behaviour when the rules refuse. Before the lock, run the crank and the alarm live against the throwaway-id rehearsal deployment and deliberately: front-run every `split_revenue` and `distribute` the crank plans (M1 is the first thing that will fall out); kill the crank mid-pass and leave it wedged for six hours; delete `state.json` and `revenue-ledger.json`; corrupt `acks.json`; make `crontab -l` fail; send 0.30 SOL to the crank key. An AI round can only *predict* what those do. Watch what the SMS channel actually receives.

2. **Have a human read the SMS/Slack stream for a full week of real traffic and say out loud which pages they would have acted on.** The single most expensive defect class in this project's history is not a wrong number, it is a **detector nobody reads**. AI audit structurally cannot feel alert fatigue. If a week of real alerts produces a page nobody would have opened, that detector is worse than absent.

3. **Transfer the `$CBOB` release supply to a Squads (or Gary's own wallet) and destroy `bank/keys/cbob-release.json` — including from the R2 backups — before any `$CBOB` is released.** Accepted limit 56 records this as Gary's call; I am not arguing the ruling, I am saying the *mechanical* act of deleting the file and confirming the backup is gone is a physical task no audit round can perform or verify.

4. **Build the redeem page (item 50) and then have a real holder, on a real testnet vault, redeem through it — including a vault that has been airdropped junk and one with a foreign Core asset nested in it.** Items 9 and 44 have **no** preventive control until that page exists and runs `judgeRedemptionCoverage`. The selftest proves the pure function; only a human signing a transaction against a populated vault proves the page calls it.

5. **Freeze, then run two rounds with genuinely disjoint model rosters, and refuse to accept a round whose findings were not each adjudicated against a run.** ~1/3 of historical CRITICALs were wrong on measurement. The rule that converts a rejected claim into a permanent assertion (ship gate item 5) is the right one — enforce it mechanically: no round closes until every rejected finding has either an assertion or a named reason it cannot be one.

6. **Run `scripts/build-mainnet.sh` on the machine that will deploy, from a clean checkout, and have a second person compare the printed sha256 to what `solana program show` reports after deploy.** The `--features localnet` / `INIT_AUTHORITY` split is the one place the tested binary differs from the shipped one and it cannot be checked by inspection. Two people and one printed hash close it; no audit round can.

7. **Count the host unit tests against `HOST_FLOOR` by hand, once.** I count four `#[test]` functions and a floor of 5. If I am wrong, the note costs nothing. If I am right, `run-tests.sh` is red and something else is green that should not be.