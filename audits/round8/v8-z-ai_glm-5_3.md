# ROUND 8 — FINDINGS

## F1. CRITICAL — Deleting `distributions.json` silently re-pays every activated vault, and the alarm watches nothing

**Construct:** `bank/alarm.mjs`:
```js
if (dist !== null || fs.existsSync(DIST)) { ...detectDistribution... }
```
When the file is *absent*, the entire distribution watch is skipped — no `distribution_ledger_unreadable`, no `distribution_missed`. The comment above it claims "one that existed and vanished is caught by the same marker that guards state.json" — **no such marker exists for this file.** `CBOB_ALARM_EVER` guards only `state.json`; the deadman cron in `cron-install.sh` watches only `state.json`. Meanwhile `bank/distribute.mjs` — `const load = () => readLedger(STATE, { days: {} })` — treats a missing ledger as a first run (its own selftest asserts this).

**Exploit (no adversary required):** `rm /opt/cbob-vaults/bank/distributions.json` — operator error, disk cleanup, partial restore; same uid as the signing keys. Next alarm pass: the block is skipped, zero findings. Next 09:07 run: fresh ledger, every activated vault reads `unpaid`, the full daily amount is transferred **again**. Deterministic double payment of customer money, in silence. Note the asymmetry: a *corrupt* file raises CRITICAL (`existsSync` true → `detectDistribution(null)`); only *deletion* is quiet — and deletion is the easier accident. This is the round-7 `state.json` defect relocated to the one ledger that moves money daily.

**Fix:** mirror the state.json pattern for both money ledgers — `.dist-has-run` / `.revenue-has-run` markers; the alarm raises CRITICAL when a ledger is missing but its marker exists; `distribute.mjs` and `revenue.mjs` refuse to run in that state. (Revenue-ledger deletion is already caught by the alarm's unconditional call, but `revenue.mjs` still treats missing-as-fresh and could sweep before the 30-minute pass fires.)

## F2. HIGH — The swap's RETURN leg is reconciled only against the ledger the operator key's own process writes

Round 7 chain-anchored the *sweep* leg (`detectUnledgeredSweeps` reads sweeps off MINT's signature scan). The *return* leg is still self-attested: `detectUnreconciledRevenue` trusts `returnedSats`/`quotedSats` from `revenue-ledger.json`, written by `revenue.mjs` as the same user that holds `keys/swap-operator.json`. Nothing in `alarm.mjs` reads the revenue PDA's cbBTC ATA, and no detector verifies that a "returned" cycle has an on-chain return or split.

**Exploit:** holder of the operator key sweeps 50 SOL (on-chain, capped, ledgered — `detectUnledgeredSweeps` satisfied), keeps the SOL, then writes `returnedSats` ≈ `quotedSats` into the ledger. `cycleIsOpen` → false; the shortfall check passes; the alarm is quiet. Repeat every cooldown, indefinitely. This is verbatim round 7's own rationale — "the ledger is the audited key's own testimony" — applied to the other half of the hop. The pure remote key-thief is still caught after one cycle; this defeats the reconciliation entirely.

**Fix:** the alarm already fetches every MINT transaction — match the `split_revenue` discriminator too, and require every cycle with `returnedSats > 0` to carry a `splitSig` that (a) appears in the scan and (b) whose `RevenueSplit` total ≈ `returnedSats`; optionally fetch `returnSig` and verify it moves that amount into the revenue ATA.

## F3. MEDIUM — A fourth copy of the open-cycle predicate survives in `revenue.mjs`'s `audit()`, and it disagrees with the canonical one

Round 7's note says "There is now ONE exported `cycleIsOpen`." But `audit()` still filters with `(c.sweptLamports || c.intendedLamports) && BigInt(c.returnedSats ?? 0) === 0n` — which does **not** exclude `sendRejected` cycles. A sweep the program refused (the exact case `sendRejected` was added for) is counted by `audit()` as "swept but NOT returned", printed as unaccounted lamports, and sets `process.exitCode = 1` — on every subsequent live cycle's closing `audit()` and every manual `--audit`, forever, while `main()`'s guard (which imports `cycleIsOpen`) correctly ignores it. No funds risk; a permanent false ">>> UNRECONCILED" is the crying-wolf this codebase explicitly refuses to ship. **Fix:** `l.cycles.filter(cycleIsOpen)`; delete the inline predicate.

## F4. MEDIUM — Two tightening moves are still gated behind the governance signature the production wiring cannot produce

`update_wiring`'s `needs_governance` includes `sol_reserve_lamports.is_some()` and `governance_timelock_secs.is_some()` **unconditionally**. In production `config.governance` is the GOV PDA, which can only sign a `set_round` — neither field is reachable without the rotate-governance-away-and-back dance through the *current* timelock. This is the identical class to round 7's own finding ("a control that cannot be used in the emergency it exists for"), and it falsifies the code's own comment: `MIN_GOVERNANCE_TIMELOCK_SECS` claims the timelock "can be RAISED after the fact, so a floor set by mistake at launch is fixable" — in production it is not, and a launch at the 60-second floor means a permanent standing CRITICAL whose only remediation runs through the 60-second timelock itself. **Fix:** apply the direction split — *raising* either value is admin-only; lowering stays governance-gated.

## F5. MEDIUM — Quorum is snapshotted at creation while standing is read at vote time

`create_proposal` snapshots `quorum_supply = minted_total`; `cast_vote` accepts any collection vault that exists *now*. A proposal created early keeps a small absolute bar while the voteable population grows. Concrete: charter phase, supply ≈ 190, `quorum_bps` 3,000 → need = 57. A one-vault holder creates a proposal with a 30-day window; public rounds take supply to ~2,100; the attacker acquires 57 vaults at the public price, votes YES (100% of cast), executes inside the window — a ratified round (e.g. `price_lamports = 0`) carried by 2.7% of live supply, forgoing the holders' 85% of ~1,900 mint fees. Mitigations that exist: the 37-day outer bound, and `price_lamports`/`round_id` drift is CRITICAL — both after the fact. The on-chain fix is genuinely unavailable (Core assets carry no creation timestamp), and the charter top-3 can already do this at zero cost — so this is a conscious-risk item: accept it in writing, or add a standing alarm flagging any live round priced at 0 once `minted_total` exceeds the charter count.

## F6. LOW — `alarm.mjs` reads `gov.last_executed_id` at offset 93; the field is at 94

`GovConfig` serializes `proposal_count` (85..93), `bump` (93), `last_executed_id` (94..102) — the Initialize space expression `8+1+32+32+2+2+8+8+1+8` confirms the order. The read at 93 returns `bump | (last_executed_id mod 2⁵⁶) << 8` — garbage. Drift detection still fires on execution (low bytes shift), so nothing is currently missed, but the watched value is wrong and the map beside it is the trap the GOV header itself warns about. Fix: offset 94.

## F7. LOW — TOCTOU false CRITICAL on unledgered sweeps

`led` is read once at pass start; a sweep that lands and is ledgered between that read and the MINT scan reports `unledgered_sweep` falsely. Re-read the ledger before emitting this finding.

## F8. LOW — No standing cross-check that the four configs' `collection` fields agree

`gov.collection` is set once at initialize, has no setter, and is in no watch list. A fat-fingered GOV initialize would accept votes from foreign assets forever, silently. One standing assertion (`seal == mint == burn == gov`) closes it.

## F9. LOW — `sol_reserve_lamports` is unbounded at initialize (0 is legal)

With `keep = 0`, `sweep_sol_for_swap` can take the revenue PDA to exactly 0 lamports, deleting the account; below rent-exemption it can be garbage-collected. Config hygiene; fold into F4's direction split.

## F10. LOW — The assertion floor (160) exceeds the suite count this audit was told (82)

One of the two is stale. If the runner is currently red, the predictable "fix" is lowering the floor — the exact failure round 7 closed. Reconcile before launch.

Also noted: `bank/lock.mjs` is load-bearing for every double-pay protection here and is not in the reviewed set.

---

# WHAT I TRIED AND COULD NOT BREAK

- **`split_revenue` pinning:** all three ATAs re-derived from config and the revenue PDA; token program address-pinned; `TransferChecked` validates mint and decimals; the two transfers sum to `total` exactly with the Bank floored (checked at total = 1 and through the u128 path). A hostile mint only splits hostile tokens to the pinned destinations.
- **`sweep_sol_for_swap`:** destination is both config-pinned *and* the required signer; cap, cooldown and reserve are on-chain with checked arithmetic; the round-7 grief handle is closed by `amount > 0` plus the signer.
- **Double voting:** the asset-seeded VoteRecord survives transfers; burned vaults fail the asset parse; PDA owners cannot sign. Execute is idempotent (`executed` set before CPI), monotonic, windowed, refuses dead rounds, and the tally reads **only** snapshot fields — I confirmed no config value is read at execute time.
- **`distribute.mjs` double-pay protections:** lock + intent-before-send + `paymentState` + plan-fixed-per-day + exact unique-id agreement with `minted_total`. The one liveness cost (a definitively-failed transfer stays "ambiguous" until a human acts) is deliberate and loud.
- **The alarm's scan discipline:** per-address cursors, gap-as-finding, unreadable-tx-as-finding, report-before-state, undelivered-alert baseline reversion — I could not construct a quiet skip.
- **`set_collection_royalties` encoding:** re-derived the Borsh layout (Plugin variant 0, u16 bps, u32-length Vec<Creator>, Creator{32-byte address, u8 percentage}, RuleSet variant 0, trailing Option tag on Add) — matches, and round 6 exercised both opcodes against real Core.
- **`build-mainnet.sh`:** the two-direction INIT_AUTHORITY proof fails closed on any unexpected verdict line, and the banner states exactly what the behavioural arms cannot prove.
- **Activation farming:** activating costs 21,000 sats of recoverable capital plus the mint price; 500 vaults taking 500 shares is the stated business, not a bypass — but the dilution economics deserve a conscious sign-off.

---

# THE SINGLE THING

Close the deletion path on the distribution ledger (F1): a missing `distributions.json` must be a loud refusal in **both** `alarm.mjs` and `distribute.mjs`, exactly as a missing `state.json` already is. It is the only defect here that double-pays customers with no adversary, no key, and no alarm — one `rm` away.