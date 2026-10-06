# Round 29 audit: off-chain pipeline and the whole current tree

I read the files you bundled. I ran nothing, so every finding below states the evidence that would exist if it is right. I read the round-28 verdict as evidence and checked each of its repairs against the current source. Two of its repairs introduced or left defects (F1, F2).

---

## FINDINGS

### F1. HIGH, CRITICAL if measured true: a vault owner can bloat their own Autograph and permanently stall the level queue

**Constructs:**
- `reveal_level` requires `index == revealed_total` and has no skip path for a live asset.
- SPEC item 40's "Round 28 validation" paragraph records the Core 32 KiB heap boundary.
- It then treats the consequence as a holder-facing risk only ("BUYER-FACING", "an independent reviewer found no third-party route to stall").

**Why this is wrong:**
- The route is not a third party. It is the owner of whichever vault is at the head of the FIFO.
- The owner can add the owner-managed Autograph plugin at any time, and any signer can append a signature.
- The suite measured only one point: a 10,150-byte message, where the reveal still landed.
- The same paragraph says shrinking that asset exhausted the heap, and that "near this boundary the asset's shape decides the outcome."
- Core runs in a fixed 32 KiB bump heap. Plugin data is deserialized into it, and it cannot be freed. Any Autograph at or above about 32 KB therefore cannot be loaded by any Core instruction that validates the asset's plugins, including `UpdatePluginV1` on Attributes.
- Rent for that size is about 0.23 SOL, plus one mint price (21,000 sats minimum).

**Attack:**
1. The attacker mints a vault in a sale round, or claims a charter vault.
2. They add an Autograph and grow it with ~30 signers or transactions before their turn in the FIFO. Earlier vaults give them minutes; with none ahead they have about a dozen slots.
3. The head `reveal_level` reverts on heap exhaustion. The attacker never burns the vault and cannot be forced to.
4. `revealed_total` never advances. No later vault can be revealed, so none can be activated (`NotRevealed`). The program is immutable, so this is permanent.
5. Vaults already activated keep earning. Every vault behind the attacker's is locked out of payouts for good.

**Evidence that would exist if right:**
- Rerun R28.A1 with the head vault's Autograph at 14, 18, 24 and 33 KB before the reveal.
- Somewhere above 10,150 bytes the MINT `reveal_level` fails with heap exhaustion.
- A second `reveal_level` for the same vault fails identically.
- The crank's reveal lane logs `FAIL reveal` every minute, and the alarm pages `reveal_queue_stalled`.
- If every size up to the largest achievable still reveals, withdraw this finding. That measurement is unmade today.

**Fix (before the lock; resets the freeze):**
- Add a permissionless path that draws and records the level in `VaultRecord` without the Core write.
- Allow it only when the asset account's data length exceeds a bound (for example 8 KiB), and log `CBOB_LEVEL_UNWRITTEN`.
- Payouts read the record, not the attribute, so nothing economic depends on the Core write.
- Measure the real failure threshold and set the bound well under it.

---

### F2. HIGH: one cheap transaction permanently kills the whole alarm pass (round-27/28 reader repair)

**Constructs:**
- `bank/txread.mjs` `validateParsedTransaction` now throws on `logs truncated by runtime` (and on any unreadable shape).
- `bank/alarm.mjs` calls `readParsedTransaction` inside the per-signature loop with no try/catch. The old `if (!tx) { unread++; … continue }` path only handles `null`.

**Attack:**
1. A stranger sends a successful transaction that lists `MINT` (or SEAL, BURN or GOV) as a read-only account.
2. The same transaction contains more than 10,000 bytes of logs, for example about 25 Memo instructions of ~400 bytes.
3. `getSignaturesForAddress(<our program>)` returns it. The alarm already depends on this, because it discovers our transactions through program ids that are only read-only keys.
4. The reader throws. `main()` aborts before `report()` runs.
5. The throw also discards the findings computed earlier in the same pass: the DAS burn diff, pool health, distribution-overdue, drift and frozen-account detectors.
6. Every later pass re-reads the same transaction and dies the same way. The cursor never advances.
7. The only output is the level `run_failed` page. The attack costs about one fee.
8. A human can skip the cursor by hand; the attacker repeats it.

**Sibling sites with the same shape:**
- `bank/revenue.mjs` `splitsSince` has no try/catch. Anyone can put the revenue ATA address in a log-heavy transaction, and then recovery throws every hour whenever a returned-unsplit cycle exists.
- `bank/redemption-poster.mjs` `main` throws before it saves its cursor.

**Evidence that would exist if right:**
- Send the transaction above on a fork or mainnet.
- `node bank/alarm.mjs --dry-run` prints `FAILED TO RUN: unreadable parsed transaction: logs truncated by runtime` on every pass.
- No detector output appears for that pass.
- The existing fixture `markerText` test only exercises the reader in isolation. It never runs the loop under an attacker who chooses the transaction.

**Related:** about 20,000 successful spam transactions naming `MINT` (roughly 0.1 SOL) fill `signaturesSince`'s 20 pages × 1,000. That yields `scan_gap` with the cursor held, so older real transactions are never reached while the spam lasts. This is paged, but it is the same cheap-blinding class.

**Fix:**
- Treat an unreadable or truncated transaction as a per-transaction coverage gap: page `tx_unreadable` HIGH with the signature.
- Still run the instruction-derived detectors on that transaction. Instructions are intact even when logs are truncated.
- Advance the cursor past it, and persist the gap list for review.
- Apply the same change at all three sites.
- Add a selftest that feeds a truncated transaction through the extracted walk and requires findings to still be reported.

---

### F3. LOW: the signer and retired-key scans and the coverage gate have blind spots

**Constructs:**
- `bank/selftest.mjs` `srcFiles` reads `tests/` with `.endsWith('.ts')` only. `tests/expiry-budget.mjs`, new in round 28, is outside the "exactly two signers", "no file reads a retired key path" and "no searched literal spelled here" scans.
- `scripts/audit-coverage.sh` enumerates `tests/*.mjs` but not `sim/` or `launch/`.
  - `launch/create-cbob-token.mjs` signs.
  - `sim/swap-fork.*` and `sim/test-vault.ts` are gates the SPEC cites.
  - Round 28 brought `launch/` into the rehearsal substitution scope while the gate stayed blind to it.
  - SPEC admits `launch/` is outside the signer scan; it does not say `sim/` or `tests/*.mjs` are.

**Evidence that would exist if right:**
- Add a file containing `fromSecretKey` and `bank/keys/distributor.json` under `tests/x.mjs`. Selftest stays green.
- Delete `sim/swap-fork.sh` from every prompt. `audit-coverage.sh` stays green.

**Fix:** scan `.mjs`/`.ts`/`.sh` in `tests/`, `sim/`, `launch/` and enumerate those directories in the coverage gate.

---

### F4. LOW: RPC calls have no timeout, and limit 25's text reads as if this were fixed

**Constructs:**
- `bank/crank.mjs` and `bank/revenue.mjs` still use `new Connection(rpc, 'confirmed')`, as does the alarm.
- `bank/alarm.mjs` `listVaults` calls `fetch` with no abort.
- Limit 25 says the default connection waited 300.8 s "(the crank's and revenue's at `2b67fb1`)", which reads as past tense. The current tree is unchanged.

**Effect:** one hung socket stalls the reveal lane longer than the ~2-minute capture window, and `flock -n` silently skips the next minutes' runs.

**Evidence that would exist if right:** point the RPC at a socket that accepts and never answers. `node bank/crank.mjs --reveal-only` stays alive for about 300 s.

**Fix:** pass `{ fetch: withAbort(15_000) }` to every `Connection` and to the DAS `fetch`. Otherwise reword limit 25 to say it is unrepaired.

---

### F5. LOW (unmeasured): can a stale Pyth update be written into the sponsored account?

**Construct:** `bank/swap.mjs` `readPyth` verifies owner, derived address, `Full` verification level and feed id. It does not prove that the push-oracle path refuses an older but fully verified update.

**Why it matters:** if anyone can post any Hermes-verified update inside the 180 s window, the adversary picks the least favourable intra-window price. That widens the 150 bps floor by that range.

**Evidence that would exist if right:** on the fork, call the push oracle's update with a Hermes update older than the account's current `publish_time`. If it is accepted and `readPyth` then returns the older price, the claim is confirmed. If refused, close this.

---

### F6. LOW: the swap's venue accounts are not checked for existence before the sweep

**Constructs:**
- `orcaTickArrayStarts` yields three tick arrays, but `swap.mjs` does not check that the two lower ones exist.
- `meteoraBinArrayIndexes` yields three bin arrays with no existence check, unlike the bitmap, which is checked.
- `market()` prices both pools but never simulates a swap, and the sweep is decided on that.

**Effect:**
- If an array is missing, or the operator's cbBTC ATA is frozen, Orca refuses and then Meteora refuses.
- The SOL is already on the operator with an open cycle, needing hand recovery.
- This is loud, not lossy.

**Fix:** read the six arrays in `market()` and drop a venue whose arrays are absent.

---

### F7. INFO items

- **HOLDER-GUIDE Autograph bullet.** It says "Core can no longer empty it" while the same bullet says a full opening passed a simulation. "Empty" presumably means the Autograph. Reword. It also frames the boundary as a hazard to the holder only (see F1).
- **Dormant revenue job.** `bank/revenue.mjs` recovery (`closesCycle`, `splitByOther`, `save(led)`) runs before the `!LIVE` return, so the cron-installed dormant job writes the ledger hourly. This is evidence-based and harmless, but "dry run" is not read-only.
- **Judge key pinning.** `judgeSwapInstructions` pins programs, signers, pool, in/out accounts, amount, floor and direction. It does not pin the Orca and Meteora vaults, tick and bin arrays, oracle or `host_fee_in`. The venue program validates those. `host_fee_in` only redirects the protocol's fee share, not our output.

---

## R0. Round 28's verdict and repairs

I confirmed the round-28 repairs for the following, and found no divergence:
- the chain/wall clock separation;
- the full-problem heartbeat;
- the retained redemption evidence;
- the launch-path rehearsal scope.

The truncation repair is the exception: it creates F2. The Core-size boundary is placed in accepted limit 40 although it is partly a program-side, fixable defect (F1).

## R1. Crank

- I found no plan the program would refuse.
- I found no out-of-order reveal.
- Account orders match MINT's accounts structs for every instruction sent.
- `readySlot`, the reschedule and capture windows, the pre-join/expire/distribute ordering and the owed math all match `credit`, `join`, `reweigh` and `owed_of`.
- Findings are F4 (timeouts) and the F2 sibling `splitsSince` (revenue side).

## R2. Alarm

- All fixed-forever MintConfig, GovConfig, BurnConfig and SealConfig values are watched, as are the pending operator and guardian and the PoB collection plugins and update authority.
- Lock-date checks cover all five programs.
- Gary's production values (21% / 51% / 3 days, 7-day notice, tighten bounds, 30-day month, one-hour window) are asserted in `detectStandingRisks`.
- A one-time `upgrade_authority → IMMUTABLE` drift page at the lock is expected.
- The dangerous state read as quiet is F2: a stranger can silence the entire pass.

## R3. Layouts

- `MintConfig`, `VaultRecord`, `BurnConfig` and `GovConfig` field order and types match the Rust structs.
- The MintConfig size sum matches the scraped space constant.
- The seed assertions are real, so the round-24 D6 gap is closed.
- No defect found.

## R4. Arithmetic

`accrual.mjs` and the crank match the program. The crank expires due boosts before and after a distribution. `boosts_stalled`, `cbob_mint` and the boost bounds are watched.

## R5. Swap and revenue

- **(a)** The oracle formula is `lamports·sol·10^(es−eb) / (btc·10)`, rounded down. The sign handling is correct, as is `satsPerLamport`.
- **(b)** The `PriceUpdateV2` offsets (tag at 40, feed at 41, price at 73, conf at 81, expo at 89, publish time at 93) are correct. Ownership plus the derived address is sufficient only if F5 is closed.
- **(c)** `orcaSpot` and `meteoraSpot` are the right quantities in the right direction. NaN compares false, so the pool is refused.
- **(d)** The threshold is the same `minSats` the deviation filter assumed, and it is in sats.
- **(e)** The judge is complete for value-moving roles (see F7 for the unpinned keys). Both ATA creations, the exact wrap, direction, price limit and a single CU limit are checked.
- **(f)** Account orders match the published IDLs. The only gap is existence (F6).
- **(g)** A pre-existing wSOL ATA is harmless (idempotent create, exact wrap, close back). Native wSOL cannot be frozen. Leftover input returns as SOL.
- **(h)** An unknown outcome always leaves the cycle open and never tries the second venue. A lagging status RPC could mislabel a landed swap as refused, but the second swap would then lack SOL, so the worst case is a loud open cycle.
- **(i)** The worst case is 150 bps plus intra-window oracle range on 10 SOL, four cycles a day (F5). That is a few dollars per cycle, and a sandwich on a ~$10M pool costs more than it takes.

## R6. Gates

- The floors equal their counts.
- The expiry-budget test really executes the instruction on genesis state.
- The mainnet probe floor of 33 matches the assertion count.
- F3 is the blind spot.
- `build-mainnet.sh` proves what it claims for all five programs, with the stated limits on key acceptance and reproducibility.
- `cron-install.sh` arms nothing it should not.

---

## THE FOUR QUESTIONS ON THE ACCEPTED LIMITS

1. **Is any limit worse than stated?** Yes.
   - Limit 40's Core-size boundary is worse (F1).
   - The "reader coverage boundary" paragraph ("requires investigation") omits that a stranger can manufacture the condition for a fee (F2).
2. **Is anything listed as a limit not actually a limit?** Limit 25's timeout text reads as repaired but is not (F4).
3. **Is any DISCHARGED item not discharged?** None.
4. **Is anything in OPEN AND BLOCKING quietly accepted?** The Core-size boundary lives under accepted limit 40 ("not ours") although its owner-forced reveal stall is fixable in our program. It should be OPEN AND BLOCKING until F1 is measured.

---

## GIVEN THAT NO HUMAN FIRM WILL SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Measure F1 exhaustively before the lock.** Fuzz owner-managed plugin shapes and sizes against `reveal_level`, `burn_vault`, `transfer` and the sweep on the pinned Core. Record the failure thresholds. AI review cannot execute these.
2. **Run a long, funded, upgradeable bounty on mainnet** with real value caps for several weeks, then lock. Adversarial humans find liveness lockups like F1 that models read past.
3. **Build the binaries reproducibly** (pinned container, two independent machines, identical sha256), then check them against what is deployed. Today's proof is "same box, same toolchain."
4. **Move the monitoring to a second box and a second operator.** The alarm, ledger, crontab and keys share one uid, so every F2-class blind spot is single-point.
5. **Exercise the real operations with real money.** That means the dress rehearsal (item 22's five named items), the Phantom lock ceremony on throwaway ids, the Squads and guardian key ceremonies, and one forced post-sweep failure recovered by hand.
6. **Settle custody before the lock.** The hot keys (swap operator, $CBOB release wallet, PoB collection authority) need a human decision on cold or multisig custody.
7. **Run an adversarial economic review by a human** on the sale-round cap, the 21% quorum and the oracle floor tolerance.
8. **Bring in an independent reader for Core, Orca, Meteora and Pyth upgrade risk.** The system rests on four third-party programs whose upgrade keys it does not hold.