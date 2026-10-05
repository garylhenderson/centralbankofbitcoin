# CBOB v6 audit, round 24 (programs, suite, simulation, docs)

**Read:** all four programs, `tests/3prog.test.ts`, `sim/test-vault.ts`, `sim/clone-pob.mjs`, `run-tests.sh`, DESIGN-v6, HOLDER-GUIDE, SPEC, RT3, the round-23 programs verdict, `mainnet-init.json`, and the CPI wrapper.

**Not read:** `bank/*.mjs`. Neither `bank/` nor the round-22 verdicts are in this bundle. I therefore cannot certify any of the 27 round-22 off-chain repairs or the round-23 off-chain repairs. Treat the off-chain pass as not done by this round.

**Method:** I executed nothing. Every claim below names the run or read that would confirm it.

**Headline:** I found no theft path, no unseal, and no accounting break. The serious findings are consequences of accepted rulings that the documents describe as smaller than they are. One is a whole-project brick (R5-1). One is a Core-format dependency that can permanently brick every redemption (R1-1).

---

## R1. Custody

**What I checked and found holding.** The pairing binds asset and owner in both directions. It uses only top-level instructions, and BURN's lack of a stack-height check is covered by `retire_redeemed`:
- A wrapped `burn_vault` CPIs MINT at height 3, so it reverts with `NotFromBurn`.
- `[open, sweep, wrap(burn), burn]` therefore reverts too.
- A thaw cannot be lent to a nested vault. Its owner is a PDA, which cannot be the top-level burn's signer.

The emptiness checks match the SPL layout at offsets 64, 72, 121 and 129.

### R1-1 · MEDIUM (conditional on Core; amplified by immutability)
**The redemption path depends on the exact byte shape of Core's post-burn tombstone.**

- **Construct:** MINT `is_burned` (`owner == Core && len == 1 && d[0] == 0`) is required in three places:
  - `retire_redeemed`, which every redemption reaches through BURN;
  - `retire_burned`;
  - the `burned` branch of `reveal_level`.

  Any other non-live state in `reveal_level` hits `WrongAsset`.
- **Consequence:** Metaplex may change how `BurnV1` leaves the account without changing what "burn" means:
  - close it entirely;
  - resize it differently;
  - use a different `Key`.

  If that happens:
  - **Every redemption** fails `NotBurned`, even though BURN destroyed the asset one CPI earlier.
  - Every vault is sealed forever.
  - The reveal FIFO stops permanently at the first burned head of queue.

  Limit 40 talks about Core changing `BurnV1`. This dependency is narrower and more brittle: it is a layout detail, not a semantic.

  The same `WrongAsset` halt fires if Core ever enables an asset-state transition such as `CompressV1`, which I believe is `NotAvailable` in the pinned build.
- **Evidence:**
  1. Patch a test validator account to a 0-byte, system-owned tombstone after `BurnV1`. `retire_redeemed` then refuses.
  2. Call `CompressV1` against the pinned Core in the suite. It should answer `NotAvailable`; pin that as an arm.
- **Fix (small, before freeze):**
  - In `retire_redeemed`, BURN has just executed `BurnV1` in this instruction, so accept "not a live `AssetV1`": `!(owner == Core && len >= 1 && d[0] == KEY_ASSET_V1)`.
  - In `reveal_level`, draw for anything that is not a live `AssetV1` and skip only the Core write.
  - Keep the positive tombstone identification in `retire_burned` if round 21's reason still applies there.

---

## R2. The pool

### Invariants I could prove by reading

**`pool ≥ ceil(owed)`.**
- `credit` adds `delta·w ≤ avail·S`, so `ceil(owed') ≤ ceil(owed) + avail = balance`.
- `claim` moves `pay` sats out of the pool and `pay·S` out of `owed`.
- `retire` and the forfeit only lower `owed`.
- `join` adds 0, and `reweigh` preserves `owed`.
- `owed_scaled` equals the exact sum of `w·acc − debt + carry` over all vaults.
- `total_active_weight` equals the exact sum of `weight_of`.

**Counters.** I found no underflow or drift in `pending_count` / `pending_this_epoch`:
- `join` only ever acts on earlier-epoch requests.
- `retire` decrements this-epoch only when `request_epoch == dist_epoch`.
- `advance_epoch` zeroes this-epoch.

### R2-1 · INFO (documentation consistency)
The brief asks me to prove "no vault is ever paid for revenue that arrived before it joined". That is false as written, and SPEC (round 22 F2) already retracts it: pool revenue present at join is shared at the next distribution. Align the brief and DESIGN §3 with SPEC.

---

## R2b. The $CBOB boost and the round-23 repairs

### What I checked and found holding
- **Exactly N:** `end = epoch + N`, credit happens before `advance_epoch`, and ticks cannot run while any vault is active.
- **No ring collision:** live end epochs fall within 63 epochs of `dist_epoch`.
- **Unscheduling:** it picks ring or due correctly.
- **Carry and reweigh:** they preserve `owed`.
- **No double or early expiry:** a second load sees `boost_weight == 0`, and expiry requires `dist_epoch ≥ end`.
- **Gate liveness:** `expire_boosts` needs no token account. A due boost cannot sit on a retired or pending record.
- **Repairs:** owner-only (`BoostNotTheOwner`) and the buyer's terms (`BoostTermsMoved`, checked before the burn) are correct.

### R2b-1 · LOW (round-23 F7 repair is partial; evidence)
- **(a)** Only `[boost, distribute]` is exercised (BO.21). `[distribute, boost]` is not, although F7(a) asked for both orders.
- **(e)** The ring wrap past 64 epochs is never exercised through `boost_vault`, `unschedule_boost` or `expire_boost`.
  - `the_boost_ring_wraps_exactly_against_a_model` writes `boost_expiring[end % 64]` itself.
  - It therefore re-implements the very index it claims to check, and tests only `advance_epoch`.
  - A wrong index in `boost_vault` or `unschedule_boost` would pass it.
- **(h)** BO.28 only creates the five-kind proposal (`votes:'none'`). Nothing executes it.
  - GOV's comment says "Measured in the suite: an every-kind execute is six CPIs and fits". That is unmeasured. E.3c measured four actions and five CPIs.
- **(j)** The simulation still contains no boost.
- **Fix:**
  - A host test that drives `boost_vault`'s schedule arithmetic, `unschedule_boost` and `expire_boost` on a config, for 200+ epochs, with N = 63.
  - Execute BO.28.
  - Add the reverse-order arm.

---

## R3. The level draw

**What I checked and found holding:** the SlotHashes parse (bounded, refuses a zero hash), the 300-slot capture window with A still inside the 512-slot buffer, FIFO, a burned head of queue (subject to R1-1), and the attribute re-supply hash.

### R3-1 · MEDIUM, buyer-facing (accepted limit 26 is WORSE than stated)
**The leader of slot C does not "bias" or "nudge" the draw. It chooses the result.**

- **Why:**
  - The leader schedule is public an epoch ahead.
  - C's group is a fixed function of the mint slot: A lies four groups before C.
  - So any validator can mint, or reschedule a lapsed vault, so that C falls in its own group.
  - Within its four slots it can re-run its block's contents many times, because the bank hash changes with any transaction.
  - Hitting a remaining-5% Level V needs about 20 tries; two vaults in one cohort need about 400.
- **Consequence:** a large validator holding hundreds of groups per epoch could harvest most of the 105 Level V for about 21,000 sats per vault. Every outcome shifts the census everyone else draws from.
- **Further detail:** the leader of B can skip its entire group. That moves C's target by one group, which lets B's leader choose who C's leader is.
- **Holder guide:** HOLDER-GUIDE "one block producer can nudge a draw slightly" is untrue.
- **Evidence:** offline, count the outcomes reachable by varying one transaction's content (each changes the bank hash), and compute `x mod total`.
- **Fix options (owner decision):**
  - Make B's and C's group offsets depend on earlier hashes, e.g. `want_C = group(B) + 2 + (hB[0] % 16)` groups. C's leader is then not knowable at mint time, which restores a stake-share lottery. This is a few lines in `try_capture`, and the 300-slot window still covers it.
  - Otherwise, rewrite limit 26 and the guide as "a validator can choose its own vault's level".

---

## R4. Governance

**What I checked and found holding:** the supermajority, the per-kind marks, the stop-time tie, the tighten bounds, and that no execute can be poisoned by a proposal MINT would refuse.

### R4-1 · MEDIUM (accepted limit 47 is WORSE than stated)
**Under realistic turnout, a thief of the guardian key can hold sales and the sweep shut permanently, not for "a vote plus a week".**

- **Mechanism:**
  - The thief re-stops after every restart and cancels every swap-operator arm.
  - The only cure is YES from half of ALL live vaults within three days. Dormant vaults, lost keys and unactivated holders all count in that denominator, with no way to remove them.
  - The guardian is Gary's single hot Phantom wallet, which is also `INIT_AUTHORITY`.
- **Funds:** no funds are lost; royalty SOL accumulates.
- **Fix:**
  - Restate limit 47 with that condition.
  - Operationally, hold the guardian on a hardware wallet. The ruling allows any key that is "Gary's wallet".

### R4-2 · INFO
The five-action execute is unproven; see R2b-1(h).

---

## R5. The charter claim

### R5-1 · HIGH by consequence (a ruled hot wallet opens a hole the documents do not accept)
**Whoever holds the Moments update authority can kill the entire project permanently, or capture governance.**

The authority is the hot inventory wallet, or anyone who steals its key.

- **Construct:** the chain of dependencies.
  1. `claim_charter_vault` is the only path that creates a vault without a vote.
  2. `create_proposal` needs a live vault and `now ≥ charter_closes_at`.
  3. `mint_vault` needs `round_id > 0`, which only governance can set.
- **Total kill:**
  - An Oracle with burn `CAN_REJECT`, added before or during the window, is shown to refuse in OR.5.
  - If zero claims land, no proposal can ever exist, so no round, so no vault, for ever. The programs are locked before the window opens (`lock_deadline < charter_opens_at`).
- **Capture:**
  - Core oracles support per-asset and per-owner base addresses. The hot wallet can also flip the oracle's data between its own claim transaction and everyone else's.
  - Either way it can approve only the Proofs of Burn it owns.
  - Its vaults are then the whole electorate. One vault is 100% of quorum, threshold, turnout and "half of all".
  - It can then arm a swap operator, retire the guardian, set boost terms, and control every later round's cap and price, which lets it keep control.
- **What the documents say:** limit 46 states the cost as "every charter member", which understates it.
- **Evidence:** extend the OR fixture.
  1. Keep `ORACLE_NO` installed through the close.
  2. Show that `create_proposal` is impossible and `mint_vault` refuses `NoRound`.
  3. Then allow one claim and show that a single vault executes `ArmSwapOperator`.
- **Fix options (Gary's call; listed, not argued):**
  - Move the Moments update authority to a cold key or multisig for the window.
  - Keep the upgrade authority, timelocked in a multisig, until a successful charter.
  - Redesign the coupon as a Merkle snapshot of holder wallets, so the claim does not depend on Core accepting the burn.
- **Minimum:** rewrite limit 46 so it names the brick and the capture.

---

## R6. Initialize and the trusted hop

### R6-1 · LOW (process)
**Wrong `initialize` values are correctable until step 11, and nothing makes that window count.**

- **The claim:** SPEC 38 says "written once and can never be corrected".
- **Why it is not quite true:** step 10 (initialize) comes before step 11 (lock). A wrong value can be fixed by upgrading while upgradeable.
- **What is missing:** nothing makes "the on-chain configs equal `mainnet-init.json`" a hard gate between steps 10 and 11. No `initialize` sender exists, and the checker validates the JSON, not the transaction actually signed.
- **Fix:** gate step 11 on a decode of all four live configs, field by field, against the JSON, run by two people.
- **INFO:** MINT accepts any SEAL reserve as `payment_mint`, including $GARY.

### R6-2 · MEDIUM, doc / holder-facing
**HOLDER-GUIDE says royalties give 85% to vaults, "fixed forever", without saying royalty SOL passes through a trusted key.**

- **What is undisclosed:** a key that can keep up to 10 SOL per 6 hours until the guardian stops it, plus the Jupiter response (limit 10).
- **Fix:** add this to the guide's honest list.

**Holding:** the royalty plugin is immutable (`PluginAuthority::None`, and MINT's update-authority PDA signs only fixed CPIs). The rate ring is exactly a rolling window: the k-th most recent entry is `ring[(head + 64 − k) % 64]`, with k capped at 64.

---

## R7. Raw offsets (recomputed)

All match the struct layouts.

**MintConfig**
- version 8, governance 41, pool 73, minted_total 141
- stop flags 191/192, guardian 193, sol_reserve 257, max_sweep 266, cooldown 274
- charter_closes 442, bare_retired 454, acc 478, owed 494, last_dist 510
- stopped_at 518/526, monthly 574
- floor/ceilings 631/639/647, dist_epoch 655
- cbob_mint 679, max_boost_w 711, max_boost_e 712
- ring at 749–1005; the space constant gives 1005 + 256

**VaultRecord:** pending 177, request_epoch 178, boost_w 186, boost_end 187, carry 195; total 211 + 10 = 221.

**BurnConfig:** burned_total 42, window 50, head 58, ring 59.

**GovConfig:** proposal_count 53.

**Proposal space:** 267 bytes. `ACTION_MAX_BYTES` 37 is correct.

---

## R8. Suite and simulation as evidence

- **R8-1 · LOW.** 10.5, 10.6 and 10.6a cannot tell whether the four captures ran.
  - `crank` silently skips `NotYet` and non-records.
  - The `unset` check is trivially 0, because a simulation never writes.
  - SPEC 54's 518,929 CU, which binds the holder pages, is unasserted.
  - **Fix:** assert the simulated cost is at least base + 4 × 100,000 CU, or count logged captures.
- **R8-2 · LOW.** P.32 checks pool ≥ owed at a single point. `books()` runs only in section BO.
  - **Fix:** call `books()` after every money operation in sections P, IN and 3c.
- **R8-3 · LOW.** Sim S7.4 accepts any `0 < paid ≤ avail`, so an underpayment passes.
  - **Fix:** with only TV joined, require `paid == avail`, or `floor(avail·w/W)`.
- **R8-4 · LOW.** BURN's ring is never exercised at k near 64; the suite's cap is ≤ 2 and there is no host test.
- **R8-5 · INFO.** R.4's regex cannot see `permanentFreezeExecute`, `appData` and similar kinds. `CollectionNotClean` covers this on chain.
- **R8-6 · INFO.** The F22 repair is partial, as disclosed:
  - 9.13 is still pinned to a `0x0` code rather than the "already in use" log line;
  - RL.7 remains looser than the per-redemption cap.

---

## The four questions about the accepted limits

1. **Worse than stated:**
   - **26** (R3-1) is selection, not bias.
   - **46** (R5-1) can brick or capture the whole project, not just harm charter members.
   - **47** (R4-1) can be permanent.
   - **40** depends on a tombstone layout, not just `BurnV1` semantics (R1-1).
   - The "one attempt fails" copy in HOLDER-GUIDE understates sustained griefing. SPEC's own figure is about 0.045 SOL/hour per targeted holder.
2. **Listed as limits but not defects:** 35 is a non-binding rule; 45 and 49 are design choices. They belong in "Known limits", not the findings carry list.
3. **Discharged but not discharged:** none failed my reading.
   - 12/17 is now caveated correctly.
   - 11's "P.32 asserts" is weak evidence. The property itself holds by construction (R2).
4. **OPEN items quietly treated as accepted:**
   - **51** contains accepted text ("Boost timing (accepted, disclosed)") and reads as done.
   - **53** says "ADDRESSED" and **54** says "MEASURED" while sitting in OPEN AND BLOCKING with no exit criterion. Each must be either blocking, with a named exit, or moved.
   - **50** says "Gary may rule otherwise", which is the demotion path the section forbids.

---

## Other document faults

**HOLDER-GUIDE**
- "Only you can open it… Not Gary Club" is false for custodial Gary Club wallets, which the guide itself recommends.
- "Nudge slightly" (see R3-1).
- The missing royalty-hop disclosure (see R6-2).

**DESIGN-v6**
- Still says `sha256(slot_hash || asset)`; the draw now hashes three slot hashes.
- Still says "two outcomes, not many" for a skip.
- Still lists the PoB mint address and token program as "OPEN"; Proofs of Burn are Core assets.
- Still says "~512 slots (~3.4 min)"; the capture window is 300 slots.

**SPEC**
- The MINT instruction table omits `boost_vault`, `expire_boosts` and `set_boost_terms`.
- The `initialize` row omits `max_boost_weight`, `max_boost_epochs` and the `cbob_mint` account.
- "Results are pending" contradicts the road table's "done, 60/60".

---

## Before launch: what AI audit structurally cannot do

1. **Property-based fuzzing of MINT on the host.** Run millions of random interleavings of activate, distribute, claim, boost, expire and both retires, with 2,100 vaults, through `boosts_due` and ring wraps past 64. Check `books()` and `pool ≥ ceil(owed)` after every step. Then Kani or proptest proofs of `reweigh`, `credit` and `unschedule`.
2. **Measure the C-leader grind** on a private validator with a patched leader. This turns limit 26 from rhetoric into a number before the copy is written.
3. **Run the suite against Metaplex Core's current main branch, not just the pinned build.** Ask Metaplex in writing whether the burn tombstone and `CompressV1` are stable. This decides R1-1.
4. **Verifiable build.** Deploy reproducible artifacts (solana-verify), and have a second person compare the on-chain hash with the build.
5. **Post-initialize config diff as a hard gate before step 11**, signed off by two humans reading decoded on-chain state.
6. **A paid bug bounty on the dress-rehearsal deployment**, with real seeded cbBTC, run while the programs are still upgradeable.
7. **Key ceremonies:**
   - Guardian and `INIT_AUTHORITY` on hardware.
   - The $CBOB release wallet off the box.
   - The Moments update authority cold for the charter window, or an explicit written acceptance of R5-1.
8. **Live-cluster chaos runs of the crank:** RPC failures, partial batches, and holding the every-minute reveal lane under load (item 22). Include a deliberately induced reschedule.
9. **An executed audit of `bank/`.** It was absent from this bundle, so this round certifies none of its repairs. `scripts/audit-coverage.sh` should have refused to send this bundle.