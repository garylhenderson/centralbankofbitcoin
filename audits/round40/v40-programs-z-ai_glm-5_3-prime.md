# Round 40 — independent audit of the whole tree, round 39's verdict first

**Verdict up front: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW (new, in `web/`), 2 INFO. Round 39's two confirmed findings are repaired and I found no regression in the repairs. Nothing I found moves value out of a vault, the pool or the revenue address. My one LOW is a display/consent-semantics gap in the redeem page's press, not a value loss.**

Scope note, stated plainly: this bundle carries the five programs, the suite, the sim, the build/runner scripts, `bank/txread.mjs`, `bank/sigwalk.mjs`, all of `web/src`+`web/meta`+`web/deploy`, the docs and the round-39 verdicts. It does **not** carry `bank/crank.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/selftest.mjs`, `bank/accrual.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/layout.mjs`, `scripts/check-launch-params.mjs` or `web/test/*`. Round 39's off-chain pass covered those; I could not independently audit them here and I say so wherever a conclusion of mine would depend on them.

---

## R0. Round 39's verdict and repairs

### V39-1 (MEDIUM) — the promised-stray drop at the press. **Repair verified, at every site of its shape.**

I traced the repair end to end in the current code:

- `web/src/lib/reads.mjs` `vaultWalletAccounts(conn, owner, reserveMints, promised = [])` now builds `byAddress = [...new Set([...reserveAtas, ...promised.slice(0, PROMISED_MAX)])]` and reads them through `accounts()`, which throws on failure. A failed re-read therefore rejects out of `freshPlan` before any dry run — exactly what VALIDATION claims.
- `web/src/pages/redeem.mjs` `freshPlan(asset, noPrior, dropStrays, final)` passes `[...final.known]` as `promised` only at the press (`final` is non-null only there), and threads `known`/`consented`/`seen` into the snapshot.
- `web/src/lib/plan-redeem.mjs` adds the known-missing check: `if (s.known) for (const k of s.known) if (!s.pdaTokens.some(t => t.address === k)) cannot.push({ address: k, text: ... })`, which becomes a `lost:<addr>` ack. Because `aboutKnown(a)` tests `s.known.has(<addr>)`, that box is **not** demoted by the press loop, so `prepareOpening` sees it as a `newAck` and stops with `stop: 'ack'`, and `pressStopMessage` names it. That closes all three measured shapes (F1a listing failed, F1b beyond the 200, F1d a promised non-ATA cbBTC stray): each now either stops the press with a box about that address or delivers it.
- "Arrived after your check" is now gated on `!s.seen?.has(ad)`, and `seen` is built from the check-time `pdaTokens`/`nested`/`compressed` — so the heading is only applied to what the check did not see. The beyond-200 residual is the one the repair's own comment accepts ("counts as unseen"); see INFO-2 below for the copy nit.

I also re-checked the other V38 repairs at their sites (`drop` helper with `indexOf`, `LATE_CONSENT_ID` carrying no address/count/digest, the C5 late-deposit note, `resolveCollection`'s B4 warn-and-still-offer with the `unverified` list) and found no regression.

### V39-2 (LOW) — the nested-vault refusal. **Repair verified.**

`plan-redeem.mjs`'s nested branch no longer refuses: at check it pushes an **optional** prior `rescueNested(ids, inner, asset, bank_treasury, owner)` plus a note; at press (`s.noPrior`) it is `pressInfo`. The coverage cross-check's `named` set includes `s.nested.filter(n => n.ourVault).map(n => n.address)`, so the cross-check cannot refuse on it. I verified the program side backs the "rescued afterwards" promise: MINT's `rescue_nested` accepts a host that is the vault itself, **positively burned**, or a live CBOB vault, so a vault left inside a burned host is extractable, and the optional pre-opening rescue is legal because the outer vault is a live CBOB vault at that moment. README, SPEC ("never a refusal") and HOLDER-GUIDE now agree; the drift-sweep items are consistent in the copies I read.

### Round 39's disproved claims I re-tested by reading

- **W1** (txread rejects T22 `transferCheckedWithFee`): confirmed disproved. The amount check in `bank/txread.mjs` applies only to the exact list `['transfer','transferChecked','approve','approveChecked']`; a `transferCheckedWithFee` type is not in it and is accepted. I agree with the disposition.
- **W2** (a delegated classic stray cannot be moved): confirmed disproved. The helper's transfer names the PDA (the token account's owner) as authority; SPL Token permits the owner to transfer while a delegate is set, and suite 3.3a measured the owner-authority transfer + helper close as ALLOW. I agree.
- **W4** (INIT_AUTHORITY first-come between steps 9 and 10): I agree it is the definition of a one-time `initialize` gate, requires Gary's key to be stolen (limit 47's subject), and the ceremony re-reads every config and stops on a wrong value. No defect.
- **W5/W6**: I cannot re-measure the placeholder dumps or SPL native semantics here; the record and standard semantics support the dispositions and I have nothing to add.

I did **not** re-file any claim merely because the verdict contains it.

---

## R1. Custody — the seal/open/burn pairing and the emptiness proof

I attacked the pairing, the emptiness proof and the "thawed vault survives" question independently. Everything held:

- **The pairing binds asset AND owner in both directions, top-level only.** SEAL walks forward from `current+1` matching BURN's discriminator with accounts 0 and 2; BURN walks backward from `0..current` matching SEAL's with accounts 0 and 2. A CPI'd open or burn reports the outer instruction's index, so a wrapper cannot satisfy either half; the suite's WR.1–WR.4 pin all four wrapper shapes. `retire_redeemed` adds the stack-height check (`TRANSACTION_LEVEL_STACK_HEIGHT + 1`) **and** the current-instruction identity check (program = BURN, discriminator, account 0 = this asset), which is what distinguishes a legitimate CPI from a same-depth wrapper CPI.
- **Nothing leaves a thawed vault unburned.** The rate-limit ring update, the `lamports == 0` check, the declaration-count check, both emptiness loops, the Core `BurnV1` and the `retire_redeemed` CPI all run after the thaw; any failure reverts the transaction and therefore the thaw. The rate-limit stamp is written before the proof, but a failed proof reverts the stamp with it.
- **The emptiness proof's skip conditions are each unreachable or harmless.** A System-owned account at a reserve-ATA address is impossible (R34.G2a/G2b measured: the address is an ATA-program PDA, so no allocate and no InitializeAccount3). A closed account passes because the runtime zeroes it (0 lamports, non-token owner), which is why the suite's 3.3a and 4.2 land. A declared stranger-owned token account is skipped by the `owner == pda` test and holds nothing of the holder's. A declared Core tombstone passes `d[0] != KEY_ASSET_V1`; a declared live Core asset refuses (`VaultStillHoldsAVault`).
- **The rate limit is exactly a rolling window.** I re-derived the indexing: `head` is the next write slot, the k-th most recent is `head - k mod 64`, and "the cap-th most recent is ≥ window old" bounds the window ending at `now` to exactly the cap (cap−1 prior + this one). The `min(cap, 64)` clamp makes live supply above 3,047 stricter, never looser. `burned + bare_retired ≤ minted` holds because a vault is redeemed or bare-burned, never both, so `live` cannot underflow.

## R1s. The sweep helper

- **(a)** Access control is Core's `ExecuteV1` rule plus the helper's own `signer.is_signer` and source-owner check. Directly called, it moves only the caller's own holdings (SR.1). Through Core, only the owner signs (SR.5/SR.5a/SR.5b/SR.5c/SR.5d, measured against the pinned binary). While frozen, Execute is refused (0x9), so it cannot be reached outside a redemption.
- **(b)** The pair checks are: source owned by the signer, destination owned by the one destination wallet with the same mint. Duplicate sources: the first pair closes the source and the second fails on the closed account (SR.12a/SR.12b, and the pin correctly asserts the refusal was *not* at the first source-owner guard). A wSOL source is swept correctly (Token's native transfer moves lamports with the amount; the close returns only rent). A delegated source is deliverable (owner authority). A frozen source reverts the whole opening (SR.14) — limit 28's known consequence. A destination that is another vault's asset-signer is refused by `signer.key == dest.key` only for the *same* vault; a *different* vault's PDA as destination would require the owner to build it, which is the owner's own choice — no third party can reach it.
- **(c)** The destination is chosen by whoever builds the transaction, and through Core that is only the owner. A sub-rent-exempt credit to a non-existent account is refused by System (round 25 D9, measured); the canonical destination is the fee-paying owner. R27.S1 measured the non-System destination case.
- **(d)** The lamport sweep reads `signer.lamports()` at execution and transfers all of it. A later instruction in the same transaction could deposit lamports to the PDA, but BURN's `lamports == 0` check runs after and would refuse, reverting everything. Core's `BurnV1` adds nothing (measured fact 4).
- **(e)** The closed account passes BURN for the right reason: the runtime zeroes it, so it is no longer a token account holding a balance; the reserve loop's owner/length checks and the second loop's 0-lamport skip both fire. The prior-transaction contract (SPEC REDEEMING step 1) ensures the helper can name all three reserve accounts; a stranger cannot create a classic ATA for the vault and hide value in it, because the classic ATA *is* the vault's account and is swept live.
- **(f)** S8.0's 1,061-byte measurement includes claim + open + the three-pair helper + burn with the owner as payer; the +52/+96 additions are reserved. There is no fourth reserve (hard cap 3 in both SEAL and BURN, pinned to the measurement by 9.14–9.16).
- **(g)** The SR arms I checked can each fail, and the two reason pins that exist (SR.11, SR.12) name the helper's own refusal text. The helper's byte identity is proven three ways by `scripts/build-mainnet.sh` (dist == localnet release == `target/deploy`, the bytes the suite and sim deploy).

## R2 / R2b. The pool and the boost

- **The invariant "the pool holds at least ceil(owed)" holds under every operation.** I re-derived it: `credit` adds `floor(avail·SCALE/w)·w ≤ avail·SCALE` to `owed`, and `ceil(owed + k·SCALE) = ceil(owed) + k` for integer k, so `ceil(owed_new) ≤ ceil(owed) + avail = balance`. `claim` subtracts `pay·SCALE` from owed and `pay` from balance, and `ceil(owed − pay·SCALE) = ceil(owed) − pay`. `retire`/`join`/`reweigh` only move owed between the global and per-vault ledgers. `monthly_inline`'s `saturating_sub` hides a hypothetical `PoolShort` where explicit `distribute` refuses — a design choice, detected by `detectPoolHealth` off chain.
- **The counters are consistent under every ordering I traced**: request → advance → retire (pending_this_epoch already reset, so only pending_count falls); request → retire-in-same-epoch (both fall); retire of an earlier-epoch pending vault while a same-epoch request exists (only pending_count falls, waiting stays correct). F21.1/F21.2 pin both retire branches.
- **A boost earns exactly N distributions.** `end = dist_epoch + N` at purchase; distributions while `dist_epoch ∈ [e, e+N−1]` credit at the boosted weight (N of them); the one advancing to `e+N` makes it due; `BoostsExpireFirst` blocks the next. BO.21/BO.21a/BO.35/BO.35a pin both orderings. `reweigh` preserves the pending exactly via `carry`; nothing is lost or gained on weight change (boost, expiry, claim normalisation, retire).
- **The ring cannot collide.** Ends are within 63 of the purchase epoch; a same-slot different end would need a 64-epoch gap, impossible for a live boost; each slot is consumed exactly when the epoch passes through it. The host test drives 260 epochs (four wraps) through the program's own functions against a model.
- **No double/early/never expiry**: `expire_boost` requires `boost_weight > 0 && dist_epoch >= end`; after expiry `boost_weight = 0` so a second pass skips. Liveness: every gate (`JoinWaitingFirst`, `BoostsExpireFirst`) is clearable permissionlessly, and the burn-path distribution's refusals all fire before any $GARY is burned.

## R3. The level draw

The SlotHashes parse pins the sysvar id, bounds the count at 512, checks the buffer length, and refuses all-zero hashes. The smallest-produced-slot-in-window rule is deterministic and order-independent. FIFO (`index == revealed_total`), the burned-vault-at-head path (draw taken, Core write skipped), the attribute re-supply hash, and the reschedule rules (only after the window passes, to a slot that does not exist yet) all read correctly. The residuals are exactly limits 25 and 26, and HOLDER-GUIDE states both truthfully (including "one choice affects every vault created in that moment at once").

## R4. Governance

One-vault-one-vote is bound to the asset via the `["vote", proposal, asset]` PDA; the electorate and tally rule are snapshotted at creation; the key-change supermajority is against the snapshot, never bundled, and lands only after notice; `TightenSweep` is monotone and bounded; overtaken actions are logged skips. I found no minority path (the 10% turnout rule cannot bind at 21%/51%, limit 35), no money reach beyond the five bounded actions, and no new freeze beyond limits 45/47. GOV's restart-skip condition (`stops.at >= created_at`) matches MINT's `StopIsNewer` exactly.

## R5. The charter claim

The Merkle scheme is sound: domain-separated leaf/node tags defeat second-preimage replay, sorted pairs defeat reordering, `MAX_POB_PROOF = 16` bounds compute, and the program accepting proofs built by `scripts/pob-merkle.mjs` is the drift check (the suite and the mainnet probe both use it). The window is clock-only and cannot reopen; the claim is not gated by the guardian; `pob_extra` accounts are passed through never as signers. The hot-key exposure is limit 46 and I found nothing it still omits: the claim page refuses a PoB or collection carrying an external plugin, the alarm watches the collection account (with the stated per-asset and sampling blind spots), and the positive bound (it cannot take a PoB) is measured.

## R6. Configuration and the trusted hop

Every `initialize` I read enforces what SPEC's table says, and `judgeRehearsal`'s bounds in `web/src/lib/plan-ceremony.mjs` match the programs' constants field-for-field (I compared all 17). The swap operator's worst case remains cap × windows until the guardian stops, bounded by the revenue balance above the reserve — limit 10, unchanged. The royalty's `PluginAuthority::None` is Core-immutable (R.3/R.6/R.6a/R.6c/R33.G3, measured both directions). The redemption cap is exactly the rolling window of R1. The one accepted residual is round 24 A6 (the checker validates the JSON, not the signed transaction) — still stated, still open.

## R7. Cross-program raw reads

I recomputed every offset and space from the struct definitions:

- **MintConfig**: version 8, collection 9, governance 41, pool_ata 73, round_id 105, price 125, minted_total 141, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, charter_closes 442, bare_burns_retired 454, total_active_weight 462, dist_epoch 655, pending_count 663, cbob_mint 679, max_boost_weight 711, max_boost_epochs 712, boost_expiring 749 (256 bytes), **end 1005, space 1261** (padding 256). Every GOV and BURN offset and every suite offset matches.
- **VaultRecord**: 221 bytes, fields at 8/9/41/49/57/58/59/60/92/124/125/126/127/129/161/177/178/186/187/195. Matches GOV's pinned read and the suite.
- **BurnConfig**: 827 bytes (rate_ring at 59, 512 bytes). Matches.
- **SealConfig**: disc 8, version 8, collection 9, reserves 41. Matches MINT's and BURN's readers.
- **The helper's token offsets** (mint 0, owner 32, amount 64, length 165) are the classic SPL layout.

No misread found.

## R8. The suite, the simulation and the build as evidence

- The arms I probed for vacuity can each fail (SR.12b's negative-assertion arm, 9.13a's unsigned-serialization pin, RL.S1–S6's pure-function arms, ID.1's uniqueness check). The `because()` pins that exist name the right reasons; the seven known unpinned arms (R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8) are still unpinned — carried as round 39 A4, and I confirm the count by reading.
- The expiry-budget gate is honest about being synthetic-genesis (its own header says so).
- `build-mainnet.sh` proves the sweep helper's byte identity three ways and the four keyed programs' key behaviour both directions; the release-commit binding of the web build (`RELEASE_COMMIT` + `dist/SHA256SUMS`) fails closed. Item 53's staleness (re-run at the release commit) is still correctly OPEN.
- Claims in the prompt with no arm: I could not find an arm exercising a lamport deposit landing between the helper's Execute and BURN inside one redemption (the design says the burn refuses and the thaw reverts; the second loop's 0-lamport skip plus `lamports == 0` make this airtight by construction, but no arm sends it). Same for a declared reserve ATA that does not exist on chain. Both are round 39 A5 coverage gaps; I add them to that list rather than filing them as defects.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** I attacked the load-bearing ones (10, 25, 26, 27, 28, 32, 41, 42, 44, 46, 47, 55, 56, 58) and found no widening. Specific checks: limit 32's ring clamp is correct in both directions; limit 44's C5 handling in the page matches the stated design exactly (balance moved by plain transfer, account left undeclared, late deposits stay); limit 28's frozen-account-blocks-redemption is enforced by both the helper's transfer and BURN's amount check; limit 46's claim-page refusal of external plugins is present in `plan-get.mjs`. Nothing is worse.

**2. Is anything listed as a limit not actually a limit?** No. Limit 9's "the only pre-signature check left is the redeem page" remains accurate (the page's NFT/token listing does check, but the page is unpublished — item 50). Limit 42's "only two fit" was already corrected to the measured narrow-shape exception. Everything else I checked is real.

**3. Is any DISCHARGED item not actually discharged?** No. Item 51 (boost) is built and measured; item 54's page rule ("set the CU limit on any transaction carrying a crank, or send no crank") is satisfied by every page I read — none carries a crank, and the draw page's standalone reveal/capture costs are measured under the default budget; items 14, 19, 30, 31, 33 are closed by construction or by the `initialize`-parameter exercises.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 all remain OPEN; `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline` and `vault_collection` as OPEN; VALIDATION demotes nothing and the round-39 verdict explicitly refuses to.

---

## Anything else

### LOW — the press silently omits items the holder consented to via a grouped box

- **Construct:** `web/src/lib/plan-redeem.mjs`, `groupAcks()` (the `group:<count>:<fnv>` id and its unused `covers` field) and the press demotion loop in `planRedemption()`:
  ```js
  for (const a of [...ack]) if (!s.consented.has(a.id) && a.id !== 'forfeit' && !aboutKnown(a)) {
    ack.splice(ack.indexOf(a), 1)
    const ad = a.id.split(':').slice(1).join(':')
    if (!/^(lost|left|asset|cnft):/.test(a.id)) pressInfo.push(a.text)
    else if (!s.seen?.has(ad)) lateInfo.push(a.text)
  }
  ```
- **What happens:** at the check, more than 20 `lost/left/asset/cnft` boxes are replaced by ONE grouped box whose id is `group:<n>:<fnv of the ids>`; the holder ticks that id. At the press, the same items re-derive their **individual** ids. Those ids are not in `consented` (only the group id was ticked), are not `aboutKnown` (grouped items are `cannot`/`left` items, never in `known`, which holds only *delivered* strays), and **are** in `seen` (they were present at the check). The demotion therefore splices every one of them out of `ack` and pushes them to neither `pressInfo` (they match `lost|left|asset|cnft`) nor `lateInfo` (they are in `seen`). They vanish from the press's display entirely — not even a count.
- **What an attacker or accident gains:** nothing in value. The grouped box was ticked, so the loss was consented; the opening correctly proceeds and the items are correctly left behind. What is lost is the round-38 V38-2 display contract ("a box the holder did not tick is … shown as information and never stops the send" — these are shown as *nothing*) and the press's information value: a holder who ticked "25 things stay behind" is shown no mention of them at the press. The `covers` field that would map the group back to its items exists on the grouped box and is read by nothing.
- **Evidence if I am right** (an offline run in the shape of `web/test/plan.test.mjs`): build a check snapshot with 25 classic strays of a freezable mint; the check plan groups them (`ack` holds one `group:25:*` box). Tick it and run the press re-plan with `consented = {'group:25:*', 'late-arrivals'}`, `known = ∅`, `seen` = all 25 addresses. The press plan's `ack` contains no box for any of the 25, and `lateInfo` and `pressInfo` are empty of them, while the 25 still appear in `coverage`'s uncovered-but-named set. No current arm pins this: the round-37 grouped-box e2e predates the press loop, and the round-39 e2e covers promised balances and late arrivals, not grouped consent.
- **Fix (page only):** when the holder ticks a grouped box, add its `covers` ids to the consent set (`redeem.mjs` already holds the box object, which carries `covers`); the press's individual boxes then count as consented and the semantics are exact. Alternatively, push in-`seen` un-ticked `lost/left` boxes to `pressInfo` instead of dropping them. Either way, add a `plan.test.mjs` arm for the grouped-consent press. Whether this qualifies for the documentation exception is a ruling call: the doc-only alternative ("items consented as a group are not re-listed at the press") misstates nothing about money, rights or program behaviour, but the page change is the honest repair.

### INFO-1 — `planDraw`'s `readySlot` assumes no skipped slots

`web/src/lib/plan-get.mjs` `readySlot()` computes C's earliest slot as `(floor(rs/4)+4)*4`, assuming A = `reveal_slot` exactly. On mainnet with skips, A can be up to `rs+64`, so the page may offer "Draw my level" before the hashes exist; the reveal then fails its dry run with `RevealTooEarly` and the button reports "Not possible right now… try again in a minute". Graceful, no value at risk, and the crank lane captures within a minute anyway. A one-line `+ MAX_SKIPPED_SLOTS` margin would remove the false offer.

### INFO-2 — "arrived after your check" is applied to beyond-200 strays that were present at check

The round-39 repair's own comment counts beyond-200 and unlisted accounts as "unseen", and the `lateInfo` text says they "arrived at the deposit address after your check". For a beyond-200 stray that was there at check, that sentence is false; the check-time `unlisted:<n>` box already told the holder the truth. Copy nit only; the consent covers the value either way.

### Scope limitations I could not discharge

The off-chain money pipeline (`bank/crank.mjs`, `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/accrual.mjs`, `bank/layout.mjs`), `scripts/check-launch-params.mjs` and `web/test/*` are outside this bundle. Round 39's off-chain pass audited them and VALIDATION records red-under-mutation proof for C01–C04; I could not independently verify those here, and my R0 conclusions about the repairs rest on the page code, which I did verify.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the dress rehearsal (item 22) and treat its five named items as the certification.** No AI round can execute the crank against ~2,100 live vaults, page through a transient RPC error on vault 1,900, or walk a forced post-swap failure through hand recovery. This is the only thing that exercises the off-chain code that actually moves money.
2. **Re-run the rehearsal tree and `build-mainnet.sh` at the exact release commit** (item 53's staleness). Reproducibility is the *only* bridge over the INIT_AUTHORITY gap — the build proves the mainnet binaries reject the test key, not that they carry Gary's key. The bytes that deploy must be the bytes the suite ran, proven at the commit that deploys.
3. **Verify the on-chain deploy by an independent dump-and-hash at the CLI**, at road step 9 (upgrade over the placeholder), again at step 10 (before any state is written), and again at step 11 immediately before and after `set-upgrade-authority --final`. The ceremony checks ProgramData, but the deploy act itself is a command line a human must run and confirm.
4. **Exercise the real time constants once.** One full 30-day monthly cycle, one 7-day notice, one 3-day vote, and the 2.1%/hour cap observed across a multi-hour window on the rehearsal deployment. The suite proves the arithmetic at short values; only a live run proves the clock reads, the cron cadence and the alarm's grace periods at the ruled numbers.
5. **Fix the key custody acts no audit can vouch for:** the guardian/INIT wallet's hygiene; the swap operator key's isolation (it must hold nothing but cycle funds and its float); the $CBOB release wallet's backup regime (limit 56); the deploy-authority key's survival until step 11 (its loss means new program ids, a program change); and above all the Moments hot key through the 7-day charter window — limit 46's only real mitigation is operational: hold it cold or in a multisig *through the window*, then return it hot if Gary insists.
6. **Stand up an off-box dead-man's switch.** The alarm, crank and revenue share one user on one box (limit 10 D2(3)); whoever owns the box owns the detection. A second, independent monitor — another box, or a hosted heartbeat service that pages if the first box's alarm state goes stale — is the only answer to that residue, and it cannot be built from inside the tree.
7. **Take a launch-day snapshot of every third-party dependency:** re-verify the pinned Core sha256 against mainnet the morning of the launch, and record the Orca/Meteora/Pyth program bytes and upgrade authorities as the alarm's baseline. The alarm watches for *change*; the baseline must be taken deliberately, by a person, at the right moment.
8. **Rehearse the human-judgment paths once with real value:** one real rescued vault returned by the Squads (limit 58's return is "a person's act" — prove the process works before it is load-bearing); one real charter claim by a holder who is not the author; and a comprehension test of the redeem page's boxes with a few non-technical people. The pages' consent model is only as good as a holder's understanding of it, and no AI pass can measure that.
9. **Decide and fund a post-launch defense before the lock.** With immutable programs, a discovered bug is permanent; the only post-launch controls are the guardian's stops (which reach sales and the swap only) and disclosure. A funded bug bounty with a named recipient and a public disclosure channel, decided before the upgrade authority is removed, is the last line.
10. **Close the two OPEN values and the two OPEN items that gate them:** the charter opening date and the lock deadline are Gary's acts; items 50 (publish the pages, enable the proxy, wire the poster's sender or drop the promise) and 22/53 (the rehearsal and its re-run) are the remaining blockers. Nothing in this round's findings changes that list.

**Result: round 39's repairs hold; no defect in the five programs; one new LOW in the redeem page's press display; the clean-round counter remains 0/2 and this round is NOT CLEAN if the LOW is confirmed and not ruled documentation-only.**