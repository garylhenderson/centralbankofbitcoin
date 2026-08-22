# ROUND 9 — FINDINGS

## F1 — HIGH — `alarm.mjs`: the `seenSplits` retention keeps the OLDEST 200 signatures and evicts the NEWEST

**Construct:** end of `main()`:
```js
next.seenSplits = [...new Set([...seenSplits, ...(prev?.seenSplits || [])])].slice(-200)
```
The current pass's signatures are *prepended* (the scan iterates `getSignaturesForAddress` output newest-first), so once the combined list exceeds 200, `slice(-200)` keeps the tail — the oldest batches — and **drops the splits found this pass**.

**Failure (no attacker needed):** the revenue cron runs 6-hourly, so completed cycles accumulate at up to 4/day; the 201st split (~day 50 of operation) is the first evicted. `detectSplitClaims` checks *every* ledger cycle carrying a `splitSig` against the seen list, with only a *minimum*-age grace. From the pass after eviction, that cycle fires `split_not_on_chain` — **CRITICAL, false, and permanent**: the signature can never re-enter `seen` (the cursor has advanced past it forever). Each later completed cycle adds another one; each fires on *every* pass; every pass with any CRITICAL sends the SMS. Within weeks the report is hundreds of CRITICAL lines per pass and the alert channel is an every-30-minutes SMS storm. A real `unledgered_sweep` or `approve` is indistinguishable in the noise. This is the round-6 `detectBurns` wolf-crying lesson at scale, and it is invisible to the selftest because the selftest never builds state through the retention line.

**Falsifiable test:** seed a ledger with 201 `splitSig`-carrying cycles, run two passes through the real retention code, assert the *newest* cycle fires `split_not_on_chain` on pass two.

**Fix:** append current after previous before slicing (`[...prev, ...current].slice(-200)`), *and* bound the check by age — a cycle older than the retention horizon cannot be verified, so don't check it. Better: mark the cycle verified in the ledger when its split is first seen and stop re-checking.

## F2 — HIGH — `readConfigs` never reads `mint.pending_bank`; the armed-rotation watch for MINT's Bank is dead

**Construct:** `alarm.mjs` `readConfigs()`, the `g('mint', …)` field list ends at `pending_admin_at` (401) and never reads offset **409** (`pending_bank`) or 417 (`pending_bank_at`). Yet `detectConfigDrift`'s watch list carries `['mint.pending_bank', 'CRITICAL', 'A BANK ROTATION IS ARMED']` and `detectStandingRisks`' rotation loop checks it. `cur['mint.pending_bank']` is always `undefined`: the standing check `if (v && v !== DEFAULT_PUBKEY)` never fires, and the drift comparison is `undefined → undefined`, forever quiet.

**Exploit:** the MINT admin key (or a Squads compromise) calls `update_wiring(bank = attacker)`. The rotation waits out `governance_timelock_secs` — days, per the alarm's own (populated) assertion. During that entire window the alarm — the compensating control the timelock design rests on ("EVERY ARMED ROTATION … CRITICAL on its face every pass") — says nothing. After the notice, anyone calls the permissionless `apply_pending_bank`; `mint.bank` drift is then caught within 30 minutes, but the co-signer on every mint is already the attacker's, and the cancel window passed in silence.

**Evidence shape:** verifiable in source (the field list) and on a validator (arm a `pending_bank` rotation, run one pass, observe no `rotation_armed`). The selftest passes because it injects `{'mint.pending_bank': OTHER}` directly into `detectStandingRisks` — the detector proven in both directions while its *wiring* is untested. This is exactly the round-8 `detectIndexShortfall` class and the round-6 `collection.hash` class ("a watch on a key no one populates"). Round 8's changelog claims "every pending-rotation slot are watched" — false for this one.

**Fix:** add `['pending_bank',409,'pk']` (and `['pending_bank_at',417,'i64']`) to the mint field list.

## F3 — MEDIUM — a cycle that returned cbBTC but never split raises NO alarm finding

**Construct:** `detectors.mjs` `detectUnreconciledRevenue` — for a cycle where `cycleIsOpen(c)` is true (no `splitSig`), the only checks are `returned === 0` and returned-vs-quoted. A cycle with `returnedSats` within tolerance and no `splitSig` produces **zero findings**. `detectSplitClaims` only fires when a split is *claimed* and unseen. So the state the project's own predicate calls "money the holders have not been paid" — cbBTC sitting unsplit in the revenue ATA — is silent in the alarm.

**Sequence:** the split step fails once (ATA creation reverted, transient error). The row keeps `returnedSats`, no `splitSig`. The alarm is quiet *forever*. The only signal is `revenue.mjs`'s own open-cycle guard throwing on the next 6-hourly run — which notifies only under `--live`, and which makes the actor the sole watcher of its own failure: the exact shape round 7 removed from the sweep side.

**Fix:** emit a finding for any cycle that `cycleIsOpen()` beyond grace regardless of return state (`cycle_unsplit`, HIGH).

## F4 — LOW — a day the distributor legitimately skips reads as an unfinished run

**Construct:** `distribute.mjs` writes `st.days[day] = { paid: {}, startedAt }` before anything else; the skip path (`if (plan.skip) { save(st); return }`) never sets `finishedAt`. `detectDistribution` flags `startedAt && !finishedAt && day !== today` as `distribution_unfinished` HIGH. Every day with no cbBTC, no activated vaults, or dust — routine early, plausible later — is a false HIGH the next day, in the one channel that must stay credible.

**Fix:** record a terminal marker plus skip reason on the skip path.

## F5 — LOW — a fully legitimate swap can fail the delta floor

**Construct:** `revenue.mjs` enforces `delta >= minOut` where `minOut = q1 × 0.98`, but the swap's actual guarantee is `out ≥ q2 × 0.99` and the requote check only bounds `q2 ≥ q1 × 0.98`. At max drift and max slippage a legitimate execution delivers `0.9702 × q1` — below the floor — so the script throws with the SOL already swapped: an open cycle, a false `unreconciled_swap` CRITICAL, and a manual return. Funds are safe on the operator ATA; the defect is a false CRITICAL plus toil precisely in volatile markets. **Fix:** floor the delta at `q2 × (1 − slippage)`, the guarantee the swap actually gives.

## F6 — LOW — one persistently unfetchable transaction permanently stalls that program's scan cursor

`if (!gap && !unread && sigs.length) cursors[id] = sigs[0].signature` — a single tx the RPC will never return `getParsedTransaction` for keeps `unread > 0` every pass; the cursor never advances, the window grows until it also trips `scan_gap`, and the scan is wedged with two HIGHs per pass forever. Loud (the stated philosophy) but never heals. **Fix:** after N consecutive failures, advance past it onto a permanent "never examined" list reported once.

## F7 — LOW — the assertion floor (160) exceeds the stated suite size (82)

If the suite genuinely makes 82 assertions, `run-tests.sh` cannot go green at `MIN_ASSERTIONS=160` — meaning the documented "repeatable green baseline" is not actually runnable, and the pressure is to edit the script. If the suite has grown past 160, the prompt's number is stale and this is void. One line to reconcile.

---

# WHAT I TRIED AND COULD NOT BREAK

- **`split_revenue` destination pinning:** all four accounts are derivation-checked against config-pinned wallets; the mint is free by measured/rejected design with the token program pinned and `TransferChecked` validating mint/decimals; rounding floors the Bank, the two transfers sum exactly (u128 intermediate, `total>0` required); a delegate on the source is unreachable — only the revenue PDA could approve one and no instruction does.
- **`sweep_sol_for_swap`:** destination is both a required signer and config-pinned; cap and cooldown are on-chain; the rent-wedge reserve band is refused; two sweeps in one tx share a timestamp and the ≥1s cooldown closes it.
- **GOV double-voting:** VoteRecord is keyed by asset, so transfer-then-revote hits an existing account; a burned vault's account is closed and fails the owner check; nested/collection owners still require a signature equal to the owner bytes and cannot inflate votes; votes after close/execute are refused; quorum uses `max(snapshot, live)` with ceiling division, never zero; execution is once, monotonic, expiring, and refuses dead rounds. The worst CPI outcome is a bounded round — `cap > 0`, window ≤ 1 year, lifetime `max_supply` enforced in `mint_vault`, and every mint still needs the Bank's co-signature.
- **`set_collection_royalties` encoding:** matches Core's borsh layout (u16 bps LE, u32 creators length, 32+1 creator, u8 RuleSet, `Option` tag only on Add); both opcodes were exercised against real Core in round 6; rate capped at 1000 with the revenue PDA as sole creator — no redirect exists.
- **`distribute.mjs` double-payment:** intent-before-send, tri-state `paymentState`, exclusive lock, plan fixed once per day, unique-id count must equal `minted_total` exactly, burned-mid-run skip, one frozen ATA fails one vault rather than the day.
- **Offsets:** I re-derived all four config layouts byte-by-byte against the structs. Every offset the alarm reads is correct — the one gap is the key it never reads (F2).
- `lock.mjs` was not in the provided set; its behavior is known only via the selftest.

---

# THE SINGLE THING

**Fix F1 before this holds real money.** It is not an edge case an attacker triggers — it is the alarm's guaranteed self-destruction after roughly fifty days of *normal* operation, converting the only watcher over the trusted hop, the burn blind spot and the approve blind spot into a permanent every-30-minute CRITICAL storm. Every real alert this system will ever need to deliver arrives through a channel F1 renders unusable, and it does so on a delay long enough to survive every test run you have. F2 is a one-line fix and should land in the same commit.