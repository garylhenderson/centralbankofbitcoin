# Independent Audit, Round 36

**Scope read:** all five programs whole, the suite, the simulation, the build and rehearsal scripts, the three bundled round‑35 records (NOT‑COUNTED, TRIAGE, REVIEW‑rescue, REVIEW‑web, VALIDATION), SPEC/DESIGN/HOLDER‑GUIDE, and `web/` in full (first audit of it).

**Method note, stated up front because the prompt demands it:** I did not run a validator, the suite, the simulation, or any live job. Every claim below is derived from reading the bundled source, and for each finding I state what on‑chain or test‑run evidence would exist if the claim is true, so it can be checked rather than believed. Where I could not establish a claim from reading alone I say so and do not escalate.

---

# R0. ROUND 35'S RECORD, AND THE REPAIRS

Round 35 produced no verdict. Its three bundled records are evidence, not authority. I re‑derived each confirmed item against this tree.

## R0.1 Verification of the triage's CONFIRMED items against this tree

| triage id | claim | my independent result against the bundled tree |
|---|---|---|
| C1/C2 | road steps 9/10/11 contradicted each other on `--final` | **Repaired, and I can see the repair.** SPEC step 9 now reads "the upgrade authority is NOT removed here (step 11 does that…)", step 10 opens with "first dump all five programs again and check the same prefix hash and zero tail", and step 11 is "the only step that makes them final". Consistent. |
| C3 | GOV duplicates MINT's `MIN_ROUND_PRICE_SATS` / `MAX_ROUND_SECS` with no pin | **Repaired.** `R35.C3` in `tests/3prog.test.ts` regexes both sources and compares, with distinct NOT‑FOUND fallbacks per side. I confirm the constants are in fact equal in the bundled source: MINT `MIN_ROUND_PRICE_SATS = 21_000`, `MAX_ROUND_SECS = 365*24*3600`; GOV `MIN_ROUND_PRICE_SATS = 21_000`, `MAX_ROUND_SECS = 365 * 24 * 3600`. |
| C4 | placeholder upgrade key had no custody record | **Partially repaired, and see F4 below.** SPEC step 9 now names `bank/keys/deploy-authority.json`, mode, gitignore and backup. It is still NOT in `launch/mainnet-init.json` and NOT checked by `check-launch-params.mjs`, so the only gate on it is prose. The triage's own suggested fix ("optionally add a pinned `placeholder_upgrade_authority`") was not taken. |
| C5 | a stranger's token account with a kept close authority | **Repaired at the page level, and the limit is written.** "Known limits" now carries the C5 entry, and `plan-redeem.mjs` routes such an account to a `transferStrays` Core‑Execute transfer and leaves it undeclared. See R1s(e) and F7 for what is still unmeasured. |
| C9 | the crank activates/joins/pays nested, self‑owned and off‑curve vaults | **Claimed superseded by item 58, and I accept that as far as dilution goes, but the crank change itself is NOT in the bundle.** `bank/crank.mjs` is not in this bundle, so I cannot confirm whether the owner read was added. VALIDATION says "superseded by item 58 (payouts into a nested vault travel with it)", which is true of the loss but does not answer whether the crank still activates a vault owned by a vault PDA. **I flag this as an evidence gap, not a defect** (F11). |
| C10 | index lag pages CRITICAL | Stated as an accepted limit in "Known limits" ("An index that lags the chain pages `index_disagrees_with_chain`", with the router grace). `bank/detectors.mjs` is not bundled, so I cannot verify the code side. Recorded, not re‑filed. |
| C18 | `seenSplits` grows unboundedly | Stated as an accepted limit ("The split history the alarm keeps (`seenSplits`) only grows"). Same bundling caveat. Recorded, not re‑filed. |
| C15 | road text said "Nothing is deployed" while five placeholders are deployed | **Repaired.** SPEC now reads "The five program ids hold an inert placeholder (claimed on mainnet 2026‑10‑07, step 9 'in progress'); no CBOB program is deployed and nothing has minted." |

## R0.2 Verification of the rescue review's repairs

The review's M1 and M2 were the load‑bearing ones: the first build sent a nested vault to a **live host's owner**. The bundled `rescue_nested` now does this:

```rust
let orphan = host == a.vault.key() || is_burned(&a.host)?;
if !orphan {
    require!(require_live_vault(&a.host, &a.config.collection).is_ok(), MintError::HostUnresolved);
}
let dest = a.config.bank_treasury;
require_keys_eq!(a.new_owner.key(), dest, MintError::WrongRescueDestination);
```

**Confirmed repaired.** There is exactly one destination (`bank_treasury`), read from config, and it is compared against the caller‑supplied `new_owner`. M2 (a stranger routing a vault into a custody PDA) is closed by construction: the caller cannot name a destination at all. The suite arms match (`R35.N1` refuses the host's owner with `WrongRescueDestination`; `R35.N9` refuses a foreign live host with `HostUnresolved`).

I independently checked the review's L3 residual list against the new code:

* **Self‑nested foreign host** (`host.owner == PDA(host)`, host foreign): `orphan` is false (host not the vault, not burned), so `require_live_vault(&a.host, collection)` fails → `HostUnresolved`. Still refused, still orphaned. **This is a surviving residual** that SPEC item 58 does disclose ("a vault nested inside a foreign asset that itself cannot execute … stays stuck, as before"). Not a new finding.
* **Live `CollectionV1` / `GroupV1` host**: `require_live_vault` checks `d[0] == KEY_ASSET_V1` (1), and a collection is key 5, so → `HostUnresolved`. Burned/closed collection leaves the 1‑byte tombstone → `is_burned` true → rescued. The review's observation that the **live** case refuses while the **dead** case accepts is still true. Disclosed in substance by the same SPEC sentence. Not escalated.
* **`RescueNoProgress` removed**: correct — with a single destination it cannot occur. No dead error variant remains in the enum (I checked: `MintError` has `NotNested`, `HostUnresolved`, `WrongRescueDestination` and no `RescueNoProgress`).

**One thing the review flagged and the repair did NOT take:** L6 item 1, "the `d[0] == KEY_ASSET_V1` check is never exercised". It still is not. See **F5**.

## R0.3 Verification of the web review's repairs (first audit of `web/`)

The web review's H1 was the serious one: a stranger could permanently block a holder's redemption for ~0.002 SOL by putting an unmovable thing in the deposit address, because the page refused rather than acknowledged. The bundled `plan-redeem.mjs` now implements the review's recommended policy, and I traced it:

```js
if (acc.program !== 'token' || acc.dataLen !== 165) {
  if (c) cannot.push({ address: acc.address, text: `A Token-2022 account … is lost …` })
  continue
}
if (t.amount === 0n) continue
if (t.state === TOKEN_FROZEN) { cannot.push({…}); continue }
...
for (const x of cannot) ack.push({ id: `lost:${x.address}`, text: x.text })
```

and the coverage cross‑check only refuses what is **not already named**:

```js
for (const reason of judged.reasons)
  if (![...named].some(a => a && reason.includes(a))) refuse.push(…)
```

**Confirmed repaired in design, with four caveats I verified in the test file:**

* `plan.test.mjs` has a `VECTORS` table that drives all nine H1 shapes (empty T22 ATA, funded T22, frozen stranger mint, pNFT, frozen C5, unparseable token account, Groups‑plugin NFT, unreadable Core NFT, compressed NFT) and asserts `opens(p) && p.ack.some(...)`. The `opens()` helper requires `refuse.length === 0`, the burn last, and size ≤ 1232. That is a real both‑ways test.
* `decode.mjs` was changed so an unknown plugin no longer throws the whole asset away: `plugins()` is wrapped in try/catch and sets `pluginsUnreadable`, and `pluginBody` returns `null` for types it does not parse. `PLUGIN` now includes `'Groups'` at index 18. The test asserts types 18 and 77 both parse to owner+collection with the plugin listed by number.
* M1 (the proxy): the Origin check is now `if (!req.headers.origin || !allowed.has(req.headers.origin)) return send(403, …)`, i.e. **missing Origin is refused**, and `gpaShape` requires exact byte values with `is32` on the owner and an exact collection match. `readCapped` aborts mid‑stream. `ipKey` buckets IPv6 by /64. All four are tested. **Repaired.**
* M2 (ceremony resume): `collectionsOfMint` + `remember`/`recall` + `resolveCollection` now STOP on any disagreement, and the page refuses step 0 when it cannot scan. The ordering assertion in `ceremony.test.mjs` even greps the page source to prove `remember(...)` precedes `signExact(...)`. **Repaired.**
* M3 (notes leaking box paths into the public bundle): `build.mjs` now strips to `{value, status}` and `bundle.test.mjs` greps for `bank/keys|/opt/|/home/|R2 backup|nightly|Linq`. **Repaired.**
* M4 (ceremony served from the public site): answered operationally with `mainnet-local` + `ceremony-local.mjs` + SRI + printed `app.js` sha256. **Mitigated, not eliminated** — which the README says plainly. Accepted.

**What the web repairs did NOT close, and I am filing:** see F1, F2, F3, F6.

---

# R1. CUSTODY: CAN ANYONE BUT THE OWNER GET VALUE OUT, OR AN EMPTIED VAULT SURVIVE?

I attacked the pairing, the emptiness proof, and the new rescue delegate. I could not break custody. Below is what I checked, so a later reader can see where I looked.

**The pairing.** SEAL's forward walk starts at `current+1` and requires a top‑level `burn_vault` with `accounts[0] == asset` and `accounts[2] == owner`. BURN's backward walk scans `0..current` for a top‑level `open_for_redemption` with the same two positions. `load_instruction_at_checked` sees top‑level only; a wrapped half therefore reports the *outer* index, which is why WR.1–WR.4 refuse. Two vaults in one transaction cannot borrow each other's half because both halves bind asset **and** owner. `BURN_IX_ASSET_IDX`/`OWNER_IDX` and `SEAL_IX_ASSET_IDX`/`OWNER_IDX` are pinned in both sources and asserted (3.1c–3.1f). The account structs carry "MUST stay account N" comments at the right positions. I re‑counted: SEAL `OpenForRedemption` = `[vault_asset, collection, owner, payer, config, seal, mpl_core, instructions, system]` → asset 0, owner 2. BURN `BurnVault` = `[vault_asset, collection, owner, asset_signer, payer, config, seal_config, instructions, mpl_core, system, mint_program, mint_config, vault_record, pool_token, …declared]` → asset 0, owner 2. **Correct.**

**The emptiness proof.** `lamports() == 0` on the asset‑signer; every reserve mint × both token programs must be *declared* (found by address in `remaining_accounts`), and if a declared account is owned by either token program and ≥165 bytes it must be PDA‑owned, undelegated (`d[72..76]`, `d[121..129]`, `d[129..133]`), exactly 165 bytes, and zero amount. A second loop applies the same checks to any *other* declared account the PDA owns, and refuses a declared live Core asset. I checked the `continue` branches for a hole:

* `if acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID { continue }` in the **reserve** loop — this skips a declared reserve address that no token program owns, i.e. a reserve ATA that does not exist. That is the intended behaviour (you cannot require a nonexistent account to be empty), and it is exactly why the client must create missing reserve accounts in the prior transaction, otherwise a stranger can create one with dust *after* the plan. That is item 50's contract and SPEC states it.
* `if d.len() < TOKEN_ACCOUNT_LEN { continue }` then later `require!(d.len() == TOKEN_ACCOUNT_LEN, ReserveHasExtensions)`. The `continue` for `<165` is reachable only for a token‑program‑owned account shorter than 165 bytes, which the token programs do not create. Harmless.
* The second loop's `if acc.lamports() == 0 { continue }` skips a closed account — correct, a closed account holds nothing.

I did not find a way to make a declared reserve read empty while holding value, nor to leave a thawed vault alive: SEAL only thaws, and the only path that could re‑freeze or re‑seal does not exist (`set_frozen` is called from exactly one place, with `false`).

**The new rescue delegate (R1 is the right place for it, since it is a transfer power over every vault).** `RESCUE_SEED = b"rescue"` appears in exactly two places: the derivation inside `create_vault` (to install the plugin) and the `invoke_signed` inside `rescue_nested`. The `#[derive(Accounts)] RescueNested` declares `rescue_authority` with `seeds = [RESCUE_SEED], bump`, so Anchor derives it; the caller cannot substitute. The CPI data is the constant `vec![IX_TRANSFER_V1, 0]` and the program id is the constant `MPL_CORE_ID`. Every other `invoke_signed` in MINT uses `MINT_SEED`, `REVENUE_SEED` or `CONFIG_SEED`. **I confirm the rescue authority signs in exactly one place with one destination and one instruction.** The review's I1 holds.

One thing worth stating because the holder guide has to be honest about it: `PermanentTransferDelegate` in Core `force_approve`s a transfer, which short‑circuits the plugin loop. So the rescue moves a **frozen, sealed** vault. That is required for it to work at all (every vault is sealed), and the review already established it from Core source. I confirm the suite does not measure it directly — see **F5** — but the end‑to‑end log and `R35.N2`'s assertion that the seal is still frozen after the rescue is indirect evidence that it does work.

**No finding in R1.**

---

# R1s. THE SWEEP HELPER

I re‑derived every sub‑question.

**(a) Who can make it move value.** Called directly, `accounts[0].is_signer` must be true and `src_owner == *signer.key`, so a direct caller can only move its own accounts. Through Core, Core signs as the asset‑signer PDA; Core's `ExecuteV1` approves only the owner (SR.5/5a measure a stranger and an owner‑added transfer delegate both refused 0x1a; SR.5c refuses a control collection's update authority; SR.5d proves the control's owner can). The vault must be thawed, so it can only be reached inside a genuine `open_for_redemption`, which requires a terminal burn. `SR.5` is specifically "inside a GENUINE open … BOB, a stranger, drives Core ExecuteV1 into the helper" → REJECT, and SR.5e checks balances/owner/seal survived. **I cannot break it.**

**(b) The pair list.** I walked each case:

* same source twice: the first iteration closes it; the second `read_token` fails `*a.owner != SPL_TOKEN_ID` → `IllegalOwner`. Pinned by `SR.12a` **and** by `SR.12b`, which asserts the refusal did **not** come from the source‑owner log line — i.e. it reached the closed‑account branch. That is a good pin; most suites would have let the wrong‑reason pass.
* destination twice: allowed and harmless (two transfers into one account).
* source is also a destination: if named as a destination it must be owned by `dest`, not the signer, so it cannot be both.
* native wSOL source: `read_token` only reads mint/owner/amount; a native account has `is_native` set but `close_account` on a native account sends lamports to the destination. The helper would then `CloseAccount` it; for a native account SPL Token requires amount 0 for non‑native only, and for native it transfers the wrapped lamports out on close. A vault's wSOL account is not a reserve, so this would only arise from a page naming it. It moves value to the destination either way. Not a leak.
* delegate / close authority on the source: `CloseAccount` checks the **close authority or owner**; the PDA is the owner, so a *delegate* does not block. A foreign **close authority** does block (this is C5), and that is the one case the page must avoid naming — which it now does.
* frozen source: the transfer reverts (`SR.14`, pinned to token error 0x11).
* destination not an ATA: allowed, so long as its mint matches and its owner is `dest`. Correct: the program checks the *property*, not the derivation.
* destination wallet = the vault's own signer: `signer.key == dest.key` → `InvalidArgument` (`SR.10`).
* destination wallet = **another vault's asset‑signer**: **not refused.** The helper only refuses `signer == dest`. See **F2** for why this matters to the page rather than to the program.
* odd account list: `(accounts.len() - 4) % 2 != 0` → `NotEnoughAccountKeys` (`SR.7`). Zero pairs: allowed, lamports‑only (`SR.13`).

**(c) Destination checks.** The helper does not compare `dest` with the asset's owner, which is correct given (a): only the owner can reach it, so the owner is choosing where their own value goes. A below‑rent lamport credit to a nonexistent account would fail; SPEC item 50 already states the client obligation ("A lamports‑only sweep needs a destination that exists"). `R27.S1` measures a **non‑System** destination (a token account) receiving lamports and verifies its token data is unchanged. Good.

**(d) The lamport sweep.** `signer.lamports()` is read at execution, after the closes, so it includes the closed accounts' rent. `SR.4a` reconstructs the exact arithmetic (gift + prior wallet balance + closed account rent + asset rent delta − fee) and separately asserts the helper's own log line equals `wallet balance before the sweep`. Nothing later in the transaction can re‑fund the PDA except an explicit instruction the owner put there — and if they did, BURN's `lamports == 0` would refuse, which is the fail‑closed direction. **Sound.**

**(e) Interaction with BURN's proof.** The closed account passes for the right reason: after `CloseAccount`, the account is System‑owned with zero data, so BURN's `acc.owner != &SPL_TOKEN_ID && != &SPL_TOKEN_2022_ID → continue` skips it, and the *reserve* loop finds the account by address and also skips it. That is "skips an account no token program owns" — the prompt's phrasing — and it is the intended reason.

The remaining hazard is the one the prompt names: **a reserve ATA that does not exist when the page builds.** The sweep cannot name it (`read_token` refuses a non‑token account), and BURN skips it, so a stranger creating it *with dust* between the prior transaction and the redemption makes BURN refuse `VaultNotEmpty`… **no.** Let me be exact, because this matters: BURN *finds* the declared address, sees it is now token‑owned, reads it, and `require!(amount == 0)` fails. So the redemption reverts and must be retried after a fresh prior transaction. That is a grief, bounded by the griefer's rent cost, and it is the reason SPEC's REDEEMING step 1 exists. **Is step 1 sufficient?** It closes the window to "between the prior transaction landing and the redemption landing", which is one or two slots. A persistent griefer paying rent each slot can keep one holder out. SPEC's F1 entry says the sweep "names only what exists when the page builds the transaction, so the page must make sure all three of the vault's reserve accounts exist first". **That is accurate and the residual is disclosed.** Not a new finding.

Is there anything a stranger can create that the sweep cannot name and BURN will **not** skip? I went through the list:

* **A Token‑2022 ATA for a classic mint**: `probe-round5b.test.ts` F4.2 measures that creating one is **REJECT**. So the T22 derivation of a reserve mint can never exist. BURN still *requires it declared*, and skips it because nothing owns it. Fine.
* **A non‑ATA token account** owned by the PDA: invisible to BURN unless declared; the page handles it as a stray. Not a block.
* **A nested Core asset**: BURN refuses it only if declared; the page refuses an inner CBOB vault (points at rescue) and acknowledges a foreign one.
* **A Token‑2022 ATA for a Token‑2022 mint**: the page now acknowledges it (H1 repair) and BURN never sees it. **Not a block.**

**(f) Does it fit?** `S8.0` measures the three‑asset redemption through the helper at 1,061 bytes and asserts `size ≤ 1232 − 52 − 96`, i.e. it reserves room for a compute‑budget pair and a separate fee payer. `S8.1a` measures 168,343 CU against a four‑instruction default budget of 800,000. What a real page adds: the page does **not** add compute‑budget instructions to the redemption (I checked `redeem.mjs`: `buildTx(conn, plan.redemption, wallet.publicKey)` with no `cuLim`), and it uses the owner as fee payer. So the 1,061‑byte measurement is the page's actual shape, with 171 bytes of slack for C5 transfers and strays. `plan.test.mjs` asserts the page's plan is byte‑identical to the S8 message in the page's order, and separately that eight strays still fit. A **fourth reserve** is not possible under the protocol (`MAX_RESERVE_MINTS = 3`, written once), so that arm of the question is moot. The in‑line monthly run adds no accounts to the redemption (it rides inside `retire_redeemed`, whose pool account BURN already passes). **Fits.**

**(g) Evidence.** I looked for an arm that cannot fail. The `because()` pins on SR.6–SR.12a and SR.14 all name the *exact* program and error string, and SR.12b is an anti‑wrong‑reason assertion. SR.1's pin is `'missing required signature'`, which is the runtime's message — that is the only correct outcome for a direct call with `is_signer: false`, so it is not vacuous. **The helper's bytes are proven to be the tested bytes**: `build-mainnet.sh` `cmp`s `dist/cbob_vault_sweep.so` against both the fresh localnet rebuild **and** `target/deploy/cbob_vault_sweep.so` (the file the suite and the sim deployed), and dies on either mismatch. The `Cargo.toml` comment explains why there is no `localnet` feature (a declared feature changes the metadata hash). **This is the strongest byte‑provenance claim in the tree and I confirm it is real.**

**No finding in R1s on the program.** Two page‑level findings follow (F2, F7).

---

# R2. THE COMMUNITY POOL

**The invariant.** `pool ≥ ceil(owed)`. I traced every writer of `owed_scaled`:

* `credit`: `owed += delta * w` where `delta = floor(avail * ACC_SCALE / w)`. So `delta*w ≤ avail*ACC_SCALE`, i.e. the newly owed sats never exceed `avail`. And `avail = balance − ceil(owed_before)`, so `ceil(owed_after) ≤ ceil(owed_before) + avail ≤ balance`. ✅
* `claim`: pays `pay` sats, subtracts `pay*ACC_SCALE`. Balance falls by `pay`, `ceil(owed)` falls by at least… careful: `ceil(owed − pay*SCALE)` vs `ceil(owed) − pay`. Since `pay*SCALE` is an exact multiple of SCALE, `ceil(x − k*SCALE) = ceil(x) − k`. Exactly matched. ✅
* `retire`: subtracts the vault's whole `pending` from `owed`, moves nothing. Invariant strengthens. ✅
* `reweigh`: moves `owed_of` into `carry` and resets `debt = after*acc`. `owed_of` after = `after*acc + owed − after*acc = owed`. **Unchanged.** Does not touch `owed_scaled`. ✅
* `monthly_inline`: same `credit`, with `avail = balance.saturating_sub(ceil(owed))`. ✅

`distribute` additionally guards `balance.checked_sub(owed)` → `PoolShort`, so a pool that somehow held less than it owes refuses rather than underflowing. P.32 asserts the invariant on chain at the end of section P, and the suite's `ledger()`/`books()` helpers recompute `owed_scaled` as the **sum over every live record** of `weight*acc + carry − debt` and push a label only when it balances — then `BK.IN`/`BK.3c`/`BK.P` assert the exact expected label lists. That is the strongest form: a deleted check shows as a missing label. **I could not break the invariant.**

**SPEC's weaker rule (round 24 W11).** SPEC says a vault is never credited by a distribution that ran *before* it joined, and explicitly **not** "never earns from revenue that arrived before it joined". I attacked the weaker rule. The join gate is `dist_epoch > request_epoch`, and `join` sets `debt = w*acc` at the current accumulator, so the vault's `owed_of` is 0 at join. The only way to earn from pre‑join revenue is for that revenue to still be *undistributed* at join time, which is exactly limit 55 (unsplit revenue) plus the launch‑tick cohort case, both disclosed. `JoinWaitingFirst` closes the "tick, join only myself, then burn" attack, and it is checked **before** the $GARY burn in both paths. `waiting_to_join = pending_count − pending_this_epoch`, and `advance_epoch` zeroes `pending_this_epoch` — so after a tick, everything that requested in the closing epoch becomes "waiting" and blocks the next distribution until joined. **Correct.**

**Counters under every ordering.** I checked `pending_count`/`pending_this_epoch` for underflow:

```rust
if r.pending {
    c.pending_count -= 1;                       // checked_sub
    if r.request_epoch == c.dist_epoch { c.pending_this_epoch -= 1; }   // checked_sub
    r.pending = false;
}
```

`pending_this_epoch` is only incremented when the request is made (in the current epoch), and only decremented when retiring a vault whose `request_epoch == dist_epoch`. `advance_epoch` sets it to 0. So the decrement can only fire for a request made in the current epoch, which must have incremented it. No underflow path. `F21.1`/`F21.2` measure both a redeemed and a bare‑burned waiting vault leaving both counters. ✅

`active_count` and `total_active_weight` are incremented only in `join` and decremented only in `retire` (and adjusted by `reweigh`, which preserves the sum). A vault cannot be joined twice (`require!(r.pending && !r.active && !r.retired)`), nor retired twice (`AlreadyRetired`).

**Liveness: can anyone make distributions or redemptions impossible for others?**

* A **frozen pool** stops paying claims and reverts a paying claim whole — disclosed (limit 28), and `retire_redeemed` forfeits rather than locking the vault (3c.F0–F3).
* A **vault with a gone token account**: `claim` requires `dest.owner == SPL_TOKEN_ID && lamports > 0 && len == 165`, else `VaultAccountMissing` — which **reverts the whole claim batch**. Could a holder destroy their own vault's cbBTC account to brick everyone's claims? Only by closing it, which requires signing for the PDA, which requires `ExecuteV1`, which requires the vault be thawed, which requires a redemption. Inside a redemption the sweep closes it and `retire_redeemed` removes the vault, so no claim will name it again. **Not reachable.** And the crank batches, so one bad pair only kills its own batch.
* `BoostsExpireFirst` could in principle wedge distributions if a due boost could not be expired. `expire_boosts` needs only the records (no token account), is permissionless, and batches 30. `tests/expiry-budget.mjs` measures twenty distinct due boosts expiring **under the default 200,000 CU budget** on a real validator with synthetic genesis. That is the right shape of evidence for the one gate that could wedge the pool. ✅
* `JoinWaitingFirst` could wedge if a waiting vault could not be joined. `join` is reachable from `activate` (needs the asset live + its ATA) and from `claim` (needs the record + its recorded ATA). A waiting vault whose asset was bare‑burned can be `retire_burned`'d by anyone, which clears `pending`. A waiting vault whose recorded ATA was closed — again only via a redemption, which retires it. **Not reachable.**

**No finding in R2.**

---

# R2b. THE $CBOB BOOST

**"Exactly N distributions, not one more."** `boost_vault` sets `end = dist_epoch + epochs`. `advance_epoch` adds `boost_expiring[end % 64]` to `boosts_due` when `dist_epoch` reaches `end`. `distribute`/`monthly_inline` refuse while `boosts_due > 0`. So the boost is live for distributions `e+1 … e+epochs` inclusive = exactly `epochs`. `BO.21`/`BO.21a` measure the `[boost, distribute]` order (the distribution it rides in counts) and `BO.35`/`BO.35a` the reverse order (`[distribute, boost]` ends at `e+1+N`, so it does **not** count the one before it). Both directions. ✅

**Nothing lost or gained on a weight change.** `reweigh` is the only weight mutator and it is conservative, proven above. `expire_boost` calls `unschedule_boost` then `reweigh(c, r, 0)`, and the gate guarantees the accumulator has not moved since the boost's last distribution, so the vault is owed exactly what that distribution left. `claim`'s normalisation sets `carry = pending − settled` and `debt = weight*acc`, so `owed_of` after = `weight*acc + (pending − settled) − weight*acc = pending − settled`. Exact. ✅

**Totals and the ring agree, past epoch 64.** Two host tests do this:

* `the_boost_ring_wraps_exactly_against_a_model`: 1,000 epochs, random buys/expiries, asserts `ring_sum + due == active` every epoch and `boosts_due == model` every epoch, and ends by asserting `dist_epoch > 3*BOOST_RING`.
* `the_boost_schedule_through_the_programs_own_functions_across_four_wraps`: 260 epochs driving the program's **own** `join`/`reweigh`/`retire`/`expire_boost`/`credit`/`tick`, rebuilding the model from the records, and asserting per‑ring‑index equality, `total_active_weight`, and **`owed_scaled == Σ owed_of`**. It then asserts coverage counters (`buys > 500`, `buys63 > 200`, `wrapped_buys > 100`, `early_wrapped63 > 3`, etc.) so it cannot pass by never reaching the wrap branches. **This is the right way to test a ring, and it is not vacuous.**

The one thing hand‑copied in that test is the three scheduling lines from `boost_vault` (because they are inline in the handler). The test says so in a comment. `MAX_BOOST_EPOCHS_BOUND = BOOST_RING − 1 = 63`, so two live end epochs never share a slot. ✅ On chain, `BO.34` measures a real wrapped buy and `BO.38` a real early retire at a wrapped index.

**No record expired twice/early/never.** `expire_boost` requires `boost_weight > 0 && dist_epoch >= boost_end_epoch`; after it, `boost_weight = 0` so a second call fails `BoostNotDue`. `expire_boosts` **skips** rather than failing (so a racing batch still lands) — `BO.13a` measures the skip. Early: `BO.10b` measures `expire_boosts` on a not‑due boost landing and changing nothing. Never: the gate makes it impossible to distribute past a due boost, so "never expired" means "distributions stop", which is loud and anyone can fix for free.

**Can anyone make distributions impossible by boosting?** Only its owner can boost (`BoostNotTheOwner`, BO.6 with the stranger holding enough $CBOB), one per vault, and expiring is free and permissionless and needs no token account — which is precisely why `expire_boosts` exists separately from `claim`. **A vault whose token account is gone** cannot block expiry. ✅

**`BoostTermsMoved` one‑sidedness.** `require!(price <= max_price && extra >= min_weight && epochs >= min_epochs)`. A favourable move lands at the new terms — this is the ruled behaviour (D1), disclosed in item 51. `BO.30a` measures a lower price landing and burning the **new** price.

**No finding in R2b.**

---

# R3. THE LEVEL DRAW

**SlotHashes parse.** Key pinned to `slot_hashes::ID`; `len >= 8`; `n <= 512`; `len >= 8 + n*40`; all‑zero hash refused. Host tests cover a 513‑count declaration, a truncation, a forged key, and an all‑zero hash — all refused — plus a full 512 buffer reading at both ends. ✅

**Skipped slots.** `blockhash_in_window` takes the **smallest produced slot in `[want, want+64]`**, which is deterministic because the set of produced slots is settled before the call. The host test `the_lookup_takes_the_smallest_produced_slot_in_the_window` drives a 7‑skip pattern, a 10‑slot run of skips, the inclusive boundary at exactly `+64`, one past it (None), and an older‑slot case. `capture_skips_at_a_b_and_c_and_matches_the_model` compares against an independent model at skips placed exactly on A, on B's group start, on C's group start, and on all three. **This is the strongest part of the entropy evidence and it could only be done off chain** (a test validator skips nothing), which is why the host tests exist. ✅

**FIFO.** `require!(index == config.revealed_total, RevealOutOfOrder)`. L.2 and L.16a measure it.

**A burned vault at the head.** `reveal_level` detects `burned` positively (Core‑owned, 1 byte, key 0) and skips the Core write but still advances `revealed_total` and the census. L.11/L.11a measure it on a vault redeemed **before** its draw. Without this the queue would stop forever. ✅

**Attribute re‑supply hash.** `hashv(&[&attributes.try_to_vec()?]) == r.attrs_hash`, with the stored hash written at mint over the same Borsh encoding. L.4 measures a one‑attribute change refused. The byte budget (`MAX_ATTR_BYTES = 640`) exists so a mint can never accept a list a reveal cannot re‑send, and L.12/L.12a/L.12b measure exactly the budget revealing in legacy and one byte over being refused at mint. ✅

**What a minter / crank operator / slot leader can influence.** SPEC 26 says C's leader "can CHOOSE AMONG MANY DRAWS": it can skip its own first slot(s) to move C within its own 4‑slot group (best‑of‑4 → P(Level V) 5.0% → 18.6%) and vary its block contents (64 tries → 96%). I re‑derived the mechanism from the code: `want = (slot/4 + 2)*4`, so B and C target the *first* slot of a group; `blockhash_in_window` takes the smallest produced slot in `[want, want+64]`, so skipping the group's first slots moves C to the leader's own later slots — **within its own rotation**, because the stride is 2 groups and a rotation is 4 slots. That matches SPEC. **Is it WORSE than stated?** One thing SPEC's number does not capture: the leader could also skip *past* its own rotation into the next leader's, giving it the option of "my own best‑of‑4, or hand it to the next leader" — but that is strictly fewer useful options than best‑of‑4 plus content grinding, since it loses control. And the 64‑slot window means a leader that skips its whole rotation hands C to someone else, which is not an improvement for it. **I do not find it worse than stated.**

The cohort property is also as stated: every vault minted in the same slot shares `reveal_slot`, so one C‑choice serves the cohort jointly (each vault still mixes its own address, so the leader cannot pick per‑vault within a cohort — it picks one `(hA,hB,hC)` triple and gets whatever that gives each asset).

**Does HOLDER‑GUIDE say it truly?** The guide's honest list says: *"the validator producing the last of those blocks can pick among several results, by skipping a block or changing what goes into it. That can be enough to choose the level of a vault created in the same moment (from the levels still left), and one choice affects every vault created in that moment at once."* Compared with SPEC: "many draws" vs "several results"; the mechanism (skip or vary contents), the cohort effect, and "from the levels still left" are all there. The web review flagged the many/several wording as cosmetic and I agree. **The guide says it truly.** The re‑roll limit (25) is also in the guide, with the two‑minute window and "anyone can record it".

**No finding in R3.**

---

# R4. GOVERNANCE

**Can a minority carry what it should not?** The gates are: `cast > 0`; `cast ≥ ceil(quorum_bps × snapshot)`; `yes/cast ≥ threshold_bps`; `yes ≥ ceil(10% × snapshot)`; and for a key change `yes ≥ ceil(50% × snapshot)`. All divide by `p.quorum_supply`, the **snapshot at creation**, never `max(snapshot, live)`. I checked the arithmetic for a rounding hole: `need = (divisor*bps + 9999)/10000` with `require!(need > 0)` — so a quorum that rounds to zero is refused rather than passing vacuously. Same for `need_yes` and `need_key`. D.1 measures a 100%‑YES proposal that meets quorum and threshold but fails the 10% turnout. 3c.K2 measures a key change with quorum+turnout but under half, **with a precondition arm (3c.K2p)** asserting it really did carry everything the weaker rules asked for. That precondition is what makes 3c.K2 non‑vacuous. ✅

The `index_snapshot` rule means a vault minted during a vote can neither vote nor raise the bar. SPEC's round‑25 D1 correction states the consequence plainly (a 240‑vault snapshot needs 120 YES, which is 5.71% of 2,100 if the rest mint mid‑vote). I confirm this is what the code does, and that it is disclosed rather than hidden.

**Can a vote reach money it should not?** `ProposalAction` has five variants and `MAX_ACTIONS = 5`. I enumerated what each can write in MINT: `set_round` (round window/price/cap only), `restart` (two bools), `arm_guardian` (pending only), `tighten_sweep` (three monotone fields, bounded), `arm_swap_operator` (pending only), `set_boost_terms` (three terms, bounded). `split_bps`, `bank_treasury`, `pool_ata`, `max_supply`, `payment_mint`, the reserve list, `pob_root`, the charter window and the royalty are written **only** in `initialize`. I grepped the program for other writers of those fields and found none. The suite pins the deletion both structurally (`P.0e`: the only vote‑carried struct has no money field in either program; `P.0f`: no `WiringArgs` survives) and behaviourally (`0.4i`: `update_wiring` answers `InstructionFallbackNotFound`, i.e. it is *absent*, not gated). `W.1` sends the **old UpdateWiring byte shape** and gets `InstructionDidNotDeserialize`. ✅

`tighten_sweep` applies max/min, so order does not matter and it cannot loosen; `8.14b` measures an older, looser tightening executing **after** a newer one and changing nothing. Bounds are fixed at init and checked in both GOV (at creation) and MINT (at execution).

**Can governance be frozen forever?** SPEC 47 says a stolen guardian key's stop is permanent at turnout below half of all live vaults. I re‑derived: the guardian can `emergency_stop_sales`/`emergency_stop_sweep` repeatedly; `sales_stopped_at` only moves on the **transition** (`if !c.sales_stopped { … }`), so re‑stopping cannot out‑date a restart proposal — that is a real repair and `3b.S2` measures it. Replacement needs `KEY_CHANGE_YES_BPS = 5000` of the snapshot, unbundled, plus `notice_secs`. So the thief holds sales and the sweep shut indefinitely at low turnout. **Is it worse than SPEC states?** Three things to check:

1. Does the stop reach redemption, claims, activation, distribution? No — I traced every `sales_stopped`/`sweep_stopped` read: `mint_vault` (sales) and `sweep_sol_for_swap` (sweep). Nothing else. The guide's claim holds.
2. Can the guardian block its own replacement? `cancel_swap_operator` touches only `pending_swap_operator`; there is no instruction that touches `pending_guardian` except `arm_guardian` (governance) and `apply_guardian` (permissionless after notice). `6c.9` measures the guardian failing to arm a guardian (`ConstraintHasOne`). ✅
3. Can a captured vote *remove* the brake instantly? No: `arm_guardian(None)` + `notice_secs`. `6c.20b`/`6c.20c` measure the retirement landing only after the notice.

**Is it worse than SPEC 47?** One nuance SPEC does not state but which follows: a thief who also holds the stop can keep *sales* shut, which means `minted_total` never grows, which means the snapshot never grows, which means the bar for replacing them never rises — but it also never falls. Neutral. And since redemptions still work, `quorum_supply` can *fall* as vaults redeem, which makes replacement **easier** over time. So the dynamics favour the holders, not the thief. I do not find it worse.

**One genuine asymmetry I checked and found sound:** `read_stops` uses `>=` for the skip (`stops.sales_stopped_at >= p.created_at`) while MINT's `restart` uses `<` for the requirement (`require!(c.sales_stopped_at < proposal_created_at)`). These are complements: GOV skips when the stop is **not strictly older**, MINT requires the stop be **strictly older**. Same boundary, so GOV never passes MINT something MINT would revert on. The comments on both sides say "the stop wins the tie". ✅ That is exactly the kind of mirrored‑constant drift that would be a silent revert of a whole bundle, and it is right.

**No finding in R4.**

---

# R5. THE CHARTER CLAIM

**Identity by address.** `merkle_leaf = sha256(0x00 ‖ key)`, `node = sha256(0x01 ‖ min ‖ max)`, proof ≤ 16, root compared with `cfg.pob_root`. Domain separation is real (the selftest asserts `leafOf(k) != H(0x01 ‖ k)`), sorted pairs remove direction bits, and `scripts/pob-merkle.mjs` is the **single** implementation used by the suite, the sim and the mainnet probe — the program accepting a proof that module built is the only check that can fail if they drift, and that is the right design. The probe re‑derives the root from mainnet raw account data every run, and `C.8` measures a **lookalike** "Proof of Burn #241" minted by the same hot authority being refused `NotInPobSet`. ✅

**CPI burn as owner, same instruction.** The PoB is checked: Core‑owned, `KEY_ASSET_V1`, owner == signer, update authority = Collection, collection == `cfg.pob_collection`. Then `invoke(BurnV1)` with `owner` as a signer meta. So a vault can never exist without its PoB being destroyed. `C.7` measures a second claim with the same PoB refused `NotAProofOfBurn` (the tombstone).

**Window.** `now >= charter_opens_at` and `now < charter_closes_at`, both written once, no setter, no governance action reaching them. `C.1`, `C.15` measure both edges. Not gated by the guardian (`C.13` measures a claim landing while sales are stopped, and the count incrementing).

**`pob_extra` pass‑through.** `require!(n_extra <= MAX_POB_EXTRA && n_extra <= remaining.len())` then `split_at`, and each extra is pushed as `new`/`new_readonly` **never as a signer**:

```rust
metas.push(if a.is_writable { AccountMeta::new(a.key(), false) } else { AccountMeta::new_readonly(a.key(), false) });
```

I checked the slice arithmetic for an overlap with the crank: `let (extra, crank_accts) = ctx.remaining_accounts.split_at(n_extra)` and the crank gets only `crank_accts`. No aliasing. `OR.3` measures `pob_extra` claiming more accounts than supplied → `BadPobExtra`. `OR.2` measures a claim that does **not** pass the oracle's account being refused **by Core**, and `OR.5!` pins that the rejecting‑oracle refusal came from Core's program id rather than ours. That last pin is the one that stops `OR.5` passing for the wrong reason. ✅

**Is SPEC 46 now complete?** It covers: ending the project (reject every claim through the window), capturing governance (admit only the holder's own PoBs), the per‑asset alarm blind spot, the 30‑minute sampling blind spot, the positive bound (the key cannot transfer or burn an individual PoB — Core refuses post‑creation permanent delegates, and asset/collection both abstain), the packet bound on extras, and the fact that the exposure ends when the window closes while a captured electorate does not.

Things I checked for omission:

* **Could that key move a PoB out of the collection?** Core's `update` on an asset whose update authority is the Collection requires the collection's update authority to sign — so the hot wallet *could* change a PoB's update authority away from the collection. Then `claim_charter_vault`'s `require!(d[33] == UA_DISC_COLLECTION)` fails → `NotAProofOfBurn`. SPEC says "Moving a Proof of Burn out of the collection is the same brick class as a rejecting hook." **Covered.**
* **Could that key rewrite a PoB's name/uri to impersonate another edition?** Yes, but identity is by address, so it buys nothing against the program. It could mislead a human. SPEC's PROOF OF BURN SET block says name and uri "are the only on‑chain marks, and both are writable by that collection's update authority". **Covered.**
* **Could a PoB *holder* brick their own claim?** Yes: an owner‑managed `FreezeDelegate` with `frozen: true` blocks the burn. SPEC 46's round‑22 note says "owners can also add owner-managed plugins, including a freeze delegate that can block the burn while frozen". **Covered**, and the claim page refuses it with a reason (`planClaim` checks both freeze plugins).
* **Could a third party add anything?** Core refuses an owner‑added external adapter on a collection‑authority asset (fact 12, and R24.1/R24.1a measure it on our own collection). **Covered.**

**I find SPEC 46 complete for the mechanisms I can identify.** One item that is *not* in SPEC 46 and arguably belongs: the hot key could mint "Proof of Burn #241…#999" and sell them to people who then cannot claim. That is a reputational/sales fraud vector, not a program one, and SPEC's PROOF OF BURN SET block does say the wallet "could also mint a 'Proof of Burn #241' at will". **Covered in substance.** No finding.

---

# R6. THE ONE‑TIME CONFIGURATION AND THE TRUSTED HOP

I re‑derived every `initialize`'s accept/refuse set and asked what a wrong‑but‑accepted value locks in.

**SEAL.** Accepts: a collection **pubkey** (never read as an account) and 1–3 reserve mints, each of which must be *passed as an account* and *owned by Tokenkeg*. Refuses: non‑INIT_AUTHORITY, >3, empty, undeclared mint, non‑classic owner. **Does NOT refuse:** a 2‑mint list, a duplicate mint, an account that is token‑owned but not an 82‑byte mint, or a wrong collection key. SPEC's round‑24 A6 note states exactly this. A duplicate in the list would make BURN derive and require the same ATA twice — harmless (found twice, same checks). A **2‑mint** list would permanently prevent one reserve asset from ever being checked at burn, so a vault holding it would burn it away. **That is the single most dangerous accepted‑but‑wrong value in the tree, and the only gate is `check-launch-params.mjs` plus the human building the transaction.** It is item 38 and A6. Not a new finding, but see F4 for the hardening I do recommend.

**MINT.** The longest list. I verified each bound against the ruled values in `launch/mainnet-init.json`:

| check | code | ruled value | passes? |
|---|---|---|---|
| cbob mint is classic, initialized, ≠ payment, ≠ GARY | `BadBoostSetup` | `GMm2yY2z…` | ✅ |
| `1..=12` weight, `1..=63` epochs | `BadBoostSetup` | 12, 24 | ✅ |
| `max_supply > 0` | `BadSupplyCap` | 2100 | ✅ |
| `bank_treasury != default` | `WrongTreasury` | Squads | ✅ |
| `notice 60..=2592000` | `BadNotice` | 604800 | ✅ |
| `floor >= 0.1 SOL && <= cap` | `BadSweepBound` | 1 SOL ≤ 10 SOL | ✅ |
| `cooldown_ceiling >= cooldown && <= 7d` | `BadSweepBound` | 86400 ≥ 21600 | ✅ |
| `reserve_ceiling >= reserve && >= 890880 && <= 10 SOL` | `BadSweepBound` | 0.1 SOL ≥ 0.05 SOL | ✅ |
| `cap 1..=50 SOL` | `BadSweepBound` | 10 SOL | ✅ |
| `cooldown 1..=86400` | `BadSweepBound` | 21600 | ✅ |
| `reserve == 0 \|\| >= 890880` | `BadSweepBound` | 50,000,000 | ✅ |
| caps all non‑zero, sum ≤ max_supply | `BadLevelCaps` | 945+525+315+210+105 = 2100 | ✅ |
| charter window >0, ≤90d, not already over | `BadCharterWindow` | 604800 | ✅ (date OPEN) |
| `pob_root != 0` | `BadPobRoot` | set | ✅ |
| `monthly 60..=2592000` | `BadMonthlyPeriod` | 2592000 | ✅ |
| payment mint ∈ SEAL reserves | `PaymentMintNotAReserve` | cbBTC ∈ list | ✅ |
| collection clean/ours/unminted | three errors | created at step 10 | ✅ |

The collection parse deserves a note because it is hand‑rolled: it reads `key == KEY_COLLECTION_V1`, `update_authority == mint_pda`, then walks two length‑prefixed strings with `checked_add`, then requires `d[o..o+4] == [0,0,0,0]` (num_minted == 0) and **`d.len() == o + 8`** — i.e. no plugin header at all. That last equality is what makes "arrives clean" enforceable rather than hopeful. `0.1g` measures a collection carrying a wallet‑held `PermanentBurnDelegate` refused; `0.1h` a foreign update authority. ✅

**BURN.** Reads SEAL's config and requires the same collection (`WiringDiverged`), and `redeem_window 10..=86400`. **Does not refuse 10 seconds**, which is the testing floor — A6 again. Ruled 3600.

**GOV.** Reads MINT's config and requires the same collection (`ForeignVault`); quorum `500..=10000`; threshold `>5000 && <=7500`; voting `60..=2592000`. `7.12e` measures quorum 1 refused; `7.0a` a foreign collection refused.

**The one trusted key's worst case.** `sweep_sol_for_swap`: operator must sign; `amount > 0`; `amount <= max_sweep_lamports`; `now >= last_sweep_at + cooldown`; `bal >= reserve + amount`. So the bound is **cap × windows until the guardian stops it, never more than the PDA holds above the reserve**, and a vote can only tighten inside `(floor, cooldown_ceiling, reserve_ceiling)`. At the ruled values the worst a hostile *vote* can do is 1 SOL/day with 0.1 SOL held back; the worst a key **thief** can do is 10 SOL/6h until the stop. That is SPEC limit 10's number and I confirm the code produces it. `6.17` measures three sweeps in one transaction refused (so the cooldown is a rate, not a step size); `6.17a` a stranger sweeping without the operator signing; `6.17b` a zero sweep (which would burn a cooldown for nothing). ✅

**The royalty.** `initialize` builds `AddCollectionPluginV1` with `Plugin::Royalties{1000 bps, [revenue@100], RuleSet::None}` and `Some(PluginAuthority::None)`. I verified the encoding byte by byte against the suite's assertions: `R.7` compares our opcode with the SDK serializer's first byte; `R.1/R.2/R.3` decode 1000 bps, sole creator = revenue PDA at 100%, authority `None`; `R.4` asserts it is the **only** plugin. Then the behavioural proof: `R.5` shows an `UpdateAuthority`‑held royalty **can** be rewritten (the control, so the test is not vacuous), `R.6` shows a `None`‑held one cannot, `R.6a` cannot be removed, `R.6c` the same removal works on the control (so the call is well‑formed), and round 33's `R33.G3` shows it cannot be **re‑delegated** either (0x1b). `R.8` shows a vault owner cannot add an asset‑level royalty to override it. `R.9` re‑reads 1000 bps at the end of the whole suite. **I can find no path in our programs or in Core that changes it.** The remaining dependency is Core itself (limit 40).

**The redemption cap.** The claim is "a rolling window over a 64‑slot ring of timestamps". I verified it is exactly that:

```rust
let k = (cap.max(1) as usize).min(RATE_RING);
let head = c.rate_head as usize % RATE_RING;
let kth = c.rate_ring[(head + RATE_RING - k) % RATE_RING];
require!(now - kth >= c.redeem_window_secs, RateLimited);
c.rate_ring[head] = now;
c.rate_head = ((head + 1) % RATE_RING) as u8;
```

`head` is the next write slot, so `(head − k) mod 64` is the k‑th most recent. The condition "the k‑th most recent is at least a window old" is exactly "no window ending now contains k or more". The ring starts all‑zero, so the first `cap` redemptions land. `cap = max(1, ceil(live × 210/10000))`, and `k = min(cap, 64)` means above live 3,047 the limit is **stricter**, never looser — I checked: `ceil(3047×210/10000) = 64`, `ceil(3048×…) = 65 → k=64`, so the window then holds 64 instead of 65. Stricter. ✅

`live = minted_total − burned_total − bare_burns_retired`, read from MINT's config by pinned offsets. The `rate_head: u8` with `% RATE_RING` is safe for any stored value. The evidence: `RL.2` lands exactly the cap against an empty window and refuses the extra; `RL.3` still refuses at 60% of a window; `RL.4` lands after it rolls; and **`RL.7` replays every redemption the ring remembers against the cap certified for that redemption's own snapshot interval**, refusing to credit any whose cap is ambiguous (`stampCaps` throws on ambiguity, and `RL.S1–RL.S6` prove that helper both ways). That last construction is unusually careful and I want to note it: a naive replay would have used today's cap for yesterday's redemption, and the suite refuses to do that.

**No finding in R6 on the programs.** One on the launch gate: **F4**.

---

# R7. CROSS‑PROGRAM RAW READS

I recomputed every pinned offset from the struct definitions. Anchor accounts are `8` discriminator bytes then fields in declaration order, Borsh, fixed‑size here by design.

**SEAL `Config`** = `disc 8 | version u8 @8 | collection 32 @9..41 | reserve_mints Vec<Pubkey> @41 (u32 len, then keys) | bump`.
MINT/BURN pin `OFF_VERSION = 8`, `OFF_COLLECTION = 9`, `OFF_RESERVES = 41`. ✅

**MINT `MintConfig`**, cumulative from 8:

| field | size | offset |
|---|---|---|
| version | 1 | 8 |
| collection | 32 | 9 |
| governance | 32 | **41** |
| pool_ata | 32 | **73** |
| round_id | 4 | 105 |
| opens_at | 8 | 109 |
| closes_at | 8 | 117 |
| price | 8 | 125 |
| cap | 4 | 133 |
| minted_this_round | 4 | 137 |
| minted_total | 8 | **141** |
| max_supply | 8 | 149 |
| bank_treasury | 32 | **157** |
| split_bps | 2 | 189 |
| sales_stopped | 1 | **191** |
| sweep_stopped | 1 | **192** |
| guardian | 32 | 193 |
| swap_operator | 32 | 225 |
| sol_reserve_lamports | 8 | **257** |
| bump | 1 | 265 |
| max_sweep_lamports | 8 | **266** |
| sweep_cooldown_secs | 8 | **274** |
| last_sweep_at | 8 | 282 |
| level_caps | 20 | 290 |
| level_minted | 20 | 310 |
| revealed_total | 8 | 330 |
| payment_mint | 32 | 338 |
| pob_collection | 32 | 370 |
| pob_root | 32 | 402 |
| charter_opens_at | 8 | 434 |
| charter_closes_at | 8 | **442** |
| charter_claimed | 4 | 450 |
| bare_burns_retired | 8 | **454** |
| total_active_weight | 8 | 462 |
| active_count | 8 | 470 |
| acc_scaled | 16 | 478 |
| owed_scaled | 16 | 494 |
| last_distribute_at | 8 | 510 |
| sales_stopped_at | 8 | **518** |
| sweep_stopped_at | 8 | **526** |
| pending_swap_operator | 32 | 534 |
| pending_swap_operator_at | 8 | 566 |
| monthly_secs | 8 | 574 |
| pending_guardian | 32 | 582 |
| pending_guardian_set | 1 | 614 |
| pending_guardian_at | 8 | 615 |
| notice_secs | 8 | 623 |
| sweep_floor_lamports | 8 | **631** |
| cooldown_ceiling_secs | 8 | **639** |
| reserve_ceiling_lamports | 8 | **647** |
| dist_epoch | 8 | 655 |
| pending_count | 8 | 663 |
| pending_this_epoch | 8 | 671 |
| cbob_mint | 32 | 679 |
| max_boost_weight | 1 | **711** |
| max_boost_epochs | 2 | **712** |
| boost_price | 8 | 714 |
| boost_weight | 1 | 722 |
| boost_epochs | 2 | 723 |
| boosts_active | 4 | 725 |
| boosts_due | 4 | 729 |
| boost_weight_total | 8 | 733 |
| cbob_burned_total | 8 | 741 |
| boost_expiring | 256 | 749 |
| **end** | | **1005** |

GOV pins (bold above): 41, 9, 191, 192, 518, 526, 631, 639, 647, 711, 712, 141, 454, 442, 257, 266, 274. **All correct.** BURN pins 8, 141, 454. **Correct.** The suite's offset constants match mine (I cross‑checked `OFF_BOOST_RING = 749`, `BOOST_RING = 64`).

GOV's length guard is `d.len() >= OFF_MINT_MAX_BOOST_EPOCHS + 2 = 714`, which covers everything it reads. ✅

**`MINT_CONFIG_SPACE`** sums to: `8+1+96+4+8+8+8+4+4+8+8+32+2+1+1+32+32+8+1+8+8+8+20+20+8+32+32+32+8+8+4` = 454… let me just verify the total against my offset table: the struct body ends at 1005, so space should be `1005 + CONFIG_PADDING(256) = 1261`. Summing the expression: `8+1+96 = 105`; `+4+8+8+8+4+4+8+8 = 157`; `+32+2+1+1 = 193`; `+32+32+8+1+8+8+8 = 290`; `+20+20+8 = 338`; `+32+32+32+8+8+4 = 454`; `+8+8+8+16+16+8 = 518`; `+8+8+32+8+8 = 582`; `+32+1+8+8+8+8+8+8+8+8 = 679`; `+32+1+2+8+1+2+4+4+8+8+256 = 1005`; `+256 = 1261`. ✅ **Exactly my computed end plus padding.**

**`VaultRecord`**: `8|version1@8|asset32@9|mint_index8@41|reveal_slot8@49|level1@57|charter1@58|entropy_set1@59|entropy32@60|attrs_hash32@92|bump1@124|active1@125|retired1@126|reschedules2@127|vault_ata32@129|debt16@161|pending1@177|request_epoch8@178|boost_weight1@186|boost_end8@187|carry16@195` → end **211**. `VAULT_RECORD_SPACE = 8+1+32+8+8+1+1+1+32+32+1+1+1+2+32+16+1+8+1+8+16+10` = let me sum: `8+1+32+8+8 = 57`; `+1+1+1 = 60`; `+32+32 = 124`; `+1 = 125`; `+1+1+2 = 129`; `+32 = 161`; `+16 = 177`; `+1+8 = 186`; `+1+8 = 195`; `+16 = 211`; `+10 = 221`. ✅ Matches SPEC's stated 221 bytes. GOV pins `OFF_REC_VERSION=8`, `OFF_REC_ASSET=9`, `OFF_REC_INDEX=41`. ✅ The proxy pins `pending` at 177. ✅

**`BurnConfig`**: `8|version1@8|collection32@9|bump1@41|burned_total8@42|redeem_window8@50|rate_head1@58|rate_ring512@59` → end 571. Space `= 8+1+32+1+8+8+1+512+256 = 827`. GOV pins `OFF_BURN_TOTAL = 42`. ✅ Suite pins `OFF_REDEEM_WINDOW=50`, `OFF_RATE_HEAD=58`, `OFF_RATE_RING=59`. ✅

**`GovConfig`**: `8|version1|collection32@9|quorum2@41|threshold2@43|min_voting8@45|proposal_count8@53|bump1@61|last_round8@62|last_guardian8@70|last_arm8@78|last_boost8@86` → 94. Space `8+1+32+2+2+8+8+1+8+8+8+8+256 = 350`. ✅ The suite reads `proposal_count` at 53 (`nextProp`). ✅

**The sweep helper's raw SPL read**: `mint 0..32`, `owner 32..64`, `amount 64..72`, length exactly 165. Confirmed against `spl.AccountLayout` in `decode.test.mjs`, which encodes with the official layout and compares every field. ✅ `probe-round5.test.ts` D2.1–D2.3 measure that SPL's COption tag is **4 bytes** and reads `[0,0,0,0]` after a revoke, which is the fact BURN's delegate check rests on — and that probe exists because an auditor once claimed it was 1 byte.

**Discriminators.** The suite derives every one and compares: `3.1a/b/j/k/l/m/t` for instruction discs, `3.1n/o/p/u/y` for account discs, `3.1q/r` for the retire/burn pair, `BO.29` for `set_boost_terms`. And `3.1v` asserts MINT, GOV and BURN all pin `MINT_CONFIG_VERSION = 6` **and that the live chain account carries 6**. `3.1w` reads four live config values through GOV's raw offsets and compares with the expected values. **That is behavioural, not textual, and it is the right check.**

**No finding in R7.** Offsets and spaces are correct.

---

# R8. THE SUITE, THE SIMULATION AND THE BUILD AS EVIDENCE

**Arms that cannot fail.** I hunted for these specifically.

* `X.7` is honest about its own vacuity: *"with every level drawn, the crank plans NO reveal on the live chain (the queue it reads is empty)"* and asserts `ord.length === 0 && revealed == minted`. The comment says the ordering itself is proven in `bank/selftest.mjs`. That is a declared‑vacuous arm, which is better than a hidden one, but it does mean the on‑chain suite does not test crank ordering.
* `ID.1` asserts every assertion id is unique, which is what stops a `because()` pin reading another arm's error. Good.
* `RL.1a` asserts `live*210/10000 == 0` — i.e. it documents that rounding *up* is what lets anything out. Trivially true but it is labelled as a precondition, not a property.
* `0.2a`/`R31.W2a`: the dust‑then‑initialize arm. `0.2a` would pass whether or not the dusting mattered, but `R31.W2a` separately asserts the pre‑state (System‑owned, 1,000,000 lamports) **and** the post‑owner. The precondition makes it non‑vacuous.
* The `because()` list is long and specific. I spot‑checked several pins against the code path and found them right (e.g. `9.13` pinned to the **System** program's 0x0 because the record PDA already exists, with a comment explaining that Core is never reached — that is a wrong‑reason trap deliberately defused).

**Arms whose negative fires for a different reason.** The `because()` mechanism is the defence, and `S7.2!` in the simulation is the strongest example I found: it predicts the **one** reason from the chain's own epoch (`NoActiveVaults` at epoch 0 else `JoinWaitingFirst`) and asserts the other is **absent**. That is better than most suites manage.

**Claims in this prompt that no arm exercises.** This is the useful part of R8, and I found several:

1. **The rescue moving a frozen/sealed vault is never asserted as such.** `R35.N2` asserts the vault lands at the Squads *and* is still frozen, which is indirect evidence that the force‑approve overrode the seal — but there is no arm that says "a `PermanentFreezeDelegate`/`FreezeDelegate` on the vault does not stop the rescue". See **F5**.
2. **`require_live_vault`'s `d[0] == KEY_ASSET_V1` on the *host*** is never exercised (the review's L6.1). A host that is the **collection** would, absent that check, give `dest` = … actually no: with the single destination, a collection host now just fails `HostUnresolved`. So the consequence of deleting the check is milder than it was in the first build. Still unexercised. See **F5**.
3. **The claim‑first ordering in the redemption has never landed on chain.** S8 lands `[open, claim, sweep, burn]`; the page builds `[claim, open, sweep, burn]`. `plan.test.mjs` asserts message‑byte equality with the sim builders *reordered*, which proves the page's instructions are right but **not** that the chain accepts that order. I reasoned it does (neither walk depends on ordering relative to the claim), and the e2e log claims 80/80 including a full redemption — but the e2e is not a gate and its log is not bundled. See **F3**.
4. **The C5 Core‑Execute‑Transfer path's compute** is unmeasured. The page may add up to several of these; each is a Core Execute. See **F7**.
5. **`sweep_sol_for_swap` at the ruled 6‑hour cooldown** is exercised only at 1s/20s/21s. SPEC says the 3600/7‑day/30‑day values are "the same arithmetic", which is true, and the alarm is said to assert the live values. Recorded, not filed.

**Is every program's mainnet bytes proven to be the bytes the suite ran?** This is the question I want to answer precisely, because the tree makes a *partial* claim and is honest about it.

* **Sweep helper: fully proven.** `dist/ == $CACHE/ln == target/deploy`, by `cmp`, and it has no feature flag. ✅
* **The four keyed programs: NOT proven byte‑identical, by construction, and correctly so.** `--features localnet` swaps `INIT_AUTHORITY`, so the tested binary *cannot* be the shipped one. The build proves the *property* instead: both builds are deployed, and each is asked whether it trusts the test key — mainnet must REJECT **with `NotTheInitAuthority` specifically**, localnet must ACCEPT (or reach a later check from the named `REACHED_PAST` list). The closing banner states exactly what is and is not proven, including "NOT PROVEN that the compiled constant IS that key", with reproducibility named as the bridge. **I confirm the banner's claims are accurate and not overstated.**
* **But there is a gap the triage already found (C12) and nobody closed:** for the four keyed programs, `build-mainnet.sh` never `cmp`s the fresh `$LN_DIR` build against `target/deploy/*.so` (the file the suite actually deployed). It only hashes `target/deploy` for the record. So "the localnet artifact that ACCEPTED the test key" and "the localnet artifact the suite ran" are two different files, never compared. See **F8**.

**The floors.** Every suite has one and each must **EQUAL** the count, not merely clear it — the comment explains that a `-ge` floor accumulates slack, which was a real round‑19 finding. `MIN_ASSERTIONS = 889`, `SIM_FLOOR = 71`, `DET_FLOOR = 917`, `ALLOC_FLOOR = 39`, `POSTER_FLOOR = 23`, `MAINNET_FLOOR = 33`, `POB_FLOOR = 14`, `LAUNCH_FLOOR = 49`, `HOST_FLOOR = 6`, `EXPIRY_FLOOR = 4`, `SWAP_FLOOR` (in the fork script). `CBOB_TEST_FILE` is refused; `CBOB_CACHE` must be the default (because the suite reads the wrapper keypair from `$ROOT/.cache`); the Core hash is **hardcoded, not env‑overridable**, with a comment explaining that an env‑overridable pin is defeated by whoever would defeat it. The `floor()` helper prints and dies. **These gates are real.** One caveat: `web/test/run-all.mjs` has its own floor table (`{ids:37, ix:47, decode:16, plan:87, get:49, ceremony:82, tx:7, proxy:52, meta:21, bundle:59}` = 457) but **`run-all.mjs` is not invoked by `scripts/run-tests.sh`**. See **F9**.

---

# FINDINGS

Ordered by target. For each: the construct, what is gained, the evidence that would exist if I am right, and the fix.

---

## F1 — MEDIUM. `web/`: the proxy's `sendTransaction` allowlist does not bound *what* a CBOB instruction does, so the endpoint will relay a holder‑signed transaction that drains that holder

**Construct.** `web/deploy/rpc-proxy.mjs` `txRefusal()`:

```js
for (const ix of tx.message.compiledInstructions)
  if (!TX_PROGRAMS.has(keys[ix.programIdIndex])) return 'that transaction calls a program these pages never call'
```

`TX_PROGRAMS` includes `TOKEN_PROGRAM`, `SYSTEM_PROGRAM` and `CORE`.

**What is gained.** The proxy is described in the README as "the endpoint is not a relay for other people's transactions" and M1's repair is presented as closing the open‑relay problem. It does not close this part. A transaction consisting solely of `SystemProgram.transfer` and/or SPL `Transfer` instructions — i.e. an ordinary wallet drain, already signed by whoever was phished — passes `txRefusal` and is forwarded with our provider key. So the site's endpoint can be used as the broadcast leg of a phishing kit, at our credit cost, attributable to our provider account. The Origin check does not stop it: a page on another origin cannot *read* the response, but `sendTransaction` needs no response to succeed, and a non‑browser client can set any Origin header (the proxy's own comment admits this: "A script can forge an Origin").

This is not a loss of CBOB funds and it is not a program defect. It is a reputational and operational exposure on an endpoint we are about to publish, and it is exactly the class the M1 repair was meant to close.

**Evidence if I am right.** A POST to `/rpc` with `Origin: https://centralbankofbitcoin.com`, body `sendTransaction` of a base64 legacy transaction containing one `SystemProgram.transfer`, returns 200 and a signature, and the provider's logs show the forward. `proxy.test.mjs` already proves half of this: it asserts "a prior transaction (ATA creates) is accepted" using only ATA/System instructions, so the accepting path for non‑CBOB‑program transactions is tested as a *pass*.

**Fix (cheap, and no program change).** Require that **at least one** instruction names one of the five CBOB program ids. The pages' own transactions all do: the redemption (`SEAL`, `CORE`, `BURN`, `MINT`), the claim/buy (`MINT`), activate/rescue/draw (`MINT`), and the **prior** transaction (ATA creates only) — that last one is the exception, so either allow a transaction whose instructions are *all* `ATA createIdempotent` for at most a handful of accounts, or have the page fold one harmless CBOB read‑only instruction into it. Add a `proxy.test.mjs` arm: a pure System transfer is 403, and each real page transaction is 200.

---

## F2 — MEDIUM. `web/`: the sweep helper permits another vault's asset‑signer as the destination wallet, and nothing in the page or the helper refuses it

**Construct.** `programs/cbob-vault-sweep/src/lib.rs`:

```rust
if signer.key == dest.key { return Err(ProgramError::InvalidArgument); }
```

That is the **only** destination check. `plan-redeem.mjs` always passes `owner` as `dest`, so the shipped page is safe. But the helper is being made immutable, and the prompt asks the question directly: *"the destination wallet is the vault's own asset-signer PDA (refused) or another vault's asset-signer?"*

**What is gained.** A client (ours later, or a third‑party one, or a malicious page impersonating us) can have the owner sign a redemption whose sweep sends every reserve balance and every lamport into **another vault's deposit address**. For tokens that is recoverable only by redeeming that other vault; for the **lamport transfer** it is worse, because after the sweep the receiving vault's wallet holds lamports that `burn_vault` will then refuse (`lamports != 0`) until a *further* sweep moves them — so one mis‑built redemption can leave a second, unrelated vault temporarily unredeemable, and the only cure is that vault's own owner running a sweep. Dust griefing of a vault's wallet is already a known shape (9.10/9.11), so this is not a new class; what is new is that it can be caused by a *signed* redemption of a different vault, which is harder to attribute.

I want to be precise about severity: **this is not reachable by anyone but the owner of the vault being swept**, because the helper needs Core's Execute. So it is a self‑inflicted or phished loss, not a theft primitive. That is why I file it MEDIUM and not HIGH, and why the fix I recommend is on the page, not the program.

**Evidence if I am right.** A suite arm in the shape of SR.2: build a genuine redemption of vault A whose helper call names vault B's asset‑signer as `dest` and B's reserve ATA as the destination account. It will **land** (the pair checks pass: source owned by A's signer, destination owned by `dest` with the same mint), A's balances will appear in B's deposit address, and B's wallet will hold A's lamports. Then `burn_vault` for B refuses `VaultNotEmpty` until B's owner sweeps.

**Fix.**
1. **Page (do this):** in `plan-redeem.mjs`, assert `dest.equals(owner)` and refuse otherwise; the page never has a reason to do anything else. Add a `plan.test.mjs` arm.
2. **Program (only if the programs are being changed anyway for item 58):** the helper cannot cheaply tell "is this address a Core asset‑signer PDA" without a seed. It *can* be told: add an optional trailing account that must equal `dest` and be System‑owned with zero data, or simply require `dest` to be System‑owned (`*dest.owner == system_program::ID`) when a lamport transfer is going to happen. Note the latter would break `R27.S1`, which deliberately measures a token‑account destination receiving lamports, so this is a real trade‑off and I do **not** recommend changing the program for it. Fix the page.
3. **SPEC:** add one line to the F1 "Known limits" entry: the helper does not compare `dest` with the asset's owner, so the client must; naming another vault's deposit address moves value into a second vault and temporarily blocks its redemption.

---

## F3 — MEDIUM (evidence). The redemption order the page sends (`claim` first) has never landed on any chain, and the one measured shape puts `claim` second

**Construct.** SPEC item 50's client contract says "`claim` before the sweep". `sim/test-vault.ts` S8 builds `redIxs = [ixOpen, ixPoolClaim, ...viaCore, ixBurn]` — claim **after** open. `web/src/lib/plan-redeem.mjs` builds:

```js
if (claim) ixs.push(IX.poolClaim(...))
ixs.push(IX.openForRedemption(...))
ixs.push(IX.coreExecute(... sweepHelper ...))
...
ixs.push(IX.burnVault(...))
```

claim **before** open. `web/test/plan.test.mjs` handles the difference by reordering the reference:

```js
const refPageOrder = [simRedIxs[1], simRedIxs[0], simRedIxs[2], simRedIxs[3]]
H.t('plain: the WHOLE legacy message equals the sim S8 builders in the page\'s order', messageBytes(p.redemption, owner).equals(messageBytes(refPageOrder, owner)))
```

So the *instructions* are proven identical; the *order* is proven only against itself.

**What is gained / what is at risk.** Nothing is stolen. The risk is that the shipped page's exact transaction has never been accepted by a validator, and the programs are about to become immutable. I reasoned carefully about whether the order can matter and concluded it cannot: SEAL scans forward from `current+1` for the burn (the claim before it is invisible to that scan and irrelevant), BURN scans `0..current` for the open (which is still before it), and `retire_redeemed` checks `get_stack_height()` and the **current** top‑level instruction, not position. `monthly_inline` inside `claim` runs before the open, which only means a due month is credited before the vault is retired — but `retire_redeemed` runs `retire` first and `monthly_inline` after, specifically so the leaving vault is not credited; a claim‑first in‑line run *would* credit the leaving vault, and then `retire` would refuse `ClaimBeforeBurn`… **no**: the claim pays the vault first and then the in‑line run credits it again, leaving a new owed share that `retire_redeemed` would refuse unless the pool is frozen. That is a real ordering consequence.

Let me chase it, because it decides whether this is MEDIUM or HIGH. In the page's order: `claim` runs → its `monthly_inline` runs *before* paying (the code calls `monthly_inline` then iterates the pairs), so if a month is due the vault is credited and then paid in the same instruction, leaving `owed_of == 0`. Then `open`, sweep, `burn_vault` → `retire_redeemed` → `retire(redeemed=true)` requires `pending < ACC_SCALE`. Since the claim paid everything credited including the in‑line month, `pending` is the sub‑sat residue only. **So it works.** In the sim's order the same holds. The ordering is benign because `monthly_inline` precedes the payment inside `claim`. Good — that is a deliberate comment in the code ("BEFORE paying, so a claim that closes a month also delivers it") and it is load‑bearing for the page's order.

So I downgrade this from "possible defect" to **"the shipped shape is unmeasured on chain"**, which is still worth filing because the programs become permanent.

**Evidence if I am right that it is unmeasured.** Grep the suite and the sim for any landed transaction whose instruction list begins with MINT `claim`: there is none. `P.22` and `S8` both put `open` first. The `e2e-localnet.sh` harness does drive the page's order, but it is not run by `scripts/run-tests.sh` and its log is not bundled as evidence.

**Fix.** Add one arm to the Test Vault simulation (or the suite) that lands the **page's exact order** with a month due, and asserts: it lands; the vault received its share; `retire_redeemed` did not refuse; the pool's `owed` fell correctly. Raise `SIM_FLOOR`. Alternatively make `web/test/e2e-localnet.sh` a gate (see F9) and bundle its log. Either is cheap; the second also closes F9.

---

## F4 — MEDIUM. The launch gate does not cover the one key that can replace every program before step 11, nor the vault collection it must now check

**Construct.** `launch/mainnet-init.json` + `scripts/check-launch-params.mjs` are, by SPEC item 38, *"the only gate"* on the exact ruled values before anything is signed. Two things that now decide the launch are outside it:

1. **The placeholder upgrade authority** `FZjLB4e9mVMZTWA6YR1KbXVbByTqWsHpHy5sK83yJYUY`, whose secret is `bank/keys/deploy-authority.json`. It appears only in SPEC prose (step 9) and in round 34/35 validation records. It is **not** a value in `mainnet-init.json`, so the checker never asserts it, and nothing in the tree verifies that the on‑chain ProgramData authority of the five ids is that key rather than someone else's.
2. **`vault_collection`**, which the round‑35 change added as `OPEN`. The ceremony page judges a *substituted copy* (`launchWithCollection`) rather than the file, so the committed file can remain `OPEN` forever and the ceremony will still proceed. That substitution is correct and well‑tested (`ceremony.test.mjs` covers the conflict cases), but it means the **file** is never the gate for that one field, and SPEC item 38's list of values does not mention `vault_collection` at all.

**What is gained.** Until step 11, whoever holds `FZjLB4e9…` can replace any of the five programs with anything — including, now, a MINT that signs with the `["rescue"]` PDA to transfer any vault anywhere. The transfer power exists on every vault from mint, so this window is strictly more dangerous than it was before round 35. SPEC limit 13 covers "a level rewrite"; it does not name the rescue delegate. And the key's *identity on chain* is asserted nowhere: if the placeholder deploy had been signed by a different key (a mistake, or a compromise during the claim), the next thing to notice would be a failed upgrade at step 9, by which time the ids are burned.

**Evidence if I am right.**
* `grep -r deploy-authority launch/ scripts/` finds nothing. `grep placeholder_upgrade launch/mainnet-init.json` finds nothing.
* `grep vault_collection SPEC.md` finds it only in the road‑step‑10 text and item 50, not in item 38's enumerated list.
* A `solana program show` of each of the five ids today returns `Authority: FZjLB4e9…` — which is a fact nothing in the tree checks, so nothing would notice if it returned something else.

**Fix.**
1. Add `placeholder_upgrade_authority` (RULED, `FZjLB4e9…`) to `launch/mainnet-init.json`, and a checker rule that it is a real on‑curve key. Add a **ceremony preflight line** (and/or a step‑9 runbook command) that reads each of the five ProgramData accounts and asserts `upgradeAuthority == that value` — the ceremony already parses ProgramData and *prints* the authority (`plan-ceremony.mjs` / `ceremony.mjs` "upgrade authority: … still upgradeable"), so this is a one‑line change from printing to asserting.
2. Add `vault_collection` to item 38's enumerated list, with the note that its value is produced by step 0 and must be recorded before the holder pages are built.
3. Add the rescue delegate to SPEC limit 13's consequence sentence: until the authority is removed, whoever holds it could ship an instruction that **transfers any vault**, not only one that rewrites a level.
4. Operationally: keep `deploy-authority.json` offline between steps 9 and 11, and confirm it really is in the nightly encrypted set (VALIDATION says snapshot `e5dce8ca` verified this; the include list reference is `bank/keys`, which is plausible but I cannot verify from the bundle).

---

## F5 — LOW (evidence). Two load‑bearing checks on the new rescue path are unexercised, and the one Core behaviour the rescue *depends on* is asserted only indirectly

**Construct.** `programs/cbob-vault-mint/src/lib.rs` `rescue_nested` / `require_live_vault`.

(a) `require_live_vault` requires `d[0] == KEY_ASSET_V1` and `d[33] == UA_DISC_COLLECTION` and the collection match. On the **host**, no arm reaches the `d[0]` branch: `R35.N7` uses a never‑created host (absent account → `try_borrow_data` on a zero‑length account → `d.len() >= 66` fails), `R35.N9` uses a foreign *asset* (collection mismatch). A host that is the **vault collection itself**, or a Core `CollectionV1`, is never tried.

(b) `require_keys_eq!(a.new_owner.key(), dest, WrongRescueDestination)` is exercised once (`R35.N1`, the host's owner). A *random third* address is not tried. That is a thinner pin than it looks, because N1's address happens to be the host's owner — if the check were accidentally written against the host's owner instead of `bank_treasury`, N1 would *pass* (it expects REJECT)… no, it would then ALLOW and N1 would fail. Fine. But `R35.N4` (a burned host, destination = the last holder) covers the other side. Acceptable.

(c) The rescue **must** move a frozen, sealed vault (every live vault is sealed). The only evidence is `R35.N2`'s post‑state assertion that the seal is still `frozen: true` after the transfer landed — which does prove the transfer happened to a frozen vault. So (c) is actually covered, indirectly but genuinely. **I withdraw (c).** What is *not* covered is an **owner‑added** `FreezeDelegate{frozen:true}` or `PermanentFreezeDelegate` on the vault: those also deny transfer in Core, and `force_approve` is what overrides them. If Core's precedence changed, a holder who froze their own vault would make it unrescuable — a liveness regression, not a loss.

**What is gained.** Nothing by an attacker. The exposure is that a future reader (or a Core upgrade) could delete or weaken these without the suite turning red, in a program that can never be fixed.

**Evidence if I am right.** Delete `require!(... d[0] == KEY_ASSET_V1 ...)` from `require_live_vault` and run the suite: it stays green at 889. Add `FreezeDelegate{frozen:true}` to a nested vault and rescue it: no arm asserts the outcome either way.

**Fix.** Three arms, cheap:
* vault parked at `PDA(COLL)` (the collection's own signer PDA), host = the collection → `HostUnresolved`, pinned by `because`.
* host owned by SPL Token or System with ≥66 bytes of data → `HostUnresolved`.
* a nested vault whose owner has added `FreezeDelegate{frozen:true}` → the rescue still lands (or, if Core refuses, the arm records that and the limit is written). This is the R34.G4 family applied to the new plugin, and it is the one that tells holders whether freezing their own vault can strand it.

Raise `MIN_ASSERTIONS` accordingly.

---

## F6 — LOW. `web/`: the redeem page will build a redemption that abandons a stray it *could* have moved, because the fit loop drops pairs without trying the cheaper C5 form, and the "left behind" wording understates what is lost

**Construct.** `plan-redeem.mjs`:

```js
while (size > PACKET_LIMIT && (hs.length || ts.length)) {
  left.push(ts.length ? ts.pop() : hs.pop())
  redemption = build(hs, ts); size = legacySize(redemption, owner)
}
```

Each `ts` entry costs a **whole Core `ExecuteV1`** (program + 6 fixed accounts + the inner transfer's 3), whereas each `hs` entry costs **one pair** inside the single existing Execute. The loop drops `ts` first, which is the right instinct (they are the expensive ones), but it drops them *entirely* rather than considering whether an `hs` could be dropped instead to keep a more valuable `ts`, and it never tells the holder the relative value.

**What is gained.** A holder with a genuinely valuable C5‑shaped holding (a stranger set the close authority but the balance is the holder's, e.g. someone sent them real tokens into a vault using a pre‑made account) and several worthless dust strays will be asked to abandon the valuable one and keep the dust, because `ts` is popped first. The acknowledgement text says only "There is no room to take it out in the same opening (the transaction is full)".

**Evidence if I am right.** Construct a snapshot with one `ts` holding 10⁹ units and nine `hs` each holding 1 unit, sized so exactly one must go. `planRedemption` puts the `ts` in `left` and keeps all nine `hs`. `plan.test.mjs`'s "8 strays" arm asserts only `helperStrays.length + left.length === 8`, so it would not catch this.

**Fix.** Sort the droppable set by `amount` ascending (or, better, let the holder choose: list the candidates with balances and let them tick which to abandon), and make the acknowledgement name the balance. Add an arm asserting the *largest* holding is never the one dropped. Also reword to say plainly: "X units of Y are destroyed when the vault is opened; take them out in a separate step first if they matter" — because they **can** be taken out first: the holder could run a redemption of only that pair... no, they cannot, a vault opens once. Then the honest wording is "destroyed", not "there is no room".

---

## F7 — LOW (evidence). The C5 transfer path's compute and packet cost are unmeasured, and the page can emit several of them

**Construct.** `plan-redeem.mjs` emits one `coreExecute(tokenTransfer(...))` per C5 account. Each is a full Core `ExecuteV1`. The only measured redemption compute is `S8.1a` = 168,343 CU for the **four‑instruction** shape with zero C5 transfers. The page sends no `ComputeBudget` instruction, so it relies on the legacy default of 200,000 CU **per instruction**, i.e. `200,000 × n`.

**What is gained.** Nothing by an attacker; a holder could get a failed redemption. The per‑instruction default means the budget scales with the instruction count, so adding C5 Executes raises the ceiling as well as the cost — which is why I rate this LOW. But a Core `ExecuteV1` into Token is not free (Core's own overhead plus the CPI), and nobody has measured it inside a redemption. A stranger can create C5 accounts at will (that is the whole point of C5), so the count is adversary‑controlled up to the packet limit.

**Evidence if I am right.** No arm in `tests/3prog.test.ts`, `sim/test-vault.ts` or `web/test/*` measures `unitsConsumed` for a redemption containing a C5 Execute. `plan.test.mjs`'s C5 arm checks bytes and instruction identity only.

**Fix.** Add a simulation arm that lands (or simulates) a redemption with the maximum number of C5 transfers that fits, and records both `unitsConsumed` and bytes. If the measured total approaches `200,000 × n`, have the page set an explicit compute‑unit limit — noting that SPEC item 50 already says a page "that cannot rely on the wallet keeping its compute-budget instruction sends NO crank", which is about the crank, not about the redemption's own budget.

---

## F8 — LOW. `build-mainnet.sh` proves the key property on a *rebuilt* localnet artifact, never on the artifact the suite deployed

**Construct.** `scripts/build-mainnet.sh`: `$LN_DIR = $CACHE/ln/sbpfv3-solana-solana/release`. Step [4/5] asks `$LN_DIR` whether it accepts the test key. Step [2/5] `cmp`s only the **sweep helper** between `$OUT` and `$LN_DIR`, and additionally between `$OUT` and `target/deploy`. For the four keyed programs, `target/deploy/*.so` (what `run-tests.sh` and `run-sim.sh` deployed) is only `sha256sum`'d for the printed record.

**What is gained.** Nothing by an attacker. But the chain of custody has a link that is asserted nowhere: "the binary that ACCEPTED the test key" and "the binary the 889‑assertion suite ran" are two independently produced files. A toolchain nondeterminism, a stale `target/deploy` from an earlier commit, or an interrupted `run-tests.sh` would break the chain silently, and the script's closing banner would still read "PROVEN … all four LOCALNET artifacts accept it".

This is the triage's C12 and it was not fixed.

**Evidence if I am right.** Build with `run-tests.sh` at commit A, then edit a program, then run `build-mainnet.sh` without re‑running `run-tests.sh`: the script passes and prints a `target/deploy` sha256 from commit A alongside a `dist/` sha256 from commit B, with no error. (It *does* die if `target/deploy/cbob_vault_sweep.so` differs — but only for the sweep helper.)

**Fix.** Four `cmp` lines:

```bash
for f in cbob_vaults cbob_vault_mint cbob_vault_burn cbob_vault_gov; do
  cmp -s "$LN_DIR/$f.so" "$ROOT/target/deploy/$f.so" \
    || die "$f: the localnet build asked about the key is not the build the suite deployed"
done
```

and a banner line saying so.

---

## F9 — LOW. `web/`'s 457 offline assertions and its end‑to‑end harness are not gates: nothing in `run-tests.sh` runs them, so the pages can regress green

**Construct.** `scripts/run-tests.sh` runs: the suite, the detector selftest, allocation, poster, pob‑merkle, launch‑params, host unit tests, the mainnet probe, expiry‑budget, and the swap fork. It does **not** run `node web/test/run-all.mjs`. `web/test/run-all.mjs` has its own equal‑floor table (457) and rebuilds `dist/`, but nothing invokes it. `web/test/e2e-localnet.sh` is explicitly "for you to run; not run here".

**What is gained.** Nothing by an attacker. But item 50 is OPEN AND BLOCKING and is a precondition of road step 11 (making the programs immutable). The pages build every transaction a holder signs. If they are not behind a gate, a change to `plan-redeem.mjs` that reintroduces H1 (refusing instead of acknowledging) would not turn any gate red, and the coverage script's content check would only notice once a round bundled it.

Note that `scripts/audit-coverage.sh` **was** correctly extended to include `'web/*'`, so the *audit* coverage of these files is now enforced. The *test* coverage is not.

**Evidence if I am right.** `grep -n 'web/test' scripts/run-tests.sh` returns nothing.

**Fix.** Add to `run-tests.sh`, after the other selftests:

```bash
WEB_RC=0; WEB_OUT=$(node web/test/run-all.mjs) || WEB_RC=$?
echo "$WEB_OUT" | tail -6
[ "$WEB_RC" -eq 0 ] || die "web offline tests failed (exit $WEB_RC)"
floor "web offline" "$WEB_OUT" 'all [0-9]+ offline assertions passed' 457
```

(The `floor` helper reads the first number of the matched line, so the message format already fits.) And make `e2e-localnet.sh` a `CBOB_SHIP_GATE=1` requirement, with its log recorded, since it is the only thing that lands the page's transactions on a chain (see F3).

---

## F10 — LOW. HOLDER‑GUIDE's rescue paragraph promises a return the program cannot make, and omits that the Squads could vote with a held vault

**Construct.** HOLDER‑GUIDE.md, honest list:

> "if a vault ends up inside another vault (sent to a deposit address), or inside its own, anyone can run the rescue, which moves it to the Bank's multisig, **and the multisig returns it to whoever sent it**."

**What is wrong.** Three things:

1. The return is a **person's act from a multisig**, with no on‑chain obligation and no deadline. SPEC item 58 is honest about this ("the return is a person's act from the Squads, paged by `vault_rescued_to_squads` once and `vault_awaiting_return` every pass until it leaves"). The guide states it as a certainty. The web review's L1 also established that for a **burned** host, "whoever sent it in" is often the *wrong* person: the vault travelled with the host, so the person who controlled it was the host's owner at burn time.
2. The guide's "Who can do what" table has no row for "anyone: rescue a nested vault to a fixed destination", and nothing about the Squads' new custody role — while the same table asserts Gary Club "cannot … open or move a vault in a wallet whose key it does not hold", which a reader will now find at odds with the Squads holding other people's vaults.
3. SPEC item 58 records that the Squads **could vote** with a vault it holds ("which is a custody rule, not a program one: it does not"). The guide does not mention it, and the guide's governance table says a vote is "one vault, one vote" with no note that the Bank may be holding some of those vaults.

**Evidence if I am right.** `grep -n 'returns it to whoever sent it' HOLDER-GUIDE.md` finds the sentence; `grep -n 'rescue' HOLDER-GUIDE.md` shows it appears only in the honest list, not in the table; `grep -n 'multisig' HOLDER-GUIDE.md` shows no mention of voting.

**Fix.** Rewrite the paragraph to: "anyone can run the rescue, which moves it to the Bank's multisig. **We then return it by hand**, to whoever sent it in, or to whoever owned the vault it was inside when that vault was opened. That return is a person's decision, not something the program can force." Add a table row for the rescue, and one line: "While the Bank's multisig is holding a rescued vault it could in principle vote with it. It does not."

---

## F11 — LOW (evidence gap, cannot resolve from this bundle). The crank's handling of nested / self‑owned / off‑curve vaults is unverifiable here, and item 58 changes what the right behaviour is

**Construct.** `bank/crank.mjs` is not in this bundle. The triage's C9 confirmed (against the round‑35 tree) that `planCrank` activates, joins and pays any funded vault whose asset reads `'live'`, without reading the owner bytes. VALIDATION answers it with "superseded by item 58 (payouts into a nested vault travel with it)".

**Why that answer is incomplete.** Item 58 does fix the *loss* (the share is no longer stranded). It does not decide whether our own automation should be putting a nested vault on the payout schedule before it is rescued. And the triage's own note on the rescue interaction is the operationally important half: FB's suggested blanket "refuse off‑curve owners" rule would **starve the rescued‑to‑Squads vaults** of activation and claims, because `bank_treasury` is off‑curve. So the correct rule is narrow (refuse only vault‑PDA owners, and give Squads‑held vaults an explicit exception), and I cannot see whether that is what was implemented.

**Evidence that would settle it.** `grep -n 'data.subarray(1, 33)\|owner' bank/crank.mjs` around the asset classification; and a `bank/selftest.mjs` arm asserting (a) a vault owned by a vault's asset‑signer PDA is not activated or joined, (b) a vault owned by `bank_treasury` **is** still activated and paid.

**Fix.** Bundle `bank/crank.mjs` and `bank/detectors.mjs` in the next round (the coverage gate should already be forcing this if their content changed). If the narrow rule is not implemented, implement it with both‑ways selftest arms, and confirm `vault_awaiting_return` does not suppress the Squads‑held vault's activation.

---

# THE FOUR QUESTIONS ABOUT THE ACCEPTED LIMITS

## 1. Is any limit WORSE than stated?

**Limit 13 (a level is immutable only as far as the upgrade authority is trustworthy) is now worse, and the text has not caught up.** It describes the pre‑lock exposure purely in terms of rewriting a level. Since round 35, every vault carries a `PermanentTransferDelegate` whose authority is MINT's `["rescue"]` PDA, so whoever holds the upgrade authority before step 11 can ship an instruction that **transfers any vault to themselves**, not merely one that repricing its payouts. The pre‑lock window is strictly more dangerous than the limit says. Filed as part of **F4**.

**Limit 44's "Not covered" list is still incomplete in one way the C5 entry does not fix.** The C5 entry (in "Known limits") covers an account whose *close* authority a stranger kept. Limit 44's own list names Token‑2022, a frozen stray with a balance, and nested Core assets. Neither mentions **a compressed NFT** sent to the deposit address, which the web review raised (L1) and which the page now *notes* as "could not look" when DAS fails — but which is a real permanent loss with no account for the burn to see. The page's acknowledgement handles it when DAS answers; limit 44 does not name it. Minor, and I file it only as a documentation note here rather than a finding, because the page does cover it.

**Limit 47 is not worse than stated.** I checked the dynamics above (the thief's stop cannot out‑date restart proposals since round 22, and the replacement bar can only fall as vaults redeem). The "FOR GOOD while fewer than half of all live vaults vote" wording is exactly right.

**Limit 32 is not worse.** The ring arithmetic is a true rolling window and the `k = min(cap, 64)` clamp is stricter above 3,047 live, as stated. Verified above.

**Limit 10's bound is as stated** (cap × windows, never more than the PDA holds above the reserve). Verified in `sweep_sol_for_swap`.

**Limit 26 is not worse than stated.** The best‑of‑4 plus content‑grinding mechanism matches the code; the "skip into the next leader's rotation" variant is strictly worse for the attacker.

## 2. Is anything listed as a limit not actually a limit, already closed, or closed by something the author did not notice?

**Limit 9's framing is now half‑closed by something the author *did* notice but recorded confusingly.** The limit title still reads "Nothing detects a FOREIGN Core asset nested in a vault continuously, and since v6 nothing refuses the redemption either", and the body then says "a nested vault itself is no longer lost (item 58)". But the *redemption* half is now closed for the CBOB‑vault case by the **page**, not only by the rescue: `plan-redeem.mjs` **refuses** a redemption whose deposit address holds one of our vaults and points at the rescue. So for the one case that used to destroy a vault, there is now a preventive control. The limit's "nothing refuses the redemption either" is no longer true once the page ships. Worth rewriting, not re‑filing.

**Limit 50's "the sweep helper … nothing calls it yet" is stale.** The page calls it. The limit was written before `web/` existed and the round‑35 addendum names `web/` but leaves the earlier sentence standing.

**Limit 42's categorical claim is already corrected in place** (round 26 D4 struck "only two fit"). Nothing to add.

## 3. Is any DISCHARGED item not actually discharged?

I checked each.

* **12/17 (compute)**: discharged by measurement on v5 and re‑pinned on v6 by 10.1–10.4 with a 400,000 CU regression ceiling. The text is honest that it is "not a v1 packet or resource-budget measurement". ✅ Discharged.
* **14 (duplicate attributes)**: `check_attributes` has the O(n²) dedupe and 11.4 measures it. ✅
* **19 (unlevelled‑vault halt)**: `activate` requires `(1..=5).contains(&r.level)` → `NotRevealed`, and P.1 measures it. `levels.json` is gone. ✅ Closed by construction.
* **30 (85/15 is a vote)**: `update_wiring` is absent (`0.4i` → `InstructionFallbackNotFound`), the struct has no money field (`P.0e/P.0f`), and `split_bps` is written once. ✅
* **31 (31‑day branch)**: superseded; the period is an init value exercised at 150s. ✅
* **33 (7‑day notice)**: exercised at 60s for both keys (`3c.K5`, `3c.G2`) with early applies refused. ✅
* **51 ($CBOB boost)**: built and measured (section BO, init arms 0.1o–0.1v, two host tests). ✅
* **54 (compute at the widest host shapes)**: measured, and the residual (holder pages must set the limit on any crank‑carrying transaction) is pushed into item 50, which is OPEN. ✅ Correctly discharged with its requirement relocated rather than dropped.
* The v5 Bank/deck/distributor family: all genuinely gone with their subjects. I grepped for `bank: Signer`, `update_config`, `commit_deck`, `handover_governance` and found only the `0.4*` arms asserting their absence. ✅

**One discharge I want to flag as *thinner than it reads*, without claiming it is wrong: item 54's claim batch figure.** "A claim batch costs about 4,000 CU per vault (P.31: 6 vaults, 29,192), so the crank's 14-vault batches sit near 60,000" is explicitly labelled "extrapolated from the measured per-vault cost, not measured at 14". That honesty is correct and the item is still discharged, because the discharge is about the *host shapes*, not the batch. No action.

## 4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?

* **22 (nothing has ever run a distribution against a live chain; nor the revenue cycle)**: still OPEN, with five named rehearsal items. Nothing in the tree treats it as done. Road step 8 is "not started". ✅ Not quietly accepted.
* **38 (every initialize value written once)**: still OPEN (charter date and lock deadline). But see **F4**: two values that now decide the launch (the placeholder upgrade authority, and `vault_collection`) are outside the checker and outside item 38's list, which is a *narrowing of the gate* without the item being reopened to cover them. That is the closest thing to a quiet acceptance I found, and it is why F4 is MEDIUM.
* **50 (holder surfaces not built)**: still OPEN, now with `web/` named as "being BUILT … staged, not published", and the client contract enumerated. The build is substantial and good. **But the *gating* has not moved**: `run-tests.sh` does not run the web tests (F9), and the e2e that lands the page's transactions is "for you to run". So the item is still correctly OPEN, and I am not accusing anyone of treating it as accepted — I am saying that when it *does* close, the gate needs to exist first.
* **52 (pool/Squads cbBTC accounts and revenue rent)**: still OPEN, now wired into ceremony steps 5 and 6 with per‑field re‑reads. ✅
* **53 (rehearsal tree)**: still OPEN, with the explicit note that the `d57ee3a` proof is STALE and must be re‑run at the release commit, plus the named unwritten `launch/rehearsal-init.json`. The `rehearsal` profile in `web/src/config.js` correctly refuses (`launchValues: null`), so the web work did not quietly satisfy it. ✅

---

# WHAT I CHECKED AND COULD NOT BREAK (so the next reader knows where I looked)

* The open↔burn pairing in both directions, including two redemptions in one transaction, a CPI‑wrapped half either way, and the account‑index binding.
* The emptiness proof's four `continue` branches.
* `retire_redeemed`'s caller proof: `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT + 1` **and** the current top‑level instruction being BURN's `burn_vault` with `accounts[0] == asset`. Both are needed; the first alone would allow any program's direct CPI, the second alone any depth.
* The pool invariant, under every writer.
* The boost ring past epoch 64, by re‑deriving the model.
* Every GOV tally gate's rounding.
* Every `initialize` bound against the ruled values.
* Every cross‑program raw offset and every account space, recomputed from the structs.
* The rate‑limit ring's index arithmetic and the `k` clamp.
* The royalty plugin's encoding and its immutability in Core (with the suite's control arms).
* The rescue delegate's single signing path, destination, and refusal set.
* The sweep helper's every refusal branch and the lamport arithmetic.
* `web/`: the signing guard (`signExact` refuses any message change and verifies before extra keypairs sign), every instruction against the suite's extracted builders, the Core/SPL readers against the official deserializers, the proxy's shapes and limits, the ceremony's per‑step re‑read, and the metadata generator's monotonicity.

---

# GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

AI audit is good at the things this tree has already exhausted: re‑deriving offsets, enumerating refusal branches, finding stale prose, noticing that a gate's subject changed shape. It is structurally bad at four things, and those four are where the remaining risk lives. Each item below is a concrete act, not advice.

**1. Run the money, with money, before step 11 — and treat the rehearsal's named items as pass/fail, not as a demo.** Item 22 is the single largest unmeasured surface in the project: the crank's I/O at 2,100 vaults, and the revenue cycle's sweep→swap→return→split→ledger→recovery loop, have *never* executed against a live cluster. No model can discover a rate‑limit shape, a provider timeout at vault 1,900, a confirmation that times out after landing, or a double‑swap. The five named items in limit 22 are the right list; the only addition I would make is **a sixth: land the holder pages' exact transactions** (the redemption in the page's claim‑first order, a charter claim, a purchase, both rescues, an activation) at throwaway ids, and record the signatures. That closes F3 and converts `web/`'s 457 offline assertions into something that has touched a chain.

**2. Have a second human, not a model, independently re‑derive two numbers and one key.** The ones where a silent error is permanent and no test can catch it: (a) the three reserve mints and that `payment_mint` is among them — a 2‑mint SEAL list permanently destroys the omitted asset on every redemption, and SEAL checks only account *owners*; (b) the `pob_root`, recomputed from an independently fetched list of the 240 addresses rather than from `scripts/pob-set.json`; (c) that the on‑chain upgrade authority of all five ids is the key in `bank/keys/deploy-authority.json`, and that that key is restorable from the offsite backup **by actually restoring it to a scratch directory and comparing the pubkey**. A model can tell you the checker checks the file. It cannot tell you the file is right, and it cannot tell you a backup restores.

**3. Decide and write down the two custody policies that are currently prose.** The Squads will hold other people's vaults (item 58) and could vote with them; the Giraffish Moments key stays hot through the charter window and can end the project (limit 46). Both are ruled. What is missing is an operating document, signed by Gary, that says: who may move a rescued vault and on what evidence; what the return SLA is; who watches the Moments key during the seven days and what they do at the first unexpected plugin diff; and what the stop‑the‑launch criteria are. Immutability means there is no second chance to decide this under pressure. Write it before step 10, not during.

**4. Rehearse the two emergencies you cannot practise afterwards.** (a) The guardian stop: pull `emergency_stop_sales` on the rehearsal deployment, confirm redemption/claims/distribution are genuinely unaffected, run the restart vote end to end, and time it. (b) The pool freeze: freeze the rehearsal pool, confirm a redemption still lands and forfeits, confirm the in‑line monthly run does nothing, and confirm the alarm's pages read the way a person at 3 a.m. needs them to. The code paths are tested (3c.F0–F3, 6c.*); the **human** path is not, and after step 11 the human path is the only one left.

**5. Two cheap, pre‑lock program decisions worth putting in front of Gary, because they are the last chance.** I am not recommending either — both have real costs — but both close permanent holes and cannot be revisited:
  * Require `mint_vault` to be a **top‑level** instruction (the stack‑height check `retire_redeemed` already uses). That forces the owner to sign the transaction, which only an on‑curve key can, and closes limit 43 (a DAO buying an unredeemable vault) at the cost that no program could ever mint a vault by CPI. SPEC already records this as "not built; an owner decision, and only possible before the lock".
  * Have `activate` refuse a vault whose owner is `PDA(["mpl-core-execute", asset], CORE)` for any asset. That is two lines and closes the "our own crank puts a nested vault on the payout schedule" class (F11) on chain rather than in a cron we cannot audit here.

**6. Finally: put the web tests behind the gate before item 50 closes (F9), and fix the two things that would otherwise ship as the first live defects (F1's open relay and F2's destination check).** Those are the only findings in this report that touch something a stranger can reach on the day you publish.