

# ROUND 43 — INDEPENDENT AUDIT OF THE FINAL TREE

**Method statement (read this before the findings).** This is a read-whole pass. I did **not** boot a validator, run the 909-assertion suite, the 71-assertion simulation, or the e2e; there is no execution environment in this seat. Everything below is source-level verification against the bundled tree at the round-42 repair commit. Where I say "holds," I mean I re-derived it from the code, not that I re-ran it. Where a claim rests on the measured suite, I name the arm and state what a re-run must show. I file only what I can evidence. I found **no new CRITICAL, HIGH, or MEDIUM** in the five programs, and I could not construct a path that moves value out of a sealed vault, the pool, or the revenue address. That is a negative result earned by attempted attack, not a confirmation of the author's correctness.

---

## R0. ROUND 42'S VERDICT AND REPAIRS

**V42-1 (malformed URI crashed `ceremony-local.mjs`).** Repair is present and correct.
- `web/deploy/ceremony-local.mjs` `staticFile`: `decodeURIComponent` is now inside `try { … } catch { return null }`, so `/%E0` yields a 404, not a `URIError`.
- The listener is exported as `localListener` and wraps the whole body in `try { … } catch { if (!res.headersSent) res.statusCode = 500; res.end() }`, so a throw anywhere becomes a 500, not a dead process.
- I looked for the same unguarded-decode shape elsewhere in `web/`. The pages read query params via `getParam` → `URLSearchParams` (safe); `rpc-proxy.mjs` parses a JSON body, never a URI path. I found no second site. **Evidence if I am wrong:** any `web/test` arm or a fuzzer hitting `localListener` with `/%`, `/%E0`, `/a%2Fb` must return 4xx/5xx and the process must survive a subsequent good request. The round-42 gate-5 arm drives the real listener; re-running it red-then-green confirms.

**V42-2 (`collectionCreator` judged only the oldest transaction).** Repair is present and correct.
- `web/src/lib/ceremony-reads.mjs` `collectionCreator` now walks oldest→newest, skips failed sigs twice (`s.err` from the listing and `tx.meta?.err` after fetch), and classifies on the **oldest successful `CreateCollectionV2` whose first account is this address**, bounded at `CREATOR_FETCH_MAX = 25`. A complete history with no such create returns `unverifiable`, never `other`.
- I re-traced the three attack shapes: a stranger's *failed* transfer first (skipped by `s.err`), a stranger's *successful* transfer first (skipped because it is not a Core create), and a padded history (returns `unverifiable`). In all three the real launch-key create is still found or honestly declared unverifiable. The decoy (stranger creates their *own* collection naming MINT's PDA) is a different address, classifies `other`, and is ignored — correct.
- **Evidence if I am wrong:** `ceremony.test.mjs` arms for `[failed-transfer-first, create]` → `launch`, `[success-transfer-first, create]` → `launch`, `[25 transfers, create]` → `unverifiable`, `[stranger-create]` → `other`. Round 42 lists six new arms shown red at the old reader. Re-running them green confirms.

**Disproved claims I re-tested by reading (not re-filed):**
- **C3** (proxy refuses legacy txs): `txRefusal` calls `VersionedTransaction.deserialize`; web3.js's `VersionedMessage.deserialize` accepts a legacy message with no version prefix. The page builds with `new Transaction()` (legacy). So legacy is accepted. Consistent with `proxy.test.mjs` serializing a legacy tx and asserting `txRefusal → null`.
- **C7** (`planDraw` TypeError on null Attributes body): the mechanism is real (`plan-get.mjs` reads `attrPlugin?.body.attributeList` and `decode.mjs` sets `body=null` on parse failure), but it is unreachable for our vaults: the Attributes plugin authority is MINT's PDA, MINT writes ≤8 entries in ≤640 bytes, and Core authored the bytes. Even if hit, nothing is signed. Round 42's one-character hardening (`?.body?.`) plus a `get.test.mjs` arm is the right disposition. Not a defect.
- **C16** (guide "still sealed" vs limit 32 "live"): the difference only *loosens* the cap briefly (an unretired bare burn still counts in `live`), never tightens it against a holder. Not a misstatement that harms a crack.
- **C24** (frozen zero-balance reserve): an activated vault holds ≥21,000 sats and a sealed vault's balance only rises, so the page's `frozen && amount > 0` refusal fires before any zero-balance-frozen case matters. Not reachable.

**Verdict on R0:** both round-42 repairs hold at the sites I can see; no regression introduced; the disproved set stays disproved. I confirm round 42's classification that neither V42 item touched the five programs.

---

## R1. CUSTODY — can anyone but the owner get value out of a sealed vault, or an emptied vault survive?

I attacked the pairing, the emptiness proof, and the thaw-survival question by reading.

**Pairing (SEAL `open_for_redemption` ↔ BURN `burn_vault`).**
- Both halves bind **asset AND owner** by account index (asset idx 0, owner idx 2) and walk only **top-level** instructions via `load_current_index_checked` / `load_instruction_at_checked`. A `burn_vault` hidden in CPI is invisible to SEAL; an `open` reached by CPI reports the outer index to BURN. I could not construct a wrapper that satisfies both, because each independently requires a genuine top-level counterpart for the *same* (asset, owner). This matches suite WR.1–WR.4.
- Two vaults in one transaction: open A searches forward for a burn naming asset A; burn B names asset B, so open A cannot borrow it. The asset binding prevents cross-pairing. Two full redemptions in one tx are limited by the rate cap (suite 4.9, S9b).
- **Account-index binding:** I verified `BURN_IX_ASSET_IDX=0`, `BURN_IX_OWNER_IDX=2`, `SEAL_IX_ASSET_IDX=0`, `SEAL_IX_OWNER_IDX=2` against the `BurnVault` and `OpenForRedemption` account structs — asset is account 0, owner is account 2 in both. The discriminators are pinned and asserted against `sha256("global:…")` in-suite (3.1a–3.1f, 3.1q, 3.1r). The coupling fails closed (a drift refuses the thaw, vault stays sealed).

**Emptiness proof.** I re-checked every raw offset against the 165-byte classic SPL layout: owner `[32..64]`, amount `[64..72]`, delegate COption tag `[72..76]`, delegated_amount `[121..129]`, close-authority COption tag `[129..133]`, and `len == 165` (no Token-2022 extensions). The reserve loop requires every reserve mint's ATA under **both** token programs to be declared; a non-token-owned account at that address (dust, absent) is skipped, which is the round-40/41 dust rule and is safe because a dusted/non-existent ATA holds no tokens. The second loop catches any *declared* PDA-owned token account (reserve or stray) and any declared live Core asset (nested vault). The undeclared gap is real and accepted (impossibility 2) — the chain cannot enumerate PDA holdings — and is covered only by the redeem page's pre-signature warning. I could not find a declared-account bypass.

**Thaw survival.** SEAL thaws only if a matching burn follows in the same tx; BURN burns only if a matching open preceded. If anything after the thaw fails (emptiness, Core burn, retire CPI), the whole transaction reverts including the thaw. The rate-limit ring write also reverts on failure, so a failing redemption consumes no cap budget. I found **no path** that leaves a thawed vault un-burned or an emptied vault alive.

**R1 finding: none.** (Negative result; the suite arms 3.x, 4.x, 9.x, WR.x are the execution evidence.)

---

## R1s. THE SWEEP HELPER (`programs/cbob-vault-sweep/src/lib.rs`)

I read the whole helper (it is ~120 lines) and attacked each of (a)–(g).

**(a) Who can move value.** Called directly, `accounts[0]` must be a signer; that is the vault's asset-signer PDA, for which no key exists — only Core signs it via `invoke_signed` inside `ExecuteV1`. Core approves `ExecuteV1` only for the asset **owner** (limit 40; suite SR.5/SR.5a measure a stranger and an owner-added transfer delegate refused `0x1a`). While the vault is frozen (outside a redemption) Core's `PermanentFreezeExecute` rejects Execute entirely (suite 3.7, S6.2). So the helper is reachable only by the owner, only during a genuine open. I could not reach it while frozen.

**(b) Pair list.** Each pair: source must be owned by the signer PDA, destination must be owned by the ONE `dest` wallet and share the source mint. Duplicate source (SR.12a): the first iteration transfers and closes it; the second `read_token` sees a closed (non-165-byte / non-Token-owned) account and refuses. Source==dest wallet is refused up front (`signer.key == dest.key`). A source that is also a destination would require the dest wallet to equal the PDA, already refused. Odd/zero pair counts: `(len-4) % 2 != 0` refused; zero pairs is legal and does a lamports-only sweep (SR.13). Native wSOL source: it is a 165-byte classic account, so it is read, transferred, and closed like any other (close unwraps). I found no aliasing that moves a stranger's tokens, because the source-owner and dest-owner+mint checks are both enforced.

**(c) Destination checks.** The helper does not compare `dest` to the asset owner — but only the owner can invoke it (a), so `dest` is the owner's choice. The redeem page sets `dest = owner`. A lamport credit to a non-existent, below-rent destination is refused by the runtime (R41.C8), which would revert the redemption; the page uses the existing owner as canonical destination. Not a defect given (a).

**(d) Lamport sweep.** Reads `signer.lamports()` at execution and transfers all of it. Nothing between the sweep and BURN can re-fund the PDA inside the same atomic transaction (the only later instruction is `burn_vault`, and Core `BurnV1` does not touch PDA lamports — impossibility 4). So BURN's `lamports == 0` sees exactly what the sweep left.

**(e) Interaction with BURN's proof.** The sweep closes what it empties; a closed account is no longer Token-owned, so BURN's reserve loop skips it *for the right reason* (not a token account ⇒ holds nothing). If a reserve ATA does not exist at plan time, the page creates it in the prior transaction (item 42); a stranger cannot pre-empt it with a different owner because the ATA is canonically derived for the PDA, and ATA-create/Anchor-init land on a dusted address (suite R34.G2, R31.W2). A stranger *can* create a non-ATA classic account or a Token-2022 account owned by the PDA; the helper sweeps the former if named, cannot move the latter, and the page names/acks it. This is the accepted undeclared-holding gap, not a helper defect.

**(f) Fit.** S8.0 measures the three-asset redemption through the helper (claim included) at 1,061 bytes owner-payer, with room reserved for a compute-budget pair and separate payer (1,232 − 52 − 96). The page's `legacySize` uses the same unsigned-serialization accounting that suite 9.13a pins. I could not find a shape the page builds that exceeds the packet for the three reserves.

**(g) Evidence.** SR.0–SR.14 and S8.* are the arms. The helper is byte-identical between mainnet and localnet builds (no `localnet` feature by design; `build-mainnet.sh` `cmp`s `dist/`, `target/deploy/`, and the release output). **I could not re-verify byte identity from this seat** (no build); that is a road-step-9 act.

**R1s finding: none.** The helper is stateless, ownerless, and its only access control is Core's Execute rule — which is exactly the accepted limit 40 surface.

---

## R2. THE COMMUNITY POOL

I re-derived the accumulator invariant and every counter.

**Invariant "pool ≥ ceil(owed)".** `distribute` computes `avail = balance − ceil(owed_scaled/ACC_SCALE)`, requires `avail > 0`, and `credit` adds `delta = floor(avail·ACC_SCALE/w)` to `acc_scaled` and `delta·w` to `owed_scaled`. Since `delta·w ≤ avail·ACC_SCALE`, the new `ceil(owed/ACC_SCALE) ≤ old + avail = balance`. `claim` pays `floor(pending/ACC_SCALE)` whole sats, transfers that out, and subtracts `pay·ACC_SCALE` from `owed_scaled`, preserving the inequality. `retire` (forfeit/bare-burn) subtracts `pending` from `owed_scaled` without moving tokens (they never left), returning the share to undistributed. `split_revenue` and donations only raise the balance. Only `claim` moves tokens out, and it maintains the invariant. I could not break it. Suite P.32 and the `ledger()`/`books()` arms recompute `owed_scaled == Σ owed_of(record)` after every money operation.

**Two-step activation / JoinWaitingFirst.** `activate` first requests (`pending=true`, `request_epoch=dist_epoch`, `pending_count++`, `pending_this_epoch++`); join happens only when `dist_epoch > request_epoch`, at the accumulator as it then stands (`debt = w·acc`, `carry=0`), so the vault earns from the *next* distribution. `waiting_to_join = pending_count − pending_this_epoch`; `distribute` refuses while it is non-zero, closing the "tick, join only myself, take the backlog" attack. `advance_epoch` resets `pending_this_epoch=0`. I traced pending-counter decrements in `join` (pending_count−−) and `retire` (pending_count−−, and pending_this_epoch−− only if request_epoch==dist_epoch) and found no underflow or drift across same-epoch vs earlier-epoch retirement (suite F21.1). The launch tick (`w==0`) only runs on the free path with `pending_this_epoch>0`, credits nothing, and advances the epoch; the burn path is refused (`NoActiveVaults`), closing the first-activator door attack (3c.A3).

**Liveness.** `JoinWaitingFirst` and `BoostsExpireFirst` can block a distribution only while an eligible-but-unjoined vault or a due boost exists; both joining and expiring are free and permissionless (`claim`, `activate`, `expire_boosts`), and the crank does both every pass. A malicious vault can request activation and never join, but anyone can join it for free, so it is not a DoS. I found no way to make distributions or redemptions permanently impossible for others.

**`retire_redeemed` frozen-pool forfeit.** With the pool frozen, `claim` would revert on the pool `Transfer`, so the redemption omits `claim` and `retire_redeemed` forfeits the undelivered share back to the pool (logged `CBOB_REDEEMED_POOL_FROZEN`), never locking the vault (red-team 3 fix; suite 3c.F0–F3). `monthly_inline` refuses to credit from a frozen pool. Consistent.

**R2 finding: none.**

---

## R2b. THE $CBOB BOOST

I re-derived the ring, the carry, and the exactly-N property.

**Exactly N distributions.** A boost bought at epoch `e0` sets `end = e0 + N` and increments `boost_expiring[end % 64]`. Each `credit`/`tick` calls `advance_epoch`, which moves `boost_expiring[new_epoch % 64]` into `boosts_due` and zeroes the slot. `distribute` and `monthly_inline` refuse while `boosts_due > 0`. So the distribution that advances the epoch to `end` is the Nth to count the boost, and no (N+1)th can run until expiry. I traced `[boost, distribute]` (boost counts in the distribution it rides; BO.21) and `[distribute, boost]` (boost bought in the new epoch; BO.35) — both earn exactly N. 

**Ring wrap / past epoch 64.** `MAX_BOOST_EPOCHS_BOUND = 63 = BOOST_RING − 1`, so a live boost's end epoch can never collide with its purchase slot after a full rotation. `unschedule_boost` picks the due branch (`dist_epoch ≥ end`) or the ring branch (`end % 64`) correctly, and `expire_boost` requires due. Host unit tests drive 260 epochs (four wraps) through the program's own functions and a 1000-epoch independent model; suite BO.34/BO.38 exercise wrapped buys and a wrapped early retire on chain. I could not desynchronize `boosts_active`, `boosts_due`, `boost_weight_total`, `total_active_weight`, and the ring.

**Nothing gained/lost on reweigh.** `reweigh` moves `owed_of` into `carry_scaled`, resets `debt_scaled = after·acc`, and adjusts `total_active_weight` by `after−before`; `owed_scaled` is unchanged and the vault's owed is identical before and after. Expiry (`reweigh` to 0) and claim-normalisation preserve the sub-sat carry. Retire with a live or due boost calls `unschedule_boost` and removes the full weight; the record keeps `boost_weight`/`boost_end_epoch` as inert history. 

**Owner-only, buyer's terms.** `boost_vault` reads the asset's current owner from Core bytes and requires it to equal the signer (`BoostNotTheOwner`); a sold vault boosts for the new owner (BO.33). `BoostTermsMoved` refuses a vote that moved price up / weight down / epochs down between sign and execute, and burns nothing; a favourable move lands at new terms (the ruled one-sided behaviour, BO.30a). 

**R2b finding: none.**

---

## R3. THE LEVEL DRAW

- **SlotHashes parse** (`blockhash_in_window`): pins the sysvar id, bounds `count ≤ 512`, checks buffer length, refuses an all-zero hash. Layout `u64 count` then `(u64 slot, [u8;32] hash)`. Correct.
- **Skipped slots:** uses the smallest *produced* slot in `[want, want+64]`; deterministic. Host tests cover skips at A/B/C and the window edges.
- **FIFO:** `reveal_level` requires `mint_index == revealed_total`. A burned vault at the head still draws (Core write skipped, `revealed_total` advances), so the queue never stalls (L.11).
- **Reschedule:** a missed window moves to `now + 16` (a future slot), never defaults to lowest level; logged `CBOB_REVEAL_RESCHEDULED` and counted. The crank rides on four host instructions, bounded to 4 records, and skips (never fatal-errors) junk accounts.
- **Influence:** I confirm SPEC 26's statement is the true bound — the leader of slot C, knowing hA and hB, can skip within its 4-slot group and vary block contents, choosing among many draws for the whole same-slot cohort. This is the last-contributor residual of any public-hash scheme. **It is not worse than stated** from what I can see: A and C are separated by two leader groups each, removing every non-C leader's influence. The re-roll-by-lapse (limit 25) requires a full ~300-slot window of total silence for that record.

**R3 finding: none.** The draw is as fair as the documented residual allows.

---

## R4. GOVERNANCE

- **Electorate fixed at creation:** `index_snapshot = minted_total`, `quorum_supply = minted − burned − bare_retired`. A vault minted after the proposal cannot vote (`VaultTooNew`) and does not move the bar (divisor is the snapshot, not `max(snapshot, live)`). Bare burns count until retired, which only *raises* difficulty — the conservative direction.
- **Minority can't carry:** quorum 21%, threshold 51% of cast, plus a 10% YES turnout floor, plus **50% of ALL snapshotted live vaults** for a guardian or swap-operator change (`KeyChangeNeedsHalf`), which can't be bundled (`KeyChangesBundled`) and lands only after `notice_secs` via permissionless `apply`. I could not construct a minority path to a key change or to money: the reachable actions are `SetRound`, `Brakes`, `TightenSweep` (monotone tighter, bounded), `ArmSwapOperator`, `SetBoostTerms`. The 85/15, both destinations, `max_supply`, the royalty, and the reserve list are unreachable by any action.
- **Freeze-forever:** the guardian-stop-permanent-at-low-turnout case is real and is accepted limit 47 (needs ≥50% of all live vaults to replace; below that, a stolen guardian re-stops forever). That is a *brake* on sales/sweep only — redemption, activation, distribution, claims are never gated by either stop, so funds are not locked. Governance itself stays reachable as long as one live vault exists to propose (limit 45 covers the all-redeemed case). I found no *new* way to freeze governance.
- **Overtaken actions** are logged skips (`CBOB_ACTION_SKIPPED`), never reverts, so a stale action can't take its bundle down. Ordering is per-kind (`last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`); `tighten_sweep` is monotone and needs no ordering.

**R4 finding: none.**

---

## R5. THE CHARTER CLAIM

- PoB identified by **address** against a domain-separated, sorted-pair Merkle root (leaf tag 0x00, node tag 0x01) of 240 addresses; a lookalike minted by the hot update authority is not in the tree (C.8). The JS (`scripts/pob-merkle.mjs`) and Rust agree because the suite has the program verify a JS-built proof, and the mainnet probe rebuilds the committed root from raw account data.
- The PoB is CPI-burned as its owner in the same instruction, owner-signed, inside the fixed window, not gated by the guardian's stop, and counted toward supply/census. `pob_extra` (≤8) passes through to Core's burn, never as signers, so a benign Oracle hook can't brick the claim; a rejecting hook still rejects (accepted limit 46).
- **SPEC 46 completeness:** it states the hot wallet can (1) end the project before it starts by rejecting every claim through the window, and (2) capture governance by admitting only its own PoBs. It also states the positive bound (the key cannot transfer/burn an individual PoB — Core approves those only for the owner, and permanent delegates can't be added post-create; measured R32.A22). The alarm watches the *collection* account, not each of the 240 assets, and samples state per pass — both blind spots are disclosed in 46. I found nothing the wallet, a PoB holder, or a third party can do that 46 omits, **except** the per-asset plugin blind spot is real and already stated. The claim page refuses a PoB/collection carrying an external plugin (sends `pob_extra=0`), which is the safe-by-refusal choice.

**R5 finding: none new.** Limit 46 is complete as written for the program surface; the residual is custody of the hot key, which is a ruling, not a code defect.

---

## R6. ONE-TIME CONFIGURATION AND THE TRUSTED HOP

- I re-checked every `initialize` guard. MINT refuses: wrong authority, default treasury/operator/payment-mint, a payment mint not in SEAL's reserves, SEAL naming another collection, out-of-range sweep bounds/notice/monthly/boost ceilings, zero or over-sum level caps, an already-over or over-long charter window, an all-zero PoB root, a dirty/foreign/already-minted collection, and a non-classic or duplicate-of-payment/$GARY `cbob_mint` (which it *does* validate as an 82-byte initialized classic mint).
- **Observation (already stated, round 24 A6 — not new):** SEAL `initialize` validates each reserve mint only by account **owner == SPL Token**, not that it is an initialized 82-byte mint, and does not refuse duplicates. A wrong-but-SPL-owned reserve entry is accepted on-chain and caught only by `scripts/check-launch-params.mjs` and the mainnet probe. Because production passes exactly the three ruled mints and MAX_RESERVE_MINTS=3 leaves no spare slot, this is a launch-value risk covered by item 38, not a value-moving defect. I record it so it is not mistaken for an unexamined path.
- **Trusted hop bound:** `sweep_sol_for_swap` requires the operator's signature, enforces `amount ≤ max_sweep_lamports`, `now ≥ last_sweep_at + cooldown`, `balance ≥ reserve + amount`, destination == configured operator, and is stoppable by the guardian. Worst case for a stolen operator key is `cap × cooldown-windows` of royalty SOL until `emergency_stop_sweep` — never a vault, the pool, or sale cbBTC (those are the payment-mint path, not SOL). A vote can only tighten (monotone, inside init bounds). This matches limit 10.
- **Royalty 10%:** installed at MINT init as a Core collection plugin with `PluginAuthority::None`; Core refuses update/removal/re-delegation from anyone including the update authority (our PDA). Measured R.5–R.6c, R33.G3. Nothing in our programs or Core can change it. Confirmed immutable.
- **Redemption cap:** I verified it is a true rolling window over a 64-slot ring of timestamps (the k-th most recent must be ≥ window old), not a bucket. Correct.

**R6 finding: none new** (one already-stated observation above).

---

## R7. CROSS-PROGRAM RAW READS

I recomputed every pinned offset from the struct definitions. All agree:

| read | reader | offset(s) | struct field | match |
|---|---|---|---|---|
| SEAL config version/collection/reserves | MINT, BURN | 8 / 9 / 41 | `version`/`collection`/`reserve_mints` len | ✓ |
| MINT config governance | GOV | 41 | `governance` | ✓ |
| MINT config minted_total | GOV, BURN | 141 | `minted_total` | ✓ |
| MINT config bare_burns_retired | GOV, BURN | 454 | `bare_burns_retired` | ✓ |
| MINT config charter_closes_at | GOV | 442 | `charter_closes_at` | ✓ |
| MINT config sweep bounds | GOV | 257/266/274/631/639/647 | reserve/cap/cooldown/floor/ceil/ceil | ✓ |
| MINT config stops + times | GOV | 191/192/518/526 | flags + stopped_at | ✓ |
| MINT boost bounds | GOV | 711/712 | `max_boost_weight`/`max_boost_epochs` | ✓ |
| BURN config burned_total | GOV | 42 | `burned_total` | ✓ |
| VaultRecord version/asset/index | GOV | 8/9/41 | same | ✓ |
| SPL token acct mint/owner/amount/state | MINT, BURN, SWEEP | 0/32/64/108 | same | ✓ |

I also recomputed the account spaces: `VaultRecord` serializes to 211 bytes (+10 padding = 221, matching SPEC's stated 221); `MintConfig` serializes to 1005 bytes (+256 padding = 1261). Both are ≥ the serialized size, so `init` allocation cannot underflow the write. Discriminators and layout versions (SEAL 2, MINT 6, BURN 4, GOV 4, VaultRecord 4) are pinned and cross-asserted. **No misread found.**

---

## R8. SUITE, SIMULATION, BUILD AS EVIDENCE

I read `tests/3prog.test.ts`, `sim/test-vault.ts`, `scripts/run-tests.sh`, `scripts/build-mainnet.sh`, and the probes. I did **not** execute them. Observations on whether the evidence is real:

- The suite uses a `because(...)` pin on every negative so a reject-for-the-wrong-reason is a false pass; assertion ids are uniqueness-checked (ID.1). Floors must **equal** counts, not merely clear them. This is the right discipline and I saw no arm whose negative fires for a reason other than the one named among the bundled subset.
- `build-mainnet.sh` proves which INIT_AUTHORITY each of the four keyed programs carries by deploying **both** builds and asking each whether it trusts the test key (mainnet must REJECT, localnet ACCEPT), and proves the sweep helper's mainnet bytes are byte-identical to the tested localnet bytes. This is the only available closure for the one tested/shipped difference. **I could not re-run it**; it is a road-step act.
- The test-only CPI wrapper (`tests/cpi-wrapper`) is its own workspace, deployed only to the suite validator, and excluded from `target/deploy`/`build-mainnet.sh`/the deploy list — correct isolation.
- `scripts/audit-coverage.sh` gates on current-content-shown-to-a-quorate-round, not merely ever-bundled. This is the control that stops a rewritten file passing on stale coverage.

**R8 finding: none** in the bundled test code. The residual risk is that I am reading, not running; the execution evidence is the recorded floors, which the operator must reproduce at the release commit (item 22/53 dress rehearsal is OPEN AND BLOCKING for exactly this reason).

---

## THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

1. **Is any limit WORSE than stated?** I found none worse. I specifically re-examined the highest-value ones: limit 27 (stranger claiming a bare-burned vault's share into a dead account, destroying what `retire_burned` would have returned to the pool) is real and correctly scoped as a no-profit-to-the-attacker grief bounded by the crank retiring bare burns each pass; limit 40 (Core upgradeable) correctly names the three concrete consequences including the sweep helper's dependence on Core's Execute rule; limit 46 correctly bounds the hot wallet. None is exploitable beyond its text.

2. **Is anything listed as a limit not actually a limit?** Limit 42 ("only two fit" was false; the narrow owner-payer three-create shape is 1,219 bytes and fits) is correctly restated as a client-contract limit, not an impossibility. I see no limit that is already silently closed in a way the text misses.

3. **Is any DISCHARGED item not actually discharged?** The discharged items I could check against code (14 duplicate attributes — now refused at both `mint_vault` and `claim_charter_vault` via the shared `check_attributes`; 19 unlevelled-vault halt — impossible because `activate` requires a drawn level; 30/31 cadence deletion; 33 notice exercised at 60s) are genuinely closed by construction, with suite arms. Item 54 (compute) is discharged by measurement arms 10.x and R42.C13. I found no discharged item that is actually still open.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?** No. Items 22 (live-chain distribution/revenue rehearsal), 38 (initialize values), 50 (holder surfaces published), 52 (pool/Squads/revenue accounts exist + revenue rent), and 53 (rehearsal at throwaway ids) are all still marked OPEN, and the launch gate explicitly requires them before anything mints. The ceremony page *enforces* 38 by refusing while `charter_opens_at`, `lock_deadline`, and `vault_collection` are OPEN. Nothing is being quietly demoted.

---

## ANYTHING ELSE (observations, none launch-blocking, none a new program defect)

- **OBS-1 (INFO, ceremony robustness, not reachable today):** `collectionCreator` classifies "created by the launch key" as *fee-payer == INIT_AUTHORITY*. The ceremony's step 0 always uses the connected launch key as payer, so this is sound today. If step 0 were ever changed to split payer from authority, the real collection would misclassify as `other`. Recommend treating a candidate as launch-created if the `CreateCollectionV2` sets update-authority to MINT's PDA **and** the launch key is among required signers, not solely fee payer. *Evidence that would make this a real defect:* a ceremony variant where payer ≠ launch key; none exists in the current tree.
- **OBS-2 (INFO, already stated round 24 A6):** SEAL reserve-mint validation is owner-only (see R6). Covered by the launch checker + mainnet probe; item 38 is the gate.
- **OBS-3 (INFO, metadata generator):** the never-backwards rule depends on the private `--state` file. If that file is lost, a lagging RPC read could regress one vault's informational JSON (not the chain, not the vault page, which reads chain directly). Impact is cosmetic; fail-closed otherwise. Not a value path.
- **OBS-4 (process, carried from round 42 C5):** `web/` changes do not reset ship-gate counter 2/3 the way `programs/`, `bank/`, `scripts/` do. Since the redeem/claim/buy pages build every transaction a holder signs, a late unreviewed `web/` edit is a real supply-chain surface. Round 42 already recommended gating `web/` before item 50 closes; I concur and note the release-commit binding (`run-tests.sh` now refuses if program source ≠ `RELEASE_COMMIT`, and `web/build.mjs` refuses if audited hashes ≠ `dist/`) is the right mechanism but must be kept enforced.

None of OBS-1..4 falls in gate buckets (a)–(d). None is in the five programs.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE — what must be done before launch that AI audit structurally cannot

AI audit reads; it does not execute, does not hold keys, does not make custody decisions, and cannot observe mainnet after the fact. Concretely, before the upgrade authority is removed:

1. **Run the dress rehearsal against a live cluster (item 22) and record signatures.** The crank's I/O at ~2,100 vaults, RPC rate limits, a transient error mid-batch, the every-minute reveal lane keeping up, the alarm in `CBOB_ALARM_REHEARSAL=1`, **one full revenue cycle through Orca and one forced through Meteora, and one forced post-sweep failure walked through hand recovery to `--audit` clean** — none of this has ever run live. AI verified the arithmetic on a local validator; only a live rehearsal exercises the network path. This is the single largest thing AI structurally cannot do.

2. **Perform the deploy/verify/lock sequence (road steps 9–11) as deliberate human acts.** Dump each program's ProgramData after upgrade, confirm the prefix hashes to `dist/SHA256SUMS` and the tail is zero, then `set-upgrade-authority --final`, then dump again. AI can specify this; only the operator can execute and witness it. The deploy-authority key (`bank/keys/deploy-authority.json`) must survive until step 11 — its loss before then bricks all five ids at the placeholder.

3. **Decide and pin the three OPEN launch values** (`charter_opens_at`, `lock_deadline`, `vault_collection`) and run `scripts/check-launch-params.mjs` to refusal-free before signing the four initializes. `lock_deadline` must precede `charter_opens_at` so nothing holds value under an upgradeable program. These are decisions, not code; AI cannot make them.

4. **Custody the keys that AI audit can only name.** The guardian/INIT_AUTHORITY (Gary's Phantom), the swap operator, the $CBOB release wallet (all 2.1B tokens on this box — limit 56), and the Giraffish Moments hot wallet (limit 46). Move the release wallet off-box or to a Squads if that is the ruling; hold the Moments key cold/multisig **through the 7-day charter window** to close limit 46's capture path. These are the highest-value single points of failure and none is fixable in immutable programs.

5. **Publish the holder surfaces (item 50) and enable the RPC proxy + metadata cron**, then confirm the redeem page's `judgeRedemptionCoverage` runs in production — it is the *only* preventive control for the undeclared-holding gap (limits 9/44) once the Bank co-signer is gone. Until it is published, those limits have no live control.

6. **Stand up the post-launch alarm and actually staff it.** AI audit is pre-launch; the alarm (`bank/alarm.mjs`) is the post-launch detector for everything immutable (Core upgrade, cbBTC freeze, guardian stop, sweep drift, program-not-locked past deadline). The dead-man's switch must page a human. A detection system with no responder is not a control.

7. **Fund the revenue address above rent and create the three cbBTC accounts (item 52) before the first split/mint.** The ceremony does this, but it must be verified done, or every `split_revenue` and paid `mint_vault` fails loud at launch.

If all seven are completed and the two-consecutive-launch-clean-rounds gate (rounds 41, 42, plus this confirmation on the final tree) stands, then the immutable programs carry no defect I was able to construct. That is the strongest statement a read-only AI audit can make, and it is explicitly weaker than "no defect exists." The immutability ruling means the residual risk is borne by the holders; the dress rehearsal and key custody are where that risk actually lives now, not in the five programs.