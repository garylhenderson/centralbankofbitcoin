[reasoning only]
Let me carefully audit this system. The user wants me to find faults across six target areas, then answer four questions about accepted limits, then anything else. I need to be adversarial — assume the author is wrong until proven otherwise. But I also need to be careful not to invent findings (a wrong CRITICAL costs real engineering time).

Let me go through the targets systematically.

**R1. THE CRANK (`bank/crank.mjs`)**

Looking at `planCrank`:
1. Reschedule: checks `BigInt(slot) > rs + BigInt(L.REVEAL_WINDOW_SLOTS)`. The program requires `now > r.reveal_slot + REVEAL_WINDOW_SLOTS` (`reschedule_reveal`). The crank's check matches: `BigInt(slot) > rs + window`. Good.

2. Capture: `slot > readySlot(r.reveal_slot)`. `readySlot` computes: `a = revealSlot; for 2 iterations: a = (floor(a/4) + 2) * 4`. The program's `try_capture` needs three hashes: A at/after `reveal_slot`, B at least 2 leader groups after A's group, C at least 2 groups after B's group. The crank's `readySlot` returns a slot after which all three exist... let me check. The program computes `want = (slot /4 + 2) * 4` after each hash. So after finding A at slot sA, want becomes (sA/4 + 2)*4. B is at/after that. Then want becomes (sB/4 + 2)*4, and C is at/after that. The crank's `readySlot` starts from `revealSlot` and applies the group-stride math twice. But that's not quite right: the program's `blockhash_in_window` finds the smallest produced slot in [want, want+MAX_SKIPPED_SLOTS]. If reveal_slot itself is produced, then A = reveal_slot. readySlot(revealSlot) computes: a = revealSlot; step1: a = (floor(revealSlot/4)+2)*4; step 2: a = (floor(a/4)+2)*4. Then `capture` if `slot > readySlot(r.reveal_slot)`.

Hmm, but the program's try_capture needs `now > reveal_slot` (NotYet if `now <= reveal_slot`), and then it needs all three hashes. The question is whether readySlot correctly predicts when all three exist. If reveal_slot = 1000. readySlot: a=1000; step1: a = (250+2)*4 = 1008; step2: a = (252+2)*4 = 1016. So readySlot = 1016. The selftest asserts readySlot(1000) = 1016. In the program: A at/after 1000 → if slot 1000 produced, A=1000. want = (1000/4+2)*4 = (250+2)*4 = 1008. B at/after 1008 → if 1008 produced, B=1008. want = (1008/4+2)*4 = (252+2)*4 = 1016. C at/after 1016. So C = 1016 if produced. The crank captures if `slot > 1016`, i.e. slot ≥ 1017. But at slot 1016, does SlotHashes contain slot 1016? SlotHashes contains ancestors only — the comment says "SlotHashes holds ancestors only, so a slot below `now` that is absent was SKIPPED on this fork". So at `now = 1017`, slot 1016 is an ancestor and would be in the sysvar. So capture at slot1017 works. But wait — the program's `try_capture` is called with `now = Clock::get()?.slot`, and it looks up `blockhash_in_window(sh, want)` which searches the sysvar. At now = 1016, slot 1016 is the current slot and is NOT in the sysvar yet (it's not an ancestor). So C wouldn't be found at now=1016, and the crank correctly waits for slot > 1016. But actually at now = 1017, C = 1016 is an ancestor. OK.

But hold on: what if slots are skipped? The program says "skipped slots only push it later, and a NotYet answer is harmless". Fine.

Actually wait — there's a subtlety. `readySlot` computes the group stride from `revealSlot` itself, not from the actual produced slot of A. If A is at reveal_slot itself (not skipped), then readySlot is right. If A is pushed later because reveal_slot was skipped, then B and C are also pushed later. So `slot > readySlot(reveal_slot)` is a necessary-but-not-sufficient condition — the crank may attempt capture and get `RevealTooEarly` (NotYet → RevealTooEarly error). Actually `capture_entropy` returns `RevealTooEarly` for NotYet. The crank would `run(...)` and log a FAIL. Is that a problem? It wastes a fee. Hmm — the task says "Find a plan the program will refuse (wasted fees, false pages)". So a capture attempt that gets `RevealTooEarly` when slots are skipped... Actually no: if reveal_slot was skipped, then A is later, so all three hashes are later, so at slot = readySlot(reveal_slot)+1 the chain hasn't produced C yet... wait, no. If A is at reveal_slot + k (skipped k slots), then want after A is (floor((reveal_slot+k)/4)+2)*4, and C is at/after that. readySlot(reveal_slot) assumes A = reveal_slot. So if A is later, C is later too, and at slot readySlot+1, C may not exist. Then `blockhash_in_window` returns None for C, `try_capture` returns NotYet, `capture_entropy` errors `RevealTooEarly`. The crank logs "FAIL capture <addr>: ..." and pushes to failures → NOTIFY. So a skipped slot near the reveal window produces a wasted fee and a false alarm page ("CBOB crank: N action(s) failed"). That's a real finding: a routine state (skipped slot) that makes the crank waste fees and page.

Hmm wait, but is it routine? Solana skips slots fairly often. Actually the reveal window is 300 slots. The three hashes span about (2*4)+(2*4) = 16 slots from A to C minimum. If a slot in that span is skipped, then C is pushed. Let me think again: `blockhash_in_window(sh, want)` searches for the smallest produced slot in [want, want+64]. So B is at/after the computed want, and skipped slots within64 are absorbed. So if A = reveal_slot = 1000 and 1008 is skipped, B = 1009 (if produced). Then want for C = (1009/4+2)*4 = (252+2)*4 = 1016. Hmm1009/4 = 252 (integer division), +2 = 254, *4 = 1016. So C at/after 1016. readySlot assumed A=1000, B=1008, C=1016. With1008 skipped, B=1009 → group 252 → same as 1008's group 252. So C's want is the same. Actually the group stride is computed on the actual produced slot. If a slot is skipped but the group is the same, the want is the same. If the whole group is skipped... e.g., A=1000 (group 250), want for B = (250+2)*4 = 1008 (group 252). If slots 1008-1011 all skipped, B = 1012 (group 253). want for C = (253+2)*4 = 1020 (group 255). readySlot(1000) = 1016. So at slot 1017, C's want is 1020, not yet produced → NotYet → RevealTooEarly. The crank sends capture, wastes a fee, pages. Hmm, but is that a "routine state"? Whole leader groups being skipped is not super common but happens. Actually, also: `blockhash_in_window` looks for slot in [want, want+64]. At now=1017, slots up to 1016 are ancestors. C's want is 1020. Not in the sysvar. NotYet. So yes, capture fails with RevealTooEarly, fee wasted, `failures.push('capture <addr>')`... wait, no: capture uses `run(...)` which pushes label to failures on failure. Then at the end, failures.length > 0 → NOTIFY and exit code 1. So a skipped slot group causes a false page. That's finding material — MEDIUM maybe. It's an operational nuisance, not a money bug.

Hmm, but wait. Actually let me re-check: is `readySlot` even used correctly? `readySlot` is described as "The slot after which all three entropy slot hashes exist on a fork that skips nothing". So on a fork that skips something, the answer is "later, and a NotYet answer is harmless". But it's NOT harmless in the crank: a NotYet becomes a failed transaction (RevealTooEarly), a wasted fee, and a page. The crank's `send` catches the error and pushes to failures. So the comment "a NotYet answer is harmless" is wrong for the crank's usage. This is a real fault: `readySlot` is optimistic, and the crank does not handle `RevealTooEarly`/`RescheduleTooEarly` as benign. Evidence: on a run with a skipped slot group, `capture` instructions fail with `custom program error: 0x...` (RevealTooEarly), `FAIL capture ...` lines in the log, `CBOB crank: N action(s) failed` SMS. Fix: treat RevealTooEarly as benign (skip, retry next pass), or compute readiness from the actual produced slots (read SlotHashes in the crank before planning).

Actually — even worse: the program's `crank()` helper (the opportunistic one riding on host instructions) SKIPS (`continue`) on NotYet, and only reschedules on Expired. So on-chain behaviour is benign; the off-chain crank's behaviour is what's faulty. Good.

Also, a reschedule is planned when `BigInt(slot) > rs + BigInt(L.REVEAL_WINDOW_SLOTS)`. The program requires `now > reveal_slot + REVEAL_WINDOW_SLOTS`. `rs + 300` with `slot >` that = `slot ≥ rs+301` = `now > reveal_slot + 300`. Matches.

Wait, `REVEAL_WINDOW_SLOTS` in layout.mjs is 300 and in Rust is 300. Good. `REVEAL_LEAD_SLOTS` = 16 both. Good. `MAX_CRANK` = 4 both. Good.

3. Reveal in mint order: The loop `for (let i = BigInt(cfg.revealed_total); ; i++)`. `byIndex` is keyed by `BigInt(r.mint_index)`. It breaks if `!r || r.level !== 0`. Hmm: if the record at index `revealed_total` has level !== 0, that means it was already revealed but `revealed_total` hasn't advanced... that's inconsistent state. But wait: if `r.level !== 0` the loop breaks — but the program's `reveal_level` requires `index == config.revealed_total`. If a record already has level != 0 and revealed_total points at it, the program would reject with `AlreadyRevealed`. Actually `require!(ctx.accounts.vault_record.level == 0, MintError::AlreadyRevealed)` comes first. So breaking is right, but the queue would stall forever. Hmm, is that reachable? reveal_level increments revealed_total when it writes level. So if level != 0 then revealed_total > index. So the loop at i = revealed_total should find level == 0. Unless... a burned vault: reveal_level writes level for burned vaults too ("A vault already BURNED still takes its draw"). So level is written regardless. OK.

The loop also breaks if `!(r.entropy_set || capturedThisPass.has(r.address))`. But then in the I/O section, for each reveal it reads attributes and checks the hash. If `assets[r.asset] !== 'live'`, `list = []` — but then `attrsHash([]) !== r.attrs_hash`... no wait, the hash check is inside `if (assets[r.asset] === 'live')`. For a burned asset, list stays `[]` and the reveal is sent with empty attributes. But the program for a burned asset SKIPS the Core write and the attribute hash check: `if !burned { ... hash check ... }`. So for burned, attributes are ignored. OK.

But here's a thing: `if (attrsHash(list) !== r.attrs_hash) { failures.push(...); break }` — the `break` stops the reveal lane. That's intentional ("a mismatch means this reader and the program disagree about the asset, which is a fault to report, never a reveal to retry blindly"). But `break` breaks out of the `for (const a of plan.reveal)` loop, so subsequent reveals are not sent. That's the FIFO stopping — that's correct per design (reveal must be in order). But note: the error is pushed to `failures` and the process continues to retire/join/distribute/etc. Hmm, the `break` only exits the reveal loop. So the crank will still send claims etc. Fine.

Now: `plan.reveal` is computed in `planCrank` by checking `r.entropy_set || capturedThisPass.has(r.address)`. But `capturedThisPass` is a set of addresses added when capture is PLANNED. In the I/O, captures are sent before reveals (the order in main(): reschedule, capture, reveal). So if the capture succeeds, the reveal can proceed. But if the capture FAILS (e.g. RevealTooEarly as above), the reveal is still planned and will be sent — and the program will try `try_capture` inline in `reveal_level` (since entropy_set is false), get NotYet → `RevealTooEarly` error. Wasted fee again. So one skipped slot → two wasted fees and two FAIL lines.

4. Retire bare burns: `for (const r of records) { if (!r.retired && assets[r.asset] === 'burned' && r.level !== 0) plan.retireBurned.push(r.address) }`. Note `r.level !== 0` — so a burned vault whose level is NOT yet drawn is not retired. Is that right? `retire_burned` doesn't require a level. Hmm, `retire()` checks `if r.active` (needs level for weight) and `if r.pending`. A vault with level 0 that was bare-burned before reveal... can it be active? No — activate requires level 1..5. Can it be pending? No — pending requires activate. So retiring a level-0 burned vault would just set `retired = true` and `bare_burns_retired += 1`. The crank skips it (level !== 0 required). But wait: GOV's live supply is `minted_total - burned_total - bare_burns_retired`. If a burned vault is never retired, `bare_burns_retired` stays low, so live supply is overstated, making quorum slightly harder... hmm, but `burn.burned_total` counts redemptions. A bare Core BurnV1 doesn't touch BURN or MINT. So live supply = minted_total - burned_total - bare_burns_retired. If a bare-burned vault is never retired (because its level is 0), live supply is overstated. Effect: quorum is computed against a slightly larger denominator → harder to pass. Not exploitable for gain. But also: `reveal_level` for a burned vault still takes a draw from the census (level_minted[li] += 1), and then... the crank would retire it once level != 0. So it eventually gets retired. But if the vault is burned BEFORE reveal and the reveal never happens (e.g. FIFO blocked)... no, the FIFO reveals it.

Actually hold on — why does the crank require `r.level !== 0` for retire? Let me think. Because the census: a burned, un-revealed vault still needs its level drawn (to keep the FIFO moving and the census exact). If you retire it first... retire doesn't clear the FIFO. Actually reveal_level doesn't check `retired`. So retiring a level-0 vault first is fine, and the reveal still happens later. Hmm, but `retire()` would set `retired=true` and `bare_burns_retired += 1`. Then reveal_level would still draw from the census and write level. So the crank's `r.level !== 0` guard means: a burned, un-revealed vault sits un-retired until its level is drawn. During that time `bare_burns_retired` undercounts live supply. Is that a problem? GOV's `quorum_supply` = live supply at snapshot. Overstated live supply → higher quorum bar → harder to pass. Conservative direction. Not exploitable. But it IS a divergence: the crank could retire it immediately. Actually wait — is there a reason? If the vault is retired before reveal... `retire_burned` doesn't touch level or revealed_total. And `reveal_level` requires `index == config.revealed_total` and `level == 0`. So it works either way. So the `level !== 0` guard seems arbitrary. It leaves `bare_burns_retired` stale until the reveal. Hmm, and if the vault was burned before its reveal, the reveal lane must still run for it (FIFO). OK. LOW.

Hmm wait, actually there's a subtle thing: `plan.retireBurned` includes vaults with level !== 0. What if a vault is burned and level==0 and its reveal window lapsed? Then `plan.reschedule` fires (level===0 && !entropy_set && window passed). The crank reschedules a BURNED vault's reveal — the program allows it (`reschedule_reveal` only checks level==0 && !entropy_set). Then capture, then reveal. So eventually level != 0 and it gets retired. OK, no stall. But the reschedule of a burned vault's reveal is a wasted fee? No — it's necessary for the FIFO. OK.

5. Activate: checks `r.level === 0 || r.active || r.pending || r.retired || assets[r.asset] !== 'live'` → skip. Then `tokens[r.asset]` must be state 'ok' and `>= L.ACTIVATION_SATS`. Note `tokens` for a non-active vault is keyed by `tokenAddr(r) = ataOf(payMint, signerPda(r.asset))` — the canonical cbBTC account. Good. And the program checks `require_live_vault`. But the crank checks `assets[r.asset] !== 'live'` where 'live' means `owner == CORE_ID && data[0] === 1`. Hmm — data[0] === 1 is `KEY_ASSET_V1`. OK.

But wait: the crank's `activate` instruction is sent with keys `[W(MINT_CFG), W(a), R(r.asset), R(tokens[r.asset].address), R(cfg.pool_ata)]`. The program's `Activate` accounts: config, vault_record, asset, vault_token, pool_token. Order: config, vault_record, asset, vault_token, pool_token. The crank sends: MINT_CFG (config), a (record), r.asset (asset), tokens address (vault_token), pool_ata (pool_token). Matches. And `crank(ctx.remaining_accounts, ...)` — the crank sends no remaining accounts for activate. OK.

6. Joins: `preJoins` — for `r.retired || r.active || !r.pending` → skip; `assets[r.asset] === 'burned'` → skip; `BigInt(r.request_epoch) >= BigInt(cfg.dist_epoch)` → skip. So preJoins = pending vaults with request_epoch < dist_epoch, i.e. eligible to join. The program refuses distribute while `waiting_to_join(c) > 0` (pending_count - pending_this_epoch > 0). waiting_to_join counts vaults with request_epoch < dist_epoch... Actually `waiting_to_join` = `pending_count - pending_this_epoch`. `pending_this_epoch` is reset to 0 on every `credit`/`tick`. So vaults that requested in an earlier epoch are counted in `pending_count` but not in `pending_this_epoch` (after an epoch advance). So waiting_to_join = number of vaults that requested before the current epoch and have not joined. The crank's preJoins uses `request_epoch < dist_epoch` which should match.

The crank sends preJoins in batches via `claim` with `data = d('claim') + [0]` (crank_n = 0). Keys: `[W(MINT_CFG), W(cfg.pool_ata), R(TOKEN_PROGRAM_ID), ...pairs.flatMap(([rec, ata]) => [W(rec), W(ata)])]`. The program's `Claim` accounts: config, pool_token, token_program. Then remaining: pairs. Matches.

But note: `claim` first calls `monthly_inline`. So a preJoin batch ALSO runs the monthly inline distribution! And the design says "join eligible vaults BEFORE distributing (the program refuses otherwise)". If the claim's `monthly_inline` runs the distribution before the joins happen... let's look: `claim` calls `crank(...)`, then `monthly_inline`, then loops over pairs and joins. So `monthly_inline` runs BEFORE the joins in the claim! And `monthly_inline` checks `waiting_to_join(c) > 0` → returns Ok(()) with `CBOB_MONTHLY_WAITS_FOR_JOINS`. So it's fine — the inline run refuses to credit while waits exist. Good. So the claim joins them, and then the explicit `distribute` runs. OK.

But wait: the crank computes `plan.distribute` if `due && w > 0 && avail > 0` where `w = total_active_weight + preJoinWeight`. Hmm — that's the post-join weight. But the distribution only credits JOINED vaults. If preJoins are sent before the distribute (they are: `for (let i = 0; i < plan.preJoins.length; i += L.CLAIM_BATCH) await run(...)` then `if (plan.distribute) await runDistribute(...)`), then by the time distribute runs, the preJoins have joined, so `total_active_weight` includes them. So `w` in the plan should equal the on-chain weight. OK, consistent.

But there's a subtle issue: `plan.distribute` is computed with `avail = available(pool.amount, cfg.owed_scaled)`, and `acc += avail * L.ACC_SCALE / w` "so this pass also delivers it". Then claims are computed at the post-distribution acc. But the on-chain `credit` computes `delta = avail * ACC_SCALE / w` where w = `ctx.accounts.config.total_active_weight` AT THE TIME of distribute. If the preJoins succeeded, w matches. If a preJoin FAILED (e.g. the vault was retired between read and send), the on-chain w is smaller → delta is bigger → the plan's computed acc is wrong → claims computed with a wrong acc. The claim would pay less than owed (or the program would pay what's actually owed — the program computes pending from its own acc). So the crank's claim batch would include vaults it thinks are owed ≥1 sat but actually aren't... no wait, if delta is bigger, they're owed MORE. If delta is smaller (w bigger than expected, e.g. someone else joined), the plan's acc is too big → claims sent for vaults owed < 1 sat → `pay == 0` → `continue` in the program. Fine, no failure. And the plan might exclude vaults owed ≥ 1 sat. That's a missed claim, retried next pass. OK.

Hmm, what if `w` in the plan is 0 but preJoins exist? `preJoinWeight` is added to `w`. If `total_active_weight == 0` and preJoinWeight > 0, then `w > 0`, so `plan.distribute = true` with kind 'credit'. But the program's `distribute` with `w == 0` takes the tick branch! Let's check: `let w = ctx.accounts.config.total_active_weight; if w == 0 { ...tick branch... }`. But if preJoins were joined first, `total_active_weight` > 0 at distribute time. So the on-chain w > 0 → credit branch. The plan assumed credit. Consistent IF the preJoins land. But the crank sends preJoins only if `plan.preJoins.length > 0`. And `plan.distribute` with kind 'credit' requires `w > 0` where w = cfg.total_active_weight + preJoinWeight. So if total_active_weight == 0 and preJoinWeight > 0 → 'credit'. If the preJoin batch succeeded, distribute does credit. Good. If the preJoin failed → distribute sees w == 0 → tick branch → `require!(!burn && c.pending_this_epoch > 0)` and `MonthNotElapsed`. Hmm, `pending_this_epoch` — the crank sends `distribute` with `[d('distribute'), Buffer.from([0])]` = burn=false. If w == 0 and pending_this_epoch == 0 → `NoActiveVaults` error → FAIL + page. When could that be? preJoins exist with request_epoch < dist_epoch → those are in pending_count but NOT in pending_this_epoch (pending_this_epoch counts requests in the CURRENT epoch). So `pending_this_epoch` could well be 0 while preJoins exist! E.g.: vaults requested in epoch 0, epoch advanced to 1 (pending_this_epoch = 0), total_active_weight = 0 (nobody joined yet). Then waiting_to_join = pending_count - 0 > 0. The crank plans preJoins and, if due, a 'credit' distribute (w = 0 + preJoinWeight > 0). If the preJoins land, w > 0 on chain → credit. Fine. If the preJoins DON'T land (e.g. the claim batch fails), then distribute is still sent (the crank sends it unconditionally after the preJoin loop — well, `if (plan.distribute) await runDistribute(...)` regardless of preJoin success). Then on chain: w == 0 → tick branch → `require!(waiting_to_join(c)? == 0, JoinWaitingFirst)` — but waiting_to_join > 0 (the preJoins didn't land) → `JoinWaitingFirst` error. runDistribute: does it match MonthNotElapsed? No. So it's a FAIL + page. So a failed preJoin batch → a wasted distribute fee + a false page. But a failed preJoin is itself a real failure worth paging. OK.

Hmm, but there's a subtler one: the tick branch requires `!burn && c.pending_this_epoch > 0`. The plan's 'tick' kind is chosen when `w === 0n && waitingThisEpoch` where `waitingThisEpoch = BigInt(cfg.pending_this_epoch ?? 0) > 0n`. So the plan matches. But the plan's `joins` (post-distribute) are only added `if (plan.distribute)`. And those have `request_epoch === cfg.dist_epoch` (the CURRENT epoch, before the distribute). After the distribute, `dist_epoch` advances, so `dist_epoch > request_epoch` → they can join. The plan says "JOIN AFTER: every vault this pass's distribution makes eligible (asked in the current epoch, already on chain)". And the crank sends `plan.claims` which includes `ready.push(...plan.joins)`. So joins ride in the claim batches. OK.

But: `plan.joins` uses `destOf(r) = r.pending ? r.vault_ata : tokens[r.asset]?.address`. For pending, vault_ata. OK.

Now here's something: `plan.joins` is computed only `if (plan.distribute)`. But what if the distribution already happened in-line (by another host) between the read and the plan? Then `cfg.dist_epoch` is stale. The joins would have `request_epoch === stale dist_epoch` but on-chain dist_epoch is now +1 → still eligible. Fine.

What if the plan's distribute is NOT sent (because not due) but the monthly runs in-line via a claim? Then `plan.joins` is empty and the waiting vaults aren't joined by this pass. They'd be joined next pass (as preJoins). OK.

Hmm, what about the case where `plan.distribute` is false but there are preJoins? preJoins are sent regardless (`for ... preJoins ... await run(...)` happens before the distribute block). Yes: "Eligible vaults are joined FIRST: the program refuses a distribution while one waits." And the preJoin loop is unconditional. Good.

Wait, actually — I need to double check the ordering in `main()`. Order in main(): reschedule, capture, reveal, retire, preJoins, distribute, activate, claims. Hmm: the header says "the order it SENDS is: reschedule, capture, reveal in mint order (re-sending each vault's minted attributes read off Core, hash-checked first), retire bare burns, join eligible vaults BEFORE distributing (the program refuses otherwise), the free monthly distribution, activation requests, and claim batches of 14." And the actual code: reschedule, capture, reveal, retireBurned, preJoins, distribute, activate, claims. Matches.

But WAIT. There's a problem with `activate` being sent AFTER `distribute`. The comment says: "Activations are sent AFTER the distribution (red-team 3 finding 6: an activate runs the monthly in-line first, so sending them first made the explicit distribute fail as already-done)". OK, so activate after distribute. But `activate` itself runs `monthly_inline` first! And if the distribution is due and the plan did NOT send a distribute (e.g. because `avail == 0` at plan time but more revenue arrived), then the activate's inline monthly could run it. Fine.

But here's the thing: `activate` calls `crank(ctx.remaining_accounts, ...)` FIRST, then `monthly_inline`. The crank sends activate with no remaining accounts. Fine.

Now — an important one. `plan.claims` includes `ready` (active vaults owed) plus `plan.joins`. But the joins are vaults that are `pending` and will join during the claim. The claim's pairs are `(record, ata)`. For a join, the program checks `dest.key() == r.vault_ata`. The plan uses `destOf(r)` = `r.vault_ata` for pending. Good.

But the claim is sent with `data = Buffer.concat([d('claim'), Buffer.from([0])])` — crank_n = 0. So `k = 0`, and pairs = all remaining after the first 3 accounts. Good.

Now, `plan.claims` batches14 pairs per transaction. But joins mixed in with pays: each join is one pair. The batch could be 14 pairs of which some are joins. The program handles both. OK.

Hmm, what about the `reveal` I/O: `keys: [W(MINT_CFG.toBase58()), W(a), W(r.asset), W(cfg.collection), { pubkey: payer.publicKey, isSigner: true, isWritable: true }, R(MINT_AUTH.toBase58()), R(SLOT_HASHES_ID), R(CORE_ID), R(SystemProgram.programId.toBase58())]`. The program's `RevealLevel` accounts: config, vault_record, asset, collection, payer, mint_authority, slot_hashes, mpl_core, system_program. Matches.

The `reveal_level` data: `Buffer.concat([d('reveal_level'), attrsBorsh(list)])`. The instruction signature is `reveal_level(ctx, attributes: Vec<VaultAttribute>)`. Anchor's instruction data = discriminator + Borsh(args). Borsh of `Vec<VaultAttribute>` = u32 count + each (String key, String value) = u32 len + bytes. `attrsBorsh` produces exactly that. Good.

Now — `attrsBorsh` and `attrsHash`: the program hashes `hashv(&[&attributes.try_to_vec()?])`. `try_to_vec` of `Vec<VaultAttribute>` = Borsh serialization = the same bytes. `hashv` with one slice = sha256 of that slice. `attrsHash` = sha256 of attrsBorsh(list). Should match. But WAIT: at mint, `write_record` computes `r.attrs_hash = hashv(&[&attributes.to_vec().try_to_vec()?]).to_bytes()`. Hmm — `attributes.to_vec().try_to_vec()`. `attributes` is `&[VaultAttribute]`. `.to_vec()` makes a `Vec<VaultAttribute>`. `.try_to_vec()` serializes it. So the same. But then at reveal, `require!(hashv(&[&attributes.try_to_vec()?) == hash)` where `attributes` is `Vec<VaultAttribute>` from the instruction. So both hash the Borsh of the Vec. And the crank's `attrsBorsh` builds `u32 count + u32-len key + bytes + u32-len value + bytes`. Borsh String = u32 len + UTF-8 bytes. So `attrsBorsh` = Borsh(Vec<VaultAttribute>). Good. And the selftest asserts the hex.

Hmm, one thing: `attrsBorsh` uses `list.flatMap(({key, value}) => [str(key), str(value)])` — each VaultAttribute is `{key, value}`, and Borsh serializes struct fields in declaration order: `pub key: String, pub value: String`. So key then value. Good.

Now — the reveal for a burned asset: `list = []`, and the program skips the hash check. But the crank still sends `attrsBorsh([])` = `00000000` (count 0). Fine.

Hmm, what if `assets[r.asset] === 'other'`? Then `list = []` and the reveal is sent. The program: `burned` = `owner == MPL_CORE_ID && d.len()==1 && d[0]==0`. If the asset is 'other' (e.g. closed, or system-owned), `burned` is false, and then `require_keys_eq!(*a.owner, MPL_CORE_ID, WrongAsset)` fails. So a wasted fee and a FAIL. Is 'other' reachable? An asset account that is Core-owned with data[0] != 1 and not the burn tombstone. Or a closed account (absent → 'other'). Hmm, `assets[r.asset] = !a ? 'other'`. If the account is absent (closed), 'other'. Core doesn't close asset accounts on burn (leaves a tombstone). So absent shouldn't happen for our assets. LOW.

OK now the important question for R1: "Find a plan the program will refuse (wasted fees, false pages)". I found: capture when slots are skipped → RevealTooEarly → wasted fee + false page. Also possibly: `readySlot` is computed as `slot > readySlot(reveal_slot)`, but the program requires `now > reveal_slot` AND the hashes to exist. Even with NO skips: at slot = readySlot+1 = 1017, C = 1016 is an ancestor. But is slot 1016 in SlotHashes at now=1017? SlotHashes holds the most recent 512 slots including ancestors. Yes. But what about the crank's `slot` being read at 'confirmed' commitment while the program runs at the transaction's slot? The crank reads `conn.getSlot('confirmed')` and then sends transactions that land at a later slot. So the capture is attempted at a slot ≥ plan slot. That's fine (later is better). But for reschedule: `slot > rs + 300` — later is also fine.

Hmm, but here's an issue: the crank's `nowSec` is `Math.floor(Date.now()/1000)` — local clock. Used for `due = BigInt(nowSec) >= BigInt(cfg.last_distribute_at) + BigInt(cfg.monthly_secs)`. If the local clock is ahead of chain time, the crank plans a distribute that the program refuses with `MonthNotElapsed` — which `runDistribute` treats as "already run in-line by other traffic" and logs as OK. So a clock skew produces a FALSE "ok" message and no page. Hmm — that's a silent lie: `runDistribute` treats ANY MonthNotElapsed as "already run in-line", even if it's actually "not due yet because your clock is fast". That's a false-negative-ish: the crank thinks the month ran. But the alarm's `detectDistributionOverdue` uses `nowSec` too... Actually the real consequence: the monthly distribution might not run, and the crank logs "ok: already run in-line" every pass while nothing ran. But the alarm's `distribution_overdue` uses `nowSec` (local clock) and `graceSecs` 6h, so after 6h past due it pages. So there's a backstop. Still, `runDistribute`'s error matching is too broad: it conflates "someone else ran it" with "not due yet" and with "a bug". MEDIUM? Let me think about what MonthNotElapsed means in the program: `require!(now >= last_distribute_at + monthly_secs, MonthNotElapsed)` where now is Clock::get().unix_timestamp. So MonthNotElapsed means the chain says not due. That's either clock skew or a race. Either way, treating it as "already run" is wrong — but harmless? The next pass re-checks. The consequence is a missed page for "the crank's clock is wrong". LOW-MEDIUM. I'll file it as LOW/MEDIUM.

Now "a plan that pays or joins a dead vault": `plan.claims` skips `assets[r.asset] === 'burned'`. But there's a TOCTOU: between the read and the send, the vault could be bare-burned. Then `claim` pays into the dead account (accepted limit 27 says the crank never pays a positively burned vault — but that's only true at plan time). Accepted limit 27 acknowledges the on-chain hole; the crank is the mitigation. The TOCTOU is inherent. Not a new finding per se.

Hmm, but here's a REAL one: `plan.retireBurned` is computed from `assets` read at plan time, and the crank sends `retire_burned` with keys `[W(MINT_CFG), W(a), R(r.asset)]`. The program's `RetireBurned` accounts: config, vault_record, asset. Matches. OK.

"a reveal it would send out of order": the reveal loop is `for (let i = BigInt(cfg.revealed_total); ; i++)` over `byIndex`. If a mint index is MISSING from `records` (e.g. the getProgramAccounts page missed one — no, it fetches all), then `!r` → break. OK. But what if `records` includes vaults whose mint_index is beyond `revealed_total` and one is missing? `byIndex.get(i)` returns undefined → break. So a missing record stalls the reveal lane silently (no problem reported!). That's a fault: `planCrank` breaks out of the reveal loop with no `problems.push`. If `getProgramAccounts` returns an incomplete set (RPC limits, a filter bug), the reveal queue stalls with a plan that says "reveal 0" and no problem. Hmm — the REVEAL_ONLY filter uses `memcmp: {offset: level, bytes: base58([0])}`. `bs58.encode(Buffer.from([0]))` = "1". memcmp matches a 1-byte prefix at that offset. level is a u8 at some offset. OK. But if the filter is wrong, records would be missing. And there's no assertion that `records.length` covers all indices. Actually for the full pass, all records are fetched. For the reveal-only lane, only level==0 records. `byIndex` maps by mint_index. The loop starts at `revealed_total` and needs the record at that index. If that record has level != 0... break. Hmm.

Actually here's a genuine bug: in REVEAL_ONLY mode, `records` only contains records with `level == 0` (the memcmp filter). The reveal loop: `const r = byIndex.get(i); if (!r || r.level !== 0) break`. If the record at index `revealed_total` has level != 0 (i.e., it's already revealed but revealed_total hasn't caught up — impossible), or if the record is MISSING from the filtered set because... wait, the filter is level == 0, and the loop wants level == 0 records. So the record at revealed_total (which must be un-revealed) IS in the filtered set. Unless `revealed_total` points at a record that is already revealed (level != 0) — then it's filtered out → `!r` → break. Which is the same as the full-pass behavior. OK.

Hmm, but there's a subtle issue with the memcmp filter: `offset: L.offsets('VaultRecord').level`. `offsets` computes offsets for fields up to the first variable-length field. VaultRecord has all fixed fields. level is at... disc(8) + version(1) + asset(32) + mint_index(8) + reveal_slot(8) = 57. Let me compute: 8 + 1 = 9 (version), 9+32 = 41 (asset), 41+8 = 49 (mint_index), 49+8 = 57 (reveal_slot), 57+1 = 58 (level). So level at57. The Rust comment says "GOV reads `mint_index` by raw offset (disc[0..8] version[8] asset[9..41] mint_index[41..49])". So asset at 9, mint_index at 41. That matches `offsets` (asset at 9, mint_index at 41). Good. And the selftest checks the suite's OFF_ constants against the layout.

Hmm wait, the selftest checks `OFF_REC_LEVEL` etc. against `L.offsets('VaultRecord')`. And the cross-program pinned offsets. OK.

Now — the memcmp filter for `level == 0`: `bs58.encode(Buffer.from([0]))` = "1" (single byte 0x00 encodes to "1" in base58? Let's see: base58 of [0x00] is "1"). Yes. So memcmp bytes "1" at offset 57 matches a 1-byte prefix of 0x00. Since level is 0..5, a 1-byte match of 0x00 means level == 0. Good.

But hold on — `getProgramAccounts` with a memcmp filter: does it match exactly or prefix? It matches the bytes as a prefix of the account data starting at the offset. So a 1-byte compare. Good.

OK, now "anything that makes it move value anywhere the program does not already pin": The crank sends only MINT instructions with fixed account sets. The `claim` pairs include `ata` addresses supplied by the plan. The program requires `dest.key() == r.vault_ata`. So the destination is pinned by the record. Good. `split_revenue` is not sent by the crank. OK.

Hmm — one thing: the crank's `reveal` includes `{ pubkey: payer.publicKey, isSigner: true, isWritable: true }` as `payer`. The program's `RevealLevel.payer` is `Signer` and pays Core for the level bytes. So the crank key pays. That's a fee, expected.

Now: **the crank's key is a fee payer, but `reveal_level`'s `payer` account is marked `isSigner: true`** and the crank's `send` passes `[payer]` as the only signer. Fine.

OK let me look at the **`failures` and `break`** behavior: in the reveal loop, `if (!ok) { failures.push(...); break }`. And the attrs hash mismatch also breaks. But the `break` exits the reveal loop only. So subsequent job types still run. Is that right? If the reveal lane is stuck, the FIFO is stuck, but claims etc. can proceed. Fine.

Now R2. THE ALARM.

Let me look for "a dangerous on-chain state it reads as quiet" and "a routine state it pages on every pass".

`detectStandingRisks`:
- `split_not_85_15` — CRITICAL if `mint.split_bps` !== 8500. But `Number(cur['mint.split_bps'])` — flatten converts BigInt to string. `Number("8500")` = 8500. OK.
- The brakes as INFO. `detectBrakeTransitions` pages on transitions. But `detectBrakeTransitions(prev, cur)` needs `prev` — the previous state. If the state file is lost (and `--first-run` passed), transitions are missed. But the standing check keeps an ON brake visible at INFO. Hmm, but a brake that is ON is INFO — not paged. So if the state file is reset, a brake pulled during the gap is only INFO. Hmm, the INFO still prints in the report. Is an INFO paged? `report()` only pages on crit+high. So a pulled brake (CRITICAL via transitions) that occurs while the alarm is down, or across a state reset, is only INFO in the report → no page. Is that "a dangerous state it reads as quiet"? The watchdog_gap catches a >90min gap at HIGH. And the state file is protected by the EVER marker. So a state reset requires `--first-run` deliberately. Hmm. But a missed transition between two consecutive passes is impossible (each pass reads the flag). Only if the alarm doesn't run at all. Then watchdog_gap pages HIGH. But if the alarm runs and the state file is corrupt → readLedger throws → the run fails → pages "FAILED TO RUN". OK. So the brake is covered.

Hmm, what about `mint.guardian` changes? `mint.guardian` is in WATCH as CRITICAL (drift). But `apply_guardian` changes `mint.guardian` — a legitimate voted change. It would fire `config_drift` CRITICAL on `mint.guardian` AND `guardian_armed` would have been paged earlier. So a legitimate guardian change pages CRITICAL on drift. That's a "routine state it pages on every pass"? No, it pages once on the transition (drift is prev vs cur). Hmm, but a guardian change is a real security event; paging is right.

Now `detectConfigDrift` fires on ANY change to a watched key. `mint.guardian` changing is CRITICAL — fine.

What about `mint.round_id`, `mint.price`, `mint.cap`, `mint.opens_at`, `mint.closes_at` — these change on every `set_round`, which is a routine governance action. They're HIGH. So every ratified round pages HIGH. Is that "a routine state it pages on every pass"? No — it's a one-time transition. The task says "a routine state it pages on every pass" — a STANDING condition that fires every pass. Let's look for that.

`detectStandingRisks` with `opts.production = true` (alarm.mjs passes `{ production: true }` ALWAYS). So `test_value_in_production` fires if any of the 9 values differ from the ruled ones. On a TEST deployment (e.g. the mainnet dress rehearsal with throwaway program ids!), the alarm would page CRITICAL every pass for the test values. Hmm — the dress rehearsal is supposed to use short values to exercise paths. So the alarm would scream CRITICAL every 30 minutes during the dress rehearsal. That's "a routine state it pages on every pass" — but is it dangerous? It's noise that trains people to scroll. Worth noting as MEDIUM/LOW.

Actually more importantly: `detectStandingRisks` is called with `{ production: true }` unconditionally in alarm.mjs. There is no way to turn it off. So on the dress rehearsal (which uses test values by necessity — you can't wait 30 days), the alarm pages CRITICAL 48x/day. And the `CBOB_LOCK_DEADLINE` — `detectUpgradeAuthorityAfterLock` with `lockDeadlineSec: Number(process.env.CBOB_LOCK_DEADLINE || 0) || null`. If unset → null → no checks. So the lock-date check is OFF unless the env var is set. That's "a dangerous state it reads as quiet": if `CBOB_LOCK_DEADLINE` is not set, the alarm never reports a program still upgradeable past the lock date. The task says the alarm "must page on ... upgrade authority past the lock date". If the env var is missing, it's silently off. Hmm — but the requirement is that the alarm does page on it. It does, if configured. But a missing env var is a silent disable. That's a real finding: **the lock-date detector is gated on an env var that, when absent, disables the check silently** — no `problems` entry, no page. Contrast with `HELIUS_RPC_URL` which throws. Evidence: run `alarm.mjs` without `CBOB_LOCK_DEADLINE` set with an upgradeable program past the date → no `program_not_locked` finding, and the report's all-clear mentions "no drift in any ... program upgrade authority" — wait, the all-clear says "no drift in any config value, program upgrade authority, program bytes or the collection plugins". Drift is prev-vs-cur. The standing check for upgrade authority is `detectUpgradeAuthorityAfterLock` which needs the deadline. So the all-clear could claim calm while a program is upgradeable. Yes. That's a real finding. MEDIUM/HIGH.

Hmm, actually let me re-read: `findings.push(...D.detectUpgradeAuthorityAfterLock(cfg, { lockDeadlineSec: Number(process.env.CBOB_LOCK_DEADLINE || 0) || null, nowSec }))`. And the detector: `if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []`. So with no env var, `lockDeadlineSec = null` → return []. Silent. And the report's all-clear line says "no drift in any config value, program upgrade authority, program bytes or the collection plugins" — "program upgrade authority" drift is watched via `prog.*.upgrade_authority` in WATCH (config drift). So if the authority was ALWAYS present (never changed), drift is quiet. And the standing lock check is off. So the all-clear is a false statement. That's exactly "a dangerous on-chain state it reads as quiet" — the ship gate's step 11 (remove the upgrade authority) could be skipped and nothing pages. HIGH.

Let me double check: is there anything else that catches an upgrade authority past the lock? `detectConfigDrift` compares prev vs cur; on the first run there's no prev. So no. Yes, HIGH.

Now "a routine state it pages on every pass":

Look at `detectStandingRisks`'s `joins_waiting` — INFO. `sales_stopped` INFO. `guardian_retired` INFO. `swap_operator_armed` CRITICAL every pass while armed — that's a standing condition (armed, pending). It's deliberate ("an ARMED swap-operator replacement is CRITICAL every pass"). Hmm, `pending_swap_operator` stays set for 7 days (the notice). So the alarm pages CRITICAL every 30 minutes for 7 days = 336 pages per armed operator. That's "a routine state it pages on every pass" — well, it's deliberate per the comments ("a pending guardian or swap operator" is in the required page list). The task says the alarm "must page on ... a pending guardian or swap operator". So that's by design. OK, not a finding.

What about `pool_insolvent`? `detectPoolHealth`: `owedCeil = (owed + 999_999_999_999n) / 1_000_000_000_000n`. That's `ceil(owed / 1e12)`. Correct. And `poolAvailable` in detectors: `owedCeil = (owed + 999_999_999_999n) / 1_000_000_000_000n` — same. But `bank/accrual.mjs`'s `ceilSats` = `(scaled + ACC_SCALE - 1n) / ACC_SCALE` = `(owed + 1e12 - 1) / 1e12`. Same. And the Rust `ceil_sats` = `((scaled + ACC_SCALE - 1) / ACC_SCALE) as u64`. Same. Good.

Now `detectDistributionOverdue`: `w = total_active_weight`. If `w === 0` → no page. But what if there are vaults waiting to join and nobody joined? Then the distribution can't run until they join. The crank joins them. If the crank is down, `distribution_overdue` requires `w > 0`. If nobody has joined (total_active_weight == 0), no page ever. Hmm — at launch, after the charter window closes and the month elapses, the free tick should run. If nobody triggers it, no distribution happens, and `distribution_overdue` never fires (w == 0). But there's nothing to distribute to (w == 0). But there ARE vaults waiting to join! They can't join until the epoch advances (a tick). And the tick requires `pending_this_epoch > 0`. Hmm, so: vaults request activation in epoch 0 → pending_this_epoch = N. Month elapses → tick needed → `distribute(false)` with w==0 requires `waiting_to_join == 0` (pending_count - pending_this_epoch == 0, true since all requests are this epoch) and `!burn && pending_this_epoch > 0` (true) and `MonthNotElapsed` passed. So the tick runs. Then they join. Then next month, w > 0 and the distribution runs. So the launch case: the FIRST tick needs someone to call it. The crank does it (plan.distributeKind === 'tick'). If the crank is down, `distribution_overdue` won't page (w == 0). So the launch tick could be missed forever with no page. Hmm — but `joins_waiting` at INFO: `pc - pt > 0` → that's for vaults eligible (request_epoch < dist_epoch). At launch, all requests are in the current epoch, so `pc - pt == 0` → no INFO either. So: **at launch, with vaults waiting and nobody joined, an overdue first tick is invisible to the alarm** — `detectDistributionOverdue` returns [] because `w == 0`, and `joins_waiting` returns [] because `pc - pt == 0`. The whole launch sequence stalls silently (until someone calls distribute by hand). That's a real finding: "a dangerous state it reads as quiet". MEDIUM/HIGH. Let me verify the detector: 

```
export function detectDistributionOverdue(cur, { nowSec, poolAvail, graceSecs = 6 * 3600 } = {}) {
  const last = big(cur['mint.last_distribute_at']), period = big(cur['mint.monthly_secs'])
  const w = big(cur['mint.total_active_weight'])
  if (last === null || period === null || w === null || nowSec === undefined) return []
  if (w === 0n) return []
  ...
```

Yes — `w === 0n` → []. And the poolAvail must be > 0 too. At launch the pool may well have revenue (mint prices land in the revenue address and are split into the pool). So poolAvail > 0, w == 0, vaults waiting → silence. And the report's all-clear says "no overdue distribution". False calm. That's exactly the requested finding shape.

Hmm, but is it "dangerous"? The consequence: the first distribution after launch never happens until a human calls `distribute` or someone's transaction triggers the inline... wait, the inline monthly (`monthly_inline`) also does: `if c.total_active_weight == 0 { if c.pending_this_epoch > 0 { tick(c, now)?; } return Ok(()) }`. So ANY host instruction (mint, claim, activate) triggers the tick. And `activate` is a host! So a holder activating a vault triggers the tick. Hmm. But `activate` for a NEW vault: `crank(...)`, then `monthly_inline`, then... the monthly_inline ticks if due and pending_this_epoch > 0. But this activate itself is about to add to pending_this_epoch AFTER the inline. So the tick happens if some earlier request is in pending_this_epoch. So ordinary traffic does it. But if there is NO traffic at all (nobody mints, nobody claims — plausible right after launch), the tick never runs and nothing pages. Then after30 more days... still w==0, still silent. So the holders' first payout is delayed indefinitely with an all-clear report. And `joins_waiting` won't fire because `pc - pt == 0` (all pending are in the current epoch). Hmm, wait: after the tick, `pending_this_epoch = 0` and `pending_count = N`, so `pc - pt = N > 0` → `joins_waiting` INFO fires. But before the tick, `pc - pt == 0`. Right.

Actually hold on — is `joins_waiting` INFO paged? No, INFO is not paged. So even after the tick, the state is only INFO. And `distribution_overdue` requires w > 0 — after the tick, still w == 0 until someone joins. Joining requires a `claim` naming the vault or a second `activate`. The crank does that. If the crank is down... `distribution_overdue` with w == 0 → silent. Hmm. So the whole launch chain stalls and the alarm is quiet. But the report does say "NOT CHECKED BY THIS PASS" for some things. The all-clear line says "no overdue distribution" — which is technically judged by a detector that returns [] for w==0.

I think this is a legitimate finding: **the launch/tick case is invisible to `detectDistributionOverdue` because it requires `total_active_weight > 0`, and the epoch-tick that the whole launch path depends on is exactly the case where that is zero.** Fix: page when `due && poolAvail > 0 && (w > 0 || pending_count > 0)`, or add a `tick_overdue` detector.

Let me also check `detectDistributionOverdue`'s `poolAvail` requirement: `if (poolAvail === null || ... || BigInt(poolAvail) <= 0n) return []`. And alarm.mjs computes `poolAvail = pool?.state === 'ok' ? D.poolAvailable(cfg, pool.amount) : null`. `poolAvailable` returns null if owed is null. OK.

Now — another one. `redemptionCapacity`:
```
const live = minted - burned - bare
let cap = (live * 210n + 9_999n) / 10_000n
```
That's `ceil(live * 210 / 10000)` = ceil(live * 2.1%). The program (BURN) — I don't have BURN's source here! The task says "The money arithmetic (bank/accrual.mjs) must equal the program's (programs/cbob-vault-mint/src/lib.rs...)". For R4, only accrual vs MINT. But the rate limit is BURN's, and BURN's source is NOT in the bundle. Hmm. The layout.mjs declares BurnConfig with `rate_head` and `rate_ring`. And `redemptionCapacity` in detectors mirrors "BURN's (stage 3c): cap = max(1, ceil(live x 210 / 10,000)), bounded by the 64-slot ring; a redemption lands iff the cap-th most recent one is at least a window old." I can't verify against BURN's source. I should note that BURN's source is not in the bundle and the mirrored rate-limit arithmetic is unverified. Actually — hold on. The bundle includes `programs/cbob-vault-mint/src/lib.rs` only. SEAL, BURN, GOV source are NOT provided. That's a coverage gap I should name: the audit bundle contains only one of four programs, so R4 (and any claim about BURN/SEAL/GOV behaviour) cannot be checked. But the prompt says "THE FILES UNDER AUDIT, WHOLE" and lists only MINT's Rust. So I should note that as a structural gap — and per the instructions ("It sees only the bundle... the runner refuses to name a file it did not deliver"), this round cannot certify SEAL, BURN or GOV. That's important: findings about `burn_vault`, `open_for_redemption`, `retire_redeemed`'s BURN-side pairing, GOV's tally — all unverifiable here.

Hmm, but `retire_redeemed` IS in MINT and it checks the caller is BURN's burn_vault by discriminator and account index. I can check that part.

Let me look at `redemptionCapacity`'s ring logic:
```
const ring = cur['burn.rate_ring']
if (!Array.isArray(ring) || ring.length !== RATE_RING) return null
const inWindow = BigInt(ring.filter(t => now - BigInt(t) < window).length)
```
The ring is `[i64; 64]`, decoded as BigInt array. Empty slots are 0 → `now - 0 < window` is false (now is ~1.7e9, window 3600). So empty slots don't count. Good. But `ring.filter(t => now - BigInt(t) < window)` — if a slot holds a FUTURE timestamp (impossible) or 0. OK.

Hmm — `flatten` converts arrays via `str` per element: `Array.isArray(v) ? v.map(str) : str(v)`. So rate_ring becomes an array of STRINGS. Then `BigInt(t)` works on strings. OK.

But: `redemptionCapacity` requires `ring.length === RATE_RING`. `flatten` maps the whole array. OK.

Hmm, `cur['burn.rate_head']` is read but unused in `redemptionCapacity`. Fine.

Now `detectRedemptionRate`: `near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))` with nearFraction 0.2. `if (c.remaining > near) return []`. So it pages when remaining ≤ 20% of cap. At cap 45, near = 9. So pages when remaining ≤ 9. Hmm: at remaining = 9 it pages. But the "normal" state at2,100 live vaults with light usage is remaining = 45 → quiet. But at VERY LOW live supply, cap = 1 (floor), near = 1. So `remaining > 1` → quiet; remaining ∈ {0,1} → pages. With cap=1 and 0 used, remaining=1 → `1 > 1` false → PAGES. So at live supply where cap is 1 (live ≤ 48ish), the alarm pages HIGH on EVERY PASS even when the window is completely idle! Let's check: cap = max(1, ceil(live*2.1%)). cap == 1 when live*0.021 ≤ 1 → live ≤ 48. Then near = max(1, floor(1*0.2)) = 1. remaining = 1 (idle). `remaining > near` → `1 > 1` → false → return the finding. So YES: **with48 or fewer live vaults, `redemptions_near_cap` fires HIGH on every alarm pass even with zero redemptions in the window.** That is exactly "a routine state it pages on every pass". At the END of the project's life (as vaults are redeemed down), or at launch (240 charter vaults → cap = ceil(240*0.021) = 6, near = 1, remaining 6 > 1 → quiet). Hmm, at 240 live, cap = ceil(5.04) = 6. near = floor(6*0.2) = 1. remaining 6 > 1 → quiet. So it's only when cap is small: cap = 1 → live ≤ 48; cap = 2 → live 49..96, near = floor(0.4) = 0 → max(1,0) = 1. remaining = 2 > 1 → quiet. remaining = 1 → page. Hmm, cap=2, near=1: page when remaining ≤ 1, i.e. one redemption used. That's arguably correct ("nearly full"? 1 of 2 left = 50% remaining, that's not "nearly full"). Hmm, the doc says "near full (under 20% room) pages". With cap=2, remaining=1 is 50% room but pages. With cap=1, remaining=1 is 100% room and pages. So the detector over-fires at small caps. The selftest only tests cap=45. So: **`detectRedemptionRate` pages HIGH on every pass whenever live supply ≤ 48, even with an empty window** — a routine state that pages forever. And since redemptions only reduce live supply, this is the steady state late in life. HIGH-ish noise, MEDIUM.

Evidence: `D.detectRedemptionRate(bk(48, []), T)` returns one finding of kind `redemptions_near_cap`. Let me verify: bk(48, []) → live=48. cap = (48*210 + 9999)/10000 = (10080+9999)/10000 = 20079/10000 = 2 (integer). Hmm! 48*210 = 10080. +9999 = 20079. /10000 = 2. So cap = 2 for live=48. Hmm, let me recompute the cap formula: `ceil(live * 210 / 10000)` = `ceil(live*0.021)`. For live=48: 48*0.021 = 1.008 → ceil = 2. So cap=2. For cap=1 we need live*0.021 ≤ 1 → live ≤ 47.6 → live ≤ 47: 47*210 = 9870 + 9999 = 19869 / 10000 = 1. So live ≤ 47 → cap = 1. So at live ≤ 47, cap=1, near=1, remaining=1 → pages. So: **once fewer than 48 vaults remain live, the alarm pages `redemptions_near_cap` at HIGH every 30 minutes forever, even with an empty window.** Yes. That's a clean finding.

Hmm, and also cap=2 (live 48..95): near = max(1, floor(2*0.2)) = max(1, 0) = 1. remaining=2 → quiet. remaining=1 (one redemption in the window) → page. 1 of 2 remaining = 50% room. Over-fires but less egregiously. And cap=3 (live 96..143): near = max(1, floor(0.6)) = 1. remaining=3 quiet, 2 quiet? `2 > 1` → quiet. remaining=1 → page. Hmm, 1 of 3 = 33% room. Hmm, the intent "under 20% room" is not what `remaining > near` implements: it pages when `remaining ≤ near` where near = 20% of cap. remaining ≤ 0.2*cap means used ≥ 0.8*cap. For cap=45, near=9, pages when remaining ≤ 9 → used ≥ 36 = 80%. OK that matches "under 20% room". But the `max(1, ...)` floor makes near=1 for cap ≤ 5, so it pages when remaining ≤ 1 regardless. For cap=1 that's remaining ≤ 1 = always. Yes.

Great, that's a solid finding. And the fix: `if (c.cap <= 1n) return []` or use `remaining * 5n > c.cap` (remaining > 20% of cap) without the floor.

Now let me look for more.

`detectVaultSetChange`: `prevLive.filter(a => !live.has(a))`. `prev` is `prev?.vaults` which is `vaults` (the live list) stored in state. OK.

`correlateBurns` — fine.

`detectIndexShortfall(mintedTotal, liveIds, burntIds)` — alarm.mjs passes `vaults` and `burnt` (arrays). Good (the `.length` bug is fixed).

`missingWatchedKeys` — good.

Now `readConfigs`: `snap['collection.plugins_hash']` uses `L.collectionPluginsHash(acc.data)`. And `pob_collection.update_authority`: `acc.data.length >= 33 && acc.data[0] === 5 ? new PublicKey(acc.data.subarray(1,33)).toBase58() : 'ABSENT'`. Core's CollectionV1: `key(1)=5 | update_authority(32) | ...`. Hmm — is the update authority Option? In the MINT code: `UA_DISC_COLLECTION: u8 = 2` is used for ASSETS (`d[33] == UA_DISC_COLLECTION` means the asset's update authority is "Collection"). For a CollectionV1, the field at offset 1..33 is the update authority. But is it `Option<Pubkey>` or `Pubkey`? The MINT `initialize` code reads: `let mut ua = [0u8; 32]; ua.copy_from_slice(&d[1..33]); require_keys_eq!(Pubkey::new_from_array(ua), mint_pda, CollectionNotOurs);` — so it treats bytes 1..33 as a bare Pubkey. Hmm, but Core's CollectionV1 has `update_authority: OptionalNonZeroPubkey` which is 32 bytes where all-zero means None. So `acc.data.subarray(1,33)` is the right slice. But if the authority is None (all zeros), `new PublicKey(0x00*32)` = the system program address "1111...". Hmm, that would report "11111111111111111111111111111111" which equals DEFAULT_PUBKEY. Not a big deal.

Hmm, but wait: for the CBOB collection, the update authority is MINT's `["mint"]` PDA — after `initialize`, MINT becomes the authority? Actually `initialize` requires the collection's update authority to ALREADY be `mint_pda` (`CollectionNotOurs` if not). So the collection is created with the mint PDA as authority before initialize. And then the Royalties plugin is added via `invoke_signed` with the mint PDA signing. OK.

Now `collectionPluginsHash`: `if (d.len() < 41 || d[0] !== 5) return 'NOT_A_COLLECTION'`. Then `o = 33`, skip name and uri (u32 length + bytes) — that's 2 iterations, then `o += 8` (num_minted + current_size), then hash `d.subarray(o)`. So it hashes everything after the base fields: the plugin header and registry. But `o += 8` — the base is `key(1) + update_authority(32) + name(String) + uri(String) + num_minted(4) + current_size(4)`. So o = 33 + name + uri + 8. Yes. Then the remaining is the plugin section. Good. But if there's NO plugin section (empty collection), `d.length == o` and the hash is of an empty slice → constant. Fine.

Hmm — but Core's CollectionV1 might have a `plugin_registry` header like `u16 plugin_count` or a `Vec<(Plugin, Authority)>`. Whatever follows is hashed. Fine.

Now, a potentially important one: **`collectionPluginsHash` hashes everything after the base fields, including the plugin registry's authorities.** If a mint changes `num_minted`/`current_size`, the hash is stable. But if Core appends padding or the account is reallocated... whatever.

Now R2's "assert Gary's production values (21% / 51% / 3 days, 7-day notice, the tighten bounds, 30-day month, one-hour window)". `detectStandingRisks`'s `want` list covers monthly_secs 2592000, redeem_window_secs 3600, notice_secs 604800, sweep_floor 1e9, cooldown_ceiling 86400, reserve_ceiling 1e8, quorum 2100, threshold 5100, min_voting 259200. That's 9. The selftest asserts 4 wrong governance values fire and 3 bounds fire. OK.

Missing from the production list: `max_supply` 2100, `level_caps` 945/525/315/210/105, `bank_treasury`, `payment_mint`, `split_bps` (covered separately), `charter_closes_at - charter_opens_at` = 7 days, `max_sweep_lamports`, `sweep_cooldown_secs`, `sol_reserve_lamports`, `pob_root`. Item 38 lists these as must-be-ruled and says `scripts/check-launch-params.mjs` refuses before signing. But the ALARM's production check does not assert `max_supply`, `level_caps`, the charter window length, or `pob_root`. So a wrong `max_supply` (say 21 instead of 2100) would never be paged by the alarm — it's a "fixed forever" value but not in the production list, and drift only fires on CHANGE, not on a wrong initial value. Hmm — but item 38 says the launch checker covers it BEFORE signing. The task says the alarm must "assert Gary's production values (21% / 51% / 3 days, 7-day notice, the tighten bounds, 30-day month, one-hour window)" — those are exactly the 9 covered. So the alarm meets the stated requirement. But `max_supply` and `level_caps` are arguably in "every change to a value that is fixed forever" (drift, covered). OK, the drift covers changes. The initial-value check is the launch checker's job. I'll note that `level_caps` and `max_supply` are not in the alarm's production list, so a wrong one is only caught by `check-launch-params.mjs` — and if that's bypassed (e.g. someone signs by hand), the alarm is quiet. LOW, and arguably covered by item 38. I might mention it briefly.

Now: **`detectStandingRisks`'s collections check**: `const colls = COLLECTION_KEYS.map(k => [k, cur[k]]).filter(([, v]) => v)`. If only ONE program is deployed, colls.length == 1 → no disagreement check. Fine.

Hmm, `detectStandingRisks({ 'seal.collection': OTHER, 'mint.collection': PDA })` in the selftest expects `collections_disagree`. But `COLLECTION_KEYS` has 4 keys, and the filter keeps truthy ones. With 2 values that differ → distinct.size 2 > 1 → fires. Good.

Now — the alarm's `normalise` and `bs58decode`: a hand-rolled base58 decoder. `for (const c of s) { const i = B58.indexOf(c); if (i < 0) return Buffer.alloc(0); n = n * 58n + BigInt(i) }` then `while (n > 0n) { bytes.unshift(...) }` then leading '1's → zero bytes. Hmm: for a string that decodes to a value with leading zero bytes not from '1's... base58 encoding of [0x00, 0x01] is "12"? Actually the leading zeros are encoded as '1'. The decoder: `for (const c of s) { if (c === '1') bytes.unshift(0); else break }`. So it prepends one zero per leading '1'. But the `while (n > 0n)` loop produces the big-endian bytes of n. If n's byte representation is shorter than the decoded length... hmm, actually the standard: the number of leading zero bytes in the output equals the number of leading '1's. And `n` accumulates all chars including the leading '1's (which contribute 0). So `n` is the same. Then `bytes` = big-endian of n. Then prepend zeros for each leading '1'. That's correct. Except: if `s` is empty, n=0, bytes=[], no leading '1's → Buffer([]). OK. And if the whole string is "111", n=0, bytes=[], then3 leading '1's → [0,0,0]. Correct.

But there's a bug: `for (const c of s) { if (c === '1') bytes.unshift(0); else break }` — this loop runs AFTER the `while (n>0n)` loop and iterates over `s` from the beginning. But it's `for (const c of s)` with a `break` on the first non-'1'. So it counts leading '1's. Good.

Hmm, actually the instruction `data` field in jsonParsed is base58. For raw instructions inside a parsed transaction, `ix.data` is base58 and `ix.programId` is a string. The `one()` function: `program: (ix.programId || keys[ix.programIdIndex]).toString()`. For jsonParsed top-level instructions, `ix.programId` is present. For inner instructions, `ix.programId` is present too (jsonParsed inner instructions are parsed). Hmm — actually for `getParsedTransaction`, `meta.innerInstructions[].instructions` are parsed the same way. And raw (unparsed) instructions have `programIdIndex` and `accounts` as indices and `data` as base58. The `one()` handles both. But `ix.accounts` for a parsed instruction is... hmm, for a parsed instruction (e.g. `spl-token` transfer), the shape is `{programId, parsed: {type, info}, accounts?}`. Hmm, actually jsonParsed instructions have `program`, `programId`, `parsed`. Let me recall: `getParsedTransaction` returns instructions with `programId` (string) and `parsed` for known programs, or `accounts` (array of strings? no — for unknown programs, `{programId, accounts: [indices], data: base58}`).

Hmm, this matters for `detectApprovals` which uses `ix.parsed?.type` and `ix.parsed?.info`. And `detectBurns` uses `ix.accounts?.[0]`. For a raw Core BurnV1 instruction, `ix.accounts` would be account INDICES (numbers) if unparsed. The `one()` maps `accounts: (ix.accounts || []).map(a => (typeof a === 'number' ? keys[a] : a.toString()))`. So indices are resolved. But for a PARSED instruction, `ix.accounts` may be absent (parsed instructions don't carry `accounts`). Core is not a known program to the RPC's parser, so Core instructions come back raw with `accounts` as index numbers → resolved to strings. Good.

Hmm, but `keys` = `tx.transaction.message.accountKeys.map(k => (k.pubkey || k).toString())`. For a versioned transaction with address lookup tables, `accountKeys` is the static keys only, and the resolved keys are in `meta.loadedAddresses`. So an index beyond the static keys would throw or resolve wrong. `maxSupportedTransactionVersion: 0` is passed. Versioned transactions with ALTs: `tx.transaction.message.accountKeys` for a `jsonParsed` response... Actually for getParsedTransaction, the message is `ParsedMessage` with `accountKeys` being the FULL resolved list (including loaded addresses) as `{pubkey, signer, writable}`. I believe jsonParsed resolves them. Hmm, not 100% sure. If it doesn't, indices referencing loaded addresses would be wrong. This is a potential blind spot but I can't verify without running. I'll note it cautiously or skip.

Let me focus on more concrete things.

`detectUnledgeredSweeps`: `let onchain = 0n; for (let i = 7; i >= 0; i--) onchain = (onchain << 8n) | BigInt(d[8 + i]);` — reads 8 bytes at offset 8 little-endian. `sweep_sol_for_swap(amount: u64)` → data = disc(8) + u64 LE. So d[8..16] is the amount LE. The loop reads d[8+7] down to d[8+0], shifting — that's big-endian assembly of LE bytes reversed = correct LE read. Good.

But `if (!d || d.length < 16) continue` — fine.

`detectSplitClaims` — complex but looks reasonable.

Now, `alarm.mjs`'s signature walk: `for (const s of sigs) { if (s.err) continue; ... }` and `if (!gap && !unread && sigs.length) cursors[id] = sigs[0].signature`. Hmm — `sigs[0]` is the newest? `walkSigs` returns `sigs` presumably newest-first (getSignaturesForAddress returns newest first). So `cursors[id] = sigs[0].signature` = the newest. And `walkSigs(conn, prog, cursors[id])` uses the cursor as `until`. OK.

But: `if (!gap && !unread && sigs.length) cursors[id] = sigs[0].signature`. If `sigs.length === 0`, the cursor stays. Fine. If a tx is unreadable (`!tx`), `unread++` and the cursor is NOT advanced — so the whole window is re-scanned next pass. And the finding says "The cursor stays where it was so the next pass tries again." But then `looked.txs` and findings would be DUPLICATED next pass (the same findings fire again). That's noise but safe.

Now — `seenSplits` is accumulated per-pass and merged with `prev?.seenSplits`. `detectSplitClaims([...seenSplits, ...(prev?.seenSplits || [])], led)`. And `next.seenSplits = dedupeSeenSplits([...])`. So seenSplits grows unboundedly. Fine.

Now, `alarm.mjs`'s `readConfigs` throws if `missingWatchedKeys` is non-empty. Good.

Now — **the `looked.eventSigs` Set is created inside the loop** with `if (!looked.eventSigs) looked.eventSigs = new Set()` and `delete looked.eventSigs` after. Fine.

Now R3. THE LAYOUTS.

`offsets(name)`: computes offsets for fields up to the first variable-length field. For `SealConfig`, `Vec<Pubkey>` is variable → `FIXED['Vec<Pubkey>']` is undefined → `break`. So fields after `reserve_mints` (`bump`) get no offset. But `encode`/`decode` handle Vec fine. And `offsets('SealConfig')` gives `collection` at 9, `reserve_mints` at 41. The Rust `OFF_RESERVES: usize = 41` and `OFF_COLLECTION: usize = 9`. Good.

But the selftest's `want` list includes `['BURN OFF_COLLECTION (SEAL)', burn.COLLECTION, S0.collection]` and `['BURN OFF_RESERVES (SEAL)', burn.RESERVES, S0.reserve_mints]`. Good.

`parseRustStruct(src, name)`: regex `pub struct ${name}\s*\{([\s\S]*?)\n\}`. Non-greedy to the first `\n}`. For `MintConfig` with doc comments (`///`), the line regex `/^pub (\w+):\s*(.+?),?$/` after stripping `//` comments. The fields with doc comments are on separate lines, so the field lines themselves are `pub version: u8,`. Good. But a field with a trailing comment on the same line: `raw.replace(/\/\/.*$/, '')` strips it. Good.

But: the regex `\n\}` matches the first line that is exactly `}`. If a struct has a nested block... no. OK.

Hmm — the selftest compares `JSON.stringify(L.parseRustStruct(rs(s.src), s.struct)) === JSON.stringify(s.fields)`. `parseRustStruct` returns `[[name, type], ...]`. And `s.fields` is the same shape. Types must match EXACTLY as strings. E.g. Rust `pub level_caps: [u32; 5]` → type `[u32; 5]`. Layout says `[u32; 5]`. Good. `pub entropy: [u8; 32]` → `[u8; 32]`. Good. `pub rate_ring: [i64; 64]` → `[i64; 64]`. Good. `pub acc_scaled: u128` → `u128`. Good.

But `SealConfig`'s `reserve_mints: Vec<Pubkey>` → type `Vec<Pubkey>`. Layout says `Vec<Pubkey>`. Good.

Now, `fixedSize`/`FIXED` doesn't include `Vec<Pubkey>` — so `offsets` breaks there. But `decode` handles it. And `fixedLength('SealConfig')` returns null (since Vec has no FIXED). Hmm, `fixedLength` returns `null` when a field has no fixed size. But the selftest does `t('...and its fixed part is the length the program allocates before padding', enc.length, L.fixedLength('MintConfig'))` — MintConfig is all fixed fields. `fixedLength('MintConfig')` = 8 + sum of all field sizes. Let me verify: the encode output length should equal that. And the Rust `MINT_CONFIG_SPACE` = 8 + ... + CONFIG_PADDING. So `fixedLength` excludes padding. The test asserts `enc.length === fixedLength('MintConfig')`. Since encode writes exactly the fields, yes.

Now: is the FIELD ORDER in layout.mjs the same as the Rust? The selftest asserts `parseRustStruct(...) === s.fields` — JSON.stringify of arrays of [name, type]. Order matters in JSON.stringify. So yes, order is checked.

Now — a struct change could slip past if... `parseRustStruct` fails to parse (returns null) → `JSON.stringify(null) === JSON.stringify(s.fields)` is false → the assertion fails. Good. What if the Rust adds a field with a type the regex doesn't match (e.g. `pub foo: Option<u64>`)? The regex `^pub (\w+):\s*(.+?),?$` would match `Option<u64>` → mismatch with layout → red. Good.

What about a field declared with attributes on the same line, e.g. `#[serde(...)] pub foo: u64`? The regex requires the line to start with `pub ` after trimming. If an attribute is on the same line, the line starts with `#` → not matched → the field is MISSING from parseRustStruct → mismatch → red. Good (fails safe).

What if the Rust changes a field's TYPE but keeps the name? `parseRustStruct` captures the type → mismatch → red. Good (the selftest has a retyped case).

So R3 looks solid. One thing: `decode` checks `d[8] !== s.version` — version at offset 8. And `readPinned` calls `pinnedAccountData` with `version: s.version`. Good.

Hmm, `readPinned(name, acc, PublicKeyCtor)`: `new PublicKeyCtor(PROGRAM_IDS[s.program])`. And `pinnedAccountData` compares `acc.owner.toBase58() !== program.toBase58()`. Good.

But `decode` does NOT check the owner. `readPinned` does. The crank uses `L.decode('VaultRecord', account.data)` on accounts fetched via `getProgramAccounts(MINT, {filters: [{memcmp: discriminator}]})` — those are owned by MINT by construction. OK.

Hmm — the crank's `raw.map(({pubkey, account}) => ({ address: pubkey.toBase58(), ...L.decode('VaultRecord', account.data) }))`. `L.decode` checks the discriminator AND version. If a record has an old version, `decode` THROWS → the whole crank run dies with an exception (unhandled in main → rejected promise → withLock catch → "CBOB CRANK FAILED TO RUN" + notify if live). So a version mismatch is loud. Fine.

Now R4. THE MONEY ARITHMETIC.

`accrual.mjs`:
- `ceilSats(scaled) = (scaled + ACC_SCALE - 1) / ACC_SCALE`. Rust: `((scaled + ACC_SCALE - 1) / ACC_SCALE) as u64`. Match.
- `available(poolBalance, owedScaled) = poolBalance - ceilSats(owedScaled)`, clamped at 0. Rust `distribute`: `let owed = ceil_sats(...); let avail = balance.checked_sub(owed).ok_or(PoolShort)?; require!(avail > 0, NothingToDistribute)`. So the Rust REFUSES if balance < owed (PoolShort) rather than clamping. The accrual clamps at 0 and the comment says "Never negative here; the program refuses with PoolShort instead, and the alarm reports it." So `available` returning 0 for a short pool means the crank plans no distribution — consistent with the program refusing. OK. But `poolAvailable` in detectors also clamps. And `detectPoolHealth` reports `pool_insolvent` if `amount < owedCeil`. Good.

- `credit({acc, owed}, avail, w)`: `delta = avail * ACC_SCALE / w`; `acc += delta`; `owed += delta * w`. Rust: `delta = (avail as u128) * ACC_SCALE / (w as u128)`; `acc += delta`; `owed += delta * w`. Match.

- `pendingSats({level, debt}, acc)`: `p = weightOf(level) * acc - debt; return p / ACC_SCALE`. Rust claim: `pending = w * acc - r.debt_scaled; pay = (pending / ACC_SCALE) as u64`. Match.

- `debtAtActivation(level, acc) = weightOf(level) * acc`. Rust `join`: `r.debt_scaled = (w as u128) * c.acc_scaled`. Match.

Hmm — one divergence: `pendingSats` THROWS if `p < 0` ("debt above entitlement"). The Rust uses `checked_sub(...).ok_or(Overflow)?` which aborts the claim. So both refuse. But the crank's `planCrank` wraps `pendingSats` in try/catch and pushes a problem. Good.

What about `retire`? The Rust `retire` computes `pending = full - debt` and `owed -= pending`, `debt = full`. `accrual.mjs`'s selftest asserts "retiring it returns exactly its share to the pool" as `s3.owed - pendScaled == 0`. But there's no `retire` FUNCTION in accrual.mjs — only the selftest computes it inline. So the crank/alarm don't need it. OK.

Hmm, one thing: `ceilSats` uses `BigInt(scaled)`. Fine.

Is there a divergence in `available`? The crank uses `available(pool.amount, cfg.owed_scaled)` from accrual. And `poolAvailable` in detectors computes the same. Both equal. And the Rust uses `balance - ceil_sats(owed)` with checked_sub. Consistent.

Hmm — actually WAIT. Let me look at `monthly_inline`'s avail: `let avail = balance.saturating_sub(ceil_sats(c.owed_scaled));` — uses `saturating_sub` (clamps at 0), then `if avail == 0 { return Ok(()) }`. While `distribute` uses `checked_sub(...).ok_or(PoolShort)?` then `require!(avail > 0)`. So `distribute` REFUSES with PoolShort on a short pool while `monthly_inline` silently does nothing. That's a documented difference ("An explicit `distribute` is not refused for a frozen pool" — hmm, that's about frozen). For a SHORT pool: `distribute` errors PoolShort; `monthly_inline` does nothing. The accrual's `available` clamps → the crank plans nothing → consistent with monthly_inline but NOT with `distribute` (which would error). The crank's `runDistribute` would FAIL with PoolShort and page. But the crank only plans a distribute when `avail > 0`, so it wouldn't send one. OK. Consistent enough.

Now — hmm, here's a potential divergence: the crank's `plan.distribute` computes `avail = available(pool.amount, cfg.owed_scaled)` and then `acc += avail * L.ACC_SCALE / w`. But the ON-CHAIN `credit` computes `delta = avail * ACC_SCALE / w` where `avail = balance - ceil_sats(owed)` at the time of the call. If the pool balance changed between read and send (e.g. `split_revenue` added more), the on-chain delta is bigger. Then the plan's `acc` is too small → the plan's `pendingSats` under-estimates → some vaults owed ≥1 sat are skipped this pass. Next pass catches them. Conversely if the balance dropped (impossible — the pool only receives)... Actually `claim` transfers OUT of the pool. But claims happen after. Hmm, and a redemption's `retire_redeemed` reduces `owed_scaled` and returns to... `retire` does `owed_scaled -= pending` and sets debt = full. So the pool keeps the sats. So the pool balance only rises (split_revenue) or falls (claims). So between the plan's read and the distribute send, if someone else claims, the balance falls and `avail` falls → the plan over-estimates acc → claims computed with too-high acc → the plan includes vaults that are owed < 1 sat → the program's `pay == 0` → `continue`. No failure. And vaults owed slightly more than the plan thought are just paid what the program says. So no divergence in payment; only planning imprecision. Fine.

Now — **is there a divergence between `accrual.pendingSats` and the Rust for a PENDING vault?** The Rust `claim` for `r.pending` joins and `continue`s (pays nothing). The crank's plan: `if (!r.active || r.retired) continue` — so pending vaults aren't in `ready`; they're in `plan.joins` and pushed into `ready` at the end. Good.

Hmm — but `planCrank`'s claim loop computes `owed` for `r.active` vaults. And `plan.joins` are appended to `ready` regardless of owed. Good.

OK, now R5. THE SWAP HOP (`bank/revenue.mjs`).

"Bound its worst case": `MAX_PER_CYCLE_LAMPORTS = 50 SOL`, `chainCap = cfg.max_sweep_lamports`, `amount = min(balance - reserve, 50 SOL, chainCap)`. And the program enforces `amount <= max_sweep_lamports`, cooldown, reserve, operator signature. Worst case: cap × windows until the guardian stops. Documented (limit 10).

"check the ledger cannot read a failed cycle as closed": `cycleIsOpen` — `if (c?.sendRejected) return false`; `if (moved === 0n) return false`; `return BigInt(c?.returnedSats ?? 0) === 0n || !(c?.splitSig || c?.splitByOther)`. So a cycle is open if it moved something AND (returned nothing OR not split). A failed swap (after a successful sweep) leaves `returnedSats` undefined → `0n` → open. Good.

Hmm — what about a cycle where the swap succeeded but the RETURN transfer failed? `cycle.returnSig = await sendAndConfirmTransaction(...)` — if that throws, the exception propagates out of `main()`, `withLock` catches → "CBOB REVENUE CYCLE FAILED" + notify (if LIVE). The ledger has `sweptLamports` and `swapSig` but no `returnedSats` → open → the next run refuses to start another cycle (`open.length` → throw). Good.

But: `cycle.returnedSats = String(delta)` is set AFTER the return transfer succeeds. And `got = after` is transferred. If `after > opBefore` but `delta < minOut`, it throws BEFORE the transfer — SOL is on the operator, cbBTC is in the operator's ATA, the cycle is open, and the next run refuses. Manual resolution. Documented? The comment says "SOL is on the operator key and must be returned or swapped by hand". OK.

Hmm — **`delta = after > opBefore ? after - opBefore : 0n`**. If someone sends cbBTC to the operator's ATA between the baseline read and the swap, `delta` would include it. If the swap fails and returns 0, `after == opBefore` + donation → delta = donation → could pass `minOut` even though the swap failed! Then `cycle.returnedSats = delta` (recorded as this cycle's return), `got = after` (the whole balance) is transferred to the revenue address. So the money goes back to revenue, but the ledger records `returnedSats = delta` which includes a donation. The reconciliation would look fine. But the swap FAILED and the SOL... wait, if the swap failed, `cycle.swapSig` would throw on `confirmTransaction`? Actually `conn.sendRawTransaction` returns a signature even if the tx will fail (it's just broadcast); `confirmTransaction` then... hmm, `confirmTransaction` with a blockhash strategy returns a value with `value.err` — it doesn't throw on a program error! Let me think. `conn.confirmTransaction({signature, blockhash, lastValidBlockHeight}, 'confirmed')` throws on `TransactionExpiredBlockheightExceededError` but returns `{value: {err}}` for a failed transaction. Actually in web3.js, `confirmTransaction` resolves with `RpcResponseAndContext<SignatureResult>` and you must check `.value.err`. The code does `await conn.confirmTransaction(...)` and ignores the result. So **a swap transaction that lands but FAILS (e.g. slippage exceeded) is treated as success**. Then the balance read shows no change (or a change from a partial route — unlikely), `delta = 0` or the donation, and `if (delta < minOut) throw`. So a failed swap → delta 0 → throw. OK, caught. Unless a donation covers minOut. Edge case. But the bigger issue: `cycle.swapSig` is recorded and `save(led)` even if the swap failed. Then the cycle is open (returnedSats 0) → wedged. Fine.

Hmm, but there's a REAL issue: `sendRawTransaction` + `confirmTransaction` without checking `value.err` means `cycle.swapSig` is recorded for a FAILED swap. Then `detectSplitClaims` etc. don't care. OK.

Actually, let me look at the more interesting one: **the `--audit` function and `cycleIsOpen`**. `audit()` computes `swept` and `returned` and lists open cycles. Fine.

"nothing here can send value anywhere the program does not pin": `revenue.mjs` sends:
1. ATA creation for the operator's cbBTC ATA (operator pays).
2. `sweep_sol_for_swap` — pinned destination (swap_operator from config).
3. The Jupiter swap — sends the swept SOL wherever Jupiter routes. **This is the trusted hop.** The `FORBIDDEN` check lists `BPFLoaderUpgradeab1e...` and `MINT_PROG`. It does NOT forbid `SystemProgram` transfers to arbitrary keys, or SPL transfers to arbitrary token accounts. So a tampered Jupiter response could... well, the operator key signs whatever it signs. The check is a bound, not a proof ("This is a bound, not a proof"). Documented.

4. The return transfer: `createTransferCheckedInstruction(opAta, CBBTC, revAta, operator.publicKey, got, 8)` — from the operator's ATA to the revenue ATA. Pinned.

5. `split_revenue` — on-chain pinned.

Hmm — `revAta = getAssociatedTokenAddressSync(CBBTC, REVENUE, true)` (allowOwnerOffCurve). And `ataOf = w => getAssociatedTokenAddressSync(CBBTC, w, true)`. So `ataOf(bankWallet)` is the bank treasury's ATA. The program checks `bank_ata == expect(&cfg.bank_treasury)`. Good.

Now — **`split_revenue`'s `decimals: u8` argument**: `Buffer.from([8])`. The program uses it in `IX_TRANSFER_CHECKED`. If it were wrong, SPL would refuse (mint decimals mismatch). cbBTC has 8 decimals. OK.

Hmm, a real one: **the `cycle.splitSig = await sendAndConfirmTransaction(...).catch(async e => {...})`**. The `.catch` returns `undefined` if the ATA is provably empty. But `cycle.splitSig` is assigned the resolved value. If the catch path runs, `cycle.splitSig = undefined`. Then `cycleIsOpen` checks `!(c?.splitSig || c?.splitByOther)` — `splitByOther` is set to true in the catch. Good. But `cycle.finishedAt` is set regardless. OK.

But: if the split transaction fails for a DIFFERENT reason (e.g. a transient RPC error, not a program error), the catch checks `isProvablyEmpty(revAta)`. If the cbBTC is still there (not empty) → `throw e` → the cycle stays open → wedged. Good (fail closed).

If the split failed but ANOTHER caller split in between → the ATA is empty → `splitByOther = true` → closed. Good.

Hmm — what if the split transaction failed because of a transient error AND the revenue ATA is empty because the cbBTC was never returned? Then `isProvablyEmpty` is true → `splitByOther = true` → the cycle closes with `returnedSats = delta > 0`. But the money never made it to the revenue ATA! Wait — the return transfer succeeded (returnedSats is set after `returnSig` confirms). So the cbBTC WAS in revAta. Then the split failed. If revAta is empty, someone split. OK.

Hmm, but there's a subtle one: the return transfer sends `got = after` (the whole operator ATA balance), but records `returnedSats = delta`. If the operator ATA had leftovers from a previous cycle, `got > delta`. Then the split splits `got` (everything in revAta). The ledger records `returnedSats = delta`. `detectUnreconciledRevenue`'s `short_swap_return` compares `returned` to `quoted`. Fine.

Now — **the ledger is written by the same process holding the operator key** (documented, limit 10's mitigation is `detectUnledgeredSweeps`). Fine.

Now R6. THE GATES.

"Find assertions that cannot fail, floors that can be satisfied by deleting work, and checks that pass vacuously when their input is empty."

Let me look at `run-tests.sh`:
- `floor()` requires `n -eq expected`. And `MIN_ASSERTIONS=645` with `[ "$TOTAL" -eq "$MIN_ASSERTIONS" ]`. Good.
- `DET_FLOOR=458`, `ALLOC_FLOOR=31`, `POSTER_FLOOR=20`, `POB_FLOOR=14`, `LAUNCH_FLOOR=15`, `MAINNET_FLOOR=24`.
- The selftest's `FLOOR = 458` and `R.length !== FLOOR` → fail. Good.

Hmm — but `bank/selftest.mjs`'s floor is 458 and `DET_FLOOR=458` and the selftest asserts `selfFloor === det`. Good.

Now — **the poster floor**: `POSTER_OUT=$(node bank/redemption-poster.mjs --selftest) || die`. And `floor "poster" "$POSTER_OUT" '[0-9]+/[0-9]+ poster assertions' "$POSTER_FLOOR"`. The poster's selftest has... let me count the `t(...)` calls: formatAmount 5, releasedFrom 2, draftPost 1, judgeCopy 4, plus 3 more (three assets, empty vault, unknown asset, undrawn level) and the sender checks 2. Let me count precisely:

1. '21,000 sats renders as 0.00021 BTC'
2. 'one whole BTC renders without a fraction'
3. '1,234.5 $GARY keeps its separator and its half'
4. 'one base unit is not rounded away'
5. 'zero is zero'
6. 'reads the vault's own falls, including a CLOSED account'
7. '...and ignores an account that is not the vault's'
8. 'a full redemption reads as the Bank'
9. '...and passes every copy rule'
10. 'three assets are listed with commas and a final "and"'
11. 'an empty vault says so rather than inventing a figure'
12. 'an unknown asset is named by its mint, never guessed'
13. 'an undrawn level is refused, not posted as Level undefined'
14. 'an em dash is caught'
15. 'a link is caught'
16. 'an exclamation is caught'
17. 'an emoji is caught'
18. 'over 280 characters is caught'
19. 'this file contains no posting client (it must not be able to post)'
20. '...and the check can fail: a sender line IS caught'

That's 20. Matches POSTER_FLOOR=20. Good.

Hmm — the selftest's output line: `console.log(`\n${ok}/${R.length} poster assertions as predicted`)`. And the floor regex `'[0-9]+/[0-9]+ poster assertions'` with `grep -oE '^[0-9]+'`. The `floor()` function: `n=$(grep -oE "$3" <<<"$2" | grep -oE '^[0-9]+' | tail -1)`. The output line is `20/20 poster assertions as predicted`. `grep -oE '[0-9]+/[0-9]+ poster assertions'` matches `20/20 poster assertions`. Then `grep -oE '^[0-9]+'` on that gives `20`. Then `tail -1` = 20. Then `[ "$n" -eq 20 ]`. But wait — `grep -oE` on the string `20/20 poster assertions` with `'^[0-9]+'` — the `^` anchors at the start of each LINE. `grep -oE '^[0-9]+'` on "20/20 poster assertions" outputs "20". OK. But if the output has MULTIPLE matching lines, `tail -1` takes the last. Fine.

Hmm, but here's a subtle issue: `floor` reads the count from the "passed" numerator (`20/20` → first number is `ok`, the passed count). If assertions FAIL, `ok < R.length` and the numerator is lower. Then `n -eq expected` would fail. But also the selftest exits 1. So double protection. But what if the selftest exits 0 with a lower numerator? `process.exit(bad.length ? 1 : 0)` — so no. OK.

Hmm, what about `floor "detector selftest" "$DET_OUT" '[0-9]+/[0-9]+ detector assertions as predicted' "$DET_FLOOR"` — the selftest's line is `${R.length - bad.length}/${R.length} detector assertions as predicted`. So the numerator is the passed count. Good.

Now — **checks that pass vacuously when their input is empty**:

`detectVaultSetChange(null, ...)` → returns empty. Selftest asserts that. Fine.

`detectSplitClaims([], {cycles: []})` → empty. Fine.

Hmm — `judgeCronTemplate(cron)` returns [] — if the cron file had NO money jobs at all, `judgeCronTemplate` returns [] (vacuous pass). The selftest asserts `installs.map(...)` equals the 6 jobs. Good.

Let me look at the control-table judge:
```
t("every row's claim matches what actually enforces it",
    rows.filter(r => r.split('claims ')[1].split(',')[0] !== r.split(/(?:cron|source) says /)[1]), [])
```
Hmm. `r` is like `programs/cbob-vault-burn/src/lib.rs claims ON-CHAIN, source says ON-CHAIN`. `r.split('claims ')[1]` = `ON-CHAIN, source says ON-CHAIN`. `.split(',')[0]` = `ON-CHAIN` (note: with a trailing space? `'ON-CHAIN, source says...'.split(',')[0]` = `'ON-CHAIN'` — no trailing space since the comma immediately follows). Hmm, actually `claims ON-CHAIN, source says` — after `claims ` we have `ON-CHAIN, source says ON-CHAIN`. split(',')[0] = `ON-CHAIN`. Then `r.split(/(?:cron|source) says /)[1]` = `ON-CHAIN` (the part after "source says "). So they match. For the AUTOMATIC case: `bank/crank.mjs claims AUTOMATIC, cron says AUTOMATIC`. split('claims ')[1] = `AUTOMATIC, cron says AUTOMATIC`, split(',')[0] = `AUTOMATIC`. split(/(?:cron|source) says /)[1] = `AUTOMATIC`. Match. OK.

But `judgeRow` returns `${progs.join('+')} claims ON-CHAIN, source says ...` — note `progs.join('+')` could contain `, ` if multiple progs? `join('+')` uses '+'. OK.

And the filter: `rows.filter(...)` — if `rows` is empty (no table rows found), the filter returns [] → vacuous pass. But `t('the control table header is still findable, with rows', block.length >= 5, true)` guards that. And `t('EVERY row in the control table block carries a classification', block.filter(l => !isTableRow(l)), [])`. Hmm, `block` is everything from `h+2` while lines start with '|'. If the header regex `^\| control \| what it catches \| when \|` doesn't match, `h = -1` and `controlTableBlock` returns... `for (let i = h + 2; i < lines.length && lines[i].startsWith('|'); i++)` → `i = 1`. If line 1 starts with '|', it collects from there. Hmm, that could collect garbage. But then `block.length >= 5` and `isTableRow` checks would likely fail. OK.

Hmm — the actual SPEC.md control table header is `| control | what it catches | when | **does anything RUN it?** |`. The regex is `/^\| control \| what it catches \| when \|/`. Matches. Good.

Now the `errorVariants` function: `src.match(/#\[error_code\]\s*pub enum \w+ \{([\s\S]*?)\n\}/)`. For MINT's `#[error_code] pub enum MintError { ... }` — the closing is `\n}`. And the variants are matched by `/\)\]\s*(\w+),/g` — i.e. `#[msg("...")] VariantName,`. The regex `/\)\]\s*(\w+),/` matches `)] VariantName,` — from the `)]` of `#[msg("...")]`. Yes. So `NotTheGuardian` should be found. The selftest asserts `errorVariants('programs/cbob-vault-mint/src/lib.rs').has('NotTheGuardian')`. Good.

Hmm — but this only validates the SPEC's control table against the error enums. Fine.

Now the cron preservation block extraction:
```
const from = cron.indexOf('ours() {')
const to = cron.indexOf('grep -v "$TAG" <<<"$CUR"')
const logic = cron.slice(from, to)
```
and then runs it in bash. That's a real execution. OK.

Hmm, `t('the template installs exactly the six v6 jobs', installs.map(l => l.match(/\$TAG (\S+)$/)?.[1]).sort(), ['crank','crank-reveal','deadman','reconcile','revenue','watcher'])`. Good.

Now — **the signer-set check**:
```
const sigPat = new RegExp(['from', 'Secret', 'Key'].join(''))
const signerSet = extra => [...srcFiles, ...(extra ? [extra] : [])]
    .filter(x => sigPat.test(x.src))
    .map(...)
```
This finds files containing `fromSecretKey`. But it only checks `bank/*.mjs`, `scripts/*.mjs|sh`, `tests/*.ts`. It does NOT check `sim/*.ts` (the Test Vault simulation) or any other directory. And it doesn't check for `Keypair.generate()`, `fromSeed`, `nacl.sign`, `bs58.decode(secret)`, etc. So a signer created via `Keypair.fromSeed(...)` or `tweetnacl` would not be caught. Hmm. The claim is "exactly TWO signers exist in v6". `fromSecretKey` is the only way to turn stored bytes into a Keypair, but `fromSeed` is another. And the `srcFiles` list doesn't include `sim/`. Let me note that as a gate weakness (R6): **the signer-set gate scans only bank/, scripts/ and tests/, and only for `fromSecretKey` — a signer in `sim/` or built with `fromSeed`/`fromSeed`/raw ed25519 passes silently.** Also `bank/redemption-poster.mjs`'s own selftest scans only ITSELF for a sender. And the `SENDER` regex is assembled from parts — good.

Hmm, also: `srcFiles` includes `bank/selftest.mjs` itself. And `spelled(selfSrc)` checks that the forbidden literals aren't spelled out in selftest.mjs. Good.

Now, let me look for assertions that CANNOT fail.

In the selftest:
```
t('...and the check is looking at something that can be absent',
    /if \(s\.err\) continue/.test(alarmSrc.replace('if (s.err) continue', 'if (false) continue')), false)
```
Hmm, `alarmSrc.replace(...)` replaces the first occurrence. If the source has `if (s.err) continue` and we replace it with `if (false) continue`, then the test `/if (s\.err\) continue/` should be false. Good — that's a both-ways check.

```
t('...and a stale number at a LATER occurrence is caught, not just the first', ...)
```
OK.

Hmm:
```
t('...and the import scanner can see an import (both ways)',
    importsOf("import * as X from './" + "deck.mjs'"), ['deck.mjs'])
```
Good.

Let me look at:
```
t('every collection key the standing checks read is in the watch list',
  D.COLLECTION_KEYS.filter(k => !D.WATCHED_KEYS.includes(k)), [])
```
Fine.

Now:
```
t('a reader producing all of them is quiet',
  D.missingWatchedKeys(Object.fromEntries(D.WATCHED_KEYS.map(k => [k, 'x']))), [])
```
`missingWatchedKeys` skips `prog.*` keys and maps `collection`/`pob_collection` to `mint`. But it checks `snap?.[`${prog}._missing`]`. For a full snapshot with all keys set to 'x', nothing is missing. Good.

Hmm — `missingWatchedKeys`'s `prog` derivation: `k.split('.')[0]`. For `collection.plugins_hash`, prog = 'collection' → mapped to 'mint'. So it requires `snap['collection.plugins_hash']` to be produced. And `readConfigs` produces it only `if (snap['mint.collection'])`. If MINT is deployed but `mint.collection` is somehow absent... `readPinned` would have produced `mint.collection`. OK.

Hmm — what if the collection account is ABSENT on chain? `snap['collection.plugins_hash'] = acc ? ... : 'ABSENT'`. So it's produced. Good.

Now let me look at a potentially vacuous check:
```
t('alarm.mjs calls every v6 detector', V6_WIRED.filter(n => !calls(alarmSrc, n)), [])
```
`calls = (src, n) => new RegExp(`D\\.${n}\\(`).test(src)`. If a detector is called in a COMMENT, it passes. Hmm — `alarmSrc` includes comments. E.g. `D.detectPoolHealth` might appear in a comment. Let me check alarm.mjs... The comment "this detector is what actually covers" etc. Does any comment mention `D.detectX(`? Looking at alarm.mjs comments: "that is what `detectNestedVaults` and `detectUndeclaredTokenAccounts`, which ARE the post-hoc half..." — those are in detectors.mjs comments, not alarm.mjs. In alarm.mjs: "D.detectUnledgeredSweeps" appears in code. Hmm, `findings.push(...D.detectPoolHealth(cfg, pool))` is code. I think all are code. But the gate would pass on a comment. Minor. Actually the `code()` helper exists for the DAS check but not for this one. So: **the "alarm.mjs calls every v6 detector" gate matches comments too** — a detector whose only mention is in prose passes. LOW, but it's exactly the class this project keeps finding. Worth a LOW.

Now — a bigger one. Let me look at the `floor()` regex extraction more carefully:
```
floor(){ local n; n=$(grep -oE "$3" <<<"$2" | grep -oE '^[0-9]+' | tail -1) ... }
```
For the on-chain suite: `LINE=$(grep -oE '^[0-9]+/[0-9]+ as predicted' <<<"$OUT" | tail -1)` then `PASSED=${LINE%%/*}; TOTAL=$(sed 's#^[0-9]*/##; s# .*##' <<<"$LINE")`. Then `[ "$PASSED" = "$TOTAL" ]` and `[ "$TOTAL" -eq "$MIN_ASSERTIONS" ]`. Good.

Hmm — `OUT=$(cd "$ROOT" && timeout 7200 npx tsx ...2>&1 | tee "$SUITE_LOG") || RC=$?`. With `set -o pipefail`, `RC` is the pipeline's status. Actually `set -euo pipefail` is at the top. So `OUT=$(...)` — the command substitution's exit status is the pipeline's (with pipefail, the last non-zero). `|| RC=$?` captures it. OK.

Now let me look at the accrual selftest floor: `ALLOC_FLOOR=31` and the accrual's selftest prints `${ok}/${R.length} allocation assertions as predicted`. Let me count `t(...)` calls in accrual.mjs's selftest: weights 6, "one distribution" 6 (pays, ratio, sums, owed, claimed) — let me count: 
- weights: 6 t-calls (Level I weighs 2, Level V weighs 6, 3x, level 0 throws, level 6 throws, non-integer throws) = 6
- one distribution: 'pays exactly', '...which is 1:1.5', '...and sums', 'owed is exactly', 'a claimed vault is owed nothing more' = 5
- dust: '7 sats over weight 20', '...but the Level V', 'the pool keeps ceil', 'after ten such drops', 'nothing is ever owed beyond', '1 sat over weight 3 credits', '...and owed never exceeds' = 7
- timing: 'a vault activated after', '...and shares in the next' = 2
- the pool: 'available = balance - ceil', 'a pool holding exactly', 'a SHORT pool', 'ceil of an exact multiple', 'ceil of one scaled unit' = 5
- frozen and retired: 'a deferred (frozen)', 'retiring it returns', 'a debt above entitlement', 'crediting with no activated weight' = 4

Total: 6+5+7+2+5+4 = 29. Hmm, but ALLOC_FLOOR=31. Let me recount.

Weights:
1. t('Level I weighs 2', ...)
2. t('Level V weighs 6', ...)
3. t('Level V is exactly 3x Level I', ...)
4. t('level 0 (not yet drawn) has no weight', ...)
5. t('level 6 does not exist', ...)
6. t('a non-integer level is refused', ...)
= 6

Then:
7. t('the 240-vault charter census 108/60/36/24/12 weighs 732', ...)
8. t('the 2,100-vault census 945/525/315/210/105 weighs 6,405', ...)
= 2 more. Total 8.

One distribution:
9. t('pays exactly 2,000 / 3,000 / ...', ...)
10. t('...which is 1 : 1.5 : 2 : 2.5 : 3', ...)
11. t('...and sums to exactly what was distributed', ...)
12. t('owed is exactly the distributed amount, scaled', ...)
13. t('a claimed vault is owed nothing more', ...)
= 5. Total 13.

Dust:
14. t('7 sats over weight 20 pays no whole sat to a Level I yet', ...)
15. t('...but the Level V is owed 2 (6 x 0.35 = 2.1)', ...)
16. t('the pool keeps ceil(owed) for it: 7', ...)
17. t('after ten such drops the Level I is owed 7 (10 x 0.7)', ...)
18. t('nothing is ever owed beyond what was distributed (70)', ...)
19. t('1 sat over weight 3 credits acc = floor(1e12/3)', ...)
20. t('...and owed never exceeds what the pool received', ...)
= 7. Total 20.

Timing:
21. t('a vault activated after a drop is owed nothing from it', ...)
22. t('...and shares in the next one by its weight', ...)
= 2. Total 22.

The pool:
23. t('available = balance - ceil(owed)', ...)
24. t('a pool holding exactly what it owes has nothing to distribute', ...)
25. t('a SHORT pool reads as 0 available here', ...)
26. t('ceil of an exact multiple is exact', ...)
27. t('ceil of one scaled unit over is one more sat', ...)
= 5. Total 27.

Frozen and retired:
28. t('a deferred (frozen) vault is still owed in full on the next look', ...)
29. t('retiring it returns exactly its share to the pool', ...)
30. t('a debt above entitlement is refused, not paid negative', ...)
31. t('crediting with no activated weight is refused', ...)
= 4. Total 31. 

So31. Matches ALLOC_FLOOR=31. Good.

Hmm, but note: the SPEC says "31 allocation" in "Running the tests" and the accrual selftest prints "allocation assertions as predicted". But SPEC's distribution section says "since v5's `bank/distribute.mjs --selftest` was deleted **no selftest asserts them** any more; they are a copy of a fact again" — referring to the published card's census figures (732 and 6,405). But accrual.mjs's selftest DOES assert them (items 7 and 8 above: 'the 240-vault charter census 108/60/36/24/12 weighs 732' and 'the 2,100-vault census ... weighs 6,405'). So SPEC's statement "no selftest asserts them any more" is FALSE — accrual.mjs asserts them. That's a doc/code contradiction. Is that a finding? It's an under-claim in the docs ("a comment asserting a control that does not exist — and, once, under-claiming one that did"). It's the opposite: the doc claims NO assertion exists when one does. LOW, but per the project's own rules that's worth naming. Actually the task says report where HOLDER-GUIDE.md promises something the code does not do, and where the code fails a ruling. A SPEC error is minor. I'll note it as LOW.

Now let me check the POSTER_FLOOR claim vs SPEC: SPEC says "20 poster". run-tests says POSTER_FLOOR=20. Good.

Now, back to more substantive findings.

Let me re-examine `planCrank`'s `preJoins` and the `waitingThisEpoch`/tick logic for a bug.

```
const waitingThisEpoch = BigInt(cfg.pending_this_epoch ?? 0) > 0n
if (poolOk && due && w > 0n) {
    const avail = available(pool.amount, cfg.owed_scaled)
    if (avail > 0n) { plan.distribute = true; plan.distributeKind = 'credit'; acc += ... }
} else if (poolOk && due && w === 0n && waitingThisEpoch) {
    plan.distribute = true; plan.distributeKind = 'tick'
}
```

Note: if `due && w > 0n && avail === 0n`, no distribute. Fine (the program would refuse NothingToDistribute).

If `due && w === 0n && !waitingThisEpoch` → no distribute. But what if there are preJoins (eligible waiting vaults)? Then `w = total_active_weight + preJoinWeight > 0` (preJoinWeight > 0). So the first branch is taken. OK.

What if `due && w > 0n` but `waiting_to_join > 0` on chain and the preJoins FAIL? Then the distribute is still sent → `JoinWaitingFirst` error → FAIL + page. Covered earlier.

Hmm — what if there are preJoins but `due` is false? Then no distribute, but preJoins are still sent. Joining before a distribution is... the program's `join` requires `dist_epoch > request_epoch`. preJoins have `request_epoch < dist_epoch`. So they join. Good. But the design says "join eligible vaults BEFORE distributing (the program refuses otherwise)" — and joining early (before the next distribution) is exactly right: they get `debt = w * acc` at the current acc, so they're excluded from prior distributions. Good.

Hmm — WAIT. There's a subtle issue with `preJoins` and the in-line monthly. The preJoin `claim` calls `monthly_inline` FIRST. If the month is due and `waiting_to_join > 0`, `monthly_inline` returns early with `CBOB_MONTHLY_WAITS_FOR_JOINS`. Then the claim joins them. Good. But if the month is due and `waiting_to_join == 0` (no preJoins — contradiction), fine.

Hmm, but here's the thing: `plan.preJoins` is computed from `request_epoch < dist_epoch`. And `waiting_to_join` = `pending_count - pending_this_epoch`. Are these the same set? `pending_this_epoch` = count of pending vaults with `request_epoch == dist_epoch`. So `pending_count - pending_this_epoch` = pending with `request_epoch != dist_epoch`. Since `request_epoch <= dist_epoch` always (it was set to the then-current epoch), `request_epoch != dist_epoch` ⟺ `request_epoch < dist_epoch`. Yes. Same set. Good.

But `pending_this_epoch` is decremented in `retire` when `r.request_epoch == c.dist_epoch`. And reset to 0 on credit/tick. OK.

Now — a REAL divergence candidate: the crank's `plan.joins` uses `BigInt(r.request_epoch) !== BigInt(cfg.dist_epoch)` — the CURRENT dist_epoch at plan time. But if the distribute runs, `dist_epoch` becomes `cfg.dist_epoch + 1`. The joins need `dist_epoch > request_epoch`. `request_epoch == cfg.dist_epoch` (old) < new dist_epoch. Good.

But if `plan.distribute` is a TICK (w == 0), the tick advances dist_epoch too. And then the joins (request_epoch == old dist_epoch) become eligible. But the tick branch requires `pending_this_epoch > 0`, and those are exactly the vaults with `request_epoch == dist_epoch`. So `plan.joins` = those vaults. Good. And the tick resets `pending_this_epoch = 0`. Then the claim joins them. Good.

Hmm — but the crank sends the joins as part of `plan.claims`, which is only built `if (poolOk && !pool.frozen)`. And `ready.push(...plan.joins)`. So if the pool is frozen, NO joins are sent! But joining doesn't need the pool... well, `claim` requires `pool_token` and calls `monthly_inline` which needs the pool. And the join happens inside `claim`. With a frozen pool, `monthly_inline` returns Ok early (frozen check is after the balance read... let me check: `if pool.owner != SPL_TOKEN return Ok; ... if d[TOKEN_STATE_OFF] == FROZEN { return Ok(()) }`). So monthly_inline returns Ok. Then the claim loop joins the pending vaults (join doesn't transfer). So a join WOULD work with a frozen pool. But the crank doesn't plan any claims when the pool is frozen → no joins → `waiting_to_join` stays > 0 → every distribution is refused (`JoinWaitingFirst`) → and `detectDistributionOverdue`... `poolAvail` for a frozen pool: `pool?.state === 'ok'` → `poolAvailable(cfg, pool.amount)`. `readPool` sets `frozen` but `state: 'ok'`. So poolAvail could be > 0. And `w` — if nobody can join, `total_active_weight` might be 0 or stale. Hmm.

So: **a frozen pool (accepted limit 28) blocks the crank from sending joins, which blocks every distribution (`JoinWaitingFirst`), which is a self-reinforcing stall the alarm reports as `joins_waiting` at INFO and `distribution_overdue` at CRITICAL only if `w > 0`.** Hmm, that's an interaction of accepted limits. Let me check `detectDistributionOverdue` again — it needs `w > 0`. If there ARE active vaults (w > 0) and the pool is frozen and there are waiting joins, then: distribution due → `waiting_to_join > 0` → the program refuses → `distribution_overdue` fires after the grace. So it pages. OK. And `pool_frozen` fires CRITICAL/URGENT. So it's covered.

But the crisper issue: **the crank's `planCrank` puts `plan.joins` inside the `if (poolOk && !pool.frozen)` block**, so a frozen pool blocks JOINING, which is not actually blocked on chain. The joins are free and don't move value. So the crank fails to make progress it could. Result: `JoinWaitingFirst` wedges every distribution until the pool thaws — even though joining works fine. That's a real defect: an accepted limit (frozen pool) is made WORSE by the crank's gating. Per the task: "Is any limit WORSE than stated?" — Limit 28 says "A frozen POOL stops every claim until it is thawed." But actually it also stops every DISTRIBUTION (because the crank won't join, and `JoinWaitingFirst` refuses), and the doc says the in-line monthly "never credits from a frozen pool" — but the explicit `distribute` would also be refused by `JoinWaitingFirst`. Hmm, and the doc says "An explicit `distribute` is not refused for a frozen pool; it can only make vaults owed again". But it IS refused while `waiting_to_join > 0`. And the crank won't join while frozen. So a frozen pool + pending joins = total distribution stall, worse than "stops every claim". Actually is it worse? Claims are stopped anyway. The distribution being stopped means vaults don't accrue. When the pool thaws, the next distribution credits everything at once. So the money isn't lost. Hmm. It's a liveness worsening. I'll file it as MEDIUM under "accepted limits worse than stated" or as a crank finding.

Actually wait — more precisely: the `ready.push(...plan.joins)` inside the frozen guard. Let me re-read:

```
  if (poolOk && !pool.frozen) {
    const ready = []
    for (const r of records) { ... }
    ready.push(...plan.joins)
    for (let i = 0; i < ready.length; i += batch) plan.claims.push(ready.slice(i, i + batch))
  }
```

Yes. And `plan.joins` is computed BEFORE that block (in the `if (plan.distribute)` block). So joins are computed but only SENT if the pool is not frozen. Right. And `plan.preJoins` are sent unconditionally (before the distribute). So preJoins (eligible, request_epoch < dist_epoch) ARE sent even when frozen; only post-distribute joins are gated. Hmm! So `preJoins` go through. And `plan.joins` (request_epoch == dist_epoch, becoming eligible after THIS pass's distribute) are gated. But if the pool is frozen, `plan.distribute` would... `poolOk && due && w > 0` where `w = total_active_weight + preJoinWeight`. If the pool is frozen but `state === 'ok'`, `poolOk` is true (the plan's `poolOk = pool && pool.state === 'ok'` — it does NOT check frozen for poolOk; it pushes a problem if frozen but still allows distribute!). Let me re-read:

```
  const poolOk = pool && pool.state === 'ok'
  if (!poolOk) plan.problems.push(...)
  else if (pool.frozen) plan.problems.push('the pool cbBTC account is FROZEN; claims would all refuse')
  ...
  if (poolOk && due && w > 0n) { ... plan.distribute = true ... }
```

So with a frozen pool, `plan.distribute` can still be true! And `runDistribute` sends it. The program's `distribute` with w > 0: reads the pool balance (`read_token` requires `a.owner == SPL_TOKEN_ID` and checks mint/owner — a FROZEN account still reads). `avail = balance - owed`. If avail > 0 and no waiting joins → `credit`. So **the crank WILL distribute from a frozen pool** — crediting vaults that can't be paid. The doc says "the in-line monthly run never credits from a frozen pool. An explicit `distribute` is not refused for a frozen pool; it can only make vaults owed again, and owed vaults still redeem by the same forfeit." So this is documented and accepted. OK. And then `plan.joins` would be gated off (frozen) → `waiting_to_join` stays > 0 → the NEXT distribute is refused. Hmm, but this pass's distribute already ran... and `plan.joins` are the vaults made eligible BY this distribute. They're not sent. So they stay waiting. Next pass: they're preJoins (request_epoch < dist_epoch now) → sent unconditionally. OK, so it resolves one pass later. Fine.

Hmm, actually if the pool is frozen, this pass: distribute (credits), joins not sent. Next pass: preJoins sent (unconditional) → they join. Then claims are gated off (frozen). OK. So it's a one-pass delay. Not a big deal. Let me not over-claim.

Let me now focus on the biggest things.

**Finding: the `readySlot`/capture optimism → wasted fees + false pages.** Let me re-verify with the code.

`planCrank`:
```
    if (r.level !== 0 || r.entropy_set) continue
    const rs = BigInt(r.reveal_slot)
    if (BigInt(slot) > rs + BigInt(L.REVEAL_WINDOW_SLOTS)) plan.reschedule.push(r.address)
    else if (slot > readySlot(r.reveal_slot)) { plan.capture.push(r.address); capturedThisPass.add(r.address) }
```

Hmm — `slot > readySlot(r.reveal_slot)`. `readySlot` returns a Number. `slot` is a Number. OK.

But note: `slot` is compared with `rs + window` using BigInt for reschedule and with `readySlot(...)` as a Number for capture. Fine.

Now the program's `capture_entropy`: `try_capture(sh, r.reveal_slot, now, &r.asset)`. `now = Clock::get()?.slot`. `if now <= reveal_slot → NotYet`. `if now > reveal_slot + 300 → Expired`. Otherwise it looks for the three hashes.

So the crank's capture at `slot > readySlot(reveal_slot)`:
- If `readySlot(reveal_slot) >= reveal_slot + 300`, the capture would be Expired → but then the reschedule branch would have caught it first? `reschedule` if `slot > rs + 300`. `readySlot(reveal_slot)` ≈ reveal_slot + 16 (at least). So `slot > readySlot` and `slot <= rs+300` → capture. Fine.

So the capture is attempted in the window. The question is whether the three hashes exist. As computed, `readySlot` assumes no skips. With a skipped group, the hashes are later → `NotYet` → `RevealTooEarly` error → FAIL + page + wasted fee.

How likely is a whole leader group (4 slots) to be skipped? On mainnet, leader skips happen. The `blockhash_in_window` allows `MAX_SKIPPED_SLOTS = 64` slack, so a single skipped slot just picks the next produced one — but that shifts the GROUP computation. Let me redo: A = smallest produced in [reveal_slot, reveal_slot+64]. Suppose reveal_slot = 1000 and slot 1000 is produced → A = 1000, group 250. want_B = (250+2)*4 = 1008. B = smallest produced in [1008, 1072]. If 1008 is skipped but 1009 produced → B = 1009, group 252 (1009/4 = 252). want_C = (252+2)*4 = 1016. Same as readySlot. Good. If 1008-1011 all skipped → B = 1012, group 253. want_C = (253+2)*4 = 1020. readySlot = 1016. So at slot 1017-1020, C not yet. Capture attempt at 1017 → NotYet → error.

Also if A is pushed: reveal_slot 1000 skipped, 1001 produced → A = 1001, group 250. Same. If 1000-1003 skipped → A = 1004, group 251. want_B = (251+2)*4 = 1012. B ≥ 1012, group 253. want_C = 1020. readySlot(1000) = 1016. So at 1017, capture fails.

So a skip of a full 4-slot leader group anywhere in the A..C span (which is ~16 slots) shifts C past readySlot. Leader skips of 4 consecutive slots do happen (a leader going offline skips all 4 of its slots). So this is a realistic, recurring operational failure: **every time a leader group is skipped in the ~16-slot entropy span, the crank's capture and reveal both fail with `RevealTooEarly`, costing two fees and sending "CBOB crank: N action(s) failed" SMS.** And the reveal is attempted because `capturedThisPass` included it. And then `if (!ok) { failures.push; break }` — so the whole reveal lane stops at that vault and subsequent reveals aren't sent (correct for FIFO, but they're also skipped this pass).

Actually hold on. Let me re-read the reveal I/O:

```
  for (const a of plan.reveal) {
    const r = byAddr.get(a)
    let list = []
    if (assets[r.asset] === 'live') { list = await mintedAttributes(...); if (attrsHash(list) !== r.attrs_hash) { ...; break } }
    const ok = await send(`reveal #${r.mint_index} ${r.asset}`, [...])
    if (!ok) { failures.push(`reveal ${r.asset}`); break }
  }
```

And `reveal_level` with entropy_set false will try `try_capture` inline → NotYet → `RevealTooEarly`. So yes, the reveal fails too.

So one skipped leader group → 2 failed transactions, 2 fees, and a page. That's a solid MEDIUM finding ("a plan the program will refuse (wasted fees, false pages)").

Fix: before sending a capture/reveal, read the SlotHashes sysvar in the crank and verify all three hashes exist (the crank already knows the algorithm), or treat `RevealTooEarly`/`RescheduleTooEarly` as benign (log, don't page, retry next pass) and don't chain the reveal on a planned capture.

Good. Now let me look for more.

**`judgeFeePayer`**: `if (l > ceiling) refuse; if (l < floor) refuse`. `FEE_CEILING_LAMPORTS = 250_000_000n` = 0.25 SOL. But the comment says "0.25 SOL". 250,000,000 lamports = 0.25 SOL. Yes. And `FEE_FLOOR_LAMPORTS = 5_000_000n` = 0.005 SOL. OK.

Hmm — but the crank's `judgeFeePayer` is only called ONCE at the start of a live run. A long run could drain below the floor. Not a safety issue.

**The crank's lock**: `withLock(LOCK, main, { staleMs: 2 * 3600_000 })`. The lock file name differs for `--reveal-only`. Good. But `main` reads `fs.readFileSync('/opt/gary-club/.env.local')` — hardcoded paths. Fine.

Hmm — `NOTIFY = '/opt/scripts/notify-gary-sms.sh'` and `execFileSync(NOTIFY, [msg, 'cbob-vault-crank'])`. Fine.

**The crank's `plan.problems` are printed but NOT paged.** `describePlan` prints them. But in live mode, `problems` don't go into `failures`, so no SMS. So "vault X is owed N sats but its recorded cbBTC account is ... left out of every batch" is printed to the log and never paged. Hmm — is that a "dangerous state it reads as quiet"? A vault that can never be paid because its recorded ATA is missing/wrong. The alarm... `detectPoolHealth` doesn't see it. `claim_deferred_frozen` sees frozen. A MISSING recorded account would cause the plan to skip it forever and only print to the log. Hmm — but how would `vault_ata` be missing? It's set at activation to the canonical derived ATA. `tokens[r.asset]` for an active vault is `readTokenAccount` of `r.vault_ata`. If the account was CLOSED (can a vault's cbBTC ATA be closed? The owner is the vault's asset-signer PDA, which can't sign... so nobody can close it). So it can't disappear. Unless it never existed — but activation requires `amount >= 21000`, so it existed. OK, so it's a theoretical path. LOW.

Hmm — but `t.address !== r.vault_ata` check: `tokenAddr(r) = r.active ? r.vault_ata : ataOf(...)`. So for active vaults, `t.address` IS `r.vault_ata` by construction! `tokens[r.asset] = { ...t, address: tokenAddr(r), ...}`. So `t.address !== r.vault_ata` is NEVER true for an active vault. So that check is **vacuous** — an assertion that cannot fail. Hmm, it's in `planCrank`, not a test. But it's a check that can never fire. Let me verify:

```
  const tokenAddr = r => r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset)).toBase58()
  ...
  tokens[r.asset] = { ...t, address: tokenAddr(r), frozen: ... }
```

and in planCrank:
```
      const t = tokens[r.asset]
      if (!t || t.state !== 'ok' || t.address !== r.vault_ata) {
        plan.problems.push(`vault ${r.asset} is owed ${owed} sats but its recorded cbBTC account ${r.vault_ata} is ${t ? t.state : 'unread'}...`)
```

So `t.address` is `tokenAddr(r)` = `r.vault_ata` when `r.active`. And the loop only considers `r.active` vaults. So `t.address !== r.vault_ata` is always false. The check is dead. But `t.state !== 'ok'` is live (absent/foreign/malformed). And `!t` is live. So the problem message is reachable via state. But the "or its recorded account is not the one we read" part is dead code. Also — hmm, is that a problem? It means the crank does NOT actually verify that the token account it read is the recorded one; it derives the read address FROM the record. So if the record's `vault_ata` were wrong (pointing at someone else's account), the crank would happily read it and pay into it. But the PROGRAM checks `dest.key() == r.vault_ata`. So the program pins it. The crank's "check" is decorative. It's a selftest-able claim? No, the selftest DOES test: `'...and a destination that is not the RECORDED account is refused the same way', plan({... tokens: { [A(0)]: tok(0n, { address: 'NotAta0' }) } }).claims, []`. Hmm! The selftest passes `tokens: { [A(0)]: tok(0n, { address: 'NotAta0' }) }` — a synthetic input where `address` differs from `vault_ata`. So the DETECTOR works on synthetic input. But the REAL wiring (`tokenAddr`) always sets `address = r.vault_ata`. So the check can never fire in production. That's the "wiring untested" class: the detector is proven both ways, but its production wiring can never exercise the failing branch. Worth a LOW/MEDIUM under R6 ("assertions that cannot fail"). Actually more precisely it's under R1/R6: the crank's guard is unreachable in the real I/O. I'll file it as LOW with the note that the guard is fine to keep but the claim "a missing recorded account would refuse the WHOLE batch on chain, so it is reported instead of sent" is about `state !== 'ok'`, which IS reachable.

Hmm, hold on. Let me reconsider. `tokenAddr(r) = r.active ? r.vault_ata : ataOf(payMint, signerPda(r.asset)).toBase58()`. So the read address IS the recorded one. So the only way `t.address !== r.vault_ata` is if `r.active` is false — but then the vault isn't in the claim loop. So dead. Yes.

OK. Now let me look at the alarm's `readPool` and `detectPoolHealth`.

`readPool(cfg)` → `readTokenAccount(info)` → `{state, amount}` + `frozen`. `detectPoolHealth(cur, tok)`: `tok.state !== 'ok'` → pool_unreadable. `tok.frozen` → pool_frozen. `owed !== null` → compare. Fine.

Hmm — `detectPoolHealth`'s `pool_insolvent` uses `BigInt(tok.amount) < owedCeil`. `tok.amount` is a BigInt from `readTokenAccount`. OK.

Now — **`detectStandingRisks`'s `sweep_bound_ineffective`**: `BigInt(cap) === 0n`. But `cap` is a string from flatten. `BigInt('0')` = 0n. OK. But what if `cap` is undefined? `cap !== undefined && BigInt(cap) === 0n` — guarded. OK.

Now, let me look at something important: **`alarm.mjs` passes `{ production: true }` unconditionally.** I noted this. Combined with the dress rehearsal (step 8 in the road), the alarm would page CRITICAL on `test_value_in_production` continuously. Also, the dress rehearsal uses "throwaway program ids" — but `alarm.mjs` hardcodes `SEAL`, `MINT`, `BURN`, `GOV` as CONSTANTS (the production program ids). So the alarm cannot watch the dress rehearsal at all! Look:

```
const SEAL = new PublicKey('9YKVPrd2WJ8ea1PifQ8yWTX3romkFauSSBFmV1UFw273')
const MINT = new PublicKey('Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo')
```

These are hardcoded. And `L.PROGRAM_IDS` in layout.mjs are also hardcoded. So the dress rehearsal (step 8: "throwaway program ids, small real amounts, the crank and alarm live") CANNOT have the alarm live against the throwaway ids — the alarm reads the production PDAs. Unless the rehearsal deploys at those exact ids. Hmm — "throwaway program ids" implies different ids. So the alarm would read absent configs → "mint config not initialised — nothing to watch yet" and report `idle` — with `report(..., idle=true)` and the message "nothing deployed yet — this is not an all-clear". So during the dress rehearsal the alarm is BLIND. And the crank too: `const MINT = P(L.PROGRAM_IDS.mint)` — hardcoded. And `revenue.mjs` hardcodes `MINT_PROG`. So **none of the off-chain pipeline can run against the dress rehearsal's throwaway program ids without editing the source**, which contradicts the stated plan ("the crank and alarm live" in step 8). That's a real finding: the road map's step 8 is not achievable with the code as written. HIGH-ish (process), or MEDIUM. Evidence: `bank/alarm.mjs` line with `const MINT = new PublicKey('Gsb7...')` and `bank/layout.mjs` `PROGRAM_IDS`. Fix: take program ids from a config/env, or deploy the rehearsal at the production ids on a test cluster, or state that the rehearsal edits these constants.

Hmm, but wait — maybe the dress rehearsal runs on mainnet with throwaway program ids (real deployments at new addresses) and the pipeline is pointed at them by editing. The SPEC says "Mainnet dress rehearsal: throwaway program ids, small real amounts, the crank and alarm live". If the ids are throwaway, the pipeline must be re-pointed. Since they're hardcoded constants, re-pointing means a source edit. And `bank/selftest.mjs` pins `PROGRAM_IDS`... and the signer-set gate and the layout. So an edit is possible but it's a real operational gap. I'll file it as MEDIUM and name the evidence.

Hmm, is this too speculative? The prompt says "find a plan the program will refuse... and anything that makes it move value anywhere the program does not already pin" for R1. For the overall section, this is "anything else". I think it's a legitimate finding: the alarm and crank hardcode program ids, so item 22's dress rehearsal cannot exercise them as written. I'll phrase it carefully with the evidence.

Let me keep looking for sharper things.

**`layout.mjs` `flatten`**: `str = v => typeof v === 'bigint' ? v.toString() : v`. For a BigInt array: `v.map(str)`. OK. For a plain number (u8, u16, u32): stays a number. For booleans: stays boolean. For Pubkey strings: stays. For hex strings ([u8;32]): stays.

Then `detectConfigDrift` compares `JSON.stringify(prev[k] ?? null)`. For arrays of strings, fine.

Hmm — `readConfigs`'s `L.flatten(key, L.readPinned(...))`. `readPinned` returns `null` if the account is absent. Then `flatten(key, null)` → `Object.entries(null || {})` → `{}`. So NOTHING is produced for that program. And `missingWatchedKeys` checks `snap?.[`${prog}._missing`]`. But `g()` sets `snap[`${key}._missing`] = true` when absent. Good.

Now — **`detectUpgradeAuthorityAfterLock`** with `v === undefined → continue`. And `missingWatchedKeys` skips `prog.*` keys entirely (`if (prog === 'prog') return false`). So a missing `prog.*.upgrade_authority` is never caught. But `readConfigs` always produces it (or throws). Except when the ProgramData account is missing and `name !== 'core'` → `snap[`prog.${name}._missing`] = true` and `continue` — so `prog.seal.upgrade_authority` is NOT produced! And `missingWatchedKeys` skips `prog.` keys. So if SEAL's ProgramData is absent (not deployed), no authority key. Fine.

But for `core`, it produces `NO_PROGRAMDATA`. Fine.

OK. Now — an important one I want to check: **`detectConfigDrift` on `mint.guardian` fires CRITICAL when a voted guardian change lands.** But also `mint.pending_guardian_set` going true→false on `apply_guardian`. Both are watched. So a legitimate, voted guardian change produces: `guardian_armed` CRITICAL for 7 days (every pass), then `config_drift` CRITICAL on `mint.guardian` and `mint.pending_guardian*`. That's a lot of pages for a legitimate action. Acceptable (security-relevant).

Now let me look at **`detectProgramEvents` and `parseCbobLogs`** attribution. The `owner` map: `REDEEMED: ids.burn`. The stack tracking: `Program (\w+) invoke [(\d+)]` pushes, `Program (\w+) (success|failed.*)` pops. But a program's log lines appear AFTER its invoke and BEFORE its success. And CPI: `Program X invoke [2]` pushes X. So `stack[stack.length-1]` is the innermost program. For `CBOB_DISTRIBUTED` printed by MINT inside BURN's `burn_vault` → at that moment the stack top is MINT. Good. But `msg!` lines from MINT when called at the top level → stack top is MINT. Good.

Hmm — but what about the "Program data:" lines and "Program log:" from a program that failed? Fine.

What about `Program <id> failed: ...` — the regex `^Program (\w+) (success|failed.*)$` matches. And it pops. Good.

Hmm, what if a program is invoked but the log has `Program X invoke [1]` then `Program Y invoke [2]` then `Program Y success` then `Program X consumed ...` then `Program X success`. Fine.

What about "Program log: CBOB_..." printed BEFORE any invoke? `stack[stack.length-1]` is undefined → `top !== owner[type]` → skipped. Good.

OK. Now let me examine the **`releasedFrom`** in the poster: `if (b.owner !== vaultPda) continue`. `preTokenBalances` entries have `owner` as a string (the token account's owner). Good.

Now — let me check `draftPost`'s `formatAmount` for `1234500000000n, 9` → s = '1234500000000'.padStart(10, '0') = '1234500000000' (13 chars). whole = s.slice(0, 13-9) = s.slice(0,4) = '1234'. frac = s.slice(4) = '500000000' → trim zeros → '5'. So '1,234.5'. Matches the test. Good.

Now let me look at **`bank/selftest.mjs`'s `LKstart`** and the lock tests. Fine.

Let me look at **`lock.mjs`'s `acquireLock` sweep**: `for (const g of gens) { try { fs.unlinkSync(`${file}.${g}`) } catch {} }`. `gens` is the list BEFORE the break (all generations, sorted desc). The breaker created `G+1`. Then it unlinks ALL of `gens` — which are all ≤ G < G+1. So "strictly below its own" — correct. But `gens` includes G itself (the stale record it superseded). Fine.

Hmm — but `scan(file)` returns generations from the directory listing. If two breakers both compute `G+1` from the same `G`, `place` (link) makes exactly one win. Good.

But: the sweep unlinks `gens` entries — what if another process is concurrently creating `file.0` (a fresh claim when `scan` returned empty)? Then `gens` wouldn't include it. Fine.

Hmm, one thing: `releaseLock` scans for the generation carrying our token and unlinks it. But if our generation is NOT the highest (someone broke above us), we'd unlink ours and leave theirs. Fine.

OK, now let me look at the **`withLock` + `flock -n` interplay**. `cron-install.sh` wraps in `flock -n` and `withLock` uses the file lock. Fine.

Let me now look at **`bank/crank.mjs`'s `mintedAttributes`** and the attribute hash check. `deserializeAssetV1` from `@metaplex-foundation/mpl-core`. It returns `a.attributes?.attributeList`. The order of `attributeList` must match what the program hashed at mint. The program hashed the CALLER's `attributes` Vec (plus, for charter, the appended `charter`). Wait:

- `mint_vault`: `write_record(..., &attributes, ...)` where `attributes` is the caller's Vec. And `create_vault(..., &attributes)`. So the stored hash is of the caller's list, and Core stores the same list. So reading it back gives the same order? Core's Attributes plugin stores a `Vec<Attribute>`. Does Core preserve order? `UpdatePluginV1` REPLACES the list. If Core preserves insertion order, the read-back order matches. The program's reveal re-sends `attributes` and checks `hashv(&[&attributes.try_to_vec()]) == hash`. So the CRANK must send them in the SAME order the minter sent. The crank reads them off Core. If Core preserves order, fine. The selftest asserts `attrsHash(list) === attrsHash([...list].reverse())` is FALSE (order matters). So if Core reorders (e.g. sorts by key), the hash check would fail and the reveal would be impossible → **the FIFO would stall forever at that vault**. Hmm! Is that a real risk? The program's own comment says "Core's `UpdatePluginV1` REPLACES the whole list (round 5)". And the crank reads `a.attributes?.attributeList`. Whether mpl-core's deserializer preserves the on-chain order — it reads the stored Vec in order. And `create_vault` writes them in the caller's order. So unless Core sorts, order is preserved. The test suite (645 assertions) presumably exercises a reveal against real Core, so a reorder would have shown up. Hmm, the Test Vault simulation runs "one vault's whole life against real Core". So the reveal works. OK, so order is preserved. But it's worth noting: **the attribute hash binds order, and the only thing guaranteeing Core preserves order is that the suite passed once.** If a Core upgrade reorders (limit 40), every unrevealed vault's FIFO stalls permanently. That's a real consequence of limit 40 that is NOT stated. Hmm — "Is any limit WORSE than stated?" Limit 40 says a Core upgrade changing `UpdatePluginV1`, `ExecuteV1`, `BurnV1` or plugin rules reaches every vault. But the specific failure — that an unrevealed vault's `reveal_level` would fail `AttributesMismatch` and block the FIFO for every vault behind it — is worse than "reaches every vault". Actually the FIFO is the key: `reveal_level` requires `index == revealed_total`. If vault #500's reveal fails permanently, vaults 501..2099 can NEVER be revealed, activated, or paid. That's a total payout halt from one unrevealed vault. And the cause could be a Core behavior change OR a crank bug in `mintedAttributes`. Hmm — but is it really permanent? The minter could... no, only `reveal_level` writes the level. So yes: **a single vault whose attributes cannot be re-sent stops the reveal FIFO forever, and with it every activation and payout behind it.** The mitigations: the attribute budget (640 bytes) and the hash check. But the hash check is a double-edged sword: it prevents tampering but also means ANY mismatch (Core reordering, a deserializer change in `@metaplex-foundation/mpl-core` on the crank's box, an off-chain reading bug) is a permanent global stall.

Hmm, is this accepted? The design says "the stored list is bounded at 640 Borsh bytes (`AttributesTooLarge`) and 8 attributes in all ... L.12 proves a vault at the full budget can still be revealed in a legacy transaction". So the byte budget is addressed. But the ORDER dependency and the "one un-revealable vault blocks everything" property is not in the accepted limits. Let me check: is there any limit about the FIFO stalling? Limit 25 is about reschedules. Nothing about a permanently un-revealable vault. Hmm — `reveal_level` for a BURNED vault skips the Core write and the hash check ("A vault already BURNED still takes its draw"). So a burned vault can't block. But a LIVE vault with a hash mismatch blocks forever.

Can a hash mismatch be induced by an attacker? The attributes are chosen by the minter at mint and hashed. The reveal re-sends them. The crank reads them off Core. An attacker can't change them (Attributes plugin authority is MINT's PDA). So the only way is a Core/deserializer change. OR: the minter sends attributes whose Borsh serialization differs from what Core stores/returns. E.g. if the minter sends attributes with a key/value containing... hmm, Core stores `String`s. The Borsh of `Vec<VaultAttribute>` is count + (u32 len + bytes) × 2n. Core's Attribute is `{key: String, value: String}`. So the same. Unless Core normalizes (e.g. trims, or rejects non-UTF8). `push_attr` writes `k.len()` bytes — `str.len()` in Rust is the BYTE length. And `attrsBorsh` in JS uses `Buffer.from(s, 'utf8').length`. Same. OK.

Hmm — but what if the minter sends an attribute list with a DIFFERENT order than Core returns? Core's `UpdatePluginV1`/`CreateV2` stores the Vec as given. The mpl-core JS `deserializeAssetV1` reads them in stored order. So it matches. OK, so today it works. The risk is future Core/deserializer drift. I'll file this as MEDIUM: "a single vault that cannot be re-serialized to its stored hash stalls the reveal FIFO permanently, and with it every activation, join and payout behind it; the only thing preventing it today is that Core preserves attribute order and the crank's deserializer matches the Rust Borsh exactly."

Hmm, actually — hold on. Is there a worse version? The crank does:
```
if (attrsHash(list) !== r.attrs_hash) { failures.push(`reveal ${r.asset}: attributes read off the asset do not hash to the stored attrs_hash`); break }
```
This `break`s the reveal lane and does NOT send the reveal. So the FIFO stops. And it pages (failures). So it's loud. But nobody can fix it (immutable programs). Hmm — could a human send the reveal by hand with the correct attributes? Yes! The `reveal_level` instruction takes the attributes as an argument. Anyone can call it (permissionless, `payer: Signer`). So a human who knows the original attributes could un-stall it. But the original attributes are on Core — if the Core read is wrong, the human needs the minter's original list (from the mint transaction's instruction data). Recoverable. So it's an operational stall, not a permanent one. Downgrade to MEDIUM/LOW. But the FIFO blocking is real and worth naming: **the reveal FIFO is a single point of failure for the whole payout schedule — one un-revealable vault blocks every vault behind it, permanently, and nothing in the accepted-limits list says so.** That's a good finding for "is any limit worse than stated / is anything missing".

Hmm, wait. Let me double check: does `reveal_level` really require `index == revealed_total`? Yes: `require!(index == ctx.accounts.config.revealed_total, MintError::RevealOutOfOrder)`. And `revealed_total` only increments in `reveal_level`. So yes, strict FIFO. And `activate` requires `r.level` in 1..=5. So an unrevealed vault can't activate. And `check_supply` allows minting up to `cap_total`. So vaults behind it can't activate or join → no payouts for them. But vaults AHEAD of it (already revealed/activated) can still be claimed. So it's a partial halt: every vault mint-index > the stuck one is stuck. And their money sits in the pool undistributed... no, the distribution credits ACTIVE (joined) vaults. Stuck vaults never join, so the pool's money goes to the ones that did. So it's not a loss, it's a freeze for the stuck ones. And the FIFO means it's a suffix of the mint order. Still significant.

Hmm, and is there any other way to advance `revealed_total`? No. So yes.

OK. Now let me look for more.

**`claim`'s `crank_n` handling**: `let k = if crank_n == 0 { 0 } else { crank_n as usize + 1 }; require!(rem.len() >= k, BadClaimList); crank(&rem[..k], ...)`. So if `crank_n > 0`, the first `crank_n + 1` accounts are `[SlotHashes, records...]`. The crank always sends `crank_n = 0`. Fine.

Hmm — `require!(!pairs.is_empty() && pairs.len() % 2 == 0, BadClaimList)`. If `crank_n = 0`, pairs = all remaining. Fine.

**`claim`'s frozen skip**: `if d[TOKEN_STATE_OFF] == TOKEN_STATE_FROZEN { ...; continue }`. But it does NOT update `r.debt_scaled`, so the vault stays owed. Good. But `owed_paid` is not incremented, so `owed_scaled` is not reduced. Good.

Hmm — `require!(d.len() == TOKEN_ACCOUNT_LEN, VaultAccountMissing)` = 165. A Token-2022 account (170 bytes) would fail. But the destination is the recorded ATA derived with the classic SPL program id. Fine.

**`retire_redeemed`'s `pool_is_frozen`**: returns false if `pool.owner != SPL_TOKEN_ID`. And `require_keys_eq!(pool.key(), c.pool_ata, WrongPool)`. Good.

Hmm — `retire_redeemed` calls `monthly_inline` AFTER `retire`. And `retire` may set `forfeit`. Fine.

Now — `retire`'s `forfeit && pending >= ACC_SCALE` logs `CBOB_REDEEMED_POOL_FROZEN`. But it does NOT actually return the pending to the pool in a way that... let me look: `c.owed_scaled = c.owed_scaled.checked_sub(pending)` — so the owed is reduced, meaning the pool's balance is now free (the sats stay in the pool). So "returned to the pool" = the pool keeps them and they're no longer owed → they'll be redistributed at the next `credit` (since `avail = balance - ceil(owed)` grows). Yes. Good.

Hmm — `if redeemed && !forfeit { require!(pending < ACC_SCALE, ClaimBeforeBurn); }`. So a redemption requires `pending < 1 sat` (a sub-sat residue). The redeemer must `claim` first. Good.

But what if `pending` is negative? `full.checked_sub(r.debt_scaled).ok_or(Overflow)?` — if `debt > full`, checked_sub fails → Overflow error. When could debt > full? `debt` is set to `full` at join/retire and increased by `pay*ACC_SCALE` at claim. `full = w * acc`. Since `acc` only grows and `debt` grows by `pay*ACC_SCALE` where `pay = (w*acc - debt)/ACC_SCALE` (floor), after a claim `debt' = debt + floor((w*acc - debt)/ACC_SCALE)*ACC_SCALE <= w*acc`. So `debt <= full` always. Good.

OK. Now let me look at the **`distribute` burn path's `waiting_to_join` check placement**:
```
if burn {
    ...
    require!(waiting_to_join(&ctx.accounts.config)? == 0, MintError::JoinWaitingFirst);
    // then the SPL burn CPI
}
```
The comment says "Checked BEFORE the burn, so a refused distribution burns nothing." Good.

But the `w == 0` branch is checked BEFORE the burn branch. And in the w==0 branch: `require!(waiting_to_join(c)? == 0, JoinWaitingFirst); require!(!burn && c.pending_this_epoch > 0, NoActiveVaults); require!(ctx.remaining_accounts.is_empty(), BadBurnAccounts); require!(now >= ... , MonthNotElapsed); return tick(c, now)`. Hmm — `require!(!burn && ...)` with burn=true → `NoActiveVaults`. But the burn accounts were already... no, nothing was burned yet (the CPI is later). But `require!(ctx.remaining_accounts.is_empty(), BadBurnAccounts)` — with burn=true, remaining_accounts has 4 entries → BadBurnAccounts... but the `!burn &&` check comes first and fails with NoActiveVaults. Either way it's refused before the burn. Good.

Hmm, and `tick` is reached only when `!burn`. Good.

Now — `tick` advances `dist_epoch` and resets `pending_this_epoch`. And `credit` does the same. Good.

Now let me look at `monthly_inline`'s `tick` call: `if c.total_active_weight == 0 { if c.pending_this_epoch > 0 { tick(c, now)?; } return Ok(()); }`. But BEFORE that: `if waiting_to_join(c)? > 0 { msg!(...); return Ok(()); }`. So if there are eligible-but-unjoined vaults, the inline run does nothing. And the crank joins them. Good.

Hmm — but `monthly_inline` is called at the START of `mint_vault`, `claim_charter_vault`, `activate`, `claim`, and at the END of `retire_redeemed`. And in `activate`: `crank(...)`, then `monthly_inline`, then the activation. So an `activate` whose inline tick runs would advance the epoch BEFORE this vault's request is recorded. So this vault's `request_epoch` = the NEW epoch. Correct (it must wait for the next distribution). Good.

Now — one more: `activate`'s second call (join) branch:
```
if r.pending {
    require_keys_eq!(ctx.accounts.asset.key(), r.asset, WrongAsset);
    require_live_vault(&ctx.accounts.asset, &collection)?;
    require!(ctx.accounts.config.dist_epoch > r.request_epoch, ActivationPending);
    let (c, r) = (&mut ctx.accounts.config, &mut ctx.accounts.vault_record);
    return join(c, r);
}
```
But `join` also requires `c.dist_epoch > r.request_epoch`. Fine.

Hmm — `require_live_vault` checks the asset is a live vault in the collection. For a BARE-BURNED vault, it's not live → `NotALiveVault`. So a burned vault can't join via `activate`. And `claim`'s join path: `if r.pending { ... if dist_epoch > request_epoch { join(...) } }` — `join` does NOT check `require_live_vault`! So `claim` can join a bare-burned pending vault — which is accepted limit 27 ("a bare-burned vault still WAITING to join can be joined by a `claim` that names it, adding weight nobody can collect"). And the crank avoids it. OK, accepted.

Now let me look at **`check_supply`**: `require!(cfg.minted_total < cfg.max_supply)` and `require!(cfg.minted_total < cap_total)`. But `reveal_level` draws from `level_caps - level_minted` and requires `total > 0`. If `minted_total` reaches `cap_total`, no more mints. And every mint increments `level_minted` exactly once at reveal. So `sum(level_minted) == revealed_total <= minted_total <= cap_total`. So the draw always has room. Good.

Hmm — but a vault minted and never revealed keeps its census slot. Fine.

Now let me check the **`Initialize`'s `check_seal_wiring` + `seal_reserves`** — `require!(n <= 3 ...)`. And `payment_mint` must be in the reserves. Good.

Now, let me look at the **`claim_charter_vault`'s `pob_extra` and `crank_accts`**: `let (extra, crank_accts) = ctx.remaining_accounts.split_at(n_extra);`. And `require!(n_extra <= MAX_POB_EXTRA && n_extra <= ctx.remaining_accounts.len())`. Then `crank(crank_accts, slot)`. And `crank` requires `accts[0] == slot_hashes` if non-empty. So if `pob_extra > 0` and the caller also attaches a crank, the split is `extra` = first n_extra, `crank_accts` = the rest. The SPEC says "the claim page must send no crank when `pob_extra > 0`" (limit 37) — for packet size. OK.

Hmm — but the burn CPI metas: `metas.push(...)` for extra accounts. And `invoke(&Instruction { program_id: MPL_CORE_ID, accounts: metas, data: vec![IX_BURN_V1, 0] }, &infos)`. Hmm — `data: vec![IX_BURN_V1, 0]`. Core's BurnV1 has an `authority` or `compression` argument? `vec![IX_BURN_V1, 0]` — 2 bytes: the discriminant and a 0 byte (probably `update_authority: Option<...>` = None, or `compression`). Whatever — it's asserted in the suite. Fine.

Now let me look at the **`run-tests.sh` `floor()` and the `OUT=$(...); RC=$?`** patterns. And the `[ "$TOTAL" -eq "$MIN_ASSERTIONS" ]`. Fine.

Hmm — `MAIN_OUT=$(node scripts/probe-mainnet-facts.mjs) || MAIN_RC=$?`. And `floor "mainnet probe" "$MAIN_OUT" '[0-9]+/[0-9]+ as predicted' "$MAINNET_FLOOR"`. And MAINNET_FLOOR=24. SPEC says "24 live-mainnet". Good.

Hmm, `DET_OUT=$(node bank/selftest.mjs) || DET_RC=$?` and then `echo "$DET_OUT" | tail -6` and `[ "$DET_RC" -eq 0 ] || die`. Then `floor`. If the selftest CRASHES (throws), `DET_OUT` holds partial output and `DET_RC` != 0 → die. Good.

Now — **a check that passes vacuously**: `t('the searched tree covers bank/, scripts/ and tests/', ['bank','scripts','tests'].map(d => srcFiles.some(x => x.path.startsWith(d + '/'))), [true, true, true])`. And `srcFiles` is built from `fsx.readdirSync('/opt/cbob-vaults/bank')` etc. If the directory is empty, `srcFiles` is empty and the check fails (all false). Good.

Hmm — but the selftest hardcodes `/opt/cbob-vaults/...` absolute paths. If run from elsewhere, it reads the real deployment. Fine.

Let me now look at **`bank/accrual.mjs`'s `available` vs the Rust for the `retire` return**. `retire` subtracts `pending` from `owed_scaled` but does NOT add to the pool balance (the sats are already there). So `avail` grows. Good.

OK, let me look at one more area: **`bank/crank.mjs`'s handling of `cfg.pool_ata`**. `plan.claims` sends `W(cfg.pool_ata)` — marked writable. The program's `Claim.pool_token` is `#[account(mut)]`. Good. And `distribute`'s `pool_token` is NOT mut (`/// CHECK: must equal config.pool_ata. pub pool_token: UncheckedAccount` — no `mut`). The crank sends `R(cfg.pool_ata)` (readonly). Good.

Hmm — `activate`'s `pool_token` is readonly in the program. The crank sends `R(cfg.pool_ata)`. Good.

And `retire_burned`'s accounts in the program: config, vault_record, asset. The crank sends `[W(MINT_CFG), W(a), R(r.asset)]`. Good.

Now — **`reschedule_reveal`**: the program's `RescheduleReveal` has only `vault_record`. The crank sends `[new TransactionInstruction({ programId: MINT, data: d('reschedule_reveal'), keys: [W(a)] })]`. Good.

Hmm, `capture_entropy`: `keys: [W(a), R(SLOT_HASHES_ID)]`. Program: `vault_record`, `slot_hashes`. Good.

Now — one thing: the crank's `send` uses `sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer], { commitment: 'confirmed' })`. A legacy `Transaction` (not versioned). Max 1232 bytes. The claim batch is 14 pairs = 3 + 28 = 31 accounts. 31 × 32 = 992 bytes of account keys + signatures (64) + header + data. Hmm, that's tight!31 accounts: 1 signature (64 bytes) + message header (3) + account keys (31×32 = 992) + blockhash (32) + instructions. That's 64+3+992+32 = 1091, leaving ~141 bytes for the instruction data and per-instruction account indices. The instruction: programIdIndex (1) + accounts (31 bytes as u8 indices... but with 31 accounts, indices fit in u8 since < 256) + data length (1) + data (8 + 1 = 9). So ~42 bytes. Total ~1133. Fits in 1232. OK. The measured CLAIM_BATCH=14 was "MEASURED by the stage-3 suite (14 fit)". Good.

Hmm, but the crank's claim batch includes the crank's `ready` list PLUS `plan.joins`. And each pair is 2 accounts. 14 pairs = 28 + 3 = 31 accounts. OK.

Now let me look at something in `detectors.mjs`: `detectRedemptionRate` uses `redemptionCapacity(cur, nowSec)` and `cur['burn.rate_ring']` must be an array of 64. `flatten` produces `['burn.rate_ring']` as an array of strings. OK. But `big(cur['burn.redeem_window_secs'])` — flatten gives a string. `big` = `BigInt(v)`. OK.

Hmm — `redemptionCapacity`'s `window <= 0n` → null. Good.

Now — **`detectRedemptionRate`'s `Number(c.cap)`** — `c.cap` is a BigInt. `Number(45n)` = 45. Fine.

OK let me also check: **the alarm's all-clear line** claims "no approvals, no unexpected PDA token accounts, no nested vaults, no burn this pass could not account for, no vault left the collection, no reserve fell, no unreconciled sweep, no overdue distribution, a readable unfrozen pool, and no drift in any config value, program upgrade authority, program bytes or the collection plugins." But it does NOT mention: no redemption-rate page, no armed operator, no reschedule, no frozen claim. Those are HIGH/CRITICAL so they'd be in the findings. Fine.

Hmm — "a readable unfrozen pool" — but `pool_frozen` is CRITICAL so it'd be in findings. OK.

But the all-clear says "no overdue distribution" — which is judged by `detectDistributionOverdue`, which is blind when `w == 0` (my finding above). So the all-clear is a false statement in the launch case. Good, that strengthens the finding.

Now let me look at **R2's "a dangerous on-chain state it reads as quiet"** — I have:
1. `CBOB_LOCK_DEADLINE` unset → the lock-date check is silently off → a program still upgradeable past the lock reads as calm, and the all-clear claims "no drift in ... program upgrade authority".
2. The launch tick case (`w == 0` + waiting vaults + overdue) → no `distribution_overdue`, and the all-clear claims "no overdue distribution".

Any more?

3. `detectVaultSetChange` with `prevLive` empty/null → returns nothing. First pass. Documented.

4. `detectBalanceDrops` needs `prevBalances`. First pass → nothing. Documented.

5. **`detectConfigDrift` on the first pass**: `if (!prev) return out`. So the first pass adopts whatever is on chain. Protected by the EVER marker + `--first-run`. OK.

6. **`detectStandingRisks`'s `guardian_retired`**: `cur['mint.guardian'] === DEFAULT_PUBKEY` → INFO. But if `initialize` is given `guardian: None`, `guardian = Pubkey::default()` = `1111...`. So a system with NO guardian from birth shows INFO "nobody can pull the emergency brake. That is legal (a vote retired it)". But it was never voted — it was never set. So the message is misleading, and it's only INFO (not paged). Per DESIGN, "A guardian of `None` is legal". But the RULING is that Gary's wallet is the guardian. So a launch with no guardian would be a misconfiguration that the alarm reports only at INFO. Hmm — and item 38 lists "the guardian" as an initialize value that must be ruled. `check-launch-params.mjs` should catch it. But the alarm's own assertion of Gary's production values doesn't include `mint.guardian == Hc6W...`. So a wrong/absent guardian is only caught by the launch checker. The task says the alarm must "assert Gary's production values (21% / 51% / 3 days, 7-day notice, the tighten bounds, 30-day month, one-hour window)" — guardian is not in that list. So it's fine per the spec. But it's worth a LOW note.

7. **`detectStandingRisks` doesn't check `mint.max_supply`, `mint.level_caps`, `mint.charter_*`, `mint.pob_root`, `mint.bank_treasury`, `mint.payment_mint`, `mint.split_bps` is checked.** So a wrong `max_supply` (say 100 instead of 2100) is not in the production list. Drift catches CHANGES. So a wrong initial value is silent. But item 38 says the launch checker refuses before signing. Hmm — the alarm's stated duty is "assert Gary's production values (21% / 51% / 3 days, 7-day notice, the tighten bounds, 30-day month, one-hour window)". Those are exactly covered. So not a finding against the stated duty. But I can note it.

8. **`detectPoolHealth` with `owed === null`**: if `mint.owed_scaled` is unreadable... it's produced by readConfigs. OK.

9. **`detectIndexShortfall`** — if `minted_total` is undefined → return []. It's produced. OK.

Let me look for **a routine state that pages every pass**. I have the `redemptions_near_cap` one at live ≤ 47. Let me look for others.

- `detectStandingRisks`'s `test_value_in_production` with `production: true` always: on the local test validator (if someone pointed the alarm at it), it pages every pass. And on the dress rehearsal. That's a real one: **the alarm hardcodes `production: true`, so any non-production deployment (the dress rehearsal, a staging run) pages CRITICAL on every permanent value, every pass, forever** — training operators to ignore CRITICAL. Combined with the hardcoded program ids, the dress rehearsal can't run the alarm meaningfully anyway. I'll fold these together.

- `sweep_cooldown_too_short` / `sweep_cooldown_wedged` / `sweep_cap_wedged`: standing, every pass. If the deployed cooldown is below3600 (the `minSweepCooldownSecs` default), CRITICAL every pass. The `initialize` bound is `MIN_SWEEP_COOLDOWN_SECS (1) ..= MAX_INIT_SWEEP_COOLDOWN_SECS (24h)`. So a deployed cooldown of e.g. 60 s is legal on chain but pages CRITICAL forever. And `minSweepCooldownSecs` is `opts.minSweepCooldownSecs ?? 3600` — alarm.mjs passes `{ production: true }` without `minSweepCooldownSecs`. So the operational minimum is 3600. Item 38's PROPOSED cooldown is 6 h. OK.

Hmm — but `detectStandingRisks`'s `minCoolSecs` default is 3600 and the "PRODUCTION" `want` list does NOT include `sweep_cooldown_secs` (it includes `cooldown_ceiling_secs`). So the actual deployed cooldown is checked only against the working band [3600, 12h]. If the ruled cooldown is 6 h, a deploy of 3 h would pass the alarm. `check-launch-params.mjs` is said to check "the swap bot's values sit in the alarm's working band". OK.

- `joins_waiting` INFO — not paged.

Let me now consider: is there a detector that pages on a NORMAL redemption? `correlateBurns` downgrades the noise. `detectBurns`'s `burn_via_program` is INFO. `vault_burned` is downgraded if `burn_vault` was seen. But if the DAS diff and the signature walk land in different passes (limit 8), a false CRITICAL. Accepted.

Hmm — what about `detectRedemptionRate` firing right after a legitimate burst? HIGH. Fine.

What about `detectDistributionOverdue`'s grace of 6h — fine.

OK. Now let me look at one more potential CRITICAL: **`planCrank`'s `acc` used for claims**. 

```
let acc = BigInt(cfg.acc_scaled)
...
if (poolOk && due && w > 0n) {
    const avail = available(pool.amount, cfg.owed_scaled)
    if (avail > 0n) {
      plan.distribute = true; plan.distributeKind = 'credit'
      acc += avail * L.ACC_SCALE / w
    }
}
```

Then claims use `pendingSats({ level: r.level, debt: r.debt_scaled }, acc)`. So the plan thinks the distribution happened. But the on-chain `credit` also updates `owed_scaled`. The plan's `owed` isn't used for claims. Fine.

Hmm — but the plan's `acc` increment uses `w = total_active_weight + preJoinWeight`. And the on-chain `credit` uses `w = total_active_weight` AT THAT MOMENT (after the preJoins). If a preJoin is sent but the vault's level is 0... no, joins require level 1..5 (join uses `LEVEL_WEIGHTS[(r.level - 1) as usize]` — if level == 0, `r.level - 1` underflows! `0u8 - 1` in Rust with overflow-checks = true → ABORT. Hmm! `join` is called from `claim` (for pending) and `activate`. `activate`'s request path requires `r.level` in 1..=5. So `r.pending` implies level >= 1. And `claim`'s join path: `if r.pending { ... join(...) }` — `join` requires `r.pending && !r.active && !r.retired`. If a vault has `pending == true` and `level == 0`... can that happen? `pending` is set only in `activate` after `require!((1..=5).contains(&r.level))`. So no. Good.

But `retire`'s `if r.active { let w = LEVEL_WEIGHTS[(r.level - 1) as usize]; ... }` — `active` implies level >= 1. Good.

OK. Let me also check `planCrank`'s `preJoinWeight`:
```
const preJoinWeight = plan.preJoins.reduce((a, [addr]) => {
    const r = records.find(x => x.address === addr); return a + L.LEVEL_WEIGHTS[r.level - 1] }, 0n)
```
`L.LEVEL_WEIGHTS[r.level - 1]` — if `r.level` is 0, `[-1]` is `undefined` and `a + undefined` → NaN... actually `0n + undefined` throws "Cannot mix BigInt and other types". So a pending vault with level 0 would CRASH `planCrank`. But pending implies level >= 1. Hmm — but `plan.preJoins` filters `if (r.retired || r.active || !r.pending) continue` — so only pending. And pending implies level >= 1 on chain. Unless the record is corrupt. OK, defensive gap but unreachable.

Hmm, `records.find` inside a reduce is O(n²) — at 2100 vaults with many preJoins, that's 2100×N. Performance, not correctness. With ~460KB of records per pass and a full pass hourly, fine.

Now, let me check **`bank/crank.mjs`'s REVEAL_ONLY records fetch filter** once more. The memcmp at `L.offsets('VaultRecord').level` = 57 with bytes base58([0]) = "1". Hmm — but `getProgramAccounts` memcmp matches the BYTES starting at the offset. `bs58.encode(Buffer.from([0]))` — base58 encoding of a single 0x00 byte. The encoding: the byte string [0x00] → one leading zero → one '1', and the number 0 → no digits. So the encoding is "1". Then the RPC decodes "1" back to [0x00]. So it matches a 1-byte prefix of 0x00. Good.

But wait — the discriminator filter: `bs58.encode(disc)` where disc is 8 bytes. Good.

Hmm — and `raw.map(...)` then `L.decode('VaultRecord', account.data)` which checks `d[8] !== s.version` → throws. If a record has version != 3, the crank crashes. That's loud. OK.

Now — **the `assets` classification**: `a.owner.toBase58() === CORE_ID && a.data.length === 1 && a.data[0] === 0 ? 'burned' : a.owner.toBase58() === CORE_ID && a.data[0] === 1 ? 'live' : 'other'`. If `a.data.length === 0` (impossible for a Core account) → `a.data[0]` is undefined → not 1 → 'other'. Fine.

Hmm — but the Rust `is_burned` requires `d.len() == 1 && d[0] == 0`. And `require_live_vault` requires `d.len() >= 66 && d[0] == KEY_ASSET_V1`. The crank's 'live' is `owner == CORE && data[0] == 1` without the length check. Close enough.

OK. Now let me think about **what the crank could do that moves value wrongly**. The `claim` destination is `r.vault_ata` from the record, and the program pins it. The `distribute` has no destination. `activate` has none. `reveal_level` pays Core rent from the payer. `retire_burned` moves nothing. `reschedule`/`capture` nothing. So the crank cannot move value anywhere unpinned. Good — I'll state that.

Now let me look at `bank/revenue.mjs`'s worst case more concretely. `MAX_PER_CYCLE_LAMPORTS = 50_000_000_000n` = 50 SOL. `chainCap` from config (ruled 10 SOL PROPOSED). `amount = min(balance - reserve, 50 SOL, chainCap)`. The program enforces `amount <= cfg.max_sweep_lamports`. So worst case per sweep = max_sweep_lamports. With a cooldown of 6 h, that's 4 sweeps/day × 10 SOL = 40 SOL/day until the guardian stops. Documented in limit 10 ("per-sweep cap x cooldown windows").

Hmm — but the `sweep_sol_for_swap` is signed by the OPERATOR. So a thief with the operator key can sweep. And the guardian can stop. OK.

Now — **the revenue ledger's `cycleIsOpen` and the `sendRejected` flag**. If the sweep is rejected (`custom program error`), `cycle.sendRejected = true` and `save(led)`, then `throw`. So the ledger has a row with `intendedLamports` and `sendRejected`. `cycleIsOpen` returns false. Good. But `detectUnreconciledRevenue`'s loop: `if (!cycleIsOpen(c)) { if (swept === 0n || returned === 0n) continue }`. For a sendRejected cycle, `swept = BigInt(c.sweptLamports || c.intendedLamports || 0)` = intendedLamports (non-zero) and `returned = 0` → `continue`. Good, skipped.

Hmm — but `detectUnledgeredSweeps` checks on-chain sweeps against `byS` keyed by `sweepSig`. A rejected sweep has no `sweepSig`. Fine.

Now — **`detectUnledgeredSweeps`'s `defer` list and `opts.blockTime`**. `const stale = !opts.blockTime || !opts.now || (opts.now - opts.blockTime) > graceSecs`. Hmm — `opts.now` is `nowSec` (unix SECONDS) and `opts.blockTime` is `s.blockTime` (unix SECONDS). So `opts.now - opts.blockTime` is in seconds, compared to `graceSecs = 900`. Good. But in `detectDeferredSweeps`, `const now = opts.now ?? Math.floor(Date.now() / 1000)` and `if (now - (d.blockTime ?? 0) < graceSecs) { keep.push(d); continue }`. Consistent. Good.

Hmm — `detectUnreconciledRevenue`'s `graceMs` uses `nowMs` (ms) and `Date.parse(c.startedAt)` (ms). Good.

OK, now let me look at **`bank/selftest.mjs`'s assertion about `alarm.mjs`'s `if (s.err) continue`**. It reads `/opt/cbob-vaults/bank/alarm.mjs`. Fine.

Let me look for **assertions that cannot fail** more aggressively.

```
t('crank.mjs sends only permissionless MINT instructions (no transfer, no system move of value)',
    (() => { const src = fsx.readFileSync('/opt/cbob-vaults/bank/crank.mjs', 'utf8')
      const used = [...src.matchAll(/d\('(\w+)'\)/g)].map(m => m[1]).sort()
      return [...new Set(used)] })(), ['activate', 'capture_entropy', 'claim', 'distribute', 'reschedule_reveal', 'retire_burned', 'reveal_level'])
```
This matches `d('...')` calls. But `ixDisc` is aliased as `d = n => ixDisc(n)` inside main(). And `d('...')` appears in the instruction constructions. But this regex would also match `d('...')` in a comment or in `describePlan`. And it would MISS a new instruction added via `ixDisc('...')` directly or via a different alias. Hmm — the check is "the set of names passed to `d()`". If someone added `d('set_round')`, it would appear and fail. If someone added `ixDisc('set_round')`, it would NOT be caught. So the gate has a hole. LOW.

```
t('...and the distribute it sends is the FREE path (burn = 0), never a $GARY burn from the crank key',
    /d\('distribute'\), Buffer\.from\(\[0\]\)/.test(fsx.readFileSync(...)), true)
```
This matches the literal. If someone changed it to `Buffer.from([1])`, the regex fails → red. Good.

```
t('crank.mjs is DRY-RUN unless --live is passed', /if \(!LIVE\) \{ console\.log\('\\nDRY RUN/.test(...), true)
```
Matches a specific literal. If the message changes, the gate goes red (false positive). If someone adds a second code path that sends without the LIVE check, not caught. Meh.

Now the **`V6_WIRED` check** — matches comments too. Noted.

Let me look at:
```
t('alarm.mjs reads every config through the pinned layout, not hand-typed offsets',
    [/L\.readPinned\(/.test(alarmSrc), /readUInt32LE\(105\)|subarray\(137/.test(alarmSrc)], [true, false])
```
Only checks two specific hand-typed offsets. A different hand-typed offset would pass. Weak but present.

OK. Now let me look at the **`floor()` regex extraction fragility**:
```
n=$(grep -oE "$3" <<<"$2" | grep -oE '^[0-9]+' | tail -1)
```
For `'[0-9]+/[0-9]+ detector assertions as predicted'`, `grep -oE` outputs `458/458 detector assertions as predicted`. Then `grep -oE '^[0-9]+'` outputs `458`. Good.

But the detector selftest prints MULTIPLE lines containing "assertions": e.g. `t(...)` lines print `  ok   the FIRST runner gets the lock`. And the final line is `${R.length - bad.length}/${R.length} detector assertions as predicted`. But ALSO earlier lines like `${ok}/${R.length} poster assertions` are in the poster file. In selftest.mjs, is there any other line matching `[0-9]+/[0-9]+ detector assertions`? Only the final. OK.

Hmm — but the selftest prints `  ok   ...` lines with numbers. `grep -oE '[0-9]+/[0-9]+ detector assertions as predicted'` is specific. Fine.

Now — an important gate question: **"floors that can be satisfied by deleting work"**. The floors require EXACT equality now. So deleting work lowers the count → red. Good. But `MIN_ASSERTIONS=645` is the on-chain suite. If someone deletes an assertion AND lowers the floor, it passes. That's inherent. The SPEC-count gate compares SPEC's stated numbers to the runner's floors. Good.

Hmm — but `DET_FLOOR=458` is compared to `selfFloor` (in selftest.mjs) by an assertion INSIDE selftest.mjs. If someone deletes assertions from selftest.mjs and lowers both FLOOR and DET_FLOOR, the gate passes. Inherent.

Let me look at **checks that pass vacuously when input is empty**:

- `detectVaultSetChange([], ...)` — `if (!prevLive || !prevLive.length) return {findings: [], trustCurrent: true}`. So an empty prev is a pass. But `prev?.vaults` is set from the previous pass's `vaults` (the live list). If DAS returned an empty list... `listVaults` throws on a bad envelope, and returns `{live, burnt, all}`. If the collection genuinely has 0 assets (before any mint), `live = []`. Then `detectVaultSetChange(prev=[], ...)` → quiet. And `detectIndexShortfall(mintedTotal='0', [], [])` → `0 === 0` → quiet. OK.

- `correlateBurns([])` → []. Fine.

- `applyAcks(findings, acks)` — fine.

- **`judgeCronTemplate`** returns [] if there are no matching lines. If `cron-install.sh` had NO money jobs (all deleted), the gate passes vacuously. But the `installs` assertion catches that. Good.

- **`judgeRow`/the control table**: `rows.filter(...)` — if `isTableRow` matches nothing, `rows = []` and the "every row's claim matches" assertion passes vacuously. But `t('...and the table has ON-CHAIN, AUTOMATIC and PROCEDURE rows', [...].map(c => rows.some(r => r.includes(`claims ${c}`))), [true, true, true])` catches it. Good.

- **`detectUnreconciledRevenue({cycles: []})`** → []. The selftest asserts a MISSING ledger is CRITICAL and an empty one is quiet. Good.

- **`parseAcks`** — good.

OK. Now let me check one thing in `bank/layout.mjs`'s `offsets` and the Rust's `VaultRecord` version comment: "GOV reads `mint_index` by raw offset (disc[0..8] version[8] asset[9..41] mint_index[41..49])". `L.offsets('VaultRecord')` gives: version at 8, asset at 9, mint_index at 41, reveal_slot at 49, level at 57. The comment says mint_index[41..49]. Good. And the selftest compares `testOff['REC_INDEX']` to `V.mint_index` = 41. Good.

Hmm — but the selftest's `pinned` regex for the suite is `/\bOFF_(\w+)=(\d+)/g` — `OFF_REC_INDEX=41`. Good.

Now — the cross-program offsets list includes `['MINT OFF_RESERVES (SEAL)', mintp.RESERVES, S0.reserve_mints]`. `S0 = L.offsets('SealConfig')`. `reserve_mints` is at 41 (8 disc + 1 version + 32 collection = 41). And `OFF_RESERVES: usize = 41` in MINT. Good.

And `['BURN OFF_COLLECTION (SEAL)', burn.COLLECTION, S0.collection]` = 9. Good.

OK. Let me now also examine `MINT_CONFIG_SPACE` vs the layout's `fixedLength`. The selftest asserts `enc.length === L.fixedLength('MintConfig')`. And the Rust allocates `MINT_CONFIG_SPACE` = (sum) + CONFIG_PADDING. Let me roughly verify the sum matches... The layout's MintConfig field list has 51 fields. Let me sum:version 1, collection 32, governance 32, pool_ata 32, round_id 4, opens_at 8, closes_at 8, price 8, cap 4, minted_this_round 4, minted_total 8, max_supply 8, bank_treasury 32, split_bps 2, sales_stopped 1, sweep_stopped 1, guardian 32, swap_operator 32, sol_reserve_lamports 8, bump 1, max_sweep_lamports 8, sweep_cooldown_secs 8, last_sweep_at 8, level_caps 20, level_minted 20, revealed_total 8, payment_mint 32, pob_collection 32, pob_root 32, charter_opens_at 8, charter_closes_at 8, charter_claimed 4, bare_burns_retired 8, total_active_weight 8, active_count 8, acc_scaled 16, owed_scaled 16, last_distribute_at 8, sales_stopped_at 8, sweep_stopped_at 8, pending_swap_operator 32, pending_swap_operator_at 8, monthly_secs 8, pending_guardian 32, pending_guardian_set 1, pending_guardian_at 8, notice_secs 8, sweep_floor_lamports 8, cooldown_ceiling_secs 8, reserve_ceiling_lamports 8, dist_epoch 8, pending_count 8, pending_this_epoch 8.

Let me sum: 1+32+32+32 = 97. +4 = 101. +8+8 = 117. +8 = 125. +4+4 = 133. +8+8 = 149. +32 = 181. +2 = 183. +1+1 = 185. +32+32 = 249. +8 = 257. +1 = 258. +8+8+8 = 282. +20+20 = 322. +8 = 330. +32+32+32 = 426. +8+8 = 442. +4 = 446. +8+8+8 = 470. +16+16 = 502. +8 = 510. +8+8 = 526. +32 = 558. +8 = 566. +8 = 574. +32 = 606. +1 = 607. +8 = 615. +8 = 623. +8 = 631. +8 = 639. +8 = 647. +8 = 655. +8 = 663. +8 = 671. +8 = 679.

Hmm, so8 (disc) + 679 = 687? Wait, I started the sum without the discriminator. Let me redo: the fields sum to 679 bytes (including the leading `version: u8` = 1). Plus disc 8 = 687.

The Rust `MINT_CONFIG_SPACE`:
```
8 + 1 + 32*3 + 4 + 8 + 8 + 8 + 4 + 4 + 8 + 8 + 32 + 2 + 1 + 1
+ 32 + 32 + 8 + 1 + 8 + 8 + 8 + 4*5 + 4*5 + 8 + 32 + 32 + 32 + 8 + 8 + 4
+ 8 + 8 + 8 + 16 + 16 + 8
+ 8 + 8 + 32 + 8 + 8
+ 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + CONFIG_PADDING;
```
Line 1: 8+1+96+4+8+8+8+4+4+8+8+32+2+1+1 = let's compute: 8+1=9, +96=105, +4=109, +8=117, +8=125, +8=133, +4=137, +4=141, +8=149, +8=157, +32=189, +2=191, +1=192, +1=193.
Line 2: 32+32+8+1+8+8+8+20+20+8+32+32+32+8+8+4 = 32+32=64, +8=72, +1=73, +8=81, +8=89, +8=97, +20=117, +20=137, +8=145, +32=177, +32=209, +32=241, +8=249, +8=257, +4=261.
Line 3: 8+8+8+16+16+8 = 64.
Line 4: 8+8+32+8+8 = 64.
Line 5: 32+1+8+8+8+8+8+8+8+8 = 97.
Total: 193+261+64+64+97 = 679. + CONFIG_PADDING(256) = 935.

So the Rust allocates 679 + 256 = 935 bytes, and the fixed part is 679 (disc included) — wait, my field sum was 679 WITHOUT disc. Hmm. Let me recheck: the Rust line 1 starts with `8 +` (disc) and then `1` (version). So line 1 = disc + version + ... = 193 includes the disc. So the fields (without disc) = 679 - 8 = 671? Hmm, but my independent field sum was 679. Let me recount my field sum.

Fields (my list), summing again carefully:
1. version u8 = 1 → 1
2. collection 32 → 33
3. governance 32 → 65
4. pool_ata 32 → 97
5. round_id u32 4 → 101
6. opens_at i64 8 → 109
7. closes_at i64 8 → 117
8. price u64 8 → 125
9. cap u32 4 → 129
10. minted_this_round u32 4 → 133
11. minted_total u64 8 → 141
12. max_supply u64 8 → 149
13. bank_treasury 32 → 181
14. split_bps u16 2 → 183
15. sales_stopped bool 1 → 184
16. sweep_stopped bool 1 → 185
17. guardian 32 → 217
18. swap_operator 32 → 249
19. sol_reserve_lamports u64 8 → 257
20. bump u8 1 → 258
21. max_sweep_lamports u64 8 → 266
22. sweep_cooldown_secs i64 8 → 274
23. last_sweep_at i64 8 → 282
24. level_caps [u32;5] 20 → 302
25. level_minted [u32;5] 20 → 322
26. revealed_total u64 8 → 330
27. payment_mint 32 → 362
28. pob_collection 32 → 394
29. pob_root [u8;32] 32 → 426
30. charter_opens_at i64 8 → 434
31. charter_closes_at i64 8 → 442
32. charter_claimed u32 4 → 446
33. bare_burns_retired u64 8 → 454
34. total_active_weight u64 8 → 462
35. active_count u64 8 → 470
36. acc_scaled u128 16 → 486
37. owed_scaled u128 16 → 502
38. last_distribute_at i64 8 → 510
39. sales_stopped_at i64 8 → 518
40. sweep_stopped_at i64 8 → 526
41. pending_swap_operator 32 → 558
42. pending_swap_operator_at i64 8 → 566
43. monthly_secs i64 8 → 574
44. pending_guardian 32 → 606
45. pending_guardian_set bool 1 → 607
46. pending_guardian_at i64 8 → 615
47. notice_secs i64 8 → 623
48. sweep_floor_lamports u64 8 → 631
49. cooldown_ceiling_secs i64 8 → 639
50. reserve_ceiling_lamports u64 8 → 647
51. dist_epoch u64 8 → 655
52. pending_count u64 8 → 663
53. pending_this_epoch u64 8 → 671

So fields = 671 bytes. Plus disc 8 = 679. And the Rust sums to 679 including disc. Great — matches. And `fixedLength('MintConfig')` = 8 + 671 = 679. And the encode length = 679. Good.

And `MINT_CONFIG_SPACE = 679 + 256 = 935`. So there's 256 bytes of padding. Fine.

VaultRecord: fields: version 1, asset 32, mint_index 8, reveal_slot 8, level 1, charter 1, entropy_set 1, entropy 32, attrs_hash 32, bump 1, active 1, retired 1, reschedules 2, vault_ata 32, debt_scaled 16, pending 1, request_epoch 8 = let's sum: 1+32=33, +8=41, +8=49, +1=50, +1=51, +1=52, +32=84, +32=116, +1=117, +1=118, +1=119, +2=121, +32=153, +16=169, +1=170, +8=178. Plus disc 8 = 186.

Rust `VAULT_RECORD_SPACE`:
```
8 + 1 + 32 + 8 + 8 + 1 + 1 + 1 + 32 + 32 + 1
    + 1 + 1 + 2 + 32 + 16 + 1 + 8 + RECORD_PADDING
```
= 8+1+32+8+8+1+1+1+32+32+1 = 125? Let me: 8+1=9, +32=41, +8=49, +8=57, +1=58, +1=59, +1=60, +32=92, +32=124, +1=125. Then +1+1+2+32+16+1+8 = 61. Total 186. + RECORD_PADDING(35) = 221. And the SPEC says "221 bytes, 2,429,040 lamports". Good. And the fixed part is 186. Good.

OK the layouts check out.

Now let me look at the **`retire_redeemed`'s instructions-sysvar check**:
```
let cur = load_current_index_checked(&sysvar)? as usize;
let ix = load_instruction_at_checked(cur, &sysvar)?;
require!(ix.program_id == BURN_PROGRAM_ID && ix.data.len() >= 8 && ix.data[..8] == IX_BURN_VAULT_DISC && ix.accounts.get(0).map(|a| a.pubkey) == Some(ctx.accounts.asset.key()), NotFromBurn);
```
`load_current_index_checked` returns the index of the currently-executing instruction. Since `retire_redeemed` is called by CPI from `burn_vault`, the "current" top-level instruction is `burn_vault`. Good. Plus `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` — a direct CPI. Good.

Hmm — `IX_BURN_VAULT_DISC: [u8; 8] = [150, 115, 145, 83, 24, 135, 83, 99]`. Is that sha256("global:burn_vault")[..8]? I can't compute it here reliably... Actually I could reason: the comment says "The discriminator is asserted against sha256("global:burn_vault") in the suite." So it's tested. OK.

Now — **a possible issue**: `retire_redeemed`'s `#[account(mut)] vault_record` and `seeds = [VAULT_SEED, vault_record.asset.as_ref()]`. Good.

OK. Let me now think about what else is notable.

**`bank/alarm.mjs`'s `readConfigs` `g()` helper**: `const addr = pda(seeds.map(x => Buffer.from(x)), prog)`. For `SealConfig` the seed is `L.SEEDS.sealConfig` = 'config'. And SEAL's Rust `SEAL_CONFIG_SEED: &[u8] = b"config"`. Good. `MintConfig` seed 'mint-config' vs Rust `CONFIG_SEED = b"mint-config"`. Good. `BurnConfig` 'burn-config'. `GovConfig` 'gov-config'. Good.

Hmm — `L.SEEDS.mintAuthority` = 'mint' and Rust `MINT_SEED = b"mint"`. Good.

Now, **`bank/crank.mjs`'s `MINT_AUTH = pda([Buffer.from(L.SEEDS.mintAuthority)], MINT)`**. Good.

OK, let me now write up. Let me also double-check the `redemptions_near_cap` finding numerically once more.

`redemptionCapacity(bk(47, []), T)`:
- minted=47, burned=0, bare=0, window=3600, ring = 64 zeros.
- live = 47.
- cap = (47 * 210 + 9999) / 10000 = (9870 + 9999) / 10000 = 19869 / 10000 = 1 (BigInt division truncates).
- cap < 1? No. cap > 64? No. cap = 1.
- inWindow = ring.filter(t => T - t < 3600).length. All t = 0 → T - 0 = 1.7e9 ≥ 3600 → not counted. inWindow = 0.
- remaining = 1 > 0 ? 1 - 0 = 1.

`detectRedemptionRate(bk(47,[]), T)`:
- c = {live: 47, cap: 1, remaining: 1}
- near = BigInt(Math.max(1, Math.floor(Number(1n) * 0.2))) = BigInt(max(1, floor(0.2))) = BigInt(1) = 1n.
- `if (c.remaining > near) return []` → `1n > 1n` false → fall through → return the finding.

YES. So with ≤47 live vaults and zero redemptions in the window, `redemptions_near_cap` fires HIGH every pass. Confirmed.

And at live=48: cap = (10080+9999)/10000 = 20079/10000 = 2. near = max(1, floor(0.4)) = 1. remaining=2 > 1 → quiet. live=95: cap = (19950+9999)/10000 = 29949/10000 = 2. live=96: cap = (20160+9999)/10000 = 30159/10000 = 3. near = max(1, floor(0.6)) = 1. remaining 3 > 1 quiet. So only cap==1 (live ≤ 47) is pathological. And cap==2 pages when one redemption is in the window (remaining=1 ≤ 1). That's "50% room" paging as "near cap". Over-fires.

Hmm, so the clean statement: **`detectRedemptionRate` pages HIGH on every alarm pass, forever, once live supply drops to 47 or fewer — even with a completely idle window.** And late in the system's life that is the steady state. Also at cap 2..5 it pages when more than 80% is NOT used. Let me verify cap=5: live 191..238 → cap = ceil(live*0.021). live=191: 191*210 = 40110 + 9999 = 50109 / 10000 = 5. near = max(1, floor(1.0)) = 1. remaining 5 quiet; remaining 1 pages. So used ≥ 4 of 5 = 80%. OK that matches "under 20% room". Only cap=1 and cap=2 misbehave. cap=1: always. cap=2: at remaining 1 (50% room). Hmm, `floor(2*0.2) = 0` → max(1,0) = 1. So near=1 instead of 0.4. The `max(1,...)` floor is the bug. For cap=2, "20% room" = 0.4 → remaining 1 is 50% > 20% → should be quiet. For cap=1, "20% room" = 0.2 → remaining 1 is 100% → should be quiet.

So the fix: compare `remaining * 5n <= c.cap` (i.e. remaining ≤ 20% of cap) using BigInt, no floor. For cap=1: remaining 1 → 5 ≤ 1? No → quiet. remaining 0 → 0 ≤ 1 → page. Correct. For cap=45: remaining 9 → 45 ≤ 45 → page. remaining 10 → 50 ≤ 45? No → quiet. Correct.

Good, a clean fix.

Now let me also verify the "launch tick invisible" finding numerically:
- `detectDistributionOverdue({'mint.last_distribute_at': X, 'mint.monthly_secs': 2592000, 'mint.total_active_weight': '0', ...}, {nowSec: X + 2592000 + 7*3600, poolAvail: 50n})` → `w === 0n` → returns []. Confirmed from the code.

And `detectStandingRisks({'mint.pending_count': '5', 'mint.pending_this_epoch': '5'})` → `pc - pt = 0` → no `joins_waiting`. Confirmed.

So the launch state (charter vaults requested activation, nobody joined yet, the first tick is overdue) is entirely silent. And `report`'s all-clear says "no overdue distribution". 

Hmm — but is `poolAvail > 0` at that point? The pool gets 85% of split revenue. If there's revenue, yes. If not, `poolAvail = 0` and the detector returns [] anyway (correctly — nothing to distribute). But the tick doesn't need money! The tick only advances the epoch. So even with `poolAvail == 0`, an overdue tick is a real problem (it blocks joining, which blocks all future distributions). And `detectDistributionOverdue` requires `poolAvail > 0`. So a zero-revenue launch + waiting vaults + overdue tick = total silence. Even worse. Good.

So the finding: **the epoch tick — the single gate every vault must pass through to join the payout schedule — has no liveness detector at all. `detectDistributionOverdue` requires `total_active_weight > 0` and `poolAvail > 0`, and `joins_waiting` requires `pending_count > pending_this_epoch`; the tick is exactly the state where the first is zero and the second is zero.** That's a strong finding.

Let me now also examine whether `distribution_overdue` would fire for the SECOND month if the tick ran but nobody joined. After the tick: `dist_epoch = 1`, `pending_this_epoch = 0`, `pending_count = 5`. `total_active_weight = 0`. Vaults can now join (dist_epoch 1 > request_epoch 0). They join via `claim`/`activate`. If nobody does, `w = 0` and `pc - pt = 5` → `joins_waiting` INFO (not paged). And `distribution_overdue` needs `w > 0` → silent. And the next month's distribution needs `waiting_to_join == 0` → refused. So the stall persists with only INFO. And the all-clear still says "no overdue distribution". So the whole launch can stall indefinitely with a clean report. That's HIGH.

Hmm — but the crank joins them (preJoins are sent unconditionally). If the crank runs, it's fine. The finding is that if the crank is down (accepted limit 7), the alarm does not page. And limit 7 says "v6 makes the stall survivable rather than silent: every crank instruction is permissionless and the monthly distribution also runs in-line in ordinary traffic, and the alarm raises `distribution_overdue` when a period passes with no distribution and `reveal_rescheduled` when a capture window lapses." So limit 7 EXPLICITLY claims the alarm raises `distribution_overdue`. But in the launch state it does not. So **limit 7's stated mitigation is not delivered in the launch state** — the stall is NOT survivable-by-alarm. That's a direct answer to "Is any limit WORSE than stated?" Yes: limit 7's claim that `distribution_overdue` covers the stall is false whenever `total_active_weight == 0`, which is exactly the launch window and the "everyone redeemed or everyone left" state.

Excellent. That's a strong, well-evidenced finding.

Now let me also check limit 25's mitigation claim: "every reschedule logs `CBOB_REVEAL_RESCHEDULED` and counts on the record (`reschedules`), so the alarm pages on the only event that makes this limit reachable." `detectProgramEvents` maps `REVEAL_RESCHEDULED` to `reveal_rescheduled` HIGH urgent. And `parseCbobLogs` attributes it to MINT. Good. But the alarm reads it from `tx.meta.logMessages` of transactions in the signature walk of [SEAL, MINT, BURN, GOV]. `reschedule_reveal` is a MINT instruction → in MINT's walk. Good. But the opportunistic `crank()` reschedules too — also within a MINT instruction. Good. OK, delivered.

Now limit 36: "the alarm pages `distribution_overdue`" — same hole.

Let me look at limit 9/44 and item 50. "Is any DISCHARGED item not actually discharged?" Let me scan the discharged list:
- 12/17 compute units — measured. Fine.
- 14 duplicate attributes — `DuplicateAttribute` exists in MintError and `check_attributes` enforces it. Delivered.
- 19 unlevelled-vault halt — `activate` requires level 1..5. Delivered.
- 30 split_bps — `update_wiring` doesn't exist in MINT's instruction list. Let me verify: the instructions are initialize, tighten_sweep, arm_swap_operator, apply_swap_operator, cancel_swap_operator, emergency_stop_sales, emergency_stop_sweep, restart, arm_guardian, apply_guardian, set_round, split_revenue, sweep_sol_for_swap, mint_vault, claim_charter_vault, capture_entropy, reschedule_reveal, reveal_level, activate, distribute, claim, retire_redeemed, retire_burned. No `update_wiring`. And `split_bps` is only written in `initialize`. Delivered. ✓
- 31 cadence deleted — `emission_min` is gone from MintConfig. ✓
- 33 swap operator notice exercised — `notice_secs` is an initialize param. ✓

Now, "Is any item in OPEN AND BLOCKING being quietly treated as accepted?"
- 22 (no live distribution run): the SPEC's "road" table lists step 8 (dress rehearsal) as "not started". Not quietly accepted. But my finding above (hardcoded program ids) means step 8 as written cannot exercise the crank/alarm. So22 is being treated as "will do later" but the mechanism to do it is missing. Worth naming.
- 38 (initialize values): `launch/mainnet-init.json` + `check-launch-params.mjs`. Open items named. OK.
- 50 (holder surfaces): explicitly open. But — is it being quietly treated as accepted? The control table lists `judgeRedemptionCoverage` as **PROCEDURE** "Nothing runs it today." and the poster as PROCEDURE. And SPEC says "Classified OPEN AND BLOCKING by this edit because the guide promises it; Gary may rule otherwise." So it's open. But the HOLDER-GUIDE promises the page. Per the task, "report where HOLDER-GUIDE.md promises something the code does not do" — the guide isn't in the bundle! I can only go by SPEC's description of it. I'll note that the guide itself is not in the bundle and that item 50 covers the gap.

Hmm — the bundle has no HOLDER-GUIDE.md. So I can't check it directly. I'll note the coverage gap.

Now — "Is any limit WORSE than stated?"
1. Limit 7's `distribution_overdue` mitigation is not delivered in the launch/zero-weight state. (Above.)
2. Limit 28 (frozen pool): "A frozen POOL stops every claim until it is thawed." But the crank's `planCrank` also gates `plan.joins` behind `!pool.frozen`, so a frozen pool additionally delays joins by a pass. Minor. And the frozen pool + `JoinWaitingFirst` interaction: while a frozen pool prevents claims... no, joins are sent as preJoins. Let me not over-claim here. Actually let me re-check: with a frozen pool and vaults that requested THIS epoch (plan.joins), they're not sent. Next pass they're preJoins → sent. So one pass. Not worse.
3. Limit 32 (rate limit): "The ring bounds the cap at 64, which covers live supply up to 3,047; above that the limit is stricter, never looser." Hmm — `redemptionCapacity`'s cap is clamped to 64. But BURN's on-chain logic: "a redemption lands iff the cap-th most recent one is at least a window old". With a 64-slot ring and cap > 64... if cap is clamped to 64 on chain too, then the effective cap is 64 regardless. The claim "the limit is stricter, never looser" — with live > 3047, ceil(2.1%) > 64, but the ring only holds 64 times, so the cap-th most recent doesn't exist → all64 are within the window? Hmm, "the cap-th most recent one" with cap > 64 — there is no 64th... there are only 64 entries. If cap > 64, then the cap-th most recent is "beyond the ring", which the program might treat as "always old enough" → LOOSER! I can't verify without BURN's source. The claim is that it's "stricter, never looser". Since max_supply is 2100, live ≤ 2100 < 3047, so it never binds. Not a finding.
4. Limit 27: the crank "never pays or joins a positively burned vault and retires it first, every pass" — but there's a TOCTOU and, more importantly, the retire is only planned `if r.level !== 0`. A burned, un-revealed vault is not retired (and can't be claimed or joined since it's not active/pending — wait, it could be PENDING! A vault that requested activation (pending) and is then bare-burned: `plan.preJoins` skips `assets[r.asset] === 'burned'`. Good. And `plan.joins` also skips burned. Good. And `plan.retireBurned` requires level !== 0 — a pending vault has level ≥ 1. So it gets retired. Good. What about a level-0 burned vault? Not pending, not active → no claim, no join. Only the FIFO. Fine. So limit 27's crank mitigation holds (modulo TOCTOU).

Hmm, one more: `plan.retireBurned` requires `r.level !== 0`. But `retire()` for a non-active, non-pending vault just sets retired and increments `bare_burns_retired`. So retiring a level-0 burned vault early would be fine and would make GOV's live supply accurate sooner. The `level !== 0` guard delays that. Minor (LOW).

5. Limit 41: "The holder copy must not claim the cap stops a key thief." Can't check the guide.

6. Limit 42: "A redemption of a vault holding all three reserve assets needs the destination ATAs created in a PRIOR transaction." OK.

Let me now also examine: **`bank/crank.mjs`'s claim batch includes `plan.joins` AFTER `ready`, and `plan.joins` entries are `[r.address, dest]` where `dest = destOf(r)`.** For pending, `r.vault_ata`. But wait — `destOf = r => r.pending ? r.vault_ata : tokens[r.asset]?.address`. In `plan.joins`, the code is `const dest = destOf(r); if (dest) plan.joins.push([r.address, dest])`. And `r.pending` is true. So `dest = r.vault_ata`. Good.

Hmm — but `plan.joins` is computed inside `if (plan.distribute)`. And the loop `for (const r of records) { if (r.retired || r.active || !r.pending || assets[r.asset] === 'burned') continue; if (BigInt(r.request_epoch) !== BigInt(cfg.dist_epoch)) continue; ... }`. Good.

OK. Now let me look at **`bank/crank.mjs`'s failure to page `plan.problems`**. `problems` is printed by `describePlan` but never added to `failures`. So a plan problem (pool unreadable, pool frozen, a vault with a bad account) is never paged by the crank. The alarm covers pool issues. A vault with a bad recorded account is only in the crank's log. Minor.

Now, one more area: **`bank/detectors.mjs`'s `detectApprovals` and the `ataOwner` fallback.** `ataOwner[info.source]`. `alarm.mjs` builds `ataOwner` mapping ATA → PDA for the reserve mints. Good.

Hmm — `detectApprovals`'s `pdaSet.has(info.owner) ? info.owner : ataOwner[info.source]`. If `info.owner` is present but is NOT a PDA, it falls back to `ataOwner[info.source]`. So an approve on a NON-ATA token account owned by a PDA would have `info.owner` = the PDA (jsonParsed gives the token account's owner). So `pdaSet.has(info.owner)` is true. Good. The fallback covers the case where the parse omits `owner`. OK.

Now — **`detectPdaTokenAccounts`** uses `ix.parsed?.info.wallet` for ATA creation and `ix.parsed?.info.owner` for initializeAccount. Good.

Let me now think about **`bank/alarm.mjs`'s `report`'s `delivered`** and the state advance. `const delivered = report(...) && !DRY`. And `report` returns `delivered` which is false only if the notify failed. So on a normal run, `delivered = true` and the state advances. On a DRY run, `!DRY` is false → `delivered` false → state not written. Good ("a dry run consumes nothing").

Hmm — but `markEver()` is called BEFORE `report` in the busy path: `markEver(); ... const delivered = report(...)`. So `--dry-run` on the first run still writes the EVER marker? Let me look:

```
  const markEver = () => { if (!DRY) fs.writeFileSync(EVER, started) }
```
Guarded by `!DRY`. Good.

OK. Now let me write the findings. Let me organize by target.

Let me reconsider severity levels:

CRITICAL: something that loses or freezes customer money or breaks a stated guarantee permanently.
HIGH: a dangerous state the alarm reads as quiet, or a permanent operational failure.
MEDIUM: wasted fees, false pages, noise that trains operators to ignore.
LOW: doc/code drift, dead checks.

My findings:

R1 (crank):
- MEDIUM: `readySlot` optimism → capture/reveal fail on skipped leader groups → wasted fees + false "crank failed" pages.- LOW: the `t.address !== r.vault_ata` guard is unreachable in production wiring.
- LOW: `plan.problems` never page.
- LOW: a missing mint_index in `records` silently stalls the reveal lane (no problem recorded).

R2 (alarm):
- HIGH: `detectDistributionOverdue` is blind when `total_active_weight == 0` (and when `poolAvail == 0`) — the launch tick / join stall is invisible, and the all-clear claims "no overdue distribution". This also falsifies limit 7's and36's stated mitigation.
- HIGH: `detectUpgradeAuthorityAfterLock` is silently disabled when `CBOB_LOCK_DEADLINE` is unset → a program still upgradeable past the lock reads as calm, and the all-clear claims "no drift in ... program upgrade authority".
- MEDIUM: `detectRedemptionRate` pages HIGH every pass forever once live ≤ 47 (cap floor + `max(1, …)`).
- MEDIUM: `production: true` is hardcoded and the program ids are hardcoded constants → the dress rehearsal (SPEC step 8) cannot run the alarm as written; and any non-production run pages CRITICAL on every permanent value continuously.

R3 (layouts): no finding. (State that the assertions are real and the failure modes are checked both ways. But I should not "confirm their work"... The instructions say "Do not confirm their work and do not praise them." I can state that I found no fault in R3 without praising. Hmm, or find something. Let me look once more.)

`parseRustStruct`'s regex `pub struct ${name}\s*\{([\s\S]*?)\n\}`. For `MintConfig`, the struct body has `#[account]` above it and fields with `///` doc comments. The regex needs `\n}` to close. The struct ends with `}` at column 0. Good.

But what if the Rust struct has a field whose TYPE contains a `,`? e.g. `pub x: HashMap<u8, u8>`. The regex `(.+?),?$` is non-greedy with an optional trailing comma — `.+?` would match minimally... `^pub (\w+):\s*(.+?),?$` on `pub x: HashMap<u8, u8>` — `.+?` non-greedy, then `,?` optional, then `$`. The regex engine: `(.+?),?$` — `.+?` expands until the rest can match. `,?` matches an optional comma, `$` end. So `.+?` would match `HashMap<u8` and `,?` matches `,`? Then `$` needs end-of-line but there's ` u8>` left. Backtrack: `.+?` matches `HashMap<u8, u8>`, `,?` matches empty, `$` matches. So it returns `HashMap<u8, u8>`. Good. Actually wait — with `$` and no `m` flag... the string is one line (from `split('\n')`), so `$` is the end of that line. OK.

Hmm — but what about a Rust field with a trailing `//` comment containing a comma? `raw.replace(/\/\/.*$/, '')` strips it first. Good.

What about `pub version: u8,` where the type is `u8` and the line is `pub version: u8,` → `(.+?),?$` → `.+?` = `u8`, `,?` = `,`. Good.

Hmm — what about a type like `Vec<(Pubkey, u64)>`? `.+?` = `Vec<(Pubkey`, then `,?` = `,`, then `$` fails (there's ` u64)>`). Backtrack → `.+?` = `Vec<(Pubkey, u64)>`. Good.

OK, one more: `fixedLength` returns `null` if a field has no fixed size. `offsets` breaks at that field and doesn't add later fields. So `offsets('SealConfig')` has no `bump`. The cross-program check uses `S0.collection` and `S0.reserve_mints` — both before the Vec. Good.

Hmm — `decode` for `SealConfig` reads `Vec<Pubkey>` and then `bump`. `readField('Vec<Pubkey>', d, o)` returns `[array, 4 + 32n]`. Then `bump` is read at the right offset. Good. And the selftest round-trips it.

So R3 is clean. I'll say "no fault found in R3 within what the bundle lets me check" and note that the assertion is real (I verified the offsets sum and the cross-program constants agree). Actually the instruction says don't confirm their work. But the report format requires findings by target. If I find none, I should say so plainly and move on — that's not praise. But I should double-check whether the assertions could be defeated.

One thing: `selftest.mjs`'s layout test reads `rs(s.src)` where `s.src = 'programs/cbob-vault-mint/src/lib.rs'` etc. and resolves `/opt/cbob-vaults/${f}`. If the Rust files moved, `readFileSync` throws → the selftest crashes → red. Good.

Hmm — but `parseRustStruct` is only tested against the CURRENT source. If someone edits the Rust AND the layout together (wrongly), the test passes. Inherent.

Another: `encode`/`decode`'s `u128` handling: `d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n)`. That's little-endian u128. And `encode`: `b.writeBigUInt64LE(x & mask); b.writeBigUInt64LE(x >> 64n, 8)`. Consistent. And Borsh's u128 is 16 bytes LE. Good.

Hmm — `readField` for `bool` refuses bytes other than 0/1. But Anchor's `bool` is 0/1. Good.

OK. Let me note one R3 item: **`decode` does not verify the account's OWNER** (only `readPinned` does), and `bank/crank.mjs` calls `L.decode('VaultRecord', account.data)` directly on `getProgramAccounts` results. `getProgramAccounts(MINT, ...)` guarantees owner == MINT. So it's fine in practice, but the "every account is declared once and asserted" property is only enforced where `readPinned` is used. LOW.

R4 (accrual): Let me look for a divergence once more.

`available(poolBalance, owedScaled)`: `a = poolBalance - ceilSats(owedScaled); return a > 0 ? a : 0`. The Rust `distribute`: `avail = balance.checked_sub(owed).ok_or(PoolShort)?` then `require!(avail > 0)`. So for `balance == owed`, the Rust gives `avail = 0` → `NothingToDistribute`. The accrual gives 0. Match. For `balance < owed`, the Rust gives `PoolShort` (error); the accrual gives 0 → the crank plans nothing. So the crank won't send a distribute that would error. Consistent (the accrual is more forgiving, which prevents a wasted fee). But `detectPoolHealth` reports insolvent. Good.

`credit`: matches.

`pendingSats`: matches.

`ceilSats`: matches.

`debtAtActivation`: matches.

`weightOf`: `WEIGHTS[level-1]`, matches `LEVEL_WEIGHTS[(r.level - 1) as usize]`.

`ACC_SCALE`: 1e12 both.

Hmm — one thing: `accrual.pendingSats` returns `p / ACC_SCALE` (floor). The Rust: `let pay = (pending / ACC_SCALE) as u64;` — `pending` is u128, `/ ACC_SCALE` truncates. Match.

But `pendingSats` THROWS when `p < 0`. The Rust `checked_sub(...).ok_or(Overflow)?`. Both refuse. But the ERROR differs (Overflow vs a thrown JS error). Fine.

Hmm — is there a divergence in `retire`? The accrual has no `retire` function. The selftest computes it inline. So the crank/alarm don't mirror `retire`. `retire_burned` is sent by the crank without any accrual computation. Fine.

So R4: no divergence found. But I should note: the accrual mirrors `credit`, `claim`, `ceil_sats`, `join` — and `retire`'s arithmetic (`owed -= pending`, `debt = full`) is NOT mirrored in `accrual.mjs` as a function, only asserted in one selftest line. If the crank ever needed to predict a retire's effect on `owed_scaled`, it would have no mirror. Not currently needed. LOW.

Hmm, actually — the prompt says "must equal the program's (`credit`, `claim`, `retire`, `ceil_sats`, `join`). Find any divergence." So `retire` is in scope. Let me look at the selftest's retire assertion:

```
const pendScaled = weightOf(3) * s3.acc - frozen.debt
t('retiring it returns exactly its share to the pool', s3.owed - pendScaled, 0n)
```
`s3 = credit({acc:0,owed:0}, 1000n, 4n)` → delta = 1000 * 1e12 / 4 = 250e12. acc = 250e12. owed = 250e12 * 4 = 1000e12. `frozen = {level:3, debt:0}`. `pendScaled = 4 * 250e12 - 0 = 1000e12`. `s3.owed - pendScaled = 0`. OK.

But the Rust `retire` for `redeemed=false` (bare burn) and `forfeit=false`: `if r.active { ... c.owed_scaled -= pending; ... }`. And it does NOT add `pending` back to anything else — the pool keeps the sats. So `owed_scaled` falls by `pending`, and the pool's `avail` rises by `ceil(pending)`... approximately. Hmm: `avail = balance - ceil(owed)`. After retire, `owed` falls by `pending` (a scaled amount). `ceil(owed_new) = ceil(owed_old - pending)`. And `pending` might be sub-sat. So `avail` rises by about `pending/1e12` sats. Fine.

But there's a subtlety: `retire` sets `r.debt_scaled = full` (not `= debt + pending`). `full = w * acc`. And `pending = full - debt`. So `debt_new = full`. And `owed -= pending = owed - (full - debt)`. Hmm. If the vault later... it's retired, so no more claims. Fine.

Is `owed_scaled` after a retire still ≥ the sum of remaining vaults' pending? `owed_scaled` is incremented by `delta * w` at each credit and decremented by `pay * ACC_SCALE` at each claim and by `pending` at each retire. The invariant P.32: the pool holds ≥ ceil(owed). Hmm, `pending` for a retired vault is `full - debt` which is exactly what it was owed (scaled). So subtracting it is right. Good.

But: `pending` can be sub-sat (e.g. 0.5 sat = 5e11 scaled). The pool must keep `ceil(owed)` sats. After the retire, `owed` drops by 5e11, so `ceil(owed)` may drop by 1 sat or 0. The pool keeps the sat. So the pool can hold slightly more than it owes. Fine (documented: "a sub-sat residue goes back to the pool").

Hmm — one divergence: `accrual.pendingSats` returns `p / ACC_SCALE` (whole sats), but `retire`'s `pending` is the SCALED value. The selftest's `pendScaled` uses the scaled form. So the mirror of `retire` would need scaled arithmetic. Not exposed as a function. So: **`bank/accrual.mjs` has no `retire` mirror; the only assertion of retire arithmetic is a single inline selftest line that checks `owed - pendScaled == 0` for one synthetic case, and it does not check the `forfeit` path, the `redeemed && !forfeit` `ClaimBeforeBurn` bound, or the pending-count bookkeeping.** That's a legitimate R4/R6 finding: the four named functions are mirrored but `retire` is not, and the one assertion that touches it is a single case. MEDIUM/LOW.

Let me double-check the prompt: "R4. THE MONEY ARITHMETIC (`bank/accrual.mjs`) must equal the program's (... `credit`, `claim`, `retire`, `ceil_sats`, `join`). Find any divergence." So I should report: no divergence in credit/claim/ceil_sats/join; `retire` is not mirrored at all (only one inline assertion), so the property "a retired vault's unpaid share returns to the pool" is asserted once and never recomputed against the Rust.

Hmm, also: `accrual.credit` throws `'no activated weight'` when `w <= 0`. The Rust `credit` divides by `w` — if `w == 0`, `avail * ACC_SCALE / 0` → division by zero → with overflow-checks... actually Rust integer division by zero PANICS (and in BPF it aborts). But `credit` is only called when `w > 0` (the `w == 0` branch returns earlier in `distribute`, and `monthly_inline` checks `total_active_weight == 0`). So it's guarded. But `credit` itself has no `require!(w > 0)`. Hmm — `monthly_inline`: `let w = c.total_active_weight; credit(c, avail, w, now)?;` — this is reached only after `if c.total_active_weight == 0 { ... return Ok(()) }`. So `w > 0`. And `distribute`: `let w = ctx.accounts.config.total_active_weight; if w == 0 { ... return tick }` then later `credit(c, avail, w, now)`. So `w > 0`. Good. So the guard is present at both call sites but not in `credit` itself. The accrual's `credit` throws. Fine.

OK. R5 (revenue):
- The worst case is documented.
- "check the ledger cannot read a failed cycle as closed": `cycleIsOpen` — but there's a case: **a cycle whose sweep was confirmed and whose swap FAILED, where `sendRejected` is NOT set** — `cycleIsOpen` returns true (open). Good. And a cycle where the whole run crashed after `save(led)` with only `startedAt` + `intendedLamports` → `moved = intendedLamports != 0` and `returnedSats` undefined → 0n → open. Good.

Hmm — but there IS a hole: `cycleIsOpen` returns false if `moved === 0n`. `moved = BigInt(c?.sweptLamports ?? c?.intendedLamports ?? 0)`. If `sweptLamports` is the STRING `'0'`, `?? ` doesn't trigger (it's not nullish) → `BigInt('0') = 0` → closed. When would `sweptLamports` be '0'? `cycle.sweptLamports = String(amount)` and `amount > 0` is required by the program... but the code sets `sweptLamports` AFTER a successful send, and `amount` is computed as `balance - reserve` clamped. If `amount === 0n`, the code returns early ("nothing to sweep"). So `sweptLamports` is never '0'. OK.

Hmm — `if (c?.sendRejected) return false` comes BEFORE the `moved` check. A rejected send sets `sendRejected = true` and never sets `sweptLamports`. Good.

But: **the `sendRejected` determination is a regex on the error message** (`/custom program error|Error Code:|Transaction simulation failed/`). A confirmation TIMEOUT on a transaction that actually landed is NOT matched → `throw e` → the row stays open (correct). But a transaction that was rejected for a NON-program reason (e.g. blockhash not found, insufficient funds) would also not match → treated as unconfirmed → open forever → **every future run refuses to start a new cycle** (`open.length` → throw) until a human resolves it. Hmm — "insufficient funds" is a simulation failure: `Transaction simulation failed: ... insufficient funds`. That MATCHES `Transaction simulation failed`. So `sendRejected` = true. And `blockhash not found` → not matched → open. That's a transient error that wedges the pipeline permanently. Hmm — is that "the ledger cannot read a failed cycle as closed"? It's the opposite (it reads a non-cycle as open). The consequence: `revenue.mjs` refuses to run forever after one transient error. And `detectUnreconciledRevenue` reports `unreconciled_swap` CRITICAL every pass. So it's loud, not silent. It's a liveness wedge requiring manual ledger surgery. MEDIUM.

Actually let me re-read: after `cycle.sendRejected = true; cycle.error = ...; save(led); throw`. So a rejected send is recorded and closed. For a NON-rejected throw (the `throw e` branch), the row has `startedAt`, `quotedSats`, `intendedLamports`, and possibly `sweepSig` (if the assignment happened... no: `cycle.sweepSig = await sendAndConfirmTransaction(...)` — if it throws, `sweepSig` is never assigned). So the row has `intendedLamports` and no `sweptLamports`. `cycleIsOpen`: `moved = sweptLamports ?? intendedLamports` = intended (nonzero) → `sendRejected` falsy → `returnedSats` 0 → OPEN. And `detectUnreconciledRevenue` reports it as "swept X lamports ... and NO cbBTC came back (... and the sweep itself was never confirmed into the ledger, so the amount is the intent)". So a transient `blockhash not found` produces a permanent CRITICAL and a permanently wedged revenue cycle. That IS a real finding: **the `sendRejected` classifier is a regex over the error text, and anything it does not match (blockhash expiry, a dropped transaction, an RPC 5xx) is recorded as an open cycle — wedging every future sweep and raising a permanent CRITICAL — even though no SOL moved.** MEDIUM. Evidence: `node bank/revenue.mjs --live` with a deliberately stale blockhash → the ledger gains a cycle with `intendedLamports` and no `sweepSig`; the next run throws "1 revenue cycle(s) swept SOL and never recorded a cbBTC return"; `alarm.mjs` reports `unreconciled_swap` CRITICAL every pass.

Fix: confirm the sweep's on-chain status before treating the row as moved (check `getSignatureStatuses` / look for the `sweepSig` on chain), and only mark the cycle open when a signature exists; otherwise mark it `sendUnconfirmed` and re-verify.

Hmm, and the symmetric hole: a transaction that LANDED but whose confirmation timed out → the row has no `sweepSig` → `detectUnledgeredSweeps` would find the on-chain sweep with no ledger row → `unledgered_sweep` CRITICAL. And `cycleIsOpen` says open. So it's loud. OK.

- "nothing here can send value anywhere the program does not pin": the Jupiter swap is the trusted hop (documented). The `FORBIDDEN` check is narrow. Documented as "a bound, not a proof". I'll note that `FORBIDDEN` does not include the SPL Token program or the System program, so a tampered swap transaction could transfer the operator's existing balances (not just the cycle's) to an arbitrary account — the check only forbids BPFLoaderUpgradeable and the MINT program. And the comment says "A dedicated operator wallet holding nothing but the cycle's own funds is the other half, and is an ops matter." So it's documented. But the `OPERATOR_FLOOR = 20_000_000n` (0.02 SOL) is checked AFTER... let me look: `const opSol = ...; if (opSol < OPERATOR_FLOOR) throw` — before the sweep. And `opBefore` is read before the sweep. OK.

Hmm — one real issue: **`vtx.sign([operator])` signs whatever the HTTP response returned, and the `FORBIDDEN` list is checked against `msg.staticAccountKeys` only.** With `msg.addressTableLookups` (up to 4 allowed), the ACTUAL accounts in the transaction include the looked-up ones, which are NOT checked. So a tampered response could route value through an ALT-resolved account. The check caps lookups at 4 but doesn't inspect them. The comment acknowledges "This is a bound, not a proof." I'll note it as a concrete gap in the bound: **the static-account allowlist does not cover address-table lookups, so the one place the bound is meant to hold is exactly where it does not reach.** MEDIUM? It's the trusted hop — accepted limit 10. But the stated bound ("no program in the message that we know moves value outside a swap") is not delivered for ALT-resolved accounts. I'll fold it into R5 as a MEDIUM: the worst-case bound on the swap transaction is weaker than stated.

Hmm, actually the bound claimed is "exactly ONE signer (us), and no program in the message that we know moves value outside a swap". A program id resolved via an ALT would be in the lookup table, not in `staticAccountKeys`. So `keys.filter(k => FORBIDDEN.includes(k))` misses it. And `msg.addressTableLookups?.length > 4` is the only ALT bound. So yes.

R6 (gates):
- The `V6_WIRED` regex matches comments.
- The signer-set gate scans only bank/, scripts/, tests/ and only `fromSecretKey`.
- The `d('...')` instruction gate misses `ixDisc('...')`.
- The crank's `t.address !== r.vault_ata` guard is unreachable (production wiring) — though the selftest proves the detector on synthetic input.
- `MIN_ASSERTIONS` etc. require exact equality now — good.
- Are there vacuous passes? `detectVaultSetChange([], ...)` → `!prevLive.length` → quiet with `trustCurrent: true`. And `alarm.mjs` stores `vaults: setChange.trustCurrent ? vaults : ...`. On a first run with `prev.vaults = []` (from the idle branch: `writeState({ ..., vaults: [], ... })`), the next pass's `detectVaultSetChange([], ...)` → `!prevLive.length` → quiet and `trustCurrent: true`. So the baseline is adopted on the second pass. Fine.

Hmm — here's a vacuous-adjacent one: `detectVaultSetChange` with `prevLive` non-empty but `current.live` empty and `burnt` empty → `gone = prevLive` (all of them) → `ratio` guard → `gone.length > allowed` → `vault_index_shrank`. Good.

- `floor()` with `n -eq 4`. Good.

Let me look at one more: **`bank/selftest.mjs`'s `t('the template installs exactly the six v6 jobs', ...)`** uses `cron.split('\n').filter(l => /^[0-9*][^ ]* .*\$TAG \S+$/)`. If cron-install.sh had no such lines, `installs` = [] and `.map(...)` = [] which != the 6-element array → red. Good.

Hmm — `t('every money job in the REAL cron template is wrapped in flock', D.judgeCronTemplate(cron), [])`. If there are no money jobs, `judgeCronTemplate` returns [] → vacuous pass. But the `installs` check covers it. OK.

Now let me think about whether I've missed anything big.

**`bank/crank.mjs`'s `attrsHash` vs the program for a CHARTER vault.** `claim_charter_vault` does `let mut full = attributes.clone(); full.push(VaultAttribute { key: ATTR_CHARTER, value: pob.to_string() });` and `write_record(..., &full, ...)` → `attrs_hash` is of `full` (including `charter`). And `create_vault(..., &full)`. So Core stores `full`. The reveal must re-send `full`. The crank reads the attributes off Core → gets `full` (including `charter`). And `attrsHash(full) === r.attrs_hash`. Good.

But `check_attributes(&attributes, MAX_ATTRS - 2)` for charter — so 6 caller attributes + `charter` + `level` = 8. And `write_record`'s byte budget counts `full` (including charter). Good.

Hmm — the `reveal_level` data: `attrsBorsh(list)` where `list` is read off Core. And the program's `reveal_level` checks `hashv(&[&attributes.try_to_vec()?]) == hash` and then writes `attributes.len() + 1` entries (adding `level`). Good.

OK. Another: **the crank's `mintedAttributes` uses `deserializeAssetV1` from `@metaplex-foundation/mpl-core`.** If that library's `attributeList` order differs from the on-chain stored order... it reads the account bytes in order. Fine.

Now — **`bank/crank.mjs`'s `assets` map is keyed by `r.asset`**, and `tokens` too. If two records share the same asset (impossible — the PDA is `["vault", asset]`), fine.

Let me now consider the **`planCrank` `byIndex` map**: `new Map(records.map(r => [BigInt(r.mint_index), r]))`. If two records have the same mint_index (impossible), fine.

OK — one more thought on R2: "a dangerous on-chain state it reads as quiet". Let me add:

- **`detectVaultSetChange`'s `maxDropRatio` guard can hide a real mass burn.** If an attacker bare-burns more than 10% of vaults in one pass (e.g. 250 of 2100), the detector reports `vault_index_shrank` (one CRITICAL about the index) and does NOT update the baseline. So the individual burns are never reported, and the baseline stays stale forever (until a pass with ≤10% drop). Hmm — `trustCurrent: false` → `vaults: prev?.vaults || vaults`. So the baseline stays the old list. Next pass: `gone` = the same 250 → again > allowed → `vault_index_shrank` again. So it pages every pass with one CRITICAL, but never names the burned vaults. And `detectIndexShortfall` would report `index_disagrees_with_chain` (live+burnt != minted_total)? Actually `burnt` would contain them. `listVaults` puts burnt ones in `burnt`. So `live.size + burnt.size == minted_total` → quiet. And `detectVaultSetChange` compares `prevLive` to `current.live`. The 250 are in `current.burnt`. So `gone` = 250 → `> allowed` (210) → `vault_index_shrank`. Hmm, allowed = max(3, floor(2100 * 0.1)) = 210. So 250 > 210 → the guard fires. But 200 burns would be reported individually. So a mass bare-burn of 211+ vaults is misreported as "the index is wrong". Given the redemption cap (2.1%/hour = 45/hour), a mass BURN (bare, uncapped) of 211 is possible in one pass (30 min) by an attacker who owns them. And the detector would say "the index is more likely wrong than the chain" and refuse to update the baseline. So the alarm misdiagnoses a real attack as an index fault. That's a genuine finding: **the false-alarm guard can be triggered by a real attack of ≥11% of live vaults bare-burned within one 30-minute pass, and then it reports the index as untrustworthy and never names the burned vaults — while also freezing the baseline so every later pass repeats the same misdiagnosis.** Hmm, and `trustCurrent: false` keeps the OLD baseline. So the next pass reports the same 250 again. Forever. So the alarm is stuck in a permanent `vault_index_shrank` state and never reports the actual burns. That's HIGH-ish. But it's arguably a deliberate trade ("a detector that cries wolf at that volume is one nobody reads"). And the accepted-limits list doesn't mention it. Hmm. The `maxDropRatio` is `opts.maxDropRatio ?? 0.1` and `alarm.mjs` calls `D.detectVaultSetChange(prev?.vaults, { live: vaults, burnt })` without opts → 0.1. With 2,100 vaults and 45 redemptions/hour, normal churn is ~22 per 30-min pass. So 210 is a high bar. But a hostile holder with 211 vaults (or a custodial key leak) could bare-burn them all in one transaction each... 211 transactions in 30 min is trivial. So: **a holder (or thief) bare-burning ≥11% of live vaults in one alarm interval converts the burn detector into a permanent index-fault alarm that never names a single burned vault.** MEDIUM/HIGH. I'll file as MEDIUM with the evidence.

Hmm, but `detectBurns` (the signature scan) would catch a bare Core BurnV1 for each in transactions that touch... no — `detectBurns`'s Core arm requires the transaction to be in one of OUR FOUR programs' signature walks. A bare BurnV1 touches only Core → not in any walk. And the comment says exactly that. So the DAS diff is the only instrument. And the guard defeats it at ≥11%. So yes, real.

And `prev?.vaults` is the LIVE list only (not burnt). So `gone` = previously-live now-not-live. A redemptions also make vaults gone (but `correlateBurns` downgrades them if `burn_vault` was seen). And45 redemptions/hour → 22 per pass. Plus reschedules... fine.

OK, I'll include it.

Let me also double check `detectVaultSetChange`'s `allowed = Math.max(3, Math.floor(prevLive.length * ratio))`. For 2100: 210. For 240 (charter only): 24. So at240 live, 25 bare burns trigger the guard. Even more reachable early.

Hmm — actually, wait. At launch with 240 charter vaults, `allowed = 24`. A holder with 25 PoB vaults could bare-burn 25 and trip the guard. Plausible.

Good.

Now let me also think: is `detectVaultSetChange`'s `gone` computed against `prevLive` which includes vaults that were redeemed in a PREVIOUS pass? `prev.vaults` is `vaults` (the live list) from the previous pass. So a vault redeemed in pass N leaves `live` at pass N, and at pass N+1 `prevLive` doesn't contain it. So `gone` only contains vaults that left between passes. Good.

OK, let me now also verify the claim about `CBOB_LOCK_DEADLINE` once more. In `alarm.mjs`:

```
  findings.push(...D.detectUpgradeAuthorityAfterLock(cfg,
    { lockDeadlineSec: Number(process.env.CBOB_LOCK_DEADLINE || 0) || null, nowSec }))
```

`Number(process.env.CBOB_LOCK_DEADLINE || 0) || null` — if the env var is unset, `Number(0) = 0` → `0 || null` = null. If set to "1780000000", `Number(...) = 1780000000` → truthy → used. If set to "0" or "" → null. So yes, silent off.

And the detector returns [] if `!lockDeadlineSec`. And `missingWatchedKeys` skips `prog.*`. So nothing else catches it.

And the report's all-clear: "no drift in any config value, program upgrade authority, program bytes or the collection plugins." Hmm — "program upgrade authority" DRIFT is watched via `prog.*.upgrade_authority` in WATCH. So if the authority is unchanged (still the deploy key) from the first pass, drift is quiet. So the all-clear is true about DRIFT but the sentence reads as a general all-clear about upgrade authority. Combined with `detectUpgradeAuthorityAfterLock` being off, a program that was never locked reads as calm forever. And step 11 of the road (remove the upgrade authority) could be skipped. HIGH. Good.

Now, one more: **`run-tests.sh` and `check-launch-params.mjs`** — I don't have `check-launch-params.mjs` in the bundle. So I can't verify item 38's gate. Note the coverage gap.

Also missing from the bundle: `programs/cbob-vaults/src/lib.rs` (SEAL), `programs/cbob-vault-burn/src/lib.rs` (BURN), `programs/cbob-vault-gov/src/lib.rs` (GOV), `bank/sigwalk.mjs`, `scripts/cron-install.sh`, `scripts/check-launch-params.mjs`, `scripts/probe-mainnet-facts.mjs`, `scripts/build-mainnet.sh`, `scripts/pob-merkle.mjs`, `tests/3prog.test.ts`, `sim/*`, `launch/mainnet-init.json`, `HOLDER-GUIDE.md`, `DESIGN-v6.md`, `bank/redemption-poster.mjs` is present. So a LOT is missing. The selftest reads many of these at runtime (`/opt/cbob-vaults/scripts/cron-install.sh`, `/opt/cbob-vaults/SPEC.md`, the Rust sources). So the gates depend on files not in the bundle. Per the project's own coverage rule ("Rounds 11 and 12 both produced their worst findings in files no auditor had seen"), this round's coverage is: bank/*.mjs (9 files), MINT's Rust, run-tests.sh, SPEC.md. Missing: 3 of 4 programs' source, 7+ scripts, the test suite, the sim, the launch file, the holder guide, the design doc. I must name this prominently — it bounds every conclusion.

Now, the final section: "GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot? Be concrete."

I should be concrete: 
1. Actually run the dress rehearsal with real money at production-shaped values — but the pipeline hardcodes program ids, so fix that first.
2. Have a human (Gary) sign the launch values and the holder-facing copy, and physically hold the guardian and INIT_AUTHORITY keys offline.
3. Red-team the OPERATIONAL side: key ceremony, the exact sequence of initialize ×4 + authority removal, with a written runbook and a second person verifying each signature's accounts.
4. Test the recovery paths by hand: a lost crank key, a wedged lock, a corrupt ledger, a frozen pool — because the accepted limits say "a human notices", and no AI round can notice.
5. Commission a formal verification / manual review of the FOUR programs together (not AI) before authority removal — the ruling says AI or not at all, but there is a middle: a public bug bounty with real money AFTER the dress rehearsal and BEFORE authority removal, plus a published source-verification script anyone can run.
6. Measure the real worst-case packet/CU on MAINNET (not a validator) for the redemption with 3 reserves + claim + crank.
7. Get the holder guide legally reviewed for over-claims (limit 41).
8. Establish an incident response: who holds the guardian key, how fast can it be pulled, and what is the public statement.
9. Have someone who is not the author write the runbook for "the alarm pages at 3am" and then have a person who is not the author follow it with a synthetic page.
10. Publish an on-chain verification tool that any holder can run to check their vault's level draw, their owed share, and the pool's solvency — because after immutability the holders' only recourse is public verification.

Also: run the system for a month on a public testnet with strangers invited to break it.

Also: before removing the upgrade authority, freeze and publish the exact deployed bytes' sha256, and have a third party independently rebuild from source and compare.

Let me also mention: the 645-assertion suite exercises the local validator; it does not exercise RPC rate limits, DAS lag, blockhash expiry, or two cranks racing on different boxes. Those are exactly the failure modes of items 22 and 6/7.

OK. Let me also make sure I answer the four accepted-limits questions explicitly.

1. Is any limit WORSE than stated?
   - Limit 7/36: `distribution_overdue` does not fire in the zero-weight state (launch, everyone joined-and-left, everyone redeemed), which is exactly when the crank is the only thing that can start the chain. Worse.
   - Limit 25's "every reschedule logs … so the alarm pages" is delivered.
   - Limit 32's ring claim: unverifiable without BURN's source.
   - Limit 28 (frozen pool): also blocks `plan.joins` in the crank — a one-pass delay, minor.
   - Limit 9/44: unchanged.
   - Limit 40 (Core upgradeable): WORSE than stated in one specific way — a Core change that alters attribute ordering or the Attributes plugin serialization makes `reveal_level` fail `AttributesMismatch` for every unrevealed vault, and the reveal FIFO means one stuck vault blocks every vault behind it forever. That's a whole-schedule halt, not just "reaches every vault". Actually the accepted text says "A Core upgrade that changes UpdatePluginV1, ExecuteV1, BurnV1 or the plugin rules reaches every vault, and our immutable programs cannot adapt." So it's broadly stated. But the FIFO amplification (one vault blocks all later ones) is not stated. I'll mention it.

2. Is anything listed as a limit not actually a limit / already closed?
   - Limit 35 (the 10% turnout rule never binds) — arithmetic checks out: quorum 21% × threshold 51% = 10.71% YES minimum. Yes, correct. Not a limit.
   - Limit 37 says "A charter claim with an Oracle pass-through fits only without a crank attached" — unverifiable without the packet measurement.
   - Limit 49 (record rent not refunded) — matches the code (no close instruction).
   - Hmm, limit 27: "claim does not check that the asset is alive" — verified in `claim` (it only checks `r.pending` / `r.active`). Yes, real.

3. Is any DISCHARGED item not actually discharged?
   - 19: `activate` requires level 1..5. But `claim`'s JOIN path (`if r.pending`) does NOT require a level — it uses `LEVEL_WEIGHTS[(r.level - 1) as usize]`. But pending implies level ≥ 1. So OK.
   - Hmm, 19's claim "there is no state in which a vault is activated but unlevelled" — `join` sets `active = true` and uses `LEVEL_WEIGHTS[r.level - 1]`. If `r.level == 0` and `r.pending`... unreachable. OK.
   - 30: verified.
   - 12/17: unverifiable (needs the suite).
   - Let me check 14: `check_attributes` has `require!(!attributes[..i].iter().any(|b| b.key == a.key), DuplicateAttribute)`. ✓.
   - Let me check 31: `emission_min` is gone from MintConfig. ✓.
   - Hmm — 33: "the successful apply is exercised for both keys". Unverifiable.
   
   So: nothing clearly undischarged. But I'll note 12/17 and 33 cannot be re-verified from this bundle.

4. Is any OPEN AND BLOCKING being quietly treated as accepted?
   - Item 22: the SPEC's step 8 says "the crank and alarm live" but the pipeline hardcodes the production program ids, so as written the rehearsal cannot run them. That is quietly treating 22 as a checkbox.
   - Item 50: the control table classifies `judgeRedemptionCoverage` as **PROCEDURE** and says "Nothing runs it today." PROCEDURE means "a human runs it, real, and skippable". But nothing CAN run it — there is no page. So the table's own third column ("PROCEDURE — a human (or a page not yet built) runs it") is doing work to make an unbuilt surface look like a control. That's a quiet demotion of item 50 into the table. Good catch. The table says "PROCEDURE. Nothing runs it today." — honest. But the column's definition ("Real, and skippable") is not true of something that cannot be run. I'll name it.

Now let me also double-check one thing about the crank's `plan.distribute` and the `MonthNotElapsed` false-ok.

```
  const runDistribute = async (label, ixs) => {
    try { ... console.log(`  ok   ${label}  ${sig}`) }
    catch (e) { const m = String(e.message) + ' ' + (e.logs || []).join(' ')
      if (/MonthNotElapsed/.test(m)) console.log(`  ok   ${label}: already run in-line by other traffic`)
      else { ... failures.push(label) } } }
```

`sendAndConfirmTransaction` throws with `e.message` containing the RPC error. For a program error, the message is like `Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1779` and `e.logs` contains the program logs (including `Program log: AnchorError ...`). Does `MonthNotElapsed` appear? The Anchor error NAME is emitted in the logs as `Program log: AnchorError occurred. Error Code: MonthNotElapsed. Error Number: ...`. Hmm — actually Anchor logs: `Program log: AnchorError thrown in programs/.../lib.rs: 123. Error Code: MonthNotElapsed. Error Number: 7000. Error Message: ...`. So `e.logs` would contain "MonthNotElapsed". But does `sendAndConfirmTransaction` attach `.logs` to the error? `SendTransactionError` has a `logs` property in web3.js v1. Yes (`SendTransactionError.getLogs`). Hmm, `e.logs` — in web3.js, `SendTransactionError` has `logs?: string[]`. It's set when `sendAndConfirmTransaction` catches a simulation error. OK, plausible. The comment in `revenue.mjs` even says "It does not live there: `sendAndConfirmTransaction` throws with the RPC-level string and the Anchor name is emitted in the program LOGS." So the author knows. And `runDistribute` reads `e.logs`. OK.

But the semantics: MonthNotElapsed means "the chain says not due", which the code reports as "already run in-line by other traffic". Those are different. If the crank's clock is 10 minutes fast, it sends the distribute early, gets MonthNotElapsed, and logs "ok: already run". The distribution does NOT happen. And the next pass (hourly) would re-check. So it self-corrects within an hour. But the log line is a lie and, combined with `distribution_overdue`'s blindness at w == 0, a persistent clock skew could keep the tick from ever running. Hmm, but the tick is only sent when `due` per the local clock; if the local clock is fast, `due` is true early and the program refuses; next hour, `due` is even truer and the program accepts. So it self-corrects. Only if the local clock is SLOW would `due` never be true — and then `distribution_overdue` (also using the local clock) wouldn't fire either. So a slow clock delays both. The alarm's `nowSec` is the same box's clock. So the whole liveness story rests on that box's NTP. Worth a note.

Actually — hmm, `detectDistributionOverdue` uses `nowSec` from `Math.floor(Date.now() / 1000)` and `cur['mint.last_distribute_at']` from the chain. If the box clock is slow by a day, the detector thinks the distribution is not late. And the crank thinks it's not due. So nothing runs and nothing pages. That's a single point of failure (the box's clock) for the whole liveness story. But the in-line monthly uses `Clock::get()?.unix_timestamp` (chain time), so ANY protocol traffic triggers it. So it's survivable. And a slow clock is an ops issue. LOW.

OK. Let me also note: **`bank/crank.mjs` and `bank/alarm.mjs` both read `/opt/gary-club/.env.local` for `HELIUS_RPC_URL`** — a single RPC provider. If Helius is down, the crank fails and pages; the alarm fails and pages. OK.

Alright. One more look at a possible CRITICAL in the money path.

`split_revenue`'s rounding: `bank_cut = total * (BPS - split_bps) / BPS` = `total * 1500 / 10000` (floor). `holders = total - bank_cut`. So the Squads get the floor and the holders get the remainder. Documented as "the rounding goes to the holders". ✓.

`sweep_sol_for_swap`: `require!(bal >= keep.checked_add(amount)?)`. And `invoke_signed(system_instruction::transfer(&revenue, &operator, amount))`. The revenue PDA is a system account? It's `Pubkey::find_program_address(&[REVENUE_SEED], &crate::ID)` — a PDA with no data, holding lamports. `system_instruction::transfer` from a PDA requires the PDA to sign (invoke_signed). But the System program requires the `from` account to be a system-owned account with no data. The revenue PDA is created how? `find_program_address` doesn't create it. Someone must transfer lamports to it. A PDA with 0 data owned by System can sign a transfer via invoke_signed. Yes — that works (the classic "PDA as a SOL wallet" pattern). OK.

Hmm — but `RENT_EXEMPT_0_BYTES = 890_880` and `require!(bal >= keep + amount)`. If `keep == 0`, `bal >= amount` — but then the revenue PDA would drop below rent exemption... it's a 0-byte system account, so rent-exempt is 890,880 lamports (on the validator;650,240 on mainnet per measured fact 9). If the balance drops below rent-exempt, the account can be reclaimed? System accounts with 0 data and balance < rent-exempt... Actually a 0-byte account is always rent-exempt at 0 lamports? Hmm, `RENT_EXEMPT_0_BYTES` — the measured fact says "Mainnet's rent rate is LOWER than solana-test-validator's default (650,240 vs 890,880 lamports for 0 bytes)". So a 0-byte account needs 650,240 on mainnet to be rent-exempt. `initialize` requires `sol_reserve_lamports == 0 || sol_reserve_lamports >= RENT_EXEMPT_0_BYTES (890,880)`. So a reserve of 0 is allowed! And then `bal >= 0 + amount` → the revenue PDA could be drained to 0 lamports. A system account with 0 lamports and 0 data... is it then reclaimable / does it matter? The PDA can still sign later if it gets funded again. Actually a 0-lamport account is effectively deleted (the runtime reclaims accounts with 0 lamports). Then `invoke_signed` transfer from a non-existent account... Hmm. But `initialize`'s `require!(sol_reserve_lamports == 0 || sol_reserve_lamports >= RENT_EXEMPT_0_BYTES)` explicitly allows 0. And the SPEC says "a reserve BETWEEN zero and this wedges every sweep forever" — so 0 is allowed and a reserve of 1..890879 is refused. And `tighten_sweep` requires `x >= RENT_EXEMPT_0_BYTES` for a vote. So a vote can only RAISE the reserve to ≥ 890,880. And `initialize` can set 0. Item 38's PROPOSED reserve is 0.05 SOL = 50,000,000 lamports, which is ≥ 890,880. OK.

Hmm — so if `sol_reserve_lamports == 0`, the revenue PDA can be drained to 0. Is that a problem? The PDA is a 0-data system account. At 0 lamports it's gone. Then `split_revenue`'s `revenue` account... `split_revenue` transfers SPL tokens from `revenue_ata`, signing as the revenue PDA. `invoke_signed` with the PDA as a signer — the account must exist to be in the transaction. If it has 0 lamports, the account is gone and `AccountInfo` for it would be... the runtime creates a placeholder for any account named in the transaction? No — a 0-lamport account is not returned by `getAccountInfo`. In a transaction, if an account is named but doesn't exist, it's a0-lamport system account placeholder. And `invoke_signed` can still sign for it (the signature is by seeds, not by the account's existence). Hmm, actually the SPL `TransferChecked` requires the `authority` account to be a signer; the token program checks the signature. PDA signing via invoke_signed works even if the authority account has 0 data and 0 lamports? The account must be present in the transaction's account list and marked as a signer in the CPI. I believe it works. So draining to 0 is survivable. Not a finding.

OK. Let me also check: `REVENUE` in revenue.mjs is `PublicKey.findProgramAddressSync([Buffer.from('revenue')], MINT_PROG)`. And the SPEC says the revenue address is `BXzdn56h93KX5cZryRXab89VpwGtwPzWA4wegqsHCiuX`. Fine.

Alright. Let me also double check the claim about the FIFO + `reveal_level` being permissionless with a `payer: Signer`. Yes, `RevealLevel.payer: Signer`. So anyone can un-stall a hash-mismatch vault IF they can reconstruct the attribute list. Good.

Now, let me write this up. I need to be careful about severity and about giving checkable evidence.

Let me reconsider the "readySlot" finding's evidence more concretely: "If your claim were true, what evidence would exist on chain or in a test run?" → On a local validator, set up a vault with `reveal_slot = S`, skip producing leader groups in the A..C span (or simply call `capture_entropy` at slot `readySlot(S)+1` when slot `S+8..S+11` were skipped), and observe `custom program error` `RevealTooEarly` from `capture_entropy` and again from `reveal_level`, with `CBOB crank:2 action(s) failed` in the log and the notify script invoked. Concretely: `bank/crank.mjs --live` after `solana-test-validator` with the leader skipping; or unit-test `readySlot` against `try_capture`'s `want` computation for a reveal_slot whose group is skipped.

Actually, I can give a cleaner, purely arithmetic counterexample: `reveal_slot = 1000` and slots 1008–1011 unproduced. `readySlot(1000) = 1016`, so the crank captures at slot 1017. `try_capture` computes A = 1000 (group 250), want_B = 1008, B = 1012 (group 253), want_C = 1020. At slot 1017 the sysvar holds nothing at/after 1020 → `Capture::NotYet` → `capture_entropy` returns `RevealTooEarly`. Evidence: the transaction signature's logs contain `Program log: AnchorError ... Error Code: RevealTooEarly` (or the error code number), and the crank prints `FAIL capture <addr>`. Good — checkable.

Let me also give the `redemptions_near_cap` evidence: `D.detectRedemptionRate({'mint.minted_total':'47','burn.burned_total':'0','mint.bare_burns_retired':'0','burn.redeem_window_secs':'3600','burn.rate_ring':[...64 '0's]}, 1700000000)` returns one `redemptions_near_cap` HIGH. Pure function — directly runnable.

And `detectDistributionOverdue` evidence: `D.detectDistributionOverdue({'mint.last_distribute_at':'1000','mint.monthly_secs':'2592000','mint.total_active_weight':'0','mint.pending_count':'5','mint.pending_this_epoch':'5'}, {nowSec: 1000+2592000+25*3600, poolAvail: 50n})` returns `[]`. Directly runnable.

And the lock-deadline evidence: run `node bank/alarm.mjs --dry-run` on a deployment where `CBOB_LOCK_DEADLINE` is unset and one of the four programs still has an upgrade authority; the report contains no `program_not_locked` and ends with the all-clear line naming "program upgrade authority".

Good.

Let me now also decide: do I have any CRITICAL? Let me think about whether anything directly loses customer money.

- The reveal FIFO stall: freezes payouts for a suffix of vaults. Not a loss (money stays in the pool). But it's permanent and immutable. Hmm — could I make it CRITICAL? "a fix applied to one of two identical sites"... Let me think about whether a minter can DELIBERATELY create an un-revealable vault. The minter chooses `name`, `uri`, `attributes`. `create_vault` writes them to Core. `write_record` hashes `attributes`. The reveal re-sends `attributes` and hashes. So the hash always matches IF the crank reads Core correctly. Could a minter send attributes that Core stores but the crank reads DIFFERENTLY? E.g. an attribute whose key/value contains a character that mpl-core's deserializer normalizes? Or attributes beyond what Core stores (Core might cap the list)? If Core silently truncates the attribute list at create, the stored list would differ from the hashed one → `AttributesMismatch` forever. Hmm! `check_attributes(&attributes, MAX_ATTRS - 1)` bounds the count and each string at 128 bytes. And `write_record` bounds the Borsh bytes at 640. But Core's CreateV2 with an Attributes plugin — is there a Core-side bound? If Core accepts7 attributes but the plugin's serialization differs... The suite proves a reveal works (L.12). But that's for the tested shapes. A minter could send an attribute key/value at exactly 128 bytes of multi-byte UTF-8, or with unusual codepoints. `push_attr` writes `k.len()` = Rust's byte length. `attrsBorsh` writes `Buffer.from(s,'utf8').length`. Same. Hmm.

What about an attribute with a key/value containing a NUL byte? Rust `String` can contain NUL. Borsh writes the raw bytes. Core stores `String`. mpl-core JS deserializes to a JS string. `Buffer.from(s, 'utf8')` round-trips. Should be fine.

What if the minter sends MORE attributes than Core's plugin allows? Core would error at create. Fine.

So the minter probably can't force it. The risk is Core/deserializer drift. I'll rate it MEDIUM and phrase it as a resilience gap rather than an exploit.

Hmm — but there IS one more angle: `create_vault` is called with `&attributes` for `mint_vault` and `&full` for charter. And `write_record` hashes `&attributes` (mint) / `&full` (charter). So they match. Good.

And `reveal_level` writes `attributes.len() + 1` entries: the re-sent list + `level`. So the attribute list grows by one. Fine.

OK. Let me also consider: is there anything that lets someone STEAL?- `claim` pays into `r.vault_ata`, pinned. ✓
- `split_revenue` destinations pinned. ✓
- `sweep_sol_for_swap` destination pinned to `cfg.swap_operator`, signed by the operator. ✓
- The crank can't redirect. ✓
- The swap hop is trusted (accepted). ✓
- `mint_vault` pays `cfg.price` from `payer_token` to `revenue_token`, with `payer: Signer`. ✓

So no theft path found in the bundle.

What about `retire_redeemed` being callable by anyone? It requires `get_stack_height() ==2` and the current top-level instruction to be `burn_vault` for this asset. So it can only be reached from `burn_vault`. And `burn_vault` requires the owner's signature and the emptiness proof. ✓ (BURN's source not in bundle, so I can't verify the pairing.)

OK. I'll rate the top findings HIGH and MEDIUM, no CRITICAL. Actually — let me reconsider the `detectUpgradeAuthorityAfterLock` one. Is it CRITICAL? It's a detection gap, not a money bug. But it's the ONLY control over the single most dangerous pre-launch state (an upgradeable program after the lock date = someone can rewrite every rule). And the all-clear lies about it. Given "every surviving bug is permanent", a silent failure of the lock-date control is serious. I'll call it HIGH (bordering CRITICAL) and explain.

And the `distribution_overdue` blindness: HIGH.

And the `redemptions_near_cap` perpetual page: MEDIUM (noise).

And the FIFO: MEDIUM.

And the mass-burn/guard: MEDIUM.

And the revenue `sendRejected` classifier: MEDIUM.

And the readySlot: MEDIUM.

Let me write it now. I'll organize:

- Coverage caveat first (short).
- R1..R6 findings.
- The four accepted-limits questions.
- Anything else.
- The final section.

Let me be careful with the "do not praise" rule: state findings, and where a target has no finding, say "no fault found in what this bundle lets me check" and name what I could NOT check.

Let me write.

One more scan for something I might have missed in the crank: "a plan that pays or joins a dead vault". 

`plan.claims` skips burned at plan time. But there's one more: **`plan.preJoins` and `plan.joins` skip `assets[r.asset] === 'burned'`, but the JOIN inside `claim` is reached via the pair's record.** If the plan includes a pair `[rec, ata]` for a vault that is live at plan time and burned at send time, the program's `claim` would `join` it (join doesn't check liveness) → adds dead weight (limit 27). And `plan.claims` also includes `ready` entries for active vaults; if burned at send time, `claim` pays into the dead account (limit 27). Both accepted. The crank's mitigation is plan-time-only. I'll note the TOCTOU briefly under "is any limit worse than stated" — limit 27 says "The crank never pays or joins a positively burned vault and retires it first, every pass". "Never" is too strong: only at plan time. A burn landing between the crank's read and its send defeats it. That's a wording overclaim, LOW.

And "a reveal it would send out of order": the plan builds reveals from `revealed_total` in index order. But the I/O sends them in `plan.reveal` order, which is the loop order = ascending index. ✓. Unless `records` has gaps — then `byIndex.get(i)` is undefined → break → no out-of-order. ✓.

Hmm — one thing: `plan.reveal` could contain a vault whose capture PLANNED this pass FAILED. Then the reveal is sent and fails. Not out of order, just a waste. ✓.

And "anything that makes it move value anywhere the program does not already pin": none found. I'll state that as a negative finding