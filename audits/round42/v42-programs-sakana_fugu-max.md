# Round 42 audit — v6 tree, all five programs plus `web/`

I read the whole bundle. I could not run anything: no validator, no `scripts/run-tests.sh`, no `sim/run-sim.sh`, no `web/test/run-all.mjs`, no `web/test/e2e-localnet.sh`, no network. Everything below is read against the source in this bundle, with the arithmetic recomputed by hand. Where I say "verified" I mean recomputed from the struct definitions and the handlers in this bundle; where I say "cannot verify" I say why.

Files named in the targets that are **not in this bundle** and that I therefore could not audit: `bank/crank.mjs`, `bank/detectors.mjs`, `bank/alarm.mjs`, `bank/anchor.mjs`, `bank/layout.mjs`, `bank/selftest.mjs`, `bank/swap.mjs`, `bank/revenue.mjs`, `bank/accrual.mjs`, `bank/redemption-poster.mjs`, `scripts/check-launch-params.mjs`, `web/test/*` except `e2e-localnet.mjs`, `web/src/lib/plan-redeem.mjs`'s dependency `judgeRedemptionCoverage`/`classifyPdaTokenAccount`. Several claims in R2, R2b, R8 and the control table rest on those files and are outside what I can measure here.

---

## R0 — round 41's verdict and its repairs

Round 41 was NOT CLEAN on both passes with one confirmed LOW, `V41-1`: a stranger's ~0.00065 SOL at each of the four program config addresses left a System-owned, 0-byte account, and the ceremony page read it as a wrong-owner config, stopping the launch with a false "not owned by its program".

**The repair holds at every site I can see.** `absentIfDust` (`web/src/lib/decode.mjs`) is applied in:

- `anchorAccount` (`web/src/lib/reads.mjs`) — the vault record, and every config a page reads through it;
- `resolveCollection`'s SEAL read and `readStep`'s reads (`web/src/lib/ceremony-reads.mjs`), which are the two sites the verdict names;
- `readBuySnapshot`'s two ATAs (`web/src/lib/reads.mjs`);
- `readStep`'s `collection` and `atas`/`fund` steps, and `withCollection`/`collectionsOfMint` paths;
- the whole `vaultWalletAccounts` by-address read and `coreAssetsOwnedBy`.

I could not find a config, record, pool or collection read in `web/src` that omits it. The e2e arm the verdict asked for exists (`web/test/e2e-localnet.mjs`: all four config addresses dusted with 890,880 lamports each before step 0, then every step re-read as done).

**One thing the repair does not cover, and it is the same shape.** `readVault`'s read of the **asset** (`web/src/lib/reads.mjs`) has no `absentIfDust`:

```js
const a = await account(conn, asset, 'the vault')
if (a) {
  if (!a.owner.equals(ids.CORE)) throw new ReadError('That address is not a Metaplex Core NFT.')
```

A stranger's lamports at the address of a vault that does not exist therefore make `/vault/` and `/redeem/` print "That address is not a Metaplex Core NFT" instead of "there is no NFT at that address". No value is at stake, nothing is signed, and `web/README.md`'s V40-1/V41-1 lists do not include the asset (the asset is created by a keypair signature, not a `create` an attacker can front-run), so this is consistent with the documented scope. I note it only because the verdict's own follow-up instruction was to sweep "every reader of a DERIVED address, PDA or ATA", and a wrong-owner message is exactly the shape V40-1 exists to remove. **INFO.**

**Round 41's rejected claims that I re-tested and agree with:** C3 (a stranger cannot initialize or allocate at a reserve ATA address — the address's signature is required; nothing in this bundle contradicts it), C10 (`R40.U1`'s assertion is `unitsConsumed ≤ 200,000 × ixs`, which is a real bound), C11 (`ownerAtas` are classic derivations, so a Token-2022 account cannot sit at one), C14/C15/C16 (the repeated `!` ids are deliberate double pins and `ID.1` excludes them on purpose), C21 (the limit-32 sentence states the act, not the cost).

**Round 41's claims I could not re-measure:** C4 (`txread` accepting `logMessages: []` — `bank/txread.mjs` is in this bundle and the check is real, but the premise is an RPC that drops invoke lines, which I cannot provoke), and the `m41.mjs` dust measurements (no connection here).

---

## R1 — custody: can anyone but the owner get value out of a sealed vault?

I attacked the pairing and the emptiness proof from the source and found nothing.

**The pairing binds asset and owner in both directions, at fixed positions, and fails closed.** `SEAL_IX_ASSET_IDX = 0`, `SEAL_IX_OWNER_IDX = 2`, `BURN_IX_ASSET_IDX = 0`, `BURN_IX_OWNER_IDX = 2`, and both walks use `load_instruction_at_checked`, which sees top-level instructions only. A wrapped `open` reports the outer instruction's index, so a wrapper needs a genuine top-level burn after it — and BURN independently needs a genuine top-level open before it. Both halves bind the same pair, so a two-vault transaction cannot borrow either half. `WR.1`–`WR.4` and `3.9`/`3.10`/`4.10` pin the shapes.

**The thaw cannot survive the transaction.** `open_for_redemption` is the only thaw, it requires the burn, and the burn destroys the asset. A partial sweep reverts (3.11). A bare `ExecuteV1` on a frozen vault is refused by Core (3.7, with the decoded state showing the signer *is* the owner and the seal *is* frozen, so the refusal is the seal and not the authority).

**The emptiness proof.** I recomputed every offset BURN reads against a 165-byte classic account: `owner[32..64]`, `amount[64..72]`, delegate tag `[72..76]`, state `[108]`, `delegated_amount[121..129]`, close-authority tag `[129..133]`. All correct, and the same three comparisons appear in both loops (the reserve loop and the declared-token loop), which is the fix for the "two loops that should agree" class. The reserve list is read from SEAL's config and never kept locally.

**What I could not close, and it is the documented gap.** A classic **non-ATA** token account owned by the vault PDA, of any mint, is invisible to BURN unless declared (it looks only for the derived ATA). It is also invisible to `initialize`'s reserve checks. The page can name it (the helper sweeps any 165-byte account the PDA owns when given a same-mint destination) and `judgeRedemptionCoverage` can flag it, but that is a page obligation and the page is not published. That is accepted limit 44 and proven impossibility 2, and it is correctly stated.

**No finding.**

---

## R1s — the sweep helper

I walked (a)–(g).

**(a) Who can run it.** Core's `ExecuteV1` is the whole gate. Read from this bundle's own test set: `SR.5`/`SR.5a` refuse a stranger and an owner-added transfer delegate on a genuinely thawed vault with `0x1a` (`NoApprovals`); `SR.5b` pins the CBOB collection's update authority to MINT's off-curve PDA; `SR.5c` refuses the collection update authority on a control asset; `SR.5d` lets its owner sweep to zero; `SR.5e` checks every refused attempt left balances, owner and seal untouched. And the helper cannot be reached while frozen: `open_for_redemption` is the only thaw and it demands a terminal burn. Sound.

**(b) The pair list.** Every branch is refused for the reason named, and the pins in `3prog.test.ts` name the helper's own text (`CBOB_SWEEP refused: source …`, `… destination …`) or the exact `ProgramError` (`invalid instruction data`, `insufficient account keys for instruction`, `incorrect program id for instruction`, `invalid program argument`, `Provided owner is not allowed`). Odd and zero-pair lists are handled (`accounts.len() < 4 || (len-4) % 2 != 0` refused; zero pairs is the lamports-only sweep, `SR.13`). A duplicate source is refused at the second, already-closed account — `SR.12b` asserts the refusal did *not* carry the helper's own message, i.e. it is the `read_token` owner check, not the pair guard. A source that is also a destination reverts the same way. `signer.key == dest.key` is refused. A native wSOL source: the helper transfers and then closes; a native account with a residual amount is `NonNativeHasBalance`, which reverts the whole call — the same shape as `SR.3`.

**(c) The destination.** Chosen by whoever builds the transaction; only the owner can make Core Execute, so the builder is the owner. The helper never compares the destination with the asset's owner, and it does not need to. A destination below rent exemption that does not exist is refused by the runtime (`R41.C8a`/`C8c`), and the canonical destination (the owner, who pays the fee) exists.

**(d) The lamport sweep.** `signer.lamports()` read at execution, transferred in full, leaving 0. BURN's `asset_signer.lamports() == 0` is checked first, before any reserve loop. `SR.4a` measures the exact delta including the stranger's gift, the closed account's rent, the asset's released lamports and the fee. Nothing in Core adds lamports to the asset-signer PDA inside `ExecuteV1` (proven impossibility 4 and `SR.4a`).

**(e) Interaction with BURN.** The closed account passes because after `close_account` the account is either no longer Token-owned or its data no longer carries the PDA as owner; the suite's `sweep()` + `ixBurn(..., declare(...))` shape has passed since v5, and `SR.13` covers the no-token-account case. The case that remains — a reserve ATA that does not exist when the page builds — is handled by the prior transaction (item 42), and a stranger's permissionless classic ATA creation between the read and the redemption is harmless because the helper sweeps the **live** balance and the prior create is idempotent. The account a stranger can create that neither the helper nor BURN handles is a Token-2022 account (the helper reads only 165-byte classic accounts; BURN refuses a declared one with `ReserveHasExtensions` and destroys an undeclared one), and the page names it in a box. Accepted limit 44.

**(f) Does it fit.** I cannot re-measure. The bundle's own figures are 1,061 bytes (S8.0, with room for the compute-budget pair and a separate payer) and 1,152 bytes for the e2e's redemption carrying C5 transfers. The prompt's own "1,232 bytes" figure for S8.0 does not match the file in this bundle, which asserts `B <= 1232 - 52 - 96`; the file is the authority. **INFO** (a prompt/record mismatch, not a code claim).

**(g) Evidence.** `SR.0`–`SR.12b`, `SR.13`, `SR.14` and `SR.5`–`SR.5e` are present and each negative is pinned. The helper is built from a crate with **no** `localnet` feature, so the tested bytes and the shipped bytes are the same compilation; `scripts/build-mainnet.sh` `cmp`s `dist/`, `target/deploy/` and the localnet release output.

**No finding.** One caveat I could not close: whether `SPL Token close_account` refuses a **frozen** account is a library fact I cannot read from this bundle, and the page's plan never names a frozen account as a helper pair, so it does not arise on the page's own path.

---

## R2 — the community pool

I recomputed the `MintConfig` layout field by field and it matches every offset GOV, BURN and the suite read: `governance` 41, `pool_ata` 73, `minted_total` 141, `sales_stopped_at` 518, `sweep_stopped_at` 526, `bare_burns_retired` 454, `charter_closes_at` 442, `sol_reserve_lamports` 257, `max_sweep_lamports` 266, `sweep_cooldown_secs` 274, `sweep_floor_lamports` 631, `cooldown_ceiling_secs` 639, `reserve_ceiling_lamports` 647, `dist_epoch` 655, `pending_count` 663, `pending_this_epoch` 671, `cbob_mint` 679, `max_boost_weight` 711, `max_boost_epochs` 712, `boost_price` 714, `boost_weight` 722, `boost_epochs` 723, `boosts_active` 725, `boosts_due` 729, `boost_weight_total` 733, `cbob_burned_total` 741, `boost_expiring` 749. `MINT_CONFIG_SPACE` evaluates to 1,261, which equals the struct's serialized size (1,005 + 256). `VAULT_RECORD_SPACE` = 221. `BurnConfig` `burned_total` 42, `redeem_window_secs` 50, `rate_head` 58, `rate_ring` 59..571. `VaultRecord` `active` 125, `retired` 126, `boost_weight` 186, `boost_end_epoch` 187, `carry_scaled` 195 — which is exactly `dueBoostRecords`' `dataSlice {offset: 125, length: 70}` and its `d[61]`/`d.readBigUInt64LE(62)`.

**The invariant `pool balance ≥ ceil(owed)`.** `credit` adds `floor(avail × 1e12 / w) × w ≤ avail × 1e12` to `owed_scaled`, so `ceil(owed_new) ≤ ceil(owed) + avail = balance`. `claim` subtracts exactly `pay × 1e12`, so the difference is preserved. `reweigh` preserves each vault's contribution. `join` adds a vault with contribution 0. `retire` subtracts exactly the vault's contribution. `distribute` refuses `PoolShort` before crediting. I could not construct a break.

**The counters.** `pending_this_epoch` is reset only by `advance_epoch`, which increments `dist_epoch`; so a vault with `request_epoch == dist_epoch` always has `pending_this_epoch ≥ 1` and `retire`'s conditional decrement cannot underflow. `waiting_to_join = pending_count − pending_this_epoch` counts exactly the pending vaults from earlier epochs, and `waitingVaults` in `reads.mjs` filters the same predicate. `JoinWaitingFirst` is checked before any $GARY is burned in both `distribute` paths and in `monthly_inline`, so nothing can be credited between a vault becoming eligible and joining — which is also what makes `debt = weight × acc` exact at join.

**Liveness.** `BoostsExpireFirst` and `JoinWaitingFirst` are both clearable by a permissionless instruction (`expire_boosts`, `claim`), so neither can be held shut by a stranger. A due boost blocks both the explicit `distribute` and the in-line run, and `boost_vault` is the only host that does not check `boosts_due` — it can still be called, which is correct (a buyer may buy while another boost is due) and cannot strand anything, because the new boost lands in a different ring slot (`epochs ≥ 1`) and `expire_boosts` clears the old one.

**No finding.** `bank/accrual.mjs` (the off-chain mirror) and `bank/crank.mjs`'s join/expire ordering are not in this bundle.

---

## R2b — the $CBOB boost

**Ring collision.** All live end epochs lie in `(dist_epoch, dist_epoch + 63]` — a boost bought at epoch `P` ends at `P + n`, `n ≤ 63`, and it is live only while `dist_epoch < end`, so `dist_epoch < end ≤ P + 63 ≤ dist_epoch + 63`. That is 63 values with 63 distinct residues mod 64, so no two live boosts share a slot, and `advance_epoch`'s `boost_expiring[i] = 0` cannot erase a live boost's count. The host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` drives 260 epochs through `join`/`reweigh`/`retire`/`expire_boost`/`credit`/`tick` and checks the ring index by index.

**Exactly N distributions.** The distribution that ends a boost makes it due (`advance_epoch` moves the ring count to `boosts_due`), and no distribution runs while `boosts_due > 0` (`distribute` and `monthly_inline` both refuse/defer), so the accumulator is frozen at the boost's last distribution when it is expired — which is what makes the `carry`/`debt` reset exact. `BO.21`/`BO.35` measure both orderings of `[boost, distribute]` and `[distribute, boost]` in one transaction.

**Nothing earned is lost or gained.** `reweigh` computes `owed = weight·acc + carry − debt`, sets `carry = owed`, `debt = new_weight·acc`, and adjusts `total_active_weight` by the difference — so the vault's contribution to `owed_scaled` is unchanged, and `owed_scaled` is deliberately not touched. `unschedule_boost` handles both branches (due → `boosts_due`, not-yet-due → the ring slot) and is exercised at a **wrapped** index by `BO.38`.

**Expiry exactly once, never early, never never.** `expire_boost` requires `boost_weight > 0 && dist_epoch >= boost_end_epoch`; `expire_boosts` skips retired/inactive/not-due records rather than failing; `claim` expires first and then pays, at the accumulator its last distribution left. A due boost on a **frozen** destination expires inside the claim and the payment is deferred, staying owed in full (`BO.37`/`BO.37a`).

**Owner-only.** `boost_vault` reads the asset's **current** owner from `d[1..33]` at execution and requires the burner to be it (`BO.33`/`BO.33a` for a sold vault), the $CBOB mint is pinned by address **and** by classic-SPL owner, the amount is a real SPL `Burn`, and the buyer's terms are checked against the live terms before anything is burned (`BoostTermsMoved`).

**No finding.**

---

## R3 — the level draw

`blockhash_in_window` pins the sysvar id, bounds the declared count at 512, checks the buffer holds `8 + n·40`, and refuses an all-zero hash rather than feeding it into a draw. `try_capture` walks A (smallest produced slot in `[reveal_slot, reveal_slot + 64]`), then B and C each two 4-slot groups after the previous hash's group, and returns `NotYet` rather than a partial draw. `capture_entropy` stores the entropy on the record so every draw is replayable (`L.3c` re-derives it from the raw sysvar; `L.23` replays every draw against the census at its turn).

**FIFO.** `reveal_level` requires `index == config.revealed_total`, so the order is not a choice. A burned vault at the head still takes its draw (`L.11`, and `reveal_level` skips the Core write when the asset is a positive tombstone).

**Missed window.** `reschedule_reveal` requires the window to have **passed** and moves the target to `now + 16` — a slot that does not exist when the call lands — so a reschedule can never choose among hashes anyone can already see. `L.17` measures the new slot against the landing slot.

**Who can influence.** Limit 26 states the residual: C's leader can skip within its own 4-slot group (best-of-4, P(V) 5.0% → 18.6%) and vary its block's contents, for every vault minted in the same slot at once, because they share the same `reveal_slot`. Round 24's `64 tries reach 96%` is stated. I re-derived the draw arithmetic (`u64::from_le_bytes(entropy[0..8]) % total`, walked across `level_caps − level_minted`) and it matches `drawOf` in the suite. **This is not worse than SPEC 26 states, and HOLDER-GUIDE.md now says it truly** ("the validator producing the last of those blocks can pick among several results … one choice affects every vault created in that moment at once").

**No finding.**

---

## R4 — governance

**Electorate fixed at creation.** `index_snapshot = minted_total` at creation; `cast_vote` requires `index < snapshot` (`VaultTooNew`); the `VoteRecord` PDA is seeded by the **asset**, so a vault votes once however many times it changes hands (`7.7`/`7.9`). `read_vault_index` pins the PDA derivation, the owner program, the discriminator, the version **and** the asset written inside the record — so a vote cannot smuggle in an older mint index (`G.3`).

**Quorum divisor.** `quorum_supply = minted_total − burned_total − bare_burns_retired` at creation, and the divisor at execute is the snapshot, never `max(snapshot, live)` — so a vault minted mid-vote can neither vote nor move the bar. Burns lower the divisor (`G.8`/`G.9`).

**Minority cannot carry what it should not.** `need = ceil(snapshot × quorum_bps / 10⁴)`, `yes_bps = yes × 10⁴ / cast ≥ threshold`, `need_yes = ceil(snapshot × 1000 / 10⁴)`, and for a key change `need_key = ceil(snapshot × 5000 / 10⁴)`. `KeyChangesBundled` forbids a guardian change and an operator arm in one proposal, checked both at creation and at execute.

**A vote cannot reach money it should not.** The only vote-carried struct is `SweepTighten`, whose fields are three `Option`s of `u64`/`i64`/`i64`; `P.0e`/`P.0f` assert neither program carries a field for a destination, the split or the supply, and that no `WiringArgs` survives.

**Overtaken actions.** Per kind (`last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`), skipped and logged, never a revert; a round already over still moves the mark so an older round cannot land after it (`3c.R1`). `tighten_sweep` is `max`/`min`, so execution order does not matter (`8.14b`).

**Freeze forever.** Limit 47 states it: a stolen guardian key holds sales and the sweep shut for good while fewer than half of all live vaults vote YES. `create_proposal` also needs a live vault, and `execute_proposal` needs `now ≥ voting_ends_at` and within 7 days. **I did not find a way to freeze governance that is not already stated.**

**No finding.**

---

## R5 — the charter claim

Identity by **address** against a Merkle root of 240 leaves, domain-separated (`0x00` leaf / `0x01` node) with sorted pairs and a promoted odd node; `MAX_POB_PROOF = 16`. The PoB is checked to be a live Core `AssetV1` in the pinned collection **and owned by the signer**, then burned by CPI as its owner in the same instruction. `pob_extra` accounts are appended **never as signers**. The window is a clock comparison against two `initialize` values with no setter. Not gated by the guardian's stop.

**Is SPEC 46 complete?** I read it against the code. It now states the full consequence: the hot update authority can end the project before it starts or capture governance through the window; the alarm samples collection state once a pass so an add-and-remove between passes is not paged; the alarm watches the collection, not the 240 individual assets, so a per-asset plugin is not paged; and the positive bound (that key cannot transfer or burn an individual PoB). The page refuses a PoB or collection carrying an external plugin rather than guessing. **Nothing that wallet, a PoB holder or a third party can do is omitted that I can find.** The one thing worth restating for the record: the mitigation that matters (the pass-through) is **not used by the page**, so during the window a hook added by that key stops page claims until the page is rebuilt — which SPEC 46 says.

**No finding.**

---

## R6 — the one-time configuration and the trusted hop

I checked every `initialize`'s accept/refuse set against the bounds it enforces: MINT refuses a default treasury, a non-reserve payment mint, an already-over charter window, an all-zero PoB root, a monthly period over 30 days, a notice under 60 s, a floor above the cap, a ceiling above 10 SOL, a reserve between 0 and rent exemption, a `$CBOB` mint equal to the payment mint or `$GARY`, a `$CBOB` mint that is not a 82-byte initialized classic mint, a boost weight bound outside 1..12 and an epochs bound outside 1..63, and it cross-checks SEAL's collection and reserves. SEAL refuses an empty or over-long reserve list and any non-classic-SPL reserve account. BURN refuses a SEAL that names another collection and a window outside 10 s..24 h. GOV refuses a MINT that names another collection, a quorum under 500 bps, a threshold at or under 5,000 or over 7,500, and a voting period outside 60 s..30 days. Each `initialize` checks the authority **first** so the probes can prove the key.

**The royalty.** `initialize` sends `AddCollectionPluginV1` with `PLUGIN_AUTHORITY_NONE`; `R.3`, `R.5`/`R.6`, `R.6a` and `R33.G3` measure that even the update authority cannot rewrite, remove or re-delegate it, with controls that prove the calls are well formed.

**The redemption cap.** `RATE_RING = 64`, `rate_head`, `rate_ring`, and `burn_vault` requires `now − rate_ring[(head + 64 − k) % 64] ≥ redeem_window_secs` where `k = min(max(1, ceil(live × 210 / 10⁴)), 64)`. That is exactly a rolling window over the last 64 times. `RL.2`/`RL.3`/`RL.4` and `RL.7` measure it.

**The trusted hop.** `sweep_sol_for_swap` pins the destination, requires the operator's signature, bounds the amount by `max_sweep_lamports`, enforces the cooldown on the chain clock, and refuses below `sol_reserve_lamports`. `bank/swap.mjs` is not in this bundle.

**No finding.**

---

## R7 — cross-program raw reads

I recomputed all of them (listed under R2) and they match the structs. `read_mint_config` bounds `d.len() >= OFF_MINT_MAX_BOOST_EPOCHS + 2`, which covers every offset it reads; `read_mint_supply` bounds `d.len() >= OFF_MINT_BARE_RETIRED + 8`; `read_burn_total` bounds `d.len() >= OFF_BURN_TOTAL + 8`; `read_vault_index` bounds `d.len() >= OFF_REC_INDEX + 8`; the SEAL reads bound `d.len() >= OFF_RESERVES + 4 + n·32`. Every reader pins the address (by PDA derivation where one exists), the owner program, the Anchor discriminator and a version byte declared first. The sweep helper's classic-token offsets (`mint 0`, `owner 32`, `amount 64`, length 165) are correct.

**No finding.**

---

## R8 — the suite, the simulation and the build as evidence

I read `tests/3prog.test.ts`, `sim/test-vault.ts`, `tests/expiry-budget.mjs`, `scripts/run-tests.sh`, `scripts/build-mainnet.sh`, `sim/run-sim.sh`, `tests/initauth.test.ts` and `tests/cpi-wrapper/src/lib.rs`.

**Arms that cannot fail.** I looked for them and did not find one. `ID.1` genuinely can go red (it enumerates duplicate base ids and excludes `!` ids on purpose). `P.11a`'s expected string is now fixed and cannot be satisfied by an empty pick list. `P.2a`'s condition can fail when the candidate list is short. `X.5` asserts the perturbed hash does *not* match. `R40.U1` asserts a numeric bound. `L.23a` asserts zero vaults were drawn without entropy. Every `rec` compares `want` with a computed `got`.

**Negatives firing for the wrong reason.** The `because()` list pins the reason for essentially every negative, and the ones I checked are exact strings measured from this binary or from the runtime (`0x9`, `0x1a`, `0x1b`, `0x28`, `0x11`, `0x4`, `0xb`, `0x0`, `InstructionFallbackNotFound`, `invalid instruction data`, `insufficient account keys for instruction`, `incorrect program id for instruction`, `invalid program argument`, `Provided owner is not allowed`, `missing required signature for instruction`). `ID.1` guarantees a pin reads its own arm. The two deliberately weaker pins (`SR.11` and `SR.12` and `SR.14` are each pinned twice, so either text satisfies) are weaker but not wrong.

**Claims in the prompt that no arm exercises.** The prompt's own figure "1,232 bytes" for S8.0 does not match this bundle's S8.0, which asserts `B ≤ 1232 − 52 − 96`. **INFO** (a prompt/record mismatch).

**Mainnet bytes.** `scripts/build-mainnet.sh` refuses a dirty tree, `cmp`s the sweep helper's mainnet bytes against **both** its own localnet rebuild and `target/deploy/` (the bytes the suite and the sim deployed), asks all four keyed artifacts whether they trust the localnet test key (mainnet must REJECT for `NotTheInitAuthority`, localnet must ACCEPT), and states plainly that it cannot prove the compiled constant *is* Gary's key. That is honest and it is the right bound.

**No finding in the programs.** `bank/` and `web/test/*` (except `e2e-localnet.mjs`) are outside this bundle.

---

## The four questions about the accepted limits

**1. Is any limit WORSE than stated?**

I looked at each ACCEPTED item and could not widen any of them. The one I tried hardest to widen and could not:

- **28 (a frozen vault cbBTC account blocks the whole redemption).** The stated mechanism is "BURN requires every reserve account empty and a frozen account cannot be emptied". That is not the only mechanism, and the limit is *broader* than its stated reason: `claim` defers a frozen destination (`CBOB_CLAIM_DEFERRED_FROZEN`) **only when it owes a whole sat**, and `retire_redeemed` then refuses `ClaimBeforeBurn` unless the pool is frozen. So a frozen cbBTC account with a **zero balance** also blocks the redemption whenever the vault is owed ≥ 1 sat. I checked whether that state is reachable and it is **not** by itself: `activate` requires ≥ 21,000 sats in the vault's own cbBTC account, and a sealed vault's balance can only rise, so an activated vault's cbBTC account always holds ≥ 21,000 sats, and the redeem page already refuses a frozen reserve account with a positive balance (`t.state === TOKEN_FROZEN && t.amount > 0n`). The only route to "frozen, zero balance, owed ≥ 1 sat" is the owner deliberately closing their own empty vault ATA through Core `ExecuteV1` and then having distributions credit the vault — which is the owner's own act, not a stranger's. So the limit is **not worse than stated in any reachable way**, and the page's narrower refusal is correct for every reachable state. **I am recording this as a checked-and-refuted candidate, not a finding**, because the prompt's rule is that a claim about my own reasoning is not a claim about the code.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?**

I did not find one. The two I tested hardest:

- **13 (a level is immutable only as far as MINT's upgrade authority is trustworthy).** Correctly still a limit; the only writer is `reveal_level` and the Attributes plugin's authority is MINT's PDA, so Core refuses everyone else (`11.13`/`11.14`), but the program itself could be replaced until step 11.
- **44 (undeclared airdrops destroyed).** Not closed on chain and not closed off chain while the page is unpublished. Correctly stated.

**3. Is any DISCHARGED item not actually discharged?**

No. Item 14 (`DuplicateAttribute`), 19 (no unlevelled activated vault), 30 (`update_wiring` deleted), 31 (cadence is an `initialize` value, exercised), 33 (notice is an `initialize` value, exercised), 12/17 (compute measured), 51 (the boost, built and measured), 54 (compute at the widest host shapes, measured) all hold in this tree. Items 1a–24 went with the Bank, the deck, the co-signer and the distributor, and none of those exist here.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No, and I checked each against the tree:

- **22** (nothing has run a distribution against a live chain): `bank/crank.mjs` is not in this bundle and the sim is a local validator. Still open.
- **38** (every `initialize` value is written once): `launch/mainnet-init.json` still has three `OPEN` values (`charter_opens_at`, `lock_deadline`, `vault_collection`) and `web/src/config.js`'s `collection` is `null`, so every holder page refuses. Still open.
- **50** (the surfaces promised to holders): the pages are built in `web/` and staged; `web/README.md` says so; the redeem page is the only client of the sweep helper; `bank/redemption-poster.mjs` has no sender. Still open, and the pages now say so themselves.
- **52** (pool and Squads cbBTC accounts must exist before the first split): the ceremony's step 5 creates them idempotently and step 6 funds the revenue address to rent exemption. The item is a road-step obligation, correctly tracked.
- **53** (a dress rehearsal at throwaway ids cannot run the shipped code unchanged): `scripts/rehearsal-tree.sh` exists; the rehearsal value set and the rehearsal mode of `check-launch-params.mjs` are still named as not built, and `config.js`'s `rehearsal` profile refuses. Still open.

---

## Findings

**No CRITICAL, HIGH or MEDIUM finding. I could not confirm any defect that moves value out of a vault, the pool or the revenue address, and I could not confirm any defect in the five programs at all.** The items below are what I have; each is rated honestly and each names what would be on chain or in a test run if it were wrong.

### L1 (LOW) — the ceremony page does not catch a `ReadError` from `readStep`

**Construct.** `web/src/pages/ceremony.mjs` `steps()`: `const state = await readStep(ctx, s.id)` is not wrapped. `readStep` reaches `anchorAccount` (`web/src/lib/reads.mjs`), which throws `ReadError("<name> at <addr> is not owned by its program.")` for any non-program owner, and `resolveCollection` returns a conflict that `preflight` prints as `STOP`.

**What it costs.** Nothing, today. The only way to reach the throw is an account at a config PDA owned by another program or System-owned **with data** — both require that address's signature, which no one has. So the path is unreachable. It matters only because the round-41 verdict's own gate-5 obligation is "Control: an account at `SEAL_CFG` owned by another program, or System-owned WITH data, still gives the conflict or throw", and the "throw" is not rendered as the page's `WRONG ON CHAIN: STOP` box; it escapes to `run()`'s caller and the ceremony shows a raw message instead of the designed stop.

**Evidence if I am right.** A `ceremony.test.mjs` arm that serves a mock connection with a System-owned account **with data** at `SEAL_CFG`: the current code throws out of `steps()`; after the fix it renders the stop box. (The existing `ceremony.test.mjs` `fake` serves only a SEAL-owned config, so nothing measures this.)

**Fix.** Wrap `readStep` in the step loop and render `box('refuse', …)` for a `ReadError`, exactly as `preflight` does for `resolveCollection`.

### I1 (INFO) — `readVault`'s asset read does not treat System dust as absent

**Construct.** `web/src/lib/reads.mjs` `readVault`: `if (!a.owner.equals(ids.CORE)) throw new ReadError('That address is not a Metaplex Core NFT.')`. Every other reader the round-41 repair touched applies `absentIfDust`.

**What it costs.** A wrong message, and only for an address that holds no vault. `/vault/` and `/redeem/` print "That address is not a Metaplex Core NFT" where V40-1's rule would say "there is no NFT at that address". Nothing is signed and no value is at stake.

**Evidence if I am right.** A `get.test.mjs` arm with a System-owned, 0-byte account at a random address: `/vault/` shows the owner error today.

**Fix.** Apply `absentIfDust` to `a` in `readVault`, or state the scope precisely (the repair covers readers of addresses an attacker can front-run with a `create`; the asset is not one).

### I2 (INFO) — S8.0's byte figure in the prompt does not match the suite in this bundle

The prompt states "the three-asset redemption through the helper, claim included, inside one legacy transaction (1,232 bytes)". `sim/test-vault.ts`'s S8.0 asserts `B <= 1232 - 52 - 96`, i.e. it measures the shape **with room** for the compute-budget pair and a separate fee payer, and reports the raw figure in `n`. The file is the authority; the prompt's figure should be corrected so a future reader does not audit against the wrong number.

### I3 (INFO) — the `bank/` dust rule and the `web/` dust rule are two implementations of one rule

`bank/anchor.mjs`'s `isSystemDust` (added in the round-41 off-chain repairs, A1–A3) and `web/src/lib/decode.mjs`'s `absentIfDust` encode the same judgement in two files in two bundles. This project's most-repeated defect is a fix applied to one of two identical sites. They agree today; nothing measures that they agree. A single shared module, or a test that compares the two predicates, would close the class. Not a defect.

### I4 (INFO) — the reclaim of "R1s (f) does it fit" is not measurable in this bundle

`bank/layout.mjs`, the crank's real batch shapes and the page's compute-budget padding are not here, so I could not re-derive the 1,061/1,152/1,209 figures. The suite's own arms (`S8.0`, `S8.1a`, `9.14a`–`9.14d`, `P.33`, `3c.P1`) are present and internally consistent; the numbers they produce are what I would have to run to confirm.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concretely, in the order I would do it:

1. **Run the dress rehearsal before anything else on the critical path, and make it produce the artifacts, not a summary.** Item 22's five named pass/fail items already list what it must show. What AI audit structurally cannot do is *execute the shipped off-chain code against a live cluster*: the crank's real send path at ~2,100 vaults, `bank/revenue.mjs`'s sweep/re-price/venue-loop/return/split/ledger/recovery, and the alarm's live passes. Each must end with a transaction signature recorded, and the ledger must `--audit` clean afterwards. A rehearsal that passes on a summary has proven nothing that the local suite did not already prove.

2. **Run `scripts/run-tests.sh` with `CBOB_SHIP_GATE=1` from the exact release commit, and keep the whole log.** That is the only run in which the mainnet probe and the swap fork may not be skipped. The floor mechanism (`floor()` requires **equality**, `MIN_ASSERTIONS` requires equality) is the strongest thing in this repository, and it is the thing most easily defeated by running a different commit than the one deployed. Re-run `scripts/rehearsal-tree.sh` at the release commit — item 53's own proof is stale by its own statement.

3. **Recompute the audited byte hashes from the deployed ProgramData, by hand, after step 9 and again after step 11, and record them in the verdict.** `web/src/config.js`'s `programBytes` table is the only thing binding the pages to the audited build, and it is a copy. The ceremony checks the deployed bytes against it; nothing checks that the table is the release build's except `web/build.mjs`'s refusal, which runs at build time on one machine.

4. **Publish the holder pages before removing the upgrade authority, and do not publish HOLDER-GUIDE.md before they are live.** Item 50 is a precondition of step 11 for a reason: v6 removed the Bank, so `judgeRedemptionCoverage` and the sweep helper exist only inside a page. Until the page is live, the only pre-signature control is a document.

5. **Get an adversarial human on two specific things that no model in this loop has been able to test.** First, a red-team of the *page-to-program* contract at the press (the re-plan, the standing consent, the two dry runs, the promised-account re-read) against a live validator with a hostile client landing items between every read — the e2e does this with a scripted adversary, which is not the same as a person trying to break it. Second, a person who is not an engineer reading HOLDER-GUIDE.md and the four pages and writing down what they believe will happen when they open a vault; then compare that to the code. The holder guide is the only place a holder's expectations are set, and every audit round so far has measured it against the code, never against a reader.

6. **Delete or fund the box keys before launch and record it.** `bank/keys/swap-operator.json`, `bank/keys/cbob-release.json`, `bank/keys/deploy-authority.json` and the R2 backup are the four hot keys this design rests on outside the programs. The rehearsal must be run with the production cron **not** installed (`scripts/cron-install.sh` refuses a rehearsal tree; make sure the reverse is also true), and after step 11 the deploy-authority key should be destroyed or moved off the box.

7. **State the one thing a human firm would have caught and AI rounds have not: nobody has watched a holder use this.** Every round has read the code against itself. Before the lock, have someone who has never seen the code claim a Proof of Burn, activate, receive a payout and open a vault on the real network with a small amount, while someone watches the alarm. If anything surprises them, that surprise is the finding this process cannot produce.