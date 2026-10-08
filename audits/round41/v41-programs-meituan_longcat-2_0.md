# Independent Audit Report — v6, Round 41

## R0. Round 40 Verdict and Repairs

Round 40 was **NOT CLEAN** on both passes (quorum met on programs: 7/8 counted, MiniMax excluded for describing round 39's tree). The programs pass found **0 CRITICAL, 0 HIGH** in the five programs. All confirmed findings were in the web layer:

| ID | Severity | Finding | Repair validated |
|---|---|---|---|
| V40-1 | MEDIUM | Stranger dusting lamports at a missing token-account address made the redeem page refuse permanently | `absentIfDust` in `reads.mjs` — System-owned 0-byte account at an expected ATA address reads as absent and creatable. Suite R34.G2 control proves ATA create still lands. |
| V40-2 | LOW | Ceremony reported a dusted cbBTC ATA as permanently broken | `ceremony-reads.mjs` treats dusted account as "not run", step creates it. |
| V40-3 | LOW | Metadata generator wrote no file for a vault whose cbBTC ATA was dusted | `web/meta/generate.mjs` reads dusted account as 0 sats. |
| V40-4 | LOW | SPEC DISCHARGED item 2 said "nothing refuses a redemption off chain any more" | Rewritten to name the page's remaining by-design refusals. |
| V40-5 | INFO | Nested-vault note falsely claimed "Someone sent it in" | Rewritten to say "whoever sent it in". |

**Independent verification of repairs:** I re-read `web/src/lib/reads.mjs`, `web/src/lib/ceremony-reads.mjs`, `web/meta/generate.mjs`, `SPEC.md`, and `plan-redeem.mjs` at HEAD `8dba479`. Each repair is at its named site and matches the verdict's description. The offline web suite runs 657/657 at floor. The e2e harness (`.cache/r40b-web-e2e.log`, 127/127) exercises both dusted addresses through the page's own `readRedemptionSnapshot` → `planRedemption` path and confirms the set-up transaction creates them and the opening lands. The programs are byte-identical to round 39 (`git diff 21f36e1 8dba479 -- programs` is empty). **No program defect survives round 40.**

The clean-round counter remains **0/2**.

---

## R1. Custody: Can anyone but the owner get value out of a sealed vault?

**Verdict: No new defect found.** The pairing holds at every site I re-examined.

### The seal/thaw/burn pairing

SEAL's `open_for_redemption` and BURN's `burn_vault` bind **asset AND owner** in both directions, each walking the instructions sysvar for the other's discriminator at the pinned account positions (`BURN_IX_ASSET_IDX = 0`, `BURN_IX_OWNER_IDX = 2`; `SEAL_IX_ASSET_IDX = 0`, `SEAL_IX_OWNER_IDX = 2`). Both walks see **top-level instructions only** — a `burn_vault` buried inside another program's CPI reports the outer instruction's index and program id, so it cannot satisfy the match. A wrapper would need a genuine top-level burn for this exact asset and owner later in the same transaction, which BURN in turn only permits when a genuine top-level open for the same pair preceded it. Neither half can be borrowed from another vault's redemption sharing the transaction (verified by the suite's 3.9, 3.10, 9.0 arms).

### The emptiness proof

BURN requires `asset_signer.lamports() == 0`, every reserve mint's ATA under **both** token programs declared, PDA-owned, undelegated, extension-free, and empty (`amount == 0`), and no declared account a live Core asset. The reserve list is read from the SEAL config at burn time — there is no second copy to diverge. The sweep helper closes every account it empties (rent to the destination wallet), so no emptied reserve account strands rent.

### The sweep helper (`programs/cbob-vault-sweep/src/lib.rs`)

Called through Core `ExecuteV1`, Core signs as the asset-signer PDA. The helper's whole access control is:

1. `signer.is_signer` must be true — only Core can set this for the PDA.
2. Every source must be owned by `signer` (the PDA) — `read_token` checks `src_owner != *signer.key`.
3. Every destination must be owned by the single `dest` wallet and match the source's mint.
4. It reads `signer.lamports()` at execution and transfers **all** of it to `dest`, emptying the PDA to zero. BURN's `lamports == 0` check then passes.

**Pair-list edge cases I traced:**
- Same source twice: first iteration closes it; second tries to read a closed account → `try_borrow_data` fails → whole call reverts. Correct.
- Source also a destination: after the first pair the account holds a balance and exists; the second pair moves it again. Correct.
- Native wSOL source: `read_token` succeeds (owned by Tokenkeg, 165 bytes); close unwraps to SOL. Correct.
- Frozen source: `read_token` doesn't check state; the Token `invoke` fails → whole redemption reverts. Correct.
- Odd or zero-pair account list: `(accounts.len() - 4) % 2 != 0` catches odd; zero pairs (exactly 4 accounts) is the lamports-only sweep BURN's header relies on. Correct.
- Token-2022 source: `*a.owner != SPL_TOKEN_ID` refuses it. By design — the helper sweeps only classic tokens; Token-2022 strays are left behind and named in a box (accepted limit 44).

**The lamport sweep and BURN's check:** The sweep reads and transfers in a single `invoke`. Between the sweep and BURN there is no instruction that can deposit into the PDA (closed accounts send rent to `dest`, not the signer). A stranger who sent lamports to the PDA before the redemption finds those lamports swept to the redeemer — the grief is self-defeating. Correct.

**Direct call without Core:** The signer is whatever the caller passes. The source-ownership check `src_owner != *signer.key` means you can only move tokens already owned by your own key. A vault's token accounts are owned by its asset-signer PDA, which you cannot sign for. Correct.

---

## R1s. The Sweep Helper — detailed answers

**(a) Nobody but the asset's owner can make it move value.** Called directly it moves only the caller's own holdings. Through Core, Core decides who may `ExecuteV1`. The pinned Core binary approves Execute only for `authority == owner`; the collection abstains; the one plugin route that approves anyone else (AgentIdentity) cannot be added by an owner (R24.1a) and is not added by any of our CPIs. Measured: SR.5–SR.5d refuse a stranger and an owner-added transfer delegate on a genuinely thawed vault (`NoApprovals`, 0x1a); SR.5b pins the collection authority to MINT's off-curve PDA.

**(b) The pair list.** Traced above — duplicate source reverts, source-as-destination works, native wSOL works, frozen source reverts, Token-2022 refused, odd/zero handled.

**(c) Destination checks.** The destination wallet is chosen by whoever builds the transaction. Given (a), that is always the owner during a redemption. The lamport transfer to a destination below rent exemption is refused by the System program if the account doesn't exist — but the canonical destination is the owner, who pays the fee and so exists. A page naming any other destination must check it (SPEC item 50).

**(d) The lamport sweep.** Moves `signer.lamports()` read at execution. Nothing can leave the PDA non-zero afterwards inside the same transaction. BURN's `lamports == 0` check sees exactly what the sweep left. Correct.

**(e) Interaction with BURN's emptiness proof.** BURN requires every reserve mint's ATA under both token programs to be **declared**, and skips an account no token program owns. The sweep closes what it empties. A closed account is gone, so BURN's `find` for that ATA address finds nothing and the `ReserveNotDeclared` path is not taken — the account was declared and passed the emptiness check before the sweep ran. Correct.

A vault's reserve ATA that does **not** exist when the page builds the transaction: the sweep cannot name it (it refuses a non-token account). But anyone can create a classic ATA for any owner, permissionlessly, and deposit into it before the redemption lands. SPEC's REDEEMING step 1 says the page creates the missing reserve accounts in a **prior** transaction. That is sufficient: once created, the sweep names it, and the deposit (if any) is swept out. A Token-2022 ATA for a classic mint is refused by the ATA program (F4.2); a non-ATA token account is not derived and not required; a nested Core asset is not enumerated by either sweep or BURN (accepted limit 44, rescued by `rescue_nested`).

**(f) It fits.** S8.0 measures the three-asset redemption through the helper, claim included, at **1,061 bytes** with the owner as fee payer. Both compute-budget instructions add 52 bytes and a separate fee payer adds 96, giving ~1,209 of 1,232. S8.1a measured **168,343 CU** for the four-instruction redemption, below the legacy default combined budget of 800,000. R40.U1 re-measured the largest-autograph vault's complete redemption at **158,377 CU over 4 instructions** with no compute-budget instruction.

**(g) Evidence.** SR.0–SR.4a in `tests/3prog.test.ts` and S8.* in the simulation. The helper is deployed from the same bytes `scripts/build-mainnet.sh` proves (`cmp -s` against `target/deploy/cbob_vault_sweep.so` and `dist/cbob_vault_sweep.so`). The alarm watches `prog.sweep.upgrade_authority` and `prog.sweep.hash`.

---

## R2. The Community Pool's Money

**Verdict: The invariant "the pool always holds at least `ceil(owed)`" holds.** I traced every counter under every ordering.

The accumulator is u128 throughout. `distribute` adds `floor(avail × 1e12 / total_active_weight)` to `acc_scaled` and `delta × weight` to `owed_scaled`. `claim` pays whole sats and carries the sub-sat remainder in `carry_scaled`, restarting `debt_scaled` at the current weight. `reweigh` (boost start/end, retire) moves the owed share into `carry` and resets `debt` at the new weight — nothing earned is lost or gained. `distribute` refuses `PoolShort` (pool < owed). `overflow-checks = true` and every arithmetic site uses `checked_*`; u128 holds 2.1e27 (2.1M BTC in sats × 1e12) against a max of 3.4e38.

**Counters under every ordering:**
- `pending_count` / `pending_this_epoch`: incremented on request, decremented on join or retire. A vault retired while waiting leaves both (F21.1).
- `active_count` / `total_active_weight`: changed only on join (by `join` or `claim`) and retire. A boost changes `total_active_weight` via `reweigh` but not `active_count` — correct, the vault was already active.
- `revealed_total` / `level_minted`: incremented only at `reveal_level`, once per vault (`AlreadyRevealed`). A burned vault still takes its draw (L.11).

**Liveness:** `JoinWaitingFirst` refuses a distribution while any eligible-but-unjoined vault waits. The crank joins every eligible vault right after each distribution, so the window is at most one period. If the crank stalls, distributions block — an accepted liveness limit, not a correctness defect. The monthly in-line run degrades gracefully (logs `CBOB_MONTHLY_WAITS_FOR_JOINS` and does nothing), never refusing its host.

---

## R2b. The $CBOB Boost

**Verdict: A boost earns EXACTLY its N distributions and not one more.** The ring of 64 counts (`boost_expiring[epoch % 64]`) schedules the end. `MAX_BOOST_EPOCHS_BOUND = BOOST_RING − 1 = 63`, so a boost's end epoch always lands in a slot other than its purchase epoch — no collision. `advance_epoch` moves `boost_expiring[epoch % 64]` into `boosts_due`. `BoostsExpireFirst` refuses any distribution (burn path or monthly in-line) while `boosts_due > 0`. `expire_boosts` requires `dist_epoch >= boost_end_epoch` — no early expiry. After expiry, `boost_weight` and `boost_end_epoch` are zeroed, so a second expiry skips the record — no double expiry. `unschedule_boost` (called by `retire`) decrements `boosts_due` if due, else the ring slot — the counts always agree. The host unit test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` drives 260 epochs (four ring wraps) through the program's own `credit`/`tick`/`join`/`reweigh`/`retire`/`expire_boosts` against an independent model and asserts `ring + due == active`, `boosts_due == due`, and `total_active_weight` matches the sum of every live vault's weight at every epoch. Coverage asserts wrapped buys, early wrapped retirements, due retirements, and expiries all occurred.

---

## R3. The Level Draw

**Verdict: The draw is as fair as a public-hash scheme without a VRF can be, and the residual is correctly stated.**

`capture_entropy` reads three slot hashes: A, the first produced slot at or after `reveal_slot`; B and C, each the first produced slot at least two 4-slot leader groups (8 slots) after the previous hash's group. `blockhash_in_window` parses the SlotHashes sysvar defensively (key check, count bound, buffer length, all-zero-hash refusal). The draw is `sha256(hA ‖ hB ‖ hC × asset) mod sum(remaining)` walked across levels I–V. FIFO is enforced by `require!(index == revealed_total)`; a missed window is rescheduled (`reschedule_reveal` to `now + REVEAL_LEAD_SLOTS`, a slot that doesn't exist yet), never defaulted. The host unit test `the_lookup_takes_the_smallest_produced_slot_in_the_window` exercises skipped-slot runs; `capture_skips_at_a_b_and_c_and_matches_the_model` places skips on every target and compares against an independent model.

The residual (accepted limit 26): C's leader produces its block knowing hA and hB and may skip its own first slot(s) or vary its contents. This is the last-contributor property of any public-hash scheme; only a VRF removes it. HOLDER-GUIDE says "the validator producing the last of those blocks can pick among several results" — accurate.

---

## R4. Governance

**Verdict: No minority can carry what it should not; no vote reaches money; governance cannot be frozen forever by a minority.**

One vault, one vote, bound to the asset (`["vote", proposal, ASPDA]`). The electorate is snapshotted at creation: `index_snapshot = minted_total` (a vault minted during the vote is `VaultTooNew`), `quorum_supply = minted_total − burned_total − bare_burns_retired` (live supply then). The divisor at execute is the snapshot, never `max(snapshot, live)`. Quorum is ceiling against the snapshot; threshold is a share of votes cast; turnout is 10% of the snapshot; a guardian change or operator arm needs 50% of the snapshot (`KeyChangeNeedsHalf`), and the two may never share a proposal (`KeyChangesBundled`). With the ruled numbers (quorum 21%, threshold 51%) the smallest passing vote is 10.71% YES, above the 10% turnout floor — the turnout rule only binds if `initialize` is given other values (accepted limit 35).

Per-kind ordering marks (`last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`) make an overtaken action a logged `CBOB_ACTION_SKIPPED` no-op, never a revert. A restart voted before the stop it would lift is skipped (`StopIsNewer`, mirroring MINT's `restart`). A passed proposal expires 7 days after voting ends (`ProposalExpired`).

A stolen guardian key can stop sales and the sweep, and re-stop after every restart, and cancel any pending operator. It cannot touch a vault, a payout, or a rule. The cure is a vote replacing the guardian — YES from half of ALL live vaults (snapshotted at creation; vaults minted during the vote cannot vote and do not raise the bar), landing only after 7 days' notice, which the guardian in office cannot cancel. At turnout below half the snapshot the thief keeps the key and re-stops after every restart — the stop is then permanent (accepted limit 47). That is the price of a brake no captured vote can remove in one breath.

---

## R5. The Charter Claim

**Verdict: The only path that creates a vault without a vote, and it is sound.**

`claim_charter_vault` CPI-burns one Proof of Burn held by the signer, in the same instruction, inside the window `[charter_opens_at, charter_closes_at)`. Identity is by **address** against the Merkle root `pob_root` (domain-separated leaf/node tags, sorted pairs — `scripts/pob-merkle.mjs`, the same code the suite and the mainnet probe use). A lookalike minted by the collection's hot update authority is not in the tree (`NotInPobSet`). The window is fixed at `initialize` and can never reopen; the instruction does not read the sales stop (Gary's ruling: the brake cannot cost a charter member their claim). `pob_extra` pass-through accounts (up to 8) are handed to Core's burn of the PoB, never as signers, so a benign collection hook cannot brick the claim at the program level; a rejecting hook still refuses it (the alarm's job, by ruling).

The hot wallet (accepted limit 46) can add an external plugin that rejects every charter claim, or admit only Proofs of Burn it holds — capturing the whole electorate. Through the 7-day window that key can end the project before it starts or capture all of governance. After the window closes, `claim_charter_vault` refuses by clock alone and this exposure ends. The alarm pages on any plugin or update-authority change to the PoB collection; it samples once a pass (every 30 min), so a hook added and removed between passes is not paged (accepted limit 46, stated).

---

## R6. The One-Time Configuration and the Trusted Hop

**Verdict: Every `initialize` value is written once and can never be corrected; the ruled values are the ones the alarm and the launch checker enforce.**

The four `initialize` instructions are gated on `INIT_AUTHORITY` (Gary's wallet, `Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb`), each runs once (the config is an `init` PDA), and the only fields any instruction writes afterwards are the guardian's stops, the governed setters, and the pool's counters. The 85/15 split, both destinations, `max_supply`, the level census, the charter window, the Proof of Burn root, the reserve list, the boost ceilings, and the royalty are **permanent**. The royalty is a Core `Royalties` plugin with plugin authority `None` — Core refuses every later update or removal, from anyone, including the update authority (our PDA). `initialize` installs it once.

The swap operator (`sweep_sol_for_swap`) is the one trusted hop: destination pinned, cap and cooldown on chain, the operator SIGNS, and the guardian can stop it. A vote can only tighten, and only inside bounds fixed at `initialize` (`sweep_floor_lamports`, `cooldown_ceiling_secs`, `reserve_ceiling_lamps`). Replacement needs half of all live vaults plus 7 days' notice; the guardian may cancel a pending operator. The alarm reports a sweep with no matching cbBTC return, a return of zero, or a return well below quote.

The redemption cap is a true rolling window: BURN keeps the timestamps of the last 64 redemptions in `rate_ring` and refuses one unless the cap-th most recent is at least `redeem_window_secs` old. `cap = max(1, ceil(live × 210 / 10000))`, bounded by the ring (past 64 the limit is stricter, never looser). Live supply is `minted_total − burned_total − bare_burns_retired`, read from the MINT config the transaction already carries.

---

## R7. Cross-Program Raw Reads

**Verdict: Every offset and every account space is correct.** I recomputed every cross-program read against the struct definitions and the pinned versions:

- SEAL config v2: disc `[155,12,170,224,30,250,204,130]`, version 2, collection at 9, reserves Vec at 41.
- MINT config v6: disc `[168,252,88,182,219,205,39,53]`, version 6. GOV reads governance at 41, minted_total at 141, bare_burns_retired at 454, charter_closes_at at 442, the sweep bounds at 257/266/274, the boost bounds at 711/712. BURN reads minted_total at 141, bare_retired at 454.
- BURN config v4: disc `[90,69,15,87,119,190,109,45]`, version 4, burned_total at 42.
- GOV config v4: version 4, the four ordering marks appended.
- VaultRecord v4: disc `[47,1,218,116,82,70,124,119]`, version 4, asset at 9, mint_index at 41, level at 57, active at 125, retired at 126, pending at 177, request_epoch at 178, boost_weight at 186, boost_end_epoch at 187, carry_scaled at 195.
- The sweep helper reads classic SPL token accounts at mint[0..32], owner[32..64], amount[64..72], state[108], length 165.

Account spaces: MINT config 1161 + 256 padding, VaultRecord 221 + 10 padding, BURN config with the 512-byte ring + 256 padding, GOV config + 256 padding. The suite's 896 assertions include the constant-time checks (`R.7`, `3.1a–3.1f`, `3.1v–3.1y`, `9.15/9.16`, `3c.M1`, `R35.C3`, `BO.29`) and every one passes. **No offset is wrong.**

---

## R8. The Suite, the Simulation, and the Build as Evidence

**Verdict: The claims rest on measured evidence; the floors equal the counts; the deployed bytes are proven to be the tested bytes.**

- `tests/3prog.test.ts`: **896/896** at floor 896, every negative pinned to its `because()` reason. Runs on a local validator carrying the **real pinned mainnet Core** (sha256 `f03e7537…`, hard gate in `run-tests.sh`), minting real vaults and moving real SPL tokens against the real `$GARY` mint.
- `sim/test-vault.ts`: **71/71** at floor `SIM_FLOOR` 71. One vault's whole life against real Core, the real cbBTC/$GARY/$GIRAFFISH mint accounts, and two real mainnet Proof of Burn assets, including a redemption through the sweep helper after a stranger's deposit.
- `scripts/build-mainnet.sh`: builds BOTH the mainnet and localnet artifacts, deploys each to a fresh validator, and asks every keyed artifact whether it trusts the test key (mainnet must REJECT, localnet ACCEPT) — the only proof possible, since the compiler folds the 32-byte compare into immediates and no contiguous 4 key bytes survive in the `.so`. It then `cmp -s` the sweep helper's mainnet bytes against the localnet bytes the suite ran, and against `target/deploy`. It records the commit, refuses a dirty tree, and prints the sha256 to deploy.
- Off-chain selftests: **933/933** detectors, **39/39** allocation, **24/24** poster, **49/49** launch-values, **14/14** Proof-of-Burn Merkle, **33/33** live-mainnet probe, **4/4** expiry-budget, **6/6** host unit tests (one is Anchor's generated `test_id`). Every floor equals its count; `bank/selftest.mjs` checks every occurrence.

**Arms that cannot fail:** none that I found. Every `because()` pin names a real error variant emitted by the site it names; the suite prints the actual error on a mismatch, so a wrong-reason pass would be loud. The `attestation ids are unique` arm (ID.1) guards against a reused id making a reason pin read the wrong arm's error.

**What no arm exercises:** a distribution at the ruled 30-day period (the suite uses 150 s), a vote at the ruled 3 days (60 s), a key-change notice at 7 days (60 s). These are `initialize` values and the arithmetic is the same at any magnitude; the alarm asserts the deployed values are the ruled ones.

---

## The Accepted Limits — are any worse than stated?

I re-read every accepted limit against the code. **None is worse than stated; none is already closed.** Two deserve a fresh reader's attention:

1. **Limit 27 (claim between bare burn and retirement):** A bare-burned vault keeps its weight until `retire_burned`. A `claim` in between pays that vault's share into its cbBTC account behind the burned asset, where nothing can ever sign for it; and a bare-burned vault still waiting to join can be joined by a `claim` that names it, adding dead weight. The crank retires every positively burned vault first each pass and never pays or joins one — but the program side is accepted because refusing needs the asset account in every claimed pair (a third account per vault, a third smaller batch). A stranger can choose to cause it (round 38 V38-4). **Stated accurately; the cost falls on the other holders, not the burner.**

2. **Limit 46 (the hot PoB update authority):** Through the 7-day charter window that key can block every claim (no vault, so no vote and no round, ever) or admit only its own Proofs of Burn (its vaults the whole electorate). The alarm watches the collection account once a pass; a plugin added and removed between passes is not paged, and per-asset plugin changes are not watched at all. **Stated accurately, including the sampling blind spot.**

---

## Findings

### MEDIUM — Buy page dust handling (web layer, not a program)

**Construct:** `web/src/pages/buy.mjs:39` — `account(conn, ata(ids.REVENUE, PM), 'the Bank\'s revenue account')` followed by `.map(absentIfDust)`.

**What an attacker or an accident gains:** If a stranger sends ~0.00065 SOL to the **revenue address's cbBTC ATA address** (a known PDA, derivable from public ids), the address becomes a System-owned, 0-byte account. `absentIfDust` returns `null`, `revenueTokenExists` is `false`, and the buy page refuses every purchase with "The Bank's revenue account for cbBTC is not set up yet" — permanently, until someone creates the ATA. The ceremony's step 5 creates this account, so the window is between the ceremony and the first purchase, or any time after the account is closed and re-dusted. It costs the stranger ~0.00065 SOL per vault-buying opportunity and scales to blocking all sales. No value is at risk and nothing is sent, but it is a set-and-forget stranger block on the sale surface, and the page gives no path to clear it.

**Evidence that would exist if I am right:** A `buy` page plan against a snapshot where `ata(REVENUE, CBBTC)` is System-owned and 0-byte returns `refuse: ['The Bank\'s revenue account for cbBTC is not set up yet, so a sale cannot be paid.']` and no `mint_vault` is built. The same `absentIfDust` already fixed this class for the redeem page (V40-1); the buy page uses the same helper but its `revenueTokenExists` check was not part of that repair.

**Fix:** The buy page should treat a dusted revenue cbBTC account as "exists, not yet funded" — the ceremony creates it, and a sale's `mint_vault` pays into it regardless. Alternatively, the buy page should create it in a prior transaction, as the redeem page does for missing reserve accounts. The ceremony's step 5 already creates it, so the practical window is narrow; the fix closes it.

**Severity:** Not LOW — it is set-and-forget, cheap, scalable to all sales, and the page gives no path. Not HIGH — no value moves, the vault is unchanged, and the ceremony's step 5 already creates the account (the attack is only viable if the account is dusted after the ceremony and before the first buy, or if the ceremony is re-run). MEDIUM, by the same ruler as V40-1.

### LOW — Metadata generator liveness for newly funded vaults

**Construct:** `web/meta/generate.mjs` writes a vault's file from a complete read. If the vault's cbBTC ATA was dusted (now read as 0 sats) and then funded, the generator updates the file on its next pass — but if the ATA is created and funded between generator runs, the file lags until the next cron tick. A marketplace showing the file would show 0 cbBTC for a funded vault for up to the cron interval (suggested 5 minutes). No value at risk; the generator is fail-closed and never writes a stale file (it carries the slot and refuses to replace a newer file with an older read). **Already stated in the README; a liveness observation, not a defect.**

### INFO — Redundant `covers` field in `groupAcks`

**Construct:** `plan-redeem.mjs` `groupAcks` builds a `covers: many.map(a => a.id)` field on a grouped acknowledgement that no reader ever consumes. Dead data, not a defect. Optional removal.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

AI audit reasons; it never executes against a live cluster with real money, real latencies, real RPC failures, and real strangers. The programs have never run a distribution, a revenue cycle, or a dress rehearsal against mainnet (items 22, 53). **Before launch, do these things that AI structurally cannot:**

1. **Mainnet dress rehearsal at throwaway ids** (item 22, road step 8): run the crank, the alarm, and one full revenue cycle through BOTH pools (Orca forced to refuse once, so Meteora runs) against a rehearsal deployment, with small real amounts, and record every transaction signature. Include one forced post-sweep failure walked through the hand recovery. This is the only way to exercise the off-chain pipeline's I/O against a live cluster.

2. **Reproducible build verification**: the build script asks each binary which key it trusts, which is the only proof possible because the compiler folds the key compare into immediates. Before the lock, publish the expected sha256 of every deployed program and have an independent party rebuild from the release commit and confirm the bytes match. A Dockerized build would make this deterministic.

3. **Holder-page end-to-end on mainnet with real Phantom wallets**: the e2e harness drives the pages' own library on a local validator with keypairs in place of Phantom. Before publication, run the redeem, claim, and buy pages against the rehearsal deployment with real Phantom extensions in real browsers — including a redemption of an active vault that is owed a share, a claim with a depth-8 proof, and a buy of a vault in an open round. Verify that Phantom does not alter the signed message (the page's `signExact` refuses if it does).

4. **Operator procedure dry-run**: the runbook for hand recovery of an open revenue cycle, for replacing a guardian or operator, and for responding to a CRITICAL (frozen pool, frozen vault, nested vault, program still upgradeable) must be walked by a human who is not the author, at a terminal, against the rehearsal deployment. AI cannot verify that a human follows a procedure under pressure.

5. **Third-party program confirmation**: read the current mainnet bytes of the Orca Whirlpool, Meteora DLMM, and Pyth receiver/push oracle programs and confirm their interfaces match the pinned IDLs the swap is built against. The alarm watches their upgrade authorities and bytes; verify the alarm's baselines are taken from the real mainnet programs before the lock.

6. **Launch-value final review** (item 38): every `initialize` value is permanent. Before the ceremony, an independent human who is not the author must read `launch/mainnet-init.json` and confirm each RULED value against its source in DESIGN-v6.md, and confirm the charter opening date and lock deadline are set. The checker refuses OPEN values; a human must confirm the values are not merely syntactically valid but correct for the business.

7. **Continuous-monitoring baseline**: before the lock, run the alarm in rehearsal mode (`CBOB_ALARM_REHEARSAL=1`) against the rehearsal deployment for at least 24 hours and confirm every detector pages and recovers as designed — especially `royalties_unswept`, `distribution_overdue`, `scan_gap`, `log_coverage_gap`, and the PoB-collection plugin watch. The alarm is the only layer that sees what the programs cannot; it must be proven to see it.

The programs themselves are sound. The remaining risk is concentrated in the off-chain pipeline and the surfaces promised to holders — exactly the things AI audit cannot execute against a live network. The dress rehearsal is not a formality; it is the only gate that can catch what 896 suite assertions cannot.