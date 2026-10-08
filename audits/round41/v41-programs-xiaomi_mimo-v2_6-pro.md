# Independent Security Audit — v6 Whole Tree (Round 41)

## R0. Round 40 Verdict Verification

Round 40's confirmed findings (V40-1 through V40-5) and their repairs in `VALIDATION.md` are independently verified: `absentIfDust` in `web/src/lib/decode.mjs` correctly treats System-owned, zero-data accounts as absent; the ceremony's `readStep('atas')` uses it (V40-2); the metadata generator uses it (V40-3); SPEC's discharged item 2 now names the page's remaining refusals (V40-4); the nested-vault note no longer claims who sent the vault (V40-5). The repaired web offline suite is 657/657 and the e2e is 127/127 per the validation log.

**However, V40-1's repair is narrower than the attack it closes.** See Finding 1 below.

---

## Findings

### Finding 1 — MEDIUM — A stranger can permanently block any vault's redemption by creating a non-Token account at its classic reserve ATA address

**Construct:** `web/src/lib/plan-redeem.mjs`, the reserve-account branch of `planRedemption` (around line 108–116); `web/src/lib/reads.mjs` `vaultWalletAccounts` (the reserve-by-address read).

**What an attacker gains:** For each vault that lacks one or more reserve ATAs (most vaults will hold only cbBTC), a stranger sends ~0.0015 SOL (rent for 165 bytes) to the derived classic-ATA address and calls `Token-2022 InitializeAccount3` (or classic `InitializeAccount3` if the address is the T22 derivation) to create a token account of the WRONG token program there. The page reads it as `program: 'token22'` (or `'other'`), and:

```js
else if (acc.program !== 'token' || acc.dataLen !== 165)
  refuse.push(`Your vault's ${name(m)} account is not a classic token account. ...`)
```

This is a **permanent, set-and-forget, stranger-triggered refusal** with no recovery path:
- The ATA program's `create` will not overwrite an existing account.
- The vault's PDA cannot sign to close the stranger's account (the stranger set themselves as close authority).
- No page, helper, or program can remove it.
- The owner cannot open their vault through the page ever again.

**Cost to the attacker:** ~0.0015 SOL per vault address. At 2,100 vaults, ~3.2 SOL blocks the entire collection's page redemptions.

**Contradicts:** HOLDER-GUIDE "On the redeem page that cannot block the opening" (re: stranger deposits); web/README.md "A stranger cannot block an opening"; the page's own invariant "NOTHING here may block an opening" (`plan-redeem.mjs:124`).

**Evidence that would exist:** A stranger's `SystemProgram.createAccount` + `InitializeAccount3` at `ata(vaultPDA, $GIRAFFISH)`. The page then shows "Your vault's $GIRAFFISH account is not a classic token account. This needs a person to look at it." and offers no path. On chain, the account is owned by TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb (Token-2022) with 165+ bytes of data.

**Fix:** Treat a non-Token-program account at an expected reserve-ATA address as ABSENT (same treatment `absentIfDust` gives System-owned zero-data accounts), so the prior-transaction `createAtaIdempotent` is scheduled. The ATA program's create will refuse (address in use), which fails the set-up transaction loudly — the page should then name the account in a loss box ("a stranger created an account at your vault's reserve address; its contents, if any, are lost") rather than refuse the opening. The three reserve tokens are checked on-chain by BURN regardless; the page's reserve-account refusal should be reserved for a real token account of the right program that is frozen, has a foreign close authority, or cannot be parsed.

**Severity rationale:** Not HIGH because the vault is unchanged and a "person" can look at it (the message says so) — but no person can actually fix it without the stranger's cooperation. Not LOW because it is set-and-forget, cheap, scalable, and contradicts an explicit holder-facing promise. This is the same class as round 36 H1 (a set-and-forget stranger block), which was rated HIGH because no one could clear it; here too, no one can clear it.

---

### Finding 2 — LOW — Round 40 gate-5 obligations are not yet closed: seven arms lack reason pins and one test arm is absent

**Construct:** `tests/3prog.test.ts` — R32.A22a, R33.G3, OR.5, R31.W1a, R31.W1b, R28.A2, R35.N8 (no `because()` pin); `bank/selftest.mjs` (no `transferCheckedWithFee` arm).

Round 40's verdict lists these as gate-5 obligations ("Requirements, not findings"). The `because()` pins for the seven on-chain arms are still absent (measured: 0 each). Without them, a negative that fires for the wrong reason would pass silently. The `transferCheckedWithFee` arm in `bank/selftest.mjs` (carried from round 39 W1) is also absent.

**Evidence:** `grep -c "because('R32.A22a'" tests/3prog.test.ts` returns 0 (and likewise for the other six). `grep transferCheckedWithFee bank/selftest.mjs` returns 0.

**Fix:** Add the `because()` pins and the txread arm before item 50 closes. These are required by the ship gate.

---

### Finding 3 — LOW — The redeem page's `canReceive` check does not verify the owner's receiving account is a token account

**Construct:** `web/src/lib/plan-redeem.mjs`, `canReceive`:

```js
const canReceive = a => !s.noPrior || s.ownerAtaExists.has(ownerAta(a.parsed.mint).toBase58())
```

This checks only that the account exists (is in `ownerAtaExists`). The `undeliverable` function earlier checks `ownerAtaFrozen`, which correctly identifies frozen accounts. But if the owner's receiving account exists and is owned by a non-Token program (e.g., a stranger created a System account at the owner's ATA address and the `absentIfDust` fix treats it as absent so the create is scheduled, but then the create lands and the account is fine) — this is actually safe.

The residual gap: `ownerAtaExists` is populated from `isToken(infos[i])`, which requires Token or Token-2022 ownership. So `canReceive` correctly requires a token-owned account. But it does not check `dataLen === 165` for classic delivery. If the owner's receiving account is a Token-2022 account (170 bytes) and the stray is classic, the helper's close would fail. However, the `undeliverable` check does not examine `dataLen` of the receiving account.

**Practical impact:** Minimal — the dry run would catch it. But the dry run is the last gate, and `prepareOpening`'s retry with `dropStrays` would leave the stray behind rather than naming the specific cause. A defense-in-depth check in `canReceive` (verify `dataLen === 165` for helper-delivered strays) would give a clearer error.

**Fix:** In `canReceive`, also require the receiving account's `dataLen === 165` for helper-delivered strays (not C5 transfers, which use a plain `Transfer` that works on either program).

---

## The Four Questions About Accepted Limits

**1. Is any limit WORSE than stated?**

**Limit 9/44 (undeclared holdings destroyed):** The limit says "the redeem page can warn." Finding 1 above shows a stranger can make the page REFUSE rather than warn, which is worse than the stated limit (the page is supposed to warn and proceed, not refuse). The limit's cost is stated as "the holder, to their own property"; Finding 1's cost falls on the holder through a stranger's act, which the limit does not describe.

**Limit 32 (redemption rate limit):** The limit says "an attacker holding vaults can spend an hour's budget only by redeeming those vaults." This is accurate. At 2,100 live vaults the cap is 45/hour; an attacker needs 45 vaults (cost: 45 × floor price) to block one hour. The limit is correctly stated.

**Limit 46 (PoB collection hot key):** The limit says the key can "end the project before it starts or capture all of governance" during the 7-day charter window. This is accurate and complete. After the window, the exposure ends. No understatement found.

All other accepted limits are accurately stated or overstate the risk.

**2. Is any listed limit not actually a limit?**

**Limit 35 (10% turnout never binds at the ruled numbers):** Correct — with quorum 21% and threshold 51%, the minimum passing YES is 10.71% of live supply, above the 10% floor. The limit is real but never binds at the launch parameters. It is correctly listed as a floor for other parameterizations.

No limit is "not actually a limit" or already closed.

**3. Is any DISCHARGED item not actually discharged?**

**Item 51 (the $CBOB boost):** Discharged as "decided and built." The suite section BO (arms BO.1–BO.38) and the Test Vault S7b exercise the full lifecycle. The accepted residue (boost timing, N distributions not N months) is disclosed. Correctly discharged.

**Item 54 (compute at the widest host shapes):** Discharged as "measured." The measurements (114,756 CU per capture, 524,588 for 4 captures, 168,343 for the redemption) are in the suite. The holder-page requirement (set compute-unit limit on crank-carrying transactions) is a requirement of item 50, which is OPEN. Correctly discharged.

All other discharged items are genuinely closed.

**4. Is any OPEN AND BLOCKING item being quietly treated as accepted?**

**Item 22 (nothing has run against a live chain):** Still OPEN. The dress rehearsal has not been run. Not demoted.

**Item 38 (initialize values):** Still OPEN. `launch/mainnet-init.json` has `charter_opens_at`, `lock_deadline`, and `vault_collection` OPEN. `check-launch-params.mjs` refuses them (49/49). Not demoted.

**Item 50 (holder surfaces):** Still OPEN. The pages are built and staged but not published. Not demoted.

**Item 52 (pool and Squads ATAs must exist):** Still OPEN as a launch step. Not demoted.

**Item 53 (dress rehearsal at throwaway IDs):** Still OPEN. The rehearsal tree's proof is of `d57ee3a`, which is stale. Not demoted.

No OPEN item is being treated as accepted.

---

## Anything Else

### R1. Custody — the pairing holds

The SEAL↔BURN pairing (asset at index 0, owner at index 2, discriminators pinned) is sound against:
- CPI wrappers (WR.1–WR.4 measured: stack-height check in `retire_redeemed` and top-level-only sysvar reads in both programs)
- Two vaults in one transaction (each open/burn pair binds its own asset AND owner)
- Cross-asset attacks (open A + burn B refused: `NoTerminalBurn` for A, `NoPrecedingOpen` for B)

The emptiness proof in BURN covers reserve ATAs under both token programs (165-byte exact, no extensions, no delegate, no close authority, amount == 0), PDA lamports == 0, and no declared live Core asset. The `read_token` offsets (mint 0, owner 32, amount 64, state 108, delegate tag 72, close tag 129) are correct for classic SPL.

### R1s. The sweep helper holds

(a) Only the owner can make it move value: Core `ExecuteV1` requires `authority == owner` (measured: SR.5, SR.5a, SR.5c, SR.5d). The helper's own signer check (`signer.is_signer`) is necessary but not sufficient; Core is the gate.

(b) The pair list: duplicate sources are refused (the second source is already closed); a source that is also a destination is refused (`signer.key == dest.key`); a frozen source reverts (SR.14); a C5 account (foreign close authority) reverts the close (R36.C5). Odd account count refused (SR.7).

(c) The destination is chosen by the transaction builder, but Core's ExecuteV1 gate ensures only the owner can call it. The lamport sweep empties the signer to zero.

(d) Nothing can leave the signer non-zero after the sweep within the same transaction: the sweep is the last instruction inside ExecuteV1, and the burn follows in a separate top-level instruction. BURN's `lamports == 0` check sees exactly what the sweep left.

(e) The closed reserve account passes BURN's check because BURN skips accounts no token program owns (`continue` in the reserve loop). A closed account is System-owned with 0 bytes, so it is skipped. Correct.

### R2. The pool's money — the invariant holds

`owed_scaled` tracks exactly the sum of every live vault's `weight * acc + carry - debt`. The suite's `ledger()` function (checked after every money operation in sections IN, 3c, P) proves this. `credit` adds `delta * w` to `owed_scaled`; `claim` subtracts exactly what it pays; `retire` subtracts the unclaimed share. The pool holds at least `ceil(owed_scaled / ACC_SCALE)` at every checkpoint (P.32).

### R2b. The $CBOB boost — exact N distributions

The `boost_expiring` ring (64 slots, max 63 epochs) correctly schedules and unschedules boosts. `unschedule_boost` decrements the right ring slot (indexed by `boost_end_epoch % 64`). `reweigh` preserves the owed share in `carry`. `BoostsExpireFirst` prevents any distribution past a due boost. The host unit tests (260 epochs, 4 wraps) verify the ring against an independent model.

### R3. The level draw — the accepted limits are correctly stated

The C-leader grinding limit (26) and the re-roll limit (25) are accurately described. The FIFO, the reschedule, and the entropy derivation are correct. The `readySlot` function in `plan-get.mjs` assumes no skipped slots for its estimate, but the text says "about N seconds" and the draw fails its dry run if too early. Minor, not a defect.

### R4. Governance — the superseding and the key-change rules hold

`execute_proposal` correctly skips superseded actions per kind (`last_round_id`, `last_guardian_id`, `last_arm_id`, `last_boost_id`). The key-change rule (half of ALL live vaults) is enforced at execute. The `KeyChangesBundled` check prevents a guardian change and operator arm in one proposal. The `StopIsNewer` check matches MINT's `restart`.

### R7. Cross-program raw offsets

All pinned offsets verified against the struct definitions:
- `MintConfig`: `minted_total` at 141, `bare_burns_retired` at 454, `sales_stopped_at` at 518, `sweep_stopped_at` at 526, `sweep_floor` at 631, `cooldown_ceiling` at 639, `reserve_ceiling` at 647, `max_boost_weight` at 711, `max_boost_epochs` at 712. Correct.
- `VaultRecord`: `mint_index` at 41, `pending` at 177, `boost_weight` at 186, `boost_end_epoch` at 187, `carry_scaled` at 195. Correct.
- `BurnConfig`: `burned_total` at 42, `rate_ring` at 59. Correct.
- `SealConfig`: `collection` at 9, `reserve_mints` Vec at 41. Correct.
- All discriminators (`MINT_CONFIG_DISC`, `BURN_CONFIG_DISC`, `SEAL_CONFIG_DISC`, `VAULT_RECORD_DISC`, `IX_BURN_VAULT_DISC`, `IX_OPEN_FOR_REDEMPTION_DISC`, `IX_RETIRE_REDEEMED_DISC`, and the GOV instruction discriminators) match their `sha256("account:...")[..8]` or `sha256("global:...")[..8]` derivations.

### R8. The suite

The suite is well-constructed: 896 assertions behind an exact floor, `because()` pins on most negatives, a `unique` assertion-ID check (ID.1), and both-direction proofs for the detectors. The seven arms lacking `because()` pins (Finding 2) are the known gap. The Test Vault simulation (71 assertions) exercises the full lifecycle against real Core and real mints.

---

## Given That No Human Firm Will Ever See This and the Programs Will Be Immutable

1. **Fix Finding 1 before the freeze.** A stranger blocking every vault's redemption for 3.2 SOL is the kind of defect that immutability makes permanent. The fix is in the page (treat a non-Token account at a reserve-ATA address as absent, and name it in a loss box rather than refusing). This is a web/ change, not a program change, so it does not reset the freeze counter.

2. **Run the dress rehearsal (item 22) before removing the upgrade authority.** The rehearsal is the only exercise of the crank, alarm, and revenue cycle against a live chain at scale. The five named pass/fail items (SPEC item 22) must each produce a transaction signature. Do not skip the revenue cycle through both pools or the hand-recovery walk.

3. **Have a human read the ceremony's step-0 collection-creation flow end to end, on the actual mainnet page, before signing anything.** The ceremony writes values that can never be changed. The page's chain-scan logic (which collection is ours) is complex and has been repaired four times (rounds 37–40). A human pressing the buttons will catch what a test cannot: a confusing prompt, a missing confirmation, a wrong collection adopted.

4. **Verify the deployed bytes against `scripts/build-mainnet.sh`'s sha256 after the upgrade, before `set-upgrade-authority --final`.** The ceremony checks this, but the ceremony is a page; the CLI check (road step 9) is the one that matters. Dump each program, hash the first `len` bytes, confirm zeros after.

5. **Publish the holder guide only after the pages are live (item 50).** The guide speaks of the pages in the present tense. Publishing it before the pages exist is a promise the project cannot keep.

6. **Keep the swap operator wallet empty except for the cycle's funds and the fee float.** Nothing on chain enforces this. An operational instruction, not a code guarantee.

7. **Before locking, run `scripts/check-launch-params.mjs` one final time and have Gary sign the printed output.** The checker validates the JSON, not the signed transaction. Whoever builds the `initialize` transactions must build them FROM the file the checker passed.