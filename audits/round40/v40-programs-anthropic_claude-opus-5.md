# Independent audit — v6 tree as bundled (round 40)

**What I did.** I read all five programs line by line, recomputed every cross‑program offset and every `space` constant from the struct definitions, re‑derived the pool/boost/rate‑limit arithmetic, and read `web/src` (the four holder pages, the ceremony, the planners, the readers, the RPC proxy, the metadata generator) against the programs and against the suite's instruction builders. I re‑read round 39's two verdict items and traced both repairs to their sites.

**What I did not do.** No validator, no network, no `run-tests.sh`, no `web/test/e2e-localnet.sh`, no alarm/crank/revenue job. Every claim below is either (a) a read of the bundled source, (b) arithmetic I performed, or (c) an explicit request for a measurement, labelled as such. Where a measured run in the bundle contradicts a line of reasoning I had, I dropped the reasoning and say so.

**Result: 0 CRITICAL, 0 HIGH, 2 LOW, 4 INFO.** Nothing I found moves value out of a vault, the pool or the revenue address, and I found no new defect in the five programs. The two LOW findings are a process gap and an unmeasured compute boundary; both are in reach of a one‑line fix.

---

## R0. Round 39's verdict, and its repairs

### V39-1 (MEDIUM: a promised stray silently dropped at the press) — **repair holds**

The repair is in three places and each one is load‑bearing:

1. `reads.mjs:vaultWalletAccounts(conn, owner, reserveMints, promised)` now builds
   `byAddress = [...reserveAtas, ...promised.slice(0, PROMISED_MAX)]` and reads them with `accounts()`, which is wrapped in `wrap()` → a failed read **throws** `ReadError` rather than returning a short list. So a press‑time listing failure can no longer hide a promised account: it stops the press with the read error, before any dry run.
2. `plan-redeem.mjs` adds the missing‑promise check:
   ```js
   if (s.known) for (const k of s.known)
     if (!s.pdaTokens.some(t => t.address === k)) cannot.push({ address: k, text: '…no longer there…' })
   ```
   which produces a `lost:<addr>` box.
3. The demotion guard `aboutKnown(a) = s.known?.has(a.id.split(':').slice(1).join(':'))` makes that box exempt from the standing consent, so `prepareOpening` returns `stop: 'ack'`.

I checked the three ways the box can be reached and all three are now covered: the account is gone; the account is unreadable (`!acc.parsed` → `cannot` with the address); the account is no longer movable (`undeliverable()` → `cannot` with the address). In each case the id's suffix is the address, so `aboutKnown` is true and the press stops. `PROMISED_MAX = 100` is safely above the real bound on `known`, because `known` is only the strays that *fit* the 1,232‑byte redemption (a handful); dropped ones get `left:<addr>` boxes instead and are not in `known`.

I also checked the *inverse* regression the repair could have introduced — that a stranger who lands accounts before the press can now stop the send. They cannot: the only non‑demotable boxes are `forfeit` (needs Coinbase to freeze the pool) and boxes whose suffix is in `known`, and `known` can only be made undeliverable by (i) the token's issuer freezing it, (ii) the holder's own receiving account being frozen, or (iii) the dry run dropping it — none of which a stranger can cause for an unfreezable mint, and a freezable mint is never promised in the first place (`undeliverable()`'s freeze‑authority rule). For a *reserve* mint stray the page exempts the freeze rule, but then a frozen holder ATA is a refusal by design and only Coinbase can cause it.

### V39-2 (LOW: a nested CBOB vault refused the opening) — **repair holds**

`plan-redeem.mjs` no longer pushes a refusal for `n.ourVault`. At the check it pushes an **optional** prior group (`rescue_nested` → `bank_treasury`) plus a note; at the press (`s.noPrior`) it pushes a `pressInfo` line and nothing else. `redeem.mjs` treats an optional group's simulation failure and send failure as a note and continues (`if (sim.err && group.optional) { …continue }`, and the send is wrapped so a throw on an optional group is also a note). `prepareOpening` stops on `plan.prior.length`, and at the press `noPrior` keeps the rescue out of `prior`, so a vault landed between check and press cannot stop the send.

I confirmed the programs permit the follow‑up path the repair relies on: `rescue_nested` accepts a **burned** host (`is_burned`), so an inner vault left behind when the host burns is still extractable (arm R35.N5; SPEC item 58). So the refusal really was protecting nothing.

### Round 39's rejected claims — re‑tested, and I agree with the rejections

* **W1 (`txread.mjs` rejects `transferCheckedWithFee`).** Re‑read: the amount/account checks apply to the exact list `['transfer','transferChecked','approve','approveChecked']` (`txread.mjs`), not to a prefix. `transferCheckedWithFee` is not in it. The rejection is correct.
* **W2 (a delegated stray cannot be moved by the helper).** Correct rejection on the suite's own evidence: arm 3.3 drains a reserve ATA with the **owner** as authority while a delegate is planted, and is refused only later by BURN with its reason pinned to `ReserveDelegated`; arm 3.3a is a measured ALLOW for the same delegate plus the owner's transfer and close. SPL Token never requires the delegate's signature for an owner transfer.
* **W5 (SBPFv3 on mainnet).** Not independently re‑measurable from this bundle; I note only that no v3 *instruction* has executed on mainnet (the placeholder refuses everything), which item 22 already covers.

---

## R1. Custody: can anyone but the owner get value out, or an emptied vault survive?

I attacked the pairing, the emptiness proof and the thaw, and found nothing new. The specific constructions I checked and why each fails:

| attempt | result |
|---|---|
| SEAL open reached by CPI, genuine top‑level burn | SEAL's `load_current_index_checked` returns the **wrapper's** index, so SEAL's forward walk can succeed — but BURN's backward walk finds no SEAL instruction and refuses `NoPrecedingOpen` → whole transaction reverts. Measured WR.3. Fail‑closed. |
| genuine open, burn by CPI | SEAL refuses `NoTerminalBurn` (the top‑level instruction is the wrapper). Measured WR.2. |
| two vaults, borrow the other's half | both halves bind account 0 (asset) **and** account 2 (owner) in both directions; positions pinned by `BURN_IX_{ASSET,OWNER}_IDX` and `SEAL_IX_{ASSET,OWNER}_IDX`, each asserted against the derivation in the suite (3.1a–3.1f). |
| forge a "SEAL open" entry in the sysvar | impossible: the instructions sysvar reflects the real message, and every instruction in a transaction must succeed, so an open that appears in the message definitely thawed and a burn that appears definitely ran. |
| thaw and end the transaction unburned | the burn is in the message and must succeed (`lamports == 0`, every declared reserve empty); any failure reverts the thaw. |
| allocate data at the deposit address so `lamports == 0` can never hold | **unreachable.** The only way to make the asset‑signer PDA sign a System `Allocate`/`Assign` is Core `ExecuteV1`, which needs a thawed vault, which needs a paired burn in the same transaction — and that burn then fails on `lamports != 0`, reverting the allocation. I had this as a candidate finding and withdrew it. |
| deposit lamports into the PDA after the sweep, before the burn | BURN reads `asset_signer.lamports()` at its own execution, so it sees the deposit and refuses. Fail‑closed. |
| undeclared token account / foreign NFT | invisible to BURN; destroyed. Accepted limits 9/44, and the page names it. Not re‑filed. |
| Token‑2022 ATA for a classic reserve mint | the ATA program refuses it (measured F4.2), so that derivation can never hold value; BURN skips the non‑existent account because its owner is not a token program. |

`retire_redeemed`'s caller proof is sound: stack height exactly `TRANSACTION_LEVEL_STACK_HEIGHT + 1` **and** the current top‑level instruction is BURN's `burn_vault` **and** its account 0 equals the asset MINT is retiring, which MINT re‑binds to `vault_record.asset` through the seeds constraint. Measured P.23 and WR.1.

---

## R1s. The sweep helper

**(a) Reachability.** Directly it needs the asset‑signer PDA's signature, which no key holds (SR.1). Through Core it needs `ExecuteV1`, whose approval set on this pinned binary is measured: owner yes (SR.5d control), stranger no (SR.5, `0x1a`), owner‑added transfer delegate no (SR.5a), collection update authority no (SR.5c on a control asset), and CBOB's collection authority is MINT's off‑curve PDA with no Execute CPI anywhere in MINT (SR.5b). Outside a redemption the vault is frozen, so Core rejects the Execute (3.7 / S6.2). I re‑read MINT's five Core CPIs (create, AddCollectionPlugin, UpdatePlugin, BurnV1, TransferV1) and confirmed none adds an external plugin adapter, which is the one route that could widen the approval set.

**(b) The pair list.** I enumerated the aliasing cases:
* `src == to`: `src_owner == signer` and `to_owner == dest`, and `signer != dest` is enforced, so refused.
* a destination used as a later source: a destination is owned by `dest`, a source must be owned by `signer`; refused.
* the **same source twice**: the first iteration closes it; spl‑token's `close_account` assigns the account to the System program and reallocs to 0, so the second `read_token` fails on `*a.owner != SPL_TOKEN_ID` → `IllegalOwner`. SR.12a pins exactly that, and SR.12b asserts it was *not* the first guard that fired — a good negative pin.
* native wSOL source: `close_account` permits a non‑zero balance for native accounts; the transfer moves wrapped lamports, the close returns the reserve. Works; the destination must be a wSOL account of `dest`.
* delegate present: irrelevant (the owner is the authority). Foreign close authority: the close reverts the whole call (R36.C5), which is why the page uses a plain transfer for those.
* frozen source with a balance: the transfer reverts the opening (SR.14). Frozen at zero: close only (measured round 30).
* odd or zero pair count: `(len-4) % 2` refuses odd (SR.7); zero pairs is the lamports‑only sweep (SR.13).
* `dest` = another vault's asset‑signer PDA: **permitted**. It is the owner's own choice (the owner is the only party who can drive Execute), and the redeem page always names the owner. Worth keeping in mind only as a client obligation, which item 50 already states.

**(c) Destination checks.** Because (a) restricts the caller to the owner, not comparing `dest` to the asset owner is safe. A lamport credit to a non‑existent, non‑rent‑exempt destination is refused by the runtime's rent‑state rule; item 50 already records this and names the owner (who pays the fee, so exists) as the canonical destination.

**(d) The lamport sweep.** `signer.lamports()` is read at execution; BURN re‑reads it at its own execution. The only way to make it non‑zero afterwards is a later instruction depositing, which BURN then refuses. SR.4a is a good arm: it pins the *exact* lamport delta (stranger's gift + prior wallet balance + released account rent + asset rent − fee) and cross‑checks the helper's own `CBOB_SWEEP lamports=` line.

**(e) Interaction with BURN.** The closed account passes for the right reason: after the close the account's owner is System, so BURN's reserve loop hits `if acc.owner != TOKEN && != TOKEN_2022 { continue }` — i.e. it is skipped, not inspected, which is the same branch a never‑created ATA takes. Declaration of all six derivations is still required, which is why the prior transaction must create missing vault reserve accounts; the page does (`priorIxs.push` for any missing reserve, and `stop:'prior'` at the press if one is still missing).

**(f) Does it fit.** S8.0's assertion is `B <= 1232 - 52 - 96`, i.e. it reserves room for both compute‑budget instructions and a separate fee payer. The *actual* page uses neither (owner is fee payer, no CB instruction), and the e2e records 1,152 bytes with four C5 transfers. A fourth reserve is impossible (`MAX_RESERVE_MINTS = 3`, asserted equal in SEAL and BURN, 9.15/9.16). The in‑line monthly run costs no extra account on the redemption path (BURN already carries the pool). So the measurement covers the real shape with margin. **The one thing S8.0 does not cover is compute — see LOW‑2.**

**(g) Evidence.** SR.0–SR.14 are genuine, and the reason pins are specific (`invalid instruction data`, `insufficient account keys`, `incorrect program id` ×2, `invalid program argument`, `Provided owner is not allowed`, `invalid account data`, Token `0x11`). I did not find an arm that cannot fail. The helper's bytes are triple‑compared in `build-mainnet.sh` (dist ↔ localnet rebuild ↔ `target/deploy`, the file the suite and sim actually deploy), which is the strongest form available for a program with no key.

---

## R2. The community pool's money

**The invariant holds.** I re‑derived it:

* `credit`: `delta = floor(avail·S/w)`, `owed += delta·w ≤ avail·S`, and `avail = balance − ceil(owed_before)`. Since `ceil((a+b)/S) ≤ ceil(a/S) + ceil(b/S)`, we get `ceil(owed_after) ≤ ceil(owed_before) + avail = balance`. So `pool ≥ ceil(owed)` is preserved.
* `claim`: pays `floor(pending/S)` whole sats and reduces `owed` by exactly `pay·S`; both sides fall by the same integer.
* `retire`: `owed` falls by the full `pending`, balance unchanged.
* `monthly_inline` uses `saturating_sub`, so a (hypothetically) short pool degrades to `avail = 0` rather than reverting a host; `distribute` uses `checked_sub` → `PoolShort`. Correct split of behaviour.

Overflow headroom: `acc` is bounded by `total_sats·S / min_weight ≈ 1e27`, times max weight 18 ≈ 1.9e28, well inside u128.

**Counters.** `pending_this_epoch` is reset by `advance_epoch` and decremented by `retire` only when `request_epoch == dist_epoch`; `join` decrements `pending_count` only, and only when `dist_epoch > request_epoch` (so the vault is not in `pending_this_epoch`). Therefore `pending_this_epoch ≤ pending_count` always and `waiting_to_join` cannot underflow by construction, with `checked_sub` as a backstop. `active_count` and `total_active_weight` move only in `join`, `reweigh` and `retire`, in matched pairs. `join`'s unchecked `LEVEL_WEIGHTS[r.level - 1]` is safe because `activate` refuses `level == 0` before setting `pending`, and `level` never resets.

**Liveness.** Every gate has a free, permissionless opener: `JoinWaitingFirst` → `claim` naming the record (the join branch compares only the *address* of `vault_ata`, so it works even if that account were unreadable); `BoostsExpireFirst` → `expire_boosts`, which needs only records. The one state where no distribution can run is `total_active_weight == 0 && pending_this_epoch == 0` — i.e. nobody active and nobody who asked this epoch — and a single new `activate` re‑enables the tick on the next host. I could not construct a griefing input that makes distributions or redemptions impossible for others.

**W11 / SPEC's weaker rule.** I attacked SPEC's wording ("a vault is never credited by a distribution that ran before it joined") rather than the stronger one, and it holds: `join` sets `debt = w·acc` at the accumulator as it then stands, so every earlier distribution is excluded exactly. The remaining edge is unsplit revenue (limit 55), which I re‑derived and confirms at the stated cost (one burn at the monthly boundary, two otherwise).

---

## R2b. The $CBOB boost

**A boost earns exactly N distributions.** Purchase at epoch `D` with `n ∈ [1, 63]` writes slot `(D+n) % 64`; `advance_epoch` into epoch `E` drains slot `E % 64` into `boosts_due`. The slots in flight are `D+1 … D+63`, which are 63 distinct residues, and `D % 64` was drained on the way into `D` — so no live end‑epoch can share a slot with another. `MAX_BOOST_EPOCHS_BOUND = BOOST_RING - 1 = 63` is correct and conservative (even 64 would be safe; 65 would not). Because no distribution runs while `boosts_due > 0`, `dist_epoch == end` whenever a boost is due, never `end + 1`, which is why `unschedule_boost`'s two‑branch test (`dist_epoch >= end` → due counter; else → ring slot) is exact.

**Nothing is lost or gained on a weight change.** `reweigh` moves the owed amount into `carry` and resets `debt = w_new·acc`, leaving `owed_of` invariant and `owed_scaled` untouched — so a weight change is money‑neutral by construction, and a *lower* weight can never need a negative debt. `expire_boost` calls `reweigh(…, 0)` at the accumulator its last distribution left, so the expiry is exact to the scaled unit. `claim` expires **before** computing `pending`, so the deferred‑frozen case still owes the full boosted share (BO.37 measures it).

**Totals agree.** `boost_expiring` sum + `boosts_due` == `boosts_active`, and `boost_weight_total` == Σ live `boost_weight`, are both maintained in every mutation path, and `retire` removes a boost from whichever bucket holds it. The two host tests (the 1,000‑epoch model and the 260‑epoch run through the program's *own* free functions, with coverage assertions that fail if a branch is never reached) are good evidence for the wrap, which no validator run can reach. The `expiry-budget.mjs` genesis state is *coherent*, which I checked: 20 × (level 2 + boost 12) = 280 = `total_active_weight`, and Σ `owed_of` = 20 × 140·S = 2,800·S = `owed_scaled`. So that gate measures a real state, not a contradictory one.

**Nobody can make distributions impossible by boosting**, because `expire_boosts` needs only the records and skips anything not due.

---

## R3. The level draw

* The SlotHashes parse pins the sysvar key, bounds the declared count at 512, checks the buffer length against the count, and refuses an all‑zero hash. Host tests cover a full 512 buffer, a 513 declaration, a truncation, a forged key and a zero hash.
* Skipped slots: the reader takes the smallest produced slot in `[want, want+64]`, which is final once it appears. I checked the aging hazard and it is closed arithmetically: the capture window is 300 slots, so at the latest permitted capture (`now = reveal_slot + 300`) SlotHashes still holds everything from `reveal_slot − 212` onward, and `C ≤ reveal_slot + ~214`. So A can never age out inside the window and the draw cannot silently shift to a later slot.
* FIFO is enforced by `index == revealed_total`, and a burned head still draws (the Core write is skipped), so the queue cannot stop at a burned vault (L.11).
* The attribute re‑supply hash is computed over the same Borsh encoding at both ends (`attributes.to_vec().try_to_vec()` vs `attributes.try_to_vec()`), and the stored‑byte budget (640) is what makes a mint‑accepted list always revealable (L.12, L.12a).
* **Is it worse than SPEC 26?** Not in kind. The residual I examined that SPEC does not spell out: a validator holding three consecutive rotations could be the leader of *both* B and C (the stride is two groups, so B and C are never adjacent rotations, but three consecutive rotations covers both). That gives more tries, not a different power, and SPEC already says "three different leaders is likely, not guaranteed". HOLDER‑GUIDE's wording ("can pick among several results, by skipping a block or changing what goes into it… one choice affects every vault created in that moment at once") is a faithful restatement.

---

## R4. Governance

* Quorum/threshold/turnout/key‑change are all ceiling‑divided against the **snapshot**, never `max(snapshot, live)`, and `need > 0` guards a zero divisor. A minority cannot carry a key change: `KEY_CHANGE_YES_BPS = 5000` of the snapshot, `KeyChangesBundled` forbids pairing the two keys, and MINT's notice + the guardian's `cancel_swap_operator` sit behind it.
* Per‑kind ordering: `last_round_id` is advanced **before** the `round_already_over` skip, so a stale round cannot land after a newer one that was itself skipped (round 39's 3c.R1 property). GOV's restart skip (`stopped_at >= created_at`) is the exact complement of MINT's `StopIsNewer` (`stopped_at < created_at`), so the bundle never reverts on it.
* `ACTIONS_SPACE` is sufficient: the widest one‑of‑each bundle serializes to 143 bytes against 189 allocated; `Proposal` space computes to exactly the declared 259.
* A vote cannot reach money: `SweepTighten` has no destination/split/supply field in either crate (P.0e/P.0f pin the absence), the CPI always passes exactly `[mint_config, gov_pda]`, and `tighten_sweep` is monotone with `initialize` bounds re‑checked on both sides.
* **Frozen forever:** SPEC 47's statement (a stolen guardian key holds sales and the sweep shut permanently below 50 % turnout) is the honest bound and I did not find it worse. The one additional note: the guardian is also `INIT_AUTHORITY`, so a key stolen *before* road step 10 is a different and larger problem, which SPEC 47's operational note names.

---

## R5. The charter claim

* Identity by address, domain‑separated leaves/nodes, sorted pairs, depth bounded at 16, root pinned at `initialize`, owner checked from the asset bytes, collection checked, and the PoB CPI‑burned in the same instruction. A lookalike minted by the hot wallet is refused (C.8), and a spent leaf cannot be replayed because the address can never be re‑minted (9.12/9.13).
* `pob_extra` accounts are forwarded as non‑signers, bounded at 8 and at the supplied count. Passing a writable unrelated account only risks the caller's own transaction; Core writes only to its positional accounts.
* **Is SPEC 46 complete?** I looked for an omission and found one small one, already half‑covered: the limit says the key "cannot transfer or burn an individual Proof of Burn" and that what remains is "gate or brick claims". It does not say that the key can also add an **external plugin that Core consults on transfer**, which would gate the *secondary market* for Proofs of Burn during (and after) the window — no CBOB holder loses value and no claim is affected (the claim is a burn, which the limit already covers), so this is an INFO‑level completeness note, not a new exposure. I found nothing a PoB holder or a third party can do that the limit omits.

---

## R6. The one‑time configuration and the trusted hop

I enumerated every `initialize` argument and what a wrong‑but‑accepted value locks in. Everything I found is already inside item 38's scope; the ones worth re‑emphasising because the **program** is permissive and only the off‑chain checker is strict:

| value | program accepts | consequence if wrong |
|---|---|---|
| `sweep_cooldown_secs` | 1 s … 24 h | 50 SOL **per second** of royalty SOL to the operator, for ever. Only the pre‑signing checker and the (post‑hoc) alarm stand between the ruling and this. |
| `guardian`, `swap_operator`, `bank_treasury` | any non‑default key, **including off‑curve** | an unpullable brake; an unspendable 15 % destination; `rescue_nested` sends every rescued vault there for ever. |
| `charter_opens_at` | may be **in the past** (only `closes_at > now` is checked) | the window opens at `initialize`, before road step 10 has created the pool/revenue/Squads accounts. |
| SEAL `reserve_mints` | owner == classic Token only; **not checked to be mints, not de‑duplicated** | a duplicate or a token *account* in the list silently removes a reserve asset from every emptiness proof for ever. |
| `monthly_secs`, `notice_secs`, `redeem_window_secs`, `min_voting_secs` | test floors (60 s / 60 s / 10 s / 60 s) | permanent. |

None of this is new (round 24 A6 states the shape), and the launch checker covers each. The point I want on the record is that the **ordering** matters: the checker validates the JSON, the ceremony page builds the transactions from that JSON and re‑reads every field after each step — so the ceremony is now the mechanism that closes item 38's "whoever builds the transactions must build them FROM that file". That is a genuine improvement over the state item 38 describes, and item 38's text has not been updated to credit it.

**The trusted hop's worst case** is as SPEC bounds it: `max_sweep_lamports` per `sweep_cooldown_secs`, never below the reserve, until the guardian stops it; replacement needs half of all live vaults plus notice; the guardian can cancel a pending replacement. The program side checks out: operator must sign (6.17a), zero is refused (6.17b), three in one transaction is refused (6.17).

**The 10 % royalty** is a Core plugin with authority `None`: Core refuses update (R.6), removal (R.6a) and re‑delegation (R33.G3), each with Core's own error, each with a positive control proving the call is well formed. Nothing in our programs writes royalties after `initialize` (`set_collection_royalties` is gone; 0.4h proves the discriminator does not exist). R.9 re‑reads 1,000 bps at the end of the whole suite.

**The redemption cap** is exactly a rolling window: the k‑th most recent time is at `(head − k) mod 64`, and `k = min(max(cap,1), 64)` makes the limit stricter, never looser, above 3,047 live vaults. `rate_head` is always reduced mod 64 on both read and write. `live = minted − burned − bare_retired` cannot underflow because no vault is counted in both counters (a redeemed vault's record is retired; a bare‑burned asset fails BURN's `KEY_ASSET_V1` read).

---

## R7. Cross‑program raw reads — recomputed from the structs

Every offset below I derived from the field list, not from the comments.

**MintConfig** (disc 8): `version 8`, `collection 9`, `governance 41`, `pool_ata 73`, `round_id 105`, `price 125`, `minted_total 141`, `max_supply 149`, `bank_treasury 157`, `split_bps 189`, `sales_stopped 191`, `sweep_stopped 192`, `guardian 193`, `swap_operator 225`, `sol_reserve 257`, `bump 265`, `max_sweep 266`, `cooldown 274`, `last_sweep 282`, `level_caps 290`, `level_minted 310`, `revealed_total 330`, `payment_mint 338`, `pob_collection 370`, `pob_root 402`, `charter_opens 434`, `charter_closes 442`, `charter_claimed 450`, `bare_burns_retired 454`, `total_active_weight 462`, `active_count 470`, `acc 478`, `owed 494`, `last_distribute 510`, `sales_stopped_at 518`, `sweep_stopped_at 526`, `pending_op 534`, `pending_op_at 566`, `monthly 574`, `pending_guardian 582`, `pending_guardian_set 614`, `pending_guardian_at 615`, `notice 623`, `sweep_floor 631`, `cooldown_ceiling 639`, `reserve_ceiling 647`, `dist_epoch 655`, `pending_count 663`, `pending_this_epoch 671`, `cbob_mint 679`, `max_boost_weight 711`, `max_boost_epochs 712`, `boost_price 714`, `boost_weight 722`, `boost_epochs 723`, `boosts_active 725`, `boosts_due 729`, `boost_weight_total 733`, `cbob_burned_total 741`, `boost_expiring 749`, end 1005. Space computes to **1261** = 1005 + 256 padding. **Every one of GOV's eighteen and BURN's two pinned offsets matches.** GOV's length guard (`>= 712 + 2`) is sufficient for all of them.

**VaultRecord**: `version 8`, `asset 9`, `mint_index 41`, `reveal_slot 49`, `level 57`, `charter 58`, `entropy_set 59`, `entropy 60`, `attrs_hash 92`, `bump 124`, `active 125`, `retired 126`, `reschedules 127`, `vault_ata 129`, `debt 161`, `pending 177`, `request_epoch 178`, `boost_weight 186`, `boost_end_epoch 187`, `carry 195`, end 211; space **221** (matches SPEC's rent figure: (221+128)·5080 = 1,772,920). GOV's `asset 9` / `mint_index 41` match.

**BurnConfig**: `version 8`, `collection 9`, `bump 41`, `burned_total 42`, `redeem_window 50`, `rate_head 58`, `rate_ring 59…571`; space **827**. GOV's `42` matches.

**SealConfig**: `version 8`, `collection 9`, reserve `Vec` length at **41**, keys from 45; space 398. MINT's and BURN's `OFF_COLLECTION 9` / `OFF_RESERVES 41` match, and both pin the discriminator *and* the version byte.

**The web's two raw reads also check out**: the `mint-boosts` slice `offset 125, length 70` maps to `active=d[0]`, `retired=d[1]`, `boost_weight=d[61]` (125+61 = 186 ✓), `boost_end_epoch=d.readBigUInt64LE(62)` (187 ✓); the `mint-waiting` filter `memcmp(177, [1])` is `pending`. The sweep helper's classic offsets (mint 0, owner 32, amount 64, len 165) are correct, and its `read_token` refuses anything not exactly 165 bytes and not classic‑owned.

`load_record` deliberately does **not** check the record's PDA derivation. I convinced myself that is safe: the only accounts MINT owns are its config (different discriminator) and records created by `init` at `["vault", asset]`, so any MINT‑owned account carrying the `VaultRecord` discriminator *is* a canonical record. I flag it only as a brittleness note (INFO‑3).

---

## R8. The suite, the simulation and the build as evidence

**Non‑vacuity spot checks.** `because()` pins are real negatives (the `ID.1` arm guarding id uniqueness is a good defence against the reused‑id failure mode). `BK.*` cannot pass by deletion, because `ck()` only appends a label when `ledger()` balances and the arm compares the label *list*. SR.12b is the kind of arm I look for and rarely find: it asserts a refusal reached the *second* guard, not the first. `RL.7` replays the ring against per‑redemption caps certified by coherent supply snapshots, with ambiguity failing the run — that is stronger than the usual "no window exceeded the current cap".

**Arms whose claim is weaker than it reads.** `X.7` is honest about it in the code ("with every level drawn, the crank plans NO reveal"), so the planner's ordering rests on `bank/selftest.mjs`, not on the chain run. `PG.1c` and `E.3c` use a 400,000 CU *regression ceiling*, not a budget check; that is stated in the comment.

**Claims in this prompt that no arm exercises.** Two, both already named in the accepted limits: the 7‑day proposal execution deadline (a constant, not an `initialize` value), and `--reconcile`'s I/O. I add a third below (LOW‑2).

**Bytes.** `build-mainnet.sh` proves which `INIT_AUTHORITY` each of the four keyed programs carries, by behaviour, in both directions, with the reason pinned to `NotTheInitAuthority` and the controls required to reach a *later* check. For the helper it proves byte identity with the deployed localnet build **and** with `target/deploy`, which is the file the suite and sim actually deploy. The one residual it names itself (it cannot prove the compiled constant *is* Gary's key, only that it is not the test key) is the correct statement.

---

# Findings

## LOW‑1 — the certifying run never executes the 642 web assertions

**Construct.** `scripts/run-tests.sh` (the one command SPEC's ship gate and road step 7 certify on, including under `CBOB_SHIP_GATE=1`) runs: the on‑chain suite, `bank/selftest.mjs`, `bank/accrual.mjs`, `bank/redemption-poster.mjs`, `scripts/pob-merkle.mjs`, `scripts/check-launch-params.mjs`, the MINT host tests, `tests/expiry-budget.mjs`, the mainnet probe and `sim/swap-fork.sh` — each behind a floor that must **equal** its count. It does **not** run `node web/test/run-all.mjs`, and `web/` appears nowhere in it.

**What that costs.** The pages in `web/src` build every transaction a holder or Gary signs, are the only pre‑signature protection left for accepted limits 9 and 44, and are the subject of every confirmed finding in rounds 36, 37, 38 and 39. The regression arms for all of those (V36.1's C5 refusal, V37's bounded reads, V38's `drop`/standing‑consent/B4 arms, V39's promised re‑read and optional rescue) live only in `web/test/`, which no gate executes. So the floor‑equality discipline that SPEC built precisely to stop assertions quietly disappearing does not reach 642 of this project's assertions, and a change to `web/src` that broke a page's transaction building would leave the certifying run green.

**Why it is only LOW.** `web/test/run-all.mjs` does enforce its own per‑file floors, and each round's `VALIDATION.md` records the run (642/642 this round). Nothing here is untested; it is ungated.

**Evidence if I am right.** `grep -n 'web/' scripts/run-tests.sh` returns nothing. Break one line of `web/src/lib/plan-redeem.mjs` (for example delete the `if (s.known) for (const k of s.known)` block that implements V39‑1) and `CBOB_SHIP_GATE=1 ./scripts/run-tests.sh` still exits 0, while `node web/test/run-all.mjs` goes red.

**Fix.** Add to `run-tests.sh`, with a floor that must equal the count, exactly as the other suites are gated:
```
WEB_FLOOR=642
sub_selftest web node web/test/run-all.mjs; WEB_OUT=$SUB_OUT
floor "web offline" "$WEB_OUT" '[0-9]+/[0-9]+ web assertions' "$WEB_FLOOR"
```
If touching `scripts/` before the freeze is unacceptable, then record it as an explicit, numbered ship‑gate step beside road step 7 ("`node web/test/run-all.mjs` at its floor, output recorded") rather than leaving it only in `web/README.md`. Either way, SPEC's "Running the tests" list should name it.

---

## LOW‑2 — the redeem page sets no compute‑unit limit, and the worst asset shape's redemption was only ever simulated with an explicit 1,400,000‑unit limit

**Construct.** `web/src/lib/tx.mjs:buildTx` builds the redemption from `plan.redemption` alone; no `ComputeBudgetProgram` instruction is ever added by any page (deliberately — item 54's rule is about *crank‑carrying* transactions, and the page sends no crank). A transaction with no explicit limit gets `200,000 × instruction_count`, capped at 1,400,000; SPEC uses that rule itself ("below its legacy default combined budget of 800,000 CU" for the four‑instruction redemption).

The ordinary case is measured and fine: S8.1a records 168,343 CU for claim + open + Execute + burn, and the e2e asserts the C5‑heavy shape under its default. The gap is the **Core‑heavy asset**. Arm R28.A4 simulates "the complete redemption transaction, SEAL open, Execute sweep of its funded cbBTC and BURN" on the real 10,198‑byte‑autograph vault — but the suite's `simOk` helper prepends `cuLim(1_400_000)`, and the arm records only `err == null`, not `unitsConsumed`. So whether that redemption fits its own 800,000‑unit default is **unmeasured**, on exactly the asset shape the suite itself constructs (R28.A1, R33.G1, R34.G1) and that HOLDER‑GUIDE warns holders about.

**What it costs.** Nothing is lost: the page's own dry run uses the same default budget, so the failure is loud and happens before any signature. The holder of such a vault simply cannot open it on the Bank's page and would need a client that sets a limit — while HOLDER‑GUIDE tells them "a transfer and a full opening both passed a simulation".

**Evidence if I am right.** Re‑run R28.A4 without the `cuLim(1_400_000)` prefix (or print `value.unitsConsumed` from the existing 1.4 M simulation) and compare with `200,000 × 4 = 800,000`. If the consumed figure exceeds 800,000, the page's `simulate()` on that vault returns an `InstructionError` / exceeded‑budget result and `show()` prints "The network's dry run of the opening failed".

**Fix (either).**
1. **Page:** add `ComputeBudgetProgram.setComputeUnitLimit({units: 1_400_000})` as the first instruction of the redemption, and include it in the trimming loop's size accounting. Cost is ~44 bytes against the measured 1,152‑byte worst page shape (and 1,061 for the plain one), so it fits with room; an explicit limit replaces the default entirely. Add a `plan.test.mjs` arm asserting the instruction is present and the size still fits, and an e2e arm on a large‑autograph vault.
2. **Measure and record:** print `unitsConsumed` in R28.A4 and assert it under `200,000 × instruction_count`, and state the result in limit 40's round‑28 paragraph. If it does not fit, (1) is mandatory.

---

## INFO‑1 — `txread.mjs`'s "parsed money instruction" requirement is bypassed for a Token instruction the RPC does not parse

`validateParsedTransaction` demands `object(ix.parsed) && object(ix.parsed.info)` **only when `'parsed' in ix`**. When the RPC's `jsonParsed` encoder cannot parse an instruction (an unknown or newer Token‑2022 instruction), it emits the raw form, which has no `parsed` key, so the instruction takes the `else` branch and is accepted as a well‑formed raw instruction. The file's own contract ("Missing required metadata is unknown coverage: the reader refuses it") is therefore not applied here. In practice the impact looks bounded, because `pre/postTokenBalances` are separately validated and present, so a balance change remains visible; and the reserves are classic SPL. **Evidence if I am right:** feed `validateParsedTransaction` a transaction containing a Token‑2022 instruction in raw form (`{programId, accounts, data}`) and it returns the transaction rather than throwing. **Suggested:** either require `parsed` for the four money programs, or record this explicitly in the "Reader coverage boundary" paragraph beside the `Log truncated` case.

## INFO‑2 — `groupAcks`'s `covers` field is never read

`plan-redeem.mjs:groupAcks` attaches `covers: many.map(a => a.id)` to the grouped box, and nothing consumes it. The consent logic instead relies on `s.seen` to decide that an individual `lost:X` box at the press was already covered by a group box at the check, which is correct (and documented in `web/README.md`). The dead field reads like a consent‑tracking mechanism that is enforced, and it is not. Delete it, or wire the press‑time check to it so the mechanism is the one a reader sees.

## INFO‑3 — `plan-get.mjs` can throw on a half‑unreadable Attributes plugin, and `load_record` does not pin the record PDA

Two defensive gaps, both unreachable today:
* `planDraw` does `assetInfo.plugin('Attributes')?.body.attributeList || []`. `pluginsUnreadable` is set only when the plugin *registry* fails to parse; an individual body that fails leaves `body = null`, and `?.` guards only the entry, so `null.attributeList` throws a raw TypeError onto the page. Unreachable because only MINT's PDA can write a vault's Attributes (11.13/11.14) and MINT bounds them to 8 keys / 640 bytes. Use `?.body?.attributeList`.
* MINT's `load_record` checks owner + discriminator + version but not `key == PDA(["vault", asset])`. Safe today because the only MINT‑owned accounts are the config and `init`‑created records, but it is the one raw read in the tree that does not pin its own derivation, and the project's own house rule is to pin.

## INFO‑4 — SPEC item 38's text has not been updated to credit the ceremony

Round 24 A6 recorded the gap "the checker validates the JSON, not the signed transaction, so whoever builds the four `initialize` transactions must build them FROM that file". The ceremony page now *is* that mechanism: it runs `judgeLaunch` over the embedded file at both clocks, builds each instruction from `valuesFrom(launch)`, and re‑reads every field after each step against `expectSeal/expectMint/expectBurn/expectGov` (stopping for good on a mismatch). Item 38 still reads as though nothing closes that gap. This is documentation only, and it understates the current state rather than overstating it.

---

# The four questions about the accepted limits

**1. Is any limit WORSE than stated?** I did not find one. Three I tried hardest on:
* **32 (the 2.1 %/hour cap).** The ring arithmetic is exactly a rolling window, and `k = min(cap, 64)` is stricter above 3,047 live vaults, as stated.
* **26 (the last leader).** The one thing I can add is that a validator holding three *consecutive* rotations is the leader of both B's and C's groups (the two‑group stride makes B and C non‑adjacent, so two adjacent rotations is not enough) — more tries, same power, and the limit already refuses to guarantee three distinct leaders.
* **28 (freezes).** "A frozen account cannot be emptied" is true only when it holds a balance; a frozen *empty* reserve account is merely closed and does not block an opening. That is an overstatement in the safe direction.

**2. Is anything listed as a limit not actually a limit, or closed by something the author did not notice?** Nothing fully closed. Two partial credits the text has not taken:
* Item 38's residual is largely closed by the ceremony (INFO‑4).
* Limit 9's "an owner who redeems by any other client destroys the nested asset" is now only half true for a CBOB vault: `rescue_nested` accepts a **burned** host, so a CBOB vault lost inside a vault burned by any client is still extractable by anyone. The limit's parenthetical mentions item 58 but the sentence still reads as destruction.

**3. Is any DISCHARGED item not actually discharged?** Item 54 is the one I pushed on, and it *is* discharged for what it claims (crank‑carrying host shapes, with the page rule following the number). LOW‑2 is adjacent ground that item 54 never covered — the redemption's **own** compute against the default budget on a Core‑heavy asset — so it is a gap in coverage, not a false discharge. Items 51, 33, 30, 31, 19, 14 and 12/17 all check out against the code and the arms they name.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22, 38, 50, 52 and 53 all remain OPEN, and each has a live mechanical refusal behind it: `launch/mainnet-init.json` still carries `charter_opens_at`, `lock_deadline` and `vault_collection` as `OPEN` and `judgeLaunch` refuses any OPEN value (49/49 selftest); `config.js`'s `rehearsal` profile has `launchValues: null` and the README states that item 53's value set is still unbuilt; HOLDER‑GUIDE is still marked DRAFT; `bank/redemption-poster.mjs` still has no sender; road step 8 is "not started" and road steps 10 and 11 follow it. The one thing I would tighten: item 50's own client contract is now partly enforced by code (`web/`) and partly not (the published surfaces, the poster's sender), and the item does not distinguish them — a reader could take "BUILT AND STAGED" as more than it is.

---

# What this project should do before launch that AI audit structurally cannot

Everything below is something no model reading a bundle can do, including me.

1. **Run road step 8 as written, and treat its five named items as the gate.** Item 22's list is the right list. The four I would not let anyone wave through: one full revenue cycle through **each** pool (Orca, then Orca forced to refuse so Meteora really runs); one **forced post‑sweep failure** walked through the hand recovery to `--audit` clean; the crank's live passes against ~2,100 vaults with a real provider's rate limits; and the alarm's live passes with `CBOB_ALARM_REHEARSAL=1`. None of these can be reasoned into existence. Record every signature.

2. **Re‑run the full `run-tests.sh` inside `scripts/rehearsal-tree.sh` at the release commit, and build the rehearsal value set first.** The existing proof is of `d57ee3a` and is stale by sixteen rounds. `launch/rehearsal-init.json` and a rehearsal mode in `check-launch-params.mjs` are still unbuilt, and without them the rehearsal cannot initialize anything.

3. **Do the ceremony twice: once on a throwaway deployment, end to end, with a reload and a deliberate time‑out in the middle of step 0 and of the funding step.** The resume logic is good code, but "a step that landed after a time‑out is never sent twice" is a claim about a browser, a wallet and a flaky RPC together. Also do it in **local mode** over the SSH tunnel as `web/README.md` prescribes, and compare the printed `app.js` sha256 with a build you make yourself from the release commit. Do not run the ceremony off the public site.

4. **Have a second human read the five permanent addresses out loud against their sources, on the day.** `bank_treasury`, `guardian`, `swap_operator`, `payment_mint` and the three reserve mints are permanent, the programs check almost nothing about them (SEAL checks only the token‑program owner), and `rescue_nested` points every future rescue at `bank_treasury`. A single transposed character here is unrecoverable and is the kind of error every automated check in this tree is structurally blind to, because every check reads the same file.

5. **Test the custody of `bank/keys/deploy-authority.json` by restoring it from the offsite backup onto a different machine, before step 9's upgrades.** If that key is lost before step 11, the five claimed ids can never leave the placeholder and launch needs new ids — a program change. Nothing in the repository can tell you whether the backup actually restores.

6. **Put one real person through `/redeem/` on the rehearsal deployment, with no coaching, on a phone,** including a vault with a stranger's junk at its deposit address, and watch whether they understand the tick‑boxes. The consent design is now intricate (per‑item boxes, a grouped box above twenty, an "unlisted" box, one standing consent for late arrivals, a re‑plan that may add boxes at the press). Whether a holder reads that as informed consent is not something any model can establish, and it is the only control standing between a holder and limits 9 and 44.

7. **Before step 11, decide and write down who may rebuild `web/dist` and how its hashes are verified after the programs are final.** The pages are the only mutable component left after the lock, they build every transaction a holder signs, and `config.js` pins the program hashes to one release commit. The threat model of "immutable programs, mutable pages" has not been written anywhere.

8. **Pick the two failure drills and rehearse them with the actual people:** Coinbase freezes the pool (holders must still be able to open vaults, and the crank must stop crediting) and the guardian key is lost (sales and the sweep are then permanently stoppable only by a 50 %-of-all-vaults vote, SPEC 47). Both are documented. Neither has been practised, and both are the moments where a correct design fails on human latency.