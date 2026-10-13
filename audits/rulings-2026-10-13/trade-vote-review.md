I found no critical or high-severity source blockers. There is one medium consent-disclosure gap and four low findings, plus some missing tests. I only read the code: I ran no tests and I'm not approving any fingerprints or publication. The full suite and built-page desk results you said were pending aren't covered here.

## Assumptions checked against the frozen program
- **Record layout:** `cbob-vault-gov/src/lib.rs:806-811` allocates `8+32+32+1+1` = 74 bytes (`:852`), in the order discriminator, proposal, asset (at offset 40), support, bump. `dataSize:74`, `memcmp@40` and `readVote` all match.
- **Address:** the record's address is derived from `["vote", proposal, asset]` (`:853`). That matches `voteAddress`, and checking it at `trade-votes.mjs:18` ties each record to this vault.
- **Votes can't be erased or forged:** nothing in the program closes or resizes these records, and only `cast_vote` creates them. A vault's vote list can only grow, and a transfer doesn't reset it, so the acknowledgment text is accurate.
- **No third-party griefing:** `cast_vote` needs the owner's signature (`:420`). Nobody else can add a vote to invalidate someone's order.
- **Failures don't wipe orders:** a failed or malformed read throws an error with no code, so `readOrderValidity` rethrows (`portal-orders.ts:36`) and the order is kept. Only a real digest mismatch retires an order. The non-owner accept protections (`portal-market.ts:156-158, 166`) are unchanged and run before the vote read.
- **"Checked before signing" holds:** `confirmIntent` runs `prepareTrade` again (`portal-market.ts:321`), and the confirmation hash includes `details.vote_history`, so a vote cast between review and confirm stops the signing.

## Findings

**Medium: the "full history" claim is wrong, so votes after the first 20 aren't really disclosed.** `club-actions.mjs:21`
- **Trigger:** a vault with more than 20 votes. The panel shows 20, sorted by proposal address (so effectively random, not most recent), and says "See the voting register for the full history."
- **Problem:** `/governance/` can't filter by vault. Search covers only proposal id, address and action titles (`pages/governance.mjs:92`). It's also a snapshot updated about every 10 minutes, not a live read. The buyer agrees to a digest that includes votes they can't practically see.
- **Fix:** list every vote in the collapsed section (the server already caps it at 10,000), or add a live per-vault filter to the register, and drop the "full history" wording until one of those exists.

**Low: old-format orders are retired with a misleading notice.**
- **Trigger:** `inspectCommitment` rejects anything that isn't version 3 (`trade-state.mjs:28`), so any active pre-v3 order fails `orderMatches` on both reads. The scan or any buyer's prepare then retires it as `invalid_vault` (`portal-orders.ts:31`).
- **Effect:** makers and targets are told "the vault no longer met its reviewed terms" (`account.mjs:75`), but only the format changed. Re-consent is intended; the explanation is wrong.
- **Fix:** confirm there are no active legacy rows before deploying, or add a distinct reason. That needs a migration, because `20261013_gc_cbob_order_notices.sql:6,16,48` checks the allowed reason values.

**Low: sellers are shown buyer-only wording.** `club-actions.mjs:20`
- "Buying this vault does not let you vote again…" also appears for `accept_offer` (the seller confirms) and for listings (`:236`, owner). It needs wording per role.

**Low: the vote read isn't pinned to the same slot as the vault read.** `trade-votes.mjs:10`
- `getProgramAccounts` runs without `withContext` or `minContextSlot`. If the provider's index lags, a vote confirmed seconds earlier can be missing from both the prepare and confirm reads, and the trade signs anyway.
- The acknowledgment covers a vote landing after the check, not one that was missing from it.
- **Fix:** pass `minContextSlot` from the vault and reserve reads, or say in the disclosure that the read can lag by a few slots.

**Low: response size isn't bounded.** Up to 10,000 votes are copied into the quote, the stored intent summary and the confirmation hash input, roughly 600 KB per intent at the cap. Nothing refuses this, but it hasn't been planned for.

## Missing tests
- **`trade-engine.test.mjs:19`:** the mock only checks the third filter (offset 40, asset). Removing or changing `dataSize:74` or the discriminator filter would still pass.
- **Unexercised failure branches:** there are no tests for more than 10,000 rows, a non-array response, `data.length !== 74`, a wrong discriminator, or a support byte above 1. The program, address, asset, duplicate and RPC-failure cases are covered (`:45-47`).
- **Gary side has no vote tests:** nothing under the Gary repo references `vote_history` or `votes_digest` outside the source and generated adapter. Untested:
  - the quote passing through `vote_history` (`portal-market.ts:129`);
  - `order()` refusing at confirm when a vote lands between quote and confirm (`:130`);
  - two-read retirement on a new vote, and its notice;
  - retirement of legacy orders.
- **UI:** nothing tests the 20-vote cap or the "Showing 20" text, or which wording sellers vs. buyers see.

## Limits
- I reviewed only the files you scoped and checked the generated adapter by grep, not line by line against the source.
- I didn't check `bs58` bundling in the adapter or the RPC provider's `getProgramAccounts` support and rate limits. Each scan can make up to about 48 of these calls.
- I didn't look at the database retire and notice functions beyond their reason checks.
