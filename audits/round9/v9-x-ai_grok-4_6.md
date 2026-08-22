## FINDINGS

### 1. HIGH — `mint.pending_bank` is watched and never read
**Where:** `bank/alarm.mjs` `readConfigs` mint field list vs `detectStandingRisks` / `detectConfigDrift` (`mint.pending_bank`).

Round 8 added every pending-rotation slot to the standing CRITICAL list. SEAL (variable offset after the Vec), BURN (`106`), GOV (`102`), and MINT admin/governance are populated. MINT’s Bank slot is not. Layout after the round-7 appends: `pending_admin_at` @ 401, **`pending_bank` @ 409**, `pending_bank_at` @ 441. Those two offsets are absent from the mint `g(...)` call.

`detectStandingRisks` does `if (v && v !== DEFAULT_PUBKEY)`. `undefined` is falsy. Drift compares `undefined` to `undefined`.

**Exploit:** Admin calls `update_wiring(bank: attacker)`. On-chain the notice period starts. Every 30-minute pass stays quiet. Apply is permissionless. After `governance_timelock_secs` anyone lands `apply_pending_bank`; the mint co-signer is now the attacker. The control that was supposed to make the wait useful does not run.

Same class as `collection.hash` on the watch list with no writer.

**Fix:** Read `['pending_bank', 409, 'pk']` and `['pending_bank_at', 441, 'i64']`. Add a selftest that a synthetic snap *without* the key fails the standing check (the detector is proven; the wiring is not).

### 2. HIGH — `apply_pending_admin` silently deletes a waiting Bank rotation
**Where:** `cbob_vault_mint::apply_pending_admin`.

```rust
c.admin = c.pending_admin;
c.pending_admin = Pubkey::default();
c.pending_admin_at = 0;
c.pending_bank = Pubkey::default();
c.pending_bank_at = 0;
```

SEAL/BURN `apply_pending` apply *both* if due. MINT `apply_pending_governance` does not touch the other slots. Only admin-apply wipes the Bank. No `BankRotationCancelled` event.

**Exploit:** Honest admin, one `update_wiring`, arms replacement Bank *and* a planned admin handoff (same `governance_timelock_secs`, same `effective_at`). Anyone calls `apply_pending_admin` first. Bank rotation is gone; compromised `config.bank` remains. Combined with (1) the alarm never saw the Bank arm and will not see this cancel.

**Fix:** Do not clear `pending_bank` here. If a new admin must re-approve a Bank pick, emit a cancel event and make that path explicit.

### 3. HIGH — `detectSplitClaims` + `seenSplits.slice(-200)` will CRITICAL every completed cycle
**Where:** `alarm.mjs` state write; `detectSplitClaims` walks the entire revenue ledger.

`seenSplits` is only signatures whose txs contained `split_revenue`, then `.slice(-200)`. The ledger is append-only. Cron is `41 */6` → 4 cycles/day. After ~50 days the oldest `splitSig` falls out of the window. Next pass: `split_not_on_chain` CRITICAL on a cycle that did split. It never heals; the window keeps sliding.

Round 8 added the detector. The selftest feeds a full `seen` set and never exercises the 200-cap. Same shape as `detectIndexShortfall`: detector proven, wiring untested.

**Fix:** Persist every split sig you have ever accepted, or only examine cycles newer than `grace + 2 * interval`, or stop slicing.

### 4. HIGH — burned-mid-run skips are permanent `distribution_unresolved`
**Where:** `distribute.mjs` (`skipped: 'vault is no longer a live Core asset'`, `sig: null`); `detectDistribution` (`rows.filter(([, r]) => !r.sig)`).

Round 8 correctly stopped paying a vault burned between plan and payout. The row is `sig: null` with `skipped` set. Resume honours `skipped`. The detector does not. One expected Core burn during a 2,100-vault run makes the 30-minute alarm CRITICAL forever.

**Fix:** Treat `r.skipped` as resolved. Selftest a skipped row both ways.

---

## COULD NOT BREAK

- **Double vote:** `VoteRecord` seeds `["vote", proposal, asset]`; transfer-then-vote hits `init` on an existing PDA. Delegate is not owner. Burned / non-AssetV1 / wrong collection fail `read_core_asset`.
- **Mint-to-quorum:** `divisor = max(snapshot, live minted_total)` only rises; a new vault is a vote *and* bar. Bank still co-signs every mint.
- **Execute replay / older-after-newer:** `executed`, `last_executed_id`, `EXECUTION_WINDOW_SECS`, `RoundAlreadyOver`. CPI `set_round` is the only effect; `max_supply` and `cap > 0` / one-year window stay in MINT.
- **`split_revenue` dest pin:** ATAs derived from `["revenue"]`, `config.treasury`, `config.bank_treasury`. Bank share floored; amounts sum to `total`. Hostile mint is the stated design.
- **`sweep_sol_for_swap` pin:** dest is `config.swap_operator` and a `Signer`; cap + `MIN_SWEEP_COOLDOWN_SECS = 1` + reserve (0 or ≥ rent) on-chain.
- **Royalties redirect:** one creator, 100%, `["revenue"]` PDA; `basis_points <= 1000`.
- **`revenue.mjs` `isSigner: false` on the operator:** fee-payer coalescing makes the operator a signer anyway. Would only break if the fee payer changed.
- **SEAL open/close pairing, inspect_reserves, lifetime cap, ledger `.has-run`, index unique-count, Core pin `f03e7537…`.**

---

## THE SINGLE THING

Read `mint.pending_bank` @ 409 in `readConfigs`, and stop `apply_pending_admin` from erasing it. That is the mint 2-of-2 co-signer: the alarm promised to scream for the whole notice period, and the apply path can delete the rotation without a trace.