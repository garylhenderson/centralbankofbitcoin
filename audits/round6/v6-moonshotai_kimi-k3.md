# ROUND 6 FINDINGS

## CRITICAL — The alarm cannot see a completed bare burn

`bank/alarm.mjs`: `listVaults` filters `!i.burnt`; `assets = new Set(vaults)`; `detectBurns` requires `assetSet.has(asset)` before flagging a bare Core `BurnV1`.

A bare burn that **succeeds** marks the asset burnt. By the alarm's next pass, that asset is filtered out of DAS and is not in `assetSet`, so its historical bare-burn transaction fails the `assetSet.has(asset)` gate and produces **no finding**. The only burns this detector can ever see are ones that failed or ones it catches in the same 30-minute window between burn and next poll. This is the one watcher over the one attack the programs provably cannot prevent ("PROVEN IMPOSSIBILITY 1"), and it is blind exactly when the attack succeeds. `burn_via_program` still fires (no assetSet gate), which masks the hole: the detector passes its selftest because the selftest feeds it an asset that is in `assets` — a state the real pipeline removes at completion.

Exploit: owner calls Core `BurnV1` directly. Contents orphaned (impossibility 1). Alarm: silent, forever.

Fix: build `assetSet` from historical ownership — include burnt assets, or match the burn's `accounts[0]` against the asset-signer PDA set (`pdaSet` includes PDAs of burned vaults as well) — and treat "vault left the non-burnt list without a `burn_vault` tx" as its own CRITICAL.

## HIGH — The transaction tail is unsound: one watermark for five streams, 200-limit on a global program

`alarm.mjs` main loop: a single `newest` watermark is stored (`prev.lastSignature`) and passed as `until` for **all five** programs (SEAL, MINT, BURN, GOV, CORE). Consequences:

1. For every program except the one that supplied the watermark, the `until` signature is not in that address's history, so each pass re-fetches that program's newest 200 signatures and re-reports old findings (duplicate CRITICALs, alert fatigue).
2. If a quiet program (GOV, SEAL) accumulates >200 txs inside one window — or during downtime — the page returns only the newest 200; everything older is unreachable later because the watermark belongs to a different stream. Permanent gaps.
3. Worst case is CORE itself: `getSignaturesForAddress(CORE, limit:200)` polls the **global Metaplex Core program**, which on mainnet handles orders of magnitude more than 400 txs/hour from unrelated projects. A 30-minute cron reading at most 200 of them is sampling, not watching. The bare-burn and PDA-token-account detectors are only as good as this feed (see finding 1 for what compounds this).

The header claims "completeness is this file's job"; the tail does not have it. Fix: watermark per monitored address; paginate (`before`) until the watermark is reached; drop the global CORE scan entirely — derive watch targets from the vault list and poll per-asset/per-PDA histories.

## HIGH — distribute.mjs pays twice on any second run, and on a mid-window crash

`bank/distribute.mjs`: `st.days[day].paid` guards "one distribution per UTC day" per **process**, not per day. Two concurrent executions (cron fires while an operator re-runs manually; cron overrun overlaps; the cron-install adds no `flock`) both `load()` before either `save()`s; both see `done[v]` empty; both send `plan.per` to vault v. Ledger: `paid` entries exist in both. Nothing fails loudly.

Second hole: `done[v] = {...}; save(st)` happens **after** `sendAndConfirmTransaction` returns. A crash (OOM, SIGKILL, box reboot) in the window between confirmation and `save(st)` leaves the transfer on-chain and the ledger blank; the next run re-pays vault v. "Recorded BEFORE the next one starts" is true only for a clean run. The header's "refuses to pay twice" is not delivered by the code.

Fix: advisory lockfile (`flock -n` / `proper-lockfile`) around the whole run; write an intent entry for vault v **before** sending, and on re-run with an intent-but-no-sig, resolve the tx on-chain before deciding to re-send. Note on-chain there is no idempotency key, so this needs the lock to be real.

## HIGH — GOV quorum is measured against ever-minted supply, and burns only inflate it

`cbob-vault-gov` `execute_proposal`: `need = minted_total * quorum_bps / 10000`, read live. `minted_total` in MINT is incremented at mint and **never decremented** — BURN has no write to MINT config and cannot touch it. Burned vaults cannot vote (`read_core_asset` fails on a burnt asset) but permanently count in the denominator. Trajectory: at 2,100 minted with, say, 300 burned over the vaults' life and quorum 30%, `need` counts the dead 300; active voting population shrinks while the bar does not. Governance asymptotically freezes. The header claims quorum "tracks real supply instead of a snapshot" — it tracks cumulative issuance, which is neither.

Second edge of the same design: standing and quorum are both read live, not at proposal time. While any round is open — worst case a price=0 round — an opponent can mint vaults after voting closes and before `execute`, raising `need` above `cast` and killing a proposal that already won. Charter-style free rounds make this cheap; even priced rounds merely price the veto. Also, a vault minted **after** a proposal opened votes on it freely.

Fix: read supply from a source that decrements on burn, or snapshot `minted_total` into the Proposal at creation and use it for quorum; decide the joiner policy explicitly and document it, because mint-to-block is currently unpriced.

## MEDIUM — The "50 SOL cap" binds nothing on-chain; the reserve is an init-time immutable

`cbob-vault-mint` `sweep_sol_for_swap(amount)`: permissionless, destination pinned to `cfg.swap_operator` (the pin holds — caller cannot redirect), reserve invariant `bal >= keep + amount` holds per call. But `amount` is an unconstrained u64: a stranger can sweep the entire balance-above-reserve to the operator in one call or in a loop. The 50 SOL cap exists only in `bank/revenue.mjs`, a file that need not be the caller. Not theft (destination is pinned) — but the claim "bounded" is off-chain-only, enlarges the operator-key blast radius (whatever is swept is operator-held until return), and lets anyone force maximum exposure at the worst market moment. Separately, `sol_reserve_lamports` is set once in `initialize` with **no setter**: if it is ever set above typical SOL inflow, mint revenue SOL is permanently stranded (sweeps revert; split moves only tokens).

Fix: enforce `amount <= cap_lamports` in config on-chain; add a setter for the reserve (admin+gov).

## MEDIUM — No timelock, no execute deadline, instant-open rounds

GOV: `execute_proposal` is callable forever after `voting_ends_at` (no expiry/cancel exists at all — the lifecycle in the brief has no on-chain counterpart), and `set_round` accepts `opens_at` in the past. A ratified proposal can therefore take effect the same second voting closes, opening a round with zero reaction window for holders; and a proposal that passed months ago remains executable whenever quorum arithmetic cooperates (finding 4 makes it rot, but early-era low-supply proposals are live grenades). Also `closes_at - opens_at` in both GOV and MINT uses plain i64 subtraction on attacker-supplied timestamps; overflow wraps (BPF release) if `opens_at` is extreme, potentially bypassing the one-year bound.

Fix: in `execute_proposal` require `opens_at >= now + TIMELOCK` (and MINT should independently require `opens_at > now - k`); use `checked_sub` on the window math; add proposal expiry.

## MEDIUM — GOV is immutable and breaks the pinning doctrine the rest of the codebase enforces

`GovConfig.admin` is assigned and **never read by any instruction** — there is no update path for `quorum_bps`, `threshold_bps`, `min_voting_secs`, or `collection`. Mis-set at initialize, it is frozen forever (upgrade the program and re-derive... nothing; config seeds are fixed). The config drift detectors for `gov.quorum_bps` / `gov.threshold_bps` can literally never fire — dead alarms that report health. And unlike SEAL/MINT configs, GOV has **no version byte**: `alarm.mjs` reads `gov.min_voting_secs` at hardcoded offset 76, so the first GOV upgrade that inserts a field silently misreads every downstream consumer — the exact failure the version-pin discipline exists to catch, absent in the newest program. Also `initialize` allows `min_voting_secs = 60` in production; the only defense is the off-chain `weak_voting_period` detector.

Fix: add setters behind admin (+ a version byte as field 1), or document immutability and delete the dead detectors.

## MEDIUM — Build and test ops can green-light artifacts they never proved

`build-mainnet.sh`: `cargo-build-sbf ... | grep -E "^error" -A5 && die` only dies on failures that print a line starting with `error`. A build that fails otherwise (linker, OOM, ICE) is skipped; then `cp /tmp/cbob-mn/.../release/*.so "$OUT/"` copies whatever exists — `/tmp/cbob-mn` is never cleaned, so **stale objects from a previous run can ship in `dist/`**. The behavioral gate (`ask`) only deploys `cbob_vault_mint.so`: SEAL, BURN and GOV `INIT_AUTHORITY` constants are never behaviorally verified, though each is an independent `#[cfg]` block that could be mis-copied. The REJECTS/ACCEPTS check is sound against false-green *only because* the LN control would die otherwise — but it proves one program.

`run-tests.sh`: test file is `CBOB_TEST_FILE`-overridable, named `3prog.test.ts` while four programs deploy, with no assertion-count floor and no check that GOV is exercised at all. `npx tsx` exit code is the only gate.

Fix: `rm -rf` the temp target dirs, verify `dist/*.so` mtimes against the build just run, gate on toolchain exit code not grep output, extend `ask` to all four programs, and pin a minimum assertion count in the test runner.

## MEDIUM — DAS completeness is trusted, never cross-checked

`distribute.mjs` says it "refuses to guess," then divides the pool by whatever `getAssetsByGroup` returns. An indexer that is lagged, truncating, or returning a malformed-but-`result`-shaped page silently shrinks the denominator and **overpays the visible vaults and omits the invisible ones**. `mint.minted_total` is read nowhere in the pipeline; a guard `vaults.length >= minted_total - burned_estimate` (or at least "not less than last pass minus X") is available and unused. Same hole in `alarm.mjs` (a vanished vault set looks like "nothing to watch").

## MEDIUM — Crash-silent state files; a failed save looks like a clean first pass

`alarm.mjs` `writeState`, `revenue.mjs` `save`, `distribute.mjs` `save`: all `JSON.stringify` + single `writeFileSync`, non-atomic. A crash mid-write corrupts `state.json`; next run's `readState()` returns `null`, suppressing `detectConfigDrift` and `detectDeactivations` (both no-op on absent `prev`) and resetting the tx watermark — quietly, with the bottom line still printed. The pipeline's own stated rule ("a read that fails is an alarm, never a pass") is violated by its own persistence layer. Fix: write tmp + rename; treat corrupt state as a finding, not a first pass.

## LOW — Votes are atomically rentable

One transaction: Core `TransferV1` (vault to broker), `cast_vote` (broker signs), `TransferV1` back. Owner signs once; custody-based standing holds for the one slot that matters; the vault ends home with `VoteRecord` written. This is vote-selling made flash-loan-cheap, and it hollows the "seller inherits a voted vault" defense (the renter never sells). Accept as design or move to snapshot-at-proposal; but the doc's claim of binding is stronger than the property.

## LOW — Royalties: unproven bytes, and a "one number" claim that is two numbers

`set_collection_royalties`: (a) I could **not** refute the byte layout — instruction discriminators 3/7 and `Plugin::Royalties = 0 | u16 bps | Vec<Creator> | RuleSet::None | Option<authority>` are internally consistent and consistent with the SDK shapes the working constants were read from. But it has **zero validator coverage** while every analogous hard-coded CPI in the repo was only trusted after measurement; add a suite assertion against cloned mainnet Core before deployment. (b) `basis_points` is a caller argument, not `cfg.split_bps`, so "One number, both revenue paths" is false — admin+gov can diverge primary and secondary, and 10,000 bps (a 100% royalty that breaks every marketplace) is admissible. Pin `basis_points == cfg.split_bps` translated, or drop the claim.

## LOW — Operational residue

`cron-install.sh`: no run-overlap guard for distribute/revenue (feeds finding 3); re-runs de-dupe the job lines but append the comment block each time (grep filter doesn't match the header text); the `--live` flip is a one-word edit with no separate review gate. Key files (`keys/*.json`) are never chmod/checked anywhere; logs land in world-readable `/tmp`. `alarm.mjs` hardcodes the ledger path while `revenue.mjs` honors an env override — under env-configured deployment the unreconciled-swap detector silently reads an empty location and passes. The drift watchlist also omits `burn.bank` and all `burn.*` config: the co-signer on the destruction path is unmonitored.

---

## What I tried and could not break

- **Vote double-cast via transfer**: `VoteRecord` is `init` at `["vote", proposal, asset]`; a transferred vault hits the existing account. Held.
- **`open`/`close` pairing**: both directions introspect the same transaction (open requires a later close bound to asset+owner; close requires an earlier open). I could not construct the unpaired stamp.
- **split_revenue destination pinning**: holders/bank ATAs are derived from config wallets + pinned token program + derived ATA bump; `transfer_checked` fails atomically on mismatch; the two legs sum exactly to the balance at 0 (rejected), 1, and large values. Rounding falls to holders' floor. Held.
- **sweep reserve invariant**: `bal >= keep + amount` per call cannot be looped below the reserve.
- **Burn's emptiness set + lamports check** and **SEAL-config cross-pinning with disc+version**: consistent across MINT/BURN; the stale-copy class is genuinely closed.
- **VoteRecord/Proposal reinit**: no close path exists, no rent recovery, no recreation vector.
- **INIT_AUTHORITY behavioral gate (concept)**: the LN control makes an unguarded wrong constant fail loudly — for MINT only (see finding 8).

## The single thing to fix before real money

Make the alarm able to see the attack only it can see: right now a completed bare `BurnV1` is invisible by construction, and the transaction feed it runs on is a 200-row sample of a global program behind a single cross-stream watermark. Rebuild detection around per-vault/per-PDA state and history (include burnt assets, watermark per address, paginate) before any cbBTC sits behind "the Bank alarm's job."