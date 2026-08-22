# FINDINGS

## 1. CRITICAL — Quorum can be *minted* during the voting window; the round-6 snapshot fixed only the divisor and made the buy-quorum attack *cheaper*

**Where:** `programs/cbob-vault-gov/src/lib.rs`, `cast_vote` + `execute_proposal`, against `Proposal.quorum_supply`.

The round-6 fix snapshotted `minted_total` into the proposal at creation. That fixes only the *denominator* direction (blocking a won proposal, or inflating the bar). The **numerator is still unrestricted**: `cast_vote` reads standing live at vote time and never checks the asset existed when the proposal opened. Under the old live divisor, each minted vault added 1 vote and `quorum_bps/10000` of bar (net +0.7 at 30% quorum). Under the snapshot it adds **1 vote against a fixed bar — net +1.0**. The header comment ("minting during a proposal bought quorum… The snapshot fixes the divisor") describes an attack the fix does not fix; it improves the attacker's exchange rate.

**Exploit (who signs what, in order):** during any open round — and the charter round is `price_lamports = 0` with **no on-chain PoB gate anywhere in the shown code** — an attacker:
1. Mints one vault (`mint_vault`: attacker signs owner+payer, Bank co-signs).
2. `create_proposal` early, when `minted_total` is small. With `minted_total = 1` and `quorum_bps = 3000`, `need = (1×3000)/10000 = 0` — **one vote ratifies anything**.
3. Mints `N ≥ ceil(quorum_supply × quorum_bps / 10000)` more vaults, votes them all YES.
4. After `voting_ends_at`, `execute_proposal`: `cast = N ≥ need`, `yes_bps = 10000 ≥ threshold`. Passes.
5. The ratified `set_round` sets `price_lamports = 0`, `cap = 2100`, window = 1 year. The attacker free-mints the remaining supply and holds permanent governance majority.

Cost: transaction fees during the charter round; `N × price` later. `max_supply` bounds the loot but not the capture. **Detection: none.** `mint.minted_total` is snapshotted by the alarm but is not in `detectConfigDrift`'s watch list, `detectVaultSetChange` is quiet on *new* vaults, and no detector watches proposal vote counts. The only friction is the Bank co-signature on mints — whose stated duties (token-account enumeration) say nothing about mint policy, and which must be automated for a public sale to function.

**Fix:** in `execute_proposal`, `require!(minted_now == p.quorum_supply)` — refuse to execute any proposal under which supply moved (the value is already read). This fails closed; the grief cost (one mint invalidates a proposal) is the round price and forces a re-vote. Whoever mints *before* the proposal is visible is just a large holder — the concentration the business explicitly accepted. Add an alarm watch on `mint.minted_total` growth rate and on `yes+no` exceeding supply-at-creation.

## 2. HIGH — The alarm is blind to every sweep the cron did not initiate; the "ledgered and reconciled" claim covers only `revenue.mjs` cycles

**Where:** `bank/alarm.mjs` (detector loop over `SEAL/MINT/BURN/GOV` signatures), `bank/detectors.mjs` (`detectUnreconciledRevenue`).

`sweep_sol_for_swap` is permissionless and the operator key is the pinned destination. A holder of that key can call the program **directly**, bypassing `revenue.mjs` entirely. Such a transaction appears in MINT's scanned signatures — but the only detectors run are `detectApprovals`, `detectPdaTokenAccounts`, `detectBurns`; none matches a sweep. `detectUnreconciledRevenue` reads the **ledger file**, which only `revenue.mjs` writes. The revenue PDA's SOL balance is not snapshotted; `mint.last_sweep_at` is read but not watched (correctly — it would be noisy — but nothing else sees sweeps).

**Exploit:** compromised operator key sweeps `max_sweep_lamports` every `sweep_cooldown_secs` — 50 SOL/hour at a plausible config — with **zero findings**, forever. The on-chain cap/cooldown (round 6) is real and is now the *only* bound; the detection story that justified the design ("every sweep emits an event so the Bank alarm can reconcile") is not implemented for chain-initiated sweeps.

**Fix:** snapshot `getBalance(REVENUE)` each pass and alarm on any decrease not explained by a ledger cycle; and/or add a detector matching the `sweep_sol_for_swap` discriminator in scanned MINT instructions, cross-checked against ledger `sweepSig`s.

## 3. HIGH — The alarm assertion that `governance_timelock_secs` is days **does not exist**

**Where:** `programs/cbob-vault-mint/src/lib.rs` (`MIN_GOVERNANCE_TIMELOCK_SECS = 60`, comment: "⚠️ THE DEPLOYED VALUE MUST BE DAYS. The Bank alarm asserts the live value") vs `bank/alarm.mjs` `readConfigs` and `bank/detectors.mjs` `detectStandingRisks`.

`readConfigs` reads mint offsets through `pending_governance_at` (353) and **stops**. `governance_timelock_secs` (offset 361) is never read, is in no drift watch, and has no standing check — unlike `gov.min_voting_secs`, which genuinely has one (`weak_voting_period`). This is exactly the comment-claims-what-code-does-not-do class.

**Exploit:** deploy (or `initialize`) with the 60s floor — nothing on-chain or off-chain flags it. Admin arms `pending_governance = <admin key>`; the armed window is 60 seconds; the alarm runs every 30 minutes, so the `governance_rotation_armed` standing check has a ~3% chance of observing it. Admin applies, then **alone** satisfies every governance gate in `update_wiring`: treasury, `split_bps`, `swap_operator`, `sol_reserve_lamports`, `max_sweep_lamports`, cooldown. The round-6 bug, resurrected through a config value whose asserted watchdog was never written.

**Fix:** read offset 361, add a standing check (≥ days) and drift watch. Same treatment for two neighbours with the same shape: `max_sweep_lamports` has **no magnitude check anywhere** (the "50 SOL cap" binds only the cron's own calls — see Finding 2), and `sol_reserve_lamports` has no floor (0 is expressible at `initialize` and in `update_wiring`; a permissionless sweep can then strip the revenue PDA to zero lamports).

## 4. MEDIUM — `revenue.mjs` ignores the on-chain sweep bounds it must obey; a mismatch poisons the ledger and halts all future cycles

**Where:** `bank/revenue.mjs` `main()` — reads offsets 137/221/256/288/253 but never 297 (`max_sweep_lamports`), 305 (`sweep_cooldown_secs`), 313 (`last_sweep_at`).

`amount = min(balance − reserve, 50 SOL)` is the *script's* constant. If config's `max_sweep_lamports` is lower, or the config cooldown exceeds the 6h cron cadence (or a foreign sweep consumed the cooldown), the on-chain `require!` rejects the transaction. But the intent row was already written (`intendedLamports`, no `sweptLamports`), and a preflight-rejected send is *known* not to have landed — yet it is left as an open cycle. Every subsequent run then throws "Resolve them by hand" and exits 3: **the revenue pipeline is permanently halted by one config/script disagreement**, requiring manual ledger surgery on the file that is also the only reconciliation record.

**Fix:** read the three config fields and clamp `amount` / defer accordingly. On send failure, distinguish simulation rejection (definitely not landed → roll back the intent) from confirmation timeout (keep it).

## 5. MEDIUM — `distribute.mjs`: the "intent" row is treated as *paid* on resume; the claimed ambiguity check was never written

**Where:** `bank/distribute.mjs` payout loop — `if (!done[v]) { done[v] = { amount, sig: null, sentAt }; save(st) }` … resume path: `if (done[v]) continue`.

The comment says the intent lets a resume "SEE the ambiguity instead of assuming the transfer never happened." Nothing looks. A process kill between the intent write and the transfer leaves `{sig: null}` with no `error` field; the resume skips it unconditionally. If the transfer never landed, that vault is silently underpaid for the day — not in `failed`, not notified, and the run that crashed never reaches the failure notification either.

**Fix:** on resume, entries with `sig === null && !error` are ambiguous: check the signature status / source-ATA debit, or at minimum count them and notify.

## 6. MEDIUM — Charter provenance and the PoB gate exist nowhere in the shown code

**Where:** `programs/cbob-vault-mint/src/lib.rs` `mint_vault(attributes: Vec<VaultAttribute>)`.

The business: ~190 free charter mints "redeemed against a burned Proof-of-Burn token", with Notice serial and Governor standing "stamped HERE and nowhere else". On-chain, `attributes` is **caller-supplied**: any minter in a price-0 round stamps charter provenance on their vault, and nothing on-chain or in `bank/` checks a PoB burn. The only gate is the Bank co-signature, whose documented duties do not include this. If PoB enforcement is Bank policy, it is untested and unwatched; a buyer cannot distinguish a forged charter vault from a real one except by `round_id` in an event.

**Fix:** state and test the Bank-side charter policy, or gate round 1 on-chain (e.g., a charter-allowlist PDA), and have the alarm flag mints in a price-0 round carrying charter attributes from non-allowlisted payers.

*(LOW, noted not expanded: a bare Core burn racing the distribution window strands that vault's share in an orphaned ATA — Core's BurnV1 does not sweep it; admin can veto any proposal by ratcheting `threshold_bps`/`quorum_bps` up just before execute.)*

# WHAT I TRIED AND COULD NOT BREAK

- **`split_revenue` pinning:** destinations are derived ATAs of config-pinned wallets; the token program is address-pinned; the mint is free but only moves tokens already at the revenue ATA; `bank_cut` is floored and `holders = total − bank_cut` sums exactly; balance 0 and `u64::MAX` behave. Could not route value anywhere the caller chooses.
- **`sweep_sol_for_swap` pinning:** destination is config, never an argument; reserve check is `bal ≥ keep + amount`; repeated sweeps in one tx are killed by the cooldown stamp (same `Clock` timestamp).
- **Double-vote:** VoteRecord is seeded by `[vote, proposal, asset]` — transfer-then-revote hits an existing account; burned vaults fail `read_core_asset` (closed account, empty data); no close instruction exists to re-init against.
- **Execute lifecycle:** `executed` set before the CPI (atomic), expiry window and `RoundAlreadyOver` hold; the CPI carries only the four proposal fields and MINT independently bounds window/cap/lifetime supply — a ratified proposal genuinely cannot touch plugins, the seal, or `max_supply`.
- **Offset maps:** I re-derived every raw-offset read (SEAL config in MINT/BURN, MintConfig in GOV and `alarm.mjs`, GovConfig/BurnConfig in `alarm.mjs`) against the Anchor layouts including the round-6 appended fields. All consistent, including `bump` at 296 and `pending_governance` at 321.
- **Royalties encoding:** `[3|7, 0, bps_le_u16, 1u32, creator32, 100, 0, (0)]` matches Core's Royalties/Creator/RuleSet layout and the round-6 live-Core test; `basis_points ≤ 1000` and the single creator is the derived revenue PDA — no redirect is expressible.
- **`distribute.mjs` double-pay:** lock + fixed daily plan + intent-before-send ordering survive crash, concurrent cron, and manual runs (modulo Finding 5's underpay direction).
- **`build-mainnet.sh`:** the both-builds behavioral proof is sound — a wrong constant cannot make both the mainnet build reject and the localnet build accept the test key for the same reason; stale-artifact and dirty-tree paths are closed.
- **`cron-install.sh`:** the tag now matches its own lines; `--live` preservation works; the deadman is independent of node.

# THE SINGLE THING

**Fix the governance franchise before this holds real money: restrict votes to vaults that existed when the proposal was created — minimally, `require!(minted_now == p.quorum_supply)` in `execute_proposal` — and add an alarm on `minted_total` velocity.** As shipped, the first open round lets any participant mint themselves quorum against a snapshotted bar, ratify a free round, and consume the remaining supply plus permanent governance control, with no detector anywhere firing. Everything else in this system is bounded, pinned, or watched; this is the one path where the watcher, the cap, and the vote all point at a bar the attacker can print.