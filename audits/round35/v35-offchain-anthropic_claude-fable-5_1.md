# Round 35, OFF-CHAIN pass: independent audit of the whole tree

Method: every file in the bundle was read whole and cross-checked against MINT's source for each instruction the crank, alarm and revenue job send or decode. Nothing was executed here; every finding below states the evidence a run or a stub would produce, so it can be measured before anyone acts on it. Where I reasoned my way to a defect and then found the live ordering makes it unreachable, I say so and leave it at INFO rather than file it.

---

## R0. Round 34's verdict and its repairs

**Verdict re-read.** Round 34 was NOT CLEAN (three LOW, one INFO). I independently checked its confirmed findings, its rejections and its repairs against this tree.

| Item | Independent result |
|---|---|
| L1 (`seenSplits` growth) | Repair holds. `sortedSplits` dedupes, filters and sorts once per list (WeakMap keyed by array identity + length); `closesCycle` binary-searches the anchor and scans forward; `detectSplitHistoryGrowth` pages `split_history_large` above 50,000. The cache key is sound for the alarm's usage (arrays are built fresh per pass, never element-replaced in place). The round chose paging over pruning; stated in the VALIDATION. |
| L2 (Token-2022 "0 units") | Repair holds. `reconcileAmount` reads the base field for `TOKEN22_ID`, labels it, returns `unreadable` otherwise; the reconcile loop passes `account.owner.toBase58()`. |
| L3 (split recovery from box clock) | Repair holds. `since` is the min of `returnBlockTime` where present, else `Date.parse(returnedAt)`; the residual for rows without a chain time is stated in SPEC limit 10. |
| D1 (SPEC 53 "five programs") | Repaired: SPEC and `rehearsal-tree.sh` both now say four keyed programs plus `bank/layout.mjs`. |
| C12, C13, C16, C17, C20, C21 (rejections) | Each rejection is correct on the current source (`if (poolOk && !pool.frozen)` gates claims; `budgetPlan` keeps the FIFO head; `avail` is u64 so `avail × 10¹² ≤ 1.8e31 < u128::MAX`; `run-tests.sh` invokes `sim/swap-fork.sh`; `build-mainnet.sh` rebuilds both target dirs and `cmp`s the helper three ways). |
| Floors | `FLOOR = 912`, `DET_FLOOR=912`, `MIN_ASSERTIONS=871`, `SWAP_FLOOR=16`, `EXPIRY_FLOOR=4`; all equality-checked. |

**What round 34 did on mainnet changes the alarm's steady state, and nothing says so.** The five program ids are now claimed with an upgradeable placeholder (authority `FZjLB4…`, a box key). Consequences for THIS code, none of which is a defect but all of which are operational facts the launch runbook should carry (INFO, see also R2):
1. `detectUpgradeAuthorityAfterLock` in production fires `lock_deadline_unset` CRITICAL on every pass from the moment the alarm is installed until `lock_deadline` is set in `launch/mainnet-init.json`, because all five `prog.*.upgrade_authority` now read as a real key. Intended since round 22 A5, but previously dormant.
2. The alarm's first production baseline will record the placeholder's `prog.*.hash`; the real deploy pages `config_drift` CRITICAL for all five. VALIDATION says baselines are re-taken; the SPEC step 9 text should name the exact procedure (which state fields, by whom).
3. The road table says each step completes before the next starts; step 9 has begun (ids claimed) before steps 7 and 8 completed. Recorded, approved, but the key `FZjLB4…` is now a launch-critical asset on the same box as the operator, crank and release keys, and no document lists its custody or backup beside limit 56's.

---

## R1. The crank (`bank/crank.mjs`)

Verified against MINT: instruction account orders for `reschedule_reveal`, `capture_entropy`, `reveal_level`, `retire_burned`, `claim`, `expire_boosts`, `split_revenue`, `distribute`, `activate` all match the `#[derive(Accounts)]` structs; discriminators computed; the plan's `w`, `owedAfterRetire`, `acc` and per-vault `owed` reproduce `credit`, `retire`, `join`, `reweigh`/`expire_boost` and `owed_of` exactly, including the pre-expiry (`carry + W·Δacc`) and post-expiry cases; `claim`'s own `monthly_inline` cannot credit ahead of the crank's distribute because the join batches precede it and `waiting_to_join > 0` makes the inline run return; the tick path's `pending_this_epoch − retiringThisEpoch` mirrors `retire`'s decrement; `MonthNotElapsed`/`NothingToDistribute`/`BoostsExpireFirst`/`JoinWaitingFirst` are judged against a fresh config read; reveals run from `revealed_total` and stop at the first non-send. No plan the program refuses for a reason the crank could have known, no reveal out of order, no instruction that moves value anywhere but a pinned destination.

### M1 (MEDIUM): the crank activates, joins and pays vaults whose owner can never redeem them, making round 29 D2's permanent dilution happen by our own hand

**Construct.** `planCrank` activation filter (`r.level === 0 || r.active || r.pending || r.retired || assets[r.asset] !== 'live'`) and the pre-join/join filters consider only whether the Core asset is *alive*. `main()` builds `assets` as `'live' | 'burned' | 'other'` and discards the asset's owner bytes (`data[1..33]`), which it has already fetched.

**What is gained / lost.** A vault whose Core owner is (a) its own asset-signer PDA (proven impossibility 3, bricked), (b) another CBOB vault's asset-signer PDA (nested, unredeemable while there, destroyed if the host is redeemed), or (c) any off-curve address (a DAO/Squads; recoverable only by that program's transfer) holding ≥ 21,000 sats of cbBTC is activated by the hourly pass within an hour of funding, joined at the next distribution, and paid into its own reserve account on every pass thereafter. For (a) and for (b)-with-a-burned-host that is exactly the state SPEC records under "What got worse" (round 29 D2): weight 2–6 (+ boost) in `total_active_weight` forever, every distribution's share of it paid into an account nobody can ever sign for. The accepted-limit text says "nothing on chain can undo it"; it does not say that the first thing to *do* it is our crank. The honest accident this matters for is a holder sending vault B to vault A's deposit address (the guide warns against exactly this): B is activated an hour later, A is later redeemed through any client that is not the unbuilt page, and B becomes a permanent tax on every other holder.

**What this does not fix.** `activate` is permissionless; a griefer can activate an orphan without the crank. The on-chain residue stays as accepted. What the crank can stop is doing the griefer's or the accident's work for free, and the alarm already pages `vault_owns_itself`, `nested_vault` and `unredeemable_owner` for the same vaults, so the crank refusing is consistent with the alarm's judgment rather than contradicting it.

**Evidence if true.** Selftest: `planCrank` with a record whose `assets[asset] === 'live'` and `tokens[asset].amount ≥ 21000n` returns it in `plan.activate` regardless of any owner input, because the planner has no owner input. On a validator: transfer a funded, revealed vault to its own `["mpl-core-execute", asset]` PDA (suite 9.1 proves Core permits it), run `crank.mjs --live`: `activate` lands (`CBOB_ACTIVATION_REQUESTED`), the next pass joins it, `total_active_weight` includes it.

**Fix.** In `main()`, derive each record's asset-signer PDA (helper `signerPda` exists) into a set, read the owner from `assetInfos[i].data.subarray(1, 33)`, and pass `owners` into `planCrank`; refuse activation and (pre-)joins for an owner that is in the PDA set or fails `PublicKey.isOnCurve`, and push a `problem` naming the vault (which `crank_problem` pages after three passes; the alarm's nested/off-curve findings already page the condition itself). Both-ways selftest arms: self-owned → not activated; nested → not activated; on-curve wallet → activated; off-curve owner → not activated but a `claim` of an already-active one still planned (so a marketplace-escrowed, already-active vault is never starved). Separately, before the lock, the owner may want the cheap on-chain half: `activate` can refuse `owner == find_program_address([EXECUTE_PREFIX, asset], CORE)` (self-nesting) with one comparison; nesting into *another* vault and off-curve owners are not cheaply checkable on chain and would stay an off-chain rule.

### INFO: `planCrank` hardcodes the 15% as `1500n` rather than reading `cfg.split_bps`
`splitToPool = total − total·1500/10000`. `split_bps` is written once as 8,500 and no instruction writes it again, so the plan can never diverge from the program; but the crank's own rule is "compute exactly as the program does", and `cfg.split_bps` is in the decoded config. One-line change; an arm with `split_bps: 9000` in the planner would show the current planner over-crediting the distribution estimate (not the program, which computes its own).

---

## R2. The alarm (`bank/detectors.mjs`, `bank/alarm.mjs`)

Verified: every fixed-forever value in `WATCH` is CRITICAL on drift; the five production value groups (21%/51%/3 days, 7-day notice, the three tighten bounds, 30-day month, one-hour window, supply, census, mints, treasury, PoB root and collection, $CBOB mint and boost bounds) are asserted with `String()` comparisons that work for arrays; pending guardian/operator are level CRITICAL; the PoB collection's plugin region and update authority are watched; `redemptions_near_cap` reproduces BURN's ring arithmetic; pool frozen/insolvent/unreadable; `distribution_overdue` plus the three stall kinds; `boosts_stalled`; all FIVE programs' upgrade authority and bytes (`prog.sweep.*` included) after the lock date; the PriceUpdate, Clock and sweep-state detectors as in round 33. `WATCHED_KEYS` is produced by `readConfigs` and asserted. No dangerous on-chain state that these keys can express reads as quiet.

### L1 (LOW): `detectIndexShortfall` pages CRITICAL on ordinary DAS indexing lag during a sale; only the opposite race (index ahead of chain) is tolerated

**Construct.** `alarm.mjs main()` reads `mint.minted_total` in `readConfigs()` (time t₀), makes several more RPC reads, then `listVaults()` asks DAS (t₁ ≈ t₀ + 1–5 s), then `readMintedTotal()` (t₂). `detectIndexShortfall` accepts `seen ∈ [total, mintedAfter]` (round 24 L9) and otherwise pages `index_disagrees_with_chain` CRITICAL: "The index is incomplete; do not distribute or reconcile against it."

**Why it fires routinely.** DAS is an indexer behind the chain by seconds (sometimes tens of seconds). A mint that landed shortly before t₀ and is not yet indexed at t₁ gives `seen = total − 1`, below the accepted range. During a sale round (a mint every few seconds) a material fraction of passes will land in that window; during the 7-day charter window (one claim per ~40 min) it is rare but nonzero. The kind is level, so the stream opens, the router suppresses, and it recovers when the sale quiets, then flaps again: a CRITICAL that is true about nothing teaches the reader to scroll past the kind whose real meaning is "the index is returning something that is not ours."

**Evidence if true.** Pure: `D.detectIndexShortfall(5n, ['a','b','c','d'], [], { mintedAfter: 5n })` returns `index_disagrees_with_chain`. Live: a dress-rehearsal mint followed within ~2 s by an alarm pass; or simply measure Helius DAS `getAssetsByGroup` latency after a Core mint (this is adjacent to item 22.5, which already asks for a DAS read).

**Fix.** Treat a shortfall as lag unless it is older than one pass: accept `seen ≥ prev.config['mint.minted_total']` (anything minted before the previous pass must be indexed 30 minutes later), page HIGH when `seen` is between the previous and the current count for two consecutive passes, CRITICAL when `seen` < the previous pass's count. Both-ways arms: lag by one across one pass is quiet; lag that persists two passes pages; `seen` below the previous count pages CRITICAL at once.

### INFO: `lock_deadline_unset` now fires every pass in production (see R0); `revenue_unsplit` fires on a paid round while the crank is dry-run
Both intended by their authors; both will be the alarm's steady state between installation and arming, and the runbook should say so, so that the first week of CRITICALs is expected rather than ignored.

### INFO (checked, not a finding): `cycleStartMs` returns −∞ when a sweep's block time is later than the pass's Clock read
`if (hit && chainNowMs !== null) return at <= chainNowMs ? … : -Infinity`, after which `detectUnreconciledRevenue` would page `unreconciled_swap` CRITICAL ("Infinity min ago") for an honest cycle. I checked the live ordering: `main()` reads the Clock first and the ledger milliseconds later, so a row can only carry a `sweepSig` whose slot precedes the Clock's slot, and the Clock's `unix_timestamp` is non-decreasing across slots. The branch is reachable only through the stub, not through the shipped ordering. Left as a note because the predicate's comment ("a false timestamp is itself a reason to look") describes a forged `startedAt`, while the −∞ branch is on the chain-derived time, which cannot be forged; a future reordering of `main()` (reading the ledger before the clock, or re-reading the ledger late) would make it live.

---

## R3. Layouts (`bank/layout.mjs`, `bank/selftest.mjs`)

Verified by hand against the Rust: `MintConfig`'s 63 fields in order and type, `VaultRecord` (211 + 10 padding = 221), `BurnConfig`, `GovConfig`, `SealConfig`; `offsets()` stops at the first `Vec`; `fixedLength` equals `MINT_CONFIG_SPACE − CONFIG_PADDING` and `VAULT_RECORD_SPACE − RECORD_PADDING` (scraped and evaluated, L13c); every `OFF_*` any program pins is compared and none is scraped-and-ignored (L2); the layout versions and `BOOST_RING` are scraped (L6); the eleven SEEDS are scraped from their declaring program (D6: the assertion round 24 found missing now exists and has a both-ways arm); `parseRustStruct` throws on any line it cannot read as `pub name: Type,`. A field appended, retyped or reordered in the Rust turns the selftest red; a `/* … */` block comment inside a struct would throw rather than drop a field. `collectionPluginsHash` skips exactly key, authority, name, uri, num_minted, current_size and hashes the rest. Nothing found.

---

## R4. Money arithmetic (`bank/accrual.mjs`)

`credit` (floor-divided delta, `owed += delta·w`), `pendingScaled` = `(W+boost)·acc + carry − debt` (MINT `owed_of`, carry added before debt), `reweigh`, `ceilSats`, `available` reproduce the program line for line; `join`'s debt is `W·acc` with no boost (`debtAtActivation`). `retire` is deliberately not mirrored (round 23 D2) and the crank only ever plans the program's own `retire_burned`; its `retiringOwed` uses `pendingScaled` at `cfg.acc_scaled`, which is what `retire` subtracts. The crank expires every due boost before its distribution and every boost that distribution makes due right after it (verified R1); the alarm pages `boosts_stalled` and watches `cbob_mint`, `max_boost_weight`, `max_boost_epochs` as fixed forever. Nothing found.

---

## R5. The swap (`bank/swap.mjs`) and the revenue cycle (`bank/revenue.mjs`)

**(a) Oracle math.** `expectedSats = lamports·solPrice·10^(e_s−e_b) / (btcPrice·10)` with the sign of the exponent difference handled on the numerator or denominator, all BigInt, floor-divided (the one-sat rounding is in the floor's conservative direction). `satsPerLamport` converts prices ~1.2e10 and ~8.6e12 to Number, far inside 2⁵³; the deviation gate is 100 bps, so double precision cannot move a verdict except at an exact boundary. Honest cost on Orca is 16 bps fee plus low single-digit bps of impact at 10 SOL against ~$10M; Meteora's base plus variable fee stays well under 150 bps except in extreme volatility. The floor is below an honest return.

**(b) Pyth verification.** Offsets recomputed: disc(8) + write_authority(32) + `VerificationLevel` tag (Full = `[1]`, Partial = `[0, n]`) + feed_id(32) + price i64 + conf u64 + exponent i32 + publish_time i64: `o+0, +8, +16, +20` — correct. Ownership by the receiver plus the push-oracle PDA `[shard 0 (u16 LE), feed_id]` is sufficient because the sponsored account's write authority is the push-oracle PDA, which only that program signs for, and the push oracle refuses a non-monotonic `publish_time`; writing a chosen price needs a guardian-signed VAA. The Clock is read in the same `getMultipleAccountsInfo` and owner-checked; it is as trustworthy as the one RPC (limit 10(b)), which is the stated trust.

**(c) Deviation filter.** `orcaSpot = (sqrt_price/2⁶⁴)²` is token B per token A in raw units (sats per lamport); `meteoraSpot = 1/(1+bin_step/10⁴)^active_id` inverts Y-per-X (lamports per sat) into sats per lamport; both match `satsPerLamport`, and SW.0 on the fork confirms both pools sit within the gate, which empirically pins direction and units. Fine.

**(d) Minimum out.** `guaranteed = m2.f.minSats` is written into Orca's `other_amount_threshold` (exact input ⇒ minimum output, u64 sats) and Meteora's `min_amount_out` (u64 sats); it is the same `f` the deviation filter judged, re-read after the sweep, and the post-swap delta is held to the same number.

**(e) The judge.** Seven exact positions; `SetComputeUnitPrice` refused anywhere; Token instructions limited to SyncNative and CloseAccount; both ATA creates checked by full key list (payer, ata(owner), owner, mint); the wrap's amount and destination; swap data length, amount, floor, Orca direction/exact-input/price limit; pool key; input and output accounts at their venue positions; signer slot. Not checked: Orca's vaults, tick arrays and oracle, Meteora's reserves, oracle, bin arrays and `host_fee_in`. Each of those is pinned by the venue program itself (`has_one`/seed constraints) except `host_fee_in`, which only redirects part of the protocol fee and cannot touch the floored output. A tampered *module* is outside the judge's reach, as stated.

**(f) Derivation.** Orca a_to_b arrays `[s0, s0−span, s0−2·span]` with `s0 = floor(tick/span)·span` (floor toward −∞ for negative ticks) match the SDK's shift-0, offset −1/−2 rule; Meteora Y→X arrays `[i, i+1, i+2]` with floor division match; bitmap extension and `host_fee_in` as the program id follow Anchor's optional-account convention; event authority and program trailing accounts correct; two token programs. An uninitialised array or an exhausted sequence is a program refusal, which the cycle handles as a venue refusal (or, after the sweep on both venues, an open-and-loud cycle: round 34 C07).

**(g) wSOL.** Exact `lamportsIn` wrapped, SyncNative, swap, close to owner. A pre-existing wSOL ATA (any balance, created by anyone: R33.G4) only adds lamports that SyncNative counts and the close returns; wSOL has no freeze authority; a delegate cannot stop an owner-signed swap or close; whatever the swap does not consume returns on the close.

**(h) Failure and retry.** Preflight refusal → refused; landed-with-error or expired-and-absent → refused; landed → recorded; anything else → `pendingXSig`, throw, cycle open, next run refused at the guard. No path can send a second swap or sweep automatically, and no path closes a cycle without `splitSig`/`splitByOther` and a positive return (`cycleIsOpen`). The expired-but-landed-in-the-last-valid-slot race against a lagging status index is the one-RPC trust already recorded (round 33 C16).

**(i) Bound.** With the read-time gate at 100 bps and the execution floor at 150 bps, the most a sandwich, a pool held at the gate's edge, or Meteora's thinner book can take is 150 bps of a cycle: at the ruled 10 SOL cap, 0.15 SOL (~$18 at the measured prices) per cycle, ~0.6 SOL/day at the 4-cycle ceiling, ~18 SOL/month only if royalties actually reach 40 SOL/day; in all cases ≤ 1.5% of royalty SOL. A stale-but-accepted oracle (180 s) adds whatever SOL/BTC moved in those three minutes in the attacker's favour (a few % in a crash), still bounded per cycle. Pushing the $10M Orca pool 1% costs an attacker far more in fees than the ~$18 it releases; Meteora is reachable only after Orca refuses, which the attacker cannot cause cheaply. Not material. **Operator worst case** is unchanged in shape: cap × cooldown windows until the guardian's stop, plus any cbBTC on the operator ATA mid-cycle, detected within one alarm pass by `sweep_unledgered_state` whatever the scan backlog; what is trusted is the two pool programs, Pyth, the one RPC, the box, and the four third-party upgrade keys, all watched but none ours.

**Revenue job, additional checks.** `split_revenue` account order correct; decimals 8 for the pinned cbBTC; the return's destination is the revenue PDA's ATA with `allowOwnerOffCurve`; the Squads ATA create uses an off-curve owner correctly; `sweepAmount` takes the smaller of 50 SOL, the chain cap and the balance above the reserve; a run inside the cooldown or with the sweep stopped returns before the open-cycle check (the alarm's `unreconciled_swap`, 60-minute grace, is the watcher for that interval, and `--audit` the hand check). Nothing found.

---

## R6. The gates

`floor()` equality on every suite; `sub_selftest` prints failing output before dying; `OUT=$(…) || RC=$?` pattern used everywhere it matters; the mainnet probe and the fork are ship-gated by `CBOB_SHIP_GATE=1`; `MIN_ASSERTIONS` not overridable; `CBOB_TEST_FILE` and a moved `CBOB_CACHE` refused. Potentially vacuous `filter(...) → []` arms are each guarded by a non-emptiness arm (control table ≥ 5 rows, three classifications present, source tree covers three directories, 14 id-copy mutations each named). The round-24 section still contains textual (one-direction) arms for alarm/crank wiring (`L3`, `L5`, `L7`, `I2`, `I5`, `D5`, `L6b`), already recorded as accepted in rounds 30 and 34; no new vacuous arm found. `build-mainnet.sh` proves what it says for the sweep helper (three-way `cmp`) and for the four keyed programs' behaviour; it does not `cmp` the four keyed programs' localnet rebuild (`$LN_DIR`) against `target/deploy`, so "the bytes the suite deployed" for those four rests on the runner's fresh copy and a reproducible toolchain rather than a measured identity — a one-line `cmp` per program would close that (INFO). `cron-install.sh` arms only `watcher`, `reconcile` and `deadman` live; `crank` and `revenue` dormant unless a tagged, uncommented `--live` line is preserved; refuses a rehearsal tree. `rehearsal-tree.sh`'s reverse proof and abbreviated-id check hold; its abbreviated-id check can false-fail on an incidental 4-char base58 prefix, which is loud, not silent.

---

## The four questions about the accepted limits

**1. Worse than stated.**
- **Items 9 and 44 (and the round 29 D2 note).** The permanent dilution by an activated orphan is described as a consequence nothing on chain can undo. It is also a consequence our hourly crank *initiates* for any funded nested, self-owned or off-curve vault within an hour, including vaults the alarm is simultaneously paging CRITICAL for. M1 above; the limit text should say who activates, and the crank should stop.
- **Item 38.** Correct as stated, with the added fact that the alarm now also carries the placeholder programs' hashes as its first baseline, so the real deploy is a CRITICAL `config_drift` on five keys that the runbook must expect.

**2. Not actually a limit, or narrower than written.**
- **Item 8 (cross-pass correlation lag).** Since round 28 `rememberRedemptions` persists `burn_via_program` evidence, so a burn the walk saw in an EARLIER pass is correlated when DAS reports it later. The remaining case is the DAS diff arriving before the walk reaches the transaction, which in this tree needs a scan backlog or a held cursor (`tx_unreadable`), not ordinary timing. The item should say "only under a backlog or an unreadable transaction".
- **Item 42.** Already corrected to "client contract"; nothing further.

**3. Discharged items.**
- **51** holds: the crank's pre/post expiry, `accrual.reweigh`, `boosts_stalled`, the fixed-forever watches are all present and asserted.
- **54** holds for the crank's shapes it names (capture alone, reveal alone, claim ×14 extrapolated, expire ×20 measured under the default budget). One unmeasured shape remains the crank's own: a 14-pair `claim` whose `monthly_inline` CREDITS (only if the crank's explicit `distribute` failed for a non-benign reason in the same pass) plus 14 payments; extrapolation says under 200,000 CU, nothing measures it.
- **12/17, 14, 19, 30, 31, 33** hold.

**4. Open-and-blocking items quietly treated as accepted.** None demoted. 22, 38, 50, 52, 53 remain open as written; 53's rehearsal proof is still stale at `d57ee3a` and the rehearsal value set is still unwritten. Step 9 began before 7 and 8 completed; that is recorded in the road table ("in progress") and VALIDATION, not demoted, but it is the first time a road step has been executed out of the order the road states as a rule.

---

## Holder guide against the code

Every promise checked is true of the code or marked DRAFT/not built, with two imprecisions: "Once it holds at least 21,000 sats of cbBTC, it is activated: it joins the payouts at the next distribution" compresses three events (an `activate` someone must send, the following distribution, then the join); and "Activation is picked up automatically" is true only once the crank is armed. Both are DRAFT caveats, not falsehoods.

---

## Findings, in one table

| ID | Sev | Where | Summary |
|---|---|---|---|
| M1 | MEDIUM | `bank/crank.mjs` `planCrank`, `main()` | Activates, joins and pays vaults whose Core owner is a vault PDA (self or another) or off-curve; our automation makes the accepted permanent dilution happen within an hour of funding. Fix: pass owners to the planner, refuse activation/joins for those, page as a problem; optionally the self-nesting check on chain before the lock. |
| L1 | LOW | `bank/detectors.mjs` `detectIndexShortfall`, both alarm call sites | DAS lag of seconds during a sale pages `index_disagrees_with_chain` CRITICAL; tolerate a shortfall younger than one pass against the previous pass's `minted_total`. |
| I1 | INFO | `bank/alarm.mjs` in production, now | `lock_deadline_unset` and five `config_drift` CRITICALs are the expected steady state between installation, the real deploy and the lock; runbook must say so and name the baseline re-take procedure and the custody of `FZjLB4…`. |
| I2 | INFO | `bank/crank.mjs` | `1500n` instead of `cfg.split_bps`. |
| I3 | INFO | `scripts/build-mainnet.sh` | No `cmp` of the four keyed programs' localnet rebuild against `target/deploy`. |
| I4 | INFO | `bank/detectors.mjs` `cycleStartMs` | −∞ branch on a chain time newer than the pass clock; unreachable in the shipped ordering, latent if `main()` is reordered. |

No CRITICAL, no HIGH.

---

## What this project should do before launch that AI audit structurally cannot

1. **Run item 22's dress rehearsal with an adversary at the keyboard, not only an operator.** The rehearsal as written proves the happy paths plus one forced failure. Add: a stranger flooding MINT with 3,000 padded transactions during a live revenue cycle (measures L1's DAS lag, the flood boundary and whether the alarm's pass time stays under the 30-minute `flock`), a funded vault transferred to a Squads and to its own PDA (measures M1 before and after the fix), a swap with Orca forced to refuse under real congestion, and the guardian's `emergency_stop_sweep` timed from the first `sweep_unledgered_state` email to the landed stop. Record the signatures and the clock.
2. **Build the five programs on a second machine from the release commit and compare sha256 with `dist/SHA256SUMS` before `--final`.** The key proof in `build-mainnet.sh` cannot show the compiled constant *is* Gary's key; reproducibility across machines is the only bridge, and it has never been exercised.
3. **Witness `initialize` with a read-back.** Build the four transactions from `launch/mainnet-init.json` by script, have a second person decode the landed configs with `bank/layout.mjs` and diff every field against the file before the first charter claim. The checker validates the JSON, not what was signed.
4. **Settle DAS behaviour on burns and lag empirically (22.5, L1):** one burned Core asset in a test collection read through Helius DAS, and the indexing latency of a Core mint measured over an hour. Two detectors' severities depend on answers nobody has measured.
5. **Put a second watcher on a second RPC provider, off this box,** running only the state-derived detectors (`sweep_unledgered_state`, pool health, drift, upgrade authority). Everything today rests on one RPC and one user on one machine; the thing that most needs independence is the thing that watches the operator key.
6. **Decide custody in writing for every key on the box**: swap operator, crank, $CBOB release, the placeholder upgrade authority `FZjLB4…`, the alarm's notify credentials; what is backed up where, and who can act if the box is lost between step 9 and step 11.
7. **Do a canary period with real but small value** after step 10 and before step 11: a handful of charter vaults, one real revenue cycle, one real redemption through the finished page, with the upgrade authority still held, before anything is made permanent. Nothing in this process can substitute for value moving on the real chain under the real indexer with the real wallets.
8. **Publish the honest list and invite a bounty** for the two weeks between step 10 and step 11. Eleven rounds of models reading the same tree have converged on LOW/MEDIUM findings; a human with a wallet and a motive reads code differently from a model with a prompt.