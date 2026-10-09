# Round 45 — Independent Audit Report

## R0. ROUND 44 VERDICT VERIFICATION

I re-read both round-44 verdicts and re-checked every confirmed finding against the tree at `c9a811d`.

**V44-1 (rehearsal ceremony profile/judge):** Repaired. `plan-ceremony.mjs` now imports `judgeRehearsalFile` from `check-launch-params.mjs` and uses it when `P.launchJudge === 'rehearsal-file'`. The `rehearsal` profile in `config.js` now carries `initAuthority: 'GmaDrpp…'` and `squads: null`, with `launchValues: null` (filled by `--launch-json`). The stale comments at `config.js:117-121` and `web/README.md:375` are corrected. Measured: `judgeRehearsal` on the committed `rehearsal-init.json` with REHEARSAL-OPEN keys filled and `lock_deadline` null returns `[]` because the page judge now skips REHEARSAL-NA keys.

**V44-2 (release_gate):** Repaired. The gate now reads the five mainnet IDs from `web/src/config.js` `MAINNET_PROGRAMS` (not literals that the rehearsal substitution rewrites), assembles the release root, and refuses untracked files under `programs/`, `Cargo.toml`, `Cargo.lock`, `Anchor.toml`, `.cargo`, and `**/build.rs`. I verified the python block checks each map entry's left side against `MAINNET_PROGRAMS` and the right side as a 32-byte base58 key.

**V44-3 (coverage gate headline):** Repaired. `first_line_quorate` now accepts `(?:NOT )?(?:LAUNCH-)?CLEAN; QUORUM MET`. Selftest cases include both launch headlines and reject `QUORUM NOT MET`, `LAUNCH-CLEAN for programs`, and `QUORUM LAUNCH-CLEAN`.

**V44-4 through V44-7:** Repaired as INFO items (status vocabulary, limit 59 figure, guide sentence, ceremony absent-collection message).

**Rehearsal driver (`a3cfd79`):** I read `rehearsal-run.mjs`, `rehearsal-steps.mjs`, `rehearsal-recover.mjs`, and `rehearsal-env.mjs`. The guards are sound: `judgeTree` requires `REHEARSAL-RECORD.txt` and a passing release gate; `judgeProgramIds` refuses mainnet IDs; `judgeNoMainnetKeys` refuses mainnet-only keys; `capAllows` enforces `--max-sol`; `nextAction`/`judgeSigs` implement the never-resend rule. `rehearsal-env.mjs` refuses overrides outside a rehearsal tree. The driver deploys, initializes, reads back, runs the ceremony, and closes programs. The local proof at `63bb723` passed.

**Verdict on R0:** All round-44 repairs hold. No regressions found.

---

## R1. CUSTODY (SEAL/BURN pairing)

I re-derived the pairing logic from source.

**SEAL `open_for_redemption`:** Walks instructions from `current+1` forward, looking for `burn_vault` with matching asset (index 0) and owner (index 2). Uses `load_current_index_checked` and `load_instruction_at_checked`, which see only top-level instructions. A CPI-wrapped burn is invisible. Fail-closed: any error in the walk leaves `found = false`.

**BURN `burn_vault`:** Walks instructions from 0 to `current-1`, looking for `open_for_redemption` with matching asset (index 0) and owner (index 2). Same sysvar, same top-level-only semantics.

**Cross-binding:** Both bind asset AND owner. Two vaults in one transaction cannot borrow each other's open/burn. The discriminator constants are asserted against `sha256("global:burn_vault")` and `sha256("global:open_for_redemption")` in the suite (arms 3.1a, 3.1b). The account index constants (`BURN_IX_ASSET_IDX = 0`, `BURN_IX_OWNER_IDX = 2`, `SEAL_IX_ASSET_IDX = 0`, `SEAL_IX_OWNER_IDX = 2`) match the `BurnVault` and `OpenForRedemption` account structs.

**Emptiness proof:** BURN checks `asset_signer.lamports() == 0`, then every reserve mint's ATA under both token programs (declared, PDA-owned, undelegated, extension-free, zero balance), then all declared accounts for live Core assets. The sweep helper closes every account it empties and sends all lamports to the destination.

**No finding.** The pairing is sound. The fail-closed walk, the asset+owner binding, and the top-level-only sysvar reads are correct.

---

## R1s. SWEEP HELPER

I re-read `programs/cbob-vault-sweep/src/lib.rs` line by line.

**(a) Access control:** The helper requires `signer.is_signer`. Called directly, nobody can sign for the asset-signer PDA. Through Core `ExecuteV1`, Core's authority rule (asset owner only, measured in SR.5/SR.5a/SR.5c) is the gate. The helper itself does not check that `dest` is the asset owner — it relies entirely on Core. This is sound today (accepted limit 40 names the Core-upgrade risk).

**(b) Pair list:** Duplicate source: first iteration closes it; second iteration's `read_token` fails with `IllegalOwner` (closed account is System-owned). Source-as-destination: `src_owner == signer.key` and `to_owner == dest.key` would require `signer.key == dest.key`, which is checked. Odd account count: `(accounts.len() - 4) % 2 != 0` refuses. Zero pairs: valid, lamports-only sweep.

**(c) Destination checks:** The helper does not compare `dest` with the asset owner. This is safe because Core's `ExecuteV1` only allows the owner. The lamport sweep uses `system_instruction::transfer`, which fails if `dest` doesn't exist and the amount is below rent exemption (measured R41.C8a-c).

**(d) Lamport sweep:** `signer.lamports()` is read at execution time. All lamports are sent to `dest`. BURN then checks `asset_signer.lamports() == 0`. No instruction between the sweep and the burn can add lamports (same transaction, atomic).

**(e) BURN interaction:** The sweep closes every account it empties (rent to `dest`). BURN's reserve loop finds the closed account: `acc.owner != &SPL_TOKEN_ID && acc.owner != &SPL_TOKEN_2022_ID` → `continue` (skipped). This is correct — a closed account is not a token account.

**(f) Packet size:** S8.0 measures 1,061 bytes for the plain shape. The page adds compute-budget (+52) and separate payer (+96), totaling ~1,209 of 1,232.

**(g) Evidence:** SR.0-SR.4a, SR.5-SR.14, S8.0-S8.3 all pass. The helper is byte-identical in `dist/`, `target/deploy/`, and the localnet build (build-mainnet.sh cmp).

**No finding.** The helper is stateless, ownerless, and correctly bounded.

---

## R2. COMMUNITY POOL

I re-derived the pool invariant.

**`credit`:** `delta = avail * ACC_SCALE / w` (floor). `owed_scaled += delta * w`. Since `delta * w <= avail * ACC_SCALE`, the pool balance increases by `avail` while the required balance increases by at most `avail`. Invariant holds.

**`claim`:** `pay = pending / ACC_SCALE` (floor). `owed_scaled -= pay * ACC_SCALE`. Pool balance decreases by `pay`. Required balance decreases by at least `pay`. Invariant holds.

**`retire`:** `owed_scaled -= pending`. Pool balance unchanged. Required balance decreases. Invariant holds.

**`join`:** `debt_scaled = w * acc_scaled`. `carry_scaled = 0`. No change to `owed_scaled`. Invariant holds.

**`reweigh`:** `carry_scaled = owed`. `debt_scaled = after * acc_scaled`. `owed_of` after reweigh = `after * acc + carry - after * acc = carry = owed`. No change to `owed_scaled`. Invariant holds.

**Two-step activation:** `activate` first call sets `pending = true`, `request_epoch = dist_epoch`. Second call (or `claim`) joins when `dist_epoch > request_epoch`. `JoinWaitingFirst` prevents distribution while eligible vaults wait. `pending_this_epoch` is reset in `advance_epoch`.

**Counters:** `pending_count` tracks all pending. `pending_this_epoch` tracks pending from the current epoch. `waiting_to_join = pending_count - pending_this_epoch`. `retire` decrements both correctly (checking `request_epoch == dist_epoch` for `pending_this_epoch`). `join` decrements `pending_count` but not `pending_this_epoch` (correct, since join requires `dist_epoch > request_epoch`).

**No finding.** The pool arithmetic is sound. The two-step activation and join gate are correct.

---

## R2b. $CBOB BOOST

I re-derived the boost ring arithmetic.

**Ring:** `BOOST_RING = 64`. `max_boost_epochs <= 63`. A boost bought at epoch `e` lasting `n` epochs ends at `e + n`, ring slot `(e + n) % 64`. Two boosts can share a ring slot only if their end epochs differ by a multiple of 64. With `n <= 63`, this requires the second boost to be bought at least 64 epochs after the first. By then, the first boost must have been expired (via `BoostsExpireFirst`), which calls `unschedule_boost` and decrements the ring slot. So no collision.

**`expire_boosts`:** Skips records with `boost_weight == 0` (already expired). `expire_boost` sets `boost_weight = 0` and `boost_end_epoch = 0`. No double-expiry.

**`claim` expiry:** Same guard (`boost_weight > 0 && dist_epoch >= boost_end_epoch`). After expiry, `boost_weight = 0`, so a second iteration skips.

**`unschedule_boost`:** Correctly handles both due (`dist_epoch >= boost_end_epoch` → decrement `boosts_due`) and not-due (decrement `boost_expiring[slot]`) cases.

**`reweigh`:** Preserves owed amount. `carry_scaled = owed`, `debt_scaled = after * acc`. No value lost or gained.

**No finding.** The boost arithmetic is sound.

---

## R3. LEVEL DRAW

I re-derived the entropy capture and draw.

**`blockhash_in_window`:** Parses SlotHashes sysvar (u64 count, then (u64 slot, [u8;32] hash) entries). Bounds count to 512. Finds smallest produced slot in `[want, want + 64]`. Refuses all-zero hashes.

**`try_capture`:** Three hashes, each at least 2 leader groups (8 slots) after the previous. Entropy = `sha256(hA || hB || hC || asset)`. Window is 300 slots. Expired → reschedule.

**`reveal_level`:** FIFO (`index == revealed_total`). Attributes checked against stored hash. Burned vaults still draw (Core update skipped). Census drawn without replacement.

**No finding.** The draw is sound. The accepted limits (25, 26) cover the residual risks.

---

## R4. GOVERNANCE

I re-derived the governance logic.

**Quorum/threshold/turnout:** All checked with ceiling division. Key changes require 50% of snapshot supply. `KeyChangesBundled` prevents guardian+operator bundling.

**Ordering:** Per-kind marks (`last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`). Overtaken actions are skipped and logged, not reverted.

**`restart`/`StopIsNewer`:** GOV skips when `stopped_at >= created_at`. MINT refuses when `stopped_at >= created_at` (i.e., NOT `stopped_at < created_at`). Consistent.

**`tighten_sweep`:** GOV validates tighter-only and within bounds at creation. MINT applies `max`/`min` at execution. Monotone.

**No finding.** The governance is sound.

---

## R5. CHARTER CLAIM

I re-derived the Merkle proof and PoB verification.

**Merkle:** Leaf = `sha256(0x00 || pubkey)`. Node = `sha256(0x01 || min(a,b) || max(a,b))`. Domain separation prevents second-preimage. Sorted pairs prevent ordering attacks.

**PoB verification:** Core asset, owner matches signer, collection matches, Merkle proof valid. PoB burned by CPI in the same instruction. `pob_extra` accounts passed as non-signers.

**No finding.** The charter claim is sound.

---

## R6. INITIALIZE

I re-read all four `initialize` functions.

**Authority check first:** All four check `INIT_AUTHORITY` before any other logic.

**Bounds:** All values are bounded. Charter window: 1s to 90 days, must be in the future. Monthly: 60s to 30 days. Notice: 60s to 30 days. Sweep: cap 1-50 SOL, cooldown 1s-24h, reserve 0 or ≥ rent. Boost: weight 1-12, epochs 1-63.

**Wiring:** MINT checks SEAL config. BURN checks SEAL config. GOV checks MINT config. All check collection match.

**No finding.** The initialization is sound.

---

## R7. CROSS-PROGRAM RAW READS

I re-verified all offsets against the struct definitions.

**MintConfig v6:** version[8], collection[9..41], governance[41..73], pool_ata[73..105], round_id[105..109], opens_at[109..117], closes_at[117..125], price[125..133], cap[133..137], minted_this_round[137..141], minted_total[141..149], max_supply[149..157], bank_treasury[157..189], split_bps[189..191], sales_stopped[191], sweep_stopped[192], guardian[193..225], swap_operator[225..257], sol_reserve_lamports[257..265], bump[265], max_sweep_lamports[266..274], sweep_cooldown_secs[274..282], last_sweep_at[282..290], level_caps[290..310], level_minted[310..330], revealed_total[330..338], payment_mint[338..370], pob_collection[370..402], pob_root[402..434], charter_opens_at[434..442], charter_closes_at[442..450], charter_claimed[450..454], bare_burns_retired[454..462], total_active_weight[462..470], active_count[470..478], acc_scaled[478..494], owed_scaled[494..510], last_distribute_at[510..518], sales_stopped_at[518..526], sweep_stopped_at[526..534], pending_swap_operator[534..566], pending_swap_operator_at[566..574], monthly_secs[574..582], pending_guardian[582..614], pending_guardian_set[614], pending_guardian_at[615..623], notice_secs[623..631], sweep_floor_lamports[631..639], cooldown_ceiling_secs[639..647], reserve_ceiling_lamports[647..655], dist_epoch[655..663], pending_count[663..671], pending_this_epoch[671..679], cbob_mint[679..711], max_boost_weight[711], max_boost_epochs[712..714], boost_price[714..722], boost_weight[722], boost_epochs[723..725], boosts_active[725..729], boosts_due[729..733], boost_weight_total[733..741], cbob_burned_total[741..749], boost_expiring[749..1005]. Total: 8 + 1005 + 256 padding = 1269.

All GOV, BURN, and SEAL offsets match. Discriminators and versions are pinned.

**No finding.** All offsets are correct.

---

## R8. SUITE, SIMULATION, BUILD

I re-read the suite, simulation, and build scripts.

**Suite:** 912 assertions at floor 912. All `because()` pins reference specific error codes. The `ID.1` arm checks all assertion IDs are unique. The `sendV0` helper (round 44 fix) confirms against its own blockhash.

**Simulation:** 71 assertions at floor 71. Uses real Core, real mints, real PoB assets.

**Build:** `build-mainnet.sh` proves mainnet rejects test key, localnet accepts it. Sweep helper byte-identical. `run-tests.sh` has all floors equal to counts.

**No finding.** The evidence is sound.

---

## ACCEPTED LIMITS REVIEW

**1. Is any limit worse than stated?** No. I re-checked limits 9, 25, 26, 27, 28, 32, 40, 41, 42, 43, 44, 46, 47, 48, 49, 55, 56, 57, 58, 59. All are accurately stated.

**2. Is anything listed as a limit not actually a limit?** No. All discharged items are genuinely discharged.

**3. Is any discharged item not actually discharged?** No. All discharged items are measured closed or removed with the thing they were about.

**4. Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 are all genuinely open.

---

## web/ REVIEW

I re-read all page code, the RPC proxy, the metadata generator, and the ceremony.

**Pages:** All use the shared library code (`plan-redeem.mjs`, `plan-get.mjs`, `plan-vault.mjs`, `plan-ceremony.mjs`). All transactions are built by the page and signed by the wallet. `signExact` verifies the wallet didn't modify the transaction.

**RPC proxy:** Method allowlist matches what the pages call. `getProgramAccounts` shapes are pinned. Transaction relay requires at least one CBOB program. Origin check prevents cross-site requests.

**Metadata generator:** Reads from chain state. Fails closed (keeps previous file on error). Never deletes.

**Ceremony:** Step-by-step with read-back. Refuses on wrong values. Handles absent collection (V44-7 fix).

**No finding.** The web code is sound.

---

## FINDINGS

### LOW

**L1: `monthly_inline` calls `waiting_to_join` twice.**
- **File/function:** `programs/cbob-vault-mint/src/lib.rs`, `monthly_inline`
- **What:** The function calls `waiting_to_join(c)?` once for the check and once for the log message. The second call re-reads `pending_count` and `pending_this_epoch` from the config, which is unnecessary.
- **Gain:** None (no security impact, minor inefficiency).
- **Evidence:** Source reading. The two calls are at lines ~1640 and ~1641.
- **Fix:** Store the result of the first call: `let waiting = waiting_to_join(c)?; if waiting > 0 { msg!("… waiting={}", waiting); return Ok(()); }`

**L2: `claim`'s `crank_n` parameter allows values 0-255 but `MAX_CRANK` is 4.**
- **File/function:** `programs/cbob-vault-mint/src/lib.rs`, `claim`
- **What:** `crank_n` is a `u8`, so values 5-255 are representable. The `crank` function checks `accts.len() - 1 <= MAX_CRANK` and fails with `TooManyCranked`. This is a clear error, but the error message doesn't mention `crank_n`.
- **Gain:** None (the error is clear and the transaction fails).
- **Evidence:** Source reading. `MAX_CRANK = 4` at line ~395.
- **Fix:** Optional: add a `require!(crank_n as usize <= MAX_CRANK, MintError::TooManyCranked)` before the crank call for a more specific error.

**L3: `split_revenue` reads revenue ATA balance with only a length check.**
- **File/function:** `programs/cbob-vault-mint/src/lib.rs`, `split_revenue`
- **What:** The balance is read from bytes 64-72 with only `require!(d.len() >= 72, …)`. If the account is not a valid token account, the balance could be garbage. However, the subsequent `TransferChecked` CPI would fail, and the `require_keys_eq!` checks verify the account is the expected ATA.
- **Gain:** None (the transfer would fail, not succeed with wrong amounts).
- **Evidence:** Source reading. The `TransferChecked` instruction validates the account.
- **Fix:** Optional: add `require!(d.len() == TOKEN_ACCOUNT_LEN, …)` for consistency with other token reads.

### INFO

**I1: `rescue_nested`'s host validation discards the specific error.**
- **File/function:** `programs/cbob-vault-mint/src/lib.rs`, `rescue_nested`
- **What:** `require!(require_live_vault(&a.host, &a.config.collection).is_ok(), MintError::HostUnresolved)` discards the specific reason the host is not a live vault. The caller gets `HostUnresolved` regardless.
- **Fix:** Optional: log the specific error for debugging.

**I2: The sweep helper doesn't validate `dest` as a system account.**
- **File/function:** `programs/cbob-vault-sweep/src/lib.rs`, `process`
- **What:** The lamport sweep uses `system_instruction::transfer`, which fails if `dest` doesn't exist and the amount is below rent exemption. The page ensures the destination exists (SPEC item 50).
- **Fix:** None needed (the System program handles this).

**I3: The `reveal_level` function doesn't independently verify the asset is in the collection.**
- **File/function:** `programs/cbob-vault-mint/src/lib.rs`, `reveal_level`
- **What:** The function checks `ctx.accounts.collection.key()` against `ctx.accounts.config.collection`, but doesn't independently verify the asset is in that collection. Core's `UpdatePluginV1` call includes the collection and would fail if the asset is not in it.
- **Fix:** None needed (Core handles this).

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

1. **Run the dress rehearsal on mainnet before removing upgrade authority.** The local proof passed, but items 22.3-22.5 (revenue cycles through real pools, forced failure recovery, DAS read) can only run on mainnet. The rehearsal driver is well-designed, but it has never touched real SOL. Run it.

2. **Verify the deployed bytes match `dist/` after deployment.** The build script proves the bytes are correct, but the deployment step is manual. After `solana program deploy`, dump each program and compare the hash against `dist/SHA256SUMS`. Do this for all five programs.

3. **Read back every config after initialization.** The rehearsal driver does this, but the mainnet initialization is manual. After each `initialize`, read the config account and verify every field against `launch/mainnet-init.json`. Do not proceed to the next program until the read-back matches.

4. **Fund the revenue address above rent exemption before the first royalty.** SPEC item 52. The revenue address starts at 0 lamports. A first royalty smaller than rent exemption would fail. Fund it.

5. **Create the pool and Squads cbBTC accounts before the first split.** SPEC item 52. `split_revenue` needs both. Road step 10 creates them, but verify they exist.

6. **Do not remove the upgrade authority until the dress rehearsal passes.** This is the only undo button. Once removed, every bug is permanent. The rehearsal is the last chance to find issues that only manifest with real SOL, real pools, and real Pyth.

7. **Keep the rehearsal tree and its throwaway keys until the rehearsal is complete.** The driver warns about this, but it bears repeating: refreshing the tree mid-rehearsal destroys throwaway keys holding value.

8. **After removing the upgrade authority, verify all five programs are immutable.** Dump each program's ProgramData and confirm the upgrade authority is `None`. The alarm checks this, but verify it manually.