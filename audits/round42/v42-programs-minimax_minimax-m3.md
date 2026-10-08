# Round 42 Audit Report — v6 Programs, web/, and Off-Chain Pipeline

## 0. Scope, method, and measurement discipline

I read every file in the bundle: the five programs, `bank/txread.mjs`, `bank/sigwalk.mjs`, `scripts/run-tests.sh`, `scripts/build-mainnet.sh`, the full `web/` tree (pages, libraries, ceremony, metadata generator, RPC proxy, offline and e2e tests), `SPEC.md`, `DESIGN-v6.md`, `HOLDER-GUIDE.md`, `launch/mainnet-init.json`, `scripts/pob-set.json`, the three retained round-5 probes, `tests/expiry-budget.mjs`, `tests/cpi-wrapper/src/lib.rs`, and the round-41 verdicts and validation records.

I did not run `scripts/run-tests.sh`, `web/test/e2e-localnet.sh`, `scripts/build-mainnet.sh`, or any live job. I did not have the validator, the RPC, or the box. Every claim below is checked against the code as delivered; where a measured run exists I use it, and where I could not measure I say so.

I confirmed the round-41 repairs are present in the tree: `absentIfDust` wraps `anchorAccount` (`web/src/lib/reads.mjs`), `resolveCollection` (`web/src/lib/ceremony-reads.mjs`), `readVault`, and `readBuySnapshot`; the e2e arms dust all four config addresses before step 0; the C01 poster fix, C02 oracle literal and C03 documentation fix are recorded in `VALIDATION.md` and not contradicted by anything in the bundle. The off-chain files those repairs touch (`bank/redemption-poster.mjs`, `bank/swap.mjs`) are not in this bundle; I take VALIDATION's word for them and note the limit.

---

## 1. Findings

### F1 — CRITICAL — The RPC proxy refuses every legacy `sendTransaction`, which is every holder transaction

**Target:** `web/deploy/rpc-proxy.mjs`, `txRefusal`

**Construct.** `txRefusal` parses the submitted bytes with `VersionedTransaction.deserialize(raw)`:

```js
let tx; try { tx = VersionedTransaction.deserialize(raw) } catch { return 'not a transaction' }
```

A Solana **legacy** transaction does not begin with the versioned-message prefix (`0x80 | version`); it begins with a compact-u16 count of required signatures (usually 1 or 2). `VersionedTransaction.deserialize` therefore throws on every legacy serialization and the proxy answers `sendTransaction` with HTTP 403 `"not a transaction"`.

The holder pages build **legacy** transactions throughout. `web/src/lib/tx.mjs`:

- `buildTx` returns `new Transaction({...})` — legacy.
- `simulate` wraps it in `new VersionedTransaction(tx.compileMessage())` — versioned, so `simulateTransaction` is accepted.
- `sendSigned` does `conn.sendRawTransaction(signed.serialize(), ...)` where `signed` is the **legacy** `Transaction` returned by `signExact`. The bytes sent are legacy.

Every transaction the pages actually send — `claim_charter_vault`, `mint_vault`, `activate`, `reveal_level`, `capture_entropy`, `reschedule_reveal`, `rescue_nested`, the Core `ExecuteV1` sweep, `burn_vault`, the `distribute` burn path, and every ceremony step — is refused. The dry-run `simulate` path succeeds (it converts to v0), so the holder sees "Dry run passed", signs in Phantom, and then the send fails at the proxy.

**What an attacker or accident gains.** No funds move, but the entire launch ceremony and every holder operation is dead on arrival. This is a launch blocker for item 50 (OPEN) and for the whole system. It is not visible in any current test: `web/test/e2e-localnet.mjs` drives the pages' library against a direct `Connection`, never through `rpc-proxy.mjs`, and the proxy's own unit tests (not in this bundle) are not exercised against a real legacy payload.

**Evidence that would exist if this is true.** Run `txRefusal` on the bytes of `new Transaction().add(ix).serialize()` (the shape `buildTx` produces) and observe `{ type: 'not a transaction' }`; run the same on `new VersionedTransaction(tx.compileMessage()).serialize()` and observe `null`. Send one legacy `sendRawTransaction` through a running `rpc-proxy.mjs` and observe HTTP 403 with body `"not a transaction"`.

**Fix.** Accept both formats. Try `VersionedTransaction.deserialize(raw)`; if it throws, fall back to `Transaction.from(raw)` and read the message from its legacy form (`message.instructions`, `message.accountKeys`), then apply the same program-allowlist and CBOB-presence checks. The legacy shape is the one the packet-size contract (SPEC item 42, limit 42) requires, so the pages cannot be changed to v0 to work around this.

---

### F2 — LOW — The ceremony's collection-creator check reads a property the RPC does not supply

**Target:** `web/src/lib/ceremony-reads.mjs`, `collectionCreator`

**Construct.** `collectionCreator` fetches the creating transaction with `conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })` and then does:

```js
const keys = msg.staticAccountKeys.map(k => k.toBase58())
```

With `encoding` omitted (the default is `json`), the RPC returns `message.accountKeys` (an array of `{ pubkey, signer, writable }`), never `staticAccountKeys`. If that is what the installed stack returns, `collectionCreator` throws `TypeError: Cannot read properties of undefined (reading 'map')`, `wrap` turns it into a `ReadError`, and `resolveCollection` — which calls `collectionCreator` on every candidate collection when no pin exists — propagates the throw. `preflight` then prints `STOP: Could not read the history of …` and the ceremony stops.

This is exactly the "a stranger's decoy can never stop the ceremony" property (round 37 V2, round 39 B4, accepted in `VALIDATION.md`). A stranger who creates any Core collection naming MINT's `["mint"]` PDA before step 0 would trigger this path.

**Evidence that would exist if this is true.** The round-41 e2e log line `M2/V2: the creator check on the real chain: ours was created by the launch key, the decoy by someone else` would fail with a `TypeError`, and the e2e would exit non-zero. The validation record claims it passed at 129/129. **I am not filing this as a confirmed defect**, because that measured run exercises this exact path and its result contradicts my reading. It is recorded here so a human reproduces the one line before road step 10: call `collectionCreator` against a real validator transaction and print `Object.keys(tx.transaction.message)`. If the key is `accountKeys`, this is a live DoS on the ceremony; if the installed web3.js converts to a `VersionedMessage` before returning, it is fine and the finding is void.

---

## 2. The four questions about the accepted limits

**1. Is any accepted limit worse than stated?**

No. I re-read the twenty-four ACCEPTED items against the code and found none that is exploitable beyond what the item says. The ones most worth re-checking were:

- **Limit 28 (Coinbase freeze).** The redeem page refuses a frozen reserve account only when `t.state === TOKEN_FROZEN && t.amount > 0n` (`plan-redeem.mjs`). A frozen *zero-balance* reserve account is not refused; the helper's `CloseAccount` on a frozen account fails, so the whole redemption reverts. This is the same outcome the holder guide already promises ("If Coinbase freezes your vault's cbBTC, you cannot open it at all until Coinbase unfreezes it"), so it is not worse than stated. It is a confusing failure message, not a new hole.
- **Limit 44 (undeclared airdrops).** The sweep helper's `read_token` returns `IllegalOwner` for a closed account, which is the right refusal reason for a duplicate source (`SR.12a`). The redeem page never offers a frozen stray to the helper (`plan-redeem` routes every frozen stray to `cannot`). Correct.
- **Limit 40 (Core upgradeable).** The five programs' CPIs into Core are hand-built; the sweep helper's only access control is Core's `ExecuteV1` owner rule on a thawed vault. The `rescue_nested` path uses the `["rescue"]` PDA, a seed no other signing path uses. Sound.
- **Limit 52 (pool and Squads accounts must exist).** `split_revenue` reads `revenue_ata.data[64..72]` only after `d.len() >= 72`; a dusted address fails closed. `distribute` reads the pool before anything and refuses if it is unreadable. Correct.
- **Limit 46 (PoB collection hot key).** The hot update authority can add an Oracle plugin to the collection or to an individual PoB; `claim_charter_vault` passes `pob_extra` accounts through and the claim page refuses any PoB or collection carrying an external plugin. The window can be ended or captured. Stated in full.

**2. Is anything listed as a limit not actually a limit, already closed, or closed by something not noticed?**

None. Every item marked ACCEPTED is enforced by code as described. Every item marked DISCHARGED is either gone with the Bank or measured closed (items 12/17 compute, 14 duplicate attributes, 19 unlevelled-vault halt, 30 split, 31 cadence, 33 operator apply, 51 boost, 54 compute).

**3. Is any DISCHARGED item not actually discharged?**

- **12/17 (compute).** `tests/3prog.test.ts` 10.1–10.4 measure a plain mint and a reveal against a 400,000 CU ceiling; `R40.U1` measures the largest redemption shape at 158,377 CU over 4 instructions with no compute-budget instruction. The packet wall (1,232 bytes) binds long before the 1,400,000 CU ceiling. Discharged.
- **14 (duplicate attributes).** `check_attributes` refuses `DuplicateAttribute` on both `mint_vault` and `claim_charter_vault`. Suite 11.4. Discharged.
- **19 (unlevelled-vault halt).** `activate` requires `r.level` in 1..=5; there is no path to an active vault with level 0. Discharged.
- **54 (holder-page compute).** The pages send no crank; `claim.mjs` and `buy.mjs` explicitly carry no crank, and `mint_vault`/`claim_charter_vault`/`activate`/`claim` each cost under 200,000 CU on their own. Discharged for the shipped page contract.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?**

No. Items 22, 38, 50, 52 and 53 are all correctly marked OPEN AND BLOCKING. `launch/mainnet-init.json` still has three OPEN values (`charter_opens_at`, `lock_deadline`, `vault_collection`). `scripts/run-tests.sh` still runs no `web/` test. `scripts/rehearsal-tree.sh` still never touches `web/`. The RPC proxy is staged, not installed. None of these is presented as closed.

---

## 3. R0: Round 41's verdict and its repairs

Round 41 was NOT CLEAN (one LOW, V41-1, in page code, not the programs; quorum 8/8; counter 0/2). The repair is present in this tree: `absentIfDust` is applied at every derived-address read the ceremony and the holder pages make, and the e2e arms dust all four config PDAs before step 0 and confirm every step still lands. The repair is correct and the tree shows no regression of it.

The off-chain repairs (C01 poster per-vault drafts, C02 oracle 180 s literal, C03 documentation) are recorded in `VALIDATION.md`; the files they touch are not in this bundle, so I cannot independently re-trace them, but nothing in the bundle contradicts them.

---

## 4. Custody, pool, draw, governance, charter, configuration, and cross-program reads (R1–R7)

I found no confirmed defect in the five programs.

- **R1 (custody).** `open_for_redemption` refuses without a top-level `burn_vault` for the same asset and owner later in the transaction; `burn_vault` refuses without a top-level `open_for_redemption` for the same asset and owner earlier. Both bind account 0 and account 2 by pubkey and both pin the Anchor discriminator. The CPI-wrapper arms (WR.1–WR.4) are genuine: a wrapped `retire_redeemed` refuses `NotFromBurn`, a wrapped burn refuses `NoTerminalBurn`, a wrapped open refuses `NoPrecedingOpen`, and the vault survives with everything intact. The BURN emptiness proof reads both token programs' derivations, checks `d[72..76]`, `d[121..129]`, `d[129..133]`, requires `d.len()==165`, requires `amount==0`, and refuses a declared live Core asset. The sweep helper's only signer path is Core `ExecuteV1`, which the pinned Core binary approves only for the asset's owner (SR.5–SR.5e). No way out for a non-owner.
- **R1s (sweep helper).** The helper requires `signer.is_signer`, requires every source's owner to be that signer, requires every destination's owner to be the one destination wallet and its mint to match, and closes every source it touches. Duplicate sources reach the closed-account guard (`IllegalOwner`), which is the right reason. A frozen source reverts the transfer. A zero-pair call sweeps only lamports. The packet measurement (S8.0) is 1,061 bytes for the three-reserve shape with 52 + 96 bytes reserved for a compute-budget pair and a separate fee payer. The helper's mainnet bytes are byte-identical to the tested localnet bytes (`build-mainnet.sh`, `cmp`).
- **R2 (pool).** `credit` adds at most `avail × ACC_SCALE / w × w` to `owed_scaled`, so `owed_scaled ≤ balance × ACC_SCALE`; `claim` reduces the pool balance by exactly `pay` and `owed_scaled` by exactly `pay × ACC_SCALE`; `retire` reduces `owed_scaled` by exactly what it removes from the schedule. `JoinWaitingFirst` is checked before any `$GARY` is burned. `pending_this_epoch` is reset by `advance_epoch` and decremented on retire only when the request was in the current epoch, so `pending_count − pending_this_epoch` never underflows or drifts. The suite's `ledger()` recomputes the sum of every live record's share from the raw record bytes after every money operation and requires `owed_scaled` to equal it; `P.32` asserts `pool.bal ≥ ceil(owed)`.
- **R2b (boost).** `reweigh` moves the already-earned share into `carry_scaled` and restarts `debt_scaled` at the new weight, so a weight change neither creates nor destroys value. `advance_epoch` adds `boost_expiring[dist_epoch % 64]` to `boosts_due` and zeroes the slot, and `distribute` refuses `BoostsExpireFirst` before anything. A boost bought at epoch `e` with `N` distributions ends at `e+N`; the distribution at `e+N` is the last it earns, and the next is refused until `expire_boost` runs. The ring of 64 is never reused by a live boost because `max_boost_epochs ≤ 63`. `unschedule_boost` handles both the due branch (`boosts_due`) and the not-due branch (`boost_expiring[end % 64]`). The suite's `books()` recomputes `total_active_weight`, `boost_weight_total`, `boosts_active`, `ring + due == active` and the per-slot ring counts from every record on chain after every money operation.
- **R3 (draw).** `blockhash_in_window` pins the sysvar key, bounds `count ≤ 512`, checks the buffer length, refuses an all-zero hash, and takes the smallest produced slot in `[want, want+64]`. B and C are each the first produced slot at or after `(slot/4 + 2) × 4`. FIFO is `index == revealed_total`. A burned vault at the head still draws (L.11). A missed window reschedules to `now + 16` and logs `CBOB_REVEAL_RESCHEDULED`. The last-contributor residual (C's leader choosing among up to 64 draws for a whole cohort) is item 26 and is accepted.
- **R4 (governance).** Quorum divisor is the live supply snapshotted at creation; a vault with `mint_index ≥ index_snapshot` cannot vote; the threshold and the 10% turnout floor are both checked; a key change (guardian or operator) needs `ceil(50% of the snapshot)` YES and can never share a proposal; a `SetRound` already over still moves `last_round_id`, so an older round cannot land after it; an overtaken action is a logged `CBOB_ACTION_SKIPPED` no-op and never reverts the bundle. `TightenSweep` takes the more restrictive of live and voted and can never leave the three `initialize` bounds.
- **R5 (charter).** The Merkle proof is domain-separated (0x00/0x01) with sorted pairs; `merkle_root_from` matches `scripts/pob-merkle.mjs` byte for byte and the suite proves the program accepts the JS-built proof for every leaf and refuses an outsider. The PoB is identified by address (`pob_root`), by collection, and by the live owner; the burn is a CPI as the owner inside the same instruction; `pob_extra` accounts are passed through never as signers; the collection's update authority can gate or capture the window (item 46, accepted).
- **R6 (configuration).** Every `initialize` is a one-time PDA `init` by `INIT_AUTHORITY`. `SEAL` refuses a Token-2022 reserve mint at config time. `MINT` refuses a default treasury, a payment mint that is not a SEAL reserve, a collection that is not clean/ours, a sweep bound outside the absolute range, a charter window already over, and an all-zero PoB root. `BURN` refuses a collection SEAL does not name. `GOV` refuses a collection MINT does not name and quorum below 500 bps or a threshold at or below 5,000 bps. The launch-value checker refuses any `OPEN` value and re-derives the PoB root from the 240 pinned addresses.
- **R7 (raw reads).** I recomputed every pinned offset and every account space from the Rust structs. `MintConfig` is 1,261 bytes with `minted_total` at 141, `bare_burns_retired` at 454, `charter_closes_at` at 442, `sweep_floor_lamports` at 631, `cooldown_ceiling_secs` at 639, `reserve_ceiling_lamports` at 647, `max_boost_weight` at 711, `max_boost_epochs` at 712. `VaultRecord` is 221 bytes with `mint_index` at 41, `pending` at 177, `request_epoch` at 178, `boost_weight` at 186, `carry_scaled` at 195. `BurnConfig` is 571 bytes with `burned_total` at 42, `redeem_window_secs` at 50, `rate_head` at 58, `rate_ring` at 59. `GovConfig` has `proposal_count` at 53 and `last_boost_id` at 86. The sweep helper reads `mint[0..32]`, `owner[32..64]`, `amount[64..72]` from a 165-byte classic token account. Every discriminator matches the Anchor derivation asserted in the suite.

---

## 5. The four programs, the suite, the simulation, and the build as evidence (R8)

- **Arms that cannot fail.** None found beyond the ones already identified by round 41 and recorded. `RL.1a` is a precondition assertion (a floor rounding), not a defect. `X.7` correctly checks that the crank's plan is empty on a drained queue.
- **Wrong-reason refusals.** Every `because()` pin in the bundle names the error the arm actually produced, and the seven round-41 pins that had no `because()` are the only gap; round 40 rated them "recommended", not gate-5.
- **Claims the prompt says no arm exercises.** The prompt's R8 item about "any program whose mainnet bytes are not proven to be the bytes the suite ran" is answered by `build-mainnet.sh`: it deploys both the mainnet and localnet builds to a validator, proves the mainnet artifacts reject the localnet key for `NotTheInitAuthority` and the localnet artifacts accept it, greps each source for Gary's key, and proves the sweep helper's mainnet bytes are byte-identical to the tested localnet bytes. The four keyed programs are not byte-identical (the key differs), which is stated and bounded.
- **The suite, the simulation, and the rehearsal.** `run-tests.sh` floors every count to equality. The floors are 899 on-chain, 940 detector, 39 allocation, 24 poster, 14 PoB, 49 launch, 33 mainnet, 4 expiry, 16 fork, 6 host. `sim/run-sim.sh` floors 71. The expiry-budget gate uses 20 synthetic distinct records and is a default-CU regression gate, not a lifecycle claim, as its own comment says. The mainnet probe skips loudly when DNS fails and refuses to certify a release when `CBOB_SHIP_GATE=1` and the probe did not run.

---

## 6. GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

What this project must do before launch that an AI audit structurally cannot:

1. **Run the dress rehearsal (road step 8) with the shipped off-chain code.** The crank, the alarm and the full revenue cycle have never run against a live cluster with real RPC latency and real 2,100 vaults. Run one full revenue cycle through Orca, one with Orca forced to refuse (Meteora fallback), and one forced post-sweep failure walked through the hand-recovery runbook, each with its transaction signatures recorded. This is item 22 and it is the single largest untested surface.

2. **Re-run `scripts/rehearsal-tree.sh` at the release commit.** The existing proof is from `d57ee3a` and is stale. The rehearsal profile in `web/src/config.js` refuses because `launch/rehearsal-init.json` and the rehearsal mode of `check-launch-params.mjs` do not exist. Build them before the rehearsal, or the rehearsal cannot run the shipped ceremony code.

3. **Fix F1 and prove it with a test that goes through the real proxy.** Until the proxy accepts a legacy `sendTransaction`, the holder pages and the ceremony are non-functional in production. Add a unit test that runs `txRefusal` on the exact bytes `buildTx` produces, and an end-to-end arm that sends one legacy transaction through a running `rpc-proxy.mjs`.

4. **Reproduce the one line in `collectionCreator`** (F2) against a real validator before road step 10. If `tx.transaction.message` has `accountKeys` and not `staticAccountKeys`, the ceremony can be stopped by a stranger's decoy collection for the price of one Core collection's rent.

5. **Set the three OPEN launch values** (`charter_opens_at`, `lock_deadline`, `vault_collection`) and have `scripts/check-launch-params.mjs` pass at the computer's clock and the cluster's clock, then have the ceremony judge the same values. A wrong value here is permanent.

6. **Publish the holder pages only after the ceremony has run on mainnet with the real collection address, and only after road step 11 has removed every upgrade authority.** The holder guide is DRAFT and cannot be published before item 50 ships.

7. **Before removing the upgrade authority (road step 11), verify by hand that the operator wallet holds nothing but the cycle's funds and its fee float, and that the release wallet holds no `$CBOB` that a backup could expose.** These are the two hot keys that no program can bound and no alarm can prevent; they are the only custody that survives immutability.

8. **Keep the alarm's two dead-man's switches armed before launch** (`crank_silent` after 3 hours of no live full-pass heartbeat, and `crank_failing` / `crank_problem` on repeated failures). A wedged crank that only pages after the queue has stalled is a silent distribution outage.

9. **Record in the launch notes which four measured numbers were produced by the release build, not by a tree that might have changed:** the 899-assertion count, the 671-assertion web count, the R40.U1 compute figure (158,377 CU over 4 instructions), and the S8.0 packet figure (1,061 bytes, with 1,209 the widest padded page shape). If any of these drift after the lock, nobody will know which number the immutable code was certified against.