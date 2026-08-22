**FINDINGS**

**1. CRITICAL — `sweep_sol_for_swap` is not bounded; the 50 SOL cap is a comment**
`programs/cbob-vault-mint/src/lib.rs` `sweep_sol_for_swap`: the only on-chain check is `bal >= sol_reserve_lamports + amount`. Destination is pinned (`cfg.swap_operator`), but `amount` is unbounded. `MAX_PER_CYCLE_LAMPORTS` lives only in `bank/revenue.mjs`.

The instruction is permissionless and `update_wiring` cannot rotate `swap_operator` or `sol_reserve_lamports` (set only in `initialize`).

Exploit: holder of `swap-operator.json` (or anyone, to force funds onto that key) calls `sweep_sol_for_swap(amount = revenue.lamports - reserve)`. The JS cron never runs. Entire SOL stack leaves in one tx. Compromised operator then does not return cbBTC. `--audit` and `detectUnreconciledRevenue` read `revenue-ledger.json`, which that key’s process writes — they can write `returnedSats` and the alarm is quiet.

Fix: enforce a hard per-tx and/or per-slot cap in the program; require the operator (or admin+gov) as signer; add `swap_operator` / reserve to `update_wiring` (gov-gated). Reconcile from `SolSweptForSwap` logs vs the revenue ATA, not a self-written JSON file.

**2. CRITICAL — `distribute.mjs` can pay the same vault twice; the day-guard is not a lock**
`bank/distribute.mjs`: `done[v]` is written **after** `sendAndConfirmTransaction`. Comment says the opposite. No `flock`. Cron is live (`7 9 * * *` with no `--dry-run`).

Exploit:
- Crash (or SIGTERM from a second start) after confirm, before `save(st)` → rerun pays that vault again.
- Manual run overlapping the 09:07 cron: both load `distributions.json`, both see `paid[v]` empty, both transfer.
- Resume after a partial day recomputes `per = available / all_activated` (including already-paid), so the remainder of the day is a different amount — not theft by itself, but the same file race is.

Fix: `flock` the state file; write `paid[v] = {pending}` **before** send and only then the sig; or a memo/idempotency key `(day, asset)`. Recompute `per` from remaining unpaid vaults only.

**3. HIGH — revenue cycle cannot resume; a crash strands SOL/cbBTC on the operator**
`bank/revenue.mjs`: after a successful sweep, `amount === 0n` on the next start prints “nothing to sweep” and **returns**. It never inspects open ledger cycles. Quote is taken **before** sweep, then the same quote is submitted to Jupiter **after** SOL has already moved (stale quote → swap throw → same dead end).

What you get: SOL on the operator, or cbBTC on `opAta`, customers unpaid, cron green. Human-only recovery. If that human “fixes” the ledger, finding 1’s detector stays dark.

Fix: state machine: resume in-flight cycle (return leftover ATA, then split) before any new sweep; re-quote after sweep; refuse `--live` if an open cycle exists.

**4. HIGH — alarm tx tail cannot see the burns/approves it exists to see**
`bank/alarm.mjs`: one `lastSignature` is shared across SEAL, MINT, BURN, GOV, **and the global Core program**. `getSignaturesForAddress(CORE, {limit: 200})` is every Core tx on the cluster. `until` a SEAL signature is meaningless on Core/MINT.

Bare `BurnV1` (the stated unpreventable Core hole) will almost never sit in the last 200 Core txs. Approves / `initializeAccount` on vault PDAs that are not in those 200 are dropped forever once `lastSignature` advances. `if (!tx) continue` is a silent skip.

Failed `getTokenAccountBalance` is `catch { bal = '0' }`, then that false inactivity is **written** to `state.json`. Next pass: `prev.activation[v] === false`, a real drain does not fire `detectDeactivations`.

Deleting `revenue-ledger.json` is caught and treated as “no finding”.

Fix: cursor per address; watch the collection / each vault / `asset-signer` ATAs, not `CoREEN…`; treat RPC failure as alarm and **do not** persist it as deactivation; reconcile sweeps from chain logs.

**5. HIGH — governance: live `minted_total` + no snapshot + no cancel + last execute wins**
`cast_vote` standing is **now**, PDA `["vote", proposal, asset]` (transfer-replay is fine). Quorum is `cast >= minted_total * quorum_bps / 10000`. `minted_total` only increases in `mint_vault`; burn does not decrement it.

- Open public round during a vote: anyone the Bank will co-sign can mint and vote new vaults (pass) or mint and **not** vote (inflate denominator, kill quorum).
- Over years, burns make quorum unmeetable against lifetime minted (comment says “live supply”; the field is not).
- No cancel, no one-active-proposal rule, no timelock. `execute_proposal` is permissionless and immediately CPIs `set_round`, which **resets** `minted_this_round`. Two concurrent passing proposals: the later execute overwrites the live round and re-opens the per-round cap. `min_voting_secs` floor is **60** and there is **no** gov `update_*` — a 60s mainnet init is permanent without a program upgrade. `GovConfig.admin` is never read again.

MINT still independently rejects `cap == 0`, window `> 1y`, and `minted_total >= max_supply`. Governance cannot mint past the lifetime cap or change plugins. It **can** set `price_lamports = 0` and `opens_at` in the past / `closes_at` in the future (instant free round) for whatever supply remains.

Fix: snapshot `minted_total` (and eligible assets) at `create_proposal`; reject votes from assets minted after `id`; one live proposal; cancel; execute timelock; floor `min_voting_secs` in days on mainnet; add a gov config update; decrement or ignore burned supply.

**6. MEDIUM — `set_collection_royalties` is an untested Core CPI; `run-tests.sh` will go green without it**
Encoding *looks* like Add/UpdateCollectionPluginV1 (opcodes 3/7, `Plugin::Royalties`, one creator = revenue @ 100, `RuleSet::None`, `Option::None` on add). Creator cannot be redirected. `basis_points` can be 0 or 10000 (kills or confiscates resale) with admin+gov.

Authors state this path has never hit real Core. `scripts/run-tests.sh` runs `tests/3prog.test.ts` only — not GOV, not royalties, not `bank/selftest.mjs`, not `distribute --selftest`. `build-mainnet.sh` only deploys **mint** and asks `initauth.test.ts`; SEAL/BURN/GOV INIT_AUTHORITY is not what that proof measures.

Fix: one validator test that Add then Update royalties on cloned Core and decodes the plugin; fail CI if bank selftests are not run; extend `build-mainnet.sh` `ask()` to all four `.so`.

**7. LOW — `split_revenue` comment is false at dust; cron overlap**
`holders = total * split_bps / 10000`, bank gets remainder. At `total == 1`, holders get 0, bank gets 1. Destinations and mint program are pinned; a hostile mint/token program cannot redirect. `cron-install.sh` is idempotent and refuses non-`ubuntu`; jobs have no lock, so finding 2/3 are what a re-run/overrun actually hits.

---

**Could not break**
- Second vote by transfer, delegate, collection account, or burned asset (`VoteRecord` seeds + live owner bytes + Core owner).
- Redirect of `split_revenue` / `sweep` destinations via caller accounts.
- Royalties creator set to anything but `["revenue"]`.
- `execute` twice in two txs (`executed` set before CPI; CPI fail reverts it).
- Evading `max_supply` or minting with `cap == 0` / multi-year window.
- On-chain 2-of-2 open/close/burn pairing (SEAL/BURN as previously measured).
- Detector *functions* given a complete ix list (selftest both directions). The hole is the fetcher, not `detectApprovals` arithmetic.

**Single thing to fix before real money:** treat the operator hop as hostile: cap and gate `sweep_sol_for_swap` on-chain, make the operator rotatable, resume/reconcile from chain state, and flock+pre-record `distribute.mjs`. Everything else is how you lose the rest.