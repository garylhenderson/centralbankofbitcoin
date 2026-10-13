# CBOB proposal and trading review: Bank `84fccf8c` / Gary `eef71ca7`

This was a read-only review using Read, Glob and Grep only. I ran no commands, tests, network calls or database operations, and opened no env, key or credential files. I did not approve any fingerprints, and none of the statuses below were taken on trust.

I found one trading bug that should block the trading release, and three smaller holder-lane gaps. The frozen instruction builders and the money terms check out.

## Provenance limits

- **Bank:** `.git/refs/heads/v6` is `84fccf8c5ca8c4ecb8b2402515f631a4a2ed57d9`, and HEAD is on `v6`. I could not check whether the working tree has uncommitted changes.
- **Gary:** the worktree's gitdir (`/opt/gary-club/.git/worktrees/…`) is outside the allowed paths. `eef71ca7` comes only from the session's git snapshot, which said the tree was clean.
- **`portal-chain.ts` does not exist** in `src/lib/cbob/`, and nothing references it. I reviewed `portal-market.ts`, `portal-policy.ts`, the route, the migration and the tests instead.
- **Generated adapter:** I couldn't hash it. The `.sha256` file matches the status note (`3a4ee705…`), and spot checks of `club-engine.cjs` match the Bank source at lines 414, 2895, 2915–2934, 2997, 3006 and 3097. Someone still needs to rebuild it and check the hash.

## Findings

### F1. High (trading): any signed-in member can cancel anyone's offer

**Where:** `src/lib/cbob/portal-market.ts:173-183`, `:136-148`, `:132-135`, together with Bank `web/server/club-engine.mjs:32-35` and `:110`.

**How it fails:**
1. For an `accept_offer`, `prepareIntent` sets `seller: member.wallet`, meaning whoever is calling (line 180). It never checks that the caller owns the vault.
2. `engine.prepare('trade')` → `tradableVault(conn, asset, input.seller)` → `ownedVault` sees that the caller isn't the owner and throws with `code: 'CBOB_ORDER_INVALID'` (engine line 35).
3. `prepareTrade` treats that code as a confirmed bad order and runs `retireInvalidOrder(input.orderId)`, which sets the **bidder's** offer to `cancelled`.

Offer IDs come back from `marketState` for every funded offer (line 52, 85). So with trading on, any member can cancel every visible offer with one `POST /prepare {action:'accept_offer', input:{id}}` each. No money moves, but other people's standing orders are wiped out, which defeats the A2 rule that only orders proven invalid get retired.

**Tests:** the engine test (`web/test/trade-engine.test.mjs:29`) shows a non-owner seller produces `CBOB_ORDER_INVALID`. The Gary test (`tests/cbob/portal.test.mjs:30`) stubs out `engine.prepare` and `ownedVault`, so this path is never tested.

**Minimal fix:** for `accept_offer`, check ownership before calling `prepareTrade`, and refuse without retiring (e.g. `(await engine.ownedVault(conn, o.asset)).info.owner === member.wallet`, else 403). A sturdier fix is to stop using `CBOB_ORDER_INVALID` for "caller isn't the owner". Keep the code only for failures caused by the order's own maker or the vault: transferred away from a listing's seller, burned or retired, reserves below the minimum, frozen or wrong reserve account.

**Regression test to add:** a member who doesn't own the vault calls `accept_offer` against the real `ownedVault`; the offer must stay `active`.

### F2. Medium (holder lane): the execution review doesn't show what will actually happen

**Where:** `web/src/lib/sale-proposal.mjs:69-75`, `club-actions.mjs:43-45`, `external-proposal.mjs:48`.

The planner reads `last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`, the stop timestamps and `now`, but the screen never uses them. It just lists every action and adds a generic "Superseded actions may be skipped." On chain (`programs/cbob-vault-gov/src/lib.rs:517-587`):
- A `SetRound` whose `closes_at <= now` is skipped, but it still moves `last_round_id`. That makes older passed rounds permanently unexecutable.
- A newer `SetRound` replaces the live round and resets `minted_this_round`. The review doesn't show the current round being replaced.

**How it fails:** the composer accepts a 1-second sale (`saleProposalInput` only requires `closes_at > opens_at > voting_ends_at`, line 23-24). If it passes and is executed after `closes_at`, the holder approved "Set a sale round" and got a logged no-op that also supersedes earlier rounds. This is a gap in what the holder is told, not a builder bug.

**Minimal fix:** in `planGovernanceAction`'s execute branch, work out each action's expected result (`applies`, `skipped: superseded`, `skipped: round_already_over`, `skipped: stop_is_newer`) using the same logic as `lib.rs:517-587`. Show the live round that will be replaced, put both into `details` so the effect hash and confirm comparison cover them, and display them in both review paths. Optionally refuse or warn at creation when `closes_at <= voting_ends_at + 7 days`.

### F3. Low: offers can show as funded but fail at settlement on rent

**Where:** `portal-market.ts:82`.

An offer counts as funded when `balance >= price`. If the bidder's balance minus the price is greater than 0 but below the minimum a Solana account must keep (about 0.00089 SOL, 890,880 lamports), the payment transfer fails. The offer is shown as acceptable, then the dry run refuses. No funds are at risk, since the dry run is the real check at settlement.

**Fix:** count as funded only when `balance === price` or `balance - price >= 890880`.

Related point for whoever triages this: the server never checks funding when an offer is accepted. "Unknown" offers are only hidden in the page, and the chain dry run is what actually protects the bidder. That fits the ruling, but the status note's wording ("cannot be accepted through the page") describes the page, not the server.

### F4. Low: the royalty is rounded down, so it isn't always exactly 10%

**Where:** `portal-policy.ts:15-21`, `club-engine.mjs:77,114`.

The royalty is `floor(price/10)`, and prices can go to 1 lamport. Example: 10,001 lamports gives a 1,000 royalty and 9,001 to the seller (9.999%). The 90/10 test (`trade-engine.test.mjs:20`) checks this rounding behaviour rather than an exact 10%. The destination (`REVENUE` from `ids.mjs:40`) and "no extra Gary Club fee" are correct.

**Fix:** require `price % 10n === 0n` in `priceLamports`, or state that rounding favours the seller.

### F5. Low: smaller checks missing from the review screens

- **External proposals don't show the rent cost.** The review (`external-proposal.mjs:48`) shows only the network fee plus "also requires SOL rent", with no amount. The Gary Club path shows `estimated_sol_change_lamports`.
- **The page doesn't check the royalty destination.** `club-actions.mjs:58-60` displays `d.revenue` but never compares it to `makeIds(profile).REVENUE`. The server binds it, so this is defence in depth only.
- **A false "pending" can appear.** `resolvePendingProposal` (`external-proposal.mjs:36`) returns `{status:'sending'}` with no receipt when another tab holds the lock. The desk then shows "still pending" even though nothing was saved. This fails safe, but the message is wrong.

### F6. Informational: a listing still sells after the vault gains value

Under A2, a listing stays valid when the vault gains reserves, including the 21,000-sat activation deposit (`trade-state.mjs:26`). A seller who lists, then deposits or activates, sells at the old price automatically. This is disclosed (`club-actions.mjs:12`) and is how A2 was designed. Whether to keep it is your call.

## Checked and found correct

- **Instruction bytes and accounts:**
  - `create_proposal` is `disc | u32(1) | tag 0 | i64 opens | i64 closes | u64 price | u32 cap | i64 voting_ends_at`. This matches the `ProposalAction::SetRound` field order (`lib.rs:746`) and the `CreateProposal` accounts and mutability (`:826-842`).
  - `execute_proposal` matches `:866-880`.
  - The proposal address uses `proposal_count + 1` as a u64 LE seed.
  - The test compares against builders taken from the frozen suite (`sale-proposal.test.mjs:22-23`).
- **Pass/fail maths:** `tally()` matches on-chain quorum, threshold, the 10% minimum Yes turnout, the 50% rule for key changes, the open-voting boundary and the 7-day window exactly (`governance.mjs:32-40` vs `lib.rs:446-490`).
- **Electorate and quorum supply:** quorum supply is minted − burned − bare-burns-retired, and the index snapshot is `minted_total`. Both are bound into the effect, so any change forces a new review.
- **Dates:** Austin times are tried at UTC−5 and UTC−6, and times that are missing or repeated at a DST change are refused. Prices are exact to 8 cbBTC decimals.
- **No automatic voting:**
  - Filing a proposal casts no vote.
  - Ballots are only cast through the explicit ballot editor and review.
  - `holderActionsEnabled` and `tradingEnabled` are checked separately on the server at prepare and twice at confirm.
  - A test covers switching holder actions off after a proposal quote (`portal.test.mjs:78`).
- **External signing:**
  - The page re-plans and checks the effect, dry run and fee before signing, under a Web Lock.
  - `signTransaction` is used only (no sign-and-send).
  - The receipt is saved and read back before broadcast.
  - Recovery uses `searchTransactionHistory` and finalized block height.
- **Gary Club signing:** the signature is marked persisted before the database write, and the `abandon_unsigned` fence prevents a late broadcast.
- **Locks and races:** the per-asset `sending` unique index plus the `active→settling` conditional update serialize settlement. Cancellation during settlement is deferred correctly (`20261010_gc_cbob_portal.sql:81-93`).

## What's still needed before release

1. Fix F1 and add a real-engine test where someone who doesn't own the vault tries to accept an offer.
2. Fix F2 and add tests: an execute review of a round that's already over, of a superseded round, and of a restart where the stop is newer.
3. Rebuild the adapter from `84fccf8c` and check its SHA-256. Confirm the Gary branch matches `eef71ca7` using a command I wasn't allowed to run.
4. **Live checks not done:** no live database, row-security or service-role check of the order and intent functions; no real Phantom/Wallet Standard fee or transaction rehearsal; no real-member acceptance test. The fingerprint gate is still failing (16 pins), as the status notes say.
5. **Known items still open, not reviewed as fixed:** A2 persistent notices to both parties, G-A2 opening context, G-C6 linked-wallet self-offers, scanning for stale vault orders, and the ballot install wrapper and migration.

**Triage:** F1 should block turning trading on. F2 should be fixed before the first real sale-round proposal (target around October 26) and doesn't affect claims, activation or opening. F3 to F6 can be scheduled normally, and none of them requires a program change.
