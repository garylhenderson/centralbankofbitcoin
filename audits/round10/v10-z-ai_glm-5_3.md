# ROUND 10 — FINDINGS

## F1 — HIGH (must be measured before mainnet; CRITICAL if the measurement goes the wrong way)

**The Token-2022 ATA derivation in the reserve loops is an untested assumption that can permanently seal every vault.**

SEAL `inspect_reserves` (and BURN's reserve loop) derive the ATA for **both** token programs for every reserve mint and refuse any existing account whose length ≠ 165 (`ReserveHasExtensions`). All reserve mints are classic SPL by `assert_classic_spl`, so the Token-2022 derivation `[pda, TOKEN_2022, reserve_mint]` can never catch value — real cbBTC lives in classic accounts. It can only ever produce a **refusal**. Its safety rests on one unstated assumption: that nobody can create a Token-2022 ATA for a classic-owned mint.

The ATA program derives that address and CPIs `initialize_account` to Token-2022 with the classic mint. Whether that CPI fails depends on Token-2022's mint-owner check — which nothing in this repo tests and the suite cannot have covered (it would require deliberately creating the mismatched account). The code's own comment says this branch "can only fire on something malformed." That is an assumption, not a measurement.

**If it is creatable:** anyone pays one ATA rent (~0.002 SOL), creates `[vault_pda, TOKEN_2022, cbBTC]` — the ATA program always adds ImmutableOwner to T22 accounts, so length is 170 (the project's own measured number) — and `close_redemption` reverts `ReserveHasExtensions` forever. `open_for_redemption` demands a terminal close, so the vault can never be unsealed; `burn_vault` refuses identically. Customer BTC permanently unreachable, no signature from anyone, cost two thousandths of a SOL, repeatable against all 2,100 vaults.

**Fix:** (a) measure it — one validator test: `createAssociatedTokenAccount(payer, vaultPda, cbBTC, TOKEN_2022_PROGRAM_ID)`. I believe Token-2022 rejects foreign-owned mints (`InvalidOwner`), but belief is not a gate. (b) Regardless of the answer, **delete the Token-2022 iteration from the reserve loops**: with a classic-only reserve list it is dead code at best and a permanent-seal grief at worst. Keep T22 enumeration in the off-chain reconcile, where non-classic accounts belong.

## F2 — MEDIUM: hardening directions are unreachable in production; the comment claims otherwise

MINT `update_wiring`: `governance_timelock_secs` and `sol_reserve_lamports` sit in the `needs_governance` disjunction **unconditionally**. But `governance_timelock_secs` can only move UP (ratchet) and raising the reserve is pure hardening — and in production `config.governance` is the GOV program's PDA, which can only ever sign a `set_round`. Neither field can be changed at all. (`split_bps` is likewise frozen both ways — defensible, since the alarm CRITICALs any change.)

The comment on `MIN_GOVERNANCE_TIMELOCK_SECS` claims "a floor set by mistake at launch is fixable rather than permanent." It is not, except by arming a governance rotation to a hot key — a state the alarm reports as CRITICAL — waiting out the very timelock being repaired, applying, changing the value, and rotating back. This is round 7's class verbatim ("a control that cannot be used in the emergency it exists for"), relocated from `swap_operator` to the two fields the direction-split missed.

Concrete: deploy with `governance_timelock_secs = 60` (legal; `initialize` accepts it) → alarm raises `weak_rotation_timelock` CRITICAL every 30 minutes while the on-chain remedy is unreachable. **Fix:** exempt the tightening direction exactly as `max_sweep_lamports`/`sweep_cooldown_secs` already are.

## F3 — MEDIUM: the refused/unconfirmed conflation round 9 fixed in `paymentState` survives in `detectDistribution`

`detectors.mjs` `detectDistribution`: `rows.filter(([, r]) => !r.sig && !r.skipped)` counts a `rejected: true` row as CRITICAL — "transfer(s) have no signature. Each may or may not have landed." For a refused send we **know** nothing landed; `paymentState` says 'unpaid'. And `distribute.mjs` refuses to stamp `finishedAt` on any day with a `failed` row, so `distribution_unfinished` HIGH fires too.

One permanently frozen destination ATA (cbBTC has a live freeze authority — this code's own comments say so) therefore produces a CRITICAL **plus** a HIGH every pass, forever, for a day whose outcome is fully known. The row is never retried (the plan is per-day; the cron runs once) and no code path ever closes a past day. This is the exact "detector on its way to permanent noise" class round 9 fixed twice. **Fix:** exclude `r.rejected` from the unresolved filter (report known-unpaid separately at HIGH); let a day finish with failed rows recorded as failed.

## F4 — MEDIUM: revenue.mjs has no resolution path for its own routine failures

A confirmation timeout on the sweep (landed, `sweepSig` never recorded) or on the split (`splitSig` never recorded) leaves the cycle open; every later run throws "Resolve them by hand", and the only remedy is **hand-editing `revenue-ledger.json`** — the file `detectUnledgeredSweeps`/`detectSplitClaims` exist to police. Round 6 built the intent-row so the ambiguity would be *visible*; the resolution half was never built.

The split case is fully automatable: `split_revenue` is permissionless — the script could re-invoke it and record the signature. As shipped, one RPC timeout wedges the entire revenue cycle indefinitely (alarm: permanent `unledgered_sweep` CRITICAL or `cycle_unsplit` HIGH) and pushes the operator toward editing the audit ledger by hand. **Fix:** a `--resolve` mode that reads the chain, finds the sweep/split signature for an open cycle, completes or records it — and never edits amounts by hand.

## F5 — MEDIUM: the reconcile's CRITICAL is purchasable at rent price

`detectUndeclaredTokenAccounts` fires CRITICAL on zero-balance accounts (the selftest asserts this deliberately). Creating a token account owned by a vault PDA needs no signature from the PDA and touches none of our programs; the account can never be closed (only the PDA could sign that, and the Bank would refuse it). So ~0.002 SOL buys one permanent, daily-recurring CRITICAL; a few SOL buys hundreds. That numbs the **only** control covering the non-ATA blind spot — the gap the whole architecture says this pipeline carries. **Fix:** severity by balance — CRITICAL only when the undeclared account holds value; zero-balance → HIGH "grief-created, unclosable, alarm if ever funded."

## F6 — LOW: the selftests have no assertion floor

`run-tests.sh` certifies `node bank/selftest.mjs | tail -3` on exit code only (pipefail catches failure — good), but a selftest regressed to zero assertions prints "0/0 … as predicted" and exits 0 (`[].every(Boolean)` is true). The on-chain suite got `MIN_ASSERTIONS=160` after exactly this class; the selftests did not.

## F7 — LOW / scope: `lock.mjs` was not provided

`withLock`/`readLedger`/`writeLedger` are the last line of every double-pay defense and are unaudited here. If `writeLedger` is not temp-plus-rename, a crash mid-write leaves a corrupt ledger — which `readLedger` turns into a loud abort (safe), but that should be verified, not assumed. Also `withLock(LOCK, main, { staleMs: 2h })` on the alarm means a pass stretched past two hours by RPC degradation has its lock broken and can overlap the next pass; state writes are last-write-wins.

---

# WHAT I TRIED AND COULD NOT BREAK

- **GOV double-voting.** VoteRecord at `["vote", proposal, asset]` blocks a second vote in any hands; a burned vault fails `read_core_asset` (closed account, empty data); a PDA-owned vault cannot sign; re-minting at a burned asset's address hits the existing VoteRecord. Standing-at-vote-time is the documented minting trade-off, bounded by `max(snapshot, live)` and the Bank duty. Execute is monotonic (`last_executed_id`), windowed (7d), round-liveness-checked, tally rule snapshotted, and the CPI authority is verified on **both** sides (GOV re-reads MINT's config; MINT's `has_one` checks the signer). Ceiling quorum, threshold capped at 7500. I could not construct a double vote, a stale execute, or a replay.
- **split_revenue.** All three destination ATAs re-derived from config + the passed mint; token program pinned; the Bank's cut is floored and the two transfers sum to the balance exactly at 0, 1, and u64::MAX (u128 intermediate). A hostile token costs the griefer two ATA rents — the round-8 rejection stands.
- **sweep_sol_for_swap.** Destination pinned in config AND required to sign; cap and cooldown on-chain; reserve floor; two sweeps in one transaction share a timestamp and the 1s floor blocks it.
- **set_collection_royalties** — measured against pinned mainnet Core since round 6; not re-raised.
- **Every raw offset the alarm reads** — I re-derived all four config layouts against the Rust declarations, including the post-Vec SEAL pendings, gov `last_executed_id`@94, and mint `pending_bank`@409. All match; `missingWatchedKeys` is wired; both `detectIndexShortfall` call sites pass arrays.
- **detectApprovals' stated blind spot** (an approve in a transaction touching none of our programs) is structurally closed: an approve by a vault PDA requires Core Execute, which requires the freeze off, which only exists inside an open→close pair that touches SEAL — so the approve is always inside a scanned transaction.
- The deferred-sweep carry, the dry-run non-consumption, the marker-guarded ledgers, and the cron TAG dedupe all check out as round 9 described.

---

# THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Run the one-line validator test for **F1**: create a Token-2022 ATA for cbBTC owned by a vault PDA. If it succeeds, every customer vault is permanently sealable by a stranger for the price of an ATA rent, and this is the worst finding of all ten rounds. If it fails, delete the Token-2022 derivation from the reserve loops so the assumption is enforced by construction instead of by luck. Either way, do it before a single satoshi of customer cbBTC enters a vault.