## Findings

### HIGH — `splitByOther` can be “proven” by an unrelated split, including one that occurred before the cycle existed

**Files / identifiers:**  
- `bank/detectors.mjs`, `detectSplitClaims()`  
- `bank/alarm.mjs`, `seenSplits` persistence and call to `detectSplitClaims()`  
- `bank/revenue.mjs`, `cycle.splitByOther = true`

The round-11 repair establishes only a **cardinality condition**:

```js
const unclaimed = [...seen].filter(sig => !claimed.has(sig)).length
if (unclaimed < inWindow.length) finding
```

It does not bind an unclaimed on-chain split to:

- the particular revenue cycle;
- the cycle’s `returnSig`, `returnedAt`, or `startedAt`;
- the amount returned;
- the revenue ATA balance before or after that split;
- temporal ordering at all.

Worse, `seenSplits` is persisted indefinitely:

```js
seenSplits: [...new Set([...seenSplits, ...(prev?.seenSplits || [])])]
```

but contains only signatures, not block times. Thus an unclaimed successful `split_revenue` from any prior pass can anchor a later `splitByOther` row forever. A split observed *after* a false cycle can also satisfy it on a later alarm pass.

**Concrete exploit / failure sequence**

1. A caller deposits a trivial amount of cbBTC into the revenue ATA and calls permissionless `split_revenue`.
   - This is a successful, genuine MINT split.
   - It is not associated with a revenue-ledger cycle, so its signature is retained as an unclaimed entry in `seenSplits`.
2. Later, the swap operator or host process performs a sweep, but does not deliver or split the corresponding cbBTC.
3. Because the off-chain revenue ledger is explicitly treated as untrusted testimony elsewhere, the compromised process writes a cycle with:
   ```json
   { "returnedSats": "...", "splitByOther": true }
   ```
   rather than a `splitSig`.
4. `cycleIsOpen()` treats that row as closed.
5. `detectSplitClaims()` sees one unclaimed split anywhere in its historical signature set and one `splitByOther` row, so it reports nothing.
6. The cbBTC for the later cycle can remain unsplit or never have been returned, while the ledger-backed watcher accepts the cycle as closed.

The existing self-test encodes the flaw as a passing case:

```js
D.detectSplitClaims(['orphanSig'],
  { cycles: [{ startedAt: '...', splitByOther: true }] }, later)
```

It asserts that any unclaimed signature is sufficient, without establishing that `orphanSig` happened after the cycle’s return or involved that cycle’s funds.

**Why the empty-ATA check does not repair this watcher flaw**

`revenue.mjs`’s immediate `isProvablyEmpty(revAta)` check is reasonable for distinguishing a genuine front-run from an absent ATA when the honest process itself receives `NothingToSplit`. But the alarm is meant to independently challenge the ledger, including a ledger produced by the process holding the trusted swap key. The alarm must not accept an arbitrary ledger `splitByOther: true` based on unrelated historical chain activity.

**Fix**

Replace boolean `splitByOther` with a chain-bound resolution record, for example:

```json
{
  "splitByOtherSig": "...",
  "splitByOtherAt": "...",
  "resolvedBy": "..."
}
```

Then require the watcher to verify, at minimum:

1. `splitByOtherSig` is a successful MINT `split_revenue` transaction;
2. it is unique across all cycles;
3. its block time is after this cycle’s confirmed return and before resolution;
4. it is observed in the relevant scan window, not an unbounded historical set.

Better: resolve the front-run at the time it happens by scanning MINT/revenue-address activity after `returnSig`, recording the actual split signature. Do not use an anonymous count of splits as evidence for a specific cycle.

Add negative tests proving rejection when the only unclaimed split is:
- before `returnedAt`;
- after the alleged `splitByOther` resolution;
- associated with another cycle;
- retained from a prior scan outside the allowed temporal window.

## What I tried and could not break

- **`bank/spl.mjs`:** The absent/foreign/malformed/ok distinction is carried correctly at the shown callers. Distribution treats poisoned vault ATAs as per-vault faults; distributor and operator accounts use `requireTokenAmount`; `isProvablyEmpty` does not accept absent accounts. I did not find a caller that still reads a malformed token account as zero.
- **`bank/sigwalk.mjs`:** The paging loop uses per-address cursors, preserves the sentinel semantics, returns a gap at `maxPages`, and its live-mainnet probe imports the same helper rather than a copy.
- **`bank/lock.mjs`:** The stale-break path now uses unlink plus `wx`, and token ownership prevents the old unconditional-release defect. `_afterUnlink` is only injectable through an explicit in-process options object; shown production callers pass fixed options and do not expose it to CLI or environment input. PID reuse after reboot can still create a loud availability failure rather than unsafe lock theft, which is the safer outcome for payment jobs.
- **On-chain revenue split:** I did not find a caller-controlled destination bypass. The revenue, holders, and Bank ATAs are derived from the config addresses and mint, while the classic token program is pinned.

## THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Fix the `splitByOther` attribution model. A watcher that accepts an untrusted cycle as closed because *some unrelated split happened at some time* can be made to certify an unsplit or missing return precisely where the off-chain trusted hop needs independent reconciliation.