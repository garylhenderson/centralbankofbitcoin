FINDINGS

1. CRITICAL — `bank/alarm.mjs` / `bank/detectors.mjs`: the return/split AMOUNT is still taken from the operator’s ledger, so the trusted hop can steal the whole sweep and silence the alarm.

`detectUnreconciledRevenue()` trusts `c.returnedSats`; `detectSplitClaims()` only checks that `c.splitSig` was seen on the MINT program and explicitly says it is blind to the amount. The sweep amount is decoded from instruction data, but the return is not.

Concrete exploit:
1. Operator (or anyone holding `swap-operator.json`) calls `sweep_sol_for_swap` for 50 SOL.
2. They return 1 sat of cbBTC to the revenue ATA.
3. They call permissionless `split_revenue`; it splits 1 sat and produces a real `splitSig`.
4. They write a ledger row with the real `sweepSig`, correct `sweptLamports`, a plausible `quotedSats`, `returnedSats` equal to the quote, and the real `splitSig`.

Result: `detectUnledgeredSweeps` passes because the sweep amount matches; `detectSplitClaims` passes because the split signature exists; `detectUnreconciledRevenue` passes because `returnedSats` is within tolerance of `quotedSats`. The holders are unpaid, and the watcher reports calm.

Fix: verify the return/split amount on-chain. Parse the Anchor `RevenueSplit` event (`total`, `holders`, `bank`) from the split transaction logs, or scan the operator/revenue token accounts and decode the actual `TransferChecked` return amount. Require ledger `returnedSats` to equal the on-chain amount within tolerance, and require the split `total` to match the returned amount. Do not let a cycle close on `splitSig` alone.

2. HIGH — `bank/revenue.mjs`: the “look at it before signing it” check on the Jupiter transaction is bypassable and still permits value-draining instructions.

The validator checks only:
- exactly one required signer;
- `FORBIDDEN` programs among `msg.staticAccountKeys`;
- at most four address-table lookups.

It never resolves address-table lookups and never inspects instructions. A v0 transaction can load `MINT_PROG` or any other program via an ALT and evade the static blacklist. Even without ALTs, `SystemProgram` and `Tokenkeg...` are not forbidden, so a malicious/tampered Jupiter response can include a direct SOL transfer or token transfer from the operator, who signs the whole transaction.

Concrete exploit: MITM or compromised quote API returns a swap transaction containing `SystemProgram.transfer(operator, attacker, swept_SOL)` plus optional real swap. `revenue.mjs` signs it because the static check passes. The SOL is gone before the post-swap delta check fails.

Fix: resolve every ALT and build the full account list; reject any transaction whose resolved programs/instructions are not on a swap allowlist; at minimum detect and reject direct transfers out of the operator’s wallet or operator ATA, and reject use of `MINT_PROG` whether static or loaded. If Jupiter routes require ALTs, resolve them; do not cap their count as a substitute.

3. HIGH — `bank/detectors.mjs`: the round-9 “every watched key is produced” assertion is incomplete; several keys used by watchers are not asserted.

`missingWatchedKeys()` asserts only `WATCHED_KEYS`. But:
- `detectStandingRisks()` references `gov.pending_admin`; `WATCHED_KEYS` contains `gov.pending_admin_at` but not `gov.pending_admin`.
- `detectStandingRisks()` cross-checks `seal.collection`, `mint.collection`, `burn.collection`, `gov.collection`; none are in `WATCHED_KEYS`.
- `missingWatchedKeys()` deliberately returns false for all `prog.*` and `collection.hash`, so those WATCH entries are never asserted either.

Concrete failure: a future edit or reader regression drops `gov.pending_admin`. The standing loop sees `undefined`, no `rotation_armed` CRITICAL fires, and `missingWatchedKeys` does not throw. An armed GOV admin rotation becomes invisible. Same for collection cross-checks or program-byte watches.

Fix: make `WATCHED_KEYS` the mechanical union of every key referenced by `WATCH`, `detectStandingRisks`, and the program/collection watches. Remove the `prog`/`collection` exemption or add explicit produced-key assertions for them. Add a selftest that deletes each watched key one at a time and expects failure.

4. HIGH — `bank/detectors.mjs` `detectStandingRisks()`: no operational ceiling on `mint.max_sweep_lamports`.

The program accepts any non-zero `max_sweep_lamports`. The standing check only alarms if it is `0` or if cooldown is too short. If the deployed config is initialized or rotated to e.g. 10,000 SOL, the alarm baselines it and says nothing. `bank/revenue.mjs` will still sweep at most 50 SOL, but a compromised operator key can call `sweep_sol_for_swap` directly for the full on-chain cap.

Concrete exploit: admin/misconfig sets `max_sweep_lamports = 10_000 SOL`, cooldown 1 hour. Operator key leaks. Attacker sweeps 10,000 SOL per cooldown. Alarm only reports drift if the value changes after baseline; if baseline is wrong, no finding.

Fix: add a standing CRITICAL when `mint.max_sweep_lamports` exceeds an explicit operational ceiling (default 50 SOL, configurable out-of-band). `revenue.mjs` should also refuse to run when `chainCap > MAX_PER_CYCLE_LAMPORTS` instead of silently taking the min.

5. MEDIUM — `scripts/build-mainnet.sh`: the Squads-key source check can be satisfied by a comment.

The check is:
```bash
grep -A1 -E '^#\[cfg\(not\(feature = "localnet"\)\)\]' "$f/src/lib.rs" | grep -q "$SQUADS"
```
This passes if the next line merely contains the Squads address in a comment. A wrong constant such as:
```rust
#[cfg(not(feature = "localnet"))]
pub const INIT_AUTHORITY: Pubkey = pubkey!("WRONG..."); // bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1
```
passes the grep. The behavioral test still only proves rejection of the localnet key, not acceptance of Squads.

Fix: anchor the check to the exact declaration, e.g.
```bash
grep -A1 ... | grep -Eq 'pub const INIT_AUTHORITY: Pubkey = pubkey!\("bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1"\);'
```
and keep the existing “not proven compiled constant” disclaimer.

6. MEDIUM — `bank/revenue.mjs`: quote `outAmount` truthiness still permits a zero-quote string.

Both quote checks use:
```js
if (!q?.outAmount) throw ...
```
Jupiter integer amounts are strings. `"0"` is truthy. A response with `outAmount: "0"` passes, making `minOut = 0n`. The script can sweep SOL, receive nothing, record an open cycle, and strand SOL on the operator.

Fix: require `BigInt(q.outAmount) > 0n` and `BigInt(q2.outAmount) > 0n` before sweeping and swapping.

7. LOW — `bank/revenue.mjs` `audit()`: rejected intents are counted as swept SOL.

`swept` sums `c.sweptLamports || c.intendedLamports`. A cycle with `sendRejected: true` moved nothing, but its `intendedLamports` inflates the “SOL swept out” total. Fix: count only confirmed `sweptLamports`, or exclude `sendRejected` rows.

TRIED AND COULD NOT BREAK

- GOV double-vote via transfer, delegate, collection authority, burned asset, or VoteRecord re-init: the VoteRecord PDA `[vote, proposal, asset]` plus live owner-byte read blocks these within the program’s model.
- GOV execute replay, stale execute, post-cancel execute, superseded proposals: `executed`, execution window, `last_executed_id`, and `RoundAlreadyOver` hold as written.
- GOV quorum snapshot direction: `max(snapshot, live)` makes new mints raise the bar; I could not make minting lower the bar. Minting during voting remains economically useful below 100% quorum, but that is gated by the Bank co-signature and is stated as design.
- MINT `split_revenue` destination pinning: caller cannot substitute ATAs; token program is pinned classic SPL; rounding gives the remainder to holders.
- MINT `sweep_sol_for_swap` reserve/cooldown: cannot sweep below reserve, cannot bypass cooldown with multiple sweeps in one tx when cooldown ≥ 1.
- SEAL open/close pairing and reserve delegate/close-authority checks: I could not construct a top-level redemption that reseals with a delegate/close authority on a canonical reserve ATA.
- BURN declared-account checks: reserve ATAs and non-reserve PDA token accounts are checked for owner, delegate, delegated amount, close authority, extensions, and zero balance, subject to the declared-account completeness gap that the alarm/reconcile owns.
- `distribute.mjs` crash/concurrency double-pay: intent-before-send, ambiguous state, rejected-vs-timeout distinction, and lock usage prevent automatic double-pay in the modeled cases. `lock.mjs` was not supplied, so the lock implementation itself was not verified.
- Config offset reads in `alarm.mjs` match the declared layouts for the current version byte. I did not find a live offset misread.

THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Make the alarm verify the cbBTC return and split AMOUNTS on-chain; until then the operator can sweep SOL, return dust, split dust, write a truthful-looking ledger row with a real split signature, and the only watcher over the trusted hop will report no finding.