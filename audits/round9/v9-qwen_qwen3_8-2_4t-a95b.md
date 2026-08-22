

FINDINGS

1. HIGH — MINT bank rotation is neither watched nor safely isolated  
`bank/alarm.mjs` `readConfigs()` never reads `mint.pending_bank` / `mint.pending_bank_at`. The MintConfig layout puts them at offsets 409 and 441, after `pending_admin_at`. `bank/detectors.mjs` `detectStandingRisks()` and `detectConfigDrift()` both watch `mint.pending_bank`, but the key is never populated, so an armed MINT bank rotation produces no CRITICAL.  
Worse, `programs/cbob-vault-mint/src/lib.rs` `apply_pending_admin()` clears `pending_bank` and `pending_bank_at`:

```rust
c.pending_bank = Pubkey::default();
c.pending_bank_at = 0;
```

Exploit: admin arms `update_wiring(bank = X)`. No alarm fires during the notice period. If an admin rotation is also armed, anyone can wait until the timelock and call `apply_pending_admin`; the bank rotation is silently cancelled, with no `BankRotationCancelled` event and no pending-bank drift because the alarm never reads the field.  
Fix: read `pending_bank`/`pending_bank_at` in `readConfigs()`; remove the bank-clearing from `apply_pending_admin()`; emit an explicit event if a bank rotation is ever cancelled.

2. HIGH — returned-but-unsplit revenue cycles are not alarmed  
`bank/detectors.mjs` `cycleIsOpen()` correctly says a cycle is open until `splitSig` exists. But `detectUnreconciledRevenue()` only alarms when `returnedSats == 0` or when the return is short versus quote. If `returnedSats > 0`, within tolerance, and `splitSig` is absent, it is quiet. `detectSplitClaims()` also skips cycles with no `splitSig`.  
Exploit: sweep → swap → return succeeds, then `split_revenue` fails or is maliciously omitted. cbBTC sits in the revenue ATA, holders are unpaid, and the alarm can remain quiet. `revenue.mjs` may block the next cycle, but the alarm is supposed to be independent of the process holding the key.  
Fix: in `detectUnreconciledRevenue()`, if `cycleIsOpen(c)`, age >= grace, `returnedSats > 0`, and `!splitSig`, emit CRITICAL “returned but not split”.

3. MEDIUM — `detectDistribution()` false-CRITICALs deliberately skipped rows  
`bank/detectors.mjs`:

```js
const unresolved = rows.filter(([, r]) => !r.sig)
```

`bank/distribute.mjs` writes `{ sig: null, skipped: ... }` for a vault burned after the plan is fixed. Those rows are intentionally not payments, but the detector reports them forever as `distribution_unresolved` CRITICAL.  
Fix: exclude `r.skipped` from unresolved, and report failed/ambiguous separately from skipped.

4. MEDIUM — `seenSplits` cap makes old closed cycles false-CRITICAL forever  
`bank/alarm.mjs` stores only the last 200 split signatures:

```js
seenSplits: [...].slice(-200)
```

but `detectSplitClaims()` checks every cycle in the revenue ledger, which is never pruned. After 200 successful splits, old cycles’ `splitSig`s are evicted and the alarm will report `split_not_on_chain` for historical, reconciled cycles on every pass.  
Fix: check only cycles still within a reconciliation window, persist all split signatures, or mark cycles reconciled once seen.

5. MEDIUM — `alarm.mjs --dry-run` advances state and can suppress real alerts  
`report()` returns `delivered = true` when `DRY` is set, and `main()` then calls `writeState(next)`. A dry run therefore advances cursors and baselines without notifying. If an operator runs `--dry-run` during an incident, the next real pass may not re-report the same transaction findings.  
Fix: in dry-run mode, do not write state, or force `delivered = false` and keep all prior baselines/cursors.

6. MEDIUM — Jupiter transaction validation is bypassable via address table lookups  
`bank/revenue.mjs` checks forbidden programs only in `msg.staticAccountKeys`:

```js
const keys = msg.staticAccountKeys.map(...)
const bad = keys.filter(k => FORBIDDEN.includes(k))
```

It counts `msg.addressTableLookups` but never resolves them. A v0 transaction can hide the MINT program, BPF loader, or value-moving programs behind an ALT. It also does not restrict `SystemProgram` transfers from the operator. A compromised or MITM’d Jupiter response could therefore get a signature on a transaction that does more than swap.  
Fix: resolve all ALTs before signing and reject unknown/non-swap programs and direct value transfers, or use a strict allowlist of Jupiter route programs.

7. LOW — `detectSplitClaims()` does not implement its own claimed reverse check  
The comment says it detects “a split on chain that no cycle claims”, but the code only checks ledger cycles claiming unseen splits. An on-chain `split_revenue` with no ledger row is not reported.  
Fix: implement the reverse check or remove the claim.

8. LOW — money scripts read MintConfig by raw offsets without discriminator/version  
`bank/revenue.mjs` and `bank/distribute.mjs` read fields at fixed offsets but do not verify `MINT_CONFIG_DISC` or `version`. The alarm watches `mint.version`, but the scripts themselves could misread after a layout-changing upgrade.  
Fix: use one shared pinned reader that rejects unknown discriminator/version.

WHAT I TRIED AND COULD NOT BREAK

- GOV double-vote: VoteRecord PDA is seeded by proposal + asset; transfer after voting does not re-enable the asset. Delegates and collection authorities cannot satisfy the owner-byte + owner-signer check. Burned assets cannot be produced as live Core AssetV1 accounts.
- GOV execute: cannot run twice, after expiry, before voting close, or out of order (`last_executed_id` monotonic). Quorum uses `max(snapshot, live)` with ceiling division and non-zero need. CPI into MINT cannot exceed `max_supply`; `set_round` bounds window and cap.
- MINT revenue split: destinations are derived from config, not caller args; token program is pinned classic SPL; bank share is floored and holders get remainder; zero amounts skip; u128 prevents intermediate overflow.
- MINT sweep: destination is config-pinned and signer; amount > 0, cap, cooldown, and reserve are enforced on-chain; reserve cannot be set between zero and rent exemption.
- SEAL open/close pairing: open requires a later close for same asset and owner; close requires a prior open; reserve ATAs are checked for delegate/close authority and exact 165-byte classic layout.
- Distribution double-pay: lock, intent-before-send, ambiguous rows not retried, fixed daily plan, exact unique DAS count against `minted_total`, and burned-mid-run skip prevent straightforward double payment.

THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Make the alarm enforce split-finality: any revenue cycle with SOL swept and cbBTC returned but no observed `splitSig` must be CRITICAL. Unsplit cbBTC is customer money that the current watcher can silently ignore.