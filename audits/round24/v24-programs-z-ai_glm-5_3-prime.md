# Round 24 — programs, suite, simulation

**Verdict up front: no CRITICAL and no HIGH in the four programs that I can substantiate.** I attacked the custody pairing (including CPI-wrapper shapes one and two levels deep), the pool accumulator and every counter under every host ordering I could construct, the boost's ring and carry arithmetic, the draw's sysvar parse and window arithmetic, the governance tally and skip logic, the charter Merkle, every pinned cross-program offset (recomputed from the struct definitions), and the rate ring. Each held. What did not hold is the **evidence layer**: the certifying runner, as bundled, cannot pass, and the round-23 repair list has one named arm that was never added. Those are below, each with the one command that settles it.

I want to be explicit about my own fallibility here, because the prompt is right that wrong CRITICALs cost real time: while drafting this report I initially believed the simulation's assertion count (59) contradicted SPEC's "60/60" — I had missed the thirteenth `because()` pin. Recounting killed the finding. Everything below survived the same recount discipline, but every claim is written so a run can refute me in under a minute.

---

## R1 — Custody

**What I attacked and what held:**

- **The pairing, both directions.** SEAL's forward walk (`open_for_redemption`, `programs/cbob-vaults/src/lib.rs`) and BURN's backward walk (`burn_vault`, `programs/cbob-vault-burn/src/lib.rs`) each bind program id, discriminator, asset at index 0 and owner at index 2. The walks are fail-closed (`load_instruction_at_checked` errors end the loop with `found = false`). A matching burn in SEAL's walk either executes `burn_vault`'s real handler or fails the transaction — there is no instruction that carries BURN's id and `burn_vault`'s discriminator without executing it — so a committed transaction cannot leave a thawed vault unburned.
- **CPI wrappers.** The two checks in `retire_redeemed` are genuinely complementary, not redundant: a *top-level wrapper* CPI'ing `retire_redeemed` directly sits at stack height 2 (passes the height check) and is caught only by the instructions-sysvar program-id check; a *wrapper around `burn_vault`* passes BURN's own walk (the outer top-level index is what the sysvar reports) and is caught only by the height check at the retire CPI, after the Core burn — which reverts with everything else. I traced the shape `[real open, sweep, wrapped burn]`: the open's forward walk finds no top-level burn and refuses `NoTerminalBurn` before anything moves. WR.1–WR.4 cover the three shapes; I could not construct a fourth.
- **The emptiness proof.** Delegate/close-authority/delegated-amount offsets (72..76, 121..129, 129..133) are correct against the SPL account layout. Both ATA derivations (classic and Token-2022) are required per reserve mint; extension-length accounts are refused, not skipped; declared-but-foreign accounts fail `ReserveNotOurs`. The `d.len() < TOKEN_ACCOUNT_LEN → continue` skips only accounts that cannot hold token value. The wrapped-SOL rent case is limit 44/round-23-F5 as stated.
- **The rate ring.** `kth = rate_ring[(head − k) mod 64]` is the k-th most recent write; entries start at 0 ("long ago"); the cap is bounded by the ring at live supply ≤ 3,047 and `max_supply` is 2,100, so the "stricter, never looser" claim holds. Account-conflict sequencing means concurrent burns in one slot are serialized on `burn-config`.

**No finding.**

## R2 — The community pool

I traced the invariant **pool balance ≥ ceil(owed_scaled)** through every writer: `credit` (owed grows by `delta·w ≤ avail·SCALE`), `claim` (owed drops by exactly `pay·SCALE`, pool drops by `pay` — the ceiling arithmetic is exact), `join` (owes nothing), `reweigh` (owed unchanged), `retire` in all three modes (owed only decreases; the pool only decreases via claims). I also verified the stronger identity `owed_scaled == Σ_v owed_v` holds at every step, which is what makes every claim payable. `pending_this_epoch` is decremented on retire only when `request_epoch == dist_epoch`, which is exactly when the counter includes the vault — round 22 F21's fix is correct at both sites.

Liveness: both distribution gates (`JoinWaitingFirst`, `BoostsExpireFirst`) are clearable by permissionless instructions that need only records (`retire_burned`, `expire_boosts`), so neither is a permanent block. The bare-burned-waiting-vault join is limit 27 as stated.

**No finding.**

## R2b — The $CBOB boost (round-23 repairs first)

The two repairs are correctly placed: `BoostNotTheOwner` reads the owner from the live asset bytes *after* `require_live_vault` has pinned `KEY_ASSET_V1` and the collection, and *before* the burn CPI (BO.6's second clause proves nothing is burned); `BoostTermsMoved` is checked before the burn (BO.26/BO.26a).

I proved rather than assumed the two hard claims:

- **Exactly N distributions.** `end = dist_epoch + N`; the boost is due the moment `advance_epoch` lands on `end`; `BoostsExpireFirst` then blocks every further distribution (both `distribute` paths and `monthly_inline` check `boosts_due` before any epoch advance), so the accumulator cannot move past a due boost. The distribution the boost rode in on counts (reweigh precedes `credit` in the same transaction), giving exactly N.
- **The ring cannot double-consume.** The dangerous case is two live boosts with end epochs 64 apart sharing a slot. I derived the contradiction both ways: if boost 1 is not yet due, `E2 ≤ dist_epoch + 63 < E1 + 64`; if boost 1 is due, the gate freezes `dist_epoch` at exactly `E1`, so `E2 − E1 = N2 ≤ 63`. The host test's model agrees. `unschedule_boost`'s due/ring branch matches `advance_epoch`'s consumption exactly, so `boosts_due` can never underflow or strand.

The carry arithmetic (`reweigh`, claim normalization, retire) preserves owed in every ordering I tried, including expiry inside a claim batch and a boost bought while the month is due.

**Findings:**

**[LOW] The Test Vault simulation never exercises the boost — round 23 F7(j) named this arm and the repair did not add it.**
- *Construct:* `sim/test-vault.ts` — no `boost_vault`, `expire_boosts` or `set_boost_terms` instruction is built anywhere in the file; the Test Vault's life (claim → draw → load → activate → vote → join → paid → redeem) contains no boost.
- *Gain:* the only whole-life run against the real Core build and the real reserve mints has zero coverage of the newest money-moving code in MINT. The main suite's BO section covers it against the local fixture, but the sim is the artifact that exercises the *whole* life end to end, and round 23's verdict explicitly listed "(j) Sim: one boost, expiry and terms vote" as an arm each gap needed.
- *Evidence:* `grep -n "boost" sim/test-vault.ts` returns only the stale comment quoted below. The sim's final line will show no boost-related assertion.
- *Fix:* add one boost to the Test Vault's life — buy after activation, one distribution at boosted weight, expiry, then redeem — or record F7(j) as deliberately not taken in the round-23 verdict file, so the next reader does not assume it closed.

**[INFO] The sim's $CBOB comment is now false.** `sim/test-vault.ts` says "$CBOB does not exist on mainnet yet"; `launch/mainnet-init.json` records the mint created on mainnet 2026-10-04 (`GMm2yY2z…`, RULED). The local stand-in is still fine for a validator, but the comment misstates a pinned mainnet fact. One line.

## R3 — The level draw

`blockhash_in_window` pins the sysvar key, bounds the count at 512, checks the buffer holds the declared count, and refuses all-zero hashes — the parse is defensive in every direction the prompt asked about. The window arithmetic closes: A ≤ reveal+64, C ≤ reveal+202, both inside the 512-slot buffer for any `now ≤ reveal+300`; a 64-slot skip at B or C yields `NotYet` until the window lapses, then a reschedule — never a partial draw. The FIFO cannot strand the last vault (`check_supply` guarantees `remaining ≥ cap_total − minted_total > 0` at every reveal), and a burned head still draws. The residual grind is **not worse than stated**: the cohort-sharing and reschedule-timing variants are both already in limit 26's text.

The skipped-slot paths are host-tested only — which is exactly why the host tests must actually run. See M1.

**No finding in the program.**

## R4 — Governance

The tally uses ceiling divisions correctly; the snapshot rules (index and live supply frozen at creation, divisor never `max`) are as documented; `KeyChangesBundled` and the half-of-all-live-vaults supermajority are enforced at creation and execute; the per-kind ordering marks move before the over-check (RT3-4's fix); GOV's restart skip (`stops_at >= created_at`) matches MINT's `StopIsNewer` (`<`) exactly — the round-22 tie fix is consistent at both sites. I could not construct a minority path beyond the ruled 10.71% for ordinary actions, nor a freeze beyond the accepted all-vaults-redeemed case (limit 45).

**No finding.**

## R5 — The charter claim

Domain-separated leaf/node tags, sorted pairs, depth ≤ 16, identity by address against the committed root, the PoB positively validated as a live Core asset in the pinned collection owned by the signer, burned by CPI in the same instruction, `pob_extra` never as signers. The hot-wallet risks (a rejecting hook, an asset-level plugin unpaged, moving a PoB out of the collection) are limit 46 as stated — I have nothing worse.

**No finding.**

## R6 — One-time configuration and the trusted hop

Every `initialize` bound recomputed; the collection-cleanliness walk is correct; the royalty's `PluginAuthority::None` is proven immutable by the suite's both-ways control arms (R.5/R.6/R.6c) against real Core. The redemption cap is exactly a rolling window over 64 *timestamps* (the prompt's "64-slot ring" phrasing is looser than the code, which is the safe direction). The values that could be wrong-but-accepted and locked forever (payment mint = any SEAL reserve rather than cbBTC specifically; an off-curve guardian; a charter window up to 90 days) are all limit 38's domain and are pinned by `check-launch-params.mjs` — nothing new to add.

**No finding.**

## R7 — Cross-program raw reads

I recomputed every offset from the struct definitions: MintConfig field-by-field to 1005 bytes + 256 padding (all 17 GOV offsets and both BURN offsets match), VaultRecord to 211 + 10 (GOV's three and the suite's twelve match), BurnConfig to 571 + 256 (GOV's 42 and the suite's 50/58/59 match), GovConfig and the SEAL config. The space constants equal the field sums exactly. **No misread found.**

## R8 — The suite and simulation as evidence

**[MEDIUM] The host-unit-test floor does not equal the host test count: as bundled, `run-tests.sh` cannot exit 0.**
- *Construct:* `scripts/run-tests.sh` sets `HOST_FLOOR=5` and floors `cargo test -p cbob-vault-mint --features localnet --lib` on `[0-9]+ passed`. `programs/cbob-vault-mint/src/lib.rs`'s `#[cfg(test)] mod host_tests` contains exactly **four** `#[test]` functions (`the_lookup_takes_the_smallest_produced_slot_in_the_window`, `a_full_buffer_reads_and_malformed_ones_are_refused`, `capture_skips_at_a_b_and_c_and_matches_the_model`, `the_boost_ring_wraps_exactly_against_a_model`); `model` and `blank_config` are helpers without `#[test]`.
- *What is gained:* nothing monetary — but the floor function's own rule is "the floor must EQUAL the count," and it dies with `host unit tests: 4 assertions but the floor says 5` at step [6/7], *before the 748-assertion suite ever runs*. That makes SPEC's "green end to end," the road table's "suite green," and every count behind the ship gate untrue of this exact tree. The cascade matters: if the last green run was on a different tree, then `MIN_ASSERTIONS=748` and every other floor is unverified for the tree being certified. This is the project's own most-repeated defect class (round 12, round 19, round 22, round 23 F19), found in the round-23 repairs themselves — exactly where this round was told to look.
- *Evidence if I am right:* `grep -c '#\[test\]' programs/cbob-vault-mint/src/lib.rs` → 4; `cargo test -p cbob-vault-mint --features localnet --lib 2>&1 | grep 'test result'` → "4 passed"; a `run-tests.sh` run dies at the host-unit-tests floor. If the repository's lib.rs in fact carries a fifth test, then the bundle is not the tree the green run certified — a different finding of the same weight.
- *Fix:* set `HOST_FLOOR` to the true count (or restore the missing test) in the same commit, per the project's own discipline; then re-run the full gate on the frozen commit and archive the counts, because every "green" claim now rests on a run nobody has shown.

**What else I checked in the suite:** I looked for arms that cannot fail and found none new — `books()` (BO.9a/14a/17b/29a), P.32 and RL.7 all compute real independent state and can fail; RL.7's cap bound is honestly labeled as the largest-supply bound (round 23 F22, known). The `because()` pins I sampled name the right errors; the shared `0x0` pins remain weak exactly as F22 recorded. The suite's own `ID.1` uniqueness check is present. Claims in the prompt with no arm: the boost in the sim (L-finding above), the `[distribute, boost]` transaction order (trivially equivalent to two transactions), and the 3600 s / 30-day / 7-day values (honestly disclosed as unexercised in limits 32/33 and SPEC).

---

## The four questions about the accepted limits

**1. Is any limit worse than stated?** I could not substantiate one. The candidates I probed hardest: limit 27's dead weight — a bare-burned vault carrying a live boost does block distributions when the boost comes due, but `expire_boosts` expires it (the record is still `active` until retired) and `retire_burned` clears it, so the block is permissionlessly clearable, which is what the limit's text already rests on; limit 26's cohort bias and reschedule timing are both in the text; limit 55's unsplit growth during a crank stall is in the text; limit 32's ring bound is sound at the fixed supply.

**2. Is anything listed as a limit not actually a limit?** No. Limit 35's "the turnout rule never binds at the ruled numbers" is arithmetically true (0.21 × 0.51 = 10.71% > 10%). Limit 43's round-22 note (a top-level mint check would force on-curve owners, possible only before the lock) is accurate and remains an open owner decision.

**3. Is any DISCHARGED item not actually discharged?** No. I verified 19 (no activated-but-unlevelled state exists; `activate` requires level 1..=5 and `join`/`weight_of` inherit it), 14 (`DuplicateAttribute` in `check_attributes`), and 30/31/33 (no instruction writes the split/destinations/`max_supply`; the period and notice are `initialize` values exercised by PG.8/PG.9/3c.K5/3c.G2) against the code as bundled.

**4. Is any OPEN AND BLOCKING item quietly treated as accepted?** Two drifts, both small: HOLDER-GUIDE states the X/website announcement in the present tense ("Every opening is public. It is announced on X and on the Bank's website") while `bank/redemption-poster.mjs` has no sender — this is item 50's scope and F21 already named it, but the guide is the buyer-facing surface and should not carry a present-tense promise before the sender exists; and the guide's "(being built)" for the redeem page sits oddly against SPEC's flat "not built." Items 22, 38 and 50 themselves remain genuinely open and correctly labeled. Nothing has been demoted.

---

## Anything else

Nothing further that survives measurement. I specifically checked and discarded: the `monthly_inline` slice comparisons (compile and compare correctly), `split_revenue`'s caller-supplied `decimals` (SPL validates it), the pre-funded proposal PDA (Anchor's create-account path handles rent-prefunded accounts, which is why 7.12d is ALLOW — the griefer pays the rent), and `initialize`'s unchecked `current_size` (only `num_minted` is meaningful, and Core keeps them in sync).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the frozen tree's full gate and archive the artifacts — a human at the terminal, logs kept.** This round found a floor/count contradiction by *counting text*; one `cargo test` invocation settles it. Every "green" claim in SPEC and DESIGN rests on runs no AI round has ever seen, and the project's own history says the counts drift (rounds 12, 19, 22, 23, and M1 above). Before the authority is removed: one full `run-tests.sh` + `run-sim.sh` on the exact frozen commit, with the printed counts mechanically diffed against every floor and every number in SPEC/DESIGN/HOLDER-GUIDE by a script, not a reader.

2. **Execute the attack shapes with a funded key on the dress-rehearsal cluster, not by reasoning.** The suite covers most shapes on a local validator; the rehearsal is where a real wallet actually attempts the CPI-wrapper redemptions, the two-vault cross-pairing, the rate-limit drain at the real 3600 s window, the 2,400-$GARY boost run-out, the unsplit-revenue join (limit 55) and the frozen-pool forfeit with money at stake — and it is the only test of the rehearsal patch itself (item 53).

3. **Re-derive every pinned constant with a second, non-LLM toolchain.** Discriminators, raw offsets, program ids, the Core sha256, the PoB root, the $CBOB mint's authorities, the Squads' ATA existence. The suite pins many against the Metaplex SDK, but the SDK is one implementation and the offsets are hand-pinned in three programs; a fifty-line independent script diffing all of them is an hour's work and closes a class no reading can.

4. **Discharge item 22 the way it says: the crank's I/O at ~2,100 records on a live cluster.** No AI round can exercise paging, rate limits, a transient RPC error at vault 1,900, or the reveal lane's cadence. This is already OPEN AND BLOCKING; the point is that nothing in this process can ever close it except the rehearsal.

5. **Run the operational drills with a human in the loop.** A guardian-compromise drill (stop → vote → 7-day notice → replace; measure the actual wall-clock against "about a vote plus a week"), a Coinbase-freeze drill (does the alarm page inside 30 minutes; does anyone know what to do), a crank-stall drill (does `crank_silent` page; does anyone respond). The detectors are proven both directions in selftests; the *response* is the only control on limits 28, 36 and 47, and it has never been tested.

6. **Move the $CBOB release wallet off this box before anything mints.** Limit 56 is Gary's call, but it is the single largest unmitigated value concentration in the system — 2.1B $CBOB on a hot key inside a nightly backup — and every AI round can only restate it. A Squads or Gary's own wallet plus a deleted box key closes it.

7. **One RPC call before the charter window opens:** read the live Moments collection and each of the 240 PoB assets for plugins — round 23 F15's residue ("UNVERIFIED: that the live Moments collection carries no permanent delegate from its own creation") is still open, and the alarm watches the collection account, not the assets.

8. **A validator run that skips slots, and one run at the real clock values.** The entropy reader's skipped-slot paths are host-tested only; a validator configured to skip (or a fork simulation) exercises them on chain. And at least one dress-rehearsal pass should carry the real 3600 s window and 30-day month, even though it makes the run slow, so "the same arithmetic" becomes "the run values."

9. **Decide the off-curve-owner question before the lock.** Limit 43's round-22 note is correct that a top-level `mint_vault` check is possible only before the upgrade authority is removed. After that, "a DAO cannot redeem" is permanent. That is a product decision only Gary can make, and no audit round can make or unmake it.

10. **Fund a standing bug bounty from the 15% before the authority is removed.** Post-immutability, the only remaining controls are detection and custody. Once the AI rounds end, a bounty is the only thing that buys new eyes on code nobody can ever patch — and announcing it *before* the lock is the last moment the announcement can mean "we wanted to know" rather than "we had to."

The order of operations on launch day itself — deploy, verify the deployed bytes against `build-mainnet.sh`'s sha256, initialize, create the three cbBTC accounts, *then* remove the authority — is already in the road. The one thing to add: the authority-removal transaction and the byte verification should be done by a human at the terminal with the sha256 read off the build output, because that is the single transaction where a mistake is forever, and no audit round, AI or otherwise, is standing there when it happens.