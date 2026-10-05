## R0. ROUND-24 REPAIRS — checked at every site

**R0-1 [LOW] C3 comment still false: “six CPIs”.**
`programs/cbob-vault-gov/src/lib.rs:196-198` still says “an every-kind execute is six CPIs”.
A guardian change and an operator arm can never share a proposal (`KeyChangesBundled`, `create_proposal`), so the max is five CPIs: `SetRound(1)+Brakes(max 2: arm+restart)+Tighten(1)+SetBoost(1)=5`, or with an operator instead of a guardian `1+1+1+1+1=5`.
E.7 executes five kinds with `Brakes{sales:true}` = 1 call = 5 CPIs total, not six.
*If true:* `grep -n six.*CPI programs/cbob-vault-gov/src/lib.rs` prints it; `E.7` log shows 5 actions landing.
*Fix:* change comment to “five CPIs” with the E.7 arm id. Do not touch logic.

**R0-2 [LOW] C8 weak arms remain.**
- `P.11a` still passes vacuously when `picks.length<5` — `wantLevel.join(' ')==''` and `perLevel.join(' ')==''`. The suite log will show `⚠️ a level had no live…` but `ok`.
- `5.2` title “mint a vault owned by a PDA that can never sign” is still pinned to `AccountNotSigner` with `isSigner:false`. A PDA passed as CPI signer has `is_signer=true`; that shape is untested. SPEC itself admits this.
- `X.7` still plans against an empty queue (`revealed_total==minted_total`) so ordering cannot fail.
- `3.7` pinned to `0x9` shared with `R.6`.
*If true:* run suite with census exhausted and observe `P.11a` with 0 picks still `ok`; read `tests/3prog.test.ts:5.2`.
*Fix:* fail `P.11a` if `<5` picks; add PDA-as-CPI-signer mint arm; keep `X.7` labelled as vacuous.

**R0-3 [INFO] C1/C2/C4/C5/C6/3.1y fixed at the named site.**
`BO.30` weight-down refused, `BO.30a` favourable price-down lands at new price, `BO.31` epochs-down refused, `BO.32` duplicate `[D,D]` pays once, `BO.33/33a` old-owner `BoostNotTheOwner`/new-owner ALLOW, `BO.34-34c` wrap bought at `epoch%64>=55` through `boost_vault`’s inline `end%64`, `E.7/E.7a` five kinds executed, `S7b.*` boost under 16-vote quorum, `10.6` asserts `wide.cu>=base+4*100_000`, `3.1y` pins `acctDisc('Config')`. No breakage seen next to them.

**R0-4 [LOW] A1/A6 line-shift.**
`MINT` added a line, so every `require!/err!` `line!()` below it moved and `MINT` bytes changed. Nothing in `tests/`, `sim/`, `scripts/build-mainnet.sh` pins a source line. `scripts/build-mainnet.sh` proves bytes by behaviour + `sha256`, not by line. The risk is off-tree: alarm program-hash baselines for `MINT` pinned to round-24 bytes will now page. *If true:* alarm `prog.mint.hash` baseline != `dist/SHA256SUMS`. *Fix:* re-pin baselines at release commit; never pin `line!()`.

**R0-5 [HIGH/DOC] Holder-guide rewrites incomplete — every sentence is not true.**
Still false today because item 50 is still OPEN:
- “Everything comes out” / “Opening is all or nothing. Everything comes out” — undeclared airdrops / nested vaults are **destroyed** (9.5/9.6/9.9). The honest list says send only three, but the opening promise says everything comes out.
- “The redeem page offers this and does the steps for you”, “On the redeem page that cannot block the opening. The page will first set up…”, “Only open your vault on the Bank’s redeem page”, “Every opening is public. It is announced on X…” — `judgeRedemptionCoverage` has no page, `bank/redemption-poster.mjs` has no sender, crank installed `DRY-RUN`. Promising a page/poster/job that does not run is false.
- “Every sale, and the 10% royalty…flows into the Bank”, “At launch the Bank holds all $CBOB”, “Bank’s pages/pool/website” — Bank deleted; money lives in `["revenue"]`/pool, $CBOB in release wallet `AT2qf412…`.
*If true:* try to open the redeem page / find a sent X post / run crank live — none exists.
*Fix:* gate guide on item 50; change “Everything comes out” to “Everything declared comes out; anything else is destroyed”.

## R1. CUSTODY

No theft / unseal found in pairing. `open_for_redemption` forward walk + `burn_vault` backward walk both bind asset at 0 and owner at 2, top-level only via `load_instruction_at_checked`, fail-closed. `WR.1/WR.2/WR.3` refuse wrapper shapes, `WR.4` vault stays live. Emptiness proof checks PDA lamports 0, both ATA derivations per reserve, owner==PDA, no delegate/close, `len==165`, amount 0, no live Core asset declared.

## R1s. SWEEP HELPER — never audited before

**R1s-1 [HIGH] A stranger can brick any redemption forever with a Token-2022 ATA the helper cannot remove.**
`programs/cbob-vault-burn/src/lib.rs:burn_vault` reserve loop:
```
expected_T22 = PDA([pda, TOKEN_2022, mint])
if owner!=SPL && owner!=T22 {continue}
if len<165 {continue}
require!(len==165, ReserveHasExtensions)
```
A classic-mint T22 ATA is 170 bytes (`ImmutableOwner`). Anyone can `createAssociatedTokenAccountIdempotent` for `(vault-PDA, T22, cbBTC)` permissionlessly, paying rent they abandon.
Once it exists:
- `burn_vault` finds it, `len=170 !=165` → `ReserveHasExtensions`, redemption refuses.
- `programs/cbob-vault-sweep/src/lib.rs:read_token` refuses it: `if owner!=SPL_TOKEN_ID → IllegalOwner`. Helper cannot transfer or close it.
- Classic missing-ATA path (`continue` when unowned) does not apply; T22 ATA is owned by T22.
SPEC “REDEEMING step 1” only creates classic reserve accounts in a prior tx. No step closes T22 ATAs in the same redemption. Owner could close via separate Core `Execute` in the same tx, but page does not build it.
*If true:* create T22 ATA for a vault PDA, fund 0, attempt helper redemption — `ReserveHasExtensions`; direct helper call with that pair — `IllegalOwner`; suite has zero such arms.
*Gain:* permanent DoS for ~0.002 SOL rent per vault; repeatable across all vaults; immutable code cannot add T22 handling later.
*Fix (before lock):* either (a) extend helper to close T22 reserve ATAs (empty check + `CloseAccount` via T22 program), and page declares + closes both derivations in the same redemption, or (b) make `burn_vault` skip an empty T22 ATA only if proven empty including extensions — not safe with confidential balances, so (a) + page obligation in item 50. Add suite arms: create T22 ATA with 0 and with dust, show redemption through helper lands.

**(a) Only owner reaches it while frozen — holds, with Core as the gate.**
Direct call needs `signer.is_signer`; signer is asset-signer PDA only Core signs for. Core `ExecuteV1` on a `PermanentFreezeExecute`-frozen asset refuses (`0x9`, suite 3.7/S6.2). Thaw exists only inside a tx with owner-signed `open_for_redemption` + `burn_vault`. Plugin authority (`["seal"]`) cannot `Execute`. No check in helper needed, but helper does not check frozen itself — safe only because Core does.

**(b) Pair list.**
- Zero pairs (`len==4`) allowed: only lamport sweep. Harmless.
- Same source twice: first `CloseAccount` drains lamports and reassigns owner to System; second `read_token` → `IllegalOwner`, whole sweep reverts. Owner footgun, not theft; page must not duplicate.
- Source==destination impossible without `signer==dest` which is refused.
- Destination twice with different sources same mint: allowed, correct.
- Native wSOL source: classic layout, helper handles; BURN treats as undeclared unless reserve — destroyed if undeclared, correct.
- Source with delegate/close-authority/frozen: `Transfer`/`CloseAccount` fail, redemption blocks. Stranger cannot set these (needs PDA signature via `Execute`, which needs thaw + owner). Frozen destination (Coinbase) fails transfer — owner picks another ATA.
- Destination not ATA: allowed if `owner==dest && mint==src_mint`. Safe — dest chosen by owner who signs `Execute`.
- Dest == vault signer refused; dest == another vault’s signer allowed but chosen by owner — self-harm only.

**(c) Destination not compared to asset owner — safe given (a).**
Dest is inside owner-signed `Execute`. No other party can choose it in a thawed tx. Lamport `transfer(signer.lamports())` to non-existent dest creates it; below-rent dest creates below-rent account but `lamports==0` still passes. To non-system account (token/Core) `system_instruction::transfer` fails → redemption reverts. Owner will not do this; no attacker can force it.

**(d) Lamport sweep.**
Reads `signer.lamports()` at execution, `transfer` all. After it, `burn_vault` sees `0`. Nothing in `burn_vault` deposits to signer; Core `BurnV1` sends asset rent to payer, not signer. Attacker cannot insert an instruction after sweep inside owner’s signed tx. Prior deposits swept live. Holds.

**(e) Closed vs missing vs stranger-created — see R1s-1 for T22.**
Classic closed: `owner==System` → `continue`, passes for right reason (nothing to check). Classic missing: `owner==System` → `continue`, passes. Classic stranger-created with dust after prior tx but before redemption: prior tx per SPEC + live-balance sweep covers it. T22: not covered — HIGH above.

**(f) [HIGH] Fit measured for the wrong shape, without what a real page adds.**
`9.14/9.14a/9.14c` build redemptions with owner’s own `Transfer+Close+lamport` `Execute`s, not the helper-via-`Execute`. Shipped shape is `open + claim + Execute(helper) + burn`. Only `S8.0` in `sim/test-vault.ts` measures helper shape, and it excludes compute-budget ixs, excludes crank (`MAX_CRANK 4`), excludes fourth reserve (none, but pool account already counted). Real page per item 50/54 must set compute limit when carrying crank; two CU ixs + crank accounts can push `S8.0`’s `B` over 1232. CU of helper redemption never measured (suite 10.x only mint/capture/claim).
*If true:* serialize `S8.0` redIxs + 2 CU ixs + 4-crank accounts — exceeds 1232 or exceeds 200k default; `cargo` CU unknown.
*Fix:* add suite arms `sizeForHelper(n)` mirroring 9.14 but with helper, with claim, with CU ixs, with crank 0/4; assert `fits==3` and record CU via `simulateTransaction`/landed `computeUnitsConsumed`. Update SPEC “Known limits” 1153-byte table — it is stale for shipped shape.

**(g) Evidence.**
`SR.1` direct (no PDA sig) → `MissingRequiredSignature`; `SR.2` wrong-wallet dest → `CBOB_SWEEP refused: destination`; `SR.3` stale exact-amount after 1-sat dust → Token `0xb`; `SR.4/4a` helper lands with dust + 1M lamports. No arm names T22 ATA, duplicate source, frozen dest, non-system dest, zero-pair. Helper bytes proven identical mainnet==localnet by `build-mainnet.sh:cmp` — holds (no `localnet` feature).

## R2. POOL — “holds at least ceil(owed)” holds; liveness holds

`credit`: `delta=floor(avail*SCALE/w)`, `owed+=delta*w <=avail*SCALE`. `claim`: `owed-=pay*SCALE`, `bal-=pay`. `retire` redeemed (dust `<SCALE`): `owed-=dust`. `retire` forfeit/bare: `owed-=pending`, `bal` unchanged → over-collateralized. `P.32` asserts. Counters: `pending_count/pending_this_epoch/active_count/total_active_weight` correct across `activate×2`, `join` via `claim`, `retire` waiting vs active (F21 arms). `JoinWaitingFirst` + `BoostsExpireFirst` gates checked before $GARY burn. `monthly_inline` never refuses host for early/empty/waiting/due-boost; wrong pool refused. No distribution-block by boosting (expiry needs only records via `expire_boosts`) or by missing ATA (join needs no funds; expiry needs no ATA).

## R2b. BOOST — exact N, carry preserved, ring agrees

`reweigh` moves `owed→carry`, restarts `debt=newW*acc`, `total+=after-before`, `owed_scaled` unchanged. `expire_boost` only at `dist_epoch>=end` at that `acc`. `unschedule_boost` decrements `due` if due else `ring[end%64]`. `retire` unschedules if `boost_weight>0`. No double-expire (weight 0 guard, `end=0`). `books()` (`w==total`, `bw==boost_total`, `n==active`, `ring+due==active`, `bal>=owedCeil`) holds in `BO.9a/14a/17b/29a/34c`. Ring wrap `BO.34` bought at `epoch%64>=55` with `BE=10`, due exactly at `end`, books balance. Max `63<64` so live ends span <64, no silent collision past 64. `BoostNotTheOwner` reads Core owner bytes at execution; sold vault boosts only for new owner (`BO.33a`).

## R3. DRAW

`blockhash_in_window` pins sysvar id, bounds `n<=512`, buffer length, refuses zero hash. `try_capture` deterministic `A=minProduced[reveal,reveal+64]`, `B/C=minProduced[(prev/4+2)*4,…+64]`, `entropy=sha256(hA||hB||hC||asset)`, FIFO `revealed_total`, burned vault still draws without Core write (`L.11`), attrs hash-checked. Leader-C choice among many, cohort sharing same `reveal_slot` — correctly stated in SPEC 26 / guide honest list after round-24 fix. No worse found.

## R4. GOV

Snapshot `quorum_supply=minted-burned-bare`, `index_snapshot=minted_total`, `VaultTooNew`, quorum ceil + non-zero, threshold, 10% turnout, half-of-all for key changes, `KeyChangesBundled`, tighten one-way + bounds, `CBOB_ACTION_SKIPPED` per-kind ordering, 7-day execute window. No minority carry, no money reach (split/dests/supply/royalty/reserves unreachable), no forever-freeze beyond accepted 45 (open round can mint one until 2100).

## R5. CHARTER

Address-pinned Merkle (domain-separated, sorted), live-asset + owner + collection checks, CPI-burn same ix, window clock-only, `pob_extra<=8` non-signers. Hot-wallet end/capture fully stated in SPEC 46 + guide honest list. Collection-only alarm gap (individual PoB plugin not paged) disclosed. Moving PoB out == rejecting hook disclosed. Complete.

## R6. INIT + TRUSTED HOP + ROYALTY + CAP

- SEAL `assert_classic_spl` checks owner only, not mint-ness/duplicates/collection — ruled control is `check-launch-params.mjs`, programs fail closed via `WiringDiverged` before mint. Duplicate reserves wasteful but not bricking. Documented in A6/38.
- Swap operator worst case = `cap × windows until guardian stops`, bounded by revenue-above-reserve — correctly stated.
- Royalty `authority None`, sole creator revenue 100%, `R.6/6a` Core refuses rewrite/remove (`0x9`), no other writer. Holds.
- Cap ring `k=min(ceil(live*210/10000),64)`, `now-kth>=window` — exactly rolling window; >3047 stricter never looser. `redeem_window_secs` 10–86400, mainnet must 3600.

## R7. RAW READS — recomputed, correct

`MintConfig` offsets 41/141/454 etc. match struct order; `VaultRecord` 9/41; `BurnConfig` 42; `SealConfig` 9/41; sweep token `0/32/64/165`; spaces `MintConfig` 1005+pad, `VaultRecord` 221, `BurnConfig` 571+pad. Discriminators pinned in suite `3.1a-3.1y/E.7a/BO.29`.

## R8. SUITE/SIM/BUILD AS EVIDENCE

- `9.14` family does not exercise shipped helper shape — see R1s-1(f) HIGH.
- `10.6b` now binds page rule to number; `10.6` binds four-capture cost.
- `ID.1` uniqueness guard holds.
- `build-mainnet.sh` proves 4× `NotTheInitAuthority` behaviour both directions + sweep byte-identity + source key + clean tree + 5 artifacts. Holds.
- No arm for T22 ATA grief, helper duplicate/zero-pair/frozen-dest, helper CU, helper+CU+crank packet.

## ACCEPTED LIMITS — four questions

1. **Worse than stated?** Yes: **42** is worse — prior tx creating classic ATAs insufficient once T22 ATA exists; needs T22 close in same redemption. **“Known limits” packet table** worse — 1153 B is pre-helper shape, not shipped shape.
2. **Not actually a limit / already closed?** None closed without code change. 54’s binary-search option recorded, not taken — still a limit.
3. **Discharged not discharged?** 51 boost-timing disclosed and measured; 54 measured but page rule still binds item 50 — correctly left as obligation of 50.
4. **OPEN treated as accepted?** Yes: **50** — guide promises redeem page coverage, join+payout offer, live sweep, X/website posts; none built (`judgeRedemptionCoverage` pure fn, poster drafts only, crank dry-run). Ship must not treat guide sentences as done.

## ELSE

None beyond above; cross-program offsets, supply checks, `is_burned` tombstone, `is_on_curve` panic, rent-stricter constant all as stated.

---

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS AND PROGRAMS WILL BE IMMUTABLE, what AI audit structurally cannot do before launch

1. **Run the shipped redemption shape on a live cluster.** Fund 3-asset activated vaults, create dests prior, send `claim+open+Execute(helper)+burn` with CU ixs + crank 0/4 through real Orca/Meteora/Pyth-adjacent load, measure bytes + CU landed, not simulated. Gate release on `fits==3` with helper.
2. **Grief it on purpose on a fork.** Create T22 ATAs for live vaults, dust classic ATAs between read and send, freeze pool/vault/dest, hold guardian key and re-stop. Prove each redemption still lands or forfeits per spec, with logs `CBOB_REDEEMED_POOL_FROZEN` / `CBOB_ACTION_SKIPPED`.
3. **Ceremony the four `initialize`s from `launch/mainnet-init.json` only.** Air-gapped build of txs from JSON, two-person check of `pob_root` recompute, `reserve_mints` exact three, `redeem_window 3600`, `monthly 2592000`, `notice 604800`, `min_voting 259200`, sweep bounds, census sum ≤2100, then verify on chain before funding revenue/pool/Squads ATAs + rent.
4. **Build item 50 outside `programs/bank/scripts` or before freeze, then freeze.** Redeem page that creates missing classic ATAs prior, declares both derivations, closes T22 ATAs same tx via `Execute`, sweeps via helper, closes emptied accounts, sets CU limit, runs `judgeRedemptionCoverage` pre-sign, drops `claim` when pool frozen; poster sender + website surface; crank live with heartbeat. Freeze counter resets on any change — do page first.
5. **Re-pin everything derived from bytes.** Alarm `prog.*.hash`, `test_value_in_production` lists, rehearsal `d57ee3a` proof stale — re-run full `run-tests.sh` + `swap-fork.sh` + sim at release commit with `CBOB_SHIP_GATE=1` (no skipped probe/fork), record `REHEARSAL-RECORD.txt` with `rehearsal-init.json`.
6. **Move $CBOB release custody off this box.** `bank/keys/cbob-release.json` holds 2.1B $CBOB; any reader boosts up to +12 for 24 distributions. Move to Gary Squads/multisig, delete box key, rotate backups. Same for swap-operator float discipline (`OPERATOR_FLOOR` top-up by hand, wallet holds cycle funds only).
