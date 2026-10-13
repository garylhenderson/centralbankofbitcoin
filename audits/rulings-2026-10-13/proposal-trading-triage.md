# Triage: proposal-trading-review.md (Bank `84fccf8c` / Gary `eef71ca7`)

**Scope:** I used Read, Glob and Grep only. I ran no commands, made no network calls and edited nothing. The Gary tree has uncommitted edits in progress (`portal-market.ts` is modified), so **this report does not clear the current tree**. The Bank files I relied on are `programs/cbob-vault-gov/src/lib.rs`, `web/src/lib/sale-proposal.mjs`, `web/server/club-engine.mjs`, `club-actions.mjs` and `external-proposal.mjs`. I took them as found and did not hash-verify them against `84fccf8c`.

## Summary

| ID | Review said | Triage severity | Disposition |
|---|---|---|---|
| F1 | High | **High** (holds for the original code). Current partial fix: Medium residual | Confirmed. The fix in progress closes the main path but not a timing gap (a read race). Still blocks trading. |
| F2 | Medium | **Medium** | Confirmed, and wider than reported. Fix before the first real sale-round execution. |
| F3 | Low | **Low** | Confirmed, but the proposed fix is wrong. Use the buyer-side rent rule below. |
| F4 | Low | **Low / disclosure** | Keep the floor economics. Change the wording only. Reject "require price % 10 == 0". |
| F5 | Low | **Low** | All three items confirmed. Schedule normally. |

---

## F1: a caller who doesn't own the vault can retire someone else's offer

**The original finding is valid.** At `eef71ca7`, an `accept_offer` call set `seller: member.wallet`. `ownedVault(…, owner)` treats any owner mismatch as `CBOB_ORDER_INVALID` (`club-engine.mjs:35`). The `prepareTrade` catch block then retired the bidder's offer. One POST per visible offer ID (`marketState`) was enough.

**The fix in the current tree (`portal-market.ts:144-150`)** reads the vault before calling the engine. If `input.seller === member.wallet` and `vault.info.owner !== member.wallet`, it returns 403 without retiring the offer. This check:
- **Runs at prepare:** `prepareIntent` → `prepareTrade` (line 211).
- **Runs again at confirm:** `confirmIntent` calls `prepareTrade` again (line 301). That is before `gc_cbob_lock_intent` and before the order moves to `settling`. So a caller who sold the vault between review and confirm gets a 403, the intent stays `prepared` and the offer stays `active`.
- **Only fires for `accept_offer`.** For `buy_order`, `input.seller` is the listing's maker, so a seller who no longer owns the vault is a genuine listing problem, and retiring the listing is correct (existing test `portal.test.mjs:83/85`).

**Residual problems (Medium, still blocking):**
1. **Read race between the precheck and the engine.** These are two separate RPC reads (`ownedVault` in the precheck, then `tradableVault(conn, asset, input.seller)` inside `engine.prepare`). If the owner changes between them, or a load-balanced RPC serves two different slots, the second read fails with `CBOB_ORDER_INVALID` and the catch block **still retires the bidder's offer**. A2 says only invalidity of the order itself retires it. The current code does not enforce that structurally.
   - **Fix:** in the catch, decide by role, not by error code. For `accept_offer` (`input.seller === member.wallet`), an owner-mismatch failure must never retire the offer. Only `orderMatches` failures, a burned or retired vault, or a frozen or wrong reserve account may retire it.
   - **Sturdier fix:** have the engine return a reason that separates "this seller does not own the vault" from "the order or vault is invalid". The portal then maps the reason by role: listing maker means invalid order, caller means 403. This needs an adapter rebuild and hash check.
2. **Burned or retired vault on the `accept_offer` path.** The precheck's `ownedVault` (no owner argument) throws `CBOB_ORDER_INVALID` outside the retire catch, so the caller gets a 409 and the offer is not retired. That is safe, but these offers then wait for expiry or a stale-order scan. Add that scan to the existing open item.
3. **The caller check and the order check should be separate.** Error messages and logs should keep "you can't accept this (403)" apart from "this order has been cancelled (409)". Today the two are only separated by the fact that the precheck runs first.

**Practical tests** (`portal.test.mjs` stubs `ownedVault` to always return `member.wallet`, so none of these cases are covered today):
- **Caller-mismatch tests:**
  - **Prepare, caller mismatch:** stub `ownedVault` to return `other.wallet`, then call `accept_offer`. Expect 403, the offer stays `active`, no intent row, `sends === 0`.
  - **Confirm, caller mismatch:** prepare succeeds, then ownership changes before confirm. Expect 403, the intent stays `prepared`, the offer stays `active` (not `settling`), `sends === 0`.
  - **Race:** the precheck sees the caller as owner, then `engine.prepare` throws `CBOB_ORDER_INVALID` for a seller mismatch. Expect the offer to stay `active`. **This fails on the current code.** Run it at both prepare and confirm.
- **Order-invalidity tests:**
  - **Real invalidity still retires:** `accept_offer` where `orderMatches` fails (reserves below the offer's committed floor). Expect the offer to be `cancelled`, no intent, no send.
  - **Listing maker gone:** `buy_order` where the listing seller no longer owns the vault. The listing is retired (existing behaviour, keep the test).
- **Real engine:** build `club-engine.cjs` against a mocked RPC (`web/test/mock-rpc.mjs`) where a non-owner calls `accept_offer`. The offer must stay `active`.

---

## F2: the execution review doesn't show per-action results

**Confirmed against `lib.rs:446-609`.** `planGovernanceAction` (`sale-proposal.mjs:69-75`) reads `last_*_id` into `details`. It does not work out per-action results, and it does not read the stop flags, stop times or the live round. Both review paths show only "Superseded actions may be skipped" (`club-actions.mjs:45`, and implicitly `external-proposal.mjs:48`).

**What the chain does, per action**, evaluated in order against the execution-slot `now`. `create_proposal` RULE E allows at most one action of each kind (`lib.rs:327-340`), so there is no duplicate case within one proposal.

| Action | Status to show | Timestamp / state effect to show |
|---|---|---|
| `SetRound` | `skipped: superseded` if `id <= last_round_id` | None. |
| | `skipped: round_already_over` if `closes_at <= now` | **Still sets `last_round_id = id`.** Any lower-ID passed proposal's `SetRound` becomes permanently `superseded`. |
| | `applies` otherwise | Sets `last_round_id = id`. **Replaces the live round** (show the current `round_id`, `opens_at`, `closes_at`, `price`, `cap`). **`minted_this_round` resets** (show the value at review and that the cap restarts at 0). If `opens_at <= now`, show "opens immediately" and the remaining length `closes_at − max(opens_at, now)`. |
| `Brakes` guardian | `skipped: superseded` if `id <= last_guardian_id`, else `armed` | Armed only. It takes effect after `notice_secs` from execution, and the current guardian keeps the brake until then. Moves `last_guardian_id`. A skipped guardian does **not** skip the restart half. |
| `Brakes` restart_sales / restart_sweep | Each half separately: `skipped: stop_is_newer` if that stop is set and `stopped_at >= proposal.created_at` (**a tie means the stop wins**), else `sent` | Show `sales_stopped` / `sales_stopped_at` (and the sweep pair) against `created_at`. If the stop is not set, show "sent; sales are not currently stopped". I did not review what MINT does in that case, so don't call it "applies". |
| `TightenSweep` | Always `sent` | MINT applies it as "at least this tight". If a tighter value is already live, it has no effect (`lib.rs:359-361`). Show the live value next to the proposed one. |
| `ArmSwapOperator` | `skipped: superseded` if `id <= last_arm_id`, else `armed` | Pending until `notice_secs` has passed. Moves `last_arm_id`. |
| `SetBoostTerms` | `skipped: superseded` if `id <= last_boost_id`, else `applies` | Moves `last_boost_id`. |
| Whole proposal | — | `executed = true` even if every action is skipped. Any MINT CPI failure reverts the whole proposal. |

**Timestamps and effect binding:**
- **Bind the outcomes, not raw `now`.** Putting `now` in `details` would make every confirm fail. Instead, put each action's `{kind, status, reason}` plus the inputs that decide it into `details`: `last_*_id`, stop flags and times, `created_at`, and the live round's identity and terms. Gary's `effectHash` (`club-engine.mjs:145`) and the external path's `effect()` comparison (`external-proposal.mjs:8,68`) both already cover `details`. Re-planning at confirm then refuses if any outcome has changed.
- **`minted_this_round`:** show it labelled "as of review". It does not change any outcome, so leave it out of the hash, otherwise every purchase in a live round forces a new review.
- **Landing-time window.** The outcome is decided at the execution slot, not at review time. Work out each outcome at `now` and at `now + horizon`:
  - **What the horizon is:** the remaining quote lifetime (intent `expires_at`, or the external lock) plus the remaining blockhash life (`lastValidBlockHeight − current block height`, times the observed slot time from `getRecentPerformanceSamples`). Derive it; don't hardcode it.
  - **If `closes_at` falls inside the horizon:** refuse with "this round closes before execution can be guaranteed to land".
  - **If `voting_ends_at + 7 days` falls inside the horizon:** warn that the transaction may fail with `ProposalExpired`. That case reverts with no effect.
- **No program or economics change.** Every proposed change is a read-side planner and display change.
- **At creation (client-side warning only, no rule change):** warn when `closes_at < voting_ends_at + 7 days`, because the round could close before the execution window ends.

**Tests (`sale-proposal.test.mjs` / `governance-engine.test.mjs`):**
- **Round already over:**
  - **Execute after close:** `closes_at <= now`. Expect status `round_already_over`, the `last_round_id` change is shown, and the hash differs from an "applies" plan.
  - **Hidden older proposal:** an older passed `SetRound` (lower ID) after a newer one was executed past its close. Expect `superseded`.
- **Replacing a live round:** the screen shows the old round and the `minted_this_round` reset. A change to the live round's terms between prepare and confirm triggers "vault or transaction changed".
- **Restart:**
  - **Tie:** `sales_stopped_at == created_at` gives `stop_is_newer`.
  - **Mixed halves:** sweep stopped later than `created_at` but sales not stopped. Expect sales `sent` and sweep `stop_is_newer`.
- **Guardian superseded, restart sent:** a `Brakes` action with the guardian superseded and a restart still sent.
- **Landing window:**
  - **Closing inside the horizon:** `closes_at` within the horizon causes a refusal.
  - **Outcome flips before confirm:** prepare at T, confirm at T′ after `closes_at`. Expect a hash mismatch in both the Gary and external paths.
- **Same results in both paths:** the external review shows the same per-action statuses as the Gary review.

---

## F3: offers shown as funded can fail settlement on rent

**The finding is valid, but the proposed criterion (a hardcoded `890880`) should not be used.**

The actual rules:
- **Who pays what.** In `accept_offer`, the fee payer is the **caller, which is the seller** (`buildForWallet(conn, ixs, pubkey)` at `club-engine.mjs:138`). The Core `transferV1` payer is also the seller (line 79). The **buyer pays only** `price − royalty` plus `royalty`, which is exactly `price` across two `SystemProgram.transfer` calls. The buyer pays no network fee.
- **How rent is checked.** Rent state is checked per account at the end of the transaction, not after each instruction. A system account with no data must end at **0 lamports or at least `minimum_balance(0)`**. A transfer cannot leave a new rent-paying account. The one exception: an account that was already rent-paying may stay rent-paying if its size is unchanged and its lamports don't increase. Such accounts are rare.
- **Criterion for the buyer:** `post = balance − price`. The offer is funded if `post === 0n || post >= rentMin`, where `rentMin = await conn.getMinimumBalanceForRentExemption(0)`. Read it once per `marketState` call; don't hardcode it. Treating a pre-existing rent-paying bidder as unfunded is an acceptable false negative.
- **Where to apply it:** `portal-market.ts:82` (`marketState`) **and** `:113` (the funding check when an offer is created), so the two stay consistent.

**Related edge cases to note, not to fix now:**
- **Empty seller wallet.** In `buy_order`, the listing seller's custodial wallet may hold 0 SOL. A `seller_lamports` amount below `rentMin` into an empty account fails. With the 10,000-lamport minimum price, the seller gets 9,000. The dry run catches this. Optionally warn at listing time.
- **`REVENUE` must already be rent-exempt.** A 1,000-lamport royalty can only land if it is. Confirm this once, read-only.
- **The dry run (`built.sim.err`) remains the real check at settlement.** The server does not separately check funding at accept time. That matches the ruling.

**Tests:**
- **Boundary cases:**
  - **Exact balance:** `balance == price` means funded.
  - **One below the minimum:** `balance == price + rentMin − 1` means hidden.
  - **At the minimum:** `balance == price + rentMin` means funded.
- **Update the existing test:** `portal.test.mjs:80` currently expects `price + 1` to be visible. Under the correct rule it becomes hidden.
- **Read the minimum from RPC:** stub `getMinimumBalanceForRentExemption` and assert the value comes from there.
- **Offer creation:** `order()` refuses an offer where `balance − price` falls between 0 and `rentMin`.

## F4: royalty rounding

**Confirmed and Low. Keep the economics.** `royalty = floor(price / 10)` in the engine (`club-engine.mjs:77,114`), the order quote (`portal-market.ts:117`) and both client checks (`club-actions.mjs:55,213`). They are consistent.
- **What the rounding does:** the seller receives `price − floor(price/10)`. That favours the seller by `(price mod 10)/10` lamports, so under 1 lamport, at most 0.9.
- **Don't require prices to be multiples of 10.** That changes which prices are accepted and is not needed.

**Wording only:**
- **Labels:** change "CBOB royalty … (10%)" (`club-actions.mjs:59`) and "Seller receives 90%" (`:179`) to say the royalty is 10% rounded down to the whole lamport, and the seller receives the remainder.
- **Order review:** already shows exact lamports (`:216`). Add the same rounding note there.

**Test:** price 10,001 shows royalty 1,000 and seller 9,001, the sum equals the price, and the rounding wording appears.

## F5: small gaps on the review screens

All three confirmed and Low:
1. **No rent amount on external proposals.** `external-proposal.mjs:48` shows "also requires SOL rent" with no amount. Simulate the wallet's balance change, as the Gary path does (`club-engine.mjs:142-144`), and show it, or show `getMinimumBalanceForRentExemption(proposal account size)`.
2. **Royalty destination not checked in the page.** `club-actions.mjs:60` displays `d.revenue` without comparing it to `makeIds(profile).REVENUE`. The server binds it, so this is defence in depth: add the comparison and throw on mismatch.
3. **False "pending" from another tab.** `resolvePendingProposal` (`external-proposal.mjs:36`): if the lock is held and there is no receipt, it returns `{status:'sending'}` with no signature. Return a distinct status such as `busy_elsewhere` with an accurate message. **Test:** lock held, no receipt, so no "still awaiting confirmation" message.

## Openings (in progress, not cleared)

`priorOpening` (`portal-market.ts:178-190`) is under active edit, so I'm only noting points to check:
- **Which intent it trusts:** it accepts the most recent `complete` `open` intent for the asset, however old it is.
- **Silent fallback:** if acknowledgments don't match, it returns `null`, which falls back to a fresh opening review.
- **Unguarded `JSON.parse(decrypt(...))`:** this would surface as a 500 rather than a `PortalError`.
- **Missing tests:** a stale setup intent, and an approval from another member, both falling back with no carried context.

## Before trading or the first sale execution

1. **F1:** close the read race (role-based retire decision) and add the caller-mismatch tests above for **prepare and confirm separately**, plus one real-engine test. Rebuild the adapter and check its hash if the engine changes.
2. **F2:** add the per-action status, live-round and stop-state details, horizon check and binding before the first real `execute_proposal`.
3. **F3 to F5:** schedule normally. No program change and no new owner ruling are needed.
4. **Still outstanding:**
   - No live DB, RLS or wallet rehearsal.
   - Fingerprint gate still failing.
   - G-C6, A2 notices, stale-order scan, ballot install wrapper and migration still open.
   - **Current tree not cleared** while the consent helper, F1 and G-C6 edits are in progress.
