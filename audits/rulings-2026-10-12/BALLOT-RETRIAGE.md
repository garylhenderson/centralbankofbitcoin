# Re-triage of the ballot fixes (Bank d691b17 + uncommitted work, Gary 71fbeee0 + uncommitted work)

**Verdict:** I found no source blockers or regressions. All nine findings (M1–M4, L5–L9) are fixed in the source. A few Low items and some verification gaps remain; they are listed below. This is a source checkpoint only. It does not approve publication or signing.

## How each original finding was resolved

- **M1, fixed.**
  - **How it works:** `20261012_gc_cbob_ballot_fence.sql:16-49` fences every vault in a sending intent: the `asset` column for single-vault actions, plus every `payload.input.ballots[].asset` for votes.
    - It locks the vaults in sorted order, and the child row primary key is the asset.
    - A vote that fences nothing is refused (`:38`).
    - While an intent is sending, its vaults and choices cannot be changed (`:20-24`).
    - The fence is released on complete or failed, and by `gc_cbob_abandon_unsigned`.
  - **Engine agreement:** the trigger's ballot check matches the engine. `voteInput` (`ballot-input.mjs:11-22`) only accepts `{proposal, ballots}` or the old `{proposal, asset, support}` form, with base58 addresses, so the engine cannot sign a vault the trigger did not fence. If the two ever disagree, the trigger refuses rather than letting it through.
  - **Old-style lock still works:** an overlapping vault set raises `23505`, which still maps to "Another action on this vault…" (`portal-market.ts:229`).
  - **Deadlocks and reconcile:** I checked lock ordering against the existing `gc_cbob_asset_in_flight` index and found no deadlock cycle. The per-row DELETE and re-INSERT on each `last_checked_at` update (`portal-market.ts:196`) is safe: a competing insert waits, then fails.
- **M2, fixed.**
  - Vote records are read live before the editor is shown (`governance.mjs:58-66`).
  - Planner errors name the vault (`vote-plan.mjs:19-21`).
  - Choices are kept across a close (`ballot-view.mjs:8,16`). Only vaults on screen can be submitted, so a stale saved choice for a hidden vault cannot be sent.
  - Eligibility is re-checked when the member closes the review (`:73`).
  - One residual issue is Low-1 below.
- **M3, fixed.**
  - Signing uses the current same-address account object (`holder-wallet.mjs:32-34`), and refuses if that account is gone.
  - Reconnect is always visible (`governance.mjs:77`) and is disabled while busy.
- **M4, fixed.** The shared `keyChangeAcknowledgment` is used on both paths:
  - Engine: `club-engine.mjs:132`, which is part of `effectHash` and enforced at `portal-market.ts:222`.
  - External path: a second checkbox (`external-vote.mjs:48-49,61`).
- **L5:** the blocked state is re-derived on every render and fails closed (`governance.mjs:34`).
- **L6:** the transaction is re-planned, rebuilt with a fresh blockhash, simulated and fee-checked inside the lock right before signing (`external-vote.mjs:64-69`).
- **L7:** a cleaned-up refusal reason is shown and the receipt is kept (`:80-83`).
- **L8:** the input is normalized before use (`:35`, `:76`).
- **L9:** the unmeasured packet-size claim was removed (`ballot-input.mjs:2-3`).
- **Proxy `getFeeForMessage` branch** (`rpc-proxy.mjs:183-194`): it only accepts a legacy, canonical message of 1232 bytes or less, at `confirmed` commitment, that calls a CBOB program. This matches the parameters web3.js sends, and I found no bypass.

## Remaining findings

### Low-1: the error filter can hide the new "names the vault" errors (M2 is incomplete for some vaults)
- **Where:** `portal-market.ts:37` turns any engine message matching `/https?:|api.key|secret|fetch|rpc|ECONN|ENOTFOUND/i` into "The chain could not be read. Please try again."
- **Why it bites now:** M2 put full base58 vault addresses into the error text (`vote-plan.mjs:18-21`). `r`, `p` and `c` are all valid base58 characters in both cases, so roughly 1 vault address in 600 contains "rpc" when case is ignored.
- **Effect:** for those vaults, an ineligible or already-voted vault shows a generic "try again" error with no vault named. That is the M2 dead end again, and retrying never helps.
- **Fix (either):**
  - Strip addresses before testing: `const probe = message.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, '')` and run the regex on `probe`.
  - Or have the engine mark the errors that are safe to show (for example `Object.assign(Error(msg), { holderSafe: true })`) and pass only those through unchanged.

### Low-2: the exact fee comparison may block voting if the measured compute varies
- **Where:**
  - `external-vote.mjs:69` refuses unless `freshFee.value === fee.value`.
  - `portal-market.ts:225` makes the same equality check on the Gary Club path.
- **Why it matters:** the fee includes the page's priority fee, which is based on the measured compute (`tx.mjs:97,103`). If two simulations measure even slightly different compute, the fee changes and the vote is refused every time.
- **Status:** I see no source of variation for `cast_vote`, so this is a verification gap rather than a confirmed defect.
- **Fix:** refuse only if the fee went up (`freshFee.value > fee.value`), or show the new fee and ask again. Add a test that simulates a 4-vault vote twice and gets the same fee.

### Low-3: the Connect button's page is not redrawn if recovery throws
- **Where:** `governance.mjs:35-40`. If `resolvePendingVote` throws (RPC down, or no Web Locks), `externalWallet` is already set and `externalBlocked=true`, but `render()` is never called.
- **Effect:** the page keeps showing a stale "Connect your wallet" button until the next 120-second poll.
- **Status:** it fails closed, so this is a user-experience problem only.
- **Fix:** move `render()` into a `finally`.

### Low-4: a corrupted receipt has no recovery path for the member
- **Where:** `external-vote.mjs:12`, `governance.mjs:41-45`.
- **Effect:** "Check saved transaction" throws for good. Never clearing the receipt automatically is correct and matches the ruling, but the member is not told what to do.
- **Fix:** show the stored text and tell the member to check their wallet's history. Optionally add a separate discard action that needs typed confirmation. Supporting this off-page is acceptable if it is written down.

### Low-5: an older eligibility check can overwrite a newer one
- **Where:** `governance.mjs:61`. If a check started before a close resolves after a new check, the older result replaces the newer one.
- **Status:** both results come from live reads, so the impact is small.
- **Fix:** store a request token and ignore results whose token no longer matches.

### Note (left over from original finding 1c)
The fence removes the race between a vote and a trade. But a buyer is still not told that a listed vault has already voted on an open proposal, and that vote is permanent. Consider showing this on the trade review screen.

## Missing verification

1. **The DB test does not use the production table definition.** `ballot-db.py:24` builds its own `gc_cbob_intents` table: no CHECK constraint on status, no foreign keys, no `summary`, `last_checked_at` or `created_at`. It also does most lock calls as the superuser, which bypasses row-level security; only lines 47 and 49 run as `service_role`. Apply the real `20261010_gc_cbob_portal.sql` with stub `auth.users` and `gc_members` tables, and run every lock as `service_role`.
2. **No real deadlock test.** Line 32 runs the reverse-order ballots one after the other with a sleep. A real test would start two transactions together, each locking `{a,b}` in opposite order. A test where reconcile's `last_checked_at` update overlaps another vault's lock is also missing.
3. **The Supabase error code is only checked in the mock.** Nothing confirms against real PostgREST that a `23505` raised inside the trigger reaches the client as `lockError.code==='23505'` through `rpc()`.
4. **The generated adapter's hash was not checked.** With Read only, I confirmed that `club-engine.cjs` contains the new vote-plan, `voteInput` and `bank_key_change` code. I could not check `club-engine.cjs.sha256` against the file.
5. **Still a release gate:** nobody has measured a real Phantom 4-vote transaction, with Lighthouse and the page's compute budget, against the 1232-byte limit.
6. **No browser test for the account-change path.** No test changes a Wallet Standard account and then uses Reconnect. Unit test 14 covers swapping the account object for the same address, but not the UI recovery.
