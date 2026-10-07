[reasoning only]
This is round 36 of the off-chain pipeline audit, so I need to find genuine defects with solid evidence while avoiding false CRITICALs. I'm starting with the crank module, examining the planCrank logic for how it schedules rescheduling, capture, and other actions based on slot timing and reveal windows.

I'm tracing through the readySlot calculation with a concrete example (reveal_slot=1000) to verify the capture timing aligns correctly with MINT's try_capture logic for NotYet/Expired states. I'm now considering whether skipped slots could push the capture target later, causing the crank to waste fees attempting captures that return NotYet.

I'm examining the reveal ordering logic — tracking that in REVEAL_ONLY mode, records are filtered to level 0 only, so the loop breaks correctly when it hits an index that's either missing or not yet entropy-set/captured, since reveals must happen strictly in mint order matching revealed_total.

I'm also checking the full-pass variant where all records are present: since reveal_level enforces index == revealed_total, the record at that position should always have level 0, even for burned vaults, since reveal_level still draws without writing to Core. Now I'm considering edge cases where a planned reveal's record is also being captured in the same pass.

If that capture fails with RevealTooEarly, it's treated as benign and the loop breaks there; if it fails for other reasons, the dependent reveal would also likely fail, which just gets reported normally. Now I'm moving into checking the distribution logic, starting with how `plan.distribute` determines whether a payout is due based on comparing the current timestamp against the last distribution time plus the monthly interval.

The distribution condition also requires the pool to be joinable, not frozen, and the available weight (active plus pre-join minus retiring/expiring) to be positive, alongside available funds after accounting for owed amounts. I want to verify whether the crank's pre-expiry step actually clears every boost that's due before distribution runs, so I'm tracing through the loop that skips retired, inactive, zero-boost, or already-retiring records to see which ones get expired.

This matches the program's own boosts_due counter logic, which increments whenever a boost's end epoch is reached and decrements when retiring vaults have their boosts unscheduled. I'm now checking whether a boosted vault could ever be in a pending (non-active) state, which shouldn't be possible since boosting requires an active vault.

I'm also verifying that `expire_boosts` doesn't filter based on asset readability, so unreadable assets still get included correctly. Now I'm looking at the `retire` function to see whether it preserves boost_weight as historical data after unscheduling the boost.

The SPEC confirms retired records keep boost_weight and boost_end_epoch for history while being treated as inert, and `weight_of(r)` in both retire and the crank's computation consistently includes the boost weight so total_active_weight is decremented correctly. I'm now checking the crank's retiringWeight calculation to ensure it only sums weight for records still marked active.

Expiring weight sums boost for preExpires, and since retiring records are excluded from preExpires, there's no double subtraction. I'm now tracing the actual send order in main() — reschedule, capture, reveal, retireBurned, preJoins, expire('before'), split, distribute, expire('after'), activate, claims — to verify the plan's accumulator state at each step matches what's expected.

Looking closer at how claims get built, I notice plan.joins (the post-join batches) get appended to the ready queue after the main distribution batches, then everything gets chunked into claims batches together.

Pre-joined vaults are handled separately through their own preJoins batches sent before distribution, and their delivery amount is computed using a joinedNow flag that checks if the address already got joined. For those, owed is computed with debt set to weight times the pre-distribution accumulator, then the post-distribution accumulator is used to figure the actual payout — matching how the join() function sets debt at join time before the distribution occurs.

Now I'm checking the destination address logic for claims: for an active record the token address comes from vault_ata, but for a pending (not-yet-active) record it's derived differently via the signer PDA, so I need to verify this matches up correctly for pre-joined vaults.

Since `activate` sets `r.vault_ata` to the canonical ATA, the pending-record path and the stored vault_ata end up equal, so the check holds. Now I'm moving on to look for actual bugs, starting with how `plan.split` accounts for `splitToPool` relative to `avail` and the ordering of the split transaction before distribution, which seems fine, then examining whether distribute is invoked with the correct flag.

I'm tracing through the order of operations after distribution — activate running monthly_inline (a no-op since distribution just happened) and claim batches running monthly_inline similarly — but I'm now wondering about an edge case where plan.distribute was false yet the month was actually due, and something like an unreadable eligible vault blocks things via joinable being false, which could also block monthly_inline inside a claim through waiting_to_join being nonzero.

I'm checking that case: since the unreadable vault counts toward pending_count but not pending_this_epoch, waiting_to_join is indeed greater than zero, so monthly_inline correctly bails out early — that's consistent. But I also want to check what happens if the pool is frozen or its state isn't 'ok', since activate still gets computed and sent regardless of pool state, and that requires the pool_token account to match the configured pool_ata.

Now I'm tracing the exact order of checks in monthly_inline — the pool key match, the due flag, boosts_due, waiting_to_join, total_active_weight, and finally the owner check against SPL_TOKEN_ID — to confirm it returns early correctly before reaching the token-program-specific logic.

I'm now considering a tricky edge case: when total_active_weight is zero but there's pending epoch activity, monthly_inline ticks without reading the pool, and the crank separately plans a distribute tick too — so I need to check whether this double-tick path is actually fine or causes an issue, especially when pre-join weight is nonzero and affects the effective weight calculation the crank uses to decide whether to plan a tick.

That distributionOverdue condition won't trigger since poolAvail stays at zero. I'm computing waitingThisEpoch by checking pending requests against the retiring set for the current distribution epoch, then comparing it to the pending_this_epoch config value. Now I'm checking the tick branch's exact conditions, matching against the Rust program's requirement that w equal zero alongside the other eligibility checks.

Looking at the actual program logic, it reads the pool's token balance before anything else, verifying it's a valid token account for that owner, then checks boosts_due is zero before evaluating whether w equals zero to decide the path forward.

The crank looks consistent so far, so now I'm checking for something that could cause the program to refuse the transaction or waste fees. For the split revenue instruction, I'm examining whether the crank's account list matches what SplitRevenue actually expects.

Both the distribute and activate sends also line up account-for-account with their respective instruction handlers, so nothing wrong there either.

Checking claim and retire_burned next — claim's keys and the config/pool_token/token_program plus remaining pairs match up, and retire_burned's accounts (config, vault_record, asset) line up with what the keys array passes in.

For expire_boosts, the keys include config plus remaining records that need to be writable, which matches since remaining accounts are built with writable flags and batch size constants align (30 max, 20 default). Then for reveal_level I'm checking the full account list: config, vault record, asset, collection, payer, mint authority, slot hashes, core program, and system program — verifying against what the instruction actually expects.

For capture_entropy and reschedule_reveal, the key sets look straightforward and match the expected writable accounts. I'm also confirming the crank logic correctly excludes burned vaults from joins and claims while requiring live status, and now checking how the planCrank function maps tokens for active vaults using the vault's associated token account.

Looking at the claims check, comparing token address against vault_ata is actually vacuous for active vaults since tokenAddr always returns vault_ata when active -- it only matters in isolated tests with arbitrary addresses. For pending vaults in the claims loop though, the canonical ATA should equal vault_ata when inactive, so I'm tracing through whether this creates any real issue with missing recorded accounts.

Not a real defect then -- the state check carries the actual logic. One genuine concern: owed/pendingSats calculations can throw if debt exceeds entitlement, but that's caught elsewhere. Now I'm moving to planCostLamports, which computes total transaction costs by summing counts across reschedule, capture, reveal, retireBurned, activate, and claims operations, plus batch-ceiling calculations for preJoins and preExpires...

Checking budgetPlan logic...

At 16 bytes per reveal, REVEAL_RENT_LAMPORTS comes out to roughly 111,360 lamports, which is negligible. But I want to double check the rent rate itself—I'm second-guessing whether 6,960 lamports/byte matches what the spec actually states versus a lower mainnet figure.

Working through the numbers, 890,880/128 gives 6,960 and 650,240/128 gives 5,080, confirming the reveal rent calculation uses the stricter test-validator rate, which is a safe overestimate. I'm also checking whether the 16-byte attribute size for something like "level" plus its value and length prefixes is accurate, and whether Core actually charges the payer for that realloc rent—it does, so the estimate holds up as a conservative approximation.

Now I'm turning to the crank's reveal loop logic and how it handles a 'benign' outcome before it breaks out of the loop.

If a reveal comes back as benign (meaning another lane already revealed it), the crank breaks out of the entire reveal pass rather than just skipping that one entry. Since the plan is built from a snapshot of `revealed_total` taken at plan time, if a different lane revealed an index already present early in the plan, that reveal returns AlreadyRevealed and the whole pass halts there — meaning the rest of that pass's reveals get skipped and have to wait for the next minute's pass to pick them up. It's not a correctness bug, just an inefficiency that could bite during bursts of concurrent reveals.

This also happens in `judgeRevealAttrs` when the result is 'revealed' — same break-before-sending pattern, so it's a race between the per-minute reveal lane and the hourly full pass that could halve throughput under contention but wouldn't cause a stall. This feels more like a LOW/INFO observation rather than anything CRITICAL, so I want to look for something more substantial.

Looking at `mintFailureCode` and the benign-check logic, I notice it computes a combined message string from the error and logs, but that string only gets used in the failure log line — so no issue there.

I'm tracing through how `mintFailureCode` walks the invoke stack — it only returns a code if the mint instruction itself failed at the top of the stack, so a nested CPI failure inside Core would correctly fall through to null and fail as expected. I'm double-checking the regex used to match program invoke lines against base58 program IDs, which checks out, but I'm now considering whether Anchor's specific log format for AnchorError codes is handled correctly by this parsing logic.

This sample log line confirms the regex match works fine. Now I want to verify the alarm section's WATCH list is complete, checking it against every MintConfig field that's fixed forever — collection, governance, pool_ata, bank_treasury, split_bps, max_supply, payment_mint, level_caps, pob_collection, pob_root, charter dates, monthly_secs, and notice periods.

I'm cross-checking the rest of the fields: sweep_floor_lamports, cooldown_ceiling_secs, reserve_ceiling_lamports, cbob_mint, max_boost_weight, max_boost_epochs, and version all appear in WATCH. The bump field is fixed but harmless so it's fine it's unwatched, and level_minted correctly isn't watched since it changes. I also verify burn, seal, and gov substructures all have their immutable fields properly covered in WATCH.

I'm confirming the remaining detection functions are all wired correctly — pending guardian/swap operator changes, Proof of Burn collection plugin or authority changes, redemption window capacity, pool freeze/insolvency, overdue distributions, and upgrade authority checks across all five programs (seal, mint, burn, gov, sweep). I also note the test asserts Gary's production values: 21%/51%/3.

Now I'm shifting to look for a dangerous on-chain state that the code quietly misses, examining `rescue_nested` and the new `vault_awaiting_return` logic within `detectNestedVaults`, which iterates vault owners and skips already-named ones, flags the CBOBTC_SQUADS case as awaiting return, and otherwise checks if the owner is on-curve.

I notice the Squads vault address is hardcoded as a constant rather than pulled from `mint.bank_treasury` config, but since the launch checker pins that config value to the same constant permanently, there's no actual divergence risk there. The real question I need to chase down is whether the alarm properly detects a vault that was rescued and then returned.

The rescue event does get flagged urgently through a `VAULT_RESCUED` log parse, though that's vulnerable to log truncation — but the level-based owner detector provides a backup catch, giving defense in depth. Now I'm wondering whether burnt vaults included in the nested-vault check report sensible ownership data from DAS, since burnt assets might have unusual owner fields.

Actually a nested vault can't be burned since its owner PDA can't sign, unless rescue moved it out first, in which case ownership transfers to Squads or back to the sender—so that path stays quiet.

Refocusing on the real target: checking upgrade authority state after lock, where a value of null or 'IMMUTABLE' is treated as safe, but I'm scanning the program list (seal, mint, burn, gov, sweep) for any upgrade authority that wasn't flagged as not-locked.

Tracing through readConfigs: if a ProgramData account is missing, the snapshot marks it as missing and no upgrade_authority key gets produced, so it's skipped in the authority check. But detectMissingComponents should eventually catch this past the lock deadline as a HIGH severity issue, and the missingWatchedKeys logic correctly treats "_missing" flagged entries as not missing for its own purposes, so that part seems consistent. The real question I'm circling is whether a ProgramData account being absent altogether counts as a dangerous state that's being silently tolerated.

For loader-v3 programs made final, ProgramData persists with cleared authority rather than disappearing, so an absent ProgramData account would mean the program isn't deployed via loader v3 at all -- which is a different edge case. I'm also considering whether lock_deadline_unset should only page when at least one tracked program is still upgradeable, and whether detectConfigDrift should skip a key when the previous value is null and flagged as missing.

Tracing through missingFlagOf's key-splitting logic, I confirm it correctly maps hash fields to their corresponding missing-flag counterparts for both program and collection keys. I'm also noting that the first config check after an upgrade will legitimately flag a critical drift since the baseline hash is just a placeholder -- that's expected per spec. Now I'm examining detectStandingRisks and how charter_secs gets computed from the difference between closes and opens timestamps, wondering what happens when charter_opens_at is undefined.

I'm shifting focus to detectSweepState, which checks whether a sweep has occurred relative to the last judged timestamp, applies a cooldown and grace period, and then determines if the sweep is "explained" by scanning the ledger's cycles for matching sweep signatures or pending signatures that have landed.

When it returns unexplained, judged advances to the sweep timestamp anyway, so the next pass won't re-flag it unless something else changes. I notice the explained check doesn't validate the actual swept amount against the cycle, leaving that verification to a separate process.

I'm reasoning through timing: since a thief's sweep must occur at least a full cooldown after an honest sweep, and the honest cycle's startedAt is recorded after the cooldown check passes, the gap between a thief's sweep and the honest cycle should exceed the half-cooldown window, meaning the thief's sweep wouldn't get mistakenly explained by the honest cycle. But I'm now considering whether only tracking the latest last_sweep_at timestamp creates a gap in this detection.

The scenario where a thief sweeps first and the honest cycle follows one cooldown later means the alarm, if checked after the honest cycle, only sees the honest sweep and misses the thief's — this matches the disclosed residual risk about an alarm blind to a thief's sweep masked by a subsequent honest one, though the described window is narrower given the 30-minute alarm cadence versus the 6-hour cooldown. I'm now checking how the landed set gets built from the last 50 unswept cycles' pendingSweepSig fields.

I'm verifying the cooldownSeen calculation takes the minimum of the previous seen value and the current config's cooldown, capped at 21600, so a longer cooldown vote wouldn't accidentally shrink protection. Now I'm wondering what happens if detectSweepState only gets called with MINT's last_sweep_at config and that config read itself failed upstream.

Tracing through the idle branch where the collection or MINT config is missing, I notice the writeState call there omits sweepJudgedThrough, sweepCooldownSeen, seenSweeps, seenSplits, deferredSweeps, and revenueSince — fields the sweep logic depends on persisting across runs.

Once MINT's config has been read successfully one time, prev.config retains mint.collection, so any later absence routes through the config_vanished branch instead, which doesn't advance state — meaning the idle branch with its state-wiping writeState only ever fires pre-launch. But that branch still resets balances and vaults to empty.

I'm checking whether seenSweeps, seenSplits, and seenRedemptions get dropped the same way in that idle branch — pre-launch there are none so it's harmless. Now I want to check report() and the exitCode handling, and specifically whether logGaps gets rolled back properly in the non-delivered case, since I notice config, balances, and cursors get restored from prev but logGaps might not be included in that rollback.

Splits and sweeps aren't rolled back either since they're monotone accumulations deduped by signature, so re-scanning just produces harmless duplicates that get filtered out. Redemptions follow the same pattern. The royalty and crank health fields aren't rolled back on failure, which raises a concern: crank health could advance its streak on an undelivered pass without the finding actually being delivered, though since the detector is level-based it should re-assert on the next pass anyway.

Checking the crank health advancement logic more carefully — it only advances the streak when the heartbeat timestamp differs from the last recorded one, so an undelivered pass with the same heartbeat won't falsely advance it, and findings re-fire from the saved streak correctly. For royaltySince, an undelivered pass does let it advance, but if the balance drops between passes the since-timestamp resets to now, which loosens an unswept-royalties finding — not ideal but not a critical bug.

Now I'm moving into the swap/revenue path, which seems like the more interesting area. Starting with the oracle math — computing the exponent difference between SOL and BTC price feeds to normalize the numerator for a cross-rate calculation.

I verify the derivation: lamports converted to SOL, times SOL price scaled by its exponent difference, divided by BTC price times 10, correctly accounts for the 1e9 to 1e8 unit conversion between lamports and satoshis — the math checks out. The division floors via BigInt, and the minimum acceptable satoshis is also floored after applying the 150bps slippage tolerance, which is the conservative (safer-to-succeed) rounding direction, bounded appropriately by the slippage parameter either way.

For positive expo cases the exponentiation still works fine in JS, so that's not an issue.

What concerns me more is whether the floor actually sits below what a legitimate pool would return after fees and slippage. With a 16 bps pool fee and minimal price impact from a modest swap, plus the fact that the deviation gate lets the pool diverge up to 100 bps worse than the oracle and still pass, I realize the floor set at oracle minus 150 bps might not be conservative enough against a pool sitting near that -100bps boundary.

Stacking the worst-case 100bps deviation with a 16bps fee gets to roughly -116bps, which still clears the -150bps floor with about 34bps of margin — tight, but it holds based on the fork test's measured values. Meteora's DLMM fee structure is less certain though, since bin-step-based base fees plus variable fees could exceed that 34bps margin, and if they did, the swap would simply revert rather than cause a loss — leaving an open cycle needing manual recovery, which is a liveness problem rather than a fund-safety one.

The real nuance is that the fork test measured the deviation gate at the current pool price, close to oracle, not at the actual gate edge where the risk concentrates. If both pinned venues refuse the swap at that edge, the system throws an error requiring the operator to manually swap SOL by hand — a legitimate but narrow operational risk worth flagging as low severity.

Checking the spec, the 150 bps output floor is described as covering the pool fee, price impact, and oracle confidence, but it doesn't work out the arithmetic precisely at the gate boundary itself — so this gap isn't explicitly disclosed. Let me think about whether there's a sharper version of this deviation issue.

A pool priced 100 bps favorably passes the filter too, which is fine, but one priced 99 bps unfavorably also passes, and combined with the 150 bps floor that leaves roughly 35 bps of slack for impact plus fees — tight but within documented bounds. The real question is what an attacker could extract within that tolerance window, since the gate is checked at read-time while the swap executes later, leaving room for a sandwich attack to manipulate the pool price in between.

An attacker watching the transaction in the mempool could front-run to push the price down near the minSats floor, let our swap execute near oracle minus 150bps, then back-run to restore price and pocket the difference. Working through the numbers, that caps extraction at roughly 0.15 SOL per cycle, scaling to about 18 SOL per month, against 1200 SOL/month of total royalty throughput — a small percentage leak worth noting but not catastrophic.

I should frame this as an analysis flagged INFO/LOW, noting it's within documented tolerance.

There's a subtler issue though: the judge refuses a priority fee entirely, so the swap transaction only carries the base fee. Under congestion it could take many slots to land, giving a sandwicher more time, or it might not land at all before the blockhash expires — triggering a timeout error that gets classified as 'refused' with no status, forcing a retry or manual recovery.

If Orca expires without landing, it falls back and tries Meteora rather than immediately opening a cycle — only if both venues expire does it throw and create an open cycle, but critically this happens after the sweep has already landed. I also need to check whether the sweep transaction itself carries a priority fee, since if it doesn't, congestion could cause it to fail too, though in that case the failure is clean since nothing has moved yet.

Actually an expired blockhash can't land — that's guaranteed. But there's a subtler race in the confirmation logic itself: the status check queries the RPC for the signature, and if the RPC hasn't indexed a just-landed transaction yet while the blockheight check already reads as expired, the code would wrongly classify a landed transaction as refused.

But thinking it through more, `getSignatureStatuses` with `searchTransactionHistory:true` hits the ledger/bigtable directly and is quite reliable, so this double-swap failure mode is low probability in practice.

There's still a safety net: revenue.mjs checks `delta >= guaranteed` after the swap, so if both swaps somehow landed, the extra cbBTC would just flow through to revenue rather than being lost. But the second swap's wrap step requires transferring exactly 10 SOL from the operator, and since the operator only received 10 SOL from the sweep, that second wrap would fail for insufficient funds anyway.

This would surface as "every pinned venue refused" with an open cycle and orphaned cbBTC sitting on the operator, requiring manual recovery — loud but survivable. The scarier case is if the operator happens to be holding extra SOL beyond what's expected.

I'm now checking whether the refusal logic can misfire — specifically the regex used to classify preflight refusals.

I realize a transaction that actually landed and failed on-chain could produce an error message formatted differently than a true preflight rejection, so the stringified error status (e.g. "InstructionError" with a custom code) wouldn't match the "custom program error" pattern. That means this on-chain failure case wouldn't get misclassified as a preflight refusal, which narrows down where the real gap might be.

I'm also tracing through how `sendAndConfirmTransaction` handles confirmation internally in web3.js — specifically how it checks `confirmTransaction`'s status value and whether it throws based on the signature and error present.

The message format matches what the selftest constructs. If the on-chain failure is something like a slippage error, `classifySendFailure` correctly identifies it as 'refused' since nothing actually moved, so the fallback to Meteora is the right path.

For preflight failures (blockhash not found, simulation errors), the transaction never submits, so it's also correctly classified as 'refused' — the sweep closes the row and the swap retries via Meteora, both appropriately since nothing moved on-chain.

Now I want to look more closely at the Pyth account verification question the prompt raises.

I'm deriving the Pyth price feed account address using the shard ID and feed ID as seeds against the push oracle program, which matches the documented scheme for Pyth's sponsored feed accounts on Solana. I need to pin down the actual owner — the receiver program's post_update instruction creates PriceUpdateV2 accounts, so I'm checking whether ownership lands with the receiver program itself.

I'm trying to recall whether the push oracle program `pythWSnsw...` owns the derived feed account addresses, even though the receiver program creates them via CPI — so the derivation PDA seeds belong to the oracle program while account ownership ends up elsewhere.

For the audit, what matters is whether the code properly validates owner, verification level, feed_id match, publish time freshness, and confidence bounds, and whether the address itself is derived rather than attacker-supplied — essentially asking if someone could sneak a fully-verified update with a stale publish_time or manipulated price into that account, which hinges on whether `post_update`'s write authority requirement actually prevents unauthorized writes to the sponsored feed account.

That gives only a few seconds of price selection flexibility, and combined with the 180s staleness window, a manipulated price could lag the market by up to three minutes — plausible enough for a 1% SOL/BTC move. But since updates are monotonic and anyone (including Pyth's own keepers) can push fresher data, an attacker can't force a stale low price onto the oracle; they can only withhold updates, not roll them back, which limits the realistic manipulation window.

I'm also checking whether the code verifies that the price account is a legitimate `PriceUpdateV2` with the correct write authority, since only the push-oracle program should be able to write to its own PDA — looking at the `PostUpdate` struct in the receiver to see how the account ownership and signing is structured.

These feeds already exist live on mainnet, so the write_authority question is moot in practice — no attacker could front-run creation at this point. And even hypothetically, the price_update_account address is a PDA controlled by the push oracle program itself, so only that program could sign to create it; an outside attacker couldn't seize it that way.

Now I'm walking through the exact byte layout of PriceUpdateV2 to double-check the offsets: after the 8-byte discriminator, write_authority takes 32 bytes, then the verification_level enum, then the embedded PriceFeedMessage fields (feed_id, price, conf, exponent, publish_time, prev_publish_time, ema_price, ema_conf), followed by posted_slot — confirming write_authority sits at offset 8 through 40.

Working through the Borsh encoding, `VerificationLevel::Partial` is variant 0 (with a trailing num_signatures byte) and `Full` is variant 1 with no extra byte, so the tag byte at offset 40 must equal 1 for fully verified data, putting feed_id at offset 41-73 and the price fields right after at 73, 81, 89, 93 — matching the parsing logic I laid out.

I'm confirming the minimum buffer length needed is 101 bytes (8+32+1+32+8+8+4+8), which lines up exactly with the highest offset read (93+8=101), so the length check is correct and tight.

Now I'm checking that the Clock sysvar read is trustworthy — it pins both the address to the constant SYSVAR_CLOCK_PUBKEY and verifies the account owner matches the official sysvar owner string, so it's reading the genuine on-chain Clock rather than something spoofable.

I note though that both the Clock and price data come from the same RPC endpoint, so a malicious RPC could still lie about both consistently — but that's an accepted limitation under the stated trust assumptions, not a bug.

Now I'm moving to the deviation filter logic, working out how the Whirlpool's Q64.64 sqrt_price encoding translates into the actual spot price given the token decimals (wSOL at 9, cbBTC at 8).

I'm sanity-checking this with real numbers: at roughly $120/SOL and $85,000/BTC, one lamport should be worth about 1.41e-4 satoshis, so I'm verifying that the implied sqrt_price value matches this expected magnitude.

Floating-point precision shouldn't be an issue here — even though sqrtPrice exceeds 2^53, the relative error from Number() conversion is around 1e-16, far smaller than the 1% price tolerance I care about. Now I need to check the byte offsets used when reading whirlpool account data.

Continuing the field offsets confirms everything lines up: mintA at 101, vaultA at 133, mintB at 181, vaultB at 213, matching the code exactly.

Now I'm working through the Meteora DLMM price formula — the price returned by `get_price_from_id` is `(1 + bin_step/10000)^active_id`, expressed in raw token units (lamports/sats) rather than UI units, so I need to carefully invert it since X is cbBTC in satoshis and Y is wSOL in lamports, meaning the raw price gives lamports per sat, but I actually want sats per lamport.

I'm checking the numbers against the test fixture (binStep 15, activeId 5920) and confirming the inversion in the formula gives a consistent result, roughly 1.3975e-4. I'm also sanity-checking whether Math.pow's floating-point precision could introduce meaningful error at this exponent size, but it seems computed in a single step with minimal rounding loss.

Now I'm mapping out the on-chain LbPair account layout — reviewing the struct fields like active_id, bin_step, and status to figure out the correct byte offsets for reading the pool state.

That totals 72, so I'm mapping out the subsequent fields: bump_seed, bin_step_seed, pair_type, active_id, bin_step, and status, confirming active_id at offset 76, bin_step at 80, and status at 82 matches the code. Now I'm continuing through the remaining struct fields like require_base_factor_seed, base_factor_seed, and activation_type to pin down their exact offsets.

Continuing from that, require_base_factor_seed lands at 83, base_factor_seed at 84, activation_type at 86, and creator_pool_on_off_control at 87, putting token_x_mint at 88 — which lines up with the code's mintX@88, mintY@120, reserveX@152, and reserveY@184, and the 216-byte minimum length check fits perfectly since reserveY ends right there. All the offsets check out.

That said, I notice readLbPair reads the status field but never actually validates it — and in Meteora, status 0 means enabled while 1 means disabled, so a disabled pool would reject the swap on-chain. There's also pair_type and activation_point to consider, since an unactivated pool would refuse too. Skipping this check risks attempting a disabled pool and wasting a fee, but since Meteora is only the fallback venue tried after Orca refuses, if Meteora's also disabled we'd end up with every venue refusing, triggering an open cycle after the sweep — though I need to check whether readLbPair gets called earlier in market() before the sweep decision, since there's a check that throws if venues is empty before sweeping happens.

A disabled Meteora pool still counts as a "usable venue" since the check only looks at mints and deviation, not status — so if Orca is also unusable, say it's out of band on price, we'd sweep funds and then both swaps fail, landing in an open cycle requiring manual recovery. It's a narrow, low-probability path, but it does lead to the worst operational state, so I'll flag this as LOW severity: the status field is read but discarded when it should gate venue selection. Now I want to look at the minimum-out parameter in Orca's swap instruction data.

Checking the byte layout: discriminator plus amount plus threshold plus sqrt price limit plus two booleans adds up to 42 bytes, matching both what the code constructs and what the judge validates against. The argument order and field types line up with Orca's whirlpool swap IDL, and the a_to_b and amount_specified_is_input flags correctly indicate we're selling wSOL for cbBTC with the amount treated as input.

Now I'm confirming the sqrt_price_limit value against Orca's MIN_SQRT_PRICE constant — since a_to_b swaps push price downward, the limit needs to sit below the current price, which checks out. Next I'm working through the required account list for Orca's swap instruction: token program, token authority signer, the whirlpool account itself, and the owner/vault accounts for both tokens involved.

With that confirmed at 11 accounts, I move to Meteora's swap instruction — its arguments are amount_in and min_amount_out, totaling 24 bytes for the data payload, matching the judge's check. Then I start listing Meteora's account requirements: the lb_pair, bin array bitmap extension, reserve accounts for both tokens, and the user's token in/out accounts...

I'm confirming the remaining accounts (mints, oracle, optional host fee, signer, token programs, event authority, program ID) and verifying that user_token_in corresponds to wSOL since we're selling SOL as the Y side, while user_token_out is cbBTC as X -- reasoning through how the program infers swap direction by matching the input token's mint against token_x_mint.

I'm checking that both the deviation filter and the floor calculation pull from the same oracle read: revenue.mjs makes two market() calls, pre- and post-sweep, and it's the second call's minSats, weights, and venues that feed the guaranteed amount and drift guard, so the floor and the deviation check stay consistent with each other.

The units check out too: minSats is denominated in cbBTC sats, and both Orca's exact-in threshold and Meteora's min_amount_out are expressed in the same output-token units.

Now I'm auditing the judge function that validates swap instructions, starting with its venue lookup and bigint parsing of the input amount and floor.

I'm verifying that BigInt conversion throws correctly on null and undefined so the catch block properly nulls out invalid amounts, then checking the allowlist of permitted programs built from compute budget, system, token, and ATA programs plus the venue program.

Now I'm walking through each instruction: flagging unknown program IDs, catching unauthorized signers other than the owner, rejecting disallowed priority-fee compute budget instructions, and restricting token instructions to only the approved opcodes. I'm also enforcing that the transaction has exactly seven instructions and starting to pin down what each position in that sequence must be, beginning with the compute budget setup.

Good, those length checks on closes, transfers, and swaps all hold.

Now I'm probing for gaps a tampered builder could exploit — specifically unchecked accounts in the swap instruction. Several keys like the token program, vaults, tick arrays, and oracle aren't validated here, so I need to check whether Orca's own program-level constraints (like vault address checks against the whirlpool state) cover that gap instead.

I trace through: Orca validates vaults and tick arrays as PDAs against the pool, and the oracle too, so the program itself acts as backstop even though the client-side check skips them. Meteora similarly validates its reserves via has_one and bin arrays via PDA seeds, so both swap paths are self-defending.

Then I notice the token program accounts — Orca's declares a strict Token program type so a fake one would fail, but Meteora uses an interface type accepting either Token or Token2022, so I'm checking whether swapping in Token2022 there would actually break the transfer due to account structure mismatches.

I also confirm the judge validates that the swap's output lands in the operator's own cbBTC account at the correct key index for each venue, and that minimum-out and direction bytes are checked against expected values.

I'm continuing to verify the amount checks and that ComputeBudget instructions are tightly pinned, with the fixed instruction count preventing extra instructions from being smuggled in.

But I'm second-guessing whether the deprecated `RequestUnits` discriminant (0), which also sets an additional_fee, could slip past the checks since it's not explicitly matched like SetComputeUnitPrice is.

Actually, since the judge requires ix0 to be exactly SetComputeUnitLimit(400000) and the instruction count to equal 7, there's no room to sneak in an extra ComputeBudget instruction without breaking either the length check or the position-0 check — so that path is already covered.

Checking the ATA creation validation: `ataOk` verifies the programId, data, and the exact set of keys for both WSOL ATAs, which fully covers that requirement. Now I'm wondering if there's a gap around whether the judge verifies the remaining keys on one of the instructions.

The close instruction's destination keys confirm rent goes back to the operator, which checks out. I'm also considering whether a tampered venue argument could slip through if swap.mjs passes mismatched values, and whether the judge actually verifies account counts on the Orca swap instruction rather than just specific indices — that gap could let someone append extra accounts undetected.

Thinking through whether Anchor's tolerance for extra remaining accounts matters here: Orca's swap doesn't touch remaining_accounts so it's safe, and Meteora's bin array loading just validates each extra account as a legitimate BinArray PDA, so there's no exploit there either. I also confirm a second System transfer instruction would get caught by both the transfer-count check and the total instruction-count check, then start considering whether ix5 could be swapped for a different venue instruction entirely using a matching discriminator.

The signer-marking loop doesn't give an attacker any advantage either, so that avenue seems closed off. Now I'm checking the tick array derivation logic for Orca, tracing through the math with negative tick values and a given tick spacing to see if the floor division and span calculation produce correct start indices.

Working through the numbers confirms the same result as the direct division approach, and I verify that the two-step Euclidean division identity holds for positive divisors, so both formulas are equivalent. The tick array PDA derivation uses the seeds "tick_array", the pool address, and the start tick index as a string.

I'm now considering edge cases: if a tick array account hasn't been initialized, Anchor's account loader will throw an error and the swap will revert. Since this pool is large and tightly spaced, the nearby arrays likely exist, but I need to check what happens two arrays below the current price.

Those tick arrays only get initialized when a position opens spanning them, so for a mature pool with wide-range LPs it's plausible but not certain they exist. I'm trying to recall whether Orca's swap instruction actually allows passing uninitialized tick array accounts or whether it strictly requires initialized ones, since the SDK's handling of insufficient arrays isn't fully clear to me.

Older SDKs just pass all three tick array addresses regardless and fail if uninitialized, while newer ones detect and either throw or substitute. This is a genuine risk for the fallback path — the fork tests for 2 SOL and 10 SOL swaps prove the three arrays exist against today's cloned pool state, but if price shifts so a needed array becomes uninitialized, the Orca swap would fail.

That failure would just route to Meteora, which seems acceptable since the only cost is the thinner fallback venue — unless both fail, leaving an open cycle. Worth flagging as low severity: there's no pre-check that the derived tick arrays exist before sweeping, and a ~15% price move into an uninitialized region could force reliance on Meteora or cause total failure, though a 10 SOL swap would likely only touch the array containing the current tick anyway.

I'm now verifying the bin array index math for Meteora: for Y→X swaps buying X, the active bin should move up since X gets scarcer and pricier, and the code's array selection logic matches this expectation, computing bin array index via floor division by the max bins per array, consistent with Meteora's own implementation.

Checking the PDA derivations next — the bin array PDA seeds and the bitmap extension PDA seeds both match Meteora's conventions, and I'm confirming how Anchor represents an absent optional account (passing the program ID itself as a sentinel for None).

Verifying the host fee slot, event authority PDA (using the standard `__event_authority` seed), and the two SPL token program references all line up correctly, then confirming the oracle PDA seeds against Meteora's actual program.

Now I'm thinking through the wSOL flow: using an idempotent ATA creation, wrapping exactly the input lamports, syncing, swapping, then closing. I need to check what happens if the operator's wSOL account already has a balance before the wrap — whether the close instruction would improperly sweep pre-existing funds along with the wrapped amount, since closing a wSOL account transfers all its lamports regardless of the token amount field.

This could affect the test's spent-amount assertion range, though that's just a test concern, not a security one. I also confirm wSOL has no freeze authority so the ATA can't be frozen, and a delegate on the operator's wSOL ATA shouldn't matter to the swap logic.

A stranger could create the operator's wSOL ATA beforehand, but since the owner is still the derived operator, this doesn't give the stranger any advantage — rent just gets refunded to the operator on close, which round 33 in the suite already covers.

For exact-in swaps with MIN price limit, Orca typically consumes the full input unless liquidity runs out across the arrays, in which case leftover wSOL gets returned as SOL on close while the output threshold check should still catch any partial fill that doesn't meet the floor, since the floor is calibrated to the full input amount.

Checking Meteora's behavior too — if bin liquidity across the three bin arrays can't absorb the full amount_in, it likely errors rather than partially filling, but if it did partially fill, the same unreconciled leftover SOL issue would apply. This looks like a low-severity finding: any residual SOL stranded on the operator wallet from a partial fill wouldn't be captured by the ledger, since it records the full swept amount as the cycle's input regardless.

Checking `cycleIsOpen`, the cycle stays open until the split happens, and if the return's confirmation times out after the transfer lands, the code throws rather than silently swallowing it, which correctly keeps the cycle open for recovery — that's the loud failure path working as intended. I'm now noting that `returnedSats` gets written only after the return confirms, which matters for ordering.

I realize `returnedSats` is the delta measured before the return, not the actual returned amount — so if the return transfers the full ATA balance (possibly including leftovers from a prior cycle), `sweptAtaTotal` captures the larger amount while `returnedSats` stays at the smaller delta, which seems intentional. I check whether `closesCycle` still works correctly in that case: since the split total must be >= returnedSats and the actual returned amount is >= returnedSats too, this holds fine, and the opposite scenario where the return sends less than returnedSats shouldn't be possible.

Now I'm also thinking about adversarial pool manipulation on a ~$0.9M Meteora pool — a 10 SOL swap's price impact depends on bin liquidity, and pushing the active bin by roughly 6-7 bins to hit the 99bps edge of the gate could cost an attacker tens of thousands of dollars in committed capital, depending on per-bin depth.

I'm calculating whether that manipulation is actually profitable: extracting up to 150bps on a $1,200 swap nets maybe $18, but trading through those bins costs $45-90 in fees alone, so the attack isn't worth it at this trade size — the small cycle size itself provides protection. Now I want to check the same math for a deeper Orca pool, since a $10M pool with tighter fees might behave differently when trying to move price by 99bps.

Running the numbers, moving Orca's price 1% still requires ~$100k of volume, and at 16bps fee that's $320 in costs to extract only $18 — still unprofitable, which confirms a pure sandwich doesn't work at this cycle size. The real residual risk is just natural price drift inside the 150bps window costing up to 0.15 SOL per cycle, capping around 18 SOL/month at max throughput — an honest, acceptable bound worth noting as informational.

One thing still nags me though: the deviation check only reads the market state once, but `market()` gets called twice while the swap is built and sent from the second read — leaving a window where the pool could shift between that read and execution.

Checking it further, the on-chain floor from the second read is the only real safeguard, so the guarantee reduces to output being at least the oracle price at that second read minus 150bps — which is correctly documented. I also want to verify the requote drift check, which compares the expected output between the two market reads; since both come from the oracle, it only catches oracle movement within seconds, which is rare enough to be fine. I notice the revenue sweep happens before the second market read, meaning if the market moves out of band right after sweeping, the cycle could get stuck open — something already documented. Now I want to look at the sweep function itself.

The sweep caps the withdrawal by the balance minus reserve, a max-per-cycle limit, and a chain cap, enforcing a minimum threshold below which nothing is swept — so the effective ceiling per cycle is bounded at 10 SOL by the chain cap, and the on-chain program double-checks that balance minus reserve covers the swept amount. The operator floor check also runs before the balance read, which is correct. One more detail worth tracking: the operator pays swap fees and potentially two ATA rent costs (~2,039,280 lamports each) if new accounts need to be created.

Checking the operator floor against ATA creation costs — with 0.02 SOL floor, the cbBTC ATA gets created upfront from the float before the sweep runs, leaving enough margin, then the sweep delivers 10 SOL which covers the wSOL ATA creation during the swap itself, so the sequencing works out. But since the wSOL ATA gets closed after each swap, it has to be recreated every cycle, adding that rent cost repeatedly.

Now I'm checking revenue.mjs for a potential bug. The code creates the revenue PDA's cbBTC associated token account idempotently, with the operator paying for it if it doesn't exist yet, and I'm examining the logic that fetches the operator's existing ATA account info to see how balances are checked.

The balance read treats an absent account as zero, but throws if the account exists in a foreign or malformed state, which correctly refuses the sweep before any funds move. The code then conditionally creates the ATA if absent, records the pre-sweep operator balance into the cycle log, and proceeds to execute the sweep itself.

After the venue loop completes, it re-reads the operator's token balance and computes the delta against the pre-sweep amount, throwing if the increase falls short of the guaranteed minimum — a solid safeguard. I notice `opAta` gets recomputed identically rather than reusing the earlier address, which is fine but slightly redundant.

Now I'm looking at the revenue split logic, where the decimals value is hardcoded to 8 to match cbBTC's known precision, which matters because TransferChecked validates that value against the actual mint.

Checking the split instruction's account ordering and mutability flags against the Rust struct — the config account is read-only as expected, and the account sequence in the JS caller matches SplitRevenue's accounts exactly, including the crank's invocation. Everything lines up consistently here, so I'm shifting my attention to a different area of the code now.

I'm now checking how the detectors handle the new rescue_nested instruction — confirming VAULT_RESCUED gets attributed to MINT even if called via CPI, since MINT would still be at the top of the stack. The destination address is parsed and printed but not independently validated, which is fine since the program itself constrains it. Next I want to verify completeness of ALARM_KINDS against what the detectors and alarm module actually emit.

I'm double-checking the character count of the alarm label string "cbob-vault-alarm:vault_rescued_to_squads" to make sure it fits the length constraints, counting out each segment carefully.

Both labels check out within the 40-character limit, so I'm moving on to verifying the layout structs match the Rust struct definitions in the selftest.

Now I'm cross-referencing MintConfig's field order against the Rust source: version, collection, governance, pool_ata, round_id, opens_at, closes_at, price, cap, minted_this_round, minted_total, max_supply, bank_treasury, split_bps, sales_stopped, sweep_stopped, guardian, swap_operator, sol_reserve_lamports, bump, max_sweep_lamports, sweep_cooldown_secs, last_sweep_at, level_caps, level_minted, revealed_total, payment_mint, pob_collection, pob_root, charter_opens_at, charter_closes_at, charter_claimed, and bare_burns_retired.

Still listing fields...

Now I'm verifying the MintConfig layout against layout.mjs matches in order, then manually computing byte offsets field by field to confirm minted_total lands at offset 141 as required by spec.

Continuing through the offsets, I land on bare_burns_retired at 454, which matches what SPEC expects for the BURN instruction to read. I also cross-check that bank_treasury sits correctly at 157, consistent with my earlier review.

Looking at round 24's D6 check, I confirm the selftest asserts all 11 seeds against the Rust constants, mapping SEED_SRC and verifying the count. But I notice RESCUE_SEED, a new mint seed, isn't included in L.SEEDS — I'm weighing whether that's an actual gap, since the alarm code doesn't need it but the instruction builder in ix.mjs would.

The direction of the assertion matters here: it checks layout→Rust but not Rust→layout, meaning a new program seed could be introduced with no off-chain mirror and no test failure catching it. That's the same "silent drift" risk pattern the task is probing for, just applied to seeds instead of structs.

Refocusing on struct changes specifically — parseRustStruct fails loudly on malformed lines, and field lists plus versions are checked for exact matches, so that part of the assertion machinery looks solid against silent breakage.

But I'm realizing a field could be added consistently in both the Rust struct and layout.mjs without bumping the version, since the version comparison would still pass (both unchanged) and the space check would grow consistently on both sides too — meaning a new field could silently eat into what was previously padding, without triggering any version-based warning for old readers, since there are no old readers to worry about.

The bigger gap I should flag: a brand new struct added in Rust that's never added to the STRUCTS list in selftest.mjs would simply never be checked at all.

Other things checked correctly: a field changing from `u64` to `i64` (same size, different signedness) still fails since the type string is compared directly, and `BOOST_RING` has an explicit assertion line catching changes there. Attribute lines like `#[derive(...)]` are properly skipped, and `///` doc comments get stripped out via comment removal — though I should check whether block comments `/* */` inside a struct would break the parsing.

I'm now walking through the parsing logic for the collection plugins hash, verifying the byte offsets for update authority, name/uri strings, minted counts, and plugin header before it hashes the remaining buffer slice.

If `o` lands beyond the buffer it correctly returns TRUNCATED, and if `o` equals the buffer length exactly it hashes an empty slice, producing a consistent fixed hash for collections with no plugin data — which seems fine since `initialize` always sets up royalties, guaranteeing an actual plugin region.

Now I'm checking the accrual arithmetic in R4. The ceiling-division for sats matches Rust exactly, but I notice the JS available-balance calculation clamps a shortfall to zero instead of raising a PoolShort error like Rust does, which could let the crank silently plan an empty distribution instead of failing loudly when the pool is actually short.

Moving to the credit and pendingScaled formulas, both match the Rust owed_of logic including the weight-plus-boost calculation and the checked subtraction that should throw on negative values, and the floor division for pendingSats also lines up with Rust's claim function.

For reweigh, the owed/carry/debt update matches Rust exactly, aside from Rust also tracking total_active_weight which JS doesn't need. And debtAtActivation correctly uses only the level weight (no boost) for a newly joining vault, matching Rust's join logic where carry starts at zero.

Claim settlement in Rust recomputes carry and debt scaled by the accumulator after payment, but the JS crank doesn't need to model that post-claim state since it just reports owed sats and re-reads fresh each pass. I'm now checking whether a record could appear twice in one pass — once from the claims loop and once from plan.joins — which would be a bug if the claims loop doesn't properly skip already-processed entries.

Working through the epoch logic, I confirm a joins record always has request_epoch equal to dist_epoch, so it can't be in preJoins (which requires strictly less than dist_epoch), meaning joinedNow is false and the claims loop skips it since it's not active yet — no duplicate processing. I verify preJoins and joins are mutually exclusive sets by definition, so there's no overlap risk there either, and now I'm moving to check the crank's preExpired branch logic.

For the pending-scaled calculation at expiry time, I trace through what happens after expire_boost runs: carry gets set to the pre-expiry pending value, debt becomes levelWeight times the old accumulator, and boost resets to zero. When distribution then raises the accumulator, the owed amount works out to exactly the pre-expiry pending plus levelWeight times the accumulator delta — which matches the formula precisely, including the floor division by ACC_SCALE. This confirms the crank must expire every due boost before distributing, and I'm now checking the invariant about which boosts need expiring.

I verify pre-expiry covers boosts where the distribution epoch is already at or past the end epoch, and post-expiry catches boosts whose end epoch equals exactly one past the distribution epoch — since the distribution advances the epoch by one, this correctly captures boosts that become due immediately after. I also confirm post-expiry properly excludes vaults already handled in pre-expiry or retiring, and that newly-joined vaults can't have a boost yet, so the logic is complete.

Checking that the alarm system pages boosts_stalled while treating cbob_mint and boost bounds as permanently fixed critical parameters — this checks out in both the overdue detector and the watch configuration. Now I'm examining how boosts_stalled validates that pending counts aren't null before proceeding.

The boosts_stalled check is nested inside a guard requiring pending_count and pending_this_epoch to be readable, which also gates joins_stalled and launch_tick_overdue. Since these pending fields are always watched and produced, this coupling is just slightly unusual structurally but doesn't create an actual defect.

Looking at distribution_overdue logic, I see it requires withdrawable (w) and poolAvail to both be positive before returning any stalls -- so if a due boost is blocking everything, poolAvail could end up at zero, which would suppress this check entirely.

Now I want to examine the crank problem deduplication more carefully. The key normalization replaces digits with `#`, but word-boundary matching behaves oddly on base58-style addresses where digits are glued to letters without a clean boundary -- that could mean address strings with embedded numbers aren't normalized the way the dedup logic intends.

Shifting to the test gates in run-tests.sh, I'm checking the various floor thresholds configured there -- minimum assertions, determinism floor, allocation floor, poster floor, and the main gate values.

I'm verifying each `floor()` check uses strict equality, then cross-referencing whether SPEC's documented assertion counts (917 detector, 39 allocation, 23 poster, 4 expiry-budget, 14 Proof-of-Burn, 49 launch, 33 mainnet) match what's actually enforced in the script.

Now I'm checking the "889 assertions, real cloned Core" line matches its regex, and tracing which host tests contribute to HOST_FLOOR=6.

I count five named host tests plus Anchor's generated `test_id`, totaling 6. Then I'm verifying the floor-check logic for "host unit tests" — it greps for `[0-9]+ passed` and takes the last match via `tail -1`, but I need to confirm doc-tests won't interfere since they'd also print a "test result" line with potentially "0 passed".

Since the cargo test invocation restricts to `--lib`, doc tests shouldn't run, so that risk doesn't materialize. Now I'm shifting to scan selftest.mjs for vacuous checks — assertions that pass trivially, floors satisfiable by deleting work, or checks that validate nothing when given empty input, starting with the round-24 H1 router block that compares key counts against label counts.

Checking through these router assertions: if the router is unavailable it returns a single sentinel string, so length mismatches and pattern mismatches against the expected constant both cause the test to correctly fail rather than pass vacuously — these fail closed as intended.

Now I'm verifying the control-table gate, confirming the table block still has enough rows and that every row in that block carries a classification label.

Next I should check the wiring gate, making sure every exported detect function is actually consumed in main and matches what V6_WIRED derives from the module's exported keys.

That also matches the spread pattern fine, and `detectUndeclaredTokenAccounts` falls under RECONCILE_ONLY so it's exempt. The I4 pinned-args list pinning all 33 calls is a strong gate—any addition, removal, or reordering would break the length or sequence check—so now I'm verifying whether `detectSplitHistoryGrowth(next.seenSplits)` is actually included in that pinned list.

Confirming it's the last entry, and `detectSweepState`/`detectLogGaps` are also present, with `detectUnreconciledRevenue` appearing three separate times from the early returns plus the main call. I'm checking how `callsIn` scans main()'s body with its regex, and noting that the nested `D.crankPosture(` call inside `detectCrankPosture`'s arguments won't get mistakenly matched since it's not a `detect*` or `parseCbobLogs` call.

Tracing through similarly nested calls — `D.parseCrankHeartbeat` and `D.readCrankBeat` don't get matched either, while `D.parseCbobLogs` correctly gets pinned. These gates all seem solid, so now I want to focus on what the prompt is hinting at: finding a repair in the round-24 selftest section that's only armed in one direction instead of both, which means I need to scan through that block systematically.

Looking at H1, I'm checking whether every finding kind is classified once at some level, and testing the both-ways arm with a brand new kind pushed into the emitted list to confirm it catches unlisted kinds. There's also a check for alarm kind table entries that never get emitted anywhere — this one looks one-directional, only checking that listed kinds are emitted, but I'm wondering if it could still fail in a useful way if a kind exists in the table but nothing emits it anymore.

This does appear to be a real check that requires both `vault_awaiting_return` and `vault_rescued_to_squads` to actually be emitted in detectors.mjs, which they are. The label length check is also one-directional but seems fine, and L4b's heartbeat read test is positive-only, though the related streak test covers both directions. L5, L7, L8, and L9 all look like they test both directions properly.

Continuing through L10a-d, L11, I3, I5, and D5, each checks both directions correctly. I'm verifying L6a's logic across the funded/short and above/below ceiling combinations against expected outcomes, and L6b, L1, L2, and L3 all look solid in both directions too.

For I2, the regex checks that crank.mjs uses the chain clock directly without a fallback — testing whether a mutated version with a nullish-coalescing fallback would break the match, and confirming it would since the regex requires an exact comma right after `chainSec`. Now I'm moving to check the A3 sweep-helper arm for similar edge cases around upgrade authority handling.

Now checking the round-25 L7 program-id gate, which covers 14 copies and mutates each one to confirm all 14 are caught — this one looks solid. I also verify the round-25 I4 pinned-args gate properly detects a deleted call by comparing call counts against the pinned list, which fails correctly when they diverge. Next I'm considering whether any check might pass vacuously when given empty input, starting with the H1 kind-baseline check.

Now I'm cross-referencing the hand-written ONE_SHOT list of 21 alarm names against the 'once' entries defined in ALARM_KINDS to make sure every kind is accounted for.

That confirms 21 plus the two missing ones, `revenue_age_unknown` and `sweep_unledgered_state`. So those two kinds never appear in the oneShots array that feeds notices, meaning the per-notice urgency check never actually fires for them — worth checking if that's an intentional gap or a real defect.

That's a meta-assertion gap, not an actual behavior gap, so I'll only flag it as informational at most. Let me instead dig into detectUnsweptRoyalties since it was recently modified, checking how it computes grace periods and cooldowns and handles null inputs before calculating the excess balance.

Tracing through the logic: it computes excess lamports over reserve, resets the "since" timestamp if balance decreased or there's no prior value, and only raises a finding if the time elapsed exceeds the grace period and sweeping hasn't stopped. I'm now checking what the floor constant actually represents in config to confirm the threshold being used.

Since the detector only triggers once at least 1 SOL of sweepable excess has accumulated for a full day, I'm weighing whether smaller unswept amounts (between 0.01 and 1 SOL) sitting forever would slip through undetected—concluding this is just a volume threshold, which seems acceptable since it'll eventually cross 1 SOL. I'm now wondering whether this unswept-royalties check is truly the only safeguard against a dead revenue job, or whether something like unreconciled revenue detection also depends on ledger data being present.

Looking at `revenue_unsplit`, I realize it depends on cbBTC actually arriving in the revenue address—so if the revenue job never runs, that detector stays silent too, confirming `royalties_unswept` really is the liveness check for the revenue pipeline, consistent with the accepted spec design. I'm now examining the `detectRevenueAccount` function, tracing how it computes `since` by taking the max timestamp across all previously seen splits.

The logic correctly resets the clock to the latest split time, since any new balance must have arrived after that point. I do notice a minor pre-existing quirk though: on the very first check with a positive balance, `since` defaults to the current time rather than looking backward, which could delay how quickly a stale balance gets flagged—but that's a small, already-existing edge case. Now I'm moving on to look at `detectUnreconciledRevenue` and how `cycleStartMs` handles sweep timing relative to chain time.

The function tries to find a matching sweep event by signature, then computes the cycle start either from the blockchain timestamp (if chain time is known) or by taking the minimum of the recorded start time and the sweep's block time, falling back to -Infinity if nothing valid is found. I'm flagging a potential edge case where `c.sweepSig` could be undefined and accidentally match an `e.sig` that's also undefined, which would create a false positive match.

I'm confirming the logic: the guard on `e.sig` being truthy prevents a false match when `sweepSig` is undefined, and an out-of-bounds future blockTime safely results in -Infinity, forcing a loud failure rather than silently passing. Now I'm shifting to examine `closesCycle`'s use of a WeakMap to cache sorted splits, keyed by the array and its length, to avoid recomputation.

The risk here is that if the same array object gets mutated in place without its length changing, the cache would return a stale sorted list — I need to check whether that mutation pattern actually occurs anywhere, like in alarm.mjs where `allSplits` is freshly constructed each pass.

Stable array, no in-place mutation, so it's safe. I'm verifying the sorted splits list filters out null entries and that the binary search's monotone condition on splitTime holds correctly for the legacy non-anchored path, then checking that closesCycle with exclude correctly scans forward from the first qualifying index to return the earliest valid split, comparing against the old implementation's behavior.

Both approaches filter excluded entries and upper-bound by upTo, just in different order (filter-then-sort vs. scan-with-skip), but they produce the same result since the list is sorted ascending and we break early once splitTime exceeds upTo. Now I'm moving on to check detectSplitClaims, looking at how it determines which cycles count toward verification and builds the recent set from the last N qualifying cycles.

I'm then tracing through the main loop: for each cycle, it separates out splitByOther cases, skips ones without a splitSig, flags reused split signatures, checks whether the cycle falls within the recent set and whether enough grace period has passed since cycle start, flags cases where the signature isn't seen on-chain, and finally branches based on whether sats were returned.

I confirm splitByOther and splitSig are mutually exclusive since revenue.mjs only sets one or the other depending on the code path, so the claimed-set logic holds up. Now I want to dig into revenue.mjs's recovery logic for returned-unsplit cycles.

I'm tracing how it filters cycles that are open with nonzero returned sats, backfills missing block times for their return signatures, and then computes the revenue ATA to check deposits since some timestamp.

Still matching splits to cycles...

Checking the soundness of this: a split occurring after the return necessarily emptied the account, so it had to include the returned cbBTC — that logic holds. But I'm worried `splitsSince` only scans a bounded number of signature pages on the revenue ATA, so if that account has very high transaction volume, some matching splits could fall outside the scanned range.

With roughly 2,100 total mints each contributing one signature, 10,000 signatures should be more than sufficient, and the function correctly breaks early once a page's oldest timestamp falls below the target time. Though calling `readParsedTransaction` for every matching signature within a busy window does mean a lot of RPC calls, which is acceptable but worth noting. I'm also double-checking the early-exit condition against the per-signature skip logic to make sure they can't disagree in a way that causes premature termination.

Now I want to think through the `--audit` path and how `cycleIsOpen` behaves for a row that only has a `pendingSweepSig` set — the case where a sweep transaction's outcome was uncertain, the attempt was recorded before throwing, and the row ends up with intended lamports but no confirmed swept lamports yet.

In that case, `cycleIsOpen` correctly flags the cycle as OPEN since moved funds exceed zero while returned funds are zero, which correctly triggers an `unreconciled_swap` CRITICAL after the grace period and blocks the next run — appropriate since the sweep might have actually landed. But I notice a subtler issue: since the intent row is saved before the sweep send happens, if the process dies in that exact window, the ledger will show an open cycle for SOL that was never actually moved, which seems like a flaw worth flagging.

Actually this killed-before-send scenario leaves an unresolved open row that `detectSweepState` won't catch since the sweep timestamp never updates, but `unreconciled_swap` will still fire and require manual intervention — which matches the documented "hand recovery" path in the spec, so it's accounted for. Now I want to look more closely at `judgeFeePayer` and how the crank computes its lamport `need` within `budgetPlan`.

Checking the ceiling case where the base plan is covered: the warning fires correctly with `warnKind: 'ceiling'` once daily, and when lamports exceed the floor significantly, room stays large so all reveals are kept. I'm also confirming that when `budgetPlan` returns `ok:false`, `warnKind` stays undefined and `fee.warn` is null, so the warning block correctly stays silent in that failure path.

Now I'm shifting to a different question: whether there's a plan the program will actually reject, wasting fees or causing false pages. One candidate is `plan.activate` on a vault whose canonical cbBTC account is frozen — looking at the activation logic, it only checks the token amount via `read_token`, never checking account state, so a frozen account would still pass activation despite the crank's filter expecting `state === 'ok'`.

Checking a second candidate confirms `activate` already skips assets with zero level, so that's not an issue. For a third candidate, `retireBurned` requires the asset to be Core-owned with exactly 1 byte equal to zero, which matches exactly how the crank classifies an asset as 'burned' — so no mismatch there either.

For reveal ordering, if a traffic record gets revealed between when the plan is built and when the crank executes, the on-chain `revealed_total` would no longer match the plan-time config, producing a `RevealOutOfOrder` error that's benign and just causes a break. I'm also checking split logic requiring both pool and bank state to be 'ok' before proceeding, and now I'm wondering whether there's a boosted vault with a due boost that the crank's prefetch pass might miss entirely.

All vault records get pulled via getProgramAccounts with a discriminator filter, so truncation seems unlikely given Helius returns complete results — but if it did happen, the distribute call would just refuse with BoostsExpireFirst and get treated as a race condition, failing loudly rather than silently. Then I'm looking at the expire_boosts batch sizing constants and confirming the program requires a non-empty remaining list, so an empty preExpires just skips the loop harmlessly.

Next I check the claim batch size of 14 against packet limits — with 14 pairs that's roughly 31 accounts and about 1,110 bytes once keys, headers, signature, and blockhash are counted, comfortably under the 1232-byte cap. I confirm preJoins batches also use this same claim batch constant with the expected instruction data format.

Then I verify that claim correctly rejects mismatched vault accounts by checking the destination key against the record's vault_ata, both for active vaults and pending records where destOf resolves to the same vault_ata, so the crank's destination always matches what the program expects.

Checking whether a claim batch could mix a paying vault with a joining vault so a frozen pool reverts the whole batch: the ready list combines paying vaults and plan.joins before chunking into batches of 14, so mixing is technically possible, but since the crank only plans claims when the pool isn't frozen, this scenario can't actually occur.

The preJoins batches sent before distribution are genuinely join-only, matching the spec, but the post-distribution joins mixed into claim batches aren't — though this turns out to be a documentation nit rather than a real issue since claims never get planned against a frozen pool anyway. I want to dig deeper into false pages now, specifically around the distribution refusal judging logic.

Checking `judgeDistributeRefusal`, I see it correctly re-reads config and checks whether dist_epoch or last_distribute_at moved, but I need to verify the handling when distribute fails with benign codes like MonthNotElapsed or NothingToSplit — those are caught by `send`'s BENIGN check before judgeDistributeRefusal is even reached, and main() only invokes judgeDistributeRefusal when send returns 'fail', not 'benign'.

If the distribute failure produces no error code at all — say from a CPI error or unavailable logs — lastFailure ends up empty, and judgeDistributeRefusal('') falls through every case to 'fail', correctly treating an unknown failure as something that should page rather than get silently dismissed.

Since `lastFailure = code || ''` always runs on the fail path, it's safe against stale values from a previous send — each failing call overwrites it fresh. I want to move on now to another detail I spotted earlier.

The reveal-only lane filters getProgramAccounts by memcmp on the `level` field at offset 57 in VaultRecord, checking for a zero byte to find only unrevealed records — I'm verifying the offset math against the struct layout (version, asset, mint_index, reveal_slot, level) and confirming bs58 encodes a single zero byte as "1". That confirms the reveal lane correctly isolates unrevealed accounts, though I still need to check how planCrank uses this filtered set to build its queue.

In REVEAL_ONLY mode, planCrank pulls the reveal queue from `cfg.revealed_total` via `byIndex`, which works since unrevealed records are exactly what's fetched. I'm also noting that main() still fetches asset infos and token addresses for every filtered record even though that's somewhat wasteful, plus reads pool/revenue/bank/payMint/clock data unnecessarily — all harmless overhead. Now I want to check whether anything in the crank logic could move value in ways the program doesn't properly pin, starting with how the payer signs into `reveal_level`.

The payer only pays fees and rent via Core's update — no SystemProgram transfers appear anywhere, matching the selftest's assertion that only `MINT` program IDs are used and no transfer builders exist. The attribute being added is a bounded 16 bytes, and the whole attribute list stays capped by `MAX_ATTR_BYTES` since the program resends it.

I'm wondering whether Core's realloc behavior during `UpdatePluginV1` handles growth correctly when the asset has other plugins like autograph pushing size up, and recall round 28's test case with a 10,198-byte asset landed successfully, though I'm unsure how much rent the payer covered there.

The autograph was added by the owner, who covers that rent, so the reveal only adds the fixed 16-byte delta the payer must cover — bounded and consistent with `REVEAL_RENT_LAMPORTS`. I'm now checking whether a malicious minter could craft a vault that inflates the crank's realloc cost beyond this, but the attribute list is capped at 640 bytes so the delta stays fixed at +16 regardless.

Now I'm shifting focus to `bank/txread.mjs`, specifically looking for a way a CBOB event could be lost silently during transaction parsing. I'm examining how `validateParsedTransaction` handles truncated logs and how `parseCbobLogs` reports unbalanced-stack problems — checking whether events found before the error are still correctly surfaced in findings.

Looking more closely at the stack-tracking logic, I notice that when a program's success/failure line doesn't match the top of the stack, the mismatch is flagged as a problem but the stack isn't popped — meaning it stays stale. That raises the question of whether an attacker could craft a log sequence where a different program's event ends up misattributed to MINT because MINT remains on top of the corrupted stack.

But I realize the logs come from the runtime itself, not from arbitrary program output, so invoke/success/failed lines are faithfully emitted and always balanced for successful transactions, while failed ones are skipped entirely by the alarm. A program trying to spoof a fake "invoke" line via a log message would just get wrapped in "Program log: " prefix, which fails to match the strict regex — so that spoofing vector doesn't work either.

I'm also checking whether an attacker could fake a "CBOB_REDEEMED" log attributed to BURN by CPI'ing after BURN completes, but once BURN succeeds and pops off the stack, any subsequent log gets attributed to the caller instead, so that doesn't work. Similarly, trying to piggyback on MINT via a permissionless no-op call doesn't let them inject a log while MINT itself is active on the stack. This confirms the log parsing logic is sound.

Now I'm tracing through the cursor-advancement logic in the alarm handler, checking that the cursor only advances when every transaction was successfully read — and it does, but I notice `if (s.err) continue` skips failed transactions entirely, including their logs and instruction detectors, which means a failed transaction could slip past undetected.

Confirming that's safe: a failed transaction's state changes are reverted, so it moved nothing and correlateBurns relies on that. Then I check the log-truncation handling, which records a gap only if one of our programs actually ran among the normalized top-level plus inner instructions.

I confirm meta.innerInstructions isn't affected by the log truncation limit, since that only truncates logMessages, and innerInstructions are always complete separately. So CPI calls into our programs still get counted correctly in the flattened instruction list.

Checking further, the split detection and sweep detection both operate on the instructions array rather than log messages, so truncated logs don't affect their accuracy. Now examining revenueOutflow's handling of transferChecked versus transfer instruction formats, and whether it correctly handles cases where tokenAmount might be omitted from the RPC response.

I'm also confirming that revenueOutflow correctly includes inner instructions, since split_revenue's transfers are CPI calls nested inside the MINT program's top-level instruction — and verifying no other program can sign for the revenue PDA, so this path is safe. Still haven't found a critical issue, so I need to keep digging.

Looking at the crank's plan validation, I want to check whether it can pay or join a dead vault. The check only verifies the asset is a Core AssetV1 owned by the right program with the live flag set — it doesn't verify the asset belongs to our collection, though a VaultRecord implies it does since only MINT creates those. But 'live' doesn't distinguish a properly rooted vault from a nested or orphaned one, meaning the crank could end up activating, joining, and paying out a vault that's actually orphaned.

With rescue_nested now in place, these orphaned vaults become recoverable, and the crank still happily processes them — this was the repair direction chosen over outright blocking activation. The SPEC claims this doesn't dilute other vaults since the payout accrues in the vault's own wallet and goes entirely to whoever eventually claims it. I want to verify that claim is actually true: since an activated vault holds weight in the total active weight pool, every distribution routes its proportional share into its own wallet, so no value seems to be destroyed — but I need to check whether this affects the shares other vaults receive.

The nested vault has a legitimate claim to its share just like any other vault, so this isn't really dilution. But I'm noticing something else: the crank pays out through claim, which deposits into the vault's cbBTC ATA owned by its asset-signer PDA, and since rescue transfers the asset itself, the new owner inherits control of that PDA — that part checks out. Now I'm wondering about a separate issue: the crank activates a vault whose owner is itself a vault PDA, and I need to check what activate actually requires of that owner.

Activate just checks that the vault is live in our collection and that its ATA holds 21,000 sats — there's no owner check, so a nested vault gets activated fine, then it needs to be joined via claim or activate again, which resolves cleanly. Distribute is blocked by JoinWaitingFirst only until the nested vault joins, which the crank handles, so there's no stall — item 58 and the crank's behavior are coherent together. I'm now considering whether the crank should refuse to activate a vault held by the CBOBTC Squads: since it's live and in our collection, the crank would activate and fund it even though the Squads can't redeem it, but the payouts still travel with the vault when it's eventually returned, so that seems fine too — though I still want to check whether the crank can activate a vault whose owner key is off-curve.

That's also fine — a DAO-owned vault accrues payouts it simply can never redeem, which is a pre-existing condition flagged by the unredeemable_owner alarm. Now I want to dig into the actual rescue_nested program change and its off-chain mirror, since round 35's changes are unaudited and item 58 is new — specifically looking at how parseCbobLogs, detectProgramEvents, and detectNestedVaults handle the new vault-rescued and awaiting-return states, along with their alarm entries. I'm suspicious there might be a gap in detectNestedVaults, where the check for ownership by CBOBTC_SQUADS happens before the on-curve test, so I want to trace through the exact order of checks it performs.

I confirm the check order is correct, but then I notice vault_awaiting_return is a LEVEL-type alarm that pages every pass until resolved, and it's not in the ACKABLE_KINDS set — meaning if a Squads vault stays unreturned indefinitely (say the original sender can't be identified), the alarm would page at HIGH severity forever with absolutely no way to acknowledge or silence it.

This looks like exactly the "unanswerable finding gets ignored" failure mode the file itself warns against, so I'm going to flag it as a real but modest noise defect, likely LOW severity given it's new code. Let me double-check the item-58 language to confirm this is actually the intended behavior before finalizing.

Since the damage is limited to one daily reminder email and doesn't mask other findings or break recovery logic, this really is a LOW/INFO severity issue rather than something urgent. I'm weighing this against the file's own design principle that an unanswerable finding just gets ignored, while an acknowledgment downgrades severity—which seems to apply directly here since `vault_awaiting_return` is per-kind.

A more pressing question is whether the alarm catches a vault stranded in a foreign asset's wallet, which `rescue_nested` now refuses to handle. Tracing through `detectNestedVaults`, I can see that a vault owned by a foreign signer PDA won't match our collection's owners map, won't match the Squads check, and will fail `isOnCurve` since it's a PDA—correctly triggering the `unredeemable_owner` CRITICAL finding.

But the explanatory text for that finding doesn't mention that `rescue_nested` could actually apply here, nor that it's now permanently stuck after the M1 fix—Review 35's L4 flagged this exact gap. The wrinkle is that post-fix, the rescue only works if the foreign host is burned, not live, so the finding's text needs updating to reflect that narrower condition.

since the off-curve owner isn't in our collection, the operator gets no instruction at all. So this is a LOW finding: `detectNestedVaults`'s `unredeemable_owner` message should mention `rescue_nested` as a path for off-curve owners that turn out to be Core asset-signer PDAs of burned foreign assets, even though the alarm can't verify that without extra RPC calls—it could at least hint at the possibility.

Now let me look for something more severe, reconsidering the earlier point.

Here I'm examining price staleness between the two `market()` calls. `market()` runs twice—once pre-sweep (m1) and once post-sweep (m2)—and the swap uses m2's state to derive tick arrays from the current tick. Between that read and the swap landing, price could cross a tick-array boundary, making the derived arrays stale, so I'm checking whether Orca's swap validates that the first tick array actually contains the current tick.

The sequence lookup errors if the current tick isn't found in the provided arrays, so if price crosses a tick-array boundary between the read and execution, the swap simply reverts rather than executing on wrong data. With tick spacing 16, each array spans about 15% of price range, so a cross-boundary move within a 60-second window would be an extremely rare edge case for SOL/BTC.

Still tracing the tick sequence logic...

This confirms that the current array must contain the current tick index, and the search falls through to subsequent arrays when the tick index goes out of bounds for the current array, advancing the array index as it searches for the next initialized tick.

But if the price moved UP past array 0's upper boundary instead, the downward search would never correct itself since it only advances to lower arrays, leading to an error. So an upward boundary crossing between read and landing is what breaks the swap, with the probability depending on how close tickCurrent is to that upper edge relative to the array span.

Given the tight timing window, the odds of an adverse tick move large enough matter are small, and Orca simply refusing the swap in that edge case is acceptable since Meteora fallback kicks in — this matches Orca's own SDK behavior of including arrays on both sides, so it's not a real finding. I'm now checking the probe path and pre-launch state, which look fine, then moving to review the cron install script to confirm the scheduled jobs (watcher, crank, crank-reveal, revenue, reconcile) are all correctly configured.

Checking the varHasN regex against the installed line confirms it matches since the heredoc expands `$FLOCK` but the gate reads source with the variable still unexpanded, and judgeCronTemplate returns empty on the real file as asserted. Now I'm looking at whether the installer refuses in certain conditions.

The installer also checks for a rehearsal record tree and requires the running user to be "ubuntu", then creates LOGDIR and LOCKDIR via sudo install with proper ownership and permissions. I'm now considering a subtle bug: ALARM_STATE resolves from CBOB_ALARM_STATE at install time, so if that env var differs between install time and cron execution time, the alarm writer and the deadman watcher could end up pointing at different state files.

If that mismatch happens, the deadman would page every two hours forever since it watches a file the alarm never writes to -- a loud false-positive rather than a silent failure, so it's just noise-level, not critical. Moving to `scripts/build-mainnet.sh`, it checks the four programs' source for the non-localnet INIT_AUTHORITY block and the correct authority key, builds both mainnet and localnet targets, and verifies dist/ holds exactly five .so files.

It also compares the sweep helper's mainnet bytes against localnet and target/deploy, deploys each mainnet artifact expecting authority-init to be rejected, deploys each localnet artifact expecting acceptance, and prints sha256 hashes for both dist/*.so and target/deploy/*.so. What it doesn't prove is that the four keyed programs' mainnet bytes match their tested localnet bytes except for the key substitution -- the behavioral test only confirms the key differs, not that the rest of the bytecode is identical, a gap flagged back in round 35's triage C12.

I'm now confirming that build-mainnet.sh does validate the sweep helper's mainnet bytes against what the suite actually deployed, since run-tests.sh copies the localnet build into target/deploy and build-mainnet.sh compares against that same path.

Also checking that it's properly checking for the sweep helper file being nonempty, erroring out if run-tests.sh hasn't been run yet. But I notice the script never actually verifies the other four keyed programs' target/deploy bytes against anything—it just prints their hashes, so a stale build there would go unnoticed.

Now I'm looking at scripts/audit-coverage.sh to check whether web/ files are properly included in the TARGETS array, noting these weren't part of this round's bundle anyway so it's not a concern here.

The verdict's first line format check passes, and the selftest's 14 gate assertions look fine. I'm considering a potential vacuity case: if no rounds are completed, the `covered` set is empty and everything gets flagged as uncovered, which seems like the correct loud behavior.

I'm also checking `blob_at(h, f)`, which verifies files exist at a given commit — if the MANIFEST's head commit isn't resolvable in the repo (say, after a rebase), it returns None and the file is treated as not covered, triggering a re-check.

Now I'm tracing through the sweep helper logic: it validates the account count and signer/program IDs, rejects cases where signer and destination match, then iterates over account pairs reading token mint and owner data for each source/destination pair.

For each pair it checks ownership and mint consistency before transferring any nonzero balance and closing the source account, finally sweeping the signer's remaining lamports to the destination. I'm now considering the edge case of duplicate pairs—if the same source account appears twice, the second iteration would try to read an already-closed account, which could cause unexpected behavior worth flagging.

Working through aliasing cases: when `to` matches `src`, the ownership check breaks since signer and destination can't be the same account, so one of the checks catches it. I'm also examining the case where `to` aliases with `dest`, thinking through whether `dest` being a wallet versus a token account changes whether the ownership check still holds.

Sweeping all lamports from the signer PDA checks out since it has zero data, and the BURN lamports check is satisfied — I confirm the signer's lamports are read after the token closes, so those closes don't inflate signer's balance, and dest being the signer is already refused elsewhere. Now I'm considering what happens if a token account has a separate close authority set rather than the owner, since SPL Token requires that specific authority to sign the close rather than the owner.

So if a foreign close authority is set, CloseAccount fails, reverting the whole sweep and the redemption — this becomes a real limit the page must account for by keeping such accounts undeclared and excluded from the sweep. Since BURN doesn't enumerate accounts, an undeclared stray account should be harmless, but I need to check whether a stranger could set a close authority on one of the three canonical reserve ATAs that BURN requires to be empty — which would require them to be the PDA owner to call SetAuthority in the first place.

Since SetAuthority(CloseAccount) requires account ownership, strangers can only create the reserve ATAs, not claim close authority over them, so canonical reserve ATAs stay safe — C5 only threatens non-canonical stray accounts, which can simply be left undeclared. This confirms the off-chain repair is sound and belongs in the spec's known limitations. I'm now double-checking the attack sequence: the stranger owns the account first, sets close_authority to themselves, then transfers ownership to the vault PDA via SetAuthority — this is exactly how C5 works for non-ATA addresses.

For ATA addresses specifically, though, this attack fails since the address is a PDA of the ATA program, and only that program can sign to create an account there — System createAccount requires the new account to sign, which a PDA can't do outside its own program. This matches Round 34's conclusion that ATA addresses can't be hijacked this way.

Now checking the revenue.mjs notification logic — it only publishes recovery notices for stages that previously failed and have since passed, while pushing a failure notice for the current stage if an error occurred.

Tracing `enterStage`, I see it adds the previous `revenueStage` to `revenuePassed` before advancing, and `lock` gets added to passed right at the top of the lock callback. So if `main()` exits early due to the cooldown not having elapsed, `revenuePassed` would only contain `{lock, config}`, and I need to see how `publishRevenueNotices` behaves in that scenario.

A no-op cooldown run would only trigger recovery notices for stages among `{lock, config}` that previously failed, meaning a failure at `swap` definitely isn't cleared by this path — confirming it stays as an open marker through every hourly no-op cycle until swap actually passes.

Now I want to check whether `detectUnreconciledRevenue`'s `cycle_unsplit` logic, when combined with `closesCycle`, has any high-severity issue worth flagging.

I'm tracing how `closedOnChain` is computed: it checks that sats were returned, there's no splitSig or splitByOther, and `closesCycle` finds a matching split from all splits ever seen, excluding already-claimed signatures. The concern is that `closesCycle` returns just the first qualifying split without marking it as used, so if two open cycles both lack a splitSig, they could both match the same unclaimed split and both get silently marked as resolved — a potential false-negative where a real unreconciled cycle slips through undetected.

Two returned-unsplit cycles normally can't coexist since the open-cycle guard in revenue.mjs blocks starting a new cycle while one is open, unless manual recovery created an edge case. Also, `detectSplitClaims` skips any cycle lacking both splitSig and splitByOther entirely, so these dual-match cycles never even get caught by that other mechanism.

So this gap self-heals within an hour, since cycle_unsplit's closedOnChain check doesn't have the same cross-cycle exclusion as split_by_other_unanchored does — it's narrow enough that I'll rate it LOW.

Now I'm checking detectUnreconciledRevenue for the case where a cycle has sendRejected true alongside a positive returnedSats but no sweep signature or swept lamports recorded. Walking through the logic, that case wouldn't get caught by the rejected-row-has-sweep check, and since cycleIsOpen evaluates to false here, it falls into the closed-cycle branch checking whether swept or returned is zero.

Tracing through, neither swept nor returned is zero in this scenario, so the code continues past that guard into the quote-check logic, and since returned is nonzero there's no unreconciled_swap flag raised. The cycle_unsplit condition could still fire depending on splitSig, splitByOther, and timing since the last return — but this is really a contradictory row (rejected yet returned funds) that revenue.mjs never actually writes, so it's not a real finding.

Now I'm looking at readConfigs and how it throws when missingWatchedKeys returns anything — that error propagates up through main and the withLock catch handler straight to a run_failed page, so a reader that forgets to declare a watched key would surface as a hard failure rather than silent data loss.

I'm checking that all the watched config keys — mint sweep/boost fields, governance last-id fields, burn rate fields — are properly covered by the flattening logic, and confirming the program watch list (core, sweep, third-party programs) matches the drift detector's severity tiers.

Looking at `readConfigs`, when a program like 'sweep' is missing its ProgramData account, the code marks it with a `_missing` flag instead of emitting upgrade_authority/hash keys, and the drift and upgrade-authority detectors correctly skip those absent keys rather than flagging false positives.

Now I'm examining the crank's handling of an eligible vault whose asset turns out unreadable: it logs a problem noting the vault can't be read, skips it, and sets the whole pass as not joinable so no distribution happens that round.

Working through what 'other' actually represents — since burned assets are already filtered out earlier and every asset must have been created, 'other' really means an RPC read failure, not a legitimate asset state. If that read fails for even one asset, the entire distribution pass gets blocked, and this would repeat until the overdue alert and multi-pass paging kick in, which seems appropriately loud. I'm now questioning whether blocking the whole pass over a single transient read failure is actually the right design.

Checking whether an attacker could deliberately force an asset into the 'other' state — a live Core asset has a specific byte marker, a burned one has a different length and marker, so the only path to 'other' seems to be the account not existing at all according to the RPC.

Now I'm turning to verify the redemption rate logic against BURN's actual cap rule — computing live supply, deriving a ceiling-based cap scaled by 210/10000, clamping it between 1 and 64, then checking how many entries in the ring buffer fall within the current time window.

This matches the described rule correctly, so the capacity check looks sound. But I notice the ring buffer values get flattened into decimal strings somewhere upstream, which means I need to double check that `BigInt()` parsing handles those string timestamps properly rather than assuming they're already BigInts.

Next I'm checking whether the alarm actually flags a swap operator once it's been applied, not just armed — confirming that mutation path routes through the config_drift check at CRITICAL severity. Then I'm cross-referencing the production constants (max supply, level caps, monthly seconds) against item 38's required list to make sure nothing's missing.

pob_mint, max_boost_weight/epochs all check out, and charter_opens_at isn't validated against a value since it's meant to stay open.

Looking at check-launch-params.mjs, it requires vault_collection and the coverage set includes PINS keys plus charter_opens_at, lock_deadline, and vault_collection — anything outside that set triggers a "no launch validation rule" error, which is good. But I notice the check only ensures vault_collection isn't one of four specific addresses (pob_collection, bank_treasury, payment_mint, init_authority) — it doesn't actually verify vault_collection is a genuinely fresh Core collection, so something like the guardian's address or a reserve mint could theoretically slip through.

That said, a typo matching another mint would still pass this check, but MINT's own `initialize` logic on-chain verifies the collection is a Core-owned CollectionV1 with MINT's PDA as update authority and is clean, so that on-chain gate catches the real risk — this is at most a low/info-level gap. The checker also doesn't explicitly exclude vault_collection matching cbob_mint or a reserve mint, which is minor. Separately, onCurve is correctly required for init_authority, guardian, and swap_operator but correctly omitted for bank_treasury since that's the off-curve Squads account. Now I'm looking at judgeLaunch's requirement that lock_deadline be greater than the current timestamp.

Moving to `detectCrankSilent`, I trace through how it computes the most recent timestamp between `stampSec` and `armedSinceSec` using a reduce with a null initial value — since any positive number compares greater than null in JS, this correctly picks the max of the two timestamps, falling back to the current time if both are null, which means the function reports quiet correctly in that edge case. That logic checks out. Now I'm examining the balances loop in `alarm.mjs` that processes accounts in 100-account chunks and builds legs from the results.

I'm estimating the account lookup volume: with vaults crossed against reserve mints, this generates thousands of legs requiring dozens of batched account info calls, on top of the DAS pagination and thousands of potential transaction reads — a scale worth flagging.

Checking the key-splitting logic for balance drop detection confirms vault-only keys and vault:mint keys parse correctly since base58 never contains a colon. Now I'm verifying the amount reconciliation function handles short or missing account data as unreadable and reads token balances at the correct byte offset for SPL token accounts.

Next I'm checking undeclared token account rendering formats numeric amounts with a units suffix, then turning to validate the redemption coverage logic for the C5 case—a stranger's token account with a retained close authority whose balance gets swept during redemption but isn't declared in the output. I'm examining whether `classifyPdaTokenAccount` properly rejects accounts whose data length isn't exactly 165 bytes.

The function doesn't check the close authority bytes or the frozen-state byte at all—it just filters zero-amount accounts and otherwise classifies anything 165 bytes long as a normal token holding. That means a 165-byte account with a foreign close authority and nonzero balance gets flagged as "must be declared," so `judgeRedemptionCoverage` would treat it as undeclared and doomed to be destroyed, causing the sweep's close instruction to fail and the redemption to revert permanently. This seems to contradict the validation's claim that the page sweeps the balance while leaving it undeclared—I need to reconcile that discrepancy.

If `judgeRedemptionCoverage` says to declare a frozen stray account but the bundled classifier doesn't check frozen state at all, there's a real inconsistency to resolve. I'm also questioning whether a frozen account holding zero balance can even be closed via SPL Token's CloseAccount instruction, since the spec treats that case differently from one holding a balance.

I'm trying to recall whether `process_close_account` in spl-token actually checks for frozen status—I don't believe classic SPL Token enforces that check, though Token-2022 might differ.

So this points to a real gap: `classifyPdaTokenAccount` doesn't surface the close-authority case, meaning `judgeRedemptionCoverage` would direct the page to declare something that's guaranteed to revert. Since SPEC's Known-limits entry for C5 contradicts what item 50 mandates, this looks like a medium-severity divergence between documentation and implementation in the pre-signing control.

But actually, since strangers can't control the ATA addresses for any of the three canonical reserves, the core redemption flow itself is always safe — the C5 account issue only matters if the page tries to rescue it, in which case the redemption would correctly fail and `judgeRedemptionCoverage`'s warning about destruction is accurate and appropriate.

So the real problem is that `classifyPdaTokenAccount` can't tell apart a sweepable stray account from one that's unsweepable due to a foreign close authority or a frozen balance, which undermines the earlier suggestion to treat the coverage list as a sweep list rather than just a warning.

I'll classify this as MEDIUM leaning toward LOW, since it touches the one pre-signing control for holder funds, but I need to flag that I can't verify how the web/ page actually consumes this function since those files aren't part of what I'm auditing.

Actually, rethinking the attribution: I should pin this specifically on `bank/detectors.mjs`, noting the page's behavior stays unverifiable from here, and downgrade to LOW given both the frozen-with-balance and close-authority cases are already disclosed in limit 44's known-limits list — the remaining gap is just an implementation-coordination note about the pure function not flagging them.

Now I want to push harder for something HIGH-severity, so I'm turning to the least-examined modules — lock.mjs, sigwalk.mjs, anchor.mjs, and spl.mjs — starting with the signing logic in sigwalk.mjs.

Tracing through the pagination walk: with PER_PROGRAM_READS set to 2000, maxPages computes to 2, so I'm checking whether this limit actually catches all the signatures or leaves a gap.

Checking the logic: since each page caps at 1000, two full pages give exactly 2000 and correctly flag a gap, while a partial second page correctly trims the count without a gap. That slicing and gap-detection seems right.

Tracing the backlog resume logic, I verify that the start/until cursors line up correctly. But I notice a potential edge case — if `gap` is true yet `sigs` ends up empty, referencing `sigs[0]` would break, though that seems unlikely given how gap is set.

Checking the unresolvable-cursor guard that runs before iterating over signatures: when sigs is empty but a cursor exists during a backlog drain, the cursor is still resolvable since it's in history, so no finding gets triggered and the backlog-proof path proceeds correctly.

Now I'm tracing a similar edge case where a resumed walk with an unknown `before` value returns empty — this also hits the cursor-resolvable check quietly, then falls into the backlog-proof path that pages the critical alert.

I'm moving to sanity-check `lock.mjs`, specifically how `confirmSole` iterates through generations to detect conflicting tokens, comparing each generation against the caller's own.

Working through the branches: for older generations that are unreadable it correctly continues without failing, for older generations with a different token it fails as expected, for older generations matching the broken token it also continues, and for newer generations it fails — all matching intended behavior.

I'm moving on to review `spl.mjs` and `anchor.mjs`, which look fine, then shifting focus to `txread.mjs` to check how `validateParsedTransaction` verifies the shape of `meta.logMessages`.

I'm realizing a real edge case here: if the RPC returns `logMessages` as null instead of an array—which can happen for very old transactions or when logs weren't recorded—the validation throws, marking the transaction unreadable and permanently stalling the cursor on retries. I'm now trying to figure out whether this is actually reachable on mainnet today, since logMessages is normally always populated, but there might be a scenario tied to how certain transactions exceed log limits that could still produce a null value.

Same logic extends to null inner instructions or token balances when metadata storage is disabled — every transaction in that provider config becomes unreadable, flooding the scan with up to 2000 `tx_unreadable` findings per program, truncated into one loud 60KB notice. That's detectable noise rather than silent failure, consistent with the "refuse unknown coverage" design already documented.

I also check that `scan_gap` correctly pages as HIGH on every pass while a backlog drains, confirmed as a level-type alarm.

Now I want to check the market function's handling of an unreadable Orca pool — if the RPC returns null for the pool account, calling readWhirlpool on it would throw, which gets caught and logged as "pool unusable" rather than crashing the scan.

Tracing further: if both Orca and Meteora are unusable, venues ends up empty and market() triggers a pre-sweep throw, which is correct. I also verify that orcaSpot returns NaN for an uninitialized pool with zero sqrtPrice, and since NaN comparisons always fail, that venue is correctly excluded rather than silently passing. I confirm satsPerLamport can't be zero or NaN since oracleFloor enforces a positive price upstream, so that edge case is already covered before reaching the venue checks.

Owner check also matches. I'm verifying the Pyth feed IDs against known values—SOL/USD and BTC/USD both look correct against the real feed identifiers.

Now I'm stress-testing the deviation gate numerically against the floor. I notice `w.feeRate` is read but never actually used in any calculation—harmless but odd. Working through the math: combining the oracle deviation, fee, and price impact against the 0.985 floor, I find the impact threshold needs to stay under 0.355%, which holds fine for a large pool like a $10M one, but I need to check smaller pools like Meteora's ~$0.9M pool where a 10 SOL trade could push impact higher.

I'm now reasoning through Meteora's DLMM bin mechanics—if the active bin has enough liquidity the impact stays near zero, but with thin bins you'd cross several at ~15 bps each. Trying to pin down Meteora's base fee formula from bin_step and base_factor, then estimating a worst-case stack of ~99 bps deviation + ~30 bps fee + ~45 bps bin-crossing impact, landing around 174 bps total.

If total exceeds the 150 bps tolerance floor, the swap reverts and leaves an open cycle requiring manual recovery—this is the LOW severity issue I want to flag: the deviation gate's 150 bps floor may be unachievable on Meteora (and marginally on Orca), with the failure mode being a dangerous manual recovery path. I'm drafting a fix suggestion: compute the pool's expected output and compare against the floor before sweeping, or adjust the gate parameters so deviation + fee + impact stays under tolerance by construction.

Actually, reconsidering severity—this might be MEDIUM rather than LOW, since the open-cycle state is the one the spec explicitly flags as dangerous (automatic path can't double-swap, hand path can), and it's reachable organically through normal 1% pool/oracle divergence during volatility, no attacker needed. I'm also double-checking the direction of the price impact: if the pool gives fewer sats per lamport than the oracle, that means cbBTC is priced higher in the pool, so we'd receive less—confirming this is indeed the unfavorable direction for the swap.

Arbitrageurs typically keep a $10M Orca pool within fee-plus-gas distance of Pyth, so under 20 bps normally; a 99 bps divergence implies either an arb failure or extreme volatility, which would likely push both venues out of the 100 bps band entirely and trigger a refusal before any sweep happens. That narrows the exploitable window considerably, so I'm leaning back toward LOW severity. There's a cleaner way to frame the underlying issue though: the market-check function never actually computes what a pool would return on execution—it only compares spot prices, so deeming a venue "usable" pre-sweep doesn't guarantee it can actually deliver the output.

A straightforward fix is to simulate the swap before sweeping and require the result to clear the floor with margin, since the sweep itself is irreversible—I'll file this as LOW with that remediation noted.

Now I want to check the crank logic for anything that rises to HIGH severity. Looking at the reveal path: it sends the attribute list read from the asset and hash-checks it, but for a burned asset it sends an empty list instead, and the reveal_level logic explicitly skips the hash check when the asset is burned, so an empty list is accepted correctly. Assets read as 'other' also skip and break as expected. I want to keep checking whether the crank's reveal step has any other edge cases worth flagging.

Deserialization failures in deserializeAssetV1 get caught and the lane breaks, which handles that case fine. But this raises a real liveness concern: since mintedAttributes relies on mpl-core's deserializer, a holder could attach a plugin type the installed JS version doesn't recognize, causing deserialization to throw at that vault on every pass and permanently stalling the FIFO reveal queue for everyone behind it.

Since the reveal is FIFO, a single vault that can't be deserialized stalls every vault behind it, triggering a high-severity alarm — though anyone could manually reveal it since it's permissionless, making it recoverable but still dependent on an unlikely Core-upgrade scenario. I'm now considering a more likely failure variant where the crank re-reads the attribute list off Core and the minted list itself might diverge from what's expected.

A mismatch between the attribute hash and a live vault shouldn't happen since the Attributes plugin's authority is the MINT's PDA, so the owner can't tamper with it directly — meaning any mismatch would really stem from our reader disagreeing with the program's encoding, possibly due to how the SDK handles string normalization or UTF-8 byte decoding differently than Borsh expects.

Normalization isn't an issue since JS doesn't normalize on decode or encode, so the mismatch path looks unreachable for honest state. Now I'm weighing whether the deserializeAssetV1 risk is worth filing — it's a reveal that can never send due to a structural single-point-of-failure in parsing, but it would require a Core upgrade to trigger, and the program itself wouldn't actually be affected by that change, only our reader.

Actually there's something more concrete: when reading attributes fails, the code catches the error and breaks out of the loop entirely, meaning one unreadable asset stalls the whole reveal queue on every pass. Checking whether this gets paged — it's not a direct failure, but the alarm's reveal_queue_stalled check (HIGH severity) would catch it since it compares reveal counts across passes and would detect the stall, so this does get properly flagged.

Now I'm checking the ordering concern the prompt raises — whether a reveal could get sent out of order. The reveal queue is built from indexed records, with mint_index acting as the unique key for the map, so collisions there seem impossible. I'm trying to think if filtering by level could somehow produce duplicate indices, but that doesn't seem possible either since mint_index is unique per record.

If `cfg.revealed_total` happens to be stale because another lane already revealed that index, the crank would just hit AlreadyRevealed on the first entry and break — which is benign, not an actual ordering bug.

Next I want to verify whether the crank could send a `distribute` for a `tick` when the program would reject it with `NoActiveVaults`. The program checks `pending_this_epoch > 0` at execution time, but this happens after the crank's own retire instructions have already landed and decremented that same value — so I need to trace through whether the crank's retire logic could zero out pending_this_epoch before the tick executes, causing a mismatch between the crank's precondition and the program's actual check.

So in the tick branch, preJoins must be empty since w requires zero waiting vaults, meaning no eligible readable vaults existed, or they were all unreadable and joinable was false entirely. Now I'm checking the credit branch conditions against the program: boosts_due must be zero since the crank expires preExpires first, total active weight must be positive, and I need to work out the available balance calculation.

I'm verifying that joining and expiring boosts don't affect owed_scaled, so the crank's available calculation using owedAfterRetire should match. But I'm now wondering about a race condition — if a claim lands between when the crank plans the distribution and when it actually executes, the owed_scaled used by available() versus the program's execution-time value could diverge.

Another party's claim reduces both owed_scaled and pool balance equally, so avail stays the same; a stranger's revenue split grows the pool and avail together; and a stranger's distribute just shifts the epoch harmlessly. The crank design checks out, so now I want to examine detectPoolHealth's pool_insolvent check, which reads MintConfig and pool state together in one fetch to get owed_scaled fresh.

I confirm poolAvail is computed from that fresh config, consistent with the earlier round. But detectDistributionOverdue still uses the original cfg for last_distribute_at and total_active_weight, which is fine since only poolAvail needed refreshing. One edge case: if readPool returns null because the pool ATA isn't set in config, then detectPoolHealth gets a null pool and returns an empty array, and poolAvail itself becomes null.

I'm checking that this null case can't actually happen since mint.pool_ata is always set once MINT is initialized, so it's a non-issue in practice. Next I verify the frozen-byte check in detectPoolHealth: it reads the state byte at offset 108 and compares against the frozen constant, requiring data length greater than 108 — which holds for any real 165-byte SPL token account, so there's no edge case where a shorter 'ok' account could slip through undetected as frozen.

Now I want to pin down whether `rescue_nested` can be abused in a way the alarm wouldn't catch, particularly around vault_awaiting_return, ACKABLE_KINDS, and unredeemable_owner for a rescue-able foreign-burned host. I'm tracing through rescue_nested's requirements — the vault must be a live vault of our collection, owner must be the PDA derived from mpl-core-execute and host, and host must be the vault itself, burned, or a live vault of our collection, with new_owner set to bank_treasury — to see if a vault nested inside another live vault owned by a real person could slip through.

Walking through the scenario: anyone could yank a nested vault V out of its host H and send it to the Squads, forcing the real owner to prove they were the original sender to reclaim it. This griefing is costly only in fees and delay, and the alarm does page on it, so it seems like an acceptable, already-ruled-on outcome.

Checking the attack more carefully: someone can't nest a vault they don't own, since transferring requires the owner's signature, and the rescue flow is safe since new_owner is pinned to bank_treasury and the Squads multisig guards it. So the real risk is purely self-inflicted — an owner accidentally sending their vault NFT to a deposit address, which the holder guide already warns against, and yes, the alarm pages whenever the Squads ends up holding a vault.

But I notice there's no detection for the Squads actually *voting* with a held vault — the alarm only watches for new proposal counts, not per-vault voting activity, so that's a custody-only rule rather than something monitored; given multisig signature requirements, this seems like low risk, worth flagging as INFO. Now I want to cross-check the holder guide's claims about sending cbBTC and other assets against what the code actually enforces.

Checking the activation language — "joins the payouts at the next distribution and earns from every one after that" — this matches how activation actually works, so that claim holds up.

Continuing through the remaining claims: the vault closure wording holds given the honest disclosure of the transfer power, the level and rule-permanence statements check out, the treasury split is accurate, and now I'm verifying the level share multiplier table.

Payout timing and crediting checks out, as does the burn-accelerated unlock claim with its one-month delay. The 2.1%-per-hour opening cap rounds correctly to 45 vaults among 2,100, and the Coinbase freeze clause matches the rule that frozen funds block any opening, including token claims.

Moving to multisig/DAO restrictions and the redeem-page-only rule, both check out. But the "every opening is announced publicly on X and the Bank's website" claim is flagged as unverified -- the announcement poster has no sender assigned yet, and the spec itself lists this as something not yet shippable since it depends on Gary's approval and an undetermined website surface.

The community vote and "who can do what" table details match round 25's design exactly, as do the Gary Club holdings and the honest list items against spec. I'm now checking the permanent transfer power held by the locked program -- it exists solely to let anyone rescue a vault that's accidentally been sent into another vault or itself, moving it to the Bank's multisig.

I'm realizing the rescue also applies when the host asset is burned, not just nested in another vault, so the guide's phrasing is technically incomplete though not false. I'm now verifying the claim that a vault sent into another vault is the sole exception to the "anything else gets destroyed" rule, checking whether a CBOB vault nested inside another vault actually behaves this way.

Tracing through the scenario confirms it works: when the host vault is redeemed and burned, the nested vault becomes orphaned and gets rescued back to its original sender, so the guide's claim holds true. I'm also checking the "another NFT is destroyed" language—technically a foreign NFT just becomes unreachable rather than destroyed, but this matches how the spec itself uses "DESTROYED" loosely, so it's acceptable.

Now checking the "Who can do what" table's claim that Gary Club "cannot... open or move a vault in a wallet whose key it does not hold." With rescue_nested now existing, anyone can move a nested vault owned by a PDA that nobody holds a key for—so this "cannot" statement is actually false in the nested case, even though the rescue mechanism itself is disclosed elsewhere. This looks like a genuine divergence between the table's promise and the actual code behavior.

I'm also checking whether the rescue function contradicts the claim that a closed vault's contents stay locked until the owner opens it, since the rescue could move a nested vault NFT while its parent vault is still closed.

There's also a real economic harm here: Alice buys vault H expecting its nested V to come with it, but anyone can trigger rescue_nested and send V back to H's previous owner (V's original sender), not to Alice. Review 35's M1 only considered this risk for foreign hosts, not CBOB hosts, so this loophole for bundled/escrow vaults slipped through.

Checking the VALIDATION list more carefully: it covers M1, M2, LOW, and Tests, but L1, L3, and L4 are missing entirely, while L2 and L6 are only partially addressed and L5 is addressed through corrected text. So L1 remains an open gap.

For L1, the runbook's claim that the vault asset returns "to the wallet that sent it there" is wrong for a burned host — once V sits in H's wallet, V's owner field becomes H's signer PDA, and nobody truly controls it anymore. Since CBOB vaults are permanently sealed, H's owner can only reach V during redemption, but the redemption sweep helper only moves classic token accounts and lamports, not Core assets, meaning a custom mechanism would be needed to actually recover V.

This raises a genuine custody question: does V belong to whoever last controlled it before it ended up in H's wallet, or to H's current owner? It's ambiguous enough that the program defers to Squads for a human decision rather than resolving it programmatically.

I'm also checking L3's handling of true orphans — vaults nested in foreign assets that can't execute, like ones sitting in their own wallet or inside a collection/group, correctly stay stuck as documented. I'm also considering the self-nested foreign host case, where the host's owner is its own PDA for a foreign asset, which correctly resolves to HostUnresolved since it's not burned and fails the live-vault check.

Now I'm examining the nested_vault detector text for burned hosts, checking whether the message correctly describes the behavior regardless of whether the host has been burned.

That confirms L4's burned-host concern is addressed. The remaining L4 gap is for a vault nested in a foreign asset, which falls to `unredeemable_owner`, whose text doesn't reference rescue_nested.

Now I want to reconsider the holder-guide's "Nothing can leave it while it is closed" line more carefully, since it's my strongest holder-facing finding. A nested vault is technically held by the parent wallet, but the guide's bullet is really about cbBTC/$GARY/$GIRAFFISH staying locked — and it does carve out the exception explicitly, noting another vault can still be rescued back to its sender.

Given that the exception is disclosed elsewhere, even if not qualified in place, I'd downgrade this to a LOW precision issue rather than a falsehood. The "Who can do what" table's claim that Gary Club cannot move a vault in a wallet whose key it doesn't hold is flatly wrong with no qualifier though, so that stays LOW too. I keep scanning the guide for more statements to verify, checking claims about $CBOB minting/freezing and swap pricing tolerances against Pyth.

Continuing through the remaining claims: royalty withdrawal limits, boost mechanics (one per vault, owner-only, up to +12), and payout timing requirements all check out against the launch settings. The redeem page claim is correctly marked DRAFT since it isn't built yet, and I'm now looking at the claim about unclaimed Bank proceeds not belonging to the vault owner until a payout is triggered.

I'm noticing a minor gap: payouts also require `boosts_due == 0`, but the guide's description of payout eligibility doesn't mention due boosts, which would hit `BoostsExpireFirst` — worth flagging as INFO rather than HIGH. The monthly run skip conditions in SPEC limit 36 are properly documented, so that omission in the holder guide is minor too. Now I want to dig deeper for anything genuinely high-severity I might have overlooked, starting with a re-read of the unledgered vault detection logic.

Writing detection logic...

Wait, I realize `ix.dataBytes` is problematic since jsonParsed instructions for an unrecognized program would leave `ix.data` as a raw base58 string rather than parsed bytes, so I need to reconsider how the data gets decoded.

I'm checking the custom base58 decoder in detectors.mjs — it correctly handles leading-zero bytes by prepending zeros for each leading '1' character, which is the right approach, but I want to verify edge cases around data starting with a zero byte.

I confirm the discriminator computation and comparison use consistent array-of-numbers representations, so the equality check between the computed sweep discriminator and the instruction data slice should work correctly.

Now I'm checking `detectApprovals`: it only flags Token/Token22 approve instructions where the owner resolves to a vault PDA via the ATA-to-owner map or directly matches the PDA set, so non-ATA accounts still get caught through the pdaSet check. But since a vault PDA can only sign through Core's ExecuteV1 during redemption, I need to verify this detection logic holds up against that constraint.

I'm also tracing an edge case: an approve on a non-reserve account during redemption could survive the burn check (which only validates `ReserveDelegated` on the three reserve ATAs), letting a delegate drain that account after the vault burns and can never sign again -- though since the contents were the holder's own, this seems like a pre-existing, low-severity edge case rather than something new.

Now I'm examining the crank's role as fee payer and `payer` in `reveal_level`, where Core's `UpdatePluginV1` transfers rent from the payer to the asset account, to make sure the crank isn't moving value anywhere the program hasn't already pinned.

I'm verifying that `reveal_level` passing `payer` as writable+signer doesn't open a path for Core to refund excess rent to the payer if the asset shrinks -- it won't here, and the asset/collection writes don't introduce extra rent charges either, so this looks bounded.

With mostly LOW/INFO findings so far, I want to make one more pass to see if there's a MEDIUM or HIGH issue, so I'm comparing revenue.mjs's cooldown gate against the alarm's sweep-state detection window, starting by looking at the cooldown check logic in revenue.mjs.

After the cooldown gate, the script writes the cycle row stamped with its own box clock timestamp, and `detectSweepState` compares the chain's recorded last-sweep time against that box timestamp within a window of half the cooldown period. The argument from round 33 is that a thief's sweep has to land at least one full cooldown after an honest sweep, and since revenue.mjs only writes its row after the cooldown has elapsed, the gap between a thief's timestamp and an honest start should always exceed half the window -- I want to stress-test this claim.

I'm tracing an edge case: suppose a thief sweeps right at the exact moment the cooldown opens, slipping in just before the honest job's scheduled run. In that scenario the honest job's subsequent attempt would see the cooldown as still active and skip its sweep, which could break the timing assumption the whole safety argument depends on.

Right - the row gets written right before the sweep is sent, so if the thief front-runs in that narrow window, the honest sweep gets refused with SweepTooSoon and the row is marked refused, which means it's neither sweepSig nor landed-pending, so it's unexplained and pages CRITICAL. Meanwhile the thief's own sweep has no row at all, triggering the unledgered_sweep check too.

I'm also checking what happens with massive clock skew (hours) — that would push startedAt way off, causing even an honest sweep to page CRITICAL, which matches the spec's note that ordinary skew within ±3h tolerance shouldn't page but gross skew should. Then I want to verify how detectSplitClaims handles its grace period and the chainNow parameter alongside the wall-clock nowMs.

Now I'm tracing detectUnreconciledRevenue's early-return call sites, where it's invoked without a `splits` argument — meaning closedOnChain defaults to false there, so a `cycle_unsplit` HIGH finding could misfire even for a cycle that was actually split. But since those paths only trigger during pre-launch or config_vanished states, this seems like a minor false positive rather than a real issue. I'm now circling back to whether there's a genuine HIGH-severity case where a truly dangerous state gets misread as quiet.

I consider several candidates: swap_operator or pending_swap_operator drift between passes with a carried baseline (both correctly flag CRITICAL), split_bps changing unexpectedly (also correctly caught), and the trickier case of the pool's token account being closed and recreated under a different owner — since the pool ATA is derived from the config PDA, I'm checking whether only that PDA has authority to close it.

For vault reserve ATAs, I confirm only the vault PDA owner can close them, requiring ExecuteV1 during redemption, and the judge logic should flag this as balance_unreadable HIGH when it detects the drift. I also verify that the revenue PDA's lamports can only move through sweep_sol_for_swap, with detection logic catching unledgered sweeps, though I note rent-exemption reduction isn't really a plausible drain vector here.

I'm now considering whether the alarm properly watches the operator wallet's balance — if the operator key gets stolen, a theft sweep through normal channels gets caught by unreconciled_swap CRITICAL, but a sweep executed entirely outside revenue.mjs would instead surface as unledgered_sweep plus sweep_unledgered_state CRITICAL.

Similarly checking the operator's cbBTC balance: a failed-return scenario after a swap triggers unreconciled_swap, while a completely untracked swap theft triggers unledgered_sweep. Detection coverage looks solid here, so now I'm hunting for any routine state that pages on every single pass, starting with joins_waiting which fires whenever there's an eligible unjoined vault pending.

Given the hourly crank versus 30-min alarm cadence, this stays at INFO level rather than paging, same with sweep_cooldown_wedged, sweep_cap_wedged, sales_stopped, sweep_stopped, and guardian_retired. Then I move to vault_awaiting_return, which pages at HIGH once and sends daily reminders while a rescued vault sits with the Squad — that's intended. Next I'm checking redemptions_near_cap's HIGH-level trigger condition against the current count of 240 live vaults.

At smaller vault counts the math gets strange: with 48 live vaults, cap rounds to 2 and near-cap threshold rounds to 1, meaning a single redemption in an hour would page HIGH — which doesn't feel like it should warrant paging when the fleet is this small, compared to needing 5+ redemptions to trigger the same alert at 240 vaults.

Other alerts look fine: log_coverage_gap waits on human action as designed, scan_gap pages during backlog drains as intended, and crank_posture_unreadable only fires on permission issues the alarm user wouldn't hit. revenue_unsplit pages HIGH after 6 hours of unsplit cbBTC, which should align with the crank's hourly split cadence.

I'm checking if a dry-run crank during a sale would let mint revenue pile up unsplit and trigger repeated paging — but since no sale precedes steps 10/11 and the crank should be armed at launch, this matches the documented posture. royalties_unswept correctly pages daily while revenue.mjs stays dormant, and distribution_overdue/launch_tick_overdue both check the right preconditions before firing. Now I'm looking at index_disagrees_with_chain, which is CRITICAL despite index lag being a stated limitation, which seems like it could cause unwanted paging.

The SPEC claims this alarm's level-triggered nature means the router holds it for 25 minutes of grace, so a lag that heals within that window never pages anyone. I confirm it's correctly marked as 'level' in the ALARM_KINDS config, but I can't verify the router's actual grace logic — and since the alarm runs every 30 minutes while the router holds for 25, a lag that persists past one cycle would actually fire.

Let me verify the cron schedule: it runs every 30 minutes, but SPEC claims the router's grace window is 25 minutes — so the alarm genuinely can't recover in time for any single-pass lag, confirming this is a false mitigation claim rather than a dangerous finding, just an extraneous email.

I'm leaning toward filing this as LOW severity given the mitigation statement simply doesn't hold at the alarm's actual cadence, though I want to reconsider whether the router drops a still-pending alert once a recovery signal arrives, which could change how this plays out.

Now I'm digging into `detectIndexShortfall`'s race window, examining how it compares the minted-after cutoff against total and seen counts to decide whether to bail early or flag a disagreement.

The lag-paging case accepts `total <= seen <= after` but the triage's suggested narrower condition wasn't actually implemented—it's a documented acceptance with a shaky mitigation claim. I want to check how plausible it is for DAS to actually lag the chain in practice: Helius typically indexes within a second or two, and since the alarm reads minted_total before and after the DAS walk, a mint landing between those two reads but already visible in DAS could produce seen = N+1 against a stale total.

If instead a mint lands just before the first read but DAS hasn't caught up yet, that flips into a genuine CRITICAL state, and that window looks like roughly 1-2 seconds per mint. Scaling that across a hot sale with frequent mints and multiple alarm passes per hour, I'm estimating something like one or two false CRITICAL alerts per day from this timing gap alone.

This matters because false CRITICALs are exactly what erodes trust in the alert channel—each one triggers a full email escalation, and that's the kind of noise that trains people to ignore the signal, which is a harm this project explicitly cares about. The claimed mitigation doesn't actually close this gap, so I'm leaning toward flagging this as MEDIUM severity rather than dismissing it as negligible.

Now I want to verify the timing of when `mintedAfter` is actually read relative to the DAS vault walk, since the config value `mint.minted_total` is read earlier during config setup, before the vault listing happens—so I need to check whether `mintedAfter` is captured after that walk completes to confirm the staleness window I'm worried about.

If 50 claims land in one hour, that's roughly a 2.8% chance per pass of hitting the lag window, so maybe 1-2 false CRITICALs over the charter window, more during a large vault sale. This is also relevant to detectVaultSetChange and detectNestedVaults, which rely on the same DAS walk — but a lagging index only omits the newest vault, which detectVaultSetChange won't flag since it only reports vaults that left. So the real consequence here is just noise, and labeling this MEDIUM severity feels too high.

Reconsidering: limit 8 already accepts false CRITICALs of this shape as a known cost, treated seriously (capped at 8 total). But that limit covers burn correlation lag specifically, not index lag — the index-lag issue is new and its claimed mitigation doesn't actually exist. I'll file this as LOW with a correction noting the mitigation gap.

This maps cleanly onto question 1 about limits being worse than stated, so I'll report it that way with the supporting math. Now checking for other candidates: limit 10's claim about the alarm watching upgrade authority and byte counts for third-party programs — confirmed against readConfigs.

Checking the dust sweep threshold and MIN_SWEEP_LAMPORTS value, the unreadable clock refusing the cycle, and the 10 SOL per 6-hour cooldown cap limiting royalty sweeps beyond roughly 40 SOL/day — all verify against the code. Now I'm working through the revenue cron's hourly claim: with a 6-hour cooldown and hourly runs, the first run after cooldown elapses should trigger the sweep, so that checks out, though I need to also verify how the open-cycle guard interacts with this timing.

Tracing main()'s execution order confirms the cooldown check happens before market() is called, so market reads aren't wasted on hourly runs where the cooldown hasn't elapsed — that's good. But I notice something concerning: the open-cycle guard and recovery logic both run after the cooldown check, meaning an open cycle wouldn't get noticed or recovered until later.

With a 6-hour cooldown, a cycle that fails mid-way only gets checked at the next cooldown boundary, which could throw an alarm after up to 6 hours. But since `detectUnreconciledRevenue`'s `closedOnChain` logic independently closes things from the alarm's perspective, there's no false page — and the ledger self-heals once the cooldown elapses, so this isn't actually broken. Now I'm looking at a potentially worse scenario involving what happens when `publishRevenueNotices` no-ops during the cooldown period.

Checking limit 7's royalties_unswept condition — that's fine. For limit 25, I'm confirming the crank's reveal lane runs every minute, and recalling that round 25's test found web3.js 1.98.4's default Connection waited over 300 seconds on a hung RPC call — since the crank still uses an unmodified Connection with no timeout option, a stalled socket can still block a pass for roughly five minutes, and the lane's locking mechanism would then delay subsequent runs too.

I'm verifying limit 32's requirement that mainnet's burn redeem window must equal 3600 seconds against the alarm's production list, and confirming limit 38's claim that the guardian, swap operator, sweep cap, cooldown, and SOL reserve aren't monitored for incorrect values. Now I'm checking limit 44's note that the helper only reads 165-byte token accounts, meaning Token-2022 accounts aren't covered.

I also notice the new C5 close-authority case is only documented in the "Known limits" section but not cross-referenced in limit 44's list, which seems like a gap. Similarly, item 50's client contract bullet about rescuing stray classic tokens doesn't mention the C5 exception about accounts whose close authority isn't the vault, even though the Known-limits entry for C5 describes this behavior.

More critically, I'm realizing a logical contradiction: the C5 entry claims nothing is lost by leaving a zero-balance account undeclared, since rent belongs to whoever can close it. But the sweep helper unconditionally closes every account pair it's given, so if the page sweeps the balance it necessarily also closes the account — meaning the C5 repair described in spec is actually impossible to implement with the shipped helper as written.

Now I'm confirming that CloseAccount is unconditional in that loop, which means the balance on a C5 account is unrecoverable through the helper. I'm also checking whether the redeem page could instead issue a separate SPL transfer inside the same ExecuteV1 call, given that Core's ExecuteV1 only invokes a single program signed by the asset-signer PDA.

Actually, checking Core's ExecuteV1 signature more carefully, it does allow invoking any program_id with arbitrary instruction data, signed by the asset_signer PDA. So the page could issue a second ExecuteV1 that calls SPL Token's Transfer instruction directly with the PDA as authority, pulling out the balance without closing the account -- meaning the funds are recoverable after all.

So C5 is a precision issue rather than a real exploit, since the spec never actually specifies this mechanism, and it would add considerable account overhead to an already byte-constrained redemption packet.

But wait — there's actually a deeper constraint here: ExecuteV1 can only run on a thawed vault, and thawing only happens inside the redemption flow itself. So a separate prior transaction couldn't sweep the balance anyway, since the PermanentFreezeExecute plugin blocks ExecuteV1 on a sealed vault, meaning all vault-wallet movement has to happen within that single redemption transaction.

That confirms the sweep would need a second ExecuteV1 squeezed into the redemption transaction's remaining 23 bytes of slack, which seems tight. I should check the account list ExecuteV1 requires to see if it actually fits.

Checking against the slack budget, that 91 bytes overshoots the widest shape by about 68 bytes, but fits comfortably within the narrower shape (owner payer, no compute budget) that leaves 171 bytes of room. So the rescue instruction only works in that narrow page configuration, not the general case the spec implies — this feels like it deserves a medium-severity flag rather than low, since the claimed capability isn't achievable through the helper as written.

Re-reading the C5 spec entry: it describes a stranger handing a vault a token account whose close authority they retain, where the sweep helper can move tokens out but not close the account, and burn refuses declared accounts — the rent stays with whoever can close it, not the holder, so leaving it undeclared at zero balance loses nothing.

But that description of the sweep helper is actually wrong — the helper's close is unconditional, meaning the whole instruction would revert at the close step rather than allowing the token to be moved out first. So SPEC mischaracterizes the shipped helper's behavior, which makes the repair path infeasible in the widest page shape — this is a concrete, verifiable MEDIUM finding. I want to double-check the helper's close logic once more to be sure.

Checking the SPL Token close_account authority logic...

If close_authority is set to Some(stranger), the signing PDA won't match the authority and validate_owner fails with OwnerMismatch, confirming the vulnerability. This is a solid medium-severity finding, especially since the page's coverage classification functions can't detect this case at all. I'm also considering whether a stranger could create a token account at an address the page would still label as a canonical reserve or stray account, which would strengthen the finding further.

Now I want to check another area: how the crank handles the split plan when revenue.state isn't 'ok'. Looking at the conditional logic, if revenue.state is anything other than 'ok' or if revenue is absent, no problem gets pushed and no split gets planned at all, which could be a gap worth investigating.

That absent revenue ATA case means every paid mint would fail silently, though the alarm system does catch this with a HIGH-severity `revenue_account_unreadable` page, so it's acceptable that the crank itself does nothing.

I also verified that `splitToPool` correctly zeroes out when revenue is frozen, that `REVENUE_ATA` derives correctly from the payment mint and revenue PDA, and now I'm checking whether `alarm.mjs`'s revenue-read logic correctly identifies `split_revenue` transactions by inspecting the instruction's account index for the payment mint program.

The split_revenue accounts layout confirms mint sits at index 2, and the instruction discriminator check safely handles short data buffers without a length guard since undefined comparisons just fail the match. I'm moving on to check `normaliseT...`

Now I'm checking how accounts get normalized for inner instructions — mapping numeric indices to key strings while handling pubkey objects directly. For jsonParsed encoding, unparsed instructions already give accounts as pubkey strings rather than indices, which matches the parsed-info fallback logic.

I'm also confirming that `validateParsedTransaction` checks every raw instruction's accounts against the known key set. Then I'm considering whether the crank should call `rescue_nested` — since rescue is permissionless and triggered by the alarm, the crank doesn't need to handle it, which is a deliberate design choice rather than an oversight. Now I want to do one more pass on the overall flow.

Then unschedule_boost zeroes out boosts_due, boosts_active, and boost_weight_total correctly for the 20 records, and reweigh computes the owed/carry/debt math and total_active_weight reduction, landing on 40n which matches the assertion. The math checks out.

Cross-checking against the