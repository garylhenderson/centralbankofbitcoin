# Round 48 — Independent confirmation audit of the v6 final tree

**Scope note up front.** I independently re-derived every cross-program offset from the Rust structs, traced the pool accumulator end-to-end, and walked the redemption pairing, sweep helper, rate ring, boost ring, and charter-claim Merkle path from source. Where a round-47 repair lives in a file this pass does **not** carry (`scripts/readme-facts.mjs`, `web/src/lib/tx.mjs`), I say so rather than inferring its contents. I did not run a validator this pass; claims marked "measured" below are re-reads of the pinned suite/sim logs and source, not fresh executions.

---

## R0 — Round 47's verdict and its repairs

I treated round 47's LAUNCH-CLEAN verdict as a claim to test, not a conclusion to adopt.

**Verifiable repairs — confirmed present and correct in this tree:**

- **V47-3 (suite arm R.4 could not see seven plugin kinds).** Repaired. `tests/3prog.test.ts` now defines `registryOf()` which deserializes the collection's **raw plugin registry** (`deserializePluginRegistryV1`) and renders `PluginType[r.pluginType]` for every internal record plus `externalRegistry.length`, instead of matching a hardcoded key list. The control arm **R.4b** creates a collection carrying an AppData adapter and requires it to read as `Royalties|1`, so R.4 can now fail. One residual nuance (INFO, not a defect): a future Core plugin type absent from the SDK enum renders as `undefined` in the join, which still breaks the `Royalties` equality and therefore still fails the arm — the safe direction.
- **V47-6 (README misattributed reserve custody).** Repaired. The program table now reads SEAL as "keeps each vault sealed…", BURN as "proves its wallet empty, burns it and retires its record", and SWEEP as the helper that pays reserves out through Core. This matches the code (BURN moves nothing; `programs/cbob-vault-sweep` moves value).
- **V47-7 (road step 8 shown plainly "done").** Repaired. The road row now carries "22.2 FAIL accepted by Gary (a true detection); scale not exercised", consistent with `audits/rehearsal-2026-10-09/RECORD.md`.
- **V47-8 (SPEC item 53 stale "has not yet run").** Repaired. Item 53 now states the rehearsal "ran to its end on mainnet on 2026-10-09 to 10-10" and keeps OPEN only the in-tree re-run requirement (last `e7c192a`).
- **V47-9 (proxy header said eight shapes).** Repaired. `web/deploy/rpc-proxy.mjs` header says "five exact filtered shapes", matching `gpaShape`'s five return values (`core-owner`, `core-collection`, `core-mint-coll`, `mint-waiting`, `mint-boosts`).

**Repairs I could NOT verify from this bundle:**

- **V47-1 / V47-2 / V47o-4 / V47o-5** concern `scripts/readme-facts.mjs`, which is referenced by `README.md` and `run-tests.sh` but whose source is not in my bundle. I cannot confirm the "tracked rounds only" fix or the `REQUIRES CHANGES: NONE` rendering fix. This is a coverage gap in my pass, not a finding against the code. **Evidence that would confirm it:** the file, plus a selftest arm showing an untracked empty `audits/roundN` leaves `--check` green and a `NONE` second line renders as owing nothing.
- **V47-4 / V47-5** concern `web/src/lib/tx.mjs` (`judgeWalletEdits` / the ceremony's `minUnits`), which is also not in my bundle. I could not confirm the compute-floor or the removed-signer/writable repairs. **Evidence that would confirm it:** the file, plus arms refusing a wallet budget below the measured need and refusing a writable-to-readonly downgrade.

**Round-47 claims I re-tested and agree remain disproved:** Muse's Token-2022-reserve-ATA brick (the ATA program refuses a Token-2022 ATA for a classic-SPL mint, and SEAL `assert_classic_spl` refuses non-classic reserves anyway — `programs/cbob-vaults/src/lib.rs:273`), and MiMo's two `judgeWalletEdits` MEDIUMs (documented, fail-closed design; the named shapes cannot fit the 1,232-byte packet). I reached the same conclusions from source independently.

---

## R1 — Custody: sealed vaults, emptied vaults

**No new finding.** I attacked the pairing and the emptiness proof from source:

- `open_for_redemption` walks **forward** from its own index via `load_current_index_checked`/`load_instruction_at_checked` (top-level only) and requires a `burn_vault` matching **both** asset (account 0) and owner (account 2). `burn_vault` walks **backward** and requires a matching `open_for_redemption`. Both bind asset AND owner, so neither half can be borrowed from a second redemption sharing the transaction. A CPI-wrapped open or burn is invisible to the sysvar walk and therefore cannot satisfy the pairing; `retire_redeemed` additionally pins `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1`. This is the shape the WR.* arms exercise.
- Only the current asset owner can open (SEAL checks `asset_owner == owner` from the live AssetV1 bytes) and only the owner can burn. A transfer delegate can move the NFT but cannot open it. The PermanentFreezeExecute authority (SEAL PDA) controls freeze state only, not Execute authorization.
- An emptied vault cannot survive: the thaw is granted only in a transaction that also contains the terminal burn, and the burn is all-or-nothing on the emptiness proof. Any residual the proof can see reverts the burn and with it the thaw.

The one structural gap — the chain cannot enumerate what a PDA owns, so undeclared non-reserve holdings are destroyed — is proven impossibility 2 and accepted limits 9/44; I confirmed it is not wider than stated (see accepted-limits section).

## R1s — Sweep helper

I re-read `programs/cbob-vault-sweep/src/lib.rs` in full. **No new finding.** Specific sub-questions:

- **(a) Authorization.** The helper requires `signer.is_signer`. The only way the asset-signer PDA signs is Core `ExecuteV1`, which Core grants to the asset owner (SPEC 40; SR.5 arms). Called directly with a plain keypair, it sweeps only that keypair's own holdings — not a vault's. Confirmed safe.
- **(b) Pair list.** Source must be owned by the signer; destination must be owned by the destination wallet and match the source mint. Duplicate source: the first iteration closes it, the second fails `IllegalOwner` (SR.12a). Source-as-destination is impossible (one owner each). The token and system program accounts are pinned by address, so they cannot be spoofed or used as sources.
- **(c) Destination not compared to owner.** Safe *because* of (a): the destination is chosen by whoever can make the asset-signer sign, i.e. the owner. A lamport transfer to a sub-rent or non-system destination fails the whole transaction, which only harms the owner's own redemption and is handled by the page (measured R41.C8).
- **(d) Lamport sweep.** Reads `signer.lamports()` at execution, after token closes (whose rent goes to the destination wallet, not the signer), and transfers the full balance to zero. Within the atomic redemption nothing runs between the ExecuteV1 and the burn, so BURN's `lamports == 0` sees exactly what the sweep left.
- **(e) Interaction with BURN.** The sweep closes what it empties; a closed reserve ATA is system-owned at burn time, so BURN's reserve loop `continue`s it (treated as absent/empty) while still requiring it to be *declared*. A reserve ATA that did not exist at plan time is created by the page's prior transaction (item 42); a stranger cannot create a Token-2022 ATA for a classic mint (IncorrectProgramId), and a non-ATA token account or nested asset falls to the accepted undeclared-holding limit, not to a bypass.
- **(f)/(g)** The SR.* and S8.* arms cover the helper's refusal branches and the three-asset redemption size/CU; I found no arm that cannot fail for the reason named.

## R2 / R2b — Pool accounting and the $CBOB boost

**No new finding.** I re-derived the invariant "pool balance ≥ ceil(owed_scaled / ACC_SCALE)":

- `credit`: `delta = floor(avail·ACC_SCALE / w)`, `owed_scaled += delta·w ≤ avail·ACC_SCALE`. Since `avail = balance − ceil(owed/ACC_SCALE)`, the new `owed_scaled ≤ balance·ACC_SCALE`. Invariant holds.
- `claim`: pays `floor(pending/ACC_SCALE)` whole sats, reduces `owed_scaled` by `pay·ACC_SCALE`, carries the sub-sat remainder in `carry_scaled`. Pool balance drops by exactly `pay`; the ceiling of owed drops by at most `pay`. Invariant maintained or improved.
- `retire` (redeemed, non-forfeit) requires `pending < ACC_SCALE` (ClaimBeforeBurn) and subtracts the full pending from `owed_scaled` without moving tokens — invariant improves. Forfeit (frozen pool) subtracts pending with no token movement — invariant improves; the forfeited sats remain as undistributed pool balance.
- `pending_count` / `pending_this_epoch`: I walked activate→join, activate→retire same-epoch, and activate→epoch-advance→retire. `advance_epoch` zeroes `pending_this_epoch`; `join` decrements only `pending_count` (correct, since join only happens for earlier-epoch requests); `retire` decrements `pending_this_epoch` only when `request_epoch == dist_epoch`. No underflow path found; `waiting_to_join` uses checked subtraction.
- `JoinWaitingFirst` and `BoostsExpireFirst` gates are checked before any $GARY burn, so a failed distribute burns nothing.

**Boost ring:** with `max_boost_epochs ≤ 63 = BOOST_RING − 1`, a live boost's end epoch can only collide mod 64 with an epoch already advanced past, and `advance_epoch` zeroes a slot exactly when `dist_epoch` reaches it. `unschedule_boost` correctly distinguishes due (`boosts_due -= 1`) from not-yet-due (`boost_expiring[slot] -= 1`), and `expire_boost`/`retire` only call it while `boost_weight > 0`, so no double-decrement. `reweigh` moves the accrued owed into `carry_scaled` and resets `debt_scaled = new_weight·acc`, so a weight change neither creates nor destroys owed value. This matches the host-test model and the N1 on-chain walk.

## R3 — Level draw

**No new finding.** `blockhash_in_window` validates the sysvar id, bounds the count at 512, checks buffer length, picks the smallest produced slot in `[want, want+64]`, and rejects an all-zero hash. `try_capture` composes A/B/C with a two-group stride and hashes `hA‖hB‖hC‖asset`. A missed window is rescheduled to a future slot, never defaulted; a burned vault still draws so the FIFO cannot stall. The last-contributor grinding residual is accepted limit 26 and I found it no worse than stated (see below).

## R4 — Governance

**No new finding.** Key-change actions (`Brakes{set_guardian:true}` or `ArmSwapOperator`) require `yes ≥ ceil(quorum_supply·5000/10000)` where `quorum_supply` is the live supply snapshotted at creation; `KeyChangesBundled` prevents combining them. The per-kind ordering marks (`last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`) prevent replaying superseded actions, and overtaken actions are logged skips, not reverts. GOV's restart-skip uses `stopped_at >= created_at` while MINT's `restart` requires `stopped_at < created_at` — complementary, no gap. The electorate is frozen at creation (`index_snapshot`, `quorum_supply`); burned vaults cannot vote because their 1-byte tombstone fails `read_core_asset`. I found no minority path that carries a key change below half of snapshotted live supply.

## R5 — Charter claim

**No new finding.** The Merkle scheme is domain-separated (leaf `0x00`, node `0x01`, sorted pairs), preventing second-preimage and reorder attacks. The PoB is identified by address against `pob_root`, ownership-checked, and burned by CPI in the same instruction; a burned PoB (1-byte tombstone) fails the `len ≥ 66` check on re-claim. `pob_extra` pass-through accounts are never marked signers. The hot-update-authority exposure is accepted limit 46 and I found it accurately scoped.

## R6 — One-time configuration and trusted hop

**No new finding from source.** `initialize` in all four keyed programs is gated by the compile-time `INIT_AUTHORITY`, runs once (config is an `init` PDA), and validates bounds (sweep cap/cooldown/reserve ceilings, boost ceilings, charter window, non-default treasury, payment-mint-is-a-reserve). The royalty is installed with `PluginAuthority::None`, which Core treats as immutable. The redemption window ring initializes all 64 slots to 0 (ancient), so the first `cap` redemptions pass correctly and the k-th-most-recent check is sound. The swap operator remains the one trusted hop, bounded on-chain by cap/cooldown/reserve and stoppable by the guardian — accepted limit 10.

## R7 — Cross-program raw reads

**I recomputed every offset from the structs and found them all correct.** MintConfig body is 1,005 bytes (+8 discriminator, +256 padding = 1,261). Spot checks: `governance`@41, `pool_ata`@73, `minted_total`@141, `sales_stopped`@191, `sweep_stopped`@192, `guardian`@193, `sol_reserve`@257, `max_sweep`@266, `cooldown`@274, `charter_closes_at`@442, `bare_burns_retired`@454, `sales_stopped_at`@518, `sweep_stopped_at`@526, `sweep_floor`@631, `cooldown_ceiling`@639, `reserve_ceiling`@647, `max_boost_weight`@711, `max_boost_epochs`@712. These match GOV's and BURN's pinned constants exactly. SEAL config (`version`@8, `collection`@9, `reserve_mints`@41) and BurnConfig (`burned_total`@42) also check out. All reads pin discriminator **and** version byte, so a layout drift fails loudly rather than misreading. This independently confirms round 47's offset recomputation and contradicts the LongCat seat's wrong table.

## R8 — Suite, simulation, and build as evidence

I did not re-run the suite this pass. From the pinned logs: `d2ae5fc` suite RC 0 (912/912 on-chain, 35/35 probe, 16/16 fork), `bba189a` RC 0 (913/913, 1081 detectors, 805 web, 152 e2e, 71 sim). The program source is byte-identical to the release (`git diff --quiet 63a92b2 487a8b4 -- programs`). The `because()` reason-pins in the suite are specific error codes, and the round-47 R.4 repair removed the one arm I identified as unable to fail for the right reason. I found no arm whose negative fires for a different reason than named among those I inspected. **Caveat:** because `readme-facts.mjs` and `tx.mjs` are absent from my bundle, I could not confirm the two runner-level round-47 repairs (V47-1/V47-2) that gate the certifying run itself.

---

## The four accepted-limit questions

1. **Is any limit worse than stated?** I found none worse. Limit 26 (C-leader grinding), 28 (Coinbase freeze, including the frozen-pool forfeit and frozen-vault-account deferral paths I traced), 32 (rate ring; with max supply 2,100 the cap is ≤ 45 < 64 so the ring never binds early), 40 (Core upgradeability), 44 (undeclared holdings), and 47 (stolen guardian permanent at low turnout) all match the code. I specifically checked that the frozen-pool redeem path forfeits rather than locks (it does) and that a frozen *vault* account defers claim but keeps the vault owed (it does).
2. **Is anything listed as a limit actually closed?** No. Limit 44 is *narrower* than a naive reading (the sweep helper can deliver named classic strays) but truly undeclared/Token-2022/frozen/close-authority-held items are still destroyed, so it remains a real limit. Limit 9 (no continuous foreign-nested-asset detection) still holds.
3. **Is any DISCHARGED item not actually discharged?** I spot-checked 14 (DuplicateAttribute present), 19 (activate requires drawn level), 30 (split_bps fixed at init), 51 (boost code present), 54/12/17 (compute measured). All genuinely discharged.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain explicitly OPEN. Item 22.2's FAIL was resolved by an explicit recorded Gary ruling (2026-10-10), not quietly — and item 22 correctly stays open for the ~2,100-vault scale. This is documented in RECORD.md and SPEC, not hidden.

---

## Anything else

**Coverage gap in my own pass (INFO).** Two files central to round-47 findings V47-1/V47-2/V47-4/V47-5 (`scripts/readme-facts.mjs`, `web/src/lib/tx.mjs`) are not in this bundle and are not on the 10-file exclusion list. I could not verify those four repairs. This is a bundling omission to correct in the next pass, not a code defect.

**No new CRITICAL, HIGH, or MEDIUM findings in the five programs.** After independently recomputing offsets, re-deriving the pool invariant, and walking the redemption/boost/rate/Merkle paths, I found the programs consistent with their claims. I state this as the result of adversarial review, not deference: I entered assuming the author wrong and could not construct a value-moving, unsealing, crack-blocking, or mis-crediting path that survives the code's checks.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

AI audit structurally cannot do the following; the project should do them before launch:

1. **Execute what was only reasoned.** I re-read source and pinned logs but did not boot a validator this pass. Before lock, run the full certifying suite, the Test Vault simulation, the swap fork, and the e2e **at the exact release commit** on fresh hardware, and require every floor to *equal* its count. A reasoning pass can miss what an execution pass catches.
2. **Close the two unverified round-47 repairs.** Bundle and re-verify `scripts/readme-facts.mjs` and `web/src/lib/tx.mjs` (V47-1/2/4/5). The certifying runner's own gate (V47-1) is load-bearing: if it cannot run on the audited commit during an audit, the launch-clean confirmation is unprovable.
3. **Perform the real-Phantom matrix that item 50 defers.** No AI pass signs with a real wallet. Before publishing the pages, drive the widest openings (claim-first-with-strays, the W5 shape) and a page-budgeted opening through actual Phantom on mainnet, and confirm the wallet-edit judge's behavior against real wallet wrapping.
4. **Complete item 22's scale and item 53's in-tree run.** The rehearsal proved five vaults; the crank, alarm, and revenue job have not been exercised at ~2,100 vaults. Run the full suite inside a rehearsal tree at the final commit and record it.
5. **Resolve the remaining OPEN launch values** (`charter_opens_at`, `lock_deadline`, `vault_collection`) and re-run `check-launch-params` before any `initialize` is signed. An immutable program with a wrong `initialize` value is unrecoverable; no amount of auditing substitutes for a correct one-time write.
6. **Treat the third-party upgrade keys (Core, Orca, Meteora, Pyth, cbBTC freeze) as permanent live risk.** The alarm detects but cannot prevent. The project should confirm the Core-watch and third-party-program detectors are installed and paging before lock, since these are the one class of change no audit of this code can stop.

The programs, as written, are ready in the sense that I found no surviving bug in them. Immutability means the remaining risk is concentrated in the one-time values, the third-party dependencies, and the off-chain pipeline — none of which this program audit can certify.