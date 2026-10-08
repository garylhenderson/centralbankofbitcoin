## R0. Round 40 verdict and repairs

Round 40 programs `VERDICT-programs.md` at `8dba479` was NOT CLEAN, quorum met, 0 CRITICAL / 0 HIGH / 1 MEDIUM V40-1 / 3 LOW V40-2,V40-3,V40-4 / 1 INFO V40-5. `VALIDATION.md` records the repairs. `git diff 21f36e1..8dba479 -- programs` is empty in the verdict; this tree carries the same five programs.

Verified at this tree:

* V40-1: `web/src/lib/decode.mjs:absentIfDust` exists. `web/src/lib/reads.mjs:vaultWalletAccounts` maps reserves through it, `readRedemptionSnapshot` maps owner ATAs through it and `ownerAtaExists` requires Token ownership, `ownerAtaFrozen` can no longer class a System 0-byte account as frozen. `web/src/pages/buy.mjs:read`, `redeem.mjs:payoutBlock`, `redeem.mjs:dryRun watch` use it. Control kept: `plan-redeem.mjs` still refuses a TOKEN-owned reserve that cannot be parsed.
* V40-2: `web/src/lib/ceremony-reads.mjs:readStep atas` uses `absentIfDust`, dust reads as not-run, `plan-ceremony.mjs` builder creates it.
* V40-3: `web/meta/generate.mjs` reads dust as absent / 0 sats, writes the file.
* V40-4: `SPEC.md` DISCHARGED item 2 now lists the page's by-design refusals.
* V40-5: `plan-redeem.mjs` nested note no longer asserts the sender.

No regression seen at the sites. `R34.G2` / `R31.W2` premise the repair relies on — ATA create lands on a dusted address — is still the suite's own state at `tests/3prog.test.ts:527-535`.

U1 is now measured in-tree: `tests/3prog.test.ts:R40.U1` simulates the large-autograph redemption with no compute-budget instruction and asserts `unitsConsumed <= 200000 * ixCount`. That is the exact shape the verdict left uncertain.

No surviving V40 defect shown. The A1-A12 already-stated items remain stated; items 22,38,50,52,53 remain OPEN in SPEC.

## R1. Custody

No path out of a sealed vault except the owner's paired redemption. No emptied vault survives.

* Pairing: `programs/cbob-vaults/src/lib.rs:open_for_redemption` walks top-level only forward from `current+1`, binds `BURN_PROGRAM_ID` + `IX_BURN_VAULT_DISC` + asset at 0 + owner at 2. `programs/cbob-vault-burn/src/lib.rs:burn_vault` walks `0..current` backward, binds `SEAL_PROGRAM_ID` + `IX_OPEN_FOR_REDEMPTION_DISC` + asset at 0 + owner at 2. Account order matches both structs' MUST-stay comments. A CPI-hidden half is invisible to `load_instruction_at_checked`; a wrapped half fails the other half's top-level search. Suite WR.1-WR.4 measures all three wrapper shapes refusing with the vault live.
* Emptiness: PDA lamports `==0`, `declared == remaining.len`, every reserve ATA under both token programs declared, PDA-owned, `d[72..76]==0`, `d[121..129]==0`, `d[129..133]==0`, `len==165`, `amount==0`, no declared Core AssetV1. Non-ATA / undeclared holdings are invisible by impossibility 2 and are destroyed or locked — stated in limits 9/44, not a bypass.
* No thawed vault leaves the transaction: thaw reverts with a refused burn; burn reverts with a refused thaw.

## R1s. Sweep helper

`programs/cbob-vault-sweep/src/lib.rs:process`:

* (a) Direct call needs `signer.is_signer`; a vault's signer is Core's `["mpl-core-execute",asset]` PDA which only Core signs for, and Core on the pinned binary approves Execute only for `owner` — measured SR.5/SR.5a `0x1a`, SR.5c refuses the collection authority, SR.5d lets the owner through. No update authority, delegate, freeze authority or collection authority path is shown. Frozen vault refuses Execute before the helper runs.
* (b) Pairs checked: `src_owner==signer`, `to_owner==dest`, `to_mint==src_mint`. Duplicate source closes then fails the second `read_token` and reverts whole opening — safe fail-closed. Source==destination impossible by owner mismatch plus `signer!=dest` refusal. wSOL / delegate / close-authority / frozen cases revert the opening, never leak. Odd / zero-pair counts refused except zero-pair lamports-only, which is SR.13. Destination aliasing to the vault wallet refused `InvalidArgument`.
* (c) Destination not compared to owner is safe: only the owner can invoke through Core, destination is the owner's choice; page sets it to the owner. Lamport System transfer does not enforce rent-exemption — see LOW-1 below — but page uses the existing owner, so no block.
* (d) `signer.lamports()` read at execution, System transfer, then BURN checks `==0`. No later instruction in the redemption credits the signer. Core BurnV1 does not sweep it — measured D4.
* (e) BURN requires both ATA derivations declared and skips non-token owners; helper closes what it empties so closed accounts skip for the right reason. Missing reserve ATA must be created in the prior transaction — item 42 contract, enforced by the page's `priorIxs`. A stranger-created classic ATA / non-ATA / T22 / nested asset is either swept, transferred, or left as a ticked loss, never a refusal except reserve problems — H1/V1 design.
* (f) S8.0 1,061 bytes claim+open+3-reserve helper+burn with owner payer; +52 compute pair +96 separate payer = ~1,209 of 1,232. S8.1a 168,343 CU. Four-reserve / extra-pair shapes do not fit; page drops strays to fit and groups over 20.
* (g) SR.0-SR.4a, SR.6-SR.14, SR.12b, R36.C5 all pin the named reason. `scripts/build-mainnet.sh` cmps `dist/cbob_vault_sweep.so` to the localnet release and to `target/deploy`, byte-identical — no-key crate, no `localnet` feature.

No helper bypass shown.

## R2. Pool

Invariant `pool >= ceil(owed)` holds on the code paths:

`credit` adds `floor(avail*SCALE/w)`; `claim` subtracts exactly settled whole sats and carries remainder in `carry`; `reweigh` moves `owed` whole into `carry` and restarts debt at new weight so `owed` unchanged and `owed_scaled` untouched; `expire_boost`/`unschedule_boost` preserve it; `retire` subtracts pending and, unless forfeited, the forfeit only lowers `owed` while balance stays, increasing avail. `distribute` refuses `PoolShort`; `monthly_inline` uses `saturating_sub` and returns without crediting on empty/frozen/waiting/due-boost. `pending_count` / `pending_this_epoch` / `active_count` / `total_active_weight` transitions checked for request/join/retire-same-epoch/retire-later-epoch; `waiting_to_join = pending_count - pending_this_epoch` gates both distribute paths before any GARY burns. No liveness block shown: every gate is clearable permissionlessly by join/expire/claim.

## R2b. Boost

N distributions exactly: end `= epoch+N`, due when `dist_epoch>=end`, `BoostsExpireFirst` refuses every distribute and `monthly_inline` waits with a log. `carry` preserves earned share across boost/expiry/claim/retire. `total_active_weight`, `boost_weight_total`, `boosts_active`, `boosts_due`, ring sum agree — host test drives 260 epochs / 4 wraps through `join`/`reweigh`/`credit`/`tick`/`retire`/`expire_boost` against a record-only model with wrapped buys, early wrapped retires at N=63, and due retires covered. Ring safe: live ends lie in `(e,e+63]`, 63 values in 64 slots, no two live ends share a slot. No double/early/never expiry: `expire_boost` requires due, `unschedule_boost` branches on due vs ring slot, `retire` unschedules once under `!retired`. Token-account-gone cannot block expiry: `expire_boosts` needs records only.

## R3. Draw

`blockhash_in_window` pins sysvar id, `n<=512`, buffer length, refuses zero hash, picks smallest produced in `[want,want+64]`. `try_capture` A then B/C each +2 groups, deterministic, `NotYet`/`Expired` correctly bounded. FIFO `index==revealed_total` enforced; burned head still draws and skips Core write, positively identified. Reschedule only after window, to `now+16`, logged. Host tests model skips at A/B/C. Leader-C grind and lapse re-roll are exactly SPEC 25/26, holder guide states both. No worse influence shown.

## R4. Governance

Electorate frozen at creation (`index_snapshot`, `quorum_supply=minted-burned-bare`), no pre-charter proposal, quorum/threshold/10% turnout/half-of-live key-change all ceilinged and `need>0`. Key-change never bundled, notice enforced in MINT, guardian cannot cancel own replacement, `TightenSweep` monotone in MINT plus creation-time tighten + bound checks, overtaken actions logged skips not reverts. No minority-carry, no money reach, no permanent freeze beyond stated 47 shown.

## R5. Charter

Address-pinned Merkle leaf `sha256(0x00||asset)`, sorted `sha256(0x01||min||max)`, odd promoted, bound 16, CPI-burn as owner in same ix, window clock-only, no guardian gate, `pob_extra<=8` never as signer. SPEC 46 completeness holds at this tree: per-asset plugin blind spot, sampling gap, positive no-take bound, end/capture consequences all stated. Nothing omitted shown.

## R6. Init and trusted hop

SEAL/MINT/BURN/GOV initializes checked: authority first, supply/caps, treasury non-default, notice/bounds, charter window/root, monthly, collection clean/ours/unminted, SEAL wiring + payment-is-reserve, CBOB mint classic and neither payment nor GARY, boost bounds, BURN window/collection, GOV collection/quorum/threshold/period. Wrong-but-accepted values are exactly item 38's OPEN list. Royalty 10% authority None proven R.1-R.6c on control collections. Rate ring 64, cap `max(1,ceil(live*210/10000))`, kth-oldest rule — true rolling window. Swap operator bound cap x windows, operator must sign, guardian can stop/cancel, vote tightens only inside init bounds, replacement needs half-live + notice.

## R7. Raw reads

Recomputed: MINT config `governance@41 minted_total@141 bare@454 sales_stop@191 sweep_stop@192 sales_at@518 sweep_at@526 floor@631 ceil@639/647 maxW@711 maxE@712`; VaultRecord `asset@9 index@41`; BURN `burned@42 window@50 head@58 ring@59`; SEAL `collection@9 reserves@41`; GOV/BURN discriminators and versions all match structs and `bank/layout.mjs` offsets asserted in suite 3.1* arms. Spaces match: VaultRecord 221, BurnConfig rate ring `[i64;64]`.

## R8. Suite / sim / build

896 on-chain + 933 detectors + 39 allocation + 49 launch + 33 mainnet + 4 expiry + 71 sim + 16 fork floors must equal counts. No arm shown vacuous on its face; `because()` pins name the measured reason; SR.12b, ID.1, X.7 are explicit non-vacuity guards. Build proves mainnet/localnet key behaviour both directions and sweep byte-identity to the deployed file.

## Accepted limits — four questions

1. **Worse than stated?** No limit shown exploitable beyond its text on this tree.
2. **Not actually a limit?** None shown closed without being moved to DISCHARGED.
3. **DISCHARGED not discharged?** 51/54 and v5 Bank/deck items remain gone or measured; no resurrection shown.
4. **OPEN treated as accepted?** 22,38,50,52,53 remain OPEN in SPEC, guide marked DRAFT and gated on pages, launch file still OPEN on charter date/lock/collection. No quiet demotion shown.

## Other findings

**LOW-1: SPEC item 50 misstates the lamports-only sweep failure mode.**
Construct: `SPEC.md: REDEEMING / item 50` bullet "A lamports-only sweep needs a destination that exists … a credit below rent exemption to an account that does not exist yet is refused."
Gain: none in funds; false refusal reason, page could mis-plan a non-owner destination.
Evidence if true: System `transfer` to a non-existing account with 1 lamport would fail. On chain it succeeds and creates a 1-lamport System account; no rent check exists on transfer. The page is safe only because it uses the existing owner.
Fix: reword to "the page names the existing owner; a new destination would be left underfunded" or enforce existence check as policy, not as runtime refusal.

**INFO-1: Holder guide timing copy overstates live automation.**
Construct: `HOLDER-GUIDE.md: How you get paid / Things to know` present-tense crank/payout-job lines while `bank/crank.mjs` is installed DRY-RUN and item 22 OPEN.
Gain: holder expects a live job.
Evidence: cron state vs guide wording.
Fix: keep DRAFT gate — do not publish guide before crank live and pages published, as SPEC 50 already requires.

## What AI audit structurally cannot do before launch

Because no human firm will ever see this and the programs become immutable:

1. Run the live dress rehearsal at throwaway ids with real value and record every signature: crank full passes at 2,100 vaults, alarm in rehearsal mode, one full revenue cycle through Orca and one forced through Meteora, one forced post-sweep failure with hand recovery and clean `--audit`, plus DAS `burnt` read. Items 22/53 are OPEN for exactly this.
2. Rebuild `dist/` from the frozen commit on a second machine and compare `SHA256SUMS`; dump each mainnet placeholder/program and check prefix-hash plus zero tail at steps 9-11; ceremony must be run by Gary over the local-tunnel build with SRI/commit compared, collection recorded in both `web/src/config.js` and `launch/mainnet-init.json`.
3. Fund revenue above rent, create pool/revenue/Squads cbBTC ATAs, set charter dates/lock deadline in `launch/mainnet-init.json` and pass `check-launch-params` without OPEN; publish `web/dist`, enable RPC proxy + metadata cron, publish guide only then.
4. Exercise a real Phantom against the staged pages for the dusted-ATA, frozen, C5, grouped-box, late-arrival and rescue paths; confirm the Squads hand-return works and `vault_awaiting_return` clears.