

FINDINGS

1) HIGH — Permissionless sweeps can bypass the revenue ledger and the alarm  
File: `programs/cbob-vault-mint/src/lib.rs` (`sweep_sol_for_swap`), `bank/alarm.mjs`, `bank/detectors.mjs`  
`sweep_sol_for_swap` is signerless and destination-pinned. The alarm’s only swap reconciliation is `detectUnreconciledRevenue(ledger)`, which reads `bank/revenue-ledger.json`. The signature scan fetches MINT transactions but never detects `sweep_sol_for_swap` instructions or `SolSweptForSwap` events. `mint.last_sweep_at` is read by `readConfigs` but is not in `detectConfigDrift`’s watch list.  
Exploit: anyone (fee payer only) calls `sweep_sol_for_swap` when cooldown permits. SOL moves to the pinned operator. No ledger row exists. If the operator key is compromised, the attacker can trigger or wait for a sweep, then sign the operator key to drain the SOL. The alarm stays quiet because the ledger omits the sweep. Even an honest manual sweep is invisible.  
Fix: alarm must parse every MINT transaction for the `sweep_sol_for_swap` discriminator / `SolSweptForSwap` event and require a matching ledger row by signature/amount; treat any unmatched on-chain sweep as CRITICAL. Add `mint.last_sweep_at` to drift/standing checks. `revenue.mjs --audit` should reconcile on-chain sweep events, not just the local ledger.

2) HIGH — `revenue.mjs` still treats a recorded return of `'0'` as reconciled  
File: `bank/revenue.mjs`, `main()` open-cycle guard  
```js
const open = (led.cycles || []).filter(c => (c.sweptLamports || c.intendedLamports) && !c.returnedSats)
```
`returnedSats` is stored as `String(got)`. If `got === 0n`, `returnedSats === '0'`, which is truthy, so `!c.returnedSats` is false. The cycle is treated as closed.  
Exploit: sweep lands, swap fails or returns nothing, step 3 records `returnedSats: '0'`, then `split_revenue` fails. Next run does not refuse to start a new cycle, so fresh SOL can be swept on top of an unreconciled zero-return cycle. `audit()` uses `BigInt(...) === 0n`, but the live guard does not.  
Fix: use `BigInt(c.returnedSats ?? 0) === 0n` in the open-cycle filter, same as the detector and audit.

3) HIGH — Alarm advances scan cursors even when alert delivery fails  
File: `bank/alarm.mjs`, `main()` state write after `report()`  
If `report()` returns false (urgent finding plus notify failure), the code reverts `config`, `activation`, and `balances` baselines but still writes `cursors` and `vaults`.  
Exploit: a CRITICAL transaction finding (approve, burn, PDA token account) occurs; SMS/email fails. The cursor for that program is advanced, so the transaction is never re-scanned and the finding is not re-reported. Only config drift is re-reported.  
Fix: if `delivered === false`, do not advance cursors, or persist undelivered findings and replay them next pass.

4) HIGH — GOV proposal/vote PDAs are griefable by pre-funding  
File: `programs/cbob-vault-gov/src/lib.rs`, `CreateProposal`, `CastVote`  
Proposal PDA: `["proposal", (proposal_count + 1).le_bytes]`. VoteRecord PDA: `["vote", proposal, asset]`. Anchor `init` fails if the PDA already holds lamports.  
Exploit: attacker reads `gov.proposal_count`, sends rent-exempt lamports to the next proposal PDA. `create_proposal` fails and `proposal_count` does not increment, so all proposal creation is blocked until program upgrade or a special skip instruction. Similarly, attacker can pre-fund vote PDAs for specific vault/proposal pairs to deny votes. Cost ~0.0009 SOL per blocked PDA.  
Fix: add an admin instruction to skip blocked proposal IDs, or use proposer-signed keypair accounts for proposals, or otherwise avoid predictable permissionless-init PDAs. For votes, consider a program-specific reclaim/override path; current PDAs can be permanently blocked.

5) MEDIUM — GOV executes against live `quorum_bps`, allowing post-vote quorum lowering  
File: `programs/cbob-vault-gov/src/lib.rs`, `execute_proposal`  
`quorum_supply` is snapshotted, but `ctx.accounts.config.quorum_bps` is read at execute. `update_gov_config` allows admin to lower `quorum_bps`.  
Exploit: proposal ends with votes below the original quorum. Admin lowers `quorum_bps`; anyone executes and the proposal passes. This is immediate, unlike governance rotation timelock.  
Fix: snapshot `quorum_bps` and `threshold_bps` into `Proposal` at creation, or use the parameters at `voting_ends_at` and forbid applying lowered quorum to already-created proposals.

6) MEDIUM — `mint.governance_timelock_secs` is not read or alarmed despite comment  
Files: `programs/cbob-vault-mint/src/lib.rs`, `bank/alarm.mjs`, `bank/detectors.mjs`  
MINT comment says the Bank alarm asserts the live governance timelock. `readConfigs` stops at `pending_governance_at` (offset 353) and never reads `governance_timelock_secs` (offset 361). No detector checks it.  
Exploit: production is initialized with the 60s floor. Admin arms governance rotation, applies after 60s. No alarm fires.  
Fix: read offset 361, add `mint.governance_timelock_secs` to drift and standing risks, and require a production minimum (days) in `detectStandingRisks`.

7) MEDIUM — Zero-amount sweep can DoS the sweep cooldown  
File: `programs/cbob-vault-mint/src/lib.rs`, `sweep_sol_for_swap`  
`amount` is only bounded by `amount <= cfg.max_sweep_lamports`; zero is allowed. The handler still sets `c.last_sweep_at = now`.  
Exploit: any fee payer calls `sweep_sol_for_swap(amount=0)` whenever the cooldown is about to expire. The cooldown resets forever, blocking `revenue.mjs` from sweeping. No funds are stolen, but revenue conversion can be delayed indefinitely.  
Fix: `require!(amount > 0)`.

8) MEDIUM — Failed distributions are marked done and never retried  
File: `bank/distribute.mjs`, transfer loop  
On transfer error:
```js
done[v] = { amount: ..., sig: null, error: ... }
save(st); failed.push(v)
```
On resume, `if (done[v]) continue`. A transient RPC failure, timeout, or temporary freeze leaves that vault unpaid for the day unless a human intervenes. The intent/error ambiguity is recorded but not acted on.  
Fix: retry entries with `sig == null` and no terminal error until the day ends, or maintain a separate retry queue; do not treat error entries as completed.

9) MEDIUM — Off-chain config reads use raw offsets without discriminator/version enforcement  
Files: `bank/revenue.mjs`, `bank/distribute.mjs`, `bank/alarm.mjs`  
`revenue.mjs` and `distribute.mjs` read `MintConfig` fields by fixed offsets and never check Anchor discriminator or `version`. `alarm.mjs` reads versions but does not abort if a version is unexpected; it only reports drift after the fact. A MINT upgrade that changes layout could make these scripts read wrong treasury/operator/minted_total values.  
Fix: in every off-chain reader, validate account owner, discriminator, `version`, and minimum length before using offsets; abort loudly on mismatch.

10) LOW — Cron logs in `/tmp` are symlink-attack surface  
File: `scripts/cron-install.sh`  
Cron lines append to `/tmp/cbob-*.log`. On a multi-user host, an attacker can pre-create symlinks and cause the cron job (as `ubuntu`) to append to or corrupt other files. `logrotate` running as root on `/tmp/cbob-*.log` is also undesirable.  
Fix: write logs to a non-world-writable directory such as `/var/log/cbob-vaults`, owned by `ubuntu`, mode 700.

WHAT I TRIED AND COULD NOT BREAK

- `split_revenue` destination pinning: caller cannot substitute destinations; ATAs are derived from `config.treasury` and `config.bank_treasury`. Rounding now floors the Bank share; u128 math is safe at `u64::MAX`.
- `sweep_sol_for_swap` destination pin and reserve arithmetic: caller cannot redirect SOL; `bal >= reserve + amount` prevents underflow.
- `set_collection_royalties` byte layout: not re-raised; Round 6 states it has been exercised against real Core and basis is bounded to 1000.
- GOV double-vote by transfer: asset-seeded `VoteRecord` prevents a transferred vault from voting twice. Delegates do not change the owner bytes read by GOV. Burned assets cannot produce a live owner read.
- SEAL open/close pairing, reserve delegate/close-authority checks, Token-2022 extension refusal, and BURN’s declared-account emptiness proof. I did not find a way to drain a sealed vault through these paths without Bank co-signature.
- Core mint/burn CPI encodings: the live suite on cloned mainnet Core contradicts any claim that these encodings are structurally invalid.
- I could not audit `bank/lock.mjs` because it was not supplied; all lock/ledger atomicity claims rest on that unseen file.

THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Make the alarm reconcile every on-chain `sweep_sol_for_swap` event/instruction to a revenue-ledger row, and fail CRITICAL on any unmatched sweep. The ledger currently only proves what `revenue.mjs` did, not what the permissionless MINT program allowed.