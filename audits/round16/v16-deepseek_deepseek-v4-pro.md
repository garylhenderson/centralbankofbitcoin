# Round 16 Audit Findings

## R1: THE CO-SIGNER'S NEW REFUSALS

### CRITICAL — Arm 1 can be bypassed via CPI with the Bank as an unlisted signer

`judgeRedemptionTx` controls the Bank's pubkey presence in instruction account lists, and the author states "presence is the whole test." An instruction calling an allowed program (e.g., System) via CPI can invoke the Bank's authority as a signer *without listing the Bank in the instruction's `accounts` array. The Bank's signature covers the whole transaction, including the inner instruction's message, so a CPI that moves the Bank's lamports or delegates its authority would be authorized by the Bank's signature without `judgeRedemptionTx` detecting it.

**Evidence**: The instruction introspection in the co-signer only checks top-level instruction key lists, not CPI depth or sysvar queries. A test transaction that calls System via CPI with the Bank signing and no Bank key listed would be blessed by `judgeRedemptionTx`.

**Fix**: The co-signer must reject any transaction where any instruction's CPI depth > 0, or must parse nested instructions; or state that CPI-rich transactions are a known, refused class.

### HIGH — ComputeBudget `SetComputeUnitLimit` can inflate fees to drain the Bank

The allowlist permits `ComputeBudget` instructions (ComputeBudget111111111111111111111111111111). While intended for setting priority fees, `SetComputeUnitLimit` with an absurdly high CU limit multiplies the cost. Combined with a priority fee instruction, a customer can drain significant SOL from the Bank as the fee payer. The co-signer blocks the Bank as fee payer, but (a) the guard relies on `cfg.feePayer` being set correctly, and (b) if the Bank IS fee payer, the combined cost of max CU + high priority fee may not be fully tested.

**Evidence**: The probe transaction for fee payer was a simple system transfer; test a max CU + high priority fee snapshot against the Bank's balance on a validator.

**Fix**: Cap the CU limit or reject explicit `SetComputeUnitLimit` instructions when the Bank is not payer, or always when present.

### MEDIUM — `classifyPdaTokenAccount` 165-byte test misidentifies SPL Token-2022 accounts with precisely 165 bytes

The test `dataLen !== 165` classifies accounts as undeclarable. Some SPL Token accounts (classic) are 165 bytes, but it is possible for a Token-2022 account to be initialized without extensions and also be 165 bytes. If such an account has a non-zero balance, it would be treated as a normal "must declare" account by this classifier (because `dataLen === 165`), but BURN would refuse it because its owner is `TokenzQd...` and it would have an `ImmutableOwner` extension. The co-signer would call it declarable while `burn_vault` would reject it, creating a false-positive "clean" co-sign.

**Evidence**: Create a Token-2022 mint, fund an empty ATA for the vault PDA with zero balance, and measure its data length on a validator. If exactly 165, the classifier misreads it.

**Fix**: Check the owner of the token account (classic vs Token-2022 program) before the 165-byte test, not just the length.

---

## R2: LOCK AND FLOCK

### CRITICAL — `flock -n` is NOT atomic for the cron's compound command

The cron wraps `cd $R && $FLOCK $LOCKDIR/distribute.flock /usr/bin/node bank/distribute.mjs`. `flock -n` locks the lock file and execs node. If the lock is held, it exits 1. However, the `cd $R &&` part runs *before* the flock, so a second cron that fires while an earlier one is still doing `cd $R &&` before the flock lock check will still step on the ledger read. The `cd` is benign, but any overlap in the initial seconds is unguarded.

**Evidence**: Launch two simultaneous cron-simulated distribute calls; measure whether one reads the ledger while the other is still loading it.

**Fix**: Move `flock` to the outermost wrapper: `flock -n $LOCKDIR/distribute.flock -c 'cd $R && /usr/bin/node bank/distribute.mjs ...'`

### MEDIUM — `judgeCronTemplate` gates the TEMPLATE, not the installed crontab

As the author notes, the check reads `scripts/cron-install.sh`, not the output of `crontab -l`. An operator who manually edits the crontab (e.g., to add `--live` to revenue or temporarily comment a line) is not caught. The assertion adds no runtime safety.

**Evidence**: Edit crontab, run selftest; `judgeCronTemplate` still passes against the now-stale template.

**Fix**: At minimum, add a check in the alarm itself that greps the live crontab for `flock` on every pass.

---

## R3: ACK ALLOWLIST

### LOW — ACK refusal path can be flooded

A hostile operator or compromised `acks.json` can create thousands of refused-ack entries for non-ackable kinds, generating a flood of CRITICAL-severity "WAS REFUSED" lines that bury real findings. The author already reports the refusal, but an attacker who controls the ack file can use it as a noise generator.

**Evidence**: Feed 10,000 acks for `vault_burned` into `applyAcks` and measure output.

**Fix**: Limit the number of refused acks reported per pass to a cap (e.g., 5), with a summary count.

---

## R4: ROUND 16'S OWN REPAIRS

### MEDIUM — `readProgramData` ELF offset for `Option` tag is byte 12, but Anchor discriminator is 8 bytes

The `readProgramData` function expects the `Option` authority at `data[12]` (after an implied 12-byte header). ProgramData accounts have: 4 bytes enum (3), 8 bytes slot (*round 6 comment says `[0..4] enum=3, [4..12] slot`*, which contradicts the `[4..12]` in the comment — is it 8 or 12?). The enum should be 4 bytes, slot 8 bytes, total 12, so `data[12]` IS the Option tag. This is correct. However, the comment `[4..12] slot` implies an 8-byte slot, so 12 is right. Verified: no bug.

### MEDIUM — `banks_disagree` can fire transiently during a coordinated rotation

The check fires `CRITICAL` when `distinctBanks.size > 1` and `banks.length > 1`. If SEAL's `apply_pending_bank` is called before BURN's, a transient window opens where they disagree but will be fixed moments later. The alarm could page a human for a planned operation that resolves itself.

**Evidence**: Simulate a staged rotation sequence on a validator; watch the alarm's output.

**Fix**: Gate the finding on the pending values *not* being set to the new Bank in both programs, i.e., distinguish "one program has already applied" from "operational divergence".

---

## R5: COMMENTS

### MEDIUM — `bank/cosign.mjs` header says "the newest key-holder... did not [check mode]" but the check is now present

The comment about the mode check not being present in `cosign.mjs` is now stale (it WAS added). The comment describes a now-fixed defect as if it's still current. This is a drift in the opposite direction (claiming a defect that no longer exists), which the author calls out as the same class. It may mislead future readers.

**Evidence**: Compare cosign.mjs header to code.

**Fix**: Update the comment to reflect the current state.

---

## R6: GATES

### HIGH — Regex-based cross-file assertion `if (s.err) continue` will quietly pass when `alarm.mjs` is minified/transpiled

The selftest asserts `if \(s\.err\) continue` inside `bank/alarm.mjs`. If the source file is formatted differently in future (e.g., spaces, line breaks, minification), the regex will fail silently and the selftest will report "still skips" as `false`, but the *assertion* might be misread. More critically, the test `alarmSrc.replace(...)` to show it can detect absence is a tautology: it shows the regex CAN match, but not that the current file could ever drift in a way the regex misses.

**Evidence**: Manually break `if (s.err) continue` across two lines; the regex fails.

**Fix**: Parse the AST or use a more robust structural check.

### MEDIUM — The "exactly one file reads Bank key" check uses a regex that can be fooled by variable naming

The check assembles `CBOB_BANK_KEY` and `keys/bank.json` into a regex. If a new file reads `process.env['CBOB_BANK_KEY']` or uses a path join, the regex won't match, and the assertion might miss a second reader.

**Evidence**: Add a file that reads the key via a template string or variable; test fails.

**Fix**: Search for the actual PublicKey value of the Bank key in all files, or use a static analysis tool.

---

## CARRY-OVER LIST

### Item 1 (co-signer wiring) — WORSE THAN STATED

The co-signer is not only unwired, but the assertion that "exactly one file reads the Bank key" (added to catch a second signer) is defeated by the fact that `cosign.mjs` itself currently doesn't read the key for signing unless `--live` is passed with `--tx`. A separate signer could simply not read the same key file (it could use a different env var or hardcoded key) and the assertion would miss it. The check is for *readers of this specific key file*, not for *any actor that signs with the Bank key*.

**Evidence**: Write a script that signs with a hardcoded Bank key and never touches `keys/bank.json`; the assertion passes.

**Fix**: The assertion should check for *any key material* matching the Bank's on-chain address, not just the file path.

---

## VERDICT CHALLENGES

### REJECTED: "the co-signer never checks the vault's collection or its on-chain owner"

The author's reason is that SEAL and BURN refuse on chain. **This is incomplete.** A Bank signature on a *reverting* transaction is worthless on-chain, but **the signature itself can be collected and replayed or used as social proof**. If an attacker obtains the Bank's signature on a transaction that *attempts* to redeem a foreign asset, they could publish the signed transaction as evidence of "auditor-approved vault status" or "co-signed by the Bank" to mislead buyers. The signature is a cryptographic artifact, not proof of successful execution.

**Evidence**: Sign a foreign-asset redemption with cosign.mjs; the signature is valid on the message even if execution reverts.

**Fix**: The co-signer MUST verify the asset is in the CBOB collection and owned by the claimed owner before signing, to ensure the signature only covers legitimate assets.

---

## STRUCTURAL RECOMMENDATION

Given that no human firm will verify this system, the project should:

1. **Deploy to testnet with real economic incentives for hackers to break it before mainnet.** AI audit cannot simulate human adversarial creativity or market-driven exploitation. A bug bounty on testnet with real cbBTC would expose failure modes that sixteen rounds of AI reasoning never will.

2. **Implement formal verification of the state-machine invariants.** The AI auditors (including this one) reason by example and analogy; a model checker like TLA+ or a Rust-specific K-framework specification of the open-burn pairing, the sealed state transitions, and the Bank's signing authority would catch edge cases that prose and test suites miss.

3. **Require a multi-day time-locked freeze on ALL config changes that is enforced BY THE NETWORK**, not just the programs or cron. Currently, an admin key compromise can arm a rotation that the notice period protects against; a compromised admin key can also deploy a new program version instantly if the upgrade authority is not multi-sig time-locked. The AI rounds cannot simulate an internal threat actor with legitimate keys.