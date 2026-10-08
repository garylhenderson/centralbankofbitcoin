# Round 37 off-chain audit

I read the tree whole and ran nothing. Every claim below is a source reading. Where a claim could be wrong, I say what a run would show. I found no CRITICAL, HIGH or MEDIUM defect. I confirmed one LOW and recorded four INFO items.

---

## R0. Round 36's verdict and repairs

**The repairs are present and hold.**
- **L4** (`ACKABLE_KINDS`): the set is now `unredeemable_owner` only. `applyAcks` refuses an ack on any other kind and leaves it at full severity. That is the loud direction.
- **L3** (`unredeemable_owner` text): it now names the host-owner execute and the `rescue_nested` path, and no longer says "sealed for good".
- **L1, L2, L5** (SPEC text): item 44's heading, the C5 bullet, the round-29 D2 passage and the index-lag limit now match the code.

**I agree with the disproofs.** C06 holds: web3.js 1.98 makes the first signer the fee payer, and the compiled header marks it as a signer, so `isSigner:false` in the key list is overridden. C07 holds: Anchor's `declare_id!` generates `test_id`, which accounts for the sixth host test.

**New finding in R0's own scope: the L4 repair made three selftest arms vacuous (LOW, R6).**
- **Where:** `bank/selftest.mjs`, the ack block.
- **The arms:**
  - `` `true` is not an ack ``
  - `an empty reason is not an ack`
  - `acking one KIND does not ack another on the same asset`
  - All three drive a `nested_vault` finding. Before L4 that kind was ackable, so each arm proved a property of `judgeAck` or of the key scheme.
- **Why they are vacuous now:** `nested_vault` is no longer ackable, so `applyAcks` returns it CRITICAL whatever `judgeAck` says.
- **Consequences:**
  - The empty-`why` and non-object guards in `judgeAck` now have no arm that can fail.
  - The only arm for the `kind:asset` key scheme (which would catch an ack applying across kinds) is blind.
  - The still-live `unredeemable_owner` arms cover a bare string and a missing expiry. Nothing covers `true` or an empty reason there.
- **Evidence if I am right:** make `judgeAck` return `ok:true` for `true`, or for `why:''`, and the selftest still reports 920/920.
- **Fix:** rewrite the three arms on `unredeemable_owner`. Add one arm for the cross-kind case that pairs `unredeemable_owner:A` with a differently-kinded finding. Add a `judgeAck` unit arm for empty `why`.
- **Grading:** this is a test-gate regression, not documentation, so it does not qualify for the gate-3 documentation carve-out.

---

## R1. The crank

I recomputed the account order of every instruction against the Anchor `#[derive(Accounts)]` structs and found no mismatch. I also recomputed these planner arithmetic points:
- `expire_boosts` takes `config` plus records.
- `distribute` takes `config` plus the pool.
- The `split_revenue` key order matches.
- `reveal_level` and `capture_entropy` match.
- `owed` for a pre-expired vault equals `carry + LW·(acc − acc₀)`, which is what `reweigh` leaves.
- `retiringOwed` follows `retire`.
- Joined-now debt is `w·acc`.

**No plan found that the program will refuse.**
- **Order and gates:** the send order is retire → pre-joins → expire → split → distribute → post-expire → activate → claims. It respects `JoinWaitingFirst`, `BoostsExpireFirst`, and the in-line run waiting on both.
- **Dead vaults:** a positively burned vault is retired first and never joined or paid.
- **Reveal order:** it is strictly FIFO from `revealed_total`, and it stops at the first vault that is not ready.
- **Value movement:** the key signs only as fee payer, and no instruction other than MINT's is built.

**INFO-1 (design, not a defect): there is no automatic resume after a post-sweep failure.**
- **What happens:** after the sweep lands, `m2 = market()` can throw, because the oracle is stale or the RPC blips. It can also throw the `MAX_REQUOTE_DRIFT_BPS = 200` drift check, which treats a 2% oracle move in minutes as fatal. In either case the SOL stays on the operator key. The row has `sweptLamports` and no `swapSig`. The next hourly run stops at the open-cycle guard until a human recovers it.
- **Why it is noted:** this is limit 10's stated hand recovery, so I do not file it. But the drift gate adds nothing the on-chain floor lacks. The floor is re-derived from the fresh oracle, so aborting only strands SOL on the hot key for longer.
- **Evidence:** a row with `sweptLamports`, a `cbob-revenue:swap` page, and `--audit` listing it.

---

## R2. The alarm

I found no dangerous on-chain state that the code reads as quiet among the items the brief lists. The checks I walked:
- Fixed-forever drift, including `cbob_mint` and the boost bounds.
- Pending guardian and pending swap operator.
- PoB collection plugins and update authority.
- Redemption window.
- Pool frozen and pool insolvent.
- Distribution overdue.
- Upgrade authority for all five programs, using the earlier of the file deadline and `charter_opens_at`.
- The production values.

Flatten and stringify give `"945,525,…"` and `"1000000000"`, which match the pin strings. No routine state pages every pass. The standing INFO kinds do not page.

**INFO-2: nothing watches the $CBOB release wallet.**
- Limit 56 and HOLDER-GUIDE disclose that the key is hot. Neither says that movement out of the wallet is not detected.
- A thief selling the unreleased supply would page nothing.
- Release is an act of the same box, so no detector could tell theft from release without a release log.
- This is not a finding against a promise, but it is a quiet dangerous state.
- A watch on that one token account's balance, with the Bank's own release acts logged as the expected cause, would close it.

---

## R3. Layouts

I compared `MintConfig` field by field with the Rust struct, including the 64-slot `boost_expiring` ring. I did the same for `VaultRecord`, `BurnConfig`, `GovConfig` and `SealConfig`, and for the `OFF_*` offsets. They match. The selftest asserts the field lists, every scraped `OFF_*`, the PDA seeds, the layout versions, `BOOST_RING`, and the allocated space against the layout's fixed length. A struct edit that is not mirrored would turn the build red. `RESCUE_SEED` is absent from `L.SEEDS`, and no off-chain code derives it, so that gap is harmless.

---

## R4. Money arithmetic

`credit`, `owed_of` (carry added before the debt), `reweigh`, `ceil_sats` and the claim `floor` match the Rust. The 85/15 cut is hard-coded at `1500n` in the crank, which is the known C27 limit and is safe given `split_bps` is immutable. I found no divergence. The crank expires due boosts before the distribution and the boosts made due by it afterwards. `boosts_stalled`, `cbob_mint` and the bounds are watched.

---

## R5. The swap and revenue cycle

**(a) Oracle math.**
- The formula is `lamports·solP·10^(es−eb)/(btcP·10)`, which is correct for every exponent sign.
- Rounding is down.
- `satsPerLamport` stays inside 2^53 (BTC price about 8.6e12).

**(b) Pyth.**
- The offsets are correct: verification tag at 40, feed id at 41, price at 73, confidence at 81, exponent at 89, publish time at 93. `Full` is tag 1.
- Ownership by the receiver plus a derived address is sufficient to know a Wormhole-verified message wrote the account.
- An attacker can only choose among real, signed prices inside the 180 s window. I believe the push oracle also refuses a non-newer update, but I did not verify that.
- The age is judged on the Clock sysvar, read in the same call, at byte 32.

**(c) Deviation filter.**
- Orca's spot is `(sqrtP/2^64)²`, in sats per lamport.
- Meteora's spot is the inverse of `(1+s)^id`, with X = cbBTC and Y = wSOL.
- Both directions are correct.
- A degenerate pool gives NaN or Infinity, and `<=` refuses those.

**(d) Minimum out.** The same `minSats` rides in Orca's `other_amount_threshold` (offset 16) and Meteora's `min_amount_out`. Both are in cbBTC sats. The 100 bps gate sits inside the 150 bps floor. A pool 99 bps unfavourable plus a 16 bps fee passes the floor, and a thinner Meteora impact can refuse, which is safe.

**(e) Judge.**
- It requires exactly seven instructions with exact keys and data for 0–4 and 6.
- For the swap it pins the pool, the operator's wSOL input, the operator's cbBTC output, the signer, the amount, the floor, and Orca's flags and price limit.
- It does not pin vaults, tick arrays, Meteora `host_fee_in` or the mints. The pool programs validate vaults, tick arrays and mints against the pool.
- `host_fee_in` can only redirect part of the protocol fee, not the user's output.
- Compute-budget instructions are limited to `SetComputeUnitLimit(400,000)`.
- I could not construct a tampered but accepted transaction that moves operator value anywhere except through the pinned pool.

**(f) Derivations.**
- The Whirlpool offsets are right.
- The tick-array order is current, then the two below, with a floor-based start index.
- The Meteora bin arrays, bitmap, oracle and event authority are right.
- An uninitialised array makes the swap revert. That counts as a refusal and falls through to the next venue.

**(g) wSOL handling.**
- Only an ATA program account can sit at the derived address.
- A stranger's gift adds to the balance, but only `amt` is swapped.
- The close returns everything.
- A freeze on the cbBTC ATA reverts the swap with the SOL still on the key, and the cycle stays open.

**(h) Failure and retry.**
- Timeout errors carry `signature`, so the status lookup runs. They are not named "expired", so they classify `unknown` and the cycle stays open.
- Only "refused at preflight", "landed and failed", and "expired and absent" move to the next venue or close the row.
- A second wrap cannot be funded: the operator holds about the float.
- Residual: the status lookup that decides "expired and absent" goes through the one RPC. A lagging node could call a landed sweep refused. The alarm's `unledgered_sweep` would then fire. This is limit 10(b), already stated.

**(i) Extraction.**
- Per cycle the maximum is about 1.5% of the swapped notional.
- At 10 SOL (about $1.5k) that is about $22.
- With the cooldown that is four cycles a day, about $90 a day, so roughly $30k a year at the same SOL price.
- It is bounded by the floor, not by pool depth. A Meteora manipulation cannot exceed the same 150 bps, because Meteora is only used if Orca refuses.
- I do not see this as material against the revenue it protects.

**Operator key, worst case:** unchanged. It is the cap times the number of cooldown windows before the guardian stops the sweep, plus the one swap's floor loss. The ledger cannot read a failed cycle as closed: `cycleIsOpen` requires a return and a split.

---

## R6. Gates

**Beyond the LOW above, I found no further arm that cannot fail.** Floors equal counts: 920/920, 39, 24, 14, 49, 33, 4, 16, 6, and 895 on chain. The new C06 arm extracts and compiles the real sweep statement, so it can fail. The router-grace arm fails closed if the router file is missing.

**INFO-3: a timing assertion can flake.** `ms < 8000` in the R34 L1 arm can flake on a loaded box. This box runs about 19 cron jobs, and a red on speed would read as a defect.

**Other gates read clean:**
- `build-mainnet.sh` compares the sweep helper's bytes with the localnet build and with `target/deploy`.
- It asks the other four for their key behaviourally.
- `cron-install.sh` arms nothing without a preserved, tagged, uncommented `--live` on the exact job. The `crank` match is end-anchored, so it does not match `crank-reveal`.

---

## The accepted limits

**1. Anything worse than stated?** No. One addition to limit 10: the floor is BTC/USD, not cbBTC/USD. A cbBTC depeg beyond 100 bps makes both pools skip, which wedges the cycle with the SOL on the key. That is a loud failure, not a loss.

**2. Anything listed as a limit that is not one?** Limit 36 and limit 7's "survivable stall" language are true only while the crank or traffic joins waiting vaults. Absent both, the monthly in-line run never fires. The text already says this, so I record it, not a defect.

**3. Any DISCHARGED item not discharged?** None found. The off-chain reading is consistent for 51, 54, 19 and 33.

**4. Anything in OPEN AND BLOCKING quietly treated as accepted?** No. Items 22, 38, 50, 52 and 53 are all still described as blocking. Item 53 says the rehearsal value set and its checker mode are not yet written, so step 8 cannot yet run on its stated terms. Nothing treats that as accepted.

---

## GIVEN THAT NO HUMAN FIRM WILL SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **A human reads the signed `initialize` transactions** before each is sent. Compare the serialized arguments with `launch/mainnet-init.json` byte for byte. `check-launch-params` validates the JSON, not the signed transaction. The byte-for-byte check can be done by a second person on an air-gapped machine.
2. **A reproducible build on a second, independent machine** that you did not build on. Match the `dist/` sha256 values and the rehearsal bytes, and re-check the prefix hash and zero tail after the step-9 upgrade. This removes the risk that this box's toolchain or cache is subtly wrong.
3. **Run the dress rehearsal in full** (item 22) with small real money. That includes one revenue cycle through Orca and one forced onto Meteora, and the forced post-sweep failure walked through the hand recovery. No AI round can substitute for a live cluster with real Pyth, Orca and Meteora accounts.
4. **Move the keys that become permanent risk to hardware or a multisig before step 11:**
   - the deploy and upgrade authority, which currently sits as a file on the box and in a backup;
   - the guardian;
   - the $CBOB release wallet (item 56).
   - Rehearse a key loss.
5. **Perform one real small redemption through the published page on mainnet-shaped state before step 11.** Include the paths the suite cannot reach: a frozen destination, a Token-2022 stray, a nested vault, and a pool freeze. After step 11, nothing on the page can be corrected by changing a program.
6. **Settle the one choice that is still a program change** before the lock: whether `mint_vault` should require a top-level signature (limit 43). It cannot be revisited afterwards.
7. **Put the alert delivery path through a drill.** Pull the guardian brake on a rehearsal deployment and confirm the page reaches a human within minutes, from a phone, off this box. The deadman and the router are in the same trust domain as everything they watch.
8. **Name a person and a procedure for the first hours after a real `CRITICAL`.** That means who holds the guardian wallet, where it is, and what they do. The immutability makes every other response unavailable.