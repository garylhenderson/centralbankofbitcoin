# Independent Security Audit — CBOB Vaults v6 (frozen tree `425111d`)

## R0 — Round 29/30 verdicts and repairs

Round 30 was **NOT CLEAN** (1 MEDIUM, 1 LOW, 3 INFO) and **QUORUM NOT MET** (5/8 counted). Its confirmed findings and repairs were checked against this tree.

**M1 (scan backlog):** `bank/sigwalk.mjs` carries `startBefore`; the alarm keeps `backlogs[program] = { head, before }` in state and resumes; the drain needs positive proof (`scan_backlog_unproven` on an unproven empty resume). The `scan_gap` page text was corrected. **Holds.**

**L1 (coverage gate):** `scripts/audit-coverage.sh` now compares each tracked file's current git blob against the blob at the frozen HEAD of a completed, quorate round, reading bundles from the audit script at its audited commit. `--prepared` is preflight-only. **Holds.**

**INFO D1/D2/T1:** mainnet record rent (1,772,920), drain time (~209 h) and the build-mainnet banner parenthetical are corrected in SPEC and DESIGN. **Hold.**

No surviving defect from round 30 was found. One **new** MEDIUM and one LOW are filed below.

---

## R1 / R1s — Custody and the sweep helper

The open↔burn pairing is sound against every attack named: CPI wrappers (stack-height + top-level-only sysvar reads in both directions, WR.1–WR.3), two vaults in one transaction (both halves bind asset AND owner at fixed indices 0 and 2), account-index manipulation (pinned constants, suite 3.1c–3.1f), and instruction-sysvar spoofing (address-pinned). A duplicate same-asset pair reverts at the second `open` (Core refuses `UpdatePluginV1` on a tombstone). The emptiness proof's reserve loop correctly refuses delegates (72..76, 121..129, 129..133), extensions (`d.len() == 165`), and non-zero balances.

**Sweep helper:** Core's `ExecuteV1` is the sole access control; only the owner can approve it (SR.5/SR.5a/SR.5b measured). Pair checks cover foreign sources, mismatched mints, duplicate sources (first close makes the second read fail), and `signer == dest`. The lamport sweep empties the PDA; nothing can deposit into it between the sweep and BURN's check within the same atomic transaction. Closed accounts pass BURN's reserve loop (`owner != SPL_TOKEN && != T2022 → continue`). Zero-pair lamports-only sweep works (SR.13). S8.0 (1,061 bytes + 148 for compute-budget pair and separate payer) fits.

**No new custody defect found beyond the MEDIUM below (which is a griefing/DoS, not a theft).**

---

## NEW FINDING — MEDIUM

### F1: The general emptiness loop fails hard on any PDA-owned account longer than 165 bytes, giving any stranger a permanent vault-kill for rent

**Construct:** `programs/cbob-vault-burn/src/lib.rs`, `burn_vault`, the "declared accounts" loop (the second loop over `remaining_accounts`, after the reserve loop):

```rust
if d.len() >= TOKEN_ACCOUNT_LEN {
    ...
    require!(d.len() == TOKEN_ACCOUNT_LEN, BurnError::ReserveHasExtensions);
    ...
    require!(u64::from_le_bytes(amt) == 0, BurnError::VaultNotEmpty);
}
```

**What an attacker gains:** A stranger creates a **Token-2022 token account with any extension** (e.g. `MemoTransfer`, `ImmutableOwner`) owned by the vault's asset-signer PDA and deposits one token into it. Token-2022 accounts with extensions are longer than 165 bytes. The reserve loop **skips** this account (it is not one of the six expected ATAs). The general loop reaches it, finds `owner == pda`, passes `d.len() >= 165`, then **reverts** at `d.len() == 165`. The redemption is permanently refused. The attacker pays only rent (~0.002 SOL) and one token.

**Why this is worse than the accepted limit:** Item 44 covers undeclared holdings being *destroyed*. This is the opposite: an undeclared holding that makes the vault **unredeemable**, with the burn reverting rather than proceeding. The code's own comment acknowledges the inconsistency: *"The reserve loop refuses Token-2022 extensions because a confidential balance reads zero in the base amount field. This loop did not [check extensions], so a NON-reserve T22 token with extensions could pass the emptiness proof holding real value."* The fix (adding the `d.len() == 165` check) closed the "hidden balance passes" hole but opened this one: the reserve loop's correct treatment of an extension-bearing account is **skip** (it is not a reserve), while the general loop's treatment is **revert**.

The redemption page's `judgeRedemptionCoverage` (item 50, unbuilt) would warn before signing, but any other client, or a holder who ignores the warning, loses the vault permanently.

**Evidence if true:** A test that creates a Token-2022 account with `MemoTransfer` extension owned by a vault PDA, deposits a token, and attempts `[open, sweep, burn]` will revert at `ReserveHasExtensions` inside `burn_vault`. The vault remains sealed and live. The same vault redeems cleanly if the account is not created.

**Fix:** In the general loop, change `require!(d.len() == TOKEN_ACCOUNT_LEN, ...)` to `if d.len() != TOKEN_ACCOUNT_LEN { continue; }` — the same treatment the reserve loop gives an account that is not a classic 165-byte token account. The "hidden balance" concern does not apply here: the account is not a reserve, and anything undeclared is accepted as destroyed (item 44). A Token-2022 account with a hidden balance and no extensions (exactly 165 bytes) would still be caught by the amount check.

**Severity: MEDIUM** — griefing/DoS (permanent vault kill), not theft. No value leaves the vault. The attacker pays rent. The owner's funds are sealed, not stolen.

---

## NEW FINDING — LOW

### F2: The sweep helper's source loop does not refuse a source that is also a destination in a later pair (it fails at the read, not at a named check)

**Construct:** `programs/cbob-vault-sweep/src/lib.rs`, `process`, the pair loop.

If a source `A` appears in pair 1 and `A` also appears as the *destination* of pair 2, the first pair closes `A` (transferring its tokens and rent to pair 1's destination). Pair 2 then calls `read_token(A)` which fails (`IllegalOwner`, because the account is now System-owned). The refusal is correct but arrives at the wrong place: the account is gone, and the error is `IllegalOwner` from `read_token`, not a named "source is also a destination" refusal. SR.12a pins the duplicate-source case (same source twice) and SR.12b asserts the refusal reached the second source's owner guard, but no arm pins the source-as-later-destination case.

**Impact:** None for safety (the transaction reverts), but the refusal reason is misleading for debugging, and a future refactor that changes close ordering could silently change behaviour.

**Evidence if true:** A pair list `[[A, B], [C, A]]` (where `A` is the vault's account for mint M, `B` is the wallet's account for M, `C` is another source) will fail at `read_token(A)` in pair 2 with `IllegalOwner`, not with a named "aliasing" error.

**Fix:** Add an explicit `if src.key == to.key` check per pair (already done for `signer == dest`, but not within a pair), or track seen keys across pairs and refuse at the first aliasing. Add a suite arm.

**Severity: LOW** — correct behaviour, wrong refusal reason.

---

## R2 — The community pool's money

The invariant **the pool always holds ≥ ceil(owed)** was verified at every code path:

- `credit`: `avail = balance - ceil(owed)`; `owed += floor(avail × ACC_SCALE / w) × w ≤ avail × ACC_SCALE`; pool decreases by `avail`. Holds.
- `claim`: pays `floor(pending / ACC_SCALE)` from the pool; `owed -= settled`. Holds.
- `retire`: subtracts `pending` from `owed` (forfeit or return); pool unchanged. Strengthens.
- `join`: adds `weight × acc` to `owed`; pool unchanged. `owed` was always ≤ pool before, and the new debt is exactly the vault's share going forward. Holds.
- `reweigh`: moves owed into `carry`; `owed` unchanged. Holds.

`ceil_sats` cannot overflow (`owed_scaled` is bounded by total value × ACC_SCALE, far inside u128). Every arithmetic site uses `checked_*` or `overflow-checks = true`.

`pending_count` / `pending_this_epoch` accounting is correct across `activate` (increment both), `join` (decrement count), `retire` (decrement both if same-epoch), and `advance_epoch` (reset `pending_this_epoch`). `waiting_to_join = pending_count - pending_this_epoch` is exact.

The `JoinWaitingFirst` gate and `BoostsExpireFirst` gate prevent any distribution from running past an unjoined eligible vault or a due boost.

**No pool defect found.**

---

## R2b — The $CBOB boost

The ring buffer does not collide: `MAX_BOOST_EPOCHS_BOUND = 63` and `BOOST_RING = 64`, so two boosts from the same epoch cannot share a slot. Two boosts from different epochs that share a slot are both moved to `boosts_due` when that slot's epoch arrives, and both are actually due at that epoch (their end epochs are congruent mod 64 and within the 63-epoch window). Host test N1 drives 260 epochs (four wraps) with buys, early retires, due retires, and expiries, asserting `ring + due == active` and per-slot counts against a model.

`reweigh` preserves the owed share exactly (`carry = owed; debt = new_weight × acc`). `unschedule_boost` correctly branches between `boosts_due` (already due) and the ring (not yet due). `expire_boost` requires `boost_weight > 0 && dist_epoch >= boost_end_epoch`, and is idempotent via the `AlreadyRetired` check on `retire` and the skip conditions in `claim`/`expire_boosts`.

**No boost defect found.**

---

## R3 — The level draw

The `SlotHashes` parse is defensive (key pin, count bound, buffer length, all-zero hash refused). The draw is `sha256(hA ‖ hB ‖ hC ‖ asset)`, entropy is stored on the record (L.3c re-derives it independently), and the FIFO (`RevealOutOfOrder`) prevents ordering attacks. A burned vault at the head still draws (L.11). The attribute re-supply hash check (`AttributesMismatch`) is sound: `hashv(&[&attributes.try_to_vec()])` at mint equals the same at reveal.

SPEC 26 correctly states that C's leader chooses among many draws. HOLDER-GUIDE says the validator producing the last block "can pick among several results" and "one choice affects every vault created in that moment at once." **Accurate.**

**No draw defect found.**

---

## R4 — Governance

The electorate is frozen at creation (`index_snapshot`, `quorum_supply`). No proposal before charter close (`CharterNotClosed`). Key changes need `⌈50% × snapshot⌉` YES (`KeyChangeNeedsHalf`) and never bundle (`KeyChangesBundled`). `TightenSweep` is monotone and bounded. Overtaken actions are logged skips, not reverts. A guardian change or operator arm is armed and applied after notice. The guardian cannot cancel its own replacement.

**No governance defect found.**

---

## R5 — The charter claim

Identity is by ADDRESS (Merkle root of 240 addresses, domain-separated, sorted pairs). The PoB is CPI-burned as its owner. The window is clock-gated and can never reopen. `pob_extra` accounts are passed through to Core never as signers.

SPEC 46 is complete: it names both the "end the project" and "capture governance" paths, the alarm's per-asset blind spot, the sampling gap, and the positive bound (the key cannot transfer or burn an individual PoB). **Nothing omitted.**

---

## R6 — One-time configuration

Every `initialize` bound was checked against the code and `launch/mainnet-init.json`. SEAL reads only account owners (not that the account is a mint); `scripts/check-launch-params.mjs` pins the ruled three. `redeem_window_secs` accepts 10 s to 24 h; the checker demands 3600. The royalty plugin authority is `None` (R.3/R.6 measured). The redemption cap is a 64-slot ring of timestamps (RATE_RING = 64, `rate_head` cursor, `k = min(cap, 64)`).

**No configuration defect found.**

---

## R7 — Cross-program raw reads

All offsets recomputed from the struct definitions: MintConfig (disc 8, version 8, governance 41, pool_ata 73, minted_total 141, bare_burns_retired 454, charter_closes_at 442, sweep bounds 257/266/274/631/639/647, boost fields 679–749), VaultRecord (disc 8, version 8, asset 9, mint_index 41), BurnConfig (disc 8, version 8, burned_total 42, rate_ring 59). All discriminators match `sha256("account:<Name>")[..8]` or `sha256("global:<name>")[..8]`. Every cross-program read pins address, owner, discriminator, and version.

**No offset defect found.**

---

## R8 — The suite, simulation, and build

The suite's 855 assertions, 71 simulation assertions, and every floor in `run-tests.sh` are present and equal to their counts. `because()` pins every negative to its named error. The `ID.1` uniqueness check prevents a reused assertion id from reading another arm's error. `build-mainnet.sh` proves the four mainnet artifacts reject the test key (each for `NotTheInitAuthority`) and the sweep helper's bytes are identical to the deployed build.

**The suite does NOT exercise the F1 griefing case** (a Token-2022 account with extensions owned by a vault PDA). Add an arm.

---

## The four questions about accepted limits

1. **Is any limit WORSE than stated?** No. Each accepted limit's stated cost matches its measured or read behaviour. The F1 griefing vector is *narrower* than item 44's "undeclared airdrops are destroyed" (it is a DoS, not destruction), but it is a *different* mechanism not covered by item 44's text.

2. **Is anything listed as a limit not actually a limit?** No. Each is real and reachable.

3. **Is any DISCHARGED item not actually discharged?** No. Items 1a–5, 11, 14–16, 18–21, 23–24, 30–31, 33 are gone with the Bank/deck/distributor or measured closed.

4. **Is any item in OPEN AND BLOCKING being quietly treated as accepted?** No. Items 22, 38, 50, 52, 53 remain open and blocking.

---

## Anything else

HOLDER-GUIDE.md describes the deposit-address page, the redeem page's coverage check, the payout offer, and the public posting in the present tense ("the Bank's pages show it", "the redeem page offers this"). Item 50 correctly says the guide "may not be published before this item ships." The guide is marked DRAFT. **No new discrepancy**, but the present-tense phrasing is a publication risk if the DRAFT label is removed before item 50 ships.

---

## Given that no human firm will ever see this and the programs will be immutable, what should this project do before launch that AI audit structurally cannot?

1. **Run the F1 griefing attack on the deployed bytes.** Create a Token-2022 account with `MemoTransfer` (or any extension) owned by a vault PDA, deposit one token, and attempt a full redemption. If it reverts at `ReserveHasExtensions`, fix the general loop (change `require!(d.len() == 165)` to `if d.len() != 165 { continue; }`) and add the arm to the suite. This is a one-line fix today; it is permanent after the lock.

2. **Have a human read the holder guide against the deployed programs, sentence by sentence, before publishing.** AI can check code against spec, but the guide is prose for non-technical holders. A human must verify that "only you can open it" is true for every wallet type, that "nothing can leave while closed" matches the code, and that the honest list names every consequence a buyer needs.

3. **Run the mainnet dress rehearsal (item 22) with real money, not simulated.** The revenue cycle through both venues, the forced post-sweep failure, and the hand recovery must be executed by a human who will be on call at launch. AI can verify the code paths; only a human can verify the runbook works at 3 AM.

4. **Verify the deployed program bytes against `build-mainnet.sh`'s sha256 from an independent machine.** The current proof relies on this box's toolchain. A second build from the same commit on a different machine, producing the same hashes, is the only check that survives a compromised box.

5. **Test the redemption page (once built) against a vault holding a Token-2022 account, a nested Core asset, and a frozen reserve account.** The page's `judgeRedemptionCoverage` is the last line of defence for items 9 and 44. It must be tested against real on-chain state, not synthetic fixtures.

6. **Have Gary sign the charter dates and the lock deadline with his own key, and record the transaction signatures.** These are the last two OPEN values. A wrong charter date is permanent. A human must sign it and verify it landed.