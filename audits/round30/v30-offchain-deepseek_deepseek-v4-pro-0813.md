## Findings by target

### R0 — round 29’s repairs and new regression

**Finding R0.H — `txread.mjs` falsely treats a normal program log as runtime truncation, and the 891 selftest count is not reproducible with this tree**

`bank/txread.mjs`, `validateParsedTransaction()`:

```js
const logsTruncated = meta.logMessages.includes('Log truncated')
```

The runtime marker is a standalone log line **exactly** `Log truncated`. A program’s own log line is `Program log: Log truncated`. The `.includes()` check matches both.

Concrete evidence:

- In `bank/selftest.mjs`, the arm intended to prove the opposite already exists:
  ```js
  const markerText = structuredClone(fixture);
  markerText.meta.logMessages = ['Program log: Log truncated'];
  t('R28 M1: user log text cannot impersonate the runtime marker',
    validateParsedTransaction(markerText, signature), markerText)
  ```
  With the current `includes()`, `validateParsedTransaction(..., { truncatedLogs: 'refuse' })` throws `unreadable parsed transaction: logs truncated by runtime`, so this assertion fails. That is a direct contradiction of the claimed 891/891 pass.

- Any transaction touching one of the scanned programs that also contains an inner program logging `"Log truncated"` as part of its text now:
  - pages a spurious `log_coverage_gap` HIGH,
  - skips parsing **all** CBOB event lines in that transaction,
  - makes the poster/revenue recover path take the truncated branch.

Attacker gain: cheap false HIGH pages and unnecessary loss of event coverage; the scanners do not silently lose events, but the exact repair that was supposed to distinguish the runtime marker from user text is broken.

Fix:

```js
const logsTruncated = meta.logMessages.some(l => l === 'Log truncated')
```

and rerun `node bank/selftest.mjs` until that arm passes again.

---

### R2 — dangerous state read as quiet

**Finding R2.CRIT — deterministic pool/revenue token-account squatting is read as healthy by the alarm while it permanently bricks distributions, claims, redemptions and paid mints**

Files/constructs:

- `bank/spl.mjs`, `readTokenAccount()`. It accepts any Tokenkeg-owned account of length >= 72 as `state: 'ok'` and never verifies:
  - the 165-byte classic account length the programs require,
  - the token account’s mint,
  - the token account’s owner/authority.
- `bank/alarm.mjs`, `readPool()` and the revenue-ATA read. Both use `readTokenAccount()` without checking those fields.
- MINT program itself, e.g. `read_token()`:
  ```rust
  require!(d.len() == TOKEN_ACCOUNT_LEN, MintError::VaultAccountMissing);
  ...
  require_keys_eq!(Pubkey::new_from_array(m), *mint, MintError::WrongVaultAccount);
  require_keys_eq!(Pubkey::new_from_array(o), *owner, MintError::WrongVaultAccount);
  ```

The attack:

1. Before road step 10 creates the real cbBTC pool ATA or revenue ATA, an attacker derives those addresses from the fixed MINT program id and cbBTC mint.
2. The attacker creates a classic SPL token account at that exact address with:
   - length 72 or wrong mint, or wrong owner,
   - no signature from the config PDA or revenue PDA required.
3. `createAssociatedTokenAccountIdempotent` later sees the account already exists and does nothing.
4. On chain:
   - `split_revenue` fails on the CPI.
   - explicit `distribute` fails in `read_token`.
   - `monthly_inline` silently treats a wrong pool account as “not ours yet” and returns `Ok`, so the monthly path does not even report.
   - paid `mint_vault` fails on the revenue-ATA transfer.
   - claims from an activated vault fail, and a redemption that must claim first can be blocked.
5. The alarm reads the same account with `readTokenAccount()` and can see `state: 'ok'`, with no pool/revenue finding.

This is worse than accepted item 52 (“the accounts must exist before the first split”): existence is not enough. The addresses are derivable before launch and the account cannot be recovered if its authority is the off-curve program PDA, because no MINT instruction authorizes closing a stray pool/revenue account.

Evidence if true:

- Send a Tokenkeg-owned 72-byte or wrong-mint 165-byte account into the derived `pool_ata`.
- Run the alarm’s pool read: `state: ok`, no `pool_unreadable`.
- Execute `split_revenue` or `distribute`: fails.
- `monthly_inline`: returns silently.

Fix:

- `readTokenAccount()` should not return `ok` below 165 bytes for classic accounts and should, where used for a known role, verify mint and authority against the expected values.
- Add a one-time on-chain create/validate instruction to MINT before the lock, or make `initialize`/a follow-on MINT instruction create the pool and revenue ATAs with CPI, so the only owner is the PDA and no pre-created impostor can survive.
- Add alarm checks for pool/revenue token account mint and owner.

---

### R5 — swap and revenue cycle

**Finding R5.M — the mainnet-fork swap proof omits accounts the built swap instructions require; the 16-assertion gate is not exercising the shipped `plan`**

Files:

- `sim/swap-fork.mjs`, `plan()`
- `bank/swap.mjs`, `orcaSwapIx()` / `meteoraSwapIx()`

`plan()` builds the clone list but does not include:

- Orca’s oracle PDA:
  ```js
  PublicKey.findProgramAddressSync(
    [Buffer.from('oracle'), ORCA.pool.toBuffer()], ORCA.program
  )[0]
  ```
  `orcaSwapIx()` includes this account at key 10.
- Meteora’s event authority:
  ```js
  mPda('__event_authority')
  ```
  `meteoraSwapIx()` includes this at key 13.
- The wSOL mint `So11111111111111111111111111111111111111112`, which Meteora’s swap instruction includes as `token_y_mint`.

Those accounts are not automatically cloned by `--clone-upgradeable-program`. On a fresh fork they do not exist. Therefore `node sim/swap-fork.mjs run` should fail before the advertised Orca and Meteora swap assertions, unless the fork already differs from what the script creates.

This is a gate measurement defect, not only cosmetic: the only live-cluster proof that the hand-built swaps work claims to run the real instructions against real pool state, but the clone list is missing real instruction accounts.

Fix: add the three missing accounts to `want` in `plan()`, rerun `sim/swap-fork.sh`, and record the fresh output.

---

**Finding R5.MEDIUM — effective worst-case swap floor is about 347 bps below the pre-sweep oracle, not the stated 150 bps, and the ledger hides it**

File: `bank/revenue.mjs`, revenue `main()`.

The route uses two oracle reads:

```js
const m1 = await market(conn, amount)
...
const m2 = await market(conn, amount)
const minOut =
  BigInt(q.outAmount) * BigInt(10_000 - MAX_REQUOTE_DRIFT_BPS) / 10_000n
if (m2.f.expectedSats < minOut) throw ...
...
const guaranteed = m2.f.minSats
cycle.quotedSats = String(m2.f.expectedSats)
```

With `MAX_REQUOTE_DRIFT_BPS = 200` and `SWAP_TOLERANCE_BPS = 150`:

- Pre-sweep oracle expectation: `E0`.
- Allowed post-sweep expectation: `E2 = E0 * 0.980`.
- On-chain floor: `E2 * 0.985 = E0 * 0.9653`.
- Worst-case execution is therefore at `(1 - 0.9653) * 10000 = 347 bps` below the first oracle quote, not 150 bps.

The ledger records `quotedSats` from the **second** market read. `detectUnreconciledRevenue()`’s `short_swap_return` tolerance is measured against that lower quote, so the extra 200 bps of pre-to-post drift is not visible to the alarm.

Attacker/accident gain: a swing between sweep and swap can cost roughly 347 bps relative to the decision that sent the SOL. At current oracle levels, a 10 SOL cycle is several million sats, so the aggregate is material.

Fix:

- Persist both quotes separately, e.g. `preSweepQuoteSats` and `postSweepQuoteSats`.
- Bind the on-chain floor to the pre-sweep quote rather than compounding the drift and tolerance hidden from the ledger, or explicitly lower `MAX_REQUOTE_DRIFT_BPS` so the sum of the two gates is disclosed and bounded.
- Have the alarm compare returned cbBTC against the pre-sweep quote where appropriate.

---

**Finding R5.MEDIUM — an expired send with a null status lookup is classified “refused”, permitting a possible second venue swap after the first actually landed**

File: `bank/swap.mjs`, `classifySendFailure()`:

```js
if (!st && expired)
  return { outcome: 'refused', sig, why: 'its blockhash expired and it never landed' }
```

The truth of “never landed” is not established when `getSignatureStatuses(...)` returns `null`. A transaction that has been included but not yet indexed can produce a null status for a short window. If the first venue’s transaction actually landed but status is not yet visible, the caller:

- treats the first send as `refused`,
- does not call `rememberAttempt()` for it,
- proceeds to the next venue.

If the operator has enough native SOL to cover a second `lamportsIn`, a second swap can be attempted and possibly land. The two venues are then both executed but only the second is recorded in `swapSig`; the first is not preserved as a `pendingSwapSig`.

This contradicts accepted limit 10’s rule that only a status the chain cannot give should remain open. The chain did not give a status here.

Fix: when `st === null`, return `outcome: 'unknown'` even for expired sends. Preserve the candidate signature and stop the venue loop. Only return `refused` when the chain gives a settled failed status, or an unambiguous preflight refusal.

---

### Other

**Finding OTHER.LOW — redemption poster crashes on a redemption that occurs before the level draw**

File: `bank/redemption-poster.mjs`.

`draftPost()`:

```js
if (!Number.isInteger(level) || level < 1 || level > 5)
  throw new Error(`level ${level} is not I..V`)
```

A vault can be redeemed before `reveal_level`. `retire_redeemed`/BURN do not require a drawn level. In that case `VaultRecord.level` is still 0 when the poster reads it. `main()` has no per-event catch around `draftPost()`, so the poster throws, does not save its cursor, and stops.

Fix: when `rec.level === 0`, queue the redemption as needing a later look or a hand draft rather than throwing; keep the cursor moving.

---

## The four accepted-limit questions

1. **Is any limit worse than stated?**
   Yes. Accepted limit 10 states the output floor as oracle expected less 150 bps. The code can reach about 347 bps below the pre-sweep quote because the 200 bps requote drift and the 150 bps floor compound. Also the expired/null status branch violates the stated rule that never tries another venue on an unconfirmed send.

   Item 52 is “the pool’s and Squads’ cbBTC accounts must exist before the first split.” Existence is not enough. Because the addresses are deterministic and the alarm does not validate the account’s mint/owner/length, a pre-created wrong account is both a permanent on-chain brick and a quiet alarm state. This makes item 52’s near-launch step materially worse than written.

2. **Is anything listed as a limit not actually a limit / already closed?**
   I did not find a closed-limit claim that is now obviously no longer satisfied, except that the round-29 M1 repair itself is not fully correct because of the `'Log truncated'` `.includes()` bug.

3. **Is any DISCHARGED item not actually discharged?**
   The discharged items I could check here — the lock repair, the payout arithmetic, the $CBOB boost schedule, the 2.1% ring arithmetic — remain supported by source. The issue is not a discharged item becoming undischarged; it is the newest repair being partially wrong.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?**
   Item 50 remains honestly open in the docs. Item 52 remains open, but my pool/revenue squatting finding shows the current wording understates what must be done: the accounts must not merely exist; they must be the **correct** accounts and there needs to be a recovery or creation path that cannot be permanently poisoned by a front-run.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Before launch, this project should:

1. **Run the full test gate from a clean checkout and demand exact equality with the recorded counts**, especially now that the `Log truncated` arm is red as written. Replace any floor that can be satisfied by stale counts with a check that the count equals the recorded floor.

2. **Fix and prove the swap-fork clone list.** The fork must clone every account the hand-built instructions include: Orca oracle, Meteora event authority, wSOL mint. Record the account list and the validator account-presence check.

3. **Create an atomic on-chain account-creation/validation path for the pool, revenue and Squads cbBTC accounts.** Do not rely on a post-`initialize` manual road step that can be front-run. If this is not changed before the lock, make the launch ceremony include an explicit check that no account exists at any of those derived addresses before the real creation transaction.

4. **Have an off-box monitor independent of the box owner.** The alarm, ledger, crontab and swap keys all live under the same user. A separate dead-man watcher that compares on-chain revenue/pool balances against expected split/return state would catch compromises that a same-box alarm cannot.

5. **Run intentional adversarial recovery tests before the lock**: a landed-but-unindexed expired send, a preexisting wSOL balance, a wrong token account at the pool/revenue ATA, a redemption before reveal, and a split whose confirmation times out after landing.

6. **Record every candidate signature, not just confirmed ones**, for all four money hops. The current expiry/null path loses a landed swap from the ledger. The hand runbook should never have to guess whether a venue swap happened.