

This is a source-only fault pass against the bundled tree. I did not execute the suite, validator, fork, alarm, crank, or revenue job. Where I make a claim, I state what observable evidence would prove or disprove it.

## R0 — Round 32 verdict and repairs

Round 32’s off-chain verdict is broadly consistent with the code in this tree:

- `detectSweepState` exists in `bank/detectors.mjs` and is wired in `bank/alarm.mjs`.
- Per-transaction and per-listing read failures are reported as `tx_unreadable` in `bank/alarm.mjs`.
- `detectLogGaps` no longer evicts unreviewed gaps; it trims only the reviewed prefix and escalates above 2,000 unreviewed gaps.
- `scripts/audit-coverage.sh` now requires the focus label in the verdict headline to match the focus being credited, and its selftest includes both-direction cases.
- `tests/expiry-budget.mjs` and `scripts/run-tests.sh` now cross-check the expiry-budget count.

Two Round-32 repair areas are not as strong as written. They are filed below as findings:

1. The Round-32 L2 repair (`tx_unreadable`) handles transient read failures but creates a permanent wedge for deterministic schema refusals, especially Solana v1 transactions using address lookup tables.
2. The Round-32 L1 repair (`detectSweepState`) accepts an uncertain `pendingSweepSig` as a full explanation for a moved `last_sweep_at`, which can mask an unauthorized sweep under narrow but real conditions.

I did not independently verify the quorum metadata or external round manifests; only the code repairs are visible here.

---

## R1 — `bank/crank.mjs`

### C1 — LOW — Crank can still pay a bare-burned vault if the burn lands between planning/sending phases

**Construct:** `bank/crank.mjs`, `planCrank()` and `main()` send order.

The crank plans against an asset-state snapshot. It retires bare burns before claims, which is the correct order, but the asset state is not re-read immediately before each claim batch. If a vault is bare-burned after the retire step is sent but before a claim batch that already includes it is sent, the claim batch can still pay that vault. The MINT `claim` instruction does not check liveness; this is accepted limit 27. The limit text says “The crank never pays or joins a positively burned vault and retires it first, every pass.” That is true against the snapshot, but not true against races inside the pass.

**Gain / loss:** The burned vault’s own share is paid into an account nobody can sign for. The loss is mainly to the burner, but while the dead weight remains, other vaults are diluted. This is the same class as accepted limit 27, but the crank’s stated control is weaker than absolute.

**Evidence if true:** On a local validator: activate and fund a vault, plan a crank pass, then land a bare Core `BurnV1` after `retire_burned` is sent but before the claim batch. The claim batch should still include the record and the program should still transfer the owed share. The current selftest arms prove the planner filters burned assets from the plan, not that the live sender re-filters before claims.

**Fix:** In `main()`, re-read the asset accounts for all records included in claim batches immediately before building each claim transaction. Drop any asset that is now positively burned and queue it for retirement on the next pass. This does not close the program-side race, but it narrows the crank-side window.

---

### C2 — LOW — Crank fee warning marker is written even if notification fails

**Construct:** `bank/crank.mjs`, `main()`, fee warning block.

```js
try { execFileSync(NOTIFY, ...) } catch {}
try { fs.writeFileSync(WARNED, String(nowSec)) } catch {}
```

If the notifier fails, the warning marker is still written. The crank will not warn again for 24 hours. This applies to the fee-floor and fee-ceiling warnings.

**Gain / loss:** No value movement. The operator can miss a low-balance or honeypot condition for a day.

**Evidence if true:** Run the crank with `NOTIFY` pointed at a failing command and a balance condition that should warn. The warning file is still written. The next run inside 24 hours does not warn.

**Fix:** Write the marker only if notification succeeds, or use separate markers for “attempted” and “delivered” and let the alarm report undelivered warnings.

---

### C3 — INFO — Crank split planning hardcodes 15% instead of reading `split_bps`

**Construct:** `bank/crank.mjs`, `planCrank()`:

```js
splitToPool = total - total * 1500n / 10000n
```

The program’s `split_bps` is fixed forever and watched, but the crank does not use `cfg.split_bps` to compute the expected pool addition. If `split_bps` were ever wrong, the alarm would already page CRITICAL, but the crank’s distribution planning would still assume 85/15.

**Consequence:** A wrong immutable value could cause the crank to plan a distribution that the pool cannot support, producing a loud refusal rather than silent mispayment. Not a theft path.

**Fix:** Compute `splitToPool` from `cfg.split_bps`, or refuse planning unless `cfg.split_bps === 8500`.

---

## R2 — `bank/alarm.mjs` and `bank/detectors.mjs`

### A1 — HIGH — A deterministic unreadable transaction can wedge a program’s signature scan forever; v1 lookup-table transactions are attacker-constructible

**Constructs:**

- `bank/txread.mjs`, `validateParsedTransaction()`:
  ```js
  if (tx.version === 1) {
    need(object(m.transactionConfig), 'v1 transactionConfig')
    need(m.accountKeys.every(k => k.source !== 'lookupTable'), 'v1 lookup-table key')
  }
  ```
- `bank/alarm.mjs`, main signature loop:
  ```js
  try { tx = await readParsedTransaction(...) }
  catch (e) { unread++; findings.push({ kind: 'tx_unreadable', ... }); continue }
  ...
  if (!unread) { advance cursor/backlog }
  ```

The Round-32 repair correctly stops a throwing read from aborting the whole pass. But it treats every read failure as retryable. A validation refusal is deterministic. A Solana v1 transaction that loads any account through an address lookup table will be refused by `validateParsedTransaction`. If such a transaction appears in the signature history of one of the watched programs, the alarm will fetch it, throw, mark `unread`, hold the cursor, and retry the same transaction every pass forever.

A stranger can construct this: send a v1 transaction using an ALT that loads one of the four program IDs (or otherwise causes the program address to appear in the signature listing). No CBOB instruction needs to execute. The result is that the transaction scan for that program cannot advance past that signature until a human edits state or the reader is changed.

**Gain / loss:** This is a detection DoS. It does not move vault funds directly, but it can indefinitely delay transaction-derived detectors for that program: unledgered sweeps, split claims, approvals, PDA token account creation, burn correlation, and program event reads. Account-state detectors still run, and `tx_unreadable` pages, but a level page that never recovers is exactly the shape operators learn to scroll past.

**Evidence if true:**

1. The selftest already contains a mutation case named `'v1 lookup table key'` and expects refusal.
2. Feed a fixture with `version: 1` and one `accountKeys[].source === 'lookupTable'` through the extracted alarm walk. The cursor should remain unchanged after two passes.
3. On mainnet, find any successful v1 transaction with ALT-loaded keys in a busy program’s signature history and observe `readParsedTransaction()` throw.

**Fix:** Distinguish transient RPC failures from deterministic schema refusals.

Preferred options:

- For monitoring only, accept resolved v1 lookup-table keys. The consumers use string pubkeys; reading a v1 history entry does not certify v1 execution. Then validate the rest normally.
- If refusal is retained, after a deterministic validation refusal record the signature as a coverage gap and advance the cursor, similar to runtime-truncated logs. Page it as a human-review gap. Do not retry forever.

Add a selftest arm proving that a deterministic invalid-schema transaction cannot wedge the cursor.

---

### A2 — MEDIUM — `detectSweepState` lets an uncertain `pendingSweepSig` fully explain a new `last_sweep_at`

**Construct:** `bank/detectors.mjs`, `detectSweepState()`:

```js
const explained = (ledger?.cycles || []).some(c => {
  if (!(c.sweepSig || c.pendingSweepSig)) return false
  const st = Date.parse(c.startedAt) / 1000
  return Number.isFinite(st) && t >= st - 120 && t <= st + after
})
```

The state-derived sweep check was added because the transaction walk can be delayed by flooding. It is supposed to be flood-immune. But it treats a ledger cycle with only `pendingSweepSig` as a full explanation for a moved `last_sweep_at`.

Scenario:

1. Honest revenue job starts a cycle and writes `startedAt`.
2. The honest sweep send times out or becomes unknown; the job records `pendingSweepSig` and throws. The sweep did not land, so `last_sweep_at` is unchanged.
3. An off-box thief holding the operator key sends a real sweep as soon as the on-chain cooldown allows.
4. If the thief’s sweep time falls inside the honest cycle’s explanation window, `detectSweepState` sees a ledger cycle with `pendingSweepSig` and does not page `sweep_unledgered_state`.

The transaction walk can still catch the unauthorized sweep by signature, but that is exactly the path that can be delayed by flooding MINT. The state backstop is therefore weaker than the Round-32 L1 claim.

**Gain / loss:** A thief with the operator key but without box/ledger write access can potentially avoid the immediate state-derived CRITICAL by timing a sweep near an honest uncertain sweep attempt. The exposure is still bounded by the on-chain cap/cooldown and eventual transaction walk, but the repair’s purpose was to remove flood-delay from this specific check.

**Evidence if true:** Pure-function test:

```js
detectSweepState({
  judgedThrough: 0,
  lastSweepAt: 1000,
  ledger: { cycles: [{ startedAt: new Date(999*1000).toISOString(), pendingSweepSig: 'x' }] },
  nowSec: 2000,
  cooldownSecs: 21600
})
```

returns no finding even though no confirmed sweep signature explains the state change.

**Fix:** Do not let `pendingSweepSig` alone fully explain a moved `last_sweep_at`.

Options:

- Emit CRITICAL or HIGH when the only explanation is an uncertain candidate: `sweep_explained_only_by_pending`.
- Or have the alarm check the pending signatures with `getSignatureStatuses(..., { searchTransactionHistory: true })` and accept only those that are confirmed/finalized. This is a small number of direct signature lookups and is not floodable like the transaction walk.

---

### A3 — LOW — `detectSweepState` anchors explanation to the ledger’s wall-clock `startedAt`, not chain block time

**Construct:** `bank/detectors.mjs`, `detectSweepState()`.

The rest of the revenue reconciliation uses `cycleStartMs()` to cap ledger wall-clock times with chain block times. `detectSweepState()` does not. It compares chain `last_sweep_at` against `Date.parse(c.startedAt)`.

If the box clock is skewed:

- Ahead: an honest sweep may fail the lower bound `t >= st - 120`, causing a false CRITICAL.
- Behind: the explanation window shifts earlier, potentially widening the period in which a thief’s sweep can be explained by an old cycle.

**Evidence if true:** Unit-test `detectSweepState` with `startedAt` offset by ±10 minutes relative to `lastSweepAt`. The current code changes its verdict purely from wall-clock skew.

**Fix:** Pass the alarm’s `seenSweeps` into `detectSweepState` and use `cycleStartMs()` or direct signature block times when a cycle has a confirmed or pending sweep signature. If no chain anchor exists, treat the explanation as uncertain.

---

### A4 — INFO — SPL Token and ATA programs are pinned for tests but not watched like other third-party programs

**Constructs:**

- `scripts/token-programs.sh` pins Token, Token-2022, and ATA program bytes for local validators.
- `bank/detectors.mjs`, `THIRD_PARTY_PROGRAMS` watches Orca, Meteora, Pyth receiver, Pyth push, but not `Tokenkeg...`, `TokenzQd...`, or `ATokenGP...`.

The payout, split, sweep helper, and swap all depend on classic SPL Token and ATA behavior. If Token or ATA were upgradeable and changed, the alarm would not page on program bytes or upgrade authority. If they are in fact immutable, that should be pinned by measurement.

**Evidence if true:** Read ProgramData for Token/ATA on mainnet. If either has an upgrade authority, the current alarm does not watch it. If neither has an upgrade authority, add a mainnet probe assertion that they are immutable.

**Fix:** Add Token and ATA to the watched third-party program list, or add a probe asserting they are immutable and document that they are outside the drift watch by construction.

---

## R3 — `bank/layout.mjs`

I found no layout fault that would cause a misread of current pinned structs.

- The Round-24 D6 seed assertion now exists: `bank/selftest.mjs` scrapes each program’s seed constants and compares them to `L.SEEDS`.
- `parseRustStruct` throws on private or malformed fields instead of silently dropping them.
- Cross-program `OFF_` constants are scraped and compared against computed offsets.
- `SealConfig.reserve_mints` is variable-length, and `offsets()` correctly stops giving static offsets after the `Vec`.
- Bool bytes are validated as 0 or 1.
- Version and discriminator checks are enforced by `readPinned()`/`decode()`.

One observation, not a finding: `layout.offsets('SealConfig')` cannot provide a static offset for `bump` because it follows a `Vec<Pubkey>`. This is correct for Borsh, and no cross-program reader pins that offset.

---

## R4 — `bank/accrual.mjs` versus MINT arithmetic

I found no divergence in the mirrored money arithmetic for the bundled MINT source.

Checked:

- `credit`: `delta = avail * ACC_SCALE / w`, `owed += delta * w`.
- `ceil_sats`: ceiling division by `ACC_SCALE`.
- `owed_of`: `(level_weight + boost) * acc + carry - debt`.
- `reweigh`: carry old owed, restart debt at new weight.
- `join`: debt at level weight times current accumulator.
- `claim`: pay whole sats, carry sub-sat remainder, restart debt at current weight.
- Boost expiry before distribution and post-distribution expiry planning in the crank.

The crank’s boost handling matches the program’s `BoostsExpireFirst` and `advance_epoch` model:

- Due boosts are expired before distribution.
- Boosts made due by this pass’s distribution are expired after it.
- Retiring burned boosted vaults removes their boost from the denominator without double-counting.

The only arithmetic-adjacent issue is C3 above: the crank assumes the fixed 85/15 split for planning instead of reading `split_bps`.

---

## R5 — Swap and revenue cycle

### S1 — LOW — `judgeSwapInstructions` does not pin all venue remaining accounts

**Construct:** `bank/swap.mjs`, `judgeSwapInstructions()`.

The judge is much stronger than the round-24 judge: it pins the seven-instruction sequence, amount, floor, output account, wrap destination, close, and no priority fee. But it does not independently pin every venue account:

- Orca: it does not check `vaultA`, `vaultB`, the three tick arrays, or the oracle PDA.
- Meteora: it does not check reserves, mints, oracle, event authority, bitmap optional account, host-fee optional account, token programs, or bin arrays.

The venue programs are expected to validate these accounts, and the fork test proves the current builder works. But the judge is described as the last line before the operator key signs. A future builder regression that misderives tick arrays, bin arrays, vaults, or reserves could pass the judge and fail only on chain. If that happens after the sweep, SOL sits on the operator key and the cycle is open until hand recovery.

**Gain / loss:** No direct theft path shown; the pool programs validate value-moving accounts. The residual is operational: open cycles, failed swaps, and a weaker pre-signing check than claimed.

**Evidence if true:** Mutate `swapInstructions` to replace an Orca tick array or Meteora bin array with a wrong PDA while keeping the first six checked keys unchanged. `judgeSwapInstructions` should return no problem; the venue should refuse execution.

**Fix:** Derive and check every venue account inside the judge:

- Orca: vaults from pool, tick arrays from `orcaTickArrayStarts`, oracle PDA.
- Meteora: reserves/mints from pool, bitmap optional behavior, bin arrays from active id, event authority, token programs.
- Add selftest tamper arms for each substituted account.

---

### S2 — INFO — `orcaSpot` converts a u128 sqrt price to JavaScript Number

**Construct:** `bank/swap.mjs`, `orcaSpot()`:

```js
const s = Number(w.sqrtPrice) / 2 ** 64
```

For the current SOL/cbBTC pool, `sqrtPrice` can exceed `Number.MAX_SAFE_INTEGER`. The relative precision loss is far below the 100 bps deviation gate, so this is not exploitable at the current threshold. But the deviation filter is a safety gate, and floating-point boundary behavior should be avoided where BigInt is available.

**Fix:** Compare prices using BigInt rational arithmetic, or compute deviation as an integer basis-point comparison without converting the raw u128 to Number.

---

### R5 answers to the specific swap questions

#### (a) Oracle math

`oracleFloor()` is dimensionally correct:

```text
sats = lamports * SOL_USD / BTC_USD * 1e8 / 1e9
     = lamports * sol.price * 10^(sol.expo - btc.expo) / (btc.price * 10)
```

- Integer rounding is downward for `expectedSats` and `minSats`, which is the safe direction for a minimum-out floor.
- BigInt arithmetic avoids overflow for the ruled 10 SOL cap and normal Pyth exponents.
- `satsPerLamport` uses Number. For live feeds this is safe enough for a 100 bps gate, but see S2.

#### (b) Pyth account verification

`readPyth()` checks:

- account owner is the Pyth receiver;
- verification level is Full;
- feed id matches;
- staleness against chain Clock;
- future timestamp bound;
- confidence ≤ 30 bps.

The account address is derived under the push oracle. Ownership by the receiver means only the receiver program can write the data. A random account cannot be substituted because `market()` reads the derived PDA. The remaining trust is the Pyth receiver and push oracle programs and their upgrade authorities, which are already listed in accepted limit 10(d).

I cannot prove from this tree that the Pyth receiver rejects replayed old fully-signed updates; the age check bounds that to 180 seconds. A chosen price would require compromising Pyth’s update path or its upgrade keys.

#### (c) Deviation filter

- Orca: `orcaSpot = (sqrt_price / 2^64)^2` gives raw cbBTC base units per lamport for the wSOL/cbBTC pool. This matches the oracle’s `satsPerLamport` units.
- Meteora: `meteoraSpot = 1 / (1 + bin_step/10000)^active_id` gives cbBTC sats per lamport for the cbBTC/wSOL pool, which is the correct inverse and direction for selling SOL for cbBTC.
- Floating point can theoretically move a pool across the exact 100 bps boundary by a negligible amount. The on-chain 150 bps floor is the binding protection.

#### (d) Minimum out

The same `oracleFloor()` result supplies both:

- the deviation filter via `f.satsPerLamport`;
- the on-chain threshold via `f.minSats`.

Units are correct:

- Orca `other_amount_threshold` is output token B base units, cbBTC sats.
- Meteora `min_amount_out` is output token X base units, cbBTC sats.

#### (e) Judge completeness

The judge checks:

- allowed programs;
- exactly one signer, the operator;
- no priority fee;
- exact CU limit;
- exact ATA creations for operator-owned wSOL and cbBTC;
- exact System transfer amount into operator wSOL ATA;
- SyncNative;
- one venue swap;
- swap amount and min-out;
- Orca direction and sqrt price limit;
- output account is operator cbBTC ATA;
- close of wSOL ATA back to operator.

It does not check all venue remaining accounts; see S1.

A tampered builder with write access to the tree can defeat the judge because the judge lives in the same tree. That is accepted limit 10’s box-owner residue. The post-swap delta check in `bank/revenue.mjs` remains the backstop for value-moving builder defects.

#### (f) Account derivation

- Orca tick arrays: current array and two below for `a_to_b`. Boundary handling with `Math.floor` is correct for negative ticks. Uninitialized arrays should cause the Orca program to refuse; that becomes a venue refusal and fallback if it happens before swap, or an open cycle if after sweep.
- Meteora bin arrays: active array and two above for Y→X. Negative bin index flooring is correct. Bitmap extension is passed as program id when absent, matching Anchor optional-account convention. Fork evidence is required to prove this against the real program; `sim/swap-fork.sh` is the right gate.

#### (g) wSOL handling

The transaction wraps exactly `lamportsIn`, syncs, swaps, and closes.

- If the operator wSOL ATA already has a wrapped balance, the swap consumes only `lamportsIn`, leaving a residual balance. `CloseAccount` will fail, reverting the whole transaction. No partial swap lands.
- If the wSOL ATA is frozen or has a delegate that blocks close, the transaction fails whole.
- If the swap consumes less than the input, close fails and the transaction reverts. Exact-input venue semantics should consume the full input.

The failure mode is an open cycle with SOL on the operator key, not silent loss.

#### (h) Failure and retry

The venue loop is correct on the stated rule:

- Orca is tried first.
- Meteora is tried only if Orca’s send is classified as `refused`.
- If Orca’s send is `unknown`, the cycle stops open; no fallback is attempted.
- If a confirmation timeout later shows the transaction landed successfully, it is recorded.
- The ledger cycle remains open until `returnedSats > 0` and either `splitSig` or `splitByOther` is present.

`cycleIsOpen()` correctly treats `'0'` returned sats as open and treats a returned-but-unsplit cycle as open.

#### (i) Extraction bounds within tolerance

With the ruled 10 SOL cap and 6-hour cooldown:

- Max swept: 10 SOL per cycle, 40 SOL/day, about 1,200 SOL/month.
- On-chain floor: oracle expected output minus 150 bps.
- Worst honest-swap loss relative to oracle: about 1.5% of swapped amount, i.e. 0.15 SOL per 10 SOL cycle.
- Monthly worst case at cap: about 18 SOL, before considering oracle staleness/confidence drift.

A sandwich or edge-of-gate pool can push execution toward the floor, but cannot force output below the floor without the transaction failing. A manipulated Meteora fallback pool can only be used if Orca refuses and Meteora is within the 100 bps deviation gate at read time; the on-chain floor still bounds output at 150 bps under the oracle. Because the swap size is capped at 10 SOL, the absolute extraction is small in SOL terms, though not zero.

These checks do not create a hard bound against a wrong or stale oracle. The 180-second age and 30 bps confidence checks reduce, but do not remove, that risk. This is already disclosed in accepted limit 10.

Operator-key theft remains bounded by the on-chain cap/cooldown and guardian stop, not by the swap judge. If the operator key is stolen, the thief can keep swept SOL without swapping. The worst case is still approximately 10 SOL per elapsed cooldown until the guardian stops the sweep, limited by revenue PDA balance above reserve.

---

## R6 — Gates, selftest, scripts

### G1 — MEDIUM — Selftest arms prove `tx_unreadable` reporting but not that deterministic unreadable transactions cannot wedge the scan

**Construct:** `bank/selftest.mjs`, Round-32 L2 arms and R27 V1 mutation arms.

The selftest proves:

- a throwing read produces `tx_unreadable`;
- the cursor holds;
- all four programs are still visited;
- a v1 lookup-table key is refused.

It does not prove what happens when the same deterministic refusal is encountered repeatedly. The current alarm behavior is to hold the cursor forever. A gate that asserts “cursor holds” for transient RPC errors is correct; a gate that allows a deterministic schema refusal to block a program scan indefinitely is not.

**Evidence if true:** Extract the alarm walk and feed the same v1 lookup-table fixture twice. The cursor remains unchanged both times and no backlog/gap mechanism takes over.

**Fix:** Add an arm for the chosen policy:

- If deterministic refusals are to be skipped, assert the cursor advances and a coverage gap is recorded.
- If they are to be accepted, remove the v1 lookup-table refusal for read-only parsed history and assert the transaction is normalized.
- If they are to wedge, that should be an explicit accepted limit with a human-runbook page, not an untested side effect.

---

### G2 — INFO — `scripts/run-tests.sh` and `bank/selftest.mjs` floors are equality-checked, but quality of assertions is not mechanically provable

The floors are not merely lower bounds:

- `run-tests.sh` uses equality for suite and sub-suite floors.
- `bank/selftest.mjs` asserts `R.length === FLOOR`.
- `scripts/audit-coverage.sh` checks current content against completed quorate rounds.

This prevents deleting assertions without moving floors. It cannot prevent replacing an assertion with a weaker one while keeping the count. That is inherent to test-count gates. The existing mutation-style arms mitigate this, but they are not exhaustive.

No specific vacuous arm was found among the bundled gates, except the deterministic-wedge gap in G1/A1.

---

## Accepted limits — the four required questions

### 1. Is any limit WORSE than stated?

Yes, in three places:

**Limit 10 / Round-32 L1 state-derived sweep check.**  
The limit says the state check pages whatever the scan backlog is. But `detectSweepState` can be silenced by a ledger cycle carrying only `pendingSweepSig`. See A2.

**Reader coverage boundary / Round-32 L2.**  
The boundary says unreadable transactions are reported and the pass finishes. It does not state that a deterministic unreadable transaction can permanently prevent a program’s cursor from advancing. See A1/G1.

**Limit 27 — crank never pays a burned vault.**  
The crank’s snapshot filter is real, but the live sender does not re-filter immediately before claim batches. A burn between retire and claim can still be paid. See C1.

### 2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?

I found no accepted limit that is already fully closed while still listed as open.

Some limits are narrower than their old text implied, but the current documents usually say so:

- Limit 10’s swap path no longer signs third-party HTTP-built transactions.
- Limit 25’s reschedule detection now has truncation-gap handling.
- Limit 32’s rolling window is stricter than the old token bucket.

### 3. Is any DISCHARGED item not actually discharged?

Among the materials bundled, I did not find a discharged item that is contradicted by the visible code.

Caveat: SEAL, BURN, and GOV program sources were not bundled in this prompt. Several discharged items rely on those programs and the on-chain suite. I can verify the off-chain mirrors and gates present here, but not independently re-prove every on-chain discharged item without the full program sources and suite logs.

### 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

No evidence in the code that open blocking items are being treated as accepted.

- Item 22: no live distribution/revenue rehearsal evidence in this tree.
- Item 38: `charter_opens_at` and `lock_deadline` remain null in `launch/mainnet-init.json`; `check-launch-params.mjs` refuses.
- Item 50: holder surfaces remain absent; `redemption-poster.mjs` has no sender.
- Item 52: road step 10 account creation is not represented as done.
- Item 53: rehearsal tree tooling exists, but the full rehearsal proof at the release commit is not evidenced here.

The holder guide remains marked DRAFT and must not be published while item 50 is open.

---

## Anything else

### N1 — Rehearsal tree does not isolate the RPC endpoint or notifier path

`scripts/rehearsal-tree.sh` substitutes the five program IDs and the repo root. It does not substitute `/opt/gary-club/.env.local` or `/opt/scripts/notify-gary-sms.sh`. A rehearsal crank/alarm/revenue run therefore reads the production RPC URL and can call the production notifier unless environment overrides are used.

This is partly documented: the script says alerts still go to the production notifier and to tell Gary before running. But the RPC endpoint is also production. Running rehearsal jobs with `--live` against mainnet RPC with throwaway program IDs will mostly fail, but it is an operational hazard.

**Fix:** Have the rehearsal patch also substitute an env file path or require an explicit `CBOB_REHEARSAL_RPC` variable, and refuse live modes without it.

### N2 — `$CBOB` metadata update authority is retained and mutable

`launch/create-cbob-token.mjs` deliberately keeps metadata mutable and sets the update authority to Gary’s wallet. This cannot mint or freeze tokens, but it can change name/symbol/URI/icon. If that wallet is compromised, the token’s public metadata can be pointed at phishing content. This is a ruling, not a code defect, but it is not in the holder guide’s honest list as clearly as the release-wallet custody risk.

**Suggested disclosure:** Add to the holder guide that metadata is mutable and controlled by Gary’s wallet, and that this affects presentation only, not supply or freeze.

### N3 — Revenue job can exit quietly when sweep is stopped, even if an open cycle exists

`bank/revenue.mjs` checks `cfg.sweep_stopped` before the open-cycle guard. If the guardian stops the sweep while a cycle is open, the job prints the stop message and exits without throwing the open-cycle error. The alarm still detects unreconciled revenue, so this is not silent in the full pipeline, but the revenue job itself does not surface the open cycle in that branch.

**Fix:** Run the open-cycle audit before the sweep-stop return, or print the open-cycle list when stopped.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the live dress rehearsal as a real operational event, not a test.**  
   Execute item 22’s named pass/fail items on throwaway program IDs with small real amounts:
   - live crank passes at scale;
   - live alarm passes in rehearsal mode;
   - one full revenue cycle through Orca;
   - one forced Orca refusal and full Meteora fallback;
   - one forced post-sweep failure and hand recovery;
   - one DAS burned-asset read settlement.  
   Record signatures and human sign-off for each.

2. **Perform the initialize ceremony with witnessed read-back.**  
   AI can check JSON and source, but it cannot witness that the signed `initialize` transactions were built from `launch/mainnet-init.json`, landed with the exact values, and were read back by an independent party. The four initializations, pool/revenue/Squads ATA creation, and revenue rent funding should be done with checklists and read-backs.

3. **Move the highest-risk hot keys out of the single box before launch.**  
   The code accepts several hot-key risks by ruling, but operations can still reduce them:
   - PoB collection update authority should be cold or multisig through the charter window.
   - `$CBOB` release wallet should be moved off the box or into a controlled release contract/multisig if possible.
   - Guardian key should have a documented, tested replacement path.
   - Swap operator key should be funded just enough and monitored separately.

4. **Build and user-test the holder surfaces before the holder guide is published.**  
   The redeem page must run `judgeRedemptionCoverage`, create missing destination accounts in a prior transaction, use the sweep helper, handle frozen-pool claim exclusion, and set compute limits correctly. This needs real wallet testing, not just pure-function tests.

5. **Stand up an off-box detection replica.**  
   The current alarm, ledger, crontab, and keys share one user on one box. An independent read-only replica on another machine, another RPC provider, and another alert channel is the only practical answer to box compromise. AI audit cannot operate that replica.

6. **Run an adversarial soak against the monitoring layer.**  
   Before lock, deliberately attack the alarm in a rehearsal environment:
   - flood MINT with stranger transactions;
   - insert runtime-truncated logs;
   - insert deterministic v1/ALT transactions;
   - simulate operator-key theft;
   - simulate crank lock wedge;
   - simulate RPC outage and clock skew.  
   The goal is not to prove the code is clean; it is to prove the pages arrive and humans know what to do.

7. **Make the final human decision explicit.**  
   The ship gate can be mechanically checked, but the decision to remove upgrade authorities is irreversible. It should be a named human act after all open blocking items are closed, with the exact program hashes from `scripts/build-mainnet.sh` and a recorded quorum of clean audit rounds. AI can advise; it cannot own that decision.