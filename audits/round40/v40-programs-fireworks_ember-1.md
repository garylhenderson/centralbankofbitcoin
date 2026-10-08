# Round 40 audit — independent verdict

Scope read whole: the five programs, the bundled off-chain files, `web/` (pages, libs, proxy, ceremony, metadata), the suite, the simulation, the scripts, SPEC/DESIGN/HOLDER-GUIDE, and round 39's two verdicts plus VALIDATION. I recomputed every cross-program offset and account space from the struct definitions, re-derived the pool invariant operation by operation, re-walked the redemption pairing, and re-read the round-39 repairs at their sites rather than trusting the verdict's description of them.

**Result: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW (redeem page, message precision, no value at risk), 1 INFO. Round 39's two repairs hold at their sites; I found no regression from them and no surviving defect in the five programs.**

---

## R0. Round 39's verdict and its repairs, independently re-tested

**V39-1 (MEDIUM, promised stray silently dropped at the press) — repair verified present and correct.**
- `web/src/lib/reads.mjs` `vaultWalletAccounts(conn, owner, reserveMints, promised)`: the promised addresses are merged into the by-address read (`byAddress = [...new Set([...reserveAtas, ...promised.slice(0, PROMISED_MAX)])]`) which goes through `accounts()` → `wrap()` → **throws** on RPC failure. So a failed re-read stops the press before any dry run, as the repair claims.
- `web/src/lib/plan-redeem.mjs`: `if (s.known) for (const k of s.known) if (!s.pdaTokens.some(t => t.address === k)) cannot.push({...})` produces a `lost:<addr>` box for a promised account that is now missing. In the consented branch, `aboutKnown(a)` (`s.known.has(addr)`) is true for it, so it is **not** demoted; it stays in `ack`, so `prepareOpening` returns `stop: 'ack'` and the holder is asked once, by address. A promised stray that still exists but is now frozen, or whose receiving account is now frozen, lands in `cannot` via the existing paths and likewise stops the press. A promised stray now holding zero is dropped silently, which is correct (nothing to lose).
- The "Arrived after your check" heading is fed only from `lateInfo`, which is filtered by `s.seen` (everything present at the check). An item present at the check cannot be labelled a late arrival. Verified against the code, not the verdict's prose.
- PROMISED_MAX (100) cannot be exceeded in practice: `known` is built from the post-trim `helperStrays`/`transferStrays`, which the packet-fit loop bounds to a handful of pairs.

**V39-2 (LOW, a nested CBOB vault refused the opening) — repair verified present and correct.**
- `planRedemption`: a nested `ourVault` is never a refusal. At the check it produces an `optional` prior group (`rescueNested(vault, host=asset, bank_treasury, owner)`) plus a note; at the press (`s.noPrior`) it produces `pressInfo` only. The coverage cross-check cannot re-refuse it because `named` includes the ourVault addresses.
- `redeem.mjs`: an optional group's dry-run failure is a note and `continue`; its send failure is caught and noted; the opening proceeds either way. The rescue targets the live host, which MINT's `rescue_nested` accepts; after the opening the inner vault is rescuable from the burned host (the orphan branch). The e2e claim in VALIDATION (120/120 including nest-before-press) is consistent with the code path I read.
- No new hole from the repair: the holder pays only the rescue's fee, signs only what the page built (`signExact`), and can reject the optional step.

**Round 39's disproved claims, re-tested:**
- W1 (txread rejects T22 `transferCheckedWithFee`): the verdict's disproof is correct. `bank/txread.mjs`'s amount check is gated on `['transfer','transferChecked','approve','approveChecked'].includes(kind)`; `transferCheckedWithFee` is not in the list, so it is accepted. The verdict's measurement stands.
- W2 (a delegated classic stray cannot be swept): correctly disproved. SPL Token's owner retains transfer/close authority while a delegate is set; suite arm 3.3a (delegate planted, then owner transfer+close through the helper) is a measured ALLOW, and 3.3 pins the BURN-side `ReserveDelegated` refusal separately.
- A4 (seven arms without `because` pins): true as stated, but not a gap in reason-pinning — R31.W1a, R31.W1b, R28.A2, R32.A22a, R33.G3, R35.N8a and OR.5! all pin their reasons inline in the `rec()` calls (runtime message, 0x28, 'oom', 0x1a, 0x1b, 0x1a/0x1a/0x1b, Core's refusal). No action needed.
- A2 (`RELEASE_COMMIT` still `0b3ddb3`): correct and fail-closed; the programs are unchanged since that build, and any program change makes the web build refuse.

**Coverage boundary I must state:** `bank/detectors.mjs` (which `judgeRedemptionCoverage` and `classifyPdaTokenAccount` live in), `bank/crank.mjs`, `bank/selftest.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/alarm.mjs`, `scripts/check-launch-params.mjs` and `web/test/*` are not in this bundle. I verified the *call sites* and interfaces in `web/`; the internals of those modules are outside what I can re-audit this round, exactly as round 39's programs verdict noted for itself.

---

## R1 / R1s. Custody and the sweep helper

I attacked the pairing, the emptiness proof, and the helper's pair rules. No surviving defect.

- **Pairing.** SEAL's forward walk and BURN's backward walk both bind asset (account 0) and owner (account 2), both see top-level instructions only, and `retire_redeemed` demands stack height `TRANSACTION_LEVEL_STACK_HEIGHT + 1` plus the current top-level instruction being `burn_vault` for the same asset. The wrapper shapes are measured refusals (WR.1–WR.4). Two-vault interleavings pair correctly and the rate limit refuses the excess (4.9, 4.10a, S9b). A mid-transaction transfer of the vault just fails the redemption (`NotTheOwner` at the burn). A thawed vault cannot leave a transaction unburned: the open refuses without the later top-level burn, and the transaction is atomic.
- **Helper access control.** Direct call needs the asset-signer's signature, which only Core provides; through Core, `ExecuteV1` on a thawed vault approves only `authority == owner` (SR.5/5a/5c/5d measured against the pinned binary), and the seal refuses Execute while frozen (3.7, S6.2). The helper is reachable with vault value only inside a genuine open, which requires the terminal burn.
- **Pair rules.** Same source twice: the second read hits a closed (system-owned) account → `IllegalOwner` (SR.12a pins). Source==destination is impossible (`to_owner == dest`, `signer != dest`). A destination that is another vault's asset-signer is the owner's own choice of destination wallet; the helper's authority is the owner regardless. A wSOL source closes correctly (rent only; the lamports move with the amount). A kept close authority reverts the close and the whole opening (R36.C5), which is why the page uses a plain transfer for those. A frozen source with a balance reverts at the transfer (SR.14); a frozen *empty* source closes (measured round 30, limit 44).
- **Lamport sweep vs BURN.** The helper moves `signer.lamports()` read at execution; the closed accounts' rent goes to `dest`, not the signer; nothing runs between the Execute and the burn in the page's shape; SR.4a accounts for every lamport. BURN's `lamports == 0` sees exactly what the sweep left.
- **BURN's emptiness proof vs the helper.** A closed reserve account is found by the declaration search and skipped by the owner check (`acc.owner != SPL_TOKEN_ID && != TOKEN_2022_ID → continue`) — it passes for the right reason. A missing reserve ATA (never created) loads as a system-owned empty account and is skipped; a stranger who creates one *with dust* between the prior transaction and the redemption makes BURN refuse `VaultNotEmpty`, which is why item 42's prior transaction exists. A Token-2022 ATA for a classic mint cannot be created (F4.2 measured). A declared Token-2022 stray would refuse (`ReserveHasExtensions`), but the page never declares strays.
- **Observation (not a finding):** the page skips empty classic strays (`if (t.amount === 0n) continue`), so their rent (~1.5M lamports each) is stranded behind the burned PDA rather than recovered to the holder via the helper (which does close empty accounts). The loss is the stranger's who funded the account, never the holder's. Noted only because the helper could recover it.

## R2 / R2b. The pool and the boost

I re-proved "pool ≥ ceil(owed)" per operation: `credit` adds `delta*w ≤ avail*SCALE` to `owed_scaled` with the balance unchanged; `claim` pays `pay` and subtracts exactly `pay*SCALE` from `owed_scaled`, so `balance−pay ≥ ceil(owed)−pay = ceil(owed−pay*SCALE)`; `join` enters at `debt = w*acc` (owed contribution 0); `reweigh`/`expire_boost` preserve owed through `carry`; `retire` subtracts the vault's full pending (redeemed, forfeited, or bare-burned) with the balance unchanged; `split_revenue` only adds. Nothing else can move pool funds — the config PDA signs only in `claim`. The invariant holds.

- Counters: `pending_count`/`pending_this_epoch` are decremented in `retire`'s pending branch with the same-epoch guard (F21.1/F21.2 pin both); `waiting_to_join` cannot underflow (`checked_sub`); `advance_epoch` zeroes `pending_this_epoch` and drains the ring slot; `unschedule_boost` picks the due vs scheduled branch by `dist_epoch >= boost_end_epoch`, and both branches are exercised on chain (BO.16, BO.17, BO.38) and across four ring wraps in the host test driven through the program's own functions.
- Liveness: a due boost cannot block distributions forever (`expire_boosts` is permissionless and needs only records); an eligible waiter cannot block them either (a `claim` joins it without touching its token account, so even a frozen account joins); a vault's recorded ATA cannot be closed while sealed (only the vault PDA could, only through a thawed Execute, which retires the record). No distribution-blocking grief survives.
- The boost earns exactly N distributions: `BoostsExpireFirst` gates both `distribute` and `monthly_inline`, expiry is exact at the accumulator its last distribution left, and the buyer's-terms check is one-sided by ruling (BO.26/BO.30/BO.31 pin the three against-legs; BO.30a pins the favourable landing).

## R3. The level draw

`blockhash_in_window` pins the sysvar, bounds the count, checks the buffer, takes the smallest produced slot in `[want, want+64]`, and refuses an all-zero hash; the host tests cover skipped slots at A, B and C against an independent model. The FIFO (`index == revealed_total`) removes order choice; a burned vault at the head still draws (L.11); a lapsed window is rescheduled to a future slot, never defaulted. The residuals are exactly accepted limits 25 (public-hash re-roll needs total silence for the window) and 26 (C's leader chooses among many draws, cohort-wide), and HOLDER-GUIDE's honest list states both in plain terms. Nothing worse than stated found.

## R4. Governance

Quorum is ceiling-computed against the snapshot and never zero; threshold, the 10% turnout floor, and the 50%-of-live key-change bar are all enforced at execute; the electorate is frozen at creation (`index_snapshot`, `VaultTooNew`); a guardian change and an operator arm cannot bundle; both land only after `notice_secs` via a permissionless apply; the guardian can cancel only a pending operator, never its own replacement; an overtaken action is a logged skip, and the per-kind marks move before the over-check (3c.R1). GOV's mirrored constants (price floor, round length, rent floor, tighten bounds, boost bounds) are pinned against MINT's source in the suite (3c.M1, R35.C3). A minority carries nothing it should not; the freeze-forever case is limit 47, accurately stated (permanent only below half of live vaults voting to replace).

## R5. The charter claim

The Merkle scheme is domain-separated (0x00/0x01) with sorted pairs and a 16-element bound; `scripts/pob-merkle.mjs` matches MINT's `merkle_leaf`/`merkle_root_from` byte for byte and the suite proves the program accepts this module's proofs. The PoB is checked as a live AssetV1 in the pinned collection owned by the signer, burned by CPI in the same instruction, with `pob_extra ≤ 8` passed through never as signers. The window refuses by clock alone and cannot reopen; the claim is not gated by the sales stop (ruled). The claim page's refusal of any PoB/collection carrying an external plugin (rather than guessing pass-through accounts) matches SPEC 46's statement.

## R6. Initialize and the trusted hop

Every `initialize` bound re-checked against the code: MINT refuses a default treasury/operator/payment mint, a non-reserve payment mint, a non-clean or non-ours or already-minted collection, a SEAL config naming another collection, an over or mis-ordered charter window, an all-zero root, out-of-range periods and sweep bounds, a bad $CBOB mint (Token-2022, the payment mint, the $GARY mint, a non-mint) and out-of-bound boost ceilings; SEAL refuses an empty or over-3 reserve list and non-classic owners (duplicates and non-mint SPL accounts are accepted — stated in item 38, harmless because BURN derives ATAs that can never exist for them); BURN and GOV refuse a collection their sibling does not name. The royalty is installed with `PluginAuthority::None`; R.6/R.6a/R33.G3 measure Core refusing update, removal and re-delegation. The sweep hop is operator-signed, capped, cooled, reserved and stoppable; a vote can only tighten inside the initialize bounds. The redemption cap is exactly a 64-slot ring of timestamps with the k-th-most-recent check (RL.2–RL.4, RL.7), stricter-never-looser past the ring.

## R7. Cross-program raw reads

Recomputed from the struct definitions, all match: MintConfig — governance 41, minted_total 141, sales/sweep_stopped 191/192, sol_reserve 257, max_sweep 266, cooldown 274, charter_closes 442, bare_burns_retired 454, sales/sweep_stopped_at 518/526, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712 (total 1005 + 256 padding = 1261); VaultRecord — version 8, asset 9, mint_index 41, active 125, retired 126, pending 177, request_epoch 178, boost_weight 186, boost_end_epoch 187, carry 195 (221 bytes); BurnConfig — burned_total 42, window 50, head 58, ring 59 (827 bytes); SEAL Config — version 8, collection 9, reserves 41; GovConfig — proposal_count 53. The web's `dueBoostRecords` slice (125..195: active at +0, retired +1, boost_weight +61, end +62) and `waitingVaults` filter (offset 177) match the same layout. The sweep helper's classic-token offsets (mint 0, owner 32, amount 64, len 165) match SPL. Discriminators and instruction discriminators are pinned in the suite against their derivations (3.1a–3.1y, BO.29).

## R8. Suite, simulation, build as evidence

The floors must equal the counts (895/930/39/49/24/14/6/4/33/71/16), the suite file cannot be swapped, `CBOB_CACHE` is pinned, and the `because()` pins plus the ID.1 uniqueness check make wrong-reason passes loud. The key proof is behavioural in both directions for all four keyed programs; the sweep helper's shipped bytes are `cmp`-proven against both the localnet build and the deployed `target/deploy` bytes. Arms I probed for vacuity (SR.4a's exact lamport accounting, RL.7's per-redemption caps, K.7/BO.36's crank-pair overlap, R28.A2's heap boundary) each have a failure mode that turns them red. Nothing in this bundle claims a measurement the code cannot support; the unbundled test files are the boundary stated above.

---

## Findings

### LOW — redeem page: a frozen cbBTC account holding zero, with a payout owed, fails the opening with the wrong reason shown

**Construct:** `web/src/lib/plan-redeem.mjs`, the reserve loop in `planRedemption`:
```js
else if (t.state === TOKEN_FROZEN && t.amount > 0n) refuse.push(`Coinbase has frozen your vault's ${name(m)} account...`)
```
The refusal is gated on `amount > 0n`. Missed case: the vault's cbBTC account is frozen **at zero balance** and the vault is **owed ≥ 1 sat** (`plan.owedSats > 0`, pool not frozen). The page builds the redemption with the `claim`. On chain, MINT's `claim` *defers* the frozen destination (logged `CBOB_CLAIM_DEFERRED_FROZEN`, stays owed — it does not revert), the helper closes the frozen empty account (measured working, round 30), the burn passes, and then `retire_redeemed` reverts the whole transaction with `ClaimBeforeBurn` because the share is still owed and the pool is not frozen.

**What a holder gets:** the dry run fails and the page shows "step N was refused: this vault is still owed at least 1 sat; put `claim` before the sweep in the redemption" — after telling them "Payout owed: about N sats, collected in the same step." The real reason (Coinbase froze the account; wait for the thaw) is the message the page already has, one branch up, behind a condition this case does not meet.

**What is NOT at risk:** no value. The opening correctly cannot complete (limit 28's stated behaviour), nothing is sent, and the owed share stays owed. This is a message-precision defect in the exact area rounds 36–39 repaired, with the dry run as backstop.

**Evidence if true:** build this snapshot offline (frozen cbBTC ATA, amount 0, `owedSats ≥ 1`, pool live) and run `planRedemption` — no `refuse` is produced; simulate the built redemption against a validator in that state — it fails at `retire_redeemed` with `ClaimBeforeBurn`, not at the claim. A `plan.test.mjs` arm of that shape goes red today (no refusal) and green after the fix.

**Fix:** change the condition to `t.state === TOKEN_FROZEN && (t.amount > 0n || owed > 0n)` (`owed` is computed above the loop), so the holder gets the frozen-account message in all three frozen cases. Add the arm.

### INFO — `prepareOpening` drops deliverable strays on any first dry-run failure, including one they did not cause

`prepareOpening` sets `dropStrays = true` after *any* first dry-run failure when strays are aboard (e.g., a transient `RateLimited`), so the re-plan names the strays as left-behind and the holder consents to losing them although the failure was unrelated. Bounded (the holder ticks the boxes; the opening was not sent) and the alternative re-opens the stranger-blocks-the-opening hole H1 exists to close. Recorded so a later reader does not re-report it; no change recommended.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?** None found. I specifically re-checked: limit 27 (the cost falls on other holders, bounded by the dead vault's owed share; the crank retires first each pass); limit 28 (a frozen vault account blocks the whole redemption including $GARY/$GIRAFFISH — true, and the page refuses it; the frozen-pool forfeit is logged and bounded to the undelivered share); limit 32 (live counts unretired bare burns — stated); limit 41 (transfers unlimited — stated, and the guide does not over-claim the cap); limit 46 (the alarm samples state and does not watch the 240 assets — both stated); limit 58 (the Squads cannot redeem a held vault — redemption needs top-level owner signatures a PDA cannot give — but *can* vote with one via the Squads program's CPI signer, which is exactly what the item's custody note says).
2. **Anything listed as a limit that is not one?** Limit 35 is correctly stated as a floor that never binds at the ruled numbers (10.71% > 10%). Nothing else read as already-closed.
3. **Any DISCHARGED item not discharged?** Spot-checked 14 (11.4), 19 (no activated-unlevelled state exists), 31 (PG.8/PG.9), 33 (3c.K5/3c.G2 vs 6.20g/3c.G1), 54 (10.5/10.6/10.6a/10.6b) — each has the arm it claims.
4. **Any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain OPEN in SPEC; `charter_opens_at`, `lock_deadline` and `vault_collection` remain OPEN in `launch/mainnet-init.json` and the embedded `web/src/generated/launch.json` matches it; the ceremony shows NOT READY while they are open.

---

## Given that no human firm will ever see this and the programs will be immutable: what AI audit structurally cannot do before launch

1. **Run the dress rehearsal's named items on a live cluster (item 22), with signatures recorded:** the crank's full passes against ~2,100 vaults (paging, a transient RPC error at vault 1,900, the reveal lane keeping up); the alarm live in rehearsal mode; **one full revenue cycle through each pool** (Orca, then Orca forced to refuse so Meteora really runs); **one forced post-sweep failure walked through the hand recovery** to `--audit` clean; and the one DAS read of a collection holding a burned Core asset. No suite, sim or fork exercises `bank/revenue.mjs`'s live I/O at all; reading it proves nothing about it.
2. **Re-run the rehearsal-tree proof at the release commit (item 53 is stale)** and the certifying `run-tests.sh` with `CBOB_SHIP_GATE=1` so the mainnet probe and the swap fork actually run rather than skip.
3. **Reproduce the build on a second machine with an independently installed toolchain** and compare sha256 against `dist/SHA256SUMS`. `build-mainnet.sh` itself states the residual: it proves the mainnet artifacts *reject* the test key, not that the compiled constant *is* Gary's key; only independent reproduction bridges that.
4. **Exercise the real holder path with real Phantom on real mainnet before the lock:** the mock wallet is not Phantom. Message mutation behaviour, SRI/CSP enforcement in a real browser, the actual signing screens for the redemption's tick-boxes, and whether a non-technical holder understands "this is lost when the vault is opened" — none of these are decidable by reading code. One real charter claim and one real redemption of a dust-funded vault on mainnet *before* `set-upgrade-authority --final` is the only end-to-end proof of the pages the programs will depend on.
5. **Perform one real Squads v4 return of a rescued vault** (item 58's "a person's act"): the program side is proven; the custody side has never been executed.
6. **Key custody, which no audit reads:** the deploy authority (`bank/keys/deploy-authority.json`) until step 11, the swap operator key, the $CBOB release wallet (limit 56), the guardian wallet, and the Moments hot wallet (limit 46) are operational facts. Verify the backup include-list actually restores each key to a fresh machine, and delete what the rulings say should not persist, before anything holds value.
7. **The three OPEN launch values are Gary's decisions, not audit items:** the charter date, the lock deadline derived from it, and the vault collection address. The checker refuses to pass with them OPEN; that is the correct gate, and it is the only gate for them.