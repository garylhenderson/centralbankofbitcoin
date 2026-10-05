# Round 25 — programs pass (five programs, suite, sim, build, docs)

**Scope note first, because it bounds everything below.** The bundle contains the five programs, `tests/3prog.test.ts`, `sim/test-vault.ts`, `sim/clone-pob.mjs`, `run-tests.sh`, `build-mainnet.sh`, the docs, the round-24 verdict and RT3. It does **not** contain `bank/crank.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `launch/check-launch-params.mjs` or the rehearsal scripts. Every claim below about those files is marked unverifiable rather than checked. Everything else I read whole and recomputed.

Verdict up front: **no CRITICAL. One HIGH (a permissionless redemption block that the round-24 sweep helper was built to prevent and does not cover), one MEDIUM (round 24's evidence repairs are partially landed while claimed done), and a tail of LOWs.** The pool arithmetic, the pairing, the raw offsets and the boost accounting all survived a full re-derivation; I state what I proved so the next reader does not redo it.

---

## R0 — Round 24's repairs

### R0-1. MEDIUM — The evidence-gap repairs are partially landed, and the repair summary says they are done

**Construct:** `tests/3prog.test.ts` and `sim/test-vault.ts` as bundled, against round 24's CONFIRMED list (C7, C8, C9) and this prompt's R0 summary ("C8: 3.1y and the weak arms").

What is in the tree:

- **C1** (BoostTermsMoved legs, favourable move, post-transfer owner): **landed** — BO.30 (weight down → refused, nothing burned), BO.30a (price down → lands at the new price), BO.31 (epochs down), BO.33/BO.33a (old owner `BoostNotTheOwner`, new owner ALLOW).
- **C2** (ring wrap through the program's own index): **landed** — BO.34–BO.34c buys at `epoch % 64 ≥ 55` with 10 epochs so `end % 64` wraps, drives `boost_vault`'s inline index, and checks due-at-`end` and the books. One residual, see R0-3.
- **C3** (five-kind execute): **landed** — E.7/E.7a vote and execute it with CU recorded. The comment half is R0-2.
- **C5** (sim boosts): **landed** — S7b.0–S7b.4, a real 21%-quorum terms vote, one boost, due, expiry, weight back.
- **C6** (captures actually ran): **landed** — 10.6 now asserts `wide.cu ≥ base.cu + 4×100,000` and the `unset` clause is gone.
- **C7** (RL.7 per-redemption caps): **NOT landed.** RL.7 still bounds every window by `capMax` computed from the largest live supply there has ever been (`minted_total`), exactly the loose bound round 24 confirmed; the disclosure note is still the only mitigation.
- **C8** (weak arms): **only 3.1y landed.** P.11a still derives both `want` and `got` from `picks`, so it passes vacuously when `picks` is empty and cannot fail on "fewer than 5 picks" — round 24's named fix. 3.7 is still pinned to `custom program error: 0x9` with no decoded-state note. S7.4 still accepts any `0 < paid ≤ avail`. 5.2's and 10.2's titles are unchanged. S7.2! still accepts either `NoActiveVaults` or `JoinWaitingFirst`.
- **C9** (unexercised orderings): **only the duplicate-pair arm landed** (BO.32, correct). Absent: crank-and-pairs naming the same record; an expiry plus a frozen destination yielding `ClaimDeferred` at the boosted amount; two paired redemptions landing in one transaction at cap ≥ 2 (the suite runs at cap 1 in 4.9; the sim's S10.1 sends three *separate* transactions); an older `TightenSweep` executed after a newer one; `books()` after the money operations in sections P, IN and 3c (it runs only in BO).

**What is gained:** nothing directly, but the ship gate's premise — "every confirmed finding has a gate that fails the build" — is false for C7/C8/C9, and the floor (774) matches the tree that contains only some of the promised arms, so the omissions are invisible to every gate. Round 24's verdict is bundled as "what was done"; a later reader will believe the arms exist.

**Evidence if I am right:** the arms listed above are greppable in the bundled files and are not there; `MIN_ASSERTIONS=774` equals the count of the tree that lacks them.

**Fix:** land the missing arms (they are all in `tests/`/`sim/`, so they reset the freeze counter — batch them with anything else), or amend the round-24 record to say which C7/C8/C9 items were declined and why. Do not leave the prompt's repair summary claiming them.

### R0-2. LOW — The maximum proposal is SIX CPIs, not five; round 24's C3 verdict miscounted it and E.7 does not measure it

**Construct:** GOV `execute_proposal`, the `Brakes` arm. A single `Brakes { set_guardian: true, restart_sales: true, .. }` pushes **two** entries into `calls` (`IX_ARM_GUARDIAN` and `IX_RESTART`). Five actions therefore execute as up to **six** CPIs. Round 24's verdict called "six CPIs" impossible ("a guardian change and an operator arm cannot share a proposal, so the maximum is five") — that confuses the guardian/operator exclusion with the guardian/restart pairing, which is legal (`EmptyAction` passes, `KeyChangesBundled` does not fire).

**What is gained:** the widest execute shape (a key-change proposal that also restarts a stop, plus three other actions) has never run. It is also the shape most likely to hit a compute or packet edge, because it is the one with the most CPIs and it needs `KeyChangeNeedsHalf`.

**Evidence if I am right:** build a five-action proposal whose `Brakes` carries `set_guardian: Some(k)` and `restart_sales: true` and execute it; the transaction contains six `invoke_signed` calls into MINT. E.7's proposal uses `actBrakes({sales:true})` — one CPI from Brakes, five total.

**Fix:** add the arm; correct the comment on `MAX_ACTIONS` to the true maximum (six CPIs from five actions) whichever way it currently reads — if it was "fixed" to say five per round 24's instruction, the fix introduced the error round 24 thought it was removing.

### R0-3. LOW — C2's wrap arm does not exercise `unschedule_boost`'s ring path at a wrapped index

**Construct:** MINT `unschedule_boost`. BO.34's boost is expired through the **due** path (`dist_epoch >= boost_end_epoch` → decrement `boosts_due`). The **ring** path (`boost_expiring[end % 64] -= 1`) is exercised only by BO.16's retire-before-due, at a non-wrapped index. The expression is identical, so this is an evidence gap, not a suspected defect.

**Evidence if I am right:** no arm in the tree retires a boost whose `end % 64` wrapped before any distribution reached `end`.

**Fix:** one arm: buy a wrapped-end boost, bare-burn and `retire_burned` it before due, assert the ring slot fell and `books()` holds.

### R0-4. LOW (unverifiable) — A6's residual: the alarm's program-hash baselines

The bundle contains no off-chain alarm code. If `bank/detectors.mjs` pins a deployed-byte hash for MINT (the way it pins Core's), the line-shift rebuild changed MINT's bytes and the baseline must be re-pinned or the alarm pages forever. `build-mainnet.sh` has no stale hash (it rebuilds and prints), and no suite arm or `because` pin is keyed to a source line (all source reads are regex-based). **Check the alarm's baseline file against the new sha256 before the rehearsal.**

The doc repairs (A1–A4, D1, D2, D4, D8) all landed in HOLDER-GUIDE/SPEC/DESIGN as claimed; I verified each sentence against the code (see R8 for the two that are still not true).

---

## R1 / R1s — Custody and the sweep helper

### R1-1. HIGH — A permissionless, ~0.002-SOL-per-vault redemption block the sweep helper cannot touch: the Token-2022 ATA of a classic reserve mint

**Construct:** BURN `burn_vault`'s reserve loop derives, for **every** reserve mint, the ATA under **both** token programs (`[pda, SPL, mint]` and `[pda, TokenzQd…, mint]`), requires both declared, and refuses any declared token-program-owned account whose length is not exactly 165 (`ReserveHasExtensions`). The sweep helper `programs/cbob-vault-sweep/src/lib.rs` `read_token` refuses any account not owned by classic SPL (`IllegalOwner`), so it can neither transfer nor close a Token-2022 account. The redeem page (item 50's obligations) has no Token-2022 path.

**The attack:** the ATA program creates Token-2022 ATAs with the `ImmutableOwner` extension — 170 bytes, never 165 (the project itself measured this, SEAL's `assert_classic_spl` comment). ATA creation is permissionless and needs no signature from the owner (vaults' own reserve ATAs are created the same way). Token-2022's `InitializeAccount` does not verify that the mint is owned by Token-2022 (the mint is only copied in as a pubkey; this is the one link in the chain I could not settle from the bundle, see the evidence below). So a stranger runs, for any vault PDA and any of the three classic reserve mints:

```
createAssociatedTokenAccountIdempotentInstruction(attacker, ata(vaultPda, mint, TOKEN_2022_PROGRAM_ID), vaultPda, mint, TOKEN_2022_PROGRAM_ID)
```

The account lands at exactly the address BURN derives. No deposit is even needed — the 170-byte length alone trips `ReserveHasExtensions`. The vault's redemption is refused. The owner's only remedy is a hand-built Core `ExecuteV1` carrying a Token-2022 `CloseAccount` (possible on chain — Core's Execute permits arbitrary instructions and the PDA is the account owner — but built by nothing, and the account can only be touched while the asset is unfrozen, i.e. inside a redemption whose burn is being blocked by that very account; the owner must fold the close into the same custom transaction). The attacker re-creates the account after every close for the rent (~0.002 SOL), which the owner recovers on close — a funded war of attrition the attacker wins whenever the owner is not a developer. For a normal holder the vault is **permanently unredeemable**.

**Why this is the round-24 repair's hole:** the helper was built to close exactly this class (a stranger's cheap deposit blocking an opening) for every account it names. It closed the classic case and left the Token-2022 case, which is the one case where the blocking account *cannot be swept by anything built*. Note also that this is not limit 44 (undeclared holdings destroyed): the T22 derivation is an account BURN *requires declared*; it does not die silently, it halts.

**Why the check is dead code for its intended purpose:** SEAL's `initialize` refuses any reserve mint not owned by classic SPL Token. No legitimate flow ever creates a Token-2022 account for a reserve mint. The T22 derivation in BURN's loop can only ever be satisfied by an attacker (or a holder who went out of their way), so the check's only live effect is the griefing handle.

**Evidence if I am right (all of it is one afternoon):**
1. Send the `createAssociatedTokenAccountIdempotent` above on a validator. If it lands and the account reads: owner `TokenzQd…`, length 170, mint = cbBTC, owner-field = the vault PDA — the vector is confirmed. If Token-2022 refuses the classic-owned mint, the vector dies, and the finding reduces to "BURN's T22 derivation is dead code" (still worth knowing).
2. Attempt the vault's redemption through the helper: it reverts `ReserveHasExtensions` at the burn (or `ReserveNotDeclared` if the page omits the account).
3. Call the helper naming that account as a source: it reverts `IllegalOwner` at `read_token`.
4. The suite's `declare()` passes both derivations as accounts that never exist — no arm in the tree has ever created one, which is why 24 rounds missed this.

**Fix (pre-launch; nothing is deployed):** drop the Token-2022 derivation from BURN's reserve loop — reserve mints are classic by SEAL's own config, so the derivation can never be the vault's canonical account — or skip T22-owned accounts whose length ≠ 165 in that loop. Either way, add the arm: create the T22 ATA, redeem, land. If the project prefers to keep the check, then the helper must learn Token-2022 (transfer + close) *and* the page must name T22 pairs — but the page cannot name accounts that may not exist (the helper refuses non-token sources), so the race remains; the BURN-side fix is the robust one.

### R1-2. LOW — The two non-cbBTC reserve mints' freeze authorities are never checked

**Construct:** limit 28 accepts Coinbase's freeze authority over cbBTC. $GARY (`8c71Av…`) and $GIRAFFISH (`Gq7eEn…`) are also reserve mints: a live freeze authority on either can freeze any vault's account for that mint, which blocks that vault's whole redemption (the helper's transfer from a frozen source fails; BURN requires the account empty). The probe asserts the reserve mints are classic SPL; nothing in the bundle asserts their freeze authorities are `None`, and no document rules on accepting one.

**Evidence if I am right:** `getAccountInfo` on each mint; byte 6..38 of the mint is the freeze-authority COption. If either is `Some(..)`, the consequence is limit 28's for a mint nobody has ruled on.

**Fix:** one probe line asserting both are `None` (a mint's freeze authority cannot be added later, so it is a static fact), or a sentence in limit 28 naming whoever holds it.

### R1-3. LOW — The redemption's compute and byte margin are unmeasured; S8.0 omits what a real page adds

**Construct:** `sim/test-vault.ts` S8.0 measures `[open, claim, Execute(helper, 3 pairs), burn]` and asserts ≤ 1232 bytes. It includes no compute-budget instruction, and no arm anywhere records a redemption's `computeUnitsConsumed`. The sim's S8.1 *landing* proves the three-asset redemption fits the default 200,000 CU budget — but with an unknown margin, and SPEC's "Known limits" entry still says "Not yet measured: its arms, and the byte and compute fit" (the arms and the bytes are now measured; the compute is not; the entry is half-stale).

**Evidence if I am right:** add `meta.computeUnitsConsumed` to S8.1's record and a CU-budget instruction to S8.0's measurement; if the total is within a few thousand of 200,000, the page rule ("set the limit or send none") needs a number to rest on, exactly as item 54 did for the crank.

**Fix:** record the redemption's CU and the byte headroom with and without a compute-budget instruction; move the number into item 50's obligations.

### What I proved sound in R1/R1s (so the next reader need not redo it)

- **The pairing.** Both halves bind asset *and* owner, walk top-level instructions only, and fail closed. The wrapper shapes are refused for the pinned reasons (WR.1–WR.4): a wrapped burn reaches MINT at stack height 3 (`NotFromBurn`); a wrapped open is invisible to SEAL's forward walk (`NoTerminalBurn`); a genuine open plus wrapped burn fails at the open. A post-thaw `TransferV1` of the asset cannot survive: the burn's owner binding would fail, reverting the thaw. Two vaults in one transaction cannot lend each other halves (3.9/3.10/4.10/9.0).
- **The helper's authority model.** Direct calls need the asset-signer PDA's signature (impossible); through Core, `ExecuteV1` is owner-only, and the vault is born frozen with `PermanentFreezeExecute` authority = SEAL's PDA, so the helper is reachable only between a genuine `open_for_redemption` and its paired burn — inside a redemption. Update authorities, collection authorities and the plugin authority cannot Execute. The destination wallet is the transaction builder's choice, and the only builder Core admits is the owner.
- **The pair list.** Duplicate source → the second read fails on the closed (System-owned) account — self-grief only. Source-as-destination is impossible (different owners, `signer ≠ dest` enforced). wSOL sources work (transferred as wrapped SOL, rent to the wallet). Delegates and close authorities on sources do not block the owner-authority transfer or close. A frozen source blocks (limit 28, stated). Odd lists refused, zero pairs = lamports only. Non-ATA destinations are allowed and harmless (owner's choice). `dest` = the signer is refused; another vault's signer is the owner's choice.
- **The lamport sweep.** `signer.lamports()` is read at execution; nothing in the redemption writes the PDA afterwards (the claim is a token transfer, the open a Core plugin update, Core itself moves nothing); BURN's `lamports == 0` sees exactly what the sweep left. The close sends rent to the *wallet*, not the PDA, so it cannot re-nonzero the PDA. A below-rent or program-owned destination does not fail the system transfer in a way that matters (the owner chooses `dest`; worst case is their own weird choice).
- **The closed account passes BURN for the right reason:** the helper closes what it empties; a closed account is System-owned, and BURN's reserve loop skips non-token-program owners. A never-created ATA is likewise skipped — which is why SPEC's prior-transaction step (create the vault's missing reserve accounts so the sweep can name all three) is the correct and necessary close of the classic-mint race: after it, every classic account the attacker can touch is one the helper sweeps live.
- **The helper's byte identity.** The sweep crate has no `localnet` feature (commit 2b67fb1), so the workspace's `--features localnet` build compiles it identically to the mainnet build; `build-mainnet.sh` `cmp`s the two `.so`s and refuses on difference; the suite deploys from the same tree. The tested bytes are the shipped bytes. Verified by reading, not by trust.

---

## R2 / R2b — The community pool and the $CBOB boost

**No new defect found. I re-derived the invariants; stating them so they are checkable:**

- **Solvency, exactly.** By induction, `owed_scaled == Σ active vaults pending_v` holds through `join` (pending enters at 0), `credit` (each vault's pending grows by `w_v·δ`, the total by `δ·W`), `claim` (both sides drop `pay·SCALE`; the frozen-destination skip drops neither), `reweigh` (pending preserved into `carry`), `retire` (both sides drop `pending`, forfeit included) and `expire_boost` (a `reweigh`). Since `δ·W ≤ avail·SCALE` and `avail = balance − ceil(owed)`, `ceil(owed_new) ≤ balance` after every credit; claims pay `Σ floor(pending_v) ≤ ceil(owed) ≤ balance`. The pool can never be short. `PoolShort` is unreachable by construction.
- **Counters.** `join` requires `dist_epoch > request_epoch`, so a joining vault is never in `pending_this_epoch`; `advance_epoch` zeroes `pending_this_epoch`; `retire` decrements both counters correctly for same-epoch and earlier-epoch requests (F21). `waiting_to_join = pending_count − pending_this_epoch` is consistent under every ordering I tried, including retire-while-waiting, join-inside-claim, and the monthly running inside `activate` before a request is stamped.
- **Liveness.** Every gate (`JoinWaitingFirst`, `BoostsExpireFirst`, the empty tick's `pending_this_epoch > 0`) is clearable by a permissionless instruction that needs no vault token account (`expire_boosts` needs records only; joining is a claim that names the vault). A retired vault's due boost is unscheduled by `retire` itself, so a dead record cannot hold `boosts_due` hostage.
- **The boost.** A boost bought at epoch `e` for `n` earns exactly the `n` distributions that advance the epoch to `e+n` and is due at `e+n` (`BoostsExpireFirst` makes the expiry exact). Ring collisions are impossible in the harmful sense: the slot at `end % 64` is cleared by `advance_epoch` when the epoch reaches `end`, and a same-epoch same-length pair increments a count, which the ring handles. `reweigh` preserves the owed share bit-for-bit; nothing earned is lost or gained across boost, expiry, claim normalisation or retire. `boost_vault` while another vault's boost is due is harmless (the new boost's clock cannot start until distributions resume).

**One behaviour worth writing down (LOW, doc precision):** the first *crediting* monthly distribution lands up to **60 days** after the charter closes, not 30. The month becomes due at `charter_closes + 30d`; with nobody joined it can only tick (crediting nothing, stamping the clock); the waiting cohort joins; the next monthly is due at `+60d`. Anyone can pull it earlier with a 100 $GARY burn. The holder guide's "a payout is due every month" does not say when the first one is.

---

## R3 — The level draw

**No new defect.** The SlotHashes parse is defensive and fails closed (id, length, count ≤ 512, buffer bound, zero-hash refused — host-tested both ways). The window arithmetic is sound: A ≤ `reveal_slot+64`, C ≤ `reveal_slot+208`, all inside the 300-slot window and the 512-slot buffer, so an in-window capture always finds A. The FIFO is strict (`revealed_total`), a burned vault at the head still draws (the Core write is skipped, the census advances), the attribute re-supply is hash-checked, and the reschedule target is a slot that does not exist when it lands. What a minter, a crank operator or a slot leader can influence is exactly limits 25 and 26, and SPEC 26's round-24 wording ("chooses among many draws", the cohort effect, best-of-4 at 18.6%) now matches the code's `blockhash_in_window` (smallest produced slot in `[want, want+64]`). The holder guide's honest-list paragraph is true of the code.

---

## R4 — Governance

Beyond R0-2 (the six-CPI maximum), **no new defect.** The electorate is frozen at creation (index snapshot, live-supply divisor, tally rule copied into the proposal); a burned vault cannot vote (the tombstone fails `read_core_asset`); the vote is bound to the asset across transfers; key changes need half of all live vaults and never share a proposal with an operator arm; the tighten is monotone and bounded at both creation and execution; overtaken actions are logged skips; a whole-proposal-of-skips still marks executed. A minority's reach is exactly the documented concentration (10.71% YES minimum at the ruled numbers; the top three PoB holders can carry a key change if ≥24.2% go unclaimed — stated). Nothing reaches the split, the destinations, `max_supply`, a vault, or the reserve list.

---

## R5 — The charter claim

**No new defect.** Identity is by address against a domain-separated, sorted-pair Merkle root of the 240 committed addresses; the PoB is CPI-burned as its owner in the same instruction; the window is clock-only and cannot reopen; the claim ignores the sales stop per the ruling; `pob_extra` accounts are passed through never as signers and Core decides their meaning (a rejecting hook still rejects — the ruled limit). SPEC 46 is now complete for the hot wallet's powers, including the asset-level-plugin brick of *individual* claims (the round-22 note that the alarm watches the collection, not the 240 assets, is retained). I could not construct a hot-wallet, holder or third-party action it omits.

---

## R6 — One-time configuration and the trusted hop

Beyond R1-2 (freeze authorities), **no new defect.** Every `initialize`'s accept/refuse set matches SPEC; the residuals (SEAL reads only owners, off-curve keys accepted, `redeem_window_secs` 10 s–24 h, the checker validates the JSON not the transaction) are round 24 A6's, still open under item 38. The swap operator's worst case is as limit 10 states: cap × cooldown windows until the guardian stops it, bounded by the revenue PDA above the reserve, with the round-24 swap now signing only self-built transactions against pinned pools (the swap code itself is off-bundle; I take the off-chain pass's word and mark it unverified here). The 10% royalty with plugin authority `None` is proven immutable in both directions (R.1–R.6c). The redemption cap is exactly a ring of the last 64 redemption times with the cap-th most recent required a full window old; I re-derived `kth = ring[(head − k) mod 64]` against the write order and it is correct, the cap is `ceil(live·210/10000)` floored at 1, and past live supply 3,047 the limit is stricter, never looser.

---

## R7 — Cross-program raw reads

**All recomputed from the struct definitions; all correct.** MintConfig v6: version 8, collection 9, governance 41, pool_ata 73, minted_total 141, sales/sweep stopped 191/192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, charter_closes 442, bare_burns_retired 454, stop times 518/526, pending operator 534, monthly 574, pending guardian 582/614/615, notice 623, tighten bounds 631/639/647, dist_epoch 655, pending counts 663/671, cbob 679, boost bounds 711/712, boost terms 714/722/723, boost counters 725–749, ring 749–1005; struct 997 bytes, space 1261 — the space formula sums correctly. VaultRecord v4: index 41, level 57, active 125, retired 126, ata 129, debt 161, pending 177, request_epoch 178, boost 186/187, carry 195; 221 bytes, space 221. BurnConfig v4: burned_total 42, window 50, head 58, ring 59; space 827. SEAL Config v2: collection 9, reserves 41. GOV's 14 pinned reads and BURN's two all fall on these numbers. The token-account offsets used by MINT, BURN and the helper (mint 0, owner 32, amount 64, delegate COption tag 72, state 108, delegated_amount 121, close-authority tag 129, length 165) match the classic SPL layout including the u32 COption tags.

---

## R8 — The suite, the simulation and the build as evidence

- The partial-repair items are R0-1. The T22 blind spot (no arm has ever created a Token-2022 account for a classic mint) is R1-1's evidence gap. The redemption CU gap is R1-3.
- One more small gap: the helper's *source*-refusal (`CBOB_SWEEP refused: source … is not the vault's`) has no arm — SR.2 pins only the destination refusal, and SR.1 dies at the signature check before reaching it. A through-Core arm naming a foreign token account as a source would pin it. LOW.
- The suite's reason pins I spot-checked (0x9 for Core's authority refusal, 0x1a for `NoApprovals`, 0xb for the close-with-balance, the derived `RateLimited` code) match their named reasons.
- The build's five-program identity, the dirty-tree refusal, the pinned Core hash and the behavioural INIT_AUTHORITY proof are all as claimed and correctly scoped (the banner's "NOT PROVEN" paragraph is honest).

---

## The four questions about the accepted limits

1. **Is any limit WORSE than stated?** Two candidates. **Limit 44's framing is incomplete in a way that matters:** it says anything the burn is not shown "dies with the asset" — but the Token-2022 derivation of a reserve mint is an account the burn *requires shown*, and it does not die, it **blocks** (R1-1). That is a different and worse consequence than the accepted one, at an attacker cost the accepted list does not price. **Limit 28's class is wider than its wording:** it names Coinbase/cbBTC only; the other two reserve mints' freeze authorities are unchecked (R1-2). Everything else I attacked — 25, 26, 32, 34, 35, 41, 42, 43, 45, 46, 47, 55, 56 — is stated no worse than the code.
2. **Is anything listed as a limit not actually a limit?** No. I specifically tried to close 43 (off-curve owners) and 42 (prior-transaction ATAs) and could not.
3. **Is any DISCHARGED item not actually discharged?** Item 54's "measured" does not cover the redemption path at all (R1-3) — its live half binds item 50, and item 50's obligations have no compute rule for the redemption. Items 51, 12/17, 14, 19, 30, 31, 33 are genuinely discharged.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No — 22, 38, 50, 52, 53 are all still open and still named. Two staleness notes: item 50's text says the sweep helper "is being built" (it is built; the *page* is the open part), and SPEC's "Known limits" sweep entry says its arms and byte fit are "not yet measured" (they now are; the compute fit is not).

**Two holder-guide sentences that are still not true of the code** (beyond item 50's known class): "Activation is picked up automatically" and "Your level is drawn for you a few seconds after you get your vault" both depend on the crank being armed `--live` — it is installed DRY-RUN, and no road step or ship-gate item arms it. Without it, entropy is captured by piggybacked traffic but nothing *reveals* (only the crank sends `reveal_level`), so the FIFO stalls, no vault activates, and no payout can run. Add "arm the crank" to the launch checklist (road step 10) or soften the guide. Also "the Bank's pages show it" (the deposit address) is present tense about a surface no OPEN item lists. Both LOW.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run the measurements, do not read about them.** Every finding above marked "needs a measurement" (the Token-2022-for-classic-mint creation, the two freeze authorities, the redemption's CU margin) is one transaction each on a validator. This process's own history — a third of CRITICALs wrong on measurement — says the marginal value of one more reading pass is near zero and the marginal value of one executed test is absolute. Convert each result into a suite arm (ship gate 5) so it can never silently flip.
2. **Fund an adversary and give it weeks.** The defects that survived 24 rounds are the ones that need an attacker's patience: the T22 creation war, the reschedule races, an oracle flipped between two transactions, a griefer paying fees across a slot boundary. Deploy the rehearsal tree (item 53), put small real value in it, and pay a human red team — or run a funded bot — to attack it continuously for at least the length of one full monthly cycle. AI audit reasons about attacks; it cannot *conduct* one over days.
3. **Verify the operational facts by hand, because no reader of this bundle can.** Before the charter opens: the crank's crontab line is `--live` (two holder-guide promises are false until it is); a test CRITICAL actually arrives through the alert router and a human sees it; the $CBOB release wallet's key exists in exactly one place and the backup restores from it; the swap operator wallet holds nothing but the cycle's funds and its 0.02 SOL float is topped up; the alarm's MINT hash baseline (if one exists) matches the post-line-shift bytes.
4. **Have a non-expert human read HOLDER-GUIDE.md against the product.** The remaining false sentences are all of one kind — present tense about surfaces that do not exist ("the Bank's pages show it", "the redeem page offers this", "every opening is announced on X"). Experts gloss over tense; a careful lay reader does not. Either the pages ship before the guide does, or the sentences change.
5. **Have Gary personally compare the four initialize transactions' arguments to `launch/mainnet-init.json` at signing time.** The checker validates the JSON, not the transaction (round 24 A6); the programs check less than the checker; the only bridge left is a human eyeball at the moment of signing, on values that are permanent the day the upgrade authority goes.
6. **Exercise the calendar at least once at real durations.** The 7-day notice, the 3-day vote, the 30-day month, the 7-day execution window and the 64-entry ring at a real 2.1% cap have only ever run at minutes. The arithmetic is the same; the calendar interactions (a charter window straddling a month boundary, a notice expiring inside a vote) are not. One rehearsal at full durations, even with throwaway value, is the only way to see those.
7. **Decide R1-1 before the lock, not after.** If the measurement confirms the Token-2022 vector, BURN must change, which resets the freeze counter and the two-clean-round clock. That is a cheap decision today and an impossible one the day after the upgrade authorities are removed — which is the one fact this entire process exists to respect.