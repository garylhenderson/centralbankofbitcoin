

FINDINGS

1. **CRITICAL — MINT admin can replace `governance` without the current governance signer**  
   `programs/cbob-vault-mint/src/lib.rs`, `update_wiring`.  
   The co-signature guard only fires for `treasury`, `bank_treasury`, `split_bps`. `governance` is then overwritten unconditionally:
   ```rust
   if let Some(x) = governance { c.governance = x; }
   ```
   Exploit: admin signs `update_wiring(governance=Some(attacker))`. Attacker then signs `set_round` directly, or signs `update_wiring` again to rotate `treasury`/`bank_treasury`/`split_bps`. This bypasses GOV entirely. If `governance` is the GOV PDA, there is also no GOV instruction that can sign `update_wiring`, so the “governance-protected” rotations are either impossible or only possible through this admin hole.  
   Fix: require the current `config.governance` signer for any change to `governance`; add an explicit GOV-executable path for wiring changes if rotation is intended.

2. **CRITICAL — Alarm transaction cursor freezes after the first successful pass**  
   `bank/alarm.mjs`, `main()`.  
   ```js
   let newest = prev?.lastSignature || null
   ...
   if (!newest && sigs.length) newest = sigs[0].signature
   ...
   writeState({ ..., lastSignature: newest })
   ```
   Once `lastSignature` exists, `newest` is never updated. The cursor never advances. It also uses one cursor for five different programs and fetches only `limit: 200`. After the first pass, the alarm re-scans around the same anchor and, once more than 200 relevant signatures exist, silently misses newer transactions. A bare Core `BurnV1` or approve can occur in the gap and never alarm.  
   Fix: store per-program cursors, update to the newest signature actually processed, page until the `until` boundary, and fail loudly when `limit` is reached.

3. **CRITICAL — Distributor can double-pay because day guard and payment records are not atomic**  
   `bank/distribute.mjs`, `main()`.  
   There is no lockfile. `st.days[day]` is read-modify-written, and `done[v]` is written only after `sendAndConfirmTransaction()` returns. Two concurrent runs (cron + manual, or an overrunning cron) can both compute the same plan and pay the same vaults. A crash/timeout after a landed transfer but before `save(st)` causes the same vault to be paid again on resume.  
   Exploit: run `distribute.mjs` twice simultaneously; both see `done[v]` empty and both transfer.  
   Fix: `flock`, atomic state writes, pre-write a durable pending payment record, and reconcile against on-chain transactions or use an idempotent payment reference.

4. **CRITICAL — Revenue reconciliation can be satisfied by dust and misses unledgered sweeps**  
   `bank/detectors.mjs`, `detectUnreconciledRevenue`; `bank/revenue.mjs`.  
   The detector does:
   ```js
   if (!c.sweptLamports) continue
   if (c.returnedSats) continue
   ```
   It never checks that `returnedSats` is close to `quotedSats` or the swept value. Returning 1 sat marks a cycle reconciled. `revenue.mjs` writes `sweptLamports` only after the sweep confirms; a crash between landing and save leaves a cycle with no `sweptLamports`, which the detector skips. Permissionless `sweep_sol_for_swap` calls made outside `revenue.mjs` create no ledger entry at all.  
   Exploit: operator sweeps, moves most cbBTC out, returns dust, writes `returnedSats`; alarm is quiet.  
   Fix: compare returned amount to quote/slippage, treat started/sweep-signed-but-unrecorded cycles as unreconciled, and ingest on-chain `SolSweptForSwap` events rather than trusting only the local ledger.

5. **HIGH — `sweep_sol_for_swap` has no on-chain 50 SOL cap or rate limit**  
   `programs/cbob-vault-mint/src/lib.rs`, `sweep_sol_for_swap`.  
   The only bound is `bal >= keep + amount`. `MAX_PER_CYCLE_LAMPORTS = 50 SOL` exists only in `bank/revenue.mjs`. Anyone can call the instruction with the entire sweepable balance. If the operator key is compromised, or if the operator simply refuses to return funds, the whole revenue SOL balance can leave in one transaction.  
   Fix: add an on-chain `max_sweep_lamports` and/or cooldown in MINT config, or require the pinned operator’s signature.

6. **HIGH — GOV quorum/standing uses live cumulative `minted_total`, enabling mint-based pass/block games**  
   `programs/cbob-vault-gov/src/lib.rs`, `cast_vote`, `execute_proposal`.  
   Votes are allowed for any vault that exists before `voting_ends_at`, including vaults minted after the proposal was created. Quorum is read at execute time from MINT `minted_total`, which is cumulative and never decremented by burns.  
   Exploit: while a proposal is open, mint new vaults (if a round is open and Bank co-signs; especially dangerous at price 0) and vote them. After voting ends but before execute, mint more vaults to inflate the quorum denominator and block an otherwise passed proposal. Burned vaults still count toward quorum.  
   Fix: snapshot supply at proposal creation or voting end, store it in the Proposal, and use that snapshot for quorum; consider denying votes from assets minted after proposal creation.

7. **HIGH — `build-mainnet.sh` can certify stale or wrong artifacts**  
   `scripts/build-mainnet.sh`.  
   The build gate is:
   ```bash
   cargo-build-sbf ... | grep -E "^error" -A5 && die "build failed"
   ```
   If the build fails with diagnostics that do not match `^error`, the script can continue and copy stale `.so` files. Also, `ask()` deploys and tests only `cbob_vault_mint.so`; SEAL, BURN, and GOV artifacts are not asked whether they reject the localnet key.  
   Exploit: a failed build with non-matching output plus old `dist/*.so` yields a “VERIFIED” sha256 for wrong bytes.  
   Fix: run cargo directly and die on nonzero exit; verify all four programs; hash only artifacts produced by the successful clean build.

8. **MEDIUM — One-year round guard uses unchecked subtraction and can overflow**  
   `programs/cbob-vault-gov/src/lib.rs`, `create_proposal`; `programs/cbob-vault-mint/src/lib.rs`, `set_round`.  
   ```rust
   require!(closes_at - opens_at <= MAX_ROUND_SECS, ...)
   ```
   With `opens_at = -1` and `closes_at = i64::MAX`, the subtraction overflows. If built with overflow checks disabled, it wraps negative and passes, creating an effectively permanent round. If overflow checks are enabled, it is a panic path.  
   Fix: use `closes_at.checked_sub(opens_at)` and reject overflow.

9. **MEDIUM — Royalties plugin can diverge from `split_bps` and has never been validator-tested**  
   `programs/cbob-vault-mint/src/lib.rs`, `set_collection_royalties`.  
   `basis_points` is a caller argument and is not required to equal `cfg.split_bps`. `update_wiring` can change `split_bps` without updating the collection plugin. The alarm does not read the collection Royalties plugin. Add vs update is also manual; the wrong mode fails if plugin presence does not match `add`.  
   Fix: remove the argument or require `basis_points == cfg.split_bps`, make the CPI idempotent, add an alarm read of the collection plugin, and test this exact CPI against cloned mainnet Core.

10. **MEDIUM — DAS pagination treats a short page as end-of-list; distributor can overpay a partial vault set**  
   `bank/alarm.mjs`, `listVaults`; `bank/distribute.mjs`.  
   Both stop when `items.length < 1000` and ignore any `total`/cursor consistency. A transient short page produces a partial vault list. In `distribute.mjs`, `allocate()` then divides available cbBTC by fewer activated vaults, overpaying every visible vault.  
   Fix: verify DAS `total`, use stable cursors, retry on inconsistency, and abort distribution if vault count is not reconciled.

11. **MEDIUM — Cron jobs have no locks; overlapping runs are expected races**  
   `scripts/cron-install.sh`.  
   Alarm, distribute, and revenue can overrun their intervals and run concurrently. This aggravates findings 2–4. Logs are also written to world-writable `/tmp`.  
   Fix: wrap each job in `flock -n`, alert if a lock is held too long, and log to a non-`/tmp` path with restricted permissions.

12. **LOW — Rounding and small operational claims do not match code**  
   `split_revenue` computes holders first and gives the remainder to Bank, so dust rounds to Bank, contrary to the comment. `update_wiring` permits `split_bps = 0`. Alarm advances state even if notification fails, so an undelivered critical alert may not repeat.  
   Fix: document/adjust rounding, require `split_bps > 0`, and avoid advancing alarm state when alert delivery fails.

WHAT I TRIED AND COULD NOT BREAK

- I could not redirect `split_revenue` destinations to caller-supplied accounts: ATA derivation, config pinning, and the SPL Token program constraint hold. The two transfers sum exactly to the source balance.
- I could not make the same vault vote twice: `VoteRecord` PDA seeded by proposal+asset blocks re-init, and transfer after voting does not erase the record.
- I could not bypass SEAL’s open/close pairing through instruction introspection, nor find a way to leave a delegate on a canonical reserve ATA past `close_redemption`.
- I could not identify a definite byte-level fault in the Royalties encoding from the supplied constants, but that path is untested and is covered by finding 9.
- I could not make BURN use a divergent reserve list: it reads SEAL config with discriminator/version pins.

THE SINGLE THING TO FIX BEFORE THIS HOLDS REAL MONEY

Fix MINT `update_wiring`: changing `governance` must require the current governance authority. As written, the governance program is decorative: the admin key can unilaterally become the governance authority and then control rounds, treasury rotation, and the split.