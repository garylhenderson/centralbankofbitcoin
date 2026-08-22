**CRITICAL: `sweep_sol_for_swap` is permissionless, accepts `amount = 0`, and stamps `last_sweep_at` — anyone can halt the revenue cycle silently**

`cbob_vault_mint::sweep_sol_for_swap` (`programs/cbob-vault-mint/src/lib.rs`). `SweepSolForSwap` has **no signer**. `amount` has no `> 0` check. Every successful call writes `config.last_sweep_at`.

Exploit (no privileged key):
1. Wait until `["revenue"]` holds SOL above `sol_reserve_lamports`.
2. Call `sweep_sol_for_swap(0)` (or `1`). System transfer of 0 succeeds. Cooldown starts.
3. Repeat once per `sweep_cooldown_secs`.

Effects:
- Official `bank/revenue.mjs` then either cannot sweep (`SweepTooSoon`) or sees `amount == 0` (`nothing to sweep`) and **exits 0**.
- It only swaps SOL **it** swept. It never looks at operator balance or `SolSweptForSwap` events.
- `detectUnreconciledRevenue` only reads `revenue-ledger.json`. An outsider sweep writes **no row**. Alarm is quiet.
- If the attacker instead sweeps `max_sweep_lamports`, all income sits on the hot operator key — the one trusted hop — indefinitely.

Round 6 put the cap/cooldown on-chain (real) then left the instruction unsigned. The cooldown became a grief handle. The comment that a stranger “is doing us a favour” is false: the cron already holds `swap_operator`.

Fix: make `swap_operator` a `Signer`; `require!(amount > 0)`; alarm on `last_sweep_at` / operator SOL movement with no ledger cycle; `revenue.mjs` must drain leftover operator SOL, not only its own sweep.

---

**HIGH: `distribute.mjs` treats a payment *intent* as paid — crash or confirm-timeout silently skips vaults**

`bank/distribute.mjs`: writes `done[v] = { sig: null }` **before** `sendAndConfirmTransaction`, then on resume `if (done[v]) continue`.

If the process dies after `save(st)` and before a landing confirm (the exact window they already burned on in `revenue.mjs`), or the RPC times out on a tx that **did not** land:
- resume skips that vault
- remaining vaults are paid
- `finishedAt` is set, exit 0
- that vault gets **nothing** that UTC day

Failed transfers (`done[v].error`) are also skipped forever the same day. The comment says a resume can “SEE the ambiguity”; the code never checks `sig`, never re-reads the ATA, never retries.

Fix: treat `sig == null` as unresolved: `getSignatureStatuses` / ATA delta; retry if neither landed; never mark `finishedAt` while any intent is unresolved.

---

**HIGH: GOV admin can pass any `set_round` without a vault majority — faster than the MINT governance timelock**

`update_gov_config` may set `quorum_bps` to `1` immediately (no timelock). `execute_proposal` uses **live** `quorum_bps` / `threshold_bps`, not values snapshotted on the `Proposal`. `admin` itself is rotatable in the same instruction with no delay.

Exploit with the GOV admin key (and one vault):
1. `update_gov_config(quorum_bps=1)`.
2. `create_proposal(price=0, cap=remaining, window=1y)` / `cast_vote(yes)`.
3. Wait `min_voting_secs` (deployable at the 60s floor).
4. `execute_proposal` → CPI `set_round`.

The round-6 note that a hostile admin “can already BE governance in seven days” is false: becoming MINT `governance` is timelocked; lowering quorum is not. Snapshot of `minted_total` is real; the **bar** still moves under an open vote.

Still needs the Bank to co-sign each `mint_vault` (cannot unseal existing vaults). This is capture of **price/supply timing**, not reserve BTC.

Fix: snapshot `quorum_bps` and `threshold_bps` onto `Proposal` at creation; ratchet-down of quorum (and admin rotation) must use the same public timelock as MINT governance.

---

**HIGH: Alarm does not implement two controls the programs say it implements**

1. MINT: “THE DEPLOYED VALUE MUST BE DAYS. The Bank alarm asserts the live value” (`governance_timelock_secs`, floor 60s). `readConfigs()` never reads offset 361. `detectStandingRisks` never checks it. A 60s timelock ships as quiet.
2. Round 6: collection hashed into the drift snapshot. `detectConfigDrift` watches `collection.hash`; **nothing ever writes that key**. Royalty/plugin changes are invisible.

Fix: read and floor-check `governance_timelock_secs` (and `min_voting_secs`); hash the collection account the same way program ELF is hashed.

---

**MEDIUM: Failed official sweep bricks all future cycles**

`revenue.mjs` appends `intendedLamports` then sends. Any failed sweep (cooldown grief above, pause, RPC) leaves an “open” cycle; the next run **throws** until a human edits the ledger. Loud if `--live`, still a single crash away from a stuck 85% pipe.

---

**Could not break (evidence: code paths + suite still green)**
- SEAL open/close 2-of-2 + `inspect_reserves` delegate/close-authority checks.
- `VoteRecord` seeds `["vote", proposal, asset]` — transfer-and-vote-again cannot init twice; burned assets fail `read_core_asset`.
- `split_revenue` destinations are ATA(config), not caller-chosen; Token program pinned; Bank share floored; amounts sum to `total`.
- Lifetime `max_supply` vs `minted_total`; `set_round` `cap > 0` and 1-year window; execute `RoundAlreadyOver` + 7-day window; `executed` set in the same tx as the CPI (revert retries cleanly).
- BURN reads reserve list from SEAL config (no second copy).
- Per-address alarm cursors advance only on a fully-read window; corrupt ledger throws; distribute/revenue/alarm take a lock; `minted_total` vs DAS live+burnt refuses a short page.
- `set_collection_royalties` encoding matches Core `Plugin::Royalties` (round 6 ran both opcodes); creator is hardcoded to `["revenue"]`; `basis_points <= 1000`.
- One actor with 500 activated vaults taking 500 shares is the charter, not a bug.

**Single thing to fix before this holds real money:** stop unsigned sweeps — `swap_operator` must sign `sweep_sol_for_swap`, reject `amount == 0`, and make alarm/revenue treat any on-chain sweep / operator SOL as a cycle that must be swapped, split, and ledgered.