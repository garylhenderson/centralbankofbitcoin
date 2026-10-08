[reasoning only]
I need to do an independent audit of the off-chain pipeline — the crank, alarm/detectors, layout, accrual, swap, revenue, and gates — plus web/test coverage, and validate round 39's verdict and repairs, so I'm going to dig into the code for real defects with evidence-based claims. Starting with the crank logic in bank/crank.mjs, I want to check the reschedule/capture logic, the reveal-in-mint-order behavior, and the retire/burn handling.

Now I'm tracing through planCrank's reveal loop and how it tracks capturedThisPass against entropy_set records, checking the slot comparisons for scheduling reveals versus captures. I'm walking through the readySlot calculation step by step against a concrete reveal_slot value to verify it matches the on-chain program's try_capture logic, computing the grouped slot windows twice to see where the off-chain math might diverge from the on-chain computation of when a captured value actually becomes available.

If that index isn't present, the lookup breaks out, which handles the edge case of a stale or raced revealed_total correctly since revealed_total only advances after an actual reveal, so the record at that index should always be level 0 unless something's out of sync.

Moving to retire-burned logic, that part is simple. For activation, I check that the asset is live, the token state is 'ok', and amount meets the 21000 threshold — importantly, a frozen account still counts as 'ok' and can activate, matching the program's round 37 V3 behavior. Now I'm working through preJoins, which filters records that are pending but not active or retired, with request_epoch before dist_epoch and asset live, determining the destination address based on whether the record is pending.

I verify preJoinWeight only uses level weight without boost, matching the join logic's LEVEL_WEIGHTS-only calculation. For retiringWeight I confirm it subtracts level-plus-boost for active retiring records, and preExpires correctly identifies active boosted records where dist_epoch has passed boost_end_epoch, subtracting the boost weight accordingly. Now I'm moving into the split calculation.

Checking the pool split math: the crank computes splitToPool as total minus the bank's cut, using BigInt floor division matching the program's bank_cut formula with the 8500/1500 basis points. I note the crank hardcodes 1500 instead of reading from cfg.split_bps, though since split_bps is fixed forever this is a minor concern. Then I move to examining the distribute decision logic, checking whether enough time has elapsed since last_distribute_at based on monthly_secs.

I'm verifying the available-balance calculation feeding into distribute — it uses pool balance plus the split amount minus owed-after-retire, and I confirm the execution order in main() correctly places split before distribute so the pool balance already reflects the split by the time distribute runs.

Checking that retiringOwed correctly subtracts pending from owed_scaled for active retiring vaults, and that preExpires's reweigh step doesn't touch owed_scaled since carry absorbs the difference — so owed stays unchanged through that step, as does preJoins since join resets debt and carry without altering owed. Now I'm moving to examine the claims loop's owed computation for a preJoined vault.

For that vault, owed is the weight times the acc delta between old and new, which correctly represents the distribution received after joining at the old acc value — verifying pendingSats properly reduces to weight*acc plus boost minus debt. For the preExpired case, I'm checking the pendingScaled computation at the expiry point using the vault's level, debt_scaled, and boost_weighted values.

After expire_boost resets, the owed amount at new acc correctly accounts for the level weight times the acc change plus the carried-over amount from expiry. Now I'm checking the general case: for vaults whose boost stays active, pendingSats should give correct owed values, but I'm second-guessing whether post-expire vaults are handled properly since they get evaluated after the distribution happens.

For a post-expired vault, expire_boost resets carry to the owed value at the new accumulator and debt to level_weight times new acc, zeroing boost — so computing owed_of just returns carry unchanged, meaning expiry doesn't alter owed at the new acc. This matches what the crank computes including boost weight at the new acc, so it's consistent.

I'm also noting that plan.owed gets reported but the actual sats only apply to selftest, and now I'm moving to examine the frozen-pool branch logic.

In this branch, when the pool is frozen and there are post-distribution joins, it batches them into plan.claims — but this only handles plan.joins, not plan.preJoins, since preJoins are sent separately as their own batches in main(). This path only triggers when a tick occurs and joins get populated through distribute, so I need to check what happens to preJoins when the pool is frozen, since those get sent in main() regardless of pool state via a separate loop — and a join-only claim doesn't actually touch the pool, so I need to trace through what the claim instruction reads.

Tracing the claim instruction, it validates pool_token against config.pool_ata, then calls monthly_inline, which returns early for a frozen pool, then processes pending records via joins without any token transfer — so a join-only claim can land fine even with a frozen pool. One subtlety: with a frozen pool and preJoins present, plan.distribute will be false since crediting requires the pool not be frozen, so the distribution simply won't run even though preJoins get sent, which is the expected behavior for a frozen pool unable to credit.

I need to check the tick condition more carefully though. If preJoins exist, waiting_to_join on chain is nonzero, so distribute would fail with JoinWaitingFirst, but the crank sends preJoins before distribute so waiting_to_join should hit zero afterward if all vaults joined, which also means those joined vaults now contribute weight — so w becomes greater than zero rather than staying at zero, meaning the w===0n tick branch wouldn't trigger in that case.

Now I'm trying to figure out a plan scenario that the on-chain program would actually reject, looking at the tick path in the distribute logic involving pending_this_epoch and the w===0n condition.

Since w computed in the plan equals zero only when preJoinWeight is also zero, no preJoins get queued -- but retiring or expiring weight could still cause a mismatch with the program's own re-read of total_active_weight at execution time, which is a possible edge case worth checking further.

I'm also noticing the crank's waiting_to_join check seems incomplete: it verifies `pending_this_epoch - retiringThisEpoch > 0` but never confirms that eligible waiting vaults (pending_count minus pending_this_epoch) are actually zero before ticking, relying instead on preJoins logic that only queues vaults with live assets.

I trace the eligibility loop further: records that are retired, active, or not pending get skipped, burned assets get skipped, and I'm checking the request_epoch condition to determine what counts as waiting-eligible for the next distribution cycle.

Every eligible waiting vault ends up either pre-joined, retired as burned, or marked unreadable (blocking the distribute), which confirms the logic holds. One edge case I'm still probing is whether a burned eligible vault gets properly retired and its pending_count decremented.

Checking the retry path for a failed retire, the benign race condition where it's already retired elsewhere just means the decrement already happened on chain, which is fine. A genuine retire failure instead surfaces as a refusal that pages loudly, which is acceptable behavior.

Now I'm turning to whether the crank correctly accounts for `boosts_due` before planning distributions — the program requires zero outstanding boosts before distributing, but I need to verify the crank's preExpire logic against how boosts_due is actually tracked on chain.

So the crank's preExpires equals due boosts minus those being retired this pass, and retiring a due boost decrements boosts_due, so after both operations boosts_due reaches zero correctly. I note a subtlety: if a retire fails, boosts_due stays elevated and distribute would refuse with BoostsExpireFirst, which gets flagged loudly as a failure.

Checking the batch size constraint, I see EXPIRE_BATCH is capped at 20 against a program-enforced MAX_EXPIRE_BATCH of 30, with a selftest confirming that invariant holds. The expire_boosts call requires a non-empty batch under the max, and I'm tracing how the crank constructs the transaction instruction passing config plus the batch of record addresses as remaining accounts, since the Anchor accounts struct for ExpireBoosts only declares config explicitly.

Looking at expire_boosts logic, it silently skips records that aren't actually due (retired, inactive, zero weight, or not yet past boost_end_epoch), so a race condition where the crank sends a stale record is harmless since nothing gets refused — it just no-ops on that entry. The emptiness check only guards against the crank sending nothing at all.

Now checking the claim instruction with crank_n=0: the crank sends config, pool_token, and token_program followed by pairs, matching the Claim accounts struct which only declares those three explicitly, so the remaining accounts correctly resolve to the pairs list.

I'm now tracing a subtler issue in how the planner batches joins together with payouts. Post-distribution joins get appended to the ready list and folded into the same batched claim transactions as regular payouts — I need to verify the epoch math lines up so these joins are actually eligible by the time the transaction executes, and that the destination account resolution (vault_ata vs token address) is consistent for both join and payout cases within the same batch.

I confirm that `r.vault_ata` gets set before a vault is marked pending, so the destination resolution holds up, and frozen pools correctly restrict claims to joins only. Now I want to check whether distribution could get rejected if a planned split transaction actually failed to land — since the plan counts toward available funds assuming the split succeeded, but a benign failure (like someone else already splitting) could throw off that assumption.

Actually if a stranger beats us to splitting, the funds still end up in the pool either way, so available balance stays correct and the race is harmless. The real risk is if the split fails for a different reason, leaving the pool underfunded relative to what was planned.

Now I want to verify main()'s send ordering against the plan, particularly checking the round 39 repair test. I confirm the selftest script now extracts the send block and checks the order of operations: retire, join, expire-before, distribute, expire-after, activate, claim, claim — that looks correct.

But the extracted block starts after the reveal/capture sends, which happen earlier in main(). So a mutation deleting the reveal loop wouldn't be caught by this test. I need to check if there's a separate arm verifying that main() actually sends the planned reveals, since the crank's reveal loop isn't covered by the current order assertion.

Though actually since `d('reveal_level')` shows up in the source's instruction-name list, deleting the reveal send would remove that name from the array, which would break a different arm checking that the name list includes 'reveal_level'. So that gap is weakly covered.

Now I want to look for new defects, starting with whether planCostLamports correctly counts transaction costs across all plan categories.

Looking at the math, it sums reschedule, capture, reveal, retireBurned, activate, and claim transactions, plus split and distribute if present, then adds batched counts for preJoins, preExpires, and postExpires divided by their batch sizes. That looks like it properly counts every transaction type.

Then I'm checking judgeFeePayer and budgetPlan, which validates the fee payer has enough lamports against a ceiling and floor requirement, and computes remaining room after subtracting the base plan cost and floor from the available lamports.

Now I'm verifying the crank sequencing — activate runs after distribute, with each activate call also running monthly_inline, which matches the RT3-6 ordering requirement. I'm also confirming that plan.activate only includes records that are neither pending nor active, and that the vault_token account passed into the Activate instruction resolves to the canonical ATA, matching what the program derives and requires for equality. Now I'm considering whether a vault could appear in both plan.activate and a newly-joined set after a distribution happens.

Since activate explicitly excludes pending records, there's no overlap there. I'm checking tokenAddr logic: for active records it returns r.vault_ata, while for inactive ones (including pending) it computes the canonical ATA — and since the program set r.vault_ata to that same canonical address at request time, these always match. The reveal flow's hash check and judgeRevealAttrs handling for the 'revealed' state look correct too, so I'm moving on to examine the reveal instruction itself.

I'm verifying the account ordering for RevealLevel against the expected keys list — config, vault_record, asset, collection, payer, mint_authority, slot_hashes, mpl_core, system_program — and it lines up correctly.

Continuing through the remaining instructions: CaptureEntropy, RescheduleReveal, RetireBurned, and SplitRevenue all check out against their expected account structures, matching vault_record and slot_hashes, vault_record alone, config/vault_record/asset, and the revenue split accounts respectively.

For Distribute, config and pool_token match with remaining accounts empty when burn is false. For Activate, I'm checking that config, vault_record, asset, vault_token, and pool_token all line up — noting that monthly_inline reads pool_token as unchecked but doesn't move tokens, so it's fine. Now I'm moving on to verify the claim instruction's accounts.

I'm also checking the fee payer setup across these crank transactions — the crank key signs as payer everywhere, and reveal has an explicit payer account too, which looks correct. Then I want to verify the crank can't accidentally pay into or join a dead vault: the planner already excludes burned assets from joins and claims, requires 'live' status for activate and 'burned' for retire, and unreadable assets get reported and skipped during claims.

Now I'm tracing how assets get classified as live, burned, or other based on their owner and data bytes — a live Core asset has data[0] equal to 1 for KEY_ASSET_V1, but this check doesn't verify the collection membership directly. Since the vault record's asset is pinned by the record's seed address, and the record only exists if MINT created the vault within its own collection, the asset is implicitly guaranteed to belong to the right collection, so this seems fine.

I'm now worried about `getMultipleAccountsInfo` with chunked keys — if a chunk returns fewer elements or throws, any record indexed beyond the returned array becomes undefined and falls safely into 'other', but if a chunk throws entirely, the whole batch fails loudly rather than silently miscounting, which is actually the safer failure mode since it blocks the crank rather than paying out incorrectly.

Then I shift to checking the heartbeat logic around `plan.problems`, noticing that `plan` gets reassigned to the budgeted `fee.plan` object, so I need to trace whether `plan.problems` still points to the right data after that reassignment.

Now I'm cross-checking the exact problem message strings between crank.mjs and detectors.mjs to make sure the health-detection logic matches on frozen-pool text, frozen-revenue text, and the revenue-split-blockers message word for word.

Confirming the selftest case R27 L2 exercises the real planner correctly, then shifting focus to look at the crank's `--reveal-only` lane and its `getProgramAccounts` memcmp filter on the `level` offset for potential issues.

Working out the VaultRecord field layout to confirm the level offset lands at byte 57, which matches the memcmp filter targeting records where level equals zero. Now I'm checking whether the reveal-only lane skips fetching assets, since that branch might leave `assets` empty rather than actually querying them.

Actually, main() fetches assetInfos for all records regardless, just a smaller filtered set in reveal-only mode, and the reveal send path correctly pulls from that populated assets map. I'm moving on to look at the alarm and detector logic next.

For `detectSweepState`, the cooldown calculation filters out undefined/NaN values before taking the minimum against a 21600 cap, so it safely defaults to 21600 when no valid values exist. `detectUnsweptRoyalties` looks fine. In `detectRedemptionRate`, I'm checking how the ring buffer entries (stored as strings) get converted back to BigInt for the time-window filtering comparison.

Tracing through `detectRedemptionRate`'s logic, it returns early if remaining already meets capacity, and otherwise only triggers paging when remaining drops to within 20% of the cap. Now I'm checking `detectDistributionOverdue` for its zero-window and pool-availability guard conditions.

For the case where the window is positive, the pool has available funds, and the lateness exceeds the grace period, this flags a critical overdue distribution — but I recall that pool freezes don't block manual `distribute` calls in MINT, so this alert can legitimately fire during a freeze, which matches what the earlier round already confirmed as accurate and not worth re-filing.

Checking `detectPoolHealth`'s insolvency logic, it computes the ceiling of owed amount divided by the scale factor and compares it against the token balance — this correctly mirrors the program's own ceiling-based accounting.

readPool also reads config and pool atomically via a single multi-account call, avoiding a race condition. I then verify WATCHED_KEYS against readConfigs' flattened output across seal/mint/burn/gov prefixes, confirming each watched key maps to an actual config field, and the selftest correctly checks for missing keys.

Now I'm checking detectConfigDrift's skip logic: it ignores a key when the previous value is null/undefined and the corresponding missing flag is true, and treats third-party keys as skipped when undefined. For applyFrozenTransitions, I verify the composite key format using kind, asset, and mint, confirming pool_frozen resolves correctly when asset and mint are undefined.

I'm also examining the baseline-advance logic in the alarm's report function: when a report isn't delivered, baselines are rolled back but paged state still merges in sent pages, and seenSplits/seenRedemptions/logGaps aren't reset on failed delivery. That seems fine since those represent accumulated chain evidence rather than suppression baselines.

For crankHealth, I'm checking whether an undelivered finding still advances the failing streak — it does, but since findings are recomputed from the streak count on the next pass, the finding gets re-reported anyway, so that's not a bug. I'm now tracing whether royaltyLamports and royaltySince being kept on undelivered reports could wrongly suppress the next pass's comparison, since the next pass's "previous" value becomes the updated one rather than rolling back.

I notice `frozen` is correctly rolled back when undelivered, so no issue there. Now I'm checking the detectUnreconciledRevenue calls with cycleStartMs and chainNow across the early-return and full paths — those look consistent. I'm shifting focus to look for a real defect in the alarm's cursor/backlog logic, examining how unread signatures and gaps update the backlog's head and before pointers.

Verifying edge cases: if gap is true, sigs.length must be greater than zero since gap only triggers when maxPages is reached with full pages or signature count exceeds PER_PROGRAM_READS, so sigs[0] is always safe to access. Now I'm tracing the walkSigs call parameters to see how the page limit is calculated.

With PER_PROGRAM_READS=2000, maxPages comes out to 2, so each walk fetches up to 2000 signatures across two pages of 1000; if gap triggers, all 2000 get sliced and the next pass resumes from the last signature. I'm now considering what happens if a transaction in the middle turns out unread—neither cursor nor backlog would advance in that case.

Since the cursor stays put, the next pass re-walks the identical window, which is redundant but harmless since the log gaps dedupe through a Set. The real issue is that findings from this partially-read window keep getting re-reported each pass, since one-shot urgent findings carry a fresh pass stamp that looks "new" to the router, so it lets duplicate emails through until the unread transaction finally resolves—noisy but not a correctness bug. I'm now checking the dedupe logic in detectDeferredSweeps.

I notice the deferred-sweep input array has no dedupe applied, so if the same sweep gets deferred repeatedly due to a stuck cursor, both `deferred` and `keep` would accumulate duplicate entries. The undelivered branch filters duplicates by signature, but the delivered branch skips that dedup step entirely, meaning stuck cursors could let duplicate sweep findings pile up unchecked.

This is really just cosmetic noise rather than a meaningful bug, same class as the earlier round's duplicate-line issue — not worth flagging beyond a low-severity note. I'm now checking the alarm kinds list and length constraints, confirming the selftest derives kinds from source correctly, then moving to verify the layout offsets and fixed-length handling.

I'm now manually tallying byte offsets through the MintConfig struct fields (discriminator, version, collection, governance, pool_ata, round_id, timestamps, price, caps, totals, treasury, flags) to confirm the running total matches the expected fixed length of 1005 bytes.

Still calculating field offsets...

Still summing field offsets...

Adding up to 1261 with padding included, which matches the selftest's expected 1005 before padding. Now I'm verifying the VaultRecord struct size by summing its field byte widths in declaration order.

Adding padding of 10 gives 221, matching SPEC's expected byte count. I realize I'd been tracking end offsets rather than start offsets, so I need to recheck the cross-program references: minted_total actually starts at 141 where minted_this_round ends, which matches GOV's expectation, and similarly bare_burns_retired should start where charter_claimed ends at 454.

Checking further, governance starts at 41 right after collection ends, and pool_ata sits at 73 where v5's distributor wallet used to live—both match SPEC. The layouts all line up correctly, and the SEEDS assertion with SEED_SRC mapping all 11 entries checks out too. Now I'm wondering whether a struct change could slip past validation, since parseRustStruct is strict and throws on unparseable lines, so I need to verify what happens if a field gets added to the Rust struct.

A mismatch would surface if a field were added to layout.mjs alone, reordered, or had its type changed, and version bumps or space changes are caught by the respective test arms. One potential gap is FIXED sizes—if u64's size changed, the Rust comparison wouldn't catch it directly, but the fixedLength check against MINT_CONFIG_SPACE would, and decoding would break anyway, so that's covered. The BOOST_RING array size is also verified by checking the ring size against the fixed size divided by four, confirming consistency before moving on to check accrual.mjs against the spec.

Checking credit() against the program logic, both compute the delta the same way and update accumulator and owed identically. Then verifying pendingScaled matches owed_of's weight calculation using level weight plus boost, confirming the carry/debt arithmetic lines up including the overflow behavior—accrual throws on negative while the program's checked arithmetic aborts, which is equivalent. Now I'm looking at the ceilSats rounding formula.

Next, comparing available() against the program's balance-minus-owed subtraction with underflow handling, then reweigh() against the program's reweigh function, confirming boost, carry, debt, and weight updates all align—noting the crank doesn't need the returned total weight. I'm now checking debtAtActivation against its program counterpart.

In the join path, debt is weight times accumulator using only level weights with no boost, since a pending vault can't have a boost—boost_vault requires active, non-retired, non-pending status, which confirms correctness. For claim's settlement, the program updates carry and debt post-claim, but since the crank only computes owed before any claims happen, this discrepancy doesn't matter. Now I'm checking whether the crank expires every vault correctly.

Checking whether the crank expires every due boost before distributing—yes, via preExpires—and whether each distribution immediately makes newly-due boosts due right after, which it does through postExpires for boosts ending at the next epoch, since the distribution epoch increments. The alarm system pages on stalled boosts and treats the mint and bounds as permanently fixed, which checks out, so R4 looks solid. Moving to R5, the swap logic, which is the densest section—I'm now tracing through the oracle price math.

I derive the sats-per-lamport conversion by combining the SOL-to-lamport ratio, the SOL/USD price with its exponent, the inverse of the BTC/USD price with its exponent, and the satoshis-per-BTC factor, confirming the exponent arithmetic simplifies correctly to match the code's calculation of `expectedSats`. The BigInt division floors the result, which is the conservative direction since it lowers both the expected value and the resulting minimum threshold.

For the deviation filter, I'm checking that converting `sol.price` and `btc.price` to JavaScript numbers stays exact since both price magnitudes are well under the 2^53 safe-integer limit, so the floating-point division used there should match the BigInt-based calculation closely enough.

I'm also verifying the exponent difference logic handles mismatched decimal scales correctly—for example if sol.expo is -8 and btc.expo is -5, the difference of -3 means multiplying the denominator by 1000, which checks out against the sats-per-lamport formula.

Float precision isn't a concern here since the 100 bps deviation tolerance swamps any floating-point rounding error (~1e-16 relative). Checking whether the 150 bps deviation floor is realistic: Orca's 16 bps fee plus minimal price impact on a $10M pool plus ~1.5 bps oracle confidence all comfortably fit under that floor, so an honest pool shouldn't trip it—though I need to check whether the deviation gate still allows some edge case through.

With 10 SOL against a $10M pool the price impact is negligible, around 0.01%, so that's fine. Now I'm checking the Pyth account derivation logic—deriving the price feed PDA using a shard ID of zero and the 32-byte feed ID under the push oracle program, which matches Pyth's documented account derivation scheme. Then I verify the account owner matches the Pyth receiver program before parsing the price data starting after the discriminator and key fields.

Working through the PriceUpdateV2 byte offsets, checking verification level equals Full, then extracting feed ID, price, confidence, exponent, and publish time at their respective byte positions based on the known struct layout from the pyth-solana-receiver-sdk.

The code correctly rejects Partial verification since that extra byte would shift offsets, and the length check ensures publishTime's offset is safely within bounds for a Full update. Now I need to check whether ownership, derived address, and feed id checks combined with Full verification are actually sufficient to prevent someone from writing a fully-verified update with a stale publish_time or arbitrary price into that account — looking at how Pyth's receiver program writes to PriceUpdateV2 accounts.

For the sponsored shard-0 PDA, writes are gated by the push oracle verifying the Wormhole VAA with guardian signatures, so the price itself is attested and can't be freely chosen by an attacker. I'm now checking whether the push oracle program enforces that a new update's publish_time must be strictly newer than what's already stored, which would block replaying an old attested update.

Even setting that aside, the staleness check already rejects anything older than 180 seconds, so a replayed stale update would fail regardless. I'm also considering whether an attacker could close and recreate the account with arbitrary data, but since the account address is a PDA whose seeds are controlled by the push oracle program itself, only that program can allocate or rewrite it—an attacker can't spoof a different account at that same derived address.

I'm working through whether the PDA is created under the push program's seeds but owned by the receiver via `init`, so the account structure and signer setup determine which program actually owns the resulting account.

Still tracing account structure...

So with `init_if_needed` and no seeds specified on the receiver side, the System program creates the account with the receiver program as owner, while the push program's PDA still signs as the creator. This confirms the account is a PDA derived under the push program but owned by the receiver—matching swap.mjs's checks and validated by the fork test against real cloned accounts.

I also confirm the receiver's post_update logic requires write_authority to be a signer matching the stored value, meaning only the push program's PDA can perform updates. For staleness, market() reads the clock sysvar and verifies it's owned by the Sysvar program, which is reliable since the runtime writes that data directly.

One subtlety: clockUnixTimestamp requires the clock data buffer to be at least 40 bytes and reads the unix_timestamp field at offset 32, matching the standard Clock layout (slot, epoch_start_timestamp, epoch, leader_schedule_epoch, unix_timestamp). That checks out.

Now I'm turning to the deviation filter, looking at how orcaSpot computes price from sqrtPrice — squaring sqrtPrice/2^64 to get the Q64.64 representation of sqrt(price), where price is token B per token A, with token A being wSOL.

I'm working out that price should come out as cbBTC raw units per wSOL raw unit, i.e. sats per lamport, which lines up with what f.satsPerLamport expects. Then I'm sanity-checking the magnitude: roughly 1 SOL equals about 140,000 sats, so per lamport that's around 1.4e-4 sats, giving a sqrtPrice near 0.0118 before scaling by 2^64 — confirming the precision handling is reasonable.

Converting that scaled sqrtPrice to a JS Number loses only around 1.1e-16 relative precision, which squares to roughly 2.2e-16 — negligible compared to the 100 bps tolerance I care about.

Now I'm double-checking the byte offsets in the Whirlpool account layout to make sure sqrt_price is being read from the correct position, tracing through discriminator, config, bump, tick spacing, fee rates, and liquidity fields to confirm where sqrt_price actually sits.

I'm verifying that readWhirlpool correctly pulls tickSpacing, feeRate, liquidity, sqrtPrice, tickCurrent, mintA, vaultA, mintB, and vaultB from the right byte offsets, and that it validates mintA is WSOL and mintB is CBBTC, throwing if the buffer is too short. Since the real Whirlpool account is 653 bytes and the fork test checks these fields against the live pool, I'm confident this parsing is correct.

For Meteora's DLMM pricing, I'm working through the bin price formula: Y_raw per X_raw equals (1 + binStep/10000)^activeId, which gives lamports per satoshi since cbBTC is X and wSOL is Y. Taking the inverse of that raw price gives sats per lamport, confirming that meteoraSpot correctly returns the inverted price.

I check the numbers: solving (1.0015)^id ≈ 1/1.4e-4 ≈ 7143 gives id ≈ 5920, matching the mainnet-measured activeId of 5920 from the comment — a solid consistency check confirming binStep 15 corresponds to 0.0015. Floating-point precision for raising 1.0015 to the 5920th power should be fine, accurate to about 1 ulp.

I note the deviation filter uses floats with tiny relative error against an exact 100 bps gate, so edge cases right at the threshold could technically slip through, but that's immaterial in practice. The filter compares spot sats-per-lamport against the oracle value symmetrically with an absolute difference, so a pool that's 99 bps worse still passes — consistent with the stated bound. Now I'm turning to the minimum-out construction for the swap instruction.

I'm verifying the Orca swap instruction layout: amount, other_amount_threshold, sqrt_price_limit, amount_specified_is_input, and a_to_b, summing to 42 bytes, matching the judge's length check. Since amount_specified_is_input is true, the threshold field is the minimum output in cbBTC base units, which matches minSats correctly. Now I'm shifting to check the Meteora instruction encoding.

Meteora's swap takes amount_in and min_amount_out, both u64, totaling 24 bytes, which lines up with the judge's expected length, and min_amount_out is also in sats. I'm then tracing whether the deviation filter and the guaranteed minimum both derive from the same market read—confirming market() computes f from the oracle and revenue.mjs uses m2.f.minSats as guaranteed, both sourced from the same post-sweep read, so that's consistent. But I'm catching a subtlety: revenue.mjs actually computes minOut from the first quote's outAmount rather than from this same market read, which could be a mismatch worth digging into.

Now I'm checking whether the drift check uses m1.f.expectedSats while guaranteed uses m2.f.minSats, and whether the venues list is consistently drawn from m2—that all lines up. Moving to scrutinize judgeSwapInstructions, I'm working through what it verifies: it requires exactly seven instructions checked positionally, starting with a ComputeBudget SetComputeUnitLimit instruction with specific data length and opcode, then a global pass ensuring every instruction's program ID is in the allowed set, no unexpected signers besides the owner, no attempt to set a custom compute unit price, and that token instructions are restricted to a specific allowed list.

Continuing through the positional checks, I'm verifying the ATA creation instruction's key ordering, that there's exactly one System transfer instruction pointing at the owner's wrapped SOL account, that the SOL-wrapping transfer instruction has correct opcode and amount, that the sync-native instruction references the right account, a second idempotent ATA creation for the output token, and finally the swap instruction itself checking program ID, data length, discriminator, amount, floor, and venue-specific parameters like Orca's sqrt price limit and flags.

Then I'm making sure the swap's output account matches the operator's own output token account, that the minimum-out value encoded in the instruction matches the floor, and that direction flags are correct — for Orca there's an explicit byte check, while for Meteora direction comes from which accounts serve as input versus output.

I'm also verifying no priority-fee drain is possible: SetComputeUnitPrice is rejected outright, exactly seven instructions are required with ComputeBudget only allowed at position zero, and slipping in a data-size-limit instruction would break the count check anyway, so fee manipulation is blocked. ✓

RequestHeapFrame instructions are similarly rejected. ✓ The ATA creation check pins the exact keys and derivation, so a mismatched account would fail both the judge and the on-chain program itself. ✓ Now I'm probing whether a tampered builder could slip past the validator by exploiting something the judge doesn't check, like the total key count or extra keys beyond what's pinned.

I'm recalling that the venue program itself validates the pool-owned accounts — vaults, tick arrays, etc. — via constraints matching the whirlpool's stored mint and vault addresses, so tampering there would fail on-chain regardless of the judge's checks.

The oracle account is derived deterministically, so vaults and tick arrays are properly pinned by the pool. But I notice token_owner_account_b (the output account) only checks mint equality -- without the judge's pinning, a tampered builder could redirect output to a stranger's cbBTC account since the mint constraint alone doesn't guarantee correct ownership.

Looking at Meteora's swap, host_fee_in is unpinned and defaults to a null option, meaning a tampered builder could substitute a real token account there to skim the host fee -- I'm estimating the magnitude of that skim based on typical protocol fee shares on a 10 SOL swap.

Even with that unpinned key, the swap's output is still bounded by min_amount_out and the revenue delta check, so the impact stays trivial and matches what I already flagged under C15 rather than something needing separate filing. I'm also noting that the judge doesn't verify bin arrays, the bitmap, or event authority accounts, though Meteora enforces bin array validity through its own `has_one lb_pair` constraint and bitmap seeds.

Checking whether a tampered sequence could swap in Token-2022 for one of the token programs — but that would just cause Meteora's own mint-owner check to fail, so it's not exploitable either. Then I consider whether the operator could route output to a non-ATA cbBTC account instead of the pinned ATA, but since the judge pins output to the specific ATA and revenue.mjs reads from that same account, this path seems closed too.

Next I check the wrap instruction: the judge requires exactly one System transfer with the correct data length and amount matching the sweep, so there's no way to over-wrap through a second funding source.

Then I'm tracing whether a tampered builder could inject different `lamportsIn` or `minSats` values than what the cycle actually computed — since these come from `sweepAmount` and `m2.f.minSats`, I need to check if a corrupted `market()` call could feed in a mismatched amount.

This confirms the same residual gap as the earlier "same tree" limit — a tampered swap.mjs can defeat both checks since the judge only compares against values it was told, not independently verified ones. Now I'm moving to account derivation, starting with how Orca tick array start addresses are calculated from the current tick and tick spacing.

Checking the PDA derivation, Orca's seeds use the decimal string of the start tick index, which matches the expected convention, and flooring correctly handles negative tick values by rounding toward negative infinity.

For a_to_b swaps the price decreases, so the needed tick arrays are the current one plus the ones below it, and Orca's SDK confirms this ordering. I'm also thinking through the edge case where the current tick sits exactly at an array's starting boundary, and how Orca's swap manager handles determining which array still counts as "current" in that situation.

For b_to_a there's a known +1 shift since the next tick above might fall in the next array, while a_to_b with offset 0 starting from tick_current is correct since that array already contains the current tick.

Another real failure mode is an uninitialized tick array — Orca's loader requires the account to already be initialized, so if tick_array_1 or _2 isn't set up, the swap fails outright with AccountNotInitialized. If price sits near the bottom of its liquidity range with uninitialized arrays below, Orca swaps would consistently fail there, triggering fallback to Meteora, and if that also fails, SOL stays stuck on the operator with an alarm raised — a liveness issue rather than a security defect.

But I'm checking how likely that actually is: for a ~$10M SOL/cbBTC Whirlpool with tickSpacing 16, each array spans roughly 15% of price range, so two arrays below cover about 30% downside — a range where LPs may not have bothered to initialize if no one holds positions there. Though I should check whether Orca's SDK already fetches/handles array initialization before building the swap, which might mitigate this concern.

I'm second-guessing whether duplicating the same tick array account three times would even work, since Anchor might reject borrowing the same mutable account twice with an AccountBorrowFailed error, even though the Solana runtime itself permits duplicate accounts.

Now I'm recalling Orca's SDK logic for computing tick array addresses — it loops through possible arrays and, once it hits one that's uninitialized, pads the remaining slots with the last valid array address instead of duplicating from zero.

I'm also trying to recall how SwapUtils handles uninitialized tick arrays, possibly falling back to the last valid one, and checking whether Orca's on-chain swap handler allows passing the same tick array account multiple times by loading them via a SwapTickSequence struct.

Since tick_array_0 is a required account with a has_one constraint on whirlpool, but tick_array_1 and tick_array_2 use load_mut().ok() for optional loading, I'm wondering whether Anchor's account-level constraints would still fail validation before the handler even runs if those arrays are uninitialized or invalid.

With AccountLoader, Anchor checks owner and discriminator at the account level, so an uninitialized array would actually fail deserialization and error out the instruction — meaning uninitialized arrays genuinely can't pass through silently. But the load_mut().ok() pattern seems designed specifically for the case where the same account gets passed twice (duplicate borrow), since a second mutable borrow attempt would fail and resolve to None rather than erroring the whole instruction.

So the real question is whether our three derived addresses actually correspond to initialized accounts. If the second or third tick array address is uninitialized, Anchor's validation would reject the whole swap outright. I need to check whether that's a realistic scenario for this specific pool given its tick spacing and current tick — calculating the span in ticks to see how far the price could move before hitting an uninitialized array.

The builder requiring three initialised arrays when only one is actually needed is a real latent fragility — SW.1 proves it works today against cloned mainnet state, but if price drifts so the two lower arrays become uninitialised, every Orca swap fails and falls back to Meteora, which is thinner and could trip the 150 bps floor. The swap logic lives off-chain in `bank/swap.mjs` so it's fixable later, though the tree is currently scope-frozen for a clean round; the plan step clones a narrow window of arrays relative to the current price.

I'd classify this as a liveness hazard rather than loss-of-funds — bounded by the fallback and loud alarming — so I'd file it as LOW/MEDIUM with a fix to derive the three arrays but substitute array_0's address for any that's uninitialised, though passing the same account twice could trip up Anchor's account validation.

Actually checking whether `try_accounts` on the AccountLoader borrows data to verify the discriminator, then releases it before `has_one = whirlpool` checks ownership — Anchor's duplicate-account pattern here should work since the borrow doesn't linger across the constraint checks.

The second load_mut() would just fail safely since the has_one check via load() happens earlier during try_accounts, before any mutable borrow occurs. I'm now questioning whether Solana's runtime actually shares the same underlying RefCell between duplicate AccountInfo entries, since that's what determines whether this borrow conflict happens at all.

I should check whether this issue is already flagged elsewhere in the spec or prior audit rounds — the spec's account constraints don't mention uninitialized tick arrays, and the earlier verdict doesn't cover it either, so this looks like a genuine new finding worth documenting.

Actually the audit prompt directly asks about tick-array boundaries and uninitialized arrays, so this is a solicited question I should answer with concrete evidence: cloning a mainnet fork with only `s0` (omitting `s0-span`) should cause the SW.1 swap test to fail with an Anchor account error on tick_array_1, while substituting array_0's address for arrays 1 and 2 should let the swap succeed — I want to verify this against current on-chain account state to confirm the fork's behavior matches mainnet reality.

I'm also working through the boundary case where `tickCurrent === s0` exactly during an a_to_b swap: since Orca's search starts at the current tick and moves downward, array_0 only contains s0 itself in range, so if s0 isn't an initialized tick the search falls through to array_1 (starting at s0-span) — meaning array_1 is genuinely required at this boundary, and if it's uninitialized the swap would fail the same way. I'm now considering whether there's a further subtlety in how Orca's search behaves specifically for a_to_b swaps at this boundary.

For Meteora's Y→X direction, I'm checking that its bin array index computation (floor division of bin_id by 70, matching Rust's div_euclid for negative values) lines up correctly with JavaScript's Math.floor-based implementation.

Swapping Y for X raises the active bin id, confirming the array selection order of [i, i+1, i+2]. Now I'm writing the helper that derives the bin array PDA seed by encoding the index as a little-endian 8-byte integer.

I also want to check whether uninitialized bin arrays cause issues—Meteora passes bin arrays as remaining accounts and lazily loads them into a BinArrayManager, so I need to think about what happens if one has System as its owner rather than being initialized.

Meteora's own SDK typically computes exactly which arrays are needed for a swap, whereas our builder always passes a fixed three—so this is really one finding spanning both venues: the builders assume three liquidity-array accounts must exist per swap, and an uninitialised one simply refuses the transaction. Given it's a liveness issue with visible fallback and off-chain fixability (not locked by immutability), I'm leaning toward calling this MEDIUM severity rather than high.

Tracing the consequence further: since the cycle already sweeps SOL to the operator before the swap loop runs, a venue refusal leaves that SOL stranded on the hot operator key with the cycle stuck open, triggering a CRITICAL page and blocking all subsequent runs at the open-cycle guard until a human manually completes the swap—effectively wedging the whole revenue pipeline.

Since this pages but doesn't lose funds, I'll file it as MEDIUM severity. The root cause is that `market()` never actually reads the tick/bin arrays, so it blindly reports both venues as usable even when their arrays are uninitialized, letting the sweep proceed before the swaps fail; the fix is to have `market()` check array loadability per venue and mark a venue unusable (skipping the sweep) if its arrays can't be read.

I want to double-check the claim about Orca's account validation — if their swap context actually tolerates uninitialized arrays via `UncheckedAccount`, my finding needs reframing to be verifiable either way: "if Orca/Meteora validate these accounts like their Anchor contexts do for bin array loaders, the swap will refuse" — and I should back this with a fork test that only clones the arrays that actually exist.

I also notice the fork test script deliberately clones five tick arrays and bin arrays per venue, which corroborates that the author assumed these accounts need to be present — not proof, but supporting evidence. Now I want to check how wSOL handling works, looking at how the swap instructions set up an idempotent ATA creation followed by a lamport transfer and sync.

If the operator's wSOL account already holds a balance before the swap, that balance just gets folded into the wrap and the net new amount sold stays fixed at lamportsIn, with the leftover unwrapped back to the owner — so a stranger pre-filling the wSOL account doesn't change the swap amount. Now I should check what happens if that account is frozen instead.

If the swap doesn't fully consume the input due to liquidity exhaustion, the leftover wSOL gets unwrapped back to the operator as native SOL on close. That would make the cbBTC delta check in revenue.mjs fail against the guaranteed threshold, throwing and leaving the cycle open — the swapSig gets recorded but returnedSats stays unset, triggering an unreconciled_swap CRITICAL alert.

But actually, since min_amount_out enforces minSats on-chain, a partial fill yielding less than minSats would revert entirely, so that failure mode can't land. A partial fill yielding >= minSats could still succeed though, completing the cycle while leftover SOL gets unwrapped to the operator instead of the revenue address — meaning funds leak outside the accounting.

So the floor essentially enforces near-full input at oracle price, confirming the guard holds. Looking at the retry logic, I see Meteora only gets tried as a fallback when the first venue's failure is explicitly classified as 'refused' — other outcomes either record success or propagate the error, which makes me wonder about an 'unknown' timeout case with no clear resolution.

If the swap confirmation times out without a status, the error throws and leaves the cycle open with a pending swap signature, satisfying the rule that Meteora should never be attempted on an unconfirmed send. I'm also checking whether a late-landing swap after a timeout could cause a duplicate attempt — since the recovery routine in main() only auto-closes cycles with returned funds recorded, and this cycle has none, it stays open and requires manual recovery, preventing an automatic double swap. Now I want to check whether this could create a double-count in the ledger.

I'm tracing how `cycleIsOpen` determines state (swept > 0 and returnedSats == 0), confirming the ledger only marks a cycle as closed once a cbBTC return has actually been verified on-chain by comparing the operator's token account balance before and after. The code reads the current balance, computes the delta, throws if it's below the guaranteed amount, and only then attempts to send the confirmed return transaction, recording any failure for later retry.

If the return transaction itself times out, the system remembers the pending signature but still treats the cycle as open since `returnedSats` stays zero, triggering a loud critical alert even though the cbBTC may have already arrived—so I'm checking whether that's actually the safe fail-closed behavior intended here.

I also want to check what happens if the operator's ATA carries leftover balance from a prior failed cycle: the ledger records only the intended delta even though the full balance gets transferred, but since the split moves everything and that amount always covers at least the recorded delta, the closesCycle check still holds.

Now I'm bounding what an adversary could extract within the system's tolerance — looking at the lamports-in cap per cycle and the worst-case slippage versus oracle price that a sandwich attacker could realistically capture.

A sandwich attacker's profit is capped by the gap between pre-sandwich and execution price minus their own fees, and the on-chain floor limits our loss to 150 bps of the 10 SOL cap, or about 0.15 SOL per cycle — working through the cooldown and effective job cadence, that comes to roughly 0.51 SOL/day, around $61/day or $1,800/month at current prices.

However, this assumes every cycle hits the full royalty cap, which would require 340 SOL/day of secondary volume at 10% royalty — unrealistic in practice, so actual exposure is likely much smaller. I'm also weighing that attackers pay swap fees twice and need real capital to move price 1.5% in a $10M pool, so extracting ~$18 per cycle may not even cover their displacement costs, making the attack marginally profitable at best.

On a thinner $0.9M Meteora pool though, the same price push is roughly 10x cheaper, so a sandwich becomes plausible there — especially since the deviation gate is checked only at build time, meaning an attacker inserting a sandwich within the same block can bypass it entirely. I'm also considering whether an attacker could manipulate Orca's own price to force routing toward the more exploitable Meteora path, though that itself requires moving Orca's deeper liquidity, which is expensive.

Working through the worst case where an attacker holds a pool near the edge of the gate: every swap would execute around 115 bps below oracle, which sits within the floor and therefore lands. That works out to roughly 0.115 SOL loss per 10 SOL cycle, or about 11.7 SOL/month if royalty volume stays near 34 SOL/day — around 1.15% of royalty revenue, which matches the 150 bps bound already stated in the spec rather than being a new finding. I'm checking whether this changes the operator key's worst-case exposure, but it remains bounded by the per-sweep cap and cooldown windows until the guardian intervenes.

Now I'm tracing whether the ledger could mistakenly mark a failed cycle as closed, looking at how `cycleIsOpen` and `sendRejected` interact and whether `classifySendFailure` could wrongly return 'refused' for a sweep that actually landed — checking the preflight regex match, settled error status, and expired-with-no-status cases, and digging into how `sendAndConfirmTransaction`'s preflight failure gets surfaced as a SendTransactionError.

I confirm the "custom program error" regex wouldn't misfire on a landed-but-failed transaction, since the error JSON uses capital-C "Custom" rather than that exact phrase, and the "Error Code:" string also doesn't appear there — so I'm now checking whether a landed-and-succeeded transaction that merely times out on confirmation could trip the expired-with-no-status branch incorrectly.

For `TransactionExpiredTimeoutError`, web3.js embeds the signature both in the message and as an `e.signature` property, and `sendFailureSignature` reads `e.signature` first, so extraction should work correctly there too.

For the "expired and no status" case, when status lookup returns null with history search enabled and the blockhash has expired, that transaction genuinely can't land later, so refusing is correct. Moving to revenue.mjs, I'm checking that sweep amount is capped by the minimum of the per-cycle limit and the chain cap, with a zero-amount check that returns early — though I want to verify what `sweepAmount` actually does in that zero case.

Looking at `sweepAmount`, it returns 0 if the computed amount falls below the minimum sweep threshold, and the log message about "nothing worth sweeping" covers this case correctly even when the balance is below reserve. Now I'm tracing through the open-cycle recovery logic — filtering unsplit returns, filling in block times, computing splits since, and determining cycle closure — but I notice the recovery path only handles cycles where returned sats are nonzero, so I need to check what happens to a cycle that swept successfully but never completed its split.

That confirms the guard correctly throws for an open cycle that returned stays open. Then I trace `splitsSince`, which walks revenue ATA signatures across bounded pages, reading each transaction and computing revenue outflow, and I note that if reading a transaction throws due to an RPC error, the whole recovery call fails loudly and the revenue job pages out rather than failing silently.

I'm now checking the market quoting logic in revenue.mjs: it quotes an initial expected amount, sweeps, requotes afterward, and verifies the second quote hasn't drifted beyond the allowed basis points before using the guaranteed floor — this all looks correct, matching what was reviewed in earlier rounds.

Then I trace the alarm's tolerance check: quoted is the second market expectation, and the floor guarantees at least 98.5% of that quote, while the alarm's shortfall tolerance allows up to 2% below quote. Since 98.5% is comfortably above the 98% floor, there's no risk of a false page — the margin is tight but mathematically sound.

Checking the revenue split transaction, the token account creation and split instruction hardcode cbBTC's decimals to 8, which matches the pinned mint precision correctly. Now I want to verify how `market()` handles the amount parameter.

The venue list filters on a deviation threshold that's amount-independent, so that's fine. More importantly, `oracleFloor` throws on stale prices, which blocks a cycle before the sweep -- but if the oracle goes stale after the sweep, the cycle opens with SOL exposed on the operator, which is a loud failure requiring manual recovery, consistent with the already-accepted risk shape for post-sweep failures. I'm now turning to the test gates, starting with the requirement that floors must match exactly in the deterministic test script.

I'm confirming the floor count, 930, matches between the deterministic test script and the selftest, and checking that the selftest asserts equality between them. Then I'm cross-referencing the SPEC's stated assertion counts (895 total, plus breakdowns for detector, allocation, poster, expiry-budget, Proof-of-Burn, launch, live-mainnet, simulation, and swap-fork) against what the selftest's RX map actually verifies.

I'm checking "allocation" appears as 39 in both occurrences matching ALLOC_FLOOR, "poster" as 24 matching POSTER_FLOOR, and "live-mainnet" as 33.

Continuing through the remaining floors: launch at 49 matches LAUNCH_FLOOR, PoB at 14 matches POB_FLOOR, simulation at 71 (floor unverifiable but consistent with selftest reference), swap-fork at 16 matches SWAP_FLOOR, and expiry-budget at 4 matches EXPIRY_FLOOR -- all checking out so far.

Now I want to think about whether any of these checks could pass vacuously, like if an assertion's input happened to be empty. I'm scanning through selftest for cases where something like a wiring gate check could silently succeed on an empty body rather than actually verifying real content.

Checking the remaining gates confirms none are vacuous — the search coverage, pinDiff, and instruction comparison checks all have real assertions behind them. Now I'm moving to the round-39 C03 repair check in bundle.test.mjs, looking at how it loops over named entries.

For each case, it runs both the node and bundled plan functions safely, catching errors into an `ok`/`v` result, then asserts both succeeded, their canonicalized outputs match, and the result is substantial (length > 200) — so a thrown error or empty output would fail the test, confirming C03's repair is genuinely checked rather than vacuously passing.

Now I'm checking whether nIds and bIds derive from the same underlying profile data — F.P wraps profile('mainnet') plus the collection, while B.makeIds uses B.PROFILES.mainnet plus collection directly, and if profile() adds any transformation these could diverge and break the comparison, but since the suite reportedly passes fully, they must align. That confirms C03's repair is legitimate, so now I'm moving on to verify C01's repair next.

For C01, I'm extracting the send block between the retireBurned loop and the heartbeat comment, wrapping it in an async function, and feeding it a stub context that records run/send calls so I can check the resulting order of claim/distribute/activate operations — removing the claims loop or reordering activate before distribute should flip the test to red, which confirms the check works. I also need to verify the extracted block doesn't reference anything missing from the stub context, like plan, byAddr, TransactionInstruction, MINT, and the various buffers.

Now I'm tracing the crank source right after retireBurned: vaults get joined in preJoins batches, then an `expire` helper is defined and called with 'before' on preExpires, followed by split/pay logic that likely continues further down.

Tracing the rest of the flow, it goes on to push failures if payDecimals is null, run split_revenue, attempt distribute with failure handling, call expire('after', ...) on postExpires, then activate vaults, and finally run claims in batches — all of which depend on helpers like L.EXPIRE_BATCH, MINT_CFG, W, run, and d supplied by stubCtx.

Since plan.split is false in the test, the split_revenue instruction constructor never executes, so unresolved identifiers like REVENUE, revAta, bankAta, and payMint never get evaluated and no ReferenceError fires under `with(ctx)`. I'm now checking whether judgeDistributeRefusal is included in stubCtx's return.

Confirming this fault only triggers when send returns 'fail', and since the stub's send always returns 'ok', that path is skipped — making C01's repair a legitimate test, and the frozen-pool end-to-end test exercising the real planner and sender checks out too.

Now I'm extracting the chunk.forEach block and the vaults line for C02's repair.

Still tracing the string boundaries...

That confirms the slicing logic re-adds the closer correctly, and writeRun's execution checks out against the expected balances and findings. I'm also verifying the vaults line extraction: if that line gets altered, the pick function should return 'MISSING', which should correctly fail the equality check against the expected output.

Now I'm moving to C04's repair for the ceremony step-0 key, checking the test file that sets up mock storage writes and builds collection steps across multiple contexts to verify each build generates a fresh identifier.

I'm verifying the test ensures each build produces a unique keypair, with distinct public and secret keys never reused across three builds, and confirms the step writes nothing to localStorage, sessionStorage, or IndexedDB. The regex-based checks on `newCollection` and `remember` usage could theoretically be bypassed by a rename, but they target specific claims.

One gap I notice is that the writes check only monitors the three storage globals it tracked, missing things like document.cookie or server-side persistence — though the paired source grep about the page only persisting the address helps cover this.

Now I'm checking C05's repair against the HOLDER-GUIDE text about the redeem page being "built, and published before launch," comparing it against item 50's claim that it's actually BUILT AND STAGED, NOT YET PUBLISHED, and OPEN AND BLOCKING — there's a discrepancy here worth flagging.

Actually, the guide is DRAFT status and might not be published before item 50 ships, so the phrasing works as a forward-looking statement that becomes true once published. That seems acceptable, and the future-tense wording about taking out ordinary tokens also checks out. Now I want to hunt for new defects in the bundled web test and alarm logic with fresh eyes, starting with how detectLogGaps trims the reviewed-prefix by merging previous and new gap arrays into a deduplicated set.

When unreviewed entries hit the 500 cap, the math forces reviewed down to just one entry, which is the watermark itself — so it survives being trimmed, which is good since losing it would make everything look unreviewed again.

I'm noting that a flood could still push `keep` up to 8000 per pass, which is something the spec addresses. Then I'm checking `detectSplitClaims`'s recent set — it combines the last N verified cycles with any cycle whose sweep signature was ever observed on-chain, so once a sweep lands on-chain its cycle stays permanently verified.

Checking `closeCycle`'s WeakMap cache: since `allSplits` is freshly constructed each pass from `seenSplits` plus the previous pass's splits, the cache naturally stays scoped per-pass, and `sortedSplits` handles deduping and sorting afterward even though the combined array itself isn't pre-deduped. I also notice `detectSplitClaims` independently dedupes split signatures internally, so that's covered twice. Now I'm looking at `revenueOutflow`, which sums transfers originating from the revenue ATA, including inner instructions.

I'm tracing through the `cycleStartMs` function, which parses the cycle's start timestamp and checks whether a sweep matching the cycle's sweep signature has a recorded block time, using that to potentially adjust against the chain's current time.

When `chainNowMs` is provided and a matching sweep exists, it translates the sweep's on-chain block time into wall-clock domain, but guards against the edge case where the sweep's block time could exceed the chain clock reading itself — which raises the question of whether that's even possible given how the validator's Clock sysvar estimates unix time.

So this is actually a real edge case: since both the Clock sysvar and the block time from `getSignaturesForAddress` are independent estimates, a slight discrepancy could make the sweep look like it happened after "now," which forces age to Infinity and bypasses the grace period entirely — potentially causing `unreconciled_swap` to fire falsely. I need to trace through how the alarm actually calls `detectUnreconciledRevenue` with the chain and wall clock readings to see if this scenario is reachable in practice.

Since blockTime equals the Clock's unix_timestamp at that slot, and both series are monotonically non-decreasing, blockTime(s) <= Clock(now) always holds for past slots—so that comparison isn't a bug. But I realize there's still an edge case: the alarm reads the Clock at the start of the pass, while a sweep could land mid-pass at a later slot with a larger blockTime than what was captured.

That would make `at > chainNowMs`, producing -Infinity and triggering an immediate page for a sweep that's actually only seconds old. Given a full pass takes minutes to walk thousands of transactions per program, a sweep landing after the initial Clock read but before the pass completes would indeed have a blockTime exceeding the captured nowSec, so this race condition looks reachable.

With that -Infinity age, the logic would then produce an age of Infinity on the other side, and since returnedSats is still 0 for an in-flight cycle, the "age < graceMs" check fails, falsely escalating to an unreconciled_swap CRITICAL alert claiming cbBTC never returned—even though the cycle is only minutes old. I need to check whether the sweep gets recorded in seenSweeps in time to prevent this false positive.

The sweep does get pushed into seenSweeps as soon as it's observed, and allSweeps merges previous and current seenSweeps, so a freshly-discovered sweep is included. But the match against cycle.sweepSig depends on timing—the revenue job only sets sweepSig after confirmation, so there's a race where the walk could see the sweep before sweepSig is saved, causing the hit check to fail and fall back to normal grace logic instead.

Timing-wise, this race is plausible: cron runs at :41 while alarms fire at :23/:53, and a slow pass (16-52 minutes during a flood) could still be mid-run when the sweep lands with a blockTime later than the pass's Clock read, producing a negative/invalid comparison.

So this is a false CRITICAL alert — the alarm would page on an "Infinity minutes ago" unreconciled swap even though the cycle is only seconds old and progressing fine; the next pass would clear it naturally. It's a false alarm rather than a missed detection, and it echoes the same root cause that `cycleStartMs` was introduced to fix in round 24 — except here the "false" timestamp is the chain's own, not a manipulated one.

I'm also noticing the same `-Infinity` comparison bug could leak into `detectSplitClaims`: if the grace check evaluates false, the cycle gets verified immediately instead of graced, which could falsely trigger `split_not_on_chain` CRITICAL for cycles whose split hasn't landed on-chain yet. I'm tracing whether a cycle that fully completes within a single pass (sweep, swap, return, split all happening before `seenSplits` is populated) could hit this edge case.

This makes the false positive worse, not just a missed grace window: the walk can see a sweep but not yet see its matching split because the split landed after the alarm's chain-clock read, and whenever that happens `cycleStartMs` falls back to -Infinity, killing the grace period entirely and firing a CRITICAL `split_not_on_chain` alert on a cycle that was actually split just seconds earlier. Since alarm passes can run many minutes while the revenue job fires hourly, this overlap isn't a rare edge case — it's a routine occurrence.

I should verify this with a concrete trace: an alarm pass whose `startedAt` precedes the revenue cron minute, paired with a CRITICAL alert naming a cycle whose swap/split signatures already exist in the ledger with later timestamps, literally showing "(Infinity min ago)" in the output text. I can also confirm it with a direct unit test feeding a sweep block time later than the chain-clock timestamp into `cycleStartMs` and checking it returns -Infinity — and I notice the selftest suite already has a similar test case checking that scenario.

The gap is that no existing test arm covers blockTime exceeding chainNow, so the current protection doesn't catch this specific ordering issue. The fix is to clamp `at` to `chainNowMs` when it exceeds it, treating it as "now" instead of producing -Infinity — this preserves the existing safeguard against far-future fake startedAt values while avoiding the bogus infinite-age calculation caused by clock-read ordering; alternatively I could read the clock after the walk completes instead.

This is a solid medium-to-low severity finding since it would cause false critical-severity alerts rather than any real safety bypass.

I'll settle on MEDIUM severity given the project's own philosophy that false alarms erode trust in critical alerts, and because this sits in the revenue-path detector where the team already added grace periods for similar false positives. Now I need to verify exactly how routine the race condition is — it requires the alarm pass to overlap with the revenue job's sweep timing and a specific ordering of when the signature gets saved versus read.

Tracing through the code, `detectUnledgeredSweeps` uses the ledger as read at the start of the pass, so `byS` reflects that snapshot — but `seenSweeps` captures the signature independent of the ledger state, and this gets folded into `allSweeps`. Since `detectUnreconciledRevenue` reuses that same pass-start ledger, the cycle's `sweepSig` would need to already exist in that snapshot, which seems contradictory if the sweep only landed mid-pass — unless the ledger read genuinely preceded the sweep, meaning the new cycle's sweepSig reference is actually pointing elsewhere.

The scenario that would make this work is if the sweep landed just before the pass started, so its sweepSig is in `led`, but its blockTime is still later than the Clock timestamp recorded at pass start — I'm tracing through main() to see that the Clock is read first, then the ledger file is read a moment after, leaving a tiny window where a sweep could land with a blockTime that's technically ahead of the recorded clock reading.

Since `getAccountInfo` at 'confirmed' only returns the Clock value as of the confirmed slot, and slots advance roughly every 400ms, a sweep confirmed in that same slot would have blockTime exactly equal to nowSec, satisfying the `at <= chainNowMs` check.

If the sweep confirmed a slot or two later, blockTime could run a second ahead, so the exploitable window is really just the gap between reading the Clock and reading the ledger - maybe a few hundred milliseconds to a second. That's tiny but not zero, and since the revenue job sweeps about three times a day while there are roughly 48 passes a day, the odds of a sweep landing inside that narrow window are low but worth quantifying rather than dismissing outright.

I'm now checking whether carried-forward seenSweeps entries from earlier passes could sneak in with a later blockTime, but since those are strictly from prior passes and null-blockTime entries get filtered out of the hit check, that path looks safe. So I'm second-guessing whether this finding is even reachable in practice, which pushes me to look for other ways the comparison could flip.

Could the block time reported for a transaction briefly run ahead of the Clock sysvar's confirmed timestamp? Both should derive from the same stake-weighted timestamp estimate at the confirmed slot, so they ought to stay monotone with each other — I'm tracing through whether getAccountInfo's confirmed Clock and getSignaturesForAddress's confirmed blockTime are guaranteed to reference the same slot boundary.

Since the ledger used by detectUnreconciledRevenue and detectSplitClaims is read at pass start, the only way blockTime could exceed nowSec is if a sweep confirms in the narrow window between the Clock read and the ledger read — a tiny, barely reachable race. It's still a latent defect producing an invented Infinity, so I'll downgrade severity to LOW and describe the narrow window honestly, while also checking the fallback path where nowMs comes from the wall clock instead of chain time.

All four call sites actually pass chainNow explicitly, so that fallback branch never triggers in alarm.mjs — only the selftest exercises it. That means the -Infinity path for `at > chainNowMs` is narrow and rarely live, so I'd rate this risk as LOW.

Let me keep scanning for something more impactful — rechecking the reconcile logic and shortfall detection wiring in alarm.mjs, which still looks fine. Then I turn to the cron installation script, which sets up six jobs including a crank-reveal job wrapped in flock locking, and I'm checking whether judgeCronTemplate correctly validates that every cron line running a node script starts with proper flock protection.

I verify the FLOCK variable assignment with the -n flag matches the expected pattern, confirming it passes. I also check the deadman alarm cron line, which doesn't invoke any bank script directly and therefore gets skipped by the template validation, and I'm now checking that the cron setup doesn't grant any unintended permissions.

Looking at the installer logic, it correctly refuses to run in a rehearsal tree, requires ubuntu, and pulls REV_LIVE/CRANK_LIVE only from our tagged uncommented lines as tested. The `ours()` function filters for lines matching the tag and action followed by whitespace, then excludes commented lines, so "crank" won't accidentally match "crank-reveal" since the regex requires the match to end right after "crank".

Checking that `ours crank | grep -q 'crank.mjs --live'` properly excludes the reveal-only line since it doesn't contain the exact "--live" flag, and the L12 arm tests confirm this works as expected.

Now moving to `scripts/build-mainnet.sh` — verifying it proves what it claims for all five programs including the sweep helper. It builds both mainnet and localnet, asserts exactly five .so files exist in dist, and for the sweep program compares the dist binary against both the localnet directory and target/deploy versions. For the four keyed programs, it deploys both builds and checks against the init tests.

I'm confirming that all four keyed programs correctly scope INIT_KEY inside the non-localnet feature flag, and that the script enforces commit provenance with a refusal on dirty state, plus prints sha256 hashes for both dist and target/deploy. One subtlety: it only directly compares target/deploy bytes for the sweep program — for the four keyed programs, the mainnet build legitimately differs from target/deploy since they use different init authorities, which is expected and fine.

I'm checking whether it actually validates reproducibility of the mainnet build against this commit — it writes a MANIFEST with the commit hash and refuses dirty trees, and clears cache directories before building fresh, which covers that. It also verifies build success for all five programs by checking exit status and non-empty .so files, counting exactly five. The remaining question is whether it ensures target/deploy reflects the current localnet build rather than a stale one — since that copy happens elsewhere in run-tests.sh, a stale target/deploy would cause the sweep comparison to fail and halt the script, which is acceptable behavior.

But I notice it doesn't verify that target/deploy for the other four programs matches the freshly built localnet directory — meaning the printed sha256 hashes for "programs the suite and sim deployed" could reflect an older, stale build even though the actual behavioral test runs against the fresh localnet directory. So those printed hashes are more informational than a guarantee of freshness.

If only the sweep script was unchanged while the four programs were stale, the sweep comparison would still pass even though the printed hashes misrepresent what was actually tested — a minor labeling issue rather than a real bug, since the correct gate is simply running run-tests.sh before build-mainnet.sh in sequence. I'll flag this as low-priority at most and likely skip it, but there's a more interesting question worth digging into: whether build-mainnet.sh actually validates the sweep helper's behavior.

It doesn't need to, since it has no key and nothing to ask — it only confirms byte identity with the tested build, which matches exactly what it claims, so that's fine. I also note the four `ask()` deploys reference the keypair files under target/deploy to get program IDs, deploying the mainnet build to those same addresses on a local validator, which checks out.

Now I'm digging into web/test for assertions that can't fail, since that's the explicit task. Looking at tx.test.mjs, I see it has seven assertions covering the honest wallet being accepted, the adder being refused with a specific error message, the forger being refused with another specific message, and error explanation naming checks.

The last two assertions — that ERRORS equals generate() and that per-program counts match — are redundant, since if ERRORS deep-equals generate() the counts trivially follow; a prior round flagged this as harmless, and I agree it's not a real finding. I also check whether signExact is tested against a wallet returning a different transaction that happens to serialize identically — it isn't, but that seems fine.

Then in decode.test.mjs, there are sixteen assertions comparing our parsers against official deserializers on hand-built byte sequences, which looks solid, except I'm wondering if a shared wrong assumption between the test's byte construction and our parser could let the official deserializer mask an error too.

Checking ids.test.mjs, I find 41 assertions including a cross-check that seeds match the programs' *_SEED constants, which would correctly fail red if seed() returned undefined everywhere. Then moving to proxy.test.mjs with 107 assertions, I'm looking at whether ALLOWED matches the called derivation logic.

Checking plan.test.mjs further, I'm verifying a test that confirms the redemption opening isn't blocked and that the acknowledgment references the right address — both conditions are substantive and non-trivial. I continue scanning for a V1 test case that similarly can't pass vacuously.

Checking more cases: one verifies that a new mint arriving after setup with no prior transaction still opens and is acknowledged, and another checks that the page re-reads promised accounts by address and matches what was seen, using source regexes that would break if the page logic changed. In get.test.mjs there's a helper that plans a claim and asserts it's refused with a matching reason string — also substantive.

Now I'm scanning ceremony.test.mjs for more source-regex checks: one counts occurrences of the unverified-warning call to confirm it only shows in the preflight and above the steps, checking the exact count plus a comment telling not to duplicate the box. Another verifies the displayed collection name and link match what's configured in SITE.

Then I move to checking the instruction bytes — confirming step 0 carries no plugin or adapter data by inspecting the last ten bytes of the buffer. Switching to meta.test.mjs, I verify the slot state file lives outside the public output directory, and that every image used across the level shells points to a verified CDN URL.

I notice that if `LEVEL_IMAGES` were accidentally emptied, `.every()` on an empty array would vacuously return true, making this check pass even when broken. But I think other assertions elsewhere would catch that case since `d.image` would end up undefined, so this particular weakness is covered by redundancy rather than being a standalone defect.

I'm also checking whether the "five verified shells" property is truly enforced — with only 3 entries in LEVEL_IMAGES, the `.every()` check would still pass, so the count isn't actually being validated. This seems like a minor gap worth flagging as INFO rather than a hard failure, so I want to look for stronger examples before moving on.

Looking at bundle.test.mjs, I'm confirming the directory walk test crashes correctly if the source folder is missing, and checking the import restriction tests for node's crypto, fs, and url modules in the browser bundle.

Round 39 already dispositioned the dynamic-import blind spot as not a defect, so that's settled. The per-page leak check for key files and backup paths also looks fine. Now I'm examining the README hash table verification, parsing the mainnet profile rows and their corresponding hash values from the markdown table.

I'm checking that each row requires a matching entry to exist and that its hash equals a fresh build of the file—this is a substantive check since it demands the row actually be present. Then I'm looking at the static checks against web/dist: if the dist directory is missing, a single failing assertion collapses roughly 40 separate arms into one, but the floor for bundle.test.mjs is set at 83, and run-all requires that count to match the floor exactly.

Since a missing DIST would drop well below 83, that discrepancy gets caught correctly. I also note run-all.mjs executes web/build.mjs first, so if that build step fails and throws, run-all crashes uncaught and exits non-zero, which is the desired behavior. Now I'm moving on to look for a defect in detectUnledgeredSweeps' amount parsing logic in detectors.mjs.

The code checks the sweep discriminator against the data bytes then reconstructs a little-endian u64 from bytes 8 through 16 by shifting and ORing each byte starting from the high end down to the low end, which looks correct. I also verify detectApprovals' ataOwner fallback and detectPdaTokenAccounts' handling of wallet vs owner fields for ATA and initializeAccount instructions look fine, then start wondering about an edge case where an idempotent ATA creation on an already-existing account might produce an unexpected parsed type.

Since the ATA program only ever creates canonical ATAs, the account field is always the correct ATA for that wallet-mint pair — but expectedAtas only tracks the three reserve mints' ATAs for live vaults. So if a createIdempotent call creates an ATA for a vault PDA but for some other mint entirely, it wouldn't match expectedAtas and would get flagged as a non-canonical token account critical issue tied to that vault PDA.

Now moving to parseCbobLogs, I'm checking attribution by the invoke stack — looking at which program is on top when each log line prints. For CBOB_REDEEMED_POOL_FROZEN the stack is [BURN, MINT] with MINT on top, which matches correctly, and CBOB_VAULT_RESCUED is a top-level MINT call with stack [MINT], also correct.

Now I need to go through the remaining event types — monthly inline logs, CBOB_REDEEMED, and a long list including boost expiry, epoch tick, activation requests, sweeps, and skip/cancel events — and verify each against the owner mapping.

I'm realizing the owner map only recognizes 6 types, so everything else gets filtered out. The question is whether any of those ignored types actually represent something the alarm should be paging on, like swap operator/guardian arming (already covered by config drift checks) or action-skipped events tied to governance round tracking.

A skipped action within an applied bundle isn't individually paged, though the overall execution still shows up via proposal count and last-ID changes — that feels like a minor gap rather than something worth filing. I'm also checking whether sweep and boost-related events need separate alarm coverage, and specifically whether `mint.boosts_active` is actually included in the drift watch list or just the broader watched-keys set.

Boost purchases correctly stay unpaged since the relevant price/weight/epoch fields and last-boost-id are watched at HIGH, while boosts_active/due are just tracked for overdue detection. Moving to `detectCrankSilent`, I'm now tracing through the reduce logic that picks the most recent of stampSec and armedSinceSec, checking how null comparisons behave with numeric values in that fold.

Tracing through examples confirms the intended grace-period behavior: taking the max of stamp time and armed-since time means a recently re-armed crank stays quiet even if its stamp is old, while a stale crank with an old arming time correctly pages once past the 3-hour threshold. `detectCrankPosture` checks out fine, and now I'm moving on to review `planAlarmNotices`.

Looking at the notice-building logic, each kind gets one notice with urgent flagging for one-shots, and there's a 60,000 char cap per notice with an "...and N more" suffix appended when truncating — I want to verify that suffix can't push the total meaningfully past the limit, but it's only ~100 extra chars so well within the 128KiB bound.

Now I'm shifting focus to `bank/txread.mjs` and its consumers, specifically hunting for any path where a CBOB event could get silently dropped or the cursor could advance past something it shouldn't — looking at how truncated logs are handled when the alarm's own run saw the gap versus when it didn't, and whether the log parsing correctly empties out on truncation before the cursor moves forward per spec.

I'm checking whether "ours ran" detection is reliable by looking at how inner instructions get merged with top-level ones to determine program participation, and confirming that `meta.innerInstructions` stays intact even when logs are truncated since it's populated separately by the runtime — then I want to make sure there's no edge case where a CPI call into our programs could still leave inner instructions missing.

The only other truncation path is the node's own log buffer limit, and the RPC itself returns full logs, so that's not a concern. But I realize there's a subtler gap: if our program genuinely invoked but the node returned an empty logMessages array rather than a truncated one, the check for Array.isArray would still pass since empty arrays are valid arrays, meaning parseCbobLogs would silently find no events even though invoke lines should always be present in a real execution — that's a real edge case worth flagging.

An empty log array paired with actual instructions is effectively impossible on a real node since every successful transaction has at least one program invoke, so that's a defensive check not worth flagging. I should also verify that the alarm's `readConfigs` throwing on a malformed account correctly ends the pass as `run_failed`, which matches the spec for RPC read failures—then move to rechecking round 39's disproved claims starting with C06.

C06 can't be verified this round since plan-redeem.mjs isn't bundled, so I'll skip it. C07, the open obligation around DAS `burnt` status on burned Core assets, should be re-raised as a remaining requirement rather than a finding. For C08, I need to trace whether a transport error after broadcast leaves the signature unsaved by following how `rememberAttempt` calls through the send pipeline down to the raw transaction encoding.

