**R1. THE CRITICAL'S FIX — `mint_vault`'s BANK-KEY CONFINEMENT**

**CRITICAL**

**Exact construct:** The exemption logic in `programs/cbob-vault-mint/src/lib.rs:822-837` (the `if is_mint` branch) combined with the discriminator check `ix.program_id == crate::ID && ix.data.len() >= 8 && ix.data[..8] == IX_MINT_VAULT_DISC`.

**What an attacker gains:** They can still force the Bank to pay for their vault mints. By crafting a transaction that contains an instruction whose first 8 bytes of data exactly match `IX_MINT_VAULT_DISC` but is *not* a real `mint_vault` (or is a `mint_vault` with the Bank in the payer slot at index 5), the confinement is bypassed. The Bank signs, the program accepts it as "a mint to this program", and the Bank pays `price_lamports`.

**Evidence that would exist if true:**
- The discriminator is public (`sha256("global:mint_vault")` is known).
- Any instruction whose data starts with `[29,76,246,26,123,202,230,234]` is exempt.
- The `MINT_IX_BANK_IDX` guard (index 4) is only enforced *inside* the `is_mint` branch. An attacker can put the Bank at any other index (especially index 5 = payer) in such an instruction.
- The test added in round 18 (`9d.4`) only tests the *old* payer-theft shape. It does not test a malicious instruction that wears the exact same discriminator.

**Fix:** The exemption must be *exact* on both discriminator *and* account list shape (program, accounts.len(), and exact positions of every signer/writable account). The current "first 8 bytes" exemption is still too wide. This is the same class of defect the round-17 CRITICAL was supposed to fix.

**HIGH**

The `seen_self` guard is insufficient. The loop is `while let Ok(ix) = load_instruction_at_checked(i, &sysvar)`. If the instructions sysvar is malformed or truncated such that an error is returned *after* `current` but before the end of the real transaction, `seen_self` can be true while later instructions are never inspected. The comment acknowledges the previous fail-open but the new guard only proves "we reached ourselves", not "we saw the entire transaction".

**MEDIUM**

The `instructions: UncheckedAccount` was inserted between `revenue` and `seal_config`. While Anchor's `#[account(address = ...)]` should protect it, any other code (including future changes, CPI builders, or the test suite itself) that indexes the `MintVault` context positionally is now broken. The test suite was updated, but this is fragile.

**R2. CADENCE AND WEIGHT REPAIRS (`bank/distribute.mjs`)**

**HIGH**

`holdDays` now throws on bad day keys. The distribution ledger is writable by the distributor key (the same key that runs this job). An operator error, a bad merge, or a compromised distributor key can write a malformed key (`"2026-02-30"`, `"foo"`, etc.) and permanently break the daily payout job. A money job that throws is a money job that stops. The griefing surface is real.

The new `realDay` function is also fragile (relies on `toISOString()` round-tripping in a specific timezone). Evidence: the comment itself admits the first draft of this fix threw a `RangeError`.

**HIGH**

The unlevelled-vault `refusal: true` halt is still present and still catastrophic. Anyone can mint a vault with 21k sats and no level (or with a level not in `LEVEL_WEIGHTS`). This halts *all* payouts until `levels.json` is manually edited. The author's argument that "halting is recoverable, paying without them is permanent overpay" is *wrong* — both are permanent in different ways, and halting on a customer-triggered action is unacceptable DoS. This should be a per-vault skip with loud alerting, not a global refusal.

**MEDIUM**

`detectDistribution` raises `distribution_refused` at HIGH, but the notification path (`notify-gary-sms.sh`) is only called from `main()` on fatal errors or ambiguous transfers. The detector runs in `selftest` and in the watcher, but there is no guarantee a `distribution_refused` finding actually pages a human today. Trace is incomplete.

**R3. `scripts/bank-sign.sh` BASE64 HARDENING**

**HIGH**

The new check is still incomplete.

**Counterexample string that is accepted but decodes differently:**

`SGVsbG8gV29ybGQ=` (valid, decodes to "Hello World")

vs

`SGVsbG8gV29ybGQ=AAAA` (still accepted by the new checks — length is multiple of 4, padding is only at the end in the sense that the `=` appears before non-padding in the regex, but `Buffer.from` ignores the trailing `AAAA` after the valid padding in some Node versions/behaviors).

More critically, non-canonical base64 with incorrect padding bits (e.g. last quantum has non-zero bits after padding) is accepted by `Buffer.from(..., 'base64')` but produces different bytes than strict decoders. The check does not enforce strict base64.

A real 1232-byte tx base64 is 1643-1644 characters — the new check accepts it, so no false rejection there.

**R4. THE GATES ADDED THIS ROUND**

**MEDIUM**

The new regex in `bank/selftest.mjs` for `BankKeyOutside*` errors:

```js
.matchAll(/#\[msg\("[^"]*"\)\]\s*(\w+),/g)
```

This misses any error that uses a different formatting (extra whitespace, `#[msg(...)]` on previous line, doc comments, `#[error(...)]` macro, etc.). It is fragile string scraping.

The "exactly TWO verified rows" ON-CHAIN check is now brittle because two programs must satisfy it. If a third `BankKeyOutside*` error is ever added, the gate breaks.

The signer-set arm still only looks for `fromSecretKey`. `Keypair.fromSeed`, `Keypair.generate`, and several other paths exist in the tree. This was reported in round 17 and not fixed. It is currently untidy rather than directly exploitable, but it means the "we only generate the Bank key in one place" claim is false.

**R5. THE COMMENTS**

Multiple comments in this diff are still wrong or drifted in both directions:

- `cosign.mjs` still has some residual language that understates the on-chain guarantee even after the update.
- `cron-install.sh` and several headers still contain outdated descriptions of the allocator.
- The big comment in `distribute.mjs` about the deleted `allocate()` function is now a museum piece that admits the previous comment was wrong for hours — but the pattern continues.
- Several round-17 fixes are described as fixing defects that the comments themselves previously asserted did *not* exist.

The project is still shipping comments that are materially false the day they are written.

**R6. THE ARITHMETIC**

The published figures are correct. The weights produce exactly the census, denominators, per-$1000, and percentage shares claimed (29.5/24.6/19.7/16.4/9.8 summing to 100.0%). No error here.

**THIRD TARGET: UNDER-CLAIMS (system is stronger than documented)**

**HIGH**

The control table and several comments still under-claim the strength of the Bank key confinement. Even after the on-chain move, multiple documents treat the confinement as weaker than it now is. This is the exact inverse defect the owner caught last round, and it has not been fully purged.

The `seen_self` guard is stronger than the comment claims (it does prevent the previous fail-open), but the comment still frames it as a partial fix.

**KNOWN AND OPEN — WORSE THAN STATED**

Limit 12 (compute units unmeasured) is now worse. The new instruction introspection in `mint_vault` (and the `while` loop in SEAL) adds non-trivial compute on every mint and every redemption. No measurement exists. This is on the hot path.

Limit 3 (Bank may still be named `payer` *inside* the pair) is now partially mitigated on mint but the comment in the code still says the exemption is total.

**VERDICT CHALLENGES / FINAL SECTION**

**GIVEN THAT NO HUMAN FIRM WILL EVER SEE THIS, what should this project do that sixteen rounds of AI audit structurally cannot?**

1. **Institute mandatory "evil twin" testing.** Every new guard must ship with both a positive test (the bad thing is refused) *and* an explicit negative test (the good thing that looks similar is still allowed). The round-18 `9d.4` payer theft test was added, but the negative test for "real mints still work" was insufficiently broad. AI repeatedly misses the "does this break the legitimate case" half.

2. **Require every constant (discriminators, offsets, account indices, magic numbers) to be computed at test time from source truth, never copy-pasted.** The fabricated `IX_MINT_VAULT_DISC` in the first draft of this fix is the canonical example. The suite now does some of this, but not rigorously enough.

3. **Force a human to personally execute every money path end-to-end on a live-like environment before any change that touches distribution, revenue, or redemption is considered "fixed".** AI cannot feel the stakes. The pattern of "the fix for the last round's critical contained the next critical" has now repeated for seven consecutive rounds. Only a human who knows real money is moving will slow down enough.

4. **Add a mandatory "comment freshness" gate** that fails the build if any comment in a changed file is older than the diff itself when it contains words like "does not", "cannot", "refuses", "bounds", etc. The comment drift is now the most reliable source of defects.

The current process is finding real issues but is structurally blind to the *inversion* of its own training (under-claiming strength, fixes that reintroduce the prior bug in a different place, comments that lie in both directions). It needs adversarial human oversight on the output, not just more rounds.