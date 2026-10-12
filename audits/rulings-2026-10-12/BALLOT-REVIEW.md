# Audit: CBOB holder voting and wallet batch (uncommitted work in `/opt/cbob-vaults`)

**Verdict:** I found no blockers. There are four Medium issues and five Low ones. Issue 1 is a regression in the custody-side concurrency fence, so it should be fixed before the batch path is enabled on the Gary Club side. The rest are about consent parity, stopping and resuming a ballot, and wallet account changes.

## What I checked and found no defect in

- **Choice binding:**
  - The server's `effectHash` covers the instructions and every vault's choice (`club-engine.mjs:139`).
  - The client re-checks the server's quote against the member's own choices before showing Confirm (`club-actions.mjs:33-35`, `ballot-input.mjs:29-32`).
  - The ballot editor starts with no choices; every vault defaults to "Not voting" (`ballot-view.mjs:15`).
- **One vote per vault:** the vote record's on-chain address is fixed per proposal and vault, so a replay or duplicate can only waste a fee. It cannot count a vote twice.
- **External path:** the receipt is saved before broadcast (`external-vote.mjs:71-74`). Signing is fenced by a Web Lock and a fresh re-plan inside the lock (`:55-62`). `signExact` refuses any wallet change outside the allowed list.
- **Recovery:** a saved receipt is released only after a confirmed result or after the transaction's expiry height is finalized (`external-vote.mjs:26-31`).

## MEDIUM

### 1. Batch votes skip the per-vault "in flight" fence on the Gary Club side
- **Cause:** `prepare` sets `asset = input.asset || null` (`club-engine.mjs:83`) and only fills it for the old one-vault form (`:99`). A batch vote intent is therefore stored with `asset = null` (`portal-market.ts:141`).
- **Effect:** the only fence is `gc_cbob_asset_in_flight ... WHERE status='sending' AND asset IS NOT NULL` (`/scratch/cbob-d6-integration/supabase/migrations/20261010_gc_cbob_portal.sql:54`). It never applies to batch votes, and there is no per-member vote fence either.
- **Concrete failure paths:**
  - (a) Tab 1 confirms a 4-vault batch that includes vault X while tab 2 confirms `open` (burn) of X. Both lock and both are signed with the member's key. If the burn lands first, the whole atomic batch fails and the other three votes are not cast, but the fee is still paid.
  - (b) A batch is still `sending` and the member reloads. The register lags about 10 minutes and `completedVotes` lives only in memory (`governance.mjs:17,51`), so the same vaults show again. A second batch is prepared and signed for the same vaults, and one of the two transactions fails and pays a fee.
  - (c) The same race with a trade settlement of X means the buyer receives a vault that has already voted, and the buyer is never told.
- **Why the tests missed it:** the portal test's engine stub returns a non-null `asset` for every vote (`tests/cbob/portal.test.mjs:28`: `input.asset||...:asset`). The fence simulation keys on that asset (`:26`). So "two intents on one vault cannot sign concurrently" does not cover batches.
- **Fix:** pick one:
  - Add a per-member unique index `ON gc_cbob_intents(member_id) WHERE action='vote' AND status='sending'`.
  - Or record each ballot asset in a child table that has a unique `(asset) WHERE sending` index.

  Then change the stub to return `asset:null` for batch input and assert the refusal.

### 2. Stopping and resuming a ballot can dead-end, because a refusal does not name the vault
- `planVotes` throws one generic message for the whole batch: "Every selected vault must be…" (`vote-plan.mjs:18`) and "A selected vault has already voted. Refresh your ballot." (`:20`).
- After a reload, a failed batch, or a stop, the editor rebuilds from `/data/vaults.json` (about 10 minutes behind) and the in-memory `completedVotes`. Already-voted or transferred vaults therefore reappear.
- Pressing "All Yes" then refuses the whole batch, and "Refresh" does not help until the register catches up. The member has to guess which of up to 4 vaults is blocking.
- Choices for the batches that had not run yet are also dropped when the review is closed (`ballot-view.mjs:20` → `governance.mjs:61` re-renders a fresh editor).
- **Fix:**
  - Return the offending vault numbers in both errors.
  - Before rendering the editor, check the vote records live: `getMultipleAccounts` over `voteAddress(...)` for the owned vaults (on the external path in the browser, on the club path through a club read).
  - Keep the unsent choices across a close.

### 3. Wallet Standard: a stale account object, and no way to reconnect after an account switch
- `standardAdapter` checks that the address is still listed (`holder-wallet.mjs:32`), but it then passes the **captured** `account` object to `signTransaction` (`:33`).
- The Wallet Standard reference wallets compare accounts by object identity (`account !== this.#account`). After a lock/unlock or reconnect, a wallet can refuse with "invalid account" even though the address has not changed.
- If the member really switches accounts, the guard throws "Connect again". But `governance.mjs:33` only offers "Connect your wallet" while `!externalWallet`, so the page can only be recovered by reloading it.
- **Fix:**
  - Sign with `wallet.accounts.find(a => a.address === account.address)`.
  - On an account-changed error, set `externalWallet = null` and call `render()`.
  - Optionally subscribe to `standard:events` `change`.

### 4. External voters get no key-change acknowledgment
- The Gary Club path requires an extra `bank_key_change` acknowledgment for any proposal that sets a guardian or operator key (`club-engine.mjs:131`). It explains the half-of-supply threshold and the notice period.
- The external review shows only one generic consent box (`external-vote.mjs:44-46`). `actionDetails` shows the raw row "New guardian: Remove guardian" (`governance-view.mjs:7`) with no warning.
- So the same proposal gets weaker informed consent depending on which wallet the member chose.
- **Fix:** move the acknowledgment text to a shared module and require a second checkbox in `reviewExternalVote` when `details.actions` contain `ArmSwapOperator` or `Brakes.set_guardian`.

## LOW

5. **The external blocked state is only computed at connect** (`governance.mjs:34-37`). If `resolvePendingVote` throws (RPC offline, or a corrupt record per `external-vote.mjs:12`), `externalWallet` stays set and `externalBlocked` stays false. The editor then renders, `reviewExternalVote:35` refuses, and no "Check saved transaction" button is offered. A corrupt record can never be cleared. **Fix:** derive the blocked state from `pendingVote()` on every render (wrapped in try), and offer a recovery path for corrupt records.
6. **The transaction is built at review time and signed later** (`external-vote.mjs:40,63`). The check at `:63` only refuses a transaction that has already expired. If the member deliberates in the wallet, the blockhash can expire mid-signature, and the receipt then sits in "Still awaiting confirmation" until expiry. **Fix:** rebuild with `buildForWallet(fresh.ixs)` inside the lock just before `signExact`.
7. **A definitive preflight refusal is swallowed** (`external-vote.mjs:74`), for example "already voted" from another device. The member sees "Still awaiting confirmation" for up to about 90 seconds with no reason given. Keep the receipt, but show the refusal text.
8. **`record.ballots = input.ballots.map` runs after the signature** (`external-vote.mjs:70`). With the one-vault input form it would throw after signing, and `onSettled` is never called, so the close button stays disabled. No caller passes that form today. Use `voteInput(input).ballots`.
9. **The 4-vote packet budget is not measured with real wallet additions.**
   - The comment at `ballot-input.mjs:2-3` claims 4 votes fit with the wallet's guard. But `ballot.test.mjs:45` measures without the compute budget and without Lighthouse.
   - My estimate is about 780 bytes plus whatever Lighthouse adds, against a 1232-byte limit. That is probably fine, but it is not verified.
   - If it does not fit, the wallet refusal is safe, but voting through an external wallet would simply not work.

## Missing verification
- The engine test covers only one-vault votes (`governance-engine.test.mjs:18-32`). It does not run a batch through the real `prepare`: `asset:null`, `effectHash` stable between prepare and confirm, the acknowledgment count text, and one ineligible vault refusing the whole batch through the server.
- The portal tests use `effectHash:'same'` and a fake asset, so batch binding and fencing are unproven end to end against the bundled `club-engine.cjs`. The generated adapter still has to be refreshed and re-pinned.
- The browser tests do not cover:
  - a Wallet Standard account switch or lock/unlock between connect and sign;
  - two tabs signing the external path at the same time;
  - a club-path reload while a batch vote is still `sending`;
  - a key-change proposal on the external path.
- Nobody has measured a 4-vote transaction as returned by Phantom, with Lighthouse and the page's compute budget.
