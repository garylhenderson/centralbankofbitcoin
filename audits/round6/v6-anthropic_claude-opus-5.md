# ROUND 6 — FINDINGS

## 1. CRITICAL — `cron-install.sh` de-dupe pattern never matches; re-running installs duplicate jobs, and duplicate `distribute.mjs` pays every vault twice

`crontab -l | grep -v 'cbob-vaults/bank' > "$TMP"` is supposed to make the install idempotent. The lines it writes are `cd /opt/cbob-vaults && /usr/bin/node bank/alarm.mjs …`. The substring `cbob-vaults/bank` **does not appear** in that line (there is ` && /usr/bin/node ` between them). So `grep -v` removes nothing and every re-run appends a fresh copy of all three jobs, plus the comment block.

Exploit (no attacker needed — an operator re-running the installer): after the 2nd install, two `distribute.mjs` processes start at 09:07. Both `load()` the same `distributions.json` with `done = {}`, both compute `per = available / N`, both send a `TransferChecked` to every activated vault → **every vault paid twice**, distributor overdrawn or drained, and `save(st)` from the two processes clobbers each other so the day's ledger under-records what was paid (enabling a *third* payment on a manual re-run). `distribute.mjs` has no `flock`, no PID file, and no on-chain idempotency — the "one distribution per UTC day" guard is a read-then-write race by construction, and the installer makes the race certain.

Fix: dedupe on a stable marker (`grep -v 'CBOB-CRON'` with that tag in each line), and put `flock -n /opt/cbob-vaults/bank/.dist.lock` in front of the money-moving jobs. Add an `exec` lock inside `distribute.mjs` itself; never trust the crontab.

## 2. CRITICAL — the only reconciliation of the trusted hop is a self-reported local file with four independent silencers

`detectUnreconciledRevenue` is the *entire* control over the SOL→cbBTC hop. Each of these makes it go quiet on a real loss:

- **`if (c.returnedSats) continue`** — `returnedSats` is written as a **string**. `String(0n) === '0'`, which is **truthy**. A swap that returned nothing (`got = 0n`, empty operator ATA) marks the cycle *reconciled*. `audit()` uses the same truthiness.
- **`if (!c.sweptLamports) continue`** — `revenue.mjs` pushes the cycle and `save()`s **before** the sweep, then sets `sweptLamports` **after** `sendAndConfirmTransaction`. A confirmation timeout on a transaction that actually landed (routine on Solana) leaves a cycle with no `sweptLamports` → skipped forever. SOL gone, alarm silent.
- **No value check.** Return 1 sat against a 50 SOL sweep and both `--audit` and the detector read clean. The quote (`quotedSats`) is recorded and never compared to `returnedSats`.
- **`try { …read ledger… } catch { /* no ledger yet is not a finding */ }`** in `alarm.mjs`. `rm revenue-ledger.json` and the revenue watch disappears — in a file whose header says "A read that fails is an ALARM, never a pass."

Exploit: the operator (or anyone who has the box) sweeps, keeps the SOL, writes `returnedSats:"0"` — or just deletes the file. Report line prints "no approvals, no unexpected PDA token accounts, no burns, no deactivations, no config drift."

Fix: reconcile from **chain**, not from the operator's file — enumerate `SolSweptForSwap` events / the revenue PDA's lamport history and cbBTC credits to the revenue ATA, and require `returnedSats × price ≥ sweptLamports × (1 − slippage)`. Treat a missing ledger, a non-positive `returnedSats`, and any sweep without a ledger row as CRITICAL.

## 3. HIGH — `sweep_sol_for_swap`: the 50 SOL cap is JavaScript, not a rule; the destination cannot be rotated

On-chain the only bound is `bal >= sol_reserve_lamports + amount`. `MAX_PER_CYCLE_LAMPORTS` lives in `revenue.mjs` only. Since the instruction is permissionless and takes no signer, **anyone** can, at any moment, move the entire revenue balance above the reserve into a hot keypair on the box — no ledger row is written, so finding #2 keeps it silent. Worse, `revenue.mjs` never checks for an open unreconciled cycle before sweeping: with the `41 */6` cron set `--live`, four failed cycles a day sweep four times, so exposure is unbounded, not "one cycle's worth".

Compounding: `swap_operator` and `sol_reserve_lamports` are set in `initialize` and **appear in no update path**. A compromised operator key cannot be rotated; the only mitigation is `set_paused` (which also halts the sale). `detectConfigDrift` watches `mint.swap_operator` as CRITICAL — a value that can never change.

Fix: enforce the per-call cap and a minimum interval (last-sweep slot in config) on-chain; refuse to sweep while a prior sweep is unmatched; make `swap_operator`/`sol_reserve_lamports` rotatable under admin+governance.

## 4. HIGH — a mid-run distribution failure is permanent and unequal

Any single failing `sendAndConfirmTransaction` (blockhash expiry, RPC blip, a **frozen** destination ATA — cbBTC has a live freeze authority) throws out of the loop, exits 3, and the remaining vaults never receive that day's share: the cron is daily, `done[v]` only protects *within* the same UTC day, and nothing re-runs. The `sol < 5_000_000` pre-check funds ~1000 transfers for ~2100 vaults, so the run can be designed to stop halfway. The header's claim "a crash halfway resumes instead of redoing" is false in production — there is no resume trigger. Also: no per-vault `try/catch`, so one bad vault denies all others.

Fix: per-vault try/catch that records failures and continues; a completion check that re-runs unfinished days; require `sol ≥ 5000 × activated.length × 2`.

## 5. HIGH — the admin key alone can capture governance, then mint the remaining supply free

`update_wiring` gates `treasury | bank_treasury | split_bps` behind the governance signature, but `if let Some(x) = governance { c.governance = x; }` is gated by **admin only**. Admin sets `governance = <own key>`, calls `set_round(now, now+1y, price 0, cap 1911)`, and with the Bank co-signature mints the entire remaining supply to itself. Consequences are not cosmetic: every vault is one equal share of the daily cbBTC distribution **forever** and one vote, so this converts one admin action into ~91% of all future holder revenue and permanent voting control. The same is reachable by a ratified vote (top-3 hold ~48% of the 190 charter votes and quorum is a fraction of 190): MINT bounds the window and the cap but **not the price**, and there is no per-owner mint limit. The only brake is the Bank's discretionary co-signature on each `mint_vault`, which is written down nowhere as a policy.

Fix: `governance` rotation requires the current governance signature too (or a timelock). Bound zero-price rounds to the charter phase — e.g. `require!(price_lamports > 0 || cfg.minted_total + cap as u64 <= 190)` — which does not re-litigate R6, and add a per-round per-owner cap.

## 6. HIGH — quorum is measured against ever-minted, not live supply, and vaults minted *during* a proposal can vote on it

`minted_total` never decrements. Every burned vault permanently inflates the quorum divisor while removing a voter, so enough burns make governance **unreachable forever** — and `GovConfig` has no update instruction, so `quorum_bps` cannot be retuned. The header's "QUORUM IS MEASURED AGAINST LIVE SUPPLY" is not what the code does.

Conversely, standing is read at vote time with no snapshot, so a vault minted after `create_proposal` votes on it. During any open round, voting power is purchasable at the round price by the people voting on that price; because `quorum_bps < 10_000`, each new vault adds a full vote but less than a full vote of quorum requirement — so **minting mints quorum**. Fix: snapshot `minted_total` and reject assets whose creation slot is after proposal creation (or bind eligibility to a `VoteRecord`-free asset that existed at proposal time), and add a governance-config update path.

## 7. HIGH — `alarm.mjs` transaction scan is structurally blind

- `let newest = prev?.lastSignature || null; … if (!newest && sigs.length) newest = sigs[0].signature`. After the first run `newest` is always truthy, so **the cursor never advances again**. Every pass re-scans from the same ancient marker.
- One cursor is used as `until` for **five different addresses**. A signature that touched MINT is not in CORE's history, so the marker is never reached.
- `limit: 200`, no pagination, against **mainnet Metaplex Core**, twice an hour. Core sees thousands of transactions per minute; 200 signatures is seconds of history. `detectBurns`'s `bare_core_burn` — the only watcher over the one attack the design admits it cannot prevent — will essentially never see anything.
- `detectPdaTokenAccounts` can never fire for its stated purpose: creating a token account owned by a vault PDA requires **no** signature from the PDA and no involvement of SEAL/MINT/BURN/GOV/Core, so such a transaction is never fetched.

Fix: per-address cursors, paginate to exhaustion, drop the global Core scan in favour of per-vault-PDA and per-asset signature scans (plus a periodic `getTokenAccountsByOwner` reconcile, which is the only complete method available).

## 8. HIGH — no detector sees a partial drain, and none sees a program upgrade

`detectDeactivations` fires only below 21,000 sats. A vault holding 1 BTC drained to 21,000 sats — 99.98% of a customer's Bitcoin — is silent, and balances are not even persisted so the check cannot be written without changing `state.json`. Given a resale buyer's entire basis is "this vault still contains its reserve", *any* decrease must alarm. Separately, nothing watches the four upgrade authorities or program hashes: an upgraded MINT that repoints revenue leaves `detectConfigDrift` quiet. Fix: persist balances, alarm on any decrease; snapshot `programdata` hash + upgrade authority for all four programs and alarm on change.

## 9. HIGH — alarm state advances before delivery; no heartbeat

`writeState(...)` runs before `report()`. A CRITICAL config drift whose `notify` fails (script missing → `execFileSync` throws → `console.error` into `/tmp/cbob-alarm.log`, `exitCode = 2`) is written into the new baseline and **never mentioned again**. In the top-level catch the notify failure is swallowed entirely. Nothing anywhere asserts "the alarm ran": a permanently crashing alarm looks exactly like a quiet one. Fix: persist unresolved findings and re-emit until acknowledged; write a heartbeat file/URL and alarm externally on its staleness.

## 10. MEDIUM — `build-mainnet.sh` does not prove what it claims

(a) `ask()` deploys **only `cbob_vault_mint.so`**; SEAL, BURN and GOV mainnet artifacts are never interrogated, yet the closing banner asserts the Squads key for all of them. (b) `CARGO_TARGET_DIR=/tmp/cbob-mn` is never cleaned and `… | grep -E "^error" -A5 && die` only fires on lines starting `error`; a build that dies otherwise (OOM kill, missing toolchain) leaves the *previous* run's `.so` in place, which is then copied to `dist/` and its sha256 printed as "VERIFIED. Deploy these bytes and nothing else." (c) "REJECTS" is satisfied by *any* failure of that test — a mainnet build that rejects every key passes. Fix: `rm -rf` both target dirs, check `$?` explicitly, record `git rev-parse HEAD` + `git status --porcelain` in the artifact manifest, run `ask` for all four programs, and assert the exact `NotTheInitAuthority` error code plus a third random key being rejected by *both* builds.

## 11. MEDIUM — dead levers and dead detectors

`GovConfig.admin` is assigned and never read; there is no gov update instruction at all, so `min_voting_secs`, `quorum_bps`, `threshold_bps` are frozen at genesis. If GOV ships with the 60-second floor to make the tests pass, it **can never be raised** and `detectStandingRisks` will emit `weak_voting_period` HIGH forever — alarm fatigue on an unfixable condition. `detectConfigDrift`'s watches on `gov.*` and `mint.swap_operator` can never fire. `cast_vote`'s `!executed` check is unreachable (execute requires `now >= voting_ends_at`, voting requires `now <`).

## 12. MEDIUM — `execute_proposal` is permissionless with no expiry

Anyone may execute a passed proposal at any later time. A ratified proposal can be banked and fired months later to overwrite a live round, reset `minted_this_round = 0`, and reinstate a stale price/window that nobody is watching. Fix: an execution deadline (`voting_ends_at + N`) after which the proposal is dead, and a short timelock between ratification and effect.

## 13. LOW/MEDIUM — comments the code contradicts

- "integer division can never round in the Bank's favour" — `holders = floor(total·8500/10000)`, `bank = total − holders = ceil(total·0.15)`. The Bank takes the remainder **every time**; at `total = 1` the Bank takes 100%.
- `split_bps % 100 == 0` is justified as "so the royalty plugin can express it", but `set_collection_royalties` hardcodes `push(100)` for the single creator and never derives anything from `split_bps`. A live constraint on governance defended by a mechanism that does not exist.
- `basis_points` is bounded only by `<= 10_000`: admin+gov can set a 100% royalty, which ends resale — the thing the whole vault thesis depends on. Bound it (≤1000).
- Keys at `/opt/cbob-vaults/bank/keys/*.json` are read as plaintext with no mode check on a box hosting ~19 other cron jobs and PM2 apps; logs and the logrotate target live in world-writable `/tmp` under a root-run logrotate.
- `run-tests.sh` deploys four programs but defaults to `tests/3prog.test.ts`, and asserts no assertion count — a suite that silently skips GOV still reads green.

# WHAT I TRIED AND COULD NOT BREAK

- **The `set_collection_royalties` byte encoding.** I checked it against Core's layout: instruction 3 = `AddCollectionPluginV1`, 7 = `UpdateCollectionPluginV1` (consistent with 6/12/20 used elsewhere, which the suite exercises); `Plugin::Royalties` = 0; `Royalties { basis_points: u16 LE, creators: Vec<Creator>, rule_set }`; `Creator { address: Pubkey, percentage: u8 }` summing to 100; `RuleSet::None` = 0; and `Option<PluginAuthority> = None` = `0` present for Add and absent for Update. The account list (collection, payer, authority, system, program-as-None-log-wrapper) matches the pattern SEAL already proves on a validator. I found **no wrong byte**. The risks are semantic (#13), not encoding.
- **`split_revenue` destination substitution.** `holders_ata`/`bank_ata`/`revenue_ata` are re-derived from `cfg.treasury`, `cfg.bank_treasury` and the revenue PDA; `token_program` is pinned; the caller-supplied `mint` is bound by the ATA derivation and by `TransferChecked`. I could not redirect a lamport. Balance 0 → `NothingToSplit`; a fake `mint` → the derived source ATA does not exist → revert.
- **Double-voting.** `["vote", proposal, asset]` holds across transfers; no close instruction exists on `VoteRecord` or `Proposal`, so there is no re-init path. Collections cannot vote (`data[0] != 1`); a burned asset cannot be read.
- **Re-executing a proposal**, and `set_round` past `max_supply` — `minted_total < max_supply` is checked per mint and `max_supply` ratchets down only.
- **Farming the distribution by shuttling one activation deposit** — cbBTC cannot leave a vault without the Bank's co-signature, so 21,000 sats cannot be recycled across vaults during the read loop.
- **Sweeping the revenue PDA below rent-exemption** — it is a data-less system account; a zero balance is recoverable by the next payment.
- SEAL: no new finding.

# THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

**Make the trusted hop verifiable from chain and bound on chain: enforce the 50 SOL cap plus a minimum interval inside `sweep_sol_for_swap`, refuse to sweep while a prior sweep is unmatched, and rebuild reconciliation from `SolSweptForSwap` events and cbBTC credits instead of a JSON file the sweeper writes** — because today anyone can move the entire revenue balance into a hot key at will, and every one of the four ways that ledger can be made to lie (`'0'` is truthy, a lost `sweptLamports`, no value check, a deleted file read as "not a finding") ends in the same printed line: *no config drift*.