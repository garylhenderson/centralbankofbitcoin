## R0. Round 29's verdict and its repairs

Round 29 `VERDICT-programs.md` was **NOT CLEAN, QUORUM NOT MET**: 5/8 counted, 6 required. Grok excluded as a restatement. Confirmed: M1 MEDIUM shared scan-gap, L1 LOW path-only coverage, D1/D2/T1 INFO.

Current tree `c5aab17` + round-30 repairs `0d13b03` / `425111d`:

* M1 repair present: `bank/sigwalk.mjs` takes `startBefore`, SPEC has "Scan backlog boundary", `bank/txread.mjs` has `truncatedLogs: flag` mode. Verified by reading.
* L1 repair present: `scripts/audit-coverage.sh` enumerates `git ls-files` and requires current blob equal to a completed quorate round's blob; `--prepared` only preflight. Verified by reading.
* D1/D2/T1 present: SPEC 49 / DESIGN record 1,772,920 lamports mainnet, DESIGN §8 drain ~209h, `build-mainnet.sh` banner attaches later-check to localnet. Verified.
* No re-file. The five counted reports' refuted claims W1-W7 remain refuted. No regression in the bundled programs is visible. Off-chain consumer files `bank/alarm.mjs`, `bank/detectors.mjs`, `bank/crank.mjs`, `bank/revenue.mjs` are **not in this bundle**, so the alarm/poster half of M1 cannot be re-executed here. That is a scope limit, not a repair failure.

Counter remains 0/2.

## R1. Custody

No theft and no emptied survivor found.

* `open_for_redemption` walks forward from `current+1` for `burn_vault` with asset 0 + owner 2. `burn_vault` walks `0..current-1` for `open_for_redemption` with asset 0 + owner 2. Both use `load_instruction_at_checked`, top-level only. Wrapper CPI invisible both ways. Suite WR.1-WR.4 measures it.
* Discriminators pinned and asserted in suite 3.1a-3.1b. Coupling fails closed.
* Emptiness: `asset_signer.lamports()==0`, `declared==len`, both ATA derivations per reserve required, PDA-owned, `d[72..76]==0`, `d[121..129]==0`, `d[129..133]==0`, `len==165`, no declared Core `Key::AssetV1`. Undeclared non-ATA / nested destroyed, not stolen. That is accepted 9/44, correctly stated.

No new R1 finding.

## R1s. Sweep helper

Stateless, 4 fixed + pairs, `data==[0]`, `signer.is_signer`, token==`Tokenkeg`, system==system, `signer!=dest`.

(a) Only owner via Core. Direct call needs asset-signer signature which only Core gives. Through Core, `ExecuteV1` on thawed vault approved only for owner. Measured SR.5/SR.5a `0x1a`, SR.5b collection authority is MINT PDA off-curve, SR.5c control refuses update authority, SR.5d owner lands. Frozen vault refuses `0x9` (3.7). SEAL PDA is freeze authority, not Execute authority. Holds.

(b) Pairs: source owner must be signer, dest owner must be dest wallet, mints equal. Duplicate source: first closes, second `read_token` sees owner!=SPL, `IllegalOwner`, whole tx reverts, thaw reverts. Self-DoS only. Source==dest impossible (owners differ). wSOL is 165-byte classic, transfers+closes normally. Delegate does not block owner transfer; close-authority!=owner blocks close and reverts, but attacker cannot set it on an ATA (ATA sets None) and a stranger non-ATA with hostile close authority left undeclared is destroyed, not blocking. Frozen with balance reverts; frozen zero closed per round-30 measurement. Odd count / bad data / wrong programs refused SR.6-SR.9. Zero pairs allowed, lamports-only SR.13 lands. Holds.

(c) Dest chosen by builder is safe because only owner can reach helper via Core. System transfer credits any account, including token-owned (R27.S1 leaves data intact) and non-existent (creates below rent, does not fail). No redemption block. Holds.

(d) `signer.lamports()` read at execution, `system transfer` to dest. Later deposit before BURN makes `lamports!=0` refuse and revert all. Core `BurnV1` does not add. Holds.

(e) BURN needs both derivations declared, skips non-token owner. Closed account skipped correctly (zero, nothing to check). Missing reserve ATA cannot be named (refuses non-token). Stranger creating classic ATA + dust between build and land is swept because helper reads live. Stranger creating non-ATA / nested after build, left undeclared, destroyed not blocking. T22 ATA for classic mint cannot be created `IncorrectProgramId` (probe). T22 non-ATA for classic mint if creatable and undeclared is invisible; if declared with extensions refused, owner leaves undeclared. Prior-tx creation of three reserves (item 42) sufficient. Holds.

(f) S8.0 1,061B +52 CU pair +96 separate payer = ~1,209 of 1,232, 23 spare. S8.1a 168,343 CU <800k. No crank in redemption, pool already carried. Fourth reserve does not exist. Holds.

(g) SR.0-SR.4a, S8.* all can fail. SR.12b `false` is the correct second-close proof, not vacuous. Helper bytes proven equal `dist`==`ln`==`target/deploy` by `build-mainnet.sh`.

No new helper finding.

## R2. Pool invariant

`credit`: `delta=floor(avail*SCALE/w)`, `owed+=delta*w <= avail*SCALE`, `balance>=ceil(owed)` preserved. `claim`: `pay=floor(pending/SCALE)`, `owed-=pay*SCALE`, `balance-=pay`, ceil preserved. `retire` redeemed/forfeit/bare: `owed-=pending`, balance unchanged or `-pay` already done, preserved. `monthly_inline` same `credit` or no-op. P.32 asserts it.

Counters: `pending_count`, `pending_this_epoch`, `active_count`, `total_active_weight` increment/decrement symmetrically; `retire` waiting decrements `pending_this_epoch` only if `request_epoch==dist_epoch`; `advance_epoch` zeroes it; `waiting=pending-this` exact. Liveness: `JoinWaitingFirst` joinable free via `claim`, `BoostsExpireFirst` expirable via `expire_boosts` records-only, frozen pool forfeits not locks. No block found.

## R2b. Boost

N distributions exactly: due at `dist_epoch>=end`, gate refuses distribution while `due>0`, expiry at same `acc`. `reweigh` moves `owed` to `carry`, restarts `debt=w*acc`, `owed_scaled` untouched, denominator delta exact. `unschedule` due vs ring branches correct; `advance_epoch` moves `expiring[i]` to `due` and zeroes. Ring 64, max 63, no live wrap collision with different ends because earlier due blocks progress. No double/early/never: `expire` requires due + weight, zeroes weight, second fails; `expire_boosts` skips not-due/retired; retire unschedules. Token-gone does not block expiry. Host N1 260 epochs reconciles every slot. Holds.

## R3. Draw

`blockhash_in_window` pins sysvar, `n<=512`, `len>=8+n*40`, refuses zero hash. Smallest produced in `[want,want+64]`. A,B,C stride 2 groups, deterministic. FIFO `index==revealed_total`. Burned head still draws, Core write skipped, positively identified `Core,1,0`. Attr hash checked. Skips, reschedule `now+16` future unknown, crank 4 bounded, logs `CBOB_REVEAL_RESCHEDULED`. Residuals 25/26 as stated; holder guide "choose among several / drawn again" not worse than SPEC "choose among many".

No new finding.

## R4. Governance

Snapshot `minted-burned-bare`, `index_snapshot=minted`, rule copied. No proposal before `charter_closes`. Quorum ceil + non-zero, threshold YES share, turnout 10% ceil, key-change 50% ceil. Per-kind marks, overtaken skip+log, stale restart skip by `>=`, tighten max/min monotone inside init bounds. No minority carry at ruled 21/51/10/50. No money reach: only Round/Brakes/Tighten/ArmOp/BoostTerms. No forever freeze beyond accepted 45 (no vaults) / 47 (low-turnout permanent stop, stated). Holds.

## R5. Charter

Live Core AssetV1, owner==signer, `UA==Collection`, collection==`pob_collection`, `len<=16`, `root==pob_root` domain `0x00` leaf / `0x01` sorted node, odd promoted. CPI `BurnV1` as owner same ix, `pob_extra<=8` split, never signer. Window clock only, no guardian gate. SPEC 46 complete: end/capture, benign pass-through measured, per-asset blind spot, sampling gap, positive bound cannot take PoB, packet 4 widest / 8 without payer+CU. No omission found.

## R6. Init, trusted hop, royalty, cap

### CRITICAL C1 — deterministic PDA / ATA squatting bricks launch and pool forever

**Construct:** every `Initialize` uses Anchor `init` at deterministic PDA (`mint-config`, `config`, `burn-config`, `gov-config`, `["vault",asset]` excluded as random) + road step 10 creates pool ATA `config+SPL+cbBTC/ATA`, revenue ATA `revenue+SPL+cbBTC/ATA` off-chain after init. `MINT initialize` only derives `pool_ata`, never creates it. `SPLIT`, `DISTRIBUTE`, paid `MINT` need those ATAs.

**Gain:** anyone dusts `pool_ata`, `revenue_ata`, or any config PDA with a plain system transfer before creation. Transfer to non-existent off-curve address creates system-owned account with locked lamports. Subsequent ATA creation (`createIdempotent` / `create`) fails `already in use`; Anchor `init` fails `already in use`. Config PDA needs PDA signature to close, none exists; pool ATA at PDA address needs PDA signature to close, none exists. Launch blocked forever, or pool/split/distribute blocked forever. Cost ~0.001 SOL per address + fee. Pre-deploy program IDs + seeds public, so squat can be pre-mined.

**Evidence if true:** `solana transfer <pool_ata> 0.001` on validator before `createAssociatedTokenAccount`, then ATA creation returns `already in use`; `solana transfer <mint-config PDA> 0.001` before `initialize`, then `initialize` returns `0x0 already in use`. Standard system behavior, not yet exercised in suite (no arm dusts a PDA then inits). Absence of any `init_if_needed` / reclaim / in-`initialize` ATA CPI in `lib.rs` is visible.

**Fix:** before lock, make `initialize` create pool + revenue ATAs by CPI in same ix, and make config `init` squat-resistant (manual allocate after `invoke_signed` reclaim of system squatter to payer, or `init_if_needed` with owner+disc check). Operationally until fixed: deploy+initialize+create ATAs in one private bundle with no mempool gap, verify `getAccountInfo(pool_ata)==null` before creation, and treat any non-null as abort. Add suite arms dust-then-init and dust-then-ATA must not brick.

This is not accepted 52 (which assumes creation succeeds) and not accepted 38 (checker validates JSON, not chain squat).

Royalty `None`, swap cap×windows, ring cap exact, tighten bounds all otherwise hold.

## R7. Raw reads

Recomputed: MINT 41/141/454/442/257/266/274/631/639/647/711/712/73/518/526/534/566/574/582/614/615/623/655/663/671/679/714/722/723/725/729/733/741/749; BURN 42/50/58/59; VaultRecord 41/49/57/58/59/60/125/126/127/129/161/177/178/186/187/195; SEAL 9/41; sweep 0/32/64/165. Spaces `MINT_CONFIG_SPACE`, `VAULT_RECORD_SPACE`, `BurnConfig 8+1+32+1+8+8+1+512+256` all match `bank/layout.mjs` offsets asserted X.1-X.6. No misread.

## R8. Suite / sim / build

No arm found that cannot fail. `because()` reasons match measured errors including `0x1a`, `0x9`, `0x11`, `RateLimited`, `JoinWaitingFirst` vs `NoActiveVaults` epoch-gated S7.2!. No prompt claim lacks an arm: pairing WR, helper SR, pool BK/ledger, boost wrap BO.34/BO.38/N1, draw L.3c/L.23, gov half K2, charter OR, init 0.1*, cap RL.7, offsets 3.1*, packet 9.14/S8.0/S9b. Helper mainnet==tested proven; four programs mainnet==tested explicitly NOT PROVEN beyond key behavior, correctly stated.

## Accepted limits — four questions

1. **Worse than stated?** No, except C1 above is unwritten and worse than item 52 implies. All sampled ACCEPTED (9 foreign nested, 25 re-roll, 26 grind, 27 dead claim/join, 28 freeze+forfeit, 40 heap boundary as bounded observation, 41 transfer unlimited, 44 classic rescue vs T22/frozen/nested, 46 hot key end/capture + sampling + per-asset blind spot, 47 permanent low-turnout stop, 55 unsplit 100/200 GARY + hourly crank) read true.
2. **Not actually a limit?** None. 35 turnout floor, 36 in-line skips, 37 pool-carry cost remain true limits.
3. **Discharged not discharged?** No. 51 boost built, 54 compute measured, 14 duplicate, 19 unlevelled-by-construction, 1a/1b/2-5/11/15/16/18/20/21/23/24 gone with Bank/deck/distributor all hold.
4. **OPEN treated as accepted?** No. 22 live rehearsal + both-venue cycle + forced recovery, 38 values + ceremony from file, 50 pages + poster sender + helper lock, 52 three ATAs + rent, 53 throwaway re-proof + rehearsal values all still OPEN and gated. Guide DRAFT gate respected.

## Anything else

None beyond C1. No second program finding survives measurement.

---

## GIVEN NO HUMAN FIRM WILL EVER SEE THIS AND PROGRAMS WILL BE IMMUTABLE, what AI audit structurally cannot do before launch

1. **Run the live rehearsal with real money and real wallets.** One full revenue cycle through Orca then forced Meteora fallback, one forced post-sweep failure + hand recovery per limit 10 runbook, crank live at 2,100 vaults measuring cost/rate-limit/RPC error on vault 1,900, alarm live in rehearsal mode. Record tx signatures. AI reasons about fork arms; it never pays fees or pages.
2. **Perform the init ceremony from `launch/mainnet-init.json` by reading the file, not typing.** Build four `initialize` txs from the file, byte-compare each field, verify SEAL→MINT→BURN→GOV order, verify deployed bytes vs `build-mainnet.sh` SHA256 by independent rebuild on a second box, verify pool/revenue/Squads ATAs exist and revenue funded above rent, then remove upgrade authority on all five and verify `set-upgrade-authority --final`. Include squat check: abort if any config/pool/revenue address already holds lamports.
3. **Take custody off this box.** Guardian (also INIT_AUTHORITY) to cold/multisig after init; swap operator float topped above 0.02 and monitored; $CBOB release wallet `AT2qf412…` moved to Gary/Squads and box key + backups deleted; deploy/upgrade keys split. AI cannot hold keys.
4. **Test holder pages with real humans and real wallets.** Deposit-address display (asset-signer, not NFT), coverage warning, join+payout offer, live-balance sweep via helper, prior-tx ATA creation, no-crank when `pob_extra>0`, CU limit when crank carried, lamports-only dest-exists check, packet fit with payer+CU. Phantom/Ledger quirks, memo bytes, v1 clients need explicit measurement; no v1 writer certified.
5. **Watch what AI cannot prevent.** Core upgrade authority/hash, Orca/Meteora/Pyth upgrade keys, cbBTC freeze authority, PoB collection plugins + per-asset freeze delegates (alarm samples every 30 min, add/remove between passes invisible). Assign a human to each page with guardian key access and a runbook.
6. **Decide owner decisions before lock.** `retire_orphaned` for activated orphan dilution (round-29 D2), top-level-only mint to refuse off-curve owners, tombstone relaxation, reveal-Core decoupling. These are product trade-offs, not audit proofs.