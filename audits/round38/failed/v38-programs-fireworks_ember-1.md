[reasoning only]
Let me start by understanding what I'm being asked to do. This is round 38 of an AI audit process for a Solana vault system (CBOB Vaults). Five programs (SEAL, MINT, BURN, GOV, SWEEP) plus off-chain pipeline and web pages. Round 37 was NOT CLEAN — it found three findings (V1, V2, V3), all in web/, and the repairs are claimed in VALIDATION.md. My job:

1. R0: Verify round 37's verdict and repairs (V1, V2, V3 repairs; C01-C05, C07 off-chain repairs).
2. R1: Custody — can anyone but the owner get value out of a sealed vault, or an emptied vault survive?
3. R1s: The sweep helper.
4. R2: The community pool's money.
5. R2b: The $CBOB boost.
6. R3: The level draw.
7. R4: Governance.
8. R5: The charter claim.
9. R6: One-time configuration and the trusted hop.
10. R7: Cross-program raw reads.
11. R8: The suite, simulation, and build as evidence.

Plus the four questions about accepted limits, and a final section on what AI audit structurally cannot do.

Let me work through the code carefully. I have the full tree in the prompt. Let me be systematic.

First, let me verify round 37's three findings and their repairs:

**V1 (LOW):** Stranger parks ~18,700 empty token accounts at a vault's deposit address → redeem page's `getTokenAccountsByOwner` listing exceeds the proxy's 8 MB cap → page can't read the vault → can't open it. Repair: `vaultWalletAccounts` in `web/src/lib/reads.mjs` now reads reserve accounts by address and lists everything else in bounded reads (8-byte balance slices, 0-byte slices for Token-2022 addresses), with `incomplete` reporting; `plan-redeem.mjs` turns unlisted/unexamined into ONE tick-box, never a refusal; >20 strays grouped into one box.

Let me check the repair:
- `vaultWalletAccounts(conn, owner, reserveMints)`: reads reserve ATAs by address via `accounts()` (getMultipleAccounts, 100 at a time). Then three `getProgramAccounts` calls: classic with dataSize 165 + owner filter + dataSlice {64, 8}; Token-2022 same; Token-2022 all with dataSlice {0,0}. Then full reads of at most STRAY_FULL_READ_MAX=200. If the listing throws, `incomplete.unlisted` set, returns reserves only. Looks right.
- In `plan-redeem.mjs`: `inc?.unlisted` → one ack box `unlisted:all`; `inc?.unexamined` → one box `unlisted:${n}`. NFTs similar via `nftReadIncomplete`. Grouping via `groupAcks` for ids starting with `lost`, `left`, `asset`, `cnft` when >20.

Wait — there's a subtlety. In `plan-redeem.mjs`, the `cannot` list (unreadable/frozen/Token-2022 strays) gets `ack.push({ id: 'lost:...' })`. The `left` list gets `left:...`. Nested NFTs get `asset:...`. Compressed get `cnft:...`. Those are the GROUPED kinds. The `unlisted:all` and `nfts:unlisted` boxes are separate. OK.

Does the proxy accept the new shapes? `gpaShape` in rpc-proxy.mjs: token-owner-amounts (classic, dataSize 165, slice {64,8}, memcmp offset 32 is32), token22-owner-amounts (same for TOKEN_2022), token22-owner (TOKEN_2022, no size, slice {0,0}, memcmp 32). Yes, matches `vaultWalletAccounts`'s three calls. And the proxy test covers them.

One thing to check: in `vaultWalletAccounts`, the classic read filters `dataSize: 165` — classic token accounts are exactly 165. Good. The Token-2022 plain read also filters dataSize 165 (165-byte Token-2022 accounts — those without ImmutableOwner, i.e., non-ATA Token-2022 accounts). And `t22all` reads all Token-2022 accounts with 0-byte slice. Then `want` = classic with balance ≠ 0 not in reserves, plus t22all not in reserves and not in emptyPlain22. Full reads capped at 200. `incomplete.unexamined = want.length - take.length`. If the full read throws, `incomplete.unexamined += take.length` — hmm, that double-counts? No wait: `incomplete.unexamined = want.length - take.length` was set before; then on catch, `incomplete.unexamined += take.length` → total = want.length. That's correct: all `want` accounts unexamined.

But note: if the full read fails, the accounts that WERE going to be examined are now unexamined, but their balances were read in the slice... they're not added to `out`, so the planner never sees them. They get named in the `unlisted:${n}` box. OK.

Also `emptyPlain22` = t22plain accounts with amount 0. A 165-byte Token-2022 account with amount 0 is skipped (W10: no box). But wait — a 165-byte Token-2022 account CAN'T have extensions (extensions make it longer). Actually a Token-2022 account with no extensions is 165 bytes. With ImmutableOwner it's 170. So a 165-byte Token-2022 account has no extensions, so no confidential balance can hide. OK, that's the W10 reasoning. Fine.

Hmm, but actually: can a Token-2022 account be 165 bytes and hold a balance? Yes — a non-ATA Token-2022 account (created with createAccount + InitializeAccount3) is 165 bytes. Those with amount > 0 are included in `want` (not in emptyPlain22). Good.

What about a classic account with amount 0 but a delegate or close authority held by a stranger? It's skipped entirely (not in `want` since amount is 0). It holds nothing, so nothing is lost. Its rent belongs to whoever can close it. Fine — matches the stated rule.

Now, does the repair actually fix V1? The original attack: ~18,700 empty classic accounts → the old `getTokenAccountsByOwner` response > 8 MB → proxy aborts → ReadError → page refuses. Now: the three getProgramAccounts calls return 8-byte slices (or 0-byte). 18,700 accounts × ~238 bytes (measured in the proxy test: "238 bytes an account measured on a synthetic response, so about 35,000 before the cap") ≈ 4.45 MB < 8 MB. So the listing succeeds. And the proxy test measures a flood past even the bounded cap: `mkChain(Math.ceil(MAX_RESPONSE / (Math.max(...sizes) / N)) + 1000)` — the listing is refused by the proxy, the reader doesn't throw, reserves still read, gap reported. So even beyond the bounded cap, the page opens with one box. The repair holds at both levels.

Let me check the e2e arm: "320 parked accounts (one grouped box, the opening lands)". In e2e-localnet.mjs: EMPTY=200, FREEZABLE=120, parked at the deposit address. The plan: `p0.ack.filter(a => a.id.startsWith('group:'))` length 1, `p0.ack.filter(a => /^(lost|left):/.test(a.id)).length` 0, and `Number(groups[0]?.id.split(':')[1]) >= FREEZABLE`. The 200 empty classic accounts: amount 0 → skipped (not in `want`). The 120 freezable (mint has freeze authority = stranger) holding 1 unit each → in `want` (classic, amount ≠ 0), read in full (120 ≤ 200), then in planRedemption they're helperStrays initially but `undeliverable` because mint has freeze authority not in reserves → moved to `cannot` → `lost:` boxes → 120 > 20 → grouped into one box. Good.

Wait, actually — in the e2e, the 120 freezable strays: `s.mintFreeze?.[m]` — the mint mF has freeze authority = stranger. `f` = stranger's address, not in reservesSet → undeliverable → `cannot`. Yes.

And the opening lands: `p2.refuse.length === 0`, and the send succeeds. The 120 freezable strays stay behind (they're not declared to burn_vault — they're not reserve accounts, and BURN only checks declared accounts; undeclared non-reserve token accounts owned by the PDA... wait, BURN's second loop checks ALL declared accounts. The declared list is only the 6 reserve ATAs. The 120 strays are not declared, so BURN never sees them. They're destroyed with the vault (their owner is the PDA, which can never sign again). The holder ticked the grouped box. OK.

Hmm, wait — actually, are they destroyed? The accounts themselves survive (they're separate accounts owned by the Token program), but their owner is the vault's asset-signer PDA, which can never sign again after the burn. So the tokens are stranded forever. "Destroyed" in effect. The box says "lost when the vault is opened". Accurate.

**V2 (LOW):** Anyone can create a Core collection naming MINT's PDA as update authority (update authority need not sign) → `resolveCollection` used to hard-conflict on >1 collection → ceremony stopped forever. Repair: `resolveCollection` now uses pins (config.js, SEAL, launch file, browser memory, session); two differing pins = STOP; one pin wins, others ignored with warning; no pin → each discovered candidate adopted only if `collectionCreator` proves the launch key created it (first transaction naming it succeeded, paid and signed by launch key, is Core CreateCollectionV2 for that address); two created by launch key = STOP; decoy never stops.

Check `collectionCreator`: walks getSignaturesForAddress backwards (newest first) up to HISTORY_PAGES × HISTORY_PAGE = 5,000; the OLDEST signature found is the candidate creation. If history is complete (last page < 1000), `oldest` is the first transaction naming it. Then getTransaction(oldest): checks `tx.meta?.err` → 'other'; checks compiledInstructions for Core CreateCollectionV2 (data[0] === 21) with accountKeyIndexes[0] === collection; checks `msg.header.numRequiredSignatures > 0 && keys[0] === initAuthority` (fee payer and signer is launch key). 

Hmm — `keys[0]` is the fee payer by convention in Solana (first signer). The check `msg.header.numRequiredSignatures > 0 && keys[0] === initAuthority` verifies the first signer is the launch key. The comment says "its fee payer AND signer is the launch key". Since keys[0] is always the fee payer and always a signer, checking keys[0] === initAuthority covers both. OK.

But wait: is the FIRST transaction naming the address necessarily the one that created it? For a fresh keypair address, yes — before creation, no transaction can name it meaningfully (well, someone could name a random address in a transaction before it exists — e.g., a transfer to it! A stranger could send lamports to the would-be collection address before it's created... but the collection keypair is generated in the browser and its address is unknown to anyone before step 0 is sent. Unless the address leaks. It doesn't — it's generated locally and first revealed in the create transaction. Hmm, but actually the address IS revealed when... no, only when the transaction is sent. So the first transaction naming it is the create. Edge: someone could grind, but they can't know the address. OK.)

But there's a subtler issue: `collectionCreator` is only called when NO pin exists. Once SEAL is initialized, SEAL's config names the collection (pin). Before step 0, config.js has `collection: null`, launch file has it OPEN, no browser memory on a fresh browser, no session. So on a reload in a fresh browser after step 0 but before SEAL, the chain scan runs: `collectionsOfMint` lists all collections with update authority = MINT's PDA. The real one (created by launch key) is adopted; decoys (created by strangers) are ignored. Two launch-key-created = STOP. That's the repair. Looks sound.

One question: `resolveCollection` with a pin ignores `discovered` without calling `creatorOf` — good (no check needed when pinned). The `noCheck` in tests asserts that.

What about the case where the launch key created the collection but the transaction is beyond 5,000 history? `unverifiable` → ignored with reason → if no pin and no other launch-created candidate, step 0 is offered again → Gary could create a SECOND collection. Then two launch-key-created collections exist → next reload STOPs. Hmm, but the page says "if the launch key did create it, write it in web/src/config.js and rebuild". And the browser memory (`remember` before signing) covers the same-browser reload. A different browser with a padded history (>5,000 transactions naming the collection — someone would have to spam 5,000 transactions naming that specific address, at ~0.000005 SOL each ≈ 0.025 SOL) → step 0 offered again → second collection created → STOP on next load (both created by launch key). The cost to an attacker is real but small; the outcome is a STOP (safe), not a wrong adoption. Acceptable; and it's documented ("a history padded past 5,000 transactions is ignored with that reason").

Actually wait — can an attacker pad the history of an address that doesn't exist yet? The collection address doesn't exist before step 0. After step 0, the attacker can spam transactions naming it. 5,000 transactions × 5,000 lamports = 0.025 SOL. Then a reload in a fresh browser: `collectionCreator` returns unverifiable → ignored → `ours` empty → step 0 offered → Gary creates collection #2 → next reload: two launch-created → STOP. So the attacker can force a STOP (DoS on the ceremony) for 0.025 SOL, but only in the no-pin case (fresh browser, before SEAL). Once SEAL exists or config.js is written, pins make it immune. The window is small (between step 0 and SEAL initialize, same session). And the STOP is safe (fails closed). This is a residual DoS, much weaker than V2's permanent stop. Is it worth reporting? The repair's own text acknowledges the padded-history case ("ignored with that reason"). The remaining risk: Gary, in a fresh browser, with a padded history, creates a second collection; the ceremony then STOPs (safe) and needs config.js written by hand. That's a minor operational edge, arguably within the repair's stated bounds. I'll note it as INFO at most, or fold it into the verification of V2 as "repair holds; residual: a 0.025 SOL spam can force a safe STOP in the no-pin window, which the repair's text already names". Actually the repair text says "a history padded past 5,000 transactions is ignored with that reason" — it names the padding but the consequence (second collection → STOP) is the safe direction. I'll mention it briefly.

**V3 (INFO):** vault page said a frozen cbBTC account "cannot activate" but MINT's `activate` ignores state. Repair: `planActivate` now builds the request for a frozen account with a note. Check `plan-vault.mjs`: `const frozen = !!vaultToken && vaultToken.state === 2`, `frozenNote` set; for `record.pending` → join with note; for first call: `if (!vaultToken || (vaultToken.state !== 1 && !frozen))` refuse "does not hold any cbBTC yet" — wait, if vaultToken exists with state 2 (frozen) and balance ≥ 21,000, `frozen` is true, so `vaultToken.state !== 1 && !frozen` = `true && false` = false → doesn't refuse → proceeds to balance check → `bal < ACTIVATION_SATS` → if ≥, returns ok with step 'request' and note. Good. And MINT's `activate` reads `read_token` which returns (amount, state) and activate uses `let (amount, _) = read_token(...)` — ignores state. Confirmed in the source: `let (amount, _) = read_token(&ctx.accounts.vault_token, &payment_mint, &signer)?;` Yes. So the repair matches the program. The test arm V3 pins it.

Now the off-chain repairs (C01-C05, C07) — these are in bank/ which is NOT in this bundle (the bundle has no bank/crank.mjs, bank/detectors.mjs, bank/revenue.mjs, bank/alarm.mjs, bank/lock.mjs, bank/accrual.mjs, bank/layout.mjs, bank/selftest.mjs, bank/redemption-poster.mjs). Wait — the prompt says "THIS PASS ALSO CARRIES web/" and the bundle includes web/ files plus programs, tests, sim, scripts, launch, SPEC, DESIGN, HOLDER-GUIDE. The bank/ files are NOT in this bundle except via imports (bank/layout.mjs, bank/detectors.mjs, bank/txread.mjs, bank/sigwalk.mjs are bundled). So C01-C05, C07 (crank, alarm, cron, revenue --audit) are off-chain pass items whose files I mostly can't see. The round 37 off-chain verdict is referenced but not bundled in full (only VALIDATION.md summarizes). I should note that I can only verify what's in the bundle: C03 (judgeCronTemplate ignores commented lines) is in scripts/cron-install.sh — not bundled. C04 (--audit) — bank/revenue.mjs not bundled. So I can't independently verify those; I'll say so honestly. The VALIDATION.md claims canonical run green (895/895 etc.) and web e2e 108/108.

Actually wait — the prompt says "ROUND 37 READ THIS TREE BEFORE YOU, AND ITS VERDICT IS YOUR FIRST TARGET. Both of its verdicts are bundled in full." But I only see VERDICT-programs.md and VALIDATION.md bundled. The off-chain verdict (VERDICT-offchain.md) is NOT bundled — only summarized in VALIDATION.md. So for the off-chain repairs I have only the summary. I'll verify what I can (the web/ repairs V1-V3 are fully verifiable from the bundle; C05 is a SPEC text change I can check).

C05: SPEC limit 10's ceiling corrected from ~40 to ~34 SOL/day. Check SPEC.md limit 10: "royalty SOL beyond about 34 SOL a day (round 37 C05: the hourly job reads the chain clock a few seconds before the sweep lands and MINT stamps last_sweep_at, so the run six hours later finds the cooldown a few seconds short and the next one, seven hours on, sweeps: 24/7 x 10 SOL, not 24/6 x 10)". Yes, the text is there. The reasoning: hourly cron at :41, cooldown 6h from last_sweep_at (chain time when the sweep landed, a few seconds after the run started). Run at hour H:41 reads clock; if cooldown not quite elapsed (by a few seconds), skips; next run H+1:41 sweeps. So effective cadence 7h → 24/7 × 10 ≈ 34.3 SOL/day. Correct arithmetic.

Now the main event: independently audit the whole tree. Let me go through the programs carefully.

═══ SEAL ═══

`initialize`: authority check first (INIT_AUTHORITY), reserve_mints ≤ 3, non-empty, each passed in remaining_accounts and owned by SPL_TOKEN_ID. Note: it checks owner only, not that the account is actually a mint (82 bytes, initialized). SPEC item 38/round 24 A6 acknowledges: "SEAL reads only owners". The launch checker pins the ruled three. Accepted as documented.

`open_for_redemption`: reads asset (Core AssetV1, owner, collection), requires asset_owner == owner (signer), collection == config.collection, collection account matches. Then walks instructions sysvar from current+1 forward, looking for BURN_PROGRAM_ID with burn_vault discriminator, account 0 == asset, account 2 == owner. Then set_frozen(false) via Core UpdatePluginV1 with seal PDA signing.

Attack surface:
- The walk uses `load_instruction_at_checked(i, &sysvar)` in a while loop with `i += 1`; when it errors (past the end), loop ends. Fail-closed: `found` stays false. Good.
- CPI wrapper: if open is called via CPI, `load_current_index_checked` returns the OUTER instruction's index (top-level), so the walk looks at top-level instructions after the outer one. A wrapper would need a genuine top-level burn for this asset+owner later. And BURN independently requires a genuine top-level open before it. Both bind asset AND owner. WR.2/WR.3 measured. Good.
- Two vaults in one transaction: open A ... burn A ... open B ... burn B. Each open finds its own burn (asset+owner bound). Cross-pairing: open A, open B, burn B, burn A — open A's walk finds burn A (later in tx), open B's walk finds burn B. Burn A's backward walk finds open A. Burn B finds open B. So [open A, open B, burn B, burn A] works: each burn finds its open earlier, each open finds its burn later. That's fine — both vaults get burned. No thawed vault survives: if burn A is missing, open A reverts (NoTerminalBurn) → whole tx fails. Atomicity does the rest.
- What if the same vault is opened twice? [open A, open A, burn A]: first open finds burn A later → thaws. Second open: asset already thawed — does Core's UpdatePluginV1 fail on re-thaw? Setting frozen=false when already false... Core's update plugin for PermanentFreezeExecute: thawing an already-thawed asset. Probably succeeds (idempotent set). Doesn't matter: burn A still required and present. After burn A, asset is tombstoned. No issue.
- What about [open A, burn A, open A]? Second open A: asset is now burned (1-byte tombstone). read_core_asset requires data.len() >= 66 → fails NotACoreAsset. Reverts. Fine.
- Rate limit interaction: BURN's rate limit check happens inside burn_vault. If burn B is rate-limited, the whole transaction reverts, including burn A and both opens. So a two-redemption transaction is all-or-nothing (4.9, 4.10a measured: second is RateLimited, whole tx fails). Hmm — that means batching two redemptions in one tx is fragile: if the second is rate-limited, the first's burn reverts too. That's fine for safety (no partial state), just UX. Not a finding.

SEAL looks clean. The `read_core_asset` requires data[33] == UA_DISC_COLLECTION (2) and reads collection from [34..66]. Good.

One thing: `open_for_redemption` doesn't check the asset is currently FROZEN. If somehow a vault is not frozen (e.g., never sealed — but create_vault always installs frozen:true), open would "thaw" an already-thawed asset. Not exploitable: only the owner can call it, and it still requires the terminal burn. Fine.

═══ BURN ═══

`initialize`: authority, SEAL config check (address, owner, disc, version, collection match), redeem_window_secs in [10, 86400]. Config written once.

`burn_vault`:
1. Asset checks: owner == MPL_CORE_ID, AssetV1, collection, asset_owner == owner signer, collection account matches.
2. Backward walk for SEAL's open_for_redemption (asset idx 0, owner idx 2).
3. Rate limit: reads MINT config (minted_total, bare_burns_retired), live = minted - burned_total - bare_retired. cap = ceil(live × 210 / 10000), min 1, bounded by RATE_RING=64. kth most recent must be ≥ window old. Then records now at rate_ring[head], head advances.

Let me check the ring logic carefully. `head = c.rate_head as usize % RATE_RING`. `kth = c.rate_ring[(head + RATE_RING - k) % RATE_RING]`. The k-th most recent: head points to where the NEXT write goes, so the most recent write is at (head - 1) % 64, the k-th most recent at (head - k) % 64 = (head + 64 - k) % 64. Correct.

Initial state: rate_ring = [0; 64], head = 0. First redemption: k = min(cap, 64). kth = ring[(0 + 64 - k) % 64] = ring[64-k] = 0. now - 0 >= window → allowed (now is way past 0). Writes ring[0] = now, head = 1. After 64 redemptions, head wraps to 0. The 65th: kth = ring[(0 + 64 - k) % 64]. If cap=45, k=45: ring[19] — which holds the time of the redemption written 45 ago? Let's see: writes go to slots 0,1,2,...,63,0,1,... The 65th write (head=0): the most recent 64 writes are in slots 1..63 (writes 2..64) and slot 0 (write 65 is about to overwrite). Hmm wait, before the 65th write, head=0, and slots hold: slot 0 = write 1's time, slots 1..63 = writes 2..64. The most recent is write 64 at slot 63. The k-th most recent (k=45) is write 20, at slot 19. (head + 64 - k) % 64 = (0 + 64 - 45) = 19. Correct.

The invariant: a redemption is allowed iff the cap-th most recent is ≥ window old. So in any window of `window` seconds ending now, at most cap redemptions. Standard rolling window. RL.2/RL.3/RL.4/RL.7 measured. 

Edge: `now.checked_sub(kth)` — kth could be > now if... timestamps are chain time, monotonic-ish (Clock can go backwards slightly? Solana's Clock unix_timestamp is stake-weighted median, can it decrease? It's designed to be non-decreasing in practice but not guaranteed. If kth > now, checked_sub fails → Overflow error → redemption refused. Fail-closed. Fine.

Cap when live = 0: cap = max(1, ...) = 1. But if live = 0 there are no vaults to redeem, so moot. When live is small (e.g., 10), cap = ceil(2.1/10) = 1. Fine.

`live` computation: minted_total (MINT) - burned_total (BURN config) - bare_retired (MINT). burned_total is incremented AFTER the rate check (at the end of burn_vault). So during the check, burned_total counts previous burns. Correct.

4. Reserve list from SEAL config (re-read each burn). n in 1..=3.
5. `asset_signer.lamports() == 0` required.
6. `remaining_accounts.len() == declared`.
7. For each reserve mint × both token programs: derive ATA, find it in remaining_accounts (ReserveNotDeclared if absent). If the account's owner is neither token program → `continue` (skipped: e.g., the account doesn't exist → owner is System; or it's a system account). If it exists as a token account: owner must be pda (ReserveNotOurs), no delegate (d[72..76]==0), no delegated amount (d[121..129]==0), no close authority (d[129..133]==0), length exactly 165 (ReserveHasExtensions), amount == 0 (VaultNotEmpty).

Wait — the delegate check: d[72..76] is the COption tag for delegate (4 bytes). d[76..108] is the delegate pubkey. The check only looks at the tag. If tag is Some (1), refused. Good. d[121..129] delegated_amount must be 0. d[129..133] close_authority tag. Good.

Hmm, one subtlety: for a classic 165-byte account, d[129..133] is the close_authority COption tag. Correct offsets: mint 0-32, owner 32-64, amount 64-72, delegate option 72-76, delegate 76-108, state 108, is_native 109-113, is_native value 113-121, delegated_amount 121-129, close_authority option 129-133, close_authority 133-165. Yes.

8. Second loop over ALL remaining accounts: if owner == MPL_CORE_ID: data must be empty or data[0] != AssetV1 (else VaultStillHoldsAVault — a declared live Core asset refuses). If lamports == 0 → skip. If owner not token programs → skip. If len >= 165 and owner field == pda: must be exactly 165 (no extensions), no delegate/close, amount == 0.

Wait — the second loop: `if acc.lamports() == 0 { continue; }` — a closed account (lamports 0) skipped. Then token-program-owned accounts with len >= 165 owned by the pda must be empty etc. Note the reserve loop already checked the reserve ATAs; this loop catches NON-reserve declared accounts owned by the pda. But undeclared accounts are never seen (the completeness gap, accepted limit 44).

Hmm, one thing: in the second loop, an account with lamports == 0 is skipped BEFORE the Core check? No — the Core check comes first: `if acc.owner == &MPL_CORE_ID { ...; continue; }`. So a Core account is checked regardless of lamports. Good (a nested vault's account holds lamports anyway).

9. Core BurnV1 CPI (owner signs).
10. MINT retire_redeemed CPI: accounts [mint_config (w), vault_record (w), asset (r), instructions (r), pool_token (r)]. Data: IX_RETIRE_REDEEMED_DISC.
11. burned_total += 1. Log CBOB_REDEEMED.

The retire CPI: MINT's retire_redeemed checks stack height == TRANSACTION_LEVEL_STACK_HEIGHT + 1 (i.e., called directly from a top-level instruction — BURN's burn_vault running at top level invokes MINT, so MINT sees stack height 2 = TRANSACTION_LEVEL_STACK_HEIGHT(1) + 1). Then reads the current instruction (the top-level burn_vault) from the instructions sysvar and checks program_id == BURN, disc == burn_vault, account 0 == asset. 

Wait — `load_current_index_checked(&sysvar)` inside MINT's retire_redeemed: when MINT is invoked via CPI from BURN, the instructions sysvar's current index is the index of the TOP-LEVEL instruction (burn_vault), because the sysvar tracks the top-level instruction being processed. Yes — the instructions sysvar is about top-level instructions; the current index is the outer instruction. So MINT reads the outer instruction = burn_vault, checks its program id and discriminator and account 0. Good. And stack height: BURN calls MINT via `invoke` (not signed — MINT's config PDA signs by seeds inside). get_stack_height() inside MINT = 2 (top-level BURN → MINT). TRANSACTION_LEVEL_STACK_HEIGHT = 1. So require 2. A direct call to retire_redeemed at top level: stack height 1 → refused NotFromBurn. A wrapper → retire: wrapper(top) → retire: stack height 2 but the top-level instruction is the wrapper, not burn_vault → NotFromBurn. WR.1 measured. BURN → wrapper → retire: stack height 3 → refused. Good.

But hold on: BURN's burn_vault invokes MINT's retire_redeemed with `invoke` (not invoke_signed). MINT's RetireRedeemed accounts: config (mut, seeds), vault_record (mut, seeds), asset, instructions (address-pinned), pool_token. No signer needed (MINT's config signs the pool transfer internally via invoke_signed with CONFIG_SEED... wait, retire_redeemed doesn't transfer; it calls monthly_inline which may credit (no transfer, just accumulator) — credit() only updates acc_scaled/owed_scaled, no token movement. The pool_token account is only READ in monthly_inline (balance check). So no signing needed. Right.

Now — the pairing between SEAL's open and BURN's burn and MINT's retire: SEAL requires burn later (asset+owner); BURN requires open earlier (asset+owner); MINT requires its caller is burn_vault for this asset. All three bound. 

What about the pool_token passed to BURN → MINT? BURN's BurnVault has pool_token unchecked; MINT's retire_redeemed → monthly_inline requires pool.key() == c.pool_ata (WrongPool). So a wrong pool refuses the whole redemption. Hmm — could a griefer... no, the caller builds the transaction; they'd only grief themselves. But wait: could a wrong pool be used to GRIEF someone else's redemption? The redemption is built and signed by the owner; no one else can inject accounts. Fine.

BURN's rate limit: note the rate check happens BEFORE the reserve/emptiness checks and the burn. If the burn later fails (e.g., VaultNotEmpty), the whole instruction reverts, including the rate_ring write. Good (no rate budget spent on failed attempts).

One more: BURN reads MINT config via read_mint_supply — pinned by address (derived ["mint-config"] under MINT), owner, disc, version. Good.

═══ MINT ═══ (the big one)

`initialize`: 
- authority == INIT_AUTHORITY.
- cbob_mint: owner SPL_TOKEN_ID, 82 bytes, initialized, ≠ payment_mint, ≠ GARY_MINT.
- max_boost_weight in 1..=12, max_boost_epochs in 1..=63.
- max_supply > 0. bank_treasury ≠ default. notice_secs in [60, 30d]. Sweep bounds: floor ≥ 0.1 SOL and ≤ max_sweep; cooldown_ceiling ≥ cooldown and ≤ 7d; reserve_ceiling ≥ sol_reserve and ≥ RENT_EXEMPT_0_BYTES and ≤ 10 SOL; max_sweep in [1, 50] SOL; cooldown in [1s, 24h]; sol_reserve == 0 or ≥ RENT_EXEMPT_0_BYTES. swap_operator ≠ default. payment_mint ≠ default. level_caps all > 0, sum ≤ max_supply. charter window: closes > opens, ≤ 90 days, closes > now. pob_root ≠ 0. monthly_secs in [60, 30d]. pob_collection ≠ default.
- Collection: owner Core, CollectionV1, update authority == mint_pda, name/uri parsed, num_minted == 0 (d[o..o+4] == [0,0,0,0]) and length exactly o+8 (no plugin header → clean).

Wait: `require!(d[o..o+4] == [0,0,0,0])` checks num_minted == 0 but NOT current_size (d[o+4..o+8]). Hmm — for a fresh collection, num_minted and current_size are both 0. Could a collection have num_minted == 0 but current_size > 0? current_size increments on mint into the collection and decrements on burn. num_minted only increments. So current_size > 0 with num_minted == 0 is impossible (current_size ≤ num_minted always). Actually if num_minted == 0 then nothing was ever minted into it, so current_size == 0. The check is sufficient. And `d.len() == o+8` ensures no plugin header. Good.

- check_seal_wiring: SEAL config PDA, owner, disc, version 2, collection matches.
- seal_reserves contains payment_mint.
- pool_ata derived (config PDA's ATA for payment mint).
- Config fields written; last_distribute_at = max(now, charter_closes_at).
- Royalties plugin installed on collection: AddCollectionPluginV1, Royalties 1000 bps, one creator (revenue PDA, 100%), RuleSet::None, authority None. Signed by mint_pda (invoke_signed with MINT_SEED).

The royalty CPI accounts: [collection (w), authority (authority = INIT_AUTHORITY, signer, w), mint_pda (r, signer via seeds), system_program, MPL_CORE]. Hmm — the account list for AddCollectionPluginV1: collection, payer, authority, system program, ... The metas here: collection (new, false), authority (new, true) — wait: `AccountMeta::new(ctx.accounts.authority.key(), true)` = writable, signer. `AccountMeta::new_readonly(mint_pda, true)` = readonly, signer. So both the authority (INIT_AUTHORITY, the collection's... no wait, the collection's update authority is mint_pda) and... Let me think about what Core expects for AddCollectionPluginV1: (collection, payer, authority, system_program). Here payer = authority (INIT_AUTHORITY pays), authority = mint_pda (the update authority, signing via PDA seeds). The mpl_core account is also passed (as the "log wrapper" maybe? Core's instructions sometimes take the program itself as a meta for logging). The suite proves this works (R.1-R.4: the collection ends with the royalty, authority None). OK.

`mint_vault`:
- monthly_inline first (pool).
- !sales_stopped. round_id > 0, now in [opens, closes), minted_this_round < cap, price ≤ max_price. check_supply (minted_total < max_supply and < cap_total). check_attributes (≤ MAX_ATTRS-1 = 7, no reserved keys, no dups, ≤128 chars each).
- Payment: payment_mint == cfg.payment_mint, owner SPL_TOKEN, 82 bytes, decimals read. revenue_token == revenue PDA's ATA. TransferChecked of cfg.price from payer_token (payer signs via invoke — the payer is a top-level signer).

Wait — `invoke` (not signed) with payer as authority: the payer signed the top-level transaction, so the SPL TransferChecked with payer as authority works. Good. But note: `payer_token` is only checked by the SPL program (that it's a token account owned by payer for the mint). The mint account passed is checked == cfg.payment_mint. TransferChecked validates the mint matches both accounts. Good.

- check_seal_wiring again, collection == cfg.collection, create_vault (Core CreateV2 with the three plugins: PermanentFreezeExecute frozen authority SEAL PDA; PermanentTransferDelegate authority RESCUE PDA; Attributes authority MINT PDA).
- Record written: mint_index = minted_total, reveal_slot = slot + 16, level 0, etc. minted_this_round++, minted_total++.
- crank(remaining_accounts).

create_vault's CreateV2 data: [IX_CREATE_V2=20, 0], name, uri, data.push(1) — hmm what's this? Let me parse: CreateV2 { name, uri, plugins: Option<Vec<Plugin>>, external_plugin_adapters: Option<Vec<...>> }. After uri: `data.push(1)` = Some for plugins? Then `3u32` = 3 plugins. Then each plugin: type byte, then plugin data, then authority. For PermanentFreezeExecute: `data.push(PLUGIN_PERMANENT_FREEZE_EXECUTE=17); data.push(1) // frozen; data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS=3); seal_pda` — the `1` before authority is Some(...). For PermanentTransferDelegate: type 7, no data (unit struct), then Some + Address + rescue_pda. For Attributes: type 6, attr count + pairs, then Some + Address + mint_authority. Then `data.push(1); data.extend(0u32)` = Some([]) for external adapters (empty vec). The suite proves the encoding matches the SDK (R.7 family, and the whole suite mints real vaults through this path). OK.

`claim_charter_vault`:
- pob_extra ≤ 8 and ≤ remaining len; split into extra and crank accounts.
- monthly_inline.
- Window: now ≥ opens, < closes. check_supply. check_attributes (≤ MAX_ATTRS-2 = 6).
- PoB: owner Core, AssetV1, owner == signer, update authority == Collection (d[33]==2), collection == cfg.pob_collection. pob_collection account == cfg.pob_collection. proof ≤ 16, merkle_root_from(leaf(pob), proof) == pob_root.
- Burn the PoB via Core BurnV1: metas [pob (w), pob_collection (w), payer (w, signer), owner (r, signer), MPL_CORE (r), MPL_CORE (r)] + extra (never signers). invoke (owner signs top-level).

Hmm, the BurnV1 metas: [asset, collection, payer, authority, ...]. The authority here is the owner (signer). Two MPL_CORE entries (one is probably the log wrapper). The extra accounts passed through for external plugins (Oracle). Never signers. Good.

- Then full = attributes + charter attr (the PoB address). create_vault. Record with charter=true. minted_total++, charter_claimed++. crank.

Note: the PoB burn happens BEFORE create_vault. If create_vault fails, the whole instruction reverts (the PoB burn reverts too). Atomic. Good.

The Merkle: leaf = sha256(0x00 || pubkey); node = sha256(0x01 || min || max). Domain-separated, sorted pairs. MAX_POB_PROOF=16 (240 leaves → depth 8). The JS pob-merkle.mjs matches (selftest, and the suite's claims use it against the real program). Good.

`capture_entropy`: record level==0 && !entropy_set; try_capture; Got → store. NotYet → RevealTooEarly; Expired → RevealWindowExpired.

`reschedule_reveal`: level==0 && !entropy_set; now > reveal_slot + 300; reschedule to now + 16.

`reveal_level`: 
- record reads; level == 0 (AlreadyRevealed); index == config.revealed_total (FIFO); asset == record.asset; collection == config.collection.
- Entropy: stored or capture inline (NotYet → RevealTooEarly; Expired → NeedsReschedule).
- remaining = caps - minted per level; total > 0. li = u64le(entropy[0..8]) % total walked across levels. level_minted[li]++, revealed_total++, record.level = li+1.
- If not burned: asset must be live Core AssetV1; attributes hash must match stored; UpdatePluginV1 with attributes + level appended, signed by mint_pda.
- If burned (1-byte tombstone): skip the Core write, still count the draw.

The draw: `x = u64 % total; for each level: if x < remaining[i] pick i; else x -= remaining[i]`. Correct without-replacement draw from remaining census.

Entropy: sha256(hA || hB || hC || asset). A = first produced slot ≥ reveal_slot (within +64); B = first produced ≥ (A/4 + 2)*4; C = first produced ≥ (B/4 + 2)*4. Three different leader groups (stride 2 groups = 8 slots). The blockhash_in_window parses SlotHashes defensively (pinned sysvar id, count ≤ 512, buffer length, no all-zero hash). Takes the SMALLEST slot in [want, want+64]. 

Hmm — SlotHashes stores slots newest-first. The loop iterates all n entries and picks the smallest slot ≥ want and ≤ want+64. Correct.

One question: `blockhash_in_window` returns the hash of the smallest produced slot in the window. The sysvar holds the most recent 512 slots. If `want` is older than the oldest slot in the buffer, no entry qualifies → None → NotYet (wait) — but the window check in try_capture (now ≤ reveal_slot + 300) means we never look for slots older than ~300+64+~48 slots ago, well within 512. OK.

The FIFO: reveal_level requires index == revealed_total. A vault burned before its draw still takes it (burned detected positively). A vault whose window lapsed must be rescheduled first (NeedsReschedule). The crank rides on hosts (up to 4 records, skips non-records, captures or reschedules).

Attack: can anyone capture WRONG entropy for a vault? try_capture is deterministic given the sysvar: same reveal_slot → same A, B, C → same entropy. No choice. capture_entropy is permissionless but writes the deterministic value. Good.

Can a vault's record be cranked with a fake SlotHashes account? crank requires accts[0].key() == slot_hashes::ID. blockhash_in_window also pins it. Good.

`activate`:
- crank first (remaining accounts).
- monthly_inline.
- If r.pending: second call — asset == record.asset, live vault, dist_epoch > request_epoch → join.
- Else: level 1..5, asset == record.asset, live vault, vault_token == canonical ATA of asset-signer PDA for payment mint, read_token (mint, owner match), amount ≥ 21,000. Then pending=true, request_epoch=dist_epoch, vault_ata recorded, pending_count++, pending_this_epoch++.

Note: activate doesn't check the vault's owner at all — anyone can activate any revealed, funded vault. That's intended (permissionless). The vault_ata is derived, not supplied. Good.

`boost_vault`:
- monthly_inline first.
- Terms: price > 0, extra > 0, epochs > 0 (BoostsOff); price ≤ max_price, extra ≥ min_weight, epochs ≥ min_epochs (BoostTermsMoved).
- Record: active && !retired && !pending; boost_weight == 0; asset matches.
- require_live_vault.
- Asset's current owner (Core bytes 1..33) == burner (BoostNotTheOwner).
- cbob_mint == config.cbob_mint, owner SPL_TOKEN. burner_token: read_token(cbob, burner), state initialized, bal ≥ price.
- SPL Burn of price from burner_token (burner signs top-level).
- end = dist_epoch + epochs; ring[end % 64]++; boosts_active++; boost_weight_total += extra; cbob_burned_total += price; reweigh(c, r, extra); r.boost_end_epoch = end.

reweigh: before = weight_of(r) (level weight + current boost); owed = owed_of(r, acc); r.boost_weight = boost; after = new weight; r.carry_scaled = owed; r.debt_scaled = after × acc; total_active_weight -= before, += after. So the vault's owed share is preserved in carry, debt restarts at new weight. owed_scaled unchanged. Correct.

Note: boost_vault does NOT check `boosts_due == 0` first. Hmm — the monthly_inline at the top returns early (does nothing) if boosts_due > 0 (logs CBOB_MONTHLY_WAITS_FOR_BOOSTS). So a boost can be bought while another boost is due. Is that a problem? The due boost's vault keeps its boosted weight until expired. A new boost bought now: end = dist_epoch + epochs. The ring and counters handle it. The BoostsExpireFirst gate only blocks distribute (and monthly_inline's credit). Buying a boost doesn't distribute. So no issue — the due boost expires at exactly the accumulator its last distribution left, whenever someone expires it. Fine.

`expire_boosts`: remaining accounts = records (≤ 30, each writable, load_record checked: owner == MINT, deserializes, version 4). For each: skip if retired || !active || boost_weight == 0 || dist_epoch < boost_end_epoch. Else expire_boost (unschedule + reweigh to 0 + boost_end_epoch = 0). 

expire_boost: requires boost_weight > 0 && dist_epoch >= boost_end_epoch (BoostNotDue) — but expire_boosts skips non-due records before calling, so no revert. unschedule_boost: if due (dist_epoch >= end): boosts_due--; else ring[end % 64]--. boosts_active--; boost_weight_total -= weight. Then reweigh(c, r, 0): carry = owed, debt = base weight × acc, boost_weight = 0.

Wait — in expire_boost, `unschedule_boost(c, r)?` is called BEFORE `reweigh(c, r, 0)`. unschedule reads r.boost_end_epoch and r.boost_weight (still set). Then reweigh sets boost_weight = 0 and adjusts. Then r.boost_end_epoch = 0. Order is correct.

The ring wrap: end = dist_epoch + epochs, epochs ≤ 63. Two live boosts never share a ring slot... wait, the comment says "a boost may last at most BOOST_RING - 1 distributions, so two live end epochs never share a slot". Hmm, that's not quite it: two boosts CAN share a ring slot (the ring holds COUNTS, not single boosts). boost_expiring[i] is a count. The point is: a boost ending at epoch e is counted in slot e % 64. When advance_epoch moves dist_epoch to e, it adds boost_expiring[e % 64] to boosts_due and zeroes the slot. Could a slot hold counts from two different epochs 64 apart? A boost bought at epoch x with end e = x + n (n ≤ 63) sits in slot e % 64. The slot is cleared when dist_epoch reaches e (advance_epoch adds it to due). For the slot to be double-counted, a boost with end e and another with end e + 64 would both map to slot e % 64. But end e + 64 requires epochs = 64, which is > 63 (MAX_BOOST_EPOCHS_BOUND). So no two live boosts share a slot across a wrap. Within the same epoch, multiple boosts share a slot as a count — correct. The host test `the_boost_ring_wraps_exactly_against_a_model` and `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` (260 epochs, 4 wraps) prove it. Good.

But wait — there's a subtlety in advance_epoch: it adds boost_expiring[i] to boosts_due where i = dist_epoch % 64 AFTER incrementing. So when dist_epoch becomes e, slot e % 64 is drained into due. A boost with end_epoch = e becomes due exactly when dist_epoch reaches e. And distribute refuses while boosts_due > 0 (BoostsExpireFirst). So no distribution runs past a due boost. The boost earns distributions while dist_epoch < end... let me recount. A boost bought at epoch E (dist_epoch = E at purchase) with epochs = N: end = E + N. It earns distributions while its weight is boosted. Distributions advance dist_epoch. After the distribution that moves dist_epoch from E+N-1 to E+N, the boost is due (dist_epoch >= end). So it earned the distributions at epochs E+1, ..., E+N — that's N distributions. Wait: bought at epoch E (before any distribution at E+1...). Hmm, dist_epoch increments once per distribution (credit → advance_epoch; tick → advance_epoch). A boost bought when dist_epoch = E: the next distribution moves to E+1, and the boost's weight counts in it (it was added to total_active_weight at purchase). It earns distributions E+1 through E+N inclusive = N distributions. At dist_epoch = E+N, the boost is due (end = E+N, dist_epoch >= end). The NEXT distribution (to E+N+1) is refused until expired. So exactly N distributions. BO.21/BO.35 measure the one-transaction orderings. Good.

`distribute`:
- pool_token == config.pool_ata. read_token(pool, payment_mint, pool_owner=config PDA). 

Wait — read_token(pool_token, &config.payment_mint, &pool_owner) where pool_owner = ctx.accounts.config.key(). The pool is the config PDA's ATA, so owner field == config PDA. Good.

- boosts_due == 0 (BoostsExpireFirst) BEFORE any burn.
- w = total_active_weight. If w == 0: waiting_to_join must be 0 (JoinWaitingFirst); !burn && pending_this_epoch > 0 (NoActiveVaults); no remaining accounts; month elapsed → tick (advance epoch, no credit).
- Else: owed = ceil_sats(owed_scaled); avail = balance - owed (PoolShort if under); avail > 0 (NothingToDistribute).
- burn path: 4 remaining accounts [burner (signer), from, gmint, tprog]; tprog == SPL_TOKEN; gmint == GARY_MINT, owner SPL_TOKEN; from: read_token(GARY, burner), initialized, ≥ 100 GARY. waiting_to_join == 0 BEFORE the burn. Then SPL Burn 100 GARY.
- free path: no remaining accounts; month elapsed; waiting_to_join == 0.
- credit(c, avail, w, now): acc += avail × ACC_SCALE / w; owed_scaled += delta × w; last_distribute_at = now; advance_epoch.

Note: delta × w ≤ avail × ACC_SCALE (since delta = floor(avail × SCALE / w)). So owed_scaled increases by ≤ avail × SCALE, i.e., ≤ avail sats. The pool holds balance ≥ owed + avail before; after, owed' = owed + delta×w/SCALE ≤ owed + avail. So pool ≥ ceil(owed') still holds. The dust (avail - delta×w/SCALE) stays undistributed. Good.

waiting_to_join = pending_count - pending_this_epoch: vaults that requested in an EARLIER epoch (eligible to join now). The gate: no distribution while any eligible vault waits. 

Hmm — one edge: a vault requests activation in epoch E (pending_this_epoch counts it). advance_epoch sets pending_this_epoch = 0. So after one distribution/tick, the vault is eligible (its request_epoch E < dist_epoch E+1). The gate then blocks distributions until it's joined. join() requires dist_epoch > request_epoch. Consistent.

But: what if a vault requests activation, and then its owner bare-burns it before it joins? retire_burned → retire(c, r, false, false): r.pending → pending_count--, and if request_epoch == dist_epoch, pending_this_epoch--. Good (F21.1/F21.2 measured).

What if a pending vault is REDEEMED (retire_redeemed)? Same retire path with redeemed=true. The pending branch runs regardless of redeemed. Good.

`claim`:
- Parse crank prefix (crank_n + 1 accounts: SlotHashes + records). crank them.
- pairs = rest; non-empty, even count.
- pool_token == config.pool_ata.
- monthly_inline BEFORE paying.
- For each pair (record, dest):
  - record writable; load_record.
  - If pending: dest must == r.vault_ata; if dist_epoch > request_epoch → join (store, n_joined++). Continue (nothing owed).
  - If !active → skip (continue). Note: dest is NOT checked for inactive records — fine, nothing happens.
  - dest == r.vault_ata (WrongVaultAccount).
  - If boost due (boost_weight > 0 && dist_epoch >= boost_end_epoch): expire_boost first (touched=true).
  - pending = owed_of(r, acc); pay = pending / ACC_SCALE (floor). If 0: store if touched; continue.
  - dest must be SPL-owned, lamports > 0, len 165. If frozen: log CBOB_CLAIM_DEFERRED_FROZEN, emit, n_deferred++, store if touched, continue (stays owed). If state != initialized → VaultAccountMissing.
  - SPL Transfer of pay from pool (config PDA signs via CONFIG_SEED) to dest.
  - carry = pending - pay×SCALE (sub-sat remainder); debt = weight × acc; store. owed_paid += pay×SCALE; paid += pay; n_paid++.
- owed_scaled -= owed_paid.

Invariant check: pool holds ≥ ceil(owed). Each claim moves pay sats out and reduces owed by pay×SCALE exactly. The sub-sat remainder stays in carry (still owed). So pool balance and owed decrease together. Good.

Frozen pool: the Transfer reverts the whole claim (Token program refuses a transfer from a frozen account). Round 24 D4: a claim that pays reverts whole. Documented. A claim that pays nothing (joins only) goes through. OK.

Hmm — one subtle thing: `claim` with a frozen pool and a vault owed 0 but with a due boost: expires the boost (touched, stored), no transfer. So expiry works during a pool freeze. Good (that's how the gate gets cleared).

But wait — monthly_inline at the top of claim: if the pool is frozen, monthly_inline returns early (frozen pool → no credit). Good.

`retire_redeemed` (CPI from BURN only):
- stack height 2; current instruction is burn_vault for this asset.
- asset == record.asset; is_burned(asset) (Core-owned, 1 byte, key 0).
- forfeit = pool_is_frozen(pool_token, config) — pool == config.pool_ata pinned; frozen if SPL-owned, 165 bytes, state frozen.
- retire(config, record, redeemed=true, forfeit): if active: w = weight; full = w × acc; pending = owed_of(r, acc); if redeemed && !forfeit: require pending < ACC_SCALE (ClaimBeforeBurn — a whole sat still owed refuses). If forfeit && pending ≥ ACC_SCALE: log CBOB_REDEEMED_POOL_FROZEN. owed_scaled -= pending; total_active_weight -= w; active_count--; unschedule boost if any; debt = full; carry = 0; active = false; returned = pending.
- pending branch: pending_count--, pending_this_epoch-- if same epoch.
- retired = true. If !redeemed: bare_burns_retired++.
- Then monthly_inline (after the retire, so the leaving vault isn't credited).

Wait — the owed_scaled -= pending: for a redeemed vault, pending < ACC_SCALE (sub-sat dust) or forfeited. The pending share is removed from owed (it stays in the pool — "returned to the pool" means it's no longer owed, so it becomes undistributed pool balance). Correct: the pool's balance didn't change (no transfer), and owed decreased by pending, so avail increased. The share returns to the pool for future distributions. Good.

Hmm, one question on `retire` for a redeemed vault with a boost: unschedule_boost is called inside `if r.active`. If the boost is due (dist_epoch >= end): boosts_due--. Else ring[end%64]--. boosts_active--, boost_weight_total -= weight. Then debt = full (w × acc where w includes boost), carry = 0. The vault leaves with its boosted weight removed from total_active_weight (via `total_active_weight -= w` where w = weight_of(r) includes boost). Correct.

But note: retire does NOT call reweigh; it directly manipulates. owed_scaled -= pending where pending = owed_of (includes carry). The vault's owed share is exactly removed. Good.

`retire_burned`: asset == record.asset; is_burned; retire(c, r, false, false). Permissionless. For a bare-burned ACTIVE vault: its pending share returns to the pool (owed -= pending), weight removed. For a pending one: counters fixed. Good.

`rescue_nested` (round 35):
- vault must be a live vault of config.collection (require_live_vault).
- owner = vault's owner (Core bytes 1..33).
- host = host account key; signer_pda = Core's ["mpl-core-execute", host] PDA; require owner == signer_pda (NotNested) — the vault's owner IS the host's asset-signer PDA.
- orphan = (host == vault) || is_burned(host). If !orphan: require_live_vault(host, collection) must succeed (HostUnresolved) — host is a live vault of our collection.
- dest = config.bank_treasury; new_owner == dest (WrongRescueDestination).
- Core TransferV1 of the vault to dest, signed by rescue_authority PDA (RESCUE_SEED).

The TransferV1 metas: [vault (w), collection (r), payer (w, signer), rescue_authority (r, signer-via-seeds), dest (r), system_program (r), MPL_CORE (r)]. The PermanentTransferDelegate authority is the rescue PDA; Core checks the delegate authority signed. Since every vault is born with this plugin (authority = rescue PDA), and only rescue_nested signs with that seed, the only transfer it can make is to bank_treasury. 

Checks: the vault must be LIVE (not burned), in our collection, and nested (owner == host's signer PDA) where host is itself/burned/a live CBOB vault. A vault nested in a FOREIGN live asset: require_live_vault(host) fails → HostUnresolved. Good (the foreign asset's owner can execute its own wallet).

Can rescue_nested be abused to steal a vault? The vault goes only to bank_treasury (the Squads). The Squads returns it by hand. No value moves except the NFT itself, to the Squads. The vault's contents stay in its own wallet (the asset-signer PDA of the VAULT, not the host). Right — the vault's contents are in ["mpl-core-execute", vault], which transfers with the vault. So the rescued vault keeps everything. Good.

Can anyone rescue a NON-nested vault? owner == signer_pda of host required. For a normally-held vault, owner is a wallet, not any asset's signer PDA. NotNested. Good.

What about a vault whose owner is the signer PDA of an asset that doesn't exist yet? host = that asset's address; is_burned(host) → host doesn't exist → try_borrow_data on a non-existent account... In Solana, a non-existent account passed as AccountInfo has lamports 0, data empty, owner System. is_burned: owner == MPL_CORE_ID fails → false. orphan = false (host != vault, not burned). Then require_live_vault(host): owner != MPL_CORE → NotALiveVault → the `.is_ok()` check fails → HostUnresolved. Good (a host that never existed is refused — its keypair holder can still create it).

`sweep_sol_for_swap`:
- !sweep_stopped; amount > 0; swap_operator == config.swap_operator (signer); amount ≤ max_sweep; now ≥ last_sweep_at + cooldown; revenue == derived PDA; bal ≥ sol_reserve + amount; System transfer revenue → operator (revenue PDA signs via REVENUE_SEED); last_sweep_at = now.

The operator signs; destination is the operator (pinned by config). Cap + cooldown + reserve. Guardian can stop. Good.

`split_revenue`:
- revenue == derived; mint == config.payment_mint; revenue_ata == revenue's ATA; holders_ata == config.pool_ata; bank_ata == bank_treasury's ATA.
- total = revenue_ata's balance (read raw, d[64..72], len ≥ 72). total > 0.
- bank_cut = total × (10000 - 8500) / 10000 (floor); holders = total - bank_cut.
- TransferChecked holders → pool, bank_cut → bank_ata (revenue PDA signs). decimals passed by caller — TransferChecked checks decimals against the mint. If wrong decimals passed, the CPI fails. Fine.
- If amount == 0, skip that transfer (bank_cut can be 0 for tiny totals).

Note: `read_token` isn't used here; the raw read of revenue_ata doesn't check its mint/owner — but the address is derived as the revenue PDA's ATA for the payment mint, and TransferChecked validates mint/decimals. The destination ATAs are derived/pinned. Good.

Governed instructions (GOV PDA signs): set_round (price ≥ 21,000, cap > 0, window ≤ 1yr), restart (StopIsNewer), tighten_sweep (monotone, bounded), set_boost_terms (bounds), arm_swap_operator, arm_guardian. Guardian: emergency_stop_sales, emergency_stop_sweep, cancel_swap_operator. Permissionless: apply_swap_operator, apply_guardian (after notice).

restart: `c.sales_stopped_at < proposal_created_at` required (strictly older). The stop time is stamped on transition only (re-stop doesn't move it). Good.

tighten_sweep: reserve up only (max), cap down only (min), cooldown up only (max), each within init bounds. Good.

arm/apply: pending key + timestamp; apply after notice_secs; anyone can apply. cancel_swap_operator: guardian only, clears pending operator. No cancel for pending guardian (the guardian can't cancel its own replacement). Good.

Now the monthly_inline placement: mint_vault (top), claim_charter_vault (top), activate (after crank, before activation), boost_vault (top), claim (after crank, before paying), retire_redeemed (after retire). 

monthly_inline: pool == pool_ata pinned; due = now ≥ last_distribute_at + monthly_secs; if !due return. If boosts_due > 0: log, return. If waiting_to_join > 0: log, return. If total_active_weight == 0: if pending_this_epoch > 0 → tick; return. If pool not SPL-owned → return. Read balance: if len != 165 or mint/owner mismatch → return; if frozen → return. avail = balance - ceil(owed); if 0 → return. credit(c, avail, w, now).

Hmm — monthly_inline with w == 0 and pending_this_epoch > 0 ticks (advances epoch so waiting vaults can join). But note the gate order: boosts_due check BEFORE the w==0 tick. So a due boost blocks the launch tick too. Is that right? At launch, no boosts exist (boosts need activated vaults). So moot in practice. But consider: all vaults redeemed except some pending ones, and a boost is due... a due boost requires an active vault, which requires w > 0. If w == 0, no active vaults, so no live boosts (retire unschedules them). boosts_due could be > 0 only if... a boosted vault was retired: retire → unschedule_boost → if due, boosts_due--. So a retired due boost leaves boosts_due. Can boosts_due be > 0 with w == 0? boosts_due > 0 means some active boosted vault's last distribution ran. If that vault is then retired, unschedule decrements boosts_due. So boosts_due == 0 whenever w == 0... unless there's a path that retires an active vault without unscheduling. retire() unschedules inside `if r.active`. So no. OK, consistent.

Actually wait, one more: `expire_boosts` requires records to be writable and load_record to pass (owner MINT, version 4). A non-record account → BadVaultRecord → whole call reverts. The caller chooses the accounts, so self-grief only. W3 (round 37) disproved this as a defect. Right.

Now GOV.

═══ GOV ═══

`initialize`: authority; read_mint_config (MINT config pinned, collection match); quorum 500..10000; threshold 5000..7500 exclusive-ish (>5000, ≤7500); min_voting_secs 60..30d. Config written once.

`create_proposal`:
- read_mint_config, read_burn_total; quorum_supply = minted - burned - bare_retired.
- Proposer: read_core_asset(vault_asset) → owner == proposer signer, collection == config.collection.
- now ≥ charter_closes_at (CharterNotClosed).
- dur = voting_ends_at - now; min_voting_secs ≤ dur ≤ MAX_VOTING_SECS (30d).
- actions non-empty, ≤ 5, one per kind; guardian change + operator arm never bundled.
- Per-action checks: SetRound (price ≥ 21k, window valid ≤ 1yr, cap > 0); Brakes (at least one of restart_sales/restart_sweep/set_guardian); TightenSweep (non-empty; strictly tighter than live; within init bounds); ArmSwapOperator (≠ default); SetBoostTerms (price 0 = off; else weight 1..=max_boost_weight, epochs 1..=max_boost_epochs read from MINT config).
- proposal PDA at ["proposal", proposal_count+1]; proposal_count++; fields written including quorum_supply, index_snapshot = minted_total, created_at = now, quorum_bps/threshold_bps snapshotted.

Note: the proposer must own a vault, but the vault's mint index is NOT checked at proposal creation (only at vote). So a brand-new vault can propose. Fine (the proposal's electorate is snapshotted; the proposer's own vault may be too new to vote on it, but that's their problem).

Hmm wait — actually, can a vault minted after the proposal propose it? create_proposal reads the asset's owner but never its mint index. So yes, any live vault's owner can propose. The snapshot protects the vote. OK.

`cast_vote`:
- read_core_asset: owner == owner signer, collection match.
- now < voting_ends_at; !executed.
- read_vault_index: record PDA ["vault", asset] under MINT, owner MINT, disc, version 4, asset field matches. index < proposal.index_snapshot (VaultTooNew).
- yes/no incremented. VoteRecord PDA ["vote", proposal, asset] init (double vote impossible — account exists).

Note: the vote is bound to the asset; a transferred vault can't vote again. A vote can be "rented" (transfer, vote, transfer back in one tx) — accepted limit (Known limits: "A vote is atomically rentable"). Documented.

`execute_proposal`:
- now ≥ voting_ends_at; !executed; now ≤ voting_ends_at + 7 days (ProposalExpired).
- gov_pda derived; read_mint_config; m.governance == gov_pda (NotTheGovernanceAuthority).
- cast = yes + no > 0; need = ceil(quorum_supply × quorum_bps / 10000) > 0; cast ≥ need. yes_bps = yes × 10000 / cast ≥ threshold. need_yes = ceil(supply × 1000/10000) > 0, yes ≥ need_yes (turnout). Key change (guardian or operator): need_key = ceil(supply × 5000/10000), yes ≥ need_key (KeyChangeNeedsHalf).
- Per-kind ordering marks: SetRound (skip if id ≤ last_round_id; else mark, skip if round already over); Brakes (guardian: skip if id ≤ last_guardian_id; else mark + arm_guardian CPI. restarts: skip halves where stop is newer than proposal); TightenSweep (always applied — monotone); ArmSwapOperator (skip if id ≤ last_arm_id; else mark + arm CPI); SetBoostTerms (skip if id ≤ last_boost_id; else mark + CPI).
- p.executed = true; then all CPIs in order, one fails → all revert.

The skips log CBOB_ACTION_SKIPPED. A proposal of all skips still counts as executed. Good.

The CPI: invoke_signed to MINT with accounts [mint_config (w), gov_pda (r, signer-via-seeds)]. MINT's Governed struct: config (mut, seeds, has_one = governance), governance: Signer. The gov PDA signs via GOV's invoke_signed with GOV_SEED. Good.

One check: MINT's Governed has_one = governance reads config.governance == governance signer. Config.governance was set at initialize to the GOV PDA. Good.

Now — the ordering marks: `last_round_id` etc. are set when the action is NOT superseded. For SetRound: `if id <= cfg.last_round_id { skip; continue; } cfg.last_round_id = id; if closes_at <= now { skip; continue; } push call`. So the mark moves even if the round is already over (a newer over-round still supersedes older ones — RT3 finding 4 fixed). Good.

For Brakes guardian: mark moves only when not superseded. Restarts have no mark (they're guarded by stop time). TightenSweep has no mark (monotone). Good.

Potential issue: two proposals with the same kind, the older executed first, then the newer — fine. Newer first, then older skipped. Good.

What about a proposal executed, then an EVEN OLDER proposal with a stale restart? The restart half is skipped if stop_time ≥ created_at. Good.

Now the cross-program reads (R7). Let me recompute offsets.

MintConfig layout (Borsh, after 8-byte disc):
- version: u8 @8
- collection: Pubkey @9..41
- governance: Pubkey @41..73
- pool_ata: Pubkey @73..105
- round_id: u32 @105..109
- opens_at: i64 @109..117
- closes_at: i64 @117..125
- price: u64 @125..133
- cap: u32 @133..137
- minted_this_round: u32 @137..141
- minted_total: u64 @141..149
- max_supply: u64 @149..157
- bank_treasury: Pubkey @157..189
- split_bps: u16 @189..191
- sales_stopped: bool @191
- sweep_stopped: bool @192
- guardian: Pubkey @193..225
- swap_operator: Pubkey @225..257
- sol_reserve_lamports: u64 @257..265
- bump: u8 @265
- max_sweep_lamports: u64 @266..274
- sweep_cooldown_secs: i64 @274..282
- last_sweep_at: i64 @282..290
- level_caps: [u32;5] @290..310
- level_minted: [u32;5] @310..330
- revealed_total: u64 @330..338
- payment_mint: Pubkey @338..370
- pob_collection: Pubkey @370..402
- pob_root: [u8;32] @402..434
- charter_opens_at: i64 @434..442
- charter_closes_at: i64 @442..450
- charter_claimed: u32 @450..454
- bare_burns_retired: u64 @454..462
- total_active_weight: u64 @462..470
- active_count: u64 @470..478
- acc_scaled: u128 @478..494
- owed_scaled: u128 @494..510
- last_distribute_at: i64 @510..518
- sales_stopped_at: i64 @518..526
- sweep_stopped_at: i64 @526..534
- pending_swap_operator: Pubkey @534..566
- pending_swap_operator_at: i64 @566..574
- monthly_secs: i64 @574..582
- pending_guardian: Pubkey @582..614
- pending_guardian_set: bool @614
- pending_guardian_at: i64 @615..623
- notice_secs: i64 @623..631
- sweep_floor_lamports: u64 @631..639
- cooldown_ceiling_secs: i64 @639..647
- reserve_ceiling_lamports: u64 @647..655
- dist_epoch: u64 @655..663
- pending_count: u64 @663..671
- pending_this_epoch: u64 @671..679
- cbob_mint: Pubkey @679..711
- max_boost_weight: u8 @711
- max_boost_epochs: u16 @712..714
- boost_price: u64 @714..722
- boost_weight: u8 @722
- boost_epochs: u16 @723..725
- boosts_active: u32 @725..729
- boosts_due: u32 @729..733
- boost_weight_total: u64 @733..741
- cbob_burned_total: u64 @741..749
- boost_expiring: [u32;64] @749..1005
- padding 256 → total 1261.

GOV reads: version @8, collection @9, governance @41, minted_total @141, bare_retired @454, charter_closes @442, sol_reserve @257, max_sweep @266, cooldown @274, sales_stopped @191, sweep_stopped @192, sales_stopped_at @518, sweep_stopped_at @526, sweep_floor @631, cooldown_ceiling @639, reserve_ceiling @647, max_boost_weight @711, max_boost_epochs @712. All match my computation. ✓

BURN reads: minted_total @141, bare_retired @454. ✓

The suite's own offsets (3prog.test.ts): OFF_GOVERNANCE=41, OFF_ROUND_ID=105, OFF_PRICE=125, OFF_MINTED_TOTAL=141, OFF_SALES_STOPPED=191, OFF_SWEEP_STOPPED=192, OFF_GUARDIAN=193, OFF_SWAP_OPERATOR=225, OFF_SWEEP_COOLDOWN=274, OFF_LEVEL_CAPS=290, OFF_LEVEL_MINTED=310, OFF_REVEALED=330, OFF_CHARTER_CLAIMED=450, OFF_POOL_ATA=73, OFF_BARE_RETIRED=454, OFF_TOTAL_WEIGHT=462, OFF_ACTIVE_COUNT=470, OFF_ACC=478, OFF_OWED=494, OFF_LAST_DIST=510, OFF_SOL_RESERVE=257, OFF_MAX_SWEEP=266, OFF_LAST_SWEEP=282, OFF_CHARTER_CLOSES=442, OFF_SALES_STOPPED_AT=518, OFF_PENDING_OP=534, OFF_PENDING_OP_AT=566, OFF_MONTHLY=574, OFF_PENDING_GUARDIAN=582, OFF_PENDING_GUARDIAN_SET=614, OFF_PENDING_GUARDIAN_AT=615, OFF_NOTICE=623, OFF_SWEEP_FLOOR=631, OFF_COOLDOWN_CEIL=639, OFF_RESERVE_CEIL=647, OFF_DIST_EPOCH=655, OFF_PENDING_COUNT=663, OFF_PENDING_THIS=671, OFF_CBOB_MINT=679, OFF_MAX_BOOST_W=711, OFF_MAX_BOOST_E=712, OFF_BOOST_PRICE=714, OFF_BOOST_W=722, OFF_BOOST_E=723, OFF_BOOSTS_ACTIVE=725, OFF_BOOSTS_DUE=729, OFF_BOOST_W_TOTAL=733, OFF_CBOB_BURNED=741, OFF_BOOST_RING=749. All match. ✓

VaultRecord layout: disc 8; version @8; asset @9..41; mint_index @41..49; reveal_slot @49..57; level @57; charter @58; entropy_set @59; entropy @60..92; attrs_hash @92..124; bump @124; active @125; retired @126; reschedules @127..129; vault_ata @129..161; debt_scaled @161..177; pending @177; request_epoch @178..186; boost_weight @186; boost_end_epoch @187..195; carry_scaled @195..211; padding 10 → 221. 

GOV reads: version @8, asset @9, mint_index @41. ✓ Suite: OFF_REC_PENDING=177, OFF_REC_REQ_EPOCH=178, OFF_REC_BOOST_W=186, OFF_REC_BOOST_END=187, OFF_REC_CARRY=195, OFF_REC_INDEX=41, OFF_REC_REVEAL=49, OFF_REC_LEVEL=57, OFF_REC_CHARTER=58, OFF_REC_SET=59, OFF_REC_ENTROPY=60, OFF_REC_ACTIVE=125, OFF_REC_RETIRED=126, OFF_REC_RESCHED=127, OFF_REC_ATA=129, OFF_REC_DEBT=161. ✓

VAULT_RECORD_SPACE = 8 + 1+32+8+8+1+1+1+32+32+1 (125) + 1+1+2+32+16 (52) + 1+8 (9) + 1+8+16 (25) + 10 = 8+125+52+9+25+10 = 229? Let me recompute: 8 (disc) + [1+32+8+8+1+1+1+32+32+1] = 117... hmm: 1+32=33, +8=41, +8=49, +1=50, +1=51, +1=52, +32=84, +32=116, +1=117. Then stage 3: 1+1+2+32+16 = 52 → 169. Stage 3c: 1+8 = 9 → 178. Boost: 1+8+16 = 25 → 203. RECORD_PADDING=10 → 213. Plus disc 8 → 221. ✓ (SPEC says 221 bytes.)

MINT_CONFIG_SPACE: 8 + 1 + 32*3 + 4 + 8+8+8 + 4+4 + 8+8 + 32 + 2 + 1+1 + 32+32 + 8 + 1 + 8+8+8 + 4*5+4*5 + 8 + 32+32+32 + 8+8+4 + 8+8+8+16+16+8 + 8+8+32+8+8 + 32+1+8+8+8+8+8+8+8+8 + 32+1+2+8+1+2+4+4+8+8+4*64 + 256.

Let me sum: 8; +1=9; +96=105; +4=109; +24=133; +8=141; +8=149; +8=157; +32=189; +2=191; +1=192; +1=193; +32=225; +32=257; +8=265; +1=266; +8=274; +8=282; +8=290; +20=310; +20=330; +8=338; +32=370; +32=402; +32=434; +8=442; +8=450; +4=454; +8=462; +8=470; +8=478; +16=494; +16=510; +8=518; (stage 3b) +8=526; +8=534; +32=566; +8=574; +8=582; (stage 3c) +32=614; +1=615; +8=623; +8=631; +8=639; +8=647; +8=655; +8=663; +8=671; +8=679; (boost) +32=711; +1=712; +2=714; +8=722; +1=723; +2=725; +4=729; +4=733; +8=741; +8=749; +256=1005; +256 (CONFIG_PADDING)=1261. ✓ matches my layout computation (1005 + 256 = 1261).

BurnConfig: disc 8; version @8; collection @9..41; bump @41; burned_total @42..50; redeem_window_secs @50..58; rate_head @58; rate_ring @59..59+512=571; padding 256 → 827. Space: 8+1+32+1+8+8+1+512+256 = 827. ✓ GOV reads burned_total @42, version @8. ✓

GovConfig: version @8; collection @9..41; quorum_bps @41..43; threshold_bps @43..45; min_voting_secs @45..53; proposal_count @53..61; bump @61; last_round_id @62..70; last_guardian_id @70..78; last_arm_id @78..86; last_boost_id @86..94; padding. Space: 8+1+32+2+2+8+8+1+8+8+8+8+256 = 348. The Initialize space: 8 + 1 + 32 + 2 + 2 + 8 + 8 + 1 + 8 + 8 + 8 + 8 + CONFIG_PADDING = same. ✓

SEAL Config: version @8; collection @9..41; reserve_mints Vec<Pubkey> @41 (u32 len + 3×32); bump after. MINT/BURN read: disc @0..8, version @8, collection @9..41, reserves count @41..45, keys @45+. ✓ (OFF_RESERVES=41.)

Space: 8 + 1 + 32 + 4 + 96 + 1 + 256 = 398. Initialize: 8 + 1 + 32 + 4 + (32*3) + 1 + 256. ✓

Discriminators: SEAL_CONFIG_DISC = sha256("account:Config")[..8] = [155,12,170,224,30,250,204,130] — the suite asserts acctDisc('Config') matches (3.1y). MINT_CONFIG_DISC = [168,252,88,182,219,205,39,53] (3.1p, 3.1u). BURN_CONFIG_DISC = [90,69,15,87,119,190,109,45] (3.1o). VAULT_RECORD_DISC = [47,1,218,116,82,70,124,119] (3.1n). Instruction discs asserted (3.1a/b/j/k/l/m/t/q, BO.29). I can't recompute sha256 by hand, but the suite asserts them against the derivation, and the suite passes. The web proxy's VAULT_RECORD_DISC_B58 = '8s2gvH1XffL' — bs58 of [47,1,218,116,82,70,124,119]. The ids/proxy tests pin it against the suite. OK.

Now the sweep helper (R1s).

═══ SWEEP ═══

`process`: data must be [0]. accounts ≥ 4, (len-4) even. [0] signer (must be signer), [1] dest, [2] token == SPL_TOKEN_ID, [3] system == system_program. signer != dest. For each (src, to) pair: read_token both (SPL-owned, 165 bytes); src_owner == signer (else IllegalOwner); to_owner == dest && to_mint == src_mint (else InvalidAccountData). If amount > 0: Transfer all from src to to (signer signs). Then CloseAccount src → dest (rent to dest wallet), signer signs. Then: lamports = signer.lamports(); if > 0, system transfer all to dest.

(a) Access control: called directly, the signer must sign — a vault's asset-signer PDA can only be signed by Core, and Core's ExecuteV1 approves only the asset's owner (measured SR.5/5a/5c/5d). While frozen, Core refuses Execute (the seal). So only the owner, during a redemption (thawed). ✓ measured.

(b) Pair list: same source twice — first pair closes it; second pair's read_token fails (account closed: owner no longer SPL... a closed account has lamports 0 and data emptied? CloseAccount sets lamports 0 and zeroes... actually CloseAccount transfers lamports and marks the account as uninitialized by zeroing its data? The Token program's CloseAccount: transfers lamports to dest, then the account's data is reset (its state set to uninitialized) and lamports 0. Actually in SPL Token, CloseAccount sets the account's lamports to 0 and its data length... it does `account.data.borrow_mut().fill(0)`? Let me recall: CloseAccount drains lamports and zeroes the data (sets state to Uninitialized? No — it zeroes the whole buffer? In spl-token, close_account: "pack_account_into... " hmm. The measured arm SR.12a: duplicate source refused with "Provided owner is not allowed" — because after the close, read_token on the closed account: owner is still SPL Token (CloseAccount doesn't change the program owner), but the data is zeroed, so src_owner (bytes 32..64) = 0 ≠ signer → IllegalOwner. SR.12b pins that the refusal is the second, closed source (not the first guard). Measured. ✓

Destination twice: two sources of the same mint, same destination — fine (both transfer into it). Not a problem.

Source is also a destination: src owned by signer, dest owned by dest wallet; if src == to, then to_owner == dest required, but src_owner == signer ≠ dest (signer != dest enforced). So src == to would require signer == dest → refused earlier. OK.

Native wSOL source: it's a classic 165-byte account; transfers and closes fine; close returns rent + wrapped lamports to dest wallet. Fine.

Delegate/close authority on source: the helper transfers (owner signs, so delegate irrelevant) and closes (owner signs; close authority only matters if it's someone else — CloseAccount requires the OWNER or the close authority. The owner is the signer PDA. If close_authority is set to someone else, the owner can still close? In SPL Token, CloseAccount: "if close_authority is present, it must sign instead of the owner"? Actually: CloseAccount checks: if the account has a close_authority (COption Some), then THAT authority must sign; otherwise the owner signs. Let me recall precisely: `CloseAccount` in spl-token: authority check is `if account.close_authority.is_some() { close_authority } else { owner }` — i.e., if a close authority is set, the owner alone CANNOT close. Yes — that's the C5 case (round 35): a stranger hands the vault an account with close authority kept; the helper's close reverts (R36.C5 measured: the close fails, whole opening reverts). The redeem page handles it with a plain transfer instead. Documented and measured. ✓

Frozen source: transfer reverts (SR.14 measured). ✓

Destination not an ATA: any classic account owned by dest wallet with matching mint works. Fine.

Destination wallet == vault's own asset-signer: refused (signer == dest → InvalidArgument, SR.10). Another vault's asset-signer as dest: allowed by the helper (dest is just a wallet; its accounts must be owned by it). Hmm — could a redemption sweep vault A's contents into vault B's wallet? The dest wallet is chosen by the transaction builder (the owner). If the owner chooses another vault's PDA as dest... the destination accounts must be owned by that PDA (to_owner == dest). The owner could do it deliberately (their choice, their loss — the funds go into vault B's wallet, which they may or may not control). The helper doesn't compare dest with the asset's owner. (c) asks: is that safe? Given only the owner can drive it (via Core Execute), the owner choosing a weird destination is their own act — same as choosing any destination. The page always uses the owner. Safe enough; documented ("Every value it moves goes to ONE destination wallet" chosen by the caller).

(c) Lamport transfer to a destination below rent-exemption or non-system: System transfer to an account that doesn't exist fails if... actually System transfer to a non-existent account: `transfer` requires the recipient to... no, System transfer CAN create? No — SystemProgram::transfer to a non-existent account fails ("Transfer: to account must exist"? no...). Actually, Solana System transfer to an account with no data: the recipient must be a system-owned account or non-existent? A transfer to a non-existent address FAILS in Solana (the runtime requires the recipient account to exist? No — transfers to non-existent accounts are allowed; they create the account with lamports). Hmm, let me think. SystemProgram transfer: the `to` account must be writable; the runtime creates... no, it doesn't create. Actually, a system transfer to an address with no account: the transaction must include the account; if it's not in the account list, it fails. If included and doesn't exist on chain, the runtime... In Solana, transferring lamports to a non-existent account IS allowed and creates a system-owned account with those lamports (this is how funding new addresses works). But there's a rule: the recipient of a transfer must be rent-exempt? No — that rule was removed; now transfers below rent exemption to non-existent accounts fail with "insufficient funds for rent" only when creating... Actually the current rule: a transfer that would leave an account below rent exemption fails, EXCEPT transfers to accounts that already exist and are... no. The rule (since SIMD-xxx): all accounts must be rent-exempt; a transfer creating a new account below rent-exempt minimum fails. The helper's note (item 50): "A lamports-only sweep needs a destination that exists... a credit below rent exemption to an account that does not exist yet is refused. The canonical destination is the owner, who pays the fee and so exists." Measured in the suite (SR.13 zero-pair sweep to the owner). And R27.S1: lamports to a non-System-owned destination (a token account) work (transfer just adds lamports). ✓

(d) The lamport sweep reads signer.lamports() at execution, transfers all. After it, signer has 0. BURN's lamports == 0 check runs later in the same tx. Can anything re-fund the signer between the sweep and the burn within the same transaction? A later instruction could deposit... but the redemption's instruction order is [claim?, open, Execute(sweep), burn]. Between Execute and burn, only instructions the owner put there. A stranger can't inject into the owner's transaction. Core's Execute itself doesn't deposit. So BURN sees 0. ✓ (And if the owner themselves adds a deposit, they grief themselves.)

(e) Interaction with BURN's emptiness proof: BURN requires every reserve mint's ATA under BOTH token programs DECLARED; skips accounts no token program owns. The sweep closes emptied accounts → closed accounts have owner... after CloseAccount, the account's lamports are 0 and data zeroed, but the account still exists with owner = SPL Token? Hmm. In SPL Token, CloseAccount: drains lamports, then zeroes data. The account remains, owned by the Token program, with zeroed data, 0 lamports. Actually wait — does CloseAccount delete the account (assign to system program)? Let me recall the spl-token close_account processor: it transfers lamports out, then `account.data.borrow_mut().fill(0)`? No... In spl-token's close_account: after transferring lamports, it does `*destination_account.lamports.borrow_mut() = ...; **source_account.lamports.borrow_mut() = 0; source_account.data.borrow_mut().fill(0);`? Hmm, I believe modern spl-token zeroes the data but leaves the owner as the token program. Actually no — I recall it also reassigns: `source_account.assign(&system_program::ID)`? Let me think about what the suite measured: SR.4/SR.13 redemptions through the helper land, with BURN's declared accounts including the closed reserve ATAs. BURN's reserve loop: finds the declared account; `if acc.owner != &SPL_TOKEN_ID && != &SPL_TOKEN_2022_ID { continue; }` — so if the closed account's owner is no longer a token program, it's skipped (passes for that reason). If the owner is still SPL Token with zeroed data: d.len() — after close, is the data length still 165 (zeroed) or 0? If data is zeroed but length 165: d.len() < 165? No, len == 165. Then owner field (d[32..64]) = 0 ≠ pda → ReserveNotOurs → REFUSED. That would break every redemption. But the suite's redemptions through the helper LAND (SR.4, S8.1), so the closed account must pass. The measured fact: the suite passes, so whatever CloseAccount does makes the account skipped. The prompt says "Show the closed account passes for the right reason." The answer: spl-token's CloseAccount zeroes the data AND reassigns the owner to the System program? Let me check my memory of spl-token 4.x close_account:

```rust
// transfer lamports
**source_account_info.lamports.borrow_mut() = 0;
// zero the account data? Actually:
source_account_info.data.borrow_mut().fill(0); // ? 
// and assign to system program? 
source_account_info.assign(&system_program::ID); // ?
```

Hmm. In spl-token's `process_close_account`: 
```rust
let dest_starting_lamports = destination_account_info.lamports();
**destination_account_info.lamports.borrow_mut() = dest_starting_lamports.checked_add(source_account_info.lamports()).ok_or(TokenError::Overflow)?;
**source_account_info.lamports.borrow_mut() = 0;
// then:
source_account_info.data.borrow_mut().fill(0);  // no...
```

Actually I recall it calls `source_account_info.assign(&system_program::id())` — no wait. Let me think about what's observable: after closing a token account, getAccountInfo returns null (the account is gone). Yes! A closed token account no longer exists (the runtime removes accounts with 0 lamports and... no, the runtime removes accounts with 0 lamports only if they're also... accounts with 0 lamports are purged at the end of the transaction IF they're not... hmm, actually Solana purges accounts with 0 lamports at transaction end (rent collection: any account with 0 lamports is removed). So after CloseAccount, the account has 0 lamports → purged at tx end → but DURING the transaction, at BURN's check, the account still "exists" as an AccountInfo with 0 lamports, owner... 

The key question is what BURN sees. The suite passes, so empirically the closed account is skipped. Which skip? Either owner changed to System (→ `continue` in the reserve loop), or lamports 0 → in the reserve loop there's no lamports check... the reserve loop: `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }`. If owner is still SPL: `d.len() < TOKEN_ACCOUNT_LEN` → if data was zeroed in LENGTH (realloc to 0), len 0 < 165 → continue. If data is 165 zeroed bytes: owner field 0 ≠ pda → ReserveNotOurs → fail. Since the suite passes, it must be one of the first two. 

I recall now: spl-token close_account does `source_account_info.assign(&SystemProgram::id())`? Hmm, no. Let me look at it differently: the Token-2022 close_account (and classic) implementation:

```rust
pub fn process_close_account(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    ...
    // Transfer lamports
    let dest_starting_lamports = destination_account_info.lamports();
    **destination_account_info.lamports.borrow_mut() = dest_starting_lamports
        .checked_add(source_account_info.lamports())
        .ok_or(TokenError::Overflow)?;
    **source_account_info.lamports.borrow_mut() = 0;
    // Then:
    source_account_info.assign(&system_program::ID);  // ← I'm fairly sure this exists? 
    source_account_info.realloc(0, false)?;  // ← and this
}
```

Hmm, actually I think it's:
```rust
    source_account_info.data.borrow_mut().fill(0);  // no
```

The measured evidence in this very bundle: SR.4a measures the closed account's rent reaching alice, and the redemption lands with BURN declaring the closed accounts. Also 3.3a: "the same delegate, but the ATA is CLOSED by the sweep" → ALLOW. And the pre-helper sweeps (suite's `sweep()` with close=true) close the reserve ATA and BURN passes. So closed accounts pass BURN. The mechanism: spl-token's CloseAccount reassigns the account to the System program and reallocs to 0 (I'm now fairly confident: `source_account_info.assign(&system_program::id()); source_account_info.realloc(0, false)?;` — hmm, or the reverse order). Either way, owner becomes System → BURN's `acc.owner != &SPL_TOKEN_ID && != &SPL_TOKEN_2022_ID` → continue. Passes for the right reason (skipped as a non-token account). ✓ And the second loop: `if acc.lamports() == 0 { continue; }` — also skipped there. ✓

(f) Fit: S8.0 measures 1,061 bytes for claim + open + helper sweep (3 reserves) + burn, owner pays. With compute-budget pair (+52) and separate fee payer (+96) → 1,209 ≤ 1,232. The page (plan-redeem) builds exactly this shape; plan.test.mjs measures 1,061 ("plain: the page's redemption is the same 1,061 bytes"). ✓ A fourth reserve: MAX_RESERVE_MINTS=3, so no fourth exists. The in-line monthly run's accounts: the pool is already in the redemption (BURN carries pool_token for retire_redeemed). ✓

(g) Evidence: SR.0-SR.4a, SR.5-SR.14, S8.*. The helper deployed in the suite from target/deploy/cbob_vault_sweep.so, which build-mainnet.sh proves byte-identical to dist/ (mainnet build) — the helper has no localnet feature (Cargo.toml comment), so tested bytes == shipped bytes. ✓

Now, are there arms that cannot fail? SR.12b checks the refusal reached the second source. The `because()` pins cover most negatives. Let me look for a sweep arm refused for a different reason than named... SR.2 (destination not owned by dest wallet): pinned to "CBOB_SWEEP refused: destination". SR.11: source not the vault's, pinned to both the log and "Provided owner is not allowed". OK.

Now let me hunt for REAL defects. Let me look at areas the rounds may have missed.

**Hunt 1: `claim`'s `owed_paid` vs frozen deferral.** When a vault is frozen, `continue` after `if touched { store }` — the owed stays. owed_paid doesn't include it. Good. When pay == 0 and touched: stored (boost expired), nothing paid. Good.

**Hunt 2: `claim` pair where the same record appears twice.** First pair pays (debt = weight × acc, carry = remainder). Second pair: load_record again (fresh read — but the account was already written by store_record in the same instruction; load_record re-reads the CURRENT data, which includes the first payment). owed_of now = weight×acc + carry - debt = carry (sub-sat) → pay = 0 → skip. So paid once. BO.32 measured. ✓

**Hunt 3: `claim` with a record PDA of a different vault and dest of another.** dest must == r.vault_ata (recorded at activation). So a claim pays only the vault's own recorded account. ✓

**Hunt 4: `activate` on a vault whose asset is burned.** require_live_vault fails (NotALiveVault). For the second (join) call: require_live_vault too. But a bare-burned vault that's pending: activate's pending branch requires live vault → refuses. But `claim` naming a pending burned vault: `if r.pending { require dest == vault_ata; if dist_epoch > request_epoch { join } }` — claim does NOT check the asset is alive! So a bare-burned pending vault can be JOINED by a claim (dead weight). That's accepted limit 27 (red-team 3 finding 2, accepted; the crank never does it). ✓ documented.

**Hunt 5: `join` when the vault's level... ** join uses LEVEL_WEIGHTS[(r.level - 1)] — level was checked 1..5 at request. ✓

**Hunt 6: `distribute` when pool balance < owed (PoolShort).** Can the pool ever be short? Claims only pay what's owed; splits only add. The pool can't be drained below owed by any instruction. Coinbase freeze doesn't reduce balance. So PoolShort is defensive. ✓

**Hunt 7: `credit` when w > 0 but avail huge.** delta = avail × SCALE / w (u128, no overflow with overflow-checks). acc_scaled grows. owed_scaled += delta × w ≤ avail × SCALE. ✓

**Hunt 8: The `monthly_inline` in `retire_redeemed` runs AFTER retire.** It credits the remaining vaults. But note: it runs even when the redemption's claim already ran the month (claim's monthly_inline stamps last_distribute_at, so retire's sees not-due). Exactly once per period. ✓

**Hunt 9: `boost_vault` when the vault's record is pending (requested, not joined).** require r.active && !r.pending → BoostNeedsActiveVault. BO.20 measured. ✓

**Hunt 10: `boost_vault` and the monthly_inline ordering.** monthly_inline runs first (credits at OLD weight), then the boost. BO.22 measured. ✓

**Hunt 11: `set_boost_terms` with price > 0 but weight/epochs 0.** require weight ≥ 1, epochs ≥ 1 when price > 0. With price == 0: weight/epochs zeroed. ✓

**Hunt 12: GOV `SetBoostTerms` with price 0 but nonzero weight/epochs.** GOV's check: `if *price > 0 { require bounds }` — price 0 skips bounds; MINT's set_boost_terms with price 0 zeroes weight/epochs regardless. ✓

**Hunt 13: `apply_guardian` with pending_guardian = default (None armed).** pending_guardian_set true; apply sets guardian = default → retired brake. require_guardian then refuses everyone (NotTheGuardian for default). ✓

**Hunt 14: `arm_guardian` while one is pending.** Overwrites, restarts notice. Fine (a vote re-arming is a new decision).

**Hunt 15: `cancel_swap_operator` when none pending → NoPendingOperator.** ✓

**Hunt 16: The `Governed` CPI from GOV: could anyone else invoke MINT's governed instructions with the gov PDA as signer?** The gov PDA signs only via GOV's invoke_signed inside execute_proposal. No other program can sign for it (it's GOV's PDA). ✓

**Hunt 17: `execute_proposal`'s CPIs use `ctx.accounts.governance`** — the ExecuteProposal struct has `governance` with seeds [GOV_SEED] bump. And MINT checks has_one = governance. The gov_pda is derived in-handler and checked == m.governance. ✓

**Hunt 18: A proposal with `Brakes { set_guardian: true, guardian: Some(default) }`** — arm_guardian(None-equivalent): pending_guardian = default, set = true. Apply → guardian = default (retired). R24.2 measured: Some(default) IS None. ✓

**Hunt 19: `read_stops` in GOV reads sales_stopped_at/sweep_stopped_at at 518/526.** ✓ (computed above).

**Hunt 20: `create_proposal` when quorum_supply = 0** (no live vaults — impossible: the proposer must own a live vault, so supply ≥ 1). Actually: proposer owns a live vault → minted - burned - bare ≥ 1. ✓ (Limit 45: if every vault is redeemed, no proposal can be created — the proposer needs a live vault.)

**Hunt 21: `execute_proposal` when quorum_supply is 0?** Can't be (snapshot at creation ≥ 1). need > 0 required anyway. ✓

**Hunt 22: Vote on a proposal after it's executed → AlreadyExecuted.** ✓. Vote after voting_ends_at → VotingClosed. ✓

**Hunt 23: `cast_vote` with a vault whose record's asset field doesn't match** → BadVaultRecord. ✓

**Hunt 24: The `index_snapshot` uses minted_total at creation; a vault minted during the vote has index ≥ snapshot → VaultTooNew.** ✓

**Hunt 25: BURN's rate limit when `redeem_window_secs` is huge (24h max).** Init bounds [10, 86400]. Mainnet must be 3600 (item 38, the checker). ✓

**Hunt 26: BURN's `read_mint_supply` requires MINT config version 6.** If MINT's config were a different version, refused. Pinned. ✓

**Hunt 27: SEAL's open when the asset's collection account passed is the right collection but the asset is burned.** read_core_asset requires len ≥ 66 → tombstone fails. ✓

**Hunt 28: What if the owner is also the payer and the payer account == asset?** Different roles; the asset is a Core account, payer a wallet. No confusion (owner checked against asset's owner bytes).

**Hunt 29: `open_for_redemption`'s walk starts at current+1.** If open is the LAST instruction, no burn follows → NoTerminalBurn. ✓ If open is called via CPI (wrapper), current = outer index; the walk sees top-level instructions after the outer one. A genuine top-level burn for asset+owner must follow. But BURN also requires a genuine top-level open BEFORE it. If open is wrapped (inside a CPI), the top-level instruction is the wrapper, not open_for_redemption → BURN's backward walk looks for SEAL_PROGRAM_ID with open disc at top level → the wrapper's instruction is the wrapper program, not SEAL → not found → NoPrecedingOpen. WR.3 measured. ✓

**Hunt 30: Reentrancy via Core?** Core's ExecuteV1 invokes the helper; the helper does token CPIs. No reentry into our programs. The seal's thaw: SEAL → Core UpdatePluginV1. No callback. ✓

**Hunt 31: `burn_vault`'s `declared` count == remaining_accounts.len().** Extra accounts beyond the reserve ATAs are allowed (declared = count). The second loop checks them. A declared account that's a live Core asset → VaultStillHoldsAVault. A declared token account owned by the pda with a balance → VaultNotEmpty. ✓

**Hunt 32: A declared account that's a token account NOT owned by the pda** (someone else's): second loop checks `if owner field == pda` — not pda → skipped. So a stranger's account declared is ignored. Fine.

**Hunt 33: The reserve loop's `find` — if the same ATA appears twice in remaining_accounts, find gets the first.** Both would be checked identically. Fine.

**Hunt 34: `burn_vault` when a reserve ATA doesn't exist** (never created): the derived address must be DECLARED (ReserveNotDeclared if absent from remaining). If declared but the account doesn't exist on chain: passed as an AccountInfo with lamports 0, owner System → reserve loop: owner not token → continue (skipped). Second loop: lamports 0 → skip. So a non-existent reserve ATA passes. That's the design (a vault may never have held that reserve). But wait — the sweep helper can't name a non-existent account as a source (read_token fails: not SPL-owned). So the page creates missing reserve accounts in the prior transaction (item 42/50). If a stranger creates the vault's reserve ATA (permissionless ATA creation) and deposits dust BEFORE the redemption, the sweep names it (it exists now) and sweeps the dust to the owner. If the stranger creates it between the page's build and landing — the helper reads live balances, so the dust is swept. If the stranger creates a Token-2022 ATA for a classic mint — probe F4.2 measured: refused (IncorrectProgramId). A non-ATA token account owned by the PDA: a stranger can't create one owned by the PDA without the PDA signing (InitializeAccount requires the owner... no — the owner field is set at creation; creating a token account with owner = PDA requires... InitializeAccount3 takes the owner as a parameter; the account's creator sets owner = PDA without the PDA signing? InitializeAccount3: `InitializeAccount3 { owner }` — the new account's owner is set to any address without that address signing. Yes! A stranger CAN create a non-ATA classic token account owned by the vault's PDA (they pay rent, create the account with a keypair they hold, initialize it with owner = the PDA). Then deposit tokens into it. Is it declared? BURN only requires the reserve ATAs declared; other accounts are optional. If undeclared, BURN never sees it → the tokens are destroyed with the burn (accepted limit 44; the page's coverage check warns). If the page names it as a helper pair, the helper sweeps it (source owned by the PDA). ✓ covered.

**Hunt 35: A stranger creates a reserve ATA for the vault and sets a close authority?** ATA creation sets owner = PDA, no close authority. A stranger can't set a close authority on an account they don't own. ✓

**Hunt 36: A stranger delegates the vault's reserve account?** Only the owner (PDA) can approve a delegate; the PDA never signs except via Core Execute by the vault's owner. During a redemption, the owner's own transaction could approve... self-grief only. ✓

**Hunt 37: `split_revenue` when the pool or bank ATA is frozen.** The TransferChecked reverts → whole split fails (R28.F1/F2 measured; the 85% waits in revenue). Accepted (limit 28). ✓

**Hunt 38: `split_revenue` decimals parameter.** TransferChecked checks decimals against the mint; wrong decimals → CPI fails. ✓

**Hunt 39: `sweep_sol_for_swap` when revenue PDA has < reserve + amount → ReserveWouldBreach.** ✓. The `last_sweep_at` updated AFTER the transfer (if transfer fails, revert). ✓

**Hunt 40: `initialize` for MINT requires the collection's update authority == mint_pda, but the collection is created at road step 10 with exactly that.** The ceremony's step 0 does it. ✓

**Hunt 41: The royalty plugin install: authority None.** After that, Core refuses updates/removals (R.6/R.6a measured on a control). ✓

**Hunt 42: `create_vault`'s owner is a Signer.** An off-curve owner can't sign → can't mint (5.2 measured with isSigner:false → AccountNotSigner). But a PDA passed as CPI signer: is_signer true. The comment acknowledges: "the best available check, not a complete one". Limit 43. ✓

**Hunt 43: `mint_vault`'s `payer` vs `owner` can differ.** The payer pays; the owner owns and signs. Fine.

**Hunt 44: Attribute budget.** check_attributes: ≤ 7 (mint) / 6 (charter) caller attrs, each ≤ 128 chars, no reserved, no dups. write_record: bytes = Σ(8 + k.len + v.len) ≤ 640 (AttributesTooLarge). reveal re-sends + level. L.12/L.12a/L.13/L.14 measured. ✓

**Hunt 45: `reveal_level` when the asset is burned but the record's attrs_hash... ** burned → skip the Core write entirely (no hash check). The draw still counts. L.11 measured. ✓

**Hunt 46: `reveal_level` hash check: hashv(&[attributes.try_to_vec()]) == stored.** The stored hash is of the attributes at mint (including charter for charter vaults). The caller re-supplies; mismatch → AttributesMismatch. L.4 measured. ✓

**Hunt 47: The crank's `try_capture` can write entropy for a record whose reveal_slot is in the future but... ** try_capture: now ≤ reveal_slot → NotYet. So no early capture. ✓

**Hunt 48: `reschedule_reveal` when entropy already set → AlreadyCaptured.** ✓. When level drawn → AlreadyCaptured (level != 0 fails the first require). ✓

**Hunt 49: A vault's reveal_slot after many reschedules.** reschedules is u16 saturating. reveal_slot = now + 16 each time. No overflow (u64). ✓

**Hunt 50: `capture_entropy` on a record whose window expired → RevealWindowExpired (must reschedule first).** ✓

Now, the web/ pages (R0's focus this round). Let me check the transaction builders against the programs.

**plan-redeem.mjs `build`:** [claim?] + open + coreExecute(sweepHelper) + coreExecute(tokenTransfer)×C5 + burnVault. 

- poolClaim: [MINT_CFG (w), pool (w), TOKEN_PROGRAM (r), then (vrec, dest) pairs (w)]. MINT's Claim struct: config (mut, seeds), pool_token (mut), token_program. Then remaining: [SlotHashes?, crank records...] then pairs. With crank_n = 0, no crank prefix. The page sends u8(0) crank. Pairs: (vrec(asset), dest = ata(pda, payment_mint)). MINT checks dest == r.vault_ata. ✓ matches ixPoolClaim in the suite (ix.test.mjs compares byte-for-byte).

- openForRedemption: [asset (w), COLL (w), owner (s, r), payer (s, w), SEAL_CFG (r), SEAL (r), CORE (r), SYSVAR_INSTRUCTIONS (r), SYSTEM (r)]. SEAL's OpenForRedemption: vault_asset (mut), collection (mut), owner (Signer), payer (Signer, mut), config (seeds), seal (seeds), mpl_core (address), instructions (address), system_program. ✓ matches.

- coreExecute: ExecuteV1 (31), data [31, u32(len), inner.data]; keys [asset (w), collection (w), assetSigner (r), payer (s, w), authority (s, r), SYSTEM (r), inner.programId (r), ...inner.keys with signer's flag cleared]. mpl-core's execute: asset, collection (or CORE if none), asset_signer PDA (readonly, not signer — Core signs it), payer (signer, writable), authority (signer or CORE), system program, then the inner instruction's program and accounts. The suite compares against mpl-core's `execute` byte-for-byte (ix.test.mjs "sim S8 viaCore == coreExecute"). ✓

- sweepHelper: [pda (s, w), dest (w), TOKEN (r), SYSTEM (r), pairs...]. The helper's expected layout: [0] asset signer (signer, writable), [1] dest (writable), [2] token, [3] system, then pairs. ✓. Through Core Execute, the pda's signer flag is cleared in the outer instruction (Core adds it as signer internally). ✓

- tokenTransfer (C5): SPL Transfer [3, u64 amount], keys [src (w), dst (w), authority (s, r)] where authority = pda. Through Core Execute, pda signs. ✓

- burnVault: [asset (w), COLL (w), owner (s, r), pda (w), payer (s, w), BURN_CFG (w), SEAL_CFG (r), SYSVAR_INSTRUCTIONS (r), CORE (r), SYSTEM (r), MINT_PROG (r), MINT_CFG (w), vrec (w), pool (r), ...declared (w)]. BURN's BurnVault: vault_asset, collection, owner, asset_signer (seeds, program Core), payer, config, seal_config, instructions, mpl_core, system_program, mint_program (address), mint_config (mut), vault_record (mut), pool_token. ✓ matches ixBurn in the suite (compared byte-for-byte).

The declared list: reserves.flatMap(m => [ata(pda, m, TOKEN), ata(pda, m, TOKEN_2022)]) — 6 accounts. BURN requires every reserve mint's ATA under both programs declared. ✓

**The C5 transfer amount:** `a.parsed.amount` read at plan time. If more arrives between plan and send, the extra stays (the account is left behind anyway — undeclared). The note says so. ✓

**The re-plan before signing (redeem.mjs):** freshPlan with noPrior=true, dropStrays. If new acks appear, the holder must tick them. If refuse or prior non-empty → stop. L2 measured. ✓

**planPayout:** expire due boosts (batches of 20), join waiting (batches of 14), distribute with 100 GARY burn. Order: expire → join → distribute. MINT requires boosts_due == 0 and waiting_to_join == 0 before distribute. ✓ (BO.12/13 measured the gates.)

Wait — planPayout's join uses poolClaim with pairs (asset, vault_ata). MINT's claim with a pending record: dest must == r.vault_ata, joins if dist_epoch > request_epoch. ✓. And the expire batch: expireBoosts(ids, records) — records are vault RECORD PDAs. MINT's expire_boosts: config + remaining records. ✓

**planClaim (claim page):** claimCharterVault with proof, no extra, no crank. Keys: [MINT_CFG (w), vrec (w), asset (s, w), COLL (w), owner (s, r), payer (s, w), pob (w), pobCollection (w), SEAL_CFG (r), MINT_AUTH (r), CORE (r), SYSTEM (r), pool (r)]. MINT's ClaimCharterVault: config, vault_record, asset, collection, owner, payer, pob_asset, pob_collection, seal_config, mint_authority, mpl_core, system_program, pool_token. ✓ 13 accounts. The suite's ixClaim compared byte-for-byte (get.test.mjs). ✓

The claim page refuses a PoB or collection with external plugins (externalCount > 0) — sends pob_extra=0 always. SPEC 46: the page refuses rather than guess. ✓

**planBuy:** mintVault with maxPrice = price read. Keys: [MINT_CFG (w), vrec (w), asset (s, w), COLL (w), owner (s, r), payer (s, w), payerToken (w), paymentMint (r), revenueToken (w), TOKEN (r), SEAL_CFG (r), MINT_AUTH (r), CORE (r), SYSTEM (r), pool (r)]. MINT's MintVault: config, vault_record, asset, collection, owner, payer, payer_token, payment_mint, revenue_token, token_program, seal_config, mint_authority, mpl_core, system_program, pool_token. ✓ 15 accounts. ✓

**planDraw:** revealLevel/captureEntropy/rescheduleReveal. revealLevel keys: [MINT_CFG (w), vrec (w), asset (w), COLL (w), payer (s, w), MINT_AUTH (r), SLOT_HASHES (r), CORE (r), SYSTEM (r)]. MINT's RevealLevel: config, vault_record, asset, collection, payer, mint_authority, slot_hashes, mpl_core, system_program. ✓

**planRescue:** rescueNested keys: [MINT_CFG (r), vault (w), COLL (r), host (r), to (r), payer (s, w), RESCUE (r), CORE (r), SYSTEM (r)]. MINT's RescueNested: config (seeds, NOT mut), vault (mut), collection (address = config.collection), host, new_owner, payer (Signer, mut), rescue_authority (seeds), mpl_core, system_program. ✓

**planActivate:** activate keys: [MINT_CFG (w), vrec (w), asset (r), vaultToken (r), pool (r)]. MINT's Activate: config (mut), vault_record (mut), asset, vault_token, pool_token. ✓

**Ceremony:** sealInit/mintInit/burnInit/govInit compared byte-for-byte against the suite's builders with ruled values (ceremony.test.mjs). The collection create (coreCreateCollection) compared against mpl-core's createCollection. ✓

**The proxy (rpc-proxy.mjs):** method allowlist == what web/src calls (tested). gpaShape: 8 exact shapes. txRefusal: ≤1232 bytes, only TX_PROGRAMS, at least one CBOB program OR the three exact shapes (ATA creates only; collection create with MINT_AUTH as update authority; System transfers to REVENUE). 

Hmm — the ATA-create exemption: `work.every(ix => ix.prog === ATA_PROG && ix.data.length === 1 && ix.data[0] === 1)` — CreateIdempotent only. A stranger could relay ATA creations for any owner/mint through the proxy (costs them nothing but the rate limit; the ATA is created for whoever). Not value-losing; rate-limited. Fine.

The collection-create exemption: `work.length === 1 && work[0].prog === CORE && work[0].data[0] === 21 && work[0].accts[1] === MINT_AUTH` — a stranger could relay a CreateCollectionV2 naming MINT's PDA as update authority — creating a DECOY collection (the V2 class)! Through the proxy. Rate-limited (1/s per IP). But the ceremony now ignores decoys (V2 repair). So the proxy relaying decoy-creates is harmless post-repair. Worth noting? The decoy costs the stranger rent; the ceremony ignores it. OK.

The System-transfer exemption: transfers to REVENUE only. A stranger donating to the revenue address. Harmless (it increases what split_revenue splits... wait, SOL to revenue: swept by the operator. Dust not swept (MIN_SWEEP_LAMPORTS). Fine).

W6 (round 37): a no-op CBOB instruction carries anything else through the relay (e.g., expire_boosts of a non-due boost + a stranger's transfer). The README states the rule; rate limits bound it. Disproved as a defect. ✓

**signExact (tx.mjs):** the wallet signs; the page refuses if the signed message != the built message. Extra keypairs (new vault) sign after. verifySignatures. ✓

**sendSigned:** polls signature status until blockhash expiry. ✓

Now let me look for NEW defects in the web/ repairs specifically (round 37's V1/V2/V3 repairs are the newest code).

**plan-redeem.mjs, the `cannot`/`helperStrays`/`transferStrays` logic:**

For each pdaToken not in `covered` (not a reserve ATA):
- !parsed → cannot (box).
- classifyPdaTokenAccount → owned list (for coverage).
- If program != 'token' || dataLen != 165: if classified (c) → cannot (Token-2022 box). Continue. Note: `if (c) cannot.push(...)` — only if classify returned non-null. classifyPdaTokenAccount (bank/detectors.mjs, not bundled, but per round 37 W10: returns null for dataLen 165 amount 0; for Token-2022 170-byte it returns something non-null). Hmm — a Token-2022 account with dataLen 165 and amount 0: classify returns null → no box (W10: empty 165-byte Token-2022 gets no box). But wait — the account is still owned by the PDA and undeclared; it holds 0; nothing lost. ✓. A Token-2022 account with dataLen 165 and amount > 0: classify returns non-null → cannot box. ✓. dataLen 170 (extensions): classify non-null → box. ✓
- Classic 165: amount == 0 → skip (continue). Frozen with balance → cannot box. No close authority or close authority == pda → helperStrays. Else → transferStrays.

Then undeliverable check (mint freeze authority, frozen destination, dropStrays) moves strays from helper/transfer to cannot.

Then noAccount (second pass, noPrior): strays whose owner ATA doesn't exist → removed from both lists → noAccount → `left:` boxes.

Wait — there's an ordering bug candidate: `noAccount` is computed as `[...helperStrays, ...transferStrays].filter(a => !canReceive(a))`, then removed from the lists. But this happens BEFORE the build. On the FIRST pass (noPrior false), canReceive is true for all (s.noPrior undefined → !s.noPrior → true). So noAccount is empty on first pass. On re-plan (noPrior true), strays whose owner ATA still doesn't exist → left behind with a box. ✓ (L2 arm.)

Then build(hs, ts), size check, pop to `left` until fits. `left` and `noAccount` get `left:` acks. `cannot` get `lost:` acks. ts get notes. hs get notes. 

Then nested NFTs: ourVault → refuse (rescue first); unreadable → asset box; else → asset box (destroyed). Compressed → cnft box. compressedUnchecked → note.

Then judgeRedemptionCoverage cross-check: owned = classified token accounts + nested assets; covered = reserve ATAs + swept strays. Anything judged uncovered that isn't named → refuse. 

Hmm — `named` = ack ids' address parts + nested ourVault addresses. The ack ids are `lost:${addr}`, `left:${addr}`, `asset:${addr}`, `cnft:${addr}`, `group:...`. For grouped boxes, the individual ids are in `covers` but `named` only includes `a.id.split(':').slice(1).join(':')` — for a group box, id = `group:300:deadbeef` → split(':').slice(1).join(':') = "300:deadbeef" — not an address! So if the coverage check finds an account that was folded into a group box, `named` won't contain its address → refuse: "The vault holds something this page did not expect". 

Wait — is that a bug? Let's trace: >20 strays → groupAcks collapses the lost/left/asset/cnft boxes into one group box. The individual accounts' addresses are in the group box's `covers` and `list` (texts). But `named` is computed AFTER groupAcks? Let me check the order in planRedemption:

```js
for (const n of s.nested) { ... }   // nested boxes
for (const c of s.compressed || []) { ... }  // cnft boxes
if (s.compressed === null || ...) note(...)
// coverage cross-check
const judged = judgeRedemptionCoverage(owned, [...covered])
const named = new Set([...ack.map(a => a.id.split(':').slice(1).join(':')), ...s.nested.filter(n => n.ourVault).map(n => n.address)])
for (const reason of judged.reasons) if (![...named].some(a => a && reason.includes(a))) refuse.push(...)
// THEN:
const inc = s.strayReadIncomplete; if (inc?.unlisted) ack.push(unlisted:all) else if (inc?.unexamined) ack.push(unlisted:n)
const ninc = s.nftReadIncomplete; if (...) ack.push(nfts:...)
groupAcks(ack)
```

So groupAcks runs AFTER the coverage check. Good — the coverage check sees the individual boxes. So `named` has individual addresses. OK, no bug there.

But wait — the coverage check runs BEFORE the `unlisted`/`nfts` boxes are pushed. Those don't correspond to coverage findings (they're about what couldn't be read, which coverage also can't see). Fine.

Now, `judgeRedemptionCoverage(owned, covered)`: owned includes classified token accounts (including reserve ATAs — they're classified and pushed to `owned` in the covered branch) and nested assets. covered = reserve ATA addresses + swept stray addresses (hs + ts added to covered later: `for (const a of [...hs, ...ts]) { covered.add(a.address); ... }` — this happens BEFORE the coverage check? Let me check order:

```js
let hs = [...helperStrays], ts = [...transferStrays]
const left = []
let redemption = build(hs, ts), size = legacySize(redemption, owner)
while (size > PACKET_LIMIT && (hs.length || ts.length)) { left.push(ts.length ? ts.pop() : hs.pop()); redemption = build(hs, ts); size = legacySize(redemption, owner) }
if (size > PACKET_LIMIT) refuse.push(...)
for (const a of [...hs, ...ts]) { covered.add(a.address); needOwnerAta.add(a.parsed.mint) }
for (const a of [...left, ...noAccount]) ack.push(left:...)
for (const a of ts) note.push(...)
for (const a of hs) note.push(...)
for (const x of cannot) ack.push(lost:...)
// nested, compressed
// coverage check
```

Yes, covered.add for swept strays happens before the coverage check. ✓

So the coverage check: owned (all classified token accounts + nested assets) vs covered (reserve ATAs + swept strays). An owned account not covered and not named in an ack → refuse. Which owned accounts are neither covered nor named? 
- Reserve ATAs: covered. ✓
- Swept strays (hs, ts): covered. ✓
- Left/noAccount strays: named in left: boxes. ✓
- Cannot strays: named in lost: boxes. ✓
- Frozen reserve ATA with balance: refuse earlier (the reserve checks). ✓
- Empty classic strays: classify returns... for dataLen 165 amount 0: null → not in owned → coverage doesn't see them. ✓
- Nested assets: owned includes them (kind: 'asset'); ourVault → refuse (named via nested filter); foreign → asset: box (named). ✓

Looks consistent. The cross-check refuses only something truly unnamed. ✓

Hmm, one more: `owned` for reserve ATAs uses `classifyPdaTokenAccount({address, dataLen, amount})` — for a MISSING reserve ATA (doesn't exist), it's not in pdaTokens at all (vaultWalletAccounts only pushes existing accounts). So not in owned. And it IS in covered (added unconditionally: `covered.add(v)` for each reserve). So covered may contain addresses not in owned — fine (coverage checks owned ⊆ covered ∪ named, presumably).

I can't see judgeRedemptionCoverage's source (bank/detectors.mjs not bundled), but the plan tests pass 122/122 including the coverage arms, and the suite's S6.11 checks detectUndeclaredTokenAccounts names the airdrop. OK.

**Now the V1 repair's `vaultWalletAccounts` more carefully:**

```js
const res = await accounts(conn, reserveAtas, 'your vault\'s reserve accounts')
```

`accounts` throws (ReadError) if the read fails. So if the reserve read fails, the whole function throws → the page refuses ("Could not read..."). Hmm — is that the intended behavior? The V1 repair says reserve accounts are read by address always; if THAT read fails (network down), the page can't proceed — fail closed. Reasonable.

But: `accounts()` reads in batches of 100 via getMultipleAccounts. 3 reserve ATAs → one call. If it throws → ReadError → check() catches → "Could not check this vault". Fail closed, retryable. OK.

The three getProgramAccounts in Promise.all; if ANY throws → catch → incomplete.unlisted set, return reserves only. Then the plan: pdaTokens = reserves only; strays unknown → unlisted:all box. The opening proceeds with just the reserves. ✓

Then the full reads of `take` (≤200): if that throws → incomplete.unexamined += take.length (all of want unexamined) → unlisted:n box. But note: the reserves were already read; the strays' balances were read in the slices but their full accounts weren't → they're not in `out` → the plan never sees them → they're covered by the unlisted box. ✓

Edge: `want` includes classic accounts with amount ≠ 0. Their 8-byte slice gave the amount, but the plan needs the full account (mint, close authority, state). Without it, they're unnamed except via the unlisted box. ✓

**A subtle one:** `t22plain` filters dataSize 165 Token-2022 accounts; `emptyPlain22` = those with amount 0. `want` includes t22all minus reserves minus emptyPlain22. So a 165-byte Token-2022 account with amount > 0 IS in want (read in full, then boxed as Token-2022 cannot-move). ✓ And a 170-byte one is in t22all (not in t22plain due to dataSize) → in want. ✓

**NFT read (coreAssetsOwnedBy):** Core getProgramAccounts (0-byte slice, owner filter) → addresses; DAS getAssetsByOwner → compressed + fallback. If both fail → unlisted. If addrs > 200 → first 200 read, rest unexamined. A CBOB vault found → ourVault → plan refuses (rescue first). ✓

Wait — in `coreAssetsOwnedBy`, the Core listing filters `[{memcmp offset 0 bytes [1]}, {memcmp offset 1 bytes owner}]` — AssetV1 (key 1) owned by the address. Then reads up to 200 accounts fully; for each: if burned or owner mismatch → skip; else push {address, ourVault: collection == COLL, name}. Note: unreadable → pushed with unreadable: true, ourVault: false. In the plan, unreadable → asset box (not refuse). But what if an unreadable NFT is actually a CBOB vault? It's named in a box ("lost when the vault is opened") — but a CBOB vault inside is RESCUABLE (item 58), and the page's rule is "a CBOB vault the page FINDS refuses; one it cannot read is a box". Hmm — the nfts:unexamined box text says "except a CBOB vault: anyone can then rescue it". The unreadable-individual box (`asset:${addr}` unreadable) says "This page does not move NFTs out of a vault, so it is lost when the vault is opened" — for an unreadable NFT that IS a CBOB vault, it's not lost (rescuable after). Minor copy imprecision, not a money path. The round 37 V1 repair's stated rule: "a CBOB vault the page finds nested inside still refuses; one it could not look for can still be rescued after the opening (item 58), so not looking is a box, never a refusal". An unreadable individual NFT is closer to "could not read" — and the rescue works after the host burns (host is burned → orphan branch). So no value is permanently lost. INFO at most; arguably within the stated rule. I'll note it as INFO.

Actually, let me reconsider: is it within the stated rule? The README (round 37 V1 repair): "A CBOB vault the page FINDS inside still refuses the opening (rescue it first). If the page cannot complete that check (both reads fail, for example a stranger's flood past the proxy's 8 MB cap, or more than 200 NFTs), it is ONE box". An individual NFT that parses as unreadable (parseCoreAsset throws) is neither "found" (its collection is unknown) nor "not looked for". The page read its account but couldn't parse it. The box says it's lost; actually if it's a CBOB vault it's rescuable. The holder is told it's lost when it isn't. That's a misstatement in an edge case — documentation-level, INFO, and it misstates... hmm, the SPEC gate 3 exception: documentation-only LOW/INFO that "misstate nothing about holder money, rights or program behaviour". This misstates what happens to a (possibly CBOB) NFT — it says "lost" when "rescuable". It's page copy. It overstates the loss (fails safe — the holder is warned MORE than needed). I'd call it INFO, borderline whether it even rises to a finding. Given the instruction to find faults and not praise, I'll list it as INFO with the precise scope.

Hmm, actually wait. Let me re-read the unreadable branch: `out.push({ address: take[i], unreadable: true, ourVault: false })`. And in plan-redeem: `else if (n.unreadable) ack.push({ id: asset:..., text: "...could not read... lost when the vault is opened." })`. The text: "The deposit address holds an NFT this page could not read (${n.address}). This page does not move NFTs out of a vault, so it is lost when the vault is opened." For a CBOB vault that failed to parse (e.g., a future Core plugin shape), it would be rescued by anyone after the opening. So "lost" is wrong for that case. But: can a CBOB vault fail to parse? parseCoreAsset throws only on malformed base fields; pluginsUnreadable is handled separately (doesn't throw). A CBOB vault's base fields are written by Core — always parseable. So a CBOB vault would never be unreadable through this path. The unreadable case is a non-Core... no wait, the account IS Core-owned (the listing filtered Core assets). A Core asset with corrupt base fields — shouldn't happen. So the case is nearly impossible, and even then the rescue saves a CBOB vault. Not a finding worth filing as more than a note. I'll fold it into "observations" rather than a formal finding. Actually, given "