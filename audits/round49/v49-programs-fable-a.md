# Round 49, seat fable-a: the five programs and the holder pages

Independent, read-only. Audited commit `617504d5a1ccfcd5805e182d5e7008c22468eb9c`
(HEAD of /opt/cbob-vaults, tree clean apart from `audits/round49/`). No shared
context with any other seat. Written 2026-10-10.

## Verdict

**Nothing in the five programs or the holder pages must change before launch.**
No finding in class (a), (b), (c) or (d). Zero CRITICAL, zero HIGH, zero MEDIUM,
zero LOW. Three INFO notes, all outside the programs and the pages: one sentence
missing from the documents (the compound key-loss bound), one record-wording
error in round 48's VALIDATION.md, and four pair-list cases in R1s(b) that the
suite argues rather than measures.

## What I read and what I ran

Read whole: `programs/cbob-vaults/src/lib.rs` (417 lines),
`programs/cbob-vault-sweep/src/lib.rs` (90), `programs/cbob-vault-burn/src/lib.rs`
(563), `programs/cbob-vault-gov/src/lib.rs` (917), `programs/cbob-vault-mint/src/lib.rs`
(3251), all five `Cargo.toml`, the root `Cargo.toml`, `Anchor.toml`; every file under
`web/src/` (lib, pages, shims, html, generated), `web/build.mjs`, `web/gen-errors.mjs`,
`web/deploy/rpc-proxy.mjs`, `ceremony-local.mjs`, `nginx-rpc.conf`, the PM2 config;
`audits/round48/VERDICT-programs.md` and `VALIDATION.md`; `tests/3prog.test.ts`
(4039 lines), `sim/test-vault.ts` (614), `web/test/e2e-localnet.mjs` (689) and
`.sh`, `web/test/{ix,tx,plan,proxy,get,ceremony}.test.mjs`, `redeem-fixtures.mjs`,
`web/meta/generate.mjs`, `scripts/build-mainnet.sh`, `scripts/run-tests.sh`,
`launch/mainnet-init.json`, `HOLDER-GUIDE.md`, `DESIGN-v6.md`,
`audits/v6-redteam/RT3-stage3c.md`, and the SPEC sections the brief points at
(what a vault is, redeeming, the four programs, the pool, the draw, the Known
limits, the ship gate).

Permitted checks, all run from `/tmp/claude-1000/aud49-fable-a/`, all RC 0:

| check | result |
|---|---|
| `node web/test/run-all.mjs` | **806/806** (= `WEB_FLOOR` 806 in `scripts/run-tests.sh`) |
| `node bank/selftest.mjs` | **1089/1089** (= `DET_FLOOR`) |
| `node scripts/check-launch-params.mjs --selftest` | **69/69** |
| `node bank/accrual.mjs --selftest` | **39/39** |
| `disc.mjs` (one-off) | all 13 pinned Anchor discriminators recomputed from `sha256("global:<ix>")` / `sha256("account:<Struct>")`: match |
| `offsets.mjs` (one-off, `bank/layout.mjs` encode) | every GOV/BURN raw offset into MintConfig, VaultRecord, BurnConfig, SealConfig recomputed from an encoded struct: **ALL OFFSETS AGREE** (detail under R7) |
| `shape.mjs` (one-off, the page's own planner) | plain redemption **1,061 bytes**; with the page's compute-budget pair **1,113 bytes**, 6 instructions; waiting vault claims first; `rateLimit` cap 45 at 2,100 live; ring index arithmetic at a head wrap correct |
| `git diff d2ae5fc HEAD -- programs/ Cargo.toml Cargo.lock Anchor.toml` | empty: the sources at HEAD are the release build's |
| `sha256sum dist/*.so` vs `MAINNET_PROGRAM_BYTES` in `web/src/config.js` | all five equal (36e55599…, e4571484…, 6ff4046a…, 1f4d3a61…, 5c673924…) |

Nothing was run on chain, no validator, no message, no key or env file read.

---

## R0. Round 48's verdict and its repairs

Checked: `VERDICT-programs.md` and `VALIDATION.md` against the tree.

- **V48-1 (waiting vault claims first).** `web/src/lib/plan-redeem.mjs:97`
  `const claim = !!(s.record?.active || s.record?.pending) && !poolFrozen`, with the
  explanatory note at :100. MINT's `claim` (`cbob-vault-mint/src/lib.rs:1675`) skips a
  waiting vault or joins it owing nothing, so the extra claim can never fail the
  opening; `plan.test.mjs` arms at lines 120-128 drive both the claim and the
  frozen-pool exception, and the e2e file carries the two on-chain arms. Holds.
- **V48-3 (README count pinned to WEB_FLOOR).** `run-all` printed 806 and
  `run-tests.sh` pins `WEB_FLOOR=806`. Holds. V48-2 (validator lock) is a runner
  concern outside what I may execute; I read `run-tests.sh` and the selftest's lock
  arms exist.
- **The canonical numbers** (913/913, 1089, 806, e2e 154, sim 71) match the floors in
  `scripts/run-tests.sh` (`MIN_ASSERTIONS 913`, `DET_FLOOR 1089`, `WEB_FLOOR 806`,
  e2e 154, sim 71). I could not re-run the on-chain suite (forbidden); I did read every
  arm it would run.

**INFO-3 (record wording), `audits/round48/VALIDATION.md:75`.** "The five programs
are unchanged since round 27" is not what git says: `git log -- programs/` shows the
programs last changed at `0b3ddb3` (the round-35 commit, which ADDED `rescue_nested`),
with round-34 and round-28 repair commits before it. The substantive claim is true
(HEAD's program sources are byte-identical to the release build `d2ae5fc`, measured
above); the round number is wrong. *Gains:* nothing; a reader dating the last
program change to round 27 would under-count the audit rounds that have read the
current `rescue_nested`. *Class:* none. *Fix:* "unchanged since round 35 (`0b3ddb3`)".

## R1. Custody: the seal, the burn and the pairing

Checked, by reading and by hand-walking the transaction shapes:

- **SEAL `open_for_redemption`** (`cbob-vaults/src/lib.rs:190-270`). Walks top-level
  instructions AFTER the current one (`load_current_index_checked` :226, the `while let
  Ok(ix) = load_instruction_at_checked(i, …)` loop :229) and requires one with
  `program_id == BURN_PROGRAM_ID`, data prefix `IX_BURN_VAULT_DISC` (:88, recomputed
  `[150,115,145,83,24,135,83,99]` = `sha256("global:burn_vault")[..8]`), `accounts[0] ==
  asset`, `accounts[2] == owner`. Fail closed: no match, no thaw. The thaw itself is
  `UpdatePluginV1` (6) on `PermanentFreezeExecute` (17) with `frozen = 0`, signed by the
  `["seal"]` PDA, which is the plugin's authority (`create_vault`, mint lib.rs:2283).
- **BURN `burn_vault`** (`cbob-vault-burn/src/lib.rs:231-445`). Requires a top-level
  `open_for_redemption` for the same asset and owner EARLIER in the transaction
  (:259-270), then the emptiness proof: `asset_signer.lamports() == 0` (:327),
  `remaining_accounts.len() == declared` (:328), every reserve mint's ATA under BOTH
  token programs declared (ATA derivation `[pda, token_program, mint]`), each declared
  token account PDA-owned, undelegated, no close authority, exactly 165 bytes, amount 0,
  a declared account no token program owns skipped, and a Core-owned declared account
  refused if it is an AssetV1. Then Core `BurnV1` (`data [12, 0]`) and the CPI into MINT
  `retire_redeemed`.
- **MINT `retire_redeemed`** (mint lib.rs:1772-1807). `get_stack_height() ==
  TRANSACTION_LEVEL_STACK_HEIGHT + 1` (:1773) AND the top-level instruction at the current
  index is BURN's `burn_vault` (:1776-1780): only a top-level burn may reach it. The asset
  must already read as burned (`is_burned`, :2106: Core-owned, 1 byte, Key 0). The pool
  frozen check (`pool_is_frozen` :2097, by the config's pool address) selects forfeit;
  `monthly_inline` runs AFTER `retire`.

Attacks walked and refused: open without a burn (no match → error); a CPI-wrapped open
(the wrapper's top-level program id is not BURN, and BURN's backward walk finds no
top-level SEAL open → the whole transaction reverts); two vaults in one transaction
(each open binds its own asset at `accounts[0]`); transferring the asset between open
and burn (BURN reads the live Core owner at execution and the open bound `accounts[2]`
to the original owner → mismatch); a burn that fails after the thaw (atomic revert);
a bare `ExecuteV1` while sealed (the frozen `PermanentFreezeExecute` rejects it; arm
3.7); an Execute by a transfer delegate, the collection authority, or SEAL's PDA (arms
SR.5, SR.5a-e). No emptied vault can survive: the thaw exists only inside a transaction
that must end in `BurnV1`.

## R1s. The sweep helper (`cbob-vault-sweep/src/lib.rs`)

(a) **Owner only.** Reached through Core `ExecuteV1`, Core signs as the asset-signer
PDA `["mpl-core-execute", asset]` and admits only the asset's owner (SR.5* measure a
delegate, the collection authority and a stranger). Called directly it needs the
asset-signer's signature (:48; SR.1). While sealed, `ExecuteV1` is refused by the frozen
plugin (3.7), so the helper is unreachable outside a redemption.

(b) **The pair list** (:44-72). `data == [0]` (:45), at least 4 accounts and an even
number of pairs, `signer != dest` (:50), every source exactly 165 bytes and SPL-Token
owned (`read_token`), `src.owner == signer` (:57, `IllegalOwner`), `dest.owner == dest
wallet` and same mint, `Transfer` (3) only when `amount > 0`, then `CloseAccount` (9)
with rent to `dest`. Same source twice: the second read finds a closed account and
refuses (`IllegalOwner`, SR.12a/12b). Source also a destination: impossible (owners
differ by construction). Destination twice: two transfers into one account, fine. A
native wSOL source: 165 bytes, `Transfer` of the token amount then `CloseAccount` sends
the wrapped lamports to `dest` as SOL. A source with a delegate: `Transfer` as owner is
unaffected; `CloseAccount` as owner is unaffected. A source whose close authority is
someone else: the close reverts the whole call (R36.C5; the page routes it through
`Execute(Transfer)` instead, `plan-redeem.mjs:151`). A frozen source holding a
balance: refused (SR.14); holding zero: only closed (limit 44, measured round 30).
Destination not an ATA: allowed if owned by the wallet with the same mint (:58-60).
Zero pairs: lamports-only sweep (SR.13).

(c) **Destination wallet.** Chosen by the builder, never compared with the owner: safe
because only the owner can drive the Execute (a) and the page sets `dest = owner`
(`plan.test.mjs:92`). The lamport transfer is a System transfer to any key; a
destination below rent exemption receives lamports (System has no floor on a transfer
to an existing or non-existent account of 0 data), so it cannot block.

(d) **The lamport sweep** (:75-77) moves `signer.lamports()` read at execution.
Nothing later in the page's transaction deposits to the asset-signer; Core's `BurnV1`
does not touch the asset-signer PDA (it has no account there to close, the PDA is a
System account) and BURN reads `lamports() == 0` at :327 in the same transaction.
A stranger's deposit mid-transaction is impossible (one transaction, one signer set).

(e) **BURN's proof after the sweep.** The closed ATA no longer exists: `lamports 0,
owner System, 0 bytes`; BURN's loop skips an account no token program owns, so the
closed account passes "for the right reason" (the sweep emptied AND closed it; a never-
existing ATA passes the same way, and that is why the PRIOR transaction creates missing
reserve ATAs, `plan-redeem.mjs:112`, so the helper can name them and the burn's
declaration is complete under both programs).

(f) **Fit.** Measured with the page's own planner: 1,061 bytes plain, 1,113 with the
compute-budget pair (`withComputeBudget`, `tx.mjs:101`), 119 bytes under the 1,232
packet; a separate fee payer (+32 +64) still fits. A fourth reserve cannot exist
(`MAX_RESERVE_MINTS = 3` fixed at SEAL initialize). The in-line monthly run rides
`retire_redeemed` on accounts the burn already names (pool_token). Lighthouse additions
are bounded by `judgeWalletEdits` (`tx.mjs:108`, fee cap 0.01 SOL at :80).

(g) **Evidence.** SR.0-SR.5e, SR.12a/b, SR.13, SR.14 and S8.0/S8.1a/S9b/S10 read; the
`because()` pins at `3prog.test.ts:3955` name the refusal reasons (SR.1 missing
signature, SR.2 destination refusal, SR.3 `0xb NonNativeHasBalance`). The sweep crate
has no `localnet` feature (commit `2b67fb1`), so the tested bytes are the shipped bytes;
`dist/cbob_vault_sweep.so` hashes to the config pin.

**INFO-2 (evidence gap, R8 as it bears on R1s(b)).** Four pair-list cases the brief
lists have no arm in `tests/3prog.test.ts`, `sim/test-vault.ts` or
`web/test/e2e-localnet.mjs`: a native wSOL source, a destination named twice, a source
that is also a destination, and a destination wallet that is another vault's
asset-signer. Each is settled by reading (above): the first two succeed harmlessly,
the third is impossible, the fourth is the owner moving their own property to an
address only the other vault's owner can later open. *Gains:* nothing today; the
helper is 90 lines and the reasoning is short. *Class:* none. *Fix:* four arms in the
SR.* block; no program change.

## R2. The community pool

Checked `split_revenue` (:999), `credit` (:1914), `owed_of` (:1942), `reweigh` (:1954),
`join` (:2021), `waiting_to_join` (:2003), `tick`/`advance_epoch`, `monthly_inline`
(:2049), `activate` (:1413), `claim` (:1675), `retire` (:1875), `retire_redeemed`,
`retire_burned` (:1809), `rescue_nested` (:1836), and every counter under every host
ordering.

- **Invariant pool >= ceil(owed).** `credit` adds `floor(avail * SCALE / w)` per unit
  of weight, so `Σ weight × delta <= avail × SCALE`; `owed_scaled` grows by exactly that
  sum, and the pool balance grows by `avail` or more. `claim` pays `floor(owed_of)` and
  raises `debt_scaled` by the same scaled amount; `retire` subtracts the vault's
  remaining `owed_of` from `owed_scaled` (and on forfeit leaves the sats in the pool);
  `reweigh` moves the owed remainder into `carry_scaled` before changing weight, so
  `Σ owed_of == owed_scaled` is preserved across boosts and expiries. `monthly_inline`
  credits only `pool − ceil(owed)` and never from a frozen pool (:2079).
- **Two-step activation and `JoinWaitingFirst`.** `request_epoch` recorded at activate;
  a vault joins only when `dist_epoch > request_epoch`; `distribute` refuses while
  `pending_count − pending_this_epoch > 0`. `pending_this_epoch` resets in
  `advance_epoch`; retiring a pending vault in its own epoch or a later one adjusts the
  right counter (3c arms). No underflow path found.
- **Liveness.** A frozen pool defers claims and forfeits on redemption (3c.F0-F3, P.18,
  BO.37); a bare-burned vault is retired by `retire_burned`; `JoinWaitingFirst` cannot
  be held open because anyone may join an eligible vault with a `claim` naming it.
- **`rescue_nested`** sends only to `config.bank_treasury` and only from a vault's own
  deposit address, a burned asset's wallet or a live CBOB vault's wallet
  (`require_live_vault`, `HostUnresolved`).

## R2b. The $CBOB boost

`boost_vault` (:1474): owner-only, the `cbob_mint` pinned at initialize, burn of
`boost_price`, buyer terms `max_price/min_weight/min_epochs` one-sided
(`BoostTermsMoved`), weight bounded by `max_boost_weight` (12) and epochs by
`max_boost_epochs` (24 ruled, 63 max against the 64-slot `boost_expiring` ring). The
ring entry at `end_epoch % 64` and `boosts_due` are kept consistent by
`unschedule_boost`/`expire_boost`; `claim` expires a due boost before paying (BO.37), so
a boost earns exactly `boost_epochs` distributions and never one more. `expire_boosts`
is bounded at 30 records and skips a non-due or retired record rather than failing.

## R3. The level draw

`capture_entropy` (:1265), `reschedule_reveal` (:1286), `reveal_level` (:1306),
`try_capture` (:2193), `blockhash_in_window` (:235), `crank` (:2165). Reveal slot =
mint slot + 16; A/B/C from three leader groups (stride 2 groups of 4 slots), each the
first PRODUCED slot at or after its target within `MAX_SKIPPED_SLOTS 64`, the 300-slot
window inside SlotHashes' 512; FIFO by `revealed_total` against `mint_index`; a missed
window reschedules to now + 16, never defaults; the census is drawn without replacement
from `level_caps − level_minted`. The host unit tests at :3007-3100 cover the skip
model. Arms L.*, R34.G1b/G4 (worst reveal shapes) read.

## R4. Governance

`create_proposal` (:301): only after `charter_closes_at`, `index_snapshot =
minted_total` with 0-based `mint_index` so `index < snapshot` is exact,
`quorum_supply = live`. `cast_vote` (:418): a live Core asset in the collection,
owned by the signer, one receipt PDA per (proposal, asset). `execute_proposal`
(:446-): voting ended, not executed, 7-day execution window, `cast > 0`, quorum
`ceil(quorum_supply × 2100/10000)`, YES share >= 5100 bps, YES >= `ceil(10%)` of the
snapshot, and `KEY_CHANGE_YES_BPS 5_000` (:211) of the snapshot for a guardian or
swap-operator change, never both in one proposal; per-kind ordering with
`CBOB_ACTION_SKIPPED` (:613). CPI encodings into MINT's governed setters match MINT's
argument order. `TightenSweep` only tighter and only inside the initialize floors
(mint :781-811). `restart` `StopIsNewer` strict `<` mirrors MINT (:909). No minority
path found; SPEC 47's "permanent at low turnout" is exactly what the code does.

## R5. The charter claim

`claim_charter_vault` (:1181): PoB identified by address, leaf `sha256(0x00 || key)`,
node `sha256(0x01 || sorted pair)` (:121-135), root pinned at initialize; the PoB
collection and asset checked for Core identity; `BurnV1` of the PoB as its owner in the
same instruction; `pob_extra` passed through to Core never as signers; the window
`[charter_opens_at, charter_closes_at)` fixed at initialize; not gated by
`sales_stopped` (ruled, limit 48). SPEC 46's statement of what the hot PoB update
authority can do is complete as far as I can see: a plugin on the collection or an
asset can end the claim (frozen PoB refused, external plugin refused by the page) or
narrow the electorate; nothing lets it mint a vault without a leaf in the root.

## R6. The one-time configuration and the trusted hop

Every `initialize` read (SEAL :153, MINT :544, BURN :186, GOV :265): bounds on bps,
caps, windows, `INIT_AUTHORITY` pinned (`Hc6WGt2k…`, localnet `GmaDrpp…` behind the
`localnet` feature only), `cbob_mint` checked as a mint, the royalty plugin created on
the collection with `PluginAuthority::None` (data `[3, 0, bps, 1, revenue, 100, 0, 1,
0]`, confirmed by `checkCollectionAfterMint` in the ceremony page). A wrong-but-accepted
value is what `launch/mainnet-init.json` + `judgeLaunch` (69/69) exist to prevent;
`expectSeal/Mint/Burn/Gov` compare every struct field after each step
(`ceremony.test.mjs:1377-1381`).

**The swap operator** (`sweep_sol_for_swap` :1055-1075): operator must sign (:1060),
`amount <= max_sweep_lamports` (:1061), cooldown (:1062), `revenue >= reserve + amount`
(:1068), refused while `sweep_stopped` (:1058). Worst case per key: the cap every
cooldown of royalty SOL above the reserve, as limit 10 states.

**INFO-1 (documentation), `HOLDER-GUIDE.md:222-223` and SPEC limits 10 and 47.** Both
texts bound a stolen operator key by "until the guardian stops it". The guardian is a
single hot wallet (`Hc6WGt2k…`, also `INIT_AUTHORITY`) and the operator key lives on the
revenue box; a compromise that takes BOTH, or an operator who is the guardian's own
operational environment, is not bounded by that sentence: the thief with the guardian
key never stops the sweep and `cancel_swap_operator` (:856, guardian-only) lets them
cancel every operator replacement a vote arms. What the code then gives the holders:
an ordinary proposal (`TightenSweep`, 21% quorum / 51% / 3 days) caps the leak at the
floors (1 SOL per 24 h above 0.1 SOL), and two successive key-change votes (half of all
live vaults each, 7 days' notice each, the guardian first because only the guardian's
replacement cannot be cancelled) end it. Royalty SOL only; no vault, pool or sale cbBTC
is reachable, as limit 47 says. *Gains:* the honest list under-describes one compound
case. *Class:* none (the code does what the design says; the sentence is incomplete).
*Evidence:* `cancel_swap_operator` is `Guardian`-gated; `apply_guardian` has no cancel;
`tighten_sweep` is an ordinary governed action. *Fix:* one sentence in the guide and in
limit 10: "if the guardian key is lost too, a tighten vote caps the leak at 1 SOL a
day and two key-change votes end it", and, outside the documents, keep the two keys in
different custody (see the closing section).

## R7. Cross-program raw reads

Recomputed by ENCODING the structs with `bank/layout.mjs` and locating each field
(`offsets.mjs`): MintConfig `version@8 governance@41 pool_ata@73 round_id@105
minted_total@141 sales_stopped@191 sweep_stopped@192 guardian@193 swap_operator@225
sol_reserve@257 max_sweep@266 cooldown@274 charter_closes_at@442 bare_burns_retired@454
sales_stopped_at@518 sweep_stopped_at@526 monthly_secs@574 sweep_floor@631
cooldown_ceiling@639 reserve_ceiling@647 cbob_mint@679 max_boost_weight@711
max_boost_epochs@712`, body 1005 (+256 padding = `MINT_CONFIG_SPACE` 1261); VaultRecord
`asset@9 mint_index@41 level@57 active@125 retired@126 pending@177 boost_weight@186
boost_end_epoch@187`, body 211 (+10 = 221); BurnConfig `burned_total@42
redeem_window@50 rate_head@58 rate_ring@59`, body 571 (+256 = 827); SealConfig
`collection@9, reserves vec len@41`. Every one equals the constant in GOV's
`read_mint_config`/`read_burn_total`/`read_vault_index`/`read_stops`, BURN's
`read_mint_supply` and MINT's `check_seal_wiring`/`seal_reserves`. GOV's `Proposal`
space `8 + 8 + (4 + 5×37) + 8+8+8+1+1+8+2+2+8+8 = 259` recomputed. The sweep helper's
`mint@0 owner@32 amount@64 len 165` and BURN's `delegate 72..76, delegated_amount
121..129, close_authority 129..133, state@108` match the SPL Token account layout.
Every read is pinned by the Anchor account discriminator and a layout `version` byte.

## R8. The suite, the simulation and the build as evidence

Read all 4,039 lines of `tests/3prog.test.ts`, all of `sim/test-vault.ts` and
`web/test/e2e-localnet.mjs`. `rec()` compares an expected string with a measured one;
`because()` pins the refusal reason of 50+ negative arms, so a negative firing for a
different reason fails. I found no arm that cannot fail. Claims in the brief with no
arm: the four pair-list cases in INFO-2. The release build `d2ae5fc` ("Deploy and ship
the STRIPPED program bytes") has the same program sources as HEAD, `dist/*.so` hash to
the pins the ceremony page checks (`judgeProgramBytes`, `ceremony.test.mjs:1424-1441`,
including the 20,920-byte placeholder negative), and `web/src/config.js:41` binds
`RELEASE_COMMIT` to it. The sweep helper's tested bytes are the shipped bytes (no
feature flag). The mainnet Core pin (`sha256 51d41542…`) is enforced by `run-tests.sh`.

## The holder pages and the ceremony (priority 2)

- **`planRedemption`** (`plan-redeem.mjs`): refuses only the vault's own reserve
  problems and a non-owner/non-vault/burned/retired asset (:84-121); a frozen reserve
  WITH a balance refuses with the right words (:118) and a frozen EMPTY one is closed by
  the helper (limit 44, measured round 30), so no stranger can block an opening; every
  stray is moved or named (:133-173); `claim` first except on a frozen pool (:97); the
  burn declares all six reserve ATAs (`plan.test.mjs:89`). Account orders in `ix.mjs`
  match every program's `Accounts` struct (checked instruction by instruction).
- **`judgeWalletEdits`** (`tx.mjs:108`): Lighthouse and a bounded compute budget only
  where the page set none; roles unchanged; fee <= 0.01 SOL; `minUnits` from the dry run
  (V47-4). **`withComputeBudget`**: measured × 1.1 + 20,000, 100,000 µL/CU.
- **`checkNewAddress`** (`reads.mjs:45-50`): Core-owned = landed, stranger-funded =
  fresh key; the buy, claim and ceremony pages run it before planning.
- **The ceremony** (`plan-ceremony.mjs`, `ceremony-reads.mjs`, `pages/ceremony.mjs`):
  seven steps in order, `judgeLaunch` refuses the committed file today (charter date
  and collection OPEN), `walletRefusal` admits only the launch key, `resolveCollection`
  never adopts a decoy, every post-step `compare` names every struct field, the royalty
  plugin and the collection's update authority (`MINT_AUTH`) are checked before and
  after MINT, program bytes and the Anchor/sweep probes are checked before any step.
- **The RPC proxy** (`rpc-proxy.mjs`): allowlist equals the methods `web/src` calls
  (asserted by `proxy.test.mjs:639`), `gpaShape`/`tokenListingShape` admit only the
  pages' exact filters and slices, `txRefusal` relays only transactions that call a
  CBOB program, POST + same-origin only, 16 KB body, 8 MB streaming response cap,
  per-/64 rate limits, upstream key never echoed.

Nothing in the pages wrongly refuses or stops a crack that the programs would allow.

---

## The four questions about the accepted limits

1. **Is any limit worse than stated?** Only in wording: limits 10 and 47 each bound one
   stolen key; the compound case (both) is INFO-1. The money bound is unchanged in kind
   (royalty SOL above the reserve, never cbBTC) and the holders have a remedy in code.
   Nothing else is worse than SPEC states; SPEC 46 and 47 read as complete.
2. **Is anything listed as a limit not actually one?** No. Limit 44's "a frozen one
   holding zero is only closed" is confirmed by the page's gate at `plan-redeem.mjs:118`
   refusing only `amount > 0`, so the limit and the page agree.
3. **Is any DISCHARGED item not discharged?** V48-1 and V48-3 verified above; item 33
   (replacement operator lands after notice) is exercised by 3c.K5 and 3c.G2 as the
   brief says. I found no discharged item without its arm.
4. **Is any OPEN AND BLOCKING item quietly treated as accepted?** No. The three OPEN
   launch values (`charter_opens_at`, `lock_deadline`, `vault_collection`) are refused
   by `judgeLaunch` today (`ceremony.test.mjs:1250`), so the ceremony cannot run until
   they are ruled; the page does not proceed around them.

## Anything else

- The frozen-reserve edge I chased (Coinbase freezes an EMPTY vault cbBTC account):
  an active or waiting vault holds >= 21,000 sats by construction (`activate` reads the
  balance, the account is sealed), so the refusal at :118 always fires for a vault owed
  anything; for an unfunded vault the empty frozen account is closed by the helper.
  Not a finding.
- `claim`'s frozen-destination path (`:1722`, `CBOB_CLAIM_DEFERRED_FROZEN`) and the
  forfeit on a frozen pool are the two places value is deliberately deferred or given
  up; both are stated to holders (guide, limit 28) and tested (P.18, 3c.F*, BO.37).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE, what should this project do before launch that AI audit structurally cannot? Be concrete.

1. **Reproduce the build on a machine this box has never touched, and compare the
   on-chain bytes through a second RPC provider, before `--final`.** Everything I
   measured about program bytes was measured on the box that built them, with the
   pins the same tree wrote. A person clones `d2ae5fc` on a clean laptop, runs
   `scripts/build-mainnet.sh`'s verifiable build (or `solana-verify`), fetches each of
   the five program accounts from an RPC that is not our Helius, and compares the
   hashes by hand. Do it after `deploy` and before removing the upgrade authority,
   because that is the last moment a wrong byte can be fixed.
2. **Separate the two keys the design trusts, and rehearse losing them.** The guardian
   (`Hc6WGt2k…`) is Gary's hot wallet and also `INIT_AUTHORITY`; the swap operator key
   lives on the revenue host. A person moves the guardian to a hardware wallet (or a
   2-of-3 Squads: `Option<Pubkey>` admits any signer address) and keeps the operator key
   on a host that does not run the ceremony or hold the guardian. Then, on the rehearsal
   profile with real wall-clock, run the INFO-1 playbook once end to end: tighten vote,
   guardian replacement, operator replacement, apply after notice. Time it. Write the
   timings into the holder guide.
3. **Canary vaults with real money, operated from a phone, before any announcement.**
   Mint two vaults at launch from a consumer wallet (Phantom on a phone, not the box),
   fund one past 21,000 sats of real cbBTC, activate it, wait a real monthly boundary,
   claim, then open BOTH on the live redeem page: one empty, one earning, with a stray
   token airdropped into each first. AI cannot hold funds, press a wallet's approve
   button, or watch what Phantom's simulation screen tells a holder. If the page's words
   and the wallet's words disagree, that is the moment to find out.
4. **Read the four configs back from an independent explorer, by a second person.** The
   ceremony's `compare` is written by the same tree that built the `initialize` data: a
   wrong constant would be checked against itself. A second person opens each config
   account in an explorer and ticks the 20 ruled values in `launch/mainnet-init.json`
   by eye before step 7 and before `--final`.
5. **Live through the clocks.** Cooldowns, 7-day notices, the monthly inline run and the
   charter window are time, and an audit reads time as arithmetic. Let the dress
   rehearsal run across at least one real month boundary and one full notice period
   with no warped clock, and read what the alarm and the crank actually did.
6. **Secure a human channel to Metaplex.** Our five programs will be immutable; Core
   (`CoREENxT6…`), which signs every sweep and executes every burn, is not. The core-watch
   pins its bytes and would page on a change, but only a person can arrange to hear
   about an upgrade BEFORE it lands and judge whether `ExecuteV1`, `BurnV1` or the
   `PermanentFreezeExecute` semantics changed under 2,100 sealed vaults.
7. **Confirm Coinbase's cbBTC freeze policy in writing.** Limit 28 is the one external
   party that can freeze the pool or a vault account. No test can tell you under what
   circumstances Coinbase freezes a Solana address; a person can ask, and the answer
   belongs in the holder guide beside the limit.
