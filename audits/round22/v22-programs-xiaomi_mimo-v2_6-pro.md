# INDEPENDENT SECURITY AUDIT — v6, read whole

I recomputed every cross-program offset (MintConfig v5, VaultRecord v3, BurnConfig v4, SEAL Config v2), every `*_SPACE` constant, and all pinned discriminators from the struct definitions. All offsets I checked match the raw reads in GOV and BURN: `minted_total[141]`, `bare_burns_retired[454]`, `charter_closes_at[442]`, `sol_reserve[257]`, `max_sweep[266]`, `cooldown[274]`, `sweep_floor[631]`, `cooldown_ceiling[639]`, `reserve_ceiling[647]`, `sales_stopped[191]`, `sweep_stopped[192]`, `sales_stopped_at[518]`, `sweep_stopped_at[526]`, `governance[41]`, VaultRecord `mint_index[41]`, BurnConfig `burned_total[42]`. `MINT_CONFIG_SPACE` = 8+671+256 = 935; `VAULT_RECORD_SPACE` = 8+178+35 = 221 (rent 2,429,040 at 6,960/byte — matches); `BurnConfig` 8+563+256 = 827; `GovConfig` 8+78+256 = 342. `ACTION_MAX_BYTES` 37 is correct (Brakes = 1+3+33). No offset fault.

---

## R1. CUSTODY

No fault found in the pairing, the emptiness proof, or the rate limit.

Checked and holding: both walks (`SEAL::open_for_redemption` forward from `current+1`, `BURN::burn_vault` backward over `0..current`) see **top-level instructions only** and bind **asset AND owner** at pinned indices 0 and 2, so neither half can be borrowed from a second redemption in the same transaction (3.9/3.10/4.10) and a CPI wrapper cannot satisfy either walk (both would need a genuine top-level instruction for the exact pair on the correct side; a wrapper that supplies neither fails closed). The discriminator match on `data[..8]` is safe because any instruction that matches but fails to deserialize aborts the transaction and reverts the thaw with it — atomicity covers the gap. The emptiness proof demands all six reserve ATAs (3 mints × both token programs) declared, refuses delegates (COption tags at 72 and 129), close authority, delegated amount, extensions, and non-zero amounts, and both loops now carry the same three checks. `is_burned` is positive (Core-owned, 1 byte, key 0). The rate-limit ring: I traced `rate_head`, `k = min(cap, 64)`, and `(head + 64 − k) % 64`; at cap 1, 2 and 3 the k-th most recent timestamp is exactly right, concurrent same-slot sends are ordered by the ring write, and `now.checked_sub(kth)` fails closed. `cap > 64` binds at 64 (stricter, never looser).

## R2. THE COMMUNITY POOL

**Invariant 1 "the pool always holds at least ceil(owed)" — proved.** `credit` adds `delta*w ≤ avail*ACC` to `owed_scaled`, so `ceil_sats(owed_new) ≤ ceil_sats(owed_old) + avail = balance`. `claim` subtracts exactly `pay*ACC` from both `owed_scaled` and the balance. `retire` subtracts `pending` from `owed_scaled` only (tokens stay). `owed_scaled` is at every instant the sum of active vaults' `pending = w*acc − debt`, so every `checked_sub` is safe and `pending ≥ 0` is inductive (acc monotone, `debt` grows by at most `pending` per settle). Counters: `pending_this_epoch ≤ pending_count` inductively (both incremented together in `activate`, `pending_this_epoch` zeroed by `credit`/`tick`, `join` decrements only `pending_count`, `retire` decrements both conditionally and only once because `r.pending` clears), so `waiting_to_join` never underflows. No distribution, redemption, or claim can be made impossible for anyone: `distribute` and `join` are permissionless, `monthly_inline` never refuses its host, and the owner can always sweep grief lamports (9.10/9.11) inside the redemption.

### R2.1 — MEDIUM — INVARIANT 2 IS FALSE: a vault CAN be paid for revenue that arrived before it joined

**Construct:** `tick()` + `join()` + `credit()` in `programs/cbob-vault-mint/src/lib.rs`.

The two-step activation charges `debt = w * acc` at join, so a vault earns only acc-growth *after* join. That excludes it from the distribution immediately after its request **only if that distribution moves money**. When `total_active_weight == 0`, the "distribution" that makes the vault eligible is a `tick`, which advances `dist_epoch` and resets `pending_this_epoch` **without touching `acc_scaled` or the pool balance**. The backlog then sits undistributed and is swept into `acc` by the *next* `credit`, at which point the newly joined vault takes a full weighted share of it.

**Sequence (state: `acc=0`, `owed=0`, `w=0`, `dist_epoch=0`, pool = B > 0):**
1. `split_revenue` puts B sats in the pool (revenue has "arrived").
2. Vault V (level I, w=2) `activate`s: `pending_count=1`, `pending_this_epoch=1`, `request_epoch=0`.
3. Period elapses; `monthly_inline`/`distribute` hits the `w==0` branch and calls `tick`: `dist_epoch=1`, `pending_this_epoch=0`. **No money moves.**
4. `claim`/`activate` calls `join`: `debt = 2*acc = 0`.
5. `credit(avail=B, w=2)`: `delta = B*ACC/2`, `acc = B*ACC/2`, `owed = B*ACC`.
6. `claim`: `pending = 2*(B*ACC/2) − 0 = B*ACC` → `pay = B`. V receives **B**, all of which arrived at step 1.

**What is gained:** at launch the first tick (`last_distribute_at = max(now, charter_closes_at)`) is 30 days after the charter window closes. Every sat of paid-mint and royalty revenue split into the pool during those 30 days is distributed, in full, to whichever vaults pass through the first tick — revenue they did not earn. If participation is thin, one vault can take a large share of 30 days of sales for the price of one 21,000-sat vault. This is not theft from another vault (nobody else was active), but it contradicts the invariant the design asserts and the same-transaction attack (3c.A6) is only one of two shapes.

**Evidence if I am right:** the suite runs the tick (3c.A4) and the join (3c.A5) but never asserts invariant 2 after a *subsequent* credit over a pre-tick backlog. A run of the six steps above would show V's canonical cbBTC ATA increasing by B while V's record's `debt_scaled` at join was 0 and the pool balance before step 5 was B. Reading `tick()` confirms it mutates only `last_distribute_at`, `dist_epoch`, `pending_this_epoch`.

**Fix:** cheapest correct fix is to restate the invariant as *"no vault is paid for revenue that was DISTRIBUTED before it joined"* (true by construction) and to tell holders that the first activation wave after an idle pool receives idle-pool revenue. If the stronger property is wanted, `join` must charge the joiner for the backlog it is about to inherit: `debt = w*acc + (backlog * w / w_new) * ACC_SCALE` where `backlog = balance − ceil_sats(owed_scaled)` read from the pool account `activate` already carries. That is a code change and must land before immutability.

## R3. THE LEVEL DRAW

No fault found in `blockhash_in_window`, `try_capture`, the FIFO, the reschedule, or the census arithmetic. The SlotHashes parse is fail-closed (key pinned, `n ≤ 512`, length checked, all-zero hash refused). A/B/C stride arithmetic is deterministic; C's worst-case slot is `reveal_slot + 214`, inside the 300-slot window. `reveal_level` is strictly `index == revealed_total`; a burned vault still draws and skips the Core write (L.11); the attribute list is hash-pinned and byte-bounded at mint so the reveal always fits (L.12). `check_supply` guarantees every minted vault has a draw (`minted_total < cap_total` and `total = cap_total − revealed_total > 0`).

Influences, restated: a **minter** can only try to lapse the window for a re-roll (needs the crank down AND zero protocol traffic for 300 slots) — accepted limit 25, as stated. A **crank operator** has no influence: capture, reschedule and reveal are permissionless, FIFO-blocked, and entropy-slot-independent at capture time; all they can do is stall the reveal lane, which anyone can resume. A **slot leader** — see the limits answer below.

## R4. GOVERNANCE

No fault found. `quorum_supply` and `index_snapshot` freeze the electorate and the bar at creation; `VaultTooNew` is checked against the live record's pinned index; the key-change supermajority (`ceil(50% of snapshot)`) combined with threshold 51% forces `cast ≳ 98%` of the snapshot, so a minority cannot carry it; `KeyChangesBundled` is enforced at creation and the per-kind marks (`last_round_id`/`last_guardian_id`/`last_arm_id`) move even when the action is skipped-as-already-over (3c.R1); `restart` is skipped half-by-half when the stop is newer, mirroring MINT's `StopIsNewer`; `tighten_sweep` is monotone and bounds-checked against the initialize constants in both GOV (at creation) and MINT (at execution). A proposal cannot be frozen forever: quorum can only become harder to reach (burns shrink the electorate but not the snapshot bar), and if every vault is gone there is nothing to govern (accepted limit 45).

## R5. THE CHARTER CLAIM

No fault found. Identity is by address against a domain-separated (0x00/0x01), sorted-pair Merkle root, proof length bounded at 16; the PoB is verified as a live AssetV1 in the pinned collection, owned by the signer, then CPI-burned in the same instruction; the window is two clock compares against constants no instruction writes; `pob_extra` accounts are never signers. A third party cannot claim (owner must own the PoB), cannot front-run (owner is bound to the burn), and cannot alter the proof (root is fixed). The PoB holder can claim once or transfer the PoB; the collection's hot wallet can mint lookalikes (refused by the root) or install a rejecting hook (accepted limit 46).

## R6. ONE-TIME CONFIGURATION

No new fault. `initialize` across all four refuses the dangerous classes (foreign/dirty collection, default treasury, non-reserve payment mint, out-of-range tighten bounds, Token-2022 reserve, mismatched sibling collection, zero root, over window). The residual — that `bank_treasury`, `pob_root`, the charter dates, `max_supply`, `level_caps` and the period/bound constants are accepted wrong-but-plausible and permanent — is exactly item 38, which is OPEN and stays open.

Worst case of the trusted hop, bounded as stated: `max_sweep_lamports` × cooldown windows until the guardian pulls `emergency_stop_sweep`, never more than the revenue PDA holds above `sol_reserve_lamports`, destination pinned, operator must sign, and the guardian can cancel a pending replacement. Royalties: R.5/R.6/R.6c prove on a control collection both ways that `PluginAuthority::None` is refused for update and removal even by the update authority, so "10% forever" is a Core property, not an instruction-list property. The rate limit is exactly the rolling ring described.

## R7. CROSS-PROGRAM RAW READS

Recomputed above; every offset matches. `read_mint_supply`, `read_burn_total`, `read_vault_index` and `read_stops` all pin address + owner + discriminator + version byte. No misread found.

## R8. THE SUITE AND THE SIMULATION

### R8.1 — LOW — the 9.13 negative fires for a different reason than the claim it supports

**Construct:** `tests/3prog.test.ts` arm 9.13 + its `because('9.13','custom program error: 0x0')`.

The arm claims to prove "a burned asset address is not re-mintable". The refusal actually reached is the **system program's `account already in use`** on the `VaultRecord` PDA that mint_vault would `init` at `["vault", asset]` — the record from the *previous* life already exists. Core is never asked. The `because` pins `0x0`, which is the right *code* for the wrong *cause*.

**Evidence if I am right:** run 9.13 without the `vault_record` account in the instruction (or against an address with no record) and the failure moves to Core/System on the tombstone; S9.2 in the simulation — a bare `create` at the burned address, no MINT record — is the arm that actually proves the claim. It has no `because` pin.

**Fix:** add a `because` for S9.2 in the simulation (Core/system on the tombstone, not a record PDA), and either rename 9.13 to "the record PDA blocks a re-mint" or rebuild it so the record is absent.

### R8.2 — no suite arm exercises the R2.1 counterexample

3c.A4 and 3c.A5 cover the tick and the join but nothing asserts the pool invariant after a later credit carrying a pre-tick backlog. P.32 checks `bal ≥ owedCeil` at one instant; it does not check whose revenue paid whom. Add an arm: split → request → due → tick → join → distribute → claim → assert the joiner received 0 of the pre-split amount.

Arms that cannot fail: none found that I can disprove. The precondition arms (`3c.K2p`, `D.0`, `RL.6`, `P.8a`, `3c.F0`, `IN.1p`, `8.7p`) all assert the state they need and fail red if it is absent, which is the right shape. `RL.2`'s `Promise.all` burst is timing-dependent but the ring is written before the next read in-slot, so the count is exact regardless of ordering. The negative-code extraction from `BURN_SRC` for `RL_CODE` is brittle (regex over source) but it is a test-harness read, not a program read.

---

## HOLDER-GUIDE.md promises the code does not keep

### HG.1 — MEDIUM — "Payouts arrive in your vault every month" is not guaranteed by the code

**Construct:** HOLDER-GUIDE "How you get paid" ("Payouts are credited to your vault at least once a month", "Payouts arrive in your vault every month") vs `monthly_inline`.

`monthly_inline` fires only when a host transaction (`mint_vault`, `claim_charter_vault`, `activate`, `claim`, `retire_redeemed`) lands while the period is due. A month with **no protocol traffic** distributes nothing. The free `distribute` path is permissionless but someone must call it. The crank is the layer that is supposed to call it, but the crank is off-chain, installed DRY-RUN, and outside the programs. The honest list names the frozen-pool exception and not this one.

**Evidence if I am right:** accepted limit 36 states exactly this ("a month with NO protocol traffic distributes nothing until someone calls `distribute` or the next host lands"); the guide contains no sentence carrying it. A run with the crank stopped and no traffic shows `last_distribute_at` frozen across a period boundary with `CBOB_DISTRIBUTED` never logged.

**Fix:** add to the honest list: *"Payouts are triggered automatically; if there is no activity on the protocol and the payout job is down, a payout can be late until anyone calls one (it is free) or the next transaction lands."*

### HG.2 — LOW — "it joins the payouts at the next distribution and earns from every one after that"

Ambiguous against the two-step rule. The vault is **excluded** from the distribution that follows its request and earns from the one after. "Joins the payouts at the next distribution" reads, to a holder, as "is paid in the next one". The later sentence ("A vault activated since the last payout has not joined yet, so this does not help it") is right but comes in a different section. Reword to: *"it is placed on the schedule after the next payout and earns from the one following that."*

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated? — YES: limit 26, in impact and in probability.**

The spec says C's leader "can **bias** ONE vault's draw within one slot's time." Bias understates it. The draw is `sha256(hA‖hB‖hC‖asset)[0..8] mod remaining`. C's leader, knowing hA and hB, varies its block contents to search over hC. A 400 ms slot is enough to enumerate astronomically many candidate blocks; hitting any single level in the census takes tens of expected tries. That is not "bias", that is **choice** of level for any vault whose C slot that leader holds — and C's leader holds roughly its stake share of all vaults.

Worse, the accepted text says the stride of two groups exists because "one validator was measured holding two adjacent rotations." Stride 2 does not remove the repeat case; it makes B and C (groups N and N+2) the pair most likely to be the same validator as A and B. If a single validator holds B and C, it controls **64 bytes** of hash input, which is not search — it is assignment. The document should read: *a validator that holds C's group, and more so one that holds B's and C's, can choose one vault's level outright; this is per-vault and proportional to its stake; a VRF is the only answer.*

**2. Is any listed limit not actually a limit? — NO.** Each item 6–49 is a real, reachable cost. Limit 35 is correctly self-described ("never binds at the ruled numbers") and correctly parked as a floor for other parameterizations.

**3. Is any DISCHARGED item not actually discharged? — NO.** 12/17 is measured on the artifact with a live regression ceiling (10.2a additionally pins that the packet, not the probe, stops the pad); 14 is refused on chain (11.4); 19 is closed by construction (`activate` requires `NotRevealed` to be false and the payout reads `VaultRecord.level`); 30/31/33 are gone or exercised. The Bank family went with the Bank.

**4. Is any OPEN AND BLOCKING item being quietly accepted? — NO, with one flag.** 22, 38 and 50 all read as genuinely open. **But 50 carries the sentence "Gary may rule otherwise."** That is the demotion lever, and it must not be pulled silently: items 9 and 44 currently have *zero* preventive control without the redeem page, and HOLDER-GUIDE promises both the page and the public post. If Gary rules it away, the holder guide must lose those sentences in the same commit, and items 9/44 must be restated as having no pre-signature control at all.

---

## Anything else

- **Liveness of the reveal FIFO** is delegated to `reveal_level` being called by *someone*. On-chain `crank()` captures/reschedules but never reveals. If the off-chain crank dies and no one else calls `reveal_level`, the queue stops at the head vault even though its entropy is captured and anyone could land it. Not a safety fault and the alarm pages (`reveal_rescheduled` covers the *reschedule* case, not the *captured-but-never-revealed* case). Consider adding a `reveal_rescheduled`-style alarm on `revealed_total` stalling while `entropy_set` records are queued.
- **`distribute`'s `w==0` branch errors `NoActiveVaults` when `pending_this_epoch == 0` and there is nothing to do.** Harmless, but the error name will mislead an operator reading logs.
- **`claim` demands `dest.key() == r.vault_ata` even for a still-waiting vault it will not pay.** A wrong `dest` on a pending pair reverts the whole batch for no reason. Move the check inside the paying branch or the `join` branch.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What AI audit structurally cannot do here, and what must be done before launch anyway:

1. **Run the system against a live cluster under load (item 22).** Nothing in this review or any AI review can substitute for the mainnet dress rehearsal: throwaway program ids, ~2,100 vault records, the crank's every-minute reveal lane keeping up, a transient RPC failure on vault 1,900, the alarm's signature walk against a genuinely busy program. Every prior "this fits / this will page / this retries" claim about the pipeline is untested against latency and failure.

2. **Build and exercise the surfaces the holder guide promises (item 50), or delete the promises.** `judgeRedemptionCoverage` with no page is the only thing standing between a holder and the destruction of an undeclared asset (items 9 and 44). Build the redeem page and send the posts, or cut those sentences from HOLDER-GUIDE in the same commit. A guide sentence is a promise to a person; immutability does not make it less false.

3. **Set every `initialize` value from `launch/mainnet-init.json` with a second human reading the file aloud while the transaction is signed (item 38).** The checker refuses an OPEN value but cannot know whether the ruled value is the *right business decision*. Specifically close the two OPEN entries (charter dates, swap operator key) and turn the three PROPOSED sweep values into RULED ones — and have someone who is not the signer verify the four initializes landed the numbers on the checker's output before the upgrade authority is dropped.

4. **Fix R2.1 before immutability, or change the invariant in writing.** An accounting claim the code does not implement is the kind of thing a holder discovers later, and after the authority is gone there is no correction.

5. **Red-team the two hot keys operationally, not just the programs.** The guardian (Gary's wallet, Phantom) and the swap operator are single keys with irreversible consequences if leaked. AI review cannot test key custody. Do a tabletop: "the operator key is leaked at 03:00" — who notices (alarm cadence?), who reaches the guardian wallet, how fast is `emergency_stop_sweep` pulled, and what is the maximum SOL in the revenue PDA at that hour? Record the answer as an operational limit, not a code one.

6. **Test the real user path with real wallets and a real marketplace listing.** Does Phantom sign the redemption pair? Does a marketplace escrow (a known off-curve owner case, item 43) appear in listings, and does `detectNestedVaults` fire on it before a holder lists? Does the claim page fit `pob_extra` + depth-8 proof + compute-budget instructions with no crank (3c.P1) when the Moments collection actually carries the Oracle? None of this is exercised by the suite.

7. **Disclose the governance concentration as a fact to buyers before minting.** The largest PoB wallet at 17.1%, with 15% of PoBs unclaimed, carries an ordinary proposal at quorum 21% / threshold 51%. That is a design consequence of Gary's ratios and the charter allocation, not a bug, but a buyer deciding whether to put Bitcoin into a vault is deciding under it. A page nobody reads is not disclosure.

8. **Verify the deployed bytes and the lock with a person who is not the deployer.** `build-mainnet.sh` prints the sha256; someone else must compare it against what `solana program show` reports on mainnet, for all four programs, and must confirm all four read `Upgrade authority: None` *before* the first mint transaction is signed. The order (deploy → verify → initialize → lock → mint) must be written down as a checklist and ticked by two people, because AI cannot witness a deployment.