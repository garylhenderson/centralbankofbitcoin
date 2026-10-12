# Audit report: CBOB ceremony comparison follow-up (R-1 and R-2 closure)

**Source commit:** `/opt/cbob-vaults` is on `refs/heads/v6` at `ed02630e6515896e37119ab933ecf26c989e88be`. That is the only commit after `fc3be765` (reflog line 202: "Keep ceremony verification stable across dust and activity").

**What I read:**
- `scripts/ceremony-compare.mjs` and `scripts/ceremony-compare.test.mjs`
- `scripts/verify-ceremony.mjs`
- `bank/layout.mjs`
- `web/src/lib/decode.mjs`, for `absentIfDust` and the parsers
- The mainnet program IDs in `web/src/config.js:29-31`
- The `payment_mint` and `reserve_mints` fields in `launch/mainnet-init.json`
- `resume-preparation-final.log`

**Limits:** I used only Read, Glob and Grep, and ran nothing. I could not confirm that the working tree is clean. The test log shows `# tests 94 / # pass 94 / # fail 0`, but it does not record which commit it ran against. Its link to `ed02630e` rests only on its timing.

---

## Verdict

- **R-1 is closed.**
- **R-2 is closed for the activity counters.** One mislabel remains when a pinned field changes during operation; it fails closed (see N-1).
- **No blocker in these changes.** Authority, pending-authority and configuration fields stay pinned.
- **Safe to push as a source checkpoint: yes.** That does not approve publication, pins or signing. The delivery, provenance, two-provider preflight and owner gates are still open.

---

## R-1 (a dusted address or unexpected owner): closed

**Dust is treated as absent.** `ceremony-compare.mjs:17-18` calls `absentIfDust` first, and `decode.mjs:29` returns `null` only for an account that is System-owned with zero bytes.
- A stranger sending SOL to `ata(MINT_CFG, cbBTC)` or `ata(REVENUE, cbBTC)` now gives `null` from both providers, with no throw.
- Lamports are never part of the hash (`:38`).
- Test 15 covers all seven kinds.

**Typed parsing only runs when the owner is the expected program:**
- `mint` and `token` require the owner to be `TOKEN_PROGRAM` (`:22-23`).
- `collection` requires the owner to be `expectedOwner`. `verify-ceremony.mjs:86` passes `p.core`.
- The config structs require the owner to be the program named in `PROGRAM_IDS` (`:30`).
- **Any other owner:** the account is hashed as raw bytes together with its owner and executable flag. It is not parsed, so it does not throw, and the difference is still reported. Test 16 covers this.

**The cbBTC accounts are on the classic token program.** `payment_mint` is cbBTC (`mainnet-init.json:19`), cbBTC is listed in `reserve_mints`, and `verify-ceremony.mjs:80` requires every reserve mint to be classic Tokenkeg. So the three `token` slots always reach the masked path, and the amount never causes false failures.

**A malformed account with the expected owner still throws** (test 13). That is correct: only the token program or Core can produce such bytes.

## R-2 (counters changing between reads): closed by masking

`activityFields` (`:8-12`) zeroes these fields after `decode(kind, data)` has checked the discriminator, version, length and booleans (`:31`):

- **MintConfig (20 fields):** `minted_this_round`, `minted_total`, `last_sweep_at`, `level_minted`, `revealed_total`, `charter_claimed`, `bare_burns_retired`, `total_active_weight`, `active_count`, `acc_scaled`, `owed_scaled`, `last_distribute_at`, `dist_epoch`, `pending_count`, `pending_this_epoch`, `boosts_active`, `boosts_due`, `boost_weight_total`, `cbob_burned_total`, `boost_expiring`.
- **BurnConfig:** `burned_total`, `rate_head`, `rate_ring`.
- **GovConfig:** `proposal_count`, `last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`.

**The masked byte ranges are correct:**
- All 28 names exist in `STRUCTS`.
- Every type has an entry in `FIXED` (`layout.mjs:107-108`).
- No variable-length field comes before them, so every one has an offset from `offsets()`.
- A misspelled name would throw on every masking call, so tests 17-19 would catch it.

**The SealConfig and REVENUE slots stay `config` and are hashed in full.** SealConfig has no counters. REVENUE carries no struct, and lamports are excluded from the hash.

**Pinned fields confirmed** (none are in the mask list):
- **MintConfig:**
  - Authorities and accounts: `governance`, `pool_ata`, `bank_treasury`, `guardian`, `swap_operator`.
  - Pending authorities: `pending_guardian`, `pending_guardian_set`, `pending_guardian_at`, `pending_swap_operator`, `pending_swap_operator_at`.
  - Round settings: `round_id`, `opens_at`, `closes_at`, `price`, `cap`, `max_supply`.
  - Revenue split and stop flags: `split_bps`, `sales_stopped`, `sweep_stopped`, `sales_stopped_at`, `sweep_stopped_at`.
  - Sweep and reserve limits: `sol_reserve_lamports`, `max_sweep_lamports`, `sweep_cooldown_secs`, `notice_secs`, `sweep_floor_lamports`, `cooldown_ceiling_secs`, `reserve_ceiling_lamports`, `monthly_secs`.
  - Level caps, charter and mints: `level_caps`, `payment_mint`, `pob_collection`, `pob_root`, `charter_opens_at`, `charter_closes_at`, `cbob_mint`.
  - Boost settings: `max_boost_weight`, `max_boost_epochs`, `boost_price`, `boost_weight`, `boost_epochs`.
  - Also `collection`, `version`, `bump`, the discriminator and any trailing bytes.
- **BurnConfig:** `collection`, `redeem_window_secs`, `version`, `bump`.
- **GovConfig:** `collection`, `quorum_bps`, `threshold_bps`, `min_voting_secs`, `version`, `bump`.

**What the tests show:**
- A difference only in a counter passes.
- A difference fails for `collection` (all three structs) and, in MintConfig, for `guardian`, `pending_guardian`, `pending_swap_operator`, `charter_opens_at`, `charter_closes_at` and `split_bps`.
- A wrong version throws.

---

## Remaining items (none block a source push)

### N-1. LOW: the two reads are still not taken at the same slot, so a change to a pinned field shows up as a provider disagreement
**Where:** `verify-ceremony.mjs:87-89`

Provider B is only required to be at or after provider A's slot. In `--after`, any of these landing between the two reads makes the check fail with "independent setup, collection, mint and funding account agreement":
- a guardian stop (`sales_stopped`, `sales_stopped_at`);
- a guardian or swap-operator proposal (`pending_*`);
- a governance round (`round_id`, `opens_at`, `closes_at`, `price`, `cap`).

It fails closed and a re-run clears it. But it is the same mislabel R-2 described, now limited to rare governance and guardian actions.

**Fix:** retry the pair a bounded number of times until both reads are at the same slot. On a final mismatch at different slots, report "unstable read". Also record both slots in `result`.

### N-2. INFO: masking removes the second provider's check of the counters
After masking, the counters come from provider A alone (`readStep` uses `conn`, `:92`). This only matters if a step verdict depends on a counter value, for example `minted_total == 0` before launch.

**To verify:** I did not read `readStep`, which is outside this scope. Confirm that no step verdict relies on a masked field, or accept in writing that counters are checked against one provider.

### N-3. INFO: some pinned fields are pinned only because they are left off the list, with no test
The code is correct. These fields have no test asserting that a difference fails:
- BurnConfig `redeem_window_secs`;
- GovConfig `quorum_bps`, `threshold_bps` and `min_voting_secs`;
- MintConfig `governance`, `bank_treasury`, `swap_operator`, `pending_guardian_set`, `pending_guardian_at` and `pending_swap_operator_at`.

A future edit that adds one of them to `activityFields` would pass every current test.

**Fix:** loop over the complement of `activityFields` for each struct and assert that a one-byte change in each fails.

### N-4. INFO: masking depends on the program IDs in `layout.mjs`, not the profile
The masking condition (`:30`) checks the owner against the IDs in `layout.mjs`. They match the mainnet profile today (`config.js:29-31`).

If the two ever diverge, masking switches off and R-2's false failures come back. That fails closed, not open. A one-line assertion in `verify-ceremony.mjs` would make the dependency explicit.

### N-5. INFO: run evidence is not bound to the commit
The "94 passed" log does not name the commit it tested.

**Fix:** before the log is used as pin evidence, re-run the suite through the harness that records the commit and a clean working tree, as `pin-review` requires.

---

## Still open, unchanged by this commit
- V2-1: dependency provenance and an independent rebuild.
- Real nginx and owner-browser delivery (V2-7 partial).
- D6 integration with the real backend.
- A live two-provider `--preflight` run, now unblocked by R-1 but not yet run.
- Immutable artifact and pin approval.
- Owner rulings D2, D6, D10 and D13.
- F-1 to F-7 from the earlier triage.
