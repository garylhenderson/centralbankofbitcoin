# Round 43 — Independent confirmation audit (final tree, HEAD `4a67d00`)

**Scope note, stated up front so no claim is over-credited.** I cannot execute the validator, the suite, or the simulation from inside this review. Everything below marked **[read]** is my own line-by-line re-derivation from the bundled source. Everything marked **[suite]** rests on the described 909-assertion run / 71-assertion simulation / fork runs, and I say so rather than pretending I re-ran them. Where a claim needs execution to settle, I say it is unsettled and name the arm that would settle it. I did **not** re-file any round-42 item merely because the verdict contains it; where I touch one, I re-derived it.

**Headline.** I found **no CRITICAL, no HIGH, and no MEDIUM** in the five programs. I independently re-derived the cross-program offset maps, the pool accumulator invariant, the boost ring, the rolling rate window, the open↔burn pairing, the emptiness proof, and the sweep helper, and they hold. The two round-42 INFO findings are real, correctly scoped to `web/` tooling (not the programs), and their repairs are the right shape. I report a small number of LOW/INFO observations below, each with the evidence standard requested.

---

## R0 — Round 42's verdict and repairs

**Verdict disposition: I corroborate both round-42 verdicts' classifications, and I re-derived the two confirmed findings.**

- **V42-1 (INFO, `web/deploy/ceremony-local.mjs`).** Re-derived **[read]**: `staticFile` calls `decodeURIComponent` with no guard (`ceremony-local.mjs:30`), and the request listener invokes it synchronously with no `try` around the handler body (`:43-50`). A `URIError` thrown inside an `http` `'request'` listener is uncaught and terminates the process. This is real. It is correctly INFO: it is local-only ceremony tooling, it is cleared by a restart, and no signing or value is involved. The repair (guard the decode → 404; wrap the listener → 500; export the listener for a test) is correct. **Evidence if I were wrong:** a test driving the real listener with `/%E0` returning 200 or crashing would contradict me; the described R42 arms assert 404-then-200, which matches my reading.
- **V42-2 (INFO, `web/src/lib/ceremony-reads.mjs`).** Re-derived **[read]**: `collectionCreator` judges a candidate collection by the **oldest** transaction naming it (`ceremony-reads.mjs:85-101`), returning `other` if that transaction failed (`:97`) or is not a `CreateCollectionV2` of this address (`:98`). The premise at `:72-74` ("a fresh keypair's address is unknown to anyone before then") is false against a party that sees the create in flight (slot leader / RPC upstream) or after an unlanded timeout — exactly the party limit 59 already concedes exists. So a stranger's earlier *failed* 1-lamport transfer, or an earlier successful non-create, makes the **real** collection classify as `other`, `resolveCollection` returns `collection: null, unverified: 0`, and the page shows the quiet "ignored, changes nothing" box (`ceremony.mjs:57`) instead of round-39 B4's "pin it, do NOT create another" warning, then offers step 0 again. Real, and correctly INFO (needs a front-run **and** all pins lost before SEAL init; the page makes Gary tick "recorded" first). The repair (take the oldest **successful** transaction holding `CreateCollectionV2` for exactly this address; return `unverifiable`, not `other`, when none is found in a complete history) is correct.

**Repairs I verified hold at all sites of their shape:**
- The round-41 V41-1 "dust reads as absent" rule: I re-traced it across `reads.mjs` (`absentIfDust` applied to config PDAs, token accounts, the pool, the collection-to-be) and `decode.mjs:21-27`. The three reads that are correctly **left unwrapped** are `readVault`'s asset read (a vault asset is not an address a stranger pre-empts), `readStep('fund')`, and the metadata generator's MINT-config read. I agree those three are right to leave. **[read]**
- `run-tests.sh` now refuses to run when program source ≠ `RELEASE_COMMIT` (round-42 C10). **[read of the script]**

**Disproved/already-stated items I re-checked and agree round 42 handled correctly:** C3 (proxy legacy deserialize — `proxy.test.mjs:113-117,197-204` settles it), C4 (`staticAccountKeys`), C6/F2 (Core-heap FIFO halt — already limit 40), C8/F4 (limit 14 discharge — both entry points call the same `check_attributes`, `mint/src/lib.rs:1099,1195,2242`), C15 (10.6a/10.6b are falsifiable), C16 (guide "still sealed" vs "live" is not a misstatement). I concur with all of these dispositions. **[read]**

---

## R1 — Custody: sealed/emptied vault

I attacked the pairing, the emptiness proof, and the "thawed vault leaves unburned" path. **No defect found.** Details of what I verified **[read]**:

- **Pairing direction & indices.** SEAL walks forward from `current+1` for a BURN `burn_vault`; BURN walks `0..current` for a SEAL `open`. Both bind **asset at index 0 and owner at index 2**, and I confirmed those positions against both `BurnVault` and `OpenForRedemption` account structs. Discriminators are checked (first 8 bytes), so a same-program different-instruction cannot substitute. Both walks read **top-level only** (instructions sysvar), and `retire_redeemed` additionally pins `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT+1` plus the top-level discriminator+asset, which closes the CPI-forwarder shape. This matches suite arms WR.1–WR.4 **[suite]**.
- **No thawed vault can exit unburned.** Any failure of `burn_vault` reverts the whole transaction, reverting the thaw. There is no instruction that empties a vault without burning. Two redemptions in one transaction pair independently (each open finds its own later burn; each burn finds its own earlier open), and a burned asset is a 1-byte tombstone so a second `open` on it fails `data.len()>=66`. Consistent with 4.9/4.10a **[suite]**.
- **Emptiness proof.** `asset_signer.lamports()==0` is checked first; reserve ATAs are derived for **both** token programs per reserve mint and must be declared; the second loop catches non-ATA token accounts owned by the PDA and refuses T22 extensions, delegates, close-authority, and non-zero amounts. The `acc.lamports()==0 { continue }` in the second loop only skips closed/absent accounts (a live token account always carries rent), which is correct. The `acc.owner != SPL && != T22 { continue }` in the reserve loop correctly treats a dusted/system-owned ATA as absent (no tokens can live there). This is the round-40/41 dust behaviour and it is sound.
- **Token-2022 reserve landmine.** Correctly closed at config time (`ReserveMintNotClassicSpl`), because a T22 ATA is 170 bytes and would fail the 165 check forever. **[read]**, matches probe-round5b **[suite]**.

**One observation (INFO, not a defect):** the emptiness proof's completeness genuinely cannot enumerate PDA-owned accounts, so an *undeclared* non-reserve token or nested foreign asset is destroyed. This is proven-impossibility 2 and accepted limits 9/44; I confirm it is **not worse than stated** and that the sweep helper narrows it for classic strays.

---

## R1s — Sweep helper

I re-derived the helper's access control and pair logic **[read]**. **No defect found.**

- **(a) Owner-only.** `signer.is_signer` is required. Direct calls cannot make the asset-signer PDA a signer (only `invoke_signed` can, which Core performs in `ExecuteV1`). Core's `ExecuteV1` authority rule approves only `authority == owner` for these assets; that is measured by SR.5/5a/5c **[suite]** and is the single dependency limit 40 names. Correct.
- **(b) Pair list.** Duplicate source → second `read_token` fails because the first close de-allocated it (SR.12a). Source==destination collapses to `signer==dest`, rejected up front. Odd/zero pair counts rejected. Frozen source fails closed at the SPL transfer (SR.14). All consistent.
- **(c) Destination not compared to owner.** This is **safe given (a)**: the owner signs the whole transaction (via Core Execute), so the owner chooses `dest`. The program's obligation is to require the owner's signature, which it does. I flag explicitly that the security of "value goes to the owner" rests on Core's owner-only Execute **and** on the owner approving the transaction they intend; there is no on-chain `dest == asset.owner` check, and none is required by the design. This is already the stated model, not a new hole.
- **(d) Lamport sweep.** Reads `signer.lamports()` at execution and transfers all of it; BURN then checks `==0`. Nothing runs between the sweep and the burn in the canonical redemption, and any lamport re-credit would make BURN refuse. Self-protecting.
- **(e) Closed account passes for the right reason.** After the helper closes a reserve ATA it is system-owned/0-byte, so BURN's reserve loop `continue`s it as absent — correct, not a bypass, because a closed account holds nothing.
- **(f) Fits.** S8.0 measures the three-asset redemption through the helper at 1,061 bytes with room for compute-budget + separate payer **[suite]**.

---

## R2 / R2b — Pool and boost

I re-derived the accumulator and boost ring arithmetic **[read]**. **No defect found.**

- **Invariant `pool ≥ ceil(owed)`.** `credit` uses `delta = floor(avail·ACC/w)` and adds `delta·w ≤ avail·ACC` to `owed_scaled`, so `ceil(owed)` rises by at most `avail`, which is exactly what was added to the balance. Claim reduces both consistently; retire removes `pending` (≤1 sat on redeem, forfeit on frozen pool, returned on bare burn). The invariant holds by induction. Matches P.32 and the `books()`/`ledger()` recomputation **[suite]**.
- **Counters.** `pending_count`/`pending_this_epoch` increment on request, decrement on join/retire with the correct same-epoch test, and `pending_this_epoch` resets in `advance_epoch`. `waiting_to_join = pending_count − pending_this_epoch` cannot underflow given those transitions. No drift path found.
- **Two-step activation & gates.** `JoinWaitingFirst` and `BoostsExpireFirst` are checked **before** any $GARY burn, so a refused distribute burns nothing (PG.6a, 3c.A6c). Both gates are unblockable-by-attackers because joining and expiring are free and permissionless. No permanent distribution block found.
- **Boost exactly-N.** A boost bought at epoch `E` with `epochs` ends at `E+epochs`; `advance_epoch` moves it to `boosts_due` exactly when `dist_epoch` reaches `E+epochs`, and `distribute` is blocked until expiry, so it earns exactly `epochs` distributions. `reweigh` preserves `owed_of` (carry absorbs the pre-change owed, debt restarts at new weight), so nothing is lost or gained on boost/expiry/retire. Ring bound `epochs ≤ 63 < 64` prevents slot collision among live boosts. Matches the host_tests ring model and BO section **[read + suite]**.

---

## R3 — Level draw

Re-derived **[read]**. No defect. SlotHashes is read-only/runtime-maintained, parsed with bounds and a zero-hash refusal; the draw is `sha256(hA‖hB‖hC‖asset)` without replacement; FIFO via `revealed_total`; a burned head-of-queue vault still draws (skipping the Core write) so the queue never stalls (L.11); reschedule targets a future slot. No level is assigned without entropy. The last-contributor grinding (limit 26) and lapse re-roll (limit 25) are as stated; I did not find them worse.

---

## R4 — Governance

Re-derived **[read]**. No defect. Quorum/threshold/turnout/key-change math is correct; minimum ordinary-pass is 10.71% (as documented); key changes require ≥50% of snapshotted live supply and cannot bundle guardian+operator. Actions cannot reach the split, destinations, `max_supply`, the royalty, or any vault; `TightenSweep` is monotone and bounded. Overtaken actions skip-and-log rather than revert. On "is governance freezable forever": a stolen guardian at low turnout can indeed hold stops permanently (limit 47); I found **no mechanism worse than stated** — replacing the guardian is reachable exactly when ≥50% of snapshotted live vaults vote YES, and there is no path that lowers that bar.

---

## R5 — Charter claim

Re-derived **[read]**. No defect. Merkle is domain-separated (0x00 leaf / 0x01 node) and sorted, so no second-preimage/reorder; PoB identified by address in the root (lookalike excluded); burned by CPI in-instruction; window fixed at init and never reopenable; not gated by the sales stop (by ruling); `pob_extra` pass-throughs are never signers. The hot PoB-collection authority exposure is limit 46, stated fully; I found nothing it omits beyond what it already concedes (per-asset plugin blind spot, alarm sampling).

---

## R6 — One-time configuration & trusted hop

**[read]** The `initialize` bounds are internally consistent (treasury/operator ≠ default, payment mint ∈ SEAL reserves, tighten bounds within absolute ranges, cap/cooldown/reserve floors, charter window sanity, boost ceilings ≤ 12/63). The redemption rate limit is a genuine rolling window over the 64-slot timestamp ring: the k-th most recent (k = min(cap,64), floor 1) must be ≥ `redeem_window_secs` old; above 3,047 live supply the ring makes it stricter, never looser. At 2,100 supply cap=45<64, so the ring does not bind. The royalty plugin is installed with `PluginAuthority::None`, which Core refuses to change (R.5/R.6 **[suite]**).

**The real residual risk here is limit 38** (a wrong-but-accepted `initialize` value is permanent). That is correctly OPEN AND BLOCKING and is answered by `check-launch-params.mjs`, not by the programs. I confirm the programs check **less** than the checker (SEAL reads only mint owners; off-curve keys are accepted; `redeem_window_secs` may be 10s–24h), exactly as limit 38/round-24 A6 states — so the pre-signing checker is load-bearing and must not be skipped.

---

## R7 — Cross-program raw reads

I recomputed every offset from the structs **[read]**. **All correct.** Spot results (Anchor 8-byte discriminator, then fields in declaration order):

- MintConfig: `version` 8, `collection` 9, `governance` 41, `pool_ata` 73, `minted_total` 141, `bank_treasury` 157, `split_bps` 189, `sales_stopped` 191, `sweep_stopped` 192, `guardian` 193, `swap_operator` 225, `sol_reserve` 257, `max_sweep` 266, `cooldown` 274, `level_caps` 290, `level_minted` 310, `revealed_total` 330, `charter_closes_at` 442, `charter_claimed` 450, `bare_burns_retired` 454, `total_active_weight` 462, `acc_scaled` 478, `owed_scaled` 494, `last_distribute_at` 510, `sales_stopped_at` 518, `sweep_stopped_at` 526, `monthly_secs` 574, `sweep_floor` 631, `cooldown_ceiling` 639, `reserve_ceiling` 647, `dist_epoch` 655, `cbob_mint` 679, `max_boost_weight` 711, `max_boost_epochs` 712, `boost_expiring` 749. These match every constant GOV and BURN pin.
- SEAL Config: `version` 8, `collection` 9, `reserve_mints` 41 — matches MINT/BURN readers.
- VaultRecord: `version` 8, `asset` 9, `mint_index` 41 — matches GOV.
- BurnConfig: `version` 8, `burned_total` 42 — matches GOV.
- Sweep helper token read (mint 0 / owner 32 / amount 64 / len 165) and MINT's mint read (decimals 44 / init 45 / len 82) are the canonical SPL layouts.

No silent-misread found.

---

## R8 — Suite / simulation / build as evidence

**[read of the test sources; I could not execute them.]** The suite's discipline is sound: `because()` pins rejection reasons (so a wrong-reason reject is caught), floors must **equal** counts (not merely clear them), and the init-authority proof is behavioural (`build-mainnet.sh` asks each build whether it trusts the test key). I did not find an arm that structurally cannot fail among those I inspected. Two honest caveats:

- I cannot independently confirm the 909/71/16/4/33 counts ran green at `4a67d00`; I rely on the round-42 VALIDATION log (`.cache/r42-suite.log`, `.cache/r42-web-e2e.log`) as described. If those logs are genuine, the counts hold.
- **Unsettled by any bundled arm (round-42 C12, carried):** whether pinned Core creates over a **pre-funded asset or collection address**. This matters for limit 59 and for V42-2's second variant. It needs a validator arm (fund a fresh asset/collection keypair, then `mint_vault`/`claim_charter_vault`/`CreateCollectionV2`). Until that arm exists, limit 59's "Core refuses" premise is assumed, not measured. I flag this as the one genuinely open measurement, not as a program defect.

---

## The four accepted-limit questions

1. **Is any limit worse than stated?** I found **none** worse. I specifically re-checked 28 (frozen pool — the forfeit fix is present and the redemption still lands), 40 (Core upgradeability — the three named consequences hold, and the sweep's owner-only dependence is the third one), 41, 44, 46, 47, and 55. Each matches its text.
2. **Is anything listed as a limit actually closed / not a limit?** I found **none** falsely listed. Items that look closed (e.g. 14 duplicate attributes, 19 unlevelled halt) are correctly under DISCHARGED, not ACCEPTED.
3. **Is any DISCHARGED item not actually discharged?** I re-checked 14, 19, 30, 31, 33, 51, 54 and the Bank-family discharges. All hold; 14's discharge is valid because both mint and charter-claim route through the same `check_attributes`.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all still genuinely open (no live-chain distribution run, initialize values not yet written, pages staged-not-published, pool/Squads accounts not yet created, rehearsal not yet run). None is being smuggled into ACCEPTED.

---

## Findings (ordered, with severity)

I have **no CRITICAL / HIGH / MEDIUM**. The following are the LOW/INFO items I can substantiate. I include them because the gate treats LOW/INFO in the fixable layer as fix-and-test, not launch-blocking.

**INFO-1 (carried, web tooling): V42-1 malformed-path crash in `ceremony-local.mjs`.** Already confirmed by round 42 and repaired; I re-derived it and agree. Ensure the gate-5 arm shows it red at `4a67d00` (unguarded decode → process exit) and green after the guard.

**INFO-2 (carried, web tooling): V42-2 oldest-transaction collection misclassification.** Already confirmed by round 42 and repaired; I re-derived it and agree. Ensure the new arms cover: stranger's *failed* transfer first → `launch`; stranger's *successful* transfer first → `launch`; no-create-in-complete-history → `unverifiable` (never `other`).

**INFO-3 (measurement gap, not a program defect): limit 59 / C12 premise unmeasured.** Whether Core creates over a pre-funded asset/collection address is assumed. Add the validator arm named in R8. If Core instead *tops up and proceeds*, limit 59 and V42-2's second variant must be re-opened as findings. This is the single most important outstanding measurement.

**INFO-4 (documentation, optional): `nginx-rpc.conf` depends on the host's Cloudflare real-IP config.** The per-IP rate limits key on `$binary_remote_addr`/`X-Real-IP`, which are only the visitor because the box sets `real_ip_header CF-Connecting-IP`. On a host without that include, one client could exhaust its whole PoP's budget. Recommend naming this dependency in `nginx-rpc.conf` and the README enabling steps (round-42 C14). Not a program defect.

I deliberately do **not** report the sweep-helper `dest`-not-owner point, the Core-heap FIFO point, or the frozen-empty-account point as findings: the first is safe by the owner-only Execute model and already documented; the second is limit 40; the third is limit 28 and fails closed. Reporting them would be re-litigating accepted limits, which the brief tells me not to do.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — do before launch

AI audit structurally cannot do the following; each should be done by a person or a non-AI process:

1. **Run the live dress rehearsal (item 22) with real hands.** No AI round has ever run the crank, the revenue cycle, or the alarm against a live cluster. The named pass/fail items (crank live passes, alarm in rehearsal mode, one full revenue cycle through *both* pools, one forced post-sweep failure walked through hand recovery, one DAS read of a burned collection) must be executed by an operator watching a real terminal, because the failure modes (RPC rate limits, transient errors at vault 1,900, paging storms) only exist under live load.
2. **Physically verify the four `initialize` values before signing (item 38).** The programs check less than the checker. A human should read `launch/mainnet-init.json` against the ruling, on paper, independent of `check-launch-params.mjs`, because a wrong-but-valid value is permanent and no AI can adjudicate "is this the value Gary actually meant."
3. **Close the Core pre-funded-create measurement (INFO-3).** This is a one-arm validator test but it decides whether limit 59 is real. Run it before relying on the "retry with a fresh address" mitigation.
4. **Publish and use the holder pages (item 50) before any real redemption.** Until `judgeRedemptionCoverage` is in front of holders, limits 9 and 44 have no preventive control. A person should click through the redeem page on a rehearsal vault with a planted stray, a nested vault, and a C5 account, and confirm the boxes say what they mean.
5. **Decide the charter-window hot-key posture (limit 46) with a human custody decision.** Whether the Giraffish Moments update authority is held cold/multisig *during* the 7-day window is a key-management choice only Gary can make; AI can state the exposure (end-the-project or capture-governance) but not accept it.
6. **Establish a human reachable for the alarm.** The whole detection layer pages a person. If no human is actually on the other end of `cbob-vault-alarm:*`, the alarm is theatre. Name the human and the escalation before lock.
7. **Do the upgrade-authority removal (road step 11) as a deliberate, witnessed act** after the rehearsal passes, and re-dump/re-hash all five programs after removal. This is the point of no return and should not be scripted unattended.

**Net verdict for this round:** quorum/confirmation aside, from my seat the five programs contain no confirmed CRITICAL/HIGH/MEDIUM at `4a67d00`; the two round-42 INFO items are valid, non-program, and correctly repaired; the accepted limits are accurate; and the remaining blockers are the open operational items (22, 38, 50, 52, 53) plus the one outstanding Core measurement (INFO-3), none of which is a defect in the immutable code.