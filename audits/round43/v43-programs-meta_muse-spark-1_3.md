# v6 final-tree confirmation — programs + sweep + web/

Scope: the whole tree as bundled. `programs/` unchanged since round-39 (`git diff 21f36e1..4a67d00 -- programs` empty, re-asserted by `run-tests.sh` C10 pin to `RELEASE_COMMIT 0b3ddb3`). This is therefore a repair-confirmation for round-42's two INFOs plus a second independent pass over `web/`.

Verdict used: round-42 programs `NOT CLEAN; QUORUM MET`, 2 INFO, none in the five programs. Off-chain round-42 also `NOT CLEAN`. Launch gate is SPEC gate 3 / Gary 2026-10-08: blocks on (a) any finding in the five programs, (b) any value path, (c) anything stopping a crack, (d) any HIGH/MEDIUM anywhere.

## R0. Round-42 verdict and repairs

### V42-1 — `staticFile` `URIError` kills `ceremony-local.mjs` — REPAIRED, holds
Construct: `web/deploy/ceremony-local.mjs:30` `decodeURIComponent` unguarded, called synchronously from the listener `:43-50`.

Repair in this tree:
```js
try { p = decodeURIComponent(...) } catch { return null } // 404
export function localListener(root,rpc){
  return (req,res)=>{ try{ ... }catch{ 500 } }
}
```
`proxy.test.mjs` V42-1 arms (per VALIDATION) drive the real listener: `/x/` 200, `/%E0`,`/%` 404, `/x/` 200 again. No new path throws synchronously: `staticFile` is the only `decodeURIComponent` in `web/deploy/`, `localListener` wraps the whole body. The `X-Real-IP` half of the original claim remains disproved: local mode binds 127.0.0.1 by construction, tunnel only.

No regression: normal files still served, `..` escapes still `null`, `/rpc` still delegated.

### V42-2 — `collectionCreator` judged only the oldest tx — REPAIRED, holds
Construct was `web/src/lib/ceremony-reads.mjs:79-101` returning `other` on a failed or non-create oldest transaction.

Repair in this tree: iterate oldest-first, skip `s.err` and `meta.err`, take the oldest **successful** `CreateCollectionV2` for exactly this address; if none in a complete history return `unverifiable`, never `other`; bound 25 successful fetches (`CREATOR_FETCH_MAX`). `resolveCollection` adopts a sole `launch`, ignores decoys, lists `unverifiable` with the round-39 B4 "pin it" warning and still offers step 0.

Checked: control launch-only → `launch`; stranger failed transfer first → `launch`; stranger successful transfer first → `launch`; stranger-only transfers → `unverifiable`; stranger create of D → `other`; padded history → `unverifiable`; complete history with no create → `unverifiable`. The two old arms expecting `other` were correctly updated to the honest `unverifiable` — a candidate that exists must have been created somewhere unreadable.

E2E still proves it on a real chain (creator check line in the canonical log).

### Round-42 required measurements C12/C8/C13 — present
- R42.C12a `mint_vault` pre-funded, C12b `claim_charter_vault` pre-funded (PoB **not** burned), C12c collection pre-funded, each pinned to System `0x0`; C12d fresh address lands. New accepted limit 59 states it.
- R42.C8 claim-path duplicate attributes → `DuplicateAttribute`.
- R42.C13 full worst shape inline capture+reveal, no compute-budget ix, units recorded (182,355 CU in validation).
- C7 `planDraw` with `null` Attributes body → `unknown`, not throw.
- C10 source-equals-`RELEASE_COMMIT` gate in `run-tests.sh`; C26 `WEB_FLOOR`/e2e floors; C14 Cloudflare dependency named in `nginx-rpc.conf`.

No re-file: every disproved claim in the round-42 table (C3 proxy legacy, C4 `staticAccountKeys`, C10 truncation hardening, C14 real-IP, C15 10.6a/b, C16 guide-vs-limit-32, C17 `readStep` throw, C18 `readVault` dust, C19 packet wording, C20 dust predicates, C22 Clock offset, C23 rent wording, C24 frozen-zero) was re-checked against this tree and remains disproved for the reason given. No surviving defect shown.

## R1. Custody — no theft, no surviving emptied vault

SEAL `open_for_redemption` requires a later top-level `burn_vault` for same asset **and** owner (`BURN_IX_ASSET_IDX 0`, `BURN_IX_OWNER_IDX 2` match `BurnVault` 0:`vault_asset`, 2:`owner`); BURN requires an earlier top-level `open_for_redemption` for same pair (`SEAL_IX_*` 0/2 match `OpenForRedemption` 0/2). Discriminators asserted against `sha256("global:…")` in-suite (3.1a/b/q/r). `load_instruction_at_checked` sees top-level only in both directions.

CPI wrappers: wrapped open reports outer index, needs a top-level burn after it which BURN then cannot pair (its scan sees only top-level opens); wrapped burn is invisible to SEAL. Suite WR.1 `NotFromBurn`, WR.2 `NoTerminalBurn`, WR.3 `NoPrecedingOpen`, WR.4 vault live+funded — correct errors, correct final state.

Emptiness: `asset_signer.lamports()==0`, `declared==remaining.len`, every reserve ATA under **both** token programs declared, PDA-owned, `d[72..76]==0`, `d[121..129]==0`, `d[129..133]==0`, `len==165`, `amount==0`; declared Core accounts refused if `AssetV1`; undeclared PDA-owned non-reserve checked the same three delegate/close/len gates if declared. Skipped only if owner is neither Token program (closed/missing → holds nothing) — the right reason. Token-2022 extensions refused by length, deliberately (confidential amount reads zero). Lamport grief (9.10/9.11) must be swept in the same tx or the burn reverts — fail-closed.

No path leaves a thawed vault alive: thaw reverts with a failed burn; burn cannot succeed without thaw; partial sweep reverts `VaultNotEmpty` with funds intact (3.11/3.11a).

## R1s. Sweep helper — holds on (a)–(g)

(a) Direct call needs `signer.is_signer`; vault wallet signer is Core's PDA which only Core signs for via `ExecuteV1`, which the pinned binary approves only for `owner` (SR.5/5a `0x1a`, SR.5b collection authority is MINT's off-curve PDA, SR.5c control UA refused, SR.5d owner lands, SR.5e balances/seal/owner preserved). No update-authority, delegate, `PermanentFreezeExecute` PDA or collection route approves Execute. Frozen vault refuses Execute, so helper unreachable outside a genuine thaw.

(b) Pair table verified: odd count `NotEnoughAccountKeys`; wrong Token/System `IncorrectProgramId`; `signer==dest` `InvalidArgument`; foreign source `IllegalOwner`; wrong-mint/wrong-wallet dest `InvalidAccountData`; duplicate source closes then second read fails `Provided owner is not allowed` (SR.12a, SR.12b pins it reached the second, closed source); source==dest implies `signer==dest` → refused; wSOL/native transferred then closed (R33.G4); delegate/close-kept source reverts whole call (R36.C5) — page uses plain `Transfer` instead; frozen source with balance reverts (SR.14), frozen zero closes (round-30 measurement); non-ATA classic accepted, Token-2022 refused by owner/len; dest need not be ATA, only same-mint owned by the one wallet; dest==own signer refused; dest==other vault's signer is owner's own choice (only owner can invoke). Zero pairs = lamports-only sweep (SR.13).

(c) Dest chosen by builder is safe given (a). Lamport credit below rent to a fresh address refused by runtime (R41.C8a-c); canonical dest is the fee-paying owner who exists. Credit to a token-owned account succeeds without touching its data (R27.S1) — no block.

(d) `signer.lamports()` read at execution, System-transferred to dest. Nothing after it in the redemption adds to the signer (burn returns asset rent to payer, `retire_redeemed` moves no lamports). An inserted deposit between sweep and burn makes `lamports==0` fail-closed; after burn the vault is gone. BURN's check sees exactly what the sweep left.

(e) Closed reserve passes because a closed account is no longer Token-owned → skipped, which is correct (holds nothing). Missing reserve cannot be named (helper refuses non-token) — page creates all three vault reserves plus owner ATAs in the **prior** tx (item 42). No stranger-creatable account escapes both: T22 ATA for a classic mint refused `IncorrectProgramId` (probe); non-ATA classic owned by PDA sweepable if named, otherwise undeclared-destroyed with consent (not a block); T22 non-ATA unsweepable but undeclared-destroyed, never a block (page never declares it); foreign nested NFT listed by `coreAssetsOwnedBy` and boxed, CBOB vault rescued (item 58).

(f) S8.0 claim+open+3-reserve helper+burn 1,061 B owner-payer, no compute ixs; +52 both compute-budget +96 separate payer ≈1,209/1,232. No fourth reserve (`MAX 3`). In-line month needs only the pool already carried. S8.1a 168,343 CU < 4×200k default. Not an upper bound for arbitrary extra pairs — stated as such.

(g) SR.0–SR.4a, S8.* all non-vacuous; `because()` pins match measured errors (SR.3 `0xb`, SR.11 owner text + `Provided owner…`, SR.12 dest text + `invalid account data`, SR.14 Token `0x11` + helper `0x11`). Helper bytes proven identical `dist/` == `target/deploy/` == `$CACHE/ln/…` (`build-mainnet.sh` `cmp`).

## R2. Pool — `pool ≥ ceil(owed)` holds; counters agree; liveness holds

`credit`: `delta=floor(avail·SCALE/w)`, `owed+=delta·w ≤ avail·SCALE` → balance unchanged ≥ new ceil. `claim`: pays `floor(pending/SCALE)`, `owed-=pay·SCALE`, balance `-=pay` → preserves. `retire`/`retire_burned`: `owed-=pending`, weight removed, balance unchanged → preserves. `PoolShort` refuses to distribute otherwise. P.32 + `ledger()` (`BK.*`: weights, boost totals, ring+due==active, `bal≥owedCeil`, `owed==Σ(weight·acc+carry-debt)`) after every money op.

`pending_count`/`pending_this_epoch`/`active_count`/`total_active_weight`: every mutation `checked_*`, join only when `dist_epoch>request_epoch` (decrements `pending_count` only — correct, request is from an earlier epoch), retire of current-epoch pending decrements both, else only `pending_count`. No underflow path silent.

Liveness: `JoinWaitingFirst` block is joinable by anyone (`claim` joins without needing the token account to exist, `debt=w·acc` exact because nothing credited between eligibility and join); `BoostsExpireFirst` block clearable by anyone via `expire_boosts` (records only, no token account). `monthly_inline` never refuses its host (logs `WAITS_FOR_BOOSTS/JOINS`). No vault, boost, or missing account can permanently stop distributions or redemptions.

## R2b. $CBOB boost — exactly N, carry exact, ring exact

Buy at epoch `e`, `end=e+N`, earns distributions `e+1…e+N`, due at `e+N`, next distribution refused until expired. `reweigh` moves `owed→carry`, `debt=after·acc`, `total_active_weight±diff`, `owed_scaled` unchanged. `unschedule_boost` takes the due branch (`boosts_due--`) iff `dist_epoch≥end` else the ring slot (`boost_expiring[end%64]--`). `expire_boost` requires due, then unschedules + reweighs to 0, clears `end`. No double/early/never: weight-zero guard, `BoostNotDue`/`BoostsExpireFirst` gates, permissionless expiry, crank expiry before/after distribute. `total_active_weight`/`boost_weight_total`/`boosts_active`/`boosts_due`/ring recomputed from records in-suite (`books()` == `true×5`) and in host tests across 260 epochs/4 wraps with buys, wrapped buys, early wrapped N=63 retires, due retires, expiries — all counters and per-slot ring match, `owed==Σ` each epoch. Retired records inert (`retire` unschedules; `claim`/`expire_boosts`/crank skip retired). Token-account-gone vault still expirable via `expire_boosts`.

## R3. Draw — parse, skips, FIFO, burned head, hash, influence as stated

`blockhash_in_window`: sysvar key pinned, `n≤512`, buffer-length checked, smallest produced in `[want,want+64]`, zero-hash refused. `try_capture`: `NotYet` at/before slot, `Expired` past +300, else A then B/C each `(slot/4+2)*4`, `None→NotYet` (never partial). Max C ≈208 <300 so A always still buffered. FIFO `index==revealed_total` (`RevealOutOfOrder`); burned head still draws (`level_minted`/`revealed_total` advance), Core write skipped on positive tombstone (Core-owned 1-byte `0x0`); attributes re-supplied and hash-checked (`AttributesMismatch`); 640 B/8-attr bound proven revealable (L.12) and enforced at mint (L.12a `AttributesTooLarge`). L.23 replays every draw in mint order; L.23a zero draws without entropy.

Influence is exactly SPEC 25/26 and the guide's honest list: public hashes → computable pre-capture; lapse needs a full ~2 min window with no namer capturing (crank + 4-host crank + permissionless capture, every reschedule logged/paged, `reveal_queue_stalled` covers silent lapse); C-leader chooses among many draws (best-of-4 5%→18.6%, +block-content grinding, whole same-slot cohort jointly) — not worse than stated, guide says it truly.

## R4. Governance — no minority money, no freeze beyond stated

Quorum vs snapshot live, threshold vs cast, 10% turnout vs snapshot, key-change 50% of snapshot (`KeyChangeNeedsHalf`), `VaultTooNew` vs `index_snapshot`, `CharterNotClosed`, `KeyChangesBundled`, `Loosening` vs live + `TightenOutOfBounds` vs init bounds, price/cap/window mirrors of MINT, 7-day execution window, per-kind ordering with `CBOB_ACTION_SKIPPED` (never revert), stale restart skipped by stop time (`>=` tie matches MINT `StopIsNewer`). Hostile majority cannot reach split/destinations/`max_supply`/royalty/vault/reserves. `max(snapshot,live)` correctly **not** used (mint-mid-vote can neither vote nor raise bar — round-25 D1 240→120 YES =5.71% of 2,100 case covered).

Freeze: stolen guardian holds sales/sweep until half-of-live replaces (vote+7 d notice, guardian cannot cancel own replacement, `None` legal) — SPEC 47 complete, not worse. No-proposer iff no live vaults (limit 45, with the round-24 D3 correction that an open round can still mint one). No quorum inflation via burns (divisor is snapshot), no threshold deadlock (5,001–7,500), no `need==0` pass (`need>0`, `need_yes>0`, `need_key>0`).

## R5. Charter claim — window, burn, Merkle, hot-key exposure complete

Live `AssetV1` in `pob_collection` owned by signer, Merkle `sha256(0x00‖asset)` / sorted `sha256(0x01‖min‖max)` against `pob_root` (same code as suite/probe), `≤16` proof, CPI `BurnV1` as owner in same ix (leaf spendable once — address never re-mintable 9.12/9.13), `[opens,closes)` clock-only never-reopenable, **not** gated by sales stop (ruling), counts to supply/census, `charter` attr appended by program, `pob_extra≤8` passed through never-as-signer. SPEC 46 complete: end-before-start + capture-governance stated, per-asset blind spot + owner freeze-delegate stated, sampling (30 min add/remove gap) + positive bound (cannot take PoB) stated, claim-page `pob_extra=0` refusal + rebuild note stated, packet 4-with-payer/compute vs 8-without stated, v0/LUT noted. Nothing the hot key, a PoB holder, or third party can do beyond it found.

## R6. Init, trusted hop, royalty, cap

- SEAL: 1–3 reserves, each passed + classic-SPL-owner-checked; collection unwired (MINT/BURN `WiringDiverged` fail-closed before any mint). Duplicate/non-mint-owner acceptance is exactly the round-24 A6 limitation the checker (item 38) pins the ruled three for — not re-filed.
- MINT: treasury/operator/payment non-default, caps non-zero sum≤supply, window/period/notice/bounds, clean+ours+unminted collection + royalty install, SEAL-agrees + payment-is-reserve, `$CBOB` classic/initialized/neither-cbBTC-nor-GARY, boost bounds. `guardian=None` legal (brake retired). `last_distribute_at=max(now,closes)`.
- BURN: SEAL-agrees, window 10–86,400 (mainnet 3,600 ruled). GOV: MINT-agrees, quorum 500–10,000, threshold 5,001–7,500, voting 60–30 d (mainnet 21%/51%/3 d ruled).
- Wrong-but-accepted values lock forever — that is item 38 (OPEN): checker `check-launch-params.mjs` + ceremony `judgeLaunch` + alarm `test_value_in_production`/`config_drift` are the gates; programs fail-closed where they can (`WiringDiverged`, `BadSweepBound`, `BadBoostSetup`).
- Swap operator worst case: `cap × windows` until `emergency_stop_sweep`, ≤ revenue-above-reserve, royalty SOL only, operator must sign, vote-only-tighten inside init bounds, replacement half-of-live +7 d, guardian can stop/cancel. Swap builds pinned Orca-then-Meteora with Pyth floor enforced on-chain (fork-proven).
- Royalty: `AddCollectionPlugin Royalties 1000bps revenue-100% RuleSet None Authority None` at init; no update/remove path; Core refuses even UA (R.6/6a `0x9`, re-delegation `0x1b`). Nothing in our programs or Core lets anyone change it.
- Cap: `ceil(2.1%·live)` floor 1, `k=min(cap,64)`, allow iff `now-ring[(head+64-k)%64]≥window` — exactly a 64-deep rolling window (RL.2/3/4/7, S10).

## R7. Raw reads — offsets and spaces recomputed, agree

SEAL `9/41`, MINT `41/73/105/125/133/137/141/149/191/192/193/225/257/265/266/274/282/290/310/330/442/450/454/462/470/478/494/510/518/526/534/566/574/582/614/615/623/631/639/647/655/663/671/679/711/712/714/722/723/725/729/733/741/749`, VaultRecord `8/9/41/49/57/58/59/60/92/124/125/126/127/129/161/177/178/186/187/195`, BURN `42/50/58/59`, GOV MintView/BurnView/RecordView, `MINT_CONFIG_SPACE`/`VAULT_RECORD_SPACE` (221 B rent record)/`BurnConfig` 571+256, sweep `0/32/64/165`, Core `Execute 31`/`CreateCollection 21`, SPL `Transfer 3`/`Close 9`/`TransferChecked 12`/`Burn 8`, sysvar Clock 32 — all match structs, `bank/layout.mjs`, proxy `mint-waiting`/`mint-boosts` slice, and suite X.1–X.6 live-decode arms.

## R8. Suite/sim/build as evidence — non-vacuous, bound to bytes

909 on-chain + 945 detectors + 39 allocation + 24 poster + 14 PoB + 49 launch + 33 mainnet + 4 expiry + 71 sim + 16 fork, each behind an equals-floor (`run-tests.sh`, `run-sim.sh`, `swap-fork.sh`). `because()` pins name the measured reason (spot-checked R28.F1 Token `0x11`, C12 System `0x0`, SR series, WR series, BO series). No arm found that cannot fail; no negative found firing for a different reason than pinned; packet/CU figures are legacy/v0 only with the v1 boundary stated. `build-mainnet.sh` proves mainnet/localnet key behavior both ways per program + sweep byte-identity to the deployed build; `initauth.test.ts` requires `NotTheInitAuthority`/post-check reach, not any reject.

`web/` 682 offline (10 files at exact floors) + 132 e2e: `ix` byte-equality vs suite/sim builders + SDKs, `plan` vs MINT source, `get` with real 240-set, `ceremony` field checks, `tx`/`proxy`/`meta`/`bundle`, mock-RPC wiring + adversary/dust runs, localnet e2e driving the pages' own libs (ceremony→claim→draw→activate→rescue→payout→boost→open with late strays, decoys, dust, C5s, floods). Release-commit binding (`RELEASE_COMMIT`, program-hashes vs `dist/SHA256SUMS`, bundle hashes in README) enforced by build + `run-tests.sh` C10.

## Accepted limits — the four questions

1. **Worse than stated?** No. 25/26/27/28/32/40/41/42/43/44/46/47/55/56/58/59 all read true against code and measurements; the C-leader math, frozen-pool forfeit, cap replay, and front-run cost match.
2. **Listed but not a limit / already closed?** No. Discharged items stay discharged (Bank/deck/distributor gone; 14/19/30/31/33 closed or superseded with arms).
3. **Discharged but not?** No.
4. **OPEN treated as accepted?** No. 22/38/50/52/53 remain OPEN AND BLOCKING in SPEC and in practice (rehearsal, launch values, pages/proxy/ceremony/metadata, pool/Squads/revenue funding, throwaway-id rehearsal + rehearsal values). The guide stays DRAFT until item 50 ships.

## Other findings

### INFO-1: limit 59's "only a program change" is incomplete (docs, fixable layer)
Construct: SPEC limit 59 "Why not fixed in the programs: … MINT could only work around it by draining the address before the CPI. That is a program change…"

The new vault/collection keypair **signs** `mint_vault`/`claim_charter_vault`/step 0. A client could drain a stranger-funded address in the **same** transaction with a System transfer from that keypair before Core's `create_account`, recovering the grief funds, with no program change. Pages instead use a fresh key (`checkNewAddress`), which is also correct and is what is tested. Nothing lost either way but the fee; no value path, no crack block.

Evidence if true: `mint_vault`/`claim_charter_vault` asset is `Signer`; System `transfer` from it is valid; Core create then sees an empty address. Fix: soften "only … program change" to "program or client drain; pages use a fresh key".

Classification: (a) no — not the five programs; (b) no value path; (c) no crack block (retry lands); (d) INFO in docs. **Does not break launch-clean; fix + gate-5-style arm before/after launch as usual.**

No other findings. In particular no CRITICAL/HIGH/MEDIUM anywhere, no program finding at any severity, no value-moving or value-miscrediting path, nothing stopping or wrongly refusing a crack.

# What AI audit structurally cannot do before launch — do it anyway

1. **Run the rehearsal with real money and real adversaries.** No suite simulates a 2,100-vault crank pass against a live cluster (RPC rate limits, a transient failure at vault 1,900, reveal lane keeping up), a full revenue cycle through **both** pools with real slippage/fees, or a forced post-sweep failure walked through hand recovery with the alarm's CRITICAL and `--audit` clean again. Item 22 names the transactions to record. Do not lock before those signatures exist.
2. **Watch a real holder use the real pages on a real phone.** No offline arm proves a holder understands a box, ticks the right one, or notices a forfeit warning; nor that Phantom signs exactly what was simulated (wallets add guard instructions), nor that the proxy + nginx + Cloudflare real-IP chain relays it under load. Run the staged pages against mainnet with small amounts, with Gary's go-ahead for the poster sender, before publishing the guide.
3. **Lose the box.** The revenue ledger, crontab, alarm, swap key, `$CBOB` release key, deploy authority, and backups share one user/box. No same-tree judge survives its owner. Move the `$CBOB` release wallet and swap operator to Gary's custody or a Squads, delete the box keys, verify the nightly backup restores on a second machine, and rehearse a stolen-operator and stolen-guardian drill (stop, vote, notice, apply/cancel) end-to-end.
4. **Re-pin what you do not control on launch day.** Core, Orca, Meteora, Pyth, cbBTC/GARY/GIRAFFISH mints, the Moments collection/plugins/UA, Squads ATA existence, rent rates, and the five deployed prefixes+zero-tails must be re-read the morning of step 10/11, not trusted from an October log. Any drift is a stop.
