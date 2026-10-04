# Round 23 audit (v6 whole tree, including $CBOB boost)

No CRITICAL. One MEDIUM in the new boost path (built after round 22). Several LOW / evidence-gap items. Offsets, pairing, and pool solvency were recomputed from the structs; they match the pinned readers.

Evidence rule used below: a claim is only a finding if a concrete on-chain trace or a suite arm could show it.

---

## R1. Custody

No path found that lets anyone but the owner take value out of a sealed vault, or that lets a thawed vault commit.

Pairing is top-level, both directions, asset **and** owner at fixed indices (SEAL `BURN_IX_ASSET_IDX=0` / `BURN_IX_OWNER_IDX=2`, BURN the mirror). `load_instruction_at_checked` does not see inner CPIs. `retire_redeemed` additionally requires stack height `TRANSACTION_LEVEL+1` and a top-level `burn_vault` for the same asset. Emptiness still refuses delegates, close authority, Token-2022 extensions, PDA lamports ≠ 0, and declared nested `AssetV1`. Undeclared holdings remain destroyed (accepted 44 / 9).

**If this were wrong on chain:** a tx that opens A and burns B, or opens without a later matching burn, would land; suite 3.6–3.11, 4.10, 9.0 already refuse those. A thawed-and-still-live vault would show `permanentFreezeExecute.frozen === false` after a failed/missing burn; 3.11a shows the vault still full and the open reverted.

No new R1 finding. Round 22’s F12 tie repair (`sales_stopped_at < proposal_created_at` in MINT, `>=` skip in GOV) is consistent and does not loosen pairing.

---

## R2. Community pool

Invariant “pool ≥ ceil(owed)” holds by construction of `credit` (`delta = avail*SCALE/w`, `owed += delta*w ≤ avail*SCALE`) plus claim/retire subtracting exactly what they remove from vaults. Join still sets `debt = w*acc`, `carry = 0`, so a vault is not credited for a distribution that ran before it joined. Unsplit revenue in the **revenue** address is accepted 55, not this invariant.

Counters: `join` only when `dist_epoch > request_epoch` (so it never touches `pending_this_epoch`, which `advance_epoch` already zeroed). `retire` of a pending vault decrements `pending_this_epoch` only when `request_epoch == dist_epoch` (F21). `waiting_to_join = pending_count - pending_this_epoch` then matches. Burn-path `distribute` cannot tick an empty schedule (`NoActiveVaults`).

**If this were wrong:** P.32 would fail; F21.1 would show `pending_count`/`pending_this_epoch` not dropping by 2; 3c.A6a would pay the activator from the backlog.

No new R2 money finding.

---

## R2b. $CBOB boost (least-audited)

Accounting for N distributions, carry across reweigh, and ring/due/active agreement is consistent:

- `end = dist_epoch + epochs`; `credit` then `advance_epoch`; due iff `dist_epoch >= end`; `BoostsExpireFirst` blocks the (N+1)th credit; expire/`claim`/`retire` all go through `unschedule_boost` with the same `>=` vs ring split.
- `reweigh` moves `owed_of` into `carry` and resets `debt = new_w*acc`; `owed_scaled` unchanged.
- Max epochs 63 vs ring 64, so live end-epochs cannot alias. `expire_boosts` does not need the ATA.

Suite BO.7c / BO.10 / BO.11 / BO.14 / BO.15 / BO.16–17 / books() support that. **Not exercised:** boost and `distribute` in the same transaction; superseded `SetBoostTerms`; ring wrap at epoch 64+.

### MEDIUM — Gifted boost permanently occupies the one slot (N distributions)

**Construct:** `boost_vault` in `programs/cbob-vault-mint/src/lib.rs` — no owner check; `require!(r.boost_weight == 0, BoostActive)`; `expire_boost` / `expire_boosts` refuse unless `dist_epoch >= boost_end_epoch` (BO.10b: early expire is a no-op). Terms are whatever the last vote set, inside `max_boost_weight` / `max_boost_epochs` (launch: 12 and **24**).

**Gain:** Anyone who can pay `boost_price` can lock **every** activated vault’s only boost slot for up to `boost_epochs` distributions. The victim cannot replace it, cannot expire it early, and a later vote that turns boosts off does not cancel live ones (“keeps the terms it was bought under”). DESIGN/HOLDER-GUIDE call a gift “harmless” because it “only ever adds to the vault’s share.” That is false for the slot: a 1-weight, 24-epoch, cheap-price term set (legal at create and at execute) is a cheap lock against a later, larger self-boost. Dilution of others is paid in $CBOB (intended). The lock is not.

**Evidence if true:** After Bob’s `boost_vault` on Alice’s vault, Alice’s `boost_vault` logs `BoostActive`; `expire_boosts` on that record before `boost_end_epoch` leaves `boost_weight` unchanged; `dist_epoch` must advance `boost_epochs` times before she can buy her own. BO.9 allows the gift and never tries the owner’s second buy on **Y**.

**Fix:** Require the vault owner (or a delegate they signed) as burner; **or** allow the owner to expire/replace early; **or** allow a new boost to overwrite remaining epochs. Do not keep “anyone may gift” and “one boost at a time” and “no early expire” together under long `max_boost_epochs`.

### LOW — `claim` runs `monthly_inline` before it expires due boosts

**Construct:** `claim`: crank → `monthly_inline` (returns if `boosts_due > 0`) → pair loop (`expire_boost`). A claim that clears `BoostsExpireFirst` will **not** run a due month in the same instruction. Next host can. Crank is documented to expire first, then distribute. A holder page that folds “expire + monthly” into one `claim` will skip the month (BO.13 only checks a claim of an **unboosted** vault while due boosts exist).

**Evidence if true:** logs show `CBOB_MONTHLY_WAITS_FOR_BOOSTS` on a `claim` whose pairs included a due boost, and `last_distribute_at` unchanged, while `boosts_due` is 0 at the end of the same ix.

**Fix:** Expire due boosts in the named records (or call the same helper as `expire_boosts`) **before** `monthly_inline`, or retry monthly after the loop if `boosts_due` hit 0.

---

## R3. Level draw

FIFO, burned-head still draws (L.11), reschedule to `now+16` only after the window, SlotHashes parse fail-closed, attribute re-supply hashed. Residual grind is **not worse** than SPEC 25/26 as round 22 restated: capture on hosts is optional; C is the first produced slot of a group (skip stays with that leader); same-slot cohort shares `(hA,hB,hC)`. DESIGN-v6 still says a lapse “needs a crank outage AND no protocol traffic” — that sentence is false of the code (SPEC 25 already corrected it). Doc only; do not re-open 25 as a program bug.

---

## R4. Governance

No path for a minority to move the 85/15, destinations, `max_supply`, or a vault. Key changes still need YES from half of snapshotted live supply and cannot share a proposal. Overtaken actions skip (`CBOB_ACTION_SKIPPED`). `SetBoostTerms` is ordered like a round (`last_boost_id`) and bounded at creation against MINT’s fixed max. Freeze-forever remains accepted 45 (no live vault ⇒ no proposer).

### LOW — `TooManyActions` text is wrong

`MAX_ACTIONS = 5` (one of each kind, including `SetBoostTerms`). Error still says “at most four actions”. Not exploitable; it will mislead the first failed 6-action proposal.

---

## R5. Charter claim

Identity is address ∈ `pob_root`, domain-separated sorted Merkle, CPI burn as owner, window from `initialize` only, `pob_extra` forced non-signer. Hot-wallet rejecting hook still bricks the window (accepted 46). Lookalike in the same collection is `NotInPobSet` (C.8). No new hole the docs do not already accept.

---

## R6. One-time config, royalty, cap, swap hop

Royalty: collection plugin authority `None`; control collection proves UpdateAuthority **can** rewrite, None **cannot** (R.5–R.6c); owner cannot add asset-level royalties (R.8). Cap: 64-slot timestamp ring, `k = min(cap, 64)`, refuse unless `now - kth >= window`; same-second extra redemptions fail closed (`checked_sub`). Swap operator worst case remains accepted 10 (cap × cooldown windows until guardian stop). Wrong `initialize` values remain OPEN 38 / 51 (`cbob_mint` still null in `launch/mainnet-init.json`).

SEAL `assert_classic_spl` only checks `owner == Tokenkeg`, not “82-byte initialized mint”. Gary is `INIT_AUTHORITY`; a mistaken token **account** as a reserve would brick burns. That is 38’s class, not a new bypass.

---

## R7. Cross-program raw reads

Recomputed from the structs (disc + version first, append-only):

| Field | Offset | Readers |
|---|---|---|
| MintConfig.version | 8 | GOV, BURN |
| collection | 9 | GOV |
| governance | 41 | GOV |
| minted_total | 141 | GOV, BURN |
| sales_stopped / sweep_stopped | 191 / 192 | GOV |
| sol_reserve / max_sweep / cooldown | 257 / 266 / 274 | GOV |
| charter_closes_at | 442 | GOV |
| bare_burns_retired | 454 | GOV, BURN |
| sales_stopped_at / sweep_stopped_at | 518 / 526 | GOV |
| sweep_floor / cooldown_ceil / reserve_ceil | 631 / 639 / 647 | GOV |
| max_boost_weight / max_boost_epochs | 711 / 712 | GOV |
| VaultRecord.mint_index | 41 | GOV |
| BurnConfig.burned_total | 42 | GOV |

`MINT_CONFIG_VERSION = 6`, `VAULT_RECORD_VERSION = 4`, `BURN_CONFIG_VERSION = 4`, `SEAL_CONFIG_VERSION = 2`. Space constants match (VaultRecord 221 = 211 + 10 padding; MintConfig 1005 + 256 padding). SPEC’s prose still says MintConfig v5 / VaultRecord v3 in one place; **offsets of old fields did not move**. No silent misread in the programs.

---

## R8. Suite / sim as evidence

Round 22’s un-failable arms (X.7, RL.1, 6.17, F18, F19, F21) are repaired and now able to fail.

Still missing, for claims this prompt treats as in-scope:

- Boost + `distribute` in **one transaction** (both orders).
- Owner `boost_vault` after a **gift** on the same vault (`BoostActive`) — BO.9 does not do this; it is the MEDIUM above.
- Older `SetBoostTerms` executed after a newer one (`CBOB_ACTION_SKIPPED`).
- Boost ring wrap (`dist_epoch % 64` reuse after 64 epochs) — suite `monthly` is 150s, BO uses 2 epochs, never wraps.
- Sim (`sim/test-vault.ts`) never calls `boost_vault` / `expire_boosts` / `SetBoostTerms` against real cbBTC/$GARY.
- CPI-wrapper test of `retire_redeemed` stack height (round 22 already asked; still absent).

`because()` does pin BO.2/4/5/6/8/12/19. Those arms are real.

---

## Accepted limits — four questions

1. **Worse than stated?** No. 25 and 26 as round 22 rewrote them match the code (optional crank accounts; C stays with that group’s leader on skip; same-slot cohort). Gift-boost slot lock is **not** in the list; it is new (see R2b).
2. **Listed as a limit but closed?** No. 27 (claim doesn’t check live), 28 (frozen vault ATA blocks the whole redemption), 43 (off-curve owner), 44 (undeclared destroy) still match the code.
3. **Discharged but not?** 12/17 (mint CU vs packet) still holds for mint. 54 correctly moved piggyback-crank CU to OPEN. 33 (notice) is exercised (3c.K5, 3c.G2).
4. **OPEN treated as accepted?** No. 22, 38, 50, 51 (`cbob_mint` + bounds in launch file), 52 stay OPEN. 50 still means HOLDER-GUIDE’s redeem-page warning and public X/website post are promises the tree does not keep.

DESIGN-v6’s draw paragraph still claims lapse needs “crank outage AND no protocol traffic.” That is the pre-round-22 25 text. SPEC is the one that was corrected. Do not freeze DESIGN as if it were SPEC.

---

## Round 22 repairs (first target)

| Repair | Verdict |
|---|---|
| F12 stop/restart same-second | Fixed at both sites; stop wins. Does not brick a restart voted **before** the stop. |
| F18 NO votes / threshold | F18.1/F18.2 can fail. |
| F19 entropy re-derived from SlotHashes | L.3c can fail. |
| F20 X.7 / RL.1 / 6.17 / reasons | Honest or pinned. |
| F21 pending retire counters | Both counters, both burn shapes. |
| F1 unsplit revenue | Accepted 55, in the holder honest list. Not silently “fixed.” |
| Off-chain 27 defects | Not re-read here (those files were not in this bundle). |

No round-22 program repair was found to have reintroduced a money or unseal bug. The new defect is in code that **did not exist** at `fa417ce` (`d678806` boost).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Do these things AI review structurally cannot, before the upgrade authority is removed:

1. **Run the crank against a live cluster at ~2,100 vaults** (OPEN 22). A local 50-vault suite cannot show RPC paging, a failed claim on vault 1,900 poisoning a 14-wide batch, or the every-minute reveal lane falling behind. That is the first time `owed_scaled` and `boosts_due` meet real latency.
2. **Build the redeem page and actually send it** (OPEN 50). v6 deleted the only pre-sign coverage check. Until `judgeRedemptionCoverage` runs in the wallet flow, accepted 9 and 44 have **zero** preventive control. Measure a 3-mint redemption with claim + destinations created in a **prior** tx (42), and a compute-budget ix on any host that carries a crank (54).
3. **Fill `launch/mainnet-init.json` until `check-launch-params.mjs` is green with nothing OPEN** — especially `cbob_mint`, charter open time, `lock_deadline`. Then run `scripts/build-mainnet.sh` and keep the printed sha256; the suite binary is `--features localnet` and is **not** the shipped bytes (measured fact 8).
4. **Add three boost tests on a validator, not in this prompt’s reasoning:** (a) Bob gifts Alice, Alice’s `boost_vault` is `BoostActive` until `boost_epochs` distributions; (b) `boost_vault` then `distribute` in one tx, and the reverse, checking N not N+1; (c) 64 empty epoch ticks then a live boost’s ring slot. If (a) is the product, write it into HOLDER-GUIDE before lock; if not, change `boost_vault` before lock. After immutability you cannot.
5. **Second clean round on a frozen tree with a different model roster** (ship gate 3). This round is one reader. Agreement with myself is not independence. Freeze `programs/`, `bank/`, `scripts/` first or the counter stays 0.
6. **Dress rehearsal via `scripts/rehearsal-tree.sh` with small real cbBTC**, guardian stop, one real `sweep_sol_for_swap` round-trip, and one real 100 $GARY burn distribution. Item 53 only proved the **suite** at throwaway ids, not the money cron against mainnet.

Do not remove upgrade authority until 1, 3, 4(a–c), and 50’s redeem warning exist. A surviving boost-slot or crank-batch bug is then permanent and has no guardian brake (stops do not reach the pool).