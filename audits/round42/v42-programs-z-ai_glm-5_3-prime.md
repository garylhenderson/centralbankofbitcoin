# Round 42 — Independent Audit Report

**Audited tree:** the bundle as given (round 41 repairs at `4a67d00`, programs unchanged since round 35's `0b3ddb3` per the round 41 verdict's empty `git diff` claims, which I accept as stated since the program sources in this bundle match the round 41 verdict's line citations).

**Verdict up front: NOT CLEAN. 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW, 1 INFO.** Nothing in the five programs. The LOW is in the web build path. The round 41 repair (V41-1) holds at every site I can check, and I found no path that moves value out of a vault, the pool, or the revenue address.

---

## R0. Round 41's verdict and repairs

### V41-1 repair verification (the one confirmed finding)

The repair applies `absentIfDust` (System-owned, 0-byte account → absent) to every read of a derived address the pages make. I re-traced every site:

| Site | Applied? | Evidence in this bundle |
|---|---|---|
| `web/src/lib/reads.mjs` `anchorAccount` | ✓ | `const a = absentIfDust(await account(...))` — covers all four config PDAs and the vault record |
| `web/src/lib/ceremony-reads.mjs` `resolveCollection` (SEAL read) | ✓ | `absentIfDust(await account(conn, baseIds.SEAL_CFG, ...))` |
| `web/src/lib/ceremony-reads.mjs` `readStep` 'collection' and 'atas' | ✓ | both wrap with `absentIfDust` |
| `web/src/lib/reads.mjs` `readBuySnapshot` (revenue ATA, holder ATA) | ✓ | `.map(absentIfDust)` on both reads |
| `web/src/lib/reads.mjs` `vaultWalletAccounts` (reserve ATAs + promised) | ✓ | `.map(absentIfDust)` on the by-address batch |
| `web/src/lib/reads.mjs` `readRedemptionSnapshot` (pool, owner ATAs) | ✓ | `.then(absentIfDust)` / `.map(absentIfDust)` |
| `web/src/pages/redeem.mjs` `payoutBlock` ($GARY ATA) | ✓ | `absentIfDust(await account(...))` |
| `web/src/pages/redeem.mjs` dry-run watch accounts | ✓ | `.map(absentIfDust)` |
| `web/meta/generate.mjs` (vault cbBTC ATA) | ✓ | round 40 V40-3 logic: dust → absent → 0 sats or a kept-file error |

The control cases still refuse: `anchorAccount` throws for any non-program owner *with data*, and `resolveCollection` still conflicts on a wrong-owner SEAL config with data. The e2e arm is present (`V41-1 e2e`: a stranger's 890,880 lamports at all four config addresses; preflight shows no conflict; every step then lands). The gate-5 control (wrong-owner-with-data still refuses) is claimed in `ceremony.test.mjs`, which I cannot see, but the shipped reader logic enforces it by construction: `absentIfDust` returns the account unchanged unless owner is System AND data length is 0.

**Regression check:** the only reads of derived addresses that do *not* wrap are ones where the raw lamports are the point (the ceremony's `fund` step reading the revenue PDA's balance, and the vault page reading the deposit address's SOL for display). Both are correct unwrapped: a stranger's lamports at the revenue PDA genuinely count toward rent (and are the project's money once there — the PDA is MINT's), and the deposit address's lamports genuinely are the holder's (the helper sweeps them). No regression.

### Round 41's rejected claims, re-tested

- **C8 (Muse, the rent rule):** R41.C8a–c are present in `tests/3prog.test.ts` inside the `SR.pre3` block. C8a refuses a 1-lamport credit to a fresh address; C8b lands exactly the floor; C8c refuses floor−1 to the emptied vault wallet. The claimed runtime behavior (a transaction that would leave a newly created account below rent exemption fails with `InsufficientFundsForRent`) is correct Solana semantics. The arms can fail (a runtime change would turn them red). **The rejection holds and is now measured.**
- **C2 (LongCat, dusted revenue ATA):** `readBuySnapshot` applies `absentIfDust`, so a dusted revenue ATA reads "not set up yet" — a true statement before ceremony step 5, and impossible after (the ATA is Token-owned and MINT never closes it; a stranger cannot un-own it). The window is empty. **The rejection holds.**
- **C5 (INIT_AUTHORITY theft between steps 9 and 10):** re-read SPEC. The exposure is stated (`:315-317`, `:1085-1088`, `:1751-1752`) and the ceremony shows WRONG ON CHAIN for a config written with other values. Understatement, not misstatement. **Holds.**
- **C12 (limit 26 wording):** re-derived `try_capture`. If A's or B's leader skips a whole group, the later targets shift — but that leader produces its block without hB/hC, so it is a blind re-roll, not a choice among evaluable draws. The stated sense of "influence" (limits 25/26) is about *choosing among draws one can evaluate*. **Holds.**
- **C22 (SPEC 46's 8-account bound):** the bound is in the same sentence; Core does not CPI into hooks (fact 12), so consulting adapters are one-account Oracles; stacking them is the stated "end the project" case. **Holds.**

### Round 41's measurements, re-verified

- The suite floor is 899 and R41.C8a–c are inside it (they sit in the `SR.pre3` block, which requires the `U3` precondition vault; the floor equaling 899 proves the block ran).
- `MIN_SWEEP_LAMPORTS` and the poster/oracle pins are in `bank/` files I cannot see; the VALIDATION's claims are specific and I have no contrary evidence.
- The drift sweep's B7 (the live crontab is still v5) is an honest operational finding that remains open.

---

## R1. Custody: the seal and the burn

I re-derived the pairing from the source, not from the verdicts.

**The instruction-sysvar walks.** SEAL's `open_for_redemption` walks forward from its own index for a top-level BURN instruction matching discriminator + asset (index 0) + owner (index 2). BURN's `burn_vault` walks backward for a top-level SEAL instruction with the same binding. `retire_redeemed` adds the stack-height check (`get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1`) *and* the instructions-sysvar check that the current top-level instruction is BURN's `burn_vault` naming this asset. A wrapper CPI into `burn_vault` reports the wrapper's index → the program-id check fails. A wrapper CPI into `retire_redeemed` is at stack height 2 → refused. WR.1–WR.4 measure all three shapes and the vault survives with its contents.

**Two vaults in one transaction:** both halves bind asset AND owner, so neither half can borrow from another vault's redemption (3.9, 3.10, 9.0, 4.10, 4.10a). The rate check runs *after* the pairing check in `burn_vault`, so a `RateLimited` refusal is itself proof the pairing accepted — the suite's `send` wrapper exploits this correctly.

**The emptiness proof.** I traced the closed-account path: the sweep helper closes what it empties; within the transaction a closed account is no longer owned by a token program, so BURN's `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue; }` skips it — the SPEC's "skips an account no token program owns." A closed account holds nothing (0 lamports, no data), so the skip is safe. An *open, emptied* account still passes the full checks (owner = PDA, delegate = 0, amount = 0). The delegate-planting-during-thaw attack (3.3/3.3a) is refused by `ReserveDelegated` when the account is left open, and is moot when closed.

**Can a thawed vault leave a transaction unburned?** No: the thaw and everything after it are one transaction; a failed burn reverts the thaw with it. The burn is not required to be the *last* instruction, but nothing after it can matter (the asset is closed by Core's BurnV1).

**Lamports:** BURN checks `asset_signer.lamports() == 0` *before* invoking Core's BurnV1, and Core does not sweep the PDA (measured fact 4). The helper empties the wallet in the immediately preceding instruction. Nothing runs between them in the page's transaction, and no stranger can inject an instruction into the owner's transaction.

**I found no new path.** The one completeness gap (undeclared holdings) is the accepted limit 44, and the redeem page is the stated preventive control.

## R1s. The sweep helper

**(a) Access control.** Direct calls need the asset-signer PDA's signature (SR.1). Through Core, the pinned binary's ExecuteV1 approves only `authority == owner` (SR.5, SR.5a refuse a stranger and an owner-added transfer delegate at 0x1a on a genuinely thawed vault; SR.5b pins the collection authority to MINT's off-curve PDA; SR.5c/5d are the control pair). While frozen, PermanentFreezeExecute rejects Execute — the vault cannot be reached outside a redemption. A Core upgrade that widens this is limit 40, stated.

**(b) The pair list.** Same source twice: the first pair transfers and closes; the second read of the now-System-owned source fails `IllegalOwner` ("Provided owner is not allowed") — SR.12a, and SR.12b pins that the refusal reached the *second* source, not the first guard. Source-also-destination is impossible (the source is PDA-owned, the destination must be dest-wallet-owned, and `signer == dest` is refused). A wSOL source is a plain classic account; the transfer and close behave correctly (the close's lamports include the wrapped SOL, which is the correct close semantics). A delegated source: only the account owner (the PDA, via Core Execute) can set a delegate, so it is self-inflicted and BURN also refuses it — loud, not silent. A close authority kept by a stranger: the helper's close reverts the whole call (R36.C5) and the page routes such accounts through a plain transfer instead. Odd account counts and non-[0] data are refused (SR.6/SR.7). Zero pairs is the lamports-only sweep (SR.13).

**(c) Destination checks.** The destination wallet is the owner's choice, and only the owner can reach the helper through Core — the same trust as any owner-signed transaction. The rent rule is now measured (R41.C8a–c): a sub-rent credit to a nonexistent destination is refused by the runtime, so a lamports-only sweep credits either 0 or at least the floor, and the canonical destination (the owner, who pays the fee) always exists.

**(d) The lamport sweep.** `signer.lamports()` is read at execution. Within the owner's redemption transaction nothing runs between the helper and BURN's check. BURN sees exactly zero.

**(e) Interaction with BURN.** Covered in R1 above: the closed account is skipped because it is no longer token-program-owned. A stranger creating a missing reserve ATA and depositing into it before the redemption lands only donates to the holder (the helper reads live balances). A Token-2022 ATA for a classic mint cannot exist (probe F4.2). A non-ATA token account or nested Core asset is invisible unless declared — the accepted limit 44, with the page's coverage check as the preventive control.

**(f) Does it fit?** S8.0 measures the three-asset redemption with claim at ≤ 1,084 bytes, reserving the 52+96 bytes for compute-budget and a separate payer. What a real page adds: nothing mandatory — the page sends no compute-budget instruction (W1/R40.U1: 158,377 CU over 4 instructions, inside the 4×200,000 default), no crank, and the in-line monthly run rides inside the claim's existing pool account. Strays and C5 transfers are dropped when they do not fit (the `left` list). A fourth reserve cannot exist (`MAX_RESERVE_MINTS = 3`, measured at 9.14).

**(g) Evidence.** The SR arms each have a `because` pin naming the exact program error; I checked each pin against the helper's code paths and found no arm refused for a reason other than the one named. The helper's bytes: `build-mainnet.sh` `cmp`s `dist/cbob_vault_sweep.so` against both its own localnet rebuild and `target/deploy/` (the bytes the suite and sim deployed). Proven.

## R2 / R2b. The pool and the boost

**The invariant "the pool always holds at least ceil(owed)".** I re-derived the accounting: `credit` adds `delta × w_total` to `owed_scaled` (exactly what every active vault's owed grows by, in sum); `claim` subtracts exactly what it pays; `retire` subtracts the departing vault's pending; `reweigh` and `join` do not touch `owed_scaled`. `distribute` refuses `PoolShort`; `monthly_inline` saturates to zero. The suite's `ledger()` recomputes the sum from every record after every money operation in sections IN, 3c and P (BK.*), and P.32 asserts the pool bound. **The invariant holds.**

**Counters under every ordering.** `pending_count`/`pending_this_epoch`: incremented at request, `pending_this_epoch` zeroed at `advance_epoch`, both decremented at retire (with the same-epoch guard — F21.1 measures a waiting vault redeemed and one bare-burned, both leaving both counters). `active_count`/`total_active_weight`: join/retire/reweigh adjust them consistently. The host test drives 260 epochs of random orderings through the program's own functions and asserts every counter against a model rebuilt from the records alone, including four ring wraps.

**Liveness.** A due boost blocks distributions until expired — but `expire_boosts` needs only records (no token account), so nobody can wedge it (this is the stated reason the instruction exists). A waiting vault blocks distributions until joined — joining is free and permissionless. A vault whose cbBTC account is missing refuses a claim batch that names it, but only its *own owner* can close that account (it is PDA-owned), so it is self-inflicted and the crank never names such a vault. Nobody can make distributions or redemptions impossible for others.

**The boost.** A boost earns exactly N: the distribution that ends it makes it due, and no distribution runs while any is due (`BoostsExpireFirst`, checked before any $GARY burns — PG.1a/BO.12 pin that nothing burns on refusal). Weight changes preserve owed exactly (`reweigh` moves it to carry; BO.7c). The ring: a boost lasts at most 63 distributions, so its end slot is always "fresh" when bought (the slot was zeroed when `dist_epoch` last passed it); two boosts ending at the same epoch share a slot by count; early retirement decrements the right branch (BO.38 measures the wrapped not-yet-due branch on chain). No record can be expired twice (`expire_boost` requires due; retired records are skipped), early (the filter skips not-yet-due), or never (the gate forces expiry before the next distribution, and the crank/claim/`expire_boosts` all do it).

## R3. The level draw

The SlotHashes parse is defensive (key pinned, count bounded, buffer length checked, all-zero hash refused — host tests cover each refusal). Skipped-slot handling takes the smallest produced slot in `[want, want+64]` (host tests, including runs of skips at each of A, B and C). FIFO is enforced by `index == revealed_total` (L.2). A burned vault at the head still takes its draw (L.11) so the queue never stops. The attribute re-supply is hash-checked (L.4). Influence: the minter cannot grind (future hashes); the crank operator can withhold captures (limit 25, stated); C's leader chooses among many draws (limit 26, stated, including the cohort-sharing and best-of-4 skipping arithmetic). **I do not find it worse than stated:** A's or B's leader skipping a group shifts the later targets, but that leader produces its block without hB/hC, so it is a blind re-roll, not an evaluable choice — which is the sense of "influence" the limits use. HOLDER-GUIDE's two draw paragraphs ("can choose among many results", "a draw nobody records in time is drawn again") are true of the code.

## R4. Governance

One vault one vote bound to the asset (VoteRecord PDA seeded by asset — 7.7/7.9). Electorate fixed at creation (`index_snapshot`, `quorum_supply` — G.6/G.8). No proposal before charter close (RT1.1). Quorum 21% / threshold 51% / 10% turnout (D.1 shows the turnout binding at the suite's 5% quorum). Key changes need YES from half of the snapshotted live supply (3c.K2), never bundled with an operator arm (3c.K1), land only after notice (3c.G1/K5), and the guardian can cancel a pending operator but not its own replacement. TightenSweep is monotone and bounded (8.14/8.14b/3c.B1-B3). Overtaken actions are logged no-ops (7.26, E.2, 3b.S1, 3c.R1).

**Minority, money reach, freeze:** a minority of *total* supply can carry an ordinary proposal at the ruled quorum (that is the ruled design); it cannot carry a key change (half of ALL live vaults). No vote reaches the split, either destination, `max_supply`, the royalty, or any vault — the action enum has nowhere to put such a thing, and P.0e/P.0f pin that the only vote-carried wiring struct has no such fields. Governance freezes only when no live vault exists (limit 45, corrected by round 24 D3: an open round can still mint one). A stolen guardian key's stop is permanent below half turnout (limit 47) — I do not find it worse: the guardian's whole surface is the three stops, and the operational note that it is also INIT_AUTHORITY (which signs nothing after initialize) is accurate.

## R5. The charter claim

Identity by address against the Merkle root (domain-separated 0x00/0x01, sorted pairs — the JS and Rust agree, proven by the program verifying proofs the JS builds, plus the pob-merkle selftest's outsider refusals). The CPI-burn as owner in the same instruction (C.3, C.7). The window is clock-only and can never reopen (C.15). Not gated by the guardian (C.13 — the stop remains set while the claim lands). `pob_extra` accounts are passed through never as signers (OR.3/OR.4). SPEC 46 is complete as far as I can tell: the hot key can gate or brick claims (per-asset plugin changes share the alarm's per-asset blind spot — stated), cannot transfer or burn a PoB (the positive bound, measured R32.A22a), and the end-the-project and capture-governance cases are stated in full. I found nothing that wallet, a PoB holder, or a third party can do that SPEC 46 omits.

## R6. Configuration and the trusted hop

Every `initialize`'s accept/refuse set was re-read. The wrong-but-accepted values that would lock in forever are exactly the ones item 38 names, and the ceremony embeds `judgeLaunch` (the same checker) and judges at both clocks — the residual gap (the checker validates JSON, not the signed transaction; the programs check less than the checker) is stated (round 24 A6) and is the reason the ceremony page exists as the only sanctioned builder.

The swap operator's worst case: cap × cooldown windows until the guardian stops it, bounded by the revenue PDA's balance above the reserve — stated, buyer-facing, and the on-chain bounds (tighten-only, inside initialize-fixed ceilings) are enforced (8.14 series).

The 10% royalty: plugin authority None; Core refuses update, removal, and re-delegation (R.3–R.6c, R33.G3), from anyone including the update authority. Nothing in our programs writes the collection's plugins after initialize.

The redemption cap: I re-derived the ring arithmetic. The k-th most recent redemption must be at least a full window old; since `dist_epoch`-style monotonic timestamps are written one per burn and the ring is read at the pre-write head, any window of `redeem_window_secs` ending at a landing redemption holds at most the cap in force. RL.7 replays every remembered redemption against its own certified cap. **It is exactly a rolling window.**

## R7. Cross-program raw reads

I recomputed every offset from the struct definitions:

- **MintConfig (v6):** version 8, collection 9, governance 41, pool_ata 73, round_id 105, minted_total 141, split_bps 189, sales_stopped 191, sweep_stopped 192, guardian 193, swap_operator 225, sol_reserve 257, max_sweep 266, cooldown 274, charter_closes 442, bare_burns_retired 454, sales_stopped_at 518, sweep_stopped_at 526, sweep_floor 631, cooldown_ceiling 639, reserve_ceiling 647, dist_epoch 655, max_boost_weight 711, max_boost_epochs 712. **All match GOV's and BURN's constants.** Total space 1,005 + 256 padding = 1,261, matching the suite's comment.
- **VaultRecord (v4):** version 8, asset 9, mint_index 41, active 125, retired 126, pending 177, boost_weight 186, boost_end_epoch 187. **Matches GOV's `read_vault_index` and the web `dueBoostRecords` slice (125..195: d[61] = boost_weight, d[62..70] = boost_end_epoch).**
- **BurnConfig (v4):** version 8, burned_total 42. **Matches.**
- **SealConfig (v2):** version 8, collection 9, reserves 41. **Matches MINT's and BURN's readers.**
- **The sweep helper's token reads:** mint 0, owner 32, amount 64, length 165. **Standard classic SPL. Correct.**
- **The proxy's `mint-waiting` memcmp value `'2'`:** base58 of the single byte 0x01 is `'2'`. **Correct.**

Every read is pinned by address, owner, discriminator, and version. I found no misread.

## R8. The suite, the simulation, and the build as evidence

- **Arms that cannot fail:** I looked for tautologies. `ID.1` (unique assertion ids) excludes `!` ids by design and its stated property ("a reason pin can only ever read its own arm") is exactly what it checks — the deliberate double pins (`R.6!`, `SR.11!`, etc.) read the base arm. `X.7` honestly states what an empty plan shows. I found no vacuous arm in the sections I could fully read.
- **Wrong-reason negatives:** the `because` pins I checked (SR.6–SR.14, the R.6 series, the 3c series) each name the exact program error the code path produces. SR.12b explicitly guards against the wrong-reason shape.
- **Claims with no arm:** the mainnet-fork swap (16 assertions) and the off-chain selftests (940/39/49/24) are referenced but not bundled; I cannot verify them and note this as a measurement limit, not a finding. The 899 floor and the R41.C8a–c arms are present.
- **Program bytes:** the sweep helper's mainnet bytes are `cmp`'d against the suite-deployed bytes. The four keyed programs differ by INIT_AUTHORITY only, proven behaviorally by the key probe in both directions — the residual gap (the mainnet binaries' money paths have never executed) is stated (round 41 C30) and is what the dress rehearsal (item 22) exists to close.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?** I attacked each one I could reach:

- **46 (hot PoB key):** not worse. The positive bound (cannot transfer/burn a PoB) is measured; the gating/bricking and capture cases are stated in full including the per-asset alarm blind spot and the sampling gap; the >8-account hook case is the stated end-the-project case.
- **47 (stolen guardian):** not worse. The guardian's surface is exactly three stops; the permanent-stop-at-low-turnout case is stated; INIT_AUTHORITY signs nothing after initialize.
- **41 (transfers not limited):** accurate; the guide's final sentence says exactly this.
- **28 (Coinbase freeze):** the full consequence set (vault account blocks the whole redemption; frozen pool reverts paying claims; the forfeit path; split halts) is stated and matches the code.
- **32 (rate limit):** the ring arithmetic is exactly as stated; the "live" definition including unretired bare burns is stated (round 24 D8).
- **25/26 (the draw):** not worse than stated (see R3).
- **55 (unsplit revenue edge):** stated with the round-24 D1 refinement (100 $GARY at the monthly boundary).

**2. Is anything listed as a limit not actually a limit?** No. I specifically re-derived limit 43 (off-curve owner cannot redeem): the pairing needs the owner as a *top-level* signer on both halves; a PDA can be a CPI signer but cannot sign top-level, and the wrapper shapes are measured refused (WR.1–WR.4). It is a real limit.

**3. Is any DISCHARGED item not actually discharged?** No. 19 (closed by construction: `activate` refuses `NotRevealed`), 14 (`DuplicateAttribute` on chain), 51 (built and measured by section BO), 54 (measured, and the page rule follows the numbers) — each is genuinely closed by the mechanism named.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 all remain open and are treated as blocking everywhere they are referenced. The three OPEN launch values (`charter_opens_at`, `lock_deadline`, `vault_collection`) are still OPEN in `launch/mainnet-init.json` and the ceremony refuses on them.

---

## Findings

### LOW-1: the web build loads esbuild from a hardcoded path in an unrelated project

- **Construct:** `web/build.mjs`, module top: `const esbuild = require('/home/ubuntu/luna-remotion/node_modules/esbuild')`.
- **What an accident gains:** nothing directly, but the holder pages and — critically — the ceremony's *local mode* (the recommended way to run road step 10, per `web/README.md` "Local mode": `node web/build.mjs --profile mainnet-local`) cannot be rebuilt if `/home/ubuntu/luna-remotion` is absent. That path is outside this repository, outside any pin, and undocumented as a dependency. A box rebuild, a project removal, or a user change silently removes the ability to build the pages at the exact moment the launch values become permanent. The failure is loud (the `require` throws), but the fallback is hand-built initialize transactions — the path the ceremony exists to replace — at the one step where a hand-built mistake is unrecoverable.
- **Evidence if I am right:** `ls /home/ubuntu/luna-remotion/node_modules/esbuild` succeeds today and nothing under `web/` or the root `package.json` (as bundled) provides another resolution path; `web/README.md`'s local-mode instructions invoke `web/build.mjs` with no mention of the dependency.
- **Fix:** resolve esbuild from this repository's own `node_modules` (add it as a devDependency), or vendor a copy under `web/build-tools/`, and add a bundle test that the build succeeds from a checkout that does not contain `luna-remotion`.

### INFO-1: the Clock sysvar is read by raw offset 32 with no layout pin

- **Construct:** `web/src/lib/reads.mjs` `chainNow` (`readBigInt64LE(32)`); `tests/3prog.test.ts` `chainNow` (same offset); both require the account to be ≥ 40 bytes.
- **Not a defect on this cluster:** the suite's time-gated arms (the `waitNotice`/`waitDue` loops behind 3c.G2, 3c.K5, IN.*) and the e2e's charter-window claims could not pass if offset 32 did not track the live unix timestamp — a constant or zero there would make every wait loop time out. Every cross-program *account* read in this tree is pinned by discriminator and version; the Clock is the one raw read with no pin. A cluster-side Clock layout change would break the pages' window judgments *visibly* (wrong refusals), not silently mispay, and would break most of Solana besides. Recorded so the next reader verifies it against a run (as I did) rather than against the struct definition alone.

---

## Measurement limits of this pass

- I did not execute anything. All verification is by reading the bundled sources against the claimed measurements, and by re-deriving arithmetic (offsets, the ring, the accumulator, the rate window) from the struct definitions.
- `bank/selftest.mjs`, `bank/crank.mjs`, `bank/detectors.mjs`, `bank/anchor.mjs`, `bank/redemption-poster.mjs`, `bank/swap.mjs`, `scripts/check-launch-params.mjs`, `sim/swap-fork.sh`, and the `web/test/*` files are referenced but not bundled; the round 41 VALIDATION's claims about them (940/940, the dust class A1–A3, the poster/oracle/sweep pins) are specific and I have no contrary evidence, but I could not verify them directly.
- The Clock offset (INFO-1) is verified by consistency with the claimed passing runs, not by executing a read myself.
- I could not independently confirm the mainnet-fork swap run or the live-mainnet probe results; both are network-dependent gates that the ship gate correctly requires to have *run* (not been skipped) in the certifying run.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot?

1. **Run the mainnet dress rehearsal, for real, with signatures.** Item 22 is OPEN and is the single largest unmeasured surface: the crank's I/O against ~2,100 live vaults, the alarm's live passes, one full revenue cycle through *both* pools with Orca forced to refuse once, and one forced post-sweep failure walked through the hand recovery to a clean `--audit`. No AI pass can execute against a live cluster with real rate limits, real paging, and a transient RPC error on vault 1,900. The rehearsal must produce transaction signatures, and a human must read them.

2. **Have a second person walk the ceremony cold, from the written instructions only.** The ceremony writes values that can never be corrected. The strongest remaining defense against a wrong-but-accepted value is a human who did not write the page reading each value aloud against DESIGN-v6 before signing. Run it once in local mode on the box, then once at the terminal for real, with Gary comparing each screen against the rulings — not against his memory of what the code does.

3. **Fix the operational state of the box before anything mints.** The round 41 drift sweep found the live crontab is still the v5 one, running a `bank/distribute.mjs` that no longer exists, with no crank or reconcile line (B7). An AI can read the crontab; only a human at the terminal can re-run `scripts/cron-install.sh`, verify `crontab -l`, and confirm the crank is armed and the alarm is live — and then watch the first 24 hours of pages.

4. **Pay one Solana security researcher to try to steal, on a mainnet fork with funded vaults.** Twenty-two rounds of AI audit and three red-team passes have converged, but they share a blind spot: every model reasons about shapes it has already seen. A motivated human with novel techniques (unusual CPI topologies, account aliasing tricks, Core plugin interactions nobody has tried) attacking a fork where success pays out, is the one test this process has never run. Budget it as insurance on the immutability decision.

5. **Put a non-technical holder in front of the rehearsal deployment and watch them claim, deposit, and redeem.** The last line of defense against holder error (sending the NFT to the deposit address, burning outside the page, misunderstanding the tick-boxes) is the pages' copy and flow. No AI can verify that a real person understands "this is NOT the NFT's own address" or the standing consent. Record where they hesitate; fix the copy before the guide is published.

6. **Verify the key custody physically.** The guardian key, the swap operator key, the $CBOB release wallet, and the deploy authority key are claimed to be in specific files with specific modes and backups. An AI can read the claims; only a human on the box (and on the backup target) can confirm the files exist, the modes are 600, the backups are real and restorable, and the release wallet's key is not also somewhere it should not be.

7. **Assess third-party upgrade risk at the launch moment, not just in steady state.** Core, Orca, Meteora, and Pyth are all upgradeable by keys that are not yours, and the alarm detects but cannot prevent. Before removing the upgrade authority, check whether any of them has an upgrade pending or announced, and consider whether the lock date should move if one lands. This is a judgment about the world, not the code.

8. **Have Gary re-read DESIGN-v6 line by line and confirm each ruling still says what he means.** The AI process can prove the code matches the rulings *as written*. It cannot prove the rulings match Gary's intent. The one class of defect that survives every audit here is a correctly-implemented misunderstanding, and the only check for it is the person who made the decisions.