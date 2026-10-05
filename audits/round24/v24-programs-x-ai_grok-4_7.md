No CRITICAL or HIGH. The open/burn pairing, pool accumulator, boost ring, and cross-program offsets hold on a line-by-line read. The round-23 repairs are real at the sites they touch. One repair does not do what its comment says. The strong “no pay for pre-join revenue” claim is false in ways the spec already weakens.

## R1. Custody

No path found that thaws a vault and leaves it alive, or that pays a sealed vault’s reserves to anyone but the owner.

`open_for_redemption` only matches a **later top-level** `burn_vault` (program id, discriminator, asset at 0, owner at 2). `burn_vault` only matches an **earlier top-level** `open_for_redemption` the same way. `retire_redeemed` requires stack height `TRANSACTION_LEVEL_STACK_HEIGHT + 1` and that the **current top-level** instruction is `burn_vault` for that asset. A failing burn reverts the thaw. WR.1–WR.4 are the right shape for the wrapper; I am not re-reporting them.

Emptiness: both ATA derivations, amount, delegate, close authority, and `len == 165` are required when the account is a token account. The `continue` on non-token / short data is the nonexistent-ATA case, not a skip of a live balance. Undeclared non-ATA value is still invisible. That is proven impossibility 2 and limits 9 and 44, not a new hole.

## R2. Pool

**“Pool balance ≥ ceil(owed)” holds** if `total_active_weight` equals the sum of live weights. `credit` adds `floor(avail * SCALE / w) * w` to `owed_scaled`, which is ≤ `avail` sats. `claim` subtracts `pay * SCALE`. `reweigh` preserves each vault’s pending and does not touch `owed_scaled`. `join` adds 0 pending. `retire` subtracts that vault’s pending. I found no path that increments a record’s weight without the same delta on `total_active_weight`.

**“No vault is paid for revenue that arrived before it joined” is false.** It is not a new bug. `join` sets `debt = weight * acc`, `carry = 0`, so a distribution that **already ran** is not claimable. Revenue **already in the pool** (and, per limit 55, cbBTC still in the revenue address) is shared by the **next** distribution, which the new vault is in. `JoinWaitingFirst` makes that worse on purpose: a due month will not run while an eligible vault is unjoined, so the joiner is included in revenue that arrived before the join. SPEC already states the weak form. The prompt’s strong form should not be used as a launch claim.

Counters: `join` cannot run in the request epoch (`dist_epoch > request_epoch`), and `advance_epoch` zeroes `pending_this_epoch` rather than decrementing it. Same-epoch retire decrements both. I could not force `pending_this_epoch > pending_count`. A waiting vault cannot block distributions: `claim` joins it permissionlessly. A due boost cannot block them permanently: `expire_boosts` needs only the record.

## R2b. Boost repairs

Owner check is in the right place: after `require_live_vault`, owner bytes `1..33`, before the burn. No other instruction grants a boost. Expire, retire, and `reweigh` do not depend on the buyer.

Ring: `end = dist_epoch + epochs`, slot `end % 64`, consumed when `advance_epoch` lands on that epoch. Max epochs 63 against a ring of 64, so a live end and a due end do not share a slot. `unschedule_boost` uses the same `dist_epoch >= end` test as `advance_epoch`. A boost bought at epoch E becomes due exactly when epoch becomes E+N, i.e. after N advances. Same-transaction `distribute` after `boost_vault` counts as one of the N (BO.21). That matches the code, not “the next distribution after this transaction.”

`reweigh` preserves pending: `carry = owed`, `debt = new_weight * acc`, denominator moves by `after - before`, `owed_scaled` unchanged. Retire subtracts `weight_of` (includes boost) once, then `unschedule_boost` adjusts boost totals only.

**LOW — `boost_vault` slippage repair is one-sided and the suite cannot see it.** `programs/cbob-vault-mint/src/lib.rs`, `boost_vault`. The comment says a vote that moves the terms the buyer saw refuses and burns nothing. The check is only `price <= max_price && weight >= min_weight && epochs >= min_epochs`. A vote that keeps the price and raises weight or epochs still burns and locks the one slot for longer than the buyer signed, and dilutes others more than that simulation showed. There is no max-weight or max-epochs argument, so the buyer cannot express “exactly these terms.”

Evidence: terms `(P, 2, 2)`; boost signed with `max_price=P`, `min_weight=2`, `min_epochs=2`; execute `set_boost_terms(P, 12, 24)`; boost lands; `boost_weight=12`, `boost_end_epoch = dist_epoch+24`, supply down by `P`. BO.26 only moves the price, so deleting the weight/epoch compares would stay green. Happy-path `ixBoost` defaults `minW=0`, `minE=0`, `maxPrice=u64::MAX`, so those arms do not pin the guard.

Fix before freeze, or accept it in SPEC in the same words as the code: the buyer can cap the price and refuse a smaller boost, and cannot refuse a longer or heavier one.

## R3. Level draw

Not worse than limit 26 as SPEC now states it. The code comment above the draw still says a skip “hands C to the next leader.” That sentence is false: B and C are group-aligned, and a skip stays in that leader’s 4-slot group (`try_capture` / `blockhash_in_window`). SPEC 26 is the accurate text. Up to four tries for that leader, then the next leader. Cohort bias (same `reveal_slot`) is already in 26.

FIFO, burned head, and attribute hash are as described. Host tests cover skipped slots; the local validator still does not.

## R4. Governance

No minority path into the split, destinations, `max_supply`, royalty, or a vault. Key changes use ceil(50% of the **snapshot**), are unbundled, and are skipped rather than reverted when superseded. Same-second stop vs restart matches MINT (`>=` / `<`). A proposal whose snapshot can no longer be met does not freeze later proposals; a new one snapshots live supply again. Limit 45 still holds if none remain.

`TooManyActions` now says five. That repair landed.

## R5. Charter claim

Address Merkle (tagged leaf/node, sorted pairs, depth bound) is sound. PoB owner, collection, and window checks match the ruling. Extra accounts are not signers on the CPI. I did **not** confirm what a Core lifecycle hook does with the owner/payer signatures that `BurnV1` requires. Oracle approve/reject is tested. A hook program that receives those signers is not. Do not treat limit 46 as covering that until it is measured on the pinned Core binary.

## R6. Initialize

Wrong-but-accepted values that lock forever, beyond the launch file:

- `redeem_window_secs` may be 10. The 2.1%/hour ruling is not in the program.
- `cbob_mint` is any initialized classic mint that is not cbBTC or $GARY. Mint and freeze authorities are not read. A mint that can still print or freeze $CBOB would be permanent. The pinned mint is fine only if that pubkey is what gets passed.
- **LOW — `assert_classic_spl` (`programs/cbob-vaults/src/lib.rs`) checks token-program owner only.** A classic token account (165 bytes, same owner) is accepted as a “reserve mint.” BURN would then derive ATAs for a non-mint and never see cbBTC. Evidence: `initialize` with the three reserve pubkeys replaced by three token accounts owned by `Tokenkeg…` succeeds; a later burn of a vault holding cbBTC does not return `VaultNotEmpty`. The launch checker’s pubkey pin is the real control. The on-chain comment overclaims.

Royalty plugin authority `None` is a Core property. Nothing in these programs writes it again. I am not second-guessing the suite’s R.6/R.6a measurement.

`sweep_sol_for_swap` worst case after a correct init is still limit 10: cap × cooldown windows, operator-signed, guardian-stoppable, plus Jupiter instruction injection. Not re-reported.

Redemption cap is a 64-slot timestamp ring, not a bucket. `k = min(ceil(2.1% × live), 64)`; the k-th most recent must be ≥ `redeem_window_secs` old. Above 3,047 live it gets stricter. The ring math matches the comment.

## R7. Offsets

Recomputed from the struct fields. They match the pinned constants: SEAL collection 9, reserves vec 41; MINT `minted_total` 141, `bare_burns_retired` 454, stops 191/192, stop times 518/526, sweep bounds 257/266/274, charter close 442, tighten bounds 631/639/647, boost bounds 711/712; BURN `burned_total` 42; VaultRecord `mint_index` 41. Space constants match the field sums plus 256 bytes of padding (VaultRecord 221). A suite that only shares the test file’s offsets would not catch a program/test drift; BO.0 and 3.1w read values the program wrote and compare them to inputs, so those arms would fail if the write offset were wrong. I am not filing an offset bug.

## R8. Suite

- BO.26 does not isolate weight/epoch slippage (above).
- `ixBoost` defaults disable the new guard, so most BO allows would still pass if the guard were deleted.
- RL.7 still bounds by the cap at **max** `minted_total`, not the cap at each redemption. It cannot fail a window that exceeded the cap then in force but not the lifetime max. Round 23 F22; not fixed.
- Sim S7.2! accepts either `NoActiveVaults` or `JoinWaitingFirst`. The arm cannot tell those apart.
- No arm joins a burned waiting vault via `claim` and then shows the dead weight (limit 27 is untested in the direction that still works). The crank skip is not the program.

I did not find an arm whose `want` and `got` are the same expression.

## Accepted limits

1. **Worse than stated?** Not relative to the SPEC text in this bundle. Limit 26’s code comment is worse than SPEC; the behavior matches SPEC. Limits 27, 55, 28, and the F1 grief paragraph already include the round-23 widenings.
2. **Not actually a limit?** Limit 35 is inert at the ruled 21/51. It is still a real floor if `initialize` is given other numbers. The top-level mint check in limit 43 is still absent.
3. **Discharge false?** 12/17 is caveated by item 54. 19 is actually closed (`NotRevealed` before activate). I am not reopening those.
4. **OPEN treated as accepted?** Item 50 is still the only pre-sign control for 9 and 44, and it is still unbuilt. Item 51 is filed under OPEN AND BLOCKING but the mechanism is built and the economics are already accepted in the same paragraph. That is a miscategorized carry item, not an unfinished program. Do not “fix” it during a freeze.

## Before launch, what this process cannot do

Do these with a human who can run code and sign. Another read-only model pass will not.

1. Run `scripts/run-tests.sh` and `sim/run-sim.sh` on the bytes you will ship, and keep the logs. This review did not execute anything. A green log is the only answer to “the model misread the sysvar.”
2. Decide the boost slippage gap now. Either add exact terms (`weight` and `epochs` must match what was signed) or write the one-sided rule into SPEC and the holder guide. A program edit after the freeze starts resets the counter; that is how the last repairs became the next bugs.
3. Build the redeem page and a sweep-all Execute helper that reads balances **inside** the transaction (limit 50 / the F1 grief). Walk one three-asset redemption on a dress-rehearsal deployment, including a 1-unit deposit landing between build and send.
4. Dress rehearsal on a live cluster at throwaway ids: crank over ~2,100 vaults, one skipped slot, one RPC error mid-batch, one frozen cbBTC account, one due boost. Item 22 is still open and no model can close it.
5. On the **pinned** Core binary, not upstream HEAD: add a lifecycle hook that attempts a CPI with the claim’s owner signature. If that signature is usable, limit 46 is worse than written and the charter window cannot be paused.
6. Diff the four `initialize` transactions against `launch/mainnet-init.json` before they are signed. Then remove upgrade authority only after the redeem page exists.