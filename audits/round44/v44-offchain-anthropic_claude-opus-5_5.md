# Round 44 off-chain audit: independent confirmation pass

## Verdict

Read against the bundled tree, I find **no CRITICAL, HIGH or MEDIUM**. I find **nothing in classes (a) to (d)** of the launch gate:
- nothing in the five programs;
- no path that moves or miscredits value;
- nothing that stops or wrongly refuses a crack;
- no HIGH or MEDIUM anywhere.

What survives are **two LOW findings and five INFO items**, all in the fixable layer. Both LOWs are incomplete applications of round 43's V43o-2 repair, which this round asked me to check "at all sites of its shape."

The off-chain pass is therefore **LAUNCH-CLEAN, with two LOWs to fix and test both ways under gate 5.**

I ran nothing. For each item I name the run that would show it, so it can be checked rather than believed.

---

## R0. Round 43's repairs, re-verified

### V43-1: the crank sends `rescue_nested` every full pass. Holds.

**Planning.** `planRescues` calls `detectNestedVaults` with an `isOnCurve` that always returns true. So only `nested_vault` and `vault_owns_itself` are produced; off-curve owners and `vault_awaiting_return` are never planned. A host is planned only when it reads `live`, `burned`, or is the vault itself.

**Accounts.** The key order in the send block (config, vault, collection, host, new_owner, payer, rescue_authority, core, system) matches MINT's `RescueNested` exactly. Writability matches: `config` is read-only, `vault` is writable, `payer` is a writable signer. `new_owner` is `cfg.bank_treasury`, which MINT also enforces (`WrongRescueDestination`).

**Budget and lanes.** `plan.rescue` is assigned before `budgetPlan`, and `planCostLamports` charges one signature per rescue. The reveal lane sets `rescue = []`.

**Refusals.** `NotNested` is benign. `HostUnresolved` and `WrongRescueDestination` are not. I searched for a state the crank would plan and MINT would refuse with `HostUnresolved` (a host that is a CBOB vault record but fails `require_live_vault`). I found none: every record's asset is in the collection by construction.

### V43o-1: the rehearsal-aware release gate. Holds.

- Outside the rehearsal tree, `release_gate` behaves exactly as C10 did.
- Inside it, the gate requires: a six-pair map; a recorded sha that re-hashes; all four keyed programs patched; every differing program file recorded; and the reverse map recreating `RELEASE_COMMIT`'s bytes.
- A stray marker in the audited tree makes the gate **fail**, because it requires the programs to be patched. So the marker cannot be used to skip the web gate in production.

### V43o-3: the reveal-run arm. Holds.

The reveal loop is extracted and run as written. A removed `break` sends a reveal for `AssetTwo` and turns the arm red.

### V43o-2: an unreadable signature is skipped after 3 passes. Holds in `alarm.mjs`; incomplete at the other two sites.

**In `alarm.mjs` it holds.** `unreadPasses` is this pass's `unreadNow` only, and a readable transaction never resets it. A skip does not increment `unread`, so the cursor and backlog move on.

**At the two other sites the round-43 verdict itself named, it does not hold.** That verdict said: "the same pattern in the poster and revenue walks, which share the reader." See L1 and L2 below.

### Round 43's rejections

I re-derived each claim the verdict rejected and agree with every one:

| Claim | Why it stays rejected |
|---|---|
| C05 (deviation unit mismatch) | `orcaSpot` is in raw sats per lamport, and `meteoraSpot` is the inverse of the lamports-per-sat bin price. Both are in the same unit as `satsPerLamport`. |
| C06 (bitmap dust) | Rejected as filed. The hardening recommendation `bm.owner.equals(METEORA.program)` is still unapplied, and I would apply it. |
| C07 (precision of the BigInt-to-Number conversion) | The double rounding error is negligible. |
| C04 (walk sets on a shrunk pass) | Mechanism accurate, not a defect. The `pdas`, `atas` and `assets` sets are still built from the short list. Gate-5 item 4 is still outstanding. |

---

## Findings

### L1 (LOW): the poster's V43o-2 repair never fires in backlog or gap mode, which is when it matters

**Where:** `bank/redemption-poster.mjs`, `main()` loop.

The walk visits signatures oldest first. Every **readable** transaction executes `if (st.unread) delete st.unread`.

The unreadable branch handles the first two runs like this:
1. It sets `st.unread = {X: n}`.
2. It persists that with `writeLedger`.
3. It throws.

The cursor only advances `if (!gap && !draining)`. So in two cases the next run re-walks the same window from its oldest end:
- while a backlog drains;
- on a run whose walk itself gapped (`st.backlog` is only written at the end, so a throw loses it).

On that re-walk, any readable signature older than X deletes the count before X is reached. X is then always "run 1 of 3", and the poster throws on every run forever. That is the exact wedge V43o-2 was meant to remove.

**Why the test missed it:** the R43 poster arm uses `sigs:[{signature:'X'}]`, a single signature, so there is never an older readable one in the window.

**Evidence that would exist if I am right:** run the extracted poster loop with `st.backlog = {head:'n2', before:'n1'}` and `sigs = [X, A]` (newest first), where X reads as null and A is readable. `st.unread` should read `{X:1}` on runs 1, 2, 3 and onward, and no `rejected:X` row is ever queued. The control, no backlog and A already behind the cursor, reaches the REJECTED row on run 3.

**Cost:** the poster has no sender and is hand-run. Nothing moves value. Class: none of (a) to (d).

**Fix:**
- Delete or reset the count only for the signature that was just read (`delete st.unread?.[s.signature]`), not wholesale.
- Or persist the backlog before throwing.
- Add a two-signature backlog arm and show it red at HEAD.

### L2 (LOW): the revenue job's split-recovery walk has no unreadable-signature handling

**Where:** `bank/revenue.mjs`, `splitsSince`.

`splitsSince` calls `readParsedTransaction`, which throws on any validation failure. Nothing catches that throw, and it propagates out of `main()` at the `recovery` stage.

This path runs only while a cycle has returned cbBTC and is still unsplit. In that state, one permanently malformed answer for any transaction naming the revenue ATA makes every hourly run die. That ATA is named by every paid mint, so the walk is busy. The guard then refuses all further cycles, and royalty SOL accumulates.

The failure is loud: `cbob-revenue:recovery`, then `royalties_unswept`. It can be resolved only by hand.

This is the third site the round-43 verdict named. VALIDATION repaired two.

**Evidence that would exist:** stub `readParsedTransaction` to throw for one signature, and drive the extracted `splitsSince` against a fixture with a returned-unsplit cycle. Every run throws and no split is found. A stub that returns `null` instead is skipped.

**Fix:** apply the same N-pass record-and-skip rule. Because splits are evidence used to close a cycle, a skipped signature should leave the cycle open, never close it, and should be named in the stage failure text.

### I1 (INFO): an undelivered alarm pass records a skip but rolls the cursor back

When delivery fails:
- `next.unreadSkips` keeps the new skip;
- `next.unreadPasses` (which excludes the skipped signature X) is kept;
- `cursors` and `backlogs` are rolled back.

On the next pass, X is re-walked at count 1 and holds the cursor for two more passes. Meanwhile `tx_skipped_unreadable` reports X as skipped. This fails in the loud direction and only adds delay.

**Fix:** roll `unreadSkips` back with the cursors, or carry the skipped count into `unreadPasses`.

### I2 (INFO): SPEC item 59 states the griefer's cost at the test-validator rent rate

Item 59 says the griefer pays "at least the 890,880-lamport rent floor." Fact 9 and the redemption-race paragraph both say mainnet's 0-byte floor is **650,240** lamports. The limit's conclusion is unchanged (the attack still costs more than the victim's fee), but the figure is wrong for mainnet.

### I3 (INFO): rehearsal documentation and notices drift from the code

- **Statuses.** SPEC item 53 and the file's `_comment` list four statuses (MAINNET, PROPOSED, REHEARSAL-OPEN, REHEARSAL-NA). `launch/rehearsal-init.json` uses RULED for most values, and `judgeRehearsal` accepts five.
- **Swap-operator key path.** The file says that key is generated into `.rehearsal-keys/swap-operator.json`. `revenue.mjs` reads `<DEST>/bank/keys/swap-operator.json`. The run fails loudly with ENOENT, so this is a runbook step, not a hazard.
- **Notices.** The crank's and revenue's notices carry no REHEARSAL tag and use the production labels (`cbob-vault-crank:*`, `cbob-revenue:*`). SPEC's "every notice says REHEARSAL" holds for the alarm only. Route these through a rehearsal `ALERT_STATE_DIR` as well.

### I4 (INFO): a cbBTC/BTC basis above 1% halts every sweep

The floor is derived from **BTC/USD**. If cbBTC trades more than 100 bps away from BTC in either direction, both pools fail the deviation gate before any SOL moves. The revenue job then pages every hour at `market` until the basis closes.

Nothing is lost, but limit 10 does not state this cause. Add one sentence to limit 10.

### I5 (INFO): Core's new fixed fees are not mentioned to holders

The re-pinned Core charges fixed fees, and every page shape pays them:

| Operation | Core fee |
|---|---|
| CreateV2 (mint, charter claim) | 1,500,000 lamports |
| ExecuteV1 (each, including the redemption's sweep and the C5 transfer) | 48,720 lamports |

HOLDER-GUIDE.md and SPEC do not mention either. No promise is broken (SPEC's "free" means no price paid to the Bank), but a holder-facing note is warranted.

The crank is unaffected, provided Core charges nothing on `UpdatePluginV1` or `TransferV1`. That is unmeasured. Confirm it from one landed rehearsal reveal and one landed rescue.

---

## web/test: can each test fail when its property breaks?

- **The two V43o-2 arms are the gap.** The alarm arm is sound. The poster arm cannot fail in the backlog case (L1).
- **Known class, already recorded.** `meta.test`'s "every vault keeps its previous file" compares one file (round 43 C23). The presence-only page regexes are the round 40 C03 class.
- **Sound, and they fail correctly:**
  - the V40-1 mock-RPC dust arms, with real readers on both sides;
  - the C03 byte-for-byte bundle-versus-node arms;
  - the C12 ordering arm, which correctly fails when the anchor is absent;
  - the L4 dist-provenance mutations.

---

## R1 to R6: what I checked and found sound

**Crank: `planCrank` against MINT.**
- Order: preJoins, then preExpires, then split, then distribute, then postExpires.
- Every `claim` runs `monthly_inline` first. That run waits while joins are pending or boosts are due, so the explicit `distribute` is never pre-empted by our own batches.
- The `preExpired` owed formula equals `expire_boost` followed by credit.
- `retiringOwed` equals `retire`'s `owed_of`.
- `splitToPool` uses the same flooring as `split_revenue`.

**Accrual.** `credit`, `pendingScaled`, `reweigh` and `ceilSats` match the Rust formulas line for line.

**Swap.**
- Pyth offsets: level at 40, feed at 41, price at 73, conf at 81, expo at 89, publish_time at 93.
- The exponent algebra is correct and rounds down.
- Orca data layout: amount at 8, threshold at 16, price limit at 24, input flag at 40, `a_to_b` at 41.
- Tick arrays: the current array, then the two below. Meteora bin arrays: the active one, then the two above.
- The judge pins all seven instructions.
- `classifySendFailure` never treats an unconfirmed send as a refusal, so no second venue is tried and nothing is double-counted.

**Layout.** The SEEDS gate exists, so round 24's D6 is closed.

**Gates and build.** The floors require equality with the counts. `build-mainnet.sh` covers all five programs and proves the sweep helper's bytes identical to the tested ones. The cron installer refuses a rehearsal tree.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?** Two are:
   - The **"Reader coverage boundary"** says "the poster does the same: two runs stop … the third queues" the signature. That is false whenever a backlog or gap exists (L1).
   - The **revenue recovery walk** has no skip at all (L2).
   - Smaller: limit 10 omits the cbBTC basis halt (I4), and item 59's cost figure is overstated (I2).
2. **Is anything listed as a limit already closed?** None found.
3. **Is any discharged item not actually discharged?** None found.
4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52 and 53 are all still listed as open.
   - Item 53's re-run is now *possible*, but it has not been *done*.
   - Item 22.5, the single DAS read of a burned asset, is still unmeasured, and a "no" answer edits `bank/`.

---

## What this project should do before launch that an AI audit structurally cannot

1. **Run the dress rehearsal and archive every signature** for item 22.1 to 22.5. That includes a forced Orca refusal, so Meteora really runs, and the hand recovery of a failed post-sweep cycle. Have Gary, not the box, read the `--audit` output.
2. **Inject faults deliberately** during the rehearsal:
   - one permanently malformed RPC answer, served through a proxy, to the alarm, the poster *and* the revenue walk;
   - an RPC socket that accepts and never answers;
   - a full disk under `bank/`;
   - a killed router.
   
   Confirm that each one pages and that each one recovers.
3. **Rebuild independently from source.** Have someone other than this box rebuild from `RELEASE_COMMIT` on a clean machine, match `dist/SHA256SUMS`, and dump the deployed bytes at steps 9, 10 and 11. Only reproducibility bridges "the source names Gary's key" to "the binary trusts it."
4. **Hold an out-of-band custody ceremony** for the deploy-authority key, the swap-operator key and the $CBOB release wallet. This means checking the backup restore itself, not the include list. Keep a written record of who can reach each key.
5. **Have a human read each held-out signature.** That covers `unreadSkips`, `logGaps` and the REJECTED poster rows during the rehearsal. Time how long it takes, because launch will depend on that person existing.
6. **Measure, on a live landed transaction, the Core fees for the new pin** (create, execute, transfer, update), and put the result in HOLDER-GUIDE.md.