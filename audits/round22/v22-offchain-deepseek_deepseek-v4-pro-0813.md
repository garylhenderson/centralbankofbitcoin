## Findings by target

### R1. THE CRANK (`bank/crank.mjs`)

**R1-1 — MEDIUM: `readySlot()` is too optimistic when the reveal slot is skipped, so the crank plans captures/reveals the program will refuse.**
- Exact construct: `bank/crank.mjs`, `export function readySlot(revealSlot)` and its use in `planCrank()`.
- What happens: MINT’s real draw logic (`try_capture`) takes A as the first *produced* slot at or after `reveal_slot`, then bases B and C on A’s actual slot group. `readySlot()` bases B and C on `reveal_slot` directly. If `reveal_slot` itself was skipped, the real C slot can be later than the predicted one. The crank then puts the vault in `plan.capture` and also in `plan.reveal` via `capturedThisPass`. The `capture_entropy` sent before the third hash exists returns `RevealTooEarly`, and the following `reveal_level` can fail too. Wasted fees and a false crank-failure page.
- Evidence that would exist if true: on a validator with a skipped entropy slot, run `planCrank()` at a slot between the predicted ready slot and the actual third hash slot. It will include `capture`/`reveal`; the transaction logs will contain `RevealTooEarly`/`NeedsReschedule`. The Rust `try_capture` uses actual produced slot groups, while `readySlot` uses `reveal_slot`.
- Fix: do not use a static predictor for reveal ordering. Either call `capture_entropy` as soon as `slot > reveal_slot` and accept `RevealTooEarly` as non-fatal, or mirror `blockhash_in_window`/`try_capture` off-chain by reading the SlotHashes sysvar.

**R1-2 — LOW: a burned, still-unrevealed vault is not retired by the crank.**
- Exact construct: `bank/crank.mjs`, retire loop:
  ```js
  if (!r.retired && assets[r.asset] === 'burned' && r.level !== 0)
  ```
- What happens: `retire_burned` is the on-chain instruction that stops a bare-burned vault counting as live for governance. The program itself does not refuse a level-0 record; `retire()` works for `!r.active && !r.pending`. But the crank skips level-0 burned vaults, so a vault bare-burned before reveal stays counted in `live_supply = minted_total - burn.burned_total - bare_burns_retired` until it is revealed and then retired on a later pass. It is an unnecessary governance-denominator inflation and a way to make votes harder to pass.
- Evidence: mint a vault, bare-burn it before entropy is captured, run the crank; it will not send `retire_burned` for that record. The program would accept the instruction if sent.
- Fix: retire every positively burned vault regardless of `level`, including level 0. `reveal_level` still works for retired records, so this does not stall the reveal FIFO.

---

### R2. THE ALARM (`bank/alarm.mjs`, `bank/detectors.mjs`)

**R2-1 — HIGH: frozen vault cbBTC accounts are excluded from automatic claim batches, so the advertised `claim_deferred_frozen` alarm never fires.**
- Exact construct: `bank/crank.mjs`, `planCrank()` deliver loop:
  ```js
  if (t.frozen) { plan.deferredFrozen.push({ asset: r.asset, owed }); continue; }
  ready.push(...)
  ```
  and `main()` sends only `plan.claims`.
- What happens: the program’s `claim` handles a frozen destination by skipping only that vault, emitting `CBOB_CLAIM_DEFERRED_FROZEN`, and continuing. But the crank removes frozen vaults from the batches before sending, so the log line is never produced by the automatic lane. `detectProgramEvents()` only learns about frozen claims from that log line. Result: a vault can be frozen, owe sats, be skipped forever, and the alarm stays quiet. This is a real worsening of accepted limit 28’s claim that frozen accounts are “logged” and the alarm reports `claim_deferred_frozen`.
- Evidence: active vault with ATA state byte 108 = 2. Run `planCrank()`. `plan.deferredFrozen` has an entry, `plan.claims` does not. Send nothing; no `CBOB_CLAIM_DEFERRED_FROZEN` ever reaches the alarm. The alarm’s balance loop reads the frozen account as a normal balance and does not inspect state.
- Fix: include frozen destinations in `ready` claim batches (the program will skip them without reverting), or add a detector in the alarm that directly reads each vault ATA’s Tokenkeg state byte and pages when `state == 2`.

**R2-2 — CRITICAL: a foreign/system account at a fixed ATA perimeter address can permanently brick activation, the pool, or revenue; the alarm reads this state as quiet.**
- Exact constructs:
  - `programs/cbob-vault-mint/src/lib.rs`, `initialize()` derives `pool_ata` but never creates the token account.
  - `mint_vault()` requires `revenue_token` at the derived revenue ATA and never creates it.
  - `activate()` requires `vault_token` at the derived cbBTC ATA and never creates it.
  - `bank/alarm.mjs`’s balance loop uses `readTokenAccount(info)` and ignores `foreign`/`malformed`; `reconcile()` uses `getTokenAccountsByOwner`, which cannot see system-owned accounts.
- What happens: these addresses are publicly derivable PDAs. Before the correct token account exists, anyone can send 1 lamport to the address, creating a System Program-owned account at that pubkey. Because the address is a PDA, no private key exists to close it. The ATA program cannot replace it. Consequences:
  - A squatter at a vault’s canonical cbBTC ATA makes `activate` permanently fail (`VaultAccountMissing`), so that vault never receives pool distributions.
  - A squatter at the pool ATA or revenue ATA makes `split_revenue` / `mint_vault` / `distribute` permanently fail for the whole system.
- Evidence: derive `pool_ata = ATA(payment_mint, config_pda)`, `revenue_ata = ATA(payment_mint, revenue_pda)`, and any `vault_ata = ATA(payment_mint, asset_signer_pda)`. Send a `SystemProgram.transfer` that creates one of these accounts before the correct token account exists. The account owner is `11111111111111111111111111111111`. The next `activate`/`split_revenue`/`mint_vault` fails. In the alarm, `readTokenAccount` returns `{state:'foreign', amount:0n}` and no finding is pushed; the balance loop stores zero. `reconcile`’s `getTokenAccountsByOwner` does not return the squatting account.
- Fix: at minimum, launch must atomically create pool and revenue ATAs in the same transaction as `initialize` (not “derive” only), and the vault activation design must not rely on a fixed public ATA that can be squatted. Prefer changing `activate` to create and record a fresh token account within the same instruction, whose address is not knowable before activation.

**R2-3 — MEDIUM: the production `test_value_in_production` check omits several immutable launch values.**
- Exact construct: `bank/detectors.mjs`, `detectStandingRisks()` `opts.production` `want` list.
- What happens: the list checks the 30-day month, one-hour redemption window, 7-day notice, tightening bounds, quorum, threshold, and voting period. It does not check `mint.max_supply` (2,100), `mint.level_caps` (945/525/315/210/105), `mint.payment_mint`, `mint.bank_treasury`, `seal.reserve_mints`, or `mint.pob_root`. If `initialize` were ever run with a wrong one of these and the pre-launch script did not catch it, the alarm would adopt it as baseline and never page `test_value_in_production`.
- Evidence: set `mint.max_supply = 21000` in a synthetic snapshot; `detectStandingRisks(..., {production:true})` returns no `test_value_in_production` for it. The same is true for `level_caps`.
- Fix: extend the production assertion table to include every SPEC item 38 ruled fixed value, and share the table with `scripts/check-launch-params.mjs` rather than maintaining two lists.

---

### R3 / R6. LAYOUTS AND GATES

**R3-1 — HIGH: `missingWatchedKeys()` explicitly exempts all `prog.*` keys, so the gate protecting program upgrade-authority/hash reads cannot fail.**
- Exact construct: `bank/detectors.mjs`, `missingWatchedKeys()`:
  ```js
  let prog = k.split('.')[0]
  if (prog === 'prog') return false
  ```
- What happens: `WATCHED_KEYS` contains `prog.seal.upgrade_authority`, `prog.mint.hash`, etc. If `readConfigs()` drops the ProgramData loop that populates these, or only populates some, `missingWatchedKeys()` still returns `[]` for all `prog.*` keys. `detectConfigDrift()` then compares absent keys as `null -> null` and stays quiet. The single most important immutability watch can be unwired silently and the build remains green.
- Evidence: remove `prog.mint.upgrade_authority` and `prog.mint.hash` from an otherwise complete snapshot; `missingWatchedKeys(snapshot)` will not report them. The selftest’s “QUIET when the reader produces every watched key” also passes because all `prog.*` entries are ignored.
- Fix: remove the `prog === 'prog'` exemption. Require each program hash/authority key to be produced, or require the corresponding `prog.<p>._missing` flag before treating absence as normal.

---

### R4. MONEY ARITHMETIC

No divergence found between `bank/accrual.mjs` and the supplied `credit`, `claim`, `retire`, `ceil_sats`, and `join` formulas in the normal operating range. The earlier `readySlot` issue is off-chain planning, not the core payout arithmetic.

---

### R5. SWAP HOP

No new finding beyond accepted limit 10. The on-chain sweep is cap-and-cooldown bounded and the ledger predicates (`cycleIsOpen`, `detectUnledgeredSweeps`, `detectSplitClaims`) distinguish a rejected sweep from an open one. The worst case remains the accepted cap-times-window exposure; the swap transaction inspection is heuristic but the operator wallet is itself the trusted hop.

---

## The four questions about the accepted limits

1. **Is any limit WORSE than stated?**
   - Limit 28 is worse operationally than stated: the text says frozen vault accounts are “logged” and the alarm reports `claim_deferred_frozen`, but the primary automatic lane deliberately excludes frozen accounts from `claim` batches, so the log/alarm never occurs. There is also no direct alarm read of vault ATA frozen state outside that log.

2. **Is anything listed as a limit not actually a limit?**
   - Limit 35 is effectively not a binding limit at the ruled numbers, exactly as the carry list already says. I saw no other listed “limit” that is fully closed in practice beyond those already documented.

3. **Is any DISCHARGED item not actually discharged?**
   - Discharged item 20 (“poisoned ATA silently removed one holder”) is not fully discharged in v6. The old distributor halt is gone, but a squatted/foreign account at a vault’s canonical cbBTC ATA still permanently excludes that holder from activation, and the alarm does not page it. The mechanism changed; the “poisoned ATA” class survived in a new place.

4. **Is any OPEN AND BLOCKING item being quietly treated as accepted?**
   - I did not find a case where an `OPEN AND BLOCKING` item was silently reclassified as accepted in the documents. Item 50 is still labelled open. However, item 50’s missing redeem page interacts with accepted limits 9/44: there is no pre-signature coverage check, which is already acknowledged.

---

## GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS AND THE PROGRAMS WILL BE IMMUTABLE

Concrete steps the project should take before launch that AI audit structurally cannot:

1. **Run the crank `--live` against a throwaway mainnet-like deployment with real RPC paging, rate limits, skipped slots, and 2,100 test vaults.** AI reasoning cannot reproduce Helius pagination, transient `getProgramAccounts` gaps, or the timing of the every-minute reveal lane under real chain conditions.

2. **Fault-injection pass for the off-chain readers.** Simulate missing/foreign/malformed token accounts, a frozen vault ATA, a frozen pool, a missing ledger, an expired ack file, and a squatted ATA address. Confirm every one either lands a transaction that produces the expected program log or raises an alarm.

3. **Add an automated canary for fixed ATA addresses.** Watch pool ATA, revenue ATA, and every known vault ATA before creation. If any address becomes a non-Tokenkeg account, page immediately. This catches the ATA-squatting class before it becomes permanent.

4. **Change the launch transaction to create pool and revenue ATAs atomically with `initialize`.** Deriving an address is not creating an account. Then prove the launched accounts are Tokenkeg-owned cbBTC accounts by simulation before the lock deadline.

5. **Re-test the frozen-vault path with a real claim transaction, not just program logic.** Put a frozen vault ATA inside a claim batch and verify that `CBOB_CLAIM_DEFERRED_FROZEN` reaches the alarm.

6. **Make `readySlot()` exact or remove it.** It is a pure function; test it in both directions against a validator with deliberately skipped entropy slots, because mainnet will skip slots.

7. **After the upgrade authority is removed, verify immutability from multiple independent RPCs and record the transaction signature.** This is a measurement AI audit cannot perform, and since it is permanent, it needs a recorded, externally visible proof.