# Round 45 off-chain audit: second independent read of the tree after round 44's repairs

I read this by hand. I ran no code, so the evidence below is source reading. Where I describe a state you can measure, I say what to look for.

**Bottom line.** I found no CRITICAL, HIGH or MEDIUM defect in the off-chain pipeline, and nothing that moves value. I found one LOW and three INFO. All four are in the fixable layer, and I class none of them under launch-gate (a)-(d). Two items are carried gate-5 or open-item obligations that I think are stated too weakly.

## R0. Round 44's repairs, checked at every site of their shape

| Repair | Does it hold? | Notes |
|---|---|---|
| **V44o-1**, the poster's per-signature unread count | Holds. | `redemption-poster.mjs` now deletes only the count of the signature just read. In drain and gap mode the state is saved before the throw without a backlog, so the same window is re-walked. The third run queues the signature as REJECTED. |
| **V44o-2**, the revenue job's split scan | Holds. | `splitsSince` collects a refused read in `.refused` and keeps scanning. Recovery closes the cycle on a readable split. A cycle still open after a refused read throws, naming the signature. |
| **V44o-3**, a null SEAL config in the alarm's balance block | Holds for the balance block. | It is incomplete at two sibling sites; see F1. |
| **V44o-4**, the runner's no-network exit | Holds. | Both skip branches are now an `if`. |
| **V44o-5**, rehearsal notice labels | Holds. | `rehearsalNotice` is applied at all three crank notify sites and at the revenue site. |

**Does the reader-throws shape still exist elsewhere?** I traced every caller of `readParsedTransaction`. The alarm walk, the poster and the revenue scan all catch or collect a refusal, and `blockTimeOf` has a try/catch. The probe script is a developer tool and aborts on a throw, which is acceptable.

## R1. The crank

I checked each instruction's account list and writability against the Rust `Accounts` structs: reschedule, capture, reveal, rescue_nested, retire_burned, claim, expire_boosts, split_revenue, distribute and activate. All match.

- **Rescue.** The key order matches `RescueNested`. `planRescues` plans only live, nested vaults whose host is the vault itself, a live vault, or a burned asset. It never plans a foreign host (the program would refuse it as `HostUnresolved`).
- **Join before distribute.** The pre-joined vault's owed amount uses the old accumulator as its debt. That matches the program's `join`, which sets `debt = w × acc` at the current accumulator.
- **Expired boosts.** The expiry arithmetic matches `reweigh` and `expire_boost` (carry plus the level weight times the accumulator delta). Retiring a boosted vault is excluded from pre-expiry, which matches `unschedule_boost`.
- **Money paths.** I found no plan the program would refuse. I found nothing that sends value anywhere the program does not pin.

## R2. The alarm

- Every `WATCH` key is populated by `readConfigs` (64 MintConfig fields).
- `mint.guardian`, `swap_operator`, `pending_*` and the PoB collection's plugin hash and update authority are all watched.
- All five programs are covered for upgrade authority and bytes.

I found a quiet-read hole at two sites, one of which pages falsely (F1). A different hole is in item 22.5 (F2).

## R3. Layouts

I recomputed these by hand:
- The VaultRecord body is 203 bytes. With the 8-byte discriminator that is 211, and with the 10 bytes of padding it is 221.
- `minted_total` sits at offset 141.
- The SEAL, MINT, BURN and GOV field order matches the Rust.

The assertions are real: a field or type change in the Rust fails the parser comparison.

## R4. Arithmetic

`credit`, `claim`, `retire`, `join` and `owed_of` mirror the program line for line. The 85/15 split constants match `split_revenue`. I found no divergence.

## R5. Swap and revenue

**(a) Oracle math.** `sats = lamports × sol × 10^(es−eb) / (btc × 10)`, rounded down, then 150 bps off. Exponents are bounded to −18..0. This is correct.

**(b) Pyth.** Offsets 40, 41, 73, 81, 89 and 93 are right. The account is derived, owner-checked, requires Full verification, and is judged against the Clock sysvar. The push oracle will not store an older `publish_time`, and the 180 s age bound is pinned in literals.

**(c) Deviation filter.** `orcaSpot` and `meteoraSpot` are both in sats per lamport and in the right direction.

**(d) Floor.** The oracle floor is the same one the deviation filter assumed, in output sats. It is the exact `other_amount_threshold` / `min_amount_out` the judge pins.

**(e) Judge.** It pins all seven instructions, the amount, the floor, the direction and price limit, the signer slot, and the output account. A tampered builder could still route two things past it. Meteora's optional `host_fee_in` (key 9) is unpinned, which is limit 10(c) and costs a sliver of the fee. A different venue-owned vault, tick array or bin array is rejected by the venue program, not the judge.

**(f) Derivation.** Orca's tick arrays run current then two below, with floor division for negative ticks. Meteora's bin arrays run current then two above. The account orders match both IDLs. An uninitialised array fails loud in the venue program.

**(g) wSOL.** A pre-funded wSOL ATA is harmless: SyncNative sets the balance, the close returns the remainder, and the DeepSeek wedge claim is false for a native account.

**(h) Retry.** A refusal is never inferred without a status lookup; see F3. The ledger stays open until a return is proven, and the delta is balance-based, so a double count is not possible.

**(i) Extraction.** Pool deviation up to 100 bps is allowed, and the floor is 150 bps under the oracle. The worst fill is therefore about 150 bps under the oracle, or about 250 bps under a pool already pushed to the gate. At 10 SOL per cycle and roughly 34 SOL per day that is on the order of tens of dollars a day. That is immaterial at ruled sizes.

## R6. Gates

I found no arm that cannot fail among the ones I examined. One coupling is worth stating (F4).

## Findings

**F1. LOW. Two sibling sites of V44o-3 still read SEAL's config unguarded.**

*Construct.* In `alarm.mjs` `main()`, `ataOwner` and `atas` are built from `cfg['seal.reserve_mints'] || []`. The same expression feeds `reconcile()`'s `expected` set. `readConfigs` turns a null SEAL account into `seal._missing` and the pass continues. Round 44 repaired the balance block only.

*Effect.*
- In a one-pass blip, `atas` is empty. Any canonical reserve-ATA creation seen in that pass is reported as `non_ata_token_account` CRITICAL, a false one-shot page.
- `ataOwner` is empty, so `detectApprovals` loses its owner fallback.
- In the daily `--reconcile`, `expected` is empty. Every vault's canonical reserve accounts become `undeclared_token_account` CRITICAL, up to roughly 6,300 findings, truncated in the notice.

The effect is a false alarm. It cannot hide a real finding, so this is noise rather than a blind spot. The config-drift page does fire on the same blip. Class: none (a)-(d).

*Evidence if I am right.* Run the alarm or `--reconcile` with `getAccountInfo(SEAL_CFG)` stubbed to return null. Expect `non_ata_token_account` or `undeclared_token_account` in the output.

*Fix.* Use `D.carryConfigBaseline(prev?.config, cfg)['seal.reserve_mints']` at both sites. Or end the pass the way a null MINT config does (`config_vanished`, state not advanced). Add a gate-5 arm shown red.

**F2. INFO. Item 22.5's consequence is understated, and the correlator would not cover it.** SPEC frames 22.5 as "settle whether DAS sets `burnt`". If DAS drops burned Core assets from `getAssetsByGroup` instead of flagging them:
- `detectIndexShortfall` requires `live + burnt = minted_total`. It would page CRITICAL on every pass after the first redemption and never clear, because the chain count never falls.
- Every honest redemption would also page `vault_left_index`. `correlateBurns` deliberately does not downgrade that kind; the allowlist is the four noise kinds.

So an unmeasured DAS behaviour could make the post-hoc half of the control table permanently noisy from the first redemption. This does not move value. It matters because nobody can fix it after launch if the alarm is then ignored. Add this consequence to item 22.5 and settle it before road step 8.

**F3. INFO. A swap whose confirmation timed out and whose status lookup returns null after expiry is judged "refused".**

*Mechanism.* In `classifySendFailure`, `!st && expired` returns `refused`. On a load-balanced RPC, a lagging node can show no status for a transaction that landed in its last valid slots. The next venue is then tried.

*Bound.* The second wrap needs more operator lamports than the float holds, so for an ordinary sweep it fails loud. Only a sweep at or near the 0.01 SOL minimum could be swapped twice, and the second swap spends the float and returns inside the same delta. Not a loss, but "never on an unconfirmed send" is slightly overstated. A cheap hardening is to re-read the status after a short delay, and to check the operator's wSOL and cbBTC balances before trying venue two.

**F4. INFO. The detector selftest depends on the audit-coverage freeze gate.** `selftest.mjs` runs `audit-coverage.sh --selftest` and expects exactly `19/19`. That script reaches its `never` check, which exits 1 when any tracked file has never been bundled, before it reaches the `--selftest` branch. So committing a new file before a prompt bundles it turns the whole detector gate red. The script header says this is a freeze gate, not a build gate. Move the selftest branch above the `never` check.

**Answers to the four questions on accepted limits**
1. *Anything worse than stated?* Item 22.5, as in F2. I found no other limit worse than written.
2. *Anything listed as a limit that is not one?* I found no limit that is actually closed.
3. *Any DISCHARGED item not discharged?* None.
4. *Anything in OPEN AND BLOCKING quietly treated as accepted?* No. Items 22.4 and 22.5 are the ones that still need running.

**Carried gate-5 obligations still open.** Round 43's items 4 and 5 are still not discharged: the `pdas`/`atas`/`assets` block on a shrunk index pass, and the Meteora bitmap `owner` premise (`bitmapExists: !!bm`). The same SEAL-null fix covers part of item 4.

**Web tests.** `bundle.test`'s "refuses today" arm only compares two computed lists. It would pass if both were empty, and it is pinned elsewhere by the ceremony test. Optional.

## What this project should do before launch that AI audit structurally cannot

1. **Measure the DAS `burnt` behaviour** on a real collection holding a burned Core asset (22.5). Then decide how `vault_left_index` and the index count behave after the first redemption.
2. **Run the dress rehearsal live** and record signatures: the crank against 5 vaults, one revenue cycle through each pool, and the forced post-sweep failure walked through the hand recovery.
3. **Have a human read the exact bytes Phantom will sign.** Check each `initialize` transaction against `launch/mainnet-init.json` before signing, and the guardian wallet's `emergency_stop_sales` against a simulation.
4. **Rebuild the five binaries from the release commit on a second machine.** Compare the sha256 to `dist/SHA256SUMS`. After deploy, dump all five and check the prefix hash and the zero tail. Do this before and after step 11.
5. **Test the delivery path, not the detector.** Page the on-call channel with a real CRITICAL, `ALERT_URGENT` and a recovery, and have someone confirm receipt and know the guardian action to take.
6. **Restore from backup.** Prove the nightly backup restores `bank/keys/*` and the ledger, and that the deploy-authority key can actually sign step 9 and step 11. Losing it before step 11 means new ids and a program change.
7. **Settle custody questions by human decision, not AI audit.** The hot Moments update-authority key through the charter window, the $CBOB release wallet, and the swap operator float.
8. **Plan for failure after step 11.** Name who can pull the guardian stop, who returns rescued vaults from the Squads, and a communications plan if Core or cbBTC changes underneath.