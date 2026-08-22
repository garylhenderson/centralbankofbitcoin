# ROUND 8 AUDIT — FINDINGS

## CRITICAL 1 — GOV: the snapshotted quorum divisor is *stale by design*, so one wallet can ratify anything alone
`programs/cbob-vault-gov/src/lib.rs`, `create_proposal` (`p.quorum_supply = read_mint_config(...).1`) and `execute_proposal` (`need = p.quorum_supply * p.quorum_bps / 10_000`).

Round 6 froze the divisor to stop minting *lowering* the bar mid-vote. It froze the wrong direction. `voting_ends_at` may be up to `MAX_VOTING_SECS` = 30 days out, and `EXECUTION_WINDOW_SECS` adds 7 more.

Exploit, one signer, no code:
1. Immediately after the ~190-vault charter round (`minted_total = 190`), the 21% holder (~40 vaults) calls `create_proposal(opens_at = now, closes_at = now + 364d, price_lamports = 0, cap = 1_911, voting_ends_at = now + 30d)`. `quorum_supply` is stamped at **190**.
2. 30 days later, with 2,100 vaults live, they cast 40 YES votes with their own 40 assets (`cast_vote` reads standing live, so any vault they hold — including ones bought later — works).
3. `execute_proposal`: `need = 190 * 2000/10000 = 38`. `cast = 40 ≥ 38`. `yes_bps = 10000 ≥ threshold`. Passes. `set_round` installs a free, year-long round for the entire remaining supply.

The same defect works forwards: a vault **minted during the voting window** adds a whole vote and *zero* bar, so the snapshot made vote-buying strictly cheaper than the pre-round-6 live read. Round 7 correctly rejected `require(minted_now == quorum_supply)` on liveness — but it stopped there.

Note `execute_proposal` already reads `minted_now` and uses it for **nothing but an event field** — the "assigned and never read" shape this project has burned itself on twice.

**Fix:** `let divisor = max(p.quorum_supply, minted_now); need = divisor * p.quorum_bps / 10_000;`. No liveness break (the bar only rises with real supply), no retroactive rule change to the *percentage*, and the stale-snapshot and mint-inflation attacks both die. Separately cap `MAX_VOTING_SECS` at 14 days.

Mitigating (do not remove): every `mint_vault` still needs the Bank's co-signature, so the free round is only exploitable with the Bank co-signing 1,911 mints. The *legitimacy of every vote* is broken regardless.

---

## CRITICAL 2 — the alarm's completeness check is wired with the wrong argument type and screams CRITICAL on every pass
`bank/alarm.mjs`, both call sites:
```js
D.detectIndexShortfall(cfg['mint.minted_total'], vaults.length, burnt.length)   // main()
D.detectIndexShortfall(cfg['mint.minted_total'], live.length, burnt.length)     // reconcile()
```
`detectors.mjs` signature is `(mintedTotal, liveIds, burntIds)` and round 7 changed the body to `Array.isArray(liveIds) ? liveIds : []`. Numbers are not arrays, so `live.size + burnt.size === 0` **always**, and from the first mint onward every 30-minute pass emits
`index_disagrees_with_chain … returned 0 UNIQUE vaults but the chain says N`.

Two consequences, both bad: (a) the check that protects against a truncated DAS page is **dead**, and (b) the alarm sends a CRITICAL SMS/email every 30 minutes forever, which is how every real finding after launch gets scrolled past. `selftest.mjs` passes because it calls the detector directly with arrays — a textbook case of detectors proven in both directions while the *wiring* is untested. `distribute.mjs` implements the same check inline and gets it right, which is why nobody noticed.

**Fix:** pass `vaults`/`live` and `burnt` arrays. Add one selftest that drives `main()`'s finding list, not just the pure functions.

---

## HIGH 3 — the "one trusted hop is reconciled" claim reconciles the ledger against itself
`bank/detectors.mjs::detectUnreconciledRevenue` / `cycleIsOpen`, `bank/revenue.mjs`.

Round 7 made the *sweep* side chain-derived (`detectUnledgeredSweeps` over the MINT signature scan). The **return** side is still `c.returnedSats` and `c.quotedSats` — both written by `revenue.mjs`, i.e. by the process that holds the swap-operator key, on the box that holds the ledger. An operator-key compromise sweeps 50 SOL, appends `{sweepSig, returnedSats: quotedSats}` and every detector goes quiet. `detectUnledgeredSweeps` does not help: it demands a *row*, and rows are free to whoever owns the file.

Nothing anywhere compares **on-chain SOL out of the revenue PDA** against **on-chain cbBTC into the revenue ATA**. That comparison is the only independent instrument available, and it is cheap.

**Fix:** in the alarm, sum `SolSweptForSwap` amounts from the MINT scan and sum incoming cbBTC transfers to `ata(CBBTC, revenue)` (or track the balance delta plus `RevenueSplit` events), and raise CRITICAL when SOL-out has no chain-visible cbBTC-in within the grace window. Treat `returnedSats` as a hint, never as evidence.

---

## HIGH 4 — SEAL/BURN/GOV admins rotate INSTANTLY; SEAL's admin can replace the Bank co-signer with no notice
`cbob-vaults::update_config` (`if let Some(x) = bank { c.bank = x; }`, `if let Some(x) = admin`), `cbob-vault-burn::update_config`, `cbob-vault-gov::update_gov_config(admin)`.

Round 7's finding was exactly this shape in MINT ("admin rotated INSTANTLY while governance was timelocked") and it was fixed in MINT only. In SEAL — the program whose entire claim is "TRUE 2-of-2, no key can unseal a vault" — a single admin signature sets `config.bank` to an attacker key in one transaction. The attacker is now the Bank: they co-sign `open_for_redemption`/`close_redemption`/`burn_vault` with any owner, and the *only* control left is `detectConfigDrift(['seal.bank', CRITICAL])`, which fires up to 30 minutes later, after the Bitcoin is gone. GOV's admin is worse-shaped still: it is the key that can lower `quorum_bps`, and it rotates in one instruction.

**Fix:** give SEAL, BURN and GOV the same `pending_admin`/`pending_bank` + `apply_*`/`cancel_*` notice period MINT now has. `bank` in MINT's `update_wiring` should join it (it is currently admin-only and untimelocked too).

---

## HIGH 5 — GOV `quorum_bps` is admin-lowerable to 1 with no floor and no notice; and nothing off-chain can see a proposal before it executes
`update_gov_config` (`if let Some(x) = quorum_bps { require!(x > 0 …); c.quorum_bps = x; }`).

Round 7 closed the *atomic* version of this. What remains: hostile admin lowers `quorum_bps` to 1, creates a proposal (which now snapshots `quorum_bps = 1`), waits `min_voting_secs`, votes one vault, executes. `need = supply * 1 / 10000 = 0`. The published defence — "the alarm reads gov.quorum_bps as drift" — is a HIGH once, on the pass it changed, and there is **no standing check** that quorum_bps is sane (`detectStandingRisks` checks `min_voting_secs`, `split_bps`, timelock and sweep bounds, never quorum or threshold).

Compounding it: **nothing watches `gov.proposal_count` or any `Proposal` account.** The watch list contains `gov.last_executed_id` — a *post-mortem*. Holders are told the notice period exists so they can look; the pipeline gives them no notice at all until after `set_round` has landed.

**Fix:** floor `quorum_bps` (e.g. ≥ 1000) and put reductions behind the MINT-style notice period; add `gov.proposal_count` at offset 85 to the drift watch plus a standing risk for `quorum_bps`/`threshold_bps`; ideally fetch open Proposal accounts and report id/price/cap/voting_ends_at every pass.

---

## HIGH 6 — `gov.last_executed_id` is read one byte low
`bank/alarm.mjs::readConfigs`: `['last_executed_id',93,'u64']`.

`GovConfig` order is `… proposal_count(8)@85, bump(1)@93, last_executed_id(8)@94`. Offset 93 reads `bump` as the low byte, so the watched value is `bump + 256*last_executed_id`. Drift still trips (any increment changes it), but the reported number is nonsense in the one report a human reads under pressure, and this is precisely the raw-offset misread the file's own comment says it pinned versions to prevent. Fix: `94`. Also remove the duplicated `['last_sweep_at',313,'i64']` entry.

---

## MEDIUM 7 — deleting `distributions.json` silences the distribution watch *and* re-pays the day
`bank/alarm.mjs`: `if (dist !== null || fs.existsSync(DIST))` — absent file ⇒ `detectDistribution` is never called. `detectDistribution` also gates the missed-day check on `Object.keys(days).length`, so an empty ledger is silent too. Meanwhile `distribute.mjs::load()` treats a missing file as a first run, so today's key is absent and every activated vault is paid a second time. `state.json` got the `.alarm-has-run` marker in round 7; the two money ledgers did not, and the deadman cron watches only `state.json`. **Fix:** one `.has-run` marker per ledger, extend the deadman `find` to all three files, and drop the `Object.keys(days).length` guard.

## MEDIUM 8 — the "load-bearing" Core byte-identity gate is a tautology
`scripts/run-tests.sh` / `build-mainnet.sh`: the validator is booted with `--bpf-program CORE $CACHE/core-mainnet.so`, then the script dumps Core from that validator and `cmp`s it **against the same file**. It cannot fail for the reason it claims to guard. The only validation of the cache is four bytes of ELF magic, and `$CACHE` defaults into world-writable `/tmp` (as do `/tmp/cbob-mn`, `/tmp/cbob-ln`, wiped-then-recreated, symlink-racable). A mock Core planted in the cache produces a green run whose banner says "verified byte-identical to mainnet". **Fix:** pin the mainnet Core sha256 as a constant in both scripts and compare the cache to it; move caches under `/opt/cbob-vaults/.cache`.

## MEDIUM 9 — the assertion floor and the suite disagree
`run-tests.sh`: `MIN_ASSERTIONS=160`, hardcoded and unoverridable. The suite is described as 82 assertions. Either the floor can never be met — in which case nobody is running this gate and the green baseline comes from invoking `tsx` by hand, the exact "green run that proves nothing" this file exists to stop — or the documentation is wrong. Reconcile them, and hash `tests/3prog.test.ts` into the run so the floor cannot be reached by padding.

## MEDIUM 10 — `sol_reserve_lamports` has no rent floor; a legal config wedges every sweep
MINT `initialize`/`update_wiring` accept any `sol_reserve_lamports`, and `sweep_sol_for_swap` permits draining the revenue PDA to exactly `keep`. For `0 < keep < 890_880` the system transfer leaves a rent-paying account and the runtime rejects the transaction; `revenue.mjs` marks `sendRejected`, throws, and does so again every 6 hours forever. Require `keep == 0 || keep >= 890_880`.

## MEDIUM 11 — the swap operator has no SOL float, so the returned cbBTC strands
`revenue.mjs` sweeps `balance - reserve` and then swaps *all* of it (`amount` in the Jupiter quote). Fees for the swap, the return transfer, the two idempotent ATA creations and the split come from the operator's own balance, which nothing checks or funds. First cycle on a fresh operator: SOL swept, cbBTC bought, return transfer fails on insufficient funds, cycle open, CRITICAL. Check `getBalance(operator) >= floor` before sweeping and reserve a fee slice out of `amount`.

## MEDIUM 12 — irreversible admin-only ratchets that end the business
`gov.threshold_bps` may be ratcheted to 10000 (unanimity of cast votes ⇒ governance permanently dead ⇒ no round can ever be set again, since `set_round` has no other caller); `gov.min_voting_secs` to 30 days; `mint.max_supply` down to `minted_total` (sale over, permanently); `mint.governance_timelock_secs` up to 30 days. Each is one admin signature, none is reversible, none is timelocked. "Ratchets in the safer direction" ignores that maximum safety is deadlock. Cap `threshold_bps` at e.g. 7500 and put these behind the notice period.

## LOW 13 — comments the code does not honour
`MintConfig.split_bps` doc still claims "so the royalty plugin can express the same number" — `update_wiring`'s own comment says that mechanism does not exist. `MintError::BadSweepBound` says "cooldown must be between 0 and 7 days"; the floor is 1. `GovError::QuorumNotMet` says "against live vault supply"; it is snapshotted. `set_collection_royalties`' doc says governance must sign "BEFORE" the GOV PDA takes over — after that, royalties are unchangeable except by a full rotation, which is a launch-order landmine worth putting in a runbook, not a doc comment.

**Audit gap:** `bank/lock.mjs` was not supplied, yet `withLock`, `readLedger` (corrupt ⇒ throw) and atomic `writeLedger` carry the no-double-pay property and the alarm reads `distributions.json` *outside* the lock. That file must be reviewed before this holds money.

---

# WHAT I TRIED AND COULD NOT BREAK

- **SEAL open/close pairing.** Interleaving `open(X) open(X) close(X)` nets to frozen; `close` before `open` fails `NoPrecedingOpen`; `open` with a trailing `open` fails `NoTerminalClose`; the owner is bound positionally at account 2. The asymmetry (close doesn't re-bind the owner) is covered by close's own `owner` signer + asset-owner check.
- **`split_revenue` arithmetic.** `bank_cut` floors, `holders = total - bank_cut`; at `total = 1` the holder gets it; the two legs sum exactly at every value I tried including `u64::MAX`; all three ATAs are address-derived from config, the token program is `address`-pinned, and `decimals` is validated by TransferChecked. Destinations cannot be supplied by the caller.
- **`sweep_sol_for_swap` pin.** Destination comes from `cfg.swap_operator` (the `Signer` is only compared to it), `amount > 0`, `≤ max_sweep_lamports`, `now ≥ last_sweep_at + cooldown` with a floor of 1 so two sweeps in one transaction cannot share a timestamp. I could not find a loop, a fee-sized drain, or a caller-supplied destination.
- **`set_collection_royalties` bytes.** Checked against Core's real layout: discriminants 3/7 are AddCollectionPluginV1/UpdateCollectionPluginV1, `Plugin::Royalties = 0`, `basis_points: u16` LE, `Vec<Creator>` as `u32` len + `Pubkey` + `u8`, `RuleSet::None = 0`, and `AddCollectionPluginV1Args.init_authority: Option<_>` as the trailing `0`. The `if add { push(0) }` asymmetry is correct because Update carries no authority. I found no wrong byte. `basis_points ≤ 1000` and a single 100% creator at the revenue PDA cannot redirect the creator share.
- **GOV double-voting.** VoteRecord at `["vote", proposal, asset]` defeats transfer-then-revote, delegates (owner bytes only), the collection itself, and burned vaults (closed account ⇒ `NotACoreAsset`). Non-vault assets cannot be in the collection because the collection's update authority is MINT's PDA. Execution is `!executed` + monotonic `last_executed_id` + expiry + `closes_at > now`. `Proposal`/`GovConfig`/`VoteRecord` space arithmetic is exact.
- **MINT config offsets.** All 27 field offsets the alarm, GOV and `revenue.mjs` read by hand agree with `MintConfig`'s declaration order and the declared `space` (409 bytes). SEAL's and BURN's do too. Only GOV's `last_executed_id` is wrong (finding 6).
- **`distribute.mjs`** double-pay paths: plan durable before the first transfer, intent before send, `paymentState` three-valued, lock, exact index agreement, SOL floor scaled to outstanding vaults. The remaining risk is liveness — any DAS lag during a mint round aborts the whole day's payout — not a double payment.

---

# THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Make the quorum divisor `max(p.quorum_supply, minted_now)` in `execute_proposal`.** `minted_now` is already read and currently thrown away in an event field. Without it, a proposal created early is a bearer instrument that lets one 21% holder — or anyone who mints during a 30-day window — ratify the price strangers pay for the remaining 1,911 vaults, alone.