## R1 — `bank/crank.mjs`

### MEDIUM — Pay/join skip is fail-open on unread assets
**Construct:** `main()` classifies a missing `getMultipleAccountsInfo` result as `'other'`; `planCrank` only skips pay/join when `assets[r.asset] === 'burned'`.

```javascript
assets[r.asset] = !a ? 'other'
  : a.owner.toBase58() === CORE_ID && a.data.length === 1 && a.data[0] === 0 ? 'burned'
  : ...
// later:
if (assets[r.asset] === 'burned') continue  // preJoins, joins, claims
```

**Gain:** Limit 27 is accepted *on chain*. The stated mitigation is that the crank never pays or joins a positively burned vault and retires it first. A null in a 100-account batch (RPC hole, not a real Core tombstone — burned assets still exist as 1-byte accounts) classifies that vault as `'other'`. Then:
- it is **not** retired (`retireBurned` requires `'burned'`);
- a pending vault **is joined** (dead weight);
- an active vault **is claimed** (sats into an account nobody can sign for).

**Evidence if true:** Dry-run `planCrank` with `assets[v] = 'other'` on a burned-but-unretired active vault with `owed >= 1` produces a claim pair; the same vault with `'burned'` does not. On a live pass, logs show `claim batch` for an asset whose Core account is the 1-byte tombstone, with no preceding `retire`.

**Fix:** Fail closed: treat anything other than `'live'` as ineligible for join/claim; retry nulls; only `'burned'` (or confirmed live) proceeds.

---

### MEDIUM — Reveal hash check treats a concurrent honest reveal as a hard stop
**Construct:** `main()` reveal loop.

```javascript
list = await mintedAttributes(conn, P(r.asset))
if (attrsHash(list) !== r.attrs_hash) { failures.push(...); break }
```

Records were fetched with `level === 0`. Capture/reveal also ride on `mint_vault` / `claim` / `activate`. If traffic reveals the head of the queue between the GPA and this send, Core’s Attributes list now includes `level`. That list does **not** hash to the mint-time `attrs_hash` (level was not stored). The crank **does not send**, so it never sees `AlreadyRevealed` (which is BENIGN). It `break`s the FIFO and pages a LIVE failure.

**Evidence if true:** After a `reveal_level` lands, `mintedAttributes` includes `{key:'level',...}` and `attrsHash(list) !== record.attrs_hash`. A LIVE `--reveal-only` pass overlapping ordinary traffic logs `reveal <asset>: attributes read off the asset do not hash to the stored attrs_hash` without a `skip ... AlreadyRevealed`.

**Fix:** Drop program-owned keys (`level`, `charter` already in the mint hash, `redemption`) before hashing, or if `level` is present skip send as already revealed; do not `break` the lane on a hash mismatch until a send has been refused.

---

### LOW — `BENIGN` is one-sided for distribute races
**Construct:** `BENIGN = /RevealTooEarly|AlreadyCaptured|AlreadyRevealed|RevealOutOfOrder|RescheduleTooEarly|MonthNotElapsed/`

Traffic can empty the pool (`NothingToDistribute`), join the last waiter (`JoinWaitingFirst` / `NoActiveVaults`), or expire the last boost (`BoostsExpireFirst`) between plan and send. Those are the same “already done / not yet” class as `MonthNotElapsed`, but they FAIL and SMS.

**Evidence if true:** Crank log `FAIL distribute` with `NothingToDistribute` immediately after another tx’s `CBOB_DISTRIBUTED`, with `exitCode = 1`.

**Fix:** Add those program errors to `BENIGN` (or only page if they persist a second pass).

---

Header vs F8 repair: the file still says the crank **refuses** above 0.25 SOL; `judgeFeePayer` now returns `{ ok: true, warn }`. SPEC and `cron-install.sh` still say “refused”. Ops that send 0.25 SOL thinking they halted a stolen crank key do not halt it. Doc/ops mismatch from the round-22 repair, not a theft path.

---

## R2 — `bank/detectors.mjs` / `bank/alarm.mjs`

### MEDIUM — Wrong `$CBOB` mint is a quiet baseline, not a standing CRITICAL
**Construct:** `detectStandingRisks` `opts.production` `want` list pins `max_boost_weight` / `max_boost_epochs` but **not** `mint.cbob_mint`. `detectConfigDrift` only fires on a *change*. First alarm pass after `initialize` adopts whatever is on chain.

`initialize` only checks: classic SPL, initialized, not `payment_mint`, not `$GARY`. A mint **with a live mint authority** is legal forever. Boosts burn that mint; printed tokens buy extra pool weight.

**Gain:** Operator paste error at launch (item 51: create mint, then pin address) → permanent wrong `cbob_mint`. Alarm never says `test_value_in_production`. Holders who can mint `$CBOB` mint boosts and take a larger share of the 85%.

**Evidence if true:** Snapshot with `mint.cbob_mint` ≠ the mint in `launch/cbob-token.mainnet.json` (or a mint whose `getMint().mintAuthority !== null`) produces **no** standing finding; only a later *change* would drift.

**Fix:** Pin the launched mint once it exists (same pattern as `CBBTC_MINT`). Until then, production should CRITICAL if `cbob_mint` is default/unset. `check-launch-params` must RPC-check `mintAuthority === null` and `freezeAuthority === null` (see R4b).

---

### LOW — “Every v6 detector is wired” does not include the round-22 detectors
**Construct:** `bank/selftest.mjs` `V6_WIRED` vs `alarm.mjs` `main()`.

Alarm calls `D.detectRevealStall`, `D.detectUnsplitRevenue`, `D.detectFrozenVaultAccount`. None are in `V6_WIRED`. Deleting those calls leaves the selftest green. That is the wired-to-nothing class this gate exists to catch, reopened on the round-22 additions.

**Evidence if true:** Remove `D.detectRevealStall(` from `alarm.mjs`; `node bank/selftest.mjs` still passes the “alarm.mjs calls every v6 detector” arm.

**Fix:** Put every `D.detect*` used for liveness in that list (or generate the list from `detectors.mjs` exports minus helpers).

Routine paging: `joins_waiting` INFO every pass while the crank is one cycle behind a distribution is expected. `lock_deadline_unset` CRITICAL every pass while `lock_deadline` is still OPEN and programs are deployed is the A5 repair working; noisy before the json is filled, not a false quiet.

A1 (inner `BurnV1` under `burn_vault`) looks correctly skipped when `parent` matches a top-level `burn_vault` for the same asset. A3 idle cap looks fixed (`remaining >= cap` → quiet).

---

## R3 — `bank/layout.mjs`

No new layout slip found in the declared structs vs the MINT `pub struct` in this bundle. Round-22 L1 (parser throws on non-`pub` lines), L2 (every scraped `OFF_*` compared), L3 (weights / `ACC_SCALE` / reveal window), L4 (`[i64; 64]` round-trip) are real checks, not tautologies.

SPEC still says MINT config v5 / VaultRecord v3 / GOV v3; the code is MINT v6 / VaultRecord v4 / GOV v4. That will make the next reader distrust the offset table. Fix SPEC, not the decoder.

---

## R4 — `bank/accrual.mjs` vs MINT

`credit`, `ceilSats` / `ceil_sats`, `available`, `pendingScaled` / `owed_of`, `reweigh` match the Rust (including carry-before-debt). Crank’s special cases:
- pre-join: `debt = W * old_acc`, then share of `acc - old_acc` at level weight — matches `join` then `credit`;
- pre-expire: `pendingScaled` at old acc with boost, then level weight only on the delta — matches `expire_boost` then `credit`.

No divergence found on the formulas that move sats.

---

## R4b — Boost off-chain + `launch/create-cbob-token.mjs`

Crank: `preExpires` before `distribute`, `postExpires` when `boost_end_epoch === dist_epoch + 1`, burned/retiring records excluded. Alarm: `boosts_stalled` in `detectDistributionOverdue`; `mint.cbob_mint` / `max_boost_weight` / `max_boost_epochs` are CRITICAL drift keys.

### MEDIUM — `create-cbob-token.mjs` is atomic; the launch gate does not prove it
**Construct:** `create-cbob-token.mjs` `main()` — one tx: `createAccount` + `initializeMint2(..., freeze = null)` + ATA + `mintTo(SUPPLY)` + metadata + `setAuthority(MintTokens, null)`, then `getMint` asserts `mintAuthority === null`, `freezeAuthority === null`, `supply === SUPPLY`, release ATA holds it.

That part holds: a landed tx cannot leave a live mint authority, a freeze authority, or a partial supply (failure reverts the whole tx; a second run dies on “already exists”).

**Gap:** `scripts/check-launch-params.mjs` `judgeLaunch` only checks `cbob_mint` is a 32-byte key and not cbBTC / `$GARY` / a reserve. It never reads the mint. `mainnet-init.json` `cbob_mint` is OPEN and filled by hand.

**Gain:** Same as R2 — wrong mint pinned at `initialize` is permanent.

**Evidence if true:** `judgeLaunch` with a valid-looking pubkey that is USDC (or any classic SPL with mint authority) returns no `cbob_mint` error once OPEN fields are filled.

**Fix:** After create, write the mint into `mainnet-init.json` from `launch/cbob-token.mainnet.json`. `judgeLaunch` (or a chained RPC step) must require that file’s `verified: true` and on-chain `mintAuthority` / `freezeAuthority` none, supply 2_100_000_000e6.

---

## R5 — `bank/revenue.mjs`

Worst case remains accepted limit 10: on-chain `max_sweep_lamports` × cooldown windows until the guardian stops, not the script’s 50 SOL constant. Compromised operator still sweeps without this file.

`cycleIsOpen` still requires a split (`splitSig` or `splitByOther`), not a return. `sendRejected` is closed. Empty revenue ATA recovers a crash after split (S6). Post-sweep floor is `otherAmountThreshold` (S4). Destinations are config PDAs / ATAs.

No new path that sends value where the program does not pin. Do not treat Jupiter `/swap` bytes as untrusted-beyond-the-stated-hop; that is limit 10 / S2.

---

## R6 — gates

Floors are equality (`R.length !== FLOOR`, `run-tests.sh` `floor()` `-eq`). Empty `detectVaultSetChange(null)` is an intentional first-pass quiet, tested both ways.

Real hole: **V6_WIRED** (R2 LOW). That is the assertion that cannot see the failure it claims to prevent.

`judgeLaunch` early-returns on any OPEN field, so the rest of the launch assertions do not run against the committed file until those three are filled — by design, not a vacuous pass of the selftest (the selftest fills them).

---

## Accepted limits — four questions

1. **Worse than stated?**  
   **27.** The program still pays/joins a burned vault. The write-up says the crank never does and retires first. R1 fail-open on `'other'` makes that mitigation weaker than the limit text.  
   **F8/7 interaction:** over-ceiling no longer stops the crank (correct vs griefing); docs still claim it does.

2. **Listed as a limit but closed?**  
   Not closed. **38** is partly stale: `swap_operator`, `max_sweep_lamports`, `sweep_cooldown_secs`, `sol_reserve_lamports` are RULED in `launch/mainnet-init.json`; the OPEN paragraph still calls the operator OPEN and the sweep bounds PROPOSED. Remaining OPEN (charter date, `lock_deadline`, `cbob_mint`) is real.

3. **DISCHARGED but not?**  
   12/17, 14, 19, 30, 31, 33 and the Bank-family items match this tree. No revival found.

4. **OPEN AND BLOCKING treated as accepted?**  
   **22, 50, 52** still open in substance (no live distribution, no redeem page, pool ATA is a road step). **51** is built on chain but launch-open on the mint address — and the verification gap above is being treated as “create script exists,” which is not the same as the pin being checked. **38** must not be marked accepted while those three json fields are OPEN.

---

## Else

SPEC control table / crank header / `cron-install.sh` still say the crank **refuses** above 0.25 SOL. Round-22 F8 changed that. Same class as “repair not applied at every site of its shape” — here, every *sentence* of its shape.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

AI will not: land the crank against 2,100 real vaults (item **22**), watch Helius return a null in the middle of `getMultipleAccountsInfo`, overlap `--reveal-only --live` with a holder `reveal_level`, or operate `create-cbob-token.mjs --cluster mainnet --execute` and then prove `initialize` was given *that* mint.

Do these before removing upgrade authority, in order:

1. **Mainnet dress rehearsal (22)** at throwaway ids with the rehearsal worktree: crank `--live` for hours, kill RPC mid-batch, confirm no claim/join of a burned vault and no reveal-lane SMS storm. That is the only measurement of R1.
2. **Create `$CBOB` on mainnet, then make the pin mechanical:** `cbob-token.mainnet.json` `verified: true` is an input to `check-launch-params`; refuse `initialize` until `getMint` shows no mint/freeze authority and the json address equals `mainnet-init.json`. Do not paste a pubkey by hand.
3. **Fill the three OPEN launch fields** and run `check-launch-params` on the real file (not the selftest clone) until it prints launchable.
4. **Build the redeem preflight (50)** or strike the holder-guide promise. After lock, undeclared nested assets are destroyed with no Bank to refuse.
5. **Fund revenue rent and create pool + Squads cbBTC ATAs (52)** in the same session as `initialize`, then *one* `split_revenue` of dust before any sale.
6. **Convert every finding in this round that can be unit-tested** (fail-open `'other'`, reveal hash with a `level` attribute, `V6_WIRED` missing names, `judgeLaunch` accepting a mint-authority mint) into selftest arms that fail both ways — the same rule SPEC already imposes on rejected claims.