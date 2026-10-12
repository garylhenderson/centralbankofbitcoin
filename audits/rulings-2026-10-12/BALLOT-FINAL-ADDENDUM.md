## Final addendum: ballot re-triage checkpoint (Bank `ad5ef46`, Gary `efd1dc6d`)

I could not append this to `ballot-claude-retriage.md` myself because I only had read access, so it is here for whoever compiles the file. I read only the four deltas.

**Verdict:** I found no new blocker in these four deltas. They close M1's unmigrated-database gap and Low-1, Low-3, Low-4 and Low-5 from my last re-triage, plus that re-triage's DB-schema and role-coverage gaps. One fix has a small side effect, described below, but it does not block. This is a source checkpoint only, not release approval.

### 1. Unmigrated-database fence: closed
- **The new function:** `20261012_gc_cbob_ballot_fence.sql:54-59` adds `gc_cbob_lock_ballot_intent`, which simply calls `gc_cbob_lock_intent`. Only `service_role` can run it.
  - It is created in the same transaction as the fence table and trigger, so a partly applied migration cannot happen.
  - Postgres checks the function body when it is created, so a mismatched signature fails the whole migration.
- **The caller:** `portal-market.ts:228` uses the new function exactly when `input.ballots` is an array. This matches `voteInput` (`ballot-input.mjs:11,15`): an input with any other `ballots` value never gets past `prepare`.
- **Fails closed:** on an old database, the missing function returns an error, `noError` turns it into a 503, and the code stops before `getWalletKeypair`. `portal.test.mjs:73` proves the intent stays `prepared` and nothing is sent.
- **Old one-vault votes:** they still use `gc_cbob_lock_intent` and are fenced by the `asset` column (`club-engine.mjs:100`). That works whether or not the migration has run.
- **Optional hardening (not a blocker):** the new function proves the migration ran, not that the trigger is still enabled. It could check `pg_trigger` (`tgenabled <> 'D'`) and refuse if the trigger is gone or disabled.

### 2. `safeEngine` error filter: fixed, with one new Low

**Low-A (new):** `portal-market.ts:37` changed `rpc` to `\brpc\b`. That fixes the vault-address problem, but it also stops matching `jsonrpc` and `JSONRPC`.
- **Where it bites:** when the RPC server returns an HTTP error, web3.js throws `"<status> <statusText>: <body>"`. The body is `{"jsonrpc":"2.0","error":…}`, and for a 429 or 5xx it often contains none of `https?:`, `api.key`, `secret` or `fetch`.
- **Effect:** these temporary chain failures now come back as a 409 showing up to 700 characters of the provider's raw response, instead of a 503 "The chain could not be read."
  - The member sees a lasting refusal instead of "try again", plus the provider's internal error text.
  - I found no path that leaks a credential: the URL, API-key and secret patterns are unchanged.
- **Fix:** remove base58 runs first, then test the original loose pattern:
  ```
  const probe = message.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, '')
  ```
  Run `/https?:|api.key|secret|fetch|rpc|ECONN|ENOTFOUND/i` on `probe`. This also removes the small leftover chance (about 1 in a million per address) that a vault address happens to contain `fetch`, `econn`, `secret` or `api?key` and gets hidden.
- **Missing tests:**
  - `portal.test.mjs:74` covers only an address containing `rpC`.
  - No test shows that a message containing a URL, `api-key`, `secret` or `fetch failed` still becomes a 503. "Filters intact" is currently a source reading only.
  - No test covers a `429 … {"jsonrpc"…}` message.

### 3. Governance page: closed
- **Connect:** errors are caught and the page is redrawn in a `finally` (`pages/governance.mjs:38-42`). If recovery throws, the page stays blocked (`externalBlocked=true`) and shows the error.
- **Eligibility:** each check carries a request token, and an older result whose token no longer matches is dropped (`:63-64`). The list of owned vaults can only shrink within a page load, so the cache cannot let in a vault that was never checked.
- **Saved receipt:**
  - The stored text is shown as plain text, so it cannot inject markup (`ui.mjs:19`). It is capped at 5000 characters (`external-vote.mjs:9-11`).
  - A corrupted receipt tells the member to keep it (`:19`).
  - Nothing deletes it automatically: removal happens only on a confirmed or finalized status, or after the finalized block height has passed.
- **Cosmetic:** `externalError` is not cleared after a successful "Check saved transaction" (`:44-48`), so an old warning can stay on screen.

### 4. `ballot-db.py`: mostly closed, one gap in what it proves
- **Done:** it now applies the real 20261010, 20261011 and 20261012 migrations on stub auth and members tables. All normal locks run as `service_role`, and anon and authenticated are refused.
  - The reconcile-race test (`:68-74`) is real: the competing insert waits on rows that are not yet committed, then fails on the primary key.
  - The backfill and rollback tests are useful.
- **Gap:** the "simultaneous reversed ballots" test (`:58-67`) lines up two Python threads, but the two lock calls only overlap if timing happens to cooperate.
  - The threads meet *before* each one starts its own `psql`, and nothing holds the first row lock open while the other vault is taken.
  - So the two transactions most likely run one after the other, and the "no deadlock" check is weak.
  - The source itself is correct: both vaults are taken in sorted order inside a single `INSERT … SELECT … ORDER BY` (`:40-41`). This is a weakness in the evidence, not a defect.
  - **To prove it:** add a test-only `BEFORE INSERT` trigger that sleeps on the first vault. Or run the test once with `ORDER BY` removed and show it reports the deadlock.

### Other checks
- **Adapter hash:** `club-engine.cjs.sha256` contains `f0f4c96f…c7ed7`, matching the brief. With read-only tools I could not hash `club-engine.cjs` myself, so that match is your evidence, not mine.
- **Still open from my last re-triage:**
  - Low-2: the exact fee comparison is unchanged (`external-vote.mjs:75`, `portal-market.ts:225`).
  - The note about warning buyers that a listed vault has already voted is still open.
- **Release gates still in force:**
  - current pins
  - a real Phantom 4-vote transaction, measured for size and delivery
  - production migration plus a real PostgREST check that a `23505` raised by the trigger reaches the client as that code
  - owner signing

  No deploy and no lane enablement are implied.
