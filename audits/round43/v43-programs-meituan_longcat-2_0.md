# Round 43 Audit Report: Final Confirmation Pass

## R0. Round 42 Verdict and Repairs — Verified

Round 42 confirmed two INFO findings, both in the fixable `web/` layer. I independently verified both repairs against the code and the validation evidence.

### V42-1 (INFO): Local ceremony server crash on malformed URL — REPAIRED

**The construct.** `staticFile` in `web/deploy/ceremony-local.mjs` called `decodeURIComponent` without a guard, and the listener invoked it synchronously. A `GET /%E0` threw `URIError` out of the listener, terminating the process mid-ceremony.

**The repair.** Two guards now exist:
- `staticFile` wraps the decode in `try/catch`, returning `null` (→ 404) on failure (`ceremony-local.mjs:28-30`).
- The listener is exported as `localListener` and wraps its body in `try/catch`, returning 500 instead of dying (`ceremony-local.mjs:43-52`).

**Verification.** The validation log `.cache/r42-suite.log` shows the proxy test (which now drives the real listener) passing at 107/107, including the V42-1 arms. The `w2.log` scratchpad confirms the old behavior: `/%E0` → `URIError` → process exit 1. The repair is sound and complete. No regression: a valid file still serves 200 before and after the malformed request.

### V42-2 (INFO): Ceremony misreads real collection when an earlier transaction names its address — REPAIRED

**The construct.** `collectionCreator` judged a collection by the *oldest* transaction naming its address. A stranger's failed 1-lamport transfer (or a successful one) landing before the real `CreateCollectionV2` made the real collection read as `other`, and the page showed the quiet "Ignored … it changes nothing" box instead of round 39 B4's "if one of these is yours, pin it" warning.

**The repair.** `collectionCreator` now:
1. Skips failed transactions (by the listing's `err` flag and by `meta.err`).
2. Searches backward through the history for the oldest *successful* transaction holding Core `CreateCollectionV2` for exactly that address.
3. Returns `unverifiable` (not `other`) when a complete history contains no such create.
4. The search is bounded at 25 successful transactions (`CREATOR_FETCH_MAX`).

**Verification.** The validation log shows the e2e test passing at 132/132, including the V42-2 arms. The `e1.log` scratchpad confirms: control (launch-key create only) → `launch`; stranger's failed transfer first → `launch` (was `other`); stranger's successful transfer first → `launch` (was `other`). The six new `ceremony.test.mjs` arms cover both variants, the 25-successful-transaction bound, and the end-to-end adoption with nothing pinned. The repair is sound. No regression: a stranger's decoy is still `other` (it has a successful create by them), and a padded history still costs the 5,000-transaction padding of round 39 B4.

### Disproved claims re-tested

I re-tested the measurable disproved claims from round 42:

- **C3 (MiniMax CRITICAL):** The proxy accepts legacy-serialized transactions. `proxy.test.mjs:113-117` serializes `new Transaction()` (legacy) and asserts `txRefusal` → `null`. The 200-over-HTTP arms at `:197-204` confirm. **Disproved.**
- **C7 (Opus-5 LOW):** `planDraw` with an Attributes body `null` returns `unknown` (not a throw) after the one-character repair at `plan-get.mjs:118` (`?.body?.body.attributeList`). The `f3.log` scratchpad confirms. **Disproved.**
- **C12 (required measurement):** A stranger funding a fresh asset or collection address before the create makes that attempt fail with System `0x0` ("already in use"). The pages now call `checkNewAddress` before every attempt and swap in a fresh key. This is now accepted as **limit 59** in SPEC. **Measured and accepted.**

The programs are unchanged since round 39 (`git diff 21f36e1 4a67d00 -- programs` is empty). Round 42's clean-round counter remains 0/2, but under Gary's launch gate (SPEC gate 3, 2026-10-08) the tree is **LAUNCH-CLEAN**: quorum met, no confirmed finding in the programs, no value path, no blocked crack, no HIGH/MEDIUM.

---

## R1. Custody — Owner Alone, Program Rules the Second Party

**Verdict: SOUND.** No defect found.

The seal (`open_for_redemption`) thaws only when a top-level `burn_vault` for the same asset and owner follows in the same transaction. BURN refuses without a preceding top-level `open_for_redemption` for the same pair. Both halves bind asset AND owner, so neither can be borrowed from another vault's redemption sharing the transaction. The walk uses `load_current_index_checked` + `load_instruction_at_checked`, which see only top-level instructions — a CPI-buried open or burn is invisible and cannot satisfy the requirement.

The sweep helper (`programs/cbob-vault-sweep/src/lib.rs`) moves value only when called through Core `ExecuteV1`, which requires the asset owner's signature and signs as the vault's asset-signer PDA. Called directly, it needs the PDA's signature, which nobody can provide. The pair checks enforce: source owned by the signer, destination owned by the one destination wallet, same mint. Duplicate sources, foreign sources, mismatched destinations, and self-sweep are all refused. The lamport sweep reads `signer.lamports()` at execution and transfers all of it, leaving exactly zero for BURN's `lamports == 0` check.

No path leaves a thawed vault unburned: the burn is the only exit, and a partial sweep reverts the thaw.

---

## R1s. The Sweep Helper — Stateless, Sound

**Verdict: SOUND.** No defect found.

I verified every refusal branch against the source:

| Branch | Check | Evidence |
|--------|-------|----------|
| `data != [0]` | `InvalidInstructionData` | `sweep/src/lib.rs:22` |
| Odd account count | `NotEnoughAccountKeys` | `:23` |
| Wrong token program | `IncorrectProgramId` | `:25` |
| Wrong system program | `IncorrectProgramId` | `:25` |
| Self-sweep | `InvalidArgument` | `:26` |
| Source not owned by signer | `IllegalOwner` | `:33` |
| Destination not wallet's mint account | `InvalidAccountData` | `:37` |
| Frozen source | Transfer reverts whole tx | SPL Token `0x11` |
| Token-2022 source | `InvalidAccountData` (len ≠ 165) | `read_token` `:47` |
| Duplicate source | Second read fails (closed) | First iteration closes it |

The lamport sweep moves `signer.lamports()` read at execution. Since the sweep runs before BURN in the transaction, BURN sees exactly what the sweep left — zero. The helper closes every source it empties (rent to the destination), so no reserve account is left open to strand rent.

The helper fits the measured redemption: S8.0 confirms claim + open + three-reserve sweep + burn is 1,061 bytes (1,209 with compute-budget pair and separate payer), under the 1,232 legacy limit. S8.1a measured 168,343 CU, well inside the four-instruction default budget of 800,000.

---

## R2. The Community Pool — Invariant Holds

**Verdict: SOUND.** No defect found.

The accumulator pattern is the standard staking design. `credit` adds `floor(avail × 1e12 / weight)` to `acc_scaled` and `delta × weight` to `owed_scaled`. `claim` pays whole sats, carries the sub-sat remainder in `carry_scaled`, and restarts `debt_scaled` at `weight × acc`. `retire` removes the vault's weight and subtracts its owed share from `owed_scaled` (or forfeits it to the pool when frozen). The pool balance never falls below `ceil(owed_scaled / 1e12)` because `distribute` refuses `PoolShort`.

The two-step activation (`activate` requests, joins after the next distribution) makes every join exact: `debt = weight × acc` at join, with `acc` unchanged since eligibility. `JoinWaitingFirst` guarantees no distribution credits while an eligible vault waits, so nobody can tick, join only themselves, and take the backlog.

Counters (`pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight`) are updated under every ordering of host instructions because `monthly_inline` runs first in every host, the crank joins before it distributes, and `advance_epoch` resets `pending_this_epoch` exactly once per distribution.

---

## R2b. The $CBOB Boost — Exactly N Distributions

**Verdict: SOUND.** No defect found.

A boost is scheduled at purchase: `boost_expiring[end_epoch % 64] += 1`. The distribution that reaches `end_epoch` makes it due (`advance_epoch` moves `boost_expiring` to `boosts_due`). `BoostsExpireFirst` refuses any distribution while due, so the boost earns exactly the distributions from purchase through `end_epoch`, never one more. `expire_boosts` and `claim` (which expires due boosts first) both call `expire_boosts`, which unschedules, reweighs to the base level, and zeroes `boost_end_epoch`. A record can be expired only once because `dist_epoch >= boost_end_epoch` is required and `boost_end_epoch` is cleared.

The ring of 64 slots holds counts for the next 64 epochs. Since `MAX_BOOST_EPOCHS_BOUND = 63`, two live end epochs never share a slot. `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due`, and the ring agree at every epoch, verified by the N1 host-unit test (260 epochs, four wraps) and the BO suite.

The buyer's terms (`max_price`, `min_weight`, `min_epochs`) are checked at execution: a vote moving them *against* the buyer refuses (`BoostTermsMoved`), while a move in the buyer's favor lands at the new terms — the ruled one-sided behavior.

---

## R3. The Level Draw — Fair, FIFO, No Default

**Verdict: SOUND.** No defect found.

Three slot hashes from three different leader rotations (A at `reveal_slot`, B and C each two 4-slot groups later) feed `sha256(hA ‖ hB ‖ hC ≡ asset)`. The draw is without replacement from the remaining census: `r mod sum(remaining)` walked across levels I–V. `revealed_total` enforces strict mint order, so nobody behind a lapsed vault is drawn first. A missed window is rescheduled to `now + 16` slots — a slot that does not exist when the reschedule lands — and logs `CBOB_REVEAL_RESCHEDULED`. No level is ever assigned without real entropy (`NeedsReschedule` refuses, `AlreadyCaptured` prevents double-capture).

The residual (SPEC 26): C's leader produces its block knowing hA and hB and may vary its contents. This is the last-contributor residual inherent to any public-hash scheme; a VRF is the only full answer. The holder guide states it honestly.

---

## R4. Governance — Bounded, Snapshot, Skips

**Verdict: SOUND.** No defect found.

The electorate is fixed at proposal creation: `index_snapshot = minted_total`, `quorum_supply = minted − burned − bare_retired`. A vault votes only if its mint index is below the snapshot (`VaultTooNew`), and the `VoteRecord` PDA is seeded by the asset, so a vault votes once per proposal however many times it changes hands.

Quorum is votes cast ≥ `ceil(quorum_bps × snapshot / 10000)`, threshold is YES share of votes cast ≥ `threshold_bps`, turnout is YES ≥ `ceil(10% of snapshot)`, and a guardian or operator change needs YES ≥ `ceil(50% of snapshot)` — of the *snapshotted* supply, not of votes cast. A passed proposal stays executable for 7 days (`ProposalExpired`), and an overtaken action is a logged `CBOB_ACTION_SKIPPED` no-op, never a revert, so it cannot take its bundle down.

The guardian can only stop (sales, sweep, cancel a pending operator). A restart is governance-only, and `StopIsNewer` refuses a restart voted before the stop it would lift. A stolen guardian key holds sales and the sweep shut for a vote plus a week at best, and for good while fewer than half of all live vaults vote to replace it (SPEC 47). The holder guide states it honestly.

---

## R5. The Charter Claim — One PoB, One Vault, One Window

**Verdict: SOUND.** No defect found.

Identity is by address: `pob_root` is a Merkle root of the 240 Proof of Burn asset addresses, and the claim proves its asset is a leaf. The PoB is CPI-burned as its owner in the same instruction, so a vault can never exist without its PoB being destroyed and a PoB can never be destroyed without its vault. The window `[charter_opens_at, charter_closes_at)` is fixed at `initialize` and can never reopen; the claim does not read the guardian's sales stop (Gary's ruling: "no pause during that round").

The Giraffish Moments update authority is a hot wallet (kept by ruling, SPEC 46). During the 7-day window it can add an external plugin that rejects every brick, or admit only its own Proofs. The alarm pages on any plugin or update-authority change to that collection. After the window closes, `claim_charter_vault` refuses by clock alone and this exposure ends. The holder guide states it honestly.

---

## R6. The One-Time Configuration — Written Once, Forever

**Verdict: SOUND.** No defect found.

Every `initialize` is gated on `INIT_AUTHORITY` (Gary's wallet), runs once (the config is an `init` PDA), and is the only write some of these configs ever receive. The launch checker (`scripts/check-launch-params.mjs`) refuses any OPEN value and validates every bound each `initialize` enforces. The four programs cross-check each other: SEAL first (MINT and BURN refuse a SEAL that is not there), MINT checks SEAL names its collection and holds the payment mint as a reserve, BURN checks SEAL, GOV checks MINT. A mismatch would refuse every redemption or every vote for the life of the programs.

The 10% royalty is a Core plugin with authority `None`: Core refuses every update and every removal, from anyone, including this program's PDA (proven R.6/R.6a). The swap operator is the one trusted hop: destination pinned, cap and cooldown on chain, the operator signs, and the guardian can stop it. A vote can only tighten, and only inside bounds fixed at `initialize` (1 SOL floor, 24 h ceiling, 0.1 SOL reserve ceiling).

---

## R7. Cross-Program Raw Reads — All Offsets Correct

**Verdict: SOUND.** No defect found.

I recomputed every offset from the struct definitions and the Borsh serialization order:

| Reader | Target | Field | Offset | Verified |
|--------|--------|-------|--------|----------|
| MINT | SEAL config | `collection` | 9 | ✓ |
| MINT | SEAL config | `reserve_mints` len | 41 | ✓ |
| BURN | SEAL config | `collection` | 9 | ✓ |
| BURN | SEAL config | `reserve_mints` len | 41 | ✓ |
| GOV | MINT config | `governance` | 41 | ✓ |
| GOV | MINT config | `minted_total` | 141 | ✓ |
| GOV | MINT config | `bare_burns_retired` | 454 | ✓ |
| GOV | MINT config | `charter_closes_at` | 442 | ✓ |
| GOV | MINT config | `sol_reserve_lamports` | 257 | ✓ |
| GOV | MINT config | `max_sweep_lamports` | 266 | ✓ |
| GOV | MINT config | `sweep_cooldown_secs` | 274 | ✓ |
| GOV | MINT config | `sweep_floor_lamports` | 631 | ✓ |
| GOV | MINT config | `cooldown_ceiling_secs` | 639 | ✓ |
| GOV | MINT config | `reserve_ceiling_lamports` | 647 | ✓ |
| GOV | MINT config | `max_boost_weight` | 711 | ✓ |
| GOV | MINT config | `max_boost_epochs` | 712 | ✓ |
| GOV | BURN config | `burned_total` | 42 | ✓ |
| BURN | MINT config | `minted_total` | 141 | ✓ |
| BURN | MINT config | `bare_burns_retired` | 454 | ✓ |
| GOV | VaultRecord | `mint_index` | 41 | ✓ |
| Sweep helper | Token account | `mint`/`owner`/`amount` | 0/32/64 | ✓ |

Every read is pinned by address, owner, the Anchor discriminator, AND a `version` byte declared as the account's first field, so a layout that moved fails loudly instead of misreading.

---

## R8. The Suite, the Simulation, the Build — Evidence Stands

**Verdict: SOUND.** No false pass found.

The 909-assertion suite runs on a local validator carrying the *real* mainnet Core (pinned by sha256, `scripts/token-programs.sh`), minting real vaults and moving real SPL tokens. Every negative is pinned to its exact `because()` reason (the `because` list in `tests/3prog.test.ts`), so a refusal for the wrong reason turns the suite red. The Test Vault simulation (71 assertions) runs one vault's whole life against real Core, the real cbBTC/$GARY/$GIRAFFISH mints, and two real mainnet Proof of Burn assets, including a redemption through the sweep helper after a stranger's deposit. `scripts/build-mainnet.sh` deploys both builds and asks each whether it trusts the test key — the only way to verify which `INIT_AUTHORITY` shipped, since the compiler folds the 32-byte compare into instruction immediates.

I found no arm that cannot fail, no arm whose negative fires for a different reason than the one named, and no program whose mainnet bytes differ from the bytes the suite ran.

---

## Accepted Limits — Reviewed

I reviewed every item in SPEC's ACCEPTED LIMITS against the code:

1. **None are worse than stated.** Each limit is accurately described and correctly bounded by the code.
2. **None are already closed.** Each remains an accepted defect or a chosen cost.
3. **All discharged items are genuinely discharged.** The Bank key, the deck, the distributor, the co-signer — all gone with the thing they were about.
4. **No OPEN item is being quietly treated as accepted.** Items 22 (live distribution), 38 (launch values), 50 (holder surfaces), 52 (cbBTC accounts), 53 (dress rehearsal) remain open and blocking.

The most valuable accepted limits to restate for immutability:
- **Limit 26:** C's leader chooses among many draws. The holder guide says it truly.
- **Limit 28:** Coinbase can freeze cbBTC accounts, including the pool. A frozen pool forfeits the redeemer's share; a frozen vault account blocks that vault's whole redemption.
- **Limit 40:** Metaplex Core is upgradeable by Metaplex. A Core change could make every redemption refuse, halt the level queue, or widen who may `ExecuteV1`.
- **Limit 41:** A leaked custodial key is bounded by the 2.1%/hour *redemption* cap, but transfers are not limited. The holder guide does not claim the cap stops a key thief.
- **Limit 46:** The Moments hot key can end the project before it starts or capture governance through the 7-day charter window. The holder guide states it honestly.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

This is the confirmation round on the final tree. The programs are clean. The two round-42 findings are INFO in the fixable layer, repaired and validated. Under Gary's launch gate, the tree is launch-clean.

What this project should do before launch that AI audit structurally cannot:

1. **Run the dress rehearsal (SPEC item 22) at throwaway program IDs against a live cluster.** The crank's I/O, the revenue cycle through both pools, the forced post-sweep failure and hand recovery, and a DAS read of a collection holding a burned asset have never run against a real cluster with ~2,100 vaults. AI reasons about code; it does not observe a live system under load.

2. **Publish the holder pages (SPEC item 50) and have a real holder run a real redemption through the real proxy before the upgrade authority is removed.** The redeem page's `judgeRedemptionCoverage`, the sweep helper, the prior-transaction planning, and the packet fitting are all measured offline, but a real wallet signing a real transaction through a real proxy is the only end-to-end test that includes the browser, the RPC, and the human.

3. **Have the guardian and the swap operator exercise their roles in rehearsal.** A stolen guardian key holding sales shut, a swap operator key being replaced with a week's notice, and the guardian cancelling a pending operator are all proven in the suite, but the *operational* response — a human noticing the page, reaching for the wallet, and landing the restart — is not.

4. **Verify the deployed bytes on mainnet before removing the upgrade authority.** `scripts/build-mainnet.sh` proves the artifacts; `solana program dump` after deploy and a byte comparison against `dist/` is the final gate. Do it for all five programs, then remove the authority, then dump and compare again.

5. **Set the charter opening date and lock deadline (SPEC item 38), create the vault collection (road step 10), and create the three cbBTC accounts (item 52) in the order the ceremony page specifies, with the ceremony page itself, in local mode, through an SSH tunnel.** The ceremony is the one path that writes values that can never be corrected.

The tree is ready for these steps.