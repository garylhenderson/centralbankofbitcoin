# ROUND 24 — independent audit of the v6 tree (four programs + suite + sim)

Scope note: the bundle contains the four programs, `tests/3prog.test.ts`, `sim/test-vault.ts`, the runner, the design/spec/holder docs, the round-23 program verdict, and the launch values. The `bank/*.mjs` sources are **not** in the bundle, so the off-chain pipeline is audited only where the programs and suite expose it. I read every line of the four `lib.rs` files, recomputed the cross-program layouts by hand, and traced the boost, pool, pairing, rate-limit and draw state machines. Where I attacked something and it held, I say what the attack was and why it fails, so a later reader can distinguish "checked" from "ignored."

**Result: no CRITICAL, no HIGH.** Two LOW, three INFO/evidence findings below. The rest of the report is the attack log and the four accepted-limit answers.

---

## R1 — CUSTODY (open/burn pairing, emptiness proof)

Attacks considered and why they fail:

- **Two redemptions in one transaction / borrowed pairing.** SEAL walks forward from `current+1`, BURN walks backward from `0..current`; both bind `asset` at account index 0 **and** `owner` at index 2. I tried open-A/open-B/burn-B/burn-A, open-A/open-B/burn-A, and a single burn after two opens. In every cross-case the non-matching program refuses (`NoTerminalBurn` / `NoPrecedingOpen`) and the thaw reverts. A burn cannot satisfy two opens because the asset match is per-instruction. Suite 4.9/4.10/4.10a pin this; I re-derived the walk logic and it is fail-closed (an early `Err` leaves `found=false`).
- **CPI wrapper / hidden burn.** `load_instruction_at_checked` sees top-level instructions only, and `retire_redeemed` additionally requires `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1`. A wrapped burn makes the retire see stack height 3; a wrapped retire sees the wrapper (not BURN) at the current index. Both refuse. The new `tests/cpi-wrapper` arms (WR.1–WR.4) exercise exactly this; I checked the wrapper forwards `is_signer`/`is_writable` verbatim, so it is a faithful one-level-down attacker.
- **Thawed vault leaving the transaction unburned.** Impossible by atomicity: the thaw is a Core CPI inside the same transaction; if the burn fails, the thaw reverts. There is no instruction that re-seals, and none that moves contents without the owner-signed Execute, so a successful transaction always burned the thawed vault.
- **Emptiness proof, Token-2022, delegates, close authority.** For each reserve mint both the classic and the Token-2022 ATA derivation must be declared; any token account that actually exists must be exactly 165 bytes (extensions refused), PDA-owned, delegate-free (`d[72..76]`, `d[121..129]`, `d[129..133]`), and empty. The second loop applies the same three checks to any *declared* non-reserve token account owned by the PDA (this was the round-23 repair that added the T22-extension and delegate checks there — I confirmed it now matches the reserve loop). Undeclared accounts/assets remain invisible — that is accepted limits 9/44, not a new gap.
- **Lamports.** `asset_signer.lamports() == 0` is enforced; Core `BurnV1` does not sweep them (measured fact 4), so dropping the check would destroy SOL. Correctly kept.

No defect found in R1.

## R2 — COMMUNITY POOL

Traced `acc_scaled`/`owed_scaled`/`debt_scaled`/`carry_scaled` across `credit`, `claim`, `join`, `reweigh`, `retire`, `expire_boost`:

- **Solvency (`pool ≥ ceil(owed)`).** `credit` adds `delta = floor(avail·SCALE / w)` and `owed += delta·w ≤ avail·SCALE`, so after crediting, `ceil(owed_new) ≤ owed_before_sats + avail = balance`. Claims pay whole sats and move the sub-sat remainder into `carry`; retires subtract exactly `pending`. I could not construct a path where `owed_scaled` outruns the pool balance. The `PoolShort` guard and P.32 assert it.
- **No payment for pre-join revenue.** A vault joins with `debt = w·acc` at the accumulator *as it stands at join*, and join only happens once `dist_epoch > request_epoch`. A distribution that ran before the join raised `acc` before the debt was set, so the joiner's `w·acc − debt = 0` for it. The two-step request/join plus `JoinWaitingFirst` closes the launch backlog capture. I tried activate+distribute in one tx (both orders), tick-then-join-self, and distribute-while-eligible-waiting; each is refused or yields zero to the newcomer (3c.A3/A4/A6 arms match the code).
- **Counters (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`).** I walked every ordering of activate/join/retire/advance_epoch. `pending_this_epoch` is only decremented on retire when `request_epoch == dist_epoch`, which is exactly when activate incremented it in the same epoch (advance_epoch zeroes it otherwise), so no underflow. F21's both-epoch retire cases are correct. `weight_of` is only reachable for `active` records, which always have a drawn level, so the denominator never counts a level-0 vault.

No defect found in the base pool accounting.

## R2b — THE $CBOB BOOST (round-23 repairs: highest priority)

This is the newest code, so I gave it the most attention, specifically the round-23 repairs `BoostNotTheOwner` and `BoostTermsMoved`.

**Repair checks:**
- `BoostNotTheOwner` reads the owner from the live Core asset bytes (`d[1..33]`) after `require_live_vault` proves it is a live CBOB asset and after `asset.key() == r.asset`. The account key cannot be spoofed and the bytes are Core's source of truth, so only the current owner passes. Ordering is before the burn, so a failed owner check burns nothing. I could not bypass it: there is no path where `burner` signs but is not the asset owner.
- `BoostTermsMoved` (`price ≤ max_price && extra ≥ min_weight && epochs ≥ min_epochs`) is checked before the burn. A vote landing between sign and execute that raises price or lowers weight/length refuses and burns nothing; a favorable move is correctly allowed. This mirrors `mint_vault`'s `max_price` and is sound.

**Invariants the prompt asked me to prove or break:**
- *Exactly N distributions.* A boost bought at epoch `e0` gets `end = e0 + N`. Each `credit`/`tick` advances the epoch by exactly 1 and moves boosts whose `end == dist_epoch` into `boosts_due`; `distribute` and `monthly_inline` both require `boosts_due == 0`, so no distribution runs past a due boost. The boost earns epochs `e0+1 … e0+N` = N. Same-transaction `[boost, distribute]` counts the distribution (bought first); `[distribute, boost]` does not. Both match BO.21. I could not get N+1 or N−1.
- *Nothing lost/gained on weight change.* `reweigh` sets `carry = owed_before`, `debt = after·acc`, so `owed = after·acc + carry − debt = owed_before`. `claim`'s normalisation sets `carry = pending − settled`, `debt = weight·acc`, preserving the sub-sat remainder. `expire_boost` reweighs to 0 with the same preservation. I traced boost→distribute→expire→claim and boost→retire in both due and not-due states; earned value is conserved.
- *Ring/totals agreement.* `BOOST_RING = 64`, `max_boost_epochs ≤ 63`. Because a boost's lifetime is strictly less than the ring size, at the moment `advance_epoch` clears slot `s`, the only live boosts in that slot end at exactly this epoch (an end of `E+64` cannot exist yet — it is created at `≥ E+1`; an end of `E−64` was already cleared). So no premature or missed due. `unschedule_boost` picks `boosts_due` vs `boost_expiring[end%64]` by `dist_epoch ≥ end`, matching where the boost actually is. Retired records keep `boost_weight`/`boost_end_epoch` but are skipped by `claim`, `expire_boosts` and the crank, and `retire` unschedules exactly once, so no double-decrement. The new host test models the wrap past 3×64 epochs; I re-ran the argument independently and it holds.
- *No double/early/never expiry.* `expire_boost` requires `boost_weight > 0 && dist_epoch ≥ end`; a second call sees `boost_weight == 0` (record re-loaded) and skips. `expire_boosts` and `claim` both re-load the record, so a duplicated entry in one batch cannot double-expire. A due boost cannot be stranded: expiry is permissionless and needs only the record (no token account), so a gone/closed vault ATA does not block clearing the gate.
- *Liveness via boosting.* A due boost blocks `distribute` until expired, but expiry is free and anyone's, so the block is temporary and self-clearing. Buying a boost while `boosts_due > 0` or `waiting_to_join > 0` is allowed and does not worsen either gate. I could not make distributions permanently impossible through boosts.

**One residual the repairs did not change** (already accepted, restated so it is not mistaken for new): because the burn path has no interval, anyone can run out every live boost for ≈ N×100 $GARY. That is limit 51 / round-23 F2, disclosed. Not re-reported as new.

No new defect found in the boost.

## R3 — LEVEL DRAW

- `blockhash_in_window` pins the sysvar key, bounds `n ≤ 512`, checks the buffer length against the declared count, and refuses an all-zero hash. It selects the *smallest produced* slot in `[want, want+64]`, deterministic. The new host tests cover skips at A/B/C, a full 512 buffer, truncation, a forged key, and a zero hash — I re-derived the selection and it matches.
- `try_capture` spaces A→B→C by two 4-slot leader groups from the *actual* previous slot; worst-case C lands ≤ ~208 slots past `reveal_slot`, inside the 300-slot window and 512-slot buffer, so a capture inside the window always finds its hashes. Missed window → `Expired` → reschedule to `now+16` (a future slot), never a default level. FIFO via `index == revealed_total`; a burned head-of-queue vault still draws (Core write skipped), so the queue cannot stall.
- Attribute re-supply is hash-checked against `attrs_hash`; a one-byte alteration refuses (`AttributesMismatch`). The 640-byte stored cap keeps the reveal inside a legacy packet (L.12).
- Residual grinding: the last contributor (C's leader) can bias, and a cohort minted in one slot shares A/B/C. This is accepted limit 26 and I did not find it worse than stated (each vault still mixes its own asset address).

No defect found.

## R4 — GOVERNANCE

- Electorate fixed at creation (`index_snapshot`, `quorum_supply = minted − burned − bare_retired`), divisor is the snapshot (not `max`), so mid-vote mints can neither vote nor raise the bar. `VaultTooNew` enforced by reading the mint index from the pinned `VaultRecord`.
- Quorum uses ceiling division and `need > 0`; threshold is `floor(yes·10000/cast) ≥ threshold_bps`; the 10% turnout and the 50% key-change rules use ceiling on the snapshot. A guardian change or swap-operator arm is detected by `set_guardian: true` or `ArmSwapOperator`, so bundling a restart with a guardian change still requires half — conservative, not a hole.
- Per-kind ordering with logged skips: an overtaken round/guardian/operator/boost-terms is skipped and the rest of the bundle lands; a `SetRound` already over still advances `last_round_id` (round-23 RT3-#4 fix — I confirmed the mark moves before the over-check). `restart`'s `StopIsNewer` uses strict `<` in MINT and `≥` skip in GOV — consistent, and the same-second tie goes to the stop (round-22 fix).
- The guardian cannot cancel its own replacement (no such instruction), `apply_guardian`/`apply_swap_operator` are permissionless after notice, and `cancel_swap_operator` clears only a pending key. I could not find a minority path to a key change (needs ceiling of half the snapshot) or a way to freeze governance while any vault exists (new proposals snapshot the current, lower supply).

No defect found.

## R5 — CHARTER CLAIM

- Identity is by address against the Merkle root; leaf/node are domain-separated (0x00/0x01) and pairs sorted, so second-preimage and reordering are closed. A lookalike minted by the hot update authority is not in the tree (C.8). The PoB must be Core-owned, signer-owned, in `pob_collection`, and in the root, then is CPI-burned as the owner in the same instruction — atomic, one leaf spent once (a burned address is not re-mintable, measured fact 7).
- `pob_extra` accounts pass through to Core's burn **never as signers** (`AccountMeta::new(..., false)`), so they carry no authority. A rejecting oracle still refuses (accepted limit 46); an approving/benign one cannot brick the claim.
- The window is clock-only, cannot reopen, and is deliberately not gated by the guardian stop (ruling). I could not find a path for the hot wallet, a PoB holder, or a third party to claim with a PoB they do not own or to spend one twice.

No defect found.

## R6 — ONE-TIME CONFIGURATION & TRUSTED HOP

- I reviewed every `initialize` bound. MINT refuses a default 15% destination, a payment mint not in SEAL's reserves, a dirty/foreign/already-minted collection, out-of-range tighten bounds, bad charter window, zero PoB root, and bad boost bounds. SEAL refuses non-classic-SPL reserve mints (the Token-2022-seals-every-vault landmine) and an empty list. BURN/GOV refuse a sibling naming a different collection. The royalty is installed with `PluginAuthority::None`, which Core refuses to update or remove (R.5/R.6 arms prove this on a control collection).
- A wrong-but-accepted value is permanent (limit 38, OPEN). The code enforces ranges but cannot enforce *intent* (e.g., `quorum_bps` up to 10000 is legal and could make governance unreachable; `charter_opens_at` in the past is accepted as long as `closes_at > now`). These are launch-value risks, not code bugs, and `check-launch-params.mjs` is the stated control.
- `sweep_sol_for_swap`: destination pinned to `config.swap_operator`, operator must sign, amount ≤ cap, cooldown enforced (a second sweep in the same tx fails because `last_sweep_at` is updated and `MIN_SWEEP_COOLDOWN_SECS ≥ 1`), reserve preserved, guardian-stop honored. Worst case is the accepted cap×cooldown exposure (limit 10).

No defect found beyond the accepted init-value risk.

## R7 — CROSS-PROGRAM RAW READS (recomputed by hand)

I recomputed every offset from the struct definitions (Borsh, tight packing, 8-byte discriminator). All pinned readers agree:

- `MintConfig`: version@8, collection@9, governance@41, pool_ata@73, minted_total@141, sales_stopped@191, sweep_stopped@192, sol_reserve@257, max_sweep@266, cooldown@274, charter_closes@442, charter_claimed@450, bare_retired@454, sales_stopped_at@518, sweep_stopped_at@526, sweep_floor@631, cooldown_ceiling@639, reserve_ceiling@647, max_boost_weight@711, max_boost_epochs@712. GOV's and BURN's pinned constants match each of these.
- `VaultRecord`: version@8, asset@9, mint_index@41 (GOV reads this). Space = 221 bytes.
- `BurnConfig`: version@8, collection@9, bump@41, burned_total@42 (GOV reads this). 
- SEAL `Config`: version@8, collection@9, reserves@41 (MINT/BURN read these).

Every reader also pins the account discriminator **and** the layout version byte, so a future reorder fails loudly. `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` are sufficient (the suite initializes and reads all of them). No offset or size error found.

## R8 — SUITE / SIMULATION AS EVIDENCE

The suite is genuinely strong (real Core, real tokens, both-direction negatives, `because` reason-pinning, assertion floors that must equal the count). Arms that are weaker than they read:

- **X.7** is acknowledged in-comment as unable to fail its ordering claim (the census is exhausted by then, so the plan is empty). Ordering is instead carried by `bank/selftest.mjs`. This is an arm whose stated property is not exercised here.
- **RL.7** replays the ring against the cap computed from the *largest ever* live supply (`minted_total`), which is looser than the cap in force at each redemption. It cannot catch a per-redemption over-cap that stays under the max-supply cap. RL.1–RL.6 pin the exact behaviour, so this is a secondary check, but its banner overstates it.
- **5.2** ("mint a vault owned by a PDA that can never sign") is refused as `AccountNotSigner`, not by any off-curve detection — it proves the PDA did not sign, not the intended "off-curve owner cannot redeem" property. The SPEC already concedes `owner: Signer` is "the best available check, not a complete one," so this is an evidence-quality gap, not a false pass.

---

## FINDINGS

### LOW-1 — A frozen pool reverts a *mixed* claim batch, so "joins still go through" is only true for join-only batches

- **Construct:** `programs/cbob-vault-mint/src/lib.rs`, `claim`. The pair loop joins pending vaults (`continue`, no transfer) but pays active vaults via an SPL `Transfer` CPI from `pool_token`. If the pool is frozen, that transfer fails and the **entire instruction reverts**, rolling back any joins earlier in the same batch. `claim` checks each *destination* for freeze, never the pool.
- **What is gained / lost:** Nothing is stolen. But during a Coinbase freeze of the pool, a caller (or a crank pass) that batches a join with any vault that is owed ≥ 1 sat gets the join reverted too. The SPEC/limit-28 statement "A frozen POOL stops every claim (joins still go through)" is therefore only true when the batch contains nothing payable.
- **Evidence if I am right:** freeze the pool, send one `claim` with `[pending_vault, owed_active_vault]` → whole tx reverts (SPL frozen-account error from the pool transfer); send a `claim` with only the pending vault → it lands and joins. The existing 3c.F arms freeze the pool but never mix a join with an owed vault in one batch, so this path is untested.
- **Fix (choose one):** (a) in `claim`, detect a frozen pool once up front and, when frozen, process joins but skip all payments (deferred, logged) instead of letting the transfer revert; or (b) correct the SPEC/limit-28 wording to "joins still go through *in a batch that pays nothing*," and make the crank send join-only claims during a freeze. Given immutability, (b) is the realistic path; (a) is a program change that must happen before the lock.

### LOW-2 — `claim`/`expire_boosts` expiry persists even when the payment is deferred by a frozen destination, but the deferred share is then computed at the *post-expiry* weight (informational correctness confirmed; flagging the untested ordering)

- **Construct:** `claim`, the `expire_boost` → `owed_of` → frozen-destination-`continue` sequence.
- I traced this and it is **correct** (the boost's last distribution was already credited at boosted weight; expiry only changes future weight, and the deferred `pay` is computed from the conserved `owed`). I record it here because it is a subtle ordering that no arm exercises: no test expires a due boost *and* defers the same vault's payment to a frozen destination in one claim. If this ordering is ever touched, it should get an arm.
- **Evidence if it were wrong:** a boosted vault whose destination is frozen at the moment its boost is due would be deferred at the wrong (base) weight and lose the boosted share. Currently it does not.
- **Fix:** add an arm: boost a vault, run its last distribution, freeze its cbBTC account, claim it → expect `ClaimDeferred` with the boosted-weight amount and the boost expired.

### INFO-1 — Suite arms that cannot fail or fire for a different reason than named

X.7 (empty-plan ordering), RL.7 (max-supply cap bound), and 5.2 (`AccountNotSigner` standing in for off-curve detection) as detailed under R8. None is a false *pass* (each still rejects/allows as recorded), but each is weaker than its banner. Recommend either tightening the arms or downgrading their comments so a future reader does not treat them as proof of the named property.

### INFO-2 — Versioned-transaction / address-lookup-table redemptions are unverified

- **Construct:** SEAL `open_for_redemption` and BURN `burn_vault` instruction-sysvar walks (`load_instruction_at_checked`), which compare resolved pubkeys at fixed indices.
- Every measured redemption is a **legacy** transaction (9.14/9.14a). If a redemption were ever built as a v0 transaction resolving the asset/owner through an address lookup table, the sysvar account keys the programs compare would need to be the resolved keys for the pairing to match. I could not confirm this from the bundle and the suite never exercises it. This is fail-closed (a mismatch refuses the thaw; nothing leaks), so it is a liveness/compatibility question, not a security hole.
- **Evidence if I am right:** a v0 redemption using an ALT for the asset/owner would refuse `NoTerminalBurn`/`NoPrecedingOpen` despite being well formed.
- **Fix:** none required for launch (legacy fits and is the only measured path). Document that redemption clients must use legacy transactions, or add a v0 arm before relying on it.

### INFO-3 — `boost_vault` does not require `boosts_due == 0` or `waiting_to_join == 0`

Buying a boost while other boosts are due or while vaults wait to join is permitted. I verified this does not worsen either gate (both are cleared permissionlessly, and the new boost's epoch math is unaffected), so this is not a defect — recording it so it is not later read as an omission. If the intent was to forbid boosting into a stalled epoch, it is not enforced; as written it is harmless.

---

## THE FOUR ACCEPTED-LIMIT QUESTIONS

1. **Is any limit WORSE than stated?**
   - **Limit 28** ("a frozen POOL stops every claim (joins still go through)") is slightly worse than stated — see LOW-1. Joins survive only in a batch that pays nothing.
   - Limits 27 (+12 boosted dead weight), 55 (unsplit-revenue bound holds only while the crank runs), 51 (third-party boost run-out), and 36 (a due boost is another reason the in-line month is skipped) were already flagged as worse-than-stated in the round-23 verdict and are now documented. I confirmed they are no worse than that corrected statement.
   - I did not find any other limit worse than stated.

2. **Is anything listed as a limit not actually a limit?** No. Each accepted limit I re-checked (9, 25, 26, 27, 28, 32, 41, 43, 44, 46) still describes a real, reachable gap. None is secretly closed.

3. **Is any DISCHARGED item not actually discharged?** I spot-checked the load-bearing ones and they hold: **#19** (unlevelled-vault halt) is closed by construction — `activate` requires `level ∈ 1..5`, so no activated vault is unlevelled; **#14** (duplicate attributes) is closed by `DuplicateAttribute` in both mint paths; **#30** (85/15 as a vote) is discharged — `update_wiring` does not exist and `split_bps` is written once; **#12/17** (compute) is discharged for the padded-mint path, with the round-23 caveat (item 54) that a crank-carrying mint exceeds the *default* budget — which is now documented. I found no discharged item that is actually open.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** Not in the code. Items 22 (no live distribution), 38 (init values), 50 (holder surfaces), 52/53/54 remain genuinely open and are not papered over by the programs. The one pressure point: **item 50's absence means limits 9 and 44 have no preventive control at all** until the redeem page exists — the code is honest about this, but it is the single most consequential open item for real holders and should not drift into "accepted" by schedule pressure.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what AI audit structurally cannot do, and what the project must therefore do before launch

1. **Run the mainnet dress rehearsal against a live cluster (item 22).** Every assertion here is from a local validator. AI can read the crank and the pipeline but cannot exercise live RPC rate limits, real confirmation latency, a transient error on vault 1,900 of 2,100, or the every-minute reveal lane keeping up. This must be done with real (small) value before the authority is removed. It is the one thing that has never happened to the money path.

2. **Verify the upgrade-authority removal out-of-band, on chain, after deploy.** AI audits the code as written; it cannot witness the signing ceremony. An independent script/operator should `program show` all four programs after step 11 and confirm `authority == None`, and the alarm's `program_not_locked` check should be confirmed to fire against a deliberately still-upgradeable canary before launch.

3. **Prove the deployed bytes match the audited bytes.** The suite audits source; the chain runs a `.so`. Run `scripts/build-mainnet.sh` and compare the printed sha256 against `program dump` of each deployed program, and confirm the mainnet binary rejects the localnet init key (the one acknowledged difference between tested and shipped binaries). Do not rely on the fact that they were built from the same tree.

4. **Confirm the init values at the moment of signing, not in this document.** Item 38 is permanent. A human (or a hardware-confirmed automation) must run `check-launch-params.mjs` against the *actual* transaction being signed and refuse on any OPEN or mismatched ruled value — especially `charter_opens_at`, `lock_deadline`, `redeem_window_secs = 3600`, `monthly_secs = 2,592,000`, `notice_secs = 604,800`, `min_voting_secs = 259,200`, quorum 2100, threshold 5100. AI can enumerate the risk; it cannot hold the key that writes them.

5. **Establish real custody and monitoring for the keys AI can only name.** The swap operator key, the guardian (Gary's wallet), and the $CBOB release wallet (all 2.1B on this box, limit 56) are human/operational problems. Move or multi-sig the release wallet per the open ruling, and confirm the alarm's dead-man's switch, Core-upgrade watch, and cbBTC-freeze watch actually page a human who can act. An AI cannot be paged.

6. **Build the redeem page (item 50) before the lock, outside the frozen tree.** It is the only preventive control for limits 9 and 44, and the holder guide already promises it. Because any change to `programs/`, `bank/`, or `scripts/` resets the freeze counter, build it in its own surface (or before the freeze) so the two clean rounds still count.

7. **Get a second, different-model roster for the two clean rounds.** This round is one reader. The ship gate already requires the second clean round to use a different roster; enforce it. Agreement with yourself is not independence, and the worst defect in every round has lived in the previous round's repairs — which a fresh model family is most likely to see.

8. **Pin the external trust anchors from a source the audit does not control.** The Metaplex Core hash, the cbBTC/$GARY/$GIRAFFISH mint ownership, and the Giraffish Moments collection state are read live. Re-dump and re-hash Core from an independent RPC, and re-read the Moments collection's plugins immediately before the charter window, so the pinned constants are not inherited stale.

The programs themselves I could not break: the pairing is fail-closed, the pool is solvent by construction, the boost conserves earned value and cannot stall distributions, the draw is FIFO with real entropy, and the cross-program layouts are correct. What remains is almost all *outside* the four programs — the live run, the keys, the one-time values, and the surfaces holders will actually use. That is exactly the part no AI round can do for you.