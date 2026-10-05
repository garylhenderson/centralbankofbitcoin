[reasoning only]
I should focus my audit on the most promising areas: the sweep helper, MINT, BURN, SEAL, GOV, and the cross-program offsets, since recomputing those raw byte offsets is a concrete, checkable issue. I'm now working through the MintConfig struct layout field by field to verify the byte boundaries are correct.

Still mapping out struct fields...

Still mapping out struct fields...

Now I'm tallying up the byte sizes of each field to compute the total struct size.

Still adding up the running total...

Confirming the final field sum gives 97, so the running total reaches 679, and after the last line's fields plus padding the total config space comes to 1261. Now I'm starting to lay out the VAULT_RECORD structure, beginning with its discriminator and version fields.

Adding up the field offsets confirms the 221-byte total matches, and the governance offsets for record index and asset check out too. Now I'm laying out the BurnConfig struct fields, tracking byte offsets through discriminator, version, collection, bump, burned_total, redeem_window_secs, and into the rate ring buffer.

The space calculation for burn config comes out to 827 bytes, matching OFF_BURN_TOTAL at 42. Working through SealConfig next, I verify the reserve mints vector offset and total space at 398 bytes — everything checks out for R7, so now I want to double-check the charter_closes_at read specifically.

That cast from u64 to i64 is fine. Now I'm examining the sweep helper function closely, tracing through its validation logic: checking the instruction data byte, verifying account count parity, confirming the signer and program ID checks for the token and system accounts, then looking at the comparison between signer and destination keys.

For each source/destination pair, it reads the mint, owner, and amount from the token account, verifies ownership matches the signer, checks the destination matches expectations, transfers any remaining balance, then closes the source account to the destination. After processing all pairs, it sweeps any remaining lamports from the signer to the destination.

I'm now considering edge cases — particularly what happens if the same source account appears twice in the account list, since after closing an account its data gets zeroed out by the token program, which could cause the second read to behave unexpectedly.

So close_account transfers all lamports to the destination, zeroes out the source account's balance and lamports, then reassigns the account to the system program and reallocates it to zero data length, effectively deleting it.

This means reading the source token account again after closing fails with an owner mismatch since it's no longer owned by SPL Token, so duplicate closes are correctly refused. I'm now checking the case where a source account in one pair is also used as a destination in another — if that account is owned by a different wallet than the signer, the owner check blocks it, and if the signer tries to use their own wallet as destination they're already blocked earlier.

What if the destination is another vault's asset-signer PDA instead? Then the owner check on that destination passes, and the helper would happily move tokens and sweep rent into that other vault's PDA, possibly bricking it — but that's really just an owner foot-gun since only the vault owner can trigger this, more a documentation concern than a vulnerability. Though I should double check whether the lamport sweep to a non-existent system-owned PDA actually creates the account on transfer, which could have its own side effects.

So if the vault holds a tiny lamport balance and transfers to a nonexistent destination below the rent-exempt minimum (roughly 650,240 lamports on mainnet for zero-data accounts), the system transfer fails the rent-exemption check and the whole transaction blocks redemption. But since the real destination is typically the fee-paying owner account, which already exists, this edge case mostly doesn't apply in practice.

If the PDA has zero data and is system-owned, draining it entirely to zero lamports causes it to be deleted, which the runtime permits since there's no rent-exemption requirement for an account at zero balance. The signer can't be left with a partial balance below rent minimum, but taking everything is fine. The source account for a System transfer does need to be system-owned with no data, which the asset-signer PDA satisfies.

Checking edge cases: re-entrancy through chunked accounts is safe due to the length check, and `read_token` doesn't verify whether the destination is frozen -- a frozen destination would just fail the transfer naturally. I'm also considering `to == src` scenarios, which get ruled out since ownership constraints would force signer to equal dest, which is rejected. Then there's the native wSOL case, where a 165-byte token account with `is_native` set reads its amount normally, transfers fine, but closing it afterward requires specific conditions for native accounts that I need to think through.

I'm also checking whether a stranger could create an undeclared wSOL ATA for the vault PDA — since wSOL isn't a reserve mint, BURN only inspects declared/reserve accounts, so an undeclared wSOL account would just get ignored or destroyed, which seems fine.

Then I'm tracing what happens when BURN iterates through remaining accounts after a reserve ATA has been closed (owner reset to system program, zero data, zero lamports) — the loop skips any account whose owner isn't the token program, so the closed account gets correctly excluded from the emptiness check.

The closed account still needs to be declared in remaining_accounts or the check throws ReserveNotDeclared, and since the page passes all six derived ATAs this holds. Separately, the second loop skips accounts with zero lamports entirely, and I'm now looking at whether the asset-signer PDA itself ends up with zero lamports after the sweep sends everything to the destination.

I'm confirming that since the transaction context shares account state, reading the asset signer's lamports after the sweep within the same transaction correctly returns zero. Now I need to check whether Core's ExecuteV1 instruction itself might deposit anything back into the asset signer or require it to be rent-exempt, since that could leave it non-zero afterward.

After checking, Core's ExecuteV1 doesn't appear to create or fund the asset-signer account if missing, and the burn CPI only refunds rent to the payer without depositing into the asset signer. I'm also confirming that attempting to reach the helper while the asset is frozen gets rejected by Core, and that only the actual owner (not an arbitrary authority) can trigger execution.

Beyond redemption, I'm now worried the helper is a generic drain mechanism that can move any signer's entire token and lamport balance to a named destination, callable by anyone who can get it to sign, not just Core — which raises a broader concern separate from the main redemption flow.

This is still worth flagging as a LOW/INFO: a permanently deployed, immutable, unauthenticated helper that any phishing site can invoke, with logs naming CBOB. Fixing it is tricky since the helper doesn't know the asset owner, but one option is binding it to Core by checking the instructions sysvar to confirm the top-level caller is MPL_CORE's ExecuteV1.

I'll rate this LOW while noting it's roughly equivalent to a System transfer in risk, and move on to look for actual defects. Now I'm examining the ordering between `retire_redeemed`, `retire`, and `monthly_inline` to check whether vault credits and `owed_scaled` updates happen in a safe sequence.

I then trace the `claim` logic: it computes pending as weighted accumulator plus carry minus debt, derives the payout, updates `carry_scaled` and `debt_scaled`, and accumulates `owed_paid` to subtract from `owed_scaled`. I want to verify that `owed_scaled` is correctly tracking what's actually owed after these updates.

I confirm that credit additions sum consistently across active vaults, that claims reduce owed by exactly the settled amount leaving carry intact, and that reweighing shifts owed into carry/debt without changing the total owed. Now I'm checking the retire function's weight calculation.

Retire removes the vault's weight from owed_scaled and total_active_weight, decrements active_count, and unschedules any boost — importantly, unschedule_boost only adjusts the boost total, not the vault's own boost_weight field, while the full weight (including boost) was already subtracted from total_active_weight, so that stays consistent.

I trace through the invariants: claims and expire_boosts both check `active` and skip retired records, so there's no risk of touching a retired vault's weight again. I also confirm it's impossible for a pending (not-yet-joined) record to have a nonzero boost_weight, since boosts require active status.

Now I'm checking whether expire_boosts and claim could both trigger expiration on the same record, causing a double decrement.

Since expire_boost zeroes boost_weight after firing, and the loop re-reads the stored record on each iteration, duplicate entries safely skip once boost_weight hits zero. The account data is re-read fresh each time, so a second pass on the same record sees the already-expired state.

For claim with duplicate pairs, the first pass pays and updates debt in the stored record, so the second pass sees pending reset below ACC_SCALE and pays nothing — consistent with the earlier confirmation. The same logic applies if a joined record appears twice: the second encounter sees it already active with zero pending.

Now I'm looking at the `distribute` function's zero-weight branch, which checks that nothing is waiting to join, that there's pending activity unless burning, that remaining accounts are empty, and that a full month has elapsed before ticking forward — and I'm noting it requires pending_this_epoch > 0, meaning someone must have requested activation.

This ensures the tick only fires when there's an actual join request. If all vaults are retired and there's an old pending join waiting from a prior epoch, distribute can't tick since waiting_to_join is nonzero, but the request's epoch condition still lets someone complete that join directly. On the other hand, if there's zero weight and zero pending joins, distribute just stalls indefinitely and the pool accumulates without progressing — which seems acceptable.

Now I'm checking whether a stale waiting vault from an earlier epoch can permanently block all future distributions, since the join gate condition requires pending_count minus pending_this_epoch to equal zero before any epoch can advance.

This leads me to a liveness gap: if a vault requests activation then gets bare-burned by its owner (a Core BurnV1 outside the normal flow), the second `activate` call would fail its liveness check, since it requires the asset to still be a live vault in the collection — meaning that stuck join could never complete and would block all distributions indefinitely.

But `claim` sidesteps this: its pending-vault branch only checks that the destination equals the recorded vault_ata, with no liveness check on the asset at all. Since the vault_ata (a token account owned by the asset-signer PDA) survives even if the underlying asset is burned, `claim` can still join that vault — explaining the asymmetry I noted earlier at round 25. Now I'm probing a deeper edge case: could the vault_ata itself actually be closed, not just have its asset burned, which would break even the `claim` path? Closing it would require the asset-signer PDA to sign a Core ExecuteV1 call, which in turn requires the asset to be alive and thawed, and thawing only happens through the redemption flow which burns and retires the vault record.

Tracing the redemption sequence, I see that retiring a redeemed vault explicitly clears its pending flag, so a pending vault that gets redeemed is no longer pending — consistent with suite F21.1. A bare Core burn outside redemption can't touch the ata since the vault stays frozen, so the ata persists and claim can always join it. Looking more carefully at claim's pending-branch logic, I notice `dest` is only checked by key equality, not validated as a live token account — meaning even a closed, system-owned account at that address would satisfy the check, so joining never hits a liveness lock. That raises a new question though: what if the record account itself isn't writable?

That failure mode is caller-controlled, so it doesn't create a systemic liveness issue — anyone can still call claim with [record, vault_ata] to join a waiting eligible vault for free, meaning there's no permanent block. Checking the BoostsExpireFirst rule next: distribute blocks while boosts_due > 0, but expiring a boost only needs the writable record account, no token account required, and retire already handles boosted vaults being retired while due, so that path is safe too. Then I start wondering whether expire_boosts' dependency on the config and remaining accounts could introduce its own constraint.

I trace through: expire_boost calls reweigh, which requires the record to be active, but since the loop already skips inactive records, that's fine. I also check whether a record could end up with boost_end_epoch at zero while still having positive boost_weight — tracing through boost_vault, expire_boost, and retire shows these two fields always get cleared together, so that state can't occur, and since epochs purchased are always at least one, every boost guarantees at least one distribution. Now I'm looking at whether a boost could somehow earn more distributions than it should, tracing how advance_epoch increments boosts_due via the boost_expiring map and how that count decreases once the end epoch is reached.

That confirms exactly N distributions get the boost. I also check that both the inline monthly check and the distribute function correctly block when boosts_due is pending, rather than silently allowing extra boosted distributions. Now I'm considering the edge case where a boost gets purchased within the same transaction right after a distribution occurs.

The epoch has already advanced by then, so `boost_vault` doesn't verify `boosts_due` before allowing a new purchase, since `monthly_inline` just no-ops. This means a new boost could be bought while a previous one is still pending, and I need to check whether the ring slot for the new boost's end epoch could collide with the slot just cleared by the due boost's removal.

With epochs capped at 63 and the ring size at 64, the 63 possible end slots (dist_epoch+1 through dist_epoch+63) never overlap with dist_epoch's own slot, so exclusivity still holds even with a max_boost_epochs of 63.

Tracing through an example: two boosts bought at different epochs with different durations can land on the same expiry slot, which is fine since the slot just accumulates a count that gets expired together — the key invariant is that any live boost's end always falls strictly ahead of the current epoch mod 64, so no premature collisions occur.

Now I'm checking the logic in `try_capture` for the reveal window, verifying the comparison against `reveal_slot` correctly gates whether a capture is too early or valid.

I'm bounding how far C can drift past reveal_slot: A is at most 64 past it, B's rounding adds at most 8 plus another 64, and C similarly adds at most 72 more, so C stays within roughly 208 slots of reveal_slot — safely inside the 300-slot window.

Checking SlotHashes capacity (512 slots) confirms A stays buffered when captured, since now minus A is at most 300. I'm also verifying that blockhash_in_window correctly returns NotYet if C's target window extends past now, and Expired once now exceeds reveal_slot+300, with enough margin that C is always produced before expiry. Now I'm looking at the reschedule_reveal logic, which only fires after expiry and when entropy hasn't been set, resetting reveal_slot forward by 16.

The crank function calls try_capture and reschedules on Expired without checking if the record is retired -- a burned vault with level 0 would still get rescheduled indefinitely, but that's harmless noise since reveal_level handles burned vaults fine. Now I'm examining reveal_level's requirement that the index matches revealed_total, and considering what happens if a vault's record was never created.

I notice reveal_level writes r.level and increments counters before checking the burned flag, and the attribute hash check only runs when not burned -- which is correct since Core can't be updated for a burned asset. But I'm now wondering what happens if the asset account doesn't exist at all, since the burned check relies on owner and data length matching specific patterns.

Tracing further, an absent asset account would make burned false, and then the owner-equality check would fail with WrongAsset, blocking the flow -- but Core's burn leaves a tombstone account, so this shouldn't actually occur unless the asset was never minted.

Switching to the governance module, I'm checking execute_proposal's quorum math: when all vaults are burned, quorum_supply is zero, making the required threshold zero, which correctly triggers a QuorumNotMet failure since the code explicitly requires need > 0. Now I'm examining the turnout calculation for yes-vote requirements.

I'm tracing how index_snapshot is set at proposal creation to m.minted_total, meaning only vaults minted before that point can vote -- so charter-era vaults (indices 0 through 239) are eligible for the first post-charter proposal, giving a quorum base of 240 minus any burned or bare vaults, with majority set at half that total. I'm now checking cast_vote's eligibility requirements to see if a minority voting bloc could improperly swing an outcome.

Burned vaults fail the asset read check since their data shrinks to a single byte, so they're correctly excluded from voting -- but bare-burned vaults that haven't been formally retired still count in the quorum divisor even though they can't cast votes, which skews things toward requiring more support than expected. I'm now checking whether the quorum divisor could ever undercount eligible voters in the other direction, letting a smaller-than-intended group pass a vote.

An attacker could burn vaults before creating a proposal to shrink the live supply and lower quorum, though that's costly since redemption gives back the vault contents. More concerning is the early-charter-window scenario: with only a handful of PoBs claimed, quorum_supply is tiny, so a holder with a modest number of vaults could single-handedly meet thresholds for ordinary or even guardian-changing proposals — this is really the same concentration risk surfacing again.

Checking `restart`'s timing logic — GOV passes `created_at` into MINT's check, and GOV also pre-skips if sales already stopped before the proposal was made, so the two sides line up consistently. The `restart` call is governance-gated via `has_one = governance`, and since GOV is the sole caller, that's fine; I'm now verifying that GOV correctly computes sales/sweep state after its skip logic before invoking restart.

Looking at `tighten_sweep`, it only errors when all three fields are None, and GOV already refuses an empty tightening at creation — so even if each field gets overtaken individually, MINT's max/min logic just absorbs it without erroring.

`arm_guardian` doesn't check that the pending guardian differs from the current one, which I've flagged as a minor note rather than a real bug. Now I want to dig deeper for an actual exploitable defect, starting with `split_revenue`'s math — it requires total > 0, then computes bank_cut as a fixed 15% of total and holders as the remainder, so I need to check whether that split can be gamed or rounded unfavorably.

I'm now checking the transfer accounts: `revenue_ata`, `holders_ata`, and `bank_ata` are all validated against expected PDAs and the payment mint, and since `TransferChecked` enforces decimals against the mint, a caller-supplied wrong decimal value would just fail rather than succeed silently. For `mint_vault`'s payment path, decimals are read directly from the mint account rather than trusted from the caller, but I'm now wondering if `payer_token` could be set equal to `revenue_token` — though that'd require the payer to also be the revenue PDA's authority, which doesn't line up since the revenue ATA's owner is the revenue PDA itself.

Moving to `sweep_sol_for_swap`, I'm checking the balance requirement before doing the signed system transfer and updating the last sweep timestamp — the config account gets borrowed immutably then mutably in sequence, which Anchor handles fine since the first borrow ends before the second starts.

Now I'm tracing through `activate`: it cranks the remaining accounts, runs the monthly inline logic, then checks that the vault record isn't retired before proceeding further.

It also verifies the record isn't already active and handles the pending case by joining if needed, checks the level is within 1-5, reads the token amount from the vault and confirms it meets the activation threshold, then increments the pending counters and sets the record's pending flag, request epoch, and vault ATA. I'm also verifying that the crank correctly skips already-revealed records (level != 0) so activation logic doesn't conflict with it.

Now I'm worried about a potential ordering bug: `activate` reads the vault record account that `crank` might have already mutated through remaining_accounts in the same transaction, since Anchor deserializes the account struct at entry and re-serializes it at the end, which could silently overwrite whatever crank wrote if they touch the same account.

But tracing through it, this specific case always reverts due to NotRevealed or the level check, so there's no silent data loss — every path I check ends up failing safely rather than corrupting state quietly.

Now checking claim: records there go through raw load_record/store_record, bypassing Anchor entirely, so no overwrite risk there either. The same holds for reveal_level and capture_entropy since those operate on proper Anchor accounts with no crank involved.

For mint_vault, I need to trace whether crank runs before or after write_record serializes the new vault_record — if crank reads raw account data before Anchor has serialized the freshly initialized account, that could be a real ordering issue worth flagging.

I'm tracing how `k` is computed from `crank_n` and validating the remaining accounts split into a crank slice and a pairs slice that must be non-empty and even-length. The `crank` function itself caps accepted accounts at MAX_CRANK (4), so an oversized crank_n like 200 gets rejected with TooManyCranked, which checks out. Now I'm looking at `read_token`'s validation of SPL token account ownership, length, mint, and owner fields.

Next I'm examining BURN's rate-limiting logic: it computes a cap based on live supply, derives a window size `k` bounded by the ring buffer size, and checks the k-th most recent timestamp against the redeem window. Working through the modular arithmetic, I confirm the k-th most recent entry is correctly located at `(head - k) mod 64`, and with a freshly zeroed ring, the very first redemption check passes since `now - 0` trivially exceeds the window.

I'm checking edge cases: when `cap > 64`, `k` clamps to 64, which makes the check stricter rather than weaker, so that's safe. When `live == 0`, the `.max(1)` floor prevents a zero `k`, though I note there's no live vault to redeem in that case anyway, so it's moot. The checked subtraction for `live` also guards against underflow, which shouldn't be reachable given minted/burned/retired invariants. The more interesting detail is that `cap` is computed using `live` *including* the vault currently being redeemed, so at `live == 1` the cap is exactly 1 -- meaning the last vault redemption gets the tightest possible rate constraint.

Then I'm thinking through whether the rolling-window check still holds correctly if `cap` shrinks over time as `live` decreases -- the spec requires that no window of a given length exceeds the cap in force at the moment the last redemption in that window landed, and a decreasing cap only makes this stricter, so that direction is safe.

Now I'm moving to the second loop in BURN's emptiness check, which walks through remaining accounts: for Metaplex Core-owned accounts, it verifies the data is empty or doesn't start with the asset-v1 key discriminator to rule out a nested live vault; for accounts with zero lamports it skips them; otherwise it checks the owner against token program variants.

A declared Token-2022 account owned by the PDA that has extensions attached (like ImmutableOwner, making it 170 bytes instead of 165) would fail the length check and throw `ReserveHasExtensions`. But this check only triggers if the account is declared and its owner matches the PDA -- so I'm realizing someone could create a genuine Token-2022 token account for a T22 mint, owned by the vault PDA, that isn't a standard reserve-ATA derivation. Since BURN doesn't require such an account to be declared, it stays invisible and undestroyed if simply left out of the remaining-accounts list.

I also need to verify the reserve loop's dual-program ATA derivation: for a classic mint, the Token-2022 ATA address literally cannot exist, so it must still be passed in as a nonexistent account (zero lamports, system-owned, empty data), which Solana permits. The owner check then correctly skips it since it matches neither TOKEN nor TOKEN-2022 program ids, so that path is safe.

Now I'm probing a trickier edge case: since the page derives and declares all six possible reserve ATA addresses regardless of whether they exist, what happens if a stranger deposits dust into a not-yet-created classic ATA between when the page builds the transaction and when it lands? The address is already declared either way, so I need to check whether the sweep logic can still pair it correctly once it becomes populated.

If the account exists but the page didn't originally name it as a pairing, BURN's reserve-emptying check would see owner==TOKEN, correct length, owner==pda, and nonzero amount, triggering VaultNotEmpty and blocking the whole redemption — this matches the documented requirement to pre-create all three reserve accounts in a prior transaction so the page can always name them properly. I'm also considering whether a stranger could re-create a closed reserve account within the same transaction, but since later instructions execute after closure within the same atomic transaction, this shouldn't be possible.

I'm checking that the first reserve loop requires accounts to be explicitly declared in remaining_accounts, and that closed accounts route their rent correctly — the asset_signer lamports check happening before the reserve loops confirms all lamports including released rent went to dest rather than the PDA, which looks correct.

Looking further, I note that BurnV1's lamport handling sends the asset account's rent to the payer rather than touching the asset-signer PDA, so there's no overlap issue there either. Now I'm moving on to check SEAL's logic for a similar potential flaw.

With multiple redemptions in one transaction, I'm tracing whether opens and burns can be cross-paired across different assets to double-dip — considering open(A), open(B), burn(B), burn(A) as a sequence, but this seems to be already covered by the rate-limiting check at cap 1, and at higher caps both operations land legitimately since each pairing is valid on its own.

Now I'm probing a trickier case: whether an open could somehow be satisfied by a burn instruction that doesn't fully execute, but since Solana requires all instructions in a transaction to succeed or the whole thing fails, that path is closed. I'm also checking whether a burn's emptiness check could be bypassed by transferring the asset away between the open and burn steps, since the permanent freeze only gates Execute authority, not Core transfers — so a sequence like thaw, transfer to another owner, then sweep could be a real gap worth investigating further.

I'm also checking whether a thawed vault could escape without being burned — but SEAL's requirement of a later matching burn_vault call, pinned to the correct program ID and discriminator, ensures the asset is actually destroyed via Core's BurnV1, so there's no way around it. And if two opens exist for the same asset+owner, they'd both validly match against the same single burn, so that's not an exploit either.

Now I'm considering CPI depth issues: since SEAL's instruction walk starts after the top-level index of the outer instruction (even if open is called via CPI), a wrapper could place a real burn afterward at the top level. But since BURN's backward scan only looks for SEAL_PROGRAM_ID at the top level, a CPI-wrapped open wouldn't be visible to it — so wrapped-open-plus-real-burn fails, which matches what WR.3 measured.

But flipping it — what if a wrapper invokes BURN via CPI while a genuine top-level open exists for the same asset? BURN's backward scan would find that real top-level open and succeed, even though the burn itself was wrapped. I need to trace through how BURN loads the current instruction index to check this.

Right, that matches WR.2's expected failure mode — the open fails from NoTerminalBurn since its forward scan finds no top-level burn, so the transaction dies before the wrapped burn even matters. That makes me think: to get a wrapped burn to actually succeed, the open itself needs a genuine top-level burn_vault later in the same tx to satisfy its scan, meaning we'd need both a top-level burn and a separate wrapped burn present.

So I lay out an ordering: open, then wrapped-burn, then top-level-burn, all for the same asset/owner. The open scans forward and finds the top-level burn, so it succeeds and thaws; then I trace the wrapped burn — it scans backward, finds the open, passes rate-limit and emptiness checks, and executes the Core burn. Then I start checking the stack-height condition for retire_redeemed via CPI, comparing the wrapper's invocation depth against TRANSACTION_LEVEL_STACK_HEIGHT+1.

Working through the CPI depth math: the wrapper itself runs at height 1, its call into BURN runs at height 2, and BURN's nested call into MINT runs at height 3 — but retire_redeemed only accepts height 2, so the wrapped burn's retire_redeemed call fails with NotFromBurn. This confirms the wrapped burn path always fails at retire_redeemed, which is the defense mechanism I was looking for.

Beyond the stack-height check, retire_redeemed also independently verifies that the top-level instruction's program_id matches BURN_PROGRAM_ID — for a wrapped burn this would resolve to the wrapper's program instead, so there are actually two independent checks blocking the exploit. Now I'm looking closer at how retire_redeemed loads and validates that top-level instruction.

Anchor dispatches by discriminator, so a top-level BURN instruction would just run burn_vault, and any further CPI to Core can't reach MINT at height 2 either—so that path doesn't work. The remaining angle is whether BURN's burn_vault could pass a vault_record belonging to a different asset into MINT's retire_redeemed, since BURN just forwards the vault_record key without necessarily tying it to the same asset context.

I'm now checking that RetireRedeemed's seed constraint and the require_keys_eq check correctly force the vault_record to match the asset BURN actually passed, confirming the self-referential seed binds the record to the burned asset properly. Then I move to verifying check_seal_wiring and the SEAL config length requirements, confirming the length checks against OFF_COLLECTION and seal_reserves are consistent with the expected buffer sizes. Finally I start tracing through the initialize function's collection metadata parsing, checking the discriminator byte, the mint PDA comparison, and the loop that reads length-prefixed fields from the account data.

Verifying num_minted and account length checks...

Then it manually encodes the CreateV2 args: data_state enum, name, uri, then plugins as Some(2 items) — PermanentFreezeExecute with frozen flag and Some(authority), plus Attributes with Some(mint authority), followed by an empty external_plugin_adapters vector wrapped in Some.

Checking that push_attr uses u32 string length prefixes matching Borsh encoding, and verifying the MAX_ATTR_BYTES calculation in write_record correctly accounts for key/value lengths without double-counting the vec length prefix or the reveal-time level attribute — this all checks out against the test suite's budget assumptions. Now I want to hunt for any accepted limit that's actually worse than what's documented.

For limit 27, about a claim between a bare burn and retirement paying into a dead account: the vault ATA survives the asset burn, so funds land there but are permanently stuck since nothing can sign for the PDA — this matches what's stated, and since retire_burned is permissionless, it's not actually worse. I'm also checking whether an attacker could keep harvesting payouts from a dead vault post-burn, but the money just sits lost in the dead ATA, so it's a pure loss rather than an exploitable gain.

Moving to the rate limit concern: since "live" supply counts minted minus redeemed minus retired bare burns, a bare-burned vault still counts toward the cap until the crank retires it, letting the cap briefly read higher than true live supply. I'm working through whether this is exploitable — inflating the cap this way requires self-destructively burning your own vaults, so the cost seems to outweigh any benefit, though I'm considering whether a thief with stolen keys could exploit the resulting higher redemption cap.

Running the numbers, with 2100 vaults the cap sits at 45, and you'd need to burn roughly 476 empty vaults just to push it up by 10 — too costly to be a real exploit given hourly retirement cranks, so this matches the stated behavior rather than being worse.

Looking at the draw limit next, the re-roll mechanism is permissionless but practically constrained since the crank captures every minute within the 300-slot window, making it hard for a minter to actually dodge capture — again consistent with what's stated. I'm now noticing something that might actually be worse than documented in how reschedule_reveal sets things up.

Since reschedules use saturating_add with no bound, a vault stuck without a captured entropy value could be rescheduled indefinitely, and because reveal_level requires strict FIFO ordering, that one stuck vault would permanently block every vault queued after it. The key question is whether an attacker could actually force this: capture is permissionless so anyone can step in and capture entropy within the window, which would prevent the reschedule — so I need to work out whether an attacker could realistically keep every potential capturer from acting during that window to sustain the block.

A stuck vault at the head of the queue doesn't block distributions on already-joined vaults, but it does halt new vaults from joining or being revealed — this head-of-line blocking is implicitly acknowledged in the Core-change context (limit 40) and partially covered by the lapse mechanism (limit 25), though the general "one stuck vault halts the queue for everyone" risk seems worth flagging explicitly.

Checking whether a record can ever truly be unrevealable: reveal_level requires the remaining census (`total > 0`) to be positive, but since check_supply caps minted_total at cap_total, revealed_total can never exceed minted_total, so there's always a level available for every minted vault — the supply cap guarantees reveal availability.

For the burn check, if the vault isn't burned I verify the Core asset ownership and key, then confirm the attributes hash matches before making the CPI call. The hash is computed from the exact attribute list supplied by the caller, matching what was stored at mint time, so I'm wondering whether non-UTF8 or unusual attribute data could break this reconstruction.

Only `reveal_level`, authorized by the MINT PDA, can ever write attributes, so the on-chain list should always match the minted list until reveal — meaning this path is safe as long as nobody else can modify the Attributes plugin. I'm now considering whether the Core CPI could fail if the collection's update authority isn't properly set to the MINT PDA in some vault state.

I also check whether an owner could add an external plugin adapter (like an Oracle) to block update CPIs, but testing confirms only the update authority can add such adapters, and MINT never does — so owners can't block updates this way. Attributes itself is authority-managed, so owners can't add it either, closing off that avenue.

Now I'm considering FreezeDelegate, which owners can add — but checking Core's validation logic, frozen state only rejects Transfer and Burn operations, not Update, so it shouldn't interfere with plugin updates either.

Checking other edge cases: the owner can't change the asset's collection without the update authority PDA, so moving an asset out of the collection isn't possible; self-transfers to the asset-signer PDA don't block reveal checks since those don't verify ownership; and nothing in the program closes record accounts prematurely. So the FIFO queue appears robust against permanent stalling from these angles.

Now I'm tracing through `claim` and `retire` more carefully — checking how `vault_ata` gets pinned during the first activation request, confirming retired vaults can't be reactivated, and examining how `pending_this_epoch` gets decremented when a request is retired mid-epoch.

join must also check `dist_epoch > request_epoch` so retire similarly doesn't touch pending_this_epoch, keeping the invariant intact. This confirms waiting_to_join = pending_count - pending_this_epoch stays accurate and non-underflowing since pending_this_epoch never exceeds pending_count. Now I'm checking how join indexes into LEVEL_WEIGHTS.

The subtraction `r.level - 1` could underflow if level were 0, but since pending is only ever set by activate (which enforces level 1..=5), join can never be called at level 0, so this is safe though implicit. I confirm weight_of enforces the same 1..=5 range for claim and reweigh, and now I'm moving to examine how monthly_inline is invoked within boost_vault.

Tracing through claim, I verify monthly_inline fires after crank and after validating the pool token key, but critically before reading acc_scaled -- so the ordering is correct since any credits from monthly_inline land before acc is read. Now I'm checking whether claim verifies the pool has sufficient balance before transferring, since distribute uses checked_sub to guard against shortfalls while monthly_inline relies on saturating_sub instead, which could silently mask an insufficient balance rather than erroring out.

If the pool balance is less than the rounded-up owed amount, avail becomes zero and monthly_inline simply skips crediting rather than failing -- which seems intentional since this function must never error out on its caller. I'm now considering whether the pool could ever actually go short: tokens only leave via claim where the config PDA signs, so I'm checking whether anyone could set up a delegate authority on the pool account to drain it another way, which would require the owner (the config PDA) to approve it, and the PDA only ever signs during claim itself.

So no delegate path exists, and freezing an account doesn't remove tokens either, confirming the pool can only lose funds through claim -- the invariant holds. I also check close_account on the pool, which likewise requires owner signature and isn't possible here. Then I move to checking ceil_sats for overflow risk: since owed_scaled is bounded well below u128 max given realistic token supply, the ceiling computation and subsequent cast to u64 should be safe.

I'm now checking the credit function's arithmetic for overflow: delta calculations using available balance times the scaling factor stay comfortably within u128 bounds, and the accumulated scaled value grows monotonically but remains bounded across the project's lifetime given realistic total distribution and minimum weight values, so multiplying weight by the accumulator never approaches u128's max.

I'm verifying the owed_of formula never underflows across different state transitions — join, credit, claim, and reweigh all preserve the invariant that owed equals weight times accumulator plus carry minus debt, checking each case algebraically to confirm the carry/debt bookkeeping cancels out correctly even when weight changes (like a boost expiring) between accumulator updates.

I'm also checking that debt can never exceed weight*acc+carry, since debt is always set as weight_at_time times acc_at_time and weight only changes through reweigh (which resets debt), so there's no path for it to exceed the bound. Now I'm looking at how retire sets debt_scaled to the full weighted accumulator with carry reset to zero, and considering whether that record could later be reused inconsistently.

I'm verifying that unschedule_boost runs before setting debt_scaled in retire, and confirming that total_active_weight, boost_weight_total, and boosts_active are all properly decremented to reflect the record's removal. I'm also checking that a vault can't simultaneously be both pending and boosted, which would create inconsistent state in the boosts_due ring buffer.

Now I'm scrutinizing expire_boosts' account validation -- it checks writability and that load_record confirms correct owner, discriminator, and version, but critically it never confirms the record is actually the canonical PDA for its asset. This looks like a potential vulnerability where an attacker could substitute an unrelated but validly-formatted record.

I'm reasoning through whether an attacker could actually forge such an account: since only the program itself can allocate and assign ownership to accounts under its own ID, and it only does so through Anchor's init constraint with the proper seeds, any account owned by the program must be either the config or a genuine record at its canonical PDA. So load_record is actually safe here, and the same logic applies to claim. I also confirm the discriminator check in try_deserialize properly distinguishes a VaultRecord from the config account.

Now I'm shifting to examine claim's invoke_signed call, looking at how it signs using the config PDA's seeds.

Next I'm checking whether a claim could pay into a frozen destination - it looks like it correctly defers in that case rather than proceeding, and otherwise requires the token account be initialized, owned by the SPL token program, funded, and the right size. I also verify dest matches the vault_ata stored on the record, which was derived at activation time as the canonical ATA.

Then I'm looking at the second call to activate (the join case) to check whether it properly validates vault_token.

It seems to ignore vault_token on this path, but that's acceptable since the ATA was already recorded elsewhere, and instead it re-checks the asset key against the record, verifies the vault is live, and ensures the distribution epoch is newer before joining.

Now I'm examining the vault_record seeds in the Activate accounts struct — since the PDA is derived from the record's own stored asset field and bump, and the record was created at that exact PDA, this self-referential constraint holds up consistently.

Moving to governance, I'm checking that create_proposal derives the PDA from the incremented proposal count and assigns matching IDs, which CastVote and ExecuteProposal then reference correctly using the same seed scheme.

Now I'm computing the governance proposal's account space, breaking down ACTIONS_SPACE as 4 plus five action slots of 37 bytes each totaling 189, then tallying up the remaining fixed-size fields like id, actions, voting deadline, and vote counts to verify the allocated space matches.

I'm also verifying each enum variant fits within ACTION_MAX_BYTES of 37: Brakes at 37, SetRound at 29, TightenSweep at 28, and ArmSwapOperator at 33 all check out.

Summing a worst-case set of five distinct actions gives 143 bytes, comfortably under the 189-byte allocation—over-provisioned but safe. I then confirm MAX_ACTIONS is 5, so the `seen` array indexed by action kind (0 through 4) is correctly sized.

GOV's execute sets `executed = true` before issuing CPIs, so any CPI failure reverts the whole transaction including that flag—correct behavior. I check that `read_mint_config` requires at least 714 bytes while the config is actually 1261 bytes, which is fine, and that the `Governed` context's `has_one = governance` constraint means MINT only accepts calls signed by GOV's PDA via invoke_signed, which GOV does correctly.

But I notice MINT's governed instructions never verify that the calling program itself is GOV—they only check that the GOV PDA signed, which could be a gap worth flagging.

Now I'm moving into verifying round 25's repair claims, starting with N1: checking that the appended host test actually calls the program's own join/reweigh/retire/expire/credit/tick functions across 260 epochs, replicates the handler's inline purchase scheduling, and validates every ring slot against records. Looking at the specific test function, it does call join, reweigh, retire, expire_boost, credit, and tick, and it does copy the purchase scheduling logic inline — I'm now checking its coverage count assertions.

I'm tracing through the pending_count and pending_this_epoch bookkeeping: fresh_record increments both, join decrements pending_count, and advance_epoch zeroes pending_this_epoch at the end of each loop iteration. I'm working through the exact ordering of when fresh_record gets called relative to retire and credit within the loop body to make sure the request_epoch assignment lines up correctly.

Checking the initial records before the loop, I'm verifying that dist_epoch=0 means they shouldn't join in iteration 0 since the comparison requires strict inequality — so waiting_to_join equals pending_count minus pending_this_epoch.

Then I confirm a tick with zero active weight advances to epoch 1, resetting pending_this_epoch to 0, and the next iteration joins all 48 correctly, leaving waiting_to_join at 0.

I'm checking whether blank_config's zero values for max_boost_weight matter here — since reweigh doesn't enforce bounds checks, it should be fine. I also want to verify the host test actually exercises unschedule_boost's not-due path, not just the ring/active-count assertions.

Now I'm checking whether the not-due branch gets hit at a wrapped ring index, using the "early_wrapped" tracker defined by comparing boost_end_epoch and dist_epoch modulo ring size — that looks consistent. Moving to the N2 sub-claims, I'm spot-checking each: the live-supply stamps map is present and used by RL.7, and the "exactly five picks" check now has a fixed expected string so it will correctly fail if fewer than five levels appear.

For the narrow payout bound, S7.4's condition now allows paid to equal either avail or avail minus one, which checks out. The refusal-reasons arm for 3.7 reads decoded state and pins the rejection message with added owner/frozen context — reasonable even if it can't fully distinguish all 0x9 cases, especially paired with SR.5's 0x1a check for non-owners. The crank overlap case in K.7 also looks fine.

Moving to frozen expiry (BO.37) and books outside BO via `ledger()` and BK.*, both check out. I'm now tracing through the `ledger()` helper to see if its final consistency check — comparing weights, boost totals, active counts, ring+due sums, and balance ceilings — is actually meaningful or just trivially true.

I confirm `ck` doesn't abort the suite directly but prints a failure message and drops the label, which then cascades into a failed BK.* assertion since the expected label string won't match — so the check does properly fail the suite. I also verify `owed` sums correctly only over vaults tracked in `VAULTS`, and that retired vaults are excluded, before noticing a potential gap in how `ledger()` reads offsets.

For level-0 (unrevealed) records, `WEIGHTS[-1]` would be undefined, but the active-flag check runs first so this edge case is already guarded against.

Now I'm tracing through SR.5 and its sub-checks (SR.5a through SR.5e) to confirm each one fails for the correct underlying reason, starting to write out the `thawedBy` helper that opens a vault and sweeps funds to a destination.

The transaction sequence is open (alice signs as owner), Core Execute with bob as authority, then burn by alice — the test expects rejection with `sealFailed` returning false, confirming the refusal comes from Core's Execute rather than SEAL, pinned to error code 0x1a. I'm double-checking that bob's associated token account was actually created upfront so the destination account exists for this test.

For the control variant, a control asset with PermanentFreezeExecute set to frozen:false confirms that execution by the control authority gets refused with the same error code, while execution by the actual owner alice succeeds and empties the wallet — this control case validates the test is well-formed. I notice these control cases use sweep instructions with empty pairs, essentially just testing the baseline execution path.

Now checking each remaining scenario can fail for its stated reason: SR.6 with malformed instruction data should trigger an invalid instruction data error, which I need to confirm propagates correctly through Core's CPI execution. SR.7 tests an odd-length extras array to verify the pairing validation catches mismatched counts.

continues: owner check passes since alice owns the account, triggering the "not the vault's" log line. For SR.12, destination mint mismatch against source mint should trigger InvalidAccountData, and I'm confirming that alice's otherMint ATA was indeed created earlier via the idempotent ATA instruction.

Checking the remaining scenarios: duplicate pairs fail on the second IllegalOwner check, frozen sources get rejected by the token program itself, and zero-pair lamports-only cases pass fine — so the N4 repair looks solid overall.

One gap I still need to address is the delegate/close-authority case. The helper never checks for a delegate, so a delegated source still transfers correctly since the PDA remains the real owner, but closing the account could behave differently if a close authority is set — I need to check SPL's close_account logic, where the authority used is the close_authority if present, otherwise the owner, and verify whether that signer requirement is satisfied here.

If a close authority is set on the vault's ATA, the helper's CloseAccount call (using the PDA as authority) would fail validation and the entire redemption would revert. Since only the owning PDA can set a close authority via Core Execute, and only the owner can trigger that during a thawed redemption, this looks like a self-inflicted failure rather than an exploitable path — though I want to check whether the burn's reserve check specifically rejects accounts with a close authority set by inspecting the relevant byte offset for the COption tag.

A stranger can't set a delegate or close authority on a vault's ATA since that requires the owner PDA, so that's not a vulnerability. Checking N5, the CU and byte-size assertions are in place, and N6's build script now compares hashes against target/deploy and prints all five. Moving to D1-D9, I need to read the updated HOLDER-GUIDE sentences against the actual code to verify consistency.

Now I'm checking the guide's claim about the community vote — it says vaults sold during a vote cannot vote on it, but that seems wrong. The actual rule is that vaults minted after the proposal opens can't vote (enforced via mint index and `VaultTooNew`), not vaults that were sold. A transferred vault's new owner should still be able to vote as long as that vault hasn't already cast a vote, so this guide statement appears to be a factual error that needs fixing.

Actually, this sentence understates holder rights rather than overstating them — it misdescribes who can vote mid-sale. That's a real flaw introduced by the repair itself, not something pre-existing.

Separately, I should check the payout timing claim: no vault joins payouts until a month after the charter window closes, vaults active by then join at that mark, and only afterward can a 100 $GARY burn trigger a payout, with the first free monthly payout a month later still.

Tracing through the logic, the free payout tick does fire correctly once pending activations exist in epoch 0, so that part checks out — but "vaults activated by then join" is only partially true, since becoming eligible isn't the same as actually joining, which still requires a separate step to complete.

The claim about reroll draws also holds up: nobody being able to delay recording to dodge an unfavorable outcome, since anyone can record it and the minute-by-minute job covers the two-minute window.

On vault destruction: everything inside — cbBTC, $GARY, $GIRAFFISH, SOL, anything else — gets destroyed along with the vault, confirming that line is accurate too.

Checking the honesty list items on immutable bugs, Core upgrade consequences, and hot swap/release keys, plus the guide's claims that only the owner's signature can open a vault (with the Gary Club exception noted) and that nothing can leave a closed vault even by the owner — all these hold up as true given PermanentFreeze.

The NFT itself being transferable doesn't contradict anything since the guide never claims otherwise, and the level-never-changes claim checks out too. On payouts being credited monthly in cbBTC, that's honest enough since the guide acknowledges it relies on either the payout job, ordinary activity, or anyone running it for free if both stop. The 2.1% sealed-vaults-per-hour cap, computed on live supply, and the "about 45 an hour at 2,100 vaults" figure both check out as accurate.

Checking the frozen-vault scenario — if Coinbase freezes the cbBTC, the vault can't be opened and owed payouts just stay owed, which matches. The guardian/table permissions are accurate too: guardian can halt sales or the swap bot and cancel a new key but can't restart anything, move funds, or block its own replacement, while the Gary Club can run the payout job and level draw like anyone else can. The claim about the Bank's pages showing the deposit address runs into item 50, which is still open and blocks publication since the guide is still a draft.

Moving to round 25's checks: opening being capped at 2.1% to slow mass vault-emptying looks fine, but the instruction to open only via the Bank's redeem page fails since that page doesn't exist yet per item 50, and the claim that every opening gets publicly announced on X also fails since the poster has no sender defined. Now I'm looking at the activation claim — once a vault holds at least 21,000 sats of cbBTC it's said to activate automatically, but I need to verify this since activation actually requires a permissionless call to trigger it rather than happening automatically.

Checking the swap tolerance claim confirms it's accurate, and the flow of funds description—sales in cbBTC, royalties in SOL, 85/15 split between vaults and treasury—also checks out. The level-based share table and the claim that multisig or DAO-held vaults can't be opened both hold up as true.

The real issue is the guide's claim that "vaults sold during the vote cannot vote on it" — likely meant to say "minted during the vote." Cross-referencing SPEC and DESIGN docs on quorum snapshots, both agree that eligibility is based on vaults live when the proposal was created, with vaults minted mid-vote excluded via VaultTooNew and not counted toward the bar.

So only the holder-facing guide has this "sold" wording issue — a minor doc bug, since that's the document users rely on for accuracy. Worth noting as a low-severity finding, but I want to dig into something more consequential now: whether a redemption could be permanently blocked if a vault's reserve ATA doesn't exist when building the sweep transaction, since anyone could permissionlessly create and fund a token account for that owner before the redemption completes.

If the page pre-creates the three reserve accounts in an earlier transaction, a griefer can't close them afterward, so the sweep helper reliably finds and sweeps them before BURN runs — that path is sound. The real gap is that a stranger can create a *non-ATA* classic token account owned by the vault PDA using `createAccount` with an arbitrary keypair. Since BURN's reserve loop only checks canonical ATAs, and the second loop only checks explicitly declared accounts, any cbBTC sitting in this undeclared non-ATA account would be destroyed when the burn executes.

This isn't a griefing vector though, since the page never declares that account, so it can't block redemption — the only consequence is the stranger loses their own tokens. I'm checking whether the same logic applies to a Token-2022 ATA for a Token-2022 mint owned by the PDA, and it does: not required, not declared, destroyed harmlessly. Now I'm trying to figure out if there's any account type a stranger could create that BURN wouldn't skip and the sweep couldn't catch — going through all six derivable reserve addresses, three creatable classically and three not, with the classic three already covered by the pre-creation step, so there doesn't seem to be a gap unless the prior transaction somehow fails to create one of them, which shouldn't be possible given atomicity.

Then I realize there's another angle: the asset-signer PDA's lamports themselves could be topped up by a stranger between the setup transaction and redemption, but since the helper reads the live lamport balance and sweeps it before BURN checks, this gets closed too. Now I want to verify how Core's ExecuteV1 treats the asset-signer account — specifically whether it leaves lamports behind or creates the account if missing.

Since the test suite confirms this works empirically on the pinned binary, I'll treat it as verified rather than a real risk. Now I'm checking the `initialize` function's one-time parameters for anything that could lock in a disaster — specifically the requirement that `sol_reserve_lamports` is either zero or above the rent-exempt threshold, which means with zero the revenue PDA could get swept entirely to zero lamports.

Tracing through what happens if a royalty payment smaller than rent-exempt tries to go to a zeroed-out revenue PDA — the transfer would fail the rent check, breaking the marketplace sale entirely. But the ruled value is 0.05 SOL and pinned by `check-launch-params`, and `tighten_sweep` can only raise the floor, so this is avoided in practice and documented elsewhere. Now I'm looking at the `cooldown_ceiling_secs` bound relative to `sweep_cooldown_secs` and the 7-day cap.

Continuing through the governance bounds, I verify `reserve_ceiling_lamports`, `sweep_floor_lamports`, `max_sweep_lamports`, and `monthly_secs` each fall within their allowed ranges against the ruled values — all check out, including the 30-day monthly period being exact.

Now I'm looking at the charter window constraint: `charter_closes - charter_opens <= 90 days` and `charter_closes > now`, but notably it doesn't require `charter_opens_at` to be in the future, meaning a charter could theoretically open immediately or even in the past at initialization. I want to check whether `check-launch-params` validates that the opening is future-dated, but that script isn't included in the file list I have access to.

Thinking about the consequence: if `charter_opens_at` is set in the past, the window opens right away, but since `lock_deadline` must be set before `charter_opens_at`, this creates a contradiction that would likely surface as a launch error caught after the fact by the alarm system rather than being blocked upfront.

I'm also realizing there's no minimum enforced between `charter_opens_at` and `charter_closes_at` — only that the close time must exceed the open time. That means a typo could produce a charter window of just one second, which combined with the "window never reopens, claims can't be stopped" rule makes this a real risk worth flagging, even though it's not in the bundle to confirm the checker catches it.

Since the program is frozen but not yet deployed, a fix is still possible, though any change would reset the freeze counter — so I'll flag this as a MEDIUM/LOW finding rather than a blocking one. It directly answers the "what a wrong value locks in forever" question, and I'll note that other params like monthly_secs already have floors, making the absence here inconsistent and cheap to fix.

Checking other parameters for similar gaps: level_caps just need positivity and sum within max_supply (no hazard since check_supply enforces the cap), max_supply just needs to be positive, and the voting params (quorum_bps, threshold_bps, min_voting_secs) all look properly bounded. I'm now examining the redeem_window_secs range for the burn mechanism.

I spot a real issue in the seal reserve mints: there's no duplicate check, so if the same mint (like cbBTC) were listed three times instead of three distinct tokens, BURN's loop would only ever check that one mint's ATA repeatedly — meaning other seal assets like $GARY and $GIRAFFISH would never be validated, letting a vault holding them burn without properly accounting for those tokens. That's a serious launch-time misconfiguration risk that only the checker would catch, consistent with what I flagged earlier.

I'm also noting that `assert_classic_spl` only verifies the account owner is SPL Token, not that it's actually a mint — a regular token account (165 bytes, owned by SPL Token) could pass this check and be slipped into `reserve_mints`, similarly leaving a real reserve asset unprotected while BURN's derived ATAs silently never exist.

Now I'm looking at the mainnet facts probe script to check whether its test arms for Token-2022 ATA creation are vacuous, examining how it asserts refusal of IncorrectProgramId errors.

Idempotent means a no-op if the account exists, so the classic control uses a fresh off-curve owner to force real creation, which matches the comment. The simulation setup with `sigVerify:false` and `replaceRecentBlockhash:true` doesn't need real signatures, and the payer still needs enough lamports (checked at ≥10,000,000) since account creation runs during simulation. I'm now checking the actual instruction construction for the idempotent ATA creation with the simulation payer, ATA, owner, mint, and token program.

For the Token-2022 case specifically, I'm reasoning through how the ATA program invokes the given token program and whether the `IncorrectProgramId` error surfaces at the top-level instruction index — the inner failure just propagates up, but the measured value stays pinned either way. There's a flakiness risk since it depends on mainnet history having a funded payer among the last 20 non-error ATA signatures, though that seems reasonable. I'm now looking for an approach that can't fail at all.

Testing with an undefined `until` and a capped max-page walk, I expect the walk can never close, so the "gap" assertion should deterministically read true — a small but meaningful check. The other assertion about paging past the 1000-signature cap depends on the ATA program being busy, which is acceptable. Now I'm scanning the suite for test arms where the expected value is derived independently from the same raw data as the actual value, like the hex-encoded sysvar slice case, to find ones that are guaranteed to pass by construction.

I'm verifying other checks like sales flag and config reads look fine, then digging into SR.4a's balance arithmetic—confirming that pda1 equals pda0 plus the 1,000,000 transfer, tracing how the expected and actual balance deltas line up before and after the sweep.

For IN.2, I'm checking that `every()` on an empty array vacuously returns true, so the test correctly fails when the count is zero but the condition reports true.

Checking `because` pin mappings: 0x11 matches AccountFrozen for the frozen pool rejecting the transfer, the system program error matches "account already in use," and SR.1's missing-signature case traces back to the sweep instruction being called with `isSigner:false`, producing MissingRequiredSignature as expected.

The tricky part is that `att` filters for specific patterns like "Error Code" or "custom program error," but the runtime's "failed: missing required signature" line doesn't match any of those — so it falls through to the raw error message fallback, which does contain the right text, so the check still passes.

Now I'm thinking through level C's draw: the leader of slot C sees hashes hA and hB before producing its block, and can vary block contents to grind for a favorable hash. The question is how many attempts it realistically gets to influence the outcome versus being just one more uniform draw.

SlotHashes actually records the bank hash, which folds in the accounts delta hash and requires full transaction execution to recompute, so grinding by varying trivial inclusions like a self-transfer is costly but still feasible to some degree in 400ms — maybe tens to thousands of variants with precomputation. This still supports the "choose among many" framing, and skipping slots already gives a leader best-of-4 without any grinding at all.

Since leader groups span 4 slots with a stride of 2 between rotations, a validator could hold adjacent or even overlapping groups depending on stake weight, since the probability of a validator controlling two nearby groups scales roughly with the square of their stake fraction — meaningful for larger validators above a few percent stake.

Combined with the fact that schedules are public, a validator could deliberately time a mint into a slot where it controls all three leader groups, letting it grind every hash. But the spec already acknowledges this: three groups mainly remove influence from *other* leaders, not from the attacker itself if it happens to also be C's leader, and measured data shows validators sometimes hold adjacent rotations, so the "three different leaders" guarantee is probabilistic rather than absolute. Holding all three groups doesn't meaningfully increase the attacker's power beyond already controlling C, so this isn't a new vulnerability — though I'm now wondering if there's a different, unstated issue around minimum timing constraints.

Since the FIFO order is fixed by mint order, and the census state evolves deterministically from public entropy, the draw outcome for any vault is fully computable once the hashes exist—leaving no real room for choice, aside from the already-noted option to let a capture lapse within the 25-limit.

But a subtler attack emerges: if a vault is bad and owned by someone else, a third party could capture it anyway just to lock that outcome into the census, thereby shifting what later vaults (including their own) will draw. Since captures are permissionless, an attacker holding a later vault could strategically capture or withhold captures on other people's vaults to engineer a better census state for their own draw.

Since capture timing can't change the entropy value, the real lever is deterministic: either capture or force a global lapse. But the broader insight is that the lapse mechanism can be exploited on *other people's* vaults ahead of mine — by withholding capture when the crank is down, I can reroll someone else's draw and reshuffle the entire downstream census to my advantage, which is a stronger form of the manipulation limit 25 describes.

The attacker can't unilaterally force a lapse, though — it requires the crank to be down and all parties silent simultaneously, which naturally happens during crank outages anyway. Limit 25 does acknowledge that every other holder is affected through the census when a reroll happens, and that both the crank operator and the minter's own client can withhold, but it frames the benefit as going to "a minter who dislikes their draw" rather than noting that a third party unrelated to the vault could be the one who profits from someone else's forced reroll — I'll flag this as a low-severity refinement to that limit.

Now I'm shifting to verifying whether the pool always holds at least the ceiling of what's owed, starting from the fact that claims are the only mechanism that reduces the pool's value.

I need to track balance B and scaled owed amount O against scale factor S, checking that credit operations bound the growth of owed by the available surplus so the invariant B ≥ ceil(O/S) holds after each distribute.

For claim operations, since payout is exactly floor(pending/S) and the reduction to owed is an exact multiple of S, both balance and owed shrink in a way that keeps the invariant exactly preserved.

Checking batched claims across multiple vaults, the sum of pays is bounded by total pendings divided by S, which stays under B, so the balance never goes negative and the ceiling invariant still holds. Retire operations only reduce owed while leaving balance untouched, which can only help, and reweigh doesn't touch owed at all. External token deposits just increase balance, which is always safe. So the invariant B - ceil(O/S) ≥ 0 holds across all these operations.

Now I'm double-checking whether O actually equals the sum of pendings across active vaults by walking through each operation type: join resets debt and pending to zero without touching O, activation requests don't change O either, and credit distributes delta proportionally by weight so the total pending growth matches delta times total active weight — provided total_active_weight truly tracks the sum of active weights, which I need to verify join maintains correctly.

I'm now turning to SPEC's weaker rule from round 24, which states a vault is never credited by a distribution that ran before it joined, but revenue sitting in the pool at join time gets shared at the next distribution among everyone joined then. I want to see if I can find a case that breaks this.

Checking that join sets debt properly confirms the rule holds, and the unsplit revenue limit covers lingering pool funds. Now I'm shifting to liveness properties — whether anyone can block distributions or redemptions for others, looking at what conditions gate a distribution from proceeding.

I verify that the join path still works even if the vault ATA account doesn't exist yet, since Solana allows loading empty accounts. Now I'm wondering if a griefer could spam pending activations to make joining prohibitively expensive, given each activation requires funding a vault with a fixed sat amount.

I'm checking whether redemptions could be blocked for others — the rate limit only lets an attacker burn their own budget, and passing the wrong pool account just fails their own transaction. I'm tracing through the cases where `ClaimBeforeBurn` might fail to deliver if the owed amount is nonzero but the claim can't actually settle.

If the vault's cbBTC account is frozen, the claim defers payment and `retire_redeemed` refuses since something is still owed — meaning a frozen vault genuinely can't be redeemed until thawed, and this holds for two separate reasons (claim can't pay, and burn needs empty reserves which a frozen account can't provide). Similarly, a frozen pool forces the forfeit path, and I've confirmed the pool can't have insufficient balance by invariant. Now I'm considering a trickier scenario: a third party crediting the vault between the claim and burn steps within the same transaction, checking whether `monthly_inline` running after retire could interact with that credit.

If the redemption order is claim-open-sweep-burn and a distribution happens inside claim's own monthly_inline, the credit lands before payment is made, so the owed amount settles to a sub-satoshi carry that still passes the retire check — confirming this path is safe since monthly_inline always runs after retire within burn_vault, and the sweep step doesn't trigger distributions either. I'm now checking whether the same claim-open-sweep-burn ordering could cause an issue through some other angle.

Transactions are atomic with no interleaving, so this attack line doesn't work — redemption liveness holds, aside from the already-documented freeze cases. I'm now considering whether an owner could repeatedly call boost_vault to keep boosts_due permanently nonzero and block expiry, which would require checking whether expire_boost's reliance on the vault being active creates a gap when a vault is bare-burned but not yet retired.

Checking that expire_boosts works fine on active vaults regardless of liveness, and retired vaults never had scheduled boosts in the first place, so there's no lock here — anyone can call expire_boosts since the due records are readable off-chain. I also confirm boost_vault doesn't gate on boosts_due being zero, so buying a new boost while one is already due still works correctly since distributions can't run until the due boost expires, preserving the new boost's full epoch count; and set_boost_terms is safe to call while boosts are active since it doesn't touch live boost state.

Now I'm tracing the ordering inside boost_vault's reweigh call — it increments the expiring counter, active boost count, and total weight before calling reweigh, which requires the record to be active and sets its boost weight; if reweigh fails everything reverts cleanly. Then for expire_boost, I'm checking the logic requires a positive boost weight and that the distribution epoch has reached the boost's end epoch before unscheduling and reweighing the record.

I'm now tracing whether boosts_due could get decremented twice for the same boost, since unschedule_boost gets called from both expire_boost and retire — both paths are guarded by boost_weight being positive, so I want to verify a retired record can't still be picked up by expire_boost later.

Confirming that expire_boosts, claim, and retire all check active/retired flags so a retired record is permanently excluded, and that ledger summation correctly skips retired records too. Now I'm shifting to check whether MINT's crank function, which operates on arbitrary remaining_accounts across mint/claim-charter/activate/claim, could be abused to advance someone else's record maliciously.

Tracing through reschedule_reveal, I see it only fires after the reveal window has already expired without a capture, meaning it's strictly a repair mechanism rather than something a griefer could weaponize preemptively — since before the window passes capture still works, and after it passes capture becomes impossible anyway, so there's no exploitable race at the boundary slot.

Now checking governance for permanent freeze scenarios: can't create proposals without a live vault so quorum=0 is moot, total vault burn with max_supply minted is a genuine dead-end but that's expected, and the threshold cap under 7500 blocks unanimity deadlocks. I'm also verifying that `last_round_id` can't be corrupted — stale round IDs get skipped without advancing the marker, so only strictly newer IDs move it forward.

I'm also tracing whether someone could spam proposals to inflate the count, but since marks only advance on execution (which requires passing quorum), junk proposals alone can't poison state, and the seven-day execution window applies permissionlessly to any passed proposal including guardian changes.

Thinking about the stolen-key scenario: a thief stopping sales doesn't make the fix "permanent," since quorum_supply is fixed at proposal creation and live supply only shrinks over time through burns and redemptions, so the bar for replacing a compromised guardian actually gets easier to clear later, not harder. Now I'm wondering if a hostile party could instead raise that bar by minting more supply before a proposal is created.

Minting itself requires an open round, which only works if sales aren't currently stopped, and vaults minted during an active vote don't count since quorum is snapshotted at proposal creation. But an attacker could still mint extra vaults right before creating a guardian-replacement proposal to inflate the quorum threshold -- those new vaults would be eligible to vote and could vote NO, which doesn't help meet the YES requirement but still counts toward quorum, effectively raising the bar without contributing to passage.

Working through the math: if live vaults are 2100 with honest YES at roughly 1100, the attacker needs N > 2H - L, which comes out to only about 100 extra vaults. At 21,000 sats each, that's roughly $1,800 total -- a remarkably cheap way to block a legitimate guardian-replacement vote, and the attacker even keeps the minted vaults afterward.

But this attack only works if minting is actually possible, which requires sales to be open. In the stolen-guardian scenario where the guardian has maliciously stopped sales, minting is blocked, so this inflation attack can't be used there. However, for replacing the swap operator, sales might still be open, so a compromised operator could mint vaults to inflate the bar and dodge their own replacement -- though the guardian could preemptively halt sales to stop that.

Comparing against an ordinary proposal: buying a NO vote there just cancels roughly one YES. For a key-change vote, the purchased vault both raises the bar by 0.5 and can cast a NO, giving roughly 1.5x leverage overall—not dramatic. The bigger question is whether blocking a key change is cheap in practice, since the attacker would need to act before a proposal is even created, with only a 3-day window to work with.

Buying up around 100 of 2,100 vaults for roughly $1,800 could decisively raise the YES requirement if genuine turnout is marginal, which seems worth flagging as a medium/low severity issue: the key-change threshold is denominated in a supply the attacker can cheaply inflate while sales remain open, giving about 2x leverage per vault at the 21,000-sat floor price. Still, I'm weighing whether this is a true defect versus just a natural consequence of the half-of-all-live design combined with a vote-settable cap, especially since the guardian retains the ability to halt sales.

The bigger mitigation is that the guardian can stop sweeps or sales entirely, bounding the impact — in the scenario where a compromised swap operator needs replacing, royalty SOL just accumulates safely while blocked rather than being stolen outright. So I'm leaning toward rating this LOW overall, though I need to consider the edge case where the guardian itself is the malicious actor and deliberately keeps sales open to block its own removal.

This connects to limit 47's permanent stop at low turnout — since vaults, payouts, and redemptions stay unaffected, I'd call impact LOW-MEDIUM. Since limit 47 already accepts the permanent-stop outcome, I should frame this as a refinement showing that limit is worse than stated, since the attacker can cheaply manipulate the turnout bar.

But I realize minting actually requires an open round with a vote-set cap and closes_at, so the community can simply stop opening new rounds once they notice the attack, and the attacker is bounded by whatever cap and remaining capacity exists in an already-open round. At launch though, a hostile majority could set that first round's cap at the floor of 2,100 through one ordinary 10.71% YES proposal.

This matches a concern already flagged in the spec about buying the electorate cheaply at the floor price, and my bar-inflation refinement just adds that vaults purchased this way count doubly against the key-change threshold. I should report this as a MEDIUM severity refinement of the existing "worse than stated" limits and concentration notes, keeping the writeup concise rather than re-litigating whether buying vaults to vote is itself an attack.

Moving on, I want to check the swap operator and guardian functions for permissionless access without proper stop checks. Looking at `cancel_swap_operator`, the guardian can cancel a pending operator, but there's intentionally no equivalent cancel path for a pending guardian change itself. I also want to verify that `arm_guardian`'s per-kind marking correctly prevents an older proposal ID from landing after a newer guardian proposal has already been executed, and then check whether `apply_guardian` could be front-run.

The concern about front-running `apply_guardian` resolves fine: once the notice period elapses, anyone can apply it, and even if a thief applies it first, both the old and new guardians were community-chosen, so no harm. The `emergency_stop_*` function correctly requires a non-default guardian, meaning once the guardian is retired to None, nobody can trigger a stop — this is already documented behavior. Now I'm turning to think about `restart` and how GOV passes the creation timestamp, checking it against the mint's sales-stopped timing requirement.

I verify that MINT's `restart` is only reachable through GOV and that the timestamp check is consistent. Looking at `split_revenue`, the config account is correctly marked as non-mutable in its seeds derivation. For `SweepSolForSwap`, I confirm the revenue account is an unchecked account validated within the handler, and the swap operator is a properly signed, mutable account. I'm now examining how the revenue PDA, which holds SOL as a system account, is used in a signed cross-program invocation.

The revenue PDA is system-owned with zero data, since it only ever receives lamports passively from royalties rather than being explicitly created — which satisfies the requirement for a system transfer. The balance check ensures funds never drop below the required `keep` threshold, and if the account empties to zero it simply gets deleted, which is expected behavior. I'm now tracing through MINT's `initialize` function to verify the royalty CPI account list matches what Core's `AddCollectionPluginV1` instruction expects.

Checking the account ordering against Core's expected signature for plugin installation, the structure lines up correctly with collection, payer, authority, system program, and the log wrapper placeholder — so the royalty verification tests should pass. Looking at SEAL's `set_frozen` CPI accounts against `UpdatePluginV1`'s expected signature, the account layout and signer requirements also check out correctly.

I'm also verifying burn's declared byte against remaining_accounts length — 255 max with six ATAs for three reserves plus any extras, which fits fine. Checking that burn_vault's reserve count from SEAL stays within bounds (1-3, never zero or over MAX_RESERVE_MINTS), and confirming there's no way to sneak a funded reserve ATA past the emptiness proof — since the loop requires every derived address to be present in remaining_accounts, an undeclared but funded reserve would trigger a ReserveNotDeclared error, so the check holds.

Addresses are unique, so a redeemer can't substitute a different account at an expected address, and duplicate entries just resolve to the same account via `find`. Passing the expected account as non-writable doesn't matter since burn only reads it, and stale data isn't possible since account state is always live. Now I'm looking at the second loop's zero-lamports skip condition, since a real token account can't have zero lamports due to rent requirements.

A closed account would be the exception though. I'm checking the burn tombstone logic—Core's burn leaves a single zero byte representing an uninitialized key, which matches the `is_burned` check correctly. For `retire_burned`, I'm confirming that a redeemed vault can't also be retired this way since `retire` requires it not already be retired, and `retire_redeemed` sets that flag first, so calling `retire_burned` afterward fails with AlreadyRetired—keeping the burn-retirement accounting consistent with the total minted.

I'm also verifying `burned_total` can't be double-counted since each vault can only be burned once at the Core level, and `bare_burns_retired` similarly only increments once per vault through `retire_burned`'s guard against already-retired records. Now I'm looking at whether `open_for_redemption` in SEAL properly requires a signer for the payer.

Moving to risk R1, I'm checking whether a thawed vault could ever leave a transaction without being burned. The only thaw path is through SEAL's open, which mandates a matching later top-level burn that either succeeds (destroying the asset) or fails the whole transaction, and after Core's burn, MINT's retire must also succeed or everything reverts — so a successful burn always means the asset is destroyed. I'm now considering whether Core's BurnV1 could somehow execute as a no-op for the same asset+owner pairing.

Instructions execute strictly in order and any failure aborts the transaction, so a matched burn always actually runs. Checking the scenario where the asset is transferred to a new owner after thaw but before burn — the open's scan would reference the old owner, so it wouldn't match a burn by the new owner, but either way the asset still ends up burned. I also rule out Core's UpdatePluginV1 re-freezing the vault, since only SEAL's PDA has that authority and SEAL has no re-freeze instruction.

Now I'm checking whether two burns of the same asset in one transaction could cause trouble — the second would fail since the asset is already gone, so that's safe. I'm also tracing what happens if a bare Core BurnV1 executes between an open and its paired burn: the paired burn's checks would catch the tombstone state and fail with NotACoreAsset, reverting the whole transaction, so the thaw correctly reverts.

I'm also considering a scenario where open happens, a sweep occurs, then a bare Core BurnV1 runs without a paired burn_vault call — this fails open's NoTerminalBurn check. And I'm checking whether rate limiting between open and burn_vault could leave a vault thawed and emptied without completing the burn, but since the rate check happens before the Core burn, any failure there reverts the whole transaction too. This confirms R1 holds — there's no way to end up with a thawed vault that survives. Now I'm thinking about whether the sweep helper could be used to extract value during a thaw without a terminal burn ever occurring.

I'm now scanning the SEAL forward loop for overflow bugs in the instruction index increment, but concluding the loop terminates safely when the instruction load fails so there's no overflow. I'm noting the comment confirms this is a fail-closed walk design. Then I shift to thinking about how the instructions sysvar behaves with ALT-loaded accounts in v0 transactions and whether resolved pubkeys are returned correctly.

Now I'm checking R8: looking for prompt claims no verification arm exercises, like delegate/close authority or frozen destination accounts, which may be gaps worth flagging.

Several other untested cases — non-ATA destinations, sending to another vault's PDA, below-rent-exemption lamport transfers — appear to be acceptable by design rather than real gaps. Now I'm looking at prompt (d) about whether the asset-signer can end up non-zero after the same transaction if a later instruction deposits into it.

Since a griefer can't inject instructions into someone else's transaction, the only risk would be the owner self-inflicting a bad instruction order, which isn't something that needs defensive code. For prompt (f), I'm checking whether real redemption pages add extra accounts beyond what's reserved — compute budget instructions, a fourth reserve (impossible given the three-mint cap), and the monthly run's pool accounts all seem already accounted for, though I still need to check whether extra token pairs for stray classic token rescues could push past the reserved account space.

I need to work out how Core's ExecuteV1 actually passes the inner instruction — the SDK's execute function builds the instruction with data containing the serialized inner instruction and accounts drawn from the inner instruction's account list, so each pair likely adds roughly 66 bytes between the account metas and keys, plus whatever space the inner instruction's own account references take in the data.

Rechecking the numbers: three reserve pairs plus signer, destination, token program, and system program gives roughly ten accounts for the Execute call. Adding a fourth rescue pair pushes the size close to 1,127 bytes, which only fits within the 1,232-byte limit if the transaction skips the separate fee payer or the compute-budget instructions — with both included, it overflows to around 1,275 bytes. That's a precise, checkable conflict between the documented rescue feature and the packet-size constraint, worth flagging as a LOW finding.

I also want to verify the sweep helper correctly handles the zero-pairs edge case, and I'm looking over the bundled rehearsal-tree script that lists program IDs for the vault, mint, burn, governance, and sweep components.

The patch script only requires five specific files to be updated, notably excluding the sweep program's own source since it has no declare_id! macro — being a native program, its id comes from the keypair alone. That id instead shows up in the test files and detector scripts, which get updated through the global substitution.

I'm noticing the script's header comment is stale — it says "four program ids" and "five substitutions" while the actual logic performs six (five ids plus the repo root path), matching what the SPEC document correctly states. This looks like an earlier correction fixed the SPEC's wording but missed updating the matching comment in the script itself, so now there's an inconsistency between the two.

Checking the prefix-exclusion logic confirms it covers the five ids correctly, and docs outside the checked file set aren't guarded against abbreviated ids—though that's scoped intentionally since only the core program/bank/script files matter. The remaining thread to follow is whether the script's git checkout step to reset the destination tree could clobber something unexpectedly.

I'm now cross-checking the floor constants in run-tests.sh (MIN_ASSERTIONS, DET_FLOOR, HOST_FLOOR, etc.) against the spec's stated numbers, and they line up—829/740/39/22/14/35/33 all match. I'm also verifying the host test count of 6 against the validation doc's breakdown of five tests plus test_id.

I'm confirming the `floor` function correctly parses cargo test output by grepping for "N passed" and taking the last match via tail, which should yield 6 for the host test suite.

Looking at `build-mainnet.sh`, I notice it checks the four programs' source for INIT_AUTHORITY but skips the sweep program, asserts there are 5 dist files, and compares sweep bytes against the local and target/deploy directories — but it doesn't cross-check the other four programs' mainnet bytes against anything the test suite ran, which feels like a gap in coverage.

The byte comparison assumes target/deploy still holds bytes from the localnet suite run rather than a mainnet build that got copied over, which would make the cmp pass trivially — but since run-tests.sh populates target/deploy and build-mainnet.sh deploys from $OUT/$LN_DIR without overwriting it, that risk seems contained in practice.

Now I'm comparing the Merkle tree implementations between the JS script and the Rust program — checking that leaf hashing and node ordering (sorted pair hashing with odd-node promotion) match exactly between the two, since any mismatch in comparison logic between byte arrays could break proof verification.

Then I check domain separation between leaves (0x00 prefix) and internal nodes (0x01 prefix), confirming an attacker can't forge a leaf that collides with an internal node due to preimage resistance. I also verify that an empty proof correctly just returns the leaf itself as the root, which is the degenerate single-leaf case.

With 240 elements the root will never equal a single leaf, so that edge case doesn't apply, and the code explicitly rejects a zero root anyway. The 16-proof-length cap matches depth 8 for 240 leaves, and finding a colliding sorted-pair proof of that length is computationally infeasible. Now I'm looking at how `claim_charter_vault` passes through the `pob_extra` data.

The code validates the extra-account count against a max and the remaining accounts length, splits them off, and appends them as non-signer extras in the BurnV1 CPI. I'm checking whether an attacker could smuggle a sensitive account in as an "extra" to trick Core into writing to it, but Core only touches extras its plugin adapters expect, and without a matching external plugin adapter it just ignores them.

Now I'm tracing a subtler angle: could someone pass MINT's own config account as an extra, creating an aliasing issue between Anchor's typed `Account<T>` handle and the raw AccountInfo in remaining_accounts? Since Anchor's `Account<'info, T>` deserializes data at entry without holding a live mutable borrow for the handler's duration, invoking with the same account as an extra likely wouldn't trigger a borrow conflict, though the implications of that aliasing still need more thought.

Separately, I'm considering whether including already-signing accounts (like payer or owner) as extras could cause a mismatch in signer privileges, since the runtime might dedupe by pubkey and still treat the duplicated AccountInfo as a signer, regardless of what the meta claims — which could matter for privilege semantics in the CPI.

Since Core reads accounts positionally using indices 0 through 5 only, a duplicate appearing later in the list with a different signer flag doesn't actually grant any extra privileges. I'm now moving on to checking `claim_charter_vault` in the MINT module, looking at how it validates attributes against a cap of six and writes the combined attributes-plus-charter record.

The attrs hash covers the full combined data, and reveal correctly requires resupplying it, so that checks out. Moving to `mint_vault`, the attribute cap there is seven, which is also fine, and I'm noting that `monthly_inline` runs before the sales-stopped check — meaning a blocked mint still triggers distribution logic before reverting, but since the whole transaction reverts on failure, this isn't actually an issue. I'm also confirming `retire_redeemed`'s trailing `monthly_inline` call propagates its result correctly, and now shifting attention to checking the Dist-related logic next.

I'm now verifying mutability flags on `pool_token` across accounts: in `Distribute` it's correctly non-mut since that handler reads it directly rather than calling `monthly_inline`, while `Claim` needs it mutable for the transfer, and `RetireRedeemed`, `BoostVault`, `MintVault`, and `ClaimCharterVault` all correctly leave it non-mut since they only read it.

I'm checking that `monthly_inline`'s `WrongPool` check also applies consistently wherever a wrong pool key could be passed, like during a burn-triggered retire-redeemed call or a frozen-pool check — in each case a mismatched pool only breaks the caller's own transaction, so there's no cross-account risk.

Now I want to verify what happens if the pool token account was never created at all — since `pool_ata` is derived deterministically from config, SPL_TOKEN, and payment_mint, `monthly_inline` would treat a missing account as holding zero balance, while `distribute`'s `read_token` call would instead fail with VaultAccountMissing due to the owner check. Next I should confirm that the royalty plugin, with its authority set to None, truly can't be modified by anyone.

Checking R6 further, nothing in the programs invokes UpdateCollectionPlugin, so the plugin's immutability holds. For the redemption cap's rolling 64-slot ring, I confirm `rate_head` wraps correctly as a u8 and is guarded against corruption via modulo indexing — but there's a subtlety: since the ring timestamp comes from the Clock, two redemptions within the same slot get identical timestamps, which matters when checking the cap boundary.

I trace through consecutive redemptions in the same transaction: the first redemption checks two slots back (initially empty, so it passes) and writes its timestamp, advancing the head. The second redemption then checks two slots back again, but due to the head shift, this now lands on the entry written just before the first redemption of this same transaction — meaning the first redemption's own entry effectively becomes the most-recent reference point for the second check.

So at cap 2, two redemptions landing in the same window both succeed since the window check looks far enough back, but a third attempt in the same slot would check against the entry just written (zero elapsed time) and get refused — confirming the rolling window works correctly. I also note that cap shrinks dynamically as live supply decreases with each burn, so the cap recalculates each redemption based on the updated live count.

So the effective cap self-limits as live decreases rather than being a flat threshold, which is stricter but not a defect. At small cap values like 1 or 2 in the test suite's census this shrinkage is invisible, and the S9b.0 check confirms both redemptions land at cap=2 since the live count doesn't drop the ceiling. But at mainnet scale the real cap ends up slightly below the nominal 45, raising the question of whether SPEC 32's "ceil(2.1% × live)" wording accounts for this.

I'm working through the math more carefully now: with L0=2100 live vaults, redemption j sees live decrementing, and the cap recalculates each time based on the remaining count, so I'm deriving exactly when a redemption gets refused due to insufficient window depth.

Checking j=45 and j=44 gives caps of 44 both times, which means only 44 redemptions actually land in that hour, not 45 as the guide states. Since the guide says "about 45" loosely while the spec claims exactly 45 (ceil of 44.1), I'm noting this off-by-one discrepancy as stricter behavior than documented, worth flagging as INFO severity.

Now I'm moving on to checking the `want` parameter in `try_capture`.

Since the buffer holds 512 slots and the window is capped at 300, nothing relevant ages out before capture, so the set stays deterministic regardless of timing within the window. The remaining concern is forks: SlotHashes is fork-specific, so a capture only exists on the fork where its transaction landed, and if that fork gets abandoned the capture disappears with it.

A real blockhash is never all-zero, so if `blockhash_in_window`'s check against zero ever fires, the capture simply fails and the window eventually lapses, triggering a reschedule -- not an exploit. For the host test deserializing a zeroed buffer into `MintConfig`, all the bool fields decode as false since Borsh accepts 0 as valid, so that case is benign too. Now I want to look closer at how `claim` handles `r.pending`.

For the `dest` checks: a pending record validates the destination against the vault ATA and only joins/stores if the distribution epoch is newer, otherwise it continues without writing -- that looks correct. I notice that for non-pending, non-active records, the loop just skips without validating `dest` at all, but since the record is inactive this seems harmless. Joining a vault doesn't actually read the ATA state, so even a frozen vault ATA wouldn't block it. Now I want to check `activate` and how it handles the vault ATA cap.

I'm confirming that `activate` derives and records the canonical ATA by checking the vault token key matches the expected derived address, with `read_token` validating mint and owner — so the vault ATA field is always trustworthy. I also see `require_live_vault` ensures only a live, collection-matching asset can request activation, meaning a burned vault can't newly activate, though one that requested before being burned could still be joined later. The event emissions and log messages seem purely for off-chain consumption, so I'll skip those. Now I want to revisit the sweep helper's SPL transfer invocation to check the account ordering passed in.

Tracing through the transfer and close-account account metas, I confirm they match the expected layout — source/destination/authority for the transfer, and account/destination/owner for close, with rent correctly routed to the wallet. I also verify the lamport transfer via system instruction uses the right signer/destination/program accounts. I note the helper doesn't verify that `dest` or `src` are writable, but that would just cause the CPI to fail on the caller's end rather than being a security issue.

Now I'm shifting to check whether anything besides the plain owner — like an update authority, delegate, or plugin authority such as SEAL's PermanentFreezeExecute PDA — could authorize an ExecuteV1 call. I'm tracing through Core's validation logic for each plugin during execute, specifically looking at how PermanentFreezeExecute's validate_execute behaves when the asset is thawed versus frozen.

Even if Core would approve the freeze authority's Execute call, SEAL never issues a CPI that invokes Core's ExecuteV1 — it only calls UpdatePluginV1, and nobody else can sign for SEAL's PDA. So this gap is unreachable in practice, even though no explicit test arm covers it.

For R1s(c), I'm confirming the destination isn't checked against the asset owner, but since a hostile page with the owner's signature could already drain funds via ordinary instructions, the helper doesn't add new capability for the vault specifically. It does, though, make draining any signer's tokens and SOL into a single compact, unauthenticated instruction — a meaningful convenience for phishing even if not a new attack surface for this particular vault design.

Crucially, since the helper is the only unauthenticated value-mover in this deployment and its logs tag it as CBOB_SWEEP, any incident would get attributed to CBOB. I'm inclined to file this as LOW, noting honestly that it grants no new capability over standard transfer calls — but let me double check that claim. The amount and balance are both read at execution time, so I'm working through whether a phisher could exploit that timing to drain more than a pre-signed transaction with explicit amounts would allow.

Actually, yes — a durable nonce-signed transaction using this helper becomes a balance-agnostic drainer that siphons whatever the victim holds whenever the attacker chooses to submit it, unlike a fixed-amount pre-signed transaction. That's a genuinely new, if modest, capability, so LOW severity feels right. Since the program is immutable there's no fix, but I could suggest binding execution to Core's ExecuteV1 instruction as a pre-launch mitigation, which would harden this by design rather than relying on Core's rules — though I need to check whether that binding would break anything else.

I'm now checking whether requiring the top-level instruction to be Core's ExecuteV1 would actually work: since redemption always goes through Core at the top level, the helper could check the instructions sysvar to confirm the program ID matches Core, which holds for the canonical flow and would only break a hypothetical wrapper (none exists). But this requires passing the instructions sysvar as an extra account, costing roughly 33 bytes, and the packet only has 23 bytes of headroom in its widest shape — so the fix doesn't actually fit, which is worth noting honestly.

I'm also considering weaker alternatives: making dest a signer doesn't work since it never signs; deriving a PDA check isn't possible without knowing the asset; checking signer ownership by the system program doesn't help since ordinary wallets also satisfy that; and requiring signer to differ from the fee payer doesn't obviously solve anything either.

Given this, the honest recommendation is to either accept the current approach or add Core binding and move the page to v0, noting the byte cost either way.

Now I'm checking whether there's a DoS vector where a vault's attributes can't be read back by the crank after minting. Since attribute values are Rust Strings requiring valid UTF-8, Borsh deserialization would reject malformed instruction data upfront, so everything stored is already valid UTF-8 — meaning this isn't actually an exploitable gap.

I'm also checking whether a minter could craft an attribute long enough to blow past the reveal transaction's size limit. The tests confirm 640 bytes of attributes still reveals fine in a legacy transaction, and 641 bytes gets rejected at mint time, so that boundary is properly enforced — though I want to verify the reveal instruction doesn't carry additional payload that could push it over regardless.

Checking `check_attributes` against `write_record`: since check_attributes permits up to 1,848 bytes across 7 key-value pairs while MAX_ATTR_BYTES caps it at 640, it's possible for check_attributes to pass but write_record to fail with AttributesTooLarge — after the Core CreateV2 CPI already executed. But since mint_vault's ordering runs payment before create_vault and write_record after, any failure there reverts the whole transaction, so it's just wasted compute rather than a real vulnerability. I also confirm payment occurs before create_vault, so a failed creation properly reverts the payment too.

I'm also verifying check_supply runs before payment, and that minted_this_round/minted_total increment correctly using the pre-increment index for write_record, matching revealed_total's FIFO ordering. Charter claims increment minted_total but not minted_this_round, which is correct since charter claims shouldn't consume round cap, and check_supply correctly validates against both max_supply and cap_total for both charter and paid mints — now I want to sanity-check GOV's read_mint_config next.

I'm tracing the initialization dependency order: SEAL must come first, then MINT (which reads SEAL's config), then BURN (which needs only SEAL), then GOV (which needs MINT's config). But I notice nothing enforces that BURN gets initialized before MINT's retire_redeemed can be called — if BURN is never set up, redemptions become permanently impossible and vaults stay sealed, which is a real launch-sequencing risk worth flagging.

I'm also checking GOV's initialize — it doesn't verify BURN's config exists, yet create_proposal reads it, so skipping BURN initialization would make proposal creation dead on arrival. Since the launch checklist initializes all four programs in order, this is informational rather than a bug. I then verify the quorum_supply math in create_proposal (minted minus burned minus bare_retired with checked_sub) can't underflow since burned can't exceed minted, and confirm the index_snapshot logic correctly blocks newly-created vaults from voting on existing proposals.

Now I'm confirming cast_vote and execute_proposal timing checks are correct — votes require now < voting_ends_at, execution requires now >= voting_ends_at. I'm also trying to verify the prompt's claim about a byte-identical build comparison against the certified binary; since I can't actually run a build, I reason instead about whether MINT's added test module would affect the compiled SBF output, since test-only code gated behind cfg(test) shouldn't be included in the release build.

I'm now reconsidering whether GOV's comment-only changes are truly neutral: Anchor's `require!`/`error!` macros embed the source file name and line number into error values via `file!()` and `line!()`, which means shifting line numbers by adding comments would actually alter the compiled binary, contradicting the claim that GOV's changes preserve byte-identical output.

So I'm checking whether the edits were carefully constructed to keep line counts and error-site positions unchanged, which the validation doc's identical-artifact claim implies. I'm inspecting the bundled GOV source's comment block near MAX_ACTIONS to see if it reflects such a line-preserving repair.

But the only evidence offered for this claim is a local `cmp` noted in a markdown file, not an actual CI gate — the repeatable `build-mainnet.sh` script compares the sweep helper against target/deploy but never checks against the previously certified bytes.

The validation doc does assert that a fresh mainnet-feature build was compared byte-for-byte against the certified dist artifacts from the earlier commit and all five matched, confirming the post-repair source produces identical bytes to the pre-repair certified ones. But since nothing enforces this automatically, it's a real evidence gap — the claim that no deployed program logic changed rests entirely on a manual check, not an automated gate.

I'll flag this as a low-severity evidence/process finding: these programs should have a pinned-hash gate similar to what Core already does, so a comment edit that shifts a line in an Anchor error check gets caught by the build itself rather than relying on a hand-run byte comparison recorded only in prose. A practical path would be having the build script emit checksums and a manifest tied to the commit, with a gate comparing against a committed pinned checksum file that gets deliberately updated on legitimate changes.

On the deeper question of whether the test suite actually exercises the same logic as the certified mainnet artifacts — it uses a different build feature flag with a different init authority, so the bytes necessarily diverge; the build script only proves behavioral equivalence for the authority check specifically, which is an acceptable, long-standing limitation.

Now I want to push harder on the strongest finding available: re-examining the helper's check for closeness to the destination and the burn's zero-lamports check on the asset signer, specifically when the destination is the asset-signer PDA of the same vault. The helper blocks the signer key from equaling the destination key directly, but I'm probing what happens if the destination is instead a token account owned by that asset-signer PDA — tracing through whether the ownership field comparison still holds in that case.

Working through the logic: if the destination equals the PDA, that creates a contradiction with the earlier constraint that the signer can't equal the destination, so the destination must actually differ from the PDA — meaning close operations and lamport transfers all correctly route to a non-PDA destination, which seems fine.

I also want to check what happens if the destination is set to the SPL Token program's address or the System program's address instead. Since anyone can initialize a token account with an arbitrary owner field, it seems constructible to form token account pairs where the owner field points at the token program's pubkey itself, which opens up a path I need to trace through for the lamport transfer logic.

During the CPI, config's data isn't actively borrowed since Anchor holds a deserialized copy, and pool_token being an UncheckedAccount means no borrow conflict when the token program mutates it. So the invoke_signed call itself looks safe from a borrow-checker perspective, leaving the state update on owed_scaled after the loop as the next thing to check.

I'm also checking whether account substitution could bypass the record validation — passing a record account as config fails discriminator checks, passing pool_token as a record fails the owner check, and passing config as dest fails the SPL token owner check or the ATA equality check before any payout occurs. All these substitution attempts seem to be caught by existing validation.

store_record writes the discriminator plus serialized data into the account's buffer, leaving any trailing padding bytes untouched — that's fine since the record struct size is smaller than the account allocation. I'm now considering whether the same record could appear in both the crank's batch and the pair list used in claim, which could create a double-processing risk worth tracing further.

The pair path re-loads the record fresh from the account after the crank writes its capture, so it correctly observes the captured state and skips it since it's no longer active — meaning there's no stale overwrite there. I'm also checking what happens in mint_vault/claim_charter_vault and activate flows where the Anchor-managed vault_record coexists with the crank's raw writes, since Anchor's final serialize-on-exit could clobber whatever the crank wrote earlier, and I want to confirm whether any reachable code path actually hits that conflict.

Looking at activate specifically, it only proceeds when the record is already pending or has a nonzero level — both cases the crank would skip — so the only scenario where the crank would try to write is level 0 with no entropy set, which causes activate to revert with NotRevealed anyway. That means the outcomes are strictly "crank skips" or "transaction reverts," so there's no silent data loss there. I'm now also verifying the ordering in activate between the crank call and monthly_inline to make sure nothing is touched inconsistently between the two.

I'm confirming claim and mint_vault follow consistent orderings between crank and monthly_inline as well, then moving through the because() list checking that each pinned error actually fires for the right underlying constraint rather than coincidentally matching.

`WrongTreasury` catches a caller-supplied source account, `ReserveDelegated` catches a planted delegate with the ATA left open, and `VaultAccountMissing` in P.21 checks out since the prior sweep call defaults to closing the account, leaving it system-owned so the token-owner check fails as expected. Now I'm verifying the SR.3 case tied to the Tokenkeg program error code 0xb.

I'm checking case 9.13, where reusing a vault_record PDA should hit the system program's already-in-use error on init. Then I'm scrutinizing the R.4 case, where plugin kinds are detected via a regex over known plugin names — a gap I want to flag is that any new Core plugin type not matching that regex pattern would silently go undetected.

I'm also tracing the OR.5! identifier through the uniqueness check, which excludes ids ending in '!' from its map, and I'm verifying whether a plain 'OR.5' case exists elsewhere that could collide once the exclamation mark is stripped.

This check also looks sound since the epoch is read before the attempt in a single-threaded sim, so no race is possible given the 49 paid mints already completed via monthly_inline beforehand.

Now I'm checking whether S9b can actually fail, which requires specific cap conditions on consecutive live vaults — I need to trace the vault count after S5's 51 vaults minus any burns to see what "live" resolves to.

Then I'm verifying S9b's timing wait relative to S8's redemption window.

Moving to Sim S10, I'm examining which of carol's vaults are actually empty versus funded, since CV[0] through CV[2] have different states (nested, in, burned) and I need to determine the funding status of CV[3..6].

Checking that these unfunded vaults' PDAs have zero lamports and no token accounts, so opening and burning with nonexistent ATAs should work fine, including the signer and helper call structure for S8's reserve pairs since all three of TV's reserve ATAs were funded earlier in S3.

The stray junk ATA isn't declared in the helper's pairs or the burn, meaning it's left for the redeemer to abandon, which matches the suite's intent. Now I'm checking the SR.4 case where T only has a single cbBTC ATA pair declared, since SEAL was initialized with just that one reserve mint.

I want to verify the revenue split logic holds at 85/15 with the bank cut computed correctly, that the SOL sweep stays bounded, and that claim payouts only flow from program-created records—so I'm checking whether debt_scaled could be manipulated outside the program's own control.

Tracing through `reweigh`, which gets invoked by `boost_vault` and `expire_boost`: since boosting requires burning tokens and the weight must start at zero, repeated boosting isn't trivially exploitable. When a boost expires, the carry preserves the owed amount at the boosted weight before resetting debt to the base rate, so the vault correctly keeps what it earned. I'm now checking whether a vault could somehow get credited twice for the same distribution, looking at how the accumulator increments relative to each vault's owed calculation.

I'm then probing whether `total_active_weight` could ever be understated, since that would cause the pool to systematically overpay relative to its tracked owed total. I'm tracing every place a vault's weight could change — level is fixed after reveal, boost_weight only changes inside `reweigh` which updates the total, and retire removes the full weight — to confirm the sum invariant always holds.

The invariant holds there too. Checking claim's debt_scaled calculation, it correctly orders the expire_boost reweigh before computing pending, so the carry ends up matching owed_before, and the subsequent payment settles correctly. I also want to verify that claim reads acc once before the loop while expire_boost internally uses its own epoch and acc values via owed_of.

Since nothing in the loop mutates acc_scaled, these stay consistent. Now I'm checking pool_is_frozen's interaction with retire_redeemed: if the pool is frozen, retire skips the ClaimBeforeBurn check and subtracts pending from owed_scaled. I also want to consider the edge case where the pool account doesn't exist at all—pool_is_frozen would return false since the owner check fails, meaning forfeit is false and redemption requires pending to be near zero, which makes sense since no distribution would have occurred and acc would be zero.

I'm double-checking the account length validation logic and a comparison between a byte slice and a single-element array, making sure Rust's PartialEq implementations actually support that comparison syntax.

Then I'm reconsidering whether the burn vault's lamports check truly reflects what the sweep instruction leaves behind — since nothing else executes between the Core Execute and burn instructions within the canonical page, it should see the correct post-sweep state, but instruction ordering still matters here.

Checking instruction order: the sweep must run before the burn, otherwise the burn simply fails with a nonzero-lamports error, which is fine since nothing enforces position beyond that natural failure mode. I also note that burning refunds the asset account's rent to the payer, but the emptied asset-signer PDA becomes a dangling system account — not something that matters for this analysis.

Now I'm verifying the asset_signer constraint for the burn instruction, confirming it derives the canonical bump under the correct seeds and program ID, matching both Core's asset signer PDA derivation and the mint's activate logic. With that confirmed, I'm ready to start drafting the report, beginning with the round 25 repair findings.

N2 mostly holds up under review — I've checked that P.11a can now fail, S7.4 is narrowed, RL.7 is stamped, the K.7/BO.36 crank overlap, BO.37's frozen expiry, S9b's two redemptions, and the 8.14b tightening are all accounted for. The remaining gap is the five round-24 ship-gate-5 pins covering owner adapters, Brakes defaults, activate with its own record, the distribute/boost pairing, and v0+LUT — all five check out, along with the W1 item I'm still tracing.

Now I'm verifying that the 5.2 and 10.2 titles weren't altered beyond rewording — 5.2's title about an unsigned PDA owner and 10.2's about a byte-padded mint staying under the CU ceiling both read correctly, and S7.2 is pinned to a single reason as expected.

N2's repair looks complete with decoded state present. N3 checks out with SR.5-5e non-vacuous, and N4 has SR.6-14 present, though I notice there's no arm covering a source with a close authority (which would hard-fail redemption) or a frozen destination — minor gaps worth flagging, though the "destination appears twice" case actually works fine without a dedicated arm since both transfers into the same destination close correctly regardless of source. N5 looks fine, and N6 now properly compares target/deploy and logs hashes during build-mainnet, so I'm moving on to check run-tests.sh next.

Run-tests.sh does log the hashes per program during step 5, and the wrapper checks out too. But D1's repair introduced a genuinely new false sentence — the claim that "vaults sold during the vote cannot vote on it" — which is my headline documentation finding. There's also a low-priority gap around enforcing that no deployed program logic was intended to change, and the rehearsal-tree.sh header still references "four ids / five substitutions" even though that class of fix only got applied to the spec, not the script itself.

The actual rule is that a transferred/sold vault whose vote hasn't been cast yet CAN still vote under its new owner — what's actually barred from voting is a vault minted after the proposal was created, per the VaultTooNew check in governance. So round 25's D1 repair swapped in the wrong word; the suite already covers the inverse case (a vault that voted then got transferred can't re-vote), and the mint-index tests confirm the real rule. The corrected sentence should read "vaults minted during the vote cannot vote on it." I'm also noting that limit 47 appears worse than currently documented.

The "half of all live vaults" quorum bar is actually exploitable by whoever is being voted out: since quorum_supply snapshots at proposal creation from live supply, minting vaults before the proposal opens raises the YES threshold by 0.5 per vault while simultaneously adding a NO vote for the attacker. At the sat floor this makes raising the bar by 50 votes cost only around $1,800, and the guardian with minting power can simply keep sales open to pull this off, then halt sales whenever convenient — meaning the "permanent stop from passive low turnout" framing in limit 47 ignores that this is also a cheap, deliberate attack vector while capacity remains.

I'm tracing the exact code paths responsible: the quorum snapshot taken at proposal creation, the need_key computation, and the mint_vault function which only requires an open round to mint. I'm thinking through how to test this — snapshotting supply before and after N mints to confirm need_key rises by ceil(N/2) — and weighing fixes: denominating the bar against the active electorate doesn't help since that's equivalent, requiring both snapshot and cast-vote majorities doesn't close the gap either. The more honest fixes are capping a round's cap relative to supply, computing need_key from the minimum live supply during the voting period, or simply documenting the risk explicitly in limit 47.

Then I sanity-check the economics: since a vote sets the round price ≥21,000 sats and an open round already has spare cap, an attacker doesn't need a cheap round — they can buy real vaults at market price and resell them, making the attack to inflate need_key nearly free in expectation. That confirms this is a genuine structural weakness of "half of all live supply" versus "half of votes cast," and I settle on rating it MEDIUM severity, though I want to double check whether opening a new round changes this calculus.

Checking further, I confirm that `cast_vote` only requires the asset to be live and the index below the snapshot — no activation or revelation needed — so a freshly minted, unfunded vault can vote immediately, meaning the attack only costs the mint price. This also inflates `quorum_supply` for ordinary proposals symmetrically, so I'm confirming MEDIUM for this issue and moving to the next: a LOW-severity finding about an unauthenticated, balance-agnostic sweep helper that's usable in any transaction.

The sweep instruction's only check is `signer.is_signer`, meaning while it doesn't grant new capability beyond what a compromised owner signature already allows, it does let an attacker pre-sign a drain of whatever the victim holds at execution time rather than a fixed amount, and this gets attributed to CBOB. I'm weighing fix options, starting with requiring the enclosing instruction to be Core's `ExecuteV1` via the instructions sysvar, noting the added account cost in bytes and how that interacts with legacy transaction size limits.

Separately, I'm flagging that `initialize` caps the charter window at 90 days but sets no minimum window length and no minimum lead time before it opens — a one-second or already-open window would be accepted and permanent, which is dangerous since the charter claim is the only path to creating a vault without a vote, making this a single point of permanent failure unlike every other time period in the system which has an enforced floor.

At the widest legacy shape, the packet is already near full, leaving zero bytes for extra pairs since each additional (source, destination) costs ~66 bytes. Rescuing a stray token would require dropping the separate fee payer or compute-budget instructions, or switching to a v0 transaction with a lookup table — so I should flag this gap in item 50 and suggest the v0 path as the fix.

There's also a lower-severity gap: nothing actually enforces that deployed program logic stays byte-identical across comment-only edits, since Anchor's error macros embed file and line info that shift when comments change. The only proof that a past comment edit (ba67127) was byte-neutral is a manual cmp recorded in a validation doc — the build script only pins Core's hash and compares the sweep helper, not the full artifact set. The fix is to commit a pinned SHA256SUMS file as a hardcoded expectation, just like Core's hash is pinned.

Looking further, I notice `rehearsal-tree.sh`'s header documentation is stale — it describes four ids and five substitutions, but the actual code now maps five ids plus the root (six total), a mismatch left over from a spec correction that wasn't propagated to the script.

I also catch a numerical inconsistency: the effective rolling-hour cap at 2,100 live vaults is actually 44, not 45, since the cap gets recomputed from the shrinking live supply at each redemption step and rounds down to 44 at that point — stricter than documented, so not dangerous, but the stated figure in the spec and guide is off by one.

Finally, I'm noting that no code path handles the case where a reserve or stray source account has a close authority set, which would cause SPL's CloseAccount instruction to hard-fail the entire redemption.

Actually the real beneficiary isn't just the vault's minter — a lapse rerolls the whole downstream census, and it's the crank operator who's best positioned to exploit that selective capture, so limit 25 understates whose withholding ability matters versus whose gain gets named. I'll also double check the guide's claim that "only you can open it" holds up given the Gary Club wallet caveat, and it does seem accurate as stated.

Checking the next guide line about pool routing — "trades only through fixed pools with Meteora as fallback and refuses any price below a Pyth-derived floor" — this matches the honest list's 150 bps (1.5%) threshold, so it's fine. Same with the guardian/swap-bot key replacement clause: the "week's public notice" matches notice_secs of 7 days, so that checks out too.

I also want to verify the "Who can do what" table's community vote entry, which mentions setting or switching off $CBOB boost terms within launch limits and restarting sales after an emergency stop, but leaves out TightenSweep — a minor omission since the honest list only says a vote can make the limit smaller, not larger. And the Gary Club entries look consistent: the disclosed 7-day charter window key limit of 46 matches, and its "cannot" clause about changing rules or moving vaults in wallets it doesn't hold a key to lines up with the separately listed swap operator and $CBOB release wallet permissions under "can."

Checking the claim that nothing leaves the vault while closed — true for the PDA's contents, though selling the NFT itself isn't a contradiction. The "opening is all or nothing" claim about cbBTC, $GARY, $GIRAFFISH and SOL all coming out as the vault is destroyed also holds, assuming the helper sweeps lamports and the reserve accounts exist. Now I want to check the claim about what happens if Coinbase freezes the vault's cbBTC.

Freezing cbBTC blocks the whole opening, since BURN requires the cbBTC reserve ATA to be empty and a frozen account can't be emptied — any payouts owed stay owed. I'm now examining whether a tiny deposit sent into the vault mid-opening could block things, and it seems the redeem page handles this by first ensuring the three reserve accounts exist, then emptying everything atomically during the same opening step.

Now checking the P.11a rule text about requiring all five levels present, and tracing how `perLevel` gets built from `picks` mapped against the `got` array indexed by the ACT sequence.

So for IV (5k) it's 2x.5, and V (6k) comes out as 3x, confirming the expected string requires picks to be exactly one of each level in order I through V — which matches how byLevel and picks are constructed, so the repair holds even if a level is missing. Now I'm moving to check N2's "crank overlap" K.7 case for vacuity.

I'm verifying crankWrote correctly captures whether the crank actually did something — it's false if neither capture nor reschedule happened, so the arm is non-vacuous. One remaining risk I want to trace is the case where a vault has level 0 and no entropy set, triggering waitEntropy, and whether the crank still behaves correctly in that scenario.

For BO.36, since the crank skips drawn records, asserting the entropy stays equal is just a trivial negative control. For BO.37, I'm checking whether the polling loop could exit early due to the guard counter before reaching the target epoch, which would produce a spurious mismatch between expected and actual values since `c0.due` could still be zero.

Reconsidering severity for the medium #2 finding — I need to verify whether an attacker's newly minted vaults genuinely raise the key-change voting threshold without being able to vote themselves, since they were minted before the snapshot and thus contribute zero votes while still inflating the denominator. Working out the math: to block a replacement backed by honest votes H out of L live vaults, the attacker needs enough new vaults N such that the new majority threshold exceeds H, which with 60% honest turnout means N needs to exceed roughly 20% of L.

At L=2100, that's around 420 vaults costing roughly $7,500 in sats while the attacker keeps all those vaults, but if honest turnout is only 52%, the attack becomes dramatically cheaper — only about 84 vaults, roughly $1,500. Since a 50% quorum bar is already hard to clear, honest turnout will likely sit just barely above that threshold, making this marginal attack cheap in practice, confirming the medium severity rating — though I should note it depends on an open voting round with spare capacity and sales not being halted, plus the minting overhead of creating distinct asset records with rent costs for each new vault.

Since vaults must exist before the proposal snapshot, an attacker can't mint them reactively to block a vote — they have to pre-hold a standing block of vaults, which just restates the general truth that any majority holder can block changes forever. The sharper point is really about marginal leverage and the surprisingly cheap floor price for assembling that blocking power, so I'll frame my finding as an accepted-limit issue where the concentration risk is actually worse than the spec acknowledges, and now I want to verify whether the guide's existing language about requiring "yes" votes from half of all vaults truly covers this scenario.

I'm checking whether the spec's reassurance that vaults minted *during* a vote don't raise the quorum bar also implies anything about vaults minted *before* the vote — it doesn't, and combined with the fact that an ordinary proposal can open a round with a tight cap at a low floor price, the spec has all the pieces needed to see the problem but never actually draws that conclusion. So I'm confirming this is indeed worse than stated.

Now I'm doing a final pass over the sweep helper logic, checking edge cases like whether the destination could equal the source, whether duplicate destination accounts across pairs cause issues, whether transfer overflow is handled by the SPL token checks, and what happens when the source account holds a zero balance.

I'm also considering what happens if a zero-balance source is a native wSOL account holding extra lamports (closing should correctly return everything to the destination), and whether the signer account could itself somehow double as a source token account (it can't, since it lacks the right data layout). Then I start probing a trickier case: what if the destination account is itself one of the token accounts being swept, and whether a token account could be initialized with its owner field pointing back at itself, which would bypass the ownership check.

Working through this self-owned token account scenario, I conclude it's just an unusual but valid configuration -- tokens and the lamport sweep all land correctly in that account, with no actual exploit since it's the caller's own deliberate setup. This confirms the helper's logic holds up correctly for its intended purpose.

Checking whether the helper could leave a reserve account open with zero balance for BURN to later encounter — no, it always closes properly, and the native-balance edge case is already handled. If the page only lists two of three reserve accounts while a third sits with zero balance, BURN's reserve loop still validates it fine, though its rent stays stranded forever since nothing can sign for the PDA afterward — but that's already tracked separately.

Weighing severity now, the key-change bar inflation stands out as the strongest issue, rated MEDIUM, since nothing else lets value leak from a sealed vault or breaks the pool invariant — so no CRITICAL or HIGH findings here. Double-checking the claim and activate paths for epoch and vault-token mismatches, both appear properly guarded.

I also confirm vaults can't double-pend, retire can't trigger on an impossible epoch state, and advance_epoch correctly resets pending_this_epoch while leaving pending_count untouched if a vault hasn't joined — matching the intended blocking behavior.

Now I'll move on to writing up the report and addressing the remaining questions about acc...

Going through the accepted limits one by one, I'm checking which are actually worse than stated, which are no longer valid limits, and which might already be closed by other findings. Limit 47 lets the bar be bought, limit 25's beneficiary set is wider than claimed, and limit 32's stated threshold is actually off by one in the stricter direction. I'm also checking whether limit 44's Token-2022 concern is still accurate given what round 25 established about ATA creation for classic mints, and whether limit 42's redemption scenario holds up.

Now I'm re-measuring whether creating three destination ATAs in a prior transaction actually fits within the transaction size limit, now that the sweep uses a smaller helper (1,061 bytes vs the old 1,153+). Since the destination ATAs are already present in the account list as the helper's "to" accounts, each idempotent creation instruction only needs its program index and account indices rather than new keys, so the math comes down to three instructions worth of overhead against the freed-up space.

I should flag this as something to measure rather than assert outright. Even if the ATA byte count fits, the prior transaction might still be needed when vault-side reserve accounts are missing, so limit 42's requirement could survive for that separate reason — though in the common case where those accounts already exist, the helper might actually discharge it. This seems worth reporting as an INFO note: measure the byte count, and if it fits, the page may collapse to a single transaction in the typical case.

Now checking whether any DISCHARGED items weren't actually fully resolved — item 54 on compute at widest host shapes is marked DISCHARGED, but its own notes mention a one-capture mint run that hit exactly 200,000 compute units and failed in a real test suite.

But no test measures a charter claim with one capture under the default budget, and the holder-page rule (pob_extra > 0 → no crank) doesn't address the pob_extra == 0 crank case. Given that a charter claim is heavier than a mint and the lighter-host mint figure already hit 188,594, a charter claim with captures under default budget is likely to exceed 200,000 — this needs either measurement or a rule change so the claim page never sends a crank.

Going through the remaining items: the $CBOB boost and the compute items are discharged with caveats noted, the notice branch and items 30/31 are exercised, and the v5 items are gone along with the Bank. Checking for open blocking items being quietly treated as accepted — item 22 (no live-chain distribution run yet) remains open and un-demoted, and item 38 is still open with two null values, though the missing program floors from my earlier finding are being folded into item 38 rather than tracked separately.

Item 50 stays open since the holder guide is still draft with a publication bar, though its present-tense claims remain a risk if published. Items 52 and 53 are correctly open too, with item 53's rehearsal proof stale and the validation doc confirming the tree was only prepared, not run.

With that review done, I'm moving to the final section on what the project should do that AI audit structurally can't cover.

Before writing it up, I want to double-check finding #1 about the guide's transferred-vault-votes claim. Looking at the vote record PDA structure, each asset can only vote once per proposal, and whoever owns the asset at vote time is the signer — so if a vault hasn't voted yet and gets sold mid-voting-window, the new owner inherits the ability to vote. That confirms the transfer scenario in tests 7.8/7.9 is accurate.

I also need to verify the already-voted case is distinct — transferring an already-voted vault should block the new owner from voting again, so the test suite is proving the already-voted scenario, not the not-yet-voted one. My actual claim is that a sold-but-unvoted vault can still vote, and the evidence would be a test that transfers an unvoted eligible vault mid-vote and confirms the new owner's vote gets allowed.

I'm also confirming that the quorum calculation — minted minus burned minus bare-retired at creation time — correctly represents "all vaults that exist when the vote opens," which matches the guide's phrasing closely enough.

Now I'll write up the full findings, organized by target with supporting evidence for each, aiming for something thorough but still readable.

