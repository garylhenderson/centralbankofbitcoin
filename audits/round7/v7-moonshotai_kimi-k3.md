# FINDINGS

## 1. HIGH — GOV: vaults minted AFTER a proposal opens can vote; the quorum snapshot does not stop mint-to-quorum, and the header claims it does

`programs/cbob-vault-gov/src/lib.rs`, `cast_vote`. Eligibility is a live read of the asset's owner bytes plus a VoteRecord PDA seeded by asset. Nothing ties a voting vault to the proposal's `quorum_supply` snapshot. The header says the round-6 snapshot fixed "minting during a proposal bought quorum." It fixed the divisor moving; it made this attack *cheaper*, because the attacker's own mints no longer raise the bar at all.

Exploit, in order: (1) attacker holding one vault calls `create_proposal` while a round is open — snapshot supply S, `need = S × quorum_bps / 10_000`. (2) During the voting window the attacker mints `need` vaults. `mint_vault` needs the Bank's co-signature, but the Bank co-signs ordinary sales; nothing tells it a mint is a vote. In the charter round (price 0, by design) this is free. (3) One `cast_vote` per new asset — each VoteRecord is a fresh PDA. (4) After `voting_ends_at`, anyone calls `execute_proposal`: `cast >= need` against the frozen snapshot, `yes_bps = 10_000`. (5) The installed round has price 0, cap = remaining supply, one-year window — all legal under MINT's bounds. The attacker mints the rest free; future quorums are measured against a `minted_total` that now includes their vaults. Permanent capture of round-setting; the 85% revenue stream from the remaining ~1,911 vaults never exists.

Fix: stamp a mint index (`minted_total` at mint) into the vault's Attributes at creation — MINT already writes attributes — and in `cast_vote` parse it and require `index <= proposal.quorum_supply`. If that is rejected, correct the header: it currently claims a fix that is not one.

## 2. HIGH — the round-6 rotation timelock covers only `governance`; `admin` rotates instantly in all four programs, and rotating admin first disarms the timelock's only remedy

`update_wiring` (MINT): `if let Some(x) = admin { c.admin = x; }` — instant, no pending state, no governance co-signature. Same in `update_config` (SEAL, BURN) and `update_gov_config` (GOV). `cancel_pending_governance` is `has_one = admin`.

Exploit: one fraudulent or compromised Squads approval executes `update_wiring(admin = attacker)` — instant; the alarm sees it only as after-the-fact drift. The attacker, now admin, arms a governance rotation. The honest side **cannot cancel** — they are no longer admin. After the timelock the attacker holds admin+governance and repoints `treasury` (the 85%). Every step is detected by the alarm; none is stoppable on-chain. The round-6 fix assumed cancel was the remedy; instant admin rotation removes the canceller. This is the same threat model round 6 used to justify the timelock ("admin alone could…"), left open on the adjacent, strictly-more-powerful field. Note also `gov.admin` is read by `readConfigs` but absent from the `detectConfigDrift` watch list entirely.

Fix: `pending_admin` armed and timelocked identically to `pending_governance`, in all four programs; add `gov.admin` to the watch list.

## 3. HIGH — the alarm is blind to any sweep that does not go through revenue.mjs

`sweep_sol_for_swap` is permissionless; the destination is pinned to `config.swap_operator`. `detectUnreconciledRevenue` reads only the script's ledger. No detector reads `SolSweptForSwap` events, the revenue PDA's SOL balance, or sweep instructions — even though the alarm already fetches and normalises every MINT transaction, and the MINT comment says the event exists "so the Bank alarm can reconcile SOL-out against cbBTC-returned."

Exploit: the compromised operator key — the exact adversary the ledger design names — calls `sweep_sol_for_swap` directly, `max_sweep_lamports` every cooldown, never touching the script. No ledger row is ever written; the detector is quiet forever; the next honest cron cycle reconciles cleanly and masks it. Loss is bounded by cap × cycles, but detection is zero.

Fix: a detector over the existing MINT signature scan matching the `sweep_sol_for_swap` discriminator, cross-referenced against the ledger (any on-chain sweep with no ledger row is CRITICAL); plus a per-pass revenue-PDA balance watch.

## 4. HIGH — `governance_timelock_secs` is never read by the alarm, though the code says the alarm asserts it

MINT's `MIN_GOVERNANCE_TIMELOCK_SECS` comment: "⚠️ THE DEPLOYED VALUE MUST BE DAYS. The Bank alarm asserts the live value." `readConfigs` reads MINT fields through offset 353 (`pending_governance_at`) and stops; `governance_timelock_secs` sits at 361. It is in no drift watch and no standing-risk check. A 60-second timelock at initialize deploys silently, and governance rotations then land inside a single 30-minute alarm pass with only after-the-fact `mint.governance` drift detection. This is precisely the class round 6 fixed for `gov.min_voting_secs` — wired there, forgotten here, one field past the last read.

Fix: read offset 361, add to the drift watch, and a standing-risk check `>= days` mirroring `weak_voting_period`.

## 5. MEDIUM — revenue.mjs never reads the on-chain sweep bounds; a rejected sweep leaves a permanent intent row, halts all future cycles, and raises a false CRITICAL

`bank/revenue.mjs` reads offsets 137/221/256/288/253 but never 297 (`max_sweep_lamports`), 305 (`sweep_cooldown_secs`), or 313 (`last_sweep_at`); it uses a hardcoded 50 SOL and no cooldown check. The intent is saved **before** the send. Concrete sequence: cooldown 24h, cron `*/6h`, income arriving during a mint round. 00:41 sweep succeeds. 06:41: amount > 0 → intent saved → on-chain `SweepTooSoon` → throw. The ledger now has an intent-only row; the open-cycle check refuses every future run ("resolve them by hand"); the alarm raises CRITICAL `unreconciled_swap` for SOL that never moved. Same result for `max_sweep_lamports < 50 SOL` or a pause with income present. Recovery means hand-editing the ledger the whole reconciliation rests on, and false CRITICALs train operators to ignore the alarm.

Fix: read the three config values; skip gracefully inside the cooldown; `min(amount, config cap)`; on a definite program rejection (custom error code present — not a timeout), remove the intent row.

## 6. MEDIUM — `sweep_sol_for_swap` has no minimum amount: the cooldown can be reset forever by dust

`require!(amount <= cfg.max_sweep_lamports)` — no floor. A griefer calls `sweep_sol_for_swap(0)` (or 1 lamport) each time the cooldown expires, stamping `last_sweep_at` and starving the legitimate cycle indefinitely for one tx fee per window. SOL accumulates safely in the revenue PDA, but distributions starve, and per finding 3 nothing watches sweep events, so it is silent until someone notices. Fix: a `min_sweep_lamports` config, or don't stamp `last_sweep_at` below it.

## 7. MEDIUM — distribute.mjs crash-window entries (`sig: null`, no `error`) are skipped forever and never surfaced

The intent write before the send is correct, but on resume `if (done[v]) continue` treats an intent-only entry as paid. If the crash happened before the send, that vault is never paid that day and nothing says so — the header claims "a resume can SEE the ambiguity," but the resume code cannot; it just skips. Fix: on every resume, list and notify every `sig === null && !error` entry; optionally verify against the distributor's signature history.

## 8. LOW — revenue.mjs open-cycle predicate re-introduces the truthiness bug the detector fixed

`const open = led.cycles.filter(c => (c.sweptLamports || c.intendedLamports) && !c.returnedSats)` — `!'0'` is false, so a cycle that returned zero sats is "closed" here while the alarm (correctly, post-round-6) treats it as unreconciled. Use `BigInt(c.returnedSats ?? 0) === 0n`, same as `audit()`.

## 9. LOW — `detectBurns` flags ANY instruction to the BURN program as HIGH `burn_via_program`

`initialize` and `update_config` on BURN produce a false "burn" HIGH. Filter by the `burn_vault` discriminator.

## 10. LOW — `BurnConfig` has no version byte

SEAL, MINT and GOV configs all carry a pinned `version` first field; BURN's does not, and the alarm reads it by raw offset (admin@8, collection@40, bank@72). Same silent-misread class round 6 fixed everywhere else. Add `version` and read it.

## 11. LOW — run-tests.sh assertion floor (120) contradicts the advertised suite size (82)

If the suite really makes 82 assertions, the script dies unless `CBOB_MIN_ASSERTIONS` is overridden — and an override that must be set for a green run is exactly the "green run that proves nothing" vector the floor exists to close. One of the two numbers is stale; verify which, and whether the floor is being env-overridden in practice.

## 12. LOW — VoteRecord and Proposal accounts are never closed

~74 bytes plus rent per vote, forever; at 2,100 vaults and many proposals this is hundreds of SOL of locked rent over the system's life. Add a close-back-to-payer after expiry.

# WHAT I TRIED AND COULD NOT BREAK

- **Double voting**: VoteRecord seeded by asset survives transfer, sale, and re-acquisition; second vote fails at `init`. Voting by delegate (Core owner bytes don't change), by the collection (not `KEY_ASSET_V1`), by a burned vault (account gone) — all rejected.
- **execute_proposal**: cannot run twice (`executed` flag, rolled back if the CPI fails), cannot run stale (`EXECUTION_WINDOW_SECS` + `RoundAlreadyOver`), cannot run before voting ends. The CPI into `set_round` is genuinely bounded by MINT: cap > 0, window ≤ 1 year, lifetime `max_supply` enforced independently. No free-forever path through a single proposal.
- **split_revenue**: all three destinations are ATAs derived from config and the revenue PDA — a caller cannot substitute anything. Token program pinned to classic SPL; `TransferChecked` validates decimals against the mint; hostile/frozen mints revert atomically. Rounding verified at the edges: bank floored, holders take the remainder, the two transfers sum to the balance exactly at 1 and at u64::MAX (u128 intermediate).
- **The update_wiring governance gate**: cannot be skipped for treasury/split/operator fields; the armed-then-timelocked governance rotation itself is real (apply is permissionless and bounded, cancel works while admin is honest).
- **set_collection_royalties encoding**: round 6 ran both opcodes against real cloned Core and Core decoded them; `basis_points <= 1000` is enforced; the sole creator is the revenue PDA. The suite's evidence beats my byte-reading; I found no error.
- **SEAL open/close introspection pairing** (program id + discriminator + account positions 0 and 2, in both directions) and **BURN reading reserves from SEAL's config** (offsets and version pin match SEAL's layout exactly).
- **The round-6 alarm cursor rewrite**: per-address cursors, paging to the sentinel, gap-as-finding, no advance over unread or gapped windows — I could not construct a skip.
- **build-mainnet dual-build proof**: sound *provided* `initauth.test.ts` matches on the specific `NotTheInitAuthority` rejection as the banner claims — every program's initialize checks the authority first, so a wrong-key call fails for the right reason; the localnet ACCEPTS control proves non-vacuity in the other direction. I could not see the test file, so this one rests on its assertion string being reason-specific.

# THE SINGLE THING

Fix vote eligibility in GOV before mainnet: stamp a mint index into each vault at creation and require `index <= proposal.quorum_supply` in `cast_vote`. As shipped, "one vault one vote" is "votes are mintable at mint price during any open round" — free during the charter round — and the quorum snapshot, the control advertised as fixing exactly this, does not bound it. It converts the accepted 48% concentration into permanent, total capture of the only thing governance controls: the price strangers pay for the remaining vaults, and with it the entire 85% stream those vaults were promised.