# Round 36 Audit — v6, whole tree, including `web/` and the round-35 `rescue_nested` change

**Verdict up front:** I read the five programs, the round-35 diff, the round-35 record (NOT-COUNTED, TRIAGE, REVIEW-rescue, REVIEW-web, VALIDATION), and the entire `web/` tree against the programs. I recomputed every cross-program offset and account space from the struct definitions, re-derived the pool and boost accounting from first principles, and traced every transaction the pages build against the programs' account orders and the suite's proven builders. **I found no CRITICAL and no HIGH that survives reading.** The round-35 repairs hold at every site of their shape. Two LOW findings survive, both in the newest code. I report what I can defend with evidence; I do not manufacture severity.

A boundary I will not paper over: `bank/layout.mjs`, `bank/detectors.mjs`, `bank/crank.mjs`, `bank/alarm.mjs`, `bank/revenue.mjs`, `bank/swap.mjs`, `bank/accrual.mjs`, `bank/selftest.mjs`, `bank/lock.mjs`, `bank/redemption-poster.mjs`, `bank/spl.mjs`, `bank/anchor.mjs` and `scripts/check-launch-params.mjs` are **referenced but not bundled**. The web pages import `decode`, `judgeRedemptionCoverage`, `classifyPdaTokenAccount` and `judgeLaunch` from them; my verification of those imports is interface-level, resting on the web bundle test that proves the browser bundle computes what node computes. The full `bank/` pipeline was the subject of rounds 22–34; this pass reads `bank/txread.mjs` and `bank/sigwalk.mjs` whole.

---

## R0. Round 35's record and the repairs

Round 35 produced no verdict (3/8 and 4/8 usable; quorum is 6/8). Its record is evidence, not authority. I independently verified each confirmed finding's repair against this tree:

| Triage item | Repair claimed | Holds? |
|---|---|---|
| C1/C2 (road steps 9/10/11 contradicted each other on `--final`) | SPEC road table rewritten: step 9 upgrades + verifies without `--final`; step 11 verifies, makes final, verifies again | **Holds.** SPEC step 9 now says "the upgrade authority is NOT removed here (step 11 does that)"; step 11 dumps, checks prefix hash + zero tail, `--final`, dumps again. |
| C3 (GOV's `MIN_ROUND_PRICE_SATS`/`MAX_ROUND_SECS` unpinned) | suite arm R35.C3 | **Holds.** `tests/3prog.test.ts` R35.C3 regexes both sources and compares, with distinct NOT-FOUND fallbacks. I confirmed GOV:185/238 mirror MINT:477/472 today. |
| C4 (placeholder upgrade key had no custody record) | SPEC road step 9 names `bank/keys/deploy-authority.json`, mode 600, gitignored, in the nightly backup | **Holds** (SPEC text). |
| C5 (stranger-kept close authority blocked the automatic redemption) | page sweeps the balance via a Core `ExecuteV1` of an SPL `Transfer`, leaves the account undeclared; SPEC "Known limits" C5 entry | **Holds.** `plan-redeem.mjs` `transferStrays`; the C5 transfer is byte-compared to the sim's `sweep` transfer leg in `ix.test.mjs`; e2e lands it. |
| C9 (crank activates/joins/pays nested vaults) | superseded by item 58 | **Holds**, with the reasoning verified: a nested vault's share accrues to its own `vault_ata` (derived from the asset, unchanged by the rescue), so it travels with the vault; other vaults are not diluted (the nested vault's weight earns its own preserved share). |
| C10 (indexer lag pages CRITICAL) | stated as a limit | **Holds** (SPEC "Known limits" `index_disagrees_with_chain` entry, with the 25-minute router grace). |
| C18 (`seenSplits` grows unbounded) | stated as a limit with the 50,000-entry page | **Holds** (SPEC "Known limits"). |
| C15 (road text: "nothing is deployed" vs five placeholders) | corrected | **Holds** (SPEC road table footnote). |

Rejected claims I spot-checked: C6 (holder-guide "many/several" wording) is correctly disproved — the guide says both, and neither is false. C19–C23's rejections read correctly against the cited lines.

**REVIEW-rescue:** M1 (live-host branch handed a vault to a stranger) is fixed — every rescue now goes to `bank_treasury`; I verified `rescue_nested` pins `dest = a.config.bank_treasury` and refuses anything else (`WrongRescueDestination`). M2 is fixed by M1 (foreign live hosts refused `HostUnresolved`). L2 (Squads can vote with a held vault) is stated in item 58 as a custody rule. L5 (stale "bricked forever"/"destroyed" docs) is fixed — HOLDER-GUIDE now names the rescue exception. L1 (return-to-sender for a burned host may be the wrong person) is **not a code defect** — it is the Squads' off-chain return decision; see "anything else".

**REVIEW-web:** H1 (stranger blocks any opening for ~0.002 SOL) is fixed — the page now refuses only reserve-account problems, a nested CBOB vault, and non-ownership; everything else is a ticked acknowledgement (`plan-redeem.mjs`; the `VECTORS` arms in `plan.test.mjs` drive each vector both ways). M1 (proxy open relay) is fixed — Origin required (missing Origin refused), `gpaShape` is byte-exact, the response is capped while streaming, IPv6 keyed by /64, transactions limited to the pages' programs. M2 (ceremony resume creates a second collection) is fixed — `resolveCollection` cross-checks config.js, SEAL's config, the launch file, the browser's memory, the session, and a chain scan (`collectionsOfMint`), and STOPs on any disagreement. M3 (bundle leaked key paths) is fixed — `build.mjs` step 2b embeds only `{value, status}`; the bundle test greps for the leak patterns. M4 (ceremony served from the public site) is fixed — `mainnet-local` profile + `ceremony-local.mjs` + SSH tunnel + SRI + the ceremony prints its own `app.js` sha256. L1–L6 are fixed as described in VALIDATION (compressed-NFT check via DAS with a said-plainly fallback; `noPrior` re-plan; C5 note reworded; monotonic metadata with a slot state file; Clock sysvar instead of `getBlockTime`; `white-space: pre-line`; fund-step re-read; buy-page "the most you can pay"; frozen-account wording).

---

## R1. Custody

I attacked the pairing, the emptiness proof, and the new permanent delegate.

**The pairing holds.** SEAL's `open_for_redemption` walks forward for a `burn_vault` matching asset AND owner; BURN's `burn_vault` walks backward for the matching open; both bind account 0 (asset) and account 2 (owner); `load_instruction_at_checked` sees top-level instructions only, so a CPI-wrapped half satisfies neither side (WR.1–WR.4 measured with the test-only forwarder). `retire_redeemed` independently demands stack height `TRANSACTION_LEVEL_STACK_HEIGHT + 1` and a top-level `burn_vault` for the same asset. Two redemptions sharing a transaction cannot borrow each other's halves (4.9/4.10/4.10a).

**The emptiness proof holds against the sweep helper.** The helper closes what it empties; a closed account's owner is reassigned (measured by SR.12a's `IllegalOwner` pin, which fires only because the closed account's owner is no longer SPL Token), so BURN's reserve loop skips it for the right reason (`acc.owner != SPL_TOKEN_ID && != SPL_TOKEN_2022_ID → continue`). The Token-2022 derivation of a classic mint's ATA cannot exist (F4.2 measured `IncorrectProgramId`), so the declared Token-2022 address is a nonexistent account, skipped on owner. The second loop's delegate/close-authority/extension checks match the reserve loop's.

**The new PermanentTransferDelegate does not widen custody.** Its authority is MINT's `["rescue"]` PDA; `RESCUE_SEED` signs in exactly one `invoke_signed` (the hardcoded `TransferV1` to `bank_treasury`). I verified no other CPI in MINT uses that seed. `rescue_nested`'s checks are the whole gate, and they are correct:

- `require_live_vault(vault)` — the vault is a live AssetV1 in `config.collection`;
- `owner == PDA(["mpl-core-execute", host], CORE)` — the vault is genuinely nested (a normal on-curve wallet can never equal an off-curve PDA; a non-Core-signer PDA owner would require a PDA-derivation preimage to satisfy);
- `host == vault || is_burned(host) || require_live_vault(host)` — self, tombstone, or a live CBOB vault; a foreign live asset is refused so its owner can Execute it out themselves and no escrow/bundle is broken;
- `new_owner == bank_treasury` — the destination cannot be chosen.

A rescue inserted into someone else's open→burn transaction reverts (BURN re-checks the current owner against the owner bound by the open; Core's BurnV1 needs that owner's signature). A rescue moves no reserve and burns nothing, so it does not bypass the 2.1% rate limit. A rescued vault's record, level, weight and `vault_ata` are untouched; payouts keep accruing to its own deposit address (derived from the asset, not the owner). The Squads (off-curve) cannot redeem it (limit 43) and cannot Execute it while sealed; it can only transfer it back. Before step 11 the upgrade authority could add a second signing path — that is the pre-final trust already stated in items 13/39, not a new hole.

**No path leaves a thawed vault unburned.** The thaw reverts with any failed burn; a partial sweep reverts (`VaultNotEmpty`); a stranger's mid-transaction deposit cannot block the helper (it moves live balances at execution — SR.4/S8.1 measured after a staged 1-sat deposit).

---

## R1s. The sweep helper

(a) **Only the owner can drive it.** Through Core, `ExecuteV1` on a thawed vault approves only `authority == owner` (SR.5/SR.5a refuse a stranger and an owner-added transfer delegate with Core `0x1a`; SR.5c refuses the collection update authority on a control; SR.5d lets the owner empty it). On a sealed vault the seal rejects Execute (3.7/D5.3). Called directly, `signer.is_signer` binds it to the caller's own holdings (SR.1).

(b) **The pair list.** Source must be signer-owned, destination must be `dest`-owned with the same mint. A duplicate source fails on the second read (the first close reassigned the owner — SR.12a/SR.12b pin the exact branch). A frozen source reverts the whole opening (SR.14). A C5 source (foreign close authority) would revert at the close, so the page never names one in the helper (it uses a plain `Transfer` instead). A non-ATA classic account owned by the PDA can be named. A Token-2022 account cannot (`read_token` refuses non-165). An odd or short account list is refused (SR.6/SR.7); wrong program ids are refused (SR.8/SR.9); `signer == dest` is refused (SR.10).

(c) **Destination.** Chosen by the owner (given (a), safe). A lamport credit to a non-System destination lands without touching its data (R27.S1 measured). The canonical destination is the owner, who pays the fee and so exists.

(d) **The lamport sweep** reads `signer.lamports()` at execution and zeroes the account; the helper's closes send rent to `dest`, not back to the PDA; the C5 transfers that follow move no lamports; BURN's `lamports() == 0` reads exactly what the sweep left (SR.4a measures the exact delta including the stranger's gift, the closed accounts' rent, the asset's rent refund and the fee).

(e) **BURN interaction.** The closed reserve ATAs are declared and skipped on owner. A reserve ATA missing at page-build time is created in the prior transaction; a stranger's permissionless classic-ATA creation + deposit is read by the re-plan and swept. The accounts a stranger can create that the sweep cannot name and BURN will skip (Token-2022 accounts, foreign Core assets) are destroyed — that is item 44, stated, and the page names each in an acknowledgement. A nested CBOB vault is now rescuable first (item 58).

(f) **Fit.** S8.0's 1,061 bytes is the owner-payer, no-compute-budget shape; the page's widest shape (+52 compute-budget pair, +96 separate fee payer) is ~1,209 of 1,232, and `plan-redeem.mjs` measures the actual build and refuses over 1,232, dropping strays into acknowledgements rather than failing. A fourth reserve is impossible (`MAX_RESERVE_MINTS = 3` in both SEAL and BURN, pinned to the measurement at 9.14–9.16).

(g) **Evidence.** SR.0–SR.14 and S8.* are real arms with `because()` pins measured against this Core binary and this helper; `build-mainnet.sh` proves the shipped bytes are `cmp`-identical to the bytes the suite and sim deployed (`dist/` vs the localnet release vs `target/deploy`).

---

## R2. The community pool

**The invariant "pool always holds ≥ ceil(owed)" holds structurally, not just in the suite:**

- `distribute`: `owed += floor(avail·SCALE/w)·w ≤ avail·SCALE`, so `balance − ceil(owed)` stays ≥ 0 (dust stays, owed).
- `claim`: pays `pay` whole sats, `owed −= pay·SCALE`, `balance −= pay`; the difference is unchanged.
- `retire` (both paths): `owed −= pending`, balance unchanged.
- `join`: `debt = w·acc`, owed contribution is `w·acc + 0 − w·acc = 0`.
- `reweigh` (boost/expire): `carry = owed`, `debt = new_w·acc`, so `owed_of` is byte-identical before and after; `owed_scaled` untouched.

`owed_of` can never go negative: after a claim `debt = w·acc` and `carry ≥ 0`; after a distribution `acc` only rises; `reweigh` resets `debt` to `new_w·acc` with `carry = owed ≥ 0`. The `checked_sub` in `owed_of` is unreachable, not load-bearing.

**Counters.** `pending_count`/`pending_this_epoch` are consistent under request, join, retire-same-epoch and retire-later-epoch (F21.1 measures both retire shapes). `waiting_to_join = pending_count − pending_this_epoch` gates every crediting path (`JoinWaitingFirst` in `distribute` before any $GARY burns; the same gate, non-refusing, in `monthly_inline`). The launch tick (`tick`) advances the epoch without crediting when nobody has joined, and the burn path cannot open the door alone (`NoActiveVaults`).

**Liveness.** Nobody can make distributions impossible for others: a due boost gates distribution (`BoostsExpireFirst`) but `expire_boosts` is permissionless and needs only records (no token account), so a vault whose account is gone cannot wedge it; a frozen pool defers claims but never locks a redemption (the forfeit path, 3c.F0–F3); a frozen vault account defers only that vault.

---

## R2b. The $CBOB boost

**A boost earns exactly N distributions.** Bought in epoch `e0`, `end = e0 + N`; it earns the distributions advancing the epoch to `e0+1 … e0+N`; `advance_epoch` to `end` moves it from the ring to `boosts_due`; the next distribution is refused until it is expired. The `monthly_inline`-first ordering means a month due belongs to the old weights (BO.22); `[boost, distribute]` counts the ridden distribution (BO.21/BO.21a); `[distribute, boost]` does not (BO.35/BO.35a).

**The ring, the totals and the records agree**, including past epoch 64: the two host tests drive 1,000 and 260 epochs (four wraps) against independent models, with early retirements in both `unschedule_boost` branches, due retirements, and expiries; the suite's BO.34/BO.38 drive a wrapped boost and a wrapped early retirement on chain; `tests/expiry-budget.mjs` lands 20 distinct due boosts under the default 200,000 CU budget on real MINT execution. `unschedule_boost` decrements `boosts_due` (due branch) or `boost_expiring[end % 64]` (not-due branch), never both; `boosts_active` and `boost_weight_total` always follow.

**Nothing is lost or gained on a weight change** — `reweigh` moves the owed share into `carry` and restarts `debt` at the new weight; `owed_of` is invariant. A retired boosted vault's boost leaves the schedule from wherever it is (BO.16/BO.17). `BoostTermsMoved` is one-sided by ruling (BO.26/BO.30/BO.30a/BO.31 measure both directions). Owner-only is enforced against the asset's current owner bytes read at execution (BO.6/BO.33/BO.33a).

---

## R3. The level draw

`blockhash_in_window` pins the sysvar by key, bounds the declared count at 512, checks the buffer holds what the count claims, and refuses an all-zero hash; it takes the smallest produced slot in `[want, want+64]` (host-tested against an independent model with skips at A, B and C). `try_capture` chains A → B → C each two 4-slot leader groups on; the FIFO (`revealed_total`) removes order choice; a missed window reschedules to `now + 16` (a slot that does not exist yet), never defaults; a burned vault at the head still takes its draw so the queue never stops (L.11). The attribute re-supply is hash-checked (`AttributesMismatch`).

**SPEC 26 is not worse than stated, and HOLDER-GUIDE now says it truly.** C's leader knows hA/hB and can skip within its own 4-slot group (best-of-4) plus vary its block; the cohort sharing a `reveal_slot` shares the three hashes (each vault still mixes its own asset). The guide's honest list says exactly that, including the cohort-wide effect.

---

## R4. Governance

The electorate is fixed at creation (`index_snapshot`, live `quorum_supply = minted − burned − bare_retired`); `VaultTooNew` binds the vote to the snapshot; `VoteRecord` is seeded by the asset so transfer-then-vote-again hits an existing account. Quorum (ceiling, never zero), threshold, the 10% YES turnout, and the half-of-all-live-vaults key-change rule (`KeyChangeNeedsHalf`) are each measured both ways (D.1, 3c.K2/K2p, F18.1/F18.2). A guardian change never shares a proposal with an operator arm (`KeyChangesBundled`). Overtaken actions are logged skips, not reverts (7.26, E.2, 3b.S1, 3c.R1, BO.25). **SPEC 47 is not worse than stated:** a stolen guardian key can hold sales and the sweep shut permanently only while fewer than half of all live vaults vote to replace it; it cannot touch a vault, a payout, a rule, or its own replacement; redemption, activation, distribution and claims are never gated by either stop. No minority carries what it should not; no vote reaches money it should not (the split, the destinations, `max_supply`, the royalty and the reserve list are not in any action's field set — P.0e/P.0f prove the struct has nowhere to put them).

---

## R5. The charter claim

The Merkle scheme is domain-separated (0x00/0x01) with sorted pairs; the JS (`scripts/pob-merkle.mjs`) and Rust (`merkle_leaf`/`merkle_root_from`) are proven to agree by the program accepting JS-built proofs on chain, and the module's own selftest refuses outsiders. The PoB is identified by address against the pinned root, must be a live AssetV1 in `pob_collection` owned by the signer, and is CPI-burned as its owner in the same instruction. `pob_extra` accounts pass through to Core's burn never as signers (OR.1–OR.6 against a real Core Oracle, including the rejecting-oracle limit). The window refuses by clock alone outside it and is not gated by the guardian's stop (C.13). **SPEC 46 is complete:** the hot update authority's end-the-project and capture-governance powers during the window, the alarm's collection-only watch, the sampling gap, and the positive bound (it cannot transfer or burn an individual PoB — R32.A22a/b measured) are all stated.

---

## R6. One-time configuration and the trusted hop

Every `initialize` is gated on the compile-time `INIT_AUTHORITY`, runs once (init PDA), and is behaviorally probed by `tests/initauth.test.ts` in both directions (mainnet rejects the test key with `NotTheInitAuthority` specifically; localnet accepts, directly or by reaching a named later check). MINT's initialize refuses a default treasury/operator/payment mint, a non-reserve payment mint, a dirty/foreign/already-minted collection, a SEAL that disagrees, an over or over-long charter window, an all-zero PoB root, out-of-range periods and bounds, and a bad $CBOB mint or boost bound (0.1a–0.1v). The cross-initialize collection agreement (SEAL→MINT→BURN→GOV) is enforced. **The swap operator's worst case is bounded as stated:** operator-signed, `amount ≤ max_sweep_lamports`, one per `sweep_cooldown_secs`, never below `sol_reserve_lamports`, stoppable instantly by the guardian, replaceable only by half of all live vaults plus notice; it cannot touch cbBTC, the pool, or a vault. **The 10% royalty is immutable in Core** (authority `None`): R.6/R.6a refuse update and removal even by the update authority, R33.G3 refuses re-delegation (0x1b), R.5/R.6c are the controls. **The redemption cap is exactly a rolling window over a 64-slot ring of timestamps:** the k-th most recent (`k = min(max(ceil(live·210/10000),1), 64)`) must be a full window old; RL.2 lands exactly the cap against an empty window, RL.3 is still refused 60% of a window later, RL.4 lands after it rolls, RL.7 replays every recorded redemption against its own certified cap.

---

## R7. Cross-program raw reads

I recomputed every offset from the struct definitions. MintConfig: `version`@8, `collection`@9, `governance`@41, `pool_ata`@73, `minted_total`@141, `sol_reserve`@257, `max_sweep`@266, `sweep_cooldown`@274, `charter_closes_at`@442, `bare_burns_retired`@454, `sales_stopped`@191/`sweep_stopped`@192, `sales_stopped_at`@518/`sweep_stopped_at`@526, `sweep_floor`@631, `cooldown_ceiling`@639, `reserve_ceiling`@647, `max_boost_weight`@711, `max_boost_epochs`@712 — all match GOV's and BURN's constants and the suite's `OFF_*`. VaultRecord: `asset`@9, `mint_index`@41, `level`@57, `active`@125, `retired`@126, `pending`@177, `request_epoch`@178, `boost_weight`@186, `boost_end_epoch`@187, `carry`@195; `VAULT_RECORD_SPACE` = 221 (matches SPEC's rent figure). BurnConfig: `burned_total`@42, `redeem_window_secs`@50, `rate_head`@58, `rate_ring`@59. SEAL Config: `collection`@9, reserves `Vec` at 41. Every read is pinned by address, owner, discriminator AND version byte, so a layout that moved fails loudly. The sweep helper's classic-SPL offsets (mint 0, owner 32, amount 64, state 108, length 165) are correct, and its delegate/close-authority handling is the C5 case the page routes around.

---

## R8. The suite, the simulation and the build as evidence

The `because()` pins name the exact error and, where a bare `ProgramError` carries no name, the failing program (SR.6–SR.14, SR.5 family); ID.1 proves every assertion id is unique so a pin can only read its own arm. The floors must EQUAL the counts. The rehearsal-tree proof (reverse map recreates HEAD byte-for-byte, git names the same files, no abbreviated id survives) is real but **stale** (proven at `d57ee3a`; item 53 correctly stays OPEN). The build proves the key by behavior and the sweep helper's bytes by `cmp` in three places.

Two findings survive here:

### LOW — `rescue_nested`: four host-validation branches have no arm
**Construct:** `programs/cbob-vault-mint/src/lib.rs` `rescue_nested`; the host checks (`require_live_vault`'s owner/key/collection tests; `is_burned`'s owner/length/key tests).
**Gap:** the suite's R35.N1–N9/N2a/N8a cover a live CBOB host, a burned CBOB host, a self host, a never-created host and a foreign *live* host. No arm exercises: (a) `host` = the collection account itself (fails `require_live_vault` at the `KEY_ASSET_V1` byte), (b) `host` = a non-Core account such as a token account (fails at the owner check), (c) `host` = a foreign *burned* asset (the `is_burned` orphan branch with a non-collection tombstone → Squads), (d) the two-vault cycle (V in PDA(H), H in PDA(V) → both rescue to Squads, one level per call).
**What an accident gains:** nothing today — the checks are present and readable. The risk is evidentiary: these branches are load-bearing for the review-M2 refusal (a foreign host must not have its vault extracted), and a future regression in the untested shapes would pass the suite silently. This is exactly the class round 30's L1 (a path bundled once counts forever) exists to catch.
**Evidence if right:** `grep` the suite for a collection account, a token account, or a foreign tombstone passed as `host`, or a two-vault cycle — none exists; the branches are at `require_live_vault(&a.host, …)` and `is_burned(&a.host)`.
**Fix:** four arms (each refused for its named reason, or landing at the Squads for (c) and (d)). Low priority; the main shapes are measured.

### LOW — the redeem page's "Run a payout" cannot expire a due boost
**Construct:** `web/src/pages/redeem.mjs` `payoutBlock`; it joins waiting vaults (`waitingVaults` + `poolClaim`) and then calls `distribute` (100 $GARY burn), but never builds an `expire_boosts` instruction.
**What an accident gains:** nothing; the accident is the holder's. If any boost is due, MINT's `distribute` refuses `BoostsExpireFirst`, the page's dry run fails before anything is signed, and the page offers no remedy (the error text says "claim it; it is free", but the page's payout block only joins *waiting* vaults — it does not claim/expire a *boosted* one). The holder can still open the vault (the redemption does not depend on the payout); the crank expires due boosts every pass, so the window is about a minute.
**Evidence if right:** `payoutBlock` builds only `poolClaim` and `distribute` instructions; MINT's `distribute` has `require!(ctx.accounts.config.boosts_due == 0, MintError::BoostsExpireFirst)` before any burn. No `expire_boosts` builder exists in `web/src/lib/ix.mjs`.
**Fix:** offer an `expire_boosts` step (permissionless, records only) before the distribute when the read shows `boosts_due > 0`, or note on the page that the draw/payout job clears it within a minute. Nothing is lost either way.

**Arms that cannot fail / wrong-reason risks I checked and cleared:** SR.12b proves the duplicate-source refusal reaches the *second, closed* source rather than the first-owner guard; S7.2! predicts the single correct refusal reason from chain state before attempting; R35.N8a pins Core's measured codes (0x1a/0x1a/0x1b) rather than mapping every failure to REJECT; the `expiry-budget` gate asserts the 20 `CBOB_BOOST_EXPIRED` log lines, not just a clean exit. The sim's S9b is the only place two redemptions land in one transaction (the main suite's census never reaches a cap of two) — it is a real v0 landing through a lookup table, not a size estimate.

---

## The accepted limits, against the four questions

1. **Is any limit worse than stated?** I checked the newest (58) hardest: the rescue is bounded to nested vaults and to the Squads; the Squads' ability to vote with a held vault is stated; the stuck-forever cases (a foreign host that cannot Execute, a marketplace escrow PDA, a non-Core-signer PDA owner) are stated and are the ones I independently derive from the checks. Item 46's hot-wallet powers, item 40's three Core-upgrade consequences, item 28's freeze consequences (including the pool-frozen forfeit), item 32's queueing, item 47's permanence-at-low-turnout, and item 41's "the cap does not stop a key thief who transfers first" are all stated at or above what the code does. **None is worse than stated.**
2. **Anything listed as a limit that is not one?** Item 9 and item 44 are narrower after item 58 (a nested *CBOB vault* is recoverable) and both say so; the foreign-asset and Token-2022 cases remain real. No listed limit is already silently closed.
3. **Any DISCHARGED item not discharged?** 51 (boost) and 54 (compute) are measured; 30/31/33 are gone with the mechanisms they were about; 1a–24 went with the Bank/deck/distributor; 14 and 19 are closed on chain and by construction. **None is falsely discharged.**
4. **Any OPEN AND BLOCKING item quietly treated as accepted?** No. Item 22 names its five rehearsal pass/fail items; item 38 still has the charter date and lock deadline OPEN; item 50 is built but explicitly staged-not-published (and the holder guide remains DRAFT gated on it); item 52 is handled by the ceremony's steps but not started; item 53's proof is admitted stale.

---

## Anything else

- **Review-rescue L1 is real but off-chain:** for a *burned* host, "return to whoever sent it in" can name the wrong person (the host's last owner controlled the vault at burn time; BURN's `VaultBurned.owner` and the burn transaction name them). The rescue itself is correct; the Squads' return runbook should name both the original sender and the host's last owner. A runbook line, not a code change.
- **The buy page is the one holder transaction not landed on a validator** (the e2e harness runs no voted round). Its `mint_vault` is byte-identical to the suite's `ixMint`, which lands hundreds of times; the risk is wiring-only and is disclosed in the README. Acceptable, but the dress rehearsal should land one real buy through the real page.
- **`bank/txread.mjs` and `bank/sigwalk.mjs` (bundled whole):** the truncation marker is an exact element match (`includes('Log truncated')`), so a program's own `Program log: Log truncated` cannot false-flag; the `flag` path validates every other field and the scanners page the gap rather than losing it silently; v1 requires `transactionConfig` and no lookup-table keys; the walk's `until` sentinel semantics and `startBefore` resume are the measured ones. I find no silent-loss or over-advance path in either.

---

## Given that no human firm will ever see this and the programs will be immutable

What AI audit structurally cannot do is *execute against reality at stake* and *independently reproduce the inputs to its own reasoning*. Before launch, concretely:

1. **Run the dress rehearsal (item 22) as the non-negotiable gate it is named as** — the crank and alarm live against the rehearsal deployment, one full revenue cycle through *each* pool with Orca forced to refuse once, and one forced post-sweep failure walked through the hand recovery to a clean `--audit`. No suite, sim or fork runs `bank/revenue.mjs` end to end; only this does.
2. **A real-value canary on mainnet before the charter window opens:** one vault, small real cbBTC, through its whole life — mint, draw, activate, a real distribution, a real claim, and a real redemption through the helper via the real redeem page and the real RPC proxy. The Test Vault proves this on a validator; only mainnet proves the real DAS, the real rent, the real Core and the real page together.
3. **Independent build reproduction on a second machine by a second person:** `build-mainnet.sh` itself states it has NOT proven the compiled constant *is* Gary's key — only reproducibility bridges that. Rebuild from the frozen commit elsewhere and confirm the five sha256s before step 9, and re-dump after step 11.
4. **An independent derivation of the launch values:** `check-launch-params.mjs` proves the JSON equals the alarm's production list — but it *imports that list*, so a wrong RULED value living in both would pass. A human derives each value from DESIGN-v6 and the recorded rulings and compares against `launch/mainnet-init.json` before the ceremony. The charter date and lock deadline are still OPEN; the lock deadline must precede `charter_opens_at`.
5. **A launch-day Core check:** the suite pins one Core sha256; Metaplex can upgrade Core between the last green run and launch day. Re-dump and compare Core on the day, before the first mint — the alarm watches it continuously, but the gate moment needs its own positive check.
6. **A human read of the holder guide against the finished pages:** the pages are the newest surface and the guide's promises about them (deposit address, the redeem warnings, the rescue wording) are the sentences most likely to have drifted. The guide may not be published before item 50 ships; that read is the last gate on it.