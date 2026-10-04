# Round 23 audit: v6 programs and off-chain pipeline

**Headline.** I found no CRITICAL or HIGH. I read the MINT accumulator, boost, join, retire and claim paths and found no path that moves value outside what the program pins. I could not run anything, so every finding below states the evidence that would confirm or refute it. The repairs I checked are:

- A1: the inner-burn exemption holds.
- A3, A5, A6, A7, F5, F7, F8: hold.
- A4: **incomplete.**
- F3: **incomplete.**
- S1: **introduced a new false page.**

---

## R1. The crank

**R1-1 (MEDIUM). The crank cannot keep up with the capture window in a burst, so it manufactures reschedules.**
- **Where:** `bank/crank.mjs` `main()`. The order is every reschedule, then every capture, then reveals, and each is a serial `sendAndConfirmTransaction`.
  - There is no ComputeBudget instruction. A capture costs 114,598 CU, so exactly one fits per transaction under the 200k default.
  - `RevealWindowExpired` is not in `BENIGN`, so a capture that lands after its window is a FAIL page.
  - The planner only reschedules vaults already lapsed at plan time. Vaults that lapse mid-pass wait for the next minute.
  - The reveal-lane lock is held for the whole serial pass, so newly minted vaults are not even planned until it ends.
- **What goes wrong:** at roughly 0.6–1.5 s per confirmed send against a ~120 s window, a few hundred vaults inside one window cannot all be captured in time. The charter opening is exactly that burst (240 claims). The lapsed vaults are rescheduled, which is a fresh roll for the minter, and every one pages `reveal_rescheduled` urgently. Limit 25 describes this as an outage case. It is actually the designed launch-day behaviour.
- **Evidence if I'm right:** a rehearsal with ≥150 vaults minted inside 60 s shows `CBOB_REVEAL_RESCHEDULED` lines and `FAIL capture … RevealWindowExpired`.
- **Fix:**
  - Capture in FIFO order interleaved with reveals.
  - Send without awaiting, or batch captures with a ComputeBudget instruction.
  - Make `RevealWindowExpired` and `NeedsReschedule` benign.
  - Run the reschedule step again after the captures.

**R1-2 (MEDIUM). Repair F3 is incomplete: a dead holder's fresh lock still blocks the lane for 10 minutes, and the full pass for 2 hours.**
- **Where:** `bank/lock.mjs` `acquireLock`. `if (age < staleMs) return {ok:false}` runs before the liveness and start-time check.
- **What goes wrong:** after a SIGKILL, an OOM kill (the cron file itself mentions PM2's memory ceiling) or a reboot, the pathname record survives with a dead pid. The reveal lane stays dead for 10 minutes, which is five capture windows. The full pass, with distribution, joins, retires and claims, stays dead for 2 hours.
- **Evidence:** plant `{pid: dead, start: null, at: now}` and call `acquireLock`. It returns `ok:false`.
- **Fix:** break immediately when the pid is dead, or its `/proc` start time mismatches, whatever the age. `flock -n` already provides the real exclusion for cron.

**R1-3 (LOW). `BENIGN` is too narrow, so ordinary races page Gary's phone.**
- **Where:** `crank.mjs` `BENIGN`.
- **Not benign today:** `AlreadyRetired`, `AlreadyActive`, `ActivationPending`, `JoinWaitingFirst`, `NothingToDistribute`, `BoostNotDue`, `RevealWindowExpired`.
- **When it fires:** holders activate themselves, redeem or claim between the plan and the send.
- **Evidence:** run the crank while a test holder activates.
- **Also:** `mintedAttributes()` is called outside any try/catch. One RPC blip throws out of `main`, aborting the whole pass, including distribution and claims, with "FAILED TO RUN".

**R1-4 (LOW). The fee floor ignores the rent the crank pays, and the over-ceiling warning pages every minute.**
- **Rent per reveal:** `reveal_level` makes the crank key `payer` for Core's attribute realloc, about 14 bytes × 6,960 ≈ 97k lamports, plus fees. That is not "fees only".
- **Floor arithmetic:** the 0.005 SOL floor covers about 45 reveals, and 2,100 reveals cost about 0.22 SOL against a 0.25 SOL ceiling.
- **Evidence:** compare the payer balance before and after one reveal.
- **Spam:** `judgeFeePayer` warns and the crank SMSes on every run, including the every-minute lane, once the key is above 0.25 SOL.

**What I checked and found correct:**
- Account order for every instruction the crank builds matches the Rust `#[derive(Accounts)]` structs.
- The 14-pair claim transaction is about 1,201 bytes.
- Pre-join, pre-expire and post-expire ordering is consistent with `JoinWaitingFirst` and `BoostsExpireFirst`.
- `readySlot` is a valid lower bound.
- The crank never pays or joins a positively burned vault.

---

## R2. The alarm

**R2-1 (MEDIUM). Round 22's A4 repair is incomplete: nothing pages when owed shares sit undelivered.**
- **The finding:** the verdict lists A4 as "no page … when owed sits undelivered". The fix added `launch_tick_overdue`, `joins_stalled` and `reveal_queue_stalled` only.
- **What goes wrong:** if the crank dies, in-line monthly runs and other traffic can keep distributing. `owed_scaled` grows, nobody is paid, and `distribution_overdue` stays quiet. There is no deadman for the crank either.
- **Evidence:** grep `detectors.mjs` for any use of `owed_scaled` beyond `pool_insolvent` and `poolAvailable`. There is none.
- **Fix:** page when `owed_scaled/1e12` exceeds a threshold and has not fallen across N passes. Alternatively, page when no `CBOB_` claim event has been seen for X hours while `owed > 0`.

**R2-2 (MEDIUM). S1 introduced a routine false page: `revenue_unsplit` never resets during continuous sales.**
- **Where:** `alarm.mjs`, `revenueSince = prev?.revenueSince ?? nowSec`. It only clears when the balance reads 0 or the account is not ok.
- **What goes wrong:** the crank splits at :37 and the alarm runs at :23 and :53. During a sale week there is always a fresh mint-price deposit at pass time, so the alarm never sees 0. After 6 hours it pages HIGH every pass, claiming "sat … since T", which is false.
- **Evidence:** run the alarm against a sale with a mint every few minutes and a working crank.
- **Fix:** store the last amount and reset `since` whenever the amount fell, or key off split events.

**R2-3 (LOW). The lock-date check trusts a file on the box.**
- **Where:** `lockDeadline()` reads `launch/mainnet-init.json`.
- **What goes wrong:** that file belongs to the same operator who holds the upgrade key. A deadline set far in the future silences the check.
- **Fix:** also page CRITICAL when `now ≥ mint.charter_opens_at` (read from chain, immutable) and any of the four programs is still upgradeable.
- **Related:** production assertions omit `mint.pob_collection`, which is fixed forever and which the launch gate pins. The alarm only drift-watches it.

**R2-4 (LOW, unverified). Burnt-asset handling in DAS (A17).**
- **Where:** `detectIndexShortfall` demands `|live|+|burnt| == minted_total` exactly. `vault_left_index` is deliberately excluded from the redemption downgrade list.
- **Risk:** if Helius `getAssetsByGroup` omits burnt Core assets, then after the first honest redemption the alarm raises a CRITICAL every pass (`index_disagrees_with_chain`), plus `vault_left_index` per redemption.
- **Evidence:** query `getAssetsByGroup` on a collection that has a burned Core asset.
- **Fix:** compare against `minted_total − burned_total − bare_burns_retired` for live-only results.

**R2-5 (LOW). Nothing checks `cbob_mint`'s authorities anywhere.**
- **What is checked:** `initialize` verifies that the account is an initialized 82-byte classic mint, and `check-launch-params` verifies that it is a key and not a reserve. The alarm only drift-watches the address.
- **What is not checked:** neither the launch gate nor the alarm verifies that mint authority and freeze authority are `None` and the supply is 2.1B. `check-launch-params` also does not reject `$GIRAFFISH`'s address on chain; only the JS gate does.
- **Evidence:** point `cbob_mint` at any real mint with a live authority and run the gate.
- **Fix:** have the gate fetch the mint from chain. Add `cbob_mint.mint_authority`, `freeze_authority` and `supply` to the alarm's fixed-forever watch.

**What I checked and found correct (R2):**
- The A1 inner-burn exemption works. It keys on the top-level index plus the same asset, and a spoofed parent does not launder.
- The invoke-stack attribution in `parseCbobLogs` is sound.
- The redemption-window arithmetic matches BURN's rule.
- The production list matches the ruled values.

---

## R3. Layouts

I checked MintConfig and VaultRecord field order, types and rent sums against the Rust. They match.

**R3-1 (LOW). The struct field lists are asserted against the Rust; the rest is not.**
- **Layout versions and discriminator constants:** `STRUCTS.*.version` is never compared to `MINT_CONFIG_VERSION` / `VAULT_RECORD_VERSION` or the `*_DISC` constants.
- **`BOOST_RING`:** the layout hard-codes 64 for `[u32; BOOST_RING]`, and the Rust constant is not scraped.
- **Rust-side consequence:** a bump would turn the alarm red at runtime, not in the selftest.
- **Fix:** scrape these constants and assert them.

---

## R4 / R4b. Arithmetic and boost

`accrual.mjs` matches `credit`, `claim`, `ceil_sats` and `owed_of`. The crank's expiry planning (`atExpiry + levelWeight·Δacc`) matches `reweigh`.

**R4b-1 (MEDIUM, gate). The crank's owed math, including boost and carry, is not tested numerically.**
- **The test:** it is named "paid at level + boost with its carry (… = 29)". It asserts only `[claims.flat().length, problems] == [1, []]`, and 29 ≥ 1 sat.
- **What passes anyway:** a crank that drops `boost:` and `carry:` from the `pendingSats` call still owes ≥1 sat and passes. So do the "expired before / both paid at weight 2" tests, which assert only the batch count.
- **Evidence:** delete `boost: r.boost_weight ?? 0, carry: …` at the crank call site. The suite stays green.
- **Fix:** record `owedSats` per claim in the plan and assert exact values, including a case at exactly 1 sat versus 0.

**R4b-2 (MEDIUM design, worse than stated). A boost's "N distributions" can be spent by a stranger in minutes.**
- **The attack:** `distribute(burn=true)` costs 100 $GARY. Anyone can transfer 1 sat directly to the pool's token account, so `avail > 0`. `expire_boosts` is free and can ride in the same transaction. Each loop advances `dist_epoch` and makes boosts due.
- **Cost to burn a 24-epoch boost:** about 2,400 $GARY plus dust. Each stranger-triggered distribution pays the boosted vault a negligible amount, so the boost buyer's burn buys almost nothing.
- **Where it is misdescribed:** `launch/mainnet-init.json` says "about two years at the monthly cadence", and limit 51 says only "only as large as the revenue behind them".
- **What to change:** it is immutable, so the options are to disclose it or to bring the vote's pricing in line. The holder copy and the boost-price proposal must not assume monthly cadence. Limit 51's disclosure should say the cadence is attacker-controlled.

**What I checked and found correct (R4b):**
- The ring has no collisions: epochs ≤ 63, and `BoostsExpireFirst` blocks epoch advance while any boost is due.
- `retire` removes boost totals correctly.
- `expire_boost` / `reweigh` do not move `owed_scaled`.

---

## R5. Swap hop

- **Worst case:** 10 SOL per 6 h, so 40 SOL/day, until the guardian stops it. The alarm's detection latency is the 15-minute grace plus the 30-minute pass plus a human.
- **Unbounded part:** the signed Jupiter `/swap` transaction. The static-key check cannot see a System transfer from the operator to anyone, and lookup-table accounts are not inspected. It is bounded only by what the operator holds at that moment (the swept SOL plus in-flight cbBTC).
- **`sendRejected`:** I found no way to mark a landed sweep as rejected. A timeout stays open, and the regex only matches preflight-style errors.

**R5-1 (LOW). The crank's hourly split makes the `splitByOther` anchor check nearly vacuous.**
- **What goes wrong:** `detectSplitClaims` anchors a `splitByOther` cycle on any later unclaimed split after its return. The crank now produces one every hour, so a false `splitByOther: true` is almost always "anchored".
- **Mitigating:** the money is still divided by the pinned rule, so only the testimony check is weakened.
- **Fix:** anchor on the split that emptied the revenue ATA. Check the split transaction's amount against the return.

---

## R6. Gates

**R6-1 (MEDIUM).** `V6_WIRED` lists 11 detectors; the alarm calls more than 20. Not covered:
- `detectRevealStall`, `detectUnsplitRevenue`, `detectFrozenVaultAccount`, `detectIndexShortfall`, `detectVaultSetChange`, `correlateBurns`, `applyAcks`, `detectSplitClaims`, `detectDeferredSweeps`, `detectUnreconciledRevenue`.

This is the wired-to-nothing class the brief names. **Evidence:** delete `D.detectRevealStall(prev?.config, cfg)` from `alarm.mjs`. The selftest stays green.

**R6-2 (LOW).** The ON-CHAIN control-table row passes if **one** backticked name is a real error variant (`real.length`). A row listing seven nonexistent refusals and one real one passes.

**R6-3 (LOW).** `run-tests.sh` prints "SKIPPED" for the mainnet probe on no-DNS and exits 0. Nothing in the ship gate demands one real run, and the probe's DNS test targets a different host from the one the probe uses.

**R6-4 (INFO).** `SPEC` still says "59/59" for the simulation while the floor and run block say 60. The regex only matches "N simulation assertions".

---

## The four questions on accepted limits

**1. Worse than stated.**
- **Limit 25:** the crank itself causes lapses in any burst (R1-1), at the launch event, not only in an outage.
- **Limit 51 / boost:** the duration is attacker-controllable (R4b-2).
- **Limit 55:** "about an hour of sales" assumes a live crank. With a dead crank (R2-1 would not notice) it is unbounded.
- **Limit 7 "survivable":** a dead crank no longer pays anyone and nothing says so (R2-1).

**2. Not actually a limit.**
- **Limit 43:** it is a choice, not a limit. A top-level check at mint would close it before the lock.
- **Limit 46 "alarm watches the collection":** a collection plugin does not need to be what blocks a burn. A per-asset plugin from the same hot wallet is equally possible and unwatched.

**3. DISCHARGED but not.**
- **12/17 (compute):** the claim that "a transaction that fits cannot run out of compute" is contradicted by item 54. A mint carrying 4 captures costs 518,929 CU, which exceeds the default budget and still fits the byte limit.

**4. OPEN AND BLOCKING treated as accepted.**
- **52 omits the revenue PDA's own cbBTC ATA.** `mint_vault` transfers into it without creating it. Until a swap cycle or someone else creates it, every voted-round mint fails with an uninitialised account. This is loud and fixable by anyone, but the road table has no step for it.
- **50:** the holder surfaces are classed blocking, yet the ship-gate lists only freeze and audit rounds. Building them later edits `bank/`, which resets the freeze under gate 2. They should be scoped as "outside the freeze" or built first.
- **51:** SPEC still says the boost bounds are OPEN, but `mainnet-init.json` shows them RULED. This is doc drift.

---

## Other

- **`create-cbob-token.mjs`:** one transaction, mint authority revoked, freeze `null`, supply minted in the same transaction. I found no partial-supply or live-authority path.
  - **Caveat:** the on-chain record file is written only after every read-back succeeds. A read failure after an irreversible mainnet creation leaves no record, so write it before verifying.
  - **Caveat:** the metadata update authority stays live and mutable, which is a ruled choice.
- **`cron-install.sh`:** the `ours crank` grep also matches the `crank-reveal` tag, but its `--live` regex avoids arming it. No bug.

---

## GIVEN THAT NO HUMAN FIRM WILL SEE THIS: what to do before launch that AI audit structurally cannot

1. **Run a burst against a real cluster.** Do the dress rehearsal with the unmodified crank and alarm at throwaway ids. Mint 240 vaults in 60 s, 2,100 over a day, and measure the reschedule count, crank wall time per pass, key SOL burn, RPC rate limits and DAS behaviour on burnt assets. This is item 22 plus R1-1, R1-4 and R2-4, and it is the single most valuable step.
2. **Differential testing.** Build a randomized model of the pool (mint, activate, join, boost, expire, claim, retire, distribute, freeze) in an independent implementation. Run thousands of random op sequences against the deployed bytes. Assert on every step that pool ≥ ceil(owed), the sum of payouts ≤ distributed, and the model equals the chain. Fuzz transaction orderings and account substitutions, since the assertion floors cannot do this.
3. **Reproducible build and byte verification.** Use a verifiable build, publish the hash, and confirm the deployed ELF equals it after deploy and again after the authority is removed.
4. **Key hygiene.** One Phantom wallet is `INIT_AUTHORITY`, the guardian and the $CBOB update authority, and a hot wallet controls the PoB collection. Put each role on a separate hardware key. Rehearse the guardian stop, a lost-key scenario, and "move custodial vaults to fresh keys under the 45/hour cap".
5. **Canary money before the lock.** An immutable system whose first real value arrives after the lock has had no field time. Deploy byte-identical code at throwaway ids with a small real float and a public bounty for two to four weeks before step 11. Treat any change as resetting the freeze.
6. **Third-party reading of the holder guide against the behaviour.** I found several promises the code does not keep: boost duration, payout delivery, the redeem page. A human holder needs to try a real redemption end to end with the three-asset, two-transaction flow.
7. **Metaplex and Coinbase dependency drills.** Measure what happens on a Core upgrade (limit 40) and on a cbBTC freeze of a vault account or the pool (limit 28). Write the operator runbook for each before launch.