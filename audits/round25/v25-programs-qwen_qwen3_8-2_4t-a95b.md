# CBOB v6 — round 25 program audit (five programs, whole-tree read)

Scope note up front, because it bounds every citation: the bundle contains the five programs, the suite, the sim, the two build scripts, the design/spec/guide docs, RT3 and the round-24 program verdict. It does **not** contain `bank/*.mjs` (swap, revenue, crank, alarm, detectors, layout), so the Orca/Meteora swap repair and the off-chain pipeline are named here only where the programs or docs lean on them; I did not read that code and I will not fabricate findings about it.

I attacked every target. Where an attack did not produce a surviving defect I say what I attacked and what held, without endorsing the rest. Severity is calibrated; I did not manufacture a CRITICAL to fill a slot, because a wrong CRITICAL against an immutable deployment is itself a harm.

---

## R0. Round 24's repairs

The C-series evidence gaps are genuinely repaired in the suite, and I verified each repair exists and exercises what it claims:

- **C1** — `BO.30` / `BO.30a` / `BO.31` drive the weight leg, the favourable-price leg, and the epochs leg of `BoostTermsMoved`; `BO.33` / `BO.33a` drive post-transfer ownership. Present and on-point.
- **C2** — `BO.34`–`BO.34c` buy a boost whose end epoch wraps past 64 through `boost_vault`'s own inline index and expire it through the program. Present.
- **C3** — `E.7` / `E.7a` create, vote and execute a five-kind proposal and record CU. Present.
- **C4, C5, C6, C8** — `BO.33*`, `S7b.*`, the `wide.cu >= base.cu + 4×100,000` clause in `10.6`, and `3.1y`. Present.

The A1/A6 comment edits are the one place a byte change happened, and I checked what could still assume the old bytes:

- The suite's source readers (`pinned`, `constU8`, `idx`, `structBody`) are all **name-keyed** (`src.indexOf(name + …)` / regex on the constant name), not line-keyed, so the added line in MINT does not silently re-pin any arm to a wrong constant. Verified by reading each helper.
- `scripts/build-mainnet.sh` does not embed a MINT byte expectation; it rebuilds and asks the artifact behaviourally which key it trusts. So the MINT line-add does not invalidate it.
- **Finding R0-1 (LOW, deployment checklist).** The alarm's program-hash baselines are not in this bundle. Because MINT's bytes legitimately changed with the A1 comment edit, any baseline captured from an earlier build will either page on the legitimate change or, if someone "fixes" it by loosening the check, mask a real swap. Evidence that would exist if this is mishandled: a `prog.mint.hash` constant in `bank/alarm.mjs` that predates the final build. Fix: regenerate all five program-hash baselines from the exact `dist/*.so` that `build-mainnet.sh` certifies, in the same commit that freezes the tree; do not hand-edit a hash.

---

## R1. Custody

Attacked: CPI-wrapper pairing bypass, two-vault transactions, account-index binding, instruction-sysvar parsing, thaw-without-burn, emptied-vault-survival.

What held: `open_for_redemption` walks forward for a `burn_vault` matching asset **and** owner; `burn_vault` walks backward for an `open_for_redemption` matching asset **and** owner; both bind the hardcoded account positions (asset 0, owner 2) that the suite pins at `3.1c`–`3.1f`; `retire_redeemed` enforces stack height `TRANSACTION_LEVEL_STACK_HEIGHT + 1` plus a top-level `burn_vault` match, which the wrapper arms `WR.1`–`WR.3` exercise one level down. Two-vault transactions pair per-asset because both walks compare the asset pubkey, not just the discriminator. A thaw cannot persist: the only thaw is `set_frozen(false)` inside `open_for_redemption`, which reverts with the burn if the burn fails, and Core `BurnV1` destroys the asset, so there is no "emptied but alive" state.

No surviving defect on this target.

---

## R1s. The sweep helper (`programs/cbob-vault-sweep/src/lib.rs`) — first read

This is the newest value-moving code. I walked every sub-question.

**(a) Who can make it move value.** The helper requires `signer.is_signer` where `signer` is the asset-signer PDA. Directly, no one can sign for a PDA, so a direct call can only sweep the caller's *own* accounts (harmless, self-inflicted). Via Core `ExecuteV1`, the PDA signs only if Core's execute authority check passes. The vault is frozen except inside `open_for_redemption`, and the only thaw requires a terminal burn in the same transaction, so the helper is reachable **only inside a redemption the owner is already performing**. I could not construct a path where a non-owner moves a sealed or a thawed vault's value through this helper.

- **Finding R1s-1 (MEDIUM). The helper's entire authorization is delegated to Core's `ExecuteV1` authority model, and that model is never proven in isolation anywhere in the suite or sim.** Every arm that touches it confounds Core's check with SEAL's/BURN's own owner checks (`3.1`, `S6.6` refuse at `NotTheOwner` in *our* programs, not at Core). There is no control test that takes a thawed Core asset with no CBOB plugins and attempts `ExecuteV1` as a non-owner. The helper itself holds no asset account and does not compare `dest` to the asset owner — it *cannot*, because the asset is not in its account list and a PDA cannot be reversed to its asset. Today this is safe because (i) Core's execute is owner-gated and (ii) thawing is controlled by the SEAL PDA, independent of execute authority. But the safety of the single highest-value new instruction rests on an external, Metaplex-upgradeable behaviour that no assertion pins. Evidence that would exist if I am right: grep `tests/3prog.test.ts` and `sim/test-vault.ts` for a non-owner `ExecuteV1` attempt on a thawed asset that is refused by Core specifically — there is none. If a Core upgrade ever widened `ExecuteV1` authority, **no suite arm would turn red**, because none isolates the property. Fix: add a control asset (thawed, no freeze plugin, keypair owner) and assert a stranger's `ExecuteV1` into the sweep helper is refused by Core; separately, consider passing the asset into the helper and requiring `dest == asset.owner` as defence-in-depth before the helper is locked.

**(b) Pair list.** Duplicate source: the first pass transfers and closes it; the second `read_token` sees a closed/system-owned account and returns `IllegalOwner`/`InvalidAccountData`, failing the whole instruction — but only the owner builds this, so it is a self-footgun, not an attack. Duplicate destination is fine. Source-also-destination fails on the closed read. A source with a delegate still closes (owner may close over a delegate) and the funds went to the owner, so nothing is at risk. Frozen source/destination fails at the token `Transfer`, which is accepted limit 28 surfacing. Zero-pair list (`accounts.len()==4`) is legal and sweeps only lamports; on a vault with token balances the subsequent burn then refuses `VaultNotEmpty`, so it cannot silently strip only SOL. Odd pair counts are refused by the `(len-4)%2` check. No theft path.

**(c) Destination checks.** `dest` is not compared to the owner. Given (a) this is the owner's own choice, so it is safe *today*. Lamport transfer to a below-rent or non-system `dest` does not fail (crediting lamports is unrestricted), so it cannot block a redemption. See R1s-1 for the coupling concern.

**(d) Lamport sweep.** Reads `signer.lamports()` at execution and transfers all of it, leaving 0. Token closes send their rent to `dest`, not to `signer`, so they do not disturb the figure. Nothing after the helper in the same `ExecuteV1` deposits back (the page sends one instruction), and even if one did, `burn_vault`'s `lamports()==0` would revert the whole transaction. BURN sees exactly what the sweep left. Held.

**(e) Emptiness-proof interaction.** A closed source is skipped by BURN's reserve loop for the right reason: after close the account is no longer owned by a token program (`acc.owner != SPL && != Token2022 → continue`) or has `data.len() < 165 → continue`. Both paths pass a closed account. For a reserve ATA that does not exist when the page builds: SPEC's "create it in the prior transaction" is sufficient, because once it exists (empty) the helper can name it, transfer 0, and close it. The residual grief — a stranger creating a *missing* account with dust between build and landing — is closed only if the page really creates all three first; that is an item-50 client obligation, not enforced on chain. Accounts a stranger can create that the helper cannot name and BURN will not skip: none among the reserves — a Token-2022 ATA for a classic mint cannot be initialised (mint owner mismatch), a non-ATA token account is invisible to BURN's derived-ATA requirement and so is destroyed rather than blocking (limit 44), and a nested Core asset is refused only if declared (limit 9/44). Consistent with accepted limits.

**(f) Does it fit.** `S8.0` measures claim + open + helper-Execute + burn for three assets and asserts ≤ 1232. I could not run it, so I cannot confirm headroom.
- **Finding R1s-2 (LOW).** `S8.0` asserts only `B <= 1232`; it does not assert any headroom, and a real page may need to add a priority-fee or compute-budget instruction (the latter only if it carries a crank, which item 54 says it should not). If the helper-based three-asset redemption lands within a few dozen bytes of 1232, there is no room for a priority fee during congestion, forcing a v0/lookup-table path the design says does not exist. Evidence that would exist if I am right: `S8.0`'s printed byte count within ~40 bytes of 1232. Fix: record the exact byte count in the arm's note, and if headroom < ~64 bytes, either require a versioned transaction for the redemption or drop the in-transaction `claim` to a prior step.

**(g) Evidence.** `SR.0`–`SR.4a` and `S8.*` exist and the helper is in `run-tests.sh`'s `PROGS` and proven byte-identical between localnet and mainnet builds by `build-mainnet.sh` (it has no key to swap). The one arm I would add is the isolated Core-authority control from R1s-1.

---

## R2. The community pool

Attacked the invariant `pool ≥ ceil(owed)`, the two-step activation, `JoinWaitingFirst`, the join/claim/retire counter arithmetic, and liveness.

What held: `credit` adds `delta = floor(avail·SCALE/w)` to `acc_scaled` and `delta·w` to `owed_scaled`, leaving the sub-sat dust in the pool; `claim` subtracts only whole-sat `settled` from `owed_scaled` and carries the remainder in `carry_scaled`, so the pool decrease matches the owed decrease; `reweigh` moves owed into `carry` and resets debt without touching `owed_scaled`; `retire` subtracts the vault's pending from `owed_scaled` and, on forfeit (frozen pool), returns it to the pool. `pending_count`/`pending_this_epoch` are decremented on join and on retire with the same-epoch guard; `waiting_to_join = pending_count − pending_this_epoch` is reset correctly by `advance_epoch`. I traced a request→tick→join→claim→retire sequence and the counters stay consistent. `JoinWaitingFirst` blocks both the burn path and the free path while an eligible vault waits, and the launch tick (`w==0`) cannot be opened by the burn path. I found no way to make distributions or redemptions permanently impossible for others: a due month eventually runs in-line on any host, and a frozen pool forfeits rather than locks (red-team 3 fix, `3c.F*`).

No surviving defect on this target.

---

## R2b. The $CBOB boost

Attacked: exactly-N distributions, nothing lost/gained on weight change, ring integrity past epoch 64, double/early/never expiry, and boost-based liveness attacks.

What held: a boost bought at epoch `e0` with length `n` ends at `e0+n` and becomes due exactly when `dist_epoch` reaches `e0+n`, i.e. after exactly `n` distributions. `reweigh` preserves owed. The ring is collision-free because `epochs ≤ MAX_BOOST_EPOCHS_BOUND = 63 < 64`, so two live boosts can never share a ring slot (a boost ending at `e+64` is bought at `≥ e+1`, after slot `e%64` was cleared). `expire_boost` requires due, zeroes `boost_weight`, and is idempotent-refusing thereafter; `unschedule_boost` is the exact inverse of scheduling for both due and not-yet-due cases. `BoostsExpireFirst` plus the crank/`claim` expiry means a due boost cannot be skipped indefinitely. A vault whose token account is gone cannot block expiry (`expire_boosts` needs only records). I could not make a boost earn N+1 or lose earned share.

No surviving defect on this target.

---

## R3. The level draw

Attacked SlotHashes parsing, skipped-slot handling, FIFO, burned-head-of-queue, attribute re-supply, and leader influence.

What held: `blockhash_in_window` pins the sysvar key, bounds the count, validates the buffer length, and refuses an all-zero hash; `try_capture` picks the smallest produced slot in `[want, want+64]` and steps B/C two leader groups forward; the FIFO is enforced by `revealed_total`; a burned vault still draws (so the queue never stalls) and skips the Core write; the re-supplied attributes are hash-checked. The host tests cover skipped slots and malformed sysvars.

On SPEC 26 / holder-guide A1: the guide now says the last validator "can pick among several results … enough to choose the level," which matches the code (C is the smallest produced slot in a 64-slot window the C-leader controls by skipping and by block content). It is **not worse than stated**; if anything the stated "several" understates "up to 64 candidate slots plus content variation," but the honest-list sentence is directionally true. No new finding.

---

## R4. Governance

Attacked minority capture, money reach, and permanent freeze.

What held: key changes require `ceil(50% × quorum_supply)` YES (`KeyChangeNeedsHalf`), cannot be bundled (`KeyChangesBundled`), and land only after notice via permissionless apply; `TightenSweep` is monotone and bounded; overtaken actions are logged skips, not reverts; the electorate and tally are snapshotted at creation. A vote cannot reach the split, destinations, supply, royalty, or any vault. Governance can freeze only in the accepted sense (all vaults redeemed + no open round, limit 45; or a stolen guardian re-stopping at low turnout, limit 47). I found no minority path that carries what it should not.

No surviving defect on this target.

---

## R5. The charter claim

The Merkle verification is domain-separated (leaf 0x00 / node 0x01) and sorted, blocking second-preimage and reorder; the PoB must be owned by the signer, in `pob_collection`, a leaf of `pob_root`, and is CPI-burned in the same instruction; a burned PoB is a 1-byte tombstone that fails the `KEY_ASSET_V1`/length checks, so a leaf spends once; `pob_extra` accounts pass through as non-signers. The window is clock-only and cannot reopen, and the claim is deliberately not gated by the sales stop.

On SPEC 46 / the Moments hot wallet: the guide's honest list now carries the full "end the project or capture governance" consequence (round-24 A2 repair). I checked for an omitted capability: the hot wallet can also mint a lookalike (covered by address-pinning), move a PoB out of the collection (stated in SPEC 46), and flip an oracle between transactions (stated). I found nothing material the docs still omit. The residual is the ruling itself, not a documentation gap.

No surviving defect on this target.

---

## R6. One-time configuration and the trusted hop

- Every `initialize` is gated by the compile-time `INIT_AUTHORITY` and runs once. The sweep bounds, charter window, census, boost ceilings, and notice/monthly/voting periods are range-checked at init. The cross-init wiring checks (SEAL first, then MINT/BURN/GOV refusing a divergent collection) mean a wrong collection bricks loudly before anything mints.
- **Finding R6-1 (LOW, process).** `scripts/check-launch-params.mjs` validates `launch/mainnet-init.json`, **not the signed initialize transactions**. A builder who constructs the four initialize transactions from anywhere else can write values the checker never saw, and the programs themselves check less than the checker (SEAL reads only account owners; off-curve keys are accepted; `redeem_window_secs` may be 10 s–24 h). Because these writes are irreversible, the gap between "the JSON is right" and "the transaction that was signed is right" is the whole risk. Evidence that would exist if this is a problem: no step that re-derives the actual initialize call data from the JSON and diffs it against what is broadcast. Fix: generate the initialize transactions *from* `mainnet-init.json` with a single script and have the checker hash the resulting call data, or read each config back on chain immediately after init and assert every ruled value before anything mints.
- The swap operator's worst case is bounded: per-sweep cap × cooldown windows until the guardian stops it, never more than the revenue PDA holds above the reserve (limit 10). The on-chain side (`sweep_sol_for_swap`) enforces destination, cap, cooldown, reserve, operator signature, and the sweep stop. No program finding.
- The 10% royalty is installed with `PluginAuthority::None`; the suite proves on a control collection that even the update authority cannot update or remove a None-authority plugin (`R.5`–`R.6c`). Nothing in our programs can change it. Held.
- The redemption cap is a true rolling window over a 64-slot timestamp ring; I re-derived the "cap-th most recent must be a full window old" rule and the initial-zero behaviour. Held.

---

## R7. Cross-program raw reads

I recomputed the layouts field-by-field from the struct definitions. MintConfig: governance 41, minted_total 141, charter_closes_at 442, bare_burns_retired 454, sales/sweep_stopped 191/192, sol_reserve 257, max_sweep 266, cooldown 274, stopped_at 518/526, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, max_boost_weight 711, max_boost_epochs 712 — all match the constants in GOV and BURN and the suite's offsets. VaultRecord: mint_index 41. BurnConfig: burned_total 42. SEAL Config: version 8, collection 9, reserves 41. Token-account reads (mint 0, owner 32, amount 64, state 108, len 165) and mint reads (decimals 44, initialized 45) match classic SPL. Every pinned discriminator/version is asserted in the suite. I found no mis-offset. (RT3 reached the same conclusion; I state it as my own recomputation, not as agreement.)

No surviving defect on this target.

---

## R8. Suite, simulation, build as evidence

- The floors use `-eq` (must EQUAL the count), not `-ge`, in `run-tests.sh` and the sub-selftests — the round-19 defect is closed. `MIN_ASSERTIONS=774` matches the stated suite size.
- The sweep helper is deployed from the same bytes the suite ran: `build-mainnet.sh` `cmp`s the mainnet helper against the localnet build and the helper has no key to diverge. Held.
- **Finding R8-1 (LOW, evidence quality).** `P.11a` still does not hard-fail when fewer than five levels are represented: with `picks.length === 0` both sides are empty strings and the arm passes vacuously, appending only an informational note. Round-24 C8 asked it to fail. In practice the census is exhausted elsewhere so five levels exist, but the arm itself would not catch a regression that removed level diversity. Fix: `require picks.length === 5` (or assert the note condition false) in the arm.
- **Finding R8-2 (LOW, evidence gap).** No arm exercises a non-owner calling Core `ExecuteV1` on a thawed asset (see R1s-1); and no arm drives the sweep helper with a source that is a native/wSOL account or with a destination below rent-exemption — these are out of the reserve path, but the brief asks, and they are unexercised. Fix: add the control arm from R1s-1; the wSOL/below-rent cases are acceptable to leave as limits if stated.
- Claims no arm exercises: the alarm's reaction to a helper deployment mismatch, and the dress-rehearsal at throwaway ids (item 53) — both off-chain and out of bundle.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** I did not find one that is. I re-checked the ones most likely to be understated: 26 (C-leader) is accurately stated after the A1 fix; 32 (rate limit) ring covers the 2,100 supply with room (64 > cap 45); 41, 46, 47, 55 match the code. Limit 28's "a frozen pool reverts a claim that pays" is exactly what `claim` does (no freeze check before the pool `Transfer`), and the redemption forfeit path is real.

**2. Is anything listed as a limit not actually a limit / already closed?** Yes, one is stale. The "Known limits" entry for the exact-amount redemption grief (round 23 F1 / round 24 A3) still reads "the sweep helper … is **being built**" and "Not yet measured: its arms, and the byte and compute fit." The helper **is built** (`programs/cbob-vault-sweep`) and **is measured** (`SR.0`–`SR.4a`, `S8.0`). The on-chain half of that limit is closed; what remains is the item-50 page that must call it. The text should move the closed portion to DISCHARGED and keep only the client obligation. (This is a wording/staleness issue, not a new defect.)

**3. Is any DISCHARGED item not actually discharged?** I checked 51 (boost) and 54 (compute) against the code and suite and they are genuinely built/measured. The Bank-era items (1a–24) were removed with the Bank and their replacements exist. I found no falsely discharged item.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** Items 22, 38, 50, 52, 53 are all still genuinely open and none is smuggled into ACCEPTED. However — and this is the important one — **the HOLDER-GUIDE already speaks as if item 50 is done.** See below.

---

## Anything else

**Finding O-1 (MEDIUM, holder-facing).** Several HOLDER-GUIDE sentences assert what "the redeem page" does, but the page is item 50, OPEN AND BLOCKING, and does not exist. Examples: "The redeem page offers this and does the steps for you," "On the redeem page that cannot block the opening," "The redeem page will first set up … and then empty the vault at the very moment the opening runs." Only one occurrence carries the "(being built)" qualifier. The on-chain mechanism (the sweep helper) now exists, but nothing a holder can actually use runs it, runs `judgeRedemptionCoverage`, or drops `claim` during a pool freeze. Until item 50 ships, these sentences are not true of the deployed system, and a holder who redeems through any other client gets none of the described protection. Evidence: item 50's own text ("None of that exists"). Fix: either build the page before the guide is published, or qualify every redeem-page sentence with "(being built)" and state plainly that redeeming any other way has no grief protection and no destroyed-asset warning.

**Finding O-2 (LOW).** The off-chain swap repair (`bank/swap.mjs`, Orca-then-Meteora) is not in this bundle, so the round-24 M1 repair is unverified here. The program side (`sweep_sol_for_swap`) is sound, but the claim "the swap no longer signs what a third party built" rests on code I could not read. If this round is meant to cover it, that file must be delivered; until then treat the swap as unaudited for this round.

**Finding O-3 (INFO).** `retire_redeemed`/`retire_burned` identify "burned" by Core's exact 1-byte `Key::Uninitialized` tombstone. This is correct today and pinned by `is_burned`, but it is a hard dependency on Core's burn representation (limit 40). No action beyond acknowledging that a Core change to the tombstone halts redemptions (`NotBurned`) — already in limit 40; consider adding the two concrete consequences to the limit text.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what must be done before launch that AI audit structurally cannot

1. **A human must attest the deployed bytes and perform the irreversible lock.** AI can compute `dist/*.so` sha256s and read them back from chain, but the act of `solana program set-upgrade-authority <id> --final` for all five programs, and a signed, witnessed attestation that "these five on-chain programs are exactly the audited bytes," must be a human-owned ceremony with the commit hash recorded. AI cannot bear responsibility for an irreversible mainnet action; if the wrong bytes are locked, no later round can fix it.

2. **A human must run the live mainnet dress rehearsal (item 22) and judge it.** The crank, alarm, and revenue jobs have never touched a live cluster. AI cannot operate real funds against real RPC rate limits, transient errors at vault 1,900 of 2,100, and an every-minute reveal lane, then decide "this is healthy." This must be a human-run, human-observed gate with the rehearsal alarm mode (`CBOB_ALARM_REHEARSAL=1`) and throwaway ids.

3. **A human must make the two still-OPEN launch decisions (item 38).** `charter_opens_at` and `lock_deadline` are `null` in `mainnet-init.json`. AI can enumerate that they are open; it cannot choose the date or accept the consequences. These must be ruled and written before any initialize is signed, and the initialize transactions must be generated from that file (see R6-1), not hand-built.

4. **A human must decide the custody of the Giraffish Moments hot wallet through the 7-day charter window.** This is the single largest concentrated risk in the whole system (limit 46: one hot key can end the project before it starts or capture all of governance). AI can state the risk and recommend holding that key cold or in a multisig until the window closes; only Gary can rule it, and only humans can physically enforce it. If the ruling stays "hot," the alarm on any plugin/authority change must be wired to a page a human will answer within minutes, not hours, for those seven days.

5. **A human must build, wallet-test, and own the redeem page (item 50).** The holder guide promises it; it does not exist. AI can specify it, but a human must implement `judgeRedemptionCoverage` pre-signature, the prior-transaction ATA creation, the sweep-through-helper call, the pool-frozen branch that drops `claim`, the close-what-you-empty rule, and the compute-budget handling, then test it against real wallets. Until it exists, O-1's sentences are false and limits 9/44 have no preventive control.

6. **Humans must hold the keys and answer the brake.** The guardian key, the swap-operator key, and the $CBOB release wallet (limit 56: the entire supply on one box) are physical custody problems AI cannot solve. The guardian brake is only real if a human can reach Gary's wallet and sign `emergency_stop_sales`/`emergency_stop_sweep` within minutes of an alarm; an unstaffed brake is not a brake.

7. **A human must formally accept the accepted limits with authority.** Limits 41, 46, 47, and 56 are business risk acceptances that cost holders real money under defined conditions. AI can enumerate and quantify them; only an accountable human can accept them on behalf of holders, and that acceptance should be recorded where holders can see it (the honest list is the right surface).

8. **A human must enforce the two-round independence rule.** The ship gate requires two clean rounds with *different* model rosters. AI cannot certify its own independence or that a "second" round is not the same models re-read. Someone must verify the rosters actually differ and that the frozen tree was untouched between rounds; agreement of a process with itself is not evidence.

Net: I found no CRITICAL or HIGH program defect that survived measurement; the money logic, the pairing, the boost ring, the draw, and the cross-program offsets held under attack. What I did find is concentrated in the newest code and the human-facing surface: the sweep helper's authorization is coupled to an unverified-in-isolation Core behaviour (R1s-1), the launch-value checker does not bind the signed transaction (R6-1), the holder guide overstates protections that item 50 has not delivered (O-1), and two byte/evidence items need headroom and a control arm (R1s-2, R8-1/R8-2). None of these is fixed by another read of the same tree; they are fixed by a control test, a generated-transaction check, a page, and the human ceremonies above.