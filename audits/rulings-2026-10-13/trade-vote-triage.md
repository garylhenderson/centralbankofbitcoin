I found no remaining source blockers at Bank `eb864fe` / Gary `f70de069`. The medium finding and three of the four lows are fixed in source. The legacy-reason low is a stated rollout gate, not a fix. I only read the code: I ran no tests and checked no hashes. Your pass counts, `tsc` result and pending suite/build/desk reruns are as you reported them, and I'm not approving publication.

## Status of the earlier findings

**Medium (votes after the first 20 hidden, false "full history" referral): fixed.**
- `club-actions.mjs:17-24` lists every vote in the collapsed section, with no slice or count limit.
- No "full history" or "Showing N" text remains in `web/src` (the only `slice(0,20)` matches are unrelated, in `redeem.mjs`).
- The browser test builds 21 votes, asserts 21 list items and the "21 votes have already been cast" text, and checks the per-proposal links (`club-controls-browser.cjs:15,102`).

**Low (unbounded size): fixed.** `MAX_TRADE_VOTES=512` (`trade-state.mjs:3`) is enforced in two places:
- The chain reader refuses more than 512 rows or a non-array response before parsing anything (`trade-votes.mjs:18`).
- The digest refuses more than 512 too (`trade-state.mjs:6`).

Both throw errors with no code, so `readOrderValidity` rethrows them (`portal-orders.ts:36`) and the scan counts them as `unavailable`. A failed read is never treated as an empty history or as invalidity. The generated adapter matches (`club-engine.cjs:3082,3129-3132`).

**Low (buyer-only wording): fixed.** Both the panel text and the acknowledgment are now neutral about role:
- Panel: "These votes stay with the vault after a sale. Its next holder cannot vote again…" (`club-actions.mjs:20`).
- Acknowledgment: "I have reviewed this vault's recorded votes…" (`club-engine.mjs:122`).

**Low (vote read not pinned to the vault-read slot): fixed.**
- `tradeVotes` runs after the vault read and the reserve loop (`club-engine.mjs:41-49`).
- It fetches `getSlot('confirmed')` and rejects a non-safe-integer or negative slot (`trade-votes.mjs:12-13`).
- It passes that slot as `minContextSlot` with `commitment:'confirmed'` (`:14`).

One caveat, not a blocker: the vault and reserve reads aren't themselves pinned. Behind a load-balanced RPC, `getSlot` could come from a node behind the one that served the vault read. The fix guarantees a vote snapshot no older than that slot, not exactly the vault-read slot. The landing-race disclosure covers the residual.

**Low (legacy orders get a misleading reason): rollout-gated, not fixed.** Source is unchanged. Version 3 is still required (`trade-state.mjs:30`), and legacy rows still retire as `invalid_vault` (`portal-orders.ts:31,34`). The new test (`portal.test.mjs:154-158`) only proves that legacy rows need two agreeing reads before retirement and that both parties get a notice. It doesn't check the notice's wording. So the gate holds only if a live preflight finds zero active orders at deployment. If any exist, a separate migration with a new reason value and re-consent is needed. Nothing I read is evidence of a live probe.

## Reader checked against the frozen program
- **Layout:** `VoteRecord` (`cbob-vault-gov/src/lib.rs:806-811`) is 74 bytes: discriminator, proposal, asset at offset 40, support, bump. The address is derived from `["vote", proposal, asset]` (`:852-853`).
- **Matches the reader:** this agrees with the `dataSize:74` / discriminator / `memcmp@40` filters and with `readVote` (`governance.mjs:31`). That reader checks the discriminator and rejects a support byte above 1 (`:8,11`).
- **Per-row checks:** owner, length, asset and address are all checked on each row (`trade-votes.mjs:20,22`).
- **Signer:** `cast_vote` still requires the owner's signature (`:420`).

## Test coverage now
- **`trade-engine.test.mjs:21`:** asserts all three filters exactly, plus `commitment` and `minContextSlot`.
- **`trade-engine.test.mjs:47-50`:** each of these makes the read refuse: wrong program, wrong address, wrong asset, wrong length, wrong discriminator, support byte of 2, non-array response, 513 rows, duplicates, RPC failure and a NaN slot.
- **`trade-state.test.mjs:21-26`:** the digest ignores RPC ordering, refuses malformed or extra-key rows and duplicates, refuses an oversized history, and rejects bad digests.
- **Gary portal (`:142-158`):** covers the quote passing `vote_history` through with a matching digest, a vote cast before authorization refusing with no insert, and two-read retirement plus notices for both a new vote and a legacy row.
- **Small gaps, not blockers:**
  - The engine mock hard-codes slot 789, so nothing tests that the slot is read *after* the vault reads. I confirmed that order only by reading the code.
  - No test pins the role-neutral wording to `accept_offer` specifically, though the text is now the same for every role.

## Residual limitation (not a defect)
A vault that ever passes 512 votes can never get a trade review or a new order through this path, because votes only accumulate. This fails safe: its existing orders stay active until they expire and are never wrongly retired. It only matters if the proposal count could realistically get near 512 for one vault, and I didn't check governance for a limit.

The off-chain-check/landing race is disclosed in both the acknowledgment and the panel, and nothing claims the check and the transfer are atomic.
